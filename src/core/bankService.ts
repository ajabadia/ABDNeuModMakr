// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Bank Service (Model Bank & Export Packaging)
//
// Extracted verbatim from `WebAudioPipeline` (P1.1 follow-up).
// Owns generated-model records, bank presets, per-slot
// `.scape`/`.sphere` binaries and `map.script` versions, plus
// bank-key localStorage persistence. Session zones, sample
// buffers, spectral analysis and history/events arrive through
// BankContext so this module owns no live session or DSP engine.
// ─────────────────────────────────────────────────────────

import {
  decodeWav,
  encodeAiffPcm16,
  resampleAudioChannel,
  synthesizeDemoWav,
} from './dsp/WavDecoder.ts';
import type { ZoneBinaryPair, ZoneWavPayload } from './dsp/PipelineRunner.ts';
import {
  evaluateNeuronDb,
  findNextFreeModelSlot,
  PINNED_SINEW_SLOT,
  type NeuronDbEvaluation,
} from '@abdsynths/shared/formats/neuron';
import { createZone } from './sessionFactory.ts';
import { DEFAULT_SAMPLE_NAME } from './sampleNaming.ts';
import { mapArticulationToSoundOverrides } from './extendedAdapter.ts';
import {
  buildTimeCapsuleEntries,
  buildTimeCapsuleZipArchive,
} from './timeCapsule.ts';
import type { NeuronAssetStore } from './storage/NeuronAssetStore.ts';
import type {
  BankSummary,
  CoreEvent,
  GeneratedModel,
  ProcessConfig,
  ProcessProgress,
  ProvenanceStep,
  Session,
  Zone,
  ZoneAnalysisSummary,
} from './types.ts';

const STORAGE_BANK_KEY = 'abd_neumodmakr_bank_v1';

export interface MapScriptVersion {
  major: number;
  minor: number;
  build: number;
  lineEnding?: '\r\n' | '\n';
}

export interface BankContext {
  getSession(): Session | null;
  getSampleBuffer(name: string): ArrayBuffer | undefined;
  getAssetStore(): NeuronAssetStore;
  hasImportedBinary(sampleName: string): boolean;
  ensureDemoBuffers(zones: Zone[]): void;
  analyzeZone(
    payload: Pick<ZoneWavPayload, 'zone' | 'wavBuffer'>,
    cfg: ProcessConfig
  ): ZoneBinaryPair;
  pushHistory(label: string): void;
  emit(event: CoreEvent): void;
  setProcessProgress(progress: ProcessProgress): void;
}

const INITIAL_PRESETS = [
  { slot: 0,  name: 'DangerDrone',    modelIndex: 511, category: 'Pad',     parameterCount: 445 },
  { slot: 1,  name: 'SilkStrings',    modelIndex: 0,   category: 'Strings', parameterCount: 445 },
  { slot: 2,  name: 'GlassKeys',      modelIndex: 1,   category: 'Keys',    parameterCount: 445 },
  { slot: 3,  name: 'WarmBass',       modelIndex: 2,   category: 'Bass',    parameterCount: 445 },
  { slot: 4,  name: 'NeuralPad',      modelIndex: 0,   category: 'Pad',     parameterCount: 445 },
  { slot: 5,  name: 'MetalBell',      modelIndex: 3,   category: 'Bell',    parameterCount: 445 },
  { slot: 6,  name: 'AirTexture',     modelIndex: 1,   category: 'Texture', parameterCount: 445 },
  { slot: 7,  name: 'DeepResonance',  modelIndex: 2,   category: 'Bass',    parameterCount: 445 },
  { slot: 8,  name: 'CrystalArp',     modelIndex: 0,   category: 'Arp',     parameterCount: 445 },
  { slot: 9,  name: 'VocalMorph',     modelIndex: 4,   category: 'Vocal',   parameterCount: 445 },
  { slot: 10, name: 'OrganicPulse',   modelIndex: 3,   category: 'Rhythm',  parameterCount: 445 },
  { slot: 11, name: 'FrozenChoir',    modelIndex: 1,   category: 'Pad',     parameterCount: 445 },
];

