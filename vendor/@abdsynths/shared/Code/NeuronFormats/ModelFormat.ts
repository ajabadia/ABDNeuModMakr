// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Hartmann Neuron Binary .model Reader & Writer
//
// Implements 1:1 binary parsing and serialization of:
//   - `%06d.scape` (`csAN` + `mnAN` + `fdAN` + `int16` periodic excitation curve)
//   - `%06d.sphere` (`psAN` + `mnAN` + `fdAN` + `SphereFrame` bank with 6152-byte
//     1024-partial additive blocks)
//   - `map.script` (1027-line tab-separated `MapVersionMajor/Minor/Build` +
//     `000LowKey..127Pan` format & `add mapentry` format)
//   - `MName` & `ModelNames` cache (`%03d\t%11s`)
//   - Frame/Curve additive resynthesis (`synth_frames.py` equivalent)
//   - Conversion from Legacy `.model` to Modern `.neuronikmodel` v2.1
//
// Verified against `NeuronVS_neurondb/tools/model_binary.py` and the 3,134
// factory `.scape` / `.sphere` files (`Models/000..511`).
// ─────────────────────────────────────────────────────────

import type { Zone, ProcessConfig, TargetFormat } from './NeuronTypes.ts';
import {
  serializeNeuronScapeBinary,
  serializeNeuronSphereBinary,
  generateMapScript,
  type ScapeSphereFrame,
} from '../DspCore/NeuronAnalysis/ScapeSphereGenerator.ts';
import {
  createZipArchive,
  parseZipArchive,
  type ZipEntryInput,
} from './ZipArchive.ts';
import {
  createSoundPresetForModel,
  serializeSoundScript,
  serializeStickRec,
} from './SoundFormat.ts';

export const SPHERE_FRAME_MAGIC = 0x04d2; // 1234 — verified by FUN_10031950
export const SPHERE_PARTIAL_COUNT = 0x0400; // 1024 partials — FUN_1003bd10 / FUN_1003c980
export const SPHERE_PARTIAL_BLOCK_BYTES = 8 + 3 * 2 * SPHERE_PARTIAL_COUNT; // 6152 bytes

export interface AnChunk {
  offset: number;
  tag: string;
  /** Includes the 8-byte tag + size header */
  size: number;
  payloadOffset: number;
  payloadSize: number;
}

export interface ScapeHeader {
  chunkSize: number;
  format: number;       // 256
  curveId: number;      // must match sphere's curveId
  resolution: number;   // period in samples at 44.1 kHz (~round(44100/f0), clamp >= 84)
  flags: number;        // 0
  length: number;       // active sample count (< samples.length)
  loopStart: number;    // loop start in samples (0 = one-shot)
  loopEnd: number;      // loop end in samples (0 = one-shot)
}

export interface ParsedNeuronScape {
  kind: 'scape';
  chunks: AnChunk[];
  header: ScapeHeader;
  names: string[];                  // 12 x 8-char ASCII parameter names from mnAN
  fdPairs: [number, number][];      // 6 pairs of floats from fdAN
  dataOffset: number;               // byte offset where int16 samples begin (typically 260)
  samples: Int16Array;              // periodic excitation/phase curve
}

export interface SpherePartial {
  /** Position in the amplitude-sorted list (0 = loudest) */
  index: number;
  /** u16 at block +0x808 + 2i, sorted descending (B) */
  amplitude: number;
  /** u16 at block +0x008 + 2i, measured peak in Hz (A) */
  frequency: number;
  /** u16 at block +0x1008 + 2i, 1024-bin index on 44100 Hz grid (C) */
  bin: number;
}

export interface ParsedSphereFrame {
  index: number;
  offset: number;
  magic: number;                    // 0x4D2 (1234)
  frameId: number;                  // curveId + index
  floats: [number, number, number]; // +0x08, +0x0C, +0x10
  bands: number[][];                // nb x paso float table from +0x10
  partialCount: number;             // u16 at block +0 (1024)
  blockGain: number;                // u16 at block +2 (loudness normalization)
  partials: SpherePartial[];        // active partials (terminated at first amplitude == 0)
  isSilent: boolean;
}

export interface SphereHeader {
  chunkSize: number;
  version: number;          // 272 (old writer) or 288 (0x120 new writer)
  curveId: number;          // matches scape's curveId
  parameterSet: number;     // +0x10: cnt = parameterSet (0..9)
  resolution: number;       // +0x14: period in samples (matches scape)
  channels: number;         // +0x18: nvalid (number of valid frames)
  stickModes: number;       // +0x1C: stick = recursionDepth (1, 4, 8, 12, 16, 24, 32, 42, 54, 64)
  partials: number;         // +0x20: psum = max(4, nextpow2(stick))
  bandStride: number;       // +0x24: paso = max(4, nextpow2(stick))
  bands: number;            // +0x28: nb in {1, 25, 61}
  bands2: number;           // +0x2C: nb2 == nb
  block: number;            // +0x30: 6152
  loopStartFrame: number;   // +0x34: u1 = round(loopStart / 1024)
  loopEndFrame: number;     // +0x38: u2 = round(loopEnd / 1024)
  decodeMode: number;       // +0x3C: 0 -> 1024, 1 -> 512
  stickPlayback: number;    // +0x40: 0
  frameStride: number;      // +0x44: 16 + nb * paso * 4 + 6152 (e.g. 6568)
  dataOffset: number;       // +0x48: 300 (0x12C)
  unknown4c: number;        // +0x4C: 0
  shaping: [number, number, number, number, number, number]; // +0x50: 3x(freqHz, amp)
}

export interface ParsedNeuronSphere {
  kind: 'sphere';
  chunks: AnChunk[];
  header: SphereHeader;
  names: string[];                  // 12 x 8-char ASCII body names from mnAN
  fdPairs: [number, number][];      // 6 pairs of floats from fdAN
  dataOffset: number;
  frameStride: number;
  frames: ParsedSphereFrame[];
}

export interface MapZoneEntry {
  index: number;      // 0..127
  lowKey: number;
  hiKey: number;
  rootKey: number;
  lowSource: number;  // 1-based index into .scape/.sphere pair (0 = unused)
  hiSource: number;   // 1-based index into .scape/.sphere pair (0 = unused)
  detune: number;
  volume: number;
  pan: number;
}

