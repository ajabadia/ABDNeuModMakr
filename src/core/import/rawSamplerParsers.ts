// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Raw Multi-Format Sampler Parsers (Fase 18.8)
// Re-exported from @abdsynths/shared/formats/sampler as single source of truth.
// ─────────────────────────────────────────────────────────

export * from '@abdsynths/shared/formats/sampler/rawSamplerParsers.ts';

import {
  listZipSamplerPrograms,
  parseUniversalSampler,
  type ArchiveSamplerProgramInfo,
  type ParsedSamplerPreset,
} from '@abdsynths/shared/formats/sampler/rawSamplerParsers.ts';
import { extractIso9660Entries } from '@abdsynths/shared/formats/sampler/IsoFormatIdentifier.ts';

import {
  assertZipIndexWithinCaps,
  extractZipEntry,
  indexZipArchive,
} from '../../formats/ZipArchive.ts';

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
  { exts: ['.adv'], tags: ['<multisamplepart'] },
  { exts: ['.xpm', '.xty', '.xtd'], tags: ['<layer'] },
];
const FALLBACK_REGION_TAGS = ['<sample', '<zone', '<region', '<multisample', '<wave', '<entry'];

/** Primer byte de gzip (1f 8b). */
function isGzipMagic(data: ArrayBuffer): boolean {
  if (data.byteLength < 2) return false;
  const b = new Uint8Array(data, 0, 2);
  return b[0] === 0x1f && b[1] === 0x8b;
}

/** Extensiones cuyo gzip (si lo son) se infla con tope antes del vendor. */
const CAPPED_GZIP_EXTENSIONS = ['.adv', '.xpm', '.xty', '.xtd'];

/**
 * S6.7c — `.adv` con límite de inflado (red-team 2026-11-06, ola 8).
 * S6.7d — lo mismo para `.xpm`/`.xty`/`.xtd` MPC3 (ola 9): su `gunzip`
 * tampoco tiene tope (medido: 28 KB → 9,4 MB de JSON + 68 MB RSS, PASA).
 *
 * `unpackAbletonAdvXml` (vendor) infla gzip con `inflateRaw` SIN tope:
 * 217 KB → 55 MB de XML medidos sin que saltase ninguna compuerta
 * (el ISIZE del trailer ni se lee). Bomba clásica de ratio ~260:1+.
 *
 * Se infla aquí con `DecompressionStream` contando bytes y abortando al
 * superar el mismo tope de texto (8 MB); si cabe se pasa el XML ya
 * inflado como string al vendor (acepta string y no re-infla), con lo que
 * le aplican el pre-conteo y los topes de texto/regiones igual que al
 * resto. `DecompressionStream` ya lo usa el vendor (Kontakt/MPC-XPM) y el
 * proyecto exige Node ≥ 18: sin riesgo nuevo de plataforma.
 */
async function inflateGzipTextCapped(filename: string, data: Uint8Array<ArrayBuffer>): Promise<string> {
  const ds = new DecompressionStream('gzip');
  const writePromise = (async () => {
    const writer = ds.writable.getWriter();
    try {
      await writer.write(data);
    } finally {
      await writer.close();
    }
  })();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    const reader = ds.readable.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_SAMPLER_DEFINITION_TEXT_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error(
          `Sampler preset inflates too large (${filename}: >${MAX_SAMPLER_DEFINITION_TEXT_BYTES} bytes from ${data.byteLength} compressed)`
        );
      }
      chunks.push(value);
    }
  } finally {
    await writePromise.catch(() => undefined);
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.byteLength;
  }
  return new TextDecoder('utf-8').decode(out);
}

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

const KNOWN_TEXT_EXTENSIONS = [
  '.dspreset', '.nki', '.nki.xml', '.multisample', 'multisample.xml', '.talsmpl',
  '.txprog', '.zmap', '.prt_omn', '.vstpreset.xml', '.adv', '.synx', '-entry.txt', '.exs',
];

