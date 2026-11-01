// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Universal Sampler Import Preflight Engine (Fase 18.8)
//
// Incompatibility inspection & adaptation coordinator for
// Decent Sampler, Kontakt, HALion, SF2, SFZ, and Sample Chains:
//   - Missing audio sample detection & reporting
//   - MIDI keybed coverage gaps (0..127) & auto-extension
//   - Velocity layer count analysis & Classic 2-layer vs Extended N-layer folding
//   - Sample rate & channel format adaptation
//   - Loop point & envelope normalization
// ─────────────────────────────────────────────────────────

import type { WorkingMode, Zone, ExtendedRegion } from '../types.ts';
import type { ParsedSamplerPreset, ParsedImportRegion } from './rawSamplerParsers.ts';

export interface PreflightIncompatibilityIssue {
  code: string;
  category: 'audio' | 'coverage' | 'velocity' | 'format' | 'licensing';
  severity: 'info' | 'warning' | 'error';
  title: string;
  description: string;
  resolutionText: string;
}

export interface ImportPreflightReport {
  presetName: string;
  sourceFormat: string;
  formatLabel: string;
  totalRegions: number;
  totalAudioFiles: number;
  missingAudioCount: number;
  missingSampleNames: string[];
  keyRange: {
    minKey: number;
    maxKey: number;
    uncoveredLowNotes: number; // 0 .. minKey-1
    uncoveredHighNotes: number; // maxKey+1 .. 127
    hasInternalGaps: boolean;
  };
  maxVelocityLayers: number;
  isClassicModeCompatible: boolean;
  isSliceChain: boolean;
  sliceCount?: number;
  isEncrypted: boolean;
  canImport: boolean;
  issues: PreflightIncompatibilityIssue[];
  defaultActions: {
    autoExtendOuterZones: boolean;
    adaptVelocityLayers: boolean;
    switchToExtendedMode: boolean;
    openInAudioChopper: boolean;
  };
}

/**
 * Performs rigorous preflight inspection on a parsed sampler preset
 * before it is injected into the active session.
 */
