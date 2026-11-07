// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Fase 14: Model Cover Artwork (.webp)
// Exclusive to Extended Mode (`05_extended_model/cover.webp`).
// Converts any uploaded/dropped/pasted image (PNG, JPG, WEBP, AVIF, SVG)
// into a square center-cropped `.webp` binary + Data URL.
// Includes headless RIFF WEBP helpers so Node.js unit tests can verify
// conversion, validation, and Time Capsule packaging without DOM.
// ─────────────────────────────────────────────────────────

import type { ModelCoverArtwork } from './types.ts';
import { clampInt } from './dsp/DspMath.ts';

export const DEFAULT_COVER_SIZE_PX = 512;
export const DEFAULT_COVER_WEBP_QUALITY = 0.88;

/**
 * S6.7n (red-team, ola 20): tope de dimensiones DECLARADAS para bytes de
 * portada importados — un VP8X de 30 bytes puede declarar 16383×16383
 * (≈1 GB de bitmap al mostrarlo en el renderer). El generador propio nunca
 * supera 2048 px (`clampCoverSize`); se impone lo mismo a lo importado.
 * Cabecera ilegible o fuera de tope = inseguro (fail-closed).
 */
export const MAX_IMPORTED_COVER_DIMENSION_PX = 2048;
/** Incluso con reescalado al decodificar, nadie necesita más que esto. */
export const MAX_DECODE_COVER_DIMENSION_PX = 8192;

/** Lee dimensiones declaradas sin decodificar (barato). `null` = formato sin lector barato o cabecera ilegible. */
export function coverBytesDeclaredDimensions(
  bytes: Uint8Array
): { width: number; height: number } | null {
  // WebP: 'RIFF' + tamaño + 'WEBP' + FourCC.
  if (isWebpBytes(bytes)) {
    if (bytes.byteLength < 30) return null;
    const fourcc = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (fourcc === 'VP8X' && bytes.byteLength >= 30) {
      const w = (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) + 1;
      const h = (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) + 1;
      return { width: w, height: h };
    }
    if (fourcc === 'VP8L' && bytes.byteLength >= 25 && bytes[20] === 0x2f) {
      const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (fourcc === 'VP8 ' && bytes.byteLength >= 30 && bytes[20] === 0x9d && bytes[21] === 0x01 && bytes[22] === 0x2a) {
      const w = bytes[26] | ((bytes[27] & 0x3f) << 8);
      const h = bytes[28] | ((bytes[29] & 0x3f) << 8);
      return { width: w, height: h };
    }
    return null;
  }
  // PNG: firma de 8 + longitud IHDR + 'IHDR' + w32be + h32be.
  if (
    bytes.byteLength >= 24 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52
  ) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: v.getUint32(16, false), height: v.getUint32(20, false) };
  }
  // JPEG: barrido de marcadores SOFn acotado a los primeros 64 KB (el SOF
  // vive al principio; si no aparece, se deja al decode: la basura falla y
  // cae al placeholder, así que no hay falso positivo).
  if (bytes.byteLength >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const limit = Math.min(bytes.byteLength - 9, 65536);
    let p = 2;
    while (p < limit) {
      if (v.getUint8(p) !== 0xff) { p++; continue; }
      const code = v.getUint8(p + 1);
      if (code === 0xda || code === 0xd9) break; // SOS / EOI: sin SOF a la vista
      if (code === 0x01 || (code >= 0xd0 && code <= 0xd7)) { p += 2; continue; }
      const segLen = v.getUint16(p + 2, false);
      if (segLen < 2) break;
      const isSof =
        (code >= 0xc0 && code <= 0xcf && code !== 0xc4 && code !== 0xc8 && code !== 0xcc);
      if (isSof && p + 9 <= bytes.byteLength) {
        return { height: v.getUint16(p + 5, false), width: v.getUint16(p + 7, false) };
      }
      p += 2 + segLen;
    }
    return null;
  }
  // SVG: atributos width/height de la etiqueta raíz (solo px/adimensional;
  // `%` es relativo y no asigna bitmap gigante por sí solo).
  if (bytes.byteLength >= 5) {
    const head = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.byteLength, 2048)));
    if (/<svg[\s>]/i.test(head)) {
      const num = (attr: string): number | null => {
        const m = new RegExp(`${attr}\\s*=\\s*["']([\\d.]+)(px)?["']`, 'i').exec(head);
        return m ? Number(m[1]) : null;
      };
      const w = num('width');
      const h = num('height');
      if (w !== null && h !== null) return { width: w, height: h };
    }
  }
  return null;
}

