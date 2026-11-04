// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Pipeline shared contract
//
// WebAudioPipeline keeps the mutable engine state (session, buffers,
// caches). Feature modules receive this context so their bodies can be
// extracted without owning any of that state.
// ─────────────────────────────────────────────────────────

import type { CoreEvent, Session, Zone, ZoneSpectralInspection } from '../types.ts';
import type { SpectralModelData } from '../dsp/GridIndicator.ts';
import type { PreservedSourceBinary } from '../dsp/PipelineRunner.ts';
import type { NeuronAssetStore } from '../storage/NeuronAssetStore.ts';
import type { SessionHistory } from '../sessionHistory.ts';

/** Cached per-zone spectrum / resynthesis payload. */
export interface SpectralCacheEntry {
  key: string;
  inspection: ZoneSpectralInspection;
  resynthMono: Float32Array;
  enhancedMono: Float32Array;
  enhancedModel: SpectralModelData;
  decodedMono: Float32Array;
  decodedSampleRate: number;
  detectedF0Hz: number;
  durationSec: number;
}

/**
 * Mutable engine state shared by every pipeline module. Shared by reference:
 * modules read and write these maps and the active session directly.
 */
export interface PipelineSessionState {
  session: Session | null;
  readonly history: SessionHistory;
  readonly sampleBuffers: Map<string, ArrayBuffer>;
  readonly importedSourceBinaries: Map<string, PreservedSourceBinary & { complexity: number }>;
  readonly assetStore: NeuronAssetStore;
  readonly spectralCache: Map<string, SpectralCacheEntry>;
  readonly ribbonEnvelopeCache: Map<string, number[]>;
}

/** What a pipeline module needs from the engine. */
export interface PipelineContext {
  readonly state: PipelineSessionState;
  emit(event: CoreEvent): void;
  persistToLocalStorage(): void;
  ensureZoneDemoBuffers(zones: Zone[]): void;
}
