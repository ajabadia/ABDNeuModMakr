// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Linear Sample Chain Builder (Fase 16)
//
// Concatenates audio samples into a continuous linear chain WAV
// with embedded RIFF cue points, smpl markers, and adtl labels
// for Elektron Octatrack, Roland SP-404 MKII, Korg electribe, OP-1.
// ─────────────────────────────────────────────────────────

import type { UniformSamplerRegion } from './rawSamplerTypes.ts';

export interface ChainSliceEntry {
  sliceId: number;
  label: string;
  startFrame: number;
  endFrame: number;
  lengthFrames: number;
  rootKey: number;
  lowKey: number;
  highKey: number;
  lowVel: number;
  highVel: number;
}

export interface SampleChainResult {
  wavBuffer: ArrayBuffer;
  slices: ChainSliceEntry[];
  totalFrames: number;
  sampleRate: number;
  numChannels: number;
  slicesText: string;
}

function writeStr(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i) & 0xff);
  }
}

/**
 * Builds a linear concatenated WAV sample chain with embedded RIFF 'cue '
 * markers and 'LIST adtl' labels.
 */
export function buildLinearSampleChainWav(
  regions: Array<
    UniformSamplerRegion & {
      audioChannels: Float32Array[];
      sampleRate: number;
    }
  >,
  resolution: 'pcm16' | 'pcm24' = 'pcm24',
  gapFrames = 0
): SampleChainResult {
  const sorted = [...regions].sort((a, b) => {
    if (a.rootKey !== b.rootKey) return a.rootKey - b.rootKey;
    if (a.lowKey !== b.lowKey) return a.lowKey - b.lowKey;
    return a.lowVel - b.lowVel;
  });

  const sampleRate = sorted[0]?.sampleRate ?? 44100;
  let numChannels = 1;
  for (const r of sorted) {
    if (r.audioChannels.length > numChannels) {
      numChannels = Math.min(2, r.audioChannels.length);
    }
  }

  // Calculate slice boundaries
  const slices: ChainSliceEntry[] = [];
  let currentFrame = 0;

  for (let i = 0; i < sorted.length; i++) {
    const reg = sorted[i];
    const len = reg.audioChannels[0]?.length ?? 0;
    const start = currentFrame;
    const end = start + len;

    const noteName = `Key${reg.rootKey}_${reg.lowKey}-${reg.highKey}`;
    const label = `${i + 1 < 10 ? '0' : ''}${i + 1}_${noteName}_${reg.sampleName.replace(/\.[^/.]+$/, '')}`;

    slices.push({
      sliceId: i + 1,
      label,
      startFrame: start,
      endFrame: end,
      lengthFrames: len,
      rootKey: reg.rootKey,
      lowKey: reg.lowKey,
      highKey: reg.highKey,
      lowVel: reg.lowVel,
      highVel: reg.highVel,
    });

    currentFrame = end + gapFrames;
  }

  const totalFrames = currentFrame;

  // Allocate channel buffers
  const fullChannels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    fullChannels.push(new Float32Array(totalFrames));
  }

  // Copy audio into concatenated channels
  for (let i = 0; i < sorted.length; i++) {
    const reg = sorted[i];
    const s = slices[i];
    const inChans = reg.audioChannels;

    for (let ch = 0; ch < numChannels; ch++) {
      const src = inChans[ch] ?? inChans[0];
      if (src) {
        fullChannels[ch].set(src, s.startFrame);
      }
    }
  }

  // Generate RIFF Chunks
  const bytesPerSample = resolution === 'pcm24' ? 3 : 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = totalFrames * blockAlign;
  const paddedDataSize = dataSize + (dataSize & 1);

  // 1. 'cue ' chunk: 4 + 4 + 4 + (24 * numSlices)
  const cuePayloadBytes = 4 + slices.length * 24;
  const cueTotalBytes = 8 + cuePayloadBytes;

  // 2. 'LIST' 'adtl' chunk: 4 + sum(8 + labelLenPadded)
  let adtlPayloadBytes = 4; // 'adtl'
  const lablChunks: Uint8Array[] = [];

  for (const s of slices) {
    const strBytes = s.label.length + 1; // null terminated
    const pad = strBytes & 1;
    const lablPayload = 4 + strBytes + pad; // dwCuePointId (4) + str
    const lablTotal = 8 + lablPayload;
    adtlPayloadBytes += lablTotal;

    const arr = new Uint8Array(lablTotal);
    const lv = new DataView(arr.buffer);
    writeStr(lv, 0, 'labl');
    lv.setUint32(4, lablPayload, true);
    lv.setUint32(8, s.sliceId, true);
    writeStr(lv, 12, s.label);
    arr[12 + s.label.length] = 0;
    lablChunks.push(arr);
  }
  const adtlTotalBytes = 8 + adtlPayloadBytes;

  const totalRiffBytes =
    4 + // 'WAVE'
    (8 + 16) + // 'fmt '
    (8 + paddedDataSize) + // 'data'
    cueTotalBytes +
    adtlTotalBytes;

  const buffer = new ArrayBuffer(8 + totalRiffBytes);
  const v = new DataView(buffer);

  // Write RIFF Header
  writeStr(v, 0, 'RIFF');
  v.setUint32(4, totalRiffBytes, true);
  writeStr(v, 8, 'WAVE');

  // Write fmt
  writeStr(v, 12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, numChannels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, byteRate, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, bytesPerSample * 8, true);

  // Write data
  let ptr = 36;
  writeStr(v, ptr, 'data');
  v.setUint32(ptr + 4, dataSize, true);
  ptr += 8;

  if (resolution === 'pcm24') {
    const maxPos = 8388607;
    const maxNeg = -8388608;
    for (let f = 0; f < totalFrames; f++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const s = Math.max(-1.0, Math.min(1.0, fullChannels[ch][f]));
        const int24 = Math.max(maxNeg, Math.min(maxPos, Math.round(s * maxPos)));
        v.setUint8(ptr, int24 & 0xff);
        v.setUint8(ptr + 1, (int24 >> 8) & 0xff);
        v.setUint8(ptr + 2, (int24 >> 16) & 0xff);
        ptr += 3;
      }
    }
  } else {
    for (let f = 0; f < totalFrames; f++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const s = Math.max(-1.0, Math.min(1.0, fullChannels[ch][f]));
        const int16 = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
        v.setInt16(ptr, Math.max(-32768, Math.min(32767, int16)), true);
        ptr += 2;
      }
    }
  }

  if (dataSize & 1) {
    v.setUint8(ptr, 0);
    ptr += 1;
  }

  // Write 'cue ' chunk
  writeStr(v, ptr, 'cue ');
  v.setUint32(ptr + 4, cuePayloadBytes, true);
  v.setUint32(ptr + 8, slices.length, true);
  ptr += 12;

  for (const s of slices) {
    v.setUint32(ptr + 0, s.sliceId, true);
    v.setUint32(ptr + 4, s.startFrame, true); // dwPosition
    writeStr(v, ptr + 8, 'data');            // fccChunk
    v.setUint32(ptr + 12, 0, true);          // dwChunkStart
    v.setUint32(ptr + 16, 0, true);          // dwBlockStart
    v.setUint32(ptr + 20, s.startFrame, true);// dwSampleOffset
    ptr += 24;
  }

  // Write 'LIST adtl' chunk
  writeStr(v, ptr, 'LIST');
  v.setUint32(ptr + 4, adtlPayloadBytes, true);
  writeStr(v, ptr + 8, 'adtl');
  ptr += 12;

  for (const lc of lablChunks) {
    new Uint8Array(buffer, ptr, lc.byteLength).set(lc);
    ptr += lc.byteLength;
  }

  // Generate slice documentation text
  const textLines: string[] = [
    '================================================================',
    '  ABDNeuModMakr — Linear Sample Chain Slice Marker Map',
    `  Total Slices: ${slices.length} | Sample Rate: ${sampleRate} Hz | Channels: ${numChannels}`,
    '================================================================',
    '',
    'Index | Slice Label                     | Start Frame | End Frame   | Length    | MIDI Root | Key Range',
    '------+---------------------------------+-------------+-------------+-----------+-----------+----------',
  ];

  for (const s of slices) {
    const idStr = String(s.sliceId).padStart(5, ' ');
    const lbl = s.label.padEnd(31, ' ');
    const st = String(s.startFrame).padStart(11, ' ');
    const en = String(s.endFrame).padStart(11, ' ');
    const ln = String(s.lengthFrames).padStart(9, ' ');
    const rk = String(s.rootKey).padStart(9, ' ');
    const kr = `${s.lowKey}..${s.highKey}`.padStart(8, ' ');
    textLines.push(`${idStr} | ${lbl} | ${st} | ${en} | ${ln} | ${rk} | ${kr}`);
  }

  textLines.push('');
  textLines.push('Compatible with:');
  textLines.push('- Elektron Octatrack (OT slice grids / chain markers)');
  textLines.push('- Roland SP-404 MKII (auto chop by cue markers)');
  textLines.push('- Teenage Engineering OP-1 / OP-Z (drum chain)');
  textLines.push('- Korg electribe sampler & Polyend Tracker');

  return {
    wavBuffer: buffer,
    slices,
    totalFrames,
    sampleRate,
    numChannels,
    slicesText: textLines.join('\n'),
  };
}
