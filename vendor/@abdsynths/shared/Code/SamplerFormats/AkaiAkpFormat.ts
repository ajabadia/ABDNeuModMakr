// ─────────────────────────────────────────────────────────
// @abdsynths/shared — Akai S5000 / S6000 / Z4 / Z8 Program (.akp) Format
//
// High-fidelity clean-room parser and writer for Akai S5000, S6000, Z4 and Z8
// RIFF 'APRG' program files.
// ─────────────────────────────────────────────────────────

import type { LoopMode } from './SamplerTypes.ts';
import type { ParsedImportRegion, ParsedSamplerPreset } from './rawSamplerParsers.ts';

export interface AkpZone {
  sampleName: string;
  lowVel: number;
  highVel: number;
  fineTune: number;     // -50..+50 cents
  semitoneTune: number; // -36..+36 semitones
  filterOffset: number; // -100..+100
  pan: number;          // -50..+50
  playbackMode: number; // 0=No Loop, 1=One shot, 2=Loop in rel, 3=Loop until rel, 4/6=As Sample
  output: number;
  zoneLevel: number;    // -100..+100
  keyTrack: boolean;
  velToStart: number;
}

export interface AkpKeygroup {
  lowKey: number;       // 21..127
  highKey: number;      // 21..127
  semitoneTune: number;
  fineTune: number;
  pitchMod1: number;
  pitchMod2: number;
  ampMod: number;
  zoneXfade: boolean;
  muteGroup: number;
  ampAttack: number;
  ampDecay: number;
  ampRelease: number;
  ampSustain: number;
  filterMode: number;   // 0=2-pole LP, 1=4-pole LP, 3=2-pole BP, 6=1-pole HP, 7=2-pole HP
  filterCutoff: number; // 0..100
  filterResonance: number; // 0..12
  filterKeyTrack: number;
  filtAttack: number;
  filtDecay: number;
  filtRelease: number;
  filtSustain: number;
  filtEnvDepth: number;
  zones: AkpZone[];
}

export interface AkpProgram {
  name: string;
  isZSeries: boolean;
  loudness: number;
  semitoneTune: number;
  fineTune: number;
  keygroups: AkpKeygroup[];
}

function readFourCC(buf: Uint8Array, offset: number): string {
  if (offset + 4 > buf.length) return '';
  return String.fromCharCode(buf[offset], buf[offset + 1], buf[offset + 2], buf[offset + 3]);
}

function readU16LE(buf: Uint8Array, offset: number): number {
  return buf[offset] | (buf[offset + 1] << 8);
}

function readI16LE(buf: Uint8Array, offset: number): number {
  const v = readU16LE(buf, offset);
  return v > 32767 ? v - 65536 : v;
}

function readU32LE(buf: Uint8Array, offset: number): number {
  return (
    buf[offset] |
    (buf[offset + 1] << 8) |
    (buf[offset + 2] << 16) |
    ((buf[offset + 3] << 24) >>> 0)
  );
}

function readI8(buf: Uint8Array, offset: number): number {
  const v = buf[offset];
  return v > 127 ? v - 256 : v;
}

export function isAkpData(data: ArrayBuffer | Uint8Array): boolean {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (buf.length < 16) return false;
  const riff = readFourCC(buf, 0);
  const form = readFourCC(buf, 8);
  return riff === 'RIFF' && form === 'APRG';
}

