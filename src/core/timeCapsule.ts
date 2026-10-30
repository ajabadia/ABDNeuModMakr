// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Fase 9: 5-Layer Multi-Format Container ("Cápsula del Tiempo")
// & Zero-Generation-Loss ("Anti-Efecto Fotocopia") Lineage Engine
//
// Canonical 5-Layer Archive Structure:
//   manifest.json
//   provenance.json
//   01_raw_source/        -> Unaltered user/SF2/SFZ WAV/AIFF samples + native_map.json
//   02_legacy_original/   -> Untouched factory NeuronDB MName, map.script, %06d.scape/.sphere
//   03_enhanced_audio/    -> 24-bit / 96.000 Hz Master Wave WAVs (regenerated or promoted)
//   04_classic_enhanced/  -> Classic-compatible MName, map.script, %06d.scape/.sphere
//   05_extended_model/    -> High-res Float32 model.nmmodel + extended_map.json
// ─────────────────────────────────────────────────────────

import {
  createSoundPresetForModel,
  createZipArchive,
  parseZipArchive,
  serializeCanonicalMapScript,
  serializeMName,
  serializeSoundScript,
  serializeStickRec,
  type ZipEntryInput,
} from '@abdsynths/shared/formats/neuron';
import type {
  CapsuleLayerId,
  CapsuleLayerStats,
  ExtendedRegion,
  ModelProvenance,
  ProcessConfig,
  ProvenanceStep,
  SynthArticulationConfig,
  TimeCapsuleManifest,
  Zone,
} from './types.ts';
import type { ZoneBinaryPair } from './dsp/PipelineRunner.ts';
import type {
  LegacyOriginalSampleRecord,
  LegacyOriginalSlotBundle,
  NeuronAssetStore,
} from './storage/NeuronAssetStore.ts';
import {
  createDefaultArticulation,
  syncExtendedRegionsFromClassicZones,
} from './extendedAdapter.ts';
import {
  dataUrlToWebpBytes,
  parseWebpDimensions,
  webpBytesToDataUrl,
} from './coverArtwork.ts';

export const ALL_CAPSULE_LAYERS: readonly CapsuleLayerId[] = [
  '01_raw_source',
  '02_legacy_original',
  '03_enhanced_audio',
  '04_classic_enhanced',
  '05_extended_model',
];

export interface TimeCapsuleBuildInput {
  slot: number;
  modelName: string;
  processConfig: ProcessConfig;
  zones: Zone[];
  extendedRegions?: ExtendedRegion[];
  articulation?: SynthArticulationConfig;
  detectedInstrumentCategory?: string;
  /** Layer 01: Unaltered raw audio samples (`sampleName` -> `ArrayBuffer`) */
  rawSourceSamples?: ReadonlyMap<string, ArrayBuffer>;
  /** Layer 02: Untouched factory `.model` bundle (if model originated from legacy `.model`) */
  legacyOriginalBundle?: LegacyOriginalSlotBundle;
  /** Layer 03: Promoted/regenerated 24-bit / 96.000 Hz Master Wave samples (`sampleName` -> `ArrayBuffer`) */
  enhancedAudioSamples?: ReadonlyMap<string, ArrayBuffer>;
  /** Layer 04: Classic-compatible `.scape` / `.sphere` binary pairs for active zones */
  classicEnhancedBinaries?: ZoneBinaryPair[];
  mapScriptVersion?: {
    major: number;
    minor: number;
    build: number;
    lineEnding?: '\r\n' | '\n';
  };
  /** Layer 05: High-resolution `.nmmodel` Float32 JSON string */
  neuronikModelJson?: string;
  /** Optional safe parameter overrides for `Sounds/<NNN>.sound/sound.script` */
  soundParameterOverrides?: Record<string, number>;
  /** Previous provenance record (to preserve `createdAt`, `reprocessCount`, and `history`) */
  previousProvenance?: ModelProvenance;
  /** Optional new lineage step to append */
  appendStep?: ProvenanceStep;
  /** Include top-level `Models/`, `Sounds/`, `Modern/`, `Samples/` compatibility paths (default true) */
  includeTopLevelCompatibility?: boolean;
}

