// ─────────────────────────────────────────────────────────
// ABDShared / ABDNeuModMakr — Expert Sleepers Disting EX Format (.dexpreset)
//
// Clean-room TypeScript parser & writer for Expert Sleepers Disting EX
// multisample presets (.dexpreset binary files + WAV samples).
// Contrasted with ConvertWithMoss DistingEx*.
//
// Header:
// - "DEXBPRST" (8 bytes)
// - fileVersion: int32 LE (1)
// - empty: 500 bytes (0x00)
// - presetVersion: int32 LE (0x14 = 20)
// - name: 16 bytes ASCII
// - parameters: 80 integers (4 bytes each)
//
// Sample Naming Convention:
// [prefix]_[Note]_SW[highKey-12]_V[velIndex]_RR[rrIndex].wav
// ─────────────────────────────────────────────────────────

import type { ExtendedRegion, SynthArticulationConfig, SampleLoopDescriptor } from './SamplerTypes.ts';
import { createDefaultArticulation } from './ExtendedAdapter.ts';
import { indexZipArchive, extractZipEntry } from '../NeuronFormats/ZipArchive.ts';
import { decodeWav } from '../NeuronFormats/WavAiffDecoder.ts';
import { toArrayBuffer } from './BytesUtil.ts';

export const DISTING_EX_TAG = 'DEXBPRST';

const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function noteToName(midiNote: number): string {
  const n = midiNote % 12;
  const oct = Math.floor(midiNote / 12) - 1;
  return `${NOTE_NAMES_SHARP[n]}${oct}`;
}

