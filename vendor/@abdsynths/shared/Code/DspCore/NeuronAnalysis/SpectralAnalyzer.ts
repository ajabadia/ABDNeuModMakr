// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — SpectralAnalyzer
//
// Pure TypeScript reimplementation of NEURONiK::ModelMaker::Analysis::SpectralAnalyzer
// (SpectralAnalyzer.h / SpectralAnalyzer.cpp).
//
// Features:
//   - 8192-point FFT with 4-term Blackman-Harris window
//   - Refined HPS (Harmonic Product Spectrum, k=2..4) with weak-fundamental octave ladder
//   - Two-pass through-the-origin Least-Squares (LS) harmonic grid fitting across active windows
//   - Octave family battery evaluation ({seed/2, seed, seed*2}) by global RMS residual in cents
//   - Sub-bin parabolic log-magnitude peak-picking with half-harmonic band & local-maximum guard
//   - Interlaced sub-grid (odd multiples of f0/2) detection & isolation
//   - Multi-frame static analysis (up to 6 active windows, RMS silence rejection)
//   - Temporal multi-frame analysis (1..16 frames) with octave-fold pre-filter and
//     automatic envelope-shape / interlaced layer separation (up to 3 layers)
// ─────────────────────────────────────────────────────────

import { FftEngine, createWindowTable } from './FftEngine.ts';
import {
  clusterTraces,
  createEmptyLayerClustering,
  LAYER_CLUSTERING_CONSTANTS,
  type LayerClusteringResult,
  type LayerMetric,
} from './LayerClustering.ts';
import {
  SpectralModelData,
  SPECTRAL_MODEL_CONSTANTS,
  type GridResidualBand,
  type OctaveFoldVerdict,
} from './GridIndicator.ts';

export interface PartialMeasurement {
  amplitude: number;
  offsetHz: number;
  peakHz: number;
  interlaced: boolean;
}

export interface OctaveCandidate {
  candidateHz: number;
  fittedHz: number;
  residCents: number;
  observations: number;
  interlaced: number;
  valid: boolean;
}

export type AudioInput = Float32Array | Float32Array[];

function clamp(val: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, val));
}

function extractChannels(audio: AudioInput): {
  left: Float32Array;
  right: Float32Array | null;
  numSamples: number;
} {
  if (audio instanceof Float32Array) {
    return { left: audio, right: null, numSamples: audio.length };
  }
  const left = audio[0] ?? new Float32Array(0);
  const right = audio.length > 1 ? audio[1] : null;
  return { left, right, numSamples: left.length };
}

export class SpectralAnalyzer {
  public static readonly fftOrder = 13; // 2^13 = 8192
  public static readonly fftSize = 1 << SpectralAnalyzer.fftOrder;
  public static readonly numBins = (SpectralAnalyzer.fftSize >>> 1) + 1;
  public static readonly maxFrames = 6;
  public static readonly kFrameRmsFloor = 1.0e-4;
  public static readonly kPartialFloor = 1.0e-3;
  public static readonly kMinLsObservations = 4;
  public static readonly pitchGuardCents = 150.0;
  public static readonly kOctaveFoldCents = 100.0;
  public static readonly residualGreenCents = SPECTRAL_MODEL_CONSTANTS.residualGreenCents;
  public static readonly residualAmberCents = SPECTRAL_MODEL_CONSTANTS.residualAmberCents;

  private readonly fft: FftEngine;
  private readonly windowTable: Float32Array;
  private readonly fftData: Float32Array;
  private readonly magnitudeSpectrum: Float32Array;
  private readonly frameSpectrum: Float32Array;

  private lastGuardCents = 0.0;
  private gridResidCents = -1.0;
  private gridObsCount = 0;
  private gridInterlacedCount = 0;
  private readonly layerGridResidCents = new Float32Array([-1.0, -1.0, -1.0]);
  private readonly layerGridObsCount = new Int32Array([0, 0, 0]);
  private entrelazadaLayerIndex = -1;

  private lastFold: OctaveFoldVerdict = {
    foldCents: -1.0,
    rawCents: 0.0,
    observations: 0,
    octaveFlips: 0,
    biGrid: false,
  };
  private lastClustering: LayerClusteringResult = createEmptyLayerClustering();
  private lastLayerRejected = false;
  private lastMetric: LayerMetric = 'descriptors';
  private clusteringSkipped = false;

  constructor() {
    this.fft = new FftEngine(SpectralAnalyzer.fftOrder);
    this.windowTable = createWindowTable(SpectralAnalyzer.fftSize, 'blackman-harris');
    this.fftData = new Float32Array(SpectralAnalyzer.fftSize * 2);
    this.magnitudeSpectrum = new Float32Array(SpectralAnalyzer.numBins);
    this.frameSpectrum = new Float32Array(SpectralAnalyzer.numBins);
  }

  /**
   * Estimator floor: 50 Hz quantized to FFT bin width.
   */
  public static anchorFloorHz(sampleRate: number): number {
    const binWidth = sampleRate / SpectralAnalyzer.fftSize;
    const minBin = clamp(
      Math.trunc(50.0 / binWidth),
      2,
      SpectralAnalyzer.fftSize >>> 1
    );
    return minBin * binWidth;
  }

  /**
   * Diagnostics for interlaced sub-grid peak (odd harmonic of f0 / 2).
   */
  public static isInterlacedPeak(
    peakHz: number,
    targetFreq: number,
    rootFrequency: number
  ): boolean {
    if (peakHz <= 0.0 || targetFreq <= 0.0 || rootFrequency <= 0.0) {
      return false;
    }
    const halfGrid = rootFrequency * 0.5;
    const oddF = Math.round(peakHz / halfGrid);
    if (oddF < 1.0) return false;

    const oddI = Math.round(oddF);
    if (oddI % 2 !== 1) return false;

    const oddHz = oddF * halfGrid;
    const oddUsable = Math.abs(peakHz - oddHz) < 0.25 * rootFrequency;
    const onOwnGrid = Math.abs(peakHz - targetFreq) < 0.25 * rootFrequency;
    if (!oddUsable || onOwnGrid) return false;

    const k = Math.round(targetFreq / rootFrequency);
    const inBand = oddF >= 2 * k - 1 - 0.5 && oddF <= 2 * k + 1 + 0.5;
    return inBand;
  }

  /**
   * Fold frequency deviation in cents into (-600, +600] (octave equivalence).
   */
  public static foldOctaveCents(hz: number, refHz: number): number {
    if (hz <= 0.0 || refHz <= 0.0) return 0.0;
    let dev = 1200.0 * Math.log2(hz / refHz);
    while (dev > 600.0) dev -= 1200.0;
    while (dev <= -600.0) dev += 1200.0;
    return dev;
  }

