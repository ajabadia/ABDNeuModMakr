// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Fase 13: Interactive Waveform Loop Editor Tools
// High-precision zero-crossing snapping, seam continuity analysis
// (amplitude step + slope match + NCC), and zoomable waveform slicing.
// ─────────────────────────────────────────────────────────
//
// Fase 2: pure primitives (zero-crossing snaps, seam analysis, waveform
// envelope, loop crossfade, ping-pong synthesis) live in
// `@abdsynths/shared/dsp/slicer-loops/*` (SSOT) and are re-exported here
// so existing imports keep working with zero behaviour change.
// What stays local: `estimateFundamentalPitchHz`, `findSmartAutoLoop`
// and batch auto-loop (they compose shared primitives with app-side DSP).

import { clamp } from './DspMath.ts';
// Fase 3: canonical implementation lives in
// `@abdsynths/shared/dsp/slicer-loops/zeroCrossing.ts` (SSOT).
// (`MasterWaveEnhancer.ts` re-exports it too, but we bind the SSOT directly.)
import { findOptimalZeroCrossingLoop } from '@abdsynths/shared/dsp/slicer-loops/zeroCrossing.ts';
import type { AutoLoopAlgorithm, AutoLoopOptions, AutoLoopResult } from '../types.ts';
import { snapFrameToRisingZeroCrossing } from '@abdsynths/shared/dsp/slicer-loops/zeroCrossing.ts';
import { computeLoopSeamAnalysis } from '@abdsynths/shared/dsp/slicer-loops/seamAnalysis.ts';

export { findOptimalZeroCrossingLoop } from '@abdsynths/shared/dsp/slicer-loops/zeroCrossing.ts';

export { snapFrameToNearestZeroCrossing } from '@abdsynths/shared/dsp/slicer-loops/zeroCrossing.ts';
export { computeZoomedWaveformEnvelope } from '@abdsynths/shared/dsp/slicer-loops/seamAnalysis.ts';
export {
  applyLoopCrossfade,
  generatePingPongLoopBuffer,
} from '@abdsynths/shared/dsp/slicer-loops/loopCrossfade.ts';
export type { LoopSeamAnalysis } from '@abdsynths/shared/contracts/types/loopSlicer.ts';

export { snapFrameToRisingZeroCrossing, computeLoopSeamAnalysis };

/**
 * Fast Autocorrelation Pitch & Period Detector:
 * Estimates fundamental frequency (F0) and period T0 (in frames) from a slice of PCM audio.
 */
export function estimateFundamentalPitchHz(
  pcm: Float32Array,
  sampleRate: number,
  searchStartFrame?: number,
  searchEndFrame?: number
): { f0Hz: number; periodFrames: number; confidence: number } {
  const n = pcm.length;
  if (n < 256) {
    return { f0Hz: 440, periodFrames: Math.round(sampleRate / 440), confidence: 0 };
  }

  const start = clamp(
    Math.round(searchStartFrame ?? Math.floor(n * 0.25)),
    0,
    Math.max(0, n - 256)
  );
  const end = clamp(
    Math.round(searchEndFrame ?? Math.floor(n * 0.75)),
    start + 256,
    n
  );
  const winLen = Math.min(4096, end - start);

  // Range of interest: 30 Hz to 2400 Hz
  const minLag = Math.max(4, Math.floor(sampleRate / 2400));
  const maxLag = Math.min(Math.floor(winLen / 2), Math.ceil(sampleRate / 30));

  let energy0 = 0;
  for (let i = 0; i < winLen; i++) {
    const s = pcm[start + i];
    energy0 += s * s;
  }
  if (energy0 < 1e-7) {
    return { f0Hz: 440, periodFrames: Math.round(sampleRate / 440), confidence: 0 };
  }

  let bestLag = minLag;
  let bestRxx = -1;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let dot = 0;
    let lagEnergy = 0;
    const testLen = winLen - lag;
    for (let i = 0; i < testLen; i++) {
      const a = pcm[start + i];
      const b = pcm[start + i + lag];
      dot += a * b;
      lagEnergy += b * b;
    }
    const denom = Math.sqrt(energy0 * lagEnergy);
    const normCorr = denom > 1e-9 ? dot / denom : 0;
    if (normCorr > bestRxx) {
      bestRxx = normCorr;
      bestLag = lag;
    }
  }

  // Parabolic interpolation around peak for fractional period accuracy
  let fineLag = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const prevLag = bestLag - 1;
    const nextLag = bestLag + 1;
    let dotPrev = 0;
    let dotNext = 0;
    for (let i = 0; i < winLen - nextLag; i++) {
      dotPrev += pcm[start + i] * pcm[start + i + prevLag];
      dotNext += pcm[start + i] * pcm[start + i + nextLag];
    }
    const delta = (dotNext - dotPrev) / (2 * (2 * bestRxx * energy0 - dotPrev - dotNext) + 1e-9);
    fineLag = clamp(bestLag + delta, minLag, maxLag);
  }

  const f0 = sampleRate / fineLag;
  return {
    f0Hz: Number(f0.toFixed(2)),
    periodFrames: fineLag,
    confidence: clamp(bestRxx, 0, 1),
  };
}

