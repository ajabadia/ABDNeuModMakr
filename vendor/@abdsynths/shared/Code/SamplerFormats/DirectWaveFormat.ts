// ─────────────────────────────────────────────────────────────────────────────
// @abdsynths/shared — Image-Line FL Studio DirectWave Importer & Exporter
//
// High-fidelity clean-room parser and writer for FL Studio DirectWave (.dwp)
// multi-sample and monolithic banks.
//
// File Format:
//   - Header magic: ASCII "DwPr" at offset 0
//   - Preamble of ~0x5A bytes with file length at offset 0x28 (file size - 48)
//   - Block stream of 12-byte chunk headers:
//       [tag: uint32 LE, payloadLength: uint32 LE, reserved: uint32 LE]
//   - Key Tags:
//       0x0066 : Instrument Name
//       0x0067 : Instrument Path
//       0x006E : Parameter Slots (99 slots)
//       0x0003 : Sample Container (contains sub-chunks for a sample zone:
//                sample file name, keyRange, velRange, rootKey, tune, loops,
//                and optional embedded audio block: FLAC or PCM16)
//       0x0002 : Terminator
// ─────────────────────────────────────────────────────────────────────────────

import { decodeFlac } from '../NeuronFormats/UniversalAudioDecoder.ts';
import { decodeWav, encodeWavPcm16 } from '../NeuronFormats/WavAiffDecoder.ts';
import { pcm16ToWavBuffer } from './PcmWavHelper.ts';
import type { LoopMode } from './SamplerTypes.ts';
import type {
  ArchiveSamplerProgramInfo,
  ParsedImportRegion,
  ParsedSamplerPreset,
} from './rawSamplerParsers.ts';

const DWP_MAGIC = 'DwPr';
const TAG_INSTRUMENT_NAME = 0x0066;
const TAG_INSTRUMENT_PATH = 0x0067;
const TAG_PARAMETER_SLOT = 0x006e;
const TAG_SAMPLE_CONTAINER = 0x0003;
const TAG_TERMINATOR = 0x0002;

export interface DirectWaveSubChunk {
  tag: number;
  payload: Uint8Array;
}

export interface DirectWaveZone {
  sampleName: string;
  lowKey: number;
  highKey: number;
  lowVelocity: number;
  highVelocity: number;
  rootKey: number;
  fineTuneCents: number;
  pan: number;
  gainDb: number;
  loopMode: number;
  loopStart: number;
  loopEnd: number;
  audioData?: Uint8Array; // Embedded FLAC or uncompressed PCM
}

export interface DirectWaveProgram {
  name: string;
  zones: DirectWaveZone[];
}

export function isDirectWavePatch(buffer: ArrayBuffer | Uint8Array): boolean {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < 16) return false;
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  return magic === DWP_MAGIC;
}

/**
 * Parses all 12-byte header chunks from a DirectWave byte stream.
 */
