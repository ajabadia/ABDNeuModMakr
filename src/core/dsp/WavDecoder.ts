// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Pure TypeScript RIFF/WAVE & FORM/AIFF Decoder
// Re-exported from @abdsynths/shared/formats/neuron as single source of truth.
// ─────────────────────────────────────────────────────────

export * from '@abdsynths/shared/formats/neuron/WavAiffDecoder.ts';
export * from '@abdsynths/shared/formats/neuron/UniversalAudioDecoder.ts';

import {
  decodeWav as vendorDecodeWav,
  decodeAiff as vendorDecodeAiff,
  type DecodedWav,
} from '@abdsynths/shared/formats/neuron/WavAiffDecoder.ts';
import {
  decodeCaf as vendorDecodeCaf,
  decodeFlac as vendorDecodeFlac,
  transcodeAnyAudioToWavBuffer as vendorTranscode,
} from '@abdsynths/shared/formats/neuron/UniversalAudioDecoder.ts';

// ── S6.4: topes anti-DoS de decodificación de audio (proyecto) ──
// WAV/AIFF/FLAC puros están acotados por los bytes reales del fichero, pero
// CAF/`caff` multiplica `floor(dataBytes/stride) × framesPerPacket` con un
// u32 del fichero (0xFFFFFFFF ⇒ `new Float32Array` de GB) y no topa
// `numChannels` (u32 ⇒ bucle de millones de `push`). Estas compuertas
// inspeccionan SOLO la cabecera `desc` antes de delegar al vendor.
// ─────────────────────────────────────────────────────────
export const APP_MAX_AUDIO_CHANNELS = 32;
export const APP_MAX_DECODED_FRAMES = 128 * 1024 * 1024;
export const APP_MAX_DECODED_SAMPLES_TOTAL = 512 * 1024 * 1024;
export const APP_MAX_CAF_FRAMES_PER_PACKET = 1024; // legítimo: lpcm=1, ima4=64
export const APP_MAX_TRANSCODED_BYTES = 300 * 1024 * 1024;

function readFourCC(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3)
  );
}

/**
 * Verifica la cabecera `desc` de un `.caf` sin decodificar nada.
 * Lanza si el contenedor miente (canales absurdos, multiplicador de
 * paquetes absurdo o predicción de frames fuera de toda escala).
 */
export function assertCafDescSafe(buffer: ArrayBuffer): void {
  const view = new DataView(buffer);
  if (buffer.byteLength < 32 || readFourCC(view, 0) !== 'caff') return;
  if (view.getUint16(4, false) !== 1) return; // el vendor ya rechaza otra versión
  let offset = 8;
  let numChannels = 1;
  let framesPerPacket = 1;
  let bytesPerPacket = 0;
  let bitsPerChannel = 16;
  let dataBytes = 0;
  let foundDesc = false;
  while (offset + 12 <= buffer.byteLength) {
    const chunkType = readFourCC(view, offset);
    const hi = view.getInt32(offset + 4, false);
    const lo = view.getUint32(offset + 8, false);
    const chunkSize = hi * 4294967296 + lo;
    const chunkDataStart = offset + 12;
    if (chunkType === 'desc' && chunkSize >= 32 && chunkDataStart + 32 <= buffer.byteLength) {
      foundDesc = true;
      bytesPerPacket = view.getUint32(chunkDataStart + 16, false);
      framesPerPacket = view.getUint32(chunkDataStart + 20, false);
      numChannels = view.getUint32(chunkDataStart + 24, false);
      bitsPerChannel = view.getUint32(chunkDataStart + 28, false);
    } else if (chunkType === 'data') {
      dataBytes =
        chunkSize < 0
          ? Math.max(0, buffer.byteLength - (chunkDataStart + 4))
          : Math.max(0, Math.min(chunkSize - 4, buffer.byteLength - (chunkDataStart + 4)));
    }
    if (chunkSize < 0 || !Number.isFinite(chunkSize)) break;
    if (chunkSize > buffer.byteLength) break; // tamaño mentiroso: no se puede predecir, el vendor lo acota por bytes reales
    offset = chunkDataStart + chunkSize;
  }
  if (!foundDesc) return; // sin `desc` el vendor lanza; nada que acotar aquí
  if (numChannels < 1 || numChannels > APP_MAX_AUDIO_CHANNELS) {
    throw new Error(`CAF: channel count out of bounds (${numChannels})`);
  }
  if (framesPerPacket < 1 || framesPerPacket > APP_MAX_CAF_FRAMES_PER_PACKET) {
    throw new Error(`CAF: frames-per-packet out of bounds (${framesPerPacket})`);
  }
  const stride = bytesPerPacket > 0 ? bytesPerPacket : numChannels * Math.max(1, bitsPerChannel >>> 3);
  const predicted = Math.floor(dataBytes / Math.max(1, stride)) * framesPerPacket;
  if (predicted > APP_MAX_DECODED_FRAMES) {
    throw new Error(`CAF: declared frames out of bounds (${predicted})`);
  }
}

/** Cinturón tras la decodificación: el resultado nunca puede exceder la escala de un fichero de 50 MB. */
export function assertDecodedSizeSafe(dec: DecodedWav): void {
  const frames = dec.mono.length;
  if (frames > APP_MAX_DECODED_FRAMES || frames * dec.numChannels > APP_MAX_DECODED_SAMPLES_TOTAL) {
    throw new Error(`Audio decoded size out of bounds (${frames} frames × ${dec.numChannels} ch)`);
  }
}

function guardContainer(buffer: ArrayBuffer): void {
  if (buffer.byteLength >= 4) {
    const view = new DataView(buffer);
    if (readFourCC(view, 0) === 'caff') assertCafDescSafe(buffer);
  }
}

/** `decodeWav` con compuerta S6.4 (CAF mentiroso) + tope de salida. */
export function decodeWav(buffer: ArrayBuffer): DecodedWav {
  guardContainer(buffer);
  const dec = vendorDecodeWav(buffer);
  assertDecodedSizeSafe(dec);
  return dec;
}

/** `decodeAiff` con tope de salida. */
export function decodeAiff(buffer: ArrayBuffer): DecodedWav {
  const dec = vendorDecodeAiff(buffer);
  assertDecodedSizeSafe(dec);
  return dec;
}

/** `decodeCaf` con compuerta S6.4 por cabecera + tope de salida. */
export function decodeCaf(buffer: ArrayBuffer): DecodedWav {
  assertCafDescSafe(buffer);
  const dec = vendorDecodeCaf(buffer);
  assertDecodedSizeSafe(dec);
  return dec;
}

/** `decodeFlac` con tope de salida. */
export function decodeFlac(buffer: ArrayBuffer): DecodedWav {
  const dec = vendorDecodeFlac(buffer);
  assertDecodedSizeSafe(dec);
  return dec;
}

/** Transcodificación de intake con compuerta S6.4 previa y tope de salida. */
export async function transcodeAnyAudioToWavBuffer(buffer: ArrayBuffer, filename = ''): Promise<ArrayBuffer> {
  guardContainer(buffer);
  const out = await vendorTranscode(buffer, filename);
  if (out.byteLength > APP_MAX_TRANSCODED_BYTES) {
    throw new Error(`Transcoded audio out of bounds (${out.byteLength} bytes)`);
  }
  return out;
}
