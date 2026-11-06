// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Phase 12: Batch Queue Execution Engine
// ─────────────────────────────────────────────────────────

import type {
  BatchConfig,
  BatchModelCandidate,
  BatchProgressState,
  BatchResultSummary,
} from './types.ts';
import { runMultiZonePipeline, type ZoneWavPayload } from '../dsp/PipelineRunner.ts';
import { buildTimeCapsuleEntries } from '../timeCapsule.ts';
import { createZipArchive, type ZipEntryInput } from '@abdsynths/shared/formats/neuron';
import { bridgeClient, type AxionikSaveFileEntry } from '../bridge/BridgeClient.ts';
import { parseSampleFilenameByName } from '../sampleNaming.ts';
import { createZone } from '../sessionFactory.ts';
import type { MidiNote, ProcessConfig, Zone } from '../types.ts';
import { sliceAudioBuffer, buildMidiFileBuffer, type SlicerMode } from '../dsp/AudioSlicerEngine.ts';
import {
  decodeWav,
  decodeAiff,
  encodePcm16Wav,
  isSupportedAudioFileName,
  transcodeAnyAudioToWavBuffer,
} from '../dsp/WavDecoder.ts';
import { isRx2Buffer, decompressRx2AudioCapped } from '../dsp/DwopDecompressor.ts';
import { fileExtension } from '../pathUtils.ts';
import { delay, yieldToUI } from '../asyncUtils.ts';
import { webNeuralEngine } from '../ai/WebNeuralEngine.ts';
import {
  computeNoiseProfile,
  dcBlock,
  detectSilenceRanges,
  normalizePeak,
  peakAmplitude,
} from '@abdsynths/shared/dsp/take/takeDsp.ts';
import { reduceNoiseWithProfile } from '@abdsynths/shared/dsp/take/NoiseReductionDsp.ts';
import { snapFrameToNearestZeroCrossing } from '../dsp/LoopEditorTools.ts';
import { promoteBufferToMasterWave } from '../dsp/MasterWaveEnhancer.ts';
import {
  applyDynamicBandDeEsserDsp,
  createDefaultPipelineChecklistSelection,
  generatePipelineModelArtwork,
} from '../dsp/PipelineConditioningSteps.ts';
import { SpectralAnalyzer } from '../dsp/SpectralAnalyzer.ts';
import { extractAcousticDescriptors, classifyAcousticSample } from '../dsp/AcousticIntelligence.ts';
import { classifyPresetCategory } from '@abdsynths/shared/formats/sampler';

export type BatchQueueEvent =
  | 'progress'
  | 'stage-start'
  | 'stage-complete'
  | 'job-start'
  | 'job-complete'
  | 'job-failed'
  | 'queue-complete'
  | 'queue-paused'
  | 'queue-resumed'
  | 'queue-cancelled';

export type BatchEventListener = (event: BatchQueueEvent, data: any) => void;

interface StagedJobWorkspace {
  job: BatchModelCandidate;
  index: number;
  startTime: number;
  rawSamples: Map<string, ArrayBuffer>;
  zones: Zone[];
  midiPatternFile: { name: string; buffer: ArrayBuffer } | null;
}

export class BatchQueue {
  private jobs: BatchModelCandidate[] = [];
  private listeners: Set<BatchEventListener> = new Set();
  private isRunning = false;
  private isPaused = false;
  private isCancelled = false;
  private currentIndex = 0;
  private currentStageIndex = 1;
  private totalStages = 5;
  private currentStageLabel = '';
  private startTime = 0;
  private masterZipEntries: ZipEntryInput[] = [];

  constructor(initialJobs: BatchModelCandidate[] = []) {
    this.jobs = [...initialJobs];
  }

  public getJobs(): BatchModelCandidate[] {
    return this.jobs;
  }

  public setJobs(jobs: BatchModelCandidate[]): void {
    if (this.isRunning) {
      throw new Error('Cannot replace jobs while queue is running.');
    }
    this.jobs = [...jobs];
    this.currentIndex = 0;
  }

  public addJobs(newJobs: BatchModelCandidate[]): void {
    this.jobs.push(...newJobs);
  }

  public clear(): void {
    if (this.isRunning) {
      throw new Error('Cannot clear queue while running.');
    }
    this.jobs = [];
    this.currentIndex = 0;
    this.masterZipEntries = [];
  }

  public on(listener: BatchEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: BatchQueueEvent, data?: any): void {
    for (const listener of this.listeners) {
      try {
        listener(event, data);
      } catch {
        // Ignore listener error
      }
    }
  }

  public getProgressState(): BatchProgressState {
    const totalJobs = this.jobs.length;
    const completedJobs = this.jobs.filter((j) => j.status === 'completed').length;
    const failedJobs = this.jobs.filter((j) => j.status === 'failed').length;
    const skippedJobs = this.jobs.filter((j) => j.status === 'skipped').length;
    const elapsedMs = this.startTime > 0 ? Date.now() - this.startTime : 0;

    const currentJob = this.jobs[this.currentIndex];
    const sumPct = this.jobs.reduce((acc, j) => {
      if (j.status === 'completed' || j.status === 'failed' || j.status === 'skipped') return acc + 100;
      return acc + Math.max(0, Math.min(100, j.progressPct || 0));
    }, 0);
    const overallPct = totalJobs > 0 ? Math.round(sumPct / totalJobs) : 0;

    const remainingJobs = totalJobs - (completedJobs + failedJobs + skippedJobs);
    const avgDuration = completedJobs > 0 ? elapsedMs / completedJobs : 2500;
    const estimatedRemainingMs = remainingJobs > 0 ? remainingJobs * avgDuration : 0;

    let status: BatchProgressState['status'] = 'idle';
    if (this.isCancelled) status = 'cancelled';
    else if (this.isPaused) status = 'paused';
    else if (this.isRunning) status = 'running';
    else if (completedJobs + failedJobs + skippedJobs === totalJobs && totalJobs > 0) status = 'completed';

    return {
      status,
      totalJobs,
      completedJobs,
      failedJobs,
      skippedJobs,
      currentJobIndex: this.currentIndex,
      currentJobName: currentJob ? currentJob.name : '',
      currentJobPct: currentJob ? currentJob.progressPct : 0,
      overallPct,
      elapsedMs,
      estimatedRemainingMs,
      currentStageIndex: this.currentStageIndex,
      totalStages: this.totalStages,
      currentStageLabel: this.currentStageLabel,
    };
  }

