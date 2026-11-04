import { presetIdentity } from './PresetIdentity.ts';
// ─────────────────────────────────────────────────────────────────────────────
// @abdsynths/shared — Akai MESA & MESA II Program Importer
//
// Clean-room parser for Akai MESA / MESA II S-series programs (.s3p, .p) and
// external sample maps (.s / .wav).
//
// Architecture:
//   - S3P container starts with magic ASCII "PSYSSS30"
//   - Followed by uint32 number of messages/keygroups
//   - Sysex messages wrapped in:
//       F0 47 <channel> <cmd> 48 ... F7
//       Cmd 7: S3000 Program header (SysEx packed nibbles: 1 byte = 2 bytes: lo_nibble, hi_nibble)
//       Cmd 9: S3000 Keygroup (SysEx packed nibbles)
//   - Decoded program links to associated .wav or Akai raw .s files
// ─────────────────────────────────────────────────────────────────────────────

import { akaiLoudnessToDb, decodeAkaiText } from './AkaiDiskFormat.ts';
import type {
  ParsedImportRegion,
  ParsedSamplerPreset,
} from './rawSamplerParsers.ts';

const S3P_MAGIC = 'PSYSSS30';

export interface AkaiMesaDecodedKeygroup {
  lowKey: number;
  highKey: number;
  tuneSemitones: number;
  tuneCents: number;
  filterCutoff: number;
  samples: Array<{
    name: string;
    lowVelocity: number;
    highVelocity: number;
    tuneSemitones: number;
    tuneCents: number;
    loudness: number;
    pan: number;
    loopMode: number;
  }>;
}

export interface AkaiMesaDecodedProgram {
  name: string;
  midiProgram: number;
  volume: number;
  stereoPan: number;
  octaveShift: number;
  keygroups: AkaiMesaDecodedKeygroup[];
}

/**
 * Checks if a buffer is an Akai MESA S3P container.
 */
export function isAkaiMesaS3p(buffer: ArrayBuffer | Uint8Array): boolean {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < 16) return false;
  const magic = String.fromCharCode(...bytes.subarray(0, 8));
  return magic === S3P_MAGIC;
}

/**
 * Combines two 4-bit nibbles (low nibble first, high nibble second) into an 8-bit byte.
 */
function unpackSysexNibbles(data: Uint8Array): Uint8Array {
  const outLen = Math.floor(data.length / 2);
  const out = new Uint8Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const lo = data[i * 2] & 0x0f;
    const hi = data[i * 2 + 1] & 0x0f;
    out[i] = (hi << 4) | lo;
  }
  return out;
}

/**
 * Parses an Akai MESA S3P file into an AkaiMesaDecodedProgram.
 */
