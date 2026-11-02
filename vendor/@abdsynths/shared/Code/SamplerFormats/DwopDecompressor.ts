// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Pure TypeScript REX2 / DWOP Audio Decompressor
// 100% Client-Side In-Browser Decompression (Zero-Backend, Vercel-Ready)
//
// Clean-room implementation based on chirashi (MIT) and Paketti (MIT).
// ─────────────────────────────────────────────────────────

import { encodeWavPcm16 } from '../NeuronFormats/index.ts';

class BitReader {
  private readonly data: Uint32Array;
  private pos = 0;
  private current = 0;
  private bitsLeft = 0;
  public eof = false;

  constructor(buffer: ArrayBuffer, offset: number, length: number) {
    const words = Math.floor(length / 4);
    this.data = new Uint32Array(words);
    const view = new DataView(buffer, offset, words * 4);
    for (let i = 0; i < words; i++) {
      this.data[i] = view.getUint32(i * 4, false); // big-endian uint32
    }
  }

  public readBit(): boolean {
    this.bitsLeft--;
    if (this.bitsLeft < 0) {
      if (this.pos >= this.data.length) {
        this.eof = true;
        return false;
      }
      this.current = this.data[this.pos++];
      this.bitsLeft = 31;
    }
    const bit = (this.current & 0x80000000) !== 0;
    this.current = (this.current << 1) >>> 0;
    return bit;
  }

  public readBits(n: number): number {
    if (n <= 0 || n > 31) {
      this.eof = true;
      return 0;
    }
    let result = (this.current >>> (32 - n)) >>> 0;
    this.current = (this.current << n) >>> 0;
    const blBefore = this.bitsLeft;
    this.bitsLeft -= n;
    if (blBefore - n < 0) {
      if (this.pos >= this.data.length) {
        this.eof = true;
        return result;
      }
      const nextWord = this.data[this.pos++];
      this.bitsLeft += 32;
      result = (result | ((nextWord >>> this.bitsLeft) >>> 0)) >>> 0;
      this.current = (nextWord << (32 - this.bitsLeft)) >>> 0;
    }
    return result >>> 0;
  }
}

function mag(v: number): number {
  const v32 = v >>> 0;
  const sign = (v32 >>> 31) & 1;
  return sign ? ((~v32) >>> 0) : v32;
}

function applyPredictor(idx: number, s2x: number, deltas: Int32Array): number {
  const d0 = deltas[0];
  const d1 = deltas[1];
  const d2 = deltas[2];
  const d3 = deltas[3];

  if (idx === 0) {
    const t0 = (s2x - d0) | 0;
    const t1 = (t0 - d1) | 0;
    const t2 = (t1 - d2) | 0;
    deltas[4] = (t2 - d3) | 0;
    deltas[3] = t2;
    deltas[2] = t1;
    deltas[1] = t0;
    deltas[0] = s2x;
    return s2x;
  } else if (idx === 1) {
    const t1 = (s2x - d1) | 0;
    const t2 = (t1 - d2) | 0;
    const nd0 = (d0 + s2x) | 0;
    deltas[4] = (t2 - d3) | 0;
    deltas[3] = t2;
    deltas[2] = t1;
    deltas[1] = s2x;
    deltas[0] = nd0;
    return nd0;
  } else if (idx === 2) {
    const nd1 = (d1 + s2x) | 0;
    const nd0 = (d0 + nd1) | 0;
    const t = (s2x - d2) | 0;
    deltas[4] = (t - d3) | 0;
    deltas[3] = t;
    deltas[2] = s2x;
    deltas[1] = nd1;
    deltas[0] = nd0;
    return nd0;
  } else if (idx === 3) {
    const nd2 = (d2 + s2x) | 0;
    const nd1 = (d1 + nd2) | 0;
    const nd0 = (d0 + nd1) | 0;
    deltas[4] = (s2x - d3) | 0;
    deltas[3] = s2x;
    deltas[2] = nd2;
    deltas[1] = nd1;
    deltas[0] = nd0;
    return nd0;
  } else if (idx === 4) {
    const nd3 = (d3 + s2x) | 0;
    const nd2 = (d2 + nd3) | 0;
    const nd1 = (d1 + nd2) | 0;
    const nd0 = (d0 + nd1) | 0;
    deltas[4] = s2x;
    deltas[3] = nd3;
    deltas[2] = nd2;
    deltas[1] = nd1;
    deltas[0] = nd0;
    return nd0;
  }
  return d0;
}

