// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Pure TypeScript REX2 / DWOP Audio Decompressor
// Re-exported from @abdsynths/shared/formats/sampler as single source of truth.
// ─────────────────────────────────────────────────────────

export * from '@abdsynths/shared/formats/sampler/DwopDecompressor.ts';

import { decompressRx2Audio, isRx2Buffer } from '@abdsynths/shared/formats/sampler/DwopDecompressor.ts';

/**
 * S6.7e — REX2 con `totalFrames` mentiroso (red-team 2026-11-06, ola 9).
 *
 * El vendor reserva `new Float32Array(totalFrames)` por canal con el u32
 * del chunk SINF sin validar: un fichero de 56 bytes con
 * `totalFrames = 0xFFFFFFFF` intenta reservar 16 GB y el proceso se cuelga
 * (medido: > 100 s sin retorno; solo matándolo). Ni siquiera un
 * `RangeError` rápido: muerte por swap.
 *
 * La compuerta lee el SINF (mismo recorrido IFF acotado que el vendor,
 * con recursión `CAT ` de profundidad ≤ 3) y rechaza lo que supere la
 * política de audio de la app (WavDecoder: 128 M frames / 512 M muestras
 * totales). Un loop REX2 legítimo dura compases, no horas.
 */
export const APP_MAX_RX2_FRAMES = 128 * 1024 * 1024;
export const APP_MAX_RX2_SAMPLES_TOTAL = 512 * 1024 * 1024;

function readRx2SinFrames(view: DataView, start: number, end: number, depth: number): void {
  let off = start;
  let guard = 0;
  const maxSteps = 1 + ((end - start) >>> 3);
  while (off + 8 <= end && guard++ < maxSteps) {
    const id =
      String.fromCharCode(view.getUint8(off), view.getUint8(off + 1), view.getUint8(off + 2), view.getUint8(off + 3));
    const chunkSz = view.getUint32(off + 4, false);
    if (chunkSz > end - off - 8) break;
    if (id === 'SINF' && chunkSz >= 18) {
      const channels = view.getUint8(off + 8) === 2 ? 2 : 1;
      const frames = view.getUint32(off + 14, false);
      if (frames > APP_MAX_RX2_FRAMES || frames * channels > APP_MAX_RX2_SAMPLES_TOTAL) {
        throw new Error(
          `REX2 loop declares too many frames (${frames} x${channels}ch, max ${APP_MAX_RX2_FRAMES} frames / ${APP_MAX_RX2_SAMPLES_TOTAL} samples)`
        );
      }
      return;
    }
    if (id === 'CAT ' && chunkSz >= 4 && depth < 3) {
      readRx2SinFrames(view, off + 12, off + 8 + chunkSz, depth + 1);
    }
    off += 8 + chunkSz;
    if (off & 1) off++;
  }
}

export function assertRx2SizeSafe(buffer: ArrayBuffer, filename = 'loop.rx2'): void {
  if (!isRx2Buffer(buffer)) return;
  try {
    readRx2SinFrames(new DataView(buffer), 12, buffer.byteLength, 0);
  } catch (e) {
    throw new Error(`Refusing ${filename}: ${(e as Error).message}`);
  }
}

export function decompressRx2AudioCapped(buffer: ArrayBuffer, filename = 'loop.rx2') {
  assertRx2SizeSafe(buffer, filename);
  return decompressRx2Audio(buffer);
}
