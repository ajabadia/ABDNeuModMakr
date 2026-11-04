// ─────────────────────────────────────────────────────────
// ABDShared / ABDNeuModMakr — Waldorf Quantum / Iridium Format (.qpat)
//
// Clean-room TypeScript parser & writer for Waldorf Quantum / Iridium
// patch containers (.qpat). Contrasted with ConvertWithMoss WaldorfQpat*.
//
// Structure:
// - Header (512 bytes):
//   - magic: uint32 LE (3402932 = 0x0033ECB4)
//   - version: uint32 LE
//   - name: 32 bytes ASCII
//   - bank: 32 bytes ASCII
//   - ...
//   - numParams: uint16 LE at offset 0x1A0
//   - resource headers (16 * 16 bytes)
//   - layerCount: uint16 LE at offset 428
//   - layerOffsets: uint32 LE at offsets 432, 440, 444
// - Parameters: numParams * 16 bytes:
//   - name: 12 bytes ASCII
//   - value: float32 LE
// - Embedded text sample maps (tab-delimited lines):
//   "sample.wav"\tpitch\tlowKey\thighKey\tgain\tlowVel\thighVel\tpan\tstart\tend\tloopMode\tloopStart\tloopEnd\tdirection\tcrossfade\ttrackPitch
// ─────────────────────────────────────────────────────────

import type { ExtendedRegion, SynthArticulationConfig, SampleLoopDescriptor } from './SamplerTypes.ts';
import { createDefaultArticulation } from './ExtendedAdapter.ts';
import { indexZipArchive, extractZipEntry } from '../NeuronFormats/ZipArchive.ts';
import { toArrayBuffer } from './BytesUtil.ts';

export const WALDORF_QPAT_MAGIC = 3402932;
export const WALDORF_HEADER_SIZE = 512;

export interface WaldorfQpatProgramInfo {
  layerIndex: number;
  name: string;
  bank: string;
  regionCount: number;
}

export function isWaldorfQpatBuffer(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < WALDORF_HEADER_SIZE) return false;
  const view = new DataView(buffer);
  return view.getUint32(0, true) === WALDORF_QPAT_MAGIC;
}