function nameToNote(name: string): number {
  const m = name.match(/^([A-Ga-g]#?)(-?\d+)$/);
  if (!m) return 60;
  const noteName = m[1].toUpperCase();
  const oct = parseInt(m[2], 10);
  const idx = NOTE_NAMES_SHARP.indexOf(noteName);
  return (oct + 1) * 12 + (idx >= 0 ? idx : 0);
}

export function isDistingExBuffer(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 528) return false;
  const u8 = new Uint8Array(buffer, 0, 8);
  const tag = String.fromCharCode(...u8);
  return tag === DISTING_EX_TAG;
}

export function parseDistingExPreset(
  buffer: ArrayBuffer,
  sampleNames: string[],
  audioPool?: Map<string, ArrayBuffer>
): {
  presetName: string;
  regions: ExtendedRegion[];
  articulation: SynthArticulationConfig;
} {
  const u8 = new Uint8Array(buffer);
  const decoder = new TextDecoder('ascii');

  // Verify tag
  const tag = decoder.decode(u8.subarray(0, 8));
  if (tag !== DISTING_EX_TAG) {
    throw new Error(`Invalid Disting EX header tag: ${tag}`);
  }

  // Name at offset 516 (16 bytes)
  const presetName = decoder.decode(u8.subarray(516, 532)).trim() || 'DistingPreset';

  // Parse sample filenames: Name_Note_SW[key]_V[vel]_RR[rr].wav
  const regions: ExtendedRegion[] = [];
  const regex = /^(.*)_([A-Ga-g]#?-?\d+)(?:_SW(\d+))?(?:_V(\d+))?(?:_RR?(\d+))?(?:\.wav)?$/i;

  for (let i = 0; i < sampleNames.length; i++) {
    const rawName = sampleNames[i];
    const cleanName = rawName.split('/').pop()?.split('\\').pop() || rawName;
    const baseName = cleanName.replace(/\.wav$/i, '');

    let rootNote = 60;
    let highKey = 127;

    const m = baseName.match(regex);
    if (m) {
      if (m[2]) rootNote = nameToNote(m[2]);
      if (m[3]) highKey = parseInt(m[3], 10) + 12; // C3 note offset
    }

    // Try reading embedded loops from audioPool if available
    const loops: SampleLoopDescriptor[] = [];
    if (audioPool && audioPool.has(cleanName)) {
      try {
        const decoded = decodeWav(audioPool.get(cleanName)!);
        if (decoded.instrument && decoded.instrument.loopStart !== undefined && decoded.instrument.loopEnd !== undefined) {
          loops.push({
            mode: 'loop_continuous',
            startFrame: decoded.instrument.loopStart,
            endFrame: decoded.instrument.loopEnd,
          });
        }
      } catch {
        // ignore
      }
    }

    regions.push({
      id: `dex_r_${i + 1}`,
      sampleName: cleanName,
      rootKey: rootNote,
      lowKey: 0,
      highKey: Math.min(127, highKey),
      lowVel: 1,
      highVel: 127,
      volume: 0,
      pan: 0,
      detune: 0,
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

  // Refine key ranges based on rootKey order
  regions.sort((a, b) => a.rootKey - b.rootKey);
  for (let i = 0; i < regions.length; i++) {
    const prev = i > 0 ? regions[i - 1].rootKey : 0;
    const cur = regions[i].rootKey;
    const next = i < regions.length - 1 ? regions[i + 1].rootKey : 127;

    regions[i].lowKey = i === 0 ? 0 : Math.floor((prev + cur) / 2) + 1;
    regions[i].highKey = i === regions.length - 1 ? 127 : Math.floor((cur + next) / 2);
  }

  return {
    presetName,
    regions,
    articulation: createDefaultArticulation(),
  };
}

export function buildDistingExBinary(options: {
  presetName: string;
  regions: ExtendedRegion[];
  articulation?: SynthArticulationConfig;
}): Uint8Array {
  // Binary size: 8 + 4 + 500 + 4 + 16 + 4 + 32 + 4 + (80 * 4) = 888 bytes
  const buf = new Uint8Array(1024);
  const view = new DataView(buf.buffer);
  const encoder = new TextEncoder();

  // "DEXBPRST"
  buf.set(encoder.encode(DISTING_EX_TAG), 0);
  view.setInt32(8, 1, true); // fileVersion = 1

  // offset 512: presetVersion = 0x14
  view.setInt32(512, 0x14, true);

  // Name (16 bytes padded)
  const namePadded = (options.presetName + '                ').slice(0, 16);
  buf.set(encoder.encode(namePadded), 516);

  // Algorithm = 2 (multisample) at offset 568
  view.setInt32(568, 2, true);

  // Parameters at offset 572
  // param 7: Attack (0..127)
  const a = Math.round(((options.articulation?.ampEnv?.attackSec ?? 0.01) / 5.0) * 127);
  const d = Math.round(((options.articulation?.ampEnv?.decaySec ?? 0.2) / 5.0) * 127);
  const s = Math.round((options.articulation?.ampEnv?.sustainLevel ?? 1.0) * 127);
  const r = Math.round(((options.articulation?.ampEnv?.releaseSec ?? 0.3) / 5.0) * 127);

  view.setInt32(572 + 7 * 4, Math.max(0, Math.min(127, a)), true);
  view.setInt32(572 + 8 * 4, Math.max(0, Math.min(127, d)), true);
  view.setInt32(572 + 9 * 4, Math.max(0, Math.min(127, s)), true);
  view.setInt32(572 + 10 * 4, Math.max(0, Math.min(127, r)), true);
  view.setInt32(572 + 17 * 4, options.articulation?.polyphony ?? 8, true); // max voices

  return buf.subarray(0, 892);
}

export function generateDistingExSampleFilename(
  prefix: string,
  rootNote: number,
  highKey: number,
  velLayerIndex: number = 1
): string {
  const noteStr = noteToName(rootNote);
  const sw = highKey - 12; // C3 note offset
  return `${prefix}_${noteStr}_SW${sw}_V${velLayerIndex}.wav`;
}

export function importDistingExZip(zipBuffer: ArrayBuffer): {
  presetName: string;
  regions: ExtendedRegion[];
  articulation: SynthArticulationConfig;
  audioBuffers: Map<string, ArrayBuffer>;
} {
  const zipBytes = new Uint8Array(zipBuffer);
  const central = indexZipArchive(zipBytes);
  const audioBuffers = new Map<string, ArrayBuffer>();
  const sampleNames: string[] = [];
  let dexEntry: (typeof central)[0] | undefined;

  for (const entry of central) {
    const low = entry.path.toLowerCase();
    if (low.endsWith('.dexpreset')) {
      dexEntry = entry;
    } else if (low.endsWith('.wav') || low.endsWith('.flac')) {
      const data = extractZipEntry(zipBytes, entry);
      const name = entry.path.split('/').pop() || entry.path;
      sampleNames.push(name);
      audioBuffers.set(name, toArrayBuffer(data));
    }
  }

  if (!dexEntry) {
    throw new Error('No .dexpreset found in package');
  }

  const dexBytes = extractZipEntry(zipBytes, dexEntry);
  const parsed = parseDistingExPreset(
    toArrayBuffer(dexBytes),
    sampleNames,
    audioBuffers
  );

  return {
    presetName: parsed.presetName,
    regions: parsed.regions,
    articulation: parsed.articulation,
    audioBuffers,
  };
}
