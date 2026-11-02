// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Raw Multi-Format Sampler Parsers (Fase 18.8 + Fase 32.3/32.4)
//
// High-fidelity importers for:
//   1. Decent Sampler (.dspreset XML / .zip)
//   2. Native Instruments Kontakt (.nki unencrypted XML / structured descriptor)
//   3. Steinberg HALion (.vstpreset XML / VST3 chunk container)
//   4. Bitwig Studio Multisample (.multisample / multisample.xml)
//   4b. Akai MPC Keygroup / Drum Program (.xpm / .xpn / .xty / .xtd)
//   4c. Ableton Sampler / Simpler (.adv GZIP / XML)
//   4d. Apple Logic EXS24 / Sampler (.exs binary)
//   4e. Togu Audio Line TAL-Sampler (.talsmpl XML)
//   4f. CWITEC TX16Wx Software Sampler (.txprog XML)
//   4g. Korg Trinity / Triton / M3 / Pa (.KMP / .KSF / .KSC)
//   4h. MMA Downloadable Sounds Level 1/2 (.dls RIFF "DLS ")
//   5. Linear Sample Chains (Octatrack / SP-404 / OP-1 RIFF cue & uniform slices)
//
// Symmetric counterpart to `RawSamplerExporter.ts`.
// ─────────────────────────────────────────────────────────

import {
  decodeWav,
  decodeAiff,
  encodeWavPcm16,
  isSupportedAudioFileName,
  transcodeAnyAudioToWavBuffer,
  indexZipArchive,
  extractZipEntry,
  type DecodedWav,
  type ZipCentralEntry,
} from '../NeuronFormats/index.ts';
import { parseSliceFile, parseWavSliceCues, type ParsedSliceMarker } from './SliceFileParser.ts';
import { decompressRx2Audio, isRx2Buffer } from './DwopDecompressor.ts';
import type {
  CrossfadeCurve,
  LoopMode,
  MidiNote,
  PitchEnvelopeConfig,
  RegionFilterConfig,
  SampleLoopDescriptor,
  SamplerPlayLogic,
  TriggerMode,
} from './SamplerTypes.ts';
import { parseMpcXpm, mpcGainToDb, type MpcProgram } from './MpcXpmFormat.ts';
import { parseAbletonAdv } from './AbletonAdvFormat.ts';
import { isExs24Buffer, parseExs24 } from './Exs24Format.ts';
import { parseTalSampler } from './TalSamplerFormat.ts';
import { parseTx16WxProgram } from './Tx16WxFormat.ts';
import { isKorgKmpOrKsfBuffer, parseKorgKmp, parseKorgKsf } from './KorgKmpKsfFormat.ts';
import { isDlsBuffer, parseDlsBank } from './DlsFormat.ts';
import {
  isAkaiDiskImage,
  listAkaiDiskPrograms,
  parseAkaiDiskProgram,
} from './AkaiDiskFormat.ts';
import {
  isEmuDiskImage,
  listEmuDiskPrograms,
  parseEmuDiskProgram,
} from './EmuDiskFormat.ts';
import {
  isRolandDiskImage,
  listRolandDiskPrograms,
  parseRolandDiskProgram,
} from './RolandDiskFormat.ts';
import {
  isEnsoniqDiskImage,
  listEnsoniqDiskPrograms,
  parseEnsoniqDiskProgram,
} from './EnsoniqDiskFormat.ts';
import {
  isYamahaDiskImage,
  listYamahaDiskPrograms,
  parseYamahaDiskProgram,
} from './YamahaDiskFormat.ts';
import {
  isWaldorfQpatBuffer,
  listWaldorfQpatLayers,
  parseWaldorfQpat,
  importWaldorfQpatZip,
} from './WaldorfQpatFormat.ts';
import {
  isOpXyPatchJson,
  parseOpXyPatch,
  importOpXyZip,
} from './OpXyFormat.ts';
import {
  isTonverkPstText,
  parseTonverkPst,
  importTonverkZip,
} from './TonverkFormat.ts';
import {
  isDistingExBuffer,
  parseDistingExPreset,
  importDistingExZip,
} from './DistingExFormat.ts';
import {
  isProphetXGroupText,
  parseProphetXGroupText,
  importProphetXZip,
} from './ProphetXFormat.ts';
import {
  isS2400KitBuffer,
  parseS2400Kit,
  importS2400Zip,
} from './IslaS2400Format.ts';
import {
  isKorgMultisampleBuffer,
  parseKorgMultisample,
  importKorgMultisampleZip,
} from './KorgMultisampleModernFormat.ts';
import {
  isThirdWaveBuffer,
  parseThirdWaveProgram,
  importThirdWaveZip,
} from './ThirdWaveFormat.ts';
import {
  isZenCoreSvzBuffer,
  parseZenCoreSvz,
  importZenCoreZip,
} from './ZenCoreSvzFormat.ts';

export type RawSamplerFormat =
  | 'dspreset'
  | 'nki'
  | 'vstpreset'
  | 'multisample'
  | 'samplechain'
  | 'sfz'
  | 'sf2'
  | 'xpm'
  | 'ableton_adv'
  | 'exs24'
  | 'tal_sampler'
  | 'tx16wx'
  | 'korg_kmp'
  | 'dls'
  | 'akai_disk'
  | 'emu_disk'
  | 'roland_disk'
  | 'ensoniq_disk'
  | 'yamaha_disk'
  | 'waldorf_qpat'
  | 'opxy'
  | 'tonverk'
  | 'disting_ex'
  | 'prophet_x'
  | 'isla_s2400'
  | 'korg_modern'
  | 'third_wave'
  | 'zencore';

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
  // Fase 33.1 / 32.3 extended zone fields
  pitchKeytrack?: number; // 0..100
  sampleStartFrame?: number;
  sampleEndFrame?: number;
  reversed?: boolean;
  keyFadeIn?: number;
  keyFadeOut?: number;
  velFadeIn?: number;
  velFadeOut?: number;
  fadeCurve?: CrossfadeCurve;
  loopCrossfadeMs?: number;
  loops?: SampleLoopDescriptor[];
  trigger?: TriggerMode;
  playLogic?: SamplerPlayLogic;
  seqPosition?: number;
  seqLength?: number;
  groupId?: string;
  groupName?: string;
  muteGroup?: number;
  keyswitchNote?: MidiNote;
  velToVolumeDepth?: number;
  velToPitchCents?: number;
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
  envelope?: { attack: number; decay: number; sustain: number; release: number; delay?: number; hold?: number };
  filter?: Partial<RegionFilterConfig>;
  pitchEnv?: Partial<PitchEnvelopeConfig>;
  polyphony?: number;
  pitchBendUpSt?: number;
  pitchBendDownSt?: number;
  author?: string;
  description?: string;
  isEncrypted?: boolean;
  encryptionNotice?: string;
  isSliceChain?: boolean;
  sliceFrames?: number[];
  sliceMarkers?: ParsedSliceMarker[];
  /** Number of programs found in a multi-program container (e.g. Akai .xpn, .dls). */
  programCount?: number;
}

/**
 * Decodes XML string attribute or returns fallback.
 */
