/**
 * ABDShared — Utils/number.js
 *
 * Canonical numeric helpers shared by every WebUI component.
 * Import from here instead of redefining one-line clamps per file.
 */

/**
 * Clamps any value into the 0..1 range.
 *
 * Non-finite inputs (NaN, ±Infinity, undefined, non-numeric junk) resolve to
 * `fallback` (default 0) instead of leaking NaN through knobs, sliders,
 * envelopes and MIDI mappings.
 *
 * @param {any} v Value to clamp.
 * @param {number} [fallback=0] Replacement used for non-finite input.
 * @returns {number} Value in [0, 1].
 */
export function clamp01(v, fallback = 0) {
  const n = Number.isFinite(v) ? v : fallback;
  return Math.min(1, Math.max(0, n));
}
