// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Fase 18: Audio Chopper & Multi-Layer Auto-Slicer Engine
//
// High-precision transient detection (SuperFlux with vibrato suppression + adaptive median thresholding),
// OpenVPI (slicer2) silence valley phrase segmentation for vocal tracks,
// configurable RMS silence gating, rising zero-crossing snapping,
// intelligent General MIDI Drum mapping & chromatic equidistant keybed distribution,
// and in-memory Standard MIDI File (.mid Type 0) pattern generator for DAW drag-and-drop.
// ─────────────────────────────────────────────────────────

import { clamp } from './DspMath.ts';
import { snapFrameToNearestZeroCrossing } from './LoopEditorTools.ts';
import { detectPitchYinMpm, hzToMidiAndCents } from './AcousticIntelligence.ts';

import { DEFAULT_SLICER_OPTIONS, midiNoteToString } from './audioSlicer/SlicerTypes.ts';
import type {
  SlicerMode,
  SlicerWorkflowMode,
  GridDivision,
  SlicerOptions,
  DetectedSlice,
  SlicerResult,
  NormalizePeakResult,
  ManualSilenceRange,
  MidiManifestSliceBuildOptions,
  PhonemeWord,
} from './audioSlicer/SlicerTypes.ts';
import { computeSpectralNoveltyCurve, computeAdaptiveMedianThreshold } from './audioSlicer/SlicerSpectral.ts';
import { sliceVocalPhrasesOpenVpi } from './audioSlicer/SlicerVocalOpenVpi.ts';
import { classifyDrumSlice, estimateLoopBpmAndBars, buildMidiFileBuffer } from './audioSlicer/SlicerDrumAndMidi.ts';
import { buildSlicesFromBoundaries, buildSlicesFromPhoneticWords } from './audioSlicer/SlicerBuild.ts';
import {
  detectSilenceIntervals,
  injectSilenceCutBoundaries,
  detectMelodicPitchChangeBoundaries,
  type SilenceInterval,
} from './audioSlicer/SlicerSilenceAndPitch.ts';
import { conformLoopToTargetBpm, type ConformedLoopResult } from './audioSlicer/SlicerConform.ts';
import { buildSlicesFromMidiManifest } from './audioSlicer/SlicerMidiManifest.ts';

// ── Public Re-exports for External Consumers ─────────────
export {
  DEFAULT_SLICER_OPTIONS,
  midiNoteToString,
  computeSpectralNoveltyCurve,
  computeAdaptiveMedianThreshold,
  sliceVocalPhrasesOpenVpi,
  classifyDrumSlice,
  estimateLoopBpmAndBars,
  buildMidiFileBuffer,
  buildSlicesFromBoundaries,
  buildSlicesFromPhoneticWords,
  detectSilenceIntervals,
  injectSilenceCutBoundaries,
  detectMelodicPitchChangeBoundaries,
  conformLoopToTargetBpm,
  buildSlicesFromMidiManifest,
};
export type {
  SlicerMode,
  SlicerWorkflowMode,
  GridDivision,
  SlicerOptions,
  DetectedSlice,
  SlicerResult,
  NormalizePeakResult,
  ManualSilenceRange,
  MidiManifestSliceBuildOptions,
  PhonemeWord,
  SilenceInterval,
  ConformedLoopResult,
};

/**
 * Automatically segments audio using SuperFlux (drums), OpenVPI Silence Valley (vocals), or Grid.
 */
