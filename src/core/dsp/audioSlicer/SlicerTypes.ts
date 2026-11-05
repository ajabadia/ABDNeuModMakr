// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — AudioSlicer Types, Constants & Helpers
//
// Fase 2: canonical contracts live in
// `@abdsynths/shared/contracts/types/loopSlicer.ts` (SSOT).
// This module re-exports those contracts, keeps the local
// `DEFAULT_SLICER_OPTIONS` defaults, and keeps the Hartmann
// MIDI note-name display convention (`midiToNoteName` /
// `midiNoteToString`) built on the shared canonical
// `midiNoteToStandardName` (@abdsynths/shared/dsp/take/autoSamplerDsp.ts).
// ─────────────────────────────────────────────────────────

import { midiNoteToStandardName } from '@abdsynths/shared/dsp/take/autoSamplerDsp.ts';
import type { PhonemeWord } from '../../bridge/BridgeClient.ts';
import type { SlicerOptions } from '@abdsynths/shared/contracts/types/loopSlicer.ts';

export type { PhonemeWord };

export type {
  SlicerMode,
  SlicerWorkflowMode,
  GridDivision,
  SlicerOptions,
  DetectedSlice,
  SlicerResult,
  NormalizePeakResult,
  ManualSilenceRange,
  MidiManifestSliceBuildOptions,
} from '@abdsynths/shared/contracts/types/loopSlicer.ts';

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
