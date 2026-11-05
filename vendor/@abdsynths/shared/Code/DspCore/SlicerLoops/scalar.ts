/**
 * @abdsynths/shared — Code/DspCore/SlicerLoops/scalar.ts
 * =========================================================================
 * Shared scalar DSP helpers (SSOT). Verbatim extraction from
 * `ABDNeuModMakr/src/core/dsp/DspMath.ts`.
 *
 * Pure, zero dependencies, runnable in browsers, Node and C++ ports.
 */

/** Clamps `value` into [`lo`, `hi`]. */
export function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/** Clamps `Math.round(value)` into [`lo`, `hi`] (integer variant). */
export function clampInt(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(value)));
}

/**
 * Linear amplitude → dB (`20 * log10`), with a hard floor.
 * Values at/below `eps` return `floorDb` instead of `-Infinity`.
 */
export function linearToDb(value: number, floorDb = -120, eps = 1e-6): number {
  return value > eps ? 20 * Math.log10(value) : floorDb;
}
