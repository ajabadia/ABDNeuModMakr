// ─────────────────────────────────────────────────────────
// @abdsynths/shared — Akai S-Series & Gotek Floppy/ISO Disk Image Importer (Fase 32.5)
//
// High-fidelity clean-room parser for Akai S-Series sampler disk images:
//   - S1000 / S1100 / S2000 / S3000 SCSI hard drive / CD-ROM (.iso, .img, .dsk)
//   - S900 / S950 3.5" floppy disk images (.img, .dsk, Gotek FlashFloppy dumps)
//
// Multi-volume / multi-instrument organization:
//   - Disks have up to 9 partitions ('A'..'I')
//   - Partitions contain volumes (S1000, S3000, etc.)
//   - Volumes contain Programs ('p') and Samples ('s')
//   - Allows listing programs across all partitions/volumes for MultiInstrumentModal
//   - Converts selected program(s) and referenced PCM audio to UniversalSamplerInstrument
// ─────────────────────────────────────────────────────────

import { encodeWavPcm16 } from '../NeuronFormats/WavAiffDecoder.ts';
import type { LoopMode } from './SamplerTypes.ts';
import type {
  ArchiveSamplerProgramInfo,
  ParsedImportRegion,
  ParsedSamplerPreset,
} from './rawSamplerParsers.ts';

// ─── Constants & Tables ───────────────────────────────────

export const AKAI_BLOCK_SIZE = 0x2000; // 8192 bytes
const AKAI_S900_BLOCK_SIZE = 1024;
const AKAI_PARTITION_END_MARK = 0x8000;
const AKAI_MAX_DIR_ENTRIES = 100;
const AKAI_ROOT_ENTRY_OFFSET = 0x00;
const AKAI_FAT_OFFSET = 0x70a;
const AKAI_DIR_ENTRY_OFFSET = 0xca;
const AKAI_DIR_ENTRY_SIZE = 16;
const AKAI_FILE_ENTRY_SIZE = 24;

const PARAMETER_SCALE: number[] = [
  0, 3, 5, 8, 10, 13, 15, 18, 20, 23, 26, 28, 31, 33, 36, 38, 41, 43, 46, 48,
  51, 54, 56, 59, 61, 64, 66, 69, 71, 74, 76, 79, 82, 84, 87, 89, 92, 94, 97, 99,
  102, 105, 107, 110, 112, 115, 117, 120, 122, 125, 127, 130, 133, 135, 138, 140,
  143, 145, 148, 150, 153, 156, 158, 161, 163, 166, 168, 171, 173, 176, 178, 181,
  184, 186, 189, 191, 194, 196, 199, 201, 204, 207, 209, 212, 214, 217, 219, 222,
  224, 227, 229, 232, 235, 237, 240, 242, 245, 247, 250, 252,
];

const FILTER_CUTOFF_S1000: number[] = [
  13, 14, 15, 16, 17, 19, 20, 22, 23, 25, 27, 29, 31, 33, 36, 38, 42, 44, 48, 51,
  56, 61, 64, 70, 74, 81, 86, 94, 99, 108, 115, 125, 137, 145, 158, 167, 182, 193,
  210, 223, 243, 265, 280, 306, 324, 353, 374, 408, 432, 470, 498, 543, 592, 627,
  683, 723, 788, 834, 909, 962, 1048, 1142, 1208, 1316, 1393, 1516, 1605, 1747,
  1848, 2011, 2127, 2314, 2517, 2661, 2893, 3057, 3321, 3508, 3807, 4019, 4356,
  4715, 4968, 5364, 5640, 6067, 6359, 6802, 7096, 7530, 7808, 8199, 8555, 8774,
  9088, 9303, 9696, 10064, 11005, 12275,
];

const FILTER_CUTOFF_S900: number[] = [
  125, 125, 125, 125, 125, 125, 125, 125, 125, 125, 125, 125, 125, 125, 125, 125,
  125, 125, 125, 125, 125, 125, 125, 125, 141, 150, 158, 168, 188, 199, 211, 224,
  250, 267, 281, 299, 333, 356, 376, 400, 444, 471, 500, 533, 593, 627, 667, 711,
  800, 842, 889, 941, 1067, 1143, 1185, 1280, 1391, 1524, 1600, 1684, 1882, 2000,
  2133, 2286, 2462, 2667, 2909, 2909, 3556, 3556, 4000, 4000, 4571, 4571, 5333,
  5333, 6400, 6400, 6400, 6400, 6400, 6400, 6400, 6400, 6400, 6400, 6400, 6400,
  6400, 6400, 6400, 6400, 6400, 6400, 6400, 6400, 6400, 6400, 6400, 6400,
];

const ENVELOPE_RATE: number[] = [
  2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 6, 6, 7, 8, 9, 10, 11, 12, 13,
  14, 16, 17, 19, 21, 23, 26, 28, 31, 34, 38, 42, 46, 51, 56, 62, 68, 75, 83, 91,
  101, 111, 123, 135, 149, 165, 182, 200, 221, 244, 269, 297, 327, 361, 398, 439,
  484, 534, 589, 650, 716, 790, 872, 961, 1060, 1170, 1290, 1423, 1570, 1731, 1909,
  2106, 2323, 2562, 2826, 3117, 3438, 3792, 4183, 4614, 5089, 5613, 6191, 6828, 7532,
  8307, 9163, 10106, 11147, 12295, 13562, 14958, 16499, 18198, 20072, 22139, 24419,
  26934, 29707, 32767,
];

const DECIBEL_PER_STEP = 0.2372;
const FULL_LEVEL = 255;
const ENVELOPE_FULL_SWING = 32767.0 * 128.0;
const ENVELOPE_RATE_HZ = 44100.0;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function akaiEnvelopeTimeToSeconds(value: number): number {
  const idx = 99 - clamp(Math.round(value), 0, 99);
  return ENVELOPE_FULL_SWING / ENVELOPE_RATE[idx] / ENVELOPE_RATE_HZ;
}

export function akaiS900TimeToSeconds(value: number, isLong = false): number {
  return (value / 99.0) * (isLong ? 6.0 : 2.0);
}

export function akaiLoudnessToDb(loudness: number): number {
  const absVal = clamp(Math.abs(Math.round(loudness)), 0, 99);
  const magnitude = PARAMETER_SCALE[absVal];
  return (loudness < 0 ? -magnitude : magnitude) * DECIBEL_PER_STEP;
}