function updateAverages(averages: Uint32Array, deltas: Int32Array): void {
  for (let i = 0; i < 5; i++) {
    averages[i] = ((averages[i] + mag(deltas[i]) - (averages[i] >>> 5)) >>> 0);
  }
}

class DwopDecompressor {
  private readonly br: BitReader;
  private readonly deltas: [Int32Array, Int32Array];
  private readonly averages: [Uint32Array, Uint32Array];
  private readonly j: [number, number];
  private readonly rbits: [number, number];

  constructor(buffer: ArrayBuffer, offset: number, length: number) {
    this.br = new BitReader(buffer, offset, length);
    this.deltas = [new Int32Array(5), new Int32Array(5)];
    this.averages = [
      new Uint32Array([2560, 2560, 2560, 2560, 2560]),
      new Uint32Array([2560, 2560, 2560, 2560, 2560]),
    ];
    this.j = [2, 2];
    this.rbits = [0, 0];
  }

  private adjustJAndRbits(c: number, step: number): void {
    let jVal = this.j[c];
    let rbitsVal = this.rbits[c];

    if (step < jVal) {
      let jt = jVal >>> 1;
      while (step < jt) {
        jVal = jt;
        rbitsVal--;
        jt >>>= 1;
      }
    } else {
      while (step >= jVal) {
        const prev = jVal;
        jVal = (jVal << 1) >>> 0;
        rbitsVal++;
        if (jVal <= prev) {
          jVal = prev;
          break;
        }
      }
    }
    this.j[c] = jVal;
    this.rbits[c] = rbitsVal;
  }

  public decodeFrame(c: number): { sample2x: number; ok: boolean } {
    const avg = this.averages[c];
    let minAvg = avg[0];
    let minIdx = 0;
    for (let i = 1; i < 5; i++) {
      if (avg[i] < minAvg) {
        minAvg = avg[i];
        minIdx = i;
      }
    }

    let step = (((minAvg * 3) + 36) >>> 7);
    let prefixSum = 0;
    let zerosWin = 7;

    while (true) {
      const bit = this.br.readBit();
      if (this.br.eof) return { sample2x: 0, ok: false };
      if (bit) break;
      if (step > 0 && prefixSum > 0xffffffff - step) {
        this.br.eof = true;
        return { sample2x: 0, ok: false };
      }
      prefixSum = (prefixSum + step) >>> 0;
      zerosWin--;
      if (zerosWin === 0) {
        step = (step << 2) >>> 0;
        zerosWin = 7;
      }
    }

    if (this.br.eof) return { sample2x: 0, ok: false };

    this.adjustJAndRbits(c, step);

    let rem = 0;
    if (this.rbits[c] > 0) {
      rem = this.br.readBits(this.rbits[c]);
      if (this.br.eof) return { sample2x: 0, ok: false };
    }

    const thresh = (this.j[c] - step) >>> 0;
    if (rem >= thresh) {
      const extra = this.br.readBits(1);
      if (this.br.eof) return { sample2x: 0, ok: false };
      rem = (((rem * 2) - thresh + extra) >>> 0);
    }

    const codeVal = (rem + prefixSum) >>> 0;
    const signed2x = ((-(codeVal & 1)) ^ codeVal) | 0;
    const s2x = applyPredictor(minIdx, signed2x, this.deltas[c]);
    updateAverages(this.averages[c], this.deltas[c]);
    return { sample2x: s2x, ok: true };
  }
}

export interface Rx2SliceInfo {
  start: number;
  length: number;
  flags: number;
}

export interface Rx2DecompressResult {
  channels: Float32Array[];
  sampleRate: number;
  bitDepth: number;
  totalFrames: number;
  loopStart: number;
  loopEnd: number;
  slices: Rx2SliceInfo[];
  sliceFrames: number[];
  wavBuffer: ArrayBuffer;
}

/**
 * Checks whether an ArrayBuffer is a valid ReCycle 2.0 (.rx2) container.
 */
export function isRx2Buffer(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 12) return false;
  const view = new DataView(buffer);
  const tagCat = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  const tagRex = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
  return tagCat === 'CAT ' && tagRex === 'REX2';
}