export interface BuiltTimeCapsule {
  entries: ZipEntryInput[];
  manifest: TimeCapsuleManifest;
  provenance: ModelProvenance;
}

function byteLengthOf(data: Uint8Array | string): number {
  if (typeof data === 'string') {
    return new TextEncoder().encode(data).byteLength;
  }
  return data.byteLength;
}

/**
 * Builds the 5-Layer Time Capsule entries, `manifest.json`, and `provenance.json`.
 */
export function buildTimeCapsuleEntries(
  input: TimeCapsuleBuildInput
): BuiltTimeCapsule {
  const nowIso = new Date().toISOString();
  const slot = Math.max(0, Math.min(511, Math.round(input.slot)));
  const slotStr = String(slot).padStart(3, '0');
  const fullName = input.modelName.trim() || 'UNTITLED';
  const legacyMName = fullName.slice(0, 11);
  const extRegions =
    input.extendedRegions && input.extendedRegions.length > 0
      ? input.extendedRegions
      : syncExtendedRegionsFromClassicZones(input.zones);
  const articulation = input.articulation ?? createDefaultArticulation();

  const layerEntries: Record<CapsuleLayerId, ZipEntryInput[]> = {
    '01_raw_source': [],
    '02_legacy_original': [],
    '03_enhanced_audio': [],
    '04_classic_enhanced': [],
    '05_extended_model': [],
  };

  // ── Layer 01: 01_raw_source/ ────────────────────────────
  if (input.rawSourceSamples && input.rawSourceSamples.size > 0) {
    for (const [sampleName, ab] of input.rawSourceSamples.entries()) {
      const cleanName = sampleName.split(/[\\/]/).pop() ?? sampleName;
      layerEntries['01_raw_source'].push({
        path: `01_raw_source/${cleanName}`,
        data: new Uint8Array(ab),
      });
    }
    const nativeMapJson = JSON.stringify(
      {
        schemaVersion: '1.0',
        layer: '01_raw_source',
        zones: input.zones,
        extendedRegions: extRegions,
        sampleNames: Array.from(input.rawSourceSamples.keys()),
      },
      null,
      2
    );
    layerEntries['01_raw_source'].push({
      path: '01_raw_source/native_map.json',
      data: nativeMapJson,
    });
  }

  // ── Layer 02: 02_legacy_original/ ───────────────────────
  if (
    input.legacyOriginalBundle &&
    input.legacyOriginalBundle.zoneBinaries.length > 0
  ) {
    const leg = input.legacyOriginalBundle;
    layerEntries['02_legacy_original'].push({
      path: '02_legacy_original/MName',
      data: serializeMName(leg.name.slice(0, 11) || legacyMName),
    });
    layerEntries['02_legacy_original'].push({
      path: '02_legacy_original/map.script',
      data: serializeCanonicalMapScript(leg.zones, leg.mapScriptVersion),
    });
    for (let i = 0; i < leg.zoneBinaries.length; i++) {
      const srcPrefix = String(i + 1).padStart(6, '0');
      layerEntries['02_legacy_original'].push({
        path: `02_legacy_original/${srcPrefix}.scape`,
        data: leg.zoneBinaries[i].scapeBinary,
      });
      layerEntries['02_legacy_original'].push({
        path: `02_legacy_original/${srcPrefix}.sphere`,
        data: leg.zoneBinaries[i].sphereBinary,
      });
    }
  }

  // ── Layer 03: 03_enhanced_audio/ (24-bit / 96.000 Hz Master Wave) ──
  if (input.enhancedAudioSamples && input.enhancedAudioSamples.size > 0) {
    for (const [sampleName, ab] of input.enhancedAudioSamples.entries()) {
      const cleanName = sampleName.split(/[\\/]/).pop() ?? sampleName;
      layerEntries['03_enhanced_audio'].push({
        path: `03_enhanced_audio/${cleanName}`,
        data: new Uint8Array(ab),
      });
    }
  }

  // ── Layer 04: 04_classic_enhanced/ ──────────────────────
  const classicBins = input.classicEnhancedBinaries ?? [];
  if (classicBins.length > 0 || input.zones.length > 0) {
    layerEntries['04_classic_enhanced'].push({
      path: '04_classic_enhanced/MName',
      data: serializeMName(legacyMName),
    });
    layerEntries['04_classic_enhanced'].push({
      path: '04_classic_enhanced/map.script',
      data: serializeCanonicalMapScript(input.zones, input.mapScriptVersion),
    });
    for (let i = 0; i < classicBins.length; i++) {
      const srcPrefix = String(i + 1).padStart(6, '0');
      layerEntries['04_classic_enhanced'].push({
        path: `04_classic_enhanced/${srcPrefix}.scape`,
        data: classicBins[i].scapeBinary,
      });
      layerEntries['04_classic_enhanced'].push({
        path: `04_classic_enhanced/${srcPrefix}.sphere`,
        data: classicBins[i].sphereBinary,
      });
    }
  }

  // ── Layer 05: 05_extended_model/ ────────────────────────
  const coverArtwork =
    input.processConfig.workingMode === 'extended'
      ? (input.processConfig.coverArtwork ?? null)
      : null;
  let coverWebpBytes: Uint8Array | null = null;
  if (coverArtwork && coverArtwork.webpDataUrl) {
    try {
      coverWebpBytes = dataUrlToWebpBytes(coverArtwork.webpDataUrl);
    } catch {
      coverWebpBytes = null;
    }
  }

  const nmModelJson =
    input.neuronikModelJson ??
    JSON.stringify(
      {
        version: 2,
        schemaVersion: '2.1',
        targetFormat: 'modern-neural',
        name: fullName,
        slot,
        zoneCount: input.zones.length,
        parameterSet: input.processConfig.parameterSet,
        complexity: input.processConfig.complexity,
        dspAlgorithm: input.processConfig.dspAlgorithm ?? 'legacy',
        hasCoverArtwork: coverWebpBytes !== null,
      },
      null,
      2
    );
  layerEntries['05_extended_model'].push({
    path: '05_extended_model/model.nmmodel',
    data: nmModelJson,
  });
  layerEntries['05_extended_model'].push({
    path: '05_extended_model/extended_map.json',
    data: JSON.stringify(
      {
        schemaVersion: '1.0',
        layer: '05_extended_model',
        slot,
        modelName: fullName,
        workingMode: input.processConfig.workingMode ?? 'classic',
        dspAlgorithm: input.processConfig.dspAlgorithm ?? 'legacy',
        masterWaveConfig: input.processConfig.masterWaveConfig,
        detectedInstrumentCategory: input.detectedInstrumentCategory,
        hasCoverArtwork: coverWebpBytes !== null,
        coverPath: coverWebpBytes ? '05_extended_model/cover.webp' : undefined,
        extendedRegions: extRegions,
        articulation,
      },
      null,
      2
    ),
  });
  if (coverWebpBytes && coverWebpBytes.byteLength > 0) {
    layerEntries['05_extended_model'].push({
      path: '05_extended_model/cover.webp',
      data: coverWebpBytes,
    });
  }

  // Compute per-layer stats & presentLayers
  const presentLayers: CapsuleLayerId[] = [];
  const layerStats = {} as Record<CapsuleLayerId, CapsuleLayerStats>;
  for (const layerId of ALL_CAPSULE_LAYERS) {
    const list = layerEntries[layerId];
    const present = list.length > 0;
    let totalBytes = 0;
    for (const item of list) {
      totalBytes += byteLengthOf(item.data);
    }
    if (present) {
      presentLayers.push(layerId);
    }
    layerStats[layerId] = {
      layerId,
      present,
      fileCount: list.length,
      totalBytes,
      updatedAt: present ? nowIso : undefined,
    };
  }

  const hasRaw = layerStats['01_raw_source'].present;
  const hasLegacy = layerStats['02_legacy_original'].present;
  const hasEnhanced = layerStats['03_enhanced_audio'].present;

  const primarySourceLayer: '01_raw_source' | '02_legacy_original' = hasRaw
    ? '01_raw_source'
    : hasLegacy
      ? '02_legacy_original'
      : (input.previousProvenance?.primarySourceLayer ?? '01_raw_source');

  const activeAnalysisSourceLayer:
    | '01_raw_source'
    | '02_legacy_original'
    | '03_enhanced_audio' = hasEnhanced
    ? '03_enhanced_audio'
    : primarySourceLayer;

  const history: ProvenanceStep[] = [
    ...(input.previousProvenance?.history ?? []),
  ];
  if (input.appendStep) {
    history.push(input.appendStep);
  } else if (history.length === 0) {
    history.push({
      timestamp: nowIso,
      sourceLayer: activeAnalysisSourceLayer,
      targetLayer: '04_classic_enhanced',
      algorithm: `NAS-${input.processConfig.dspAlgorithm ?? 'legacy'}-c${input.processConfig.complexity}-ps${input.processConfig.parameterSet}`,
      details: `Compiled ${input.zones.length} zone(s) from ${activeAnalysisSourceLayer} without generation loss`,
    });
  }

  const provenance: ModelProvenance = {
    schemaVersion: '1.0',
    slot,
    modelName: fullName,
    primarySourceLayer,
    activeAnalysisSourceLayer,
    presentLayers,
    layerStats,
    dspAlgorithm: input.processConfig.dspAlgorithm ?? 'legacy',
    masterWavePromoted: hasEnhanced,
    reprocessCount: input.previousProvenance?.reprocessCount ?? 0,
    createdAt: input.previousProvenance?.createdAt ?? nowIso,
    updatedAt: nowIso,
    history,
  };

  const manifest: TimeCapsuleManifest = {
    magic: 'NEURONMM_TIMECAPSULE',
    version: '1.0.0',
    createdAt: provenance.createdAt,
    slot,
    modelName: fullName,
    processConfig: structuredClone(input.processConfig),
    zones: structuredClone(input.zones),
    extendedRegions: structuredClone(extRegions),
    articulation: structuredClone(articulation),
    detectedInstrumentCategory: input.detectedInstrumentCategory,
    presentLayers,
    hasCoverArtwork: coverWebpBytes !== null,
    coverArtworkMeta:
      coverArtwork && coverWebpBytes
        ? {
            width: coverArtwork.width,
            height: coverArtwork.height,
            byteLength: coverWebpBytes.byteLength,
            originalName: coverArtwork.originalName,
            updatedAt: coverArtwork.updatedAt,
          }
        : undefined,
  };

  const entries: ZipEntryInput[] = [
    {
      path: 'manifest.json',
      data: JSON.stringify(manifest, null, 2),
    },
    {
      path: 'provenance.json',
      data: JSON.stringify(provenance, null, 2),
    },
  ];

  for (const layerId of ALL_CAPSULE_LAYERS) {
    for (const item of layerEntries[layerId]) {
      entries.push(item);
    }
  }

  // Optional top-level compatibility entries (`Models/`, `Sounds/`, `Modern/`, `Samples/`)
  const includeCompat = input.includeTopLevelCompatibility !== false;
  if (includeCompat) {
    const target = input.processConfig.targetFormat ?? 'dual';
    if (target === 'dual' || target === 'legacy-neuron') {
      const modelPrefix = `Models/${slotStr}.model`;
      entries.push({
        path: `${modelPrefix}/MName`,
        data: serializeMName(legacyMName),
      });
      entries.push({
        path: `${modelPrefix}/map.script`,
        data: serializeCanonicalMapScript(input.zones, input.mapScriptVersion),
      });
      for (let i = 0; i < classicBins.length; i++) {
        const srcPrefix = String(i + 1).padStart(6, '0');
        entries.push({
          path: `${modelPrefix}/${srcPrefix}.scape`,
          data: classicBins[i].scapeBinary,
        });
        entries.push({
          path: `${modelPrefix}/${srcPrefix}.sphere`,
          data: classicBins[i].sphereBinary,
        });
      }

      const soundPrefix = `Sounds/${slotStr}.sound`;
      const soundPreset = createSoundPresetForModel({
        name: fullName.slice(0, 16),
        r1ModelIndex: slot,
      });
      if (input.soundParameterOverrides) {
        for (const [k, v] of Object.entries(input.soundParameterOverrides)) {
          if (typeof v === 'number' && Number.isFinite(v)) {
            soundPreset.values.set(k, v);
          }
        }
      }
      entries.push({
        path: `${soundPrefix}/sound.script`,
        data: serializeSoundScript(soundPreset),
      });
      entries.push({
        path: `${soundPrefix}/sound.stickrec`,
        data: serializeStickRec([]),
      });
    }

    if (target === 'dual' || target === 'modern-neural') {
      const safeFileSlug = fullName.replace(/[^A-Za-z0-9_-]+/g, '_') || 'Model';
      entries.push({
        path: `Modern/${slotStr}_${safeFileSlug}.nmmodel`,
        data: nmModelJson,
      });

      // Also include active zone samples under Samples/ when in extended workingMode
      if (input.processConfig.workingMode === 'extended') {
        const sampleSet = new Map<string, ArrayBuffer>();
        if (input.enhancedAudioSamples) {
          for (const [k, v] of input.enhancedAudioSamples.entries()) {
            sampleSet.set(k, v);
          }
        }
        if (input.rawSourceSamples) {
          for (const [k, v] of input.rawSourceSamples.entries()) {
            if (!sampleSet.has(k)) sampleSet.set(k, v);
          }
        }
        for (const [sName, ab] of sampleSet.entries()) {
          const cleanName = sName.split(/[\\/]/).pop() ?? sName;
          entries.push({
            path: `Samples/${cleanName}`,
            data: new Uint8Array(ab),
          });
        }
      }
    }
  }

  return { entries, manifest, provenance };
}

