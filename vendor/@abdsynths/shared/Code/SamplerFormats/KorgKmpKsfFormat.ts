// ─────────────────────────────────────────────────────────
// @abdsynths/shared — Korg Trinity / Triton / M3 / Pa (.KMP / .KSF / .KSC) Reader & Writer (Fase 32.4)
//
// Clean-room Big-Endian binary implementation of Korg's classic hardware sampler format:
//   - .KMP (Korg Multisample Parameter): MSP1, MNO1, RLP1 (18B per zone), RLP2, NAME
//   - .KSF (Korg Sample File): SMP1 (32B header), SNO1, SMD1 (12B header + 16-bit BE PCM), NAME
//   - .KSC (Korg Script File): plain ASCII list of .KMP files
// Reference: Jürgen Moßgraber's ConvertWithMoss format documentation.
// ─────────────────────────────────────────────────────────

import { encodeWavPcm16 } from '../NeuronFormats/WavAiffDecoder.ts';
import type { LoopMode } from './SamplerTypes.ts';
import type { UniformSamplerRegion } from './rawSamplerTypes.ts';

export interface KorgKmpZone {
  index: number;
  lowKey: number;
  highKey: number;
  rootKey: number;
  pitchKeytrack: number; // 100 or 0
  detuneCents: number;
  volumeDb: number;
  pan: number; // -50..+50
  filterCutoffOffset: number; // -50..+50
  ksfFilename: string;
}

export interface ParsedKorgKsf {
  sampleName: string;
  defaultBank: number;
  startFrame: number;
  secondStartFrame: number;
  loopStartFrame: number;
  loopEndFrame: number;
  sampleRate: number;
  loopEnabled: boolean;
  reversed: boolean;
  channels: number;
  bitDepth: number;
  numSamples: number;
  pcmFloat32: Float32Array;
  wavBuffer: ArrayBuffer;
}

export interface ParsedKorgKmp {
  presetName: string;
  shortName: string;
  sampleNumber: number;
  useSecondStart: boolean;
  zones: KorgKmpZone[];
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  const end = Math.min(bytes.byteLength, offset + length);
  let out = '';
  for (let i = offset; i < end; i++) {
    const b = bytes[i];
    if (b === 0) break;
    if (b >= 32 && b < 127) out += String.fromCharCode(b);
  }
  return out.trim();
}

function writeAsciiPadded(
  bytes: Uint8Array,
  offset: number,
  length: number,
  text: string,
  padByte = 0x00
): void {
  for (let i = 0; i < length; i++) {
    bytes[offset + i] = i < text.length ? text.charCodeAt(i) & 0x7f : padByte;
  }
}

/**
 * Checks whether a buffer begins with a Korg `.KMP` (`MSP1`) or `.KSF` (`SMP1`) chunk header.
 */
export function isKorgKmpOrKsfBuffer(buffer: ArrayBuffer): 'kmp' | 'ksf' | null {
  if (buffer.byteLength < 12) return null;
  const bytes = new Uint8Array(buffer, 0, 4);
  const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (tag === 'MSP1') return 'kmp';
  if (tag === 'SMP1') return 'ksf';
  return null;
}

/**
 * Parses a Big-Endian Korg `.KSF` sample file and converts its 16-bit BE PCM into a standard WAV buffer.
 */
