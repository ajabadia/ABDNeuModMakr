// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Phase 37.3: Drum Machine Hit-Name Map Parser
//
// Parses and exports drum-machine hit maps in 3 user-friendly formats:
//   1. Plain Text / CSV (`.txt`, `.csv`)
//   2. Structured JSON (`.json`)
//   3. Human YAML (`.yaml`, `.yml`)
// Also provides factory presets (GM Standard, Roland TR-808/909, Akai MPC,
// Elektron Digitakt/Syntakt), deterministic Regex manual-text extractor
// (with optional Cloud BYOK LLM enhancement), and downloadable templates +
// technical specification for the user.
// ─────────────────────────────────────────────────────────

import { midiNoteToStandardName } from '@abdsynths/shared/dsp/take';

export interface DrumMapHitEntry {
  midiNote: number; // 0..127
  name: string;
  muteGroup?: number; // 1..32 (choke group, e.g. closed/open hi-hat)
  gateMs?: number;
  maxReleaseMs?: number;
  velocities?: number[];
}

export interface ParsedDrumHitMap {
  name: string;
  kitName: string;
  channel: number;
  defaultVelocities?: number[];
  hits: DrumMapHitEntry[];
  warnings: string[];
}

const NOTE_TOKEN_REGEX = /^([A-Ga-g][#bB]?-?\d+|\d{1,3})$/;

const PITCH_CLASS_OFFSETS: Record<string, number> = {
  C: 0,
  'C#': 1,
  DB: 1,
  D: 2,
  'D#': 3,
  EB: 3,
  E: 4,
  F: 5,
  'F#': 6,
  GB: 6,
  G: 7,
  'G#': 8,
  AB: 8,
  A: 9,
  'A#': 10,
  BB: 10,
  B: 11,
};

function parseNoteNameToMidi(str: string): number | null {
  const m = str.trim().match(/^([A-Ga-g][#bB]?)(-?\d+)$/);
  if (!m) return null;
  const pc = PITCH_CLASS_OFFSETS[m[1].toUpperCase()];
  if (pc === undefined) return null;
  const oct = parseInt(m[2], 10);
  const midi = (oct + 1) * 12 + pc;
  return midi >= 0 && midi <= 127 ? midi : null;
}

/** Resolves either a numeric string ("36") or a note name ("C1", "F#2") to 0..127. */
export function resolveMidiNoteToken(token: string | number): number | null {
  if (typeof token === 'number' && Number.isFinite(token)) {
    const n = Math.round(token);
    return n >= 0 && n <= 127 ? n : null;
  }
  const clean = String(token ?? '').trim();
  if (!clean) return null;
  if (/^\d{1,3}$/.test(clean)) {
    const n = parseInt(clean, 10);
    return n >= 0 && n <= 127 ? n : null;
  }
  return parseNoteNameToMidi(clean);
}

/**
 * Parses a `.txt`, `.json`, or `.yaml`/`.yml` drum hit-name map file.
 */
export function parseDrumHitMapFile(content: string, filename = 'drummap.txt'): ParsedDrumHitMap {
  const trimmed = (content ?? '').trim();
  const lowerName = filename.toLowerCase();
  if (!trimmed) {
    return {
      name: 'Empty Drum Map',
      kitName: 'Empty Drum Map',
      channel: 10,
      hits: [],
      warnings: ['El archivo está vacío.'],
    };
  }

  // 1. JSON detection (by extension or leading '{' / '[')
  if (lowerName.endsWith('.json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return parseDrumMapJson(trimmed, filename);
    } catch (err) {
      return {
        name: filename,
        kitName: filename,
        channel: 10,
        hits: [],
        warnings: [`Error de sintaxis JSON: ${err instanceof Error ? err.message : String(err)}`],
      };
    }
  }

  // 2. YAML detection (by extension or YAML-like `notes:` / `hits:` header)
  if (
    lowerName.endsWith('.yaml') ||
    lowerName.endsWith('.yml') ||
    /^(name|kitName|channel|notes|hits)\s*:/im.test(trimmed)
  ) {
    const yamlRes = parseDrumMapYaml(trimmed, filename);
    if (yamlRes.hits.length > 0) return yamlRes;
  }

  // 3. Plain text / CSV / TSV line-by-line format
  return parseDrumMapTxt(trimmed, filename);
}

function parseDrumMapJson(jsonText: string, filename: string): ParsedDrumHitMap {
  const raw = JSON.parse(jsonText);
  const warnings: string[] = [];
  const hits: DrumMapHitEntry[] = [];

  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.hits) ? raw.hits : [];
  if (list.length > 0) {
    for (const item of list) {
      const note = resolveMidiNoteToken(item?.note ?? item?.midiNote ?? item?.key);
      const name = String(item?.name ?? item?.label ?? '').trim();
      if (note === null || !name) {
        warnings.push(`Entrada JSON ignorada por nota o nombre inválido: ${JSON.stringify(item)}`);
        continue;
      }
      hits.push({
        midiNote: note,
        name,
        ...(Number.isFinite(item?.muteGroup ?? item?.choke)
          ? { muteGroup: Math.max(1, Math.min(32, Math.round(item.muteGroup ?? item.choke))) }
          : {}),
        ...(Number.isFinite(item?.gateMs) ? { gateMs: Math.max(20, Math.round(item.gateMs)) } : {}),
        ...(Number.isFinite(item?.maxReleaseMs)
          ? { maxReleaseMs: Math.max(50, Math.round(item.maxReleaseMs)) }
          : {}),
        ...(Array.isArray(item?.velocities)
          ? {
              velocities: item.velocities
                .map((v: unknown) => Math.max(1, Math.min(127, Math.round(Number(v)))))
                .filter((v: number) => Number.isFinite(v)),
            }
          : {}),
      });
    }
  } else if (raw && typeof raw === 'object') {
    const dict = raw.notes && typeof raw.notes === 'object' ? raw.notes : raw;
    for (const [k, v] of Object.entries(dict)) {
      if (k === 'name' || k === 'kitName' || k === 'channel' || k === 'defaultVelocities') continue;
      const note = resolveMidiNoteToken(k);
      if (note === null) continue;
      if (typeof v === 'string' && v.trim()) {
        hits.push({ midiNote: note, name: v.trim() });
      } else if (v && typeof v === 'object') {
        const obj = v as Record<string, unknown>;
        const name = String(obj.name ?? obj.label ?? '').trim();
        if (name) {
          hits.push({
            midiNote: note,
            name,
            ...(Number.isFinite(Number(obj.muteGroup ?? obj.choke))
              ? { muteGroup: Math.max(1, Math.min(32, Math.round(Number(obj.muteGroup ?? obj.choke)))) }
              : {}),
          });
        }
      }
    }
  }

  const resolvedName = String(raw?.kitName || raw?.name || filename.replace(/\.[^.]+$/, ''));
  return {
    name: resolvedName,
    kitName: resolvedName,
    channel: Math.max(1, Math.min(16, Math.round(Number(raw?.channel) || 10))),
    ...(Array.isArray(raw?.defaultVelocities)
      ? {
          defaultVelocities: raw.defaultVelocities
            .map((v: unknown) => Math.max(1, Math.min(127, Math.round(Number(v)))))
            .filter((v: number) => Number.isFinite(v)),
        }
      : {}),
    hits: deduplicateAndSortHits(hits),
    warnings,
  };
}

function parseDrumMapYaml(yamlText: string, filename: string): ParsedDrumHitMap {
  const lines = yamlText.split(/\r?\n/);
  let mapName = filename.replace(/\.[^.]+$/, '');
  let channel = 10;
  const hits: DrumMapHitEntry[] = [];
  const warnings: string[] = [];

  let currentHit: DrumMapHitEntry | null = null;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].replace(/#.*$/, '').trimEnd();
    if (!rawLine.trim()) continue;
    const trimmed = rawLine.trim();

    const nameMatch = trimmed.match(/^(?:name|kitName)\s*:\s*(.+)$/i);
    if (nameMatch && !rawLine.startsWith('  ') && currentHit === null) {
      mapName = unquote(nameMatch[1]);
      continue;
    }
    const chMatch = trimmed.match(/^channel\s*:\s*(\d+)$/i);
    if (chMatch) {
      channel = Math.max(1, Math.min(16, parseInt(chMatch[1], 10)));
      continue;
    }
    if (/^(notes|hits)\s*:\s*$/i.test(trimmed)) {
      continue;
    }

    // Sub-property of an indented YAML note object (`name: Closed Hat`, `muteGroup: 1`)
    if (currentHit && /^\s{2,}/.test(rawLine) && !trimmed.startsWith('-')) {
      const kv = trimmed.match(/^([a-zA-Z_]+)\s*:\s*(.+)$/);
      if (kv) {
        const key = kv[1].toLowerCase();
        const val = unquote(kv[2]);
        if (key === 'name' || key === 'label') currentHit.name = val;
        else if (key === 'mutegroup' || key === 'choke') {
          const mg = parseInt(val, 10);
          if (Number.isFinite(mg)) currentHit.muteGroup = Math.max(1, Math.min(32, mg));
        } else if (key === 'gatems') {
          const g = parseInt(val, 10);
          if (Number.isFinite(g)) currentHit.gateMs = Math.max(20, g);
        } else if (key === 'maxreleasems') {
          const r = parseInt(val, 10);
          if (Number.isFinite(r)) currentHit.maxReleaseMs = Math.max(50, r);
        }
        continue;
      }
    }

    // List item `- note: 36` or dictionary entry `36: Kick` or `36:`
    const listNoteMatch = trimmed.match(/^-\s*(?:note|midiNote)\s*:\s*(.+)$/i);
    if (listNoteMatch) {
      const note = resolveMidiNoteToken(unquote(listNoteMatch[1]));
      if (note !== null) {
        currentHit = { midiNote: note, name: `Hit ${note}` };
        hits.push(currentHit);
        continue;
      }
    }

    const dictMatch = trimmed.match(/^-?\s*["']?([A-Ga-g][#bB]?-?\d+|\d{1,3})["']?\s*:\s*(.*)$/);
    if (dictMatch) {
      const note = resolveMidiNoteToken(dictMatch[1]);
      const rest = unquote(dictMatch[2]);
      if (note !== null) {
        const entry: DrumMapHitEntry = { midiNote: note, name: rest || `Hit ${note}` };
        hits.push(entry);
        currentHit = rest ? null : entry;
        continue;
      }
    }
  }

  return {
    name: mapName,
    kitName: mapName,
    channel,
    hits: deduplicateAndSortHits(hits),
    warnings,
  };
}

function parseDrumMapTxt(txt: string, filename: string): ParsedDrumHitMap {
  const lines = txt.split(/\r?\n/);
  const hits: DrumMapHitEntry[] = [];
  const warnings: string[] = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const clean = lines[idx].replace(/#.*$/, '').trim();
    if (!clean) continue;

    // Split by ':', '=', ',', or tab
    const parts = clean
      .split(/\s*[:=,\t]\s*/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length < 2) {
      // Also allow whitespace separation if first token is a valid note ("36 Kick Sub")
      const wsMatch = clean.match(/^([A-Ga-g][#bB]?-?\d+|\d{1,3})\s+(.+)$/);
      if (wsMatch) {
        const note = resolveMidiNoteToken(wsMatch[1]);
        if (note !== null) {
          hits.push({ midiNote: note, name: wsMatch[2].trim() });
          continue;
        }
      }
      warnings.push(`Línea ${idx + 1} ignorada: "${clean}"`);
      continue;
    }

    const note = resolveMidiNoteToken(parts[0]);
    const name = parts[1];
    if (note === null || !name) {
      warnings.push(`Línea ${idx + 1}: nota inválida "${parts[0]}"`);
      continue;
    }

    const hit: DrumMapHitEntry = { midiNote: note, name };
    for (let p = 2; p < parts.length; p++) {
      const opt = parts[p];
      if (/^\d+$/.test(opt)) {
        hit.muteGroup = Math.max(1, Math.min(32, parseInt(opt, 10)));
        continue;
      }
      const chokeMatch = opt.match(/^(?:choke|mute|mutegroup)\s*=?\s*(\d+)$/i);
      if (chokeMatch) {
        hit.muteGroup = Math.max(1, Math.min(32, parseInt(chokeMatch[1], 10)));
      }
      const gateMatch = opt.match(/^gate\s*=?\s*(\d+)$/i);
      if (gateMatch) {
        hit.gateMs = Math.max(20, parseInt(gateMatch[1], 10));
      }
      const relMatch = opt.match(/^release\s*=?\s*(\d+)$/i);
      if (relMatch) {
        hit.maxReleaseMs = Math.max(50, parseInt(relMatch[1], 10));
      }
    }
    hits.push(hit);
  }

  const resolvedName = filename.replace(/\.[^.]+$/, '');
  return {
    name: resolvedName,
    kitName: resolvedName,
    channel: 10,
    hits: deduplicateAndSortHits(hits),
    warnings,
  };
}

/**
 * Deterministic Regex extractor that mines raw copy-pasted text from a PDF
 * manual (e.g. "36 Bass Drum 1 | 38 Acoustic Snare | 42 Closed Hi-Hat")
 * and automatically pairs Closed/Open Hi-Hat into `muteGroup = 1`.
 */
export function extractDrumMapFromManualTextDeterministic(
  rawManualText: string,
  customKitName = 'Manual Extracted Drum Map'
): ParsedDrumHitMap {
  const hits: DrumMapHitEntry[] = [];
  const lines = (rawManualText ?? '').split(/\r?\n|;|\|/);

  for (const seg of lines) {
    const clean = seg.trim();
    if (!clean) continue;
    // Match patterns like "Note 36 (C1) - Bass Drum" or "36: Kick" or "C#1 Rimshot"
    const m = clean.match(
      /(?:note\s*)?(\d{2,3}|[A-G][#b]?-?\d)\s*(?:\([A-G][#b]?-?\d\)|\(\d{2,3}\))?\s*[-:=–—\s]+\s*([A-Za-z0-9][A-Za-z0-9\s/_()-]{1,36})/i
    );
    if (!m) continue;
    const note = resolveMidiNoteToken(m[1]);
    const name = m[2].trim();
    if (note === null || !name || NOTE_TOKEN_REGEX.test(name)) continue;

    const isHiHat = /\b(hi[-\s]?hat|closed\s*hat|open\s*hat|pedal\s*hat|\bch\b|\boh\b)\b/i.test(name);
    hits.push({
      midiNote: note,
      name,
      ...(isHiHat ? { muteGroup: 1 } : {}),
    });
  }

  return {
    name: customKitName,
    kitName: customKitName,
    channel: 10,
    hits: deduplicateAndSortHits(hits),
    warnings:
      hits.length === 0
        ? ['No se detectaron pares (Nota MIDI + Nombre) en el texto pegado.']
        : [],
  };
}

function deduplicateAndSortHits(hits: DrumMapHitEntry[]): DrumMapHitEntry[] {
  const map = new Map<number, DrumMapHitEntry>();
  for (const h of hits) {
    map.set(h.midiNote, h);
  }
  return Array.from(map.values()).sort((a, b) => a.midiNote - b.midiNote);
}

function unquote(s: string): string {
  return s.trim().replace(/^["']|["']$/g, '').trim();
}

// ── Factory Presets & User-Facing Templates / Documentation ─────────────────

export const FACTORY_DRUM_MAP_PRESETS: Record<string, ParsedDrumHitMap> = {
  tr808_909: {
    name: 'Roland TR-808 / TR-909 Standard (16 Hits)',
    kitName: 'Roland TR-808 / TR-909 Standard (16 Hits)',
    channel: 10,
    hits: [
      { midiNote: 36, name: 'Bass Drum (Kick)', gateMs: 300, maxReleaseMs: 1800 },
      { midiNote: 37, name: 'Rimshot', gateMs: 150, maxReleaseMs: 600 },
      { midiNote: 38, name: 'Snare Drum', gateMs: 250, maxReleaseMs: 1200 },
      { midiNote: 39, name: 'Hand Clap', gateMs: 250, maxReleaseMs: 1200 },
      { midiNote: 41, name: 'Low Tom', gateMs: 300, maxReleaseMs: 1500 },
      { midiNote: 42, name: 'Closed Hi-Hat', muteGroup: 1, gateMs: 180, maxReleaseMs: 700 },
      { midiNote: 43, name: 'Low-Mid Tom', gateMs: 300, maxReleaseMs: 1500 },
      { midiNote: 44, name: 'Pedal Hi-Hat', muteGroup: 1, gateMs: 180, maxReleaseMs: 700 },
      { midiNote: 45, name: 'Mid Tom', gateMs: 300, maxReleaseMs: 1500 },
      { midiNote: 46, name: 'Open Hi-Hat', muteGroup: 1, gateMs: 400, maxReleaseMs: 2200 },
      { midiNote: 47, name: 'Hi-Mid Tom', gateMs: 300, maxReleaseMs: 1400 },
      { midiNote: 49, name: 'Crash Cymbal', gateMs: 500, maxReleaseMs: 3500 },
      { midiNote: 50, name: 'High Tom', gateMs: 280, maxReleaseMs: 1300 },
      { midiNote: 51, name: 'Ride Cymbal', gateMs: 500, maxReleaseMs: 3200 },
      { midiNote: 56, name: 'Cowbell', gateMs: 250, maxReleaseMs: 1100 },
      { midiNote: 75, name: 'Clave', gateMs: 150, maxReleaseMs: 600 },
    ],
    warnings: [],
  },
  mpc_bank_a: {
    name: 'Akai MPC Bank A (16 Pads: 36..51)',
    kitName: 'Akai MPC Bank A (16 Pads: 36..51)',
    channel: 10,
    hits: Array.from({ length: 16 }, (_, i) => ({
      midiNote: 36 + i,
      name: `Pad A${String(i + 1).padStart(2, '0')} (${midiNoteToStandardName(36 + i)})`,
    })),
    warnings: [],
  },
  elektron_8track: {
    name: 'Elektron Digitakt / Syntakt (Tracks 1..8: MIDI 0..7)',
    kitName: 'Elektron Digitakt / Syntakt (Tracks 1..8: MIDI 0..7)',
    channel: 1,
    hits: [
      { midiNote: 0, name: 'Track 1 Kick' },
      { midiNote: 1, name: 'Track 2 Snare' },
      { midiNote: 2, name: 'Track 3 Tom / Rim' },
      { midiNote: 3, name: 'Track 4 Clap' },
      { midiNote: 4, name: 'Track 5 Cowbell / Perc' },
      { midiNote: 5, name: 'Track 6 Closed Hat', muteGroup: 1 },
      { midiNote: 6, name: 'Track 7 Open Hat', muteGroup: 1 },
      { midiNote: 7, name: 'Track 8 Cymbal / FX' },
    ],
    warnings: [],
  },
};

export function getDrumMapFormatSpecificationHelpText(): string {
  return [
    '# 1) FORMATO .TXT / .CSV (Línea por golpe)',
    '36, Kick Sub 808',
    '38, Snare Crisp',
    '42, Closed Hi-Hat, 1',
    '46, Open Hi-Hat, 1',
    '',
    '# 2) FORMATO .JSON',
    JSON.stringify(
      {
        kitName: 'Custom Drum Kit',
        defaultVelocities: [90, 127],
        hits: [
          { note: 36, name: 'Kick Sub' },
          { note: 38, name: 'Snare Analog' },
          { note: 42, name: 'Closed Hi-Hat', muteGroup: 1 },
          { note: 46, name: 'Open Hi-Hat', muteGroup: 1 },
        ],
      },
      null,
      2
    ),
    '',
    '# 3) FORMATO .YAML',
    'kitName: Custom Drum Kit',
    'hits:',
    '  - note: 36',
    '    name: Kick Sub',
    '  - note: 42',
    '    name: Closed Hi-Hat',
    '    muteGroup: 1',
  ].join('\n');
}