  /**
   * Measures octave-folded dispersion across per-frame f0 estimates against refHz.
   */
  public static measureOctaveFold(
    frameF0s: ArrayLike<number>,
    refHz: number
  ): OctaveFoldVerdict {
    const out: OctaveFoldVerdict = {
      foldCents: -1.0,
      rawCents: 0.0,
      observations: 0,
      octaveFlips: 0,
      biGrid: false,
    };
    if (refHz <= 0.0) return out;

    let maxFolded = 0.0;
    let maxRaw = 0.0;

    for (let i = 0; i < frameF0s.length; i++) {
      const f0k = frameF0s[i];
      if (f0k <= 0.0) continue;

      const raw = Math.abs(1200.0 * Math.log2(f0k / refHz));
      const folded = Math.abs(SpectralAnalyzer.foldOctaveCents(f0k, refHz));

      maxRaw = Math.max(maxRaw, raw);
      maxFolded = Math.max(maxFolded, folded);
      out.observations++;

      if (raw > 600.0) {
        out.octaveFlips++;
      }
    }

    if (out.observations === 0) return out;

    out.foldCents = maxFolded;
    out.rawCents = maxRaw;
    out.biGrid = maxFolded > SpectralAnalyzer.kOctaveFoldCents;
    return out;
  }

  // ── Public Diagnostic Accessors ─────────────────────────

  public lastPitchGuardCents(): number {
    return this.lastGuardCents;
  }

  public lastGridResidualCents(): number {
    return this.gridResidCents;
  }

  public lastGridObservations(): number {
    return this.gridObsCount;
  }

  public lastGridInterlacedCount(): number {
    return this.gridInterlacedCount;
  }

  public lastGridTotalObservations(): number {
    return this.gridObsCount + this.gridInterlacedCount;
  }

  public gridResidualBand(): GridResidualBand {
    if (this.gridResidCents < 0.0) return 'no-data';
    if (this.gridResidCents <= SpectralAnalyzer.residualGreenCents) return 'green';
    if (this.gridResidCents <= SpectralAnalyzer.residualAmberCents) return 'amber';
    return 'orange';
  }

  public gridResidualNotice(): string {
    if (this.gridResidCents < 0.0) {
      return 'residuo n/d (material insuficiente)';
    }
    return `residuo ${this.gridResidCents.toFixed(1)} cents (${this.gridObsCount} picos)`;
  }

  public lastOctaveFold(): OctaveFoldVerdict {
    return this.lastFold;
  }

  public lastLayerCount(): number {
    return this.lastClustering.layerCount;
  }

  public lastLayerOfTrace(partial: number): number {
    const idx = clamp(partial, 0, LAYER_CLUSTERING_CONSTANTS.kMaxTraces - 1);
    return this.lastClustering.layerOfTrace[idx];
  }

  public lastLayerTraces(layer: number): number {
    if (layer < 0 || layer >= LAYER_CLUSTERING_CONSTANTS.kMaxLayers) return 0;
    return this.lastClustering.layerTraces[layer];
  }

  public lastLayerGridResidCents(layer: number): number {
    if (layer < 0 || layer >= LAYER_CLUSTERING_CONSTANTS.kMaxLayers) return -1.0;
    return this.layerGridResidCents[layer];
  }

  public lastLayerGridObsCount(layer: number): number {
    if (layer < 0 || layer >= LAYER_CLUSTERING_CONSTANTS.kMaxLayers) return 0;
    return this.layerGridObsCount[layer];
  }

  public lastLayerBand(layer: number): string {
    const r = this.lastLayerGridResidCents(layer);
    if (r < 0.0) return 'n/d';
    if (r <= SpectralAnalyzer.residualGreenCents) return 'verde';
    if (r <= SpectralAnalyzer.residualAmberCents) return 'amarillo';
    return 'naranja';
  }

  public lastEntrelazadaLayer(): number {
    return this.entrelazadaLayerIndex;
  }

  public lastHasEntrelazada(): boolean {
    return (
      this.entrelazadaLayerIndex >= 0 &&
      this.entrelazadaLayerIndex < LAYER_CLUSTERING_CONSTANTS.kMaxLayers
    );
  }

  public lastClusteringRef(): LayerClusteringResult {
    return this.lastClustering;
  }

  public lastLayerMetric(): LayerMetric {
    return this.lastMetric;
  }

  public lastLayerGridRejected(): boolean {
    return this.lastLayerRejected;
  }

  public lastClusteringSkipped(): boolean {
    return this.clusteringSkipped;
  }

  // ── Core DSP Methods ────────────────────────────────────

  /**
   * Local maximum +-1 bin around `center` in `magnitudeSpectrum`.
   */
  public refineSpectralPeak(center: number): number {
    const numBins = SpectralAnalyzer.numBins;
    let b = clamp(center, 2, numBins - 2);
    let m = this.magnitudeSpectrum[b];
    if (b > 1 && this.magnitudeSpectrum[b - 1] > m) {
      m = this.magnitudeSpectrum[b - 1];
      b--;
    }
    if (b < numBins - 1 && this.magnitudeSpectrum[b + 1] > m) {
      b++;
    }
    return b;
  }

