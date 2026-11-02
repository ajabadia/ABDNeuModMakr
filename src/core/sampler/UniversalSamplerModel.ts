// ─────────────────────────────────────────────────────────
// ABDNeuModMakr & @abdsynths/shared — Universal Sampler Model & Format Capabilities (Fase 33.1 / 33.2)
//
// Bridges ConvertWithMoss-grade hierarchical multisample capabilities
// (IMultisampleSource, IGroup, ISampleZone, ISampleLoop, IFilter,
// IEnvelopeModulator, IPitchModulator) with:
//   - ABDNeuModMakr Session / ExtendedRegion / SynthArticulationConfig
//   - ABDShared Common Data Dictionary v2.0 (sampler_voice_parameter_spec.json + MidiTranslationEngine)
// ─────────────────────────────────────────────────────────

import type {
  DahdsrEnvelope,
  ExtendedModelMetadata,
  ExtendedRegion,
  FilterSlopePoles,
  MidiNote,
  PitchEnvelopeConfig,
  RegionFilterConfig,
  SampleLoopDescriptor,
  SamplerPlayLogic,
  Session,
  SynthArticulationConfig,
  TriggerMode,
} from '../types.ts';
import {
  cloneArticulation,
  cloneExtendedRegion,
  createDefaultArticulation,
  syncExtendedRegionsFromClassicZones,
} from '../extendedAdapter.ts';
import {
  MidiTranslationEngine,
  type ParameterDictionarySpec,
} from '../../../vendor/@abdsynths/shared/Contracts/MidiTranslationEngine.ts';
import samplerSpecJson from '../../../vendor/@abdsynths/shared/Contracts/sampler_voice_parameter_spec.json' with { type: 'json' };

export const SAMPLER_VOICE_DICTIONARY: ParameterDictionarySpec =
  samplerSpecJson as unknown as ParameterDictionarySpec;

const samplerEngine = new MidiTranslationEngine(SAMPLER_VOICE_DICTIONARY);

/**
 * Tier 2 — Modulation route compatible with ABDShared/Contracts/modulation_matrix.schema.json
 */
export interface UniversalSamplerModRoute {
  slot: number;
  source:
    | 'velocity'
    | 'keytrack'
    | 'mod_wheel'
    | 'aftertouch'
    | 'pitch_bend'
    | 'lfo1'
    | 'lfo2'
    | 'mod_env'
    | 'pitch_env'
    | 'mpce_x'
    | 'mpce_y';
  destination:
    | 'pitch_cents'
    | 'filter_cutoff_cents'
    | 'filter_resonance'
    | 'volume_db'
    | 'pan'
    | 'sample_start'
    | 'loop_start';
  amount: number;
  bipolar: boolean;
  perVoice: boolean;
}

/**
 * Tier 3 — Group / Keygroup / Articulation Group (ConvertWithMoss IGroup)
 */
export interface UniversalSamplerGroup {
  id: string;
  name: string;
  muteGroup: number;           // 0 = none, 1..32 = choke group
  keyswitchNote?: MidiNote;    // Optional keyswitch trigger note
  polyphony?: number;          // Group voice limit (1..64)
  playLogic: SamplerPlayLogic; // 'always' | 'round_robin' | 'random' | 'velocity'
  trigger: TriggerMode;        // 'attack' | 'release' | 'first' | 'legato'
  volumeDb: number;
  pan: number;                 // -50..+50
  tuneCents: number;
  ampEnv?: Partial<DahdsrEnvelope>;
  filter?: Partial<RegionFilterConfig>;
  pitchEnv?: Partial<PitchEnvelopeConfig>;
}

/**
 * Tier 3 — Canonical Hierarchical Multisample Instrument
 */
export interface UniversalSamplerInstrument {
  id: string;
  name: string;
  expandedName?: string;
  metadata: ExtendedModelMetadata;
  articulation: SynthArticulationConfig;
  groups: UniversalSamplerGroup[];
  regions: ExtendedRegion[];
  modMatrix: UniversalSamplerModRoute[];
  /** Physical domain parameter dictionary keyed by sampler_voice_parameter_spec.json IDs */
  parameters: Record<string, number>;
  /** Optional raw audio buffer map keyed by sampleName */
  audioPool?: Map<string, ArrayBuffer>;
}

/**
 * Declarative Format Capabilities Matrix (Fase 33.2)
 */
