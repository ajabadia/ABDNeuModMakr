// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Fase 38: Unified Continuous Spectral Surface
//
// Compiles an arbitrary collection of multisample zones and velocity layers
// into a single unified spectral model (`AxionikUnifiedSpectralSurface`)
// for the proprietary ABDAxionikVS Resynator:
//   1. Automatic Topology Detection (`melodic_surface` vs `drum_kit_surface`):
//      Distinguishes melodic/tuned instruments (pianos, synths, strings, tuned bottles)
//      from discrete drum kits / unpitched collections using F0 monotonicity across
//      MIDI keys and 24-Bark formant envelope correlation.
//   2. Content-Adaptive Resolution Sizing (`compact` | `standard` | `hd` | `ultra-hd`):
//      Automatically adapts `(partialCount, frameCount)` to the acoustic richness
//      of the input (or honors manual complexity levels 1..10).
//   3. Landmark Time-Warping (`Attack Peak` -> `Sustain Horizon` -> `Release`):
//      Aligns all calibration nodes to canonical frame landmarks so bilinear
//      interpolation never smears attacks, and enables shortening slow pad attacks
//      (`attackShorten01`) or extending short cut-off releases infinitely (`releaseExtendSec`).
//   4. Detuned Oscillator / PWM / LFO Modulation Preservation:
//      Extracts beating rate, unison detune depth, and odd/even PWM modulation
//      so interpolating between keys/velocities preserves synth movement without phase cancellation.
// ─────────────────────────────────────────────────────────

import type {
  AxionikHybridTransient,
  AxionikRegion,
  AxionikResolutionTier,
  AxionikSpectralFrame,
  AxionikSpectralModel,
  AxionikSpectralSurfaceNode,
  AxionikSurfaceModulationProfile,
  AxionikSurfaceTempoSync,
  AxionikSurfaceTopology,
  AxionikUnifiedSpectralSurface,
} from '@abdsynths/shared/contracts/axionikExpandedModel.ts';
import { clamp } from './DspMath.ts';
import { midiNoteToHz } from './WavDecoder.ts';

export interface BuildUnifiedSurfaceInput {
  regions: AxionikRegion[];
  primarySpectral: AxionikSpectralModel;
  spectralBySample?: Record<string, AxionikSpectralModel>;
  detectedCategory?: string;
  /** 'auto' (default) adapts K and T to harmonic/temporal content; 'manual' uses `complexity` (1..10). */
  resolutionStrategy?: 'auto' | 'manual';
  /** Complexity 1..10 when `resolutionStrategy === 'manual'`. */
  complexity?: number;
  /** Optional explicit topology override ('auto' by default). */
  topologyOverride?: 'auto' | AxionikSurfaceTopology;
  /** Optional Tempo-Sync & REX/Groove metadata persisted for the ABDAxionikVS Resynator v2. */
  tempoSync?: AxionikSurfaceTempoSync;
}

export interface EvaluateSurfaceQuery {
  /** Target MIDI note (0..127, supports fractional microtonal values like 60.5). */
  midiNote: number;
  /** Target MIDI velocity (1..127). */
  velocity: number;
  /**
   * Attack shortening factor (0..1):
   * 0 = original attack trajectory, 1 = jump directly to `canonicalAttackPeakFrame` (instant attack).
   */
  attackShorten01?: number;
  /**
   * Extra release extension in seconds (>= 0):
   * Synthesizes natural decaying tail frames beyond the original sample using `hfDampingDbPerSec`.
   */
  releaseExtendSec?: number;
  /**
   * Formant preservation factor (0..1, default 1.0):
   * 1.0 locks the 24-Bark body resonance to prevent "chipmunk" formant shifting on transposition.
   */
  formantLock01?: number;
  /**
   * Optional round-robin / hit variation seed (0..1) for `drum_kit_surface` anti-machine-gun variation.
   */
  roundRobinSeed?: number;
  /**
   * When false (default), nodes flagged as `isTimbralOutlier` (intruder samples from another instrument)
   * are bypassed during melodic surface interpolation so they do not create a foreign timbral island.
   * Set to true to intentionally morph through outlier samples.
   */
  includeOutliers?: boolean;
  /**
   * Optional DAW Host BPM (e.g. 128). When `surface.tempoSync?.enabled` is true, frame timestamps
   * scale by `sourceBpm / hostBpm` so rhythmic/melodic loops lock to DAW tempo without pitch shift.
   */
  hostBpm?: number;
}

export interface EvaluatedSurfaceVoice {
  topology: AxionikSurfaceTopology;
  midiNote: number;
  targetF0Hz: number;
  velocity: number;
  partialCount: number;
  frameCount: number;
  startFrameIndex: number;
  sustainStartFrame: number;
  sustainEndFrame: number;
  sustainBehavior: 'looping_orbit' | 'decaying_oneshot';
  modulation: AxionikSurfaceModulationProfile;
  hybridTransient?: AxionikHybridTransient;
  /** Playback rate multiplier applied when `surface.tempoSync?.enabled` and `query.hostBpm` are active (1.0 = unscaled). */
  tempoScaleFactor?: number;
  frames: AxionikSpectralFrame[];
}

const DRUM_NAME_TOKENS =
  /\b(kick|bd|bassdrum|snare|sd|rim|clap|hat|hh|hihat|chh|ohh|tom|cymbal|crash|ride|cowbell|clave|conga|bongo|shaker|tamb|perc|808|909)\b/i;

function roundTo(v: number, decimals: number): number {
  if (!Number.isFinite(v)) return 0;
  const m = 10 ** decimals;
  return Math.round(v * m) / m;
}

function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 1;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < n; i++) {
    // Convert dB (-96..0) to positive weight (0..96) so silence is 0 and strong formants are positive
    const va = Math.max(0, (a[i] ?? -96) + 96);
    const vb = Math.max(0, (b[i] ?? -96) + 96);
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 1e-9 ? clamp(dot / denom, 0, 1) : 1;
}

/**
 * Estimates median fundamental frequency (Hz) and harmonicity confidence (0..1)
 * from a spectral model's frames.
 */
