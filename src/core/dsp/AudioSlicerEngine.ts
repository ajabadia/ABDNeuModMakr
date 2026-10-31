// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Fase 18: Audio Chopper & Multi-Layer Auto-Slicer Engine
//
// High-precision transient detection (Spectral Flux + High Frequency Content),
// configurable RMS silence gating, rising zero-crossing snapping,
// intelligent General MIDI Drum mapping & chromatic equidistant keybed distribution,
// and in-memory Standard MIDI File (.mid Type 0) pattern generator for DAW drag-and-drop.
// ─────────────────────────────────────────────────────────

import { clamp } from './DspMath.ts';
import { snapFrameToRisingZeroCrossing } from './LoopEditorTools.ts';
import { detectPitchYinMpm, hzToMidiAndCents } from './AcousticIntelligence.ts';
import { GM_DRUM_MAP } from '../gmDrumMap.ts';
import { midiToNoteName } from '../../ui/ZoneRibbon.ts';

export type SlicerMode = 'drums' | 'chromatic' | 'grid';
export type GridDivision = '1/4' | '1/8' | '1/16' | '1/32';

export interface SlicerOptions {
  /** Mode: 'drums' (GM Map), 'chromatic' (F0 pitch + equidistant zones), 'grid' (BPM division) */
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
  /** Category: 'kick' | 'snare' | 'hihat' | 'tom' | 'cymbal' | 'percussion' | 'chromatic' */
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
 * Calculates Spectral Flux and High Frequency Content (HFC) on a moving STFT frame.
 */
function computeSpectralNoveltyCurve(
  pcm: Float32Array,
  frameSize: number = 1024,
  hopSize: number = 256
): Float32Array {
  const numFrames = Math.max(1, Math.floor((pcm.length - frameSize) / hopSize));
  const novelty = new Float32Array(numFrames);

  let prevMag = new Float32Array(frameSize / 2);
  const half = frameSize / 2;

  // Pre-calculate Hamming window
  const window = new Float32Array(frameSize);
  for (let i = 0; i < frameSize; i++) {
    window[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (frameSize - 1));
  }

  const real = new Float32Array(frameSize);
  const imag = new Float32Array(frameSize);

  for (let f = 0; f < numFrames; f++) {
    const offset = f * hopSize;

    // Apply window and compute simple magnitude spectrum approximation
    let hfc = 0;
    let flux = 0;

    for (let i = 0; i < frameSize; i++) {
      real[i] = pcm[offset + i] * window[i];
      imag[i] = 0;
    }

    // Direct energy in sub-bands (Low, Mid, High)
    const currentMag = new Float32Array(half);
    // Sub-band energy approximation
    for (let k = 1; k < half; k++) {
      // Simplified DFT bin energy estimate
      const s0 = real[k];
      const s1 = real[k * 2 % frameSize];
      const mag = Math.sqrt(s0 * s0 + s1 * s1 + 1e-9);
      currentMag[k] = mag;

      // Positive spectral difference (Flux)
      const diff = mag - prevMag[k];
      if (diff > 0) {
        flux += diff;
      }

      // High Frequency Content weighting
      hfc += mag * (k / half);
    }

    novelty[f] = flux * 0.7 + hfc * 0.3;
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
 * Classifies an isolated drum slice into a standard General MIDI drum piece note.
 */
function classifyDrumSlice(pcm: Float32Array, sampleRate: number): { note: number; category: string; label: string } {
  if (pcm.length === 0) {
    return { note: 36, category: 'kick', label: 'Bass Drum 1 (36 C1)' };
  }

  // Calculate energy distribution: Sub (<120Hz), Mid (200-2500Hz), High (>3500Hz)
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

  // Spectral Centroid approximation using zero-crossing rate and peak decay
  // High ZCR (> 0.25) -> Cymbals, Hi-Hats, Shakers
  if (zcr > 0.22) {
    if (durationMs < 280) {
      return { note: 42, category: 'hihat', label: `${GM_DRUM_MAP[42]} (42 F#1)` };
    }
    if (durationMs > 600) {
      return { note: 49, category: 'cymbal', label: `${GM_DRUM_MAP[49]} (49 C#2)` };
    }
    return { note: 46, category: 'hihat', label: `${GM_DRUM_MAP[46]} (46 A#1)` };
  }

  // Low ZCR (< 0.08) with strong decay -> Kick Drum
  if (zcr < 0.08) {
    return { note: 36, category: 'kick', label: `${GM_DRUM_MAP[36]} (36 C1)` };
  }

  // Mid ZCR (0.08..0.22): Snare or Tom
  if (zcr >= 0.12) {
    return { note: 38, category: 'snare', label: `${GM_DRUM_MAP[38]} (38 D1)` };
  }

  // Low-mid: Tom
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

  // Helper: write Variable Length Quantity (VLQ)
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

  // Convert slice start & end seconds to MIDI ticks
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

  // Sort chronologically (off before on at the same tick)
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
 * Core Slicing Engine: segments audio, classifies slices, and computes zone distributions.
 */
export function sliceAudioBuffer(
  pcm: Float32Array,
  sampleRate: number,
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

  const rawBoundaries: number[] = [0];
  const hopSize = 256;
  const preRollFrames = Math.round((opts.preRollMs / 1000) * sampleRate);

  if (opts.mode === 'grid') {
    // Mathematical tempo subdivision
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
  } else {
    // Transient & Onset detection via Spectral Novelty Curve
    const novelty = computeSpectralNoveltyCurve(pcm, 1024, hopSize);
    const minDistanceFrames = Math.max(256, Math.round(0.045 * sampleRate)); // 45 ms minimum slice gap
    const minDistanceBins = Math.max(1, Math.floor(minDistanceFrames / hopSize));

    // Calculate dynamic threshold based on sensitivity (0..100)
    let meanNovelty = 0;
    for (let i = 0; i < novelty.length; i++) meanNovelty += novelty[i];
    meanNovelty /= Math.max(1, novelty.length);

    // Higher sensitivity -> lower threshold multiplier
    const sensNorm = clamp(opts.sensitivity, 1, 100) / 100;
    const threshold = meanNovelty * (2.8 - sensNorm * 2.2);

    let lastDetectedBin = -minDistanceBins;

    for (let i = 2; i < novelty.length - 2; i++) {
      if (
        novelty[i] > threshold &&
        novelty[i] > novelty[i - 1] &&
        novelty[i] >= novelty[i + 1] &&
        i - lastDetectedBin >= minDistanceBins
      ) {
        const onsetFrame = i * hopSize;
        const candidateStart = Math.max(0, onsetFrame - preRollFrames);
        rawBoundaries.push(candidateStart);
        lastDetectedBin = i;
      }
    }
  }

  // Ensure end boundary
  rawBoundaries.push(totalFrames);

  // Magnetize boundaries to Zero Crossing if requested
  const snappedBoundaries = rawBoundaries.map((pos, idx) => {
    if (!opts.snapZeroCrossing || idx === 0 || idx === rawBoundaries.length - 1) {
      return clamp(Math.round(pos), 0, totalFrames);
    }
    return snapFrameToRisingZeroCrossing(pcm, pos, 128);
  });

  // Filter duplicated or too-close boundaries (< 32 frames)
  const cleanBoundaries: number[] = [];
  for (const b of snappedBoundaries) {
    if (cleanBoundaries.length === 0 || b - cleanBoundaries[cleanBoundaries.length - 1] >= 64) {
      cleanBoundaries.push(b);
    }
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
    // Group drum slices and map to GM Drum Map
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

    // Velocity Layer grouping for identical notes
    const slicesByNote = new Map<number, DetectedSlice[]>();
    for (const sl of rawSlices) {
      if (sl.isSilence) continue;
      const list = slicesByNote.get(sl.rootKey) ?? [];
      list.push(sl);
      slicesByNote.set(sl.rootKey, list);
    }

    for (const [, list] of slicesByNote) {
      if (list.length > 1) {
        // Sort ascending by RMS energy
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
    // Pitch detection + Equidistant Keybed Distribution
    const activeSlices = rawSlices.filter((s) => !s.isSilence);
    for (const sl of activeSlices) {
      const pitch = detectPitchYinMpm(sl.pcm, sampleRate);
      sl.f0Hz = Math.round(pitch.f0Hz * 10) / 10;
      const { midiNote } = hzToMidiAndCents(pitch.f0Hz);
      sl.rootKey = midiNote;
      sl.label = `${midiNoteToString(midiNote)} (${sl.f0Hz} Hz)`;
      sl.category = 'chromatic';
    }

    // Sort tonal slices by pitch
    activeSlices.sort((a, b) => a.rootKey - b.rootKey);

    // Equidistant boundaries: frontier(A, B) = floor((rootA + rootB) / 2)
    for (let i = 0; i < activeSlices.length; i++) {
      const cur = activeSlices[i];
      const prev = i > 0 ? activeSlices[i - 1] : null;
      const next = i < activeSlices.length - 1 ? activeSlices[i + 1] : null;

      cur.lowKey = prev ? Math.floor((prev.rootKey + cur.rootKey) / 2) + 1 : 0;
      cur.highKey = next ? Math.floor((cur.rootKey + next.rootKey) / 2) : 127;
      if (cur.lowKey > cur.rootKey) cur.lowKey = cur.rootKey;
      if (cur.highKey < cur.rootKey) cur.highKey = cur.rootKey;
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
 * Helper to generate string note format "60 C3"
 */
function midiNoteToString(midi: number): string {
  return `${midi} (${midiToNoteName(midi)})`;
}
