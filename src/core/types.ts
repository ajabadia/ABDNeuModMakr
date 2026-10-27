// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Domain types
// Mirrors the Neuron MODELmaker data model documented in
// the Hartmann manual and NeuronVS investigation.
// ─────────────────────────────────────────────────────────

/** MIDI note number 0..127 */
export type MidiNote = number;

/** Model slot number 0..511 */
export type ModelSlot = number;

/**
 * A keyboard zone — the fundamental unit of a MODELmaker session.
 * Zones cover the full MIDI range 0..127 without gaps or overlaps.
 */
export interface Zone {
  id: string;
  lowKey: MidiNote;    // inclusive (0..127)
  rootKey: MidiNote;
  highKey: MidiNote;   // inclusive (0..127)
  sampleLow: string | null;   // file path / name — required (Low Vel: 1 .. velSplit-1, or 1..127 if sampleHigh is null)
  sampleHigh: string | null;  // file path / name — optional (High Vel: velSplit .. 127)
  velSplit?: number;   // Velocity split point 2..127 (canonical Hartmann default = 64: Low 1..63, High 64..127)
  detune: number;      // -99 .. +99 cents
  volume: number;      // -32 .. +12 dB
  pan: number;         // -50 .. +50
}

/**
 * Parameter set 0..9 — defines which Scape/Sphere parameter
 * families are available after model generation.
 */
export interface ParameterSetInfo {
  id: number;          // 0..9
  name: string;
  description: string;
  category: string;    // e.g. "Neutral", "Strings", "Piano", "Pads"...
}

/**
 * Output target format profile:
 *   - 'dual': Generates both Legacy Neuron (.scape/.sphere/map.script @ 44.1kHz mono)
 *             and Modern Neural (.neuronikmodel v2.1 Float32 multi-layer) artifacts.
 *   - 'legacy-neuron': Strict Hartmann Neuron Hardware / NeuronVS 1.x format.
 *   - 'modern-neural': Extended high-resolution Float32 multi-layer format for ABDNeural.
 */
export type TargetFormat = 'dual' | 'legacy-neuron' | 'modern-neural';

/**
 * Process configuration — the settings for model generation.
 */
export interface ProcessConfig {
  modelNumber: ModelSlot;     // 0..511
  modelName: string;          // max 11 characters
  complexity: number;         // 1..10, default 8
  parameterSet: number;       // 0..9
  targetFormat?: TargetFormat; // default 'dual'
}

/** Process execution state */
export type ProcessStatus = 'idle' | 'running' | 'completed' | 'error' | 'cancelled';

export interface ProcessProgress {
  status: ProcessStatus;
  currentZone: number;
  totalZones: number;
  currentSample: string;
  percent: number;             // 0..100
  message: string;
  elapsedMs: number;
}

/**
 * A session — the top-level container for a MODELmaker editing session.
 * Contains zones + process config + metadata.
 */
export interface Session {
  id: string;
  name: string;
  zones: Zone[];
  processConfig: ProcessConfig;
  dirty: boolean;
  createdAt: string;
  modifiedAt: string;
}

/**
 * A generated model — the output of the Process step.
 */
export interface GeneratedModel {
  slot: ModelSlot;
  name: string;
  zoneCount: number;
  complexity: number;
  parameterSet: number;
  createdAt: string;
  path: string;                // where the model files live
  targetFormat?: TargetFormat;
  zonesAnalysis?: ZoneAnalysisSummary[];
  neuronikModelJson?: string;
}

/**
 * Per-zone spectral analysis summary produced by WebAudioPipeline.
 */
