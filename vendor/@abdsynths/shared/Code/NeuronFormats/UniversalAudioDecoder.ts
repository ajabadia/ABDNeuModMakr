// ─────────────────────────────────────────────────────────
// @abdsynths/shared — Universal Audio Sample Decoder & Normalizer
//
// Clean-room TypeScript implementation supporting:
//   1. Native FLAC ('fLaC', RFC 9639):
//      - STREAMINFO, APPLICATION ('riff' embedded smpl/inst chunks), VORBIS_COMMENT
//      - Constant, Verbatim, Fixed (order 0..4), and LPC (order 1..32) subframes
//      - 4-bit (Rice) and 5-bit (Rice2) partitioned residuals
//      - Independent, Left-Side, Right-Side, and Mid-Side channel decorrelation
//      - 8, 12, 16, 20, 24, and 32 bits per sample
//   2. Apple CoreAudio Format ('caff', .caf):
//      - 'desc', 'data', 'inst', 'regn', 'pakt' chunks (64-bit big-endian lengths)
//      - 'lpcm' (8/16/24/32-bit int BE/LE, 32/64-bit float BE/LE), 'ulaw', 'alaw', 'ima4'
//   3. G.711 µ-Law / A-Law and IMA4 / MS-ADPCM helpers for WAV, AIFC, and CAF
//   4. Universal async normalizer (`transcodeAnyAudioToWavBuffer`) for MP3 (.mp3),
//      OGG Vorbis (.ogg, .oga), AAC/M4A (.m4a, .aac), Opus (.opus, .webm), FLAC (.flac),
//      CAF (.caf), AIFF/AIFC (.aif, .aiff, .aifc), and WAV (.wav) via pure-TS + WebAudio API.
// ─────────────────────────────────────────────────────────

import {
  decodeWav,
  encodeWavPcm16,
  type AiffInstrumentInfo,
  type DecodedWav,
} from './WavAiffDecoder.ts';

/** Regular expression matching all supported raw audio file extensions across ABDSynths. */
export const SUPPORTED_AUDIO_FILE_REGEX =
  /\.(wav|aif|aiff|aifc|flac|mp3|ogg|oga|m4a|aac|opus|webm|caf|ncw)$/i;

/** HTML `<input type="file" accept="...">` string for all supported audio sample formats. */
export const SUPPORTED_AUDIO_ACCEPT =
  '.wav,.aif,.aiff,.aifc,.flac,.mp3,.ogg,.oga,.m4a,.aac,.opus,.webm,.caf,.ncw,audio/*';

/**
 * Checks whether a filename has a supported audio sample extension.
 */
export function isSupportedAudioFileName(name: string): boolean {
  return SUPPORTED_AUDIO_FILE_REGEX.test(name.trim());
}

// ── G.711 µ-Law & A-Law Lookup Decoders ──────────────────

export function decodeMuLawSample(uVal: number): number {
  const b = ~uVal & 0xff;
  const sign = b & 0x80;
  const exponent = (b >> 4) & 0x07;
  const mantissa = b & 0x0f;
  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  return (sign !== 0 ? -sample : sample) / 32768.0;
}

export function decodeALawSample(aVal: number): number {
  const b = aVal ^ 0x55;
  const sign = b & 0x80;
  const exponent = (b >> 4) & 0x07;
  const mantissa = b & 0x0f;
  let sample =
    exponent === 0
      ? (mantissa << 4) + 8
      : ((mantissa << 4) + 0x108) << (exponent - 1);
  return (sign !== 0 ? sample : -sample) / 32768.0;
}

// ── IMA ADPCM Tables & Step Decoder ──────────────────────

export const IMA_INDEX_TABLE = [
  -1, -1, -1, -1, 2, 4, 6, 8,
  -1, -1, -1, -1, 2, 4, 6, 8,
];

export const IMA_STEP_TABLE = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17,
  19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
  50, 55, 60, 66, 73, 80, 88, 97, 107, 118,
  130, 143, 157, 173, 190, 209, 230, 253, 279, 307,
  337, 371, 408, 449, 494, 544, 598, 658, 724, 796,
  876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066,
  2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358,
  5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899,
  15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
];

export function decodeImaAdpcmNibble(
  nibble: number,
  state: { predictor: number; stepIndex: number }
): number {
  const step = IMA_STEP_TABLE[state.stepIndex];
  let diff = step >> 3;
  if (nibble & 1) diff += step >> 2;
  if (nibble & 2) diff += step >> 1;
  if (nibble & 4) diff += step;
  if (nibble & 8) {
    state.predictor = Math.max(-32768, state.predictor - diff);
  } else {
    state.predictor = Math.min(32767, state.predictor + diff);
  }
  state.stepIndex = Math.max(0, Math.min(88, state.stepIndex + IMA_INDEX_TABLE[nibble & 0x0f]));
  return state.predictor / 32768.0;
}

/**
 * Decodes Apple QuickTime `ima4` packets (34 bytes -> 64 frames per channel).
 */