export interface ParsedMapScript {
  versionMajor: number;
  versionMinor: number;
  versionBuild: number;
  entries: MapZoneEntry[];  // all 128 entries (000..127)
  activeZones: Zone[];      // converted active zones covering used entries
}

export interface ParsedNeuronModel {
  slot: number;
  name: string;
  mapScript: ParsedMapScript;
  scapes: Map<number, ParsedNeuronScape>;   // 1-based source index -> Scape
  spheres: Map<number, ParsedNeuronSphere>; // 1-based source index -> Sphere
  scapeBinaries?: Map<number, Uint8Array>;
  sphereBinaries?: Map<number, Uint8Array>;
  neuronikModelJson?: string;
  embeddedSamples?: Map<string, Uint8Array>;
  inferredParameterSet?: number;
  inferredComplexity?: number;
  hasMNameOrMapScript?: boolean;
}

// ── Chunk Chain Parser ──────────────────────────────────

function readLatin1(data: Uint8Array, offset: number, length: number): string {
  let out = '';
  const end = Math.min(data.byteLength, offset + length);
  for (let i = offset; i < end; i++) {
    out += String.fromCharCode(data[i]);
  }
  return out;
}

/**
 * Walks the `AN`-suffixed chunk chain (`csAN`/`psAN` -> `mnAN` -> `fdAN`).
 * Each chunk's 32-bit `size` at `+0x04` includes its own 8-byte header.
 */
export function parseAnChunks(data: Uint8Array): AnChunk[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const chunks: AnChunk[] = [];
  let off = 0;

  while (off + 8 <= data.byteLength) {
    const tag = readLatin1(data, off, 4);
    const size = view.getUint32(off + 4, true);
    if (!tag.endsWith('AN') || size < 8 || off + size > data.byteLength) {
      break;
    }
    chunks.push({
      offset: off,
      tag,
      size,
      payloadOffset: off + 8,
      payloadSize: size - 8,
    });
    off += size;
  }

  return chunks;
}

function parseMnAnNames(data: Uint8Array, chunks: AnChunk[]): string[] {
  const mnChunk = chunks.find((c) => c.tag === 'mnAN');
  if (!mnChunk) return [];

  const names: string[] = [];
  for (let i = 0; i < mnChunk.payloadSize; i += 8) {
    const raw = readLatin1(data, mnChunk.payloadOffset + i, 8);
    names.push(raw.replace(/[\x00 ]+$/g, ''));
  }
  return names;
}

function parseFdAnPairs(data: Uint8Array, chunks: AnChunk[]): [number, number][] {
  const fdChunk = chunks.find((c) => c.tag === 'fdAN');
  if (!fdChunk) return [];

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const floatCount = Math.floor(fdChunk.payloadSize / 4);
  const pairs: [number, number][] = [];
  for (let i = 0; i + 1 < floatCount; i += 2) {
    const a = view.getFloat32(fdChunk.payloadOffset + i * 4, true);
    const b = view.getFloat32(fdChunk.payloadOffset + (i + 1) * 4, true);
    pairs.push([a, b]);
  }
  return pairs;
}

// ── .scape Binary Reader ────────────────────────────────

/**
 * Parses a binary `.scape` buffer (`csAN` + `mnAN` + `fdAN` + `int16` excitation curve).
 */
export function parseNeuronScape(data: Uint8Array): ParsedNeuronScape {
  const chunks = parseAnChunks(data);
  if (chunks.length === 0 || chunks[0].tag !== 'csAN') {
    const found = chunks[0]?.tag ?? readLatin1(data, 0, 4);
    throw new Error(`Invalid .scape binary: expected 'csAN' chunk, found '${found}'`);
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const header: ScapeHeader = {
    chunkSize: view.getUint32(0x04, true),
    format: view.getUint32(0x08, true),
    curveId: view.getInt32(0x0c, true),
    resolution: view.getInt32(0x10, true),
    flags: view.getInt32(0x14, true),
    length: view.getInt32(0x18, true),
    loopStart: view.getInt32(0x1c, true),
    loopEnd: view.getInt32(0x20, true),
  };

  const names = parseMnAnNames(data, chunks);
  const fdPairs = parseFdAnPairs(data, chunks);
  const lastChunk = chunks[chunks.length - 1];
  const dataOffset = lastChunk.offset + lastChunk.size;

  const remBytes = Math.max(0, data.byteLength - dataOffset);
  const sampleCount = Math.floor(remBytes / 2);
  const samples = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    samples[i] = view.getInt16(dataOffset + i * 2, true);
  }

  return {
    kind: 'scape',
    chunks,
    header,
    names,
    fdPairs,
    dataOffset,
    samples,
  };
}

// ── .sphere Binary Reader ───────────────────────────────

/**
 * Parses a binary `.sphere` buffer (`psAN` + `mnAN` + `fdAN` + `SphereFrame` bank).
 */
