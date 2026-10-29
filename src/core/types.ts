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
/**
 * Editing working mode:
 *   - 'classic': Canonical Hartmann MODELmaker v1.2 rules (contiguous 0..127 columns, 2 velocity layers split at 64).
 *   - 'extended': Free 2D Key x Velocity regions (N velocity layers, asymmetric ranges, crossfades, loops, keytrack, ADSR/Filter/LFO).
 * Can be toggled freely at any time; when exporting to classic ('legacy-neuron' or 'dual'), extended regions are adapted automatically.
 */
export type WorkingMode = 'classic' | 'extended';

/**
 * Fase 7 — Classic DSP Analysis Algorithm:
 *   - 'legacy': Canonical 2001 Hartmann NASAnalysis.dll spectral peak-picking & frame quantization.
 *   - 'enhanced': Phase 7 Classic Enhanced DSP with HPSS transient/stationary separation,
 *                 hybrid YIN/MPM + HPS pitch detection, and temporal partial trajectory smoothing.
 */
export type DspAlgorithmMode = 'legacy' | 'enhanced';

/**
 * Fase 7.1 & 7.2 — Acoustic descriptors extracted from a zone's audio waveform and spectrum.
 */
export interface AcousticDescriptors {
  detectedF0Hz: number;
  detectedMidiNote: MidiNote;
  detectedCentOffset: number;
  /** Time-domain YIN/MPM harmonic periodicity (0 = pure noise, 1 = pure periodic wave) */
  harmonicity: number;
  /** Combined time + frequency pitch confidence (0..1) */
  pitchConfidence: number;
  /** True when sound is percussive, inharmonic, or noise (suggests pitchKeytrack = 0 in Extended mode) */
  isPercussiveOrNoise: boolean;
  /** log10(attackSec) from 10% to 90% peak envelope */
  logAttackTime: number;
  /** Attack duration in milliseconds */
  attackMs: number;
  /** Partial stiffness / inharmonicity coefficient B (f_n = n * f0 * sqrt(1 + B * n^2)) */
  inharmonicityB: number;
  /** Wiener entropy / spectral flatness (0 = pure tone, 1 = white noise) */
  spectralFlatness: number;
  /** Brightness center of mass in Hz */
  spectralCentroidHz: number;
  /** Normalized zero-crossing rate (0..1) */
  zeroCrossingRate: number;
  /** Ratio of sustain RMS to peak RMS (0..1) */
  sustainRatio: number;
  /** Detected rhythmic onset density in onsets/sec (identifies Set 8 Loop Factory) */
  transientDensityHz: number;
}

/**
 * Fase 7.2 — Automatic Instrument Category & Parameter Set (0..9) classification result.
 */
export interface AcousticClassificationResult {
  detectedCategory: string;
  recommendedParameterSet: number; // 0..9
  confidence: number;              // 0..1
  rationale: string;
  descriptors: AcousticDescriptors;
}

/**
 * Fase 7.3 — Objective quality comparison between Original Source (A), Legacy DSP (B), and Enhanced DSP (C).
 */
export interface DspQualityScore {
  overallScore: number;            // 0..100 (for active DSP algorithm)
  legacyScore: number;             // 0..100
  enhancedScore: number;           // 0..100
  spectralSnrDb: number;
  envelopeCorrelation: number;     // 0..1
  harmonicFidelity: number;        // 0..1
  transientFidelity: number;       // 0..1
}

export type LoopMode = 'no_loop' | 'loop_continuous' | 'loop_sustain' | 'one_shot';
export type TriggerMode = 'attack' | 'release' | 'first' | 'legato';
export type CrossfadeCurve = 'linear' | 'equal-power' | 'spectral-morph';

/** 6-stage DAHDSR envelope (compatible with SF2, SFZ, HALion, Kontakt) */
export interface DahdsrEnvelope {
  delaySec: number;
  attackSec: number;
  holdSec: number;
  decaySec: number;
  sustainLevel: number; // 0..1 (1 = 0 dB attenuation, 0 = -100 dB)
  releaseSec: number;
}

/** Filter configuration (safe-mapped to Neuron Silver filter when enabled) */
export interface RegionFilterConfig {
  enabled: boolean;
  type: 'lpf' | 'hpf' | 'bpf';
  cutoffHz: number;          // 20..20000 Hz
  resonanceDb: number;       // 0..40 dB
  envToFilterCents: number;  // -12000..+12000 cents
  velToFilterCents: number;  // -12000..+12000 cents
  keytrackCents: number;     // 0..1200 cents/octave (0..100%)
}

/** LFO configuration (safe-mapped to Neuron LFO with isolated destination depths) */
export interface RegionLfoConfig {
  enabled: boolean;
  delaySec: number;
  freqHz: number;            // 0.01..50 Hz
  toPitchCents: number;      // Vibrato depth (-1200..+1200 cents)
  toFilterCents: number;     // Wah/Filter LFO depth (-12000..+12000 cents)
  toVolumeDb: number;        // Tremolo depth (0..24 dB)
  waveform?: number;         // 0=Sine/Tri, etc.
}