export function decodeAppleIma4Packets(
  view: DataView,
  dataStart: number,
  dataBytes: number,
  numChannels: number,
  expectedFrames?: number
): { channels: Float32Array[]; numSamples: number } {
  const packetBytesPerChannel = 34;
  const framesPerPacket = 64;
  const framePacketStride = packetBytesPerChannel * numChannels;
  const numPackets = Math.floor(dataBytes / framePacketStride);
  const totalFrames =
    expectedFrames && expectedFrames > 0
      ? Math.min(expectedFrames, numPackets * framesPerPacket)
      : numPackets * framesPerPacket;

  const channels: Float32Array[] = [];
  const states: Array<{ predictor: number; stepIndex: number }> = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(new Float32Array(totalFrames));
    states.push({ predictor: 0, stepIndex: 0 });
  }

  let ptr = dataStart;
  let outFrame = 0;
  for (let pkt = 0; pkt < numPackets && outFrame < totalFrames; pkt++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const header = view.getInt16(ptr, false);
      const stepIndex = Math.max(0, Math.min(88, header & 0x7f));
      let predictor = header & ~0x7f;
      if (predictor > 32767) predictor -= 65536;
      const st = states[ch];
      st.predictor = predictor;
      st.stepIndex = stepIndex;
      ptr += 2;

      const chOut = channels[ch];
      for (let b = 0; b < 32; b++) {
        const byte = view.getUint8(ptr + b);
        const f0 = outFrame + b * 2;
        const f1 = f0 + 1;
        const s0 = decodeImaAdpcmNibble(byte & 0x0f, st);
        const s1 = decodeImaAdpcmNibble((byte >> 4) & 0x0f, st);
        if (f0 < totalFrames) chOut[f0] = s0;
        if (f1 < totalFrames) chOut[f1] = s1;
      }
      ptr += 32;
    }
    outFrame += framesPerPacket;
  }

  return { channels, numSamples: totalFrames };
}

// ── Apple CoreAudio Format (.caf) Pure-TS Decoder ────────

function readFourCC(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3)
  );
}

function readInt64BigEndian(view: DataView, offset: number): number {
  const hi = view.getInt32(offset, false);
  const lo = view.getUint32(offset + 4, false);
  if (hi === -1 && lo === 0xffffffff) return -1;
  return hi * 4294967296 + lo;
}

/**
 * Decodes an Apple CoreAudio Format (`.caf`, magic `'caff'`) buffer into `DecodedWav`.
 */
