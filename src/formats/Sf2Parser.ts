// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — SoundFont 2 (.sf2) Native Importer
//
// Parses RIFF/sfbk containers (INFO, sdta/smpl + sm24, pdta:
// phdr, pbag, pmod, pgen, inst, ibag, imod, igen, shdr),
// merges linked Left/Right stereo sample pairs into true 2-channel
// WAV buffers, extracts DAHDSR envelopes, Filter, LFO, Loop markers,
// Pitch Keytrack, and converts directly into our native Extended +
// Classic session model (discarding the external .sf2 container).
// ─────────────────────────────────────────────────────────

import type {
  AudioFilePayload,
  ExtendedRegion,
  Sf2PresetOption,
  SynthArticulationConfig,
  Zone,
  LoopMode,
} from '../core/types.ts';
import { encodeWavPcm16 } from '../core/dsp/WavDecoder.ts';
import {
  createDefaultArticulation,
  projectExtendedRegionsToClassicZones,
} from '../core/extendedAdapter.ts';

export interface NativeSamplerImportResult {
  sourceFormat: 'sf2' | 'sfz';
  presetName: string;
  modelName: string;
  detectedCategory: string;
  suggestedParameterSet: number;
  audioFiles: AudioFilePayload[];
  extendedRegions: ExtendedRegion[];
  classicZones: Zone[];
  velocityLayerGainCompensation: Record<string, { lowGain: number; highGain: number }>;
  articulation: SynthArticulationConfig;
}

interface PhdrRecord {
  name: string;
  preset: number;
  bank: number;
  pbagNdx: number;
}

interface BagRecord {
  genNdx: number;
  modNdx: number;
}

interface GenRecord {
  oper: number;
  uAmount: number;
  sAmount: number;
  lo: number;
  hi: number;
}

interface InstRecord {
  name: string;
  ibagNdx: number;
}

interface ShdrRecord {
  name: string;
  start: number;
  end: number;
  startLoop: number;
  endLoop: number;
  sampleRate: number;
  originalPitch: number;
  pitchCorrection: number;
  sampleLink: number;
  sampleType: number;
}

interface ParsedSf2Archive {
  smplOffset: number;
  smplByteLength: number;
  sm24Offset: number;
  sm24ByteLength: number;
  phdrs: PhdrRecord[];
  pbags: BagRecord[];
  pgens: GenRecord[];
  insts: InstRecord[];
  ibags: BagRecord[];
  igens: GenRecord[];
  shdrs: ShdrRecord[];
}

