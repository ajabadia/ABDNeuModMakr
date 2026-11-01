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
import type {
  Session,
  Zone,
  DahdsrEnvelope,
  ProcessConfig,
  ProcessProgress,
  GeneratedModel,
  BankSummary,
  ParameterSetInfo,
  CoreEvent,
  MidiNote,
  ZoneAnalysisSummary,
  ZoneSpectralInspection,
  SpectralPartialTrack,
  HistoryState,
} from './types.ts';
import {
  decodeWav,
  encodePcm16Wav,
  midiNoteToHz,
  synthesizeDemoWav,
  type DecodedWav,
} from './dsp/WavDecoder.ts';
import { clamp, linearToDb } from './dsp/DspMath.ts';
import {
  analyzeSingleZone,
  runMultiZonePipeline,
  type ZoneWavPayload,
  type PreservedSourceBinary,
} from './dsp/PipelineRunner.ts';
import { SpectralAnalyzer } from './dsp/SpectralAnalyzer.ts';
import { computeStft } from './dsp/FftEngine.ts';
import { buildLayerView } from './dsp/GridIndicator.ts';
import {
  complexityToLimits,
  resynthesizeModelToPcm,
} from './dsp/ScapeSphereGenerator.ts';
import {
  parseNeuronScape,
  parseNeuronSphere,
  resynthesizeNeuronModelSource,
} from '@abdsynths/shared/formats/neuron';

