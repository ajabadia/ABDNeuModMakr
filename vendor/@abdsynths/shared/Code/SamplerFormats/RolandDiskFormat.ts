// ─────────────────────────────────────────────────────────
// @abdsynths/shared — Roland S-7xx Sampler Disk Image Importer (Fase 32.5)
//
// High-fidelity clean-room parser for Roland S-7xx sampler disk images:
//   - S-770 / S-750 / S-760 / SP-700 CD-ROM, SCSI HD and Floppy disk images (.iso, .img, .out)
//
// Roland S-770 Disk Layout:
//   - Offset 0x000000: ID Area (512 B) - Magic "770" at offset 5 (or header version)
//   - Offset 0x000800: Program Text
//   - Offset 0x080800: FAT Area (128 KB, 0x10000 entries of 16-bit segment pointers)
//   - Offset 0x0A0800: Directory Area (Volume, Performance, Patch, Partial, Sample entries)
//   - Offset 0x10D800: Parameter Area (Volumes, Performances, Patches, Partials, Samples)
//   - Offset 0x2B5800: Audio Area (Segments of 0x2400 = 9216 bytes 16-bit linear mono PCM)
// ─────────────────────────────────────────────────────────

import { encodeWavPcm16 } from '../NeuronFormats/WavAiffDecoder.ts';
import type {
  ArchiveSamplerProgramInfo,
  ParsedImportRegion,
  ParsedSamplerPreset,
} from './rawSamplerParsers.ts';

const SAMPLE_BLOCK_SIZE = 0x2400; // 9216 bytes per FAT cluster
const NUM_FAT_ENTRIES = 0x10000;
const FIRST_DATA_FAT_INDEX = 2;
const LAST_DATA_FAT_INDEX = 0xfff5;
const FAT_END_OF_CHAIN = 0xfff8;

const NUM_PATCH_ENTRIES = 1024;
const NUM_PARTIAL_ENTRIES = 4096;
const NUM_SAMPLE_ENTRIES = 8192;

const SAMPLING_FREQUENCIES = [48000, 44100, 24000, 22050, 30000, 15000];

function getU16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
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
 * Checks if a byte buffer is a Roland S-7xx disk image.
 * Tests offset 5 for "770" or S-5xx/S-7xx header signature.
 */
export function isRolandDiskImage(data: ArrayBufferView | ArrayBuffer): boolean {
  const bytes =
    data instanceof Uint8Array
      ? data
      : new Uint8Array(
          data instanceof ArrayBuffer ? data : data.buffer,
          'byteOffset' in data ? data.byteOffset : 0,
          Math.min(1024, 'byteLength' in data ? data.byteLength : (data as ArrayBuffer).byteLength),
        );

  if (bytes.length < 512) return false;

  const idStr = decodeAscii(bytes, 4, 10);
  if (idStr.includes('770') || idStr.includes('S-770') || idStr.includes('S-760')) {
    return true;
  }

  if (bytes[5] === 0x37 && bytes[6] === 0x37 && bytes[7] === 0x30) {
    return true;
  }

  return false;
}

interface RolandDirectoryEntry {
  name: string;
  fileType: number;
  fatEntry: number;
  numClusters: number;
  isFree: boolean;
}

interface RolandPartial {
  index: number;
  name: string;
  samples: {
    sampleIndex: number;
    velLow: number;
    velHigh: number;
    coarseTune: number;
    fineTune: number;
  }[];
}

interface RolandSample {
  index: number;
  name: string;
  startAddr: number;
  sustainLoopStart: number;
  sustainLoopEnd: number;
  loopMode: number;
  sustainLoopEnable: number;
  sampleFrequency: number;
  originalKey: number;
  fatEntry: number;
  numClusters: number;
}

/**
 * Lists all active patches / programs inside a Roland S-7xx disk image.
 */
