// ─────────────────────────────────────────────────────────
// @abdsynths/shared - Deterministic Universal Sampler Offline Renderer
//
// Renders a single-note or velocity-layered stimulus offline from any
// UniversalSamplerInstrument (imported from SF2, SFZ, Kontakt, MPC, EXS24,
// DecentSampler, .neuronikmodel, or .abdsmpl.zip canonical capsules) into
// stereo Float32 buffers and 24-bit WAV for metrological A/B comparison.
// ─────────────────────────────────────────────────────────

import { decodeWav, encodeWavPcm24, type DecodedWav } from '../NeuronFormats/WavAiffDecoder.ts';
import type {
  CrossfadeCurve,
  DahdsrEnvelope,
  ExtendedRegion,
  PitchEnvelopeConfig,
  RegionFilterConfig,
} from './SamplerTypes.ts';
import { basename, clamp, dbToLinear } from './SamplerUtils.ts';
import type { UniversalSamplerInstrument } from './UniversalSamplerModel.ts';

export interface SamplerOfflineRenderOptions {
  midiNote?: number;
  velocity?: number;
  noteHoldSec?: number;
  releaseTailSec?: number;
  sampleRate?: number;
  roundRobinIndex?: number;
  activeKeyswitch?: number;
  includeReleaseTrigger?: boolean;
}

export interface SamplerOfflineRenderResult {
  sampleRate: number;
  numFrames: number;
  durationSec: number;
  left: Float32Array;
  right: Float32Array;
  wavBuffer: ArrayBuffer;
  activeRegionIds: string[];
  peakLinear: number;
  rmsLinear: number;
}

const EXP_5_NORM = 1.0 - Math.exp(-5.0);
const EXP_5_TAIL = Math.exp(-5.0);

function normalizedExpBlend(start: number, end: number, tNorm: number): number {
  const k = clamp(tNorm, 0, 1);
  const w = (Math.exp(-5.0 * k) - EXP_5_TAIL) / EXP_5_NORM;
  return end + (start - end) * w;
}

function evaluateDahdsrHoldLevel(t: number, env: DahdsrEnvelope): number {
  const delay = Math.max(0, env.delaySec ?? 0);
  const attack = Math.max(0.001, env.attackSec ?? 0.005);
  const hold = Math.max(0, env.holdSec ?? 0);
  const decay = Math.max(0.001, env.decaySec ?? 0.25);
  const startLvl = clamp(env.startLevel ?? 0, 0, 1);
  const peakLvl = clamp(env.holdLevel ?? 1, 0, 1);
  const sustainLvl = clamp(env.sustainLevel ?? 1, 0, 1);

  if (t < delay) return startLvl;
  const tA = t - delay;
  if (tA < attack) {
    return startLvl + (peakLvl - startLvl) * (tA / attack);
  }
  const tH = tA - attack;
  if (tH < hold) return peakLvl;
  const tD = tH - hold;
  if (tD < decay) {
    const k = tD / decay;
    return env.decaySlope === 'linear'
      ? peakLvl + (sustainLvl - peakLvl) * k
      : normalizedExpBlend(peakLvl, sustainLvl, k);
  }
  return sustainLvl;
}

function evaluateEnvelopeLevel(
  t: number,
  noteOffSec: number,
  env: DahdsrEnvelope,
  enabled: boolean,
  isOneShot: boolean,
): number {
  const effectiveNoteOff = isOneShot ? Number.POSITIVE_INFINITY : noteOffSec;
  if (!enabled) {
    if (t <= effectiveNoteOff) return 1.0;
    const rt = t - effectiveNoteOff;
    const rel = 0.015;
    return rt >= rel ? 0.0 : 1.0 - rt / rel;
  }

  if (t < effectiveNoteOff) {
    return evaluateDahdsrHoldLevel(t, env);
  }

  const release = Math.max(0.005, env.releaseSec ?? 0.2);
  const rt = t - effectiveNoteOff;
  const endLvl = clamp(env.endLevel ?? 0, 0, 1);
  if (rt >= release) return endLvl;

  const relStartLvl = evaluateDahdsrHoldLevel(effectiveNoteOff, env);
  const rk = rt / release;
  return env.releaseSlope === 'linear'
    ? relStartLvl + (endLvl - relStartLvl) * rk
    : normalizedExpBlend(relStartLvl, endLvl, rk);
}