function readFourCC(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

function readAsciiZ(view: DataView, offset: number, maxLen: number): string {
  let out = '';
  for (let i = 0; i < maxLen; i++) {
    const ch = view.getUint8(offset + i);
    if (ch === 0) break;
    if (ch >= 32 && ch < 127) out += String.fromCharCode(ch);
  }
  return out.trim();
}

/**
 * Converts SoundFont 2 timecents to seconds: `2^(tc / 1200)`.
 * Values <= -12000 timecents represent 0 seconds (instantaneous).
 */
export function timecentsToSeconds(tc: number, minSec = 0, maxSec = 30): number {
  if (!Number.isFinite(tc) || tc <= -11900) return minSec;
  const sec = Math.pow(2, tc / 1200);
  return Math.max(minSec, Math.min(maxSec, sec));
}

/**
 * Converts SoundFont 2 absolute cents to Hz: `8.176 * 2^(cents / 1200)`.
 */
export function absCentsToHz(cents: number, minHz = 20, maxHz = 20000): number {
  if (!Number.isFinite(cents)) return maxHz;
  const hz = 8.176 * Math.pow(2, cents / 1200);
  return Math.max(minHz, Math.min(maxHz, hz));
}

/**
 * Classifies instrument category (`cat-0`..`cat-9`) and optimal Neuron
 * Parameter Set (`0..9`) from preset/instrument/sample naming heuristics.
 */
export function classifyInstrumentAndParameterSet(name: string): {
  category: string;
  parameterSet: number;
} {
  const n = name.toLowerCase();
  if (/drum|kit|snare|kick|hihat|hat|tom|cymbal|conga|bongo|timpani|taiko|djembe|cajon|perc/.test(n)) {
    return { category: 'Drums & Percussion Kit', parameterSet: 8 };
  }
  if (/violin|viola|cello|contrabass|string|orchestra|ensemble|arco|pizz|quartet|symphon/.test(n)) {
    return { category: 'Orchestral & Strings', parameterSet: 1 };
  }
  if (/rhodes|wurli|clav|epiano|tine|fm piano|dx7/.test(n)) {
    return { category: 'Electric Pianos & Tines', parameterSet: 2 };
  }
  if (/piano|grand|upright|organ|harpsi|spinel|accord/.test(n)) {
    return { category: 'Keyboards & Acoustic Pianos', parameterSet: 2 };
  }
  if (/bass|sub|808|fretless|slap|contrabass|upright bass|synth bass|acid/.test(n)) {
    return { category: 'Bass & Low End', parameterSet: 4 };
  }
  if (/guitar|harp|banjo|mandolin|lute|sitar|koto|shamisen|oud|pipa|ukulele|pluck/.test(n)) {
    return { category: 'Plucked & Ethnic / World', parameterSet: 3 };
  }
  if (/sax|flute|oboe|clarinet|bassoon|wind|reed|harmonica|pipe|panflute|recorder|bagpipe/.test(n)) {
    return { category: 'Woodwinds & Reeds', parameterSet: 1 };
  }
  if (/trumpet|trombone|tuba|cornet|french horn|brass|fanfare/.test(n)) {
    return { category: 'Brass & Horns', parameterSet: 1 };
  }
  if (/choir|voice|vocal|vox|aah|ooh|soprano voice|tenor voice|opera|acapella|chant/.test(n)) {
    return { category: 'Vocal & Choir', parameterSet: 5 };
  }
  if (/bell|marimba|vibes|vibraphone|xylophone|glock|kalimba|chime|mallet|gong|tubular|celesta|music box/.test(n)) {
    return { category: 'Mallets & Chromatic Perc', parameterSet: 7 };
  }
  if (/pad|atmos|ambient|sweep|drone|warm|halo|shimmer|ethereal|soundscape/.test(n)) {
    return { category: 'Pads & Atmospheres', parameterSet: 6 };
  }
  if (/arp|loop|groove|beat|sequence|riff|phrase/.test(n)) {
    return { category: 'Arpeggiated & Sequences', parameterSet: 8 };
  }
  if (/lead|solo|mono|saw lead|square lead|sync lead|screamer/.test(n)) {
    return { category: 'Synth Leads & Solos', parameterSet: 0 };
  }
  if (/sfx|fx|noise|laser|riser|hit|impact|glitch|sweep|drop/.test(n)) {
    return { category: 'SFX, Drones & Cinematic', parameterSet: 9 };
  }
  return { category: 'Synth & Neutral', parameterSet: 0 };
}

function parseSf2Structure(buffer: ArrayBuffer): ParsedSf2Archive {
  if (buffer.byteLength < 64) {
    throw new Error('Invalid SF2 file: buffer too small (< 64 bytes)');
  }
  const view = new DataView(buffer);
  const riff = readFourCC(view, 0);
  const sfbk = readFourCC(view, 8);
  if (riff !== 'RIFF' || sfbk !== 'sfbk') {
    throw new Error(`Invalid SF2 header: expected RIFF/sfbk, found ${riff}/${sfbk}`);
  }

  let smplOffset = -1;
  let smplByteLength = 0;
  let sm24Offset = -1;
  let sm24ByteLength = 0;
  const phdrs: PhdrRecord[] = [];
  const pbags: BagRecord[] = [];
  const pgens: GenRecord[] = [];
  const insts: InstRecord[] = [];
  const ibags: BagRecord[] = [];
  const igens: GenRecord[] = [];
  const shdrs: ShdrRecord[] = [];

  let pos = 12;
  while (pos + 8 <= buffer.byteLength) {
    const chunkId = readFourCC(view, pos);
    const chunkSize = view.getUint32(pos + 4, true);
    const dataStart = pos + 8;

    if (chunkId === 'LIST' && dataStart + 4 <= buffer.byteLength) {
      const listType = readFourCC(view, dataStart);
      let sub = dataStart + 4;
      const listEnd = Math.min(buffer.byteLength, dataStart + chunkSize);

      while (sub + 8 <= listEnd) {
        const subId = readFourCC(view, sub);
        const subSize = view.getUint32(sub + 4, true);
        const subData = sub + 8;

        if (listType === 'sdta') {
          if (subId === 'smpl') {
            smplOffset = subData;
            smplByteLength = subSize;
          } else if (subId === 'sm24') {
            sm24Offset = subData;
            sm24ByteLength = subSize;
          }
        } else if (listType === 'pdta') {
          if (subId === 'phdr') {
            const count = Math.floor(subSize / 38);
            for (let i = 0; i < count; i++) {
              const b = subData + i * 38;
              phdrs.push({
                name: readAsciiZ(view, b, 20),
                preset: view.getUint16(b + 20, true),
                bank: view.getUint16(b + 22, true),
                pbagNdx: view.getUint16(b + 24, true),
              });
            }
          } else if (subId === 'pbag') {
            const count = Math.floor(subSize / 4);
            for (let i = 0; i < count; i++) {
              const b = subData + i * 4;
              pbags.push({
                genNdx: view.getUint16(b, true),
                modNdx: view.getUint16(b + 2, true),
              });
            }
          } else if (subId === 'pgen') {
            const count = Math.floor(subSize / 4);
            for (let i = 0; i < count; i++) {
              const b = subData + i * 4;
              pgens.push({
                oper: view.getUint16(b, true),
                uAmount: view.getUint16(b + 2, true),
                sAmount: view.getInt16(b + 2, true),
                lo: view.getUint8(b + 2),
                hi: view.getUint8(b + 3),
              });
            }
          } else if (subId === 'inst') {
            const count = Math.floor(subSize / 22);
            for (let i = 0; i < count; i++) {
              const b = subData + i * 22;
              insts.push({
                name: readAsciiZ(view, b, 20),
                ibagNdx: view.getUint16(b + 20, true),
              });
            }
          } else if (subId === 'ibag') {
            const count = Math.floor(subSize / 4);
            for (let i = 0; i < count; i++) {
              const b = subData + i * 4;
              ibags.push({
                genNdx: view.getUint16(b, true),
                modNdx: view.getUint16(b + 2, true),
              });
            }
          } else if (subId === 'igen') {
            const count = Math.floor(subSize / 4);
            for (let i = 0; i < count; i++) {
              const b = subData + i * 4;
              igens.push({
                oper: view.getUint16(b, true),
                uAmount: view.getUint16(b + 2, true),
                sAmount: view.getInt16(b + 2, true),
                lo: view.getUint8(b + 2),
                hi: view.getUint8(b + 3),
              });
            }
          } else if (subId === 'shdr') {
            const count = Math.floor(subSize / 46);
            for (let i = 0; i < count; i++) {
              const b = subData + i * 46;
              shdrs.push({
                name: readAsciiZ(view, b, 20),
                start: view.getUint32(b + 20, true),
                end: view.getUint32(b + 24, true),
                startLoop: view.getUint32(b + 28, true),
                endLoop: view.getUint32(b + 32, true),
                sampleRate: view.getUint32(b + 36, true),
                originalPitch: view.getUint8(b + 40),
                pitchCorrection: view.getInt8(b + 41),
                sampleLink: view.getUint16(b + 42, true),
                sampleType: view.getUint16(b + 44, true),
              });
            }
          }
        }

        sub += 8 + subSize + (subSize & 1);
      }
    }

    pos += 8 + chunkSize + (chunkSize & 1);
  }

  if (smplOffset < 0 || shdrs.length === 0 || insts.length === 0) {
    throw new Error('Invalid SF2 file: missing sdta/smpl or pdta chunks');
  }

  return {
    smplOffset,
    smplByteLength,
    sm24Offset,
    sm24ByteLength,
    phdrs,
    pbags,
    pgens,
    insts,
    ibags,
    igens,
    shdrs,
  };
}

/**
 * Lists all playable presets inside an `.sf2` buffer.
 */
export function listSf2Presets(buffer: ArrayBuffer): Sf2PresetOption[] {
  const sf2 = parseSf2Structure(buffer);
  const options: Sf2PresetOption[] = [];

  // Last phdr record is the terminal EOP record
  const presetCount = Math.max(0, sf2.phdrs.length - 1);
  for (let pIdx = 0; pIdx < presetCount; pIdx++) {
    const p = sf2.phdrs[pIdx];
    const nextP = sf2.phdrs[pIdx + 1];
    let regionCount = 0;
    const sampleIndices = new Set<number>();

    for (let bIdx = p.pbagNdx; bIdx < nextP.pbagNdx && bIdx + 1 < sf2.pbags.length; bIdx++) {
      const gStart = sf2.pbags[bIdx].genNdx;
      const gEnd = sf2.pbags[bIdx + 1].genNdx;
      let instId = -1;
      for (let g = gStart; g < gEnd && g < sf2.pgens.length; g++) {
        if (sf2.pgens[g].oper === 41) {
          instId = sf2.pgens[g].uAmount;
        }
      }
      if (instId >= 0 && instId + 1 < sf2.insts.length) {
        const inst = sf2.insts[instId];
        const nextInst = sf2.insts[instId + 1];
        for (let ib = inst.ibagNdx; ib < nextInst.ibagNdx && ib + 1 < sf2.ibags.length; ib++) {
          const igStart = sf2.ibags[ib].genNdx;
          const igEnd = sf2.ibags[ib + 1].genNdx;
          for (let ig = igStart; ig < igEnd && ig < sf2.igens.length; ig++) {
            if (sf2.igens[ig].oper === 53) {
              regionCount++;
              sampleIndices.add(sf2.igens[ig].uAmount);
            }
          }
        }
      }
    }

    if (regionCount > 0) {
      options.push({
        index: pIdx,
        name: p.name || `Preset ${pIdx + 1}`,
        bank: p.bank,
        presetNumber: p.preset,
        regionCount,
        sampleCount: sampleIndices.size,
      });
    }
  }

  // Fallback: if no preset referenced an instrument, synthesize one option per instrument
  if (options.length === 0 && sf2.insts.length > 1) {
    for (let iIdx = 0; iIdx < sf2.insts.length - 1; iIdx++) {
      const inst = sf2.insts[iIdx];
      const nextInst = sf2.insts[iIdx + 1];
      let regionCount = 0;
      const sampleIndices = new Set<number>();
      for (let ib = inst.ibagNdx; ib < nextInst.ibagNdx && ib + 1 < sf2.ibags.length; ib++) {
        const igStart = sf2.ibags[ib].genNdx;
        const igEnd = sf2.ibags[ib + 1].genNdx;
        for (let ig = igStart; ig < igEnd && ig < sf2.igens.length; ig++) {
          if (sf2.igens[ig].oper === 53) {
            regionCount++;
            sampleIndices.add(sf2.igens[ig].uAmount);
          }
        }
      }
      if (regionCount > 0) {
        options.push({
          index: iIdx,
          name: inst.name || `Instrument ${iIdx + 1}`,
          bank: 0,
          presetNumber: iIdx,
          regionCount,
          sampleCount: sampleIndices.size,
        });
      }
    }
  }

  return options;
}

interface RawExtractedZone {
  sampleId: number;
  shdr: ShdrRecord;
  lowKey: number;
  highKey: number;
  lowVel: number;
  highVel: number;
  rootKey: number;
  detuneCents: number;
  volumeDb: number;
  pan: number; // -500..+500 (SF2 tenth-percent)
  pitchKeytrack: number;
  loopMode: LoopMode;
  startSample: number;
  endSample: number;
  startLoopSample: number;
  endLoopSample: number;
  gens: Map<number, GenRecord>;
}

function extractSampleFloat32(
  view: DataView,
  smplOffset: number,
  smplByteLength: number,
  startFrame: number,
  endFrame: number,
): Float32Array {
  const maxFrames = Math.floor(smplByteLength / 2);
  const s = Math.max(0, Math.min(maxFrames, startFrame));
  const e = Math.max(s, Math.min(maxFrames, endFrame));
  const len = Math.max(1, e - s);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const bytePos = smplOffset + (s + i) * 2;
    if (bytePos + 2 <= view.byteLength) {
      out[i] = view.getInt16(bytePos, true) / 32768.0;
    }
  }
  return out;
}

