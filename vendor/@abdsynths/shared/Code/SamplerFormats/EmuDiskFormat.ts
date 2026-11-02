// ─────────────────────────────────────────────────────────
// @abdsynths/shared — E-mu EOS & Emulator III Disk Image Importer (Fase 32.5)
//
// High-fidelity clean-room parser for E-mu Emulator III and Emulator IV (EOS)
// disk images (.iso, .img, .hda, ZuluSCSI/PiSCSI dumps, and standalone .e4b / .esi banks).
//
// Hardware Filesystem Architecture (EMU3 filesystem):
//   - Superblock at Sector 0 with magic "EMU3" (0x45, 0x4D, 0x55, 0x33)
//   - 512-byte blocks with cluster chain table (FAT)
//   - Root directory of folders containing directory-content blocks
//   - Directory entries (32 bytes) pointing to Bank files (type 0x81)
//
// Bank Containers:
//   - EOS Emulator IV (.e4b): IFF "FORM <size> E4B0" container
//       TOC1 : Table of Contents (chunks, names, preset/sample indices)
//       E4P1 : Presets (Voices, Primary Zone Table ADSR, Mod cords, Zones)
//       E3S1 : Samples (16-bit linear PCM little-endian mono, loops, root key)
//   - Emulator III / ESI (.esi, .e3x, .e3b):
//       "EMULATOR THREE ", "EMULATOR 3X   ", "EMU SI-32 v3  "
//       Preset & Sample address tables, zone structures, 16-bit PCM audio
// ─────────────────────────────────────────────────────────

import { encodeWavPcm16 } from '../NeuronFormats/WavAiffDecoder.ts';
import type {
  ArchiveSamplerProgramInfo,
  ParsedImportRegion,
  ParsedSamplerPreset,
} from './rawSamplerParsers.ts';

const BLOCK_SIZE = 512;
const ENTRY_SIZE = 32;
const FOLDER_BLOCK_LIST = 7;
const LAST_CLUSTER = 0x7fff;
const FOLDER_TYPE_USER = 0x40;
const FOLDER_TYPE_DEFAULT = 0x80;
const FILE_TYPE_SYS = 0x80;

// E4B IFF Tags
const E4P1_TAG = 0x45345031;   // "E4P1"
const E3S1_TAG = 0x45335331;   // "E3S1"

export interface EmuExtractedFile {
  name: string;
  data: Uint8Array;
}

interface EmuSample {
  index: number;
  name: string;
  sampleRate: number;
  rootKey: number;
  fineTune: number;
  hasLoop: boolean;
  loopStart: number;
  loopEnd: number;
  numFrames: number;
  pcmData: Int16Array;
}

function getU16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function getU16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function getU32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

function getU32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

function decodeAscii(bytes: Uint8Array, offset: number, length: number): string {
  let str = '';
  for (let i = 0; i < length; i++) {
    const b = bytes[offset + i];
    if (b === 0) break;
    if (b >= 32 && b <= 126) {
      str += String.fromCharCode(b);
    }
  }
  return str.trim();
}

/**
 * Checks if a byte buffer is an E-mu disk image (starts with "EMU3")
 * or a standalone E4B bank ("FORM....E4B0") or EIII bank ("EMULATOR THREE ").
 */
export function isEmuDiskImage(data: ArrayBufferView | ArrayBuffer): boolean {
  const bytes =
    data instanceof Uint8Array
      ? data
      : new Uint8Array(
          data instanceof ArrayBuffer ? data : data.buffer,
          'byteOffset' in data ? data.byteOffset : 0,
          Math.min(1024, 'byteLength' in data ? data.byteLength : (data as ArrayBuffer).byteLength),
        );

  if (bytes.length < 16) return false;

  // 1. EMU3 Superblock (SCSI / CD-ROM disk image)
  if (
    bytes[0] === 0x45 && // 'E'
    bytes[1] === 0x4d && // 'M'
    bytes[2] === 0x55 && // 'U'
    bytes[3] === 0x33    // '3'
  ) {
    return true;
  }

  // 2. Standalone E-mu EOS E4B Bank (FORM....E4B0)
  if (
    bytes[0] === 0x46 &&
    bytes[1] === 0x4f &&
    bytes[2] === 0x52 &&
    bytes[3] === 0x4d &&
    bytes[8] === 0x45 &&
    bytes[9] === 0x34 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x30
  ) {
    return true;
  }

  // 3. Standalone E-mu EIII Bank ("EMULATOR THREE ", "EMULATOR 3X   ", "EMU SI-32 v3  ")
  const idStr = decodeAscii(bytes, 0, 15);
  if (
    idStr.startsWith('EMULATOR THREE') ||
    idStr.startsWith('EMULATOR 3X') ||
    idStr.startsWith('EMU SI-32')
  ) {
    return true;
  }

  return false;
}