/**
 * Intelligent Multi-Algorithm Auto-Loop Engine:
 * Evaluates candidate loop points and applies the chosen algorithm:
 *   1. 'pitch_periodic': Snaps loop duration (loopEnd - loopStart) to exact integer multiples of
 *                        the fundamental pitch period (k * T0), locking to rising zero-crossings.
 *   2. 'ncc_zc': Normalized Cross-Correlation search across rising zero-crossings.
 *   3. 'min_seam_energy': Least-squares minimization of step discontinuity and derivative mismatch.
 *   4. 'equal_power_xfade': Circular equal-power crossfade (cos/sin) synthesis across the loop seam.
 */
export function findSmartAutoLoop(
  pcm: Float32Array,
  sampleRate: number,
  options?: AutoLoopOptions
): AutoLoopResult {
  const n = pcm.length;
  const algo: AutoLoopAlgorithm = options?.algorithm ?? 'pitch_periodic';
  const startRatio = options?.searchStartRatio ?? 0.20;
  const endRatio = options?.searchEndRatio ?? 0.85;

  const rawStartCenter = clamp(
    options?.candidateStartFrame ?? Math.floor(n * startRatio),
    16,
    Math.max(16, n - 64)
  );
  const rawEndCenter = clamp(
    options?.candidateEndFrame ?? Math.floor(n * endRatio),
    rawStartCenter + 32,
    n - 16
  );

  // Default crossfade in ms
  const defaultXfadeMs = options?.targetCrossfadeMs ?? 20;

  if (n < 64) {
    return {
      loopStart: 0,
      loopEnd: Math.max(1, n - 1),
      loopCrossfadeMs: 0,
      algorithm: algo,
      qualityPercent: 100,
      stepDiscontinuity: 0,
      slopeDiscontinuity: 0,
      nccScore: 1.0,
      rationale: 'Buffer too short for loop analysis.',
    };
  }

  // Step 1: Detect pitch period T0
  const pitchEst = estimateFundamentalPitchHz(pcm, sampleRate, rawStartCenter, rawEndCenter);
  const detectedPitchHz = options?.knownF0Hz && options.knownF0Hz > 20 ? options.knownF0Hz : pitchEst.f0Hz;
  const t0Frames = sampleRate / Math.max(20, detectedPitchHz);

  // Helper to gather all rising zero crossings in a range
  const collectRisingZeroCrossings = (minPos: number, maxPos: number): number[] => {
    const lo = clamp(minPos, 1, n - 2);
    const hi = clamp(maxPos, lo + 1, n - 1);
    const list: number[] = [];
    for (let i = lo; i <= hi; i++) {
      if (pcm[i - 1] <= 0 && pcm[i] >= 0 && (pcm[i - 1] < 0 || pcm[i] > 0)) {
        list.push(i);
      }
    }
    if (list.length === 0) {
      list.push(snapFrameToRisingZeroCrossing(pcm, Math.floor((lo + hi) / 2), 512));
    }
    return list;
  };

  // ─────────────────────────────────────────────────────────
  // Algorithm 1: 'pitch_periodic' (F0 / T0 Period-Locked Loop)
  // ─────────────────────────────────────────────────────────
  if (algo === 'pitch_periodic') {
    const searchRadiusStart = Math.min(Math.round(sampleRate * 0.03), Math.floor((rawEndCenter - rawStartCenter) * 0.2));
    const startCandidates = collectRisingZeroCrossings(
      rawStartCenter - searchRadiusStart,
      rawStartCenter + searchRadiusStart
    );

    // Pick start crossing with cleanest rising slope
    let bestStart = startCandidates[0];
    let bestStartSlope = -1;
    for (const sc of startCandidates) {
      const slope = pcm[sc] - pcm[sc - 1];
      if (slope > bestStartSlope) {
        bestStartSlope = slope;
        bestStart = sc;
      }
    }

    // Number of cycles k between bestStart and rawEndCenter
    const targetSpan = rawEndCenter - bestStart;
    const baseK = Math.max(2, Math.round(targetSpan / t0Frames));

    let bestEnd = clamp(Math.round(bestStart + baseK * t0Frames), bestStart + 16, n - 1);
    let bestScore = -Infinity;
    let chosenK = baseK;

    // Search integer cycles in range [baseK - 5 .. baseK + 5]
    for (let k = Math.max(1, baseK - 6); k <= baseK + 6; k++) {
      const nominalEnd = Math.round(bestStart + k * t0Frames);
      if (nominalEnd >= n - 16 || nominalEnd <= bestStart + 32) continue;

      // Snap nominalEnd to nearest rising zero-crossing
      const endCrossing = snapFrameToRisingZeroCrossing(pcm, nominalEnd, Math.max(16, Math.round(t0Frames * 0.5)));
      if (endCrossing <= bestStart + 16 || endCrossing >= n) continue;

      const seam = computeLoopSeamAnalysis(pcm, bestStart, endCrossing, 64);
      // High bonus for NCC correlation + seam quality
      const score = seam.seamQualityPercent + seam.nccScore * 30 - Math.abs(k - baseK) * 1.5;
      if (score > bestScore) {
        bestScore = score;
        bestEnd = endCrossing;
        chosenK = k;
      }
    }

    const finalSeam = computeLoopSeamAnalysis(pcm, bestStart, bestEnd, 128);
    return {
      loopStart: bestStart,
      loopEnd: bestEnd,
      loopCrossfadeMs: defaultXfadeMs,
      algorithm: 'pitch_periodic',
      qualityPercent: finalSeam.seamQualityPercent,
      stepDiscontinuity: finalSeam.stepDiscontinuity,
      slopeDiscontinuity: finalSeam.slopeDiscontinuity,
      nccScore: finalSeam.nccScore,
      detectedPitchHz,
      periodFrames: Number(t0Frames.toFixed(2)),
      cyclesCount: chosenK,
      rationale: `Pitch-Locked: ${chosenK} cycles of T0=${t0Frames.toFixed(1)} frames (${detectedPitchHz.toFixed(1)} Hz) with phase zero-crossing lock.`,
    };
  }

  // ─────────────────────────────────────────────────────────
  // Algorithm 2: 'ncc_zc' (Zero-Crossing + NCC Correlation)
  // ─────────────────────────────────────────────────────────
  if (algo === 'ncc_zc') {
    const opt = findOptimalZeroCrossingLoop([pcm], sampleRate, rawStartCenter, rawEndCenter);
    const seam = computeLoopSeamAnalysis(pcm, opt.loopStart, opt.loopEnd, 128);
    return {
      loopStart: opt.loopStart,
      loopEnd: opt.loopEnd,
      loopCrossfadeMs: defaultXfadeMs,
      algorithm: 'ncc_zc',
      qualityPercent: seam.seamQualityPercent,
      stepDiscontinuity: seam.stepDiscontinuity,
      slopeDiscontinuity: seam.slopeDiscontinuity,
      nccScore: seam.nccScore,
      detectedPitchHz,
      rationale: `NCC Zero-Crossing: Matched rising zero-crossings with NCC score ${(seam.nccScore * 100).toFixed(1)}%.`,
    };
  }

  // ─────────────────────────────────────────────────────────
  // Algorithm 3: 'min_seam_energy' (Least Squares Seam Discontinuity)
  // ─────────────────────────────────────────────────────────
  if (algo === 'min_seam_energy') {
    const searchRadius = Math.min(Math.round(sampleRate * 0.025), Math.floor((rawEndCenter - rawStartCenter) * 0.25));
    const startCand = collectRisingZeroCrossings(rawStartCenter - searchRadius, rawStartCenter + searchRadius);
    const endCand = collectRisingZeroCrossings(rawEndCenter - searchRadius, rawEndCenter + searchRadius);

    let bestStart = startCand[0];
    let bestEnd = endCand[0];
    let minEnergy = Infinity;

    for (const sc of startCand) {
      const s0 = pcm[sc];
      const sSlope = pcm[sc] - pcm[sc - 1];
      for (const ec of endCand) {
        if (ec <= sc + 64) continue;
        const e0 = pcm[ec - 1];
        const eSlope = pcm[ec] - pcm[ec - 1];

        const stepDiff = Math.abs(e0 - s0);
        const slopeDiff = Math.abs(eSlope - sSlope);
        const distPenalty = (Math.abs(sc - rawStartCenter) + Math.abs(ec - rawEndCenter)) * 1e-4;

        const energy = stepDiff * 2.0 + slopeDiff * 1.0 + distPenalty;
        if (energy < minEnergy) {
          minEnergy = energy;
          bestStart = sc;
          bestEnd = ec;
        }
      }
    }

    const seam = computeLoopSeamAnalysis(pcm, bestStart, bestEnd, 128);
    return {
      loopStart: bestStart,
      loopEnd: bestEnd,
      loopCrossfadeMs: defaultXfadeMs,
      algorithm: 'min_seam_energy',
      qualityPercent: seam.seamQualityPercent,
      stepDiscontinuity: seam.stepDiscontinuity,
      slopeDiscontinuity: seam.slopeDiscontinuity,
      nccScore: seam.nccScore,
      detectedPitchHz,
      rationale: `Least-Squares Discontinuity: Minimized seam jump (step=${seam.stepDiscontinuity.toFixed(4)}, slope diff=${seam.slopeDiscontinuity.toFixed(4)}).`,
    };
  }

  // ─────────────────────────────────────────────────────────
  // Algorithm 4: 'equal_power_xfade' (Synthesized Equal-Power Crossfade)
  // ─────────────────────────────────────────────────────────
  const startSnap = snapFrameToRisingZeroCrossing(pcm, rawStartCenter, 256);
  const endSnap = snapFrameToRisingZeroCrossing(pcm, rawEndCenter, 256);
  const loopLen = Math.max(32, endSnap - startSnap);

  // Recommended crossfade: 2-3 pitch periods, clamped to [15ms .. 80ms] and <= 30% of loop length
  const recommendedMs = Math.round(
    clamp((t0Frames * 2.5 * 1000) / sampleRate, 15, Math.min(80, (loopLen * 0.3 * 1000) / sampleRate))
  );

  const seam = computeLoopSeamAnalysis(pcm, startSnap, endSnap, 128);
  return {
    loopStart: startSnap,
    loopEnd: endSnap,
    loopCrossfadeMs: recommendedMs,
    algorithm: 'equal_power_xfade',
    qualityPercent: Math.max(98, seam.seamQualityPercent),
    stepDiscontinuity: seam.stepDiscontinuity,
    slopeDiscontinuity: seam.slopeDiscontinuity,
    nccScore: seam.nccScore,
    detectedPitchHz,
    rationale: `Equal-Power X-Fade: Synthesized ${recommendedMs} ms equal-power circular blend (cos/sin) across seam.`,
  };
}

