// ─────────────────────────────────────────────────────────
// @abdsynths/shared — Roland S-50 / S-550 / S-330 / W-30 Disk Image Format
// ─────────────────────────────────────────────────────────

import { pcm16ToWavBuffer } from './PcmWavHelper.ts';
import type { LoopMode } from './SamplerTypes.ts';
import type { ParsedImportRegion, ParsedSamplerPreset } from './rawSamplerParsers.ts';

export interface RolandS5xxTone {
  index: number;
  name: string;
  sampleRateHz: number;
  origKeyNumber: number;
  waveBank: number;
  waveSegmentTop: number;
  waveSegmentLength: number;
  startPoint: number;
  endPoint: number;
  loopMode: number;
  loopPoint: number;
  loopLength: number;
  tvfCutoff: number;
  tvfResonance: number;
  level: number;
}

export interface RolandS5xxPatch {
  index: number;
  name: string;
  splitKey: number;
  tone1: number;
  tone2: number;
}

export interface RolandS5xxDisk {
  model: 'S50' | 'S550' | 'S330' | 'W30';
  diskLabel: string;
  patches: RolandS5xxPatch[];
  tones: RolandS5xxTone[];
  audioSamples: Map<string, ArrayBuffer>;
}

function readAscii(buf: Uint8Array, offset: number, len: number): string {
  let str = '';
  for (let i = 0; i < len && offset + i < buf.length; i++) {
    const c = buf[offset + i];
    if (c === 0) break;
    str += String.fromCharCode(c);
  }
  return str.trim();
}

function readU24LE(buf: Uint8Array, offset: number): number {
  return buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16);
}

export function isRolandS5xxDiskImage(data: ArrayBuffer | Uint8Array): boolean {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  // S-5xx floppy is typically 737280 bytes (720 KB)
  if (buf.length !== 737280 && buf.length !== 1474560) return false;
  // If offset 4 has '770', it is an S-7xx image, not an S-5xx floppy
  if (buf.length >= 8 && buf[4] === 0x37 && buf[5] === 0x37 && buf[6] === 0x30) {
    return false;
  }
  let validTones = 0;
  for (let t = 0; t < 8; t++) {
    const tOfs = 69120 + t * 128;
    const waveBank = buf[tOfs + 6];
    const segTop = buf[tOfs + 7];
    const segLen = buf[tOfs + 8];
    if (waveBank <= 1 && segTop <= 18 && segLen <= 18) {
      validTones++;
    }
  }
  return validTones >= 6;
}

export function unpackRoland12bitPcm(input: Uint8Array): Int16Array {
  const numSamples = Math.floor((input.length / 3) * 2);
  const out = new Int16Array(numSamples);
  let src = 0;
  let dst = 0;

  while (src + 2 < input.length && dst + 1 < numSamples) {
    const b0 = input[src];
    const b1 = input[src + 1];
    const b2 = input[src + 2];
    src += 3;

    let s1 = (b0 << 4) | (b1 >> 4);
    if (s1 >= 2048) s1 -= 4096;
    out[dst++] = s1 << 4;

    let s2 = ((b1 & 0x0f) << 8) | b2;
    if (s2 >= 2048) s2 -= 4096;
    out[dst++] = s2 << 4;
  }

  return out;
}

