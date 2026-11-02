// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Shared Blob Download Helper (DRY)
// Single home for the `createObjectURL / <a>.click() / revoke`
// idiom cloned across `menuActions`, `bankService` and the
// export modals. No-op outside the browser (tests / SSR).
// ─────────────────────────────────────────────────────────

/** Triggers a browser download of `blob` as `filename`. */
export function downloadBlob(blob: Blob, filename: string, mime?: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const url = URL.createObjectURL(mime ? new Blob([blob], { type: mime }) : blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Builds a `Blob` from bytes/text and downloads it. */
export function downloadBytes(data: BlobPart, filename: string, mime: string): void {
  downloadBlob(new Blob([data], { type: mime }), filename);
}