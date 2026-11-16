// ─────────────────────────────────────────────────────────
// @abdsynths/shared - Canonical Sampler Capsule (.abdsmpl.zip) & Time Capsule Bridge
//
// Self-contained ZIP container storing any UniversalSamplerInstrument
// (articulation, hierarchical groups, 2D regions, envelopes, filters,
// LFOs, mod matrix, and raw audioPool samples) in our canonical format,
// while maintaining full read/write compatibility with ABDNeuModMakr
// 5-Layer Time Capsules (`01_raw_source/native_map.json`).
// ─────────────────────────────────────────────────────────

import {
  createZipArchive,
  parseZipArchive,
  type ZipEntryInput,
} from '../NeuronFormats/ZipArchive.ts';
import {
  createDefaultArticulation,
  projectExtendedRegionsToClassicZones,
  syncExtendedRegionsFromClassicZones,
} from './ExtendedAdapter.ts';
import {
  sessionToUniversalSamplerInstrument,
  type UniversalSamplerGroup,
  type UniversalSamplerInstrument,
  type UniversalSamplerModRoute,
} from './UniversalSamplerModel.ts';
import type {
  ExtendedModelMetadata,
  ExtendedRegion,
  SamplerSessionLike,
  SynthArticulationConfig,
  Zone,
} from './SamplerTypes.ts';
import { basename } from './SamplerUtils.ts';

export const UNIVERSAL_SAMPLER_CAPSULE_FORMAT = 'abdsynths.universal-sampler-capsule';
export const UNIVERSAL_SAMPLER_CAPSULE_SCHEMA = '1.0';

interface CapsuleSampleManifestEntry {
  sampleName: string;
  archivePath: string;
}

interface SerializedUniversalCapsule {
  schemaVersion: string;
  format: string;
  id: string;
  name: string;
  expandedName?: string;
  metadata: ExtendedModelMetadata;
  articulation: SynthArticulationConfig;
  groups: UniversalSamplerGroup[];
  regions: ExtendedRegion[];
  modMatrix: UniversalSamplerModRoute[];
  parameters: Record<string, number>;
  sampleManifest: CapsuleSampleManifestEntry[];
}

function sanitizeFlatName(name: string, fallback: string): string {
  const base = basename(name).replace(/\.\.+/g, '').replace(/[\\/]/g, '_').trim();
  return base.length > 0 ? base : fallback;
}

