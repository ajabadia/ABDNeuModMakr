// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Core Slice Construction & Phonetic Word Alignment
// ─────────────────────────────────────────────────────────

import { clamp } from '../DspMath.ts';
import { snapFrameToNearestZeroCrossing } from '../LoopEditorTools.ts';
import { detectPitchYinMpm, hzToMidiAndCents } from '../AcousticIntelligence.ts';
import { classifyDrumSlice, estimateLoopBpmAndBars, buildMidiFileBuffer } from './SlicerDrumAndMidi.ts';
import { DEFAULT_SLICER_OPTIONS, midiNoteToString } from './SlicerTypes.ts';
import type { SlicerOptions, DetectedSlice, SlicerResult } from './SlicerTypes.ts';

/**
 * Core Slicing Engine: builds slices from a list of boundary frames,
 * classifying slices, micro-fading edges, and computing zone distributions.
 */
export function buildSlicesFromBoundaries(
  pcm: Float32Array,
  sampleRate: number,
  boundaries: number[],
  options: Partial<SlicerOptions> = {}
): SlicerResult {
  const opts: SlicerOptions = { ...DEFAULT_SLICER_OPTIONS, ...options };
  const totalFrames = pcm.length;
  const totalDurationSec = totalFrames / Math.max(1, sampleRate);

  if (totalFrames <= 128) {
    return {
      workflowMode: opts.workflowMode ?? 'rex_groove_loop',
      slices: [],
      totalSlices: 0,
      validSlicesCount: 0,
      silenceSlicesCount: 0,
      detectedBpm: opts.bpm,
      detectedBars: opts.barCount ?? 1,
      bpmConfidence: 0,
      targetBpm: opts.targetBpm ?? opts.bpm,
      sampleRate,
      totalDurationSec,
      midiFileBuffer: new Uint8Array(0),
    };
  }

  // Magnetize boundaries to Zero Crossing if requested
  const snappedBoundaries = boundaries.map((pos, idx) => {
    if (!opts.snapZeroCrossing || idx === 0 || idx === boundaries.length - 1) {
      return clamp(Math.round(pos), 0, totalFrames);
    }
    return snapFrameToNearestZeroCrossing(pcm, pos, 128);
  });

  // Filter duplicated or too-close boundaries (< 64 frames)
  const cleanBoundaries: number[] = [];
  for (const b of snappedBoundaries) {
    if (cleanBoundaries.length === 0 || b - cleanBoundaries[cleanBoundaries.length - 1] >= 64) {
      cleanBoundaries.push(b);
    }
  }
  if (cleanBoundaries.length === 0 || cleanBoundaries[0] !== 0) {
    cleanBoundaries.unshift(0);
  }
  if (cleanBoundaries[cleanBoundaries.length - 1] !== totalFrames) {
    cleanBoundaries.push(totalFrames);
  }

  // Build raw slices
  const rawSlices: DetectedSlice[] = [];
  const silenceThresholdLinear = Math.pow(10, opts.silenceThresholdDb / 20);

  for (let i = 0; i < cleanBoundaries.length - 1; i++) {
    const startFrame = cleanBoundaries[i];
    const endFrame = cleanBoundaries[i + 1];
    const slicePcm = pcm.subarray(startFrame, endFrame);
    const durationSec = (endFrame - startFrame) / sampleRate;

    // Calculate RMS and Peak dB
    let sumSq = 0;
    let peak = 0;
    for (let k = 0; k < slicePcm.length; k++) {
      const v = Math.abs(slicePcm[k]);
      if (v > peak) peak = v;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / Math.max(1, slicePcm.length));
    const rmsDb = 20 * Math.log10(rms + 1e-9);
    const peakDb = 20 * Math.log10(peak + 1e-9);
    const detectSilences = opts.detectSilences !== false;
    const minSilenceMs = opts.minSilenceMs ?? 120;
    // Compute interior RMS (excluding up to 128 boundary zero-crossing snap samples)
    // so edge snap jitter never prevents a cut silence region from being muted.
    let gateRms = rms;
    const edgeMargin = Math.min(128, Math.floor(slicePcm.length / 6));
    if (edgeMargin > 0 && slicePcm.length - edgeMargin * 2 >= 64) {
      let innerSumSq = 0;
      const innerLen = slicePcm.length - edgeMargin * 2;
      for (let k = edgeMargin; k < slicePcm.length - edgeMargin; k++) {
        const v = slicePcm[k];
        innerSumSq += v * v;
      }
      gateRms = Math.min(rms, Math.sqrt(innerSumSq / innerLen));
    }
    const minSilenceDurationMs = Math.max(0, minSilenceMs - 12);
    const isSilence =
      detectSilences &&
      gateRms < silenceThresholdLinear * 1.02 &&
      durationSec * 1000 >= minSilenceDurationMs;

    // Apply micro-fade (1ms) to eliminate edge clicks
    const fadeFrames = Math.min(Math.floor(slicePcm.length / 2), Math.round(0.001 * sampleRate));
    const cleanPcm = new Float32Array(slicePcm.length);
    cleanPcm.set(slicePcm);
    for (let f = 0; f < fadeFrames; f++) {
      const gIn = f / fadeFrames;
      const gOut = (fadeFrames - 1 - f) / fadeFrames;
      cleanPcm[f] *= gIn;
      cleanPcm[cleanPcm.length - 1 - f] *= gOut;
    }

    rawSlices.push({
      id: `slice_${i + 1}`,
      index: i + 1,
      startFrame,
      endFrame,
      startSec: startFrame / sampleRate,
      endSec: endFrame / sampleRate,
      durationSec,
      rmsDb: Math.round(rmsDb * 10) / 10,
      peakDb: Math.round(peakDb * 10) / 10,
      isSilence,
      rootKey: 60,
      lowKey: 60,
      highKey: 60,
      lowVel: 1,
      highVel: 127,
      label: `Slice #${i + 1}`,
      category: 'percussion',
      pcm: cleanPcm,
    });
  }

  // Assign Key & Velocity Mappings based on Mode
  if (opts.mode === 'drums') {
    for (const sl of rawSlices) {
      if (sl.isSilence) {
        sl.label = `Silence (${sl.rmsDb} dB)`;
        sl.category = 'silence';
        continue;
      }
      const drumClass = classifyDrumSlice(sl.pcm, sampleRate);
      sl.rootKey = drumClass.note;
      sl.lowKey = drumClass.note;
      sl.highKey = drumClass.note;
      sl.category = drumClass.category;
      sl.label = drumClass.label;
    }

    const slicesByNote = new Map<number, DetectedSlice[]>();
    for (const sl of rawSlices) {
      if (sl.isSilence) continue;
      const list = slicesByNote.get(sl.rootKey) ?? [];
      list.push(sl);
      slicesByNote.set(sl.rootKey, list);
    }

    for (const [, list] of slicesByNote) {
      if (list.length > 1) {
        list.sort((a, b) => a.rmsDb - b.rmsDb);
        const layers = list.length;
        const span = 127 / layers;
        list.forEach((sl, idx) => {
          sl.lowVel = Math.round(idx * span) + 1;
          sl.highVel = idx === layers - 1 ? 127 : Math.round((idx + 1) * span);
        });
      }
    }
  } else if (opts.mode === 'chromatic') {
    const activeSlices = rawSlices.filter((s) => !s.isSilence);
    const byUniquePitch = new Map<number, DetectedSlice[]>();

    for (const sl of activeSlices) {
      const pitch = detectPitchYinMpm(sl.pcm, sampleRate);
      sl.f0Hz = Math.round(pitch.f0Hz * 10) / 10;
      const { midiNote, centOffset } = hzToMidiAndCents(pitch.f0Hz);
      sl.rootKey = midiNote;
      sl.detuneCents = Math.round(-centOffset);
      sl.label = `${midiNoteToString(midiNote)} (${sl.f0Hz} Hz)`;
      sl.category = 'chromatic';
      const list = byUniquePitch.get(midiNote) ?? [];
      list.push(sl);
      byUniquePitch.set(midiNote, list);
    }

    // Compute contiguous lowKey..highKey spans across UNIQUE detected pitches
    // so melodic phrases with repeated notes (e.g. C4, E4, G4, C4) never collide!
    const uniqueKeys = Array.from(byUniquePitch.keys()).sort((a, b) => a - b);
    for (let i = 0; i < uniqueKeys.length; i++) {
      const key = uniqueKeys[i];
      const prevKey = i > 0 ? uniqueKeys[i - 1] : null;
      const nextKey = i < uniqueKeys.length - 1 ? uniqueKeys[i + 1] : null;

      let lowKey = prevKey !== null ? Math.floor((prevKey + key) / 2) + 1 : 0;
      let highKey = nextKey !== null ? Math.floor((key + nextKey) / 2) : 127;
      if (lowKey > key) lowKey = key;
      if (highKey < key) highKey = key;

      const list = byUniquePitch.get(key)!;
      if (list.length > 1) {
        // Multiple notes in the melody played the same pitch -> stack as velocity layers
        const sortedByVel = [...list].sort((a, b) => a.rmsDb - b.rmsDb);
        const span = 127 / sortedByVel.length;
        sortedByVel.forEach((sl, idx) => {
          sl.lowKey = lowKey;
          sl.highKey = highKey;
          sl.lowVel = Math.round(idx * span) + 1;
          sl.highVel = idx === sortedByVel.length - 1 ? 127 : Math.round((idx + 1) * span);
          sl.roundRobinIndex = idx + 1;
        });
      } else {
        list[0].lowKey = lowKey;
        list[0].highKey = highKey;
        list[0].lowVel = 1;
        list[0].highVel = 127;
      }
    }
  } else if (opts.mode === 'vocals') {
    let curNote = clamp(opts.chromaticBaseNote || 48, 0, 127);
    for (const sl of rawSlices) {
      if (sl.isSilence) {
        sl.label = `Silence (${sl.rmsDb} dB)`;
        sl.category = 'silence';
        continue;
      }
      const pitch = detectPitchYinMpm(sl.pcm, sampleRate);
      if (pitch.harmonicity > 0.55 && pitch.f0Hz > 60 && pitch.f0Hz < 1500) {
        sl.f0Hz = Math.round(pitch.f0Hz * 10) / 10;
        const { midiNote } = hzToMidiAndCents(pitch.f0Hz);
        sl.rootKey = midiNote;
        sl.lowKey = midiNote;
        sl.highKey = midiNote;
        sl.label = `Vocal [${midiNoteToString(midiNote)}] (${(sl.durationSec * 1000).toFixed(0)} ms)`;
      } else {
        sl.rootKey = curNote;
        sl.lowKey = curNote;
        sl.highKey = curNote;
        sl.label = `Vocal Phrase #${sl.index} (${(sl.durationSec * 1000).toFixed(0)} ms)`;
        curNote = Math.min(127, curNote + 1);
      }
      sl.category = 'vocals';
    }
  } else {
    // Grid: sequential chromatic assignment from base note
    let curNote = clamp(opts.chromaticBaseNote, 0, 127);
    for (const sl of rawSlices) {
      if (sl.isSilence) continue;
      sl.rootKey = curNote;
      sl.lowKey = curNote;
      sl.highKey = curNote;
      sl.label = `${midiNoteToString(curNote)} [Grid Beat]`;
      sl.category = 'grid';
      curNote = Math.min(127, curNote + 1);
    }
  }

  const validSlices = rawSlices.filter((s) => !s.isSilence);
  const tempoEst =
    opts.mode === 'grid'
      ? {
          detectedBpm: clamp(opts.bpm || 120, 20, 300),
          detectedBars: opts.barCount ?? Math.max(1, Math.round((totalDurationSec * (opts.bpm / 60)) / 4)),
          confidence: 1,
        }
      : estimateLoopBpmAndBars(pcm, sampleRate, rawSlices, opts.bpm);

  const effectiveSourceBpm = tempoEst.detectedBpm;
  const effectiveTargetBpm =
    opts.targetBpm && opts.targetBpm > 0 ? clamp(opts.targetBpm, 20, 300) : effectiveSourceBpm;
  const effectiveBars = opts.barCount && opts.barCount > 0 ? opts.barCount : tempoEst.detectedBars;
  const midiBuffer = buildMidiFileBuffer(validSlices, effectiveSourceBpm, effectiveTargetBpm);

  return {
    workflowMode: opts.workflowMode ?? 'rex_groove_loop',
    slices: rawSlices,
    totalSlices: rawSlices.length,
    validSlicesCount: validSlices.length,
    silenceSlicesCount: rawSlices.length - validSlices.length,
    detectedBpm: effectiveSourceBpm,
    detectedBars: effectiveBars,
    bpmConfidence: tempoEst.confidence,
    targetBpm: effectiveTargetBpm,
    sampleRate,
    totalDurationSec,
    midiFileBuffer: midiBuffer,
  };
}

