// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Phase 37.4 & 37.6: Pure MIDI AutoSampler Session Controller
//
// Orchestrates:
//   1. Parametric Auto-Sweep (`auto_sweep` & `drum_map`)
//   2. Live MIDI Keyboard Capture (`live_midi_capture`, AutoSimpler style)
//   3. Release-tail policies (`auto_decay` to noise floor vs `fixed_time`)
//   4. Pause / Resume Interrupted Sweep & Single-Cell Re-Take (`retryIndices`)
//   5. Continuous-Take Pre-Slice Cleaning (`dcBlock` + `reduceNoiseWithProfile`)
//      + Deterministic Slicing (`buildSlicesFromMidiManifest`)
//      + Sustain-Bounded AutoLoop (`NoteOn..NoteOff`)
//   6. Non-destructive WAV RIFF `atem` manifest embedding & extraction so a
//      recorded take never loses its MIDI events even if re-parsed later.
// ─────────────────────────────────────────────────────────

import {
  dcBlock,
  peakAmplitude,
  evaluateReleaseTailDecay,
  capturePreRollNoiseProfile,
  measureMidiToAudioLatency,
  generateSweepSchedule,
  normalizeLiveCapturedMidiEvents,
  analyzePilotNoteResponse,
  createMidiAutoSampleManifest,
  type NoiseProfile,
  type NotesPerOctaveOption,
  type PilotNoteRecommendation,
} from '@abdsynths/shared/dsp/take';
import type {
  AutoSamplerCaptureMode,
  AutoSamplerReleaseMode,
  AutoSamplerVelocityCurve,
  MidiAutoSampleManifest,
  MidiCapturedNoteEvent,
} from '@abdsynths/shared/contracts/recordingSession';
import {
  reduceNoiseWithProfile,
} from '@abdsynths/shared/dsp/take/NoiseReductionDsp.ts';
import {
  buildSlicesFromMidiManifest,
  type DetectedSlice,
  type SlicerResult,
} from '../dsp/AudioSlicerEngine.ts';
import { computeBatchAutoLoopForZones } from '../dsp/LoopEditorTools.ts';
import { encodePcm16Wav } from '../dsp/WavDecoder.ts';
import type { Zone, ExtendedRegion, MidiNote } from '../types.ts';
import {
  FACTORY_DRUM_MAP_PRESETS,
  type ParsedDrumHitMap,
} from './drumMapParser.ts';

function toFullNoiseProfile(
  np:
    | { levelDbfs: number; spectrumBands: number[]; hum50HzDb?: number; hum60HzDb?: number }
    | undefined
): NoiseProfile | undefined {
  if (!np) return undefined;
  return {
    levelDbfs: np.levelDbfs,
    spectrumBands: [...np.spectrumBands],
    hum50HzDb: np.hum50HzDb ?? -Infinity,
    hum60HzDb: np.hum60HzDb ?? -Infinity,
  };
}

export interface AutoSamplerConfig {
  mode: AutoSamplerCaptureMode;
  midiChannel: number; // 1..16
  startOctave: number; // 0..6 (C0=12 .. C6=84)
  octaveCount: number; // 1..7
  notesPerOctave: NotesPerOctaveOption; // 1, 2, 3, 4, 6, 12
  velocityLayers: number; // 1..8
  velocityCurve: AutoSamplerVelocityCurve;
  manualVelocities: number[]; // e.g. [40, 85, 127]
  roundRobinCount: number; // 1..4
  gateDurationMs: number; // e.g. 1200 ms
  releaseMode: AutoSamplerReleaseMode; // 'auto_decay' | 'fixed_time'
  maxReleaseMs: number; // e.g. 2000 ms (or fixed release duration)
  cleanBeforeSlice: boolean; // dcBlock + Noise Print spectral subtraction on continuous take
  autoLoopSustained: boolean; // compute AutoLoop strictly inside [NoteOn..NoteOff]
  autoCompensateAnalogDetune: boolean; // khiner/AutoSampler F0 cent drift compensation
  extendToFullKeybed: boolean; // 0..127 contiguous
  calibratedLatencyMs: number; // RTL measured by Pilot Note (automatically compensated)
  calibratedLatencySamples: number; // RTL in samples measured by Pilot Note
  extraLatencyOffsetMs: number; // manual rescue offset (± ms)
  drumMap?: ParsedDrumHitMap | null;
}

export const DEFAULT_AUTOSAMPLER_CONFIG: AutoSamplerConfig = {
  mode: 'auto_sweep',
  midiChannel: 1,
  startOctave: 2, // C2 (MIDI 36)
  octaveCount: 3, // C2..C5
  notesPerOctave: 4, // every 3 semitones (C, D#, F#, A)
  velocityLayers: 2,
  velocityCurve: 'classic_neuron_2layer',
  manualVelocities: [60, 120],
  roundRobinCount: 1,
  gateDurationMs: 1200,
  releaseMode: 'auto_decay',
  maxReleaseMs: 1800,
  cleanBeforeSlice: true,
  autoLoopSustained: true,
  autoCompensateAnalogDetune: true,
  extendToFullKeybed: true,
  calibratedLatencyMs: 0,
  calibratedLatencySamples: 0,
  extraLatencyOffsetMs: 0,
  drumMap: null,
};

/**
 * Applies the measured RTL (`latencyMs` & `latencySamples`) and, optionally,
 * the envelope/velocity recommendations from `analyzePilotNoteResponse` into
 * `AutoSamplerConfig`.
 */
