/**
 * @abdsynths/shared — Contracts/axionikExpandedModel.ts
 * =========================================================================
 * Canonical Axionik Expanded Model contract (SSOT) for the ABDSynths suite
 * (ABDNeuModMakr writer/preflight, ABDAxionikVS expanded engine).
 *
 * Version: 2.0.0 — first version of the expanded format. Born from roadmap
 * Fase 11.5 (ABDNeuModMakr): dual-engine decision (frozen classic + new
 * expanded voice path), no rompler-as-product, contract-before-DSP.
 *
 * What v1 could not carry (and v2 fixes):
 * - v1 `model.nmmodel` hardcodes 64 partials -> v2 parameterises
 *   `partialCount` / `frameCount` (HD spectral: >64 partials, >16 frames).
 * - Formant/pitch separation was never persisted -> v2 stores
 *   `formantProfileSt` + `pitchTrackHz`.
 * - Morphing/latent space had no home -> v2 adds `morphSpace`.
 * - Expanded filters/FX and Resynators v2 had no home -> v2 adds
 *   namespaced `filters[]` / `fxChain[]` / `resynators[]` (ignorable by
 *   older engines).
 * - No file declared which engine it needs -> v2 adds `engineMin` +
 *   `requiredCaps` with capability discovery (`meetsEngineCaps`).
 *
 * Pattern: same as MidiTranslationEngine / recordingSession — versioned
 * TypeScript truth with JSON-schema validation
 * (`axionik_expanded_model.schema.json`), zero runtime dependencies,
 * consumable from browsers, Node and (via vendors) C++ hosts.
 */

export const AXIONIK_EXPANDED_MODEL_CONTRACT_VERSION = '2.0.0';

/**
 * Canonical ABDAxionikVS modes / CMake build variants (`ABDJUNiO601` pattern):
 * - `classic` (0): 100% frozen Hartmann 2002 engine
 * - `plus` (1): classic Resynator with improved independent filter/FX chain
 * - `expanded` (2): full next-gen ABDAxionikVS Resynator v2 + HD spectral + hybrid transient engine
 */
export type AxionikCanonicalMode = 'classic' | 'plus' | 'expanded';

export const AXIONIK_CANONICAL_MODES: readonly AxionikCanonicalMode[] = [
  'classic',
  'plus',
  'expanded',
];

/**
 * Engine generations able to load a model.
 * Canonical names are `classic`, `plus`, and `expanded` (without `ABD` or `Neuron`).
 * Legacy strings `classic-enhanced` and `expanded-v1` are accepted as aliases and
 * normalized to `plus` and `expanded` respectively.
 */
export type AxionikEngineGeneration =
  | AxionikCanonicalMode
  | 'classic-enhanced'
  | 'expanded-v1';

export const AXIONIK_ENGINE_GENERATIONS: readonly AxionikEngineGeneration[] = [
  'classic',
  'plus',
  'expanded',
  'classic-enhanced',
  'expanded-v1',
];

export function isAxionikEngineGeneration(
  v: unknown
): v is AxionikEngineGeneration {
  return (
    typeof v === 'string' &&
    (AXIONIK_ENGINE_GENERATIONS as readonly string[]).includes(v)
  );
}

/** Normalizes any engine generation or alias to its canonical mode (`classic` | `plus` | `expanded`). */
export function normalizeAxionikEngineGeneration(
  gen: AxionikEngineGeneration
): AxionikCanonicalMode {
  if (gen === 'plus' || gen === 'classic-enhanced') return 'plus';
  if (gen === 'expanded' || gen === 'expanded-v1') return 'expanded';
  return 'classic';
}

/**
 * Strict Drag & Drop / model-loading format rule per mode/Resynator (Gate Decision 4, 2026-11-03):
 * Each mode/Resynator (`classic`, `plus`, `expanded`) ONLY admits its own model format
 * and rejects (with an explicit user-facing warning) all other model formats.
 */
export interface AxionikModeFormatValidation {
  allowed: boolean;
  engineMode: AxionikCanonicalMode;
  modelFormat: AxionikCanonicalMode;
  reason?: string;
}

export function validateModelFormatForMode(
  engineMode: AxionikEngineGeneration,
  modelFormat: AxionikEngineGeneration
): AxionikModeFormatValidation {
  const canonicalEngine = normalizeAxionikEngineGeneration(engineMode);
  const canonicalModel = normalizeAxionikEngineGeneration(modelFormat);
  if (canonicalEngine !== canonicalModel) {
    return {
      allowed: false,
      engineMode: canonicalEngine,
      modelFormat: canonicalModel,
      reason: `mode-format-mismatch: Resynator/mode '${canonicalEngine}' only accepts '${canonicalEngine}' format models and rejects '${canonicalModel}' models`,
    };
  }
  return {
    allowed: true,
    engineMode: canonicalEngine,
    modelFormat: canonicalModel,
  };
}

/**
 * Capability flags an expanded engine may provide. A model lists the ones
 * it requires in `identity.requiredCaps`; hosts announce what they support
 * (capability discovery, never assumption) and preflight with
 * `meetsEngineCaps` before loading.
 */
export type AxionikEngineCap =
  | 'hd-spectral'
  | 'formant-pitch-split'
  | 'morph-2d'
  | 'morph-3d'
  | 'latent-ref'
  | 'surround'
  | 'hybrid-transient'
  | 'filter-v2'
  | 'fx-v2'
  | 'ai-provenance';