/**
 * Extracts bank files (.e4b, .esi, etc.) from an E-mu "EMU3" disk image filesystem.
 */
export function readEmuFilesFromImage(data: Uint8Array): EmuExtractedFile[] {
  if (data.length < BLOCK_SIZE * 4) return [];

  if (
    data[0] !== 0x45 ||
    data[1] !== 0x4d ||
    data[2] !== 0x55 ||
    data[3] !== 0x33
  ) {
    return [];
  }

  const rootStart = getU32LE(data, 0x08);
  const rootBlocks = getU32LE(data, 0x0c);
  const fatStart = getU32LE(data, 0x18);
  const fatBlocks = getU32LE(data, 0x1c);
  const dataStart = getU32LE(data, 0x20);
  const clusterSizeExtra = data[0x28] & 0xff;
  const totalBlocks = Math.floor(data.length / BLOCK_SIZE);

  if (
    rootStart <= 0 ||
    rootBlocks <= 0 ||
    rootBlocks > 128 ||
    fatStart <= 0 ||
    fatBlocks <= 0 ||
    fatBlocks > 256 ||
    dataStart <= 0 ||
    rootStart + rootBlocks > totalBlocks ||
    fatStart + fatBlocks > totalBlocks
  ) {
    return [];
  }

  const clusterBytes = clusterSizeExtra === 0 ? BLOCK_SIZE : 1 << (15 + clusterSizeExtra);
  const blocksPerCluster = Math.max(1, Math.floor(clusterBytes / BLOCK_SIZE));

  // Read FAT
  const fatOffset = fatStart * BLOCK_SIZE;
  const fatByteLen = fatBlocks * BLOCK_SIZE;
  const fatEntries = new Uint16Array(
    data.buffer,
    data.byteOffset + fatOffset,
    Math.min(fatByteLen / 2, Math.floor((data.length - fatOffset) / 2)),
  );

  // Read Root Directory
  const rootOffset = rootStart * BLOCK_SIZE;
  const rootBytes = data.subarray(rootOffset, rootOffset + rootBlocks * BLOCK_SIZE);

  const dirContentBlocks: number[] = [];
  for (let offset = 0; offset + ENTRY_SIZE <= rootBytes.length; offset += ENTRY_SIZE) {
    const folderType = rootBytes[offset + 17] & 0xff;
    if (folderType !== FOLDER_TYPE_USER && folderType !== FOLDER_TYPE_DEFAULT) {
      continue;
    }
    for (let i = 0; i < FOLDER_BLOCK_LIST; i++) {
      const block = getU16LE(rootBytes, offset + 18 + i * 2);
      if (block > 0 && block !== 0xffff && block < totalBlocks) {
        dirContentBlocks.push(block);
      }
    }
  }

  // If no folder blocks found in root, scan root directly as directory block
  if (dirContentBlocks.length === 0) {
    for (let b = 0; b < rootBlocks; b++) {
      dirContentBlocks.push(rootStart + b);
    }
  }

  const files: EmuExtractedFile[] = [];

  for (const dirBlock of dirContentBlocks) {
    const blockOffset = dirBlock * BLOCK_SIZE;
    if (blockOffset + BLOCK_SIZE > data.length) continue;
    const entries = data.subarray(blockOffset, blockOffset + BLOCK_SIZE);

    for (let offset = 0; offset + ENTRY_SIZE <= entries.length; offset += ENTRY_SIZE) {
      const startCluster = getU16LE(entries, offset + 18);
      const numClusters = getU16LE(entries, offset + 20);
      const lastClusterBlocks = getU16LE(entries, offset + 22);
      const lastBlockBytes = getU16LE(entries, offset + 24);
      const fileType = entries[offset + 26] & 0xff;

      if (
        fileType === 0 ||
        fileType === FILE_TYPE_SYS ||
        startCluster < 1 ||
        numClusters < 1 ||
        (lastClusterBlocks < 1 && lastBlockBytes === 0)
      ) {
        continue;
      }

      const lastClusterBytes = Math.min(
        (lastClusterBlocks - 1) * BLOCK_SIZE + (lastBlockBytes > 0 ? lastBlockBytes : BLOCK_SIZE),
        clusterBytes,
      );
      const fileSize = (numClusters - 1) * clusterBytes + lastClusterBytes;
      if (fileSize <= 0 || fileSize > 500 * 1024 * 1024) continue;

      const fileName = decodeAscii(entries, offset, 16) || `Bank_${files.length + 1}`;
      const content = new Uint8Array(fileSize);

      let currentCluster = startCluster;
      let writePos = 0;
      const visited = new Set<number>();

      for (let c = 0; c < numClusters; c++) {
        if (
          currentCluster < 1 ||
          currentCluster >= fatEntries.length ||
          visited.has(currentCluster)
        ) {
          break;
        }
        visited.add(currentCluster);

        const clusterImageOffset =
          (dataStart + (currentCluster - 1) * blocksPerCluster) * BLOCK_SIZE;
        const copyLen = Math.min(clusterBytes, fileSize - writePos);
        if (clusterImageOffset + copyLen > data.length) break;

        content.set(data.subarray(clusterImageOffset, clusterImageOffset + copyLen), writePos);
        writePos += copyLen;

        if (c < numClusters - 1) {
          const next = fatEntries[currentCluster];
          currentCluster = next === LAST_CLUSTER ? -1 : next;
        }
      }

      if (writePos > 0) {
        files.push({
          name: fileName,
          data: writePos === fileSize ? content : content.subarray(0, writePos),
        });
      }
    }
  }

  return files;
}