export function akaiSustainToLevel(sustain: number): number {
  const scaled = PARAMETER_SCALE[clamp(Math.round(sustain), 0, 99)];
  if (scaled <= 0) return 0;
  return Math.pow(10, ((scaled - FULL_LEVEL) * DECIBEL_PER_STEP) / 20.0);
}

// ─── Akai Text Decoder ───────────────────────────────────

export function decodeAkaiText(bytes: Uint8Array, offset = 0, length = 12): string {
  let result = '';
  for (let i = 0; i < length && offset + i < bytes.length; i++) {
    const b = bytes[offset + i] & 0xff;
    if (b >= 0 && b <= 9) {
      result += String.fromCharCode(b + 48); // '0'..'9'
    } else if (b === 10) {
      result += ' ';
    } else if (b >= 11 && b <= 36) {
      result += String.fromCharCode(64 + b - 10); // 'A'..'Z'
    } else if (b === 37) {
      result += '#';
    } else if (b === 38) {
      result += '+';
    } else if (b === 39) {
      result += '-';
    } else if (b === 40) {
      result += '.';
    } else {
      result += ' ';
    }
  }
  return result.trim();
}

// ─── Format Identification ───────────────────────────────

export type AkaiDiskType = 's1000' | 's3000' | 's900' | 'none';

export function identifyAkaiDisk(buffer: ArrayBuffer | Uint8Array): AkaiDiskType {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < 1024) return 'none';

  // Reject ZIP files (PK\x03\x04 or PK\x05\x06) immediately
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return 'none';

  // S3000 CD/SCSI magic tag check at offset 17920 (0x4600)
  if (bytes.length >= 17924) {
    const tag = String.fromCharCode(bytes[17920], bytes[17921], bytes[17922], bytes[17923]);
    if (tag === 'TAGS') {
      return 's3000';
    }
  }

  // 1. Akai S900 / S950 3.5" floppy (720KB or 1.44MB or Gotek disk image)
  // Directory starts at 0x00 with 64 entries of 24 bytes each.
  // Each directory entry has filename (10 chars ASCII), padding (6 bytes),
  // type (1 byte: 'P' or 'S' or 'D' or 'O'), length (24-bit unsigned LE).
  let s900Score = 0;
  for (let i = 0; i < 64; i++) {
    const entryOffset = i * 24;
    if (entryOffset + 24 > bytes.length) break;
    const typeChar = String.fromCharCode(bytes[entryOffset + 16]);
    if (typeChar === 'P' || typeChar === 'S' || typeChar === 'D' || typeChar === 'O') {
      const len =
        bytes[entryOffset + 17] |
        (bytes[entryOffset + 18] << 8) |
        (bytes[entryOffset + 19] << 16);
      const startBlk = bytes[entryOffset + 20] | (bytes[entryOffset + 21] << 8);
      // Valid S900 block is after directory blocks (> 1) and within image
      if (len > 0 && startBlk >= 2 && startBlk * AKAI_S900_BLOCK_SIZE < bytes.length) {
        s900Score++;
      }
    }
  }
  if (s900Score >= 1) {
    return 's900';
  }

  // 2. S1000/S3000 disk image: check partition size (int16 LE at offset 0)
  // and volume directory entries at 0xCA (type = 1, 3, or 7)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const partSize = view.getInt16(0, true);
  if (partSize > 0 && partSize < 30720) {
    // Check root directory entries at 0xCA for S1000/S3000 volume types
    for (let i = 0; i < 8; i++) {
      const entryPos = AKAI_DIR_ENTRY_OFFSET + i * AKAI_DIR_ENTRY_SIZE;
      if (entryPos + AKAI_DIR_ENTRY_SIZE <= bytes.length) {
        const vType = view.getInt16(entryPos + 12, true);
        if (vType === 1 || vType === 3 || vType === 7) {
          return vType === 7 || vType === 3 ? 's3000' : 's1000';
        }
      }
    }
    // S1000 partition with 0x00 at byte 0
    if (bytes[0] === 0x00) {
      return 's1000';
    }
  }

  return 'none';
}

export function isAkaiDiskImage(buffer: ArrayBuffer | Uint8Array): boolean {
  return identifyAkaiDisk(buffer) !== 'none';
}

// ─── S1000 / S3000 Structures ────────────────────────────

export interface AkaiRawDirEntry {
  index: number;
  name: string;
  type: number;
  start: number;
  size: number;
}

export interface AkaiS1000SampleLoop {
  marker: number; // End marker
  fineLength: number;
  coarseLength: number;
  time: number; // ms or 9999 = infinite
}

export interface AkaiParsedSample {
  name: string;
  sampleRate: number;
  rootNote: number;
  tuneCents: number;
  tuneSemitones: number;
  startMarker: number;
  endMarker: number;
  activeLoops: number;
  firstActiveLoop: number;
  loopMode: number;
  loops: AkaiS1000SampleLoop[];
  samples16: Int16Array;
}

export interface AkaiParsedKeygroupSample {
  name: string;
  lowVelocity: number;
  highVelocity: number;
  tuneCents: number;
  tuneSemitones: number;
  loudness: number;
  filter: number;
  pan: number;
  loopMode: number;
}

export interface AkaiParsedEnvelope {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  velocityToAttack: number;
  velocityToRelease: number;
  keyToDecayAndRelease: number;
}

export interface AkaiParsedKeygroup {
  lowKey: number;
  highKey: number;
  tuneCents: number;
  tuneSemitones: number;
  filter: number;
  keyToFilter: number;
  velocityToFilter: number;
  envelope2ToFilter: number;
  envelope2ToPitch: number;
  amplitudeEnvelope: AkaiParsedEnvelope;
  auxEnvelope: AkaiParsedEnvelope;
  samples: AkaiParsedKeygroupSample[];
}

export interface AkaiParsedProgram {
  partitionIndex: number;
  partitionName: string;
  volumeIndex: number;
  volumeName: string;
  programIndex: number;
  name: string;
  midiProgramNumber: number;
  midiChannel: number;
  polyphony: number;
  lowKey: number;
  highKey: number;
  octaveShift: number;
  mixPan: number;
  volume: number;
  stereoLevel: number;
  velocityToVolume: number;
  keyToVolume: number;
  bendToPitch: number;
  keygroups: AkaiParsedKeygroup[];
}

// ─── Akai S1000 / S3000 Disk Reader ──────────────────────

export class AkaiS1000DiskReader {
  private view: DataView;
  private bytes: Uint8Array;

