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
  deriveRequiredCaps,
  isAxionikExpandedModel,
  isAxionikEngineCap,
  isAxionikEngineGeneration,
  meetsEngineCaps,
  preflightExpandedModelForAxionik,
  validateModelFormatForMode,
  type AxionikAiStep,
  type AxionikArticulation,
  type AxionikDahdsr,
  type AxionikEngineCap,
  type AxionikEngineGeneration,
  type AxionikEngineProfile,
  type AxionikExpandedModel,
  type AxionikFilterBlock,
  type AxionikFxBlock,
  type AxionikHybridTransient,
  type AxionikMorphSpace,
  type AxionikRegion,
  type AxionikResonatorShapers,
  type AxionikResynatorV2,
  type AxionikSpatialOutputMode,
  type AxionikSpectralFrame,
  type AxionikSpectralLayer,
  type AxionikSpectralModel,
  type AxionikSurfaceTopology,
  type AxionikUnifiedSpectralSurface,
  type ExpandedAxionikPreflightReport,
  type RequiredCapsSource,
} from '@abdsynths/shared/contracts/axionikExpandedModel.ts';
export {
  deriveRequiredCaps,
  preflightExpandedModelForAxionik,
  type AxionikEngineProfile,
  type ExpandedAxionikPreflightReport,
  type RequiredCapsSource,
};
import { buildUnifiedSpectralSurface } from './dsp/UnifiedSpectralSurface.ts';
import type {
  AcousticDescriptors,
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
  /** Optional state-of-the-art extensions (Loris bandwidths, DDSP residual, Bark formants, phases, quad radiation). */
  timeSecAt?(frame: number): number;
  phasesOf?(frame: number): Float32Array;
  bandwidthsOf?(frame: number): Float32Array;
  residualBandsOf?(frame: number): Float32Array;
  formantEnvelopeOf?(frame: number): Float32Array;
  spatialQuadOf?(frame: number): [number, number, number, number];
  layerSpatialQuadAt?(layer: number): [number, number, number, number];
}

