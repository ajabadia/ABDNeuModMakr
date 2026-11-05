/**
 * @abdsynths/shared — Contracts/types/loopSlicer.ts
 * =========================================================================
 * Canonical Slicing & Loops contracts (SSOT) for the ABDSynths suite
 * (ABDNeuModMakr AutoSlicer / Loop Editor, ABDAxionikVS, …).
 *
 * Fase 2 — DSP contract extraction:
 *   - `LoopMode` / `CrossfadeCurve` remain canonically defined in
 *     `Code/SamplerFormats/SamplerTypes.ts` (multi-format SSOT) and are
 *     re-exported here type-only for DSP consumers.
 *   - Everything else in this file is the canonical shape copied verbatim
 *     from `ABDNeuModMakr/src/core/dsp/*` so local modules can delegate
 *     without behaviour drift. No DOM, no WebAudio, no bridge imports.
 */

import type {
  LoopMode,
  CrossfadeCurve,
} from '../../Code/SamplerFormats/SamplerTypes.ts';

export type { LoopMode, CrossfadeCurve };

export const LOOP_SLICER_CONTRACT_VERSION = '1.0.0';

/** Fase 13 — Auto-Loop search & seam smoothing algorithms. */
export type AutoLoopAlgorithm =
  | 'pitch_periodic'
  | 'ncc_zc'
  | 'min_seam_energy'
  | 'equal_power_xfade';

export interface AutoLoopOptions {
  algorithm?: AutoLoopAlgorithm;
  /** Relative start search range (default 0.15 .. 0.45 of total length) */
  searchStartRatio?: number;
  /** Relative end search range (default 0.60 .. 0.92 of total length) */
  searchEndRatio?: number;
  candidateStartFrame?: number;
  candidateEndFrame?: number;
  knownF0Hz?: number;
  targetCrossfadeMs?: number;
  crossfadeCurve?: CrossfadeCurve;
}

export interface AutoLoopResult {
  loopStart: number;
  loopEnd: number;
  loopCrossfadeMs: number;
  algorithm: AutoLoopAlgorithm;
  qualityPercent: number; // 0..100%
  stepDiscontinuity: number;
  slopeDiscontinuity: number;
  nccScore: number;
  detectedPitchHz?: number;
  periodFrames?: number;
  cyclesCount?: number;
  rationale: string;
}

export type SlicerMode = 'drums' | 'chromatic' | 'vocals' | 'grid';

/**
 * Macro-workflow mode for AutoSlicer:
 * - `'one_shot_extractor'`: isolated notes / drum hits.
 * - `'rex_groove_loop'`: rhythmic/melodic loop with BPM & MIDI groove.
 */
export type SlicerWorkflowMode = 'one_shot_extractor' | 'rex_groove_loop';

export type GridDivision = '1/4' | '1/8' | '1/16' | '1/32';

export interface SlicerOptions {
  /** Macro-workflow mode (default follows local DEFAULT_SLICER_OPTIONS) */
  workflowMode?: SlicerWorkflowMode;
  /** Mode: 'drums' | 'chromatic' | 'vocals' | 'grid' */
  mode: SlicerMode;
  /** Transient attack sensitivity: 0..100 */
  sensitivity: number;
  /** RMS silence gate threshold in dB: -60..-20 */
  silenceThresholdDb: number;
  /** Auto-flag quiet slices as silence */
  detectSilences: boolean;
  /** Minimum quiet duration to flag silence, in milliseconds */
  minSilenceMs: number;
  /** Pre-roll safety margin in ms before transient */
  preRollMs: number;
  /** Post-roll tail safety margin in ms */
  postRollMs: number;
  /** Magnetize slice boundaries to the nearest rising zero-crossing */
  snapZeroCrossing: boolean;
  /** Tempo in BPM for grid slicing or manual source override (0 = auto-detect) */
  bpm: number;
  /** Optional target BPM for elastic conforming (default: follows detectedBpm) */
  targetBpm?: number;
  /** Optional bar count override */
  barCount?: number;
  /** Grid division if mode === 'grid' */
  gridDivision: GridDivision;
  /** Allow overlapping key/velocity zones */
  allowOverlap: boolean;
  /** Base MIDI note for chromatic sequential mapping */
  chromaticBaseNote: number;
  /** Minimum slice distance in milliseconds */
  minSliceMs?: number;
  /** Custom phonetic/semantic words from Whisper-tiny alignment */
  phoneticWords?: Array<{ word: string; startFrame: number; endFrame: number; confidence?: number }>;
}

