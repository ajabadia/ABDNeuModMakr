/**
 * @abdsynths/shared — Code/DspCore/SlicerLoops/loopCrossfade.ts
 * =========================================================================
 * Loop crossfade + ping-pong synthesis (SSOT). Verbatim extraction from
 * `ABDNeuModMakr/src/core/dsp/LoopEditorTools.ts`
 * (`applyLoopCrossfade`, `generatePingPongLoopBuffer`).
 */

import { clamp } from './scalar.ts';
import type { CrossfadeCurve } from '../../../Contracts/types/loopSlicer.ts';

/**
 * Applies an equal-power or linear circular crossfade splice at the seam
 * [loopEnd -> loopStart]. Blends samples approaching loopEnd with the
 * pre-start / start region to prevent clicks.
 */
export function applyLoopCrossfade(
  pcm: Float32Array,
  loopStart: number,
  loopEnd: number,
  xfadeFrames: number,
  curve: CrossfadeCurve = 'equal-power',
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
    const t = k / x;
    let gEnd = 1.0 - t;
    let gStart = t;

    if (curve === 'equal-power') {
      gEnd = Math.cos(t * Math.PI * 0.5);
      gStart = Math.sin(t * Math.PI * 0.5);
    }

    const endPos = e - x + k;
    const preStartPos = s - x + k;
    const startPos = s + k;

    const sampleFromStart = preStartPos >= 0 ? pcm[preStartPos] : pcm[startPos];
    const sampleApproachingEnd = pcm[endPos];

    out[endPos] = sampleApproachingEnd * gEnd + sampleFromStart * gStart;
  }

  return out;
}

/**
 * Synthesizes an authentic bidirectional (Ping-Pong) looped buffer.
 * The loop section [loopStart .. loopEnd] is cloned forward and then
 * reversed [loopEnd .. loopStart].
 */
export function generatePingPongLoopBuffer(
  pcm: Float32Array,
  loopStart: number,
  loopEnd: number,
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

  out.set(pcm.subarray(0, e), 0);

  for (let i = 0; i < loopLen; i++) {
    out[e + i] = pcm[e - 1 - i];
  }

  if (e < n) {
    out.set(pcm.subarray(e, n), e + loopLen);
  }

  return {
    pcm: out,
    loopStart: s,
    loopEnd: s + 2 * loopLen,
  };
}
