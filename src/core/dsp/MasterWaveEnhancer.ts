// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Fase 8: Master Wave Standard (24-bit / 96 kHz),
// Smart Short-Loop Expansion, Auto-Loop Finder, NeuronDB Cubic-Spline
// Regeneration & Pluggable AI Enhancement Provider Bridge
// ─────────────────────────────────────────────────────────

import { clamp } from './DspMath.ts';
import { SpectralModelData } from './GridIndicator.ts';
import {
  decodeAiff,
  decodeWav,
  encodeWavPcm24,
  midiNoteToHz,
  resampleAudioChannel,
  type AiffInstrumentInfo,
} from './WavDecoder.ts';
import type {
  MasterChannelLayout,
  MasterPromotionMethod,
  MasterWaveConfig,
  MasterWaveResult,
} from '../types.ts';

export const DEFAULT_MASTER_WAVE_CONFIG: MasterWaveConfig = {
  promotionMethod: 'dsp-enhanced',
  channelLayout: 'original',
  targetSampleRate: 96000,
  targetBitDepth: 24,
  minLoopDurationSec: 4.0,
  enableBandwidthExtension: true,
  enableDenoiseGate: true,
  aiBridgeEndpoint: 'http://127.0.0.1:7860/api/enhance',
};

/**
 * Fase 8.4 — Pluggable AI Audio Enhancement Provider interface
 * (supports AudioSR, HTDemucs, BigVGAN, and Latent Audio Outpainting).
 */
export type AiModelCapability = 'audiosr' | 'htdemucs' | 'bigvgan' | 'outpaint-loop';

export interface AiEnhancementRequest {
  channels: Float32Array[];
  sampleRate: number;
  targetSampleRate: number;
  capabilities: AiModelCapability[];
  loopStart?: number;
  loopEnd?: number;
  targetLoopDurationSec?: number;
  endpoint?: string;
}

export interface AiEnhancementResponse {
  channels: Float32Array[];
  sampleRate: number;
  loopStart?: number;
  loopEnd?: number;
  providerName: string;
}

export interface AudioEnhancementProvider {
  readonly id: string;
  readonly name: string;
  readonly capabilities: readonly AiModelCapability[];
  isAvailable(endpoint?: string): Promise<boolean>;
  enhance(request: AiEnhancementRequest): Promise<AiEnhancementResponse>;
}

/**
 * Local / Hybrid HTTP AI Bridge Provider (connects to local Python FastAPI / Gradio
 * server running AudioSR / HTDemucs / BigVGAN, with automatic timeout & fallback).
 */
export class HttpAiBridgeProvider implements AudioEnhancementProvider {
  public readonly id = 'http-local-ai-bridge';
  public readonly name = 'Local AI Bridge (AudioSR / Demucs / BigVGAN)';
  public readonly capabilities: readonly AiModelCapability[] = [
    'audiosr',
    'htdemucs',
    'bigvgan',
    'outpaint-loop',
  ];

