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
 * Root: the Axionik Expanded Model document (serialised as JSON).
 * Architectural boundary (Fase 11.5.7):
 * - Resynator Sonic Matter: `spectral`, `spectralBySample`, `morphSpace`, `resynators`, and region `hybridTransient`.
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