  public pause(): void {
    if (this.isRunning && !this.isPaused) {
      this.isPaused = true;
      this.emit('queue-paused', this.getProgressState());
    }
  }

  public resume(): void {
    if (this.isRunning && this.isPaused) {
      this.isPaused = false;
      this.emit('queue-resumed', this.getProgressState());
    }
  }

  public cancel(): void {
    if (this.isRunning) {
      this.isCancelled = true;
      this.isPaused = false;
      this.emit('queue-cancelled', this.getProgressState());
    }
  }

  /**
   * Executes the batch queue.
   * By default (`executionOrder !== 'per-job'`), runs in **Stage-Grouped (Phase-Batched)** order:
   * each pipeline stage (1. Ingest/Slice -> 2. Separation -> 3. Denoise -> 4. BWE/Classify -> 5. Spectral STFT & Export)
   * executes across ALL models in the queue before advancing to the next stage, keeping AI/DSP models warm in memory
   * and flushing GPU VRAM only once between stage boundaries instead of loading/unloading models on every file.
   */
  public async start(config: BatchConfig): Promise<BatchResultSummary> {
    if (this.isRunning) {
      throw new Error('Batch queue is already running.');
    }
    if (this.jobs.length === 0) {
      return {
        total: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        totalDurationMs: 0,
        jobs: [],
      };
    }

    this.isRunning = true;
    this.isPaused = false;
    this.isCancelled = false;
    this.startTime = Date.now();
    this.masterZipEntries = [];

    if (config.executionOrder === 'per-job') {
      await this.runPerJobPipeline(config);
    } else {
      await this.runStageGroupedPipeline(config);
    }

    this.isRunning = false;

    let masterZipBytes: Uint8Array | undefined;
    if (config.destination === 'zip-master' && this.masterZipEntries.length > 0) {
      masterZipBytes = createZipArchive(this.masterZipEntries);
    }

    const summary: BatchResultSummary = {
      total: this.jobs.length,
      succeeded: this.jobs.filter((j) => j.status === 'completed').length,
      failed: this.jobs.filter((j) => j.status === 'failed').length,
      skipped: this.jobs.filter((j) => j.status === 'skipped').length,
      totalDurationMs: Date.now() - this.startTime,
      jobs: [...this.jobs],
      masterZipBytes,
    };

    this.emit('queue-complete', summary);
    return summary;
  }

  private async waitIfPaused(): Promise<boolean> {
    while (this.isPaused && !this.isCancelled) {
      await delay(100);
    }
    if (this.isCancelled) {
      for (const j of this.jobs) {
        if (j.status === 'pending' || j.status === 'processing') {
          j.status = 'skipped';
        }
      }
      return false;
    }
    return true;
  }

  private async flushStageVramIfEnabled(config: BatchConfig): Promise<void> {
    if (config.stagePipelineVramSafety !== false && bridgeClient.isConnected()) {
      try {
        await bridgeClient.clearMemoryCache();
      } catch {
        // non-blocking
      }
    }
  }