/** `true` si las dimensiones declaradas caben en el tope de importación. */
export function isCoverBytesWithinImportCaps(bytes: Uint8Array): boolean {
  const dims = coverBytesDeclaredDimensions(bytes);
  if (!dims) return false;
  return (
    Number.isFinite(dims.width) &&
    Number.isFinite(dims.height) &&
    dims.width > 0 &&
    dims.height > 0 &&
    dims.width <= MAX_IMPORTED_COVER_DIMENSION_PX &&
    dims.height <= MAX_IMPORTED_COVER_DIMENSION_PX
  );
}

/**
 * Checks whether a byte buffer has a valid RIFF....WEBP header.
 */
export function isWebpBytes(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12) return false;
  return (
    bytes[0] === 0x52 && // 'R'
    bytes[1] === 0x49 && // 'I'
    bytes[2] === 0x46 && // 'F'
    bytes[3] === 0x46 && // 'F'
    bytes[8] === 0x57 && // 'W'
    bytes[9] === 0x45 && // 'E'
    bytes[10] === 0x42 && // 'B'
    bytes[11] === 0x50 // 'P'
  );
}

/**
 * Encodes a `Uint8Array` into a `data:image/webp;base64,...` Data URL.
 */
export function webpBytesToDataUrl(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...sub);
  }
  return `data:image/webp;base64,${btoa(binary)}`;
}

/**
 * Decodes a `data:image/webp;base64,...` (or generic base64 Data URL) into a `Uint8Array`.
 */
export function dataUrlToWebpBytes(dataUrl: string): Uint8Array {
  const commaIdx = dataUrl.indexOf(',');
  const b64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1).trim() : dataUrl.trim();
  const binStr = atob(b64);
  const out = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) {
    out[i] = binStr.charCodeAt(i);
  }
  return out;
}

/**
 * Synthesizes a valid minimal lossless RIFF WEBP (`VP8L` + optional `EXIF`/`ICCP` metadata)
 * container in headless environments where `HTMLCanvasElement` / `OffscreenCanvas` is unavailable,
 * or wraps raw image bytes into a valid RIFF WEBP container for deterministic testing.
 */
export function createHeadlessWebpBytes(
  width: number = DEFAULT_COVER_SIZE_PX,
  height: number = DEFAULT_COVER_SIZE_PX,
  seedBytes?: Uint8Array
): Uint8Array {
  const w = Math.max(1, Math.min(16384, Math.round(width)));
  const h = Math.max(1, Math.min(16384, Math.round(height)));
  // VP8X extended header (10 bytes payload) + VP8L minimal bitstream
  // VP8X allows storing exact canvas width & height (24-bit little-endian w-1, h-1)
  const vp8xPayload = new Uint8Array(10);
  vp8xPayload[0] = 0x00; // flags
  const wMinus1 = w - 1;
  const hMinus1 = h - 1;
  vp8xPayload[4] = wMinus1 & 0xff;
  vp8xPayload[5] = (wMinus1 >> 8) & 0xff;
  vp8xPayload[6] = (wMinus1 >> 16) & 0xff;
  vp8xPayload[7] = hMinus1 & 0xff;
  vp8xPayload[8] = (hMinus1 >> 8) & 0xff;
  vp8xPayload[9] = (hMinus1 >> 16) & 0xff;

  // Minimal valid 1x1 lossless VP8L bitstream + deterministic seed digest
  const baseVp8l = new Uint8Array([
    0x2f, 0x00, 0x00, 0x00, 0x00, 0x07, 0x10, 0x11, 0x11, 0x88, 0x88, 0xfe, 0x07, 0x00,
  ]);
  const extraLen = seedBytes ? Math.min(32, seedBytes.byteLength) : 0;
  const vp8lPayload = new Uint8Array(baseVp8l.byteLength + extraLen);
  vp8lPayload.set(baseVp8l, 0);
  if (seedBytes && extraLen > 0) {
    vp8lPayload.set(seedBytes.subarray(0, extraLen), baseVp8l.byteLength);
  }
  const paddedVp8lLen = vp8lPayload.byteLength + (vp8lPayload.byteLength % 2);

  // Total RIFF size: 4 ('WEBP') + 8+10 ('VP8X') + 8+paddedVp8lLen ('VP8L')
  const riffPayloadSize = 4 + 18 + 8 + paddedVp8lLen;
  const out = new Uint8Array(8 + riffPayloadSize);
  const view = new DataView(out.buffer);

  // 'RIFF'
  out[0] = 0x52;
  out[1] = 0x49;
  out[2] = 0x46;
  out[3] = 0x46;
  view.setUint32(4, riffPayloadSize, true);
  // 'WEBP'
  out[8] = 0x57;
  out[9] = 0x45;
  out[10] = 0x42;
  out[11] = 0x50;

  // 'VP8X' chunk
  out[12] = 0x56;
  out[13] = 0x50;
  out[14] = 0x38;
  out[15] = 0x58;
  view.setUint32(16, 10, true);
  out.set(vp8xPayload, 20);

  // 'VP8L' chunk
  out[30] = 0x56;
  out[31] = 0x50;
  out[32] = 0x38;
  out[33] = 0x4c;
  view.setUint32(34, vp8lPayload.byteLength, true);
  out.set(vp8lPayload, 38);

  return out;
}

