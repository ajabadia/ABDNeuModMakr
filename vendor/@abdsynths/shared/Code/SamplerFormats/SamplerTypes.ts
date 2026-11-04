// ─────────────────────────────────────────────────────────
// @abdsynths/shared — Universal Sampler Types (Fase 33)
//
// Canonical type definitions for multi-sample instruments,
// 2D key/velocity regions, multi-loop descriptors, DAHDSR
// envelopes, filters, LFOs, articulations, and metadata.
// Shared across ABDNeuModMakr, ABDAxionikVS, and future ABDSynths samplers.
// ─────────────────────────────────────────────────────────

import type {
  MidiNote,
  ModelSlot,
  Zone,
  TargetFormat,
  DecodedWav,
  WavFormatTag,
  AiffInstrumentInfo,
} from '../NeuronFormats/index.ts';

export type {
  MidiNote,
  ModelSlot,
  Zone,
  TargetFormat,
  DecodedWav,
  WavFormatTag,
  AiffInstrumentInfo,
};

export type WorkingMode = 'classic' | 'extended';
export type KeyMappingMode = 'chromatic' | 'drum';

export type LoopMode =
  | 'no_loop'
  | 'loop_continuous'
  | 'loop_sustain'
  | 'ping_pong'
  | 'loop_backward'
  | 'one_shot';

export type TriggerMode = 'attack' | 'release' | 'first' | 'legato';
export type CrossfadeCurve = 'linear' | 'equal-power' | 'spectral-morph';
export type EnvelopeSlopeCurve = 'linear' | 'exponential' | 'logarithmic';
export type SamplerPlayLogic = 'always' | 'round_robin' | 'random' | 'velocity';
export type FilterSlopePoles = 1 | 2 | 3 | 4 | 6 | 8;

/**
 * Fase 33.1 — Multi-loop descriptor per sample zone (matches ConvertWithMoss ISampleLoop
 * and ABDShared sampler_voice_parameter_spec.json `loop` scope).
 */
export interface SampleLoopDescriptor {
  id?: string;
  mode: LoopMode;
  startFrame: number;
  endFrame: number;
  crossfadeMs?: number;
  crossfadeCurve?: CrossfadeCurve;
  /** 0 or undefined = infinite loop; > 0 = fixed number of repeats */
  repeatCount?: number;
}

/** 6-stage DAHDSR envelope (compatible with SF2, SFZ, HALion, Kontakt, ConvertWithMoss IEnvelope) */
export interface DahdsrEnvelope {
  delaySec: number;
  attackSec: number;
  holdSec: number;
  decaySec: number;
  sustainLevel: number; // 0..1 (1 = 0 dB attenuation, 0 = -100 dB)
  releaseSec: number;
  /** Optional initial level before attack (0..1, default 0) */
  startLevel?: number;
  /** Optional hold peak level (0..1, default 1) */
  holdLevel?: number;
  /** Optional release target level (0..1, default 0) */
  endLevel?: number;
  attackSlope?: EnvelopeSlopeCurve;
  decaySlope?: EnvelopeSlopeCurve;
  releaseSlope?: EnvelopeSlopeCurve;
  /** Velocity modulation of envelope depth (-100..+100 %) */
  velModDepth?: number;
}

/** Dedicated Pitch Envelope / Modulator (ConvertWithMoss IPitchModulator) */
export interface PitchEnvelopeConfig {
  enabled: boolean;
  env: DahdsrEnvelope;
  /** Bipolar pitch modulation depth in cents (-12000..+12000 cents) */
  depthCents: number;
  /** Velocity sensitivity of pitch envelope (-100..+100 %) */
  velModDepth?: number;
}

/** Filter configuration (safe-mapped to Neuron Silver filter when enabled) */
export interface RegionFilterConfig {
  enabled: boolean;
  type: 'lpf' | 'hpf' | 'bpf' | 'brf' | 'notch';
  /** Filter roll-off slope in poles (1=6dB, 2=12dB, 4=24dB, etc.) */
  poles?: FilterSlopePoles;
  cutoffHz: number;          // 20..20000 Hz
  resonanceDb: number;       // 0..40 dB
  envToFilterCents: number;  // -12000..+12000 cents
  velToFilterCents: number;  // -12000..+12000 cents
  keytrackCents: number;     // 0..1200 cents/octave (0..100%)
  /** Optional dedicated filter DAHDSR envelope (when distinct from modEnv) */
  filterEnv?: DahdsrEnvelope;
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
  pitchEnv?: PitchEnvelopeConfig;
  filter: RegionFilterConfig;
  vibLfo: RegionLfoConfig;
  modLfo: RegionLfoConfig;
  /** Pitch bend range up in semitones (default 2) */
  pitchBendUpSt?: number;
  /** Pitch bend range down in semitones (default 2) */
  pitchBendDownSt?: number;
  /** Voice polyphony limit (1..64) */
  polyphony?: number;
  /** Voice allocation mode */
  voiceMode?: 'poly' | 'mono' | 'legato';
  /** Portamento / glide time in seconds */
  glideTimeSec?: number;
  /** Optional: bake amplitude/filter decay into the audio wave before classic spectral analysis */
  bakeEnvelopeIntoWave?: boolean;
}

