/**
 * @abdsynths/shared — Code/DspCore/TakeDsp/autoSamplerDsp.ts
 * =========================================================================
 * Pure TypeScript DSP & musical grid scheduling primitives for MIDI
 * AutoSampling (Hardware / VST / Live MIDI Capture).
 *
 * Zero DOM, zero WebAudio, zero hardware/clock coupling:
 *   1. Dynamic Release-Tail Decay Detector (`evaluateReleaseTailDecay`)
 *      ported from ABDAudioLab (`LabAudioReceiver.cpp:223-249` &
 *      `ProfilingSequencer.cpp:668-694`).
 *   2. Round-Trip Latency (RTL) & FFT Cross-Correlation Sync Offset
 *      (`measureMidiToAudioLatency` / `findSampleAccurateSyncOffset`)
 *      ported from ABDAudioLab (`LabAudioReceiver.cpp:180-197, 336-404`).
 *   3. Pre-roll Noise Print with mandatory DC-block pre-pass
 *      (`capturePreRollNoiseProfile`).
 *   4. Musical Note Grid & Velocity Curve / Manual Table Generator
 *      (`computeVelocityLayers`, `generateSweepSchedule`).
 *   5. Smart Pre-Check Pilot Note Analyzer (`analyzePilotNoteResponse`).
 */

import { computeNoiseProfile, dcBlock, rmsDbfs } from './takeDsp.ts';
import type {
  AutoSamplerCaptureMode,
  AutoSamplerReleaseMode,
  AutoSamplerVelocityCurve,
  MidiAutoSampleManifest,
  MidiCapturedNoteEvent,
  TakeNoiseProfile,
  VelocityLayerSpec,
} from '../../../Contracts/recordingSession.ts';

const STANDARD_NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Converts a MIDI note number (0..127) to standard scientific pitch notation (e.g. 60 -> "C4", 36 -> "C2"). */
export function midiNoteToStandardName(midiNote: number): string {
  const clamped = Math.max(0, Math.min(127, Math.round(midiNote)));
  const pc = STANDARD_NOTE_NAMES[clamped % 12];
  const octave = Math.floor(clamped / 12) - 1;
  return `${pc}${octave}`;
}

// ── 1. Release-Tail Decay Detector (Dynamic Early Stopping) ─────────────────

export interface ReleaseTailDecayOptions {
  /** Sample rate in Hz. */
  sampleRate: number;
  /** Frame index where NoteOff was sent/received. */
  noteOffFrame: number;
  /** Minimum grace period after NoteOff before early-stopping is allowed (default: 180 ms). */
  gracePeriodMs?: number;
  /** Consecutive silent duration required to declare tail finished (default: 90 ms). */
  sustainedSilenceMs?: number;
  /** Maximum release duration timeout after NoteOff (default: 4000 ms). */
  maxReleaseMs?: number;
  /** Measured pre-roll noise floor in dBFS (default: -65 dBFS). */
  noiseFloorDbfs?: number;
  /** Margin above noise floor to consider signal decayed (default: +4.5 dB). */
  marginAboveNoiseDb?: number;
}

export interface ReleaseTailDecayResult {
  /** True when the release tail has decayed to the noise floor or reached maxReleaseMs. */
  tailFinished: boolean;
  /** Reason the tail finished ('decayed_to_noise_floor' | 'max_release_timeout' | 'still_ringing'). */
  reason: 'decayed_to_noise_floor' | 'max_release_timeout' | 'still_ringing';
  /** Approximate frame where the tail finished (refined later with zc-snap). */
  approxTailEndFrame: number;
  /** Peak level in dBFS observed across the note + release window. */
  peakDbfs: number;
  /** True if > 700 samples hit >= -0.05 dBFS (sustained clipping guard from ABDAudioLab). */
  sustainedClipping: boolean;
}

/**
 * Evaluates a recorded audio slice starting at `noteOnFrame` (or a live buffer)
 * to determine if the release tail after `noteOffFrame` has decayed into the
 * noise floor (`Dynamic Early Stopping` + `ADAPTIVE_ENVELOPE`).
 */
