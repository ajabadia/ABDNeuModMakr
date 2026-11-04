// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — AI Honesty & Unified Status Contract (Fase 35.4)
//
// Public entry point. The implementation is split by concern:
//   ./honesty/types              — shared contracts
//   ./honesty/status             — canonical AI status indicator
//   ./honesty/actionDeclarations — per-button engine/fallback declarations
//   ./honesty/stemFallback       — consent-gated DSP stem separation
//   ./honesty/stepBadges         — pipeline step engine badges
// ─────────────────────────────────────────────────────────

export * from './honesty/types';
export * from './honesty/status';
export * from './honesty/actionDeclarations';
export * from './honesty/stemFallback';
export * from './honesty/stepBadges';
