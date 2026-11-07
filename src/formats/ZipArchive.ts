// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Pure TypeScript PKZIP Archive
// Re-exported from @abdsynths/shared/formats/neuron as single source of truth.
// ─────────────────────────────────────────────────────────

export * from '@abdsynths/shared/formats/neuron';

import {
  indexZipArchive,
  type ParsedZipEntry,
  type ZipCentralEntry,
} from '@abdsynths/shared/formats/neuron';

// ── S6.1: topes anti-bomba del PROYECTO (más estrictos que los del vendor) ──
// El vendor permite 5000 entradas / 800 MB por entrada / 1 GB total: un ZIP de
// 42 KB puede forzar una reserva de 800 MB (`new Uint8Array(uncompressedSize)`
// en `inflateRaw`) y tumbar la pestaña. Estos topes se verifican SOLO con la
// cabecera central (sin descomprimir nada) antes de delegar al vendor.
// ─────────────────────────────────────────────────────────
export const APP_MAX_ZIP_ENTRIES = 2000;
export const APP_MAX_ZIP_ENTRY_BYTES = 100 * 1024 * 1024;
export const APP_MAX_ZIP_TOTAL_BYTES = 300 * 1024 * 1024;

/**
 * Verifica los topes S6.1 a partir del índice central (barato, sin inflar).
 * Lanza si el ZIP declara más de lo permitido — la descompresión ni empieza,
 * así que una bomba de 42 KB → 800 MB muere aquí, no en el allocator.
 */
export function assertZipIndexWithinCaps(index: readonly ZipCentralEntry[]): void {
  if (index.length > APP_MAX_ZIP_ENTRIES) {
    throw new Error(
      `ZIP too many entries (${index.length}, max ${APP_MAX_ZIP_ENTRIES})`
    );
  }
  let declaredTotal = 0;
  for (const e of index) {
    // Descriptor-bit evasión: un method-8 con datos comprimidos que declara 0
    // bytes inflados esquiva el tope por cabecera y el `new Uint8Array(size)`
    // inicial — `inflateRaw` crecería sin cota. En un central directory válido
    // los tamaños reales siempre están presentes; 0+datos = malformado.
    if (e.method === 8 && e.compressedSize > 0 && (e.uncompressedSize || 0) === 0) {
      throw new Error(`ZIP entry with indeterminate size (${e.path}): rejected`);
    }
    const claimed = Math.max(0, e.uncompressedSize || 0);
    if (claimed > APP_MAX_ZIP_ENTRY_BYTES || e.compressedSize > APP_MAX_ZIP_ENTRY_BYTES) {
      throw new Error(
        `ZIP entry too large (${e.path}: ${claimed} bytes, max ${APP_MAX_ZIP_ENTRY_BYTES})`
      );
    }
    declaredTotal += claimed;
    if (declaredTotal > APP_MAX_ZIP_TOTAL_BYTES) {
      throw new Error(
        `ZIP total too large (${declaredTotal} bytes, max ${APP_MAX_ZIP_TOTAL_BYTES})`
      );
    }
  }
}

/**
 * S6.7l — extracción con tope REAL de salida (red-team 2026-11-07, ola 18).
 *
 * El `inflateRaw` del vendor crece por duplicación SIN cota en el bucle: el
 * único freno es `expectedSize` (el `uncompressedSize` DECLARADO). Un ZIP de
 * 146 KB que declara `uncomp=1024` pero cuyo stream real infla a 150 MB
 * pasa todos los topes por cabecera (S6.1) y el `new Uint8Array(1024)`
 * inicial no sirve de nada — medido pre-fix: 150 MB extraídos sin throw.
 * A escala de topes (stream de 100 MB) son GBs: OOM de pestaña.
 * Aquí se infla con `DecompressionStream` nativo leyendo por trozos y
 * abortando al superar `APP_MAX_ZIP_ENTRY_BYTES`: la memoria nunca supera
 * el tope, sea cual sea la mentira declarada. `stored` no amplifica, pero
 * se acotan sus rebanadas por coherencia.
 */