export function applyPilotRecommendationToConfig(
  config: AutoSamplerConfig,
  diag: PilotNoteRecommendation,
  options: { applyEnvelopeAndVelocity?: boolean } = { applyEnvelopeAndVelocity: true }
): AutoSamplerConfig {
  const next: AutoSamplerConfig = {
    ...config,
    calibratedLatencyMs: diag.latencyMs,
    calibratedLatencySamples: diag.latencySamples,
  };
  if (options.applyEnvelopeAndVelocity !== false) {
    next.gateDurationMs = diag.recommendedGateDurationMs;
    next.maxReleaseMs = diag.recommendedMaxReleaseMs;
    next.velocityLayers = diag.recommendedVelocityLayers;
    next.velocityCurve = diag.recommendedVelocityCurve;
  }
  return next;
}

export interface ManualVelocityValidationResult {
  valid: boolean;
  errors: string[];
  errorMessage?: string;
  duplicateIndices: number[];
  outOfRangeIndices: number[];
  unsorted: boolean;
  /** Cleaned, sorted, duplicate-free list in 1..127 ready for auto-fix. */
  sanitized: number[];
  sanitizedVelocities: number[];
}

/**
 * Validates a manual velocity list:
 * - Each value must be an integer in `1..127` (0 in MIDI NoteOn means NoteOff).
 * - No two layers may have the same velocity (no duplicates).
 */
export function validateManualVelocities(velocities: number[]): ManualVelocityValidationResult {
  const errors: string[] = [];
  const duplicateIndices: number[] = [];
  const outOfRangeIndices: number[] = [];
  const seen = new Map<number, number>();
  let unsorted = false;

  for (let i = 0; i < velocities.length; i++) {
    const raw = velocities[i];
    const v = Math.round(raw);
    if (!Number.isFinite(raw) || v < 1 || v > 127) {
      outOfRangeIndices.push(i);
    } else {
      if (seen.has(v)) {
        const firstIdx = seen.get(v)!;
        if (!duplicateIndices.includes(firstIdx)) duplicateIndices.push(firstIdx);
        duplicateIndices.push(i);
      } else {
        seen.set(v, i);
      }
    }
    if (i > 0 && v < Math.round(velocities[i - 1])) {
      unsorted = true;
    }
  }

  if (outOfRangeIndices.length > 0) {
    errors.push(
      `Valor fuera de rango MIDI (1..127) en capa(s) ${outOfRangeIndices.map((idx) => `L${idx + 1}`).join(', ')}. Nota: velocidad 0 en MIDI equivale a NoteOff.`
    );
  }
  if (duplicateIndices.length > 0) {
    errors.push(
      `Velocidades repetidas en capa(s) ${duplicateIndices.map((idx) => `L${idx + 1}`).join(', ')}. Cada capa debe tener una velocidad única.`
    );
  }

  // Build sanitized duplicate-free sorted list of the same length (1..8)
  const targetLen = Math.max(1, Math.min(8, velocities.length || 1));
  const used = new Set<number>();
  const sanitized: number[] = [];
  for (const raw of velocities) {
    let candidate = Math.max(1, Math.min(127, Math.round(Number.isFinite(raw) ? raw : 100)));
    while (used.has(candidate) && candidate < 127) candidate += 1;
    while (used.has(candidate) && candidate > 1) candidate -= 1;
    if (!used.has(candidate)) {
      used.add(candidate);
      sanitized.push(candidate);
    }
  }
  while (sanitized.length < targetLen) {
    let candidate = Math.min(127, Math.round(((sanitized.length + 1) / targetLen) * 120) + 7);
    while (used.has(candidate) && candidate > 1) candidate -= 1;
    while (used.has(candidate) && candidate < 127) candidate += 1;
    used.add(candidate);
    sanitized.push(candidate);
  }
  sanitized.sort((a, b) => a - b);

  return {
    valid: errors.length === 0,
    errors,
    ...(errors.length > 0 ? { errorMessage: errors.join(' · ') } : {}),
    duplicateIndices,
    outOfRangeIndices,
    unsorted,
    sanitized,
    sanitizedVelocities: sanitized,
  };
}

/**
 * Resizes a manual velocity array to `targetCount` (1..8) without duplicates.
 */
export function resizeManualVelocityList(current: number[], targetCount: number): number[] {
  const count = Math.max(1, Math.min(8, Math.round(targetCount)));
  if (count === current.length) return [...current];
  if (count < current.length) {
    return current.slice(0, count);
  }
  const next = [...current];
  const used = new Set(next.map((v) => Math.max(1, Math.min(127, Math.round(v)))));
  while (next.length < count) {
    const last = next.length > 0 ? next[next.length - 1] : 40;
    let candidate = Math.min(127, last + Math.max(8, Math.round((127 - last) / (count - next.length + 1))));
    if (used.has(candidate)) {
      for (let step = 1; step <= 127; step++) {
        if (candidate + step <= 127 && !used.has(candidate + step)) {
          candidate = candidate + step;
          break;
        }
        if (candidate - step >= 1 && !used.has(candidate - step)) {
          candidate = candidate - step;
          break;
        }
      }
    }
    used.add(candidate);
    next.push(candidate);
  }
  return next;
}

/**
 * Returns the maximum number of octaves (`1..7`) that fit within MIDI `0..127`
 * starting from `startOctave` (`C0 = 12 .. C6 = 84`).
 */
export function getMaxOctavesForStartOctave(startOctave: number): number {
  const startMidi = Math.max(0, Math.min(120, (Math.round(startOctave) + 1) * 12));
  return Math.max(1, Math.min(7, Math.floor((128 - startMidi) / 12)));
}

export type CoherenceChangeField =
  | 'velocityLayers'
  | 'velocityCurve'
  | 'manualVelocities'
  | 'startOctave'
  | 'octaveCount';