  /**
   * Refined HPS pitch detector on currently published `magnitudeSpectrum`.
   */
  public detectPitchImpl(sampleRate: number): number {
    const numBins = SpectralAnalyzer.numBins;
    const binWidth = sampleRate / SpectralAnalyzer.fftSize;
    const minBin = clamp(
      Math.trunc(SpectralAnalyzer.anchorFloorHz(sampleRate) / binWidth),
      2,
      numBins - 1
    );
    const maxBin = clamp(Math.trunc(2000.0 / binWidth), 2, numBins - 1);

    // 1. Anchor: raw peak in musical range + +-1 bin local refinement
    let rawBin = 0;
    let rawMax = -1.0;
    for (let i = minBin; i <= maxBin; i++) {
      if (this.magnitudeSpectrum[i] > rawMax) {
        rawMax = this.magnitudeSpectrum[i];
        rawBin = i;
      }
    }
    if (rawBin === 0) return 130.81; // Default C3 if silence

    const anchor = this.refineSpectralPeak(rawBin);

    // 2. Classic HPS product k=2..4 on the same spectrum
    const hps = new Float32Array(numBins);
    hps.set(this.magnitudeSpectrum);
    for (let down = 2; down <= 4; down++) {
      const limit = Math.trunc(numBins / down);
      for (let i = 0; i < limit; i++) {
        hps[i] *= this.magnitudeSpectrum[i * down];
      }
      for (let i = limit; i < numBins; i++) {
        hps[i] = 0.0;
      }
    }

    // 3. Product peak bounded to [anchor/2 - 1, anchor*2 + 1]
    const wLo = clamp((anchor >>> 1) - 1, minBin, maxBin);
    const wHi = clamp(anchor * 2 + 1, wLo, maxBin);
    let prodBin = wLo;
    let prodMax = -1.0;
    for (let i = wLo; i <= wHi; i++) {
      if (hps[i] > prodMax) {
        prodMax = hps[i];
        prodBin = i;
      }
    }

    // 4. Candidate can only step down one octave from anchor (with >= -40 dB support)
    let base = anchor;
    const anchorHz = anchor * binWidth;
    const prodHz = prodBin * binWidth;
    const centsToHalf = 1200.0 * Math.log2(prodHz / (0.5 * anchorHz));
    const octaveBelow = Math.abs(centsToHalf) <= 60.0;
    const hasSupport =
      this.magnitudeSpectrum[prodBin] >= 0.01 * this.magnitudeSpectrum[anchor];
    if (octaveBelow && hasSupport) {
      base = prodBin;
    }

    // 5. Musical octave ladder (f0, 2f0, 3f0, 4f0)
    const bandPeak = (centerHz: number, halfHz: number): number => {
      let lo = Math.floor((centerHz - halfHz) / binWidth);
      let hi = Math.ceil((centerHz + halfHz) / binWidth);
      lo = clamp(lo, 1, numBins - 2);
      hi = clamp(hi, lo, numBins - 2);
      if (hi <= lo) return 0.0;

      let peakMag = -1.0;
      for (let b = lo; b <= hi; b++) {
        if (this.magnitudeSpectrum[b] > peakMag) {
          peakMag = this.magnitudeSpectrum[b];
        }
      }
      return peakMag;
    };

    const f0Hz = base * binWidth;
    const mOdd = bandPeak(1.0 * f0Hz, 0.25 * f0Hz);
    const m2 = bandPeak(2.0 * f0Hz, 0.25 * f0Hz);
    const m3 = bandPeak(3.0 * f0Hz, 0.25 * f0Hz);

    if (m2 > 1.0e-6 && mOdd < 0.15 * m2 && m3 < 0.15 * m2) {
      base = Math.trunc(base / 2);
    } else {
      const m4 = bandPeak(4.0 * f0Hz, 0.25 * f0Hz);
      if (m2 > mOdd && m2 > m3 && m2 > 2.0 * mOdd && m4 < 0.25 * m3) {
        base *= 2;
      }
    }

    // 6. Sub-bin parabolic interpolation on magnitudeSpectrum
    let frequency = base * binWidth;
    if (base > 1 && base < numBins - 1) {
      const yl = this.magnitudeSpectrum[base - 1];
      const y0 = this.magnitudeSpectrum[base];
      const yr = this.magnitudeSpectrum[base + 1];
      const den = yl - 2.0 * y0 + yr;
      if (Math.abs(den) > 1.0e-9) {
        const p = clamp((0.5 * (yl - yr)) / den, -0.5, 0.5);
        frequency = (base + p) * binWidth;
      }
    }

    return frequency;
  }

  public detectPitchFromSpectrum(sampleRate: number): number {
    return this.detectPitchImpl(sampleRate);
  }

  /**
   * Detects fundamental frequency (F0) across the audio buffer using HPS seed
   * followed by 2-pass Least Squares harmonic grid refinement.
   */
  public detectPitch(audio: AudioInput, sampleRate: number): number {
    this.gridResidCents = -1.0;
    this.gridObsCount = 0;
    this.gridInterlacedCount = 0;

    const { left, right, numSamples } = extractChannels(audio);
    if (numSamples === 0) return 0.0;

    this.fftData.fill(0.0);
    const count = Math.min(numSamples, SpectralAnalyzer.fftSize);
    for (let i = 0; i < count; i++) {
      let s = left[i];
      if (right !== null) s = (s + right[i]) * 0.5;
      this.fftData[i] = s;
    }

    this.transformCurrentFrame(count);
    for (let i = 0; i < SpectralAnalyzer.numBins; i++) {
      this.magnitudeSpectrum[i] = this.fftData[i];
    }

    const seed = this.detectPitchImpl(sampleRate);
    return this.fitGridLeastSquares(audio, sampleRate, seed);
  }

  /**
   * Refines a user-supplied F0 seed via 2-pass Least Squares and updates grid residual metrics.
   */
  public refineGrid(audio: AudioInput, sampleRate: number, seedHz: number): number {
    return this.fitGridLeastSquares(audio, sampleRate, seedHz);
  }

  /**
   * Peak-picking within half harmonic spacing around `targetFreq` + parabolic log-magnitude
   * sub-bin interpolation and interlaced sub-grid check.
   */
  public measurePartial(
    targetFreq: number,
    rootFrequency: number,
    sampleRate: number
  ): PartialMeasurement {
    const result: PartialMeasurement = {
      amplitude: 0.0,
      offsetHz: 0.0,
      peakHz: 0.0,
      interlaced: false,
    };

    const binWidth = sampleRate / SpectralAnalyzer.fftSize;
    if (targetFreq <= 0.0 || targetFreq >= sampleRate * 0.5) {
      return result;
    }

    const numBins = SpectralAnalyzer.numBins;
    const nominalBin = Math.round(targetFreq / binWidth);
    if (nominalBin < 1 || nominalBin >= numBins - 1) {
      return result;
    }

    const spacingBins = rootFrequency / binWidth;
    const halfWin = Math.max(0, Math.trunc(spacingBins * 0.5) - 1);

    let bestBin = nominalBin;
    let bestMag = -1.0;
    for (let b = nominalBin - halfWin; b <= nominalBin + halfWin; b++) {
      if (b < 1 || b >= numBins - 1) continue;
      const mag = this.magnitudeSpectrum[b];
      if (mag > bestMag) {
        bestMag = mag;
        bestBin = b;
      }
    }

    // Local maximum guard: reject skirts of neighboring partials
    if (bestMag > 0.0) {
      const leftMag = this.magnitudeSpectrum[bestBin - 1];
      const rightMag = this.magnitudeSpectrum[bestBin + 1];
      if (leftMag > bestMag || rightMag > bestMag) {
        bestMag = 0.0;
        bestBin = nominalBin;
      }
    }

    result.amplitude = bestMag > 0.0 ? bestMag : 0.0;

    // Parabolic sub-bin interpolation on log-magnitude
    const eps = 1.0e-12;
    const a = Math.log(this.magnitudeSpectrum[bestBin - 1] + eps);
    const b = Math.log(this.magnitudeSpectrum[bestBin] + eps);
    const c = Math.log(this.magnitudeSpectrum[bestBin + 1] + eps);
    const denom = a - 2.0 * b + c;

    let delta = 0.0;
    if (Math.abs(denom) > 1.0e-9) {
      delta = clamp((0.5 * (a - c)) / denom, -0.5, 0.5);
    }

    const peakFreq = (bestBin + delta) * binWidth;
    result.peakHz = peakFreq;
    result.interlaced = SpectralAnalyzer.isInterlacedPeak(
      peakFreq,
      targetFreq,
      rootFrequency
    );
    if (result.interlaced) {
      result.offsetHz = 0.0;
      return result;
    }

    const maxOffset = halfWin * binWidth;
    result.offsetHz = clamp(peakFreq - targetFreq, -maxOffset, maxOffset);
    return result;
  }

