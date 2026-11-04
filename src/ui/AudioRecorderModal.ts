// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Fase 34, Fase 30 & Fase 37:
// Studio Audio Recorder, Noise/DSP Lab & Native MIDI AutoSampler
//
// Frontal del grabador sobre el núcleo portable `RecordingEngine`
// (@abdsynths/shared/dsp/take) + `AudioCaptureService` (captura de
// plataforma: getUserMedia → AudioWorklet → engine.pushSamples()),
// enriquecido con:
//   - Selector superior de modo:
//       1) Grabación Directa de Audio (Mic / Línea)
//       2) AutoSampler MIDI Integrado (Barrido Automático | Teclado MIDI en Vivo | Caja de Ritmos)
//   - Forma de onda en vivo con desplazamiento horizontal continuo y nivel de
//     zoom constante seleccionable (`2 s`, `5 s`, `10 s`, `30 s` en pantalla)
//     sin achatarse a medida que avanza la grabación, mostrando modulaciones
//     de LFO/chorus y marcas vivas `NoteOn` (verde), `NoteOff` (ámbar) y `TailEnd` (cian).
//   - Curvas de velocidad (`linear`, `high_precision`, `low_precision`,
//     `classic_neuron_2layer`, `manual_table`), gestión de colas de release
//     (`auto_decay` al suelo de ruido vs `fixed_time`), mapas de caja de ritmos
//     (`.txt`, `.json`, `.yaml` + extractor de manuales + presets de fábrica),
//     utilidad de continuar grabación interrumpida (`[Continuar desde donde se paró]`),
//     rescate no destructivo con chunk RIFF `atem`, limpieza continua previa al
//     corte y `AutoLoop` acotado estrictamente a la región sostenida (`NoteOn..NoteOff`).
// ─────────────────────────────────────────────────────────

import { ICONS } from './icons.ts';
import { escHtml } from './escape.ts';
import { isEs, onAppLocaleChange } from '../core/i18n.ts';
import { MUSICIAN_TERMS } from './preflightGateView.ts';
import { confirmDialog, toast, type ConfirmOptions } from './notify.ts';
import { resolveAiActionDeclaration } from '../core/ai/aiHonesty.ts';
import { cloudByokClient } from '../core/ai/CloudByokClient.ts';
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
  midiNoteToStandardName,
  createMidiAutoSampleManifest,
  computeVelocityLayers,
  type NoiseProfile,
  type SilenceRange,
  type NotesPerOctaveOption,
  type PilotNoteRecommendation,
} from '@abdsynths/shared/dsp/take/takeDsp.ts';
import {
  captureNoisePrintFromRegion,
  reduceNoiseWithProfile,
} from '@abdsynths/shared/dsp/take/NoiseReductionDsp.ts';
import type {
  AutoSamplerCaptureMode,
  AutoSamplerReleaseMode,
  AutoSamplerVelocityCurve,
  MidiAutoSampleManifest,
  MidiCapturedNoteEvent,
} from '@abdsynths/shared/contracts/recordingSession';
import {
  WebMidiAutoSamplerService,
  type MidiPortDescriptor,
} from '../core/midi/WebMidiAutoSamplerService.ts';
import {
  parseDrumHitMapFile,
  extractDrumMapFromManualTextDeterministic,
  FACTORY_DRUM_MAP_PRESETS,
  getDrumMapFormatSpecificationHelpText,
} from '../core/autoSampler/drumMapParser.ts';
import {
  DEFAULT_AUTOSAMPLER_CONFIG,
  applyPilotRecommendationToConfig,
  buildScheduleFromConfig,
  getPendingOrFailedEventIndices,
  appendResumedRecordingToManifest,
  LiveMidiCaptureTracker,
  processAutoSampledRecording,
  embedManifestInWavBytes,
  extractManifestFromWavBytes,
  runScheduledSweepOrchestrator,
  runPilotNoteCaptureSession,
  validateManualVelocities,
  resizeManualVelocityList,
  getMaxOctavesForStartOctave,
  enforceAutoSamplerConfigCoherence,
  type AutoSamplerConfig,
  type AutoSamplerProcessedOutput,
} from '../core/autoSampler/MidiAutoSampleSession.ts';
import type { Zone, ExtendedRegion, AiAssistanceConfig } from '../core/types.ts';

export interface AudioRecorderContext {
  getAiConfig?: () => AiAssistanceConfig | undefined;
  /**
   * Diálogo de confirmación inyectable (por defecto `confirmDialog`).
   * Permite ejercitar el flujo de consentimiento sin DOM en los tests.
   */
  confirm?: (message: string, opts?: ConfirmOptions) => Promise<boolean>;
  onAuditionPcm?: (pcm: Float32Array, sampleRate: number) => void;
  onStopAudition?: () => void;
  /** Envía un take al Chopper (deslice/destino de 34.4 y 37.6). Recibe WAV 16-bit (con chunk `atem` si es AutoSampler) + nombre. */
  onSendToChopper?: (wavBytes: ArrayBuffer, filename: string) => void;
  /** Inyecta un take directamente en la zona activa de la sesión. */
  onInjectTakeIntoSession?: (wavBytes: ArrayBuffer, filename: string) => void;
  /** Fase 37: Inyecta todas las zonas/regiones multi-velocidad generadas por el AutoSampler en la sesión. */
  onInjectAutoSampledInstrument?: (payload: {
    classicZones: Zone[];
    extendedRegions: ExtendedRegion[];
    audioBuffers: Map<string, ArrayBuffer>;
    modelName?: string;
  }) => void;
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
  /** Fase 37: Manifiesto MIDI asociado al take continuo (si se grabó con AutoSampler). */
  manifest?: MidiAutoSampleManifest;
  /** Resultado procesado más reciente (cortes + AutoLoop + zonas). */
  processedAutoSample?: AutoSamplerProcessedOutput;
}

