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
  type ZoneBinaryPair,
  type PreservedSourceBinary,
} from './dsp/PipelineRunner.ts';
import { SpectralAnalyzer } from './dsp/SpectralAnalyzer.ts';
import { computeStft } from './dsp/FftEngine.ts';
import { buildLayerView } from './dsp/GridIndicator.ts';
import {
  NEURON_SAMPLE_RATE,
  complexityToLimits,
  resynthesizeModelToPcm,
} from './dsp/ScapeSphereGenerator.ts';
import {
  parseModelFileSet,
  convertLegacyModelToModern,
  parseNeuronScape,
  parseNeuronSphere,
  resynthesizeNeuronModelSource,
} from '@abdsynths/shared/formats/neuron';

import { parseSessionJson } from './sessionSchema.ts';
import {
  persistSessionToLocalStorage,
  restoreSessionFromLocalStorage,
} from './sessionPersistence.ts';
import { AudioPreviewService } from './audioPreview.ts';
import { BankService, BankLoadError, buildBankLoadPlan } from './bankService.ts';
import { SessionHistory } from './sessionHistory.ts';
import { createInitialSession, createZone } from './sessionFactory.ts';
import {
  DEFAULT_MODEL_NAMES,
  deriveModelNameFromSample,
  parseSampleFilenameByName,
} from './sampleNaming.ts';
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
  private readonly analyzer: SpectralAnalyzer = new SpectralAnalyzer();

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
    getSampleBuffer: (name: string) => this.sampleBuffers.get(name),
    setSampleBuffer: (name: string, buffer: ArrayBuffer) => {
      this.sampleBuffers.set(name, buffer);
    },
    getResynthMono: (zoneId: string) => this.spectralCache.get(zoneId)?.resynthMono,
    ensureSpectrum: (zoneId: string) => {
      this.inspectZoneSpectrum(zoneId);
    },
  });
  private readonly spectralCache: Map<
    string,
    { key: string; inspection: ZoneSpectralInspection; resynthMono: Float32Array }
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
   */
  public static readonly MAX_IMPORT_FILE_BYTES = 50 * 1024 * 1024;
  public static readonly MAX_IMPORT_FILES = 128;

  // ── Lifecycle ───────────────────────────────────────────

  public async init(): Promise<void> {
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
    this.ensureZoneDemoBuffers(newSession.zones);
    this.persistToLocalStorage();
    this.emit({ type: 'session-changed', session: newSession });
    return newSession;
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
    this.history.push(
      { zones: this.session.zones, processConfig: this.session.processConfig },
      label,
      coalesceKey
    );
    this.emit({ type: 'history-changed', history: this.getHistoryState() });
  }

  public getHistoryState(): HistoryState {
    return this.history.getState();
  }

  private applyHistoryDocument(doc: { zones: Zone[]; processConfig: ProcessConfig }): void {
    if (!this.session) return;
    this.session.zones = structuredClone(doc.zones);
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
      zones: this.session.zones,
      processConfig: this.session.processConfig,
    });
    if (!restored) return null;
    this.applyHistoryDocument(restored);
    return this.session;
  }

  public redo(): Session | null {
    if (!this.session) return null;
    const restored = this.history.redo({
      zones: this.session.zones,
      processConfig: this.session.processConfig,
    });
    if (!restored) return null;
    this.applyHistoryDocument(restored);
    return this.session;
  }

  public updateProcessConfig(changes: Partial<ProcessConfig>): Session {
    if (!this.session) throw new Error('No active session');
    const keys = Object.keys(changes).sort().join(',');

    const cfg = this.session.processConfig;
    if (changes.modelNumber !== undefined) {
      cfg.modelNumber = clamp(Math.round(changes.modelNumber), 0, 511);
    }
    if (changes.modelName !== undefined) {
      const maxLen = (changes.targetFormat ?? cfg.targetFormat) === 'modern-neural' ? 32 : 11;
      const trimmed = changes.modelName.replace(/[\r\n\t]/g, '').slice(0, maxLen);
      cfg.modelName = trimmed.length > 0 ? trimmed : 'UNTITLED';
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
      // P1.3: extended editing only exists behind modern-neural; leaving
      // it silently on would fork behavior on the legacy binary path.
      if (cfg.targetFormat !== 'modern-neural' && cfg.workingMode === 'extended') {
        cfg.workingMode = 'classic';
      }
    }
    if (changes.workingMode !== undefined) {
      if (changes.workingMode !== 'classic' && changes.workingMode !== 'extended') {
        throw new Error("Invalid workingMode: must be 'classic' | 'extended'");
      }
      if (changes.workingMode === 'extended' && cfg.targetFormat !== 'modern-neural') {
        throw new Error("workingMode 'extended' requires targetFormat 'modern-neural'");
      }
      cfg.workingMode = changes.workingMode;
    }

    // History AFTER validation: a rejected change (e.g. extended without
    // modern-neural) must not leave a phantom undo step behind.
    this.pushHistory(`Change Process Settings (${keys})`, `config:${keys}`);
    this.markDirty();
    return this.session;
  }

  public resetZonesToSingle(): Session {
    if (!this.session) throw new Error('No active session');
    this.pushHistory('Reset to Single 0..127 Zone');
    this.session.zones = [createZone(0, 60, 127, null)];
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

    // If host only spans 1 key or splitPoint === host.lowKey, adjust split safely
    const splitPoint =
      rootKey > host.lowKey
        ? rootKey
        : Math.min(host.highKey, host.lowKey + 1);

    const effectiveSampleLow =
      samplePath !== undefined ? samplePath : host.sampleLow;
    const newZone = createZone(
      splitPoint,
      Math.max(splitPoint, Math.min(host.highKey, rootKey)),
      host.highKey,
      effectiveSampleLow
    );
    if (samplePath === undefined) {
      newZone.sampleHigh = host.sampleHigh;
      newZone.velSplit = 64;
      newZone.detune = host.detune;
      newZone.volume = host.volume;
      newZone.pan = host.pan;
    }
    host.highKey = Math.max(host.lowKey, splitPoint - 1);
    if (host.rootKey > host.highKey) {
      host.rootKey = host.highKey;
    }

    zones.splice(hostIdx + 1, 0, newZone);
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
    wavBuffer: ArrayBuffer
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
    return decoded;
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
    return buildZoneRibbonWaveforms({
      lowOriginal: getSampleEnvelope(store, zone.sampleLow, zone.rootKey),
      highOriginal: zone.sampleHigh
        ? getSampleEnvelope(store, zone.sampleHigh, zone.rootKey)
        : null,
      resynthMono: this.spectralCache.get(zone.id)?.resynthMono ?? null,
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
   *   - 2D STFT spectrogram grid (normalized 0..1 dB magnitudes)
   *   - Temporal partial tracks (1..64) tagged with clustered layer index (0..3)
   *   - Downsampled waveform envelopes [min, max] for both Original (A) and Resynthesis (B)
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
    const cacheKey = `${zone.id}|${sampleName}|${wavBuffer.byteLength}|${zone.rootKey}|${zone.detune}|${cfg.complexity}|${cfg.parameterSet}`;
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
    const layerView = buildLayerView(spectralModel, this.analyzer.lastOctaveFold());

    const isImportedModelSource = Boolean(
      zone.sampleLow && this.importedSourceBinaries.has(zone.sampleLow)
    );
    const resynthDuration = Math.min(2.5, Math.max(0.6, decoded.durationSec));
    const resynthMono = isImportedModelSource
      ? decoded.mono
      : resynthesizeModelToPcm(
          spectralModel,
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

    // Compute 2D STFT spectrogram (up to 40 time columns x 96 frequency bins)
    const maxAnalysisSamples = Math.min(
      decoded.mono.length,
      Math.floor(decoded.sampleRate * 3.0)
    );
    const stftSlice = decoded.mono.subarray(0, maxAnalysisSamples);
    const frameSize = 2048;
    const hopSize = Math.max(
      256,
      Math.floor(Math.max(1, stftSlice.length - frameSize) / 36)
    );
    const stft = computeStft(stftSlice, {
      frameSize,
      hopSize,
      windowType: 'blackman-harris',
      sampleRate: decoded.sampleRate,
    });

    const maxFreqHz = Math.min(
      decoded.sampleRate * 0.45,
      Math.max(4500, summary.detectedF0Hz * 36)
    );
    const maxBin = Math.max(
      16,
      Math.min(stft.numBins - 1, Math.round(maxFreqHz / stft.binWidthHz))
    );
    const displayBins = 96;

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
        // Normalize [-72 dB .. 0 dB] -> [0 .. 1]
        col[dbIdx] = Number(
          clamp((relDb + 72) / 72, 0, 1).toFixed(3)
        );
      }
      magnitudes.push(col);
    }

    // Build temporal partial trajectories (1..64) with layer assignment
    const partialTracks: SpectralPartialTrack[] = [];
    for (let k = 0; k < 64; k++) {
      const assignedLayer = Math.max(0, layerView.layerOfPartial[k]);
      const peakAmp = layerView.peakOfPartial[k];
      if (peakAmp < 1e-4 && (summary.amplitudes[k] ?? 0) < 1e-4) continue;

      const nFrames = Math.max(1, spectralModel.numFramesOf(assignedLayer));
      const frames: { timeNorm: number; freqHz: number; amplitude: number }[] = [];
      let ampSum = 0;

      for (let f = 0; f < nFrames; f++) {
        const timeNorm = nFrames > 1 ? f / (nFrames - 1) : 0;
        const amp = Math.abs(spectralModel.ampAt(assignedLayer, f, k));
        const offHz = spectralModel.offsetAt(assignedLayer, f, k);
        const f0Frame =
          spectralModel.f0AtLayer(assignedLayer, f) > 0
            ? spectralModel.f0AtLayer(assignedLayer, f)
            : summary.detectedF0Hz;
        const freqHz = Math.max(20, (k + 1) * f0Frame + offHz);
        ampSum += amp;
        frames.push({
          timeNorm: Number(timeNorm.toFixed(3)),
          freqHz: Number(freqHz.toFixed(2)),
          amplitude: Number(amp.toFixed(4)),
        });
      }

      if (frames.length === 1) {
        frames.push({ ...frames[0], timeNorm: 1.0 });
      }

      partialTracks.push({
        partialIndex: k + 1,
        harmonicMultiple: k + 1,
        layerIndex: assignedLayer,
        meanAmplitude: Number((ampSum / Math.max(1, nFrames)).toFixed(4)),
        frames,
      });
    }

    const inspection: ZoneSpectralInspection = {
      zoneId: zone.id,
      sampleName,
      sampleRate: decoded.sampleRate,
      durationSec: Number(decoded.durationSec.toFixed(3)),
      summary,
      waveformPeaks,
      resynthPeaks,
      spectrogram: {
        frameCount: magnitudes.length,
        binCount: displayBins,
        maxFreqHz: Math.round(maxFreqHz),
        magnitudes,
      },
      partialTracks,
    };

    this.spectralCache.set(zone.id, {
      key: cacheKey,
      inspection,
      resynthMono,
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
   * Plays either the Original sample ('original') or the additive Scape/Sphere
   * neural resynthesis ('resynthesis') for `zoneId`, optionally pitch-shifted to `targetNote`.
   */
  public async auditionZoneComparison(
    zoneId: string,
    mode: 'original' | 'resynthesis',
    targetNote?: MidiNote
  ): Promise<void> {
    return this.preview.auditionZoneComparison(zoneId, mode, targetNote);
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
    mode: 'original' | 'resynthesis' | null;
  } {
    return this.preview.getRealtimeSpectrum();
  }


  public async importSamplesFromFolder(_folderPath: string): Promise<Zone[]> {
    if (!this.session) await this.newSession('Imported Multisample');
    this.pushHistory('Import Samples Folder');
    this.session!.zones = [
      createZone(0, 24, 35, 'Bass_24_C1.wav'),
      createZone(36, 60, 71, 'Piano_60_C4.wav'),
      createZone(72, 84, 95, 'Strings_84_C6.wav'),
      createZone(96, 108, 127, 'Pad_108_C8.wav'),
    ];
    this.ensureZoneDemoBuffers(this.session!.zones);
    this.markDirty();
    return this.session!.zones;
  }

  /**
   * Imports real binary WAV / AIFF files selected via File Picker or Drag & Drop.
   *
   * Supports both original MODELmaker v1.2 workflows:
   * - `mode === 'samples'` (`Ctrl-I` / Import Samples): reads AIFF `INST` / WAV `smpl`
   *   embedded metadata (`rootKey`, `lowKey`, `lowVelocity < 64` vs `>= 64`, `detune`),
   *   with fallback to pitch detection (`detectPitch`) or filename parsing.
   * - `mode === 'by-name'` (`Ctrl-N` / Import by Name): ignores embedded `INST` metadata
   *   and parses `name_rootkey_lowkey[_v1|_v2]` / `name-Note[_high]` per `KeyZoneData.class`,
   *   merges `v1` (Low Velocity) and `v2` (High Velocity) layers sharing the same `lowKey`,
   *   sorts ascending by `lowKey`, sets `zone[i].highKey = zone[i+1].lowKey - 1`,
   *   `zone[0].lowKey = 0`, and `zone[last].highKey = 127`.
   */
  public async importAudioFiles(
    files: { name: string; buffer: ArrayBuffer }[],
    mode: 'samples' | 'by-name' = 'samples'
  ): Promise<Zone[]> {
    // Filter out macOS AppleDouble resource forks (._* / __MACOSX) and tiny non-audio stubs
    const candidateFiles = files.filter((f) => {
      const normalized = f.name.replace(/\\/g, '/');
      if (normalized.includes('__MACOSX/')) return false;
      const base = normalized.split('/').pop() ?? normalized;
      if (base.startsWith('.') || base.startsWith('._')) return false;
      return f.buffer && f.buffer.byteLength >= 44;
    });

    if (candidateFiles.length === 0) return this.getZones();
    // P0.3: bound memory and zone count before decoding anything.
    if (candidateFiles.length > WebAudioPipeline.MAX_IMPORT_FILES) {
      throw new Error(
        `Too many files for import (${candidateFiles.length}, max ${WebAudioPipeline.MAX_IMPORT_FILES})`
      );
    }
    const oversizedNames = candidateFiles
      .filter((f) => f.buffer.byteLength > WebAudioPipeline.MAX_IMPORT_FILE_BYTES)
      .map((f) => f.name);
    if (oversizedNames.length === candidateFiles.length) {
      throw new Error(
        `All ${candidateFiles.length} file(s) exceed the ${WebAudioPipeline.MAX_IMPORT_FILE_BYTES / (1024 * 1024)} MB per-file import limit: ${oversizedNames.slice(0, 3).join(', ')}${oversizedNames.length > 3 ? ', …' : ''}`
      );
    }
    if (!this.session) await this.newSession('Imported Multisample');

    interface ParsedSampleItem {
      name: string;
      rootKey: MidiNote;
      lowKey: MidiNote | null;
      isHighVelocity: boolean;
      detune: number;
    }

    const items: ParsedSampleItem[] = [];
    const skippedNames: string[] = [...oversizedNames];
    for (const f of candidateFiles) {
      if (f.buffer.byteLength > WebAudioPipeline.MAX_IMPORT_FILE_BYTES) {
        // Skip without decoding: fully buffered in memory by decodeWav
        continue;
      }
      let decoded: ReturnType<typeof this.registerSampleBuffer>;
      try {
        decoded = this.registerSampleBuffer(f.name, f.buffer);
      } catch {
        // Skip invalid/corrupt or non-audio files in folder imports
        skippedNames.push(f.name);
        continue;
      }

      const baseName = (f.name.split(/[\\/]/).pop() ?? f.name);
      const byName = parseSampleFilenameByName(baseName, -1 as MidiNote);
      // Only assign High Velocity (64..127) when deduced from the filename (_v2, _high, etc.)
      const isHighVelocity = byName.isHighVelocity;

      if (mode === 'by-name') {
        const rk = byName.rootKey >= 0 && byName.rootKey <= 127 ? byName.rootKey : 60;
        const lk = byName.lowKey >= 0 && byName.lowKey <= 127 ? byName.lowKey : rk;
        items.push({
          name: baseName,
          rootKey: rk,
          lowKey: lk,
          isHighVelocity,
          detune: 0,
        });
        continue;
      }

      const inst = decoded.instrument;
      let rootKey: MidiNote;
      if (byName.rootKey >= 0 && byName.rootKey <= 127) {
        rootKey = byName.rootKey;
      } else if (inst && inst.rootKey >= 0 && inst.rootKey <= 127) {
        rootKey = inst.rootKey;
      } else {
        const detectedHz = this.analyzer.detectPitch(
          decoded.channels[0],
          decoded.sampleRate
        );
        rootKey =
          detectedHz > 20
            ? Math.max(
                0,
                Math.min(127, Math.round(69 + 12 * Math.log2(detectedHz / 440)))
              )
            : 60;
      }

      const hasExplicitNameLowKey =
        byName.lowKey >= 0 &&
        byName.lowKey <= 127 &&
        byName.lowKey !== byName.rootKey;
      const hasExplicitInstLowKey =
        inst !== undefined &&
        inst.lowKey >= 0 &&
        inst.lowKey <= 127 &&
        !(inst.lowKey === 0 && inst.highKey === 127 && candidateFiles.length > 1);

      const lowKey = hasExplicitNameLowKey
        ? byName.lowKey
        : hasExplicitInstLowKey
          ? inst!.lowKey
          : null;

      items.push({
        name: baseName,
        rootKey,
        lowKey,
        isHighVelocity,
        detune: inst?.detune ?? 0,
      });
    }

    if (items.length === 0) {
      const skipped = skippedNames.length > 0 ? ` Skipped: ${skippedNames.slice(0, 3).join(', ')}${skippedNames.length > 3 ? ', …' : ''}.` : '';
      throw new Error(`No valid WAV or AIFF audio files could be decoded.${skipped}`);
    }

    this.pushHistory(`Import ${items.length} Sample(s)`);

    items.sort((a, b) => {
      const keyA = a.lowKey ?? a.rootKey;
      const keyB = b.lowKey ?? b.rootKey;
      if (keyA !== keyB) return keyA - keyB;
      if (a.rootKey !== b.rootKey) return a.rootKey - b.rootKey;
      return (a.isHighVelocity ? 1 : 0) - (b.isHighVelocity ? 1 : 0);
    });

    // Only merge two samples into the same zone (Low Vel + High Vel) when they share the same key
    // AND one of them is explicitly marked as High Velocity in its filename (_v2, _high, etc.).
    const grouped: {
      rootKey: MidiNote;
      lowKey: MidiNote | null;
      sampleLow: string | null;
      sampleHigh: string | null;
      velSplit: number;
      detune: number;
    }[] = [];

    for (const item of items) {
      const itemKey = item.lowKey ?? item.rootKey;
      const match = grouped.find((g) => {
        const gKey = g.lowKey ?? g.rootKey;
        if (gKey !== itemKey) return false;
        return item.isHighVelocity ? g.sampleHigh === null : g.sampleLow === null;
      });

      if (match && (item.isHighVelocity || match.sampleLow === null)) {
        if (item.isHighVelocity) {
          match.sampleHigh = item.name;
        } else {
          match.sampleLow = item.name;
        }
      } else {
        grouped.push({
          rootKey: item.rootKey,
          lowKey: item.lowKey,
          sampleLow: item.isHighVelocity ? null : item.name,
          sampleHigh: item.isHighVelocity ? item.name : null,
          velSplit: 64,
          detune: item.detune,
        });
      }
    }

    // Ensure every zone has a primary sampleLow (if a lone _v2 file had no _v1 pair, promote it to sampleLow)
    for (const g of grouped) {
      if (!g.sampleLow && g.sampleHigh) {
        g.sampleLow = g.sampleHigh;
        g.sampleHigh = null;
      }
    }

    // Compute strictly monotonic lowKeys first, then set highKey[i] = lowKey[i+1] - 1
    const n = grouped.length;
    const computedLowKeys: MidiNote[] = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      if (i === 0) {
        computedLowKeys[i] = 0;
      } else {
        const prev = grouped[i - 1];
        const curr = grouped[i];
        const rawLow =
          curr.lowKey !== null
            ? curr.lowKey
            : Math.floor((prev.rootKey + curr.rootKey) / 2) + 1;
        const minAllowed = computedLowKeys[i - 1] + 1;
        const maxAllowed = 128 - (n - i);
        computedLowKeys[i] = Math.max(minAllowed, Math.min(maxAllowed, rawLow));
      }
    }

    const newZones: Zone[] = [];
    for (let i = 0; i < n; i++) {
      const curr = grouped[i];
      const lowKey = computedLowKeys[i];
      const highKey = i === n - 1 ? 127 : computedLowKeys[i + 1] - 1;
      const rootKey = Math.max(lowKey, Math.min(highKey, curr.rootKey));

      const zone = createZone(lowKey, rootKey, highKey, curr.sampleLow);
      zone.sampleHigh = curr.sampleHigh;
      zone.velSplit = curr.velSplit;
      zone.detune = curr.detune;
      newZones.push(zone);
    }

    this.session!.zones = newZones;
    if (newZones[0]?.sampleLow) {
      this.maybeAutoDeriveModelName(newZones[0].sampleLow);
    }
    this.markDirty();
    return newZones;
  }

  private maybeAutoDeriveModelName(sampleFilename: string): void {
    if (!this.session) return;
    const current = this.session.processConfig.modelName.trim();
    if (!DEFAULT_MODEL_NAMES.has(current)) return;
    const maxLen =
      this.session.processConfig.targetFormat === 'modern-neural' ? 32 : 11;
    const derived = deriveModelNameFromSample(sampleFilename, maxLen);
    if (derived) {
      this.session.processConfig.modelName = derived;
      if (DEFAULT_MODEL_NAMES.has(this.session.name.trim())) {
        this.session.name = derived;
      }
    }
  }

  /**
   * Imports a legacy Hartmann `.model` file set (`MName`, `map.script`, `%06d.scape`, `%06d.sphere`),
   * a `.zip` package exported by MODELmaker / NeuronDB, or a `.neuronikmodel` v2.1 JSON file:
   * - Reconstructs the session zones and process configuration
   * - Resynthesizes playable 44.1 kHz PCM16 WAV buffers from `.sphere` / `.scape` frames
   *   so every imported zone can be auditioned and re-analyzed immediately
   * - Registers the model in the Bank and emits `session-changed`, `process-complete`, and `bank-updated`.
   */
  public async importModelFiles(
    files: { name: string; buffer: ArrayBuffer }[]
  ): Promise<GeneratedModel> {
    if (files.length === 0) {
      throw new Error('No model files provided for import');
    }

    const defaultSlot = this.session?.processConfig.modelNumber ?? 1;
    const byteFiles = files.map((f) => ({
      name: f.name,
      data: new Uint8Array(f.buffer),
    }));
    const bundle = parseModelFileSet(byteFiles, defaultSlot);

    const hasEmbeddedSamples = Boolean(
      bundle.embeddedSamples && bundle.embeddedSamples.size > 0
    );
    if (
      bundle.scapes.size === 0 &&
      bundle.spheres.size === 0 &&
      !bundle.neuronikModelJson &&
      !hasEmbeddedSamples
    ) {
      if (bundle.hasMNameOrMapScript) {
        throw new Error(
          'Only MName or map.script selected without the model .scape and .sphere files.\n\n' +
            '• When using "Import Model Files / .zip", select ALL files inside the <NNN>.model (Ctrl+A: MName, map.script, *.scape, *.sphere) or a .zip file.\n' +
            '• Or use "File -> Import Model Folder (<NNN>.model)..." to open the folder directly.'
        );
      }
      throw new Error(
        'No valid model files (.scape, .sphere, .nmmodel) or audio samples found in the selected files.'
      );
    }

    if (bundle.embeddedSamples) {
      for (const [sName, sBytes] of bundle.embeddedSamples.entries()) {
        const copy = new Uint8Array(sBytes.byteLength);
        copy.set(sBytes);
        try {
          this.registerSampleBuffer(sName, copy.buffer);
        } catch {
          // ignore non-decodable embedded file
        }
      }
    }

    if (!this.session) {
      await this.newSession(bundle.name);
    } else {
      this.pushHistory(`Import Model "${bundle.name}"`);
    }

    const activeZones =
      bundle.mapScript.activeZones.length > 0
        ? bundle.mapScript.activeZones
        : [createZone(0, 60, 127, '000001.scape')];

    const firstSphere = bundle.spheres.values().next().value;
    const inferredParamSet =
      firstSphere?.header.parameterSet ?? bundle.inferredParameterSet ?? 0;
    const stickModes = firstSphere?.header.stickModes ?? 16;
    const stickTable = [1, 4, 8, 12, 16, 24, 32, 42, 54, 64];
    const complexityIdx = stickTable.findIndex((s) => s >= stickModes);
    const inferredComplexity =
      firstSphere !== undefined
        ? complexityIdx >= 0
          ? complexityIdx + 1
          : 8
        : (bundle.inferredComplexity ?? 8);

    const newZones: Zone[] = [];
    const zonesAnalysis: ZoneAnalysisSummary[] = [];
    const sourceSampleNames = new Map<number, string>();
    const binaryBySampleName = new Map<string, ZoneBinaryPair>();

    const buildResynthSourceWav = (
      srcIdx: number,
      zEntry: Zone,
      zoneIndex: number,
      suffix = ''
    ): { sampleName: string; wavBuf: ArrayBuffer } => {
      const explicitCandidate =
        suffix === '' ? zEntry.sampleLow : zEntry.sampleHigh;
      if (
        explicitCandidate &&
        bundle.embeddedSamples?.has(explicitCandidate) &&
        this.sampleBuffers.has(explicitCandidate) &&
        !bundle.spheres.has(srcIdx) &&
        !bundle.scapes.has(srcIdx)
      ) {
        return {
          sampleName: explicitCandidate,
          wavBuf: this.sampleBuffers.get(explicitCandidate)!,
        };
      }
      const existingName = sourceSampleNames.get(srcIdx);
      if (existingName && this.sampleBuffers.has(existingName)) {
        return {
          sampleName: existingName,
          wavBuf: this.sampleBuffers.get(existingName)!,
        };
      }
      const sampleName = `${bundle.name}_S${String(srcIdx).padStart(2, '0')}_K${String(zEntry.rootKey).padStart(3, '0')}${suffix}.wav`;
      const parsedSphere = bundle.spheres.get(srcIdx);
      const parsedScape = bundle.scapes.get(srcIdx);

      let pcmFloat: Float32Array | null = null;
      if ((parsedSphere && parsedSphere.frames.length > 0) || parsedScape) {
        pcmFloat = resynthesizeNeuronModelSource(parsedSphere, parsedScape, 44100, 0.22);
      }

      const wavBuf = pcmFloat
        ? encodePcm16Wav(pcmFloat, 44100, {
            rootKey: zEntry.rootKey,
            lowKey: zEntry.lowKey,
            highKey: zEntry.highKey,
            detune: zEntry.detune,
          })
        : synthesizeDemoWav('strings', zEntry.rootKey + zoneIndex * 0, 44100, 1.0);

      this.sampleBuffers.set(sampleName, wavBuf);
      sourceSampleNames.set(srcIdx, sampleName);
      return { sampleName, wavBuf };
    };

    for (let i = 0; i < activeZones.length; i++) {
      const zEntry = activeZones[i];
      const srcIdx =
        parseInt((zEntry.sampleLow ?? `${i + 1}`).replace(/\D+/g, ''), 10) ||
        i + 1;
      const { sampleName, wavBuf } = buildResynthSourceWav(srcIdx, zEntry, i);

      let highSampleName: string | null = null;
      if (zEntry.sampleHigh) {
        const hiIdx = parseInt(zEntry.sampleHigh.replace(/\D+/g, ''), 10);
        if (!Number.isNaN(hiIdx) && hiIdx > 0 && hiIdx !== srcIdx) {
          highSampleName = buildResynthSourceWav(hiIdx, zEntry, i, '_v2').sampleName;
          const hiScape = bundle.scapeBinaries?.get(hiIdx);
          const hiSphere = bundle.sphereBinaries?.get(hiIdx);
          if (hiScape && hiSphere && !binaryBySampleName.has(highSampleName)) {
            binaryBySampleName.set(highSampleName, {
              scapeBinary: hiScape,
              sphereBinary: hiSphere,
            });
            this.importedSourceBinaries.set(highSampleName, {
              scapeBinary: hiScape,
              sphereBinary: hiSphere,
              origParameterSet: inferredParamSet,
              complexity: inferredComplexity,
              summary: {
                zoneId: `zone_${i + 1}`,
                lowKey: zEntry.lowKey,
                rootKey: zEntry.rootKey,
                highKey: zEntry.highKey,
                sampleName: highSampleName,
                sampleRate: 44100,
                durationSec: 1.0,
                detectedF0Hz: 440,
                targetF0Hz: 440,
                gridResidualCents: 0,
                gridObservations: 16,
                gridBand: 'green',
                gridNotice: 'Imported .sphere (High Vel preserved)',
                layerCount: 1,
                frameCount: 16,
                activePartials: 64,
                octaveFoldCents: 0,
                biGrid: false,
                amplitudes: new Array<number>(64).fill(0),
                frequencyOffsets: new Array<number>(64).fill(0),
              },
            });
          }
        }
      }

      const rawSphere = bundle.sphereBinaries?.get(srcIdx);
      const rawScape = bundle.scapeBinaries?.get(srcIdx);
      const parsedSphere = bundle.spheres.get(srcIdx);
      const parsedScape = bundle.scapes.get(srcIdx);

      const zone = createZone(
        zEntry.lowKey,
        zEntry.rootKey,
        zEntry.highKey,
        sampleName
      );
      zone.sampleHigh = highSampleName;
      zone.detune = zEntry.detune;
      zone.volume = zEntry.volume;
      zone.pan = zEntry.pan;
      newZones.push(zone);

      if (rawScape && rawSphere && parsedSphere) {
        const res = parsedSphere.header.resolution || parsedScape?.header.resolution || 100;
        const targetF0Hz = Number(midiNoteToHz(zone.rootKey).toFixed(2));
        const detectedF0Hz = Number((res > 0 ? NEURON_SAMPLE_RATE / res : targetF0Hz).toFixed(2));
        const midFrame =
          parsedSphere.frames[Math.floor(parsedSphere.frames.length / 2)] ??
          parsedSphere.frames[0];
        const amps = new Array<number>(64).fill(0);
        const offs = new Array<number>(64).fill(0);
        if (midFrame) {
          for (const p of midFrame.partials) {
            if (p.frequency <= 0 || p.amplitude <= 0) continue;
            const freqHz = p.frequency * 0.5;
            const harmIdx = Math.round(freqHz / Math.max(20, detectedF0Hz)) - 1;
            if (harmIdx >= 0 && harmIdx < 64) {
              const normAmp = p.amplitude / 65535.0;
              if (normAmp > amps[harmIdx]) {
                amps[harmIdx] = normAmp;
                offs[harmIdx] = Number((freqHz - (harmIdx + 1) * detectedF0Hz).toFixed(2));
              }
            }
          }
        }
        const summaryItem: ZoneAnalysisSummary = {
          zoneId: zone.id,
          lowKey: zone.lowKey,
          rootKey: zone.rootKey,
          highKey: zone.highKey,
          sampleName,
          sampleRate: 44100,
          durationSec: 1.0,
          detectedF0Hz,
          targetF0Hz,
          gridResidualCents: 0,
          gridObservations: parsedSphere.frames.length,
          gridBand: 'green',
          gridNotice: `Imported .sphere (${parsedSphere.frames.length} frames, ${parsedSphere.header.stickModes} modes)`,
          layerCount: 1,
          frameCount: parsedSphere.frames.length,
          activePartials: midFrame?.partialCount ?? 64,
          octaveFoldCents: 0,
          biGrid: false,
          amplitudes: amps,
          frequencyOffsets: offs,
        };
        zonesAnalysis.push(summaryItem);
        binaryBySampleName.set(sampleName, {
          scapeBinary: rawScape,
          sphereBinary: rawSphere,
        });
        this.importedSourceBinaries.set(sampleName, {
          scapeBinary: rawScape,
          sphereBinary: rawSphere,
          origParameterSet: parsedSphere.header.parameterSet ?? inferredParamSet,
          complexity: inferredComplexity,
          summary: summaryItem,
        });
      } else {
        const analyzed = analyzeSingleZone(
          { zone, wavBuffer: wavBuf },
          {
            modelName: bundle.name,
            modelNumber: bundle.slot,
            parameterSet: inferredParamSet,
            complexity: inferredComplexity,
            targetFormat: 'legacy-neuron',
          },
          this.analyzer
        );

        zonesAnalysis.push(analyzed.summary);
        binaryBySampleName.set(sampleName, {
          scapeBinary: rawScape ?? analyzed.scapeBinary,
          sphereBinary: rawSphere ?? analyzed.sphereBinary,
        });
      }
    }

    // Build ordered unique source binaries (1..K) matching serializeCanonicalMapScript's sourceMap
    const zoneBinaries: ZoneBinaryPair[] = [];
    const seenSamples = new Set<string>();
    for (const z of newZones) {
      for (const sName of [z.sampleLow, z.sampleHigh]) {
        if (sName && !seenSamples.has(sName)) {
          seenSamples.add(sName);
          const pair = binaryBySampleName.get(sName);
          if (pair) {
            zoneBinaries.push(pair);
          }
        }
      }
    }

    const neuronikModelJson =
      bundle.neuronikModelJson ?? convertLegacyModelToModern(bundle);

    this.session!.name = bundle.name;
    this.session!.zones = newZones;
    this.session!.processConfig = {
      modelName: bundle.name,
      modelNumber: bundle.slot,
      parameterSet: inferredParamSet,
      complexity: inferredComplexity,
      targetFormat: 'legacy-neuron',
    };
    this.session!.dirty = false;
    this.session!.modifiedAt = new Date().toISOString();

    const model: GeneratedModel = {
      slot: bundle.slot,
      name: bundle.name,
      zoneCount: newZones.length,
      complexity: inferredComplexity,
      parameterSet: inferredParamSet,
      createdAt: new Date().toISOString(),
      path: `Models/${String(bundle.slot).padStart(3, '0')}.model`,
      targetFormat: 'dual',
      zonesAnalysis,
      neuronikModelJson,
    };

    this.bank.registerImportedBundle(bundle.slot, zoneBinaries, {
      major: bundle.mapScript.versionMajor,
      minor: bundle.mapScript.versionMinor,
      build: bundle.mapScript.versionBuild,
      lineEnding: '\n',
    }, model);

    this.persistToLocalStorage();
    this.emit({ type: 'session-changed', session: this.session! });
    this.emit({ type: 'process-complete', model });
    const bank = await this.loadBank();
    this.emit({ type: 'bank-updated', bank });

    return model;
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
    const zones = [...this.session.zones];
    this.ensureZoneDemoBuffers(zones);
    const forceReanalyze = options?.forceReanalyzeImported === true;

    const payloads: ZoneWavPayload[] = zones.map((zone) => {
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
        wavBuffer: buf ? buf.slice(0) : null,
        highWavBuffer: highBuf ? highBuf.slice(0) : null,
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

  public exportZoneAsAiff(zoneId: string): { filename: string; bytes: Uint8Array } {
    return this.bank.exportZoneAsAiff(zoneId);
  }

  public async importModel(
    _sourcePath: string,
    slot: number
  ): Promise<GeneratedModel> {
    return this.bank.importModel(_sourcePath, slot);
  }

  // ── Private Helpers ─────────────────────────────────────

  private ensureZoneDemoBuffers(zones: Zone[]): void {
    for (const z of zones) {
      if (z.sampleLow && !this.sampleBuffers.has(z.sampleLow)) {
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
      this.ensureZoneDemoBuffers(this.session.zones);
    }
    this.bank.restoreBank();
  }
}