export interface CoherenceMutationInput {
  changedField?: CoherenceChangeField;
  newStartOctave?: number;
  newOctaveCount?: number;
  newVelocityLayers?: number;
  newVelocityCurve?: AutoSamplerVelocityCurve;
  newManualVelocities?: number[];
}

/**
 * Enforces cross-parameter coherence on `AutoSamplerConfig`:
 *  1. `classic_neuron_2layer`: strictly 2 layers (`v60 / v120`).
 *     - If the user selected `classic_neuron_2layer`, forces `velocityLayers = 2`.
 *     - If the user changed `velocityLayers` to `!= 2` while on `classic_neuron_2layer`,
 *       switches `velocityCurve` to `'linear'` (or single-layer) and returns a notice.
 *  2. `velocityLayers === 1`: a multi-point curve (`linear`, `high_precision`, `low_precision`)
 *     cannot distribute 1 point; if the user explicitly picked a multi-layer curve while
 *     at 1 layer, bumps `velocityLayers` to 2 (for `classic_neuron_2layer`) or 3.
 *  3. `manual_table`: keeps `velocityLayers === manualVelocities.length` in sync.
 *  4. `startOctave` + `octaveCount`: clamps `octaveCount` so sampled notes never exceed MIDI 127.
 */
export function enforceAutoSamplerConfigCoherence(
  config: AutoSamplerConfig,
  mutation?: CoherenceChangeField | CoherenceMutationInput
): { config: AutoSamplerConfig; notice?: string; adjustmentNote?: string } {
  const mutObj: CoherenceMutationInput =
    typeof mutation === 'string' ? { changedField: mutation } : (mutation ?? {});
  const changedField = mutObj.changedField;

  const next: AutoSamplerConfig = {
    ...config,
    manualVelocities: [...(mutObj.newManualVelocities ?? config.manualVelocities)],
    ...(mutObj.newStartOctave !== undefined ? { startOctave: mutObj.newStartOctave } : {}),
    ...(mutObj.newOctaveCount !== undefined ? { octaveCount: mutObj.newOctaveCount } : {}),
    ...(mutObj.newVelocityLayers !== undefined ? { velocityLayers: mutObj.newVelocityLayers } : {}),
    ...(mutObj.newVelocityCurve !== undefined ? { velocityCurve: mutObj.newVelocityCurve } : {}),
  };
  let notice: string | undefined;

  // 1. Octave range coherence (MIDI 0..127)
  next.startOctave = Math.max(0, Math.min(6, Math.round(next.startOctave)));
  const maxOct = getMaxOctavesForStartOctave(next.startOctave);
  if (next.octaveCount > maxOct) {
    next.octaveCount = maxOct;
    notice = `Desde C${next.startOctave} caben como máximo ${maxOct} octavas dentro del rango MIDI (0..127).`;
  } else {
    next.octaveCount = Math.max(1, Math.min(maxOct, Math.round(next.octaveCount)));
  }

  // 2. Velocity layers & curve coherence
  next.velocityLayers = Math.max(1, Math.min(8, Math.round(next.velocityLayers)));

  if (changedField === 'velocityCurve') {
    if (next.velocityCurve === 'classic_neuron_2layer' && next.velocityLayers !== 2) {
      next.velocityLayers = 2;
      notice = 'Clásica Neuron fijada automáticamente a 2 capas de velocidad (v60 / v120).';
    } else if (
      (next.velocityCurve === 'linear' ||
        next.velocityCurve === 'high_precision' ||
        next.velocityCurve === 'low_precision') &&
      next.velocityLayers < 2
    ) {
      next.velocityLayers = 3;
      notice = 'Las curvas de distribución requieren al menos 2 capas; ajustado a 3 capas.';
    } else if (next.velocityCurve === 'manual_table') {
      if (next.manualVelocities.length === 0) {
        next.manualVelocities = [60, 120];
      }
      next.velocityLayers = next.manualVelocities.length;
    }
  } else if (changedField === 'velocityLayers') {
    if (next.velocityCurve === 'classic_neuron_2layer' && next.velocityLayers !== 2) {
      next.velocityCurve = 'linear';
      notice =
        next.velocityLayers === 1
          ? 'Con 1 sola capa se desactiva Clásica Neuron (2 capas) y se usa velocidad única (v127).'
          : `Clásica Neuron es exclusiva de 2 capas; al elegir ${next.velocityLayers} capas se cambia a curva Lineal.`;
    } else if (next.velocityCurve === 'manual_table') {
      next.manualVelocities = resizeManualVelocityList(next.manualVelocities, next.velocityLayers);
    }
  } else if (changedField === 'manualVelocities') {
    next.velocityCurve = 'manual_table';
    next.velocityLayers = Math.max(1, Math.min(8, next.manualVelocities.length));
  } else {
    if (next.velocityCurve === 'classic_neuron_2layer') {
      next.velocityLayers = 2;
    } else if (next.velocityCurve === 'manual_table') {
      if (next.manualVelocities.length === 0) {
        next.manualVelocities = [100];
      }
      next.velocityLayers = next.manualVelocities.length;
    }
  }

  return {
    config: next,
    ...(notice ? { notice, adjustmentNote: notice } : {}),
  };
}

export interface AutoSamplerProcessedOutput {
  manifest: MidiAutoSampleManifest;
  cleanedMonoPcm: Float32Array;
  slicerResult: SlicerResult;
  classicZones: Zone[];
  extendedRegions: ExtendedRegion[];
  audioBuffers: Map<string, ArrayBuffer>;
}

/**
 * Builds the initial or updated schedule of `MidiCapturedNoteEvent` cells
 * from `AutoSamplerConfig`.
 * - In `live_midi_capture` mode, returns `[]` because notes & velocities are
 *   captured dynamically as the musician plays in real time.
 * - In `drum_map` mode, uses the loaded drum map (or defaults to `tr808_909`).
 */
