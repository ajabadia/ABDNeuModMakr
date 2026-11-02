// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Raw Multi-Format Sampler Parsers (Fase 18.8)
//
// High-fidelity importers for:
//   1. Decent Sampler (.dspreset XML / .zip)
//   2. Native Instruments Kontakt (.nki unencrypted XML / structured descriptor)
//   3. Steinberg HALion (.vstpreset XML / VST3 chunk container)
//   4. Bitwig Studio Multisample (.multisample / multisample.xml)
//   5. Linear Sample Chains (Octatrack / SP-404 / OP-1 RIFF cue & uniform slices)
//
// Symmetric counterpart to `RawSamplerExporter.ts`.
// ─────────────────────────────────────────────────────────

import { decodeWav, decodeAiff, encodeWavPcm16, type DecodedWav } from '../dsp/WavDecoder.ts';
import { parseSliceFile, parseWavSliceCues, type ParsedSliceMarker } from '../dsp/SliceFileParser.ts';
import { decompressRx2Audio, isRx2Buffer } from '../dsp/DwopDecompressor.ts';
import type { LoopMode } from '../types.ts';
import { parseZipArchive } from '../../formats/ZipArchive.ts';
import { parseMpcXpm, mpcGainToDb, type MpcProgram } from '../../formats/MpcXpmFormat.ts';

export type RawSamplerFormat =
  | 'dspreset'
  | 'nki'
  | 'vstpreset'
  | 'multisample'
  | 'samplechain'
  | 'sfz'
  | 'sf2'
  | 'xpm';

export interface ParsedImportRegion {
  id: string;
  sampleName: string;
  samplePath: string;
  rootKey: number;
  lowKey: number;
  highKey: number;
  lowVel: number;
  highVel: number;
  detuneCents: number;
  volumeDb: number;
  pan: number; // -50 .. +50
  loopMode: LoopMode;
  loopStart: number;
  loopEnd: number;
}

export interface ParsedSamplerPreset {
  format: RawSamplerFormat;
  formatLabel: string;
  presetName: string;
  modelName: string;
  detectedCategory: string;
  suggestedParameterSet: number;
  regions: ParsedImportRegion[];
  audioBuffers: Map<string, ArrayBuffer>;
  envelope?: { attack: number; decay: number; sustain: number; release: number };
  isEncrypted?: boolean;
  encryptionNotice?: string;
  isSliceChain?: boolean;
  sliceFrames?: number[];
  sliceMarkers?: ParsedSliceMarker[];
  /** Number of programs found in a multi-program container (e.g. Akai .xpn). */
  programCount?: number;
}

/**
 * Decodes XML string attribute or returns fallback.
 */
function getAttr(tag: string, attrName: string, fallback: string = ''): string {
  const match = tag.match(new RegExp(`${attrName}=["']([^"']*)["']`, 'i'));
  return match ? match[1] : fallback;
}

function getAttrNum(tag: string, attrName: string, fallback: number): number {
  const val = getAttr(tag, attrName);
  if (!val) return fallback;
  const num = parseFloat(val);
  return isNaN(num) ? fallback : num;
}

