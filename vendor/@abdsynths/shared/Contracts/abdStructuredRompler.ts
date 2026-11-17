/**
 * @abdsynths/contracts — Contracts/abdStructuredRompler.ts
 * ============================================================================
 * Canonical Structured Rompler & De-Baked Soundbank Contract (v1.0.0)
 * Shared SSOT between ABDNeuModMakr (packager/de-baker) and ABDMCX0X (engine).
 */

export const ABD_STRUCTURED_ROMPLER_CONTRACT_VERSION = '1.0.0';
export const ABD_STRUCTURED_ROMPLER_FORMAT_ID = 'abd_structured_rompler';

export type McxWaveSourceKind =
  | 'spectral_ddsp'
  | 'pcm_zone'
  | 'va_osc'
  | 'fm_2op'
  | 'axionik_surface_ref';

export type McxPlayMode = 'oneshot' | 'forward' | 'pingpong';

import type { DrumMapMode, DrumNoteRemapper, DrumTriggerMode } from './abdDrumMapProfiles.ts';

export type McxFilterModel =
  | 'svf_clean'
  | 'roland_tvf_zdf'
  | 'ms20_acid'
  | 'ladder_drive'
  | 'zplane_morph'
  | 'roland_tc6116_tvf';

export type McxOutputCharacter = 'hd_studio' | 'rompler_16bit_32k' | 'sampler_12bit';

export type McxStructureMode =
  | 'parallel'
  | 'roland_struct_1'
  | 'roland_struct_2'
  | 'roland_struct_3'
  | 'roland_struct_4'
  | 'roland_struct_5'
  | 'roland_struct_6'
  | 'roland_struct_7'
  | 'roland_struct_8'
  | 'roland_struct_9'
  | 'roland_struct_10'
  | 'vector_2d';

export interface McxEnv4T4L {
  t1Ms: number;
  t2Ms: number;
  t3Ms: number;
  t4Ms: number;
  l0?: number;
  l1: number;
  l2: number;
  l3: number;
  l4?: number;
}

export interface McxDeBakeProvenance {
  ipCleanResynthesis: boolean;
  referenceHardwareId?: string;
  barkResidualBands?: number;
  harmonicPartials?: number;
  captureTool?: 'ABDNeuModMakr' | 'ABDAudioLab' | 'CleanVA';
}

export interface McxWaveDescriptor {
  id: string;
  name: string;
  sourceKind: McxWaveSourceKind;
  stereo?: boolean;
  assetUriLeft?: string;
  assetUriRight?: string;
  playMode?: McxPlayMode;
  rootKey?: number;
  fineTuneCents?: number;
  loopTuneCents?: number;
  altStartOffsetFrames?: number;
  loopStartFrame?: number;
  loopEndFrame?: number;
  deBakeProvenance?: McxDeBakeProvenance;
}

export interface McxPartialConfig {
  slot: 1 | 2 | 3 | 4;
  enabled: boolean;
  sourceKind: McxWaveSourceKind;
  waveId?: string;
  vaShape?: 'saw' | 'pulse' | 'tri' | 'sine' | 'supersaw' | 'noise';
  coarseSemitones?: number;
  fineCents?: number;
  levelDb?: number;
  pan?: number;
  velLo?: number;
  velHi?: number;
  fadeLo?: number;
  fadeHi?: number;
  filterModel?: McxFilterModel;
  filterType?: 'lpf12' | 'lpf24' | 'bpf' | 'hpf' | 'morph';
  cutoffHz?: number;
  resonance?: number;
  zplaneMorph?: number;
  drive?: number;
  pitchEnv4T4L?: McxEnv4T4L;
  filterEnv4T4L?: McxEnv4T4L;
  ampEnv4T4L?: McxEnv4T4L;
}

export interface McxTonePatch {
  id: string;
  name: string;
  category?: string;
  structureMode: McxStructureMode;
  outputCharacter?: McxOutputCharacter;
  partials: McxPartialConfig[];
  vectorEnvelope?: Array<{ x: number; y: number; timeMs: number }>;
  patchCords?: Array<{ source: string; destination: string; amount: number }>;
}

export interface McxDrumKeySlot {
  midiNote: number;
  name: string;
  toneId?: string;
  muteGroup?: number;
  coarseKey?: number;
  level?: number;
  pan?: number;
  reverbSend?: number;
  chorusSend?: number;
  drive?: number;
  cutoffHzOverride?: number;
  resonanceOverride?: number;
  decayScaleOverride?: number;
  triggerMode?: DrumTriggerMode;
  pitchKeyTrack?: boolean;
}

export interface McxDrumKitPatch {
  id: string;
  name: string;
  drumMapMode?: DrumMapMode;
  remapper?: DrumNoteRemapper;
  slots: McxDrumKeySlot[];
}

export interface AbdStructuredRomplerBank {
  schemaVersion: '1.0.0';
  formatId: 'abd_structured_rompler';
  bankName: string;
  author?: string;
  targetHardwareFamily?: string;
  wavePool: McxWaveDescriptor[];
  tones: McxTonePatch[];
  drumKits?: McxDrumKitPatch[];
}

export function validateStructuredRomplerBank(input: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') return { valid: false, errors: ['Bank payload must be an object'] };
  const bank = input as Record<string, unknown>;
  if (bank.schemaVersion !== ABD_STRUCTURED_ROMPLER_CONTRACT_VERSION) errors.push('Unsupported schemaVersion');
  if (bank.formatId !== ABD_STRUCTURED_ROMPLER_FORMAT_ID) errors.push('Invalid formatId');
  if (typeof bank.bankName !== 'string' || bank.bankName.length === 0) errors.push('Missing bankName');
  if (!Array.isArray(bank.wavePool)) errors.push('Missing wavePool array');
  if (!Array.isArray(bank.tones)) errors.push('Missing tones array');
  return { valid: errors.length === 0, errors };
}