export function decodeCaf(buffer: ArrayBuffer): DecodedWav {
  if (buffer.byteLength < 32) {
    throw new Error('Invalid CAF: buffer too small');
  }
  const view = new DataView(buffer);
  const magic = readFourCC(view, 0);
  if (magic !== 'caff') {
    throw new Error(`Invalid CAF: expected 'caff' header, found '${magic}'`);
  }
  const version = view.getUint16(4, false);
  if (version !== 1) {
    throw new Error(`Unsupported CAF version: ${version}`);
  }

  let offset = 8;
  let sampleRate = 44100;
  let formatID = 'lpcm';
  let formatFlags = 0;
  let bytesPerPacket = 0;
  let framesPerPacket = 1;
  let numChannels = 1;
  let bitsPerChannel = 16;
  let dataStart = -1;
  let dataBytes = 0;
  let validFrames = -1;
  let instrument: AiffInstrumentInfo | undefined;
  let instSustainRegionID = 0;
  const regions = new Map<number, { startFrame: number; endFrame: number }>();

  while (offset + 12 <= buffer.byteLength) {
    const chunkType = readFourCC(view, offset);
    const chunkSize = readInt64BigEndian(view, offset + 4);
    const chunkDataStart = offset + 12;

    if (chunkType === 'desc' && chunkSize >= 32 && chunkDataStart + 32 <= buffer.byteLength) {
      sampleRate = Math.round(view.getFloat64(chunkDataStart, false));
      formatID = readFourCC(view, chunkDataStart + 8);
      formatFlags = view.getUint32(chunkDataStart + 12, false);
      bytesPerPacket = view.getUint32(chunkDataStart + 16, false);
      framesPerPacket = view.getUint32(chunkDataStart + 20, false);
      numChannels = view.getUint32(chunkDataStart + 24, false);
      bitsPerChannel = view.getUint32(chunkDataStart + 28, false);
    } else if (chunkType === 'data') {
      // First 4 bytes of data chunk are editCount
      dataStart = chunkDataStart + 4;
      if (chunkSize < 0) {
        dataBytes = Math.max(0, buffer.byteLength - dataStart);
        break;
      } else {
        dataBytes = Math.max(0, Math.min(chunkSize - 4, buffer.byteLength - dataStart));
      }
    } else if (chunkType === 'pakt' && chunkSize >= 24 && chunkDataStart + 24 <= buffer.byteLength) {
      validFrames = readInt64BigEndian(view, chunkDataStart + 8);
    } else if (chunkType === 'inst' && chunkSize >= 32 && chunkDataStart + 32 <= buffer.byteLength) {
      const baseNoteFloat = view.getFloat32(chunkDataStart, false);
      const rootKey = Math.max(0, Math.min(127, Math.round(baseNoteFloat)));
      const detune = Math.max(-50, Math.min(50, Math.round((baseNoteFloat - rootKey) * 100)));
      const lowKey = view.getUint8(chunkDataStart + 4);
      const highKey = view.getUint8(chunkDataStart + 5);
      const lowVelocity = view.getUint8(chunkDataStart + 6);
      const highVelocity = view.getUint8(chunkDataStart + 7);
      const gainDb = view.getFloat32(chunkDataStart + 8, false);
      instSustainRegionID = view.getUint32(chunkDataStart + 16, false);
      instrument = {
        rootKey,
        detune,
        lowKey,
        highKey,
        lowVelocity: Math.max(1, lowVelocity),
        highVelocity: Math.max(1, highVelocity),
        gainDb,
      };
    } else if (chunkType === 'regn' && chunkSize >= 8 && chunkDataStart + 8 <= buffer.byteLength) {
      const numRegions = view.getUint32(chunkDataStart + 4, false);
      let rPtr = chunkDataStart + 8;
      for (let r = 0; r < numRegions && rPtr + 12 <= chunkDataStart + chunkSize; r++) {
        const regID = view.getUint32(rPtr, false);
        const numMarkers = view.getUint32(rPtr + 8, false);
        rPtr += 12;
        let minFrame = Infinity;
        let maxFrame = -Infinity;
        for (let m = 0; m < numMarkers && rPtr + 24 <= chunkDataStart + chunkSize; m++) {
          const framePos = view.getFloat64(rPtr + 4, false);
          if (framePos < minFrame) minFrame = framePos;
          if (framePos > maxFrame) maxFrame = framePos;
          rPtr += 24;
        }
        if (Number.isFinite(minFrame) && Number.isFinite(maxFrame) && maxFrame > minFrame) {
          regions.set(regID, { startFrame: Math.round(minFrame), endFrame: Math.round(maxFrame) });
        }
      }
    }

    if (chunkSize < 0) break;
    offset = chunkDataStart + chunkSize;
  }

  if (instrument && instSustainRegionID > 0 && regions.has(instSustainRegionID)) {
    const reg = regions.get(instSustainRegionID)!;
    instrument.loopStart = reg.startFrame;
    instrument.loopEnd = reg.endFrame;
    instrument.loopMode = 'loop_continuous';
  }

  if (dataStart < 0 || dataBytes <= 0) {
    throw new Error('Invalid CAF: missing or empty audio data chunk');
  }

  let channels: Float32Array[] = [];
  let numSamples = 0;

  if (formatID === 'ima4') {
    const decodedIma = decodeAppleIma4Packets(
      view,
      dataStart,
      dataBytes,
      numChannels,
      validFrames > 0 ? validFrames : undefined
    );
    channels = decodedIma.channels;
    numSamples = decodedIma.numSamples;
  } else if (formatID === 'ulaw' || formatID === 'alaw') {
    const isUlaw = formatID === 'ulaw';
    const stride = numChannels;
    numSamples = Math.floor(dataBytes / stride);
    if (validFrames > 0) numSamples = Math.min(numSamples, validFrames);
    for (let ch = 0; ch < numChannels; ch++) channels.push(new Float32Array(numSamples));
    let ptr = dataStart;
    for (let i = 0; i < numSamples; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const b = view.getUint8(ptr++);
        channels[ch][i] = isUlaw ? decodeMuLawSample(b) : decodeALawSample(b);
      }
    }
  } else if (formatID === 'lpcm') {
    const isFloat = (formatFlags & 1) !== 0;
    const isLittleEndian = (formatFlags & 2) !== 0;
    const bytesPerSample = Math.max(1, bitsPerChannel >>> 3);
    const stride = bytesPerPacket > 0 ? bytesPerPacket : numChannels * bytesPerSample;
    numSamples = Math.floor(dataBytes / stride) * Math.max(1, framesPerPacket);
    if (validFrames > 0) numSamples = Math.min(numSamples, validFrames);

    for (let ch = 0; ch < numChannels; ch++) channels.push(new Float32Array(numSamples));
    let ptr = dataStart;
    for (let i = 0; i < numSamples; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        let val = 0;
        if (isFloat) {
          val =
            bitsPerChannel === 64
              ? view.getFloat64(ptr, isLittleEndian)
              : view.getFloat32(ptr, isLittleEndian);
        } else if (bitsPerChannel === 8) {
          val = view.getInt8(ptr) / 128.0;
        } else if (bitsPerChannel === 16) {
          val = view.getInt16(ptr, isLittleEndian) / 32768.0;
        } else if (bitsPerChannel === 24) {
          const b0 = view.getUint8(ptr);
          const b1 = view.getUint8(ptr + 1);
          const b2 = view.getUint8(ptr + 2);
          const int24 = isLittleEndian
            ? ((b2 << 24) | (b1 << 16) | (b0 << 8)) >> 8
            : ((b0 << 24) | (b1 << 16) | (b2 << 8)) >> 8;
          val = int24 / 8388608.0;
        } else {
          val = view.getInt32(ptr, isLittleEndian) / 2147483648.0;
        }
        channels[ch][i] = Number.isFinite(val) ? val : 0;
        ptr += bytesPerSample;
      }
    }
  } else {
    throw new Error(`Unsupported CAF audio codec '${formatID}'`);
  }

  const mono = new Float32Array(numSamples);
  if (numChannels === 1) {
    mono.set(channels[0]);
  } else {
    const left = channels[0];
    const right = channels[1];
    for (let i = 0; i < numSamples; i++) {
      mono[i] = (left[i] + right[i]) * 0.5;
    }
  }

  return {
    sampleRate,
    numChannels,
    bitsPerSample: bitsPerChannel || 16,
    formatTag: 'pcm',
    numSamples,
    durationSec: numSamples / sampleRate,
    channels,
    mono,
    instrument,
  };
}

// ── Native FLAC ('fLaC', RFC 9639) Pure-TS Decoder ───────

class FlacBitReader {
  private readonly bytes: Uint8Array;
  public bytePos: number;
  private bitPos = 0; // 0..7 bits consumed in current byte (MSB-first)

  constructor(bytes: Uint8Array, startOffset = 0) {
    this.bytes = bytes;
    this.bytePos = startOffset;
  }

  public eof(): boolean {
    return this.bytePos >= this.bytes.length;
  }

  public alignToByte(): void {
    if (this.bitPos !== 0) {
      this.bitPos = 0;
      this.bytePos++;
    }
  }

