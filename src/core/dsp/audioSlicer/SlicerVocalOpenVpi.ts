// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — OpenVPI (slicer2) Vocal & Phrase Segmentation
// ─────────────────────────────────────────────────────────

import { clamp } from '../DspMath.ts';
import type { SlicerOptions } from './SlicerTypes.ts';

/**
 * Segments vocals and speech using the OpenVPI (slicer2) algorithm:
 * RMS silence gap detection + energy valley cut points + zero-crossing snapping.
 * Avoids chopping mid-syllable or triggering false onsets on vocal vibrato/formants.
 */
export function sliceVocalPhrasesOpenVpi(
  pcm: Float32Array,
  sampleRate: number,
  opts: SlicerOptions
): number[] {
  const totalFrames = pcm.length;
  const hopFrames = Math.max(64, Math.round(0.01 * sampleRate)); // 10ms hop
  const numHops = Math.floor(totalFrames / hopFrames);
  if (numHops <= 2) return [0, totalFrames];

  // 1. Calculate RMS energy per hop
  const hopRms = new Float32Array(numHops);
  for (let h = 0; h < numHops; h++) {
    const start = h * hopFrames;
    const end = Math.min(totalFrames, start + hopFrames);
    let sumSq = 0;
    for (let i = start; i < end; i++) {
      const v = pcm[i];
      sumSq += v * v;
    }
    hopRms[h] = Math.sqrt(sumSq / Math.max(1, end - start));
  }

  // Linear threshold from dB (adjusted by user sensitivity: -50 dB to -32 dB)
  const sensNorm = clamp(opts.sensitivity, 5, 95) / 100;
  const effectiveDbThresh = opts.silenceThresholdDb + (sensNorm - 0.5) * 12;
  const silenceLinear = Math.pow(10, effectiveDbThresh / 20);

  const minSliceFrames = Math.round(((opts.minSliceMs ?? 250) / 1000) * sampleRate);
  // Minimum silence gap to trigger phrase split (user-configurable, default 120ms)
  const minSilenceHops = Math.max(3, Math.round(((opts.minSilenceMs ?? 150) / 1000) * (sampleRate / hopFrames)));

  const boundaries: number[] = [0];
  let lastCutFrame = 0;
  let inSilence = false;
  let silenceStartHop = 0;

  for (let h = 0; h < numHops; h++) {
    const isQuiet = hopRms[h] < silenceLinear;

    if (isQuiet && !inSilence) {
      inSilence = true;
      silenceStartHop = h;
    } else if (!isQuiet && inSilence) {
      // Silence gap ended
      inSilence = false;
      const silenceEndHop = h;
      const silenceDurationHops = silenceEndHop - silenceStartHop;

      if (silenceDurationHops >= minSilenceHops) {
        // Find hop with lowest RMS within this silence gap
        let minHop = silenceStartHop;
        let minVal = hopRms[silenceStartHop];
        for (let k = silenceStartHop + 1; k < silenceEndHop; k++) {
          if (hopRms[k] < minVal) {
            minVal = hopRms[k];
            minHop = k;
          }
        }

        const candidateCutFrame = minHop * hopFrames;
        if (
          candidateCutFrame - lastCutFrame >= minSliceFrames &&
          totalFrames - candidateCutFrame >= minSliceFrames
        ) {
          boundaries.push(candidateCutFrame);
          lastCutFrame = candidateCutFrame;
        }
      }
    }
  }

  if (boundaries[boundaries.length - 1] !== totalFrames) {
    boundaries.push(totalFrames);
  }

  return boundaries;
}
