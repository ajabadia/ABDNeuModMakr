// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Pure TypeScript RIFF/WAVE & FORM/AIFF Decoder
//
// Supports:
//   - RIFF/WAVE: PCM 8-bit (unsigned), 16/24/32-bit (signed), IEEE Float 32/64-bit,
//     WAVE_FORMAT_EXTENSIBLE (0xFFFE), arbitrary RIFF chunks (JUNK, LIST, smpl, etc.)
//   - FORM/AIFF (native Hartmann MODELmaker v1.2 NASAnalysis.dll input format):
//     COMM (with 80-bit IEEE 754 extended float sample rate), SSND (big-endian PCM),
//     INST (rootKey, lowKey, highKey, detune, gain) and MARK chunks
//   - Mono, Stereo, and multi-channel with automatic mono downmix ((L+R)*0.5)
// ─────────────────────────────────────────────────────────

export type WavFormatTag = 'pcm' | 'ieee-float' | 'aiff-pcm';

export interface AiffInstrumentInfo {
  rootKey: number;
  detune: number;
  lowKey: number;
  highKey: number;
  lowVelocity: number;
  highVelocity: number;
  gainDb: number;
}

export interface DecodedWav {
  sampleRate: number;
  numChannels: number;
  bitsPerSample: number;
  formatTag: WavFormatTag;
  numSamples: number;
  durationSec: number;
  /** Per-channel audio buffers in [-1.0, +1.0] */
  channels: Float32Array[];
  /** Downmixed mono buffer ((L + R) * 0.5 for stereo, matching C++ SpectralAnalyzer) */
  mono: Float32Array;
  /** Optional AIFF INST metadata (when decoded from .aif / .aiff) */
  instrument?: AiffInstrumentInfo;
}

const WAVE_FORMAT_PCM = 0x0001;
const WAVE_FORMAT_IEEE_FLOAT = 0x0003;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

function readFourCC(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3)
  );
}

/**
 * Decodes an 80-bit IEEE 754 extended precision float (big-endian, as used in AIFF COMM chunk).
 */
export function readIeee80BigEndian(view: DataView, offset: number): number {
  const expon = view.getUint16(offset, false);
  const hi = view.getUint32(offset + 2, false);
  const lo = view.getUint32(offset + 6, false);

  const sign = (expon & 0x8000) !== 0 ? -1 : 1;
  const exp = expon & 0x7fff;

  if (exp === 0 && hi === 0 && lo === 0) return 0.0;
  if (exp === 0x7fff) return sign * Infinity;

  const mantissa = hi * Math.pow(2, -31) + lo * Math.pow(2, -63);
  return sign * mantissa * Math.pow(2, exp - 16383);
}

/**
 * Decodes a FORM/AIFF buffer (the native format required by MODELmaker v1.2 NASAnalysis.dll).
 */