function measureModelPitchAndHarmonicity(
  model: AxionikSpectralModel,
  nominalRootKey: number
): { measuredF0Hz: number; harmonicity: number; meanBarkFormantDb: number[] } {
  const f0Candidates: number[] = [];
  let harmonicEnergySum = 0;
  let noiseBandwidthSum = 0;
  const barkAccum = new Float64Array(24);
  let barkCount = 0;

  for (const frame of model.frames) {
    if (typeof frame.f0Hz === 'number' && frame.f0Hz > 15 && frame.f0Hz < 12000) {
      f0Candidates.push(frame.f0Hz);
    }
    let frameAmpSum = 0;
    let frameBwWeighted = 0;
    for (let i = 0; i < frame.amps.length; i++) {
      const a = Math.max(0, frame.amps[i] ?? 0);
      const bw = clamp(frame.bandwidths?.[i] ?? 0.05, 0, 1);
      frameAmpSum += a;
      frameBwWeighted += a * bw;
    }
    harmonicEnergySum += frameAmpSum;
    noiseBandwidthSum += frameBwWeighted;

    if (frame.formantEnvelopeDb && frame.formantEnvelopeDb.length > 0) {
      for (let b = 0; b < 24; b++) {
        barkAccum[b] += frame.formantEnvelopeDb[b] ?? -72;
      }
      barkCount++;
    }
  }

  let measuredF0Hz = midiNoteToHz(nominalRootKey);
  if (f0Candidates.length > 0) {
    f0Candidates.sort((a, b) => a - b);
    measuredF0Hz = f0Candidates[Math.floor(f0Candidates.length / 2)];
  }

  const avgNoisiness =
    harmonicEnergySum > 1e-6 ? clamp(noiseBandwidthSum / harmonicEnergySum, 0, 1) : 0.2;
  const harmonicity = roundTo(clamp(1 - avgNoisiness * 0.85, 0.05, 1), 4);

  const meanBarkFormantDb = new Array<number>(24);
  for (let b = 0; b < 24; b++) {
    meanBarkFormantDb[b] = roundTo(barkCount > 0 ? barkAccum[b] / barkCount : -48, 2);
  }

  return {
    measuredF0Hz: roundTo(measuredF0Hz, 3),
    harmonicity,
    meanBarkFormantDb,
  };
}

/**
 * Automatically detects whether the input regions represent a continuous melodic/tuned instrument
 * (`melodic_surface`: piano, synth, strings, marimba, tuned bottles) or a discrete per-key kit
 * (`drum_kit_surface`: drum map, unpitched percussion, disparate sound effects).
 */
export function detectSurfaceTopology(
  regions: readonly AxionikRegion[],
  primarySpectral: AxionikSpectralModel,
  spectralBySample?: Record<string, AxionikSpectralModel>,
  detectedCategory?: string,
  override?: 'auto' | AxionikSurfaceTopology
): {
  topology: AxionikSurfaceTopology;
  reason: string;
  pitchMonotonicityScore: number;
  adjacentFormantSimilarity: number;
} {
  if (override && override !== 'auto') {
    return {
      topology: override,
      reason: `Manual topology override (${override})`,
      pitchMonotonicityScore: override === 'melodic_surface' ? 1 : 0,
      adjacentFormantSimilarity: override === 'melodic_surface' ? 1 : 0.4,
    };
  }

  const catLower = (detectedCategory ?? '').toLowerCase();
  if (catLower.includes('drum') || catLower.includes('percussion kit')) {
    return {
      topology: 'drum_kit_surface',
      reason: `Category "${detectedCategory}" identified as Drum/Percussion Kit`,
      pitchMonotonicityScore: 0.15,
      adjacentFormantSimilarity: 0.35,
    };
  }

  // Group regions by distinct rootKey
  const byKey = new Map<number, { region: AxionikRegion; model: AxionikSpectralModel }>();
  let drumNameHits = 0;
  let singleKeyRegions = 0;

  for (const r of regions) {
    if (DRUM_NAME_TOKENS.test(r.sampleRef) || DRUM_NAME_TOKENS.test(r.id)) {
      drumNameHits++;
    }
    if (r.lowKey === r.highKey) {
      singleKeyRegions++;
    }
    if (!byKey.has(r.rootKey)) {
      const model = spectralBySample?.[r.sampleRef] ?? primarySpectral;
      byKey.set(r.rootKey, { region: r, model });
    }
  }

  if (regions.length >= 3 && drumNameHits >= Math.ceil(regions.length * 0.4)) {
    return {
      topology: 'drum_kit_surface',
      reason: `Detected drum piece naming across ${drumNameHits}/${regions.length} regions`,
      pitchMonotonicityScore: 0.2,
      adjacentFormantSimilarity: 0.4,
    };
  }

  const sortedKeys = Array.from(byKey.keys()).sort((a, b) => a - b);
  if (sortedKeys.length <= 1) {
    return {
      topology: 'melodic_surface',
      reason: 'Single-pitch or velocity-layered instrument mapped to continuous melodic surface',
      pitchMonotonicityScore: 1,
      adjacentFormantSimilarity: 1,
    };
  }

  const keyStats = sortedKeys.map((k) => {
    const entry = byKey.get(k)!;
    const hasDedicatedSampleModel = Boolean(spectralBySample?.[entry.region.sampleRef]);
    const stats = measureModelPitchAndHarmonicity(entry.model, k);
    if (!hasDedicatedSampleModel && (entry.region.pitchKeytrack ?? 100) > 0) {
      stats.measuredF0Hz = roundTo(midiNoteToHz(k), 3);
    }
    return {
      key: k,
      ...stats,
    };
  });

  let monotonicPairs = 0;
  let formantSimSum = 0;
  const pairCount = keyStats.length - 1;

  for (let i = 0; i < pairCount; i++) {
    const curr = keyStats[i];
    const next = keyStats[i + 1];
    const expectedRatio = Math.pow(2, (next.key - curr.key) / 12);
    const actualRatio = next.measuredF0Hz / Math.max(1, curr.measuredF0Hz);
    // Allow generous musical tolerance (e.g. tuned bottles or stretched tuning within +-35% of semitone step)
    if (actualRatio > 1.01 && actualRatio >= expectedRatio * 0.65 && actualRatio <= expectedRatio * 1.55) {
      monotonicPairs++;
    }
    formantSimSum += cosineSimilarity(curr.meanBarkFormantDb, next.meanBarkFormantDb);
  }

  const pitchMonotonicityScore = roundTo(monotonicPairs / Math.max(1, pairCount), 3);
  const adjacentFormantSimilarity = roundTo(formantSimSum / Math.max(1, pairCount), 3);
  const meanHarmonicity =
    keyStats.reduce((acc, s) => acc + s.harmonicity, 0) / Math.max(1, keyStats.length);

  // If pitches do not ascend with MIDI note number (e.g. random unpitched bottles or drum kit hits)
  if (pitchMonotonicityScore < 0.6 || (singleKeyRegions === regions.length && meanHarmonicity < 0.45)) {
    return {
      topology: 'drum_kit_surface',
      reason: `Non-monotonic pitch progression across keys (monotonicity=${pitchMonotonicityScore}, harmonicity=${roundTo(meanHarmonicity, 2)}) -> isolated per-key velocity surfaces`,
      pitchMonotonicityScore,
      adjacentFormantSimilarity,
    };
  }

  return {
    topology: 'melodic_surface',
    reason: `Monotonic tuned progression across ${sortedKeys.length} pitch anchors (monotonicity=${pitchMonotonicityScore}, formantSimilarity=${adjacentFormantSimilarity})`,
    pitchMonotonicityScore,
    adjacentFormantSimilarity,
  };
}

