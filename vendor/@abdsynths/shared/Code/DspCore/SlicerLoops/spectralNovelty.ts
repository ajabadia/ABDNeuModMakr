/**
 * @abdsynths/shared — Code/DspCore/SlicerLoops/spectralNovelty.ts
 * =========================================================================
 * SuperFlux onset novelty + adaptive median threshold (SSOT). Verbatim
 * extraction from `ABDNeuModMakr/src/core/dsp/audioSlicer/SlicerSpectral.ts`.
 */

/**
 * Calculates SuperFlux onset novelty curve with vibrato suppression and
 * HFC weighting (Böck & Widmer / aubio onset algorithms).
 */
export function computeSpectralNoveltyCurve(
  pcm: Float32Array,
  frameSize = 1024,
  hopSize = 256,
  filterWidthBins = 2,
): Float32Array {
  const numFrames = Math.max(1, Math.floor((pcm.length - frameSize) / hopSize));
  const novelty = new Float32Array(numFrames);
  const half = frameSize / 2;

  let prevMag = new Float32Array(half);

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

      let prevLocalMax = prevMag[k];
      for (let w = 1; w <= filterWidthBins; w++) {
        if (k - w >= 0 && prevMag[k - w] > prevLocalMax) prevLocalMax = prevMag[k - w];
        if (k + w < half && prevMag[k + w] > prevLocalMax) prevLocalMax = prevMag[k + w];
      }

      const diff = mag - prevLocalMax;
      if (diff > 0) flux += diff;

      hfc += mag * (k / half);
    }

    novelty[f] = flux * 0.75 + hfc * 0.25;
    prevMag = currentMag;
  }

  const smoothed = new Float32Array(numFrames);
  for (let i = 1; i < numFrames - 1; i++) {
    smoothed[i] = (novelty[i - 1] + novelty[i] * 2 + novelty[i + 1]) / 4;
  }

  return smoothed;
}

/**
 * Moving Median filter for adaptive onset thresholding
 * (aubio / SuperFlux standard).
 */
export function computeAdaptiveMedianThreshold(
  novelty: Float32Array,
  windowRadius = 7,
  multiplier = 1.35,
  offset = 0.02,
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
