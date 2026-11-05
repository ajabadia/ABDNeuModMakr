/**
 * @abdsynths/shared — Code/DspCore/SlicerLoops/conform.ts
 * =========================================================================
 * Transient-locked elastic BPM conformer (SSOT). Verbatim extraction from
 * `ABDNeuModMakr/src/core/dsp/audioSlicer/SlicerConform.ts`
 * (`conformLoopToTargetBpm`).
 */

import { clamp } from './scalar.ts';
import type {
  ConformedLoopResult,
  DetectedSlice,
} from '../../../Contracts/types/loopSlicer.ts';

/**
 * Re-assembles a sliced rhythmic/melodic loop from `sourceBpm` to
 * `targetBpm` while keeping the first `transientLockMs` (default 25 ms)
 * of every slice untouched.
 */
export function conformLoopToTargetBpm(
  pcm: Float32Array,
  sampleRate: number,
  slices: readonly DetectedSlice[],
  sourceBpm: number,
  targetBpm: number,
  options?: { transientLockMs?: number; crossfadeMs?: number; barCount?: number },
): ConformedLoopResult {
  const safeSourceBpm = clamp(sourceBpm || 120, 20, 300);
  const safeTargetBpm = clamp(targetBpm || safeSourceBpm, 20, 300);
  const totalSourceFrames = pcm.length;
  const barCount =
    options?.barCount ??
    Math.max(1, Math.round(((totalSourceFrames / Math.max(1, sampleRate)) * (safeSourceBpm / 60)) / 4));

  if (totalSourceFrames === 0 || Math.abs(safeTargetBpm - safeSourceBpm) < 0.05) {
    return {
      pcm: pcm.slice(),
      sampleRate,
      durationSec: totalSourceFrames / Math.max(1, sampleRate),
      sourceBpm: safeSourceBpm,
      targetBpm: safeTargetBpm,
      barCount,
    };
  }

  const timeScale = safeSourceBpm / safeTargetBpm;
  const targetTotalFrames = Math.max(128, Math.round(totalSourceFrames * timeScale));
  const out = new Float32Array(targetTotalFrames);

  const activeSlices = slices.filter((s) => !s.isSilence && s.pcm.length > 0);
  if (activeSlices.length === 0) {
    return {
      pcm: out,
      sampleRate,
      durationSec: targetTotalFrames / Math.max(1, sampleRate),
      sourceBpm: safeSourceBpm,
      targetBpm: safeTargetBpm,
      barCount,
    };
  }

  const transientLockFrames = Math.max(
    64,
    Math.round(((options?.transientLockMs ?? 25) / 1000) * sampleRate),
  );
  const xfadeFrames = Math.max(
    32,
    Math.round(((options?.crossfadeMs ?? 8) / 1000) * sampleRate),
  );

  for (let i = 0; i < activeSlices.length; i++) {
    const sl = activeSlices[i];
    const nextSl = i < activeSlices.length - 1 ? activeSlices[i + 1] : null;
    const dstStart = clamp(Math.round(sl.startFrame * timeScale), 0, targetTotalFrames - 1);
    const dstNextStart = nextSl
      ? clamp(Math.round(nextSl.startFrame * timeScale), dstStart + 1, targetTotalFrames)
      : targetTotalFrames;
    const slotLen = Math.max(1, dstNextStart - dstStart);
    const srcLen = sl.pcm.length;

    if (srcLen >= slotLen) {
      const copyLen = Math.min(srcLen, slotLen, targetTotalFrames - dstStart);
      const protectedFrames = Math.min(copyLen, transientLockFrames);
      const fadeLen = Math.min(xfadeFrames, Math.max(0, copyLen - protectedFrames));

      for (let k = 0; k < copyLen; k++) {
        let gain = 1.0;
        if (fadeLen > 0 && k >= copyLen - fadeLen) {
          const pos = (k - (copyLen - fadeLen)) / fadeLen;
          gain = Math.cos(pos * Math.PI * 0.5);
        }
        out[dstStart + k] += sl.pcm[k] * gain;
      }
    } else {
      const copyLen = Math.min(srcLen, targetTotalFrames - dstStart);
      for (let k = 0; k < copyLen; k++) {
        out[dstStart + k] += sl.pcm[k];
      }

      const gapLen = Math.min(slotLen - copyLen, targetTotalFrames - (dstStart + copyLen));
      const tailSourceLen = Math.min(srcLen, Math.max(128, Math.floor(srcLen * 0.45)));
      if (gapLen > 16 && tailSourceLen >= 32) {
        const tailStart = srcLen - tailSourceLen;
        for (let g = 0; g < gapLen; g++) {
          const cycle = Math.floor(g / tailSourceLen);
          const rem = g % tailSourceLen;
          const idxInTail = cycle % 2 === 0 ? tailSourceLen - 1 - rem : rem;
          const rawSample = sl.pcm[tailStart + idxInTail] ?? 0;
          const envDecay = Math.exp((-3.5 * g) / Math.max(1, gapLen));
          const endFade = g >= gapLen - xfadeFrames ? (gapLen - 1 - g) / Math.max(1, xfadeFrames) : 1.0;
          out[dstStart + copyLen + g] += rawSample * envDecay * endFade * 0.75;
        }
      }
    }
  }

  for (let i = 0; i < out.length; i++) {
    if (out[i] > 0.99) out[i] = 0.99;
    else if (out[i] < -0.99) out[i] = -0.99;
  }

  return {
    pcm: out,
    sampleRate,
    durationSec: targetTotalFrames / Math.max(1, sampleRate),
    sourceBpm: safeSourceBpm,
    targetBpm: safeTargetBpm,
    barCount,
  };
}