export interface FormatCapabilities {
  formatId: string;
  title: string;
  canRead: boolean;
  canWrite: boolean;
  maxVelocityLayersPerKey: number | 'unlimited';
  maxLoopsPerZone: number;
  supportsPingPongLoop: boolean;
  supportsReversePlayback: boolean;
  supportsSampleStartEndOffsets: boolean;
  supportsRoundRobin: boolean;
  supportsReleaseTrigger: boolean;
  supportsNoteCrossfade: boolean;
  supportsVelocityCrossfade: boolean;
  supportsFilter: boolean;
  supportedFilterPoles: FilterSlopePoles[];
  supportsPitchEnvelope: boolean;
  supportsMuteGroups: boolean;
  supportsKeyswitches: boolean;
}

export const FORMAT_CAPABILITIES_REGISTRY: Record<string, FormatCapabilities> = {
  'legacy-neuron': {
    formatId: 'legacy-neuron',
    title: 'Hartmann Neuron Classic (.model)',
    canRead: true,
    canWrite: true,
    maxVelocityLayersPerKey: 2,
    maxLoopsPerZone: 1,
    supportsPingPongLoop: false,
    supportsReversePlayback: false,
    supportsSampleStartEndOffsets: false,
    supportsRoundRobin: false,
    supportsReleaseTrigger: false,
    supportsNoteCrossfade: false,
    supportsVelocityCrossfade: false,
    supportsFilter: true,
    supportedFilterPoles: [1, 2, 4],
    supportsPitchEnvelope: true,
    supportsMuteGroups: false,
    supportsKeyswitches: false,
  },
  'modern-neural': {
    formatId: 'modern-neural',
    title: 'ABDSynths Extended Time Capsule (.neuronikmodel)',
    canRead: true,
    canWrite: true,
    maxVelocityLayersPerKey: 'unlimited',
    maxLoopsPerZone: 8,
    supportsPingPongLoop: true,
    supportsReversePlayback: true,
    supportsSampleStartEndOffsets: true,
    supportsRoundRobin: true,
    supportsReleaseTrigger: true,
    supportsNoteCrossfade: true,
    supportsVelocityCrossfade: true,
    supportsFilter: true,
    supportedFilterPoles: [1, 2, 3, 4, 6, 8],
    supportsPitchEnvelope: true,
    supportsMuteGroups: true,
    supportsKeyswitches: true,
  },
  sf2: {
    formatId: 'sf2',
    title: 'SoundFont 2.04 (.sf2)',
    canRead: true,
    canWrite: true,
    maxVelocityLayersPerKey: 'unlimited',
    maxLoopsPerZone: 1,
    supportsPingPongLoop: false,
    supportsReversePlayback: false,
    supportsSampleStartEndOffsets: true,
    supportsRoundRobin: false,
    supportsReleaseTrigger: false,
    supportsNoteCrossfade: false,
    supportsVelocityCrossfade: false,
    supportsFilter: true,
    supportedFilterPoles: [2, 4],
    supportsPitchEnvelope: true,
    supportsMuteGroups: true,
    supportsKeyswitches: false,
  },
  sfz: {
    formatId: 'sfz',
    title: 'SFZ v1/v2 (.sfz)',
    canRead: true,
    canWrite: true,
    maxVelocityLayersPerKey: 'unlimited',
    maxLoopsPerZone: 1,
    supportsPingPongLoop: true,
    supportsReversePlayback: true,
    supportsSampleStartEndOffsets: true,
    supportsRoundRobin: true,
    supportsReleaseTrigger: true,
    supportsNoteCrossfade: true,
    supportsVelocityCrossfade: true,
    supportsFilter: true,
    supportedFilterPoles: [1, 2, 4, 6],
    supportsPitchEnvelope: true,
    supportsMuteGroups: true,
    supportsKeyswitches: true,
  },
  dspreset: {
    formatId: 'dspreset',
    title: 'Decent Sampler (.dspreset)',
    canRead: true,
    canWrite: true,
    maxVelocityLayersPerKey: 'unlimited',
    maxLoopsPerZone: 1,
    supportsPingPongLoop: false,
    supportsReversePlayback: false,
    supportsSampleStartEndOffsets: true,
    supportsRoundRobin: true,
    supportsReleaseTrigger: true,
    supportsNoteCrossfade: true,
    supportsVelocityCrossfade: true,
    supportsFilter: true,
    supportedFilterPoles: [2, 4],
    supportsPitchEnvelope: false,
    supportsMuteGroups: true,
    supportsKeyswitches: true,
  },
  mpc_xpm: {
    formatId: 'mpc_xpm',
    title: 'Akai MPC Keygroup/Drum (.xpm)',
    canRead: true,
    canWrite: true,
    maxVelocityLayersPerKey: 4,
    maxLoopsPerZone: 1,
    supportsPingPongLoop: false,
    supportsReversePlayback: true,
    supportsSampleStartEndOffsets: true,
    supportsRoundRobin: true,
    supportsReleaseTrigger: true,
    supportsNoteCrossfade: false,
    supportsVelocityCrossfade: false,
    supportsFilter: true,
    supportedFilterPoles: [2, 4],
    supportsPitchEnvelope: true,
    supportsMuteGroups: true,
    supportsKeyswitches: false,
  },
  mpc_xpn: {
    formatId: 'mpc_xpn',
    title: 'Akai MPC Expansion (.xpn)',
    canRead: true,
    canWrite: true,
    maxVelocityLayersPerKey: 4,
    maxLoopsPerZone: 1,
    supportsPingPongLoop: false,
    supportsReversePlayback: true,
    supportsSampleStartEndOffsets: true,
    supportsRoundRobin: true,
    supportsReleaseTrigger: true,
    supportsNoteCrossfade: false,
    supportsVelocityCrossfade: false,
    supportsFilter: true,
    supportedFilterPoles: [2, 4],
    supportsPitchEnvelope: true,
    supportsMuteGroups: true,
    supportsKeyswitches: false,
  },
  nki: {
    formatId: 'nki',
    title: 'Native Instruments Kontakt (.nki)',
    canRead: true,
    canWrite: true,
    maxVelocityLayersPerKey: 'unlimited',
    maxLoopsPerZone: 8,
    supportsPingPongLoop: true,
    supportsReversePlayback: true,
    supportsSampleStartEndOffsets: true,
    supportsRoundRobin: true,
    supportsReleaseTrigger: true,
    supportsNoteCrossfade: true,
    supportsVelocityCrossfade: true,
    supportsFilter: true,
    supportedFilterPoles: [1, 2, 3, 4, 6, 8],
    supportsPitchEnvelope: true,
    supportsMuteGroups: true,
    supportsKeyswitches: true,
  },
  multisample: {
    formatId: 'multisample',
    title: 'Bitwig Studio (.multisample)',
    canRead: true,
    canWrite: true,
    maxVelocityLayersPerKey: 'unlimited',
    maxLoopsPerZone: 1,
    supportsPingPongLoop: false,
    supportsReversePlayback: false,
    supportsSampleStartEndOffsets: true,
    supportsRoundRobin: false,
    supportsReleaseTrigger: false,
    supportsNoteCrossfade: true,
    supportsVelocityCrossfade: true,
    supportsFilter: false,
    supportedFilterPoles: [],
    supportsPitchEnvelope: false,
    supportsMuteGroups: false,
    supportsKeyswitches: false,
  },
  vstpreset: {
    formatId: 'vstpreset',
    title: 'Steinberg HALion (.vstpreset)',
    canRead: true,
    canWrite: true,
    maxVelocityLayersPerKey: 'unlimited',
    maxLoopsPerZone: 1,
    supportsPingPongLoop: true,
    supportsReversePlayback: true,
    supportsSampleStartEndOffsets: true,
    supportsRoundRobin: true,
    supportsReleaseTrigger: true,
    supportsNoteCrossfade: true,
    supportsVelocityCrossfade: true,
    supportsFilter: true,
    supportedFilterPoles: [2, 4],
    supportsPitchEnvelope: true,
    supportsMuteGroups: true,
    supportsKeyswitches: true,
  },
};