  /**
   * Stage-Grouped (Phase-Batched) Execution:
   * Runs all jobs through Stage 1, then all jobs through Stage 2, etc., so any AI model
   * (HTDemucs, DeepFilterNet 3, AudioSR, WebNeuralEngine) or deterministic DSP stage stays loaded once per stage.
   */
  private async runStageGroupedPipeline(config: BatchConfig): Promise<void> {
    this.totalStages = 5;
    const activeWorkspaces: StagedJobWorkspace[] = [];

    // ── STAGE 1/5: Ingest, Audio Decoding & Zone / AutoSlicer Mapping ──
    this.currentStageIndex = 1;
    this.currentStageLabel = 'Stage 1/5: Ingesta, Decodificación y Mapeo / AutoSlicer (Lote completo)';
    this.emit('stage-start', { stage: 1, label: this.currentStageLabel });

    for (let i = 0; i < this.jobs.length; i++) {
      if (!(await this.waitIfPaused())) return;
      const job = this.jobs[i];
      if (job.status === 'completed' || job.status === 'skipped') continue;

      this.currentIndex = i;
      job.status = 'processing';
      job.progressPct = 5;
      this.emit('job-start', { job, index: i });
      this.emit('progress', this.getProgressState());

      try {
        const rawSamples = new Map<string, ArrayBuffer>();
        for (const f of job.files) {
          let buf = f.buffer;
          if (isSupportedAudioFileName(f.name)) {
            try {
              buf = await transcodeAnyAudioToWavBuffer(f.buffer, f.name);
              f.buffer = buf;
            } catch {
              // keep original if RX2
            }
          }
          rawSamples.set(f.name, buf);
        }

        const isAutoSlicer =
          job.sourceType === 'auto-slicer' ||
          job.sourceType === 'loop-rx2' ||
          config.ingestionMode === 'slicer';

        let zones: Zone[] = [];
        let midiPatternFile: { name: string; buffer: ArrayBuffer } | null = null;

        const isDrumJob =
          config.keyMappingMode === 'drum' ||
          /drum|kit|perc/i.test(job.detectedCategory || '') ||
          (isAutoSlicer && config.slicerProfile === 'drums');

        const checklist =
          config.checklistSelection ??
          createDefaultPipelineChecklistSelection({
            workingMode: 'extended',
            keyMappingMode: isDrumJob ? 'drum' : (config.keyMappingMode ?? 'chromatic'),
            hasLegacyClassicOnlySources: false,
            dspAlgorithm: config.dspAlgorithm,
            aiConfig: config.aiConfig,
          });

        const shouldExtendCoverage = Boolean(checklist.steps.coverageMidi);

        if (isAutoSlicer && job.files.length > 0) {
          const sourceFile = job.files[0];
          const sliceResult = this.sliceCandidateAudio(sourceFile, job, config);
          zones = sliceResult.zones;
          for (const [name, buf] of sliceResult.sliceSamples.entries()) {
            rawSamples.set(name, buf);
          }
          if (sliceResult.midiBuffer) {
            job.midiPatternBytes = sliceResult.midiBuffer;
            midiPatternFile = {
              name: `${job.slug}_groove.mid`,
              buffer: sliceResult.midiBuffer.buffer as ArrayBuffer,
            };
            rawSamples.set(midiPatternFile.name, midiPatternFile.buffer);
          }
          job.detectedSliceCount = zones.length;
          job.zoneCount = zones.length;
        } else {
          if (job.classicZones && job.classicZones.length > 0) {
            zones = this.applyCoveragePolicyToZones(job, job.classicZones, shouldExtendCoverage);
          } else {
            zones = this.buildZonesFromFiles(job.files, shouldExtendCoverage, isDrumJob);
          }
        }

        if (zones.length === 0) {
          throw new Error('No valid zones could be mapped from input audio files.');
        }

        // Apply Trim Silence + Zero-Crossing Snap in Stage 1 if checked in checklist
        if (checklist.steps.trimSilence) {
          for (const [sName, ab] of Array.from(rawSamples.entries())) {
            if (sName.endsWith('.mid')) continue;
            try {
              const dec = decodeWav(ab);
              if (dec.mono && dec.mono.length > 64) {
                const silenceRanges = detectSilenceRanges(dec.mono, dec.sampleRate, {
                  thresholdDb: isDrumJob ? -48 : -46,
                  minSilenceMs: isDrumJob ? 25 : 60,
                  hangoverMs: isDrumJob ? 40 : 30,
                });
                let startFrame = 0;
                let endFrame = dec.mono.length;
                for (const r of silenceRanges) {
                  if (r.startFrame === 0) {
                    const cushionFrames = isDrumJob ? Math.round(dec.sampleRate * 0.0005) : 0;
                    startFrame = Math.max(0, r.endFrame - cushionFrames);
                  }
                  if (!isDrumJob && r.endFrame >= dec.mono.length) {
                    endFrame = Math.min(endFrame, r.startFrame);
                  }
                }
                if (endFrame > startFrame + 64 && (startFrame > 0 || endFrame < dec.mono.length)) {
                  startFrame = snapFrameToNearestZeroCrossing(dec.mono, startFrame, 256);
                  endFrame = snapFrameToNearestZeroCrossing(dec.mono, endFrame, 256);
                  if (endFrame > startFrame + 64) {
                    const trimmed = dec.mono.slice(startFrame, endFrame);
                    rawSamples.set(sName, encodePcm16Wav(trimmed, dec.sampleRate, dec.instrument));
                  }
                }
              }
            } catch {
              // ignore non-wav
            }
          }
        }

        job.progressPct = 20;
        activeWorkspaces.push({
          job,
          index: i,
          startTime: Date.now(),
          rawSamples,
          zones,
          midiPatternFile,
        });
      } catch (err) {
        job.status = 'failed';
        job.progressPct = 0;
        job.error = err instanceof Error ? err.message : String(err);
        job.durationMs = 0;
        this.emit('job-failed', { job, index: i, error: job.error });
      }
      await yieldToUI(5);
      this.emit('progress', this.getProgressState());
    }
    this.emit('stage-complete', { stage: 1 });

    const checklist =
      config.checklistSelection ??
      createDefaultPipelineChecklistSelection({
        workingMode: 'extended',
        keyMappingMode: config.keyMappingMode ?? 'chromatic',
        hasLegacyClassicOnlySources: false,
        dspAlgorithm: config.dspAlgorithm,
        aiConfig: config.aiConfig,
      });

    // ── STAGE 2/5: Batch Source Separation / De-bleeding (HTDemucs IA / HPSS DSP) ──
    const aiCfg = config.aiConfig;
    const sepEnabled = checklist.steps.sourceSeparation !== false;
    const runSepStage = Boolean(
      sepEnabled && aiCfg?.enabled && aiCfg.separation === 'ai' && bridgeClient.isConnected()
    );
    this.currentStageIndex = 2;
    this.currentStageLabel = !sepEnabled
      ? 'Stage 2/5: Separación de Stems omitida por checklist'
      : runSepStage
        ? 'Stage 2/5: Separación de Stems IA (HTDemucs v4 en memoria para todo el lote)'
        : 'Stage 2/5: Preparación de Aislamiento Acústico (Determinista)';
    this.emit('stage-start', { stage: 2, label: this.currentStageLabel });

    for (const ws of activeWorkspaces) {
      if (ws.job.status === 'failed') continue;
      if (!(await this.waitIfPaused())) return;
      this.currentIndex = ws.index;
      if (runSepStage) {
        for (const [sName, buf] of ws.rawSamples.entries()) {
          if (sName.endsWith('.mid')) continue;
          try {
            const sepRes = await bridgeClient.separateStems(buf, { stems: ['instrumental'], filename: sName });
            if (sepRes.stems?.instrumental) {
              ws.rawSamples.set(sName, sepRes.stems.instrumental);
            }
          } catch {
            // keep original sample on failure
          }
        }
      }
      ws.job.progressPct = 35;
      this.emit('progress', this.getProgressState());
      await yieldToUI(5);
    }
    if (runSepStage) {
      await this.flushStageVramIfEnabled(config);
    }
    this.emit('stage-complete', { stage: 2 });

    // ── STAGE 3/5: Batch De-Esser (4.5-11 kHz) + Denoise & Restoration (DeepFilterNet 3 IA / Spectral Gate DSP) ──
    const runDeEsser = Boolean(checklist.steps.deEsser);
    const runDenoise = checklist.steps.denoise !== false;
    const denoiseMode = !runDenoise ? 'bypass' : aiCfg?.enabled ? (aiCfg.denoise ?? 'dsp') : 'dsp';
    this.currentStageIndex = 3;
    this.currentStageLabel =
      denoiseMode === 'ai' && bridgeClient.isConnected()
        ? 'Stage 3/5: De-Esser + Reducción de Ruido IA (DeepFilterNet 3 en memoria para todo el lote)'
        : denoiseMode === 'dsp' || runDeEsser
          ? 'Stage 3/5: De-Esser + Denoise Espectral y Filtro DC/Hum (Lote completo)'
          : 'Stage 3/5: Denoise en Bypass (Audio directo)';
    this.emit('stage-start', { stage: 3, label: this.currentStageLabel });

    for (const ws of activeWorkspaces) {
      if (ws.job.status === 'failed') continue;
      if (!(await this.waitIfPaused())) return;
      this.currentIndex = ws.index;

      if (runDeEsser || denoiseMode !== 'bypass') {
        for (const [sName, buf] of Array.from(ws.rawSamples.entries())) {
          if (sName.endsWith('.mid')) continue;
          try {
            let currentBuf = buf;
            if (runDeEsser) {
              const dec = decodeWav(currentBuf);
              if (dec.mono && dec.mono.length > 64) {
                const deEssed = applyDynamicBandDeEsserDsp(dec.mono, dec.sampleRate);
                currentBuf = encodePcm16Wav(deEssed, dec.sampleRate, dec.instrument);
                ws.rawSamples.set(sName, currentBuf);
              }
            }
            if (denoiseMode === 'ai' && bridgeClient.isConnected()) {
              const enhanced = await bridgeClient.enhanceAudio(new Uint8Array(currentBuf), {
                targetSampleRate: 44100,
                capabilities: ['spectral-denoise', 'deepfilter'],
              });
              ws.rawSamples.set(
                sName,
                enhanced.buffer.slice(enhanced.byteOffset, enhanced.byteOffset + enhanced.byteLength) as ArrayBuffer
              );
            } else if (denoiseMode === 'dsp') {
              // Deterministic Algorithmic Denoise + DC Block across all jobs in Stage 3
              const decoded = decodeWav(currentBuf);
              if (decoded.mono && decoded.mono.length > 256) {
                const winLen = Math.min(decoded.mono.length, Math.max(256, Math.round(decoded.sampleRate * 0.1)));
                const np = computeNoiseProfile(decoded.mono.subarray(0, winLen), decoded.sampleRate);
                const cleaned = reduceNoiseWithProfile(
                  dcBlock(decoded.mono, decoded.sampleRate),
                  decoded.sampleRate,
                  np,
                  { reductionDb: 9, removeHum: true }
                );
                ws.rawSamples.set(sName, encodePcm16Wav(cleaned, decoded.sampleRate, decoded.instrument));
              }
            }
          } catch {
            // preserve original buffer if sample cannot be decoded as standard WAV
          }
        }
      }
      ws.job.progressPct = 50;
      this.emit('progress', this.getProgressState());
      await yieldToUI(5);
    }
    if (denoiseMode === 'ai') {
      await this.flushStageVramIfEnabled(config);
    }
    this.emit('stage-complete', { stage: 3 });

    // ── STAGE 4/5: Batch 96 kHz Master Wave (AudioSR / DSP), Normalization & Acoustic Classification ──
    const runMasterWave = Boolean(checklist.steps.upsampleMasterWave);
    const runBweStage = Boolean(
      runMasterWave && aiCfg?.enabled && aiCfg.masterWave === 'ai' && bridgeClient.isConnected()
    );
    const runNormalize = checklist.steps.normalize !== false;
    const runClassifier = checklist.steps.acousticClassifier !== false && config.autoAcousticClassification;
    const runAiClassifier = Boolean(runClassifier && aiCfg?.enabled && aiCfg.classifier === 'ai');
    this.currentStageIndex = 4;
    this.currentStageLabel =
      runBweStage || runAiClassifier
        ? 'Stage 4/5: Super-Resolución (AudioSR), Normalización y Clasificación Neuronal en Lote'
        : 'Stage 4/5: Acondicionamiento Master Wave / Normalización y Clasificación en Lote';
    this.emit('stage-start', { stage: 4, label: this.currentStageLabel });

    for (const ws of activeWorkspaces) {
      if (ws.job.status === 'failed') continue;
      if (!(await this.waitIfPaused())) return;
      this.currentIndex = ws.index;
      const isDrumJob =
        config.keyMappingMode === 'drum' ||
        ws.job.sourceType === 'auto-slicer' ||
        (config.ingestionMode === 'slicer' && config.slicerProfile === 'drums');

      if (runMasterWave) {
        for (const [sName, buf] of Array.from(ws.rawSamples.entries())) {
          if (sName.endsWith('.mid')) continue;
          try {
            if (runBweStage) {
              const enhanced = await bridgeClient.enhanceAudio(new Uint8Array(buf), {
                targetSampleRate: 96000,
                capabilities: ['resample-96k', 'harmonic-bwe'],
              });
              ws.rawSamples.set(
                sName,
                enhanced.buffer.slice(enhanced.byteOffset, enhanced.byteOffset + enhanced.byteLength) as ArrayBuffer
              );
            } else {
              const dec = decodeWav(buf);
              if (dec.mono && dec.mono.length > 64) {
                const promoted = await promoteBufferToMasterWave(buf, sName, 'batch-cond', {
                  promotionMethod: 'dsp-enhanced',
                  channelLayout: 'original',
                  targetSampleRate: 96000,
                  targetBitDepth: 24,
                  minLoopDurationSec: isDrumJob ? 0 : 3.0,
                  enableBandwidthExtension: true,
                  enableDenoiseGate: false,
                });
                if (promoted.channels[0] && promoted.channels[0].length > 0) {
                  ws.rawSamples.set(
                    sName,
                    encodePcm16Wav(promoted.channels[0], promoted.result.masterSampleRate, dec.instrument)
                  );
                }
              }
            }
          } catch {
            // keep current sample
          }
        }
      }

      if (runNormalize) {
        if (isDrumJob && checklist.normalizeGroupRelativeForDrums !== false) {
          let maxKitPeak = 0;
          const decodedList: Array<{ name: string; dec: ReturnType<typeof decodeWav> }> = [];
          for (const [sName, buf] of ws.rawSamples.entries()) {
            if (sName.endsWith('.mid')) continue;
            try {
              const dec = decodeWav(buf);
              if (dec.mono && dec.mono.length > 0) {
                const pk = peakAmplitude(dec.mono);
                if (pk > maxKitPeak) maxKitPeak = pk;
                decodedList.push({ name: sName, dec });
              }
            } catch {
              // ignore
            }
          }
          const targetPeakLin = Math.pow(10, -1.0 / 20);
          if (maxKitPeak > 1e-5 && Math.abs(maxKitPeak - targetPeakLin) > 1e-3) {
            const gain = targetPeakLin / maxKitPeak;
            for (const item of decodedList) {
              const scaled = new Float32Array(item.dec.mono.length);
              for (let k = 0; k < scaled.length; k++) {
                scaled[k] = Math.max(-1, Math.min(1, item.dec.mono[k] * gain));
              }
              ws.rawSamples.set(item.name, encodePcm16Wav(scaled, item.dec.sampleRate, item.dec.instrument));
            }
          }
        } else {
          for (const [sName, buf] of Array.from(ws.rawSamples.entries())) {
            if (sName.endsWith('.mid')) continue;
            try {
              const dec = decodeWav(buf);
              if (dec.mono && dec.mono.length > 0) {
                const norm = normalizePeak(dec.mono, -1.0);
                ws.rawSamples.set(sName, encodePcm16Wav(norm, dec.sampleRate, dec.instrument));
              }
            } catch {
              // ignore
            }
          }
        }
      }

      if (runClassifier) {
        const firstWav = ws.rawSamples.values().next().value;
        const nameHint = classifyPresetCategory(ws.job.name, Array.from(ws.rawSamples.keys()));
        if (firstWav) {
          try {
            const dec = decodeWav(firstWav);
            if (runAiClassifier) {
              const cls = await webNeuralEngine.classifyTimbre(dec.mono, dec.sampleRate);
              ws.job.detectedCategory = cls.category;
              ws.job.suggestedParameterSet = cls.parameterSet;
            } else if (dec.mono && dec.mono.length > 0) {
              const analyzer = new SpectralAnalyzer();
              const descriptors = extractAcousticDescriptors(dec.mono, dec.sampleRate, analyzer);
              const cls = classifyAcousticSample(descriptors, ws.job.name);
              // 'Synthesizer' is the name classifier's generic fallback (same role as the
              // legacy 'vintage' sentinel), so only hint-less names defer to acoustics.
              const genericName =
                nameHint.category === 'Synthesizer' || nameHint.category === 'vintage';
              ws.job.detectedCategory = genericName ? cls.detectedCategory : nameHint.category;
              ws.job.suggestedParameterSet = genericName
                ? cls.recommendedParameterSet
                : nameHint.parameterSet;
            }
          } catch {
            if (!ws.job.detectedCategory || ws.job.detectedCategory === 'Auto' || ws.job.detectedCategory === 'vintage') {
              ws.job.detectedCategory = nameHint.category;
              ws.job.suggestedParameterSet = nameHint.parameterSet;
            }
          }
        } else if (!ws.job.detectedCategory || ws.job.detectedCategory === 'Auto' || ws.job.detectedCategory === 'vintage') {
          ws.job.detectedCategory = nameHint.category;
          ws.job.suggestedParameterSet = nameHint.parameterSet;
        }
      }

      ws.job.progressPct = 65;
      this.emit('progress', this.getProgressState());
      await yieldToUI(5);
    }
    if (runBweStage) {
      await this.flushStageVramIfEnabled(config);
    }
    this.emit('stage-complete', { stage: 4 });

    // ── STAGE 5/5: Cover Artwork (Batch-Grouped if selected), Spectral STFT (.scape/.sphere + Resinator 2) & Time Capsule ──
    const runCoverArt = Boolean(checklist.steps.generateCoverArtwork);
    this.currentStageIndex = 5;
    this.currentStageLabel = runCoverArt
      ? 'Stage 5/5: Carátulas 512×512 en Lote, Síntesis Espectral (.scape/.sphere + Resinator 2) y Time Capsule'
      : 'Stage 5/5: Síntesis Espectral STFT (.scape/.sphere + Resinator 2) y Empaquetado Time Capsule';
    this.emit('stage-start', { stage: 5, label: this.currentStageLabel });

    if (runCoverArt) {
      for (const ws of activeWorkspaces) {
        if (ws.job.status === 'failed') continue;
        if (!(await this.waitIfPaused())) return;
        this.currentIndex = ws.index;
        try {
          ws.job.coverArtwork = await generatePipelineModelArtwork({
            modelName: ws.job.name,
            expandedName: ws.job.name,
            parameterSet: ws.job.suggestedParameterSet || 0,
            category: ws.job.detectedCategory,
            sampleNames: Array.from(ws.rawSamples.keys()),
            aiConfig: config.aiConfig,
          });
        } catch {
          // non-fatal
        }
      }
      if (aiCfg?.enabled && aiCfg.coverArtwork === 'local-ai') {
        await this.flushStageVramIfEnabled(config);
      }
    }

    for (const ws of activeWorkspaces) {
      if (ws.job.status === 'failed') continue;
      if (!(await this.waitIfPaused())) return;
      this.currentIndex = ws.index;
      const { job, rawSamples, zones, midiPatternFile } = ws;

      try {
        await this.compileAndExportStagedJob(job, zones, rawSamples, midiPatternFile, config);
        job.status = 'completed';
        job.progressPct = 100;
        job.durationMs = Date.now() - ws.startTime;
        // Free per-job audio buffers immediately after export
        rawSamples.clear();
        this.emit('job-complete', { job, index: ws.index });
      } catch (err) {
        job.status = 'failed';
        job.progressPct = 0;
        job.error = err instanceof Error ? err.message : String(err);
        job.durationMs = Date.now() - ws.startTime;
        rawSamples.clear();
        this.emit('job-failed', { job, index: ws.index, error: job.error });
      }

      await yieldToUI(10);
      this.emit('progress', this.getProgressState());
    }
    await this.flushStageVramIfEnabled(config);
    this.emit('stage-complete', { stage: 5 });
  }