/**
 * Model-wide Common Playback Defaults ("Zona Comun").
 * Replicated across all ExtendedRegions unless a region explicitly sets
 * `hasPlaybackOverride = true` ("Salvo Excepciones").
 */
export interface CommonPlaybackDefaults {
  loopMode: LoopMode;
  pitchKeytrack: number;     // 0..100 % (100 = chromatic, 0 = unpitched/drum)
  trigger: TriggerMode;      // 'attack' | 'release' | 'first' | 'legato'
  fadeCurve: CrossfadeCurve; // 'linear' | 'equal-power' | 'spectral-morph'
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
  /** Fase 33.1 — Non-destructive playback start offset in sample frames */
  sampleStartFrame?: number;
  /** Fase 33.1 — Non-destructive playback end offset in sample frames */
  sampleEndFrame?: number;
  /** Fase 33.1 — Reverse sample playback flag */
  reversed?: boolean;
  /** Fase 33.1 — Zone play / round-robin selection logic */
  playLogic?: SamplerPlayLogic;
  /** Fase 33.1 — Velocity to volume depth (-100..+100 %) */
  velToVolumeDepth?: number;
  /** Fase 33.1 — Velocity to pitch modulation in cents (-1200..+1200) */
  velToPitchCents?: number;
  /** Fase 33.1 — Logical group identifier and display name */
  groupId?: string;
  groupName?: string;
  /** Fase 33.1 — Mute / choke group (0 = none, 1..32 = exclusive group e.g. closed/open hi-hat) */
  muteGroup?: number;
  /** Fase 33.1 — Keyswitch MIDI note (0..127) activating this region/group */
  keyswitchNote?: MidiNote;
  /** Fase 33.1 — Multi-loop array (loops[0] mirrors loopMode/loopStart/loopEnd/loopCrossfadeMs) */
  loops?: SampleLoopDescriptor[];
  /** When true, this region overrides the Model Common playback rules (loopMode, pitchKeytrack, trigger, fadeCurve) */
  hasPlaybackOverride?: boolean;
  /** When true, this region overrides the Model Common synth articulation (ampEnvOverride / filterOverride) */
  hasArticulationOverride?: boolean;
  ampEnvOverride?: Partial<DahdsrEnvelope>;
  filterOverride?: Partial<RegionFilterConfig>;
  pitchEnvOverride?: Partial<PitchEnvelopeConfig>;
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

/** Key-value pair for arbitrary user-defined metadata tags in Extended Mode */
export interface CustomMetadataTag {
  tag: string;
  value: string;
}

/** Comprehensive metadata specification for Extended Mode & ABDAxionikVS */
export interface ExtendedModelMetadata {
  category?: string;
  /** Broad instrument family used for catalog grouping ("Strings", "Drums & Percussion", ...). */
  instrumentFamily?: string;
  author?: string;
  vendor?: string;
  version?: string;
  releaseYear?: string;
  sourceUrl?: string;
  sourceFormat?: string;
  sourcePresetName?: string;
  license?: string;
  copyright?: string;
  description?: string;
  tags?: string[];
  customAttributes?: CustomMetadataTag[];
  sublibrary?: string;
  sublibraryOrdinal?: number;
}

/** In-memory audio file payload for imports */
export interface AudioFilePayload {
  name: string;
  buffer: ArrayBuffer;
}

/**
 * Minimal session contract required by SamplerFormats exporters and UniversalSamplerModel
 * (satisfied by ABDNeuModMakr's `Session` as well as standalone sampler containers).
 */
export interface SamplerSessionLike {
  id: string;
  name: string;
  axionikSlug?: string;
  zones: Zone[];
  extendedRegions?: ExtendedRegion[];
  articulation?: SynthArticulationConfig;
  detectedInstrumentCategory?: string;
  processConfig: {
    modelNumber: ModelSlot;
    modelName: string;
    expandedName?: string;
    complexity: number;
    parameterSet: number;
    targetFormat?: TargetFormat;
    workingMode?: WorkingMode;
    keyMappingMode?: KeyMappingMode;
    commonPlayback?: CommonPlaybackDefaults;
    extendedMetadata?: ExtendedModelMetadata;
  };
}
