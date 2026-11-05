// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Transient-Locked Elastic BPM Conformer (Fase 39.4)
//
// Fase 2: canonical implementation lives in
// `@abdsynths/shared/dsp/slicer-loops/conform.ts` with contracts in
// `@abdsynths/shared/contracts/types/loopSlicer.ts`.
// Thin re-export shim — zero behaviour change.
// ─────────────────────────────────────────────────────────

export { conformLoopToTargetBpm } from '@abdsynths/shared/dsp/slicer-loops/conform.ts';
export type { ConformedLoopResult } from '@abdsynths/shared/contracts/types/loopSlicer.ts';
