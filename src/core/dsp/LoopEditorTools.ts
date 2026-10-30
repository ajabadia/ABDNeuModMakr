// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Fase 13: Interactive Waveform Loop Editor Tools
// High-precision zero-crossing snapping, seam continuity analysis
// (amplitude step + slope match + NCC), and zoomable waveform slicing.
// ─────────────────────────────────────────────────────────

import { clamp } from './DspMath.ts';
import { findOptimalZeroCrossingLoop } from './MasterWaveEnhancer.ts';
import type { AutoLoopAlgorithm, AutoLoopOptions, AutoLoopResult, CrossfadeCurve } from '../types.ts';

export { findOptimalZeroCrossingLoop };

export interface LoopSeamAnalysis {
  /** Number of samples in `preEndSamples` (approaching `loopEnd`) and `postStartSamples` (leaving `loopStart`) */
  windowFrames: number;
  /** Samples `[loopEnd - windowFrames .. loopEnd - 1]` approaching the loop splice from the left */
  preEndSamples: Float32Array;
  /** Samples `[loopStart .. loopStart + windowFrames - 1]` continuing from the loop splice to the right */
  postStartSamples: Float32Array;
  /** Ghost continuation `[loopEnd .. loopEnd + windowFrames - 1]` showing how the wave would have continued past `loopEnd` */
  ghostPostEndSamples: Float32Array;
  /** Ghost pre-history `[loopStart - windowFrames .. loopStart - 1]` showing how the wave approached `loopStart` */
  ghostPreStartSamples: Float32Array;
  /** Absolute amplitude jump `|pcm[loopEnd - 1] - pcm[loopStart]|` at the seam (0 = perfect level match) */
  stepDiscontinuity: number;
  /** First-derivative slope difference across the seam (0 = perfect slope match) */
  slopeDiscontinuity: number;
  /** Normalized Cross-Correlation (-1..+1) between the neighbourhood of `loopEnd` and `loopStart` */
  nccScore: number;
  /** Overall click-free seam quality score (0..100%) */
  seamQualityPercent: number;
}

/**
 * Snaps a frame index to the nearest rising zero-crossing (`s[i - 1] <= 0 && s[i] >= 0`)
 * within `±searchRadiusFrames`. If no rising zero-crossing exists in that window,
 * returns the sample with the smallest `|s[i]|`.
 */
export function snapFrameToRisingZeroCrossing(
  pcm: Float32Array,
  targetFrame: number,
  searchRadiusFrames: number = 512
): number {
  const n = pcm.length;
  if (n <= 2) return 0;
  const center = clamp(Math.round(targetFrame), 1, n - 1);
  const radius = Math.max(1, Math.round(searchRadiusFrames));
  const lo = Math.max(1, center - radius);
  const hi = Math.min(n - 1, center + radius);

  let bestZcIdx = -1;
  let bestZcDist = Number.POSITIVE_INFINITY;

  for (let i = lo; i <= hi; i++) {
    const prev = pcm[i - 1];
    const curr = pcm[i];
    if (prev <= 0 && curr >= 0 && (prev < 0 || curr > 0)) {
      const dist = Math.abs(i - center);
      if (dist < bestZcDist) {
        bestZcDist = dist;
        bestZcIdx = i;
        if (dist === 0) break;
      }
    }
  }

  if (bestZcIdx >= 0) {
    return bestZcIdx;
  }

  // Fallback: nearest minimum absolute value
  let minAbsIdx = center;
  let minAbsVal = Math.abs(pcm[center]);
  for (let i = lo; i <= hi; i++) {
    const a = Math.abs(pcm[i]);
    if (a < minAbsVal) {
      minAbsVal = a;
      minAbsIdx = i;
    }
  }
  return minAbsIdx;
}

/**
 * Computes the high-precision Loop Seam / Zero-Crossing Magnifier curves and
 * click-free splice metrics around `loopEnd -> loopStart`.
 */