export function evaluateReleaseTailDecay(
  mono: Float32Array,
  options: ReleaseTailDecayOptions
): ReleaseTailDecayResult {
  const sr = Math.max(1, options.sampleRate);
  const noteOffFrame = Math.max(0, Math.min(mono.length, Math.round(options.noteOffFrame)));
  const graceFrames = Math.round(((options.gracePeriodMs ?? 180) / 1000) * sr);
  const silenceRequiredFrames = Math.max(
    64,
    Math.round(((options.sustainedSilenceMs ?? 90) / 1000) * sr)
  );
  const maxReleaseFrames = Math.max(
    graceFrames + silenceRequiredFrames,
    Math.round(((options.maxReleaseMs ?? 4000) / 1000) * sr)
  );
  const noiseFloorDb = Number.isFinite(options.noiseFloorDbfs)
    ? (options.noiseFloorDbfs as number)
    : -65;
  const thresholdDb = Math.max(-82, Math.min(-24, noiseFloorDb + (options.marginAboveNoiseDb ?? 4.5)));
  const thresholdLinear = Math.pow(10, thresholdDb / 20);

  // Measure overall peak and sustained clipping (> 700 samples near 1.0, as in LabAudioReceiver.cpp)
  let peak = 0;
  let clippedSamples = 0;
  for (let i = 0; i < mono.length; i++) {
    const a = Math.abs(mono[i]);
    if (a > peak) peak = a;
    if (a >= 0.994) clippedSamples++;
  }
  const peakDbfs = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  const sustainedClipping = clippedSamples > 700;

  const checkStartFrame = noteOffFrame + graceFrames;
  if (mono.length < checkStartFrame + silenceRequiredFrames) {
    return {
      tailFinished: false,
      reason: 'still_ringing',
      approxTailEndFrame: mono.length,
      peakDbfs,
      sustainedClipping,
    };
  }

  // Scan in 10 ms blocks after grace period for sustained silence
  const blockSize = Math.max(32, Math.round(sr * 0.01));
  let silentRunFrames = 0;

  for (let pos = checkStartFrame; pos + blockSize <= mono.length; pos += blockSize) {
    let blockPeak = 0;
    let sumSq = 0;
    for (let i = 0; i < blockSize; i++) {
      const a = Math.abs(mono[pos + i]);
      if (a > blockPeak) blockPeak = a;
      sumSq += a * a;
    }
    const blockRms = Math.sqrt(sumSq / blockSize);
    // Combine RMS and scaled peak so isolated micro-spikes don't block release forever
    if (blockRms <= thresholdLinear && blockPeak <= thresholdLinear * 2.2) {
      silentRunFrames += blockSize;
      if (silentRunFrames >= silenceRequiredFrames) {
        return {
          tailFinished: true,
          reason: 'decayed_to_noise_floor',
          approxTailEndFrame: Math.min(mono.length, pos + blockSize),
          peakDbfs,
          sustainedClipping,
        };
      }
    } else {
      silentRunFrames = 0;
    }

    if (pos + blockSize - noteOffFrame >= maxReleaseFrames) {
      return {
        tailFinished: true,
        reason: 'max_release_timeout',
        approxTailEndFrame: Math.min(mono.length, pos + blockSize),
        peakDbfs,
        sustainedClipping,
      };
    }
  }

  if (mono.length - noteOffFrame >= maxReleaseFrames) {
    return {
      tailFinished: true,
      reason: 'max_release_timeout',
      approxTailEndFrame: mono.length,
      peakDbfs,
      sustainedClipping,
    };
  }

  return {
    tailFinished: false,
    reason: 'still_ringing',
    approxTailEndFrame: mono.length,
    peakDbfs,
    sustainedClipping,
  };
}

// ── 2. Latency Measurement & FFT Cross-Correlation Sync Offset ──────────────

export interface LatencyCalibrationResult {
  /** Measured MIDI-to-Audio onset latency in samples. */
  latencySamples: number;
  /** Measured MIDI-to-Audio onset latency in milliseconds. */
  latencyMs: number;
  /** Peak level of the pilot note in dBFS. */
  peakDbfs: number;
  /** Recommended input gain trim in dB to hit -3.0 dBFS cleanly. */
  recommendedGainTrimDb: number;
  /** True if sustained clipping (> 700 samples) occurred. */
  sustainedClipping: boolean;
  /** True if a valid note onset was detected above the noise floor. */
  detectedOnset: boolean;
}

/**
 * Measures the exact sample latency (`latencySamples`) between `noteOnSentFrame`
 * and the actual acoustic onset in `recordedMono`, plus gain/clipping diagnostics.
 */