export function listRolandDiskPrograms(
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
  if (bytes.length < 0x2b5800) return programs;

  // Directory Area starts at 0x0A0800
  // Patches directory is at 0x0A0800 + 0x008000 = 0x0A8800 (1024 entries of 32 bytes)
  const patchDirOffset = 0x0a8800;

  for (let i = 0; i < NUM_PATCH_ENTRIES; i++) {
    const dOffset = patchDirOffset + i * 32;
    if (dOffset + 32 > bytes.length) break;

    const firstByte = bytes[dOffset];
    if (firstByte === 0x00 || firstByte === 0xfe) continue;

    const patchName = decodeAscii(bytes, dOffset, 16) || `Patch ${i + 1}`;
    if (!patchName) continue;

    programs.push({
      id: `Roland/${i}`,
      index: programs.length,
      name: patchName,
      format: 'roland_disk',
      regionCount: 1,
      detail: 'Roland S-7xx Patch',
    });
  }

  return programs;
}

/**
 * Parses a Roland S-7xx patch and its referenced audio data from the disk image.
 */
export function parseRolandDiskProgram(
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

  if (bytes.length < 0x2b5800) {
    throw new Error('Roland S-7xx disk image is truncated or invalid.');
  }

  const diskName = decodeAscii(bytes, 0x100, 16) || 'RolandS7xx';

  let targetPatchIdx = -1;
  if (targetPath) {
    const match = targetPath.match(/(?:Roland\/)?(\d+)/i);
    if (match) targetPatchIdx = parseInt(match[1], 10);
  }

  // 1. Read FAT entries (128 KB at 0x080800)
  const fatOffset = 0x080800;
  const fatEntries = new Uint16Array(
    bytes.buffer,
    bytes.byteOffset + fatOffset,
    Math.min(NUM_FAT_ENTRIES, Math.floor((bytes.length - fatOffset) / 2)),
  );

  // 2. Read Sample Directory entries (at 0x0A0800 + 0x040000 = 0x0E0800, 8192 entries of 32 bytes)
  const sampleDirOffset = 0x0a0800 + 0x040000;
  const sampleDirEntries: RolandDirectoryEntry[] = [];
  for (let i = 0; i < NUM_SAMPLE_ENTRIES; i++) {
    const off = sampleDirOffset + i * 32;
    if (off + 32 > bytes.length) break;
    const firstByte = bytes[off];
    const isFree = firstByte === 0x00 || firstByte === 0xfe;
    sampleDirEntries.push({
      name: decodeAscii(bytes, off, 16),
      fileType: bytes[off + 16],
      fatEntry: getU16LE(bytes, off + 26),
      numClusters: getU16LE(bytes, off + 28),
      isFree,
    });
  }

  // 3. Read Patch Directory & choose patch
  const patchDirOffset = 0x0a8800;
  let selectedIdx = -1;
  let selectedName = '';

  if (targetPatchIdx >= 0 && targetPatchIdx < NUM_PATCH_ENTRIES) {
    const off = patchDirOffset + targetPatchIdx * 32;
    if (bytes[off] !== 0x00 && bytes[off] !== 0xfe) {
      selectedIdx = targetPatchIdx;
      selectedName = decodeAscii(bytes, off, 16);
    }
  }

  if (selectedIdx < 0) {
    for (let i = 0; i < NUM_PATCH_ENTRIES; i++) {
      const off = patchDirOffset + i * 32;
      if (bytes[off] !== 0x00 && bytes[off] !== 0xfe) {
        selectedIdx = i;
        selectedName = decodeAscii(bytes, off, 16);
        break;
      }
    }
  }

  if (selectedIdx < 0) {
    throw new Error('No active patches found in Roland S-7xx disk image.');
  }

  // 4. Read Patch parameters
  const patchParamOffset = 0x10d800 + 128 * 128 + 512 * 128 + selectedIdx * 256;
  const coarseTune = (bytes[patchParamOffset + 26] << 24) >> 24;
  const fineTune = (bytes[patchParamOffset + 27] << 24) >> 24;

  const keysPartial: number[] = [];
  const partialsOffset = patchParamOffset + 32;
  for (let k = 0; k < 88; k++) {
    keysPartial.push(bytes[partialsOffset + k]);
  }

  // 5. Read Partials
  const partialBaseOffset = 0x10d800 + 128 * 128 + 512 * 128 + 1024 * 256;
  const partialsMap = new Map<number, RolandPartial>();

  const neededPartials = new Set<number>(keysPartial.filter((id) => id >= 0 && id < 128));
  for (const partId of neededPartials) {
    const off = partialBaseOffset + partId * 128;
    if (off + 128 > bytes.length) continue;

    const pName = decodeAscii(bytes, off, 16);
    const samples: RolandPartial['samples'] = [];
    const sampleSectionOffsets = [
      off + 16,               // Sample 0: 11 bytes + 5 pad = 16
      off + 16 + 11 + 5,      // Sample 1
      off + 16 + (11 + 5) * 2,// Sample 2
      off + 16 + (11 + 5) * 3,// Sample 3
    ];
    for (let s = 0; s < 4; s++) {
      const sOffset = sampleSectionOffsets[s];
      const sIndex = getU16LE(bytes, sOffset);
      const velLow = bytes[sOffset + 6] || 1;
      const velHigh = bytes[sOffset + 8] || 127;
      const sCoarse = (bytes[sOffset + 4] << 24) >> 24;
      const sFine = (bytes[sOffset + 5] << 24) >> 24;

      if (sIndex < NUM_SAMPLE_ENTRIES && !sampleDirEntries[sIndex]?.isFree) {
        samples.push({
          sampleIndex: sIndex,
          velLow,
          velHigh,
          coarseTune: sCoarse,
          fineTune: sFine,
        });
      }
    }

    partialsMap.set(partId, {
      index: partId,
      name: pName,
      samples,
    });
  }

  // 6. Read Samples parameters
  const sampleParamBaseOffset = partialBaseOffset + NUM_PARTIAL_ENTRIES * 128;
  const samplesMap = new Map<number, RolandSample>();
  const neededSampleIndices = new Set<number>();

  for (const part of partialsMap.values()) {
    for (const smp of part.samples) {
      neededSampleIndices.add(smp.sampleIndex);
    }
  }

  for (const sIdx of neededSampleIndices) {
    const off = sampleParamBaseOffset + sIdx * 48;
    if (off + 48 > bytes.length) continue;

    const sName = decodeAscii(bytes, off, 16);
    const startRaw = getU32LE(bytes, off + 16) >> 8;
    const susStart = getU32LE(bytes, off + 20) >> 8;
    const susEnd = getU32LE(bytes, off + 24) >> 8;
    const loopMode = bytes[off + 32];
    const susEnable = bytes[off + 33];
    const freqIdx = bytes[off + 38] & 0x0f;
    const origKey = bytes[off + 39] || 60;

    const dirEntry = sampleDirEntries[sIdx];

    samplesMap.set(sIdx, {
      index: sIdx,
      name: sName || `Sample_${sIdx + 1}`,
      startAddr: Number(startRaw),
      sustainLoopStart: Number(susStart),
      sustainLoopEnd: Number(susEnd),
      loopMode,
      sustainLoopEnable: susEnable,
      sampleFrequency: SAMPLING_FREQUENCIES[freqIdx] || 44100,
      originalKey: origKey,
      fatEntry: dirEntry ? dirEntry.fatEntry : 0,
      numClusters: dirEntry ? dirEntry.numClusters : 0,
    });
  }

  // 7. Extract Audio from Audio Area
  const audioAreaOffset = 0x2b5800;
  const audioBuffers = new Map<string, ArrayBuffer>();
  const audioFrames: Record<number, number> = {};

  for (const sIdx of neededSampleIndices) {
    const sample = samplesMap.get(sIdx);
    if (!sample || sample.fatEntry < FIRST_DATA_FAT_INDEX) continue;

    const pcmChunks: Uint8Array[] = [];
    let currentCluster = sample.fatEntry;
    let clusterCount = 0;

    while (
      currentCluster >= FIRST_DATA_FAT_INDEX &&
      currentCluster <= LAST_DATA_FAT_INDEX &&
      clusterCount < sample.numClusters
    ) {
      const clusterOffset = audioAreaOffset + (currentCluster - FIRST_DATA_FAT_INDEX) * SAMPLE_BLOCK_SIZE;
      if (clusterOffset + SAMPLE_BLOCK_SIZE > bytes.length) break;

      pcmChunks.push(bytes.subarray(clusterOffset, clusterOffset + SAMPLE_BLOCK_SIZE));
      clusterCount++;

      if (currentCluster >= fatEntries.length) break;
      const next = fatEntries[currentCluster];
      if (next >= FAT_END_OF_CHAIN) break;
      currentCluster = next;
    }

    if (pcmChunks.length > 0) {
      const totalBytes = pcmChunks.reduce((acc, c) => acc + c.length, 0);
      const fullPcm = new Uint8Array(totalBytes);
      let writePos = 0;
      for (const chunk of pcmChunks) {
        fullPcm.set(chunk, writePos);
        writePos += chunk.length;
      }

      const numFrames = Math.floor(fullPcm.length / 2);
      const float32 = new Float32Array(numFrames);
      for (let i = 0; i < numFrames; i++) {
        const sample16 = (fullPcm[i * 2] | (fullPcm[i * 2 + 1] << 8)) << 16 >> 16;
        float32[i] = sample16 / 32768.0;
      }

      const wavName = `${sample.name}.wav`;
      audioBuffers.set(wavName, encodeWavPcm16([float32], sample.sampleFrequency));
      audioFrames[sIdx] = numFrames;
    }
  }

  // 8. Build Regions across keyboard
  const regions: ParsedImportRegion[] = [];
  let regCounter = 0;

  let lowKey = 21;
  let currentPartId = -1;

  for (let k = 0; k < keysPartial.length; k++) {
    const key = 21 + k;
    const partId = keysPartial[k];

    if (currentPartId === -1) {
      currentPartId = partId;
    } else if (currentPartId !== partId || key === 108) {
      const highKey = key === 108 ? 108 : key - 1;
      const partial = partialsMap.get(currentPartId);

      if (partial) {
        for (const sSec of partial.samples) {
          const sample = samplesMap.get(sSec.sampleIndex);
          if (!sample) continue;

          const wavName = `${sample.name}.wav`;
          const numFrames = audioFrames[sample.index] || 0;
          const hasLoop = sample.loopMode !== 2 && sample.sustainLoopEnd > sample.sustainLoopStart;

          regions.push({
            id: `s7_reg_${++regCounter}`,
            sampleName: sample.name,
            samplePath: wavName,
            rootKey: sample.originalKey,
            lowKey,
            highKey,
            lowVel: sSec.velLow,
            highVel: sSec.velHigh,
            detuneCents: Math.round(coarseTune * 100 + fineTune + sSec.coarseTune * 100 + sSec.fineTune),
            volumeDb: 0,
            pan: 0,
            loopMode: hasLoop ? 'loop_continuous' : 'no_loop',
            loopStart: hasLoop ? sample.sustainLoopStart : 0,
            loopEnd: hasLoop ? Math.min(numFrames - 1, sample.sustainLoopEnd) : 0,
            sampleStartFrame: sample.startAddr,
            sampleEndFrame: numFrames,
          });
        }
      }

      lowKey = key;
      currentPartId = partId;
    }
  }

  return {
    format: 'roland_disk' as any,
    formatLabel: 'Roland S-7xx Disk Image',
    presetName: selectedName,
    modelName: `${diskName}_${selectedName}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
    detectedCategory: 'Vintage Hardware Samplers',
    suggestedParameterSet: 0,
    regions,
    audioBuffers,
    polyphony: 24,
  };
}