function getAttr(tag: string, attrName: string, fallback: string = ''): string {
  const match = tag.match(new RegExp(`\\b${attrName}=["']([^"']*)["']`, 'i'));
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
  const offsets: Record<string, number> = {
    c: 0, 'c#': 1, db: 1, d: 2, 'd#': 3, eb: 3, e: 4, f: 5,
    'f#': 6, gb: 6, g: 7, 'g#': 8, ab: 8, a: 9, 'a#': 10, bb: 10, b: 11,
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
  const last = parts[parts.length - 1] || filename;
  const colonIdx = last.lastIndexOf(':');
  return colonIdx >= 0 ? last.slice(colonIdx + 1) : last;
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
// ─────────────────────────────────────────────────────────

export function parseDecentSamplerPreset(
  xmlText: string,
  audioFiles: Map<string, ArrayBuffer> = new Map()
): ParsedSamplerPreset {
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

  // Parse filter effect if present
  let filter: Partial<RegionFilterConfig> | undefined;
  const effectMatch = /<effect\b([^>]*\btype=["'](?:lowpass|highpass|bandpass|notch)[^"']*["'][^>]*)\/?>/i.exec(xmlText);
  if (effectMatch) {
    const eTag = effectMatch[1];
    const tStr = getAttr(eTag, 'type', 'lowpass').toLowerCase();
    const cutoff = getAttrNum(eTag, 'frequency', 20000);
    const res = getAttrNum(eTag, 'resonance', 0.7);
    filter = {
      enabled: cutoff < 19900,
      type: tStr.includes('high') ? 'hpf' : tStr.includes('band') ? 'bpf' : tStr.includes('notch') ? 'notch' : 'lpf',
      poles: tStr.includes('12') || tStr.includes('2') ? 2 : 4,
      cutoffHz: Math.max(20, Math.min(22000, cutoff)),
      resonanceDb: Math.max(0, Math.min(24, (res - 0.7) * 6)),
      envToFilterCents: 0,
      velToFilterCents: 0,
      keytrackCents: 0,
    };
  }

  const muteTagMap = new Map<string, number>();
  const getMuteGroupForTag = (tag: string): number => {
    const key = tag.trim().toLowerCase();
    if (!key) return 0;
    let id = muteTagMap.get(key);
    if (!id) {
      id = Math.min(32, muteTagMap.size + 1);
      muteTagMap.set(key, id);
    }
    return id;
  };

  const groupRegex = /<group\b([^>]*)>([\s\S]*?)<\/group>/gi;
  let groupMatch: RegExpExecArray | null;
  let foundAnyGroups = false;

  while ((groupMatch = groupRegex.exec(xmlText)) !== null) {
    foundAnyGroups = true;
    const groupAttrs = groupMatch[1];
    const groupBody = groupMatch[2];

    const grpName = getAttr(groupAttrs, 'name') || getAttr(groupAttrs, 'tags');
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
    const grpLoopXfade = getAttr(groupAttrs, 'loopCrossfade');
    const grpTrigger = getAttr(groupAttrs, 'trigger');
    const grpSeqMode = getAttr(groupAttrs, 'seqMode');
    const grpSeqLength = getAttr(groupAttrs, 'seqLength');
    const grpSeqPos = getAttr(groupAttrs, 'seqPosition');
    const grpSilencedBy = getAttr(groupAttrs, 'silencedByTags');

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
      const loopXfadeFrames = parseInt(getAttr(tag, 'loopCrossfade') || grpLoopXfade || '0', 10) || 0;
      const loopCrossfadeMs = Math.round((loopXfadeFrames / 44.1) * 10) / 10;

      const startFrame = parseInt(getAttr(tag, 'start', '0'), 10) || 0;
      const endFrameRaw = parseInt(getAttr(tag, 'end', '0'), 10) || 0;
      const sampleEndFrame = endFrameRaw > startFrame ? endFrameRaw : undefined;

      const trigStr = (getAttr(tag, 'trigger') || grpTrigger || 'attack').toLowerCase();
      const trigger: TriggerMode =
        trigStr === 'release' ? 'release' : trigStr === 'first' ? 'first' : trigStr === 'legato' ? 'legato' : 'attack';

      const seqModeStr = (getAttr(tag, 'seqMode') || grpSeqMode || '').toLowerCase();
      const seqPosition = parseInt(getAttr(tag, 'seqPosition') || grpSeqPos || '0', 10) || undefined;
      const seqLength = parseInt(getAttr(tag, 'seqLength') || grpSeqLength || '0', 10) || undefined;
      const playLogic: SamplerPlayLogic =
        seqModeStr === 'random'
          ? 'random'
          : seqModeStr === 'round_robin' || seqModeStr === 'true_random' || (seqPosition && seqPosition > 0)
            ? 'round_robin'
            : 'velocity';

      const silencedTag = getAttr(tag, 'silencedByTags') || grpSilencedBy;
      const muteGroup = silencedTag ? getMuteGroupForTag(silencedTag.split(',')[0]) : undefined;
      const loopMode: LoopMode = loopEnabled && loopEnd > loopStart ? 'loop_continuous' : 'no_loop';

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
        loopMode,
        loopStart,
        loopEnd,
        loopCrossfadeMs,
        loops:
          loopMode !== 'no_loop'
            ? [{ id: 'loop-1', mode: loopMode, startFrame: loopStart, endFrame: loopEnd, crossfadeMs: loopCrossfadeMs }]
            : [],
        sampleStartFrame: startFrame > 0 ? startFrame : undefined,
        sampleEndFrame,
        trigger,
        playLogic,
        seqPosition,
        seqLength,
        groupName: grpName || undefined,
        muteGroup,
      });
    }
  }

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
      const startFrame = getAttrNum(tag, 'start', 0);
      const endFrameRaw = getAttrNum(tag, 'end', 0);

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
        sampleStartFrame: startFrame > 0 ? startFrame : undefined,
        sampleEndFrame: endFrameRaw > startFrame ? endFrameRaw : undefined,
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
    filter,
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
    const view = new DataView(content);
    if (view.byteLength >= 4) {
      const magic0 = view.getUint8(0);
      const magic1 = view.getUint8(1);
      const magic2 = view.getUint8(2);
      const magic3 = view.getUint8(3);

      const isEncryptedHeader =
        (magic0 === 0x12 && magic1 === 0x34 && magic2 === 0x56 && magic3 === 0x78) ||
        (magic0 === 0x7e && magic1 === 0x10) ||
        (magic0 === 0x68 && magic1 === 0x73 && magic2 === 0x69 && magic3 === 0x6e);

      if (isEncryptedHeader && view.byteLength > 64) {
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
    const loopMode: LoopMode =
      loopModeStr === 'ping_pong'
        ? 'ping_pong'
        : loopModeStr === 'loop_continuous' || loopModeStr === '1'
          ? 'loop_continuous'
          : 'no_loop';
    const loopStart = getAttrNum(tag, 'loopStart', 0);
    const loopEnd = getAttrNum(tag, 'loopEnd', 0);
    const sampleStartFrame = getAttrNum(tag, 'sampleStart', 0);
    const sampleEndRaw = getAttrNum(tag, 'sampleEnd', 0);

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
      sampleStartFrame: sampleStartFrame > 0 ? sampleStartFrame : undefined,
      sampleEndFrame: sampleEndRaw > sampleStartFrame ? sampleEndRaw : undefined,
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
// 3. Steinberg HALion Parser (.vstpreset) — Upgraded Fase 32.3
// ─────────────────────────────────────────────────────────

export function parseHalionVstPreset(
  content: string | ArrayBuffer,
  audioFiles: Map<string, ArrayBuffer> = new Map()
): ParsedSamplerPreset {
  let xmlText = '';

  if (typeof content === 'string') {
    xmlText = content;
  } else {
    const view = new DataView(content);
    if (view.byteLength >= 4) {
      const c0 = view.getUint8(0);
      const c1 = view.getUint8(1);
      const c2 = view.getUint8(2);
      const c3 = view.getUint8(3);

      if (c0 === 0x56 && c1 === 0x53 && c2 === 0x54 && c3 === 0x33) {
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

  // Extract optional HALion envelope and filter tags
  let envelope: ParsedSamplerPreset['envelope'];
  const envMatch = /<amp-envelope\b([^>]*)\/?>/i.exec(xmlText);
  if (envMatch) {
    const eTag = envMatch[1];
    envelope = {
      attack: getAttrNum(eTag, 'attack', 0.005),
      decay: getAttrNum(eTag, 'decay', 0.25),
      sustain: getAttrNum(eTag, 'sustain', 1.0),
      release: getAttrNum(eTag, 'release', 0.2),
    };
  }

  let filter: Partial<RegionFilterConfig> | undefined;
  const fltMatch = /<filter\b([^>]*)\/?>/i.exec(xmlText);
  if (fltMatch) {
    const fTag = fltMatch[1];
    const tStr = getAttr(fTag, 'type', 'lpf').toLowerCase();
    const polesNum = getAttrNum(fTag, 'poles', 4);
    filter = {
      enabled: getAttr(fTag, 'enabled', 'true').toLowerCase() !== 'false',
      type: tStr === 'hpf' ? 'hpf' : tStr === 'bpf' ? 'bpf' : tStr === 'notch' ? 'notch' : 'lpf',
      poles: polesNum === 1 ? 1 : polesNum === 2 ? 2 : 4,
      cutoffHz: getAttrNum(fTag, 'cutoff', 20000),
      resonanceDb: getAttrNum(fTag, 'resonance', 0),
      envToFilterCents: getAttrNum(fTag, 'envDepth', 0),
      velToFilterCents: 0,
      keytrackCents: getAttrNum(fTag, 'keytrack', 0),
    };
  }

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
    const pitchKeytrack = getAttrNum(tag, 'keytrack', 100);

    const loop = getAttr(tag, 'loop', 'false').toLowerCase() === 'true';
    const loopModeAttr = getAttr(tag, 'loopMode', '').toLowerCase();
    const loopStart = getAttrNum(tag, 'loopStart', 0);
    const loopEnd = getAttrNum(tag, 'loopEnd', 0);
    const loopCrossfadeMs = getAttrNum(tag, 'loopCrossfadeMs', getAttrNum(tag, 'loopXfade', 0));
    const loopMode: LoopMode =
      loopModeAttr === 'ping_pong' || loopModeAttr === 'alternating'
        ? 'ping_pong'
        : loopModeAttr === 'one_shot'
          ? 'one_shot'
          : loop && loopEnd > loopStart
            ? 'loop_continuous'
            : 'no_loop';

    const sampleStartFrame = getAttrNum(tag, 'sampleStart', 0);
    const sampleEndRaw = getAttrNum(tag, 'sampleEnd', 0);
    const reversed = getAttr(tag, 'reverse', 'false').toLowerCase() === 'true';
    const keyFadeIn = getAttrNum(tag, 'keyFadeIn', getAttrNum(tag, 'fadeLowKey', 0));
    const keyFadeOut = getAttrNum(tag, 'keyFadeOut', getAttrNum(tag, 'fadeHighKey', 0));
    const velFadeIn = getAttrNum(tag, 'velFadeIn', getAttrNum(tag, 'fadeLowVel', 0));
    const velFadeOut = getAttrNum(tag, 'velFadeOut', getAttrNum(tag, 'fadeHighVel', 0));
    const muteGroup = getAttrNum(tag, 'muteGroup', 0);
    const keyswitchRaw = getAttr(tag, 'keyswitchNote');
    const keyswitchNote = keyswitchRaw ? parseNoteNumber(keyswitchRaw, 0) : undefined;
    const triggerStr = getAttr(tag, 'trigger', 'attack').toLowerCase();
    const trigger: TriggerMode = triggerStr === 'release' ? 'release' : 'attack';

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
      pitchKeytrack,
      loopMode,
      loopStart,
      loopEnd,
      loopCrossfadeMs,
      loops:
        loopMode !== 'no_loop' && loopMode !== 'one_shot' && loopEnd > loopStart
          ? [{ id: 'loop-1', mode: loopMode, startFrame: loopStart, endFrame: loopEnd, crossfadeMs: loopCrossfadeMs }]
          : [],
      sampleStartFrame: sampleStartFrame > 0 ? sampleStartFrame : undefined,
      sampleEndFrame: sampleEndRaw > sampleStartFrame ? sampleEndRaw : undefined,
      reversed,
      keyFadeIn,
      keyFadeOut,
      velFadeIn,
      velFadeOut,
      muteGroup: muteGroup > 0 ? muteGroup : undefined,
      keyswitchNote,
      trigger,
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
    envelope,
    filter,
  };
}

// ─────────────────────────────────────────────────────────
// 4. Bitwig Studio Multisample Parser (.multisample) — Upgraded Fase 32.3
// Supports both official Bitwig nested tags (<key>, <velocity>, <loop>)
// and flat legacy attributes on <sample>.
// ─────────────────────────────────────────────────────────

export function parseBitwigMultisample(
  xmlText: string,
  audioFiles: Map<string, ArrayBuffer> = new Map()
): ParsedSamplerPreset {
  const regions: ParsedImportRegion[] = [];
  let regIndex = 0;

  const rootNameMatch = /<multisample\b[^>]*\bname=["']([^"']+)["']/i.exec(xmlText);
  const presetName = rootNameMatch ? rootNameMatch[1].trim() : 'BitwigMultisample';
  const categoryMatch = xmlText.match(/<category>([^<]+)<\/category>/i);
  const detectedCategory = categoryMatch ? categoryMatch[1].trim() : classifyPresetCategory(presetName).category;
  const { parameterSet } = classifyPresetCategory(detectedCategory + ' ' + presetName);
  const creatorMatch = xmlText.match(/<creator>([^<]+)<\/creator>/i);
  const descMatch = xmlText.match(/<(?:description|comment)>([^<]+)<\/(?:description|comment)>/i);

  // Parse <group name="..." /> definitions (0-based index in Bitwig)
  const groupNames: string[] = [];
  const groupTagRegex = /<group\b([^>]*)\/?>/gi;
  let gm: RegExpExecArray | null;
  while ((gm = groupTagRegex.exec(xmlText)) !== null) {
    const gName = getAttr(gm[1], 'name');
    if (gName) groupNames.push(gName);
  }

  // Match both self-closing <sample .../> and paired <sample ...>...</sample>
  const sampleRegex = /<sample\b([^>]*)(?:\/>|>([\s\S]*?)<\/sample>)/gi;
  let match: RegExpExecArray | null;

  while ((match = sampleRegex.exec(xmlText)) !== null) {
    const tag = match[1];
    const body = match[2] || '';
    const file = getAttr(tag, 'file');
    if (!file) continue;

    const sampleName = cleanBasename(file);

    // Nested <key .../> tag (official Bitwig format) or flat attributes
    const keyMatch = /<key\b([^>]*)\/?>/i.exec(body);
    const keyAttrs = keyMatch ? keyMatch[1] : '';
    const rootKey = parseNoteNumber(getAttr(keyAttrs, 'root') || getAttr(tag, 'root'), 60);
    const lowKey = parseNoteNumber(getAttr(keyAttrs, 'low') || getAttr(tag, 'low'), rootKey);
    const highKey = parseNoteNumber(getAttr(keyAttrs, 'high') || getAttr(tag, 'high'), rootKey);
    const keyFadeIn = Math.max(0, Math.round(getAttrNum(keyAttrs, 'low-fade', getAttrNum(tag, 'low-fade', 0))));
    const keyFadeOut = Math.max(0, Math.round(getAttrNum(keyAttrs, 'high-fade', getAttrNum(tag, 'high-fade', 0))));

    // Track in Bitwig <key track="1.0000"/> or "true"/"false"
    const trackStr = (getAttr(keyAttrs, 'track') || getAttr(tag, 'track') || '1').toLowerCase();
    const pitchKeytrack =
      trackStr === 'false' || trackStr === '0'
        ? 0
        : trackStr === 'true'
          ? 100
          : Math.round((parseFloat(trackStr) > 1 ? parseFloat(trackStr) / 100 : parseFloat(trackStr)) * 100);

    // Tuning: Bitwig <key tune="0.25"/> or <sample tune="..."/> (in semitones if decimal or small, or cents if legacy)
    let detuneCents = 0;
    const keyTuneStr = getAttr(keyAttrs, 'tune');
    const smpTuneStr = getAttr(tag, 'tune');
    if (keyTuneStr) {
      detuneCents = Math.round(parseFloat(keyTuneStr) * 100) || 0;
    } else if (smpTuneStr) {
      const val = parseFloat(smpTuneStr) || 0;
      detuneCents = smpTuneStr.includes('.') && Math.abs(val) <= 12 ? Math.round(val * 100) : Math.round(val);
    }

    // Nested <velocity .../> tag or flat attributes
    const velMatch = /<velocity\b([^>]*)\/?>/i.exec(body);
    const velAttrs = velMatch ? velMatch[1] : '';
    const lowVel = Math.max(1, Math.min(127, Math.round(getAttrNum(velAttrs, 'low', getAttrNum(tag, 'low-vel', 1)))));
    const highVel = Math.max(1, Math.min(127, Math.round(getAttrNum(velAttrs, 'high', getAttrNum(tag, 'high-vel', 127)))));
    const velFadeIn = Math.max(0, Math.round(getAttrNum(velAttrs, 'low-fade', 0)));
    const velFadeOut = Math.max(0, Math.round(getAttrNum(velAttrs, 'high-fade', 0)));

    const volumeDb = getAttrNum(tag, 'gain', 0);
    const panNorm = getAttrNum(tag, 'pan', 0);
    const pan = Math.max(-50, Math.min(50, Math.round(panNorm * 50)));

    const sampleStartFrame = Math.max(0, Math.round(getAttrNum(tag, 'sample-start', 0)));
    const sampleStopRaw = Math.round(getAttrNum(tag, 'sample-stop', 0));
    const sampleEndFrame = sampleStopRaw > sampleStartFrame ? sampleStopRaw : undefined;
    const reversed = getAttr(tag, 'reverse', 'false').toLowerCase() === 'true';

    const zoneLogicStr = getAttr(tag, 'zone-logic', '').toLowerCase();
    const playLogic: SamplerPlayLogic = zoneLogicStr === 'round-robin' ? 'round_robin' : 'velocity';

    const grpIdx = parseInt(getAttr(tag, 'group', '-1'), 10);
    const groupName = grpIdx >= 0 && grpIdx < groupNames.length ? groupNames[grpIdx] : groupNames[0];

    // Nested <loop .../> tag or flat loop attributes
    const loopMatch = /<loop\b([^>]*)\/?>/i.exec(body);
    let loopMode: LoopMode = 'no_loop';
    let loopStart = 0;
    let loopEnd = 0;
    let loopCrossfadeMs = 0;

    if (loopMatch) {
      const lAttrs = loopMatch[1];
      const modeStr = getAttr(lAttrs, 'mode', 'off').toLowerCase();
      loopStart = Math.max(0, Math.round(getAttrNum(lAttrs, 'start', 0)));
      loopEnd = Math.max(0, Math.round(getAttrNum(lAttrs, 'stop', getAttrNum(lAttrs, 'end', 0))));
      const fadeFraction = Math.max(0, Math.min(1, getAttrNum(lAttrs, 'fade', 0)));
      const loopLenFrames = Math.max(0, loopEnd - loopStart);
      loopCrossfadeMs = Math.round(((fadeFraction * loopLenFrames) / 44.1) * 10) / 10;
      if (modeStr === 'ping-pong' && loopEnd > loopStart) loopMode = 'ping_pong';
      else if ((modeStr === 'loop' || modeStr === 'sustain') && loopEnd > loopStart) loopMode = 'loop_continuous';
    } else {
      const flatLoop = getAttr(tag, 'loop', 'false').toLowerCase() === 'true';
      loopStart = Math.max(0, Math.round(getAttrNum(tag, 'loop-start', 0)));
      loopEnd = Math.max(0, Math.round(getAttrNum(tag, 'loop-end', 0)));
      if (flatLoop && loopEnd > loopStart) loopMode = 'loop_continuous';
    }

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
      pitchKeytrack: Number.isFinite(pitchKeytrack) ? pitchKeytrack : 100,
      loopMode,
      loopStart,
      loopEnd,
      loopCrossfadeMs,
      loops:
        loopMode !== 'no_loop'
          ? [{ id: 'loop-1', mode: loopMode, startFrame: loopStart, endFrame: loopEnd, crossfadeMs: loopCrossfadeMs }]
          : [],
      sampleStartFrame: sampleStartFrame > 0 ? sampleStartFrame : undefined,
      sampleEndFrame,
      reversed,
      keyFadeIn,
      keyFadeOut,
      velFadeIn,
      velFadeOut,
      playLogic,
      groupName,
    });
  }

  return {
    format: 'multisample',
    formatLabel: 'Bitwig Studio (.multisample)',
    presetName,
    modelName: presetName.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 11),
    detectedCategory,
    suggestedParameterSet: parameterSet,
    regions,
    audioBuffers: mapAudioBuffers(audioFiles),
    author: creatorMatch ? creatorMatch[1].trim() : undefined,
    description: descMatch ? descMatch[1].trim() : undefined,
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

export function mpcProgramToPreset(
  program: MpcProgram,
  audioFiles: Map<string, ArrayBuffer> = new Map()
): ParsedSamplerPreset {
  const audioBuffers = mapAudioBuffers(audioFiles);
  const byStem = new Map<string, string>();
  for (const k of audioBuffers.keys()) byStem.set(k.replace(/\.[^.]+$/, '').toLowerCase(), k);

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
        pitchKeytrack: isDrum ? 0 : 100,
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
// 4c. Ableton Sampler / Simpler (.adv) -> ParsedSamplerPreset
// ─────────────────────────────────────────────────────────

export function parseAbletonAdvPreset(
  content: ArrayBuffer | Uint8Array | string,
  audioFiles: Map<string, ArrayBuffer> = new Map(),
  fallbackName = 'AbletonSampler'
): ParsedSamplerPreset {
  const parsed = parseAbletonAdv(content, fallbackName);
  const { category, parameterSet } = classifyPresetCategory(parsed.presetName);

  const regions: ParsedImportRegion[] = parsed.parts.map((p, idx) => {
    const sampleName = cleanBasename(p.samplePath);
    const loopCrossfadeMs = Math.round((p.loopCrossfadeFrames / 44.1) * 10) / 10;
    return {
      id: `adv_zone_${String(idx + 1).padStart(3, '0')}`,
      sampleName,
      samplePath: p.samplePath,
      rootKey: p.rootKey,
      lowKey: p.lowKey,
      highKey: p.highKey,
      lowVel: p.lowVel,
      highVel: p.highVel,
      detuneCents: p.detuneCents,
      volumeDb: Math.round(p.volumeDb * 100) / 100,
      pan: p.pan,
      pitchKeytrack: p.pitchKeytrack,
      sampleStartFrame: p.sampleStartFrame > 0 ? p.sampleStartFrame : undefined,
      sampleEndFrame: p.sampleEndFrame,
      reversed: p.reversed,
      keyFadeIn: p.keyFadeIn,
      keyFadeOut: p.keyFadeOut,
      velFadeIn: p.velFadeIn,
      velFadeOut: p.velFadeOut,
      loopMode: p.loopMode,
      loopStart: p.loopStart,
      loopEnd: p.loopEnd,
      loopCrossfadeMs,
      loops:
        p.loopMode !== 'no_loop'
          ? [{ id: 'loop-1', mode: p.loopMode, startFrame: p.loopStart, endFrame: p.loopEnd, crossfadeMs: loopCrossfadeMs }]
          : [],
      playLogic: parsed.playLogic,
      velToVolumeDepth: parsed.velToVolumeDepth,
    };
  });

  return {
    format: 'ableton_adv',
    formatLabel: `Ableton ${parsed.deviceType} (.adv)`,
    presetName: parsed.presetName,
    modelName: parsed.presetName.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 11),
    detectedCategory: category,
    suggestedParameterSet: parameterSet,
    regions,
    audioBuffers: mapAudioBuffers(audioFiles),
    envelope: parsed.ampEnv
      ? {
          attack: parsed.ampEnv.attackSec ?? 0.005,
          decay: parsed.ampEnv.decaySec ?? 0.25,
          sustain: parsed.ampEnv.sustainLevel ?? 1.0,
          release: parsed.ampEnv.releaseSec ?? 0.2,
        }
      : undefined,
    filter: parsed.filter,
    pitchEnv: parsed.pitchEnv,
  };
}

// ─────────────────────────────────────────────────────────
// 4d. Apple Logic EXS24 (.exs) -> ParsedSamplerPreset
// ─────────────────────────────────────────────────────────

export function parseExs24Preset(
  buffer: ArrayBuffer,
  audioFiles: Map<string, ArrayBuffer> = new Map(),
  fallbackName = 'EXS24Instrument'
): ParsedSamplerPreset {
  const parsed = parseExs24(buffer, fallbackName);
  const { category, parameterSet } = classifyPresetCategory(parsed.presetName);

  const regions: ParsedImportRegion[] = parsed.zones.map((z, idx) => {
    const smp = parsed.samples[z.sampleIndex];
    const grp = parsed.groups[z.groupIndex];
    const rawFile = smp?.fileName || smp?.filePath || `${z.name}.wav`;
    const sampleName = cleanBasename(rawFile);

    return {
      id: `exs_zone_${String(idx + 1).padStart(3, '0')}`,
      sampleName,
      samplePath: smp?.filePath || sampleName,
      rootKey: z.rootKey,
      lowKey: z.lowKey,
      highKey: z.highKey,
      lowVel: z.lowVel,
      highVel: z.highVel,
      detuneCents: z.coarseTuneSt * 100 + z.fineTuneCents,
      volumeDb: z.volumeDb + (grp?.volumeDb ?? 0),
      pan: Math.max(-50, Math.min(50, z.pan + (grp?.pan ?? 0))),
      pitchKeytrack: z.pitchKeytrack,
      sampleStartFrame: z.sampleStartFrame > 0 ? z.sampleStartFrame : undefined,
      sampleEndFrame: z.sampleEndFrame > z.sampleStartFrame ? z.sampleEndFrame : undefined,
      reversed: z.reversed,
      keyFadeIn: grp?.keyCrossfade ?? 0,
      keyFadeOut: grp?.keyCrossfade ?? 0,
      velFadeIn: grp?.velCrossfade ?? 0,
      velFadeOut: grp?.velCrossfade ?? 0,
      fadeCurve: z.loopEqualPower ? 'equal-power' : 'linear',
      loopMode: z.loopMode,
      loopStart: z.loopStart,
      loopEnd: z.loopEnd,
      loopCrossfadeMs: z.loopCrossfadeMs,
      loops:
        z.loopMode !== 'no_loop' && z.loopMode !== 'one_shot'
          ? [{ id: 'loop-1', mode: z.loopMode, startFrame: z.loopStart, endFrame: z.loopEnd, crossfadeMs: z.loopCrossfadeMs }]
          : [],
      groupName: grp?.name,
      muteGroup: grp && grp.muteGroup > 0 ? grp.muteGroup : undefined,
      trigger: grp?.trigger ?? 'attack',
      playLogic: grp?.playLogic ?? 'velocity',
      keyswitchNote: grp?.keyswitchNote,
    };
  });

  return {
    format: 'exs24',
    formatLabel: 'Apple Logic EXS24 (.exs)',
    presetName: parsed.presetName,
    modelName: parsed.presetName.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 11),
    detectedCategory: category,
    suggestedParameterSet: parameterSet,
    regions,
    audioBuffers: mapAudioBuffers(audioFiles),
    envelope: {
      attack: parsed.ampEnv.attackSec,
      hold: parsed.ampEnv.holdSec,
      decay: parsed.ampEnv.decaySec,
      sustain: parsed.ampEnv.sustainLevel,
      release: parsed.ampEnv.releaseSec,
    },
    filter: parsed.filter,
    polyphony: parsed.polyphony,
    pitchBendUpSt: parsed.pitchBendUpSt,
    pitchBendDownSt: parsed.pitchBendDownSt,
  };
}

// ─────────────────────────────────────────────────────────
// 4e. TAL-Sampler (.talsmpl) -> ParsedSamplerPreset
// ─────────────────────────────────────────────────────────

export function parseTalSamplerPreset(
  xmlText: string,
  audioFiles: Map<string, ArrayBuffer> = new Map(),
  fallbackName = 'TalSamplerPreset'
): ParsedSamplerPreset {
  const parsed = parseTalSampler(xmlText, fallbackName);
  const { category, parameterSet } = classifyPresetCategory(parsed.presetName);

  const regions: ParsedImportRegion[] = parsed.zones.map((z, idx) => {
    const sampleName = cleanBasename(z.samplePath);
    const loopCrossfadeMs = Math.round((z.loopCrossfadeFrames / 44.1) * 10) / 10;
    return {
      id: `tal_zone_${String(idx + 1).padStart(3, '0')}`,
      sampleName,
      samplePath: z.samplePath,
      rootKey: z.rootKey,
      lowKey: z.lowKey,
      highKey: z.highKey,
      lowVel: z.lowVel,
      highVel: z.highVel,
      detuneCents: z.detuneCents,
      volumeDb: Math.round(z.volumeDb * 100) / 100,
      pan: z.pan,
      pitchKeytrack: z.pitchKeytrack,
      sampleStartFrame: z.sampleStartFrame > 0 ? z.sampleStartFrame : undefined,
      sampleEndFrame: z.sampleEndFrame,
      reversed: z.reversed,
      loopMode: z.loopMode,
      loopStart: z.loopStart,
      loopEnd: z.loopEnd,
      loopCrossfadeMs,
      loops:
        z.loopMode !== 'no_loop'
          ? [{ id: 'loop-1', mode: z.loopMode, startFrame: z.loopStart, endFrame: z.loopEnd, crossfadeMs: loopCrossfadeMs }]
          : [],
      groupName: `Layer ${z.layerIndex + 1}`,
      muteGroup: z.muteGroup > 0 ? z.muteGroup : undefined,
      playLogic: z.playLogic,
    };
  });

  return {
    format: 'tal_sampler',
    formatLabel: 'TAL-Sampler (.talsmpl)',
    presetName: parsed.presetName,
    modelName: parsed.presetName.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 11),
    detectedCategory: category,
    suggestedParameterSet: parameterSet,
    regions,
    audioBuffers: mapAudioBuffers(audioFiles),
    envelope: {
      attack: parsed.ampEnv.attackSec,
      hold: parsed.ampEnv.holdSec,
      decay: parsed.ampEnv.decaySec,
      sustain: parsed.ampEnv.sustainLevel,
      release: parsed.ampEnv.releaseSec,
    },
    filter: parsed.filter,
    pitchEnv: parsed.pitchEnv,
    polyphony: parsed.polyphony,
    pitchBendUpSt: parsed.pitchBendRangeSt,
    pitchBendDownSt: parsed.pitchBendRangeSt,
  };
}

// ─────────────────────────────────────────────────────────
// 4f. CWITEC TX16Wx (.txprog) -> ParsedSamplerPreset
// ─────────────────────────────────────────────────────────

export function parseTx16WxPreset(
  xmlText: string,
  audioFiles: Map<string, ArrayBuffer> = new Map(),
  fallbackName = 'TX16WxProgram'
): ParsedSamplerPreset {
  const parsed = parseTx16WxProgram(xmlText, fallbackName);
  const { category, parameterSet } = classifyPresetCategory(parsed.presetName);

  const regions: ParsedImportRegion[] = parsed.regions.map((r) => {
    const sampleName = cleanBasename(r.samplePath);
    const loopCrossfadeMs = Math.round((r.loopCrossfadeFrames / 44.1) * 10) / 10;
    return {
      id: r.id,
      sampleName,
      samplePath: r.samplePath,
      rootKey: r.rootKey,
      lowKey: r.lowKey,
      highKey: r.highKey,
      lowVel: r.lowVel,
      highVel: r.highVel,
      detuneCents: r.detuneCents,
      volumeDb: r.volumeDb,
      pan: r.pan,
      pitchKeytrack: r.pitchKeytrack,
      sampleStartFrame: r.sampleStartFrame > 0 ? r.sampleStartFrame : undefined,
      sampleEndFrame: r.sampleEndFrame,
      reversed: r.reversed,
      keyFadeIn: r.keyFadeIn,
      keyFadeOut: r.keyFadeOut,
      velFadeIn: r.velFadeIn,
      velFadeOut: r.velFadeOut,
      loopMode: r.loopMode,
      loopStart: r.loopStart,
      loopEnd: r.loopEnd,
      loopCrossfadeMs,
      loops: r.loops,
      groupName: r.groupName,
      muteGroup: r.muteGroup > 0 ? r.muteGroup : undefined,
      trigger: r.trigger,
    };
  });

  return {
    format: 'tx16wx',
    formatLabel: 'CWITEC TX16Wx (.txprog)',
    presetName: parsed.presetName,
    modelName: parsed.presetName.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 11),
    detectedCategory: category,
    suggestedParameterSet: parameterSet,
    regions,
    audioBuffers: mapAudioBuffers(audioFiles),
    envelope: {
      attack: parsed.primaryAmpEnv.attackSec,
      decay: parsed.primaryAmpEnv.decaySec,
      sustain: parsed.primaryAmpEnv.sustainLevel,
      release: parsed.primaryAmpEnv.releaseSec,
    },
    filter: parsed.primaryFilter,
    pitchEnv: parsed.primaryPitchEnv,
    author: parsed.author,
  };
}