export function buildScheduleFromConfig(config: AutoSamplerConfig): MidiCapturedNoteEvent[] {
  if (config.mode === 'live_midi_capture') {
    return [];
  }
  const activeDrumMap =
    config.mode === 'drum_map'
      ? config.drumMap && config.drumMap.hits.length > 0
        ? config.drumMap
        : FACTORY_DRUM_MAP_PRESETS.tr808_909
      : null;

  return generateSweepSchedule({
    startOctave: config.startOctave,
    octaveCount: config.octaveCount,
    notesPerOctave: config.notesPerOctave,
    velocityConfig: {
      layerCount: config.velocityLayers,
      curve: config.velocityCurve,
      manualVelocities: config.manualVelocities,
    },
    roundRobinCount: config.roundRobinCount,
    extendToFullKeybed: config.extendToFullKeybed,
    ...(activeDrumMap
      ? {
          explicitHits: activeDrumMap.hits.map((h) => ({
            midiNote: h.midiNote,
            name: h.name,
            muteGroup: h.muteGroup,
            velocities: h.velocities ?? activeDrumMap.defaultVelocities,
          })),
        }
      : {}),
  });
}

/**
 * Phase 37.5 — Resume / Retry helper:
 * Returns indices of events that have not yet been recorded (`'pending' | 'failed'`),
 * or a specific single cell index when re-recording one cell from the X/Y Grid.
 */
export function getPendingOrFailedEventIndices(
  manifest: MidiAutoSampleManifest,
  specificCellIndex?: number
): number[] {
  if (
    specificCellIndex !== undefined &&
    specificCellIndex >= 0 &&
    specificCellIndex < manifest.events.length
  ) {
    return [specificCellIndex];
  }
  const indices: number[] = [];
  for (let i = 0; i < manifest.events.length; i++) {
    const st = manifest.events[i].status;
    if (st === 'pending' || st === 'failed' || st === 'recording') {
      indices.push(i);
    }
  }
  return indices;
}

/**
 * Merges a resumed or single-cell re-recorded audio segment into an existing
 * continuous recording and updates the corresponding `MidiCapturedNoteEvent`
 * frame offsets in the manifest.
 */
export function appendResumedRecordingToManifest(
  existingPcm: Float32Array,
  existingManifest: MidiAutoSampleManifest,
  appendedPcm: Float32Array,
  updatedEvents: Array<{
    eventIndex: number;
    localNoteOnFrame: number;
    localNoteOffFrame: number;
    localTailEndFrame: number;
    peakDbfs?: number;
    status?: 'recorded' | 'failed';
  }>
): { mergedPcm: Float32Array; updatedManifest: MidiAutoSampleManifest } {
  const baseFrame = existingPcm.length;
  const mergedPcm = new Float32Array(existingPcm.length + appendedPcm.length);
  mergedPcm.set(existingPcm, 0);
  mergedPcm.set(appendedPcm, baseFrame);

  const nextEvents = existingManifest.events.map((ev) => ({ ...ev }));
  for (const u of updatedEvents) {
    const target = nextEvents[u.eventIndex];
    if (!target) continue;
    target.status = u.status ?? 'recorded';
    target.noteOnFrame = baseFrame + u.localNoteOnFrame;
    target.noteOffFrame = baseFrame + u.localNoteOffFrame;
    target.tailEndFrame = baseFrame + u.localTailEndFrame;
    if (u.peakDbfs !== undefined) target.peakDbfs = u.peakDbfs;
  }

  return {
    mergedPcm,
    updatedManifest: {
      ...existingManifest,
      events: nextEvents,
    },
  };
}

/**
 * Stateful tracker for Mode 3: Live MIDI Keyboard Capture ("el usuario no decide nada,
 * toca un teclado MIDI y se graba el audio").
 * Tracks active notes, closes open release tails either when decay reaches silence
 * or when the next note is struck, and detects accidental polyphonic overlaps.
 */
export class LiveMidiCaptureTracker {
  private readonly sampleRate: number;
  private readonly maxReleaseMs: number;
  private activeNotes = new Map<
    number,
    {
      midiNote: number;
      velocity: number;
      noteOnFrame: number;
      noteOffFrame: number | null;
      hasOverlap: boolean;
    }
  >();
  private completedRawEvents: Array<{
    midiNote: number;
    velocity: number;
    noteOnFrame: number;
    noteOffFrame: number;
    tailEndFrame: number;
    hasPolyphonicOverlap?: boolean;
  }> = [];

  constructor(sampleRate: number, maxReleaseMs = 2000) {
    this.sampleRate = Math.max(1, sampleRate);
    this.maxReleaseMs = Math.max(100, maxReleaseMs);
  }

  public onNoteOn(midiNote: number, velocity: number, currentFrame: number): void {
    const frame = Math.max(0, Math.round(currentFrame));
    // Any note that was already released (`noteOffFrame !== null`) closes its tail right before this new attack
    for (const [key, open] of Array.from(this.activeNotes.entries())) {
      if (open.noteOffFrame !== null) {
        this.completedRawEvents.push({
          midiNote: open.midiNote,
          velocity: open.velocity,
          noteOnFrame: open.noteOnFrame,
          noteOffFrame: open.noteOffFrame,
          tailEndFrame: Math.max(open.noteOffFrame + 64, frame),
          ...(open.hasOverlap ? { hasPolyphonicOverlap: true } : {}),
        });
        this.activeNotes.delete(key);
      } else {
        // Still held while a new note is pressed -> mark polyphonic overlap
        open.hasOverlap = true;
      }
    }

    const hadOtherHeld = this.activeNotes.size > 0;
    this.activeNotes.set(midiNote, {
      midiNote,
      velocity,
      noteOnFrame: frame,
      noteOffFrame: null,
      hasOverlap: hadOtherHeld,
    });
  }

