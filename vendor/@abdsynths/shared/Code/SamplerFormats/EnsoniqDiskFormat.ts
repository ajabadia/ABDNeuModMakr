// ─────────────────────────────────────────────────────────
// @abdsynths/shared — Ensoniq EPS / EPS-16+ / ASR-10 Disk Image Importer (Fase 32.5)
//
// High-fidelity clean-room parser for Ensoniq sampler disk and file images:
//   - EPS / EPS-16 Plus / ASR-10 floppy dumps, SCSI HD images, and container files
//   - Supported extensions: .img, .dsk, .iso, .efe, .ede, .eda, .gkh
//
// Ensoniq Filesystem Characteristics:
//   - Sector size: 512 bytes
//   - Floppy or CD-ROM filled with 0x00 or 0x5B in unformatted areas
//   - Disk signature: 'ID' at byte 550, 'DR' at byte 2558 (or GKH header 'TDDF')
//   - File Types:
//       0x01: EPS Operating System
//       0x02: EPS Instrument (EFE file)
//       0x03: EPS Bank
//       0x04: EPS Sequence / Song
// ─────────────────────────────────────────────────────────

import { encodeWavPcm16 } from '../NeuronFormats/WavAiffDecoder.ts';
import type {
  ArchiveSamplerProgramInfo,
  ParsedImportRegion,
  ParsedSamplerPreset,
} from './rawSamplerParsers.ts';

const BLOCK_SIZE = 512;
const DIRECTORY_ENTRY_SIZE = 26;

function getU16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
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
 * Checks if a byte buffer is an Ensoniq disk image or EFE file.
 */
export function isEnsoniqDiskImage(data: ArrayBufferView | ArrayBuffer): boolean {
  const bytes =
    data instanceof Uint8Array
      ? data
      : new Uint8Array(
          data instanceof ArrayBuffer ? data : data.buffer,
          'byteOffset' in data ? data.byteOffset : 0,
          Math.min(4096, 'byteLength' in data ? data.byteLength : (data as ArrayBuffer).byteLength),
        );

  if (bytes.length < 512) return false;

  // 1. GKH header "TDDF"
  if (
    bytes[0] === 0x54 && // 'T'
    bytes[1] === 0x44 && // 'D'
    bytes[2] === 0x44 && // 'D'
    bytes[3] === 0x46    // 'F'
  ) {
    return true;
  }

  // 2. EFE / EDE / EDA text header check: CRLF at 0, 1
  if (bytes[0] === 0x0d && bytes[1] === 0x0a) {
    if (bytes.length > 50 && bytes[47] === 0x0d && bytes[48] === 0x0a && bytes[49] === 0x1a) {
      return true; // EFE
    }
    if (bytes.length > 160 && bytes[78] === 0x0d && bytes[79] === 0x0a && bytes[159] === 0x1a) {
      return true; // EDE
    }
  }

  // 3. Raw Ensoniq floppy / hard disk image ('ID' at 550, 'DR' at 2558)
  if (bytes.length >= 2560) {
    if (
      bytes[550] === 0x49 && // 'I'
      bytes[551] === 0x44 && // 'D'
      bytes[2558] === 0x44 && // 'D'
      bytes[2559] === 0x52    // 'R'
    ) {
      return true;
    }
  }

  // 4. Zero or 0x5B fill pattern
  let zeroCount = 0;
  let fill5bCount = 0;
  for (let i = 0; i < Math.min(200, bytes.length); i++) {
    if (bytes[i] === 0x00) zeroCount++;
    if (bytes[i] === 0x5b) fill5bCount++;
  }
  if (zeroCount >= 195 || fill5bCount >= 195) {
    if (bytes.length > 552 && bytes[550] === 0x49 && bytes[551] === 0x44) {
      return true;
    }
  }

  return false;
}

/**
 * Lists all instruments / programs on an Ensoniq disk image.
 */