export interface FormatAdaptationNotice {
  feature: string;
  severity: 'info' | 'warning';
  message: string;
  adaptation: string;
}

/**
 * Evaluates a UniversalSamplerInstrument against a target format's capabilities
 * and returns a list of automatic adaptations required.
 */
export function evaluateFormatFidelity(
  instrument: UniversalSamplerInstrument,
  targetFormatId: string
): FormatAdaptationNotice[] {
  const caps = FORMAT_CAPABILITIES_REGISTRY[targetFormatId];
  if (!caps) return [];

  const notices: FormatAdaptationNotice[] = [];

  // Check max velocity layers per key range
  if (typeof caps.maxVelocityLayersPerKey === 'number') {
    const keyCounts = new Map<string, number>();
    for (const r of instrument.regions) {
      const k = `${r.lowKey}-${r.highKey}`;
      keyCounts.set(k, (keyCounts.get(k) ?? 0) + 1);
    }
    let exceeded = 0;
    for (const c of keyCounts.values()) {
      if (c > caps.maxVelocityLayersPerKey) exceeded++;
    }
    if (exceeded > 0) {
      notices.push({
        feature: 'velocity_layers',
        severity: targetFormatId === 'legacy-neuron' ? 'warning' : 'info',
        message: `${exceeded} key ranges exceed ${caps.maxVelocityLayersPerKey} layers per group in ${caps.title}.`,
        adaptation:
          targetFormatId === 'mpc_xpm' || targetFormatId === 'mpc_xpn'
            ? 'Overflow layers spill automatically into overlapping keygroups (4 layers per keygroup).'
            : 'Layers are projected to the 2 canonical velocity slots (Low/High split).',
      });
    }
  }

  // Check multi-loop
  const multiLoopCount = instrument.regions.filter((r) => (r.loops?.length ?? 0) > caps.maxLoopsPerZone).length;
  if (multiLoopCount > 0) {
    notices.push({
      feature: 'multi_loop',
      severity: 'info',
      message: `${multiLoopCount} zones define more than ${caps.maxLoopsPerZone} loop(s).`,
      adaptation: `Primary sustain loop (loops[0]) is preserved.`,
    });
  }

  // Check ping-pong loop
  if (!caps.supportsPingPongLoop) {
    const ppCount = instrument.regions.filter((r) => r.loopMode === 'ping_pong' || r.loopMode === 'loop_backward').length;
    if (ppCount > 0) {
      notices.push({
        feature: 'ping_pong_loop',
        severity: 'warning',
        message: `${ppCount} zones use Ping-Pong or Backward loop mode, unsupported by ${caps.title}.`,
        adaptation: 'Converted to standard forward continuous loop.',
      });
    }
  }

  // Check release trigger
  if (!caps.supportsReleaseTrigger) {
    const relCount = instrument.regions.filter((r) => r.trigger === 'release').length;
    if (relCount > 0) {
      notices.push({
        feature: 'release_trigger',
        severity: 'warning',
        message: `${relCount} zones use note-off release trigger, unsupported by ${caps.title}.`,
        adaptation: 'Converted to standard attack trigger.',
      });
    }
  }

  // Check crossfades
  if (!caps.supportsNoteCrossfade || !caps.supportsVelocityCrossfade) {
    const xfadeCount = instrument.regions.filter(
      (r) =>
        (!caps.supportsNoteCrossfade && (r.keyFadeIn > 0 || r.keyFadeOut > 0)) ||
        (!caps.supportsVelocityCrossfade && (r.velFadeIn > 0 || r.velFadeOut > 0))
    ).length;
    if (xfadeCount > 0) {
      notices.push({
        feature: 'crossfade',
        severity: 'info',
        message: `${xfadeCount} zones define key/velocity crossfades not natively supported by ${caps.title}.`,
        adaptation: 'Discrete zone split boundaries are used.',
      });
    }
  }

  return notices;
}