  private async runPerJobPipeline(config: BatchConfig): Promise<void> {
    this.totalStages = 1;
    this.currentStageIndex = 1;
    this.currentStageLabel = 'Secuencial por Modelo (Todas las etapas por modelo)';

    for (let i = 0; i < this.jobs.length; i++) {
      if (!(await this.waitIfPaused())) break;

      this.currentIndex = i;
      const job = this.jobs[i];
      if (job.status === 'completed' || job.status === 'skipped') {
        continue;
      }

      const jobStart = Date.now();
      job.status = 'processing';
      job.progressPct = 5;
      this.emit('job-start', { job, index: i });
      this.emit('progress', this.getProgressState());

      try {
        await this.processSingleJob(job, config);
        job.status = 'completed';
        job.progressPct = 100;
        job.durationMs = Date.now() - jobStart;
        this.emit('job-complete', { job, index: i });
      } catch (err) {
        job.status = 'failed';
        job.progressPct = 0;
        job.error = err instanceof Error ? err.message : String(err);
        job.durationMs = Date.now() - jobStart;
        this.emit('job-failed', { job, index: i, error: job.error });
      }

      await yieldToUI(10);
      this.emit('progress', this.getProgressState());
    }
  }

  /**
   * Processes a single model candidate through the full analysis and Time Capsule generation pipeline.
   */
  private async processSingleJob(
    job: BatchModelCandidate,
    config: BatchConfig
  ): Promise<void> {
    // 1. Resolve zones and raw audio buffers
    const rawSamples = new Map<string, ArrayBuffer>();
    for (const f of job.files) {
      let buf = f.buffer;
      if (isSupportedAudioFileName(f.name)) {
        try {
          buf = await transcodeAnyAudioToWavBuffer(f.buffer, f.name);
          f.buffer = buf;
        } catch {
          // keep original if already handled or RX2
        }
      }
      rawSamples.set(f.name, buf);
    }

    const isAutoSlicer =
      job.sourceType === 'auto-slicer' ||
      job.sourceType === 'loop-rx2' ||
      config.ingestionMode === 'slicer';

    let zones: Zone[] = [];
    let midiPatternFile: { name: string; buffer: ArrayBuffer } | null = null;

    const isDrumJob =
      config.keyMappingMode === 'drum' ||
      /drum|kit|perc/i.test(job.detectedCategory || '') ||
      (isAutoSlicer && config.slicerProfile === 'drums');
    const checklist =
      config.checklistSelection ??
      createDefaultPipelineChecklistSelection({
        workingMode: 'extended',
        keyMappingMode: isDrumJob ? 'drum' : (config.keyMappingMode ?? 'chromatic'),
        hasLegacyClassicOnlySources: false,
        dspAlgorithm: config.dspAlgorithm,
        aiConfig: config.aiConfig,
      });
    const shouldExtendCoverage = Boolean(checklist.steps.coverageMidi);

    if (isAutoSlicer && job.files.length > 0) {
      const sourceFile = job.files[0];
      const sliceResult = this.sliceCandidateAudio(sourceFile, job, config);
      zones = sliceResult.zones;
      for (const [name, buf] of sliceResult.sliceSamples.entries()) {
        rawSamples.set(name, buf);
      }
      if (sliceResult.midiBuffer) {
        job.midiPatternBytes = sliceResult.midiBuffer;
        midiPatternFile = {
          name: `${job.slug}_groove.mid`,
          buffer: sliceResult.midiBuffer.buffer as ArrayBuffer,
        };
        rawSamples.set(midiPatternFile.name, midiPatternFile.buffer);
      }
      job.detectedSliceCount = zones.length;
      job.zoneCount = zones.length;
    } else {
      if (job.classicZones && job.classicZones.length > 0) {
        zones = this.applyCoveragePolicyToZones(job, job.classicZones, shouldExtendCoverage);
      } else {
        zones = this.buildZonesFromFiles(job.files, shouldExtendCoverage, isDrumJob);
      }
    }

    if (zones.length === 0) {
      throw new Error('No valid zones could be mapped from input audio files.');
    }

    job.progressPct = 25;
    this.emit('progress', this.getProgressState());

    await this.compileAndExportStagedJob(job, zones, rawSamples, midiPatternFile, config);
    await this.flushStageVramIfEnabled(config);
  }

