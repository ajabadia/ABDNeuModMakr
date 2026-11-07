// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — ReCycle (.rx2, .rex, .rcy), WAV Cue/atem, AIFF Mark & SFZ Slice Parser
// Re-exported from @abdsynths/shared/formats/sampler as single source of truth.
//
// SECURITY (red-team ola 15): el vendor itera `Num slices` (WAV `atem` JSON,
// número sin tope) y `count` (SLIC/slce/MARK en FORM/CAT, u32 sin tope) sin
// acotar por los bytes reales del chunk: un fichero de ~60 B cuelga el hilo
// principal (>120 s `atem` con 2B; ~27 s SLIC con 4G). `parseSliceFileCapped`
// pre-valida esos contadores (tope 4096 + capacidad en bytes del chunk) y
// limita el fallback de texto a 8 MB antes de delegar al vendor.
//
// SECURITY (red-team ola 16): tres frentes más en la misma compuerta —
//  1. El tope de 8 MB no acota el nº de líneas: `0\n`×4M (8 MB) genera 4 M
//     markers (~600 MB heap, ~3 s). Ahora tope de 32768 líneas.
//  2. El fallback a texto del vendor decodifica el buffer binario ENTERO:
//     un RIFF grande sin slices (un byte TAB en el audio basta como trigger)
//     provoca decode+split de cientos de MB. Ahora los buffers >8 MB solo
//     usan los parseos binarios; sin slices binarios → null.
//  3. Chunks truncados (`cue ` sin datos) lanzaban RangeError sin capturar
//     (el contrato es `| null`). Ahora cada sub-parseo binario va envuelto.
// ─────────────────────────────────────────────────────────

export * from '@abdsynths/shared/formats/sampler/SliceFileParser.ts';

import {
  parseWavSliceCues,
  parseAiffSliceMarkers,
  parseReCycleSliceFile,
  parseSfzSliceFile,
  parseLabelTrackText,
  type ParsedSliceFileResult,
} from '@abdsynths/shared/formats/sampler/SliceFileParser.ts';
import { fileExtension } from '@abdsynths/shared/formats/sampler/SamplerUtils.ts';

/** Tope absoluto de slices/marcadores por fichero (el camino RIFF ya usa 4096). */
export const MAX_SLICE_FILE_SLICES = 4096;
/** La etiqueta `atem` legítima de MPC es un JSON de pocos KB. */
const MAX_ATEM_CHUNK_BYTES = 262144; // 256 KB
/** El fallback texto (labels/cue/sfz) no necesita más de 8 MB. */
const MAX_SLICE_TEXT_BYTES = 8 * 1024 * 1024; // 8 MB
/**
 * Cada línea corta genera un marker (~150 B heap entre objeto+label): sin
 * tope de líneas, 8 MB → 4 M markers (~600 MB). 32768 deja 8× de margen
 * sobre el tope de slices para comentarios, blancos y cabeceras CUE.
 */
const MAX_SLICE_TEXT_LINES = 32768;
const MAX_CHUNK_WALK_DEPTH = 16;