export function parseWaldorfSampleMapText(
  mapText: string,
  _audioPool?: Map<string, ArrayBuffer>
): ExtendedRegion[] {
  const regions: ExtendedRegion[] = [];
  const lines = mapText.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === '-1' || trimmed.startsWith('#')) continue;

    // Format: "path"\tpitch\tlowKey\thighKey\tgain\tlowVel\thighVel\tpan\tstart\tend\tloopMode\tloopStart\tloopEnd\tdir\txfade\ttrack
    const parts = trimmed.split('\t');
    if (parts.length < 8) continue;

    let samplePath = parts[0].replace(/^["']|["']$/g, '');
    const cleanSampleName = samplePath.split('/').pop()?.split('\\').pop() || samplePath;

    // Check for shadow entry
    const gainVal = parseFloat(parts[4]);
    const lowKey = parseInt(parts[2], 10) || 0;
    const highKey = parseInt(parts[3], 10) || 127;
    const lowVel = parseInt(parts[5], 10) || 1;
    const highVel = parseInt(parts[6], 10) || 127;

    // Skip shadow entry (pitch 60, lowKey 0, highKey 0, gain 0, lowVel 0, highVel 0)
    if (lowKey === 0 && highKey === 0 && lowVel === 0 && highVel === 0 && gainVal === 0) {
      continue;
    }

    const pitch = parseFloat(parts[1]) || 60;
    const rootNote = Math.round(pitch);
    const tuning = rootNote - pitch;

    const pan = parseFloat(parts[7]);
    const panning = !isNaN(pan) ? (pan * 2.0) - 1.0 : 0.0;

    let startFrame: number | undefined;
    let endFrame: number | undefined;
    if (parts.length >= 10) {
      const s = parseInt(parts[8], 10);
      const e = parseInt(parts[9], 10);
      if (!isNaN(s) && s >= 0) startFrame = s;
      if (!isNaN(e) && e >= 0) endFrame = e + 1;
    }

    const loops: SampleLoopDescriptor[] = [];
    if (parts.length >= 13) {
      const loopModeNum = parseInt(parts[10], 10) || 0;
      const loopStart = parseInt(parts[11], 10) || 0;
      const loopEnd = parseInt(parts[12], 10) || 0;
      const crossfade = parts.length >= 15 ? parseFloat(parts[14]) || 0 : 0;

      if (loopModeNum > 0 && loopEnd > loopStart) {
        loops.push({
          mode: loopModeNum === 2 ? 'ping_pong' : 'loop_continuous',
          startFrame: loopStart,
          endFrame: loopEnd,
          crossfadeMs: Math.round(crossfade),
        });
      }
    }

    const reversed = parts.length >= 14 ? parseInt(parts[13], 10) === 1 : false;

    regions.push({
      id: `qpat_r_${regions.length + 1}`,
      sampleName: cleanSampleName,
      rootKey: rootNote,
      lowKey,
      highKey,
      lowVel,
      highVel,
      volume: gainVal > 0 ? 20 * Math.log10(gainVal) : 0,
      pan: Math.max(-50, Math.min(50, Math.round(panning * 50))),
      detune: Math.round(tuning * 100),
      pitchKeytrack: 100,
      trigger: 'attack',
      keyFadeIn: 0,
      keyFadeOut: 0,
      velFadeIn: 0,
      velFadeOut: 0,
      fadeCurve: 'equal-power',
      loopMode: loops.length > 0 ? loops[0].mode : 'no_loop',
      loopStart: loops.length > 0 ? loops[0].startFrame : 0,
      loopEnd: loops.length > 0 ? loops[0].endFrame : 0,
      loopCrossfadeMs: loops.length > 0 ? (loops[0].crossfadeMs ?? 0) : 0,
      sampleStartFrame: startFrame,
      sampleEndFrame: endFrame,
      reversed,
      loops: loops.length > 0 ? loops : undefined,
    });
  }

  return regions;
}

export function listWaldorfQpatLayers(buffer: ArrayBuffer): WaldorfQpatProgramInfo[] {
  if (!isWaldorfQpatBuffer(buffer)) return [];
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);
  const decoder = new TextDecoder('ascii');

  const layerOffsets: number[] = [0];
  const layerCount = view.getUint16(428, true);
  const numOffsets = layerCount === 1 ? 1 : (layerCount === 2 ? 3 : 0);

  const offsetSlots = [432, 440, 444];
  for (let i = 0; i < numOffsets; i++) {
    const off = view.getUint32(offsetSlots[i], true);
    if (off > 0 && off < buffer.byteLength - WALDORF_HEADER_SIZE) {
      if (view.getUint32(off, true) === WALDORF_QPAT_MAGIC && !layerOffsets.includes(off)) {
        layerOffsets.push(off);
      }
    }
  }

  const results: WaldorfQpatProgramInfo[] = [];

  for (let idx = 0; idx < layerOffsets.length; idx++) {
    const off = layerOffsets[idx];
    const nameBytes = u8.subarray(off + 8, off + 40);
    const bankBytes = u8.subarray(off + 40, off + 72);
    const name = decoder.decode(nameBytes).replace(/\0.*$/g, '').trim() || `Layer ${idx + 1}`;
    const bank = decoder.decode(bankBytes).replace(/\0.*$/g, '').trim() || 'Default';

    // Scan for text map in this layer
    results.push({
      layerIndex: idx,
      name: idx === 0 ? name : `${name} ${idx + 1}`,
      bank,
      regionCount: 1, // rough estimate until parsed
    });
  }

  return results;
}

