// ─────────────────────────────────────────────────────────
// @abdsynths/shared — Yamaha Motif / Montage / MODX (.x7u, .x8u, .x3a) Parser
// ─────────────────────────────────────────────────────────

import { pcm16ToWavBuffer } from './PcmWavHelper.ts';
import type { LoopMode } from './SamplerTypes.ts';
import type { ParsedImportRegion, ParsedSamplerPreset } from './rawSamplerParsers.ts';

export interface YamahaKeybank {
  keyLow: number;
  keyHigh: number;
  velLow: number;
  velHigh: number;
  rootKey: number;
  tuneCents: number;
  pan: number;
  loopMode: number;
  loopStart: number;
  loopEnd: number;
  sampleRateHz: number;
  channels: number;
  sampleOffset: number;
  sampleLength: number;
}

export interface YamahaWaveform {
  id: number;
  name: string;
  keybanks: YamahaKeybank[];
}

export interface ParsedYamahaYsfc {
  version: string;
  waveforms: YamahaWaveform[];
  audioSamples: Map<string, ArrayBuffer>;
}

function readAscii(buf: Uint8Array, offset: number, len: number): string {
  let str = '';
  for (let i = 0; i < len && offset + i < buf.length; i++) {
    const c = buf[offset + i];
    if (c === 0) break;
    str += String.fromCharCode(c);
  }
  return str.trim();
}

function readU16BE(buf: Uint8Array, offset: number): number {
  return (buf[offset] << 8) | buf[offset + 1];
}

function readU32BE(buf: Uint8Array, offset: number): number {
  return (
    (buf[offset] << 24) |
    (buf[offset + 1] << 16) |
    (buf[offset + 2] << 8) |
    buf[offset + 3]
  );
}

export function isYamahaYsfcFile(data: ArrayBuffer | Uint8Array): boolean {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (buf.length < 16) return false;
  const magic = readAscii(buf, 0, 11);
  return magic === 'YAMAHA-YSFC';
}

export function parseYamahaYsfc(
  data: ArrayBuffer | Uint8Array
): ParsedYamahaYsfc {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (!isYamahaYsfcFile(buf)) {
    throw new Error('Not a valid Yamaha YSFC workstation file');
  }

  const version = readAscii(buf, 12, 8);
  const waveforms: YamahaWaveform[] = [];
  const audioSamples = new Map<string, ArrayBuffer>();

  let pos = 64;
  let waveDataOffset = 0;

  let scanPos = 64;
  while (scanPos + 8 < buf.length) {
    const chunkTag = readAscii(buf, scanPos, 4);
    const chunkSize = readU32BE(buf, scanPos + 4);
    if (chunkTag === 'WVD1' || chunkTag === 'DATA') {
      waveDataOffset = scanPos + 8;
      break;
    }
    if (chunkSize <= 0) break;
    scanPos += 8 + chunkSize;
  }

  while (pos + 8 < buf.length) {
    const chunkTag = readAscii(buf, pos, 4);
    const chunkSize = readU32BE(buf, pos + 4);
    const chunkData = pos + 8;

    if (chunkTag === 'WVM1' || chunkTag === 'WAVE') {
      let wPos = chunkData;
      const wEnd = Math.min(buf.length, chunkData + chunkSize);

      while (wPos + 32 <= wEnd) {
        const wfName = readAscii(buf, wPos, 16) || `Wave_${waveforms.length + 1}`;
        const numKeybanks = readU16BE(buf, wPos + 16);
        const kbList: YamahaKeybank[] = [];
        let kbPos = wPos + 32;

        for (let k = 0; k < numKeybanks && kbPos + 32 <= wEnd; k++) {
          const keyLow = buf[kbPos];
          const keyHigh = buf[kbPos + 1];
          const velLow = buf[kbPos + 2];
          const velHigh = buf[kbPos + 3];
          const rootKey = buf[kbPos + 4] || 60;
          const pan = buf[kbPos + 5] - 64;
          const rateCode = readU16BE(buf, kbPos + 6);
          const sampleRate = rateCode === 1 ? 48000 : 44100;
          const sampleOffset = readU32BE(buf, kbPos + 8);
          const sampleLength = readU32BE(buf, kbPos + 12);
          const loopStart = readU32BE(buf, kbPos + 16);
          const loopEnd = readU32BE(buf, kbPos + 20);

          kbList.push({
            keyLow,
            keyHigh,
            velLow,
            velHigh,
            rootKey,
            tuneCents: 0,
            pan,
            loopMode: loopEnd > loopStart ? 1 : 0,
            loopStart,
            loopEnd,
            sampleRateHz: sampleRate,
            channels: 1,
            sampleOffset,
            sampleLength,
          });

          kbPos += 32;
        }

        waveforms.push({
          id: waveforms.length + 1,
          name: wfName,
          keybanks: kbList,
        });

        wPos = kbPos;
      }
    }

    if (chunkSize <= 0) break;
    pos += 8 + chunkSize;
  }

  if (waveDataOffset > 0 && waveDataOffset < buf.length) {
    for (const wf of waveforms) {
      for (let ki = 0; ki < wf.keybanks.length; ki++) {
        const kb = wf.keybanks[ki];
        const aStart = waveDataOffset + kb.sampleOffset;
        const aEnd = aStart + kb.sampleLength;

        if (aStart < buf.length && aEnd <= buf.length && kb.sampleLength >= 4) {
          const rawSamples = Math.floor(kb.sampleLength / 2);
          const pcm16 = new Int16Array(rawSamples);
          for (let s = 0; s < rawSamples; s++) {
            pcm16[s] = (buf[aStart + s * 2] << 8) | buf[aStart + s * 2 + 1];
          }

          const wav = pcm16ToWavBuffer(pcm16, kb.sampleRateHz);
          const sKey = `${wf.name}_${ki + 1}.wav`;
          audioSamples.set(sKey, wav);
        }
      }
    }
  }

  return {
    version,
    waveforms,
    audioSamples,
  };
}

export function convertYamahaYsfcToPreset(
  ysfc: ParsedYamahaYsfc,
  waveformIndex: number = 0
): ParsedSamplerPreset {
  const wf = ysfc.waveforms[waveformIndex] || ysfc.waveforms[0];
  const name = wf ? wf.name : 'Yamaha Preset';
  const regions: ParsedImportRegion[] = [];
  const audioBuffers = new Map<string, ArrayBuffer>();

  for (const [k, v] of ysfc.audioSamples.entries()) {
    audioBuffers.set(k, v);
  }

  if (wf) {
    for (let i = 0; i < wf.keybanks.length; i++) {
      const kb = wf.keybanks[i];
      const sKey = `${wf.name}_${i + 1}.wav`;

      regions.push({
        id: `ysfc_${regions.length + 1}`,
        sampleName: sKey,
        samplePath: sKey,
        rootKey: kb.rootKey,
        lowKey: kb.keyLow,
        highKey: kb.keyHigh,
        lowVel: kb.velLow,
        highVel: kb.velHigh,
        detuneCents: kb.tuneCents,
        volumeDb: 0,
        pan: kb.pan,
        loopMode: kb.loopMode === 1 ? 'loop_continuous' : 'no_loop',
        loopStart: kb.loopStart,
        loopEnd: kb.loopEnd,
      });
    }
  }

  return {
    format: 'yamaha_ysfc',
    formatLabel: 'Yamaha Motif / Montage (.x7u)',
    presetName: name,
    modelName: name.slice(0, 11),
    detectedCategory: 'workstation',
    suggestedParameterSet: 1,
    regions,
    audioBuffers,
  };
}