export function parseNeuronSphere(data: Uint8Array): ParsedNeuronSphere {
  const chunks = parseAnChunks(data);
  if (chunks.length === 0 || chunks[0].tag !== 'psAN') {
    const found = chunks[0]?.tag ?? readLatin1(data, 0, 4);
    throw new Error(`Invalid .sphere binary: expected 'psAN' chunk, found '${found}'`);
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const shaping: [number, number, number, number, number, number] = [
    view.getFloat32(0x50, true),
    view.getFloat32(0x54, true),
    view.getFloat32(0x58, true),
    view.getFloat32(0x5c, true),
    view.getFloat32(0x60, true),
    view.getFloat32(0x64, true),
  ];

  const bands = view.getInt32(0x28, true);
  const bandStride = view.getInt32(0x24, true);
  const rawFrameStride = view.getInt32(0x44, true);
  const rawDataOffset = view.getInt32(0x48, true);

  const lastChunk = chunks[chunks.length - 1];
  const computedDataOffset = lastChunk.offset + lastChunk.size;
  const computedFrameStride = 0x10 + bands * bandStride * 4 + SPHERE_PARTIAL_BLOCK_BYTES;

  const dataOffset = rawDataOffset >= 300 && rawDataOffset < data.byteLength ? rawDataOffset : computedDataOffset;
  const frameStride = rawFrameStride >= SPHERE_PARTIAL_BLOCK_BYTES ? rawFrameStride : computedFrameStride;

  const header: SphereHeader = {
    chunkSize: view.getUint32(0x04, true),
    version: view.getInt32(0x08, true),
    curveId: view.getInt32(0x0c, true),
    parameterSet: view.getInt32(0x10, true),
    resolution: view.getInt32(0x14, true),
    channels: view.getInt32(0x18, true),
    stickModes: view.getInt32(0x1c, true),
    partials: view.getInt32(0x20, true),
    bandStride,
    bands,
    bands2: view.getInt32(0x2c, true),
    block: view.getInt32(0x30, true),
    loopStartFrame: view.getInt32(0x34, true),
    loopEndFrame: view.getInt32(0x38, true),
    decodeMode: view.getInt32(0x3c, true),
    stickPlayback: view.getInt32(0x40, true),
    frameStride,
    dataOffset,
    unknown4c: view.getInt32(0x4c, true),
    shaping,
  };

  const names = parseMnAnNames(data, chunks);
  const fdPairs = parseFdAnPairs(data, chunks);

  const blockStartInFrame = 0x10 + bands * bandStride * 4;
  const frameCount = Math.max(0, Math.floor((data.byteLength - dataOffset) / frameStride));
  const frames: ParsedSphereFrame[] = [];

  for (let i = 0; i < frameCount; i++) {
    const off = dataOffset + i * frameStride;
    const magic = view.getInt32(off, true);
    const frameId = view.getInt32(off + 0x04, true);
    const floats: [number, number, number] = [
      view.getFloat32(off + 0x08, true),
      view.getFloat32(off + 0x0c, true),
      view.getFloat32(off + 0x10, true),
    ];

    const frameBands: number[][] = [];
    let bandNonZero = false;
    for (let b = 0; b < bands; b++) {
      const row: number[] = [];
      for (let s = 0; s < bandStride; s++) {
        const val = view.getFloat32(off + 0x10 + (b * bandStride + s) * 4, true);
        if (val !== 0.0) bandNonZero = true;
        row.push(val);
      }
      frameBands.push(row);
    }

    const blockOff = off + blockStartInFrame;
    let partialCount = 0;
    let blockGain = 0;
    const partials: SpherePartial[] = [];

    if (blockOff + SPHERE_PARTIAL_BLOCK_BYTES <= data.byteLength) {
      partialCount = view.getUint16(blockOff, true);
      blockGain = view.getUint16(blockOff + 2, true);
      const count = Math.min(partialCount, SPHERE_PARTIAL_COUNT);

      for (let p = 0; p < count; p++) {
        const amp = view.getUint16(blockOff + 0x808 + p * 2, true);
        if (amp === 0) break; // Sorted descending; 0 terminates the active list
        const freq = view.getUint16(blockOff + 0x008 + p * 2, true);
        const bin = view.getUint16(blockOff + 0x1008 + p * 2, true);
        partials.push({
          index: p,
          amplitude: amp,
          frequency: freq,
          bin,
        });
      }
    }

    const isSilent =
      floats[0] === 0.0 &&
      floats[1] === 0.0 &&
      floats[2] === 0.0 &&
      !bandNonZero;

    frames.push({
      index: i,
      offset: off,
      magic,
      frameId,
      floats,
      bands: frameBands,
      partialCount,
      blockGain,
      partials,
      isSilent,
    });
  }

  return {
    kind: 'sphere',
    chunks,
    header,
    names,
    fdPairs,
    dataOffset,
    frameStride,
    frames,
  };
}

/**
 * Auto-detects and parses either a `.scape` (`csAN`) or `.sphere` (`psAN`) binary buffer.
 */
export function parseNeuronModelBinary(
  data: Uint8Array
): ParsedNeuronScape | ParsedNeuronSphere {
  const chunks = parseAnChunks(data);
  if (chunks.length === 0) {
    throw new Error('No AN chunk header found in binary buffer');
  }
  if (chunks[0].tag === 'csAN') return parseNeuronScape(data);
  if (chunks[0].tag === 'psAN') return parseNeuronSphere(data);
  throw new Error(`Unexpected root AN chunk tag: ${chunks[0].tag}`);
}

// ── map.script & MName Readers / Writers ────────────────

/**
 * Parses `map.script` (both the canonical 1027-line `NNNLowKey\tval` format from
 * `KeyZoneData.formatForMapScript` and the `add mapentry` script format).
 */
export function parseMapScript(text: string): ParsedMapScript {
  let versionMajor = 0;
  let versionMinor = 9;
  let versionBuild = 2;

  const entries: MapZoneEntry[] = Array.from({ length: 128 }, (_, i) => ({
    index: i,
    lowKey: 0,
    hiKey: 0,
    rootKey: 0,
    lowSource: 0,
    hiSource: 0,
    detune: 0,
    volume: 0,
    pan: 0,
  }));

  const lines = text.split(/\r?\n/);
  let addEntryCursor = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) continue;

    if (line.startsWith('add mapentry')) {
      // Format: add mapentry <lowKey> <hiKey> <rootKey> <detune> <volume> <pan> "<scape>" "<sphere>"
      const parts = line.split(/\s+/);
      if (parts.length >= 8 && addEntryCursor < 128) {
        const idx = addEntryCursor++;
        entries[idx] = {
          index: idx,
          lowKey: parseInt(parts[2], 10) || 0,
          hiKey: parseInt(parts[3], 10) || 0,
          rootKey: parseInt(parts[4], 10) || 0,
          lowSource: idx + 1,
          hiSource: idx + 1,
          detune: parseInt(parts[5], 10) || 0,
          volume: parseInt(parts[6], 10) || 0,
          pan: parseInt(parts[7], 10) || 0,
        };
      }
      continue;
    }

    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const key = parts[0];
    const val = parseInt(parts[1], 10) || 0;

    if (key === 'MapVersionMajor') {
      versionMajor = val;
      continue;
    }
    if (key === 'MapVersionMinor') {
      versionMinor = val;
      continue;
    }
    if (key === 'MapVersionBuild') {
      versionBuild = val;
      continue;
    }

    const match = /^(\d{3})(LowKey|HiKey|RootKey|LowSource|HiSource|Detune|Volume|Pan)$/.exec(
      key
    );
    if (match) {
      const zoneIdx = parseInt(match[1], 10);
      if (zoneIdx >= 0 && zoneIdx < 128) {
        const field = match[2];
        const target = entries[zoneIdx];
        if (field === 'LowKey') target.lowKey = val;
        else if (field === 'HiKey') target.hiKey = val;
        else if (field === 'RootKey') target.rootKey = val;
        else if (field === 'LowSource') target.lowSource = val;
        else if (field === 'HiSource') target.hiSource = val;
        else if (field === 'Detune') target.detune = val;
        else if (field === 'Volume') target.volume = val;
        else if (field === 'Pan') target.pan = val;
      }
    }
  }

  const activeZones: Zone[] = [];
  for (const e of entries) {
    const isUsed = e.lowSource > 0 || e.hiSource > 0 || e.hiKey > 0;
    if (!isUsed) continue;
    const srcLow = e.lowSource > 0 ? `${String(e.lowSource).padStart(6, '0')}.scape` : null;
    const srcHigh =
      e.hiSource > 0 && e.hiSource !== e.lowSource
        ? `${String(e.hiSource).padStart(6, '0')}.scape`
        : null;
    activeZones.push({
      id: `zone_${e.index + 1}`,
      lowKey: e.lowKey,
      rootKey: e.rootKey,
      highKey: e.hiKey,
      sampleLow: srcLow,
      sampleHigh: srcHigh,
      detune: e.detune,
      volume: e.volume,
      pan: e.pan,
    });
  }

  return {
    versionMajor,
    versionMinor,
    versionBuild,
    entries,
    activeZones,
  };
}

