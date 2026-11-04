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
import type { PhonemeWord } from '../bridge/BridgeClient.ts';

export type { PhonemeWord };

export type SlicerMode = 'drums' | 'chromatic' | 'vocals' | 'grid';
/**
 * Macro-workflow mode for AutoSlicer (Fase 39.4):
 * - `'one_shot_extractor'`: Cuts and maps isolated notes (chromatic scale) or isolated drum hits (note-by-note kit).
 *   BPM / groove tempo controls are conditioned-disabled in the UI.
 * - `'rex_groove_loop'`: Cuts rhythmic drum loops, melodic phrases/riffs, or vocal grooves,
 *   detecting real BPM & bars, extracting the playable MIDI score (.mid), and allowing elastic BPM conforming.
 */
export type SlicerWorkflowMode = 'one_shot_extractor' | 'rex_groove_loop';
export type GridDivision = '1/4' | '1/8' | '1/16' | '1/32';

export interface SlicerOptions {
  /** Macro-workflow mode: 'one_shot_extractor' (isolated notes/hits) vs 'rex_groove_loop' (rhythmic/melodic loop with BPM & MIDI groove) */
  workflowMode?: SlicerWorkflowMode;
  /** Mode: 'drums' (GM Map), 'chromatic' (F0 pitch + equidistant zones), 'vocals' (vocal/phrase segmentation), 'grid' (BPM division) */
  mode: SlicerMode;
  /** Transient attack sensitivity: 0..100 (default: 70) */
  sensitivity: number;
  /** RMS silence gate threshold in dB: -60..-20 (default: -42 dB) */
  silenceThresholdDb: number;
  /** Auto-flag quiet slices as silence (default: true). When false, no slice is marked silence. */
  detectSilences: boolean;
  /** Minimum quiet duration to flag silence, in milliseconds (default: 120) */
  minSilenceMs: number;
  /** Pre-roll safety margin in milliseconds before transient to preserve initial attack (default: 3 ms) */
  preRollMs: number;
  /** Post-roll tail safety margin in milliseconds (default: 8 ms) */
  postRollMs: number;
  /** Magnetize slice boundaries to the nearest rising zero-crossing (default: true) */
  snapZeroCrossing: boolean;
  /** Tempo in BPM for grid slicing or manual source BPM override (default: 120; 0 = auto-detect) */
  bpm: number;
  /** Optional target BPM for Elastic Loop Conforming and MIDI pattern export (default: follows detectedBpm) */
  targetBpm?: number;
  /** Optional bar count override (default: auto-estimated from loop duration & BPM) */
  barCount?: number;
  /** Grid division if mode === 'grid' (default: '1/16') */
  gridDivision: GridDivision;
  /** Allow overlapping key/velocity zones (default: false) */
  allowOverlap: boolean;
  /** Base MIDI note for chromatic sequential mapping (default: 36 C1 or 60 C3) */
  chromaticBaseNote: number;
  /** Minimum slice distance in milliseconds (default: 45ms for drums, 250ms for vocals) */
  minSliceMs?: number;
  /** Custom phonetic/semantic words from Whisper-tiny alignment */
  phoneticWords?: Array<{ word: string; startFrame: number; endFrame: number; confidence?: number }>;
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
  /** Optional Phase 37 AutoSampler metadata attached to this slice */
  noteOffOffsetFrame?: number;
  loopStartFrame?: number;
  loopEndFrame?: number;
  detuneCents?: number;
  muteGroup?: number;
  roundRobinIndex?: number;
}

export interface SlicerResult {
  workflowMode?: SlicerWorkflowMode;
  slices: DetectedSlice[];
  totalSlices: number;
  validSlicesCount: number;
  silenceSlicesCount: number;
  detectedBpm: number;
  detectedBars?: number;
  bpmConfidence?: number;
  targetBpm?: number;
  sampleRate: number;
  totalDurationSec: number;
  midiFileBuffer: Uint8Array;
}

