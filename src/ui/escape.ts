// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — HTML & Attribute Sanitization / Escape
// Canonical escaping functions to prevent Stored XSS from
// external model files (mname), folder names, SF2 presets,
// and user-provided metadata strings.
// ─────────────────────────────────────────────────────────

/**
 * Escapes characters with special meaning in HTML text content (&, <, >, ", ').
 */
function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escHtml(str: unknown): string {
  if (str === null || str === undefined) return '';
  return escapeHtmlAttr(String(str));
}

/**
 * Escapes characters for safe inclusion inside HTML attributes (e.g. title="...", alt="...").
 */
export function escAttr(str: unknown): string {
  if (str === null || str === undefined) return '';
  return escapeHtmlAttr(String(str));
}