/**
 * Serializes `Zone[]` into the canonical 1027-line `map.script` (`KeyZoneData.formatForMapScript`).
 */
export function serializeCanonicalMapScript(
  zones: Zone[],
  version: { major: number; minor: number; build: number; lineEnding?: '\r\n' | '\n' } = {
    major: 0,
    minor: 9,
    build: 2,
  }
): string {
  const eol = version.lineEnding ?? '\r\n';
  const lines: string[] = [
    `MapVersionMajor\t${version.major}`,
    `MapVersionMinor\t${version.minor}`,
    `MapVersionBuild\t${version.build}`,
  ];

  // Build unique source map (1-based index)
  const sourceMap = new Map<string, number>();
  let nextSourceIdx = 1;
  for (const z of zones) {
    if (z.sampleLow && !sourceMap.has(z.sampleLow)) {
      sourceMap.set(z.sampleLow, nextSourceIdx++);
    }
    if (z.sampleHigh && !sourceMap.has(z.sampleHigh)) {
      sourceMap.set(z.sampleHigh, nextSourceIdx++);
    }
  }

  for (let i = 0; i < 128; i++) {
    const prefix = String(i).padStart(3, '0');
    const z = zones[i];
    if (z) {
      const lowSrc = z.sampleLow ? (sourceMap.get(z.sampleLow) ?? i + 1) : i + 1;
      const hiSrc = z.sampleHigh ? (sourceMap.get(z.sampleHigh) ?? lowSrc) : lowSrc;
      lines.push(`${prefix}LowKey\t${z.lowKey}`);
      lines.push(`${prefix}HiKey\t${z.highKey}`);
      lines.push(`${prefix}RootKey\t${z.rootKey}`);
      lines.push(`${prefix}LowSource\t${lowSrc}`);
      lines.push(`${prefix}HiSource\t${hiSrc}`);
      lines.push(`${prefix}Detune\t${Math.round(z.detune)}`);
      lines.push(`${prefix}Volume\t${Math.round(z.volume)}`);
      lines.push(`${prefix}Pan\t${Math.round(z.pan)}`);
    } else {
      lines.push(`${prefix}LowKey\t0`);
      lines.push(`${prefix}HiKey\t0`);
      lines.push(`${prefix}RootKey\t0`);
      lines.push(`${prefix}LowSource\t0`);
      lines.push(`${prefix}HiSource\t0`);
      lines.push(`${prefix}Detune\t0`);
      lines.push(`${prefix}Volume\t0`);
      lines.push(`${prefix}Pan\t0`);
    }
  }

  return lines.join(eol) + eol;
}

/**
 * Parses `MName` file bytes or string (max 11 ASCII characters, strips trailing NUL/whitespace).
 */
export function parseMName(input: Uint8Array | string): string {
  const raw = typeof input === 'string' ? input : readLatin1(input, 0, input.byteLength);
  return raw.replace(/[\x00\r\n]+$/g, '').slice(0, 11);
}

/**
 * Serializes a model name into `MName` bytes (ASCII up to 11 chars).
 */
export function serializeMName(name: string): Uint8Array {
  const clean = (name.trim() || 'UNTITLED').slice(0, 11);
  const out = new Uint8Array(clean.length);
  for (let i = 0; i < clean.length; i++) {
    out[i] = clean.charCodeAt(i) & 0x7f;
  }
  return out;
}

/**
 * Parses `NeuronDB/ModelNames` cache file (512 entries: `%03d\t%11s`).
 */
export function parseModelNamesCache(text: string): Map<number, string> {
  const map = new Map<number, string>();
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = /^(\d{3})\t(.*)$/.exec(trimmed);
    if (match) {
      const slot = parseInt(match[1], 10);
      const name = match[2].trim().slice(0, 11);
      if (slot >= 0 && slot < 512) {
        map.set(slot, name);
      }
    }
  }
  return map;
}

/**
 * Serializes `NeuronDB/ModelNames` cache file (512 slots `000..511`, default `--<empty>--`).
 */
export function serializeModelNamesCache(namesBySlot: ReadonlyMap<number, string>): string {
  const lines: string[] = [];
  for (let slot = 0; slot < 512; slot++) {
    const rawName = namesBySlot.get(slot) ?? '--<empty>--';
    const trimmed = rawName.slice(0, 11).padStart(11, ' ');
    lines.push(`${String(slot).padStart(3, '0')}\t${trimmed}`);
  }
  return lines.join('\r\n') + '\r\n';
}

// ── Frame & Curve Additive Resynthesis (`synth_frames.py` port) ──

const SINE_LUT_SIZE = 4096;
const SINE_LUT_MASK = SINE_LUT_SIZE - 1;
const SINE_LUT = (() => {
  const table = new Float32Array(SINE_LUT_SIZE);
  for (let i = 0; i < SINE_LUT_SIZE; i++) {
    table[i] = Math.sin((2.0 * Math.PI * i) / SINE_LUT_SIZE);
  }
  return table;
})();

