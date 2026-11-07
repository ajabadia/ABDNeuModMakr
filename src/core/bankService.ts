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

/**
 * S4: allowlist para covers persistidos — frena `javascript:` y SVG con script.
 * S4.1 (red-team 2026-11-06, ola 13): tope de dimensiones — un data-URL de
 * 66 chars podía declarar gigapíxeles (PNG 40000×40000 = 6,4 GB de bitmap
 * al mostrarlo en el renderer; WebP VP8 llega a 16383×16383). El generador
 * propio limita a 2048 px (`clampCoverSize` en coverArtwork.ts); se impone
 * lo mismo a covers importados leyendo solo la cabecera (PNG IHDR@16,
 * WebP VP8/VP8L/VP8X). Cabecera ilegible o fuera de tope = inseguro.
 */
export const MAX_COVER_DIMENSION_PX = 2048;

function coverHeaderDimensionsOk(headerLatin1: string): boolean {
  const b = (i: number): number => headerLatin1.charCodeAt(i) & 0xff;
  const u32be = (o: number): number => b(o) * 16777216 + (b(o + 1) << 16) + (b(o + 2) << 8) + b(o + 3);
  // PNG: firma de 8 + longitud IHDR + 'IHDR' + w32 + h32.
  if (
    headerLatin1.length >= 24 &&
    b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47 &&
    b(12) === 0x49 && b(13) === 0x48 && b(14) === 0x44 && b(15) === 0x52
  ) {
    const w = u32be(16);
    const h = u32be(20);
    return w > 0 && h > 0 && w <= MAX_COVER_DIMENSION_PX && h <= MAX_COVER_DIMENSION_PX;
  }
  // WebP: 'RIFF' + tamaño + 'WEBP' + FourCC + ...
  if (
    headerLatin1.length >= 30 &&
    b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 &&
    b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50
  ) {
    const fourcc = String.fromCharCode(b(12), b(13), b(14), b(15));
    if (fourcc === 'VP8 ') {
      // tag(3) + startcode(3) + w14 + h14 en el payload (offset 20).
      const w = b(26) | ((b(27) & 0x3f) << 8);
      const h = b(28) | ((b(29) & 0x3f) << 8);
      return w > 0 && h > 0 && w <= MAX_COVER_DIMENSION_PX && h <= MAX_COVER_DIMENSION_PX;
    }
    if (fourcc === 'VP8L') {
      // firma 0x2F + 14 bits w-1 + 14 bits h-1.
      if (b(20) !== 0x2f) return false;
      const bits = b(21) | (b(22) << 8) | (b(23) << 16) | (b(24) << 24);
      const w = (bits & 0x3fff) + 1;
      const h = ((bits >>> 14) & 0x3fff) + 1;
      return w <= MAX_COVER_DIMENSION_PX && h <= MAX_COVER_DIMENSION_PX;
    }
    if (fourcc === 'VP8X') {
      // flags(1) + reservado(3) + canvas w-1 + h-1 de 24 bits.
      const w = (b(24) | (b(25) << 8) | (b(26) << 16)) + 1;
      const h = (b(27) | (b(28) << 8) | (b(29) << 16)) + 1;
      return w <= MAX_COVER_DIMENSION_PX && h <= MAX_COVER_DIMENSION_PX;
    }
    return false;
  }
  return false;
}

export function isSafeCoverDataUrl(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const comma = v.indexOf(',');
  if (comma < 0) return false;
  const mimeHead = v.slice(0, comma + 1);
  if (mimeHead !== 'data:image/webp;base64,' && mimeHead !== 'data:image/png;base64,') return false;
  if (v.length > 700_000) return false;
  // Primeros 90 bytes bastan (VP8X necesita 30); múltiplo de 4 para `atob`.
  const b64 = v.slice(comma + 1, comma + 121);
  const padded = b64.slice(0, Math.floor(b64.length / 4) * 4);
  if (padded.length < 40) return false;
  let headerLatin1: string;
  try {
    headerLatin1 = atob(padded);
  } catch {
    return false;
  }
  return coverHeaderDimensionsOk(headerLatin1);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}  /** S3.1: `localStorage` es entrada no confiable — el nombre viaja a rutas del
   * bridge y a HTML; mismo charset que `SUBLIBRARY_RE` en `bridge/server.py`. */
export function isSafeSublibraryName(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    /^[a-zA-Z0-9][a-zA-Z0-9\-_. ]{0,63}$/.test(v.trim()) &&
    !v.includes('..')
  );
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
          // S3.1: `localStorage` es entrada no confiable — el nombre viaja a rutas
          // del bridge y a HTML; se valida igual que en el servidor (SUBLIBRARY_RE).
          const list = parsed.filter((s) => s && isSafeSublibraryName(s.name));
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
