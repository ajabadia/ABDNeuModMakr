// ─────────────────────────────────────────────────────────
// ABDShared / ABDNeuModMakr — Isla Instruments S2400 Format (.s24 in .zip)
//
// Clean-room TypeScript parser & writer for Isla Instruments S2400
// kits and multisamples (binary TLV format with FIELD_* records).
// Contrasted with ConvertWithMoss S2400*.
//
// Binary Records:
// Type (uint32 LE), Length (uint32 LE), Data (bytes)
//
// Fields:
// - VERSION (1): uint32 = 1
// - TRACK_COUNT (2): uint32 (number of pads/zones, max 32)
// - TRACK_NAME (3): string
// - TRACK_GAIN_DB (4): int32
// - CHOKE_GROUP (9): uint32
// - GATE_MODE (17): uint32
// - SLICE_START / SLICE_END (19/20): uint32
// ─────────────────────────────────────────────────────────

import type { ExtendedRegion, SynthArticulationConfig } from './SamplerTypes.ts';
import { createDefaultArticulation } from './ExtendedAdapter.ts';
import { indexZipArchive, extractZipEntry } from '../NeuronFormats/ZipArchive.ts';

export const S2400_FIELD_VERSION = 1;
export const S2400_FIELD_TRACK_COUNT = 2;
export const S2400_FIELD_HEADER_MARKER = 56;
export const S2400_FIELD_TRACK_NAME = 3;
export const S2400_FIELD_TRACK_GAIN_DB = 4;
export const S2400_FIELD_CHOKE_GROUP = 9;
export const S2400_FIELD_GATE_MODE = 17;
export const S2400_FIELD_SLICE_START = 19;
export const S2400_FIELD_SLICE_END = 20;

export function isS2400KitBuffer(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 16) return false;
  const view = new DataView(buffer);
  return view.getUint32(0, true) === S2400_FIELD_VERSION && view.getUint32(4, true) === 4;
}

export function parseS2400Kit(
  buffer: ArrayBuffer,
  sampleNames: string[]
): {
  presetName: string;
  regions: ExtendedRegion[];
  articulation: SynthArticulationConfig;
} {
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);
  const decoder = new TextDecoder('ascii');

  let pos = 0;
  const trackNames: string[] = [];
  const trackGains: number[] = [];
  const chokeGroups: number[] = [];

  while (pos + 8 <= buffer.byteLength) {
    const fieldId = view.getUint32(pos, true);
    const fieldLen = view.getUint32(pos + 4, true);
    pos += 8;
    if (pos + fieldLen > buffer.byteLength) break;

    if (fieldId === S2400_FIELD_TRACK_NAME) {
      const name = decoder.decode(u8.subarray(pos, pos + fieldLen)).replace(/\0.*$/g, '').trim();
      trackNames.push(name);
    } else if (fieldId === S2400_FIELD_TRACK_GAIN_DB) {
      trackGains.push(view.getInt32(pos, true));
    } else if (fieldId === S2400_FIELD_CHOKE_GROUP) {
      chokeGroups.push(view.getUint32(pos, true));
    }

    pos += fieldLen;
  }

  const regions: ExtendedRegion[] = [];
  const count = trackNames.length > 0 ? trackNames.length : sampleNames.length;

  for (let i = 0; i < count; i++) {
    const tName = trackNames[i] || `Track_${i + 1}`;
    const cleanSample = sampleNames.find((s) => s.toLowerCase().startsWith(tName.toLowerCase())) || `${tName}.wav`;
    const note = Math.min(127, 36 + i);

    regions.push({
      id: `s2400_r_${i + 1}`,
      sampleName: cleanSample,
      rootKey: note,
      lowKey: note,
      highKey: note,
      lowVel: 1,
      highVel: 127,
      volume: trackGains[i] ?? 0,
      pan: 0,
      detune: 0,
      pitchKeytrack: 0,
      trigger: 'attack',
      keyFadeIn: 0,
      keyFadeOut: 0,
      velFadeIn: 0,
      velFadeOut: 0,
      fadeCurve: 'equal-power',
      loopMode: 'no_loop',
      loopStart: 0,
      loopEnd: 0,
      loopCrossfadeMs: 0,
      muteGroup: chokeGroups[i] && chokeGroups[i] > 0 ? chokeGroups[i] : undefined,
    });
  }

  return {
    presetName: 'S2400 Kit',
    regions,
    articulation: createDefaultArticulation(),
  };
}

export function buildS2400KitBinary(options: {
  presetName: string;
  regions: ExtendedRegion[];
}): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];

  const addRecord = (id: number, data: Uint8Array) => {
    const h = new Uint8Array(8);
    const hv = new DataView(h.buffer);
    hv.setUint32(0, id, true);
    hv.setUint32(4, data.byteLength, true);
    chunks.push(h);
    chunks.push(data);
  };

  const addU32 = (id: number, val: number) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, val, true);
    addRecord(id, b);
  };

  const addI32 = (id: number, val: number) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setInt32(0, val, true);
    addRecord(id, b);
  };

  const addString = (id: number, str: string) => {
    const b = encoder.encode(str + '\0');
    addRecord(id, b);
  };

  addU32(S2400_FIELD_VERSION, 1);
  addU32(S2400_FIELD_TRACK_COUNT, options.regions.length);
  addU32(S2400_FIELD_HEADER_MARKER, 1);

  for (let i = 0; i < options.regions.length; i++) {
    const r = options.regions[i];
    const baseName = r.sampleName.replace(/\.wav$/i, '');
    addString(S2400_FIELD_TRACK_NAME, baseName);
    addI32(S2400_FIELD_TRACK_GAIN_DB, Math.round(r.volume ?? 0));
    addU32(S2400_FIELD_CHOKE_GROUP, r.muteGroup ?? 0);
    addU32(S2400_FIELD_GATE_MODE, 0);
  }

  const totalLen = chunks.reduce((acc, c) => acc + c.byteLength, 0);
  const out = new Uint8Array(totalLen);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.byteLength;
  }

  return out;
}

export function importS2400Zip(zipBuffer: ArrayBuffer): {
  presetName: string;
  regions: ExtendedRegion[];
  articulation: SynthArticulationConfig;
  audioBuffers: Map<string, ArrayBuffer>;
} {
  const zipBytes = new Uint8Array(zipBuffer);
  const central = indexZipArchive(zipBytes);
  const audioBuffers = new Map<string, ArrayBuffer>();
  const sampleNames: string[] = [];
  let kitEntry: (typeof central)[0] | undefined;

  for (const entry of central) {
    const low = entry.path.toLowerCase();
    if (low.endsWith('.kit') || low.endsWith('.s24')) {
      kitEntry = entry;
    } else if (low.endsWith('.wav') || low.endsWith('.flac')) {
      const data = extractZipEntry(zipBytes, entry);
      const name = entry.path.split('/').pop() || entry.path;
      sampleNames.push(name);
      audioBuffers.set(name, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    }
  }

  if (!kitEntry) {
    throw new Error('No .kit or .s24 file found in package');
  }

  const kitBytes = extractZipEntry(zipBytes, kitEntry);
  const parsed = parseS2400Kit(
    kitBytes.buffer.slice(kitBytes.byteOffset, kitBytes.byteOffset + kitBytes.byteLength),
    sampleNames
  );

  return {
    presetName: kitEntry.path.split('/').pop()?.replace(/\.(kit|s24)$/i, '') || parsed.presetName,
    regions: parsed.regions,
    articulation: parsed.articulation,
    audioBuffers,
  };
}
