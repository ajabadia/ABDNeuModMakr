// ─────────────────────────────────────────────────────────
// ABDShared — AcousticIntelligence
// Pure-TypeScript deterministic acoustic intelligence module
// ─────────────────────────────────────────────────────────

import { classifyInstrumentAndParameterSet } from './instrumentNameHints';

export type AudioInput = Float32Array | Float32Array[];

export interface AcousticDescriptors {
  detectedF0Hz: number;
  harmonicity: number;
  isPercussiveOrNoise: boolean;
  attackMs: number;
  sustainRatio: number;
  spectralFlatness: number;
  spectralCentroidHz: number;
  inharmonicityB: number;
  transientDensityHz: number;
}

export interface AcousticClassificationResult {
  detectedCategory: string;
  recommendedParameterSet: number;
  confidence: number;
  descriptors: AcousticDescriptors;
}

export type LabAcousticTakeKind =
  | 'sustained-note'
  | 'percussive-transient'
  | 'frequency-sweep'
  | 'self-oscillation'
  | 'silence-or-noise';

export interface LabAcousticTakeClassification {
  kind: LabAcousticTakeKind;
  f0Hz: number;
  midiNote: number;
  centOffset: number;
  channelImbalanceDb: number;
  confidence: number;
  isStereoSilentOrMono: boolean;
  descriptors: {
    rmsDbfs: number;
    peakDbfs: number;
    flatness: number;
    attackMs: number;
    sustainRatio: number;
    harmonicity: number;
  };
}

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

export function toMonoChannel(audio: AudioInput): Float32Array {
  if (audio instanceof Float32Array) return audio;
  if (!audio || audio.length === 0) return new Float32Array(0);
  if (audio.length === 1) return audio[0];
  const left = audio[0];
  const right = audio[1];
  const len = Math.min(left.length, right.length);
  const mono = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    mono[i] = 0.5 * (left[i] + right[i]);
  }
  return mono;
}

export function hzToMidiAndCents(hz: number): { midiNote: number; centOffset: number } {
  if (!Number.isFinite(hz) || hz <= 8.0) {
    return { midiNote: 60, centOffset: 0 };
  }
  const exactMidi = 69 + 12 * Math.log2(hz / 440.0);
  const rounded = clamp(Math.round(exactMidi), 0, 127);
  const centOffset = clamp(Math.round((exactMidi - rounded) * 100), -50, 50);
  return { midiNote: rounded, centOffset };
}

/**
 * Time-domain YIN / MPM pitch detection on mono Float32Array
 */
export function detectPitchYinMpm(
  audio: AudioInput,
  sampleRate: number,
  minFreqHz = 32.0,
  maxFreqHz = 2200.0
): { f0Hz: number; harmonicity: number } {
  const mono = toMonoChannel(audio);
  if (mono.length < 512 || sampleRate <= 0) {
    return { f0Hz: 0, harmonicity: 0 };
  }

  const windowSize = Math.min(4096, Math.max(512, 1 << Math.floor(Math.log2(mono.length))));
  const halfWin = windowSize >>> 1;
  const minTau = Math.max(2, Math.floor(sampleRate / maxFreqHz));
  const maxTau = Math.min(halfWin - 2, Math.ceil(sampleRate / minFreqHz));
  if (maxTau <= minTau + 2) {
    return { f0Hz: 0, harmonicity: 0 };
  }

  const d = new Float32Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau++) {
    let diff = 0;
    for (let j = 0; j < halfWin; j++) {
      const delta = mono[j] - mono[j + tau];
      diff += delta * delta;
    }
    d[tau] = diff;
  }

  // Cumulative mean normalized difference d'(tau)
  const dPrime = new Float32Array(maxTau + 1);
  dPrime[0] = 1.0;
  let runningSum = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    runningSum += d[tau];
    dPrime[tau] = runningSum > 0 ? (d[tau] * tau) / runningSum : 1.0;
  }

  let chosenTau = -1;
  const thresh = 0.15;
  for (let tau = minTau; tau < maxTau; tau++) {
    if (dPrime[tau] < thresh) {
      while (tau + 1 <= maxTau && dPrime[tau + 1] < dPrime[tau]) {
        tau++;
      }
      chosenTau = tau;
      break;
    }
  }

  if (chosenTau < 0) {
    let globalMinVal = Infinity;
    let globalMinTau = -1;
    for (let tau = minTau; tau <= maxTau; tau++) {
      if (dPrime[tau] < globalMinVal) {
        globalMinVal = dPrime[tau];
        globalMinTau = tau;
      }
    }
    if (globalMinVal < 0.40) {
      chosenTau = globalMinTau;
    }
  }

  if (chosenTau <= 0) {
    return { f0Hz: 0, harmonicity: 0 };
  }

  // Interpolación parabólica
  let refinedTau = chosenTau;
  if (chosenTau > 1 && chosenTau < maxTau) {
    const s0 = dPrime[chosenTau - 1];
    const s1 = dPrime[chosenTau];
    const s2 = dPrime[chosenTau + 1];
    const denom = 2 * (s0 - 2 * s1 + s2);
    if (Math.abs(denom) > 1e-9) {
      refinedTau = chosenTau + (s0 - s2) / denom;
    }
  }

  const f0 = sampleRate / refinedTau;
  const harmonicity = clamp(1.0 - dPrime[chosenTau], 0.0, 1.0);
  return { f0Hz: f0, harmonicity };
}