export const AXIONIK_ENGINE_CAPS: readonly AxionikEngineCap[] = [
  'hd-spectral',
  'formant-pitch-split',
  'morph-2d',
  'morph-3d',
  'latent-ref',
  'surround',
  'hybrid-transient',
  'filter-v2',
  'fx-v2',
  'ai-provenance',
];

export function isAxionikEngineCap(v: unknown): v is AxionikEngineCap {
  return (
    typeof v === 'string' &&
    (AXIONIK_ENGINE_CAPS as readonly string[]).includes(v)
  );
}

/** True when `have` covers every capability in `required`. */
export function meetsEngineCaps(
  have: readonly string[],
  required: readonly AxionikEngineCap[]
): boolean {
  return required.every((cap) => have.includes(cap));
}

/** Model identity: semantic slug is the primary key; slot is virtual-only. */
export interface AxionikIdentity {
  /** URL-safe unique slug, e.g. 'velvet-choir-a'. Primary identifier. */
  slug: string;
  /** Unrestricted display name for the expanded ecosystem. */
  expandedName: string;
  /** 11-char ASCII classic name for the frozen `04_classic_enhanced` layer. */
  modelName: string;
  /** Minimum engine generation able to load this model. */
  engineMin: AxionikEngineGeneration;
  /** Capabilities the loading engine must provide (may be empty). */
  requiredCaps: AxionikEngineCap[];
  /** Virtual classic slot 0..511, generated only on hardware export. */
  classicSlot?: number;
}

/** One spectral frame: per-partial amplitudes + frequency offsets + state-of-the-art extensions. */
export interface AxionikSpectralFrame {
  /** Linear amplitudes, length === `partialCount`. */
  amps: number[];
  /** Frequency offsets in Hz around each partial, length === `partialCount`. */
  offsets: number[];
  /** Fundamental of this frame in Hz (0/omitted = unpitched). */
  f0Hz?: number;
  /** Per-frame formant shift in semitones (real-time Formant Shifting). */
  formantShiftSt?: number;
  /** Crossfade/morph weight of this frame. */
  weight?: number;
  /** Frame timestamp in seconds from note onset (for phase-coherent hybrid transient splicing). */
  timeSec?: number;
  /**
   * Instantaneous partial phases in radians (-pi..+pi), length === `partialCount`.
   * Used at the hybrid transient splice frame so sinusoidal oscillators lock in-phase with PCM.
   */
  phases?: number[];
  /**
   * Loris-style Bandwidth-Enhanced partial noisiness (0..1 per partial, length === `partialCount`).
   * 0 = pure sinusoid, 1 = narrowband noise modulated around the partial's trajectory.
   */
  bandwidths?: number[];
  /**
   * DDSP-style unpitched stochastic residual envelope in dBFS across Bark/ERB bands (e.g. 24 bands).
   */
  residualBandsDb?: number[];
  /**
   * True smoothed spectral/formant envelope in dBFS across Bark/ERB bands (F1/F2/F3 resonance curve)
   * for pitch-independent formant preservation and shifting.
   */
  formantEnvelopeDb?: number[];
  /**
   * Native 4-channel Scape/Sphere radiation vector [FL, FR, RL, RR] (0..1 each) for this frame.
   */
  spatialQuad?: [number, number, number, number];
}

/** A named layer of frames (e.g. attack body / sustain / release). */
export interface AxionikSpectralLayer {
  name: string;
  weight: number;
  frames: AxionikSpectralFrame[];
  frameWeights?: number[];
  /** Native 4-channel Scape/Sphere radiation vector [FL, FR, RL, RR] for this layer. */
  spatialQuad?: [number, number, number, number];
}

/**
 * High-definition spectral model. `partialCount` and `frameCount` are
 * data, not code: classic fixed 64 partials, expanded targets 128..256+
 * partials and 16+ frames per the Fase 11.4 roadmap.
 */
export interface AxionikSpectralModel {
  /** Number of partials per frame (>64 for HD; 64 = classic-compatible). */
  partialCount: number;
  /** Total frame count across `frames` (>= layers' frames). */
  frameCount: number;
  /** Frequency span covered by the offsets, in Hz. */
  frameSpanHz?: number;
  /** True when partials sit on a fixed grid (transposable offsets). */
  gridFixed?: boolean;
  /** Base frames (first entry = root frame). */
  frames: AxionikSpectralFrame[];
  /** Optional layered articulation frames. */
  layers?: AxionikSpectralLayer[];
  /** Detached pitch trajectory in Hz, one entry per frame (pitch/formant split). */
  pitchTrackHz?: number[];
  /** Detached global formant profile in semitones, one entry per frame. */
  formantProfileSt?: number[];
  /** Number of Bark/ERB bands used in `residualBandsDb` and `formantEnvelopeDb` (default 24). */
  barkBandCount?: number;
}

/** 2D/3D morphing field with an optional neural latent reference. */
export interface AxionikMorphPoint {
  u?: number;
  v?: number;
  w?: number;
  x?: number;
  y?: number;
  z?: number;
  frameIndex?: number;
}

export interface AxionikMorphSpace {
  /** Morph field dimensionality. */
  dims: 2 | 3;
  /** Control points mapping morph coordinates to spectral frames. */
  points: AxionikMorphPoint[];
  /**
   * Opaque reference to a neural latent embedding (e.g. VAE space) stored
   * next to the model. `codec` names the encoding, `dataRef` locates the
   * blob relative to the model folder; engines without `latent-ref` ignore it.
   */
  latentRef?: { dims: number; codec: string; dataRef: string };
}