function assertRegionTagCountSafe(filename: string, text: string): void {
  if (!text.includes('<')) return;
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
  const bytes = new Uint8Array(data);
  let i = 0;
  // Ola 12 (fuzz mutacional): insensible a prefijos — el vendor hace
  // `trimStart()` en varias rutas (p. ej. `.xpm` acepta JSON con espacios
  // delante), así que la compuerta huele el primer byte significativo
  // igual que él; si no, un prefijo esquivaba la compuerta de 8 MB.
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d || b === 0x0b || b === 0x0c) {
      i++;
      continue;
    }
    break;
  }
  if (i >= bytes.length) return false;
  const first = bytes[i];
  return first === 0x3c || first === 0x7b || first === 0x5b;
}

/**
 * S6.7g — formatos que el vendor decodifica como texto SIEMPRE (ola 12).
 * `.grp`/`.tvpst`/`elmulti`/`patch.json` se decodifican con `TextDecoder`
 * sin condición en el vendor, así que un prefijo (o su ausencia de olor)
 * no cambia nada para él — pero nos esquivaba la compuerta de 8 MB. Como
 * > 8 MB de TSV/INI/JSON son siempre >> 16384 regiones, morirían en el
 * tope post-parse igualmente: caparlos por bytes no rompe ningún
 * legítimo que pudiera importar.
 */
const ALWAYS_TEXT_EXTENSIONS = ['.grp', '.tvpst', 'elmulti', 'patch.json'];

/** Magia ZIP (`PK\x03\x04`, igual que el `isZipHeader` privado del vendor). */
function isZipMagicBytes(data: Uint8Array): boolean {
  return (
    data.byteLength >= 4 &&
    data[0] === 0x50 &&
    data[1] === 0x4b &&
    data[2] === 0x03 &&
    data[3] === 0x04
  );
}

function isGzipMagicBytes(data: Uint8Array): boolean {
  return data.byteLength >= 2 && data[0] === 0x1f && data[1] === 0x8b;
}

/**
 * S6.7k — contenedores que el vendor recurre INTERNAMENTE al listar
 * (`listZipSamplerPrograms`: `/\\.(zip|xpn|iso|img|dsk|bin|hda|out|efe|ede|gkh|e4b|esi)$/`
 * en la rama ZIP y la misma familia en la rama ISO-9660). El barrido de la
 * ola 11 solo recorría `.zip`/`.xpn`: un ZIP exterior con un `inner.bin`
 * (un ZIP renombrado) o un `.iso` con un `.zip` dentro esquivaba TODAS las
 * compuertas — el vendor extraía y parseaba el interior sin topes
 * (red-team 2026-11-06, ola 17: 23 KB → 500k layers, 24→145 MB heap).
 * La lista replica EXACTAMENTE la regex del vendor: ni una más (un falso
 * positivo tiraría imports legítimos), ni una menos (un hueco es bypass).
 */
const NESTED_CONTAINER_EXTENSIONS = [
  '.zip', '.xpn', '.iso', '.img', '.dsk', '.bin', '.hda', '.out',
  '.efe', '.ede', '.gkh', '.e4b', '.esi',
];
const MAX_NESTED_ZIP_DEPTH = 3;

/**
 * S6.7f — pre-barrido anti-ZIP-anidado (red-team 2026-11-06, ola 11).
 *
 * El vendor, al recibir un `.zip`/`.xpn`, indexa y extrae CADA entrada con
 * `extractZipEntry` sin tope propio: las compuertas S6.7/S6.7b/S6.7c/S6.7d
 * solo miraban el fichero exterior, así que un `.dspreset` con 190k
 * etiquetas sin cerrar metido en un `.xpn` de 4 MB esquivaba el pre-conteo
 * y colgaba el hilo > 100 s (cuadrático verificado: 2k→93 ms, 8k→1,5 s,
 * 20k→7,2 s, 190k→horas), y un `.xpm` gzip anidado se inflaba sin tope.
 *
 * El barrido replica las compuertas planas por entrada (índice S6.1 +
 * texto 8 MB + pre-conteo + inflado gzip acotado como ensayo: si cabe, el
 * re-inflado del vendor ya está probado acotado) y recurre en `.zip`/`.xpn`
 * anidados — justo los que el vendor recurre internamente — con tope de
 * profundidad. Las entradas de audio se saltan: su inflado lo acotan los
 * topes S6.1 por cabecera y su decodificación las compuertas de la ola 4.
 */