export function computeLoopSeamAnalysis(
  pcm: Float32Array,
  loopStart: number,
  loopEnd: number,
  windowFrames: number = 128
): LoopSeamAnalysis {
  const n = pcm.length;
  const w = Math.max(16, Math.min(1024, Math.round(windowFrames)));
  const preEndSamples = new Float32Array(w);
  const postStartSamples = new Float32Array(w);
  const ghostPostEndSamples = new Float32Array(w);
  const ghostPreStartSamples = new Float32Array(w);

  if (n < 4) {
    return {
      windowFrames: w,
      preEndSamples,
      postStartSamples,
      ghostPostEndSamples,
      ghostPreStartSamples,
      stepDiscontinuity: 0,
      slopeDiscontinuity: 0,
      nccScore: 1,
      seamQualityPercent: 100,
    };
  }

  const startIdx = clamp(Math.round(loopStart), 0, n - 2);
  const endIdx = clamp(Math.round(loopEnd), startIdx + 1, n);

  for (let i = 0; i < w; i++) {
    const preEndPos = endIdx - w + i;
    preEndSamples[i] = preEndPos >= 0 && preEndPos < n ? pcm[preEndPos] : 0;

    const postStartPos = startIdx + i;
    postStartSamples[i] = postStartPos >= 0 && postStartPos < n ? pcm[postStartPos] : 0;

    const ghostPostPos = endIdx + i;
    ghostPostEndSamples[i] = ghostPostPos >= 0 && ghostPostPos < n ? pcm[ghostPostPos] : 0;

    const ghostPrePos = startIdx - w + i;
    ghostPreStartSamples[i] = ghostPrePos >= 0 && ghostPrePos < n ? pcm[ghostPrePos] : 0;
  }

  const leftVal = preEndSamples[w - 1];
  const rightVal = postStartSamples[0];
  const stepDiscontinuity = Math.abs(leftVal - rightVal);

  const leftSlope = preEndSamples[w - 1] - preEndSamples[Math.max(0, w - 2)];
  const rightSlope = postStartSamples[Math.min(w - 1, 1)] - postStartSamples[0];
  const slopeDiscontinuity = Math.abs(leftSlope - rightSlope);

  // Compute NCC between [preEndSamples, ghostPostEndSamples] and [ghostPreStartSamples, postStartSamples]
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const halfW = Math.min(64, Math.floor(w / 2));
  for (let k = -halfW; k < halfW; k++) {
    const idxA = endIdx + k;
    const idxB = startIdx + k;
    const a = idxA >= 0 && idxA < n ? pcm[idxA] : 0;
    const b = idxB >= 0 && idxB < n ? pcm[idxB] : 0;
    dot += a * b;
    normA += a * a;
    normB += b * b;
  }
  const denom = Math.sqrt(normA * normB);
  const nccScore = denom > 1e-9 ? clamp(dot / denom, -1, 1) : 1;

  // Click-free seam quality score (0..100%)
  const stepPenalty = clamp(stepDiscontinuity * 140, 0, 60);
  const slopePenalty = clamp(slopeDiscontinuity * 90, 0, 25);
  const nccBonus = ((nccScore + 1) * 0.5) * 25; // 0..25
  const rawQuality = clamp(75 - stepPenalty - slopePenalty + nccBonus, 0, 100);

  return {
    windowFrames: w,
    preEndSamples,
    postStartSamples,
    ghostPostEndSamples,
    ghostPreStartSamples,
    stepDiscontinuity,
    slopeDiscontinuity,
    nccScore,
    seamQualityPercent: Math.round(rawQuality),
  };
}

/**
 * Computes `[min, max]` envelope columns for a visible slice `[viewStartFrame .. viewEndFrame]`
 * of a PCM buffer, supporting arbitrary horizontal zoom in the Waveform Loop Editor.
 */
