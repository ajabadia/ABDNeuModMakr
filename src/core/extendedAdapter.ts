// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Extended <-> Classic Adapter & Safe Sound Mapper
// Bridges Free Extended Creation Mode (N velocity layers, asymmetric
// 2D regions, crossfades, loops, DAHDSR, Filter, LFO) and Classic
// Hartmann MODELmaker v1.2 rules (contiguous 0..127 columns, 2 vel
// layers split at 64, single Volume per column, safe sound.script).
// ─────────────────────────────────────────────────────────

import type {
  Zone,
  ExtendedRegion,
  CommonPlaybackDefaults,
  SynthArticulationConfig,
  DahdsrEnvelope,
  RegionFilterConfig,
  RegionLfoConfig,
} from './types';

export function createDefaultCommonPlayback(): CommonPlaybackDefaults {
  return {
    loopMode: 'no_loop',
    pitchKeytrack: 100,
    trigger: 'attack',
    fadeCurve: 'equal-power',
  };
}

export function cloneCommonPlayback(cfg?: CommonPlaybackDefaults): CommonPlaybackDefaults {
  if (!cfg) return createDefaultCommonPlayback();
  return {
    loopMode: cfg.loopMode ?? 'no_loop',
    pitchKeytrack: typeof cfg.pitchKeytrack === 'number' ? Math.max(0, Math.min(100, Math.round(cfg.pitchKeytrack))) : 100,
    trigger: cfg.trigger ?? 'attack',
    fadeCurve: cfg.fadeCurve ?? 'equal-power',
  };
}

export interface ClassicProjectionResult {
  zones: Zone[];
  /**
   * Per-zone linear amplitude gain compensation for Low/High velocity layers.
   * Because classic `map.script` has only ONE `Volume` field per key column
   * (shared by Vel 1 and Vel 2), if `sampleLow` and `sampleHigh` came from
   * Extended regions with different `volume` (dB), the classic zone uses the
   * louder layer's dB as `zone.volume` and scales the quieter layer's
   * `.scape`/`.sphere` magnitudes by `10^(deltaDb / 20)`.
   */
  velocityLayerGainCompensation: Record<string, { lowGain: number; highGain: number }>;
}

export function createDefaultDahdsr(): DahdsrEnvelope {
  return {
    delaySec: 0,
    attackSec: 0.005,
    holdSec: 0,
    decaySec: 0.25,
    sustainLevel: 1.0,
    releaseSec: 0.2,
  };
}

export function createDefaultFilterConfig(): RegionFilterConfig {
  return {
    enabled: false,
    type: 'lpf',
    cutoffHz: 18000,
    resonanceDb: 0,
    envToFilterCents: 0,
    velToFilterCents: 0,
    keytrackCents: 0,
  };
}

export function createDefaultLfoConfig(): RegionLfoConfig {
  return {
    enabled: false,
    delaySec: 0,
    freqHz: 5.0,
    toPitchCents: 0,
    toFilterCents: 0,
    toVolumeDb: 0,
    waveform: 0,
  };
}

export function createDefaultArticulation(): SynthArticulationConfig {
  return {
    ampEnvEnabled: false,
    ampEnv: createDefaultDahdsr(),
    modEnvEnabled: false,
    modEnv: createDefaultDahdsr(),
    modEnvToPitchCents: 0,
    filter: createDefaultFilterConfig(),
    vibLfo: createDefaultLfoConfig(),
    modLfo: createDefaultLfoConfig(),
    bakeEnvelopeIntoWave: false,
  };
}

export function cloneArticulation(art?: SynthArticulationConfig): SynthArticulationConfig {
  if (!art) return createDefaultArticulation();
  return {
    ampEnvEnabled: Boolean(art.ampEnvEnabled),
    ampEnv: { ...art.ampEnv },
    modEnvEnabled: Boolean(art.modEnvEnabled),
    modEnv: { ...art.modEnv },
    modEnvToPitchCents: Number(art.modEnvToPitchCents) || 0,
    filter: { ...art.filter },
    vibLfo: { ...art.vibLfo },
    modLfo: { ...art.modLfo },
    bakeEnvelopeIntoWave: Boolean(art.bakeEnvelopeIntoWave),
  };
}

export function cloneExtendedRegion(r: ExtendedRegion): ExtendedRegion {
  return {
    ...r,
    ampEnvOverride: r.ampEnvOverride ? { ...r.ampEnvOverride } : undefined,
    filterOverride: r.filterOverride ? { ...r.filterOverride } : undefined,
  };
}

/**
 * Builds or synchronizes ExtendedRegion[] from classic Zone[].
 * Preserves existing extended attributes (loops, crossfades, keytrack, etc.)
 * when matching sampleName + key range is found.
 */
