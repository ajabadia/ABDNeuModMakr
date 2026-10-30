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
  ExtendedRegion,
  DahdsrEnvelope,
  SynthArticulationConfig,
  Sf2PresetOption,
  AcousticClassificationResult,
  MasterWaveConfig,
  MasterWaveResult,
  ProcessConfig,
  ProcessProgress,
  GeneratedModel,
  BankSummary,
  ParameterSetInfo,
  CoreEvent,
  MidiNote,
  ZoneSpectralInspection,
  HistoryState,
  ZoneRibbonWaveforms,
  ProcessSourcesInspection,
  DecodedWav,
  AudioFilePayload,
  ModelProvenance,
  ReprocessPurestOptions,
  AssetStoreDiagnostics,
  ModelCoverArtwork,
  ZoneLoopEditorData,
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
  exportSessionJson(): string;
  loadSessionFromJson(jsonText: string): Promise<Session>;

  // ── Zones ───────────────────────────────────────────────
  /** Get all zones in current session */
  getZones(): Zone[];

  /** Add a new zone, splitting the one that covers `rootKey` */
  addZone(rootKey: MidiNote, samplePath?: string): Promise<Zone>;

  /** Update a zone's properties (detune, volume, pan, samples, keys) */
  updateZone(zoneId: string, changes: Partial<Zone>): Promise<Zone>;

  /**
   * Load a generated model from the bank back into the editor session:
   * restores name, config, zone layout and resynthesized playable
   * samples. Throws `BankLoadError` (`NO_BINARIES` when the slot has
   * metadata but no cached audio, e.g. after a page reload).
   */
  loadBankModel(slot: number): Promise<Session>;

  /** Remove a zone, expanding its neighbour to cover the gap */
  removeZone(zoneId: string): Promise<void>;

  /**
   * Validate that zone coverage is continuous 0..127
   * with no gaps or overlaps. Returns error messages if invalid.
   */
  validateCoverage(): string[];

  // ── Samples & Waveforms ─────────────────────────────────
  /** Register an in-memory WAV buffer, decoding and validating header metadata */
  registerSampleBuffer(sampleName: string, wavBuffer: ArrayBuffer): DecodedWav;

  /** Get list of unique loaded or referenced sample names */
  getLoadedSampleNames(): string[];

  /** Get 64-point normalized waveform envelopes for zone ribbon rendering */
  getZoneRibbonWaveforms(zoneId: string): ZoneRibbonWaveforms;

  /** Play a loaded or synthesized sample via audio engine */
  auditionSample(samplePath: string, rootKey?: MidiNote): Promise<void>;

  /** Import samples from a folder, auto-assigning zones by filename */
  importSamplesFromFolder(folderPath: string): Promise<Zone[]>;

  /** Import audio files into session with optional velocity merging */
  importAudioFiles(
    files: AudioFilePayload[],
    mode?: 'samples' | 'by-name'
  ): Promise<Zone[]>;

  /** Import model files or .zip bundles */
  importModelFiles(files: AudioFilePayload[]): Promise<GeneratedModel>;

  /** Classify active session audio sources (imported vs user WAVs) */
  inspectProcessSources(): ProcessSourcesInspection;

  /** Export zone audio as standard AIFF PCM-16 with INST chunk */
  exportZoneAsAiff(zoneId: string): { filename: string; bytes: Uint8Array };

  // ── Process / Model Generation ──────────────────────────
  /** Get available parameter set descriptions */
  getParameterSets(): ParameterSetInfo[];

  /** Start model generation with current session + config */
  startProcess(
    config: ProcessConfig,
    options?: { forceReanalyzeImported?: boolean }
  ): Promise<void>;


  /** Cancel a running process */
  cancelProcess(): Promise<void>;

  /** Get current process progress */
  getProcessProgress(): ProcessProgress | null;

  // ── Bank ────────────────────────────────────────────────
  /** Load bank summary (models + presets) */
  loadBank(): Promise<BankSummary>;

  /** Clear all generated models from bank history */
  clearGeneratedModels(): Promise<void>;

  /** Set sound presets in bank */
  setBankPresets(presets: BankSummary['presets']): void;

  /** Export a generated model to a path */
  exportModel(slot: number, targetPath: string): Promise<void>;

  /** Import a model from a path into a slot */
  importModel(sourcePath: string, slot: number): Promise<GeneratedModel>;

  // ── Phase 4: Spectral Inspection & A/B Audition ─────────
  /** Compute or retrieve cached 2D spectrogram, partial tracks, and A/B waveforms for a zone */
  inspectZoneSpectrum(zoneId: string): ZoneSpectralInspection;

  /** Play either the original sample ('original'), Legacy DSP ('resynthesis'), or Enhanced DSP ('enhanced') */
  auditionZoneComparison(
    zoneId: string,
    mode: 'original' | 'resynthesis' | 'enhanced',
    targetNote?: MidiNote
  ): Promise<void>;

  /** Stop any active sample or resynthesis playback */
  stopAudition(): void;

  /** Poll real-time Web Audio AnalyserNode telemetry during playback */
  getRealtimeSpectrum(): {
    bins: Uint8Array;
    rmsDb: number;
    isPlaying: boolean;
    mode: 'original' | 'resynthesis' | 'enhanced' | null;
  };

  // ── Phase 5: UX Avanzada (Undo/Redo, Config & Auto-Repair) ──
  /** Undo the last session mutation and return the restored Session */
  undo(): Session | null;

  /** Redo the previously undone session mutation and return the restored Session */
  redo(): Session | null;

  /** Query current Undo/Redo stack state */
  getHistoryState(): HistoryState;

  /** Update ProcessConfig fields with Undo/Redo support and real-time persistence */
  updateProcessConfig(changes: Partial<ProcessConfig>): Session;

  /** Automatically repair any gaps, overlaps, or out-of-range root keys across MIDI 0..127 */
  autoRepairCoverage(): Session;

  /** Reset session zones to a single contiguous 0..127 zone with Undo support */
  resetZonesToSingle(): Session;

  // ── Phase 6: Extended Creation Mode & Universal Sampler Importer (.sf2 / .sfz) ──
  /** List presets inside an .sf2 SoundFont buffer */
  listSf2Presets(buffer: ArrayBuffer): Sf2PresetOption[];

  /** Import a SoundFont 2 (.sf2) preset directly into our native session format */
  importSf2Buffer(buffer: ArrayBuffer, presetIndex?: number): Promise<Session>;

  /** Import an .sfz definition + companion audio files into our native session format */
  importSfzText(
    sfzText: string,
    sfzFileName: string,
    audioFiles: AudioFilePayload[]
  ): Promise<Session>;

  /** Get active 2D Extended Regions (synchronizing from classic zones if not yet initialized) */
  getExtendedRegions(): ExtendedRegion[];

  /** Update a 2D Extended Region and keep classic zones projected in sync */
  updateExtendedRegion(
    regionId: string,
    changes: Partial<ExtendedRegion>
  ): Promise<ExtendedRegion>;

  /** Add a new 2D Extended Region in Extended Creation Mode */
  addExtendedRegion(partial?: Partial<ExtendedRegion>, anchorRegionId?: string): Promise<ExtendedRegion>;

  /** Remove a 2D Extended Region in Extended Creation Mode */
  removeExtendedRegion(regionId: string): Promise<void>;

  /** Get current global SynthArticulationConfig (ADSR, Filter, LFO) */
  getArticulation(): SynthArticulationConfig;

  /** Update global SynthArticulationConfig (ADSR, Filter, LFO) with Undo support */
  updateArticulation(changes: Partial<SynthArticulationConfig>): Session;

  // ── Phase 7: Acoustic Intelligence, Auto-Classification & Enhanced DSP ──
  /**
   * Analyzes the target zone's audio signal (hybrid YIN/MPM + HPS pitch, harmonicity,
   * log-attack time, inharmonicity B, spectral flatness, centroid, transient density),
   * returns the acoustic classification result, and optionally applies the detected
   * rootKey/detune + recommended Parameter Set (0..9) + Instrument Category to the session.
   */
  autoDetectZonePitchAndParameterSet(
    zoneId?: string,
    applyToSession?: boolean
  ): AcousticClassificationResult;

  // ── Phase 8: Master Wave Standard (24-bit / 96 kHz), Short-Loop Expansion & Surround ──
  /**
   * Promotes the selected zone's audio sample to the canonical 24-bit PCM / 96.000 Hz
   * Master Wave Standard (with optional short-loop expansion to X seconds, zero-crossing
   * Auto-Loop Finder, DSP BWE/De-noise or AI Bridge, and Stereo/Quad Surround expansion).
   */
  promoteZoneToMasterWave(
    zoneId?: string,
    config?: Partial<MasterWaveConfig>
  ): Promise<MasterWaveResult | null>;

  /**
   * Promotes all zones in the active session to the 24-bit / 96.000 Hz Master Wave Standard.
   */
  promoteAllZonesToMasterWave(
    config?: Partial<MasterWaveConfig>
  ): Promise<MasterWaveResult[]>;

  /**
   * Returns current decoded format metadata (sampleRate, bitsPerSample, numChannels, durationSec, loopStart/loopEnd)
   * for the specified zone's primary sample.
   */
  getZoneSampleFormatInfo(zoneId?: string): {
    sampleName: string;
    sampleRate: number;
    bitsPerSample: number;
    numChannels: number;
    durationSec: number;
    loopStart: number;
    loopEnd: number;
  } | null;

  // ── Phase 9: 5-Layer Time Capsule Container, Provenance & IndexedDB ──
  /**
   * Returns the 5-layer Time Capsule lineage (`ModelProvenance`) for the specified slot
   * or the active session, computing live layer telemetry when needed.
   */
  getModelProvenance(slot?: number): ModelProvenance | null;

  /**
   * Strictly re-processes the active session from its purest origin layer
   * (`01_raw_source` if available, otherwise `02_legacy_original` regenerated into `03_enhanced_audio`),
   * NEVER re-compressing or re-analyzing a degraded `04_classic_enhanced` `.sphere` derivative.
   */
  reprocessFromPurestSource(
    options?: ReprocessPurestOptions
  ): Promise<ModelProvenance>;

  /**
   * Returns live diagnostics of the `NeuronAssetStore` (`IndexedDB` + write-through cache).
   */
  getAssetStoreDiagnostics(): AssetStoreDiagnostics;

  /**
   * Builds the multi-format 5-Layer Time Capsule `.zip` bytes for `slot`.
   */
  buildModelZipBytes(slot: number): Uint8Array;

  // ── Phase 13: Interactive Waveform Loop Editor ──────────
  /**
   * Retrieves decoded mono PCM samples, total frames, sampleRate, and current loop parameters
   * for the active zone/region so the Waveform Loop Editor and Zero-Crossing Seam Magnifier can render.
   */
  getZoneLoopEditorData(zoneId?: string, regionId?: string): ZoneLoopEditorData | null;

  /**
   * Starts real-time looped auditioning for the specified zone/region in the Waveform Loop Editor.
   */
  auditionLoop(
    zoneId: string,
    opts?: {
      regionId?: string;
      loopStartFrame?: number;
      loopEndFrame?: number;
      loopEnabled?: boolean;
      volumeDb?: number;
      pan?: number;
      detuneCents?: number;
      ampEnv?: DahdsrEnvelope;
    }
  ): Promise<void>;

  /**
   * Updates `loopStart` and `loopEnd` in real time on the active `AudioBufferSourceNode`
   * while dragging loop markers.
   */
  updateLiveLoopPoints(
    loopStartFrame: number,
    loopEndFrame: number,
    sampleRate: number,
    loopEnabled?: boolean
  ): void;

  // ── Phase 14: Model Cover Artwork (.webp) — Exclusive to Extended Mode ──
  /**
   * Sets or clears the `.webp` cover artwork for the active model (Extended Mode).
   */
  setModelCoverArtwork(artwork: ModelCoverArtwork | null): Session;

  /**
   * Converts any image (`File`, `Blob`, `ArrayBuffer`, `Uint8Array`) into a square `.webp`
   * cover artwork and assigns it to the active session's `processConfig.coverArtwork`.
   */
  convertAndSetModelCoverArtwork(
    input: File | Blob | ArrayBuffer | Uint8Array,
    originalName?: string
  ): Promise<ModelCoverArtwork>;
}

