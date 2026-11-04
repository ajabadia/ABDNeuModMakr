// ─────────────────────────────────────────────────────────
// ABDShared / ABDNeuModMakr — Roland Zen-Core / SP-404MKII / MC-707 Format (.svz in .zip)
//
// Clean-room TypeScript parser & writer for Roland Zen-Core format
// (.svz files used across SP-404 MKII, MC-707, MC-101, FANTOM, JUPITER-X).
// Contrasted with ConvertWithMoss ZenCore*.
//
// Structure:
// - Header: 'SVZ\0' (4 bytes)
// - Model / Bank type (uint32 LE)
// - Tone records (WAV references, lowKey, highKey, rootKey, fineTune)
// ─────────────────────────────────────────────────────────

import type { ExtendedRegion, SynthArticulationConfig } from './SamplerTypes.ts';
import { createDefaultArticulation } from './ExtendedAdapter.ts';
import { indexZipArchive, extractZipEntry } from '../NeuronFormats/ZipArchive.ts';
import { toArrayBuffer } from './BytesUtil.ts';

export const ZENCORE_SVZ_MAGIC = 'SVZ\0';

export function isZenCoreSvzBuffer(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 8) return false;
  const u8 = new Uint8Array(buffer, 0, 4);
  return String.fromCharCode(...u8) === ZENCORE_SVZ_MAGIC;
}

export function parseZenCoreSvz(
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

  const nameBytes = u8.subarray(8, 40);
  const presetName = decoder.decode(nameBytes).replace(/\0.*$/g, '').trim() || 'ZenCoreTone';

  const numZones = view.getUint32(40, true);
  let pos = 44;
  const regions: ExtendedRegion[] = [];

  for (let i = 0; i < numZones && pos + 40 <= buffer.byteLength; i++) {
    const sName = decoder.decode(u8.subarray(pos, pos + 32)).replace(/\0.*$/g, '').trim();
    const rootKey = view.getUint8(pos + 32);
    const lowKey = view.getUint8(pos + 33);
    const highKey = view.getUint8(pos + 34);
    const tuneCents = view.getInt8(pos + 35);
    pos += 40;

    const cleanSample = sampleNames.find((s) => s.toLowerCase().startsWith(sName.toLowerCase())) || `${sName}.wav`;

    regions.push({
      id: `svz_r_${i + 1}`,
      sampleName: cleanSample,
      rootKey,
      lowKey,
      highKey,
      lowVel: 1,
      highVel: 127,
      volume: 0,
      pan: 0,
      detune: tuneCents,
      pitchKeytrack: 100,
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
    });
  }

  // Fallback mapping if binary was custom/empty
  if (regions.length === 0 && sampleNames.length > 0) {
    for (let i = 0; i < sampleNames.length; i++) {
      const s = sampleNames[i];
      const note = Math.min(127, 36 + i * 2);
      regions.push({
        id: `svz_r_${i + 1}`,
        sampleName: s,
        rootKey: note,
        lowKey: note,
        highKey: note + 1,
        lowVel: 1,
        highVel: 127,
        volume: 0,
        pan: 0,
        detune: 0,
        pitchKeytrack: 100,
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
      });
    }
  }

  return {
    presetName,
    regions,
    articulation: createDefaultArticulation(),
  };
}

export function buildZenCoreSvzBinary(options: {
  presetName: string;
  regions: ExtendedRegion[];
}): Uint8Array {
  const encoder = new TextEncoder();
  const totalSize = 44 + options.regions.length * 40;
  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);

  out.set(encoder.encode(ZENCORE_SVZ_MAGIC), 0);
  view.setUint32(4, 1, true); // format version

  const nameBytes = encoder.encode(options.presetName.slice(0, 31));
  out.set(nameBytes, 8);

  view.setUint32(40, options.regions.length, true);

  let p = 44;
  for (const r of options.regions) {
    const sName = r.sampleName.replace(/\.wav$/i, '').slice(0, 31);
    out.set(encoder.encode(sName), p);
    view.setUint8(p + 32, r.rootKey);
    view.setUint8(p + 33, r.lowKey);
    view.setUint8(p + 34, r.highKey);
    view.setInt8(p + 35, Math.round((r.detune ?? 0) / 100));
    p += 40;
  }

  return out;
}

export function importZenCoreZip(zipBuffer: ArrayBuffer): {
  presetName: string;
  regions: ExtendedRegion[];
  articulation: SynthArticulationConfig;
  audioBuffers: Map<string, ArrayBuffer>;
} {
  const zipBytes = new Uint8Array(zipBuffer);
  const central = indexZipArchive(zipBytes);
  const audioBuffers = new Map<string, ArrayBuffer>();
  const sampleNames: string[] = [];
  let svzEntry: (typeof central)[0] | undefined;

  for (const entry of central) {
    const low = entry.path.toLowerCase();
    if (low.endsWith('.svz')) {
      svzEntry = entry;
    } else if (low.endsWith('.wav') || low.endsWith('.flac')) {
      const data = extractZipEntry(zipBytes, entry);
      const name = entry.path.split('/').pop() || entry.path;
      sampleNames.push(name);
      audioBuffers.set(name, toArrayBuffer(data));
    }
  }

  if (!svzEntry) {
    throw new Error('No .svz found in package');
  }

  const sBytes = extractZipEntry(zipBytes, svzEntry);
  const parsed = parseZenCoreSvz(
    toArrayBuffer(sBytes),
    sampleNames
  );

  return {
    presetName: svzEntry.path.split('/').pop()?.replace(/\.svz$/i, '') || parsed.presetName,
    regions: parsed.regions,
    articulation: parsed.articulation,
    audioBuffers,
  };
}
