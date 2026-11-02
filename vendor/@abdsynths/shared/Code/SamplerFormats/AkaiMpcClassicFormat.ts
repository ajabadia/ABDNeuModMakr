// ─────────────────────────────────────────────────────────
// @abdsynths/shared — Akai MPC Classic Series (.pgm, .set, .snd, Gotek Disk Images)
//
// High-fidelity clean-room parser for Akai MPC legacy drum machines:
//   - MPC2000 / MPC2000XL (.pgm binary program + .snd samples + Gotek floppy images)
//   - MPC1000 / MPC2500 / MPC500 (.pgm binary program with 'MPC1000 PGM 1.00')
//   - MPC60 / MPC60 II (.set binary drum set + 12-bit non-linear PCM)
// ─────────────────────────────────────────────────────────

import { pcm16ToWavBuffer } from './PcmWavHelper.ts';
import type { ParsedImportRegion, ParsedSamplerPreset } from './rawSamplerParsers.ts';

export interface MpcClassicZone {
  sampleName: string;
  padIndex: number;
  midiNote: number;
  lowVel: number;
  highVel: number;
  tuningCents: number;
  volumeDb: number;
  pan: number; // -50..+50
  attack: number;
  decay: number;
  filterCutoff: number;
  filterResonance: number;
}

export interface MpcClassicProgram {
  name: string;
  model: 'mpc2000' | 'mpc2000xl' | 'mpc1000' | 'mpc60';
  zones: MpcClassicZone[];
  samples: Map<string, ArrayBuffer>;
}

function readAscii(buf: Uint8Array, offset: number, length: number): string {
  if (offset + length > buf.length) length = Math.max(0, buf.length - offset);
  let str = '';
  for (let i = 0; i < length; i++) {
    const c = buf[offset + i];
    if (c === 0) break;
    str += String.fromCharCode(c);
  }
  return str.trim();
}

function readU16LE(buf: Uint8Array, offset: number): number {
  return buf[offset] | (buf[offset + 1] << 8);
}

function readI16LE(buf: Uint8Array, offset: number): number {
  const v = readU16LE(buf, offset);
  return v > 32767 ? v - 65536 : v;
}

function readU32LE(buf: Uint8Array, offset: number): number {
  return (
    buf[offset] |
    (buf[offset + 1] << 8) |
    (buf[offset + 2] << 16) |
    ((buf[offset + 3] << 24) >>> 0)
  );
}

export function isMpcDiskImage(data: ArrayBuffer | Uint8Array): boolean {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (buf.length < 512) return false;
  if (buf[0] === 0xeb && buf[1] === 0xfe && buf[2] === 0x90) {
    const tag = readAscii(buf, 3, 8);
    if (tag.startsWith('MPC2000') || tag.startsWith('MPC2K')) return true;
  }
  return false;
}

export function isMpc1000Pgm(data: ArrayBuffer | Uint8Array): boolean {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (buf.length < 24) return false;
  const magic = readAscii(buf, 4, 16);
  return magic === 'MPC1000 PGM 1.00';
}

export function isMpc2000Pgm(data: ArrayBuffer | Uint8Array): boolean {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (buf.length < 64) return false;
  return buf[0] === 0x07 && (buf[1] === 0x04 || buf[1] === 0x00);
}

export function isMpc60Set(data: ArrayBuffer | Uint8Array): boolean {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (buf.length < 32 * 0x3b + 0xc00) return false;
  return buf[0] === 0x02;
}

export function unpackMpc60Audio(input: Uint8Array): Int16Array {
  const numFrames = Math.floor((input.length / 3) * 2);
  const out = new Int16Array(numFrames);
  let src = 0;
  let dst = 0;

  while (src + 2 < input.length && dst + 1 < numFrames) {
    const b0 = input[src];
    const b1 = input[src + 1];
    const b2 = input[src + 2];
    src += 3;

    let s1 = (b0 << 4) | (b1 >> 4);
    if (s1 >= 2048) s1 -= 4096;
    out[dst++] = s1 << 4;

    let s2 = ((b1 & 0x0f) << 8) | b2;
    if (s2 >= 2048) s2 -= 4096;
    out[dst++] = s2 << 4;
  }

  return out;
}