/**
 * Deduplicates Welch-window sidelobe bins in a `ParsedSphereFrame` that point to the
 * same measured frequency (`p.frequency` in 0.5 Hz units) and returns the top distinct
 * partial peaks sorted by amplitude.
 */
function extractDistinctFramePeaks(
  frame: ParsedSphereFrame,
  maxPeaks = 40
): { freqHz: number; ampNorm: number; trackKey: number }[] {
  if (frame.isSilent || frame.partials.length === 0) return [];
  const gainScale = frame.blockGain > 0 ? frame.blockGain / 65535.0 : 1.0;
  const meanScale =
    frame.floats[0] > 0 ? Math.min(1.5, Math.max(0.1, frame.floats[0] * 2.2)) : 1.0;
  const frameEnv = gainScale * meanScale;
  if (frameEnv <= 1e-6) return [];

  // Since `frame.partials` is already sorted descending by amplitude, the first entry
  // encountered for a given `p.frequency` (or 1.5 Hz neighborhood) is the main-lobe peak.
  const byFreqKey = new Map<number, { freqHz: number; ampNorm: number; trackKey: number }>();

  for (const p of frame.partials) {
    if (p.amplitude <= 0) continue;
    const freqHz =
      p.frequency > 0 ? p.frequency * 0.5 : p.bin * (44100.0 / 2048.0);
    if (freqHz < 16.0 || freqHz > 20000.0) continue;

    // Group sidelobes that report the exact same half-Hz frequency (or within 1 Hz)
    const key = p.frequency > 0 ? p.frequency : Math.round(freqHz * 2);
    if (byFreqKey.has(key)) continue;

    const ampNorm = (p.amplitude / 65535.0) * frameEnv;
    if (ampNorm < 1e-4) continue;

    byFreqKey.set(key, {
      freqHz,
      ampNorm,
      trackKey: Math.max(1, Math.round(freqHz * 0.5)), // ~2 Hz phase continuity bucket
    });

    if (byFreqKey.size >= maxPeaks) break;
  }

  return Array.from(byFreqKey.values());
}

/**
 * Synthesizes a single `ParsedSphereFrame`'s partial bank into normalized Float32 PCM
 * at `44100 Hz` using true measured partial frequencies (`p.frequency * 0.5` Hz) and
 * dispersed initial phases so sidelobes do not collapse into a 21.5 Hz periodic impulse.
 */
export function resynthesizeSphereFrame(
  frame: ParsedSphereFrame,
  numSamples = 88200,
  sampleRate = 44100,
  targetRms = 0.2
): Float32Array {
  const out = new Float32Array(numSamples);
  const peaks = extractDistinctFramePeaks(frame, 48);
  if (peaks.length === 0) return out;

  const lutScale = SINE_LUT_SIZE / sampleRate;
  for (let k = 0; k < peaks.length; k++) {
    const pk = peaks[k];
    const amp = pk.ampNorm;
    const phaseStep = pk.freqHz * lutScale;
    // Golden-ratio phase dispersion prevents artificial impulse click at sample 0
    let phase = ((k * 0.61803398875) % 1.0) * SINE_LUT_SIZE;
    for (let i = 0; i < numSamples; i++) {
      out[i] += amp * SINE_LUT[phase & SINE_LUT_MASK];
      phase += phaseStep;
    }
  }

  let sumSq = 0.0;
  for (let i = 0; i < numSamples; i++) {
    sumSq += out[i] * out[i];
  }
  const rms = Math.sqrt(sumSq / Math.max(1, numSamples));
  if (rms > 1e-9 && targetRms > 0) {
    const scale = targetRms / rms;
    for (let i = 0; i < numSamples; i++) {
      out[i] *= scale;
    }
  }

  return out;
}

/**
 * Synthesizes the full temporal evolution of a `.sphere` + `.scape` pair:
 * - Renders all temporal frames (`frames[0 .. N-1]`) across time (`1024` samples per hop at 44.1 kHz)
 *   with continuous oscillator phase and linear amplitude envelope interpolation per frame.
 * - Mixes in the `.scape` (`csAN`) time-domain excitation/transient residual curve.
 */
export function resynthesizeNeuronModelSource(
  sphere: ParsedNeuronSphere | undefined,
  scape: ParsedNeuronScape | undefined,
  sampleRate = 44100,
  targetRms = 0.22
): Float32Array {
  if (!sphere || sphere.frames.length === 0) {
    if (scape) {
      return resynthesizeScapeCurve(scape, sampleRate * 2, targetRms);
    }
    return new Float32Array(sampleRate);
  }

  const hopSamples = 1024; // Canonical NASAnalysis frame stride in time domain (~23.22 ms)
  const frameCount = sphere.frames.length;
  const maxSamples = Math.min(
    Math.floor(sampleRate * 3.5),
    Math.max(hopSamples * 4, frameCount * hopSamples)
  );
  const activeFrames = Math.min(frameCount, Math.ceil(maxSamples / hopSamples));
  const totalSamples = activeFrames * hopSamples;
  const out = new Float32Array(totalSamples);

  const lutScale = SINE_LUT_SIZE / sampleRate;
  // Persistent phase accumulators keyed by ~2 Hz frequency bucket for click-free frame transitions
  const phaseByTrack = new Map<number, number>();

  for (let f = 0; f < activeFrames; f++) {
    const frame = sphere.frames[f];
    const peaks = extractDistinctFramePeaks(frame, 36);
    if (peaks.length === 0) continue;

    const sampleOffset = f * hopSamples;
    // Smooth fade-in on frame 0 to avoid DC/onset click
    const isFirstFrame = f === 0;
    const isLastFrame = f === activeFrames - 1;

    for (let k = 0; k < peaks.length; k++) {
      const pk = peaks[k];
      let phase = phaseByTrack.get(pk.trackKey);
      if (phase === undefined) {
        phase = (((pk.trackKey * 0.61803398875) % 1.0) * SINE_LUT_SIZE);
      }
      const phaseStep = pk.freqHz * lutScale;
      const baseAmp = pk.ampNorm;

      for (let s = 0; s < hopSamples; s++) {
        let env = baseAmp;
        if (isFirstFrame && s < 256) {
          env *= s / 256.0;
        } else if (isLastFrame && s > hopSamples - 512) {
          env *= (hopSamples - s) / 512.0;
        }
        out[sampleOffset + s] += env * SINE_LUT[phase & SINE_LUT_MASK];
        phase += phaseStep;
      }

      phaseByTrack.set(pk.trackKey, phase % SINE_LUT_SIZE);
    }
  }

  // Normalize the harmonic .sphere synthesis before adding the .scape transient residual
  let sumSq = 0.0;
  for (let i = 0; i < totalSamples; i++) {
    sumSq += out[i] * out[i];
  }
  const sphereRms = Math.sqrt(sumSq / Math.max(1, totalSamples));
  if (sphereRms > 1e-9 && targetRms > 0) {
    const scale = targetRms / sphereRms;
    for (let i = 0; i < totalSamples; i++) {
      out[i] *= scale;
    }
  }

  // Mix in the .scape time-domain excitation / transient residual at its natural int16 scale
  if (scape && scape.samples.length > 0) {
    const src = scape.samples;
    const activeLen =
      scape.header.length > 0 && scape.header.length <= src.length
        ? scape.header.length
        : src.length;
    const copyLen = Math.min(totalSamples, activeLen);
    for (let i = 0; i < copyLen; i++) {
      out[i] += (src[i] / 32768.0) * 0.85;
    }
  }

  // Soft peak-limit to [-0.95, +0.95] so loud transients never clip PCM16
  let peak = 0.0;
  for (let i = 0; i < totalSamples; i++) {
    const a = Math.abs(out[i]);
    if (a > peak) peak = a;
  }
  if (peak > 0.95) {
    const limitScale = 0.95 / peak;
    for (let i = 0; i < totalSamples; i++) {
      out[i] *= limitScale;
    }
  }

  return out;
}

