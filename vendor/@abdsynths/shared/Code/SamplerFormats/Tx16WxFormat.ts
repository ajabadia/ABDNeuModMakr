// ─────────────────────────────────────────────────────────
// @abdsynths/shared — CWITEC TX16Wx Software Sampler (.txprog) Reader & Writer (Fase 32.4)
//
// Clean-room implementation of CWITEC TX16Wx 3.0 XML program format
// (<tx:program xmlns:tx="http://www.tx16wx.com/3.0/program">).
// Supports <tx:wave>, multiple <tx:loop>, <tx:soundshape> (AEG, ENV1/ENV2,
// Filter1, Modulation), <tx:group> (choke-group, playmode, keyswitch), and
// <tx:region> (bounds, key/vel fades, sound-offsets).
// Reference: Jürgen Moßgraber's ConvertWithMoss format documentation.
// ─────────────────────────────────────────────────────────

import type {
  DahdsrEnvelope,
  FilterSlopePoles,
  LoopMode,
  PitchEnvelopeConfig,
  RegionFilterConfig,
  SampleLoopDescriptor,
  TriggerMode,
} from './SamplerTypes.ts';
import type { UniformSamplerRegion } from './rawSamplerTypes.ts';

export interface Tx16WxWaveDef {
  id: number;
  path: string;
  rootKey?: number;
  sampleStartFrame: number;
  sampleEndFrame?: number;
  loops: SampleLoopDescriptor[];
}

export interface Tx16WxSoundshapeDef {
  id: string;
  name: string;
  ampEnv: DahdsrEnvelope;
  filter?: RegionFilterConfig;
  pitchEnv?: PitchEnvelopeConfig;
}

export interface Tx16WxRegionDef {
  id: string;
  groupName: string;
  muteGroup: number;
  trigger: TriggerMode;
  polyphony: number;
  soundshapeId?: string;
  waveId: number;
  samplePath: string;
  rootKey: number;
  lowKey: number;
  highKey: number;
  lowVel: number;
  highVel: number;
  keyFadeIn: number;
  keyFadeOut: number;
  velFadeIn: number;
  velFadeOut: number;
  detuneCents: number;
  pitchKeytrack: number;
  volumeDb: number;
  pan: number; // -50..+50
  reversed: boolean;
  sampleStartFrame: number;
  sampleEndFrame?: number;
  loops: SampleLoopDescriptor[];
  loopMode: LoopMode;
  loopStart: number;
  loopEnd: number;
  loopCrossfadeFrames: number;
}

export interface ParsedTx16WxProgram {
  presetName: string;
  author?: string;
  description?: string;
  waves: Map<number, Tx16WxWaveDef>;
  soundshapes: Map<string, Tx16WxSoundshapeDef>;
  regions: Tx16WxRegionDef[];
  primaryAmpEnv: DahdsrEnvelope;
  primaryFilter?: RegionFilterConfig;
  primaryPitchEnv?: PitchEnvelopeConfig;
}

function getTxAttr(tag: string, attrName: string, fallback = ''): string {
  const m = new RegExp(`(?:tx:)?${attrName}=["']([^"']*)["']`, 'i').exec(tag);
  return m ? m[1] : fallback;
}