export function measureMidiToAudioLatency(
  recordedMono: Float32Array,
  sampleRate: number,
  noteOnSentFrame = 0,
  noiseFloorDbfs = -65
): LatencyCalibrationResult {
  const sr = Math.max(1, sampleRate);
  const start = Math.max(0, Math.min(recordedMono.length, Math.round(noteOnSentFrame)));
  const slice = recordedMono.subarray(start);

  let peak = 0;
  let clipped = 0;
  for (let i = 0; i < slice.length; i++) {
    const a = Math.abs(slice[i]);
    if (a > peak) peak = a;
    if (a >= 0.994) clipped++;
  }
  const peakDbfs = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  const sustainedClipping = clipped > 700;
  const recommendedGainTrimDb = Number.isFinite(peakDbfs) ? Math.round((-3.0 - peakDbfs) * 10) / 10 : 0;

  // Onset threshold: 12 dB above noise floor or 10% of peak, whichever is safer
  const floorLin = Math.pow(10, Math.max(-75, noiseFloorDbfs + 12) / 20);
  const onsetThresh = Math.max(floorLin, peak * 0.08, 0.002);

  const envWin = Math.max(8, Math.round(sr * 0.002)); // 2 ms short-time energy window
  let detectedOffset = -1;
  for (let i = 0; i + envWin <= slice.length; i += Math.max(1, Math.floor(envWin / 2))) {
    let localPeak = 0;
    for (let j = 0; j < envWin; j++) {
      const a = Math.abs(slice[i + j]);
      if (a > localPeak) localPeak = a;
    }
    if (localPeak >= onsetThresh) {
      // Backtrack from the first sample inside [i .. i+envWin) that crossed onsetThresh
      // down to where amplitude first rose above 25% of onsetThresh
      let crossIdx = i;
      for (let j = 0; j < envWin; j++) {
        if (Math.abs(slice[i + j]) >= onsetThresh) {
          crossIdx = i + j;
          break;
        }
      }
      let exact = crossIdx;
      const fineThresh = onsetThresh * 0.25;
      while (exact > 0 && Math.abs(slice[exact - 1]) > fineThresh) {
        exact--;
      }
      detectedOffset = exact;
      break;
    }
  }

  if (detectedOffset < 0) {
    return {
      latencySamples: 0,
      latencyMs: 0,
      peakDbfs,
      recommendedGainTrimDb,
      sustainedClipping,
      detectedOnset: false,
    };
  }

  return {
    latencySamples: detectedOffset,
    latencyMs: Math.round((detectedOffset / sr) * 10000) / 10,
    peakDbfs,
    recommendedGainTrimDb,
    sustainedClipping,
    detectedOnset: true,
  };
}

/**
 * Radix-2 in-place complex FFT for `findSampleAccurateSyncOffset`
 * (pure TS port of `LabAudioReceiver.cpp:336-404`).
 */
function fftRadix2(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((2 * Math.PI) / len) * (inverse ? 1 : -1);
    const wlenRe = Math.cos(ang);
    const wlenIm = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      for (let j = 0; j < half; j++) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + half] * wRe - im[i + j + half] * wIm;
        const vIm = re[i + j + half] * wIm + im[i + j + half] * wRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + half] = uRe - vRe;
        im[i + j + half] = uIm - vIm;
        const nextWRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = nextWRe;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

/**
 * Pure FFT spectral cross-correlation (`R[k] = Rec[k] * conj(Ref[k])`)
 * ported from `ABDAudioLab/src/audio/LabAudioReceiver.cpp:336-404`.
 * Returns the lag in samples where `reference` best aligns within `recorded`.
 */
export function findSampleAccurateSyncOffset(
  reference: Float32Array,
  recorded: Float32Array,
  maxSearchSamples = 65536
): number {
  const refLen = Math.min(reference.length, maxSearchSamples);
  const recLen = Math.min(recorded.length, maxSearchSamples);
  if (refLen === 0 || recLen === 0) return 0;

  const minTotal = refLen + recLen;
  let fftSize = 1;
  while (fftSize < minTotal) fftSize <<= 1;

  const refRe = new Float64Array(fftSize);
  const refIm = new Float64Array(fftSize);
  const recRe = new Float64Array(fftSize);
  const recIm = new Float64Array(fftSize);

  for (let i = 0; i < refLen; i++) refRe[i] = reference[i];
  for (let i = 0; i < recLen; i++) recRe[i] = recorded[i];

  fftRadix2(refRe, refIm, false);
  fftRadix2(recRe, recIm, false);

  // R[k] = Rec[k] * conj(Ref[k])
  for (let k = 0; k < fftSize; k++) {
    const a = recRe[k];
    const b = recIm[k];
    const c = refRe[k];
    const d = -refIm[k];
    recRe[k] = a * c - b * d;
    recIm[k] = a * d + b * c;
  }

  fftRadix2(recRe, recIm, true);

  const searchLimit = Math.max(1, recLen - Math.floor(refLen / 2));
  let bestLag = 0;
  let maxCorr = -Infinity;
  for (let lag = 0; lag < searchLimit; lag++) {
    const val = Math.abs(recRe[lag]);
    if (val > maxCorr) {
      maxCorr = val;
      bestLag = lag;
    }
  }
  return bestLag;
}