export function parseAkaiMesaS3p(buffer: ArrayBuffer | Uint8Array): AkaiMesaDecodedProgram {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (!isAkaiMesaS3p(bytes)) {
    throw new Error('Invalid Akai MESA S3P file: missing PSYSSS30 magic.');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
    offset += 4;

  let progName = 'MESA_Prog';
  let progVol = 99;
  let progPan = 0;
  let progOctaveShift = 0;
  let midiProg = 1;
  const keygroups: AkaiMesaDecodedKeygroup[] = [];

  while (offset + 4 <= bytes.length) {
    const msgSize = view.getUint32(offset, true);
    offset += 4;
    if (msgSize === 0 || offset + msgSize > bytes.length) break;

    const msg = bytes.subarray(offset, offset + msgSize);
    offset += msgSize;

    // Validate SysEx header F0 47 ... F7
    if (msg.length >= 8 && msg[0] === 0xf0 && msg[1] === 0x47 && msg[msg.length - 1] === 0xf7) {
      const cmd = msg[3];
      if (cmd === 7) {
        // Program Header message: strip header (first 7 bytes) and F7 (last byte)
        const content = msg.subarray(7, msg.length - 1);
        const unpacked = unpackSysexNibbles(content);
        if (unpacked.length >= 30) {
          progName = decodeAkaiText(unpacked, 3, 12);
          midiProg = unpacked[15] ?? 1;
          progOctaveShift = (unpacked[21] << 24) >> 24; // int8 sign extension
          progPan = (unpacked[24] << 24) >> 24;
          progVol = unpacked[25] ?? 99;
        }
      } else if (cmd === 9) {
        // Keygroup message: strip header (first 8 bytes) and F7 (last byte)
        const content = msg.subarray(8, msg.length - 1);
        const unpacked = unpackSysexNibbles(content);
        if (unpacked.length >= 40) {
          const kgLowKey = unpacked[3] ?? 0;
          const kgHighKey = unpacked[4] ?? 127;
          const tuneCents = (unpacked[5] << 24) >> 24;
          const tuneSemitones = (unpacked[6] << 24) >> 24;
          const filterCutoff = unpacked[7] ?? 99;

          // Up to 4 velocity zones per S3000 keygroup
          const samples: AkaiMesaDecodedKeygroup['samples'] = [];
          let sPos = 38;
          for (let z = 0; z < 4; z++) {
            if (sPos + 26 > unpacked.length) break;
            const sName = decodeAkaiText(unpacked, sPos, 12);
            const sLowVel = unpacked[sPos + 12] ?? 0;
            const sHighVel = unpacked[sPos + 13] ?? 127;
            const sTuneSemi = (unpacked[sPos + 14] << 24) >> 24;
            const sTuneCent = (unpacked[sPos + 15] << 24) >> 24;
            const sLoudness = unpacked[sPos + 16] ?? 99;
            const sPan = (unpacked[sPos + 18] << 24) >> 24;
            const sLoopMode = unpacked[sPos + 22] ?? 0;

            if (sName && sHighVel > 0) {
              samples.push({
                name: sName,
                lowVelocity: sLowVel,
                highVelocity: sHighVel,
                tuneSemitones: sTuneSemi,
                tuneCents: sTuneCent,
                loudness: sLoudness,
                pan: sPan,
                loopMode: sLoopMode,
              });
            }
            sPos += 26;
          }

          keygroups.push({
            lowKey: kgLowKey,
            highKey: kgHighKey,
            tuneSemitones,
            tuneCents,
            filterCutoff,
            samples,
          });
        }
      }
    }
  }

  return {
    name: progName.trim() || 'MESA_Instrument',
    midiProgram: midiProg,
    volume: progVol,
    stereoPan: progPan,
    octaveShift: progOctaveShift,
    keygroups,
  };
}

/**
 * Converts an Akai MESA program to a ParsedSamplerPreset.
 */
export function convertAkaiMesaToPreset(
  mesaProg: AkaiMesaDecodedProgram,
  sampleAudioBuffers?: Map<string, ArrayBuffer>
): ParsedSamplerPreset {
  const regions: ParsedImportRegion[] = [];
  const audioBuffers = new Map<string, ArrayBuffer>();

  const octaveShiftSemitones = mesaProg.octaveShift * 12;
  const programGainDb = (akaiLoudnessToDb(mesaProg.volume) - 99 * 0.2372);

  let regionIndex = 0;
  for (const kg of mesaProg.keygroups) {
    const lowKey = Math.max(0, Math.min(127, kg.lowKey - octaveShiftSemitones));
    const highKey = Math.max(0, Math.min(127, kg.highKey - octaveShiftSemitones));
    const kgTune = kg.tuneSemitones * 100 + kg.tuneCents + octaveShiftSemitones * 100;

    for (const smp of kg.samples) {
      const sampleName = smp.name.trim();
      if (!sampleName) continue;

      let wavBuf: ArrayBuffer | undefined;
      if (sampleAudioBuffers) {
        // Look up by exact name or name with .wav/.s
        wavBuf =
          sampleAudioBuffers.get(sampleName) ??
          sampleAudioBuffers.get(sampleName.toLowerCase()) ??
          sampleAudioBuffers.get(sampleName.toUpperCase()) ??
          sampleAudioBuffers.get(`${sampleName}.wav`) ??
          sampleAudioBuffers.get(`${sampleName.toLowerCase()}.wav`);
      }

      if (wavBuf) {
        audioBuffers.set(`${sampleName}.wav`, wavBuf);
      }

      const totalGain = programGainDb + (akaiLoudnessToDb(smp.loudness) - 99 * 0.2372);
      const totalDetune = kgTune + smp.tuneSemitones * 100 + smp.tuneCents;

      regions.push({
        id: `akai_mesa_${regions.length + 1}`,
        samplePath: `${sampleName}.wav`,
        sampleName: `${sampleName}.wav`,
        rootKey: 60,
        lowKey,
        highKey,
        lowVel: smp.lowVelocity,
        highVel: smp.highVelocity,
        detuneCents: totalDetune,
        volumeDb: totalGain,
        pan: (mesaProg.stereoPan + smp.pan) / 50.0,
        filterCutoffHz: Math.round(13 + (kg.filterCutoff / 99) * (12275 - 13)),
        loopMode: smp.loopMode === 3 ? 'one_shot' : 'loop_continuous',
        loopStart: 0,
        loopEnd: 0,
      });
      regionIndex++;
    }
  }

  return {
    presetName: mesaProg.name,
    modelName: mesaProg.name,
    regions,
    audioBuffers,
    isMultiLayer: regions.length > 1,
    sourceFormat: 'akai_mesa',
    ...presetIdentity('akai_mesa', 'Akai MESA', mesaProg.name),
  };
}
