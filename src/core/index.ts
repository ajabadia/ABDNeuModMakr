// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Core Module Entry Point
// Decoupled architecture: exports contracts, types and factory
// ─────────────────────────────────────────────────────────

export * from './types.ts';
export * from './CoreService.ts';
export { WebAudioPipeline, PARAMETER_SETS } from './WebAudioPipeline.ts';

import type { CoreService } from './CoreService.ts';
import { WebAudioPipeline } from './WebAudioPipeline.ts';

/**
 * Factory function creating a CoreService instance.
 * Decouples the UI and application entry points from concrete DSP engine implementations.
 */
export function createCoreService(): CoreService {
  return new WebAudioPipeline();
}