/**
 * Constructs slices directly from aligned phonetic words (e.g. from Whisper-tiny).
 * Labels slices with the recognized syllables/words and distributes across the keybed.
 */
export function buildSlicesFromPhoneticWords(
  pcm: Float32Array,
  sampleRate: number,
  words: Array<{ word: string; startFrame: number; endFrame: number; confidence?: number }>,
  options: Partial<SlicerOptions> = {}
): SlicerResult {
  const opts: SlicerOptions = { ...DEFAULT_SLICER_OPTIONS, ...options, mode: 'vocals' };
  const totalFrames = pcm.length;

  if (!words || words.length === 0) {
    return buildSlicesFromBoundaries(pcm, sampleRate, [0, totalFrames], opts);
  }

  // Ensure boundaries cover the entire file without gaps
  const sortedWords = [...words].sort((a, b) => a.startFrame - b.startFrame);
  const boundaries: number[] = [0];

  for (const w of sortedWords) {
    const s = clamp(Math.round(w.startFrame), 0, totalFrames);
    const e = clamp(Math.round(w.endFrame), 0, totalFrames);
    if (s > boundaries[boundaries.length - 1]) boundaries.push(s);
    if (e > boundaries[boundaries.length - 1]) boundaries.push(e);
  }
  if (boundaries[boundaries.length - 1] < totalFrames) {
    boundaries.push(totalFrames);
  }

  // Use base slice builder for RMS, peak, zero-crossing and audio slicing
  const baseResult = buildSlicesFromBoundaries(pcm, sampleRate, boundaries, opts);

  // Overlay phonetic words as labels
  let curNote = clamp(opts.chromaticBaseNote || 48, 0, 127);
  for (let i = 0; i < baseResult.slices.length; i++) {
    const sl = baseResult.slices[i];
    if (sl.isSilence) continue;

    // Match slice to word that overlaps its midpoint
    const midFrame = (sl.startFrame + sl.endFrame) / 2;
    const matchingWord = sortedWords.find((w) => midFrame >= w.startFrame && midFrame <= w.endFrame);

    if (matchingWord) {
      sl.label = `Vocal: "${matchingWord.word}" (${(sl.durationSec * 1000).toFixed(0)} ms)`;
      sl.category = 'vocals';
    } else {
      sl.label = `Vocal Phrase #${sl.index} (${(sl.durationSec * 1000).toFixed(0)} ms)`;
      sl.category = 'vocals';
    }

    sl.rootKey = curNote;
    sl.lowKey = curNote;
    sl.highKey = curNote;
    curNote = Math.min(127, curNote + 1);
  }

  return baseResult;
}
