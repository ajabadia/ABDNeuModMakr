// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Fase 42.5: Bridge Audio
// operaciones de audio/DSP (scan, enhance, RX2, stems, fonemas, memoria)
// Funciones puras de dominio: reciben el núcleo ('BridgeCore') y no
// dependen del estado interno de 'BridgeClient'.
// ─────────────────────────────────────────────────────────

import { type BridgeCore, type BridgeScanResult, type StemSeparationResult, type PhonemeWord, type PhonemeAlignmentResult, type BridgeMemoryStatus, type BridgeEnhanceOptions } from './bridgeTypes.ts';

/**
 * Queries the companion bridge to scan a local filesystem path for models, soundfonts, and samples.
 */
export async function scanLocalFiles(core: BridgeCore, targetPath: string, timeoutMs = 8000): Promise<BridgeScanResult> {
  if (!core.isConnected()) {
    throw new Error('Local companion bridge is offline.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `${core.getUrl()}/api/fs/scan?path=${encodeURIComponent(targetPath)}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: core.authHeaders({ Accept: 'application/json' }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      throw new Error(`Filesystem scan failed (HTTP ${res.status})`);
    }
    return (await res.json()) as BridgeScanResult;
  } finally {
    clearTimeout(timer);
  }
}


/**
 * Sends audio bytes to the bridge for high-fidelity 24/96k sinc resampling,
 * BWE harmonic expansion, and organic loop outpainting.
 */