// ── 3. Pre-Roll Noise Print with Mandatory DC-Block Pre-Pass ────────────────

/**
 * Fase 37.3 Step A: Applies `dcBlock` FIRST on the 1.0 s silent pre-roll
 * so interface DC offset does not skew low-frequency noise bands, then
 * extracts the stationary `TakeNoiseProfile`.
 */
export function capturePreRollNoiseProfile(
  preRollMono: Float32Array,
  sampleRate: number,
  bands = 8
): TakeNoiseProfile {
  const dcCleaned = dcBlock(preRollMono, sampleRate);
  return computeNoiseProfile(dcCleaned, sampleRate, bands);
}

// ── 4. Musical Grid & Velocity Curves / Manual Table Generator ──────────────

export interface VelocityCurveOptions {
  /** Number of velocity layers (1..8). Ignored when curve === 'classic_neuron_2layer' or 'manual_table'. */
  layerCount: number;
  /** Selected velocity distribution curve. */
  curve: AutoSamplerVelocityCurve;
  /** Minimum MIDI velocity (default: 1). */
  minVelocity?: number;
  /** Maximum MIDI velocity (default: 127). */
  maxVelocity?: number;
  /** Custom manual velocities (1..127) when `curve === 'manual_table'`. */
  manualVelocities?: number[];
}

/**
 * Computes MIDI velocity layers and contiguous `lowVel..highVel` ranges (`1..127`)
 * for all 5 curve types:
 *  - `linear`: evenly spaced across min..max
 *  - `high_precision` (logarithmic): concentrates more layers at high velocities (85..127)
 *  - `low_precision` (exponential): concentrates more layers at soft velocities (1..65)
 *  - `classic_neuron_2layer`: canonical Hartmann [v1=60 (1..63), v2=120 (64..127)]
 *  - `manual_table`: user-supplied velocity list sorted and partitioned contiguously
 */
export function computeVelocityLayers(options: VelocityCurveOptions): VelocityLayerSpec[] {
  if (options.curve === 'classic_neuron_2layer') {
    return [
      { layerIndex: 0, velocity: 60, lowVel: 1, highVel: 63 },
      { layerIndex: 1, velocity: 120, lowVel: 64, highVel: 127 },
    ];
  }

  const minV = Math.max(1, Math.min(127, Math.round(options.minVelocity ?? 20)));
  const maxV = Math.max(minV, Math.min(127, Math.round(options.maxVelocity ?? 127)));

  let rawVels: number[] = [];
  if (options.curve === 'manual_table' && options.manualVelocities && options.manualVelocities.length > 0) {
    const unique = Array.from(
      new Set(
        options.manualVelocities
          .map((v) => Math.max(1, Math.min(127, Math.round(v))))
          .filter((v) => Number.isFinite(v))
      )
    ).sort((a, b) => a - b);
    rawVels = unique.length > 0 ? unique : [100];
  } else {
    const count = Math.max(1, Math.min(8, Math.round(options.layerCount || 1)));
    if (count === 1) {
      rawVels = [maxV];
    } else {
      for (let i = 0; i < count; i++) {
        const t = (i + 1) / count; // 1/N .. 1.0
        let norm = t;
        if (options.curve === 'high_precision') {
          // Concave curve: clusters values toward the top (90..127)
          const u = i / (count - 1);
          norm = 1 - Math.pow(1 - u, 1.85);
        } else if (options.curve === 'low_precision') {
          // Convex curve: clusters values toward the bottom (soft nuances)
          const u = i / (count - 1);
          norm = Math.pow(u, 1.85);
        } else {
          // Linear between minV and maxV
          const u = i / (count - 1);
          norm = u;
        }
        const v = Math.round(minV + norm * (maxV - minV));
        rawVels.push(Math.max(1, Math.min(127, v)));
      }
      // Ensure strictly increasing velocities
      for (let i = 1; i < rawVels.length; i++) {
        if (rawVels[i] <= rawVels[i - 1]) {
          rawVels[i] = Math.min(127, rawVels[i - 1] + 1);
        }
      }
    }
  }

  return rawVels.map((vel, i) => {
    const lowVel = i === 0 ? 1 : Math.floor((rawVels[i - 1] + vel) / 2) + 1;
    const highVel = i === rawVels.length - 1 ? 127 : Math.floor((vel + rawVels[i + 1]) / 2);
    return {
      layerIndex: i,
      velocity: vel,
      lowVel: Math.max(1, Math.min(127, lowVel)),
      highVel: Math.max(1, Math.min(127, highVel)),
    };
  });
}

