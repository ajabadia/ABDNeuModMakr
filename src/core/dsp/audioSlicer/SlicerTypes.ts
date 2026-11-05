// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — AudioSlicer Types, Constants & Helpers
//
// MIDI note name formatters now use the shared canonical
// `midiNoteToStandardName` (@abdsynths/shared/dsp/take/autoSamplerDsp.ts)
// behind a local Hartmann display wrapper. This keeps the zone/slicer UIs on
// the historical Hartmann convention (MIDI 60 -> "C3") and the padded
// numeric form ("60  C3") while eliminating the duplicate pitch constants.
// ─────────────────────────────────────────────────────────

import { midiNoteToStandardName } from '@abdsynths/shared/dsp/take/autoSamplerDsp.ts';
import type { PhonemeWord } from '../../bridge/BridgeClient.ts';

export type { PhonemeWord };

export type SlicerMode = 'drums' | 'chromatic' | 'vocals' | 'grid';
/**
 * Macro-workflow mode for AutoSlicer (Fase 39.4):
 * - `'one_shot_extractor'`: Cuts and maps isolated notes (chromatic scale) or isolated drum hits (note-by-note kit).
 *   BPM / groove tempo controls are conditioned-disabled in the UI.
 * - `'rex_groove_loop'`: Cuts rhythmic drum loops, melodic phrases/riffs, or vocal grooves,
 *   detecting real BPM & bars, extracting the playable MIDI score (.mid), and allowing elastic BPM conforming.
 */
export type SlicerWorkflowMode = 'one_shot_extractor' | 'rex_groove_loop';
export type GridDivision = '1/4' | '1/8' | '1/16' | '1/32';

export interface SlicerOptions {
  /** Macro-workflow mode: 'one_shot_extractor' (isolated notes/hits) vs 'rex_groove_loop' (rhythmic/melodic loop with BPM & MIDI groove) */
  workflowMode?: SlicerWorkflowMode;
  /** Mode: 'drums' (GM Map), 'chromatic' (F0 pitch + equidistant zones), 'vocals' (vocal/phrase segmentation), 'grid' (BPM division) */
  mode: SlicerMode;
  /** Transient attack sensitivity: 0..100 (default: 70) */
  sensitivity: number;
  /** RMS silence gate threshold in dB: -60..-20 (default: -42 dB) */
  silenceThresholdDb: number;
  /** Auto-flag quiet slices as silence (default: true). When false, no slice is marked silence. */
  detectSilences: boolean;
  /** Minimum quiet duration to flag silence, in milliseconds (default: 120) */
  minSilenceMs: number;
  /** Pre-roll safety margin in milliseconds before transient to preserve initial attack (default: 3 ms) */
  preRollMs: number;
  /** Post-roll tail safety margin in milliseconds (default: 8 ms) */
  postRollMs: number;
  /** Magnetize slice boundaries to the nearest rising zero-crossing (default: true) */
  snapZeroCrossing: boolean;
  /** Tempo in BPM for grid slicing or manual source BPM override (default: 120; 0 = auto-detect) */
  bpm: number;
  /** Optional target BPM for Elastic Loop Conforming and MIDI pattern export (default: follows detectedBpm) */
  targetBpm?: number;
  /** Optional bar count override (default: auto-estimated from loop duration & BPM) */
  barCount?: number;
  /** Grid division if mode === 'grid' (default: '1/16') */
  gridDivision: GridDivision;
  /** Allow overlapping key/velocity zones (default: false) */
  allowOverlap: boolean;
  /** Base MIDI note for chromatic sequential mapping (default: 36 C1 or 60 C3) */
  chromaticBaseNote: number;
  /** Minimum slice distance in milliseconds (default: 45ms for drums, 250ms for vocals) */
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
  /** Classified label: e.g. "Bass Drum 1 (36 C1)", "Acoustic Snare (38 D1)", or "Note 60 (C3)" */
  label: string;
  /** Category: 'kick' | 'snare' | 'hihat' | 'tom' | 'cymbal' | 'percussion' | 'chromatic' | 'vocals' | 'grid' | 'silence' */
  category: string;
  /** Sliced PCM audio buffer (mono) */
  pcm: Float32Array;
  /** Optional Phase 37 AutoSampler metadata attached to this slice */
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

export const DEFAULT_SLICER_OPTIONS: SlicerOptions = {
  workflowMode: 'rex_groove_loop',
  mode: 'drums',
  sensitivity: 70,
  silenceThresholdDb: -42,
  detectSilences: true,
  minSilenceMs: 120,
  preRollMs: 3,
  postRollMs: 8,
  snapZeroCrossing: true,
  bpm: 120,
  gridDivision: '1/16',
  allowOverlap: false,
  chromaticBaseNote: 36,
};

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
  /** Automatically measure real F0 in the sustained window (`NoteOn..NoteOff`) and compute analog `detuneCents` (khiner/AutoSampler insight). */
  autoCompensateAnalogDetune?: boolean;
  /** Auto-label unnamed drum hits using `classifyDrumSlice` (default: true when manifest.mode === 'drum_map'). */
  autoClassifyUnnamedDrumHits?: boolean;
  /** Additional latency offset adjustment in milliseconds (`± ms` rescue control). */
  extraLatencyOffsetMs?: number;
}

/**
 * Hartmann MODELmaker v1.2 display formatter for MIDI notes.
 *
 * NOTE name comes from the shared canonical `midiNoteToStandardName`
 * (`@abdsynths/shared/dsp/take/autoSamplerDsp.ts`), which gives scientific pitch
 * notation (e.g. 60 -> "C4", 0 -> "C-1"). The OCTAVE uses the historical
 * Hartmann convention (MIDI 60 -> "C3"), which is one octave lower than the
 * scientific octave embedded in that canonical name.
 *
 * We parse the canonical name generically so the note letter/alteration (e.g.
 * "C", "C#", "A#") is reused from shared even for negative octaves like
 * "C-1" -> Hartmann "C-2".
 */
export function midiToNoteName(midi: number): string {
  if (midi < 0 || midi > 127) return '';
  const standard = midiNoteToStandardName(midi); // e.g. "C4", "C-1", "A#-1", "G9"
  const parsed = standard.match(/^([A-G][#b]?)(-?\d+)$/);
  if (!parsed) {
    // Fallback should be extremely rare; fall back to a direct Hartmann label
    // based on the MIDI number itself so we never return a malformed label.
    const pc = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][midi % 12];
    return `${pc}${Math.floor(midi / 12) - 2}`;
  }
  const noteName = parsed[1];
  const canonicalOctave = Number(parsed[2]);
  const hartmannOctave = canonicalOctave - 1;
  return `${noteName}${hartmannOctave}`;
}

/**
 * Canonical Hartmann MODELmaker v1.2 `NeuronApp.midiNoteToString(int)` formatter
 * (`"0   C-2"`, `"60  C3"`, `"127 G8"`). Returns `""` if `midi < 0 || midi > 127`.
 */
export function midiNoteToString(midi: number): string {
  if (midi < 0 || midi > 127) return '';
  const pad = midi < 10 ? '   ' : midi < 100 ? '  ' : ' ';
  return `${midi}${pad}${midiToNoteName(midi)}`;
}