export function decodeAiff(buffer: ArrayBuffer): DecodedWav {
  const view = new DataView(buffer);
  const form = readFourCC(view, 0);
  const aiff = readFourCC(view, 8);
  if (form !== 'FORM' || (aiff !== 'AIFF' && aiff !== 'AIFC')) {
    throw new Error(`Invalid AIFF: expected FORM/AIFF header, found ${form}/${aiff}`);
  }

  let offset = 12;
  let numChannels = 0;
  let numSampleFrames = 0;
  let bitsPerSample = 0;
  let sampleRate = 0;
  let ssndDataStart = -1;
  let ssndDataBytes = 0;
  let instrument: AiffInstrumentInfo | undefined;

  while (offset + 8 <= buffer.byteLength) {
    const chunkId = readFourCC(view, offset);
    const chunkSize = view.getUint32(offset + 4, false); // Big-endian in AIFF
    const chunkDataStart = offset + 8;

    if (chunkId === 'COMM') {
      if (chunkSize < 18 || chunkDataStart + 18 > buffer.byteLength) {
        throw new Error('Invalid AIFF: truncated COMM chunk');
      }
      numChannels = view.getUint16(chunkDataStart, false);
      numSampleFrames = view.getUint32(chunkDataStart + 2, false);
      bitsPerSample = view.getUint16(chunkDataStart + 6, false);
      sampleRate = Math.round(readIeee80BigEndian(view, chunkDataStart + 8));
    } else if (chunkId === 'SSND') {
      if (chunkSize < 8 || chunkDataStart + 8 > buffer.byteLength) {
        throw new Error('Invalid AIFF: truncated SSND chunk');
      }
      const dataOffset = view.getUint32(chunkDataStart, false);
      // blockSize at chunkDataStart + 4
      ssndDataStart = chunkDataStart + 8 + dataOffset;
      ssndDataBytes = Math.min(
        chunkSize - 8 - dataOffset,
        buffer.byteLength - ssndDataStart
      );
    } else if (chunkId === 'INST' && chunkSize >= 8 && chunkDataStart + 8 <= buffer.byteLength) {
      instrument = {
        rootKey: view.getUint8(chunkDataStart),
        detune: view.getInt8(chunkDataStart + 1),
        lowKey: view.getUint8(chunkDataStart + 2),
        highKey: view.getUint8(chunkDataStart + 3),
        lowVelocity: view.getUint8(chunkDataStart + 4),
        highVelocity: view.getUint8(chunkDataStart + 5),
        gainDb: view.getInt16(chunkDataStart + 6, false),
      };
    }

    const paddedSize = chunkSize + (chunkSize & 1);
    offset = chunkDataStart + paddedSize;
  }

  if (numChannels < 1 || numChannels > 32) {
    throw new Error(`Invalid AIFF: unsupported channel count (${numChannels})`);
  }
  if (sampleRate < 4000 || sampleRate > 384000) {
    throw new Error(`Invalid AIFF: unsupported sample rate (${sampleRate} Hz)`);
  }
  if (
    bitsPerSample !== 8 &&
    bitsPerSample !== 16 &&
    bitsPerSample !== 24 &&
    bitsPerSample !== 32
  ) {
    throw new Error(`Invalid AIFF: unsupported bit depth (${bitsPerSample}-bit)`);
  }
  if (ssndDataStart < 0 || ssndDataBytes <= 0) {
    throw new Error('Invalid AIFF: missing or empty SSND chunk');
  }

  const bytesPerSample = bitsPerSample >>> 3;
  const frameStride = numChannels * bytesPerSample;
  const availableFrames = Math.floor(ssndDataBytes / frameStride);
  const numSamples =
    numSampleFrames > 0 ? Math.min(numSampleFrames, availableFrames) : availableFrames;

  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(new Float32Array(numSamples));
  }

  let ptr = ssndDataStart;
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      let val = 0;
      if (bitsPerSample === 8) {
        // AIFF 8-bit is signed (-128..127)
        val = view.getInt8(ptr) / 128.0;
      } else if (bitsPerSample === 16) {
        val = view.getInt16(ptr, false) / 32768.0;
      } else if (bitsPerSample === 24) {
        const b0 = view.getUint8(ptr);
        const b1 = view.getUint8(ptr + 1);
        const b2 = view.getUint8(ptr + 2);
        const int24 = ((b0 << 24) | (b1 << 16) | (b2 << 8)) >> 8;
        val = int24 / 8388608.0;
      } else {
        val = view.getInt32(ptr, false) / 2147483648.0;
      }
      channels[ch][i] = val;
      ptr += bytesPerSample;
    }
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
    bitsPerSample,
    formatTag: 'aiff-pcm',
    numSamples,
    durationSec: numSamples / sampleRate,
    channels,
    mono,
    instrument,
  };
}

/**
 * Decodes a binary RIFF/WAVE or FORM/AIFF ArrayBuffer into normalized Float32Array channels + mono mix.
 */
