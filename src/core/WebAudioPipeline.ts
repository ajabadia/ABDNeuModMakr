// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — WebAudioPipeline
//
// Real TypeScript implementation of CoreService.
// Replaces MockCore with:
//   - Native RIFF/WAVE decoder (PCM 8/16/24/32-bit + IEEE Float 32/64-bit)
//   - 8192-point Radix-2 FFT / STFT with Blackman-Harris / Hanning / Blackman windows
//   - Harmonic peak-picking, HPS + 2-pass Least-Squares F0 fitting, & octave-fold gate
//   - Envelope-shape & interlaced sub-grid layer clustering (up to 3 layers)
//   - Scape/Sphere frame generation & canonical .neuronikmodel (v2/v2.1) serialization
//   - Non-blocking Web Worker execution with main-thread fallback
//   - Web Audio API real-time sample & resynthesis auditioning
// ─────────────────────────────────────────────────────────

import type { CoreService, CoreEventListener } from './CoreService.ts';
import type { ProcessSourcesInspection } from './types.ts';
import {
  auditionLoop,
  auditionRow,
  auditionSample,
  auditionZoneComparison,
  getRealtimeSpectrum,
  getZoneLoopEditorData,
  stopAudition,
  updateLiveLoopPoints,
} from './pipeline/loopEditorOps.ts';
import {
  addExtendedRegion,
  getArticulation,
  removeExtendedRegion,
  updateArticulation,
  updateExtendedRegion,
} from './pipeline/extendedRegionOps.ts';
import {
  buildModelZipBytes,
  clearGeneratedModels,
  convertAndSetModelCoverArtwork,
  createSublibrary,
  deleteSublibrary,
  exportModel,
  exportZoneAsAiff,
  importModel,
  listSublibraries,
  moveModelToSublibrary,
  reorderModelsInSublibrary,
  saveToAxionikDb,
  setBankPresets,
  setModelCoverArtwork,
} from './pipeline/bankOps.ts';
import {
  analyzeRawSamplerPreflight,
  ensureZoneDemoBuffers,
  exportRawSampler,
  getAssetStoreDiagnostics,
  getZoneRibbonWaveforms,
} from './pipeline/sampleInspectOps.ts';
import type { Session, Zone, DahdsrEnvelope, ProcessConfig, ProcessProgress, GeneratedModel, BankSummary, ParameterSetInfo, CoreEvent, MidiNote, ZoneAnalysisSummary, ZoneSpectralInspection,  HistoryState, PipelineChecklistSelection, AcousticClassificationResult, AssetStoreDiagnostics, ExtendedRegion, MasterWaveConfig, MasterWaveResult, ModelProvenance, ReprocessPurestOptions, SynthArticulationConfig, Sf2PresetOption, AudioFilePayload, ModelCoverArtwork, ZoneLoopEditorData } from './types.ts';
import type { DecodedWav } from './dsp/WavDecoder.ts';
import { analyzeSingleZone } from './dsp/PipelineRunner.ts';
import type { PreservedSourceBinary } from './dsp/PipelineRunner.ts';
import { SpectralAnalyzer } from './dsp/SpectralAnalyzer.ts';
import type { RawExportOptions, RawSamplerPreflightReport, RawExportResult } from './export/rawSamplerTypes.ts';
import { NeuronAssetStore } from './storage/NeuronAssetStore.ts';
import { listSf2Presets as parseSf2PresetsList } from '../formats/Sf2Parser.ts';
import { AudioPreviewService } from './audioPreview.ts';
import { BankService } from './bankService.ts';
import { SessionHistory } from './sessionHistory.ts';
import type { PipelineContext, SpectralCacheEntry } from './pipeline/types.ts';
import { persistToLocalStorage, restoreFromLocalStorage } from './pipeline/persistenceOps.ts';
import {
  promoteAllZonesToMasterWave,
  promoteZoneToMasterWave,
  reprocessFromPurestSource,
} from './pipeline/masterWaveOps.ts';
import { exportSessionJson, getHistoryState, getSession, loadSession, loadSessionFromJson, newSession, pruneOrphanBuffers, pushHistory, redo, saveSession, undo } from './pipeline/sessionHistoryOps.ts';
import { addZone, autoRepairCoverage, removeZone, resetZonesToSingle, updateZone, validateCoverage } from './pipeline/zoneOps.ts';
import { getLoadedSampleNames, getSampleBuffer, lookupSampleBuffer, registerSampleBuffer } from './pipeline/sampleBufferOps.ts';
import { cancelProcess, getProcessProgress, startProcess, terminateWorker } from './pipeline/processOps.ts';
import { getExtendedRegions, getModelProvenance, importAudioFiles, importModelFiles, importSamplesFromFolder, importSf2Buffer, importSfzText, loadBank, loadBankModel } from './pipeline/importOps.ts';
import { basename } from './pathUtils.ts';
import type {  ZoneRibbonWaveformsData } from './waveforms.ts';
import { MAX_IMPORT_FILE_BYTES, MAX_IMPORT_FILES } from './import/modelImportService.ts';
import { updateProcessConfig, inspectProcessSources } from './pipeline/configOps.ts';
import { analyzeZoneImmediate, inspectZoneSpectrum, getZoneSampleFormatInfo } from './pipeline/spectralOps.ts';
import { synthesizeZoneResynatorV2, autoDetectZonePitchAndParameterSet } from './pipeline/resynthOps.ts';