  public onNoteOff(midiNote: number, currentFrame: number): void {
    const open = this.activeNotes.get(midiNote);
    if (!open) return;
    open.noteOffFrame = Math.max(open.noteOnFrame + 64, Math.round(currentFrame));
  }

  /**
   * Periodically called during recording with the full mono buffer so far to close
   * any released notes whose tails have decayed to the noise floor.
   */
  public pollReleaseTails(monoSoFar: Float32Array, noiseFloorDbfs = -65): void {
    for (const [key, open] of Array.from(this.activeNotes.entries())) {
      if (open.noteOffFrame === null) continue;
      if (monoSoFar.length <= open.noteOffFrame + 128) continue;
      const slice = monoSoFar.subarray(open.noteOnFrame);
      const decay = evaluateReleaseTailDecay(slice, {
        sampleRate: this.sampleRate,
        noteOffFrame: open.noteOffFrame - open.noteOnFrame,
        maxReleaseMs: this.maxReleaseMs,
        noiseFloorDbfs,
      });
      if (decay.tailFinished) {
        this.completedRawEvents.push({
          midiNote: open.midiNote,
          velocity: open.velocity,
          noteOnFrame: open.noteOnFrame,
          noteOffFrame: open.noteOffFrame,
          tailEndFrame: open.noteOnFrame + decay.approxTailEndFrame,
          ...(open.hasOverlap ? { hasPolyphonicOverlap: true } : {}),
        });
        this.activeNotes.delete(key);
      }
    }
  }

  /** Finalizes all remaining notes when recording stops and builds a normalized manifest. */
  public finalizeManifest(
    totalFrames: number,
    name = 'Live MIDI Capture',
    extendToFullKeybed = true
  ): MidiAutoSampleManifest {
    const endFrame = Math.max(128, totalFrames);
    for (const [, open] of this.activeNotes) {
      const noteOff = open.noteOffFrame ?? Math.max(open.noteOnFrame + 64, endFrame - 128);
      this.completedRawEvents.push({
        midiNote: open.midiNote,
        velocity: open.velocity,
        noteOnFrame: open.noteOnFrame,
        noteOffFrame: noteOff,
        tailEndFrame: Math.max(noteOff + 64, endFrame),
        ...(open.hasOverlap ? { hasPolyphonicOverlap: true } : {}),
      });
    }
    this.activeNotes.clear();

    const events = normalizeLiveCapturedMidiEvents(this.completedRawEvents, extendToFullKeybed);
    return createMidiAutoSampleManifest({
      name,
      mode: 'live_midi_capture',
      sampleRate: this.sampleRate,
      events,
    });
  }

  public getCapturedCount(): number {
    return this.completedRawEvents.length + this.activeNotes.size;
  }
}

/**
 * Full Step C + Step D pipeline:
 *   1. Cleans the continuous recording BEFORE cutting (`dcBlock` + `applyNoiseReductionDsp`).
 *   2. Slices deterministically by `manifest` (`buildSlicesFromMidiManifest`).
 *   3. Computes `AutoLoop` strictly inside `[NoteOn..NoteOff]` (`sustainEndFrame`).
 *   4. Builds ready-to-inject `ClassicZone[]`, `ExtendedRegion[]`, and `audioBuffers`.
 */
