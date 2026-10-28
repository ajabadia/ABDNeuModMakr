// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Shared DSP Scalar Helpers (DRY)
//
// Single home for the scalar idioms previously copy-pasted across
// `SpectralAnalyzer`, `ScapeSphereGenerator`, `WebAudioPipeline` and
// `SpectralView`: range clamping and linear-amplitude → dB conversion.
// All helpers are pure and behavior-identical to the code they replace.
// ─────────────────────────────────────────────────────────

/** Clamps `value` into [`lo`, `hi`]. */
export function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/**
 * Linear amplitude → dB (`20 * log10`), with a hard floor.
 * Values at/below `eps` return `floorDb` instead of `-Infinity`.
 * Defaults reproduce the spectrogram convention (`eps = 1e-6`, `-120 dB`).
 */
export function linearToDb(value: number, floorDb = -120, eps = 1e-6): number {
  return value > eps ? 20 * Math.log10(value) : floorDb;
}