/** Magia ISO-9660 (`CD001` en 0x8001, igual que `extractIso9660Entries`). */
function isIsoMagicBytes(data: Uint8Array): boolean {
  return (
    data.byteLength >= 0x8006 &&
    data[0x8001] === 0x43 &&
    data[0x8002] === 0x44 &&
    data[0x8003] === 0x30 &&
    data[0x8004] === 0x30 &&
    data[0x8005] === 0x31
  );
}

/**
 * Prefijos de TODOS los errores propios de compuerta: al barrer un
 * contenedor ilegible se ignora (paridad con el vendor, que lo envuelve en
 * `try/catch`), pero un error de compuerta sobre contenido RECONOCIDO debe
 * propagarse siempre — si no, el `catch` lo convertiría en fail-open.
 */
function isGateError(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return (
    m.startsWith('Sampler archive nested too deep') ||
    m.startsWith('Sampler preset inflates too large') ||
    m.startsWith('Sampler definition too large') ||
    m.startsWith('Sampler preset declares too many region tags') ||
    m.startsWith('ZIP too many entries') ||
    m.startsWith('ZIP entry too large') ||
    m.startsWith('ZIP total too large') ||
    m.startsWith('ZIP entry with indeterminate size')
  );
}

async function assertSweptEntryBytes(
  entryPath: string,
  entryBytes: Uint8Array,
  topFilename: string,
  depth: number,
): Promise<void> {
  const lowerPath = entryPath.toLowerCase();
  if (NESTED_CONTAINER_EXTENSIONS.some((e) => lowerPath.endsWith(e))) {
    await assertNestedContainerBytes(entryPath, entryBytes, topFilename, depth + 1);
    return;
  }
  if (CAPPED_GZIP_EXTENSIONS.some((e) => lowerPath.endsWith(e))) {
    if (isGzipMagicBytes(entryBytes)) {
      await inflateGzipTextCapped(entryPath, new Uint8Array(entryBytes));
    } else if (entryBytes.byteLength > MAX_SAMPLER_DEFINITION_TEXT_BYTES) {
      // S6.7g: sin magia el vendor lo decodifica como texto igualmente.
      throw new Error(
        `Sampler definition too large (${entryPath} nested in ${topFilename}: ${entryBytes.byteLength} bytes, max ${MAX_SAMPLER_DEFINITION_TEXT_BYTES})`
      );
    }
    return;
  }
  if (ALWAYS_TEXT_EXTENSIONS.some((e) => lowerPath.endsWith(e))) {
    if (entryBytes.byteLength > MAX_SAMPLER_DEFINITION_TEXT_BYTES) {
      throw new Error(
        `Sampler definition too large (${entryPath} nested in ${topFilename}: ${entryBytes.byteLength} bytes, max ${MAX_SAMPLER_DEFINITION_TEXT_BYTES})`
      );
    }
    assertRegionTagCountSafe(entryPath, new TextDecoder('utf-8').decode(entryBytes));
    return;
  }
  if (KNOWN_TEXT_EXTENSIONS.some((e) => lowerPath.endsWith(e))) {
    if (
      looksLikeTextDefinition(
        entryBytes.buffer.slice(entryBytes.byteOffset, entryBytes.byteOffset + entryBytes.byteLength) as ArrayBuffer,
      ) &&
      entryBytes.byteLength > MAX_SAMPLER_DEFINITION_TEXT_BYTES
    ) {
      throw new Error(
        `Sampler definition too large (${entryPath} nested in ${topFilename}: ${entryBytes.byteLength} bytes, max ${MAX_SAMPLER_DEFINITION_TEXT_BYTES})`
      );
    }
    assertRegionTagCountSafe(entryPath, new TextDecoder('utf-8').decode(entryBytes));
  }
}

