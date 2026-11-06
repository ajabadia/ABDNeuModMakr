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

/**
 * S6.7b — pre-conteo anti-CPU-DoS (red-team 2026-11-06, ola 7).
 *
 * El tope post-parse de la ola 6 llegaba TARDE: un `.dspreset` de 7,3 MB
 * (bajo el tope de 8 MB) con 190k `<sample>` sin cerrar quemaba 4,3 s de
 * hilo principal construyendo objetos antes de que la compuerta de regiones
 * lo rechazase (2,2 s la variante `.nki`; medido pre-fix). Mismo fichero
 * enviable por mail, sin bomba binaria: freeze de UI, no OOM.
 *
 * El coste es ~lineal en nº de coincidencias (~22 µs por tag), así que se
 * pre-cuentan las etiquetas portadoras de región con `indexOf` (rápido,
 * sin construir nada, con salida temprana al superar el tope) ANTES de
 * llamar al vendor. Despacho por extensión porque cada formato usa su tag:
 * `.dspreset`/Bitwig → `<sample`, `.nki`/Omnisphere → `<zone`, TAL →
 * `<multisample>`+`<entry>`, TX16Wx → `<region>`+`<wave>`, resto → unión.
 * El límite de palabra imita `\b` del vendor (tras el tag no puede venir
 * `[A-Za-z0-9_]`), para no contar envoltorios como `<samples>` ni
 * quedarnos cortos con `<sample-x` (que el vendor SÍ casa).
 */
const REGION_TAGS_BY_EXT: Array<{ exts: string[]; tags: string[] }> = [
  { exts: ['.dspreset', '.multisample', 'multisample.xml'], tags: ['<sample'] },
  { exts: ['.nki', '.nki.xml', '.zmap', '.prt_omn'], tags: ['<zone'] },
  { exts: ['.talsmpl'], tags: ['<multisample', '<entry'] },
  { exts: ['.txprog'], tags: ['<region', '<wave', '<entry'] },
];
const FALLBACK_REGION_TAGS = ['<sample', '<zone', '<region', '<multisample', '<wave', '<entry'];

function isTagBoundary(ch: string): boolean {
  return ch.length === 0 || !/[A-Za-z0-9_]/.test(ch);
}

function countTagOccurrencesCapped(lowerText: string, tag: string, cap: number): number {
  let n = 0;
  let from = 0;
  for (;;) {
    const i = lowerText.indexOf(tag, from);
    if (i < 0) return n;
    if (isTagBoundary(lowerText[i + tag.length] ?? '')) {
      n++;
      if (n > cap) return n;
    }
    from = i + tag.length;
  }
}

function pickRegionTags(filename: string): string[] {
  const lower = filename.toLowerCase();
  for (const { exts, tags } of REGION_TAGS_BY_EXT) {
    if (exts.some((e) => lower.endsWith(e))) return tags;
  }
  return FALLBACK_REGION_TAGS;
}

function assertRegionTagCountSafe(filename: string, text: string): void {
  const lowerText = text.toLowerCase();
  const tags = pickRegionTags(filename);
  let total = 0;
  for (const tag of tags) {
    total += countTagOccurrencesCapped(lowerText, tag, MAX_SAMPLER_PRESET_REGIONS - total);
    if (total > MAX_SAMPLER_PRESET_REGIONS) {
      throw new Error(
        `Sampler preset declares too many region tags (${filename}: >${MAX_SAMPLER_PRESET_REGIONS} \`${tag}\` occurrences, pre-parse)`
      );
    }
  }
}

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
  let textForTagCount: string | undefined;
  if (typeof data !== 'string') {
    if (looksLikeTextDefinition(data)) {
      if (data.byteLength > MAX_SAMPLER_DEFINITION_TEXT_BYTES) {
        throw new Error(
          `Sampler definition too large (${filename}: ${data.byteLength} bytes, max ${MAX_SAMPLER_DEFINITION_TEXT_BYTES})`
        );
      }
      textForTagCount = new TextDecoder('utf-8').decode(data);
    }
  } else {
    if (data.length > MAX_SAMPLER_DEFINITION_TEXT_BYTES) {
      throw new Error(
        `Sampler definition too large (${filename}: ${data.length} chars, max ${MAX_SAMPLER_DEFINITION_TEXT_BYTES})`
      );
    }
    textForTagCount = data;
  }
  // Nivel 0 (ola 7): pre-conteo barato antes del parse caro del vendor.
  if (textForTagCount !== undefined) {
    assertRegionTagCountSafe(filename, textForTagCount);
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