function parseDwpChunks(bytes: Uint8Array, startOffset = 0): DirectWaveSubChunk[] {
  const chunks: DirectWaveSubChunk[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = startOffset;

  while (pos + 12 <= bytes.length) {
    const tag = view.getUint32(pos, true);
    const length = view.getUint32(pos + 4, true);
    const reserved = view.getUint32(pos + 8, true);
    pos += 12;

    if (pos + length > bytes.length) break;
    const payload = bytes.subarray(pos, pos + length);
    pos += length;

    chunks.push({ tag, payload });
    if (tag === TAG_TERMINATOR) break;
  }

  return chunks;
}

/**
 * Parses a DirectWave .dwp file into a DirectWaveProgram.
 */
export function parseDirectWavePatch(buffer: ArrayBuffer | Uint8Array): DirectWaveProgram {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (!isDirectWavePatch(bytes)) {
    throw new Error('Invalid DirectWave file: missing DwPr signature.');
  }

  let preambleSize = 0x5a;
  if (bytes.length > 0x70) {
    // Scan for first valid chunk tag after offset 0x40
    for (let candidate = 0x48; candidate <= 0x70; candidate += 2) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const testTag = view.getUint32(candidate, true);
      if (testTag === TAG_INSTRUMENT_NAME || testTag === TAG_PARAMETER_SLOT) {
        preambleSize = candidate;
        break;
      }
    }
  }

  const topChunks = parseDwpChunks(bytes, preambleSize);
  let instName = 'DirectWave_Instrument';
  const zones: DirectWaveZone[] = [];

  for (const c of topChunks) {
    if (c.tag === TAG_INSTRUMENT_NAME) {
      instName = new TextDecoder('iso-8859-1').decode(c.payload).replace(/\0+$/, '').trim();
    } else if (c.tag === TAG_SAMPLE_CONTAINER) {
      // Container holds sub-chunks describing this zone
      const subChunks = parseDwpChunks(c.payload, 0);
      let sampleName = `Sample_${zones.length + 1}.wav`;
      let lowKey = 0;
      let highKey = 127;
      let lowVelocity = 1;
      let highVelocity = 127;
      let rootKey = 60;
      let fineTuneCents = 0;
      let pan = 0;
      let gainDb = 0;
      let loopMode = 0;
      let loopStart = 0;
      let loopEnd = 0;
      let audioData: Uint8Array | undefined;

      for (const sc of subChunks) {
        const scView = new DataView(sc.payload.buffer, sc.payload.byteOffset, sc.payload.byteLength);
        if (sc.tag === 0x0004 && sc.payload.length > 0) {
          // Sample filename
          sampleName = new TextDecoder('iso-8859-1').decode(sc.payload).replace(/\0+$/, '').trim();
        } else if (sc.tag === 0x0005 && sc.payload.length >= 32) {
          // Key and velocity bounds + tuning
          lowKey = scView.getUint8(0);
          highKey = scView.getUint8(1);
          lowVelocity = scView.getUint8(2);
          highVelocity = scView.getUint8(3);
          rootKey = scView.getUint8(4);
          fineTuneCents = scView.getInt16(6, true);
          pan = scView.getInt8(8) / 64.0;
          gainDb = scView.getInt16(10, true) / 100.0;
          loopMode = scView.getUint8(12);
          loopStart = scView.getUint32(16, true);
          loopEnd = scView.getUint32(20, true);
        } else if (sc.tag === 0x0006 && sc.payload.length > 16) {
          // Embedded audio: check for FLAC ("fLaC") or WAV ("RIFF") or raw PCM
          audioData = sc.payload;
        }
      }

      zones.push({
        sampleName,
        lowKey,
        highKey,
        lowVelocity,
        highVelocity,
        rootKey,
        fineTuneCents,
        pan,
        gainDb,
        loopMode,
        loopStart,
        loopEnd,
        audioData,
      });
    }
  }

  return {
    name: instName || 'DirectWave_Instrument',
    zones,
  };
}

/**
 * Converts a DirectWaveProgram to a ParsedSamplerPreset.
 */
export function convertDirectWaveToPreset(
  dwProg: DirectWaveProgram,
  externalAudio?: Map<string, ArrayBuffer>
): ParsedSamplerPreset {
  const regions: ParsedImportRegion[] = [];
  const audioBuffers = new Map<string, ArrayBuffer>();

  for (const z of dwProg.zones) {
    const cleanSampleName = z.sampleName.replace(/\\/g, '/').split('/').pop() || 'Sample.wav';
    let wavBuffer: ArrayBuffer | undefined;

    if (z.audioData && z.audioData.length > 4) {
      // Check if embedded audio is FLAC
      const magic = String.fromCharCode(...z.audioData.subarray(0, 4));
      if (magic === 'fLaC') {
        try {
          const dec = decodeFlac(z.audioData.buffer.slice(z.audioData.byteOffset, z.audioData.byteOffset + z.audioData.byteLength));
          wavBuffer = encodeWavPcm16(dec.channels, dec.sampleRate);
        } catch {
          // Fall through
        }
      } else if (magic === 'RIFF') {
        wavBuffer = z.audioData.buffer.slice(z.audioData.byteOffset, z.audioData.byteOffset + z.audioData.byteLength);
      }
    }

    if (!wavBuffer && externalAudio) {
      wavBuffer =
        externalAudio.get(cleanSampleName) ??
        externalAudio.get(cleanSampleName.toLowerCase()) ??
        externalAudio.get(cleanSampleName.toUpperCase());
    }

    if (wavBuffer) {
      audioBuffers.set(cleanSampleName, wavBuffer);
    }

    regions.push({
      sampleName: cleanSampleName,
      rootKey: z.rootKey,
      lowKey: z.lowKey,
      highKey: z.highKey,
      lowVelocity: z.lowVelocity,
      highVelocity: z.highVelocity,
      fineTuneCents: z.fineTuneCents,
      gainDb: z.gainDb,
      pan: z.pan,
      loopMode: z.loopMode === 1 ? 'loop_continuous' : z.loopMode === 2 ? 'loop_bidirectional' : 'no_loop',
      loopStart: z.loopStart,
      loopEnd: z.loopEnd,
    });
  }

  return {
    presetName: dwProg.name,
    modelName: dwProg.name,
    regions,
    audioBuffers,
    isMultiLayer: regions.length > 1,
    sourceFormat: 'directwave',
  };
}