export type NotesPerOctaveOption = 1 | 2 | 3 | 4 | 6 | 12;

export interface SweepScheduleConfig {
  /** Starting octave number (-1..7, where C1=24, C2=36, C3=48, C4=60) or explicit `startMidiNote`. */
  startOctave?: number;
  /** Explicit starting MIDI note (0..127); overrides `startOctave` when provided. */
  startMidiNote?: number;
  /** Number of octaves to span (1..8, default: 4). */
  octaveCount: number;
  /** Notes sampled per octave: 1 (12st), 2 (6st), 3 (4st), 4 (3st), 6 (2st), 12 (1st). */
  notesPerOctave: NotesPerOctaveOption;
  /** Velocity curve configuration. */
  velocityConfig: VelocityCurveOptions;
  /** Round-robin repetitions per (note, velocity) cell (1..4, default: 1). */
  roundRobinCount?: number;
  /** Extend outermost sampled zones to cover full 0..127 keybed (default: true). */
  extendToFullKeybed?: boolean;
  /** Optional explicit drum/hit list (overrides chromatic octave generator when non-empty). */
  explicitHits?: Array<{
    midiNote: number;
    name?: string;
    muteGroup?: number;
    velocities?: number[];
  }>;
}

/**
 * Generates the complete list of pending `MidiCapturedNoteEvent` cells for an
 * AutoSampler sweep, with contiguous `lowKey..highKey` and `lowVel..highVel`
 * boundaries pre-computed.
 */
export function generateSweepSchedule(config: SweepScheduleConfig): MidiCapturedNoteEvent[] {
  const rrCount = Math.max(1, Math.min(4, Math.round(config.roundRobinCount ?? 1)));
  const defaultVelLayers = computeVelocityLayers(config.velocityConfig);
  const events: MidiCapturedNoteEvent[] = [];

  if (config.explicitHits && config.explicitHits.length > 0) {
    const sortedHits = [...config.explicitHits]
      .map((h) => ({
        ...h,
        midiNote: Math.max(0, Math.min(127, Math.round(h.midiNote))),
      }))
      .sort((a, b) => a.midiNote - b.midiNote);

    for (let hIdx = 0; hIdx < sortedHits.length; hIdx++) {
      const hit = sortedHits[hIdx];
      const velLayers =
        hit.velocities && hit.velocities.length > 0
          ? computeVelocityLayers({
              layerCount: hit.velocities.length,
              curve: 'manual_table',
              manualVelocities: hit.velocities,
            })
          : defaultVelLayers;

      for (const layer of velLayers) {
        for (let rr = 0; rr < rrCount; rr++) {
          events.push({
            index: events.length,
            status: 'pending',
            midiNote: hit.midiNote,
            noteName: midiNoteToStandardName(hit.midiNote),
            velocity: layer.velocity,
            velocityLayerIndex: layer.layerIndex,
            roundRobinIndex: rr,
            ...(hit.name ? { customName: hit.name } : {}),
            ...(hit.muteGroup !== undefined ? { muteGroup: hit.muteGroup } : {}),
            lowKey: hit.midiNote,
            highKey: hit.midiNote,
            lowVel: layer.lowVel,
            highVel: layer.highVel,
            noteOnFrame: 0,
            noteOffFrame: 0,
            tailEndFrame: 0,
          });
        }
      }
    }
    return events;
  }

  // Chromatic / interval sweep from startOctave + octaveCount + notesPerOctave
  const startMidi =
    config.startMidiNote !== undefined
      ? Math.max(0, Math.min(127, Math.round(config.startMidiNote)))
      : Math.max(0, Math.min(120, ((config.startOctave ?? 2) + 1) * 12)); // C2 = 36 when startOctave=2
  const notesPerOct = ([1, 2, 3, 4, 6, 12].includes(config.notesPerOctave)
    ? config.notesPerOctave
    : 4) as NotesPerOctaveOption;
  const stepSemitones = Math.max(1, Math.round(12 / notesPerOct));
  const totalSemitones = Math.max(1, Math.min(108, Math.round(config.octaveCount * 12)));
  const endMidi = Math.min(127, startMidi + totalSemitones);

  const sampledNotes: number[] = [];
  for (let note = startMidi; note < endMidi; note += stepSemitones) {
    sampledNotes.push(note);
  }
  if (sampledNotes.length === 0) sampledNotes.push(startMidi);

  const extendFull = config.extendToFullKeybed !== false;

  for (let nIdx = 0; nIdx < sampledNotes.length; nIdx++) {
    const root = sampledNotes[nIdx];
    const prev = nIdx > 0 ? sampledNotes[nIdx - 1] : null;
    const next = nIdx < sampledNotes.length - 1 ? sampledNotes[nIdx + 1] : null;

    const lowKey =
      prev === null ? (extendFull ? 0 : root) : Math.floor((prev + root) / 2) + 1;
    const highKey =
      next === null ? (extendFull ? 127 : root) : Math.floor((root + next) / 2);

    for (const layer of defaultVelLayers) {
      for (let rr = 0; rr < rrCount; rr++) {
        events.push({
          index: events.length,
          status: 'pending',
          midiNote: root,
          noteName: midiNoteToStandardName(root),
          velocity: layer.velocity,
          velocityLayerIndex: layer.layerIndex,
          roundRobinIndex: rr,
          lowKey: Math.max(0, Math.min(127, lowKey)),
          highKey: Math.max(0, Math.min(127, highKey)),
          lowVel: layer.lowVel,
          highVel: layer.highVel,
          noteOnFrame: 0,
          noteOffFrame: 0,
          tailEndFrame: 0,
        });
      }
    }
  }

  return events;
}

