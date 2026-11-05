// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — SuperFlux Spectral Novelty & Adaptive Median Threshold
//
// Fase 2: canonical implementation lives in
// `@abdsynths/shared/dsp/slicer-loops/spectralNovelty.ts`.
// Thin re-export shim — zero behaviour change.
// ─────────────────────────────────────────────────────────

export {
  computeSpectralNoveltyCurve,
  computeAdaptiveMedianThreshold,
} from '@abdsynths/shared/dsp/slicer-loops/spectralNovelty.ts';