export function decodeWav(buffer: ArrayBuffer): DecodedWav {
  if (buffer.byteLength < 44) {
    throw new Error(`Invalid audio buffer: too small (${buffer.byteLength} bytes)`);
  }

  const view = new DataView(buffer);
  const magic = readFourCC(view, 0);
  if (magic === 'FORM') {
    return decodeAiff(buffer);
  }
  if (magic !== 'RIFF' && magic !== 'RF64') {
    throw new Error(`Invalid WAV: expected 'RIFF' or 'FORM' header, found '${magic}'`);
  }

  const wave = readFourCC(view, 8);
  if (wave !== 'WAVE') {
    throw new Error(`Invalid WAV: expected 'WAVE' signature, found '${wave}'`);
  }

  let offset = 12;
  let audioFormat = 0;
  let numChannels = 0;
  let sampleRate = 0;
  let blockAlign = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataSize = 0;
  let instrument: AiffInstrumentInfo | undefined;

  while (offset + 8 <= buffer.byteLength) {
    const chunkId = readFourCC(view, offset);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkDataStart = offset + 8;

    if (chunkId === 'fmt ') {
      if (chunkSize < 16 || chunkDataStart + 16 > buffer.byteLength) {
        throw new Error('Invalid WAV: truncated fmt chunk');
      }
      audioFormat = view.getUint16(chunkDataStart, true);
      numChannels = view.getUint16(chunkDataStart + 2, true);
      sampleRate = view.getUint32(chunkDataStart + 4, true);
      blockAlign = view.getUint16(chunkDataStart + 12, true);
      bitsPerSample = view.getUint16(chunkDataStart + 14, true);

      if (audioFormat === WAVE_FORMAT_EXTENSIBLE) {
        if (chunkSize >= 40 && chunkDataStart + 26 <= buffer.byteLength) {
          const validBits = view.getUint16(chunkDataStart + 18, true);
          if (validBits > 0) {
            bitsPerSample = validBits;
          }
          audioFormat = view.getUint16(chunkDataStart + 24, true);
        }
      }
    } else if (chunkId === 'data') {
      dataOffset = chunkDataStart;
      dataSize = Math.min(chunkSize, buffer.byteLength - chunkDataStart);
    } else if (
      chunkId === 'inst' &&
      chunkSize >= 7 &&
      chunkDataStart + 7 <= buffer.byteLength
    ) {
      instrument = {
        rootKey: view.getUint8(chunkDataStart),
        detune: view.getInt8(chunkDataStart + 1),
        gainDb: view.getInt8(chunkDataStart + 2),
        lowKey: view.getUint8(chunkDataStart + 3),
        highKey: view.getUint8(chunkDataStart + 4),
        lowVelocity: view.getUint8(chunkDataStart + 5),
        highVelocity: view.getUint8(chunkDataStart + 6),
      };
    } else if (
      chunkId === 'smpl' &&
      chunkSize >= 36 &&
      chunkDataStart + 36 <= buffer.byteLength &&
      !instrument
    ) {
      const midiUnityNote = view.getUint32(chunkDataStart + 12, true);
      const pitchFraction = view.getUint32(chunkDataStart + 16, true);
      const cents = Math.round((pitchFraction / 4294967296.0) * 100);
      instrument = {
        rootKey: Math.max(0, Math.min(127, midiUnityNote)),
        detune: cents,
        lowKey: 0,
        highKey: 127,
        lowVelocity: 1,
        highVelocity: 127,
        gainDb: 0,
      };
    }

    const paddedSize = chunkSize + (chunkSize & 1);
    offset = chunkDataStart + paddedSize;
  }

  if (numChannels < 1 || numChannels > 32) {
    throw new Error(`Invalid WAV: unsupported channel count (${numChannels})`);
  }
  if (sampleRate < 4000 || sampleRate > 384000) {
    throw new Error(`Invalid WAV: unsupported sample rate (${sampleRate} Hz)`);
  }
  if (dataOffset < 0 || dataSize <= 0) {
    throw new Error('Invalid WAV: missing or empty data chunk');
  }

  let formatTag: WavFormatTag;
  if (audioFormat === WAVE_FORMAT_PCM) {
    if (
      bitsPerSample !== 8 &&
      bitsPerSample !== 16 &&
      bitsPerSample !== 24 &&
      bitsPerSample !== 32
    ) {
      throw new Error(`Invalid WAV: unsupported PCM bit depth (${bitsPerSample}-bit)`);
    }
    formatTag = 'pcm';
  } else if (audioFormat === WAVE_FORMAT_IEEE_FLOAT) {
    if (bitsPerSample !== 32 && bitsPerSample !== 64) {
      throw new Error(`Invalid WAV: unsupported IEEE Float bit depth (${bitsPerSample}-bit)`);
    }
    formatTag = 'ieee-float';
  } else {
    throw new Error(`Invalid WAV: unsupported audio format tag (0x${audioFormat.toString(16)})`);
  }

  const bytesPerSample = bitsPerSample >>> 3;
  const effectiveBlockAlign =
    blockAlign >= numChannels * bytesPerSample
      ? blockAlign
      : numChannels * bytesPerSample;
  const numSamples = Math.floor(dataSize / effectiveBlockAlign);

  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(new Float32Array(numSamples));
  }

  let framePtr = dataOffset;
  for (let i = 0; i < numSamples; i++) {
    let samplePtr = framePtr;
    for (let ch = 0; ch < numChannels; ch++) {
      let val = 0;
      if (formatTag === 'pcm') {
        if (bitsPerSample === 8) {
          val = (view.getUint8(samplePtr) - 128) / 128.0;
        } else if (bitsPerSample === 16) {
          val = view.getInt16(samplePtr, true) / 32768.0;
        } else if (bitsPerSample === 24) {
          const b0 = view.getUint8(samplePtr);
          const b1 = view.getUint8(samplePtr + 1);
          const b2 = view.getUint8(samplePtr + 2);
          const int24 = ((b2 << 24) | (b1 << 16) | (b0 << 8)) >> 8;
          val = int24 / 8388608.0;
        } else {
          val = view.getInt32(samplePtr, true) / 2147483648.0;
        }
      } else {
        if (bitsPerSample === 32) {
          val = view.getFloat32(samplePtr, true);
        } else {
          val = view.getFloat64(samplePtr, true);
        }
      }
      if (!Number.isFinite(val)) val = 0;
      channels[ch][i] = val;
      samplePtr += bytesPerSample;
    }
    framePtr += effectiveBlockAlign;
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
    bitsPerSample,
    formatTag,
    numSamples,
    durationSec: numSamples / sampleRate,
    channels,
    mono,
    instrument,
  };
}