  /**
   * Executes Stage 5 (Spectral STFT analysis, .scape/.sphere binary compilation, and Time Capsule export)
   * for a prepared job workspace.
   */
  private async compileAndExportStagedJob(
    job: BatchModelCandidate,
    zones: Zone[],
    rawSamples: Map<string, ArrayBuffer>,
    midiPatternFile: { name: string; buffer: ArrayBuffer } | null,
    config: BatchConfig
  ): Promise<void> {
    // Resolve dual model names:
    // - Classic hardware MName is strictly trimmed to 11 ASCII characters.
    // - Extended model name (expandedName) preserves the full name without character limit.
    const fullExpandedName = (job.name || 'Untitled').trim() || 'Untitled';
    const classicShortName = fullExpandedName.slice(0, 11).trim() || 'UNTITLED';

    // Resolve initial category & parameterSet from name hint if still generic
    const sampleNames = Array.from(rawSamples.keys());
    const nameHint = classifyPresetCategory(fullExpandedName, sampleNames);
    if (!job.detectedCategory || job.detectedCategory === 'Auto' || job.detectedCategory === 'vintage') {
      job.detectedCategory = nameHint.category;
      if (!job.suggestedParameterSet) {
        job.suggestedParameterSet = nameHint.parameterSet;
      }
    }

    // Resolve complexity and parameterSet
    const complexity =
      config.complexityStrategy === 'auto'
        ? job.suggestedComplexity || 8
        : config.complexityStrategy;

    const parameterSet = config.autoAcousticClassification
      ? job.suggestedParameterSet ?? nameHint.parameterSet ?? 0
      : 0;

    const procConfig: ProcessConfig = {
      modelNumber: 1,
      modelName: classicShortName,
      expandedName: fullExpandedName,
      complexity,
      parameterSet,
      targetFormat: config.targetFormat,
      dspAlgorithm: config.dspAlgorithm,
      workingMode: 'extended',
      keyMappingMode: config.keyMappingMode,
      coverArtwork: job.coverArtwork || undefined,
      extendedMetadata: {
        category: job.detectedCategory || nameHint.category,
      },
    };

    // Prepare payloads for PipelineRunner
    const payloads: ZoneWavPayload[] = zones.map((zone) => {
      const sName = zone.sampleLow || `Zone_${zone.rootKey}.wav`;
      const wavBuffer = rawSamples.get(sName) || rawSamples.values().next().value;
      if (!wavBuffer) {
        throw new Error(`Missing audio buffer for sample "${sName}" in model "${job.name}"`);
      }
      return {
        zone,
        wavBuffer,
      };
    });

    job.progressPct = Math.max(job.progressPct, 65);
    this.emit('progress', this.getProgressState());

    // Run DSP analysis
    const result = await runMultiZonePipeline(
      payloads,
      procConfig,
      (p) => {
        job.progressPct = 65 + Math.round((p.percent / 100) * 20);
        this.emit('progress', this.getProgressState());
      },
      () => this.isCancelled
    );

    // Refine both Classic (parameterSet 0..9) and Expanded (detectedCategory) classification
    // from acoustic DSP analysis if the preset name was generic ('vintage' / 'Auto')
    const primaryAcousticCls = result.zonesAnalysis[0]?.classification;
    if (primaryAcousticCls && config.autoAcousticClassification) {
      if (!job.detectedCategory || job.detectedCategory === 'Auto' || job.detectedCategory === 'vintage') {
        job.detectedCategory = primaryAcousticCls.detectedCategory;
      }
      if (
        !job.suggestedParameterSet ||
        nameHint.category === 'Synthesizer' ||
        nameHint.category === 'vintage'
      ) {
        job.suggestedParameterSet = primaryAcousticCls.recommendedParameterSet;
        procConfig.parameterSet = primaryAcousticCls.recommendedParameterSet;
      }
      procConfig.extendedMetadata = {
        ...procConfig.extendedMetadata,
        category: job.detectedCategory,
      };
    }

    job.progressPct = 88;
    this.emit('progress', this.getProgressState());

    // Build Time Capsule package entries (including Resinator 2 05_extended_model/axionik-expanded.json)
    const includeResinator2 = config.checklistSelection?.steps.compileExtendedResinator2 !== false;
    const capsuleResult = buildTimeCapsuleEntries({
      slot: 1,
      modelName: fullExpandedName,
      processConfig: procConfig,
      zones,
      extendedRegions: job.extendedRegions,
      articulation: job.articulation,
      detectedInstrumentCategory: job.detectedCategory,
      rawSourceSamples: rawSamples,
      classicEnhancedBinaries: result.zoneBinaries,
      expandedModelV2: includeResinator2 ? result.expandedModelV2 : undefined,
    });

    job.progressPct = 95;
    this.emit('progress', this.getProgressState());

    // Handle Destination
    if (config.destination === 'zip-master') {
      for (const entry of capsuleResult.entries) {
        this.masterZipEntries.push({
          path: `${job.slug}/${entry.path}`,
          data: entry.data,
        });
      }
      if (midiPatternFile) {
        this.masterZipEntries.push({
          path: `${job.slug}/04_midi/${midiPatternFile.name}`,
          data: new Uint8Array(midiPatternFile.buffer),
        });
      }
    } else if (config.destination === 'axionikdb') {
      if (bridgeClient.isConnected()) {
        const filesToSave: AxionikSaveFileEntry[] = capsuleResult.entries.map((e) => {
          if (typeof e.data === 'string') {
            return {
              path: e.path,
              content: e.data,
            };
          }
          return {
            path: e.path,
            content_b64: this.uint8ArrayToBase64(e.data),
          };
        });
        if (midiPatternFile) {
          filesToSave.push({
            path: `04_midi/${midiPatternFile.name}`,
            content_b64: this.uint8ArrayToBase64(new Uint8Array(midiPatternFile.buffer)),
          });
        }
        const targetSub = job.sublibrary || config.destinationSublibrary || 'Default';
        await bridgeClient.saveAxionikModel(
          config.axionikDbPath || 'd:\\desarrollos\\ABDSynths\\AxionikDB',
          job.slug,
          filesToSave,
          30000,
          targetSub
        );
      } else {
        for (const entry of capsuleResult.entries) {
          this.masterZipEntries.push({
            path: `${job.slug}/${entry.path}`,
            data: entry.data,
          });
        }
        if (midiPatternFile) {
          this.masterZipEntries.push({
            path: `${job.slug}/04_midi/${midiPatternFile.name}`,
            data: new Uint8Array(midiPatternFile.buffer),
          });
        }
      }
    }
  }