export function parseWaldorfQpat(
  buffer: ArrayBuffer,
  selectedLayerIndex: number = 0,
  audioPool?: Map<string, ArrayBuffer>
): {
  presetName: string;
  regions: ExtendedRegion[];
  articulation: SynthArticulationConfig;
} {
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);
  const decoder = new TextDecoder('ascii');


  // Read layer name
  let layerOffset = 0;
  if (selectedLayerIndex > 0) {
    const offsetSlots = [432, 440, 444];
    if (selectedLayerIndex - 1 < offsetSlots.length) {
      layerOffset = view.getUint32(offsetSlots[selectedLayerIndex - 1], true);
    }
  }

  const nameBytes = u8.subarray(layerOffset + 8, layerOffset + 40);
  const presetName = decoder.decode(nameBytes).replace(/\0.*$/g, '').trim() || 'QuantumPatch';

  // Read params
  const numParams = view.getUint16(layerOffset + 0x1A0, true);
  let readPos = layerOffset + WALDORF_HEADER_SIZE;

  // Each param is 16 bytes: 12 bytes name, float32 value
  const params = new Map<string, number>();
  for (let i = 0; i < numParams && readPos + 16 <= buffer.byteLength; i++) {
    const pName = decoder.decode(u8.subarray(readPos, readPos + 12)).replace(/\0.*$/g, '').trim();
    const pVal = view.getFloat32(readPos + 12, true);
    params.set(pName, pVal);
    readPos += 16;
  }

  // Followed by sample map strings
  const remainingText = decoder.decode(u8.subarray(readPos));
  const regions = parseWaldorfSampleMapText(remainingText, audioPool);

  const articulation = createDefaultArticulation();

  // Map Waldorf envelopes to articulation if present
  const ampA = params.get('AmpAttack');
  const ampD = params.get('AmpDecay');
  const ampS = params.get('AmpSustain');
  const ampR = params.get('AmpRelease');
  if (ampA !== undefined && ampD !== undefined && ampS !== undefined && ampR !== undefined) {
    articulation.ampEnv = {
      delaySec: 0,
      holdSec: 0,
      attackSec: ampA,
      decaySec: ampD,
      sustainLevel: ampS,
      releaseSec: ampR,
    };
  }

  const cut = params.get('Fil1Cutoff');
  const res = params.get('Fil1Resonance');
  if (cut !== undefined) {
    articulation.filter = {
      enabled: true,
      type: 'lpf',
      cutoffHz: cut,
      resonanceDb: res ?? 0.0,
      envToFilterCents: 0,
      velToFilterCents: 0,
      keytrackCents: 0,
      poles: 2,
    };
  }

  return {
    presetName,
    regions,
    articulation,
  };
}

export function buildWaldorfSampleMapText(
  regions: ExtendedRegion[],
  samplePathPrefix: string = 'samples'
): string {
  const lines: string[] = [];
  for (const reg of regions) {
    const filename = `"${samplePathPrefix}/${reg.sampleName.endsWith('.wav') ? reg.sampleName : reg.sampleName + '.wav'}"`;
    const pitch = (reg.rootKey - (reg.detune ? reg.detune / 100.0 : 0)).toFixed(4);
    const lowKey = reg.lowKey;
    const highKey = reg.highKey;
    const gainFactor = Math.pow(10, (reg.volume ?? 0) / 20).toFixed(4);
    const lowVel = reg.lowVel <= 1 ? 0 : reg.lowVel;
    const highVel = reg.highVel;
    const pan = ((((reg.pan ?? 0) / 50.0) + 1.0) / 2.0).toFixed(4);

    const s = reg.sampleStartFrame ?? 0;
    const e = (reg.sampleEndFrame ?? 44100) - 1;

    let loopMode = 0;
    let lStart = 0;
    let lEnd = e;
    let xfade = 0;

    if (reg.loops && reg.loops.length > 0) {
      const l = reg.loops[0];
      loopMode = l.mode === 'ping_pong' ? 2 : 1;
      lStart = l.startFrame;
      lEnd = l.endFrame;
      xfade = l.crossfadeMs ?? 0;
    }

    const dir = reg.reversed ? 1 : 0;
    const track = 1;

    lines.push(
      `${filename}\t${pitch}\t${lowKey}\t${highKey}\t${gainFactor}\t${lowVel}\t${highVel}\t${pan}\t${s}\t${e}\t${loopMode}\t${lStart}\t${lEnd}\t${dir}\t${xfade}\t${track}`
    );
  }

  // Append terminator
  lines.push('-1');
  return lines.join('\n');
}

