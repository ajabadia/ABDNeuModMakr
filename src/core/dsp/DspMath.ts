// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Shared DSP Scalar Helpers (DRY)
//
// Fase 2: canonical implementation lives in
// `@abdsynths/shared/dsp/slicer-loops/scalar.ts`.
// This module is a thin re-export shim so existing imports keep working
// with zero behaviour change.
// ─────────────────────────────────────────────────────────

export {
  clamp,
  clampInt,
  linearToDb,
} from '@abdsynths/shared/dsp/slicer-loops/scalar.ts';
