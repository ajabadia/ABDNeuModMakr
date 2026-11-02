// ─────────────────────────────────────────────────────────
// @abdsynths/shared — Code/DspCore/TakeDsp/takeDsp.ts
//
// Portable take DSP for recording utilities across the suite
// (ABDNeuModMakr Rec Recorder, ABDAudioLab WebUI, …).
//
// Pure TypeScript, zero dependencies, no DOM, no WebAudio:
// every function operates on Float32Array mono frames and can
// run in browsers, Node/vitest and (via port) JUCE/C++.
//
// Contents:
//   - Peak / RMS normalization + DC-blocker (edit-stage core;
//     RawSamplerExporter.normalizeChannels remains the export-stage one)
//   - Silence-range detector with hangover (Fase 30 building block)
//   - Noise-floor + hum profile ("huella de ruido" v1)
//   - Take router: chromatic vs drums from acoustic descriptors
// ─────────────────────────────────────────────────────────

export interface SilenceRange {
  /** First silent frame (inclusive). */
  startFrame: number;
  /** First non-silent frame after the range (exclusive). */
  endFrame: number;
  /** Duration of the range in milliseconds. */
  durationMs: number;
}

export interface SilenceDetectorOptions {
  /** RMS gate threshold in dBFS (default: -48). */
  thresholdDb?: number;
  /** Minimum silence length to report (default: 120 ms). */
  minSilenceMs?: number;
  /** Hangover: bridge gaps shorter than this (default: 40 ms). */
  hangoverMs?: number;
  /** RMS analysis window (default: 10 ms). */
  windowMs?: number;
}

export interface NoiseProfile {
  /** Broadband RMS level in dBFS. */
  levelDbfs: number;
  /** Normalized log-spaced band magnitudes (0..1, sum = 1 when energy > 0). */
  spectrumBands: number[];
  /** Goertzel magnitude at 50 Hz in dBFS. */
  hum50HzDb: number;
  /** Goertzel magnitude at 60 Hz in dBFS. */
  hum60HzDb: number;
}

export type TakeKind = 'chromatic' | 'drums' | 'unknown';

export interface TakeFeatures {
  /** 0..1 tonal-vs-noise harmonicity (from AcousticIntelligence-style descriptors). */
  harmonicity01: number;
  /** 0..1 transient/onset density over the take. */
  transientDensity01: number;
  /** 0..1 pitch-tracker confidence / f0 stability. */
  f0Confidence01: number;
  /** 0..1 spectral flatness (1 = white-noise-like). */
  spectralFlatness01: number;
}

export interface TakeClassification {
  kind: TakeKind;
  /** 0..1 decision confidence. */
  confidence: number;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function dbfsFromRms(rms: number): number {
  if (!(rms > 0)) return -Infinity;
  return 20 * Math.log10(rms);
}

/** Peak absolute amplitude (0..1+) of a mono buffer. */
export function peakAmplitude(mono: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < mono.length; i++) {
    const a = Math.abs(mono[i]);
    if (a > peak) peak = a;
  }
  return peak;
}

/** RMS level of a mono buffer in dBFS (-Infinity when silent). */
export function rmsDbfs(mono: Float32Array): number {
  if (mono.length === 0) return -Infinity;
  let sum = 0;
  for (let i = 0; i < mono.length; i++) sum += mono[i] * mono[i];
  return dbfsFromRms(Math.sqrt(sum / mono.length));
}

/**
 * Peak-normalizes a copy of `mono` so its peak hits `peakDbfsTarget`
 * (default −1.0 dBFS). Silent input is returned unchanged.
 */
export function normalizePeak(mono: Float32Array, peakDbfsTarget = -1.0): Float32Array {
  const out = new Float32Array(mono);
  const peak = peakAmplitude(out);
  if (!(peak > 0)) return out;
  const target = Math.pow(10, peakDbfsTarget / 20);
  const gain = target / peak;
  for (let i = 0; i < out.length; i++) out[i] *= gain;
  return out;
}

