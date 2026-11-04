// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — GM Drum Classification, Loop Tempo Estimation & SMF Builder
// ─────────────────────────────────────────────────────────

import { clamp } from '../DspMath.ts';
import { GM_DRUM_MAP } from '../../gmDrumMap.ts';
import type { DetectedSlice } from './SlicerTypes.ts';

/**
 * Classifies an isolated drum slice into a standard General MIDI drum piece note.
 */
export function classifyDrumSlice(pcm: Float32Array, sampleRate: number): { note: number; category: string; label: string } {
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
