// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Raw Multi-Format Sampler Parsers (Fase 18.8)
// Re-exported from @abdsynths/shared/formats/sampler as single source of truth.
// ─────────────────────────────────────────────────────────

export * from '@abdsynths/shared/formats/sampler/rawSamplerParsers.ts';

import {
  parseUniversalSampler,
  type ParsedSamplerPreset,
} from '@abdsynths/shared/formats/sampler/rawSamplerParsers.ts';

/**
 * S6.7 — compuerta anti-preset-monstruo (red-team 2026-11-06, ola 6).
 *
 * El vendor parsea definiciones de texto (.dspreset/.nki-XML/.exs/...) SIN
 * tope de tamaño y devuelve `regions` SIN tope de cantidad: un `.nki` de
 * 31 MB con 200k `<zone>` se parsea entero y sus 200k regiones fluyen a
 * `session.zones` → muerte de la UI al refrescar (medido pre-fix: 1,6 s
 * de parse + 200k objetos en sesión desde un fichero enviable por mail).
 *
 * Fail-closed en dos niveles: texto > 8 MB (los legítimos llevan cientos
 * de zonas, no millones) y > 16384 regiones post-parse. El tope de texto
 * solo aplica si el contenido huele a texto (`<`/`{`/`[` inicial), para no
 * tocar los `.nki` binarios cifrados (que además retornan `regions: []`).
 */
export const MAX_SAMPLER_DEFINITION_TEXT_BYTES = 8 * 1024 * 1024;
export const MAX_SAMPLER_PRESET_REGIONS = 16384;

function looksLikeTextDefinition(data: ArrayBuffer): boolean {
  if (data.byteLength === 0) return false;
  const first = new Uint8Array(data, 0, 1)[0];
  return first === 0x3c || first === 0x7b || first === 0x5b;
}

export async function parseUniversalSamplerCapped(
  filename: string,
  data: ArrayBuffer | string,
  ...rest: unknown[]
): Promise<ParsedSamplerPreset> {
  if (typeof data !== 'string') {
    if (looksLikeTextDefinition(data) && data.byteLength > MAX_SAMPLER_DEFINITION_TEXT_BYTES) {
      throw new Error(
        `Sampler definition too large (${filename}: ${data.byteLength} bytes, max ${MAX_SAMPLER_DEFINITION_TEXT_BYTES})`
      );
    }
  } else if (data.length > MAX_SAMPLER_DEFINITION_TEXT_BYTES) {
    throw new Error(
      `Sampler definition too large (${filename}: ${data.length} chars, max ${MAX_SAMPLER_DEFINITION_TEXT_BYTES})`
    );
  }
  const preset = await (
    parseUniversalSampler as (...args: unknown[]) => Promise<{ regions?: unknown[] }>
  )(filename, data, ...rest);
  const count = Array.isArray(preset?.regions) ? (preset.regions as unknown[]).length : 0;
  if (count > MAX_SAMPLER_PRESET_REGIONS) {
    throw new Error(
      `Sampler preset declares too many regions (${filename}: ${count}, max ${MAX_SAMPLER_PRESET_REGIONS})`
    );
  }
  return preset as ParsedSamplerPreset;
}
