// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — SFZ (.sfz) Native Importer
// Re-exported from @abdsynths/shared/formats/sampler as single source of truth.
// ─────────────────────────────────────────────────────────

export * from '@abdsynths/shared/formats/sampler/SfzParser.ts';

import { importSfzToNative } from '@abdsynths/shared/formats/sampler/SfzParser.ts';
import type { AudioFilePayload } from '@abdsynths/shared/formats/sampler/SamplerTypes.ts';
import type { NativeSamplerImportResult } from '@abdsynths/shared/formats/sampler/Sf2Parser.ts';

/**
 * S6.6 — compuerta anti-bomba-cuadrática para SFZ (red-team 2026-11-06, ola 5).
 *
 * El vendor fusiona `{...global, ...master, ...group, ...region}` POR REGIÓN
 * sin acotar el nº de opcodes por bloque: un `<global>` con N opcodes y R
 * `<region>` cuesta R×N copias. Medido pre-fix: 232 KB (20k opcodes × 2048
 * regiones) → RSS 84→1767 MB en 26 s.
 *
 * Fail-closed: como máximo 128 opcodes por bloque `<…>` y 8192 bloques.
 * Un `.sfz` legítimo lleva decenas de opcodes por bloque como mucho; el que
 * miente se rechaza ANTES de fusionar nada.
 */
export const MAX_SFZ_OPCODES_PER_BLOCK = 128;
export const MAX_SFZ_HEADER_BLOCKS = 8192;

const SFZ_HEADER_RE = /<(control|global|master|group|region)>/gi;
const SFZ_OPCODE_RE = /(?:^|\s)[a-zA-Z0-9_]+\s*=/g;

function countSfzOpcodes(segment: string): number {
  SFZ_OPCODE_RE.lastIndex = 0;
  let n = 0;
  while (SFZ_OPCODE_RE.exec(segment) !== null) n++;
  return n;
}

export function assertSfzTextBoundsSafe(sfzText: string): void {
  SFZ_HEADER_RE.lastIndex = 0;
  let blocks = 0;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  const check = (segment: string): void => {
    const n = countSfzOpcodes(segment);
    if (n > MAX_SFZ_OPCODES_PER_BLOCK) {
      throw new Error(
        `SFZ: header block with ${n} opcodes exceeds cap (${MAX_SFZ_OPCODES_PER_BLOCK}); refusing quadratic merge`
      );
    }
  };
  // El texto previo al primer `<…>` también puede llevar opcodes sueltos.
  while ((m = SFZ_HEADER_RE.exec(sfzText)) !== null) {
    check(sfzText.slice(lastIndex, m.index));
    lastIndex = SFZ_HEADER_RE.lastIndex;
    if (++blocks > MAX_SFZ_HEADER_BLOCKS) {
      throw new Error(`SFZ: too many header blocks (>${MAX_SFZ_HEADER_BLOCKS})`);
    }
  }
  check(sfzText.slice(lastIndex));
}

export function importSfzToNativeCapped(
  sfzText: string,
  sfzFileName: string,
  companionAudioFiles: AudioFilePayload[] = []
): NativeSamplerImportResult {
  assertSfzTextBoundsSafe(sfzText);
  return importSfzToNative(sfzText, sfzFileName, companionAudioFiles);
}