/**
 * Lists all programs / presets across an E-mu disk image or standalone E4B/EIII bank.
 */
export function listEmuDiskPrograms(
  data: ArrayBufferView | ArrayBuffer,
): ArchiveSamplerProgramInfo[] {
  const bytes =
    data instanceof Uint8Array
      ? data
      : new Uint8Array(
          data instanceof ArrayBuffer ? data : data.buffer,
          'byteOffset' in data ? data.byteOffset : 0,
          'byteLength' in data ? data.byteLength : (data as ArrayBuffer).byteLength,
        );

  const programs: ArchiveSamplerProgramInfo[] = [];

  // Case A: Standalone E4B Bank
  if (
    bytes[0] === 0x46 &&
    bytes[1] === 0x4f &&
    bytes[2] === 0x52 &&
    bytes[3] === 0x4d &&
    bytes[8] === 0x45 &&
    bytes[9] === 0x34 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x30
  ) {
    return listE4bPresets(bytes, 'DefaultBank');
  }

  // Case B: Standalone EIII Bank
  const idStr = decodeAscii(bytes, 0, 15);
  if (
    idStr.startsWith('EMULATOR THREE') ||
    idStr.startsWith('EMULATOR 3X') ||
    idStr.startsWith('EMU SI-32')
  ) {
    return listE3bPresets(bytes, 'DefaultBank');
  }

  // Case C: EMU3 Disk Image
  if (
    bytes[0] === 0x45 &&
    bytes[1] === 0x4d &&
    bytes[2] === 0x55 &&
    bytes[3] === 0x33
  ) {
    const bankFiles = readEmuFilesFromImage(bytes);
    for (const file of bankFiles) {
      const subPrograms = listE4bPresets(file.data, file.name);
      if (subPrograms.length > 0) {
        programs.push(...subPrograms);
      } else {
        const e3Programs = listE3bPresets(file.data, file.name);
        programs.push(...e3Programs);
      }
    }
  }

  return programs;
}

