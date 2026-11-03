// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Fase 34 & Fase 30: Audio Recorder Modal
//
// Frontal del grabador sobre el núcleo portable `RecordingEngine`
// (@abdsynths/shared/dsp/take) + `AudioCaptureService` (captura de
// plataforma: getUserMedia → AudioWorklet → engine.pushSamples()),
// enriquecido con:
//   - Visor interactivo de onda del take con sombreado de silencios
//     detectados (`detectSilenceRanges`) y selección por arrastre de
//     región de ruido ("Noise Print" / Huella de Ruido).
//   - Captura explícita de huella de ruido (`captureNoisePrintFromRegion`),
//     recorte de silencios (`trimSilence`), reducción de ruido DSP
//     (`reduceNoiseWithProfile` + muesca 50/60 Hz), normalización
//     Peak / RMS, bloqueo DC (`dcBlock`) y clasificación acústica
//     automática (`extractTakeFeatures` + `classifyTake`).
//   - Mejora de audio por IA vía Companion Bridge (`bridgeClient.enhanceAudio`)
//     pasando la huella de ruido (`X-Noise-Profile`) para que la IA descarte
//     y suprima ese ruido antes del remuestreo a 96 kHz y expansión armónica.
//   - Historial Undo no destructivo por take e inyección directa en la sesión.
// ─────────────────────────────────────────────────────────

import { ICONS } from './icons.ts';
import { escHtml } from './escape.ts';
import { MUSICIAN_TERMS } from './preflightGateView.ts';
import { toast } from './notify.ts';
import { downloadBlob } from './download.ts';
import { createModalFocusTrap, type FocusTrap } from './modalFocusTrap.ts';
import { AudioCaptureService } from '../core/AudioCaptureService.ts';
import { bridgeClient } from '../core/bridge/BridgeClient.ts';
import { decodeWav } from '../core/dsp/WavDecoder.ts';
import {
  encodeWav16,
  type FinalizedTake,
  type RecorderState,
} from '@abdsynths/shared/dsp/take/recordingEngine.ts';
import {
  peakAmplitude,
  detectSilenceRanges,
  trimSilence,
  normalizePeak,
  normalizeRms,
  dcBlock,
  computeNoiseProfile,
  extractTakeFeatures,
  classifyTake,
  type NoiseProfile,
  type SilenceRange,
} from '@abdsynths/shared/dsp/take/takeDsp.ts';
import {
  captureNoisePrintFromRegion,
  reduceNoiseWithProfile,
} from '@abdsynths/shared/dsp/take/NoiseReductionDsp.ts';

export interface AudioRecorderContext {
  onAuditionPcm?: (pcm: Float32Array, sampleRate: number) => void;
  onStopAudition?: () => void;
  /** Envía un take al Chopper (deslice/destino de 34.4). Recibe WAV 16-bit + nombre. */
  onSendToChopper?: (wavBytes: ArrayBuffer, filename: string) => void;
  /** Inyecta un take directamente en la zona activa de la sesión. */
  onInjectTakeIntoSession?: (wavBytes: ArrayBuffer, filename: string) => void;
}

interface TakeSnapshot {
  samples: Float32Array[];
  sampleRate: number;
  noiseProfile?: NoiseProfile;
}

export interface SessionTake {
  id: string;
  name: string;
  take: FinalizedTake;
  history: TakeSnapshot[];
  selectionStartFrame: number | null;
  selectionEndFrame: number | null;
  noiseRegionLabel?: string;
}