/**
 * Encodes a mono or stereo Float32Array into a valid 16-bit PCM RIFF/WAVE ArrayBuffer,
 * optionally appending a RIFF `inst` chunk with rootKey / key range / velocity range / detune.
 */
export function encodeWavPcm16(
  channels: Float32Array[],
  sampleRate = 44100,
  instrument?: Partial<AiffInstrumentInfo>
): ArrayBuffer {
  const numChannels = Math.max(1, channels.length);
  const numSamples = channels[0]?.length ?? 0;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const instChunkBytes = instrument ? 16 : 0; // 'inst' (4) + size=7 (4) + 7 bytes + 1 pad byte
  const buffer = new ArrayBuffer(44 + dataSize + instChunkBytes);
  const view = new DataView(buffer);

  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) {
      view.setUint8(off + i, s.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize + instChunkBytes, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, WAVE_FORMAT_PCM, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let ptr = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const clamped = Math.max(-1.0, Math.min(1.0, channels[ch][i] ?? 0));
      const int16 =
        clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
      view.setInt16(ptr, int16, true);
      ptr += 2;
    }
  }

  if (instrument) {
    writeStr(ptr, 'inst');
    view.setUint32(ptr + 4, 7, true);
    view.setUint8(ptr + 8, Math.max(0, Math.min(127, instrument.rootKey ?? 60)));
    view.setInt8(ptr + 9, Math.max(-50, Math.min(50, instrument.detune ?? 0)));
    view.setInt8(ptr + 10, Math.max(-64, Math.min(64, instrument.gainDb ?? 0)));
    view.setUint8(ptr + 11, Math.max(0, Math.min(127, instrument.lowKey ?? 0)));
    view.setUint8(ptr + 12, Math.max(0, Math.min(127, instrument.highKey ?? 127)));
    view.setUint8(ptr + 13, Math.max(1, Math.min(127, instrument.lowVelocity ?? 1)));
    view.setUint8(ptr + 14, Math.max(1, Math.min(127, instrument.highVelocity ?? 127)));
    view.setUint8(ptr + 15, 0); // pad byte
  }

  return buffer;
}

