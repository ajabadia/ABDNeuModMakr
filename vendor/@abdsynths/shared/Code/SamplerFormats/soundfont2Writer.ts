// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — SoundFont 2.04 Binary RIFF Builder (Fase 16)
//
// Generates standard compliant SoundFont 2 (.sf2) binary archives
// containing LIST INFO, LIST sdta, and LIST pdta chunks with
// 16-bit PCM sample buffers and complete preset/instrument records.
// ─────────────────────────────────────────────────────────

import type { UniformSamplerRegion } from './rawSamplerTypes.ts';
import { clamp } from './SamplerUtils.ts';

export interface Sf2SampleEntry {
  name: string;
  sampleRate: number;
  rootKey: number;
  detuneCents: number;
  loopMode: 'no_loop' | 'loop_continuous';
  loopStart: number;
  loopEnd: number;
  /** 16-bit signed PCM mono audio samples */
  pcm16: Int16Array;
}

export interface Sf2BankData {
  bankName: string;
  author?: string;
  copyright?: string;
  comment?: string;
  samples: Sf2SampleEntry[];
  regions: Array<
    UniformSamplerRegion & {
      sampleIndex: number;
    }
  >;
}

// SoundFont 2 Generator Operators (SF2 Spec 2.04 section 8.1.3)
const SFGEN_pan = 17;
const SFGEN_releaseVolEnv = 38;
const SFGEN_keyRange = 43;
const SFGEN_velRange = 44;
const SFGEN_fineTune = 52;
const SFGEN_sampleID = 53;
const SFGEN_sampleModes = 54;
const SFGEN_overridingRootKey = 58;

function writeStr(view: DataView, offset: number, str: string): number {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i) & 0xff);
  }
  return str.length;
}

function writePaddedStr(view: DataView, offset: number, length: number, str: string): void {
  for (let i = 0; i < length; i++) {
    const code = i < str.length ? str.charCodeAt(i) & 0xff : 0;
    view.setUint8(offset + i, code);
  }
  view.setUint8(offset + length - 1, 0); // null terminate
}

/**
 * Builds a valid, compliant SoundFont 2.04 (.sf2) binary buffer.
 */