/**
 * Phase-aligned PCM micro-transient splice configuration for a region (Fase 11.4.5).
 * Raw PCM (`01_raw_source` / `03_enhanced_audio`) enters the expanded engine ONLY
 * as a short attack transient fused in-phase with the Resynator body (no pure rompler).
 */
export interface AxionikHybridTransient {
  /** Duration of the PCM micro-transient attack in milliseconds (typically 10..60 ms). */
  durationMs: number;
  /** Phase-aligned equal-power crossfade window in milliseconds between PCM and Resynator body. */
  crossfadeMs: number;
  /** Relative gain trim in dB applied to the PCM transient attack. */
  gainDb?: number;
  /** Sample frame where the attack onset begins. */
  onsetFrame?: number;
  /** Index of the spectral frame in `AxionikSpectralModel.frames` where oscillator phases lock. */
  spliceFrameIndex?: number;
}

/**
 * Free Key x Velocity region. Field semantics align with the canonical
 * sampler roles in `sampler_voice_parameter_spec.json`
 * (`zone.key.root/low/high`, `zone.vel.low/high`, `loop.*`, `env.amp.*`,
 * `filter.*`); this interface is the expanded-model subset.
 */
export interface AxionikRegion {
  id: string;
  /** Sample blob name inside the model package (also indexes `spectralBySample`). */
  sampleRef: string;
  lowKey: number;
  highKey: number;
  rootKey: number;
  lowVel: number;
  highVel: number;
  detuneCents?: number;
  volumeDb?: number;
  pan?: number;
  pitchKeytrack?: number;
  /** Source-audio sample rate in Hz for mapping loop sample-frames to spectral frames (default 44100). */
  sampleRate?: number;
  /** Voice dispatcher trigger mode (Synth parameter layer). */
  trigger?: 'attack' | 'release' | 'first' | 'legato';
  /** Key/Velocity crossfade ranges and curve (Synth ExtendedRegionDispatcher layer). */
  keyFadeIn?: number;
  keyFadeOut?: number;
  velFadeIn?: number;
  velFadeOut?: number;
  fadeCurve?: 'linear' | 'equal-power' | 'spectral-morph';
  roundRobinGroup?: string;
  roundRobinIndex?: number;
  /** Mute/choke group (0/undefined = none; equal ids choke each other, e.g. closed/open hi-hat). */
  muteGroup?: number;
  loop?: {
    mode: string;
    startFrame: number;
    endFrame: number;
    crossfadeMs?: number;
  };
  /** 1 = mono, 2 = stereo, 4 = quad (real surround models). */
  channels?: number;
  /** Phase-aligned hybrid PCM micro-transient splice parameters for the Resynator. */
  hybridTransient?: AxionikHybridTransient;
  ampEnv?: Partial<AxionikDahdsr>;
  filter?: Partial<AxionikFilterBlock>;
}

/** Six-stage DAHDSR envelope (times in seconds, sustain 0..1). */
export interface AxionikDahdsr {
  delay: number;
  attack: number;
  hold: number;
  decay: number;
  sustain: number;
  release: number;
}

/** Known expanded filter types; hosts accept further `type` strings. */
export const AXIONIK_FILTER_TYPES = [
  'legacy-neuron',
  'ladder-v2',
  'svf-v2',
  'comb-v2',
  'formant-v2',
] as const;

export type AxionikFilterType = (typeof AXIONIK_FILTER_TYPES)[number] | string;

/** One expanded filter block; unknown `type`s must be bypassable, never fatal. */
export interface AxionikFilterBlock {
  id: string;
  type: AxionikFilterType;
  cutoffHz: number;
  resonance: number;
  keytrack?: number;
  bypass?: boolean;
  /** Forward-compatible extra parameters (v2.x additions). */
  xparams?: Record<string, number>;
}

/** One master-effect block in the expanded FX chain. */
export interface AxionikFxBlock {
  id: string;
  type: string;
  bypass?: boolean;
  mix?: number;
  params?: Record<string, number>;
}

/** Global articulation of the expanded voice path. */
export interface AxionikArticulation {
  ampEnv: AxionikDahdsr;
  modEnv?: AxionikDahdsr;
  modEnvToPitchCents?: number;
  /** Expanded filter stack (new filters live here, never in classic). */
  filters: AxionikFilterBlock[];
  /** Expanded master-effect chain. */
  fxChain: AxionikFxBlock[];
  polyphony?: number;
  voiceMode?: 'poly' | 'mono' | 'legato';
  glideTimeSec?: number;
}

/**
 * Explicit Sonic Matter Shapers for the proprietary ABDAxionikVS Resynator v2
 * (expanded mode, Gate Decision 2).
 */
export interface AxionikResonatorShapers {
  /**
   * Inharmonicity stiffness coefficient B (>= 0):
   * f_n = f_0 * (n + delta_n) * sqrt(1 + B * n^2).
   * Models stiff strings (piano), bars, mallets, and metallic bells.
   */
  inharmonicityB?: number;
  /** Even/Odd harmonic balance (-1 = odd/hollow clarinet, 0 = neutral, +1 = even/warm). */
  parity?: number;
  /** Micro-detuning / phase & amplitude turbulence (0..1). */
  entropyRoughness?: number;
  /** Linear frequency shift in Hz applied across partials. */
  spectralShiftHz?: number;
  /** High-frequency spectral tilt / roll-off in dB per octave. */
  hfRollOffDbPerOct?: number;
  /** Real-time formant shift in semitones (-24..+24). */
  formantShiftSt?: number;
  /** Formant preservation amount during pitch transposition (0 = classic shift, 1 = locked formants). */
  formantPreserve?: number;
  /** Balance between harmonic partials (0) and DDSP stochastic residual noise (1). */
  residualMix?: number;
  /** Spatial spread across the 4-channel Scape/Sphere field (0..1). */
  spatialSpread?: number;
}