// ─────────────────────────────────────────────────────────
// 4g. Korg (.KMP + .KSF) -> ParsedSamplerPreset
// ─────────────────────────────────────────────────────────

export function parseKorgKmpPreset(
  kmpBuffer: ArrayBuffer,
  siblingFiles: Map<string, ArrayBuffer> = new Map(),
  fallbackName = 'KorgMultisample'
): ParsedSamplerPreset {
  const kmp = parseKorgKmp(kmpBuffer, fallbackName);
  const { category, parameterSet } = classifyPresetCategory(kmp.presetName);
  const audioBuffers = new Map<string, ArrayBuffer>();
  const ksfByUpper = new Map<string, ArrayBuffer>();
  for (const [k, v] of siblingFiles.entries()) {
    const base = cleanBasename(k);
    ksfByUpper.set(base.toUpperCase(), v);
    if (base.toLowerCase().endsWith('.wav')) {
      audioBuffers.set(base, v);
    }
  }

  const regions: ParsedImportRegion[] = [];
  kmp.zones.forEach((z, idx) => {
    const ksfKey = cleanBasename(z.ksfFilename).toUpperCase();
    const ksfBuf = ksfByUpper.get(ksfKey);
    const wavName = ksfKey.replace(/\.KSF$/i, '') + '.wav';
    let loopMode: LoopMode = 'no_loop';
    let loopStart = 0;
    let loopEnd = 0;
    let reversed = false;
    let startFrame = 0;

    if (ksfBuf && isKorgKmpOrKsfBuffer(ksfBuf) === 'ksf') {
      const parsedKsf = parseKorgKsf(ksfBuf, ksfKey);
      audioBuffers.set(wavName, parsedKsf.wavBuffer);
      loopMode = parsedKsf.loopEnabled ? 'loop_continuous' : 'no_loop';
      loopStart = parsedKsf.loopStartFrame;
      loopEnd = parsedKsf.loopEndFrame;
      reversed = parsedKsf.reversed;
      startFrame = kmp.useSecondStart ? parsedKsf.secondStartFrame : parsedKsf.startFrame;
    }

    regions.push({
      id: `korg_zone_${String(idx + 1).padStart(3, '0')}`,
      sampleName: wavName,
      samplePath: wavName,
      rootKey: z.rootKey,
      lowKey: z.lowKey,
      highKey: z.highKey,
      lowVel: 1,
      highVel: 127,
      detuneCents: z.detuneCents,
      volumeDb: z.volumeDb,
      pan: z.pan,
      pitchKeytrack: z.pitchKeytrack,
      sampleStartFrame: startFrame > 0 ? startFrame : undefined,
      reversed,
      loopMode,
      loopStart,
      loopEnd,
      loops:
        loopMode !== 'no_loop'
          ? [{ id: 'loop-1', mode: loopMode, startFrame: loopStart, endFrame: loopEnd, crossfadeMs: 0 }]
          : [],
    });
  });

  return {
    format: 'korg_kmp',
    formatLabel: 'Korg Trinity/Triton/M3 (.KMP/.KSF)',
    presetName: kmp.presetName,
    modelName: kmp.presetName.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 11),
    detectedCategory: category,
    suggestedParameterSet: parameterSet,
    regions,
    audioBuffers,
  };
}