export function sliceAudioBuffer(
  pcm: Float32Array,
  sampleRate: number,
  options: Partial<SlicerOptions> = {}
): SlicerResult {
  const opts: SlicerOptions = { ...DEFAULT_SLICER_OPTIONS, ...options };
  const totalFrames = pcm.length;

  if (totalFrames <= 128) {
    return buildSlicesFromBoundaries(pcm, sampleRate, [0, totalFrames], opts);
  }

  // Check if explicit phonetic words are supplied (Whisper alignment)
  if (opts.phoneticWords && opts.phoneticWords.length > 0) {
    return buildSlicesFromPhoneticWords(pcm, sampleRate, opts.phoneticWords, opts);
  }

  // 1. Vocals & Speech: OpenVPI Slicer algorithm (RMS silence gap + lowest energy valley)
  // Detection OFF skips silence-gap phrase splitting entirely: single active slice.
  if (opts.mode === 'vocals') {
    const vocalBoundaries =
      opts.detectSilences === false
        ? [0, totalFrames]
        : injectSilenceCutBoundaries(
            pcm,
            sampleRate,
            sliceVocalPhrasesOpenVpi(pcm, sampleRate, opts),
            opts
          );
    return buildSlicesFromBoundaries(pcm, sampleRate, vocalBoundaries, opts);
  }

  // 2. Grid Subdivision: Mathematical tempo subdivision
  if (opts.mode === 'grid') {
    const rawBoundaries: number[] = [0];
    const divisionFactors: Record<GridDivision, number> = {
      '1/4': 1,
      '1/8': 0.5,
      '1/16': 0.25,
      '1/32': 0.125,
    };
    const beatSec = (60 / Math.max(20, opts.bpm)) * divisionFactors[opts.gridDivision];
    const beatFrames = Math.max(64, Math.round(beatSec * sampleRate));

    let frame = beatFrames;
    while (frame < totalFrames - 64) {
      rawBoundaries.push(frame);
      frame += beatFrames;
    }
    rawBoundaries.push(totalFrames);
    return buildSlicesFromBoundaries(pcm, sampleRate, rawBoundaries, opts);
  }

  // 3. Drums & Chromatic: SuperFlux Transient Detection with Vibrato Suppression & Moving Median Threshold
  const rawBoundaries: number[] = [0];
  const hopSize = 256;
  const preRollFrames = Math.round((opts.preRollMs / 1000) * sampleRate);
  const minSliceGapSec = opts.minSliceMs ? opts.minSliceMs / 1000 : 0.045;
  const minDistanceFrames = Math.max(256, Math.round(minSliceGapSec * sampleRate));
  const minDistanceBins = Math.max(1, Math.floor(minDistanceFrames / hopSize));

  // Compute SuperFlux novelty curve with 2-bin vibrato suppression filter
  const novelty = computeSpectralNoveltyCurve(pcm, 1024, hopSize, 2);

  // Adaptive Moving Median Threshold (aubio / SuperFlux standard)
  const sensNorm = clamp(opts.sensitivity, 1, 100) / 100;
  // Sensitivity maps to adaptive multiplier (higher sensitivity -> lower multiplier)
  const medianMultiplier = 2.4 - sensNorm * 1.6;
  const adaptiveThreshold = computeAdaptiveMedianThreshold(novelty, 7, medianMultiplier, 0.015);

  let lastDetectedBin = -minDistanceBins;

  for (let i = 2; i < novelty.length - 2; i++) {
    const val = novelty[i];
    const thresh = adaptiveThreshold[i];

    if (
      val > thresh &&
      val > novelty[i - 1] &&
      val >= novelty[i + 1] &&
      i - lastDetectedBin >= minDistanceBins
    ) {
      const onsetFrame = i * hopSize;
      const candidateStart = Math.max(0, onsetFrame - preRollFrames);
      rawBoundaries.push(candidateStart);
      lastDetectedBin = i;
    }
  }

  rawBoundaries.push(totalFrames);

  // In Chromatic Groove / Melodic Phrase mode, also detect legato pitch-change boundaries
  if (opts.mode === 'chromatic' && opts.workflowMode !== 'one_shot_extractor') {
    const pitchBoundaries = detectMelodicPitchChangeBoundaries(
      pcm,
      sampleRate,
      rawBoundaries,
      minDistanceFrames
    );
    if (pitchBoundaries.length > 0) {
      rawBoundaries.push(...pitchBoundaries);
      rawBoundaries.sort((a, b) => a - b);
    }
  }

  const finalBoundaries = injectSilenceCutBoundaries(pcm, sampleRate, rawBoundaries, opts);
  return buildSlicesFromBoundaries(pcm, sampleRate, finalBoundaries, opts);
}

/**
 * Peak-normalizes a mono buffer to `targetDb` dBFS (default -1).
 * Pure: always returns a new buffer, never mutates the input.
 * Digital silence is returned unchanged with 0 dB applied.
 * Gain is capped at +48 dB to avoid amplifying near-silence into noise.
 */
export function normalizePeakPcm(pcm: Float32Array, targetDb: number = -1): NormalizePeakResult {
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.abs(pcm[i]);
    if (v > peak) peak = v;
  }
  const inputPeakDb = 20 * Math.log10(peak + 1e-9);
  if (!(peak > 1e-9)) {
    return { pcm: pcm.slice(), appliedGainDb: 0, inputPeakDb };
  }
  const wantedGainDb = targetDb - inputPeakDb;
  const appliedGainDb = Math.min(wantedGainDb, 48);
  const gain = Math.pow(10, appliedGainDb / 20);
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    out[i] = pcm[i] * gain;
  }
  return { pcm: out, appliedGainDb, inputPeakDb };
}