export function parseKorgKsf(buffer: ArrayBuffer, fallbackName = 'KorgSample'): ParsedKorgKsf {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  let shortName = fallbackName;
  let fullName = '';
  let defaultBank = 0;
  let startFrame = 0;
  let secondStartFrame = 0;
  let loopStartFrame = 0;
  let loopEndFrame = 0;
  let sampleRate = 44100;
  let loopEnabled = false;
  let reversed = false;
  let channels = 1;
  let bitDepth = 16;
  let numSamples = 0;
  let pcmFloat32 = new Float32Array(0);

  let pos = 0;
  while (pos + 8 <= bytes.byteLength) {
    const id = readAscii(bytes, pos, 4);
    const size = view.getUint32(pos + 4, false); // Big-Endian
    const dataOffset = pos + 8;
    if (dataOffset + size > bytes.byteLength) break;

    if (id === 'SMP1' && size >= 32) {
      shortName = readAscii(bytes, dataOffset + 0, 16) || fallbackName;
      defaultBank = bytes[dataOffset + 16];
      startFrame =
        (bytes[dataOffset + 17] << 16) | (bytes[dataOffset + 18] << 8) | bytes[dataOffset + 19];
      secondStartFrame = view.getUint32(dataOffset + 20, false);
      loopStartFrame = view.getUint32(dataOffset + 24, false);
      loopEndFrame = view.getUint32(dataOffset + 28, false);
    } else if (id === 'SMD1' && size >= 12) {
      sampleRate = view.getUint32(dataOffset + 0, false) || 44100;
      const attrs = bytes[dataOffset + 4];
      // Bit 6 (0x40) = play reverse; Bit 7 (0x80) = 1 means NO loop, 0 means loop enabled
      reversed = (attrs & 0x40) !== 0;
      loopEnabled = (attrs & 0x80) === 0 && loopEndFrame > loopStartFrame;
      channels = Math.max(1, bytes[dataOffset + 6] || 1);
      bitDepth = bytes[dataOffset + 7] || 16;
      numSamples = view.getUint32(dataOffset + 8, false);

      const pcmOffset = dataOffset + 12;
      const availableBytes = size - 12;
      const bytesPerSample = bitDepth === 8 ? 1 : 2;
      const actualSamples = Math.min(numSamples, Math.floor(availableBytes / bytesPerSample));
      pcmFloat32 = new Float32Array(actualSamples);

      if (bitDepth === 8) {
        for (let i = 0; i < actualSamples; i++) {
          pcmFloat32[i] = view.getInt8(pcmOffset + i) / 128;
        }
      } else {
        for (let i = 0; i < actualSamples; i++) {
          pcmFloat32[i] = view.getInt16(pcmOffset + i * 2, false) / 32768;
        }
      }
    } else if (id === 'NAME' && size >= 1) {
      fullName = readAscii(bytes, dataOffset, size);
    }

    pos = dataOffset + size;
  }

  const sampleName = fullName || shortName || fallbackName;
  const wavBuffer = encodeWavPcm16([pcmFloat32], sampleRate, {
    rootKey: 60,
    lowKey: 0,
    highKey: 127,
    lowVelocity: 1,
    highVelocity: 127,
    detune: 0,
    gainDb: 0,
    loopMode: loopEnabled ? 'loop_continuous' : 'no_loop',
    loopStart: loopStartFrame,
    loopEnd: loopEndFrame,
  });

  return {
    sampleName,
    defaultBank,
    startFrame,
    secondStartFrame,
    loopStartFrame,
    loopEndFrame,
    sampleRate,
    loopEnabled,
    reversed,
    channels,
    bitDepth,
    numSamples: pcmFloat32.length,
    pcmFloat32,
    wavBuffer,
  };
}

/**
 * Parses a Big-Endian Korg `.KMP` multisample file.
 */
