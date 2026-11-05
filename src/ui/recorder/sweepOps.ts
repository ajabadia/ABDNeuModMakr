import type { RecorderContext } from './types.ts';
import type { SessionTake } from './types.ts';
import { mixToMono, normalizeNoiseProfile } from './recorderUtils.ts';
import { createMidiAutoSampleManifest, midiNoteToStandardName } from '@abdsynths/shared/dsp/take/takeDsp.ts';
import { LiveMidiCaptureTracker, appendResumedRecordingToManifest, applyPilotRecommendationToConfig, buildScheduleFromConfig, embedManifestInWavBytes, getPendingOrFailedEventIndices, processAutoSampledRecording, runPilotNoteCaptureSession, runScheduledSweepOrchestrator, validateManualVelocities, type AutoSamplerProcessedOutput } from '../../core/autoSampler/MidiAutoSampleSession.ts';
import { isEs } from '../../core/i18n.ts';
import { confirmDialog, toast } from '../notify.ts';

export async function runPilotCalibration(ctx: RecorderContext): Promise<void> {
    await ctx.refreshMidiPorts();
    const jitter = await ctx.state.midi.runMidiJitterSmokeTest(35, ctx.state.autoSamplerConfig.midiChannel);
    let engine;
    try {
      engine = await ctx.state.capture.open({
        ...(ctx.state.selectedDeviceId ? { deviceId: ctx.state.selectedDeviceId } : {}),
        trimSilence: false,
        attachNoiseProfile: true,
        autoClassify: true,
      });
    } catch {
      ctx.state.pilotDiagnosticText = `${jitter.details}. Enable audio input to measure round-trip latency.`;
      ctx.renderAutoSamplerDeck();
      return;
    }

    if (engine.getState() !== 'monitoring') {
      toast('Stop current recording before running Pilot Note Calibration.', 'warning');
      return;
    }

    const diag = await runPilotNoteCaptureSession({
      engine,
      midi: ctx.state.midi,
      mixToMono,
      midiNote: 60,
      velocity: 100,
    });

    ctx.state.lastPilotRecommendation = diag;
    // Apply measured RTL immediately so subsequent sweeps and re-slices compensate it automatically
    ctx.state.autoSamplerConfig = applyPilotRecommendationToConfig(ctx.state.autoSamplerConfig, diag, {
      applyEnvelopeAndVelocity: false,
    });

    ctx.state.pilotDiagnosticText = `${isEs() ? 'RTL aplicada' : 'Applied RTL'}: ${diag.latencyMs.toFixed(1)} ms (${diag.latencySamples} smp) · Peak: ${diag.peakDbfs.toFixed(1)} dBFS · Floor: ${diag.noiseFloorDbfs.toFixed(1)} dBFS · Jitter: ${jitter.avgJitterMs.toFixed(2)} ms · Rec: Gate ${diag.recommendedGateDurationMs} ms / Release ${diag.recommendedMaxReleaseMs} ms`;
    ctx.renderAutoSamplerDeck();

    const rationaleText = isEs() ? diag.rationaleEs : (diag.rationaleEn || diag.rationale || diag.rationaleEs);
    const applyAll = await confirmDialog(
      isEs()
        ? `${rationaleText}\n\nLa compensación de latencia RTL (${diag.latencyMs.toFixed(1)} ms / ${diag.latencySamples} samples) ya quedó activa para el corte automático. ¿Deseas aplicar también la duración de Gate (${diag.recommendedGateDurationMs} ms), Release (${diag.recommendedMaxReleaseMs} ms) y capas de velocidad recomendadas?`
        : `${rationaleText}\n\nRTL latency compensation (${diag.latencyMs.toFixed(1)} ms / ${diag.latencySamples} samples) is now active for automatic slicing. Would you also like to apply the recommended Gate duration (${diag.recommendedGateDurationMs} ms), Release (${diag.recommendedMaxReleaseMs} ms), and velocity layers?`,
      {
        title: isEs()
          ? `Aplicar RTL medida (${diag.latencyMs.toFixed(1)} ms) y parámetros sugeridos`
          : `Apply Measured RTL (${diag.latencyMs.toFixed(1)} ms) & Recommended Parameters`,
        confirmLabel: isEs()
          ? `Aplicar RTL (${diag.latencyMs.toFixed(1)} ms) y recomendaciones`
          : `Apply RTL (${diag.latencyMs.toFixed(1)} ms) & Recommendations`,
        cancelLabel: isEs()
          ? `Conservar solo RTL (${diag.latencyMs.toFixed(1)} ms)`
          : `Keep Only RTL (${diag.latencyMs.toFixed(1)} ms)`,
      }
    );

    if (applyAll) {
      ctx.state.autoSamplerConfig = applyPilotRecommendationToConfig(ctx.state.autoSamplerConfig, diag, {
        applyEnvelopeAndVelocity: true,
      });
      ctx.state.activeSchedule = buildScheduleFromConfig(ctx.state.autoSamplerConfig);
      toast(`Pilot Calibration applied: RTL ${diag.latencyMs.toFixed(1)} ms, Gate ${diag.recommendedGateDurationMs} ms, Release ${diag.recommendedMaxReleaseMs} ms.`, 'success');
    } else {
      toast(`RTL ${diag.latencyMs.toFixed(1)} ms (${diag.latencySamples} smp) applied automatically.`, 'info');
    }

    const selectedTake = ctx.getSelectedTake();
    if (selectedTake?.manifest) {
      selectedTake.manifest.latencySamples = diag.latencySamples;
      runAutoSamplerPostProcessOnTake(ctx, selectedTake);
      ctx.renderTakes();
      ctx.renderTakeInspector();
    }
    ctx.renderAutoSamplerDeck();
  }