export interface ExpandedModelWriterInput {
  slot: number;
  modelName: string;
  expandedName?: string;
  processConfig: ProcessConfig;
  spectral: ExpandedSpectralSource;
  /**
   * Optional per-sample HD spectral sources keyed by `sampleRef` (basename) or full `sampleName`.
   * Eliminates the single-spectrum funnel so multi-sample instruments carry per-zone HD spectra.
   */
  spectralBySample?: Record<string, ExpandedSpectralSource>;
  regions: ExtendedRegion[];
  articulation?: SynthArticulationConfig;
  detectedInstrumentCategory?: string;
  qualityScore?: DspQualityScore;
  /** Optional acoustic descriptors used to derive physical/spectral Resonator shapers & transient splice. */
  acousticDescriptors?: AcousticDescriptors;
  /** Reference to the descriptor blob used for classification. */
  descriptorsRef?: string;
  /** Detached pitch trajectory, one entry per spectral frame. */
  pitchTrackHz?: number[];
  /** Detached global formant profile in semitones, one entry per frame. */
  formantProfileSt?: number[];
  morphSpace?: AxionikMorphSpace;
  latentRef?: { dims: number; codec: string; dataRef: string };
  /** Expanded v2 filter blocks appended after the mapped classic filter (Synth independent audio chain). */
  expandedFilters?: AxionikFilterBlock[];
  /** Expanded v2 master-effect chain (Synth independent audio chain). */
  expandedFx?: AxionikFxBlock[];
  resynators?: AxionikResynatorV2[];
  aiSteps?: AxionikAiStep[];
  /** True when a real PCM micro-transient attack rides the model. */
  hasHybridTransient?: boolean;
  /** Optional explicit hybrid transient splice config (applied to regions when `hasHybridTransient` is true). */
  defaultHybridTransient?: AxionikHybridTransient;
  /** Optional per-sample hybrid transient splice config keyed by `sampleRef`. */
  hybridTransientBySample?: Record<string, AxionikHybridTransient>;
  /** When true, deterministically populates Loris bandwidths, 24-Bark formant envelopes, DDSP residuals, and splice phases. */
  populateAdvancedSpectralExtensions?: boolean;
  /**
   * Fase 38: When true (default when `populateAdvancedSpectralExtensions` is true or multiple regions exist),
   * compiles the Unified Continuous Spectral Surface (`unifiedSurface`) covering the full Pitch × Velocity spectrum.
   */
  buildUnifiedSurface?: boolean;
  /** Optional topology override for `unifiedSurface` ('auto' | 'melodic_surface' | 'drum_kit_surface'). */
  surfaceTopologyOverride?: 'auto' | AxionikSurfaceTopology;
  /** Optional resolution strategy for `unifiedSurface` ('auto' by default, or 'manual' using `processConfig.complexity`). */
  surfaceResolutionStrategy?: 'auto' | 'manual';
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

/** 24 critical Bark band upper frequencies in Hz for formant & DDSP residual envelopes. */
const BARK_BAND_EDGES_HZ = [
  100, 200, 300, 400, 510, 630, 770, 920, 1080, 1270, 1480, 1720,
  2000, 2320, 2700, 3150, 3700, 4400, 5300, 6400, 7700, 9500, 12000, 15500,
] as const;

/**
 * Derives physical and spectral Resonator v2 shapers (ABDAxionikVS expanded mode sonic matter model)
 * from deterministic `AcousticDescriptors`.
 */
export function deriveResonatorShapersFromDescriptors(
  desc: Partial<AcousticDescriptors> & {
    inharmonicityStiffness?: number;
    attackTimeMs?: number;
  }
): AxionikResonatorShapers {
  const inharmonicityB = roundTo(
    clamp(desc.inharmonicityB ?? desc.inharmonicityStiffness ?? 0, 0, 0.05),
    6
  );
  const entropyRoughness = roundTo(
    clamp(
      (1 - clamp(desc.harmonicity ?? 0.8, 0, 1)) * 0.6 +
        clamp(desc.spectralFlatness ?? 0.1, 0, 1) * 0.4,
      0,
      1
    ),
    4
  );
  const centroidHz = desc.spectralCentroidHz ?? 1800;
  const hfRollOffDbPerOct = roundTo(
    clamp(-6.0 + ((centroidHz - 2000) / 4000) * 3.0, -18, 0),
    2
  );
  return {
    inharmonicityB,
    parity: 0,
    entropyRoughness,
    spectralShiftHz: 0,
    hfRollOffDbPerOct,
    formantShiftSt: 0,
    formantPreserve: desc.isPercussiveOrNoise ? 0.25 : 0.85,
    residualMix: roundTo(clamp(1 - (desc.harmonicity ?? 0.85), 0.05, 0.85), 3),
    spatialSpread: 0.5,
  };
}

function computeDeterministicBarkEnvelopes(
  amps: number[],
  offsets: number[],
  baseF0Hz: number,
  bandwidths: number[]
): { formantEnvelopeDb: number[]; residualBandsDb: number[] } {
  const f0 = baseF0Hz > 20 ? baseF0Hz : 220;
  const formantEnvelopeDb = new Array<number>(BARK_BAND_EDGES_HZ.length).fill(-96);
  const residualBandsDb = new Array<number>(BARK_BAND_EDGES_HZ.length).fill(-96);
  const harmonicEnergy = new Float64Array(BARK_BAND_EDGES_HZ.length);
  const residualEnergy = new Float64Array(BARK_BAND_EDGES_HZ.length);
  const counts = new Int32Array(BARK_BAND_EDGES_HZ.length);

  for (let i = 0; i < amps.length; i++) {
    const a = Math.max(0, amps[i] ?? 0);
    const bw = clamp(bandwidths[i] ?? 0, 0, 1);
    const freqHz = Math.max(20, (i + 1) * f0 + (offsets[i] ?? 0));
    let bandIdx = BARK_BAND_EDGES_HZ.length - 1;
    for (let b = 0; b < BARK_BAND_EDGES_HZ.length; b++) {
      if (freqHz <= BARK_BAND_EDGES_HZ[b]) {
        bandIdx = b;
        break;
      }
    }
    const e = a * a;
    harmonicEnergy[bandIdx] += e * (1 - 0.5 * bw);
    residualEnergy[bandIdx] += e * Math.max(0.02, bw);
    counts[bandIdx]++;
  }

  // Smooth across adjacent Bark bands so formant peaks (F1/F2/F3) form a continuous curve
  for (let b = 0; b < BARK_BAND_EDGES_HZ.length; b++) {
    const prevH = b > 0 ? harmonicEnergy[b - 1] : harmonicEnergy[b];
    const nextH =
      b + 1 < BARK_BAND_EDGES_HZ.length ? harmonicEnergy[b + 1] : harmonicEnergy[b];
    const smoothH = 0.25 * prevH + 0.5 * harmonicEnergy[b] + 0.25 * nextH;
    const smoothR =
      0.25 * (b > 0 ? residualEnergy[b - 1] : residualEnergy[b]) +
      0.5 * residualEnergy[b] +
      0.25 *
        (b + 1 < BARK_BAND_EDGES_HZ.length
          ? residualEnergy[b + 1]
          : residualEnergy[b]);
    formantEnvelopeDb[b] =
      smoothH > 1e-10 ? roundTo(clamp(10 * Math.log10(smoothH), -96, 6), 2) : -96;
    residualBandsDb[b] =
      smoothR > 1e-10 ? roundTo(clamp(10 * Math.log10(smoothR), -96, 6), 2) : -96;
  }
  return { formantEnvelopeDb, residualBandsDb };
}

function frameToExpanded(
  amplitudes: Float32Array,
  frequencyOffsets: Float32Array,
  frameSpan: number,
  f0Hz: number,
  ext?: {
    timeSec?: number;
    phases?: Float32Array;
    bandwidths?: Float32Array;
    residualBandsDb?: Float32Array;
    formantEnvelopeDb?: Float32Array;
    spatialQuad?: [number, number, number, number];
    autoDeriveExtensions?: boolean;
  }
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
  if (ext) {
    if (typeof ext.timeSec === 'number' && ext.timeSec >= 0) {
      frame.timeSec = roundTo(ext.timeSec, 4);
    }
    if (ext.phases && ext.phases.length === partialCount) {
      frame.phases = Array.from(ext.phases, (p) => roundTo(p, 4));
    }
    if (ext.bandwidths && ext.bandwidths.length === partialCount) {
      frame.bandwidths = Array.from(ext.bandwidths, (b) =>
        roundTo(clamp(b, 0, 1), 4)
      );
    } else if (ext.autoDeriveExtensions) {
      // Derive Loris-style per-partial bandwidth from frequency offset deviation + upper-harmonic air
      const gap = Math.max(1, frameSpan > 0 ? frameSpan : 50);
      frame.bandwidths = offsets.map((off, idx) => {
        const detuneRatio = Math.min(1, Math.abs(off) / (0.5 * gap));
        const highAir = (idx / Math.max(1, partialCount - 1)) * 0.25;
        return roundTo(clamp(detuneRatio * 0.65 + highAir, 0, 1), 4);
      });
    }
    if (ext.residualBandsDb && ext.residualBandsDb.length > 0) {
      frame.residualBandsDb = Array.from(ext.residualBandsDb, (v) =>
        roundTo(v, 2)
      );
    }
    if (ext.formantEnvelopeDb && ext.formantEnvelopeDb.length > 0) {
      frame.formantEnvelopeDb = Array.from(ext.formantEnvelopeDb, (v) =>
        roundTo(v, 2)
      );
    }
    if (
      ext.autoDeriveExtensions &&
      (!frame.formantEnvelopeDb || !frame.residualBandsDb)
    ) {
      const derived = computeDeterministicBarkEnvelopes(
        amps,
        offsets,
        f0Hz > 0 ? f0Hz : frameSpan,
        frame.bandwidths ?? new Array<number>(partialCount).fill(0.05)
      );
      if (!frame.formantEnvelopeDb) {
        frame.formantEnvelopeDb = derived.formantEnvelopeDb;
      }
      if (!frame.residualBandsDb) {
        frame.residualBandsDb = derived.residualBandsDb;
      }
    }
    if (ext.spatialQuad && ext.spatialQuad.length === 4) {
      frame.spatialQuad = [
        roundTo(ext.spatialQuad[0], 3),
        roundTo(ext.spatialQuad[1], 3),
        roundTo(ext.spatialQuad[2], 3),
        roundTo(ext.spatialQuad[3], 3),
      ];
    }
  }
  return frame;
}

export function buildSpectralModel(
  spectral: ExpandedSpectralSource,
  pitchTrackHz?: number[],
  formantProfileSt?: number[],
  populateAdvanced = false
): AxionikSpectralModel {
  const frameCount = Math.max(1, Math.floor(spectral.frameCount));
  const rootAmps = spectral.ampsOf(0);
  const partialCount = rootAmps.length;
  if (partialCount < 1) {
    throw new Error('expandedModelWriter: spectral source has no partials');
  }
  const frames: AxionikSpectralFrame[] = [];
  for (let f = 0; f < frameCount; f++) {
    const hasCustomExt =
      populateAdvanced ||
      spectral.timeSecAt !== undefined ||
      spectral.phasesOf !== undefined ||
      spectral.bandwidthsOf !== undefined ||
      spectral.residualBandsOf !== undefined ||
      spectral.formantEnvelopeOf !== undefined ||
      spectral.spatialQuadOf !== undefined;
    frames.push(
      frameToExpanded(
        spectral.ampsOf(f),
        spectral.offsetsOf(f),
        spectral.frameSpanHz,
        f === 0 ? 0 : spectral.f0At(f),
        hasCustomExt
          ? {
              timeSec:
                spectral.timeSecAt?.(f) ??
                (populateAdvanced ? roundTo(f * 0.04, 4) : undefined),
              phases:
                spectral.phasesOf?.(f) ??
                (populateAdvanced && f <= 1
                  ? new Float32Array(partialCount)
                  : undefined),
              bandwidths: spectral.bandwidthsOf?.(f),
              residualBandsDb: spectral.residualBandsOf?.(f),
              formantEnvelopeDb: spectral.formantEnvelopeOf?.(f),
              spatialQuad: spectral.spatialQuadOf?.(f),
              autoDeriveExtensions: populateAdvanced,
            }
          : undefined
      )
    );
  }
  const model: AxionikSpectralModel = {
    partialCount,
    frameCount,
    frames,
  };
  if (
    populateAdvanced ||
    frames.some(
      (fr) => fr.formantEnvelopeDb !== undefined || fr.residualBandsDb !== undefined
    )
  ) {
    model.barkBandCount = BARK_BAND_EDGES_HZ.length;
  }
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
      const layerObj: AxionikSpectralLayer = {
        name: spectral.layerNameAt(l),
        weight: roundTo(spectral.layerWeightAt(l), 4),
        frames: layerFrames,
        frameWeights,
      };
      const layerQuad = spectral.layerSpatialQuadAt?.(l);
      if (layerQuad && layerQuad.length === 4) {
        layerObj.spatialQuad = [
          roundTo(layerQuad[0], 3),
          roundTo(layerQuad[1], 3),
          roundTo(layerQuad[2], 3),
          roundTo(layerQuad[3], 3),
        ];
      } else if (populateAdvanced) {
        // Default Scape (front-weighted on layer 0) vs Sphere (surround-weighted on upper layers)
        layerObj.spatialQuad =
          l === 0 ? [0.85, 0.85, 0.25, 0.25] : [0.4, 0.4, 0.9, 0.9];
      }
      layers.push(layerObj);
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

function mapRegion(
  region: ExtendedRegion,
  hybridTransient?: AxionikHybridTransient
): AxionikRegion {
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
  if (region.trigger && region.trigger !== 'attack') {
    out.trigger = region.trigger;
  }
  if (typeof region.keyFadeIn === 'number' && region.keyFadeIn > 0) {
    out.keyFadeIn = region.keyFadeIn;
  }
  if (typeof region.keyFadeOut === 'number' && region.keyFadeOut > 0) {
    out.keyFadeOut = region.keyFadeOut;
  }
  if (typeof region.velFadeIn === 'number' && region.velFadeIn > 0) {
    out.velFadeIn = region.velFadeIn;
  }
  if (typeof region.velFadeOut === 'number' && region.velFadeOut > 0) {
    out.velFadeOut = region.velFadeOut;
  }
  if (region.fadeCurve && region.fadeCurve !== 'linear') {
    out.fadeCurve = region.fadeCurve;
  }
  const rrRegion = region as ExtendedRegion & {
    roundRobinGroup?: string;
    roundRobinIndex?: number;
  };
  if (rrRegion.roundRobinGroup) {
    out.roundRobinGroup = rrRegion.roundRobinGroup;
  }
  if (typeof rrRegion.roundRobinIndex === 'number') {
    out.roundRobinIndex = rrRegion.roundRobinIndex;
  } else if (typeof region.seqPosition === 'number' && region.seqPosition > 0) {
    out.roundRobinIndex = region.seqPosition;
  }
  if (region.numChannels === 1 || region.numChannels === 2 || region.numChannels === 4) {
    out.channels = region.numChannels;
  }
  if (hybridTransient) {
    out.hybridTransient = {
      durationMs: roundTo(Math.max(0, hybridTransient.durationMs), 2),
      crossfadeMs: roundTo(Math.max(0, hybridTransient.crossfadeMs), 2),
      ...(typeof hybridTransient.gainDb === 'number'
        ? { gainDb: roundTo(hybridTransient.gainDb, 2) }
        : {}),
      ...(typeof hybridTransient.onsetFrame === 'number'
        ? { onsetFrame: Math.max(0, Math.floor(hybridTransient.onsetFrame)) }
        : {}),
      ...(typeof hybridTransient.spliceFrameIndex === 'number'
        ? {
            spliceFrameIndex: Math.max(
              0,
              Math.floor(hybridTransient.spliceFrameIndex)
            ),
          }
        : {}),
    };
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

/**
 * Builds a loadable Axionik Expanded Model v2 document from capsule data.
 * Throws on an empty spectral source; every other section degrades to a
 * documented neutral default so the document always validates.
 */
export function buildAxionikExpandedModel(
  input: ExpandedModelWriterInput
): AxionikExpandedModel {
  const fullName = (input.expandedName ?? input.modelName).trim() || 'UNTITLED';
  const populateAdvanced = input.populateAdvancedSpectralExtensions === true;
  const spectral = buildSpectralModel(
    input.spectral,
    input.pitchTrackHz,
    input.formantProfileSt,
    populateAdvanced
  );

  // Build per-sample HD spectral dictionary when multiple samples are provided
  let spectralBySample: Record<string, AxionikSpectralModel> | undefined;
  if (input.spectralBySample && Object.keys(input.spectralBySample).length > 0) {
    spectralBySample = {};
    for (const [sampleKey, src] of Object.entries(input.spectralBySample)) {
      const ref = basename(sampleKey) || sampleKey;
      spectralBySample[ref] = buildSpectralModel(
        src,
        undefined,
        undefined,
        populateAdvanced
      );
    }
  }

  // Derive default hybrid transient splice window when `hasHybridTransient` is true
  const derivedDefaultTransient: AxionikHybridTransient | undefined =
    input.defaultHybridTransient ??
    (input.hasHybridTransient
      ? {
          durationMs: roundTo(
            clamp(input.acousticDescriptors?.attackMs ?? 24, 8, 80),
            2
          ),
          crossfadeMs: 6,
          gainDb: 0,
          onsetFrame: 0,
          spliceFrameIndex: Math.min(1, Math.max(0, spectral.frameCount - 1)),
        }
      : undefined);

  const regions = input.regions.map((r) => {
    const ref = basename(r.sampleName) || r.sampleName;
    const regionTransient =
      input.hybridTransientBySample?.[ref] ??
      input.hybridTransientBySample?.[r.sampleName] ??
      derivedDefaultTransient;
    return mapRegion(r, regionTransient);
  });
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
  const maxPartialCountAcrossSamples = spectralBySample
    ? Object.values(spectralBySample).reduce(
        (m, s) => Math.max(m, s.partialCount),
        spectral.partialCount
      )
    : spectral.partialCount;
  const hasAnyHybridTransient =
    input.hasHybridTransient === true ||
    regions.some((r) => r.hybridTransient !== undefined);
  const hasAnyFormantSplit =
    (spectral.pitchTrackHz?.length ?? 0) > 0 ||
    (spectral.formantProfileSt?.length ?? 0) > 0 ||
    spectral.frames.some((fr) => (fr.formantEnvelopeDb?.length ?? 0) > 0);

  const requiredCaps =
    input.requiredCapsOverride ??
    deriveRequiredCaps({
      partialCount: maxPartialCountAcrossSamples,
      hasPitchFormantSplit: hasAnyFormantSplit,
      morphDims: input.morphSpace?.dims ?? 0,
      hasLatentRef: input.latentRef !== undefined || input.morphSpace?.latentRef !== undefined,
      maxChannels,
      hasHybridTransient: hasAnyHybridTransient,
      hasNonLegacyFilter,
      hasFx: expandedFx.length > 0,
      hasAi: aiSteps.length > 0,
    });

  // Build Resynator v2 definitions, auto-attaching ABDAxionikVS expanded shapers if acousticDescriptors or unifiedSurfaceConfig are provided
  const uiSurfCfg = input.processConfig.unifiedSurfaceConfig;
  const baseShapers = input.acousticDescriptors
    ? deriveResonatorShapersFromDescriptors(input.acousticDescriptors)
    : undefined;
  const derivedShapers: AxionikResonatorShapers | undefined =
    baseShapers || uiSurfCfg
      ? {
          ...baseShapers,
          ...(typeof uiSurfCfg?.inharmonicityB === 'number'
            ? { inharmonicityB: roundTo(clamp(uiSurfCfg.inharmonicityB, 0, 0.05), 5) }
            : {}),
          ...(typeof uiSurfCfg?.parity === 'number'
            ? { parity: roundTo(clamp(uiSurfCfg.parity, -1, 1), 3) }
            : {}),
          ...(typeof uiSurfCfg?.residualMix === 'number'
            ? { residualMix: roundTo(clamp(uiSurfCfg.residualMix, 0, 1), 3) }
            : {}),
          ...(typeof uiSurfCfg?.formantLock01 === 'number'
            ? { formantPreserve: roundTo(clamp(uiSurfCfg.formantLock01, 0, 1), 3) }
            : {}),
        }
      : undefined;
  const resynators: AxionikResynatorV2[] =
    input.resynators && input.resynators.length > 0
      ? input.resynators.map((r) => ({
          ...r,
          params: { ...r.params },
          ...(r.shapers
            ? { shapers: { ...r.shapers } }
            : derivedShapers
              ? { shapers: { ...derivedShapers } }
              : {}),
        }))
      : derivedShapers
        ? [
            {
              id: 'R1',
              version: 2,
              model: 'resonator-hd',
              params: {
                ...(typeof uiSurfCfg?.attackShorten01 === 'number'
                  ? { attackShorten01: roundTo(clamp(uiSurfCfg.attackShorten01, 0, 1), 3) }
                  : {}),
                ...(typeof uiSurfCfg?.releaseExtendSec === 'number'
                  ? { releaseExtendSec: roundTo(clamp(uiSurfCfg.releaseExtendSec, 0, 10), 2) }
                  : {}),
                ...(uiSurfCfg?.tempoSync
                  ? {
                      tempoSyncEnabled: uiSurfCfg.tempoSync.enabled ? 1 : 0,
                      sourceBpm: clamp(uiSurfCfg.tempoSync.sourceBpm || 120, 20, 300),
                      barCount: Math.max(1, Math.round(uiSurfCfg.tempoSync.barCount || 2)),
                    }
                  : {}),
              },
              shapers: derivedShapers,
            },
          ]
        : [];

  const dspAlgorithm = input.processConfig.dspAlgorithm ?? 'legacy';
  const shouldBuildUnifiedSurface =
    input.buildUnifiedSurface ??
    (populateAdvanced || regions.length > 1 || Boolean(spectralBySample) || Boolean(uiSurfCfg));

  const unifiedSurface: AxionikUnifiedSpectralSurface | undefined = shouldBuildUnifiedSurface
    ? buildUnifiedSpectralSurface({
        regions,
        primarySpectral: spectral,
        spectralBySample,
        detectedCategory: input.detectedInstrumentCategory,
        resolutionStrategy:
          input.surfaceResolutionStrategy ?? uiSurfCfg?.resolutionStrategy ?? 'auto',
        complexity: input.processConfig.complexity,
        topologyOverride:
          input.surfaceTopologyOverride ?? uiSurfCfg?.topologyMode ?? 'auto',
        tempoSync: uiSurfCfg?.tempoSync,
      })
    : undefined;

  if (unifiedSurface && uiSurfCfg?.includeOutliers === true) {
    for (const node of unifiedSurface.nodes) {
      node.isTimbralOutlier = false;
    }
    delete unifiedSurface.outlierNodeIds;
  }

  const doc: AxionikExpandedModel = {
    schemaVersion: AXIONIK_EXPANDED_MODEL_CONTRACT_VERSION,
    identity: {
      slug: slugifyModelName(fullName),
      expandedName: fullName,
      modelName: (input.processConfig.modelName || fullName).slice(0, 11),
      engineMin: input.engineMin ?? 'expanded',
      requiredCaps,
    },
    spectral,
    ...(spectralBySample ? { spectralBySample } : {}),
    ...(unifiedSurface ? { unifiedSurface } : {}),
    regions,
    articulation: mapArticulation(
      input.articulation,
      expandedFilters,
      expandedFx
    ),
    resynators,
    analysis: {
      algorithm:
        maxPartialCountAcrossSamples > 64
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
