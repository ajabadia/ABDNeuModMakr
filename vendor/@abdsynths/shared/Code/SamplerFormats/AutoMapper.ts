// ─────────────────────────────────────────────────────────────────────────────
// @abdsynths/shared — Filename Regex Pattern Matcher & Auto-Mapper
//
// Industry-standard automated sample mapper for multizone instruments.
// Recognizes notes, velocity ranges, round-robin indices, and dynamic tags
// from sample filenames (e.g. Kontakt, Spitfire, VSL, Steinberg HALion conventions).
//
// Supported Patterns:
//   - `<inst>_<note>_<vel>_<rr>` (e.g. "Violin_C3_mf_rr1.wav", "Piano_60_100.wav")
//   - Key bounds: "Violin_C2-C3_v1.wav", "Flute_60-72_rr2.wav"
//   - Explicit velocity numbers: "Bass_C1_v127.wav", "Kick_vel64_rr3.wav"
//   - Standard dynamic tokens: pp (1..32), p (33..64), mf (65..95), f (96..115), ff (116..127)
//   - Round-robin tags: "rr1", "rr_02", "Take3", "alt1", "cycle2"
//   - Release trigger tags: "rel", "release", "keyoff", "off"
// ─────────────────────────────────────────────────────────────────────────────

import type { MidiNote, TriggerMode } from './SamplerTypes.ts';

const NOTE_NAMES: Record<string, number> = {
  c: 0,
  'c#': 1,
  db: 1,
  d: 2,
  'd#': 3,
  eb: 3,
  e: 4,
  f: 5,
  'f#': 6,
  gb: 6,
  g: 7,
  'g#': 8,
  ab: 8,
  a: 9,
  'a#': 10,
  bb: 10,
  b: 11,
};

/**
 * Extracts a MIDI root key (0..127) from note strings like "C3", "F#2", "Eb4", or numbers like "60".
 */
