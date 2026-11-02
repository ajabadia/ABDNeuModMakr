// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Phase 12: Batch Processor Types
// ─────────────────────────────────────────────────────────

import type { Zone, ExtendedRegion, SynthArticulationConfig } from '../types.ts';

export type BatchJobSourceType =
  | 'sf2-preset'
  | 'folder-pack'
  | 'neurondb-legacy'
  | 'auto-slicer'
  | 'loop-rx2';

export type BatchSlicerProfile = 'drums' | 'chromatic' | 'vocals' | 'grid' | 'auto';

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
  /** Fase 23: Target sub-library folder name */
  sublibrary?: string;
  /** Fase 23: Ordinal position within sub-library */
  sublibraryOrdinal?: number;
  /** Fase 25: AutoSlicer profile if candidate is a sliced beat/loop */
  slicerProfile?: BatchSlicerProfile;
  /** Fase 25: Number of valid slices detected */
  detectedSliceCount?: number;
  /** Fase 25: Generated standard MIDI groove pattern (.mid) bytes */
  midiPatternBytes?: Uint8Array;
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
  /** Fase 23: Target sub-library for AxionikDB destination (default: 'Default') */
  destinationSublibrary?: string;
  concurrency?: number;
  /** Fase 25: Discovery ingestion strategy: multi-zone instruments vs individual sliced loops */
  ingestionMode?: 'multisample' | 'slicer';
  /** Fase 25: Slicer profile when processing loops */
  slicerProfile?: BatchSlicerProfile;
  /** Fase 25: Transient detection sensitivity: 0..100 (default: 70) */
  slicerSensitivity?: number;
  /** Fase 25: Magnetize slice boundaries to zero-crossings (default: true) */
  slicerSnapZeroCrossing?: boolean;
  /** Fase 25: Target/detected loop BPM (default: 120) */
  slicerBpm?: number;
  /** Fase 25: Export and package groove MIDI file with model (default: true) */
  exportMidiPattern?: boolean;
  /** Fase 25: Clear GPU VRAM cache between heavy batch stages to prevent OOM (default: true) */
  stagePipelineVramSafety?: boolean;
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