/** Factory bank shipped with a fresh session (moved with the field). */
const INITIAL_MODELS: GeneratedModel[] = [
  {
    slot: 0,
    name: 'Factory000',
    zoneCount: 4,
    complexity: 8,
    parameterSet: 0,
    createdAt: '2003-07-01T00:00:00Z',
    path: 'Models/000.model',
  },
  {
    slot: 511,
    name: 'sinew',
    zoneCount: 1,
    complexity: 8,
    parameterSet: 0,
    createdAt: '2003-07-01T00:00:00Z',
    path: 'Models/511.model',
  },
];

export class BankService {
  private readonly ctx: BankContext;
  private readonly modelZoneBinaries: Map<number, ZoneBinaryPair[]> = new Map();
  private readonly modelMapScriptVersions: Map<number, MapScriptVersion> = new Map();
  private generatedModels: GeneratedModel[] = [...INITIAL_MODELS];
  private bankPresets = [...INITIAL_PRESETS];

  constructor(ctx: BankContext) {
    this.ctx = ctx;
  }

  public setBankPresets(presets: BankSummary['presets']): void {
    if (presets && presets.length > 0) {
      this.bankPresets = [...presets];
    }
  }

  public async clearGeneratedModels(): Promise<void> {
    this.generatedModels = [];
    this.modelZoneBinaries.clear();
    try {
      localStorage.removeItem('abdsynths_nmm_bank');
    } catch {
      // ignore
    }
    this.ctx.pushHistory('Clear Generated Models');
    this.ctx.emit({ type: 'bank-updated', bank: await this.loadBank() });
  }

  public async loadBank(): Promise<BankSummary> {
    return {
      models: [...this.generatedModels],
      presets: [...this.bankPresets],
      totalModels: this.generatedModels.length,
      totalPresets: this.bankPresets.length,
    };
  }

  /**
   * Transparently evaluates Model <-> Sound dependencies (`BrainMapper` engine).
   */
  public evaluateDependencies(): NeuronDbEvaluation {
    return evaluateNeuronDb(this.generatedModels, this.bankPresets);
  }

  /**
   * Transparently picks a safe free/unused model slot in `000..510`, never overwriting
   * `#511 sinew` or an `'in-use'` model referenced by presets.
   */
  public getNextAvailableSlot(preferredSlot = 0): number {
    return findNextFreeModelSlot(this.generatedModels, this.bankPresets, preferredSlot);
  }

  /** True when slot has compiled `.scape`/`.sphere` binaries cached. */
  public hasBinaries(slot: number): boolean {
    return Boolean(this.modelZoneBinaries.get(slot)?.length);
  }

  /** Inserts or replaces the model record for its slot. */
  public upsertModel(model: GeneratedModel): void {
    this.generatedModels = this.generatedModels.filter((m) => m.slot !== model.slot);
    this.generatedModels.push(model);
  }

  /**
   * Stores binaries + `map.script` version + model record produced by a
   * `.model` import. Persistence and session/process emits stay with the
   * caller (it owns the session mutation of the import flow).
   */
  public registerImportedBundle(
    slot: number,
    zoneBinaries: ZoneBinaryPair[],
    version: MapScriptVersion,
    model: GeneratedModel
  ): void {
    this.modelZoneBinaries.set(slot, zoneBinaries);
    this.modelMapScriptVersions.set(slot, version);
    this.upsertModel(model);
  }