/**
 * Synthesizes a `ParsedNeuronScape`'s `int16` excitation curve with loop support.
 */
export function resynthesizeScapeCurve(
  scape: ParsedNeuronScape,
  numSamples = 88200,
  targetRms = 0.2
): Float32Array {
  const out = new Float32Array(numSamples);
  const src = scape.samples;
  if (src.length === 0) return out;

  const activeLen =
    scape.header.length > 0 && scape.header.length <= src.length
      ? scape.header.length
      : src.length;
  const loopStart = Math.max(0, Math.min(activeLen - 1, scape.header.loopStart));
  const loopEnd =
    scape.header.loopEnd > loopStart && scape.header.loopEnd <= activeLen
      ? scape.header.loopEnd
      : activeLen;
  const loopSpan = Math.max(1, loopEnd - loopStart);

  for (let i = 0; i < numSamples; i++) {
    const idx = i < loopEnd ? i : loopStart + ((i - loopStart) % loopSpan);
    out[i] = src[idx] / 32768.0;
  }

  let sumSq = 0.0;
  for (let i = 0; i < numSamples; i++) {
    sumSq += out[i] * out[i];
  }
  const rms = Math.sqrt(sumSq / Math.max(1, numSamples));
  if (rms > 1e-9 && targetRms > 0) {
    const scale = targetRms / rms;
    for (let i = 0; i < numSamples; i++) {
      out[i] *= scale;
    }
  }

  return out;
}

// ── Bridge: Legacy .model -> Modern .neuronikmodel v2.1 ──

/**
 * Converts a parsed Legacy Neuron `.model` into the Modern `.neuronikmodel` v2.1 JSON
 * format so factory or user `.model` directories can be used directly in the modern synth.
 */
export function convertLegacyModelToModern(model: ParsedNeuronModel): string {
  const zonesPayload: Record<string, unknown>[] = [];

  for (const zone of model.mapScript.activeZones) {
    const srcIdx =
      parseInt((zone.sampleLow ?? '000001').replace(/\D+/g, ''), 10) || 1;
    const scape = model.scapes.get(srcIdx);
    const sphere = model.spheres.get(srcIdx);

    const resolution = sphere?.header.resolution ?? scape?.header.resolution ?? 100;
    const f0Hz = resolution > 0 ? 44100.0 / resolution : 440.0;

    const framesData: {
      weight: number;
      f0Hz: number;
      amplitudes: number[];
      frequencyOffsets: number[];
    }[] = [];

    if (sphere && sphere.frames.length > 0) {
      const step = Math.max(1, Math.floor(sphere.frames.length / 8));
      for (let f = 0; f < sphere.frames.length && framesData.length < 8; f += step) {
        const sf = sphere.frames[f];
        const amps = new Array<number>(64).fill(0.0);
        const offs = new Array<number>(64).fill(0.0);

        for (const p of sf.partials) {
          if (p.frequency <= 0 || p.amplitude <= 0) continue;
          // FUN_10007e00 stores partial frequency in 0.5 Hz units: round(freqHz * 2.0 + 0.5)
          const freqHz = p.frequency * 0.5;
          const harmIdx = Math.round(freqHz / f0Hz) - 1;
          if (harmIdx >= 0 && harmIdx < 64) {
            const normAmp = p.amplitude / 65535.0;
            if (normAmp > amps[harmIdx]) {
              amps[harmIdx] = normAmp;
              offs[harmIdx] = freqHz - (harmIdx + 1) * f0Hz;
            }
          }
        }

        framesData.push({
          weight: 1.0,
          f0Hz,
          amplitudes: amps,
          frequencyOffsets: offs,
        });
      }
    }

    if (framesData.length === 0) {
      framesData.push({
        weight: 1.0,
        f0Hz,
        amplitudes: new Array<number>(64).fill(0.0),
        frequencyOffsets: new Array<number>(64).fill(0.0),
      });
    }

    zonesPayload.push({
      zoneId: zone.id,
      lowKey: zone.lowKey,
      rootKey: zone.rootKey,
      highKey: zone.highKey,
      detune: zone.detune,
      volume: zone.volume,
      pan: zone.pan,
      f0Hz: Number(f0Hz.toFixed(3)),
      parameterSet: sphere?.header.parameterSet ?? 0,
      recursionDepth: sphere?.header.stickModes ?? 1,
      scapeNames: scape?.names ?? [],
      sphereNames: sphere?.names ?? [],
      frames: framesData,
    });
  }

  const firstZone = zonesPayload[0] as
    | {
        f0Hz: number;
        frames: {
          weight: number;
          f0Hz: number;
          amplitudes: number[];
          frequencyOffsets: number[];
        }[];
      }
    | undefined;

  const rootDoc = {
    version: 2,
    schemaVersion: '2.1',
    targetFormat: 'modern-neural',
    name: model.name,
    slot: model.slot,
    description: `Imported from Legacy Neuron Model #${String(model.slot).padStart(3, '0')} (${model.name})`,
    partialCount: 64,
    frameSpanHz: firstZone?.f0Hz ?? 440.0,
    amplitudes: firstZone?.frames[0]?.amplitudes ?? new Array<number>(64).fill(0.0),
    frequencyOffsets:
      firstZone?.frames[0]?.frequencyOffsets ?? new Array<number>(64).fill(0.0),
    layers: [
      {
        name: 'imported-sphere',
        weight: 1.0,
        frames: firstZone?.frames ?? [],
      },
    ],
    zones: zonesPayload,
  };

  return JSON.stringify(rootDoc, null, 2);
}

