// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — HTML & Attribute Sanitization / Escape
// Canonical escaping functions to prevent Stored XSS from
// external model files (mname), folder names, SF2 presets,
// and user-provided metadata strings.
// ─────────────────────────────────────────────────────────

/**
 * Escapes characters with special meaning in HTML text content (&, <, >, ", ').
 */
export function escHtml(str: unknown): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escapes characters for safe inclusion inside HTML attributes (e.g. title="...", alt="...").
 */
export function escAttr(str: unknown): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