/**
 * RMS-normalizes a copy of `mono` towards `targetRmsDbfs`
 * (default −18 dBFS), capping the applied gain at `maxGainDb`
 * (default 24 dB) so noise floors are never boosted recklessly.
 */
export function normalizeRms(
  mono: Float32Array,
  targetRmsDbfs = -18,
  maxGainDb = 24
): Float32Array {
  const out = new Float32Array(mono);
  const current = rmsDbfs(out);
  if (!Number.isFinite(current)) return out;
  const wantedGainDb = Math.min(targetRmsDbfs - current, maxGainDb);
  const gain = Math.pow(10, wantedGainDb / 20);
  for (let i = 0; i < out.length; i++) out[i] *= gain;
  return out;
}

/**
 * First-order DC-blocker (high-pass) copy of `mono`.
 * y[n] = x[n] − x[n−1] + R·y[n−1], R from `cutoffHz` (default 20 Hz).
 */
export function dcBlock(mono: Float32Array, sampleRate: number, cutoffHz = 20): Float32Array {
  const out = new Float32Array(mono.length);
  const sr = Math.max(1, sampleRate);
  const r = 1 - (2 * Math.PI * Math.max(0.5, cutoffHz)) / sr;
  let prevX = 0;
  let prevY = 0;
  for (let i = 0; i < mono.length; i++) {
    const x = mono[i];
    const y = x - prevX + r * prevY;
    out[i] = y;
    prevX = x;
    prevY = y;
  }
  return out;
}

/**
 * Finds silent ranges in `mono` using an RMS gate with hangover:
 * gaps shorter than `hangoverMs` are bridged so reverb tails and
 * ghost notes don't split a take. Ranges shorter than
 * `minSilenceMs` are discarded.
 */
export function detectSilenceRanges(
  mono: Float32Array,
  sampleRate: number,
  options: SilenceDetectorOptions = {}
): SilenceRange[] {
  const {
    thresholdDb = -48,
    minSilenceMs = 120,
    hangoverMs = 40,
    windowMs = 10,
  } = options;
  const sr = Math.max(1, Math.round(sampleRate));
  const win = Math.max(1, Math.round((sr * windowMs) / 1000));
  const minFrames = Math.round((sr * minSilenceMs) / 1000);
  const hangFrames = Math.round((sr * hangoverMs) / 1000);
  const threshold = Math.pow(10, thresholdDb / 20);
  const ranges: SilenceRange[] = [];
  if (mono.length === 0) return ranges;

  let runStart = -1;
  let pendingGap = 0;
  // `gapStart` marks where the current silent run would resume after bridging.
  for (let i = 0; i < mono.length; i += win) {
    const end = Math.min(mono.length, i + win);
    let sum = 0;
    for (let k = i; k < end; k++) sum += mono[k] * mono[k];
    const rms = Math.sqrt(sum / (end - i));
    if (rms <= threshold) {
      if (runStart < 0) runStart = i;
      pendingGap = 0;
    } else {
      if (runStart >= 0) {
        pendingGap += end - i;
        if (pendingGap > hangFrames) {
          const runEnd = end - pendingGap;
          if (runEnd - runStart >= minFrames) {
            ranges.push({
              startFrame: runStart,
              endFrame: runEnd,
              durationMs: ((runEnd - runStart) / sr) * 1000,
            });
          }
          runStart = -1;
          pendingGap = 0;
        }
      }
    }
  }
  if (runStart >= 0) {
    const runEnd = mono.length - (pendingGap > 0 && pendingGap <= hangFrames ? 0 : pendingGap);
    const finalEnd = pendingGap > 0 && pendingGap <= hangFrames ? mono.length : runEnd;
    if (finalEnd - runStart >= minFrames) {
      ranges.push({
        startFrame: runStart,
        endFrame: finalEnd,
        durationMs: ((finalEnd - runStart) / sr) * 1000,
      });
    }
  }
  return ranges;
}

