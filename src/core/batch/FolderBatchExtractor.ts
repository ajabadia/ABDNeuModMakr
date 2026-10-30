// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Phase 12: Folder / Sample Pack Batch Extractor
// ─────────────────────────────────────────────────────────

import { createUniqueModelSlug } from '../modelSlug.ts';
import { classifyInstrumentAndParameterSet } from '../../formats/Sf2Parser.ts';
import type { BatchModelCandidate } from './types.ts';

export interface FolderFileInput {
  /** Relative path (e.g. "VintageKeys/Rhodes_036_C2.wav" or "Rhodes_036_C2.wav") */
  path: string;
  name: string;
  buffer: ArrayBuffer;
}

/**
 * Extracts a common instrument or pack prefix from a sample filename.
 * Strips MIDI numbers, note names, and velocity suffixes.
 */
export function extractInstrumentPrefix(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '');
  const match = base.match(/^([A-Za-z0-9\s]+?)(?:[_\-\s]+(?:[0-9]{1,3}|[A-Ga-g][#b]?-?[0-9]|v[12]|high|low|vel[12]))/i);
  if (match && match[1]?.trim()) {
    return match[1].trim();
  }
  const token = base.split(/[_\-]/)[0]?.trim();
  return token || base;
}

/**
 * Discovers model candidates from a collection of audio files, either by
 * subfolder hierarchy, by instrument prefix, or by legacy NeuronDB folder structures.
 */
export function extractFolderFilesToCandidates(
  files: FolderFileInput[],
  options: { defaultOriginName?: string } = {}
): BatchModelCandidate[] {
  const audioExtensions = new Set(['wav', 'aif', 'aiff']);
  const audioFiles = files.filter((f) => {
    const ext = f.name.split('.').pop()?.toLowerCase();
    return ext && audioExtensions.has(ext);
  });

  if (audioFiles.length === 0) {
    return [];
  }

  // 1. Group files by parent folder if paths contain directories
  const folderGroups = new Map<string, FolderFileInput[]>();
  const flatFiles: FolderFileInput[] = [];

  for (const f of audioFiles) {
    const normalized = f.path.replace(/\\/g, '/').replace(/^\/+/, '');
    const parts = normalized.split('/');
    if (parts.length > 1) {
      // Parent directory name (e.g. "Rhodes" from "Keyboards/Rhodes/c2.wav")
      const groupName = parts[parts.length - 2];
      if (!folderGroups.has(groupName)) {
        folderGroups.set(groupName, []);
      }
      folderGroups.get(groupName)!.push(f);
    } else {
      flatFiles.push(f);
    }
  }

  // 2. If flat files remain, group them by common filename prefix (e.g. "Rhodes_C1.wav", "Rhodes_C2.wav")
  if (flatFiles.length > 0) {
    const prefixGroups = new Map<string, FolderFileInput[]>();
    for (const f of flatFiles) {
      const prefix = extractInstrumentPrefix(f.name);

      if (!prefixGroups.has(prefix)) {
        prefixGroups.set(prefix, []);
      }
      prefixGroups.get(prefix)!.push(f);
    }

    for (const [prefix, pFiles] of prefixGroups.entries()) {
      folderGroups.set(prefix, pFiles);
    }
  }

  const candidates: BatchModelCandidate[] = [];
  const existingSlugs: string[] = [];
  let index = 0;

  for (const [groupName, gFiles] of folderGroups.entries()) {
    if (gFiles.length === 0) continue;

    const cleanName = groupName.trim() || `Model_${index + 1}`;
    const slug = createUniqueModelSlug(cleanName, existingSlugs);
    existingSlugs.push(slug);

    const classification = classifyInstrumentAndParameterSet(cleanName);
    const zoneCount = gFiles.length;
    const suggestedComplexity = zoneCount >= 8 ? 8 : zoneCount >= 4 ? 7 : 6;

    candidates.push({
      id: `folder_${slug}_${Date.now()}_${index}`,
      name: cleanName,
      slug,
      sourceType: 'folder-pack',
      sourceOrigin: options.defaultOriginName || groupName,
      zoneCount,
      detectedCategory: classification.category,
      suggestedParameterSet: classification.parameterSet,
      suggestedComplexity,
      status: 'pending',
      progressPct: 0,
      files: gFiles.map((f) => ({
        name: f.name,
        buffer: f.buffer,
      })),
    });

    index++;
  }

  return candidates;
}