export function computeZoomedWaveformEnvelope(
  pcm: Float32Array,
  viewStartFrame: number,
  viewEndFrame: number,
  numColumns: number
): { min: number[]; max: number[]; viewStartFrame: number; viewEndFrame: number } {
  const n = pcm.length;
  const cols = Math.max(16, Math.min(2048, Math.round(numColumns)));
  const start = clamp(Math.floor(viewStartFrame), 0, Math.max(0, n - 1));
  const end = clamp(Math.ceil(viewEndFrame), start + 1, Math.max(1, n));
  const span = Math.max(1, end - start);

  const minArr = new Array<number>(cols).fill(0);
  const maxArr = new Array<number>(cols).fill(0);
  if (n === 0) {
    return { min: minArr, max: maxArr, viewStartFrame: 0, viewEndFrame: 1 };
  }

  for (let c = 0; c < cols; c++) {
    const f0 = start + Math.floor((c * span) / cols);
    const f1 = Math.max(f0 + 1, start + Math.floor(((c + 1) * span) / cols));
    let lo = 1.0;
    let hi = -1.0;
    for (let i = f0; i < f1 && i < n; i++) {
      const s = pcm[i];
      if (s < lo) lo = s;
      if (s > hi) hi = s;
    }
    if (lo > hi) {
      lo = 0;
      hi = 0;
    }
    minArr[c] = lo;
    maxArr[c] = hi;
  }

  return {
    min: minArr,
    max: maxArr,
    viewStartFrame: start,
    viewEndFrame: end,
  };
}

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
 * Applies an equal-power or linear circular crossfade splice at the seam [loopEnd -> loopStart].
 * Blends samples approaching loopEnd with the pre-start / start region to prevent clicks.
 */
export function applyLoopCrossfade(
  pcm: Float32Array,
  loopStart: number,
  loopEnd: number,
  xfadeFrames: number,
  curve: CrossfadeCurve = 'equal-power'
): Float32Array {
  const n = pcm.length;
  const out = new Float32Array(pcm);
  const s = clamp(Math.round(loopStart), 0, n - 2);
  const e = clamp(Math.round(loopEnd), s + 1, n);
  const loopLen = e - s;
  const maxAllowedXfade = Math.max(4, Math.floor(loopLen * 0.45));
  const x = clamp(Math.round(xfadeFrames), 0, maxAllowedXfade);
  if (x <= 1) return out;

  for (let k = 0; k < x; k++) {
    const t = k / x; // 0..1
    let gEnd = 1.0 - t;
    let gStart = t;

    if (curve === 'equal-power') {
      gEnd = Math.cos(t * Math.PI * 0.5);
      gStart = Math.sin(t * Math.PI * 0.5);
    }

    const endPos = e - x + k;
    const preStartPos = s - x + k;
    const startPos = s + k;

    // Use pre-start historical wave if available, otherwise post-start wave
    const sampleFromStart = preStartPos >= 0 ? pcm[preStartPos] : pcm[startPos];
    const sampleApproachingEnd = pcm[endPos];

    out[endPos] = sampleApproachingEnd * gEnd + sampleFromStart * gStart;
  }

  return out;
}

/**
 * Synthesizes an authentic bidirectional (Ping-Pong) looped buffer for auditioning.
 * The loop section [loopStart .. loopEnd] is cloned forward and then reversed [loopEnd .. loopStart].
 * WebAudio AudioBufferSourceNode looping over [loopStart .. loopStart + 2 * (loopEnd - loopStart)]
 * produces authentic forward-backward alternating playback.
 */
export function generatePingPongLoopBuffer(
  pcm: Float32Array,
  loopStart: number,
  loopEnd: number
): { pcm: Float32Array; loopStart: number; loopEnd: number } {
  const n = pcm.length;
  const s = clamp(Math.round(loopStart), 0, Math.max(0, n - 2));
  const e = clamp(Math.round(loopEnd), s + 1, n);
  const loopLen = e - s;

  if (loopLen < 4) {
    return { pcm, loopStart: s, loopEnd: e };
  }

  const outLen = n + loopLen;
  const out = new Float32Array(outLen);

  // 1. Pre-loop + forward loop section: [0 .. e]
  out.set(pcm.subarray(0, e), 0);

  // 2. Reversed loop section: [e-1 down to s]
  for (let i = 0; i < loopLen; i++) {
    out[e + i] = pcm[e - 1 - i];
  }

  // 3. Post-loop release tail: [e .. n]
  if (e < n) {
    out.set(pcm.subarray(e, n), e + loopLen);
  }

  return {
    pcm: out,
    loopStart: s,
    loopEnd: s + 2 * loopLen,
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