export function extractAcousticDescriptors(
  pcm: Float32Array,
  sampleRate: number
): AcousticDescriptors {
  const yin = detectPitchYinMpm(pcm, sampleRate);
  const n = pcm.length;

  // Envelope analysis (Attack and Sustain)
  const blockSize = Math.max(64, Math.floor(sampleRate * 0.005)); // 5ms blocks
  const numBlocks = Math.max(1, Math.floor(n / blockSize));
  const rmsEnv = new Float32Array(numBlocks);
  let maxRms = 0;
  let maxIdx = 0;

  for (let b = 0; b < numBlocks; b++) {
    let sumSq = 0;
    const offset = b * blockSize;
    for (let i = 0; i < blockSize; i++) {
      const s = pcm[offset + i] || 0;
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / blockSize);
    rmsEnv[b] = rms;
    if (rms > maxRms) {
      maxRms = rms;
      maxIdx = b;
    }
  }

  const attackMs = ((maxIdx * blockSize) / sampleRate) * 1000;

  // Sustain ratio (average level in middle vs peak)
  let midSum = 0;
  const midStart = Math.floor(numBlocks * 0.3);
  const midEnd = Math.floor(numBlocks * 0.7);
  const midCount = Math.max(1, midEnd - midStart);
  for (let b = midStart; b < midEnd; b++) {
    midSum += rmsEnv[b] || 0;
  }
  const sustainRatio = maxRms > 0 ? (midSum / midCount) / maxRms : 0;

  // Zero-crossing rate
  let zcrCount = 0;
  for (let i = 1; i < n; i++) {
    if ((pcm[i] >= 0 && pcm[i - 1] < 0) || (pcm[i] < 0 && pcm[i - 1] >= 0)) {
      zcrCount++;
    }
  }
  const zcr = zcrCount / n;
  const isPercussive = (attackMs < 35 && sustainRatio < 0.28) || (zcr > 0.32 && sustainRatio < 0.3);

  // Spectral centroid approx via simple zero-cross / moment
  const spectralCentroidHz = clamp(zcr * (sampleRate * 0.5), 100, sampleRate * 0.5);
  const spectralFlatness = clamp(zcr * 1.5, 0.01, 0.99);

  return {
    detectedF0Hz: yin.f0Hz,
    harmonicity: yin.harmonicity,
    isPercussiveOrNoise: isPercussive,
    attackMs,
    sustainRatio,
    spectralFlatness,
    spectralCentroidHz,
    inharmonicityB: 0.0001,
    transientDensityHz: attackMs < 30 ? 10 : 1,
  };
}