/**
 * One Resynator v2 voice. Namespaced so older engines ignore unknown
 * `model` values; `shapers` provides typed sonic matter controls while
 * `params` / `xparams` carry generic or v2.x additions without re-versioning.
 */
export interface AxionikResynatorV2 {
  id: string;
  version: 2;
  /** Resonator model, e.g. 'resonator-hd'. Unknown models are skipped. */
  model: string;
  params: Record<string, number>;
  /** Typed physical/spectral matter shapers for the 100% proprietary Resynator v2. */
  shapers?: AxionikResonatorShapers;
  xparams?: Record<string, number | string>;
}

/** Deterministic analysis lineage (NAS algorithms). */
export type AxionikAnalysisAlgorithm = 'legacy' | 'enhanced' | 'hd';

export interface AxionikAnalysisLineage {
  algorithm: AxionikAnalysisAlgorithm;
  complexity: number;
  parameterSet: number;
  category?: string;
  qualityScore?: number;
  /** Reference to the descriptor blob used for classification. */
  descriptorsRef?: string;
}

/** AI enhancement capabilities (ABDNeuModMakr provider interface + Phase 30/34 AI Denoise + DDSP/VAE). */
export type AxionikAiCapability =
  | 'audiosr'
  | 'htdemucs'
  | 'bigvgan'
  | 'outpaint-loop'
  | 'denoise-ai'
  | 'ddsp-harmonic-residual'
  | 'vae-latent-encode';

export const AXIONIK_AI_CAPABILITIES: readonly AxionikAiCapability[] = [
  'audiosr',
  'htdemucs',
  'bigvgan',
  'outpaint-loop',
  'denoise-ai',
  'ddsp-harmonic-residual',
  'vae-latent-encode',
];

/** One applied AI enhancement step (provenance, not audio). */
export interface AxionikAiStep {
  capability?: AxionikAiCapability;
  stage?: string;
  provider?: string;
  model?: string;
  appliedAt?: string;
  targetLayer?: string;
  params?: Record<string, unknown>;
  /** Optional captured noise floor Dbfs when `denoise-ai` or noise-aware enhancement was used. */
  noiseFloorDbfs?: number;
}

/** Pointer to the frozen classic layer (dual-motor fallback). */
export interface AxionikClassicFallback {
  modelName: string;
  mapScriptRef?: string;
  scapeSphereRefs?: string[];
}

/**
 * Topology of the unified continuous spectral surface (Fase 38):
 * - `melodic_surface`: 2D continuous field over `Pitch (0..127) × Velocity (1..127) × Time`
 *   with pitch-formant decoupling and bilinear harmonic interpolation (pianos, synths, strings, tuned bottles/mallets).
 * - `drum_kit_surface`: Per-key discrete articulation map where each key (`0..127`) has its own
 *   1D continuous `Velocity (1..127) × Time` surface + anti-machine-gun stochastic DDSP residual (drum kits, unpitched FX).
 */
export type AxionikSurfaceTopology = 'melodic_surface' | 'drum_kit_surface';

/** Adaptive resolution tier selected from harmonic richness and temporal evolution. */
export type AxionikResolutionTier = 'compact' | 'standard' | 'hd' | 'ultra-hd';

/**
 * Extracted modulation profile for detuned oscillators (beating/unison/chorus),
 * PWM (odd/even harmonic oscillation), and cyclic LFO filter sweeps so interpolation
 * preserves movement speed and depth without phase cancellation.
 */
export interface AxionikSurfaceModulationProfile {
  /** Dominant amplitude/timbre modulation or beating rate in Hz (0 = static). */
  modulationRateHz: number;
  /** Normalized amplitude beating / unison detune depth (0..1). */
  modulationDepth: number;
  /** PWM / odd-vs-even harmonic counter-modulation depth (0..1). */
  oddEvenModDepth: number;
  /** Estimated oscillator unison detune spread in cents (0..50). */
  estimatedDetuneCents: number;
}

/**
 * Normalized anchor node inside the unified spectral surface.
 * Every node in a surface is time-aligned to the exact same `(partialCount, frameCount)` grid
 * and landmark indices (`attackPeakFrame`, `sustainStartFrame`, `sustainEndFrame`), enabling
 * zero-artifact bilinear/1D interpolation and real-time attack shortening or infinite release extension.
 */
