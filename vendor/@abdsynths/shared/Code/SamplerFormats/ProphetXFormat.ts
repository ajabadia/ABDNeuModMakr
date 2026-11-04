// ─────────────────────────────────────────────────────────
// ABDShared / ABDNeuModMakr — Sequential Prophet X / XL Format (.grp in .zip)
//
// Clean-room TypeScript parser & writer for Sequential Prophet X
// multisample instruments (.grp TSV definition + 48kHz WAV audio in .zip).
// Contrasted with ConvertWithMoss ProphetX*.
//
// Header Columns (tab-separated):
// File Path \t Low Midi Note \t High Midi Note \t Low Velocity \t High Velocity \t
// Loop Start \t Loop End \t Round Robin Number \t Pitch in Hertz \t Mono Pitch \t
// Stereo/Mono File \t Category \t Instrument Name \t Mono Collapse \t UUID
// ─────────────────────────────────────────────────────────

import type { ExtendedRegion, SynthArticulationConfig, SampleLoopDescriptor } from './SamplerTypes.ts';
import { createDefaultArticulation } from './ExtendedAdapter.ts';
import { indexZipArchive, extractZipEntry } from '../NeuronFormats/ZipArchive.ts';
import { toArrayBuffer } from './BytesUtil.ts';

export const PROPHET_X_SAMPLE_RATE = 48000;

export const PROPHET_X_COLUMNS = [
  'File Path',
  'Low Midi Note',
  'High Midi Note',
  'Low Velocity',
  'High Velocity',
  'Loop Start',
  'Loop End',
  'Round Robin Number',
  'Pitch in Hertz',
  'Mono Pitch',
  'Stereo/Mono File',
  'Category',
  'Instrument Name',
  'Mono Collapse',
  'UUID',
];

export function midiNoteToHz(note: number, tuneCents: number = 0): number {
  return 440.0 * Math.pow(2.0, (note - 69 + tuneCents / 100.0) / 12.0);
}

export function hzToMidiNoteAndCents(hz: number): { note: number; cents: number } {
  if (hz <= 0) return { note: 60, cents: 0 };
  const semitones = 69 + 12 * Math.log2(hz / 440.0);
  const note = Math.round(semitones);
  const cents = Math.round((semitones - note) * 100);
  return { note, cents };
}

export function isProphetXGroupText(text: string): boolean {
  return text.includes('File Path') && text.includes('Low Midi Note') && text.includes('Pitch in Hertz');
}

export function parseProphetXGroupText(
  grpText: string,
  _audioPool?: Map<string, ArrayBuffer>
): {
  presetName: string;
  regions: ExtendedRegion[];
  articulation: SynthArticulationConfig;
} {
  const lines = grpText.split(/\r?\n/);
  if (lines.length < 2) {
    throw new Error('Invalid Prophet X group file: empty or no data rows');
  }

  const headerParts = lines[0].split('\t').map((h) => h.trim());
  const colMap = new Map<string, number>();
  for (let i = 0; i < headerParts.length; i++) {
    colMap.set(headerParts[i], i);
  }

  const getCol = (parts: string[], colName: string, defVal: string = ''): string => {
    const idx = colMap.get(colName);
    return idx !== undefined && idx < parts.length ? parts[idx].trim() : defVal;
  };

  let presetName = 'ProphetXInstrument';
  const regions: ExtendedRegion[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('\t');
    if (parts.length < 5) continue;

    const filePath = getCol(parts, 'File Path');
    if (!filePath || filePath.toLowerCase() === 'silence.wav') continue;

    const instName = getCol(parts, 'Instrument Name');
    if (instName) presetName = instName;

    const cleanName = filePath.split('/').pop()?.split('\\').pop() || filePath;
    const lowNote = parseInt(getCol(parts, 'Low Midi Note', '0'), 10);
    const highNote = parseInt(getCol(parts, 'High Midi Note', '127'), 10);
    const lowVel = parseInt(getCol(parts, 'Low Velocity', '1'), 10);
    const highVel = parseInt(getCol(parts, 'High Velocity', '127'), 10);

    const pitchHz = parseFloat(getCol(parts, 'Pitch in Hertz', '440.0'));
    const { note: rootNote, cents: tuneCents } = hzToMidiNoteAndCents(pitchHz);

    const loopStartStr = getCol(parts, 'Loop Start', '-1');
    const loopEndStr = getCol(parts, 'Loop End', '-1');
    const loopStart = parseInt(loopStartStr, 10);
    const loopEnd = parseInt(loopEndStr, 10);

    const loops: SampleLoopDescriptor[] = [];
    if (loopStart >= 0 && loopEnd > loopStart) {
      loops.push({
        mode: 'loop_continuous',
        startFrame: loopStart,
        endFrame: loopEnd,
      });
    }

    regions.push({
      id: `px_r_${regions.length + 1}`,
      sampleName: cleanName,
      rootKey: rootNote,
      lowKey: Math.max(0, lowNote),
      highKey: Math.min(127, highNote),
      lowVel: Math.max(1, lowVel),
      highVel: Math.min(127, highVel),
      volume: 0,
      pan: 0,
      detune: tuneCents,
      pitchKeytrack: 100,
      trigger: 'attack',
      keyFadeIn: 0,
      keyFadeOut: 0,
      velFadeIn: 0,
      velFadeOut: 0,
      fadeCurve: 'equal-power',
      loopMode: loops.length > 0 ? loops[0].mode : 'no_loop',
      loopStart: loops.length > 0 ? loops[0].startFrame : 0,
      loopEnd: loops.length > 0 ? loops[0].endFrame : 0,
      loopCrossfadeMs: 0,
      loops: loops.length > 0 ? loops : undefined,
    });
  }

  return {
    presetName,
    regions,
    articulation: createDefaultArticulation(),
  };
}