/**
 * Resolves the unified `(partialCount, frameCount)` resolution tier either automatically
 * from the spectral richness & temporal evolution of the input models, or from manual complexity (1..10).
 */
export function resolveAdaptiveSurfaceResolution(
  models: readonly AxionikSpectralModel[],
  options?: { strategy?: 'auto' | 'manual'; complexity?: number }
): {
  tier: AxionikResolutionTier;
  partialCount: number;
  frameCount: number;
} {
  if (options?.strategy === 'manual' && typeof options.complexity === 'number') {
    const c = clamp(Math.round(options.complexity), 1, 10);
    if (c <= 3) return { tier: 'compact', partialCount: 32, frameCount: 32 };
    if (c <= 6) return { tier: 'standard', partialCount: 64, frameCount: 48 };
    if (c <= 8) return { tier: 'hd', partialCount: 128, frameCount: 64 };
    return { tier: 'ultra-hd', partialCount: 256, frameCount: 96 };
  }

  // Automatic content-driven resolution sizing
  let maxActivePartialIndex = 16;
  let minF0Hz = 440;
  let maxSourceFrames = 16;

  for (const m of models) {
    maxSourceFrames = Math.max(maxSourceFrames, m.frames.length);
    for (const f of m.frames) {
      if (typeof f.f0Hz === 'number' && f.f0Hz > 20) {
        minF0Hz = Math.min(minF0Hz, f.f0Hz);
      }
      // Find highest partial with energy above -78 dBFS (~0.000126 linear)
      for (let k = f.amps.length - 1; k >= 0; k--) {
        if ((f.amps[k] ?? 0) > 0.000126) {
          if (k + 1 > maxActivePartialIndex) {
            maxActivePartialIndex = k + 1;
          }
          break;
        }
      }
    }
  }

  // Low notes (e.g. C1..C2 < 100 Hz) with rich upper harmonics benefit from 128..256 partials
  if (maxActivePartialIndex > 128 || (minF0Hz < 75 && maxActivePartialIndex > 60)) {
    return { tier: 'ultra-hd', partialCount: 256, frameCount: maxSourceFrames >= 48 ? 96 : 64 };
  }
  if (maxActivePartialIndex > 56 || minF0Hz < 135 || models.length >= 16) {
    return { tier: 'hd', partialCount: 128, frameCount: 64 };
  }
  if (maxActivePartialIndex > 28 || maxSourceFrames > 24) {
    return { tier: 'standard', partialCount: 64, frameCount: 48 };
  }
  return { tier: 'compact', partialCount: 32, frameCount: 32 };
}

/**
 * Extracts detuned-oscillator beating (Unison / Chorus), PWM (odd-vs-even harmonic counter-oscillation),
 * and LFO filter sweep parameters from a sequence of spectral frames.
 */
export function extractModulationProfile(
  frames: readonly AxionikSpectralFrame[]
): AxionikSurfaceModulationProfile {
  if (frames.length < 4) {
    return {
      modulationRateHz: 0,
      modulationDepth: 0,
      oddEvenModDepth: 0,
      estimatedDetuneCents: 0,
    };
  }

  // Analyze the sustain portion (last 70% of frames)
  const startIdx = Math.floor(frames.length * 0.25);
  const sustainFrames = frames.slice(startIdx);
  const n = sustainFrames.length;

  const totalEnv: number[] = [];
  const oddEvenRatio: number[] = [];
  let meanF0 = 220;

  for (const f of sustainFrames) {
    if (f.f0Hz && f.f0Hz > 20) meanF0 = f.f0Hz;
    let oddSum = 0;
    let evenSum = 0;
    for (let k = 0; k < f.amps.length; k++) {
      const a = Math.max(0, f.amps[k] ?? 0);
      if (k % 2 === 0) oddSum += a;
      else evenSum += a;
    }
    const tot = oddSum + evenSum;
    totalEnv.push(tot);
    oddEvenRatio.push(tot > 1e-6 ? (oddSum - evenSum) / tot : 0);
  }

  const meanAmp = totalEnv.reduce((a, b) => a + b, 0) / Math.max(1, n);
  let ampVarSum = 0;
  let zeroCrossings = 0;
  for (let i = 0; i < n; i++) {
    const diff = totalEnv[i] - meanAmp;
    ampVarSum += diff * diff;
    if (i > 0) {
      const prevDiff = totalEnv[i - 1] - meanAmp;
      if ((diff >= 0 && prevDiff < 0) || (diff < 0 && prevDiff >= 0)) {
        zeroCrossings++;
      }
    }
  }

  const stdAmp = Math.sqrt(ampVarSum / Math.max(1, n));
  const modulationDepth = roundTo(
    meanAmp > 1e-5 ? clamp((stdAmp / meanAmp) * 1.4, 0, 1) : 0,
    4
  );

  // Estimate duration of sustain window in seconds
  const tStart = sustainFrames[0]?.timeSec ?? 0;
  const tEnd = sustainFrames[n - 1]?.timeSec ?? n * 0.04;
  const durationSec = Math.max(0.15, tEnd - tStart);
  const modulationRateHz =
    modulationDepth > 0.03 ? roundTo(clamp(zeroCrossings / (2 * durationSec), 0.1, 18), 2) : 0;

  // Odd/Even PWM modulation depth
  const meanOddEven = oddEvenRatio.reduce((a, b) => a + b, 0) / Math.max(1, n);
  let oeVar = 0;
  for (const r of oddEvenRatio) {
    oeVar += (r - meanOddEven) * (r - meanOddEven);
  }
  const oddEvenModDepth = roundTo(clamp(Math.sqrt(oeVar / Math.max(1, n)) * 2.0, 0, 1), 4);

  // Convert beating rate Δf at fundamental to unison detune spread in cents: cents ≈ 1200 * log2(1 + Δf / f0)
  const estimatedDetuneCents =
    modulationRateHz > 0 && meanF0 > 20
      ? roundTo(clamp(1200 * Math.log2(1 + modulationRateHz / meanF0), 0.5, 50), 2)
      : 0;

  return {
    modulationRateHz,
    modulationDepth,
    oddEvenModDepth,
    estimatedDetuneCents,
  };
}

