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
  AudioFilePayload,
  DahdsrEnvelope,
  ExtendedModelMetadata,
  ExtendedRegion,
  FilterSlopePoles,
  MidiNote,
  PitchEnvelopeConfig,
  RegionFilterConfig,
  SampleLoopDescriptor,
  SamplerPlayLogic,
  SamplerSessionLike as Session,
  SynthArticulationConfig,
  TriggerMode,
} from './SamplerTypes.ts';
import {
  cloneArticulation,
  cloneExtendedRegion,
  createDefaultArticulation,
  projectExtendedRegionsToClassicZones,
  syncExtendedRegionsFromClassicZones,
} from './ExtendedAdapter.ts';
import {
  classifyInstrumentAndParameterSet,
  importSf2PresetToNative,
  type NativeSamplerImportResult,
} from './Sf2Parser.ts';
import { importSfzToNative } from './SfzParser.ts';
import { parseDecentSamplerPreset as parseDecentSamplerNative } from './DecentSamplerParser.ts';
import { importMusic1010Zip } from './Music1010Format.ts';
import { importDelugeZip } from './DelugeFormat.ts';
import { importRenoiseXrni } from './RenoiseFormat.ts';
import { importBlissZip } from './BlissFormat.ts';
import { parsePolyendTrackerPti } from './PolyendTrackerFormat.ts';
import { importWaldorfQpatZip } from './WaldorfQpatFormat.ts';
import { importOpXyZip } from './OpXyFormat.ts';
import { importTonverkZip } from './TonverkFormat.ts';
import { importDistingExZip } from './DistingExFormat.ts';
import {
  parseUniversalSampler,
  type ParsedSamplerPreset,
  type ParsedImportRegion,
} from './rawSamplerParsers.ts';
import { exportRawSamplerLibrary } from './RawSamplerExporter.ts';
import { indexZipArchive } from '../NeuronFormats/ZipArchive.ts';
import type { RawExportOptions, RawExportResult } from './rawSamplerTypes.ts';
import {
  MidiTranslationEngine,
  type ParameterDictionarySpec,
} from '../../Contracts/MidiTranslationEngine.ts';
import samplerSpecJson from '../../Contracts/sampler_voice_parameter_spec.json' with { type: 'json' };

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
    supportsPingPongLoop: true,
    supportsReversePlayback: true,
    supportsSampleStartEndOffsets: true,
    supportsRoundRobin: true,
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
    supportedFilterPoles: [1, 2, 4],
    supportsPitchEnvelope: true,
    supportsMuteGroups: true,
    supportsKeyswitches: true,
  },
  ableton_adv: {
    formatId: 'ableton_adv',
    title: 'Ableton Sampler / Simpler (.adv)',
    canRead: true,
    canWrite: true,
    maxVelocityLayersPerKey: 'unlimited',
    maxLoopsPerZone: 1,
    supportsPingPongLoop: true,
    supportsReversePlayback: true,
    supportsSampleStartEndOffsets: true,
    supportsRoundRobin: true,
    supportsReleaseTrigger: false,
    supportsNoteCrossfade: true,
    supportsVelocityCrossfade: true,
    supportsFilter: true,
    supportedFilterPoles: [2, 4],
    supportsPitchEnvelope: true,
    supportsMuteGroups: false,
    supportsKeyswitches: false,
  },
  exs24: {
    formatId: 'exs24',
    title: 'Apple Logic EXS24 / Sampler (.exs)',
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
    supportedFilterPoles: [1, 2, 3, 4],
    supportsPitchEnvelope: true,
    supportsMuteGroups: true,
    supportsKeyswitches: true,
  },
  tal_sampler: {
    formatId: 'tal_sampler',
    title: 'TAL-Sampler (.talsmpl)',
    canRead: true,
    canWrite: true,
    maxVelocityLayersPerKey: 4,
    maxLoopsPerZone: 1,
    supportsPingPongLoop: true,
    supportsReversePlayback: true,
    supportsSampleStartEndOffsets: true,
    supportsRoundRobin: true,
    supportsReleaseTrigger: false,
    supportsNoteCrossfade: false,
    supportsVelocityCrossfade: false,
    supportsFilter: true,
    supportedFilterPoles: [1, 2, 4],
    supportsPitchEnvelope: true,
    supportsMuteGroups: true,
    supportsKeyswitches: false,
  },
  tx16wx: {
    formatId: 'tx16wx',
    title: 'CWITEC TX16Wx (.txprog)',
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
    supportedFilterPoles: [1, 2, 4],
    supportsPitchEnvelope: true,
    supportsMuteGroups: true,
    supportsKeyswitches: true,
  },
  korg_kmp: {
    formatId: 'korg_kmp',
    title: 'Korg Trinity/Triton/M3/Pa (.KMP/.KSF)',
    canRead: true,
    canWrite: true,
    maxVelocityLayersPerKey: 1,
    maxLoopsPerZone: 1,
    supportsPingPongLoop: false,
    supportsReversePlayback: true,
    supportsSampleStartEndOffsets: true,
    supportsRoundRobin: false,
    supportsReleaseTrigger: false,
    supportsNoteCrossfade: false,
    supportsVelocityCrossfade: false,
    supportsFilter: false,
    supportedFilterPoles: [],
    supportsPitchEnvelope: false,
    supportsMuteGroups: false,
    supportsKeyswitches: false,
  },
  dls: {
    formatId: 'dls',
    title: 'MMA Downloadable Sounds Level 2 (.dls)',
    canRead: true,
    canWrite: true,
    maxVelocityLayersPerKey: 'unlimited',
    maxLoopsPerZone: 1,
    supportsPingPongLoop: false,
    supportsReversePlayback: false,
    supportsSampleStartEndOffsets: false,
    supportsRoundRobin: false,
    supportsReleaseTrigger: false,
    supportsNoteCrossfade: false,
    supportsVelocityCrossfade: false,
    supportsFilter: true,
    supportedFilterPoles: [2],
    supportsPitchEnvelope: true,
    supportsMuteGroups: true,
    supportsKeyswitches: false,
  },
  music1010: {
    formatId: 'music1010',
    title: '1010music Blackbox / Tangerine (preset.xml)',
    canRead: true,
    canWrite: true,
    maxVelocityLayersPerKey: 'unlimited',
    maxLoopsPerZone: 1,
    supportsPingPongLoop: false,
    supportsReversePlayback: true,
    supportsSampleStartEndOffsets: true,
    supportsRoundRobin: false,
    supportsReleaseTrigger: false,
    supportsNoteCrossfade: false,
    supportsVelocityCrossfade: false,
    supportsFilter: true,
    supportedFilterPoles: [2, 4],
    supportsPitchEnvelope: false,
    supportsMuteGroups: true,
    supportsKeyswitches: false,
  },
  deluge: {
    formatId: 'deluge',
    title: 'Synthstrom Deluge (SYNTHS/*.XML)',
    canRead: true,
    canWrite: true,
    maxVelocityLayersPerKey: 1,
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
    supportsPitchEnvelope: false,
    supportsMuteGroups: false,
    supportsKeyswitches: false,
  },
  renoise: {
    formatId: 'renoise',
    title: 'Renoise Instrument (.xrni)',
    canRead: true,
    canWrite: true,
    maxVelocityLayersPerKey: 'unlimited',
    maxLoopsPerZone: 1,
    supportsPingPongLoop: true,
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
  bliss: {
    formatId: 'bliss',
    title: 'discoDSP Bliss (.zbp)',
    canRead: true,
    canWrite: true,
    maxVelocityLayersPerKey: 'unlimited',
    maxLoopsPerZone: 1,
    supportsPingPongLoop: true,
    supportsReversePlayback: false,
    supportsSampleStartEndOffsets: true,
    supportsRoundRobin: false,
    supportsReleaseTrigger: false,
    supportsNoteCrossfade: false,
    supportsVelocityCrossfade: false,
    supportsFilter: true,
    supportedFilterPoles: [2],
    supportsPitchEnvelope: true,
    supportsMuteGroups: true,
    supportsKeyswitches: false,
  },
  polyend_pti: {
    formatId: 'polyend_pti',
    title: 'Polyend Tracker / Play (.pti)',
    canRead: true,
    canWrite: true,
    maxVelocityLayersPerKey: 1,
    maxLoopsPerZone: 1,
    supportsPingPongLoop: true,
    supportsReversePlayback: true,
    supportsSampleStartEndOffsets: true,
    supportsRoundRobin: false,
    supportsReleaseTrigger: false,
    supportsNoteCrossfade: false,
    supportsVelocityCrossfade: false,
    supportsFilter: true,
    supportedFilterPoles: [2],
    supportsPitchEnvelope: false,
    supportsMuteGroups: false,
    supportsKeyswitches: false,
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
    // Fase 43: emit canonical sampler_voice_parameter_spec.json IDs
    // (was: zoneTuneCoarseSt/zoneTuneFineCents/zoneKeyTrack).
    params.zoneTuneSemitones = 0;
    params.zoneTuneCents = primaryRegion.detune;
    params.zonePitchKeyTrack = primaryRegion.pitchKeytrack;
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

/**
 * Converts a `NativeSamplerImportResult` (from `Sf2Parser`, `SfzParser`, `DecentSamplerParser`)
 * into a canonical `UniversalSamplerInstrument` with its `audioPool` populated.
 */
export function nativeImportResultToUniversalInstrument(
  result: NativeSamplerImportResult
): UniversalSamplerInstrument {
  const audioPool = new Map<string, ArrayBuffer>();
  for (const file of result.audioFiles) {
    audioPool.set(file.name, file.buffer);
  }

  const pseudoSession: Session = {
    id: `inst-${result.modelName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name: result.presetName || result.modelName,
    zones: result.classicZones,
    extendedRegions: result.extendedRegions,
    articulation: result.articulation,
    detectedInstrumentCategory: result.detectedCategory,
    processConfig: {
      modelNumber: 0,
      modelName: result.modelName.slice(0, 11),
      expandedName: result.presetName || result.modelName,
      complexity: 8,
      parameterSet: result.suggestedParameterSet ?? 0,
      workingMode: 'extended',
      extendedMetadata: {
        ...(result.metadata ?? {}),
        sourceFormat: result.metadata?.sourceFormat ?? result.sourceFormat,
        sourcePresetName: result.presetName,
        category: result.detectedCategory,
      },
    },
  };

  return sessionToUniversalSamplerInstrument(pseudoSession, audioPool);
}

/**
 * Converts a `UniversalSamplerInstrument` into a `NativeSamplerImportResult`
 * (including classic zone projection and velocity layer gain compensation).
 */
export function universalInstrumentToNativeImportResult(
  instrument: UniversalSamplerInstrument,
  sourceFormat: 'sf2' | 'sfz' = 'sfz'
): NativeSamplerImportResult {
  const patch = universalSamplerInstrumentToSessionPatch(instrument);
  const projection = projectExtendedRegionsToClassicZones(patch.extendedRegions);
  const classif = classifyInstrumentAndParameterSet(
    instrument.expandedName || instrument.name
  );

  const audioFiles: AudioFilePayload[] = [];
  if (instrument.audioPool) {
    for (const [name, buffer] of instrument.audioPool.entries()) {
      audioFiles.push({ name, buffer });
    }
  }

  return {
    sourceFormat,
    presetName: instrument.expandedName || instrument.name,
    modelName: instrument.name.slice(0, 11),
    detectedCategory: instrument.metadata.category || classif.category,
    suggestedParameterSet: classif.parameterSet,
    audioFiles,
    extendedRegions: patch.extendedRegions,
    classicZones: projection.zones,
    velocityLayerGainCompensation: projection.velocityLayerGainCompensation,
    articulation: patch.articulation,
    metadata: patch.metadata,
  };
}

/**
 * Converts a `ParsedSamplerPreset` (from `rawSamplerParsers`) into a canonical `UniversalSamplerInstrument`.
 */
export function parsedSamplerPresetToUniversalInstrument(
  preset: ParsedSamplerPreset
): UniversalSamplerInstrument {
  const articulation = createDefaultArticulation();
  if (preset.envelope) {
    articulation.ampEnvEnabled = true;
    articulation.ampEnv = {
      ...articulation.ampEnv,
      delaySec: preset.envelope.delay ?? articulation.ampEnv.delaySec,
      attackSec: preset.envelope.attack,
      holdSec: preset.envelope.hold ?? articulation.ampEnv.holdSec,
      decaySec: preset.envelope.decay,
      sustainLevel: preset.envelope.sustain,
      releaseSec: preset.envelope.release,
    };
  }
  if (preset.filter) {
    articulation.filter = {
      ...articulation.filter,
      ...preset.filter,
    };
  }
  if (preset.pitchEnv && preset.pitchEnv.enabled) {
    articulation.pitchEnv = {
      enabled: true,
      depthCents: preset.pitchEnv.depthCents ?? 0,
      env: {
        ...articulation.modEnv,
        ...(preset.pitchEnv.env ?? {}),
      },
    };
    articulation.modEnvEnabled = true;
    articulation.modEnvToPitchCents = preset.pitchEnv.depthCents ?? 0;
  }
  if (preset.polyphony !== undefined) {
    articulation.polyphony = preset.polyphony;
  }
  if (preset.pitchBendUpSt !== undefined) {
    articulation.pitchBendUpSt = preset.pitchBendUpSt;
  }
  if (preset.pitchBendDownSt !== undefined) {
    articulation.pitchBendDownSt = preset.pitchBendDownSt;
  }

  const regions: ExtendedRegion[] = preset.regions.map((r, idx) =>
    syncRegionLoops({
      id: r.id || `reg-${idx + 1}`,
      sampleName: r.sampleName,
      lowKey: r.lowKey,
      highKey: r.highKey,
      rootKey: r.rootKey,
      lowVel: r.lowVel,
      highVel: r.highVel,
      detune: r.detuneCents,
      volume: r.volumeDb,
      pan: r.pan,
      pitchKeytrack: r.pitchKeytrack ?? 100,
      trigger: r.trigger ?? 'attack',
      playLogic: r.playLogic ?? 'velocity',
      seqPosition: r.seqPosition,
      seqLength: r.seqLength,
      sampleStartFrame: r.sampleStartFrame,
      sampleEndFrame: r.sampleEndFrame,
      reversed: r.reversed,
      groupId: r.groupId ?? (r.groupName ? `grp-${r.groupName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : undefined),
      groupName: r.groupName,
      muteGroup: r.muteGroup,
      keyswitchNote: r.keyswitchNote,
      velToVolumeDepth: r.velToVolumeDepth,
      velToPitchCents: r.velToPitchCents,
      keyFadeIn: r.keyFadeIn ?? 0,
      keyFadeOut: r.keyFadeOut ?? 0,
      velFadeIn: r.velFadeIn ?? 0,
      velFadeOut: r.velFadeOut ?? 0,
      fadeCurve: r.fadeCurve ?? 'equal-power',
      loopMode: r.loopMode,
      loopStart: r.loopStart,
      loopEnd: r.loopEnd,
      loopCrossfadeMs: r.loopCrossfadeMs ?? 0,
      loops: r.loops,
      hasPlaybackOverride: r.loopMode !== 'no_loop' || Boolean(r.reversed) || (r.sampleStartFrame ?? 0) > 0,
    })
  );

  const audioPool = new Map<string, ArrayBuffer>();
  for (const [k, v] of preset.audioBuffers.entries()) {
    audioPool.set(k, v);
  }

  const projection = projectExtendedRegionsToClassicZones(regions);
  const pseudoSession: Session = {
    id: `inst-${preset.presetName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name: preset.presetName,
    zones: projection.zones,
    extendedRegions: regions,
    articulation,
    detectedInstrumentCategory: preset.detectedCategory,
    processConfig: {
      modelNumber: 0,
      modelName: preset.modelName || preset.presetName.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 11) || 'Instrument',
      expandedName: preset.presetName,
      complexity: 8,
      parameterSet: preset.suggestedParameterSet ?? 0,
      workingMode: 'extended',
      extendedMetadata: {
        category: preset.detectedCategory,
        sourceFormat: preset.format,
        sourcePresetName: preset.presetName,
        author: preset.author,
        description: preset.description,
      },
    },
  };

  return sessionToUniversalSamplerInstrument(pseudoSession, audioPool);
}

/**
 * Converts a `UniversalSamplerInstrument` into a `ParsedSamplerPreset` (compatible with `UniversalImportModal`).
 */
export function universalInstrumentToParsedSamplerPreset(
  instrument: UniversalSamplerInstrument,
  format: ParsedSamplerPreset['format'] = 'dspreset'
): ParsedSamplerPreset {
  const audioBuffers = new Map<string, ArrayBuffer>();
  if (instrument.audioPool) {
    for (const [k, v] of instrument.audioPool.entries()) {
      audioBuffers.set(k, v);
    }
  }

  const regions: ParsedImportRegion[] = instrument.regions.map((r) => ({
    id: r.id,
    sampleName: r.sampleName,
    samplePath: r.sampleName,
    rootKey: r.rootKey,
    lowKey: r.lowKey,
    highKey: r.highKey,
    lowVel: r.lowVel,
    highVel: r.highVel,
    detuneCents: r.detune,
    volumeDb: r.volume,
    pan: r.pan,
    pitchKeytrack: r.pitchKeytrack,
    sampleStartFrame: r.sampleStartFrame,
    sampleEndFrame: r.sampleEndFrame,
    reversed: r.reversed,
    keyFadeIn: r.keyFadeIn,
    keyFadeOut: r.keyFadeOut,
    velFadeIn: r.velFadeIn,
    velFadeOut: r.velFadeOut,
    fadeCurve: r.fadeCurve,
    loopMode: r.loopMode,
    loopStart: r.loopStart,
    loopEnd: r.loopEnd,
    loopCrossfadeMs: r.loopCrossfadeMs,
    loops: r.loops,
    trigger: r.trigger,
    playLogic: r.playLogic,
    seqPosition: r.seqPosition,
    seqLength: r.seqLength,
    groupId: r.groupId,
    groupName: r.groupName,
    muteGroup: r.muteGroup,
    keyswitchNote: r.keyswitchNote,
    velToVolumeDepth: r.velToVolumeDepth,
    velToPitchCents: r.velToPitchCents,
  }));

  const classif = classifyInstrumentAndParameterSet(instrument.expandedName || instrument.name);

  return {
    format,
    formatLabel: FORMAT_CAPABILITIES_REGISTRY[format]?.title ?? format.toUpperCase(),
    presetName: instrument.expandedName || instrument.name,
    modelName: instrument.name.slice(0, 11),
    detectedCategory: instrument.metadata.category || classif.category,
    suggestedParameterSet: classif.parameterSet,
    regions,
    audioBuffers,
    envelope: instrument.articulation.ampEnvEnabled
      ? {
          delay: instrument.articulation.ampEnv.delaySec,
          attack: instrument.articulation.ampEnv.attackSec,
          hold: instrument.articulation.ampEnv.holdSec,
          decay: instrument.articulation.ampEnv.decaySec,
          sustain: instrument.articulation.ampEnv.sustainLevel,
          release: instrument.articulation.ampEnv.releaseSec,
        }
      : undefined,
    filter: instrument.articulation.filter,
    pitchEnv: instrument.articulation.pitchEnv,
    polyphony: instrument.articulation.polyphony,
    pitchBendUpSt: instrument.articulation.pitchBendUpSt,
    pitchBendDownSt: instrument.articulation.pitchBendDownSt,
    author: instrument.metadata.author,
    description: instrument.metadata.description,
  };
}

/**
 * High-level unified reader: parses any supported sampler file (.sf2, .sfz, .dspreset, .nki,
 * .ncw, .vstpreset, .multisample, .xpm, .xpn, .xty, .xtd, .rx2, .ot, .wav chain) directly into
 * a `UniversalSamplerInstrument`.
 */
export async function parseUniversalSamplerInstrument(
  filename: string,
  buffer: ArrayBuffer,
  siblingFiles?: Map<string, ArrayBuffer>,
  decodedWavBufferOrProgramPath?: ArrayBuffer | string,
  selectedProgramPath?: string
): Promise<UniversalSamplerInstrument> {
  const lower = filename.toLowerCase();

  // Direct rich parsers for SF2, standalone SFZ, and standalone .dspreset XML
  if (lower.endsWith('.sf2')) {
    const presetIdx =
      typeof decodedWavBufferOrProgramPath === 'string'
        ? parseInt(decodedWavBufferOrProgramPath, 10) || 0
        : 0;
    const sf2Res = importSf2PresetToNative(buffer, presetIdx);
    return nativeImportResultToUniversalInstrument(sf2Res);
  }

  if (lower.endsWith('.sfz') && siblingFiles) {
    const text = new TextDecoder('utf-8').decode(buffer);
    const audioFiles: AudioFilePayload[] = [];
    for (const [name, buf] of siblingFiles.entries()) {
      audioFiles.push({ name, buffer: buf });
    }
    const sfzRes = importSfzToNative(text, filename, audioFiles);
    return nativeImportResultToUniversalInstrument(sfzRes);
  }

  if (lower.endsWith('.dspreset') && siblingFiles) {
    const text = new TextDecoder('utf-8').decode(buffer);
    const audioPayloads = new Map<string, Uint8Array>();
    for (const [name, buf] of siblingFiles.entries()) {
      audioPayloads.set(name, new Uint8Array(buf));
    }
    const dsRes = parseDecentSamplerNative(text, audioPayloads, filename.replace(/\.dspreset$/i, ''));
    return nativeImportResultToUniversalInstrument(dsRes);
  }

  // Direct decoders for Sub-bloque 2A: Polyend PTI, Renoise XRNI, Bliss ZBP
  if (lower.endsWith('.pti')) {
    const pti = parsePolyendTrackerPti(buffer, filename);
    return parsedSamplerPresetToUniversalInstrument({
      format: 'polyend_pti' as unknown as ParsedSamplerPreset['format'],
      formatLabel: 'Polyend Tracker (.pti)',
      presetName: pti.presetName,
      modelName: pti.presetName.slice(0, 11),
      detectedCategory: 'Instrument',
      suggestedParameterSet: 0,
      filter: pti.articulation.filter,
      envelope: pti.articulation.ampEnvEnabled ? {
        delay: pti.articulation.ampEnv.delaySec,
        attack: pti.articulation.ampEnv.attackSec,
        hold: pti.articulation.ampEnv.holdSec,
        decay: pti.articulation.ampEnv.decaySec,
        sustain: pti.articulation.ampEnv.sustainLevel,
        release: pti.articulation.ampEnv.releaseSec,
      } : undefined,
      regions: pti.regions.map(r => ({
        id: r.id,
        sampleName: r.sampleName,
        samplePath: r.sampleName,
        rootKey: r.rootKey,
        lowKey: r.lowKey,
        highKey: r.highKey,
        lowVel: r.lowVel,
        highVel: r.highVel,
        detuneCents: r.detune,
        volumeDb: r.volume,
        pan: r.pan,
        loopMode: r.loopMode,
        loopStart: r.loopStart,
        loopEnd: r.loopEnd,
        reversed: r.reversed,
        sampleStartFrame: r.sampleStartFrame,
        sampleEndFrame: r.sampleEndFrame,
      })),
      audioBuffers: pti.audioBuffers,
    });
  }

  if (lower.endsWith('.xrni')) {
    const rRes = importRenoiseXrni(new Uint8Array(buffer));
    return parsedSamplerPresetToUniversalInstrument({
      format: 'renoise' as unknown as ParsedSamplerPreset['format'],
      formatLabel: 'Renoise (.xrni)',
      presetName: rRes.presetName,
      modelName: rRes.presetName.slice(0, 11),
      detectedCategory: 'Instrument',
      suggestedParameterSet: 0,
      filter: rRes.articulation.filter,
      envelope: rRes.articulation.ampEnvEnabled ? {
        delay: rRes.articulation.ampEnv.delaySec,
        attack: rRes.articulation.ampEnv.attackSec,
        hold: rRes.articulation.ampEnv.holdSec,
        decay: rRes.articulation.ampEnv.decaySec,
        sustain: rRes.articulation.ampEnv.sustainLevel,
        release: rRes.articulation.ampEnv.releaseSec,
      } : undefined,
      regions: rRes.regions.map(r => ({
        id: r.id,
        sampleName: r.sampleName,
        samplePath: r.sampleName,
        rootKey: r.rootKey,
        lowKey: r.lowKey,
        highKey: r.highKey,
        lowVel: r.lowVel,
        highVel: r.highVel,
        detuneCents: r.detune,
        volumeDb: r.volume,
        pan: r.pan,
        loopMode: r.loopMode,
        loopStart: r.loopStart,
        loopEnd: r.loopEnd,
      })),
      audioBuffers: rRes.audioBuffers,
    });
  }

  if (lower.endsWith('.zbp')) {
    const bRes = importBlissZip(new Uint8Array(buffer));
    return parsedSamplerPresetToUniversalInstrument({
      format: 'bliss' as unknown as ParsedSamplerPreset['format'],
      formatLabel: 'discoDSP Bliss (.zbp)',
      presetName: bRes.presetName,
      modelName: bRes.presetName.slice(0, 11),
      detectedCategory: 'Instrument',
      suggestedParameterSet: 0,
      filter: bRes.articulation.filter,
      envelope: bRes.articulation.ampEnvEnabled ? {
        delay: bRes.articulation.ampEnv.delaySec,
        attack: bRes.articulation.ampEnv.attackSec,
        hold: bRes.articulation.ampEnv.holdSec,
        decay: bRes.articulation.ampEnv.decaySec,
        sustain: bRes.articulation.ampEnv.sustainLevel,
        release: bRes.articulation.ampEnv.releaseSec,
      } : undefined,
      regions: bRes.regions.map(r => ({
        id: r.id,
        sampleName: r.sampleName,
        samplePath: r.sampleName,
        rootKey: r.rootKey,
        lowKey: r.lowKey,
        highKey: r.highKey,
        lowVel: r.lowVel,
        highVel: r.highVel,
        detuneCents: r.detune,
        volumeDb: r.volume,
        pan: r.pan,
        loopMode: r.loopMode,
        loopStart: r.loopStart,
        loopEnd: r.loopEnd,
      })),
      audioBuffers: bRes.audioBuffers,
    });
  }

  // Check for 1010music or Deluge archives (.zip)
  if (lower.endsWith('.zip')) {
    const bytes = new Uint8Array(buffer);
    const entries = indexZipArchive(bytes);
    const hasPresetXml = entries.some(e => {
      const p = e.path.toLowerCase();
      return p.endsWith('/preset.xml') || p.endsWith('\\preset.xml') || p === 'preset.xml';
    });
    const hasDelugeXml = entries.some(e => {
      const p = e.path.toLowerCase();
      return p.endsWith('.xml') && (p.includes('synths') || p.includes('kits'));
    });

    if (hasPresetXml) {
      try {
        const m1010 = importMusic1010Zip(bytes);
        if (m1010.regions.length > 0) {
          return parsedSamplerPresetToUniversalInstrument({
            format: 'music1010' as unknown as ParsedSamplerPreset['format'],
            formatLabel: '1010music Blackbox (preset.xml)',
            presetName: m1010.presetName,
            modelName: m1010.presetName.slice(0, 11),
            detectedCategory: 'Instrument',
            suggestedParameterSet: 0,
            filter: m1010.articulation.filter,
            envelope: m1010.articulation.ampEnvEnabled ? {
              delay: m1010.articulation.ampEnv.delaySec,
              attack: m1010.articulation.ampEnv.attackSec,
              hold: m1010.articulation.ampEnv.holdSec,
              decay: m1010.articulation.ampEnv.decaySec,
              sustain: m1010.articulation.ampEnv.sustainLevel,
              release: m1010.articulation.ampEnv.releaseSec,
            } : undefined,
            regions: m1010.regions.map(r => ({
              id: r.id,
              sampleName: r.sampleName,
              samplePath: r.sampleName,
              rootKey: r.rootKey,
              lowKey: r.lowKey,
              highKey: r.highKey,
              lowVel: r.lowVel,
              highVel: r.highVel,
              detuneCents: r.detune,
              volumeDb: r.volume,
              pan: r.pan,
              loopMode: r.loopMode,
              loopStart: r.loopStart,
              loopEnd: r.loopEnd,
              reversed: r.reversed,
              sampleEndFrame: r.sampleEndFrame,
            })),
            audioBuffers: m1010.audioBuffers,
          });
        }
      } catch {
        // Not a valid 1010music preset
      }
    }

    if (hasDelugeXml) {
      try {
        const del = importDelugeZip(bytes);
        return parsedSamplerPresetToUniversalInstrument({
          format: 'deluge' as unknown as ParsedSamplerPreset['format'],
          formatLabel: 'Synthstrom Deluge (SYNTHS/*.XML)',
          presetName: del.presetName,
          modelName: del.presetName.slice(0, 11),
          detectedCategory: 'Instrument',
          suggestedParameterSet: 0,
          filter: del.articulation.filter,
          envelope: del.articulation.ampEnvEnabled ? {
            delay: del.articulation.ampEnv.delaySec,
            attack: del.articulation.ampEnv.attackSec,
            hold: del.articulation.ampEnv.holdSec,
            decay: del.articulation.ampEnv.decaySec,
            sustain: del.articulation.ampEnv.sustainLevel,
            release: del.articulation.ampEnv.releaseSec,
          } : undefined,
          regions: del.regions.map(r => ({
            id: r.id,
            sampleName: r.sampleName,
            samplePath: r.sampleName,
            rootKey: r.rootKey,
            lowKey: r.lowKey,
            highKey: r.highKey,
            lowVel: r.lowVel,
            highVel: r.highVel,
            detuneCents: r.detune,
            volumeDb: r.volume,
            pan: r.pan,
            loopMode: r.loopMode,
            loopStart: r.loopStart,
            loopEnd: r.loopEnd,
          })),
          audioBuffers: del.audioBuffers,
        });
      } catch {
        // Not a valid Deluge archive
      }
    }

    const hasQpat = entries.some(e => e.path.toLowerCase().endsWith('.qpat'));
    if (hasQpat) {
      try {
        const qRes = importWaldorfQpatZip(buffer);
        return parsedSamplerPresetToUniversalInstrument({
          format: 'waldorf_qpat' as unknown as ParsedSamplerPreset['format'],
          formatLabel: 'Waldorf Quantum/Iridium (.qpat)',
          presetName: qRes.presetName,
          modelName: qRes.presetName.slice(0, 11),
          detectedCategory: 'Instrument',
          suggestedParameterSet: 0,
          filter: qRes.articulation.filter,
          envelope: qRes.articulation.ampEnvEnabled ? {
            attack: qRes.articulation.ampEnv.attackSec,
            decay: qRes.articulation.ampEnv.decaySec,
            sustain: qRes.articulation.ampEnv.sustainLevel,
            release: qRes.articulation.ampEnv.releaseSec,
          } : undefined,
          regions: qRes.regions.map(r => ({
            id: r.id,
            sampleName: r.sampleName,
            samplePath: r.sampleName,
            rootKey: r.rootKey,
            lowKey: r.lowKey,
            highKey: r.highKey,
            lowVel: r.lowVel,
            highVel: r.highVel,
            detuneCents: r.detune,
            volumeDb: r.volume,
            pan: r.pan,
            loopMode: r.loops && r.loops.length > 0 ? r.loops[0].mode : r.loopMode,
            loopStart: r.loops && r.loops.length > 0 ? r.loops[0].startFrame : r.loopStart,
            loopEnd: r.loops && r.loops.length > 0 ? r.loops[0].endFrame : r.loopEnd,
            sampleStartFrame: r.sampleStartFrame,
            sampleEndFrame: r.sampleEndFrame,
            reversed: r.reversed,
          })),
          audioBuffers: qRes.audioBuffers,
        });
      } catch {
        // Not a valid QPAT package
      }
    }

    const hasOpXy = entries.some(e => e.path.toLowerCase().endsWith('patch.json'));
    if (hasOpXy) {
      try {
        const opRes = importOpXyZip(buffer);
        return parsedSamplerPresetToUniversalInstrument({
          format: 'opxy' as unknown as ParsedSamplerPreset['format'],
          formatLabel: 'Teenage Engineering OP-XY',
          presetName: opRes.presetName,
          modelName: opRes.presetName.slice(0, 11),
          detectedCategory: 'Instrument',
          suggestedParameterSet: 0,
          filter: opRes.articulation.filter,
          envelope: opRes.articulation.ampEnvEnabled ? {
            attack: opRes.articulation.ampEnv.attackSec,
            decay: opRes.articulation.ampEnv.decaySec,
            sustain: opRes.articulation.ampEnv.sustainLevel,
            release: opRes.articulation.ampEnv.releaseSec,
          } : undefined,
          regions: opRes.regions.map(r => ({
            id: r.id,
            sampleName: r.sampleName,
            samplePath: r.sampleName,
            rootKey: r.rootKey,
            lowKey: r.lowKey,
            highKey: r.highKey,
            lowVel: r.lowVel,
            highVel: r.highVel,
            detuneCents: r.detune,
            volumeDb: r.volume,
            pan: r.pan,
            loopMode: r.loops && r.loops.length > 0 ? r.loops[0].mode : r.loopMode,
            loopStart: r.loops && r.loops.length > 0 ? r.loops[0].startFrame : r.loopStart,
            loopEnd: r.loops && r.loops.length > 0 ? r.loops[0].endFrame : r.loopEnd,
            sampleStartFrame: r.sampleStartFrame,
            sampleEndFrame: r.sampleEndFrame,
            reversed: r.reversed,
          })),
          audioBuffers: opRes.audioBuffers,
        });
      } catch {
        // Not a valid OP-XY package
      }
    }

    const hasTonverk = entries.some(e => {
      const p = e.path.toLowerCase();
      return p.endsWith('.tvpst') || p.endsWith('elmulti');
    });
    if (hasTonverk) {
      try {
        const tvRes = importTonverkZip(buffer);
        return parsedSamplerPresetToUniversalInstrument({
          format: 'tonverk' as unknown as ParsedSamplerPreset['format'],
          formatLabel: 'Elektron Tonverk (.tvpst)',
          presetName: tvRes.presetName,
          modelName: tvRes.presetName.slice(0, 11),
          detectedCategory: 'Instrument',
          suggestedParameterSet: 0,
          filter: tvRes.articulation.filter,
          envelope: tvRes.articulation.ampEnvEnabled ? {
            attack: tvRes.articulation.ampEnv.attackSec,
            decay: tvRes.articulation.ampEnv.decaySec,
            sustain: tvRes.articulation.ampEnv.sustainLevel,
            release: tvRes.articulation.ampEnv.releaseSec,
          } : undefined,
          regions: tvRes.regions.map(r => ({
            id: r.id,
            sampleName: r.sampleName,
            samplePath: r.sampleName,
            rootKey: r.rootKey,
            lowKey: r.lowKey,
            highKey: r.highKey,
            lowVel: r.lowVel,
            highVel: r.highVel,
            detuneCents: r.detune,
            volumeDb: r.volume,
            pan: r.pan,
            loopMode: r.loops && r.loops.length > 0 ? r.loops[0].mode : r.loopMode,
            loopStart: r.loops && r.loops.length > 0 ? r.loops[0].startFrame : r.loopStart,
            loopEnd: r.loops && r.loops.length > 0 ? r.loops[0].endFrame : r.loopEnd,
            sampleStartFrame: r.sampleStartFrame,
            sampleEndFrame: r.sampleEndFrame,
          })),
          audioBuffers: tvRes.audioBuffers,
        });
      } catch {
        // Not a valid Tonverk package
      }
    }

    const hasDisting = entries.some(e => e.path.toLowerCase().endsWith('.dexpreset'));
    if (hasDisting) {
      try {
        const dexRes = importDistingExZip(buffer);
        return parsedSamplerPresetToUniversalInstrument({
          format: 'disting_ex' as unknown as ParsedSamplerPreset['format'],
          formatLabel: 'Expert Sleepers Disting EX',
          presetName: dexRes.presetName,
          modelName: dexRes.presetName.slice(0, 11),
          detectedCategory: 'Instrument',
          suggestedParameterSet: 0,
          regions: dexRes.regions.map(r => ({
            id: r.id,
            sampleName: r.sampleName,
            samplePath: r.sampleName,
            rootKey: r.rootKey,
            lowKey: r.lowKey,
            highKey: r.highKey,
            lowVel: r.lowVel,
            highVel: r.highVel,
            detuneCents: r.detune,
            volumeDb: r.volume,
            pan: r.pan,
            loopMode: r.loops && r.loops.length > 0 ? r.loops[0].mode : r.loopMode,
            loopStart: r.loops && r.loops.length > 0 ? r.loops[0].startFrame : r.loopStart,
            loopEnd: r.loops && r.loops.length > 0 ? r.loops[0].endFrame : r.loopEnd,
          })),
          audioBuffers: dexRes.audioBuffers,
        });
      } catch {
        // Not a valid Disting EX package
      }
    }
  }

  // Fallback to multi-container / archive / MPC / Kontakt / Bitwig / HALion / Slicer parser
  let siblingUint8: Map<string, Uint8Array> | undefined;
  if (siblingFiles) {
    siblingUint8 = new Map<string, Uint8Array>();
    for (const [k, v] of siblingFiles.entries()) {
      siblingUint8.set(k, new Uint8Array(v));
    }
  }
  const parsed = await parseUniversalSampler(
    filename,
    buffer,
    siblingUint8,
    decodedWavBufferOrProgramPath,
    selectedProgramPath
  );
  return parsedSamplerPresetToUniversalInstrument(parsed);
}

/**
 * High-level unified writer: exports a `UniversalSamplerInstrument` directly to any target
 * `RawSamplerFormat` (`sf2`, `sfz`, `dspreset`, `nki`, `vstpreset`, `multisample`, `mpc_xpm`, `mpc_xpn`, `sample_chain`).
 */
export async function exportUniversalSamplerInstrument(
  instrument: UniversalSamplerInstrument,
  options: RawExportOptions,
  sampleBuffersOverride?: Map<string, ArrayBuffer>
): Promise<RawExportResult> {
  const patch = universalSamplerInstrumentToSessionPatch(instrument);
  const projection = projectExtendedRegionsToClassicZones(patch.extendedRegions);
  const pseudoSession: Session = {
    id: instrument.id,
    name: instrument.expandedName || instrument.name,
    axionikSlug: instrument.id,
    zones: projection.zones,
    extendedRegions: patch.extendedRegions,
    articulation: patch.articulation,
    detectedInstrumentCategory: patch.metadata.category,
    processConfig: {
      modelNumber: 0,
      modelName: instrument.name.slice(0, 11) || 'Instrument',
      expandedName: instrument.expandedName || instrument.name,
      complexity: 8,
      parameterSet: 0,
      workingMode: 'extended',
      extendedMetadata: patch.metadata,
    },
  };

  const buffers = sampleBuffersOverride ?? instrument.audioPool ?? new Map<string, ArrayBuffer>();
  return exportRawSamplerLibrary(pseudoSession, options, (name) => buffers.get(name));
}

