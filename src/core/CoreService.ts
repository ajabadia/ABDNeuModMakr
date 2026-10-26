// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — CoreService interface
//
// Clean boundary between UI and engine.
// The UI never calls DSP directly — it talks to CoreService.
//
// Implementations:
//   MockCore   → for building the UI now
//   WasmCore   → future, if C++ compiles to WASM
//   NativeCore → future, when JUCE 9 host exists
// ─────────────────────────────────────────────────────────

import type {
  Session,
  Zone,
  ProcessConfig,
  ProcessProgress,
  GeneratedModel,
  BankSummary,
  ParameterSetInfo,
  CoreEvent,
  MidiNote,
  ZoneSpectralInspection,
  HistoryState,
} from './types.ts';

export type CoreEventListener = (event: CoreEvent) => void;

/**
 * The contract that every core implementation must fulfil.
 * Operations are async because a real backend may need time.
 */
export interface CoreService {
  // ── Lifecycle ───────────────────────────────────────────
  init(): Promise<void>;
  dispose(): void;

  // ── Event bus ───────────────────────────────────────────
  on(listener: CoreEventListener): void;
  off(listener: CoreEventListener): void;

  // ── Session ─────────────────────────────────────────────
  newSession(name?: string): Promise<Session>;
  loadSession(id: string): Promise<Session>;
  saveSession(session: Session): Promise<void>;
  getSession(): Session | null;

  // ── Zones ───────────────────────────────────────────────
  /** Get all zones in current session */
  getZones(): Zone[];

  /** Add a new zone, splitting the one that covers `rootKey` */
  addZone(rootKey: MidiNote, samplePath: string): Promise<Zone>;

  /** Update a zone's properties (detune, volume, pan, samples, keys) */
  updateZone(zoneId: string, changes: Partial<Zone>): Promise<Zone>;

  /** Remove a zone, expanding its neighbour to cover the gap */
  removeZone(zoneId: string): Promise<void>;

  /**
   * Validate that zone coverage is continuous 0..127
   * with no gaps or overlaps. Returns error messages if invalid.
   */
  validateCoverage(): string[];

  // ── Samples ─────────────────────────────────────────────
  /** Import samples from a folder, auto-assigning zones by filename */
  importSamplesFromFolder(folderPath: string): Promise<Zone[]>;

  // ── Process / Model Generation ──────────────────────────
  /** Get available parameter set descriptions */
  getParameterSets(): ParameterSetInfo[];

  /** Start model generation with current session + config */
  startProcess(config: ProcessConfig): Promise<void>;

  /** Cancel a running process */
  cancelProcess(): Promise<void>;

  /** Get current process progress */
  getProcessProgress(): ProcessProgress | null;

  // ── Bank ────────────────────────────────────────────────
  /** Load bank summary (models + presets) */
  loadBank(): Promise<BankSummary>;

  /** Export a generated model to a path */
  exportModel(slot: number, targetPath: string): Promise<void>;

  /** Import a model from a path into a slot */
  importModel(sourcePath: string, slot: number): Promise<GeneratedModel>;

  // ── Phase 4: Spectral Inspection & A/B Audition ─────────
  /** Compute or retrieve cached 2D spectrogram, partial tracks, and A/B waveforms for a zone */
  inspectZoneSpectrum?(zoneId: string): ZoneSpectralInspection;

  /** Play either the original sample ('original') or the additive Scape/Sphere resynthesis ('resynthesis') */
  auditionZoneComparison?(
    zoneId: string,
    mode: 'original' | 'resynthesis',
    targetNote?: MidiNote
  ): Promise<void>;

  /** Stop any active sample or resynthesis playback */
  stopAudition?(): void;

  /** Poll real-time Web Audio AnalyserNode telemetry during playback */
  getRealtimeSpectrum?(): {
    bins: Uint8Array;
    rmsDb: number;
    isPlaying: boolean;
    mode: 'original' | 'resynthesis' | null;
  };

  // ── Phase 5: UX Avanzada (Undo/Redo, Config & Auto-Repair) ──
  /** Undo the last session mutation and return the restored Session */
  undo?(): Session | null;

  /** Redo the previously undone session mutation and return the restored Session */
  redo?(): Session | null;

  /** Query current Undo/Redo stack state */
  getHistoryState?(): HistoryState;

  /** Update ProcessConfig fields with Undo/Redo support and real-time persistence */
  updateProcessConfig?(changes: Partial<ProcessConfig>): Session;

  /** Automatically repair any gaps, overlaps, or out-of-range root keys across MIDI 0..127 */
  autoRepairCoverage?(): Session;

  /** Reset session zones to a single contiguous 0..127 zone with Undo support */
  resetZonesToSingle?(): Session;
}