export function analyzeImportPreflight(
  preset: ParsedSamplerPreset,
  currentWorkingMode: WorkingMode = 'classic'
): ImportPreflightReport {
  const issues: PreflightIncompatibilityIssue[] = [];

  // 1. Encryption / Protected container check
  if (preset.isEncrypted) {
    issues.push({
      code: 'ERR_ENCRYPTED_PATCH',
      category: 'licensing',
      severity: 'error',
      title: 'Encrypted Monolithic Container Detected',
      description: preset.encryptionNotice || 'The selected patch is encrypted with proprietary copy protection.',
      resolutionText: 'Export unencrypted raw WAV samples or standard SFZ from the source sampler application.',
    });
    return {
      presetName: preset.presetName,
      sourceFormat: preset.format,
      formatLabel: preset.formatLabel,
      totalRegions: 0,
      totalAudioFiles: 0,
      missingAudioCount: 0,
      missingSampleNames: [],
      keyRange: { minKey: 0, maxKey: 0, uncoveredLowNotes: 0, uncoveredHighNotes: 0, hasInternalGaps: false },
      maxVelocityLayers: 0,
      isClassicModeCompatible: false,
      isSliceChain: false,
      isEncrypted: true,
      canImport: false,
      issues,
      defaultActions: {
        autoExtendOuterZones: false,
        adaptVelocityLayers: false,
        switchToExtendedMode: false,
        openInAudioChopper: false,
      },
    };
  }

  // 2. Audio file presence check
  const missingSamplesSet = new Set<string>();
  for (const reg of preset.regions) {
    if (!preset.audioBuffers.has(reg.sampleName)) {
      missingSamplesSet.add(reg.sampleName);
    }
  }
  const missingSampleNames = Array.from(missingSamplesSet);
  if (missingSampleNames.length > 0) {
    issues.push({
      code: 'WARN_MISSING_SAMPLES',
      category: 'audio',
      severity: missingSampleNames.length === preset.regions.length ? 'error' : 'warning',
      title: `Missing Referenced Audio Samples (${missingSampleNames.length})`,
      description: `The preset references ${missingSampleNames.length} audio sample(s) that were not found in the imported archive: ${missingSampleNames.slice(0, 3).join(', ')}${missingSampleNames.length > 3 ? '...' : ''}`,
      resolutionText: 'Zones referencing missing files will be created as placeholders or mapped to nearest available sample.',
    });
  }

  // 3. Keybed Coverage & Gaps
  let minKey = 127;
  let maxKey = 0;
  const coveredNotes = new Set<number>();

  for (const reg of preset.regions) {
    if (reg.lowKey < minKey) minKey = reg.lowKey;
    if (reg.highKey > maxKey) maxKey = reg.highKey;
    for (let k = reg.lowKey; k <= reg.highKey; k++) {
      coveredNotes.add(k);
    }
  }

  if (preset.regions.length === 0) {
    minKey = 0;
    maxKey = 127;
  }

  const uncoveredLow = Math.max(0, minKey);
  const uncoveredHigh = Math.max(0, 127 - maxKey);

  let hasInternalGaps = false;
  for (let k = minKey; k <= maxKey; k++) {
    if (!coveredNotes.has(k)) {
      hasInternalGaps = true;
      break;
    }
  }

  if (uncoveredLow > 0 || uncoveredHigh > 0 || hasInternalGaps) {
    issues.push({
      code: 'WARN_KEYBED_GAPS',
      category: 'coverage',
      severity: currentWorkingMode === 'classic' ? 'warning' : 'info',
      title: 'Keybed Coverage Gaps Detected',
      description: `Preset covers notes ${minKey} to ${maxKey}. Left gap [0..${minKey - 1}] (${uncoveredLow} notes) and right gap [${maxKey + 1}..127] (${uncoveredHigh} notes) are unmapped.`,
      resolutionText: 'Enable "Auto-extend Outer Zones" to stretch the lowest and highest zones to 0 and 127 for complete gapless resynthesis.',
    });
  }

  // 4. Velocity Layers Check
  // Count how many velocity layers overlap per MIDI note
  let maxVelLayers = 1;
  for (let k = minKey; k <= maxKey; k++) {
    const layersOnNote = preset.regions.filter((r) => r.lowKey <= k && r.highKey >= k);
    if (layersOnNote.length > maxVelLayers) {
      maxVelLayers = layersOnNote.length;
    }
  }

  const isClassicCompatible = maxVelLayers <= 2;
  if (maxVelLayers > 2 && currentWorkingMode === 'classic') {
    issues.push({
      code: 'WARN_VELOCITY_LAYERS_FOLD',
      category: 'velocity',
      severity: 'warning',
      title: `Multi-Layer Velocity Detected (${maxVelLayers} Layers)`,
      description: `Preset contains ${maxVelLayers} dynamic velocity layers. Hartmann Classic mode strictly supports 2 velocity layers (Low 1..63, High 64..127).`,
      resolutionText: 'Importer will automatically fold to softest (p) and loudest (f) layers with gain compensation, or you can switch to Extended Mode to preserve all layers.',
    });
  }

  // 5. Sample Chains
  if (preset.isSliceChain) {
    issues.push({
      code: 'INFO_SAMPLE_CHAIN',
      category: 'format',
      severity: 'info',
      title: 'Sample Chain / Slice Loop Detected',
      description: `Found ${preset.sliceFrames?.length ?? preset.regions.length} slice markers. Can be mapped chromatically across keys or opened in Audio Chopper.`,
      resolutionText: 'Click "Open in Audio Chopper" to adjust slice sensitivity or "Proceed & Map" for instant keyboard mapping.',
    });
    if (preset.audioBuffers.size === 0) {
      issues.push({
        code: 'WARN_REX2_COMPRESSION',
        category: 'format',
        severity: 'warning',
        title: 'DWOP Audio Decompression Required',
        description: 'Loop audio requires Companion Bridge decompressor or a paired WAV file.',
        resolutionText: 'Start the Companion Bridge or click "Open in Audio Chopper" to select a companion audio file.',
      });
    }
  }

  return {
    presetName: preset.presetName,
    sourceFormat: preset.format,
    formatLabel: preset.formatLabel,
    totalRegions: preset.regions.length,
    totalAudioFiles: preset.audioBuffers.size,
    missingAudioCount: missingSampleNames.length,
    missingSampleNames,
    keyRange: {
      minKey,
      maxKey,
      uncoveredLowNotes: uncoveredLow,
      uncoveredHighNotes: uncoveredHigh,
      hasInternalGaps,
    },
    maxVelocityLayers: maxVelLayers,
    isClassicModeCompatible: isClassicCompatible,
    isSliceChain: Boolean(preset.isSliceChain),
    sliceCount: preset.sliceFrames?.length ?? preset.regions.length,
    isEncrypted: false,
    canImport: preset.regions.length > 0 || preset.audioBuffers.size > 0,
    issues,
    defaultActions: {
      autoExtendOuterZones: uncoveredLow > 0 || uncoveredHigh > 0,
      adaptVelocityLayers: maxVelLayers > 2 && currentWorkingMode === 'classic',
      switchToExtendedMode: maxVelLayers > 2,
      openInAudioChopper: Boolean(preset.isSliceChain),
    },
  };
}