export function parseAkpProgram(
  data: ArrayBuffer | Uint8Array,
  programNameFallback: string = 'Akai AKP Program'
): AkpProgram {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (!isAkpData(buf)) {
    throw new Error('Not an Akai S5000/Z4 AKP RIFF APRG file');
  }

  let offset = 12;
  let isZSeries = false;
  let loudness = 85;
  let semitoneTune = 0;
  let fineTune = 0;
  const keygroups: AkpKeygroup[] = [];

  while (offset + 8 <= buf.length) {
    const chunkId = readFourCC(buf, offset);
    let chunkSize = readU32LE(buf, offset + 4);
    const dataOffset = offset + 8;

    if (chunkId === 'z48 ') {
      isZSeries = true;
      offset = dataOffset + chunkSize + (chunkSize % 2);
      continue;
    }

    if (chunkId === 'prg ') {
      offset = dataOffset + chunkSize + (chunkSize % 2);
      continue;
    }

    if (chunkId === 'out ') {
      if (dataOffset + 2 <= buf.length) {
        loudness = buf[dataOffset + 1];
      }
      offset = dataOffset + chunkSize + (chunkSize % 2);
      continue;
    }

    if (chunkId === 'tune') {
      if (dataOffset + 3 <= buf.length) {
        semitoneTune = readI8(buf, dataOffset + 1);
        fineTune = readI8(buf, dataOffset + 2);
      }
      offset = dataOffset + chunkSize + (chunkSize % 2);
      continue;
    }

    if (chunkId === 'kgrp') {
      const kg = parseKeygroupChunk(buf, dataOffset, chunkSize);
      keygroups.push(kg);
      offset = dataOffset + chunkSize + (chunkSize % 2);
      continue;
    }

    if (chunkSize === 0) {
      if (chunkId === 'lfo ') chunkSize = 12;
      else if (chunkId === 'mods') chunkSize = 38;
      else chunkSize = 8;
    }
    offset = dataOffset + chunkSize + (chunkSize % 2);
  }

  return {
    name: programNameFallback.replace(/\.akp$/i, ''),
    isZSeries,
    loudness,
    semitoneTune,
    fineTune,
    keygroups,
  };
}

function parseKeygroupChunk(buf: Uint8Array, start: number, totalLen: number): AkpKeygroup {
  let offset = start;
  const end = Math.min(buf.length, start + totalLen);

  let lowKey = 21;
  let highKey = 127;
  let semitoneTune = 0;
  let fineTune = 0;
  let pitchMod1 = 100;
  let pitchMod2 = 0;
  let ampMod = 0;
  let zoneXfade = false;
  let muteGroup = 0;

  let ampAttack = 0;
  let ampDecay = 50;
  let ampRelease = 15;
  let ampSustain = 100;

  let filterMode = 0;
  let filterCutoff = 100;
  let filterResonance = 0;
  let filterKeyTrack = 0;

  let filtAttack = 0;
  let filtDecay = 50;
  let filtRelease = 15;
  let filtSustain = 100;
  let filtEnvDepth = 0;

  const zones: AkpZone[] = [];
  let envIndex = 0;

  while (offset + 8 <= end) {
    const subId = readFourCC(buf, offset);
    let subSize = readU32LE(buf, offset + 4);
    const subData = offset + 8;

    if (subId === 'kloc') {
      if (subData + 15 <= end) {
        lowKey = buf[subData + 4];
        highKey = buf[subData + 5];
        semitoneTune = readI8(buf, subData + 6);
        fineTune = readI8(buf, subData + 7);
        pitchMod1 = readI8(buf, subData + 10);
        pitchMod2 = readI8(buf, subData + 11);
        ampMod = readI8(buf, subData + 12);
        zoneXfade = buf[subData + 13] !== 0;
        muteGroup = buf[subData + 14];
      }
    } else if (subId === 'env ') {
      if (envIndex === 0) {
        if (subData + 8 <= end) {
          ampAttack = buf[subData + 1];
          ampDecay = buf[subData + 3];
          ampRelease = buf[subData + 4];
          ampSustain = buf[subData + 7];
        }
      } else if (envIndex === 1) {
        if (subData + 10 <= end) {
          filtAttack = buf[subData + 1];
          filtDecay = buf[subData + 3];
          filtRelease = buf[subData + 4];
          filtSustain = buf[subData + 7];
          filtEnvDepth = readI8(buf, subData + 9);
        }
      }
      envIndex++;
    } else if (subId === 'filt') {
      if (subData + 5 <= end) {
        filterMode = buf[subData + 1];
        filterCutoff = buf[subData + 2];
        filterResonance = buf[subData + 3];
        filterKeyTrack = readI8(buf, subData + 4);
      }
    } else if (subId === 'zone') {
      if (subData + 44 <= end) {
        const nameLen = buf[subData + 1];
        let sampleName = '';
        if (nameLen > 0) {
          const maxL = Math.min(nameLen, 20);
          const nameBytes = buf.subarray(subData + 2, subData + 2 + maxL);
          sampleName = new TextDecoder('ascii').decode(nameBytes).replace(/\0.*$/, '').trim();
        }
        const lowVel = buf[subData + 0x22];
        const highVel = buf[subData + 0x23];
        const zFine = readI8(buf, subData + 0x24);
        const zSemi = readI8(buf, subData + 0x25);
        const filterOff = readI8(buf, subData + 0x26);
        const pan = readI8(buf, subData + 0x27);
        const playback = buf[subData + 0x28];
        const out = buf[subData + 0x29];
        const zLevel = readI8(buf, subData + 0x2a);
        const keyTrk = buf[subData + 0x2b] !== 0;
        const velStart = readI16LE(buf, subData + 0x2c);

        if (sampleName.length > 0) {
          zones.push({
            sampleName,
            lowVel: Math.min(127, Math.max(0, lowVel)),
            highVel: Math.min(127, Math.max(0, highVel === 0 && lowVel === 0 ? 127 : highVel)),
            fineTune: zFine,
            semitoneTune: zSemi,
            filterOffset: filterOff,
            pan,
            playbackMode: playback,
            output: out,
            zoneLevel: zLevel,
            keyTrack: keyTrk,
            velToStart: velStart,
          });
        }
      }
    }

    if (subSize === 0) {
      if (subId === 'kloc') subSize = 16;
      else if (subId === 'env ') subSize = 18;
      else if (subId === 'filt') subSize = 10;
      else if (subId === 'zone') subSize = 46;
      else subSize = 16;
    }
    offset = subData + subSize + (subSize % 2);
  }

  return {
    lowKey,
    highKey,
    semitoneTune,
    fineTune,
    pitchMod1,
    pitchMod2,
    ampMod,
    zoneXfade,
    muteGroup,
    ampAttack,
    ampDecay,
    ampRelease,
    ampSustain,
    filterMode,
    filterCutoff,
    filterResonance,
    filterKeyTrack,
    filtAttack,
    filtDecay,
    filtRelease,
    filtSustain,
    filtEnvDepth,
    zones,
  };
}

