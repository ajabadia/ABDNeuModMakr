// ─────────────────────────────────────────────────────────────
// @abdsynths/shared — DspCore / NeuronAnalysis / ResynatorV2Preview.ts
// 1:1 TypeScript Float32 mirror of `ABDShared/Code/DspCore/NeuronVS/NeuronResynatorV2.h`
// for live in-browser previewing of the ABDAxionikVS Resynator v2 engine
// inside ABDNeuModMakr (before Gate B unlocks in ABDAxionikVS).
// ─────────────────────────────────────────────────────────────

import type {
  AxionikResonatorShapers,
  AxionikSpectralFrame,
  AxionikSurfaceModulationProfile,
  AxionikHybridTransient,
} from '../../../Contracts/axionikExpandedModel.ts';

export const BARK_BAND_CENTERS_HZ: readonly number[] = [
  50, 150, 250, 350, 450, 570, 700, 840,
  1000, 1170, 1370, 1600, 1850, 2150, 2500, 2900,
  3400, 4000, 4800, 5800, 7000, 8500, 10500, 13500,
];

export interface ResynatorV2PreviewInput {
  /** Pre-evaluated spectral frames (from `evaluateUnifiedSpectralSurface` or `AxionikSpectralModel`). */
  frames: readonly AxionikSpectralFrame[];
  /** Target fundamental frequency in Hz (`midiNoteToHz(midiNote)`). */
  targetF0Hz: number;
  /** Number of partials per frame (`32 | 64 | 128 | 256`). */
  partialCount: number;
  /** Frame index where playback starts (`0` for normal attack, `> 0` when `attackShorten01 > 0`). */
  startFrameIndex?: number;
  /** Sustain loop bounds (`looping_orbit` vs `decaying_oneshot`). */
  sustainStartFrame?: number;
  sustainEndFrame?: number;
  sustainBehavior?: 'looping_orbit' | 'decaying_oneshot';
  /** Extracted oscillator beating / PWM modulation profile. */
  modulation?: AxionikSurfaceModulationProfile;
  /** Physical & spectral sonic matter shapers (`AxionikResonatorShapers`). */
  shapers?: AxionikResonatorShapers;
  /** Optional PCM micro-transient attack (`24-bit/96kHz` or decoded `Float32Array`) fused in phase. */
  transientPcm?: Float32Array;
  hybridTransient?: AxionikHybridTransient;
  /** Duration to render in seconds (default `1.8`). */
  durationSec?: number;
  /** Sample rate in Hz (default `44100`). */
  sampleRate?: number;
}

