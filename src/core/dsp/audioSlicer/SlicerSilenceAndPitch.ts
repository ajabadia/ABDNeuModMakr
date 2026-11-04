// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — RMS Silence Interval Gate & Legato Pitch-Change Detection
// ─────────────────────────────────────────────────────────

import { clamp } from '../DspMath.ts';
import { snapFrameToNearestZeroCrossing } from '../LoopEditorTools.ts';
import { detectPitchYinMpm } from '../AcousticIntelligence.ts';
import type { SlicerOptions } from './SlicerTypes.ts';

export interface SilenceInterval {
  startFrame: number;
  endFrame: number;
}

/**
 * Scans mono PCM audio in short RMS hops (5 ms) and returns contiguous silent intervals
 * whose RMS stays below `silenceThresholdDb` for at least `minSilenceMs`.
 */
export function detectSilenceIntervals(
  pcm: Float32Array,
  sampleRate: number,
  silenceThresholdDb: number,
  minSilenceMs: number
): SilenceInterval[] {
  const totalFrames = pcm.length;
  if (totalFrames <= 128 || minSilenceMs <= 0) return [];

  const hopFrames = Math.max(64, Math.round(0.005 * sampleRate));
  const numHops = Math.ceil(totalFrames / hopFrames);
  const silenceLinear = Math.pow(10, silenceThresholdDb / 20);
  const minSilenceFrames = Math.max(hopFrames, Math.round((minSilenceMs / 1000) * sampleRate));

  const intervals: SilenceInterval[] = [];
  let inSilence = false;
  let runStartFrame = 0;

  for (let h = 0; h < numHops; h++) {
    const start = h * hopFrames;
    const end = Math.min(totalFrames, start + hopFrames);
    let sumSq = 0;
    for (let i = start; i < end; i++) {
      const v = pcm[i];
      sumSq += v * v;
    }
    const hopRms = Math.sqrt(sumSq / Math.max(1, end - start));
    const isQuiet = hopRms < silenceLinear;

    if (isQuiet && !inSilence) {
      inSilence = true;
      runStartFrame = start;
    } else if (!isQuiet && inSilence) {
      inSilence = false;
      const runEndFrame = start;
      if (runEndFrame - runStartFrame >= minSilenceFrames) {
        intervals.push({ startFrame: runStartFrame, endFrame: runEndFrame });
      }
    }
  }

  if (inSilence) {
    const runEndFrame = totalFrames;
    if (runEndFrame - runStartFrame >= minSilenceFrames) {
      intervals.push({ startFrame: runStartFrame, endFrame: runEndFrame });
    }
  }

  return intervals;
}

/**
 * Inserts cut boundaries at the start and end of detected silent intervals (`>= minSilenceMs`)
 * so that silent regions become isolated slices that `buildSlicesFromBoundaries` marks as
 * muted (`isSilence = true`), preventing them from being injected into the zone matrix.
 */
export function injectSilenceCutBoundaries(
  pcm: Float32Array,
  sampleRate: number,
  baseBoundaries: number[],
  opts: SlicerOptions
): number[] {
  if (opts.detectSilences === false) return baseBoundaries;
  const totalFrames = pcm.length;
  const minSilenceMs = opts.minSilenceMs ?? 120;
  if (minSilenceMs <= 0 || totalFrames <= 128) return baseBoundaries;

  const minSilenceFrames = Math.max(128, Math.round((minSilenceMs / 1000) * sampleRate));
  const minActiveFrames = Math.max(
    128,
    Math.round(((opts.minSliceMs ?? 45) / 1000) * sampleRate)
  );
  const preRollFrames = Math.max(0, Math.round(((opts.preRollMs ?? 0) / 1000) * sampleRate));
  const snapProximity = Math.max(minActiveFrames, preRollFrames * 2 + 256);

  const rawIntervals = detectSilenceIntervals(
    pcm,
    sampleRate,
    opts.silenceThresholdDb,
    minSilenceMs
  );
  if (rawIntervals.length === 0) return baseBoundaries;

  const sortedBase = Array.from(new Set(baseBoundaries.map((b) => clamp(Math.round(b), 0, totalFrames)))).sort(
    (a, b) => a - b
  );

  // Snap interval edges to nearby existing transient boundaries so we don't create tiny slivers
  const adjustedIntervals: SilenceInterval[] = [];
  for (const iv of rawIntervals) {
    let s = iv.startFrame;
    let e = iv.endFrame;

    for (const b of sortedBase) {
      if (Math.abs(s - b) <= minActiveFrames) {
        s = b;
        break;
      }
    }
    for (const b of sortedBase) {
      if (Math.abs(e - b) <= snapProximity) {
        e = b;
        break;
      }
    }

    if (e - s >= minSilenceFrames) {
      adjustedIntervals.push({ startFrame: s, endFrame: e });
    }
  }

  if (adjustedIntervals.length === 0) return baseBoundaries;

  // Keep base boundaries that do not lie strictly inside a silent interval
  const combined = new Set<number>([0, totalFrames]);
  for (const b of sortedBase) {
    const strictlyInsideSilence = adjustedIntervals.some(
      (iv) => b > iv.startFrame + 64 && b < iv.endFrame - 64
    );
    if (!strictlyInsideSilence) {
      combined.add(b);
    }
  }

  for (const iv of adjustedIntervals) {
    if (iv.startFrame > 64 && iv.startFrame < totalFrames - 64) {
      combined.add(iv.startFrame);
    }
    if (iv.endFrame > 64 && iv.endFrame < totalFrames - 64) {
      combined.add(iv.endFrame);
    }
  }

  return Array.from(combined).sort((a, b) => a - b);
}

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