function parseNoteNumber(val: string | undefined, fallback: number = 60): number {
  if (!val) return fallback;
  const trimmed = val.trim();
  if (/^-?\d+$/.test(trimmed)) {
    return Math.max(0, Math.min(127, parseInt(trimmed, 10)));
  }
  // Named note e.g. "C4", "F#3", "Bb2"
  const offsets: Record<string, number> = {
    c: 0, 'c#': 1, db: 1, d: 2, 'd#': 3, eb: 3, e: 4, f: 5,
    'f#': 6, gb: 6, g: 7, 'g#': 8, ab: 8, a: 9, 'a#': 10, bb: 10, b: 11
  };
  const m = /^([a-g][#b]?)(-?\d+)$/i.exec(trimmed);
  if (!m) return fallback;
  const semi = offsets[m[1].toLowerCase()];
  if (semi === undefined) return fallback;
  const oct = parseInt(m[2], 10);
  return Math.max(0, Math.min(127, (oct + 1) * 12 + semi));
}

function cleanBasename(filename: string): string {
  const parts = filename.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || filename;
}

function classifyPresetCategory(name: string): { category: string; parameterSet: number } {
  const lower = name.toLowerCase();
  if (/violin|viola|cello|string|strad|bow/i.test(lower)) return { category: 'Strings', parameterSet: 1 };
  if (/piano|rhodes|wurlitzer|clav|keys|organ/i.test(lower)) return { category: 'Piano & Keys', parameterSet: 2 };
  if (/guitar|bass|fret|pluck|slap/i.test(lower)) return { category: 'Guitar & Bass', parameterSet: 4 };
  if (/flute|sax|reed|wind|pipe|duduk|horn|trumpet|brass/i.test(lower)) return { category: 'Winds & Brass', parameterSet: 5 };
  if (/choir|vocal|voice|chant|choral/i.test(lower)) return { category: 'Vocal & Choir', parameterSet: 6 };
  if (/drum|snare|kick|perc|808|timpani|marimba/i.test(lower)) return { category: 'Drums & Percussion', parameterSet: 7 };
  if (/pad|ambient|drone|sweep|atmos/i.test(lower)) return { category: 'Pads & Atmospheres', parameterSet: 8 };
  return { category: 'Synthesizer', parameterSet: 0 };
}

// ─────────────────────────────────────────────────────────
// 1. Decent Sampler Parser (.dspreset)
// Compliant with DecentSampler official spec & DecentSamples/DecentSampler-Sample-Library-Examples
// ─────────────────────────────────────────────────────────

export function parseDecentSamplerPreset(
  xmlText: string,
  audioFiles: Map<string, ArrayBuffer> = new Map()
): ParsedSamplerPreset {
  // Check if valid Decent Sampler XML
  if (!/<DecentSampler/i.test(xmlText) && !/<sample/i.test(xmlText)) {
    throw new Error('Not a valid Decent Sampler preset (missing <DecentSampler> root tag).');
  }

  const titleMatch =
    xmlText.match(/<!--\s*Bank:\s*([^|]+)\|/i) ||
    xmlText.match(/name=["']([^"']+)["']/i) ||
    xmlText.match(/<instrument[^>]*name=["']([^"']+)["']/i);
  const presetName = titleMatch ? titleMatch[1].trim() : 'DecentSamplerPreset';
  const { category, parameterSet } = classifyPresetCategory(presetName);

  const regions: ParsedImportRegion[] = [];
  let regIndex = 0;

  // Extract global groups envelope if defined on <groups>
  let defaultEnvelope: { attack: number; decay: number; sustain: number; release: number } | undefined;
  const groupsMatch = xmlText.match(/<groups\b([^>]*)>/i);
  if (groupsMatch) {
    const gTag = groupsMatch[1];
    defaultEnvelope = {
      attack: getAttrNum(gTag, 'attack', 0.01),
      decay: getAttrNum(gTag, 'decay', 0.1),
      sustain: getAttrNum(gTag, 'sustain', 1.0),
      release: getAttrNum(gTag, 'release', 0.3),
    };
  }

  // Parse by <group> tags to handle group-level inheritance of properties
  // (seqMode, loNote, hiNote, loVel, hiVel, volume, pan, tuning, loopEnabled, etc.)
  const groupRegex = /<group\b([^>]*)>([\s\S]*?)<\/group>/gi;
  let groupMatch: RegExpExecArray | null;
  let foundAnyGroups = false;

  while ((groupMatch = groupRegex.exec(xmlText)) !== null) {
    foundAnyGroups = true;
    const groupAttrs = groupMatch[1];
    const groupBody = groupMatch[2];

    const grpLoNote = getAttr(groupAttrs, 'loNote');
    const grpHiNote = getAttr(groupAttrs, 'hiNote');
    const grpLoVel = getAttr(groupAttrs, 'loVel');
    const grpHiVel = getAttr(groupAttrs, 'hiVel');
    const grpVol = getAttr(groupAttrs, 'volume');
    const grpPan = getAttr(groupAttrs, 'pan');
    const grpTuning = getAttr(groupAttrs, 'tuning');
    const grpLoopEnabled = getAttr(groupAttrs, 'loopEnabled');
    const grpLoopStart = getAttr(groupAttrs, 'loopStart');
    const grpLoopEnd = getAttr(groupAttrs, 'loopEnd');

    // Parse samples inside this group
    const sampleRegex = /<sample\b([^>]*)\/?>/gi;
    let sMatch: RegExpExecArray | null;

    while ((sMatch = sampleRegex.exec(groupBody)) !== null) {
      const tag = sMatch[1];
      const path = getAttr(tag, 'path') || getAttr(tag, 'file');
      if (!path) continue;

      const sampleName = cleanBasename(path);
      const rootKey = parseNoteNumber(getAttr(tag, 'rootNote'), 60);

      const rawLoNote = getAttr(tag, 'loNote') || grpLoNote;
      const rawHiNote = getAttr(tag, 'hiNote') || grpHiNote;
      const lowKey = rawLoNote ? parseNoteNumber(rawLoNote, rootKey) : rootKey;
      const highKey = rawHiNote ? parseNoteNumber(rawHiNote, rootKey) : rootKey;

      const rawLoVel = getAttr(tag, 'loVel') || grpLoVel;
      const rawHiVel = getAttr(tag, 'hiVel') || grpHiVel;
      const lowVel = Math.max(1, Math.min(127, rawLoVel ? parseInt(rawLoVel, 10) : 1));
      const highVel = Math.max(1, Math.min(127, rawHiVel ? parseInt(rawHiVel, 10) : 127));

      const rawTuning = getAttr(tag, 'tuning') || grpTuning || '0';
      const detuneCents = Math.round(parseFloat(rawTuning) * 100) || 0;

      let volumeDb = 0;
      const rawVol = getAttr(tag, 'volume') || grpVol || '0';
      if (rawVol.endsWith('dB')) {
        volumeDb = parseFloat(rawVol);
      } else {
        const volNum = parseFloat(rawVol);
        if (!isNaN(volNum) && volNum > 0 && volNum !== 1.0) {
          volumeDb = 20 * Math.log10(volNum);
        }
      }

      const rawPan = getAttr(tag, 'pan') || grpPan || '0';
      const panNorm = parseFloat(rawPan) || 0;
      const pan = Math.max(-50, Math.min(50, Math.round(panNorm * 50)));

      const rawLoopEnabled = (getAttr(tag, 'loopEnabled') || grpLoopEnabled || 'false').toLowerCase();
      const loopEnabled = rawLoopEnabled === 'true' || rawLoopEnabled === '1';

      const rawLoopStart = getAttr(tag, 'loopStart') || grpLoopStart || '0';
      const rawLoopEnd = getAttr(tag, 'loopEnd') || grpLoopEnd || '0';
      const loopStart = parseInt(rawLoopStart, 10) || 0;
      const loopEnd = parseInt(rawLoopEnd, 10) || 0;

      regIndex++;
      regions.push({
        id: `ds_reg_${String(regIndex).padStart(3, '0')}`,
        sampleName,
        samplePath: path,
        rootKey,
        lowKey,
        highKey,
        lowVel,
        highVel,
        detuneCents,
        volumeDb,
        pan,
        loopMode: loopEnabled && loopEnd > loopStart ? 'loop_continuous' : 'no_loop',
        loopStart,
        loopEnd,
      });
    }
  }

  // Fallback: if no <group> tags were matched (e.g. flat <sample> tags inside <groups>)
  if (!foundAnyGroups || regions.length === 0) {
    const sampleRegex = /<sample\b([^>]*)\/?>/gi;
    let match: RegExpExecArray | null;

    while ((match = sampleRegex.exec(xmlText)) !== null) {
      const tag = match[1];
      const path = getAttr(tag, 'path') || getAttr(tag, 'file');
      if (!path) continue;

      const sampleName = cleanBasename(path);
      const rootKey = parseNoteNumber(getAttr(tag, 'rootNote'), 60);
      const lowKey = parseNoteNumber(getAttr(tag, 'loNote'), rootKey);
      const highKey = parseNoteNumber(getAttr(tag, 'hiNote'), rootKey);
      const lowVel = Math.max(1, Math.min(127, getAttrNum(tag, 'loVel', 1)));
      const highVel = Math.max(1, Math.min(127, getAttrNum(tag, 'hiVel', 127)));

      const tuningStr = getAttr(tag, 'tuning', '0');
      const detuneCents = Math.round(parseFloat(tuningStr) * 100) || 0;

      let volumeDb = 0;
      const volStr = getAttr(tag, 'volume', '0');
      if (volStr.endsWith('dB')) {
        volumeDb = parseFloat(volStr);
      } else {
        const volNum = parseFloat(volStr);
        if (!isNaN(volNum) && volNum > 0 && volNum !== 1.0) {
          volumeDb = 20 * Math.log10(volNum);
        }
      }

      const panNorm = getAttrNum(tag, 'pan', 0);
      const pan = Math.max(-50, Math.min(50, Math.round(panNorm * 50)));

      const rawLoop = getAttr(tag, 'loopEnabled', 'false').toLowerCase();
      const loopEnabled = rawLoop === 'true' || rawLoop === '1';
      const loopStart = getAttrNum(tag, 'loopStart', 0);
      const loopEnd = getAttrNum(tag, 'loopEnd', 0);

      regIndex++;
      regions.push({
        id: `ds_reg_${String(regIndex).padStart(3, '0')}`,
        sampleName,
        samplePath: path,
        rootKey,
        lowKey,
        highKey,
        lowVel,
        highVel,
        detuneCents,
        volumeDb,
        pan,
        loopMode: loopEnabled && loopEnd > loopStart ? 'loop_continuous' : 'no_loop',
        loopStart,
        loopEnd,
      });
    }
  }

  return {
    format: 'dspreset',
    formatLabel: 'Decent Sampler (.dspreset)',
    presetName,
    modelName: presetName.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 11),
    detectedCategory: category,
    suggestedParameterSet: parameterSet,
    regions,
    audioBuffers: mapAudioBuffers(audioFiles),
    envelope: defaultEnvelope,
  };
}

// ─────────────────────────────────────────────────────────
// 2. Kontakt Parser (.nki unencrypted XML / structured descriptor)
// ─────────────────────────────────────────────────────────

export function parseKontaktNki(
  content: string | ArrayBuffer,
  audioFiles: Map<string, ArrayBuffer> = new Map()
): ParsedSamplerPreset {
  let xmlText = '';

  if (typeof content === 'string') {
    xmlText = content;
  } else {
    // Check for encrypted binary monolithic container
    const view = new DataView(content);
    if (view.byteLength >= 4) {
      const magic0 = view.getUint8(0);
      const magic1 = view.getUint8(1);
      const magic2 = view.getUint8(2);
      const magic3 = view.getUint8(3);

      // NI Monolith / encrypted container check (0x12 0x34 0x56 0x78, 'hsin', 'NI4I', etc.)
      const isEncryptedHeader =
        (magic0 === 0x12 && magic1 === 0x34 && magic2 === 0x56 && magic3 === 0x78) ||
        (magic0 === 0x7e && magic1 === 0x10) ||
        (magic0 === 0x68 && magic1 === 0x73 && magic2 === 0x69 && magic3 === 0x6e); // 'hsin'

      if (isEncryptedHeader && view.byteLength > 64) {
        // Try searching for embedded unencrypted XML/ASCII descriptor
        const textBytes = new Uint8Array(content);
        let embeddedXml = '';
        try {
          const rawStr = new TextDecoder('latin1').decode(textBytes);
          const xmlStart = rawStr.indexOf('<kontakt-instrument');
          if (xmlStart >= 0) {
            const xmlEnd = rawStr.indexOf('</kontakt-instrument>', xmlStart);
            if (xmlEnd > xmlStart) {
              embeddedXml = rawStr.slice(xmlStart, xmlEnd + 21);
            }
          }
        } catch {
          // ignore
        }

        if (embeddedXml) {
          xmlText = embeddedXml;
        } else {
          return {
            format: 'nki',
            formatLabel: 'Native Instruments Kontakt (.nki)',
            presetName: 'Encrypted_Kontakt_Library',
            modelName: 'Encrypted',
            detectedCategory: 'Protected',
            suggestedParameterSet: 0,
            regions: [],
            audioBuffers: mapAudioBuffers(audioFiles),
            isEncrypted: true,
            encryptionNotice:
              'Encrypted Native Instruments monolithic patch detected (.nki/.nkx/.nicnt). Monolithic proprietary-encoded commercial libraries cannot be decompressed directly. Please export an unencrypted patch or raw WAV/SFZ samples from Kontakt.',
          };
        }
      } else {
        xmlText = new TextDecoder('utf-8').decode(content);
      }
    }
  }

  const nameMatch = xmlText.match(/name=["']([^"']+)["']/i);
  const presetName = nameMatch ? nameMatch[1].trim() : 'KontaktInstrument';
  const { category, parameterSet } = classifyPresetCategory(presetName);

  const regions: ParsedImportRegion[] = [];
  const zoneRegex = /<zone\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;
  let regIndex = 0;

  while ((match = zoneRegex.exec(xmlText)) !== null) {
    const tag = match[1];
    const sample = getAttr(tag, 'sample') || getAttr(tag, 'file');
    if (!sample) continue;

    const sampleName = cleanBasename(sample);
    const rootKey = parseNoteNumber(getAttr(tag, 'rootKey'), 60);
    const lowKey = parseNoteNumber(getAttr(tag, 'lowKey'), rootKey);
    const highKey = parseNoteNumber(getAttr(tag, 'highKey'), rootKey);
    const lowVel = Math.max(1, Math.min(127, getAttrNum(tag, 'lowVel', 1)));
    const highVel = Math.max(1, Math.min(127, getAttrNum(tag, 'highVel', 127)));
    const detuneCents = getAttrNum(tag, 'tune', 0);
    const volumeDb = getAttrNum(tag, 'volume', 0);
    const pan = Math.max(-50, Math.min(50, getAttrNum(tag, 'pan', 0)));

    const loopModeStr = getAttr(tag, 'loopMode', 'no_loop');
    const loopMode: LoopMode = loopModeStr === 'loop_continuous' || loopModeStr === '1' ? 'loop_continuous' : 'no_loop';
    const loopStart = getAttrNum(tag, 'loopStart', 0);
    const loopEnd = getAttrNum(tag, 'loopEnd', 0);

    regIndex++;
    regions.push({
      id: `nki_zone_${String(regIndex).padStart(3, '0')}`,
      sampleName,
      samplePath: sample,
      rootKey,
      lowKey,
      highKey,
      lowVel,
      highVel,
      detuneCents,
      volumeDb,
      pan,
      loopMode,
      loopStart,
      loopEnd,
    });
  }

  return {
    format: 'nki',
    formatLabel: 'Native Instruments Kontakt (.nki)',
    presetName,
    modelName: presetName.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 11),
    detectedCategory: category,
    suggestedParameterSet: parameterSet,
    regions,
    audioBuffers: mapAudioBuffers(audioFiles),
  };
}