/**
 * Convenience wrapper that encodes a single mono `Float32Array` into a 16-bit PCM WAV buffer.
 */
export function encodePcm16Wav(
  mono: Float32Array,
  sampleRate = 44100,
  instrument?: Partial<AiffInstrumentInfo>
): ArrayBuffer {
  return encodeWavPcm16([mono], sampleRate, instrument);
}

/**
 * Writes an 80-bit IEEE 754 extended precision float (big-endian) at `offset` in `view`.
 */
export function writeIeee80BigEndian(view: DataView, offset: number, value: number): void {
  if (value === 0 || !Number.isFinite(value)) {
    for (let i = 0; i < 10; i++) view.setUint8(offset + i, 0);
    return;
  }
  const sign = value < 0 ? 0x8000 : 0;
  let absVal = Math.abs(value);
  const exp = Math.floor(Math.log2(absVal));
  const normalized = absVal / Math.pow(2, exp); // in [1.0, 2.0)
  const biasedExp = (exp + 16383) & 0x7fff;
  const scaled = normalized * Math.pow(2, 31);
  const hi = Math.floor(scaled) >>> 0;
  const lo = Math.floor((scaled - hi) * Math.pow(2, 32)) >>> 0;

  view.setUint16(offset, sign | biasedExp, false);
  view.setUint32(offset + 2, hi, false);
  view.setUint32(offset + 6, lo, false);
}

/**
 * Resamples a single-channel Float32Array from `srcRate` to `dstRate` using a
 * windowed-sinc (Blackman) anti-aliased filter so 96kHz/48kHz samples convert cleanly to 44.1kHz.
 */
export function resampleAudioChannel(
  input: Float32Array,
  srcRate: number,
  dstRate = 44100
): Float32Array {
  if (srcRate === dstRate || input.length === 0) {
    return new Float32Array(input);
  }
  const ratio = srcRate / dstRate;
  const outLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outLength);
  const cutoff = Math.min(1.0, dstRate / srcRate);
  const halfWin = 12;

  for (let i = 0; i < outLength; i++) {
    const srcPos = i * ratio;
    const center = Math.floor(srcPos);
    let acc = 0.0;
    let weightSum = 0.0;

    for (let k = -halfWin; k <= halfWin; k++) {
      const idx = center + k;
      if (idx < 0 || idx >= input.length) continue;
      const x = srcPos - idx;
      const sincX = x * cutoff;
      const sinc =
        Math.abs(sincX) < 1e-7
          ? cutoff
          : (Math.sin(Math.PI * sincX) / (Math.PI * x));
      const winPhase = (x / halfWin + 1.0) * 0.5;
      const win =
        winPhase <= 0 || winPhase >= 1
          ? 0
          : 0.42 - 0.5 * Math.cos(2 * Math.PI * winPhase) + 0.08 * Math.cos(4 * Math.PI * winPhase);
      const w = sinc * win;
      acc += input[idx] * w;
      weightSum += w;
    }
    output[i] = weightSum > 1e-8 ? acc / weightSum : input[Math.min(input.length - 1, center)];
  }
  return output;
}