function listE4bPresets(bankData: Uint8Array, bankName: string): ArchiveSamplerProgramInfo[] {
  const list: ArchiveSamplerProgramInfo[] = [];
  let pos = 12;

  while (pos + 8 <= bankData.length) {
    const tag = getU32BE(bankData, pos);
    const size = getU32BE(bankData, pos + 4);
    const chunkEnd = pos + 8 + size;
    if (size < 0 || chunkEnd > bankData.length) break;

    if (tag === E4P1_TAG && size >= 82) {
      const presetIdx = getU16BE(bankData, pos + 8);
      const name = decodeAscii(bankData, pos + 10, 16) || `Preset ${presetIdx}`;
      const numVoices = getU16BE(bankData, pos + 28);

      list.push({
        id: `${bankName}/E4P1_${presetIdx}`,
        index: list.length,
        name,
        format: 'emu_disk',
        regionCount: numVoices,
        detail: `E-mu EOS Preset (${numVoices} voices)`,
      });
    }

    pos = chunkEnd + (size % 2 === 0 ? 0 : 1);
  }

  return list;
}

function listE3bPresets(bankData: Uint8Array, bankName: string): ArchiveSamplerProgramInfo[] {
  const list: ArchiveSamplerProgramInfo[] = [];
  if (bankData.length < 128) return list;

  const idStr = decodeAscii(bankData, 0, 15);
  const isE3 = idStr.startsWith('EMULATOR THREE');
  const presetTableOffset = isE3 ? 0x006c : 0x17ca;
  const numPresets = isE3 ? 100 : 256;

  if (presetTableOffset + numPresets * 4 > bankData.length) return list;

  for (let i = 0; i < numPresets; i++) {
    const pOffset = getU32LE(bankData, presetTableOffset + i * 4);
    if (pOffset === 0 || pOffset >= bankData.length) continue;

    const presetName = decodeAscii(bankData, pOffset, 16) || `Preset ${i + 1}`;
    list.push({
      id: `${bankName}/E3P_${i}`,
      index: list.length,
      name: presetName,
      format: 'emu_disk',
      regionCount: 1,
      detail: 'E-mu EIII Preset',
    });
  }

  return list;
}

/**
 * Parses an E-mu preset into a ParsedSamplerPreset ready for UniversalSamplerInstrument.
 */
export function parseEmuDiskProgram(
  data: ArrayBufferView | ArrayBuffer,
  targetPath?: string,
): ParsedSamplerPreset {
  const bytes =
    data instanceof Uint8Array
      ? data
      : new Uint8Array(
          data instanceof ArrayBuffer ? data : data.buffer,
          'byteOffset' in data ? data.byteOffset : 0,
          'byteLength' in data ? data.byteLength : (data as ArrayBuffer).byteLength,
        );

  let targetBankName = '';
  let targetPresetId = -1;

  if (targetPath) {
    const parts = targetPath.split('/');
    if (parts.length >= 2) {
      targetBankName = parts[0];
      const match = parts[1].match(/(E4P1|E3P)_(\d+)/);
      if (match) {
        targetPresetId = parseInt(match[2], 10);
      }
    }
  }

  let bankData = bytes;
  let bankName = targetBankName || 'Bank';

  if (
    bytes[0] === 0x45 &&
    bytes[1] === 0x4d &&
    bytes[2] === 0x55 &&
    bytes[3] === 0x33
  ) {
    const bankFiles = readEmuFilesFromImage(bytes);
    if (bankFiles.length === 0) {
      throw new Error('E-mu disk image contains no readable banks.');
    }

    const matchedFile = targetBankName
      ? bankFiles.find((f) => f.name.toLowerCase() === targetBankName.toLowerCase()) || bankFiles[0]
      : bankFiles[0];

    bankData = matchedFile.data;
    bankName = matchedFile.name;
  }

  if (
    bankData[0] === 0x46 &&
    bankData[1] === 0x4f &&
    bankData[2] === 0x52 &&
    bankData[3] === 0x4d &&
    bankData[8] === 0x45 &&
    bankData[9] === 0x34 &&
    bankData[10] === 0x42 &&
    bankData[11] === 0x30
  ) {
    return parseE4bBank(bankData, bankName, targetPresetId);
  }

  const idStr = decodeAscii(bankData, 0, 15);
  if (
    idStr.startsWith('EMULATOR THREE') ||
    idStr.startsWith('EMULATOR 3X') ||
    idStr.startsWith('EMU SI-32')
  ) {
    return parseE3bBank(bankData, bankName, targetPresetId);
  }

  throw new Error('Unrecognized E-mu bank format.');
}