export const DEFAULT_SLICER_OPTIONS: SlicerOptions = {
  workflowMode: 'rex_groove_loop',
  mode: 'drums',
  sensitivity: 70,
  silenceThresholdDb: -42,
  detectSilences: true,
  minSilenceMs: 120,
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
 * Estimates the rhythmic/melodic BPM and bar count from slice Inter-Onset Intervals (IOIs)
 * and total loop duration. Works for both drum grooves and melodic phrases/riffs!
 */
export function estimateLoopBpmAndBars(
  pcm: Float32Array,
  sampleRate: number,
  slices: readonly DetectedSlice[],
  fallbackBpm: number = 120
): { detectedBpm: number; detectedBars: number; confidence: number } {
  const totalDurationSec = pcm.length / Math.max(1, sampleRate);
  const active = slices.filter((s) => !s.isSilence);

  if (totalDurationSec < 0.35 || active.length === 0) {
    return {
      detectedBpm: clamp(fallbackBpm || 120, 20, 300),
      detectedBars: 1,
      confidence: 0,
    };
  }

  // Collect Inter-Onset Intervals (IOIs) weighted by slice energy
  const iois: Array<{ dt: number; weight: number }> = [];
  for (let i = 0; i < active.length - 1; i++) {
    const dt = active[i + 1].startSec - active[i].startSec;
    if (dt >= 0.065 && dt <= 2.4) {
      const weight = clamp((active[i].peakDb + 48) / 48, 0.2, 1.0);
      iois.push({ dt, weight });
    }
  }

  // Also include loop wrap-around interval (from last slice to end of loop) if rhythmic
  const lastSlice = active[active.length - 1];
  const tailDt = totalDurationSec - lastSlice.startSec;
  if (tailDt >= 0.065 && tailDt <= 2.4) {
    iois.push({ dt: tailDt, weight: 0.7 });
  }

  const gridSubdivisions = [0.25, 1 / 3, 0.5, 2 / 3, 0.75, 1.0, 1.5, 2.0, 4.0];
  const canonicalBeatCounts = [2, 4, 8, 12, 16, 24, 32, 64];

  let bestBpm = clamp(fallbackBpm || 120, 60, 180);
  let bestScore = -1;

  for (let candTimes2 = 136; candTimes2 <= 350; candTimes2++) {
    const candBpm = candTimes2 * 0.5; // 68.0 .. 175.0 BPM in 0.5 steps
    const beatSec = 60 / candBpm;

    // 1. IOI Grid Fit Score (0..1)
    let ioiScoreSum = 0;
    let ioiWeightSum = 0;
    for (const item of iois) {
      const beats = item.dt / beatSec;
      let minErr = 999;
      let subdivPenalty = 1.0;
      for (const g of gridSubdivisions) {
        const err = Math.abs(beats - g) / g;
        if (err < minErr) {
          minErr = err;
          // Prefer binary subdivisions (0.25, 0.5, 1.0, 2.0) slightly over triplets
          subdivPenalty = g === 0.25 || g === 0.5 || g === 1.0 || g === 2.0 ? 1.0 : 0.86;
        }
      }
      const fit = Math.exp(-minErr * minErr * 28) * subdivPenalty;
      ioiScoreSum += fit * item.weight;
      ioiWeightSum += item.weight;
    }
    const ioiNorm = ioiWeightSum > 0 ? ioiScoreSum / ioiWeightSum : 0.3;

    // 2. Total Duration Bar-Grid Fit Score (0..1)
    const totalBeats = totalDurationSec / beatSec;
    let bestBeatDiff = 999;
    let favorPowerOfTwo = 0.85;
    for (const bc of canonicalBeatCounts) {
      const relErr = Math.abs(totalBeats - bc) / bc;
      if (relErr < bestBeatDiff) {
        bestBeatDiff = relErr;
        favorPowerOfTwo = bc === 4 || bc === 8 || bc === 16 || bc === 32 ? 1.0 : 0.88;
      }
    }
    const barFit = Math.exp(-bestBeatDiff * bestBeatDiff * 40) * favorPowerOfTwo;

    // 3. Natural Tempo Prior (gentle preference for 85..145 BPM to break octave ties)
    const tempoPrior =
      candBpm >= 85 && candBpm <= 145
        ? 1.04
        : candBpm >= 72 && candBpm <= 165
          ? 1.0
          : 0.94;

    // Integer BPM bonus when ties occur
    const intBonus = Number.isInteger(candBpm) ? 1.015 : 1.0;

    const totalScore = (ioiNorm * 0.62 + barFit * 0.38) * tempoPrior * intBonus;
    if (totalScore > bestScore) {
      bestScore = totalScore;
      bestBpm = candBpm;
    }
  }

  // Round to nearest integer if within 0.35 BPM of an integer
  if (Math.abs(bestBpm - Math.round(bestBpm)) <= 0.35) {
    bestBpm = Math.round(bestBpm);
  } else {
    bestBpm = Math.round(bestBpm * 2) / 2;
  }

  const rawBars = (totalDurationSec * (bestBpm / 60)) / 4;
  const canonicalBars = [1, 2, 4, 8, 16, 32];
  let detectedBars = Math.max(1, Math.round(rawBars));
  for (const cb of canonicalBars) {
    if (Math.abs(rawBars - cb) / cb <= 0.18) {
      detectedBars = cb;
      break;
    }
  }

  return {
    detectedBpm: clamp(bestBpm, 20, 300),
    detectedBars,
    confidence: Math.round(clamp(bestScore, 0, 1) * 100) / 100,
  };
}

/**
 * Builds an in-memory Standard MIDI File (SMF Type 0, 1 Track, 480 PPQN).
 * When `targetBpm` is provided alongside `sourceBpm`, note-on/off beat positions stay locked to
 * `sourceBpm` while the SMF Tempo Meta-Event writes `targetBpm`, so the pattern plays at `targetBpm`!
 */
export function buildMidiFileBuffer(
  slices: DetectedSlice[],
  sourceBpm: number,
  targetBpm?: number
): Uint8Array {
  const safeSourceBpm = clamp(sourceBpm || 120, 20, 300);
  const safeTargetBpm = clamp(targetBpm && targetBpm > 0 ? targetBpm : safeSourceBpm, 20, 300);
  const usPerQuarter = Math.round(60_000_000 / safeTargetBpm);
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

  // Tempo event (Meta 0x51) at safeTargetBpm
  trackEvents.push(0x00, 0xff, 0x51, 0x03);
  trackEvents.push((usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff);

  // Time signature 4/4 (Meta 0x58)
  trackEvents.push(0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08);

  // Ticks represent musical beats in the source performance (`sec * safeSourceBpm * ppqn / 60`)
  const secToTick = (sec: number) => Math.max(0, Math.round((sec * safeSourceBpm * ppqn) / 60));

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
function detectMelodicPitchChangeBoundaries(
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

export interface ConformedLoopResult {
  /** Continuous mono PCM conformed to `targetBpm` with transients 100% preserved */
  pcm: Float32Array;
  sampleRate: number;
  durationSec: number;
  sourceBpm: number;
  targetBpm: number;
  barCount: number;
}

/**
 * Transient-Locked Elastic BPM Conformer (`conformLoopToTargetBpm`, Fase 39.4):
 * Re-assembles a sliced rhythmic or melodic loop from `sourceBpm` to `targetBpm`
 * while keeping the first `transientLockMs` (default 25 ms) of every slice 100% untouched:
 * - When speeding up (`targetBpm > sourceBpm`): places each slice earlier at its exact beat
 *   timestamp and applies a zero-crossing snapped equal-power crossfade (`crossfadeMs`) over the previous tail.
 * - When slowing down (`targetBpm < sourceBpm`): extends each slice's decay tail into the newly opened gap
 *   using a damped zero-crossing mirror/tail continuation so no silent "machine-gun" holes appear.
 */
export function conformLoopToTargetBpm(
  pcm: Float32Array,
  sampleRate: number,
  slices: readonly DetectedSlice[],
  sourceBpm: number,
  targetBpm: number,
  options?: { transientLockMs?: number; crossfadeMs?: number; barCount?: number }
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

  const timeScale = safeSourceBpm / safeTargetBpm; // < 1 when speeding up, > 1 when slowing down
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
    Math.round(((options?.transientLockMs ?? 25) / 1000) * sampleRate)
  );
  const xfadeFrames = Math.max(
    32,
    Math.round(((options?.crossfadeMs ?? 8) / 1000) * sampleRate)
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
      // Speeding up (or slice fills the slot): copy up to slotLen with equal-power fade-out over the last xfadeFrames
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
      // Slowing down (`slotLen > srcLen`): copy full slice intact, then extend its decay tail smoothly
      const copyLen = Math.min(srcLen, targetTotalFrames - dstStart);
      for (let k = 0; k < copyLen; k++) {
        out[dstStart + k] += sl.pcm[k];
      }

      const gapLen = Math.min(slotLen - copyLen, targetTotalFrames - (dstStart + copyLen));
      const tailSourceLen = Math.min(srcLen, Math.max(128, Math.floor(srcLen * 0.45)));
      if (gapLen > 16 && tailSourceLen >= 32) {
        const tailStart = srcLen - tailSourceLen;
        for (let g = 0; g < gapLen; g++) {
          // Ping-pong mirror index inside the tail region to avoid phase step discontinuities
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

  // Soft-clip / safety ceiling at ±0.99
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

export interface NormalizePeakResult {
  /** New peak-normalized buffer (input is never mutated) */
  pcm: Float32Array;
  /** Gain actually applied, in dB (0 when input is digital silence) */
  appliedGainDb: number;
  /** Peak of the input, in dBFS */
  inputPeakDb: number;
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

export interface ManualSilenceRange {
  start: number;
  end: number;
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

/**
 * Helper to generate string note format "60 C3"
 */
function midiNoteToString(midi: number): string {
  return `${midi} (${midiToNoteName(midi)})`;
}

// ── Phase 37.6: Deterministic Slicing from MidiAutoSampleManifest ───────────

export interface MidiManifestSliceBuildOptions {
  /** Snap slice start/end frames to nearest rising zero-crossing (default: true). */
  snapZeroCrossing?: boolean;
  /** Trim residual trailing silence inside each slice (default: true). */
  trimTrailingSilence?: boolean;
  /** Silence gate threshold in dBFS for trailing trim (default: -60 dB). */
  silenceThresholdDb?: number;
  /** Automatically measure real F0 in the sustained window (`NoteOn..NoteOff`) and compute analog `detuneCents` (khiner/AutoSampler insight). */
  autoCompensateAnalogDetune?: boolean;
  /** Auto-label unnamed drum hits using `classifyDrumSlice` (default: true when manifest.mode === 'drum_map'). */
  autoClassifyUnnamedDrumHits?: boolean;
  /** Additional latency offset adjustment in milliseconds (`± ms` rescue control). */
  extraLatencyOffsetMs?: number;
}

/**
 * Cuts a continuous recording deterministically using the exact `noteOnFrame`,
 * `noteOffFrame`, and `tailEndFrame` markers recorded in a `MidiAutoSampleManifest`.
 */
export function buildSlicesFromMidiManifest(
  pcm: Float32Array,
  sampleRate: number,
  manifest: {
    mode?: string;
    latencySamples?: number;
    events: Array<{
      index: number;
      status?: string;
      midiNote: number;
      velocity: number;
      velocityLayerIndex?: number;
      roundRobinIndex?: number;
      customName?: string;
      muteGroup?: number;
      lowKey: number;
      highKey: number;
      lowVel: number;
      highVel: number;
      noteOnFrame: number;
      noteOffFrame: number;
      tailEndFrame: number;
      loopStartFrame?: number;
      loopEndFrame?: number;
    }>;
  },
  options: MidiManifestSliceBuildOptions = {}
): SlicerResult {
  const sr = Math.max(1, sampleRate);
  const totalFrames = pcm.length;
  const totalDurationSec = totalFrames / sr;
  const snapZc = options.snapZeroCrossing !== false;
  const trimTrail = options.trimTrailingSilence !== false;
  const silenceLinear = Math.pow(10, (options.silenceThresholdDb ?? -60) / 20);
  const manifestLatencyFrames = Math.max(0, Math.round(manifest.latencySamples ?? 0));
  const extraOffsetFrames = Math.round(((options.extraLatencyOffsetMs ?? 0) / 1000) * sr);
  const totalOffsetFrames = manifestLatencyFrames + extraOffsetFrames;

  const slices: DetectedSlice[] = [];
  const recordedEvents = manifest.events.filter(
    (ev) => !ev.status || ev.status === 'recorded'
  );

  for (let i = 0; i < recordedEvents.length; i++) {
    const ev = recordedEvents[i];
    let startFrame = clamp(
      Math.round(ev.noteOnFrame + totalOffsetFrames),
      0,
      Math.max(0, totalFrames - 64)
    );
    let endFrame = clamp(
      Math.round(ev.tailEndFrame + totalOffsetFrames),
      startFrame + 64,
      totalFrames
    );

    if (snapZc) {
      startFrame = snapFrameToNearestZeroCrossing(pcm, startFrame, 128);
      endFrame = snapFrameToNearestZeroCrossing(pcm, endFrame, 128);
      if (endFrame <= startFrame + 32) {
        endFrame = Math.min(totalFrames, startFrame + 64);
      }
    }

    // Fine trailing silence trim (refines block-granularity tailEndFrame)
    if (trimTrail && endFrame - startFrame > 256) {
      const minKeepFrame = Math.min(
        endFrame,
        Math.max(startFrame + 128, Math.round(ev.noteOffFrame + totalOffsetFrames))
      );
      let trimmedEnd = endFrame;
      const win = 32;
      while (trimmedEnd - win > minKeepFrame) {
        let localPeak = 0;
        for (let k = trimmedEnd - win; k < trimmedEnd; k++) {
          const a = Math.abs(pcm[k]);
          if (a > localPeak) localPeak = a;
        }
        if (localPeak <= silenceLinear) {
          trimmedEnd -= win;
        } else {
          break;
        }
      }
      if (snapZc && trimmedEnd < endFrame) {
        trimmedEnd = snapFrameToNearestZeroCrossing(pcm, trimmedEnd, 64);
      }
      endFrame = clamp(trimmedEnd, startFrame + 64, totalFrames);
    }

    const slicePcm = new Float32Array(pcm.subarray(startFrame, endFrame));
    const fadeFrames = Math.min(Math.floor(slicePcm.length / 2), Math.round(0.001 * sr));
    for (let f = 0; f < fadeFrames; f++) {
      const gIn = f / fadeFrames;
      const gOut = (fadeFrames - 1 - f) / fadeFrames;
      slicePcm[f] *= gIn;
      slicePcm[slicePcm.length - 1 - f] *= gOut;
    }

    let sumSq = 0;
    let peak = 0;
    for (let k = 0; k < slicePcm.length; k++) {
      const a = Math.abs(slicePcm[k]);
      if (a > peak) peak = a;
      sumSq += a * a;
    }
    const rms = Math.sqrt(sumSq / Math.max(1, slicePcm.length));
    const rmsDb = 20 * Math.log10(rms + 1e-9);
    const peakDb = 20 * Math.log10(peak + 1e-9);

    const noteOffOffsetFrame = clamp(
      Math.round(ev.noteOffFrame + totalOffsetFrames) - startFrame,
      64,
      slicePcm.length
    );

    // Optional analog oscillator pitch & detune verification on sustained region (khiner/AutoSampler insight)
    let f0Hz: number | undefined;
    let detuneCents = 0;
    const isDrumMode = manifest.mode === 'drum_map' || Boolean(ev.customName);

    if (!isDrumMode && slicePcm.length >= 512) {
      const sustainSub = slicePcm.subarray(
        Math.min(slicePcm.length - 256, Math.floor(noteOffOffsetFrame * 0.15)),
        Math.max(256, Math.floor(noteOffOffsetFrame * 0.9))
      );
      const pitch = detectPitchYinMpm(sustainSub.length >= 512 ? sustainSub : slicePcm, sr);
      if (pitch.f0Hz > 20 && pitch.harmonicity >= 0.45) {
        f0Hz = Math.round(pitch.f0Hz * 10) / 10;
        if (options.autoCompensateAnalogDetune) {
          const targetHz = 440 * Math.pow(2, (ev.midiNote - 69) / 12);
          const rawCents = Math.round(1200 * Math.log2(pitch.f0Hz / targetHz));
          if (Math.abs(rawCents) <= 50) {
            detuneCents = -rawCents; // Compensate drift back to 12-TET
          }
        }
      }
    }

    let label = ev.customName
      ? `${ev.customName} (${midiToNoteName(ev.midiNote)} v${ev.velocity})`
      : `${midiToNoteName(ev.midiNote)} (${ev.midiNote}) • v${ev.velocity}`;
    let category = isDrumMode ? 'percussion' : 'chromatic';
    let muteGroup = ev.muteGroup;

    if (
      isDrumMode &&
      !ev.customName &&
      options.autoClassifyUnnamedDrumHits !== false &&
      slicePcm.length >= 128
    ) {
      const drumClass = classifyDrumSlice(slicePcm, sr);
      category = drumClass.category;
      label = `${drumClass.label} [v${ev.velocity}]`;
      if (drumClass.category === 'hihat' && muteGroup === undefined) {
        muteGroup = 1;
      }
    }

    slices.push({
      id: `slice_midi_${i + 1}`,
      index: i + 1,
      startFrame,
      endFrame,
      startSec: startFrame / sr,
      endSec: endFrame / sr,
      durationSec: (endFrame - startFrame) / sr,
      rmsDb,
      peakDb,
      isSilence: false,
      ...(f0Hz !== undefined ? { f0Hz } : {}),
      rootKey: clamp(ev.midiNote, 0, 127),
      lowKey: clamp(ev.lowKey, 0, 127),
      highKey: clamp(ev.highKey, 0, 127),
      lowVel: clamp(ev.lowVel, 1, 127),
      highVel: clamp(ev.highVel, 1, 127),
      label,
      category,
      pcm: slicePcm,
      noteOffOffsetFrame,
      ...(ev.loopStartFrame !== undefined ? { loopStartFrame: ev.loopStartFrame } : {}),
      ...(ev.loopEndFrame !== undefined ? { loopEndFrame: ev.loopEndFrame } : {}),
      ...(detuneCents !== 0 ? { detuneCents } : {}),
      ...(muteGroup !== undefined ? { muteGroup } : {}),
      ...(ev.roundRobinIndex !== undefined ? { roundRobinIndex: ev.roundRobinIndex } : {}),
    });
  }

  const midiBuffer = buildMidiFileBuffer(slices, 120);

  return {
    slices,
    totalSlices: slices.length,
    validSlicesCount: slices.length,
    silenceSlicesCount: 0,
    detectedBpm: 120,
    sampleRate: sr,
    totalDurationSec,
    midiFileBuffer: midiBuffer,
  };
}

