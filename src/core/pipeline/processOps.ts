import type { PipelineContext } from './types.ts';
import type { PipelineChecklistSelection, ProcessConfig, ProcessProgress } from '../types.ts';
import { runMultiZonePipeline } from '../dsp/PipelineRunner.ts';
import type { ZoneWavPayload } from '../dsp/PipelineRunner.ts';
import { projectExtendedRegionsToClassicZones } from '../extendedAdapter.ts';
import { executeCanonicalPhase1SampleConditioning, generatePipelineModelArtwork } from '../dsp/PipelineConditioningSteps.ts';
import { decodeWav, encodePcm16Wav } from '../dsp/WavDecoder.ts';
import type { WorkerInboundMessage, WorkerOutboundMessage } from '../worker/analysisWorker.ts';
import { autoRepairCoverage, validateCoverage } from './zoneOps.ts';

export async function startProcess(ctx: PipelineContext, config: ProcessConfig, options?: { forceReanalyzeImported?: boolean; checklist?: PipelineChecklistSelection; }): Promise<void> {
  if (!ctx.state.session) throw new Error('No active session');
  if (ctx.state.isRunning) throw new Error('Process already running');

  ctx.state.session.processConfig = { ...config };
  const checklist = options?.checklist;

  // Step 1 (if checklist enabled): Auto-repair MIDI coverage when requested
  if (checklist?.steps.coverageMidi) {
    const covErrs = validateCoverage(ctx);
    if (covErrs.length > 0 && ctx.state.session.processConfig.keyMappingMode !== 'drum') {
      autoRepairCoverage(ctx);
    }
  }

  let velocityGainMap: Record<string, { lowGain: number; highGain: number }> = {};
  if (
    ctx.state.session.processConfig.workingMode === 'extended' &&
    ctx.state.session.extendedRegions &&
    ctx.state.session.extendedRegions.length > 0
  ) {
    const projected = projectExtendedRegionsToClassicZones(
      ctx.state.session.extendedRegions,
      ctx.state.session.zones,
    );
    ctx.state.session.zones = projected.zones;
    velocityGainMap = projected.velocityLayerGainCompensation;
  }

  const zones = [...ctx.state.session.zones];
  ctx.ensureZoneDemoBuffers(zones);
  const forceReanalyze =
    options?.forceReanalyzeImported === true ||
    checklist?.steps.enhanceClassicModel === true ||
    checklist?.steps.reconstructFromClassic === true;

  // Phase 1 Pre-DSP Sample Conditioning (Trim Silence -> De-Esser -> Denoise -> 96kHz Master Wave -> Normalize)
  if (checklist) {
    if (!ctx.state.session.sampleProcessingFlags) {
      ctx.state.session.sampleProcessingFlags = {};
    }
    await executeCanonicalPhase1SampleConditioning({
      samples: ctx.state.sampleBuffers,
      checklist,
      keyMappingMode: ctx.state.session.processConfig.keyMappingMode ?? 'chromatic',
      sampleFlags: ctx.state.session.sampleProcessingFlags,
      aiConfig: ctx.state.session.processConfig.aiConfig,
      onSampleEnhanced: (sampleName, enhancedWav) => {
        ctx.state.assetStore.setEnhancedAudio(sampleName, enhancedWav);
      },
    });
  }

  // Step 14: Cover Artwork Generation (if requested in checklist and not already present)
  if (checklist?.steps.generateCoverArtwork && !ctx.state.session.processConfig.coverArtwork) {
    try {
      const generatedArt = await generatePipelineModelArtwork({
        modelName: ctx.state.session.processConfig.modelName || ctx.state.session.name,
        expandedName: ctx.state.session.processConfig.expandedName || ctx.state.session.name,
        parameterSet: ctx.state.session.processConfig.parameterSet,
        category: ctx.state.session.detectedInstrumentCategory,
        sampleNames: Array.from(ctx.state.sampleBuffers.keys()),
        aiConfig: ctx.state.session.processConfig.aiConfig,
      });
      if (generatedArt) {
        ctx.state.session.processConfig.coverArtwork = generatedArt;
        config = { ...ctx.state.session.processConfig };
      }
    } catch {
      // non-fatal
    }
  }

  const includeResinator2 = checklist ? checklist.steps.compileExtendedResinator2 !== false : true;

  const scaleWavBufferGain = (rawBuf: ArrayBuffer | null, gain: number): ArrayBuffer | null => {
    if (!rawBuf || Math.abs(gain - 1.0) < 1e-3) return rawBuf ? rawBuf.slice(0) : null;
    try {
      const dec = decodeWav(rawBuf);
      const scaledMono = new Float32Array(dec.mono.length);
      for (let i = 0; i < dec.mono.length; i++) {
        scaledMono[i] = Math.max(-1, Math.min(1, dec.mono[i] * gain));
      }
      return encodePcm16Wav(scaledMono, dec.sampleRate, dec.instrument);
    } catch {
      return rawBuf.slice(0);
    }
  };

  const payloads: ZoneWavPayload[] = zones.map((zone) => {
    const comp = velocityGainMap[zone.id] ?? { lowGain: 1.0, highGain: 1.0 };
    const buf = zone.sampleLow
      ? (ctx.state.sampleBuffers.get(zone.sampleLow) ?? null)
      : null;
    const highBuf = zone.sampleHigh
      ? (ctx.state.sampleBuffers.get(zone.sampleHigh) ?? null)
      : null;
    const preservedLow =
      !forceReanalyze && zone.sampleLow
        ? ctx.state.importedSourceBinaries.get(zone.sampleLow)
        : undefined;
    const preservedHigh =
      !forceReanalyze && zone.sampleHigh
        ? ctx.state.importedSourceBinaries.get(zone.sampleHigh)
        : undefined;
    return {
      zone: { ...zone },
      wavBuffer: scaleWavBufferGain(buf, comp.lowGain),
      highWavBuffer: scaleWavBufferGain(highBuf, comp.highGain),
      preservedLowBinary: preservedLow,
      preservedHighBinary: preservedHigh,
    };
  });

  ctx.state.isRunning = true;
  ctx.state.cancelFlag = false;
  const startTime = Date.now();

  ctx.state.processProgress = {
    status: 'running',
    currentZone: 1,
    totalZones: zones.length,
    currentSample: zones[0]?.sampleLow ?? 'unknown',
    percent: 0,
    message: 'Initializing 8192-point STFT & harmonic peak-picking engine...',
    elapsedMs: 0,
  };
  ctx.emit({
    type: 'process-progress',
    progress: { ...ctx.state.processProgress },
  });

  // Use Web Worker when available in browser, fallback to async main-thread runner
  if (typeof Worker !== 'undefined') {
    try {
      terminateWorker(ctx);
      ctx.state.worker = new Worker(
        new URL('../worker/analysisWorker.ts', import.meta.url),
        { type: 'module' }
      );

      ctx.state.worker.onmessage = (
        ev: MessageEvent<WorkerOutboundMessage>
      ) => {
        const msg = ev.data;
        if (msg.type === 'progress') {
          ctx.state.processProgress = msg.progress;
          ctx.emit({
            type: 'process-progress',
            progress: { ...ctx.state.processProgress },
          });
        } else if (msg.type === 'complete') {
          ctx.state.isRunning = false;
          terminateWorker(ctx);
          ctx.state.bank.finalizeModelGeneration(
            config,
            zones.length,
            msg.zonesAnalysis,
            msg.zoneBinaries,
            msg.neuronikModelJson,
            msg.elapsedMs,
            undefined,
            includeResinator2 ? msg.expandedModelV2 : undefined
          );
        } else if (msg.type === 'cancelled') {
          ctx.state.isRunning = false;
          terminateWorker(ctx);
          ctx.state.processProgress = {
            status: 'cancelled',
            currentZone: ctx.state.processProgress?.currentZone ?? 0,
            totalZones: zones.length,
            currentSample: '',
            percent: ctx.state.processProgress?.percent ?? 0,
            message: 'Process cancelled by user',
            elapsedMs: msg.elapsedMs,
          };
          ctx.emit({
            type: 'process-progress',
            progress: { ...ctx.state.processProgress },
          });
        } else if (msg.type === 'error') {
          ctx.state.isRunning = false;
          terminateWorker(ctx);
          ctx.state.processProgress = {
            status: 'error',
            currentZone: ctx.state.processProgress?.currentZone ?? 0,
            totalZones: zones.length,
            currentSample: '',
            percent: ctx.state.processProgress?.percent ?? 0,
            message: msg.error,
            elapsedMs: Date.now() - startTime,
          };
          ctx.emit({
            type: 'process-progress',
            progress: { ...ctx.state.processProgress },
          });
          ctx.emit({ type: 'process-error', error: msg.error });
        }
      };

      ctx.state.worker.onerror = (err) => {
        ctx.state.isRunning = false;
        terminateWorker(ctx);
        const errMsg = err.message || 'Worker execution failed';
        ctx.emit({ type: 'process-error', error: errMsg });
      };

      const startMsg: WorkerInboundMessage = {
        type: 'start',
        payloads,
        config,
      };
      ctx.state.worker.postMessage(startMsg);
      return;
    } catch {
      // Fallback to main thread if Worker instantiation fails
      terminateWorker(ctx);
    }
  }

  // Main-thread fallback execution
  try {
    const result = await runMultiZonePipeline(
      payloads,
      config,
      (progress) => {
        ctx.state.processProgress = progress;
        ctx.emit({
          type: 'process-progress',
          progress: { ...ctx.state.processProgress },
        });
      },
      () => ctx.state.cancelFlag
    );

    ctx.state.isRunning = false;
    ctx.state.bank.finalizeModelGeneration(
      config,
      zones.length,
      result.zonesAnalysis,
      result.zoneBinaries,
      result.neuronikModelJson,
      Date.now() - startTime,
      undefined,
      includeResinator2 ? result.expandedModelV2 : undefined
    );
  } catch (err) {
    ctx.state.isRunning = false;
    const message = err instanceof Error ? err.message : String(err);
    if (ctx.state.cancelFlag || message.includes('cancelled')) {
      ctx.state.processProgress = {
        status: 'cancelled',
        currentZone: ctx.state.processProgress?.currentZone ?? 0,
        totalZones: zones.length,
        currentSample: '',
        percent: ctx.state.processProgress?.percent ?? 0,
        message: 'Process cancelled by user',
        elapsedMs: Date.now() - startTime,
      };
      ctx.emit({
        type: 'process-progress',
        progress: { ...ctx.state.processProgress },
      });
    } else {
      ctx.state.processProgress = {
        status: 'error',
        currentZone: ctx.state.processProgress?.currentZone ?? 0,
        totalZones: zones.length,
        currentSample: '',
        percent: 0,
        message,
        elapsedMs: Date.now() - startTime,
      };
      ctx.emit({
        type: 'process-progress',
        progress: { ...ctx.state.processProgress },
      });
      ctx.emit({ type: 'process-error', error: message });
    }
  }
}

export async function cancelProcess(ctx: PipelineContext): Promise<void> {
  ctx.state.cancelFlag = true;
  if (ctx.state.worker) {
    const msg: WorkerInboundMessage = { type: 'cancel' };
    ctx.state.worker.postMessage(msg);
    terminateWorker(ctx);
  }
  ctx.state.isRunning = false;
  if (ctx.state.processProgress) {
    ctx.state.processProgress = {
      ...ctx.state.processProgress,
      status: 'cancelled',
      message: 'Process cancelled by user',
    };
    ctx.emit({
      type: 'process-progress',
      progress: { ...ctx.state.processProgress },
    });
  }
}

export function getProcessProgress(ctx: PipelineContext): ProcessProgress | null {
  return ctx.state.processProgress;
}

export function terminateWorker(ctx: PipelineContext): void {
  if (ctx.state.worker) {
    ctx.state.worker.terminate();
    ctx.state.worker = null;
  }
}
