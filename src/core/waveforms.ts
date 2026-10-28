// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Waveform Envelopes for Zone Ribbons
//
// Extracted verbatim from `WebAudioPipeline` (DRY / P1.1):
// normalized peak envelopes over in-memory sample buffers, plus the
// pure `ZoneRibbon` watermark payload builder. The pipeline keeps only
// orchestration (zone lookup, spectral/resynth cache access).
// ─────────────────────────────────────────────────────────

import { clamp } from './dsp/DspMath.ts';
import { decodeWav, synthesizeDemoWav } from './dsp/WavDecoder.ts';

/** Buffers decoded on demand + per-sample envelope cache. */
export interface EnvelopeStore {
  buffers: Map<string, ArrayBuffer>;
  cache: Map<string, number[]>;
}

export function computeNormalizedEnvelope(mono: Float32Array, cols = 64): number[] {
  const out = new Array<number>(cols).fill(0);
  if (mono.length === 0) return out;
  let globalPeak = 1e-6;
  for (let i = 0; i < mono.length; i++) {
    const a = Math.abs(mono[i]);
    if (a > globalPeak) globalPeak = a;
  }
  for (let c = 0; c < cols; c++) {
    const i0 = Math.floor((c * mono.length) / cols);
    const i1 = Math.max(i0 + 1, Math.floor(((c + 1) * mono.length) / cols));
    let peak = 0;
    for (let i = i0; i < i1 && i < mono.length; i++) {
      const a = Math.abs(mono[i]);
      if (a > peak) peak = a;
    }
    out[c] = Number(clamp(peak / globalPeak, 0, 1).toFixed(3));
  }
  return out;
}

export function getSampleEnvelope(
  store: EnvelopeStore,
  sampleName: string | null,
  fallbackKey = 60
): number[] {
  if (!sampleName) return [];
  const cached = store.cache.get(sampleName);
  if (cached) return cached;
  let raw = store.buffers.get(sampleName);
  if (!raw) {
    raw = synthesizeDemoWav('strings', fallbackKey, 44100, 1.0);
    store.buffers.set(sampleName, raw);
  }
  try {
    const decoded = decodeWav(raw);
    const env = computeNormalizedEnvelope(decoded.mono, 64);
    store.cache.set(sampleName, env);
    return env;
  } catch {
    return [];
  }
}

export interface ZoneRibbonWaveformsData {
  lowOriginal: number[];
  highOriginal: number[] | null;
  processed: number[] | null;
  hasProcessed: boolean;
}

export function emptyRibbonWaveforms(): ZoneRibbonWaveformsData {
  return { lowOriginal: [], highOriginal: null, processed: null, hasProcessed: false };
}

export function buildZoneRibbonWaveforms(args: {
  lowOriginal: number[];
  highOriginal: number[] | null;
  resynthMono: Float32Array | null;
  hasModelBinaries: boolean;
}): ZoneRibbonWaveformsData {
  const processed = args.resynthMono
    ? computeNormalizedEnvelope(args.resynthMono, 64)
    : null;
  return {
    lowOriginal: args.lowOriginal,
    highOriginal: args.highOriginal,
    processed,
    hasProcessed: Boolean(processed) || args.hasModelBinaries,
  };
}