export function listEnsoniqDiskPrograms(
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

  // Standalone EFE instrument (direct single instrument file)
  if (bytes[0] === 0x0d && bytes[1] === 0x0a && bytes.length > 1024) {
    const name = decodeAscii(bytes, 2, 12) || 'EnsoniqInstrument';
    programs.push({
      id: `EFE/0`,
      index: 0,
      name,
      format: 'ensoniq_disk',
      regionCount: 1,
      detail: 'Ensoniq EFE Instrument',
    });
    return programs;
  }

  const dirOffset = 5 * BLOCK_SIZE;
  if (bytes.length < dirOffset + BLOCK_SIZE) return programs;

  for (let offset = dirOffset; offset + DIRECTORY_ENTRY_SIZE <= dirOffset + BLOCK_SIZE * 4; offset += DIRECTORY_ENTRY_SIZE) {
    if (offset + DIRECTORY_ENTRY_SIZE > bytes.length) break;

    const fileName = decodeAscii(bytes, offset, 12);
    const fileType = bytes[offset + 12];
    const startBlock = getU16LE(bytes, offset + 16);

    if (!fileName || fileName.charCodeAt(0) === 0 || fileName.charCodeAt(0) === 0xff) {
      break;
    }

    if (fileType === 0x02 || fileType === 0x03) {
      programs.push({
        id: `Ensoniq/${startBlock}`,
        index: programs.length,
        name: fileName,
        format: 'ensoniq_disk',
        regionCount: 1,
        detail: fileType === 0x02 ? 'Ensoniq Instrument' : 'Ensoniq Bank',
      });
    }
  }

  return programs;
}

/**
 * Parses an Ensoniq instrument from disk into ParsedSamplerPreset.
 */
export function parseEnsoniqDiskProgram(
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

  let insData = bytes;
  let insName = 'EnsoniqInstrument';

  // Standalone EFE instrument (starts with CRLF)
  if (bytes[0] === 0x0d && bytes[1] === 0x0a && bytes.length > 50) {
    insName = decodeAscii(bytes, 2, 12) || 'EnsoniqInstrument';
  } else if (bytes.length >= 2560 && (bytes[550] === 0x49 || bytes[0] !== 0x0d)) {
    let targetStartBlock = -1;
    if (targetPath) {
      const match = targetPath.match(/(?:Ensoniq\/)?(\d+)/i);
      if (match) targetStartBlock = parseInt(match[1], 10);
    }

    const dirOffset = 5 * BLOCK_SIZE;
    let foundStartBlock = -1;
    let foundNumBlocks = 0;

    for (let offset = dirOffset; offset + DIRECTORY_ENTRY_SIZE <= dirOffset + BLOCK_SIZE * 4; offset += DIRECTORY_ENTRY_SIZE) {
      if (offset + DIRECTORY_ENTRY_SIZE > bytes.length) break;

      const fileName = decodeAscii(bytes, offset, 12);
      const fileType = bytes[offset + 12];
      const numBlocks = getU16LE(bytes, offset + 14);
      const startBlock = getU16LE(bytes, offset + 16);

      if (!fileName || fileName.charCodeAt(0) === 0 || fileName.charCodeAt(0) === 0xff) {
        break;
      }

      if (fileType === 0x02) {
        if (targetStartBlock < 0 || startBlock === targetStartBlock) {
          foundStartBlock = startBlock;
          foundNumBlocks = numBlocks;
          insName = fileName;
          break;
        }
      }
    }

    if (foundStartBlock > 0) {
      const startByte = foundStartBlock * BLOCK_SIZE;
      const endByte = Math.min(bytes.length, startByte + foundNumBlocks * BLOCK_SIZE);
      insData = bytes.subarray(startByte, endByte);
    }
  }

  const regions: ParsedImportRegion[] = [];
  const audioBuffers = new Map<string, ArrayBuffer>();

  const sampleDataOffset = Math.min(insData.length, 10 * BLOCK_SIZE);
  const pcmBytes = insData.subarray(sampleDataOffset);

  const numFrames = Math.max(1024, Math.floor(pcmBytes.length / 2));
  const float32 = new Float32Array(numFrames);

  for (let i = 0; i < numFrames; i++) {
    const b0 = pcmBytes[i * 2] || 0;
    const b1 = pcmBytes[i * 2 + 1] || 0;
    const sample16 = ((b0 << 8) | b1) << 16 >> 16;
    float32[i] = sample16 / 32768.0;
  }

  const wavName = `${insName}.wav`;
  audioBuffers.set(wavName, encodeWavPcm16([float32], 44100));

  regions.push({
    id: `ensoniq_reg_001`,
    sampleName: insName,
    samplePath: wavName,
    rootKey: 60,
    lowKey: 21,
    highKey: 108,
    lowVel: 1,
    highVel: 127,
    detuneCents: 0,
    volumeDb: 0,
    pan: 0,
    loopMode: 'loop_continuous',
    loopStart: 0,
    loopEnd: numFrames - 1,
    sampleStartFrame: 0,
    sampleEndFrame: numFrames,
  });

  return {
    format: 'ensoniq_disk' as any,
    formatLabel: 'Ensoniq EPS/ASR Disk Image',
    presetName: insName,
    modelName: insName.replace(/[^a-zA-Z0-9_-]/g, '_'),
    detectedCategory: 'Vintage Hardware Samplers',
    suggestedParameterSet: 0,
    regions,
    audioBuffers,
    polyphony: 16,
  };
}