  /**
   * Builds a complete PKZIP archive (`Uint8Array`) containing the Hartmann NeuronDB
   * `.model` directory (`MName`, `map.script`, `%06d.scape`, `%06d.sphere`),
   * `.sound` directory (`sound.script`, `sound.stickrec`), and modern `.neuronikmodel` v2.1.
   */
  public buildModelZipBytes(slot: number): Uint8Array {
    const session = this.ctx.getSession();
    const model = this.generatedModels.find((m) => m.slot === slot);
    const activeSlot = model?.slot ?? slot;
    const modelName =
      model?.name ?? session?.processConfig.modelName ?? `Model${activeSlot}`;
    const zones = session?.zones ?? [
      createZone(0, 60, 127, DEFAULT_SAMPLE_NAME),
    ];
    this.ctx.ensureDemoBuffers(zones);

    let zoneBinaries = this.modelZoneBinaries.get(activeSlot);
    if (!zoneBinaries || zoneBinaries.length === 0) {
      const cfg: ProcessConfig = session?.processConfig ?? {
        modelName,
        modelNumber: activeSlot,
        parameterSet: model?.parameterSet ?? 0,
        complexity: model?.complexity ?? 8,
        targetFormat: model?.targetFormat ?? 'dual',
      };
      const analyzedBySample = new Map<string, ZoneBinaryPair>();
      zoneBinaries = [];
      for (const zone of zones) {
        const lowName = zone.sampleLow ?? `Zone_${zone.rootKey}.wav`;
        if (!analyzedBySample.has(lowName)) {
          const wavBuffer = zone.sampleLow
            ? (this.ctx.getSampleBuffer(zone.sampleLow) ?? null)
            : null;
          const analyzed = this.ctx.analyzeZone(
            { zone, wavBuffer },
            cfg
          );
          const pair: ZoneBinaryPair = {
            scapeBinary: analyzed.scapeBinary,
            sphereBinary: analyzed.sphereBinary,
          };
          analyzedBySample.set(lowName, pair);
          zoneBinaries.push(pair);
        }
        if (zone.sampleHigh && !analyzedBySample.has(zone.sampleHigh)) {
          const highBuffer = this.ctx.getSampleBuffer(zone.sampleHigh) ?? null;
          const analyzedHigh = this.ctx.analyzeZone(
            {
              zone: { ...zone, sampleLow: zone.sampleHigh },
              wavBuffer: highBuffer,
            },
            cfg
          );
          const pairHigh: ZoneBinaryPair = {
            scapeBinary: analyzedHigh.scapeBinary,
            sphereBinary: analyzedHigh.sphereBinary,
          };
          analyzedBySample.set(zone.sampleHigh, pairHigh);
          zoneBinaries.push(pairHigh);
        }
      }
      this.modelZoneBinaries.set(activeSlot, zoneBinaries);
    }

    const assetStore = this.ctx.getAssetStore();
    const rawSourceSamples = new Map<string, ArrayBuffer>();
    const enhancedAudioSamples = new Map<string, ArrayBuffer>();
    const seenSamples = new Set<string>();

    for (const z of zones) {
      for (const sName of [z.sampleLow, z.sampleHigh]) {
        if (!sName || seenSamples.has(sName)) continue;
        seenSamples.add(sName);

        const rawName = assetStore.resolveRawSampleName(sName);
        const rawBuf = assetStore.getRawSourceSync(rawName);
        if (rawBuf) {
          rawSourceSamples.set(rawName, rawBuf);
        } else if (
          !this.ctx.hasImportedBinary(sName) &&
          !assetStore.hasEnhancedAudio(sName)
        ) {
          const activeBuf = this.ctx.getSampleBuffer(sName);
          if (activeBuf) {
            rawSourceSamples.set(sName, activeBuf);
          }
        }

        const enhBuf = assetStore.getEnhancedAudioSync(sName);
        if (enhBuf) {
          enhancedAudioSamples.set(sName, enhBuf);
        }
      }
    }

    const legacyOriginalBundle =
      assetStore.getLegacyOriginalSlotBundleSync(activeSlot);
    const effectiveCfg: ProcessConfig = session?.processConfig ?? {
      modelName,
      modelNumber: activeSlot,
      parameterSet: model?.parameterSet ?? 0,
      complexity: model?.complexity ?? 8,
      targetFormat: model?.targetFormat ?? 'legacy-neuron',
    };

    const { zipBytes, manifest, provenance } = buildTimeCapsuleZipArchive({
      slot: activeSlot,
      modelName,
      processConfig: {
        ...effectiveCfg,
        targetFormat:
          session?.processConfig.targetFormat ??
          model?.targetFormat ??
          'legacy-neuron',
      },
      zones,
      extendedRegions: session?.extendedRegions,
      articulation: session?.articulation,
      detectedInstrumentCategory: session?.detectedInstrumentCategory,
      rawSourceSamples,
      legacyOriginalBundle,
      enhancedAudioSamples,
      classicEnhancedBinaries: zoneBinaries,
      mapScriptVersion: this.modelMapScriptVersions.get(activeSlot),
      neuronikModelJson: model?.neuronikModelJson,
      soundParameterOverrides: mapArticulationToSoundOverrides(
        session?.articulation
      ),
      previousProvenance: session?.provenance ?? model?.provenance,
      includeTopLevelCompatibility: true,
    });

    if (session) {
      session.provenance = provenance;
    }
    if (model) {
      model.provenance = provenance;
    }
    assetStore.setCapsuleRecord({
      slot: activeSlot,
      modelName,
      manifest,
      provenance,
      classicEnhancedBinaries: zoneBinaries,
      extendedModelJson:
        model?.neuronikModelJson ??
        JSON.stringify({ name: modelName, slot: activeSlot, format: 2 }),
      updatedAt: provenance.updatedAt,
    });

    return zipBytes;
  }

