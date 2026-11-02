// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Fase 11.5: Axionik Expanded Model v2 Writer + Preflight
//
// Builds the versioned `AxionikExpandedModel` document (SSOT contract in
// `@abdsynths/shared/contracts/axionikExpandedModel.ts`) from capsule data,
// and preflights it against an Axionik engine capability profile before
// export (contract-before-DSP: NeuModMakr already writes + preflights while
// ABDAxionikVS Fase B implements playback).
//
// Capability rule (roadmap Fase 11.5.4): missing `requiredCaps` BLOCK the
// load (`ok: false` + `missingCaps`); degradable mismatches (unknown
// resynator models, unknown filter/FX types, HD spectral beyond the engine
// maximum) are reported as `adaptations`, never applied silently.
// ─────────────────────────────────────────────────────────

import {
  AXIONIK_EXPANDED_MODEL_CONTRACT_VERSION,
  isAxionikExpandedModel,
  isAxionikEngineCap,
  meetsEngineCaps,
  type AxionikAiStep,
  type AxionikArticulation,
  type AxionikDahdsr,
  type AxionikEngineCap,
  type AxionikEngineGeneration,
  type AxionikExpandedModel,
  type AxionikFilterBlock,
  type AxionikFxBlock,
  type AxionikMorphSpace,
  type AxionikRegion,
  type AxionikResynatorV2,
  type AxionikSpectralFrame,
  type AxionikSpectralLayer,
  type AxionikSpectralModel,
} from '@abdsynths/shared/contracts/axionikExpandedModel.ts';
import type {
  DahdsrEnvelope,
  DspQualityScore,
  ExtendedRegion,
  ProcessConfig,
  SynthArticulationConfig,
} from './types.ts';
import { basename } from './pathUtils.ts';
import { slugifyModelName } from './modelSlug.ts';

/** Capsule path of the v2 document inside `05_extended_model/`. */
export const EXPANDED_MODEL_V2_CAPSULE_PATH =
  '05_extended_model/axionik-expanded.json';

/**
 * Structural spectral source consumed by the writer. `SpectralModelData`
 * satisfies this interface; HD analysis (>64 partials) only changes the
 * array lengths — the writer is length-driven, never hardcoded.
 */
export interface ExpandedSpectralSource {
  readonly frameCount: number;
  readonly frameSpanHz: number;
  readonly gridFixed: boolean;
  ampsOf(frame: number): Float32Array;
  offsetsOf(frame: number): Float32Array;
  f0At(frame: number): number;
  isLayered(): boolean;
  readonly layerCount: number;
  numFramesOf(layer: number): number;
  ampsOfLayer(layer: number, frame: number): Float32Array;
  offsetsOfLayer(layer: number, frame: number): Float32Array;
  f0AtLayer(layer: number, frame: number): number;
  layerNameAt(layer: number): string;
  layerWeightAt(layer: number): number;
  frameWeightAt(layer: number, frame: number): number;
}