// ─────────────────────────────────────────────────────────
// 4h. MMA Downloadable Sounds (.dls) -> ParsedSamplerPreset
// ─────────────────────────────────────────────────────────

export function parseDlsPreset(
  buffer: ArrayBuffer,
  instrumentIndex = 0,
  fallbackName = 'DLSBank'
): ParsedSamplerPreset {
  const bank = parseDlsBank(buffer, fallbackName);
  const inst = bank.instruments[Math.max(0, Math.min(bank.instruments.length - 1, instrumentIndex))] ?? {
    index: 0,
    bank: 0,
    program: 0,
    isDrum: false,
    name: bank.bankName,
    regions: [],
    ampEnv: {
      delaySec: 0,
      attackSec: 0.005,
      holdSec: 0,
      decaySec: 0.25,
      sustainLevel: 1,
      releaseSec: 0.2,
      velModDepth: 100,
    },
    filter: {
      enabled: false,
      type: 'lpf' as const,
      poles: 2 as const,
      cutoffHz: 20000,
      resonanceDb: 0,
      envToFilterCents: 0,
      velToFilterCents: 0,
      keytrackCents: 0,
    },
  };

  const audioBuffers = new Map<string, ArrayBuffer>();
  for (const w of bank.waves) {
    audioBuffers.set(w.name, w.wavBuffer);
  }

  const regions: ParsedImportRegion[] = inst.regions.map((r, idx) => {
    const wave = bank.waves[r.waveIndex];
    const sampleName = wave?.name ?? `DLS_Wave_${r.waveIndex + 1}.wav`;
    return {
      id: `dls_zone_${String(idx + 1).padStart(3, '0')}`,
      sampleName,
      samplePath: sampleName,
      rootKey: r.rootKey,
      lowKey: r.lowKey,
      highKey: r.highKey,
      lowVel: r.lowVel,
      highVel: r.highVel,
      detuneCents: r.detuneCents,
      volumeDb: r.volumeDb,
      pan: r.pan,
      loopMode: r.loopMode,
      loopStart: r.loopStart,
      loopEnd: r.loopEnd,
      loops:
        r.loopMode !== 'no_loop'
          ? [{ id: 'loop-1', mode: r.loopMode, startFrame: r.loopStart, endFrame: r.loopEnd, crossfadeMs: 0 }]
          : [],
      muteGroup: r.keyGroup > 0 ? r.keyGroup : undefined,
    };
  });

  const { category, parameterSet } = classifyPresetCategory(inst.name);
  return {
    format: 'dls',
    formatLabel: 'MMA Downloadable Sounds (.dls)',
    presetName: inst.name,
    modelName: inst.name.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 11),
    detectedCategory: inst.isDrum ? 'Drums & Percussion' : category,
    suggestedParameterSet: parameterSet,
    regions,
    audioBuffers,
    envelope: {
      delay: inst.ampEnv.delaySec,
      attack: inst.ampEnv.attackSec,
      hold: inst.ampEnv.holdSec,
      decay: inst.ampEnv.decaySec,
      sustain: inst.ampEnv.sustainLevel,
      release: inst.ampEnv.releaseSec,
    },
    filter: inst.filter,
    pitchEnv: inst.pitchEnv,
    author: bank.author,
    description: bank.comment,
    programCount: bank.instruments.length,
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

  const sliceResult = parseSliceFile(buffer, filename);
  let sliceFrames: number[] = [];
  let markers: ParsedSliceMarker[] = [];

  if (sliceResult && sliceResult.sliceFrames.length > 1) {
    sliceFrames = [...sliceResult.sliceFrames];
    markers = [...sliceResult.markers];
  } else if (options?.gridSlices && options.gridSlices > 1) {
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

  if (sliceFrames.length > 0) {
    const decoded = filename.toLowerCase().endsWith('.aif') || filename.toLowerCase().endsWith('.aiff')
      ? decodeAiff(buffer)
      : decodeWav(buffer);

    const totalFrames = decoded.channels[0].length;
    const baseMidi = 36;

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
    const singleName = cleanBasename(filename);
    audioBuffers.set(singleName, buffer);
    let instInfo: ReturnType<typeof decodeWav>['instrument'] | undefined;
    try {
      const decodedSingle =
        filename.toLowerCase().endsWith('.aif') ||
        filename.toLowerCase().endsWith('.aiff') ||
        filename.toLowerCase().endsWith('.aifc')
          ? decodeAiff(buffer)
          : decodeWav(buffer);
      instInfo = decodedSingle.instrument;
    } catch {
      // ignore if non-PCM raw
    }
    const hasLoop =
      instInfo?.loopStart !== undefined &&
      instInfo?.loopEnd !== undefined &&
      instInfo.loopEnd > instInfo.loopStart;

    regions.push({
      id: 'chain_single_001',
      sampleName: singleName,
      samplePath: singleName,
      rootKey: instInfo?.rootKey ?? 60,
      lowKey: instInfo?.lowKey ?? 0,
      highKey: instInfo?.highKey ?? 127,
      lowVel: instInfo?.lowVelocity ?? 1,
      highVel: instInfo?.highVelocity ?? 127,
      detuneCents: instInfo?.detune ?? 0,
      volumeDb: instInfo?.gainDb ?? 0,
      pan: 0,
      loopMode: hasLoop ? instInfo?.loopMode ?? 'loop_continuous' : 'no_loop',
      loopStart: hasLoop ? instInfo!.loopStart! : 0,
      loopEnd: hasLoop ? instInfo!.loopEnd! : 0,
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
      // ignore
    }
  }

  if (activeWav && activeWav.byteLength > 44) {
    const decoded = decodeWav(activeWav);
    const totalFrames = decoded.channels[0].length;
    const baseMidi = 36;

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

export interface ArchiveSamplerProgramInfo {
  id: string;
  index: number;
  name: string;
  format:
    | 'xpm'
    | 'dspreset'
    | 'nki'
    | 'vstpreset'
    | 'multisample'
    | 'sfz'
    | 'ableton_adv'
    | 'exs24'
    | 'tal_sampler'
    | 'tx16wx'
    | 'korg_kmp'
    | 'dls'
    | 'akai_disk'
    | 'emu_disk'
    | 'roland_disk'
    | 'ensoniq_disk'
    | 'yamaha_disk';
  regionCount?: number;
  detail?: string;
}

/**
 * Lists all playable sampler program files inside a container:
 * .zip / .xpn archives or vintage sampler disk images (Akai, E-mu, Roland, Ensoniq, Yamaha).
 */
export async function listZipSamplerPrograms(
  filename: string,
  data: ArrayBuffer
): Promise<ArchiveSamplerProgramInfo[]> {
  const lower = filename.toLowerCase();

  // Vintage Sampler Disk Images (.iso, .img, .dsk, .out, .hda, .efe, .ede)
  if (typeof data !== 'string') {
    // 1. Akai S-Series Disk Image
    if (isAkaiDiskImage(data)) {
      try {
        const akaiProgs = listAkaiDiskPrograms(data);
        if (akaiProgs.length > 0) return akaiProgs;
      } catch {
        // Fallback
      }
    }

    // 2. E-mu Emulator III / EOS Disk Image
    if (isEmuDiskImage(data)) {
      try {
        const emuProgs = listEmuDiskPrograms(data);
        if (emuProgs.length > 0) return emuProgs;
      } catch {
        // Fallback
      }
    }

    // 3. Roland S-7xx Disk Image
    if (isRolandDiskImage(data)) {
      try {
        const rolandProgs = listRolandDiskPrograms(data);
        if (rolandProgs.length > 0) return rolandProgs;
      } catch {
        // Fallback
      }
    }

    // 4. Ensoniq EPS / ASR Disk Image
    if (isEnsoniqDiskImage(data)) {
      try {
        const ensoniqProgs = listEnsoniqDiskPrograms(data);
        if (ensoniqProgs.length > 0) return ensoniqProgs;
      } catch {
        // Fallback
      }
    }

    // 5. Yamaha A-Series Disk Image
    if (isYamahaDiskImage(data)) {
      try {
        const yamahaProgs = listYamahaDiskPrograms(data);
        if (yamahaProgs.length > 0) return yamahaProgs;
      } catch {
        // Fallback
      }
    }
  }

  if (!lower.endsWith('.zip') && !lower.endsWith('.xpn') && !isZipHeader(data)) {
    return [];
  }
  const zipBytes = new Uint8Array(data);
  const zipIndex = indexZipArchive(zipBytes);
  const programs: ArchiveSamplerProgramInfo[] = [];

  for (const entry of zipIndex) {
    const norm = entry.path.replace(/\\/g, '/');
    const nLower = norm.toLowerCase();
    if (nLower.includes('__macosx/') || nLower.includes('[previews]')) continue;
    const base = cleanBasename(norm);
    if (base.startsWith('.') || base.startsWith('._')) continue;

    if (/\.(xpm|xty|xtd)$/.test(nLower)) {
      let progName = base.replace(/\.(xpm|xty|xtd)$/i, '');
      let regionCount: number | undefined;
      let detail = nLower.endsWith('.xtd') ? 'MPC3 Drum Track' : nLower.endsWith('.xty') ? 'MPC3 Keygroup Track' : 'MPC Program';
      try {
        const entryBytes = extractZipEntry(zipBytes, entry);
        const parsed = await parseMpcXpm(entryBytes);
        if (parsed.name) progName = parsed.name;
        regionCount = parsed.instruments.reduce((acc, inst) => acc + inst.layers.length, 0);
        detail = `MPC ${parsed.type} (${parsed.sourceVariant})`;
      } catch {
        // fallback to filename
      }
      if (regionCount !== 0) {
        programs.push({
          id: norm,
          index: programs.length,
          name: progName,
          format: 'xpm',
          regionCount,
          detail,
        });
      }
    } else if (nLower.endsWith('.dspreset')) {
      programs.push({
        id: norm,
        index: programs.length,
        name: base.replace(/\.dspreset$/i, ''),
        format: 'dspreset',
        detail: 'Decent Sampler Preset',
      });
    } else if (nLower.endsWith('.nki') || nLower.endsWith('.nki.xml')) {
      programs.push({
        id: norm,
        index: programs.length,
        name: base.replace(/\.nki(\.xml)?$/i, ''),
        format: 'nki',
        detail: 'Kontakt Instrument',
      });
    } else if (nLower.endsWith('.vstpreset') || nLower.endsWith('.vstpreset.xml')) {
      programs.push({
        id: norm,
        index: programs.length,
        name: base.replace(/\.vstpreset(\.xml)?$/i, ''),
        format: 'vstpreset',
        detail: 'HALion VST Preset',
      });
    } else if (nLower.endsWith('multisample.xml') || nLower.endsWith('.multisample')) {
      programs.push({
        id: norm,
        index: programs.length,
        name: base.replace(/\.(multisample|xml)$/i, '') || 'Bitwig Multisample',
        format: 'multisample',
        detail: 'Bitwig Multisample',
      });
    } else if (nLower.endsWith('.sfz')) {
      programs.push({
        id: norm,
        index: programs.length,
        name: base.replace(/\.sfz$/i, ''),
        format: 'sfz',
        detail: 'SFZ Instrument',
      });
    } else if (nLower.endsWith('.adv')) {
      programs.push({
        id: norm,
        index: programs.length,
        name: base.replace(/\.adv$/i, ''),
        format: 'ableton_adv',
        detail: 'Ableton Sampler / Simpler',
      });
    } else if (nLower.endsWith('.exs')) {
      programs.push({
        id: norm,
        index: programs.length,
        name: base.replace(/\.exs$/i, ''),
        format: 'exs24',
        detail: 'Logic EXS24 Instrument',
      });
    } else if (nLower.endsWith('.talsmpl')) {
      programs.push({
        id: norm,
        index: programs.length,
        name: base.replace(/\.talsmpl$/i, ''),
        format: 'tal_sampler',
        detail: 'TAL-Sampler Preset',
      });
    } else if (nLower.endsWith('.txprog')) {
      programs.push({
        id: norm,
        index: programs.length,
        name: base.replace(/\.txprog$/i, ''),
        format: 'tx16wx',
        detail: 'CWITEC TX16Wx Program',
      });
    } else if (nLower.endsWith('.kmp')) {
      programs.push({
        id: norm,
        index: programs.length,
        name: base.replace(/\.kmp$/i, ''),
        format: 'korg_kmp',
        detail: 'Korg Multisample (.KMP)',
      });
    } else if (nLower.endsWith('.dls')) {
      programs.push({
        id: norm,
        index: programs.length,
        name: base.replace(/\.dls$/i, ''),
        format: 'dls',
        detail: 'Downloadable Sounds (.DLS)',
      });
    } else if (nLower.endsWith('.qpat')) {
      programs.push({
        id: norm,
        index: programs.length,
        name: base.replace(/\.qpat$/i, ''),
        format: 'waldorf_qpat',
        detail: 'Waldorf Quantum/Iridium Patch',
      });
    } else if (nLower.endsWith('patch.json')) {
      programs.push({
        id: norm,
        index: programs.length,
        name: base.replace(/patch\.json$/i, '') || 'OP-XY Patch',
        format: 'opxy',
        detail: 'Teenage Engineering OP-XY',
      });
    } else if (nLower.endsWith('.tvpst') || nLower.endsWith('elmulti')) {
      programs.push({
        id: norm,
        index: programs.length,
        name: base.replace(/\.(tvpst|elmulti)$/i, ''),
        format: 'tonverk',
        detail: 'Elektron Tonverk Preset',
      });
    } else if (nLower.endsWith('.dexpreset')) {
      programs.push({
        id: norm,
        index: programs.length,
        name: base.replace(/\.dexpreset$/i, ''),
        format: 'disting_ex',
        detail: 'Expert Sleepers Disting EX',
      });
    } else if (nLower.endsWith('.grp')) {
      programs.push({
        id: norm,
        index: programs.length,
        name: base.replace(/\.grp$/i, ''),
        format: 'prophet_x',
        detail: 'Sequential Prophet X (.grp)',
      });
    } else if (nLower.endsWith('.kit') || nLower.endsWith('.s24')) {
      programs.push({
        id: norm,
        index: programs.length,
        name: base.replace(/\.(kit|s24)$/i, ''),
        format: 'isla_s2400',
        detail: 'Isla Instruments S2400 Kit',
      });
    } else if (nLower.endsWith('.korgmultisample')) {
      programs.push({
        id: norm,
        index: programs.length,
        name: base.replace(/\.korgmultisample$/i, ''),
        format: 'korg_modern',
        detail: 'Korg Modern Multisample',
      });
    } else if (nLower.endsWith('.3wv')) {
      programs.push({
        id: norm,
        index: programs.length,
        name: base.replace(/\.3wv$/i, ''),
        format: 'third_wave',
        detail: 'Groove Synthesis 3rd Wave',
      });
    } else if (nLower.endsWith('.svz')) {
      programs.push({
        id: norm,
        index: programs.length,
        name: base.replace(/\.svz$/i, ''),
        format: 'zencore',
        detail: 'Roland Zen-Core / SP-404MKII',
      });
    }
  }

  return programs;
}

export async function parseUniversalSampler(
  filename: string,
  data: ArrayBuffer | string,
  zipEntriesOrDecodedWav?: Map<string, Uint8Array> | ArrayBuffer,
  decodedWavBufferOrProgramPath?: ArrayBuffer | string,
  selectedProgramPath?: string
): Promise<ParsedSamplerPreset> {
  const lower = filename.toLowerCase();
  const zipEntries = zipEntriesOrDecodedWav instanceof Map ? zipEntriesOrDecodedWav : undefined;
  const decodedWav =
    zipEntriesOrDecodedWav instanceof ArrayBuffer
      ? zipEntriesOrDecodedWav
      : decodedWavBufferOrProgramPath instanceof ArrayBuffer
        ? decodedWavBufferOrProgramPath
        : undefined;
  const targetProgramPath =
    typeof decodedWavBufferOrProgramPath === 'string' ? decodedWavBufferOrProgramPath : selectedProgramPath;

  // 0. Vintage Sampler Disk Images (Akai, E-mu, Roland, Ensoniq, Yamaha)
  if (typeof data !== 'string') {
    if (isAkaiDiskImage(data)) {
      return parseAkaiDiskProgram(data, targetProgramPath);
    }
    if (isEmuDiskImage(data)) {
      return parseEmuDiskProgram(data, targetProgramPath);
    }
    if (isRolandDiskImage(data)) {
      return parseRolandDiskProgram(data, targetProgramPath);
    }
    if (isEnsoniqDiskImage(data)) {
      return parseEnsoniqDiskProgram(data, targetProgramPath);
    }
    if (isYamahaDiskImage(data)) {
      return parseYamahaDiskProgram(data, targetProgramPath);
    }
  }

  // 1. If it's a ZIP archive containing a bank + samples (also Akai .xpn, Bitwig .multisample)
  if (lower.endsWith('.zip') || lower.endsWith('.xpn') || (!zipEntries && typeof data !== 'string' && isZipHeader(data))) {
    const rawZipBytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
    const zipIndex = indexZipArchive(rawZipBytes);
    const indexMap = new Map<string, ZipCentralEntry>();
    const audioEntries: ZipCentralEntry[] = [];
    const ksfEntries: ZipCentralEntry[] = [];

    for (const entry of zipIndex) {
      const norm = entry.path.replace(/\\/g, '/');
      indexMap.set(norm, entry);
      const nLower = norm.toLowerCase();
      if (isSupportedAudioFileName(nLower)) {
        audioEntries.push(entry);
      } else if (nLower.endsWith('.ksf')) {
        ksfEntries.push(entry);
      }
    }

    let dspresetEntry: string | undefined;
    let nkiEntry: string | undefined;
    let vstpresetEntry: string | undefined;
    let multisampleEntry: string | undefined;
    let advEntry: string | undefined;
    let exsEntry: string | undefined;
    let talEntry: string | undefined;
    let txprogEntry: string | undefined;
    let kmpEntry: string | undefined;
    let dlsEntry: string | undefined;
    let qpatEntry: string | undefined;
    let opxyEntry: string | undefined;
    let tonverkEntry: string | undefined;
    let distingEntry: string | undefined;
    let prophetEntry: string | undefined;
    let islaEntry: string | undefined;
    let korgModernEntry: string | undefined;
    let thirdWaveEntry: string | undefined;
    let zenCoreEntry: string | undefined;
    const xpmEntries: string[] = [];

    const normTarget = targetProgramPath?.replace(/\\/g, '/');
    for (const name of indexMap.keys()) {
      if (normTarget && name !== normTarget) continue;
      const nLower = name.toLowerCase();
      if (nLower.endsWith('.dspreset')) dspresetEntry = name;
      else if (nLower.endsWith('.nki.xml') || nLower.endsWith('.nki')) nkiEntry = name;
      else if (nLower.endsWith('.vstpreset.xml') || nLower.endsWith('.vstpreset')) vstpresetEntry = name;
      else if (nLower.endsWith('multisample.xml')) multisampleEntry = name;
      else if (nLower.endsWith('.adv')) advEntry = name;
      else if (nLower.endsWith('.exs')) exsEntry = name;
      else if (nLower.endsWith('.talsmpl')) talEntry = name;
      else if (nLower.endsWith('.txprog')) txprogEntry = name;
      else if (nLower.endsWith('.kmp')) kmpEntry = name;
      else if (nLower.endsWith('.dls')) dlsEntry = name;
      else if (nLower.endsWith('.qpat')) qpatEntry = name;
      else if (nLower.endsWith('patch.json')) opxyEntry = name;
      else if (nLower.endsWith('.tvpst') || nLower.endsWith('elmulti')) tonverkEntry = name;
      else if (nLower.endsWith('.dexpreset')) distingEntry = name;
      else if (nLower.endsWith('.grp')) prophetEntry = name;
      else if (nLower.endsWith('.kit') || nLower.endsWith('.s24')) islaEntry = name;
      else if (nLower.endsWith('.korgmultisample')) korgModernEntry = name;
      else if (nLower.endsWith('.3wv')) thirdWaveEntry = name;
      else if (nLower.endsWith('.svz')) zenCoreEntry = name;
      else if (/\.(xpm|xty|xtd)$/.test(nLower) && !nLower.includes('[previews]')) xpmEntries.push(name);
    }

    const extractAudioBuffers = async (onlyStems?: Set<string>): Promise<Map<string, ArrayBuffer>> => {
      const audioFiles = new Map<string, ArrayBuffer>();
      for (const entry of audioEntries) {
        const cleanKey = cleanBasename(entry.path);
        const stem = cleanKey.replace(/\.[^.]+$/, '').toLowerCase();
        if (onlyStems && !onlyStems.has(stem) && !onlyStems.has(stem.trim())) continue;
        const bytes = extractZipEntry(rawZipBytes, entry);
        let rawBuf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        if (!/\.(wav|aif|aiff)$/i.test(cleanKey)) {
          try {
            rawBuf = await transcodeAnyAudioToWavBuffer(rawBuf, cleanKey);
          } catch {
            // Keep rawBuf if transcoding fails
          }
        }
        audioFiles.set(cleanKey, rawBuf);
      }
      return audioFiles;
    };

    if (dspresetEntry) {
      const xml = new TextDecoder('utf-8').decode(extractZipEntry(rawZipBytes, indexMap.get(dspresetEntry)!));
      return parseDecentSamplerPreset(xml, await extractAudioBuffers());
    }
    if (nkiEntry) {
      const bytes = extractZipEntry(rawZipBytes, indexMap.get(nkiEntry)!);
      return parseKontaktNki(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, await extractAudioBuffers());
    }
    if (vstpresetEntry) {
      const bytes = extractZipEntry(rawZipBytes, indexMap.get(vstpresetEntry)!);
      return parseHalionVstPreset(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, await extractAudioBuffers());
    }
    if (multisampleEntry) {
      const xml = new TextDecoder('utf-8').decode(extractZipEntry(rawZipBytes, indexMap.get(multisampleEntry)!));
      return parseBitwigMultisample(xml, await extractAudioBuffers());
    }
    if (advEntry) {
      const bytes = extractZipEntry(rawZipBytes, indexMap.get(advEntry)!);
      return parseAbletonAdvPreset(bytes, await extractAudioBuffers(), cleanBasename(advEntry).replace(/\.adv$/i, ''));
    }
    if (exsEntry) {
      const bytes = extractZipEntry(rawZipBytes, indexMap.get(exsEntry)!);
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      return parseExs24Preset(buf, await extractAudioBuffers(), cleanBasename(exsEntry).replace(/\.exs$/i, ''));
    }
    if (talEntry) {
      const xml = new TextDecoder('utf-8').decode(extractZipEntry(rawZipBytes, indexMap.get(talEntry)!));
      return parseTalSamplerPreset(xml, await extractAudioBuffers(), cleanBasename(talEntry).replace(/\.talsmpl$/i, ''));
    }
    if (txprogEntry) {
      const xml = new TextDecoder('utf-8').decode(extractZipEntry(rawZipBytes, indexMap.get(txprogEntry)!));
      return parseTx16WxPreset(xml, await extractAudioBuffers(), cleanBasename(txprogEntry).replace(/\.txprog$/i, ''));
    }
    if (kmpEntry) {
      const kmpBytes = extractZipEntry(rawZipBytes, indexMap.get(kmpEntry)!);
      const kmpBuf = kmpBytes.buffer.slice(kmpBytes.byteOffset, kmpBytes.byteOffset + kmpBytes.byteLength) as ArrayBuffer;
      const siblingMap = await extractAudioBuffers();
      for (const ke of ksfEntries) {
        const kb = extractZipEntry(rawZipBytes, ke);
        siblingMap.set(cleanBasename(ke.path), kb.buffer.slice(kb.byteOffset, kb.byteOffset + kb.byteLength) as ArrayBuffer);
      }
      return parseKorgKmpPreset(kmpBuf, siblingMap, cleanBasename(kmpEntry).replace(/\.kmp$/i, ''));
    }
    if (dlsEntry) {
      const dlsBytes = extractZipEntry(rawZipBytes, indexMap.get(dlsEntry)!);
      const dlsBuf = dlsBytes.buffer.slice(dlsBytes.byteOffset, dlsBytes.byteOffset + dlsBytes.byteLength) as ArrayBuffer;
      return parseDlsPreset(dlsBuf, 0, cleanBasename(dlsEntry).replace(/\.dls$/i, ''));
    }
    if (qpatEntry) {
      const qBytes = extractZipEntry(rawZipBytes, indexMap.get(qpatEntry)!);
      const qBuf = qBytes.buffer.slice(qBytes.byteOffset, qBytes.byteOffset + qBytes.byteLength) as ArrayBuffer;
      const audioMap = await extractAudioBuffers();
      const pIdx = targetProgramPath ? parseInt(targetProgramPath, 10) || 0 : 0;
      const parsed = parseWaldorfQpat(qBuf, pIdx, audioMap);
      return {
        format: 'waldorf_qpat',
        formatLabel: 'Waldorf Quantum/Iridium (.qpat)',
        presetName: parsed.presetName,
        modelName: parsed.presetName.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 11),
        detectedCategory: classifyPresetCategory(parsed.presetName).category,
        suggestedParameterSet: classifyPresetCategory(parsed.presetName).parameterSet,
        regions: parsed.regions.map((r) => ({
          id: r.id,
          sampleName: r.sampleName,
          samplePath: r.sampleName,
          rootKey: r.rootKey,
          lowKey: r.lowKey,
          highKey: r.highKey,
          lowVel: r.lowVel,
          highVel: r.highVel,
          detuneCents: r.detune ?? 0,
          volumeDb: r.volume ?? 0,
          pan: r.pan ?? 0,
          loopMode: r.loops && r.loops.length > 0 ? r.loops[0].mode : (r.loopMode ?? 'no_loop'),
          loopStart: r.loops && r.loops.length > 0 ? r.loops[0].startFrame : r.loopStart,
          loopEnd: r.loops && r.loops.length > 0 ? r.loops[0].endFrame : r.loopEnd,
          sampleStartFrame: r.sampleStartFrame,
          sampleEndFrame: r.sampleEndFrame,
          reversed: r.reversed,
        })),
        audioBuffers: audioMap,
      };
    }
    if (opxyEntry) {
      const pBytes = extractZipEntry(rawZipBytes, indexMap.get(opxyEntry)!);
      const jsonText = new TextDecoder('utf-8').decode(pBytes);
      const audioMap = await extractAudioBuffers();
      const parsed = parseOpXyPatch(jsonText, audioMap);
      const pName = cleanBasename(filename).replace(/\.(preset|zip)$/i, '') || parsed.presetName;
      return {
        format: 'opxy',
        formatLabel: 'Teenage Engineering OP-XY',
        presetName: pName,
        modelName: pName.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 11),
        detectedCategory: classifyPresetCategory(pName).category,
        suggestedParameterSet: classifyPresetCategory(pName).parameterSet,
        regions: parsed.regions.map((r) => ({
          id: r.id,
          sampleName: r.sampleName,
          samplePath: r.sampleName,
          rootKey: r.rootKey,
          lowKey: r.lowKey,
          highKey: r.highKey,
          lowVel: r.lowVel,
          highVel: r.highVel,
          detuneCents: r.detune ?? 0,
          volumeDb: r.volume ?? 0,
          pan: r.pan ?? 0,
          loopMode: r.loops && r.loops.length > 0 ? r.loops[0].mode : (r.loopMode ?? 'no_loop'),
          loopStart: r.loops && r.loops.length > 0 ? r.loops[0].startFrame : r.loopStart,
          loopEnd: r.loops && r.loops.length > 0 ? r.loops[0].endFrame : r.loopEnd,
          sampleStartFrame: r.sampleStartFrame,
          sampleEndFrame: r.sampleEndFrame,
          reversed: r.reversed,
        })),
        audioBuffers: audioMap,
      };
    }
    if (tonverkEntry) {
      const tvBytes = extractZipEntry(rawZipBytes, indexMap.get(tonverkEntry)!);
      const tvText = new TextDecoder('utf-8').decode(tvBytes);
      const audioMap = await extractAudioBuffers();
      const parsed = parseTonverkPst(tvText, audioMap);
      const pName = cleanBasename(tonverkEntry).replace(/\.(tvpst|elmulti)$/i, '') || parsed.presetName;
      return {
        format: 'tonverk',
        formatLabel: 'Elektron Tonverk (.tvpst)',
        presetName: pName,
        modelName: pName.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 11),
        detectedCategory: classifyPresetCategory(pName).category,
        suggestedParameterSet: classifyPresetCategory(pName).parameterSet,
        regions: parsed.regions.map((r) => ({
          id: r.id,
          sampleName: r.sampleName,
          samplePath: r.sampleName,
          rootKey: r.rootKey,
          lowKey: r.lowKey,
          highKey: r.highKey,
          lowVel: r.lowVel,
          highVel: r.highVel,
          detuneCents: r.detune ?? 0,
          volumeDb: r.volume ?? 0,
          pan: r.pan ?? 0,
          loopMode: r.loops && r.loops.length > 0 ? r.loops[0].mode : (r.loopMode ?? 'no_loop'),
          loopStart: r.loops && r.loops.length > 0 ? r.loops[0].startFrame : r.loopStart,
          loopEnd: r.loops && r.loops.length > 0 ? r.loops[0].endFrame : r.loopEnd,
          sampleStartFrame: r.sampleStartFrame,
          sampleEndFrame: r.sampleEndFrame,
        })),
        audioBuffers: audioMap,
      };
    }
    if (distingEntry) {
      const dexBytes = extractZipEntry(rawZipBytes, indexMap.get(distingEntry)!);
      const dexBuf = dexBytes.buffer.slice(dexBytes.byteOffset, dexBytes.byteOffset + dexBytes.byteLength) as ArrayBuffer;
      const audioMap = await extractAudioBuffers();
      const parsed = parseDistingExPreset(dexBuf, Array.from(audioMap.keys()), audioMap);
      const pName = cleanBasename(distingEntry).replace(/\.dexpreset$/i, '') || parsed.presetName;
      return {
        format: 'disting_ex',
        formatLabel: 'Expert Sleepers Disting EX',
        presetName: pName,
        modelName: pName.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 11),
        detectedCategory: classifyPresetCategory(pName).category,
        suggestedParameterSet: classifyPresetCategory(pName).parameterSet,
        regions: parsed.regions.map((r) => ({
          id: r.id,
          sampleName: r.sampleName,
          samplePath: r.sampleName,
          rootKey: r.rootKey,
          lowKey: r.lowKey,
          highKey: r.highKey,
          lowVel: r.lowVel,
          highVel: r.highVel,
          detuneCents: r.detune ?? 0,
          volumeDb: r.volume ?? 0,
          pan: r.pan ?? 0,
          loopMode: r.loops && r.loops.length > 0 ? r.loops[0].mode : (r.loopMode ?? 'no_loop'),
          loopStart: r.loops && r.loops.length > 0 ? r.loops[0].startFrame : r.loopStart,
          loopEnd: r.loops && r.loops.length > 0 ? r.loops[0].endFrame : r.loopEnd,
        })),
        audioBuffers: audioMap,
      };
    }
    if (prophetEntry) {
      const gBytes = extractZipEntry(rawZipBytes, indexMap.get(prophetEntry)!);
      const gText = new TextDecoder('utf-8').decode(gBytes);
      const audioMap = await extractAudioBuffers();
      const parsed = parseProphetXGroupText(gText, audioMap);
      const pName = cleanBasename(prophetEntry).replace(/\.grp$/i, '') || parsed.presetName;
      return {
        format: 'prophet_x',
        formatLabel: 'Sequential Prophet X (.grp)',
        presetName: pName,
        modelName: pName.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 11),
        detectedCategory: classifyPresetCategory(pName).category,
        suggestedParameterSet: classifyPresetCategory(pName).parameterSet,
        regions: parsed.regions.map((r) => ({
          id: r.id,
          sampleName: r.sampleName,
          samplePath: r.sampleName,
          rootKey: r.rootKey,
          lowKey: r.lowKey,
          highKey: r.highKey,
          lowVel: r.lowVel,
          highVel: r.highVel,
          detuneCents: r.detune ?? 0,
          volumeDb: r.volume ?? 0,
          pan: r.pan ?? 0,
          loopMode: r.loops && r.loops.length > 0 ? r.loops[0].mode : (r.loopMode ?? 'no_loop'),
          loopStart: r.loops && r.loops.length > 0 ? r.loops[0].startFrame : r.loopStart,
          loopEnd: r.loops && r.loops.length > 0 ? r.loops[0].endFrame : r.loopEnd,
        })),
        audioBuffers: audioMap,
      };
    }
    if (islaEntry) {
      const kBytes = extractZipEntry(rawZipBytes, indexMap.get(islaEntry)!);
      const kBuf = kBytes.buffer.slice(kBytes.byteOffset, kBytes.byteOffset + kBytes.byteLength) as ArrayBuffer;
      const audioMap = await extractAudioBuffers();
      const parsed = parseS2400Kit(kBuf, Array.from(audioMap.keys()));
      const pName = cleanBasename(islaEntry).replace(/\.(kit|s24)$/i, '') || parsed.presetName;
      return {
        format: 'isla_s2400',
        formatLabel: 'Isla Instruments S2400 Kit',
        presetName: pName,
        modelName: pName.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 11),
        detectedCategory: classifyPresetCategory(pName).category,
        suggestedParameterSet: classifyPresetCategory(pName).parameterSet,
        regions: parsed.regions.map((r) => ({
          id: r.id,
          sampleName: r.sampleName,
          samplePath: r.sampleName,
          rootKey: r.rootKey,
          lowKey: r.lowKey,
          highKey: r.highKey,
          lowVel: r.lowVel,
          highVel: r.highVel,
          detuneCents: r.detune ?? 0,
          volumeDb: r.volume ?? 0,
          pan: r.pan ?? 0,
          loopMode: 'no_loop',
        })),
        audioBuffers: audioMap,
      };
    }
    if (korgModernEntry) {
      const kmBytes = extractZipEntry(rawZipBytes, indexMap.get(korgModernEntry)!);
      const kmBuf = kmBytes.buffer.slice(kmBytes.byteOffset, kmBytes.byteOffset + kmBytes.byteLength) as ArrayBuffer;
      const audioMap = await extractAudioBuffers();
      const parsed = parseKorgMultisample(kmBuf, Array.from(audioMap.keys()));
      const pName = cleanBasename(korgModernEntry).replace(/\.korgmultisample$/i, '') || parsed.presetName;
      return {
        format: 'korg_modern',
        formatLabel: 'Korg Modern Multisample',
        presetName: pName,
        modelName: pName.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 11),
        detectedCategory: classifyPresetCategory(pName).category,
        suggestedParameterSet: classifyPresetCategory(pName).parameterSet,
        regions: parsed.regions.map((r) => ({
          id: r.id,
          sampleName: r.sampleName,
          samplePath: r.sampleName,
          rootKey: r.rootKey,
          lowKey: r.lowKey,
          highKey: r.highKey,
          lowVel: r.lowVel,
          highVel: r.highVel,
          detuneCents: r.detune ?? 0,
          volumeDb: r.volume ?? 0,
          pan: r.pan ?? 0,
          loopMode: 'no_loop',
        })),
        audioBuffers: audioMap,
      };
    }
    if (thirdWaveEntry) {
      const twBytes = extractZipEntry(rawZipBytes, indexMap.get(thirdWaveEntry)!);
      const twBuf = twBytes.buffer.slice(twBytes.byteOffset, twBytes.byteOffset + twBytes.byteLength) as ArrayBuffer;
      const audioMap = await extractAudioBuffers();
      const parsed = parseThirdWaveProgram(twBuf, Array.from(audioMap.keys()));
      const pName = cleanBasename(thirdWaveEntry).replace(/\.3wv$/i, '') || parsed.presetName;
      return {
        format: 'third_wave',
        formatLabel: 'Groove Synthesis 3rd Wave',
        presetName: pName,
        modelName: pName.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 11),
        detectedCategory: classifyPresetCategory(pName).category,
        suggestedParameterSet: classifyPresetCategory(pName).parameterSet,
        regions: parsed.regions.map((r) => ({
          id: r.id,
          sampleName: r.sampleName,
          samplePath: r.sampleName,
          rootKey: r.rootKey,
          lowKey: r.lowKey,
          highKey: r.highKey,
          lowVel: r.lowVel,
          highVel: r.highVel,
          detuneCents: r.detune ?? 0,
          volumeDb: r.volume ?? 0,
          pan: r.pan ?? 0,
          loopMode: 'no_loop',
        })),
        audioBuffers: audioMap,
      };
    }
    if (zenCoreEntry) {
      const zBytes = extractZipEntry(rawZipBytes, indexMap.get(zenCoreEntry)!);
      const zBuf = zBytes.buffer.slice(zBytes.byteOffset, zBytes.byteOffset + zBytes.byteLength) as ArrayBuffer;
      const audioMap = await extractAudioBuffers();
      const parsed = parseZenCoreSvz(zBuf, Array.from(audioMap.keys()));
      const pName = cleanBasename(zenCoreEntry).replace(/\.svz$/i, '') || parsed.presetName;
      return {
        format: 'zencore',
        formatLabel: 'Roland Zen-Core / SP-404MKII',
        presetName: pName,
        modelName: pName.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 11),
        detectedCategory: classifyPresetCategory(pName).category,
        suggestedParameterSet: classifyPresetCategory(pName).parameterSet,
        regions: parsed.regions.map((r) => ({
          id: r.id,
          sampleName: r.sampleName,
          samplePath: r.sampleName,
          rootKey: r.rootKey,
          lowKey: r.lowKey,
          highKey: r.highKey,
          lowVel: r.lowVel,
          highVel: r.highVel,
          detuneCents: r.detune ?? 0,
          volumeDb: r.volume ?? 0,
          pan: r.pan ?? 0,
          loopMode: 'no_loop',
        })),
        audioBuffers: audioMap,
      };
    }
    if (xpmEntries.length > 0) {
      const availStems = new Set<string>();
      for (const ae of audioEntries) {
        availStems.add(cleanBasename(ae.path).replace(/\.[^.]+$/, '').toLowerCase());
      }
      const ranked = [...xpmEntries].sort((a, b) => Number(a.includes('[')) - Number(b.includes('[')));
      let bestProg: MpcProgram | null = null;
      let bestScore = -1;
      let lastError: unknown = null;
      for (const entry of ranked.slice(0, 32)) {
        try {
          const entryBytes = extractZipEntry(rawZipBytes, indexMap.get(entry)!);
          const prog = await parseMpcXpm(entryBytes);
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
        const neededStems = new Set<string>();
        for (const inst of bestProg.instruments) {
          for (const l of inst.layers) {
            const stem = (l.sampleFile ? cleanBasename(l.sampleFile).replace(/\.[^.]+$/, '') : l.sampleName).toLowerCase();
            neededStems.add(stem);
            neededStems.add(stem.trim());
          }
        }
        const audioFiles = await extractAudioBuffers(neededStems.size > 0 ? neededStems : undefined);
        const preset = mpcProgramToPreset(bestProg, audioFiles);
        preset.programCount = xpmEntries.length;
        return preset;
      }
      if (lastError) throw lastError;
    }
  }

  // Helper to convert optional zipEntries Map<string, Uint8Array> into Map<string, ArrayBuffer>
  const siblingAudioBuffers = async (): Promise<Map<string, ArrayBuffer>> => {
    const map = new Map<string, ArrayBuffer>();
    if (zipEntries) {
      for (const [name, b] of zipEntries.entries()) {
        const cleanKey = cleanBasename(name);
        let rawBuf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
        if (!/\.(wav|aif|aiff|ksf)$/i.test(cleanKey)) {
          try {
            rawBuf = await transcodeAnyAudioToWavBuffer(rawBuf, cleanKey);
          } catch {
            // Keep rawBuf if transcoding fails
          }
        }
        map.set(cleanKey, rawBuf);
      }
    }
    return map;
  };

  // Akai MPC program (MPC2 XML or MPC3 GZIP/JSON)
  if (/\.(xpm|xty|xtd)$/.test(lower)) {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
    return mpcProgramToPreset(await parseMpcXpm(bytes), await siblingAudioBuffers());
  }

  // Ableton Sampler / Simpler (.adv)
  if (lower.endsWith('.adv')) {
    const bytes = typeof data === 'string' ? data : new Uint8Array(data);
    return parseAbletonAdvPreset(bytes, await siblingAudioBuffers(), cleanBasename(filename).replace(/\.adv$/i, ''));
  }

  // Apple Logic EXS24 (.exs)
  if (lower.endsWith('.exs') || (typeof data !== 'string' && isExs24Buffer(data))) {
    const buf = typeof data === 'string' ? new TextEncoder().encode(data).buffer : data;
    return parseExs24Preset(buf as ArrayBuffer, await siblingAudioBuffers(), cleanBasename(filename).replace(/\.exs$/i, ''));
  }

  // TAL-Sampler (.talsmpl)
  if (lower.endsWith('.talsmpl')) {
    const xml = typeof data === 'string' ? data : new TextDecoder('utf-8').decode(data);
    return parseTalSamplerPreset(xml, await siblingAudioBuffers(), cleanBasename(filename).replace(/\.talsmpl$/i, ''));
  }

  // CWITEC TX16Wx (.txprog)
  if (lower.endsWith('.txprog')) {
    const xml = typeof data === 'string' ? data : new TextDecoder('utf-8').decode(data);
    return parseTx16WxPreset(xml, await siblingAudioBuffers(), cleanBasename(filename).replace(/\.txprog$/i, ''));
  }

  // Korg Trinity/Triton/M3/Pa (.kmp / .ksf)
  if (lower.endsWith('.kmp') || lower.endsWith('.ksf') || (typeof data !== 'string' && isKorgKmpOrKsfBuffer(data) !== null)) {
    const buf = (typeof data === 'string' ? new TextEncoder().encode(data).buffer : data) as ArrayBuffer;
    const kind = isKorgKmpOrKsfBuffer(buf);
    if (kind === 'ksf' || lower.endsWith('.ksf')) {
      const ksf = parseKorgKsf(buf, cleanBasename(filename).replace(/\.ksf$/i, ''));
      const wavName = `${ksf.sampleName.replace(/[^a-zA-Z0-9_]/g, '_') || 'KorgSample'}.wav`;
      const audioMap = new Map<string, ArrayBuffer>([[wavName, ksf.wavBuffer]]);
      return {
        format: 'korg_kmp',
        formatLabel: 'Korg Sample (.KSF)',
        presetName: ksf.sampleName,
        modelName: ksf.sampleName.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 11),
        detectedCategory: classifyPresetCategory(ksf.sampleName).category,
        suggestedParameterSet: classifyPresetCategory(ksf.sampleName).parameterSet,
        regions: [
          {
            id: 'ksf_zone_001',
            sampleName: wavName,
            samplePath: wavName,
            rootKey: 60,
            lowKey: 0,
            highKey: 127,
            lowVel: 1,
            highVel: 127,
            detuneCents: 0,
            volumeDb: 0,
            pan: 0,
            sampleStartFrame: ksf.startFrame > 0 ? ksf.startFrame : undefined,
            reversed: ksf.reversed,
            loopMode: ksf.loopEnabled ? 'loop_continuous' : 'no_loop',
            loopStart: ksf.loopStartFrame,
            loopEnd: ksf.loopEndFrame,
          },
        ],
        audioBuffers: audioMap,
      };
    }
    return parseKorgKmpPreset(buf, await siblingAudioBuffers(), cleanBasename(filename).replace(/\.kmp$/i, ''));
  }

  // MMA Downloadable Sounds (.dls)
  if (lower.endsWith('.dls') || (typeof data !== 'string' && isDlsBuffer(data))) {
    const buf = (typeof data === 'string' ? new TextEncoder().encode(data).buffer : data) as ArrayBuffer;
    const instIdx = targetProgramPath ? parseInt(targetProgramPath, 10) || 0 : 0;
    return parseDlsPreset(buf, instIdx, cleanBasename(filename).replace(/\.dls$/i, ''));
  }

  // 2. Direct format dispatch by extension / contents
  if (lower.endsWith('.dspreset')) {
    const xml = typeof data === 'string' ? data : new TextDecoder('utf-8').decode(data);
    return parseDecentSamplerPreset(xml, await siblingAudioBuffers());
  }

  if (lower.endsWith('.nki') || lower.endsWith('.nki.xml')) {
    return parseKontaktNki(data, await siblingAudioBuffers());
  }

  if (lower.endsWith('.vstpreset') || lower.endsWith('.vstpreset.xml')) {
    return parseHalionVstPreset(data, await siblingAudioBuffers());
  }

  if (lower.endsWith('.multisample') || lower.endsWith('multisample.xml')) {
    const xml = typeof data === 'string' ? data : new TextDecoder('utf-8').decode(data);
    return parseBitwigMultisample(xml, await siblingAudioBuffers());
  }

  // 3. Audio / Sample chain / Slices (.wav, .aif, .aiff, .aifc, .flac, .caf, .mp3, .ogg, .m4a, .aac, .opus)
  if (isSupportedAudioFileName(lower)) {
    if (typeof data !== 'string') {
      const wavBuf = await transcodeAnyAudioToWavBuffer(data, filename);
      return parseSampleChainAudio(wavBuf, filename);
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
