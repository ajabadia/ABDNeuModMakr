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
import { bridgeClient, type AxionikSaveFileEntry } from './bridge/BridgeClient.ts';
import { createUniqueModelSlug, slugifyModelName } from './modelSlug.ts';
import { basename, sanitizeFileName } from './pathUtils.ts';
import { downloadBlob, downloadBytes } from '../ui/download.ts';
import type { NeuronAssetStore } from './storage/NeuronAssetStore.ts';
import type {
  BankSummary,
  CoreEvent,
  GeneratedModel,
  ProcessConfig,
  ProcessProgress,
  ProvenanceStep,
  Session,
  SublibraryInfo,
  Zone,
  ZoneAnalysisSummary,
} from './types.ts';

const STORAGE_BANK_KEY = 'abd_neumodmakr_bank_v1';
const STORAGE_SUBLIBRARIES_KEY = 'abd_neumodmakr_sublibraries_v1';

/** S4: allowlist para covers persistidos — frena `javascript:` y SVG con script. */
export function isSafeCoverDataUrl(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    (v.startsWith('data:image/webp;base64,') || v.startsWith('data:image/png;base64,')) &&
    v.length <= 700_000
  );
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** S4: `localStorage` es entrada no confiable — valida antes de hidratar el bank. */
function isSafeBankRecord(m: unknown): m is GeneratedModel {
  if (!isRecord(m)) return false;
  if (typeof m['slot'] !== 'number' || !Number.isInteger(m['slot']) || (m['slot'] as number) < 0 || (m['slot'] as number) > 511) return false;
  if (typeof m['name'] !== 'string' || (m['name'] as string).trim().length === 0 || (m['name'] as string).length > 64) return false;
  if (/[<>]/.test(m['name'] as string)) return false;
  if ('coverWebpDataUrl' in m && m['coverWebpDataUrl'] !== undefined && !isSafeCoverDataUrl(m['coverWebpDataUrl'])) return false;
  return true;
}

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
  private sublibraries: SublibraryInfo[] = [
    { name: 'Default', description: 'Default root sub-library', order: 1, modelCount: 0, isDefault: true },
  ];

  constructor(ctx: BankContext) {
    this.ctx = ctx;
    this.restoreSublibraries();
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
        const fallback = `Model_${String(activeSlot).padStart(3, '0')}.nmmodel`;
        downloadBytes(jsonContent, basename(targetPath) || fallback, 'application/json');
      }
      return;
    }

    const zipBytes = this.buildModelZipBytes(activeSlot);
    if (typeof document !== 'undefined') {
      const safeName = sanitizeFileName(modelName, 'model');
      const defaultZipName = `NeuronModel_${String(activeSlot).padStart(3, '0')}_${safeName}.zip`;
      const requestedName = basename(targetPath) || defaultZipName;
      downloadBlob(
        new Blob([zipBytes as unknown as BlobPart], { type: 'application/zip' }),
        requestedName.endsWith('.zip') ? requestedName : defaultZipName
      );
    }
  }

  /**
   * Saves the current active model or session to AxionikDB (Fase 11).
   * Identifies the model by semantic slug (e.g. 'grand-piano-steinway'),
   * packages the complete self-contained 5-layer Time Capsule,
   * writes directly to the local AxionikDB library via Companion Bridge if online,
   * or falls back to browser .axmodel.zip export.
   */
  public async saveToAxionikDb(options?: {
    customSlug?: string;
    customName?: string;
    saveAs?: boolean;
    sublibrary?: string;
    sublibraryOrdinal?: number;
  }): Promise<{ slug: string; path: string; isBridge: boolean; count: number; sublibrary: string }> {
    const session = this.ctx.getSession();
    const activeSlot = session?.processConfig.modelNumber ?? 0;
    const model = this.generatedModels.find((m) => m.slot === activeSlot);

    const modelName =
      options?.customName ??
      session?.processConfig.modelName ??
      model?.name ??
      `Model_${activeSlot}`;

    const existingSlugs = this.generatedModels
      .map((m) => m.slug)
      .filter((s): s is string => typeof s === 'string' && s.length > 0);

    let slug: string;
    if (options?.customSlug) {
      slug = slugifyModelName(options.customSlug);
    } else if (options?.saveAs || !session?.axionikSlug) {
      slug = createUniqueModelSlug(modelName, existingSlugs);
    } else {
      slug = session.axionikSlug;
    }

    const zones = session?.zones ?? [];
    let zoneBinaries = this.modelZoneBinaries.get(activeSlot);
    if (!zoneBinaries) {
      this.ctx.ensureDemoBuffers(zones);
      const cfg = session?.processConfig ?? {
        modelName,
        modelNumber: activeSlot,
        parameterSet: model?.parameterSet ?? 0,
        complexity: model?.complexity ?? 8,
        targetFormat: model?.targetFormat ?? 'dual',
      };
      const analyzedBySample = new Map<string, ZoneBinaryPair>();
      zoneBinaries = [];
      for (const zone of zones) {
        const sLow = zone.sampleLow ?? DEFAULT_SAMPLE_NAME;
        if (!analyzedBySample.has(sLow)) {
          const lowBuffer = this.ctx.getSampleBuffer(sLow) ?? null;
          const analyzedLow = this.ctx.analyzeZone({ zone: { ...zone, sampleLow: sLow }, wavBuffer: lowBuffer }, cfg);
          const pairLow: ZoneBinaryPair = {
            scapeBinary: analyzedLow.scapeBinary,
            sphereBinary: analyzedLow.sphereBinary,
          };
          analyzedBySample.set(sLow, pairLow);
          zoneBinaries.push(pairLow);
        }
        if (zone.sampleHigh && !analyzedBySample.has(zone.sampleHigh)) {
          const highBuffer = this.ctx.getSampleBuffer(zone.sampleHigh) ?? null;
          const analyzedHigh = this.ctx.analyzeZone(
            { zone: { ...zone, sampleLow: zone.sampleHigh }, wavBuffer: highBuffer },
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
        } else if (!this.ctx.hasImportedBinary(sName) && !assetStore.hasEnhancedAudio(sName)) {
          const activeBuf = this.ctx.getSampleBuffer(sName);
          if (activeBuf) rawSourceSamples.set(sName, activeBuf);
        }
        const enhBuf = assetStore.getEnhancedAudioSync(sName);
        if (enhBuf) enhancedAudioSamples.set(sName, enhBuf);
      }
    }

    const legacyOriginalBundle = assetStore.getLegacyOriginalSlotBundleSync(activeSlot);
    const effectiveCfg: ProcessConfig = session?.processConfig ?? {
      modelName,
      modelNumber: activeSlot,
      parameterSet: model?.parameterSet ?? 0,
      complexity: model?.complexity ?? 8,
      targetFormat: 'dual',
      workingMode: 'extended',
    };

    const { entries, manifest, provenance } = buildTimeCapsuleEntries({
      slot: activeSlot,
      modelName,
      processConfig: effectiveCfg,
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
      soundParameterOverrides: mapArticulationToSoundOverrides(session?.articulation),
      previousProvenance: session?.provenance ?? model?.provenance,
      includeTopLevelCompatibility: true,
    });

    const sublibrary = options?.sublibrary ?? session?.processConfig.sublibrary ?? model?.sublibrary ?? 'Default';
    const sublibraryOrdinal = options?.sublibraryOrdinal ?? session?.processConfig.sublibraryOrdinal ?? model?.sublibraryOrdinal;

    if (session) {
      session.provenance = provenance;
      session.axionikSlug = slug;
      session.processConfig.modelName = modelName;
      session.processConfig.sublibrary = sublibrary;
      if (sublibraryOrdinal !== undefined) {
        session.processConfig.sublibraryOrdinal = sublibraryOrdinal;
      }
      session.name = modelName;
      session.dirty = false;
    }

    const updatedModel: GeneratedModel = {
      slot: activeSlot,
      name: modelName,
      slug,
      sublibrary,
      sublibraryOrdinal,
      zoneCount: zones.length,
      complexity: effectiveCfg.complexity,
      parameterSet: effectiveCfg.parameterSet,
      createdAt: model?.createdAt ?? new Date().toISOString(),
      path: sublibrary === 'Default' ? `AxionikDB/Models/${slug}` : `AxionikDB/Banks/${sublibrary}/${slug}`,
      targetFormat: 'dual',
      provenance,
    };
    this.upsertModel(updatedModel);
    this.persistBank();

    let isBridge = false;
    let savedPath = '';
    let filesWritten = 0;

    if (bridgeClient.isConnected()) {
      const libPath =
        (typeof localStorage !== 'undefined'
          ? localStorage.getItem('abd_axionikdb_path')
          : null) || 'd:\\desarrollos\\ABDSynths\\AxionikDB';

      const files: AxionikSaveFileEntry[] = entries.map((e) => {
        if (typeof e.data === 'string') {
          return { path: e.path, content: e.data };
        }
        let binary = '';
        const len = e.data.byteLength;
        for (let i = 0; i < len; i++) {
          binary += String.fromCharCode(e.data[i]);
        }
        return { path: e.path, content_b64: btoa(binary) };
      });

      const res = await bridgeClient.saveAxionikModel(libPath, slug, files, 30000, sublibrary);
      isBridge = true;
      savedPath = res.folder;
      filesWritten = res.files_written;
    } else {
      // Browser fallback: download as .axmodel.zip
      const zipBytes = this.buildModelZipBytes(activeSlot);
      if (typeof document !== 'undefined') {
        downloadBlob(
          new Blob([zipBytes as unknown as BlobPart], { type: 'application/zip' }),
          `${slug}.axmodel.zip`
        );
      }
      savedPath = `${slug}.axmodel.zip`;
      filesWritten = entries.length;
    }

    assetStore.setCapsuleRecord({
      slot: activeSlot,
      modelName,
      manifest,
      provenance,
      classicEnhancedBinaries: zoneBinaries,
      extendedModelJson:
        model?.neuronikModelJson ??
        JSON.stringify({ name: modelName, slot: activeSlot, slug, format: 2 }),
      updatedAt: provenance.updatedAt,
    });

    const bank = await this.loadBank();
    this.ctx.emit({ type: 'bank-updated', bank });

    return {
      slug,
      path: savedPath,
      isBridge,
      count: filesWritten,
      sublibrary,
    };
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
      downloadBytes(aiffAb, filename, 'audio/aiff');
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
      sublibrary: config.sublibrary || 'Default',
      sublibraryOrdinal: config.sublibraryOrdinal,
      coverWebpDataUrl:
        config.workingMode === 'extended'
          ? config.coverArtwork?.webpDataUrl
          : undefined,
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
        const parsedBank = JSON.parse(rawBank) as unknown;
        if (Array.isArray(parsedBank) && parsedBank.length > 0) {
          const clean = parsedBank.filter((m) => isSafeBankRecord(m));
          if (clean.length > 0) this.generatedModels = clean;
        }
      }
    } catch {
      // Ignore malformed localStorage state
    }
  }

  public persistSublibraries(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_SUBLIBRARIES_KEY, JSON.stringify(this.sublibraries));
    } catch {
      // ignore
    }
  }

  public restoreSublibraries(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_SUBLIBRARIES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const list = parsed.filter((s) => s && typeof s.name === 'string');
          if (!list.some((s) => s.name === 'Default')) {
            list.unshift({ name: 'Default', description: 'Default root sub-library', order: 1, modelCount: 0, isDefault: true });
          }
          this.sublibraries = list;
        }
      }
    } catch {
      // ignore
    }
  }

  /**
   * Returns all available sub-libraries, including model counts and display ordering.
   */
  public async listSublibraries(): Promise<SublibraryInfo[]> {
    if (bridgeClient.isConnected()) {
      try {
        const libPath =
          (typeof localStorage !== 'undefined'
            ? localStorage.getItem('abd_axionikdb_path')
            : null) || 'd:\\desarrollos\\ABDSynths\\AxionikDB';
        const bridgeSubs = await bridgeClient.listSublibraries(libPath);
        if (bridgeSubs && bridgeSubs.length > 0) return bridgeSubs;
      } catch {
        // Fallback to local
      }
    }

    const counts = new Map<string, number>();
    for (const m of this.generatedModels) {
      const sub = m.sublibrary || 'Default';
      counts.set(sub, (counts.get(sub) || 0) + 1);
    }

    return this.sublibraries
      .map((s) => ({
        ...s,
        modelCount: counts.get(s.name) || 0,
      }))
      .sort((a, b) => (a.isDefault ? -1 : b.isDefault ? 1 : a.order - b.order));
  }

  /**
   * Creates a new sub-library in AxionikDB / local storage.
   */
  public async createSublibrary(name: string, description?: string, order?: number): Promise<SublibraryInfo> {
    const cleanName = name.trim();
    if (!cleanName || cleanName.length > 64) {
      throw new Error('Invalid sub-library name (1-64 characters allowed).');
    }

    if (bridgeClient.isConnected()) {
      try {
        const libPath =
          (typeof localStorage !== 'undefined'
            ? localStorage.getItem('abd_axionikdb_path')
            : null) || 'd:\\desarrollos\\ABDSynths\\AxionikDB';
        await bridgeClient.createSublibrary(libPath, cleanName, description, order);
      } catch (err) {
        console.warn('Bridge createSublibrary warning:', err);
      }
    }

    const existing = this.sublibraries.find((s) => s.name.toLowerCase() === cleanName.toLowerCase());
    if (existing) return existing;

    const newSub: SublibraryInfo = {
      name: cleanName,
      description: description || `Sub-library: ${cleanName}`,
      order: order ?? this.sublibraries.length + 1,
      modelCount: 0,
      isDefault: cleanName === 'Default',
    };
    this.sublibraries.push(newSub);
    this.persistSublibraries();
    return newSub;
  }

  /**
   * Deletes a sub-library with STRICT safety rule:
   * Throws an error if the sub-library contains any models.
   */
  public async deleteSublibrary(name: string): Promise<void> {
    const cleanName = name.trim();
    if (cleanName.toLowerCase() === 'default') {
      throw new Error('Cannot delete Default root sub-library.');
    }

    const modelsInSub = this.generatedModels.filter(
      (m) => (m.sublibrary || 'Default').toLowerCase() === cleanName.toLowerCase()
    );
    if (modelsInSub.length > 0) {
      throw new Error(
        `Cannot delete sub-library "${cleanName}": it contains ${modelsInSub.length} model(s). Move or delete its models first.`
      );
    }

    if (bridgeClient.isConnected()) {
      const libPath =
        (typeof localStorage !== 'undefined'
          ? localStorage.getItem('abd_axionikdb_path')
          : null) || 'd:\\desarrollos\\ABDSynths\\AxionikDB';
      await bridgeClient.deleteSublibrary(libPath, cleanName);
    }

    this.sublibraries = this.sublibraries.filter((s) => s.name.toLowerCase() !== cleanName.toLowerCase());
    this.persistSublibraries();
  }

  /**
   * Transfers a model to another sub-library and recalculates ordinal positions.
   */
  public async moveModelToSublibrary(slugOrSlot: string | number, targetSublibrary: string): Promise<void> {
    const targetSub = targetSublibrary.trim() || 'Default';
    const model = this.generatedModels.find((m) => m.slug === slugOrSlot || m.slot === slugOrSlot);
    if (!model) throw new Error(`Model not found: ${slugOrSlot}`);

    const sourceSub = model.sublibrary || 'Default';
    if (sourceSub === targetSub) return;

    if (model.slug && bridgeClient.isConnected()) {
      try {
        const libPath =
          (typeof localStorage !== 'undefined'
            ? localStorage.getItem('abd_axionikdb_path')
            : null) || 'd:\\desarrollos\\ABDSynths\\AxionikDB';
        await bridgeClient.moveAxionikModel(libPath, model.slug, targetSub, sourceSub);
      } catch (err) {
        console.warn('Bridge moveAxionikModel error:', err);
      }
    }

    model.sublibrary = targetSub;
    const targetModels = this.generatedModels.filter((m) => (m.sublibrary || 'Default') === targetSub);
    model.sublibraryOrdinal = targetModels.length;
    this.persistBank();
  }

  /**
   * Reorders models within a sub-library, assigning sequential contiguous ordinals (1, 2, 3...).
   */
  public async reorderModelsInSublibrary(
    sublibrary: string,
    orderedSlugsOrSlots: Array<string | number>
  ): Promise<void> {
    const sub = sublibrary.trim() || 'Default';
    const slugs: string[] = [];

    orderedSlugsOrSlots.forEach((id, idx) => {
      const model = this.generatedModels.find((m) => m.slug === id || m.slot === id);
      if (model && (model.sublibrary || 'Default') === sub) {
        model.sublibraryOrdinal = idx + 1;
        if (model.slug) slugs.push(model.slug);
      }
    });

    if (slugs.length > 0 && bridgeClient.isConnected()) {
      try {
        const libPath =
          (typeof localStorage !== 'undefined'
            ? localStorage.getItem('abd_axionikdb_path')
            : null) || 'd:\\desarrollos\\ABDSynths\\AxionikDB';
        await bridgeClient.reorderSublibrary(libPath, sub, slugs);
      } catch (err) {
        console.warn('Bridge reorderSublibrary error:', err);
      }
    }

    this.persistBank();
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
      ...(model.coverWebpDataUrl
        ? {
            workingMode: 'extended' as const,
            coverArtwork: {
              webpDataUrl: model.coverWebpDataUrl,
              byteLength: Math.round((model.coverWebpDataUrl.length * 3) / 4),
              width: 512,
              height: 512,
              originalName: `${model.name}.webp`,
              updatedAt: model.createdAt,
            },
          }
        : {}),
    },
    sampleOrder,
  };
}