/**
 * Organizes free-form live MIDI performance events (Modo 3: Teclado MIDI en vivo)
 * into contiguous `lowKey..highKey` and `lowVel..highVel` zones automatically.
 */
export function normalizeLiveCapturedMidiEvents(
  rawEvents: Array<{
    midiNote: number;
    velocity: number;
    noteOnFrame: number;
    noteOffFrame: number;
    tailEndFrame: number;
    customName?: string;
    hasPolyphonicOverlap?: boolean;
  }>,
  extendToFullKeybed = true
): MidiCapturedNoteEvent[] {
  if (rawEvents.length === 0) return [];

  // Group events by midiNote
  const byNote = new Map<number, typeof rawEvents>();
  for (const ev of rawEvents) {
    const note = Math.max(0, Math.min(127, Math.round(ev.midiNote)));
    const list = byNote.get(note) ?? [];
    list.push({ ...ev, midiNote: note });
    byNote.set(note, list);
  }

  const sortedNotes = Array.from(byNote.keys()).sort((a, b) => a - b);
  const out: MidiCapturedNoteEvent[] = [];

  for (let nIdx = 0; nIdx < sortedNotes.length; nIdx++) {
    const note = sortedNotes[nIdx];
    const prev = nIdx > 0 ? sortedNotes[nIdx - 1] : null;
    const next = nIdx < sortedNotes.length - 1 ? sortedNotes[nIdx + 1] : null;
    const lowKey =
      prev === null ? (extendToFullKeybed ? 0 : note) : Math.floor((prev + note) / 2) + 1;
    const highKey =
      next === null ? (extendToFullKeybed ? 127 : note) : Math.floor((note + next) / 2);

    // Sort hits for this note by velocity ascending
    const noteHits = (byNote.get(note) ?? []).sort((a, b) => a.velocity - b.velocity);

    // Bucket hits whose velocities are within <= 8 MIDI units as Round-Robin, otherwise distinct velocity layers
    const layers: Array<typeof rawEvents> = [];
    for (const hit of noteHits) {
      const lastLayer = layers[layers.length - 1];
      if (
        lastLayer &&
        Math.abs(hit.velocity - lastLayer[lastLayer.length - 1].velocity) <= 8
      ) {
        lastLayer.push(hit);
      } else {
        layers.push([hit]);
      }
    }

    const layerRepVels = layers.map((l) =>
      Math.round(l.reduce((acc, x) => acc + x.velocity, 0) / l.length)
    );

    for (let lIdx = 0; lIdx < layers.length; lIdx++) {
      const repVel = layerRepVels[lIdx];
      const lowVel =
        lIdx === 0 ? 1 : Math.floor((layerRepVels[lIdx - 1] + repVel) / 2) + 1;
      const highVel =
        lIdx === layers.length - 1
          ? 127
          : Math.floor((repVel + layerRepVels[lIdx + 1]) / 2);

      const rrGroup = layers[lIdx];
      for (let rr = 0; rr < rrGroup.length; rr++) {
        const h = rrGroup[rr];
        out.push({
          index: out.length,
          status: 'recorded',
          midiNote: note,
          noteName: midiNoteToStandardName(note),
          velocity: Math.max(1, Math.min(127, Math.round(h.velocity))),
          velocityLayerIndex: lIdx,
          roundRobinIndex: rr,
          ...(h.customName ? { customName: h.customName } : {}),
          lowKey: Math.max(0, Math.min(127, lowKey)),
          highKey: Math.max(0, Math.min(127, highKey)),
          lowVel: Math.max(1, Math.min(127, lowVel)),
          highVel: Math.max(1, Math.min(127, highVel)),
          noteOnFrame: h.noteOnFrame,
          noteOffFrame: h.noteOffFrame,
          tailEndFrame: h.tailEndFrame,
          ...(h.hasPolyphonicOverlap ? { hasPolyphonicOverlap: true } : {}),
        });
      }
    }
  }

  return out;
}