  /**
   * Fase 25: Slices an audio loop into individual drum hits or chromatic notes,
   * generates standard 16-bit WAV samples, maps zones, and extracts MIDI groove pattern.
   */
  private sliceCandidateAudio(
    file: { name: string; buffer: ArrayBuffer },
    job: BatchModelCandidate,
    config: BatchConfig
  ): {
    zones: Zone[];
    sliceSamples: Map<string, ArrayBuffer>;
    midiBuffer: Uint8Array | null;
  } {
    const rawSamples = new Map<string, ArrayBuffer>();
    const ext = fileExtension(file.name);
    const isRx2 = ext === 'rx2' || ext === 'rex' || isRx2Buffer(file.buffer);

    let pcm: Float32Array;
    let sampleRate = 44100;
    let detectedBpm = config.slicerBpm || 120;

    if (isRx2) {
      const rx2Res = decompressRx2AudioCapped(file.buffer, file.name);
      pcm = rx2Res.channels[0];
      sampleRate = rx2Res.sampleRate;
    } else {
      let decoded: { channels: Float32Array[]; sampleRate: number };
      if (ext === 'aif' || ext === 'aiff') {
        decoded = decodeAiff(file.buffer);
      } else {
        decoded = decodeWav(file.buffer);
      }
      sampleRate = decoded.sampleRate;
      if (decoded.channels.length === 1) {
        pcm = decoded.channels[0];
      } else {
        pcm = new Float32Array(decoded.channels[0].length);
        const inv = 1 / decoded.channels.length;
        for (let i = 0; i < pcm.length; i++) {
          let sum = 0;
          for (let ch = 0; ch < decoded.channels.length; ch++) {
            sum += decoded.channels[ch][i];
          }
          pcm[i] = sum * inv;
        }
      }
    }

    const slicerMode: SlicerMode = (job.slicerProfile || config.slicerProfile || 'drums') as SlicerMode;
    const slicerRes = sliceAudioBuffer(pcm, sampleRate, {
      mode: slicerMode,
      sensitivity: config.slicerSensitivity ?? 70,
      silenceThresholdDb: -42,
      preRollMs: 3,
      postRollMs: 8,
      snapZeroCrossing: config.slicerSnapZeroCrossing ?? true,
      bpm: detectedBpm,
      gridDivision: '1/16',
      allowOverlap: false,
      chromaticBaseNote: 36,
    });

    const validSlices = slicerRes.slices.filter((s) => !s.isSilence);
    if (validSlices.length === 0) {
      throw new Error(`AutoSlicer could not detect any valid audio slices in "${file.name}".`);
    }

    const zones: Zone[] = [];
    validSlices.forEach((sl, idx) => {
      const sliceWavName = `${job.slug}_slice${String(idx + 1).padStart(2, '0')}.wav`;
      const wavBuffer = encodePcm16Wav(sl.pcm, sampleRate, {
        rootKey: sl.rootKey,
        lowKey: sl.lowKey,
        highKey: sl.highKey,
      });
      rawSamples.set(sliceWavName, wavBuffer);

      zones.push(
        createZone(
          sl.lowKey as MidiNote,
          sl.rootKey as MidiNote,
          sl.highKey as MidiNote,
          sliceWavName
        )
      );
    });

    let midiBuffer: Uint8Array | null = null;
    if (config.exportMidiPattern !== false) {
      midiBuffer = slicerRes.midiFileBuffer || buildMidiFileBuffer(validSlices, detectedBpm);
    }

    return {
      zones,
      sliceSamples: rawSamples,
      midiBuffer,
    };
  }