  /**
   * Static multi-frame spectral analysis (averages up to 6 active windows across the buffer).
   */
  public analyze(
    audio: AudioInput,
    sampleRate: number,
    rootFrequency: number,
    fixedGrid = false
  ): SpectralModelData {
    const model = new SpectralModelData();
    const { left, right, numSamples } = extractChannels(audio);
    if (numSamples <= 0) return model;

    this.measurePitchDeviation(audio, sampleRate, rootFrequency);

    const numBins = SpectralAnalyzer.numBins;
    const sumActive = new Float32Array(numBins);
    const sumAll = new Float32Array(numBins);
    let activeCount = 0;
    let allCount = 0;

    const frameCount =
      numSamples <= SpectralAnalyzer.fftSize
        ? 1
        : clamp(
            Math.trunc(numSamples / SpectralAnalyzer.fftSize),
            2,
            SpectralAnalyzer.maxFrames
          );

    for (let f = 0; f < frameCount; f++) {
      const start =
        frameCount === 1
          ? 0
          : Math.trunc(((numSamples - SpectralAnalyzer.fftSize) * f) / (frameCount - 1));
      const count = Math.min(SpectralAnalyzer.fftSize, numSamples - start);
      if (count <= 0) continue;

      this.fftData.fill(0.0);
      let energy = 0.0;
      for (let i = 0; i < count; i++) {
        let sample = left[start + i];
        if (right !== null) sample = (sample + right[start + i]) * 0.5;
        this.fftData[i] = sample;
        energy += sample * sample;
      }

      this.transformCurrentFrame(count);

      for (let b = 0; b < numBins; b++) {
        sumAll[b] += this.fftData[b];
      }
      allCount++;

      const frameRms = Math.sqrt(energy / count);
      if (frameRms >= SpectralAnalyzer.kFrameRmsFloor) {
        for (let b = 0; b < numBins; b++) {
          sumActive[b] += this.fftData[b];
        }
        activeCount++;
      }
    }

    const useActive = activeCount > 0;
    const src = useActive ? sumActive : sumAll;
    const inv = 1.0 / Math.max(1, useActive ? activeCount : allCount);
    for (let b = 0; b < numBins; b++) {
      this.magnitudeSpectrum[b] = src[b] * inv;
    }

    let maxAmp = 0.0;
    const measured: PartialMeasurement[] = new Array(64);
    for (let k = 0; k < 64; k++) {
      const targetFreq = rootFrequency * (k + 1);
      measured[k] = this.measurePartial(targetFreq, rootFrequency, sampleRate);
      maxAmp = Math.max(maxAmp, measured[k].amplitude);
    }

    for (let k = 0; k < 64; k++) {
      if (measured[k].interlaced) {
        measured[k].offsetHz = 0.0;
      }
      if (measured[k].amplitude < maxAmp * SpectralAnalyzer.kPartialFloor) {
        measured[k].offsetHz = 0.0;
      }
      model.amplitudes[k] = measured[k].amplitude;
      model.frequencyOffsets[k] = measured[k].offsetHz;
    }

    if (maxAmp > 0.00001) {
      const scaler = 1.0 / maxAmp;
      for (let k = 0; k < 64; k++) {
        model.amplitudes[k] *= scaler;
      }
    }

    model.frameSpanHz = rootFrequency;
    model.gridFixed = fixedGrid;
    model.isValid = true;
    return model;
  }

