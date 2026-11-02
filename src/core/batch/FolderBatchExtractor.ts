// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Phase 12: Folder / Sample Pack Batch Extractor
// ─────────────────────────────────────────────────────────

import { createUniqueModelSlug } from '../modelSlug.ts';
import { classifyInstrumentAndParameterSet } from '../../formats/Sf2Parser.ts';
import type { BatchModelCandidate, BatchSlicerProfile } from './types.ts';
import { parseSliceFile } from '../dsp/SliceFileParser.ts';
import { fileExtension } from '../pathUtils.ts';
import { cloudByokClient, type CloudAiProvider } from '../ai/CloudByokClient.ts';

export interface FolderFileInput {
  /** Relative path (e.g. "VintageKeys/Rhodes_036_C2.wav" or "Rhodes_036_C2.wav") */
  path: string;
  name: string;
  buffer: ArrayBuffer;
}

const BARE_NOTE_OR_LAYER_RE =
  /^(?:[A-Ga-g][#b]?-?[0-9]|0?\d{1,3}|v[0-9]+|vl[0-9]+|vel[0-9]+|velocity[0-9]+|rr[0-9]+|layer[0-9]+|low|high|soft|loud)$/i;

/**
 * Extracts a common instrument or pack prefix from a sample filename.
 * Strips MIDI numbers, note names, velocity suffixes, and round-robin tokens.
 * If the filename consists solely of note/velocity tokens (e.g. "C3.wav", "060_v127.wav"),
 * returns "Instrument" so all notes of an unnamed single instrument stay grouped together.
 */
export function extractInstrumentPrefix(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '').trim();
  if (!base) return 'Instrument';

  // Split into tokens by underscore, hyphen, or whitespace
  const rawTokens = base.split(/[_\-\s]+/).filter(Boolean);
  if (rawTokens.length === 0) return 'Instrument';

  // Strip trailing note/velocity/MIDI tokens (e.g. "Grand_Piano_C#3_v127" -> ["Grand", "Piano"])
  let endIdx = rawTokens.length;
  while (endIdx > 0 && BARE_NOTE_OR_LAYER_RE.test(rawTokens[endIdx - 1])) {
    endIdx--;
  }

  // Also strip leading numeric index if followed by an instrument name (e.g. "01_Rhodes_C3" -> ["Rhodes"])
  let startIdx = 0;
  if (endIdx - startIdx > 1 && /^\d{1,3}$/.test(rawTokens[0])) {
    startIdx = 1;
  }

  const kept = rawTokens.slice(startIdx, endIdx);
  if (kept.length === 0 || kept.every((t) => BARE_NOTE_OR_LAYER_RE.test(t))) {
    return 'Instrument';
  }

  return kept.join(' ').trim() || 'Instrument';
}

/**
 * Fase 25: Discovers individual loop files (.wav, .aif, .rx2, .rex) as independent
 * AutoSlicer model candidates, where each loop becomes a sliced kit with GM Drum or Chromatic mapping.
 */
const ALL_FOLDER_AUDIO_EXTENSIONS = new Set([
  'wav', 'aif', 'aiff', 'aifc', 'flac', 'mp3', 'ogg', 'oga',
  'm4a', 'aac', 'opus', 'webm', 'caf', 'ncw', 'rx2', 'rex',
]);

export function extractFolderLoopsToCandidates(
  files: FolderFileInput[],
  options: {
    defaultOriginName?: string;
    slicerProfile?: BatchSlicerProfile;
    bpm?: number;
  } = {}
): BatchModelCandidate[] {
  const loopFiles = files.filter((f) => {
    const ext = fileExtension(f.name);
    return ext && ALL_FOLDER_AUDIO_EXTENSIONS.has(ext);
  });

  if (loopFiles.length === 0) {
    return [];
  }

  const profile = options.slicerProfile || 'drums';
  const candidates: BatchModelCandidate[] = [];
  const existingSlugs: string[] = [];

  for (let i = 0; i < loopFiles.length; i++) {
    const file = loopFiles[i];
    const ext = fileExtension(file.name);
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

  const audioFiles = files.filter((f) => {
    const ext = fileExtension(f.name);
    return ext && ALL_FOLDER_AUDIO_EXTENSIONS.has(ext);
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

/**
 * Uses AI (Cloud BYOK LLM) to semantically cluster sample filenames into distinct instruments,
 * falling back to `extractFolderFilesToCandidates` heuristics when AI is unavailable or returns null.
 */
export async function extractFolderFilesToCandidatesWithAi(
  files: FolderFileInput[],
  options: {
    defaultOriginName?: string;
    preferredProvider?: CloudAiProvider;
  } = {}
): Promise<BatchModelCandidate[]> {
  const audioFiles = files.filter((f) => {
    const ext = fileExtension(f.name);
    return ext && ALL_FOLDER_AUDIO_EXTENSIONS.has(ext);
  });

  if (audioFiles.length === 0) return [];

  const fileLookup = new Map<string, FolderFileInput>();
  for (const f of audioFiles) {
    fileLookup.set(f.name, f);
    fileLookup.set(f.path, f);
    fileLookup.set(f.name.toLowerCase(), f);
  }

  const aiGroups = await cloudByokClient.groupSampleFilenamesIntoInstruments(
    audioFiles.map((f) => f.name),
    options.preferredProvider
  );

  if (!aiGroups || aiGroups.length === 0) {
    return extractFolderFilesToCandidates(files, options);
  }

  const candidates: BatchModelCandidate[] = [];
  const existingSlugs: string[] = [];
  const assigned = new Set<FolderFileInput>();

  for (let i = 0; i < aiGroups.length; i++) {
    const grp = aiGroups[i];
    const matchedFiles: FolderFileInput[] = [];
    for (const fname of grp.files) {
      const f = fileLookup.get(fname) ?? fileLookup.get(fname.toLowerCase());
      if (f && !assigned.has(f)) {
        assigned.add(f);
        matchedFiles.push(f);
      }
    }
    if (matchedFiles.length === 0) continue;

    const cleanName = grp.name.trim() || `Instrument_${i + 1}`;
    const slug = createUniqueModelSlug(cleanName, existingSlugs);
    existingSlugs.push(slug);
    const classification = classifyInstrumentAndParameterSet(cleanName);
    const zoneCount = matchedFiles.length;
    const suggestedComplexity = zoneCount >= 8 ? 8 : zoneCount >= 4 ? 7 : 6;

    candidates.push({
      id: `ai_folder_${slug}_${Date.now()}_${i}`,
      name: cleanName,
      slug,
      sourceType: 'folder-pack',
      sourceOrigin: options.defaultOriginName || cleanName,
      zoneCount,
      detectedCategory: classification.category,
      suggestedParameterSet: classification.parameterSet,
      suggestedComplexity,
      status: 'pending',
      progressPct: 0,
      files: matchedFiles.map((f) => ({ name: f.name, buffer: f.buffer })),
    });
  }

  // Any leftover files not matched by AI are grouped heuristically
  const leftovers = audioFiles.filter((f) => !assigned.has(f));
  if (leftovers.length > 0) {
    const rest = extractFolderFilesToCandidates(leftovers, options);
    candidates.push(...rest);
  }

  return candidates.length > 0 ? candidates : extractFolderFilesToCandidates(files, options);
}