export function processAutoSampledRecording(
  rawMonoPcm: Float32Array,
  manifest: MidiAutoSampleManifest,
  config: Partial<AutoSamplerConfig> = {}
): AutoSamplerProcessedOutput {
  const cfg: AutoSamplerConfig = { ...DEFAULT_AUTOSAMPLER_CONFIG, ...config };
  const sr = Math.max(1, manifest.sampleRate);

  // 1. Step C — Continuous-Take Cleaning BEFORE Slicing
  let cleanedMono = dcBlock(rawMonoPcm, sr);
  let noiseProfile = toFullNoiseProfile(manifest.noiseProfile);
  if (!noiseProfile && manifest.events.length > 0 && manifest.events[0].noteOnFrame > sr * 0.2) {
    noiseProfile = toFullNoiseProfile(
      capturePreRollNoiseProfile(
        cleanedMono.subarray(0, manifest.events[0].noteOnFrame),
        sr
      )
    );
  }
  if (cfg.cleanBeforeSlice && noiseProfile) {
    cleanedMono = reduceNoiseWithProfile(cleanedMono, sr, noiseProfile, {
      reductionDb: 12,
      removeHum: true,
    });
  }

  const effectiveLatencySamples =
    manifest.latencySamples && manifest.latencySamples > 0
      ? manifest.latencySamples
      : cfg.calibratedLatencySamples > 0
        ? cfg.calibratedLatencySamples
        : Math.max(0, Math.round((cfg.calibratedLatencyMs / 1000) * sr));

  // Apply updated drum map names/muteGroups if the user loaded or fixed a drum map after recording
  const effectiveManifest: MidiAutoSampleManifest = {
    ...manifest,
    latencySamples: effectiveLatencySamples,
    ...(noiseProfile ? { noiseProfile } : {}),
    events: manifest.events.map((ev) => {
      if (cfg.drumMap && cfg.drumMap.hits.length > 0) {
        const hit = cfg.drumMap.hits.find((h) => h.midiNote === ev.midiNote);
        if (hit) {
          return {
            ...ev,
            customName: hit.name,
            ...(hit.muteGroup !== undefined ? { muteGroup: hit.muteGroup } : {}),
          };
        }
      }
      return { ...ev };
    }),
  };

  // 2. Step D — Deterministic Slicing Guided by MIDI Manifest
  const slicerResult = buildSlicesFromMidiManifest(cleanedMono, sr, effectiveManifest, {
    snapZeroCrossing: true,
    trimTrailingSilence: true,
    autoCompensateAnalogDetune: cfg.autoCompensateAnalogDetune,
    extraLatencyOffsetMs: cfg.extraLatencyOffsetMs,
  });

  // 3. Step D.2 — Sustain-Bounded AutoLoop (`NoteOn..NoteOff`, never inside release tail)
  const isDrum = effectiveManifest.mode === 'drum_map' || Boolean(cfg.drumMap?.hits.length);
  if (cfg.autoLoopSustained && !isDrum && slicerResult.slices.length > 0) {
    const loopInputs = slicerResult.slices.map((sl) => ({
      id: sl.id,
      sampleName: sl.label,
      monoPcm: sl.pcm,
      sampleRate: sr,
      sustainEndFrame: sl.noteOffOffsetFrame,
    }));
    const loops = computeBatchAutoLoopForZones(loopInputs);
    const loopById = new Map(loops.map((l) => [l.id, l]));

    for (let i = 0; i < slicerResult.slices.length; i++) {
      const sl = slicerResult.slices[i];
      const lp = loopById.get(sl.id);
      if (lp && lp.loopEnd > lp.loopStart + 32) {
        sl.loopStartFrame = lp.loopStart;
        sl.loopEndFrame = lp.loopEnd;
        if (effectiveManifest.events[i]) {
          effectiveManifest.events[i].loopStartFrame = lp.loopStart;
          effectiveManifest.events[i].loopEndFrame = lp.loopEnd;
        }
      }
    }
  }

  // 4. Build Session Zones & Extended Regions + Encoded WAV AudioBuffers
  const audioBuffers = new Map<string, ArrayBuffer>();
  const extendedRegions: ExtendedRegion[] = [];

  for (let i = 0; i < slicerResult.slices.length; i++) {
    const sl: DetectedSlice = slicerResult.slices[i];
    const safeTag = sl.label
      .replace(/[^A-Za-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 28);
    const sampleName = `AS_${String(i + 1).padStart(2, '0')}_${safeTag || `N${sl.rootKey}`}.wav`;
    const wavBuf = encodePcm16Wav(sl.pcm, sr);
    audioBuffers.set(sampleName, wavBuf);

    const hasLoop =
      sl.loopStartFrame !== undefined &&
      sl.loopEndFrame !== undefined &&
      sl.loopEndFrame > sl.loopStartFrame;

    extendedRegions.push({
      id: `as_reg_${i + 1}`,
      sampleName,
      rootKey: sl.rootKey as MidiNote,
      lowKey: sl.lowKey as MidiNote,
      highKey: sl.highKey as MidiNote,
      lowVel: sl.lowVel,
      highVel: sl.highVel,
      detune: sl.detuneCents ?? 0,
      volume: 0,
      pan: 0,
      pitchKeytrack: isDrum ? 0 : 100,
      trigger: 'attack',
      keyFadeIn: 0,
      keyFadeOut: 0,
      velFadeIn: 0,
      velFadeOut: 0,
      fadeCurve: 'equal-power',
      loopMode: hasLoop ? 'loop_continuous' : 'no_loop',
      loopStart: sl.loopStartFrame ?? 0,
      loopEnd: sl.loopEndFrame ?? sl.pcm.length,
      loopCrossfadeMs: 0,
      sampleRate: sr,
      numChannels: 1,
      ...(sl.muteGroup !== undefined ? { muteGroup: sl.muteGroup } : {}),
      ...(sl.roundRobinIndex !== undefined && sl.roundRobinIndex > 0
        ? {
            playLogic: 'round_robin',
            seqPosition: sl.roundRobinIndex + 1,
          }
        : {}),
    });
  }

  // Group ExtendedRegions by key range into ClassicZones (up to 2 velocity layers: sampleLow / sampleHigh)
  const zonesByNote = new Map<number, ExtendedRegion[]>();
  for (const reg of extendedRegions) {
    const list = zonesByNote.get(reg.rootKey) ?? [];
    list.push(reg);
    zonesByNote.set(reg.rootKey, list);
  }

  const classicZones: Zone[] = [];
  let zoneIdCounter = 1;
  for (const [, regs] of zonesByNote) {
    const sortedByVel = [...regs].sort((a, b) => a.lowVel - b.lowVel);
    const lowReg = sortedByVel[0];
    const highReg = sortedByVel.length > 1 ? sortedByVel[sortedByVel.length - 1] : null;

    classicZones.push({
      id: String(zoneIdCounter++),
      rootKey: lowReg.rootKey,
      lowKey: lowReg.lowKey,
      highKey: lowReg.highKey,
      velSplit: 64,
      sampleLow: lowReg.sampleName,
      sampleHigh: highReg ? highReg.sampleName : null,
      detune: lowReg.detune,
      volume: 0,
      pan: 0,
    });
  }

  return {
    manifest: effectiveManifest,
    cleanedMonoPcm: cleanedMono,
    slicerResult,
    classicZones,
    extendedRegions,
    audioBuffers,
  };
}

// ── RIFF `atem` Chunk Manifest Persistence (Rescue across sessions) ─────────

const ATEM_MAGIC = 'atem';

/**
 * Appends the `MidiAutoSampleManifest` JSON inside a standard RIFF `atem` chunk
 * at the end of a WAV file so that even if the WAV is saved to disk and later
 * dropped into `AudioChopperModal`, all MIDI notes, velocities, and drum names
 * are recovered intact.
 */
export function embedManifestInWavBytes(
  wavBytes: Uint8Array | ArrayBuffer,
  manifest: MidiAutoSampleManifest
): Uint8Array {
  const src = wavBytes instanceof Uint8Array ? wavBytes : new Uint8Array(wavBytes);
  if (src.byteLength < 44) return src;
  // Strip any previous trailing `atem` chunk before appending the fresh one
  let baseLen = src.byteLength;
  const srcView = new DataView(src.buffer, src.byteOffset, src.byteLength);
  if (srcView.getUint32(0, false) === 0x52494646) {
    let pos = 12;
    while (pos + 8 <= src.byteLength) {
      const id = String.fromCharCode(src[pos], src[pos + 1], src[pos + 2], src[pos + 3]);
      const sz = srcView.getUint32(pos + 4, true);
      if (id === ATEM_MAGIC) {
        baseLen = pos;
        break;
      }
      pos += 8 + sz + (sz % 2);
    }
  }

  const jsonBytes = new TextEncoder().encode(
    JSON.stringify({
      abdAutoSampleManifest: manifest,
      Num_slices: manifest.events.length,
    })
  );
  const pad = jsonBytes.byteLength % 2 === 1 ? 1 : 0;
  const chunkTotal = 8 + jsonBytes.byteLength + pad;
  const out = new Uint8Array(baseLen + chunkTotal);
  out.set(src.subarray(0, baseLen), 0);

  const offset = baseLen;
  for (let i = 0; i < 4; i++) out[offset + i] = ATEM_MAGIC.charCodeAt(i);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setUint32(offset + 4, jsonBytes.byteLength, true);
  out.set(jsonBytes, offset + 8);
  // Update outer RIFF size
  view.setUint32(4, out.byteLength - 8, true);
  return out;
}

/**
 * Extracts an embedded `MidiAutoSampleManifest` from a WAV buffer if present.
 */
export function extractManifestFromWavBytes(
  wavBytes: Uint8Array | ArrayBuffer
): MidiAutoSampleManifest | null {
  const bytes = wavBytes instanceof Uint8Array ? wavBytes : new Uint8Array(wavBytes);
  if (bytes.byteLength < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, false) !== 0x52494646) return null; // 'RIFF'

  let pos = 12;
  while (pos + 8 <= bytes.byteLength) {
    const id = String.fromCharCode(
      bytes[pos],
      bytes[pos + 1],
      bytes[pos + 2],
      bytes[pos + 3]
    );
    const size = view.getUint32(pos + 4, true);
    const dataStart = pos + 8;
    if (id === ATEM_MAGIC && dataStart + size <= bytes.byteLength) {
      try {
        const text = new TextDecoder().decode(bytes.subarray(dataStart, dataStart + size));
        const parsed = JSON.parse(text.replace(/\0+$/, ''));
        if (parsed?.abdAutoSampleManifest?.events) {
          return parsed.abdAutoSampleManifest as MidiAutoSampleManifest;
        }
      } catch {
        return null;
      }
    }
    pos = dataStart + size + (size % 2);
  }
  return null;
}