  /**
   * Temporal multi-frame spectral analysis (1..16 frames) with octave-fold pre-filter
   * and automatic layer clustering (Phase 10.6 + 11.2).
   */
  public analyzeTemporal(
    audio: AudioInput,
    sampleRate: number,
    rootFrequency: number,
    frameCount: number,
    fixedGrid = false,
    layerMetric: LayerMetric = 'descriptors'
  ): SpectralModelData {
    const model = new SpectralModelData();
    const { left, right, numSamples } = extractChannels(audio);
    if (numSamples <= 0) return model;

    const nFrames = clamp(frameCount, 1, SPECTRAL_MODEL_CONSTANTS.kMaxFrames);
    const numBins = SpectralAnalyzer.numBins;

    const perFrame: PartialMeasurement[][] = Array.from({ length: nFrames }, () =>
      Array.from({ length: 64 }, () => ({
        amplitude: 0,
        offsetHz: 0,
        peakHz: 0,
        interlaced: false,
      }))
    );
    const perFrameCommon: PartialMeasurement[][] = Array.from({ length: nFrames }, () =>
      Array.from({ length: 64 }, () => ({
        amplitude: 0,
        offsetHz: 0,
        peakHz: 0,
        interlaced: false,
      }))
    );

    const frameF0s = new Float32Array(nFrames).fill(rootFrequency);
    let globalMax = 0.0;

    const frameSpectra = new Float32Array(numBins * nFrames);

    // 1a. Pre-pass: compute and cache each frame's spectrum + estimate per-frame f0
    for (let f = 0; f < nFrames; f++) {
      const start =
        nFrames === 1 || numSamples <= SpectralAnalyzer.fftSize
          ? 0
          : Math.trunc(((numSamples - SpectralAnalyzer.fftSize) * f) / (nFrames - 1));
      const count = Math.min(SpectralAnalyzer.fftSize, numSamples - start);
      if (count <= 0) continue;

      this.frameSpectrum.fill(0.0);
      this.averageWindow(left, right, start, count, this.frameSpectrum);

      const baseIdx = f * numBins;
      for (let b = 0; b < numBins; b++) {
        this.magnitudeSpectrum[b] = this.frameSpectrum[b];
        frameSpectra[baseIdx + b] = this.frameSpectrum[b];
      }

      if (
        f > 0 &&
        !fixedGrid &&
        rootFrequency >= SpectralAnalyzer.anchorFloorHz(sampleRate)
      ) {
        const seed = this.detectPitchFromSpectrum(sampleRate);
        frameF0s[f] = this.fitGridFromSpectrum(sampleRate, seed);
      }
    }

    // Octave fold gate pre-filter
    this.lastFold = SpectralAnalyzer.measureOctaveFold(frameF0s, rootFrequency);
    const gridCommon = this.gridIsCommon(frameF0s, rootFrequency);
    this.clusteringSkipped = !gridCommon;

    // 1b. Measure partials on per-frame grid and (if mono-grid) common grid
    for (let f = 0; f < nFrames; f++) {
      const baseIdx = f * numBins;
      for (let b = 0; b < numBins; b++) {
        this.magnitudeSpectrum[b] = frameSpectra[baseIdx + b];
      }

      const f0Frame = frameF0s[f];

      if (gridCommon && rootFrequency > 0.0) {
        for (let k = 0; k < 64; k++) {
          perFrameCommon[f][k] = this.measurePartial(
            rootFrequency * (k + 1),
            rootFrequency,
            sampleRate
          );
        }
      }

      let frameMax = 0.0;
      for (let k = 0; k < 64; k++) {
        const targetFreq = f0Frame * (k + 1);
        perFrame[f][k] = this.measurePartial(targetFreq, f0Frame, sampleRate);
        frameMax = Math.max(frameMax, perFrame[f][k].amplitude);
      }
      globalMax = Math.max(globalMax, frameMax);
    }

    if (globalMax <= 0.0) return model;

    const invGlobal = 1.0 / globalMax;
    const normalise = (table: PartialMeasurement[][]) => {
      for (const frame of table) {
        for (let k = 0; k < 64; k++) {
          frame[k].amplitude *= invGlobal;
          if (frame[k].amplitude < SpectralAnalyzer.kPartialFloor) {
            frame[k].offsetHz = 0.0;
          }
        }
      }
    };

    normalise(perFrame);
    if (gridCommon) {
      normalise(perFrameCommon);
    }

    // 3. Layer clustering over common grid
    this.lastMetric = layerMetric;
    this.layerGridResidCents.fill(-1.0);
    this.layerGridObsCount.fill(0);
    this.entrelazadaLayerIndex = -1;

    if (!gridCommon) {
      this.lastClustering = createEmptyLayerClustering();
      this.lastLayerRejected = true;
    } else {
      const traces = new Float32Array(64 * nFrames);
      for (let t = 0; t < 64; t++) {
        for (let f = 0; f < nFrames; f++) {
          traces[t * nFrames + f] = perFrameCommon[f][t].amplitude;
        }
      }

      this.lastClustering = clusterTraces(
        traces,
        64,
        nFrames,
        LAYER_CLUSTERING_CONSTANTS.kActivityFloor,
        layerMetric
      );
      this.lastLayerRejected = false;

      // Check for interlaced sub-grid family (odd multiples of f0/2)
      const entreTraces: number[] = [];
      for (let t = 0; t < 64; t++) {
        if (!this.lastClustering.active[t]) continue;
        let activeCount = 0;
        let interCount = 0;
        for (let f = 0; f < nFrames; f++) {
          const m = perFrameCommon[f][t];
          if (m.amplitude < LAYER_CLUSTERING_CONSTANTS.kActivityFloor) continue;
          activeCount++;
          if (m.interlaced) interCount++;
        }
        if (activeCount < LAYER_CLUSTERING_CONSTANTS.kMinActiveFrames) continue;
        if (interCount >= 2) entreTraces.push(t);
      }

      if (entreTraces.length >= LAYER_CLUSTERING_CONSTANTS.kMinLayerTraces) {
        const layered = this.buildEntrelazadaModel(
          perFrameCommon,
          entreTraces,
          this.lastClustering,
          nFrames,
          rootFrequency
        );
        layered.gridFixed = fixedGrid;
        return layered;
      }

      if (this.lastClustering.layerCount > 1) {
        const layered = this.buildLayeredModel(
          perFrameCommon,
          this.lastClustering,
          nFrames,
          rootFrequency
        );
        layered.gridFixed = fixedGrid;
        for (let l = 0; l < layered.layerCount; l++) {
          const members: number[] = [];
          for (let t = 0; t < 64; t++) {
            if (this.lastClustering.layerOfTrace[t] === l) members.push(t);
          }
          this.layerGridResidCents[l] = this.layerResidualCents(
            perFrameCommon,
            members,
            rootFrequency,
            false,
            nFrames
          );
          let cnt = 0;
          for (let f = 0; f < nFrames; f++) {
            for (const t of members) {
              const m = perFrameCommon[f][t];
              if (
                m.amplitude >= LAYER_CLUSTERING_CONSTANTS.kActivityFloor &&
                !m.interlaced
              ) {
                cnt++;
              }
            }
          }
          this.layerGridObsCount[l] = cnt;
        }
        this.entrelazadaLayerIndex = -1;
        return layered;
      }

      // Single layer residual
      const allActive: number[] = [];
      for (let t = 0; t < 64; t++) {
        if (this.lastClustering.active[t]) allActive.push(t);
      }
      if (allActive.length > 0) {
        this.layerGridResidCents[0] = this.layerResidualCents(
          perFrameCommon,
          allActive,
          rootFrequency,
          false,
          nFrames
        );
        let cnt = 0;
        for (let f = 0; f < nFrames; f++) {
          for (const t of allActive) {
            const m = perFrameCommon[f][t];
            if (
              m.amplitude >= LAYER_CLUSTERING_CONSTANTS.kActivityFloor &&
              !m.interlaced
            ) {
              cnt++;
            }
          }
        }
        this.layerGridObsCount[0] = cnt;
      }
    }

    // 4. Populate single-layer model (canonical frame 0 + extra frames 1..nFrames-1)
    for (let k = 0; k < 64; k++) {
      model.amplitudes[k] = perFrame[0][k].amplitude;
      model.frequencyOffsets[k] = perFrame[0][k].offsetHz;
    }
    for (let f = 1; f < nFrames; f++) {
      for (let k = 0; k < 64; k++) {
        model.extraAmps[f - 1][k] = perFrame[f][k].amplitude;
        model.extraOffsets[f - 1][k] = perFrame[f][k].offsetHz;
      }
    }

    model.frameCount = nFrames;
    model.frameSpanHz = rootFrequency;
    for (let f = 1; f < nFrames; f++) {
      model.setF0At(f, frameF0s[f]);
    }
    model.gridFixed = fixedGrid;
    model.isValid = true;
    return model;
  }