/**
 * Encodes a mono (or multi-channel) Float32Array into a canonical FORM/AIFF 16-bit Big-Endian PCM
 * buffer compatible with Hartmann MODELmaker v1.2 (`NASAnalysis.dll` `validateSample`), including:
 *   - `COMM` chunk (18 bytes, IEEE-80 big-endian sampleRate)
 *   - `INST` chunk (20 bytes, rootKey, detune, lowKey, highKey, lowVelocity, highVelocity, gainDb, sustain/release loops = 0)
 *   - `SSND` chunk (8-byte offset/blockSize header + 16-bit big-endian signed PCM)
 */
export function encodeAiffPcm16(
  channels: Float32Array[],
  sampleRate = 44100,
  instrument?: Partial<AiffInstrumentInfo>
): ArrayBuffer {
  const numChannels = Math.max(1, channels.length);
  const numSampleFrames = channels[0]?.length ?? 0;
  const bytesPerSample = 2;
  const pcmDataBytes = numSampleFrames * numChannels * bytesPerSample;
  const paddedPcmBytes = pcmDataBytes + (pcmDataBytes & 1);

  // Chunk sizes:
  // FORM header: 12 bytes ('FORM' + size + 'AIFF')
  // COMM chunk: 8 + 18 = 26 bytes
  // INST chunk: 8 + 20 = 28 bytes (optional or always included when instrument is passed)
  // SSND chunk: 8 + 8 + paddedPcmBytes = 16 + paddedPcmBytes
  const hasInst = instrument !== undefined;
  const instTotalBytes = hasInst ? 28 : 0;
  const totalBytes = 12 + 26 + instTotalBytes + 16 + paddedPcmBytes;

  const buffer = new ArrayBuffer(totalBytes);
  const view = new DataView(buffer);

  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) {
      view.setUint8(off + i, s.charCodeAt(i));
    }
  };

  // 1. FORM / AIFF header
  writeStr(0, 'FORM');
  view.setUint32(4, totalBytes - 8, false);
  writeStr(8, 'AIFF');

  // 2. COMM chunk (offset 12, size 18)
  let ptr = 12;
  writeStr(ptr, 'COMM');
  view.setUint32(ptr + 4, 18, false);
  view.setUint16(ptr + 8, numChannels, false);
  view.setUint32(ptr + 10, numSampleFrames, false);
  view.setUint16(ptr + 14, 16, false); // 16-bit PCM
  writeIeee80BigEndian(view, ptr + 16, sampleRate);
  ptr += 26;

  // 3. INST chunk (20 bytes payload)
  if (hasInst) {
    writeStr(ptr, 'INST');
    view.setUint32(ptr + 4, 20, false);
    view.setUint8(ptr + 8, Math.max(0, Math.min(127, instrument?.rootKey ?? 60)));
    view.setInt8(ptr + 9, Math.max(-50, Math.min(50, instrument?.detune ?? 0)));
    view.setUint8(ptr + 10, Math.max(0, Math.min(127, instrument?.lowKey ?? 0)));
    view.setUint8(ptr + 11, Math.max(0, Math.min(127, instrument?.highKey ?? 127)));
    view.setUint8(ptr + 12, Math.max(1, Math.min(127, instrument?.lowVelocity ?? 1)));
    view.setUint8(ptr + 13, Math.max(1, Math.min(127, instrument?.highVelocity ?? 127)));
    view.setInt16(ptr + 14, Math.max(-32, Math.min(12, Math.round(instrument?.gainDb ?? 0))), false);
    // sustainLoop (playMode=0, beginLoop=0, endLoop=0) + releaseLoop (playMode=0, beginLoop=0, endLoop=0)
    for (let i = 0; i < 12; i++) {
      view.setUint8(ptr + 16 + i, 0);
    }
    ptr += 28;
  }

  // 4. SSND chunk
  writeStr(ptr, 'SSND');
  view.setUint32(ptr + 4, 8 + pcmDataBytes, false);
  view.setUint32(ptr + 8, 0, false); // offset = 0
  view.setUint32(ptr + 12, 0, false); // blockSize = 0
  ptr += 16;

  for (let i = 0; i < numSampleFrames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const clamped = Math.max(-1.0, Math.min(1.0, channels[ch][i] ?? 0));
      const int16 =
        clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
      view.setInt16(ptr, int16, false); // Big-endian signed 16-bit
      ptr += 2;
    }
  }

  return buffer;
}

