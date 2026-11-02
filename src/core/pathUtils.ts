// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Shared Path / File-Name Helpers (DRY)
// Single home for the `basename` / extension / sanitize / size
// idioms previously copy-pasted across `SfzParser`,
// `zoneTemplates`, `sampleNaming`, `timeCapsule`,
// `modelImportService`, `bankService` and the batch modals.
// All helpers are pure and behavior-compatible with the code
// they replace (`/` and `\` separators, `null` -> '').
// ─────────────────────────────────────────────────────────

/** Returns the file name after the last `/` or `\` (or `:` for Kontakt paths). */
export function basename(path: string | null | undefined): string {
  if (!path) return '';
  const norm = path.replace(/\\/g, '/');
  const idx = norm.lastIndexOf('/');
  const afterSlash = idx >= 0 ? norm.slice(idx + 1) : norm;
  // Kontakt-style `volume:sample.wav` — keep behavior of the single
  // `file.split(/[\\/:]/).pop()` call site without affecting others.
  const colon = afterSlash.lastIndexOf(':');
  return colon >= 0 ? afterSlash.slice(colon + 1) || afterSlash : afterSlash || path;
}

/** Lower-cased extension without the dot (`wav`), or `''` when none. */
export function fileExtension(filename: string | null | undefined): string {
  if (!filename) return '';
  const base = basename(filename);
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

/** Makes a string safe for use as a download file name. */
export function sanitizeFileName(name: string, fallback = 'file'): string {
  const clean = (name ?? '').replace(/[^A-Za-z0-9_-]/g, '_');
  return clean || fallback;
}

/** Human size (`512 B`, `1.2 KB`, `3.4 MB`). Replaces the `ZoneInspector` inline version. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** `KB` variant used by cover/telemetry labels (`1.2 KB`). */
export function formatKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)}`;
}