/**
 * Extracts all boundary points from an existing SlicerResult.
 */
export function extractBoundaryFrames(result: SlicerResult, totalFrames: number): number[] {
  if (result.slices.length === 0) return [0, totalFrames];
  const b = result.slices.map((s) => s.startFrame);
  const lastEnd = result.slices[result.slices.length - 1].endFrame;
  if (b[b.length - 1] !== lastEnd) b.push(lastEnd);
  return b;
}

/**
 * Merges manual cut boundaries with auto-detected boundaries.
 * Preserves all manual cut frames while allowing newly detected transients around them.
 */
export function mergeManualBoundariesWithAuto(
  autoBoundaries: number[],
  manualCutFrames: number[],
  totalFrames: number,
  minDistanceFrames: number = 64
): number[] {
  const result: number[] = [0];
  const sortedManual = Array.from(new Set(manualCutFrames))
    .filter((f) => f > 16 && f < totalFrames - 16)
    .sort((a, b) => a - b);

  // Filter out any auto boundary that is within minDistanceFrames of any manual cut
  const filteredAuto = autoBoundaries.filter((ab) => {
    if (ab <= 0 || ab >= totalFrames) return false;
    return !sortedManual.some((mf) => Math.abs(mf - ab) < minDistanceFrames);
  });

  const all = [...filteredAuto, ...sortedManual].sort((a, b) => a - b);
  for (const b of all) {
    if (b > result[result.length - 1] + 16 && b < totalFrames - 16) {
      result.push(b);
    }
  }
  result.push(totalFrames);
  return result;
}

/**
 * Recomputes audio slicing with new options while preserving user-defined manual cut boundaries
 * and manual silence states.
 */
export function sliceAudioBufferPreservingManualCuts(
  pcm: Float32Array,
  sampleRate: number,
  options: Partial<SlicerOptions> = {},
  manualCutFrames: number[] = [],
  manualSilenceRanges: ManualSilenceRange[] = []
): SlicerResult {
  const opts: SlicerOptions = { ...DEFAULT_SLICER_OPTIONS, ...options };
  const autoResult = sliceAudioBuffer(pcm, sampleRate, opts);
  if (manualCutFrames.length === 0 && manualSilenceRanges.length === 0) {
    return autoResult;
  }

  const autoBoundaries = extractBoundaryFrames(autoResult, pcm.length);
  const mergedBoundaries = mergeManualBoundariesWithAuto(autoBoundaries, manualCutFrames, pcm.length);

  // Build slices without auto zero-crossing snap so manual cuts are strictly preserved
  const mergedResult = buildSlicesFromBoundaries(pcm, sampleRate, mergedBoundaries, {
    ...opts,
    snapZeroCrossing: false,
  });

  // Re-apply manual silence ranges if any
  if (manualSilenceRanges.length > 0) {
    for (const sl of mergedResult.slices) {
      const mid = Math.round((sl.startFrame + sl.endFrame) / 2);
      const isManualSilence = manualSilenceRanges.some(
        (r) => (mid >= r.start && mid <= r.end) || (sl.startFrame >= r.start && sl.endFrame <= r.end)
      );
      if (isManualSilence) {
        sl.isSilence = true;
        sl.category = 'silence';
        sl.label = 'Silence (Manual)';
      }
    }
    const valid = mergedResult.slices.filter((s) => !s.isSilence);
    mergedResult.validSlicesCount = valid.length;
    mergedResult.silenceSlicesCount = mergedResult.slices.length - valid.length;
    mergedResult.midiFileBuffer = buildMidiFileBuffer(valid, opts.bpm);
  }

  return mergedResult;
}

/**
 * Moves an existing slice boundary (index 1..N-1) to a new sample frame.
 */
export function moveSliceBoundary(
  result: SlicerResult,
  pcm: Float32Array,
  sampleRate: number,
  boundaryIndex: number,
  newFrame: number,
  snap0X: boolean = false,
  options: Partial<SlicerOptions> = {}
): SlicerResult {
  const boundaries = extractBoundaryFrames(result, pcm.length);
  if (boundaryIndex <= 0 || boundaryIndex >= boundaries.length - 1) {
    return result;
  }

  const prev = boundaries[boundaryIndex - 1];
  const next = boundaries[boundaryIndex + 1];
  let target = clamp(Math.round(newFrame), prev + 16, next - 16);
  if (snap0X) {
    target = snapFrameToNearestZeroCrossing(pcm, target, 128);
    target = clamp(target, prev + 8, next - 8);
  }

  boundaries[boundaryIndex] = target;
  // Crucial: snapZeroCrossing: false prevents buildSlicesFromBoundaries from erasing manual nudge!
  return buildSlicesFromBoundaries(pcm, sampleRate, boundaries, {
    ...options,
    snapZeroCrossing: false,
  });
}

