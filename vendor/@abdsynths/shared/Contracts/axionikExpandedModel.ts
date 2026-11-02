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

/** Engine generations able to load an expanded model. */
export type AxionikEngineGeneration = 'classic' | 'expanded-v1';

export const AXIONIK_ENGINE_GENERATIONS: readonly AxionikEngineGeneration[] = [
  'classic',
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

/** One spectral frame: per-partial amplitudes + frequency offsets. */
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
}

/** A named layer of frames (e.g. attack body / sustain / release). */
export interface AxionikSpectralLayer {
  name: string;
  weight: number;
  frames: AxionikSpectralFrame[];
  frameWeights?: number[];
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
}

/** 2D/3D morphing field with an optional neural latent reference. */
export interface AxionikMorphSpace {
  /** Morph field dimensionality. */
  dims: 2 | 3;
  /** Control points mapping morph coordinates to spectral frames. */
  points: Array<{ u: number; v: number; w?: number; frameIndex: number }>;
  /**
   * Opaque reference to a neural latent embedding (e.g. VAE space) stored
   * next to the model. `codec` names the encoding, `dataRef` locates the
   * blob relative to the model folder; engines without `latent-ref` ignore it.
   */
  latentRef?: { dims: number; codec: string; dataRef: string };
}

/**
 * Free Key x Velocity region. Field semantics align with the canonical
 * sampler roles in `sampler_voice_parameter_spec.json`
 * (`zone.key.root/low/high`, `zone.vel.low/high`, `loop.*`, `env.amp.*`,
 * `filter.*`); this interface is the expanded-model subset.
 */
export interface AxionikRegion {
  id: string;
  /** Sample blob name inside the model package. */
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
  loop?: {
    mode: string;
    startFrame: number;
    endFrame: number;
    crossfadeMs?: number;
  };
  /** 1 = mono, 2 = stereo, 4 = quad (real surround models). */
  channels?: number;
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
 * One Resynator v2 voice. Namespaced so older engines ignore unknown
 * `model` values; `xparams` carries v2.x additions without re-versioning.
 */
export interface AxionikResynatorV2 {
  id: string;
  version: 2;
  /** Resonator model, e.g. 'resonator-hd'. Unknown models are skipped. */
  model: string;
  params: Record<string, number>;
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

/** AI enhancement capabilities (ABDNeuModMakr provider interface). */
export type AxionikAiCapability =
  | 'audiosr'
  | 'htdemucs'
  | 'bigvgan'
  | 'outpaint-loop';

export const AXIONIK_AI_CAPABILITIES: readonly AxionikAiCapability[] = [
  'audiosr',
  'htdemucs',
  'bigvgan',
  'outpaint-loop',
];

/** One applied AI enhancement step (provenance, not audio). */
export interface AxionikAiStep {
  capability: AxionikAiCapability;
  model?: string;
  appliedAt?: string;
  targetLayer?: string;
}

/** Pointer to the frozen classic layer (dual-motor fallback). */
export interface AxionikClassicFallback {
  modelName: string;
  mapScriptRef?: string;
  scapeSphereRefs?: string[];
}

/** Root: the Axionik Expanded Model document (serialised as JSON). */
export interface AxionikExpandedModel {
  schemaVersion: string;
  identity: AxionikIdentity;
  spectral: AxionikSpectralModel;
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