// ─────────────────────────────────────────────────────────
// 3. Steinberg HALion Parser (.vstpreset)
// ─────────────────────────────────────────────────────────

export function parseHalionVstPreset(
  content: string | ArrayBuffer,
  audioFiles: Map<string, ArrayBuffer> = new Map()
): ParsedSamplerPreset {
  let xmlText = '';

  if (typeof content === 'string') {
    xmlText = content;
  } else {
    // Check for VST3 container header ('VST3' = 0x56 0x53 0x54 0x33)
    const view = new DataView(content);
    if (view.byteLength >= 4) {
      const c0 = view.getUint8(0);
      const c1 = view.getUint8(1);
      const c2 = view.getUint8(2);
      const c3 = view.getUint8(3);

      if (c0 === 0x56 && c1 === 0x53 && c2 === 0x54 && c3 === 0x33) {
        // Search embedded XML chunk inside VST3 preset container
        const raw = new TextDecoder('latin1').decode(new Uint8Array(content));
        const xmlStart = raw.indexOf('<?xml') !== -1 ? raw.indexOf('<?xml') : raw.indexOf('<HALionProgram');
        if (xmlStart >= 0) {
          const xmlEnd = raw.indexOf('</HALionProgram>', xmlStart);
          xmlText = xmlEnd > xmlStart ? raw.slice(xmlStart, xmlEnd + 16) : raw.slice(xmlStart);
        }
      }
    }

    if (!xmlText) {
      try {
        xmlText = new TextDecoder('utf-8').decode(content);
      } catch {
        xmlText = '';
      }
    }
  }

  const nameMatch = xmlText.match(/name=["']([^"']+)["']/i);
  const presetName = nameMatch ? nameMatch[1].trim() : 'HALionProgram';
  const { category, parameterSet } = classifyPresetCategory(presetName);

  const regions: ParsedImportRegion[] = [];
  const zoneRegex = /<zone\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;
  let regIndex = 0;

  while ((match = zoneRegex.exec(xmlText)) !== null) {
    const tag = match[1];
    const file = getAttr(tag, 'file') || getAttr(tag, 'sample');
    if (!file) continue;

    const sampleName = cleanBasename(file);
    const rootKey = parseNoteNumber(getAttr(tag, 'rootKey'), 60);
    const lowKey = parseNoteNumber(getAttr(tag, 'keyLow'), rootKey);
    const highKey = parseNoteNumber(getAttr(tag, 'keyHigh'), rootKey);
    const lowVel = Math.max(1, Math.min(127, getAttrNum(tag, 'velLow', 1)));
    const highVel = Math.max(1, Math.min(127, getAttrNum(tag, 'velHigh', 127)));
    const detuneCents = getAttrNum(tag, 'tune', 0);
    const volumeDb = getAttrNum(tag, 'gain', 0);
    const pan = Math.max(-50, Math.min(50, getAttrNum(tag, 'pan', 0)));

    const loop = getAttr(tag, 'loop', 'false').toLowerCase() === 'true';
    const loopStart = getAttrNum(tag, 'loopStart', 0);
    const loopEnd = getAttrNum(tag, 'loopEnd', 0);

    regIndex++;
    regions.push({
      id: `vst_zone_${String(regIndex).padStart(3, '0')}`,
      sampleName,
      samplePath: file,
      rootKey,
      lowKey,
      highKey,
      lowVel,
      highVel,
      detuneCents,
      volumeDb,
      pan,
      loopMode: loop && loopEnd > loopStart ? 'loop_continuous' : 'no_loop',
      loopStart,
      loopEnd,
    });
  }

  return {
    format: 'vstpreset',
    formatLabel: 'Steinberg HALion (.vstpreset)',
    presetName,
    modelName: presetName.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 11),
    detectedCategory: category,
    suggestedParameterSet: parameterSet,
    regions,
    audioBuffers: mapAudioBuffers(audioFiles),
  };
}

