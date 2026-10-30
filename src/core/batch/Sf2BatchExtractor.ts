// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Phase 12: SoundFont 2 Batch Extractor
// ─────────────────────────────────────────────────────────

import { listSf2Presets, importSf2PresetToNative } from '../../formats/Sf2Parser.ts';
import { createUniqueModelSlug } from '../modelSlug.ts';
import type { BatchModelCandidate } from './types.ts';

export interface Sf2ExtractOptions {
  soundFontName?: string;
  presetFilter?: (name: string, bank: number, presetNumber: number) => boolean;
  maxPresets?: number;
}

/**
 * Inspects a SoundFont 2 (.sf2) binary archive and extracts all or filtered
 * presets into discrete `BatchModelCandidate` items ready for queue processing.
 */
export function extractSf2PresetsToCandidates(
  sf2Buffer: ArrayBuffer,
  options: Sf2ExtractOptions = {}
): BatchModelCandidate[] {
  const sfName = options.soundFontName || 'SoundFont';
  const presets = listSf2Presets(sf2Buffer);
  const candidates: BatchModelCandidate[] = [];
  const existingSlugs: string[] = [];

  const max = options.maxPresets ?? 512;
  let count = 0;

  for (const p of presets) {
    if (count >= max) break;
    if (options.presetFilter && !options.presetFilter(p.name, p.bank, p.presetNumber)) {
      continue;
    }

    try {
      const imported = importSf2PresetToNative(sf2Buffer, p.index);
      if (!imported.audioFiles || imported.audioFiles.length === 0) {
        continue;
      }

      const cleanName = (imported.presetName || p.name || `Preset_${p.presetNumber}`).trim();
      const uniqueSlug = createUniqueModelSlug(cleanName, existingSlugs);
      existingSlugs.push(uniqueSlug);

      const zoneCount = imported.classicZones?.length || imported.extendedRegions?.length || imported.audioFiles.length;

      // Suggest complexity: richer multi-zone presets default to 8, simple to 6
      const suggestedComplexity = zoneCount >= 4 ? 8 : 6;

      candidates.push({
        id: `sf2_${p.bank}_${p.presetNumber}_${Date.now()}_${count}`,
        name: cleanName,
        slug: uniqueSlug,
        sourceType: 'sf2-preset',
        sourceOrigin: `${sfName} [Bank ${p.bank} : Preset ${p.presetNumber}]`,
        presetIndex: p.presetNumber,
        bankIndex: p.bank,
        zoneCount,
        detectedCategory: imported.detectedCategory || 'Keyboards & Acoustic Pianos',
        suggestedParameterSet: imported.suggestedParameterSet ?? 0,
        suggestedComplexity,
        status: 'pending',
        progressPct: 0,
        files: imported.audioFiles.map((af) => ({
          name: af.name,
          buffer: af.buffer,
        })),
        classicZones: imported.classicZones,
        extendedRegions: imported.extendedRegions,
        articulation: imported.articulation,
      });

      count++;
    } catch {
      // Ignore broken individual preset records without aborting entire extraction
    }
  }

  return candidates;
}
