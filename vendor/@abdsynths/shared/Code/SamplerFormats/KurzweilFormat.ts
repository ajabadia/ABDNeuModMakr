// ─────────────────────────────────────────────────────────
// @abdsynths/shared — Kurzweil K2000 / K2500 / K2600 / PC3 (.krz, .k25, .k26) Parser
// ─────────────────────────────────────────────────────────

import { pcm16ToWavBuffer } from './PcmWavHelper.ts';
import type { ParsedImportRegion, ParsedSamplerPreset } from './rawSamplerParsers.ts';

export interface KurzweilSampleHeader {
  rootKey: number;
  loopOff: boolean;
  samplePresent: boolean;
  volumeAdjustDb: number;
  sampleStart: number;
  loopStart: number;
  sampleEnd: number;
  sampleRateHz: number;
}

export interface KurzweilSampleObject {
  id: number;
  name: string;
  isStereo: boolean;
  headers: KurzweilSampleHeader[];
}

export interface KurzweilKeymapEntry {
  note: number;
  sampleId: number;
  subSampleNum: number;
  tuningCents: number;
}

export interface KurzweilKeymapObject {
  id: number;
  name: string;
  entries: KurzweilKeymapEntry[];
}

export interface KurzweilProgramObject {
  id: number;
  name: string;
  keymapId: number;
  lowKey: number;
  highKey: number;
  cutoffHz: number;
  resonanceDb: number;
}

export interface ParsedKurzweilFile {
  programs: KurzweilProgramObject[];
  keymaps: Map<number, KurzweilKeymapObject>;
  samples: Map<number, KurzweilSampleObject>;
  sampleAudioMap: Map<string, ArrayBuffer>;
}

function readU16BE(buf: Uint8Array, offset: number): number {
  return (buf[offset] << 8) | buf[offset + 1];
}

function readI16BE(buf: Uint8Array, offset: number): number {
  const v = readU16BE(buf, offset);
  return v > 32767 ? v - 65536 : v;
}

function readI32BE(buf: Uint8Array, offset: number): number {
  return (
    (buf[offset] << 24) |
    (buf[offset + 1] << 16) |
    (buf[offset + 2] << 8) |
    buf[offset + 3]
  );
}

function readAscii(buf: Uint8Array, offset: number, maxLen: number): string {
  let str = '';
  for (let i = 0; i < maxLen && offset + i < buf.length; i++) {
    const c = buf[offset + i];
    if (c === 0) break;
    str += String.fromCharCode(c);
  }
  return str.trim();
}

export function isKurzweilFile(data: ArrayBuffer | Uint8Array): boolean {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (buf.length < 32) return false;
  return (
    buf[0] === 0x50 &&
    buf[1] === 0x52 &&
    buf[2] === 0x41 &&
    buf[3] === 0x4d
  );
}

export function parseKurzweilFile(data: ArrayBuffer | Uint8Array): ParsedKurzweilFile {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (!isKurzweilFile(buf)) {
    throw new Error('Not a valid Kurzweil K2xxx PRAM file');
  }

  const objectSize = readI32BE(buf, 4);
  const sampleDataOffset = Math.min(buf.length, Math.max(32, objectSize));

  const programs: KurzweilProgramObject[] = [];
  const keymaps = new Map<number, KurzweilKeymapObject>();
  const samples = new Map<number, KurzweilSampleObject>();
  const sampleAudioMap = new Map<string, ArrayBuffer>();

  let blockPos = 32;

  while (blockPos + 4 <= objectSize && blockPos + 4 <= buf.length) {
    const blockSize = readI32BE(buf, blockPos);
    if (blockSize >= 0) break;

    const actualBlockLen = -blockSize;
    const objStart = blockPos + 4;
    const objEnd = Math.min(objectSize, objStart + actualBlockLen);

    if (objStart + 6 <= objEnd) {
      const hash = readU16BE(buf, objStart);
      const nameOfs = readU16BE(buf, objStart + 4);

      const objType = hash >> 10;
      const objId = hash & 0x03ff;

      let name = '';
      if (nameOfs > 2 && objStart + 6 < objEnd) {
        name = readAscii(buf, objStart + 6, nameOfs - 2);
      }
      if (!name) name = `Object_${objId}`;

      const dataStart = objStart + 4 + nameOfs;

      if (objType === 38) {
        const sampleObj = parseSampleObject(buf, dataStart, objEnd, objId, name);
        samples.set(objId, sampleObj);
      } else if (objType === 37) {
        const keymapObj = parseKeymapObject(buf, dataStart, objEnd, objId, name);
        keymaps.set(objId, keymapObj);
      } else if (objType === 36) {
        const progObj = parseProgramObject(buf, dataStart, objEnd, objId, name);
        programs.push(progObj);
      }
    }

    blockPos += 4 + actualBlockLen;
    if (blockPos % 4 !== 0) {
      blockPos += 4 - (blockPos % 4);
    }
  }

  for (const [sId, sObj] of samples) {
    for (let hIdx = 0; hIdx < sObj.headers.length; hIdx++) {
      const h = sObj.headers[hIdx];
      if (!h.samplePresent) continue;

      const startByte = sampleDataOffset + h.sampleStart * 2;
      const endByte = sampleDataOffset + (h.sampleEnd + 1) * 2;

      if (startByte < buf.length && endByte <= buf.length && endByte > startByte) {
        const wordCount = h.sampleEnd - h.sampleStart + 1;
        const pcm16 = new Int16Array(wordCount);

        for (let w = 0; w < wordCount; w++) {
          const byteIdx = startByte + w * 2;
          pcm16[w] = (buf[byteIdx] << 8) | buf[byteIdx + 1];
        }

        const wavBytes = pcm16ToWavBuffer(pcm16, h.sampleRateHz || 44100);
        const sampleKey = `${sObj.name}_${sId}_${hIdx + 1}.wav`;
        sampleAudioMap.set(sampleKey, wavBytes);
      }
    }
  }

  return {
    programs,
    keymaps,
    samples,
    sampleAudioMap,
  };
}