export interface AxionikSpectralSurfaceNode {
  id: string;
  sampleRef: string;
  /** Nominal MIDI note (`0..127`) for this node. */
  rootKey: number;
  /** Key coverage bounds (`0..127`) used for drum kit slot matching or fallback bounds. */
  lowKey: number;
  highKey: number;
  /** Velocity center (`1..127`) of this calibration node. */
  velocityCenter: number;
  lowVel: number;
  highVel: number;
  /** Measured fundamental frequency in Hz (`0` if unpitched percussion). */
  measuredF0Hz: number;
  /** Harmonicity confidence (`0..1`). */
  harmonicity: number;
  /**
   * Timbral coherence score (`0..1`) against the robust median centroid of the instrument.
   * Values `< 0.72` in a melodic instrument indicate a likely intruder sample from another instrument.
   */
  timbreCoherenceScore?: number;
  /** True when this node is flagged as a timbral outlier / intruder sample. */
  isTimbralOutlier?: boolean;
  /** Frame index (`0 .. frameCount-1`) where initial attack reaches full spectral bloom (for Attack=0 shortening). */
  attackPeakFrame: number;
  /** Frame index range (`0 .. frameCount-1`) of the stationary or cyclic sustain horizon. */
  sustainStartFrame: number;
  sustainEndFrame: number;
  /** Whether sustain orbits cyclically (pad/strings/synth) or decays naturally (piano/pluck/drum). */
  sustainBehavior: 'looping_orbit' | 'decaying_oneshot';
  /** Natural high-frequency damping rate in dB/sec for realistic infinite release synthesis. */
  hfDampingDbPerSec: number;
  /** Detuned oscillator / LFO / PWM modulation profile extracted before frame normalization. */
  modulation: AxionikSurfaceModulationProfile;
  /** Phase-aligned PCM micro-transient splice for the first 10..30 ms of physical impact. */
  hybridTransient?: AxionikHybridTransient;
  /** Time-normalized spectral frames of length `surface.frameCount`, each with `surface.partialCount` partials. */
  frames: AxionikSpectralFrame[];
}

/**
 * Tempo-Sync & Groove / REX Loop metadata for the ABDAxionikVS Resynator v2 (Fase 39.4).
 * When `enabled === true`, the Resynator advances through the spectral surface frames
 * at rate `(hostBpm / sourceBpm)` instead of fixed time, keeping pitch & formants 100% intact
 * while locking rhythmic or melodic loops to the DAW host clock.
 */
export interface AxionikSurfaceTempoSync {
  /** When true, the Resynator v2 locks spectral envelope evolution to `hostBpm / sourceBpm`. */
  enabled: boolean;
  /** Original detected or authored BPM of the loop/phrase (20..300, default 120). */
  sourceBpm: number;
  /** Target conformed BPM if pre-conformed in AutoSlicer, or default playback BPM (20..300). */
  targetBpm?: number;
  /** Length of the loop/phrase in musical bars (e.g. 1, 2, 4, 8). */
  barCount: number;
  /** Musical time signature `[numerator, denominator]`, default `[4, 4]`. */
  timeSignature: [number, number];
  /** Groove workflow mode that originated this surface ('free' | 'rex_loop' | 'melodic_phrase' | 'sliced_kit' | 'slice_synced'). */
  grooveMode?: 'free' | 'rex_loop' | 'melodic_phrase' | 'sliced_kit' | 'slice_synced';
  /** Number of rhythmic/melodic slices detected in the phrase (optional). */
  sliceCount?: number;
  /** Start frame (mono samples) of every slice, used when `grooveMode === 'slice_synced'`. */
  sliceStartFrames?: number[];
}

/**
 * Unified Continuous Spectral Surface covering the full Pitch × Velocity spectrum in a single model.
 */
export interface AxionikUnifiedSpectralSurface {
  topology: AxionikSurfaceTopology;
  topologyDetectionReason: string;
  /** Monotonic pitch progression score across zones (`0..1`, `>= 0.65` indicates tuned melodic scale). */
  pitchMonotonicityScore: number;
  /** Average adjacent-zone Bark formant envelope cosine similarity (`0..1`). */
  adjacentFormantSimilarity: number;
  resolutionTier: AxionikResolutionTier;
  /** Unified partial count per frame across all nodes (`32 | 64 | 128 | 256`). */
  partialCount: number;
  /** Unified landmark-warped frame count across all nodes (`32 | 48 | 64 | 96`). */
  frameCount: number;
  /** Canonical normalized landmark index where attack bloom completes across all nodes. */
  canonicalAttackPeakFrame: number;
  /** Canonical normalized landmark index where sustain horizon begins across all nodes. */
  canonicalSustainStartFrame: number;
  /** Global 24-Bark body formant reference envelope in dBFS for pitch-independent formant locking. */
  globalBodyFormantDb: number[];
  /** Node IDs (`sampleRef` or region `id`) flagged as timbral outliers / accidental intruder samples. */
  outlierNodeIds?: string[];
  /** Optional Tempo-Sync & REX/Groove metadata for the ABDAxionikVS Resynator v2. */
  tempoSync?: AxionikSurfaceTempoSync;
  /** Calibration anchor nodes sorted by `(rootKey, velocityCenter)`. */
  nodes: AxionikSpectralSurfaceNode[];
}

/**
 * Root: the Axionik Expanded Model document (serialised as JSON).
 * Architectural boundary (Fase 11.5.7):
 * - Resynator Sonic Matter: `spectral`, `spectralBySample`, `unifiedSurface`, `morphSpace`, `resynators`, and region `hybridTransient`.
 * - Synth Voice Dispatcher & Independent Audio Chain (`ABDJUNiO601` pattern): `articulation` (`filters[]`, `fxChain[]`, envelopes) and region crossfade/trigger rules.
 */