/**
 * Packages a 5-Layer Time Capsule into a standard PKZIP archive.
 */
export function buildTimeCapsuleZipArchive(
  input: TimeCapsuleBuildInput
): { zipBytes: Uint8Array; manifest: TimeCapsuleManifest; provenance: ModelProvenance } {
  const { entries, manifest, provenance } = buildTimeCapsuleEntries(input);
  return {
    zipBytes: createZipArchive(entries),
    manifest,
    provenance,
  };
}

// ── Time Capsule Reader & Extractor ───────────────────────

export interface ExtractedTimeCapsule {
  isTimeCapsule: boolean;
  manifest: TimeCapsuleManifest | null;
  provenance: ModelProvenance | null;
  rawSourceSamples: Map<string, ArrayBuffer>;
  legacyOriginalFiles: { name: string; data: Uint8Array }[];
  enhancedAudioSamples: Map<string, ArrayBuffer>;
  classicEnhancedFiles: { name: string; data: Uint8Array }[];
  extendedModelJson: string | null;
  /** Fase 14: Extracted `05_extended_model/cover.webp` binary if present */
  coverWebpBytes: Uint8Array | null;
  /** Top-level compatibility files (or synthesizable fallback files from 04_classic_enhanced / 02_legacy_original) for `parseModelFileSet` */
  modelParseFiles: { name: string; data: Uint8Array }[];
}