function parseSampleObject(
  buf: Uint8Array,
  start: number,
  end: number,
  id: number,
  name: string
): KurzweilSampleObject {
  if (start + 8 > end) {
    return { id, name, isStereo: false, headers: [] };
  }

  const numHeaders = readI16BE(buf, start + 2) + 1;
  const headersOfs = readI16BE(buf, start + 4);
  const flags = buf[start + 6];
  const isStereo = (flags & 0x01) !== 0;

  const headers: KurzweilSampleHeader[] = [];
  let hPos = start + 4 + headersOfs;

  for (let i = 0; i < numHeaders && hPos + 32 <= end; i++) {
    const rootKey = buf[hPos];
    const hFlags = buf[hPos + 1];
    const loopOff = (hFlags & 0x80) !== 0;
    const samplePresent = (hFlags & 0x40) !== 0;
    const volAdjust = (buf[hPos + 2] > 127 ? buf[hPos + 2] - 256 : buf[hPos + 2]) * 0.5;

    const sampleStart = readI32BE(buf, hPos + 8);
    const loopStart = readI32BE(buf, hPos + 16);
    const sampleEnd = readI32BE(buf, hPos + 20);
    const samplePeriodNs = readI32BE(buf, hPos + 28);
    const sampleRateHz = samplePeriodNs > 0 ? Math.round(1e9 / samplePeriodNs) : 44100;

    headers.push({
      rootKey,
      loopOff: loopOff || loopStart >= sampleEnd,
      samplePresent,
      volumeAdjustDb: volAdjust,
      sampleStart,
      loopStart,
      sampleEnd,
      sampleRateHz,
    });

    hPos += 32;
  }

  return { id, name, isStereo, headers };
}

function parseKeymapObject(
  buf: Uint8Array,
  start: number,
  end: number,
  id: number,
  name: string
): KurzweilKeymapObject {
  if (start + 14 > end) {
    return { id, name, entries: [] };
  }

  const sampleId = readI16BE(buf, start);
  const method = readI16BE(buf, start + 2);
  const basePitch = readI16BE(buf, start + 4);
  const centsPerEntry = readI16BE(buf, start + 6) || 100;
  const entriesPerVel = readI16BE(buf, start + 8) + 1;
  const entrySize = readI16BE(buf, start + 10);

  const entries: KurzweilKeymapEntry[] = [];
  const tableStart = start + 12 + 16;

  for (let i = 0; i < entriesPerVel && tableStart + (i + 1) * entrySize <= end; i++) {
    const ePos = tableStart + i * entrySize;
    let tuning = 0;
    let sId = sampleId;
    let subSample = 1;

    let p = ePos;
    if ((method & 0x10) !== 0) {
      tuning = readI16BE(buf, p);
      p += 2;
    } else if ((method & 0x08) !== 0) {
      tuning = buf[p] > 127 ? buf[p] - 256 : buf[p];
      p += 1;
    }

    if ((method & 0x04) !== 0) {
      p += 1;
    }

    if ((method & 0x02) !== 0) {
      sId = readI16BE(buf, p);
      p += 2;
    }

    if ((method & 0x01) !== 0) {
      subSample = buf[p];
    }

    const note = Math.min(127, Math.max(0, 12 + Math.round((basePitch + i * centsPerEntry) / 100)));
    entries.push({
      note,
      sampleId: sId,
      subSampleNum: subSample,
      tuningCents: tuning,
    });
  }

  return { id, name, entries };
}