export type RecorderOperatingMode = 'free_audio' | 'midi_autosampler';
export type LiveWaveWindowSec = 2 | 5 | 10 | 30;

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
  private readonly midi = new WebMidiAutoSamplerService();
  private readonly context: AudioRecorderContext;

  private devices: MediaDeviceInfo[] = [];
  private selectedDeviceId = '';
  private takes: SessionTake[] = [];
  private selectedTakeId: string | null = null;
  private takeSeq = 0;
  private rafId = 0;
  private opening = false;

  // Configuraciones interactivas de detección de ruido, normalización y denoise (3 modos)
  private silenceThresholdDb = -48;
  private minSilenceMs = 120;
  private denoiseReductionDb = 14;
  private autoNormalizeOnFinish = false;
  private autoDetectNoiseOnFinish = true;
  private denoiseMode: 'algorithmic' | 'noise_print' | 'ai' = 'noise_print';
  private isDraggingSelection = false;
  private dragAnchorFrame = 0;

  // Fase 37: Modo de operación, ventana de zoom constante en vivo y AutoSampler
  private operatingMode: RecorderOperatingMode = 'free_audio';
  private liveWindowSec: LiveWaveWindowSec = 5;
  private autoSamplerConfig: AutoSamplerConfig = {
    ...DEFAULT_AUTOSAMPLER_CONFIG,
    manualVelocities: [...DEFAULT_AUTOSAMPLER_CONFIG.manualVelocities],
  };
  private midiOutputs: MidiPortDescriptor[] = [];
  private midiInputs: MidiPortDescriptor[] = [];
  private activeSchedule: MidiCapturedNoteEvent[] = [];
  private isSweepRunning = false;
  private sweepAbortRequested = false;
  private liveTracker: LiveMidiCaptureTracker | null = null;
  private liveMidiUnsub: (() => void) | null = null;
  private liveMarkers: Array<{ frame: number; kind: 'noteOn' | 'noteOff' | 'tailEnd'; label: string }> = [];
  private showDrumHelpPanel = false;
  private showManualExtractorPanel = false;
  private pilotDiagnosticText = '';
  private lastPilotRecommendation: PilotNoteRecommendation | null = null;

  constructor(context: AudioRecorderContext = {}) {
    this.context = context;
    this.activeSchedule = buildScheduleFromConfig(this.autoSamplerConfig);
    onAppLocaleChange(() => {
      if (this.backdropEl) {
        this.render();
      }
    });
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

  public getOperatingMode(): RecorderOperatingMode {
    return this.operatingMode;
  }

  public setOperatingMode(mode: RecorderOperatingMode): void {
    this.operatingMode = mode;
    if (this.backdropEl) {
      this.render();
    }
  }

  public getAutoSamplerConfig(): Readonly<AutoSamplerConfig> {
    return this.autoSamplerConfig;
  }

  /** Permite inyectar un take sintético o importado (útil para tests y flujo directo). */
  public addExternalTake(
    take: FinalizedTake,
    customName?: string,
    manifest?: MidiAutoSampleManifest
  ): SessionTake {
    return this.finishTake(take, customName, manifest);
  }

  public open(initialMode?: RecorderOperatingMode): void {
    if (initialMode) {
      this.operatingMode = initialMode;
    }
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
    if (this.operatingMode === 'midi_autosampler') {
      void this.refreshMidiPorts();
    }
    this.startMeterLoop();
  }

  public async close(): Promise<void> {
    if (!this.backdropEl) return;
    this.sweepAbortRequested = true;
    this.midi.sendAllNotesOff();
    this.liveMidiUnsub?.();
    this.liveMidiUnsub = null;
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

  // ── Dispositivos Audio y WebMIDI ──────────────────────────

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

  private async refreshMidiPorts(): Promise<void> {
    const status = await this.midi.requestAccess();
    this.midiOutputs = status.outputs;
    this.midiInputs = status.inputs;
    const outSel = this.backdropEl?.querySelector<HTMLSelectElement>('#as-midi-out');
    const inSel = this.backdropEl?.querySelector<HTMLSelectElement>('#as-midi-in');
    if (outSel) {
      outSel.innerHTML =
        this.midiOutputs.length === 0
          ? `<option value="">No WebMIDI Out port detected</option>`
          : this.midiOutputs
              .map((p) => `<option value="${escHtml(p.id)}">${escHtml(p.name)}</option>`)
              .join('');
      const selOut = this.midi.getSelectedOutputId();
      if (selOut) outSel.value = selOut;
    }
    if (inSel) {
      inSel.innerHTML =
        this.midiInputs.length === 0
          ? `<option value="">No WebMIDI In port detected</option>`
          : this.midiInputs
              .map((p) => `<option value="${escHtml(p.id)}">${escHtml(p.name)}</option>`)
              .join('');
      const selIn = this.midi.getSelectedInputId();
      if (selIn) inSel.value = selIn;
    }
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
        trimSilence: false,
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

  // ── Transporte (Audio Libre + AutoSampler MIDI) ───────────

  private async toggleRecord(): Promise<void> {
    if (this.operatingMode === 'midi_autosampler') {
      if (this.autoSamplerConfig.mode === 'live_midi_capture') {
        await this.toggleLiveMidiCapture();
      } else {
        if (this.isSweepRunning) {
          this.sweepAbortRequested = true;
          this.midi.sendAllNotesOff();
        } else {
          await this.runAutoSamplerSweep();
        }
      }
      return;
    }

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
      this.liveMarkers = [];
      engine.startRecording();
    } else if (state === 'recording') {
      engine.pauseRecording();
    } else if (state === 'paused') {
      engine.resumeRecording();
    }
    this.renderTransport();
  }

  private stopAndKeep(): void {
    if (this.isSweepRunning) {
      this.sweepAbortRequested = true;
      this.midi.sendAllNotesOff();
      return;
    }
    if (!this.capture.isOpen()) return;
    void this.capture.open().then((engine) => {
      if (engine.getState() === 'recording' || engine.getState() === 'paused') {
        const rawTake = engine.stopRecording();
        let manifest: MidiAutoSampleManifest | undefined;
        if (
          this.operatingMode === 'midi_autosampler' &&
          this.autoSamplerConfig.mode === 'live_midi_capture' &&
          this.liveTracker
        ) {
          const totalFrames = rawTake.samples[0]?.length ?? 0;
          manifest = this.liveTracker.finalizeManifest(
            totalFrames,
            'Live MIDI Keyboard Capture',
            this.autoSamplerConfig.extendToFullKeybed
          );
          this.liveTracker = null;
          this.liveMidiUnsub?.();
          this.liveMidiUnsub = null;
        }
        this.finishTake(rawTake, undefined, manifest);
      }
      this.renderTransport();
    });
  }

  private cancelAndDiscard(): void {
    this.sweepAbortRequested = true;
    this.midi.sendAllNotesOff();
    this.liveMidiUnsub?.();
    this.liveMidiUnsub = null;
    this.liveTracker = null;
    if (!this.capture.isOpen()) return;
    void this.capture.open().then((engine) => {
      if (engine.getState() === 'recording' || engine.getState() === 'paused') {
        engine.cancelTake();
        toast('Take discarded.', 'info');
      }
      this.renderTransport();
    });
  }

  // ── Fase 37: Calibración / Nota Piloto y Barrido MIDI ─────

  private async runPilotCalibration(): Promise<void> {
    await this.refreshMidiPorts();
    const jitter = await this.midi.runMidiJitterSmokeTest(35, this.autoSamplerConfig.midiChannel);
    let engine;
    try {
      engine = await this.capture.open({
        ...(this.selectedDeviceId ? { deviceId: this.selectedDeviceId } : {}),
        trimSilence: false,
        attachNoiseProfile: true,
        autoClassify: true,
      });
    } catch {
      this.pilotDiagnosticText = `${jitter.details}. Enable audio input to measure round-trip latency.`;
      this.renderAutoSamplerDeck();
      return;
    }

    if (engine.getState() !== 'monitoring') {
      toast('Stop current recording before running Pilot Note Calibration.', 'warning');
      return;
    }

    const diag = await runPilotNoteCaptureSession({
      engine,
      midi: this.midi,
      mixToMono,
      midiNote: 60,
      velocity: 100,
    });

    this.lastPilotRecommendation = diag;
    // Apply measured RTL immediately so subsequent sweeps and re-slices compensate it automatically
    this.autoSamplerConfig = applyPilotRecommendationToConfig(this.autoSamplerConfig, diag, {
      applyEnvelopeAndVelocity: false,
    });

    this.pilotDiagnosticText = `${isEs() ? 'RTL aplicada' : 'Applied RTL'}: ${diag.latencyMs.toFixed(1)} ms (${diag.latencySamples} smp) · Peak: ${diag.peakDbfs.toFixed(1)} dBFS · Floor: ${diag.noiseFloorDbfs.toFixed(1)} dBFS · Jitter: ${jitter.avgJitterMs.toFixed(2)} ms · Rec: Gate ${diag.recommendedGateDurationMs} ms / Release ${diag.recommendedMaxReleaseMs} ms`;
    this.renderAutoSamplerDeck();

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
      this.autoSamplerConfig = applyPilotRecommendationToConfig(this.autoSamplerConfig, diag, {
        applyEnvelopeAndVelocity: true,
      });
      this.activeSchedule = buildScheduleFromConfig(this.autoSamplerConfig);
      toast(`Pilot Calibration applied: RTL ${diag.latencyMs.toFixed(1)} ms, Gate ${diag.recommendedGateDurationMs} ms, Release ${diag.recommendedMaxReleaseMs} ms.`, 'success');
    } else {
      toast(`RTL ${diag.latencyMs.toFixed(1)} ms (${diag.latencySamples} smp) applied automatically.`, 'info');
    }

    const selectedTake = this.getSelectedTake();
    if (selectedTake?.manifest) {
      selectedTake.manifest.latencySamples = diag.latencySamples;
      this.runAutoSamplerPostProcessOnTake(selectedTake);
      this.renderTakes();
      this.renderTakeInspector();
    }
    this.renderAutoSamplerDeck();
  }

  private async toggleLiveMidiCapture(): Promise<void> {
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

    if (engine.getState() === 'recording') {
      this.stopAndKeep();
      return;
    }

    await this.refreshMidiPorts();
    const sr = engine.getSampleRate();
    this.liveTracker = new LiveMidiCaptureTracker(sr, this.autoSamplerConfig.maxReleaseMs);
    this.liveMarkers = [];

    this.liveMidiUnsub?.();
    this.liveMidiUnsub = this.midi.onInputMessage((msg) => {
      if (!this.liveTracker) return;
      const currFrame = Math.round(engine.getRecordedSec() * sr);
      if (msg.type === 'noteon') {
        this.liveTracker.onNoteOn(msg.note, msg.velocity, currFrame);
        this.liveMarkers.push({
          frame: currFrame,
          kind: 'noteOn',
          label: `${midiNoteToStandardName(msg.note)} v${msg.velocity}`,
        });
      } else if (msg.type === 'noteoff') {
        this.liveTracker.onNoteOff(msg.note, currFrame);
        this.liveMarkers.push({
          frame: currFrame,
          kind: 'noteOff',
          label: 'Off',
        });
      }
      this.renderAutoSamplerGrid();
    });

    engine.startRecording();
    toast('Live MIDI Capture active: play your MIDI keyboard and press Stop when finished.', 'info');
    this.renderTransport();
  }

  /**
   * Ejecuta el barrido automático (completo, continuación de celdas pendientes o
   * re-grabación de una única celda de la cuadrícula).
   */
  public async runAutoSamplerSweep(options?: {
    resumeTakeId?: string;
    specificCellIndex?: number;
  }): Promise<SessionTake | null> {
    if (this.isSweepRunning) return null;

    if (this.autoSamplerConfig.velocityCurve === 'manual_table') {
      const velVal = validateManualVelocities(this.autoSamplerConfig.manualVelocities);
      if (!velVal.valid) {
        toast(velVal.errorMessage ?? 'Corrige las velocidades manuales antes de iniciar el barrido.', 'warning');
        return null;
      }
    }

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
      return null;
    }

    const existingTake = options?.resumeTakeId
      ? this.takes.find((t) => t.id === options.resumeTakeId)
      : undefined;

    if (!existingTake) {
      this.activeSchedule = buildScheduleFromConfig(this.autoSamplerConfig);
    } else if (existingTake.manifest) {
      this.activeSchedule = existingTake.manifest.events.map((ev) => ({ ...ev }));
    }

    const tempManifest = createMidiAutoSampleManifest({
      name: existingTake?.name ?? 'AutoSampler Session',
      mode: this.autoSamplerConfig.mode,
      sampleRate: engine.getSampleRate(),
      events: this.activeSchedule,
    });

    const targetIndices = getPendingOrFailedEventIndices(tempManifest, options?.specificCellIndex);
    if (targetIndices.length === 0) {
      toast('All scheduled cells are already recorded.', 'info');
      return existingTake ?? null;
    }

    this.isSweepRunning = true;
    this.sweepAbortRequested = false;
    this.liveMarkers = [];
    this.renderTransport();
    this.renderAutoSamplerGrid();

    let sweepRes;
    try {
      sweepRes = await runScheduledSweepOrchestrator({
        schedule: this.activeSchedule,
        targetIndices,
        config: this.autoSamplerConfig,
        engine,
        midi: this.midi,
        mixToMono,
        isAborted: () => this.sweepAbortRequested || !this.backdropEl,
        onMarker: (m) => {
          this.liveMarkers.push(m);
        },
        onProgress: () => {
          this.renderAutoSamplerGrid();
        },
      });
    } finally {
      this.isSweepRunning = false;
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
      this.pushUndoSnapshot(existingTake);
      existingTake.manifest = updatedManifest;
      this.rebuildTakeFromChannels(
        existingTake,
        [mergedPcm],
        existingTake.take.sampleRate,
        normalizeNoiseProfile(existingTake.take.noiseProfile)
      );
      this.runAutoSamplerPostProcessOnTake(existingTake);
      this.renderTakes();
      this.renderTakeInspector();
      this.renderAutoSamplerDeck();
      return existingTake;
    }

    const finalManifest = createMidiAutoSampleManifest({
      name:
        this.autoSamplerConfig.mode === 'drum_map' && this.autoSamplerConfig.drumMap
          ? this.autoSamplerConfig.drumMap.kitName
          : 'AutoSampler Sweep',
      mode: this.autoSamplerConfig.mode,
      sampleRate: rawTake.sampleRate,
      channel: this.autoSamplerConfig.midiChannel,
      latencySamples: measuredLatencySamples,
      velocityCurve: this.autoSamplerConfig.velocityCurve,
      releaseMode: this.autoSamplerConfig.releaseMode,
      gateDurationMs: this.autoSamplerConfig.gateDurationMs,
      maxReleaseMs: this.autoSamplerConfig.maxReleaseMs,
      noiseProfile: normalizeNoiseProfile(capturedPreRollProfile ?? rawTake.noiseProfile),
      events: this.activeSchedule.map((ev) => ({ ...ev })),
    });

    const created = this.finishTake(
      rawTake,
      finalManifest.name,
      finalManifest
    );
    this.renderAutoSamplerDeck();
    return created;
  }

  public runAutoSamplerPostProcessOnTake(st: SessionTake): AutoSamplerProcessedOutput | null {
    if (!st.manifest) return null;
    const mono = mixToMono(st.take);
    if (mono.length === 0) return null;

    const processed = processAutoSampledRecording(mono, st.manifest, this.autoSamplerConfig);
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

  public finishTake(
    rawTake: FinalizedTake,
    customName?: string,
    explicitManifest?: MidiAutoSampleManifest
  ): SessionTake {
    this.takeSeq += 1;
    const name = customName || `Take ${String(this.takeSeq).padStart(2, '0')}`;
    const mono = mixToMono(rawTake);

    // Si el WAV ya trae un manifiesto `atem` incrustado, lo recuperamos
    let manifest = explicitManifest;
    if (!manifest && rawTake.wav && rawTake.wav.byteLength > 44) {
      const buf = rawTake.wav.buffer.slice(
        rawTake.wav.byteOffset,
        rawTake.wav.byteOffset + rawTake.wav.byteLength
      ) as ArrayBuffer;
      manifest = extractManifestFromWavBytes(buf) ?? undefined;
    }

    let classification = rawTake.classification;
    let classificationConfidence = rawTake.classificationConfidence;
    if (classification === 'unknown' && mono.length >= 64) {
      const feats = extractTakeFeatures(mono, rawTake.sampleRate);
      const cls = classifyTake(feats);
      classification = cls.kind;
      classificationConfidence = cls.confidence;
    }

    let noiseProfile = normalizeNoiseProfile(rawTake.noiseProfile ?? manifest?.noiseProfile);
    let selStart: number | null = null;
    let selEnd: number | null = null;
    let noiseRegionLabel: string | undefined;

    if (mono.length > 0 && this.autoDetectNoiseOnFinish) {
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
        if (!noiseProfile) {
          noiseProfile = captureNoisePrintFromRegion(mono, rawTake.sampleRate, {
            startFrame: best.startFrame,
            endFrame: best.endFrame,
          });
        }
        noiseRegionLabel = `Auto-Detected Floor (${((best.startFrame / rawTake.sampleRate) * 1000).toFixed(0)}..${((best.endFrame / rawTake.sampleRate) * 1000).toFixed(0)} ms)`;
      } else if (!noiseProfile) {
        const head = Math.min(mono.length, Math.max(1, Math.round(rawTake.sampleRate * 0.25)));
        noiseProfile = computeNoiseProfile(mono.subarray(0, head), rawTake.sampleRate);
        noiseRegionLabel = `Head Floor (0..${((head / rawTake.sampleRate) * 1000).toFixed(0)} ms)`;
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
      ...(manifest ? { manifest } : {}),
    };

    if (this.autoNormalizeOnFinish && mono.length > 0) {
      const normChannels = entry.take.samples.map((ch) =>
        normalizePeak(dcBlock(ch, entry.take.sampleRate), -1.0)
      );
      this.rebuildTakeFromChannels(entry, normChannels, entry.take.sampleRate, noiseProfile);
    }

    if (entry.manifest) {
      this.runAutoSamplerPostProcessOnTake(entry);
    }

    this.takes.unshift(entry);
    this.selectedTakeId = entry.id;

    const clsLabel =
      enrichedTake.classification === 'unknown' ? 'unclassified' : enrichedTake.classification;
    const classPill = this.backdropEl?.querySelector('#rec-class-pill');
    if (classPill) {
      classPill.textContent = `${clsLabel} ${(enrichedTake.classificationConfidence * 100).toFixed(0)}%`;
    }

    toast(
      `${name} kept: ${enrichedTake.durationSec.toFixed(2)}s, peak ${enrichedTake.peakDbfs.toFixed(1)} dBFS${entry.processedAutoSample ? ` (${entry.processedAutoSample.slicerResult.slices.length} MIDI slices)` : ''}.`,
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

    let wavBytes = encodeWav16(validChannels, sampleRate);
    if (st.manifest) {
      const rawBuf = wavBytes.buffer.slice(
        wavBytes.byteOffset,
        wavBytes.byteOffset + wavBytes.byteLength
      ) as ArrayBuffer;
      wavBytes = embedManifestInWavBytes(rawBuf, st.manifest);
    }

    st.take = {
      durationSec: validChannels[0].length / sampleRate,
      sampleRate,
      channels: validChannels.length,
      peakDbfs: toDbfs(peak),
      classification: cls.kind,
      classificationConfidence: cls.confidence,
      ...(noiseProfile ? { noiseProfile } : {}),
      samples: validChannels,
      wav: wavBytes,
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

  /**
   * Denoise Algorítmico: estima automáticamente el suelo estacionario del take
   * encontrando la ventana de menor energía (sin depender de huella previa) y aplica
   * filtro DC Block + puerta espectral multibanda + filtro notch de red 50/60 Hz.
   */
  public applyAlgorithmicDenoiseToTake(takeId?: string): boolean {
    const st = takeId ? this.takes.find((t) => t.id === takeId) : this.getSelectedTake();
    if (!st) return false;
    const mono = mixToMono(st.take);
    if (mono.length === 0) return false;

    const sr = st.take.sampleRate;
    const winFrames = Math.min(mono.length, Math.max(256, Math.round(sr * 0.12)));
    const hopFrames = Math.max(128, Math.floor(winFrames / 2));
    let minRms = Infinity;
    let bestStart = 0;

    for (let start = 0; start + winFrames <= mono.length; start += hopFrames) {
      let sumSq = 0;
      for (let i = start; i < start + winFrames; i++) {
        const v = mono[i];
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / winFrames);
      if (rms < minRms) {
        minRms = rms;
        bestStart = start;
      }
    }

    const algoProfile = computeNoiseProfile(
      mono.subarray(bestStart, Math.min(mono.length, bestStart + winFrames)),
      sr
    );

    this.pushUndoSnapshot(st);
    const denoisedChannels = st.take.samples.map((ch) => {
      const dcCleaned = dcBlock(ch, sr);
      return reduceNoiseWithProfile(dcCleaned, sr, algoProfile, {
        reductionDb: this.denoiseReductionDb,
        removeHum: true,
      });
    });

    this.rebuildTakeFromChannels(st, denoisedChannels, sr, normalizeNoiseProfile(st.take.noiseProfile));
    if (st.manifest) {
      this.runAutoSamplerPostProcessOnTake(st);
    }
    toast(
      `Applied Algorithmic Denoise (-${this.denoiseReductionDb} dB + DC Block + 50/60Hz Hum Notch, floor ${algoProfile.levelDbfs.toFixed(1)} dBFS).`,
      'success'
    );
    this.renderTakes();
    this.renderTakeInspector();
    return true;
  }

  public applyDspDenoiseToTake(takeId?: string): boolean {
    const st = takeId ? this.takes.find((t) => t.id === takeId) : this.getSelectedTake();
    if (!st) return false;

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
    if (st.manifest) {
      this.runAutoSamplerPostProcessOnTake(st);
    }
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
    if (st.manifest) {
      this.runAutoSamplerPostProcessOnTake(st);
    }
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

  private getAiDenoiseActionContext() {
    const aiConfig = this.context.getAiConfig?.();
    const byokCfg = cloudByokClient.getConfig();
    const llmProvider = cloudByokClient.getFirstAvailableTextProvider();
    const isCloudReady = Boolean(
      byokCfg.enabled && (llmProvider || cloudByokClient.hasValidKey(byokCfg.provider))
    );
    return {
      isBridgeConnected: bridgeClient.isConnected(),
      isCloudReady,
      activeTextLlmProvider: llmProvider,
      aiConfig,
    };
  }

  public async applyAiEnhanceToTake(takeId?: string): Promise<boolean> {
    const st = takeId ? this.takes.find((t) => t.id === takeId) : this.getSelectedTake();
    if (!st) return false;

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

    if (!bridgeClient.isConnected()) {
      await bridgeClient.checkHealth();
    }

    const aiCtx = this.getAiDenoiseActionContext();
    const aiDecl = resolveAiActionDeclaration('recorder-ai-denoise', aiCtx);

    if (aiDecl.requiresFallbackConsent) {
      const accepted = await (this.context.confirm ?? confirmDialog)(aiDecl.consentMessage, {
        title: aiDecl.consentTitle,
        confirmLabel: aiDecl.consentConfirmLabel,
        cancelLabel: 'Cancelar',
      });
      if (!accepted) {
        return false;
      }
      toast(
        `Aplicando ${aiDecl.fallbackEngine} (confirmado por el usuario)...`,
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
        `Aplicando Denoise IA (${aiDecl.primaryEngine}) sobre "${st.name}"...`,
        'info'
      );

      let effectiveReductionDb = this.denoiseReductionDb;
      if (aiCtx.activeTextLlmProvider && noiseProfile) {
        try {
          const llmRes = await cloudByokClient.generateText(
            `Audio take noise floor is ${noiseProfile.levelDbfs.toFixed(1)} dBFS, 50Hz hum ${noiseProfile.hum50HzDb.toFixed(1)} dB, 60Hz hum ${noiseProfile.hum60HzDb.toFixed(1)} dB. Return ONLY an integer between 6 and 28 for optimal spectral subtraction reduction dB without musical artifacts.`,
            { provider: aiCtx.activeTextLlmProvider, maxTokens: 16, temperature: 0.1 }
          );
          const parsedDb = parseInt(llmRes.text.replace(/[^0-9]/g, ''), 10);
          if (Number.isFinite(parsedDb) && parsedDb >= 6 && parsedDb <= 28) {
            effectiveReductionDb = parsedDb;
            this.denoiseReductionDb = parsedDb;
          }
        } catch {
          // keep user reduction dB if cloud call fails
        }
      }

      let inputChannels = st.take.samples;
      if (noiseProfile) {
        inputChannels = inputChannels.map((ch) =>
          reduceNoiseWithProfile(dcBlock(ch, st.take.sampleRate), st.take.sampleRate, noiseProfile, {
            reductionDb: effectiveReductionDb,
            removeHum: true,
          })
        );
      }

      if (bridgeClient.isConnected()) {
        const preCleanedWav = encodeWav16(inputChannels, st.take.sampleRate);
        const want96k = Boolean(aiCtx.aiConfig?.enabled && aiCtx.aiConfig?.masterWave === 'ai');
        const enhancedWavBytes = await bridgeClient.enhanceAudio(preCleanedWav, {
          targetSampleRate: want96k ? 96000 : st.take.sampleRate,
          capabilities: want96k
            ? ['spectral-denoise', 'deepfilter', 'resample-96k', 'harmonic-bwe']
            : ['spectral-denoise', 'deepfilter'],
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
          `Denoise IA completado sobre "${st.name}" (DeepFilterNet 3 · -${effectiveReductionDb} dB)!`,
          'success'
        );
      } else {
        // Cloud LLM calibrated adaptive spectral denoise
        this.pushUndoSnapshot(st);
        st.selectionStartFrame = null;
        st.selectionEndFrame = null;
        this.rebuildTakeFromChannels(st, inputChannels, st.take.sampleRate, noiseProfile);
        toast(
          `Denoise IA (${aiCtx.activeTextLlmProvider?.toUpperCase() || 'Cloud'} · -${effectiveReductionDb} dB) completado sobre "${st.name}"!`,
          'success'
        );
      }
      this.renderTakes();
      this.renderTakeInspector();
      return true;
    } catch (err) {
      toast(
        `Denoise IA error: ${err instanceof Error ? err.message : String(err)}`,
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
    const found = this.getSelectedTake();
    if (found?.manifest) {
      this.activeSchedule = found.manifest.events.map((ev) => ({ ...ev }));
    }
    this.renderTakes();
    this.renderTakeInspector();
    if (this.operatingMode === 'midi_autosampler') {
      this.renderAutoSamplerGrid();
    }
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
    if (found.manifest) {
      this.runAutoSamplerPostProcessOnTake(found);
    }
    const wavBuf = found.take.wav.buffer.slice(
      found.take.wav.byteOffset,
      found.take.wav.byteOffset + found.take.wav.byteLength
    ) as ArrayBuffer;
    this.context.onSendToChopper(wavBuf, `${found.name}.wav`);
  }

  private injectTakeIntoSession(id: string): void {
    const found = this.takes.find((t) => t.id === id);
    if (!found) return;
    if (found.manifest && this.context.onInjectAutoSampledInstrument) {
      const processed = found.processedAutoSample ?? this.runAutoSamplerPostProcessOnTake(found);
      if (processed && processed.extendedRegions.length > 0) {
        this.context.onInjectAutoSampledInstrument({
          classicZones: processed.classicZones,
          extendedRegions: processed.extendedRegions,
          audioBuffers: processed.audioBuffers,
          modelName: found.manifest.name,
        });
        return;
      }
    }
    if (!this.context.onInjectTakeIntoSession) return;
    const wavBuf = found.take.wav.buffer.slice(
      found.take.wav.byteOffset,
      found.take.wav.byteOffset + found.take.wav.byteLength
    ) as ArrayBuffer;
    this.context.onInjectTakeIntoSession(wavBuf, `${found.name}.wav`);
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

  // ── Render Principal ──────────────────────────────────────

  private render(): void {
    if (!this.backdropEl) return;
    const isAutoSampler = this.operatingMode === 'midi_autosampler';
    const es = isEs();

    this.backdropEl.innerHTML = `
      <div class="nmm-modal-window nmm-audio-modal-window" role="dialog" aria-modal="true" aria-labelledby="recorder-title" tabindex="-1">
        <header class="nmm-modal-header">
          <div class="nmm-modal-header-title">
            <span class="nmm-modal-header-icon">${isAutoSampler ? ICONS.piano : ICONS.mic}</span>
            <span class="nmm-recorder-rec-dot" id="rec-state-dot" aria-hidden="true"></span>
            <h2 id="recorder-title">${es ? 'Grabar — Grabadora de Audio y AutoSampler MIDI' : 'Record — Audio Recorder &amp; MIDI AutoSampler'}</h2>
            <span class="panel-badge badge-muted" id="rec-state-badge">IDLE</span>
          </div>
          <button type="button" class="nmm-modal-close" aria-label="${es ? 'Cerrar' : 'Close'}" id="btn-recorder-close">${ICONS.close}</button>
        </header>

        <div class="nmm-modal-body nmm-audio-modal-body">
          <!-- 1. Studio Input, Mode Selector, LCD, Meters & Transport Deck Card -->
          <div class="nmm-recorder-deck-card">
            <!-- Selector Superior de Modo (Sin islas visuales) -->
            <div class="nmm-recorder-mode-bar">
              <div class="nmm-recorder-mode-pills" role="tablist" aria-label="${es ? 'Modo operativo de grabación' : 'Recorder operating mode'}">
                <span class="nmm-recorder-device-label">${es ? 'FLUJO:' : 'WORKFLOW:'}</span>
                <button type="button" class="btn btn-xs ${!isAutoSampler ? 'btn-accent' : 'btn-outline'}" id="btn-mode-free-audio">
                  ${ICONS.mic} ${es ? 'Grabación Directa de Audio' : 'Direct Audio Recording'}
                </button>
                <button type="button" class="btn btn-xs ${isAutoSampler && this.autoSamplerConfig.mode === 'auto_sweep' ? 'btn-accent' : 'btn-outline'}" id="btn-mode-as-sweep">
                  ${ICONS.piano} ${es ? 'AutoSampler MIDI (Barrido)' : 'MIDI AutoSampler (Sweep)'}
                </button>
                <button type="button" class="btn btn-xs ${isAutoSampler && this.autoSamplerConfig.mode === 'live_midi_capture' ? 'btn-accent' : 'btn-outline'}" id="btn-mode-as-live">
                  ${ICONS.wave} ${es ? 'Captura MIDI en Tiempo Real' : 'Real-Time MIDI Capture'}
                </button>
                <button type="button" class="btn btn-xs ${isAutoSampler && this.autoSamplerConfig.mode === 'drum_map' ? 'btn-accent' : 'btn-outline'}" id="btn-mode-as-drum">
                  ${ICONS.drum} ${es ? 'Muestreo de Batería / Percusión' : 'Drum / Percussion Sampling'}
                </button>
              </div>
            </div>

            <div class="nmm-recorder-devicebar">
              <div class="nmm-recorder-device-left">
                <label class="nmm-recorder-device-label" for="rec-device">${es ? 'ENTRADA AUDIO:' : 'AUDIO IN:'}</label>
                <select id="rec-device" class="form-control form-control-sm nmm-recorder-device-select" aria-label="${es ? 'Dispositivo de entrada' : 'Input device'}"></select>
                <button type="button" class="btn btn-xs btn-outline" id="btn-rec-refresh-devices" title="${es ? 'Actualizar dispositivos de entrada' : 'Refresh input devices'}">${ICONS.refresh} ${es ? 'Reescanear' : 'Rescan'}</button>
                <button type="button" class="btn btn-xs btn-outline" id="btn-rec-enable-mic">${ICONS.mic} ${es ? 'Activar Audio' : 'Enable Audio'}</button>
              </div>
              <div class="nmm-recorder-device-right">
                <span class="val-pill font-mono" id="rec-peak-pill">−∞ dBFS</span>
                <span class="val-pill font-mono" id="rec-class-pill">${es ? 'sin tomas aún' : 'no take yet'}</span>
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

          <!-- 1B. Panel Paramétrico Nativo del AutoSampler MIDI (solo activo en modo AutoSampler) -->
          <div id="rec-autosampler-deck-slot"></div>

          <!-- 2 & 3. Waveform Viewport Panel + Noise Gate & DSP/AI Restoration Card -->
          <div class="nmm-recorder-inspector" id="rec-take-inspector"></div>

          <!-- 4. Session Takes Table / List Panel -->
          <div class="nmm-audio-table-panel">
            <div class="nmm-recorder-takes-head">
              <div class="nmm-recorder-takes-head-left">
                <span>${es ? 'TOMAS DE SESIÓN' : 'SESSION TAKES'}</span>
                <span class="val-pill font-mono" id="rec-takes-count">0</span>
              </div>
              <span class="nmm-recorder-takes-hint">${es ? 'Selecciona una toma para inspeccionar forma de onda, capturar Huella de Ruido, rescatar cortes o enviar a Chopper / Sesión' : 'Select a take to inspect waveform, capture Noise Print, rescue cuts, or send to Chopper / Session'}</span>
            </div>
            <div class="nmm-recorder-takes" id="rec-takes"></div>
          </div>
        </div>

        <footer class="nmm-modal-footer">
          <div class="footer-left">
            <button type="button" class="btn btn-ghost" id="btn-recorder-footer-close">${es ? 'Cerrar' : 'Close'}</button>
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

    // Cambio de modo operativo
    this.backdropEl.querySelector('#btn-mode-free-audio')?.addEventListener('click', () => {
      this.operatingMode = 'free_audio';
      this.render();
      void this.refreshDevices();
    });
    const setAsSubMode = (subMode: AutoSamplerCaptureMode) => {
      this.operatingMode = 'midi_autosampler';
      this.autoSamplerConfig.mode = subMode;
      if (subMode === 'drum_map' && !this.autoSamplerConfig.drumMap) {
        this.autoSamplerConfig.drumMap = FACTORY_DRUM_MAP_PRESETS.tr808_909;
      }
      this.activeSchedule = buildScheduleFromConfig(this.autoSamplerConfig);
      this.render();
      void this.refreshDevices();
      void this.refreshMidiPorts();
    };
    this.backdropEl
      .querySelector('#btn-mode-as-sweep')
      ?.addEventListener('click', () => setAsSubMode('auto_sweep'));
    this.backdropEl
      .querySelector('#btn-mode-as-live')
      ?.addEventListener('click', () => setAsSubMode('live_midi_capture'));
    this.backdropEl
      .querySelector('#btn-mode-as-drum')
      ?.addEventListener('click', () => setAsSubMode('drum_map'));

    this.renderTransport();
    this.renderAutoSamplerDeck();
    this.renderTakes();
    this.renderTakeInspector();
  }

  private renderAutoSamplerDeck(): void {
    const slot = this.backdropEl?.querySelector<HTMLElement>('#rec-autosampler-deck-slot');
    if (!slot) return;
    if (this.operatingMode !== 'midi_autosampler') {
      slot.innerHTML = '';
      return;
    }

    const cfg = this.autoSamplerConfig;
    const isLive = cfg.mode === 'live_midi_capture';
    const isDrum = cfg.mode === 'drum_map';
    const selectedTake = this.getSelectedTake();
    const pendingCount = this.activeSchedule.filter(
      (e) => e.status === 'pending' || e.status === 'failed'
    ).length;
    const recordedCount = this.activeSchedule.filter((e) => e.status === 'recorded').length;
    const canResume =
      !isLive &&
      recordedCount > 0 &&
      pendingCount > 0 &&
      !this.isSweepRunning;

    const maxOctaves = getMaxOctavesForStartOctave(cfg.startOctave);
    const velValidation = validateManualVelocities(cfg.manualVelocities);
    const invalidVelIndices = new Set<number>([
      ...velValidation.duplicateIndices,
      ...velValidation.outOfRangeIndices,
    ]);
    const displayLayers = computeVelocityLayers({
      layerCount: cfg.velocityLayers,
      curve: cfg.velocityCurve,
      manualVelocities:
        cfg.velocityCurve === 'manual_table'
          ? velValidation.valid
            ? cfg.manualVelocities
            : velValidation.sanitizedVelocities
          : undefined,
    });
    const es = isEs();
    const curveSummaryPill =
      cfg.velocityLayers === 1 && cfg.velocityCurve !== 'manual_table'
        ? es
          ? `1L · Capa Única (v127)`
          : `1L · Single Layer (v127)`
        : `${cfg.velocityLayers}L · ${cfg.velocityCurve}`;

    slot.innerHTML = `
      <div class="nmm-audio-controls-card" id="as-config-card">
        <div class="nmm-recorder-inspector-head">
          <span class="nmm-recorder-inspector-title">
            ${isDrum ? ICONS.drum : ICONS.piano}
            ${
              isLive
                ? es
                  ? 'CAPTURA MIDI EN TIEMPO REAL (AUDIO + REGISTRO MIDI)'
                  : 'REAL-TIME MIDI PERFORMANCE CAPTURE (AUDIO + MIDI LOG)'
                : isDrum
                  ? es
                    ? 'AUTOSAMPLER DE PERCUSIÓN Y BATERÍA'
                    : 'PERCUSSION & DRUM KIT AUTOSAMPLER'
                  : es
                    ? 'BARRIDO PARAMÉTRICO DE AUTOSAMPLER MIDI'
                    : 'PARAMETRIC MIDI AUTOSAMPLER SWEEP'
            }
          </span>
          <div class="nmm-recorder-dsp-right">
            ${
              this.pilotDiagnosticText
                ? `<span class="val-pill font-mono">${escHtml(this.pilotDiagnosticText)}</span>`
                : `<span class="val-pill font-mono">RTL: ${cfg.calibratedLatencyMs.toFixed(1)} ms (${cfg.calibratedLatencySamples} smp)</span>`
            }
            ${
              this.lastPilotRecommendation
                ? `<button type="button" class="btn btn-xs btn-accent" id="btn-as-apply-pilot-rtl" title="${es ? `Aplicar RTL medida (${this.lastPilotRecommendation.latencyMs.toFixed(1)} ms) y recomendaciones de envolvente` : `Apply measured RTL (${this.lastPilotRecommendation.latencyMs.toFixed(1)} ms) and envelope recommendations`}">
                    ${ICONS.check} ${es ? `Aplicar RTL medida (${this.lastPilotRecommendation.latencyMs.toFixed(1)} ms)` : `Apply measured RTL (${this.lastPilotRecommendation.latencyMs.toFixed(1)} ms)`}
                  </button>`
                : ''
            }
            <button type="button" class="btn btn-xs btn-outline" id="btn-as-rescan-midi" title="${es ? 'Reescanear puertos WebMIDI' : 'Rescan WebMIDI ports'}">
              ${ICONS.refresh} ${es ? 'Puertos MIDI' : 'MIDI Ports'}
            </button>
            <button type="button" class="btn btn-xs btn-outline" id="btn-as-pilot-test" title="${es ? 'Disparar 1 nota piloto (C4) para medir latencia RTL, clipping y suelo de ruido' : 'Fire 1 pilot note (C4) to measure RTL latency, clipping, and noise floor'}">
              ${ICONS.zap} ${es ? 'Probar 1 Nota / Calibrar' : 'Test 1 Note / Calibrate'}
            </button>
          </div>
        </div>

        <!-- Fila 1 & 2: Puertos WebMIDI + Canal + Rango/Kit + Envolvente + Velocidades -->
        <div class="nmm-recorder-params-grid">
          <fieldset class="conditioned-fieldset" ${isLive ? 'disabled' : ''}>
            <div class="form-group ${isLive ? 'is-conditioned-disabled' : ''}">
              <div class="label-with-val">
                <label for="as-midi-out">
                  MIDI OUT (SYNTH / VST)
                  ${isLive ? `<span class="cond-reason-badge">${es ? 'SOLO BARRIDO' : 'SWEEP ONLY'}</span>` : ''}
                </label>
                <span class="val-pill font-mono">CH ${cfg.midiChannel}</span>
              </div>
              <div class="cfg-inline-row">
                <select id="as-midi-out" class="form-control form-control-sm cfg-flex-1"></select>
                <input type="number" id="as-midi-ch" class="form-control form-control-sm font-mono cfg-ordinal-input" min="1" max="16" value="${cfg.midiChannel}" title="${es ? 'Canal MIDI (1..16)' : 'MIDI Channel (1..16)'}" />
              </div>
            </div>
          </fieldset>

          <fieldset class="conditioned-fieldset" ${!isLive ? 'disabled' : ''}>
            <div class="form-group ${!isLive ? 'is-conditioned-disabled' : ''}">
              <div class="label-with-val">
                <label for="as-midi-in">
                  MIDI IN (KEYBOARD / CONTROLLER)
                  ${!isLive ? `<span class="cond-reason-badge">${es ? 'SOLO EN VIVO' : 'LIVE ONLY'}</span>` : ''}
                </label>
                <span class="val-pill font-mono">${isLive ? (es ? 'ACTIVO' : 'ACTIVE') : (es ? 'SOLO VIVO' : 'LIVE ONLY')}</span>
              </div>
              <select id="as-midi-in" class="form-control form-control-sm"></select>
            </div>
          </fieldset>

          ${
            !isLive && !isDrum
              ? `
            <div class="form-group">
              <div class="label-with-val">
                <label for="as-start-octave">${es ? 'OCTAVA INICIAL Y CANTIDAD' : 'START OCTAVE &amp; COUNT'}</label>
                <span class="val-pill font-mono">C${cfg.startOctave} (${cfg.octaveCount} oct · max ${maxOctaves})</span>
              </div>
              <div class="cfg-inline-row">
                <select id="as-start-octave" class="form-control form-control-sm cfg-flex-1">
                  ${[0, 1, 2, 3, 4, 5, 6]
                    .map(
                      (o) =>
                        `<option value="${o}" ${cfg.startOctave === o ? 'selected' : ''}>C${o} (MIDI ${(o + 1) * 12})</option>`
                    )
                    .join('')}
                </select>
                <input type="number" id="as-octave-count" class="form-control form-control-sm font-mono cfg-ordinal-input" min="1" max="${maxOctaves}" value="${cfg.octaveCount}" ${maxOctaves <= 1 ? `disabled title="${es ? 'Desde C6 solo cabe 1 octava dentro del rango MIDI 0..127' : 'From C6 only 1 octave fits within MIDI range 0..127'}"` : `title="${es ? `Número de octavas (1..${maxOctaves} desde C${cfg.startOctave})` : `Number of octaves (1..${maxOctaves} from C${cfg.startOctave})`}"`} />
              </div>
            </div>

            <div class="form-group">
              <div class="label-with-val">
                <label for="as-notes-per-oct">${es ? 'NOTAS POR OCTAVA' : 'NOTES PER OCTAVE'}</label>
                <span class="val-pill font-mono">${cfg.notesPerOctave}/oct</span>
              </div>
              <select id="as-notes-per-oct" class="form-control form-control-sm">
                <option value="1" ${cfg.notesPerOctave === 1 ? 'selected' : ''}>${es ? '1 por octava (Solo raíces C · cada 12 st)' : '1 per octave (Roots C only · 12 st)'}</option>
                <option value="2" ${cfg.notesPerOctave === 2 ? 'selected' : ''}>${es ? '2 por octava (Tritono · cada 6 st)' : '2 per octave (Tritone · every 6 st)'}</option>
                <option value="3" ${cfg.notesPerOctave === 3 ? 'selected' : ''}>${es ? '3 por octava (3ª Mayores · cada 4 st)' : '3 per octave (Major 3rds · every 4 st)'}</option>
                <option value="4" ${cfg.notesPerOctave === 4 ? 'selected' : ''}>${es ? '4 por octava (3ª Menores · cada 3 st)' : '4 per octave (Minor 3rds · every 3 st)'}</option>
                <option value="6" ${cfg.notesPerOctave === 6 ? 'selected' : ''}>${es ? '6 por octava (Tonos enteros · cada 2 st)' : '6 per octave (Whole tones · every 2 st)'}</option>
                <option value="12" ${cfg.notesPerOctave === 12 ? 'selected' : ''}>${es ? '12 por octava (Cromático · cada 1 st)' : '12 per octave (Chromatic · every 1 st)'}</option>
              </select>
            </div>
          `
              : ''
          }

          ${
            isDrum
              ? `
            <div class="form-group nmm-as-drum-group">
              <div class="label-with-val">
                <label for="as-drum-preset">${es ? 'KIT DE PERCUSIÓN / DRUM MAP' : 'PERCUSSION KIT / DRUM MAP'}</label>
                <span class="val-pill font-mono">${cfg.drumMap ? `${escHtml(cfg.drumMap.kitName)} (${cfg.drumMap.hits.length} hits)` : 'Standard Kit'}</span>
              </div>
              <div class="cfg-inline-row">
                <select id="as-drum-preset" class="form-control form-control-sm cfg-flex-1">
                  ${Object.entries(FACTORY_DRUM_MAP_PRESETS)
                    .map(
                      ([k, v]) =>
                        `<option value="${escHtml(k)}" ${(cfg.drumMap?.kitName ?? FACTORY_DRUM_MAP_PRESETS.tr808_909.kitName) === v.kitName ? 'selected' : ''}>${escHtml(v.kitName)}</option>`
                    )
                    .join('')}
                </select>
                <label class="btn btn-xs btn-outline" for="as-drum-file-inp" title="${es ? 'Importar mapa de golpes .txt, .json o .yaml' : 'Import .txt, .json, or .yaml drum hit-name map'}">
                  ${ICONS.upload} ${es ? 'Importar' : 'Import'}
                </label>
                <input type="file" id="as-drum-file-inp" accept=".txt,.csv,.json,.yaml,.yml" hidden />
                <button type="button" class="btn btn-xs btn-outline" id="btn-as-paste-manual" title="${es ? 'Pegar tabla desde manual PDF para extraer notas y nombres' : 'Paste table from PDF manual to extract notes and names'}">
                  ${ICONS.sparkle} ${es ? 'Pegar Tabla' : 'Paste Table'}
                </button>
                <button type="button" class="btn btn-xs btn-outline" id="btn-as-drum-spec" title="${es ? 'Ver especificación y descargar plantillas' : 'View specification and download templates'}">
                  ? ${es ? 'Plantillas' : 'Templates'}
                </button>
              </div>
            </div>
          `
              : ''
          }

          <fieldset class="conditioned-fieldset" ${isLive ? 'disabled' : ''}>
            <div class="form-group ${isLive ? 'is-conditioned-disabled' : ''}">
              <div class="label-with-val">
                <label for="as-gate-ms">
                  ${es ? 'DURACIÓN DE NOTA (GATE)' : 'NOTE DURATION (GATE)'}
                  ${isLive ? `<span class="cond-reason-badge">${es ? 'SOLO BARRIDO' : 'SWEEP ONLY'}</span>` : ''}
                </label>
                <span class="val-pill font-mono">${isLive ? 'REAL-TIME KEY' : `${cfg.gateDurationMs} ms`}</span>
              </div>
              <input type="number" id="as-gate-ms" class="form-control form-control-sm font-mono" min="80" max="15000" step="50" value="${cfg.gateDurationMs}" title="${es ? 'Duración de puerta (NoteOn a NoteOff en ms)' : 'Gate duration (NoteOn to NoteOff in ms)'}" />
            </div>
          </fieldset>

          <div class="form-group">
            <div class="label-with-val">
              <label for="as-release-mode">${es ? 'MODO DE COLA RELEASE Y MÁX' : 'RELEASE TAIL MODE &amp; MAX'}</label>
              <span class="val-pill font-mono">${cfg.releaseMode === 'auto_decay' ? `Auto-Decay (max ${cfg.maxReleaseMs}ms)` : `Fixed ${cfg.maxReleaseMs}ms`}</span>
            </div>
            <div class="cfg-inline-row">
              <select id="as-release-mode" class="form-control form-control-sm cfg-flex-1" title="${es ? 'Al enviar NoteOff el sonido puede seguir sonando: Auto-Decay espera hasta caer al suelo de ruido; Fijo espera los ms exactos' : 'When NoteOff is sent, sound may keep ringing: Auto-Detect waits until decay hits noise floor; Fixed waits exact ms'}">
                <option value="auto_decay" ${cfg.releaseMode === 'auto_decay' ? 'selected' : ''}>${es ? 'Auto-Decaimiento a Silencio' : 'Auto-Decay to Silence'}</option>
                <option value="fixed_time" ${cfg.releaseMode === 'fixed_time' ? 'selected' : ''}>${es ? 'Tiempo de Release Fijo' : 'Fixed Release Time'}</option>
              </select>
              <input type="number" id="as-release-ms" class="form-control form-control-sm font-mono cfg-ordinal-input" min="100" max="20000" step="100" value="${cfg.maxReleaseMs}" title="${es ? 'Tiempo máximo de cola release / Duración fija (ms)' : 'Max release timeout / Fixed release duration (ms)'}" />
            </div>
          </div>

          ${
            !isLive
              ? `
            <div class="form-group">
              <div class="label-with-val">
                <label for="as-vel-curve">
                  ${es ? 'CAPAS Y CURVA DE VELOCIDAD' : 'VELOCITY LAYERS &amp; CURVE'}
                  ${cfg.velocityCurve === 'classic_neuron_2layer' ? `<span class="cond-reason-badge is-classic-only">${es ? 'FIJA 2 CAPAS' : 'FIXED 2 LAYERS'}</span>` : cfg.velocityCurve === 'manual_table' ? `<span class="cond-reason-badge">${es ? 'TABLA MANUAL' : 'MANUAL TABLE'}</span>` : ''}
                </label>
                <span class="val-pill font-mono">${escHtml(curveSummaryPill)}</span>
              </div>
              <div class="cfg-inline-row">
                <input type="number" id="as-vel-layers" class="form-control form-control-sm font-mono cfg-ordinal-input" min="1" max="8" value="${cfg.velocityLayers}" ${cfg.velocityCurve === 'classic_neuron_2layer' ? `disabled title="${es ? 'Clásica Neuron fija siempre 2 capas (60 / 120)' : 'Classic Neuron always fixes 2 layers (60 / 120)'}"` : cfg.velocityCurve === 'manual_table' ? `disabled title="${es ? 'En Tabla Manual las capas se añaden o quitan con los botones de cada capa a la derecha' : 'In Manual Table layers are added or removed with the layer buttons on the right'}"` : `title="${es ? 'Número de capas de velocidad (1..8)' : 'Number of velocity layers (1..8)'}"`} />
                <select id="as-vel-curve" class="form-control form-control-sm cfg-flex-1">
                  ${
                    cfg.velocityLayers === 1 && cfg.velocityCurve !== 'manual_table'
                      ? `<option value="linear" selected>${es ? 'Capa Única (v127 · rango 1..127)' : 'Single Layer (v127 · range 1..127)'}</option>`
                      : `<option value="linear" ${cfg.velocityCurve === 'linear' ? 'selected' : ''}>${es ? 'Lineal (Equidistante)' : 'Linear (Equidistant)'}</option>`
                  }
                  <option value="high_precision" ${cfg.velocityCurve === 'high_precision' && cfg.velocityLayers > 1 ? 'selected' : ''} ${cfg.velocityLayers <= 1 ? 'disabled' : ''}>${es ? 'Logarítmica / Exponencial (+ precisión en altos 85..127)' : 'Logarithmic / Exponential (+ precision in highs 85..127)'}</option>
                  <option value="low_precision" ${cfg.velocityCurve === 'low_precision' && cfg.velocityLayers > 1 ? 'selected' : ''} ${cfg.velocityLayers <= 1 ? 'disabled' : ''}>${es ? 'Comprimida (+ precisión en bajos 1..65)' : 'Compressed (+ precision in lows 1..65)'}</option>
                  <option value="classic_neuron_2layer" ${cfg.velocityCurve === 'classic_neuron_2layer' ? 'selected' : ''}>${es ? 'Clásica Neuron (Fija 2 capas: 60 / 120)' : 'Classic Neuron (Fixed 2 layers: 60 / 120)'}</option>
                  <option value="manual_table" ${cfg.velocityCurve === 'manual_table' ? 'selected' : ''}>${es ? 'Tabla Manual por Capas (1..127)' : 'Manual Layer Table (1..127)'}</option>
                </select>
              </div>
            </div>

            <div class="form-group nmm-as-vel-viz-group">
              <div class="label-with-val">
                <label>${es ? 'MAPA DE DISTRIBUCIÓN DE VELOCIDAD (1..127)' : 'VELOCITY DISTRIBUTION MAP (1..127)'}</label>
                <span class="val-pill font-mono">${displayLayers.map((l) => `v${l.velocity}`).join(' / ')}</span>
              </div>
              <div class="nmm-vel-curve-viz" title="${es ? 'Representación gráfica de las capas de velocidad MIDI (altura = velocidad 1..127, ancho = rango [lowVel..highVel])' : 'Graphical representation of MIDI velocity layers (height = velocity 1..127, width = range [lowVel..highVel])'}">
                <div class="nmm-vel-curve-bars">
                  ${displayLayers
                    .map((layer, idx) => {
                      const span = Math.max(1, layer.highVel - layer.lowVel + 1);
                      const heightPct = Math.max(14, Math.round((layer.velocity / 127) * 100));
                      const isBad =
                        cfg.velocityCurve === 'manual_table' && invalidVelIndices.has(idx);
                      return `
                        <div class="nmm-vel-bar-col${isBad ? ' is-invalid' : ''}" style="flex: ${span} 1 0%;">
                          <span class="nmm-vel-bar-val">L${idx + 1} · v${layer.velocity}</span>
                          <div class="nmm-vel-bar-track">
                            <div class="nmm-vel-bar-fill" style="height: ${heightPct}%;"></div>
                          </div>
                        </div>
                      `;
                    })
                    .join('')}
                </div>
                <div class="nmm-vel-curve-ranges">
                  ${displayLayers
                    .map((layer) => {
                      const span = Math.max(1, layer.highVel - layer.lowVel + 1);
                      return `<span class="nmm-vel-range-lbl" style="flex: ${span} 1 0%;">[vel ${layer.lowVel}..${layer.highVel}]</span>`;
                    })
                    .join('')}
                </div>
                ${
                  cfg.velocityCurve === 'manual_table'
                    ? `
                      <div class="nmm-manual-vel-editor">
                        <div class="nmm-manual-vel-slots">
                          ${cfg.manualVelocities
                            .map((vel, idx) => {
                              const isBad = invalidVelIndices.has(idx);
                              return `
                                <div class="nmm-manual-vel-chip${isBad ? ' is-invalid' : ''}">
                                  <span class="nmm-manual-vel-tag">L${idx + 1}</span>
                                  <input
                                    type="number"
                                    class="nmm-manual-vel-input${isBad ? ' is-invalid' : ''}"
                                    data-manual-vel-idx="${idx}"
                                    min="1"
                                    max="127"
                                    value="${vel}"
                                    title="${es ? `Velocidad MIDI para la capa L${idx + 1} (1..127, sin duplicados)` : `MIDI velocity for layer L${idx + 1} (1..127, no duplicates)`}"
                                  />
                                  <button
                                    type="button"
                                    class="nmm-manual-vel-remove"
                                    data-remove-vel-idx="${idx}"
                                    ${cfg.manualVelocities.length <= 1 ? 'disabled' : ''}
                                    title="${es ? `Eliminar capa L${idx + 1}` : `Remove layer L${idx + 1}`}"
                                  >&times;</button>
                                </div>
                              `;
                            })
                            .join('')}
                          ${
                            cfg.manualVelocities.length < 8
                              ? `<button type="button" class="btn btn-xs btn-outline" id="btn-as-add-vel-layer" title="${es ? 'Añadir una nueva capa de velocidad (máx. 8)' : 'Add a new velocity layer (max 8)'}">
                                  + ${es ? 'Añadir capa' : 'Add layer'}
                                </button>`
                              : ''
                          }
                        </div>
                        ${
                          !velValidation.valid && velValidation.errorMessage
                            ? `<div class="nmm-vel-error-banner" role="alert">
                                <span>${escHtml(velValidation.errorMessage)}</span>
                                <button type="button" class="btn btn-xs btn-accent" id="btn-as-autofix-vels" title="${es ? 'Corregir rango 1..127, eliminar duplicados y ordenar de menor a mayor' : 'Fix 1..127 range, remove duplicates, and sort ascending'}">
                                  ${es ? 'Corregir y ordenar' : 'Fix &amp; sort'}
                                </button>
                              </div>`
                            : ''
                        }
                      </div>
                    `
                    : ''
                }
              </div>
            </div>
          `
              : ''
          }
        </div>

        ${
          isDrum && this.showDrumHelpPanel
            ? `<div class="raw-card">
                <div class="nmm-recorder-inspector-head">
                  <span class="raw-card-title">${es ? 'ESPECIFICACIÓN TÉCNICA PARA MAPAS DE BATERÍA (.TXT / .JSON / .YAML)' : 'TECHNICAL SPECIFICATION FOR DRUM HIT-NAME MAPS (.TXT / .JSON / .YAML)'}</span>
                  <div class="nmm-recorder-dsp-right">
                    <button type="button" class="btn btn-xs btn-outline" data-dl-template="txt">${ICONS.download} ${es ? 'Plantilla' : 'Template'} .txt</button>
                    <button type="button" class="btn btn-xs btn-outline" data-dl-template="json">${ICONS.download} ${es ? 'Plantilla' : 'Template'} .json</button>
                    <button type="button" class="btn btn-xs btn-outline" data-dl-template="yaml">${ICONS.download} ${es ? 'Plantilla' : 'Template'} .yaml</button>
                  </div>
                </div>
                <pre class="nmm-drum-help-pre">${escHtml(getDrumMapFormatSpecificationHelpText())}</pre>
              </div>`
            : ''
        }
        ${
          isDrum && this.showManualExtractorPanel
            ? `<div class="raw-card">
                <span class="raw-card-title">${es ? 'PEGAR TABLA DE MANUAL DE BATERÍA (EJ. "36 Bass Drum 1" O "C1: Kick")' : 'PASTE RAW DRUM MANUAL TABLE (E.G. "36 Bass Drum 1" OR "C1: Kick")'}</span>
                <textarea id="as-manual-raw-text" class="form-control font-mono" rows="3" placeholder="36 = Kick Drum&#10;38 = Snare Acoustic&#10;42 = Closed Hat&#10;46 = Open Hat"></textarea>
                <div class="nmm-recorder-dsp-right">
                  <button type="button" class="btn btn-xs btn-accent" id="btn-as-run-manual-extract">${ICONS.check} ${es ? 'Extraer Texto a Drum Map' : 'Parse Manual Text into Drum Map'}</button>
                </div>
              </div>`
            : ''
        }

        <!-- Opciones de Post-Procesado de Muestreo + Cuadrícula (oculta en Captura en Tiempo Real hasta que se graben notas) -->
        <div class="nmm-recorder-dsp-toolbar">
          <div class="nmm-recorder-dsp-left">
            <span class="toolbar-label">${
              isLive
                ? es
                  ? `CAPTURA MIDI EN VIVO (${selectedTake?.manifest?.events.length ?? 0} NOTAS REGISTRADAS):`
                  : `LIVE MIDI CAPTURE (${selectedTake?.manifest?.events.length ?? 0} RECORDED NOTES):`
                : es
                  ? `MATRIZ PROGRAMADA (${this.activeSchedule.length} CELDAS · ${recordedCount} HECHAS · ${pendingCount} PENDIENTES):`
                  : `SCHEDULE MATRIX (${this.activeSchedule.length} CELLS · ${recordedCount} DONE · ${pendingCount} PENDING):`
            }</span>
            <label class="batch-check" title="${es ? 'Limpiar DC offset y restar Huella de Ruido pre-roll en la toma continua ANTES de cortar' : 'Clean DC offset and subtract pre-roll Noise Print on the continuous take BEFORE slicing'}">
              <input type="checkbox" class="articulation-checkbox switch--sm" id="as-chk-clean" ${cfg.cleanBeforeSlice ? 'checked' : ''} />
              <span>${es ? 'Limpiar antes de cortar' : 'Clean before slice'}</span>
            </label>
            <label class="batch-check" title="${es ? 'Buscar bucles de sostenido en paso por cero estrictamente entre NoteOn y NoteOff (nunca en la cola release)' : 'Search zero-crossing sustain loops strictly between NoteOn and NoteOff (never inside the release tail)'}">
              <input type="checkbox" class="articulation-checkbox switch--sm" id="as-chk-autoloop" ${cfg.autoLoopSustained ? 'checked' : ''} />
              <span>AutoLoop (NoteOn..NoteOff)</span>
            </label>
            <label class="batch-check" title="${es ? 'Medir F0 real en la región sostenida y ajustar detuneCents (-50..+50) para compensar deriva analógica' : 'Measure real F0 in sustained region and set detuneCents (-50..+50) for analog drift compensation'}">
              <input type="checkbox" class="articulation-checkbox switch--sm" id="as-chk-detune" ${cfg.autoCompensateAnalogDetune ? 'checked' : ''} />
              <span>${es ? 'Comp. Desafinación Analógica F0' : 'Analog F0 Detune Comp'}</span>
            </label>
          </div>

          <div class="nmm-recorder-dsp-right">
            ${
              canResume
                ? `<button type="button" class="btn btn-xs btn-accent" id="btn-as-resume" title="${es ? 'Continuar grabando solo las celdas pendientes o fallidas desde donde se paró' : 'Continue recording only pending or failed cells from where it stopped'}">
                    ${ICONS.play} ${es ? `Continuar desde donde se paró (${pendingCount})` : `Resume from where it stopped (${pendingCount})`}
                  </button>`
                : ''
            }
            ${
              selectedTake?.manifest
                ? `
                  <label class="toolbar-label" for="as-rescue-offset">OFFSET (ms):</label>
                  <input type="number" id="as-rescue-offset" class="form-control form-control-sm font-mono cfg-ordinal-input" value="${cfg.extraLatencyOffsetMs}" min="-500" max="500" step="5" title="${es ? 'Desplazamiento de rescate (± ms) si la latencia hardware desplazó las marcas NoteOn' : 'Rescue cut offset (± ms) if hardware latency shifted NoteOn markers'}" />
                  <button type="button" class="btn btn-xs btn-outline" id="btn-as-reparse" title="${es ? 'Re-ejecutar corte determinista y AutoLoop sobre la toma continua ya grabada sin volver a grabar' : 'Re-run deterministic slicing & AutoLoop on the already recorded continuous take without re-recording'}">
                    ${ICONS.refresh} ${es ? 'Re-ejecutar Corte + AutoLoop' : 'Re-run Slice + AutoLoop'}
                  </button>
                `
                : ''
            }
          </div>
        </div>

        ${
          isLive && (!selectedTake?.manifest || selectedTake.manifest.events.length === 0)
            ? `<div class="nmm-recorder-takes-empty">${es ? 'Modo Captura MIDI en Tiempo Real: no se muestra matriz previa porque las notas y velocidades se registran dinámicamente a medida que interpretas en tu teclado o controlador MIDI.' : 'Real-Time MIDI Capture Mode: no preview matrix is shown because notes and velocities are recorded dynamically as you play on your MIDI keyboard or controller.'}</div>`
            : `<div class="nmm-autosampler-grid-wrap" id="as-cells-grid" aria-label="AutoSampler Notes x Velocities Grid"></div>`
        }
      </div>
    `;

    void this.refreshMidiPorts();
    this.renderAutoSamplerGrid();
    this.bindAutoSamplerDeckEvents();
  }

  private renderAutoSamplerGrid(): void {
    const grid = this.backdropEl?.querySelector<HTMLElement>('#as-cells-grid');
    if (!grid) return;

    const st = this.getSelectedTake();
    const events = st?.manifest ? st.manifest.events : this.activeSchedule;

    if (events.length === 0) {
      grid.innerHTML = `<div style="padding: var(--space-2);"><span class="nmm-recorder-takes-hint">Play notes on your MIDI keyboard or configure sweep parameters above.</span></div>`;
      return;
    }

    const isDrum =
      this.autoSamplerConfig.mode === 'drum_map' || st?.manifest?.mode === 'drum_map';

    // 1. Collect unique sorted velocity columns (equivalence by velocity across all notes)
    const velMap = new Map<number, { velocity: number; lowVel: number; highVel: number }>();
    for (const ev of events) {
      if (!velMap.has(ev.velocity)) {
        velMap.set(ev.velocity, {
          velocity: ev.velocity,
          lowVel: ev.lowVel,
          highVel: ev.highVel,
        });
      }
    }
    const velCols = Array.from(velMap.values()).sort((a, b) => a.velocity - b.velocity);

    // 2. Group events by Note (preserving schedule order) and by Octave (`Math.floor(midiNote / 12) - 1`)
    interface NoteRowGroup {
      noteKey: string;
      midiNote: number;
      octave: number;
      noteName: string;
      customName?: string;
      muteGroup?: number;
      lowKey: number;
      highKey: number;
      cellsByVelocity: Map<number, { ev: MidiCapturedNoteEvent; idx: number }>;
    }

    const noteRowMap = new Map<string, NoteRowGroup>();
    events.forEach((ev, idx) => {
      const noteKey = `${ev.midiNote}_${ev.customName ?? ''}`;
      let row = noteRowMap.get(noteKey);
      if (!row) {
        row = {
          noteKey,
          midiNote: ev.midiNote,
          octave: Math.floor(ev.midiNote / 12) - 1,
          noteName: ev.noteName,
          customName: ev.customName,
          muteGroup: ev.muteGroup,
          lowKey: ev.lowKey,
          highKey: ev.highKey,
          cellsByVelocity: new Map(),
        };
        noteRowMap.set(noteKey, row);
      }
      row.cellsByVelocity.set(ev.velocity, { ev, idx });
    });

    const noteRows = Array.from(noteRowMap.values());

    // Count how many note rows belong to each contiguous octave block for rowspan (only used in melodic sweep)
    const octaveSpanCounts = new Map<number, number>();
    let blockStartIdx = 0;
    for (let i = 0; i < noteRows.length; i++) {
      if (i === 0 || noteRows[i].octave !== noteRows[i - 1].octave) {
        blockStartIdx = i;
        octaveSpanCounts.set(blockStartIdx, 1);
      } else {
        octaveSpanCounts.set(blockStartIdx, (octaveSpanCounts.get(blockStartIdx) ?? 1) + 1);
      }
    }

    const es = isEs();
    const theadHtml = `
      <thead>
        <tr>
          <th>${isDrum ? (es ? 'NOTA MIDI' : 'MIDI NOTE') : (es ? 'OCTAVA' : 'OCTAVE')}</th>
          <th class="nmm-as-th-note">${isDrum ? (es ? 'PIEZA / ARTICULACIÓN DE BATERÍA' : 'DRUM PIECE / ARTICULATION') : (es ? 'NOTA / RANGO TECLAS' : 'NOTE / KEY RANGE')}</th>
          ${velCols
            .map(
              (vc, vIdx) => `
              <th>
                L${vIdx + 1} · v${vc.velocity}
                <span class="nmm-as-vel-th-sub">[vel ${vc.lowVel}..${vc.highVel}]</span>
              </th>
            `
            )
            .join('')}
        </tr>
      </thead>
    `;

    const tbodyHtml = noteRows
      .map((row, rIdx) => {
        const isOctaveStart = !isDrum && (rIdx === 0 || row.octave !== noteRows[rIdx - 1].octave);
        const octRowSpan = octaveSpanCounts.get(rIdx) ?? 1;
        const octMinMidi = Math.max(0, (row.octave + 1) * 12);
        const octMaxMidi = Math.min(127, octMinMidi + 11);
        const firstColHtml = isDrum
          ? `<td class="nmm-as-oct-cell" title="${es ? 'Nota MIDI' : 'MIDI Note'} ${row.midiNote} (${escHtml(row.noteName)})">
              MIDI ${row.midiNote}
              <span class="nmm-as-oct-sub">${escHtml(row.noteName)}</span>
            </td>`
          : isOctaveStart
            ? `<td class="nmm-as-oct-cell" rowspan="${octRowSpan}" title="${es ? 'Octava' : 'Octave'} C${row.octave} (MIDI ${octMinMidi}..${octMaxMidi})">
                OCT C${row.octave}
                <span class="nmm-as-oct-sub">${octMinMidi}..${octMaxMidi}</span>
              </td>`
            : '';

        const titleLabel = isDrum
          ? row.customName || row.noteName
          : row.customName
            ? `${row.customName} (${row.noteName})`
            : row.noteName;
        const keyRangeLabel = isDrum
          ? row.muteGroup !== undefined
            ? `Mute Grp ${row.muteGroup}`
            : `${es ? 'Tecla' : 'Key'} ${row.noteName}`
          : row.lowKey === row.highKey
            ? `MIDI ${row.midiNote}`
            : `[${midiNoteToStandardName(row.lowKey)}..${midiNoteToStandardName(row.highKey)}]`;

        const velCellsHtml = velCols
          .map((vc, cIdx) => {
            const cell = row.cellsByVelocity.get(vc.velocity);
            if (!cell) {
              return `<td class="nmm-as-td-cell" role="gridcell">—</td>`;
            }
            const { ev, idx } = cell;
            const statusClass =
              ev.status === 'recording'
                ? ' is-recording'
                : ev.status === 'recorded'
                  ? ' is-recorded'
                  : ev.status === 'failed'
                    ? ' is-failed'
                    : '';
            return `
              <td class="nmm-as-td-cell" role="gridcell">
                <button
                  type="button"
                  class="nmm-as-cell${statusClass}"
                  data-cell-idx="${idx}"
                  data-row-idx="${rIdx}"
                  data-col-idx="${cIdx}"
                  aria-label="${escHtml(titleLabel)} v${ev.velocity} (${ev.status})"
                  title="${es ? `Click / Enter / Espacio: audicionar muestra · Shift+Click / Shift+Enter: re-grabar celda · Flechas ←/→/↑/↓: navegar matriz (${escHtml(titleLabel)} · Capa v${ev.velocity} [${ev.lowVel}..${ev.highVel}])` : `Click / Enter / Space: audition sample · Shift+Click / Shift+Enter: re-record cell · Arrows ←/→/↑/↓: navigate matrix (${escHtml(titleLabel)} · Layer v${ev.velocity} [${ev.lowVel}..${ev.highVel}])`}"
                >
                  <span class="nmm-as-cell-dot"></span>
                  <span>${escHtml(isDrum ? row.customName || row.noteName : row.noteName)}</span>
                  <span class="val-pill font-mono">v${ev.velocity}</span>
                </button>
              </td>
            `;
          })
          .join('');

        return `
          <tr class="${isOctaveStart && rIdx > 0 ? 'is-octave-start' : ''}" role="row">
            ${firstColHtml}
            <td class="nmm-as-note-cell" title="${es ? `Nota muestreada ${escHtml(titleLabel)} (MIDI ${row.midiNote}) · cubre teclas MIDI ${row.lowKey}..${row.highKey}` : `Sampled note ${escHtml(titleLabel)} (MIDI ${row.midiNote}) · covers MIDI keys ${row.lowKey}..${row.highKey}`}">
              <span class="nmm-as-note-main">${escHtml(titleLabel)}</span>
              <span class="nmm-as-note-range">${escHtml(keyRangeLabel)}</span>
            </td>
            ${velCellsHtml}
          </tr>
        `;
      })
      .join('');

    grid.innerHTML = `
      <table class="nmm-as-matrix-table" role="grid" aria-label="${es ? 'Matriz de Notas por Velocidades' : 'Notes by Velocities Matrix'}">
        ${theadHtml}
        <tbody>${tbodyHtml}</tbody>
      </table>
    `;

    const allCellBtns = Array.from(grid.querySelectorAll<HTMLButtonElement>('[data-cell-idx]'));
    allCellBtns.forEach((btn, flatIdx) => {
      btn.addEventListener('keydown', (e: KeyboardEvent) => {
        const rIdx = Number(btn.getAttribute('data-row-idx') ?? 0);
        const cIdx = Number(btn.getAttribute('data-col-idx') ?? 0);
        let targetBtn: HTMLButtonElement | null = null;

        if (e.key === 'ArrowRight') {
          targetBtn = allCellBtns[Math.min(allCellBtns.length - 1, flatIdx + 1)] ?? null;
        } else if (e.key === 'ArrowLeft') {
          targetBtn = allCellBtns[Math.max(0, flatIdx - 1)] ?? null;
        } else if (e.key === 'ArrowDown') {
          targetBtn =
            grid.querySelector<HTMLButtonElement>(
              `[data-row-idx="${rIdx + 1}"][data-col-idx="${cIdx}"]`
            ) ?? allCellBtns[Math.min(allCellBtns.length - 1, flatIdx + velCols.length)] ?? null;
        } else if (e.key === 'ArrowUp') {
          targetBtn =
            grid.querySelector<HTMLButtonElement>(
              `[data-row-idx="${rIdx - 1}"][data-col-idx="${cIdx}"]`
            ) ?? allCellBtns[Math.max(0, flatIdx - velCols.length)] ?? null;
        } else if (e.key === 'Home') {
          targetBtn = allCellBtns[0] ?? null;
        } else if (e.key === 'End') {
          targetBtn = allCellBtns[allCellBtns.length - 1] ?? null;
        }

        if (targetBtn) {
          e.preventDefault();
          targetBtn.focus();
        }
      });

      btn.addEventListener('click', (e) => {
        const idx = Number(btn.getAttribute('data-cell-idx'));
        const activeTake = this.getSelectedTake();
        if (e.shiftKey && !this.isSweepRunning) {
          void this.runAutoSamplerSweep({
            resumeTakeId: activeTake?.id,
            specificCellIndex: idx,
          });
          return;
        }
        // Audicionar la celda si ya está grabada
        if (activeTake?.manifest && this.context.onAuditionPcm) {
          const ev = activeTake.manifest.events[idx];
          if (ev && ev.tailEndFrame > ev.noteOnFrame) {
            const mono = mixToMono(activeTake.take);
            const slice = mono.subarray(
              Math.max(0, ev.noteOnFrame),
              Math.min(mono.length, ev.tailEndFrame)
            );
            if (slice.length > 0) {
              this.context.onAuditionPcm(slice, activeTake.take.sampleRate);
            }
          }
        }
      });
    });
  }

  private bindAutoSamplerDeckEvents(): void {
    const card = this.backdropEl?.querySelector<HTMLElement>('#as-config-card');
    if (!card) return;

    const rebuildSchedule = () => {
      this.activeSchedule = buildScheduleFromConfig(this.autoSamplerConfig);
      this.renderAutoSamplerDeck();
    };

    card.querySelector('#btn-as-rescan-midi')?.addEventListener('click', () => {
      void this.refreshMidiPorts();
    });
    card.querySelector('#btn-as-pilot-test')?.addEventListener('click', () => {
      void this.runPilotCalibration();
    });
    card.querySelector('#btn-as-apply-pilot-rtl')?.addEventListener('click', () => {
      if (!this.lastPilotRecommendation) return;
      this.autoSamplerConfig = applyPilotRecommendationToConfig(
        this.autoSamplerConfig,
        this.lastPilotRecommendation,
        { applyEnvelopeAndVelocity: true }
      );
      this.activeSchedule = buildScheduleFromConfig(this.autoSamplerConfig);
      const selectedTake = this.getSelectedTake();
      if (selectedTake?.manifest) {
        selectedTake.manifest.latencySamples = this.lastPilotRecommendation.latencySamples;
        this.runAutoSamplerPostProcessOnTake(selectedTake);
        this.renderTakes();
        this.renderTakeInspector();
      }
      toast(
        `Applied RTL ${this.lastPilotRecommendation.latencyMs.toFixed(1)} ms (${this.lastPilotRecommendation.latencySamples} smp) and pilot recommendations.`,
        'success'
      );
      this.renderAutoSamplerDeck();
    });

    card.querySelector('#as-midi-out')?.addEventListener('change', (e) => {
      this.midi.setSelectedOutputId((e.target as HTMLSelectElement).value);
    });
    card.querySelector('#as-midi-in')?.addEventListener('change', (e) => {
      this.midi.setSelectedInputId((e.target as HTMLSelectElement).value);
    });
    card.querySelector('#as-midi-ch')?.addEventListener('change', (e) => {
      const ch = parseInt((e.target as HTMLInputElement).value, 10);
      if (Number.isFinite(ch)) {
        this.autoSamplerConfig.midiChannel = Math.max(1, Math.min(16, ch));
        this.midi.setChannel(this.autoSamplerConfig.midiChannel);
      }
    });

    card.querySelector('#as-start-octave')?.addEventListener('change', (e) => {
      const startOct = parseInt((e.target as HTMLSelectElement).value, 10) || 2;
      const coh = enforceAutoSamplerConfigCoherence(this.autoSamplerConfig, {
        changedField: 'startOctave',
        newStartOctave: startOct,
      });
      this.autoSamplerConfig = coh.config;
      if (coh.adjustmentNote) toast(coh.adjustmentNote, 'info');
      rebuildSchedule();
    });
    card.querySelector('#as-octave-count')?.addEventListener('change', (e) => {
      const v = parseInt((e.target as HTMLInputElement).value, 10);
      if (Number.isFinite(v)) {
        const coh = enforceAutoSamplerConfigCoherence(this.autoSamplerConfig, {
          changedField: 'octaveCount',
          newOctaveCount: v,
        });
        this.autoSamplerConfig = coh.config;
        if (coh.adjustmentNote) toast(coh.adjustmentNote, 'info');
        rebuildSchedule();
      }
    });
    card.querySelector('#as-notes-per-oct')?.addEventListener('change', (e) => {
      const v = parseInt((e.target as HTMLSelectElement).value, 10) as NotesPerOctaveOption;
      if ([1, 2, 3, 4, 6, 12].includes(v)) {
        this.autoSamplerConfig.notesPerOctave = v;
        rebuildSchedule();
      }
    });

    card.querySelector('#as-gate-ms')?.addEventListener('change', (e) => {
      const v = parseInt((e.target as HTMLInputElement).value, 10);
      if (Number.isFinite(v)) {
        this.autoSamplerConfig.gateDurationMs = Math.max(80, Math.min(15000, v));
        this.renderAutoSamplerDeck();
      }
    });
    card.querySelector('#as-release-mode')?.addEventListener('change', (e) => {
      this.autoSamplerConfig.releaseMode = (e.target as HTMLSelectElement)
        .value as AutoSamplerReleaseMode;
      this.renderAutoSamplerDeck();
    });
    card.querySelector('#as-release-ms')?.addEventListener('change', (e) => {
      const v = parseInt((e.target as HTMLInputElement).value, 10);
      if (Number.isFinite(v)) {
        this.autoSamplerConfig.maxReleaseMs = Math.max(100, Math.min(20000, v));
        this.renderAutoSamplerDeck();
      }
    });

    card.querySelector('#as-vel-layers')?.addEventListener('change', (e) => {
      const v = parseInt((e.target as HTMLInputElement).value, 10);
      if (Number.isFinite(v)) {
        const coh = enforceAutoSamplerConfigCoherence(this.autoSamplerConfig, {
          changedField: 'velocityLayers',
          newVelocityLayers: v,
        });
        this.autoSamplerConfig = coh.config;
        if (coh.adjustmentNote) toast(coh.adjustmentNote, 'info');
        rebuildSchedule();
      }
    });
    card.querySelector('#as-vel-curve')?.addEventListener('change', (e) => {
      const newCurve = (e.target as HTMLSelectElement).value as AutoSamplerVelocityCurve;
      const coh = enforceAutoSamplerConfigCoherence(this.autoSamplerConfig, {
        changedField: 'velocityCurve',
        newVelocityCurve: newCurve,
      });
      this.autoSamplerConfig = coh.config;
      if (coh.adjustmentNote) toast(coh.adjustmentNote, 'info');
      rebuildSchedule();
    });

    // Campos individuales de Tabla Manual por Capas (sin depender de escribir comas)
    card.querySelectorAll<HTMLInputElement>('[data-manual-vel-idx]').forEach((inp) => {
      inp.addEventListener('change', () => {
        const idx = Number(inp.getAttribute('data-manual-vel-idx'));
        const val = parseInt(inp.value, 10);
        if (Number.isInteger(idx) && idx >= 0 && idx < this.autoSamplerConfig.manualVelocities.length) {
          this.autoSamplerConfig.manualVelocities[idx] = Number.isFinite(val) ? val : 0;
          const vCheck = validateManualVelocities(this.autoSamplerConfig.manualVelocities);
          if (vCheck.valid) {
            this.autoSamplerConfig.velocityLayers = this.autoSamplerConfig.manualVelocities.length;
            rebuildSchedule();
          } else {
            this.renderAutoSamplerDeck();
          }
        }
      });
    });

    card.querySelectorAll<HTMLButtonElement>('[data-remove-vel-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-remove-vel-idx'));
        if (
          this.autoSamplerConfig.manualVelocities.length > 1 &&
          idx >= 0 &&
          idx < this.autoSamplerConfig.manualVelocities.length
        ) {
          this.autoSamplerConfig.manualVelocities.splice(idx, 1);
          this.autoSamplerConfig.velocityLayers = this.autoSamplerConfig.manualVelocities.length;
          rebuildSchedule();
        }
      });
    });

    card.querySelector('#btn-as-add-vel-layer')?.addEventListener('click', () => {
      if (this.autoSamplerConfig.manualVelocities.length < 8) {
        this.autoSamplerConfig.manualVelocities = resizeManualVelocityList(
          this.autoSamplerConfig.manualVelocities,
          this.autoSamplerConfig.manualVelocities.length + 1
        );
        this.autoSamplerConfig.velocityLayers = this.autoSamplerConfig.manualVelocities.length;
        rebuildSchedule();
      }
    });

    card.querySelector('#btn-as-autofix-vels')?.addEventListener('click', () => {
      const vCheck = validateManualVelocities(this.autoSamplerConfig.manualVelocities);
      this.autoSamplerConfig.manualVelocities = vCheck.sanitizedVelocities;
      this.autoSamplerConfig.velocityLayers = vCheck.sanitizedVelocities.length;
      toast(
        `Velocidades manuales corregidas y ordenadas: ${vCheck.sanitizedVelocities.join(', ')}`,
        'success'
      );
      rebuildSchedule();
    });

    // Drum map preset / import / manual text / spec
    card.querySelector('#as-drum-preset')?.addEventListener('change', (e) => {
      const key = (e.target as HTMLSelectElement).value;
      if (key && FACTORY_DRUM_MAP_PRESETS[key]) {
        this.autoSamplerConfig.drumMap = FACTORY_DRUM_MAP_PRESETS[key];
        rebuildSchedule();
      }
    });
    card.querySelector<HTMLInputElement>('#as-drum-file-inp')?.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      void file.text().then((txt) => {
        const parsed = parseDrumHitMapFile(txt, file.name);
        if (parsed.hits.length === 0) {
          toast(`Could not parse any valid MIDI drum hits from "${file.name}".`, 'warning');
          return;
        }
        this.autoSamplerConfig.drumMap = parsed;
        toast(`Loaded drum map "${parsed.kitName}" (${parsed.hits.length} hits).`, 'success');
        rebuildSchedule();
      });
    });
    card.querySelector('#btn-as-paste-manual')?.addEventListener('click', () => {
      this.showManualExtractorPanel = !this.showManualExtractorPanel;
      this.renderAutoSamplerDeck();
    });
    card.querySelector('#btn-as-drum-spec')?.addEventListener('click', () => {
      this.showDrumHelpPanel = !this.showDrumHelpPanel;
      this.renderAutoSamplerDeck();
    });
    card.querySelector('#btn-as-run-manual-extract')?.addEventListener('click', () => {
      const ta = card.querySelector<HTMLTextAreaElement>('#as-manual-raw-text');
      const raw = ta?.value ?? '';
      const parsed = extractDrumMapFromManualTextDeterministic(raw, 'Extracted Manual Kit');
      if (parsed.hits.length === 0) {
        toast('No valid note/name pairs found in text.', 'warning');
        return;
      }
      this.autoSamplerConfig.drumMap = parsed;
      this.showManualExtractorPanel = false;
      toast(`Extracted ${parsed.hits.length} drum hits from manual text.`, 'success');
      rebuildSchedule();
    });
    card.querySelectorAll<HTMLButtonElement>('[data-dl-template]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const fmt = btn.getAttribute('data-dl-template');
        if (fmt === 'txt') {
          downloadBlob(
            new Blob(['36, Kick Drum\n38, Snare Acoustic\n42, Closed Hi-Hat, 1\n46, Open Hi-Hat, 1\n'], {
              type: 'text/plain',
            }),
            'drum-map-template.txt'
          );
        } else if (fmt === 'json') {
          downloadBlob(
            new Blob(
              [
                JSON.stringify(
                  {
                    kitName: 'Custom Drum Kit',
                    defaultVelocities: [70, 120],
                    hits: [
                      { note: 36, name: 'Kick Drum' },
                      { note: 38, name: 'Snare Acoustic' },
                      { note: 42, name: 'Closed Hi-Hat', muteGroup: 1 },
                      { note: 46, name: 'Open Hi-Hat', muteGroup: 1 },
                    ],
                  },
                  null,
                  2
                ),
              ],
              { type: 'application/json' }
            ),
            'drum-map-template.json'
          );
        } else if (fmt === 'yaml') {
          downloadBlob(
            new Blob(
              [
                'kitName: Custom Drum Kit\nhits:\n  - note: 36\n    name: Kick Drum\n  - note: 38\n    name: Snare Acoustic\n  - note: 42\n    name: Closed Hi-Hat\n    muteGroup: 1\n  - note: 46\n    name: Open Hi-Hat\n    muteGroup: 1\n',
              ],
              { type: 'text/yaml' }
            ),
            'drum-map-template.yaml'
          );
        }
      });
    });

    card.querySelector('#as-chk-clean')?.addEventListener('change', (e) => {
      this.autoSamplerConfig.cleanBeforeSlice = (e.target as HTMLInputElement).checked;
    });
    card.querySelector('#as-chk-autoloop')?.addEventListener('change', (e) => {
      this.autoSamplerConfig.autoLoopSustained = (e.target as HTMLInputElement).checked;
    });
    card.querySelector('#as-chk-detune')?.addEventListener('change', (e) => {
      this.autoSamplerConfig.autoCompensateAnalogDetune = (e.target as HTMLInputElement).checked;
    });

    card.querySelector('#btn-as-resume')?.addEventListener('click', () => {
      const st = this.getSelectedTake();
      void this.runAutoSamplerSweep({ resumeTakeId: st?.id });
    });

    card.querySelector('#as-rescue-offset')?.addEventListener('change', (e) => {
      const val = parseFloat((e.target as HTMLInputElement).value);
      if (Number.isFinite(val)) {
        this.autoSamplerConfig.extraLatencyOffsetMs = Math.max(-500, Math.min(500, val));
      }
    });

    card.querySelector('#btn-as-reparse')?.addEventListener('click', () => {
      const st = this.getSelectedTake();
      if (!st?.manifest) return;
      const out = this.runAutoSamplerPostProcessOnTake(st);
      if (out) {
        toast(
          `Re-sliced "${st.name}" with offset ${this.autoSamplerConfig.extraLatencyOffsetMs} ms: ${out.slicerResult.slices.length} slices ready.`,
          'success'
        );
        this.renderTakeInspector();
        this.renderAutoSamplerGrid();
      }
    });
  }

  private renderTransport(): void {
    const box = this.backdropEl?.querySelector('#rec-transport');
    if (!box) return;
    const es = isEs();
    const isAsSweep =
      this.operatingMode === 'midi_autosampler' &&
      this.autoSamplerConfig.mode !== 'live_midi_capture';
    const recLabel = isAsSweep ? (es ? 'INICIAR BARRIDO' : 'START SWEEP') : 'REC';
    box.innerHTML = `
      <button type="button" class="btn btn-sm btn-danger-solid" id="btn-rec-record" title="${es ? 'Grabar / iniciar barrido AutoSampler' : 'Record / start AutoSampler sweep'}">${ICONS.record} ${recLabel}</button>
      <button type="button" class="btn btn-sm btn-outline" id="btn-rec-stop" title="${es ? 'Detener y conservar toma' : 'Stop and keep take'}">${ICONS.stop} ${es ? 'Detener' : 'Stop'}</button>
      <button type="button" class="btn btn-sm btn-outline" id="btn-rec-cancel" title="${es ? 'Descartar toma actual' : 'Discard current take'}">${ICONS.trash} ${es ? 'Descartar' : 'Discard'}</button>`;
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
    const es = isEs();
    const isAutoSampled = Boolean(st.manifest);
    const sliceCount = st.processedAutoSample?.slicerResult.slices.length ?? st.manifest?.events.length ?? 0;

    footerRight.innerHTML = `
      <button type="button" class="btn btn-outline" id="btn-rec-footer-download" title="${es ? 'Descargar toma seleccionada como WAV de 16 bits' : 'Download selected take as 16-bit WAV'}">
        ${ICONS.download} ${es ? 'Descargar WAV' : 'Download WAV'}
      </button>
      <button type="button" class="btn btn-accent" id="btn-rec-footer-chopper" title="${es ? 'Abrir toma seleccionada en Audio Chopper y Auto-Slicer con puntos de corte MIDI' : 'Open selected take in Audio Chopper & Auto-Slicer with MIDI cut points'}">
        ${ICONS.scissors} ${isAutoSampled ? (es ? `Abrir en AutoSlicer (${sliceCount} cortes)` : `Open in AutoSlicer (${sliceCount} cuts)`) : (es ? 'Enviar a Audio Chopper' : 'Send to Audio Chopper')}
      </button>
      ${
        isAutoSampled && this.context.onInjectAutoSampledInstrument
          ? `<button type="button" class="btn btn-primary" id="btn-rec-footer-inject" title="${es ? 'Inyectar todas las zonas/regiones AutoSampled + AutoLoops en la Sesión' : 'Inject all AutoSampled zones/regions + AutoLoops into Session'}">
              ${ICONS.check} ${es ? `Inyectar ${sliceCount} Zonas Mapeadas en Sesión` : `Inject ${sliceCount} Mapped Zones into Session`}
            </button>`
          : this.context.onInjectTakeIntoSession
            ? `<button type="button" class="btn btn-primary" id="btn-rec-footer-inject" title="${es ? 'Inyectar toma seleccionada en la Zona Activa' : 'Inject selected take into Active Zone'}">
                ${ICONS.check} ${es ? 'Inyectar en Zona Activa' : 'Inject into Active Zone'}
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
    const es = isEs();

    const liveWindowControlsHtml = `
      <div class="nmm-audio-zoom-group" title="${es ? 'Ventana de zoom horizontal constante durante la grabación en vivo (nunca aplasta la onda)' : 'Constant horizontal zoom window during live recording (never squashes the wave)'}">
        <span class="toolbar-label">${es ? 'VENTANA EN VIVO:' : 'LIVE WINDOW:'}</span>
        ${([2, 5, 10, 30] as LiveWaveWindowSec[])
          .map(
            (sec) =>
              `<button type="button" class="btn btn-xs ${this.liveWindowSec === sec ? 'btn-accent' : 'btn-outline'}" data-live-win="${sec}">${sec}s</button>`
          )
          .join('')}
      </div>
    `;

    const bindLiveWindowButtons = () => {
      container.querySelectorAll<HTMLButtonElement>('[data-live-win]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const sec = Number(btn.getAttribute('data-live-win')) as LiveWaveWindowSec;
          if (sec === 2 || sec === 5 || sec === 10 || sec === 30) {
            this.liveWindowSec = sec;
            this.renderTakeInspector();
          }
        });
      });
    };

    const st = this.getSelectedTake();
    const recBweDecl = resolveAiActionDeclaration('recorder-ai-denoise', this.getAiDenoiseActionContext());
    const mono = st ? mixToMono(st.take) : new Float32Array(0);
    const silences = st
      ? detectSilenceRanges(mono, st.take.sampleRate, {
          thresholdDb: this.silenceThresholdDb,
          minSilenceMs: this.minSilenceMs,
        })
      : [];
    const np = st ? normalizeNoiseProfile(st.take.noiseProfile) : undefined;
    const hasSelection =
      st !== null &&
      st.selectionStartFrame !== null &&
      st.selectionEndFrame !== null &&
      st.selectionEndFrame > st.selectionStartFrame;
    const selText = !st
      ? es
        ? `Ventana en Vivo: ${this.liveWindowSec}s (Zoom Constante)`
        : `Live Window: ${this.liveWindowSec}s (Constant Zoom)`
      : hasSelection
        ? es
          ? `Zona Ruido Seleccionada: ${((st.selectionStartFrame! / st.take.sampleRate) * 1000).toFixed(0)}..${((st.selectionEndFrame! / st.take.sampleRate) * 1000).toFixed(0)} ms`
          : `Selected Noise Zone: ${((st.selectionStartFrame! / st.take.sampleRate) * 1000).toFixed(0)}..${((st.selectionEndFrame! / st.take.sampleRate) * 1000).toFixed(0)} ms`
        : st.manifest
          ? es
            ? `${st.manifest.events.length} Cortes MIDI (${st.processedAutoSample?.extendedRegions.filter((r) => r.loopMode !== 'no_loop').length ?? 0} con AutoLoop)`
            : `${st.manifest.events.length} MIDI Note Slices (${st.processedAutoSample?.extendedRegions.filter((r) => r.loopMode !== 'no_loop').length ?? 0} AutoLooped)`
          : es
            ? 'Arrastra sobre la onda para seleccionar una región de Huella de Ruido'
            : 'Drag on waveform to select a Noise Print region';

    const npSummary = np
      ? `Floor: ${np.levelDbfs.toFixed(1)} dBFS · 50Hz: ${np.hum50HzDb.toFixed(1)} dB · 60Hz: ${np.hum60HzDb.toFixed(1)} dB ${st?.noiseRegionLabel ? `[${st.noiseRegionLabel}]` : ''}`
      : st
        ? es
          ? 'Sin huella capturada aún (pulsa Detectar Ruido o arrastra en la onda)'
          : 'No noise print captured yet (click Detect Noise or drag on waveform)'
        : es
          ? 'Se detectará automáticamente al finalizar la grabación (o con Detectar Ruido)'
          : 'Automatically detected when recording finishes (or via Detect Noise)';

    container.innerHTML = `
      <div class="nmm-recorder-inspector-card">
        <div class="nmm-audio-viewport-panel">
          <div class="nmm-recorder-inspector-head">
            <span class="nmm-recorder-inspector-title">${ICONS.wave} ${
              st
                ? `${escHtml(st.name)} • ${(st.take.sampleRate / 1000).toFixed(1)} kHz • ${st.take.durationSec.toFixed(2)}s`
                : es
                  ? 'FORMA DE ONDA EN VIVO Y INSPECTOR DE HUELLA DE RUIDO'
                  : 'LIVE SCROLLING WAVEFORM &amp; NOISE PRINT INSPECTOR'
            }</span>
            <div class="nmm-recorder-dsp-right">
              ${liveWindowControlsHtml}
              <span class="val-pill font-mono" id="rec-sel-readout">${escHtml(selText)}</span>
            </div>
          </div>

          <div class="nmm-audio-canvas-wrap">
            <canvas id="rec-wave-canvas" class="nmm-recorder-wave-canvas" width="960" height="160"></canvas>
          </div>

          <div class="nmm-audio-canvas-legend">
            ${
              st
                ? `
              <span>${es ? 'Arrastrar en onda = Seleccionar región <strong>Noise Print</strong> (Violeta)' : 'Drag on waveform = Select <strong>Noise Print</strong> region (Violet)'}</span>
              <span>• ${es ? 'Línea verde = <strong>NoteOn</strong>' : 'Green line = <strong>NoteOn</strong>'}</span>
              <span>• ${es ? 'Línea ámbar = <strong>NoteOff</strong>' : 'Amber line = <strong>NoteOff</strong>'}</span>
              <span>• ${es ? 'Línea cian = <strong>TailEnd / Corte</strong>' : 'Cyan line = <strong>TailEnd / Cut</strong>'}</span>
            `
                : `
              <span>${es ? `Grabación en vivo = Desplazamiento horizontal a zoom constante de <strong>${this.liveWindowSec}s</strong>` : `Live Recording = Scrolls horizontally at constant <strong>${this.liveWindowSec}s</strong> zoom (never squashes)`}</span>
              <span>• ${es ? 'Verde = <strong>NoteOn</strong>' : 'Green = <strong>NoteOn</strong>'}</span>
              <span>• ${es ? 'Ámbar = <strong>NoteOff</strong> (Inicio Release)' : 'Amber = <strong>NoteOff</strong> (Release start)'}</span>
              <span>• ${es ? 'Cian = <strong>TailEnd</strong> / Loop' : 'Cyan = <strong>TailEnd</strong> / Loop'}</span>
            `
            }
          </div>
        </div>

        <div class="nmm-audio-controls-card">
          <div class="nmm-recorder-params-grid">
            <div class="form-group">
              <div class="label-with-val">
                <label>${escHtml(MUSICIAN_TERMS.noisePrint)}</label>
                <span class="val-pill">${np ? (es ? 'ACTIVA' : 'ACTIVE') : this.autoDetectNoiseOnFinish ? 'AUTO' : (es ? 'NINGUNA' : 'NONE')}</span>
              </div>
              <div class="nmm-recorder-noise-readout-box" id="rec-noise-readout" title="${escHtml(npSummary)}">
                ${escHtml(npSummary)}
              </div>
            </div>

            <div class="form-group">
              <div class="label-with-val">
                <label for="sel-rec-denoise-mode">${es ? 'MODO DE MOTOR DENOISE' : 'DENOISE ENGINE MODE'}</label>
                <span class="val-pill font-mono">${
                  this.denoiseMode === 'algorithmic'
                    ? es ? 'ALGORÍTMICO' : 'ALGORITHMIC'
                    : this.denoiseMode === 'noise_print'
                      ? es ? 'HUELLA DE RUIDO' : 'NOISE PRINT'
                      : es ? 'IA NEURAL' : 'NEURAL AI'
                }</span>
              </div>
              <select id="sel-rec-denoise-mode" class="form-control form-control-sm" title="${es ? 'Selecciona el motor de reducción de ruido: Algorítmico (puerta espectral automática + notch 50/60Hz), Basado en Huella de Ruido (sustracción de perfil capturado) o con IA' : 'Select noise reduction engine: Algorithmic (auto spectral gate + 50/60Hz notch), Noise Print-based (captured profile subtraction) or AI'}">
                <option value="algorithmic" ${this.denoiseMode === 'algorithmic' ? 'selected' : ''}>${es ? 'Denoise Algorítmico (Puerta Espectral + Hum 50/60Hz)' : 'Algorithmic Denoise (Spectral Gate + 50/60Hz Hum)'}</option>
                <option value="noise_print" ${this.denoiseMode === 'noise_print' ? 'selected' : ''}>${es ? 'Denoise por Huella de Ruido (Sustracción Espectral)' : 'Noise Print Denoise (Spectral Subtraction)'}</option>
                <option value="ai" ${this.denoiseMode === 'ai' ? 'selected' : ''}>${es ? 'Denoise con IA (Companion Bridge + Supresión de Huella)' : 'AI Denoise (Companion Bridge + Print Suppression)'}</option>
              </select>
            </div>

            <div class="form-group">
              <div class="label-with-val">
                <label for="inp-rec-denoise-db">${es ? 'REDUCCIÓN DENOISE (dB)' : 'DENOISE REDUCTION (dB)'}</label>
                <span class="val-pill font-mono" id="lbl-rec-denoise-db">${this.denoiseReductionDb} dB</span>
              </div>
              <input type="number" id="inp-rec-denoise-db" class="form-control form-control-sm font-mono" value="${this.denoiseReductionDb}" min="3" max="36" step="1" />
            </div>
          </div>

          <div class="nmm-recorder-dsp-toolbar">
            <div class="nmm-recorder-dsp-left">
              <label class="batch-check" title="${es ? 'Normalizar automáticamente a -1.0 dBFS + filtro DC Block al finalizar cada grabación' : 'Automatically normalize to -1.0 dBFS + DC Block filter when each recording finishes'}">
                <input type="checkbox" class="articulation-checkbox switch--sm" id="rec-chk-auto-norm" ${this.autoNormalizeOnFinish ? 'checked' : ''} />
                <span>${es ? 'Normalizar al grabar (-1 dBFS)' : 'Normalize on record (-1 dBFS)'}</span>
              </label>
              <label class="batch-check" title="${es ? 'Detectar y capturar automáticamente la huella de ruido del suelo estacionario al finalizar cada grabación' : 'Automatically detect and capture stationary noise floor print when each recording finishes'}">
                <input type="checkbox" class="articulation-checkbox switch--sm" id="rec-chk-auto-noise" ${this.autoDetectNoiseOnFinish ? 'checked' : ''} />
                <span>${es ? 'Detectar Ruido (Auto)' : 'Detect Noise (Auto)'}</span>
              </label>

              <button type="button" class="btn btn-sm btn-outline" id="btn-rec-capture-noise" ${!st ? 'disabled' : ''} title="${es ? 'Detectar suelo de ruido automáticamente o capturar la zona seleccionada en la onda' : 'Auto-detect noise floor or capture selected region on waveform'}">
                ${ICONS.search} ${es ? 'Detectar Ruido / Huella' : 'Detect Noise / Print'}
              </button>
              <button type="button" class="btn btn-sm btn-outline" id="btn-rec-algo-denoise" ${!st ? 'disabled' : ''} title="${es ? 'Denoise Algorítmico: puerta espectral automática sobre el suelo estacionario + filtro DC + notch 50/60 Hz' : 'Algorithmic Denoise: auto spectral gate on stationary floor + DC filter + 50/60 Hz notch'}">
                ${ICONS.sliders} ${es ? 'Denoise Algorítmico' : 'Algorithmic Denoise'}
              </button>
              <button type="button" class="btn btn-sm btn-outline" id="btn-rec-dsp-denoise" ${!st ? 'disabled' : ''} title="${es ? 'Denoise basado en Huella de Ruido: sustracción espectral de 16 bandas usando la huella capturada + notch 50/60 Hz' : 'Noise Print Denoise: 16-band spectral subtraction using captured print + 50/60 Hz notch'}">
                ${ICONS.wave} ${es ? 'Denoise (Huella)' : 'Denoise (Print)'}
              </button>
              <button type="button" class="btn btn-sm btn-ai-accent" id="btn-rec-ai-enhance" ${!st ? 'disabled' : ''} title="${escHtml(recBweDecl.buttonTooltip)}">
                ${ICONS.sparkle} ${es ? 'Denoise IA' : 'AI Denoise'}
              </button>
              <button type="button" class="btn btn-sm btn-outline" id="btn-rec-normalize" ${!st ? 'disabled' : ''} title="${es ? 'Aplicar filtro DC Block y Normalización de Pico a -1.0 dBFS sobre la toma seleccionada' : 'Apply DC Block filter and Peak Normalization to -1.0 dBFS on selected take'}">
                ${ICONS.zap} ${es ? 'Normalizar (-1 dBFS + DC)' : 'Normalize (-1 dBFS + DC)'}
              </button>
            </div>

            <div class="nmm-recorder-dsp-right">
              <button type="button" class="btn btn-sm btn-outline" id="btn-rec-undo-take" ${!st || st.history.length === 0 ? 'disabled' : ''} title="${es ? 'Deshacer última edición en esta toma' : 'Undo last edit on this take'}">
                ${ICONS.undo} ${es ? 'Deshacer' : 'Undo'} (${st ? st.history.length : 0})
              </button>
              <button type="button" class="btn btn-sm btn-accent" id="btn-rec-play-sel" ${!st ? 'disabled' : ''} title="${es ? 'Escuchar región seleccionada (o toma completa)' : 'Audition selected region (or full take)'}">
                ${ICONS.play} ${hasSelection ? (es ? 'Oír Selección' : 'Play Selection') : (es ? 'Oír Toma' : 'Play Take')}
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    if (st) {
      this.drawTakeWaveform(st, mono, silences);
      this.bindWaveCanvasEvents(st, mono, silences);
    }
    bindLiveWindowButtons();

    container.querySelector('#rec-chk-auto-norm')?.addEventListener('change', (e) => {
      this.autoNormalizeOnFinish = (e.target as HTMLInputElement).checked;
    });
    container.querySelector('#rec-chk-auto-noise')?.addEventListener('change', (e) => {
      this.autoDetectNoiseOnFinish = (e.target as HTMLInputElement).checked;
      this.renderTakeInspector();
    });
    container.querySelector('#sel-rec-denoise-mode')?.addEventListener('change', (e) => {
      const mode = (e.target as HTMLSelectElement).value as 'algorithmic' | 'noise_print' | 'ai';
      if (mode === 'algorithmic' || mode === 'noise_print' || mode === 'ai') {
        this.denoiseMode = mode;
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

    if (st) {
      container
        .querySelector('#btn-rec-play-sel')
        ?.addEventListener('click', () => this.auditionSelectedRegion());
      container
        .querySelector('#btn-rec-capture-noise')
        ?.addEventListener('click', () => this.captureNoisePrintFromSelection(st.id));
      container
        .querySelector('#btn-rec-algo-denoise')
        ?.addEventListener('click', () => this.applyAlgorithmicDenoiseToTake(st.id));
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
  }

  /**
   * Fase 37.2: Dibuja en vivo la forma de onda desplazándose horizontalmente con
   * nivel de zoom constante (`this.liveWindowSec` segundos en el ancho del canvas),
   * de modo que nunca se achata a medida que avanza la grabación y permite ver
   * modulaciones de LFO/chorus y marcas vivas `NoteOn` / `NoteOff` / `TailEnd`.
   */
  private drawLiveScrollingWaveform(
    recentMono: Float32Array,
    sampleRate: number,
    totalRecordedFrames: number
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
    const okColor = styles.getPropertyValue('--color-success').trim() || waveColor;
    const warnColor = styles.getPropertyValue('--color-warning').trim() || waveColor;
    const borderColor = styles.getPropertyValue('--color-panel-border-dim').trim() || 'currentColor';

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();

    const windowFrames = Math.max(1, Math.round(this.liveWindowSec * sampleRate));
    const windowStartFrame = Math.max(0, totalRecordedFrames - windowFrames);

    // Si aún se ha grabado menos que la ventana completa, empieza por la izquierda y avanza hasta llenarla; luego desplaza la ventana
    const activeSpanFrames = Math.min(windowFrames, recentMono.length);
    if (activeSpanFrames > 0) {
      ctx.strokeStyle = waveColor;
      ctx.lineWidth = 1.2;
      ctx.beginPath();

      for (let x = 0; x < w; x++) {
        const fRelStart = Math.floor((x / w) * windowFrames);
        if (fRelStart >= activeSpanFrames) break;
        const fRelEnd = Math.min(
          activeSpanFrames,
          Math.max(fRelStart + 1, Math.floor(((x + 1) / w) * windowFrames))
        );
        let min = 0;
        let max = 0;
        for (let i = fRelStart; i < fRelEnd; i++) {
          const v = recentMono[i];
          if (v < min) min = v;
          if (v > max) max = v;
        }
        const yTop = midY - max * (midY - 4);
        const yBot = midY - min * (midY - 4);
        ctx.moveTo(x, yTop);
        ctx.lineTo(x, Math.max(yTop + 1, yBot));
      }
      ctx.stroke();
    }

    // Marcas vivas de NoteOn (verde), NoteOff (ámbar) y TailEnd (cian) dentro de la ventana visible
    const visibleFrameBase = totalRecordedFrames > windowFrames ? windowStartFrame : 0;
    for (const mk of this.liveMarkers) {
      if (mk.frame < visibleFrameBase || mk.frame > visibleFrameBase + windowFrames) continue;
      const x = ((mk.frame - visibleFrameBase) / windowFrames) * w;
      ctx.strokeStyle =
        mk.kind === 'noteOn' ? okColor : mk.kind === 'noteOff' ? warnColor : waveColor;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();

      if (mk.kind === 'noteOn' && mk.label) {
        ctx.fillStyle = okColor;
        ctx.font = '10px monospace';
        ctx.fillText(mk.label, Math.min(w - 60, x + 3), 12);
      }
    }
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
    const okColor = styles.getPropertyValue('--color-success').trim() || waveColor;
    const warnColor = styles.getPropertyValue('--color-warning').trim() || 'currentColor';
    const aiColor = styles.getPropertyValue('--color-ai').trim() || waveColor;
    const borderColor = styles.getPropertyValue('--color-panel-border-dim').trim() || 'currentColor';

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);

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

    // 3. Si el take tiene manifiesto AutoSampler, dibujar sus puntos de corte (NoteOn, NoteOff, TailEnd)
    if (st.manifest && st.manifest.events.length > 0) {
      const offsetFrames = Math.round(
        (this.autoSamplerConfig.extraLatencyOffsetMs / 1000) * st.take.sampleRate
      );
      for (const ev of st.manifest.events) {
        if (ev.tailEndFrame <= ev.noteOnFrame) continue;
        const fOn = Math.max(0, Math.min(mono.length, ev.noteOnFrame + offsetFrames));
        const fOff = Math.max(fOn, Math.min(mono.length, ev.noteOffFrame + offsetFrames));
        const fEnd = Math.max(fOff, Math.min(mono.length, ev.tailEndFrame + offsetFrames));

        const xOn = (fOn / mono.length) * w;
        const xOff = (fOff / mono.length) * w;
        const xEnd = (fEnd / mono.length) * w;

        // NoteOn (verde)
        ctx.strokeStyle = okColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(xOn, 0);
        ctx.lineTo(xOn, h);
        ctx.stroke();

        // NoteOff (ámbar)
        ctx.strokeStyle = warnColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(xOff, 0);
        ctx.lineTo(xOff, h);
        ctx.stroke();

        // TailEnd (cian)
        ctx.strokeStyle = waveColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(xEnd, 0);
        ctx.lineTo(xEnd, h);
        ctx.stroke();

        ctx.fillStyle = okColor;
        ctx.font = '10px monospace';
        ctx.fillText(
          `${ev.customName || ev.noteName} v${ev.velocity}`,
          Math.min(w - 54, xOn + 3),
          12
        );
      }
    }

    // 4. Dibujar selección de región de ruido (Noise Print)
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
    const es = isEs();
    if (count) count.textContent = String(this.takes.length);
    if (this.takes.length === 0) {
      list.innerHTML = `<div class="nmm-recorder-takes-empty">${es ? 'Aún no hay tomas — activa la entrada de audio y pulsa REC / INICIAR BARRIDO.' : 'No takes yet — enable audio input and press REC / START SWEEP.'}</div>`;
      return;
    }
    const activeId = this.getSelectedTake()?.id ?? null;
    list.innerHTML = this.takes
      .map((t) => {
        const cls = t.take.classification === 'unknown' ? (es ? 'sin clasificar' : 'unclassified') : t.take.classification;
        const isSelected = t.id === activeId;
        const sliceBadge = t.manifest
          ? `<span class="panel-badge badge-ai-on">${t.manifest.events.length} ${es ? 'cortes MIDI' : 'MIDI cuts'}</span>`
          : `<span class="panel-badge badge-ai-on">${escHtml(cls)} ${(t.take.classificationConfidence * 100).toFixed(0)}%</span>`;
        return `
        <div class="nmm-recorder-take${isSelected ? ' is-selected' : ''}" data-take-id="${escHtml(t.id)}">
          <span class="nmm-recorder-take-name">${escHtml(t.name)}</span>
          <span class="val-pill font-mono">${t.take.durationSec.toFixed(2)}s · ${t.take.peakDbfs.toFixed(1)} dBFS · ${(t.take.sampleRate / 1000).toFixed(0)}k</span>
          ${sliceBadge}
          <span class="nmm-recorder-take-actions">
            <button type="button" class="btn btn-xs btn-outline" data-act="audition" title="${es ? 'Escuchar toma' : 'Audition take'}">${ICONS.play}</button>
            <button type="button" class="btn btn-xs btn-outline" data-act="chopper" title="${es ? 'Enviar a Audio Chopper / AutoSlicer' : 'Send to Audio Chopper / AutoSlicer'}">${ICONS.scissors}</button>
            ${
              this.context.onInjectTakeIntoSession || this.context.onInjectAutoSampledInstrument
                ? `<button type="button" class="btn btn-xs btn-outline" data-act="inject" title="${es ? 'Inyectar en Sesión' : 'Inject into Session'}">${ICONS.plus}</button>`
                : ''
            }
            <button type="button" class="btn btn-xs btn-outline" data-act="download" title="${es ? 'Descargar WAV' : 'Download WAV'}">${ICONS.download}</button>
            <button type="button" class="btn btn-xs btn-outline" data-act="delete" title="${es ? 'Eliminar toma' : 'Delete take'}">${ICONS.trash}</button>
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

  // ── Estado vivo: medidores + LCD + onda en vivo con zoom constante ────────

  private setBusy(busy: boolean): void {
    this.backdropEl
      ?.querySelectorAll<HTMLButtonElement>('#btn-rec-enable-mic, #btn-rec-refresh-devices')
      .forEach((b) => {
        b.disabled = busy;
      });
  }

  private syncTransportState(): void {
    if (!this.backdropEl) return;
    const es = isEs();
    const state: RecorderState = this.capture.isOpen() ? this.capture.getState() : 'idle';
    const badge = this.backdropEl.querySelector('#rec-state-badge');
    if (badge) {
      badge.textContent = this.isSweepRunning ? (es ? 'BARRIENDO' : 'SWEEPING') : STATE_BADGE[state];
      badge.className = `panel-badge ${state === 'recording' || this.isSweepRunning ? 'badge-ai-on' : 'badge-muted'}`;
    }
    const dot = this.backdropEl.querySelector('#rec-state-dot');
    if (dot) {
      dot.className = `nmm-recorder-rec-dot${state === 'recording' || this.isSweepRunning ? ' is-rec' : ''}${state === 'paused' ? ' is-paused' : ''}`;
    }
    const recBtn = this.backdropEl.querySelector<HTMLButtonElement>('#btn-rec-record');
    if (recBtn) {
      const isAsSweep =
        this.operatingMode === 'midi_autosampler' &&
        this.autoSamplerConfig.mode !== 'live_midi_capture';
      recBtn.disabled = !this.capture.isOpen() && !isAsSweep;
      if (isAsSweep) {
        recBtn.innerHTML = this.isSweepRunning
          ? `${ICONS.pause} ${es ? 'PAUSAR BARRIDO' : 'PAUSE SWEEP'}`
          : `${ICONS.record} ${es ? 'INICIAR BARRIDO' : 'START SWEEP'}`;
      } else {
        recBtn.innerHTML =
          state === 'recording'
            ? `${ICONS.pause} ${es ? 'PAUSAR' : 'PAUSE'}`
            : state === 'paused'
              ? `${ICONS.play} ${es ? 'REANUDAR' : 'RESUME'}`
              : `${ICONS.record} REC`;
      }
    }
    const stopBtn = this.backdropEl.querySelector<HTMLButtonElement>('#btn-rec-stop');
    if (stopBtn) stopBtn.disabled = state !== 'recording' && state !== 'paused' && !this.isSweepRunning;
    const cancelBtn = this.backdropEl.querySelector<HTMLButtonElement>('#btn-rec-cancel');
    if (cancelBtn) cancelBtn.disabled = state !== 'recording' && state !== 'paused' && !this.isSweepRunning;
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
          const recSec = engine.getRecordedSec();
          const time = this.backdropEl.querySelector('#rec-lcd-time');
          if (time) time.textContent = formatTakeTime(recSec);
          const peak = this.backdropEl.querySelector('#rec-peak-pill');
          if (peak) {
            peak.textContent =
              levels.peakDbfs === -Infinity ? '−∞ dBFS' : `${levels.peakDbfs.toFixed(1)} dBFS`;
          }

          // Fase 37.2: Si está grabando en este momento, dibujar la forma de onda desplazándose con zoom constante
          if (engine.getState() === 'recording') {
            const sr = engine.getSampleRate();
            const winFrames = Math.max(128, Math.round(this.liveWindowSec * sr));
            const recentMono = engine.getRecentMonoSamples(winFrames);
            const totalFrames = Math.round(recSec * sr);
            this.drawLiveScrollingWaveform(recentMono, sr, totalFrames);
            if (this.liveTracker) {
              this.liveTracker.pollReleaseTails(recentMono);
            }
          }

          this.syncTransportState();
        });
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }
}