export function parseKorgKmp(buffer: ArrayBuffer, fallbackName = 'KorgMultisample'): ParsedKorgKmp {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  let shortName = fallbackName;
  let fullName = '';
  let numZones = 0;
  let useSecondStart = false;
  let sampleNumber = 0;
  const zones: KorgKmpZone[] = [];

  let pos = 0;
  while (pos + 8 <= bytes.byteLength) {
    const id = readAscii(bytes, pos, 4);
    const size = view.getUint32(pos + 4, false);
    const dataOffset = pos + 8;
    if (dataOffset + size > bytes.byteLength) break;

    if (id === 'MSP1' && size >= 18) {
      shortName = readAscii(bytes, dataOffset + 0, 16) || fallbackName;
      numZones = bytes[dataOffset + 16];
      useSecondStart = (bytes[dataOffset + 17] & 0x01) !== 0;
    } else if (id === 'MNO1' && size >= 4) {
      sampleNumber = view.getUint32(dataOffset, false);
    } else if (id === 'RLP1' && size >= 18) {
      const count = numZones > 0 ? Math.min(numZones, Math.floor(size / 18)) : Math.floor(size / 18);
      let prevTopKey = -1;
      for (let i = 0; i < count; i++) {
        const zOff = dataOffset + i * 18;
        const rawOrigKey = bytes[zOff + 0];
        const noKeyTrack = (rawOrigKey & 0x80) !== 0;
        const rootKey = Math.max(0, Math.min(127, rawOrigKey & 0x7f));
        const highKey = Math.max(0, Math.min(127, bytes[zOff + 1] & 0x7f));
        const lowKey = Math.max(0, Math.min(highKey, prevTopKey + 1));
        prevTopKey = highKey;

        const detuneCents = view.getInt8(zOff + 2);
        // Level: -99..+99 -> -6..+6 dB
        const rawLevel = view.getInt8(zOff + 3);
        const volumeDb = Math.round(((rawLevel / 99) * 6) * 100) / 100;
        // Pan: 0..127 (64 = center) -> -50..+50
        const rawPan = bytes[zOff + 4] & 0x7f;
        const pan = Math.max(-50, Math.min(50, Math.round(((rawPan - 64) / 64) * 50)));
        const filterCutoffOffset = view.getInt8(zOff + 5);
        const ksfFilename = readAscii(bytes, zOff + 6, 12);

        zones.push({
          index: i,
          lowKey,
          highKey,
          rootKey,
          pitchKeytrack: noKeyTrack ? 0 : 100,
          detuneCents,
          volumeDb,
          pan,
          filterCutoffOffset,
          ksfFilename,
        });
      }
    } else if (id === 'NAME' && size >= 1) {
      fullName = readAscii(bytes, dataOffset, size);
    }

    pos = dataOffset + size;
  }

  return {
    presetName: fullName || shortName || fallbackName,
    shortName,
    sampleNumber,
    useSecondStart,
    zones,
  };
}

/**
 * Builds a Big-Endian Korg `.KSF` binary file from a 16-bit mono PCM array.
 */