export function buildSoundFont2Archive(bank: Sf2BankData): Uint8Array {
  const bankName = (bank.bankName || 'ABDSynth Bank').slice(0, 19);
  const author = (bank.author || 'ABDNeuModMakr User').slice(0, 60);
  const copyright = (bank.copyright || 'CC-BY 4.0').slice(0, 60);
  const comment = (bank.comment || 'Exported by ABDNeuModMakr Raw Sampler').slice(0, 120);

  // 1. Build INFO chunk items
  const buildInfoSubchunk = (fourcc: string, text: string): Uint8Array => {
    const strBytes = text.length + 1; // with null
    const pad = strBytes & 1;
    const totalSize = 8 + strBytes + pad;
    const arr = new Uint8Array(totalSize);
    const v = new DataView(arr.buffer);
    writeStr(v, 0, fourcc);
    v.setUint32(4, strBytes, true);
    writeStr(v, 8, text);
    v.setUint8(8 + text.length, 0);
    return arr;
  };

  const ifilChunk = new Uint8Array(12);
  const ifilView = new DataView(ifilChunk.buffer);
  writeStr(ifilView, 0, 'ifil');
  ifilView.setUint32(4, 4, true);
  ifilView.setUint16(8, 2, true);  // major 2
  ifilView.setUint16(10, 4, true); // minor 4

  const isngChunk = buildInfoSubchunk('isng', 'EMU8000');
  const inamChunk = buildInfoSubchunk('INAM', bankName);
  const isftChunk = buildInfoSubchunk('ISFT', 'ABDNeuModMakr v1.2');
  const icopChunk = buildInfoSubchunk('ICOP', copyright);
  const icmtChunk = buildInfoSubchunk('ICMT', `${author} — ${comment}`);

  const infoSubchunks = [ifilChunk, isngChunk, inamChunk, isftChunk, icopChunk, icmtChunk];
  let infoDataSize = 4; // 'INFO' fourcc
  for (const c of infoSubchunks) infoDataSize += c.byteLength;

  // 2. Build sdta chunk (16-bit PCM samples with 46 zero-padding samples each)
  const PADDING_SAMPLES = 46;
  let totalSampleWords = 0;
  for (const s of bank.samples) {
    totalSampleWords += s.pcm16.length + PADDING_SAMPLES;
  }
  // Minimum sdta size if 0 samples
  if (totalSampleWords === 0) totalSampleWords = PADDING_SAMPLES;

  const smplPayloadBytes = totalSampleWords * 2;
  const sdtaListBytes = 4 + 8 + smplPayloadBytes; // 'sdta' (4) + 'smpl' (4) + size (4) + data

  // 3. Prepare Sample Headers (shdr) offsets
  interface PreparedSample {
    name: string;
    start: number;
    end: number;
    startLoop: number;
    endLoop: number;
    sampleRate: number;
    originalKey: number;
    pitchCorrection: number;
    pcm16: Int16Array;
  }

  const preparedSamples: PreparedSample[] = [];
  let currentWordOffset = 0;

  for (let i = 0; i < bank.samples.length; i++) {
    const s = bank.samples[i];
    const len = s.pcm16.length;
    const start = currentWordOffset;
    const end = start + len;

    let sLoop = start;
    let eLoop = end;
    if (s.loopMode === 'loop_continuous' && s.loopEnd > s.loopStart && s.loopEnd <= len) {
      sLoop = start + Math.max(0, s.loopStart);
      eLoop = start + Math.min(len, s.loopEnd);
    } else {
      // Standard non-looping convention: loop end at sample end
      sLoop = end - 2;
      eLoop = end - 1;
    }

    preparedSamples.push({
      name: s.name.slice(0, 19),
      start,
      end,
      startLoop: sLoop,
      endLoop: eLoop,
      sampleRate: s.sampleRate,
      originalKey: clamp(s.rootKey, 0, 127),
      pitchCorrection: clamp(s.detuneCents, -50, 50),
      pcm16: s.pcm16,
    });

    currentWordOffset += len + PADDING_SAMPLES;
  }

  // 4. Build pdta chunks
  // - phdr: 1 preset + 1 terminal EOP = 2 * 38 bytes
  const phdrCount = 2;
  const phdrBytes = phdrCount * 38;

  // - pbag: 1 preset bag + 1 terminal = 2 * 4 bytes
  const pbagCount = 2;
  const pbagBytes = pbagCount * 4;

  // - pmod: 1 terminal = 10 bytes
  const pmodBytes = 10;

  // - pgen: 1 generator (instrument = 0) + 1 terminal = 2 * 4 bytes
  const pgenCount = 2;
  const pgenBytes = pgenCount * 4;

  // - inst: 1 instrument + 1 terminal EOI = 2 * 22 bytes
  const instCount = 2;
  const instBytes = instCount * 22;

  // - ibag: (number of regions) + 1 terminal = (N + 1) * 4 bytes
  const regionCount = Math.max(1, bank.regions.length);
  const ibagCount = regionCount + 1;
  const ibagBytes = ibagCount * 4;

  // - imod: 1 terminal = 10 bytes
  const imodBytes = 10;

  // - igen: Each region has 8 generators + 1 terminal = (regionCount * 8 + 1) * 4 bytes
  const GENS_PER_REGION = 8;
  const igenCount = regionCount * GENS_PER_REGION + 1;
  const igenBytes = igenCount * 4;

  // - shdr: (number of samples) + 1 terminal EOS = (M + 1) * 46 bytes
  const shdrCount = preparedSamples.length + 1;
  const shdrBytes = shdrCount * 46;

  const pdtaListBytes =
    4 + // 'pdta'
    8 + phdrBytes +
    8 + pbagBytes +
    8 + pmodBytes +
    8 + pgenBytes +
    8 + instBytes +
    8 + ibagBytes +
    8 + imodBytes +
    8 + igenBytes +
    8 + shdrBytes;

  // Total file size
  const totalRiffSize = 4 + (8 + infoDataSize) + (8 + sdtaListBytes) + (8 + pdtaListBytes);
  const outBuffer = new ArrayBuffer(8 + totalRiffSize);
  const v = new DataView(outBuffer);

  // RIFF Header
  writeStr(v, 0, 'RIFF');
  v.setUint32(4, totalRiffSize, true);
  writeStr(v, 8, 'sfbk');

  let ptr = 12;

  // Write LIST INFO
  writeStr(v, ptr, 'LIST');
  v.setUint32(ptr + 4, infoDataSize, true);
  writeStr(v, ptr + 8, 'INFO');
  ptr += 12;
  for (const c of infoSubchunks) {
    new Uint8Array(outBuffer, ptr, c.byteLength).set(c);
    ptr += c.byteLength;
  }

  // Write LIST sdta
  writeStr(v, ptr, 'LIST');
  v.setUint32(ptr + 4, sdtaListBytes, true);
  writeStr(v, ptr + 8, 'sdta');
  ptr += 12;

  writeStr(v, ptr, 'smpl');
  v.setUint32(ptr + 4, smplPayloadBytes, true);
  ptr += 8;

  // Fill sample PCM data
  for (const ps of preparedSamples) {
    for (let i = 0; i < ps.pcm16.length; i++) {
      v.setInt16(ptr, ps.pcm16[i], true);
      ptr += 2;
    }
    // 46 zero samples padding
    for (let i = 0; i < PADDING_SAMPLES; i++) {
      v.setInt16(ptr, 0, true);
      ptr += 2;
    }
  }

  // If 0 samples, pad
  if (preparedSamples.length === 0) {
    for (let i = 0; i < PADDING_SAMPLES; i++) {
      v.setInt16(ptr, 0, true);
      ptr += 2;
    }
  }

  // Write LIST pdta
  writeStr(v, ptr, 'LIST');
  v.setUint32(ptr + 4, pdtaListBytes, true);
  writeStr(v, ptr + 8, 'pdta');
  ptr += 12;

  // 1. phdr
  writeStr(v, ptr, 'phdr');
  v.setUint32(ptr + 4, phdrBytes, true);
  ptr += 8;
  // Preset 0
  writePaddedStr(v, ptr, 20, bankName);
  v.setUint16(ptr + 20, 0, true); // wPreset = 0
  v.setUint16(ptr + 22, 0, true); // wBank = 0
  v.setUint16(ptr + 24, 0, true); // wPresetBagNdx = 0
  v.setUint32(ptr + 26, 0, true); // library
  v.setUint32(ptr + 30, 0, true); // genre
  v.setUint32(ptr + 34, 0, true); // morphology
  ptr += 38;
  // Terminal EOP
  writePaddedStr(v, ptr, 20, 'EOP');
  v.setUint16(ptr + 20, 255, true);
  v.setUint16(ptr + 22, 255, true);
  v.setUint16(ptr + 24, 1, true); // terminal bag index = 1
  v.setUint32(ptr + 26, 0, true);
  v.setUint32(ptr + 30, 0, true);
  v.setUint32(ptr + 34, 0, true);
  ptr += 38;

  // 2. pbag
  writeStr(v, ptr, 'pbag');
  v.setUint32(ptr + 4, pbagBytes, true);
  ptr += 8;
  v.setUint16(ptr, 0, true); // wGenNdx = 0
  v.setUint16(ptr + 2, 0, true); // wModNdx = 0
  ptr += 4;
  v.setUint16(ptr, 1, true); // terminal gen = 1
  v.setUint16(ptr + 2, 0, true);
  ptr += 4;

  // 3. pmod
  writeStr(v, ptr, 'pmod');
  v.setUint32(ptr + 4, pmodBytes, true);
  ptr += 8;
  // 10 zero bytes terminal
  for (let i = 0; i < 10; i++) v.setUint8(ptr + i, 0);
  ptr += 10;

  // 4. pgen
  writeStr(v, ptr, 'pgen');
  v.setUint32(ptr + 4, pgenBytes, true);
  ptr += 8;
  // Gen: instrument = 0 (operator 41)
  v.setUint16(ptr, 41, true);
  v.setUint16(ptr + 2, 0, true); // points to instrument 0
  ptr += 4;
  // Terminal gen
  v.setUint16(ptr, 0, true);
  v.setUint16(ptr + 2, 0, true);
  ptr += 4;

  // 5. inst
  writeStr(v, ptr, 'inst');
  v.setUint32(ptr + 4, instBytes, true);
  ptr += 8;
  // Instrument 0
  writePaddedStr(v, ptr, 20, bankName);
  v.setUint16(ptr + 20, 0, true); // wInstBagNdx = 0
  ptr += 22;
  // Terminal EOI
  writePaddedStr(v, ptr, 20, 'EOI');
  v.setUint16(ptr + 20, regionCount, true);
  ptr += 22;

  // 6. ibag
  writeStr(v, ptr, 'ibag');
  v.setUint32(ptr + 4, ibagBytes, true);
  ptr += 8;
  for (let i = 0; i < regionCount; i++) {
    v.setUint16(ptr, i * GENS_PER_REGION, true);
    v.setUint16(ptr + 2, 0, true);
    ptr += 4;
  }
  // Terminal ibag
  v.setUint16(ptr, regionCount * GENS_PER_REGION, true);
  v.setUint16(ptr + 2, 0, true);
  ptr += 4;

  // 7. imod
  writeStr(v, ptr, 'imod');
  v.setUint32(ptr + 4, imodBytes, true);
  ptr += 8;
  for (let i = 0; i < 10; i++) v.setUint8(ptr + i, 0);
  ptr += 10;

  // 8. igen
  writeStr(v, ptr, 'igen');
  v.setUint32(ptr + 4, igenBytes, true);
  ptr += 8;

  const effectiveRegions = bank.regions.length > 0 ? bank.regions : [
    {
      id: 'default',
      sampleName: 'dummy',
      sampleIndex: 0,
      lowKey: 0,
      highKey: 127,
      rootKey: 60,
      lowVel: 1,
      highVel: 127,
      detuneCents: 0,
      volumeDb: 0,
      pan: 0,
      pitchKeytrack: 100,
      loopMode: 'no_loop' as const,
      loopStart: 0,
      loopEnd: 0,
      loopCrossfadeMs: 0,
    },
  ];

  for (const reg of effectiveRegions) {
    const sIdx = clamp(reg.sampleIndex, 0, Math.max(0, preparedSamples.length - 1));

    // Gen 1: keyRange
    v.setUint16(ptr, SFGEN_keyRange, true);
    v.setUint8(ptr + 2, clamp(reg.lowKey, 0, 127));
    v.setUint8(ptr + 3, clamp(reg.highKey, 0, 127));
    ptr += 4;

    // Gen 2: velRange
    v.setUint16(ptr, SFGEN_velRange, true);
    v.setUint8(ptr + 2, clamp(reg.lowVel, 1, 127));
    v.setUint8(ptr + 3, clamp(reg.highVel, 1, 127));
    ptr += 4;

    // Gen 3: overridingRootKey
    v.setUint16(ptr, SFGEN_overridingRootKey, true);
    v.setUint16(ptr + 2, clamp(reg.rootKey, 0, 127), true);
    ptr += 4;

    // Gen 4: fineTune
    v.setUint16(ptr, SFGEN_fineTune, true);
    v.setInt16(ptr + 2, clamp(reg.detuneCents, -99, 99), true);
    ptr += 4;

    // Gen 5: pan (-500..+500)
    v.setUint16(ptr, SFGEN_pan, true);
    const sfPan = clamp(Math.round(reg.pan * 10), -500, 500);
    v.setInt16(ptr + 2, sfPan, true);
    ptr += 4;

    // Gen 6: sampleModes (0 = no loop, 1 = continuous forward loop)
    v.setUint16(ptr, SFGEN_sampleModes, true);
    v.setUint16(ptr + 2, reg.loopMode !== 'no_loop' ? 1 : 0, true);
    ptr += 4;

    // Gen 7: releaseVolEnv (in timecents, default ~0.25s = -2400)
    v.setUint16(ptr, SFGEN_releaseVolEnv, true);
    const relSec = reg.ampEnvelope?.releaseSec ?? 0.25;
    const timecents = Math.round(1200 * Math.log2(Math.max(0.001, relSec)));
    v.setInt16(ptr + 2, clamp(timecents, -12000, 8000), true);
    ptr += 4;

    // Gen 8: sampleID
    v.setUint16(ptr, SFGEN_sampleID, true);
    v.setUint16(ptr + 2, sIdx, true);
    ptr += 4;
  }

  // Terminal igen
  v.setUint16(ptr, 0, true);
  v.setUint16(ptr + 2, 0, true);
  ptr += 4;

  // 9. shdr
  writeStr(v, ptr, 'shdr');
  v.setUint32(ptr + 4, shdrBytes, true);
  ptr += 8;

  for (const ps of preparedSamples) {
    writePaddedStr(v, ptr, 20, ps.name);
    v.setUint32(ptr + 20, ps.start, true);
    v.setUint32(ptr + 24, ps.end, true);
    v.setUint32(ptr + 28, ps.startLoop, true);
    v.setUint32(ptr + 32, ps.endLoop, true);
    v.setUint32(ptr + 36, ps.sampleRate, true);
    v.setUint8(ptr + 40, ps.originalKey);
    v.setInt8(ptr + 41, ps.pitchCorrection);
    v.setUint16(ptr + 42, 0, true); // sampleLink
    v.setUint16(ptr + 44, 1, true); // sfSampleType = 1 (monoSample)
    ptr += 46;
  }

  // Terminal EOS
  writePaddedStr(v, ptr, 20, 'EOS');
  for (let i = 20; i < 46; i++) v.setUint8(ptr + i, 0);
  ptr += 46;

  return new Uint8Array(outBuffer);
}