/**
 * Trims leading/trailing silence (per `detectSilenceRanges`) and
 * returns the trimmed copy plus how much was removed on each side.
 */
export function trimSilence(
  mono: Float32Array,
  sampleRate: number,
  options: SilenceDetectorOptions = {}
): { data: Float32Array; leadingMs: number; trailingMs: number } {
  const sr = Math.max(1, Math.round(sampleRate));
  const ranges = detectSilenceRanges(mono, sr, options);
  let start = 0;
  let end = mono.length;
  for (const r of ranges) {
    if (r.startFrame === 0) start = Math.max(start, r.endFrame);
    if (r.endFrame >= mono.length) end = Math.min(end, r.startFrame);
  }
  if (end <= start) return { data: new Float32Array(0), leadingMs: 0, trailingMs: 0 };
  return {
    data: mono.slice(start, end),
    leadingMs: (start / sr) * 1000,
    trailingMs: ((mono.length - end) / sr) * 1000,
  };
}

/** Single-frequency magnitude in dBFS via the Goertzel algorithm. */
function goertzelDbfs(mono: Float32Array, sampleRate: number, freqHz: number): number {
  const n = mono.length;
  if (n === 0) return -Infinity;
  const k = (n * freqHz) / sampleRate;
  const omega = (2 * Math.PI * k) / n;
  const cos = Math.cos(omega);
  const coeff = 2 * cos;
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    s0 = mono[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
  if (!(power > 0)) return -Infinity;
  const rms = Math.sqrt(power) / n;
  return dbfsFromRms(rms * Math.SQRT2);
}

/**
 * Computes a compact noise profile ("huella de ruido" v1) over what is
 * assumed to be a noise-only segment: broadband level, normalized
 * log-spaced band energies and 50/60 Hz hum components.
 */
export function computeNoiseProfile(
  mono: Float32Array,
  sampleRate: number,
  bands = 16
): NoiseProfile {
  const sr = Math.max(1, sampleRate);
  const bandMags: number[] = [];
  const lo = 40;
  const hi = Math.min(18000, sr / 2 - 100);
  const count = Math.max(4, Math.round(bands));
  for (let b = 0; b < count; b++) {
    const f = lo * Math.pow(hi / lo, b / Math.max(1, count - 1));
    bandMags.push(Math.pow(10, goertzelDbfs(mono, sr, f) / 20));
  }
  const sum = bandMags.reduce((a, v) => a + v, 0);
  return {
    levelDbfs: rmsDbfs(mono),
    spectrumBands: sum > 0 ? bandMags.map((v) => v / sum) : bandMags.map(() => 0),
    hum50HzDb: goertzelDbfs(mono, sr, 50),
    hum60HzDb: goertzelDbfs(mono, sr, 60),
  };
}

/**
 * Routes a recorded take to `chromatic` or `drums` from acoustic
 * descriptors (computed upstream, e.g. by AcousticIntelligence).
 * Tonal + stable f0 → chromatic; dense transients + flat spectrum → drums.
 */
export function classifyTake(f: TakeFeatures): TakeClassification {
  const harmonicity = clamp01(f.harmonicity01);
  const transients = clamp01(f.transientDensity01);
  const f0 = clamp01(f.f0Confidence01);
  const flatness = clamp01(f.spectralFlatness01);

  const chromaticScore = 0.45 * harmonicity + 0.35 * f0 + 0.2 * (1 - flatness);
  const drumsScore = 0.5 * transients + 0.3 * flatness + 0.2 * (1 - harmonicity);

  if (chromaticScore < 0.35 && drumsScore < 0.35) {
    return { kind: 'unknown', confidence: 1 - Math.max(chromaticScore, drumsScore) };
  }
  if (chromaticScore >= drumsScore) {
    return {
      kind: 'chromatic',
      confidence: clamp01(0.5 + (chromaticScore - drumsScore)),
    };
  }
  return {
    kind: 'drums',
    confidence: clamp01(0.5 + (drumsScore - chromaticScore)),
  };
}