export function buildKorgKsfBinary(options: {
  sampleName: string;
  sampleIndex: number;
  sampleRate: number;
  pcm16Mono: Int16Array;
  startFrame?: number;
  loopMode: LoopMode;
  loopStart: number;
  loopEnd: number;
  reversed?: boolean;
}): Uint8Array {
  const {
    sampleName,
    sampleIndex,
    sampleRate,
    pcm16Mono,
    startFrame = 0,
    loopMode,
    loopStart,
    loopEnd,
    reversed = false,
  } = options;

  const numSamples = pcm16Mono.length;
  const pcmBytes = numSamples * 2;
  // Chunks: SMP1 (8+32=40) + SNO1 (8+4=12) + SMD1 (8+12+pcmBytes) + NAME (8+24=32)
  const totalBytes = 40 + 12 + 20 + pcmBytes + 32;
  const out = new Uint8Array(totalBytes);
  const view = new DataView(out.buffer);

  let ptr = 0;

  // 1. SMP1 (32B)
  writeAsciiPadded(out, ptr, 4, 'SMP1');
  view.setUint32(ptr + 4, 32, false);
  const sOff = ptr + 8;
  writeAsciiPadded(out, sOff, 16, sampleName.slice(0, 16), 0x20);
  const st = Math.max(0, Math.min(numSamples, Math.round(startFrame)));
  out[sOff + 16] = 0; // defaultBank
  out[sOff + 17] = (st >>> 16) & 0xff;
  out[sOff + 18] = (st >>> 8) & 0xff;
  out[sOff + 19] = st & 0xff;
  view.setUint32(sOff + 20, st, false); // secondStart

  const hasLoop = loopMode !== 'no_loop' && loopMode !== 'one_shot' && loopEnd > loopStart;
  const lStart = hasLoop ? Math.max(0, Math.min(numSamples - 1, Math.round(loopStart))) : 0;
  const lEnd = hasLoop ? Math.max(lStart + 1, Math.min(numSamples, Math.round(loopEnd))) : Math.max(0, numSamples - 1);
  view.setUint32(sOff + 24, lStart, false);
  view.setUint32(sOff + 28, lEnd, false);
  ptr += 40;

  // 2. SNO1 (4B)
  writeAsciiPadded(out, ptr, 4, 'SNO1');
  view.setUint32(ptr + 4, 4, false);
  view.setUint32(ptr + 8, sampleIndex, false);
  ptr += 12;

  // 3. SMD1 (12B + pcmBytes)
  writeAsciiPadded(out, ptr, 4, 'SMD1');
  view.setUint32(ptr + 4, 12 + pcmBytes, false);
  const dOff = ptr + 8;
  view.setUint32(dOff + 0, sampleRate, false);
  // Attributes: bit 4 (0x10) normal + bit 6 (0x40) reverse + bit 7 (0x80) no-loop
  let attrs = 0x10;
  if (reversed) attrs |= 0x40;
  if (!hasLoop) attrs |= 0x80;
  out[dOff + 4] = attrs;
  view.setInt8(dOff + 5, 0); // loopTune
  out[dOff + 6] = 1; // channels = 1 (mono)
  out[dOff + 7] = 16; // 16-bit
  view.setUint32(dOff + 8, numSamples, false);

  const pcmOutOffset = dOff + 12;
  for (let i = 0; i < numSamples; i++) {
    view.setInt16(pcmOutOffset + i * 2, pcm16Mono[i], false); // Big-Endian
  }
  ptr += 20 + pcmBytes;

  // 4. NAME (24B)
  writeAsciiPadded(out, ptr, 4, 'NAME');
  view.setUint32(ptr + 4, 24, false);
  writeAsciiPadded(out, ptr + 8, 24, sampleName.slice(0, 24), 0x00);

  return out;
}

/**
 * Builds a Big-Endian Korg `.KMP` binary file + companion `.KSF` files and `.KSC` script.
 */