export function convertAkpToPreset(
  akp: AkpProgram,
  availableSamples?: Map<string, ArrayBuffer>
): ParsedSamplerPreset {
  const regions: ParsedImportRegion[] = [];
  const audioBuffers = new Map<string, ArrayBuffer>();

  for (const kg of akp.keygroups) {
    for (const z of kg.zones) {
      let sampleRef = z.sampleName;
      if (!sampleRef.toLowerCase().endsWith('.wav')) {
        sampleRef += '.wav';
      }

      if (availableSamples) {
        const found =
          availableSamples.get(sampleRef) ||
          availableSamples.get(sampleRef.toLowerCase()) ||
          availableSamples.get(z.sampleName);
        if (found) {
          audioBuffers.set(sampleRef, found);
        }
      }

      let loopMode: LoopMode = 'no_loop';
      if (z.playbackMode === 2 || z.playbackMode === 3 || z.playbackMode === 4 || z.playbackMode === 6) {
        loopMode = 'loop_continuous';
      } else if (z.playbackMode === 1) {
        loopMode = 'one_shot';
      }

      const totalTuneCents = (akp.semitoneTune + kg.semitoneTune + z.semitoneTune) * 100 +
        (akp.fineTune + kg.fineTune + z.fineTune);

      regions.push({
        id: `akp_${regions.length + 1}`,
        sampleName: sampleRef,
        samplePath: sampleRef,
        rootKey: Math.min(127, Math.max(0, Math.round((kg.lowKey + kg.highKey) / 2))),
        lowKey: kg.lowKey,
        highKey: kg.highKey,
        lowVel: z.lowVel,
        highVel: z.highVel,
        detuneCents: totalTuneCents,
        volumeDb: (z.zoneLevel / 100) * 12.0,
        pan: z.pan,
        loopMode,
        loopStart: 0,
        loopEnd: 0,
      });
    }
  }

  return {
    format: 'akai_disk',
    formatLabel: 'Akai S5000/Z4 Program (.akp)',
    presetName: akp.name,
    modelName: akp.name.slice(0, 11),
    detectedCategory: 'vintage',
    suggestedParameterSet: 1,
    regions,
    audioBuffers,
  };
}

