// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Phase 12: Batch Processor Types
// ─────────────────────────────────────────────────────────

import type { Zone, ExtendedRegion, SynthArticulationConfig } from '../types.ts';

export type BatchJobSourceType = 'sf2-preset' | 'folder-pack' | 'neurondb-legacy';

export type BatchJobStatus =
  | 'idle'
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'skipped';

export interface BatchAudioFile {
  name: string;
  buffer: ArrayBuffer;
}

/**
 * Discovered model candidate before or during batch processing.
 */
export interface BatchModelCandidate {
  id: string;
  name: string;
  slug: string;
  sourceType: BatchJobSourceType;
  sourceOrigin: string; // File name, folder path, or SoundFont name
  presetIndex?: number;
  bankIndex?: number;
  zoneCount: number;
  detectedCategory: string;
  suggestedParameterSet: number;
  suggestedComplexity: number;
  status: BatchJobStatus;
  progressPct: number;
  error?: string;
  durationMs?: number;
  qualityScore?: number;
  /** Audio files or pre-parsed zones needed for pipeline analysis */
  files: BatchAudioFile[];
  classicZones?: Zone[];
  extendedRegions?: ExtendedRegion[];
  articulation?: SynthArticulationConfig;
}

export type BatchComplexityStrategy = 'auto' | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export type BatchDestination = 'axionikdb' | 'zip-master' | 'neurondb';

export interface BatchConfig {
  targetFormat: 'dual' | 'legacy-neuron' | 'modern-neural';
  destination: BatchDestination;
  complexityStrategy: BatchComplexityStrategy;
  dspAlgorithm: 'legacy' | 'enhanced';
  autoAcousticClassification: boolean;
  outputMasterZipName?: string;
  axionikDbPath?: string;
  neuronDbPath?: string;
  concurrency?: number;
}

export interface BatchProgressState {
  status: 'idle' | 'running' | 'paused' | 'completed' | 'cancelled';
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  skippedJobs: number;
  currentJobIndex: number;
  currentJobName: string;
  currentJobPct: number;
  overallPct: number;
  elapsedMs: number;
  estimatedRemainingMs: number;
}

export interface BatchResultSummary {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  totalDurationMs: number;
  jobs: BatchModelCandidate[];
  masterZipBytes?: Uint8Array;
}