export interface AxionikExpandedModel {
  schemaVersion: string;
  identity: AxionikIdentity;
  /** Primary / root HD spectral model. */
  spectral: AxionikSpectralModel;
  /**
   * Per-sample HD spectral models indexed by `region.sampleRef` (Fase 11.5.7).
   * Eliminates the single-spectrum funnel so multi-sample instruments carry
   * distinct HD partials, formants, and DDSP residuals per sample/zone.
   */
  spectralBySample?: Record<string, AxionikSpectralModel>;
  /**
   * Unified Continuous Spectral Surface (Fase 38) fusing all zones and velocity layers
   * into a single landmark-aligned `Pitch × Velocity × Time` (or `DrumKey × Velocity × Time`) field.
   */
  unifiedSurface?: AxionikUnifiedSpectralSurface;
  morphSpace?: AxionikMorphSpace;
  regions: AxionikRegion[];
  articulation: AxionikArticulation;
  resynators: AxionikResynatorV2[];
  analysis: AxionikAnalysisLineage;
  aiChain?: AxionikAiStep[];
  classic: AxionikClassicFallback;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Structural guard: true when `v` is a loadable v2 expanded model. */
export function isAxionikExpandedModel(v: unknown): v is AxionikExpandedModel {
  if (!isRecord(v)) return false;
  if (v.schemaVersion !== AXIONIK_EXPANDED_MODEL_CONTRACT_VERSION) return false;
  if (!isRecord(v.identity) || !isRecord(v.spectral)) return false;
  if (!isRecord(v.articulation) || !isRecord(v.analysis)) return false;
  if (!isRecord(v.classic)) return false;
  if (!Array.isArray(v.regions) || !Array.isArray(v.resynators)) return false;
  const spectral = v.spectral as Record<string, unknown>;
  if (
    typeof spectral.partialCount !== 'number' ||
    typeof spectral.frameCount !== 'number' ||
    !Array.isArray(spectral.frames)
  ) {
    return false;
  }
  const identity = v.identity as Record<string, unknown>;
  if (
    typeof identity.slug !== 'string' ||
    typeof identity.expandedName !== 'string' ||
    typeof identity.modelName !== 'string' ||
    !isAxionikEngineGeneration(identity.engineMin) ||
    !Array.isArray(identity.requiredCaps) ||
    !(identity.requiredCaps as unknown[]).every(isAxionikEngineCap)
  ) {
    return false;
  }
  return true;
}

/**
 * Spatial output routing mode of the host / engine at runtime (Gate 2026-11-02):
 * - `discrete-quad`: host opened a discrete 4.0 / 5.1 multichannel bus
 * - `pseudo-surround-stereo`: stereo 2.0 host or browser WASM (decorrelated mono-compatible downmix)
 */
export type AxionikSpatialOutputMode =
  | 'discrete-quad'
  | 'pseudo-surround-stereo';

/**
 * Canonical capability profile for each of the 3 ABDAxionikVS CMake build variants / modes
 * (`ABDJUNiO601` pattern: 0 = classic, 1 = plus, 2 = expanded).
 */
export interface AxionikEngineVariantProfile {
  variantIndex: 0 | 1 | 2;
  generation: AxionikCanonicalMode;
  caps: readonly AxionikEngineCap[];
  maxPartials: number;
  maxFrames: number;
  spatialOutputMode?: AxionikSpatialOutputMode;
}

export const AXIONIK_CLASSIC_ENGINE_PROFILE: AxionikEngineVariantProfile = {
  variantIndex: 0,
  generation: 'classic',
  caps: [],
  maxPartials: 64,
  maxFrames: 16,
  spatialOutputMode: 'pseudo-surround-stereo',
};

export const AXIONIK_PLUS_ENGINE_PROFILE: AxionikEngineVariantProfile = {
  variantIndex: 1,
  generation: 'plus',
  caps: ['filter-v2', 'fx-v2'],
  maxPartials: 64,
  maxFrames: 16,
  spatialOutputMode: 'pseudo-surround-stereo',
};

export const AXIONIK_EXPANDED_ENGINE_PROFILE: AxionikEngineVariantProfile = {
  variantIndex: 2,
  generation: 'expanded',
  caps: AXIONIK_ENGINE_CAPS,
  maxPartials: 1024,
  maxFrames: 256,
  spatialOutputMode: 'pseudo-surround-stereo',
};

/** Backward-compatible profile aliases. */
export const AXIONIK_CLASSIC_ENHANCED_ENGINE_PROFILE: AxionikEngineVariantProfile =
  AXIONIK_PLUS_ENGINE_PROFILE;
export const AXIONIK_EXPANDED_V1_ENGINE_PROFILE: AxionikEngineVariantProfile =
  AXIONIK_EXPANDED_ENGINE_PROFILE;

export interface RequiredCapsSource {
  partialCount: number;
  hasPitchFormantSplit: boolean;
  morphDims: 0 | 2 | 3;
  hasLatentRef: boolean;
  maxChannels: number;
  hasHybridTransient: boolean;
  hasNonLegacyFilter: boolean;
  hasFx: boolean;
  hasAi: boolean;
}

/** Derives the minimal `requiredCaps` set from document content. */
export function deriveRequiredCaps(src: RequiredCapsSource): AxionikEngineCap[] {
  const caps: AxionikEngineCap[] = [];
  if (src.partialCount > 64) caps.push('hd-spectral');
  if (src.hasPitchFormantSplit) caps.push('formant-pitch-split');
  if (src.morphDims === 2) caps.push('morph-2d');
  if (src.morphDims === 3) caps.push('morph-3d');
  if (src.hasLatentRef) caps.push('latent-ref');
  if (src.maxChannels > 2) caps.push('surround');
  if (src.hasHybridTransient) caps.push('hybrid-transient');
  if (src.hasNonLegacyFilter) caps.push('filter-v2');
  if (src.hasFx) caps.push('fx-v2');
  if (src.hasAi) caps.push('ai-provenance');
  return caps;
}

export interface AxionikEngineProfile {
  /** Engine generation string; unknown generations fail closed. */
  generation: string;
  /** Capability flags the engine announces (discovery, never assumption). */
  caps: readonly string[];
  /** Maximum spectral partials the engine renders (HD truncation otherwise). */
  maxPartials?: number;
  /** Maximum spectral frames the engine renders. */
  maxFrames?: number;
  /**
   * Runtime spatial output mode (Gate 2026-11-02):
   * - `discrete-quad`: host opened a multichannel 4.0/5.1 bus
   * - `pseudo-surround-stereo`: stereo 2.0 host or browser WASM
   */
  spatialOutputMode?: AxionikSpatialOutputMode;
}

export interface ExpandedAxionikPreflightReport {
  ok: boolean;
  schemaVersion: string;
  engineMin: string;
  requiredCaps: string[];
  missingCaps: string[];
  errors: string[];
  warnings: string[];
  /** Non-silent degradations the engine MUST apply to load the document. */
  adaptations: string[];
}

const ENGINE_GENERATION_RANK: Record<string, number> = {
  classic: 0,
  plus: 1,
  'classic-enhanced': 1,
  expanded: 2,
  'expanded-v1': 2,
};

/**
 * Preflights a v2 document (or its JSON text) against an Axionik engine
 * profile. Fatal (`ok: false`): unparsable JSON, non-v2 document, engine
 * older than `engineMin`, mode mismatch, or any missing `requiredCaps` —
 * the load is then blocked, never silently corrupted.
 */
export function preflightExpandedModelForAxionik(
  doc: AxionikExpandedModel | string,
  engine: AxionikEngineProfile
): ExpandedAxionikPreflightReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const adaptations: string[] = [];
  let parsed: unknown = doc;
  if (typeof doc === 'string') {
    try {
      parsed = JSON.parse(doc) as unknown;
    } catch {
      return {
        ok: false,
        schemaVersion: 'unknown',
        engineMin: 'unknown',
        requiredCaps: [],
        missingCaps: [],
        errors: ['invalid-json: the document is not parseable JSON'],
        warnings,
        adaptations,
      };
    }
  }
  if (!isAxionikExpandedModel(parsed)) {
    return {
      ok: false,
      schemaVersion: 'unknown',
      engineMin: 'unknown',
      requiredCaps: [],
      missingCaps: [],
      errors: [
        'not-expanded-model: document fails the v2 structural guard',
      ],
      warnings,
      adaptations,
    };
  }
  const model = parsed;
  const requiredCaps = model.identity.requiredCaps.filter(isAxionikEngineCap);