export async function toggleLiveMidiCapture(ctx: RecorderContext): Promise<void> {
    let engine;
    try {
      engine = await ctx.state.capture.open({
        ...(ctx.state.selectedDeviceId ? { deviceId: ctx.state.selectedDeviceId } : {}),
        trimSilence: false,
        attachNoiseProfile: true,
        autoClassify: true,
      });
    } catch {
      await ctx.enableMic();
      return;
    }

    if (engine.getState() === 'recording') {
      ctx.stopAndKeep();
      return;
    }

    await ctx.refreshMidiPorts();
    const sr = engine.getSampleRate();
    ctx.state.liveTracker = new LiveMidiCaptureTracker(sr, ctx.state.autoSamplerConfig.maxReleaseMs);
    ctx.state.liveMarkers = [];

    ctx.state.liveMidiUnsub?.();
    ctx.state.liveMidiUnsub = ctx.state.midi.onInputMessage((msg) => {
      if (!ctx.state.liveTracker) return;
      const currFrame = Math.round(engine.getRecordedSec() * sr);
      if (msg.type === 'noteon') {
        ctx.state.liveTracker.onNoteOn(msg.note, msg.velocity, currFrame);
        ctx.state.liveMarkers.push({
          frame: currFrame,
          kind: 'noteOn',
          label: `${midiNoteToStandardName(msg.note)} v${msg.velocity}`,
        });
      } else if (msg.type === 'noteoff') {
        ctx.state.liveTracker.onNoteOff(msg.note, currFrame);
        ctx.state.liveMarkers.push({
          frame: currFrame,
          kind: 'noteOff',
          label: 'Off',
        });
      }
      ctx.renderAutoSamplerGrid();
    });

    engine.startRecording();
    toast('Live MIDI Capture active: play your MIDI keyboard and press Stop when finished.', 'info');
    ctx.renderTransport();
  }

  /**
   * Ejecuta el barrido automático (completo, continuación de celdas pendientes o
   * re-grabación de una única celda de la cuadrícula).
   */

