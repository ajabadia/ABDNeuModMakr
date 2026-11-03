// ─────────────────────────────────────────────────────────
// @abdsynths/shared — Noise Reduction DSP & Spectral Gate (Fase 30)
//
// Pure TypeScript, zero external dependencies.
// Provides:
//   - Spectral Subtraction / Adaptive Spectral Gate with musical artifact smoothing
//   - Adaptive 50/60 Hz Hum Notch Filtering
//   - User-selected Noise Print capture from explicit audio region (startFrame..endFrame)
// ─────────────────────────────────────────────────────────

import {
  rmsDbfs,
  computeNoiseProfile,
  type NoiseProfile,
} from './takeDsp.ts';

export interface SpectralDenoiseOptions {
  /** Reduction amount in dB (0..48, default: 12 dB) */
  reductionDb?: number;
  /** Gate knee softness (0.1..1.0, default: 0.5) */
  knee?: number;
  /** Transient protection factor (0..1, default: 0.4) */
  transientProtection?: number;
  /** Apply adaptive notch filter at 50 Hz & 60 Hz hum (default: true) */
  removeHum?: boolean;
  /** FFT analysis frame size (power of 2, default: 1024) */
  fftSize?: number;
  /** Hop size in frames (default: fftSize / 4 = 256) */
  hopSize?: number;
}

export interface UserNoiseRegion {
  /** Start sample frame (inclusive) */
  startFrame: number;
  /** End sample frame (exclusive) */
  endFrame: number;
  /** Optional descriptive label */
  label?: string;
}

/**
 * Radix-2 Cooley-Tukey In-place Fast Fourier Transform.
 */
function fft(real: Float32Array, imag: Float32Array): void {
  const n = real.length;
  let j = 0;
  for (let i = 0; i < n - 1; i++) {
    if (i < j) {
      const tr = real[i];
      real[i] = real[j];
      real[j] = tr;
      const ti = imag[i];
      imag[i] = imag[j];
      imag[j] = ti;
    }
    let k = n >> 1;
    while (k <= j) {
      j -= k;
      k >>= 1;
    }
    j += k;
  }

  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wStepR = Math.cos(angle);
    const wStepI = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let wR = 1;
      let wI = 0;
      for (let k = 0; k < half; k++) {
        const uR = real[i + k];
        const uI = imag[i + k];
        const vR = real[i + k + half] * wR - imag[i + k + half] * wI;
        const vI = real[i + k + half] * wI + imag[i + k + half] * wR;

        real[i + k] = uR + vR;
        imag[i + k] = uI + vI;
        real[i + k + half] = uR - vR;
        imag[i + k + half] = uI - vI;

        const nextWR = wR * wStepR - wI * wStepI;
        wI = wR * wStepI + wI * wStepR;
        wR = nextWR;
      }
    }
  }
}

function ifft(real: Float32Array, imag: Float32Array): void {
  const n = real.length;
  // Conjugate
  for (let i = 0; i < n; i++) imag[i] = -imag[i];
  fft(real, imag);
  for (let i = 0; i < n; i++) {
    real[i] /= n;
    imag[i] = -imag[i] / n;
  }
}

/**
 * Creates a Hanning window of size N.
 */
function makeHanning(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  return w;
}

/**
 * Applies a 2nd-order IIR notch filter at freqHz with quality factor Q.
 */
