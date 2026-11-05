import type { MidiAutoSampleManifest, MidiCapturedNoteEvent } from '@abdsynths/shared/contracts/recordingSession';
import type { FinalizedTake } from '@abdsynths/shared/dsp/take/recordingEngine.ts';
import type { NoiseProfile, PilotNoteRecommendation, SilenceRange } from '@abdsynths/shared/dsp/take/takeDsp.ts';
import { AudioCaptureService } from '../../core/AudioCaptureService.ts';
import type { AiActionContext } from '../../core/ai/aiHonesty.ts';
import { LiveMidiCaptureTracker, type AutoSamplerConfig, type AutoSamplerProcessedOutput } from '../../core/autoSampler/MidiAutoSampleSession.ts';
import { WebMidiAutoSamplerService, type MidiPortDescriptor } from '../../core/midi/WebMidiAutoSamplerService.ts';
import type { AiAssistanceConfig, ExtendedRegion, Zone } from '../../core/types.ts';
import type { FocusTrap } from '../modalFocusTrap.ts';
import type { ConfirmOptions } from '../notify.ts';

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


export interface RecorderState {
  backdropEl: HTMLElement | null;
  focusTrap: FocusTrap | null;
  capture: AudioCaptureService;
  midi: WebMidiAutoSamplerService;
  context: AudioRecorderContext;
  devices: MediaDeviceInfo[];
  selectedDeviceId: string;
  takes: SessionTake[];
  selectedTakeId: string | null;
  takeSeq: number;
  rafId: number;
  opening: boolean;
  silenceThresholdDb: number;
  minSilenceMs: number;
  denoiseReductionDb: number;
  autoNormalizeOnFinish: boolean;
  autoDetectNoiseOnFinish: boolean;
  denoiseMode: 'algorithmic' | 'noise_print' | 'ai';
  isDraggingSelection: boolean;
  dragAnchorFrame: number;
  operatingMode: RecorderOperatingMode;
  liveWindowSec: LiveWaveWindowSec;
  autoSamplerConfig: AutoSamplerConfig;
  midiOutputs: MidiPortDescriptor[];
  midiInputs: MidiPortDescriptor[];
  activeSchedule: MidiCapturedNoteEvent[];
  isSweepRunning: boolean;
  sweepAbortRequested: boolean;
  liveTracker: LiveMidiCaptureTracker | null;
  liveMidiUnsub: (() => void) | null;
  liveMarkers: Array<{ frame: number; kind: 'noteOn' | 'noteOff' | 'tailEnd'; label: string }>;
  showDrumHelpPanel: boolean;
  showManualExtractorPanel: boolean;
  pilotDiagnosticText: string;
  lastPilotRecommendation: PilotNoteRecommendation | null;
}

export interface RecorderContext {
  state: RecorderState;
  applyAiEnhanceToTake(takeId?: string): Promise<boolean>;
  applyAlgorithmicDenoiseToTake(takeId?: string): boolean;
  applyDspDenoiseToTake(takeId?: string): boolean;
  applyNormalizeAndDcBlockToTake(mode: 'peak' | 'rms', takeId?: string): boolean;
  auditionSelectedRegion(): void;
  auditionTake(id: string): void;
  bindWaveCanvasEvents(st: SessionTake, mono: Float32Array, silences: SilenceRange[]): void;
  cancelAndDiscard(): void;
  captureNoisePrintFromSelection(takeId?: string): NoiseProfile | null;
  close(): Promise<void>;
  deleteTake(id: string): void;
  downloadTake(id: string): void;
  drawTakeWaveform(st: SessionTake, mono: Float32Array, silences: SilenceRange[]): void;
  enableMic(): Promise<void>;
  finishTake(rawTake: FinalizedTake, customName?: string, explicitManifest?: MidiAutoSampleManifest): SessionTake;
  getAiDenoiseActionContext(): AiActionContext;
  getSelectedTake(): SessionTake | null;
  injectTakeIntoSession(id: string): void;
  pushUndoSnapshot(st: SessionTake): void;
  rebuildTakeFromChannels(st: SessionTake, channels: Float32Array[], sampleRate: number, noiseProfile: NoiseProfile | undefined): void;
  refreshDevices(): Promise<void>;
  refreshMidiPorts(): Promise<void>;
  render(): void;
  renderAutoSamplerDeck(): void;
  renderAutoSamplerGrid(): void;
  renderTakeInspector(): void;
  renderTakes(): void;
  renderTransport(): void;
  runAutoSamplerPostProcessOnTake(st: SessionTake): AutoSamplerProcessedOutput | null;
  runAutoSamplerSweep(options?: {
    resumeTakeId?: string;
    specificCellIndex?: number;
  }): Promise<SessionTake | null>;
  runPilotCalibration(): Promise<void>;
  selectTake(id: string): void;
  sendTakeToChopper(id: string): void;
  setBusy(busy: boolean): void;
  startMeterLoop(): void;
  stopAndKeep(): void;
  syncTransportState(): void;
  toggleLiveMidiCapture(): Promise<void>;
  toggleRecord(): Promise<void>;
  undoTakeEdit(takeId?: string): boolean;
}
