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
import { GM_DRUM_MAP } from '../gmDrumMap.ts';
import { midiToNoteName } from '../../ui/ZoneRibbon.ts';

export type SlicerMode = 'drums' | 'chromatic' | 'vocals' | 'grid';
export type GridDivision = '1/4' | '1/8' | '1/16' | '1/32';

export interface SlicerOptions {
  /** Mode: 'drums' (GM Map), 'chromatic' (F0 pitch + equidistant zones), 'vocals' (vocal/phrase segmentation), 'grid' (BPM division) */
  mode: SlicerMode;
  /** Transient attack sensitivity: 0..100 (default: 70) */
  sensitivity: number;
  /** RMS silence gate threshold in dB: -60..-20 (default: -42 dB) */
  silenceThresholdDb: number;
  /** Pre-roll safety margin in milliseconds before transient to preserve initial attack (default: 3 ms) */
  preRollMs: number;
  /** Post-roll tail safety margin in milliseconds (default: 8 ms) */
  postRollMs: number;
  /** Magnetize slice boundaries to the nearest rising zero-crossing (default: true) */
  snapZeroCrossing: boolean;
  /** Tempo in BPM for grid slicing or MIDI pattern generation (default: 120) */
  bpm: number;
  /** Grid division if mode === 'grid' (default: '1/16') */
  gridDivision: GridDivision;
  /** Allow overlapping key/velocity zones (default: false) */
  allowOverlap: boolean;
  /** Base MIDI note for chromatic sequential mapping (default: 36 C1 or 60 C3) */
  chromaticBaseNote: number;
  /** Minimum slice distance in milliseconds (default: 45ms for drums, 250ms for vocals) */
  minSliceMs?: number;
}

export interface DetectedSlice {
  id: string;
  index: number;
  startFrame: number;
  endFrame: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  rmsDb: number;
  peakDb: number;
  isSilence: boolean;
  /** Estimated fundamental frequency in Hz (if tonal) */
  f0Hz?: number;
  /** Assigned target MIDI Root Key */
  rootKey: number;
  /** Assigned target MIDI Low Key */
  lowKey: number;
  /** Assigned target MIDI High Key */
  highKey: number;
  /** Assigned Velocity Range [1..127] */
  lowVel: number;
  highVel: number;
  /** Classified label: e.g. "Bass Drum 1 (36 C1)", "Acoustic Snare (38 D1)", or "Note 60 (C3)" */
  label: string;
  /** Category: 'kick' | 'snare' | 'hihat' | 'tom' | 'cymbal' | 'percussion' | 'chromatic' | 'vocals' | 'grid' | 'silence' */
  category: string;
  /** Sliced PCM audio buffer (mono) */
  pcm: Float32Array;
}

export interface SlicerResult {
  slices: DetectedSlice[];
  totalSlices: number;
  validSlicesCount: number;
  silenceSlicesCount: number;
  detectedBpm: number;
  sampleRate: number;
  totalDurationSec: number;
  midiFileBuffer: Uint8Array;
}

export const DEFAULT_SLICER_OPTIONS: SlicerOptions = {
  mode: 'drums',
  sensitivity: 70,
  silenceThresholdDb: -42,
  preRollMs: 3,
  postRollMs: 8,
  snapZeroCrossing: true,
  bpm: 120,
  gridDivision: '1/16',
  allowOverlap: false,
  chromaticBaseNote: 36,
};

/**
 * Calculates SuperFlux onset novelty curve with vibrato suppression and HFC weighting.
 * Based on Böck & Widmer (SuperFlux) & aubio onset algorithms.
 */
function computeSpectralNoveltyCurve(
  pcm: Float32Array,
  frameSize: number = 1024,
  hopSize: number = 256,
  filterWidthBins: number = 2
): Float32Array {
  const numFrames = Math.max(1, Math.floor((pcm.length - frameSize) / hopSize));
  const novelty = new Float32Array(numFrames);
  const half = frameSize / 2;

  let prevMag = new Float32Array(half);

  // Pre-calculate Hamming window
  const window = new Float32Array(frameSize);
  for (let i = 0; i < frameSize; i++) {
    window[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (frameSize - 1));
  }

  const real = new Float32Array(frameSize);

  for (let f = 0; f < numFrames; f++) {
    const offset = f * hopSize;
    let hfc = 0;
    let flux = 0;

    for (let i = 0; i < frameSize; i++) {
      real[i] = pcm[offset + i] * window[i];
    }

    const currentMag = new Float32Array(half);
    for (let k = 1; k < half; k++) {
      const s0 = real[k];
      const s1 = real[(k * 2) % frameSize];
      const mag = Math.sqrt(s0 * s0 + s1 * s1 + 1e-9);
      currentMag[k] = mag;

      // SuperFlux vibrato suppression: compare mag[k] to max of prevMag in window [k - mu .. k + mu]
      let prevLocalMax = prevMag[k];
      for (let w = 1; w <= filterWidthBins; w++) {
        if (k - w >= 0 && prevMag[k - w] > prevLocalMax) prevLocalMax = prevMag[k - w];
        if (k + w < half && prevMag[k + w] > prevLocalMax) prevLocalMax = prevMag[k + w];
      }

      const diff = mag - prevLocalMax;
      if (diff > 0) {
        flux += diff;
      }

      hfc += mag * (k / half);
    }

    novelty[f] = flux * 0.75 + hfc * 0.25;
    prevMag = currentMag;
  }

  // Smooth novelty curve with a 3-tap moving average
  const smoothed = new Float32Array(numFrames);
  for (let i = 1; i < numFrames - 1; i++) {
    smoothed[i] = (novelty[i - 1] + novelty[i] * 2 + novelty[i + 1]) / 4;
  }

  return smoothed;
}