/**
 * Resamples an arbitrary spectral frame sequence onto the canonical `(partialCount, frameCount)`
 * grid using 3-segment piecewise landmark alignment (`0 .. canonicalAttackPeak .. canonicalSustainStart .. frameCount-1`).
 */
function warpFramesToCanonicalGrid(
  sourceFrames: readonly AxionikSpectralFrame[],
  targetPartialCount: number,
  targetFrameCount: number,
  srcAttackPeakIdx: number,
  srcSustainStartIdx: number,
  canonicalAttackPeak: number,
  canonicalSustainStart: number
): AxionikSpectralFrame[] {
  const srcLen = Math.max(1, sourceFrames.length);
  const safeSrcPeak = clamp(srcAttackPeakIdx, 0, Math.max(0, srcLen - 1));
  const safeSrcSust = clamp(srcSustainStartIdx, safeSrcPeak, Math.max(0, srcLen - 1));

  const out: AxionikSpectralFrame[] = new Array<AxionikSpectralFrame>(targetFrameCount);

  for (let t = 0; t < targetFrameCount; t++) {
    let srcPos: number;
    if (t <= canonicalAttackPeak) {
      const alpha = canonicalAttackPeak > 0 ? t / canonicalAttackPeak : 0;
      srcPos = alpha * safeSrcPeak;
    } else if (t <= canonicalSustainStart) {
      const span = Math.max(1, canonicalSustainStart - canonicalAttackPeak);
      const alpha = (t - canonicalAttackPeak) / span;
      srcPos = safeSrcPeak + alpha * (safeSrcSust - safeSrcPeak);
    } else {
      const span = Math.max(1, targetFrameCount - 1 - canonicalSustainStart);
      const alpha = (t - canonicalSustainStart) / span;
      srcPos = safeSrcSust + alpha * (srcLen - 1 - safeSrcSust);
    }

    const idx0 = clamp(Math.floor(srcPos), 0, srcLen - 1);
    const idx1 = clamp(idx0 + 1, 0, srcLen - 1);
    const frac = clamp(srcPos - idx0, 0, 1);

    const f0 = sourceFrames[idx0];
    const f1 = sourceFrames[idx1];

    const amps = new Array<number>(targetPartialCount);
    const offsets = new Array<number>(targetPartialCount);
    const bandwidths = new Array<number>(targetPartialCount);

    for (let k = 0; k < targetPartialCount; k++) {
      const a0 = f0?.amps[k] ?? 0;
      const a1 = f1?.amps[k] ?? 0;
      amps[k] = roundTo(a0 + (a1 - a0) * frac, 6);

      const o0 = f0?.offsets[k] ?? 0;
      const o1 = f1?.offsets[k] ?? 0;
      offsets[k] = roundTo(o0 + (o1 - o0) * frac, 4);

      const lastBw0 = f0?.bandwidths?.[f0.bandwidths.length - 1] ?? 0.05;
      const lastBw1 = f1?.bandwidths?.[f1.bandwidths.length - 1] ?? 0.05;
      const bw0 = f0?.bandwidths?.[k] ?? lastBw0;
      const bw1 = f1?.bandwidths?.[k] ?? lastBw1;
      bandwidths[k] = roundTo(bw0 + (bw1 - bw0) * frac, 4);
    }

    const formanDb = new Array<number>(24);
    const residDb = new Array<number>(24);
    for (let b = 0; b < 24; b++) {
      const fm0 = f0?.formantEnvelopeDb?.[b] ?? -60;
      const fm1 = f1?.formantEnvelopeDb?.[b] ?? -60;
      formanDb[b] = roundTo(fm0 + (fm1 - fm0) * frac, 2);

      const rs0 = f0?.residualBandsDb?.[b] ?? -78;
      const rs1 = f1?.residualBandsDb?.[b] ?? -78;
      residDb[b] = roundTo(rs0 + (rs1 - rs0) * frac, 2);
    }

    const hz0 = f0?.f0Hz ?? 0;
    const hz1 = f1?.f0Hz ?? hz0;
    const time0 = f0?.timeSec ?? idx0 * 0.03;
    const time1 = f1?.timeSec ?? idx1 * 0.03;

    const frame: AxionikSpectralFrame = {
      amps,
      offsets,
      f0Hz: roundTo(hz0 + (hz1 - hz0) * frac, 3),
      timeSec: roundTo(time0 + (time1 - time0) * frac, 4),
      bandwidths,
      formantEnvelopeDb: formanDb,
      residualBandsDb: residDb,
    };

    if (t === 0 && f0?.phases && f0.phases.length > 0) {
      frame.phases = Array.from({ length: targetPartialCount }, (_, k) =>
        roundTo(f0.phases?.[k] ?? 0, 4)
      );
    }
    if (f0?.spatialQuad) {
      const q1 = f1?.spatialQuad ?? f0.spatialQuad;
      frame.spatialQuad = [
        roundTo(f0.spatialQuad[0] + (q1[0] - f0.spatialQuad[0]) * frac, 3),
        roundTo(f0.spatialQuad[1] + (q1[1] - f0.spatialQuad[1]) * frac, 3),
        roundTo(f0.spatialQuad[2] + (q1[2] - f0.spatialQuad[2]) * frac, 3),
        roundTo(f0.spatialQuad[3] + (q1[3] - f0.spatialQuad[3]) * frac, 3),
      ];
    }

    out[t] = frame;
  }

  return out;
}

/**
 * Finds the attack peak frame index, sustain start frame index, and high-frequency damping rate
 * from a spectral model and its region loop metadata.
 */
