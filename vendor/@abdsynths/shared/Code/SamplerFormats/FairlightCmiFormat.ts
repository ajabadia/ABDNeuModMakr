// ─────────────────────────────────────────────────────────
// @abdsynths/shared — Fairlight CMI IIx / III Voice (.cmi, .cmi3, .vc, .co) Parser
// ─────────────────────────────────────────────────────────

import { pcm16ToWavBuffer } from './PcmWavHelper.ts';
import type { ParsedImportRegion, ParsedSamplerPreset } from './rawSamplerParsers.ts';

export interface FairlightSubVoice {
  id: number;
  keyLow: number;
  keyHigh: number;
  rootKey: number;
  tuningCents: number;
  volumeDb: number;
  loopMode: number;
  loopStart: number;
  loopEnd: number;
  sampleRateHz: number;
  sampleData?: Int16Array;
}

export interface FairlightCmiVoice {
  name: string;
  isSeriesIII: boolean;
  subVoices: FairlightSubVoice[];
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

function readU16BE(buf: Uint8Array, offset: number): number {
  return (buf[offset] << 8) | buf[offset + 1];
}

export function isFairlightCmiVoice(data: ArrayBuffer | Uint8Array): boolean {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (buf.length < 2304) return false;
  const version = readU16BE(buf, 0);
  if (version === 768) return true;
  if (buf.length === 21888) return true;
  return false;
}

export function parseFairlightCmiVoice(
  data: ArrayBuffer | Uint8Array,
  fileName: string = 'Fairlight Voice'
): FairlightCmiVoice {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  const subVoices: FairlightSubVoice[] = [];
  const sampleAudioMap = new Map<string, ArrayBuffer>();

  const isSeriesIII = readU16BE(buf, 0) === 768;
  const name = readAscii(buf, 2, 16) || fileName.replace(/\.(cmi|cmi3|vc)$/i, '');

  if (isSeriesIII) {
    const keyToSubVoice = new Uint8Array(128);
    for (let k = 0; k < 128; k++) {
      keyToSubVoice[k] = buf[256 + k];
    }

    const audioOffset = 2304;
    const pcmLen = Math.floor((buf.length - audioOffset) / 2);
    const fullPcm = new Int16Array(pcmLen);

    for (let i = 0; i < pcmLen; i++) {
      fullPcm[i] = (buf[audioOffset + i * 2] << 8) | buf[audioOffset + i * 2 + 1];
    }

    const usedSubVoiceIds = new Set<number>();
    for (let k = 0; k < 128; k++) {
      const sv = keyToSubVoice[k];
      if (sv > 0) usedSubVoiceIds.add(sv);
    }

    if (usedSubVoiceIds.size === 0) {
      usedSubVoiceIds.add(1);
    }

    for (const svId of usedSubVoiceIds) {
      let lowKey = 127;
      let highKey = 0;
      for (let k = 0; k < 128; k++) {
        if (keyToSubVoice[k] === svId || usedSubVoiceIds.size === 1) {
          if (k < lowKey) lowKey = k;
          if (k > highKey) highKey = k;
        }
      }
      if (lowKey > highKey) {
        lowKey = 0;
        highKey = 127;
      }

      const root = Math.round((lowKey + highKey) / 2);
      const subVoiceAudio = fullPcm;

      const wav = pcm16ToWavBuffer(subVoiceAudio, 44100);
      const sKey = `${name}_SV${svId}.wav`;
      sampleAudioMap.set(sKey, wav);

      subVoices.push({
        id: svId,
        keyLow: lowKey,
        keyHigh: highKey,
        rootKey: root,
        tuningCents: 0,
        volumeDb: 0,
        loopMode: 1,
        loopStart: 0,
        loopEnd: subVoiceAudio.length,
        sampleRateHz: 44100,
        sampleData: subVoiceAudio,
      });
    }
  } else {
    const audioOffset = 0x1500;
    const numSamples = Math.min(16384, buf.length - audioOffset);
    const pcm16 = new Int16Array(numSamples);

    for (let i = 0; i < numSamples; i++) {
      const b = buf[audioOffset + i];
      pcm16[i] = (b - 128) << 8;
    }

    const wav = pcm16ToWavBuffer(pcm16, 30200);
    const sKey = `${name}.wav`;
    sampleAudioMap.set(sKey, wav);

    subVoices.push({
      id: 1,
      keyLow: 0,
      keyHigh: 127,
      rootKey: 60,
      tuningCents: 0,
      volumeDb: 0,
      loopMode: 1,
      loopStart: 0,
      loopEnd: pcm16.length,
      sampleRateHz: 30200,
      sampleData: pcm16,
    });
  }

  return {
    name,
    isSeriesIII,
    subVoices,
    sampleAudioMap,
  };
}

export function convertFairlightCmiToPreset(
  cmi: FairlightCmiVoice
): ParsedSamplerPreset {
  const regions: ParsedImportRegion[] = [];
  const audioBuffers = new Map<string, ArrayBuffer>();

  for (const [k, v] of cmi.sampleAudioMap.entries()) {
    audioBuffers.set(k, v);
  }

  for (const sv of cmi.subVoices) {
    const sKey = `${cmi.name}_SV${sv.id}.wav`;

    regions.push({
      id: `cmi_${sv.id}`,
      sampleName: sKey,
      samplePath: sKey,
      rootKey: sv.rootKey,
      lowKey: sv.keyLow,
      highKey: sv.keyHigh,
      lowVel: 0,
      highVel: 127,
      detuneCents: sv.tuningCents,
      volumeDb: sv.volumeDb,
      pan: 0,
      loopMode: sv.loopMode === 1 ? 'loop_continuous' : 'no_loop',
      loopStart: sv.loopStart,
      loopEnd: sv.loopEnd,
    });
  }

  return {
    format: 'fairlight_cmi',
    formatLabel: 'Fairlight CMI Series III Voice',
    presetName: cmi.name,
    modelName: cmi.name.slice(0, 11),
    detectedCategory: 'vintage',
    suggestedParameterSet: 1,
    regions,
    audioBuffers,
  };
}