export function parseRootKeyFromFilename(token: string, fallback = 60): MidiNote {
  const clean = token.trim();
  // Check pure number
  const num = parseInt(clean, 10);
  if (!Number.isNaN(num) && num >= 0 && num <= 127 && String(num) === clean) {
    return num;
  }

  // Check scientific pitch notation e.g. "C#3", "Eb-1", "A4"
  const m = clean.match(/([a-gA-G][#b]?)(-?\d+)/);
  if (m) {
    const name = m[1].toLowerCase();
    const oct = parseInt(m[2], 10);
    const semitone = NOTE_NAMES[name];
    if (semitone !== undefined) {
      // Standard MIDI octave: C-1 = 0, C4 = 60 (octave + 1 * 12)
      const note = (oct + 1) * 12 + semitone;
      if (note >= 0 && note <= 127) {
        return note;
      }
    }
  }

  return fallback;
}

export interface AutoMappedSampleInfo {
  filename: string;
  instrumentName: string;
  rootKey: MidiNote;
  lowKey: MidiNote;
  highKey: MidiNote;
  lowVelocity: number;
  highVelocity: number;
  roundRobinIndex: number; // 1-based (1..N)
  roundRobinTotal: number;
  trigger: TriggerMode;
}

export interface AutoMappingConfig {
  defaultLowKey?: MidiNote;
  defaultHighKey?: MidiNote;
  defaultLowVel?: number;
  defaultHighVel?: number;
  userRegex?: string; // Optional custom user regex with named capture groups
}

const DYNAMIC_VELOCITIES: Record<string, [number, number]> = {
  ppp: [1, 20],
  pp: [21, 45],
  p: [46, 64],
  mp: [65, 80],
  mf: [81, 100],
  f: [101, 115],
  ff: [116, 125],
  fff: [126, 127],
};

/**
 * Automatically parses a single sample filename into structured sample mapping bounds.
 */
export function autoMapSampleFilename(
  filename: string,
  config?: AutoMappingConfig
): AutoMappedSampleInfo {
  const base = filename.replace(/\\/g, '/').split('/').pop() || filename;
  const cleanBase = base.replace(/\.[^.]+$/, '');

  // 1. If user provided a custom regex with named groups (?<note>), (?<vel>), (?<rr>)
  if (config?.userRegex) {
    try {
      const rx = new RegExp(config.userRegex, 'i');
      const m = rx.exec(cleanBase);
      if (m && m.groups) {
        const root = m.groups.note ? parseRootKeyFromFilename(m.groups.note, 60) : 60;
        const lowK = m.groups.lowKey ? parseRootKeyFromFilename(m.groups.lowKey, root) : root;
        const highK = m.groups.highKey ? parseRootKeyFromFilename(m.groups.highKey, root) : root;
        const lowV = m.groups.lowVel ? parseInt(m.groups.lowVel, 10) : (config?.defaultLowVel ?? 1);
        const highV = m.groups.highVel ? parseInt(m.groups.highVel, 10) : (config?.defaultHighVel ?? 127);
        const rr = m.groups.rr ? parseInt(m.groups.rr, 10) : 1;
        const isRel = !!(m.groups.rel || /release|keyoff|rel/i.test(cleanBase));

        return {
          filename,
          instrumentName: m.groups.inst || 'Instrument',
          rootKey: root,
          lowKey: lowK,
          highKey: highK,
          lowVelocity: lowV,
          highVelocity: highV,
          roundRobinIndex: Math.max(1, rr),
          roundRobinTotal: 1,
          trigger: isRel ? 'release' : 'attack',
        };
      }
    } catch {
      // Fallback to automatic heuristic parser
    }
  }

  // 2. Standard heuristic auto-mapping
  let trigger: TriggerMode = 'attack';
  if (/(?:[_\-\s](?:rel|release|keyoff|off))(?=[_\-\s]|$)/i.test(cleanBase)) {
    trigger = 'release';
  }

  // Round-Robin extraction (e.g. _rr1, _rr02, -rr3, _take2, _alt1, _cycle4)
  let rrIndex = 1;
  const rrMatch = cleanBase.match(/(?:[_\-\s](?:rr|take|alt|cycle|roundrobin|round)[_\-\s]?(\d+))(?=[_\-\s]|$)/i);
  if (rrMatch) {
    rrIndex = parseInt(rrMatch[1], 10) || 1;
  }

  // Velocity ranges extraction
  let lowVel = config?.defaultLowVel ?? 1;
  let highVel = config?.defaultHighVel ?? 127;

  // Check explicit velocity range (e.g. 1-64, vel01-vel64, v1-v64)
  const velRangeMatch = cleanBase.match(/(?:vel|v)?(\d{1,3})[-_](\d{1,3})/i);
  let handledVel = false;

  // Check dynamic tokens: pp, p, mp, mf, f, ff
  for (const [dyn, [minV, maxV]] of Object.entries(DYNAMIC_VELOCITIES)) {
    const dynRegex = new RegExp(`(?:[_\-\\s])${dyn}(?=[_\-\\s]|$)`, 'i');
    if (dynRegex.test(cleanBase)) {
      lowVel = minV;
      highVel = maxV;
      handledVel = true;
      break;
    }
  }

  if (!handledVel) {
    const singleVelMatch = cleanBase.match(/(?:[_\-\s](?:v|vel|layer)[_\-\s]?(\d{1,3}))(?=[_\-\s]|$)/i);
    if (singleVelMatch) {
      const vNum = parseInt(singleVelMatch[1], 10);
      if (vNum <= 4) {
        // Velocity layer 1..4
        if (vNum === 1) { lowVel = 1; highVel = 32; }
        else if (vNum === 2) { lowVel = 33; highVel = 64; }
        else if (vNum === 3) { lowVel = 65; highVel = 96; }
        else if (vNum === 4) { lowVel = 97; highVel = 127; }
      } else {
        lowVel = Math.max(1, vNum - 15);
        highVel = Math.min(127, vNum + 15);
      }
    }
  }

  // Key range or Root note extraction
  let rootKey = parseRootKeyFromFilename(cleanBase, 60);
  let lowKey = rootKey;
  let highKey = rootKey;

  // Check key range format (e.g. C2-C3, 36-48)
  const keyRangeMatch = cleanBase.match(/([a-gA-G][#b]?-?\d|\d{2,3})[-_]([a-gA-G][#b]?-?\d|\d{2,3})/);
  if (keyRangeMatch) {
    const k1 = parseRootKeyFromFilename(keyRangeMatch[1], rootKey);
    const k2 = parseRootKeyFromFilename(keyRangeMatch[2], rootKey);
    lowKey = Math.min(k1, k2);
    highKey = Math.max(k1, k2);
    rootKey = Math.round((lowKey + highKey) / 2);
  }

  // Extract instrument title (first segment before separators)
  const tokens = cleanBase.split(/[_\-\s]+/);
  const instrumentName = tokens[0] || 'Instrument';

  return {
    filename,
    instrumentName,
    rootKey,
    lowKey,
    highKey,
    lowVelocity: lowVel,
    highVelocity: highVel,
    roundRobinIndex: Math.max(1, rrIndex),
    roundRobinTotal: 1,
    trigger,
  };
}

/**
 * Auto-maps a list of filenames into an aligned multizone collection with
 * automatic neighbor key interpolation and round-robin count detection.
 */
export function autoMapSampleCollection(
  filenames: string[],
  config?: AutoMappingConfig
): AutoMappedSampleInfo[] {
  const mapped = filenames.map((f) => autoMapSampleFilename(f, config));

  // Determine total round-robin count per (rootKey, lowVel) group
  const rrGroups = new Map<string, number>();
  for (const m of mapped) {
    const key = `${m.rootKey}_${m.lowVelocity}_${m.trigger}`;
    const curMax = rrGroups.get(key) || 1;
    if (m.roundRobinIndex > curMax) {
      rrGroups.set(key, m.roundRobinIndex);
    }
  }

  for (const m of mapped) {
    const key = `${m.rootKey}_${m.lowVelocity}_${m.trigger}`;
    m.roundRobinTotal = rrGroups.get(key) || 1;
  }

  // Auto-extend contiguous key coverage if notes are isolated points
  const distinctRoots = Array.from(new Set(mapped.map((m) => m.rootKey))).sort((a, b) => a - b);
  if (distinctRoots.length > 1) {
    for (const m of mapped) {
      // If lowKey == highKey == rootKey, spread to midpoints
      if (m.lowKey === m.rootKey && m.highKey === m.rootKey) {
        const idx = distinctRoots.indexOf(m.rootKey);
        const prevRoot = idx > 0 ? distinctRoots[idx - 1] : 0;
        const nextRoot = idx < distinctRoots.length - 1 ? distinctRoots[idx + 1] : 127;

        m.lowKey = idx === 0 ? 0 : Math.round((prevRoot + m.rootKey) / 2) + 1;
        m.highKey = idx === distinctRoots.length - 1 ? 127 : Math.round((m.rootKey + nextRoot) / 2);
      }
    }
  }

  return mapped;
}