/**
 * Global instrument articulation & modulation extracted from SF2/SFZ/Sampler
 * or edited in the Extended Editor. Safe-mapped to `sound.script` only for
 * enabled blocks so it never modulates unintended synth parameters.
 */
export interface SynthArticulationConfig {
  ampEnvEnabled: boolean;
  ampEnv: DahdsrEnvelope;
  modEnvEnabled: boolean;
  modEnv: DahdsrEnvelope;
  modEnvToPitchCents: number;
  filter: RegionFilterConfig;
  vibLfo: RegionLfoConfig;
  modLfo: RegionLfoConfig;
  /** Optional: bake amplitude/filter decay into the audio wave before classic spectral analysis */
  bakeEnvelopeIntoWave?: boolean;
}

/**
 * A free 2D Key x Velocity region in Extended Creation Mode ("Lego" layout).
 * Stores native sampler parameters (N velocity layers, asymmetric key ranges,
 * crossfades, loop points, pitch keytracking, trigger mode, and local overrides).
 */
export interface ExtendedRegion {
  id: string;
  sampleName: string;
  lowKey: MidiNote;          // 0..127
  highKey: MidiNote;         // 0..127
  rootKey: MidiNote;         // 0..127
  lowVel: number;            // 1..127
  highVel: number;           // 1..127
  detune: number;            // -99..+99 cents
  volume: number;            // -32..+12 dB
  pan: number;               // -50..+50
  pitchKeytrack: number;     // 0..100 % (100 = chromatic, 0 = unpitched/drum)
  trigger: TriggerMode;      // 'attack' | 'release' | 'first' | 'legato'
  seqPosition?: number;      // Round-robin index (1..N)
  seqLength?: number;        // Round-robin total (1..N)
  keyFadeIn: number;         // Semitones fade-in at lowKey
  keyFadeOut: number;        // Semitones fade-out at highKey
  velFadeIn: number;         // Velocity units fade-in at lowVel
  velFadeOut: number;        // Velocity units fade-out at highVel
  fadeCurve: CrossfadeCurve;
  loopMode: LoopMode;
  loopStart: number;         // Loop start in sample frames
  loopEnd: number;           // Loop end in sample frames
  loopCrossfadeMs: number;   // Crossfade duration in ms for seamless looping
  sampleRate?: number;
  numChannels?: number;      // 1 = mono, 2 = stereo (merged L/R), 4 = quad
  ampEnvOverride?: Partial<DahdsrEnvelope>;
  filterOverride?: Partial<RegionFilterConfig>;
}

/** Summary of a preset inside a multi-preset SoundFont (.sf2) file */
export interface Sf2PresetOption {
  index: number;
  name: string;
  bank: number;
  presetNumber: number;
  regionCount: number;
  sampleCount: number;
}

export interface ProcessConfig {
  modelNumber: ModelSlot;     // 0..511
  modelName: string;          // max 11 characters
  complexity: number;         // 1..10, default 8
  parameterSet: number;       // 0..9
  targetFormat?: TargetFormat; // default 'dual'
  /**
   * Editing working mode:
   * - 'classic' (default): Canonical Hartmann MODELmaker v1.2 behavior (contiguous 0..127 columns, 2 velocity layers split at 64).
   * - 'extended': Free 2D Key x Velocity regions (N velocity layers, asymmetric ranges, crossfades, loops, keytrack, ADSR/Filter/LFO).
   * Can be toggled freely under any targetFormat ('dual', 'legacy-neuron', 'modern-neural').
   * When exporting to classic formats from extended mode, regions are automatically adapted via extendedAdapter.
   */
  workingMode?: WorkingMode;
  /**
   * Fase 7 — Classic DSP Analysis Algorithm:
   * - 'legacy': Original 2001 NASAnalysis.dll spectral analysis.
   * - 'enhanced': HPSS transient/stationary separation, YIN/MPM + HPS pitch detection, and trajectory smoothing.
   */
  dspAlgorithm?: DspAlgorithmMode;
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
 * Contains zones + process config + metadata + optional extended regions & articulation.
 */
export interface Session {
  id: string;
  name: string;
  zones: Zone[];
  extendedRegions?: ExtendedRegion[];
  articulation?: SynthArticulationConfig;
  detectedInstrumentCategory?: string;
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
  dspAlgorithm?: DspAlgorithmMode;
  acousticDescriptors?: AcousticDescriptors;
  classification?: AcousticClassificationResult;
  qualityScore?: DspQualityScore;
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
  /** Downsampled [min, max] envelope peaks for the Enhanced DSP resynthesis (C) */
  enhancedResynthPeaks?: { min: number[]; max: number[]; rmsDb: number };
  /** Objective quality comparison between Original (A), Legacy DSP (B), and Enhanced DSP (C) */
  qualityScore?: DspQualityScore;
  /** Automatic acoustic classification for this zone */
  classification?: AcousticClassificationResult;
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