  const needRank = ENGINE_GENERATION_RANK[model.identity.engineMin];
  const haveRank = ENGINE_GENERATION_RANK[engine.generation];
  if (needRank === undefined) {
    errors.push(
      `unknown-engineMin: '${model.identity.engineMin}' is not a known generation`
    );
  } else if (haveRank === undefined) {
    errors.push(
      `unknown-engine: generation '${engine.generation}' is not a known Axionik engine`
    );
  } else {
    if (haveRank < needRank) {
      errors.push(
        `engine-too-old: document requires '${model.identity.engineMin}' but engine is '${engine.generation}'`
      );
    }
    if (
      isAxionikEngineGeneration(engine.generation) &&
      isAxionikEngineGeneration(model.identity.engineMin)
    ) {
      const modeCheck = validateModelFormatForMode(
        engine.generation,
        model.identity.engineMin
      );
      if (!modeCheck.allowed && modeCheck.reason) {
        errors.push(modeCheck.reason);
      }
    }
  }

  const missingCaps = requiredCaps.filter((c) => !engine.caps.includes(c));
  if (!meetsEngineCaps(engine.caps, requiredCaps)) {
    errors.push(`missing-caps: engine lacks [${missingCaps.join(', ')}]`);
  }

  const implied: AxionikEngineCap[] = deriveRequiredCaps({
    partialCount: model.spectral.partialCount,
    hasPitchFormantSplit:
      (model.spectral.pitchTrackHz?.length ?? 0) > 0 ||
      (model.spectral.formantProfileSt?.length ?? 0) > 0,
    morphDims: model.morphSpace?.dims ?? 0,
    hasLatentRef: model.morphSpace?.latentRef !== undefined,
    maxChannels: model.regions.reduce(
      (m, r) => Math.max(m, r.channels ?? 1),
      1
    ),
    hasHybridTransient: requiredCaps.includes('hybrid-transient'),
    hasNonLegacyFilter: model.articulation.filters.some(
      (f) => f.type !== 'legacy-neuron'
    ),
    hasFx: model.articulation.fxChain.length > 0,
    hasAi: (model.aiChain?.length ?? 0) > 0,
  });
  for (const cap of implied) {
    if (!requiredCaps.includes(cap)) {
      warnings.push(
        `caps-incomplete: document uses '${cap}' content but does not declare it in requiredCaps`
      );
    }
  }