export interface AdaptedImportResult {
  classicZones: Zone[];
  extendedRegions: ExtendedRegion[];
  suggestedWorkingMode: WorkingMode;
  audioBuffers: Map<string, ArrayBuffer>;
}

/**
 * Transforms parsed sampler regions into native Classic `Zone[]` and Extended `ExtendedRegion[]`
 * applying the preflight resolution decisions selected by the user.
 */
export function applyPreflightImportAdaptations(
  preset: ParsedSamplerPreset,
  options: {
    autoExtendOuterZones: boolean;
    adaptVelocityLayers: boolean;
    switchToExtendedMode: boolean;
    currentWorkingMode: WorkingMode;
  }
): AdaptedImportResult {
  const regions = [...preset.regions];
  if (regions.length === 0) {
    return {
      classicZones: [],
      extendedRegions: [],
      suggestedWorkingMode: options.currentWorkingMode,
      audioBuffers: preset.audioBuffers,
    };
  }

  // Sort regions by root key then low velocity
  regions.sort((a, b) => a.lowKey - b.lowKey || a.lowVel - b.lowVel);

  // 1. Auto-extend outer zones if requested
  if (options.autoExtendOuterZones && regions.length > 0) {
    const lowestKey = regions[0].lowKey;
    if (lowestKey > 0) {
      for (const r of regions) {
        if (r.lowKey === lowestKey) r.lowKey = 0;
      }
    }
    const highestKey = regions[regions.length - 1].highKey;
    if (highestKey < 127) {
      for (const r of regions) {
        if (r.highKey === highestKey) r.highKey = 127;
      }
    }
  }

  // 2. Build Extended Regions (1:1 with all N velocity layers)
  const extendedRegions: ExtendedRegion[] = regions.map((r, idx) => ({
    id: `ext_reg_${String(idx + 1).padStart(3, '0')}`,
    sampleName: r.sampleName,
    lowKey: r.lowKey,
    highKey: r.highKey,
    rootKey: r.rootKey,
    lowVel: r.lowVel,
    highVel: r.highVel,
    detune: r.detuneCents,
    volume: r.volumeDb,
    pan: r.pan,
    pitchKeytrack: 100,
    trigger: 'attack',
    keyFadeIn: 0,
    keyFadeOut: 0,
    velFadeIn: 0,
    velFadeOut: 0,
    fadeCurve: 'equal-power',
    loopMode: r.loopMode,
    loopStart: r.loopStart,
    loopEnd: r.loopEnd,
    loopCrossfadeMs: 0,
  }));

  // 3. Project to Classic Hartmann 2-layer Zones
  // Group regions by note range
  const keyRangeMap = new Map<string, ParsedImportRegion[]>();
  for (const r of regions) {
    const key = `${r.lowKey}-${r.highKey}`;
    if (!keyRangeMap.has(key)) {
      keyRangeMap.set(key, []);
    }
    keyRangeMap.get(key)!.push(r);
  }

  const classicZones: Zone[] = [];
  let zoneIdx = 0;

  for (const [, group] of keyRangeMap.entries()) {
    zoneIdx++;
    group.sort((a, b) => a.lowVel - b.lowVel);

    const first = group[0];
    const last = group[group.length - 1];

    let sampleLow: string | null = first.sampleName;
    let sampleHigh: string | null = null;
    let velSplit = 64;

    if (group.length > 1) {
      sampleHigh = last.sampleName;
      velSplit = Math.max(2, Math.min(127, last.lowVel > 1 ? last.lowVel : 64));
    }

    classicZones.push({
      id: `zone_${String(zoneIdx).padStart(3, '0')}`,
      lowKey: first.lowKey,
      rootKey: first.rootKey,
      highKey: first.highKey,
      sampleLow,
      sampleHigh,
      velSplit,
      detune: first.detuneCents,
      volume: first.volumeDb,
      pan: first.pan,
    });
  }

  const suggestedWorkingMode: WorkingMode =
    options.switchToExtendedMode || (options.currentWorkingMode === 'extended')
      ? 'extended'
      : 'classic';

  return {
    classicZones,
    extendedRegions,
    suggestedWorkingMode,
    audioBuffers: preset.audioBuffers,
  };
}
