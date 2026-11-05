/**
 * @abdsynths/shared — Code/DspCore/SlicerLoops/seamAnalysis.ts
 * =========================================================================
 * Loop-seam analysis + zoomed waveform envelope (SSOT). Verbatim extraction
 * from `ABDNeuModMakr/src/core/dsp/LoopEditorTools.ts`
 * (`computeLoopSeamAnalysis`, `computeZoomedWaveformEnvelope`).
 */

import { clamp } from './scalar.ts';
import type { LoopSeamAnalysis } from '../../../Contracts/types/loopSlicer.ts';

/**
 * Computes high-precision Loop Seam / Zero-Crossing Magnifier curves and
 * click-free splice metrics around `loopEnd -> loopStart`.
 */
export function computeLoopSeamAnalysis(
  pcm: Float32Array,
  loopStart: number,
  loopEnd: number,
  windowFrames = 128,
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

  const stepPenalty = clamp(stepDiscontinuity * 140, 0, 60);
  const slopePenalty = clamp(slopeDiscontinuity * 90, 0, 25);
  const nccBonus = ((nccScore + 1) * 0.5) * 25;
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
 * Computes `[min, max]` envelope columns for a visible slice
 * `[viewStartFrame .. viewEndFrame]` of a PCM buffer.
 */
export function computeZoomedWaveformEnvelope(
  pcm: Float32Array,
  viewStartFrame: number,
  viewEndFrame: number,
  numColumns: number,
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

  return { min: minArr, max: maxArr, viewStartFrame: start, viewEndFrame: end };
}