export async function enhanceAudio(core: BridgeCore, 
  audioData: Uint8Array | ArrayBuffer,
  options: BridgeEnhanceOptions = {}
): Promise<Uint8Array> {
  if (!core.isConnected()) {
    throw new Error('Local companion bridge is offline.');
  }

  const targetSr = options.targetSampleRate ?? 96000;
  const targetLoopSec = options.targetLoopSec ?? 0.0;
  const caps = options.capabilities ?? ['resample-96k', 'harmonic-bwe', 'loop-expansion'];
  const timeoutMs = options.timeoutMs ?? 30000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const endpoint = `${core.getUrl()}/api/enhance`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: core.authHeaders({
        'Content-Type': 'audio/wav',
        'X-Target-Sample-Rate': String(targetSr),
        'X-Target-Loop-Sec': String(targetLoopSec),
        'X-Capabilities': caps.join(','),
        ...(options.textPrompt ? { 'X-Text-Prompt': options.textPrompt } : {}),
        ...(options.noiseProfile ? { 'X-Noise-Profile': JSON.stringify(options.noiseProfile) } : {}),
      }),
      body: audioData instanceof Uint8Array ? (audioData.buffer as ArrayBuffer) : audioData,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Audio enhancement failed (HTTP ${res.status}): ${errText}`);
    }

    const buffer = await res.arrayBuffer();
    return new Uint8Array(buffer);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Decompresses a Reason Studios / Propellerhead ReCycle 2 (.rx2) audio stream
 * via the Companion Bridge's native DWOP decompressor and returns a pure PCM WAV ArrayBuffer.
 */
export async function decodeRx2Audio(core: BridgeCore, 
  rx2Buffer: ArrayBuffer,
  filename = 'loop.rx2',
  timeoutMs = 15000
): Promise<{ wavBuffer: ArrayBuffer; info: any; decodedFrames: number }> {
  if (!core.isConnected()) {
    throw new Error('Local companion bridge is offline (port 7860). Start bridge/server.py or use the pure-TS DWOP fallback.');
  }
  // 1. Convert buffer to Base64
  const uint8 = new Uint8Array(rx2Buffer);
  let binary = '';
  const len = uint8.byteLength;
  for (let i = 0; i < len; i += 8192) {
    const chunk = uint8.subarray(i, Math.min(i + 8192, len));
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  const b64 = btoa(binary);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${core.getUrl()}/api/decode-rx2`, {
      method: 'POST',
      headers: core.authHeaders({
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
      body: JSON.stringify({
        rx2_base64: b64,
        filename,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const errData = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(errData.error || `HTTP ${res.status} from /api/decode-rx2`);
    }
    const data = await res.json();
    // Decode wav_base64 back to ArrayBuffer
    const wavBinary = atob(data.wav_base64);
    const wavUint8 = new Uint8Array(wavBinary.length);
    for (let i = 0; i < wavBinary.length; i++) {
      wavUint8[i] = wavBinary.charCodeAt(i);
    }
    return {
      wavBuffer: wavUint8.buffer as ArrayBuffer,
      info: data.info,
      decodedFrames: data.decoded_frames,
    };
  } finally {
    clearTimeout(timer);
  }
}


/**
 * Separates an audio buffer into distinct musical stems (e.g. vocals vs instrumental, or drums/bass/vocals/other)
 * using the companion bridge (HTDemucs v4 or high-fidelity DSP separation).
 */
export async function separateStems(core: BridgeCore, 
  audioBuffer: ArrayBuffer,
  options?: { stems?: string[]; filename?: string; timeoutMs?: number }
): Promise<StemSeparationResult> {
  if (!core.isConnected()) {
    throw new Error('Local companion bridge is offline.');
  }

  const uint8 = new Uint8Array(audioBuffer);
  let binary = '';
  const len = uint8.byteLength;
  for (let i = 0; i < len; i += 8192) {
    const chunk = uint8.subarray(i, Math.min(i + 8192, len));
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  const b64 = btoa(binary);

  const stems = options?.stems ?? ['vocals', 'instrumental'];
  const timeoutMs = options?.timeoutMs ?? 30000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${core.getUrl()}/api/separate-stems`, {
      method: 'POST',
      headers: core.authHeaders({
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
      body: JSON.stringify({
        audio_base64: b64,
        stems,
        filename: options?.filename ?? 'sample.wav',
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const errData = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(errData.error || `HTTP ${res.status} from /api/separate-stems`);
    }

    const data = (await res.json()) as {
      status: string;
      stems: Record<string, string>;
      sample_rate: number;
      duration_sec: number;
    };

    const resultStems: Record<string, ArrayBuffer> = {};
    for (const [stemName, stemB64] of Object.entries(data.stems || {})) {
      const stemBin = atob(stemB64);
      const stemUint8 = new Uint8Array(stemBin.length);
      for (let i = 0; i < stemBin.length; i++) {
        stemUint8[i] = stemBin.charCodeAt(i);
      }
      resultStems[stemName] = stemUint8.buffer as ArrayBuffer;
    }

    return {
      status: data.status,
      stems: resultStems,
      sampleRate: data.sample_rate || 44100,
      durationSec: data.duration_sec || 0,
      success: data.status === 'ok',
    };
  } finally {
    clearTimeout(timer);
  }
}


/**
 * Aligns vocal speech and phonemes to extract syllable/word boundaries
 * using OpenAI Whisper-tiny or syllabic spectral analysis via the companion bridge.
 */
export async function alignPhonemes(core: BridgeCore, 
  audioBuffer: ArrayBuffer,
  options?: { filename?: string; timeoutMs?: number }
): Promise<PhonemeAlignmentResult> {
  if (!core.isConnected()) {
    throw new Error('Local companion bridge is offline.');
  }

  const uint8 = new Uint8Array(audioBuffer);
  let binary = '';
  const len = uint8.byteLength;
  for (let i = 0; i < len; i += 8192) {
    const chunk = uint8.subarray(i, Math.min(i + 8192, len));
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  const b64 = btoa(binary);

  const timeoutMs = options?.timeoutMs ?? 20000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${core.getUrl()}/api/align-phonemes`, {
      method: 'POST',
      headers: core.authHeaders({
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
      body: JSON.stringify({
        audio_base64: b64,
        filename: options?.filename ?? 'vocal.wav',
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const errData = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(errData.error || `HTTP ${res.status} from /api/align-phonemes`);
    }

    const data = (await res.json()) as {
      status: string;
      words: Array<{
        word: string;
        start_sec: number;
        end_sec: number;
        start_frame: number;
        end_frame: number;
        confidence?: number;
      }>;
      boundaries: number[];
      sample_rate: number;
      total_frames: number;
    };

    const mappedWords: PhonemeWord[] = (data.words || []).map((w) => ({
      word: w.word,
      startSec: w.start_sec,
      endSec: w.end_sec,
      startFrame: w.start_frame,
      endFrame: w.end_frame,
      confidence: w.confidence,
    }));

    return {
      status: data.status,
      words: mappedWords,
      boundaries: data.boundaries || [],
      sampleRate: data.sample_rate || 44100,
      totalFrames: data.total_frames || 0,
      durationSec: (data.total_frames || 0) / (data.sample_rate || 44100),
      success: data.status === 'ok',
    };
  } finally {
    clearTimeout(timer);
  }
}


/**
 * Fase 25: Returns current system memory and GPU VRAM statistics.
 */
export async function getMemoryStatus(core: BridgeCore, timeoutMs = 5000): Promise<BridgeMemoryStatus | null> {
  if (!core.isConnected()) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${core.getUrl()}/api/memory/status`, {
      method: 'GET',
      headers: core.authHeaders({ Accept: 'application/json' }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as BridgeMemoryStatus;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}


/**
 * Fase 25: Forces garbage collection and releases GPU VRAM cache in Companion Bridge.
 */
export async function clearMemoryCache(core: BridgeCore, timeoutMs = 5000): Promise<BridgeMemoryStatus | null> {
  if (!core.isConnected()) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${core.getUrl()}/api/memory/clear_cache`, {
      method: 'POST',
      headers: core.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({}),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as BridgeMemoryStatus;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