  constructor(buffer: ArrayBuffer | Uint8Array) {
    this.bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
  }

  private readDirEntry(partitionOffset: number, block: number, pos: number): AkaiRawDirEntry {
    const entry: AkaiRawDirEntry = {
      index: pos,
      name: '',
      type: 0,
      start: 0,
      size: 0,
    };

    if (block === AKAI_ROOT_ENTRY_OFFSET) {
      const entryPos = partitionOffset + AKAI_DIR_ENTRY_OFFSET + pos * AKAI_DIR_ENTRY_SIZE;
      if (entryPos + AKAI_DIR_ENTRY_SIZE <= this.bytes.length) {
        entry.name = decodeAkaiText(this.bytes, entryPos, 12);
        entry.type = this.view.getInt16(entryPos + 12, true);
        entry.start = this.view.getInt16(entryPos + 14, true);
      }
      return entry;
    }

    let filePos = 0;
    if (pos < 341) {
      filePos = partitionOffset + block * AKAI_BLOCK_SIZE + pos * AKAI_FILE_ENTRY_SIZE;
    } else {
      const fatBlock = this.view.getInt16(partitionOffset + AKAI_FAT_OFFSET + block * 2, true);
      filePos = partitionOffset + fatBlock * AKAI_BLOCK_SIZE + (pos - 341) * AKAI_FILE_ENTRY_SIZE;
    }

    if (filePos + AKAI_FILE_ENTRY_SIZE <= this.bytes.length) {
      entry.name = decodeAkaiText(this.bytes, filePos, 12);
      // Skip 4 bytes
      const t1 = this.bytes[filePos + 16];
      entry.type = t1 & 0xff;
      const t2 = this.bytes[filePos + 17];
      const t3 = this.bytes[filePos + 18];
      const t4 = this.bytes[filePos + 19];
      entry.size = (t2 & 0xff) | ((t3 & 0xff) << 8) | ((t4 & 0xff) << 16);
      entry.start = this.view.getInt16(filePos + 20, true);
    }

    return entry;
  }

  public listPrograms(): ArchiveSamplerProgramInfo[] {
    const programs: ArchiveSamplerProgramInfo[] = [];
    let partitionOffset = 0;
    let partitionIndex = 0;

    while (
      partitionOffset + AKAI_DIR_ENTRY_OFFSET < this.bytes.length &&
      partitionIndex < 9
    ) {
      const partSize = this.view.getInt16(partitionOffset, true);
      if (
        partSize <= 0 ||
        partSize === (AKAI_PARTITION_END_MARK as number) ||
        partSize === 0x0fff ||
        partSize === -1 ||
        partSize > 30720
      ) {
        break;
      }

      const partitionName = String.fromCharCode('A'.charCodeAt(0) + partitionIndex);

      // Read root directory entries (volumes)
      for (let vIdx = 0; vIdx < AKAI_MAX_DIR_ENTRIES; vIdx++) {
        const vEntry = this.readDirEntry(partitionOffset, AKAI_ROOT_ENTRY_OFFSET, vIdx);
        // S1000 = 1, S3000_PRE = 3, S3000 = 7
        const vType = vEntry.type;
        if (vType !== 1 && vType !== 3 && vType !== 7) continue;

        const isS3000 = vType === 3 || vType === 7;
        const volumeName = vEntry.name || `VOL_${vIdx + 1}`;
        const maxFiles = isS3000 ? 509 : 125;

        for (let fIdx = 0; fIdx < maxFiles; fIdx++) {
          const fEntry = this.readDirEntry(partitionOffset, vEntry.start, fIdx);
          let fType = fEntry.type;
          if (fType >= 128 && isS3000) fType -= 128;

          if (fType === 'p'.charCodeAt(0)) {
            const progName = fEntry.name || `PROG_${fIdx + 1}`;
            const id = `${partitionIndex}:${vIdx}:${fIdx}`;
            programs.push({
              id,
              index: programs.length,
              name: progName,
              format: 'akai_disk',
              detail: `Part ${partitionName} / Vol ${volumeName}`,
            });
          }
        }
      }

      partitionOffset += AKAI_BLOCK_SIZE * (partSize & 0xffff);
      partitionIndex++;
    }

    return programs;
  }

  public parseProgramAndSamples(targetProgramId?: string): {
    program: AkaiParsedProgram;
    samples: Map<string, AkaiParsedSample>;
  } {
    let targetPart = 0;
    let targetVol = 0;
    let targetProg = 0;
    let targetProgName = '';

    if (targetProgramId) {
      if (targetProgramId.includes(':')) {
        const parts = targetProgramId.split(':');
        targetPart = parseInt(parts[0], 10) || 0;
        targetVol = parseInt(parts[1], 10) || 0;
        targetProg = parseInt(parts[2], 10) || 0;
      } else {
        targetProgName = targetProgramId.trim().toUpperCase();
      }
    }

    let partitionOffset = 0;
    let partitionIndex = 0;
    let foundProgram: AkaiParsedProgram | null = null;
    const volumeSamples = new Map<string, AkaiParsedSample>();

    while (
      partitionOffset + AKAI_DIR_ENTRY_OFFSET < this.bytes.length &&
      partitionIndex < 9
    ) {
      const partSize = this.view.getInt16(partitionOffset, true);
      if (
        partSize <= 0 ||
        partSize === (AKAI_PARTITION_END_MARK as number) ||
        partSize === 0x0fff ||
        partSize === -1 ||
        partSize > 30720
      ) {
        break;
      }

      const partitionName = String.fromCharCode('A'.charCodeAt(0) + partitionIndex);

      for (let vIdx = 0; vIdx < AKAI_MAX_DIR_ENTRIES; vIdx++) {
        const vEntry = this.readDirEntry(partitionOffset, AKAI_ROOT_ENTRY_OFFSET, vIdx);
        const vType = vEntry.type;
        if (vType !== 1 && vType !== 3 && vType !== 7) continue;

        const isS3000 = vType === 3 || vType === 7;
        const volumeName = vEntry.name || `VOL_${vIdx + 1}`;
        const maxFiles = isS3000 ? 509 : 125;

        // If target matches this partition and volume (or searching globally)
        const isTargetVolume =
          !targetProgramId ||
          targetProgName !== '' ||
          (partitionIndex === targetPart && vIdx === targetVol);

        if (!isTargetVolume) continue;

        const currentVolPrograms: Array<{ entry: AkaiRawDirEntry; dataPos: number; fIdx: number }> = [];

        for (let fIdx = 0; fIdx < maxFiles; fIdx++) {
          const fEntry = this.readDirEntry(partitionOffset, vEntry.start, fIdx);
          let fType = fEntry.type;
          if (fType >= 128 && isS3000) fType -= 128;
          const dataPos = partitionOffset + fEntry.start * AKAI_BLOCK_SIZE;

          if (fType === 's'.charCodeAt(0)) {
            // Read sample
            try {
              const smp = this.readSample(dataPos);
              if (smp) volumeSamples.set(smp.name.toUpperCase(), smp);
            } catch {
              // Ignore corrupt individual sample
            }
          } else if (fType === 'p'.charCodeAt(0)) {
            currentVolPrograms.push({ entry: fEntry, dataPos, fIdx });
          }
        }

        for (const progInfo of currentVolPrograms) {
          const matchesTarget =
            (!targetProgramId && !foundProgram) ||
            (targetProgName !== '' && progInfo.entry.name.toUpperCase() === targetProgName) ||
            (partitionIndex === targetPart && vIdx === targetVol && progInfo.fIdx === targetProg);

          if (matchesTarget && !foundProgram) {
            foundProgram = this.readProgram(
              progInfo.dataPos,
              partitionIndex,
              partitionName,
              vIdx,
              volumeName,
              progInfo.fIdx,
              isS3000
            );
          }
        }

        if (foundProgram) {
          return { program: foundProgram, samples: volumeSamples };
        }
      }

      partitionOffset += AKAI_BLOCK_SIZE * (partSize & 0xffff);
      partitionIndex++;
    }

    if (!foundProgram) {
      throw new Error(`Akai program "${targetProgramId || '0:0:0'}" not found on disk.`);
    }

    return { program: foundProgram, samples: volumeSamples };
  }