export function writeAkpProgram(
  program: AkpProgram,
  generation: 1 | 3 = 1
): Uint8Array {
  const parts: Uint8Array[] = [];

  function writeAscii(str: string, len: number): Uint8Array {
    const bytes = new Uint8Array(len);
    for (let i = 0; i < Math.min(str.length, len); i++) {
      bytes[i] = str.charCodeAt(i);
    }
    return bytes;
  }

  function makeChunk(id: string, data: Uint8Array): Uint8Array {
    const pad = data.length % 2;
    const res = new Uint8Array(8 + data.length + pad);
    for (let i = 0; i < 4; i++) res[i] = id.charCodeAt(i);
    const sz = data.length;
    res[4] = sz & 0xff;
    res[5] = (sz >> 8) & 0xff;
    res[6] = (sz >> 16) & 0xff;
    res[7] = (sz >> 24) & 0xff;
    res.set(data, 8);
    return res;
  }

  // prg chunk: 6 bytes
  const prgData = new Uint8Array(6);
  prgData[0] = generation === 3 ? 2 : 1;
  prgData[1] = 0;
  prgData[2] = Math.min(99, Math.max(1, program.keygroups.length));
  prgData[3] = 0;
  prgData[4] = 2;
  prgData[5] = 0;
  parts.push(makeChunk('prg ', prgData));

  // out chunk: 8 bytes
  const outData = new Uint8Array(8);
  outData[0] = 1;
  outData[1] = Math.min(100, Math.max(0, program.loudness));
  outData[7] = 25;
  parts.push(makeChunk('out ', outData));

  // tune chunk: 22 bytes (Gen 1) or 24 bytes (Gen 3)
  const tuneData = new Uint8Array(generation === 3 ? 24 : 22);
  tuneData[0] = generation === 3 ? 2 : 1;
  tuneData[1] = program.semitoneTune & 0xff;
  tuneData[2] = program.fineTune & 0xff;
  tuneData[15] = 2;
  tuneData[16] = 2;
  parts.push(makeChunk('tune', tuneData));

  // lfo 1: 12 / 14 bytes
  const lfo1Data = new Uint8Array(generation === 3 ? 14 : 12);
  lfo1Data[0] = generation === 3 ? 2 : 1;
  lfo1Data[1] = 1;
  lfo1Data[2] = 43;
  lfo1Data[6] = 1;
  parts.push(makeChunk('lfo ', lfo1Data));

  // lfo 2: 12 / 14 bytes
  const lfo2Data = new Uint8Array(generation === 3 ? 14 : 12);
  lfo2Data[0] = generation === 3 ? 2 : 1;
  lfo2Data[5] = 1;
  parts.push(makeChunk('lfo ', lfo2Data));

  // mods: 38 bytes
  const modsData = new Uint8Array(38);
  modsData[0] = 1;
  modsData[2] = 17;
  modsData[4] = 2; modsData[5] = 6;
  modsData[6] = 2; modsData[7] = 3;
  modsData[8] = 1; modsData[9] = 8;
  modsData[10] = 1; modsData[11] = 6;
  modsData[12] = 1; modsData[13] = 1;
  modsData[14] = 4; modsData[15] = 6;
  modsData[16] = 5; modsData[17] = 6;
  modsData[18] = 3; modsData[19] = 6;
  modsData[26] = 0; modsData[27] = 7;
  modsData[28] = 0; modsData[29] = 11;
  modsData[30] = 2; modsData[31] = 5;
  modsData[32] = 9; modsData[33] = 5;
  modsData[34] = 9; modsData[35] = 8;
  modsData[36] = 9; modsData[37] = 10;
  parts.push(makeChunk('mods', modsData));

  // keygroups
  for (const kg of program.keygroups) {
    const kgParts: Uint8Array[] = [];

    // kloc: 16 bytes
    const klocData = new Uint8Array(16);
    klocData[0] = generation === 3 ? 2 : 1;
    klocData[1] = 3; klocData[2] = 1; klocData[3] = 4;
    klocData[4] = kg.lowKey;
    klocData[5] = kg.highKey;
    klocData[6] = kg.semitoneTune & 0xff;
    klocData[7] = kg.fineTune & 0xff;
    klocData[10] = kg.pitchMod1 & 0xff;
    klocData[11] = kg.pitchMod2 & 0xff;
    klocData[12] = kg.ampMod & 0xff;
    klocData[13] = kg.zoneXfade ? 1 : 0;
    klocData[14] = kg.muteGroup;
    kgParts.push(makeChunk('kloc', klocData));

    // env Amp: 18 bytes
    const ampEnv = new Uint8Array(18);
    ampEnv[0] = 1;
    ampEnv[1] = kg.ampAttack;
    ampEnv[3] = kg.ampDecay;
    ampEnv[4] = kg.ampRelease;
    ampEnv[7] = kg.ampSustain;
    kgParts.push(makeChunk('env ', ampEnv));

    // env Filter: 18 bytes
    const filtEnv = new Uint8Array(18);
    filtEnv[0] = 1;
    filtEnv[1] = kg.filtAttack;
    filtEnv[3] = kg.filtDecay;
    filtEnv[4] = kg.filtRelease;
    filtEnv[7] = kg.filtSustain;
    filtEnv[9] = kg.filtEnvDepth & 0xff;
    kgParts.push(makeChunk('env ', filtEnv));

    // env Aux: 18 bytes
    const auxEnv = new Uint8Array(18);
    auxEnv[0] = 1;
    auxEnv[2] = 50; auxEnv[3] = 50; auxEnv[4] = 15;
    auxEnv[5] = 100; auxEnv[6] = 100; auxEnv[7] = 100;
    kgParts.push(makeChunk('env ', auxEnv));

    // filt: 10 bytes
    const filtData = new Uint8Array(10);
    filtData[0] = generation === 3 ? 2 : 1;
    filtData[1] = kg.filterMode;
    filtData[2] = kg.filterCutoff;
    filtData[3] = kg.filterResonance;
    filtData[4] = kg.filterKeyTrack & 0xff;
    kgParts.push(makeChunk('filt', filtData));

    // 4 zones
    for (let zi = 0; zi < 4; zi++) {
      const z = kg.zones[zi];
      const zoneSize = generation === 3 ? 48 : 46;
      const zoneData = new Uint8Array(zoneSize);
      zoneData[0] = generation === 3 ? 3 : 1;
      if (z) {
        const sName = z.sampleName.replace(/\.wav$/i, '').substring(0, 20);
        zoneData[1] = sName.length;
        zoneData.set(writeAscii(sName, 20), 2);
        zoneData[0x22] = z.lowVel;
        zoneData[0x23] = z.highVel;
        zoneData[0x24] = z.fineTune & 0xff;
        zoneData[0x25] = z.semitoneTune & 0xff;
        zoneData[0x26] = z.filterOffset & 0xff;
        zoneData[0x27] = z.pan & 0xff;
        zoneData[0x28] = z.playbackMode;
        zoneData[0x29] = z.output;
        zoneData[0x2a] = z.zoneLevel & 0xff;
        zoneData[0x2b] = z.keyTrack ? 1 : 0;
        zoneData[0x2c] = z.velToStart & 0xff;
        zoneData[0x2d] = (z.velToStart >> 8) & 0xff;
      } else {
        zoneData[1] = 0;
        zoneData[0x28] = generation === 3 ? 6 : 4;
        zoneData[0x2b] = 1;
      }
      kgParts.push(makeChunk('zone', zoneData));
    }

    const kgTotalLen = kgParts.reduce((acc, p) => acc + p.length, 0);
    const kgBlob = new Uint8Array(kgTotalLen);
    let kgPos = 0;
    for (const p of kgParts) {
      kgBlob.set(p, kgPos);
      kgPos += p.length;
    }
    parts.push(makeChunk('kgrp', kgBlob));
  }

  const innerLen = 4 + parts.reduce((acc, p) => acc + p.length, 0);
  const totalFileLen = 8 + innerLen;
  const out = new Uint8Array(totalFileLen);

  out.set([0x52, 0x49, 0x46, 0x46], 0);
  out[4] = innerLen & 0xff;
  out[5] = (innerLen >> 8) & 0xff;
  out[6] = (innerLen >> 16) & 0xff;
  out[7] = (innerLen >> 24) & 0xff;
  out.set([0x41, 0x50, 0x52, 0x47], 8);

  let wPos = 12;
  for (const p of parts) {
    out.set(p, wPos);
    wPos += p.length;
  }

  return out;
}