  public async isAvailable(endpoint = DEFAULT_MASTER_WAVE_CONFIG.aiBridgeEndpoint): Promise<boolean> {
    if (!endpoint || typeof fetch === 'undefined') return false;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 900);
      const healthUrl = endpoint.replace(/\/enhance\/?$/, '/health');
      const res = await fetch(healthUrl, { method: 'GET', signal: controller.signal });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  }

  public async enhance(request: AiEnhancementRequest): Promise<AiEnhancementResponse> {
    const endpoint = request.endpoint || DEFAULT_MASTER_WAVE_CONFIG.aiBridgeEndpoint;
    if (!endpoint || typeof fetch === 'undefined') {
      throw new Error('AI Bridge endpoint unavailable in current environment');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    try {
      const wav24 = encodeWavPcm24(request.channels, request.sampleRate, {
        loopStart: request.loopStart,
        loopEnd: request.loopEnd,
      });
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'audio/wav',
          'X-Target-Sample-Rate': String(request.targetSampleRate),
          'X-Target-Loop-Sec': String(request.targetLoopDurationSec ?? 0),
          'X-Capabilities': request.capabilities.join(','),
        },
        body: wav24,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        throw new Error(`AI Bridge returned HTTP ${res.status}`);
      }
      const outBuf = await res.arrayBuffer();
      const decoded = decodeWav(outBuf);
      return {
        channels: decoded.channels,
        sampleRate: decoded.sampleRate,
        loopStart: decoded.instrument?.loopStart,
        loopEnd: decoded.instrument?.loopEnd,
        providerName: res.headers.get('X-AI-Provider') || this.name,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

let customAiProvider: AudioEnhancementProvider | null = null;
const defaultHttpAiProvider = new HttpAiBridgeProvider();

export function registerAiEnhancementProvider(provider: AudioEnhancementProvider | null): void {
  customAiProvider = provider;
}

export function getActiveAiEnhancementProvider(): AudioEnhancementProvider {
  return customAiProvider ?? defaultHttpAiProvider;
}

/**
 * 8.2 Auto-Loop Finder: Searches around `candidateStart` and `candidateEnd` for
 * rising zero-crossings (`s[i-1] <= 0 && s[i] > 0`) that maximize local waveform
 * Normalized Cross-Correlation (NCC) and envelope continuity.
 */
export function findOptimalZeroCrossingLoop(
  channels: Float32Array[],
  sampleRate: number,
  candidateStart: number,
  candidateEnd: number
): {
  loopStart: number;
  loopEnd: number;
  zeroCrossingCorrelation: number;
} {
  const ch0 = channels[0] ?? new Float32Array(0);
  const n = ch0.length;
  if (n < 128) {
    return { loopStart: 0, loopEnd: Math.max(0, n - 1), zeroCrossingCorrelation: 1.0 };
  }

  const startCenter = clamp(Math.round(candidateStart), 32, Math.max(32, n - 96));
  const endCenter = clamp(Math.round(candidateEnd), startCenter + 64, n - 32);

  const searchRadius = Math.min(
    Math.round(sampleRate * 0.025), // ±25 ms search window
    Math.floor((endCenter - startCenter) * 0.25)
  );
  const corrWin = Math.min(Math.round(sampleRate * 0.008), 512); // 8 ms correlation window

  const findRisingZeroCrossings = (center: number, radius: number): number[] => {
    const lo = Math.max(corrWin, center - radius);
    const hi = Math.min(n - corrWin - 1, center + radius);
    const list: number[] = [];
    for (let i = lo; i <= hi; i++) {
      if (ch0[i - 1] <= 0 && ch0[i] > 0) {
        list.push(i);
      }
    }
    if (list.length === 0) list.push(clamp(center, corrWin, n - corrWin - 1));
    return list;
  };

  const starts = findRisingZeroCrossings(startCenter, searchRadius);
  const ends = findRisingZeroCrossings(endCenter, searchRadius);

  // Pick the start crossing with the cleanest rising slope near startCenter
  let bestStart = starts[0];
  let bestStartScore = -Infinity;
  for (const sIdx of starts) {
    const distPenalty = Math.abs(sIdx - startCenter) / Math.max(1, searchRadius);
    const slope = ch0[sIdx] - ch0[sIdx - 1];
    const score = slope - distPenalty * 0.05;
    if (score > bestStartScore) {
      bestStartScore = score;
      bestStart = sIdx;
    }
  }

  // Evaluate candidate end crossings by Normalized Cross-Correlation (NCC) against bestStart
  let bestEnd = ends[0];
  let bestNcc = -1.0;
  const maxEndCandidates = 48;
  const stepEnd = Math.max(1, Math.floor(ends.length / maxEndCandidates));

  for (let idx = 0; idx < ends.length; idx += stepEnd) {
    const eIdx = ends[idx];
    if (eIdx <= bestStart + corrWin) continue;

    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let k = -corrWin; k < corrWin; k++) {
      const a = ch0[bestStart + k] ?? 0;
      const b = ch0[eIdx + k] ?? 0;
      dot += a * b;
      normA += a * a;
      normB += b * b;
    }
    const denom = Math.sqrt(normA * normB);
    const ncc = denom > 1e-9 ? dot / denom : 0;
    if (ncc > bestNcc) {
      bestNcc = ncc;
      bestEnd = eIdx;
    }
  }

  const normalizedCorr = Number(clamp((bestNcc + 1.0) * 0.5, 0, 1).toFixed(3));
  return {
    loopStart: bestStart,
    loopEnd: Math.max(bestStart + 1, bestEnd),
    zeroCrossingCorrelation: normalizedCorr,
  };
}

/**
 * 8.2 Smart Short-Loop Expansion & Auto-Loop Relocator:
 * Unrolls short loops (e.g. < 3..6 seconds in SoundFonts) with equal-power crossfades
 * and subtle organic micro-modulation (non-repeating phase/formant breathing) so the
 * sustain evolves naturally, then computes new optimal zero-crossing loop markers.
 */
export function expandShortLoopAndRelocate(
  channels: Float32Array[],
  sampleRate: number,
  loopStart: number,
  loopEnd: number,
  minLoopDurationSec = 4.0
): {
  channels: Float32Array[];
  loopStart: number;
  loopEnd: number;
  loopExpanded: boolean;
  zeroCrossingCorrelation: number;
} {
  const numCh = channels.length;
  const origLen = channels[0]?.length ?? 0;
  if (numCh === 0 || origLen < 256) {
    return {
      channels,
      loopStart: 0,
      loopEnd: Math.max(0, origLen - 1),
      loopExpanded: false,
      zeroCrossingCorrelation: 1.0,
    };
  }

  // If no valid loop was provided, establish a natural sustain loop across 25%..92% of the sample
  let validStart = clamp(Math.round(loopStart), 0, origLen - 2);
  let validEnd = clamp(Math.round(loopEnd), 0, origLen - 1);
  if (validEnd <= validStart + 64) {
    validStart = Math.floor(origLen * 0.25);
    validEnd = Math.floor(origLen * 0.92);
  }

  // First snap the source loop to optimal zero crossings
  const initialSnap = findOptimalZeroCrossingLoop(channels, sampleRate, validStart, validEnd);
  validStart = initialSnap.loopStart;
  validEnd = initialSnap.loopEnd;

  const loopLen = validEnd - validStart;
  const currentLoopSec = loopLen / sampleRate;

  if (minLoopDurationSec <= 0 || currentLoopSec >= minLoopDurationSec || loopLen < 64) {
    return {
      channels,
      loopStart: validStart,
      loopEnd: validEnd,
      loopExpanded: false,
      zeroCrossingCorrelation: initialSnap.zeroCrossingCorrelation,
    };
  }

  // Calculate how many unrolled cycles we need to reach minLoopDurationSec
  const targetLoopSamples = Math.round(minLoopDurationSec * sampleRate);
  const xfadeLen = Math.min(Math.round(sampleRate * 0.015), Math.floor(loopLen * 0.25)); // up to 15 ms crossfade
  const stepPerCycle = Math.max(32, loopLen - xfadeLen);
  const repeatsNeeded = Math.max(2, Math.ceil(targetLoopSamples / stepPerCycle) + 1);
  const tailLen = Math.max(0, origLen - validEnd);
  const newUnrolledLoopLen = xfadeLen + repeatsNeeded * stepPerCycle;
  const totalOutLen = validStart + newUnrolledLoopLen + tailLen;

  const outChannels: Float32Array[] = [];
  for (let ch = 0; ch < numCh; ch++) {
    const src = channels[ch];
    const dst = new Float32Array(totalOutLen);

    // 1. Copy attack + pre-loop segment intact (0 .. validStart)
    for (let i = 0; i < validStart; i++) {
      dst[i] = src[i];
    }

    // 2. Unroll loop cycles with equal-power seam crossfade + organic micro-modulation
    let writePos = validStart;
    for (let rep = 0; rep < repeatsNeeded; rep++) {
      const chPhaseOffset = ch * 1.17;
      for (let i = 0; i < stepPerCycle + xfadeLen; i++) {
        const srcIdx = validStart + i;
        if (srcIdx >= origLen) break;
        const outIdx = writePos + i;
        if (outIdx >= totalOutLen) break;

        const tSec = (outIdx - validStart) / sampleRate;
        // Organic non-repeating micro-modulation (zeroed near outer loop boundaries for seamless closure)
        const boundaryFade = Math.sin(
          Math.PI * clamp((outIdx - validStart) / Math.max(1, newUnrolledLoopLen), 0, 1)
        );
        const lfo1 = Math.sin(2 * Math.PI * 0.73 * tSec + chPhaseOffset);
        const lfo2 = Math.sin(2 * Math.PI * 1.91 * tSec + rep * 0.85 + chPhaseOffset);
        const ampBreath = 1.0 + 0.022 * boundaryFade * (0.65 * lfo1 + 0.35 * lfo2);

        // Subtle fractional phase/delay modulation (±0.35 ms) inside unrolled body
        const delayModSamples = boundaryFade * 0.00028 * sampleRate * lfo2;
        const readPos = clamp(srcIdx + delayModSamples, validStart, validEnd);
        const r0 = Math.floor(readPos);
        const frac = readPos - r0;
        const r1 = Math.min(origLen - 1, r0 + 1);
        const sampleVal = (src[r0] * (1 - frac) + src[r1] * frac) * ampBreath;

        if (rep > 0 && i < xfadeLen) {
          // Equal-power / linear hybrid crossfade with previous cycle tail
          const alpha = i / Math.max(1, xfadeLen);
          const gainIn = Math.sin(alpha * Math.PI * 0.5);
          const gainPrev = Math.cos(alpha * Math.PI * 0.5);
          dst[outIdx] = dst[outIdx] * gainPrev + sampleVal * gainIn;
        } else {
          dst[outIdx] = sampleVal;
        }
      }
      writePos += stepPerCycle;
    }

    // 3. Copy post-loop release tail
    const tailWriteStart = validStart + newUnrolledLoopLen;
    for (let i = 0; i < tailLen && tailWriteStart + i < totalOutLen; i++) {
      dst[tailWriteStart + i] = src[validEnd + i];
    }

    outChannels.push(dst);
  }

  // 4. Relocate optimal zero-crossing markers spanning the expanded sustain
  const newCandidateStart = validStart + xfadeLen;
  const newCandidateEnd = validStart + newUnrolledLoopLen - xfadeLen;
  const finalSnap = findOptimalZeroCrossingLoop(
    outChannels,
    sampleRate,
    newCandidateStart,
    newCandidateEnd
  );

  // Apply a short click-free seam blend right at finalSnap.loopEnd -> finalSnap.loopStart
  const seamBlend = Math.min(64, Math.floor((finalSnap.loopEnd - finalSnap.loopStart) * 0.05));
  if (seamBlend > 2) {
    for (let ch = 0; ch < numCh; ch++) {
      const buf = outChannels[ch];
      for (let k = 0; k < seamBlend; k++) {
        const t = k / seamBlend;
        const endIdx = finalSnap.loopEnd - seamBlend + k;
        const startPreIdx = Math.max(0, finalSnap.loopStart - seamBlend + k);
        buf[endIdx] = buf[endIdx] * (1 - t) + buf[startPreIdx] * t;
      }
    }
  }

  return {
    channels: outChannels,
    loopStart: finalSnap.loopStart,
    loopEnd: finalSnap.loopEnd,
    loopExpanded: true,
    zeroCrossingCorrelation: finalSnap.zeroCrossingCorrelation,
  };
}

/**
 * 8.1b Spatial Expansion:
 * - 'original': keeps original channels (1ch or 2ch).
 * - 'stereo': expands 1ch mono to coherent 2.0 Stereo using complementary Mid/Side
 *   all-pass/micro-comb decorrelation (+Side on L, -Side on R -> 100% mono-compatible!).
 * - 'quad-surround': expands to 4.0 Quadraphonic Surround [FL, FR, RL, RR] honoring
 *   the Hartmann Neuron hardware's 4-channel surround architecture.
 */
export function expandSpatialChannels(
  channels: Float32Array[],
  sampleRate: number,
  layout: MasterChannelLayout
): Float32Array[] {
  const n = channels[0]?.length ?? 0;
  if (n === 0 || layout === 'original') {
    return channels.map((c) => new Float32Array(c));
  }

  // Ensure we have a Stereo front pair [FL, FR] first
  let fl: Float32Array;
  let fr: Float32Array;

  if (channels.length >= 2) {
    fl = new Float32Array(channels[0]);
    fr = new Float32Array(channels[1]);
  } else {
    const mono = channels[0];
    fl = new Float32Array(n);
    fr = new Float32Array(n);
    // Complementary Haas-safe side signal (delays of 3.1 ms and 7.4 ms, high-passed)
    const d1 = Math.max(1, Math.round(sampleRate * 0.0031));
    const d2 = Math.max(2, Math.round(sampleRate * 0.0074));
    let lpState = 0;
    const lpAlpha = Math.min(0.25, (2 * Math.PI * 250) / sampleRate);
    for (let i = 0; i < n; i++) {
      const m = mono[i];
      const s1 = i >= d1 ? mono[i - d1] : 0;
      const s2 = i >= d2 ? mono[i - d2] : 0;
      const rawDiff = 0.6 * (s1 - s2);
      lpState += lpAlpha * (rawDiff - lpState);
      const hpSide = (rawDiff - lpState) * 0.22; // high-passed side keeps bass centered
      fl[i] = clamp(m + hpSide, -1.0, 1.0);
      fr[i] = clamp(m - hpSide, -1.0, 1.0);
    }
  }

  if (layout === 'stereo') {
    return [fl, fr];
  }

  // 'quad-surround': synthesize Rear Left (RL) and Rear Right (RR) diffuse surround field
  const rl = new Float32Array(n);
  const rr = new Float32Array(n);
  const delayRL = Math.max(4, Math.round(sampleRate * 0.0143)); // 14.3 ms early reflection
  const delayRR = Math.max(6, Math.round(sampleRate * 0.0189)); // 18.9 ms early reflection
  const delayCross = Math.max(8, Math.round(sampleRate * 0.0267)); // 26.7 ms cross-diffuse
  const dampCoeff = Math.exp((-2 * Math.PI * 4800) / sampleRate);
  let lpRL = 0;
  let lpRR = 0;

  for (let i = 0; i < n; i++) {
    const sRL =
      0.72 * (i >= delayRL ? fl[i - delayRL] : 0) -
      0.38 * (i >= delayCross ? fr[i - delayCross] : 0);
    const sRR =
      0.72 * (i >= delayRR ? fr[i - delayRR] : 0) +
      0.38 * (i >= delayCross ? fl[i - delayCross] : 0);

    lpRL = (1 - dampCoeff) * sRL + dampCoeff * lpRL;
    lpRR = (1 - dampCoeff) * sRR + dampCoeff * lpRR;

    rl[i] = clamp(lpRL * 0.68, -1.0, 1.0);
    rr[i] = clamp(lpRR * 0.68, -1.0, 1.0);
  }

  return [fl, fr, rl, rr];
}

/**
 * Phase-compensated downmix from any channel layout (1ch, 2ch Stereo, or 4ch Quad Surround)
 * at any sample rate down to canonical 44.100 Hz Mono for classic `.scape`/`.sphere` compilation.
 */
export function downmixToClassicMono44k1(
  channels: Float32Array[],
  sampleRate: number
): Float32Array {
  const n = channels[0]?.length ?? 0;
  if (n === 0) return new Float32Array(0);

  const mono = new Float32Array(n);
  if (channels.length === 1) {
    mono.set(channels[0]);
  } else {
    // Front pair carries the exact phase-coherent Mid signal ((FL + FR) * 0.5)
    const fl = channels[0];
    const fr = channels[1];
    for (let i = 0; i < n; i++) {
      mono[i] = (fl[i] + fr[i]) * 0.5;
    }
  }

  return sampleRate === 44100 ? mono : resampleAudioChannel(mono, sampleRate, 44100);
}

/**
 * 8.3 DSP Algorithmic Restoration at 96.000 Hz:
 * - Quantization De-noising Gate (removes 8/16-bit quantization floor hiss)
 * - Harmonic Bandwidth Extension (BWE): synthesizes coherent upper harmonics above
 *   the original Nyquist (up to 42 kHz in the 96 kHz domain) via multiband harmonic excitation.
 */
export function applyDspEnhancement96k(
  channels96k: Float32Array[],
  sampleRate = 96000,
  options: {
    originalSampleRate: number;
    enableDenoiseGate: boolean;
    enableBandwidthExtension: boolean;
  }
): Float32Array[] {
  const numCh = channels96k.length;
  const n = channels96k[0]?.length ?? 0;
  if (numCh === 0 || n === 0) return channels96k;

  const out: Float32Array[] = [];
  const origNyquist = Math.min(20000, options.originalSampleRate * 0.46);

  // One-pole coefficients for band extraction (3.5 kHz .. origNyquist) and high-pass BWE injection (> origNyquist)
  const hpExcCoeff = Math.exp((-2 * Math.PI * 3500) / sampleRate);
  const hpAirCoeff = Math.exp((-2 * Math.PI * origNyquist) / sampleRate);
  const lpCeilingCoeff = Math.exp((-2 * Math.PI * Math.min(42000, sampleRate * 0.44)) / sampleRate);

  for (let ch = 0; ch < numCh; ch++) {
    const src = channels96k[ch];
    const dst = new Float32Array(n);

    let envFollower = 0;
    let lp3500 = 0;
    let lpAir = 0;
    let lpCeil = 0;

    for (let i = 0; i < n; i++) {
      const x = src[i];
      const absX = Math.abs(x);
      envFollower = absX > envFollower ? 0.02 * absX + 0.98 * envFollower : 0.0005 * absX + 0.9995 * envFollower;

      // 1. Smooth quantization de-noising gate (-72 dB threshold)
      let cleanX = x;
      if (options.enableDenoiseGate) {
        const gateFloor = 0.00025; // ~ -72 dBFS
        if (envFollower < gateFloor) {
          const ratio = envFollower / gateFloor;
          cleanX = x * (ratio * ratio);
        }
      }

      // 2. Harmonic Bandwidth Extension (BWE) into the 20 kHz .. 42 kHz ultrasonic/air band
      let bweAir = 0;
      if (options.enableBandwidthExtension && sampleRate >= 88200) {
        lp3500 = (1 - hpExcCoeff) * cleanX + hpExcCoeff * lp3500;
        const highMid = cleanX - lp3500;
        // Soft harmonic excitation (generates 2nd & 3rd harmonics of the upper-mid partials)
        const excited = Math.tanh(highMid * 2.4) - highMid * 1.85;
        // High-pass above original Nyquist so fundamental passband is untouched
        lpAir = (1 - hpAirCoeff) * excited + hpAirCoeff * lpAir;
        const upperHarmonics = excited - lpAir;
        // Low-pass at 42 kHz anti-aliasing ceiling
        lpCeil = (1 - lpCeilingCoeff) * upperHarmonics + lpCeilingCoeff * lpCeil;
        bweAir = lpCeil * 0.18 * clamp(envFollower * 3.5, 0, 1);
      }

      dst[i] = clamp(cleanX + bweAir, -0.995, 0.995);
    }

    out.push(dst);
  }

  return out;
}

/**
 * 8.1..8.4 Full Master Wave Promotion Pipeline:
 * Takes a decoded audio buffer (or raw WAV/AIFF bytes) and promotes it to the
 * 24-bit PCM / 96.000 Hz Master Wave Standard with Short-Loop Expansion,
 * Auto-Loop Relocator, Spatial Expansion (Original / Stereo / Quad Surround),
 * and Direct / DSP-Enhanced / AI-Bridge processing.
 */
export async function promoteBufferToMasterWave(
  rawBuffer: ArrayBuffer,
  sampleName: string,
  zoneId: string,
  config: Partial<MasterWaveConfig> = {},
  loopMeta?: {
    rootKey?: number;
    detuneCents?: number;
    loopStart?: number;
    loopEnd?: number;
    loopMode?: AiffInstrumentInfo['loopMode'];
  }
): Promise<{
  wav24Buffer: ArrayBuffer;
  channels: Float32Array[];
  result: MasterWaveResult;
}> {
  const cfg: MasterWaveConfig = { ...DEFAULT_MASTER_WAVE_CONFIG, ...config };
  const targetRate = clamp(cfg.targetSampleRate || 96000, 44100, 192000);

  const view = new DataView(rawBuffer);
  const magic =
    rawBuffer.byteLength >= 4
      ? String.fromCharCode(
          view.getUint8(0),
          view.getUint8(1),
          view.getUint8(2),
          view.getUint8(3)
        )
      : '';
  const decoded = magic === 'FORM' ? decodeAiff(rawBuffer) : decodeWav(rawBuffer);

  const origRate = decoded.sampleRate;
  const origDurationSec = decoded.durationSec;
  const origLoopStart = loopMeta?.loopStart ?? decoded.instrument?.loopStart ?? 0;
  const origLoopEnd = loopMeta?.loopEnd ?? decoded.instrument?.loopEnd ?? 0;

  // Step 1: Smart Short-Loop Expansion & Auto-Loop Finder (in source sample rate)
  const loopStage = expandShortLoopAndRelocate(
    decoded.channels,
    origRate,
    origLoopStart,
    origLoopEnd,
    cfg.minLoopDurationSec
  );

  let workingChannels = loopStage.channels;
  let workingRate = origRate;
  let finalLoopStart = loopStage.loopStart;
  let finalLoopEnd = loopStage.loopEnd;
  let methodUsed: MasterPromotionMethod = cfg.promotionMethod;
  let aiProviderUsed: string | undefined;

  // Step 2: Optional AI Bridge (AudioSR / Demucs / BigVGAN) with automatic fallback to DSP Enhanced
  if (cfg.promotionMethod === 'ai-bridge') {
    const provider = getActiveAiEnhancementProvider();
    try {
      const avail = await provider.isAvailable(cfg.aiBridgeEndpoint);
      if (avail) {
        const aiRes = await provider.enhance({
          channels: workingChannels,
          sampleRate: workingRate,
          targetSampleRate: targetRate,
          capabilities: ['audiosr', 'bigvgan'],
          loopStart: finalLoopStart,
          loopEnd: finalLoopEnd,
          targetLoopDurationSec: cfg.minLoopDurationSec,
          endpoint: cfg.aiBridgeEndpoint,
        });
        workingChannels = aiRes.channels;
        workingRate = aiRes.sampleRate;
        if (typeof aiRes.loopStart === 'number' && typeof aiRes.loopEnd === 'number') {
          finalLoopStart = aiRes.loopStart;
          finalLoopEnd = aiRes.loopEnd;
        }
        aiProviderUsed = aiRes.providerName;
      } else {
        methodUsed = 'dsp-enhanced';
      }
    } catch {
      methodUsed = 'dsp-enhanced';
    }
  }

  // Step 3: Windowed-Sinc Linear-Phase Upsampling to 96.000 Hz
  if (workingRate !== targetRate) {
    const rateRatio = targetRate / workingRate;
    workingChannels = workingChannels.map((ch) =>
      resampleAudioChannel(ch, workingRate, targetRate)
    );
    finalLoopStart = Math.round(finalLoopStart * rateRatio);
    finalLoopEnd = Math.round(finalLoopEnd * rateRatio);
    workingRate = targetRate;
  }

  // Re-refine zero-crossing loop points at 96 kHz sub-sample precision
  const snap96k = findOptimalZeroCrossingLoop(
    workingChannels,
    workingRate,
    finalLoopStart,
    finalLoopEnd
  );
  finalLoopStart = snap96k.loopStart;
  finalLoopEnd = snap96k.loopEnd;

  // Step 4: DSP Algorithmic Restoration (De-noise Gate + Ultrasonic BWE up to 42 kHz)
  if (methodUsed === 'dsp-enhanced') {
    workingChannels = applyDspEnhancement96k(workingChannels, workingRate, {
      originalSampleRate: origRate,
      enableDenoiseGate: cfg.enableDenoiseGate,
      enableBandwidthExtension: cfg.enableBandwidthExtension,
    });
  }

  // Step 5: Spatial Channel Expansion (Original / Stereo 2.0 / Quad Surround 4.0)
  const spatialChannels = expandSpatialChannels(
    workingChannels,
    workingRate,
    cfg.channelLayout
  );

  // Step 6: Encode to 24-bit PCM / 96.000 Hz RIFF/WAVE with embedded `smpl` loop markers
  const rootKey = loopMeta?.rootKey ?? decoded.instrument?.rootKey ?? 60;
  const detune = loopMeta?.detuneCents ?? decoded.instrument?.detune ?? 0;
  const wav24Buffer = encodeWavPcm24(spatialChannels, workingRate, {
    rootKey,
    detune,
    loopStart: finalLoopStart,
    loopEnd: finalLoopEnd,
    loopMode: loopMeta?.loopMode ?? decoded.instrument?.loopMode ?? 'loop_continuous',
  });

  const baseStem = sampleName.replace(/\.(wav|aif|aiff)$/i, '');
  const masterSampleName = baseStem.endsWith('_96k24b')
    ? `${baseStem}.wav`
    : `${baseStem}_96k24b.wav`;

  const masterSamples = spatialChannels[0]?.length ?? 0;
  const masterDurationSec = Number((masterSamples / workingRate).toFixed(3));
  const loopDurationSec = Number(
    Math.max(0, (finalLoopEnd - finalLoopStart) / workingRate).toFixed(3)
  );

  return {
    wav24Buffer,
    channels: spatialChannels,
    result: {
      zoneId,
      sampleName,
      masterSampleName,
      originalSampleRate: origRate,
      masterSampleRate: workingRate,
      bitDepth: 24,
      numChannels: spatialChannels.length,
      originalDurationSec: Number(origDurationSec.toFixed(3)),
      masterDurationSec,
      loopExpanded: loopStage.loopExpanded,
      loopStart: finalLoopStart,
      loopEnd: finalLoopEnd,
      loopDurationSec,
      zeroCrossingCorrelation: snap96k.zeroCrossingCorrelation,
      promotionMethodUsed: methodUsed,
      aiProviderUsed,
    },
  };
}

/**
 * 8.3 Regeneración desde la Librería Original (`NeuronDB` `.scape` + `.sphere` -> WAV Maestro 24-bit / 96 kHz):
 * Reconstructs a high-definition Master Wave from a `SpectralModelData` using Catmull-Rom
 * cubic spline interpolation across temporal frames, coherent phase integration,
 * Bandwidth Extension (BWE), and Stereo/Quad Surround spatialization.
 */
export function regenerateMasterWaveFromModel(
  model: SpectralModelData,
  rootKey = 60,
  durationSec = 4.0,
  config: Partial<MasterWaveConfig> = {}
): {
  wav24Buffer: ArrayBuffer;
  channels: Float32Array[];
  loopStart: number;
  loopEnd: number;
} {
  const cfg: MasterWaveConfig = { ...DEFAULT_MASTER_WAVE_CONFIG, ...config };
  const sampleRate = clamp(cfg.targetSampleRate || 96000, 44100, 192000);
  const numSamples = Math.max(1024, Math.round(durationSec * sampleRate));
  const mono = new Float32Array(numSamples);

  const f0 = Math.max(20, model.frameF0 > 0 ? model.frameF0 : midiNoteToHz(rootKey));
  const numFrames = Math.max(1, model.numFramesOf(0));
  const nyquist = sampleRate * 0.46;

  // Catmull-Rom cubic spline helper for smooth frame interpolation
  const catmullRom = (p0: number, p1: number, p2: number, p3: number, t: number): number => {
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      0.5 *
      (2 * p1 +
        (-p0 + p2) * t +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
        (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
    );
  };

  for (let p = 0; p < 64; p++) {
    const harmNum = p + 1;
    if (harmNum * f0 >= nyquist) break;

    let maxPartialAmp = model.amplitudes[p] ?? 0;
    for (let f = 0; f < numFrames; f++) {
      maxPartialAmp = Math.max(maxPartialAmp, model.ampsOfLayer(0, f)[p] ?? 0);
    }
    if (maxPartialAmp < 1e-4) continue;

    let phase = (p * 0.61803398875 * 2 * Math.PI) % (2 * Math.PI);
    const twoPiOverSr = (2 * Math.PI) / sampleRate;

    for (let i = 0; i < numSamples; i++) {
      const pos = (i / Math.max(1, numSamples - 1)) * Math.max(0, numFrames - 1);
      const fIdx = Math.floor(pos);
      const frac = pos - fIdx;

      const f0Idx = Math.max(0, fIdx - 1);
      const f1Idx = Math.min(numFrames - 1, fIdx);
      const f2Idx = Math.min(numFrames - 1, fIdx + 1);
      const f3Idx = Math.min(numFrames - 1, fIdx + 2);

      const amp =
        numFrames >= 3
          ? Math.max(
              0,
              catmullRom(
                model.ampsOfLayer(0, f0Idx)[p],
                model.ampsOfLayer(0, f1Idx)[p],
                model.ampsOfLayer(0, f2Idx)[p],
                model.ampsOfLayer(0, f3Idx)[p],
                frac
              )
            )
          : (model.ampsOfLayer(0, f1Idx)[p] ?? model.amplitudes[p] ?? 0);

      const offHz =
        numFrames >= 3
          ? catmullRom(
              model.offsetsOfLayer(0, f0Idx)[p],
              model.offsetsOfLayer(0, f1Idx)[p],
              model.offsetsOfLayer(0, f2Idx)[p],
              model.offsetsOfLayer(0, f3Idx)[p],
              frac
            )
          : (model.offsetsOfLayer(0, f1Idx)[p] ?? model.frequencyOffsets[p] ?? 0);

      const instFreq = Math.max(20, harmNum * f0 + offHz);
      phase += instFreq * twoPiOverSr;
      mono[i] += amp * Math.sin(phase);
    }
  }

  // Normalize peak to -1.5 dBFS
  let peak = 0;
  for (let i = 0; i < numSamples; i++) {
    const a = Math.abs(mono[i]);
    if (a > peak) peak = a;
  }
  if (peak > 1e-6) {
    const gain = 0.84 / peak;
    for (let i = 0; i < numSamples; i++) {
      mono[i] *= gain;
    }
  }

  const enhanced = applyDspEnhancement96k([mono], sampleRate, {
    originalSampleRate: 44100,
    enableDenoiseGate: cfg.enableDenoiseGate,
    enableBandwidthExtension: cfg.enableBandwidthExtension,
  });

  const spatial = expandSpatialChannels(
    enhanced,
    sampleRate,
    cfg.channelLayout === 'original' ? 'stereo' : cfg.channelLayout
  );

  const loopSnap = findOptimalZeroCrossingLoop(
    spatial,
    sampleRate,
    Math.floor(numSamples * 0.28),
    Math.floor(numSamples * 0.92)
  );

  const wav24Buffer = encodeWavPcm24(spatial, sampleRate, {
    rootKey,
    detune: 0,
    loopStart: loopSnap.loopStart,
    loopEnd: loopSnap.loopEnd,
    loopMode: 'loop_continuous',
  });

  return {
    wav24Buffer,
    channels: spatial,
    loopStart: loopSnap.loopStart,
    loopEnd: loopSnap.loopEnd,
  };
}