/**
 * Splits a slice at a given sample frame position.
 */
export function splitSliceAtFrame(
  result: SlicerResult,
  pcm: Float32Array,
  sampleRate: number,
  targetFrame: number,
  snap0X: boolean = true,
  options: Partial<SlicerOptions> = {}
): SlicerResult {
  const boundaries = extractBoundaryFrames(result, pcm.length);
  let frame = clamp(Math.round(targetFrame), 32, pcm.length - 32);
  if (snap0X) {
    frame = snapFrameToNearestZeroCrossing(pcm, frame, 128);
    frame = clamp(frame, 32, pcm.length - 32);
  }

  // Avoid creating a slice that's too close to an existing boundary
  const tooClose = boundaries.some((b) => Math.abs(b - frame) < 32);
  if (tooClose) return result;

  boundaries.push(frame);
  boundaries.sort((a, b) => a - b);
  return buildSlicesFromBoundaries(pcm, sampleRate, boundaries, {
    ...options,
    snapZeroCrossing: false,
  });
}

/**
 * Deletes a slice and merges its duration with adjacent slice.
 */
export function deleteSlice(
  result: SlicerResult,
  pcm: Float32Array,
  sampleRate: number,
  sliceId: string,
  options: Partial<SlicerOptions> = {}
): SlicerResult {
  const sliceIdx = result.slices.findIndex((s) => s.id === sliceId);
  if (sliceIdx < 0 || result.slices.length <= 1) return result;

  const boundaries = extractBoundaryFrames(result, pcm.length);
  const boundaryToRemove = sliceIdx === 0 ? 1 : sliceIdx;
  if (boundaryToRemove > 0 && boundaryToRemove < boundaries.length - 1) {
    boundaries.splice(boundaryToRemove, 1);
  }
  return buildSlicesFromBoundaries(pcm, sampleRate, boundaries, {
    ...options,
    snapZeroCrossing: false,
  });
}

/**
 * Toggles a slice between silence and active, recomputing counts and MIDI sequence.
 */
export function toggleSliceSilence(
  result: SlicerResult,
  sliceId: string,
  sampleRate: number,
  options: Partial<SlicerOptions> = {}
): SlicerResult {
  const opts: SlicerOptions = { ...DEFAULT_SLICER_OPTIONS, ...options };
  const target = result.slices.find((s) => s.id === sliceId);
  if (!target) return result;

  const newIsSilence = !target.isSilence;
  target.isSilence = newIsSilence;

  if (newIsSilence) {
    target.label = `Silence (Manual)`;
    target.category = 'silence';
  } else {
    // Restore classification
    if (opts.mode === 'drums') {
      const drumClass = classifyDrumSlice(target.pcm, sampleRate);
      target.rootKey = drumClass.note;
      target.lowKey = drumClass.note;
      target.highKey = drumClass.note;
      target.category = drumClass.category;
      target.label = drumClass.label;
    } else if (opts.mode === 'chromatic') {
      const pitch = detectPitchYinMpm(target.pcm, sampleRate);
      target.f0Hz = Math.round(pitch.f0Hz * 10) / 10;
      const { midiNote } = hzToMidiAndCents(pitch.f0Hz);
      target.rootKey = midiNote;
      target.label = `${midiNoteToString(midiNote)} (${target.f0Hz} Hz)`;
      target.category = 'chromatic';
    } else if (opts.mode === 'vocals') {
      target.category = 'vocals';
      target.label = `Vocal Phrase #${target.index} (${(target.durationSec * 1000).toFixed(0)} ms)`;
    } else {
      target.category = 'grid';
      target.label = `Slice #${target.index} [Grid]`;
    }
  }

  const validSlices = result.slices.filter((s) => !s.isSilence);
  const midiBuffer = buildMidiFileBuffer(validSlices, opts.bpm);

  return {
    ...result,
    validSlicesCount: validSlices.length,
    silenceSlicesCount: result.slices.length - validSlices.length,
    midiFileBuffer: midiBuffer,
  };
}
