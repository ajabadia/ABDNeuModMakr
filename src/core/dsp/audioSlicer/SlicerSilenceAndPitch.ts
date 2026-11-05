// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — RMS Silence Interval Gate & Legato Pitch-Change Detection
//
// Fase 2: `detectSilenceIntervals` + `injectSilenceCutBoundaries` live in
// `@abdsynths/shared/dsp/slicer-loops/silenceIntervals.ts` (SSOT).
// `detectMelodicPitchChangeBoundaries` stays local: it depends on
// app-side `AcousticIntelligence` (YIN/MPM), not portable shared DSP.
// ─────────────────────────────────────────────────────────

import { snapFrameToNearestZeroCrossing } from '../LoopEditorTools.ts';
import { detectPitchYinMpm } from '../AcousticIntelligence.ts';

export {
  detectSilenceIntervals,
  injectSilenceCutBoundaries,
} from '@abdsynths/shared/dsp/slicer-loops/silenceIntervals.ts';
export type { SilenceInterval } from '@abdsynths/shared/contracts/types/loopSlicer.ts';

/**
 * Detects legato pitch-change transitions (> 80 cents jump across consecutive stable windows)
 * so recorded melodies or basslines played without hard transients still slice note-by-note.
 */
export function detectMelodicPitchChangeBoundaries(
  pcm: Float32Array,
  sampleRate: number,
  existingBoundaries: readonly number[],
  minDistanceFrames: number
): number[] {
  const totalFrames = pcm.length;
  const winFrames = Math.max(1024, Math.round(0.055 * sampleRate)); // ~55 ms window
  const hopFrames = Math.max(512, Math.round(0.035 * sampleRate));  // ~35 ms hop
  if (totalFrames < winFrames * 2) return [];

  const extraBoundaries: number[] = [];
  let prevMidiFloat: number | null = null;
  let lastAddedFrame = -minDistanceFrames;

  for (let start = 0; start + winFrames <= totalFrames; start += hopFrames) {
    const seg = pcm.subarray(start, start + winFrames);
    let sumSq = 0;
    for (let i = 0; i < seg.length; i++) sumSq += seg[i] * seg[i];
    const rms = Math.sqrt(sumSq / seg.length);
    if (rms < 0.008) {
      prevMidiFloat = null;
      continue;
    }

    const pitch = detectPitchYinMpm(seg, sampleRate);
    if (pitch.harmonicity < 0.55 || pitch.f0Hz < 45 || pitch.f0Hz > 3500) {
      prevMidiFloat = null;
      continue;
    }

    const midiFloat = 69 + 12 * Math.log2(pitch.f0Hz / 440);
    if (prevMidiFloat !== null && Math.abs(midiFloat - prevMidiFloat) >= 0.78) {
      const candidateFrame = start;
      const farFromExisting = existingBoundaries.every(
        (b) => Math.abs(b - candidateFrame) >= minDistanceFrames
      );
      if (farFromExisting && candidateFrame - lastAddedFrame >= minDistanceFrames) {
        extraBoundaries.push(snapFrameToNearestZeroCrossing(pcm, candidateFrame, 256));
        lastAddedFrame = candidateFrame;
        prevMidiFloat = midiFloat;
      }
    } else {
      prevMidiFloat = midiFloat;
    }
  }

  return extraBoundaries;
}