export function parseMpc1000Program(
  data: ArrayBuffer | Uint8Array,
  progName: string = 'MPC1000 Program'
): MpcClassicProgram {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  const zones: MpcClassicZone[] = [];
  const samples = new Map<string, ArrayBuffer>();

  let offset = 24;
  const pads: Array<{
    samples: Array<{ name: string; lowVel: number; highVel: number; tune: number }>;
    filterCutoff: number;
    filterResonance: number;
    attack: number;
    decay: number;
  }> = [];

  for (let p = 0; p < 64 && offset < buf.length; p++) {
    const pSamples: Array<{ name: string; lowVel: number; highVel: number; tune: number }> = [];
    for (let s = 0; s < 4; s++) {
      const sName = readAscii(buf, offset, 16);
      const tune = readI16LE(buf, offset + 16);
      const lowVel = buf[offset + 18];
      const highVel = buf[offset + 19];
      offset += 32;
      if (sName.length > 0) {
        pSamples.push({ name: sName, lowVel, highVel, tune });
      }
    }
    const attack = buf[offset + 2];
    const decay = buf[offset + 3];
    const cutoff = buf[offset + 4];
    const reso = buf[offset + 5];
    offset += 64;

    pads.push({
      samples: pSamples,
      filterCutoff: cutoff,
      filterResonance: reso,
      attack,
      decay,
    });
  }

  const midiNotes = new Uint8Array(64);
  if (offset + 64 <= buf.length) {
    midiNotes.set(buf.subarray(offset, offset + 64));
    offset += 64;
  }

  for (let p = 0; p < pads.length; p++) {
    const pad = pads[p];
    const midiNote = midiNotes[p] || (35 + p);
    for (const s of pad.samples) {
      zones.push({
        sampleName: s.name,
        padIndex: p,
        midiNote,
        lowVel: s.lowVel || 0,
        highVel: s.highVel || 127,
        tuningCents: s.tune,
        volumeDb: 0,
        pan: 0,
        attack: (pad.attack / 100) * 2.0,
        decay: (pad.decay / 100) * 2.0,
        filterCutoff: Math.round(40 * Math.pow(20000 / 40, (pad.filterCutoff || 100) / 100)),
        filterResonance: (pad.filterResonance || 0) / 100.0,
      });
    }
  }

  return {
    name: progName.replace(/\.pgm$/i, ''),
    model: 'mpc1000',
    zones,
    samples,
  };
}

export function parseMpc2000Program(
  data: ArrayBuffer | Uint8Array,
  progName: string = 'MPC2000 Program'
): MpcClassicProgram {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  const sampleNames: string[] = [];
  const zones: MpcClassicZone[] = [];
  const samples = new Map<string, ArrayBuffer>();

  const isMpc3000 = buf[1] === 0x00;
  const numSamples = isMpc3000 ? 64 : readU16LE(buf, 2);
  let offset = 4;

  for (let i = 0; i < numSamples && offset + 17 <= buf.length; i++) {
    const name = readAscii(buf, offset, 16);
    sampleNames.push(name);
    offset += 17;
  }

  if (isMpc3000) {
    offset = 2690;
  } else {
    offset += 18;
  }
  const readName = readAscii(buf, offset, 16);
  const finalName = readName.length > 0 ? readName : progName.replace(/\.pgm$/i, '');
  offset += 18;
  offset += 40;

  const padEntries: Array<{
    sampleIdx: number;
    tune: number;
    attack: number;
    decay: number;
    cutoff: number;
    reso: number;
  }> = [];

  for (let p = 0; p < 64 && offset + 16 <= buf.length; p++) {
    const sampleIdx = buf[offset];
    const tune = readI16LE(buf, offset + 2);
    const attack = buf[offset + 4];
    const decay = buf[offset + 5];
    const cutoff = buf[offset + 6];
    const reso = buf[offset + 7];
    offset += 16;
    padEntries.push({ sampleIdx, tune, attack, decay, cutoff, reso });
  }

  offset += 64 * 8;
  offset += 4;

  const midiNotes = new Uint8Array(64);
  if (offset + 64 <= buf.length) {
    midiNotes.set(buf.subarray(offset, offset + 64));
  }

  for (let p = 0; p < padEntries.length; p++) {
    const entry = padEntries[p];
    if (entry.sampleIdx > 0 && entry.sampleIdx <= sampleNames.length) {
      const sName = sampleNames[entry.sampleIdx - 1];
      const midiNote = midiNotes[p] || (35 + p);
      zones.push({
        sampleName: sName,
        padIndex: p,
        midiNote,
        lowVel: 0,
        highVel: 127,
        tuningCents: entry.tune,
        volumeDb: 0,
        pan: 0,
        attack: (entry.attack / 100) * 2.0,
        decay: (entry.decay / 100) * 2.0,
        filterCutoff: Math.round(40 * Math.pow(20000 / 40, (entry.cutoff || 100) / 100)),
        filterResonance: (entry.reso || 0) / 100.0,
      });
    }
  }

  return {
    name: finalName,
    model: 'mpc2000',
    zones,
    samples,
  };
}