function analyzeNodeLandmarks(
  model: AxionikSpectralModel,
  region: AxionikRegion
): {
  srcAttackPeakIdx: number;
  srcSustainStartIdx: number;
  sustainBehavior: 'looping_orbit' | 'decaying_oneshot';
  hfDampingDbPerSec: number;
} {
  const n = Math.max(1, model.frames.length);
  const frameEnergies = model.frames.map((f) =>
    f.amps.reduce((acc, a) => acc + Math.max(0, a), 0)
  );

  let peakIdx = 0;
  let peakVal = -1;
  // Search first 60% of frames for initial attack bloom peak
  const searchLimit = Math.max(1, Math.ceil(n * 0.6));
  for (let i = 0; i < searchLimit; i++) {
    if (frameEnergies[i] > peakVal) {
      peakVal = frameEnergies[i];
      peakIdx = i;
    }
  }

  const hasActiveLoop =
    Boolean(region.loop) &&
    region.loop?.mode !== 'no_loop' &&
    region.loop?.mode !== 'one_shot' &&
    (region.loop?.endFrame ?? 0) > (region.loop?.startFrame ?? 0);

  const tailEnergy = frameEnergies[n - 1] ?? 0;
  const sustainRatio = peakVal > 1e-6 ? tailEnergy / peakVal : 0;
  const sustainBehavior: 'looping_orbit' | 'decaying_oneshot' =
    hasActiveLoop || sustainRatio > 0.35 ? 'looping_orbit' : 'decaying_oneshot';

  const srcSustainStartIdx = Math.min(
    n - 1,
    Math.max(peakIdx + 1, Math.floor(peakIdx + (n - peakIdx) * 0.25))
  );

  // Estimate natural high-frequency damping rate (dB/sec) for realistic infinite release synthesis
  const hfDampingDbPerSec =
    sustainBehavior === 'decaying_oneshot' ? 14.0 : 6.5;

  return {
    srcAttackPeakIdx: peakIdx,
    srcSustainStartIdx,
    sustainBehavior,
    hfDampingDbPerSec,
  };
}

/**
 * Builds the Unified Continuous Spectral Surface (`AxionikUnifiedSpectralSurface`)
 * from an instrument's regions and spectral models.
 */
export function buildUnifiedSpectralSurface(
  input: BuildUnifiedSurfaceInput
): AxionikUnifiedSpectralSurface {
  const allModels: AxionikSpectralModel[] = [input.primarySpectral];
  if (input.spectralBySample) {
    for (const m of Object.values(input.spectralBySample)) {
      allModels.push(m);
    }
  }

  const topoInfo = detectSurfaceTopology(
    input.regions,
    input.primarySpectral,
    input.spectralBySample,
    input.detectedCategory,
    input.topologyOverride
  );

  const resInfo = resolveAdaptiveSurfaceResolution(allModels, {
    strategy: input.resolutionStrategy ?? 'auto',
    complexity: input.complexity,
  });

  const canonicalAttackPeakFrame = Math.max(2, Math.round(resInfo.frameCount * 0.125));
  const canonicalSustainStartFrame = Math.max(
    canonicalAttackPeakFrame + 2,
    Math.round(resInfo.frameCount * 0.28)
  );

  const sourceRegions: AxionikRegion[] =
    input.regions.length > 0
      ? [...input.regions]
      : [
          {
            id: 'zone-1',
            sampleRef: 'root',
            lowKey: 0,
            highKey: 127,
            rootKey: 60,
            lowVel: 1,
            highVel: 127,
          },
        ];

  const nodes: AxionikSpectralSurfaceNode[] = [];
  const nodeBarkFormants: number[][] = [];

  for (const r of sourceRegions) {
    const model = input.spectralBySample?.[r.sampleRef] ?? input.primarySpectral;
    const pitchStats = measureModelPitchAndHarmonicity(model, r.rootKey);
    const landmarks = analyzeNodeLandmarks(model, r);
    const modulation = extractModulationProfile(model.frames);

    nodeBarkFormants.push(pitchStats.meanBarkFormantDb);

    const warpedFrames = warpFramesToCanonicalGrid(
      model.frames,
      resInfo.partialCount,
      resInfo.frameCount,
      landmarks.srcAttackPeakIdx,
      landmarks.srcSustainStartIdx,
      canonicalAttackPeakFrame,
      canonicalSustainStartFrame
    );

    const velocityCenter = Math.round((clamp(r.lowVel, 1, 127) + clamp(r.highVel, 1, 127)) * 0.5);

    nodes.push({
      id: r.id,
      sampleRef: r.sampleRef,
      rootKey: clamp(r.rootKey, 0, 127),
      lowKey: clamp(r.lowKey, 0, 127),
      highKey: clamp(r.highKey, 0, 127),
      velocityCenter: clamp(velocityCenter, 1, 127),
      lowVel: clamp(r.lowVel, 1, 127),
      highVel: clamp(r.highVel, 1, 127),
      measuredF0Hz: pitchStats.measuredF0Hz,
      harmonicity: pitchStats.harmonicity,
      timbreCoherenceScore: 1,
      isTimbralOutlier: false,
      attackPeakFrame: canonicalAttackPeakFrame,
      sustainStartFrame: canonicalSustainStartFrame,
      sustainEndFrame: resInfo.frameCount - 1,
      sustainBehavior: landmarks.sustainBehavior,
      hfDampingDbPerSec: landmarks.hfDampingDbPerSec,
      modulation,
      hybridTransient: r.hybridTransient,
      frames: warpedFrames,
    });
  }

  // Detect timbral outliers / intruder samples using the robust median 24-Bark formant centroid + harmonicity
  const medianFormantDb = new Array<number>(24);
  for (let b = 0; b < 24; b++) {
    const col = nodeBarkFormants.map((arr) => arr[b] ?? -48).sort((x, y) => x - y);
    medianFormantDb[b] = col[Math.floor(col.length / 2)] ?? -48;
  }
  const sortedHarm = nodes.map((n) => n.harmonicity).sort((x, y) => x - y);
  const medianHarmonicity = sortedHarm[Math.floor(sortedHarm.length / 2)] ?? 0.85;

  const outlierNodeIds: string[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const barkSim = cosineSimilarity(nodeBarkFormants[i], medianFormantDb);
    // Also measure L1 distance in dB across the 24 Bark bands (a different instrument shifts formant peaks by >12 dB)
    let meanBarkDiffDb = 0;
    for (let b = 0; b < 24; b++) {
      meanBarkDiffDb += Math.abs((nodeBarkFormants[i][b] ?? -48) - medianFormantDb[b]);
    }
    meanBarkDiffDb /= 24;
    const barkDistPenalty = clamp(meanBarkDiffDb / 22, 0, 0.55);
    const harmDiff = Math.abs(nodes[i].harmonicity - medianHarmonicity);
    const coherence = roundTo(clamp(barkSim - barkDistPenalty - harmDiff * 0.35, 0, 1), 3);
    nodes[i].timbreCoherenceScore = coherence;

    if (
      topoInfo.topology === 'melodic_surface' &&
      nodes.length >= 3 &&
      coherence < 0.72
    ) {
      nodes[i].isTimbralOutlier = true;
      outlierNodeIds.push(nodes[i].sampleRef || nodes[i].id);
    }
  }

  // Compute globalBodyFormantDb from coherent (non-outlier) nodes so an intruder sample never corrupts the body resonance
  const globalBodyFormantDb = new Array<number>(24);
  const inlierFormants = nodeBarkFormants.filter((_, idx) => !nodes[idx].isTimbralOutlier);
  const effectiveFormants = inlierFormants.length > 0 ? inlierFormants : nodeBarkFormants;
  for (let b = 0; b < 24; b++) {
    const sum = effectiveFormants.reduce((acc, arr) => acc + (arr[b] ?? -48), 0);
    globalBodyFormantDb[b] = roundTo(sum / Math.max(1, effectiveFormants.length), 2);
  }

  nodes.sort((a, b) =>
    a.rootKey !== b.rootKey ? a.rootKey - b.rootKey : a.velocityCenter - b.velocityCenter
  );

  return {
    topology: topoInfo.topology,
    topologyDetectionReason: topoInfo.reason,
    pitchMonotonicityScore: topoInfo.pitchMonotonicityScore,
    adjacentFormantSimilarity: topoInfo.adjacentFormantSimilarity,
    resolutionTier: resInfo.tier,
    partialCount: resInfo.partialCount,
    frameCount: resInfo.frameCount,
    canonicalAttackPeakFrame,
    canonicalSustainStartFrame,
    globalBodyFormantDb,
    ...(outlierNodeIds.length > 0 ? { outlierNodeIds } : {}),
    ...(input.tempoSync
      ? {
          tempoSync: {
            enabled: Boolean(input.tempoSync.enabled),
            sourceBpm: clamp(input.tempoSync.sourceBpm || 120, 20, 300),
            ...(typeof input.tempoSync.targetBpm === 'number'
              ? { targetBpm: clamp(input.tempoSync.targetBpm, 20, 300) }
              : {}),
            barCount: Math.max(1, Math.round(input.tempoSync.barCount || 2)),
            timeSignature: input.tempoSync.timeSignature ?? [4, 4],
            ...(input.tempoSync.grooveMode ? { grooveMode: input.tempoSync.grooveMode } : {}),
            ...(typeof input.tempoSync.sliceCount === 'number'
              ? { sliceCount: input.tempoSync.sliceCount }
              : {}),
          },
        }
      : {}),
    nodes,
  };
}