export function syncExtendedRegionsFromClassicZones(
  zones: Zone[],
  existing?: ExtendedRegion[],
): ExtendedRegion[] {
  const existingByKey = new Map<string, ExtendedRegion>();
  if (existing) {
    for (const reg of existing) {
      existingByKey.set(`${reg.sampleName}::${reg.lowKey}-${reg.highKey}::${reg.lowVel}-${reg.highVel}`, reg);
      existingByKey.set(`${reg.sampleName}::${reg.lowKey}-${reg.highKey}`, reg);
    }
  }

  const result: ExtendedRegion[] = [];
  let seq = 1;

  for (const z of zones) {
    const split = typeof z.velSplit === 'number' && z.velSplit >= 2 && z.velSplit <= 127 ? Math.round(z.velSplit) : 64;
    const hasHigh = Boolean(z.sampleHigh && z.sampleHigh.trim().length > 0);
    const lowSample = z.sampleLow || z.sampleHigh || '';
    const lowHighVel = hasHigh ? split - 1 : 127;

    if (lowSample) {
      const match =
        existingByKey.get(`${lowSample}::${z.lowKey}-${z.highKey}::1-${lowHighVel}`) ??
        existingByKey.get(`${lowSample}::${z.lowKey}-${z.highKey}`);
      result.push({
        id: match?.id ?? `ext-reg-${seq++}`,
        sampleName: lowSample,
        lowKey: z.lowKey,
        highKey: z.highKey,
        rootKey: z.rootKey,
        lowVel: 1,
        highVel: lowHighVel,
        detune: z.detune,
        volume: z.volume,
        pan: z.pan,
        pitchKeytrack: match?.pitchKeytrack ?? 100,
        trigger: match?.trigger ?? 'attack',
        seqPosition: match?.seqPosition,
        seqLength: match?.seqLength,
        keyFadeIn: match?.keyFadeIn ?? 0,
        keyFadeOut: match?.keyFadeOut ?? 0,
        velFadeIn: match?.velFadeIn ?? 0,
        velFadeOut: match?.velFadeOut ?? 0,
        fadeCurve: match?.fadeCurve ?? 'equal-power',
        loopMode: match?.loopMode ?? 'no_loop',
        loopStart: match?.loopStart ?? 0,
        loopEnd: match?.loopEnd ?? 0,
        loopCrossfadeMs: match?.loopCrossfadeMs ?? 0,
        sampleRate: match?.sampleRate,
        numChannels: match?.numChannels,
        hasPlaybackOverride: match?.hasPlaybackOverride,
        hasArticulationOverride: match?.hasArticulationOverride,
        ampEnvOverride: match?.ampEnvOverride ? { ...match.ampEnvOverride } : undefined,
        filterOverride: match?.filterOverride ? { ...match.filterOverride } : undefined,
      });
    }

    if (hasHigh && z.sampleHigh) {
      const highSample = z.sampleHigh;
      const match =
        existingByKey.get(`${highSample}::${z.lowKey}-${z.highKey}::${split}-127`) ??
        existingByKey.get(`${highSample}::${z.lowKey}-${z.highKey}`);
      result.push({
        id: match?.id ?? `ext-reg-${seq++}`,
        sampleName: highSample,
        lowKey: z.lowKey,
        highKey: z.highKey,
        rootKey: z.rootKey,
        lowVel: split,
        highVel: 127,
        detune: z.detune,
        volume: z.volume,
        pan: z.pan,
        pitchKeytrack: match?.pitchKeytrack ?? 100,
        trigger: match?.trigger ?? 'attack',
        seqPosition: match?.seqPosition,
        seqLength: match?.seqLength,
        keyFadeIn: match?.keyFadeIn ?? 0,
        keyFadeOut: match?.keyFadeOut ?? 0,
        velFadeIn: match?.velFadeIn ?? 0,
        velFadeOut: match?.velFadeOut ?? 0,
        fadeCurve: match?.fadeCurve ?? 'equal-power',
        loopMode: match?.loopMode ?? 'no_loop',
        loopStart: match?.loopStart ?? 0,
        loopEnd: match?.loopEnd ?? 0,
        loopCrossfadeMs: match?.loopCrossfadeMs ?? 0,
        sampleRate: match?.sampleRate,
        numChannels: match?.numChannels,
        hasPlaybackOverride: match?.hasPlaybackOverride,
        hasArticulationOverride: match?.hasArticulationOverride,
        ampEnvOverride: match?.ampEnvOverride ? { ...match.ampEnvOverride } : undefined,
        filterOverride: match?.filterOverride ? { ...match.filterOverride } : undefined,
      });
    }
  }

  if (result.length === 0) {
    result.push({
      id: 'ext-reg-1',
      sampleName: '',
      lowKey: 0,
      highKey: 127,
      rootKey: 60,
      lowVel: 1,
      highVel: 127,
      detune: 0,
      volume: 0,
      pan: 0,
      pitchKeytrack: 100,
      trigger: 'attack',
      keyFadeIn: 0,
      keyFadeOut: 0,
      velFadeIn: 0,
      velFadeOut: 0,
      fadeCurve: 'equal-power',
      loopMode: 'no_loop',
      loopStart: 0,
      loopEnd: 0,
      loopCrossfadeMs: 0,
    });
  }

  return result;
}

function clampInt(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(val)));
}