/**
 * S6.7k — despacho de contenedor anidado por CONTENIDO, no por extensión.
 * El vendor recurre por extensión (cualquiera de
 * `NESTED_CONTAINER_EXTENSIONS`); aquí se inspecciona la magia real:
 * ZIP → índice + topes S6.1 + barrido por entrada; ISO-9660 → se enumeran
 * sus ficheros (paseo lineal acotado por el tamaño de la imagen) y se les
 * aplica la misma batería por nombre — el vendor también recurre a los
 * contenedores que haya dentro. Otra imagen de disco (Akai/E-mu/Roland/
 * Ensoniq/Yamaha/Casio) o contenido desconocido: el vendor solo ejecuta
 * sniffers lineales y lista programas (sin inflados ni parses en línea),
 * así que se acepta sin más — igual que antes se aceptaba el `.iso`.
 * Ilegible/corrupto → se ignora (el vendor lo envuelve en try/catch);
 * compuerta violada sobre contenido reconocido → se propaga (fail-closed).
 */
async function assertNestedContainerBytes(
  name: string,
  bytes: Uint8Array,
  topFilename: string,
  depth: number,
): Promise<void> {
  if (depth > MAX_NESTED_ZIP_DEPTH) {
    throw new Error(
      `Sampler archive nested too deep (${name} nested in ${topFilename}, max ${MAX_NESTED_ZIP_DEPTH})`
    );
  }
  if (isZipMagicBytes(bytes)) {
    let index;
    try {
      index = indexZipArchive(bytes);
    } catch {
      return; // No es un ZIP legible: el vendor tampoco lo indexaría.
    }
    assertZipIndexWithinCaps(index);
    for (const entry of index) {
      let entryBytes: Uint8Array;
      try {
        entryBytes = extractZipEntry(bytes, entry);
      } catch {
        continue; // Entrada corrupta: el vendor la salta al listar.
      }
      await assertSweptEntryBytes(entry.path, entryBytes, topFilename, depth);
    }
    return;
  }
  if (isIsoMagicBytes(bytes)) {
    let isoEntries: Map<string, Uint8Array>;
    try {
      isoEntries = extractIso9660Entries(bytes);
    } catch (e) {
      if (isGateError(e)) throw e;
      return; // ISO ilegible: el vendor la ignora.
    }
    for (const [norm, fileBytes] of isoEntries) {
      await assertSweptEntryBytes(norm, fileBytes, topFilename, depth);
    }
  }
  // Otra imagen / opaco: sin trabajo en línea en el vendor. Nada que barrer.
}

async function assertZipContentsSafe(
  filename: string,
  zipBytes: Uint8Array,
  depth = 0,
): Promise<void> {
  await assertNestedContainerBytes(filename, zipBytes, filename, depth);
}

/**
 * `listZipSamplerPrograms` con compuerta S6.7f: el listado del vendor
 * extrae y parsea entradas (incl. gunzip de `.xpm`) sin topes; el barrido
 * previo lo deja probadamente acotado antes de delegar.
 */
export async function listZipSamplerProgramsCapped(
  filename: string,
  data: ArrayBuffer,
): Promise<ArchiveSamplerProgramInfo[]> {
  const bytes = new Uint8Array(data);
  const lowerName = filename.toLowerCase();
  // S6.7k: el vendor también lista imágenes de disco (`.iso`/`.img`/…)
  // y contenedores con magia ZIP aunque la extensión no sea `.zip` — el
  // despacho es por contenido, no por extensión.
  if (
    NESTED_CONTAINER_EXTENSIONS.some((e) => lowerName.endsWith(e)) ||
    isZipMagicBytes(bytes) ||
    isIsoMagicBytes(bytes)
  ) {
    await assertZipContentsSafe(filename, bytes);
  }
  return listZipSamplerPrograms(filename, data);
}