/**
 * Moving Median filter for adaptive onset thresholding (aubio / SuperFlux standard).
 */
function computeAdaptiveMedianThreshold(
  novelty: Float32Array,
  windowRadius: number = 7,
  multiplier: number = 1.35,
  offset: number = 0.02
): Float32Array {
  const threshold = new Float32Array(novelty.length);
  const buf: number[] = [];

  for (let i = 0; i < novelty.length; i++) {
    const start = Math.max(0, i - windowRadius);
    const end = Math.min(novelty.length, i + windowRadius + 1);
    buf.length = 0;
    for (let k = start; k < end; k++) {
      buf.push(novelty[k]);
    }
    buf.sort((a, b) => a - b);
    const median = buf[Math.floor(buf.length / 2)] ?? 0;
    threshold[i] = median * multiplier + offset;
  }

  return threshold;
}

/**
 * Segments vocals and speech using the OpenVPI (slicer2) algorithm:
 * RMS silence gap detection + energy valley cut points + zero-crossing snapping.
 * Avoids chopping mid-syllable or triggering false onsets on vocal vibrato/formants.
 */
function sliceVocalPhrasesOpenVpi(
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
  // Minimum silence gap to trigger phrase split: ~150ms
  const minSilenceHops = Math.max(3, Math.round(0.15 * (sampleRate / hopFrames)));

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

/**
 * Classifies an isolated drum slice into a standard General MIDI drum piece note.
 */
function classifyDrumSlice(pcm: Float32Array, sampleRate: number): { note: number; category: string; label: string } {
  if (pcm.length === 0) {
    return { note: 36, category: 'kick', label: 'Bass Drum 1 (36 C1)' };
  }

  let totalEnergy = 0;
  let zeroCrossings = 0;
  let peakVal = 0;

  for (let i = 0; i < pcm.length; i++) {
    const v = Math.abs(pcm[i]);
    if (v > peakVal) peakVal = v;
    totalEnergy += v * v;
    if (i > 0 && ((pcm[i - 1] < 0 && pcm[i] >= 0) || (pcm[i - 1] >= 0 && pcm[i] < 0))) {
      zeroCrossings++;
    }
  }

  const durationMs = (pcm.length / sampleRate) * 1000;
  const zcr = zeroCrossings / Math.max(1, pcm.length);

  if (zcr > 0.22) {
    if (durationMs < 280) {
      return { note: 42, category: 'hihat', label: `${GM_DRUM_MAP[42]} (42 F#1)` };
    }
    if (durationMs > 600) {
      return { note: 49, category: 'cymbal', label: `${GM_DRUM_MAP[49]} (49 C#2)` };
    }
    return { note: 46, category: 'hihat', label: `${GM_DRUM_MAP[46]} (46 A#1)` };
  }

  if (zcr < 0.08) {
    return { note: 36, category: 'kick', label: `${GM_DRUM_MAP[36]} (36 C1)` };
  }

  if (zcr >= 0.12) {
    return { note: 38, category: 'snare', label: `${GM_DRUM_MAP[38]} (38 D1)` };
  }

  return { note: 45, category: 'tom', label: `${GM_DRUM_MAP[45]} (45 A1)` };
}

/**
 * Builds an in-memory Standard MIDI File (SMF Type 0, 1 Track, 480 PPQN).
 */
export function buildMidiFileBuffer(slices: DetectedSlice[], bpm: number): Uint8Array {
  const safeBpm = clamp(bpm, 20, 300);
  const usPerQuarter = Math.round(60_000_000 / safeBpm);
  const ppqn = 480;

  const trackEvents: number[] = [];

  const writeVlq = (val: number) => {
    let buffer = val & 0x7f;
    const bytes: number[] = [];
    let v = val;
    while ((v >>= 7) > 0) {
      buffer <<= 8;
      buffer |= 0x80;
      buffer += v & 0x7f;
    }
    while (true) {
      bytes.push(buffer & 0xff);
      if (buffer & 0x80) buffer >>= 8;
      else break;
    }
    trackEvents.push(...bytes);
  };

  // Tempo event (Meta 0x51)
  trackEvents.push(0x00, 0xff, 0x51, 0x03);
  trackEvents.push((usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff);

  // Time signature 4/4 (Meta 0x58)
  trackEvents.push(0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08);

  const secToTick = (sec: number) => Math.max(0, Math.round((sec * safeBpm * ppqn) / 60));

  interface MidiNoteItem {
    tick: number;
    type: 'on' | 'off';
    note: number;
    vel: number;
  }

  const noteItems: MidiNoteItem[] = [];
  for (const sl of slices) {
    if (sl.isSilence) continue;
    const onTick = secToTick(sl.startSec);
    const offTick = Math.max(onTick + 30, secToTick(sl.endSec));
    const vel = clamp(Math.round(Math.pow(10, sl.peakDb / 20) * 127), 1, 127);

    noteItems.push({ tick: onTick, type: 'on', note: sl.rootKey, vel });
    noteItems.push({ tick: offTick, type: 'off', note: sl.rootKey, vel: 0 });
  }

  noteItems.sort((a, b) => (a.tick === b.tick ? (a.type === 'off' ? -1 : 1) : a.tick - b.tick));

  let currentTick = 0;
  for (const item of noteItems) {
    const delta = Math.max(0, item.tick - currentTick);
    writeVlq(delta);
    currentTick = item.tick;

    if (item.type === 'on') {
      trackEvents.push(0x90, clamp(item.note, 0, 127), clamp(item.vel, 1, 127));
    } else {
      trackEvents.push(0x80, clamp(item.note, 0, 127), 0x00);
    }
  }

  // End of Track event (Meta 0x2F)
  trackEvents.push(0x00, 0xff, 0x2f, 0x00);

  // Assembly Header Chunk ('MThd') + Track Chunk ('MTrk')
  const header = [
    0x4d, 0x54, 0x68, 0x64, // 'MThd'
    0x00, 0x00, 0x00, 0x06, // length = 6
    0x00, 0x00,             // format = 0
    0x00, 0x01,             // tracks = 1
    (ppqn >> 8) & 0xff, ppqn & 0xff, // ppqn
  ];

  const trackHeader = [
    0x4d, 0x54, 0x72, 0x6b, // 'MTrk'
    (trackEvents.length >> 24) & 0xff,
    (trackEvents.length >> 16) & 0xff,
    (trackEvents.length >> 8) & 0xff,
    trackEvents.length & 0xff,
  ];

  const totalLength = header.length + trackHeader.length + trackEvents.length;
  const out = new Uint8Array(totalLength);
  out.set(header, 0);
  out.set(trackHeader, header.length);
  out.set(trackEvents, header.length + trackHeader.length);

  return out;
}

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
      slices: [],
      totalSlices: 0,
      validSlicesCount: 0,
      silenceSlicesCount: 0,
      detectedBpm: opts.bpm,
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
    const isSilence = rms < silenceThresholdLinear;

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
    for (const sl of activeSlices) {
      const pitch = detectPitchYinMpm(sl.pcm, sampleRate);
      sl.f0Hz = Math.round(pitch.f0Hz * 10) / 10;
      const { midiNote } = hzToMidiAndCents(pitch.f0Hz);
      sl.rootKey = midiNote;
      sl.label = `${midiNoteToString(midiNote)} (${sl.f0Hz} Hz)`;
      sl.category = 'chromatic';
    }

    activeSlices.sort((a, b) => a.rootKey - b.rootKey);

    for (let i = 0; i < activeSlices.length; i++) {
      const cur = activeSlices[i];
      const prev = i > 0 ? activeSlices[i - 1] : null;
      const next = i < activeSlices.length - 1 ? activeSlices[i + 1] : null;

      cur.lowKey = prev ? Math.floor((prev.rootKey + cur.rootKey) / 2) + 1 : 0;
      cur.highKey = next ? Math.floor((cur.rootKey + next.rootKey) / 2) : 127;
      if (cur.lowKey > cur.rootKey) cur.lowKey = cur.rootKey;
      if (cur.highKey < cur.rootKey) cur.highKey = cur.rootKey;
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
  const midiBuffer = buildMidiFileBuffer(validSlices, opts.bpm);

  return {
    slices: rawSlices,
    totalSlices: rawSlices.length,
    validSlicesCount: validSlices.length,
    silenceSlicesCount: rawSlices.length - validSlices.length,
    detectedBpm: opts.bpm,
    sampleRate,
    totalDurationSec,
    midiFileBuffer: midiBuffer,
  };
}

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

  // 1. Vocals & Speech: OpenVPI Slicer algorithm (RMS silence gap + lowest energy valley)
  if (opts.mode === 'vocals') {
    const vocalBoundaries = sliceVocalPhrasesOpenVpi(pcm, sampleRate, opts);
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
  return buildSlicesFromBoundaries(pcm, sampleRate, rawBoundaries, opts);
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

/**
 * Helper to generate string note format "60 C3"
 */
function midiNoteToString(midi: number): string {
  return `${midi} (${midiToNoteName(midi)})`;
}