// ─────────────────────────────────────────────────────────
// 4. Bitwig Studio Multisample Parser (.multisample)
// ─────────────────────────────────────────────────────────

export function parseBitwigMultisample(
  xmlText: string,
  audioFiles: Map<string, ArrayBuffer> = new Map()
): ParsedSamplerPreset {
  const regions: ParsedImportRegion[] = [];
  const sampleRegex = /<sample\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;
  let regIndex = 0;

  const categoryMatch = xmlText.match(/<category>([^<]+)<\/category>/i);
  const detectedCategory = categoryMatch ? categoryMatch[1].trim() : 'Synthesizer';
  const { parameterSet } = classifyPresetCategory(detectedCategory);

  while ((match = sampleRegex.exec(xmlText)) !== null) {
    const tag = match[1];
    const file = getAttr(tag, 'file');
    if (!file) continue;

    const sampleName = cleanBasename(file);
    const rootKey = parseNoteNumber(getAttr(tag, 'root'), 60);
    const lowKey = parseNoteNumber(getAttr(tag, 'low'), rootKey);
    const highKey = parseNoteNumber(getAttr(tag, 'high'), rootKey);
    const lowVel = Math.max(1, Math.min(127, getAttrNum(tag, 'low-vel', 1)));
    const highVel = Math.max(1, Math.min(127, getAttrNum(tag, 'high-vel', 127)));
    const detuneCents = getAttrNum(tag, 'tune', 0);
    const volumeDb = getAttrNum(tag, 'gain', 0);
    const panNorm = getAttrNum(tag, 'pan', 0);
    const pan = Math.max(-50, Math.min(50, Math.round(panNorm * 50)));

    const loop = getAttr(tag, 'loop', 'false').toLowerCase() === 'true';
    const loopStart = getAttrNum(tag, 'loop-start', 0);
    const loopEnd = getAttrNum(tag, 'loop-end', 0);

    regIndex++;
    regions.push({
      id: `bw_zone_${String(regIndex).padStart(3, '0')}`,
      sampleName,
      samplePath: file,
      rootKey,
      lowKey,
      highKey,
      lowVel,
      highVel,
      detuneCents,
      volumeDb,
      pan,
      loopMode: loop && loopEnd > loopStart ? 'loop_continuous' : 'no_loop',
      loopStart,
      loopEnd,
    });
  }

  const presetName = 'BitwigMultisample';
  return {
    format: 'multisample',
    formatLabel: 'Bitwig Studio (.multisample)',
    presetName,
    modelName: presetName.slice(0, 11),
    detectedCategory,
    suggestedParameterSet: parameterSet,
    regions,
    audioBuffers: mapAudioBuffers(audioFiles),
  };
}