  /**
   * Applies or skips outer-keybed extension (0..127) on pre-mapped zones and regions
   * depending on whether Step #1 (`coverageMidi`) is enabled in the Pipeline Checklist.
   */
  private applyCoveragePolicyToZones(
    job: BatchModelCandidate,
    inputZones: Zone[],
    extendToFullKeybed: boolean
  ): Zone[] {
    const cloned = inputZones.map((z) => ({ ...z })).sort((a, b) => a.lowKey - b.lowKey);
    if (!extendToFullKeybed || cloned.length === 0) {
      return cloned;
    }

    const lowestKey = cloned[0].lowKey;
    if (lowestKey > 0) {
      cloned[0].lowKey = 0 as MidiNote;
    }
    const highestKey = cloned[cloned.length - 1].highKey;
    if (highestKey < 127) {
      cloned[cloned.length - 1].highKey = 127 as MidiNote;
    }
    for (let i = 1; i < cloned.length; i++) {
      if (cloned[i].lowKey > cloned[i - 1].highKey + 1) {
        cloned[i - 1].highKey = (cloned[i].lowKey - 1) as MidiNote;
      }
    }

    if (job.extendedRegions && job.extendedRegions.length > 0) {
      const regCloned = job.extendedRegions.map((r) => ({ ...r }));
      let minReg = 127;
      let maxReg = 0;
      for (const r of regCloned) {
        if (r.lowKey < minReg) minReg = r.lowKey;
        if (r.highKey > maxReg) maxReg = r.highKey;
      }
      if (minReg > 0) {
        for (const r of regCloned) {
          if (r.lowKey === minReg) r.lowKey = 0;
        }
      }
      if (maxReg < 127) {
        for (const r of regCloned) {
          if (r.highKey === maxReg) r.highKey = 127;
        }
      }
      job.extendedRegions = regCloned;
    }

    return cloned;
  }

