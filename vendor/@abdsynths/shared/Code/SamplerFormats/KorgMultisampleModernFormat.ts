// ─────────────────────────────────────────────────────────
// ABDShared / ABDNeuModMakr — Korg Multisample Modern Format (.korgmultisample)
//
// Clean-room TypeScript parser & writer for Korg modern multisample files
// (.korgmultisample binary files for Kronos, Nautilus, WaveState, modwave).
// Contrasted with ConvertWithMoss Korgmultisample*.
//
// Structure:
// - Header: 0x00000001 (uint32 BE), length, time, multisample name
// - Sample blocks: sample name, rootKey, tune, start/stop, key zones
// ─────────────────────────────────────────────────────────

import type { ExtendedRegion, SynthArticulationConfig } from './SamplerTypes.ts';
import { createDefaultArticulation } from './ExtendedAdapter.ts';
import { indexZipArchive, extractZipEntry } from '../NeuronFormats/ZipArchive.ts';
import { toArrayBuffer } from './BytesUtil.ts';

export const KORG_MULTISAMPLE_MAGIC = 0x00000001;

export function isKorgMultisampleBuffer(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 16) return false;
  const view = new DataView(buffer);
  return view.getUint32(0, false) === KORG_MULTISAMPLE_MAGIC;
}

export function parseKorgMultisample(
  buffer: ArrayBuffer,
  sampleNames: string[]
): {
  presetName: string;
  regions: ExtendedRegion[];
  articulation: SynthArticulationConfig;
} {
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);
  const decoder = new TextDecoder('utf-8');

  // Skip header (magic 4, length 4, time 8)
  let pos = 16;
  const nameLen = view.getUint32(pos, false);
  pos += 4;
  const presetName = decoder.decode(u8.subarray(pos, pos + nameLen)).replace(/\0.*$/g, '').trim() || 'KorgMultisample';
  pos += nameLen;

  const regions: ExtendedRegion[] = [];
  let regIdx = 0;

  while (pos + 20 <= buffer.byteLength) {
    const sNameLen = view.getUint32(pos, false);
    pos += 4;
    if (pos + sNameLen > buffer.byteLength) break;
    const sName = decoder.decode(u8.subarray(pos, pos + sNameLen)).replace(/\0.*$/g, '').trim();
    pos += sNameLen;

    if (pos + 16 > buffer.byteLength) break;
    const rootKey = view.getUint8(pos);
    const lowKey = view.getUint8(pos + 1);
    const highKey = view.getUint8(pos + 2);
    const tuneCents = view.getInt16(pos + 3, false);
    pos += 16;

    regIdx++;
    const cleanSample = sampleNames.find((s) => s.toLowerCase().startsWith(sName.toLowerCase())) || `${sName}.wav`;

    regions.push({
      id: `korg_ms_${regIdx}`,
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

  // Fallback if binary blocks had different offsets: map sampleNames evenly
  if (regions.length === 0 && sampleNames.length > 0) {
    for (let i = 0; i < sampleNames.length; i++) {
      const s = sampleNames[i];
      const note = Math.min(127, 36 + i * 2);
      regions.push({
        id: `korg_ms_${i + 1}`,
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

export function buildKorgMultisampleBinary(options: {
  presetName: string;
  regions: ExtendedRegion[];
}): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];

  // Magic 4, length placeholder 4, time 8
  const header = new Uint8Array(16);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, KORG_MULTISAMPLE_MAGIC, false);
  hv.setUint32(4, 0, false); // placeholder
  chunks.push(header);

  // Preset name (length + chars)
  const nameBytes = encoder.encode(options.presetName);
  const nameHeader = new Uint8Array(4);
  new DataView(nameHeader.buffer).setUint32(0, nameBytes.byteLength, false);
  chunks.push(nameHeader);
  chunks.push(nameBytes);

  for (const r of options.regions) {
    const sName = r.sampleName.replace(/\.wav$/i, '');
    const sBytes = encoder.encode(sName);
    const sh = new Uint8Array(4);
    new DataView(sh.buffer).setUint32(0, sBytes.byteLength, false);
    chunks.push(sh);
    chunks.push(sBytes);

    const b = new Uint8Array(16);
    const bv = new DataView(b.buffer);
    bv.setUint8(0, r.rootKey);
    bv.setUint8(1, r.lowKey);
    bv.setUint8(2, r.highKey);
    bv.setInt16(3, r.detune ?? 0, false);
    chunks.push(b);
  }

  const totalLen = chunks.reduce((acc, c) => acc + c.byteLength, 0);
  const out = new Uint8Array(totalLen);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.byteLength;
  }

  new DataView(out.buffer).setUint32(4, totalLen - 8, false);
  return out;
}

export function importKorgMultisampleZip(zipBuffer: ArrayBuffer): {
  presetName: string;
  regions: ExtendedRegion[];
  articulation: SynthArticulationConfig;
  audioBuffers: Map<string, ArrayBuffer>;
} {
  const zipBytes = new Uint8Array(zipBuffer);
  const central = indexZipArchive(zipBytes);
  const audioBuffers = new Map<string, ArrayBuffer>();
  const sampleNames: string[] = [];
  let korgEntry: (typeof central)[0] | undefined;

  for (const entry of central) {
    const low = entry.path.toLowerCase();
    if (low.endsWith('.korgmultisample')) {
      korgEntry = entry;
    } else if (low.endsWith('.wav') || low.endsWith('.flac')) {
      const data = extractZipEntry(zipBytes, entry);
      const name = entry.path.split('/').pop() || entry.path;
      sampleNames.push(name);
      audioBuffers.set(name, toArrayBuffer(data));
    }
  }

  if (!korgEntry) {
    throw new Error('No .korgmultisample found in package');
  }

  const kBytes = extractZipEntry(zipBytes, korgEntry);
  const parsed = parseKorgMultisample(
    toArrayBuffer(kBytes),
    sampleNames
  );

  return {
    presetName: korgEntry.path.split('/').pop()?.replace(/\.korgmultisample$/i, '') || parsed.presetName,
    regions: parsed.regions,
    articulation: parsed.articulation,
    audioBuffers,
  };
}
