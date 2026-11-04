// ─────────────────────────────────────────────────────────
// Sampler preset identity — single source of truth for the
// `format` / `formatLabel` / `detectedCategory` / `suggestedParameterSet`
// quartet required by `ParsedSamplerPreset`.
//
// Lives in its own module so the per-format parsers can fill those fields
// without importing `rawSamplerParsers.ts` (which imports them, so a value
// import back would create a cycle).
// ─────────────────────────────────────────────────────────

import type { RawSamplerFormat } from './rawSamplerParsers.ts';

export interface PresetCategory {
  category: string;
  parameterSet: number;
}

/**
 * Deterministic name-based category/parameter-set classifier.
 * Used both at parse time and when converting imported presets.
 *
 * `sampleNames` is optional context: when the preset name alone yields the
 * generic 'Synthesizer' fallback, the sample file names are folded in so batch
 * jobs named after folders ("Bank 03") still pick up a hint from "cello_C3.wav".
 */
export function classifyPresetCategory(name: string, sampleNames: string[] = []): PresetCategory {
  const direct = classifyName(name);
  if (direct.category !== 'Synthesizer' || sampleNames.length === 0) return direct;
  return classifyName(`${name} ${sampleNames.slice(0, 8).join(' ')}`);
}

function classifyName(name: string): PresetCategory {
  const lower = name.toLowerCase();
  if (/violin|viola|cello|string|strad|bow/i.test(lower)) return { category: 'Strings', parameterSet: 1 };
  if (/piano|rhodes|wurlitzer|clav|keys|organ/i.test(lower)) return { category: 'Piano & Keys', parameterSet: 2 };
  if (/guitar|bass|fret|pluck|slap/i.test(lower)) return { category: 'Guitar & Bass', parameterSet: 4 };
  if (/flute|sax|reed|wind|pipe|duduk|horn|trumpet|brass/i.test(lower)) return { category: 'Winds & Brass', parameterSet: 5 };
  if (/choir|vocal|voice|chant|choral/i.test(lower)) return { category: 'Vocal & Choir', parameterSet: 6 };
  if (/drum|snare|kick|perc|808|timpani|marimba/i.test(lower)) return { category: 'Drums & Percussion', parameterSet: 7 };
  if (/pad|ambient|drone|sweep|atmos/i.test(lower)) return { category: 'Pads & Atmospheres', parameterSet: 8 };
  return { category: 'Synthesizer', parameterSet: 0 };
}

export interface PresetIdentity {
  format: RawSamplerFormat;
  formatLabel: string;
  detectedCategory: string;
  suggestedParameterSet: number;
}

/**
 * Builds the required preset identity fields from a format tag and preset name.
 */
export function presetIdentity(
  format: RawSamplerFormat,
  formatLabel: string,
  presetName: string
): PresetIdentity {
  const { category, parameterSet } = classifyPresetCategory(presetName);
  return {
    format,
    formatLabel,
    detectedCategory: category,
    suggestedParameterSet: parameterSet,
  };
}