  public readBit(): number {
    if (this.bytePos >= this.bytes.length) {
      throw new Error('Unexpected EOF in FLAC bitstream');
    }
    const bit = (this.bytes[this.bytePos] >>> (7 - this.bitPos)) & 1;
    this.bitPos++;
    if (this.bitPos === 8) {
      this.bitPos = 0;
      this.bytePos++;
    }
    return bit;
  }

  public readUint(bits: number): number {
    if (bits === 0) return 0;
    let val = 0;
    let remaining = bits;
    while (remaining > 0) {
      if (this.bytePos >= this.bytes.length) {
        throw new Error('Unexpected EOF in FLAC bitstream');
      }
      const avail = 8 - this.bitPos;
      const take = Math.min(remaining, avail);
      const shift = avail - take;
      const mask = (1 << take) - 1;
      const chunk = (this.bytes[this.bytePos] >>> shift) & mask;
      val = val * (1 << take) + chunk;
      this.bitPos += take;
      if (this.bitPos === 8) {
        this.bitPos = 0;
        this.bytePos++;
      }
      remaining -= take;
    }
    return val;
  }

  public readInt(bits: number): number {
    if (bits === 0) return 0;
    const u = this.readUint(bits);
    if (bits === 32) {
      return u | 0;
    }
    const signBit = 1 << (bits - 1);
    return (u & signBit) !== 0 ? u - (1 << bits) : u;
  }

  public readUnaryZeros(): number {
    let count = 0;
    while (this.bitPos === 0 && this.bytePos < this.bytes.length && this.bytes[this.bytePos] === 0) {
      count += 8;
      this.bytePos++;
    }
    while (this.readBit() === 0) {
      count++;
    }
    return count;
  }

  public readUtf8CodedNumber(): number {
    const first = this.readUint(8);
    if ((first & 0x80) === 0) return first;
    let bytes = 0;
    let mask = 0x80;
    while ((first & mask) !== 0) {
      bytes++;
      mask >>>= 1;
    }
    let val = first & (mask - 1);
    for (let i = 1; i < bytes; i++) {
      const b = this.readUint(8);
      if ((b & 0xc0) !== 0x80) return -1;
      val = val * 64 + (b & 0x3f);
    }
    return val;
  }
}

function decodeFlacResidual(
  br: FlacBitReader,
  blockSize: number,
  predictorOrder: number,
  out: Int32Array
): void {
  const codingMethod = br.readUint(2);
  if (codingMethod > 1) {
    throw new Error(`Invalid FLAC residual coding method: ${codingMethod}`);
  }
  const paramBits = codingMethod === 0 ? 4 : 5;
  const escapeParam = codingMethod === 0 ? 0x0f : 0x1f;
  const partitionOrder = br.readUint(4);
  const numPartitions = 1 << partitionOrder;
  const partSamples = blockSize >>> partitionOrder;

  let sampleIdx = predictorOrder;
  for (let p = 0; p < numPartitions; p++) {
    const n = p === 0 ? partSamples - predictorOrder : partSamples;
    if (n < 0 || sampleIdx + n > blockSize) {
      throw new Error('Invalid FLAC residual partition size');
    }
    const riceParam = br.readUint(paramBits);
    if (riceParam === escapeParam) {
      const rawBits = br.readUint(5);
      for (let i = 0; i < n; i++) {
        out[sampleIdx++] = rawBits > 0 ? br.readInt(rawBits) : 0;
      }
    } else {
      for (let i = 0; i < n; i++) {
        const q = br.readUnaryZeros();
        const r = riceParam > 0 ? br.readUint(riceParam) : 0;
        const u = (q << riceParam) | r;
        out[sampleIdx++] = (u >>> 1) ^ -(u & 1);
      }
    }
  }
}

function decodeFlacSubframe(
  br: FlacBitReader,
  blockSize: number,
  bps: number,
  out: Int32Array
): void {
  const zeroBit = br.readBit();
  if (zeroBit !== 0) {
    throw new Error('Invalid FLAC subframe header padding bit');
  }
  const typeCode = br.readUint(6);
  const hasWastedBits = br.readBit();
  let wastedBits = 0;
  if (hasWastedBits === 1) {
    wastedBits = 1 + br.readUnaryZeros();
  }
  const effBps = bps - wastedBits;

  if (typeCode === 0) {
    // SUBFRAME_CONSTANT
    const c = br.readInt(effBps);
    out.fill(c, 0, blockSize);
  } else if (typeCode === 1) {
    // SUBFRAME_VERBATIM
    for (let i = 0; i < blockSize; i++) {
      out[i] = br.readInt(effBps);
    }
  } else if (typeCode >= 8 && typeCode <= 12) {
    // SUBFRAME_FIXED (order 0..4)
    const order = typeCode - 8;
    for (let i = 0; i < order; i++) {
      out[i] = br.readInt(effBps);
    }
    decodeFlacResidual(br, blockSize, order, out);
    for (let i = order; i < blockSize; i++) {
      let pred = 0;
      if (order === 1) pred = out[i - 1];
      else if (order === 2) pred = 2 * out[i - 1] - out[i - 2];
      else if (order === 3) pred = 3 * out[i - 1] - 3 * out[i - 2] + out[i - 3];
      else if (order === 4) pred = 4 * out[i - 1] - 6 * out[i - 2] + 4 * out[i - 3] - out[i - 4];
      out[i] += pred;
    }
  } else if (typeCode >= 32) {
    // SUBFRAME_LPC (order 1..32)
    const order = typeCode - 31;
    for (let i = 0; i < order; i++) {
      out[i] = br.readInt(effBps);
    }
    const qlpPrecision = br.readUint(4) + 1;
    if (qlpPrecision === 16) {
      throw new Error('Invalid FLAC QLP precision');
    }
    const qlpShift = br.readInt(5);
    const coeffs = new Int32Array(order);
    for (let i = 0; i < order; i++) {
      coeffs[i] = br.readInt(qlpPrecision);
    }
    decodeFlacResidual(br, blockSize, order, out);
    const shiftRight = Math.max(0, qlpShift);
    const shiftDiv = Math.pow(2, shiftRight);
    for (let i = order; i < blockSize; i++) {
      let sum = 0;
      for (let j = 0; j < order; j++) {
        sum += coeffs[j] * out[i - 1 - j];
      }
      const pred = shiftRight <= 30 ? (sum >> shiftRight) : Math.floor(sum / shiftDiv);
      out[i] += pred;
    }
  } else {
    throw new Error(`Unsupported or reserved FLAC subframe type: ${typeCode}`);
  }

  if (wastedBits > 0) {
    for (let i = 0; i < blockSize; i++) {
      out[i] <<= wastedBits;
    }
  }
}