/**
 * Decompresses a Reason Studios ReCycle 2.0 (.rx2) file in pure TypeScript.
 * Runs 100% client-side in the browser, without server or Python dependencies.
 */
export function decompressRx2Audio(buffer: ArrayBuffer): Rx2DecompressResult {
  if (!isRx2Buffer(buffer)) {
    throw new Error('Invalid REX2 file: missing CAT REX2 container header');
  }

  const view = new DataView(buffer);
  let channels = 1;
  let bitDepth = 16;
  let sampleRate = 44100;
  let totalFrames = 0;
  let loopStart = 0;
  let loopEnd = 0;
  const slices: Rx2SliceInfo[] = [];

  let dwopOffset = 0;
  let dwopSize = 0;

  function parseIff(start: number, end: number): void {
    let off = start;
    while (off + 8 <= end && off + 8 <= buffer.byteLength) {
      const chunkId = String.fromCharCode(
        view.getUint8(off),
        view.getUint8(off + 1),
        view.getUint8(off + 2),
        view.getUint8(off + 3)
      );
      const chunkSz = view.getUint32(off + 4, false);
      off += 8;
      if (off + chunkSz > buffer.byteLength) break;

      if (chunkId === 'SINF' && chunkSz >= 18) {
        const ch = view.getUint8(off);
        channels = ch === 2 ? 2 : 1;
        const bdCode = view.getUint8(off + 1);
        bitDepth = bdCode === 5 ? 24 : bdCode === 1 ? 8 : 16;
        sampleRate = view.getUint32(off + 2, false);
        totalFrames = view.getUint32(off + 6, false);
        loopStart = view.getUint32(off + 10, false);
        loopEnd = view.getUint32(off + 14, false);
      } else if (chunkId === 'SLCE' && chunkSz >= 8) {
        const sStart = view.getUint32(off, false);
        const sLen = view.getUint32(off + 4, false);
        const flags = chunkSz > 10 ? view.getUint8(off + 10) : 0;
        if (!(flags & 0x01)) {
          // not muted
          slices.push({ start: sStart, length: sLen, flags });
        }
      } else if (chunkId === 'SDAT' || chunkId === 'DWOP') {
        if (dwopSize === 0) {
          dwopOffset = off;
          dwopSize = chunkSz;
        }
      } else if (chunkId === 'CAT ' && chunkSz >= 4) {
        parseIff(off + 4, off + chunkSz);
      }

      off += chunkSz;
      if (off & 1) off++;
    }
  }

  parseIff(12, buffer.byteLength);

  if (dwopSize === 0 || totalFrames === 0) {
    throw new Error('No DWOP/SDAT audio chunk or 0 frames found in REX2');
  }

  const dec = new DwopDecompressor(buffer, dwopOffset, dwopSize);
  const outChannels: Float32Array[] = [];
  for (let ch = 0; ch < channels; ch++) {
    outChannels.push(new Float32Array(totalFrames));
  }

  const divisor = bitDepth === 24 ? 8388608.0 : 32768.0;

  if (channels === 1) {
    const ch0 = outChannels[0];
    for (let f = 0; f < totalFrames; f++) {
      const { sample2x, ok } = dec.decodeFrame(0);
      if (!ok) break;
      const raw = sample2x >> 1;
      ch0[f] = Math.max(-1.0, Math.min(1.0, raw / divisor));
    }
  } else {
    const ch0 = outChannels[0];
    const ch1 = outChannels[1];
    for (let f = 0; f < totalFrames; f++) {
      const l = dec.decodeFrame(0);
      if (!l.ok) break;
      const r = dec.decodeFrame(1);
      if (!r.ok) break;
      const rawL = l.sample2x >> 1;
      const rawR = (l.sample2x + r.sample2x) >> 1;
      ch0[f] = Math.max(-1.0, Math.min(1.0, rawL / divisor));
      ch1[f] = Math.max(-1.0, Math.min(1.0, rawR / divisor));
    }
  }

  const wavBuffer = encodeWavPcm16(outChannels, sampleRate);
  const sliceFrames = slices.map((s) => s.start);

  return {
    channels: outChannels,
    sampleRate,
    bitDepth,
    totalFrames,
    loopStart,
    loopEnd,
    slices,
    sliceFrames,
    wavBuffer,
  };
}