export interface DetectedSlice {
  id: string;
  index: number;
  startFrame: number;
  endFrame: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  rmsDb: number;
  peakDb: number;
  isSilence: boolean;
  /** Estimated fundamental frequency in Hz (if tonal) */
  f0Hz?: number;
  /** Assigned target MIDI Root Key */
  rootKey: number;
  /** Assigned target MIDI Low Key */
  lowKey: number;
  /** Assigned target MIDI High Key */
  highKey: number;
  /** Assigned Velocity Range [1..127] */
  lowVel: number;
  highVel: number;
  /** Classified label, e.g. "Bass Drum 1 (36 C1)" */
  label: string;
  /** Category */
  category: string;
  /** Sliced PCM audio buffer (mono) */
  pcm: Float32Array;
  /** Optional AutoSampler metadata attached to this slice */
  noteOffOffsetFrame?: number;
  loopStartFrame?: number;
  loopEndFrame?: number;
  detuneCents?: number;
  muteGroup?: number;
  roundRobinIndex?: number;
}

export interface SlicerResult {
  workflowMode?: SlicerWorkflowMode;
  slices: DetectedSlice[];
  totalSlices: number;
  validSlicesCount: number;
  silenceSlicesCount: number;
  detectedBpm: number;
  detectedBars?: number;
  bpmConfidence?: number;
  targetBpm?: number;
  sampleRate: number;
  totalDurationSec: number;
  midiFileBuffer: Uint8Array;
}

export interface NormalizePeakResult {
  /** New peak-normalized buffer (input is never mutated) */
  pcm: Float32Array;
  /** Gain actually applied, in dB (0 when input is digital silence) */
  appliedGainDb: number;
  /** Peak of the input, in dBFS */
  inputPeakDb: number;
}

export interface ManualSilenceRange {
  start: number;
  end: number;
}

export interface MidiManifestSliceBuildOptions {
  /** Snap slice start/end frames to nearest rising zero-crossing (default: true). */
  snapZeroCrossing?: boolean;
  /** Trim residual trailing silence inside each slice (default: true). */
  trimTrailingSilence?: boolean;
  /** Silence gate threshold in dBFS for trailing trim (default: -60 dB). */
  silenceThresholdDb?: number;
  /** Measure real F0 in [NoteOn..NoteOff] and compute analog detuneCents. */
  autoCompensateAnalogDetune?: boolean;
  /** Auto-label unnamed drum hits via classifyDrumSlice (default: true). */
  autoClassifyUnnamedDrumHits?: boolean;
  /** Additional latency offset adjustment in milliseconds. */
  extraLatencyOffsetMs?: number;
}

export interface LoopSeamAnalysis {
  /** Window size in frames */
  windowFrames: number;
  /** Samples [loopEnd - windowFrames .. loopEnd - 1] */
  preEndSamples: Float32Array;
  /** Samples [loopStart .. loopStart + windowFrames - 1] */
  postStartSamples: Float32Array;
  /** Ghost continuation [loopEnd .. loopEnd + windowFrames - 1] */
  ghostPostEndSamples: Float32Array;
  /** Ghost pre-history [loopStart - windowFrames .. loopStart - 1] */
  ghostPreStartSamples: Float32Array;
  /** Absolute amplitude jump at the seam (0 = perfect level match) */
  stepDiscontinuity: number;
  /** First-derivative slope difference across the seam */
  slopeDiscontinuity: number;
  /** Normalized Cross-Correlation (-1..+1) */
  nccScore: number;
  /** Overall click-free seam quality score (0..100%) */
  seamQualityPercent: number;
}

export interface SilenceInterval {
  startFrame: number;
  endFrame: number;
}

export interface ConformedLoopResult {
  /** Continuous mono PCM conformed to `targetBpm` with transients preserved */
  pcm: Float32Array;
  sampleRate: number;
  durationSec: number;
  sourceBpm: number;
  targetBpm: number;
  barCount: number;
}

/**
 * Fase 3 — result of `findOptimalZeroCrossingLoop`
 * (rising zero-crossing search + NCC seam match).
 */
export interface ZeroCrossingLoopSearchResult {
  loopStart: number;
  loopEnd: number;
  /** Normalized correlation mapped to 0..1 */
  zeroCrossingCorrelation: number;
}