/**
 * Reads dimensions from a RIFF WEBP (`VP8X`, `VP8 `, or `VP8L`) buffer if present,
 * falling back to `DEFAULT_COVER_SIZE_PX`.
 */
export function parseWebpDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (!isWebpBytes(bytes) || bytes.byteLength < 30) {
    return { width: DEFAULT_COVER_SIZE_PX, height: DEFAULT_COVER_SIZE_PX };
  }
  // Check chunk FourCC at offset 12
  const c0 = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (c0 === 'VP8X' && bytes.byteLength >= 30) {
    const w = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const h = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    return { width: w, height: h };
  }
  if (c0 === 'VP8L' && bytes.byteLength >= 25 && bytes[20] === 0x2f) {
    const b1 = bytes[21];
    const b2 = bytes[22];
    const b3 = bytes[23];
    const b4 = bytes[24];
    const w = 1 + (b1 | ((b2 & 0x3f) << 8));
    const h = 1 + (((b2 >> 6) & 0x03) | (b3 << 2) | ((b4 & 0x0f) << 10));
    return { width: w, height: h };
  }
  return { width: DEFAULT_COVER_SIZE_PX, height: DEFAULT_COVER_SIZE_PX };
}

export interface ConvertCoverOptions {
  targetSize?: number;
  quality?: number;
  originalName?: string;
}

export interface ConvertedCoverResult {
  webpBytes: Uint8Array;
  artwork: ModelCoverArtwork;
}

/**
 * Converts an image (`File`, `Blob`, `ArrayBuffer`, `Uint8Array`, or base64 Data URL string) into an optimized
 * square center-cropped `.webp` binary and `ModelCoverArtwork` metadata object.
 */
