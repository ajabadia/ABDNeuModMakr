// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Sample Filename Conventions (P1.1b)
//
// Pure helpers extracted verbatim from `WebAudioPipeline`:
// Hartmann `Import by Name` parsing, root-key detection, model-name
// derivation and the default-name set. No behavior change.
// ─────────────────────────────────────────────────────────

import type { MidiNote } from './types.ts';

export interface ParsedSampleFilename {
  sampleName: string;
  rootKey: MidiNote;
  lowKey: MidiNote;
  velocityLayer: 1 | 2;
  isHighVelocity: boolean;
}

/**
 * Extracts MIDI rootKey, lowKey, and velocity layer (`1` = Low Vel, `2` = High Vel)
 * from a sample filename using both:
 *   1. The official Hartmann MODELmaker `Import by Name` (`NC_HARTMANN`) convention:
 *      `name_rootkey_lowkey[.ext]` or `name_rootkey_lowkey_v1[.ext]` / `name_rootkey_lowkey_v2[.ext]`
 *      (e.g. `Flute_72_68.aif`, `Flute_72_68_v1.aif`, `Flute_72_68_v2.aif`)
 *   2. Modern / manual patterns like `12 String Gtr-E2_high.aif`, `Piano_C3.wav`, `Bass_36_v2.wav`.
 */
export function parseSampleFilenameByName(
  filename: string,
  fallbackRoot: MidiNote = 60
): ParsedSampleFilename {
  const base = (filename.split(/[\\/]/).pop() ?? filename).replace(/\.[^.]+$/, '');
  const lower = base.toLowerCase();

  let velocityLayer: 1 | 2 = 1;
  if (/(?:[_\-\s](?:v2|high|hi|vel2|ff))$/i.test(lower)) {
    velocityLayer = 2;
  } else if (/(?:[_\-\s](?:v1|low|lo|vel1|pp))$/i.test(lower)) {
    velocityLayer = 1;
  }

  // 1. Check strict Hartmann `name_rootkey_lowkey[_v1|_v2]` numeric convention (`KeyZoneData.createKeyZoneFromFileByName`)
  const tokens = base.split('_');
  if (tokens.length >= 3) {
    const r = parseInt(tokens[1], 10);
    const l = parseInt(tokens[2], 10);
    if (!Number.isNaN(r) && r >= 0 && r <= 127 && !Number.isNaN(l) && l >= 0 && l <= 127) {
      if (tokens[3]) {
        const vTok = tokens[3].toLowerCase();
        if (vTok === 'v2' || vTok === 'high') velocityLayer = 2;
        else if (vTok === 'v1' || vTok === 'low') velocityLayer = 1;
      }
      return {
        sampleName: filename,
        rootKey: r,
        lowKey: l,
        velocityLayer,
        isHighVelocity: velocityLayer === 2,
      };
    }
  }

  // 2. Fallback to note name or single MIDI number
  const rootKey = parseRootKeyFromFilename(filename, fallbackRoot);
  return {
    sampleName: filename,
    rootKey,
    lowKey: rootKey,
    velocityLayer,
    isHighVelocity: velocityLayer === 2,
  };
}

/**
 * Extracts a MIDI root key (0..127) from a sample filename if present.
 * Supports patterns like `Piano_60_36.wav`, `Bass_C2.wav`, `Cellos_F#3.wav`, `12 String Gtr-A2.aif`.
 */
export function parseRootKeyFromFilename(filename: string, fallback: MidiNote = 60): MidiNote {
  const base = filename.split(/[\\/]/).pop() ?? filename;

  // 1. Check Hartmann `name_rootkey_lowkey` numeric tokens first
  const hartmannMatch = /^[^_]+_(\d{1,3})_(\d{1,3})(?:_|$|\.)/.exec(base);
  if (hartmannMatch) {
    const rk = parseInt(hartmannMatch[1], 10);
    if (rk >= 0 && rk <= 127) return rk;
  }

  // 2. Check note name pattern like C3, F#4, Bb2, G-2
  const noteMatch = base.match(/(?:^|[_\-\s])([A-Ga-g])([#b]?)(-?\d)(?:[_\-.\s]|$)/);
  if (noteMatch) {
    const letter = noteMatch[1].toUpperCase();
    const accidental = noteMatch[2];
    const octave = parseInt(noteMatch[3], 10);
    const semitoneMap: Record<string, number> = {
      C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
    };
    let semitone = semitoneMap[letter] ?? 0;
    if (accidental === '#') semitone += 1;
    if (accidental === 'b') semitone -= 1;
    const midi = (octave + 1) * 12 + semitone;
    if (midi >= 0 && midi <= 127) return midi;
  }

  // 3. Check numeric MIDI token like _60_ or _60.wav
  const numMatch = base.match(/(?:^|[_\-\s])(\d{1,3})(?:[_\-.\s]|$)/);
  if (numMatch) {
    const val = parseInt(numMatch[1], 10);
    if (val >= 0 && val <= 127) return val;
  }

  return fallback;
}

export const DEFAULT_MODEL_NAMES = new Set([
  '',
  'NewModel',
  'Init Model',
  'InitModel',
  'UNTITLED',
  'Default Session',
  'MyModel',
]);

/**
 * Derives a clean model name from an audio sample filename by stripping path, extension,
 * velocity tags (`_v1`, `_v2`, `_low`, `_high`), Hartmann numeric tokens (`_072_068`),
 * and note names (`_C4`, `-E2`).
 */
export function deriveModelNameFromSample(filename: string, maxLen = 11): string {
  const base = (filename.split(/[\\/]/).pop() ?? filename).replace(/\.[^.]+$/, '');
  const cleaned = base
    .replace(/(?:[_\-\s](?:v1|v2|low|lo|high|hi|vel1|vel2|pp|ff))$/i, '')
    .replace(/_\d{1,3}_\d{1,3}$/, '')
    .replace(/(?:[_\-\s][A-Ga-g][#b]?-?\d)$/, '')
    .replace(/(?:[_\-\s]\d{1,3})$/, '')
    .replace(/[\r\n\t]+/g, '')
    .trim();
  const asciiOnly = cleaned.replace(/[^\x20-\x7E]/g, '');
  const candidate = (asciiOnly || base.replace(/[^\x20-\x7E]/g, '') || 'Model').trim();
  return candidate.slice(0, maxLen);
}