// ── 5. Smart Pre-Check Pilot Note Analyzer (37.7.1) ─────────────────────────

export interface PilotNoteRecommendation {
  latencySamples: number;
  latencyMs: number;
  noiseFloorDbfs: number;
  peakDbfs: number;
  attackTimeMs: number;
  measuredReleaseTailMs: number;
  recommendedGateDurationMs: number;
  recommendedMaxReleaseMs: number;
  recommendedVelocityLayers: number;
  recommendedVelocityCurve: AutoSamplerVelocityCurve;
  rationaleEs: string;
  rationaleEn: string;
  rationale: string;
}

function resolveAutoSamplerLocale(explicitLocale?: 'es' | 'en'): 'es' | 'en' {
  if (explicitLocale === 'en' || explicitLocale === 'es') return explicitLocale;
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis && globalThis.localStorage) {
      const saved =
        globalThis.localStorage.getItem('abdsynths.locale') ||
        globalThis.localStorage.getItem('abd_locale') ||
        globalThis.localStorage.getItem('neumodmakr.locale');
      if (saved === 'en' || saved === 'es') return saved;
    }
    if (typeof document !== 'undefined' && document.documentElement?.lang) {
      const docLang = document.documentElement.lang.slice(0, 2).toLowerCase();
      if (docLang === 'en' || docLang === 'es') return docLang;
    }
  } catch {
    // Ignore storage/DOM access errors
  }
  return 'es';
}

/**
 * Analyzes a pilot note recording (with pre-roll silence + NoteOn..NoteOff + tail)
 * and recommends optimal `gateDurationMs`, `maxReleaseMs`, and velocity curve.
 */