export interface ExpandedModelWriterInput {
  slot: number;
  modelName: string;
  expandedName?: string;
  processConfig: ProcessConfig;
  spectral: ExpandedSpectralSource;
  regions: ExtendedRegion[];
  articulation?: SynthArticulationConfig;
  detectedInstrumentCategory?: string;
  qualityScore?: DspQualityScore;
  /** Reference to the descriptor blob used for classification. */
  descriptorsRef?: string;
  /** Detached pitch trajectory, one entry per spectral frame. */
  pitchTrackHz?: number[];
  /** Detached global formant profile in semitones, one entry per frame. */
  formantProfileSt?: number[];
  morphSpace?: AxionikMorphSpace;
  latentRef?: { dims: number; codec: string; dataRef: string };
  /** Expanded v2 filter blocks appended after the mapped classic filter. */
  expandedFilters?: AxionikFilterBlock[];
  /** Expanded v2 master-effect chain. */
  expandedFx?: AxionikFxBlock[];
  resynators?: AxionikResynatorV2[];
  aiSteps?: AxionikAiStep[];
  /** True when a real PCM micro-transient attack rides the model. */
  hasHybridTransient?: boolean;
  engineMin?: AxionikEngineGeneration;
  requiredCapsOverride?: AxionikEngineCap[];
  classicMapScriptRef?: string;
  classicScapeSphereRefs?: string[];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function roundTo(v: number, decimals: number): number {
  if (!Number.isFinite(v)) return 0;
  const m = 10 ** decimals;
  return Math.round(v * m) / m;
}

function frameToExpanded(
  amplitudes: Float32Array,
  frequencyOffsets: Float32Array,
  frameSpan: number,
  f0Hz: number
): AxionikSpectralFrame {
  const partialCount = amplitudes.length;
  const amps: number[] = new Array<number>(partialCount);
  const offsets: number[] = new Array<number>(partialCount);
  for (let i = 0; i < partialCount; i++) {
    const gap = frameSpan > 0 ? frameSpan : i + 1;
    amps[i] = roundTo(amplitudes[i] ?? 0, 6);
    offsets[i] = roundTo(
      clamp(frequencyOffsets[i] ?? 0, -0.5 * gap, 0.5 * gap),
      4
    );
  }
  const frame: AxionikSpectralFrame = { amps, offsets };
  if (f0Hz > 0) frame.f0Hz = roundTo(f0Hz, 3);
  return frame;
}

function buildSpectralModel(
  spectral: ExpandedSpectralSource,
  pitchTrackHz?: number[],
  formantProfileSt?: number[]
): AxionikSpectralModel {
  const frameCount = Math.max(1, Math.floor(spectral.frameCount));
  const rootAmps = spectral.ampsOf(0);
  const partialCount = rootAmps.length;
  if (partialCount < 1) {
    throw new Error('expandedModelWriter: spectral source has no partials');
  }
  const frames: AxionikSpectralFrame[] = [];
  for (let f = 0; f < frameCount; f++) {
    frames.push(
      frameToExpanded(
        spectral.ampsOf(f),
        spectral.offsetsOf(f),
        spectral.frameSpanHz,
        f === 0 ? 0 : spectral.f0At(f)
      )
    );
  }
  const model: AxionikSpectralModel = {
    partialCount,
    frameCount,
    frames,
  };
  if (spectral.frameSpanHz > 0) {
    model.frameSpanHz = roundTo(spectral.frameSpanHz, 3);
  }
  if (spectral.gridFixed) model.gridFixed = true;
  if (spectral.isLayered()) {
    const layers: AxionikSpectralLayer[] = [];
    for (let l = 0; l < spectral.layerCount; l++) {
      const numFrames = spectral.numFramesOf(l);
      const layerFrames: AxionikSpectralFrame[] = [];
      const frameWeights: number[] = [];
      for (let f = 0; f < numFrames; f++) {
        layerFrames.push(
          frameToExpanded(
            spectral.ampsOfLayer(l, f),
            spectral.offsetsOfLayer(l, f),
            spectral.frameSpanHz,
            l === 0 && f === 0 ? 0 : spectral.f0AtLayer(l, f)
          )
        );
        frameWeights.push(roundTo(spectral.frameWeightAt(l, f), 5));
      }
      layers.push({
        name: spectral.layerNameAt(l),
        weight: roundTo(spectral.layerWeightAt(l), 4),
        frames: layerFrames,
        frameWeights,
      });
    }
    model.layers = layers;
  }
  if (pitchTrackHz && pitchTrackHz.length > 0) {
    model.pitchTrackHz = pitchTrackHz.map((v) => roundTo(v, 3));
  }
  if (formantProfileSt && formantProfileSt.length > 0) {
    model.formantProfileSt = formantProfileSt.map((v) => roundTo(v, 3));
  }
  return model;
}

function mapDahdsr(env: DahdsrEnvelope): AxionikDahdsr {
  return {
    delay: roundTo(env.delaySec, 4),
    attack: roundTo(env.attackSec, 4),
    hold: roundTo(env.holdSec, 4),
    decay: roundTo(env.decaySec, 4),
    sustain: roundTo(clamp(env.sustainLevel, 0, 1), 4),
    release: roundTo(env.releaseSec, 4),
  };
}

function mapRegion(region: ExtendedRegion): AxionikRegion {
  const out: AxionikRegion = {
    id: region.id,
    sampleRef: basename(region.sampleName) || region.sampleName,
    lowKey: region.lowKey,
    highKey: region.highKey,
    rootKey: region.rootKey,
    lowVel: region.lowVel,
    highVel: region.highVel,
    detuneCents: roundTo(region.detune, 2),
    volumeDb: roundTo(region.volume, 2),
    // NeuModMakr pan is -50..+50; the expanded contract uses -1..1.
    pan: roundTo(clamp(region.pan / 50, -1, 1), 3),
    pitchKeytrack: region.pitchKeytrack,
    loop: {
      mode: region.loopMode,
      startFrame: region.loopStart,
      endFrame: region.loopEnd,
      crossfadeMs: roundTo(region.loopCrossfadeMs, 2),
    },
  };
  if (region.numChannels === 1 || region.numChannels === 2 || region.numChannels === 4) {
    out.channels = region.numChannels;
  }
  if (region.hasArticulationOverride && region.ampEnvOverride) {
    const o = region.ampEnvOverride;
    const partial: Partial<AxionikDahdsr> = {};
    if (typeof o.delaySec === 'number') partial.delay = roundTo(o.delaySec, 4);
    if (typeof o.attackSec === 'number') partial.attack = roundTo(o.attackSec, 4);
    if (typeof o.holdSec === 'number') partial.hold = roundTo(o.holdSec, 4);
    if (typeof o.decaySec === 'number') partial.decay = roundTo(o.decaySec, 4);
    if (typeof o.sustainLevel === 'number') {
      partial.sustain = roundTo(clamp(o.sustainLevel, 0, 1), 4);
    }
    if (typeof o.releaseSec === 'number') partial.release = roundTo(o.releaseSec, 4);
    if (Object.keys(partial).length > 0) out.ampEnv = partial;
  }
  if (region.hasArticulationOverride && region.filterOverride?.cutoffHz !== undefined) {
    // Classic filter kind already lives in the classic layer; here it is a
    // bypassable legacy block so old engines ignore it safely.
    out.filter = {
      id: `${region.id}-filter`,
      type: 'legacy-neuron',
      cutoffHz: roundTo(region.filterOverride.cutoffHz, 1),
      resonance: roundTo(
        clamp((region.filterOverride.resonanceDb ?? 0) / 40, 0, 1),
        3
      ),
    };
  }
  return out;
}

function mapArticulation(
  articulation: SynthArticulationConfig | undefined,
  expandedFilters: AxionikFilterBlock[],
  expandedFx: AxionikFxBlock[]
): AxionikArticulation {
  // Safe default when the session carries no articulation: neutral envelope,
  // legacy filter bypassed, empty FX chain (classic has no master FX chain).
  const ampEnv: AxionikDahdsr = articulation
    ? mapDahdsr(articulation.ampEnv)
    : { delay: 0, attack: 0.005, hold: 0, decay: 0, sustain: 1, release: 0.05 };
  const filters: AxionikFilterBlock[] = [];
  if (articulation) {
    filters.push({
      id: 'classic-filter',
      type: 'legacy-neuron',
      cutoffHz: roundTo(articulation.filter.cutoffHz, 1),
      resonance: roundTo(clamp(articulation.filter.resonanceDb / 40, 0, 1), 3),
      keytrack: roundTo(clamp(articulation.filter.keytrackCents / 1200, 0, 1), 3),
      bypass: !articulation.filter.enabled,
    });
  }
  for (const f of expandedFilters) filters.push({ ...f });
  const out: AxionikArticulation = {
    ampEnv,
    filters,
    fxChain: expandedFx.map((fx) => ({ ...fx })),
  };
  if (articulation) {
    if (articulation.modEnvEnabled) {
      out.modEnv = mapDahdsr(articulation.modEnv);
      out.modEnvToPitchCents = Math.round(articulation.modEnvToPitchCents);
    }
    if (typeof articulation.polyphony === 'number') {
      out.polyphony = clamp(Math.round(articulation.polyphony), 1, 64);
    }
    if (articulation.voiceMode) out.voiceMode = articulation.voiceMode;
    if (typeof articulation.glideTimeSec === 'number') {
      out.glideTimeSec = roundTo(Math.max(0, articulation.glideTimeSec), 4);
    }
  }
  return out;
}

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

/**
 * Builds a loadable Axionik Expanded Model v2 document from capsule data.
 * Throws on an empty spectral source; every other section degrades to a
 * documented neutral default so the document always validates.
 */
export function buildAxionikExpandedModel(
  input: ExpandedModelWriterInput
): AxionikExpandedModel {
  const fullName = (input.expandedName ?? input.modelName).trim() || 'UNTITLED';
  const spectral = buildSpectralModel(
    input.spectral,
    input.pitchTrackHz,
    input.formantProfileSt
  );
  const regions = input.regions.map(mapRegion);
  const expandedFilters = input.expandedFilters ?? [];
  const expandedFx = input.expandedFx ?? [];
  const aiSteps: AxionikAiStep[] = (input.aiSteps ?? []).map((s) => ({ ...s }));
  const maxChannels = regions.reduce(
    (m, r) => Math.max(m, r.channels ?? 1),
    1
  );
  const hasNonLegacyFilter = expandedFilters.some(
    (f) => f.type !== 'legacy-neuron'
  );
  const requiredCaps =
    input.requiredCapsOverride ??
    deriveRequiredCaps({
      partialCount: spectral.partialCount,
      hasPitchFormantSplit:
        (spectral.pitchTrackHz?.length ?? 0) > 0 ||
        (spectral.formantProfileSt?.length ?? 0) > 0,
      morphDims: input.morphSpace?.dims ?? 0,
      hasLatentRef: input.latentRef !== undefined || input.morphSpace?.latentRef !== undefined,
      maxChannels,
      hasHybridTransient: input.hasHybridTransient === true,
      hasNonLegacyFilter,
      hasFx: expandedFx.length > 0,
      hasAi: aiSteps.length > 0,
    });

  const dspAlgorithm = input.processConfig.dspAlgorithm ?? 'legacy';
  const doc: AxionikExpandedModel = {
    schemaVersion: AXIONIK_EXPANDED_MODEL_CONTRACT_VERSION,
    identity: {
      slug: slugifyModelName(fullName),
      expandedName: fullName,
      modelName: (input.processConfig.modelName || fullName).slice(0, 11),
      engineMin: input.engineMin ?? 'expanded-v1',
      requiredCaps,
    },
    spectral,
    regions,
    articulation: mapArticulation(
      input.articulation,
      expandedFilters,
      expandedFx
    ),
    resynators: (input.resynators ?? []).map((r) => ({ ...r })),
    analysis: {
      algorithm:
        spectral.partialCount > 64
          ? 'hd'
          : dspAlgorithm === 'enhanced'
            ? 'enhanced'
            : 'legacy',
      complexity: clamp(Math.round(input.processConfig.complexity), 1, 10),
      parameterSet: clamp(Math.round(input.processConfig.parameterSet), 0, 9),
      category: input.detectedInstrumentCategory,
      qualityScore: input.qualityScore
        ? roundTo(clamp(input.qualityScore.overallScore, 0, 100), 2)
        : undefined,
      descriptorsRef: input.descriptorsRef,
    },
    classic: {
      modelName: (input.processConfig.modelName || fullName).slice(0, 11),
      mapScriptRef:
        input.classicMapScriptRef ?? '04_classic_enhanced/map.script',
      scapeSphereRefs: input.classicScapeSphereRefs ?? [],
    },
  };
  if (input.morphSpace) {
    doc.morphSpace = {
      dims: input.morphSpace.dims,
      points: input.morphSpace.points.map((p) => ({ ...p })),
      latentRef: input.morphSpace.latentRef
        ? { ...input.morphSpace.latentRef }
        : input.latentRef
          ? { ...input.latentRef }
          : undefined,
    };
    if (!doc.morphSpace.latentRef && input.latentRef) {
      doc.morphSpace.latentRef = { ...input.latentRef };
    }
  } else if (input.latentRef) {
    doc.morphSpace = {
      dims: 2,
      points: [],
      latentRef: { ...input.latentRef },
    };
  }
  if (aiSteps.length > 0) doc.aiChain = aiSteps;
  return doc;
}

/** Serializes the document exactly as stored in the capsule (`JSON`, 2 spaces). */
export function serializeExpandedModel(doc: AxionikExpandedModel): string {
  return JSON.stringify(doc, null, 2);
}

// ── Preflight against an Axionik engine ────────────────────

export interface AxionikEngineProfile {
  /** Engine generation string; unknown generations fail closed. */
  generation: string;
  /** Capability flags the engine announces (discovery, never assumption). */
  caps: readonly string[];
  /** Maximum spectral partials the engine renders (HD truncation otherwise). */
  maxPartials?: number;
  /** Maximum spectral frames the engine renders. */
  maxFrames?: number;
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
  'expanded-v1': 1,
};

/**
 * Preflights a v2 document (or its JSON text) against an Axionik engine
 * profile. Fatal (`ok: false`): unparsable JSON, non-v2 document, engine
 * older than `engineMin`, or any missing `requiredCaps` — the load is then
 * blocked, never silently corrupted. Everything else is a warning or an
 * explicit adaptation the engine must apply (bypass unknown filter/FX
 * types, skip unknown resynator models, truncate HD spectra).
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
  } else if (haveRank < needRank) {
    errors.push(
      `engine-too-old: document requires '${model.identity.engineMin}' but engine is '${engine.generation}'`
    );
  }

  const missingCaps = requiredCaps.filter((c) => !engine.caps.includes(c));
  if (!meetsEngineCaps(engine.caps, requiredCaps)) {
    errors.push(
      `missing-caps: engine lacks [${missingCaps.join(', ')}]`
    );
  }

  // Consistency: content that SHOULD have raised a cap but didn't.
  const implied: AxionikEngineCap[] = deriveRequiredCaps({
    partialCount: model.spectral.partialCount,
    hasPitchFormantSplit:
      (model.spectral.pitchTrackHz?.length ?? 0) > 0 ||
      (model.spectral.formantProfileSt?.length ?? 0) > 0,
    morphDims: model.morphSpace?.dims ?? 0,
    hasLatentRef:
      model.morphSpace?.latentRef !== undefined,
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

  // Degradable mismatches: explicit adaptations, never silent.
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