// ─────────────────────────────────────────────────────────
// Shared DRY Audio Slice Extractor (used by Sample Chains, REX2, and MPC Sliced Kits)
// ─────────────────────────────────────────────────────────

function sliceDecodedAudioToWav(
  decoded: DecodedWav,
  startFrame: number,
  endFrame: number,
  keys: { rootKey: number; lowKey: number; highKey: number }
): ArrayBuffer | null {
  const totalFrames = decoded.channels[0]?.length ?? 0;
  const start = Math.max(0, Math.min(totalFrames, Math.floor(startFrame)));
  const end = Math.max(start, Math.min(totalFrames, Math.floor(endFrame)));
  if (end <= start) return null;

  const sliceLen = end - start;
  const sliceChannels: Float32Array[] = decoded.channels.map((ch) => {
    const slice = new Float32Array(sliceLen);
    slice.set(ch.subarray(start, end));
    return slice;
  });

  return encodeWavPcm16(sliceChannels, decoded.sampleRate, keys);
}

// ─────────────────────────────────────────────────────────
// 4b. Akai MPC Program (.xpm / .xpn) — Fase 31
// ─────────────────────────────────────────────────────────

/** Converts a parsed MPC program into the generic preset model, reusing the shared slicer for sliced WAVs. */
export function mpcProgramToPreset(
  program: MpcProgram,
  audioFiles: Map<string, ArrayBuffer> = new Map()
): ParsedSamplerPreset {
  const audioBuffers = mapAudioBuffers(audioFiles);
  // Resolve "SampleName" (no extension) against available audio, case-insensitive
  const byStem = new Map<string, string>();
  for (const k of audioBuffers.keys()) byStem.set(k.replace(/\.[^.]+$/, '').toLowerCase(), k);

  // Lazy per-WAV cache of parsed slice cues ("atem" / "cue ") and decoded PCM
  const wavCache = new Map<
    string,
    { decoded: DecodedWav | null; markers: ParsedSliceMarker[]; sliceFrames: number[] }
  >();
  const getWavInfo = (wavKey: string) => {
    let entry = wavCache.get(wavKey);
    if (entry) return entry;
    const buf = audioBuffers.get(wavKey);
    if (!buf || buf.byteLength <= 44) {
      entry = { decoded: null, markers: [], sliceFrames: [] };
      wavCache.set(wavKey, entry);
      return entry;
    }
    const cueRes = parseWavSliceCues(buf, wavKey);
    let decoded: DecodedWav | null = null;
    try {
      decoded = wavKey.toLowerCase().endsWith('.aif') || wavKey.toLowerCase().endsWith('.aiff')
        ? decodeAiff(buf)
        : decodeWav(buf);
    } catch {
      decoded = null;
    }
    entry = {
      decoded,
      markers: cueRes?.markers ?? [],
      sliceFrames: cueRes?.sliceFrames ?? [],
    };
    wavCache.set(wavKey, entry);
    return entry;
  };

  let isSliceChain = false;
  let primarySliceFrames: number[] | undefined;
  let primarySliceMarkers: ParsedSliceMarker[] | undefined;

  const regions: ParsedImportRegion[] = [];
  let idx = 0;
  program.instruments.forEach((inst, instIndex) => {
    const drumNote = program.padNotes[inst.number - 1] ?? 36 + instIndex;
    for (const l of inst.layers) {
      const stem = (l.sampleFile ? cleanBasename(l.sampleFile).replace(/\.[^.]+$/, '') : l.sampleName).toLowerCase();
      const resolved = byStem.get(stem) ?? byStem.get(stem.trim()) ?? `${l.sampleName}.wav`;
      const isDrum = program.type === 'Drum';
      const lowKey = isDrum ? drumNote : inst.lowNote;
      const highKey = isDrum ? drumNote : inst.highNote;
      const rootKey = isDrum || l.rootNote < 0 ? lowKey : l.rootNote;

      let targetSampleName = resolved;
      let loopStart = l.loopStart;
      let loopEnd = l.loopEnd;

      // Check if this layer references a slice inside a shared WAV (via Akai atem/cue sliceIndex or explicit sampleStart/End)
      if (audioBuffers.has(resolved)) {
        const info = getWavInfo(resolved);
        const totalFrames = info.decoded?.channels[0]?.length ?? 0;
        let sliceStart = 0;
        let sliceEnd = 0;
        let sliceTag = '';

        if (
          l.sliceIndex !== undefined &&
          l.sliceIndex >= 0 &&
          l.sliceIndex !== 128 &&
          l.sliceIndex < info.markers.length
        ) {
          const m = info.markers[l.sliceIndex];
          sliceStart = m.frame;
          sliceEnd =
            m.durationFrames !== undefined
              ? m.frame + m.durationFrames
              : l.sliceIndex + 1 < info.markers.length
                ? info.markers[l.sliceIndex + 1].frame
                : totalFrames;
          sliceTag = `s${String(l.sliceIndex).padStart(2, '0')}`;
        } else if (
          totalFrames > 0 &&
          (l.sampleStart > 0 || (l.sampleEnd > 0 && l.sampleEnd < totalFrames))
        ) {
          sliceStart = l.sampleStart;
          sliceEnd = l.sampleEnd > 0 ? l.sampleEnd : totalFrames;
          sliceTag = `${sliceStart}_${sliceEnd}`;
        }

        if (info.decoded && sliceTag && sliceEnd > sliceStart && (sliceStart > 0 || sliceEnd < totalFrames)) {
          const baseStem = resolved.replace(/\.[^.]+$/, '');
          targetSampleName = `${baseStem}_slice_${sliceTag}.wav`;
          if (!audioBuffers.has(targetSampleName)) {
            const slicedWav = sliceDecodedAudioToWav(info.decoded, sliceStart, sliceEnd, {
              rootKey,
              lowKey,
              highKey,
            });
            if (slicedWav) {
              audioBuffers.set(targetSampleName, slicedWav);
            }
          }
          loopStart = Math.max(0, loopStart - sliceStart);
          loopEnd = Math.max(0, Math.min(sliceEnd - sliceStart, loopEnd - sliceStart));
          isSliceChain = true;
          if (!primarySliceFrames && info.sliceFrames.length > 1) {
            primarySliceFrames = info.sliceFrames;
            primarySliceMarkers = info.markers;
          }
        }
      }

      idx++;
      regions.push({
        id: `mpc_zone_${String(idx).padStart(3, '0')}`,
        sampleName: targetSampleName,
        samplePath: targetSampleName,
        rootKey,
        lowKey,
        highKey,
        lowVel: Math.max(1, l.velStart),
        highVel: Math.min(127, Math.max(1, l.velEnd)),
        detuneCents: (l.tuneCoarse + inst.tuneCoarse) * 100 + l.tuneFine + inst.tuneFine,
        volumeDb: Math.max(-32, Math.min(12, mpcGainToDb(l.volume))),
        pan: Math.max(-50, Math.min(50, Math.round((l.pan - 0.5) * 100))),
        loopMode: l.loopEnabled && loopEnd > loopStart ? 'loop_continuous' : inst.triggerMode === 0 ? 'one_shot' : 'no_loop',
        loopStart,
        loopEnd,
      });
    }
  });

  const { category, parameterSet } = classifyPresetCategory(program.name + (program.type === 'Drum' ? ' drum' : ''));
  const env = program.instruments[0]?.volumeEnv;
  return {
    format: 'xpm',
    formatLabel: program.sourceVariant === 'mpc3-json' ? 'Akai MPC 3 Program (.xpm JSON)' : `Akai MPC ${program.type} Program (.xpm)`,
    presetName: program.name,
    modelName: program.name.slice(0, 11),
    detectedCategory: program.type === 'Drum' ? 'Drums & Percussion' : category,
    suggestedParameterSet: parameterSet,
    regions,
    audioBuffers,
    envelope: env
      ? { attack: env.attackSec, decay: env.decaySec, sustain: env.sustain, release: env.releaseSec }
      : undefined,
    ...(isSliceChain ? { isSliceChain: true, sliceFrames: primarySliceFrames, sliceMarkers: primarySliceMarkers } : {}),
  };
}