/**
 * The 10 official Parameter Sets from the Hartmann Neuron MODELmaker v1.2 manual
 * (`MM_user_manual_E_0703.pdf`, pages 13–27) and `NASAnalysis.dll` (`FUN_100028e0` / `FUN_10001880`).
 */
export const PARAMETER_SETS: ParameterSetInfo[] = [
  { id: 0, name: 'Default Set',      description: 'Neutral set (Torsion/HiTurbul/SmallBdy/Stringed) suitable for all sounds', category: 'General' },
  { id: 1, name: 'Stringed / Bowed', description: 'Rough/Smooth & Simple/Complex Corpus for stringed and bowed instruments', category: 'Strings' },
  { id: 2, name: 'Plucked & Bells',  description: 'PluckNoise/AttkTens & Percussn/Decaying for hammered, plucked, or bells', category: 'Plucked' },
  { id: 3, name: 'Plucked & Picked', description: 'Subtler PluckNoise/MatrSoft & StrTensn/PlckType for guitars and E-pianos', category: 'Plucked' },
  { id: 4, name: 'Carpet Shop',      description: 'Glass/Stiffness & Stationary/Corpus Intensity for dense orchestral pads', category: 'Pads' },
  { id: 5, name: 'Piano etc.',       description: 'StrMetal/HamMetal/FramWood & CrpMetal/CorpWood for pianos and strings', category: 'Keys' },
  { id: 6, name: 'Woodwinds',        description: 'String/Air & Overblow/Hollow/Vibrato for woodwinds, organs, and leads', category: 'Wind' },
  { id: 7, name: 'Extreme Pads',     description: 'Character/Liquified/Alienized & ColorHi/TapSync for morphing choir/pads', category: 'Pads' },
  { id: 8, name: 'Loop Factory',     description: 'SpdConst/PitchVar/OrangeNs & EQ/Static/Comb for real-time loop stretching', category: 'Loops' },
  { id: 9, name: 'Multipurpose',     description: 'BodyAmnt/BdyColor/CorpOpen & CrpSmall/CrpMatrl for acoustic body shaping', category: 'General' },
];

export class WebAudioPipeline implements CoreService {
  private session: Session | null = null;
  private readonly listeners: Set<CoreEventListener> = new Set();
  private readonly sampleBuffers: Map<string, ArrayBuffer> = new Map();
  private readonly importedSourceBinaries: Map<
    string,
    PreservedSourceBinary & { complexity: number }
  > = new Map();
  private readonly assetStore: NeuronAssetStore = new NeuronAssetStore();
  private readonly analyzer: SpectralAnalyzer = new SpectralAnalyzer();
  private readonly enhancedSourceHashes: Map<string, string> = new Map();