function sanitizeSampleFileName(raw: string, fallbackIndex: number): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_\-. ]/g, '_').trim();
  const base = cleaned.length > 0 ? cleaned : `sample_${fallbackIndex}`;
  return base.toLowerCase().endsWith('.wav') ? base : `${base}.wav`;
}

function deriveStereoPairBaseName(leftName: string, rightName: string, idx: number): string {
  const cleanL = leftName.trim();
  const cleanR = rightName.trim();
  // Strip trailing L/R or -L/-R or _L/_R when they match
  const strippedL = cleanL.replace(/[-_\s]?[lL]$/, '');
  const strippedR = cleanR.replace(/[-_\s]?[rR]$/, '');
  if (strippedL.length > 0 && strippedL.toLowerCase() === strippedR.toLowerCase()) {
    return sanitizeSampleFileName(strippedL, idx);
  }
  return sanitizeSampleFileName(strippedL || cleanL, idx);
}

/**
 * Imports a SoundFont 2 (`.sf2`) preset and converts it immediately into our
 * native session structures (`ExtendedRegion[]`, `Zone[]`, `SynthArticulationConfig`,
 * and standalone mono/stereo WAV `AudioFilePayload[]`).
 */
export function importSf2PresetToNative(
  buffer: ArrayBuffer,
  presetIndex = 0,
): NativeSamplerImportResult {
  const sf2 = parseSf2Structure(buffer);
  const view = new DataView(buffer);

  const presets = listSf2Presets(buffer);
  const chosenOption = presets[Math.max(0, Math.min(presets.length - 1, presetIndex))] ?? {
    index: 0,
    name: 'SF2 Instrument',
    bank: 0,
    presetNumber: 0,
    regionCount: 0,
    sampleCount: 0,
  };

  const pIdx = chosenOption.index;
  const rawZones: RawExtractedZone[] = [];

  const collectInstrumentZones = (
    instId: number,
    presetKeyLo: number,
    presetKeyHi: number,
    presetVelLo: number,
    presetVelHi: number,
    presetGenOffsets: Map<number, number>,
  ) => {
    if (instId < 0 || instId + 1 >= sf2.insts.length) return;
    const inst = sf2.insts[instId];
    const nextInst = sf2.insts[instId + 1];

    const globalGens = new Map<number, GenRecord>();

    for (let ib = inst.ibagNdx; ib < nextInst.ibagNdx && ib + 1 < sf2.ibags.length; ib++) {
      const igStart = sf2.ibags[ib].genNdx;
      const igEnd = sf2.ibags[ib + 1].genNdx;
      const localGens = new Map<number, GenRecord>();
      for (let ig = igStart; ig < igEnd && ig < sf2.igens.length; ig++) {
        localGens.set(sf2.igens[ig].oper, sf2.igens[ig]);
      }

      // If no sampleID (oper 53) in the first bag, it is the global instrument zone
      if (!localGens.has(53)) {
        if (ib === inst.ibagNdx) {
          for (const [k, v] of localGens.entries()) globalGens.set(k, v);
        }
        continue;
      }

      const combined = new Map<number, GenRecord>(globalGens);
      for (const [k, v] of localGens.entries()) combined.set(k, v);

      const sampleId = combined.get(53)!.uAmount;
      if (sampleId >= sf2.shdrs.length) continue;
      const shdr = sf2.shdrs[sampleId];
      // Ignore ROM samples (bit 0x8000)
      if ((shdr.sampleType & 0x8000) !== 0) continue;

      const instKeyLo = combined.has(43) ? combined.get(43)!.lo : 0;
      const instKeyHi = combined.has(43) ? combined.get(43)!.hi : 127;
      const instVelLo = combined.has(44) ? combined.get(44)!.lo : 1;
      const instVelHi = combined.has(44) ? combined.get(44)!.hi : 127;

      const lowKey = Math.max(0, Math.max(presetKeyLo, instKeyLo));
      const highKey = Math.min(127, Math.min(presetKeyHi, instKeyHi));
      const lowVel = Math.max(1, Math.max(presetVelLo, instVelLo));
      const highVel = Math.min(127, Math.min(presetVelHi, instVelHi));
      if (lowKey > highKey || lowVel > highVel) continue;

      const getSignedGen = (op: number, defVal = 0): number => {
        const base = combined.has(op) ? combined.get(op)!.sAmount : defVal;
        const add = presetGenOffsets.get(op) ?? 0;
        return base + add;
      };

      // Root key: oper 58 (overridingRootKey) overrides shdr.originalPitch when in 0..127
      const overrideRoot = combined.has(58) ? combined.get(58)!.sAmount : -1;
      const rawRoot =
        overrideRoot >= 0 && overrideRoot <= 127
          ? overrideRoot
          : shdr.originalPitch >= 0 && shdr.originalPitch <= 127
            ? shdr.originalPitch
            : 60;

      // Coarse tune (oper 51, semitones) + Fine tune (oper 52, cents) + shdr.pitchCorrection (cents)
      const coarseSemis = getSignedGen(51, 0);
      const fineCents = getSignedGen(52, 0) + (shdr.pitchCorrection || 0);
      // Fold full semitone shifts into rootKey and remainder into detune (-99..+99)
      const extraSemis = Math.trunc(fineCents / 100);
      const remCents = Math.max(-99, Math.min(99, Math.round(fineCents - extraSemis * 100)));
      const effectiveRootKey = Math.max(0, Math.min(127, rawRoot - coarseSemis - extraSemis));

      // Attenuation (oper 48, centibels: 10 cB = 1 dB, SF2 attenuation is positive for quieter)
      const attenCb = Math.max(0, getSignedGen(48, 0));
      // SF2 standard conversion: 10 cB = 0.4 real dB (or -attenCb / 25)
      const volumeDb = Math.max(-32, Math.min(12, Math.round(-attenCb / 25)));

      // Pan (oper 17, -500..+500 tenth-percent)
      const panRaw = Math.max(-500, Math.min(500, getSignedGen(17, 0)));

      // Scale tuning (oper 56, cents/key, default 100)
      const pitchKeytrack = Math.max(0, Math.min(100, getSignedGen(56, 100)));

      // Sample modes (oper 54): 0 = no_loop, 1 = loop_continuous, 3 = loop_sustain
      const modeVal = combined.has(54) ? combined.get(54)!.uAmount & 3 : 0;
      const loopMode: LoopMode =
        modeVal === 1 ? 'loop_continuous' : modeVal === 3 ? 'loop_sustain' : 'no_loop';

      // Sample frame address offsets
      const startOff = getSignedGen(0, 0) + getSignedGen(4, 0) * 32768;
      const endOff = getSignedGen(1, 0) + getSignedGen(12, 0) * 32768;
      const startLoopOff = getSignedGen(2, 0) + getSignedGen(45, 0) * 32768;
      const endLoopOff = getSignedGen(3, 0) + getSignedGen(50, 0) * 32768;

      const startSample = Math.max(0, shdr.start + startOff);
      const endSample = Math.max(startSample + 1, shdr.end + endOff);
      const startLoopSample = Math.max(startSample, shdr.startLoop + startLoopOff);
      const endLoopSample = Math.max(startLoopSample, Math.min(endSample, shdr.endLoop + endLoopOff));

      rawZones.push({
        sampleId,
        shdr,
        lowKey,
        highKey,
        lowVel,
        highVel,
        rootKey: effectiveRootKey,
        detuneCents: remCents,
        volumeDb,
        pan: panRaw,
        pitchKeytrack,
        loopMode,
        startSample,
        endSample,
        startLoopSample,
        endLoopSample,
        gens: combined,
      });
    }
  };

  if (pIdx < sf2.phdrs.length - 1) {
    const p = sf2.phdrs[pIdx];
    const nextP = sf2.phdrs[pIdx + 1];
    const presetGlobalOffsets = new Map<number, number>();
    let presetGlobalKeyLo = 0;
    let presetGlobalKeyHi = 127;
    let presetGlobalVelLo = 1;
    let presetGlobalVelHi = 127;

    for (let bIdx = p.pbagNdx; bIdx < nextP.pbagNdx && bIdx + 1 < sf2.pbags.length; bIdx++) {
      const gStart = sf2.pbags[bIdx].genNdx;
      const gEnd = sf2.pbags[bIdx + 1].genNdx;
      const localMap = new Map<number, GenRecord>();
      for (let g = gStart; g < gEnd && g < sf2.pgens.length; g++) {
        localMap.set(sf2.pgens[g].oper, sf2.pgens[g]);
      }

      if (!localMap.has(41)) {
        if (bIdx === p.pbagNdx) {
          for (const [op, rec] of localMap.entries()) {
            if (op === 43) {
              presetGlobalKeyLo = rec.lo;
              presetGlobalKeyHi = rec.hi;
            } else if (op === 44) {
              presetGlobalVelLo = rec.lo;
              presetGlobalVelHi = rec.hi;
            } else {
              presetGlobalOffsets.set(op, rec.sAmount);
            }
          }
        }
        continue;
      }

      const instId = localMap.get(41)!.uAmount;
      const keyLo = localMap.has(43) ? localMap.get(43)!.lo : presetGlobalKeyLo;
      const keyHi = localMap.has(43) ? localMap.get(43)!.hi : presetGlobalKeyHi;
      const velLo = localMap.has(44) ? localMap.get(44)!.lo : presetGlobalVelLo;
      const velHi = localMap.has(44) ? localMap.get(44)!.hi : presetGlobalVelHi;

      const mergedOffsets = new Map<number, number>(presetGlobalOffsets);
      for (const [op, rec] of localMap.entries()) {
        if (op !== 41 && op !== 43 && op !== 44) {
          mergedOffsets.set(op, (mergedOffsets.get(op) ?? 0) + rec.sAmount);
        }
      }

      collectInstrumentZones(instId, keyLo, keyHi, velLo, velHi, mergedOffsets);
    }
  }

  if (rawZones.length === 0 && sf2.insts.length > 1) {
    collectInstrumentZones(Math.min(pIdx, sf2.insts.length - 2), 0, 127, 1, 127, new Map());
  }

  // ── Extract global SynthArticulationConfig from average/first zone generators ──
  const articulation = createDefaultArticulation();
  if (rawZones.length > 0) {
    const refGens = rawZones[0].gens;
    const getGenS = (op: number, defVal: number) => (refGens.has(op) ? refGens.get(op)!.sAmount : defVal);

    // 1. Amplitude Envelope (VolEnv: ops 33..38)
    const hasCustomVolEnv =
      refGens.has(33) || refGens.has(34) || refGens.has(35) || refGens.has(36) || refGens.has(37) || refGens.has(38);
    const delayV = timecentsToSeconds(getGenS(33, -12000), 0, 10);
    const attackV = timecentsToSeconds(getGenS(34, -12000), 0.002, 12);
    const holdV = timecentsToSeconds(getGenS(35, -12000), 0, 10);
    const decayV = timecentsToSeconds(getGenS(36, -12000), 0.005, 15);
    const sustainCb = Math.max(0, Math.min(1000, getGenS(37, 0)));
    const sustainLevel = Math.max(0, Math.min(1, 1 - sustainCb / 1000));
    const releaseV = timecentsToSeconds(getGenS(38, -12000), 0.01, 15);

    articulation.ampEnv = {
      delaySec: Number(delayV.toFixed(4)),
      attackSec: Number(attackV.toFixed(4)),
      holdSec: Number(holdV.toFixed(4)),
      decaySec: Number(decayV.toFixed(4)),
      sustainLevel: Number(sustainLevel.toFixed(3)),
      releaseSec: Number(releaseV.toFixed(4)),
    };
    articulation.ampEnvEnabled = Boolean(hasCustomVolEnv);

    // 2. Modulation Envelope (ModEnv: ops 25..30, 7, 11)
    const modToPitch = getGenS(7, 0);
    const modToFilter = getGenS(11, 0);
    const hasModEnv =
      refGens.has(25) || refGens.has(26) || refGens.has(27) || refGens.has(28) || refGens.has(29) || refGens.has(30) ||
      Math.abs(modToPitch) > 0 || Math.abs(modToFilter) > 0;
    articulation.modEnv = {
      delaySec: Number(timecentsToSeconds(getGenS(25, -12000), 0, 10).toFixed(4)),
      attackSec: Number(timecentsToSeconds(getGenS(26, -12000), 0.002, 12).toFixed(4)),
      holdSec: Number(timecentsToSeconds(getGenS(27, -12000), 0, 10).toFixed(4)),
      decaySec: Number(timecentsToSeconds(getGenS(28, -12000), 0.005, 15).toFixed(4)),
      sustainLevel: Number(Math.max(0, Math.min(1, 1 - Math.max(0, Math.min(1000, getGenS(29, 0))) / 1000)).toFixed(3)),
      releaseSec: Number(timecentsToSeconds(getGenS(30, -12000), 0.01, 15).toFixed(4)),
    };
    articulation.modEnvToPitchCents = modToPitch;
    articulation.modEnvEnabled = Boolean(hasModEnv && (Math.abs(modToPitch) > 0 || Math.abs(modToFilter) > 0));

    // 3. Filter (ops 8 = initialFilterFc in abs cents, 9 = initialFilterQ in cB)
    const filterFcCents = getGenS(8, 13500);
    const filterQCb = Math.max(0, getGenS(9, 0));
    const cutoffHz = absCentsToHz(filterFcCents, 20, 20000);
    const filterActive = filterFcCents < 13400 || filterQCb > 0 || Math.abs(modToFilter) > 0;
    articulation.filter = {
      enabled: filterActive,
      type: 'lpf',
      cutoffHz: Math.round(cutoffHz),
      resonanceDb: Number((filterQCb / 10).toFixed(1)),
      envToFilterCents: modToFilter,
      velToFilterCents: 0,
      keytrackCents: 0,
    };

    // 4. Vibrato LFO (ops 23 = delayVibLFO, 24 = freqVibLFO, 6 = vibLfoToPitch)
    const vibPitch = getGenS(6, 0);
    articulation.vibLfo = {
      enabled: Math.abs(vibPitch) > 0,
      delaySec: Number(timecentsToSeconds(getGenS(23, -12000), 0, 10).toFixed(3)),
      freqHz: Number(absCentsToHz(getGenS(24, 0), 0.05, 50).toFixed(2)),
      toPitchCents: vibPitch,
      toFilterCents: 0,
      toVolumeDb: 0,
      waveform: 0,
    };

    // 5. Modulation LFO (ops 21 = delayModLFO, 22 = freqModLFO, 5 = modLfoToPitch, 10 = modLfoToFilterFc, 13 = modLfoToVolume)
    const modLfoPitch = getGenS(5, 0);
    const modLfoFilter = getGenS(10, 0);
    const modLfoVolCb = getGenS(13, 0);
    articulation.modLfo = {
      enabled: Math.abs(modLfoPitch) > 0 || Math.abs(modLfoFilter) > 0 || Math.abs(modLfoVolCb) > 0,
      delaySec: Number(timecentsToSeconds(getGenS(21, -12000), 0, 10).toFixed(3)),
      freqHz: Number(absCentsToHz(getGenS(22, 0), 0.05, 50).toFixed(2)),
      toPitchCents: modLfoPitch,
      toFilterCents: modLfoFilter,
      toVolumeDb: Number((modLfoVolCb / 10).toFixed(2)),
      waveform: 0,
    };
  }

  // ── Merge Linked Left/Right Stereo Sample Pairs & Encode WAVs ──────────
  const consumed = new Set<number>();
  const audioFiles: AudioFilePayload[] = [];
  const encodedByKey = new Map<string, string>();
  const extendedRegions: ExtendedRegion[] = [];
  let regionSeq = 1;

  for (let i = 0; i < rawZones.length; i++) {
    if (consumed.has(i)) continue;
    const zA = rawZones[i];

    // Look for a stereo partner zone with identical keyRange, velRange, and rootKey
    let partnerIdx = -1;
    for (let j = i + 1; j < rawZones.length; j++) {
      if (consumed.has(j)) continue;
      const zB = rawZones[j];
      if (
        zA.lowKey === zB.lowKey &&
        zA.highKey === zB.highKey &&
        zA.lowVel === zB.lowVel &&
        zA.highVel === zB.highVel &&
        zA.rootKey === zB.rootKey
      ) {
        const linkedByHeader =
          (zA.shdr.sampleLink === zB.sampleId || zB.shdr.sampleLink === zA.sampleId) &&
          ((zA.shdr.sampleType & 6) !== 0 || (zB.shdr.sampleType & 6) !== 0);
        const linkedByOppositePan =
          (zA.pan <= -200 && zB.pan >= 200) || (zA.pan >= 200 && zB.pan <= -200);
        if (linkedByHeader || linkedByOppositePan) {
          partnerIdx = j;
          break;
        }
      }
    }

    if (partnerIdx >= 0) {
      consumed.add(i);
      consumed.add(partnerIdx);
      const zB = rawZones[partnerIdx];
      const isALeft =
        (zA.shdr.sampleType & 4) !== 0 ||
        (zB.shdr.sampleType & 2) !== 0 ||
        zA.pan < zB.pan;
      const leftZ = isALeft ? zA : zB;
      const rightZ = isALeft ? zB : zA;

      const pairCacheKey = `stereo::${leftZ.sampleId}::${rightZ.sampleId}::${leftZ.startSample}-${leftZ.endSample}`;
      let wavName = encodedByKey.get(pairCacheKey);

      const leftCh = extractSampleFloat32(
        view,
        sf2.smplOffset,
        sf2.smplByteLength,
        leftZ.startSample,
        leftZ.endSample,
      );
      const rightRaw = extractSampleFloat32(
        view,
        sf2.smplOffset,
        sf2.smplByteLength,
        rightZ.startSample,
        rightZ.endSample,
      );
      // Match channel frame lengths if slightly different
      let rightCh = rightRaw;
      if (rightRaw.length !== leftCh.length) {
        rightCh = new Float32Array(leftCh.length);
        rightCh.set(rightRaw.subarray(0, Math.min(leftCh.length, rightRaw.length)));
      }

      const sampleRate = leftZ.shdr.sampleRate || 44100;
      if (!wavName) {
        wavName = deriveStereoPairBaseName(leftZ.shdr.name, rightZ.shdr.name, regionSeq);
        // Ensure uniqueness
        if (audioFiles.some((f) => f.name.toLowerCase() === wavName!.toLowerCase())) {
          wavName = wavName.replace(/\.wav$/i, `_${regionSeq}.wav`);
        }
        const wavBuffer = encodeWavPcm16([leftCh, rightCh], sampleRate, {
          rootKey: leftZ.rootKey,
          detune: leftZ.detuneCents,
          lowKey: leftZ.lowKey,
          highKey: leftZ.highKey,
          lowVelocity: leftZ.lowVel,
          highVelocity: leftZ.highVel,
          gainDb: leftZ.volumeDb,
        });
        audioFiles.push({ name: wavName, buffer: wavBuffer });
        encodedByKey.set(pairCacheKey, wavName);
      }

      const relLoopStart = Math.max(0, leftZ.startLoopSample - leftZ.startSample);
      const relLoopEnd = Math.max(relLoopStart, Math.min(leftCh.length, leftZ.endLoopSample - leftZ.startSample));

      extendedRegions.push({
        id: `ext-reg-${regionSeq++}`,
        sampleName: wavName,
        lowKey: leftZ.lowKey,
        highKey: leftZ.highKey,
        rootKey: leftZ.rootKey,
        lowVel: leftZ.lowVel,
        highVel: leftZ.highVel,
        detune: leftZ.detuneCents,
        volume: Math.round((leftZ.volumeDb + rightZ.volumeDb) * 0.5),
        pan: Math.max(-50, Math.min(50, Math.round((leftZ.pan + rightZ.pan) / 20))),
        pitchKeytrack: leftZ.pitchKeytrack,
        trigger: 'attack',
        keyFadeIn: 0,
        keyFadeOut: 0,
        velFadeIn: 0,
        velFadeOut: 0,
        fadeCurve: 'equal-power',
        loopMode: leftZ.loopMode,
        loopStart: relLoopStart,
        loopEnd: relLoopEnd,
        loopCrossfadeMs: 0,
        sampleRate,
        numChannels: 2,
      });
    } else {
      consumed.add(i);
      const monoCacheKey = `mono::${zA.sampleId}::${zA.startSample}-${zA.endSample}`;
      let wavName = encodedByKey.get(monoCacheKey);
      const monoCh = extractSampleFloat32(
        view,
        sf2.smplOffset,
        sf2.smplByteLength,
        zA.startSample,
        zA.endSample,
      );
      const sampleRate = zA.shdr.sampleRate || 44100;

      if (!wavName) {
        wavName = sanitizeSampleFileName(zA.shdr.name, regionSeq);
        if (audioFiles.some((f) => f.name.toLowerCase() === wavName!.toLowerCase())) {
          wavName = wavName.replace(/\.wav$/i, `_${regionSeq}.wav`);
        }
        const wavBuffer = encodeWavPcm16([monoCh], sampleRate, {
          rootKey: zA.rootKey,
          detune: zA.detuneCents,
          lowKey: zA.lowKey,
          highKey: zA.highKey,
          lowVelocity: zA.lowVel,
          highVelocity: zA.highVel,
          gainDb: zA.volumeDb,
        });
        audioFiles.push({ name: wavName, buffer: wavBuffer });
        encodedByKey.set(monoCacheKey, wavName);
      }

      const relLoopStart = Math.max(0, zA.startLoopSample - zA.startSample);
      const relLoopEnd = Math.max(relLoopStart, Math.min(monoCh.length, zA.endLoopSample - zA.startSample));

      extendedRegions.push({
        id: `ext-reg-${regionSeq++}`,
        sampleName: wavName,
        lowKey: zA.lowKey,
        highKey: zA.highKey,
        rootKey: zA.rootKey,
        lowVel: zA.lowVel,
        highVel: zA.highVel,
        detune: zA.detuneCents,
        volume: zA.volumeDb,
        pan: Math.max(-50, Math.min(50, Math.round(zA.pan / 10))),
        pitchKeytrack: zA.pitchKeytrack,
        trigger: 'attack',
        keyFadeIn: 0,
        keyFadeOut: 0,
        velFadeIn: 0,
        velFadeOut: 0,
        fadeCurve: 'equal-power',
        loopMode: zA.loopMode,
        loopStart: relLoopStart,
        loopEnd: relLoopEnd,
        loopCrossfadeMs: 0,
        sampleRate,
        numChannels: 1,
      });
    }
  }

  // Sort extendedRegions by lowKey, then lowVel
  extendedRegions.sort((a, b) => a.lowKey - b.lowKey || a.lowVel - b.lowVel);

  const { zones: classicZones, velocityLayerGainCompensation } =
    projectExtendedRegionsToClassicZones(extendedRegions);

  const presetName = chosenOption.name || 'SF2 Preset';
  const modelName = presetName.replace(/\s+/g, ' ').trim().slice(0, 11) || 'SF2Model';
  const classification = classifyInstrumentAndParameterSet(presetName);

  return {
    sourceFormat: 'sf2',
    presetName,
    modelName,
    detectedCategory: classification.category,
    suggestedParameterSet: classification.parameterSet,
    audioFiles,
    extendedRegions,
    classicZones,
    velocityLayerGainCompensation,
    articulation,
  };
}