// ── Phase 3: Model Directory / ZIP Package Builder & Reader ──

export interface ModelExportPackageOptions {
  slot: number;
  name: string;
  zones: Zone[];
  targetFormat?: TargetFormat;
  zoneBinaries?: { scapeBinary: Uint8Array; sphereBinary: Uint8Array }[];
  mapScriptVersion?: { major: number; minor: number; build: number; lineEnding?: '\r\n' | '\n' };
  neuronikModelJson?: string;
  /** Original lossless audio buffers to preserve in Extended mode (`Samples/<filename>`) for future re-processing */
  sourceSamples?: { name: string; data: Uint8Array }[];
  /** Optional safe parameter overrides for `Sounds/<NNN>.sound/sound.script` (ADSR, Filter, LFO) */
  soundParameterOverrides?: Record<string, number>;
}

/**
 * Packages a generated model into a standard PKZIP archive containing:
 *   - For `'legacy-neuron'` or `'dual'`:
 *     - `Models/<NNN>.model/MName`
 *     - `Models/<NNN>.model/map.script` (1027 lines)
 *     - `Models/<NNN>.model/%06d.scape` & `%06d.sphere`
 *     - `Sounds/<NNN>.sound/sound.script` (445 parameters) & `sound.stickrec`
 *   - For `'modern-neural'` or `'dual'`:
 *     - `Modern/<NNN>_<Name>.neuronikmodel` (v2.1 JSON)
 */
export function buildModelExportZip(options: ModelExportPackageOptions): Uint8Array {
  const slotStr = String(Math.max(0, Math.min(511, options.slot))).padStart(3, '0');
  const fullName = options.name.trim() || 'UNTITLED';
  const legacyMName = fullName.slice(0, 11);
  const target = options.targetFormat ?? 'dual';
  const entries: ZipEntryInput[] = [];

  if (target === 'dual' || target === 'legacy-neuron') {
    const modelPrefix = `Models/${slotStr}.model`;
    entries.push({
      path: `${modelPrefix}/MName`,
      data: serializeMName(legacyMName),
    });
    entries.push({
      path: `${modelPrefix}/map.script`,
      data: serializeCanonicalMapScript(options.zones, options.mapScriptVersion),
    });

    const binaries = options.zoneBinaries ?? [];
    for (let i = 0; i < binaries.length; i++) {
      const srcPrefix = String(i + 1).padStart(6, '0');
      entries.push({
        path: `${modelPrefix}/${srcPrefix}.scape`,
        data: binaries[i].scapeBinary,
      });
      entries.push({
        path: `${modelPrefix}/${srcPrefix}.sphere`,
        data: binaries[i].sphereBinary,
      });
    }

    const soundPrefix = `Sounds/${slotStr}.sound`;
    const soundPreset = createSoundPresetForModel({
      name: fullName.slice(0, 16),
      r1ModelIndex: options.slot,
    });
    if (options.soundParameterOverrides) {
      for (const [k, v] of Object.entries(options.soundParameterOverrides)) {
        if (typeof v === 'number' && Number.isFinite(v)) {
          soundPreset.values.set(k, v);
        }
      }
    }
    entries.push({
      path: `${soundPrefix}/sound.script`,
      data: serializeSoundScript(soundPreset),
    });
    entries.push({
      path: `${soundPrefix}/sound.stickrec`,
      data: serializeStickRec([]),
    });
  }

  if (target === 'dual' || target === 'modern-neural') {
    const safeFileSlug = fullName.replace(/[^A-Za-z0-9_-]+/g, '_') || 'Model';
    const jsonText =
      options.neuronikModelJson ??
      JSON.stringify(
        {
          version: 2,
          schemaVersion: '2.1',
          targetFormat: 'modern-neural',
          name: fullName,
          slot: options.slot,
          zoneCount: options.zones.length,
        },
        null,
        2
      );
    entries.push({
      path: `Modern/${slotStr}_${safeFileSlug}.nmmodel`,
      data: jsonText,
    });

    if (options.sourceSamples && options.sourceSamples.length > 0) {
      for (const sample of options.sourceSamples) {
        const cleanSampleName = sample.name.split(/[\\/]/).pop() ?? sample.name;
        entries.push({
          path: `Samples/${cleanSampleName}`,
          data: sample.data,
        });
      }
    }
  }

  return createZipArchive(entries);
}

/**
 * Parses a collection of files from a `<NNN>.model` directory or a `.zip` archive
 * into a structured `ParsedNeuronModel`.
 */