  private readProgram(
    pos: number,
    partitionIndex: number,
    partitionName: string,
    volumeIndex: number,
    volumeName: string,
    programIndex: number,
    isS3000: boolean
  ): AkaiParsedProgram {
    if (pos + 150 > this.bytes.length) {
      throw new Error('Unexpected EOF reading Akai Program.');
    }
    const progId = this.bytes[pos];
    if (progId !== 1) {
      throw new Error(`Invalid Akai Program ID: ${progId}`);
    }

    const name = decodeAkaiText(this.bytes, pos + 3, 12);
    const midiProgramNumber = this.bytes[pos + 15];
    const midiChannel = this.bytes[pos + 16];
    const polyphony = this.bytes[pos + 17];
    const lowKey = this.bytes[pos + 19];
    const highKey = this.bytes[pos + 20];
    const octaveShift = this.view.getInt8(pos + 21);
    const stereoLevel = this.bytes[pos + 23];
    const mixPan = this.view.getInt8(pos + 24);
    const volume = this.bytes[pos + 25];
    const velocityToVolume = this.view.getInt8(pos + 26);
    const keyToVolume = this.view.getInt8(pos + 27);
    const bendToPitch = this.bytes[pos + 39];
    const numberOfKeygroups = this.bytes[pos + 42];

    const keygroups: AkaiParsedKeygroup[] = [];
    const headerSize = isS3000 ? 192 : 150;

    for (let i = 0; i < numberOfKeygroups; i++) {
      const kgPos = pos + headerSize * (i + 1);
      if (kgPos + 100 > this.bytes.length) break;
      if (this.bytes[kgPos] !== 2) continue; // AKAI_KEYGROUP_ID

      const kgLowKey = this.bytes[kgPos + 3];
      const kgHighKey = this.bytes[kgPos + 4];
      const tuneCents = this.view.getInt8(kgPos + 5);
      const tuneSemitones = this.view.getInt8(kgPos + 6);
      const filter = this.bytes[kgPos + 7];
      const keyToFilter = this.bytes[kgPos + 8];
      const velocityToFilter = this.view.getInt8(kgPos + 9);
      const envelope2ToFilter = this.view.getInt8(kgPos + 11);

      // Amp envelope (offset 12)
      const ampEnv: AkaiParsedEnvelope = {
        attack: this.bytes[kgPos + 12],
        decay: this.bytes[kgPos + 13],
        sustain: this.bytes[kgPos + 14],
        release: this.bytes[kgPos + 15],
        velocityToAttack: this.view.getInt8(kgPos + 16),
        velocityToRelease: this.view.getInt8(kgPos + 17),
        keyToDecayAndRelease: this.view.getInt8(kgPos + 19),
      };

      // Aux envelope (offset 20)
      const auxEnv: AkaiParsedEnvelope = {
        attack: this.bytes[kgPos + 20],
        decay: this.bytes[kgPos + 21],
        sustain: this.bytes[kgPos + 22],
        release: this.bytes[kgPos + 23],
        velocityToAttack: this.view.getInt8(kgPos + 24),
        velocityToRelease: this.view.getInt8(kgPos + 25),
        keyToDecayAndRelease: this.view.getInt8(kgPos + 27),
      };

      const envelope2ToPitch = this.view.getInt8(kgPos + 29);

      // 4 Keygroup sample zones (starting at offset 34)
      const kgSamples: AkaiParsedKeygroupSample[] = [];
      let zonePos = kgPos + 34;
      for (let sIdx = 0; sIdx < 4; sIdx++) {
        const sName = decodeAkaiText(this.bytes, zonePos, 12);
        const lowVel = this.bytes[zonePos + 12];
        const highVel = this.bytes[zonePos + 13];
        const sTuneCents = this.view.getInt8(zonePos + 14);
        const sTuneSemi = this.view.getInt8(zonePos + 15);
        const loudness = this.view.getInt8(zonePos + 16);
        const sFilter = this.view.getInt8(zonePos + 17);
        const pan = this.view.getInt8(zonePos + 18);
        const loopMode = this.bytes[zonePos + 19];

        kgSamples.push({
          name: sName,
          lowVelocity: lowVel,
          highVelocity: highVel,
          tuneCents: sTuneCents,
          tuneSemitones: sTuneSemi,
          loudness,
          filter: sFilter,
          pan,
          loopMode,
        });

        zonePos += 24;
      }

      keygroups.push({
        lowKey: kgLowKey,
        highKey: kgHighKey,
        tuneCents,
        tuneSemitones,
        filter,
        keyToFilter,
        velocityToFilter,
        envelope2ToFilter,
        envelope2ToPitch,
        amplitudeEnvelope: ampEnv,
        auxEnvelope: auxEnv,
        samples: kgSamples,
      });
    }

    return {
      partitionIndex,
      partitionName,
      volumeIndex,
      volumeName,
      programIndex,
      name,
      midiProgramNumber,
      midiChannel,
      polyphony,
      lowKey,
      highKey,
      octaveShift,
      mixPan,
      volume,
      stereoLevel,
      velocityToVolume,
      keyToVolume,
      bendToPitch,
      keygroups,
    };
  }