export function parseMpc60Set(
  data: ArrayBuffer | Uint8Array,
  setName: string = 'MPC60 Drum Set'
): MpcClassicProgram {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  const zones: MpcClassicZone[] = [];
  const samples = new Map<string, ArrayBuffer>();

  const pads: Array<{
    name: string;
    midiNote: number;
    startFrame: number;
    lenFrames: number;
    tune: number;
    decay: number;
  }> = [];

  let offset = 5;
  for (let i = 0; i < 32 && offset + 59 <= buf.length; i++) {
    const padName = readAscii(buf, offset, 16);
    const midiNote = buf[offset + 16] || (35 + i);
    const startFrame = readU32LE(buf, offset + 20);
    const lenFrames = readU32LE(buf, offset + 24);
    const tune = readI16LE(buf, offset + 28);
    const decay = buf[offset + 32];
    offset += 59;

    pads.push({
      name: padName.length > 0 ? padName : `Pad_${i + 1}`,
      midiNote,
      startFrame,
      lenFrames,
      tune,
      decay,
    });
  }

  const sampleStart = 0xbff;
  if (buf.length > sampleStart) {
    const packedBytes = buf.subarray(sampleStart);
    const pcm16 = unpackMpc60Audio(packedBytes);

    for (const p of pads) {
      if (p.lenFrames > 0 && p.startFrame < pcm16.length) {
        const actualLen = Math.min(p.lenFrames, pcm16.length - p.startFrame);
        const padPcm = pcm16.subarray(p.startFrame, p.startFrame + actualLen);

        const wav = pcm16ToWavBuffer(padPcm, 40000);
        const sampleKey = `${p.name}.wav`;
        samples.set(sampleKey, wav);

        zones.push({
          sampleName: sampleKey,
          padIndex: zones.length,
          midiNote: p.midiNote,
          lowVel: 0,
          highVel: 127,
          tuningCents: p.tune,
          volumeDb: 0,
          pan: 0,
          attack: 0.001,
          decay: (p.decay / 100) * 3.0,
          filterCutoff: 20000,
          filterResonance: 0,
        });
      }
    }
  }

  return {
    name: setName.replace(/\.set$/i, ''),
    model: 'mpc60',
    zones,
    samples,
  };
}

export function convertMpcClassicToPreset(
  prog: MpcClassicProgram,
  samplePool?: Map<string, ArrayBuffer>
): ParsedSamplerPreset {
  const regions: ParsedImportRegion[] = [];
  const audioBuffers = new Map<string, ArrayBuffer>();

  for (const [k, v] of prog.samples.entries()) {
    audioBuffers.set(k, v);
  }

  for (const z of prog.zones) {
    let sRef = z.sampleName;
    if (!sRef.toLowerCase().endsWith('.wav') && !sRef.toLowerCase().endsWith('.snd')) {
      sRef += '.wav';
    }

    if (samplePool) {
      const found =
        samplePool.get(sRef) ||
        samplePool.get(sRef.toLowerCase()) ||
        samplePool.get(z.sampleName);
      if (found) {
        audioBuffers.set(sRef, found);
      }
    }

    regions.push({
      id: `mpc_${regions.length + 1}`,
      sampleName: sRef,
      samplePath: sRef,
      rootKey: z.midiNote,
      lowKey: z.midiNote,
      highKey: z.midiNote,
      lowVel: z.lowVel,
      highVel: z.highVel,
      detuneCents: z.tuningCents,
      volumeDb: z.volumeDb,
      pan: z.pan,
      loopMode: 'one_shot',
      loopStart: 0,
      loopEnd: 0,
    });
  }

  return {
    format: 'akai_disk',
    formatLabel: 'Akai MPC Classic Program',
    presetName: prog.name,
    modelName: prog.name.slice(0, 11),
    detectedCategory: 'drums',
    suggestedParameterSet: 0,
    regions,
    audioBuffers,
  };
}
