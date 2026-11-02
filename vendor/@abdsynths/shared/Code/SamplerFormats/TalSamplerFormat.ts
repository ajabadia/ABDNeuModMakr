// ─────────────────────────────────────────────────────────
// @abdsynths/shared — Togu Audio Line TAL-Sampler (.talsmpl) Reader & Writer (Fase 32.4)
//
// Clean-room implementation of TAL-Sampler XML preset format (<tal><programs><program>).
// Supports up to 4 stereo sample layers (<samplelayer0>..3), zone loops, crossfades,
// reverse playback, mute groups, modeled filter, and non-linear ADSR curves.
// Reference: Jürgen Moßgraber's ConvertWithMoss format documentation.
// ─────────────────────────────────────────────────────────

import type {
  DahdsrEnvelope,
  FilterSlopePoles,
  LoopMode,
  PitchEnvelopeConfig,
  RegionFilterConfig,
  SamplerPlayLogic,
} from './SamplerTypes.ts';
import type { UniformSamplerRegion } from './rawSamplerTypes.ts';

export interface TalSamplerZone {
  layerIndex: number; // 0..3
  samplePath: string;
  rootKey: number;
  lowKey: number;
  highKey: number;
  lowVel: number;
  highVel: number;
  detuneCents: number;
  pitchKeytrack: number;
  volumeDb: number;
  pan: number; // -50..+50
  sampleStartFrame: number;
  sampleEndFrame?: number;
  reversed: boolean;
  loopMode: LoopMode;
  loopStart: number;
  loopEnd: number;
  loopCrossfadeFrames: number;
  muteGroup: number;
  playLogic: SamplerPlayLogic;
}

export interface ParsedTalSampler {
  presetName: string;
  polyphony: number;
  pitchBendRangeSt: number;
  zones: TalSamplerZone[];
  ampEnv: DahdsrEnvelope;
  filter: RegionFilterConfig;
  pitchEnv?: PitchEnvelopeConfig;
}

function getAttr(tag: string, name: string, fallback = ''): string {
  const m = new RegExp(`\\b${name}=["']([^"']*)["']`, 'i').exec(tag);
  return m ? m[1] : fallback;
}

