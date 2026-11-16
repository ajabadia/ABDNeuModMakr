// ─────────────────────────────────────────────────────────
// ABDNeuModMakr - SFZ (.sfz) Native Importer
//
// Parses SFZ v1/v2 text definitions (<control>, <global>, <master>,
// <group>, <region>, <curve>, <effect>, <midi>, <sample>) +
// accompanying audio files (WAV/AIFF) and converts them directly
// into our native Extended + Classic session model.
// ─────────────────────────────────────────────────────────

import type {
  AiffInstrumentInfo,
  AudioFilePayload,
  CustomMetadataTag,
  DahdsrEnvelope,
  ExtendedModelMetadata,
  ExtendedRegion,
  FilterSlopePoles,
  LoopMode,
  OffMode,
  RegionFilterConfig,
  SampleLoopDescriptor,
  SamplerPlayLogic,
  SfzCcMacroInfo,
  SfzCurveDescriptor,
  SfzIntrospectionReport,
  SfzKeyswitchInfo,
  TriggerMode,
} from './SamplerTypes.ts';
import { interpolateSfzCurvePoints } from './ArticulationEngine.ts';
import { extractAudioHeaderInstrumentInfo } from '../NeuronFormats/index.ts';
import {
  createDefaultArticulation,
  projectExtendedRegionsToClassicZones,
} from './ExtendedAdapter.ts';
import { basename, clamp } from './SamplerUtils.ts';
import {
  classifyInstrumentAndParameterSet,
  type NativeSamplerImportResult,
} from './Sf2Parser.ts';