export async function runAutoSamplerSweep(ctx: RecorderContext, options?: {
    resumeTakeId?: string;
    specificCellIndex?: number;
  }): Promise<SessionTake | null> {
    if (ctx.state.isSweepRunning) return null;

    if (ctx.state.autoSamplerConfig.velocityCurve === 'manual_table') {
      const velVal = validateManualVelocities(ctx.state.autoSamplerConfig.manualVelocities);
      if (!velVal.valid) {
        toast(velVal.errorMessage ?? 'Corrige las velocidades manuales antes de iniciar el barrido.', 'warning');
        return null;
      }
    }

    let engine;
    try {
      engine = await ctx.state.capture.open({
        ...(ctx.state.selectedDeviceId ? { deviceId: ctx.state.selectedDeviceId } : {}),
        trimSilence: false,
        attachNoiseProfile: true,
        autoClassify: true,
      });
    } catch {
      await ctx.enableMic();
      return null;
    }

    const existingTake = options?.resumeTakeId
      ? ctx.state.takes.find((t) => t.id === options.resumeTakeId)
      : undefined;

    if (!existingTake) {
      ctx.state.activeSchedule = buildScheduleFromConfig(ctx.state.autoSamplerConfig);
    } else if (existingTake.manifest) {
      ctx.state.activeSchedule = existingTake.manifest.events.map((ev) => ({ ...ev }));
    }

    const tempManifest = createMidiAutoSampleManifest({
      name: existingTake?.name ?? 'AutoSampler Session',
      mode: ctx.state.autoSamplerConfig.mode,
      sampleRate: engine.getSampleRate(),
      events: ctx.state.activeSchedule,
    });

    const targetIndices = getPendingOrFailedEventIndices(tempManifest, options?.specificCellIndex);
    if (targetIndices.length === 0) {
      toast('All scheduled cells are already recorded.', 'info');
      return existingTake ?? null;
    }

    ctx.state.isSweepRunning = true;
    ctx.state.sweepAbortRequested = false;
    ctx.state.liveMarkers = [];
    ctx.renderTransport();
    ctx.renderAutoSamplerGrid();

    let sweepRes;
    try {
      sweepRes = await runScheduledSweepOrchestrator({
        schedule: ctx.state.activeSchedule,
        targetIndices,
        config: ctx.state.autoSamplerConfig,
        engine,
        midi: ctx.state.midi,
        mixToMono,
        isAborted: () => ctx.state.sweepAbortRequested || !ctx.state.backdropEl,
        onMarker: (m) => {
          ctx.state.liveMarkers.push(m);
        },
        onProgress: () => {
          ctx.renderAutoSamplerGrid();
        },
      });
    } finally {
      ctx.state.isSweepRunning = false;
    }

    const { rawTake, newMono, capturedPreRollProfile, measuredLatencySamples, updatedEvents } =
      sweepRes;

    if (existingTake && existingTake.manifest) {
      // Continuación o re-toma de celda: fusionar con el audio y manifiesto previos
      const prevMono = mixToMono(existingTake.take);
      const { mergedPcm, updatedManifest } = appendResumedRecordingToManifest(
        prevMono,
        existingTake.manifest,
        newMono,
        updatedEvents
      );
      if (!updatedManifest.latencySamples && measuredLatencySamples > 0) {
        updatedManifest.latencySamples = measuredLatencySamples;
      }
      ctx.pushUndoSnapshot(existingTake);
      existingTake.manifest = updatedManifest;
      ctx.rebuildTakeFromChannels(
        existingTake,
        [mergedPcm],
        existingTake.take.sampleRate,
        normalizeNoiseProfile(existingTake.take.noiseProfile)
      );
      runAutoSamplerPostProcessOnTake(ctx, existingTake);
      ctx.renderTakes();
      ctx.renderTakeInspector();
      ctx.renderAutoSamplerDeck();
      return existingTake;
    }

    const finalManifest = createMidiAutoSampleManifest({
      name:
        ctx.state.autoSamplerConfig.mode === 'drum_map' && ctx.state.autoSamplerConfig.drumMap
          ? ctx.state.autoSamplerConfig.drumMap.kitName
          : 'AutoSampler Sweep',
      mode: ctx.state.autoSamplerConfig.mode,
      sampleRate: rawTake.sampleRate,
      channel: ctx.state.autoSamplerConfig.midiChannel,
      latencySamples: measuredLatencySamples,
      velocityCurve: ctx.state.autoSamplerConfig.velocityCurve,
      releaseMode: ctx.state.autoSamplerConfig.releaseMode,
      gateDurationMs: ctx.state.autoSamplerConfig.gateDurationMs,
      maxReleaseMs: ctx.state.autoSamplerConfig.maxReleaseMs,
      noiseProfile: normalizeNoiseProfile(capturedPreRollProfile ?? rawTake.noiseProfile),
      events: ctx.state.activeSchedule.map((ev) => ({ ...ev })),
    });

    const created = ctx.finishTake(
      rawTake,
      finalManifest.name,
      finalManifest
    );
    ctx.renderAutoSamplerDeck();
    return created;
  }


export function runAutoSamplerPostProcessOnTake(ctx: RecorderContext, st: SessionTake): AutoSamplerProcessedOutput | null {
    if (!st.manifest) return null;
    const mono = mixToMono(st.take);
    if (mono.length === 0) return null;

    const processed = processAutoSampledRecording(mono, st.manifest, ctx.state.autoSamplerConfig);
    st.manifest = processed.manifest;
    st.processedAutoSample = processed;

    // Incrustar el manifiesto actualizado en el RIFF chunk `atem` del WAV para rescate no destructivo
    const baseWavBuf = st.take.wav.buffer.slice(
      st.take.wav.byteOffset,
      st.take.wav.byteOffset + st.take.wav.byteLength
    ) as ArrayBuffer;
    const embeddedBuf = embedManifestInWavBytes(baseWavBuf, st.manifest);
    st.take = {
      ...st.take,
      wav: embeddedBuf,
    };
    return processed;
  }