  for (const res of model.resynators) {
    if (res.model !== 'resonator-hd' && res.model !== 'resonator-classic') {
      warnings.push(
        `unknown-resynator: '${res.id}' model '${res.model}' has no local implementation`
      );
      adaptations.push(
        `skip resynator '${res.id}' (unknown model '${res.model}')`
      );
    }
  }
  for (const f of model.articulation.filters) {
    if (f.type !== 'legacy-neuron' && !f.bypass) {
      adaptations.push(
        `bypass filter '${f.id}' of unknown type '${f.type}' when the engine cannot render it`
      );
    }
  }
  for (const fx of model.articulation.fxChain) {
    adaptations.push(
      `bypass FX '${fx.id}' of type '${fx.type}' when the engine cannot render it`
    );
  }
  if (
    typeof engine.maxPartials === 'number' &&
    model.spectral.partialCount > engine.maxPartials
  ) {
    warnings.push(
      `hd-truncation: document has ${model.spectral.partialCount} partials but engine renders ${engine.maxPartials}`
    );
    adaptations.push(
      `truncate spectrum to ${engine.maxPartials} partials (lossy: keep lowest partials)`
    );
  }
  if (
    typeof engine.maxFrames === 'number' &&
    model.spectral.frameCount > engine.maxFrames
  ) {
    warnings.push(
      `frame-truncation: document has ${model.spectral.frameCount} frames but engine renders ${engine.maxFrames}`
    );
    adaptations.push(
      `truncate spectrum to ${engine.maxFrames} frames (lossy: keep earliest frames)`
    );
  }
  const docMaxChannels = model.regions.reduce(
    (m, r) => Math.max(m, r.channels ?? 1),
    1
  );
  if (
    docMaxChannels > 2 &&
    engine.spatialOutputMode === 'pseudo-surround-stereo'
  ) {
    adaptations.push(
      `spatial-downmix: render ${docMaxChannels}.0 Scape/Sphere via stereo Pseudo-Surround downmixer`
    );
  }

  return {
    ok: errors.length === 0,
    schemaVersion: model.schemaVersion,
    engineMin: model.identity.engineMin,
    requiredCaps: [...requiredCaps],
    missingCaps,
    errors,
    warnings,
    adaptations,
  };
}

// ─────────────────────────────────────────────────────────
// AxionikDB Shared Bank Catalog & Taxonomy (Fase 11.5.6)
// Used by both ABDNeuModMakr and ABDAxionikVS BankDrawer
// ─────────────────────────────────────────────────────────

export const AXIONIK_CATEGORIES = [
  { id: 'vocal-choir', name: 'Vocal & Choir', defaultParamSet: 5 },
  { id: 'drums-perc', name: 'Drums & Percussion Kit', defaultParamSet: 8 },
  { id: 'orchestral-strings', name: 'Orchestral & Strings', defaultParamSet: 1 },
  { id: 'acoustic-pianos', name: 'Keyboards & Acoustic Pianos', defaultParamSet: 2 },
  { id: 'electric-pianos', name: 'Electric Pianos & Tines', defaultParamSet: 2 },
  { id: 'bass-low-end', name: 'Bass & Low End', defaultParamSet: 4 },
  { id: 'plucked-ethnic', name: 'Plucked & Ethnic / World', defaultParamSet: 3 },
  { id: 'brass-horns', name: 'Brass & Horns', defaultParamSet: 1 },
  { id: 'woodwinds-reeds', name: 'Woodwinds & Reeds', defaultParamSet: 1 },
  { id: 'mallets-chromatic', name: 'Mallets & Chromatic Perc', defaultParamSet: 7 },
  { id: 'pads-atmospheres', name: 'Pads & Atmospheres', defaultParamSet: 6 },
  { id: 'synth-leads', name: 'Synth Leads & Solos', defaultParamSet: 0 },
  { id: 'sfx-cinematic', name: 'SFX, Drones & Cinematic', defaultParamSet: 9 },
  { id: 'arps-sequences', name: 'Arpeggiated & Sequences', defaultParamSet: 8 },
  { id: 'synth-neutral', name: 'Synth & Neutral', defaultParamSet: 0 },
] as const;

export type AxionikCategoryName = (typeof AXIONIK_CATEGORIES)[number]['name'];

export interface AxionikDbModelEntry {
  slug: string;
  name: string;
  category: string;
  parameterSet: number;
  zoneCount: number;
  complexity: number;
  hasCover: boolean;
  createdAt?: string;
  updatedAt?: string;
  folderPath: string;
  sublibrary?: string;
  sublibraryOrdinal?: number;
  hasExpandedV2?: boolean;
  expandedJson?: string;
}

export interface SublibraryInfo {
  name: string;
  description?: string;
  order: number;
  modelCount: number;
  isDefault?: boolean;
}

/**
 * Derives a clean, filesystem-safe semantic slug from any model name.
 * e.g. "Steinway Grand Piano #1" -> "steinway-grand-piano-1"
 */
export function slugifyModelName(name: string): string {
  const clean = (name || 'untitled')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 48);
  return clean || 'model';
}

/**
 * Avoids duplicate folder collisions when saving into AxionikDB/Models/.
 */
export function createUniqueModelSlug(name: string, existingSlugs: Set<string> | string[]): string {
  const base = slugifyModelName(name);
  const set = existingSlugs instanceof Set ? existingSlugs : new Set(existingSlugs);
  if (!set.has(base)) return base;
  let counter = 2;
  while (set.has(`${base}-${counter}`)) {
    counter++;
  }
  return `${base}-${counter}`;
}

/**
 * Resolves the legacy 0..9 Parameter Set from an Axionik category name.
 */
export function mapAxionikCategoryToParameterSet(category: string): number {
  const found = AXIONIK_CATEGORIES.find(
    (c) => c.name.toLowerCase() === category.toLowerCase()
  );
  return found?.defaultParamSet ?? 0;
}