  /**
   * Evaluates {seed/2, seed, seed*2} octave candidates by global Least-Squares residual.
   */
  public evaluateOctaveCandidates(
    audio: AudioInput,
    sampleRate: number,
    seedHz: number
  ): [OctaveCandidate, OctaveCandidate, OctaveCandidate] {
    const makeEmpty = (cHz = 0): OctaveCandidate => ({
      candidateHz: cHz,
      fittedHz: cHz,
      residCents: -1.0,
      observations: 0,
      interlaced: 0,
      valid: false,
    });
    const out: [OctaveCandidate, OctaveCandidate, OctaveCandidate] = [
      makeEmpty(),
      makeEmpty(),
      makeEmpty(),
    ];

    const { left, right, numSamples } = extractChannels(audio);
    if (seedHz <= 0.0 || numSamples <= 0) return out;

    const floor = SpectralAnalyzer.anchorFloorHz(sampleRate);
    const candidates = [seedHz * 0.5, seedHz, seedHz * 2.0];
    const numBins = SpectralAnalyzer.numBins;
    const frameCount =
      numSamples <= SpectralAnalyzer.fftSize
        ? 1
        : clamp(
            Math.trunc(numSamples / SpectralAnalyzer.fftSize),
            2,
            SpectralAnalyzer.maxFrames
          );

    for (let ci = 0; ci < 3; ci++) {
      const cand = candidates[ci];
      const o = out[ci];
      o.candidateHz = cand;
      o.fittedHz = cand;
      if (cand < floor || cand <= 0.0) continue;

      interface Obs {
        harmonic: number;
        peakHz: number;
      }
      const observations: Obs[] = [];
      let interlacedDropped = 0;

      const collect = (root: number) => {
        observations.length = 0;
        interlacedDropped = 0;
        if (root <= 0.0) return;

        for (let f = 0; f < frameCount; f++) {
          const start =
            frameCount === 1
              ? 0
              : Math.trunc(
                  ((numSamples - SpectralAnalyzer.fftSize) * f) / (frameCount - 1)
                );
          const count = Math.min(SpectralAnalyzer.fftSize, numSamples - start);
          if (count <= 0) continue;

          this.fftData.fill(0.0);
          let energy = 0.0;
          for (let i = 0; i < count; i++) {
            let s = left[start + i];
            if (right !== null) s = (s + right[start + i]) * 0.5;
            this.fftData[i] = s;
            energy += s * s;
          }
          if (Math.sqrt(energy / count) < SpectralAnalyzer.kFrameRmsFloor) continue;

          this.transformCurrentFrame(count);
          for (let b = 0; b < numBins; b++) {
            this.magnitudeSpectrum[b] = this.fftData[b];
          }

          const measured: PartialMeasurement[] = new Array(64);
          let windowMax = 0.0;
          for (let k = 0; k < 64; k++) {
            measured[k] = this.measurePartial(root * (k + 1), root, sampleRate);
            windowMax = Math.max(windowMax, measured[k].amplitude);
          }
          if (windowMax <= 0.0) continue;

          for (let k = 0; k < 64; k++) {
            const m = measured[k];
            if (m.interlaced) {
              interlacedDropped++;
              continue;
            }
            if (
              m.amplitude <= 0.0 ||
              m.amplitude < windowMax * SpectralAnalyzer.kPartialFloor
            ) {
              continue;
            }
            observations.push({
              harmonic: k + 1,
              peakHz: root * (k + 1) + m.offsetHz,
            });
          }
        }
      };

      const solve = (obs: Obs[]): number => {
        let num = 0.0;
        let den = 0.0;
        for (const item of obs) {
          num += item.harmonic * item.peakHz;
          den += item.harmonic * item.harmonic;
        }
        return den > 0.0 ? num / den : 0.0;
      };

      const resid = (obs: Obs[], f0: number): number => {
        if (obs.length === 0 || f0 <= 0.0) return -1.0;
        let acc = 0.0;
        for (const item of obs) {
          const r = 1200.0 * Math.log2(item.peakHz / (item.harmonic * f0));
          acc += r * r;
        }
        return Math.sqrt(acc / obs.length);
      };

      collect(cand);
      if (observations.length < SpectralAnalyzer.kMinLsObservations) continue;
      const firstFit = solve(observations);
      if (firstFit <= 0.0) continue;

      collect(firstFit);
      const fitted =
        observations.length >= SpectralAnalyzer.kMinLsObservations
          ? solve(observations)
          : firstFit;
      if (fitted <= 0.0) continue;
      if (Math.abs(1200.0 * Math.log2(fitted / cand)) > 600.0) continue;

      const rc = resid(observations, fitted);
      if (rc < 0.0 || observations.length < SpectralAnalyzer.kMinLsObservations) continue;

      o.valid = true;
      o.fittedHz = fitted;
      o.residCents = rc;
      o.observations = observations.length;
      o.interlaced = interlacedDropped;
    }

    return out;
  }

  public resolveOctaveByGlobalResidual(
    audio: AudioInput,
    sampleRate: number,
    seedHz: number
  ): number {
    if (seedHz <= 0.0) return seedHz;
    const cands = this.evaluateOctaveCandidates(audio, sampleRate, seedHz);
    let best = -1;
    for (let i = 0; i < 3; i++) {
      if (!cands[i].valid) continue;
      if (best < 0) {
        best = i;
        continue;
      }
      const rBest = cands[best].residCents;
      const rThis = cands[i].residCents;
      if (rThis + 0.5 < rBest) {
        best = i;
      } else if (Math.abs(rThis - rBest) <= 0.5) {
        if (cands[i].observations > cands[best].observations) {
          best = i;
        } else if (cands[i].observations === cands[best].observations) {
          const dBest = Math.abs(1200.0 * Math.log2(cands[best].fittedHz / seedHz));
          const dThis = Math.abs(1200.0 * Math.log2(cands[i].fittedHz / seedHz));
          if (dThis < dBest) best = i;
        }
      }
    }
    return best < 0 ? seedHz : cands[best].fittedHz;
  }

  /**
   * Measures pitch deviation across windows against `rootFrequency` (folded to (-600, +600] cents).
   */
  public measurePitchDeviation(
    audio: AudioInput,
    sampleRate: number,
    rootFrequency: number
  ): void {
    this.lastGuardCents = 0.0;
    if (rootFrequency <= 0.0) return;

    const { left, right, numSamples } = extractChannels(audio);
    if (numSamples < SpectralAnalyzer.fftSize) return;

    const numBins = SpectralAnalyzer.numBins;
    const frameCount = clamp(
      Math.trunc(numSamples / SpectralAnalyzer.fftSize),
      2,
      SpectralAnalyzer.maxFrames
    );
    const detected: number[] = [];

    for (let f = 0; f < frameCount; f++) {
      const start = Math.trunc(
        ((numSamples - SpectralAnalyzer.fftSize) * f) / (frameCount - 1)
      );
      this.fftData.fill(0.0);

      let energy = 0.0;
      for (let i = 0; i < SpectralAnalyzer.fftSize; i++) {
        let sample = left[start + i];
        if (right !== null) sample = (sample + right[start + i]) * 0.5;
        this.fftData[i] = sample;
        energy += sample * sample;
      }
      if (
        Math.sqrt(energy / SpectralAnalyzer.fftSize) < SpectralAnalyzer.kFrameRmsFloor
      ) {
        continue;
      }

      this.transformCurrentFrame(SpectralAnalyzer.fftSize);
      for (let b = 0; b < numBins; b++) {
        this.magnitudeSpectrum[b] = this.fftData[b];
      }
      detected.push(this.detectPitchImpl(sampleRate));
    }

    if (detected.length < 2) return;

    let maxDev = 0.0;
    for (const f0k of detected) {
      if (f0k <= 0.0) continue;
      const dev = SpectralAnalyzer.foldOctaveCents(f0k, rootFrequency);
      maxDev = Math.max(maxDev, Math.abs(dev));
    }

    this.lastGuardCents = maxDev > SpectralAnalyzer.pitchGuardCents ? maxDev : 0.0;
  }

  public averageWindow(
    left: Float32Array,
    right: Float32Array | null,
    start: number,
    count: number,
    out: Float32Array
  ): void {
    this.fftData.fill(0.0);
    for (let i = 0; i < count; i++) {
      let sample = left[start + i];
      if (right !== null) sample = (sample + right[start + i]) * 0.5;
      this.fftData[i] = sample;
    }

    this.transformCurrentFrame(count);
    for (let b = 0; b < SpectralAnalyzer.numBins; b++) {
      out[b] += this.fftData[b];
    }
  }

  // ── Private Helpers ─────────────────────────────────────

  private transformCurrentFrame(numSamples: number): void {
    const n = Math.min(numSamples, SpectralAnalyzer.fftSize);
    for (let i = 0; i < n; i++) {
      this.fftData[i] *= this.windowTable[i];
    }
    for (let i = n; i < SpectralAnalyzer.fftSize; i++) {
      this.fftData[i] = 0.0;
    }
    this.fft.performFrequencyOnlyForwardTransform(this.fftData);
  }