function readFourCC(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

function assertValidSliceCount(count: number, maxByBytes: number, where: string): void {
  if (
    !Number.isFinite(count) ||
    Math.floor(count) !== count ||
    count < 0 ||
    count > MAX_SLICE_FILE_SLICES ||
    count > maxByBytes
  ) {
    throw new Error(`Invalid slice file: bad slice count in ${where}`);
  }
}

/** Pre-valida el chunk `atem` (JSON MPC) de un RIFF/WAV. */
function assertRiffSliceChunksSafe(view: DataView): void {
  let offset = 12;
  const len = view.byteLength;
  while (offset + 8 <= len) {
    const chunkId = readFourCC(view, offset);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkDataStart = offset + 8;
    if (chunkId === 'atem' && chunkSize >= 16) {
      if (chunkSize > MAX_ATEM_CHUNK_BYTES) {
        throw new Error('Invalid slice file: oversized atem chunk');
      }
      const endPos = Math.min(len, chunkDataStart + chunkSize);
      const jsonStr = new TextDecoder('utf-8')
        .decode(new Uint8Array(view.buffer, view.byteOffset + chunkDataStart, endPos - chunkDataStart))
        .replace(/\0+$/, '');
      let numSlices = 0;
      try {
        const parsed = JSON.parse(jsonStr) as { value0?: Record<string, unknown> };
        const v0 = parsed?.value0;
        if (v0 && typeof v0 === 'object') {
          numSlices =
            typeof v0['Num slices'] === 'number' ? (v0['Num slices'] as number) : 0;
        }
      } catch {
        numSlices = 0;
      }
      if (numSlices !== 0) {
        const maxByBytes = Math.floor((endPos - chunkDataStart) / 8);
        assertValidSliceCount(numSlices, maxByBytes, 'atem');
      }
    }
    if (chunkSize > len) break;
    offset += 8 + chunkSize + (chunkSize % 2 === 1 ? 1 : 0);
  }
}

/** Pre-valida los contadores SLIC/slce/MARK de un FORM/CAT (recursivo, profundidad acotada). */
function assertRexSliceChunksSafe(view: DataView): void {
  const len = view.byteLength;
  const walk = (startOffset: number, endLimit: number, depth: number): void => {
    if (depth > MAX_CHUNK_WALK_DEPTH) return;
    let offset = startOffset;
    while (offset + 8 <= endLimit) {
      const chunkId = readFourCC(view, offset);
      const chunkSize = view.getUint32(offset + 4, false);
      const chunkStart = offset + 8;
      const chunkEnd = Math.min(chunkStart + chunkSize, endLimit);
      if (chunkId === 'CAT ' || chunkId === 'FORM' || chunkId === 'LIST') {
        walk(chunkStart + 4, chunkEnd, depth + 1);
      } else if (
        (chunkId === 'SLIC' || chunkId === 'slce' || chunkId === 'MARK') &&
        chunkSize >= 4
      ) {
        const count = view.getUint32(chunkStart, false);
        if (count !== 0) {
          const maxByBytes = Math.max(0, Math.floor((chunkEnd - chunkStart - 4) / 4));
          assertValidSliceCount(count, maxByBytes, `${chunkId} (REX)`);
        }
      }
      if (chunkSize > len) break;
      offset += 8 + chunkSize + (chunkSize % 2 === 1 ? 1 : 0);
    }
  };
  walk(12, len, 0);
}

/** Cuenta líneas sin alocar (split de 8 MB cuesta ~100 ms + el string duplicado). */
function countLines(text: string): number {
  let n = 1;
  let idx = -1;
  while ((idx = text.indexOf('\n', idx + 1)) !== -1) n++;
  return n;
}

/** Los sub-parseos binarios lanzan RangeError con chunks truncados; el contrato es `| null`. */
function safeBinaryParse(
  fn: (buffer: ArrayBuffer, filename: string) => ParsedSliceFileResult | null,
  buffer: ArrayBuffer,
  filename: string,
): ParsedSliceFileResult | null {
  try {
    return fn(buffer, filename);
  } catch {
    return null;
  }
}

/**
 * `parseSliceFile` con compuertas anti-CPU/mem-DoS (olas 15–16). Mismo orden
 * y resultado que el vendor para ficheros legítimos; rechaza contadores
 * mentirosos, textos con exceso de líneas y truncados antes de delegar.
 */
export function parseSliceFileCapped(
  content: ArrayBuffer | string,
  filename: string,
  sampleRate = 44100,
): ParsedSliceFileResult | null {
  if (typeof content === 'string') {
    if (content.length > MAX_SLICE_TEXT_BYTES) {
      throw new Error('Invalid slice file: text too large');
    }
    if (countLines(content) > MAX_SLICE_TEXT_LINES) {
      throw new Error('Invalid slice file: too many lines');
    }
    if (fileExtension(filename) === 'sfz') {
      return parseSfzSliceFile(content, filename, sampleRate);
    }
    return (
      parseLabelTrackText(content, filename, sampleRate) ??
      parseSfzSliceFile(content, filename, sampleRate)
    );
  }
  const view = new DataView(content);
  if (view.byteLength >= 12) {
    const head = readFourCC(view, 0);
    if (head === 'RIFF') {
      assertRiffSliceChunksSafe(view);
      return (
        safeBinaryParse(parseWavSliceCues, content, filename) ??
        safeBinaryParse(parseReCycleSliceFile, content, filename) ??
        parseBoundedFallbackText(content, filename, sampleRate)
      );
    }
    if (head === 'FORM' || head === 'CAT ') {
      assertRexSliceChunksSafe(view);
      return (
        safeBinaryParse(parseAiffSliceMarkers, content, filename) ??
        safeBinaryParse(parseReCycleSliceFile, content, filename) ??
        parseBoundedFallbackText(content, filename, sampleRate)
      );
    }
  }
  return parseBoundedFallbackText(content, filename, sampleRate);
}

/**
 * Fallback a texto del vendor, acotado (ola 16): sin este tope decodificaría
 * el buffer entero y cada línea corta generaría un marker.
 */
function parseBoundedFallbackText(
  content: ArrayBuffer,
  filename: string,
  sampleRate: number,
): ParsedSliceFileResult | null {
  if (content.byteLength > MAX_SLICE_TEXT_BYTES) return null;
  let text: string;
  try {
    text = new TextDecoder('utf-8').decode(content);
  } catch {
    return null;
  }
  if (countLines(text) > MAX_SLICE_TEXT_LINES) return null;
  if (!text.includes('<region>') && !text.includes('INDEX') && !text.includes('\t')) {
    return null;
  }
  if (fileExtension(filename) === 'sfz') {
    return parseSfzSliceFile(text, filename, sampleRate);
  }
  return (
    parseLabelTrackText(text, filename, sampleRate) ??
    parseSfzSliceFile(text, filename, sampleRate)
  );
}
