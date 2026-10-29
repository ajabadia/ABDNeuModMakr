// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — SFZ (.sfz) Native Importer
//
// Parses SFZ v1/v2 text definitions (<control>, <global>, <master>,
// <group>, <region>) + accompanying audio files (WAV/AIFF) and
// converts them directly into our native Extended + Classic session
// model (discarding the external .sfz file).
// ─────────────────────────────────────────────────────────

import type {
  AudioFilePayload,
  ExtendedRegion,
  LoopMode,
  TriggerMode,
} from '../core/types.ts';
import {
  createDefaultArticulation,
  projectExtendedRegionsToClassicZones,
} from '../core/extendedAdapter.ts';
import {
  classifyInstrumentAndParameterSet,
  type NativeSamplerImportResult,
} from './Sf2Parser.ts';

const NOTE_NAME_OFFSETS: Record<string, number> = {
  c: 0,
  'c#': 1,
  db: 1,
  d: 2,
  'd#': 3,
  eb: 3,
  e: 4,
  f: 5,
  'f#': 6,
  gb: 6,
  g: 7,
  'g#': 8,
  ab: 8,
  a: 9,
  'a#': 10,
  bb: 10,
  b: 11,
};

/**
 * Parses an SFZ note value (either integer 0..127 or IPN string like "c4", "f#3", "bb2").
 */
