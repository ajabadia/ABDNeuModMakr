// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Pure TypeScript PKZIP Archive
// Re-exported from @abdsynths/shared/formats/neuron as single source of truth.
// ─────────────────────────────────────────────────────────

export * from '@abdsynths/shared/formats/neuron';

import {
  indexZipArchive,
  parseZipArchive,
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
 * `parseZipArchive` con compuerta S6.1: primero topes por cabecera
 * (O(índice), sin RAM), luego el parser del vendor (sus propios topes
 * mayores siguen aplicando como segunda red).
 */
export function parseZipArchiveCapped(zipBytes: Uint8Array): ParsedZipEntry[] {
  assertZipIndexWithinCaps(indexZipArchive(zipBytes));
  return parseZipArchive(zipBytes);
}