// ─────────────────────────────────────────────────────────
// 5. Linear Sample Chains Parser (Octatrack / SP-404 / OP-1)
// ─────────────────────────────────────────────────────────

export function parseSampleChainAudio(
  buffer: ArrayBuffer,
  filename: string,
  options?: { gridSlices?: number }
): ParsedSamplerPreset {
  const baseName = filename.replace(/\.[^/.]+$/, '');
  const cleanName = cleanBasename(baseName);
  const { category, parameterSet } = classifyPresetCategory(cleanName);

  // 1. Try parsing embedded slice markers (RIFF 'cue ' / AIFF 'MARK')
  const sliceResult = parseSliceFile(buffer, filename);
  let sliceFrames: number[] = [];
  let markers: ParsedSliceMarker[] = [];

  if (sliceResult && sliceResult.sliceFrames.length > 1) {
    sliceFrames = [...sliceResult.sliceFrames];
    markers = [...sliceResult.markers];
  } else if (options?.gridSlices && options.gridSlices > 1) {
    // Decode audio to find length
    const decoded = filename.toLowerCase().endsWith('.aif') || filename.toLowerCase().endsWith('.aiff')
      ? decodeAiff(buffer)
      : decodeWav(buffer);

    const totalFrames = decoded.channels[0].length;
    const sliceLen = Math.floor(totalFrames / options.gridSlices);
    for (let i = 0; i < options.gridSlices; i++) {
      const f = i * sliceLen;
      sliceFrames.push(f);
      markers.push({ id: i + 1, frame: f, label: `Slice #${i + 1}` });
    }
  }

  // If still no slice markers found, check filename conventions like _16slice, _chain, _32
  if (sliceFrames.length <= 1) {
    const gridMatch = filename.match(/_(\d+)(?:slice|hit|chain|steps?)/i);
    const suggestedGrid = gridMatch ? parseInt(gridMatch[1], 10) : 0;
    if (suggestedGrid > 1 && suggestedGrid <= 128) {
      const decoded = filename.toLowerCase().endsWith('.aif') || filename.toLowerCase().endsWith('.aiff')
        ? decodeAiff(buffer)
        : decodeWav(buffer);
      const totalFrames = decoded.channels[0].length;
      const sliceLen = Math.floor(totalFrames / suggestedGrid);
      sliceFrames = [];
      markers = [];
      for (let i = 0; i < suggestedGrid; i++) {
        const f = i * sliceLen;
        sliceFrames.push(f);
        markers.push({ id: i + 1, frame: f, label: `Slice #${i + 1}` });
      }
    }
  }

  const regions: ParsedImportRegion[] = [];
  const audioBuffers = new Map<string, ArrayBuffer>();

  // If slices were found, slice the audio and generate individual regions
  if (sliceFrames.length > 0) {
    const decoded = filename.toLowerCase().endsWith('.aif') || filename.toLowerCase().endsWith('.aiff')
      ? decodeAiff(buffer)
      : decodeWav(buffer);

    const totalFrames = decoded.channels[0].length;
    const baseMidi = 36; // C1 starting note

    for (let i = 0; i < sliceFrames.length; i++) {
      const start = sliceFrames[i];
      const end = i < sliceFrames.length - 1 ? sliceFrames[i + 1] : totalFrames;
      const note = Math.min(127, baseMidi + i);
      const sliceWav = sliceDecodedAudioToWav(decoded, start, end, {
        rootKey: note,
        lowKey: note,
        highKey: note,
      });
      if (!sliceWav) continue;

      const sliceSampleName = `${cleanName}_slice_${String(i + 1).padStart(2, '0')}.wav`;
      audioBuffers.set(sliceSampleName, sliceWav);
      regions.push({
        id: `chain_slice_${String(i + 1).padStart(2, '0')}`,
        sampleName: sliceSampleName,
        samplePath: sliceSampleName,
        rootKey: note,
        lowKey: note,
        highKey: note,
        lowVel: 1,
        highVel: 127,
        detuneCents: 0,
        volumeDb: 0,
        pan: 0,
        loopMode: 'no_loop',
        loopStart: 0,
        loopEnd: 0,
      });
    }
  } else {
    // Single non-sliced file fallback
    const singleName = cleanBasename(filename);
    audioBuffers.set(singleName, buffer);
    regions.push({
      id: 'chain_single_001',
      sampleName: singleName,
      samplePath: singleName,
      rootKey: 60,
      lowKey: 0,
      highKey: 127,
      lowVel: 1,
      highVel: 127,
      detuneCents: 0,
      volumeDb: 0,
      pan: 0,
      loopMode: 'no_loop',
      loopStart: 0,
      loopEnd: 0,
    });
  }

  return {
    format: 'samplechain',
    formatLabel: 'Linear Sample Chain (.wav)',
    presetName: cleanName,
    modelName: cleanName.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 11),
    detectedCategory: category,
    suggestedParameterSet: parameterSet,
    regions,
    audioBuffers,
    isSliceChain: sliceFrames.length > 1,
    sliceFrames,
    sliceMarkers: markers,
  };
}