  /**
   * Maps audio files to MIDI key zones using Hartmann naming rules.
   * Stretches outer zones to 0..127 only when `extendToFullKeybed` is true (or for single-sample chromatic models).
   */
  private buildZonesFromFiles(
    files: { name: string; buffer: ArrayBuffer }[],
    extendToFullKeybed = false,
    isDrumJob = false
  ): Zone[] {
    const parsed = files.map((f, idx) => {
      const p = parseSampleFilenameByName(f.name.replace(/\.[^.]+$/, ''));
      const fallbackNote = isDrumJob ? Math.min(127, 36 + idx) : 60;
      return {
        file: f,
        rootKey: (p.rootKey >= 0 ? p.rootKey : fallbackNote) as MidiNote,
      };
    });

    parsed.sort((a, b) => a.rootKey - b.rootKey);
    const zones: Zone[] = [];

    if (isDrumJob && !extendToFullKeybed) {
      for (const cur of parsed) {
        zones.push(createZone(cur.rootKey, cur.rootKey, cur.rootKey, cur.file.name));
      }
      return zones;
    }

    const forceFullSpan = extendToFullKeybed || parsed.length === 1;

    for (let i = 0; i < parsed.length; i++) {
      const cur = parsed[i];
      const prev = i > 0 ? parsed[i - 1] : null;
      const next = i < parsed.length - 1 ? parsed[i + 1] : null;

      const lowKey = prev
        ? Math.floor((prev.rootKey + cur.rootKey) / 2) + 1
        : forceFullSpan
          ? 0
          : cur.rootKey;
      const highKey = next
        ? Math.floor((cur.rootKey + next.rootKey) / 2)
        : forceFullSpan
          ? 127
          : cur.rootKey;

      zones.push(
        createZone(
          Math.min(127, Math.max(0, lowKey)) as MidiNote,
          cur.rootKey,
          Math.min(127, Math.max(0, highKey)) as MidiNote,
          cur.file.name
        )
      );
    }

    return zones;
  }

  private uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    if (typeof btoa !== 'undefined') {
      return btoa(binary);
    }
    const nodeBuf = (globalThis as unknown as { Buffer?: { from: (s: string, enc: string) => { toString: (e: string) => string } } }).Buffer;
    if (nodeBuf) {
      return nodeBuf.from(binary, 'binary').toString('base64');
    }
    return '';
  }
}
