// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Shared Async Helpers (DRY)
// `delay` (real wait) vs `yieldToUI` (let the browser paint a
// spinner before a heavy import). Replaces the half-dozen
// `await new Promise((r) => setTimeout(r, N))` clones.
// ─────────────────────────────────────────────────────────

/** Real wait of `ms` milliseconds. */
export function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Yield to the event loop so pending paint / loading modal shows. */
export function yieldToUI(ms = 16): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}