/**
 * Ensures `region.loops` and `region.loopMode/loopStart/loopEnd/loopCrossfadeMs` stay synchronized.
 */
export function syncRegionLoops(region: ExtendedRegion): ExtendedRegion {
  const copy = cloneExtendedRegion(region);
  if (copy.loops && copy.loops.length > 0) {
    const primary = copy.loops[0];
    copy.loopMode = primary.mode;
    copy.loopStart = primary.startFrame;
    copy.loopEnd = primary.endFrame;
    copy.loopCrossfadeMs = primary.crossfadeMs ?? 0;
  } else if (copy.loopMode !== 'no_loop' && copy.loopEnd > copy.loopStart) {
    const primary: SampleLoopDescriptor = {
      id: 'loop-1',
      mode: copy.loopMode,
      startFrame: copy.loopStart,
      endFrame: copy.loopEnd,
      crossfadeMs: copy.loopCrossfadeMs,
      crossfadeCurve: copy.fadeCurve,
    };
    copy.loops = [primary];
  } else {
    copy.loops = [];
  }
  return copy;
}

/**
 * Extracts physical domain parameter values keyed by `sampler_voice_parameter_spec.json` IDs
 * from a `SynthArticulationConfig` and primary region/group.
 */
export function articulationToDictionaryParams(
  art: SynthArticulationConfig,
  primaryRegion?: ExtendedRegion
): Record<string, number> {
  const filterTypeMap: Record<string, number> = {
    lpf: art.filter.poles === 2 ? 2 : 1,
    bpf: 3,
    hpf: 4,
    brf: 5,
    notch: 5,
  };
  const filterTypeIdx = art.filter.enabled ? (filterTypeMap[art.filter.type] ?? 1) : 0;

  const params: Record<string, number> = {
    masterVolumeDb: primaryRegion?.volume ?? 0.0,
    masterPan: (primaryRegion?.pan ?? 0) / 50.0,
    masterTuneCents: primaryRegion?.detune ?? 0.0,
    pitchBendUpSt: art.pitchBendUpSt ?? 2,
    pitchBendDownSt: art.pitchBendDownSt ?? 2,
    voicePolyphony: art.polyphony ?? 16,
    muteGroup: primaryRegion?.muteGroup ?? 0,
    triggerMode:
      primaryRegion?.trigger === 'release'
        ? 1
        : primaryRegion?.trigger === 'first'
          ? 2
          : primaryRegion?.trigger === 'legato'
            ? 3
            : 0,
    seqPlayLogic:
      primaryRegion?.playLogic === 'round_robin' || (primaryRegion?.seqLength ?? 0) > 1
        ? 1
        : primaryRegion?.playLogic === 'random'
          ? 2
          : primaryRegion?.playLogic === 'velocity'
            ? 3
            : 0,
    filterType: filterTypeIdx,
    filterCutoffHz: art.filter.cutoffHz ?? 20000,
    filterResonance: Math.max(0, Math.min(1, (art.filter.resonanceDb ?? 0) / 40.0)),
    filterKeyTrack: Math.max(-100, Math.min(100, ((art.filter.keytrackCents ?? 0) / 1200.0) * 100.0)),
    filterEnvDepthCents: art.filter.envToFilterCents ?? 0,
    ampEnvDelaySec: art.ampEnv.delaySec ?? 0,
    ampEnvAttackSec: Math.max(0.001, art.ampEnv.attackSec ?? 0.005),
    ampEnvHoldSec: art.ampEnv.holdSec ?? 0,
    ampEnvDecaySec: Math.max(0.001, art.ampEnv.decaySec ?? 0.25),
    ampEnvSustainLevel: art.ampEnv.sustainLevel ?? 1.0,
    ampEnvReleaseSec: Math.max(0.001, art.ampEnv.releaseSec ?? 0.2),
    ampEnvVelMod: primaryRegion?.velToVolumeDepth ?? art.ampEnv.velModDepth ?? 100,
    filterEnvAttackSec: Math.max(0.001, (art.filter.filterEnv ?? art.modEnv).attackSec ?? 0.005),
    filterEnvDecaySec: Math.max(0.001, (art.filter.filterEnv ?? art.modEnv).decaySec ?? 0.25),
    filterEnvSustainLevel: (art.filter.filterEnv ?? art.modEnv).sustainLevel ?? 0.5,
    filterEnvReleaseSec: Math.max(0.001, (art.filter.filterEnv ?? art.modEnv).releaseSec ?? 0.2),
    pitchEnvDepthCents: art.pitchEnv?.enabled ? art.pitchEnv.depthCents : art.modEnvToPitchCents ?? 0,
    pitchEnvAttackSec: Math.max(0.001, (art.pitchEnv?.env ?? art.modEnv).attackSec ?? 0.005),
    pitchEnvDecaySec: Math.max(0.001, (art.pitchEnv?.env ?? art.modEnv).decaySec ?? 0.15),
    lfo1RateHz: Math.max(0.01, art.vibLfo.freqHz ?? 5.0),
    lfo1PitchDepthCents: Math.abs(art.vibLfo.toPitchCents ?? 0),
    lfo1FilterDepthCents: Math.abs(art.vibLfo.toFilterCents ?? 0),
    lfo1AmpDepthDb: Math.abs(art.vibLfo.toVolumeDb ?? 0),
  };

  if (primaryRegion) {
    params.zoneRootKey = primaryRegion.rootKey;
    params.zoneLowKey = primaryRegion.lowKey;
    params.zoneHighKey = primaryRegion.highKey;
    params.zoneLowVel = primaryRegion.lowVel;
    params.zoneHighVel = primaryRegion.highVel;
    params.zoneGainDb = primaryRegion.volume;
    params.zonePan = primaryRegion.pan / 50.0;
    params.zoneTuneCoarseSt = 0;
    params.zoneTuneFineCents = primaryRegion.detune;
    params.zoneKeyTrack = primaryRegion.pitchKeytrack;
    params.zoneSampleStart = primaryRegion.sampleStartFrame ?? 0;
    params.zoneSampleEnd = primaryRegion.sampleEndFrame ?? 0;
    params.zoneReverse = primaryRegion.reversed ? 1 : 0;
    params.loopMode =
      primaryRegion.loopMode === 'loop_continuous' || primaryRegion.loopMode === 'loop_sustain'
        ? 1
        : primaryRegion.loopMode === 'ping_pong'
          ? 2
          : primaryRegion.loopMode === 'loop_backward'
            ? 3
            : 0;
    params.loopStartFrame = primaryRegion.loopStart;
    params.loopEndFrame = primaryRegion.loopEnd;
    params.loopCrossfadeMs = primaryRegion.loopCrossfadeMs;
  }

  return params;
}