export function parseRex2Sampler(
  buffer: ArrayBuffer,
  filename: string,
  decodedWavBuffer?: ArrayBuffer
): ParsedSamplerPreset {
  const baseName = filename.replace(/\.[^/.]+$/, '');
  const cleanName = cleanBasename(baseName);
  const { category, parameterSet } = classifyPresetCategory(cleanName);

  const sliceResult = parseSliceFile(buffer, filename);
  const sliceFrames = sliceResult?.sliceFrames ?? [];
  const markers = sliceResult?.markers ?? [];

  const regions: ParsedImportRegion[] = [];
  const audioBuffers = new Map<string, ArrayBuffer>();

  let activeWav = decodedWavBuffer;
  if (!activeWav && isRx2Buffer(buffer)) {
    try {
      const decompressed = decompressRx2Audio(buffer);
      activeWav = decompressed.wavBuffer;
    } catch {
      // Audio remains offline/empty if DWOP chunk is missing
    }
  }

  if (activeWav && activeWav.byteLength > 44) {
    const decoded = decodeWav(activeWav);
    const totalFrames = decoded.channels[0].length;
    const baseMidi = 36; // C1 starting note

    if (sliceFrames.length > 0) {
      for (let i = 0; i < sliceFrames.length; i++) {
        const start = sliceFrames[i];
        const end = i < sliceFrames.length - 1 ? sliceFrames[i + 1] : totalFrames;
        const note = Math.min(127, baseMidi + i);
        const sliceWav = sliceDecodedAudioToWav(decoded, start, end, {
          rootKey: note,
          lowKey: note,
          highKey: note,
        });
        if (!sliceWav) continue;

        const sliceSampleName = `${cleanName}_slice_${String(i + 1).padStart(2, '0')}.wav`;
        audioBuffers.set(sliceSampleName, sliceWav);
        regions.push({
          id: `rex_slice_${String(i + 1).padStart(2, '0')}`,
          sampleName: sliceSampleName,
          samplePath: sliceSampleName,
          rootKey: note,
          lowKey: note,
          highKey: note,
          lowVel: 1,
          highVel: 127,
          detuneCents: 0,
          volumeDb: 0,
          pan: 0,
          loopMode: 'no_loop',
          loopStart: 0,
          loopEnd: 0,
        });
      }
    }
  }

  return {
    format: 'samplechain',
    formatLabel: 'ReCycle REX2 Loop',
    presetName: cleanName,
    modelName: cleanName.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 11),
    detectedCategory: category,
    suggestedParameterSet: parameterSet,
    regions,
    audioBuffers,
    isSliceChain: true,
    sliceFrames,
    sliceMarkers: markers,
    isEncrypted: false,
  };
}

// ─────────────────────────────────────────────────────────
// 6. Master Auto-Detect Universal Dispatcher
// ─────────────────────────────────────────────────────────