  private worker: Worker | null = null;
  private isRunning = false;
  private cancelFlag = false;
  private processProgress: ProcessProgress | null = null;
  // A/B auditioning — delegated to AudioPreviewService (P1.1 follow-up).
  // Session zones, sample buffers and the resynth cache stay here and are
  // exposed to the service through PreviewSources; only live WebAudio
  // nodes live in the service.
  private readonly preview: AudioPreviewService = new AudioPreviewService({
    getZone: (zoneId: string) => this.session?.zones.find((z) => z.id === zoneId),
    getFirstZone: () => this.session?.zones[0],
    getSampleBuffer: (name: string) => this.lookupSampleBuffer(name),
    setSampleBuffer: (name: string, buffer: ArrayBuffer) => {
      this.sampleBuffers.set(name, buffer);
      if (name) {
        const base = basename(name) || undefined;
        if (base && base !== name) this.sampleBuffers.set(base, buffer);
      }
    },
    getResynthMono: (zoneId: string) => this.spectralCache.get(zoneId)?.resynthMono,
    getEnhancedMono: (zoneId: string) => this.spectralCache.get(zoneId)?.enhancedMono,
    getResynatorV2Stereo: async (zoneId: string, targetNote?: MidiNote) => {
      const targetBpm = this.session?.processConfig.unifiedSurfaceConfig?.tempoSync?.targetBpm;
      return this.synthesizeZoneResynatorV2(zoneId, targetNote, 100, targetBpm);
    },
    ensureSpectrum: (zoneId: string) => {
      this.inspectZoneSpectrum(zoneId);
    },
  });
  private readonly spectralCache: Map<string, SpectralCacheEntry> = new Map();
  private readonly ribbonEnvelopeCache: Map<string, number[]> = new Map();

  // Phase 5: Undo / Redo — delegated to SessionHistory (P1.1a).
  // Entries hold structured clones of only the mutable document
  // ({zones, processConfig}), never full-session JSON.
  private readonly history = new SessionHistory();

  // Bank & export packaging — delegated to BankService (P1.1 follow-up).
  // Generated-model records, presets, binaries and map.script versions
  // live in the service; session, buffers and analysis stay here and are
  // exposed through BankContext.
  private readonly bank: BankService = new BankService({
    getSession: () => this.session,
    getSampleBuffer: (name: string) => this.sampleBuffers.get(name),
    getAssetStore: () => this.assetStore,
    hasImportedBinary: (name: string) => this.importedSourceBinaries.has(name),
    ensureDemoBuffers: (zones: Zone[]) => this.ensureZoneDemoBuffers(zones),
    analyzeZone: (payload, cfg) => analyzeSingleZone(payload, cfg, this.analyzer),
    pushHistory: (label: string) => this.pushHistory(label),
    emit: (event) => this.emit(event),
    setProcessProgress: (p: ProcessProgress) => {
      this.processProgress = p;
    },
  });

  /**
   * P0.3 import guardrails: a single decoded sample is fully buffered in
   * memory (`decodeWav`), so cap per-file size; cap file count at the
   * maximum meaningful zone count (one single-note zone per MIDI key).
   * Values live in `core/import/modelImportService.ts`.
   */
  public static readonly MAX_IMPORT_FILE_BYTES = MAX_IMPORT_FILE_BYTES;
  public static readonly MAX_IMPORT_FILES = MAX_IMPORT_FILES;

  // ── Lifecycle ───────────────────────────────────────────

  public async init(): Promise<void> {
    await this.assetStore.hydrateFromIndexedDb();
    // Restore persisted session and bank from localStorage if available
    this.restoreFromLocalStorage();
  }

  public dispose(): void {
    this.preview.disposeAudio();
    this.terminateWorker();
    this.listeners.clear();
  }

  // ── Event bus ───────────────────────────────────────────

  public on(listener: CoreEventListener): void {
    this.listeners.add(listener);
  }

  public off(listener: CoreEventListener): void {
    this.listeners.delete(listener);
  }