export async function convertImageToCoverWebp(
  input: File | Blob | ArrayBuffer | Uint8Array | string,
  options?: ConvertCoverOptions
): Promise<ConvertedCoverResult> {
  const targetSize = clampCoverSize(options?.targetSize ?? DEFAULT_COVER_SIZE_PX);
  const quality = Math.max(0.5, Math.min(1.0, options?.quality ?? DEFAULT_COVER_WEBP_QUALITY));
  const originalName =
    options?.originalName ??
    (typeof File !== 'undefined' && input instanceof File ? input.name : 'cover.webp');

  let rawBytes: Uint8Array;
  if (typeof input === 'string') {
    rawBytes = dataUrlToWebpBytes(input);
  } else if (input instanceof Uint8Array) {
    rawBytes = input;
  } else if (input instanceof ArrayBuffer) {
    rawBytes = new Uint8Array(input);
  } else {
    const ab = await input.arrayBuffer();
    rawBytes = new Uint8Array(ab);
  }

  // S6.7n: compuerta PRE-decodificación por dimensiones declaradas — un
  // VP8X de 30 bytes (o un PNG sólido de ~100 KB) puede declarar gigapíxeles
  // y el `createImageBitmap` de abajo asignaría el bitmap entero ANTES de que
  // el canvas lo normalice a `targetSize`. Lo conocido y desorbitado muere
  // aquí; lo conocido y grande se decodifica ya reescalado (sin regresión
  // para fotos legítimas); lo desconocido sigue el camino de antes (la
  // basura falla el decode y cae al placeholder).
  const declaredDims = coverBytesDeclaredDimensions(rawBytes);
  if (declaredDims) {
    if (
      declaredDims.width > MAX_DECODE_COVER_DIMENSION_PX ||
      declaredDims.height > MAX_DECODE_COVER_DIMENSION_PX
    ) {
      throw new Error(
        `Cover image dimensions out of bounds (${declaredDims.width}x${declaredDims.height}, max ${MAX_DECODE_COVER_DIMENSION_PX})`
      );
    }
  }
  const decodeResize =
    declaredDims && (declaredDims.width > targetSize || declaredDims.height > targetSize)
      ? { resizeWidth: targetSize, resizeHeight: targetSize }
      : undefined;

  // Browser environment with DOM Canvas + createImageBitmap or Image
  if (typeof document !== 'undefined' && typeof HTMLCanvasElement !== 'undefined') {
    try {
      const mime =
        typeof File !== 'undefined' && input instanceof File && input.type
          ? input.type
          : guessImageMimeFromBytes(rawBytes, originalName);
      const blob =
        typeof Blob !== 'undefined' && input instanceof Blob && input.type
          ? input
          : new Blob([new Uint8Array(rawBytes).buffer as ArrayBuffer], { type: mime });
      const bitmapOrImg = await loadBrowserImageSource(blob, decodeResize);
      const srcW = bitmapOrImg.width || targetSize;
      const srcH = bitmapOrImg.height || targetSize;

      const canvas = document.createElement('canvas');
      canvas.width = targetSize;
      canvas.height = targetSize;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Center-crop (`object-fit: cover`)
        const side = Math.min(srcW, srcH);
        const sx = Math.max(0, (srcW - side) * 0.5);
        const sy = Math.max(0, (srcH - side) * 0.5);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmapOrImg.source, sx, sy, side, side, 0, 0, targetSize, targetSize);
        if (bitmapOrImg.cleanup) bitmapOrImg.cleanup();

        const dataUrl = canvas.toDataURL('image/webp', quality);
        const rawEncodedBytes = dataUrlToWebpBytes(dataUrl);
        const webpBytes = isWebpBytes(rawEncodedBytes)
          ? rawEncodedBytes
          : createHeadlessWebpBytes(targetSize, targetSize, rawEncodedBytes);
        return {
          webpBytes,
          artwork: {
            webpDataUrl: dataUrl,
            width: targetSize,
            height: targetSize,
            byteLength: webpBytes.byteLength,
            originalName,
            updatedAt: new Date().toISOString(),
          },
        };
      }
    } catch {
      // Fall through to binary/headless path if browser image decoding fails on synthetic test buffers
    }
  }

  // If input is already a valid RIFF WEBP, keep or normalize it — pero con
  // tope de importación (S6.7n): el verbatim adoptaba gigapíxeles declarados.
  if (isWebpBytes(rawBytes)) {
    if (!isCoverBytesWithinImportCaps(rawBytes)) {
      const d = coverBytesDeclaredDimensions(rawBytes);
      throw new Error(
        `Cover image dimensions out of bounds (${d ? `${d.width}x${d.height}` : 'unreadable'}, max ${MAX_IMPORTED_COVER_DIMENSION_PX})`
      );
    }
    const dims = parseWebpDimensions(rawBytes);
    const dataUrl = webpBytesToDataUrl(rawBytes);
    return {
      webpBytes: new Uint8Array(rawBytes),
      artwork: {
        webpDataUrl: dataUrl,
        width: dims.width,
        height: dims.height,
        byteLength: rawBytes.byteLength,
        originalName,
        updatedAt: new Date().toISOString(),
      },
    };
  }

  // Headless / Node.js fallback: generate a valid RIFF WEBP (`VP8X` + `VP8L`) with targetSize
  const webpBytes = createHeadlessWebpBytes(targetSize, targetSize, rawBytes);
  const dataUrl = webpBytesToDataUrl(webpBytes);
  return {
    webpBytes,
    artwork: {
      webpDataUrl: dataUrl,
      width: targetSize,
      height: targetSize,
      byteLength: webpBytes.byteLength,
      originalName,
      updatedAt: new Date().toISOString(),
    },
  };
}

function clampCoverSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_COVER_SIZE_PX;
  return clampInt(size, 64, 2048);
}

function guessImageMimeFromBytes(bytes: Uint8Array, name?: string): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (isWebpBytes(bytes)) {
    return 'image/webp';
  }
  const lower = (name || '').toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.avif')) return 'image/avif';
  return 'image/webp';
}

async function loadBrowserImageSource(
  blob: Blob,
  resize?: { resizeWidth: number; resizeHeight: number }
): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  cleanup?: () => void;
}> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(blob, resize ?? {});
      return {
        source: bmp,
        width: bmp.width,
        height: bmp.height,
        cleanup: () => bmp.close(),
      };
    } catch {
      // Fallback to HTMLImageElement below
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      resolve({
        source: img,
        width: img.naturalWidth || DEFAULT_COVER_SIZE_PX,
        height: img.naturalHeight || DEFAULT_COVER_SIZE_PX,
        cleanup: () => URL.revokeObjectURL(url),
      });
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}