export interface ZoneAnalysisSummary {
  zoneId: string;
  lowKey: MidiNote;
  rootKey: MidiNote;
  highKey: MidiNote;
  sampleName: string;
  sampleRate: number;
  durationSec: number;
  detectedF0Hz: number;
  targetF0Hz: number;
  gridResidualCents: number;
  gridObservations: number;
  gridBand: 'no-data' | 'green' | 'amber' | 'orange';
  gridNotice: string;
  layerCount: number;
  frameCount: number;
  activePartials: number;
  octaveFoldCents: number;
  biGrid: boolean;
  amplitudes: number[];        // 64 canonical harmonic partial amplitudes (0..1)
  frequencyOffsets: number[];  // 64 canonical harmonic frequency offsets (Hz)
}

/**
 * Temporal trajectory of a single harmonic partial across STFT frames,
 * tagged with its clustered neural layer index (0..3).
 */
export interface SpectralPartialTrack {
  partialIndex: number;        // 1..64 (1 = fundamental f0)
  harmonicMultiple: number;    // 1..64 (or 0.5n for interlaced sub-grid)
  layerIndex: number;          // 0..3 (clustered layer assignment)
  meanAmplitude: number;       // 0..1
  frames: {
    timeNorm: number;          // 0..1 normalized time
    freqHz: number;            // instantaneous frequency in Hz
    amplitude: number;         // normalized amplitude 0..1
  }[];
}

/**
 * Rich spectral & waveform inspection payload for Phase 4 (`SpectralView.ts`),
 * combining 2D STFT spectrogram, harmonic partial trajectories, and A/B waveforms.
 */
export interface ZoneSpectralInspection {
  zoneId: string;
  sampleName: string;
  sampleRate: number;
  durationSec: number;
  summary: ZoneAnalysisSummary;
  /** Downsampled [min, max] envelope peaks (e.g. 200 columns) for the original sample (A) */
  waveformPeaks: { min: number[]; max: number[]; rmsDb: number };
  /** Downsampled [min, max] envelope peaks (e.g. 200 columns) for the Scape/Sphere resynthesis (B) */
  resynthPeaks: { min: number[]; max: number[]; rmsDb: number };
  /** 2D time-frequency spectrogram grid (normalized 0..1 dB magnitude) */
  spectrogram: {
    frameCount: number;
    binCount: number;
    maxFreqHz: number;
    magnitudes: number[][];    // [frameIndex][binIndex] in 0..1
  };
  /** Tracked harmonic partials with layer clustering assignments */
  partialTracks: SpectralPartialTrack[];
}

/**
 * A sound preset entry in the bank (from NeuronDB).
 */
export interface SoundPreset {
  slot: number;                // 0..511
  name: string;
  modelIndex: ModelSlot;
  category: string;
  parameterCount: number;
}

/**
 * Bank summary — aggregate view of models + presets.
 */
export interface BankSummary {
  models: GeneratedModel[];
  presets: SoundPreset[];
  totalModels: number;
  totalPresets: number;
}

/**
 * Undo/Redo history telemetry for Phase 5 UX.
 */
export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  undoCount: number;
  redoCount: number;
}

/** Event types the CoreService can emit */
export type CoreEvent =
  | { type: 'session-changed'; session: Session }
  | { type: 'process-progress'; progress: ProcessProgress }
  | { type: 'process-complete'; model: GeneratedModel }
  | { type: 'process-error'; error: string }
  | { type: 'bank-updated'; bank: BankSummary }
  | { type: 'history-changed'; history: HistoryState };

/** Normalized waveform envelope data for zone ribbons */
export interface ZoneRibbonWaveforms {
  lowOriginal: number[];
  highOriginal: number[] | null;
  processed: number[] | null;
  hasProcessed: boolean;
}

/** Audio source inspection across session zones */
export interface ProcessSourcesInspection {
  importedSources: string[];
  newAudioSources: string[];
  importedComplexity: number | null;
  complexityChanged: boolean;
}

export type {
  DecodedWav,
  WavFormatTag,
  AiffInstrumentInfo,
} from '@abdsynths/shared/formats/neuron';

/** In-memory audio file payload for imports */
export interface AudioFilePayload {
  name: string;
  buffer: ArrayBuffer;
}