  public async exportModel(slot: number, targetPath: string): Promise<void> {
    const existingModel = this.generatedModels.find((m) => m.slot === slot);
    const activeSlot = existingModel?.slot ?? slot;
    const session = this.ctx.getSession();
    const modelName =
      existingModel?.name ??
      session?.processConfig.modelName ??
      `Model${activeSlot}`;
    const zoneCount =
      existingModel?.zoneCount ?? session?.zones.length ?? 1;
    const complexity =
      existingModel?.complexity ?? session?.processConfig.complexity ?? 8;
    const parameterSet =
      existingModel?.parameterSet ??
      session?.processConfig.parameterSet ??
      0;

    const lowerTarget = targetPath.toLowerCase();
    const wantsJsonOnly = lowerTarget.endsWith('.nmmodel') || lowerTarget.endsWith('.neuronikmodel');
    if (wantsJsonOnly) {
      const jsonContent =
        existingModel?.neuronikModelJson ??
        JSON.stringify(
          {
            name: modelName,
            slot: activeSlot,
            zoneCount,
            complexity,
            parameterSet,
            createdAt: existingModel?.createdAt ?? new Date().toISOString(),
            format: 2,
          },
          null,
          2
        );

      if (typeof document !== 'undefined') {
        const blob = new Blob([jsonContent], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download =
          targetPath.split(/[\\/]/).pop() ??
          `Model_${String(activeSlot).padStart(3, '0')}.nmmodel`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
      return;
    }

    const zipBytes = this.buildModelZipBytes(activeSlot);
    if (typeof document !== 'undefined') {
      const blob = new Blob([zipBytes as unknown as BlobPart], {
        type: 'application/zip',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = modelName.replace(/[^A-Za-z0-9_-]/g, '_');
      const defaultZipName = `NeuronModel_${String(activeSlot).padStart(3, '0')}_${safeName}.zip`;
      const requestedName = targetPath.split(/[\\/]/).pop() ?? defaultZipName;
      a.download = requestedName.endsWith('.zip')
        ? requestedName
        : defaultZipName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }

  /**
   * Exports a zone's audio buffer as a canonical Hartmann MODELmaker v1.2
   * 44100 Hz, 16-bit, Mono Big-Endian `FORM/AIFF` file with `INST` chunk
   * (`rootKey`, `lowKey`, `highKey`, `detune`, `gainDb`) and triggers a browser download.
   */
  public exportZoneAsAiff(zoneId: string): { filename: string; bytes: Uint8Array } {
    const session = this.ctx.getSession();
    if (!session) {
      throw new Error('No active session');
    }
    const zone =
      session.zones.find((z) => z.id === zoneId) ?? session.zones[0];
    if (!zone) {
      throw new Error('No zone available to export');
    }

    this.ctx.ensureDemoBuffers([zone]);
    const sampleName = zone.sampleLow ?? `Zone_${zone.rootKey}.wav`;
    const raw =
      this.ctx.getSampleBuffer(sampleName) ??
      synthesizeDemoWav('strings', zone.rootKey, 44100, 1.0);
    const decoded = decodeWav(raw);
    const mono44k = resampleAudioChannel(decoded.mono, decoded.sampleRate, 44100);

    const aiffAb = encodeAiffPcm16([mono44k], 44100, {
      rootKey: zone.rootKey,
      lowKey: zone.lowKey,
      highKey: zone.highKey,
      lowVelocity: 1,
      highVelocity: 127,
      detune: Math.round(zone.detune),
      gainDb: Math.round(zone.volume),
    });

    const basePrefix = sampleName
      .split(/[\\/]/)
      .pop()!
      .replace(/\.[^.]+$/, '')
      .replace(/[^A-Za-z0-9]/g, '');
    const rrr = String(zone.rootKey).padStart(3, '0');
    const lll = String(zone.lowKey).padStart(3, '0');
    const filename = `${basePrefix || 'Zone'}_${rrr}_${lll}_v1.aif`;
    const bytes = new Uint8Array(aiffAb);

    if (typeof document !== 'undefined') {
      const blob = new Blob([aiffAb], { type: 'audio/aiff' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    return { filename, bytes };
  }

  public async importModel(
    _sourcePath: string,
    slot: number
  ): Promise<GeneratedModel> {
    const safeSlot =
      slot === PINNED_SINEW_SLOT
        ? this.getNextAvailableSlot(0)
        : slot;
    const model: GeneratedModel = {
      slot: safeSlot,
      name: `Imported${safeSlot}`,
      zoneCount: 1,
      complexity: 8,
      parameterSet: 0,
      createdAt: new Date().toISOString(),
      path: `Models/${String(safeSlot).padStart(3, '0')}.model`,
    };
    this.upsertModel(model);
    this.persistBank();
    const bank = await this.loadBank();
    this.ctx.emit({ type: 'bank-updated', bank });
    return model;
  }

  public finalizeModelGeneration(
    config: ProcessConfig,
    zoneCount: number,
    zonesAnalysis: ZoneAnalysisSummary[],
    zoneBinaries: ZoneBinaryPair[],
    neuronikModelJson: string,
    elapsedMs: number,
    appendStep?: ProvenanceStep
  ): void {
    const targetSlot =
      config.modelNumber === PINNED_SINEW_SLOT && config.modelName.toLowerCase() !== 'sinew'
        ? this.getNextAvailableSlot(0)
        : config.modelNumber;
    this.modelZoneBinaries.set(targetSlot, zoneBinaries);

    const session = this.ctx.getSession();
    const assetStore = this.ctx.getAssetStore();
    const zones = session?.zones ?? [];
    const rawSourceSamples = new Map<string, ArrayBuffer>();
    const enhancedAudioSamples = new Map<string, ArrayBuffer>();
    for (const z of zones) {
      for (const sName of [z.sampleLow, z.sampleHigh]) {
        if (!sName) continue;
        const rawName = assetStore.resolveRawSampleName(sName);
        const rawBuf = assetStore.getRawSourceSync(rawName);
        if (rawBuf) {
          rawSourceSamples.set(rawName, rawBuf);
        }
        const enhBuf = assetStore.getEnhancedAudioSync(sName);
        if (enhBuf) {
          enhancedAudioSamples.set(sName, enhBuf);
        }
      }
    }

    const existingModel = this.getModelRecord(targetSlot);
    const { manifest, provenance } = buildTimeCapsuleEntries({
      slot: targetSlot,
      modelName: config.modelName,
      processConfig: config,
      zones,
      extendedRegions: session?.extendedRegions,
      articulation: session?.articulation,
      detectedInstrumentCategory: session?.detectedInstrumentCategory,
      rawSourceSamples,
      legacyOriginalBundle:
        assetStore.getLegacyOriginalSlotBundleSync(targetSlot),
      enhancedAudioSamples,
      classicEnhancedBinaries: zoneBinaries,
      mapScriptVersion: this.modelMapScriptVersions.get(targetSlot),
      neuronikModelJson,
      previousProvenance: session?.provenance ?? existingModel?.provenance,
      appendStep,
    });

    if (session) {
      session.provenance = provenance;
    }

    assetStore.setCapsuleRecord({
      slot: targetSlot,
      modelName: config.modelName,
      manifest,
      provenance,
      classicEnhancedBinaries: zoneBinaries,
      extendedModelJson: neuronikModelJson,
      updatedAt: provenance.updatedAt,
    });

    const model: GeneratedModel = {
      slot: targetSlot,
      name: config.modelName,
      zoneCount,
      complexity: config.complexity,
      parameterSet: config.parameterSet,
      createdAt: new Date().toISOString(),
      path: `Models/${String(targetSlot).padStart(3, '0')}.model`,
      targetFormat: config.targetFormat ?? 'dual',
      zonesAnalysis,
      neuronikModelJson,
      provenance,
    };

    this.upsertModel(model);
    this.persistBank();

    const firstSummary = zonesAnalysis[0];
    const summaryText = firstSummary
      ? ` (f0=${firstSummary.detectedF0Hz} Hz, ${firstSummary.gridNotice}, ${firstSummary.activePartials} partials)`
      : '';

    const progress: ProcessProgress = {
      status: 'completed',
      currentZone: zoneCount,
      totalZones: zoneCount,
      currentSample: '',
      percent: 100,
      message: `Model "${config.modelName}" generated successfully${summaryText}`,
      elapsedMs,
    };
    this.ctx.setProcessProgress(progress);

    this.ctx.emit({
      type: 'process-progress',
      progress: { ...progress },
    });
    this.ctx.emit({ type: 'process-complete', model });
  }

  /** Persists generated-model metadata (bank key only; session key stays with the pipeline). */
  public persistBank(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      // Cap neuronikModelJson size to avoid quota issues
      const lightModels = this.generatedModels.map((m) => ({
        ...m,
        neuronikModelJson:
          m.neuronikModelJson && m.neuronikModelJson.length < 250000
            ? m.neuronikModelJson
            : undefined,
      }));
      localStorage.setItem(STORAGE_BANK_KEY, JSON.stringify(lightModels));
    } catch {
      // Ignore storage quota or private-mode errors
    }
  }

  /** Model record lookup for full-session loads (no session mutation). */
  public getModelRecord(slot: number): GeneratedModel | undefined {
    return this.generatedModels.find((m) => m.slot === slot);
  }

  /** Cached `.scape`/`.sphere` binaries for a slot, if present. */
  public getModelBinaries(slot: number): ZoneBinaryPair[] | undefined {
    return this.modelZoneBinaries.get(slot);
  }

  /** Restores generated-model metadata previously saved by `persistBank`. */
  public restoreBank(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const rawBank = localStorage.getItem(STORAGE_BANK_KEY);
      if (rawBank) {
        const parsedBank = JSON.parse(rawBank) as GeneratedModel[];
        if (Array.isArray(parsedBank) && parsedBank.length > 0) {
          this.generatedModels = parsedBank;
        }
      }
    } catch {
      // Ignore malformed localStorage state
    }
  }
}

export type BankLoadIssue = 'NOT_FOUND' | 'NO_BINARIES' | 'MISMATCH' | 'NO_ZONES';

export class BankLoadError extends Error {
  readonly code: BankLoadIssue;
  constructor(code: BankLoadIssue, message: string) {
    super(message);
    this.name = 'BankLoadError';
    this.code = code;
  }
}

export interface BankLoadZone {
  lowKey: number;
  rootKey: number;
  highKey: number;
  sampleLow: string;
  sampleHigh: string | null;
}

export interface BankLoadPlan {
  zones: BankLoadZone[];
  processConfig: ProcessConfig;
  /** Ordered unique sample names, aligned 1:1 with the stored binaries. */
  sampleOrder: string[];
}

interface NeuronikZoneJson {
  lowKey?: unknown;
  rootKey?: unknown;
  highKey?: unknown;
  sampleName?: unknown;
  sampleHigh?: unknown;
}

function readNeuronikZones(json: string | undefined): BankLoadZone[] | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as { zones?: NeuronikZoneJson[] };
    if (!parsed || !Array.isArray(parsed.zones) || parsed.zones.length === 0) return null;
    const zones: BankLoadZone[] = [];
    for (const z of parsed.zones) {
      if (
        typeof z?.lowKey !== 'number' ||
        typeof z?.rootKey !== 'number' ||
        typeof z?.highKey !== 'number' ||
        typeof z?.sampleName !== 'string' ||
        z.sampleName.length === 0
      ) {
        return null;
      }
      zones.push({
        lowKey: z.lowKey,
        rootKey: z.rootKey,
        highKey: z.highKey,
        sampleLow: z.sampleName,
        sampleHigh: typeof z.sampleHigh === 'string' && z.sampleHigh.length > 0 ? z.sampleHigh : null,
      });
    }
    return zones;
  } catch {
    return null;
  }
}

/**
 * Pure assembly for full-session model loads. Maps a bank record +
 * its cached binaries to zones, config and the sample order aligned
 * with the binaries. Throws `BankLoadError` — never touches session,
 * storage or DSP, so it is unit-testable in Node.
 */
export function buildBankLoadPlan(
  model: GeneratedModel | undefined,
  binaries: ZoneBinaryPair[] | undefined
): BankLoadPlan {
  if (!model) {
    throw new BankLoadError('NOT_FOUND', 'Model is not in the bank.');
  }
  const zones =
    readNeuronikZones(model.neuronikModelJson) ??
    (model.zonesAnalysis ?? []).map((s) => ({
      lowKey: s.lowKey,
      rootKey: s.rootKey,
      highKey: s.highKey,
      sampleLow: s.sampleName,
      sampleHigh: null as string | null,
    }));
  if (zones.length === 0) {
    throw new BankLoadError(
      'NO_ZONES',
      `Model "${model.name}" has no zone data to load.`
    );
  }
  if (!binaries || binaries.length === 0) {
    throw new BankLoadError(
      'NO_BINARIES',
      `Model "${model.name}" has no compiled audio cached (the bank was restored without binaries). Re-import or regenerate it.`
    );
  }
  const sampleOrder: string[] = [];
  const seen = new Set<string>();
  for (const z of zones) {
    for (const name of [z.sampleLow, z.sampleHigh]) {
      if (name && !seen.has(name)) {
        seen.add(name);
        sampleOrder.push(name);
      }
    }
  }
  if (sampleOrder.length !== binaries.length) {
    throw new BankLoadError(
      'MISMATCH',
      `Model "${model.name}" binary cache does not match its zone layout (${binaries.length} binaries for ${sampleOrder.length} samples). Re-import or regenerate it.`
    );
  }
  return {
    zones,
    processConfig: {
      modelName: model.name,
      modelNumber: model.slot,
      parameterSet: model.parameterSet,
      complexity: model.complexity,
      targetFormat: model.targetFormat ?? 'dual',
    },
    sampleOrder,
  };
}