  private readSample(pos: number): AkaiParsedSample | null {
    if (pos + 150 > this.bytes.length) return null;
    const smpId = this.bytes[pos];
    if (smpId !== 3) return null; // AKAI_SAMPLE_ID

    const sampleRateIndex = this.bytes[pos + 1];
    const rootNote = this.bytes[pos + 2];
    const name = decodeAkaiText(this.bytes, pos + 3, 12);

    const activeLoops = this.bytes[pos + 16];
    const firstActiveLoop = this.bytes[pos + 17];
    const loopMode = this.bytes[pos + 19];
    const tuneCents = this.view.getInt8(pos + 20);
    const tuneSemitones = this.view.getInt8(pos + 21);

    const numberOfSamples = this.view.getInt32(pos + 26, true);
    const startMarker = this.view.getInt32(pos + 30, true);
    const endMarker = this.view.getInt32(pos + 34, true);

    const loops: AkaiS1000SampleLoop[] = [];
    let loopPos = pos + 38;
    for (let l = 0; l < 8; l++) {
      const marker = this.view.getInt32(loopPos, true);
      const fineLength = this.view.getUint16(loopPos + 4, true);
      const coarseLength = this.view.getInt32(loopPos + 6, true);
      const time = this.view.getUint16(loopPos + 10, true);
      loops.push({ marker, fineLength, coarseLength, time });
      loopPos += 12;
    }

    let sampleRate = this.view.getUint16(pos + 138, true);
    if (sampleRate === 0) {
      sampleRate = sampleRateIndex === 0 ? 22050 : 44100;
    }

    const audioOffset = pos + 150;
    const availableWords = Math.floor((this.bytes.length - audioOffset) / 2);
    const count = Math.min(Math.max(0, numberOfSamples), availableWords);

    const samples16 = new Int16Array(count);
    for (let i = 0; i < count; i++) {
      samples16[i] = this.view.getInt16(audioOffset + i * 2, true);
    }

    return {
      name,
      sampleRate,
      rootNote,
      tuneCents,
      tuneSemitones,
      startMarker,
      endMarker,
      activeLoops,
      firstActiveLoop,
      loopMode,
      loops,
      samples16,
    };
  }
}

// ─── Akai S900 / S950 Floppy Reader ───────────────────────

export interface AkaiS900DirectoryEntry {
  name: string;
  type: string;
  length: number;
  startBlock: number;
  compression: number;
}

export interface AkaiS900Sample {
  name: string;
  sampleLength: number;
  sampleRate: number;
  nominalPitch: number;
  loudnessOffset: number;
  playbackMode: string;
  end: number;
  start: number;
  loopLength: number;
  direction: string;
  sampleData: Uint8Array;
  compression: number;
}

export interface AkaiS900KeygroupLayer {
  sampleName: string;
  filterAttack: number;
  filterDecay: number;
  filterSustain: number;
  filterRelease: number;
  tuning: number;
  filter: number;
  loudnessOffset: number;
}

export interface AkaiS900Keygroup {
  keyHigh: number;
  keyLow: number;
  velocitySwitchValue: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  filterVelocityInteraction: number;
  filterKeyTracking: number;
  flags: number;
  outputAssign: number;
  envelopeFilterFreqMod: number;
  layers: [AkaiS900KeygroupLayer, AkaiS900KeygroupLayer];
}

export interface AkaiS900Program {
  name: string;
  keyboardTilt: number;
  keygroupCrossfadeEnable: boolean;
  keygroups: AkaiS900Keygroup[];
}

export class AkaiS900DiskReader {
  private view: DataView;
  private bytes: Uint8Array;

  constructor(buffer: ArrayBuffer | Uint8Array) {
    this.bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
  }

  public readDirectory(): AkaiS900DirectoryEntry[] {
    const entries: AkaiS900DirectoryEntry[] = [];
    for (let i = 0; i < 64; i++) {
      const pos = i * 24;
      if (pos + 24 > this.bytes.length) break;

      let name = '';
      for (let c = 0; c < 10; c++) {
        const code = this.bytes[pos + c];
        if (code >= 32 && code <= 126) name += String.fromCharCode(code);
      }
      name = name.trim();

      const type = String.fromCharCode(this.bytes[pos + 16]);
      const length =
        this.bytes[pos + 17] |
        (this.bytes[pos + 18] << 8) |
        (this.bytes[pos + 19] << 16);
      const startBlock = this.view.getUint16(pos + 20, true);
      const compression = this.view.getUint16(pos + 22, true);

      if (length > 0) {
        entries.push({ name, type, length, startBlock, compression });
      }
    }
    return entries;
  }

  public listPrograms(): ArchiveSamplerProgramInfo[] {
    const dir = this.readDirectory();
    const programs: ArchiveSamplerProgramInfo[] = [];

    for (let i = 0; i < dir.length; i++) {
      const entry = dir[i];
      if (entry.type === 'P') {
        programs.push({
          id: `s900:${i}:${entry.name}`,
          index: programs.length,
          name: entry.name,
          format: 'akai_disk',
          detail: 'Akai S900 / S950 Program',
        });
      }
    }
    return programs;
  }

  public parseProgramAndSamples(targetProgramId?: string): {
    program: AkaiS900Program;
    samples: Map<string, AkaiS900Sample>;
  } {
    const dir = this.readDirectory();
    const samples = new Map<string, AkaiS900Sample>();
    const programs: AkaiS900Program[] = [];

    for (const entry of dir) {
      const start = entry.startBlock * AKAI_S900_BLOCK_SIZE;
      if (start + entry.length > this.bytes.length) continue;

      const chunk = this.bytes.subarray(start, start + entry.length);
      if (entry.type === 'P') {
        programs.push(this.parseS900Program(chunk));
      } else if (entry.type === 'S') {
        const smp = this.parseS900Sample(chunk, entry.compression);
        samples.set(smp.name.toUpperCase(), smp);
      }
    }

    let selectedProgram: AkaiS900Program | undefined;
    if (targetProgramId) {
      if (targetProgramId.startsWith('s900:')) {
        const parts = targetProgramId.split(':');
        const pName = parts[2]?.toUpperCase();
        selectedProgram = programs.find((p) => p.name.toUpperCase() === pName);
      } else {
        selectedProgram = programs.find(
          (p) => p.name.toUpperCase() === targetProgramId.toUpperCase()
        );
      }
    }
    if (!selectedProgram && programs.length > 0) {
      selectedProgram = programs[0];
    }
    if (!selectedProgram) {
      throw new Error(`Akai S900 program "${targetProgramId || '0'}" not found.`);
    }

    return { program: selectedProgram, samples };
  }