export function buildKorgKmpPackage(options: {
  presetName: string;
  regions: Array<
    UniformSamplerRegion & {
      pcm16Mono: Int16Array;
      sampleRate: number;
    }
  >;
}): {
  kmpFileName: string;
  kmpData: Uint8Array;
  kscFileName: string;
  kscText: string;
  ksfFiles: Array<{ fileName: string; data: Uint8Array }>;
} {
  const { presetName, regions } = options;
  // Sort regions by lowKey, highKey (Korg KMP requires monotonic non-overlapping key splits)
  const sorted = [...regions].sort((a, b) => a.lowKey - b.lowKey || a.highKey - b.highKey);
  const numZones = Math.min(128, sorted.length);

  const shortStem = presetName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6) || 'INST00';
  const kmpFileName = `${shortStem}.KMP`;
  const kscFileName = `${shortStem}.KSC`;

  const ksfFiles: Array<{ fileName: string; data: Uint8Array }> = [];

  // MSP1 (8+18=26) + MNO1 (8+4=12) + RLP1 (8+numZones*18) + RLP2 (8+numZones*4) + NAME (8+24=32)
  const rlp1Size = numZones * 18;
  const rlp2Size = numZones * 4;
  const totalKmpBytes = 26 + 12 + (8 + rlp1Size) + (8 + rlp2Size) + 32;
  const kmpOut = new Uint8Array(totalKmpBytes);
  const view = new DataView(kmpOut.buffer);

  let ptr = 0;

  // 1. MSP1 (18B)
  writeAsciiPadded(kmpOut, ptr, 4, 'MSP1');
  view.setUint32(ptr + 4, 18, false);
  writeAsciiPadded(kmpOut, ptr + 8, 16, presetName.slice(0, 16), 0x20);
  kmpOut[ptr + 24] = numZones;
  kmpOut[ptr + 25] = 1; // useSecondStart
  ptr += 26;

  // 2. MNO1 (4B)
  writeAsciiPadded(kmpOut, ptr, 4, 'MNO1');
  view.setUint32(ptr + 4, 4, false);
  view.setUint32(ptr + 8, 0, false);
  ptr += 12;

  // 3. RLP1 (numZones * 18B)
  writeAsciiPadded(kmpOut, ptr, 4, 'RLP1');
  view.setUint32(ptr + 4, rlp1Size, false);
  const rlp1Off = ptr + 8;

  for (let i = 0; i < numZones; i++) {
    const reg = sorted[i];
    const ksfName = `MS${String(i).padStart(6, '0')}.KSF`;
    const ksfData = buildKorgKsfBinary({
      sampleName: reg.sampleName.replace(/\.[^.]+$/, ''),
      sampleIndex: i,
      sampleRate: reg.sampleRate,
      pcm16Mono: reg.pcm16Mono,
      startFrame: reg.sampleStartFrame ?? 0,
      loopMode: reg.loopMode,
      loopStart: reg.loopStart,
      loopEnd: reg.loopEnd,
      reversed: reg.reversed,
    });
    ksfFiles.push({ fileName: ksfName, data: ksfData });

    const zOff = rlp1Off + i * 18;
    const coarseSt = Math.trunc(reg.detuneCents / 100);
    const fineCents = Math.max(-99, Math.min(99, Math.round(reg.detuneCents - coarseSt * 100)));
    const adjustedRoot = Math.max(0, Math.min(127, reg.rootKey - coarseSt));
    const origKeyByte = (adjustedRoot & 0x7f) | (reg.pitchKeytrack === 0 ? 0x80 : 0x00);
    const topKeyByte = i === numZones - 1 ? Math.max(reg.highKey, 127) : Math.max(0, Math.min(127, reg.highKey));

    kmpOut[zOff + 0] = origKeyByte;
    kmpOut[zOff + 1] = topKeyByte & 0x7f;
    view.setInt8(zOff + 2, fineCents);
    // Level -6..+6 dB -> -99..+99
    const lvl = Math.max(-99, Math.min(99, Math.round((Math.max(-6, Math.min(6, reg.volumeDb)) / 6) * 99)));
    view.setInt8(zOff + 3, lvl);
    const panByte = Math.max(0, Math.min(127, Math.round(64 + (reg.pan / 50) * 63)));
    kmpOut[zOff + 4] = panByte;
    view.setInt8(zOff + 5, 0); // filter cutoff offset
    writeAsciiPadded(kmpOut, zOff + 6, 12, ksfName, 0x20);
  }
  ptr += 8 + rlp1Size;

  // 4. RLP2 (numZones * 4B)
  writeAsciiPadded(kmpOut, ptr, 4, 'RLP2');
  view.setUint32(ptr + 4, rlp2Size, false);
  for (let i = 0; i < numZones; i++) {
    view.setUint32(ptr + 8 + i * 4, 0, false);
  }
  ptr += 8 + rlp2Size;

  // 5. NAME (24B)
  writeAsciiPadded(kmpOut, ptr, 4, 'NAME');
  view.setUint32(ptr + 4, 24, false);
  writeAsciiPadded(kmpOut, ptr + 8, 24, presetName.slice(0, 24), 0x00);

  const kscText = `#KORG Script Version 1.0\r\n${kmpFileName}\r\n`;

  return {
    kmpFileName,
    kmpData: kmpOut,
    kscFileName,
    kscText,
    ksfFiles,
  };
}