export interface AutoSamplerLiveMarker {
  frame: number;
  kind: 'noteOn' | 'noteOff' | 'tailEnd';
  label: string;
}

export interface SweepEngineAdapter<TTake> {
  getSampleRate(): number;
  startRecording(): void;
  stopRecording(): TTake;
  getRecordedSec(): number;
  getRecentMonoSamples(windowFrames: number): Float32Array;
}

export interface SweepMidiAdapter {
  setChannel(channel: number): void;
  sendNoteOn(midiNote: number, velocity: number, channel?: number): boolean;
  sendNoteOff(midiNote: number, channel?: number): boolean;
  sendAllNotesOff(channel?: number): void;
}

export interface SweepOrchestratorCallbacks<TTake> {
  schedule: MidiCapturedNoteEvent[];
  targetIndices: number[];
  config: AutoSamplerConfig;
  engine: SweepEngineAdapter<TTake>;
  midi: SweepMidiAdapter;
  mixToMono: (take: TTake) => Float32Array;
  isAborted: () => boolean;
  onMarker?: (marker: AutoSamplerLiveMarker) => void;
  onProgress?: () => void;
}

export interface SweepOrchestratorResult<TTake> {
  rawTake: TTake;
  newMono: Float32Array;
  capturedPreRollProfile?: NoiseProfile;
  measuredLatencySamples: number;
  updatedEvents: Array<{
    eventIndex: number;
    localNoteOnFrame: number;
    localNoteOffFrame: number;
    localTailEndFrame: number;
    peakDbfs?: number;
    status?: 'recorded' | 'failed';
  }>;
}

/**
 * Pure runtime orchestrator for the MIDI Auto-Sweep loop (extracted from
 * `AudioRecorderModal` so UI and scheduling logic remain cleanly decoupled).
 */
