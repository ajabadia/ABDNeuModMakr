// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — SoundFont 2 (.sf2) Native Importer
// Re-exported from @abdsynths/shared/formats/sampler as single source of truth.
// ─────────────────────────────────────────────────────────

export * from '@abdsynths/shared/formats/sampler/Sf2Parser.ts';
export { classifyInstrumentAndParameterSet } from '../core/dsp/instrumentNameHints.ts';

import {
  importSf2PresetToNative,
  type NativeSamplerImportResult,
} from '@abdsynths/shared/formats/sampler/Sf2Parser.ts';

// ── S6.4: compuerta anti-DoS para SoundFont 2 (proyecto) ──
// El parser del vendor confía en dos u32 del fichero sin acotarlos contra
// los bytes reales: `smpl/subSize` (longitud de la tabla de muestras) y
// `shdr.start/end` (índices de inicio/fin por muestra). Un `.sf2` de ~200
// bytes que declare `smpl = 4 GB` + `end = 2 G` frames hace que
// `extractSampleFloat32` ejecute `new Float32Array(2G)` (8 GB) y tumbe la
// pestaña. Esta compuerta re-escanea la cabecera (barato, sin asignar
// muestras) ANTES de extraer nada: todo índice debe caber en los datos
// reales del fichero. Fail-closed. (No se reutiliza `parseSf2Structure`
// del vendor porque no está exportada.)
// ─────────────────────────────────────────────────────────
export const APP_MAX_SF2_SAMPLE_RATE = 384000;
export const APP_MIN_SF2_SAMPLE_RATE = 4000;

function readFourCC(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3)
  );
}

/**
 * Valida que los índices de muestra del `.sf2` quepan en los bytes reales.
 * Lanza si el fichero miente.
 */
export function assertSf2SampleBoundsSafe(buffer: ArrayBuffer): void {
  const view = new DataView(buffer);
  if (buffer.byteLength < 12 || readFourCC(view, 0) !== 'RIFF') {
    return; // no es sfbk: el vendor lanza su propio error
  }
  let smplOffset = -1;
  let smplDeclared = 0;
  const shdrRanges: Array<{ start: number; end: number; startLoop: number; endLoop: number; rate: number; name: string }> = [];
  let pos = 12;
  while (pos + 8 <= buffer.byteLength) {
    const chunkId = readFourCC(view, pos);
    const chunkSize = view.getUint32(pos + 4, true);
    const dataStart = pos + 8;
    if (!Number.isFinite(chunkSize) || chunkSize > buffer.byteLength) break;
    if (chunkId === 'LIST' && dataStart + 4 <= buffer.byteLength) {
      const listType = readFourCC(view, dataStart);
      let sub = dataStart + 4;
      const listEnd = Math.min(buffer.byteLength, dataStart + 4 + chunkSize);
      while (sub + 8 <= listEnd) {
        const subId = readFourCC(view, sub);
        const subSize = view.getUint32(sub + 4, true);
        const subData = sub + 8;
        if (listType === 'sdta' && subId === 'smpl') {
          smplOffset = subData;
          smplDeclared = subSize;
        } else if (listType === 'pdta' && subId === 'shdr') {
          const avail = Math.max(0, Math.min(subSize, listEnd - subData));
          const count = Math.floor(avail / 46);
          for (let i = 0; i < count; i++) {
            const b = subData + i * 46;
            if (b + 46 > buffer.byteLength) break;
            shdrRanges.push({
              start: view.getUint32(b + 20, true),
              end: view.getUint32(b + 24, true),
              startLoop: view.getUint32(b + 28, true),
              endLoop: view.getUint32(b + 32, true),
              rate: view.getUint32(b + 36, true),
              name: readFourCC(view, b) + '…',
            });
          }
        }
        if (subSize > buffer.byteLength) break;
        sub += 8 + subSize + (subSize & 1);
      }
    }
    pos += 8 + chunkSize + (chunkSize & 1);
  }
  if (smplOffset < 0) return; // sin muestras: el vendor lanza su propio error
  const availableBytes = Math.max(0, buffer.byteLength - smplOffset);
  if (smplDeclared > availableBytes + 64) {
    throw new Error(
      `SF2: smpl size out of bounds (${smplDeclared} declared, ${availableBytes} available)`
    );
  }
  // +64 de tolerancia: el padding EOS legítimo (46 muestras del registro
  // terminal) puede exceder los frames en unas pocas muestras; un atacante
  // necesita MILLONES para tumbar nada, así que el margen es inocuo.
  const smplFrames = Math.floor(availableBytes / 2) + 64;
  for (const r of shdrRanges) {
    // Registro terminal (todo ceros): lo incluye todo `.sf2` válido; se ignora.
    if (r.start === 0 && r.end === 0 && r.rate === 0) continue;
    for (const [label, v] of [
      ['start', r.start],
      ['end', r.end],
      ['startLoop', r.startLoop],
      ['endLoop', r.endLoop],
    ] as const) {
      if (v > smplFrames) {
        throw new Error(`SF2: shdr ${label} out of bounds (${v} > ${smplFrames} frames)`);
      }
    }
    if (r.rate < APP_MIN_SF2_SAMPLE_RATE || r.rate > APP_MAX_SF2_SAMPLE_RATE) {
      throw new Error(`SF2: shdr sample rate out of bounds (${r.rate} Hz)`);
    }
  }
}

/**
 * `importSf2PresetToNative` con compuerta S6.4: valida los índices por
 * cabecera antes de extraer (y por tanto antes de asignar) ninguna muestra.
 */
export function importSf2PresetToNativeCapped(
  buffer: ArrayBuffer,
  presetIndex = 0
): NativeSamplerImportResult {
  assertSf2SampleBoundsSafe(buffer);
  return importSf2PresetToNative(buffer, presetIndex);
}