  private fitGridLeastSquares(
    audio: AudioInput,
    sampleRate: number,
    seedHz: number
  ): number {
    if (seedHz <= 0.0) return seedHz;
    const { left, right, numSamples } = extractChannels(audio);
    if (numSamples <= 0) return seedHz;

    const numBins = SpectralAnalyzer.numBins;
    const frameCount =
      numSamples <= SpectralAnalyzer.fftSize
        ? 1
        : clamp(
            Math.trunc(numSamples / SpectralAnalyzer.fftSize),
            2,
            SpectralAnalyzer.maxFrames
          );

    interface Observation {
      harmonic: number;
      peakHz: number;
    }
    const observations: Observation[] = [];
    let interlacedDropped = 0;

    const collect = (root: number) => {
      observations.length = 0;
      interlacedDropped = 0;
      if (root <= 0.0) return;

      for (let f = 0; f < frameCount; f++) {
        const start =
          frameCount === 1
            ? 0
            : Math.trunc(((numSamples - SpectralAnalyzer.fftSize) * f) / (frameCount - 1));
        const count = Math.min(SpectralAnalyzer.fftSize, numSamples - start);
        if (count <= 0) continue;

        this.fftData.fill(0.0);
        let energy = 0.0;
        for (let i = 0; i < count; i++) {
          let sample = left[start + i];
          if (right !== null) sample = (sample + right[start + i]) * 0.5;
          this.fftData[i] = sample;
          energy += sample * sample;
        }
        if (Math.sqrt(energy / count) < SpectralAnalyzer.kFrameRmsFloor) continue;

        this.transformCurrentFrame(count);
        for (let b = 0; b < numBins; b++) {
          this.magnitudeSpectrum[b] = this.fftData[b];
        }

        const measured: PartialMeasurement[] = new Array(64);
        let windowMax = 0.0;
        for (let k = 0; k < 64; k++) {
          measured[k] = this.measurePartial(root * (k + 1), root, sampleRate);
          windowMax = Math.max(windowMax, measured[k].amplitude);
        }
        if (windowMax <= 0.0) continue;

        for (let k = 0; k < 64; k++) {
          const m = measured[k];
          if (m.interlaced) {
            interlacedDropped++;
            continue;
          }
          if (
            m.amplitude <= 0.0 ||
            m.amplitude < windowMax * SpectralAnalyzer.kPartialFloor
          ) {
            continue;
          }
          observations.push({
            harmonic: k + 1,
            peakHz: root * (k + 1) + m.offsetHz,
          });
        }
      }
    };

    const solve = (obs: Observation[]): number => {
      let num = 0.0;
      let den = 0.0;
      for (const o of obs) {
        num += o.harmonic * o.peakHz;
        den += o.harmonic * o.harmonic;
      }
      return den > 0.0 ? num / den : 0.0;
    };

    const residualCents = (obs: Observation[], f0: number): number => {
      if (obs.length === 0 || f0 <= 0.0) return -1.0;
      let acc = 0.0;
      for (const o of obs) {
        const r = 1200.0 * Math.log2(o.peakHz / (o.harmonic * f0));
        acc += r * r;
      }
      return Math.sqrt(acc / obs.length);
    };

    const publish = (obs: Observation[], f0: number) => {
      this.gridObsCount = obs.length;
      this.gridResidCents = residualCents(obs, f0);
      this.gridInterlacedCount = interlacedDropped;
    };

    // Pass 1: bands anchored at HPS seed
    collect(seedHz);
    if (observations.length < SpectralAnalyzer.kMinLsObservations) {
      publish(observations, seedHz);
      return seedHz;
    }
    const firstFit = solve(observations);
    if (firstFit <= 0.0) {
      publish(observations, seedHz);
      return seedHz;
    }

    // Pass 2: bands relocated to firstFit
    collect(firstFit);
    const fitted =
      observations.length >= SpectralAnalyzer.kMinLsObservations
        ? solve(observations)
        : firstFit;
    if (fitted <= 0.0) {
      publish(observations, seedHz);
      return seedHz;
    }

    const devCents = Math.abs(1200.0 * Math.log2(fitted / seedHz));
    if (devCents > 600.0) {
      publish(observations, seedHz);
      return seedHz;
    }

    publish(observations, fitted);
    return fitted;
  }

  private fitGridFromSpectrum(sampleRate: number, seedHz: number): number {
    if (seedHz <= 0.0) return seedHz;

    interface Observation {
      harmonic: number;
      peakHz: number;
    }
    const observations: Observation[] = [];

    const collect = (root: number) => {
      observations.length = 0;
      if (root <= 0.0) return;

      const measured: PartialMeasurement[] = new Array(64);
      let windowMax = 0.0;
      for (let k = 0; k < 64; k++) {
        measured[k] = this.measurePartial(root * (k + 1), root, sampleRate);
        windowMax = Math.max(windowMax, measured[k].amplitude);
      }
      if (windowMax <= 0.0) return;

      for (let k = 0; k < 64; k++) {
        const m = measured[k];
        if (m.interlaced) continue;
        if (
          m.amplitude <= 0.0 ||
          m.amplitude < windowMax * SpectralAnalyzer.kPartialFloor
        ) {
          continue;
        }
        observations.push({
          harmonic: k + 1,
          peakHz: root * (k + 1) + m.offsetHz,
        });
      }
    };

    const solve = (obs: Observation[]): number => {
      let num = 0.0;
      let den = 0.0;
      for (const o of obs) {
        num += o.harmonic * o.peakHz;
        den += o.harmonic * o.harmonic;
      }
      return den > 0.0 ? num / den : 0.0;
    };

    collect(seedHz);
    if (observations.length < SpectralAnalyzer.kMinLsObservations) return seedHz;
    const firstFit = solve(observations);
    if (firstFit <= 0.0) return seedHz;

    collect(firstFit);
    const fitted =
      observations.length >= SpectralAnalyzer.kMinLsObservations
        ? solve(observations)
        : firstFit;
    if (fitted <= 0.0) return seedHz;

    const devCents = Math.abs(1200.0 * Math.log2(fitted / seedHz));
    if (devCents > 600.0) return seedHz;

    return fitted;
  }

  private gridIsCommon(frameF0s: ArrayLike<number>, rootFrequency: number): boolean {
    if (rootFrequency <= 0.0) return false;
    return !SpectralAnalyzer.measureOctaveFold(frameF0s, rootFrequency).biGrid;
  }