/**
 * Converts a MIDI note number (0..127) to frequency in Hz (A4 = 440 Hz).
 */
export function midiNoteToHz(note: number): number {
  return 440.0 * Math.pow(2.0, (note - 69.0) / 12.0);
}

/**
 * Synthesizes an acoustic-like multi-partial WAV buffer in memory for a given timbre
 * and root MIDI note so that default/demo zones pass through the real WAV decoder +
 * FFT + harmonic peak-picker pipeline.
 */
export function synthesizeDemoWav(
  timbre: 'bass' | 'piano' | 'strings' | 'pad' | 'bell',
  rootKey: number,
  sampleRate = 44100,
  durationSec = 1.2
): ArrayBuffer {
  const f0 = midiNoteToHz(rootKey);
  const numSamples = Math.floor(sampleRate * durationSec);
  const left = new Float32Array(numSamples);
  const right = new Float32Array(numSamples);
  const nyquist = sampleRate * 0.48;

  const maxPartials = 32;
  const inharmB =
    timbre === 'bell' ? 0.00035 :
    timbre === 'piano' ? 0.000015 : 0.0;

  for (let k = 1; k <= maxPartials; k++) {
    const fk = k * f0 * Math.sqrt(1.0 + inharmB * k * k);
    if (fk >= nyquist) break;

    let baseAmp =
      1.0 /
      Math.pow(k, timbre === 'bass' ? 1.35 : timbre === 'pad' ? 1.15 : 1.05);
    if (timbre === 'bell' && k % 2 === 0) {
      baseAmp *= 0.45;
    } else if (timbre === 'strings' && k % 3 === 0) {
      baseAmp *= 0.75;
    }

    const decayRate =
      timbre === 'piano' ? 1.8 + k * 0.22 :
      timbre === 'bell' ? 1.2 + k * 0.35 :
      timbre === 'bass' ? 1.4 + k * 0.18 :
      0.35 + k * 0.04;

    const isSecondLayer = timbre === 'pad' && k >= 6 && k % 2 === 1;
    const omega = (2.0 * Math.PI * fk) / sampleRate;
    const stereoPhaseOffset = (k % 2 === 0 ? 1 : -1) * 0.08;

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      let env: number;
      if (isSecondLayer) {
        const swell = Math.sin(Math.min(1.0, t / durationSec) * Math.PI);
        env = swell * swell;
      } else {
        const attack = Math.min(1.0, t / 0.015);
        env = attack * Math.exp(-decayRate * t);
      }

      const phase = omega * i;
      left[i] += baseAmp * env * Math.sin(phase);
      right[i] += baseAmp * env * Math.sin(phase + stereoPhaseOffset);
    }
  }

  let peak = 0;
  for (let i = 0; i < numSamples; i++) {
    const m = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    if (m > peak) peak = m;
  }
  if (peak > 1e-6) {
    const scale = 0.891 / peak;
    for (let i = 0; i < numSamples; i++) {
      left[i] *= scale;
      right[i] *= scale;
    }
  }

  return encodeWavPcm16([left, right], sampleRate);
}