function toArrayBufferSlice(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Serializes any `UniversalSamplerInstrument` (and its `audioPool`) into a
 * self-contained `.abdsmpl.zip` archive compatible with `ABDNeuModMakr`
 * Time Capsule Layer `01_raw_source`.
 */
export function exportUniversalSamplerCapsule(instrument: UniversalSamplerInstrument): Uint8Array {
  const entries: ZipEntryInput[] = [];
  const sampleManifest: CapsuleSampleManifestEntry[] = [];
  const usedArchiveNames = new Set<string>();

  if (instrument.audioPool) {
    let idx = 1;
    for (const [sampleName, buf] of instrument.audioPool.entries()) {
      let flat = sanitizeFlatName(sampleName, `sample_${idx}.wav`);
      if (usedArchiveNames.has(flat.toLowerCase())) {
        const dot = flat.lastIndexOf('.');
        const stem = dot > 0 ? flat.slice(0, dot) : flat;
        const ext = dot > 0 ? flat.slice(dot) : '';
        flat = `${stem}_${idx}${ext}`;
      }
      usedArchiveNames.add(flat.toLowerCase());
      const archivePath = `01_raw_source/${flat}`;
      sampleManifest.push({ sampleName, archivePath });
      entries.push({
        path: archivePath,
        data: new Uint8Array(buf),
      });
      idx++;
    }
  }

  const canonicalDoc: SerializedUniversalCapsule = {
    schemaVersion: UNIVERSAL_SAMPLER_CAPSULE_SCHEMA,
    format: UNIVERSAL_SAMPLER_CAPSULE_FORMAT,
    id: instrument.id,
    name: instrument.name,
    expandedName: instrument.expandedName || instrument.name,
    metadata: instrument.metadata,
    articulation: instrument.articulation,
    groups: instrument.groups,
    regions: instrument.regions,
    modMatrix: instrument.modMatrix,
    parameters: instrument.parameters,
    sampleManifest,
  };

  entries.push({
    path: 'universal_instrument.json',
    data: JSON.stringify(canonicalDoc, null, 2),
  });

  const projection = projectExtendedRegionsToClassicZones(instrument.regions);
  entries.push({
    path: '01_raw_source/native_map.json',
    data: JSON.stringify(
      {
        schemaVersion: '1.0',
        layer: '01_raw_source',
        zones: projection.zones,
        extendedRegions: instrument.regions,
        articulation: instrument.articulation,
        metadata: instrument.metadata,
        sampleNames: sampleManifest.map((m) => m.sampleName),
      },
      null,
      2,
    ),
  });

  return createZipArchive(entries);
}

/**
 * Restores a `UniversalSamplerInstrument` from either a `.abdsmpl.zip` canonical
 * capsule (`universal_instrument.json`) or an `ABDNeuModMakr` `.neuronikmodel`
 * 5-layer Time Capsule (`01_raw_source/native_map.json` + audio payloads).
 */
export function importUniversalSamplerCapsule(
  zipBytes: Uint8Array,
  fallbackName = 'Canonical Sampler Instrument',
): UniversalSamplerInstrument {
  const entries = parseZipArchive(zipBytes);
  const byNormPath = new Map<string, Uint8Array>();
  const byLowerPath = new Map<string, Uint8Array>();
  const audioByBasename = new Map<string, { priority: number; buffer: ArrayBuffer }>();

  const audioExtRe = /\.(wav|aif|aiff|flac|ogg|caf)$/i;
  for (const entry of entries) {
    const norm = entry.path.replace(/\\/g, '/').replace(/^\/+/, '');
    byNormPath.set(norm, entry.data);
    const lower = norm.toLowerCase();
    byLowerPath.set(lower, entry.data);

    if (audioExtRe.test(lower)) {
      const priority = lower.startsWith('01_raw_source/')
        ? 3
        : lower.startsWith('03_enhanced_audio/')
          ? 2
          : 1;
      const base = basename(norm).toLowerCase();
      const prev = audioByBasename.get(base);
      if (!prev || priority > prev.priority) {
        audioByBasename.set(base, {
          priority,
          buffer: toArrayBufferSlice(entry.data),
        });
      }
    }
  }

  const findAudioForSampleName = (sampleName: string): ArrayBuffer | undefined => {
    const clean = sampleName.replace(/\\/g, '/').replace(/^\/+/, '');
    const lowerClean = clean.toLowerCase();
    const candidates = [
      lowerClean,
      `01_raw_source/${lowerClean}`,
      `01_raw_source/${basename(clean).toLowerCase()}`,
      `03_enhanced_audio/${basename(clean).toLowerCase()}`,
      `samples/${lowerClean}`,
    ];
    for (const key of candidates) {
      const raw = byLowerPath.get(key);
      if (raw) return toArrayBufferSlice(raw);
    }
    return audioByBasename.get(basename(clean).toLowerCase())?.buffer;
  };

  // Path A: Canonical Universal Sampler Capsule (universal_instrument.json)
  const canonicalBytes = byLowerPath.get('universal_instrument.json');
  if (canonicalBytes) {
    const doc = JSON.parse(decodeUtf8(canonicalBytes)) as Partial<SerializedUniversalCapsule>;
    const audioPool = new Map<string, ArrayBuffer>();

    if (Array.isArray(doc.sampleManifest)) {
      for (const item of doc.sampleManifest) {
        if (!item?.sampleName || !item?.archivePath) continue;
        const normArchive = item.archivePath.replace(/\\/g, '/').replace(/^\/+/, '');
        const raw =
          byNormPath.get(normArchive) ??
          byLowerPath.get(normArchive.toLowerCase());
        if (raw) {
          audioPool.set(item.sampleName, toArrayBufferSlice(raw));
        }
      }
    }

    const regions: ExtendedRegion[] = Array.isArray(doc.regions) ? doc.regions : [];
    for (const reg of regions) {
      if (reg.sampleName && !audioPool.has(reg.sampleName)) {
        const resolved = findAudioForSampleName(reg.sampleName);
        if (resolved) audioPool.set(reg.sampleName, resolved);
      }
    }

    // Also expose any remaining 01_raw_source audio files by basename
    for (const entry of entries) {
      const norm = entry.path.replace(/\\/g, '/');
      if (norm.toLowerCase().startsWith('01_raw_source/') && audioExtRe.test(norm)) {
        const base = basename(norm);
        if (!audioPool.has(base)) {
          audioPool.set(base, toArrayBufferSlice(entry.data));
        }
      }
    }

    const baseTitle = fallbackName.replace(/\.(abdsmpl\.zip|abdsmpl|zip|neuronikmodel)$/i, '').trim();
    const displayName = doc.expandedName || doc.name || baseTitle || 'Universal Sampler';
    return {
      id: doc.id || `inst-${displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name: (doc.name || displayName).slice(0, 11) || 'Sampler',
      expandedName: displayName,
      metadata: {
        ...(doc.metadata ?? {}),
        sourceFormat: doc.metadata?.sourceFormat || 'abdsmpl',
        sourcePresetName: doc.metadata?.sourcePresetName || displayName,
      },
      articulation: doc.articulation ?? createDefaultArticulation(),
      groups: Array.isArray(doc.groups) ? doc.groups : [],
      regions,
      modMatrix: Array.isArray(doc.modMatrix) ? doc.modMatrix : [],
      parameters: doc.parameters ?? {},
      audioPool,
    };
  }

  // Path B: ABDNeuModMakr .neuronikmodel 5-Layer Time Capsule
  const manifestBytes = byLowerPath.get('manifest.json');
  const nativeMapBytes = byLowerPath.get('01_raw_source/native_map.json');
  const extMapBytes = byLowerPath.get('05_extended_model/extended_map.json');

  if (!nativeMapBytes && !extMapBytes) {
    throw new Error(
      'Invalid canonical sampler capsule: missing universal_instrument.json or 01_raw_source/native_map.json',
    );
  }

  const manifestObj = manifestBytes
    ? (JSON.parse(decodeUtf8(manifestBytes)) as Record<string, unknown>)
    : {};
  const nativeMapObj = nativeMapBytes
    ? (JSON.parse(decodeUtf8(nativeMapBytes)) as {
        zones?: Zone[];
        extendedRegions?: ExtendedRegion[];
        articulation?: SynthArticulationConfig;
        metadata?: ExtendedModelMetadata;
        sampleNames?: string[];
      })
    : undefined;
  const extMapObj = extMapBytes
    ? (JSON.parse(decodeUtf8(extMapBytes)) as {
        zones?: Zone[];
        extendedRegions?: ExtendedRegion[];
        articulation?: SynthArticulationConfig;
        extendedMetadata?: ExtendedModelMetadata;
      })
    : undefined;

  const zones: Zone[] = nativeMapObj?.zones ?? extMapObj?.zones ?? [];
  const rawExtRegions: ExtendedRegion[] =
    nativeMapObj?.extendedRegions && nativeMapObj.extendedRegions.length > 0
      ? nativeMapObj.extendedRegions
      : extMapObj?.extendedRegions && extMapObj.extendedRegions.length > 0
        ? extMapObj.extendedRegions
        : syncExtendedRegionsFromClassicZones(zones);

  const audioPool = new Map<string, ArrayBuffer>();
  for (const reg of rawExtRegions) {
    if (reg.sampleName && !audioPool.has(reg.sampleName)) {
      const buf = findAudioForSampleName(reg.sampleName);
      if (buf) audioPool.set(reg.sampleName, buf);
    }
  }
  if (Array.isArray(nativeMapObj?.sampleNames)) {
    for (const sName of nativeMapObj.sampleNames) {
      if (sName && !audioPool.has(sName)) {
        const buf = findAudioForSampleName(sName);
        if (buf) audioPool.set(sName, buf);
      }
    }
  }
  for (const [baseLower, entry] of audioByBasename.entries()) {
    const matchingPath = entries.find((e) => basename(e.path).toLowerCase() === baseLower);
    const originalBase = matchingPath ? basename(matchingPath.path) : baseLower;
    if (!audioPool.has(originalBase)) {
      audioPool.set(originalBase, entry.buffer);
    }
  }

  const cleanFileTitle = fallbackName.replace(/\.(neuronikmodel|abdsmpl\.zip|abdsmpl|zip)$/i, '').trim();
  const expandedName =
    (typeof manifestObj.expandedName === 'string' && manifestObj.expandedName) ||
    (typeof manifestObj.modelName === 'string' && manifestObj.modelName) ||
    cleanFileTitle ||
    'TimeCapsule';
  const modelName =
    (typeof manifestObj.modelName === 'string' && manifestObj.modelName) ||
    expandedName.slice(0, 11) ||
    'Capsule';

  const pseudoSession: SamplerSessionLike = {
    id: `capsule-${expandedName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name: expandedName,
    zones: zones.length > 0 ? zones : projectExtendedRegionsToClassicZones(rawExtRegions).zones,
    extendedRegions: rawExtRegions,
    articulation: nativeMapObj?.articulation ?? extMapObj?.articulation ?? createDefaultArticulation(),
    detectedInstrumentCategory:
      typeof manifestObj.category === 'string' ? manifestObj.category : undefined,
    processConfig: {
      modelNumber: 0,
      modelName: modelName.slice(0, 11),
      expandedName,
      complexity: 8,
      parameterSet: 0,
      workingMode: 'extended',
      extendedMetadata: {
        ...(extMapObj?.extendedMetadata ?? nativeMapObj?.metadata ?? {}),
        sourceFormat:
          nativeMapObj?.metadata?.sourceFormat ||
          extMapObj?.extendedMetadata?.sourceFormat ||
          'neuronikmodel',
        sourcePresetName: expandedName,
      },
    },
  };

  return sessionToUniversalSamplerInstrument(pseudoSession, audioPool);
}