export function buildProphetXGroupText(options: {
  presetName: string;
  category?: string;
  regions: ExtendedRegion[];
}): string {
  const lines: string[] = [PROPHET_X_COLUMNS.join('\t')];
  const cat = options.category || 'Synth';
  const instName = options.presetName.slice(0, 63);
  const uuid = '00000000000000000000000000000000';

  for (const reg of options.regions) {
    const filename = reg.sampleName.endsWith('.wav') ? reg.sampleName : `${reg.sampleName}.wav`;
    const lowNote = reg.lowKey;
    const highNote = reg.highKey;
    const lowVel = reg.lowVel;
    const highVel = reg.highVel;

    let lStart = -1;
    let lEnd = -1;
    if (reg.loops && reg.loops.length > 0) {
      lStart = reg.loops[0].startFrame;
      lEnd = reg.loops[0].endFrame;
    }

    const hz = midiNoteToHz(reg.rootKey, reg.detune).toFixed(2);
    const rr = 1;
    const monoPitch = 0;
    const isStereo = 1;
    const monoCollapse = 0;

    const row = [
      filename,
      lowNote.toString(),
      highNote.toString(),
      lowVel.toString(),
      highVel.toString(),
      lStart.toString(),
      lEnd.toString(),
      rr.toString(),
      hz,
      monoPitch.toString(),
      isStereo.toString(),
      cat,
      instName,
      monoCollapse.toString(),
      uuid,
    ];

    lines.push(row.join('\t'));
  }

  return lines.join('\n');
}

export function importProphetXZip(zipBuffer: ArrayBuffer): {
  presetName: string;
  regions: ExtendedRegion[];
  articulation: SynthArticulationConfig;
  audioBuffers: Map<string, ArrayBuffer>;
} {
  const zipBytes = new Uint8Array(zipBuffer);
  const central = indexZipArchive(zipBytes);
  const audioBuffers = new Map<string, ArrayBuffer>();
  let grpEntry: (typeof central)[0] | undefined;

  for (const entry of central) {
    const low = entry.path.toLowerCase();
    if (low.endsWith('.grp')) {
      grpEntry = entry;
    } else if (low.endsWith('.wav') || low.endsWith('.flac')) {
      const data = extractZipEntry(zipBytes, entry);
      const name = entry.path.split('/').pop() || entry.path;
      audioBuffers.set(name, toArrayBuffer(data));
    }
  }

  if (!grpEntry) {
    throw new Error('No .grp definition found in Prophet X package');
  }

  const grpBytes = extractZipEntry(zipBytes, grpEntry);
  const grpText = new TextDecoder('utf-8').decode(grpBytes);
  const parsed = parseProphetXGroupText(grpText, audioBuffers);

  return {
    presetName: parsed.presetName,
    regions: parsed.regions,
    articulation: parsed.articulation,
    audioBuffers,
  };
}