export interface ResynatorV2PreviewOutput {
  sampleRate: number;
  stereoL: Float32Array;
  stereoR: Float32Array;
  mono: Float32Array;
  quadFL: Float32Array;
  quadFR: Float32Array;
  quadRL: Float32Array;
  quadRR: Float32Array;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function hzToContinuousBarkIndex(freqHz: number): number {
  if (freqHz <= BARK_BAND_CENTERS_HZ[0]) return 0;
  const last = BARK_BAND_CENTERS_HZ.length - 1;
  if (freqHz >= BARK_BAND_CENTERS_HZ[last]) return last;
  for (let b = 0; b < last; b++) {
    const c0 = BARK_BAND_CENTERS_HZ[b];
    const c1 = BARK_BAND_CENTERS_HZ[b + 1];
    if (freqHz >= c0 && freqHz <= c1) {
      const span = c1 - c0;
      return b + (span > 0 ? (freqHz - c0) / span : 0);
    }
  }
  return 0;
}

function sampleBarkEnvelopeDb(envDb: readonly number[] | undefined, barkIdx: number): number {
  if (!envDb || envDb.length === 0) return -24;
  const maxIdx = envDb.length - 1;
  const clamped = clamp(barkIdx, 0, maxIdx);
  const i0 = Math.floor(clamped);
  const i1 = Math.min(maxIdx, i0 + 1);
  const frac = clamped - i0;
  return envDb[i0] * (1 - frac) + envDb[i1] * frac;
}

/**
 * Synthesizes a stereo + 4-channel Quad buffer using the exact mathematical algorithm
 * of `NeuronResynatorV2.h` (`ABDShared/Code/DspCore/NeuronVS/NeuronResynatorV2.h`).
 */
export function synthesizeResynatorV2Preview(
  input: ResynatorV2PreviewInput
): ResynatorV2PreviewOutput {
  const sampleRate = Math.max(8000, input.sampleRate ?? 44100);
  const durationSec = clamp(input.durationSec ?? 1.8, 0.1, 15.0);
  const totalSamples = Math.max(64, Math.round(sampleRate * durationSec));

  const stereoL = new Float32Array(totalSamples);
  const stereoR = new Float32Array(totalSamples);
  const mono = new Float32Array(totalSamples);
  const quadFL = new Float32Array(totalSamples);
  const quadFR = new Float32Array(totalSamples);
  const quadRL = new Float32Array(totalSamples);
  const quadRR = new Float32Array(totalSamples);

  const frames = input.frames;
  if (!frames || frames.length === 0) {
    return { sampleRate, stereoL, stereoR, mono, quadFL, quadFR, quadRL, quadRR };
  }

  const startIdx = clamp(input.startFrameIndex ?? 0, 0, frames.length - 1);
  const activeFrames = frames.slice(startIdx);
  const frameCount = activeFrames.length;
  const partialCount = Math.min(256, Math.max(1, input.partialCount || 64));
  const targetF0Hz = clamp(input.targetF0Hz || 220, 20, 12000);

  const shapers: Required<AxionikResonatorShapers> = {
    inharmonicityB: clamp(input.shapers?.inharmonicityB ?? 0, 0, 0.05),
    parity: clamp(input.shapers?.parity ?? 0, -1, 1),
    entropyRoughness: clamp(input.shapers?.entropyRoughness ?? 0, 0, 1),
    spectralShiftHz: clamp(input.shapers?.spectralShiftHz ?? 0, -500, 500),
    hfRollOffDbPerOct: clamp(input.shapers?.hfRollOffDbPerOct ?? 0, -24, 12),
    formantShiftSt: clamp(input.shapers?.formantShiftSt ?? 0, -24, 24),
    formantPreserve: clamp(input.shapers?.formantPreserve ?? 1, 0, 1),
    residualMix: clamp(input.shapers?.residualMix ?? 0.25, 0, 1),
    spatialSpread: clamp(input.shapers?.spatialSpread ?? 0.5, 0, 1),
  };

  const modRateHz = input.modulation?.modulationRateHz ?? 0;
  const modDepth = input.modulation?.modulationDepth ?? 0;
  const oddEvenModDepth = input.modulation?.oddEvenModDepth ?? 0;

  // Determine frame span in seconds (supports `tempoSync`-scaled `timeSec`)
  const firstTime = activeFrames[0].timeSec ?? 0;
  const lastTime = activeFrames[frameCount - 1].timeSec ?? durationSec;
  const naturalSpanSec = Math.max(0.05, lastTime - firstTime);

  const phases = new Float32Array(partialCount);
  const invSr = 1 / sampleRate;
  const nyquist = sampleRate * 0.485;
  const twoPi = Math.PI * 2;
  const formantShiftRatio = Math.pow(2, shapers.formantShiftSt / 12);

  let rngState = 0x13579bdf;
  const nextWhiteNoise = (): number => {
    rngState ^= rngState << 13;
    rngState ^= rngState >>> 17;
    rngState ^= rngState << 5;
    return (rngState | 0) / 2147483648;
  };

  let modPhase = 0;
  let noiseLpState = 0;
  let noiseBpState = 0;

  const transientPcm = input.transientPcm;
  const transientDurMs = input.hybridTransient?.durationMs ?? 20;
  const transientXfadeMs = input.hybridTransient?.crossfadeMs ?? 8;
  const transientLen = transientPcm
    ? Math.min(transientPcm.length, Math.round((transientDurMs / 1000) * sampleRate))
    : 0;
  const xfadeSamples = Math.max(8, Math.round((transientXfadeMs / 1000) * sampleRate));
  const spliceStart = transientLen > xfadeSamples ? transientLen - xfadeSamples : 0;

  for (let s = 0; s < totalSamples; s++) {
    const tSec = s * invSr;
    // Map tSec to continuous frame index (with sustain orbit looping when configured)
    let normPos = (tSec / naturalSpanSec) * Math.max(1, frameCount - 1);
    if (normPos >= frameCount - 1) {
      if (input.sustainBehavior === 'looping_orbit' && frameCount >= 4) {
        const susStart = clamp((input.sustainStartFrame ?? Math.floor(frameCount * 0.35)) - startIdx, 0, frameCount - 2);
        const susEnd = Math.max(susStart + 1, frameCount - 1);
        const loopLen = susEnd - susStart;
        normPos = susStart + ((normPos - susStart) % loopLen);
      } else {
        normPos = frameCount - 1;
      }
    }

    const fIdx0 = clamp(Math.floor(normPos), 0, frameCount - 1);
    const fIdx1 = Math.min(frameCount - 1, fIdx0 + 1);
    const alpha = normPos - fIdx0;
    const fA = activeFrames[fIdx0];
    const fB = activeFrames[fIdx1];

    // 1. Beating / PWM modulation
    let beatingMod = 1.0;
    let pwmParityMod = 0.0;
    if (modRateHz > 0.01) {
      modPhase += modRateHz * invSr;
      if (modPhase >= 1) modPhase -= 1;
      const lfo = Math.sin(twoPi * modPhase);
      beatingMod = 1 + lfo * (modDepth * 0.28);
      pwmParityMod = lfo * (oddEvenModDepth * 0.45);
    }

    const effParity = clamp(shapers.parity + pwmParityMod, -1, 1);
    const B = shapers.inharmonicityB;
    const entropy = shapers.entropyRoughness;

    let harmSumOdd = 0;
    let harmSumEven = 0;

    for (let k = 0; k < partialCount; k++) {
      const a0 = fA.amps[k] ?? 0;
      const a1 = fB.amps[k] ?? 0;
      let amp = a0 * (1 - alpha) + a1 * alpha;
      if (amp < 1e-6) continue;

      const n = k + 1;
      const off0 = fA.offsets[k] ?? 0;
      const off1 = fB.offsets[k] ?? 0;
      const offset = off0 * (1 - alpha) + off1 * alpha;
      const stiff = B > 0 ? Math.sqrt(1 + B * n * n) : 1;
      const ratio = Math.max(0.1, (n + offset) * stiff);
      const fnHz = targetF0Hz * ratio + shapers.spectralShiftHz;
      if (fnHz <= 15 || fnHz >= nyquist) continue;

      const isOdd = (n & 1) !== 0;
      let parityGain = 1;
      if (effParity < 0 && !isOdd) {
        parityGain = 1 + effParity;
      } else if (effParity > 0 && isOdd) {
        parityGain = 1 - effParity;
      }

      if (Math.abs(shapers.hfRollOffDbPerOct) > 0.01 && n > 1) {
        const octaves = Math.log2(n);
        const tiltDb = clamp(shapers.hfRollOffDbPerOct * octaves, -60, 24);
        amp *= Math.pow(10, tiltDb / 20);
      }

      if (Math.abs(shapers.formantShiftSt) > 0.05) {
        const origBark = hzToContinuousBarkIndex(fnHz);
        const shiftedBark = hzToContinuousBarkIndex(fnHz / formantShiftRatio);
        const envOrigDb =
          sampleBarkEnvelopeDb(fA.formantEnvelopeDb, origBark) * (1 - alpha) +
          sampleBarkEnvelopeDb(fB.formantEnvelopeDb, origBark) * alpha;
        const envShiftDb =
          sampleBarkEnvelopeDb(fA.formantEnvelopeDb, shiftedBark) * (1 - alpha) +
          sampleBarkEnvelopeDb(fB.formantEnvelopeDb, shiftedBark) * alpha;
        const deltaDb = clamp((envShiftDb - envOrigDb) * shapers.formantPreserve, -24, 18);
        amp *= Math.pow(10, deltaDb / 20);
      }

      const bw0 = fA.bandwidths?.[k] ?? 0;
      const bw1 = fB.bandwidths?.[k] ?? 0;
      const totalBw = clamp(bw0 * (1 - alpha) + bw1 * alpha + entropy * 0.45, 0, 0.95);

      let phase = phases[k];
      if (totalBw > 0.005) {
        phase += nextWhiteNoise() * totalBw * 0.04;
      }

      const osc = Math.sin(twoPi * phase) * amp * parityGain;
      if (isOdd) harmSumOdd += osc;
      else harmSumEven += osc;

      phase += fnHz * invSr;
      if (phase >= 1) phase -= Math.floor(phase);
      phases[k] = phase;
    }

    // 2. DDSP 24-Bark stochastic residual
    let residOut = 0;
    if (shapers.residualMix > 0.001) {
      let avgResidLin = 0;
      let hiResidLin = 0;
      for (let b = 0; b < 24; b++) {
        const db0 = fA.residualBandsDb?.[b] ?? -72;
        const db1 = fB.residualBandsDb?.[b] ?? -72;
        const db = db0 * (1 - alpha) + db1 * alpha;
        const lin = db > -90 ? Math.pow(10, db / 20) : 0;
        avgResidLin += lin;
        if (b >= 12) hiResidLin += lin;
      }
      avgResidLin /= 24;
      hiResidLin /= 12;

      const w = nextWhiteNoise();
      noiseLpState = 0.88 * noiseLpState + 0.12 * w;
      const hp = w - noiseLpState;
      noiseBpState = 0.65 * noiseBpState + 0.35 * hp;
      residOut =
        (noiseLpState * avgResidLin + noiseBpState * hiResidLin * 1.4) *
        shapers.residualMix *
        0.35;
    }

    let bodyMono = (harmSumOdd + harmSumEven) * beatingMod + residOut;

    // 3. Phase-aligned PCM micro-transient splice (`hybridTransient`)
    if (transientPcm && s < transientLen) {
      const pcmSample = transientPcm[s];
      if (s < spliceStart) {
        bodyMono = pcmSample;
      } else {
        const t = (s - spliceStart) / Math.max(1, xfadeSamples);
        const gainPcm = Math.cos(t * Math.PI * 0.5);
        const gainBody = Math.sin(t * Math.PI * 0.5);
        bodyMono = pcmSample * gainPcm + bodyMono * gainBody;
      }
    }

    // Gentle release envelope on final 25 ms to prevent click at buffer end
    const releaseSamples = Math.min(Math.round(0.025 * sampleRate), Math.floor(totalSamples * 0.2));
    if (s >= totalSamples - releaseSamples) {
      const fade = (totalSamples - 1 - s) / Math.max(1, releaseSamples);
      bodyMono *= fade;
    }

    // 4. Spatial Quad 4.0 + Pseudo-Surround Stereo
    const spread = shapers.spatialSpread;
    const stereoDiff = (harmSumOdd - harmSumEven) * spread * 0.32;
    const qA = fA.spatialQuad ?? [0.7, 0.7, 0.3, 0.3];
    const qB = fB.spatialQuad ?? [0.7, 0.7, 0.3, 0.3];
    const qFL = qA[0] * (1 - alpha) + qB[0] * alpha;
    const qFR = qA[1] * (1 - alpha) + qB[1] * alpha;
    const qRL = qA[2] * (1 - alpha) + qB[2] * alpha;
    const qRR = qA[3] * (1 - alpha) + qB[3] * alpha;

    const fl = (bodyMono + stereoDiff) * qFL;
    const fr = (bodyMono - stereoDiff) * qFR;
    const rl = (bodyMono - stereoDiff * 0.7 + residOut * 0.5) * qRL * spread;
    const rr = (bodyMono + stereoDiff * 0.7 - residOut * 0.5) * qRR * spread;

    quadFL[s] = fl;
    quadFR[s] = fr;
    quadRL[s] = rl;
    quadRR[s] = rr;

    stereoL[s] = clamp(fl + rl * 0.5, -1, 1);
    stereoR[s] = clamp(fr + rr * 0.5, -1, 1);
    mono[s] = clamp((stereoL[s] + stereoR[s]) * 0.5, -1, 1);
  }

  // Normalize peak safely to -1.5 dBFS (~0.84) if signal is quiet or hot
  let peak = 0;
  for (let i = 0; i < totalSamples; i++) {
    const aL = Math.abs(stereoL[i]);
    const aR = Math.abs(stereoR[i]);
    if (aL > peak) peak = aL;
    if (aR > peak) peak = aR;
  }
  if (peak > 1e-4) {
    const normGain = 0.84 / peak;
    for (let i = 0; i < totalSamples; i++) {
      stereoL[i] = clamp(stereoL[i] * normGain, -1, 1);
      stereoR[i] = clamp(stereoR[i] * normGain, -1, 1);
      mono[i] = clamp(mono[i] * normGain, -1, 1);
    }
  }

  return { sampleRate, stereoL, stereoR, mono, quadFL, quadFR, quadRL, quadRR };
}