export function parseModelFileSet(
  inputFiles: readonly { name: string; data: Uint8Array }[],
  defaultSlot = 0
): ParsedNeuronModel {
  // Expand any .zip files transparently
  const expanded: { name: string; data: Uint8Array }[] = [];
  for (const f of inputFiles) {
    if (f.name.toLowerCase().endsWith('.zip')) {
      const unzipped = parseZipArchive(f.data);
      for (const u of unzipped) {
        expanded.push({ name: u.path, data: u.data });
      }
    } else {
      expanded.push(f);
    }
  }

  let slot = defaultSlot;
  let name = `Model${String(defaultSlot).padStart(3, '0')}`;
  let mapScript: ParsedMapScript = parseMapScript('');
  const scapes = new Map<number, ParsedNeuronScape>();
  const spheres = new Map<number, ParsedNeuronSphere>();
  const scapeBinaries = new Map<number, Uint8Array>();
  const sphereBinaries = new Map<number, Uint8Array>();
  const embeddedSamples = new Map<string, Uint8Array>();
  let neuronikModelJson: string | undefined;
  let inferredParameterSet: number | undefined;
  let inferredComplexity: number | undefined;
  let hasMNameOrMapScript = false;
  let jsonZones: Zone[] = [];

  for (const f of expanded) {
    const normPath = f.name.replace(/\\/g, '/');
    if (normPath.includes('__MACOSX/')) continue;
    const base = normPath.split('/').pop() ?? normPath;
    if (base.startsWith('._') || base === '.DS_Store') continue;

    const slotMatch = /(\d{3})\.model/i.exec(normPath);
    if (slotMatch) {
      slot = parseInt(slotMatch[1], 10);
    }

    const lower = base.toLowerCase();

    if (lower === 'mname') {
      name = parseMName(f.data);
      hasMNameOrMapScript = true;
    } else if (lower === 'map.script') {
      const text = readLatin1(f.data, 0, f.data.byteLength);
      mapScript = parseMapScript(text);
      hasMNameOrMapScript = true;
    } else if (lower.endsWith('.scape')) {
      const idxMatch = /(\d+)\.scape$/i.exec(base);
      const srcIdx = idxMatch ? parseInt(idxMatch[1], 10) : scapes.size + 1;
      scapes.set(srcIdx, parseNeuronScape(f.data));
      scapeBinaries.set(srcIdx, f.data);
    } else if (lower.endsWith('.sphere')) {
      const idxMatch = /(\d+)\.sphere$/i.exec(base);
      const srcIdx = idxMatch ? parseInt(idxMatch[1], 10) : spheres.size + 1;
      spheres.set(srcIdx, parseNeuronSphere(f.data));
      sphereBinaries.set(srcIdx, f.data);
    } else if (lower.endsWith('.wav') || lower.endsWith('.aif') || lower.endsWith('.aiff')) {
      embeddedSamples.set(base, f.data);
    } else if (lower.endsWith('.nmmodel') || lower.endsWith('.neuronikmodel')) {
      neuronikModelJson = new TextDecoder().decode(f.data);
      try {
        const parsedJson = JSON.parse(neuronikModelJson) as {
          name?: string;
          slot?: number;
          parameterSet?: number;
          complexity?: number;
          zones?: {
            zoneId?: string;
            lowKey?: number;
            rootKey?: number;
            highKey?: number;
            sampleName?: string;
            sampleHigh?: string | null;
            detune?: number;
            volume?: number;
            pan?: number;
            parameterSet?: number;
            recursionDepth?: number;
          }[];
        };
        if (
          parsedJson.name &&
          (name.startsWith('Model') || parsedJson.name.startsWith(name))
        ) {
          name = parsedJson.name;
        }
        if (typeof parsedJson.slot === 'number') {
          slot = parsedJson.slot;
        }
        if (typeof parsedJson.parameterSet === 'number') {
          inferredParameterSet = parsedJson.parameterSet;
        }
        if (typeof parsedJson.complexity === 'number') {
          inferredComplexity = parsedJson.complexity;
        }
        if (Array.isArray(parsedJson.zones) && parsedJson.zones.length > 0) {
          jsonZones = parsedJson.zones.map((z, idx) => ({
            id: z.zoneId ?? `zone_${idx + 1}`,
            lowKey: typeof z.lowKey === 'number' ? z.lowKey : 0,
            rootKey: typeof z.rootKey === 'number' ? z.rootKey : 60,
            highKey: typeof z.highKey === 'number' ? z.highKey : 127,
            sampleLow: z.sampleName ?? `${String(idx + 1).padStart(6, '0')}.scape`,
            sampleHigh: z.sampleHigh ?? null,
            detune: typeof z.detune === 'number' ? z.detune : 0,
            volume: typeof z.volume === 'number' ? z.volume : 0,
            pan: typeof z.pan === 'number' ? z.pan : 0,
          }));
          if (
            inferredParameterSet === undefined &&
            typeof parsedJson.zones[0]?.parameterSet === 'number'
          ) {
            inferredParameterSet = parsedJson.zones[0].parameterSet;
          }
        }
      } catch {
        // Ignore JSON parse errors
      }
    }
  }

  // If no map.script was provided but .nmmodel JSON had zone definitions, use those
  if (mapScript.activeZones.length === 0 && jsonZones.length > 0) {
    mapScript = parseMapScript(serializeCanonicalMapScript(jsonZones));
    // Preserve explicit sample names if embeddedSamples exist
    if (embeddedSamples.size > 0) {
      mapScript.activeZones = jsonZones;
    }
  }

  // If no map.script was provided but scape/sphere files exist, synthesize contiguous zones
  if (mapScript.activeZones.length === 0 && (scapes.size > 0 || spheres.size > 0)) {
    const srcIndices = Array.from(new Set([...scapes.keys(), ...spheres.keys()])).sort(
      (a, b) => a - b
    );
    const count = srcIndices.length;
    const synthZones: Zone[] = [];
    for (let i = 0; i < count; i++) {
      const lowKey = Math.round((i * 128) / count);
      const highKey = i === count - 1 ? 127 : Math.round(((i + 1) * 128) / count) - 1;
      const rootKey = Math.round((lowKey + highKey) / 2);
      const srcStr = `${String(srcIndices[i]).padStart(6, '0')}.scape`;
      synthZones.push({
        id: `zone_${i + 1}`,
        lowKey,
        rootKey,
        highKey,
        sampleLow: srcStr,
        sampleHigh: null,
        detune: 0,
        volume: 0,
        pan: 0,
      });
    }
    mapScript = parseMapScript(serializeCanonicalMapScript(synthZones));
  }

  return {
    slot,
    name,
    mapScript,
    scapes,
    spheres,
    scapeBinaries,
    sphereBinaries,
    neuronikModelJson,
    embeddedSamples,
    inferredParameterSet,
    inferredComplexity,
    hasMNameOrMapScript,
  };
}

export {
  serializeNeuronScapeBinary,
  serializeNeuronSphereBinary,
  generateMapScript,
  type ScapeSphereFrame,
  type ProcessConfig,
};