export async function runScheduledSweepOrchestrator<TTake>(
  params: SweepOrchestratorCallbacks<TTake>
): Promise<SweepOrchestratorResult<TTake>> {
  const { schedule, targetIndices, config, engine, midi, mixToMono, isAborted, onMarker, onProgress } =
    params;

  midi.setChannel(config.midiChannel);
  const sr = engine.getSampleRate();
  engine.startRecording();

  const updatedEvents: SweepOrchestratorResult<TTake>['updatedEvents'] = [];
  let capturedPreRollProfile: NoiseProfile | undefined;

  try {
    // 1. Pre-Roll de 350 ms para capturar Huella de Ruido estacionaria (con dcBlock previo)
    await new Promise((r) => setTimeout(r, 350));
    const preRollFrames = Math.max(64, Math.round(engine.getRecordedSec() * sr));
    const preRollPcm = engine.getRecentMonoSamples(preRollFrames);
    if (preRollPcm.length >= 64) {
      capturedPreRollProfile = toFullNoiseProfile(capturePreRollNoiseProfile(preRollPcm, sr));
    }
    const noiseFloorDb = capturedPreRollProfile?.levelDbfs ?? -65;

    // 2. Bucle por cada celda pendiente/seleccionada
    for (const idx of targetIndices) {
      if (isAborted()) break;

      const cell = schedule[idx];
      cell.status = 'recording';
      onProgress?.();

      const noteOnFrame = Math.round(engine.getRecordedSec() * sr);
      cell.noteOnFrame = noteOnFrame;
      onMarker?.({
        frame: noteOnFrame,
        kind: 'noteOn',
        label: `${cell.customName || cell.noteName} v${cell.velocity}`,
      });

      midi.sendNoteOn(cell.midiNote, cell.velocity);

      const gateMs = Math.max(80, config.gateDurationMs);
      await new Promise((r) => setTimeout(r, gateMs));

      const noteOffFrame = Math.round(engine.getRecordedSec() * sr);
      cell.noteOffFrame = noteOffFrame;
      onMarker?.({
        frame: noteOffFrame,
        kind: 'noteOff',
        label: 'NoteOff',
      });
      midi.sendNoteOff(cell.midiNote);

      const maxRelMs = Math.max(100, config.maxReleaseMs);
      if (config.releaseMode === 'fixed_time') {
        await new Promise((r) => setTimeout(r, maxRelMs));
      } else {
        const pollStepMs = 60;
        let waitedMs = 0;
        while (waitedMs < maxRelMs && !isAborted()) {
          await new Promise((r) => setTimeout(r, pollStepMs));
          waitedMs += pollStepMs;
          const totalRecordedNow = Math.round(engine.getRecordedSec() * sr);
          const cellSpan = Math.max(128, totalRecordedNow - noteOnFrame);
          const cellAudio = engine.getRecentMonoSamples(cellSpan);
          const relOffset = Math.max(0, noteOffFrame - noteOnFrame);
          const decay = evaluateReleaseTailDecay(cellAudio, {
            sampleRate: sr,
            noteOffFrame: relOffset,
            maxReleaseMs: maxRelMs,
            noiseFloorDbfs: noiseFloorDb,
          });
          if (decay.tailFinished) break;
        }
      }

      const tailEndFrame = Math.round(engine.getRecordedSec() * sr);
      cell.tailEndFrame = tailEndFrame;
      onMarker?.({
        frame: tailEndFrame,
        kind: 'tailEnd',
        label: 'TailEnd',
      });

      const recentCellSamples = engine.getRecentMonoSamples(
        Math.max(64, tailEndFrame - noteOnFrame)
      );
      const pkAmp = peakAmplitude(recentCellSamples);
      const pk = pkAmp <= 1e-6 ? -Infinity : 20 * Math.log10(pkAmp);
      cell.peakDbfs = pk;
      cell.status = isAborted() ? 'pending' : 'recorded';

      if (!isAborted()) {
        updatedEvents.push({
          eventIndex: idx,
          localNoteOnFrame: noteOnFrame,
          localNoteOffFrame: noteOffFrame,
          localTailEndFrame: tailEndFrame,
          peakDbfs: pk,
          status: 'recorded',
        });
      }
      onProgress?.();
    }
  } finally {
    midi.sendAllNotesOff();
  }

  const rawTake = engine.stopRecording();
  const newMono = mixToMono(rawTake);

  // Determine effective RTL latency in samples (either pre-calibrated by Pilot Note or measured from the first recorded note)
  let measuredLatencySamples =
    config.calibratedLatencySamples > 0
      ? config.calibratedLatencySamples
      : Math.max(0, Math.round((config.calibratedLatencyMs / 1000) * sr));

  if (measuredLatencySamples === 0 && updatedEvents.length > 0 && newMono.length > 128) {
    const firstEv = updatedEvents[0];
    const lat = measureMidiToAudioLatency(
      newMono,
      sr,
      firstEv.localNoteOnFrame,
      capturedPreRollProfile?.levelDbfs ?? -65
    );
    if (lat.latencySamples > 0 && lat.peakDbfs > (capturedPreRollProfile?.levelDbfs ?? -65) + 6) {
      measuredLatencySamples = lat.latencySamples;
    }
  }

  return {
    rawTake,
    newMono,
    capturedPreRollProfile,
    measuredLatencySamples,
    updatedEvents,
  };
}

/**
 * Runs a single-note Pilot Calibration capture on `engine` + `midi` and returns
 * the `PilotNoteRecommendation` analysis.
 */
export async function runPilotNoteCaptureSession<TTake>(params: {
  engine: SweepEngineAdapter<TTake>;
  midi: SweepMidiAdapter;
  mixToMono: (take: TTake) => Float32Array;
  midiNote?: number;
  velocity?: number;
}): Promise<PilotNoteRecommendation> {
  const { engine, midi, mixToMono, midiNote = 60, velocity = 100 } = params;
  engine.startRecording();
  const sr = engine.getSampleRate();
  let triggerFrame = 0;
  let noteOffFrame = 0;
  try {
    await new Promise((r) => setTimeout(r, 320));
    triggerFrame = Math.round(engine.getRecordedSec() * sr);
    midi.sendNoteOn(midiNote, velocity);
    await new Promise((r) => setTimeout(r, 400));
    noteOffFrame = Math.round(engine.getRecordedSec() * sr);
    midi.sendNoteOff(midiNote);
    await new Promise((r) => setTimeout(r, 450));
  } finally {
    midi.sendAllNotesOff();
  }
  const pilotTake = engine.stopRecording();
  const mono = mixToMono(pilotTake);
  return analyzePilotNoteResponse(mono, sr, triggerFrame, noteOffFrame);
}

export { measureMidiToAudioLatency };