  private emit(event: CoreEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener errors to protect pipeline state
      }
    }
  }

  /**
   * Context handed to the extracted pipeline modules. `state` exposes the
   * engine's live fields through getters so modules mutate the same objects
   * instead of copies.
   */
  private pipelineCtx(): PipelineContext {
    const self: WebAudioPipeline = this;
    return {
      state: {
        get session(): Session | null {
          return self.session;
        },
        set session(value: Session | null) {
          self.session = value;
        },
        history: this.history,
        sampleBuffers: this.sampleBuffers,
        importedSourceBinaries: this.importedSourceBinaries,
        assetStore: this.assetStore,
        bank: this.bank,
        analyzer: this.analyzer,
        preview: this.preview,
        enhancedSourceHashes: this.enhancedSourceHashes,
        spectralCache: this.spectralCache,
        ribbonEnvelopeCache: this.ribbonEnvelopeCache,
        get worker(): Worker | null {
          return self.worker;
        },
        set worker(value: Worker | null) {
          self.worker = value;
        },
        get isRunning(): boolean {
          return self.isRunning;
        },
        set isRunning(value: boolean) {
          self.isRunning = value;
        },
        get cancelFlag(): boolean {
          return self.cancelFlag;
        },
        set cancelFlag(value: boolean) {
          self.cancelFlag = value;
        },
        get processProgress(): ProcessProgress | null {
          return self.processProgress;
        },
        set processProgress(value: ProcessProgress | null) {
          self.processProgress = value;
        },
      },
      emit: (event) => this.emit(event),
      persistToLocalStorage: () => this.persistToLocalStorage(),
      ensureZoneDemoBuffers: (zones) => this.ensureZoneDemoBuffers(zones),
      computeAudioBufferHash: (buf, extraTag) => this.computeAudioBufferHash(buf, extraTag),
    };
  }

  // ── Session ─────────────────────────────────────────────

  public async newSession(name = 'Untitled'): Promise<Session> {
    return newSession(this.pipelineCtx(), name);
  }


  public async loadSession(idOrJson: string): Promise<Session> {
    return loadSession(this.pipelineCtx(), idOrJson);
  }


  public async saveSession(_session: Session): Promise<void> {
    return saveSession(this.pipelineCtx(), _session);
  }


  /**
   * Serializes the active session into a portable `.nmsession.json` string.
   */
  public exportSessionJson(): string {
    return exportSessionJson(this.pipelineCtx());
  }


  /**
   * Restores a session from a `.nmsession.json` string and ensures playable demo buffers
   * exist for any referenced sample names not yet loaded in memory.
   *
   * The payload is validated by `parseSessionJson` (P0.2): malformed JSON
   * and structurally corrupt sessions throw specific errors instead of
   * producing a broken live session.
   */
  public async loadSessionFromJson(jsonText: string): Promise<Session> {
    return loadSessionFromJson(this.pipelineCtx(), jsonText);
  }


  /**
   * Discards audio buffers, ribbon envelopes and spectral analyses that are no longer
   * referenced by the current session or by any active undo/redo history entry.
   * Prevents memory leaks and unbound buffer accumulation during long editing sessions.
   */
  public pruneOrphanBuffers(): { removedCount: number; freedBytesEstimate: number } {
    return pruneOrphanBuffers(this.pipelineCtx());
  }


  public getSession(): Session | null {
    return getSession(this.pipelineCtx());
  }


  // ── Phase 5: Undo / Redo & Config / Coverage Repair ─────

  private pushHistory(label: string, coalesceKey?: string): void {
    pushHistory(this.pipelineCtx(), label, coalesceKey);
  }


  public getHistoryState(): HistoryState {
    return getHistoryState(this.pipelineCtx());
  }


  public undo(): Session | null {
    return undo(this.pipelineCtx());
  }


  public redo(): Session | null {
    return redo(this.pipelineCtx());
  }


  public updateProcessConfig(changes: Partial<ProcessConfig>): Session {
    return updateProcessConfig(this.pipelineCtx(), changes);
  }

  public resetZonesToSingle(): Session {
    return resetZonesToSingle(this.pipelineCtx());
  }


  public autoRepairCoverage(): Session {
    return autoRepairCoverage(this.pipelineCtx());
  }


  // ── Zones ───────────────────────────────────────────────

  public getZones(): Zone[] {
    return this.session?.zones ?? [];
  }

  public async addZone(rootKey: MidiNote, samplePath?: string | null): Promise<Zone> {
    return addZone(this.pipelineCtx(), rootKey, samplePath);
  }


  public async updateZone(zoneId: string, changes: Partial<Zone>): Promise<Zone> {
    return updateZone(this.pipelineCtx(), zoneId, changes);
  }


  public async removeZone(zoneId: string): Promise<void> {
    return removeZone(this.pipelineCtx(), zoneId);
  }


  public validateCoverage(): string[] {
    return validateCoverage(this.pipelineCtx());
  }


  // ── Samples & Direct WAV Registration ───────────────────

  /**
   * Registers a binary WAV ArrayBuffer under `sampleName`, decoding it immediately
   * to validate its RIFF/WAVE header, sample rate, and bit depth.
   */
  public registerSampleBuffer(sampleName: string, wavBuffer: ArrayBuffer, options?: { isPromotedEnhanced?: boolean; rawSourceName?: string; isResynthesizedFromLegacy?: boolean; }): DecodedWav {
    return registerSampleBuffer(this.pipelineCtx(), sampleName, wavBuffer, options);
  }


  public getSampleBuffer(sampleName: string): ArrayBuffer | undefined {
    return getSampleBuffer(this.pipelineCtx(), sampleName);
  }


  /**
   * Returns 64-point normalized waveform envelopes (0..1) for `ZoneRibbon` watermark rendering:
   * - `lowOriginal`: envelope of `zone.sampleLow`
   * - `highOriginal`: envelope of `zone.sampleHigh` (if assigned)
   * - `processed`: envelope of resynthesized/processed model waveform (if inspected or processed)
   *
   * Envelope math lives in `./waveforms.ts`; this method only orchestrates
   * session lookup with the pipeline's buffer/cache stores.
   */
  public getZoneRibbonWaveforms(zoneId: string): ZoneRibbonWaveformsData {
    return getZoneRibbonWaveforms(this.pipelineCtx(), zoneId);
  }

  /**
   * Returns all unique sample filenames currently loaded in memory or assigned in the session,
   * so any zone can reuse an already-loaded sample without re-uploading from disk.
   */
  public getLoadedSampleNames(): string[] {
    return getLoadedSampleNames(this.pipelineCtx());
  }


  /**
   * Synchronously analyzes a single zone and returns its spectral telemetry summary.
   */
  public analyzeZoneImmediate(zoneId: string): ZoneAnalysisSummary {
    return analyzeZoneImmediate(this.pipelineCtx(), zoneId);
  }

  /**
   * Computes or returns cached Phase 4 spectral inspection data for `zoneId`:
   *   - 2D STFT spectrogram grid (normalized 0..1 dB magnitudes) for Original (A), Legacy (B) & Enhanced (C)
   *   - Temporal partial tracks (1..64) tagged with clustered layer index (0..3)
   *   - Downsampled waveform envelopes [min, max] for Original (A), Legacy Resynthesis (B) & Enhanced Resynthesis (C)
   */
  public inspectZoneSpectrum(zoneId: string): ZoneSpectralInspection {
    return inspectZoneSpectrum(this.pipelineCtx(), zoneId);
  }

  /**
   * Sintetiza la preescucha estéreo con el MOTOR Resynator v2 (WASM compilado
   * de `AxionikExpandedSynthesizer.h`): el documento se construye con el writer
   * y lo renderiza el artefacto versionado. Sin espejo TS.
   */
  public synthesizeZoneResynatorV2(zoneId: string, targetNote?: MidiNote, velocity = 100, hostBpm?: number): Promise<{ left: Float32Array; right: Float32Array; sampleRate: number } | undefined> {
    return synthesizeZoneResynatorV2(this.pipelineCtx(), zoneId, targetNote, velocity, hostBpm);
  }

  /**
   * Plays a registered or synthesized WAV sample via Web Audio API.
   */
  public async auditionSample(samplePath: string, rootKey: MidiNote = 60): Promise<void> {
    return auditionSample(this.pipelineCtx(), samplePath, rootKey);
  }

  /**
   * Plays either the Original sample ('original'), Legacy Scape/Sphere resynthesis ('resynthesis'),
   * Phase 7 Enhanced DSP resynthesis ('enhanced'), or ABDShared Resynator v2 ('resynator_v2')
   * for `zoneId`, optionally at `targetNote`.
   */
  public async auditionZoneComparison(zoneId: string, mode: 'original' | 'resynthesis' | 'enhanced' | 'resynator_v2', targetNote?: MidiNote, sampleOverride?: { sampleName: string; rootKey: MidiNote }): Promise<void> {
    return auditionZoneComparison(this.pipelineCtx(), zoneId, mode, targetNote, sampleOverride);
  }

  public stopAudition(): void {
    stopAudition(this.pipelineCtx());
  }

  /**
   * Returns real-time Web Audio FFT bins (0..255) and RMS level (dBFS) during playback.
   */
  public getRealtimeSpectrum(): {
    bins: Uint8Array;
    rmsDb: number;
    isPlaying: boolean;
    mode: 'original' | 'resynthesis' | 'enhanced' | 'resynator_v2' | null;
  } {
    return getRealtimeSpectrum(this.pipelineCtx());
  }


  public async importSamplesFromFolder(_folderPath: string): Promise<Zone[]> {
    return importSamplesFromFolder(this.pipelineCtx(), _folderPath);
  }


  /**
   * Imports real binary WAV / AIFF files selected via File Picker or Drag & Drop.
   * Logic lives in `core/import/modelImportService.ts`; this only exposes
   * pipeline state through `ModelImportHost`.
   */
  public async importAudioFiles(files: { name: string; buffer: ArrayBuffer }[], mode: 'samples' | 'by-name' = 'samples'): Promise<Zone[]> {
    return importAudioFiles(this.pipelineCtx(), files, mode);
  }


  /**
   * Imports a legacy Hartmann `.model` file set, a `.zip` package or a
   * `.neuronikmodel` v2.1 JSON file. Logic lives in
   * `core/import/modelImportService.ts`.
   */
  public async importModelFiles(files: { name: string; buffer: ArrayBuffer }[]): Promise<GeneratedModel> {
    return importModelFiles(this.pipelineCtx(), files);
  }



  /** Mutable-state host exposed to `core/import/*` and `core/masterWaveService` (cf. `BankContext`). */

  /**
   * Loads a generated model from the bank back into the editor session:
   * restores name, config, zone layout and resynthesized playable
   * samples from the cached `.scape`/`.sphere` binaries (same routine
   * the `.model` import path uses). The previous session state stays
   * reachable via Undo. Per-zone `velSplit` is not stored on the model
   * record, so zones come back at the canonical 64 split.
   */
  public async loadBankModel(slot: number): Promise<Session> {
    return loadBankModel(this.pipelineCtx(), slot);
  }


  // ── Process / Model Generation ──────────────────────────

  public getParameterSets(): ParameterSetInfo[] {
    return PARAMETER_SETS;
  }

  /**
   * Classifies all unique audio sources currently assigned across session zones into:
   * - `importedSources`: sources originating from a compiled `.model` (have `.scape`/`.sphere`, no original WAV)
   * - `newAudioSources`: real WAV/AIFF files loaded by the user
   * - `complexityChanged`: whether the UI Complexity differs from the imported sources' original complexity
   */
  public inspectProcessSources(): ProcessSourcesInspection {
    return inspectProcessSources(this.pipelineCtx());
  }

  public async startProcess(config: ProcessConfig, options?: { forceReanalyzeImported?: boolean; checklist?: PipelineChecklistSelection; }): Promise<void> {
    return startProcess(this.pipelineCtx(), config, options);
  }


  public async cancelProcess(): Promise<void> {
    return cancelProcess(this.pipelineCtx());
  }


  public getProcessProgress(): ProcessProgress | null {
    return getProcessProgress(this.pipelineCtx());
  }


  // ── Phase 6: Extended Creation Mode & Universal Sampler Importer (.sf2 / .sfz) ──

  public listSf2Presets(buffer: ArrayBuffer): Sf2PresetOption[] {
    return parseSf2PresetsList(buffer);
  }

  public async importSf2Buffer(buffer: ArrayBuffer, presetIndex = 0): Promise<Session> {
    return importSf2Buffer(this.pipelineCtx(), buffer, presetIndex);
  }


  public async importSfzText(sfzText: string, sfzFileName: string, audioFiles: AudioFilePayload[]): Promise<Session> {
    return importSfzText(this.pipelineCtx(), sfzText, sfzFileName, audioFiles);
  }


  public getExtendedRegions(): ExtendedRegion[] {
    return getExtendedRegions(this.pipelineCtx());
  }


  public async updateExtendedRegion(regionId: string, changes: Partial<ExtendedRegion>): Promise<ExtendedRegion> {
    return updateExtendedRegion(this.pipelineCtx(), regionId, changes);
  }

  public async addExtendedRegion(partial?: Partial<ExtendedRegion>, anchorRegionId?: string): Promise<ExtendedRegion> {
    return addExtendedRegion(this.pipelineCtx(), partial, anchorRegionId);
  }

  public async removeExtendedRegion(regionId: string): Promise<void> {
    return removeExtendedRegion(this.pipelineCtx(), regionId);
  }

  public getArticulation(): SynthArticulationConfig {
    return getArticulation(this.pipelineCtx());
  }

  public updateArticulation(changes: Partial<SynthArticulationConfig>): Session {
    return updateArticulation(this.pipelineCtx(), changes);
  }

  // ── Phase 7: Acoustic Intelligence & Auto-Detection ─────

  public autoDetectZonePitchAndParameterSet(zoneId?: string, applyToSession = true): AcousticClassificationResult {
    return autoDetectZonePitchAndParameterSet(this.pipelineCtx(), zoneId, applyToSession);
  }

  // ── Phase 8: Master Wave Standard (24-bit / 96 kHz), Short-Loop Expansion & Surround ──

  public getZoneSampleFormatInfo(zoneId?: string, regionId?: string): {
    sampleName: string;
    sampleRate: number;
    bitsPerSample: number;
    numChannels: number;
    durationSec: number;
    totalFrames?: number;
    byteSize?: number;
    loopStart: number;
    loopEnd: number;
  } | null {
    return getZoneSampleFormatInfo(this.pipelineCtx(), zoneId, regionId);
  }

  private computeAudioBufferHash(buf: ArrayBuffer, extraTag = ''): string {
    const bytes = new Uint8Array(buf);
    let h1 = 0x811c9dc5;
    let h2 = 0x811c9dc5;
    const len = bytes.length;
    const step = Math.max(1, Math.floor(len / 512));
    for (let i = 0; i < len; i += step) {
      h1 = Math.imul(h1 ^ bytes[i], 0x01000193);
      h2 = Math.imul(h2 ^ (bytes[i] + i), 0x01000193);
    }
    return `${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}_${len}_${extraTag}`;
  }

  public async promoteZoneToMasterWave(zoneId?: string, config?: Partial<MasterWaveConfig>, options?: { forceRebuild?: boolean; preserveManualLoops?: boolean }): Promise<MasterWaveResult | null> {
    return promoteZoneToMasterWave(this.pipelineCtx(), zoneId, config, options);
  }

  public async promoteAllZonesToMasterWave(config?: Partial<MasterWaveConfig>, options?: { forceRebuild?: boolean; preserveManualLoops?: boolean }): Promise<MasterWaveResult[]> {
    return promoteAllZonesToMasterWave(this.pipelineCtx(), config, options);
  }

  // ── Phase 9: 5-Layer Time Capsule, Provenance & Zero-Generation-Loss Reprocess ──

  public getAssetStoreDiagnostics(): AssetStoreDiagnostics {
    return getAssetStoreDiagnostics(this.pipelineCtx());
  }

  public getModelProvenance(slot?: number): ModelProvenance | null {
    return getModelProvenance(this.pipelineCtx(), slot);
  }


  /**
   * Strictly re-processes the active session from its purest origin layer
   * (`01_raw_source` if available, otherwise `02_legacy_original` regenerated into `03_enhanced_audio`),
   * NEVER re-compressing or re-analyzing a degraded `04_classic_enhanced` `.sphere` derivative.
   */
  public async reprocessFromPurestSource(options?: ReprocessPurestOptions): Promise<ModelProvenance> {
    return reprocessFromPurestSource(this.pipelineCtx(), options);
  }

  // ── Bank & Export Packaging (delegated to BankService) ──

  public setBankPresets(presets: BankSummary['presets']): void {
    setBankPresets(this.pipelineCtx(), presets);
  }

  public async clearGeneratedModels(): Promise<void> {
    return clearGeneratedModels(this.pipelineCtx());
  }

  public async loadBank(): Promise<BankSummary> {
    return loadBank(this.pipelineCtx());
  }


  public buildModelZipBytes(slot: number): Uint8Array {
    return buildModelZipBytes(this.pipelineCtx(), slot);
  }

  public async exportModel(slot: number, targetPath: string): Promise<void> {
    return exportModel(this.pipelineCtx(), slot, targetPath);
  }

  public async saveToAxionikDb(options?: { customSlug?: string; customName?: string; saveAs?: boolean; sublibrary?: string; sublibraryOrdinal?: number; }): Promise<{ slug: string; path: string; isBridge: boolean; count: number; sublibrary: string }> {
    return saveToAxionikDb(this.pipelineCtx(), options);
  }

  public async listSublibraries(): Promise<import('./types.ts').SublibraryInfo[]> {
    return listSublibraries(this.pipelineCtx());
  }

  public async createSublibrary(name: string, description?: string, order?: number): Promise<import('./types.ts').SublibraryInfo> {
    return createSublibrary(this.pipelineCtx(), name, description, order);
  }

  public async deleteSublibrary(name: string): Promise<void> {
    return deleteSublibrary(this.pipelineCtx(), name);
  }

  public async moveModelToSublibrary(slugOrSlot: string | number, targetSublibrary: string): Promise<void> {
    return moveModelToSublibrary(this.pipelineCtx(), slugOrSlot, targetSublibrary);
  }

  public async reorderModelsInSublibrary(sublibrary: string, orderedSlugsOrSlots: Array<string | number>): Promise<void> {
    return reorderModelsInSublibrary(this.pipelineCtx(), sublibrary, orderedSlugsOrSlots);
  }

  public exportZoneAsAiff(zoneId: string): { filename: string; bytes: Uint8Array } {
    return exportZoneAsAiff(this.pipelineCtx(), zoneId);
  }

  public async importModel(_sourcePath: string, slot: number): Promise<GeneratedModel> {
    return importModel(this.pipelineCtx(), _sourcePath, slot);
  }

  // ── Phase 13: Interactive Waveform Loop Editor ──────────

  public getZoneLoopEditorData(zoneId?: string, regionId?: string): ZoneLoopEditorData | null {
    return getZoneLoopEditorData(this.pipelineCtx(), zoneId, regionId);
  }

  /**
   * Loop Editor audition ("Play Loop"): always loops between the editor markers
   * (falling back to Forward Loop when the region has no loop mode yet) and starts
   * at the loop start so the seam is heard immediately.
   */
  public async auditionLoop(zoneId: string, opts?: { regionId?: string; loopStartFrame?: number; loopEndFrame?: number; loopEnabled?: boolean; volumeDb?: number; pan?: number; detuneCents?: number; ampEnv?: DahdsrEnvelope; }): Promise<void> {
    return auditionLoop(this.pipelineCtx(), zoneId, opts);
  }

  /**
   * Row audition (▶ in the zone/region table): plays exactly the row's sample from
   * 0 s with its volume, pan, detune and amp envelope. Loops only when the row has a
   * looping mode AND explicit loop points (region or WAV `smpl` chunk).
   * Shares sample resolution with the Loop Editor (`getZoneLoopEditorData`).
   */
  public async auditionRow(opts: { zoneId?: string; regionId?: string; }): Promise<void> {
    return auditionRow(this.pipelineCtx(), opts);
  }


  public updateLiveLoopPoints(loopStartFrame: number, loopEndFrame: number, sampleRate: number, loopEnabled: boolean = true): void {
    updateLiveLoopPoints(this.pipelineCtx(), loopStartFrame, loopEndFrame, sampleRate, loopEnabled);
  }

  // ── Phase 14: Model Cover Artwork (.webp) — Exclusive to Extended Mode ──

  public setModelCoverArtwork(artwork: ModelCoverArtwork | null): Session {
    return setModelCoverArtwork(this.pipelineCtx(), artwork);
  }

  public async convertAndSetModelCoverArtwork(input: File | Blob | ArrayBuffer | Uint8Array, originalName?: string): Promise<ModelCoverArtwork> {
    return convertAndSetModelCoverArtwork(this.pipelineCtx(), input, originalName);
  }

  // ── Private Helpers ─────────────────────────────────────

  /**
   * Resolves a sample's WAV buffer by exact name, then basename, then from the
   * persisted `NeuronAssetStore` (Layer 01 raw source / Layer 03 enhanced audio,
   * hydrated from IndexedDB on startup). Store hits are cached in `sampleBuffers`.
   */
  private lookupSampleBuffer(name: string | null | undefined): ArrayBuffer | undefined {
    return lookupSampleBuffer(this.pipelineCtx(), name);
  }


  /**
   * After a page reload `sampleBuffers` is empty: repopulate it from the
   * IndexedDB-hydrated asset store for every sample referenced by the session
   * (classic zones and extended regions) before any demo fallback is synthesized.
   */

  private ensureZoneDemoBuffers(zones: Zone[]): void {
    ensureZoneDemoBuffers(this.pipelineCtx(), zones);
  }

  // ── Phase 16: Universal Raw Multi-Format Sampler Exporter ─
  public analyzeRawSamplerPreflight(options: RawExportOptions): RawSamplerPreflightReport {
    return analyzeRawSamplerPreflight(this.pipelineCtx(), options);
  }

  public exportRawSampler(options: RawExportOptions): Promise<RawExportResult> {
    return exportRawSampler(this.pipelineCtx(), options);
  }

  private terminateWorker(): void {
    terminateWorker(this.pipelineCtx());
  }



  private persistToLocalStorage(): void {
    persistToLocalStorage(this.pipelineCtx());
  }


  private restoreFromLocalStorage(): void {
    restoreFromLocalStorage(this.pipelineCtx());
  }

}