export function classifyAcousticInstrument(
  descriptorsOrPcm: AcousticDescriptors | Float32Array,
  sampleRate = 44100
): AcousticClassificationResult {
  const desc = descriptorsOrPcm instanceof Float32Array
    ? extractAcousticDescriptors(descriptorsOrPcm, sampleRate)
    : descriptorsOrPcm;

  if (desc.isPercussiveOrNoise) {
    return {
      detectedCategory: 'Drums & Percussion Kit',
      recommendedParameterSet: 8,
      confidence: 0.88,
      descriptors: desc,
    };
  }

  const f0 = desc.detectedF0Hz;
  if (f0 > 0 && f0 < 130) {
    return {
      detectedCategory: 'Bass & Low End',
      recommendedParameterSet: 4,
      confidence: 0.85,
      descriptors: desc,
    };
  }

  if (desc.sustainRatio > 0.65 && desc.attackMs > 80) {
    return {
      detectedCategory: 'Pads & Atmospheres',
      recommendedParameterSet: 6,
      confidence: 0.82,
      descriptors: desc,
    };
  }

  if (desc.attackMs < 40 && desc.sustainRatio > 0.3) {
    return {
      detectedCategory: 'Plucked & Ethnic / World',
      recommendedParameterSet: 3,
      confidence: 0.80,
      descriptors: desc,
    };
  }

  return {
    detectedCategory: 'Keyboards & Acoustic Pianos',
    recommendedParameterSet: 2,
    confidence: 0.75,
    descriptors: desc,
  };
}

export function classifyAcousticSample(
  audio: AudioInput,
  sampleRate: number,
  hintName?: string
): AcousticClassificationResult {
  const pcm = toMonoChannel(audio);
  const desc = extractAcousticDescriptors(pcm, sampleRate);
  if (hintName && hintName.trim().length > 0) {
    const hint = classifyInstrumentAndParameterSet(hintName);
    if (hint.category !== 'Synth & Neutral') {
      return {
        detectedCategory: hint.category,
        recommendedParameterSet: hint.parameterSet,
        confidence: 0.92,
        descriptors: desc,
      };
    }
  }
  return classifyAcousticInstrument(desc, sampleRate);
}

/**
 * Metrological take classifier for ABDAudioLab comparison & pre-triage
 */
export function classifyAcousticTakeForLab(
  left: Float32Array,
  sampleRate: number,
  right?: Float32Array
): LabAcousticTakeClassification {
  const mono = right ? toMonoChannel([left, right]) : left;
  const desc = extractAcousticDescriptors(mono, sampleRate);

  // Measure Peak and RMS
  let sumSqL = 0;
  let peakL = 0;
  for (let i = 0; i < left.length; i++) {
    const s = left[i];
    sumSqL += s * s;
    const a = Math.abs(s);
    if (a > peakL) peakL = a;
  }
  const rmsL = Math.sqrt(sumSqL / Math.max(1, left.length));
  const peakLDbfs = peakL > 0 ? 20 * Math.log10(peakL) : -120;
  const rmsLDbfs = rmsL > 0 ? 20 * Math.log10(rmsL) : -120;

  let imbalanceDb = 0;
  let isStereoSilentOrMono = true;
  if (right && right.length > 0) {
    let sumSqR = 0;
    let peakR = 0;
    for (let i = 0; i < right.length; i++) {
      const s = right[i];
      sumSqR += s * s;
      const a = Math.abs(s);
      if (a > peakR) peakR = a;
    }
    const rmsR = Math.sqrt(sumSqR / Math.max(1, right.length));
    const rmsRDbfs = rmsR > 0 ? 20 * Math.log10(rmsR) : -120;
    imbalanceDb = rmsLDbfs - rmsRDbfs;
    isStereoSilentOrMono = (peakL < 1e-4 && peakR > 1e-3) || (peakR < 1e-4 && peakL > 1e-3);
  }

  const { midiNote, centOffset } = hzToMidiAndCents(desc.detectedF0Hz);

  let kind: LabAcousticTakeKind = 'sustained-note';
  if (peakLDbfs < -60) {
    kind = 'silence-or-noise';
  } else if (desc.isPercussiveOrNoise) {
    kind = 'percussive-transient';
  } else if (desc.harmonicity > 0.92 && desc.sustainRatio > 0.85 && desc.attackMs < 10) {
    kind = 'self-oscillation';
  }

  return {
    kind,
    f0Hz: desc.detectedF0Hz,
    midiNote,
    centOffset,
    channelImbalanceDb: imbalanceDb,
    confidence: desc.harmonicity,
    isStereoSilentOrMono,
    descriptors: {
      rmsDbfs: rmsLDbfs,
      peakDbfs: peakLDbfs,
      flatness: desc.spectralFlatness,
      attackMs: desc.attackMs,
      sustainRatio: desc.sustainRatio,
      harmonicity: desc.harmonicity,
    },
  };
}
