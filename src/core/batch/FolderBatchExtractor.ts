// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Phase 12: Folder / Sample Pack Batch Extractor
// ─────────────────────────────────────────────────────────

import { createUniqueModelSlug } from '../modelSlug.ts';
import { classifyInstrumentAndParameterSet } from '../../formats/Sf2Parser.ts';
import type { BatchModelCandidate, BatchSlicerProfile } from './types.ts';
import { parseSliceFile } from '../dsp/SliceFileParser.ts';

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
 * Fase 25: Discovers individual loop files (.wav, .aif, .rx2, .rex) as independent
 * AutoSlicer model candidates, where each loop becomes a sliced kit with GM Drum or Chromatic mapping.
 */
export function extractFolderLoopsToCandidates(
  files: FolderFileInput[],
  options: {
    defaultOriginName?: string;
    slicerProfile?: BatchSlicerProfile;
    bpm?: number;
  } = {}
): BatchModelCandidate[] {
  const loopExtensions = new Set(['wav', 'aif', 'aiff', 'rx2', 'rex']);
  const loopFiles = files.filter((f) => {
    const ext = f.name.split('.').pop()?.toLowerCase();
    return ext && loopExtensions.has(ext);
  });

  if (loopFiles.length === 0) {
    return [];
  }

  const profile = options.slicerProfile || 'drums';
  const candidates: BatchModelCandidate[] = [];
  const existingSlugs: string[] = [];

  for (let i = 0; i < loopFiles.length; i++) {
    const file = loopFiles[i];
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const cleanName = file.name.replace(/\.[^.]+$/, '').replace(/[_.-]+/g, ' ').trim() || `Loop_${i + 1}`;
    const slug = createUniqueModelSlug(cleanName, existingSlugs);
    existingSlugs.push(slug);

    // Try inspecting slice markers if format contains embedded cues/rex
    let estimatedSlices = 16;
    try {
      const parsed = parseSliceFile(file.buffer, file.name);
      if (parsed?.sliceFrames && parsed.sliceFrames.length > 0) {
        estimatedSlices = parsed.sliceFrames.length;
      }
    } catch {
      // transient ignore
    }

    const isRx2 = ext === 'rx2' || ext === 'rex';
    const detectedCategory = profile === 'drums' ? 'Drums' : profile === 'vocals' ? 'Vocals' : 'Synth';
    const suggestedParameterSet = profile === 'drums' ? 0 : profile === 'vocals' ? 1 : 2;

    candidates.push({
      id: `slicer_${slug}_${Date.now()}_${i}`,
      name: cleanName,
      slug,
      sourceType: isRx2 ? 'loop-rx2' : 'auto-slicer',
      sourceOrigin: options.defaultOriginName || file.path || file.name,
      zoneCount: estimatedSlices,
      detectedSliceCount: estimatedSlices,
      slicerProfile: profile,
      detectedCategory,
      suggestedParameterSet,
      suggestedComplexity: 8,
      status: 'pending',
      progressPct: 0,
      files: [{ name: file.name, buffer: file.buffer }],
    });
  }

  return candidates;
}

/**
 * Discovers model candidates from a collection of audio files, either by
 * subfolder hierarchy, by instrument prefix, or by legacy NeuronDB folder structures.
 */
export function extractFolderFilesToCandidates(
  files: FolderFileInput[],
  options: {
    defaultOriginName?: string;
    ingestionMode?: 'multisample' | 'slicer';
    slicerProfile?: BatchSlicerProfile;
  } = {}
): BatchModelCandidate[] {
  if (options.ingestionMode === 'slicer') {
    return extractFolderLoopsToCandidates(files, options);
  }

  const audioExtensions = new Set(['wav', 'aif', 'aiff', 'rx2', 'rex']);
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