function toArrayBufferCopy(u8: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(u8.byteLength);
  copy.set(u8);
  return copy.buffer;
}

/**
 * Expands any `.zip` / `.nmpack` archives in `inputFiles` and extracts the 5 Time Capsule layers
 * alongside standard model files so `parseModelFileSet` never mixes `02_legacy_original` with `04_classic_enhanced`.
 */
export function extractTimeCapsuleFromFiles(
  inputFiles: readonly { name: string; data: Uint8Array }[]
): ExtractedTimeCapsule {
  const expanded: { name: string; data: Uint8Array }[] = [];
  const isUnsafeZipPath = (p: string): boolean => {
    const norm = p.replace(/\\/g, '/');
    return (
      norm.length === 0 ||
      norm.length > 512 ||
      norm.startsWith('/') ||
      /^[a-zA-Z]:[\\/]/.test(norm) ||
      norm.split('/').includes('..') ||
      norm.includes('\0')
    );
  };
  for (const f of inputFiles) {
    const lowerName = f.name.toLowerCase();
    if (lowerName.endsWith('.zip') || lowerName.endsWith('.nmpack')) {
      const unzipped = parseZipArchive(f.data);
      for (const u of unzipped) {
        if (isUnsafeZipPath(u.path)) continue; // S6.2 Zip-Slip: ignora entradas con .. o absolutas
        expanded.push({ name: u.path, data: u.data });
      }
    } else {
      expanded.push(f);
    }
  }

  let manifest: TimeCapsuleManifest | null = null;
  let provenance: ModelProvenance | null = null;
  const rawSourceSamples = new Map<string, ArrayBuffer>();
  const legacyOriginalFiles: { name: string; data: Uint8Array }[] = [];
  const enhancedAudioSamples = new Map<string, ArrayBuffer>();
  const classicEnhancedFiles: { name: string; data: Uint8Array }[] = [];
  let extendedModelJson: string | null = null;
  let coverWebpBytes: Uint8Array | null = null;
  const topLevelModelFiles: { name: string; data: Uint8Array }[] = [];

  for (const f of expanded) {
    const normPath = f.name.replace(/\\/g, '/');
    if (normPath.includes('__MACOSX/')) continue;
    const base = normPath.split('/').pop() ?? normPath;
    if (base.startsWith('._') || base === '.DS_Store') continue;
    const lowerBase = base.toLowerCase();

    if (normPath === 'manifest.json' || normPath.endsWith('/manifest.json')) {
      try {
        const parsed = JSON.parse(
          new TextDecoder().decode(f.data)
        ) as TimeCapsuleManifest;
        if (parsed && parsed.magic === 'NEURONMM_TIMECAPSULE') {
          manifest = parsed;
        }
      } catch {
        // ignore invalid manifest
      }
      continue;
    }

    if (normPath === 'provenance.json' || normPath.endsWith('/provenance.json')) {
      try {
        const parsed = JSON.parse(
          new TextDecoder().decode(f.data)
        ) as ModelProvenance;
        if (parsed && parsed.schemaVersion === '1.0') {
          provenance = parsed;
        }
      } catch {
        // ignore invalid provenance
      }
      continue;
    }

    if (normPath.startsWith('01_raw_source/')) {
      if (
        lowerBase.endsWith('.wav') ||
        lowerBase.endsWith('.aif') ||
        lowerBase.endsWith('.aiff')
      ) {
        rawSourceSamples.set(base, toArrayBufferCopy(f.data));
      }
      continue;
    }

    if (normPath.startsWith('02_legacy_original/')) {
      legacyOriginalFiles.push({ name: base, data: f.data });
      continue;
    }

    if (normPath.startsWith('03_enhanced_audio/')) {
      if (
        lowerBase.endsWith('.wav') ||
        lowerBase.endsWith('.aif') ||
        lowerBase.endsWith('.aiff')
      ) {
        enhancedAudioSamples.set(base, toArrayBufferCopy(f.data));
      }
      continue;
    }

    if (normPath.startsWith('04_classic_enhanced/')) {
      classicEnhancedFiles.push({ name: base, data: f.data });
      continue;
    }

    if (normPath.startsWith('05_extended_model/')) {
      if (
        lowerBase.endsWith('.nmmodel') ||
        lowerBase.endsWith('.neuronikmodel')
      ) {
        extendedModelJson = new TextDecoder().decode(f.data);
      } else if (lowerBase === 'cover.webp') {
        coverWebpBytes = new Uint8Array(f.data);
      }
      continue;
    }

    topLevelModelFiles.push(f);
  }

  const isTimeCapsule =
    manifest !== null ||
    provenance !== null ||
    rawSourceSamples.size > 0 ||
    legacyOriginalFiles.length > 0 ||
    enhancedAudioSamples.size > 0 ||
    classicEnhancedFiles.length > 0 ||
    extendedModelJson !== null;

  // Determine the files to pass to `parseModelFileSet`
  let modelParseFiles = topLevelModelFiles;
  if (modelParseFiles.length === 0 && isTimeCapsule) {
    const slotPrefix = manifest
      ? `Models/${String(manifest.slot).padStart(3, '0')}.model/`
      : 'Models/001.model/';
    const sourceClassic =
      classicEnhancedFiles.length > 0
        ? classicEnhancedFiles
        : legacyOriginalFiles;
    modelParseFiles = sourceClassic.map((cf) => ({
      name: `${slotPrefix}${cf.name}`,
      data: cf.data,
    }));
    if (extendedModelJson) {
      modelParseFiles.push({
        name: 'Modern/model.nmmodel',
        data: new TextEncoder().encode(extendedModelJson),
      });
    }
  }

  if (manifest && coverWebpBytes && !manifest.processConfig.coverArtwork) {
    const dims = parseWebpDimensions(coverWebpBytes);
    manifest.processConfig.coverArtwork = {
      webpDataUrl: webpBytesToDataUrl(coverWebpBytes),
      width: manifest.coverArtworkMeta?.width ?? dims.width,
      height: manifest.coverArtworkMeta?.height ?? dims.height,
      byteLength: coverWebpBytes.byteLength,
      originalName: manifest.coverArtworkMeta?.originalName ?? 'cover.webp',
      updatedAt: manifest.coverArtworkMeta?.updatedAt ?? manifest.createdAt,
    };
  }

  return {
    isTimeCapsule,
    manifest,
    provenance,
    rawSourceSamples,
    legacyOriginalFiles,
    enhancedAudioSamples,
    classicEnhancedFiles,
    extendedModelJson,
    coverWebpBytes,
    modelParseFiles,
  };
}

