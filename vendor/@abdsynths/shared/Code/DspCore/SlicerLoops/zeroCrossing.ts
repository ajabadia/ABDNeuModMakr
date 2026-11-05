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