  private parseS900Program(data: Uint8Array): AkaiS900Program {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let name = '';
    for (let i = 0; i < 10; i++) {
      const c = data[i];
      if (c >= 32 && c <= 126) name += String.fromCharCode(c);
    }
    name = name.trim();

    const keyboardTilt = view.getInt8(16);
    const keygroupCrossfadeEnable = data[19] > 0;
    const numberOfKeygroups = data[21];

    const keygroups: AkaiS900Keygroup[] = [];
    let pos = 36;

    for (let k = 0; k < numberOfKeygroups; k++) {
      if (pos + 70 > data.length) break;

      const keyHigh = data[pos];
      const keyLow = data[pos + 1];
      const velocitySwitchValue = data[pos + 2];
      const attack = data[pos + 3];
      const decay = data[pos + 4];
      const sustain = data[pos + 5];
      const release = data[pos + 6];

      const filterVelocityInteraction = data[pos + 7];
      const filterKeyTracking = data[pos + 8];
      const flags = data[pos + 16];
      const outputAssign = data[pos + 17];
      const envelopeFilterFreqMod = view.getInt8(pos + 20);

      const readLayer = (lPos: number): AkaiS900KeygroupLayer => {
        let sName = '';
        for (let c = 0; c < 10; c++) {
          const code = data[lPos + c];
          if (code >= 32 && code <= 126) sName += String.fromCharCode(code);
        }
        return {
          sampleName: sName.trim(),
          filterAttack: data[lPos + 10],
          filterDecay: data[lPos + 11],
          filterSustain: data[lPos + 12],
          filterRelease: data[lPos + 13],
          tuning: view.getInt16(lPos + 16, true),
          filter: data[lPos + 18],
          loudnessOffset: view.getInt8(lPos + 19),
        };
      };

      const layer1 = readLayer(pos + 21);
      const layer2 = readLayer(pos + 41);

      keygroups.push({
        keyHigh,
        keyLow,
        velocitySwitchValue,
        attack,
        decay,
        sustain,
        release,
        filterVelocityInteraction,
        filterKeyTracking,
        flags,
        outputAssign,
        envelopeFilterFreqMod,
        layers: [layer1, layer2],
      });

      pos += 70;
    }

    return {
      name,
      keyboardTilt,
      keygroupCrossfadeEnable,
      keygroups,
    };
  }

  private parseS900Sample(data: Uint8Array, compression: number): AkaiS900Sample {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let name = '';
    for (let i = 0; i < 10; i++) {
      const c = data[i];
      if (c >= 32 && c <= 126) name += String.fromCharCode(c);
    }
    name = name.trim();

    const sampleLength = view.getUint32(16, true);
    const sampleRate = view.getUint16(20, true);
    const nominalPitch = view.getUint16(22, true);
    const loudnessOffset = view.getInt16(24, true);
    const playbackMode = String.fromCharCode(data[26]);

    const end = view.getUint32(28, true);
    const start = view.getUint32(32, true);
    const loopLength = view.getUint32(36, true);
    const direction = String.fromCharCode(data[43]);

    const sampleData = data.subarray(60);

    return {
      name,
      sampleLength,
      sampleRate,
      nominalPitch,
      loudnessOffset,
      playbackMode,
      end,
      start,
      loopLength,
      direction,
      sampleData,
      compression,
    };
  }
}

// ─── S900 Audio Decompression & WAV Conversion ───────────

export function decodeS900AudioToPcm16(sample: AkaiS900Sample): Int16Array {
  const sampleCount = sample.sampleLength;
  if (sampleCount === 0 || sample.sampleData.length === 0) {
    return new Int16Array(0);
  }

  const sampleCountPart = Math.floor((sampleCount + 1) / 2);
  const outSamples = new Int16Array(sampleCountPart * 2);

  if (sample.compression === 0) {
    // Uncompressed 12-bit signed Akai S900 layout
    const src = sample.sampleData;
    for (let i = 0; i < sampleCountPart; i++) {
      if (i * 2 + 1 >= src.length) break;
      const b0 = src[i * 2];
      const b1 = src[i * 2 + 1];
      // 12-bit signed shifted to 16-bit
      const low4 = (b0 & 0xf0) >> 4;
      const val12 = ((b1 << 4) | low4) << 20 >> 16;
      outSamples[i] = val12;
    }

    for (let i = 0; i < sampleCountPart; i++) {
      const srcIdx = sampleCountPart * 2 + i;
      if (srcIdx >= src.length) break;
      const b0 = src[i * 2];
      const highByte = src[srcIdx];
      const low4 = b0 & 0x0f;
      const val12 = ((highByte << 4) | low4) << 20 >> 16;
      outSamples[sampleCountPart + i] = val12;
    }
  } else {
    // Compressed 12-bit ADPCM S900 stream
    decodeS900Compressed(sample.sampleData, outSamples);
  }

  return outSamples;
}

