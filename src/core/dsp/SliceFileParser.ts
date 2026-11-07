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
// ─────────────────────────────────────────────────────────

export * from '@abdsynths/shared/formats/sampler/SliceFileParser.ts';

import { parseSliceFile as vendorParseSliceFile } from '@abdsynths/shared/formats/sampler/SliceFileParser.ts';

/** Tope absoluto de slices/marcadores por fichero (el camino RIFF ya usa 4096). */
export const MAX_SLICE_FILE_SLICES = 4096;
/** La etiqueta `atem` legítima de MPC es un JSON de pocos KB. */
const MAX_ATEM_CHUNK_BYTES = 262144; // 256 KB
/** El fallback texto (labels/cue/sfz) no necesita más de 8 MB. */
const MAX_SLICE_TEXT_BYTES = 8 * 1024 * 1024; // 8 MB
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

/**
 * `parseSliceFile` con compuertas anti-CPU-DoS (ola 15). Misma firma y
 * resultado que el vendor; rechaza contadores mentirosos antes de delegar.
 */
export function parseSliceFileCapped(
  content: ArrayBuffer | string,
  filename: string,
  sampleRate = 44100,
): ReturnType<typeof vendorParseSliceFile> {
  if (typeof content === 'string') {
    if (content.length > MAX_SLICE_TEXT_BYTES) {
      throw new Error('Invalid slice file: text too large');
    }
    return vendorParseSliceFile(content, filename, sampleRate);
  }
  const view = new DataView(content);
  if (view.byteLength < 12) return vendorParseSliceFile(content, filename, sampleRate);
  const head = readFourCC(view, 0);
  if (head === 'RIFF') {
    assertRiffSliceChunksSafe(view);
  } else if (head === 'FORM' || head === 'CAT ') {
    assertRexSliceChunksSafe(view);
  } else if (view.byteLength > MAX_SLICE_TEXT_BYTES) {
    // El fallback a texto del vendor decodificaría el buffer entero.
    return null;
  }
  return vendorParseSliceFile(content, filename, sampleRate);
}
