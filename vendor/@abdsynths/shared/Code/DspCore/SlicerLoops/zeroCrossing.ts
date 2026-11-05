/**
 * @abdsynths/shared — Code/DspCore/SlicerLoops/zeroCrossing.ts
 * =========================================================================
 * Zero-crossing snap primitives (SSOT). Verbatim extraction from
 * `ABDNeuModMakr/src/core/dsp/LoopEditorTools.ts`
 * (`snapFrameToRisingZeroCrossing`, `snapFrameToNearestZeroCrossing`).
 *
 * Pure Float32Array math. No DOM, no WebAudio.
 */

import { clamp } from './scalar.ts';
import type { ZeroCrossingLoopSearchResult } from '../../../Contracts/types/loopSlicer.ts';

/**
 * Snaps a frame index to the nearest rising zero-crossing
 * (`s[i - 1] <= 0 && s[i] >= 0`) within `±searchRadiusFrames`.
 * Falls back to the smallest `|s[i]|` sample when none exists.
 */
export function snapFrameToRisingZeroCrossing(
  pcm: Float32Array,
  targetFrame: number,
  searchRadiusFrames = 512,
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

  if (bestZcIdx >= 0) return bestZcIdx;

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
 * Snaps a frame index to the nearest zero-crossing (rising or falling),
 * choosing the sample point with minimal absolute amplitude.
 */
export function snapFrameToNearestZeroCrossing(
  pcm: Float32Array,
  targetFrame: number,
  searchRadiusFrames = 256,
): number {
  const n = pcm.length;
  if (n <= 2) return 0;
  const center = clamp(Math.round(targetFrame), 1, n - 2);
  const radius = Math.max(1, Math.round(searchRadiusFrames));
  const lo = Math.max(1, center - radius);
  const hi = Math.min(n - 2, center + radius);

  let bestIdx = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  let minAbsVal = Number.POSITIVE_INFINITY;

  for (let i = lo; i <= hi; i++) {
    const prev = pcm[i - 1];
    const curr = pcm[i];
    const next = pcm[i + 1];

    const crossesZero =
      (prev <= 0 && curr >= 0 && (prev < 0 || curr > 0)) ||
      (prev >= 0 && curr <= 0 && (prev > 0 || curr < 0)) ||
      (curr <= 0 && next >= 0 && (curr < 0 || next > 0)) ||
      (curr >= 0 && next <= 0 && (curr > 0 || next < 0));

    if (crossesZero) {
      let candidate = i;
      let candVal = Math.abs(curr);
      if (Math.abs(prev) < candVal) {
        candidate = i - 1;
        candVal = Math.abs(prev);
      }
      if (Math.abs(next) < candVal) {
        candidate = i + 1;
        candVal = Math.abs(next);
      }

      const dist = Math.abs(candidate - center);
      if (dist < bestDist || (dist === bestDist && candVal < minAbsVal)) {
        bestDist = dist;
        bestIdx = candidate;
        minAbsVal = candVal;
        if (dist === 0 && candVal < 0.001) break;
      }
    }
  }

  if (bestIdx >= 0) return bestIdx;

  let minAbsIdx = center;
  let fallbackMinVal = Math.abs(pcm[center]);
  for (let i = lo; i <= hi; i++) {
    const a = Math.abs(pcm[i]);
    if (a < fallbackMinVal) {
      fallbackMinVal = a;
      minAbsIdx = i;
    }
  }
  return minAbsIdx;
}

/**
 * Auto-Loop Finder: searches around `candidateStart` and `candidateEnd` for
 * rising zero-crossings (`s[i-1] <= 0 && s[i] > 0`) that maximize local waveform
 * Normalized Cross-Correlation (NCC) and envelope continuity.
 *
 * Fase 3 extraction (SSOT): verbatim move from
 * `ABDNeuModMakr/src/core/dsp/MasterWaveEnhancer.ts`.
 * Pure Float32Array math. No DOM, no WebAudio.
 */
export function findOptimalZeroCrossingLoop(
  channels: Float32Array[],
  sampleRate: number,
  candidateStart: number,
  candidateEnd: number
): ZeroCrossingLoopSearchResult {
  const ch0 = channels[0] ?? new Float32Array(0);
  const n = ch0.length;
  if (n < 128) {
    return { loopStart: 0, loopEnd: Math.max(0, n - 1), zeroCrossingCorrelation: 1.0 };
  }

  const startCenter = clamp(Math.round(candidateStart), 32, Math.max(32, n - 96));
  const endCenter = clamp(Math.round(candidateEnd), startCenter + 64, n - 32);

  const searchRadius = Math.min(
    Math.round(sampleRate * 0.025), // ±25 ms search window
    Math.floor((endCenter - startCenter) * 0.25)
  );
  const corrWin = Math.min(Math.round(sampleRate * 0.008), 512); // 8 ms correlation window

  const findRisingZeroCrossings = (center: number, radius: number): number[] => {
    const lo = Math.max(corrWin, center - radius);
    const hi = Math.min(n - corrWin - 1, center + radius);
    const list: number[] = [];
    for (let i = lo; i <= hi; i++) {
      if (ch0[i - 1] <= 0 && ch0[i] > 0) {
        list.push(i);
      }
    }
    if (list.length === 0) list.push(clamp(center, corrWin, n - corrWin - 1));
    return list;
  };

  const starts = findRisingZeroCrossings(startCenter, searchRadius);
  const ends = findRisingZeroCrossings(endCenter, searchRadius);

  // Pick the start crossing with the cleanest rising slope near startCenter
  let bestStart = starts[0];
  let bestStartScore = -Infinity;
  for (const sIdx of starts) {
    const distPenalty = Math.abs(sIdx - startCenter) / Math.max(1, searchRadius);
    const slope = ch0[sIdx] - ch0[sIdx - 1];
    const score = slope - distPenalty * 0.05;
    if (score > bestStartScore) {
      bestStartScore = score;
      bestStart = sIdx;
    }
  }

  // Evaluate candidate end crossings by Normalized Cross-Correlation (NCC) against bestStart
  let bestEnd = ends[0];
  let bestNcc = -1.0;
  const maxEndCandidates = 48;
  const stepEnd = Math.max(1, Math.floor(ends.length / maxEndCandidates));

  for (let idx = 0; idx < ends.length; idx += stepEnd) {
    const eIdx = ends[idx];
    if (eIdx <= bestStart + corrWin) continue;

    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let k = -corrWin; k < corrWin; k++) {
      const a = ch0[bestStart + k] ?? 0;
      const b = ch0[eIdx + k] ?? 0;
      dot += a * b;
      normA += a * a;
      normB += b * b;
    }
    const denom = Math.sqrt(normA * normB);
    const ncc = denom > 1e-9 ? dot / denom : 0;
    if (ncc > bestNcc) {
      bestNcc = ncc;
      bestEnd = eIdx;
    }
  }

  const normalizedCorr = Number(clamp((bestNcc + 1.0) * 0.5, 0, 1).toFixed(3));
  return {
    loopStart: bestStart,
    loopEnd: Math.max(bestStart + 1, bestEnd),
    zeroCrossingCorrelation: normalizedCorr,
  };
}
