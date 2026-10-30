// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Pure TypeScript Radix-2 FFT & STFT Engine
//
// Zero external dependencies. Precomputes bit-reversal and
// twiddle factor tables per FFT size.
// Includes JUCE-compatible Blackman-Harris, Hanning,
// Blackman, and Hamming windowing functions.
// ─────────────────────────────────────────────────────────

export type WindowType = 'hanning' | 'blackman' | 'blackman-harris' | 'hamming';

export interface StftConfig {
  /** Power of 2: e.g. 2048, 4096, 8192 */
  frameSize: number;
  /** Hop size in samples (default: frameSize / 4) */
  hopSize?: number;
  /** Window function (default: 'hanning') */
  windowType?: WindowType;
  /** Sample rate in Hz (default: 44100) */
  sampleRate?: number;
}

export interface StftFrame {
  /** Frame start sample index */
  startSample: number;
  /** Frame center time in seconds */
  timeSec: number;
  /** RMS amplitude of the unwindowed frame */
  rms: number;
  /** Magnitude per frequency bin (length = frameSize / 2 + 1) */
  magnitudes: Float32Array;
  /** Phase in radians [-pi, +pi] per frequency bin (length = frameSize / 2 + 1) */
  phases: Float32Array;
}

export interface StftResult {
  frameSize: number;
  hopSize: number;
  numBins: number;
  binWidthHz: number;
  sampleRate: number;
  windowType: WindowType;
  frames: StftFrame[];
}

/**
 * Generates a window table of length `size` for the requested window type.
 * Uses N - 1 denominator matching JUCE dsp::WindowingFunction symmetric table.
 */
export function createWindowTable(size: number, type: WindowType): Float32Array {
  const table = new Float32Array(size);
  if (size <= 1) {
    if (size === 1) table[0] = 1.0;
    return table;
  }

  const invN = 1.0 / (size - 1);
  const twoPi = 2.0 * Math.PI;
  const fourPi = 4.0 * Math.PI;
  const sixPi = 6.0 * Math.PI;

  for (let i = 0; i < size; i++) {
    const ratio = i * invN;
    switch (type) {
      case 'hanning':
        table[i] = 0.5 - 0.5 * Math.cos(twoPi * ratio);
        break;
      case 'hamming':
        table[i] = 0.54 - 0.46 * Math.cos(twoPi * ratio);
        break;
      case 'blackman':
        table[i] =
          0.42 -
          0.5 * Math.cos(twoPi * ratio) +
          0.08 * Math.cos(fourPi * ratio);
        break;
      case 'blackman-harris':
        // Exact 4-term Blackman-Harris matching juce::dsp::WindowingFunction::blackmanHarris
        table[i] =
          0.35875 -
          0.48829 * Math.cos(twoPi * ratio) +
          0.14128 * Math.cos(fourPi * ratio) -
          0.01168 * Math.cos(sixPi * ratio);
        break;
    }
  }
  return table;
}

/**
 * Radix-2 Cooley-Tukey FFT engine with cached bit-reversal and twiddle tables.
 */
export class FftEngine {
  public readonly order: number;
  public readonly size: number;
  public readonly numBins: number;

  private readonly bitRev: Uint32Array;
  private readonly cosTable: Float64Array;
  private readonly sinTable: Float64Array;
  private readonly realBuf: Float64Array;
  private readonly imagBuf: Float64Array;

  constructor(orderOrSize = 13) {
    if (orderOrSize <= 20) {
      this.order = orderOrSize;
      this.size = 1 << orderOrSize;
    } else {
      if ((orderOrSize & (orderOrSize - 1)) !== 0) {
        throw new Error(`FFT size must be a power of 2, received ${orderOrSize}`);
      }
      this.size = orderOrSize;
      this.order = Math.round(Math.log2(orderOrSize));
    }

    this.numBins = (this.size >>> 1) + 1;
    this.bitRev = new Uint32Array(this.size);
    this.realBuf = new Float64Array(this.size);
    this.imagBuf = new Float64Array(this.size);

    // Precompute bit-reversal permutation
    const shift = 32 - this.order;
    for (let i = 0; i < this.size; i++) {
      let x = i;
      x = ((x >>> 1) & 0x55555555) | ((x & 0x55555555) << 1);
      x = ((x >>> 2) & 0x33333333) | ((x & 0x33333333) << 2);
      x = ((x >>> 4) & 0x0f0f0f0f) | ((x & 0x0f0f0f0f) << 4);
      x = ((x >>> 8) & 0x00ff00ff) | ((x & 0x00ff00ff) << 8);
      x = (x >>> 16) | (x << 16);
      this.bitRev[i] = x >>> shift;
    }

    // Precompute twiddle factors for each butterfly half-size
    const half = this.size >>> 1;
    this.cosTable = new Float64Array(half);
    this.sinTable = new Float64Array(half);
    for (let i = 0; i < half; i++) {
      const angle = (-2.0 * Math.PI * i) / this.size;
      this.cosTable[i] = Math.cos(angle);
      this.sinTable[i] = Math.sin(angle);
    }
  }