function decodeS900Compressed(source: Uint8Array, dest: Int16Array): void {
  const GROUP_SAMPNUM = 10;
  const UPBITNUM_NEGCODE_OFF = 16;
  let currentValue = 0;
  let currentIncrement = 0;
  let bitPosition = 0;
  let remainingBits = source.length * 8;
  let outPos = 0;

  function getBits(bitOffset: number, count: number): number {
    let val = 0;
    for (let i = 0; i < count; i++) {
      const pos = bitOffset + i;
      const byteIdx = pos >>> 3;
      if (byteIdx >= source.length) break;
      const mask = 1 << (7 - (pos & 7));
      val = (val << 1) | ((source[byteIdx] & mask) !== 0 ? 1 : 0);
    }
    return val;
  }

  while (remainingBits >= 4 && outPos < dest.length) {
    const code = getBits(bitPosition, 4);
    bitPosition += 4;
    remainingBits -= 4;

    if (code === 0) {
      for (let i = 0; i < GROUP_SAMPNUM && outPos < dest.length; i++) {
        currentValue += currentIncrement;
        dest[outPos++] = currentValue << 4;
      }
      continue;
    }

    const bitsPerValue = UPBITNUM_NEGCODE_OFF - code;
    const requiredBits = GROUP_SAMPNUM * (1 + bitsPerValue);
    if (remainingBits < requiredBits) break;

    for (let i = 0; i < GROUP_SAMPNUM && outPos < dest.length; i++) {
      const sign = getBits(bitPosition + i, 1);
      const mag = getBits(
        bitPosition + GROUP_SAMPNUM + i * bitsPerValue,
        bitsPerValue
      );
      if (sign === 0) {
        currentIncrement += mag;
      } else {
        currentIncrement -= mag;
      }
      currentValue += currentIncrement;
      dest[outPos++] = currentValue << 4;
    }

    bitPosition += requiredBits;
    remainingBits -= requiredBits;
  }
}

// ─── High-Level Public Importer API ───────────────────────

/**
 * Lists all playable sampler programs across all partitions and volumes of an Akai disk image.
 */
export function listAkaiDiskPrograms(buffer: ArrayBuffer | Uint8Array): ArchiveSamplerProgramInfo[] {
  const diskType = identifyAkaiDisk(buffer);
  if (diskType === 's1000' || diskType === 's3000') {
    const reader = new AkaiS1000DiskReader(buffer);
    return reader.listPrograms();
  }
  if (diskType === 's900') {
    const reader = new AkaiS900DiskReader(buffer);
    return reader.listPrograms();
  }
  return [];
}

/**
 * Parses a selected Akai S-Series program (or the first program on the disk) and extracts
 * all referenced keygroups, envelopes, filters, and audio waveforms as standard WAV buffers.
 */