export function parseSfzNote(val: string | undefined, fallback = 60): number {
  if (!val) return fallback;
  const trimmed = val.trim().toLowerCase();
  if (/^-?\d+$/.test(trimmed)) {
    return Math.max(0, Math.min(127, parseInt(trimmed, 10)));
  }
  const m = /^([a-g][#b]?)(-?\d+)$/.exec(trimmed);
  if (!m) return fallback;
  const semi = NOTE_NAME_OFFSETS[m[1]];
  if (semi === undefined) return fallback;
  const octave = parseInt(m[2], 10);
  // Standard MIDI: C4 = 60 -> (octave + 1) * 12 + semi
  return Math.max(0, Math.min(127, (octave + 1) * 12 + semi));
}

function stripSfzComments(text: string): string {
  // Remove block comments /* ... */ and line comments // ...
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map((line) => {
      const idx = line.indexOf('//');
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join('\n');
}

function parseOpcodesFromBlock(body: string): Record<string, string> {
  const opcodes: Record<string, string> = {};
  // Match key=value where value can contain spaces (e.g. sample=my sample name.wav) up to the next key= or end
  const regex = /([a-zA-Z0-9_]+)\s*=\s*([^\r\n]*?)(?=\s+[a-zA-Z0-9_]+\s*=|\r|\n|$)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(body)) !== null) {
    opcodes[match[1].toLowerCase()] = match[2].trim();
  }
  return opcodes;
}

function basenameOfPath(p: string): string {
  const norm = p.replace(/\\/g, '/').trim();
  const idx = norm.lastIndexOf('/');
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

/**
 * Imports an `.sfz` text definition and accompanying `AudioFilePayload[]`
 * into our native session structures.
 */
export function importSfzToNative(
  sfzText: string,
  sfzFileName: string,
  companionAudioFiles: AudioFilePayload[] = [],
): NativeSamplerImportResult {
  const cleaned = stripSfzComments(sfzText);
  const headerRegex = /<(control|global|master|group|region)>/gi;

  interface SectionBlock {
    tag: string;
    opcodes: Record<string, string>;
  }

  const blocks: SectionBlock[] = [];
  let lastTag = '';
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = headerRegex.exec(cleaned)) !== null) {
    if (lastTag) {
      const segment = cleaned.slice(lastIndex, m.index);
      blocks.push({ tag: lastTag, opcodes: parseOpcodesFromBlock(segment) });
    }
    lastTag = m[1].toLowerCase();
    lastIndex = headerRegex.lastIndex;
  }
  if (lastTag) {
    blocks.push({
      tag: lastTag,
      opcodes: parseOpcodesFromBlock(cleaned.slice(lastIndex)),
    });
  }

  let globalOps: Record<string, string> = {};
  let masterOps: Record<string, string> = {};
  let groupOps: Record<string, string> = {};
  const mergedRegions: Record<string, string>[] = [];

  for (const b of blocks) {
    if (b.tag === 'global') {
      globalOps = { ...globalOps, ...b.opcodes };
    } else if (b.tag === 'master') {
      masterOps = { ... b.opcodes };
      groupOps = {};
    } else if (b.tag === 'group') {
      groupOps = { ...b.opcodes };
    } else if (b.tag === 'region') {
      mergedRegions.push({
        ...globalOps,
        ...masterOps,
        ...groupOps,
        ...b.opcodes,
      });
    }
  }

  // Index companion audio files by lowercase basename for flexible resolution
  const audioByBasename = new Map<string, AudioFilePayload>();
  for (const f of companionAudioFiles) {
    audioByBasename.set(basenameOfPath(f.name).toLowerCase(), f);
  }

  const extendedRegions: ExtendedRegion[] = [];
  let seq = 1;

  for (const ops of mergedRegions) {
    const rawSample = ops.sample;
    if (!rawSample) continue;
    const baseName = basenameOfPath(rawSample);
    const matchedFile = audioByBasename.get(baseName.toLowerCase());
    const sampleName = matchedFile ? matchedFile.name : baseName;

    const keySingle = ops.key !== undefined ? parseSfzNote(ops.key, 60) : undefined;
    const lowKey = ops.lokey !== undefined ? parseSfzNote(ops.lokey, 0) : (keySingle ?? 0);
    const highKey = ops.hikey !== undefined ? parseSfzNote(ops.hikey, 127) : (keySingle ?? 127);
    const rootKey =
      ops.pitch_keycenter !== undefined
        ? parseSfzNote(ops.pitch_keycenter, 60)
        : (keySingle ?? Math.round((lowKey + highKey) * 0.5));

    const lowVel = ops.lovel !== undefined ? Math.max(1, Math.min(127, parseInt(ops.lovel, 10) || 1)) : 1;
    const highVel = ops.hivel !== undefined ? Math.max(1, Math.min(127, parseInt(ops.hivel, 10) || 127)) : 127;

    const transpose = parseInt(ops.transpose ?? '0', 10) || 0;
    const tuneCents = parseInt(ops.tune ?? '0', 10) || 0;
    const effectiveRootKey = Math.max(0, Math.min(127, rootKey - transpose));
    const detune = Math.max(-99, Math.min(99, tuneCents));
    const volume = Math.max(-32, Math.min(12, Math.round(parseFloat(ops.volume ?? '0') || 0)));
    // SFZ pan is -100..+100 -> convert to -50..+50
    const pan = Math.max(-50, Math.min(50, Math.round((parseFloat(ops.pan ?? '0') || 0) * 0.5)));
    const pitchKeytrack = Math.max(0, Math.min(100, Math.round(parseFloat(ops.pitch_keytrack ?? '100') || 100)));

    const rawTrig = (ops.trigger ?? 'attack').toLowerCase();
    const trigger: TriggerMode =
      rawTrig === 'release' || rawTrig === 'first' || rawTrig === 'legato' ? rawTrig : 'attack';

    const seqPosition = ops.seq_position ? parseInt(ops.seq_position, 10) : undefined;
    const seqLength = ops.seq_length ? parseInt(ops.seq_length, 10) : undefined;

    // Key & Velocity Crossfades
    const xfinLokey = ops.xfin_lokey !== undefined ? parseSfzNote(ops.xfin_lokey, lowKey) : lowKey;
    const xfinHikey = ops.xfin_hikey !== undefined ? parseSfzNote(ops.xfin_hikey, lowKey) : lowKey;
    const xfoutLokey = ops.xfout_lokey !== undefined ? parseSfzNote(ops.xfout_lokey, highKey) : highKey;
    const xfoutHikey = ops.xfout_hikey !== undefined ? parseSfzNote(ops.xfout_hikey, highKey) : highKey;

    const xfinLovel = ops.xfin_lovel !== undefined ? parseInt(ops.xfin_lovel, 10) || lowVel : lowVel;
    const xfinHivel = ops.xfin_hivel !== undefined ? parseInt(ops.xfin_hivel, 10) || lowVel : lowVel;
    const xfoutLovel = ops.xfout_lovel !== undefined ? parseInt(ops.xfout_lovel, 10) || highVel : highVel;
    const xfoutHivel = ops.xfout_hivel !== undefined ? parseInt(ops.xfout_hivel, 10) || highVel : highVel;

    const rawLoop = (ops.loop_mode ?? ops.loopmode ?? 'no_loop').toLowerCase();
    const loopMode: LoopMode =
      rawLoop === 'loop_continuous' || rawLoop === 'loop_sustain' || rawLoop === 'one_shot'
        ? rawLoop
        : 'no_loop';
    const loopStart = Math.max(0, parseInt(ops.loop_start ?? ops.loopstart ?? '0', 10) || 0);
    const loopEnd = Math.max(loopStart, parseInt(ops.loop_end ?? ops.loopend ?? '0', 10) || 0);
    const loopCrossfadeMs = Math.max(0, Math.round((parseFloat(ops.loop_crossfade ?? '0') || 0) * 1000));

    extendedRegions.push({
      id: `ext-reg-${seq++}`,
      sampleName,
      lowKey: Math.min(lowKey, xfinLokey),
      highKey: Math.max(highKey, xfoutHikey),
      rootKey: effectiveRootKey,
      lowVel: Math.min(lowVel, xfinLovel),
      highVel: Math.max(highVel, xfoutHivel),
      detune,
      volume,
      pan,
      pitchKeytrack,
      trigger,
      seqPosition,
      seqLength,
      keyFadeIn: Math.max(0, xfinHikey - xfinLokey),
      keyFadeOut: Math.max(0, xfoutHikey - xfoutLokey),
      velFadeIn: Math.max(0, xfinHivel - xfinLovel),
      velFadeOut: Math.max(0, xfoutHivel - xfoutLovel),
      fadeCurve: (ops.xf_keycurve ?? 'power') === 'gain' ? 'linear' : 'equal-power',
      loopMode,
      loopStart,
      loopEnd,
      loopCrossfadeMs,
    });
  }

  extendedRegions.sort((a, b) => a.lowKey - b.lowKey || a.lowVel - b.lowVel);

  // Extract articulation from global/first region opcodes
  const articulation = createDefaultArticulation();
  const refOps = mergedRegions[0] ?? globalOps;
  if (refOps) {
    const hasAmpEnv =
      refOps.ampeg_attack !== undefined ||
      refOps.ampeg_decay !== undefined ||
      refOps.ampeg_sustain !== undefined ||
      refOps.ampeg_release !== undefined;
    if (hasAmpEnv) {
      articulation.ampEnvEnabled = true;
      articulation.ampEnv = {
        delaySec: Math.max(0, parseFloat(refOps.ampeg_delay ?? '0') || 0),
        attackSec: Math.max(0.002, parseFloat(refOps.ampeg_attack ?? '0.005') || 0.005),
        holdSec: Math.max(0, parseFloat(refOps.ampeg_hold ?? '0') || 0),
        decaySec: Math.max(0.005, parseFloat(refOps.ampeg_decay ?? '0.25') || 0.25),
        sustainLevel: Math.max(0, Math.min(1, (parseFloat(refOps.ampeg_sustain ?? '100') || 100) / 100)),
        releaseSec: Math.max(0.01, parseFloat(refOps.ampeg_release ?? '0.2') || 0.2),
      };
    }

    if (refOps.cutoff !== undefined) {
      articulation.filter = {
        enabled: true,
        type: refOps.fil_type?.includes('hpf') ? 'hpf' : refOps.fil_type?.includes('bpf') ? 'bpf' : 'lpf',
        cutoffHz: Math.max(20, Math.min(20000, Math.round(parseFloat(refOps.cutoff) || 18000))),
        resonanceDb: Math.max(0, Math.min(40, parseFloat(refOps.resonance ?? '0') || 0)),
        envToFilterCents: parseFloat(refOps.fileg_depth ?? '0') || 0,
        velToFilterCents: parseFloat(refOps.fil_veltrack ?? '0') || 0,
        keytrackCents: parseFloat(refOps.fil_keytrack ?? '0') || 0,
      };
    }

    if (refOps.pitchlfo_depth !== undefined || refOps.lfo01_pitch !== undefined) {
      articulation.vibLfo = {
        enabled: true,
        delaySec: Math.max(0, parseFloat(refOps.pitchlfo_delay ?? refOps.lfo01_delay ?? '0') || 0),
        freqHz: Math.max(0.05, parseFloat(refOps.pitchlfo_freq ?? refOps.lfo01_freq ?? '5') || 5),
        toPitchCents: parseFloat(refOps.pitchlfo_depth ?? refOps.lfo01_pitch ?? '0') || 0,
        toFilterCents: parseFloat(refOps.fillfo_depth ?? refOps.lfo01_cutoff ?? '0') || 0,
        toVolumeDb: parseFloat(refOps.amplfo_depth ?? refOps.lfo01_volume ?? '0') || 0,
        waveform: 0,
      };
    }
  }

  const { zones: classicZones, velocityLayerGainCompensation } =
    projectExtendedRegionsToClassicZones(extendedRegions);

  const cleanTitle = basenameOfPath(sfzFileName).replace(/\.sfz$/i, '').trim() || 'SFZ Instrument';
  const modelName = cleanTitle.slice(0, 11);
  const classification = classifyInstrumentAndParameterSet(cleanTitle);

  return {
    sourceFormat: 'sfz',
    presetName: cleanTitle,
    modelName,
    detectedCategory: classification.category,
    suggestedParameterSet: classification.parameterSet,
    audioFiles: companionAudioFiles,
    extendedRegions,
    classicZones,
    velocityLayerGainCompensation,
    articulation,
  };
}