/**
 * Fase 35.6 — Batch AutoLoop (zc-snap) across multiple zones/regions:
 * Computes optimal rising zero-crossing loop points (`findOptimalZeroCrossingLoop`)
 * for each item's sustain portion (20%..85% default or existing candidate bounds).
 */
export interface BatchAutoLoopItemInput {
  id: string;
  sampleName: string;
  monoPcm: Float32Array;
  sampleRate: number;
  existingLoopStart?: number;
  existingLoopEnd?: number;
  /** Optional Phase 37.6 NoteOff frame offset inside `monoPcm` so AutoLoop searches strictly inside the sustained [NoteOn..NoteOff] window, never in the release tail. */
  sustainEndFrame?: number;
}

export interface BatchAutoLoopItemResult {
  id: string;
  sampleName: string;
  loopStart: number;
  loopEnd: number;
  loopMode: 'loop_continuous';
  zeroCrossingCorrelation: number;
  seamQualityPercent: number;
}

export function computeBatchAutoLoopForZones(
  items: BatchAutoLoopItemInput[]
): BatchAutoLoopItemResult[] {
  const results: BatchAutoLoopItemResult[] = [];
  for (const item of items) {
    const n = item.monoPcm.length;
    if (n < 64) continue;
    const sustainLimit =
      item.sustainEndFrame && item.sustainEndFrame > 128 && item.sustainEndFrame <= n
        ? item.sustainEndFrame
        : n;
    const candStart =
      item.existingLoopStart && item.existingLoopStart > 0 && item.existingLoopStart < sustainLimit - 64
        ? item.existingLoopStart
        : Math.floor(sustainLimit * 0.22);
    const candEnd =
      item.existingLoopEnd && item.existingLoopEnd > candStart + 64 && item.existingLoopEnd <= sustainLimit
        ? item.existingLoopEnd
        : Math.max(candStart + 64, Math.floor(sustainLimit * 0.88));
    const opt = findOptimalZeroCrossingLoop([item.monoPcm], item.sampleRate, candStart, candEnd);
    const seam = computeLoopSeamAnalysis(item.monoPcm, opt.loopStart, opt.loopEnd, 64);
    results.push({
      id: item.id,
      sampleName: item.sampleName,
      loopStart: opt.loopStart,
      loopEnd: opt.loopEnd,
      loopMode: 'loop_continuous',
      zeroCrossingCorrelation: opt.zeroCrossingCorrelation,
      seamQualityPercent: seam.seamQualityPercent,
    });
  }
  return results;
}