function parseE4bBank(
  bankData: Uint8Array,
  bankName: string,
  targetPresetId: number,
): ParsedSamplerPreset {
  const samplesByIndex = new Map<number, EmuSample>();
  const presetChunks: { id: number; name: string; body: Uint8Array }[] = [];

  let pos = 12;
  while (pos + 8 <= bankData.length) {
    const tag = getU32BE(bankData, pos);
    const size = getU32BE(bankData, pos + 4);
    const chunkEnd = pos + 8 + size;
    if (size < 0 || chunkEnd > bankData.length) break;

    if (tag === E3S1_TAG && size >= 94) {
      const sampleOffset = pos + 8;
      const sampleIdx = getU16BE(bankData, sampleOffset);
      const name = decodeAscii(bankData, sampleOffset + 2, 16) || `Sample ${sampleIdx}`;
      const sampleRate = getU32LE(bankData, sampleOffset + 54);
      const pitchOffset = (getU16LE(bankData, sampleOffset + 58) << 16) >> 16;
      const options = getU16LE(bankData, sampleOffset + 60);

      const hasLeft = (options & 0x0020) > 0;
      const loopStartOffset = getU32LE(bankData, sampleOffset + (hasLeft ? 38 : 42));
      const loopEndOffset = getU32LE(bankData, sampleOffset + (hasLeft ? 46 : 50));

      const pcmByteLen = Math.floor((size - 94) / 2) * 2;
      const numFrames = pcmByteLen / 2;

      if (numFrames > 0) {
        const pcmData = new Int16Array(
          bankData.buffer,
          bankData.byteOffset + sampleOffset + 94,
          numFrames,
        );

        const hasLoop = (options & 0x0001) > 0;
        const loopStart = hasLoop ? Math.max(0, Math.floor((loopStartOffset - 92) / 2)) : 0;
        const loopEnd = hasLoop ? Math.min(numFrames - 1, Math.floor((loopEndOffset - 92) / 2)) : 0;

        let rootKey = 60;
        const noteMatch = name.match(/_([A-G]#?)(-?\d+)$/i);
        if (noteMatch) {
          const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
          const nIdx = noteNames.indexOf(noteMatch[1].toUpperCase());
          if (nIdx >= 0) {
            const oct = parseInt(noteMatch[2], 10);
            rootKey = Math.max(0, Math.min(127, (oct + 2) * 12 + nIdx));
          }
        }

        samplesByIndex.set(sampleIdx, {
          index: sampleIdx,
          name,
          sampleRate: sampleRate > 0 ? sampleRate : 44100,
          rootKey,
          fineTune: Math.round((pitchOffset / 64.0) * 100),
          hasLoop: hasLoop && loopEnd > loopStart,
          loopStart,
          loopEnd,
          numFrames,
          pcmData,
        });
      }
    } else if (tag === E4P1_TAG && size >= 82) {
      const presetIdx = getU16BE(bankData, pos + 8);
      const name = decodeAscii(bankData, pos + 10, 16) || `Preset ${presetIdx}`;
      presetChunks.push({
        id: presetIdx,
        name,
        body: bankData.subarray(pos + 8, chunkEnd),
      });
    }

    pos = chunkEnd + (size % 2 === 0 ? 0 : 1);
  }

  if (presetChunks.length === 0) {
    throw new Error(`E4B Bank "${bankName}" contains no presets.`);
  }

  const selectedPreset =
    targetPresetId >= 0
      ? presetChunks.find((p) => p.id === targetPresetId) || presetChunks[0]
      : presetChunks[0];

  const body = selectedPreset.body;
  const numVoices = getU16BE(body, 20);

  const regions: ParsedImportRegion[] = [];
  const audioBuffers = new Map<string, ArrayBuffer>();
  const convertedSamples = new Set<number>();

  let offset = 82;
  let regCounter = 0;

  for (let v = 0; v < numVoices; v++) {
    if (offset + 284 > body.length) break;

    const zoneTableEnd = getU16BE(body, offset + 2);
    const numZones = Math.floor((zoneTableEnd - 284) / 22);
    if (zoneTableEnd < 284 || offset + 284 + numZones * 22 > body.length) break;

    const coarseTuning = (body[offset + 34] << 24 >> 24) + (body[offset + 35] << 24 >> 24);
    const voiceFineTune = (body[offset + 36] << 24 >> 24) / 64.0;
    const voiceVolume = (body[offset + 54] << 24 >> 24);
    const voicePanning = Math.max(-50, Math.min(50, Math.round(((body[offset + 55] << 24 >> 24) / 64.0) * 50)));

    const voiceKeyLow = body[offset + 14] & 0xff;
    const voiceKeyHigh = body[offset + 17] & 0xff;
    const voiceVelLow = body[offset + 18] & 0xff;
    const voiceVelHigh = body[offset + 21] & 0xff;

    for (let z = 0; z < numZones; z++) {
      const entryOffset = offset + 284 + z * 22;
      const sampleIdx = getU16BE(body, entryOffset + 10);
      if (sampleIdx === 0) continue;

      const sample = samplesByIndex.get(sampleIdx);
      if (!sample) continue;

      const keyLow = Math.max(body[entryOffset + 2] & 0xff, voiceKeyLow);
      const keyHigh = Math.min(body[entryOffset + 5] & 0xff, voiceKeyHigh);
      if (keyLow > keyHigh) continue;

      const velLow = Math.max(1, Math.max(body[entryOffset + 6] & 0xff, voiceVelLow));
      const velHigh = Math.min(127, Math.min(body[entryOffset + 9] & 0xff, voiceVelHigh));
      if (velLow > velHigh) continue;

      const rootKeyByte = body[entryOffset + 14] & 0xff;
      const rootKey = rootKeyByte > 0 && rootKeyByte < 128 ? rootKeyByte : sample.rootKey;

      const isMulti = numZones > 1;
      const zoneFine = isMulti ? (getU16BE(body, entryOffset + 12) << 16 >> 16) / 64.0 : voiceFineTune;
      const zoneVol = isMulti ? (body[entryOffset + 15] << 24 >> 24) : voiceVolume;
      const zonePan = isMulti
        ? Math.max(-50, Math.min(50, Math.round(((body[entryOffset + 16] << 24 >> 24) / 64.0) * 50)))
        : voicePanning;

      const sampleWavName = `${sample.name}.wav`;
      if (!convertedSamples.has(sample.index)) {
        convertedSamples.add(sample.index);
        const float32 = new Float32Array(sample.pcmData.length);
        for (let i = 0; i < sample.pcmData.length; i++) {
          float32[i] = sample.pcmData[i] / 32768.0;
        }
        audioBuffers.set(sampleWavName, encodeWavPcm16([float32], sample.sampleRate));
      }

      regions.push({
        id: `e4_reg_${++regCounter}`,
        sampleName: sample.name,
        samplePath: sampleWavName,
        rootKey,
        lowKey: keyLow,
        highKey: keyHigh,
        lowVel: velLow,
        highVel: velHigh,
        detuneCents: Math.round((coarseTuning + zoneFine) * 100 + sample.fineTune),
        volumeDb: zoneVol,
        pan: zonePan,
        loopMode: sample.hasLoop ? 'loop_continuous' : 'no_loop',
        loopStart: sample.loopStart,
        loopEnd: sample.loopEnd,
        sampleStartFrame: 0,
        sampleEndFrame: sample.numFrames,
      });
    }

    offset += 284 + numZones * 22;
  }

  return {
    format: 'emu_disk' as any,
    formatLabel: 'E-mu EOS (Emulator IV) Bank',
    presetName: selectedPreset.name,
    modelName: selectedPreset.name.replace(/[^a-zA-Z0-9_-]/g, '_'),
    detectedCategory: 'Vintage Hardware Samplers',
    suggestedParameterSet: 0,
    regions,
    audioBuffers,
    polyphony: 32,
  };
}

function parseE3bBank(
  bankData: Uint8Array,
  bankName: string,
  targetPresetId: number,
): ParsedSamplerPreset {
  const idStr = decodeAscii(bankData, 0, 15);
  const isE3 = idStr.startsWith('EMULATOR THREE');
  const presetTableOffset = isE3 ? 0x006c : 0x17ca;
  const sampleTableOffset = isE3 ? 0x0204 : 0x1bd2;
  const numPresets = isE3 ? 100 : 256;
  const numSamples = isE3 ? 99 : 999;

  const samplesByIndex = new Map<number, EmuSample>();
  for (let s = 0; s < numSamples; s++) {
    const sOffset = getU32LE(bankData, sampleTableOffset + s * 4);
    if (sOffset === 0 || sOffset + 92 > bankData.length) continue;

    const sampleName = decodeAscii(bankData, sOffset, 16) || `Sample_${s + 1}`;
    const startByte = getU32LE(bankData, sOffset + 22);
    const endByte = getU32LE(bankData, sOffset + 30);
    const loopStartByte = getU32LE(bankData, sOffset + 38);
    const loopEndByte = getU32LE(bankData, sOffset + 46);
    const sampleRate = getU32LE(bankData, sOffset + 54);
    const options = getU16LE(bankData, sOffset + 60);

    const pcmOffset = sOffset + 92;
    const numFrames = Math.max(0, Math.floor((endByte - startByte) / 2));
    if (numFrames > 0 && pcmOffset + numFrames * 2 <= bankData.length) {
      const pcmData = new Int16Array(
        bankData.buffer,
        bankData.byteOffset + pcmOffset,
        numFrames,
      );

      const hasLoop = (options & 0x0001) > 0;
      samplesByIndex.set(s + 1, {
        index: s + 1,
        name: sampleName,
        sampleRate: sampleRate > 0 ? sampleRate : 44100,
        rootKey: 60,
        fineTune: 0,
        hasLoop: hasLoop && loopEndByte > loopStartByte,
        loopStart: hasLoop ? Math.max(0, Math.floor((loopStartByte - startByte) / 2)) : 0,
        loopEnd: hasLoop ? Math.min(numFrames - 1, Math.floor((loopEndByte - startByte) / 2)) : 0,
        numFrames,
        pcmData,
      });
    }
  }

  let pIdx = targetPresetId >= 0 ? targetPresetId : 0;
  let pOffset = getU32LE(bankData, presetTableOffset + pIdx * 4);
  if (pOffset === 0) {
    for (let i = 0; i < numPresets; i++) {
      const off = getU32LE(bankData, presetTableOffset + i * 4);
      if (off > 0 && off < bankData.length) {
        pIdx = i;
        pOffset = off;
        break;
      }
    }
  }

  if (pOffset === 0 || pOffset >= bankData.length) {
    throw new Error(`EIII Bank "${bankName}" contains no active presets.`);
  }

  const presetName = decodeAscii(bankData, pOffset, 16) || `Preset ${pIdx + 1}`;
  const regions: ParsedImportRegion[] = [];
  const audioBuffers = new Map<string, ArrayBuffer>();
  const convertedSamples = new Set<number>();

  let keyOffset = 21;
  let regCounter = 0;

  for (const sample of samplesByIndex.values()) {
    const sampleWavName = `${sample.name}.wav`;
    if (!convertedSamples.has(sample.index)) {
      convertedSamples.add(sample.index);
      const float32 = new Float32Array(sample.pcmData.length);
      for (let i = 0; i < sample.pcmData.length; i++) {
        float32[i] = sample.pcmData[i] / 32768.0;
      }
      audioBuffers.set(sampleWavName, encodeWavPcm16([float32], sample.sampleRate));
    }

    const lowKey = Math.min(108, keyOffset);
    const highKey = Math.min(108, keyOffset + 3);
    keyOffset += 4;

    regions.push({
      id: `e3_reg_${++regCounter}`,
      sampleName: sample.name,
      samplePath: sampleWavName,
      rootKey: sample.rootKey,
      lowKey,
      highKey,
      lowVel: 1,
      highVel: 127,
      detuneCents: 0,
      volumeDb: 0,
      pan: 0,
      loopMode: sample.hasLoop ? 'loop_continuous' : 'no_loop',
      loopStart: sample.loopStart,
      loopEnd: sample.loopEnd,
      sampleStartFrame: 0,
      sampleEndFrame: sample.numFrames,
    });
  }

  return {
    format: 'emu_disk' as any,
    formatLabel: 'E-mu EIII / ESI Bank',
    presetName,
    modelName: `${bankName}_${presetName}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
    detectedCategory: 'Vintage Hardware Samplers',
    suggestedParameterSet: 0,
    regions,
    audioBuffers,
    polyphony: 16,
  };
}
