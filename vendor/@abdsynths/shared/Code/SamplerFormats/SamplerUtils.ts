// ─────────────────────────────────────────────────────────
// @abdsynths/shared — Pure Sampler Math & Path Utilities
// ─────────────────────────────────────────────────────────

/** Clamp `value` into `[min, max]`. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Round `value` to nearest integer and clamp into `[min, max]`. */
export function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

/** Returns the file name after the last `/` or `\` (or `:` for Kontakt paths). */
export function basename(path: string | null | undefined): string {
  if (!path) return '';
  const norm = path.replace(/\\/g, '/');
  const idx = norm.lastIndexOf('/');
  const afterSlash = idx >= 0 ? norm.slice(idx + 1) : norm;
  const colon = afterSlash.lastIndexOf(':');
  return colon >= 0 ? afterSlash.slice(colon + 1) || afterSlash : afterSlash || path;
}

/** Extract the lowercase file extension without the leading dot (e.g. `'wav'`). */
export function fileExtension(filename: string): string {
  const base = basename(filename);
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** Convert decibels to linear amplitude factor (`10^(dB / 20)`). */
export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

/** Convert linear amplitude factor to decibels (`20 * log10(gain)`). */
export function linearToDb(gain: number, minDb = -96): number {
  if (gain <= 0.00001) return minDb;
  return Math.max(minDb, 20 * Math.log10(gain));
}