/**
 * Decodes a binary FLAC (`'fLaC'`) ArrayBuffer into `DecodedWav` in pure TypeScript.
 */
export function decodeFlac(buffer: ArrayBuffer): DecodedWav {
  if (buffer.byteLength < 42) {
    throw new Error('Invalid FLAC: buffer too small');
  }
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (readFourCC(view, 0) !== 'fLaC') {
    throw new Error('Invalid FLAC: missing fLaC signature');
  }

  let offset = 4;
  let sampleRate = 44100;
  let numChannels = 1;
  let bitsPerSample = 16;
  let totalSamples = 0;
  let instrument: AiffInstrumentInfo | undefined;

  // 1. Parse Metadata Blocks
  while (offset + 4 <= buffer.byteLength) {
    const headerByte = bytes[offset];
    const isLast = (headerByte & 0x80) !== 0;
    const blockType = headerByte & 0x7f;
    const blockLen = (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
    const blockStart = offset + 4;
    if (blockStart + blockLen > buffer.byteLength) break;

    if (blockType === 0 && blockLen >= 18) {
      // STREAMINFO
      const b10 = bytes[blockStart + 10];
      const b11 = bytes[blockStart + 11];
      const b12 = bytes[blockStart + 12];
      const b13 = bytes[blockStart + 13];
      sampleRate = (b10 << 12) | (b11 << 4) | (b12 >>> 4);
      numChannels = ((b12 >>> 1) & 0x07) + 1;
      bitsPerSample = (((b12 & 0x01) << 4) | (b13 >>> 4)) + 1;
      const hiSamples = b13 & 0x0f;
      const loSamples = view.getUint32(blockStart + 14, false);
      totalSamples = hiSamples * 4294967296 + loSamples;
    } else if (blockType === 2 && blockLen >= 12) {
      // APPLICATION block — check for 'riff' (embedded RIFF smpl/inst chunk)
      const appId = readFourCC(view, blockStart);
      if (appId === 'riff') {
        const subChunkId = readFourCC(view, blockStart + 4);
        const subChunkSize = view.getUint32(blockStart + 8, true);
        const subData = blockStart + 12;
        if (subChunkId === 'smpl' && subChunkSize >= 36 && subData + 36 <= blockStart + blockLen) {
          const midiUnityNote = view.getUint32(subData + 12, true);
          const numLoops = view.getUint32(subData + 28, true);
          let loopStart: number | undefined;
          let loopEnd: number | undefined;
          if (numLoops > 0 && subData + 60 <= blockStart + blockLen) {
            loopStart = view.getUint32(subData + 44, true);
            loopEnd = view.getUint32(subData + 48, true);
          }
          instrument = {
            rootKey: Math.max(0, Math.min(127, midiUnityNote)),
            detune: 0,
            lowKey: 0,
            highKey: 127,
            lowVelocity: 1,
            highVelocity: 127,
            gainDb: 0,
            loopStart,
            loopEnd,
            loopMode: loopEnd && loopStart !== undefined && loopEnd > loopStart ? 'loop_continuous' : 'no_loop',
          };
        }
      }
    } else if (blockType === 4 && blockLen >= 8) {
      // VORBIS_COMMENT
      try {
        let cPtr = blockStart;
        const vendorLen = view.getUint32(cPtr, true);
        cPtr += 4 + vendorLen;
        if (cPtr + 4 <= blockStart + blockLen) {
          const commentCount = view.getUint32(cPtr, true);
          cPtr += 4;
          const dec = new TextDecoder('utf-8');
          for (let c = 0; c < commentCount && cPtr + 4 <= blockStart + blockLen; c++) {
            const len = view.getUint32(cPtr, true);
            cPtr += 4;
            if (cPtr + len > blockStart + blockLen) break;
            const kv = dec.decode(bytes.subarray(cPtr, cPtr + len));
            cPtr += len;
            const eq = kv.indexOf('=');
            if (eq > 0) {
              const k = kv.slice(0, eq).trim().toUpperCase();
              const v = parseInt(kv.slice(eq + 1).trim(), 10);
              if (Number.isFinite(v)) {
                instrument = instrument ?? {
                  rootKey: 60,
                  detune: 0,
                  lowKey: 0,
                  highKey: 127,
                  lowVelocity: 1,
                  highVelocity: 127,
                  gainDb: 0,
                };
                if (k === 'ROOTKEY' || k === 'MIDI_UNITY_NOTE') instrument.rootKey = Math.max(0, Math.min(127, v));
                if (k === 'LOOPSTART' || k === 'LOOP_START') instrument.loopStart = v;
                if (k === 'LOOPEND' || k === 'LOOP_END') {
                  instrument.loopEnd = v;
                  instrument.loopMode = 'loop_continuous';
                }
              }
            }
          }
        }
      } catch {
        // Ignore malformed vorbis comments
      }
    }

    offset = blockStart + blockLen;
    if (isLast) break;
  }

  // 2. Decode Audio Frames
  const channelChunks: Float32Array[][] = Array.from({ length: numChannels }, () => []);
  let decodedFrames = 0;
  const br = new FlacBitReader(bytes, offset);

  const subBufs: Int32Array[] = Array.from({ length: 8 }, () => new Int32Array(65536));

  while (br.bytePos + 6 <= bytes.length) {
    // Search for 14-bit frame sync code 0b11111111111110 (0xFF 0xF8 or 0xFF 0xF9)
    br.alignToByte();
    while (
      br.bytePos + 2 <= bytes.length &&
      !(bytes[br.bytePos] === 0xff && (bytes[br.bytePos + 1] & 0xfc) === 0xf8)
    ) {
      br.bytePos++;
    }
    if (br.bytePos + 6 > bytes.length) break;

    const sync = br.readUint(14);
    if (sync !== 0x3ffe) continue;
    const reserved0 = br.readBit();
    if (reserved0 !== 0) continue;
    const blockingStrategy = br.readBit();
    void blockingStrategy;

    const blockSizeCode = br.readUint(4);
    const sampleRateCode = br.readUint(4);
    const chanAssign = br.readUint(4);
    const sampleSizeCode = br.readUint(3);
    const reserved1 = br.readBit();
    if (reserved1 !== 0) continue;

    const codedNum = br.readUtf8CodedNumber();
    if (codedNum < 0) continue;

    let blockSize = 4096;
    if (blockSizeCode === 1) blockSize = 192;
    else if (blockSizeCode >= 2 && blockSizeCode <= 5) blockSize = 576 * (1 << (blockSizeCode - 2));
    else if (blockSizeCode === 6) blockSize = br.readUint(8) + 1;
    else if (blockSizeCode === 7) blockSize = br.readUint(16) + 1;
    else if (blockSizeCode >= 8) blockSize = 256 * (1 << (blockSizeCode - 8));

    if (sampleRateCode === 12) br.readUint(8);
    else if (sampleRateCode === 13 || sampleRateCode === 14) br.readUint(16);

    let frameBps = bitsPerSample;
    if (sampleSizeCode === 1) frameBps = 8;
    else if (sampleSizeCode === 2) frameBps = 12;
    else if (sampleSizeCode === 4) frameBps = 16;
    else if (sampleSizeCode === 5) frameBps = 20;
    else if (sampleSizeCode === 6) frameBps = 24;
    else if (sampleSizeCode === 7) frameBps = 32;

    // Frame header CRC-8
    br.readUint(8);

    const frameChannels = chanAssign < 8 ? chanAssign + 1 : 2;
    for (let ch = 0; ch < frameChannels; ch++) {
      let subBps = frameBps;
      if (
        (chanAssign === 8 && ch === 1) ||
        (chanAssign === 9 && ch === 0) ||
        (chanAssign === 10 && ch === 1)
      ) {
        subBps++;
      }
      if (subBufs[ch].length < blockSize) {
        subBufs[ch] = new Int32Array(blockSize);
      }
      decodeFlacSubframe(br, blockSize, subBps, subBufs[ch]);
    }

    // Channel decorrelation for stereo modes 8 (left-side), 9 (right-side), 10 (mid-side)
    if (chanAssign === 8) {
      const left = subBufs[0];
      const side = subBufs[1];
      for (let i = 0; i < blockSize; i++) {
        side[i] = left[i] - side[i];
      }
    } else if (chanAssign === 9) {
      const side = subBufs[0];
      const right = subBufs[1];
      for (let i = 0; i < blockSize; i++) {
        side[i] = side[i] + right[i];
      }
    } else if (chanAssign === 10) {
      const mid = subBufs[0];
      const side = subBufs[1];
      for (let i = 0; i < blockSize; i++) {
        const s = side[i];
        const m = (mid[i] << 1) | (s & 1);
        mid[i] = (m + s) >> 1;
        side[i] = (m - s) >> 1;
      }
    }

    // Frame footer alignment + CRC-16
    br.alignToByte();
    br.readUint(16);

    const normScale = 1.0 / Math.pow(2, frameBps - 1);
    for (let ch = 0; ch < Math.min(numChannels, frameChannels); ch++) {
      const chunk = new Float32Array(blockSize);
      const src = subBufs[ch];
      for (let i = 0; i < blockSize; i++) {
        chunk[i] = Math.max(-1.0, Math.min(1.0, src[i] * normScale));
      }
      channelChunks[ch].push(chunk);
    }
    decodedFrames += blockSize;
    if (totalSamples > 0 && decodedFrames >= totalSamples) break;
  }

  const finalSamples = totalSamples > 0 ? Math.min(totalSamples, decodedFrames) : decodedFrames;
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    const out = new Float32Array(finalSamples);
    let pos = 0;
    for (const chunk of channelChunks[ch]) {
      const copyLen = Math.min(chunk.length, finalSamples - pos);
      if (copyLen > 0) {
        out.set(chunk.subarray(0, copyLen), pos);
        pos += copyLen;
      }
    }
    channels.push(out);
  }

  const mono = new Float32Array(finalSamples);
  if (numChannels === 1) {
    mono.set(channels[0]);
  } else {
    const left = channels[0];
    const right = channels[1];
    for (let i = 0; i < finalSamples; i++) {
      mono[i] = (left[i] + right[i]) * 0.5;
    }
  }

  return {
    sampleRate,
    numChannels,
    bitsPerSample,
    formatTag: 'pcm',
    numSamples: finalSamples,
    durationSec: finalSamples / Math.max(1, sampleRate),
    channels,
    mono,
    instrument,
  };
}