  /**
   * Computes forward real-to-complex FFT and returns both magnitudes and phases
   * for bins 0 .. size/2.
   */
  public forwardMagnitudeAndPhase(
    timeSignal: Float32Array,
    outMagnitudes: Float32Array,
    outPhases: Float32Array
  ): void {
    this.executeCoreFft(timeSignal);
    const nBins = this.numBins;
    for (let b = 0; b < nBins; b++) {
      const re = this.realBuf[b];
      const im = this.imagBuf[b];
      outMagnitudes[b] = Math.hypot(re, im);
      outPhases[b] = Math.atan2(im, re);
    }
  }

  /**
   * Matches `juce::dsp::FFT::performFrequencyOnlyForwardTransform(float* inoutData)`.
   * Takes a real signal in `inoutData[0 .. size-1]` and writes bin magnitudes
   * into `inoutData[0 .. size/2]`.
   */
  public performFrequencyOnlyForwardTransform(inoutData: Float32Array): void {
    this.executeCoreFft(inoutData);
    const nBins = this.numBins;
    for (let b = 0; b < nBins; b++) {
      const re = this.realBuf[b];
      const im = this.imagBuf[b];
      inoutData[b] = Math.hypot(re, im);
    }
    for (let b = nBins; b < inoutData.length; b++) {
      inoutData[b] = 0.0;
    }
  }

  private executeCoreFft(timeSignal: Float32Array): void {
    const N = this.size;
    const rev = this.bitRev;
    const re = this.realBuf;
    const im = this.imagBuf;
    const sigLen = timeSignal.length;

    for (let i = 0; i < N; i++) {
      const srcIdx = rev[i];
      re[i] = srcIdx < sigLen ? timeSignal[srcIdx] : 0.0;
      im[i] = 0.0;
    }

    const cosT = this.cosTable;
    const sinT = this.sinTable;

    for (let halfSize = 1; halfSize < N; halfSize <<= 1) {
      const step = halfSize << 1;
      const twiddleStep = (N >>> 1) / halfSize;

      for (let k = 0; k < N; k += step) {
        let twiddleIdx = 0;
        for (let j = 0; j < halfSize; j++) {
          const evenIdx = k + j;
          const oddIdx = evenIdx + halfSize;
          const wr = cosT[twiddleIdx];
          const wi = sinT[twiddleIdx];

          const oddRe = re[oddIdx];
          const oddIm = im[oddIdx];
          const tr = wr * oddRe - wi * oddIm;
          const ti = wr * oddIm + wi * oddRe;

          const evenRe = re[evenIdx];
          const evenIm = im[evenIdx];

          re[oddIdx] = evenRe - tr;
          im[oddIdx] = evenIm - ti;
          re[evenIdx] = evenRe + tr;
          im[evenIdx] = evenIm + ti;

          twiddleIdx += twiddleStep;
        }
      }
    }
  }
}

/**
 * Computes Short-Time Fourier Transform (STFT) across a mono audio buffer.
 */
export function computeStft(samples: Float32Array, config: StftConfig): StftResult {
  const frameSize = config.frameSize;
  const hopSize = config.hopSize ?? Math.max(1, frameSize >>> 2);
  const windowType: WindowType = config.windowType ?? 'hanning';
  const sampleRate = config.sampleRate ?? 44100;

  const fft = new FftEngine(frameSize);
  const windowTable = createWindowTable(frameSize, windowType);
  const numBins = fft.numBins;
  const frameBuf = new Float32Array(frameSize);
  const frames: StftFrame[] = [];

  if (samples.length === 0) {
    return {
      frameSize,
      hopSize,
      numBins,
      binWidthHz: sampleRate / frameSize,
      sampleRate,
      windowType,
      frames,
    };
  }

  const totalStarts =
    samples.length <= frameSize
      ? 1
      : Math.floor((samples.length - frameSize) / hopSize) + 1;

  for (let f = 0; f < totalStarts; f++) {
    const startSample = f * hopSize;
    const count = Math.min(frameSize, samples.length - startSample);
    frameBuf.fill(0);

    let energy = 0.0;
    for (let i = 0; i < count; i++) {
      const s = samples[startSample + i];
      energy += s * s;
      frameBuf[i] = s * windowTable[i];
    }

    const rms = count > 0 ? Math.sqrt(energy / count) : 0;
    const magnitudes = new Float32Array(numBins);
    const phases = new Float32Array(numBins);
    fft.forwardMagnitudeAndPhase(frameBuf, magnitudes, phases);

    frames.push({
      startSample,
      timeSec: (startSample + count * 0.5) / sampleRate,
      rms,
      magnitudes,
      phases,
    });
  }

  return {
    frameSize,
    hopSize,
    numBins,
    binWidthHz: sampleRate / frameSize,
    sampleRate,
    windowType,
    frames,
  };
}