export async function parseAkaiDiskProgram(
  buffer: ArrayBuffer | Uint8Array,
  programId?: string
): Promise<ParsedSamplerPreset> {
  const diskType = identifyAkaiDisk(buffer);

  if (diskType === 's1000' || diskType === 's3000') {
    const reader = new AkaiS1000DiskReader(buffer);
    const { program, samples } = reader.parseProgramAndSamples(programId);

    const regions: ParsedImportRegion[] = [];
    const audioBuffers = new Map<string, ArrayBuffer>();

    // Global program transforms
    const pitchBendRange = clamp(program.bendToPitch, 0, 12);
    const programGainDb =
      akaiLoudnessToDb(program.volume) - FULL_LEVEL * DECIBEL_PER_STEP;
    const stereoLevelDb =
      akaiLoudnessToDb(program.stereoLevel) - FULL_LEVEL * DECIBEL_PER_STEP;
    const stereoPan = clamp(program.mixPan, -50, 50);
    const octaveShift = clamp(program.octaveShift, -2, 2) * 12;

    let regionCounter = 0;
    for (const kg of program.keygroups) {
      const kgLowKey = clamp(kg.lowKey - octaveShift, 0, 127);
      const kgHighKey = clamp(kg.highKey - octaveShift, 0, 127);
      const kgTuningCents =
        (kg.tuneSemitones + (kg.tuneCents & 0xff) / 256.0 + octaveShift) * 100;

      for (const sZone of kg.samples) {
        if (!sZone.name || sZone.highVelocity === 0) continue;
        const sample = samples.get(sZone.name.toUpperCase());
        if (!sample) continue;

        const firstLoopIdx = clamp(sample.firstActiveLoop, 0, 7);
        const loop0 = sample.loops[firstLoopIdx] || sample.loops[0];
        const effLoopMode = sZone.loopMode === 0 ? sample.loopMode : sZone.loopMode - 1;
        const hasLoop = sample.activeLoops > 0 && effLoopMode < 2 && loop0 && loop0.coarseLength > 0;
        const loopModeStr: LoopMode =
          effLoopMode === 3
            ? 'one_shot'
            : hasLoop
              ? 'loop_continuous'
              : 'no_loop';
        const loopStart = hasLoop ? Math.max(0, loop0.marker - loop0.coarseLength) : 0;
        const loopEnd = hasLoop ? loop0.marker : 0;
        const normLowVel = clamp(Math.max(1, sZone.lowVelocity), 1, 127);
        const normHighVel = clamp(Math.max(normLowVel, sZone.highVelocity), 1, 127);

        // Encode WAV if not already encoded
        let wavBuffer = audioBuffers.get(sample.name);
        if (!wavBuffer && sample.samples16.length > 0) {
          const float32 = new Float32Array(sample.samples16.length);
          for (let i = 0; i < sample.samples16.length; i++) {
            float32[i] = sample.samples16[i] / 32768.0;
          }

          wavBuffer = encodeWavPcm16([float32], sample.sampleRate, {
            rootKey: sample.rootNote,
            lowKey: kgLowKey,
            highKey: kgHighKey,
            lowVelocity: normLowVel,
            highVelocity: normHighVel,
            detune: sample.tuneCents,
            gainDb: 0,
            loopMode: loopModeStr,
            loopStart,
            loopEnd,
          });
          audioBuffers.set(sample.name, wavBuffer);
          audioBuffers.set(`${sample.name}.wav`, wavBuffer);
        }

        const zoneGainDb =
          programGainDb + stereoLevelDb + akaiLoudnessToDb(sZone.loudness);
        const zonePan = clamp(sZone.pan + stereoPan, -50, 50);
        const sZoneTuningCents =
          (sZone.tuneSemitones + (sZone.tuneCents & 0xff) / 256.0) * 100;
        const sampleTuningCents = sample.tuneSemitones * 100 + sample.tuneCents;

        regions.push({
          id: `akai_reg_${++regionCounter}`,
          sampleName: sample.name,
          samplePath: `${sample.name}.wav`,
          rootKey: sample.rootNote,
          lowKey: kgLowKey,
          highKey: kgHighKey,
          lowVel: normLowVel,
          highVel: normHighVel,
          detuneCents: Math.round(kgTuningCents + sZoneTuningCents + sampleTuningCents),
          volumeDb: Math.round(zoneGainDb * 10) / 10,
          pan: zonePan,
          loopMode: loopModeStr,
          loopStart,
          loopEnd,
          sampleStartFrame: sample.startMarker,
          sampleEndFrame: sample.endMarker,
          reversed: false,
        });
      }
    }

    // Envelope from first keygroup
    const firstKg = program.keygroups[0];
    const env = firstKg?.amplitudeEnvelope;
    const filterCutoff = firstKg ? FILTER_CUTOFF_S1000[clamp(firstKg.filter, 0, 99)] : 12000;

    return {
      format: 'akai_disk' as any,
      formatLabel: `Akai S1000/S3000 Disk (${program.partitionName}:${program.volumeName})`,
      presetName: program.name,
      modelName: program.name.replace(/[^a-zA-Z0-9_-]/g, '_'),
      detectedCategory: 'Synthesizers & Keyboards',
      suggestedParameterSet: 0,
      regions,
      audioBuffers,
      polyphony: clamp(program.polyphony, 1, 16),
      pitchBendUpSt: pitchBendRange,
      pitchBendDownSt: -pitchBendRange,
      envelope: env
        ? {
            attack: akaiEnvelopeTimeToSeconds(env.attack),
            decay: akaiEnvelopeTimeToSeconds(env.decay),
            sustain: akaiSustainToLevel(env.sustain),
            release: akaiEnvelopeTimeToSeconds(env.release),
          }
        : undefined,
      filter: {
        type: 'lpf',
        cutoffHz: filterCutoff,
        poles: 3, // 18dB/octave fixed low-pass
      },
    };
  }

  if (diskType === 's900') {
    const reader = new AkaiS900DiskReader(buffer);
    const { program, samples } = reader.parseProgramAndSamples(programId);

    const regions: ParsedImportRegion[] = [];
    const audioBuffers = new Map<string, ArrayBuffer>();

    let regionCounter = 0;
    for (const kg of program.keygroups) {
      const velSwitch = kg.velocitySwitchValue;

      // Layer 1: Soft layer (0..velSwitch)
      // Layer 2: Loud layer (velSwitch+1..127)
      const layersToProcess: Array<{
        layer: AkaiS900KeygroupLayer;
        lowVel: number;
        highVel: number;
      }> = [];

      if (velSwitch > 0) {
        layersToProcess.push({
          layer: kg.layers[0],
          lowVel: 1,
          highVel: Math.min(velSwitch, 127),
        });
      }
      if (velSwitch < 128) {
        layersToProcess.push({
          layer: kg.layers[1],
          lowVel: Math.min(velSwitch + 1, 127),
          highVel: 127,
        });
      }

      for (const { layer, lowVel, highVel } of layersToProcess) {
        if (!layer.sampleName) continue;
        const sample = samples.get(layer.sampleName.toUpperCase());
        if (!sample) continue;

        let wavBuffer = audioBuffers.get(sample.name);
        if (!wavBuffer) {
          const pcm16 = decodeS900AudioToPcm16(sample);
          const float32 = new Float32Array(pcm16.length);
          for (let i = 0; i < pcm16.length; i++) {
            float32[i] = pcm16[i] / 32768.0;
          }

          const hasLoop =
            sample.loopLength > 0 &&
            (sample.playbackMode === 'L' || sample.playbackMode === 'A');
          const loopModeStr: LoopMode =
            sample.playbackMode === 'O' || (kg.flags & 8) !== 0
              ? 'one_shot'
              : hasLoop
                ? 'loop_continuous'
                : 'no_loop';

          const loopStart = hasLoop ? Math.max(0, sample.end - sample.loopLength) : 0;
          const loopEnd = hasLoop ? sample.end : 0;
          const rootNote = Math.round(sample.nominalPitch / 16.0);

          wavBuffer = encodeWavPcm16([float32], sample.sampleRate, {
            rootKey: rootNote,
            lowKey: kg.keyLow,
            highKey: kg.keyHigh,
            lowVelocity: lowVel,
            highVelocity: highVel,
            detune: 0,
            gainDb: 0,
            loopMode: loopModeStr,
            loopStart,
            loopEnd,
          });
          audioBuffers.set(sample.name, wavBuffer);
        }

        const rootNote = Math.round(sample.nominalPitch / 16.0);
        const hasLoop =
          sample.loopLength > 0 &&
          (sample.playbackMode === 'L' || sample.playbackMode === 'A');
        const loopModeStr: LoopMode =
          sample.playbackMode === 'O' || (kg.flags & 8) !== 0
            ? 'one_shot'
            : hasLoop
              ? 'loop_continuous'
              : 'no_loop';
        const loopStart = hasLoop ? Math.max(0, sample.end - sample.loopLength) : 0;
        const loopEnd = hasLoop ? sample.end : 0;

        const pan =
          kg.outputAssign === 0x08 ? -50 : kg.outputAssign === 0x09 ? 50 : 0;
        const totalGainDb = (layer.loudnessOffset + sample.loudnessOffset) * 0.375;

        regions.push({
          id: `s900_reg_${++regionCounter}`,
          sampleName: sample.name,
          samplePath: `${sample.name}.wav`,
          rootKey: rootNote,
          lowKey: kg.keyLow,
          highKey: kg.keyHigh,
          lowVel,
          highVel,
          detuneCents: Math.round(layer.tuning * 6.25),
          volumeDb: Math.round(totalGainDb * 10) / 10,
          pan,
          loopMode: loopModeStr,
          loopStart,
          loopEnd,
          sampleStartFrame: sample.start,
          sampleEndFrame: sample.end,
          reversed: sample.direction === 'R',
        });
      }
    }

    const firstKg = program.keygroups[0];
    const filterCutoff = firstKg ? FILTER_CUTOFF_S900[clamp(firstKg.layers[0].filter, 0, 99)] : 6400;

    return {
      format: 'akai_disk' as any,
      formatLabel: 'Akai S900/S950 Floppy Disk',
      presetName: program.name,
      modelName: program.name.replace(/[^a-zA-Z0-9_-]/g, '_'),
      detectedCategory: 'Vintage Hardware Samplers',
      suggestedParameterSet: 0,
      regions,
      audioBuffers,
      polyphony: 8,
      envelope: firstKg
        ? {
            attack: akaiS900TimeToSeconds(firstKg.attack, false),
            decay: akaiS900TimeToSeconds(firstKg.decay, true),
            sustain: firstKg.sustain / 99.0,
            release: akaiS900TimeToSeconds(firstKg.release, false),
          }
        : undefined,
      filter: {
        type: 'lpf',
        cutoffHz: filterCutoff,
        poles: 3,
      },
    };
  }

  throw new Error('Not an Akai S-Series disk image.');
}