const NOTE_NAME_OFFSETS: Record<string, number> = {
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
 * Parses an SFZ note value (either integer 0..127 or IPN string like "c4", "f#3", "bb2"),
 * optionally shifting by `noteOffsetSemis` (octave_offset * 12 + note_offset).
 */
export function parseSfzNote(val: string | undefined, fallback = 60, noteOffsetSemis = 0): number {
  if (!val) return fallback;
  const trimmed = val.trim().toLowerCase();
  if (/^-?\d+$/.test(trimmed)) {
    return Math.max(0, Math.min(127, parseInt(trimmed, 10) + noteOffsetSemis));
  }
  const m = /^([a-g][#b]?)(-?\d+)$/.exec(trimmed);
  if (!m) return fallback;
  const semi = NOTE_NAME_OFFSETS[m[1]];
  if (semi === undefined) return fallback;
  const octave = parseInt(m[2], 10);
  // Standard MIDI: C4 = 60 -> (octave + 1) * 12 + semi
  return Math.max(0, Math.min(127, (octave + 1) * 12 + semi + noteOffsetSemis));
}

function stripSfzComments(text: string): string {
  // Remove block comments /* ... */ and line comments // ...
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map((line) => {
      const idx = line.indexOf('//');
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join('\n');
}

const MAX_SFZ_DEFINES = 256;
const MAX_SFZ_DEFINE_VALUE_LEN = 256;
const DEFAULT_MAX_INCLUDE_DEPTH = 8;
const MAX_SFZ_INLINE_SAMPLE_BYTES = 16 * 1024 * 1024;
const MAX_UNKNOWN_OPCODE_AUDIT = 64;

export interface SfzImportOptions {
  /** Optional safe resolver for `#include "path.sfz"` directives (must return UTF-8 text or undefined). */
  includeResolver?: (includePath: string, fromFile: string) => string | undefined;
  /** Maximum nested `#include` depth (default 8, clamped 1..16). */
  maxIncludeDepth?: number;
}

function resolveSafeIncludePath(rawInclude: string, fromFile: string): string | undefined {
  const cleaned = rawInclude.trim().replace(/^["']|["']$/g, '').replace(/\\/g, '/');
  if (!cleaned || cleaned.startsWith('/')) return undefined;
  const fromNorm = fromFile.replace(/\\/g, '/');
  const fromDir = fromNorm.includes('/') ? fromNorm.slice(0, fromNorm.lastIndexOf('/')) : '';
  const combined = fromDir ? `${fromDir}/${cleaned}` : cleaned;
  const parts: string[] = [];
  for (const seg of combined.split('/')) {
    const t = seg.trim();
    if (!t || t === '.') continue;
    if (t === '..') return undefined; // fail-closed on path traversal
    parts.push(t);
  }
  return parts.length > 0 ? parts.join('/') : undefined;
}

function resolveSfzIncludes(
  rawText: string,
  rootFileName: string,
  options: SfzImportOptions | undefined,
  maxTotalChars: number,
): { text: string; includedFiles: string[]; missingIncludes: string[] } {
  const includedFiles: string[] = [];
  const missingIncludes: string[] = [];
  const maxDepth = Math.max(1, Math.min(16, options?.maxIncludeDepth ?? DEFAULT_MAX_INCLUDE_DEPTH));
  const visited = new Set<string>([rootFileName.replace(/\\/g, '/').toLowerCase()]);
  let totalChars = 0;

  const expandFile = (text: string, currentFile: string, depth: number): string => {
    const stripped = stripSfzComments(text);
    const outLines: string[] = [];
    for (const line of stripped.split(/\r?\n/)) {
      const trimmed = line.trim();
      const incMatch = /^#include\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))/i.exec(trimmed);
      if (!incMatch) {
        totalChars += line.length + 1;
        if (totalChars > maxTotalChars) {
          throw new Error(`SFZ expanded includes exceed max size (${maxTotalChars} chars)`);
        }
        outLines.push(line);
        continue;
      }
      const rawTarget = (incMatch[1] ?? incMatch[2] ?? incMatch[3] ?? '').trim();
      const safeTarget = resolveSafeIncludePath(rawTarget, currentFile);
      if (!safeTarget) {
        if (rawTarget && !missingIncludes.includes(rawTarget)) missingIncludes.push(rawTarget);
        continue;
      }
      const targetKey = safeTarget.toLowerCase();
      if (visited.has(targetKey)) {
        continue; // anti-cycle guard
      }
      if (depth >= maxDepth) {
        if (!missingIncludes.includes(safeTarget)) missingIncludes.push(safeTarget);
        continue;
      }
      const resolvedText =
        options?.includeResolver?.(safeTarget, currentFile) ??
        options?.includeResolver?.(rawTarget, currentFile);
      if (resolvedText === undefined) {
        if (!missingIncludes.includes(safeTarget)) missingIncludes.push(safeTarget);
        continue;
      }
      visited.add(targetKey);
      includedFiles.push(safeTarget);
      outLines.push(expandFile(resolvedText, safeTarget, depth + 1));
    }
    return outLines.join('\n');
  };

  return {
    text: expandFile(rawText, rootFileName, 0),
    includedFiles,
    missingIncludes,
  };
}

const SFZ_OPCODE_EXACT_ALIASES: Record<string, string> = {
  offby: 'off_by',
  offmode: 'off_mode',
  loopmode: 'loop_mode',
  loopstart: 'loop_start',
  loopend: 'loop_end',
};

function normalizeSfzOpcodeKey(rawKey: string): string {
  const lower = rawKey.toLowerCase();
  if (SFZ_OPCODE_EXACT_ALIASES[lower]) return SFZ_OPCODE_EXACT_ALIASES[lower];
  const vel2Match = /^(.+)_vel2([a-z0-9_]+)$/.exec(lower);
  if (vel2Match) {
    return `${vel2Match[1]}_velto${vel2Match[2]}`;
  }
  const ccAliasMatch = /^(?!set_|label_|sw_|set_hd|set_real)(.+)_cc(\d+)$/.exec(lower);
  if (ccAliasMatch) {
    return `${ccAliasMatch[1]}_oncc${ccAliasMatch[2]}`;
  }
  return lower;
}

function decodeSfzInlineBase64Sample(b64Raw: string): ArrayBuffer | undefined {
  const clean = b64Raw.replace(/\s+/g, '');
  if (!clean) return undefined;
  const estBytes = Math.floor((clean.length * 3) / 4);
  if (estBytes <= 0 || estBytes > MAX_SFZ_INLINE_SAMPLE_BYTES) return undefined;
  try {
    if (typeof atob === 'function') {
      const bin = atob(clean);
      if (bin.length === 0 || bin.length > MAX_SFZ_INLINE_SAMPLE_BYTES) return undefined;
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out.buffer;
    }
    const g = globalThis as { Buffer?: { from(s: string, enc: string): Uint8Array } };
    if (g.Buffer) {
      const buf = g.Buffer.from(clean, 'base64');
      if (buf.byteLength === 0 || buf.byteLength > MAX_SFZ_INLINE_SAMPLE_BYTES) return undefined;
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

const KNOWN_SFZ_OPCODES = new Set<string>([
  'default_path', 'octave_offset', 'note_offset', 'image', 'image_controls',
  'sample', 'name', 'base64data', 'key', 'lokey', 'hikey', 'pitch_keycenter', 'pitch_keytrack',
  'lovel', 'hivel', 'lorand', 'hirand', 'transpose', 'tune', 'volume', 'pan', 'width', 'position',
  'trigger', 'seq_position', 'seq_length', 'group', 'off_by', 'off_mode', 'off_time',
  'group_label', 'master_label', 'sw_lokey', 'sw_hikey', 'sw_last', 'sw_label', 'sw_default',
  'xfin_lokey', 'xfin_hikey', 'xfout_lokey', 'xfout_hikey', 'xfin_lovel', 'xfin_hivel',
  'xfout_lovel', 'xfout_hivel', 'xf_keycurve', 'xf_velcurve', 'xf_cccurve',
  'loop_mode', 'loop_start', 'loop_end', 'loop_crossfade', 'offset', 'end', 'direction',
  'amp_veltrack', 'pitch_veltrack', 'rt_decay', 'polyphony', 'bend_up', 'bend_down',
  'ampeg_delay', 'ampeg_start', 'ampeg_attack', 'ampeg_hold', 'ampeg_decay', 'ampeg_sustain', 'ampeg_release',
  'ampeg_veltoattack', 'ampeg_veltodecay', 'ampeg_veltorelease', 'ampeg_veltosustain', 'ampeg_veltodepth',
  'cutoff', 'resonance', 'fil_type', 'fil_veltrack', 'fil_keytrack',
  'fileg_delay', 'fileg_attack', 'fileg_hold', 'fileg_decay', 'fileg_sustain', 'fileg_release', 'fileg_depth',
  'pitcheg_delay', 'pitcheg_attack', 'pitcheg_hold', 'pitcheg_decay', 'pitcheg_sustain', 'pitcheg_release',
  'pitcheg_depth', 'pitcheg_veltodepth',
  'pitchlfo_delay', 'pitchlfo_freq', 'pitchlfo_depth', 'fillfo_depth', 'amplfo_depth',
  'curve_index',
]);

function isRecognizedSfzOpcode(key: string): boolean {
  if (KNOWN_SFZ_OPCODES.has(key)) return true;
  if (/^v\d+$/.test(key)) return true;
  if (/^(?:label_cc|set_cc|set_hdcc|set_realcc|label_key|locc|hicc|xfin_locc|xfin_hicc|xfout_locc|xfout_hicc|sw_locc|sw_hicc)\d+$/.test(key)) return true;
  if (/^(?:lfo\d+|eq\d+|eg\d+)_[a-z0-9_]+$/.test(key)) return true;
  if (/_oncc\d+$/.test(key)) return true;
  return false;
}

function preprocessSfzDefines(text: string, maxTotalChars: number): string {
  const defines = new Map<string, string>();
  const keptLines: string[] = [];

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    const defMatch = /^#define\s+(\$[A-Za-z0-9_]+)\s+([^\r\n]+)$/.exec(trimmed);
    if (defMatch) {
      if (defines.size < MAX_SFZ_DEFINES) {
        const val = defMatch[2].trim().slice(0, MAX_SFZ_DEFINE_VALUE_LEN);
        defines.set(defMatch[1], val);
      }
      continue;
    }
    if (/^#include\b/i.test(trimmed)) {
      continue;
    }
    keptLines.push(line);
  }

  let result = keptLines.join('\n');
  if (defines.size === 0) return result;

  const sortedVars = Array.from(defines.entries()).sort((a, b) => b[0].length - a[0].length);
  for (const [varName, value] of sortedVars) {
    const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${escaped}(?![A-Za-z0-9_])`, 'g');
    result = result.replace(re, () => value);
    if (result.length > maxTotalChars) {
      throw new Error(`SFZ expanded macros exceed max size (${maxTotalChars} chars)`);
    }
  }
  return result;
}

function parseOpcodeEntriesFromBlock(body: string): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  // Match key=value where value can contain spaces (e.g. sample=my sample name.wav) up to the next key= or end
  const regex = /([a-zA-Z0-9_]+)\s*=\s*([^\r\n]*?)(?=\s+[a-zA-Z0-9_]+\s*=|\r|\n|$)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(body)) !== null) {
    entries.push([normalizeSfzOpcodeKey(match[1]), match[2].trim()]);
  }
  return entries;
}

function basenameOfPath(p: string): string {
  return basename(p?.trim() ?? '');
}

function normalizeRelativeSamplePath(rawPath: string): string {
  const norm = rawPath.replace(/\\/g, '/').trim();
  const segments = norm.split('/');
  const clean: string[] = [];
  for (const seg of segments) {
    const t = seg.trim();
    if (!t || t === '.' || t === '..') continue;
    clean.push(t);
  }
  return clean.join('/');
}

function sanitizeFlatSampleName(rawName: string): string {
  return rawName.replace(/[\\/]+/g, '_').replace(/\.\.+/g, '').trim() || 'sample.wav';
}

function parseIntOr(val: string | undefined, fallback: number): number {
  if (val === undefined) return fallback;
  const n = parseInt(val, 10);
  return Number.isNaN(n) ? fallback : n;
}

function parseFloatOr(val: string | undefined, fallback: number): number {
  if (val === undefined) return fallback;
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : fallback;
}

function extractSfzMetadata(rawText: string, sfzFileName: string, category: string): ExtendedModelMetadata {
  const meta: ExtendedModelMetadata = {
    sourceFormat: 'sfz',
    sourcePresetName: basenameOfPath(sfzFileName).replace(/\.sfz$/i, '').trim(),
    tags: ['sfz', category].filter(Boolean),
  };
  const customAttributes: CustomMetadataTag[] = [];

  const lines = rawText.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    const commentMatch = /^\/\/\s*([a-zA-Z0-9_\s-]+)[:=]\s*(.+)$/i.exec(trimmed);
    if (commentMatch) {
      const key = commentMatch[1].trim();
      const val = commentMatch[2].trim();
      const keyLower = key.toLowerCase();
      if (keyLower === 'author' || keyLower === 'sound designer' || keyLower === 'creator') {
        meta.author = val;
      } else if (keyLower === 'copyright' || keyLower === '(c)') {
        meta.copyright = val;
      } else if (keyLower === 'license') {
        meta.license = val;
      } else if (keyLower === 'version') {
        meta.version = val;
      } else if (keyLower === 'year' || keyLower === 'date') {
        meta.releaseYear = val.match(/\d{4}/)?.[0] || val;
      } else if (keyLower === 'vendor' || keyLower === 'library' || keyLower === 'publisher') {
        meta.vendor = val;
      } else if (keyLower === 'url' || keyLower === 'website' || keyLower === 'link') {
        meta.sourceUrl = val;
      } else if (keyLower === 'description' || keyLower === 'comment' || keyLower === 'notes') {
        meta.description = val;
      } else if (keyLower === 'tags' || keyLower === 'category') {
        val.split(/[,;\s]+/).forEach((t) => { if (t) meta.tags?.push(t); });
      } else {
        customAttributes.push({ tag: key, value: val });
      }
    }
  }

  if (customAttributes.length > 0) {
    meta.customAttributes = customAttributes;
  }
  return meta;
}

/**
 * Imports an `.sfz` text definition and accompanying `AudioFilePayload[]`
 * into our native session structures.
 */
export const MAX_SFZ_TEXT_BYTES = 2 * 1024 * 1024;
export const MAX_SFZ_REGIONS = 2048;
const SHARED_MAX_SFZ_OPCODES_PER_BLOCK = 128;
const SHARED_MAX_SFZ_HEADER_BLOCKS = 8192;

function extractSfzAmpEnvFromOps(ops: Record<string, string>): {
  hasAmpEnv: boolean;
  ampEnv: DahdsrEnvelope;
} {
  const hasAmpEnv =
    ops.ampeg_delay !== undefined ||
    ops.ampeg_start !== undefined ||
    ops.ampeg_attack !== undefined ||
    ops.ampeg_hold !== undefined ||
    ops.ampeg_decay !== undefined ||
    ops.ampeg_sustain !== undefined ||
    ops.ampeg_release !== undefined;

  const ampEnv: DahdsrEnvelope = {
    delaySec: Math.max(0, parseFloatOr(ops.ampeg_delay, 0)),
    attackSec: Math.max(0.002, parseFloatOr(ops.ampeg_attack, 0.005)),
    holdSec: Math.max(0, parseFloatOr(ops.ampeg_hold, 0)),
    decaySec: Math.max(0.005, parseFloatOr(ops.ampeg_decay, 0.25)),
    sustainLevel: clamp(parseFloatOr(ops.ampeg_sustain, 100) / 100, 0, 1),
    releaseSec: Math.max(0.01, parseFloatOr(ops.ampeg_release, 0.2)),
    ...(ops.ampeg_start !== undefined
      ? { startLevel: clamp(parseFloatOr(ops.ampeg_start, 0) / 100, 0, 1) }
      : {}),
    ...(ops.amp_veltrack !== undefined
      ? { velModDepth: clamp(parseFloatOr(ops.amp_veltrack, 100), -100, 100) }
      : {}),
  };
  return { hasAmpEnv, ampEnv };
}

function extractSfzFilterFromOps(ops: Record<string, string>): RegionFilterConfig | undefined {
  if (ops.cutoff === undefined && ops.fil_type === undefined && ops.resonance === undefined) {
    return undefined;
  }
  const ft = (ops.fil_type ?? 'lpf_2p').toLowerCase();
  let filterType: 'lpf' | 'hpf' | 'bpf' | 'brf' | 'notch' = 'lpf';
  if (ft.includes('hpf')) filterType = 'hpf';
  else if (ft.includes('bpf')) filterType = 'bpf';
  else if (ft.includes('brf')) filterType = 'brf';
  else if (ft.includes('notch')) filterType = 'notch';

  let poles: FilterSlopePoles = 2;
  if (ft.includes('1p')) poles = 1;
  else if (ft.includes('3p')) poles = 3;
  else if (ft.includes('4p')) poles = 4;
  else if (ft.includes('6p')) poles = 6;

  const hasFilEg =
    ops.fileg_delay !== undefined ||
    ops.fileg_attack !== undefined ||
    ops.fileg_hold !== undefined ||
    ops.fileg_decay !== undefined ||
    ops.fileg_sustain !== undefined ||
    ops.fileg_release !== undefined;

  return {
    enabled: true,
    type: filterType,
    poles,
    cutoffHz: clamp(Math.round(parseFloatOr(ops.cutoff, 18000)), 20, 20000),
    resonanceDb: clamp(parseFloatOr(ops.resonance, 0), 0, 40),
    envToFilterCents: parseFloatOr(ops.fileg_depth, 0),
    velToFilterCents: parseFloatOr(ops.fil_veltrack, 0),
    keytrackCents: parseFloatOr(ops.fil_keytrack, 0),
    filterEnv: hasFilEg
      ? {
          delaySec: Math.max(0, parseFloatOr(ops.fileg_delay, 0)),
          attackSec: Math.max(0.001, parseFloatOr(ops.fileg_attack, 0.005)),
          holdSec: Math.max(0, parseFloatOr(ops.fileg_hold, 0)),
          decaySec: Math.max(0.001, parseFloatOr(ops.fileg_decay, 0.25)),
          sustainLevel: clamp(parseFloatOr(ops.fileg_sustain, 100) / 100, 0, 1),
          releaseSec: Math.max(0.001, parseFloatOr(ops.fileg_release, 0.2)),
        }
      : undefined,
  };
}

export function importSfzToNative(
  sfzText: string,
  sfzFileName: string,
  companionAudioFiles: AudioFilePayload[] = [],
  options?: SfzImportOptions,
): NativeSamplerImportResult {
  if (sfzText.length > MAX_SFZ_TEXT_BYTES) {
    throw new Error(`SFZ text too large (${sfzText.length} chars, max ${MAX_SFZ_TEXT_BYTES})`);
  }
  const { text: includesExpanded, includedFiles, missingIncludes } = resolveSfzIncludes(
    sfzText,
    sfzFileName,
    options,
    MAX_SFZ_TEXT_BYTES,
  );
  const preprocessed = preprocessSfzDefines(includesExpanded, MAX_SFZ_TEXT_BYTES);
  const headerRegex = /<(control|global|master|group|region|curve|effect|midi|sample)>/gi;

  interface SectionBlock {
    tag: string;
    entries: Array<[string, string]>;
  }

  interface ControlState {
    defaultPath: string;
    octaveOffset: number;
    noteOffset: number;
  }

  const assertBlockOpcodeCount = (tag: string, count: number): void => {
    if (tag !== 'curve' && count > SHARED_MAX_SFZ_OPCODES_PER_BLOCK) {
      throw new Error(
        `SFZ: header block with ${count} opcodes exceeds cap (${SHARED_MAX_SFZ_OPCODES_PER_BLOCK}); refusing quadratic merge`
      );
    }
  };

  const blocks: SectionBlock[] = [];
  let lastTag = '';
  let lastIndex = 0;
  let blockCount = 0;
  let m: RegExpExecArray | null;

  while ((m = headerRegex.exec(preprocessed)) !== null) {
    const segment = preprocessed.slice(lastIndex, m.index);
    const entries = parseOpcodeEntriesFromBlock(segment);
    if (!lastTag) {
      assertBlockOpcodeCount('preheader', entries.length);
    } else {
      assertBlockOpcodeCount(lastTag, entries.length);
      blocks.push({ tag: lastTag, entries });
    }
    if (++blockCount > SHARED_MAX_SFZ_HEADER_BLOCKS) {
      throw new Error(`SFZ: too many header blocks (>${SHARED_MAX_SFZ_HEADER_BLOCKS})`);
    }
    lastTag = m[1].toLowerCase();
    lastIndex = headerRegex.lastIndex;
  }
  if (lastTag) {
    const entries = parseOpcodeEntriesFromBlock(preprocessed.slice(lastIndex));
    assertBlockOpcodeCount(lastTag, entries.length);
    blocks.push({ tag: lastTag, entries });
  } else {
    const entries = parseOpcodeEntriesFromBlock(preprocessed);
    assertBlockOpcodeCount('preheader', entries.length);
  }

  let controlState: ControlState = { defaultPath: '', octaveOffset: 0, noteOffset: 0 };
  let globalEntries: Array<[string, string]> = [];
  let masterEntries: Array<[string, string]> = [];
  let groupEntries: Array<[string, string]> = [];

  interface MergedRegionRecord {
    control: ControlState;
    orderedEntries: Array<[string, string]>;
    regionEntries: Array<[string, string]>;
    ops: Record<string, string>;
  }

  const mergedRegions: MergedRegionRecord[] = [];
  const globalOps: Record<string, string> = {};
  const keyswitchLabelsMap = new Map<number, string>();
  const ccMacrosMap = new Map<number, SfzCcMacroInfo>();
  const unknownOpcodesSet = new Set<string>();
  const inlineSamplePayloads: AudioFilePayload[] = [];
  const parsedCurves: SfzCurveDescriptor[] = [];
  let nextCurveIndex = 0;
  let imagePath: string | undefined;
  let imageControlsPath: string | undefined;
  let swLokey: number | undefined;
  let swHikey: number | undefined;
  let swLastGlobal: number | undefined;

  const auditEntries = (entries: Array<[string, string]>) => {
    for (const [k] of entries) {
      if (unknownOpcodesSet.size < MAX_UNKNOWN_OPCODE_AUDIT && !isRecognizedSfzOpcode(k)) {
        unknownOpcodesSet.add(k);
      }
    }
  };

  for (const b of blocks) {
    auditEntries(b.entries);
    if (b.tag === 'control') {
      for (const [k, v] of b.entries) {
        if (k === 'default_path') {
          const normPath = normalizeRelativeSamplePath(v);
          controlState = { ...controlState, defaultPath: normPath ? `${normPath}/` : '' };
        } else if (k === 'octave_offset') {
          controlState = { ...controlState, octaveOffset: parseIntOr(v, 0) };
        } else if (k === 'note_offset') {
          controlState = { ...controlState, noteOffset: parseIntOr(v, 0) };
        } else if (k === 'image') {
          const normImg = normalizeRelativeSamplePath(`${controlState.defaultPath}${v}`);
          if (normImg) imagePath = normImg;
        } else if (k === 'image_controls') {
          const normImg = normalizeRelativeSamplePath(`${controlState.defaultPath}${v}`);
          if (normImg) imageControlsPath = normImg;
        } else {
          const lblCc = /^label_cc(\d+)$/.exec(k);
          if (lblCc) {
            const cc = parseInt(lblCc[1], 10);
            if (cc >= 0 && cc <= 127) {
              const prev = ccMacrosMap.get(cc) ?? { cc };
              ccMacrosMap.set(cc, { ...prev, label: v });
            }
            continue;
          }
          const setCc = /^set_(?:hd|real)?cc(\d+)$/.exec(k);
          if (setCc) {
            const cc = parseInt(setCc[1], 10);
            if (cc >= 0 && cc <= 127) {
              const prev = ccMacrosMap.get(cc) ?? { cc };
              const val = parseFloat(v);
              if (Number.isFinite(val)) ccMacrosMap.set(cc, { ...prev, initialValue: val });
            }
            continue;
          }
          const lblKey = /^label_key(\d+)$/.exec(k);
          if (lblKey) {
            const note = parseInt(lblKey[1], 10);
            if (note >= 0 && note <= 127 && v) {
              keyswitchLabelsMap.set(note, v);
            }
          }
        }
      }
    } else if (b.tag === 'curve') {
      const sparse = new Map<number, number>();
      let explicitIdx: number | undefined;
      for (const [k, v] of b.entries) {
        if (k === 'curve_index') {
          const parsed = parseInt(v, 10);
          if (!Number.isNaN(parsed) && parsed >= 0) explicitIdx = parsed;
        } else {
          const vm = /^v(\d+)$/.exec(k);
          if (vm) {
            const ptIdx = parseInt(vm[1], 10);
            const ptVal = parseFloat(v);
            if (ptIdx >= 0 && ptIdx <= 127 && Number.isFinite(ptVal)) {
              sparse.set(ptIdx, clamp(ptVal, -1, 1));
            }
          }
        }
      }
      const index = explicitIdx ?? nextCurveIndex;
      nextCurveIndex = Math.max(nextCurveIndex, index + 1);
      if (sparse.size > 0) {
        parsedCurves.push({ index, points: interpolateSfzCurvePoints(sparse) });
      }
    } else if (b.tag === 'sample') {
      const sampleOps: Record<string, string> = {};
      for (const [k, v] of b.entries) sampleOps[k] = v;
      const rawName = sampleOps.name ?? sampleOps.sample;
      if (rawName && sampleOps.base64data) {
        const decodedBuf = decodeSfzInlineBase64Sample(sampleOps.base64data);
        if (decodedBuf) {
          inlineSamplePayloads.push({
            name: sanitizeFlatSampleName(basenameOfPath(rawName)),
            buffer: decodedBuf,
          });
        }
      }
    } else if (b.tag === 'global') {
      globalEntries = [...globalEntries, ...b.entries];
      for (const [k, v] of b.entries) globalOps[k] = v;
    } else if (b.tag === 'master') {
      masterEntries = [...b.entries];
      groupEntries = [];
    } else if (b.tag === 'group') {
      groupEntries = [...b.entries];
    } else if (b.tag === 'region') {
      const orderedEntries = [...globalEntries, ...masterEntries, ...groupEntries, ...b.entries];
      const ops: Record<string, string> = {};
      for (const [k, v] of orderedEntries) {
        ops[k] = v;
      }
      const keyOffset = controlState.octaveOffset * 12 + controlState.noteOffset;
      if (ops.sw_lokey !== undefined) swLokey = parseSfzNote(ops.sw_lokey, 0, keyOffset);
      if (ops.sw_hikey !== undefined) swHikey = parseSfzNote(ops.sw_hikey, 127, keyOffset);
      if (ops.sw_last !== undefined) {
        const swNote = parseSfzNote(ops.sw_last, 0, keyOffset);
        swLastGlobal = swNote;
        if (ops.sw_label) {
          keyswitchLabelsMap.set(swNote, ops.sw_label);
        }
      }
      mergedRegions.push({
        control: { ...controlState },
        orderedEntries,
        regionEntries: b.entries,
        ops,
      });
    }
  }

  const allAudioPayloads = [...companionAudioFiles, ...inlineSamplePayloads];

  // Index companion + inline audio files by normalized relative path and lowercase basename,
  // while assigning a guaranteed flat unique sampleName (no '/' or '..').
  const basenameCounts = new Map<string, number>();
  for (const f of allAudioPayloads) {
    const flatBase = sanitizeFlatSampleName(basenameOfPath(f.name)).toLowerCase();
    basenameCounts.set(flatBase, (basenameCounts.get(flatBase) ?? 0) + 1);
  }

  const audioByNormPath = new Map<string, AudioFilePayload>();
  const audioByBasename = new Map<string, AudioFilePayload>();
  const indexedPaths: Array<{ normLower: string; file: AudioFilePayload }> = [];
  const flatNameByPayload = new Map<AudioFilePayload, string>();
  const usedFlatNames = new Set<string>();
  const outputAudioFiles: AudioFilePayload[] = [];

  for (let i = 0; i < allAudioPayloads.length; i++) {
    const f = allAudioPayloads[i];
    const normRel = normalizeRelativeSamplePath(f.name);
    const normLower = normRel.toLowerCase();
    const base = sanitizeFlatSampleName(basenameOfPath(f.name));
    const isDuplicateBase = (basenameCounts.get(base.toLowerCase()) ?? 0) > 1;

    let flatName = isDuplicateBase && normRel
      ? sanitizeFlatSampleName(normRel)
      : base;

    if (usedFlatNames.has(flatName.toLowerCase())) {
      const dot = flatName.lastIndexOf('.');
      const stem = dot > 0 ? flatName.slice(0, dot) : flatName;
      const ext = dot > 0 ? flatName.slice(dot) : '';
      flatName = `${stem}_${i + 1}${ext}`;
    }
    usedFlatNames.add(flatName.toLowerCase());
    flatNameByPayload.set(f, flatName);
    outputAudioFiles.push({ name: flatName, buffer: f.buffer });

    if (normLower) {
      audioByNormPath.set(normLower, f);
      indexedPaths.push({ normLower, file: f });
    }
    audioByBasename.set(base.toLowerCase(), f);
  }

  const resolveCompanionFile = (rawSample: string, defaultPath: string): AudioFilePayload | undefined => {
    const relWithDefault = normalizeRelativeSamplePath(`${defaultPath}${rawSample}`).toLowerCase();
    const relRaw = normalizeRelativeSamplePath(rawSample).toLowerCase();
    if (relWithDefault && audioByNormPath.has(relWithDefault)) {
      return audioByNormPath.get(relWithDefault);
    }
    if (relRaw && audioByNormPath.has(relRaw)) {
      return audioByNormPath.get(relRaw);
    }
    if (relWithDefault) {
      const suffix = `/${relWithDefault}`;
      const match = indexedPaths.find((p) => p.normLower.endsWith(suffix));
      if (match) return match.file;
    }
    if (relRaw) {
      const suffix = `/${relRaw}`;
      const match = indexedPaths.find((p) => p.normLower.endsWith(suffix));
      if (match) return match.file;
    }
    const base = sanitizeFlatSampleName(basenameOfPath(rawSample)).toLowerCase();
    return audioByBasename.get(base);
  };

  const wavInstCache = new Map<AudioFilePayload, AiffInstrumentInfo | undefined>();
  const getWavInst = (file: AudioFilePayload | undefined): AiffInstrumentInfo | undefined => {
    if (!file) return undefined;
    if (!wavInstCache.has(file)) {
      wavInstCache.set(file, extractAudioHeaderInstrumentInfo(file.buffer));
    }
    return wavInstCache.get(file);
  };

  const articulation = createDefaultArticulation();
  const refOps = mergedRegions[0]?.ops ?? globalOps;
  if (refOps) {
    const { hasAmpEnv, ampEnv } = extractSfzAmpEnvFromOps(refOps);
    if (hasAmpEnv) {
      articulation.ampEnvEnabled = true;
      articulation.ampEnv = ampEnv;
    }

    const refFilter = extractSfzFilterFromOps(refOps);
    if (refFilter) {
      articulation.filter = refFilter;
    }

    if (refOps.pitcheg_depth !== undefined || refOps.pitcheg_attack !== undefined) {
      const depthCents = parseFloatOr(refOps.pitcheg_depth, 0);
      articulation.modEnvToPitchCents = depthCents;
      articulation.pitchEnv = {
        enabled: depthCents !== 0,
        depthCents,
        velModDepth:
          (refOps.pitcheg_veltodepth ?? refOps.pitcheg_vel2depth) !== undefined
            ? parseFloatOr(refOps.pitcheg_veltodepth ?? refOps.pitcheg_vel2depth, 0)
            : undefined,
        env: {
          delaySec: Math.max(0, parseFloatOr(refOps.pitcheg_delay, 0)),
          attackSec: Math.max(0.001, parseFloatOr(refOps.pitcheg_attack, 0.005)),
          holdSec: Math.max(0, parseFloatOr(refOps.pitcheg_hold, 0)),
          decaySec: Math.max(0.001, parseFloatOr(refOps.pitcheg_decay, 0.25)),
          sustainLevel: clamp(parseFloatOr(refOps.pitcheg_sustain, 0) / 100, 0, 1),
          releaseSec: Math.max(0.001, parseFloatOr(refOps.pitcheg_release, 0.2)),
        },
      };
    }

    if (refOps.bend_up !== undefined) {
      articulation.pitchBendUpSt = Math.round(parseFloatOr(refOps.bend_up, 200) / 100);
    }
    if (refOps.bend_down !== undefined) {
      articulation.pitchBendDownSt = Math.round(Math.abs(parseFloatOr(refOps.bend_down, 200)) / 100);
    }
    if (refOps.polyphony !== undefined) {
      articulation.polyphony = clamp(Math.round(parseIntOr(refOps.polyphony, 16)), 1, 128);
    }

    if (refOps.pitchlfo_depth !== undefined || refOps.lfo01_pitch !== undefined) {
      articulation.vibLfo = {
        enabled: true,
        delaySec: Math.max(0, parseFloatOr(refOps.pitchlfo_delay ?? refOps.lfo01_delay, 0)),
        freqHz: Math.max(0.05, parseFloatOr(refOps.pitchlfo_freq ?? refOps.lfo01_freq, 5)),
        toPitchCents: parseFloatOr(refOps.pitchlfo_depth ?? refOps.lfo01_pitch, 0),
        toFilterCents: parseFloatOr(refOps.fillfo_depth ?? refOps.lfo01_cutoff, 0),
        toVolumeDb: parseFloatOr(refOps.amplfo_depth ?? refOps.lfo01_volume, 0),
        waveform: 0,
      };
    }
  }

  const extendedRegions: ExtendedRegion[] = [];
  let seq = 1;

  for (const regRec of mergedRegions.slice(0, MAX_SFZ_REGIONS)) {
    const { control, orderedEntries, ops } = regRec;
    const rawSample = ops.sample;
    if (!rawSample) continue;

    const keyOffset = control.octaveOffset * 12 + control.noteOffset;

    let explicitLowKey: number | undefined;
    let explicitHighKey: number | undefined;
    let explicitRootKey: number | undefined;
    let rawHikeyNegative = false;
    let hasRootExplicit = false;

    for (const [k, v] of orderedEntries) {
      const vt = v.trim();
      if (k === 'key') {
        if (/^-\d+$/.test(vt) && parseInt(vt, 10) < 0) {
          rawHikeyNegative = true;
        } else {
          const n = parseSfzNote(vt, 60, keyOffset);
          explicitLowKey = n;
          explicitHighKey = n;
          explicitRootKey = n;
          hasRootExplicit = true;
          rawHikeyNegative = false;
        }
      } else if (k === 'lokey') {
        if (/^-\d+$/.test(vt) && parseInt(vt, 10) < 0) {
          rawHikeyNegative = true;
        } else {
          explicitLowKey = parseSfzNote(vt, 0, keyOffset);
        }
      } else if (k === 'hikey') {
        if (/^-\d+$/.test(vt) && parseInt(vt, 10) < 0) {
          rawHikeyNegative = true;
        } else {
          explicitHighKey = parseSfzNote(vt, 127, keyOffset);
          rawHikeyNegative = false;
        }
      } else if (k === 'pitch_keycenter') {
        explicitRootKey = parseSfzNote(vt, 60, keyOffset);
        hasRootExplicit = true;
      }
    }

    for (const [rk, rv] of regRec.regionEntries) {
      if ((rk === 'hikey' || rk === 'lokey') && /^-\d+$/.test(rv.trim()) && parseInt(rv.trim(), 10) < 0) {
        rawHikeyNegative = true;
        break;
      }
    }

    if (rawHikeyNegative) continue;

    const rawLovel = ops.lovel !== undefined ? parseInt(ops.lovel, 10) : NaN;
    const rawHivel = ops.hivel !== undefined ? parseInt(ops.hivel, 10) : NaN;
    if (
      (!Number.isNaN(rawLovel) && rawLovel === 0 && !Number.isNaN(rawHivel) && rawHivel === 0) ||
      (!Number.isNaN(rawHivel) && rawHivel <= 0)
    ) {
      continue;
    }

    const baseName = sanitizeFlatSampleName(basenameOfPath(rawSample));
    const matchedFile = resolveCompanionFile(rawSample, control.defaultPath);
    const sampleName = matchedFile ? flatNameByPayload.get(matchedFile)! : baseName;
    const wavInst = getWavInst(matchedFile);

    const lowKey = explicitLowKey ?? 0;
    const highKey = explicitHighKey ?? 127;
    const rootKey = hasRootExplicit
      ? (explicitRootKey ?? 60)
      : (wavInst?.rootKey ?? Math.round((lowKey + highKey) * 0.5));

    const lowVel = !Number.isNaN(rawLovel) ? clamp(rawLovel, 1, 127) : 1;
    const highVel = !Number.isNaN(rawHivel) ? clamp(rawHivel, 1, 127) : 127;

    const transpose = parseIntOr(ops.transpose, 0);
    const tuneCents = ops.tune !== undefined ? parseIntOr(ops.tune, 0) : (wavInst?.detune ?? 0);
    const effectiveRootKey = clamp(rootKey - transpose, 0, 127);
    const detune = clamp(tuneCents, -99, 99);
    const volume = clamp(Math.round(parseFloatOr(ops.volume, 0)), -32, 12);
    // SFZ pan is -100..+100 -> convert to -50..+50
    const pan = clamp(Math.round(parseFloatOr(ops.pan, 0) * 0.5), -50, 50);
    const pitchKeytrack = clamp(Math.round(parseFloatOr(ops.pitch_keytrack, 100)), 0, 100);

    const rawTrig = (ops.trigger ?? 'attack').toLowerCase();
    const trigger: TriggerMode =
      rawTrig === 'release' || rawTrig === 'first' || rawTrig === 'legato' ? rawTrig : 'attack';

    const seqPosition = ops.seq_position !== undefined ? parseIntOr(ops.seq_position, 1) : undefined;
    const seqLength = ops.seq_length !== undefined ? parseIntOr(ops.seq_length, 1) : undefined;

    // Key & Velocity Crossfades (only active when corresponding opcodes are defined)
    const hasKeyFadeIn = ops.xfin_lokey !== undefined || ops.xfin_hikey !== undefined;
    const xfinLokey = hasKeyFadeIn ? parseSfzNote(ops.xfin_lokey, 0, keyOffset) : lowKey;
    const xfinHikey = hasKeyFadeIn ? parseSfzNote(ops.xfin_hikey, lowKey, keyOffset) : lowKey;
    const keyFadeIn = hasKeyFadeIn ? Math.max(0, xfinHikey - xfinLokey) : 0;

    const hasKeyFadeOut = ops.xfout_lokey !== undefined || ops.xfout_hikey !== undefined;
    const xfoutLokey = hasKeyFadeOut ? parseSfzNote(ops.xfout_lokey, highKey, keyOffset) : highKey;
    const xfoutHikey = hasKeyFadeOut ? parseSfzNote(ops.xfout_hikey, 127, keyOffset) : highKey;
    const keyFadeOut = hasKeyFadeOut ? Math.max(0, xfoutHikey - xfoutLokey) : 0;

    const hasVelFadeIn = ops.xfin_lovel !== undefined || ops.xfin_hivel !== undefined;
    const xfinLovel = hasVelFadeIn ? clamp(parseIntOr(ops.xfin_lovel, 1), 1, 127) : lowVel;
    const xfinHivel = hasVelFadeIn ? clamp(parseIntOr(ops.xfin_hivel, lowVel), 1, 127) : lowVel;
    const velFadeIn = hasVelFadeIn ? Math.max(0, xfinHivel - xfinLovel) : 0;

    const hasVelFadeOut = ops.xfout_lovel !== undefined || ops.xfout_hivel !== undefined;
    const xfoutLovel = hasVelFadeOut ? clamp(parseIntOr(ops.xfout_lovel, highVel), 1, 127) : highVel;
    const xfoutHivel = hasVelFadeOut ? clamp(parseIntOr(ops.xfout_hivel, 127), 1, 127) : highVel;
    const velFadeOut = hasVelFadeOut ? Math.max(0, xfoutHivel - xfoutLovel) : 0;

    const hasExplicitLoopMode = ops.loop_mode !== undefined || ops.loopmode !== undefined;
    const rawLoop = (ops.loop_mode ?? ops.loopmode ?? '').toLowerCase();
    let loopMode: LoopMode = 'no_loop';
    if (hasExplicitLoopMode) {
      if (rawLoop === 'loop_continuous') loopMode = 'loop_continuous';
      else if (rawLoop === 'loop_sustain') loopMode = 'loop_sustain';
      else if (rawLoop === 'loop_bidirectional' || rawLoop === 'ping_pong' || rawLoop === 'alternating') loopMode = 'ping_pong';
      else if (rawLoop === 'loop_backward' || rawLoop === 'reverse') loopMode = 'loop_backward';
      else if (rawLoop === 'one_shot') loopMode = 'one_shot';
    } else if (wavInst?.loopMode && wavInst.loopMode !== 'no_loop' && (wavInst.loopEnd ?? 0) > (wavInst.loopStart ?? 0)) {
      loopMode = wavInst.loopMode;
    }

    const rawLoopStartOp = ops.loop_start ?? ops.loopstart;
    const rawLoopEndOp = ops.loop_end ?? ops.loopend;
    const loopStart = Math.max(0, rawLoopStartOp !== undefined ? parseIntOr(rawLoopStartOp, 0) : (wavInst?.loopStart ?? 0));
    const loopEnd = Math.max(loopStart, rawLoopEndOp !== undefined ? parseIntOr(rawLoopEndOp, loopStart) : (wavInst?.loopEnd ?? loopStart));
    const loopCrossfadeMs = Math.max(0, Math.round(parseFloatOr(ops.loop_crossfade, 0) * 1000));
    const fadeCurve = (ops.xf_keycurve ?? ops.xf_velcurve ?? 'power') === 'gain' ? 'linear' : 'equal-power';

    const sampleStartFrame =
      ops.offset !== undefined ? Math.max(0, parseIntOr(ops.offset, 0)) : undefined;
    const sampleEndFrame =
      ops.end !== undefined ? Math.max(0, parseIntOr(ops.end, 0)) : undefined;
    const reversed =
      (ops.direction ?? '').toLowerCase() === 'reverse' || loopMode === 'loop_backward'
        ? true
        : undefined;

    let playLogic: SamplerPlayLogic | undefined;
    if (ops.lorand !== undefined || ops.hirand !== undefined) {
      playLogic = 'random';
    } else if ((seqLength ?? 0) > 1) {
      playLogic = 'round_robin';
    }

    const velToVolumeDepth =
      ops.amp_veltrack !== undefined
        ? clamp(parseFloatOr(ops.amp_veltrack, 100), -100, 100)
        : undefined;
    const velToPitchCents =
      ops.pitch_veltrack !== undefined
        ? clamp(parseFloatOr(ops.pitch_veltrack, 0), -12000, 12000)
        : undefined;

    const muteGroupRaw = parseIntOr(ops.off_by ?? ops.group, 0);
    const muteGroup = muteGroupRaw > 0 ? Math.min(32, muteGroupRaw) : undefined;
    const rawOffMode = (ops.off_mode ?? '').toLowerCase();
    const offMode: OffMode | undefined =
      rawOffMode === 'fast' || rawOffMode === 'normal' || rawOffMode === 'time'
        ? rawOffMode
        : undefined;
    const offTimeSec =
      ops.off_time !== undefined ? Math.max(0.001, parseFloatOr(ops.off_time, 0.06)) : undefined;
    const rtDecayDbPerSec =
      ops.rt_decay !== undefined ? Math.max(0, parseFloatOr(ops.rt_decay, 0)) : undefined;
    const loRand =
      ops.lorand !== undefined ? clamp(parseFloatOr(ops.lorand, 0), 0, 1) : undefined;
    const hiRand =
      ops.hirand !== undefined ? clamp(parseFloatOr(ops.hirand, 1), 0, 1) : undefined;
    const curveIndex =
      ops.curve_index !== undefined ? Math.max(0, parseIntOr(ops.curve_index, 0)) : undefined;

    let ccCrossfadeIn: Record<number, { lo: number; hi: number }> | undefined;
    let ccCrossfadeOut: Record<number, { lo: number; hi: number }> | undefined;
    for (const [k, v] of orderedEntries) {
      const mIn = /^xf(in)_(lo|hi)cc(\d+)$/.exec(k);
      if (mIn) {
        const cc = parseInt(mIn[3], 10);
        if (cc >= 0 && cc <= 127) {
          ccCrossfadeIn ??= {};
          ccCrossfadeIn[cc] ??= { lo: 0, hi: 127 };
          const val = clamp(parseFloatOr(v, mIn[2] === 'lo' ? 0 : 127), 0, 127);
          if (mIn[2] === 'lo') ccCrossfadeIn[cc].lo = val;
          else ccCrossfadeIn[cc].hi = val;
        }
        continue;
      }
      const mOut = /^xf(out)_(lo|hi)cc(\d+)$/.exec(k);
      if (mOut) {
        const cc = parseInt(mOut[3], 10);
        if (cc >= 0 && cc <= 127) {
          ccCrossfadeOut ??= {};
          ccCrossfadeOut[cc] ??= { lo: 0, hi: 127 };
          const val = clamp(parseFloatOr(v, mOut[2] === 'lo' ? 0 : 127), 0, 127);
          if (mOut[2] === 'lo') ccCrossfadeOut[cc].lo = val;
          else ccCrossfadeOut[cc].hi = val;
        }
      }
    }
    const groupName = ops.group_label ?? ops.master_label;
    const groupId = groupName
      ? `grp-${groupName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
      : muteGroup
        ? `grp-mute-${muteGroup}`
        : undefined;

    const keyswitchNote =
      ops.sw_last !== undefined
        ? parseSfzNote(ops.sw_last, 0, keyOffset)
        : ops.sw_lokey !== undefined
          ? parseSfzNote(ops.sw_lokey, 0, keyOffset)
          : undefined;

    const loops: SampleLoopDescriptor[] | undefined =
      loopMode !== 'no_loop' && loopEnd > loopStart
        ? [
            {
              id: 'loop-1',
              mode: loopMode,
              startFrame: loopStart,
              endFrame: loopEnd,
              crossfadeMs: loopCrossfadeMs,
              crossfadeCurve: fadeCurve,
            },
          ]
        : undefined;

    // Detect per-region articulation overrides relative to global/reference articulation
    let hasArticulationOverride = false;
    let ampEnvOverride: Partial<DahdsrEnvelope> | undefined;
    let filterOverride: Partial<RegionFilterConfig> | undefined;

    const regAmp = extractSfzAmpEnvFromOps(ops);
    if (regAmp.hasAmpEnv) {
      const g = articulation.ampEnv;
      const rEnv = regAmp.ampEnv;
      const diff =
        !articulation.ampEnvEnabled ||
        Math.abs(rEnv.delaySec - g.delaySec) > 0.001 ||
        Math.abs(rEnv.attackSec - g.attackSec) > 0.001 ||
        Math.abs(rEnv.holdSec - g.holdSec) > 0.001 ||
        Math.abs(rEnv.decaySec - g.decaySec) > 0.001 ||
        Math.abs(rEnv.sustainLevel - g.sustainLevel) > 0.002 ||
        Math.abs(rEnv.releaseSec - g.releaseSec) > 0.001;
      if (diff) {
        hasArticulationOverride = true;
        ampEnvOverride = rEnv;
      }
    }

    const regFilter = extractSfzFilterFromOps(ops);
    if (regFilter) {
      const gf = articulation.filter;
      const diff =
        !gf.enabled ||
        regFilter.type !== gf.type ||
        Math.abs(regFilter.cutoffHz - gf.cutoffHz) > 1 ||
        Math.abs(regFilter.resonanceDb - gf.resonanceDb) > 0.1 ||
        Math.abs(regFilter.envToFilterCents - gf.envToFilterCents) > 1;
      if (diff) {
        hasArticulationOverride = true;
        filterOverride = regFilter;
      }
    }

    extendedRegions.push({
      id: `ext-reg-${seq++}`,
      sampleName,
      lowKey: hasKeyFadeIn ? Math.min(lowKey, xfinLokey) : lowKey,
      highKey: hasKeyFadeOut ? Math.max(highKey, xfoutHikey) : highKey,
      rootKey: effectiveRootKey,
      lowVel: hasVelFadeIn ? Math.min(lowVel, xfinLovel) : lowVel,
      highVel: hasVelFadeOut ? Math.max(highVel, xfoutHivel) : highVel,
      detune,
      volume,
      pan,
      pitchKeytrack,
      trigger,
      seqPosition,
      seqLength,
      keyFadeIn,
      keyFadeOut,
      velFadeIn,
      velFadeOut,
      fadeCurve,
      loopMode,
      loopStart,
      loopEnd,
      loopCrossfadeMs,
      sampleStartFrame,
      sampleEndFrame,
      reversed,
      playLogic,
      velToVolumeDepth,
      velToPitchCents,
      groupId,
      groupName,
      muteGroup,
      ...(offMode !== undefined ? { offMode } : {}),
      ...(offTimeSec !== undefined ? { offTimeSec } : {}),
      ...(rtDecayDbPerSec !== undefined ? { rtDecayDbPerSec } : {}),
      ...(loRand !== undefined ? { loRand } : {}),
      ...(hiRand !== undefined ? { hiRand } : {}),
      ...(ccCrossfadeIn ? { ccCrossfadeIn } : {}),
      ...(ccCrossfadeOut ? { ccCrossfadeOut } : {}),
      ...(curveIndex !== undefined ? { curveIndex } : {}),
      keyswitchNote,
      loops,
      ...(hasArticulationOverride ? { hasArticulationOverride: true } : {}),
      ...(ampEnvOverride ? { ampEnvOverride } : {}),
      ...(filterOverride ? { filterOverride } : {}),
    });
  }

  extendedRegions.sort((a, b) => a.lowKey - b.lowKey || a.lowVel - b.lowVel);

  const { zones: classicZones, velocityLayerGainCompensation } =
    projectExtendedRegionsToClassicZones(extendedRegions);

  const cleanTitle = basenameOfPath(sfzFileName).replace(/\.sfz$/i, '').trim() || 'SFZ Instrument';
  const modelName = cleanTitle.slice(0, 11);
  const classification = classifyInstrumentAndParameterSet(cleanTitle);

  const metadata = extractSfzMetadata(sfzText, sfzFileName, classification.category);
  const keyswitches: SfzKeyswitchInfo[] = Array.from(keyswitchLabelsMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([note, label]) => ({ note, label }));
  const ccMacros: SfzCcMacroInfo[] = Array.from(ccMacrosMap.values()).sort((a, b) => a.cc - b.cc);
  const unknownOpcodes = Array.from(unknownOpcodesSet);

  const extraAttrs: CustomMetadataTag[] = [...(metadata.customAttributes ?? [])];
  for (const ks of keyswitches) {
    extraAttrs.push({ tag: `Keyswitch ${ks.note}`, value: ks.label });
  }
  for (const cm of ccMacros) {
    extraAttrs.push({
      tag: `CC${cm.cc}${cm.label ? ` (${cm.label})` : ''}`,
      value: cm.initialValue !== undefined ? String(cm.initialValue) : 'macro',
    });
  }
  if (imagePath) {
    extraAttrs.push({ tag: 'Cover Image', value: imagePath });
  }
  if (extraAttrs.length > 0) {
    metadata.customAttributes = extraAttrs;
  }

  const warnings: string[] = [];
  if (missingIncludes.length > 0) {
    warnings.push(`SFZ missing #include target(s): ${missingIncludes.join(', ')}`);
  }
  if (unknownOpcodes.length > 0) {
    warnings.push(
      `SFZ unrecognized/degraded opcodes (${unknownOpcodes.length}): ${unknownOpcodes.slice(0, 12).join(', ')}${unknownOpcodes.length > 12 ? '...' : ''}`
    );
  }

  const sfzIntrospection: SfzIntrospectionReport = {
    includedFiles,
    missingIncludes,
    keyswitches,
    ...(swLokey !== undefined && swHikey !== undefined
      ? { swRange: { lokey: swLokey, hikey: swHikey, ...(swLastGlobal !== undefined ? { last: swLastGlobal } : {}) } }
      : {}),
    ccMacros,
    ...(imagePath ? { imagePath } : {}),
    ...(imageControlsPath ? { imageControlsPath } : {}),
    unknownOpcodes,
    inlineSampleCount: inlineSamplePayloads.length,
    ...(parsedCurves.length > 0 ? { curves: parsedCurves } : {}),
  };

  return {
    sourceFormat: 'sfz',
    presetName: cleanTitle,
    modelName,
    detectedCategory: classification.category,
    suggestedParameterSet: classification.parameterSet,
    audioFiles: outputAudioFiles,
    extendedRegions,
    classicZones,
    velocityLayerGainCompensation,
    articulation,
    metadata,
    ...(warnings.length > 0 ? { warnings } : {}),
    sfzIntrospection,
  };
}
