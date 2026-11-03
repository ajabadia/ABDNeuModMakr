// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Triage Gate adapter (Fase 35)
// Pure, DOM-free adapter between mixed content (folder drops,
// multi-file drops, .zip expansions), the MultiAssetDiscovery
// engine and the MultiAssetTriageModal / BatchProcessor.
// ─────────────────────────────────────────────────────────

import { VirtualZipFs } from '../formats/VirtualZipFs.ts';
import {
  discoverSamplerAssets,
  type DiscoveredSamplerItem,
  type MultiAssetDiscoveryReport,
} from '../formats/MultiAssetDiscovery.ts';
import { isSupportedAudioFileName } from '@abdsynths/shared/formats/neuron';
import type { FolderFileInput } from '../core/batch/FolderBatchExtractor';

export interface TriageExpandedFile {
  name: string;
  buffer: ArrayBuffer;
}

/** Preset-container extensions ignored by the single-format folder flows. */
export const TRIAGE_CONTAINER_EXTENSIONS = [
  '.sf2',
  '.sfz',
  '.dspreset',
  '.nki',
  '.vstpreset',
  '.multisample',
  '.rx2',
  '.rex',
  '.rcy',
  '.adv',
  '.exs',
  '.xpm',
];

function normalizeTriagePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

function triageBasename(p: string): string {
  return p.split('/').pop() ?? p;
}

/** Zero-copy VFS over already-expanded entries (folders, multi-drops, zips). */
export function buildTriageVfs(files: TriageExpandedFile[]): VirtualZipFs {
  return VirtualZipFs.fromFileArray(
    files.map((f) => ({ path: f.name, data: new Uint8Array(f.buffer) }))
  );
}

/** Runs discovery, never throws: failure means "keep the legacy fast path". */
export async function discoverTriageReport(
  files: TriageExpandedFile[],
  sourceLabel: string
): Promise<MultiAssetDiscoveryReport | null> {
  try {
    return await discoverSamplerAssets(buildTriageVfs(files), sourceLabel);
  } catch {
    return null;
  }
}

/**
 * The gate opens only for genuinely mixed content: two or more discovered
 * entities spanning two or more asset formats. Single-format flows
 * (one SF2, one model, pure audio folders) keep their existing fast paths.
 */
export function shouldOpenTriageGate(
  report: MultiAssetDiscoveryReport | null
): boolean {
  if (!report || report.items.length < 2) return false;
  return new Set(report.items.map((it) => it.format)).size >= 2;
}

export function indexTriageBuffers(
  files: TriageExpandedFile[]
): Map<string, TriageExpandedFile> {
  const byPath = new Map<string, TriageExpandedFile>();
  for (const f of files) {
    const key = normalizeTriagePath(f.name);
    if (!byPath.has(key)) byPath.set(key, f);
  }
  return byPath;
}

function findByUniqueBasename(
  byPath: Map<string, TriageExpandedFile>,
  p: string
): TriageExpandedFile | undefined {
  const base = triageBasename(p).toLowerCase();
  let hit: TriageExpandedFile | undefined;
  let count = 0;
  for (const f of byPath.values()) {
    if (triageBasename(f.name).toLowerCase() === base) {
      hit = f;
      count++;
      if (count > 1) return undefined;
    }
  }
  return hit;
}

/** Resolves every buffer behind a discovery item (primary + companions). */
export function resolveTriageItemFiles(
  item: DiscoveredSamplerItem,
  byPath: Map<string, TriageExpandedFile>
): TriageExpandedFile[] {
  const out: TriageExpandedFile[] = [];
  const seen = new Set<TriageExpandedFile>();
  for (const p of [item.primaryFilePath, ...item.companionFilePaths]) {
    const direct = byPath.get(normalizeTriagePath(p)) ?? findByUniqueBasename(byPath, p);
    if (direct && !seen.has(direct)) {
      seen.add(direct);
      out.push(direct);
    }
  }
  return out;
}

/** True when every resolved file is playable/mappable audio. */
export function isTriageAudioItem(files: TriageExpandedFile[]): boolean {
  return (
    files.length > 0 &&
    files.every((f) => isSupportedAudioFileName(triageBasename(f.name).toLowerCase()))
  );
}

export interface TriageBatchPartition {
  audioInputs: FolderFileInput[];
  sf2Blobs: TriageExpandedFile[];
  skipped: DiscoveredSamplerItem[];
}

/**
 * Splits a triage selection into what the BatchProcessor understands today
 * (audio packs + self-contained SF2) and what still needs Universal Import.
 */
export function partitionTriageSelection(
  selected: DiscoveredSamplerItem[],
  byPath: Map<string, TriageExpandedFile>
): TriageBatchPartition {
  const part: TriageBatchPartition = { audioInputs: [], sf2Blobs: [], skipped: [] };
  for (const item of selected) {
    const files = resolveTriageItemFiles(item, byPath);
    if (files.length === 0) {
      part.skipped.push(item);
      continue;
    }
    const primaryBase = triageBasename(item.primaryFilePath).toLowerCase();
    if (primaryBase.endsWith('.sf2')) {
      part.sf2Blobs.push(files.find((f) => f.name.toLowerCase().endsWith('.sf2')) ?? files[0]);
      continue;
    }
    if (isTriageAudioItem(files)) {
      for (const f of files) {
        part.audioInputs.push({ path: f.name, name: triageBasename(f.name), buffer: f.buffer });
      }
      continue;
    }
    part.skipped.push(item);
  }
  return part;
}