export async function parseUniversalSamplerCapped(
  filename: string,
  data: ArrayBuffer | string,
  ...rest: unknown[]
): Promise<ParsedSamplerPreset> {
  const lowerName = filename.toLowerCase();
  // Nivel -2 (olas 11/17): contenedor — barrido de entradas anidadas con
  // los mismos topes que en plano, antes de que el vendor extraiga nada.
  // Despacho por contenido (ola 17): el vendor recurre a `.iso`/`.img`/
  // `.bin`/… y a magia ZIP con otra extensión; solo la extensión nos
  // dejaba fuera del barrido esos interiores.
  if (typeof data !== 'string') {
    const bytes = new Uint8Array(data);
    if (
      NESTED_CONTAINER_EXTENSIONS.some((e) => lowerName.endsWith(e)) ||
      isZipMagicBytes(bytes) ||
      isIsoMagicBytes(bytes)
    ) {
      await assertZipContentsSafe(filename, bytes);
    }
  }

  // Nivel -1 (olas 8–9, ampliado ola 12): `gzip` de preset se infla aquí
  // con tope; el vendor lo recibiría sin límite. Se pasa como string para
  // no re-inflar (ninguna de estas rutas re-comprime: el vendor detecta
  // gzip por magia). Ola 12: si NO hay magia gzip, el vendor trata estas
  // extensiones como texto igualmente (`unpackAbletonAdvXml`/`parseMpcXpm`
  // decodifican siempre), así que el tope crudo aplica también — si no, un
  // prefijo cualquiera esquivaba el inflado acotado Y la compuerta de olor.
  if (typeof data !== 'string' && CAPPED_GZIP_EXTENSIONS.some((e) => lowerName.endsWith(e))) {
    if (!isGzipMagic(data) && data.byteLength > MAX_SAMPLER_DEFINITION_TEXT_BYTES) {
      throw new Error(
        `Sampler definition too large (${filename}: ${data.byteLength} bytes, max ${MAX_SAMPLER_DEFINITION_TEXT_BYTES})`
      );
    }
    if (isGzipMagic(data)) {
      const xml = await inflateGzipTextCapped(filename, new Uint8Array(data));
      assertRegionTagCountSafe(filename, xml);
      const preset = await (
        parseUniversalSampler as (...args: unknown[]) => Promise<{ regions?: unknown[] }>
      )(filename, xml, ...rest);
      const count = Array.isArray(preset?.regions) ? (preset.regions as unknown[]).length : 0;
      if (count > MAX_SAMPLER_PRESET_REGIONS) {
        throw new Error(
          `Sampler preset declares too many regions (${filename}: ${count}, max ${MAX_SAMPLER_PRESET_REGIONS})`
        );
      }
      return preset as ParsedSamplerPreset;
    }
  }

  let textForTagCount: string | undefined;
  if (typeof data !== 'string') {
    const knownTextExt = KNOWN_TEXT_EXTENSIONS.some((e) => filename.toLowerCase().endsWith(e));
    const alwaysTextExt = ALWAYS_TEXT_EXTENSIONS.some((e) => filename.toLowerCase().endsWith(e));
    if (alwaysTextExt && data.byteLength > MAX_SAMPLER_DEFINITION_TEXT_BYTES) {
      // S6.7g: el vendor lo decodifica como texto sin condición; > 8 MB
      // moriría en el tope post-parse igualmente (>> 16384 regiones).
      throw new Error(
        `Sampler definition too large (${filename}: ${data.byteLength} bytes, max ${MAX_SAMPLER_DEFINITION_TEXT_BYTES})`
      );
    }
    if (looksLikeTextDefinition(data)) {
      // Orden ola 6 intacto: tamaño → pre-conteo → vendor → regiones.
      if (data.byteLength > MAX_SAMPLER_DEFINITION_TEXT_BYTES) {
        throw new Error(
          `Sampler definition too large (${filename}: ${data.byteLength} bytes, max ${MAX_SAMPLER_DEFINITION_TEXT_BYTES})`
        );
      }
      textForTagCount = new TextDecoder('utf-8').decode(data);
    } else if (knownTextExt) {
      // Formato de texto conocido pero sin olor a texto (BOM, espacios
      // iniciales o binario con esa extensión): pre-contar SIN compuerta
      // de tamaño, para no romper `.nki` binarios legítimos de > 8 MB
      // (no contienen estas etiquetas en cantidad).
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