function computeCrossfadeGain(
  val: number,
  low: number,
  high: number,
  fadeIn: number,
  fadeOut: number,
  curve: CrossfadeCurve,
): number {
  let gain = 1.0;
  if (fadeIn > 0 && val < low + fadeIn) {
    const t = clamp((val - low) / fadeIn, 0, 1);
    gain *= curve === 'linear' ? t : Math.sin(t * Math.PI * 0.5);
  }
  if (fadeOut > 0 && val > high - fadeOut) {
    const t = clamp((high - val) / fadeOut, 0, 1);
    gain *= curve === 'linear' ? t : Math.sin(t * Math.PI * 0.5);
  }
  return gain;
}

function readCubic(buf: Float32Array, pos: number, minIdx: number, maxIdx: number): number {
  if (buf.length === 0 || maxIdx < minIdx) return 0;
  const clampedPos = clamp(pos, minIdx, maxIdx);
  const i1 = Math.floor(clampedPos);
  const frac = clampedPos - i1;
  const i0 = Math.max(minIdx, i1 - 1);
  const i2 = Math.min(maxIdx, i1 + 1);
  const i3 = Math.min(maxIdx, i1 + 2);
  const y0 = buf[i0];
  const y1 = buf[i1];
  const y2 = buf[i2];
  const y3 = buf[i3];
  const c0 = y1;
  const c1 = 0.5 * (y2 - y0);
  const c2 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
  const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
  return ((c3 * frac + c2) * frac + c1) * frac + c0;
}

class CytomicSvfState {
  private ic1 = 0;
  private ic2 = 0;