function getAttrNum(tag: string, name: string, fallback: number): number {
  const raw = getAttr(tag, name);
  if (!raw) return fallback;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// TAL-Sampler conversion laws:
// Zone volume: 0.7843 = 0 dB -> dB = 20 * log10(vol / 0.7843)
export function talZoneVolToDb(vol: number): number {
  if (vol <= 0.00001) return -60;
  return Math.max(-60, Math.min(24, 20 * Math.log10(vol / 0.7843)));
}

export function dbToTalZoneVol(db: number): number {
  const linear = 0.7843 * Math.pow(10, db / 20);
  return Math.max(0, Math.min(1, linear));
}

// Transpose / detune: [0..1] <-> [-24..+24]
export function talNormToSigned24(val: number): number {
  return Math.round(val * 48 - 24);
}

export function signed24ToTalNorm(signedVal: number): number {
  const clamped = Math.max(-24, Math.min(24, signedVal));
  return (clamped + 24) / 48;
}

// Attack/Hold/Release: sec = 7.2 * val^4  (max 7.2s)
export function talTimeToSeconds(val: number): number {
  const v = Math.max(0, Math.min(1, val));
  return Math.max(0.001, 7.2 * Math.pow(v, 4));
}

export function secondsToTalTime(sec: number): number {
  const s = Math.max(0, Math.min(7.2, sec));
  return Math.pow(s / 7.2, 0.25);
}

// Decay: sec = 37.1 * val^3.75 (max 37.1s)
export function talDecayToSeconds(val: number): number {
  const v = Math.max(0, Math.min(1, val));
  return Math.max(0.001, 37.1 * Math.pow(v, 3.75));
}

export function secondsToTalDecay(sec: number): number {
  const s = Math.max(0, Math.min(37.1, sec));
  return Math.pow(s / 37.1, 1 / 3.75);
}

// Cutoff [0..1] <-> Hz [20..20000] logarithmic
export function talCutoffToHz(val: number): number {
  const v = Math.max(0, Math.min(1, val));
  return Math.round(20 * Math.pow(1000, v));
}

export function hzToTalCutoff(hz: number): number {
  const clamped = Math.max(20, Math.min(20000, hz));
  return Math.max(0, Math.min(1, Math.log10(clamped / 20) / 3));
}

/**
 * Parses a TAL-Sampler `.talsmpl` XML string into `ParsedTalSampler`.
 */
export function parseTalSampler(xmlText: string, fallbackName = 'TalSamplerPreset'): ParsedTalSampler {
  if (!/<tal\b/i.test(xmlText) && !/<samplelayer/i.test(xmlText)) {
    throw new Error('Invalid TAL-Sampler preset: missing <tal> or <samplelayer> elements.');
  }

  const progMatch = /<program\b([^>]*)>/i.exec(xmlText);
  const progAttrs = progMatch ? progMatch[1] : '';
  const presetName = getAttr(progAttrs, 'programname', fallbackName).trim() || fallbackName;
  const numVoicesNorm = getAttrNum(progAttrs, 'numvoices', 0.5);
  const polyphony = Math.max(1, Math.min(64, Math.round(numVoicesNorm * 32) || 16));
  const pbNorm = getAttrNum(progAttrs, 'globalpitchbendrange', 2 / 12);
  const pitchBendRangeSt = Math.max(0, Math.min(24, Math.round(pbNorm * 12)));

  // Amp Envelope
  const ampEnv: DahdsrEnvelope = {
    delaySec: 0,
    attackSec: talTimeToSeconds(getAttrNum(progAttrs, 'adsrampattack', 0)),
    holdSec: getAttrNum(progAttrs, 'adsramphold', 0) > 0.001 ? talTimeToSeconds(getAttrNum(progAttrs, 'adsramphold', 0)) : 0,
    decaySec: talDecayToSeconds(getAttrNum(progAttrs, 'adsrampdecay', 0.25)),
    sustainLevel: Math.max(0, Math.min(1, getAttrNum(progAttrs, 'adsrampsustain', 1))),
    releaseSec: talTimeToSeconds(getAttrNum(progAttrs, 'adsramprelease', 0.2)),
    velModDepth: 100,
  };

  // Filter
  const filterOn =
    getAttrNum(progAttrs, 'filterlayera', 0) >= 0.5 ||
    getAttrNum(progAttrs, 'filterlayerb', 0) >= 0.5 ||
    getAttrNum(progAttrs, 'filterlayerc', 0) >= 0.5 ||
    getAttrNum(progAttrs, 'filterlayerd', 0) >= 0.5;
  const filterModeIdx = Math.round(getAttrNum(progAttrs, 'filtermode', 0) * 12);
  let filterType: RegionFilterConfig['type'] = 'lpf';
  let poles: FilterSlopePoles = 4;
  if (filterModeIdx === 1) {
    filterType = 'lpf';
    poles = 2;
  } else if (filterModeIdx === 2) {
    filterType = 'lpf';
    poles = 1;
  } else if (filterModeIdx === 7 || filterModeIdx === 8) {
    filterType = 'hpf';
    poles = 2;
  } else if (filterModeIdx === 9) {
    filterType = 'bpf';
    poles = 4;
  } else if (filterModeIdx === 10) {
    filterType = 'notch';
    poles = 2;
  }

  const filterEnvAmt = getAttrNum(progAttrs, 'filterenv', 0.5); // 0.5 = 0, 0..1 -> -4800..+4800 cents
  const envToFilterCents = Math.round((filterEnvAmt - 0.5) * 2 * 4800);
  const filterEnv: DahdsrEnvelope = {
    delaySec: 0,
    attackSec: talTimeToSeconds(getAttrNum(progAttrs, 'adsrvcfattack', 0)),
    holdSec: getAttrNum(progAttrs, 'adsrvcfhold', 0) > 0.001 ? talTimeToSeconds(getAttrNum(progAttrs, 'adsrvcfhold', 0)) : 0,
    decaySec: talDecayToSeconds(getAttrNum(progAttrs, 'adsrvcfdecay', 0.25)),
    sustainLevel: Math.max(0, Math.min(1, getAttrNum(progAttrs, 'adsrvcfsustain', 0.5))),
    releaseSec: talTimeToSeconds(getAttrNum(progAttrs, 'adsrvcfsrelease', getAttrNum(progAttrs, 'adsrvcfrelease', 0.2))),
    velModDepth: 0,
  };

  const filter: RegionFilterConfig = {
    enabled: filterOn,
    type: filterType,
    poles,
    cutoffHz: talCutoffToHz(getAttrNum(progAttrs, 'cutoff', 1)),
    resonanceDb: Math.round(getAttrNum(progAttrs, 'resonance', 0) * 24 * 10) / 10,
    envToFilterCents,
    velToFilterCents: 0,
    keytrackCents: Math.round(getAttrNum(progAttrs, 'keyfollow', 0) * 1200),
    filterEnv,
  };

  // Pitch / Mod Envelope
  const modEnvAttack = talTimeToSeconds(getAttrNum(progAttrs, 'adsrmodattack', 0));
  const modEnvDecay = talDecayToSeconds(getAttrNum(progAttrs, 'adsrmoddecay', 0.15));
  const modEnvSustain = Math.max(0, Math.min(1, getAttrNum(progAttrs, 'adsrmodsustain', 0)));
  const modEnvRelease = talTimeToSeconds(getAttrNum(progAttrs, 'adsrmodrelease', 0.1));
  let pitchEnv: PitchEnvelopeConfig | undefined;
  const modMatrixMatch = /<modmatrix>([\s\S]*?)<\/modmatrix>/i.exec(xmlText);
  if (modMatrixMatch) {
    const entryRegex = /<entry\b([^>]*)\/?>/gi;
    let em: RegExpExecArray | null;
    while ((em = entryRegex.exec(modMatrixMatch[1])) !== null) {
      const eAttrs = em[1];
      const src = getAttrNum(eAttrs, 'modmatrixsourceid', -1);
      const dst = getAttrNum(eAttrs, 'modmatrixparameterid', -1);
      const amt = getAttrNum(eAttrs, 'modmatrixamount', 0.5);
      // src 2 = Env 3 (Mod Env), dst 98 = Global Pitch
      if (src === 2 && (dst === 98 || dst === 99) && Math.abs(amt - 0.5) > 0.005) {
        pitchEnv = {
          enabled: true,
          depthCents: Math.round((amt - 0.5) * 2 * 4800),
          env: {
            delaySec: 0,
            attackSec: modEnvAttack,
            holdSec: 0,
            decaySec: modEnvDecay,
            sustainLevel: modEnvSustain,
            releaseSec: modEnvRelease,
            velModDepth: 0,
          },
        };
      }
    }
  }

  // Parse layers <samplelayer0> .. <samplelayer3>
  const zones: TalSamplerZone[] = [];
  for (let layerIdx = 0; layerIdx < 4; layerIdx++) {
    const layerRegex = new RegExp(`<samplelayer${layerIdx}\\b[^>]*>([\\s\\S]*?)<\\/samplelayer${layerIdx}>`, 'i');
    const layerMatch = layerRegex.exec(xmlText);
    if (!layerMatch) continue;

    const sampleRegex = /<multisample\b([^>]*)\/?>/gi;
    let sm: RegExpExecArray | null;
    while ((sm = sampleRegex.exec(layerMatch[1])) !== null) {
      const sAttrs = sm[1];
      const url = getAttr(sAttrs, 'url');
      if (!url) continue;

      const rootKey = Math.max(0, Math.min(127, Math.round(getAttrNum(sAttrs, 'rootkey', 60))));
      const lowKey = Math.max(0, Math.min(127, Math.round(getAttrNum(sAttrs, 'lowkey', rootKey))));
      const highKey = Math.max(0, Math.min(127, Math.round(getAttrNum(sAttrs, 'highkey', rootKey))));
      const lowVel = Math.max(1, Math.min(127, Math.round(getAttrNum(sAttrs, 'velocitystart', 1))));
      const highVel = Math.max(1, Math.min(127, Math.round(getAttrNum(sAttrs, 'velocityend', 127))));

      const coarseSt = talNormToSigned24(getAttrNum(sAttrs, 'transpose', 0.5));
      const fineCents = talNormToSigned24(getAttrNum(sAttrs, 'detune', 0.5));
      const detuneCents = coarseSt * 100 + fineCents;

      const pitchKeytrack = getAttrNum(sAttrs, 'track', 1) >= 0.5 ? 100 : 0;
      const volumeDb = talZoneVolToDb(getAttrNum(sAttrs, 'volume', 0.7843));
      const panNorm = getAttrNum(sAttrs, 'pan', 0.5); // 0..1 (0.5 center)
      const pan = Math.max(-50, Math.min(50, Math.round((panNorm - 0.5) * 100)));

      const sampleStartFrame = Math.max(0, Math.round(getAttrNum(sAttrs, 'startsample', 0)));
      const rawEnd = Math.round(getAttrNum(sAttrs, 'endsample', 0));
      const sampleEndFrame = rawEnd > sampleStartFrame ? rawEnd : undefined;
      const reversed = getAttrNum(sAttrs, 'reverse', 0) >= 0.5;

      const loopEnabled = getAttrNum(sAttrs, 'loopenabled', 0) >= 0.5;
      const pingPong = getAttrNum(sAttrs, 'pingpongloop', 0) >= 0.5;
      const loopStart = Math.max(0, Math.round(getAttrNum(sAttrs, 'loopstartsample', 0)));
      const loopEnd = Math.max(0, Math.round(getAttrNum(sAttrs, 'loopendsample', 0)));
      const loopCrossfadeFrames = Math.max(0, Math.round(getAttrNum(sAttrs, 'fadeinsamples', 0)));
      const loopMode: LoopMode =
        loopEnabled && loopEnd > loopStart ? (pingPong ? 'ping_pong' : 'loop_continuous') : 'no_loop';

      const muteVal = getAttrNum(sAttrs, 'mutegroup', 0);
      const muteGroup = muteVal > 0 ? Math.min(32, Math.max(1, Math.round(muteVal * 8))) : 0;
      const sliceMode = Math.round(getAttrNum(sAttrs, 'slicemode', 0) * 3);
      const playLogic: SamplerPlayLogic =
        sliceMode === 1 ? 'round_robin' : sliceMode === 2 ? 'random' : 'velocity';

      zones.push({
        layerIndex: layerIdx,
        samplePath: url,
        rootKey,
        lowKey,
        highKey,
        lowVel,
        highVel,
        detuneCents,
        pitchKeytrack,
        volumeDb,
        pan,
        sampleStartFrame,
        sampleEndFrame,
        reversed,
        loopMode,
        loopStart,
        loopEnd,
        loopCrossfadeFrames,
        muteGroup,
        playLogic,
      });
    }
  }

  return {
    presetName,
    polyphony,
    pitchBendRangeSt,
    zones,
    ampEnv,
    filter,
    pitchEnv,
  };
}

/**
 * Builds a TAL-Sampler `.talsmpl` XML string from uniform regions and articulation.
 */
export function buildTalSamplerXml(options: {
  presetName: string;
  regions: Array<UniformSamplerRegion & { cleanFileName: string; totalFrames: number }>;
  ampEnv?: Partial<DahdsrEnvelope>;
  filter?: Partial<RegionFilterConfig>;
  pitchEnv?: Partial<PitchEnvelopeConfig>;
  polyphony?: number;
  pitchBendRangeSt?: number;
}): string {
  const {
    presetName,
    regions,
    ampEnv,
    filter,
    pitchEnv,
    polyphony = 16,
    pitchBendRangeSt = 2,
  } = options;

  // Distribute regions across up to 4 layers if groupId / seqPosition is used, otherwise layer 0
  const layerXml: [string[], string[], string[], string[]] = [[], [], [], []];
  for (const reg of regions) {
    const layerIdx =
      reg.seqPosition && reg.seqPosition >= 1 && reg.seqPosition <= 4
        ? (reg.seqPosition - 1) % 4
        : 0;

    const coarseSt = Math.max(-24, Math.min(24, Math.trunc(reg.detuneCents / 100)));
    const fineCents = Math.max(-24, Math.min(24, Math.round(reg.detuneCents - coarseSt * 100)));
    const transposeNorm = signed24ToTalNorm(coarseSt);
    const detuneNorm = signed24ToTalNorm(fineCents);
    const volNorm = dbToTalZoneVol(reg.volumeDb);
    const panNorm = Math.max(0, Math.min(1, 0.5 + reg.pan / 100));

    const startSample = Math.max(0, Math.round(reg.sampleStartFrame ?? 0));
    const endSample =
      reg.sampleEndFrame && reg.sampleEndFrame > startSample
        ? Math.round(reg.sampleEndFrame)
        : Math.max(startSample + 1, reg.totalFrames - 1);

    const hasLoop = reg.loopMode !== 'no_loop' && reg.loopEnd > reg.loopStart;
    const loopStart = hasLoop ? Math.round(reg.loopStart) : 0;
    const loopEnd = hasLoop ? Math.round(reg.loopEnd) : endSample;
    const fadeSamples = Math.round(((reg.loopCrossfadeMs ?? 0) / 1000) * 44100);
    const pingPong = reg.loopMode === 'ping_pong' ? '1.0' : '0.0';
    const muteNorm = reg.muteGroup && reg.muteGroup > 0 ? Math.min(1, reg.muteGroup / 8).toFixed(4) : '0.0';
    const sliceMode =
      reg.playLogic === 'round_robin' ? (1 / 3).toFixed(4) : reg.playLogic === 'random' ? (2 / 3).toFixed(4) : '0.0';

    layerXml[layerIdx].push(
      `          <multisample url="Samples/${escapeXml(reg.cleanFileName)}" rootkey="${reg.rootKey}" lowkey="${reg.lowKey}" highkey="${reg.highKey}" velocitystart="${reg.lowVel}" velocityend="${reg.highVel}" volume="${volNorm.toFixed(4)}" pan="${panNorm.toFixed(4)}" transpose="${transposeNorm.toFixed(4)}" detune="${detuneNorm.toFixed(4)}" track="${reg.pitchKeytrack > 0 ? '1.0' : '0.0'}" startsample="${startSample}" endsample="${endSample}" reverse="${reg.reversed ? '1.0' : '0.0'}" loopenabled="${hasLoop ? '1.0' : '0.0'}" loopstartsample="${loopStart}" loopendsample="${loopEnd}" fadeinsamples="${fadeSamples.toFixed(1)}" pingpongloop="${pingPong}" mutegroup="${muteNorm}" slicemode="${sliceMode}" romsample="0" isstereo="1"/>`
    );
  }

  const ampAtk = secondsToTalTime((ampEnv?.attackSec ?? 0.005) + (ampEnv?.delaySec ?? 0));
  const ampHld = (ampEnv?.holdSec ?? 0) > 0 ? secondsToTalTime(ampEnv!.holdSec!) : 0;
  const ampDec = secondsToTalDecay(ampEnv?.decaySec ?? 0.25);
  const ampSus = Math.max(0, Math.min(1, ampEnv?.sustainLevel ?? 1));
  const ampRel = secondsToTalTime(ampEnv?.releaseSec ?? 0.2);

  const fltOn = filter?.enabled ? '1.0' : '0.0';
  let fltModeIdx = 0; // LP 24dB
  if (filter?.type === 'lpf') {
    fltModeIdx = filter.poles === 1 ? 2 : filter.poles === 2 ? 1 : 0;
  } else if (filter?.type === 'hpf') {
    fltModeIdx = 7;
  } else if (filter?.type === 'bpf') {
    fltModeIdx = 9;
  } else if (filter?.type === 'notch' || filter?.type === 'brf') {
    fltModeIdx = 10;
  }
  const fltModeNorm = (fltModeIdx / 12).toFixed(4);
  const fltCutoffNorm = hzToTalCutoff(filter?.cutoffHz ?? 20000).toFixed(4);
  const fltResNorm = Math.max(0, Math.min(1, (filter?.resonanceDb ?? 0) / 24)).toFixed(4);
  const fltEnvNorm = Math.max(0, Math.min(1, 0.5 + (filter?.envToFilterCents ?? 0) / 9600)).toFixed(4);
  const fltKeyNorm = Math.max(0, Math.min(1, (filter?.keytrackCents ?? 0) / 1200)).toFixed(4);
  const fEnv = filter?.filterEnv;
  const vcfAtk = secondsToTalTime(fEnv?.attackSec ?? 0.005);
  const vcfHld = (fEnv?.holdSec ?? 0) > 0 ? secondsToTalTime(fEnv!.holdSec!) : 0;
  const vcfDec = secondsToTalDecay(fEnv?.decaySec ?? 0.25);
  const vcfSus = Math.max(0, Math.min(1, fEnv?.sustainLevel ?? 0.5));
  const vcfRel = secondsToTalTime(fEnv?.releaseSec ?? 0.2);

  const pEnv = pitchEnv?.env;
  const modAtk = secondsToTalTime(pEnv?.attackSec ?? 0.005);
  const modDec = secondsToTalDecay(pEnv?.decaySec ?? 0.15);
  const modSus = Math.max(0, Math.min(1, pEnv?.sustainLevel ?? 0));
  const modRel = secondsToTalTime(pEnv?.releaseSec ?? 0.1);
  const pitchEnvAmt =
    pitchEnv?.enabled && pitchEnv.depthCents
      ? Math.max(0, Math.min(1, 0.5 + pitchEnv.depthCents / 9600))
      : 0.5;

  const enableB = layerXml[1].length > 0 ? '1.0' : '0.0';
  const enableC = layerXml[2].length > 0 ? '1.0' : '0.0';
  const enableD = layerXml[3].length > 0 ? '1.0' : '0.0';

  return `<?xml version="1.0" encoding="UTF-8"?>
<tal curprogram="0" version="9">
  <programs>
    <program programname="${escapeXml(presetName)}" volume="0.5" numvoices="${Math.min(1, polyphony / 32).toFixed(4)}" globalpitchbendrange="${Math.min(1, pitchBendRangeSt / 12).toFixed(4)}" sampleenableda="1.0" sampleenabledb="${enableB}" sampleenabledc="${enableC}" sampleenabledd="${enableD}" filterlayera="${fltOn}" filterlayerb="${fltOn}" filterlayerc="${fltOn}" filterlayerd="${fltOn}" filtermode="${fltModeNorm}" cutoff="${fltCutoffNorm}" resonance="${fltResNorm}" filterenv="${fltEnvNorm}" keyfollow="${fltKeyNorm}" adsrampattack="${ampAtk.toFixed(4)}" adsrampdecay="${ampDec.toFixed(4)}" adsrampsustain="${ampSus.toFixed(4)}" adsramprelease="${ampRel.toFixed(4)}" adsramphold="${ampHld.toFixed(4)}" adsrvcfattack="${vcfAtk.toFixed(4)}" adsrvcfdecay="${vcfDec.toFixed(4)}" adsrvcfsustain="${vcfSus.toFixed(4)}" adsrvcfsrelease="${vcfRel.toFixed(4)}" adsrvcfhold="${vcfHld.toFixed(4)}" adsrmodattack="${modAtk.toFixed(4)}" adsrmoddecay="${modDec.toFixed(4)}" adsrmodsustain="${modSus.toFixed(4)}" adsrmodrelease="${modRel.toFixed(4)}">
      <samplelayer0>
        <multisamples>
${layerXml[0].join('\n')}
        </multisamples>
      </samplelayer0>
      <samplelayer1>
        <multisamples>
${layerXml[1].join('\n')}
        </multisamples>
      </samplelayer1>
      <samplelayer2>
        <multisamples>
${layerXml[2].join('\n')}
        </multisamples>
      </samplelayer2>
      <samplelayer3>
        <multisamples>
${layerXml[3].join('\n')}
        </multisamples>
      </samplelayer3>
      <modmatrix>
        <entry modmatrixsourceid="2" modmatrixparameterid="98" modmatrixamount="${pitchEnvAmt.toFixed(4)}"/>
      </modmatrix>
    </program>
  </programs>
</tal>
`;
}