/**
 * Linearly blends two time-aligned `AxionikSpectralSurfaceNode`s with weight `alpha` (0..1),
 * preserving modulation rate/depth and hybrid transient parameters.
 */
function blendSurfaceNodes(
  nodeA: AxionikSpectralSurfaceNode,
  nodeB: AxionikSpectralSurfaceNode,
  alpha: number,
  partialCount: number,
  frameCount: number
): {
  frames: AxionikSpectralFrame[];
  modulation: AxionikSurfaceModulationProfile;
  sustainBehavior: 'looping_orbit' | 'decaying_oneshot';
  hfDampingDbPerSec: number;
  hybridTransient?: AxionikHybridTransient;
} {
  const w = clamp(alpha, 0, 1);
  if (w <= 1e-4 || nodeA === nodeB) {
    return {
      frames: nodeA.frames.map((f) => ({
        ...f,
        amps: [...f.amps],
        offsets: [...f.offsets],
        bandwidths: f.bandwidths ? [...f.bandwidths] : undefined,
        formantEnvelopeDb: f.formantEnvelopeDb ? [...f.formantEnvelopeDb] : undefined,
        residualBandsDb: f.residualBandsDb ? [...f.residualBandsDb] : undefined,
      })),
      modulation: { ...nodeA.modulation },
      sustainBehavior: nodeA.sustainBehavior,
      hfDampingDbPerSec: nodeA.hfDampingDbPerSec,
      hybridTransient: nodeA.hybridTransient ? { ...nodeA.hybridTransient } : undefined,
    };
  }
  if (w >= 1 - 1e-4) {
    return blendSurfaceNodes(nodeB, nodeB, 0, partialCount, frameCount);
  }

  const frames: AxionikSpectralFrame[] = new Array<AxionikSpectralFrame>(frameCount);
  for (let t = 0; t < frameCount; t++) {
    const fA = nodeA.frames[t] ?? nodeA.frames[nodeA.frames.length - 1];
    const fB = nodeB.frames[t] ?? nodeB.frames[nodeB.frames.length - 1];

    const amps = new Array<number>(partialCount);
    const offsets = new Array<number>(partialCount);
    const bandwidths = new Array<number>(partialCount);

    for (let k = 0; k < partialCount; k++) {
      const a0 = fA?.amps[k] ?? 0;
      const a1 = fB?.amps[k] ?? 0;
      amps[k] = roundTo(a0 + (a1 - a0) * w, 6);

      const o0 = fA?.offsets[k] ?? 0;
      const o1 = fB?.offsets[k] ?? 0;
      offsets[k] = roundTo(o0 + (o1 - o0) * w, 4);

      const bw0 = fA?.bandwidths?.[k] ?? 0.05;
      const bw1 = fB?.bandwidths?.[k] ?? 0.05;
      bandwidths[k] = roundTo(bw0 + (bw1 - bw0) * w, 4);
    }

    const formantEnvelopeDb = new Array<number>(24);
    const residualBandsDb = new Array<number>(24);
    for (let b = 0; b < 24; b++) {
      const fm0 = fA?.formantEnvelopeDb?.[b] ?? -60;
      const fm1 = fB?.formantEnvelopeDb?.[b] ?? -60;
      formantEnvelopeDb[b] = roundTo(fm0 + (fm1 - fm0) * w, 2);

      const rs0 = fA?.residualBandsDb?.[b] ?? -78;
      const rs1 = fB?.residualBandsDb?.[b] ?? -78;
      residualBandsDb[b] = roundTo(rs0 + (rs1 - rs0) * w, 2);
    }

    frames[t] = {
      amps,
      offsets,
      f0Hz: roundTo((fA?.f0Hz ?? 220) + ((fB?.f0Hz ?? 220) - (fA?.f0Hz ?? 220)) * w, 3),
      timeSec: roundTo((fA?.timeSec ?? t * 0.03) + ((fB?.timeSec ?? t * 0.03) - (fA?.timeSec ?? t * 0.03)) * w, 4),
      bandwidths,
      formantEnvelopeDb,
      residualBandsDb,
    };
  }

  const modulation: AxionikSurfaceModulationProfile = {
    modulationRateHz: roundTo(
      nodeA.modulation.modulationRateHz +
        (nodeB.modulation.modulationRateHz - nodeA.modulation.modulationRateHz) * w,
      2
    ),
    modulationDepth: roundTo(
      nodeA.modulation.modulationDepth +
        (nodeB.modulation.modulationDepth - nodeA.modulation.modulationDepth) * w,
      4
    ),
    oddEvenModDepth: roundTo(
      nodeA.modulation.oddEvenModDepth +
        (nodeB.modulation.oddEvenModDepth - nodeA.modulation.oddEvenModDepth) * w,
      4
    ),
    estimatedDetuneCents: roundTo(
      nodeA.modulation.estimatedDetuneCents +
        (nodeB.modulation.estimatedDetuneCents - nodeA.modulation.estimatedDetuneCents) * w,
      2
    ),
  };

  return {
    frames,
    modulation,
    sustainBehavior: w < 0.5 ? nodeA.sustainBehavior : nodeB.sustainBehavior,
    hfDampingDbPerSec: roundTo(
      nodeA.hfDampingDbPerSec + (nodeB.hfDampingDbPerSec - nodeA.hfDampingDbPerSec) * w,
      2
    ),
    hybridTransient: (w < 0.5 ? nodeA.hybridTransient : nodeB.hybridTransient) ?? nodeA.hybridTransient,
  };
}