function formatTakeTime(totalSec: number): string {
  const s = Math.max(0, totalSec);
  const mm = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  const tenths = Math.floor((s * 10) % 10);
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${tenths}`;
}

function toDbfs(linearPeak: number): number {
  return linearPeak <= 0 ? -Infinity : 20 * Math.log10(linearPeak);
}

function normalizeNoiseProfile(
  np: { levelDbfs: number; spectrumBands: number[]; hum50HzDb?: number; hum60HzDb?: number } | undefined
): NoiseProfile | undefined {
  if (!np) return undefined;
  return {
    levelDbfs: np.levelDbfs,
    spectrumBands: [...np.spectrumBands],
    hum50HzDb: np.hum50HzDb ?? -Infinity,
    hum60HzDb: np.hum60HzDb ?? -Infinity,
  };
}

export function mixToMono(take: FinalizedTake): Float32Array {
  const { samples } = take;
  if (samples.length === 0) return new Float32Array(0);
  if (samples.length === 1) return samples[0];
  const len = samples[0].length;
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let acc = 0;
    for (const ch of samples) acc += ch[i];
    out[i] = acc / samples.length;
  }
  return out;
}

const STATE_BADGE: Record<RecorderState, string> = {
  idle: 'IDLE',
  monitoring: 'MONITORING',
  recording: 'REC',
  paused: 'PAUSED',
  stopped: 'STOPPED',
};

export class AudioRecorderModal {
  private backdropEl: HTMLElement | null = null;
  private focusTrap: FocusTrap | null = null;
  private readonly capture = new AudioCaptureService();
  private readonly context: AudioRecorderContext;

  private devices: MediaDeviceInfo[] = [];
  private selectedDeviceId = '';
  private takes: SessionTake[] = [];
  private selectedTakeId: string | null = null;
  private takeSeq = 0;
  private rafId = 0;
  private opening = false;

  // Configuraciones interactivas de silencio y reducción de ruido
  private silenceThresholdDb = -48;
  private minSilenceMs = 120;
  private denoiseReductionDb = 14;
  private isDraggingSelection = false;
  private dragAnchorFrame = 0;

  constructor(context: AudioRecorderContext = {}) {
    this.context = context;
  }

  public isOpen(): boolean {
    return this.backdropEl !== null;
  }

  public getTakes(): ReadonlyArray<SessionTake> {
    return this.takes;
  }

  public getSelectedTake(): SessionTake | null {
    if (!this.selectedTakeId) return this.takes[0] ?? null;
    return this.takes.find((t) => t.id === this.selectedTakeId) ?? this.takes[0] ?? null;
  }

  /** Permite inyectar un take sintético o importado (útil para tests y flujo directo). */
  public addExternalTake(take: FinalizedTake, customName?: string): SessionTake {
    return this.finishTake(take, customName);
  }

  public open(): void {
    if (this.backdropEl) {
      this.backdropEl.querySelector<HTMLElement>('.nmm-modal-window')?.focus?.();
      return;
    }
    this.backdropEl = document.createElement('div');
    this.backdropEl.className = 'nmm-modal-backdrop nmm-recorder-backdrop';
    document.body.appendChild(this.backdropEl);
    this.backdropEl.addEventListener('click', (e) => {
      if (e.target === this.backdropEl) void this.close();
    });
    this.focusTrap = createModalFocusTrap(this.backdropEl, {
      onEscape: () => void this.close(),
    });
    this.focusTrap.activate();
    this.render();
    void this.refreshDevices();
    this.startMeterLoop();
  }

  public async close(): Promise<void> {
    if (!this.backdropEl) return;
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.context.onStopAudition?.();
    try {
      const engine = this.capture.isOpen() ? await this.capture.open() : null;
      if (engine && (engine.getState() === 'recording' || engine.getState() === 'paused')) {
        this.finishTake(engine.stopRecording());
      }
    } catch {
      // Si el motor no está disponible, no hay take que rescatar.
    }
    await this.capture.close().catch(() => undefined);
    this.focusTrap?.deactivate();
    this.focusTrap = null;
    this.backdropEl.remove();
    this.backdropEl = null;
  }

  // ── Dispositivos ──────────────────────────────────────────

  private async refreshDevices(): Promise<void> {
    try {
      this.devices = await AudioCaptureService.listDevices();
    } catch {
      this.devices = [];
    }
    const sel = this.backdropEl?.querySelector<HTMLSelectElement>('#rec-device');
    if (!sel) return;
    sel.innerHTML =
      this.devices.length === 0
        ? `<option value="">Default input</option>`
        : this.devices
            .map(
              (d, i) =>
                `<option value="${escHtml(d.deviceId)}">${escHtml(d.label || `Input ${i + 1}`)}</option>`
            )
            .join('');
    if (this.selectedDeviceId) sel.value = this.selectedDeviceId;
  }

  private async enableMic(): Promise<void> {
    if (this.opening) return;
    if (this.capture.isOpen()) {
      await this.capture.close().catch(() => undefined);
    }
    this.opening = true;
    this.setBusy(true);
    try {
      const sel = this.backdropEl?.querySelector<HTMLSelectElement>('#rec-device');
      this.selectedDeviceId = sel?.value ?? '';
      await this.capture.open({
        ...(this.selectedDeviceId ? { deviceId: this.selectedDeviceId } : {}),
        trimSilence: false, // conservamos la grabación completa para inspección/recorte/noise-print interactivo
        attachNoiseProfile: true,
        autoClassify: true,
      });
      this.renderTransport();
    } catch (err) {
      toast(`Microphone unavailable: ${err instanceof Error ? err.message : String(err)}`, 'warning');
    } finally {
      this.opening = false;
      this.setBusy(false);
    }
  }

  // ── Transporte ────────────────────────────────────────────

  private async toggleRecord(): Promise<void> {
    let engine;
    try {
      engine = await this.capture.open({
        ...(this.selectedDeviceId ? { deviceId: this.selectedDeviceId } : {}),
        trimSilence: false,
        attachNoiseProfile: true,
        autoClassify: true,
      });
    } catch {
      await this.enableMic();
      return;
    }
    const state = engine.getState();
    if (state === 'monitoring') {
      this.context.onStopAudition?.();
      engine.startRecording();
    } else if (state === 'recording') {
      engine.pauseRecording();
    } else if (state === 'paused') {
      engine.resumeRecording();
    }
    this.renderTransport();
  }

  private stopAndKeep(): void {
    if (!this.capture.isOpen()) return;
    void this.capture.open().then((engine) => {
      if (engine.getState() === 'recording' || engine.getState() === 'paused') {
        this.finishTake(engine.stopRecording());
      }
      this.renderTransport();
    });
  }

  private cancelAndDiscard(): void {
    if (!this.capture.isOpen()) return;
    void this.capture.open().then((engine) => {
      if (engine.getState() === 'recording' || engine.getState() === 'paused') {
        engine.cancelTake();
        toast('Take discarded.', 'info');
      }
      this.renderTransport();
    });
  }

  public finishTake(rawTake: FinalizedTake, customName?: string): SessionTake {
    this.takeSeq += 1;
    const name = customName || `Take ${String(this.takeSeq).padStart(2, '0')}`;
    const mono = mixToMono(rawTake);

    // Si el take viene sin clasificar, clasificamos automáticamente con extractTakeFeatures
    let classification = rawTake.classification;
    let classificationConfidence = rawTake.classificationConfidence;
    if (classification === 'unknown' && mono.length >= 64) {
      const feats = extractTakeFeatures(mono, rawTake.sampleRate);
      const cls = classifyTake(feats);
      classification = cls.kind;
      classificationConfidence = cls.confidence;
    }

    // Asegurar noiseProfile inicial (desde el silencio más largo o los primeros 300ms)
    let noiseProfile = normalizeNoiseProfile(rawTake.noiseProfile);
    let selStart: number | null = null;
    let selEnd: number | null = null;
    let noiseRegionLabel: string | undefined;

    if (mono.length > 0) {
      const silences = detectSilenceRanges(mono, rawTake.sampleRate, {
        thresholdDb: this.silenceThresholdDb,
        minSilenceMs: Math.min(80, this.minSilenceMs),
      });
      if (silences.length > 0) {
        const best = silences.reduce((a, b) =>
          b.endFrame - b.startFrame > a.endFrame - a.startFrame ? b : a
        );
        selStart = best.startFrame;
        selEnd = best.endFrame;
        noiseProfile = captureNoisePrintFromRegion(mono, rawTake.sampleRate, {
          startFrame: best.startFrame,
          endFrame: best.endFrame,
        });
        noiseRegionLabel = `Auto-Silence (${((best.startFrame / rawTake.sampleRate) * 1000).toFixed(0)}..${((best.endFrame / rawTake.sampleRate) * 1000).toFixed(0)} ms)`;
      } else if (!noiseProfile) {
        const head = Math.min(mono.length, Math.max(1, Math.round(rawTake.sampleRate * 0.25)));
        noiseProfile = computeNoiseProfile(mono.subarray(0, head), rawTake.sampleRate);
        noiseRegionLabel = `Head (0..${((head / rawTake.sampleRate) * 1000).toFixed(0)} ms)`;
      }
    }

    const enrichedTake: FinalizedTake = {
      ...rawTake,
      classification,
      classificationConfidence,
      ...(noiseProfile ? { noiseProfile } : {}),
    };

    const entry: SessionTake = {
      id: `take-${Date.now()}-${this.takeSeq}`,
      name,
      take: enrichedTake,
      history: [],
      selectionStartFrame: selStart,
      selectionEndFrame: selEnd,
      noiseRegionLabel,
    };

    this.takes.unshift(entry);
    this.selectedTakeId = entry.id;

    const clsLabel =
      enrichedTake.classification === 'unknown' ? 'unclassified' : enrichedTake.classification;
    const classPill = this.backdropEl?.querySelector('#rec-class-pill');
    if (classPill) {
      classPill.textContent = `${clsLabel} ${(enrichedTake.classificationConfidence * 100).toFixed(0)}%`;
    }

    toast(
      `${name} kept: ${enrichedTake.durationSec.toFixed(2)}s, peak ${enrichedTake.peakDbfs.toFixed(1)} dBFS, ${clsLabel}.`,
      'success'
    );
    this.renderTakes();
    this.renderTakeInspector();
    return entry;
  }

  // ── Edición DSP / IA del Take Seleccionado ────────────────

  private pushUndoSnapshot(st: SessionTake): void {
    st.history.push({
      samples: st.take.samples.map((ch) => new Float32Array(ch)),
      sampleRate: st.take.sampleRate,
      noiseProfile: normalizeNoiseProfile(st.take.noiseProfile),
    });
    if (st.history.length > 10) st.history.shift();
  }

  private rebuildTakeFromChannels(
    st: SessionTake,
    channels: Float32Array[],
    sampleRate = st.take.sampleRate,
    noiseProfile = normalizeNoiseProfile(st.take.noiseProfile)
  ): void {
    const validChannels =
      channels.length > 0 && channels[0].length > 0
        ? channels
        : [new Float32Array(1)];
    let peak = 0;
    for (const ch of validChannels) peak = Math.max(peak, peakAmplitude(ch));

    const mono = mixToMono({
      ...st.take,
      samples: validChannels,
      sampleRate,
      channels: validChannels.length,
    });
    const feats = extractTakeFeatures(mono, sampleRate);
    const cls = classifyTake(feats);

    st.take = {
      durationSec: validChannels[0].length / sampleRate,
      sampleRate,
      channels: validChannels.length,
      peakDbfs: toDbfs(peak),
      classification: cls.kind,
      classificationConfidence: cls.confidence,
      ...(noiseProfile ? { noiseProfile } : {}),
      samples: validChannels,
      wav: encodeWav16(validChannels, sampleRate),
    };
  }

  public captureNoisePrintFromSelection(takeId?: string): NoiseProfile | null {
    const st = takeId ? this.takes.find((t) => t.id === takeId) : this.getSelectedTake();
    if (!st) return null;
    const mono = mixToMono(st.take);
    if (mono.length === 0) return null;

    let start = st.selectionStartFrame ?? 0;
    let end = st.selectionEndFrame ?? 0;
    if (end <= start) {
      // Si no hay selección manual, buscar el silencio más largo o primeros 250ms
      const silences = detectSilenceRanges(mono, st.take.sampleRate, {
        thresholdDb: this.silenceThresholdDb,
        minSilenceMs: Math.min(80, this.minSilenceMs),
      });
      if (silences.length > 0) {
        const best = silences.reduce((a, b) =>
          b.endFrame - b.startFrame > a.endFrame - a.startFrame ? b : a
        );
        start = best.startFrame;
        end = best.endFrame;
      } else {
        start = 0;
        end = Math.min(mono.length, Math.max(1, Math.round(st.take.sampleRate * 0.25)));
      }
      st.selectionStartFrame = start;
      st.selectionEndFrame = end;
    }

    const profile = captureNoisePrintFromRegion(mono, st.take.sampleRate, {
      startFrame: start,
      endFrame: end,
    });
    st.take = {
      ...st.take,
      noiseProfile: profile,
    };
    const startMs = ((start / st.take.sampleRate) * 1000).toFixed(0);
    const endMs = ((end / st.take.sampleRate) * 1000).toFixed(0);
    st.noiseRegionLabel = `Region ${startMs}..${endMs} ms`;

    toast(
      `Noise print captured (${st.noiseRegionLabel}): ${profile.levelDbfs.toFixed(1)} dBFS, Hum 50Hz ${profile.hum50HzDb.toFixed(1)} dB`,
      'success'
    );
    this.renderTakeInspector();
    return profile;
  }

  public applyTrimSilenceToTake(takeId?: string): boolean {
    const st = takeId ? this.takes.find((t) => t.id === takeId) : this.getSelectedTake();
    if (!st) return false;
    const mono = mixToMono(st.take);
    if (mono.length === 0) return false;

    const { leadingMs, trailingMs } = trimSilence(mono, st.take.sampleRate, {
      thresholdDb: this.silenceThresholdDb,
      minSilenceMs: this.minSilenceMs,
    });
    const leadFrames = Math.min(
      mono.length,
      Math.round((leadingMs / 1000) * st.take.sampleRate)
    );
    const trailFrames = Math.min(
      mono.length - leadFrames,
      Math.round((trailingMs / 1000) * st.take.sampleRate)
    );
    const endFrame = mono.length - trailFrames;

    if (leadFrames === 0 && trailFrames === 0) {
      toast('No leading or trailing silence below threshold to trim.', 'info');
      return false;
    }
    if (endFrame <= leadFrames) {
      toast('Entire take is below the silence threshold; adjust threshold dB.', 'warning');
      return false;
    }

    // Antes de recortar el silencio, si aún no teníamos noiseProfile explícito, lo capturamos del tramo recortado
    if (!st.take.noiseProfile && leadFrames > 64) {
      st.take.noiseProfile = captureNoisePrintFromRegion(mono, st.take.sampleRate, {
        startFrame: 0,
        endFrame: leadFrames,
      });
      st.noiseRegionLabel = `Trimmed Lead (0..${leadingMs.toFixed(0)} ms)`;
    }

    this.pushUndoSnapshot(st);
    const trimmedChannels = st.take.samples.map((ch) => ch.slice(leadFrames, endFrame));
    st.selectionStartFrame = null;
    st.selectionEndFrame = null;
    this.rebuildTakeFromChannels(st, trimmedChannels);

    toast(
      `Trimmed silence: -${leadingMs.toFixed(0)} ms lead, -${trailingMs.toFixed(0)} ms tail.`,
      'success'
    );
    this.renderTakes();
    this.renderTakeInspector();
    return true;
  }

  public applyDspDenoiseToTake(takeId?: string): boolean {
    const st = takeId ? this.takes.find((t) => t.id === takeId) : this.getSelectedTake();
    if (!st) return false;

    // Si el usuario tiene seleccionada una región en el canvas, actualizamos primero la huella de ruido desde esa selección
    if (
      st.selectionStartFrame !== null &&
      st.selectionEndFrame !== null &&
      st.selectionEndFrame > st.selectionStartFrame + 16
    ) {
      const mono = mixToMono(st.take);
      st.take.noiseProfile = captureNoisePrintFromRegion(mono, st.take.sampleRate, {
        startFrame: st.selectionStartFrame,
        endFrame: st.selectionEndFrame,
      });
      const sMs = ((st.selectionStartFrame / st.take.sampleRate) * 1000).toFixed(0);
      const eMs = ((st.selectionEndFrame / st.take.sampleRate) * 1000).toFixed(0);
      st.noiseRegionLabel = `Selection (${sMs}..${eMs} ms)`;
    } else if (!st.take.noiseProfile) {
      this.captureNoisePrintFromSelection(st.id);
    }

    const profile = normalizeNoiseProfile(st.take.noiseProfile);
    if (!profile) {
      toast('Select a noise region or capture a noise print first.', 'warning');
      return false;
    }

    this.pushUndoSnapshot(st);
    const denoisedChannels = st.take.samples.map((ch) => {
      const dcCleaned = dcBlock(ch, st.take.sampleRate);
      return reduceNoiseWithProfile(dcCleaned, st.take.sampleRate, profile, {
        reductionDb: this.denoiseReductionDb,
        removeHum: true,
      });
    });

    this.rebuildTakeFromChannels(st, denoisedChannels);
    toast(
      `Applied DSP Spectral Denoise (-${this.denoiseReductionDb} dB + 50/60Hz Hum Notch) using ${st.noiseRegionLabel || 'Noise Print'}.`,
      'success'
    );
    this.renderTakes();
    this.renderTakeInspector();
    return true;
  }

  public applyNormalizeAndDcBlockToTake(mode: 'peak' | 'rms' = 'peak', takeId?: string): boolean {
    const st = takeId ? this.takes.find((t) => t.id === takeId) : this.getSelectedTake();
    if (!st) return false;
    this.pushUndoSnapshot(st);

    const processed = st.take.samples.map((ch) => {
      const clean = dcBlock(ch, st.take.sampleRate);
      return mode === 'peak' ? normalizePeak(clean, -1.0) : normalizeRms(clean, -16, 24);
    });
    this.rebuildTakeFromChannels(st, processed);
    toast(
      mode === 'peak'
        ? `Normalized peak to -1.0 dBFS + DC Block applied.`
        : `Normalized RMS to -16.0 dBFS + DC Block applied.`,
      'success'
    );
    this.renderTakes();
    this.renderTakeInspector();
    return true;
  }

  public async applyAiEnhanceToTake(takeId?: string): Promise<boolean> {
    const st = takeId ? this.takes.find((t) => t.id === takeId) : this.getSelectedTake();
    if (!st) return false;

    // Si hay una región seleccionada en la forma de onda, capturar la huella de ruido automáticamente antes de llamar a la IA
    if (
      st.selectionStartFrame !== null &&
      st.selectionEndFrame !== null &&
      st.selectionEndFrame > st.selectionStartFrame + 16
    ) {
      const mono = mixToMono(st.take);
      st.take.noiseProfile = captureNoisePrintFromRegion(mono, st.take.sampleRate, {
        startFrame: st.selectionStartFrame,
        endFrame: st.selectionEndFrame,
      });
      const sMs = ((st.selectionStartFrame / st.take.sampleRate) * 1000).toFixed(0);
      const eMs = ((st.selectionEndFrame / st.take.sampleRate) * 1000).toFixed(0);
      st.noiseRegionLabel = `Selection (${sMs}..${eMs} ms)`;
    } else if (!st.take.noiseProfile) {
      this.captureNoisePrintFromSelection(st.id);
    }

    const noiseProfile = normalizeNoiseProfile(st.take.noiseProfile);

    // Verificar conexión al Companion Bridge
    if (!bridgeClient.isConnected()) {
      await bridgeClient.checkHealth();
    }

    if (!bridgeClient.isConnected()) {
      // Fallback algorítmico local: aplica DSP Denoise + DC Block + Peak Normalize
      toast(
        'Companion Bridge offline: applying local DSP Spectral Denoise + DC Block + Peak Normalization.',
        'info'
      );
      this.applyDspDenoiseToTake(st.id);
      this.applyNormalizeAndDcBlockToTake('peak', st.id);
      return true;
    }

    const btn = this.backdropEl?.querySelector<HTMLButtonElement>('#btn-rec-ai-enhance');
    if (btn) btn.disabled = true;

    try {
      toast(
        `AI Enhancing "${st.name}" (96 kHz BWE + Noise Print suppression)...`,
        'info'
      );

      // Primero pre-limpiamos con el gate espectral local si hay huella de ruido y enviamos también noiseProfile al Bridge
      let inputChannels = st.take.samples;
      if (noiseProfile) {
        inputChannels = inputChannels.map((ch) =>
          reduceNoiseWithProfile(dcBlock(ch, st.take.sampleRate), st.take.sampleRate, noiseProfile, {
            reductionDb: this.denoiseReductionDb,
            removeHum: true,
          })
        );
      }
      const preCleanedWav = encodeWav16(inputChannels, st.take.sampleRate);

      const enhancedWavBytes = await bridgeClient.enhanceAudio(preCleanedWav, {
        targetSampleRate: 96000,
        capabilities: ['resample-96k', 'harmonic-bwe'],
        noiseProfile,
      });

      const decoded = decodeWav(
        enhancedWavBytes.buffer.slice(
          enhancedWavBytes.byteOffset,
          enhancedWavBytes.byteOffset + enhancedWavBytes.byteLength
        ) as ArrayBuffer
      );

      this.pushUndoSnapshot(st);
      const newChannels =
        decoded.channels && decoded.channels.length > 0
          ? decoded.channels
          : [decoded.mono];
      st.selectionStartFrame = null;
      st.selectionEndFrame = null;
      this.rebuildTakeFromChannels(st, newChannels, decoded.sampleRate, noiseProfile);

      toast(
        `AI Enhanced "${st.name}" to ${(decoded.sampleRate / 1000).toFixed(1)} kHz (Noise Print suppressed)!`,
        'success'
      );
      this.renderTakes();
      this.renderTakeInspector();
      return true;
    } catch (err) {
      toast(
        `AI Enhance failed: ${err instanceof Error ? err.message : String(err)}`,
        'error'
      );
      return false;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  public undoTakeEdit(takeId?: string): boolean {
    const st = takeId ? this.takes.find((t) => t.id === takeId) : this.getSelectedTake();
    if (!st || st.history.length === 0) return false;
    const prev = st.history.pop()!;
    st.selectionStartFrame = null;
    st.selectionEndFrame = null;
    this.rebuildTakeFromChannels(st, prev.samples, prev.sampleRate, prev.noiseProfile);
    toast(`Restored previous state of "${st.name}".`, 'info');
    this.renderTakes();
    this.renderTakeInspector();
    return true;
  }

  // ── Takes: audition / chopper / inject / download / delete ─

  private selectTake(id: string): void {
    if (this.selectedTakeId === id) return;
    this.selectedTakeId = id;
    this.renderTakes();
    this.renderTakeInspector();
  }

  private auditionTake(id: string): void {
    const found = this.takes.find((t) => t.id === id);
    if (!found || !this.context.onAuditionPcm) return;
    this.selectedTakeId = id;
    this.context.onAuditionPcm(mixToMono(found.take), found.take.sampleRate);
    this.renderTakes();
    this.renderTakeInspector();
  }

  private auditionSelectedRegion(): void {
    const st = this.getSelectedTake();
    if (!st || !this.context.onAuditionPcm) return;
    const mono = mixToMono(st.take);
    if (
      st.selectionStartFrame !== null &&
      st.selectionEndFrame !== null &&
      st.selectionEndFrame > st.selectionStartFrame
    ) {
      this.context.onAuditionPcm(
        mono.subarray(st.selectionStartFrame, st.selectionEndFrame),
        st.take.sampleRate
      );
    } else {
      this.context.onAuditionPcm(mono, st.take.sampleRate);
    }
  }

  private sendTakeToChopper(id: string): void {
    const found = this.takes.find((t) => t.id === id);
    if (!found || !this.context.onSendToChopper) return;
    this.context.onSendToChopper(found.take.wav.slice(0).buffer as ArrayBuffer, `${found.name}.wav`);
  }

  private injectTakeIntoSession(id: string): void {
    const found = this.takes.find((t) => t.id === id);
    if (!found || !this.context.onInjectTakeIntoSession) return;
    this.context.onInjectTakeIntoSession(
      found.take.wav.slice(0).buffer as ArrayBuffer,
      `${found.name}.wav`
    );
  }

  private downloadTake(id: string): void {
    const found = this.takes.find((t) => t.id === id);
    if (!found) return;
    downloadBlob(new Blob([found.take.wav.slice(0)], { type: 'audio/wav' }), `${found.name}.wav`);
  }

  private deleteTake(id: string): void {
    this.takes = this.takes.filter((t) => t.id !== id);
    if (this.selectedTakeId === id) {
      this.selectedTakeId = this.takes[0]?.id ?? null;
    }
    this.renderTakes();
    this.renderTakeInspector();
  }

  // ── Render ────────────────────────────────────────────────

  private render(): void {
    if (!this.backdropEl) return;
    this.backdropEl.innerHTML = `
      <div class="nmm-modal-window nmm-recorder-window" role="dialog" aria-modal="true" aria-labelledby="recorder-title" tabindex="-1">
        <header class="nmm-modal-header">
          <div class="nmm-modal-header-title">
            <span class="nmm-modal-header-icon">${ICONS.mic}</span>
            <span class="nmm-recorder-rec-dot" id="rec-state-dot" aria-hidden="true"></span>
            <h2 id="recorder-title">Studio Audio Recorder &amp; Noise/DSP Lab</h2>
            <span class="panel-badge badge-muted" id="rec-state-badge">IDLE</span>
          </div>
          <button type="button" class="nmm-modal-close" aria-label="Close" id="btn-recorder-close">${ICONS.close}</button>
        </header>

        <div class="nmm-modal-body nmm-recorder-body">
          <!-- 1. Studio Input, LCD, Meters & Transport Deck Card -->
          <div class="nmm-recorder-deck-card">
            <div class="nmm-recorder-devicebar">
              <div class="nmm-recorder-device-left">
                <label class="nmm-recorder-device-label" for="rec-device">INPUT SOURCE:</label>
                <select id="rec-device" class="form-control form-control-sm nmm-recorder-device-select" aria-label="Input device"></select>
                <button type="button" class="btn btn-xs btn-outline" id="btn-rec-refresh-devices" title="Refresh input devices">${ICONS.refresh} Rescan</button>
                <button type="button" class="btn btn-xs btn-outline" id="btn-rec-enable-mic">${ICONS.mic} Enable Mic</button>
              </div>
              <div class="nmm-recorder-device-right">
                <span class="val-pill font-mono" id="rec-peak-pill">−∞ dBFS</span>
                <span class="val-pill font-mono" id="rec-class-pill">no take yet</span>
              </div>
            </div>

            <div class="nmm-recorder-console-grid">
              <div class="nmm-recorder-lcdrow">
                <div class="nmm-recorder-lcd" aria-live="polite">
                  <span id="rec-lcd-time">00:00.0</span>
                </div>
              </div>

              <div class="nmm-recorder-meters" aria-hidden="true">
                <div class="nmm-recorder-meter"><span>L</span><div class="nmm-recorder-meter-track"><div class="nmm-recorder-meter-fill" id="rec-meter-l"></div></div></div>
                <div class="nmm-recorder-meter"><span>R</span><div class="nmm-recorder-meter-track"><div class="nmm-recorder-meter-fill" id="rec-meter-r"></div></div></div>
              </div>

              <div class="nmm-recorder-transport" id="rec-transport"></div>
            </div>
          </div>

          <!-- 2 & 3. Waveform Viewport Panel + Noise Gate & DSP/AI Restoration Card -->
          <div class="nmm-recorder-inspector" id="rec-take-inspector"></div>

          <!-- 4. Session Takes Table / List Panel -->
          <div class="nmm-recorder-takes-panel">
            <div class="nmm-recorder-takes-head">
              <div class="nmm-recorder-takes-head-left">
                <span>SESSION TAKES</span>
                <span class="val-pill font-mono" id="rec-takes-count">0</span>
              </div>
              <span class="nmm-recorder-takes-hint">Select a take to inspect waveform, capture Noise Print, or send to Chopper / Active Zone</span>
            </div>
            <div class="nmm-recorder-takes" id="rec-takes"></div>
          </div>
        </div>

        <footer class="nmm-modal-footer">
          <div class="footer-left">
            <button type="button" class="btn btn-ghost" id="btn-recorder-footer-close">Close</button>
          </div>
          <div class="footer-right" id="rec-footer-actions"></div>
        </footer>
      </div>`;

    this.backdropEl.querySelector('#btn-recorder-close')?.addEventListener('click', () => void this.close());
    this.backdropEl.querySelector('#btn-recorder-footer-close')?.addEventListener('click', () => void this.close());
    this.backdropEl
      .querySelector('#btn-rec-refresh-devices')
      ?.addEventListener('click', () => void this.refreshDevices());
    this.backdropEl
      .querySelector('#btn-rec-enable-mic')
      ?.addEventListener('click', () => void this.enableMic());
    this.backdropEl
      .querySelector('#rec-device')
      ?.addEventListener('change', () => void this.enableMic());

    this.renderTransport();
    this.renderTakes();
    this.renderTakeInspector();
  }

  private renderTransport(): void {
    const box = this.backdropEl?.querySelector('#rec-transport');
    if (!box) return;
    box.innerHTML = `
      <button type="button" class="btn btn-sm btn-danger-solid" id="btn-rec-record" title="Record / pause / resume">${ICONS.record} REC</button>
      <button type="button" class="btn btn-sm btn-outline" id="btn-rec-stop" title="Stop and keep take">${ICONS.stop} Stop</button>
      <button type="button" class="btn btn-sm btn-outline" id="btn-rec-cancel" title="Discard current take">${ICONS.trash} Discard</button>`;
    box.querySelector('#btn-rec-record')?.addEventListener('click', () => void this.toggleRecord());
    box.querySelector('#btn-rec-stop')?.addEventListener('click', () => this.stopAndKeep());
    box.querySelector('#btn-rec-cancel')?.addEventListener('click', () => this.cancelAndDiscard());
    this.syncTransportState();
  }

  private renderFooterActions(): void {
    const footerRight = this.backdropEl?.querySelector<HTMLElement>('#rec-footer-actions');
    if (!footerRight) return;
    const st = this.getSelectedTake();
    if (!st) {
      footerRight.innerHTML = '';
      return;
    }
    footerRight.innerHTML = `
      <button type="button" class="btn btn-outline" id="btn-rec-footer-download" title="Download selected take as 16-bit WAV">
        ${ICONS.download} Download WAV
      </button>
      <button type="button" class="btn btn-accent" id="btn-rec-footer-chopper" title="Open selected take in Audio Chopper & Auto-Slicer">
        ${ICONS.scissors} Send to Audio Chopper
      </button>
      ${
        this.context.onInjectTakeIntoSession
          ? `<button type="button" class="btn btn-primary" id="btn-rec-footer-inject" title="Inject selected take into Active Zone">
              ${ICONS.check} Inject into Active Zone
            </button>`
          : ''
      }
    `;
    footerRight
      .querySelector('#btn-rec-footer-download')
      ?.addEventListener('click', () => this.downloadTake(st.id));
    footerRight
      .querySelector('#btn-rec-footer-chopper')
      ?.addEventListener('click', () => this.sendTakeToChopper(st.id));
    footerRight
      .querySelector('#btn-rec-footer-inject')
      ?.addEventListener('click', () => this.injectTakeIntoSession(st.id));
  }

  private renderTakeInspector(): void {
    const container = this.backdropEl?.querySelector<HTMLElement>('#rec-take-inspector');
    this.renderFooterActions();
    if (!container) return;
    const st = this.getSelectedTake();
    if (!st) {
      container.innerHTML = `
        <div class="nmm-recorder-viewport-panel">
          <div class="nmm-recorder-inspector-head">
            <span class="nmm-recorder-inspector-title">${ICONS.wave} WAVEFORM &amp; NOISE PRINT INSPECTOR</span>
            <span class="val-pill font-mono">Waiting for Recorded Take</span>
          </div>
          <div class="nmm-recorder-wave-empty">
            <span>Enable microphone above and press <strong>REC</strong> to record a take.</span>
            <span>Once recorded, drag on the waveform to select a <strong>Noise Print</strong> region, trim silence, or run DSP / AI Enhancement.</span>
          </div>
          <div class="loop-canvas-legend">
            <span>Drag on waveform = Select <strong>Noise Print</strong> region (Violet)</span>
            <span>• Shaded amber = Auto-detected silence</span>
            <span>• Click silent region = Quick-select room tone</span>
          </div>
        </div>
      `;
      return;
    }

    const mono = mixToMono(st.take);
    const silences = detectSilenceRanges(mono, st.take.sampleRate, {
      thresholdDb: this.silenceThresholdDb,
      minSilenceMs: this.minSilenceMs,
    });
    const np = normalizeNoiseProfile(st.take.noiseProfile);
    const hasSelection =
      st.selectionStartFrame !== null &&
      st.selectionEndFrame !== null &&
      st.selectionEndFrame > st.selectionStartFrame;
    const selText = hasSelection
      ? `Selected Noise Zone: ${((st.selectionStartFrame! / st.take.sampleRate) * 1000).toFixed(0)}..${((st.selectionEndFrame! / st.take.sampleRate) * 1000).toFixed(0)} ms`
      : 'Drag on waveform to select a Noise Print zone (shaded = auto-detected silence)';

    const npSummary = np
      ? `Floor: ${np.levelDbfs.toFixed(1)} dBFS · 50Hz: ${np.hum50HzDb.toFixed(1)} dB · 60Hz: ${np.hum60HzDb.toFixed(1)} dB ${st.noiseRegionLabel ? `[${st.noiseRegionLabel}]` : ''}`
      : 'No Noise Print captured yet';

    container.innerHTML = `
      <div class="nmm-recorder-inspector-card">
        <!-- Card 2: Waveform & Noise Print Viewport Panel (Matches .loop-viewport-panel & .chopper-waveform-panel) -->
        <div class="nmm-recorder-viewport-panel">
          <div class="nmm-recorder-inspector-head">
            <span class="nmm-recorder-inspector-title">${ICONS.wave} ${escHtml(st.name)} • ${(st.take.sampleRate / 1000).toFixed(1)} kHz • ${st.take.durationSec.toFixed(2)}s • ${silences.length} silent zone${silences.length === 1 ? '' : 's'}</span>
            <span class="val-pill font-mono" id="rec-sel-readout">${escHtml(selText)}</span>
          </div>

          <div class="nmm-recorder-wave-wrap">
            <canvas id="rec-wave-canvas" class="nmm-recorder-wave-canvas" width="960" height="160"></canvas>
          </div>

          <div class="loop-canvas-legend">
            <span>Drag on waveform = Select <strong>Noise Print</strong> region (Violet)</span>
            <span>• Shaded amber = Auto-detected silence (${silences.length})</span>
            <span>• Click silent region = Quick-select room tone</span>
          </div>
        </div>

        <!-- Card 3: Noise Gate, Spectral Denoise & AI Restoration Card (Matches .loop-controls-card & .chopper-params-card) -->
        <div class="nmm-recorder-controls-card">
          <div class="nmm-recorder-params-grid">
            <div class="form-group">
              <div class="label-with-val">
                <label>${escHtml(MUSICIAN_TERMS.noisePrint)}</label>
                <span class="val-pill">${np ? 'ACTIVE' : 'NONE'}</span>
              </div>
              <div class="nmm-recorder-noise-readout-box" id="rec-noise-readout" title="${escHtml(npSummary)}">
                ${escHtml(npSummary)}
              </div>
            </div>

            <div class="form-group">
              <div class="label-with-val">
                <label for="inp-rec-silence-db">SILENCE GATE THRESHOLD</label>
                <span class="val-pill font-mono" id="lbl-rec-silence-db">${this.silenceThresholdDb} dB</span>
              </div>
              <input type="number" id="inp-rec-silence-db" class="form-control font-mono" value="${this.silenceThresholdDb}" min="-90" max="-12" step="2" />
            </div>

            <div class="form-group">
              <div class="label-with-val">
                <label for="inp-rec-denoise-db">SPECTRAL DENOISE REDUCTION</label>
                <span class="val-pill font-mono" id="lbl-rec-denoise-db">${this.denoiseReductionDb} dB</span>
              </div>
              <input type="number" id="inp-rec-denoise-db" class="form-control font-mono" value="${this.denoiseReductionDb}" min="3" max="36" step="1" />
            </div>
          </div>

          <div class="nmm-recorder-dsp-toolbar">
            <div class="nmm-recorder-dsp-left">
              <button type="button" class="btn btn-sm btn-outline" id="btn-rec-capture-noise" title="${escHtml(MUSICIAN_TERMS.noisePrint)}">
                ${ICONS.search} ${escHtml(MUSICIAN_TERMS.noisePrint)}
              </button>
              <button type="button" class="btn btn-sm btn-outline" id="btn-rec-trim-silence" title="Trim leading and trailing silence">
                ${ICONS.scissors} Trim Silence
              </button>
              <button type="button" class="btn btn-sm btn-outline" id="btn-rec-dsp-denoise" title="Subtract captured Noise Print and notch 50/60 Hz hum">
                ${ICONS.sliders} DSP Denoise
              </button>
              <button type="button" class="btn btn-sm btn-outline" id="btn-rec-normalize" title="Apply DC Block and Peak Normalize to -1.0 dBFS">
                ${ICONS.zap} Norm -1 dB + DC
              </button>
              <button type="button" class="btn btn-sm btn-ai-accent" id="btn-rec-ai-enhance" title="${escHtml(MUSICIAN_TERMS.bwe)} + limpieza con ${escHtml(MUSICIAN_TERMS.noisePrint)}">
                ${ICONS.sparkle} ${escHtml(MUSICIAN_TERMS.bwe)}
              </button>
            </div>

            <div class="nmm-recorder-dsp-right">
              <button type="button" class="btn btn-sm btn-outline" id="btn-rec-undo-take" ${st.history.length === 0 ? 'disabled' : ''} title="Undo last edit on this take">
                ${ICONS.undo} Undo (${st.history.length})
              </button>
              <button type="button" class="btn btn-sm btn-accent" id="btn-rec-play-sel" title="Audition selected region (or full take)">
                ${ICONS.play} ${hasSelection ? 'Play Selection' : 'Play Take'}
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.drawTakeWaveform(st, mono, silences);
    this.bindWaveCanvasEvents(st, mono, silences);

    container.querySelector('#inp-rec-silence-db')?.addEventListener('change', (e) => {
      const val = parseFloat((e.target as HTMLInputElement).value);
      if (Number.isFinite(val)) {
        this.silenceThresholdDb = Math.max(-90, Math.min(-12, val));
        this.renderTakeInspector();
      }
    });

    container.querySelector('#inp-rec-denoise-db')?.addEventListener('change', (e) => {
      const val = parseFloat((e.target as HTMLInputElement).value);
      if (Number.isFinite(val)) {
        this.denoiseReductionDb = Math.max(3, Math.min(36, val));
        const lbl = container.querySelector('#lbl-rec-denoise-db');
        if (lbl) lbl.textContent = `${this.denoiseReductionDb} dB`;
      }
    });

    container
      .querySelector('#btn-rec-play-sel')
      ?.addEventListener('click', () => this.auditionSelectedRegion());
    container
      .querySelector('#btn-rec-capture-noise')
      ?.addEventListener('click', () => this.captureNoisePrintFromSelection(st.id));
    container
      .querySelector('#btn-rec-trim-silence')
      ?.addEventListener('click', () => this.applyTrimSilenceToTake(st.id));
    container
      .querySelector('#btn-rec-dsp-denoise')
      ?.addEventListener('click', () => this.applyDspDenoiseToTake(st.id));
    container
      .querySelector('#btn-rec-normalize')
      ?.addEventListener('click', () => this.applyNormalizeAndDcBlockToTake('peak', st.id));
    container
      .querySelector('#btn-rec-ai-enhance')
      ?.addEventListener('click', () => void this.applyAiEnhanceToTake(st.id));
    container
      .querySelector('#btn-rec-undo-take')
      ?.addEventListener('click', () => this.undoTakeEdit(st.id));
  }

  private drawTakeWaveform(
    st: SessionTake,
    mono: Float32Array,
    silences: SilenceRange[]
  ): void {
    const canvas = this.backdropEl?.querySelector<HTMLCanvasElement>('#rec-wave-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const midY = h / 2;
    const styles = getComputedStyle(document.documentElement);
    const bgColor = styles.getPropertyValue('--color-lcd-bg').trim() || 'transparent';
    const waveColor = styles.getPropertyValue('--color-accent').trim() || 'currentColor';
    const warnColor = styles.getPropertyValue('--color-warning').trim() || 'currentColor';
    const aiColor = styles.getPropertyValue('--color-ai').trim() || waveColor;
    const borderColor = styles.getPropertyValue('--color-panel-border-dim').trim() || 'currentColor';

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);

    // Línea central cero
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();

    if (mono.length === 0) return;

    // 1. Sombrear rangos de silencio detectados automáticamente
    ctx.fillStyle = warnColor;
    ctx.globalAlpha = 0.14;
    for (const r of silences) {
      const x0 = (r.startFrame / mono.length) * w;
      const x1 = (r.endFrame / mono.length) * w;
      ctx.fillRect(x0, 0, Math.max(2, x1 - x0), h);
    }
    ctx.globalAlpha = 1.0;

    // 2. Dibujar envolvente de onda
    ctx.strokeStyle = waveColor;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    const step = Math.max(1, Math.floor(mono.length / w));
    for (let x = 0; x < w; x++) {
      const fStart = Math.floor((x / w) * mono.length);
      const fEnd = Math.min(mono.length, fStart + step);
      let min = 0;
      let max = 0;
      for (let i = fStart; i < fEnd; i++) {
        const v = mono[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const yTop = midY - max * (midY - 4);
      const yBot = midY - min * (midY - 4);
      ctx.moveTo(x, yTop);
      ctx.lineTo(x, Math.max(yTop + 1, yBot));
    }
    ctx.stroke();

    // 3. Dibujar selección de región de ruido (Noise Print)
    if (
      st.selectionStartFrame !== null &&
      st.selectionEndFrame !== null &&
      st.selectionEndFrame > st.selectionStartFrame
    ) {
      const x0 = (st.selectionStartFrame / mono.length) * w;
      const x1 = (st.selectionEndFrame / mono.length) * w;
      ctx.fillStyle = aiColor;
      ctx.globalAlpha = 0.25;
      ctx.fillRect(x0, 0, Math.max(2, x1 - x0), h);
      ctx.globalAlpha = 1.0;

      ctx.strokeStyle = aiColor;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x0, 1, Math.max(2, x1 - x0), h - 2);
    }
  }

  private bindWaveCanvasEvents(
    st: SessionTake,
    mono: Float32Array,
    silences: SilenceRange[]
  ): void {
    const canvas = this.backdropEl?.querySelector<HTMLCanvasElement>('#rec-wave-canvas');
    if (!canvas || mono.length === 0) return;

    const frameFromEvent = (ev: MouseEvent): number => {
      const rect = canvas.getBoundingClientRect();
      const norm = Math.max(0, Math.min(1, (ev.clientX - rect.left) / Math.max(1, rect.width)));
      return Math.round(norm * mono.length);
    };

    canvas.addEventListener('mousedown', (ev) => {
      this.isDraggingSelection = true;
      this.dragAnchorFrame = frameFromEvent(ev);
      st.selectionStartFrame = this.dragAnchorFrame;
      st.selectionEndFrame = this.dragAnchorFrame;
      this.drawTakeWaveform(st, mono, silences);
    });

    canvas.addEventListener('mousemove', (ev) => {
      if (!this.isDraggingSelection) return;
      const curr = frameFromEvent(ev);
      st.selectionStartFrame = Math.min(this.dragAnchorFrame, curr);
      st.selectionEndFrame = Math.max(this.dragAnchorFrame, curr);
      this.drawTakeWaveform(st, mono, silences);
    });

    const finishDrag = (ev: MouseEvent) => {
      if (!this.isDraggingSelection) return;
      this.isDraggingSelection = false;
      const curr = frameFromEvent(ev);
      const start = Math.min(this.dragAnchorFrame, curr);
      const end = Math.max(this.dragAnchorFrame, curr);

      // Si fue un clic simple sin arrastrar (< 32 samples), si cayó sobre un silencio detectado, selecciona ese silencio
      if (end - start < 32) {
        const clickedSilence = silences.find(
          (r) => curr >= r.startFrame && curr <= r.endFrame
        );
        if (clickedSilence) {
          st.selectionStartFrame = clickedSilence.startFrame;
          st.selectionEndFrame = clickedSilence.endFrame;
        } else {
          st.selectionStartFrame = null;
          st.selectionEndFrame = null;
        }
      } else {
        st.selectionStartFrame = start;
        st.selectionEndFrame = end;
      }
      this.renderTakeInspector();
    };

    canvas.addEventListener('mouseup', finishDrag);
    canvas.addEventListener('mouseleave', (ev) => {
      if (this.isDraggingSelection) finishDrag(ev);
    });
  }

  private renderTakes(): void {
    const list = this.backdropEl?.querySelector('#rec-takes');
    const count = this.backdropEl?.querySelector('#rec-takes-count');
    if (!list) return;
    if (count) count.textContent = String(this.takes.length);
    if (this.takes.length === 0) {
      list.innerHTML = `<div class="nmm-recorder-takes-empty">No takes yet — enable the mic and press REC.</div>`;
      return;
    }
    const activeId = this.getSelectedTake()?.id ?? null;
    list.innerHTML = this.takes
      .map((t) => {
        const cls = t.take.classification === 'unknown' ? 'unclassified' : t.take.classification;
        const isSelected = t.id === activeId;
        return `
        <div class="nmm-recorder-take${isSelected ? ' is-selected' : ''}" data-take-id="${escHtml(t.id)}">
          <span class="nmm-recorder-take-name">${escHtml(t.name)}</span>
          <span class="val-pill font-mono">${t.take.durationSec.toFixed(2)}s · ${t.take.peakDbfs.toFixed(1)} dBFS · ${(t.take.sampleRate / 1000).toFixed(0)}k</span>
          <span class="panel-badge badge-ai-on">${escHtml(cls)} ${(t.take.classificationConfidence * 100).toFixed(0)}%</span>
          <span class="nmm-recorder-take-actions">
            <button type="button" class="btn btn-xs btn-outline" data-act="audition" title="Audition take">${ICONS.play}</button>
            <button type="button" class="btn btn-xs btn-outline" data-act="chopper" title="Send to Audio Chopper">${ICONS.scissors}</button>
            ${
              this.context.onInjectTakeIntoSession
                ? `<button type="button" class="btn btn-xs btn-outline" data-act="inject" title="Inject into Active Zone">${ICONS.plus}</button>`
                : ''
            }
            <button type="button" class="btn btn-xs btn-outline" data-act="download" title="Download WAV">${ICONS.download}</button>
            <button type="button" class="btn btn-xs btn-outline" data-act="delete" title="Delete take">${ICONS.trash}</button>
          </span>
        </div>`;
      })
      .join('');

    list.querySelectorAll<HTMLElement>('.nmm-recorder-take').forEach((row) => {
      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('button[data-act]')) return;
        const id = row.getAttribute('data-take-id');
        if (id) this.selectTake(id);
      });
    });

    list.querySelectorAll<HTMLButtonElement>('button[data-act]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const row = btn.closest('[data-take-id]');
        const id = row?.getAttribute('data-take-id');
        if (!id) return;
        const act = btn.getAttribute('data-act');
        if (act === 'audition') this.auditionTake(id);
        else if (act === 'chopper') this.sendTakeToChopper(id);
        else if (act === 'inject') this.injectTakeIntoSession(id);
        else if (act === 'download') this.downloadTake(id);
        else if (act === 'delete') this.deleteTake(id);
      });
    });
  }

  // ── Estado vivo: medidores + LCD + badge ──────────────────

  private setBusy(busy: boolean): void {
    this.backdropEl
      ?.querySelectorAll<HTMLButtonElement>('#btn-rec-enable-mic, #btn-rec-refresh-devices')
      .forEach((b) => {
        b.disabled = busy;
      });
  }

  private syncTransportState(): void {
    if (!this.backdropEl) return;
    const state: RecorderState = this.capture.isOpen() ? this.capture.getState() : 'idle';
    const badge = this.backdropEl.querySelector('#rec-state-badge');
    if (badge) {
      badge.textContent = STATE_BADGE[state];
      badge.className = `panel-badge ${state === 'recording' ? 'badge-ai-on' : 'badge-muted'}`;
    }
    const dot = this.backdropEl.querySelector('#rec-state-dot');
    if (dot) dot.className = `nmm-recorder-rec-dot${state === 'recording' ? ' is-rec' : ''}${state === 'paused' ? ' is-paused' : ''}`;
    const recBtn = this.backdropEl.querySelector<HTMLButtonElement>('#btn-rec-record');
    if (recBtn) {
      recBtn.disabled = !this.capture.isOpen();
      recBtn.innerHTML =
        state === 'recording'
          ? `${ICONS.pause} PAUSE`
          : state === 'paused'
            ? `${ICONS.play} RESUME`
            : `${ICONS.record} REC`;
    }
    const stopBtn = this.backdropEl.querySelector<HTMLButtonElement>('#btn-rec-stop');
    if (stopBtn) stopBtn.disabled = state !== 'recording' && state !== 'paused';
    const cancelBtn = this.backdropEl.querySelector<HTMLButtonElement>('#btn-rec-cancel');
    if (cancelBtn) cancelBtn.disabled = state !== 'recording' && state !== 'paused';
  }

  private startMeterLoop(): void {
    const tick = () => {
      if (!this.backdropEl) return;
      if (this.capture.isOpen()) {
        void this.capture.open().then((engine) => {
          if (!this.backdropEl) return;
          const levels = engine.getLevels();
          const l = this.backdropEl.querySelector<HTMLElement>('#rec-meter-l');
          const r = this.backdropEl.querySelector<HTMLElement>('#rec-meter-r');
          if (l) l.style.width = `${Math.min(100, Math.max(0, levels.peakLeft * 100)).toFixed(1)}%`;
          if (r) r.style.width = `${Math.min(100, Math.max(0, levels.peakRight * 100)).toFixed(1)}%`;
          const time = this.backdropEl.querySelector('#rec-lcd-time');
          if (time) time.textContent = formatTakeTime(engine.getRecordedSec());
          const peak = this.backdropEl.querySelector('#rec-peak-pill');
          if (peak) {
            peak.textContent =
              levels.peakDbfs === -Infinity ? '−∞ dBFS' : `${levels.peakDbfs.toFixed(1)} dBFS`;
          }
          this.syncTransportState();
        });
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }
}