import { parseSessionJson } from './sessionSchema.ts';
import { DEFAULT_AI_ASSISTANCE_CONFIG } from './types.ts';
import type {
  RawExportOptions,
  RawSamplerPreflightReport,
  RawExportResult,
} from './export/rawSamplerTypes.ts';
import {
  analyzeRawSamplerPreflight,
} from './export/rawSamplerPreflight.ts';
import {
  exportRawSamplerLibrary,
} from './export/RawSamplerExporter.ts';
import type {
  AcousticClassificationResult,
  AssetStoreDiagnostics,
  ExtendedRegion,
  LoopMode,
  MasterWaveConfig,
  MasterWaveResult,
  ModelProvenance,
  ReprocessPurestOptions,
  SynthArticulationConfig,
  Sf2PresetOption,
  AudioFilePayload,
  ModelCoverArtwork,
  ZoneLoopEditorData,
} from './types.ts';
import { convertImageToCoverWebp } from './coverArtwork.ts';
import {
  applyEnhancedSpectralModel,
  classifyAcousticSample,
  extractAcousticDescriptors,
} from './dsp/AcousticIntelligence.ts';
import { DEFAULT_MASTER_WAVE_CONFIG } from './dsp/MasterWaveEnhancer.ts';
import { NeuronAssetStore } from './storage/NeuronAssetStore.ts';
import {
  buildTimeCapsuleEntries,
  resolvePurestSourceForSample,
} from './timeCapsule.ts';
import {
  createDefaultArticulation,
  cloneArticulation,
  createDefaultCommonPlayback,
  cloneCommonPlayback,
  cloneExtendedRegion,
  syncExtendedRegionsFromClassicZones,
  projectExtendedRegionsToClassicZones,
  computeNextAvailableExtendedRange,
} from './extendedAdapter.ts';
import {
  listSf2Presets as parseSf2PresetsList,
  importSf2PresetToNative,
  type NativeSamplerImportResult,
} from '../formats/Sf2Parser.ts';
import { importSfzToNative } from '../formats/SfzParser.ts';
import {
  persistSessionToLocalStorage,
  restoreSessionFromLocalStorage,
} from './sessionPersistence.ts';
import { AudioPreviewService } from './audioPreview.ts';
import { BankService, BankLoadError, buildBankLoadPlan } from './bankService.ts';
import { SessionHistory } from './sessionHistory.ts';
import { createInitialSession, createZone } from './sessionFactory.ts';
import {
  buildZoneRibbonWaveforms,
  emptyRibbonWaveforms,
  getSampleEnvelope,
  type EnvelopeStore,
  type ZoneRibbonWaveformsData,
} from './waveforms.ts';
import type {
  WorkerInboundMessage,
  WorkerOutboundMessage,
} from './worker/analysisWorker.ts';
import {
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_FILES,
  importAudioFiles,
  importModelFiles,
  importSamplesFromFolder,
  maybeAutoDeriveModelName as autoDeriveModelName,
  type ModelImportHost,
} from './import/modelImportService.ts';
import {
  promoteAllZonesToMasterWave,
  promoteZoneToMasterWave,
  type MasterWaveHost,
} from './masterWaveService.ts';

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
        const base = name.split(/[\\/]/).pop();
        if (base && base !== name) this.sampleBuffers.set(base, buffer);
      }
    },
    getResynthMono: (zoneId: string) => this.spectralCache.get(zoneId)?.resynthMono,
    getEnhancedMono: (zoneId: string) => this.spectralCache.get(zoneId)?.enhancedMono,
    ensureSpectrum: (zoneId: string) => {
      this.inspectZoneSpectrum(zoneId);
    },
  });
  private readonly spectralCache: Map<
    string,
    {
      key: string;
      inspection: ZoneSpectralInspection;
      resynthMono: Float32Array;
      enhancedMono: Float32Array;
    }
  > = new Map();
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

  // ── Session ─────────────────────────────────────────────

  public async newSession(name = 'Untitled'): Promise<Session> {
    this.sampleBuffers.clear();
    this.importedSourceBinaries.clear();
    this.assetStore.clearSessionAudioLayers();
    this.ribbonEnvelopeCache.clear();
    this.spectralCache.clear();
    this.session = createInitialSession(name);
    this.clearHistory();
    this.persistToLocalStorage();
    this.emit({ type: 'session-changed', session: this.session });
    return this.session;
  }

  public async loadSession(idOrJson: string): Promise<Session> {
    if (idOrJson.trim().startsWith('{')) {
      return this.loadSessionFromJson(idOrJson);
    }
    this.session = createInitialSession('Hartmann MultiSession');
    this.clearHistory();
    this.session.zones = [
      createZone(0, 24, 35, 'Bass_24_C1.wav'),
      createZone(36, 48, 59, 'Piano_48_C3.wav'),
      createZone(60, 72, 83, 'Strings_72_C5.wav'),
      createZone(84, 96, 107, 'Pad_96_C7.wav'),
      createZone(108, 115, 127, 'Bell_115_G8.wav'),
    ];
    this.session.zones[2].sampleHigh = 'Strings_72_C5_v2.wav';
    this.ensureZoneDemoBuffers(this.session.zones);
    this.persistToLocalStorage();
    this.emit({ type: 'session-changed', session: this.session });
    return this.session;
  }

  public async saveSession(_session: Session): Promise<void> {
    if (this.session) {
      this.session.dirty = false;
      this.session.modifiedAt = new Date().toISOString();
      this.persistToLocalStorage();
      this.emit({ type: 'session-changed', session: this.session });
    }
  }

  /**
   * Serializes the active session into a portable `.nmsession.json` string.
   */
  public exportSessionJson(): string {
    if (!this.session) {
      throw new Error('No active session to export');
    }
    return JSON.stringify(
      {
        magic: 'NEURONMM_SESSION',
        version: '1.2.0',
        exportedAt: new Date().toISOString(),
        session: this.session,
      },
      null,
      2
    );
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
    const newSession = parseSessionJson(jsonText);
    this.session = newSession;
    this.clearHistory();
    this.pruneOrphanBuffers();
    this.ensureZoneDemoBuffers(newSession.zones);
    this.persistToLocalStorage();
    this.emit({ type: 'session-changed', session: newSession });
    return newSession;
  }

  /**
   * Discards audio buffers, ribbon envelopes and spectral analyses that are no longer
   * referenced by the current session or by any active undo/redo history entry.
   * Prevents memory leaks and unbound buffer accumulation during long editing sessions.
   */
  public pruneOrphanBuffers(): { removedCount: number; freedBytesEstimate: number } {
    const activeNames = new Set<string>();

    if (this.session) {
      for (const z of this.session.zones) {
        if (z.sampleLow) activeNames.add(z.sampleLow);
        if (z.sampleHigh) activeNames.add(z.sampleHigh);
      }
      if (this.session.extendedRegions) {
        for (const r of this.session.extendedRegions) {
          if (r.sampleName) activeNames.add(r.sampleName);
        }
      }
    }

    const historyNames = this.history.getReferencedSampleNames();
    for (const name of historyNames) {
      activeNames.add(name);
    }

    let removedCount = 0;
    let freedBytesEstimate = 0;

    for (const [key, buffer] of this.sampleBuffers.entries()) {
      if (!activeNames.has(key)) {
        freedBytesEstimate += buffer.byteLength;
        this.sampleBuffers.delete(key);
        this.ribbonEnvelopeCache.delete(key);
        removedCount++;
      }
    }

    if (this.session) {
      const activeZoneIds = new Set(this.session.zones.map((z) => z.id));
      for (const zoneId of this.spectralCache.keys()) {
        if (!activeZoneIds.has(zoneId)) {
          this.spectralCache.delete(zoneId);
        }
      }
    }

    return { removedCount, freedBytesEstimate };
  }

  public getSession(): Session | null {
    return this.session;
  }

  // ── Phase 5: Undo / Redo & Config / Coverage Repair ─────

  private clearHistory(): void {
    this.history.clear();
    this.emit({ type: 'history-changed', history: this.getHistoryState() });
  }

  private pushHistory(label: string, coalesceKey?: string): void {
    if (!this.session) return;
    const recorded = this.history.push(
      {
        sessionName: this.session.name,
        zones: this.session.zones,
        extendedRegions: this.session.extendedRegions,
        articulation: this.session.articulation,
        detectedInstrumentCategory: this.session.detectedInstrumentCategory,
        processConfig: this.session.processConfig,
      },
      label,
      coalesceKey
    );
    if (recorded) {
      this.pruneOrphanBuffers();
    }
    this.emit({ type: 'history-changed', history: this.getHistoryState() });
  }

  public getHistoryState(): HistoryState {
    return this.history.getState();
  }

  private applyHistoryDocument(doc: {
    sessionName?: string;
    zones: Zone[];
    extendedRegions?: ExtendedRegion[];
    articulation?: SynthArticulationConfig;
    detectedInstrumentCategory?: string;
    processConfig: ProcessConfig;
  }): void {
    if (!this.session) return;
    if (doc.sessionName !== undefined) this.session.name = doc.sessionName;
    this.session.zones = structuredClone(doc.zones);
    this.session.extendedRegions = doc.extendedRegions
      ? structuredClone(doc.extendedRegions)
      : undefined;
    this.session.articulation = doc.articulation
      ? structuredClone(doc.articulation)
      : undefined;
    this.session.detectedInstrumentCategory = doc.detectedInstrumentCategory;
    this.session.processConfig = structuredClone(doc.processConfig);
    this.session.dirty = true;
    this.session.modifiedAt = new Date().toISOString();
    this.ensureZoneDemoBuffers(this.session.zones);
    this.persistToLocalStorage();
    this.emit({ type: 'session-changed', session: this.session });
    this.emit({ type: 'history-changed', history: this.getHistoryState() });
  }

  public undo(): Session | null {
    if (!this.session) return null;
    const restored = this.history.undo({
      sessionName: this.session.name,
      zones: this.session.zones,
      extendedRegions: this.session.extendedRegions,
      articulation: this.session.articulation,
      detectedInstrumentCategory: this.session.detectedInstrumentCategory,
      processConfig: this.session.processConfig,
    });
    if (!restored) return null;
    this.applyHistoryDocument(restored);
    return this.session;
  }

  public redo(): Session | null {
    if (!this.session) return null;
    const restored = this.history.redo({
      sessionName: this.session.name,
      zones: this.session.zones,
      extendedRegions: this.session.extendedRegions,
      articulation: this.session.articulation,
      detectedInstrumentCategory: this.session.detectedInstrumentCategory,
      processConfig: this.session.processConfig,
    });
    if (!restored) return null;
    this.applyHistoryDocument(restored);
    return this.session;
  }

  public updateProcessConfig(changes: Partial<ProcessConfig>): Session {
    if (!this.session) throw new Error('No active session');
    const keys = Object.keys(changes).sort().join(',');

    // Validate before recording history so rejected changes never leave a phantom undo step
    if (changes.workingMode !== undefined) {
      if (changes.workingMode !== 'classic' && changes.workingMode !== 'extended') {
        throw new Error("Invalid workingMode: must be 'classic' | 'extended'");
      }
    }
    if (changes.keyMappingMode !== undefined) {
      if (changes.keyMappingMode !== 'chromatic' && changes.keyMappingMode !== 'drum') {
        throw new Error("Invalid keyMappingMode: must be 'chromatic' | 'drum'");
      }
    }

    this.pushHistory(`Change Process Settings (${keys})`, `config:${keys}`);

    const cfg = this.session.processConfig;
    if (changes.modelNumber !== undefined) {
      cfg.modelNumber = clamp(Math.round(changes.modelNumber), 0, 511);
    }
    if (changes.modelName !== undefined) {
      const maxLen = (changes.targetFormat ?? cfg.targetFormat) === 'modern-neural' ? 32 : 11;
      const trimmed = changes.modelName.replace(/[\r\n\t]/g, '').slice(0, maxLen);
      cfg.modelName = trimmed.length > 0 ? trimmed : 'UNTITLED';
    }
    if (changes.expandedName !== undefined) {
      const trimmed = changes.expandedName.replace(/[\r\n\t]/g, '').trim();
      cfg.expandedName = trimmed.length > 0 ? trimmed : 'UNTITLED';
    }
    if (changes.extendedMetadata !== undefined) {
      cfg.extendedMetadata = {
        ...(cfg.extendedMetadata ?? {}),
        ...changes.extendedMetadata,
      };
    }
    if (changes.complexity !== undefined) {
      cfg.complexity = clamp(Math.round(changes.complexity), 1, 10);
    }
    if (changes.parameterSet !== undefined) {
      cfg.parameterSet = clamp(Math.round(changes.parameterSet), 0, 9);
    }
    if (changes.targetFormat !== undefined) {
      cfg.targetFormat = changes.targetFormat;
      if (cfg.targetFormat !== 'modern-neural' && cfg.modelName.length > 11) {
        cfg.modelName = cfg.modelName.slice(0, 11);
      }
    }
    if (changes.workingMode !== undefined) {
      const prevMode = cfg.workingMode ?? 'classic';
      cfg.workingMode = changes.workingMode;
      if (!cfg.expandedName || cfg.expandedName.trim().length === 0) {
        cfg.expandedName = cfg.modelName || 'UNTITLED';
      }
      if (!cfg.modelName || cfg.modelName.trim().length === 0) {
        cfg.modelName = (cfg.expandedName || 'UNTITLED').slice(0, 11);
      }
      if (changes.workingMode === 'extended') {
        if (!this.session.extendedRegions || this.session.extendedRegions.length === 0) {
          this.session.extendedRegions = syncExtendedRegionsFromClassicZones(
            this.session.zones
          );
        }
        if (!this.session.articulation) {
          this.session.articulation = createDefaultArticulation();
        }
      } else if (prevMode === 'extended' && this.session.extendedRegions?.length) {
        const projected = projectExtendedRegionsToClassicZones(
          this.session.extendedRegions,
          this.session.zones,
        );
        this.session.zones = projected.zones;
      }
    }
    if (changes.keyMappingMode !== undefined) {
      cfg.keyMappingMode = changes.keyMappingMode;
    }
    if (changes.dspAlgorithm !== undefined) {
      cfg.dspAlgorithm = changes.dspAlgorithm === 'enhanced' ? 'enhanced' : 'legacy';
      this.spectralCache.clear();
    }
    if (changes.masterWaveConfig !== undefined) {
      cfg.masterWaveConfig = {
        ...(cfg.masterWaveConfig ?? DEFAULT_MASTER_WAVE_CONFIG),
        ...changes.masterWaveConfig,
      };
    }
    if (changes.commonPlayback !== undefined) {
      const nextCommon = cloneCommonPlayback({
        ...(cfg.commonPlayback ?? createDefaultCommonPlayback()),
        ...changes.commonPlayback,
      });
      cfg.commonPlayback = nextCommon;
      if (this.session.extendedRegions) {
        for (const reg of this.session.extendedRegions) {
          if (!reg.hasPlaybackOverride) {
            reg.loopMode = nextCommon.loopMode;
            reg.pitchKeytrack = nextCommon.pitchKeytrack;
            reg.trigger = nextCommon.trigger;
            reg.fadeCurve = nextCommon.fadeCurve;
          }
        }
      }
    }
    if (changes.coverArtwork !== undefined) {
      cfg.coverArtwork = changes.coverArtwork ? { ...changes.coverArtwork } : null;
    }
    if (changes.aiConfig !== undefined) {
      cfg.aiConfig = {
        ...(cfg.aiConfig ?? DEFAULT_AI_ASSISTANCE_CONFIG),
        ...changes.aiConfig,
      };
    }

    this.markDirty();
    return this.session;
  }

  public resetZonesToSingle(): Session {
    if (!this.session) throw new Error('No active session');
    this.pushHistory('Reset to Single 0..127 Zone');
    this.session.zones = [createZone(0, 60, 127, null)];
    this.session.extendedRegions = syncExtendedRegionsFromClassicZones(
      this.session.zones
    );
    this.markDirty();
    return this.session;
  }

  public autoRepairCoverage(): Session {
    if (!this.session) throw new Error('No active session');
    this.pushHistory('Auto-Repair MIDI Coverage 0..127');

    if (this.session.zones.length === 0) {
      this.session.zones = [createZone(0, 60, 127, null)];
      this.markDirty();
      return this.session;
    }

    // Sort zones by lowKey ascending, then rootKey ascending
    const sorted = [...this.session.zones].sort(
      (a, b) => a.lowKey - b.lowKey || a.rootKey - b.rootKey
    );

    // Cap total zones to 128 at most
    const capped = sorted.slice(0, 128);
    const n = capped.length;

    for (let i = 0; i < n; i++) {
      const z = capped[i];
      if (i === 0) {
        z.lowKey = 0;
      } else {
        const prev = capped[i - 1];
        const minAllowedLow = i;
        const maxAllowedLow = 128 - (n - i);
        const desiredLow = Math.max(prev.lowKey + 1, z.lowKey);
        z.lowKey = Math.max(minAllowedLow, Math.min(maxAllowedLow, desiredLow));
        prev.highKey = z.lowKey - 1;
      }
      if (i === n - 1) {
        z.highKey = 127;
      }
    }

    for (const z of capped) {
      z.rootKey = Math.max(z.lowKey, Math.min(z.highKey, z.rootKey));
      z.velSplit = 64;
      if (!z.sampleLow && z.sampleHigh) {
        z.sampleLow = z.sampleHigh;
        z.sampleHigh = null;
      }
      if (!z.sampleLow) {
        z.sampleLow = `Strings_${z.rootKey}_C4.wav`;
      }
    }

    this.session.zones = capped;
    this.session.extendedRegions = syncExtendedRegionsFromClassicZones(
      this.session.zones,
      this.session.extendedRegions
    );
    this.ensureZoneDemoBuffers(this.session.zones);
    this.markDirty();
    return this.session;
  }

  // ── Zones ───────────────────────────────────────────────

  public getZones(): Zone[] {
    return this.session?.zones ?? [];
  }

  public async addZone(rootKey: MidiNote, samplePath?: string | null): Promise<Zone> {
    if (!this.session) throw new Error('No active session');

    const zones = this.session.zones;
    const hostIdx = zones.findIndex(
      (z) => z.lowKey <= rootKey && rootKey <= z.highKey
    );
    if (hostIdx === -1) {
      throw new Error(`No zone covers MIDI note ${rootKey}`);
    }

    this.pushHistory(`Split Zone at MIDI ${rootKey}`);

    const host = zones[hostIdx];

    // If host spans multiple keys and rootKey is at lowKey, split at midpoint
    const splitPoint =
      rootKey > host.lowKey
        ? rootKey
        : host.highKey > host.lowKey
          ? Math.ceil((host.lowKey + host.highKey) * 0.5)
          : host.lowKey;

    const effectiveSampleLow =
      samplePath !== undefined ? samplePath : null;
    const newRootKey = Math.max(
      splitPoint,
      Math.min(host.highKey, rootKey > host.lowKey ? rootKey : Math.round((splitPoint + host.highKey) * 0.5))
    );
    const newZone = createZone(
      splitPoint,
      newRootKey,
      host.highKey,
      effectiveSampleLow
    );
    if (samplePath === undefined) {
      newZone.sampleHigh = null;
      newZone.velSplit = 64;
      newZone.detune = 0;
      newZone.volume = 0;
      newZone.pan = 0;
    }
    host.highKey = Math.max(host.lowKey, splitPoint - 1);
    if (host.rootKey > host.highKey) {
      host.rootKey = host.highKey;
    }

    zones.splice(hostIdx + 1, 0, newZone);
    this.session.extendedRegions = syncExtendedRegionsFromClassicZones(
      zones,
      this.session.extendedRegions
    );
    this.ensureZoneDemoBuffers([newZone]);
    this.markDirty();
    return newZone;
  }

  public async updateZone(
    zoneId: string,
    changes: Partial<Zone>
  ): Promise<Zone> {
    if (!this.session) throw new Error('No active session');
    const zones = this.session.zones;
    const idx = zones.findIndex((z) => z.id === zoneId);
    if (idx === -1) throw new Error(`Zone ${zoneId} not found`);
    const zone = zones[idx];

    const changeKeys = Object.keys(changes).sort().join(',');
    this.pushHistory(
      `Update Zone (${changeKeys})`,
      `zone:${zoneId}:${changeKeys}`
    );

    const bothKeyEdgesRaw =
      changes.lowKey !== undefined && changes.highKey !== undefined;

    if (bothKeyEdgesRaw) {
      zone.lowKey = clamp(Math.round(changes.lowKey!), 0, 127);
      zone.highKey = clamp(Math.round(changes.highKey!), 0, 127);
    } else if (changes.lowKey !== undefined) {
      // Canonical MainFrame.handlePianoNote coupled LowKey adjustment (prevents key collision/gap)
      if (idx === 0) {
        zone.lowKey = 0;
      } else {
        const prev = zones[idx - 1];
        const clampedLow = Math.max(
          prev.lowKey + 1,
          Math.min(zone.highKey, Math.round(changes.lowKey))
        );
        zone.lowKey = clampedLow;
        prev.highKey = clampedLow - 1;
      }
    } else if (changes.highKey !== undefined) {
      // Canonical MainFrame.handlePianoNote coupled HighKey adjustment (prevents key collision/gap)
      if (idx === zones.length - 1) {
        zone.highKey = 127;
      } else {
        const next = zones[idx + 1];
        const clampedHigh = Math.max(
          zone.lowKey,
          Math.min(next.highKey - 1, Math.round(changes.highKey))
        );
        zone.highKey = clampedHigh;
        next.lowKey = clampedHigh + 1;
      }
    }

    if (changes.rootKey !== undefined) {
      zone.rootKey = clamp(Math.round(changes.rootKey), 0, 127);
    }
    if (changes.velSplit !== undefined) {
      const isExtended = this.session?.processConfig.workingMode === 'extended';
      zone.velSplit = isExtended ? clamp(Math.round(changes.velSplit), 2, 127) : 64;
    }
    if (changes.detune !== undefined) {
      zone.detune = clamp(changes.detune, -99, 99);
    }
    if (changes.volume !== undefined) {
      zone.volume = clamp(changes.volume, -32, 12);
    }
    if (changes.pan !== undefined) {
      zone.pan = clamp(changes.pan, -50, 50);
    }
    if (changes.sampleLow !== undefined) {
      zone.sampleLow = changes.sampleLow;
      if (changes.sampleLow) {
        this.maybeAutoDeriveModelName(changes.sampleLow);
      }
    }
    if (changes.sampleHigh !== undefined) {
      zone.sampleHigh = changes.sampleHigh;
    }

    this.session.extendedRegions = syncExtendedRegionsFromClassicZones(
      zones,
      this.session.extendedRegions
    );
    this.ensureZoneDemoBuffers([zone]);
    this.markDirty();
    return zone;
  }

  public async removeZone(zoneId: string): Promise<void> {
    if (!this.session) throw new Error('No active session');
    const zones = this.session.zones;
    if (zones.length <= 1) {
      throw new Error('Cannot remove the last zone');
    }

    const idx = zones.findIndex((z) => z.id === zoneId);
    if (idx === -1) throw new Error(`Zone ${zoneId} not found`);

    this.pushHistory(`Remove Zone #${idx + 1}`);

    const removed = zones[idx];
    zones.splice(idx, 1);

    if (idx > 0) {
      zones[idx - 1].highKey = removed.highKey;
    } else if (zones.length > 0) {
      zones[0].lowKey = removed.lowKey;
    }

    this.spectralCache.delete(zoneId);
    this.markDirty();
  }

  public validateCoverage(): string[] {
    const errors: string[] = [];
    const zones = this.session?.zones ?? [];
    if (zones.length === 0) {
      errors.push('No zones defined');
      return errors;
    }

    const sorted = [...zones].sort((a, b) => a.lowKey - b.lowKey);

    if (sorted[0].lowKey !== 0) {
      errors.push(
        `Gap at start: first zone starts at ${sorted[0].lowKey}, expected 0`
      );
    }
    if (sorted[sorted.length - 1].highKey !== 127) {
      errors.push(
        `Gap at end: last zone ends at ${sorted[sorted.length - 1].highKey}, expected 127`
      );
    }

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (curr.lowKey !== prev.highKey + 1) {
        if (curr.lowKey <= prev.highKey) {
          errors.push(
            `Overlap between zones at keys ${prev.highKey}–${curr.lowKey}`
          );
        } else {
          errors.push(
            `Gap between keys ${prev.highKey + 1}–${curr.lowKey - 1}`
          );
        }
      }
    }

    for (const z of zones) {
      if (!z.sampleLow && z.sampleHigh) {
        errors.push(
          `Zone ${z.lowKey}–${z.highKey}: High Vel sample assigned without Low Vel sample (velocity gap 1–63)`
        );
      } else if (!z.sampleLow) {
        errors.push(`Zone ${z.lowKey}–${z.highKey}: no sample assigned`);
      }
    }

    return errors;
  }

  // ── Samples & Direct WAV Registration ───────────────────

  /**
   * Registers a binary WAV ArrayBuffer under `sampleName`, decoding it immediately
   * to validate its RIFF/WAVE header, sample rate, and bit depth.
   */
  public registerSampleBuffer(
    sampleName: string,
    wavBuffer: ArrayBuffer,
    options?: {
      isPromotedEnhanced?: boolean;
      rawSourceName?: string;
      isResynthesizedFromLegacy?: boolean;
    }
  ): DecodedWav {
    if (wavBuffer.byteLength > WebAudioPipeline.MAX_IMPORT_FILE_BYTES) {
      throw new Error(
        `Sample '${sampleName}' exceeds the ${WebAudioPipeline.MAX_IMPORT_FILE_BYTES / (1024 * 1024)} MB per-file import limit (${(wavBuffer.byteLength / (1024 * 1024)).toFixed(1)} MB)`
      );
    }
    const decoded = decodeWav(wavBuffer);
    this.sampleBuffers.set(sampleName, wavBuffer);
    this.importedSourceBinaries.delete(sampleName);
    this.ribbonEnvelopeCache.delete(sampleName);

    if (options?.isPromotedEnhanced) {
      this.assetStore.setEnhancedAudio(sampleName, wavBuffer);
      if (options.rawSourceName) {
        this.assetStore.linkPromotedToRawSource(
          sampleName,
          options.rawSourceName
        );
      }
    } else if (!options?.isResynthesizedFromLegacy) {
      this.assetStore.setRawSource(sampleName, wavBuffer);
    }

    return decoded;
  }

  public getSampleBuffer(sampleName: string): ArrayBuffer | undefined {
    return this.lookupSampleBuffer(sampleName) ?? this.sampleBuffers.get(sampleName);
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
    const zone = this.session?.zones.find((z) => z.id === zoneId);
    if (!zone) return emptyRibbonWaveforms();
    const store: EnvelopeStore = {
      buffers: this.sampleBuffers,
      cache: this.ribbonEnvelopeCache,
    };
    const slot = this.session?.processConfig.modelNumber ?? 0;
    let cachedSpec = this.spectralCache.get(zone.id);
    if (!cachedSpec && zone.sampleLow) {
      try {
        this.inspectZoneSpectrum(zone.id);
        cachedSpec = this.spectralCache.get(zone.id);
      } catch {
        // ignore
      }
    }
    const isEnhancedAlgo =
      (this.session?.processConfig.dspAlgorithm ?? 'legacy') === 'enhanced';
    const activeResynthMono = isEnhancedAlgo
      ? (cachedSpec?.enhancedMono ?? cachedSpec?.resynthMono ?? null)
      : (cachedSpec?.resynthMono ?? null);
    return buildZoneRibbonWaveforms({
      lowOriginal: getSampleEnvelope(store, zone.sampleLow, zone.rootKey),
      highOriginal: zone.sampleHigh
        ? getSampleEnvelope(store, zone.sampleHigh, zone.rootKey)
        : null,
      resynthMono: activeResynthMono,
      hasModelBinaries: this.bank.hasBinaries(slot),
    });
  }

  /**
   * Returns all unique sample filenames currently loaded in memory or assigned in the session,
   * so any zone can reuse an already-loaded sample without re-uploading from disk.
   */
  public getLoadedSampleNames(): string[] {
    const names = new Set<string>(this.sampleBuffers.keys());
    if (this.session) {
      for (const z of this.session.zones) {
        if (z.sampleLow) names.add(z.sampleLow);
        if (z.sampleHigh) names.add(z.sampleHigh);
      }
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }

  /**
   * Synchronously analyzes a single zone and returns its spectral telemetry summary.
   */
  public analyzeZoneImmediate(zoneId: string): ZoneAnalysisSummary {
    if (!this.session) throw new Error('No active session');
    const zone = this.session.zones.find((z) => z.id === zoneId);
    if (!zone) throw new Error(`Zone ${zoneId} not found`);

    const wavBuffer = zone.sampleLow
      ? (this.sampleBuffers.get(zone.sampleLow) ?? null)
      : null;

    const { summary } = analyzeSingleZone(
      { zone, wavBuffer },
      this.session.processConfig,
      this.analyzer
    );
    return summary;
  }

  /**
   * Computes or returns cached Phase 4 spectral inspection data for `zoneId`:
   *   - 2D STFT spectrogram grid (normalized 0..1 dB magnitudes) for Original (A), Legacy (B) & Enhanced (C)
   *   - Temporal partial tracks (1..64) tagged with clustered layer index (0..3)
   *   - Downsampled waveform envelopes [min, max] for Original (A), Legacy Resynthesis (B) & Enhanced Resynthesis (C)
   */
  public inspectZoneSpectrum(zoneId: string): ZoneSpectralInspection {
    if (!this.session) throw new Error('No active session');
    const zone =
      this.session.zones.find((z) => z.id === zoneId) ?? this.session.zones[0];
    if (!zone) throw new Error(`Zone ${zoneId} not found`);

    this.ensureZoneDemoBuffers([zone]);
    const sampleName = zone.sampleLow ?? `Zone_${zone.rootKey}.wav`;
    const wavBuffer =
      (zone.sampleLow ? this.sampleBuffers.get(zone.sampleLow) : null) ??
      synthesizeDemoWav('strings', zone.rootKey, 44100, 1.0);

    const cfg = this.session.processConfig;
    const cacheKey = `${zone.id}|${sampleName}|${wavBuffer.byteLength}|${zone.rootKey}|${zone.detune}|${cfg.complexity}|${cfg.parameterSet}|${cfg.dspAlgorithm ?? 'legacy'}`;
    const cached = this.spectralCache.get(zone.id);
    if (cached && cached.key === cacheKey) {
      return cached.inspection;
    }

    const decoded = decodeWav(wavBuffer);
    const { summary } = analyzeSingleZone({ zone, wavBuffer }, cfg, this.analyzer);

    // Run temporal model analysis to extract multi-layer partial trajectories & additive resynthesis
    const { targetFrames } = complexityToLimits(cfg.complexity);
    const spectralModel = this.analyzer.analyzeTemporal(
      decoded.channels,
      decoded.sampleRate,
      summary.detectedF0Hz,
      targetFrames,
      false,
      'descriptors'
    );
    const octaveFold = this.analyzer.lastOctaveFold();
    const enhancedModel = applyEnhancedSpectralModel(
      spectralModel,
      summary.acousticDescriptors
    );
    const legacyLayerView = buildLayerView(spectralModel, octaveFold);
    const enhancedLayerView = buildLayerView(enhancedModel, octaveFold);

    const resynthDuration = Math.min(2.5, Math.max(0.6, decoded.durationSec));
    const resynthMono = resynthesizeModelToPcm(
      spectralModel,
      resynthDuration,
      44100,
      summary.detectedF0Hz
    );
    const enhancedMono = resynthesizeModelToPcm(
      enhancedModel,
      resynthDuration,
      44100,
      summary.detectedF0Hz
    );

    const computeEnvelopePeaks = (
      samples: Float32Array,
      columns = 180
    ): { min: number[]; max: number[]; rmsDb: number } => {
      const min = new Array<number>(columns).fill(0);
      const max = new Array<number>(columns).fill(0);
      if (samples.length === 0) return { min, max, rmsDb: -96 };

      let sumSq = 0;
      for (let i = 0; i < samples.length; i++) {
        sumSq += samples[i] * samples[i];
      }
      const rms = Math.sqrt(sumSq / samples.length);
      const rmsDb = Number(linearToDb(rms, -96).toFixed(1));

      for (let c = 0; c < columns; c++) {
        const i0 = Math.floor((c * samples.length) / columns);
        const i1 = Math.max(
          i0 + 1,
          Math.floor(((c + 1) * samples.length) / columns)
        );
        let lo = 1.0;
        let hi = -1.0;
        for (let i = i0; i < i1 && i < samples.length; i++) {
          const v = samples[i];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        min[c] = lo <= hi ? Number(lo.toFixed(4)) : 0;
        max[c] = lo <= hi ? Number(hi.toFixed(4)) : 0;
      }
      return { min, max, rmsDb };
    };

    const waveformPeaks = computeEnvelopePeaks(decoded.mono, 180);
    const resynthPeaks = computeEnvelopePeaks(resynthMono, 180);
    const enhancedResynthPeaks = computeEnvelopePeaks(enhancedMono, 180);

    const maxFreqHz = Math.min(
      decoded.sampleRate * 0.45,
      Math.max(4500, summary.detectedF0Hz * 36)
    );
    const displayBins = 96;

    const buildSpectrogramGrid = (
      pcm: Float32Array,
      sr: number
    ): {
      frameCount: number;
      binCount: number;
      maxFreqHz: number;
      magnitudes: number[][];
    } => {
      const maxAnalysisSamples = Math.min(pcm.length, Math.floor(sr * 3.0));
      const stftSlice = pcm.subarray(0, maxAnalysisSamples);
      const frameSize = 2048;
      const hopSize = Math.max(
        256,
        Math.floor(Math.max(1, stftSlice.length - frameSize) / 36)
      );
      const stft = computeStft(stftSlice, {
        frameSize,
        hopSize,
        windowType: 'blackman-harris',
        sampleRate: sr,
      });
      const maxBin = Math.max(
        16,
        Math.min(stft.numBins - 1, Math.round(maxFreqHz / stft.binWidthHz))
      );

      let peakMag = 1e-9;
      for (const fr of stft.frames) {
        for (let b = 1; b <= maxBin; b++) {
          if (fr.magnitudes[b] > peakMag) peakMag = fr.magnitudes[b];
        }
      }

      const magnitudes: number[][] = [];
      for (const fr of stft.frames) {
        const col = new Array<number>(displayBins).fill(0);
        for (let dbIdx = 0; dbIdx < displayBins; dbIdx++) {
          const b0 = Math.max(1, Math.floor((dbIdx * maxBin) / displayBins));
          const b1 = Math.max(
            b0 + 1,
            Math.floor(((dbIdx + 1) * maxBin) / displayBins)
          );
          let binMax = 0;
          for (let b = b0; b < b1 && b <= maxBin; b++) {
            if (fr.magnitudes[b] > binMax) binMax = fr.magnitudes[b];
          }
          const relDb = linearToDb(binMax / peakMag, -120);
          col[dbIdx] = Number(clamp((relDb + 72) / 72, 0, 1).toFixed(3));
        }
        magnitudes.push(col);
      }

      return {
        frameCount: magnitudes.length,
        binCount: displayBins,
        maxFreqHz: Math.round(maxFreqHz),
        magnitudes,
      };
    };

    const spectrogram = buildSpectrogramGrid(decoded.mono, decoded.sampleRate);
    const legacySpectrogram = buildSpectrogramGrid(resynthMono, 44100);
    const enhancedSpectrogram = buildSpectrogramGrid(enhancedMono, 44100);

    const buildTracksAndPartials = (
      model: typeof spectralModel,
      lv: typeof legacyLayerView
    ): { tracks: SpectralPartialTrack[]; partials: number[] } => {
      const tracks: SpectralPartialTrack[] = [];
      const partials = new Array<number>(64).fill(0);
      for (let k = 0; k < 64; k++) {
        const assignedLayer = Math.max(0, lv.layerOfPartial[k]);
        const peakAmp = lv.peakOfPartial[k];
        const nFrames = Math.max(1, model.numFramesOf(assignedLayer));
        const frames: { timeNorm: number; freqHz: number; amplitude: number }[] = [];
        let ampSum = 0;
        let maxFrameAmp = 0;

        for (let f = 0; f < nFrames; f++) {
          const timeNorm = nFrames > 1 ? f / (nFrames - 1) : 0;
          const amp = Math.abs(model.ampAt(assignedLayer, f, k));
          const offHz = model.offsetAt(assignedLayer, f, k);
          const f0Frame =
            model.f0AtLayer(assignedLayer, f) > 0
              ? model.f0AtLayer(assignedLayer, f)
              : summary.detectedF0Hz;
          const freqHz = Math.max(20, (k + 1) * f0Frame + offHz);
          ampSum += amp;
          if (amp > maxFrameAmp) maxFrameAmp = amp;
          frames.push({
            timeNorm: Number(timeNorm.toFixed(3)),
            freqHz: Number(freqHz.toFixed(2)),
            amplitude: Number(amp.toFixed(4)),
          });
        }

        const meanAmp = ampSum / Math.max(1, nFrames);
        partials[k] = Number(clamp(Math.max(meanAmp * 1.15, maxFrameAmp * 0.85), 0, 1).toFixed(4));

        if (peakAmp < 1e-4 && (summary.amplitudes[k] ?? 0) < 1e-4) continue;
        if (frames.length === 1) {
          frames.push({ ...frames[0], timeNorm: 1.0 });
        }

        tracks.push({
          partialIndex: k + 1,
          harmonicMultiple: k + 1,
          layerIndex: assignedLayer,
          meanAmplitude: Number(meanAmp.toFixed(4)),
          frames,
        });
      }
      return { tracks, partials };
    };

    const legacyBuilt = buildTracksAndPartials(spectralModel, legacyLayerView);
    const enhancedBuilt = buildTracksAndPartials(enhancedModel, enhancedLayerView);
    const isEnhancedActive = (cfg.dspAlgorithm ?? 'legacy') === 'enhanced';

    const inspection: ZoneSpectralInspection = {
      zoneId: zone.id,
      sampleName,
      sampleRate: decoded.sampleRate,
      durationSec: Number(decoded.durationSec.toFixed(3)),
      summary,
      waveformPeaks,
      resynthPeaks,
      enhancedResynthPeaks,
      qualityScore: summary.qualityScore,
      classification: summary.classification,
      spectrogram,
      legacySpectrogram,
      enhancedSpectrogram,
      partialTracks: isEnhancedActive ? enhancedBuilt.tracks : legacyBuilt.tracks,
      legacyPartialTracks: legacyBuilt.tracks,
      enhancedPartialTracks: enhancedBuilt.tracks,
      legacyPartials: legacyBuilt.partials,
      enhancedPartials: enhancedBuilt.partials,
    };

    this.spectralCache.set(zone.id, {
      key: cacheKey,
      inspection,
      resynthMono,
      enhancedMono,
    });

    return inspection;
  }

  /**
   * Plays a registered or synthesized WAV sample via Web Audio API.
   */
  public async auditionSample(
    samplePath: string,
    rootKey: MidiNote = 60
  ): Promise<void> {
    return this.preview.auditionSample(samplePath, rootKey);
  }

  /**
   * Plays either the Original sample ('original'), Legacy Scape/Sphere resynthesis ('resynthesis'),
   * or Phase 7 Enhanced DSP resynthesis ('enhanced') for `zoneId`, optionally pitch-shifted to `targetNote`.
   */
  public async auditionZoneComparison(
    zoneId: string,
    mode: 'original' | 'resynthesis' | 'enhanced',
    targetNote?: MidiNote,
    sampleOverride?: { sampleName: string; rootKey: MidiNote }
  ): Promise<void> {
    return this.preview.auditionZoneComparison(zoneId, mode, targetNote, sampleOverride);
  }

  public stopAudition(): void {
    this.preview.stopAudition();
  }

  /**
   * Returns real-time Web Audio FFT bins (0..255) and RMS level (dBFS) during playback.
   */
  public getRealtimeSpectrum(): {
    bins: Uint8Array;
    rmsDb: number;
    isPlaying: boolean;
    mode: 'original' | 'resynthesis' | 'enhanced' | null;
  } {
    return this.preview.getRealtimeSpectrum();
  }


  public async importSamplesFromFolder(_folderPath: string): Promise<Zone[]> {
    return importSamplesFromFolder(this.importHost(), _folderPath);
  }

  /**
   * Imports real binary WAV / AIFF files selected via File Picker or Drag & Drop.
   * Logic lives in `core/import/modelImportService.ts`; this only exposes
   * pipeline state through `ModelImportHost`.
   */
  public async importAudioFiles(
    files: { name: string; buffer: ArrayBuffer }[],
    mode: 'samples' | 'by-name' = 'samples'
  ): Promise<Zone[]> {
    return importAudioFiles(this.importHost(), files, mode);
  }

  /**
   * Imports a legacy Hartmann `.model` file set, a `.zip` package or a
   * `.neuronikmodel` v2.1 JSON file. Logic lives in
   * `core/import/modelImportService.ts`.
   */
  public async importModelFiles(
    files: { name: string; buffer: ArrayBuffer }[]
  ): Promise<GeneratedModel> {
    return importModelFiles(this.importHost(), files);
  }

  private maybeAutoDeriveModelName(sampleFilename: string): void {
    if (!this.session) return;
    autoDeriveModelName(this.session, sampleFilename);
  }

  /** Mutable-state host exposed to `core/import/*` and `core/masterWaveService` (cf. `BankContext`). */
  private importHost(): ModelImportHost & MasterWaveHost {
    return {
      getSession: () => this.session,
      ensureSession: async (name: string) => {
        if (!this.session) await this.newSession(name);
        return this.session!;
      },
      pushHistory: (label: string) => this.pushHistory(label),
      markDirty: () => this.markDirty(),
      registerSampleBuffer: (name, buffer, options) =>
        this.registerSampleBuffer(name, buffer, options),
      detectPitch: (channel, sampleRate) =>
        this.analyzer.detectPitch(channel, sampleRate),
      ensureZoneDemoBuffers: (zones) => this.ensureZoneDemoBuffers(zones),
      getSampleBuffer: (name: string) => this.sampleBuffers.get(name),
      setSampleBuffer: (name: string, buffer: ArrayBuffer) => {
        this.sampleBuffers.set(name, buffer);
      },
      hasSampleBuffer: (name: string) => this.sampleBuffers.has(name),
      getAnalyzer: () => this.analyzer,
      getAssetStore: () => this.assetStore,
      getBank: () => this.bank,
      getImportedBinaries: () => this.importedSourceBinaries,
      persist: () => this.persistToLocalStorage(),
      emit: (event) => this.emit(event),
      loadBank: () => this.loadBank(),
      getExtendedRegions: () => this.getExtendedRegions(),
      getProvenance: () => this.getModelProvenance(),
      computeBufferHash: (buf, tag) => this.computeAudioBufferHash(buf, tag),
      getEnhancedHash: (name: string) => this.enhancedSourceHashes.get(name),
      setEnhancedHash: (name: string, hash: string) => {
        this.enhancedSourceHashes.set(name, hash);
      },
      invalidateSpectrum: (zoneId: string) => {
        this.spectralCache.delete(zoneId);
      },
      getSampleBuffers: () => this.sampleBuffers,
    };
  }

  /**
   * Loads a generated model from the bank back into the editor session:
   * restores name, config, zone layout and resynthesized playable
   * samples from the cached `.scape`/`.sphere` binaries (same routine
   * the `.model` import path uses). The previous session state stays
   * reachable via Undo. Per-zone `velSplit` is not stored on the model
   * record, so zones come back at the canonical 64 split.
   */
  public async loadBankModel(slot: number): Promise<Session> {
    const record = this.bank.getModelRecord(slot);
    if (!record) {
      throw new BankLoadError('NOT_FOUND', `Model #${slot} is not in the bank.`);
    }
    const binaries = this.bank.getModelBinaries(slot);
    const plan = buildBankLoadPlan(record, binaries);

    if (!this.session) {
      await this.newSession(record.name);
    } else {
      this.pushHistory(`Load Model "${record.name}"`);
    }

    const analysisBySample = new Map<string, ZoneAnalysisSummary>();
    for (const s of record.zonesAnalysis ?? []) {
      if (!analysisBySample.has(s.sampleName)) {
        analysisBySample.set(s.sampleName, s);
      }
    }

    plan.sampleOrder.forEach((sampleName, i) => {
      const pair = binaries![i];
      const firstZone = plan.zones.find(
        (z) => z.sampleLow === sampleName || z.sampleHigh === sampleName
      );
      let wavBuf: ArrayBuffer | null = null;
      try {
        const parsedScape = parseNeuronScape(pair.scapeBinary);
        const parsedSphere = parseNeuronSphere(pair.sphereBinary);
        const pcm =
          parsedSphere.frames.length > 0 || parsedScape
            ? resynthesizeNeuronModelSource(parsedSphere, parsedScape, 44100, 0.22)
            : null;
        wavBuf = pcm
          ? encodePcm16Wav(pcm, 44100, {
              rootKey: firstZone?.rootKey ?? 60,
              lowKey: firstZone?.lowKey ?? 0,
              highKey: firstZone?.highKey ?? 127,
              detune: 0,
            })
          : null;
      } catch {
        wavBuf = null;
      }
      if (!wavBuf) {
        wavBuf = synthesizeDemoWav('strings', firstZone?.rootKey ?? 60, 44100, 1.0);
      }
      try {
        this.registerSampleBuffer(sampleName, wavBuf);
      } catch {
        // Oversize buffer: keep the name reference; audition falls back to demo.
      }
      const summary = analysisBySample.get(sampleName);
      this.importedSourceBinaries.set(sampleName, {
        scapeBinary: pair.scapeBinary,
        sphereBinary: pair.sphereBinary,
        origParameterSet: record.parameterSet,
        complexity: record.complexity,
        summary: summary ?? {
          zoneId: sampleName,
          lowKey: firstZone?.lowKey ?? 0,
          rootKey: firstZone?.rootKey ?? 60,
          highKey: firstZone?.highKey ?? 127,
          sampleName,
          sampleRate: 44100,
          durationSec: 1.0,
          detectedF0Hz: 440,
          targetF0Hz: 440,
          gridResidualCents: 0,
          gridObservations: 0,
          gridBand: 'green',
          gridNotice: 'Bank model (resynthesized on load)',
          layerCount: 1,
          frameCount: 0,
          activePartials: 0,
          octaveFoldCents: 0,
          biGrid: false,
          amplitudes: new Array<number>(64).fill(0),
          frequencyOffsets: new Array<number>(64).fill(0),
        },
      });
    });

    const newZones: Zone[] = plan.zones.map((z) => {
      const zone = createZone(z.lowKey, z.rootKey, z.highKey, z.sampleLow);
      zone.sampleHigh = z.sampleHigh;
      return zone;
    });
    this.session!.name = record.name;
    this.session!.zones = newZones;
    this.session!.processConfig = { ...plan.processConfig };
    if (record.coverWebpDataUrl && !this.session!.processConfig.coverArtwork) {
      this.session!.processConfig.coverArtwork = {
        webpDataUrl: record.coverWebpDataUrl,
        byteLength: Math.round((record.coverWebpDataUrl.length * 3) / 4),
        width: 512,
        height: 512,
        originalName: `${record.name}.webp`,
        updatedAt: record.createdAt,
      };
      this.session!.processConfig.workingMode = 'extended';
    } else if (!record.coverWebpDataUrl) {
      this.session!.processConfig.coverArtwork = null;
    }
    this.session!.dirty = true;
    this.session!.modifiedAt = new Date().toISOString();
    this.ensureZoneDemoBuffers(this.session!.zones);
    this.persistToLocalStorage();
    this.emit({ type: 'session-changed', session: this.session! });
    return this.session!;
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
  public inspectProcessSources(): {
    importedSources: string[];
    newAudioSources: string[];
    importedComplexity: number | null;
    complexityChanged: boolean;
  } {
    const importedSources: string[] = [];
    const newAudioSources: string[] = [];
    const seen = new Set<string>();
    let importedComplexity: number | null = null;

    if (this.session) {
      for (const z of this.session.zones) {
        for (const sName of [z.sampleLow, z.sampleHigh]) {
          if (!sName || seen.has(sName)) continue;
          seen.add(sName);
          const imp = this.importedSourceBinaries.get(sName);
          if (imp) {
            importedSources.push(sName);
            if (importedComplexity === null) {
              importedComplexity = imp.complexity;
            }
          } else {
            newAudioSources.push(sName);
          }
        }
      }
    }

    const currComp = this.session?.processConfig.complexity ?? 8;
    const complexityChanged =
      importedSources.length > 0 &&
      importedComplexity !== null &&
      currComp !== importedComplexity;

    return {
      importedSources,
      newAudioSources,
      importedComplexity,
      complexityChanged,
    };
  }

  public async startProcess(
    config: ProcessConfig,
    options?: { forceReanalyzeImported?: boolean }
  ): Promise<void> {
    if (!this.session) throw new Error('No active session');
    if (this.isRunning) throw new Error('Process already running');

    this.session.processConfig = { ...config };
    let velocityGainMap: Record<string, { lowGain: number; highGain: number }> = {};
    if (
      this.session.processConfig.workingMode === 'extended' &&
      this.session.extendedRegions &&
      this.session.extendedRegions.length > 0
    ) {
      const projected = projectExtendedRegionsToClassicZones(
        this.session.extendedRegions,
        this.session.zones,
      );
      this.session.zones = projected.zones;
      velocityGainMap = projected.velocityLayerGainCompensation;
    }

    const zones = [...this.session.zones];
    this.ensureZoneDemoBuffers(zones);
    const forceReanalyze = options?.forceReanalyzeImported === true;

    const scaleWavBufferGain = (rawBuf: ArrayBuffer | null, gain: number): ArrayBuffer | null => {
      if (!rawBuf || Math.abs(gain - 1.0) < 1e-3) return rawBuf ? rawBuf.slice(0) : null;
      try {
        const dec = decodeWav(rawBuf);
        const scaledMono = new Float32Array(dec.mono.length);
        for (let i = 0; i < dec.mono.length; i++) {
          scaledMono[i] = Math.max(-1, Math.min(1, dec.mono[i] * gain));
        }
        return encodePcm16Wav(scaledMono, dec.sampleRate, dec.instrument);
      } catch {
        return rawBuf.slice(0);
      }
    };

    const payloads: ZoneWavPayload[] = zones.map((zone) => {
      const comp = velocityGainMap[zone.id] ?? { lowGain: 1.0, highGain: 1.0 };
      const buf = zone.sampleLow
        ? (this.sampleBuffers.get(zone.sampleLow) ?? null)
        : null;
      const highBuf = zone.sampleHigh
        ? (this.sampleBuffers.get(zone.sampleHigh) ?? null)
        : null;
      const preservedLow =
        !forceReanalyze && zone.sampleLow
          ? this.importedSourceBinaries.get(zone.sampleLow)
          : undefined;
      const preservedHigh =
        !forceReanalyze && zone.sampleHigh
          ? this.importedSourceBinaries.get(zone.sampleHigh)
          : undefined;
      return {
        zone: { ...zone },
        wavBuffer: scaleWavBufferGain(buf, comp.lowGain),
        highWavBuffer: scaleWavBufferGain(highBuf, comp.highGain),
        preservedLowBinary: preservedLow,
        preservedHighBinary: preservedHigh,
      };
    });

    this.isRunning = true;
    this.cancelFlag = false;
    const startTime = Date.now();

    this.processProgress = {
      status: 'running',
      currentZone: 1,
      totalZones: zones.length,
      currentSample: zones[0]?.sampleLow ?? 'unknown',
      percent: 0,
      message: 'Initializing 8192-point STFT & harmonic peak-picking engine...',
      elapsedMs: 0,
    };
    this.emit({
      type: 'process-progress',
      progress: { ...this.processProgress },
    });

    // Use Web Worker when available in browser, fallback to async main-thread runner
    if (typeof Worker !== 'undefined') {
      try {
        this.terminateWorker();
        this.worker = new Worker(
          new URL('./worker/analysisWorker.ts', import.meta.url),
          { type: 'module' }
        );

        this.worker.onmessage = (
          ev: MessageEvent<WorkerOutboundMessage>
        ) => {
          const msg = ev.data;
          if (msg.type === 'progress') {
            this.processProgress = msg.progress;
            this.emit({
              type: 'process-progress',
              progress: { ...this.processProgress },
            });
          } else if (msg.type === 'complete') {
            this.isRunning = false;
            this.terminateWorker();
            this.bank.finalizeModelGeneration(
              config,
              zones.length,
              msg.zonesAnalysis,
              msg.zoneBinaries,
              msg.neuronikModelJson,
              msg.elapsedMs
            );
          } else if (msg.type === 'cancelled') {
            this.isRunning = false;
            this.terminateWorker();
            this.processProgress = {
              status: 'cancelled',
              currentZone: this.processProgress?.currentZone ?? 0,
              totalZones: zones.length,
              currentSample: '',
              percent: this.processProgress?.percent ?? 0,
              message: 'Process cancelled by user',
              elapsedMs: msg.elapsedMs,
            };
            this.emit({
              type: 'process-progress',
              progress: { ...this.processProgress },
            });
          } else if (msg.type === 'error') {
            this.isRunning = false;
            this.terminateWorker();
            this.processProgress = {
              status: 'error',
              currentZone: this.processProgress?.currentZone ?? 0,
              totalZones: zones.length,
              currentSample: '',
              percent: this.processProgress?.percent ?? 0,
              message: msg.error,
              elapsedMs: Date.now() - startTime,
            };
            this.emit({
              type: 'process-progress',
              progress: { ...this.processProgress },
            });
            this.emit({ type: 'process-error', error: msg.error });
          }
        };

        this.worker.onerror = (err) => {
          this.isRunning = false;
          this.terminateWorker();
          const errMsg = err.message || 'Worker execution failed';
          this.emit({ type: 'process-error', error: errMsg });
        };

        const startMsg: WorkerInboundMessage = {
          type: 'start',
          payloads,
          config,
        };
        this.worker.postMessage(startMsg);
        return;
      } catch {
        // Fallback to main thread if Worker instantiation fails
        this.terminateWorker();
      }
    }

    // Main-thread fallback execution
    try {
      const result = await runMultiZonePipeline(
        payloads,
        config,
        (progress) => {
          this.processProgress = progress;
          this.emit({
            type: 'process-progress',
            progress: { ...this.processProgress },
          });
        },
        () => this.cancelFlag
      );

      this.isRunning = false;
      this.bank.finalizeModelGeneration(
        config,
        zones.length,
        result.zonesAnalysis,
        result.zoneBinaries,
        result.neuronikModelJson,
        Date.now() - startTime
      );
    } catch (err) {
      this.isRunning = false;
      const message = err instanceof Error ? err.message : String(err);
      if (this.cancelFlag || message.includes('cancelled')) {
        this.processProgress = {
          status: 'cancelled',
          currentZone: this.processProgress?.currentZone ?? 0,
          totalZones: zones.length,
          currentSample: '',
          percent: this.processProgress?.percent ?? 0,
          message: 'Process cancelled by user',
          elapsedMs: Date.now() - startTime,
        };
        this.emit({
          type: 'process-progress',
          progress: { ...this.processProgress },
        });
      } else {
        this.processProgress = {
          status: 'error',
          currentZone: this.processProgress?.currentZone ?? 0,
          totalZones: zones.length,
          currentSample: '',
          percent: 0,
          message,
          elapsedMs: Date.now() - startTime,
        };
        this.emit({
          type: 'process-progress',
          progress: { ...this.processProgress },
        });
        this.emit({ type: 'process-error', error: message });
      }
    }
  }

  public async cancelProcess(): Promise<void> {
    this.cancelFlag = true;
    if (this.worker) {
      const msg: WorkerInboundMessage = { type: 'cancel' };
      this.worker.postMessage(msg);
      this.terminateWorker();
    }
    this.isRunning = false;
    if (this.processProgress) {
      this.processProgress = {
        ...this.processProgress,
        status: 'cancelled',
        message: 'Process cancelled by user',
      };
      this.emit({
        type: 'process-progress',
        progress: { ...this.processProgress },
      });
    }
  }

  public getProcessProgress(): ProcessProgress | null {
    return this.processProgress;
  }

  // ── Phase 6: Extended Creation Mode & Universal Sampler Importer (.sf2 / .sfz) ──

  public listSf2Presets(buffer: ArrayBuffer): Sf2PresetOption[] {
    return parseSf2PresetsList(buffer);
  }

  private applyNativeSamplerImport(imported: NativeSamplerImportResult): Session {
    // Clean slate for new sampler instrument import (SoundFont SF2 / SFZ)
    this.sampleBuffers.clear();
    this.importedSourceBinaries.clear();
    this.assetStore.clearSessionAudioLayers();
    this.ribbonEnvelopeCache.clear();
    this.spectralCache.clear();

    const prevWorkingMode = this.session?.processConfig.workingMode ?? 'extended';
    const prevKeyMappingMode = this.session?.processConfig.keyMappingMode ?? 'chromatic';
    const prevAiConfig = this.session?.processConfig.aiConfig;

    this.session = createInitialSession(imported.presetName);
    this.session.processConfig.workingMode = prevWorkingMode;
    this.session.processConfig.keyMappingMode = prevKeyMappingMode;
    if (prevAiConfig) {
      this.session.processConfig.aiConfig = { ...prevAiConfig };
    }
    // Explicitly reset cover artwork to null for the new instrument
    this.session.processConfig.coverArtwork = null;

    // Assign imported tags & metadata cleanly
    if (imported.metadata) {
      this.session.processConfig.extendedMetadata = {
        ...imported.metadata,
        sourceFormat: imported.sourceFormat,
        sourcePresetName: imported.presetName,
        version: imported.metadata.version || '1.0.0',
      };
    } else {
      this.session.processConfig.extendedMetadata = {
        sourceFormat: imported.sourceFormat,
        sourcePresetName: imported.presetName,
        version: '1.0.0',
      };
    }

    for (const audioFile of imported.audioFiles) {
      try {
        this.registerSampleBuffer(audioFile.name, audioFile.buffer);
      } catch {
        // Keep buffer directly if decode validation warns on large sample
        this.sampleBuffers.set(audioFile.name, audioFile.buffer);
      }
    }

    this.session.name = imported.presetName;
    this.session.extendedRegions = imported.extendedRegions.map(cloneExtendedRegion);
    this.session.zones = imported.classicZones.map((z) => ({ ...z }));
    this.session.articulation = cloneArticulation(imported.articulation);
    this.session.detectedInstrumentCategory = imported.detectedCategory;

    const maxLen = this.session.processConfig.targetFormat === 'modern-neural' ? 32 : 11;
    this.session.processConfig.modelName = imported.presetName.slice(0, maxLen) || imported.modelName;
    this.session.processConfig.expandedName = imported.presetName || imported.modelName;
    this.session.processConfig.parameterSet = imported.suggestedParameterSet;

    this.ensureZoneDemoBuffers(this.session.zones);
    this.clearHistory();
    this.pushHistory(`Import ${imported.sourceFormat.toUpperCase()} "${imported.presetName}"`);
    this.session.dirty = false;
    this.persistToLocalStorage();
    this.emit({ type: 'session-changed', session: this.session });
    return this.session;
  }

  public async importSf2Buffer(buffer: ArrayBuffer, presetIndex = 0): Promise<Session> {
    const imported = importSf2PresetToNative(buffer, presetIndex);
    return this.applyNativeSamplerImport(imported);
  }

  public async importSfzText(
    sfzText: string,
    sfzFileName: string,
    audioFiles: AudioFilePayload[]
  ): Promise<Session> {
    const imported = importSfzToNative(sfzText, sfzFileName, audioFiles);
    return this.applyNativeSamplerImport(imported);
  }

  public getExtendedRegions(): ExtendedRegion[] {
    if (!this.session) return [];
    if (!this.session.extendedRegions || this.session.extendedRegions.length === 0) {
      this.session.extendedRegions = syncExtendedRegionsFromClassicZones(this.session.zones);
    }
    return this.session.extendedRegions.map(cloneExtendedRegion);
  }

  public async updateExtendedRegion(
    regionId: string,
    changes: Partial<ExtendedRegion>
  ): Promise<ExtendedRegion> {
    if (!this.session) throw new Error('No active session');
    if (!this.session.extendedRegions || this.session.extendedRegions.length === 0) {
      this.session.extendedRegions = syncExtendedRegionsFromClassicZones(this.session.zones);
    }
    const idx = this.session.extendedRegions.findIndex((r) => r.id === regionId);
    if (idx < 0) throw new Error(`Extended region '${regionId}' not found`);

    const keys = Object.keys(changes).sort().join(',');
    this.pushHistory(`Update Region ${regionId} (${keys})`, `ext-reg:${regionId}:${keys}`);

    const curr = this.session.extendedRegions[idx];
    const nextLowKey = changes.lowKey !== undefined ? clamp(Math.round(changes.lowKey), 0, 127) : curr.lowKey;
    const nextHighKey = changes.highKey !== undefined ? clamp(Math.round(changes.highKey), nextLowKey, 127) : Math.max(nextLowKey, curr.highKey);
    const nextRootKey = changes.rootKey !== undefined ? clamp(Math.round(changes.rootKey), 0, 127) : curr.rootKey;
    const nextLowVel = changes.lowVel !== undefined ? clamp(Math.round(changes.lowVel), 1, 127) : curr.lowVel;
    const nextHighVel = changes.highVel !== undefined ? clamp(Math.round(changes.highVel), nextLowVel, 127) : Math.max(nextLowVel, curr.highVel);

    const updated: ExtendedRegion = {
      ...curr,
      ...changes,
      id: curr.id,
      lowKey: nextLowKey,
      highKey: nextHighKey,
      rootKey: nextRootKey,
      lowVel: nextLowVel,
      highVel: nextHighVel,
      detune: changes.detune !== undefined ? clamp(Math.round(changes.detune), -99, 99) : curr.detune,
      volume: changes.volume !== undefined ? clamp(Math.round(changes.volume), -32, 12) : curr.volume,
      pan: changes.pan !== undefined ? clamp(Math.round(changes.pan), -50, 50) : curr.pan,
      pitchKeytrack:
        changes.pitchKeytrack !== undefined
          ? clamp(Math.round(changes.pitchKeytrack), 0, 100)
          : curr.pitchKeytrack,
    };

    this.session.extendedRegions[idx] = updated;
    const projected = projectExtendedRegionsToClassicZones(
      this.session.extendedRegions,
      this.session.zones,
    );
    this.session.zones = projected.zones;
    this.markDirty();
    return cloneExtendedRegion(updated);
  }

  public async addExtendedRegion(
    partial?: Partial<ExtendedRegion>,
    anchorRegionId?: string
  ): Promise<ExtendedRegion> {
    if (!this.session) throw new Error('No active session');
    if (!this.session.extendedRegions || this.session.extendedRegions.length === 0) {
      this.session.extendedRegions = syncExtendedRegionsFromClassicZones(this.session.zones);
    }
    this.pushHistory('Add Extended Region');

    const regs = this.session.extendedRegions;
    const anchorIdx = anchorRegionId ? regs.findIndex((r) => r.id === anchorRegionId) : -1;
    const anchorReg = anchorIdx >= 0 ? regs[anchorIdx] : regs[regs.length - 1] ?? null;

    const hasExplicitRange =
      partial?.lowKey !== undefined ||
      partial?.highKey !== undefined ||
      partial?.lowVel !== undefined ||
      partial?.highVel !== undefined;
    const suggestion = hasExplicitRange
      ? null
      : computeNextAvailableExtendedRange(regs, anchorReg);

    if (suggestion?.splitDonorId) {
      const donor = regs.find((r) => r.id === suggestion.splitDonorId);
      if (donor) {
        if (suggestion.splitDonorNewHighKey === -1) {
          donor.lowKey = Math.min(donor.highKey, suggestion.highKey + 1);
          if (donor.rootKey < donor.lowKey) donor.rootKey = donor.lowKey;
        } else if (typeof suggestion.splitDonorNewHighKey === 'number') {
          donor.highKey = Math.max(donor.lowKey, suggestion.splitDonorNewHighKey);
          if (donor.rootKey > donor.highKey) donor.rootKey = donor.highKey;
        }
      }
    }

    const common =
      this.session.processConfig.commonPlayback ?? createDefaultCommonPlayback();
    const nextNum = regs.length + 1;
    // Empty sample by default when creating a new region so the user never confuses it with a duplicate
    const defaultSample = partial?.sampleName ?? '';
    const lowKey = clamp(Math.round(partial?.lowKey ?? suggestion?.lowKey ?? 0), 0, 127);
    const highKey = clamp(Math.round(partial?.highKey ?? suggestion?.highKey ?? 127), lowKey, 127);
    const rootKey = clamp(
      Math.round(partial?.rootKey ?? suggestion?.rootKey ?? Math.round((lowKey + highKey) * 0.5)),
      0,
      127
    );
    const lowVel = clamp(Math.round(partial?.lowVel ?? suggestion?.lowVel ?? 1), 1, 127);
    const highVel = clamp(Math.round(partial?.highVel ?? suggestion?.highVel ?? 127), lowVel, 127);

    const newReg: ExtendedRegion = {
      id: partial?.id ?? `ext-reg-${Date.now().toString(36)}-${nextNum}`,
      sampleName: defaultSample,
      lowKey,
      highKey,
      rootKey,
      lowVel,
      highVel,
      detune: clamp(Math.round(partial?.detune ?? 0), -99, 99),
      volume: clamp(Math.round(partial?.volume ?? 0), -32, 12),
      pan: clamp(Math.round(partial?.pan ?? 0), -50, 50),
      pitchKeytrack: clamp(Math.round(partial?.pitchKeytrack ?? common.pitchKeytrack), 0, 100),
      trigger: partial?.trigger ?? common.trigger,
      seqPosition: partial?.seqPosition,
      seqLength: partial?.seqLength,
      keyFadeIn: Math.max(0, Math.round(partial?.keyFadeIn ?? 0)),
      keyFadeOut: Math.max(0, Math.round(partial?.keyFadeOut ?? 0)),
      velFadeIn: Math.max(0, Math.round(partial?.velFadeIn ?? 0)),
      velFadeOut: Math.max(0, Math.round(partial?.velFadeOut ?? 0)),
      fadeCurve: partial?.fadeCurve ?? common.fadeCurve,
      loopMode: partial?.loopMode ?? common.loopMode,
      loopStart: Math.max(0, Math.round(partial?.loopStart ?? 0)),
      loopEnd: Math.max(0, Math.round(partial?.loopEnd ?? 0)),
      loopCrossfadeMs: Math.max(0, Math.round(partial?.loopCrossfadeMs ?? 0)),
      sampleRate: partial?.sampleRate,
      numChannels: partial?.numChannels,
      hasPlaybackOverride: partial?.hasPlaybackOverride ?? false,
      hasArticulationOverride: partial?.hasArticulationOverride ?? false,
      ampEnvOverride: partial?.ampEnvOverride ? { ...partial.ampEnvOverride } : undefined,
      filterOverride: partial?.filterOverride ? { ...partial.filterOverride } : undefined,
    };

    if (anchorIdx >= 0) {
      regs.splice(anchorIdx + 1, 0, newReg);
    } else {
      regs.push(newReg);
    }
    const projected = projectExtendedRegionsToClassicZones(
      this.session.extendedRegions,
      this.session.zones,
    );
    this.session.zones = projected.zones;
    this.ensureZoneDemoBuffers(this.session.zones);
    this.markDirty();
    return cloneExtendedRegion(newReg);
  }

  public async removeExtendedRegion(regionId: string): Promise<void> {
    if (!this.session) throw new Error('No active session');
    if (!this.session.extendedRegions || this.session.extendedRegions.length <= 1) {
      return;
    }
    this.pushHistory(`Remove Extended Region ${regionId}`);
    this.session.extendedRegions = this.session.extendedRegions.filter((r) => r.id !== regionId);
    const projected = projectExtendedRegionsToClassicZones(
      this.session.extendedRegions,
      this.session.zones,
    );
    this.session.zones = projected.zones;
    this.markDirty();
  }

  public getArticulation(): SynthArticulationConfig {
    if (!this.session) return createDefaultArticulation();
    if (!this.session.articulation) {
      this.session.articulation = createDefaultArticulation();
    }
    return cloneArticulation(this.session.articulation);
  }

  public updateArticulation(changes: Partial<SynthArticulationConfig>): Session {
    if (!this.session) throw new Error('No active session');
    const keys = Object.keys(changes).sort().join(',');
    this.pushHistory(`Update Articulation (${keys})`, `articulation:${keys}`);

    const curr = this.session.articulation
      ? cloneArticulation(this.session.articulation)
      : createDefaultArticulation();

    this.session.articulation = {
      ...curr,
      ...changes,
      ampEnv: changes.ampEnv ? { ...curr.ampEnv, ...changes.ampEnv } : curr.ampEnv,
      modEnv: changes.modEnv ? { ...curr.modEnv, ...changes.modEnv } : curr.modEnv,
      filter: changes.filter ? { ...curr.filter, ...changes.filter } : curr.filter,
      vibLfo: changes.vibLfo ? { ...curr.vibLfo, ...changes.vibLfo } : curr.vibLfo,
      modLfo: changes.modLfo ? { ...curr.modLfo, ...changes.modLfo } : curr.modLfo,
    };

    this.markDirty();
    return this.session;
  }

  // ── Phase 7: Acoustic Intelligence & Auto-Detection ─────

  public autoDetectZonePitchAndParameterSet(
    zoneId?: string,
    applyToSession = true
  ): AcousticClassificationResult {
    if (!this.session) throw new Error('No active session');
    const zone =
      (zoneId ? this.session.zones.find((z) => z.id === zoneId) : null) ??
      this.session.zones[0];
    if (!zone) throw new Error('No zone available for acoustic detection');

    this.ensureZoneDemoBuffers([zone]);
    const sampleName = zone.sampleLow ?? `Zone_${zone.rootKey}.wav`;
    const wavBuffer =
      (zone.sampleLow ? this.sampleBuffers.get(zone.sampleLow) : null) ??
      synthesizeDemoWav('strings', zone.rootKey, 44100, 1.0);

    const decoded = decodeWav(wavBuffer);
    const nominalF0Hz = midiNoteToHz(zone.rootKey);
    const descriptors = extractAcousticDescriptors(
      decoded.channels,
      decoded.sampleRate,
      this.analyzer,
      nominalF0Hz
    );
    const result = classifyAcousticSample(descriptors, sampleName);

    if (applyToSession) {
      this.pushHistory(`Auto-Detect Pitch & Parameter Set (${sampleName})`);
      if (!descriptors.isPercussiveOrNoise && descriptors.pitchConfidence >= 0.35) {
        zone.rootKey = clamp(descriptors.detectedMidiNote, 0, 127);
        zone.detune = clamp(descriptors.detectedCentOffset, -99, 99);
      } else if (
        descriptors.isPercussiveOrNoise &&
        this.session.extendedRegions
      ) {
        const reg = this.session.extendedRegions.find(
          (r) => r.sampleName === zone.sampleLow
        );
        if (reg) {
          reg.pitchKeytrack = 0;
        }
      }
      this.session.processConfig.parameterSet = clamp(
        result.recommendedParameterSet,
        0,
        9
      );
      this.session.detectedInstrumentCategory = result.detectedCategory;
      this.spectralCache.delete(zone.id);
      this.markDirty();
    }

    return result;
  }

  // ── Phase 8: Master Wave Standard (24-bit / 96 kHz), Short-Loop Expansion & Surround ──

  public getZoneSampleFormatInfo(
    zoneId?: string,
    regionId?: string
  ): {
    sampleName: string;
    sampleRate: number;
    bitsPerSample: number;
    numChannels: number;
    durationSec: number;
    totalFrames: number;
    byteSize: number;
    loopStart: number;
    loopEnd: number;
  } | null {
    if (!this.session) return null;
    const isClassic = (this.session.processConfig.workingMode ?? 'classic') === 'classic';
    const extRegions = this.session.extendedRegions ?? [];

    let targetZone = zoneId ? this.session.zones.find((z) => z.id === zoneId) : undefined;
    let targetReg =
      !isClassic && extRegions.length > 0
        ? (regionId
            ? extRegions.find((r) => r.id === regionId)
            : undefined)
        : undefined;

    if (!targetReg && regionId) {
      targetReg = extRegions.find((r) => r.id === regionId);
    }
    if (!targetZone && targetReg) {
      targetZone = this.session.zones.find(
        (z) =>
          targetReg!.id.includes(z.id) ||
          (targetReg!.sampleName && (z.sampleLow === targetReg!.sampleName || z.sampleHigh === targetReg!.sampleName)) ||
          (targetReg!.lowKey === z.lowKey && targetReg!.highKey === z.highKey)
      );
    }
    if (!targetZone) {
      targetZone = this.session.zones[0];
    }
    if (!targetZone && !targetReg) return null;

    const sampleName =
      (isClassic ? targetZone?.sampleLow : (targetReg?.sampleName || targetZone?.sampleLow)) ??
      targetZone?.sampleLow;
    if (!sampleName) return null;

    const buf = this.sampleBuffers.get(sampleName);
    if (!buf) return null;
    try {
      const dec = decodeWav(buf);
      const loopStart =
        targetReg && targetReg.loopEnd > targetReg.loopStart
          ? targetReg.loopStart
          : (dec.instrument?.loopStart ?? 0);
      const loopEnd =
        targetReg && targetReg.loopEnd > targetReg.loopStart
          ? targetReg.loopEnd
          : (dec.instrument?.loopEnd ?? 0);
      return {
        sampleName,
        sampleRate: dec.sampleRate,
        bitsPerSample: dec.bitsPerSample,
        numChannels: dec.numChannels,
        durationSec: Number(dec.durationSec.toFixed(3)),
        totalFrames: dec.mono.length,
        byteSize: buf.byteLength,
        loopStart,
        loopEnd,
      };
    } catch {
      return null;
    }
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

  public async promoteZoneToMasterWave(
    zoneId?: string,
    config?: Partial<MasterWaveConfig>,
    options?: { forceRebuild?: boolean; preserveManualLoops?: boolean }
  ): Promise<MasterWaveResult | null> {
    return promoteZoneToMasterWave(this.importHost(), zoneId, config, options);
  }

  public async promoteAllZonesToMasterWave(
    config?: Partial<MasterWaveConfig>,
    options?: { forceRebuild?: boolean; preserveManualLoops?: boolean }
  ): Promise<MasterWaveResult[]> {
    return promoteAllZonesToMasterWave(this.importHost(), config, options);
  }

  // ── Phase 9: 5-Layer Time Capsule, Provenance & Zero-Generation-Loss Reprocess ──

  public getAssetStoreDiagnostics(): AssetStoreDiagnostics {
    return this.assetStore.getDiagnostics();
  }

  public getModelProvenance(slot?: number): ModelProvenance | null {
    const activeSlot =
      slot ?? this.session?.processConfig.modelNumber ?? 0;
    const stored = this.assetStore.getCapsuleRecordSync(activeSlot);
    if (!this.session) {
      return stored?.provenance ?? null;
    }

    const zones = this.session.zones;
    this.ensureZoneDemoBuffers(zones);
    const rawSourceSamples = new Map<string, ArrayBuffer>();
    const enhancedAudioSamples = new Map<string, ArrayBuffer>();

    for (const z of zones) {
      for (const sName of [z.sampleLow, z.sampleHigh]) {
        if (!sName) continue;
        const rawName = this.assetStore.resolveRawSampleName(sName);
        const rawBuf = this.assetStore.getRawSourceSync(rawName);
        if (rawBuf) {
          rawSourceSamples.set(rawName, rawBuf);
        } else if (
          !this.importedSourceBinaries.has(sName) &&
          !this.assetStore.hasEnhancedAudio(sName)
        ) {
          const activeBuf = this.sampleBuffers.get(sName);
          if (activeBuf) {
            rawSourceSamples.set(sName, activeBuf);
          }
        }
        const enhBuf = this.assetStore.getEnhancedAudioSync(sName);
        if (enhBuf) {
          enhancedAudioSamples.set(sName, enhBuf);
        }
      }
    }

    const modelRecord = this.bank.getModelRecord(activeSlot);
    const classicBins = this.bank.getModelBinaries(activeSlot) ?? [];
    const { provenance } = buildTimeCapsuleEntries({
      slot: activeSlot,
      modelName: this.session.processConfig.modelName,
      processConfig: this.session.processConfig,
      zones,
      extendedRegions: this.session.extendedRegions,
      articulation: this.session.articulation,
      detectedInstrumentCategory: this.session.detectedInstrumentCategory,
      rawSourceSamples,
      legacyOriginalBundle:
        this.assetStore.getLegacyOriginalSlotBundleSync(activeSlot),
      enhancedAudioSamples,
      classicEnhancedBinaries: classicBins,
      neuronikModelJson: modelRecord?.neuronikModelJson,
      previousProvenance:
        this.session.provenance ??
        modelRecord?.provenance ??
        stored?.provenance,
      includeTopLevelCompatibility: false,
    });

    this.session.provenance = provenance;
    return provenance;
  }

  /**
   * Strictly re-processes the active session from its purest origin layer
   * (`01_raw_source` if available, otherwise `02_legacy_original` regenerated into `03_enhanced_audio`),
   * NEVER re-compressing or re-analyzing a degraded `04_classic_enhanced` `.sphere` derivative.
   */
  public async reprocessFromPurestSource(
    options?: ReprocessPurestOptions
  ): Promise<ModelProvenance> {
    if (!this.session) {
      throw new Error('No active session to reprocess');
    }

    const prevProv = this.getModelProvenance();
    const cfg = this.session.processConfig;
    if (options?.dspAlgorithm !== undefined) {
      cfg.dspAlgorithm = options.dspAlgorithm;
    }
    if (options?.complexity !== undefined) {
      cfg.complexity = clamp(Math.round(options.complexity), 1, 10);
    }
    if (options?.parameterSet !== undefined) {
      cfg.parameterSet = clamp(Math.round(options.parameterSet), 0, 9);
    }
    if (options?.masterWaveConfig) {
      cfg.masterWaveConfig = {
        ...DEFAULT_MASTER_WAVE_CONFIG,
        ...(cfg.masterWaveConfig ?? {}),
        ...options.masterWaveConfig,
      };
    }

    let primaryUsed: '01_raw_source' | '02_legacy_original' =
      prevProv?.primarySourceLayer ?? '01_raw_source';

    // Step 1: Restore or promote every zone strictly from its purest origin layer (`01_raw_source` or `02_legacy_original`)
    const shouldPromoteMasterWave =
      options?.promoteToMasterWave ??
      Boolean(prevProv?.masterWavePromoted);

    for (const zone of this.session.zones) {
      const currentLow = zone.sampleLow;
      if (!currentLow) continue;

      const purest = resolvePurestSourceForSample(
        currentLow,
        this.assetStore,
        this.sampleBuffers
      );
      if (!purest) continue;

      primaryUsed = purest.sourceLayer;

      if (shouldPromoteMasterWave || purest.sourceLayer === '02_legacy_original') {
        await this.promoteZoneToMasterWave(zone.id, cfg.masterWaveConfig, {
          forceRebuild: options?.forceRebuild,
          preserveManualLoops: true,
        });
      } else if (purest.sourceLayer === '01_raw_source') {
        // Restore zone directly to unaltered 01_raw_source WAV buffer
        this.sampleBuffers.set(purest.rawSampleName, purest.rawBuffer);
        zone.sampleLow = purest.rawSampleName;
      }
    }

    // Step 2: Increment reprocessCount & record anti-photocopy lineage step
    const nextReprocessCount = (prevProv?.reprocessCount ?? 0) + 1;
    const analysisSource:
      | '01_raw_source'
      | '02_legacy_original'
      | '03_enhanced_audio' =
      shouldPromoteMasterWave || primaryUsed === '02_legacy_original'
        ? '03_enhanced_audio'
        : primaryUsed;

    const reprocessStep = {
      timestamp: new Date().toISOString(),
      sourceLayer: analysisSource,
      targetLayer: '04_classic_enhanced' as const,
      algorithm: `Reprocess#${nextReprocessCount}-NAS-${cfg.dspAlgorithm ?? 'legacy'}-c${cfg.complexity}-ps${cfg.parameterSet}`,
      details: `Zero-generation-loss reprocess #${nextReprocessCount} from purest origin (${primaryUsed} -> ${analysisSource} -> 04_classic_enhanced & 05_extended_model)`,
    };

    if (this.session.provenance) {
      this.session.provenance.reprocessCount = nextReprocessCount;
      this.session.provenance.primarySourceLayer = primaryUsed;
      this.session.provenance.history.push(reprocessStep);
    }

    // Step 3: Run full spectral analysis with `forceReanalyzeImported: true` so it computes fresh
    // `04_classic_enhanced` and `05_extended_model` from `03_enhanced_audio` / `01_raw_source`
    await this.startProcess(this.session.processConfig, {
      forceReanalyzeImported: true,
    });

    const finalProv = this.getModelProvenance()!;
    finalProv.reprocessCount = Math.max(
      finalProv.reprocessCount,
      nextReprocessCount
    );
    finalProv.primarySourceLayer = primaryUsed;
    return finalProv;
  }

  // ── Bank & Export Packaging (delegated to BankService) ──

  public setBankPresets(presets: BankSummary['presets']): void {
    this.bank.setBankPresets(presets);
  }

  public async clearGeneratedModels(): Promise<void> {
    return this.bank.clearGeneratedModels();
  }

  public async loadBank(): Promise<BankSummary> {
    return this.bank.loadBank();
  }

  public buildModelZipBytes(slot: number): Uint8Array {
    return this.bank.buildModelZipBytes(slot);
  }

  public async exportModel(slot: number, targetPath: string): Promise<void> {
    return this.bank.exportModel(slot, targetPath);
  }

  public async saveToAxionikDb(options?: {
    customSlug?: string;
    customName?: string;
    saveAs?: boolean;
    sublibrary?: string;
    sublibraryOrdinal?: number;
  }): Promise<{ slug: string; path: string; isBridge: boolean; count: number; sublibrary: string }> {
    return this.bank.saveToAxionikDb(options);
  }

  public async listSublibraries(): Promise<import('./types.ts').SublibraryInfo[]> {
    return this.bank.listSublibraries();
  }

  public async createSublibrary(name: string, description?: string, order?: number): Promise<import('./types.ts').SublibraryInfo> {
    return this.bank.createSublibrary(name, description, order);
  }

  public async deleteSublibrary(name: string): Promise<void> {
    return this.bank.deleteSublibrary(name);
  }

  public async moveModelToSublibrary(slugOrSlot: string | number, targetSublibrary: string): Promise<void> {
    return this.bank.moveModelToSublibrary(slugOrSlot, targetSublibrary);
  }

  public async reorderModelsInSublibrary(sublibrary: string, orderedSlugsOrSlots: Array<string | number>): Promise<void> {
    return this.bank.reorderModelsInSublibrary(sublibrary, orderedSlugsOrSlots);
  }

  public exportZoneAsAiff(zoneId: string): { filename: string; bytes: Uint8Array } {
    return this.bank.exportZoneAsAiff(zoneId);
  }

  public async importModel(
    _sourcePath: string,
    slot: number
  ): Promise<GeneratedModel> {
    return this.bank.importModel(_sourcePath, slot);
  }

  // ── Phase 13: Interactive Waveform Loop Editor ──────────

  public getZoneLoopEditorData(
    zoneId?: string,
    regionId?: string
  ): ZoneLoopEditorData | null {
    if (!this.session) return null;
    const isClassic = (this.session.processConfig.workingMode ?? 'classic') === 'classic';
    const extRegions = this.getExtendedRegions();

    let targetZone = zoneId ? this.session.zones.find((z) => z.id === zoneId) : undefined;
    let activeReg =
      !isClassic && extRegions.length > 0
        ? (regionId
            ? extRegions.find((r) => r.id === regionId)
            : targetZone
              ? extRegions.find(
                  (r) =>
                    r.id.includes(targetZone!.id) ||
                    (targetZone!.sampleLow && r.sampleName === targetZone!.sampleLow) ||
                    (r.lowKey === targetZone!.lowKey && r.highKey === targetZone!.highKey)
                )
              : undefined)
        : (regionId ? extRegions.find((r) => r.id === regionId) ?? null : null);

    if (!activeReg && !isClassic && extRegions.length > 0) {
      activeReg = extRegions[0];
    }
    if (!targetZone) {
      if (activeReg) {
        targetZone = this.session.zones.find(
          (z) =>
            activeReg!.id.includes(z.id) ||
            (activeReg!.sampleName && (z.sampleLow === activeReg!.sampleName || z.sampleHigh === activeReg!.sampleName)) ||
            (activeReg!.lowKey === z.lowKey && activeReg!.highKey === z.highKey)
        );
      }
      if (!targetZone) {
        targetZone = this.session.zones[0];
      }
    }

    if (!targetZone && !activeReg) return null;

    const sampleName =
      (isClassic
        ? (targetZone?.sampleLow || targetZone?.sampleHigh)
        : (activeReg?.sampleName || targetZone?.sampleLow || targetZone?.sampleHigh)) || undefined;

    const rootKey =
      (isClassic ? targetZone?.rootKey : (activeReg?.rootKey ?? targetZone?.rootKey)) ?? 60;

    let raw: ArrayBuffer | undefined = this.lookupSampleBuffer(sampleName);
    let effectiveSampleName = sampleName;

    if (!raw) {
      const demoKey = `__demo_${(activeReg?.id ?? targetZone?.id ?? 'zone').replace(/[^a-zA-Z0-9_-]/g, '_')}_k${rootKey}.wav`;
      raw = this.sampleBuffers.get(demoKey);
      if (!raw) {
        raw = synthesizeDemoWav('strings', rootKey, 44100, 1.0);
        this.sampleBuffers.set(demoKey, raw);
      }
      effectiveSampleName = demoKey;
    }

    let decoded: DecodedWav;
    try {
      decoded = decodeWav(raw);
    } catch {
      raw = synthesizeDemoWav('strings', rootKey, 44100, 1.0);
      decoded = decodeWav(raw);
    }

    const totalFrames = Math.max(1, decoded.numSamples);
    const defaultLoopStart =
      decoded.instrument?.loopStart ?? Math.floor(totalFrames * 0.2);
    const defaultLoopEnd =
      decoded.instrument?.loopEnd && decoded.instrument.loopEnd > defaultLoopStart
        ? decoded.instrument.loopEnd
        : Math.floor(totalFrames * 0.85);

    const commonMode = this.session.processConfig.commonPlayback?.loopMode;
    const loopMode = activeReg?.hasPlaybackOverride
      ? (activeReg.loopMode ?? 'no_loop')
      : (commonMode && commonMode !== 'no_loop' ? commonMode : (activeReg?.loopMode ?? 'no_loop'));
    const loopStart =
      activeReg && activeReg.loopEnd > activeReg.loopStart
        ? clamp(activeReg.loopStart, 0, Math.max(0, totalFrames - 2))
        : clamp(defaultLoopStart, 0, Math.max(0, totalFrames - 2));
    const loopEnd =
      activeReg && activeReg.loopEnd > activeReg.loopStart
        ? clamp(activeReg.loopEnd, loopStart + 1, totalFrames)
        : clamp(defaultLoopEnd, loopStart + 1, totalFrames);
    const loopCrossfadeMs = activeReg?.loopCrossfadeMs ?? 15;
    const hasExplicitLoopPoints = Boolean(
      (activeReg && activeReg.loopEnd > activeReg.loopStart) ||
        (decoded.instrument?.loopEnd &&
          decoded.instrument.loopEnd > (decoded.instrument.loopStart ?? 0))
    );

    return {
      zoneId: targetZone?.id ?? 'zone-1',
      regionId: activeReg?.id,
      hasExplicitLoopPoints,
      sampleName: effectiveSampleName ?? 'Demo_Sample.wav',
      sampleRate: decoded.sampleRate,
      bitsPerSample: decoded.bitsPerSample,
      byteSize: raw?.byteLength ?? 0,
      numChannels: decoded.numChannels,
      totalFrames,
      durationSec: decoded.durationSec,
      monoPcm: decoded.mono,
      loopMode,
      loopStart,
      loopEnd,
      loopCrossfadeMs,
      rootKey,
    };
  }

  /**
   * Loop Editor audition ("Play Loop"): always loops between the editor markers
   * (falling back to Forward Loop when the region has no loop mode yet) and starts
   * at the loop start so the seam is heard immediately.
   */
  public async auditionLoop(
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
  ): Promise<void> {
    const data = this.getZoneLoopEditorData(zoneId, opts?.regionId);
    if (!data) return;
    const loopEnabled = opts?.loopEnabled !== false;
    const isLoopingMode = data.loopMode !== 'no_loop' && data.loopMode !== 'one_shot';
    await this.playLoopEditorData(data, {
      ...opts,
      loopEnabled,
      loopMode: loopEnabled && !isLoopingMode ? 'loop_continuous' : data.loopMode,
      startFromLoopStart: loopEnabled,
    });
  }

  /**
   * Row audition (▶ in the zone/region table): plays exactly the row's sample from
   * 0 s with its volume, pan, detune and amp envelope. Loops only when the row has a
   * looping mode AND explicit loop points (region or WAV `smpl` chunk).
   * Shares sample resolution with the Loop Editor (`getZoneLoopEditorData`).
   */
  public async auditionRow(opts: {
    zoneId?: string;
    regionId?: string;
  }): Promise<void> {
    const data = this.getZoneLoopEditorData(opts.zoneId, opts.regionId);
    if (!data) return;
    const isLoopingMode = data.loopMode !== 'no_loop' && data.loopMode !== 'one_shot';
    const loopEnabled = isLoopingMode && Boolean(data.hasExplicitLoopPoints);
    await this.playLoopEditorData(data, {
      loopEnabled,
      loopMode: loopEnabled ? data.loopMode : 'no_loop',
      startFromLoopStart: false,
    });
  }

  private async playLoopEditorData(
    data: ZoneLoopEditorData,
    opts: {
      loopStartFrame?: number;
      loopEndFrame?: number;
      loopEnabled: boolean;
      loopMode: LoopMode;
      startFromLoopStart: boolean;
      volumeDb?: number;
      pan?: number;
      detuneCents?: number;
      ampEnv?: DahdsrEnvelope;
    }
  ): Promise<void> {
    if (!this.session) return;
    let { volumeDb, pan, detuneCents, ampEnv } = opts;

    // Use the ids actually resolved by getZoneLoopEditorData (never the UI selection)
    const reg = data.regionId
      ? this.session.extendedRegions?.find((r) => r.id === data.regionId)
      : undefined;
    if (reg) {
      if (volumeDb === undefined) volumeDb = reg.volume;
      if (pan === undefined) pan = reg.pan;
      if (detuneCents === undefined) detuneCents = reg.detune;
      if (ampEnv === undefined) {
        const globalEnv = this.session.articulation?.ampEnv;
        if (reg.hasArticulationOverride && reg.ampEnvOverride && globalEnv) {
          ampEnv = { ...globalEnv, ...reg.ampEnvOverride };
        } else if (globalEnv && this.session.articulation?.ampEnvEnabled !== false) {
          ampEnv = globalEnv;
        }
      }
    } else {
      const zone = this.session.zones.find((z) => z.id === data.zoneId);
      if (zone) {
        if (volumeDb === undefined) volumeDb = zone.volume;
        if (pan === undefined) pan = zone.pan;
        if (detuneCents === undefined) detuneCents = zone.detune;
        if (ampEnv === undefined && this.session.articulation?.ampEnv && this.session.articulation.ampEnvEnabled) {
          ampEnv = this.session.articulation.ampEnv;
        }
      }
    }

    const startFrame =
      opts.loopStartFrame !== undefined && opts.loopStartFrame >= 0
        ? opts.loopStartFrame
        : data.loopStart;
    const endFrame =
      opts.loopEndFrame !== undefined && opts.loopEndFrame > startFrame
        ? opts.loopEndFrame
        : data.loopEnd;

    await this.preview.auditionLoopSample({
      sampleName: data.sampleName,
      rootKey: data.rootKey,
      loopStartFrame: startFrame,
      loopEndFrame: endFrame,
      loopEnabled: opts.loopEnabled,
      loopMode: opts.loopMode,
      loopCrossfadeMs: data.loopCrossfadeMs,
      volumeDb,
      pan,
      detuneCents,
      ampEnv,
      startFromLoopStart: opts.startFromLoopStart,
    });
  }

  public updateLiveLoopPoints(
    loopStartFrame: number,
    loopEndFrame: number,
    sampleRate: number,
    loopEnabled: boolean = true
  ): void {
    this.preview.updateLiveLoopPoints(
      loopStartFrame,
      loopEndFrame,
      sampleRate,
      loopEnabled
    );
  }

  // ── Phase 14: Model Cover Artwork (.webp) — Exclusive to Extended Mode ──

  public setModelCoverArtwork(artwork: ModelCoverArtwork | null): Session {
    if (!this.session) throw new Error('No active session');
    this.pushHistory(
      artwork ? 'Set Model Cover Artwork (.webp)' : 'Remove Model Cover Artwork',
      'config:coverArtwork'
    );
    this.session.processConfig.coverArtwork = artwork ? { ...artwork } : null;
    const slot = this.session.processConfig.modelNumber;
    const existingModel = this.bank.getModelRecord(slot);
    if (existingModel) {
      existingModel.coverWebpDataUrl = artwork?.webpDataUrl;
      this.bank.upsertModel(existingModel);
      this.bank.persistBank();
    }
    this.markDirty();
    return this.session;
  }

  public async convertAndSetModelCoverArtwork(
    input: File | Blob | ArrayBuffer | Uint8Array,
    originalName?: string
  ): Promise<ModelCoverArtwork> {
    if (!this.session) throw new Error('No active session');
    const converted = await convertImageToCoverWebp(input, {
      originalName,
    });
    this.setModelCoverArtwork(converted.artwork);
    return converted.artwork;
  }

  // ── Private Helpers ─────────────────────────────────────

  /**
   * Resolves a sample's WAV buffer by exact name, then basename, then from the
   * persisted `NeuronAssetStore` (Layer 01 raw source / Layer 03 enhanced audio,
   * hydrated from IndexedDB on startup). Store hits are cached in `sampleBuffers`.
   */
  private lookupSampleBuffer(name: string | null | undefined): ArrayBuffer | undefined {
    if (!name) return undefined;
    const base = name.split(/[\\/]/).pop() || name;
    const candidates = base !== name ? [name, base] : [name];
    for (const key of candidates) {
      const hit = this.sampleBuffers.get(key);
      if (hit) return hit;
    }
    for (const key of candidates) {
      const stored =
        this.assetStore.getRawSourceSync(key) ?? this.assetStore.getEnhancedAudioSync(key);
      if (stored) {
        this.sampleBuffers.set(name, stored);
        return stored;
      }
    }
    return undefined;
  }

  /**
   * After a page reload `sampleBuffers` is empty: repopulate it from the
   * IndexedDB-hydrated asset store for every sample referenced by the session
   * (classic zones and extended regions) before any demo fallback is synthesized.
   */
  private rehydrateSessionSampleBuffers(): void {
    if (!this.session) return;
    const names = new Set<string>();
    for (const z of this.session.zones) {
      if (z.sampleLow) names.add(z.sampleLow);
      if (z.sampleHigh) names.add(z.sampleHigh);
    }
    for (const r of this.session.extendedRegions ?? []) {
      if (r.sampleName) names.add(r.sampleName);
    }
    for (const n of names) this.lookupSampleBuffer(n);
  }

  private ensureZoneDemoBuffers(zones: Zone[]): void {
    for (const z of zones) {
      if (z.sampleLow && !this.lookupSampleBuffer(z.sampleLow)) {
        const lower = z.sampleLow.toLowerCase();
        const timbre = lower.includes('bass')
          ? 'bass'
          : lower.includes('piano')
            ? 'piano'
            : lower.includes('bell')
              ? 'bell'
              : lower.includes('pad')
                ? 'pad'
                : 'strings';
        this.sampleBuffers.set(
          z.sampleLow,
          synthesizeDemoWav(timbre, z.rootKey, 44100, 1.0)
        );
      }
    }
  }

  // ── Phase 16: Universal Raw Multi-Format Sampler Exporter ─
  analyzeRawSamplerPreflight(options: RawExportOptions): RawSamplerPreflightReport {
    if (!this.session) {
      throw new Error('No active session initialized');
    }
    return analyzeRawSamplerPreflight(this.session, options, (name) => this.getSampleBuffer(name));
  }

  exportRawSampler(options: RawExportOptions): Promise<RawExportResult> {
    if (!this.session) {
      throw new Error('No active session initialized');
    }
    return exportRawSamplerLibrary(this.session, options, (name) => this.getSampleBuffer(name));
  }

  private terminateWorker(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  private markDirty(): void {
    if (this.session) {
      this.session.dirty = true;
      this.session.modifiedAt = new Date().toISOString();
      this.persistToLocalStorage();
      this.emit({ type: 'session-changed', session: this.session });
    }
  }

  private persistToLocalStorage(): void {
    persistSessionToLocalStorage(this.session);
    this.bank.persistBank();
  }

  private restoreFromLocalStorage(): void {
    const restored = restoreSessionFromLocalStorage();
    if (restored) {
      this.session = restored;
      this.rehydrateSessionSampleBuffers();
      this.ensureZoneDemoBuffers(this.session.zones);
    }
    this.bank.restoreBank();
  }
}