/**
 * Converts a physical domain parameter map into normalized [0..1] values
 * using the ABDShared Common Data Dictionary (`MidiTranslationEngine`).
 */
export function extractNormalizedDictionaryParams(
  instrument: UniversalSamplerInstrument
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, domainVal] of Object.entries(instrument.parameters)) {
    out[id] = samplerEngine.domainToNormalized(id, domainVal);
  }
  return out;
}

/**
 * Applies normalized [0..1] dictionary values onto a `UniversalSamplerInstrument`
 * using `MidiTranslationEngine`, updating both `instrument.parameters` and `instrument.articulation`.
 */
export function applyNormalizedDictionaryParams(
  instrument: UniversalSamplerInstrument,
  normalizedParams: Record<string, number>
): UniversalSamplerInstrument {
  const nextParams = { ...instrument.parameters };
  for (const [id, normVal] of Object.entries(normalizedParams)) {
    nextParams[id] = samplerEngine.normalizedToDomain(id, normVal);
  }

  const art = cloneArticulation(instrument.articulation);
  if (nextParams.filterCutoffHz !== undefined) {
    art.filter.cutoffHz = nextParams.filterCutoffHz;
  }
  if (nextParams.filterResonance !== undefined) {
    art.filter.resonanceDb = nextParams.filterResonance * 40.0;
  }
  if (nextParams.filterEnvDepthCents !== undefined) {
    art.filter.envToFilterCents = nextParams.filterEnvDepthCents;
  }
  if (nextParams.ampEnvAttackSec !== undefined) {
    art.ampEnv.attackSec = nextParams.ampEnvAttackSec;
    art.ampEnvEnabled = true;
  }
  if (nextParams.ampEnvDecaySec !== undefined) {
    art.ampEnv.decaySec = nextParams.ampEnvDecaySec;
  }
  if (nextParams.ampEnvSustainLevel !== undefined) {
    art.ampEnv.sustainLevel = nextParams.ampEnvSustainLevel;
  }
  if (nextParams.ampEnvReleaseSec !== undefined) {
    art.ampEnv.releaseSec = nextParams.ampEnvReleaseSec;
  }
  if (nextParams.pitchBendUpSt !== undefined) {
    art.pitchBendUpSt = Math.round(nextParams.pitchBendUpSt);
  }
  if (nextParams.pitchBendDownSt !== undefined) {
    art.pitchBendDownSt = Math.round(nextParams.pitchBendDownSt);
  }
  if (nextParams.voicePolyphony !== undefined) {
    art.polyphony = Math.round(nextParams.voicePolyphony);
  }

  return {
    ...instrument,
    parameters: nextParams,
    articulation: art,
  };
}