  private buildLayeredModel(
    frames: PartialMeasurement[][],
    clusters: LayerClusteringResult,
    nFrames: number,
    rootFrequency: number
  ): SpectralModelData {
    const model = new SpectralModelData();
    model.setLayerCount(clusters.layerCount);

    for (let l = 0; l < clusters.layerCount; l++) {
      model.setNumFramesOf(l, nFrames);
      model.setLayerWeightAt(l, 1.0);
      model.setLayerNameAt(l, `capa ${l + 1}`);

      const level = new Float32Array(nFrames);
      let peak = 0.0;

      for (let f = 0; f < nFrames; f++) {
        const amps = model.ampsOfLayer(l, f);
        const offs = model.offsetsOfLayer(l, f);
        amps.fill(0.0);
        offs.fill(0.0);

        let energy = 0.0;
        for (let k = 0; k < 64; k++) {
          if (clusters.layerOfTrace[k] === l) {
            amps[k] = frames[f][k].amplitude;
            offs[k] = frames[f][k].offsetHz;
            energy += amps[k] * amps[k];
          }
        }

        level[f] = Math.sqrt(energy);
        peak = Math.max(peak, level[f]);
        model.setF0AtLayer(l, f, rootFrequency);
      }

      for (let f = 0; f < nFrames; f++) {
        model.setFrameWeightAt(l, f, peak > 0.0 ? level[f] / peak : 1.0);
      }
    }

    model.frameSpanHz = rootFrequency;
    model.isValid = true;
    return model;
  }

  private layerResidualCents(
    frames: PartialMeasurement[][],
    tracesOfLayer: number[],
    rootFrequency: number,
    isEntrelazada: boolean,
    nFrames: number
  ): number {
    if (tracesOfLayer.length === 0 || rootFrequency <= 0.0 || nFrames <= 0) {
      return -1.0;
    }

    interface Obs {
      harm: number;
      peak: number;
    }
    const obs: Obs[] = [];
    const halfGrid = rootFrequency * 0.5;

    for (let f = 0; f < nFrames; f++) {
      if (frames.length <= f) continue;
      let frameMax = 0.0;
      for (let k = 0; k < 64; k++) {
        frameMax = Math.max(frameMax, frames[f][k].amplitude);
      }
      if (frameMax <= 0.0) continue;

      const floor = frameMax * SpectralAnalyzer.kPartialFloor;
      for (const t of tracesOfLayer) {
        const m = frames[f][t];
        if (m.amplitude < floor || m.peakHz <= 0.0) continue;

        if (isEntrelazada) {
          if (!m.interlaced) continue;
          const oddF = Math.round(m.peakHz / halfGrid);
          const odd = Math.round(oddF);
          if (odd < 1 || odd % 2 === 0) continue;
          const k = t + 1;
          if (oddF < 2 * k - 1 - 0.6 || oddF > 2 * k + 1 + 0.6) continue;
          obs.push({ harm: odd, peak: m.peakHz });
        } else {
          if (m.interlaced) continue;
          obs.push({ harm: t + 1, peak: m.peakHz });
        }
      }
    }

    if (obs.length < SpectralAnalyzer.kMinLsObservations) return -1.0;
    let num = 0.0;
    let den = 0.0;
    for (const o of obs) {
      num += o.harm * o.peak;
      den += o.harm * o.harm;
    }
    const fitted = den > 0.0 ? num / den : 0.0;
    if (fitted <= 0.0) return -1.0;

    let acc = 0.0;
    for (const o of obs) {
      const r = 1200.0 * Math.log2(o.peak / (o.harm * fitted));
      acc += r * r;
    }
    return Math.sqrt(acc / obs.length);
  }

  private buildEntrelazadaModel(
    frames: PartialMeasurement[][],
    entrelazadaTraces: number[],
    fallbackClusters: LayerClusteringResult,
    nFrames: number,
    rootFrequency: number
  ): SpectralModelData {
    const model = new SpectralModelData();
    const propiaTraces: number[] = [];
    for (let t = 0; t < 64; t++) {
      if (entrelazadaTraces.includes(t)) continue;
      if (fallbackClusters.active[t]) propiaTraces.push(t);
    }

    model.setLayerCount(2);

    // Layer 0: propia
    {
      model.setNumFramesOf(0, nFrames);
      model.setLayerWeightAt(0, 1.0);
      model.setLayerNameAt(0, 'propia');
      const level = new Float32Array(nFrames);
      let peak = 0.0;

      for (let f = 0; f < nFrames; f++) {
        const amps = model.ampsOfLayer(0, f);
        const offs = model.offsetsOfLayer(0, f);
        amps.fill(0.0);
        offs.fill(0.0);
        let energy = 0.0;
        for (const t of propiaTraces) {
          const m = frames[f][t];
          amps[t] = m.amplitude;
          offs[t] = m.offsetHz;
          energy += amps[t] * amps[t];
        }
        level[f] = Math.sqrt(energy);
        peak = Math.max(peak, level[f]);
        model.setF0AtLayer(0, f, rootFrequency);
      }

      for (let f = 0; f < nFrames; f++) {
        model.setFrameWeightAt(0, f, peak > 0.0 ? level[f] / peak : 1.0);
      }
      this.layerGridResidCents[0] = this.layerResidualCents(
        frames,
        propiaTraces,
        rootFrequency,
        false,
        nFrames
      );
      let cnt = 0;
      for (let f = 0; f < nFrames; f++) {
        for (const t of propiaTraces) {
          const m = frames[f][t];
          if (
            m.amplitude >= LAYER_CLUSTERING_CONSTANTS.kActivityFloor &&
            !m.interlaced
          ) {
            cnt++;
          }
        }
      }
      this.layerGridObsCount[0] = cnt;
      model.frameSpanHz = rootFrequency;
    }

    // Layer 1: entrelazada (odd sub-grid of f0/2)
    {
      model.setNumFramesOf(1, nFrames);
      model.setLayerWeightAt(1, 1.0);
      model.setLayerNameAt(1, 'entrelazada');
      const halfGrid = rootFrequency * 0.5;
      const level = new Float32Array(nFrames);
      let peak = 0.0;

      for (let f = 0; f < nFrames; f++) {
        const amps = model.ampsOfLayer(1, f);
        const offs = model.offsetsOfLayer(1, f);
        amps.fill(0.0);
        offs.fill(0.0);
        let energy = 0.0;
        for (const t of entrelazadaTraces) {
          const m = frames[f][t];
          amps[t] = m.amplitude;
          offs[t] = m.peakHz > 0.0 ? m.peakHz - (t + 1) * rootFrequency : 0.0;
          energy += amps[t] * amps[t];
        }
        level[f] = Math.sqrt(energy);
        peak = Math.max(peak, level[f]);
        model.setF0AtLayer(1, f, halfGrid);
      }

      for (let f = 0; f < nFrames; f++) {
        model.setFrameWeightAt(1, f, peak > 0.0 ? level[f] / peak : 1.0);
      }
      this.layerGridResidCents[1] = this.layerResidualCents(
        frames,
        entrelazadaTraces,
        rootFrequency,
        true,
        nFrames
      );
      let cnt = 0;
      for (let f = 0; f < nFrames; f++) {
        for (const t of entrelazadaTraces) {
          const m = frames[f][t];
          if (
            m.amplitude >= LAYER_CLUSTERING_CONSTANTS.kActivityFloor &&
            m.interlaced
          ) {
            cnt++;
          }
        }
      }
      this.layerGridObsCount[1] = cnt;
      this.entrelazadaLayerIndex = 1;
    }

    model.frameSpanHz = rootFrequency;
    model.isValid = true;
    return model;
  }
}