export function buildWaldorfQpat(options: {
  presetName: string;
  bankName?: string;
  regions: ExtendedRegion[];
  articulation?: SynthArticulationConfig;
}): Uint8Array {
  const encoder = new TextEncoder();
  const sampleMapText = buildWaldorfSampleMapText(options.regions, `samples/${options.presetName}`);
  const sampleMapBytes = encoder.encode(sampleMapText);

  // Parameters list
  const params: Array<{ name: string; val: number }> = [
    { name: 'TimbreMode', val: 0 },
    { name: 'LayerActive', val: 1 },
    { name: 'AmpAttack', val: options.articulation?.ampEnv?.attackSec ?? 0.01 },
    { name: 'AmpDecay', val: options.articulation?.ampEnv?.decaySec ?? 0.1 },
    { name: 'AmpSustain', val: options.articulation?.ampEnv?.sustainLevel ?? 1.0 },
    { name: 'AmpRelease', val: options.articulation?.ampEnv?.releaseSec ?? 0.2 },
    { name: 'Fil1Cutoff', val: options.articulation?.filter?.cutoffHz ?? 20000 },
    { name: 'Fil1Resonance', val: options.articulation?.filter?.resonanceDb ?? 0 },
  ];

  const totalSize = WALDORF_HEADER_SIZE + params.length * 16 + sampleMapBytes.byteLength;
  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);

  // Magic
  view.setUint32(0, WALDORF_QPAT_MAGIC, true);
  // Version
  view.setUint32(4, 9, true);

  // Name (32 bytes)
  const nameBytes = encoder.encode(options.presetName.slice(0, 31));
  out.set(nameBytes, 8);

  // Bank (32 bytes)
  const bankBytes = encoder.encode((options.bankName || 'Default').slice(0, 31));
  out.set(bankBytes, 40);

  // numParams at offset 0x1A0 = 416
  view.setUint16(416, params.length, true);

  // layerCount at offset 428
  view.setUint16(428, 1, true);

  // Write params at 512
  let pPos = WALDORF_HEADER_SIZE;
  for (const p of params) {
    const pnBytes = encoder.encode(p.name.slice(0, 11));
    out.set(pnBytes, pPos);
    view.setFloat32(pPos + 12, p.val, true);
    pPos += 16;
  }

  // Write sample map
  out.set(sampleMapBytes, pPos);

  return out;
}

export function importWaldorfQpatZip(
  zipBuffer: ArrayBuffer,
  selectedLayerIndex: number = 0
): {
  presetName: string;
  regions: ExtendedRegion[];
  articulation: SynthArticulationConfig;
  audioBuffers: Map<string, ArrayBuffer>;
} {
  const zipBytes = new Uint8Array(zipBuffer);
  const central = indexZipArchive(zipBytes);
  const audioBuffers = new Map<string, ArrayBuffer>();
  let qpatEntry: (typeof central)[0] | undefined;

  for (const entry of central) {
    const low = entry.path.toLowerCase();
    if (low.endsWith('.qpat')) {
      qpatEntry = entry;
    } else if (low.endsWith('.wav') || low.endsWith('.flac')) {
      const data = extractZipEntry(zipBytes, entry);
      const name = entry.path.split('/').pop() || entry.path;
      audioBuffers.set(name, toArrayBuffer(data));
    }
  }

  if (!qpatEntry) {
    throw new Error('No .qpat file found in package');
  }

  const qpatBytes = extractZipEntry(zipBytes, qpatEntry);
  const parsed = parseWaldorfQpat(
    toArrayBuffer(qpatBytes),
    selectedLayerIndex,
    audioBuffers
  );

  return {
    presetName: parsed.presetName,
    regions: parsed.regions,
    articulation: parsed.articulation,
    audioBuffers,
  };
}