// ── Native FLAC Encoder (Verbatim / Fixed Predictor, RFC 9639) ───

function flacCrc8(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0;
  for (let i = start; i < end; i++) {
    crc ^= bytes[i];
    for (let b = 0; b < 8; b++) {
      crc = (crc & 0x80) !== 0 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc;
}

function flacCrc16(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0;
  for (let i = start; i < end; i++) {
    crc ^= bytes[i] << 8;
    for (let b = 0; b < 8; b++) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x8005) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

/**
 * Encodes Float32Array audio channels into a valid 16-bit lossless `.flac` (`fLaC`) ArrayBuffer,
 * optionally embedding a `VORBIS_COMMENT` metadata block with `ROOTKEY`, `LOOPSTART`, `LOOPEND`.
 */
export function encodeFlacPcm16(
  channels: Float32Array[],
  sampleRate = 44100,
  instrument?: Partial<AiffInstrumentInfo>
): ArrayBuffer {
  const numChannels = Math.max(1, Math.min(8, channels.length));
  const totalSamples = channels[0]?.length ?? 0;
  const blockSize = 4096;
  const numBlocks = Math.max(1, Math.ceil(totalSamples / blockSize));

  // Build optional VORBIS_COMMENT block
  const comments: string[] = [];
  if (instrument?.rootKey !== undefined) comments.push(`ROOTKEY=${instrument.rootKey}`);
  if (instrument?.loopStart !== undefined) comments.push(`LOOPSTART=${instrument.loopStart}`);
  if (instrument?.loopEnd !== undefined) comments.push(`LOOPEND=${instrument.loopEnd}`);

  const enc = new TextEncoder();
  const vendorBytes = enc.encode('ABDSynths UniversalAudioDecoder');
  const commentPayloads = comments.map((c) => enc.encode(c));
  const vorbisBlockLen =
    4 + vendorBytes.length + 4 + commentPayloads.reduce((acc, b) => acc + 4 + b.length, 0);

  // Estimate max buffer size: 42B header + vorbis + frames (verbatim 16-bit + 32B frame overhead)
  const maxBytes = 64 + vorbisBlockLen + numBlocks * (32 + blockSize * numChannels * 2);
  const out = new Uint8Array(maxBytes);
  const view = new DataView(out.buffer);

  // 'fLaC' magic
  out[0] = 0x66;
  out[1] = 0x4c;
  out[2] = 0x61;
  out[3] = 0x43;

  // STREAMINFO block (type 0, length 34)
  out[4] = comments.length === 0 ? 0x80 : 0x00;
  out[5] = 0;
  out[6] = 0;
  out[7] = 34;
  view.setUint16(8, blockSize, false);
  view.setUint16(10, blockSize, false);
  // min/max frame size = 0 (unknown)
  // 20-bit sampleRate, 3-bit channels-1, 5-bit bps-1 (15 for 16-bit), 36-bit totalSamples
  out[18] = (sampleRate >>> 12) & 0xff;
  out[19] = (sampleRate >>> 4) & 0xff;
  out[20] = ((sampleRate & 0x0f) << 4) | (((numChannels - 1) & 0x07) << 1);
  out[21] = (15 << 4) | 0; // bps-1 = 15, top 4 bits of totalSamples = 0
  view.setUint32(22, totalSamples >>> 0, false);

  let ptr = 42;
  if (comments.length > 0) {
    out[ptr] = 0x84; // isLast=1, type=4 (VORBIS_COMMENT)
    out[ptr + 1] = (vorbisBlockLen >>> 16) & 0xff;
    out[ptr + 2] = (vorbisBlockLen >>> 8) & 0xff;
    out[ptr + 3] = vorbisBlockLen & 0xff;
    ptr += 4;
    view.setUint32(ptr, vendorBytes.length, true);
    ptr += 4;
    out.set(vendorBytes, ptr);
    ptr += vendorBytes.length;
    view.setUint32(ptr, commentPayloads.length, true);
    ptr += 4;
    for (const cb of commentPayloads) {
      view.setUint32(ptr, cb.length, true);
      ptr += 4;
      out.set(cb, ptr);
      ptr += cb.length;
    }
  }

  // Write frames using SUBFRAME_VERBATIM (byte-aligned when wastedBits=0 and bps=16)
  // Wait: SUBFRAME header is 1 byte (0 | 000001 | 0 = 0x02), so verbatim 16-bit samples are byte-aligned!
  for (let blk = 0; blk < numBlocks; blk++) {
    const frameStart = ptr;
    const startSample = blk * blockSize;
    const curBlockSamples = Math.min(blockSize, Math.max(0, totalSamples - startSample));
    if (curBlockSamples === 0) break;

    // Sync code (14 bits = 0x3FFE) + reserved(0) + fixed-block(0) -> 0xFF 0xF8
    out[ptr++] = 0xff;
    out[ptr++] = 0xf8;
    // blockSizeCode = 7 (16-bit (blockSize-1) at end of header), sampleRateCode = 13 (16-bit Hz at end)
    out[ptr++] = 0x7d;
    // chanAssign = numChannels - 1, sampleSizeCode = 4 (16-bit), reserved = 0
    out[ptr++] = (((numChannels - 1) & 0x0f) << 4) | (4 << 1);

    // UTF-8 coded block number (blk)
    if (blk < 0x80) {
      out[ptr++] = blk;
    } else if (blk < 0x800) {
      out[ptr++] = 0xc0 | (blk >>> 6);
      out[ptr++] = 0x80 | (blk & 0x3f);
    } else {
      out[ptr++] = 0xe0 | (blk >>> 12);
      out[ptr++] = 0x80 | ((blk >>> 6) & 0x3f);
      out[ptr++] = 0x80 | (blk & 0x3f);
    }

    // 16-bit blockSize - 1
    view.setUint16(ptr, curBlockSamples - 1, false);
    ptr += 2;
    // 16-bit sampleRate Hz
    view.setUint16(ptr, Math.min(65535, sampleRate), false);
    ptr += 2;
    // CRC-8 of frame header
    out[ptr] = flacCrc8(out, frameStart, ptr);
    ptr++;

    // Subframes: header = 0b0_000001_0 = 0x02 (SUBFRAME_VERBATIM, no wasted bits)
    for (let ch = 0; ch < numChannels; ch++) {
      out[ptr++] = 0x02;
      const chData = channels[ch];
      for (let i = 0; i < curBlockSamples; i++) {
        const s = Math.max(-1.0, Math.min(1.0, chData[startSample + i] ?? 0));
        const i16 = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
        view.setInt16(ptr, i16, false);
        ptr += 2;
      }
    }

    // Frame CRC-16
    const crc16 = flacCrc16(out, frameStart, ptr);
    view.setUint16(ptr, crc16, false);
    ptr += 2;
  }

  return out.buffer.slice(0, ptr);
}

// ── Universal Async Audio Normalizer (Browser WebAudio + Pure-TS) ──

/**
 * Inspects and normalizes ANY supported audio buffer (`.wav`, `.aif`, `.aiff`, `.aifc`,
 * `.flac`, `.caf`, `.mp3`, `.ogg`, `.oga`, `.m4a`, `.aac`, `.opus`, `.webm`) into a
 * canonical RIFF/WAVE `ArrayBuffer` (preserving any embedded `inst`/`smpl` metadata)
 * so that all synchronous DSP, Slicer, and Sampler pipelines can process it cleanly.
 */
export async function transcodeAnyAudioToWavBuffer(
  buffer: ArrayBuffer,
  filename = ''
): Promise<ArrayBuffer> {
  if (buffer.byteLength < 12) {
    return buffer;
  }
  const view = new DataView(buffer);
  const magic = readFourCC(view, 0);

  // 1. If already a standard PCM/Float RIFF/WAVE, check if decodeWav succeeds directly
  if (magic === 'RIFF' || magic === 'RF64') {
    const wave = readFourCC(view, 8);
    if (wave === 'WAVE') {
      try {
        const dec = decodeWav(buffer);
        // If it was compressed WAV (ulaw/alaw/adpcm), re-encode to canonical PCM16 WAV
        if (dec.formatTag !== 'pcm' && dec.formatTag !== 'ieee-float') {
          return encodeWavPcm16(dec.channels, dec.sampleRate, dec.instrument);
        }
        return buffer;
      } catch {
        // Fall through to WebAudio decodeAudioData for exotic WAV codecs (e.g. MP3-in-WAV)
      }
    }
  }

  // 2. If FORM/AIFF, FORM/AIFC, fLaC, or caff (.caf), try pure-TS decoding first
  if (magic === 'FORM' || magic === 'fLaC' || magic === 'caff') {
    try {
      const dec =
        magic === 'fLaC'
          ? decodeFlac(buffer)
          : magic === 'caff'
            ? decodeCaf(buffer)
            : decodeWav(buffer);
      // For AIFF/AIFC, WebAudioPipeline natively supports FORM/AIFF uncompressed PCM,
      // but re-encoding FLAC/CAF/AIFC to canonical PCM16 WAV with `inst` metadata
      // guarantees 100% compatibility across every sampler exporter and worker.
      return encodeWavPcm16(dec.channels, dec.sampleRate, dec.instrument);
    } catch {
      // Fall through to WebAudio API if compressed (e.g. AAC/ALAC inside CAF)
    }
  }

  // 3. Browser WebAudio API (`OfflineAudioContext` / `AudioContext.decodeAudioData`)
  // Handles MP3 (.mp3), OGG Vorbis (.ogg/.oga), AAC/M4A (.m4a/.aac), Opus (.opus/.webm), FLAC, etc.
  const g = globalThis as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
    OfflineAudioContext?: typeof OfflineAudioContext;
  };
  const OfflineCtx = g.OfflineAudioContext;
  const AudioCtx = g.AudioContext ?? g.webkitAudioContext;

  if (OfflineCtx || AudioCtx) {
    try {
      const ctx = OfflineCtx ? new OfflineCtx(1, 1, 44100) : new AudioCtx!();
      try {
        const audioBuf = await ctx.decodeAudioData(buffer.slice(0));
        const channels: Float32Array[] = [];
        for (let ch = 0; ch < audioBuf.numberOfChannels; ch++) {
          channels.push(new Float32Array(audioBuf.getChannelData(ch)));
        }
        return encodeWavPcm16(channels, audioBuf.sampleRate);
      } finally {
        if ('close' in ctx && typeof ctx.close === 'function') {
          void ctx.close().catch(() => {});
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Unable to decode audio file "${filename || 'buffer'}": ${msg}`);
    }
  }

  throw new Error(
    `Unsupported or compressed audio format ('${magic}') for "${filename}" in non-browser environment.`
  );
}