export function analyzePilotNoteResponse(
  mono: Float32Array,
  sampleRate: number,
  noteOnSentFrame: number,
  noteOffSentFrame: number,
  locale?: 'es' | 'en'
): PilotNoteRecommendation {
  const sr = Math.max(1, sampleRate);
  const preRollEnd = Math.max(1, Math.min(mono.length, Math.round(noteOnSentFrame)));
  const noiseProfile = capturePreRollNoiseProfile(mono.subarray(0, preRollEnd), sr);
  const lat = measureMidiToAudioLatency(mono, sr, noteOnSentFrame, noiseProfile.levelDbfs);
  const effectiveOnset = Math.min(mono.length - 1, noteOnSentFrame + lat.latencySamples);
  const effectiveNoteOff = Math.min(mono.length, Math.max(effectiveOnset + 1, noteOffSentFrame + lat.latencySamples));

  // Estimate attack time from effectiveOnset to 90% of peak inside the gate window
  let maxGateAmp = 0;
  let maxGateIdx = effectiveOnset;
  for (let i = effectiveOnset; i < effectiveNoteOff; i++) {
    const a = Math.abs(mono[i]);
    if (a > maxGateAmp) {
      maxGateAmp = a;
      maxGateIdx = i;
    }
  }
  const attackTimeMs = Math.round(((maxGateIdx - effectiveOnset) / sr) * 1000);

  const decay = evaluateReleaseTailDecay(mono, {
    sampleRate: sr,
    noteOffFrame: effectiveNoteOff,
    noiseFloorDbfs: noiseProfile.levelDbfs,
    maxReleaseMs: 8000,
  });

  const measuredReleaseTailMs = Math.max(
    100,
    Math.round(((decay.approxTailEndFrame - effectiveNoteOff) / sr) * 1000)
  );
  const recommendedGateDurationMs = Math.max(
    500,
    Math.min(6000, Math.round((attackTimeMs * 2.5 + 900) / 100) * 100)
  );
  const recommendedMaxReleaseMs = Math.max(
    400,
    Math.min(8000, Math.round((measuredReleaseTailMs * 1.3 + 200) / 100) * 100)
  );

  const sustainRms = rmsDbfs(mono.subarray(effectiveOnset, effectiveNoteOff));
  const dynamicSpanDb = lat.peakDbfs - noiseProfile.levelDbfs;
  const recommendedVelocityLayers = dynamicSpanDb >= 42 ? 3 : 2;
  const recommendedVelocityCurve: AutoSamplerVelocityCurve =
    attackTimeMs < 35 ? 'high_precision' : 'low_precision';

  const sustainRmsStr = Number.isFinite(sustainRms) ? sustainRms.toFixed(1) : '-∞';
  const rationaleEs = `Latencia medida: ${lat.latencyMs} ms (${lat.latencySamples} smp) · Suelo de ruido: ${noiseProfile.levelDbfs.toFixed(1)} dBFS · Ataque: ${attackTimeMs} ms · Cola de release: ${measuredReleaseTailMs} ms (RMS sostén ${sustainRmsStr} dBFS) → Recomendado Gate ${recommendedGateDurationMs} ms, Release máx ${recommendedMaxReleaseMs} ms y ${recommendedVelocityLayers} capas (${recommendedVelocityCurve === 'high_precision' ? 'más precisión arriba' : 'más precisión abajo'}).`;
  const rationaleEn = `Measured latency: ${lat.latencyMs} ms (${lat.latencySamples} smp) · Noise floor: ${noiseProfile.levelDbfs.toFixed(1)} dBFS · Attack: ${attackTimeMs} ms · Release tail: ${measuredReleaseTailMs} ms (Sustain RMS ${sustainRmsStr} dBFS) → Recommended Gate ${recommendedGateDurationMs} ms, Max Release ${recommendedMaxReleaseMs} ms and ${recommendedVelocityLayers} layers (${recommendedVelocityCurve === 'high_precision' ? 'higher precision at top' : 'higher precision at bottom'}).`;
  const activeLocale = resolveAutoSamplerLocale(locale);

  return {
    latencySamples: lat.latencySamples,
    latencyMs: lat.latencyMs,
    noiseFloorDbfs: noiseProfile.levelDbfs,
    peakDbfs: lat.peakDbfs,
    attackTimeMs,
    measuredReleaseTailMs,
    recommendedGateDurationMs,
    recommendedMaxReleaseMs,
    recommendedVelocityLayers,
    recommendedVelocityCurve,
    rationaleEs,
    rationaleEn,
    rationale: activeLocale === 'es' ? rationaleEs : rationaleEn,
  };
}

/** Creates a fresh `MidiAutoSampleManifest` instance. */
export function createMidiAutoSampleManifest(params: {
  name: string;
  mode: AutoSamplerCaptureMode;
  sampleRate: number;
  channel?: number;
  latencySamples?: number;
  velocityCurve?: AutoSamplerVelocityCurve;
  releaseMode?: AutoSamplerReleaseMode;
  gateDurationMs?: number;
  maxReleaseMs?: number;
  noiseProfile?: TakeNoiseProfile;
  events?: MidiCapturedNoteEvent[];
}): MidiAutoSampleManifest {
  return {
    contractVersion: '1.0.0',
    id: `asman_${Date.now().toString(36)}_${Math.floor(Math.random() * 0xfffff).toString(36)}`,
    name: params.name || 'AutoSample Session',
    mode: params.mode,
    sampleRate: Math.max(1, Math.round(params.sampleRate)),
    channel: Math.max(1, Math.min(16, Math.round(params.channel ?? 1))),
    latencySamples: Math.max(0, Math.round(params.latencySamples ?? 0)),
    velocityCurve: params.velocityCurve ?? 'linear',
    releaseMode: params.releaseMode ?? 'auto_decay',
    gateDurationMs: Math.max(50, Math.round(params.gateDurationMs ?? 1500)),
    maxReleaseMs: Math.max(50, Math.round(params.maxReleaseMs ?? 2000)),
    ...(params.noiseProfile ? { noiseProfile: params.noiseProfile } : {}),
    events: params.events ?? [],
    createdAt: new Date().toISOString(),
  };
}
