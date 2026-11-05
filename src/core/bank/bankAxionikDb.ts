// ---------------------------------------------------------
// ABDNeuModMakr - Fase 42.5: Bank AxionikDb
// persistencia en AxionikDB, importacion y finalizacion
// Funciones puras de dominio: reciben el servicio (svc) y operan
// sobre su estado publico. La API estable vive en BankService.
// ---------------------------------------------------------

import {
  buildModelZipBytes,
} from './bankExport.ts';
import {
  PINNED_SINEW_SLOT,
} from '@abdsynths/shared/formats/neuron';
import {
  DEFAULT_SAMPLE_NAME,
} from '../sampleNaming.ts';
import {
  mapArticulationToSoundOverrides,
} from '../extendedAdapter.ts';
import {
  buildTimeCapsuleEntries,
} from '../timeCapsule.ts';
import {
  bridgeClient,
} from '../bridge/BridgeClient.ts';
import {
  createUniqueModelSlug,
  slugifyModelName,
} from '../modelSlug.ts';
import {
  downloadBlob,
} from '../../ui/download.ts';
import type {
  ZoneBinaryPair,
} from '../dsp/PipelineRunner.ts';
import type {
  AxionikExpandedModel,
} from '@abdsynths/shared/contracts/axionikExpandedModel.ts';
import type {
  AxionikSaveFileEntry,
} from '../bridge/BridgeClient.ts';
import type {
  GeneratedModel,
  ProcessConfig,
  ProcessProgress,
  ProvenanceStep,
  ZoneAnalysisSummary,
} from '../types.ts';
import type {
  BankService,
} from '../bankService.ts';

/**
 * Saves the current active model or session to AxionikDB (Fase 11).
 * Identifies the model by semantic slug (e.g. 'grand-piano-steinway'),
 * packages the complete self-contained 5-layer Time Capsule,
 * writes directly to the local AxionikDB library via Companion Bridge if online,
 * or falls back to browser .axmodel.zip export.
 */
export async function saveToAxionikDb(svc: BankService, options?: {
  customSlug?: string;
  customName?: string;
  saveAs?: boolean;
  sublibrary?: string;
  sublibraryOrdinal?: number;
}): Promise<{ slug: string; path: string; isBridge: boolean; count: number; sublibrary: string }> {
  const session = svc.ctx.getSession();
  const activeSlot = session?.processConfig.modelNumber ?? 0;
  const model = svc.generatedModels.find((m) => m.slot === activeSlot);

  const modelName =
    options?.customName ??
    session?.processConfig.modelName ??
    model?.name ??
    `Model_${activeSlot}`;

  const existingSlugs = svc.generatedModels
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
  let zoneBinaries = svc.modelZoneBinaries.get(activeSlot);
  if (!zoneBinaries) {
    svc.ctx.ensureDemoBuffers(zones);
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
        const lowBuffer = svc.ctx.getSampleBuffer(sLow) ?? null;
        const analyzedLow = svc.ctx.analyzeZone({ zone: { ...zone, sampleLow: sLow }, wavBuffer: lowBuffer }, cfg);
        const pairLow: ZoneBinaryPair = {
          scapeBinary: analyzedLow.scapeBinary,
          sphereBinary: analyzedLow.sphereBinary,
        };
        analyzedBySample.set(sLow, pairLow);
        zoneBinaries.push(pairLow);
      }
      if (zone.sampleHigh && !analyzedBySample.has(zone.sampleHigh)) {
        const highBuffer = svc.ctx.getSampleBuffer(zone.sampleHigh) ?? null;
        const analyzedHigh = svc.ctx.analyzeZone(
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
    svc.modelZoneBinaries.set(activeSlot, zoneBinaries);
  }

  const assetStore = svc.ctx.getAssetStore();
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
      } else if (!svc.ctx.hasImportedBinary(sName) && !assetStore.hasEnhancedAudio(sName)) {
        const activeBuf = svc.ctx.getSampleBuffer(sName);
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
    mapScriptVersion: svc.modelMapScriptVersions.get(activeSlot),
    neuronikModelJson: model?.neuronikModelJson,
    expandedModelV2: svc.modelExpandedModelsV2.get(activeSlot),
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
  svc.upsertModel(updatedModel);
  svc.persistBank();

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
    const zipBytes = buildModelZipBytes(svc, activeSlot);
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

  const bank = await svc.loadBank();
  svc.ctx.emit({ type: 'bank-updated', bank });

  return {
    slug,
    path: savedPath,
    isBridge,
    count: filesWritten,
    sublibrary,
  };
}

export async function importModel(svc: BankService, 
  _sourcePath: string,
  slot: number
): Promise<GeneratedModel> {
  const safeSlot =
    slot === PINNED_SINEW_SLOT
      ? svc.getNextAvailableSlot(0)
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
  svc.upsertModel(model);
  svc.persistBank();
  const bank = await svc.loadBank();
  svc.ctx.emit({ type: 'bank-updated', bank });
  return model;
}


export function finalizeModelGeneration(svc: BankService, 
  config: ProcessConfig,
  zoneCount: number,
  zonesAnalysis: ZoneAnalysisSummary[],
  zoneBinaries: ZoneBinaryPair[],
  neuronikModelJson: string,
  elapsedMs: number,
  appendStep?: ProvenanceStep,
  expandedModelV2?: AxionikExpandedModel
): void {
  const targetSlot =
    config.modelNumber === PINNED_SINEW_SLOT && config.modelName.toLowerCase() !== 'sinew'
      ? svc.getNextAvailableSlot(0)
      : config.modelNumber;
  svc.modelZoneBinaries.set(targetSlot, zoneBinaries);
  if (expandedModelV2) {
    svc.modelExpandedModelsV2.set(targetSlot, expandedModelV2);
  }

  const session = svc.ctx.getSession();
  const assetStore = svc.ctx.getAssetStore();
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

  const existingModel = svc.getModelRecord(targetSlot);
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
    mapScriptVersion: svc.modelMapScriptVersions.get(targetSlot),
    neuronikModelJson,
    expandedModelV2,
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

  svc.upsertModel(model);
  svc.persistBank();

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
  svc.ctx.setProcessProgress(progress);

  svc.ctx.emit({
    type: 'process-progress',
    progress: { ...progress },
  });
  svc.ctx.emit({ type: 'process-complete', model });
}