function parseNoteOrInt(val: string, fallback: number): number {
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

function parseTimeSec(val: string, fallbackSec: number): number {
  if (!val) return fallbackSec;
  const trimmed = val.trim().toLowerCase();
  const num = parseFloat(trimmed);
  if (!Number.isFinite(num)) return fallbackSec;
  if (trimmed.endsWith('ms')) return Math.max(0.0005, num / 1000);
  if (trimmed.endsWith('s')) return Math.max(0.0005, num);
  // If raw number > 15, assume ms
  return num > 15 ? num / 1000 : Math.max(0.0005, num);
}

function parseDbValue(val: string, fallbackDb = 0): number {
  if (!val) return fallbackDb;
  const num = parseFloat(val);
  return Number.isFinite(num) ? num : fallbackDb;
}

function parseDbToLinearLevel(val: string, fallback = 1): number {
  if (!val) return fallback;
  const trimmed = val.trim().toLowerCase();
  const num = parseFloat(trimmed);
  if (!Number.isFinite(num)) return fallback;
  if (trimmed.includes('db') || num < 0) {
    if (num <= -96) return 0;
    return Math.max(0, Math.min(1, Math.pow(10, num / 20)));
  }
  if (trimmed.endsWith('%')) {
    return Math.max(0, Math.min(1, num / 100));
  }
  return Math.max(0, Math.min(1, num));
}

function parsePanToSigned50(val: string): number {
  if (!val) return 0;
  const num = parseFloat(val);
  if (!Number.isFinite(num)) return 0;
  // TX16Wx pan is -100%..+100% or -1..1
  if (val.includes('%') || Math.abs(num) > 1) {
    return Math.max(-50, Math.min(50, Math.round(num * 0.5)));
  }
  return Math.max(-50, Math.min(50, Math.round(num * 50)));
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Parses a CWITEC TX16Wx `.txprog` XML string.
 */
export function parseTx16WxProgram(xmlText: string, fallbackName = 'TX16WxProgram'): ParsedTx16WxProgram {
  if (!/<(?:tx:)?program\b/i.test(xmlText)) {
    throw new Error('Invalid TX16Wx program: missing <tx:program> root element.');
  }

  const progMatch = /<(?:tx:)?program\b([^>]*)>/i.exec(xmlText);
  const progAttrs = progMatch ? progMatch[1] : '';
  const presetName = getTxAttr(progAttrs, 'name', fallbackName).trim() || fallbackName;
  const author = getTxAttr(progAttrs, 'created-by') || undefined;

  // 1. Parse <tx:wave> elements
  const waves = new Map<number, Tx16WxWaveDef>();
  const waveRegex = /<(?:tx:)?wave\b([^>]*)(?:\/>|>([\s\S]*?)<\/(?:tx:)?wave>)/gi;
  let wm: RegExpExecArray | null;
  while ((wm = waveRegex.exec(xmlText)) !== null) {
    const wAttrs = wm[1];
    const wBody = wm[2] || '';
    const id = parseInt(getTxAttr(wAttrs, 'id', '0'), 10) || 0;
    const path = getTxAttr(wAttrs, 'path');
    if (!path) continue;
    const rootRaw = getTxAttr(wAttrs, 'root');
    const rootKey = rootRaw ? parseNoteOrInt(rootRaw, 60) : undefined;
    const sampleStartFrame = Math.max(0, parseInt(getTxAttr(wAttrs, 'start', '0'), 10) || 0);
    const endRaw = parseInt(getTxAttr(wAttrs, 'end', '0'), 10) || 0;
    const sampleEndFrame = endRaw > sampleStartFrame ? endRaw : undefined;

    const loops: SampleLoopDescriptor[] = [];
    const loopRegex = /<(?:tx:)?loop\b([^>]*)\/?>/gi;
    let lm: RegExpExecArray | null;
    let lIdx = 0;
    while ((lm = loopRegex.exec(wBody)) !== null) {
      const lAttrs = lm[1];
      const modeStr = getTxAttr(lAttrs, 'mode', 'Forward').toLowerCase();
      const startFrame = Math.max(0, parseInt(getTxAttr(lAttrs, 'start', '0'), 10) || 0);
      const endFrame = Math.max(0, parseInt(getTxAttr(lAttrs, 'end', '0'), 10) || 0);
      const xfadeFrames = Math.max(0, parseInt(getTxAttr(lAttrs, 'xfade', '0'), 10) || 0);
      if (modeStr === 'none' || endFrame <= startFrame) continue;
      const mode: LoopMode =
        modeStr.includes('bi') || modeStr.includes('ping')
          ? 'ping_pong'
          : modeStr.includes('back')
            ? 'loop_backward'
            : 'loop_continuous';
      lIdx++;
      loops.push({
        id: `tx_loop_${lIdx}`,
        mode,
        startFrame,
        endFrame,
        crossfadeMs: Math.round((xfadeFrames / 44.1) * 10) / 10,
      });
    }

    waves.set(id, {
      id,
      path,
      rootKey,
      sampleStartFrame,
      sampleEndFrame,
      loops,
    });
  }

  // 2. Parse <tx:soundshape> elements
  const soundshapes = new Map<string, Tx16WxSoundshapeDef>();
  const ssRegex = /<(?:tx:)?soundshape\b([^>]*)>([\s\S]*?)<\/(?:tx:)?soundshape>/gi;
  let sm: RegExpExecArray | null;
  while ((sm = ssRegex.exec(xmlText)) !== null) {
    const sAttrs = sm[1];
    const sBody = sm[2];
    const id = getTxAttr(sAttrs, 'id', 'default');
    const name = getTxAttr(sAttrs, 'name', 'Default');

    const aegMatch = /<(?:tx:)?aeg\b([^>]*)\/?>/i.exec(sBody);
    const aegAttrs = aegMatch ? aegMatch[1] : '';
    const ampEnv: DahdsrEnvelope = {
      delaySec: 0,
      attackSec: parseTimeSec(getTxAttr(aegAttrs, 'attack', '5 ms'), 0.005),
      holdSec: 0,
      decaySec:
        parseTimeSec(getTxAttr(aegAttrs, 'decay1', '0 ms'), 0) +
        parseTimeSec(getTxAttr(aegAttrs, 'decay2', '250 ms'), 0.25),
      sustainLevel: parseDbToLinearLevel(getTxAttr(aegAttrs, 'sustain', '0 dB'), 1.0),
      releaseSec: parseTimeSec(getTxAttr(aegAttrs, 'release', '200 ms'), 0.2),
      velModDepth: 100,
    };

    const env1Match = /<(?:tx:)?env1\b([^>]*)\/?>/i.exec(sBody);
    const env2Match = /<(?:tx:)?env2\b([^>]*)\/?>/i.exec(sBody);
    const parseAuxEnv = (attrs: string): DahdsrEnvelope => ({
      delaySec: 0,
      attackSec: parseTimeSec(getTxAttr(attrs, 'attack', '5 ms'), 0.005),
      holdSec: 0,
      decaySec:
        parseTimeSec(getTxAttr(attrs, 'decay1', '0 ms'), 0) +
        parseTimeSec(getTxAttr(attrs, 'decay2', '200 ms'), 0.2),
      sustainLevel: parseDbToLinearLevel(getTxAttr(attrs, 'level2', getTxAttr(attrs, 'sustain', '0 dB')), 0),
      releaseSec: parseTimeSec(getTxAttr(attrs, 'release', '150 ms'), 0.15),
      velModDepth: 0,
    });
    const env1 = env1Match ? parseAuxEnv(env1Match[1]) : undefined;
    const env2 = env2Match ? parseAuxEnv(env2Match[1]) : undefined;

    // Parse modulation entries inside soundshape
    let filterEnvDepthCents = 0;
    let filterEnvSource: 'env1' | 'env2' | undefined;
    let pitchEnvDepthCents = 0;
    let pitchEnvSource: 'env1' | 'env2' | undefined;
    const modEntryRegex = /<(?:tx:)?entry\b([^>]*)\/?>/gi;
    let mm: RegExpExecArray | null;
    while ((mm = modEntryRegex.exec(sBody)) !== null) {
      const mAttrs = mm[1];
      const src = getTxAttr(mAttrs, 'source').toUpperCase();
      const dst = getTxAttr(mAttrs, 'destination').toLowerCase();
      const amtStr = getTxAttr(mAttrs, 'amount', '0');
      const amtVal = parseFloat(amtStr) || 0;
      if ((src === 'ENV1' || src === 'ENV2') && dst.includes('filter')) {
        filterEnvDepthCents = Math.round(amtVal);
        filterEnvSource = src === 'ENV1' ? 'env1' : 'env2';
      } else if ((src === 'ENV1' || src === 'ENV2') && dst.includes('pitch')) {
        pitchEnvDepthCents = Math.round(amtVal);
        pitchEnvSource = src === 'ENV1' ? 'env1' : 'env2';
      }
    }

    let filter: RegionFilterConfig | undefined;
    const fltMatch = /<(?:tx:)?filter1\b([^>]*)\/?>/i.exec(sBody);
    if (fltMatch) {
      const fAttrs = fltMatch[1];
      const fTypeStr = getTxAttr(fAttrs, 'type', 'Off').toLowerCase();
      const enabled = fTypeStr !== 'off' && fTypeStr !== 'none';
      const cutoffHz = Math.max(20, Math.min(22000, parseFloat(getTxAttr(fAttrs, 'cutoff', '20000')) || 20000));
      const resPct = parseFloat(getTxAttr(fAttrs, 'resonance', '0')) || 0;
      const slopeStr = getTxAttr(fAttrs, 'slope', '24dB').toLowerCase();
      const poles: FilterSlopePoles = slopeStr.includes('6') ? 1 : slopeStr.includes('12') ? 2 : 4;
      const type: RegionFilterConfig['type'] =
        fTypeStr.includes('high')
          ? 'hpf'
          : fTypeStr.includes('band')
            ? 'bpf'
            : fTypeStr.includes('notch')
              ? 'notch'
              : 'lpf';
      filter = {
        enabled,
        type,
        poles,
        cutoffHz,
        resonanceDb: Math.round((resPct / 100) * 24 * 10) / 10,
        envToFilterCents: filterEnvDepthCents,
        velToFilterCents: 0,
        keytrackCents: 0,
        filterEnv: filterEnvSource === 'env2' ? env2 : env1,
      };
    }

    let pitchEnv: PitchEnvelopeConfig | undefined;
    if (Math.abs(pitchEnvDepthCents) > 0) {
      const chosenEnv = (pitchEnvSource === 'env2' ? env2 : env1) ?? {
        delaySec: 0,
        attackSec: 0.005,
        holdSec: 0,
        decaySec: 0.15,
        sustainLevel: 0,
        releaseSec: 0.1,
        velModDepth: 0,
      };
      pitchEnv = {
        enabled: true,
        depthCents: pitchEnvDepthCents,
        env: chosenEnv,
      };
    }

    soundshapes.set(id, { id, name, ampEnv, filter, pitchEnv });
  }

  // 3. Parse <tx:group> and <tx:region>
  const regions: Tx16WxRegionDef[] = [];
  const groupRegex = /<(?:tx:)?group\b([^>]*)>([\s\S]*?)<\/(?:tx:)?group>/gi;
  let gm: RegExpExecArray | null;
  let regIdx = 0;

  while ((gm = groupRegex.exec(xmlText)) !== null) {
    const gAttrs = gm[1];
    const gBody = gm[2];
    const groupName = getTxAttr(gAttrs, 'name', 'Group');
    const soundshapeId = getTxAttr(gAttrs, 'soundshape') || undefined;
    const playmodeStr = getTxAttr(gAttrs, 'playmode', 'Normal').toLowerCase();
    const trigger: TriggerMode = playmodeStr === 'release' ? 'release' : 'attack';
    const grpVolDb = parseDbValue(getTxAttr(gAttrs, 'volume', '0 dB'), 0);
    const grpPan = parsePanToSigned50(getTxAttr(gAttrs, 'pan', '0%'));
    const grpCoarse = parseInt(getTxAttr(gAttrs, 'coarse', '0'), 10) || 0;
    const grpFine = parseInt(getTxAttr(gAttrs, 'fine', '0'), 10) || 0;
    const muteGroup = Math.max(0, Math.min(32, parseInt(getTxAttr(gAttrs, 'choke-group', '0'), 10) || 0));
    const polyphony = Math.max(1, Math.min(128, parseInt(getTxAttr(gAttrs, 'notepoly', '16'), 10) || 16));
    const keyscale = parseInt(getTxAttr(gAttrs, 'keyscale', '100'), 10);
    const pitchKeytrack = Number.isFinite(keyscale) ? Math.max(0, Math.min(100, keyscale)) : 100;

    const regionRegex = /<(?:tx:)?region\b([^>]*)(?:\/>|>([\s\S]*?)<\/(?:tx:)?region>)/gi;
    let rm: RegExpExecArray | null;
    while ((rm = regionRegex.exec(gBody)) !== null) {
      const rAttrs = rm[1];
      const rBody = rm[2] || '';
      const waveId = parseInt(getTxAttr(rAttrs, 'wave', '0'), 10) || 0;
      const wave = waves.get(waveId);
      const samplePath = getTxAttr(rAttrs, 'path') || wave?.path || `wave_${waveId}.wav`;

      const rootAttr = getTxAttr(rAttrs, 'root');
      const rootKey = rootAttr ? parseNoteOrInt(rootAttr, 60) : wave?.rootKey ?? 60;

      const boundsMatch = /<(?:tx:)?bounds\b([^>]*)\/?>/i.exec(rBody);
      const bAttrs = boundsMatch ? boundsMatch[1] : rAttrs;
      const lowKey = parseNoteOrInt(getTxAttr(bAttrs, 'low-key', getTxAttr(rAttrs, 'lokey', String(rootKey))), rootKey);
      const highKey = parseNoteOrInt(getTxAttr(bAttrs, 'high-key', getTxAttr(rAttrs, 'hikey', String(rootKey))), rootKey);
      const lowVel = Math.max(1, Math.min(127, parseInt(getTxAttr(bAttrs, 'low-vel', getTxAttr(rAttrs, 'lovel', '1')), 10) || 1));
      const highVel = Math.max(1, Math.min(127, parseInt(getTxAttr(bAttrs, 'high-vel', getTxAttr(rAttrs, 'hivel', '127')), 10) || 127));

      const fadeMatch = /<(?:tx:)?fade\b([^>]*)\/?>/i.exec(rBody);
      let keyFadeIn = 0;
      let keyFadeOut = 0;
      let velFadeIn = 0;
      let velFadeOut = 0;
      if (fadeMatch) {
        const fAttrs = fadeMatch[1];
        const fadeLoKey = parseNoteOrInt(getTxAttr(fAttrs, 'low-key', String(lowKey)), lowKey);
        const fadeHiKey = parseNoteOrInt(getTxAttr(fAttrs, 'high-key', String(highKey)), highKey);
        const fadeLoVel = parseInt(getTxAttr(fAttrs, 'low-vel', String(lowVel)), 10) || lowVel;
        const fadeHiVel = parseInt(getTxAttr(fAttrs, 'high-vel', String(highVel)), 10) || highVel;
        keyFadeIn = Math.max(0, Math.abs(fadeLoKey - lowKey));
        keyFadeOut = Math.max(0, Math.abs(highKey - fadeHiKey));
        velFadeIn = Math.max(0, Math.abs(fadeLoVel - lowVel));
        velFadeOut = Math.max(0, Math.abs(highVel - fadeHiVel));
      }

      const offsetsMatch = /<(?:tx:)?sound-offsets\b([^>]*)\/?>/i.exec(rBody);
      const oAttrs = offsetsMatch ? offsetsMatch[1] : rAttrs;
      const regCoarse = parseInt(getTxAttr(oAttrs, 'coarse', '0'), 10) || 0;
      const regFine = parseInt(getTxAttr(oAttrs, 'fine', '0'), 10) || 0;
      const detuneCents = (grpCoarse + regCoarse) * 100 + grpFine + regFine;

      const regVolDb = parseDbValue(getTxAttr(rAttrs, 'attenuation', getTxAttr(rAttrs, 'volume', '0 dB')), 0);
      const volumeDb = Math.max(-60, Math.min(24, grpVolDb + regVolDb));
      const regPan = parsePanToSigned50(getTxAttr(rAttrs, 'pan', '0%'));
      const pan = Math.max(-50, Math.min(50, grpPan + regPan));
      const reversed = getTxAttr(rAttrs, 'reverse', 'false').toLowerCase() === 'true';

      const loops = wave?.loops ?? [];
      const primaryLoop = loops[0];
      const loopMode: LoopMode =
        playmodeStr === 'oneshot'
          ? 'one_shot'
          : primaryLoop
            ? primaryLoop.mode
            : 'no_loop';
      const loopStart = primaryLoop?.startFrame ?? 0;
      const loopEnd = primaryLoop?.endFrame ?? 0;
      const loopCrossfadeFrames = Math.round(((primaryLoop?.crossfadeMs ?? 0) / 1000) * 44100);

      regIdx++;
      regions.push({
        id: `tx_reg_${String(regIdx).padStart(3, '0')}`,
        groupName,
        muteGroup,
        trigger,
        polyphony,
        soundshapeId,
        waveId,
        samplePath,
        rootKey,
        lowKey,
        highKey,
        lowVel,
        highVel,
        keyFadeIn,
        keyFadeOut,
        velFadeIn,
        velFadeOut,
        detuneCents,
        pitchKeytrack,
        volumeDb,
        pan,
        reversed,
        sampleStartFrame: wave?.sampleStartFrame ?? 0,
        sampleEndFrame: wave?.sampleEndFrame,
        loops,
        loopMode,
        loopStart,
        loopEnd,
        loopCrossfadeFrames,
      });
    }
  }

  const firstSS = soundshapes.values().next().value as Tx16WxSoundshapeDef | undefined;
  const primaryAmpEnv: DahdsrEnvelope = firstSS?.ampEnv ?? {
    delaySec: 0,
    attackSec: 0.005,
    holdSec: 0,
    decaySec: 0.25,
    sustainLevel: 1.0,
    releaseSec: 0.2,
    velModDepth: 100,
  };

  return {
    presetName,
    author,
    waves,
    soundshapes,
    regions,
    primaryAmpEnv,
    primaryFilter: firstSS?.filter,
    primaryPitchEnv: firstSS?.pitchEnv,
  };
}

/**
 * Generates a CWITEC TX16Wx `.txprog` XML string from uniform sampler regions and global articulation.
 */
export function buildTx16WxProgramXml(options: {
  presetName: string;
  author?: string;
  regions: Array<UniformSamplerRegion & { cleanFileName: string; totalFrames: number }>;
  ampEnv?: Partial<DahdsrEnvelope>;
  filter?: Partial<RegionFilterConfig>;
  pitchEnv?: Partial<PitchEnvelopeConfig>;
  polyphony?: number;
}): string {
  const {
    presetName,
    author = 'ABDNeuModMakr',
    regions,
    ampEnv,
    filter,
    pitchEnv,
    polyphony = 16,
  } = options;

  const waveXmlLines: string[] = [];
  const regionXmlLines: string[] = [];

  regions.forEach((reg, idx) => {
    const startFrame = Math.max(0, Math.round(reg.sampleStartFrame ?? 0));
    const endFrame =
      reg.sampleEndFrame && reg.sampleEndFrame > startFrame
        ? Math.round(reg.sampleEndFrame)
        : Math.max(startFrame + 1, reg.totalFrames - 1);

    const activeLoops: SampleLoopDescriptor[] =
      reg.loops && reg.loops.length > 0
        ? reg.loops
        : reg.loopMode !== 'no_loop' && reg.loopEnd > reg.loopStart
          ? [
              {
                id: 'loop-1',
                mode: reg.loopMode,
                startFrame: Math.round(reg.loopStart),
                endFrame: Math.round(reg.loopEnd),
                crossfadeMs: reg.loopCrossfadeMs ?? 0,
              },
            ]
          : [];

    if (activeLoops.length > 0) {
      const loopLines = activeLoops.map((lp, lIdx) => {
        const txMode =
          lp.mode === 'ping_pong'
            ? 'Bidirectional'
            : lp.mode === 'loop_backward'
              ? 'Backward'
              : 'Forward';
        const xfadeFrames = Math.round(((lp.crossfadeMs ?? 0) / 1000) * 44100);
        return `    <tx:loop tx:name="${lIdx + 1}" tx:start="${Math.round(lp.startFrame)}" tx:end="${Math.round(lp.endFrame)}" tx:mode="${txMode}" tx:xfade="${xfadeFrames}"/>`;
      });
      waveXmlLines.push(
        `  <tx:wave tx:id="${idx}" tx:path="Samples/${escapeXml(reg.cleanFileName)}" tx:root="${reg.rootKey}" tx:start="${startFrame}" tx:end="${endFrame}">\n${loopLines.join('\n')}\n  </tx:wave>`
      );
    } else {
      waveXmlLines.push(
        `  <tx:wave tx:id="${idx}" tx:path="Samples/${escapeXml(reg.cleanFileName)}" tx:root="${reg.rootKey}" tx:start="${startFrame}" tx:end="${endFrame}"/>`
      );
    }

    const coarseSt = Math.trunc(reg.detuneCents / 100);
    const fineCents = Math.round(reg.detuneCents - coarseSt * 100);
    const panPct = Math.round((reg.pan / 50) * 100);
    const fadeLoKey = Math.min(reg.highKey, reg.lowKey + (reg.keyFadeIn ?? 0));
    const fadeHiKey = Math.max(reg.lowKey, reg.highKey - (reg.keyFadeOut ?? 0));
    const fadeLoVel = Math.min(reg.highVel, reg.lowVel + (reg.velFadeIn ?? 0));
    const fadeHiVel = Math.max(reg.lowVel, reg.highVel - (reg.velFadeOut ?? 0));

    regionXmlLines.push(`    <tx:region tx:mode="DFD" tx:attenuation="${reg.volumeDb.toFixed(1)} dB" tx:pan="${panPct}%" tx:loop="${activeLoops.length > 0 ? 0 : -1}" tx:release="-1" tx:wave="${idx}" tx:root="${reg.rootKey}" tx:reverse="${reg.reversed ? 'true' : 'false'}">
      <tx:bounds tx:low-key="${reg.lowKey}" tx:high-key="${reg.highKey}" tx:low-vel="${reg.lowVel}" tx:high-vel="${reg.highVel}"/>
      <tx:fade tx:low-key="${fadeLoKey}" tx:high-key="${fadeHiKey}" tx:low-vel="${fadeLoVel}" tx:high-vel="${fadeHiVel}"/>
      <tx:sound-offsets tx:coarse="${coarseSt}" tx:fine="${fineCents}"/>
    </tx:region>`);
  });

  const atkMs = Math.max(1, Math.round(((ampEnv?.attackSec ?? 0.005) + (ampEnv?.delaySec ?? 0)) * 1000));
  const decMs = Math.max(1, Math.round((ampEnv?.decaySec ?? 0.25) * 1000));
  const susLvl = Math.max(0.0001, Math.min(1, ampEnv?.sustainLevel ?? 1));
  const susDb = susLvl >= 0.999 ? 0 : Math.max(-96, 20 * Math.log10(susLvl));
  const relMs = Math.max(1, Math.round((ampEnv?.releaseSec ?? 0.2) * 1000));

  const fltType = !filter?.enabled
    ? 'Off'
    : filter.type === 'hpf'
      ? 'HighPass'
      : filter.type === 'bpf'
        ? 'BandPass'
        : filter.type === 'notch' || filter.type === 'brf'
          ? 'Notch'
          : 'LowPass';
  const fltSlope = filter?.poles === 1 ? '6dB' : filter?.poles === 2 ? '12dB' : '24dB';
  const fltCutoff = Math.max(20, Math.min(20000, filter?.cutoffHz ?? 20000));
  const fltResPct = Math.max(0, Math.min(100, Math.round(((filter?.resonanceDb ?? 0) / 24) * 100)));

  const fEnv = filter?.filterEnv;
  const fAtkMs = Math.max(1, Math.round((fEnv?.attackSec ?? 0.005) * 1000));
  const fDecMs = Math.max(1, Math.round((fEnv?.decaySec ?? 0.25) * 1000));
  const fSusLvl = fEnv?.sustainLevel ?? 0;
  const fSusDb = fSusLvl <= 0.001 ? -96 : 20 * Math.log10(fSusLvl);
  const fRelMs = Math.max(1, Math.round((fEnv?.releaseSec ?? 0.2) * 1000));

  const pEnv = pitchEnv?.env;
  const pAtkMs = Math.max(1, Math.round((pEnv?.attackSec ?? 0.005) * 1000));
  const pDecMs = Math.max(1, Math.round((pEnv?.decaySec ?? 0.15) * 1000));
  const pSusLvl = pEnv?.sustainLevel ?? 0;
  const pSusDb = pSusLvl <= 0.001 ? -96 : 20 * Math.log10(pSusLvl);
  const pRelMs = Math.max(1, Math.round((pEnv?.releaseSec ?? 0.1) * 1000));

  const modLines: string[] = [];
  if (filter?.enabled && Math.abs(filter.envToFilterCents ?? 0) > 0) {
    modLines.push(
      `      <tx:entry tx:source="ENV1" tx:destination="Filter 1 Freq" tx:amount="${Math.round(filter.envToFilterCents ?? 0)}Ct"/>`
    );
  }
  if (pitchEnv?.enabled && Math.abs(pitchEnv.depthCents ?? 0) > 0) {
    modLines.push(
      `      <tx:entry tx:source="ENV2" tx:destination="Pitch" tx:amount="${Math.round(pitchEnv.depthCents ?? 0)}Ct"/>`
    );
  }

  const primaryReg = regions[0];
  const muteGroup = primaryReg?.muteGroup ?? 0;
  const playmode =
    primaryReg?.trigger === 'release'
      ? 'Release'
      : primaryReg?.loopMode === 'one_shot'
        ? 'Oneshot'
        : 'Normal';
  const keyscale = primaryReg?.pitchKeytrack ?? 100;

  return `<?xml version="1.0" encoding="UTF-8"?>
<tx:program xmlns:tx="http://www.tx16wx.com/3.0/program" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.tx16wx.com/3.0/program" tx:created-by="${escapeXml(author)}" tx:quality="Default" tx:name="${escapeXml(presetName)}">
${waveXmlLines.join('\n')}
  <tx:soundshape tx:id="ss-main" tx:name="Main Soundshape" tx:pan="0%" tx:unison="1" tx:glide-mode="Held">
    <tx:aeg tx:attack="${atkMs} ms" tx:attack-shape="-50%" tx:decay1="0 ms" tx:level1="0 dB" tx:decay2="${decMs} ms" tx:decay2-shape="-50%" tx:sustain="${susDb.toFixed(1)} dB" tx:release="${relMs} ms" tx:release-shape="-50%"/>
    <tx:env1 tx:level0="0 dB" tx:attack="${fAtkMs} ms" tx:level1="0 dB" tx:decay1="0 ms" tx:level2="${fSusDb.toFixed(1)} dB" tx:decay2="${fDecMs} ms" tx:sustain="${fSusDb.toFixed(1)} dB" tx:release="${fRelMs} ms"/>
    <tx:env2 tx:level0="0 dB" tx:attack="${pAtkMs} ms" tx:level1="0 dB" tx:decay1="0 ms" tx:level2="${pSusDb.toFixed(1)} dB" tx:decay2="${pDecMs} ms" tx:sustain="${pSusDb.toFixed(1)} dB" tx:release="${pRelMs} ms"/>
    <tx:filter1 tx:type="${fltType}" tx:cutoff="${fltCutoff.toFixed(1)}Hz" tx:resonance="${fltResPct}%" tx:drive="0%" tx:slope="${fltSlope}"/>
    <tx:modulation>
${modLines.join('\n')}
    </tx:modulation>
  </tx:soundshape>
  <tx:group tx:name="Main Group" tx:soundshape="ss-main" tx:playmode="${playmode}" tx:volume="0 dB" tx:pan="0%" tx:coarse="0" tx:fine="0" tx:keyscale="${keyscale}" tx:scale-key="60" tx:choke-group="${muteGroup}" tx:notepoly="${polyphony}" tx:polymode="Poly" tx:output="--" tx:quality="Default" tx:color="yellow">
${regionXmlLines.join('\n')}
  </tx:group>
</tx:program>
`;
}