function parseProgramObject(
  buf: Uint8Array,
  start: number,
  end: number,
  id: number,
  name: string
): KurzweilProgramObject {
  let keymapId = 0;
  let lowKey = 0;
  let highKey = 127;
  let cutoffHz = 20000;
  let resonanceDb = 0;

  let pos = start;
  while (pos < end) {
    const tag = buf[pos];
    if (tag === 0) break;

    let segLen = 0;
    if (tag === 8 || tag === 9) segLen = 15;
    else if (tag === 15) segLen = 7;
    else {
      const group = tag & 0xf8;
      if (group === 16 || group === 20) segLen = 7;
      else if (group === 24) segLen = 3;
      else if (group === 32) segLen = 15;
      else if (group === 64) segLen = 31;
      else if (group === 80) segLen = 15;
      else if (group === 104) segLen = 7;
      else if (group === 120) segLen = 31;
      else segLen = 15;
    }

    const dPos = pos + 1;
    if (tag === 9 && dPos + 5 <= end) {
      lowKey = buf[dPos + 3];
      highKey = buf[dPos + 4];
    } else if (tag === 64 && dPos + 13 <= end) {
      keymapId = readU16BE(buf, dPos + 11);
    } else if (tag === 0x50 && dPos + 2 <= end) {
      const cutoffByte = buf[dPos + 1] > 127 ? buf[dPos + 1] - 256 : buf[dPos + 1];
      cutoffHz = Math.round(440 * Math.pow(2, (cutoffByte - 9) / 12));
    } else if (tag === 0x51 && dPos + 2 <= end) {
      resonanceDb = buf[dPos + 1] * 0.5;
    }

    pos += 1 + segLen;
  }

  return {
    id,
    name,
    keymapId,
    lowKey,
    highKey,
    cutoffHz: Math.max(20, Math.min(20000, cutoffHz)),
    resonanceDb,
  };
}

export function convertKurzweilToPreset(
  krz: ParsedKurzweilFile,
  targetProgId?: number
): ParsedSamplerPreset {
  const targetProg = targetProgId !== undefined
    ? krz.programs.find(p => p.id === targetProgId) || krz.programs[0]
    : krz.programs[0];

  const progName = targetProg ? targetProg.name : 'Kurzweil Program';
  const regions: ParsedImportRegion[] = [];
  const audioBuffers = new Map<string, ArrayBuffer>();

  for (const [k, v] of krz.sampleAudioMap.entries()) {
    audioBuffers.set(k, v);
  }

  const km = targetProg ? krz.keymaps.get(targetProg.keymapId) : krz.keymaps.values().next().value;

  if (km) {
    for (const e of km.entries) {
      if (e.subSampleNum <= 0) continue;
      const sObj = krz.samples.get(e.sampleId);
      if (!sObj || e.subSampleNum > sObj.headers.length) continue;

      const h = sObj.headers[e.subSampleNum - 1];
      const sampleKey = `${sObj.name}_${sObj.id}_${e.subSampleNum}.wav`;

      regions.push({
        id: `krz_${regions.length + 1}`,
        sampleName: sampleKey,
        samplePath: sampleKey,
        rootKey: h.rootKey || e.note,
        lowKey: e.note,
        highKey: e.note,
        lowVel: 0,
        highVel: 127,
        detuneCents: e.tuningCents,
        volumeDb: h.volumeAdjustDb,
        pan: 0,
        loopMode: h.loopOff ? 'no_loop' : 'loop_continuous',
        loopStart: Math.max(0, h.loopStart - h.sampleStart),
        loopEnd: Math.max(0, h.sampleEnd - h.sampleStart),
      });
    }
  }

  return {
    format: 'kurzweil',
    formatLabel: 'Kurzweil K2xxx / PC3 (.krz)',
    presetName: progName,
    modelName: progName.slice(0, 11),
    detectedCategory: 'vintage',
    suggestedParameterSet: 1,
    regions,
    audioBuffers,
  };
}