// ── Anti-Photocopy Lineage Resolver ──────────────────────

export type PurestZoneSource =
  | {
      sourceLayer: '01_raw_source';
      rawSampleName: string;
      rawBuffer: ArrayBuffer;
    }
  | {
      sourceLayer: '02_legacy_original';
      sampleName: string;
      legacyRecord: LegacyOriginalSampleRecord;
    }
  | {
      sourceLayer: '01_raw_source';
      rawSampleName: string;
      rawBuffer: ArrayBuffer;
      fallbackFromActiveBuffer: true;
    };

/**
 * Strictly resolves the purest primary source for a zone sample so re-processing
 * NEVER re-compresses or re-analyzes a degraded `04_classic_enhanced` derivative.
 *
 * Priority order:
 *   1. `01_raw_source` in `NeuronAssetStore` (unaltered original WAV/AIFF before Master Wave promotion)
 *   2. `02_legacy_original` in `NeuronAssetStore` (untouched factory `.scape`/`.sphere` binaries)
 *   3. Current unpromoted WAV buffer in `activeSampleBuffers`
 */
export function resolvePurestSourceForSample(
  sampleName: string,
  assetStore: NeuronAssetStore,
  activeSampleBuffers: ReadonlyMap<string, ArrayBuffer>
): PurestZoneSource | null {
  const rawName = assetStore.resolveRawSampleName(sampleName);
  const rawBuf = assetStore.getRawSourceSync(rawName);
  if (rawBuf) {
    return {
      sourceLayer: '01_raw_source',
      rawSampleName: rawName,
      rawBuffer: rawBuf,
    };
  }

  const legacyRec = assetStore.getLegacyOriginalSampleSync(sampleName);
  if (legacyRec) {
    return {
      sourceLayer: '02_legacy_original',
      sampleName: legacyRec.sampleName,
      legacyRecord: legacyRec,
    };
  }

  const activeBuf = activeSampleBuffers.get(sampleName);
  if (activeBuf) {
    return {
      sourceLayer: '01_raw_source',
      rawSampleName: sampleName,
      rawBuffer: activeBuf,
      fallbackFromActiveBuffer: true,
    };
  }

  return null;
}