export async function parseUniversalSampler(
  filename: string,
  data: ArrayBuffer | string,
  zipEntriesOrDecodedWav?: Map<string, Uint8Array> | ArrayBuffer,
  decodedWavBuffer?: ArrayBuffer
): Promise<ParsedSamplerPreset> {
  const lower = filename.toLowerCase();
  const zipEntries = zipEntriesOrDecodedWav instanceof Map ? zipEntriesOrDecodedWav : undefined;
  const decodedWav = zipEntriesOrDecodedWav instanceof ArrayBuffer ? zipEntriesOrDecodedWav : decodedWavBuffer;

  // 1. If it's a ZIP archive containing a bank + samples (also Akai .xpn expansions)
  if (lower.endsWith('.zip') || lower.endsWith('.xpn') || (!zipEntries && typeof data !== 'string' && isZipHeader(data))) {
    const rawZipBytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
    const parsedEntries = parseZipArchive(rawZipBytes);
    const entriesMap = new Map<string, Uint8Array>();
    for (const entry of parsedEntries) {
      entriesMap.set(entry.path.replace(/\\/g, '/'), entry.data);
    }

    // Look for preset definition file inside the ZIP
    let dspresetEntry: string | undefined;
    let nkiEntry: string | undefined;
    let vstpresetEntry: string | undefined;
    let multisampleEntry: string | undefined;
    const xpmEntries: string[] = [];

    for (const name of entriesMap.keys()) {
      const nLower = name.toLowerCase();
      if (nLower.endsWith('.dspreset')) dspresetEntry = name;
      else if (nLower.endsWith('.nki.xml') || nLower.endsWith('.nki')) nkiEntry = name;
      else if (nLower.endsWith('.vstpreset.xml') || nLower.endsWith('.vstpreset')) vstpresetEntry = name;
      else if (nLower.endsWith('multisample.xml')) multisampleEntry = name;
      // MPC programs: .xpm (MPC 1/2/3) and MPC 3 track files .xty (keygroup) / .xtd (drum)
      else if (/\.(xpm|xty|xtd)$/.test(nLower) && !nLower.includes('[previews]')) xpmEntries.push(name);
    }

    // Extract audio buffers
    const audioFiles = new Map<string, ArrayBuffer>();
    for (const [name, bytes] of entriesMap.entries()) {
      const nLower = name.toLowerCase();
      if (nLower.endsWith('.wav') || nLower.endsWith('.aif') || nLower.endsWith('.aiff') || nLower.endsWith('.flac')) {
        const cleanKey = cleanBasename(name);
        audioFiles.set(cleanKey, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
      }
    }

    if (dspresetEntry) {
      const xml = new TextDecoder('utf-8').decode(entriesMap.get(dspresetEntry)!);
      return parseDecentSamplerPreset(xml, audioFiles);
    }
    if (nkiEntry) {
      const bytes = entriesMap.get(nkiEntry)!;
      return parseKontaktNki(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, audioFiles);
    }
    if (vstpresetEntry) {
      const bytes = entriesMap.get(vstpresetEntry)!;
      return parseHalionVstPreset(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, audioFiles);
    }
    if (multisampleEntry) {
      const xml = new TextDecoder('utf-8').decode(entriesMap.get(multisampleEntry)!);
      return parseBitwigMultisample(xml, audioFiles);
    }
    if (xpmEntries.length > 0) {
      // Expansions often bundle several programs. Prefer root-level programs over
      // project copies ([ProjectData]/[TrackData]) and pick the one whose samples
      // are actually present in the archive before slicing audio.
      const availStems = new Set<string>();
      for (const k of audioFiles.keys()) availStems.add(cleanBasename(k).replace(/\.[^.]+$/, '').toLowerCase());
      const ranked = [...xpmEntries].sort((a, b) => Number(a.includes('[')) - Number(b.includes('[')));
      let bestProg: MpcProgram | null = null;
      let bestScore = -1;
      let lastError: unknown = null;
      for (const entry of ranked.slice(0, 32)) {
        try {
          const prog = await parseMpcXpm(entriesMap.get(entry)!);
          const layers = prog.instruments.flatMap((i) => i.layers);
          if (layers.length === 0) continue;
          const resolved = layers.filter((l) => {
            const stem = (l.sampleFile ? cleanBasename(l.sampleFile).replace(/\.[^.]+$/, '') : l.sampleName).toLowerCase();
            return availStems.has(stem) || availStems.has(stem.trim());
          }).length;
          const score = resolved / layers.length;
          if (score > bestScore) {
            bestProg = prog;
            bestScore = score;
          }
          if (score === 1) break;
        } catch (err) {
          lastError = err;
        }
      }
      if (bestProg) {
        const preset = mpcProgramToPreset(bestProg, audioFiles);
        preset.programCount = xpmEntries.length;
        return preset;
      }
      if (lastError) throw lastError;
    }
  }

  // Akai MPC program (MPC2 XML or MPC3 GZIP/JSON). Sibling WAVs may be supplied via zipEntries.
  if (/\.(xpm|xty|xtd)$/.test(lower)) {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
    const audioFiles = new Map<string, ArrayBuffer>();
    if (zipEntries) {
      for (const [name, b] of zipEntries.entries()) {
        audioFiles.set(cleanBasename(name), b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
      }
    }
    return mpcProgramToPreset(await parseMpcXpm(bytes), audioFiles);
  }

  // 2. Direct format dispatch by extension / contents
  if (lower.endsWith('.dspreset')) {
    const xml = typeof data === 'string' ? data : new TextDecoder('utf-8').decode(data);
    return parseDecentSamplerPreset(xml);
  }

  if (lower.endsWith('.nki') || lower.endsWith('.nki.xml')) {
    return parseKontaktNki(data);
  }

  if (lower.endsWith('.vstpreset') || lower.endsWith('.vstpreset.xml')) {
    return parseHalionVstPreset(data);
  }

  if (lower.endsWith('.multisample') || lower.endsWith('multisample.xml')) {
    const xml = typeof data === 'string' ? data : new TextDecoder('utf-8').decode(data);
    return parseBitwigMultisample(xml);
  }

  // 3. Audio / Sample chain / Slices
  if (lower.endsWith('.wav') || lower.endsWith('.aif') || lower.endsWith('.aiff')) {
    if (typeof data !== 'string') {
      return parseSampleChainAudio(data, filename);
    }
  }

  // 4. ReCycle REX2 / REX / RCY
  if (lower.endsWith('.rx2') || lower.endsWith('.rex') || lower.endsWith('.rcy')) {
    if (typeof data !== 'string') {
      return parseRex2Sampler(data, filename, decodedWav);
    }
  }

  throw new Error(`Unsupported sampler bank or audio format: "${filename}"`);
}

function isZipHeader(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 4) return false;
  const view = new DataView(buffer);
  return view.getUint8(0) === 0x50 && view.getUint8(1) === 0x4b && view.getUint8(2) === 0x03 && view.getUint8(3) === 0x04;
}

function mapAudioBuffers(source: Map<string, ArrayBuffer>): Map<string, ArrayBuffer> {
  const out = new Map<string, ArrayBuffer>();
  for (const [k, v] of source.entries()) {
    out.set(cleanBasename(k), v);
  }
  return out;
}
