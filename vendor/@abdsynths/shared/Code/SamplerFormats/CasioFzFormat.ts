// ─────────────────────────────────────────────────────────
// @abdsynths/shared — Casio FZ-1 / FZ-10M / FZ-20M (.fzv, .fzf, floppy dumps) Parser
// ─────────────────────────────────────────────────────────

import { pcm16ToWavBuffer } from './PcmWavHelper.ts';
import type { LoopMode } from './SamplerTypes.ts';
import type { ParsedImportRegion, ParsedSamplerPreset } from './rawSamplerParsers.ts';

export interface CasioFzVoice {
  name: string;
  sampleRateHz: number;
  origKeyNumber: number;
  startWord: number;
  endWord: number;
  loopStartWord: number;
  loopEndWord: number;
  hasLoop: boolean;
  filterCutoff: number;
  filterResonance: number;
  audioPcm16?: Int16Array;
}

export interface CasioFzArea {
  highKey: number;
  voiceNumber: number;
  lowVel: number;
  highVel: number;
}

export interface CasioFzBank {
  name: string;
  areas: CasioFzArea[];
}

export interface ParsedCasioFzFile {
  type: 'voice' | 'bank' | 'disk';
  name: string;
  voices: CasioFzVoice[];
  banks: CasioFzBank[];
  sampleAudioMap: Map<string, ArrayBuffer>;
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

function readU16LE(buf: Uint8Array, offset: number): number {
  return buf[offset] | (buf[offset + 1] << 8);
}

function readU32LE(buf: Uint8Array, offset: number): number {
  return (
    buf[offset] |
    (buf[offset + 1] << 8) |
    (buf[offset + 2] << 16) |
    ((buf[offset + 3] << 24) >>> 0)
  );
}

export function isCasioFzData(data: ArrayBuffer | Uint8Array): boolean {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (buf.length === 1310720) return true;

  if (buf.length >= 1024) {
    const numVoices = readU16LE(buf, 1008);
    const contentSectors = readU16LE(buf, 1010);
    const waveBlocks = readU16LE(buf, 1012);
    if (numVoices <= 64 && contentSectors > 0 && waveBlocks <= contentSectors) {
      return true;
    }
  }

  return false;
}

export function parseCasioFz(
  data: ArrayBuffer | Uint8Array,
  fallbackName: string = 'Casio FZ Instrument'
): ParsedCasioFzFile {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  const voices: CasioFzVoice[] = [];
  const banks: CasioFzBank[] = [];
  const sampleAudioMap = new Map<string, ArrayBuffer>();

  const isDisk = buf.length === 1310720;
  const voiceOffset = 0;
  const waveOffset = 1024;
  let numVoices = 1;

  if (!isDisk && buf.length >= 1024) {
    numVoices = readU16LE(buf, 1008) || 1;
  }

  for (let v = 0; v < numVoices; v++) {
    const vo = voiceOffset + v * 256;
    if (vo + 192 > buf.length) break;

    const vName = readAscii(buf, vo, 12) || `FZ_Voice_${v + 1}`;
    const rateCode = buf[vo + 16];
    const sampleRate = rateCode === 2 ? 9000 : rateCode === 1 ? 18000 : 36000;
    const origKey = buf[vo + 17] || 60;

    const wavSt = readU32LE(buf, vo + 20);
    const wavEd = readU32LE(buf, vo + 24);
    const loopSt = readU32LE(buf, vo + 28);
    const loopEd = readU32LE(buf, vo + 32);

    const dcfCutoff = buf[vo + 40];
    const dcfReso = buf[vo + 41];

    voices.push({
      name: vName,
      sampleRateHz: sampleRate,
      origKeyNumber: origKey,
      startWord: wavSt,
      endWord: wavEd,
      loopStartWord: loopSt,
      loopEndWord: loopEd,
      hasLoop: loopEd > loopSt && loopEd <= wavEd,
      filterCutoff: dcfCutoff,
      filterResonance: dcfReso,
    });
  }

  if (buf.length > waveOffset) {
    const rawPcmBytes = buf.subarray(waveOffset);
    const totalWords = Math.floor(rawPcmBytes.length / 2);
    const fullPcm = new Int16Array(totalWords);
    for (let w = 0; w < totalWords; w++) {
      fullPcm[w] = readU16LE(rawPcmBytes, w * 2);
    }

    for (let i = 0; i < voices.length; i++) {
      const v = voices[i];
      let pcmSlice: Int16Array;

      if (v.endWord > v.startWord && v.endWord <= fullPcm.length) {
        pcmSlice = fullPcm.subarray(v.startWord, v.endWord);
      } else {
        pcmSlice = fullPcm;
      }

      if (pcmSlice.length > 0) {
        const wav = pcm16ToWavBuffer(pcmSlice, v.sampleRateHz);
        const sKey = `${v.name}.wav`;
        sampleAudioMap.set(sKey, wav);
      }
    }
  }

  return {
    type: isDisk ? 'disk' : numVoices > 1 ? 'bank' : 'voice',
    name: fallbackName.replace(/\.(fzv|fzf|img|dsk)$/i, ''),
    voices,
    banks,
    sampleAudioMap,
  };
}

export function convertCasioFzToPreset(
  fz: ParsedCasioFzFile,
  targetVoiceIndex: number = 0
): ParsedSamplerPreset {
  const regions: ParsedImportRegion[] = [];
  const selectedVoice = fz.voices[targetVoiceIndex] || fz.voices[0];
  const audioBuffers = new Map<string, ArrayBuffer>();

  for (const [k, v] of fz.sampleAudioMap.entries()) {
    audioBuffers.set(k, v);
  }

  if (selectedVoice) {
    const sKey = `${selectedVoice.name}.wav`;
    regions.push({
      id: `fz_${regions.length + 1}`,
      sampleName: sKey,
      samplePath: sKey,
      rootKey: selectedVoice.origKeyNumber,
      lowKey: 0,
      highKey: 127,
      lowVel: 0,
      highVel: 127,
      detuneCents: 0,
      volumeDb: 0,
      pan: 0,
      loopMode: selectedVoice.hasLoop ? 'loop_continuous' : 'no_loop',
      loopStart: Math.max(0, selectedVoice.loopStartWord - selectedVoice.startWord),
      loopEnd: Math.max(0, selectedVoice.loopEndWord - selectedVoice.startWord),
    });
  }

  return {
    format: 'casio_fz',
    formatLabel: 'Casio FZ Dump / Voice (.fzv)',
    presetName: selectedVoice ? selectedVoice.name : fz.name,
    modelName: (selectedVoice ? selectedVoice.name : fz.name).slice(0, 11),
    detectedCategory: 'vintage',
    suggestedParameterSet: 1,
    regions,
    audioBuffers,
  };
}
