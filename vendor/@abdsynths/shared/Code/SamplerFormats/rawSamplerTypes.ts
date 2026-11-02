// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Raw Multi-Format Sampler Exporter Types (Fase 16 + Fase 32.3/32.4)
//
// Types and contracts for exporting pristine raw samples and
// zone/region mappings (unprocessed by Scape/Sphere resynthesis)
// to standard sampler formats.
// ─────────────────────────────────────────────────────────

import type {
  CrossfadeCurve,
  DahdsrEnvelope,
  LoopMode,
  MidiNote,
  PitchEnvelopeConfig,
  RegionFilterConfig,
  SampleLoopDescriptor,
  SamplerPlayLogic,
  TriggerMode,
} from './SamplerTypes.ts';

export type RawSamplerFormat =
  | 'sfz'          // SFZ format (.sfz + Samples/ folder packaged as .zip)
  | 'dspreset'     // Decent Sampler XML format (.dspreset + Samples/ folder packaged as .zip)
  | 'sf2'          // SoundFont 2.04 binary RIFF sfbk (.sf2 standalone)
  | 'nki'          // Native Instruments Kontakt structured instrument (.zip with definition + Samples/)
  | 'vstpreset'    // Steinberg HALion program preset (.zip with .vstpreset + Samples/)
  | 'multisample'  // Bitwig Studio Multisample package (.multisample zip with multisample.xml)
  | 'mpc_xpm'      // Akai MPC Program (.xpm XML + sibling WAVs packaged as .zip)
  | 'mpc_xpn'      // Akai MPC Expansion Pack (.xpn with Expansion.xml + .xpm + WAVs)
  | 'ableton_adv'  // Ableton Sampler / Simpler (.adv GZIP XML + Samples/Imported/ packaged as .adv.zip)
  | 'exs24'        // Apple Logic EXS24 / Sampler (.exs binary + Samples/ packaged as .exs.zip)
  | 'tal_sampler'  // TAL-Sampler (.talsmpl XML + Samples/ packaged as .talsmpl.zip)
  | 'tx16wx'       // CWITEC TX16Wx (.txprog XML + Samples/ packaged as .txprog.zip)
  | 'korg_kmp'     // Korg Trinity/Triton/M3/Pa (.KMP + .KSF + .KSC packaged as .kmp.zip)
  | 'dls'          // MMA Downloadable Sounds Level 1/2 (.dls RIFF "DLS " monolithic)
  | 'akai_disk'    // Akai S-Series SCSI/Floppy/Gotek disk image (.iso, .img, .dsk)
  | 'emu_disk'     // E-mu Emulator III / EOS disk image (.iso, .img, .hda, .e4b, .esi)
  | 'roland_disk'  // Roland S-7xx / S-5xx sampler disk image (.iso, .img, .out)
  | 'ensoniq_disk' // Ensoniq EPS/ASR sampler disk image (.img, .dsk, .efe, .ede)
  | 'yamaha_disk'  // Yamaha A3000/A4000/A5000 SFS disk image (.iso, .img, .hda)
  | 'music1010'    // 1010music Blackbox / Tangerine (preset.xml + samples in .zip)
  | 'deluge'       // Synthstrom Deluge (SYNTHS/*.XML + SAMPLES/ in .zip)
  | 'renoise'      // Renoise Instrument (.xrni ZIP with Instrument.xml + FLAC SampleData/)
  | 'bliss'        // discoDSP Bliss (.zbp ZIP with program.xml + FLAC samples)
  | 'polyend_pti'  // Polyend Tracker / Play (.pti standalone binary)
  | 'sample_chain';// Linear sample chain (.wav with RIFF cue markers + slice index)

export type RawAudioResolution = 'original' | 'pcm16' | 'pcm24';
export type RawSampleRate = 'original' | 44100 | 48000 | 96000;
export type RawNormalization = 'none' | '0db' | 'minus_0_3db';
export type RawPackagingLayout = 'monolithic' | 'folder_samples';

export interface RawExportOptions {
  format: RawSamplerFormat;
  resolution: RawAudioResolution;
  sampleRate: RawSampleRate;
  normalization: RawNormalization;
  layout: RawPackagingLayout;
  bankName?: string;
  author?: string;
  vendor?: string;
  license?: string;
  description?: string;
  /** For sample chain: gap in samples between slices */
  chainGapSamples?: number;
}

export type PreflightSeverity = 'info' | 'warning' | 'incompatibility';

export type PreflightCategory =
  | 'bit_depth'
  | 'velocity_layers'
  | 'sample_rate'
  | 'envelope'
  | 'channels'
  | 'loop'
  | 'missing_audio'
  | 'coverage';

export interface PreflightIssue {
  id: string;
  category: PreflightCategory;
  severity: PreflightSeverity;
  title: string;
  description: string;
  adaptation: string;
  affectedCount: number;
}

export interface RawSamplerPreflightReport {
  targetFormat: RawSamplerFormat;
  formatTitle: string;
  formatDescription: string;
  totalRegions: number;
  totalSamples: number;
  canExport: boolean;
  issues: PreflightIssue[];
  summary: {
    infoCount: number;
    warningCount: number;
    incompatibilityCount: number;
  };
}

/** Uniform intermediate region representation extracted from either classic zones or extended regions */
export interface UniformSamplerRegion {
  id: string;
  sampleName: string;
  lowKey: MidiNote;
  highKey: MidiNote;
  rootKey: MidiNote;
  lowVel: number;
  highVel: number;
  detuneCents: number;
  volumeDb: number;
  pan: number; // -50..+50
  pitchKeytrack: number; // 0..100%
  loopMode: LoopMode;
  loopStart: number;
  loopEnd: number;
  loopCrossfadeMs: number;
  crossfadeCurve?: CrossfadeCurve;
  keyFadeIn?: number;
  keyFadeOut?: number;
  velFadeIn?: number;
  velFadeOut?: number;
  loops?: SampleLoopDescriptor[];
  ampEnvelope?: Partial<DahdsrEnvelope>;
  filterConfig?: Partial<RegionFilterConfig>;
  pitchEnvelope?: Partial<PitchEnvelopeConfig>;
  trigger?: TriggerMode;
  playLogic?: SamplerPlayLogic;
  seqPosition?: number;
  seqLength?: number;
  sampleStartFrame?: number;
  sampleEndFrame?: number;
  reversed?: boolean;
  groupId?: string;
  groupName?: string;
  muteGroup?: number;
  keyswitchNote?: MidiNote;
  velToVolumeDepth?: number;
  velToPitchCents?: number;
}

export interface RawExportResult {
  filename: string;
  mimeType: string;
  data: Uint8Array;
  report: RawSamplerPreflightReport;
  stats: {
    totalFiles: number;
    totalBytes: number;
    totalDurationSec: number;
  };
}