/**
 * Evaluates a velocity-interpolated node for a single key group (`nodesForKey` sorted by `velocityCenter`).
 */
function interpolateVelocityAtKey(
  nodesForKey: readonly AxionikSpectralSurfaceNode[],
  velocity: number,
  partialCount: number,
  frameCount: number
) {
  const vel = clamp(velocity, 1, 127);
  let lower = nodesForKey[0];
  let upper = nodesForKey[nodesForKey.length - 1];

  for (const n of nodesForKey) {
    if (n.velocityCenter <= vel) lower = n;
    if (n.velocityCenter >= vel) {
      upper = n;
      break;
    }
  }

  const span = upper.velocityCenter - lower.velocityCenter;
  const alpha = span > 0 ? clamp((vel - lower.velocityCenter) / span, 0, 1) : 0;
  return blendSurfaceNodes(lower, upper, alpha, partialCount, frameCount);
}

/**
 * Evaluates the Unified Continuous Spectral Surface at any `(midiNote, velocity)` coordinate,
 * applying optional real-time attack shortening (`attackShorten01`), infinite release extension
 * (`releaseExtendSec`), formant locking (`formantLock01`), and drum anti-machine-gun variation.
 */
export function evaluateUnifiedSpectralSurface(
  surface: AxionikUnifiedSpectralSurface,
  query: EvaluateSurfaceQuery
): EvaluatedSurfaceVoice {
  const midiNote = clamp(query.midiNote, 0, 127);
  const velocity = clamp(query.velocity, 1, 127);
  const targetF0Hz = roundTo(midiNoteToHz(midiNote), 3);
  const { partialCount, frameCount } = surface;

  let blended: ReturnType<typeof blendSurfaceNodes>;

  if (surface.topology === 'drum_kit_surface') {
    const roundedKey = Math.round(midiNote);
    // Find nodes matching this drum key (exact rootKey match first, then lowKey..highKey range, then nearest key)
    let keyNodes = surface.nodes.filter((n) => n.rootKey === roundedKey);
    if (keyNodes.length === 0) {
      keyNodes = surface.nodes.filter((n) => roundedKey >= n.lowKey && roundedKey <= n.highKey);
    }
    if (keyNodes.length === 0) {
      let bestKey = surface.nodes[0].rootKey;
      let bestDist = Math.abs(bestKey - roundedKey);
      for (const n of surface.nodes) {
        const d = Math.abs(n.rootKey - roundedKey);
        if (d < bestDist) {
          bestDist = d;
          bestKey = n.rootKey;
        }
      }
      keyNodes = surface.nodes.filter((n) => n.rootKey === bestKey);
    }
    keyNodes.sort((a, b) => a.velocityCenter - b.velocityCenter);
    blended = interpolateVelocityAtKey(keyNodes, velocity, partialCount, frameCount);

    // Apply subtle organic DDSP residual & micro-formant variation to prevent machine-gun effect on repeated hits
    if (typeof query.roundRobinSeed === 'number') {
      const seed = clamp(query.roundRobinSeed, 0, 1);
      for (let t = 0; t < blended.frames.length; t++) {
        const res = blended.frames[t].residualBandsDb;
        if (res) {
          for (let b = 0; b < res.length; b++) {
            const pseudoVar = Math.sin((seed * 37.3 + b * 1.7 + t * 0.5) * Math.PI * 2) * 1.25;
            res[b] = roundTo(res[b] + pseudoVar, 2);
          }
        }
      }
    }
  } else {
    // `melodic_surface`: Bilinear interpolation across (Pitch × Velocity)
    // Filter out timbral outliers by default so an accidental intruder sample doesn't create a foreign island
    const candidateNodes =
      query.includeOutliers === true
        ? surface.nodes
        : surface.nodes.filter((n) => !n.isTimbralOutlier);
    const activeNodes = candidateNodes.length > 0 ? candidateNodes : surface.nodes;

    const byPitch = new Map<number, AxionikSpectralSurfaceNode[]>();
    for (const n of activeNodes) {
      const list = byPitch.get(n.rootKey) ?? [];
      list.push(n);
      byPitch.set(n.rootKey, list);
    }
    const distinctKeys = Array.from(byPitch.keys()).sort((a, b) => a - b);

    let lowKeyAnchor = distinctKeys[0];
    let highKeyAnchor = distinctKeys[distinctKeys.length - 1];
    for (const k of distinctKeys) {
      if (k <= midiNote) lowKeyAnchor = k;
      if (k >= midiNote) {
        highKeyAnchor = k;
        break;
      }
    }

    const lowVelEval = interpolateVelocityAtKey(
      byPitch.get(lowKeyAnchor)!,
      velocity,
      partialCount,
      frameCount
    );
    const highVelEval =
      highKeyAnchor === lowKeyAnchor
        ? lowVelEval
        : interpolateVelocityAtKey(
            byPitch.get(highKeyAnchor)!,
            velocity,
            partialCount,
            frameCount
          );

    const keySpan = highKeyAnchor - lowKeyAnchor;
    const pitchAlpha = keySpan > 0 ? clamp((midiNote - lowKeyAnchor) / keySpan, 0, 1) : 0;

    // Synthesize temporary virtual nodes at lowKeyAnchor and highKeyAnchor to blend across pitch
    const virtualNodeA: AxionikSpectralSurfaceNode = {
      ...surface.nodes[0],
      frames: lowVelEval.frames,
      modulation: lowVelEval.modulation,
      sustainBehavior: lowVelEval.sustainBehavior,
      hfDampingDbPerSec: lowVelEval.hfDampingDbPerSec,
      hybridTransient: lowVelEval.hybridTransient,
    };
    const virtualNodeB: AxionikSpectralSurfaceNode = {
      ...surface.nodes[0],
      frames: highVelEval.frames,
      modulation: highVelEval.modulation,
      sustainBehavior: highVelEval.sustainBehavior,
      hfDampingDbPerSec: highVelEval.hfDampingDbPerSec,
      hybridTransient: highVelEval.hybridTransient,
    };

    blended = blendSurfaceNodes(virtualNodeA, virtualNodeB, pitchAlpha, partialCount, frameCount);

    // Pitch-Formant Decoupling: lock formant envelope toward global/interpolated body resonance
    const formantLock = clamp(query.formantLock01 ?? 1.0, 0, 1);
    for (const frame of blended.frames) {
      frame.f0Hz = targetF0Hz;
      if (frame.formantEnvelopeDb && formantLock > 0) {
        for (let b = 0; b < 24; b++) {
          const lockedDb =
            frame.formantEnvelopeDb[b] * (1 - formantLock * 0.25) +
            (surface.globalBodyFormantDb[b] ?? frame.formantEnvelopeDb[b]) * (formantLock * 0.25);
          frame.formantEnvelopeDb[b] = roundTo(lockedDb, 2);
        }
      }
    }
  }

  // Attack Shortening (`attackShorten01` 0..1):
  // When > 0, shifts startFrameIndex toward `canonicalAttackPeakFrame` so slow pads can trigger instantaneously!
  const shorten = clamp(query.attackShorten01 ?? 0, 0, 1);
  const startFrameIndex = Math.round(shorten * surface.canonicalAttackPeakFrame);

  // Release Extension (`releaseExtendSec` > 0):
  // Appends synthesized natural decay frames where upper partials damp faster than lower partials (`hfDampingDbPerSec`)
  const extraReleaseSec = Math.max(0, query.releaseExtendSec ?? 0);
  if (extraReleaseSec > 0 && blended.frames.length > 0) {
    const extraFramesCount = Math.min(64, Math.max(2, Math.round(extraReleaseSec * 12)));
    const lastFrame = blended.frames[blended.frames.length - 1];
    const baseTimeSec = lastFrame.timeSec ?? 1.0;
    const stepSec = extraReleaseSec / extraFramesCount;

    for (let i = 1; i <= extraFramesCount; i++) {
      const elapsedSec = i * stepSec;
      const envDecay = Math.exp(-elapsedSec * (blended.hfDampingDbPerSec * 0.18));
      const newAmps = lastFrame.amps.map((a, k) => {
        // Higher harmonics damp progressively faster than the fundamental (natural acoustic string/air damping)
        const harmonicDamp = Math.exp(-elapsedSec * 0.08 * Math.sqrt(k + 1));
        return roundTo(a * envDecay * harmonicDamp, 6);
      });
      const residDecayDb = elapsedSec * blended.hfDampingDbPerSec * 0.85;
      const newResid = lastFrame.residualBandsDb?.map((db) =>
        roundTo(Math.max(-96, db - residDecayDb), 2)
      );

      blended.frames.push({
        ...lastFrame,
        amps: newAmps,
        offsets: [...lastFrame.offsets],
        bandwidths: lastFrame.bandwidths ? [...lastFrame.bandwidths] : undefined,
        formantEnvelopeDb: lastFrame.formantEnvelopeDb ? [...lastFrame.formantEnvelopeDb] : undefined,
        residualBandsDb: newResid,
        timeSec: roundTo(baseTimeSec + elapsedSec, 4),
      });
    }
  }

  // Tempo-Sync Frame Scaling (`surface.tempoSync?.enabled` + `query.hostBpm`):
  // Advances spectral frame timestamps at `(hostBpm / sourceBpm)` while keeping `f0Hz` and Bark formants 100% locked!
  let tempoScaleFactor = 1.0;
  if (
    surface.tempoSync?.enabled &&
    typeof query.hostBpm === 'number' &&
    query.hostBpm > 0 &&
    surface.tempoSync.sourceBpm > 0
  ) {
    const safeHostBpm = clamp(query.hostBpm, 20, 300);
    const safeSourceBpm = clamp(surface.tempoSync.sourceBpm, 20, 300);
    tempoScaleFactor = roundTo(safeHostBpm / safeSourceBpm, 4);
    const timeInv = safeSourceBpm / safeHostBpm;
    for (const frame of blended.frames) {
      if (typeof frame.timeSec === 'number') {
        frame.timeSec = roundTo(frame.timeSec * timeInv, 4);
      }
    }
  }

  return {
    topology: surface.topology,
    midiNote,
    targetF0Hz,
    velocity,
    partialCount,
    frameCount: blended.frames.length,
    startFrameIndex,
    sustainStartFrame: surface.canonicalSustainStartFrame,
    sustainEndFrame: frameCount - 1,
    sustainBehavior: blended.sustainBehavior,
    modulation: blended.modulation,
    hybridTransient: shorten > 0.5 ? undefined : blended.hybridTransient,
    tempoScaleFactor,
    frames: blended.frames,
  };
}