export async function extractZipEntryCapped(
  zipBytes: Uint8Array,
  entry: ZipCentralEntry
): Promise<Uint8Array> {
  const claimed = Math.max(0, entry.uncompressedSize || 0);
  if (claimed > APP_MAX_ZIP_ENTRY_BYTES || entry.compressedSize > APP_MAX_ZIP_ENTRY_BYTES) {
    throw new Error(
      `ZIP entry too large (${entry.path}: ${claimed} bytes, max ${APP_MAX_ZIP_ENTRY_BYTES})`
    );
  }
  if (entry.method === 8 && entry.compressedSize > 0 && claimed === 0) {
    throw new Error(`ZIP entry with indeterminate size (${entry.path}): rejected`);
  }
  if (entry.dataOffset < 0 || entry.dataOffset + entry.compressedSize > zipBytes.byteLength) {
    throw new Error(`ZIP entry out of bounds (${entry.path}): rejected`);
  }
  if (entry.method === 0) {
    const out = new Uint8Array(entry.compressedSize);
    out.set(zipBytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize));
    return out;
  }
  if (entry.method === 8) {
    if (entry.compressedSize === 0) return new Uint8Array(0);
    if (typeof DecompressionStream === 'undefined') {
      // Sin inflado nativo (entorno mínimo): no hay forma de acotar la
      // salida, así que fail-closed antes que inflar a ciegas.
      throw new Error(`ZIP inflate unavailable in this runtime (${entry.path}): rejected`);
    }
    const raw = zipBytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
    const ds = new DecompressionStream('deflate-raw');
    // OJO streams: el writable tiene highWaterMark=1 — si se espera al
    // `write` antes de leer, promesa pendiente y lector inexistente se
    // bloquean mutuamente. Se bombea en paralelo a la lectura.
    const pump = (async () => {
      const writer = ds.writable.getWriter();
      try {
        await writer.write(raw as unknown as Uint8Array<ArrayBuffer>);
        await writer.close();
      } finally {
        writer.releaseLock();
      }
    })();
    // Los errores del inflado también afloran en el lector; esto solo evita
    // un rejection sin observar si el bucle tira antes por tope.
    pump.catch(() => undefined);
    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > APP_MAX_ZIP_ENTRY_BYTES) {
          throw new Error(
            `ZIP entry inflates too large (${entry.path}: >${APP_MAX_ZIP_ENTRY_BYTES} bytes from ${entry.compressedSize} compressed)`
          );
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    await pump;
    const out = new Uint8Array(total);
    let pos = 0;
    for (const c of chunks) {
      out.set(c, pos);
      pos += c.byteLength;
    }
    return out;
  }
  throw new Error(`Unsupported ZIP compression method ${entry.method} for ${entry.path}`);
}

/**
 * `parseZipArchive` con doble compuerta: topes S6.1 por cabecera (baratos,
 * sin RAM) y luego extracción acotada por entrada (S6.7l: tope real de
 * inflado + tope de total REAL, no declarado). Async porque el inflado
 * acotado es por streaming.
 */
export async function parseZipArchiveCapped(zipBytes: Uint8Array): Promise<ParsedZipEntry[]> {
  const index = indexZipArchive(zipBytes);
  assertZipIndexWithinCaps(index);
  const entries: ParsedZipEntry[] = [];
  let actualTotal = 0;
  for (const item of index) {
    if (item.method !== 0 && item.method !== 8) continue;
    const data = await extractZipEntryCapped(zipBytes, item);
    actualTotal += data.byteLength;
    if (actualTotal > APP_MAX_ZIP_TOTAL_BYTES) {
      throw new Error(
        `ZIP total too large (${actualTotal} actual bytes, max ${APP_MAX_ZIP_TOTAL_BYTES})`
      );
    }
    entries.push({ path: item.path, data });
  }
  return entries;
}