/**
 * Projects an arbitrary set of 2D ExtendedRegions onto canonical Hartmann
 * MODELmaker v1.2 Classic Zones:
 *   1. Full contiguous 0..127 key coverage with zero gaps and zero overlaps.
 *   2. Up to 2 velocity layers per column (Low: 1..63, High: 64..127).
 *   3. Single integer volume (-32..+12 dB), pan (-50..+50), detune (-99..+99)
 *      per column, plus linear amplitude gain compensation when Low and High
 *      velocity layers have different volumes.
 */
export function projectExtendedRegionsToClassicZones(
  regions: ExtendedRegion[],
  existingZones?: Zone[],
): ClassicProjectionResult {
  const valid = regions.filter((r) => r.sampleName && r.sampleName.trim().length > 0);
  if (valid.length === 0) {
    const fallbackId = existingZones?.[0]?.id ?? 'zone-1';
    const fallbackZone: Zone = {
      id: fallbackId,
      lowKey: 0,
      rootKey: existingZones?.[0]?.rootKey ?? 60,
      highKey: 127,
      sampleLow: null,
      sampleHigh: null,
      velSplit: 64,
      detune: existingZones?.[0]?.detune ?? 0,
      volume: existingZones?.[0]?.volume ?? 0,
      pan: existingZones?.[0]?.pan ?? 0,
    };
    return {
      zones: [fallbackZone],
      velocityLayerGainCompensation: { [fallbackId]: { lowGain: 1, highGain: 1 } },
    };
  }

  // Prefer attack/first regions over release-trigger noises when projecting to classic 2-layer grid
  const attackRegions = valid.filter((r) => r.trigger !== 'release');
  const pool = attackRegions.length > 0 ? attackRegions : valid;

  // Prefer round-robin seqPosition === 1 when multiple round-robin takes exist
  const primaryPool = pool.filter((r) => !r.seqPosition || r.seqPosition <= 1);
  const activePool = primaryPool.length > 0 ? primaryPool : pool;

  // Collect elementary key cut points across 0..127
  const cutPoints = new Set<number>([0, 128]);
  for (const r of activePool) {
    const lk = clampInt(r.lowKey, 0, 127);
    const hk = clampInt(r.highKey, 0, 127);
    cutPoints.add(lk);
    cutPoints.add(hk + 1);
  }
  const sortedCuts = Array.from(cutPoints).sort((a, b) => a - b);

  interface RawSlice {
    lowKey: number;
    highKey: number;
    lowReg: ExtendedRegion | null;
    highReg: ExtendedRegion | null;
  }

  const pickBestRegionForBand = (
    candidates: ExtendedRegion[],
    bandLowVel: number,
    bandHighVel: number,
    midKey: number,
  ): ExtendedRegion | null => {
    if (candidates.length === 0) return null;
    let best: ExtendedRegion | null = null;
    let bestScore = -Infinity;
    for (const c of candidates) {
      const overlapLow = Math.max(bandLowVel, clampInt(c.lowVel, 1, 127));
      const overlapHigh = Math.min(bandHighVel, clampInt(c.highVel, 1, 127));
      const velOverlap = Math.max(0, overlapHigh - overlapLow + 1);
      const keyDist = Math.abs(midKey - c.rootKey);
      // Score prioritizes velocity overlap in the band, then proximity to rootKey
      const score = velOverlap * 1000 - keyDist;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  };

  const slices: RawSlice[] = [];
  for (let i = 0; i < sortedCuts.length - 1; i++) {
    const lowKey = sortedCuts[i];
    const highKey = sortedCuts[i + 1] - 1;
    if (lowKey > highKey) continue;
    const midKey = (lowKey + highKey) * 0.5;
    const covering = activePool.filter(
      (r) => clampInt(r.lowKey, 0, 127) <= lowKey && clampInt(r.highKey, 0, 127) >= highKey,
    );
    const lowReg = pickBestRegionForBand(covering, 1, 63, midKey);
    const highReg = pickBestRegionForBand(covering, 64, 127, midKey);
    slices.push({
      lowKey,
      highKey,
      lowReg: lowReg ?? highReg,
      highReg: highReg ?? lowReg,
    });
  }

  // Fill empty gap slices from the nearest populated slice so 0..127 has zero unmapped keys
  for (let i = 0; i < slices.length; i++) {
    if (!slices[i].lowReg) {
      // Search left or right for nearest populated slice
      let donor: RawSlice | null = null;
      let bestDist = Infinity;
      const centerI = (slices[i].lowKey + slices[i].highKey) * 0.5;
      for (let j = 0; j < slices.length; j++) {
        if (slices[j].lowReg) {
          const centerJ = (slices[j].lowKey + slices[j].highKey) * 0.5;
          const dist = Math.abs(centerI - centerJ);
          if (dist < bestDist) {
            bestDist = dist;
            donor = slices[j];
          }
        }
      }
      if (donor) {
        slices[i].lowReg = donor.lowReg;
        slices[i].highReg = donor.highReg;
      }
    }
  }

  // Merge adjacent slices that resolved to the exact same (lowReg, highReg) pair
  const mergedSlices: RawSlice[] = [];
  for (const s of slices) {
    const prev = mergedSlices[mergedSlices.length - 1];
    if (
      prev &&
      prev.lowReg?.sampleName === s.lowReg?.sampleName &&
      prev.highReg?.sampleName === s.highReg?.sampleName &&
      prev.lowReg?.rootKey === s.lowReg?.rootKey &&
      prev.lowReg?.detune === s.lowReg?.detune &&
      prev.lowReg?.volume === s.lowReg?.volume &&
      prev.highReg?.volume === s.highReg?.volume &&
      prev.lowReg?.pan === s.lowReg?.pan
    ) {
      prev.highKey = s.highKey;
    } else {
      mergedSlices.push({ ...s });
    }
  }

  const zones: Zone[] = [];
  const velocityLayerGainCompensation: Record<string, { lowGain: number; highGain: number }> = {};

  mergedSlices.forEach((s, idx) => {
    const zoneId = existingZones?.[idx]?.id ?? `zone-${idx + 1}`;
    const primary = s.lowReg ?? s.highReg!;
    const secondary = s.highReg ?? primary;
    const sameSample = primary.sampleName === secondary.sampleName;

    const lowVolDb = clampInt(primary.volume, -32, 12);
    const highVolDb = clampInt(secondary.volume, -32, 12);
    const columnVolDb = sameSample ? lowVolDb : Math.max(lowVolDb, highVolDb);

    // Compute linear gain compensation for the quieter velocity layer
    const lowDeltaDb = lowVolDb - columnVolDb;
    const highDeltaDb = highVolDb - columnVolDb;
    const lowGain = lowDeltaDb === 0 ? 1.0 : Math.pow(10, lowDeltaDb / 20);
    const highGain = highDeltaDb === 0 ? 1.0 : Math.pow(10, highDeltaDb / 20);

    velocityLayerGainCompensation[zoneId] = { lowGain, highGain };

    // Determine split velocity if primary and secondary are distinct velocity layers
    let velSplit = 64;
    if (!sameSample && secondary.lowVel >= 2 && secondary.lowVel <= 127) {
      velSplit = clampInt(secondary.lowVel, 2, 127);
    }

    const rootKey = clampInt(primary.rootKey, s.lowKey, s.highKey);

    zones.push({
      id: zoneId,
      lowKey: s.lowKey,
      rootKey,
      highKey: s.highKey,
      sampleLow: primary.sampleName,
      sampleHigh: sameSample ? null : secondary.sampleName,
      velSplit,
      detune: clampInt(primary.detune, -99, 99),
      volume: columnVolDb,
      pan: clampInt(primary.pan, -50, 50),
    });
  });

  return { zones, velocityLayerGainCompensation };
}

// ─────────────────────────────────────────────────────────
// Safe Mapping of Articulation (ADSR, Filter, LFO) -> sound.script
// ─────────────────────────────────────────────────────────

/** Maps time in seconds (0..10s) to Neuron envelope parameter 0..127 (logarithmic feel) */
export function secondsToNeuronEnvStage(sec: number): number {
  if (!Number.isFinite(sec) || sec <= 0.002) return 0;
  const clamped = Math.min(12.0, Math.max(0.002, sec));
  // Logarithmic mapping: 0.002s -> 0, ~0.2s -> 64, 12s -> 127
  const norm = Math.log(clamped / 0.002) / Math.log(12.0 / 0.002);
  return clampInt(norm * 127, 0, 127);
}

/** Maps frequency in Hz (20..20000 Hz) to Neuron FilterFreq 0..127 (logarithmic pitch scale) */
export function hzToNeuronFilterCutoff(hz: number): number {
  if (!Number.isFinite(hz)) return 127;
  const clamped = Math.min(20000, Math.max(20, hz));
  const norm = Math.log(clamped / 20) / Math.log(20000 / 20);
  return clampInt(norm * 127, 0, 127);
}

/**
 * Generates a safe dictionary of `sound.script` parameter overrides from
 * `SynthArticulationConfig`.
 *
 * SAFETY GUARANTEE:
 * - Only modifies parameters for sections explicitly enabled (`ampEnvEnabled`,
 *   `filter.enabled`, `vibLfo.enabled`, `modLfo.enabled`).
 * - Explicitly zeroes out all LFO/Env depths to `Scape`, `Sphere`, and `Blender`
 *   so imported SoundFont/SFZ modulations NEVER cause unwanted spectral morphing.
 */
export function mapArticulationToSoundOverrides(
  articulation?: SynthArticulationConfig,
): Record<string, number> {
  if (!articulation) return {};
  const overrides: Record<string, number> = {};

  // 1. Amplitude ADSR -> Resynator 1 Amp Shaper
  if (articulation.ampEnvEnabled) {
    const env = articulation.ampEnv;
    overrides.Shaper12Status = 1;
    overrides.R1AmpEnvMode = 0;
    overrides.R1AmpEnvA = secondsToNeuronEnvStage(env.delaySec + env.attackSec);
    overrides.R1AmpEnvD = secondsToNeuronEnvStage(env.holdSec + env.decaySec);
    overrides.R1AmpEnvS = clampInt((Number.isFinite(env.sustainLevel) ? env.sustainLevel : 1) * 127, 0, 127);
    overrides.R1AmpEnvR = secondsToNeuronEnvStage(env.releaseSec);
  }

  // 2. Filter + ModEnv -> Silver Filter section
  if (articulation.filter.enabled) {
    const flt = articulation.filter;
    overrides.SilverSwitch = 1;
    overrides.Shaper3Status = 1;
    overrides.FilterType = flt.type === 'hpf' ? 2 : flt.type === 'bpf' ? 1 : 0;
    overrides.FilterFreq = hzToNeuronFilterCutoff(flt.cutoffHz);
    overrides.FilterReso = clampInt((Math.max(0, Math.min(40, flt.resonanceDb)) / 40) * 127, 0, 127);
    overrides.FilterKeyTrack = clampInt((Math.max(-1200, Math.min(1200, flt.keytrackCents)) / 1200) * 63, -64, 63);
    overrides.FilterCutoffVelocityDepth = clampInt(
      (Math.max(-12000, Math.min(12000, flt.velToFilterCents)) / 12000) * 63,
      -64,
      63,
    );

    if (articulation.modEnvEnabled && Math.abs(flt.envToFilterCents) > 1) {
      const mEnv = articulation.modEnv;
      overrides.FilterEnvMode = 0;
      overrides.FilterEnvA = secondsToNeuronEnvStage(mEnv.delaySec + mEnv.attackSec);
      overrides.FilterEnvD = secondsToNeuronEnvStage(mEnv.holdSec + mEnv.decaySec);
      overrides.FilterEnvS = clampInt((Number.isFinite(mEnv.sustainLevel) ? mEnv.sustainLevel : 1) * 127, 0, 127);
      overrides.FilterEnvR = secondsToNeuronEnvStage(mEnv.releaseSec);
      overrides.FilterEnvDepth = clampInt((flt.envToFilterCents / 12000) * 63, -64, 63);
    } else {
      overrides.FilterEnvDepth = 0;
    }

    // Zero Scape/Sphere envelope depths so envelopes never cause unintended spectral morphing
    overrides.R1L1Scape1EnvDepth = 0;
    overrides.R1L1Scape2EnvDepth = 0;
    overrides.R1L1Sphere1EnvDepth = 0;
    overrides.R1L1Sphere2EnvDepth = 0;
    overrides.R1L2Scape1EnvDepth = 0;
    overrides.R1L2Scape2EnvDepth = 0;
    overrides.R1L2Sphere1EnvDepth = 0;
    overrides.R1L2Sphere2EnvDepth = 0;
    overrides.R1L3Scape1EnvDepth = 0;
    overrides.R1L3Scape2EnvDepth = 0;
    overrides.R1L3Sphere1EnvDepth = 0;
    overrides.R1L3Sphere2EnvDepth = 0;
  }

  // 3. LFO (Vibrato LFO / Mod LFO) -> Global Neuron LFO with strictly isolated destination depths
  const activeLfo =
    articulation.vibLfo.enabled
      ? articulation.vibLfo
      : articulation.modLfo.enabled
        ? articulation.modLfo
        : null;

  if (activeLfo) {
    overrides.LFOSwitch = 1;
    overrides.LFODepth = 127;
    overrides.LFOWaveForm = clampInt(activeLfo.waveform ?? 0, 0, 11);
    // Map 0.05..30 Hz -> 0..1000
    const normRate = Math.min(1, Math.max(0, activeLfo.freqHz / 20));
    overrides.LFORate = clampInt(normRate * 1000, 0, 1000);
    // Map 0..5s delay -> -64..63
    const normDelay = Math.min(1, Math.max(0, activeLfo.delaySec / 5));
    overrides.LFODelay = clampInt(-64 + normDelay * 127, -64, 63);

    // Combine pitch/filter/amp depths from enabled LFOs
    const pitchCents =
      (articulation.vibLfo.enabled ? articulation.vibLfo.toPitchCents : 0) +
      (articulation.modLfo.enabled ? articulation.modLfo.toPitchCents : 0);
    const filterCents =
      (articulation.vibLfo.enabled ? articulation.vibLfo.toFilterCents : 0) +
      (articulation.modLfo.enabled ? articulation.modLfo.toFilterCents : 0);
    const volDb =
      (articulation.vibLfo.enabled ? articulation.vibLfo.toVolumeDb : 0) +
      (articulation.modLfo.enabled ? articulation.modLfo.toVolumeDb : 0);

    overrides.R1PitchLfoDepth = clampInt((pitchCents / 200) * 63, -64, 63);
    overrides.FilterLfoDepth = clampInt((filterCents / 3600) * 63, -64, 63);
    overrides.R1AmpLfoDepth = clampInt((volDb / 12) * 63, -64, 63);

    // CRITICAL SAFETY: Explicitly zero all Scape, Sphere, and Blender LFO modulation depths
    overrides.R1L1Sphere1LfoDepth = 0;
    overrides.R1L1Sphere2LfoDepth = 0;
    overrides.R1L1Scape1LfoDepth = 0;
    overrides.R1L1Scape2LfoDepth = 0;
    overrides.R1L2Sphere1LfoDepth = 0;
    overrides.R1L2Sphere2LfoDepth = 0;
    overrides.R1L2Scape1LfoDepth = 0;
    overrides.R1L2Scape2LfoDepth = 0;
    overrides.R1L3Sphere1LfoDepth = 0;
    overrides.R1L3Sphere2LfoDepth = 0;
    overrides.R1L3Scape1LfoDepth = 0;
    overrides.R1L3Scape2LfoDepth = 0;
    overrides.R2PitchLfoDepth = 0;
    overrides.R2AmpLfoDepth = 0;
    overrides.BlenderLfoDepth = 0;
    overrides.BlenderFreeADSR1Depth = 0;
    overrides.BlenderFreeADSR2Depth = 0;
    overrides.BlenderFree4L4TDepth = 0;
  }

  return overrides;
}

// ─────────────────────────────────────────────────────────
// Smart Next-Range Calculation & 2D Overlap / Intersection Detection
// ─────────────────────────────────────────────────────────

export interface NextExtendedRangeSuggestion {
  lowKey: number;
  highKey: number;
  rootKey: number;
  lowVel: number;
  highVel: number;
  /** When splitting an existing multi-key region to make room, the donor region ID and its new highKey */
  splitDonorId?: string;
  splitDonorNewHighKey?: number;
}

/**
 * Computes the next logical available Key/Velocity range for a new ExtendedRegion
 * so creating a new region never silently duplicates the selected region on top of itself:
 * 1. If any MIDI keys in `0..127` are uncovered (gap), picks the first gap after `anchorRegion` (or from `0`).
 * 2. Else if `anchorRegion` covers only a partial velocity range (`1..63` etc.) and the complementary
 *    velocity range on `[anchorRegion.lowKey..anchorRegion.highKey]` is free, assigns that complementary velocity band.
 * 3. Else if `anchorRegion` spans multiple keys (`highKey > lowKey`), splits `anchorRegion` at its root/midpoint.
 * 4. Else finds the nearest multi-key region to split, or advances to the next key in `0..127`.
 */
export function computeNextAvailableExtendedRange(
  regions: ExtendedRegion[],
  anchorRegion?: ExtendedRegion | null,
): NextExtendedRangeSuggestion {
  if (regions.length === 0) {
    return { lowKey: 0, highKey: 127, rootKey: 60, lowVel: 1, highVel: 127 };
  }

  const anchor = anchorRegion ?? regions[regions.length - 1];

  // 1. Check for uncovered MIDI key gaps in 0..127
  const keyCovered = new Uint8Array(128);
  for (const r of regions) {
    const lk = clampInt(r.lowKey, 0, 127);
    const hk = clampInt(r.highKey, 0, 127);
    for (let k = lk; k <= hk; k++) {
      keyCovered[k] = 1;
    }
  }

  const gaps: Array<{ lowKey: number; highKey: number }> = [];
  let gStart = -1;
  for (let k = 0; k < 128; k++) {
    if (!keyCovered[k]) {
      if (gStart < 0) gStart = k;
    } else if (gStart >= 0) {
      gaps.push({ lowKey: gStart, highKey: k - 1 });
      gStart = -1;
    }
  }
  if (gStart >= 0) {
    gaps.push({ lowKey: gStart, highKey: 127 });
  }

  if (gaps.length > 0) {
    const afterAnchor = gaps.find((g) => g.lowKey > anchor.highKey) ?? gaps[0];
    const rootKey = Math.round((afterAnchor.lowKey + afterAnchor.highKey) * 0.5);
    return {
      lowKey: afterAnchor.lowKey,
      highKey: afterAnchor.highKey,
      rootKey,
      lowVel: 1,
      highVel: 127,
    };
  }

  // 2. Check if anchor has an uncovered velocity range on its key span [anchor.lowKey..anchor.highKey]
  if (anchor.lowVel > 1 || anchor.highVel < 127) {
    const velCovered = new Uint8Array(128); // 1..127
    for (const r of regions) {
      if (r.lowKey <= anchor.highKey && r.highKey >= anchor.lowKey) {
        const lv = clampInt(r.lowVel, 1, 127);
        const hv = clampInt(r.highVel, 1, 127);
        for (let v = lv; v <= hv; v++) {
          velCovered[v] = 1;
        }
      }
    }
    let bestVStart = -1;
    let bestVEnd = -1;
    let curStart = -1;
    for (let v = 1; v <= 127; v++) {
      if (!velCovered[v]) {
        if (curStart < 0) curStart = v;
      } else if (curStart >= 0) {
        if (v - 1 - curStart > bestVEnd - bestVStart) {
          bestVStart = curStart;
          bestVEnd = v - 1;
        }
        curStart = -1;
      }
    }
    if (curStart >= 0 && 127 - curStart > bestVEnd - bestVStart) {
      bestVStart = curStart;
      bestVEnd = 127;
    }
    if (bestVStart >= 1 && bestVEnd >= bestVStart) {
      return {
        lowKey: anchor.lowKey,
        highKey: anchor.highKey,
        rootKey: anchor.rootKey,
        lowVel: bestVStart,
        highVel: bestVEnd,
      };
    }
  }

  // 3. If anchor spans multiple keys (highKey > lowKey), split anchor
  if (anchor.highKey > anchor.lowKey) {
    const splitPoint =
      anchor.rootKey > anchor.lowKey && anchor.rootKey <= anchor.highKey
        ? anchor.rootKey
        : Math.ceil((anchor.lowKey + anchor.highKey) * 0.5);
    const rootKey = Math.round((splitPoint + anchor.highKey) * 0.5);
    return {
      lowKey: splitPoint,
      highKey: anchor.highKey,
      rootKey,
      lowVel: anchor.lowVel,
      highVel: anchor.highVel,
      splitDonorId: anchor.id,
      splitDonorNewHighKey: splitPoint - 1,
    };
  }

  // 4. Anchor is a single key: find the nearest multi-key region (preferring after anchor) to split
  const multiKeyAfter = regions.find((r) => r.lowKey > anchor.highKey && r.highKey > r.lowKey);
  const multiKeyAny = multiKeyAfter ?? regions.find((r) => r.highKey > r.lowKey);
  if (multiKeyAny) {
    // Carve out the first key of multiKeyAfter (right after anchor), or split multiKeyAny
    if (multiKeyAfter && multiKeyAfter.lowKey === anchor.highKey + 1) {
      const carvedKey = multiKeyAfter.lowKey;
      return {
        lowKey: carvedKey,
        highKey: carvedKey,
        rootKey: carvedKey,
        lowVel: 1,
        highVel: 127,
        splitDonorId: multiKeyAfter.id,
        splitDonorNewHighKey: -1, // signals advancing donor's lowKey to carvedKey + 1
      };
    }
    const splitPoint = Math.ceil((multiKeyAny.lowKey + multiKeyAny.highKey) * 0.5);
    return {
      lowKey: splitPoint,
      highKey: multiKeyAny.highKey,
      rootKey: Math.round((splitPoint + multiKeyAny.highKey) * 0.5),
      lowVel: multiKeyAny.lowVel,
      highVel: multiKeyAny.highVel,
      splitDonorId: multiKeyAny.id,
      splitDonorNewHighKey: splitPoint - 1,
    };
  }

  // Fallback if all 128 keys are already single-key regions: advance key (or Complementary Vel)
  const nextKey = anchor.highKey < 127 ? anchor.highKey + 1 : 0;
  return {
    lowKey: nextKey,
    highKey: nextKey,
    rootKey: nextKey,
    lowVel: 1,
    highVel: 127,
  };
}

export interface RegionOverlapPeer {
  id: string;
  index: number; // 1-based region number (#1, #2...)
  sampleName: string;
  lowKey: number;
  highKey: number;
  lowVel: number;
  highVel: number;
  overlapLowKey: number;
  overlapHighKey: number;
  overlapLowVel: number;
  overlapHighVel: number;
}

export interface RegionOverlapInfo {
  regionId: string;
  regionIndex: number; // 1-based
  /** Peers that overlap in BOTH Key range AND Velocity range (true 2D intersection) */
  fullIntersections: RegionOverlapPeer[];
  /** Peers that overlap in Key range ONLY (clean velocity split / layering) */
  keyOnlyOverlaps: RegionOverlapPeer[];
}

export interface KeyVelocityIntersectionBox {
  lowKey: number;
  highKey: number;
  lowVel: number;
  highVel: number;
  regionIds: string[];
  regionIndices: number[]; // 1-based
}

export interface ExtendedIntersectionReport {
  byRegionId: Record<string, RegionOverlapInfo>;
  intersectionBoxes: KeyVelocityIntersectionBox[];
  /** 1D MIDI key intervals [lowKey..highKey] where >= 2 regions intersect in 2D (Key & Vel) */
  intersectingKeySpans: Array<{ lowKey: number; highKey: number; regionIndices: number[] }>;
  totalIntersectingPairs: number;
}

/**
 * Analyzes all pairs of ExtendedRegions to detect:
 * - True 2D intersections (both Key and Velocity ranges overlap)
 * - Key-only overlaps (shared Key range with separate Velocity ranges)
 * - Exact 2D boxes and 1D key spans for coloring intersections in ZoneRibbon above the keyboard
 */
export function analyzeExtendedIntersections(
  regions: ExtendedRegion[],
): ExtendedIntersectionReport {
  const byRegionId: Record<string, RegionOverlapInfo> = {};
  regions.forEach((r, i) => {
    byRegionId[r.id] = {
      regionId: r.id,
      regionIndex: i + 1,
      fullIntersections: [],
      keyOnlyOverlaps: [],
    };
  });

  const intersectionBoxes: KeyVelocityIntersectionBox[] = [];
  let totalIntersectingPairs = 0;

  for (let i = 0; i < regions.length; i++) {
    const a = regions[i];
    for (let j = i + 1; j < regions.length; j++) {
      const b = regions[j];
      const ovLowKey = Math.max(a.lowKey, b.lowKey);
      const ovHighKey = Math.min(a.highKey, b.highKey);
      if (ovLowKey > ovHighKey) continue; // No key overlap

      const ovLowVel = Math.max(a.lowVel, b.lowVel);
      const ovHighVel = Math.min(a.highVel, b.highVel);
      const hasVelOverlap = ovLowVel <= ovHighVel;

      const peerBForA: RegionOverlapPeer = {
        id: b.id,
        index: j + 1,
        sampleName: b.sampleName,
        lowKey: b.lowKey,
        highKey: b.highKey,
        lowVel: b.lowVel,
        highVel: b.highVel,
        overlapLowKey: ovLowKey,
        overlapHighKey: ovHighKey,
        overlapLowVel: hasVelOverlap ? ovLowVel : 0,
        overlapHighVel: hasVelOverlap ? ovHighVel : 0,
      };
      const peerAForB: RegionOverlapPeer = {
        id: a.id,
        index: i + 1,
        sampleName: a.sampleName,
        lowKey: a.lowKey,
        highKey: a.highKey,
        lowVel: a.lowVel,
        highVel: a.highVel,
        overlapLowKey: ovLowKey,
        overlapHighKey: ovHighKey,
        overlapLowVel: hasVelOverlap ? ovLowVel : 0,
        overlapHighVel: hasVelOverlap ? ovHighVel : 0,
      };

      if (hasVelOverlap) {
        totalIntersectingPairs++;
        byRegionId[a.id].fullIntersections.push(peerBForA);
        byRegionId[b.id].fullIntersections.push(peerAForB);
        intersectionBoxes.push({
          lowKey: ovLowKey,
          highKey: ovHighKey,
          lowVel: ovLowVel,
          highVel: ovHighVel,
          regionIds: [a.id, b.id],
          regionIndices: [i + 1, j + 1],
        });
      } else {
        byRegionId[a.id].keyOnlyOverlaps.push(peerBForA);
        byRegionId[b.id].keyOnlyOverlaps.push(peerAForB);
      }
    }
  }

  // Build merged 1D key spans where >= 2 regions have a 2D intersection
  const keyMap: Array<Set<number>> = Array.from({ length: 128 }, () => new Set<number>());
  for (const box of intersectionBoxes) {
    for (let k = clampInt(box.lowKey, 0, 127); k <= clampInt(box.highKey, 0, 127); k++) {
      for (const idx of box.regionIndices) {
        keyMap[k].add(idx);
      }
    }
  }

  const intersectingKeySpans: Array<{ lowKey: number; highKey: number; regionIndices: number[] }> = [];
  let curLow = -1;
  let curSig = '';
  let curIndices: number[] = [];

  for (let k = 0; k < 128; k++) {
    const indices = Array.from(keyMap[k]).sort((x, y) => x - y);
    const sig = indices.join(',');
    if (indices.length > 0) {
      if (curLow < 0) {
        curLow = k;
        curSig = sig;
        curIndices = indices;
      } else if (sig !== curSig) {
        intersectingKeySpans.push({ lowKey: curLow, highKey: k - 1, regionIndices: curIndices });
        curLow = k;
        curSig = sig;
        curIndices = indices;
      }
    } else if (curLow >= 0) {
      intersectingKeySpans.push({ lowKey: curLow, highKey: k - 1, regionIndices: curIndices });
      curLow = -1;
      curSig = '';
      curIndices = [];
    }
  }
  if (curLow >= 0) {
    intersectingKeySpans.push({ lowKey: curLow, highKey: 127, regionIndices: curIndices });
  }

  return {
    byRegionId,
    intersectionBoxes,
    intersectingKeySpans,
    totalIntersectingPairs,
  };
}

export interface ClassicZoneOverlapInfo {
  zoneId: string;
  zoneIndex: number; // 1-based
  overlappingZones: Array<{ id: string; index: number; overlapLowKey: number; overlapHighKey: number }>;
}

export function analyzeClassicZoneOverlaps(
  zones: Zone[],
): Record<string, ClassicZoneOverlapInfo> {
  const result: Record<string, ClassicZoneOverlapInfo> = {};
  zones.forEach((z, idx) => {
    result[z.id] = { zoneId: z.id, zoneIndex: idx + 1, overlappingZones: [] };
  });
  for (let i = 0; i < zones.length; i++) {
    const a = zones[i];
    for (let j = i + 1; j < zones.length; j++) {
      const b = zones[j];
      const ovLow = Math.max(a.lowKey, b.lowKey);
      const ovHigh = Math.min(a.highKey, b.highKey);
      if (ovLow <= ovHigh) {
        result[a.id].overlappingZones.push({ id: b.id, index: j + 1, overlapLowKey: ovLow, overlapHighKey: ovHigh });
        result[b.id].overlappingZones.push({ id: a.id, index: i + 1, overlapLowKey: ovLow, overlapHighKey: ovHigh });
      }
    }
  }
  return result;
}