/**
 * Builds a DirectWave .dwp binary file with sample container blocks.
 */
export function writeDirectWavePatch(
  presetName: string,
  regions: ParsedImportRegion[]
): Uint8Array {
  const chunks: Uint8Array[] = [];

  // Preamble (0x5A bytes)
  const preamble = new Uint8Array(0x5a);
  preamble[0] = 'D'.charCodeAt(0);
  preamble[1] = 'w'.charCodeAt(0);
  preamble[2] = 'P'.charCodeAt(0);
  preamble[3] = 'r'.charCodeAt(0);

  // Chunk 1: Instrument Name (Tag 0x0066)
  const nameBytes = new TextEncoder().encode(`${presetName}\0`);
  const nameChunk = createDwpChunk(TAG_INSTRUMENT_NAME, nameBytes);
  chunks.push(nameChunk);

  // Sample Containers (Tag 0x0003)
  for (const r of regions) {
    const subChunks: Uint8Array[] = [];

    // Sub-chunk 0x0004: Sample path/name
    const sampleNameBytes = new TextEncoder().encode(`${r.sampleName}\0`);
    subChunks.push(createDwpChunk(0x0004, sampleNameBytes));

    // Sub-chunk 0x0005: Key/Vel/Tune parameters (32 bytes)
    const paramBytes = new Uint8Array(32);
    const pView = new DataView(paramBytes.buffer);
    pView.setUint8(0, r.lowKey);
    pView.setUint8(1, r.highKey);
    pView.setUint8(2, r.lowVelocity);
    pView.setUint8(3, r.highVelocity);
    pView.setUint8(4, r.rootKey);
    pView.setInt16(6, r.fineTuneCents || 0, true);
    pView.setInt8(8, Math.round((r.pan || 0) * 64));
    pView.setInt16(10, Math.round((r.gainDb || 0) * 100), true);
    pView.setUint8(12, r.loopMode === 'loop_continuous' ? 1 : 0);
    pView.setUint32(16, r.loopStart || 0, true);
    pView.setUint32(20, r.loopEnd || 0, true);
    subChunks.push(createDwpChunk(0x0005, paramBytes));

    // Assemble container payload
    const totalSubSize = subChunks.reduce((acc, c) => acc + c.length, 0);
    const containerPayload = new Uint8Array(totalSubSize);
    let subCursor = 0;
    for (const sc of subChunks) {
      containerPayload.set(sc, subCursor);
      subCursor += sc.length;
    }

    chunks.push(createDwpChunk(TAG_SAMPLE_CONTAINER, containerPayload));
  }

  // Terminator (Tag 0x0002)
  chunks.push(createDwpChunk(TAG_TERMINATOR, new Uint8Array(0)));

  // Calculate total file size and write preamble size field
  const totalBodySize = chunks.reduce((acc, c) => acc + c.length, 0);
  const totalFileSize = preamble.length + totalBodySize;
  const preView = new DataView(preamble.buffer);
  preView.setUint32(0x28, totalFileSize - 48, true);

  const out = new Uint8Array(totalFileSize);
  out.set(preamble, 0);
  let cursor = preamble.length;
  for (const c of chunks) {
    out.set(c, cursor);
    cursor += c.length;
  }

  return out;
}

function createDwpChunk(tag: number, payload: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + payload.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, tag, true);
  view.setUint32(4, payload.length, true);
  view.setUint32(8, 0, true);
  chunk.set(payload, 12);
  return chunk;
}