export function applyNotchFilter(
  mono: Float32Array,
  sampleRate: number,
  freqHz: number,
  q = 10
): Float32Array {
  const sr = Math.max(1, sampleRate);
  if (freqHz >= sr / 2 || freqHz <= 5) return mono;

  const out = new Float32Array(mono.length);
  const w0 = (2 * Math.PI * freqHz) / sr;
  const alpha = Math.sin(w0) / (2 * q);
  const b0 = 1;
  const b1 = -2 * Math.cos(w0);
  const b2 = 1;
  const a0 = 1 + alpha;
  const a1 = -2 * Math.cos(w0);
  const a2 = 1 - alpha;

  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;

  for (let i = 0; i < mono.length; i++) {
    const x0 = mono[i];
    const y0 = (b0 / a0) * x0 + (b1 / a0) * x1 + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return out;
}

/**
 * Captures a noise profile explicitly from a user-selected audio slice (or auto-detected silent range).
 */
export function captureNoisePrintFromRegion(
  mono: Float32Array,
  sampleRate: number,
  region: UserNoiseRegion
): NoiseProfile {
  const start = Math.max(0, Math.min(mono.length - 1, region.startFrame));
  const end = Math.max(start + 1, Math.min(mono.length, region.endFrame));
  const slice = mono.subarray(start, end);
  return computeNoiseProfile(slice, sampleRate);
}

/**
 * Performs spectral subtraction and gating over mono audio using the provided noise profile.
 */
export function reduceNoiseWithProfile(
  mono: Float32Array,
  sampleRate: number,
  profile: NoiseProfile,
  options: SpectralDenoiseOptions = {}
): Float32Array {
  if (mono.length === 0) return new Float32Array(0);

  const {
    reductionDb = 12,
    knee = 0.5,
    transientProtection = 0.4,
    removeHum = true,
    fftSize = 1024,
    hopSize = 256,
  } = options;

  let working = mono;

  // 1. Adaptive Hum Removal (50 Hz & 60 Hz) if hum component is within 3 dB of (or above) broadband noise floor
  if (removeHum) {
    if (profile.hum50HzDb > profile.levelDbfs - 3) {
      working = applyNotchFilter(working, sampleRate, 50, 8);
    }
    if (profile.hum60HzDb > profile.levelDbfs - 3) {
      working = applyNotchFilter(working, sampleRate, 60, 8);
    }
  }

  // 2. Short-Time Fourier Transform (STFT) Overlap-Add
  const n = fftSize;
  const hop = hopSize;
  const win = makeHanning(n);
  const out = new Float32Array(working.length + n);
  const windowNorm = new Float32Array(working.length + n);

  const real = new Float32Array(n);
  const imag = new Float32Array(n);

  const noiseFloorLinear = Math.pow(10, profile.levelDbfs / 20);
  const reductionGain = Math.pow(10, -reductionDb / 20);

  const numBins = n / 2 + 1;
  const numBands = profile.spectrumBands.length;

  // Pre-calculate per-bin noise profile threshold
  const binNoiseThresholds = new Float32Array(numBins);
  for (let k = 0; k < numBins; k++) {
    const freq = (k * sampleRate) / n;
    // Map frequency into log bands (40 Hz .. 18 kHz)
    const bandIdx = Math.max(
      0,
      Math.min(
        numBands - 1,
        Math.round((Math.log(Math.max(40, freq) / 40) / Math.log(18000 / 40)) * (numBands - 1))
      )
    );
    const bandWeight = profile.spectrumBands[bandIdx] || (1 / numBands);
    binNoiseThresholds[k] = noiseFloorLinear * (1 + bandWeight * numBands);
  }

  for (let pos = 0; pos < working.length; pos += hop) {
    // Window input
    for (let i = 0; i < n; i++) {
      const idx = pos + i;
      real[i] = idx < working.length ? working[idx] * win[i] : 0;
      imag[i] = 0;
    }

    // Forward FFT
    fft(real, imag);

    // Spectral Gain Calculation
    for (let k = 0; k < numBins; k++) {
      const r = real[k];
      const im = imag[k];
      const mag = Math.sqrt(r * r + im * im) / (n / 2);
      const thresh = binNoiseThresholds[k];

      let gain = 1.0;
      if (mag < thresh) {
        // Below noise floor: suppress by reductionDb
        gain = reductionGain;
      } else if (mag < thresh * (1 + knee * 2)) {
        // Soft knee transition
        const t = (mag - thresh) / (thresh * knee * 2);
        gain = reductionGain + t * (1.0 - reductionGain);
      }

      // Transient protection: if energy is high compared to average, don't over-attenuate
      if (mag > thresh * 3) {
        gain = gain * (1 - transientProtection) + 1.0 * transientProtection;
      }

      real[k] *= gain;
      imag[k] *= gain;
      if (k > 0 && k < n / 2) {
        real[n - k] = real[k];
        imag[n - k] = -imag[k];
      }
    }

    // Inverse FFT
    ifft(real, imag);

    // Overlap-Add to output
    for (let i = 0; i < n; i++) {
      const outIdx = pos + i;
      out[outIdx] += real[i] * win[i];
      windowNorm[outIdx] += win[i] * win[i];
    }
  }

  // Normalize by window overlap and return slice matching original length
  const result = new Float32Array(working.length);
  for (let i = 0; i < working.length; i++) {
    const norm = windowNorm[i] > 1e-4 ? windowNorm[i] : 1;
    result[i] = out[i] / norm;
  }

  return result;
}