  process(
    v0: number,
    cutoffHz: number,
    resonanceDb: number,
    sampleRate: number,
    type: RegionFilterConfig['type'],
  ): number {
    const fc = clamp(cutoffHz, 20, sampleRate * 0.45);
    const g = Math.tan((Math.PI * fc) / sampleRate);
    const q = Math.max(0.5, Math.pow(10, clamp(resonanceDb, 0, 40) / 20));
    const k = 1.0 / q;
    const a1 = 1.0 / (1.0 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;

    const v3 = v0 - this.ic2;
    const v1 = a1 * this.ic1 + a2 * v3;
    const v2 = this.ic2 + a2 * this.ic1 + a3 * v3;
    this.ic1 = 2.0 * v1 - this.ic1;
    this.ic2 = 2.0 * v2 - this.ic2;

    switch (type) {
      case 'hpf':
        return v0 - k * v1 - v2;
      case 'bpf':
        return v1;
      case 'notch':
      case 'brf':
        return v0 - k * v1;
      case 'lpf':
      default:
        return v2;
    }
  }
}

function lookupSampleBuffer(
  audioPool: Map<string, ArrayBuffer> | undefined,
  sampleName: string,
): ArrayBuffer | undefined {
  if (!audioPool || !sampleName) return undefined;
  if (audioPool.has(sampleName)) return audioPool.get(sampleName);
  const targetLower = sampleName.replace(/\\/g, '/').toLowerCase();
  const targetBase = basename(sampleName).toLowerCase();
  for (const [k, v] of audioPool.entries()) {
    const kNorm = k.replace(/\\/g, '/').toLowerCase();
    if (kNorm === targetLower || basename(k).toLowerCase() === targetBase) {
      return v;
    }
  }
  return undefined;
}

function selectActiveRegionsDeterministic(
  candidates: ExtendedRegion[],
  roundRobinIndex: number,
): ExtendedRegion[] {
  if (candidates.length === 0) return [];
  const rrBuckets = new Map<string, ExtendedRegion[]>();
  const nonRr: ExtendedRegion[] = [];

  for (const r of candidates) {
    const isRr = (r.seqLength ?? 1) > 1 || r.playLogic === 'round_robin';
    if (!isRr) {
      nonRr.push(r);
    } else {
      const key = `${r.groupId ?? 'default'}|${r.lowKey}-${r.highKey}|${r.lowVel}-${r.highVel}`;
      const list = rrBuckets.get(key) ?? [];
      list.push(r);
      rrBuckets.set(key, list);
    }
  }

  const chosen: ExtendedRegion[] = [...nonRr];
  for (const bucket of rrBuckets.values()) {
    const maxLen = Math.max(...bucket.map((r) => r.seqLength ?? bucket.length));
    const targetPos = ((Math.max(1, roundRobinIndex) - 1) % maxLen) + 1;
    const match = bucket.find((r) => (r.seqPosition ?? 1) === targetPos) ?? bucket[0];
    if (match) chosen.push(match);
  }
  return chosen;
}

function renderSingleRegionIntoMix(
  region: ExtendedRegion,
  decoded: DecodedWav,
  instrument: UniversalSamplerInstrument,
  midiNote: number,
  velocity: number,
  startOffsetSec: number,
  noteHoldSec: number,
  outSampleRate: number,
  totalFrames: number,
  outLeft: Float32Array,
  outRight: Float32Array,
): void {
  const art = instrument.articulation;
  const ampEnv: DahdsrEnvelope = region.ampEnvOverride
    ? { ...art.ampEnv, ...region.ampEnvOverride }
    : art.ampEnv;
  const ampEnvEnabled =
    Boolean(art.ampEnvEnabled) ||
    Boolean(region.hasArticulationOverride && region.ampEnvOverride);

  const filterCfg: RegionFilterConfig = region.filterOverride
    ? { ...art.filter, ...region.filterOverride }
    : art.filter;
  const pitchEnvCfg: PitchEnvelopeConfig | undefined = region.pitchEnvOverride
    ? { ...(art.pitchEnv ?? { enabled: true, depthCents: 0, env: art.modEnv }), ...region.pitchEnvOverride }
    : art.pitchEnv;

  const isStereo = decoded.channels.length >= 2;
  const rawLeft = decoded.channels[0];
  const rawRight = isStereo ? decoded.channels[1] : rawLeft;
  if (!rawLeft || rawLeft.length === 0) return;

  const startF = clamp(region.sampleStartFrame ?? 0, 0, Math.max(0, rawLeft.length - 1));
  const endF =
    region.sampleEndFrame !== undefined && region.sampleEndFrame > startF
      ? Math.min(rawLeft.length, region.sampleEndFrame)
      : rawLeft.length;
  const sliceLen = endF - startF;
  if (sliceLen <= 0) return;

  let playLeft = rawLeft;
  let playRight = rawRight;
  let localStartF = startF;
  let localEndF = endF;
  if (region.reversed) {
    const revL = new Float32Array(sliceLen);
    const revR = new Float32Array(sliceLen);
    for (let i = 0; i < sliceLen; i++) {
      revL[i] = rawLeft[endF - 1 - i];
      revR[i] = rawRight[endF - 1 - i];
    }
    playLeft = revL;
    playRight = revR;
    localStartF = 0;
    localEndF = sliceLen;
  }

  const velDepth =
    (region.velToVolumeDepth ?? ampEnv.velModDepth ?? 100) / 100;
  const normVel = clamp(velocity, 1, 127) / 127;
  const concaveVel = normVel * normVel;
  const velGain =
    velDepth >= 0
      ? clamp(1 - velDepth + velDepth * concaveVel, 0, 2)
      : clamp(1 + Math.abs(velDepth) * (1 - concaveVel) * 0.5, 0, 2);

  const keyXf = computeCrossfadeGain(
    midiNote,
    region.lowKey,
    region.highKey,
    region.keyFadeIn,
    region.keyFadeOut,
    region.fadeCurve,
  );
  const velXf = computeCrossfadeGain(
    velocity,
    region.lowVel,
    region.highVel,
    region.velFadeIn,
    region.velFadeOut,
    region.fadeCurve,
  );

  const volLin = dbToLinear(region.volume) * velGain * keyXf * velXf;
  const panNorm = clamp(region.pan, -50, 50) / 50;
  let gainL: number;
  let gainR: number;
  if (isStereo) {
    gainL = volLin * (panNorm <= 0 ? 1.0 : Math.cos(panNorm * Math.PI * 0.5));
    gainR = volLin * (panNorm >= 0 ? 1.0 : Math.cos(-panNorm * Math.PI * 0.5));
  } else {
    const angle = (panNorm + 1) * 0.25 * Math.PI;
    gainL = volLin * Math.cos(angle);
    gainR = volLin * Math.sin(angle);
  }

  const primaryLoop = region.loops && region.loops.length > 0 ? region.loops[0] : undefined;
  const loopMode = primaryLoop?.mode ?? region.loopMode;
  const rawLoopStart = primaryLoop?.startFrame ?? region.loopStart;
  const rawLoopEnd = primaryLoop?.endFrame ?? region.loopEnd;
  const hasLoop =
    (loopMode === 'loop_continuous' || loopMode === 'loop_sustain' || loopMode === 'ping_pong') &&
    rawLoopEnd > rawLoopStart &&
    rawLoopEnd <= localEndF &&
    rawLoopStart >= localStartF;
  const loopStart = hasLoop ? rawLoopStart : localStartF;
  const loopEnd = hasLoop ? rawLoopEnd : localEndF;
  const loopSpan = Math.max(1, loopEnd - loopStart);
  const xfadeMs = primaryLoop?.crossfadeMs ?? region.loopCrossfadeMs ?? 0;
  const xfadeSamples = hasLoop
    ? Math.min(
        Math.max(0, loopStart - localStartF),
        Math.round((xfadeMs / 1000) * decoded.sampleRate),
        Math.floor(loopSpan * 0.45),
      )
    : 0;

  const isOneShot = loopMode === 'one_shot';
  const startFrameOut = Math.max(0, Math.round(startOffsetSec * outSampleRate));
  const holdFramesFromTrigger = Math.max(1, Math.round(noteHoldSec * outSampleRate));

  const baseSemis =
    (midiNote - region.rootKey) * (region.pitchKeytrack / 100) +
    (region.detune + normVel * (region.velToPitchCents ?? 0)) / 100;
  const rateScale = decoded.sampleRate / outSampleRate;

  const filterEnv = filterCfg.filterEnv ?? art.modEnv;
  const filterEnabled = Boolean(filterCfg.enabled);
  const cascadeTwo = filterEnabled && (filterCfg.poles ?? 2) >= 4;
  const svfL1 = new CytomicSvfState();
  const svfR1 = new CytomicSvfState();
  const svfL2 = cascadeTwo ? new CytomicSvfState() : undefined;
  const svfR2 = cascadeTwo ? new CytomicSvfState() : undefined;

  let pos = localStartF;
  let dir = 1;
  const minIdx = localStartF;
  const maxIdx = localEndF - 1;

  for (let n = startFrameOut; n < totalFrames; n++) {
    const localN = n - startFrameOut;
    const tSec = localN / outSampleRate;

    if (pos >= localEndF || pos < localStartF) break;

    const envGain = evaluateEnvelopeLevel(tSec, noteHoldSec, ampEnv, ampEnvEnabled, isOneShot);
    if (!isOneShot && tSec >= noteHoldSec + (ampEnvEnabled ? Math.max(0.005, ampEnv.releaseSec ?? 0.2) : 0.015)) {
      break;
    }

    let envPitchSemis = 0;
    if (pitchEnvCfg && pitchEnvCfg.enabled && pitchEnvCfg.depthCents !== 0) {
      const pEnvVal = evaluateEnvelopeLevel(tSec, noteHoldSec, pitchEnvCfg.env, true, isOneShot);
      envPitchSemis = (pitchEnvCfg.depthCents * pEnvVal) / 100;
    }

    const step = rateScale * Math.pow(2, (baseSemis + envPitchSemis) / 12);

    let sL = readCubic(playLeft, pos, minIdx, maxIdx);
    let sR = isStereo ? readCubic(playRight, pos, minIdx, maxIdx) : sL;

    if (xfadeSamples > 0 && loopMode !== 'ping_pong' && pos >= loopEnd - xfadeSamples) {
      const loopActiveNow =
        loopMode === 'loop_continuous' || (loopMode === 'loop_sustain' && localN < holdFramesFromTrigger);
      if (loopActiveNow) {
        const prePos = loopStart - (loopEnd - pos);
        if (prePos >= minIdx) {
          const tXf = clamp((loopEnd - pos) / xfadeSamples, 0, 1);
          const preL = readCubic(playLeft, prePos, minIdx, maxIdx);
          const preR = isStereo ? readCubic(playRight, prePos, minIdx, maxIdx) : preL;
          const wOut = Math.sin(tXf * Math.PI * 0.5);
          const wIn = Math.cos(tXf * Math.PI * 0.5);
          sL = sL * wOut + preL * wIn;
          sR = sR * wOut + preR * wIn;
        }
      }
    }

    if (filterEnabled) {
      let cutCents = 0;
      if (filterCfg.keytrackCents) {
        cutCents += ((midiNote - 60) / 12) * filterCfg.keytrackCents;
      }
      if (filterCfg.velToFilterCents) {
        cutCents += (normVel - 0.5) * filterCfg.velToFilterCents;
      }
      if (filterCfg.envToFilterCents) {
        const fEnvVal = evaluateEnvelopeLevel(tSec, noteHoldSec, filterEnv, true, isOneShot);
        cutCents += filterCfg.envToFilterCents * fEnvVal;
      }
      const effCutoff = filterCfg.cutoffHz * Math.pow(2, cutCents / 1200);
      sL = svfL1.process(sL, effCutoff, filterCfg.resonanceDb, outSampleRate, filterCfg.type);
      sR = isStereo
        ? svfR1.process(sR, effCutoff, filterCfg.resonanceDb, outSampleRate, filterCfg.type)
        : sL;
      if (cascadeTwo && svfL2 && svfR2) {
        sL = svfL2.process(sL, effCutoff, filterCfg.resonanceDb * 0.5, outSampleRate, filterCfg.type);
        sR = isStereo
          ? svfR2.process(sR, effCutoff, filterCfg.resonanceDb * 0.5, outSampleRate, filterCfg.type)
          : sL;
      }
    }

    outLeft[n] += sL * envGain * gainL;
    outRight[n] += sR * envGain * gainR;

    pos += step * dir;

    const loopActiveNext =
      hasLoop &&
      (loopMode === 'loop_continuous' ||
        loopMode === 'ping_pong' ||
        (loopMode === 'loop_sustain' && localN < holdFramesFromTrigger));

    if (loopActiveNext) {
      if (loopMode === 'ping_pong') {
        while (pos >= loopEnd || pos < loopStart) {
          if (pos >= loopEnd) {
            pos = loopEnd - (pos - loopEnd);
            dir = -1;
          } else if (pos < loopStart) {
            pos = loopStart + (loopStart - pos);
            dir = 1;
          }
        }
      } else {
        while (pos >= loopEnd) {
          pos -= loopSpan;
        }
      }
    }
  }
}

/**
 * Deterministically renders a MIDI note stimulus from a `UniversalSamplerInstrument`
 * into stereo Float32 arrays and a 24-bit stereo WAV buffer.
 */
export function renderUniversalSamplerNoteOffline(
  instrument: UniversalSamplerInstrument,
  options: SamplerOfflineRenderOptions = {},
): SamplerOfflineRenderResult {
  const midiNote = clamp(Math.round(options.midiNote ?? 60), 0, 127);
  const velocity = clamp(Math.round(options.velocity ?? 100), 1, 127);
  const noteHoldSec = clamp(options.noteHoldSec ?? 1.2, 0.02, 30);
  const releaseTailSec = clamp(options.releaseTailSec ?? 0.5, 0.05, 30);
  const outSampleRate = clamp(Math.round(options.sampleRate ?? 48000), 4000, 192000);
  const rrIndex = options.roundRobinIndex ?? 1;
  const includeReleaseTrigger = options.includeReleaseTrigger !== false;

  const totalSec = noteHoldSec + releaseTailSec;
  const totalFrames = Math.max(1, Math.round(totalSec * outSampleRate));
  const outLeft = new Float32Array(totalFrames);
  const outRight = new Float32Array(totalFrames);

  const matched = instrument.regions.filter((r) => {
    if (midiNote < r.lowKey || midiNote > r.highKey) return false;
    if (velocity < r.lowVel || velocity > r.highVel) return false;
    if (
      r.keyswitchNote !== undefined &&
      options.activeKeyswitch !== undefined &&
      r.keyswitchNote !== options.activeKeyswitch
    ) {
      return false;
    }
    return true;
  });

  const attackCandidates = matched.filter(
    (r) => (r.trigger ?? 'attack') === 'attack' || r.trigger === 'first' || r.trigger === 'legato',
  );
  const releaseCandidates = includeReleaseTrigger
    ? matched.filter((r) => r.trigger === 'release')
    : [];

  const activeAttack = selectActiveRegionsDeterministic(attackCandidates, rrIndex);
  const activeRelease = selectActiveRegionsDeterministic(releaseCandidates, rrIndex);

  const decodedCache = new Map<string, DecodedWav | null>();
  const getDecoded = (sampleName: string): DecodedWav | null => {
    if (decodedCache.has(sampleName)) return decodedCache.get(sampleName)!;
    const raw = lookupSampleBuffer(instrument.audioPool, sampleName);
    if (!raw) {
      decodedCache.set(sampleName, null);
      return null;
    }
    try {
      const dec = decodeWav(raw);
      decodedCache.set(sampleName, dec);
      return dec;
    } catch {
      decodedCache.set(sampleName, null);
      return null;
    }
  };

  const activeRegionIds: string[] = [];

  for (const reg of activeAttack) {
    const dec = getDecoded(reg.sampleName);
    if (!dec) continue;
    activeRegionIds.push(reg.id);
    renderSingleRegionIntoMix(
      reg,
      dec,
      instrument,
      midiNote,
      velocity,
      0,
      noteHoldSec,
      outSampleRate,
      totalFrames,
      outLeft,
      outRight,
    );
  }

  for (const reg of activeRelease) {
    const dec = getDecoded(reg.sampleName);
    if (!dec) continue;
    activeRegionIds.push(reg.id);
    renderSingleRegionIntoMix(
      reg,
      dec,
      instrument,
      midiNote,
      velocity,
      noteHoldSec,
      releaseTailSec * 0.85,
      outSampleRate,
      totalFrames,
      outLeft,
      outRight,
    );
  }

  let peakLinear = 0;
  let sumSq = 0;
  for (let i = 0; i < totalFrames; i++) {
    const l = outLeft[i];
    const r = outRight[i];
    const aL = Math.abs(l);
    const aR = Math.abs(r);
    if (aL > peakLinear) peakLinear = aL;
    if (aR > peakLinear) peakLinear = aR;
    sumSq += 0.5 * (l * l + r * r);
  }
  const rmsLinear = Math.sqrt(sumSq / totalFrames);

  const wavBuffer = encodeWavPcm24([outLeft, outRight], outSampleRate, undefined, false);

  return {
    sampleRate: outSampleRate,
    numFrames: totalFrames,
    durationSec: totalFrames / outSampleRate,
    left: outLeft,
    right: outRight,
    wavBuffer,
    activeRegionIds,
    peakLinear,
    rmsLinear,
  };
}