/**
 * Converts an ABDNeuModMakr `Session` into a canonical `UniversalSamplerInstrument`.
 */
export function sessionToUniversalSamplerInstrument(
  session: Session,
  audioPool?: Map<string, ArrayBuffer>
): UniversalSamplerInstrument {
  const rawRegions =
    session.extendedRegions && session.extendedRegions.length > 0
      ? session.extendedRegions.map((r) => syncRegionLoops(r))
      : syncExtendedRegionsFromClassicZones(session.zones).map((r) => syncRegionLoops(r));

  const articulation = cloneArticulation(session.articulation ?? createDefaultArticulation());

  // Build logical groups from region groupId / muteGroup / trigger
  const groupMap = new Map<string, UniversalSamplerGroup>();
  for (const reg of rawRegions) {
    const gid = reg.groupId || (reg.trigger === 'release' ? 'group-release' : 'group-main');
    if (!groupMap.has(gid)) {
      groupMap.set(gid, {
        id: gid,
        name: reg.groupName || (reg.trigger === 'release' ? 'Release Triggers' : 'Main Keygroup'),
        muteGroup: reg.muteGroup ?? 0,
        keyswitchNote: reg.keyswitchNote,
        polyphony: articulation.polyphony ?? 16,
        playLogic: reg.playLogic ?? ((reg.seqLength ?? 0) > 1 ? 'round_robin' : 'velocity'),
        trigger: reg.trigger,
        volumeDb: 0,
        pan: 0,
        tuneCents: 0,
        ampEnv: reg.ampEnvOverride,
        filter: reg.filterOverride,
        pitchEnv: reg.pitchEnvOverride,
      });
    }
  }

  const modMatrix: UniversalSamplerModRoute[] = [];
  let slot = 1;
  if (articulation.filter.enabled && articulation.filter.envToFilterCents !== 0) {
    modMatrix.push({
      slot: slot++,
      source: 'mod_env',
      destination: 'filter_cutoff_cents',
      amount: articulation.filter.envToFilterCents,
      bipolar: true,
      perVoice: true,
    });
  }
  if (articulation.filter.enabled && articulation.filter.velToFilterCents !== 0) {
    modMatrix.push({
      slot: slot++,
      source: 'velocity',
      destination: 'filter_cutoff_cents',
      amount: articulation.filter.velToFilterCents,
      bipolar: true,
      perVoice: true,
    });
  }
  if (articulation.vibLfo.enabled && articulation.vibLfo.toPitchCents !== 0) {
    modMatrix.push({
      slot: slot++,
      source: 'lfo1',
      destination: 'pitch_cents',
      amount: articulation.vibLfo.toPitchCents,
      bipolar: true,
      perVoice: false,
    });
  }

  const parameters = articulationToDictionaryParams(articulation, rawRegions[0]);

  return {
    id: session.axionikSlug || session.id,
    name: session.processConfig.modelName,
    expandedName: session.processConfig.expandedName || session.name,
    metadata: { ...(session.processConfig.extendedMetadata ?? {}) },
    articulation,
    groups: Array.from(groupMap.values()),
    regions: rawRegions,
    modMatrix,
    parameters,
    audioPool,
  };
}

/**
 * Converts a `UniversalSamplerInstrument` back into a Session-compatible patch
 * (`extendedRegions`, `articulation`, `metadata`).
 */
export function universalSamplerInstrumentToSessionPatch(
  instrument: UniversalSamplerInstrument
): {
  extendedRegions: ExtendedRegion[];
  articulation: SynthArticulationConfig;
  metadata: ExtendedModelMetadata;
} {
  const groupById = new Map<string, UniversalSamplerGroup>();
  for (const g of instrument.groups) {
    groupById.set(g.id, g);
  }

  const extendedRegions = instrument.regions.map((reg) => {
    const synced = syncRegionLoops(reg);
    const group = synced.groupId ? groupById.get(synced.groupId) : undefined;
    if (group) {
      if (synced.muteGroup === undefined && group.muteGroup > 0) synced.muteGroup = group.muteGroup;
      if (synced.keyswitchNote === undefined && group.keyswitchNote !== undefined) {
        synced.keyswitchNote = group.keyswitchNote;
      }
      if (!synced.playLogic) synced.playLogic = group.playLogic;
    }
    return synced;
  });

  return {
    extendedRegions,
    articulation: cloneArticulation(instrument.articulation),
    metadata: { ...instrument.metadata },
  };
}