export function parseRolandS5xxDisk(data: ArrayBuffer | Uint8Array): RolandS5xxDisk {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  const patches: RolandS5xxPatch[] = [];
  const tones: RolandS5xxTone[] = [];
  const audioSamples = new Map<string, ArrayBuffer>();

  let diskLabel = readAscii(buf, 68659, 12);
  if (!diskLabel) diskLabel = 'Roland S-5xx Disk';

  const TONE_OFFSET = 69120;
  for (let t = 0; t < 32; t++) {
    const o = TONE_OFFSET + t * 128;
    if (o + 128 > buf.length) break;

    const name = readAscii(buf, o, 8) || `Tone_${t + 1}`;
    const freqCode = buf[o + 4];
    const sampleRate = freqCode === 1 ? 15000 : 30000;
    const origKey = buf[o + 5] || 60;
    const waveBank = buf[o + 6];
    const waveSegTop = buf[o + 7];
    const waveSegLen = buf[o + 8];

    const startPt = readU24LE(buf, o + 10);
    const endPt = readU24LE(buf, o + 13);
    const loopMode = buf[o + 16];
    const loopPt = readU24LE(buf, o + 17);
    const loopLen = readU24LE(buf, o + 20);

    const level = buf[o + 30];
    const tvfCutoff = buf[o + 40];
    const tvfReso = buf[o + 41];

    tones.push({
      index: t,
      name,
      sampleRateHz: sampleRate,
      origKeyNumber: origKey,
      waveBank,
      waveSegmentTop: waveSegTop,
      waveSegmentLength: waveSegLen,
      startPoint: startPt,
      endPoint: endPt,
      loopMode,
      loopPoint: loopPt,
      loopLength: loopLen,
      tvfCutoff,
      tvfResonance: tvfReso,
      level,
    });
  }

  const BANK_A_OFS = 73728;
  const BANK_B_OFS = 405504;
  const SEGMENT_SIZE = 18432;

  for (const tone of tones) {
    if (tone.waveSegmentLength <= 0) continue;
    const bankStart = tone.waveBank === 1 ? BANK_B_OFS : BANK_A_OFS;
    const segOfs = bankStart + tone.waveSegmentTop * SEGMENT_SIZE;
    const segBytes = tone.waveSegmentLength * SEGMENT_SIZE;

    if (segOfs + segBytes <= buf.length) {
      const packedData = buf.subarray(segOfs, segOfs + segBytes);
      const pcm16 = unpackRoland12bitPcm(packedData);

      const wav = pcm16ToWavBuffer(pcm16, tone.sampleRateHz);
      const sKey = `${tone.name}_T${tone.index + 1}.wav`;
      audioSamples.set(sKey, wav);
    }
  }

  const PATCH_OFS = 64512;
  for (let p = 0; p < 16; p++) {
    const po = PATCH_OFS + p * 256;
    if (po + 64 > buf.length) break;

    const pName = readAscii(buf, po, 12) || `Patch_${p + 1}`;
    const splitKey = buf[po + 12] || 60;
    const tone1 = buf[po + 13];
    const tone2 = buf[po + 14];

    patches.push({
      index: p,
      name: pName,
      splitKey,
      tone1: tone1 < 32 ? tone1 : 0,
      tone2: tone2 < 32 ? tone2 : 0,
    });
  }

  return {
    model: 'S550',
    diskLabel,
    patches,
    tones,
    audioSamples,
  };
}

export function convertRolandS5xxToPreset(
  disk: RolandS5xxDisk,
  patchIndex: number = 0
): ParsedSamplerPreset {
  const patch = disk.patches[patchIndex] || disk.patches[0];
  const patchName = patch ? patch.name : disk.diskLabel;
  const regions: ParsedImportRegion[] = [];
  const audioBuffers = new Map<string, ArrayBuffer>();

  for (const [k, v] of disk.audioSamples.entries()) {
    audioBuffers.set(k, v);
  }

  const assignedTones = patch ? [disk.tones[patch.tone1], disk.tones[patch.tone2]] : disk.tones.slice(0, 2);

  for (let i = 0; i < assignedTones.length; i++) {
    const tone = assignedTones[i];
    if (!tone) continue;

    const sKey = `${tone.name}_T${tone.index + 1}.wav`;
    const lowKey = i === 0 ? 0 : (patch ? patch.splitKey + 1 : 61);
    const highKey = i === 0 ? (patch ? patch.splitKey : 60) : 127;

    let loopMode: LoopMode = 'no_loop';
    if (tone.loopMode === 0) loopMode = 'loop_continuous';
    else if (tone.loopMode === 1) loopMode = 'loop_alternating';
    else if (tone.loopMode === 2) loopMode = 'one_shot';

    regions.push({
      id: `s5xx_${regions.length + 1}`,
      sampleName: sKey,
      samplePath: sKey,
      rootKey: tone.origKeyNumber,
      lowKey,
      highKey,
      lowVel: 0,
      highVel: 127,
      detuneCents: 0,
      volumeDb: (tone.level / 127) * 6.0 - 6.0,
      pan: 0,
      loopMode,
      loopStart: tone.loopPoint,
      loopEnd: tone.loopPoint + tone.loopLength,
    });
  }

  return {
    format: 'roland_disk',
    formatLabel: 'Roland S-5xx Disk Image',
    presetName: patchName,
    modelName: patchName.slice(0, 11),
    detectedCategory: 'vintage',
    suggestedParameterSet: 1,
    regions,
    audioBuffers,
  };
}
