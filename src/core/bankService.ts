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


import type {
  ZoneBinaryPair,
  ZoneWavPayload,
} from './dsp/PipelineRunner.ts';
import {
  evaluateNeuronDb,
  findNextFreeModelSlot,
} from '@abdsynths/shared/formats/neuron';
import type {
  NeuronDbEvaluation,
} from '@abdsynths/shared/formats/neuron';
import type {
  AxionikExpandedModel,
} from '@abdsynths/shared/contracts/axionikExpandedModel.ts';
import type {
  NeuronAssetStore,
} from './storage/NeuronAssetStore.ts';
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
import { buildModelZipBytes, exportModel, exportZoneAsAiff } from './bank/bankExport.ts';
import { saveToAxionikDb, importModel, finalizeModelGeneration } from './bank/bankAxionikDb.ts';
import { listSublibraries, createSublibrary, deleteSublibrary, moveModelToSublibrary, reorderModelsInSublibrary } from './bank/bankSublibraries.ts';

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
  // Fase 42.5: estado expuesto a core/bank/* (lectura/escritura solo del servicio).
  public readonly ctx: BankContext;
  public readonly modelZoneBinaries: Map<number, ZoneBinaryPair[]> = new Map();
  public readonly modelMapScriptVersions: Map<number, MapScriptVersion> = new Map();
  public readonly modelExpandedModelsV2: Map<number, AxionikExpandedModel> = new Map();
  public generatedModels: GeneratedModel[] = [...INITIAL_MODELS];
  public bankPresets = [...INITIAL_PRESETS];
  public sublibraries: SublibraryInfo[] = [
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
    return Boolean(this.getModelBinaries(slot)?.length);
  }

  /** Caches compiled `.scape`/`.sphere` binaries for a slot in memory. */
  public setModelBinaries(slot: number, zoneBinaries: ZoneBinaryPair[]): void {
    this.modelZoneBinaries.set(slot, zoneBinaries);
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





  /** Persists generated-model metadata (bank key only; session key stays with the pipeline). */
  public persistBank(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      // Cap neuronikModelJson size to avoid quota issues (Fase 44.5: warn instead of silent drop)
      let truncatedJson = 0;
      let droppedCover = 0;
      const lightModels = this.generatedModels.map((m) => {
        const keepJson = m.neuronikModelJson && m.neuronikModelJson.length < 250000 ? m.neuronikModelJson : undefined;
        if (m.neuronikModelJson && !keepJson) truncatedJson++;
        const keepCover = 'coverWebpDataUrl' in m && (m as { coverWebpDataUrl?: unknown }).coverWebpDataUrl !== undefined && !isSafeCoverDataUrl((m as { coverWebpDataUrl?: unknown }).coverWebpDataUrl) ? undefined : (m as { coverWebpDataUrl?: string }).coverWebpDataUrl;
        if ('coverWebpDataUrl' in m && (m as { coverWebpDataUrl?: unknown }).coverWebpDataUrl !== undefined && !isSafeCoverDataUrl((m as { coverWebpDataUrl?: unknown }).coverWebpDataUrl)) droppedCover++;
        return { ...m, neuronikModelJson: keepJson, ...(keepCover === undefined && 'coverWebpDataUrl' in m ? { coverWebpDataUrl: undefined } : {}) };
      });
      if (truncatedJson > 0 || droppedCover > 0) {
        // Fase 44.5: cada descarte por cuota deja línea en TelemetryDrawer
        // (vía evento `quota-warning`) además del console.warn.
        const msg = `Bank quota: ${truncatedJson} modelo(s) con neuronikModelJson truncado (>250KB), ${droppedCover} cover(s) descartado(s) (>700KB o no webp/png). Re-generar tras liberar espacio.`;
        console.warn(`[bankService.persistBank] ${msg}`);
        try {
          this.ctx.emit({ type: 'quota-warning', message: msg });
        } catch {
          // never break persistence on telemetry failure
        }
      }
      localStorage.setItem(STORAGE_BANK_KEY, JSON.stringify(lightModels));
    } catch {
      // Ignore storage quota or private-mode errors
    }
  }

  /** Model record lookup for full-session loads (no session mutation). */
  public getModelRecord(slot: number): GeneratedModel | undefined {
    return this.generatedModels.find((m) => m.slot === slot);
  }

  /** Cached `.scape`/`.sphere` binaries for a slot, if present in RAM or IndexedDB. */
  public getModelBinaries(slot: number): ZoneBinaryPair[] | undefined {
    const inRam = this.modelZoneBinaries.get(slot);
    if (inRam && inRam.length > 0) {
      return inRam;
    }
    const assetStore = this.ctx.getAssetStore();
    const fromCapsule = assetStore.getCapsuleRecordSync(slot)?.classicEnhancedBinaries;
    if (fromCapsule && fromCapsule.length > 0) {
      this.modelZoneBinaries.set(slot, fromCapsule);
      return fromCapsule;
    }
    const fromLegacy = assetStore.getLegacyOriginalSlotBundleSync(slot)?.zoneBinaries;
    if (fromLegacy && fromLegacy.length > 0) {
      this.modelZoneBinaries.set(slot, fromLegacy);
      return fromLegacy;
    }
    return undefined;
  }

  /** Restores generated-model metadata previously saved by `persistBank` and re-hydrates IndexedDB binaries. */
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
      const assetStore = this.ctx.getAssetStore();
      for (const m of this.generatedModels) {
        const capsule = assetStore.getCapsuleRecordSync(m.slot);
        if (capsule) {
          if (capsule.classicEnhancedBinaries?.length && !this.modelZoneBinaries.has(m.slot)) {
            this.modelZoneBinaries.set(m.slot, capsule.classicEnhancedBinaries);
          }
          if (!m.neuronikModelJson && capsule.extendedModelJson) {
            m.neuronikModelJson = capsule.extendedModelJson;
          }
        }
        const legacy = assetStore.getLegacyOriginalSlotBundleSync(m.slot);
        if (legacy?.zoneBinaries?.length && !this.modelZoneBinaries.has(m.slot)) {
          this.modelZoneBinaries.set(m.slot, legacy.zoneBinaries);
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


  // -- Delegacion Fase 42.5: Exportacion (bankExport.ts) --
  public buildModelZipBytes(slot: number): Uint8Array {
    return buildModelZipBytes(this, slot);
  }
  public async exportModel(slot: number, targetPath: string): Promise<void> {
    return exportModel(this, slot, targetPath);
  }
  public exportZoneAsAiff(zoneId: string): { filename: string; bytes: Uint8Array } {
    return exportZoneAsAiff(this, zoneId);
  }

  // -- Delegacion Fase 42.5: AxionikDB (bankAxionikDb.ts) --
  public async saveToAxionikDb(options?: {
    customSlug?: string;
    customName?: string;
    saveAs?: boolean;
    sublibrary?: string;
    sublibraryOrdinal?: number;
  }): Promise<{ slug: string; path: string; isBridge: boolean; count: number; sublibrary: string }> {
    return saveToAxionikDb(this, options);
  }
  public async importModel(
    _sourcePath: string,
    slot: number
  ): Promise<GeneratedModel> {
    return importModel(this, _sourcePath, slot);
  }
  public finalizeModelGeneration(
    config: ProcessConfig,
    zoneCount: number,
    zonesAnalysis: ZoneAnalysisSummary[],
    zoneBinaries: ZoneBinaryPair[],
    neuronikModelJson: string,
    elapsedMs: number,
    appendStep?: ProvenanceStep,
    expandedModelV2?: AxionikExpandedModel
  ): void {
    return finalizeModelGeneration(this, config, zoneCount, zonesAnalysis, zoneBinaries, neuronikModelJson, elapsedMs, appendStep, expandedModelV2);
  }

  // -- Delegacion Fase 42.5: Sub-bibliotecas (bankSublibraries.ts) --
  public async listSublibraries(): Promise<SublibraryInfo[]> {
    return listSublibraries(this);
  }
  public async createSublibrary(name: string, description?: string, order?: number): Promise<SublibraryInfo> {
    return createSublibrary(this, name, description, order);
  }
  public async deleteSublibrary(name: string): Promise<void> {
    return deleteSublibrary(this, name);
  }
  public async moveModelToSublibrary(slugOrSlot: string | number, targetSublibrary: string): Promise<void> {
    return moveModelToSublibrary(this, slugOrSlot, targetSublibrary);
  }
  public async reorderModelsInSublibrary(
    sublibrary: string,
    orderedSlugsOrSlots: Array<string | number>
  ): Promise<void> {
    return reorderModelsInSublibrary(this, sublibrary, orderedSlugsOrSlots);
  }
}

export { BankLoadError, buildBankLoadPlan, buildFallbackBankLoadPlan } from './bank/bankLoadPlan.ts';
export type { BankLoadIssue, BankLoadZone, BankLoadPlan } from './bank/bankLoadPlan.ts';
