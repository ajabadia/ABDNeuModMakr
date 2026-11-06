// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Model & Sample Import Service (ingesta)
//
// Pure ingestion logic extracted verbatim from `WebAudioPipeline`
// (P refactor: archivos >3000 líneas). The pipeline keeps ownership
// of mutable state (session, buffers, binaries, bank, asset store)
// and exposes it through `ModelImportHost`; this module only
// orchestrates parsing, zone computation and capsule recording.
//
// Public API of `WebAudioPipeline` is unchanged: callers and tests
// keep using `importAudioFiles` / `importModelFiles` /
// `importSamplesFromFolder` on the pipeline.
// ─────────────────────────────────────────────────────────

import type {
  BankSummary,
  CommonPlaybackDefaults,
  CoreEvent,
  GeneratedModel,
  MasterWaveConfig,
  MidiNote,
  ModelCoverArtwork,
  Session,
  Zone,
  ZoneAnalysisSummary,
} from '../types.ts';
import { createZone } from '../sessionFactory.ts';
import { sanitizeImportedProcessConfig } from '../sessionSchema.ts';
import {
  DEFAULT_MODEL_NAMES,
  deriveModelNameFromSample,
  parseSampleFilenameByName,
} from '../sampleNaming.ts';
import {
  cloneArticulation,
  syncExtendedRegionsFromClassicZones,
} from '../extendedAdapter.ts';
import {
  convertLegacyModelToModern,
  parseModelFileSet,
  resynthesizeNeuronModelSource,
} from '@abdsynths/shared/formats/neuron';
import {
  analyzeSingleZone,
  type PreservedSourceBinary,
  type ZoneBinaryPair,
} from '../dsp/PipelineRunner.ts';
import {
  encodePcm16Wav,
  midiNoteToHz,
  synthesizeDemoWav,
  type DecodedWav,
} from '../dsp/WavDecoder.ts';
import { NEURON_SAMPLE_RATE } from '../dsp/ScapeSphereGenerator.ts';
import {
  buildTimeCapsuleEntries,
  extractTimeCapsuleFromFiles,
} from '../timeCapsule.ts';
import type { BankService } from '../bankService.ts';
import type { NeuronAssetStore } from '../storage/NeuronAssetStore.ts';
import type { SpectralAnalyzer } from '../dsp/SpectralAnalyzer.ts';
import { yieldToUI } from '../asyncUtils.ts';

/**
 * P0.3 import guardrails: a single decoded sample is fully buffered in
 * memory (`decodeWav`), so cap per-file size; cap file count at the
 * maximum meaningful zone count (one single-note zone per MIDI key).
 * Re-exported as `WebAudioPipeline.MAX_IMPORT_*` for compatibility.
 */
export const MAX_IMPORT_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_IMPORT_FILES = 128;

/** Mutable pipeline state exposed to the import service (cf. `BankContext`). */
export interface AudioImportHost {
  getSession(): Session | null;
  ensureSession(name: string): Promise<Session>;
  pushHistory(label: string): void;
  markDirty(): void;
  registerSampleBuffer(
    sampleName: string,
    wavBuffer: ArrayBuffer,
    options?: {
      isPromotedEnhanced?: boolean;
      rawSourceName?: string;
      isResynthesizedFromLegacy?: boolean;
    }
  ): DecodedWav;
  detectPitch(channel: Float32Array, sampleRate: number): number;
  ensureZoneDemoBuffers(zones: Zone[]): void;
}

export interface ModelImportHost extends AudioImportHost {
  getSampleBuffer(name: string): ArrayBuffer | undefined;
  setSampleBuffer(name: string, buffer: ArrayBuffer): void;
  hasSampleBuffer(name: string): boolean;
  getAnalyzer(): SpectralAnalyzer;
  getAssetStore(): NeuronAssetStore;
  getBank(): BankService;
  getImportedBinaries(): Map<string, PreservedSourceBinary & { complexity: number }>;
  persist(): void;
  emit(event: CoreEvent): void;
  loadBank(): Promise<BankSummary>;
}

export async function importSamplesFromFolder(
  host: AudioImportHost,
  _folderPath: string
): Promise<Zone[]> {
  let session = host.getSession();
  if (!session) session = await host.ensureSession('Imported Multisample');
  host.pushHistory('Import Samples Folder');
  session.zones = [
    createZone(0, 24, 35, 'Bass_24_C1.wav'),
    createZone(36, 60, 71, 'Piano_60_C4.wav'),
    createZone(72, 84, 95, 'Strings_84_C6.wav'),
    createZone(96, 108, 127, 'Pad_108_C8.wav'),
  ];
  host.ensureZoneDemoBuffers(session.zones);
  host.markDirty();
  return session.zones;
}

/**
 * Imports real binary WAV / AIFF files selected via File Picker or Drag & Drop.
 *
 * Supports both original MODELmaker v1.2 workflows:
 * - `mode === 'samples'` (`Ctrl-I` / Import Samples): reads AIFF `INST` / WAV `smpl`
 *   embedded metadata (`rootKey`, `lowKey`, `lowVelocity < 64` vs `>= 64`, `detune`),
 *   with fallback to pitch detection (`detectPitch`) or filename parsing.
 * - `mode === 'by-name'` (`Ctrl-N` / Import by Name): ignores embedded `INST` metadata
 *   and parses `name_rootkey_lowkey[_v1|_v2]` / `name-Note[_high]` per `KeyZoneData.class`,
 *   merges `v1` (Low Velocity) and `v2` (High Velocity) layers sharing the same `lowKey`,
 *   sorts ascending by `lowKey`, sets `zone[i].highKey = zone[i+1].lowKey - 1`,
 *   `zone[0].lowKey = 0`, and `zone[last].highKey = 127`.
 */
export async function importAudioFiles(
  host: AudioImportHost,
  files: { name: string; buffer: ArrayBuffer }[],
  mode: 'samples' | 'by-name' = 'samples'
): Promise<Zone[]> {
  // Filter out macOS AppleDouble resource forks (._* / __MACOSX) and tiny non-audio stubs
  const candidateFiles = files.filter((f) => {
    const normalized = f.name.replace(/\\/g, '/');
    if (normalized.includes('__MACOSX/')) return false;
    const base = normalized.split('/').pop() ?? normalized;
    if (base.startsWith('.') || base.startsWith('._')) return false;
    return f.buffer && f.buffer.byteLength >= 44;
  });

  let session = host.getSession();
  if (candidateFiles.length === 0) return session?.zones ?? [];
  // P0.3: bound memory and zone count before decoding anything.
  if (candidateFiles.length > MAX_IMPORT_FILES) {
    throw new Error(
      `Too many files for import (${candidateFiles.length}, max ${MAX_IMPORT_FILES})`
    );
  }
  const oversizedNames = candidateFiles
    .filter((f) => f.buffer.byteLength > MAX_IMPORT_FILE_BYTES)
    .map((f) => f.name);
  if (oversizedNames.length === candidateFiles.length) {
    throw new Error(
      `All ${candidateFiles.length} file(s) exceed the ${MAX_IMPORT_FILE_BYTES / (1024 * 1024)} MB per-file import limit: ${oversizedNames.slice(0, 3).join(', ')}${oversizedNames.length > 3 ? ', …' : ''}`
    );
  }
  if (!session) session = await host.ensureSession('Imported Multisample');

  interface ParsedSampleItem {
    name: string;
    rootKey: MidiNote;
    lowKey: MidiNote | null;
    isHighVelocity: boolean;
    detune: number;
  }

  const items: ParsedSampleItem[] = [];
  const skippedNames: string[] = [...oversizedNames];
  for (let fileIdx = 0; fileIdx < candidateFiles.length; fileIdx++) {
    const f = candidateFiles[fileIdx];
    if (fileIdx > 0 && fileIdx % 4 === 0) {
      await yieldToUI(0);
    }
    if (f.buffer.byteLength > MAX_IMPORT_FILE_BYTES) {
      // Skip without decoding: fully buffered in memory by decodeWav
      continue;
    }
    let decoded: DecodedWav;
    try {
      decoded = host.registerSampleBuffer(f.name, f.buffer);
    } catch {
      // Skip invalid/corrupt or non-audio files in folder imports
      skippedNames.push(f.name);
      continue;
    }

    const baseName = (f.name.split(/[\\/]/).pop() ?? f.name);
    const byName = parseSampleFilenameByName(baseName, -1 as MidiNote);
    // Only assign High Velocity (64..127) when deduced from the filename (_v2, _high, etc.)
    const isHighVelocity = byName.isHighVelocity;

    if (mode === 'by-name') {
      const rk = byName.rootKey >= 0 && byName.rootKey <= 127 ? byName.rootKey : 60;
      const lk = byName.lowKey >= 0 && byName.lowKey <= 127 ? byName.lowKey : rk;
      items.push({
        name: baseName,
        rootKey: rk,
        lowKey: lk,
        isHighVelocity,
        detune: 0,
      });
      continue;
    }

    const inst = decoded.instrument;
    let rootKey: MidiNote;
    if (byName.rootKey >= 0 && byName.rootKey <= 127) {
      rootKey = byName.rootKey;
    } else if (inst && inst.rootKey >= 0 && inst.rootKey <= 127) {
      rootKey = inst.rootKey;
    } else {
      await yieldToUI(0);
      const detectedHz = host.detectPitch(
        decoded.channels[0],
        decoded.sampleRate
      );
      rootKey =
        detectedHz > 20
          ? Math.max(
              0,
              Math.min(127, Math.round(69 + 12 * Math.log2(detectedHz / 440)))
            )
          : 60;
    }

    const hasExplicitNameLowKey =
      byName.lowKey >= 0 &&
      byName.lowKey <= 127 &&
      byName.lowKey !== byName.rootKey;
    const hasExplicitInstLowKey =
      inst !== undefined &&
      inst.lowKey >= 0 &&
      inst.lowKey <= 127 &&
      !(inst.lowKey === 0 && inst.highKey === 127 && candidateFiles.length > 1);

    const lowKey = hasExplicitNameLowKey
      ? byName.lowKey
      : hasExplicitInstLowKey
        ? inst!.lowKey
        : null;

    items.push({
      name: baseName,
      rootKey,
      lowKey,
      isHighVelocity,
      detune: inst?.detune ?? 0,
    });
  }

  if (items.length === 0) {
    const skipped = skippedNames.length > 0 ? ` Skipped: ${skippedNames.slice(0, 3).join(', ')}${skippedNames.length > 3 ? ', …' : ''}.` : '';
    throw new Error(`No valid WAV or AIFF audio files could be decoded.${skipped}`);
  }

  host.pushHistory(`Import ${items.length} Sample(s)`);

  items.sort((a, b) => {
    const keyA = a.lowKey ?? a.rootKey;
    const keyB = b.lowKey ?? b.rootKey;
    if (keyA !== keyB) return keyA - keyB;
    if (a.rootKey !== b.rootKey) return a.rootKey - b.rootKey;
    return (a.isHighVelocity ? 1 : 0) - (b.isHighVelocity ? 1 : 0);
  });

  // Only merge two samples into the same zone (Low Vel + High Vel) when they share the same key
  // AND one of them is explicitly marked as High Velocity in its filename (_v2, _high, etc.).
  const grouped: {
    rootKey: MidiNote;
    lowKey: MidiNote | null;
    sampleLow: string | null;
    sampleHigh: string | null;
    velSplit: number;
    detune: number;
  }[] = [];

  for (const item of items) {
    const itemKey = item.lowKey ?? item.rootKey;
    const match = grouped.find((g) => {
      const gKey = g.lowKey ?? g.rootKey;
      if (gKey !== itemKey) return false;
      return item.isHighVelocity ? g.sampleHigh === null : g.sampleLow === null;
    });

    if (match && (item.isHighVelocity || match.sampleLow === null)) {
      if (item.isHighVelocity) {
        match.sampleHigh = item.name;
      } else {
        match.sampleLow = item.name;
      }
    } else {
      grouped.push({
        rootKey: item.rootKey,
        lowKey: item.lowKey,
        sampleLow: item.isHighVelocity ? null : item.name,
        sampleHigh: item.isHighVelocity ? item.name : null,
        velSplit: 64,
        detune: item.detune,
      });
    }
  }

  // Ensure every zone has a primary sampleLow (if a lone _v2 file had no _v1 pair, promote it to sampleLow)
  for (const g of grouped) {
    if (!g.sampleLow && g.sampleHigh) {
      g.sampleLow = g.sampleHigh;
      g.sampleHigh = null;
    }
  }

  // Compute strictly monotonic lowKeys first, then set highKey[i] = lowKey[i+1] - 1
  const n = grouped.length;
  const computedLowKeys: MidiNote[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      computedLowKeys[i] = 0;
    } else {
      const prev = grouped[i - 1];
      const curr = grouped[i];
      const rawLow =
        curr.lowKey !== null
          ? curr.lowKey
          : Math.floor((prev.rootKey + curr.rootKey) / 2) + 1;
      const minAllowed = computedLowKeys[i - 1] + 1;
      const maxAllowed = 128 - (n - i);
      computedLowKeys[i] = Math.max(minAllowed, Math.min(maxAllowed, rawLow));
    }
  }

  const newZones: Zone[] = [];
  for (let i = 0; i < n; i++) {
    const curr = grouped[i];
    const lowKey = computedLowKeys[i];
    const highKey = i === n - 1 ? 127 : computedLowKeys[i + 1] - 1;
    const rootKey = Math.max(lowKey, Math.min(highKey, curr.rootKey));

    const zone = createZone(lowKey, rootKey, highKey, curr.sampleLow);
    zone.sampleHigh = curr.sampleHigh;
    zone.velSplit = curr.velSplit;
    zone.detune = curr.detune;
    newZones.push(zone);
  }

  session.zones = newZones;
  session.extendedRegions = syncExtendedRegionsFromClassicZones(
    newZones
  );
  if (newZones[0]?.sampleLow) {
    maybeAutoDeriveModelName(session, newZones[0].sampleLow);
  }
  host.markDirty();
  return newZones;
}

export function maybeAutoDeriveModelName(session: Session, sampleFilename: string): void {
  const current = session.processConfig.modelName.trim();
  if (!DEFAULT_MODEL_NAMES.has(current)) return;
  const maxLen =
    session.processConfig.targetFormat === 'modern-neural' ? 32 : 11;
  const derived = deriveModelNameFromSample(sampleFilename, maxLen);
  if (derived) {
    session.processConfig.modelName = derived;
    const baseClean = sampleFilename.replace(/\.[^/.]+$/, '').trim();
    session.processConfig.expandedName = baseClean || derived;
    if (DEFAULT_MODEL_NAMES.has(session.name.trim())) {
      session.name = derived;
    }
  }
}

/**
 * Imports a legacy Hartmann `.model` file set (`MName`, `map.script`, `%06d.scape`, `%06d.sphere`),
 * a `.zip` package exported by MODELmaker / NeuronDB, or a `.neuronikmodel` v2.1 JSON file:
 * - Reconstructs the session zones and process configuration
 * - Resynthesizes playable 44.1 kHz PCM16 WAV buffers from `.sphere` / `.scape` frames
 *   so every imported zone can be auditioned and re-analyzed immediately
 * - Registers the model in the Bank and emits `session-changed`, `process-complete`, and `bank-updated`.
 */
export async function importModelFiles(
  host: ModelImportHost,
  files: { name: string; buffer: ArrayBuffer }[]
): Promise<GeneratedModel> {
  if (files.length === 0) {
    throw new Error('No model files provided for import');
  }

  let session = host.getSession();
  const defaultSlot = session?.processConfig.modelNumber ?? 1;
  const byteFiles = files.map((f) => ({
    name: f.name,
    data: new Uint8Array(f.buffer),
  }));
  const extracted = extractTimeCapsuleFromFiles(byteFiles);
  const parseInput =
    extracted.modelParseFiles.length > 0
      ? extracted.modelParseFiles
      : byteFiles;
  const bundle = parseModelFileSet(parseInput, defaultSlot);

  const hasEmbeddedSamples = Boolean(
    (bundle.embeddedSamples && bundle.embeddedSamples.size > 0) ||
      extracted.rawSourceSamples.size > 0 ||
      extracted.enhancedAudioSamples.size > 0
  );
  if (
    bundle.scapes.size === 0 &&
    bundle.spheres.size === 0 &&
    !bundle.neuronikModelJson &&
    !extracted.extendedModelJson &&
    !hasEmbeddedSamples
  ) {
    if (bundle.hasMNameOrMapScript) {
      throw new Error(
        'Only MName or map.script selected without the model .scape and .sphere files.\n\n' +
          '• When using "Import Model Files / .zip", select ALL files inside the <NNN>.model (Ctrl+A: MName, map.script, *.scape, *.sphere) or a .zip file.\n' +
          '• Or use "File -> Import Model Folder (<NNN>.model)..." to open the folder directly.'
      );
    }
    throw new Error(
      'No valid model files (.scape, .sphere, .nmmodel) or audio samples found in the selected files.'
    );
  }

  if (bundle.embeddedSamples) {
    for (const [sName, sBytes] of bundle.embeddedSamples.entries()) {
      const copy = new Uint8Array(sBytes.byteLength);
      copy.set(sBytes);
      try {
        host.registerSampleBuffer(sName, copy.buffer);
      } catch {
        // ignore non-decodable embedded file
      }
    }
  }

  // Hydrate Time Capsule Layer 01 (raw sources) & Layer 03 (enhanced 24b/96k audio)
  for (const [rawName, rawBuf] of extracted.rawSourceSamples.entries()) {
    try {
      host.registerSampleBuffer(rawName, rawBuf);
    } catch {
      // ignore invalid raw buffer
    }
  }
  for (const [enhName, enhBuf] of extracted.enhancedAudioSamples.entries()) {
    try {
      host.registerSampleBuffer(enhName, enhBuf, {
        isPromotedEnhanced: true,
      });
    } catch {
      // ignore invalid enhanced buffer
    }
  }

  if (!session) {
    session = await host.ensureSession(bundle.name);
  } else {
    host.pushHistory(`Import Model "${bundle.name}"`);
  }

  const activeZones =
    bundle.mapScript.activeZones.length > 0
      ? bundle.mapScript.activeZones
      : [createZone(0, 60, 127, '000001.scape')];

  const firstSphere = bundle.spheres.values().next().value;
  const inferredParamSet =
    firstSphere?.header.parameterSet ?? bundle.inferredParameterSet ?? 0;
  const stickModes = firstSphere?.header.stickModes ?? 16;
  const stickTable = [1, 4, 8, 12, 16, 24, 32, 42, 54, 64];
  const complexityIdx = stickTable.findIndex((s) => s >= stickModes);
  const inferredComplexity =
    firstSphere !== undefined
      ? complexityIdx >= 0
        ? complexityIdx + 1
        : 8
      : (bundle.inferredComplexity ?? 8);

  const newZones: Zone[] = [];
  const zonesAnalysis: ZoneAnalysisSummary[] = [];
  const sourceSampleNames = new Map<number, string>();
  const binaryBySampleName = new Map<string, ZoneBinaryPair>();
  const importedBinaries = host.getImportedBinaries();
  const analyzer = host.getAnalyzer();
  const assetStore = host.getAssetStore();

  const buildResynthSourceWav = (
    srcIdx: number,
    zEntry: Zone,
    zoneIndex: number,
    suffix = ''
  ): { sampleName: string; wavBuf: ArrayBuffer } => {
    const explicitCandidate =
      suffix === '' ? zEntry.sampleLow : zEntry.sampleHigh;
    if (
      explicitCandidate &&
      bundle.embeddedSamples?.has(explicitCandidate) &&
      host.hasSampleBuffer(explicitCandidate) &&
      !bundle.spheres.has(srcIdx) &&
      !bundle.scapes.has(srcIdx)
    ) {
      return {
        sampleName: explicitCandidate,
        wavBuf: host.getSampleBuffer(explicitCandidate)!,
      };
    }
    const existingName = sourceSampleNames.get(srcIdx);
    if (existingName && host.hasSampleBuffer(existingName)) {
      return {
        sampleName: existingName,
        wavBuf: host.getSampleBuffer(existingName)!,
      };
    }
    const sampleName = `${bundle.name}_S${String(srcIdx).padStart(2, '0')}_K${String(zEntry.rootKey).padStart(3, '0')}${suffix}.wav`;
    const parsedSphere = bundle.spheres.get(srcIdx);
    const parsedScape = bundle.scapes.get(srcIdx);

    let pcmFloat: Float32Array | null = null;
    if ((parsedSphere && parsedSphere.frames.length > 0) || parsedScape) {
      pcmFloat = resynthesizeNeuronModelSource(parsedSphere, parsedScape, 44100, 0.22);
    }

    const wavBuf = pcmFloat
      ? encodePcm16Wav(pcmFloat, 44100, {
          rootKey: zEntry.rootKey,
          lowKey: zEntry.lowKey,
          highKey: zEntry.highKey,
          detune: zEntry.detune,
        })
      : synthesizeDemoWav('strings', zEntry.rootKey + zoneIndex * 0, 44100, 1.0);

    host.setSampleBuffer(sampleName, wavBuf);
    sourceSampleNames.set(srcIdx, sampleName);
    return { sampleName, wavBuf };
  };

  for (let i = 0; i < activeZones.length; i++) {
    const zEntry = activeZones[i];
    const srcIdx =
      parseInt((zEntry.sampleLow ?? `${i + 1}`).replace(/\D+/g, ''), 10) ||
      i + 1;
    const { sampleName, wavBuf } = buildResynthSourceWav(srcIdx, zEntry, i);

    let highSampleName: string | null = null;
    if (zEntry.sampleHigh) {
      const hiIdx = parseInt(zEntry.sampleHigh.replace(/\D+/g, ''), 10);
      if (!Number.isNaN(hiIdx) && hiIdx > 0 && hiIdx !== srcIdx) {
        highSampleName = buildResynthSourceWav(hiIdx, zEntry, i, '_v2').sampleName;
        const hiScape = bundle.scapeBinaries?.get(hiIdx);
        const hiSphere = bundle.sphereBinaries?.get(hiIdx);
        if (hiScape && hiSphere && !binaryBySampleName.has(highSampleName)) {
          binaryBySampleName.set(highSampleName, {
            scapeBinary: hiScape,
            sphereBinary: hiSphere,
          });
          importedBinaries.set(highSampleName, {
            scapeBinary: hiScape,
            sphereBinary: hiSphere,
            origParameterSet: inferredParamSet,
            complexity: inferredComplexity,
            summary: {
              zoneId: `zone_${i + 1}`,
              lowKey: zEntry.lowKey,
              rootKey: zEntry.rootKey,
              highKey: zEntry.highKey,
              sampleName: highSampleName,
              sampleRate: 44100,
              durationSec: 1.0,
              detectedF0Hz: 440,
              targetF0Hz: 440,
              gridResidualCents: 0,
              gridObservations: 16,
              gridBand: 'green',
              gridNotice: 'Imported .sphere (High Vel preserved)',
              layerCount: 1,
              frameCount: 16,
              activePartials: 64,
              octaveFoldCents: 0,
              biGrid: false,
              amplitudes: new Array<number>(64).fill(0),
              frequencyOffsets: new Array<number>(64).fill(0),
            },
          });
        }
      }
    }

    const rawSphere = bundle.sphereBinaries?.get(srcIdx);
    const rawScape = bundle.scapeBinaries?.get(srcIdx);
    const parsedSphere = bundle.spheres.get(srcIdx);
    const parsedScape = bundle.scapes.get(srcIdx);

    const zone = createZone(
      zEntry.lowKey,
      zEntry.rootKey,
      zEntry.highKey,
      sampleName
    );
    zone.sampleHigh = highSampleName;
    zone.detune = zEntry.detune;
    zone.volume = zEntry.volume;
    zone.pan = zEntry.pan;
    newZones.push(zone);

    if (rawScape && rawSphere && parsedSphere) {
      const res = parsedSphere.header.resolution || parsedScape?.header.resolution || 100;
      const targetF0Hz = Number(midiNoteToHz(zone.rootKey).toFixed(2));
      const detectedF0Hz = Number((res > 0 ? NEURON_SAMPLE_RATE / res : targetF0Hz).toFixed(2));
      const midFrame =
        parsedSphere.frames[Math.floor(parsedSphere.frames.length / 2)] ??
        parsedSphere.frames[0];
      const amps = new Array<number>(64).fill(0);
      const offs = new Array<number>(64).fill(0);
      if (midFrame) {
        for (const p of midFrame.partials) {
          if (p.frequency <= 0 || p.amplitude <= 0) continue;
          const freqHz = p.frequency * 0.5;
          const harmIdx = Math.round(freqHz / Math.max(20, detectedF0Hz)) - 1;
          if (harmIdx >= 0 && harmIdx < 64) {
            const normAmp = p.amplitude / 65535.0;
            if (normAmp > amps[harmIdx]) {
              amps[harmIdx] = normAmp;
              offs[harmIdx] = Number((freqHz - (harmIdx + 1) * detectedF0Hz).toFixed(2));
            }
          }
        }
      }
      const summaryItem: ZoneAnalysisSummary = {
        zoneId: zone.id,
        lowKey: zone.lowKey,
        rootKey: zone.rootKey,
        highKey: zone.highKey,
        sampleName,
        sampleRate: 44100,
        durationSec: 1.0,
        detectedF0Hz,
        targetF0Hz,
        gridResidualCents: 0,
        gridObservations: parsedSphere.frames.length,
        gridBand: 'green',
        gridNotice: `Imported .sphere (${parsedSphere.frames.length} frames, ${parsedSphere.header.stickModes} modes)`,
        layerCount: 1,
        frameCount: parsedSphere.frames.length,
        activePartials: midFrame?.partialCount ?? 64,
        octaveFoldCents: 0,
        biGrid: false,
        amplitudes: amps,
        frequencyOffsets: offs,
      };
      zonesAnalysis.push(summaryItem);
      binaryBySampleName.set(sampleName, {
        scapeBinary: rawScape,
        sphereBinary: rawSphere,
      });
      importedBinaries.set(sampleName, {
        scapeBinary: rawScape,
        sphereBinary: rawSphere,
        origParameterSet: parsedSphere.header.parameterSet ?? inferredParamSet,
        complexity: inferredComplexity,
        summary: summaryItem,
      });
    } else {
      const analyzed = analyzeSingleZone(
        { zone, wavBuffer: wavBuf },
        {
          modelName: bundle.name,
          modelNumber: bundle.slot,
          parameterSet: inferredParamSet,
          complexity: inferredComplexity,
          targetFormat: 'legacy-neuron',
        },
        analyzer
      );

      zonesAnalysis.push(analyzed.summary);
      binaryBySampleName.set(sampleName, {
        scapeBinary: rawScape ?? analyzed.scapeBinary,
        sphereBinary: rawSphere ?? analyzed.sphereBinary,
      });
    }
  }

  // Build ordered unique source binaries (1..K) matching serializeCanonicalMapScript's sourceMap
  const zoneBinaries: ZoneBinaryPair[] = [];
  const seenSamples = new Set<string>();
  for (const z of newZones) {
    for (const sName of [z.sampleLow, z.sampleHigh]) {
      if (sName && !seenSamples.has(sName)) {
        seenSamples.add(sName);
        const pair = binaryBySampleName.get(sName);
        if (pair) {
          zoneBinaries.push(pair);
        }
      }
    }
  }

  const neuronikModelJson =
    extracted.extendedModelJson ??
    bundle.neuronikModelJson ??
    convertLegacyModelToModern(bundle);

  // Record Layer 02 (`02_legacy_original`) untouched binaries in NeuronAssetStore
  const hasRawSourcesInCapsule = extracted.rawSourceSamples.size > 0;
  if (
    extracted.legacyOriginalFiles.length > 0 ||
    (!extracted.isTimeCapsule &&
      !hasRawSourcesInCapsule &&
      zoneBinaries.length > 0 &&
      bundle.spheres.size > 0)
  ) {
    for (const [sName, impRec] of importedBinaries.entries()) {
      assetStore.setLegacyOriginalSample({
        sampleName: sName,
        scapeBinary: impRec.scapeBinary,
        sphereBinary: impRec.sphereBinary,
        origParameterSet: impRec.origParameterSet,
        complexity: impRec.complexity,
      });
    }
    assetStore.setLegacyOriginalSlotBundle({
      slot: bundle.slot,
      name: bundle.name,
      zones: newZones,
      mapScriptVersion: {
        major: bundle.mapScript.versionMajor,
        minor: bundle.mapScript.versionMinor,
        build: bundle.mapScript.versionBuild,
        lineEnding: '\n',
      },
      zoneBinaries,
    });
  }

  session.name = extracted.manifest?.modelName ?? bundle.name;
  session.zones = newZones;
  if (extracted.manifest?.extendedRegions?.length) {
    session.extendedRegions = structuredClone(
      extracted.manifest.extendedRegions
    );
  } else {
    session.extendedRegions =
      syncExtendedRegionsFromClassicZones(newZones);
  }
  if (extracted.manifest?.articulation) {
    session.articulation = cloneArticulation(
      extracted.manifest.articulation
    );
  }
  if (extracted.manifest?.detectedInstrumentCategory) {
    session.detectedInstrumentCategory =
      extracted.manifest.detectedInstrumentCategory;
  }
  // S3/S6: el `manifest.json` del ZIP es entrada no confiable — un cápsula
  // manipulada podría contrabandear `aiBridgeEndpoint` (SSRF) o un cover
  // falso al interior de la sesión viva, saltándose `parseSessionJson`.
  // Se pasa por la misma frontera (`validateProcessConfig`); si falla, se
  // conservan los campos musicales y se neutralizan las hojas peligrosas.
  const mpc = sanitizeImportedProcessConfig(extracted.manifest?.processConfig, bundle.slot);
  session.processConfig = {
    modelName: extracted.manifest?.modelName ?? bundle.name,
    modelNumber: bundle.slot,
    parameterSet:
      (mpc.parameterSet as number | undefined) ?? inferredParamSet,
    complexity:
      (mpc.complexity as number | undefined) ?? inferredComplexity,
    targetFormat:
      (mpc.targetFormat as 'legacy-neuron' | undefined) ?? 'legacy-neuron',
    workingMode: mpc.workingMode as 'classic' | 'extended' | undefined,
    dspAlgorithm: mpc.dspAlgorithm as 'legacy' | 'enhanced' | undefined,
    masterWaveConfig: mpc.masterWaveConfig as MasterWaveConfig | undefined,
    commonPlayback: mpc.commonPlayback as CommonPlaybackDefaults | undefined,
    coverArtwork: (mpc.coverArtwork as ModelCoverArtwork | null | undefined) ?? null,
  };

  const { manifest: builtManifest, provenance: builtProvenance } =
    buildTimeCapsuleEntries({
      slot: bundle.slot,
      modelName: session.name,
      processConfig: session.processConfig,
      zones: newZones,
      extendedRegions: session.extendedRegions,
      articulation: session.articulation,
      detectedInstrumentCategory: session.detectedInstrumentCategory,
      rawSourceSamples: assetStore.getAllRawSourcesSync(),
      legacyOriginalBundle:
        assetStore.getLegacyOriginalSlotBundleSync(bundle.slot),
      enhancedAudioSamples: assetStore.getAllEnhancedAudioSync(),
      classicEnhancedBinaries: zoneBinaries,
      mapScriptVersion: {
        major: bundle.mapScript.versionMajor,
        minor: bundle.mapScript.versionMinor,
        build: bundle.mapScript.versionBuild,
        lineEnding: '\n',
      },
      neuronikModelJson,
      previousProvenance: extracted.provenance ?? undefined,
    });

  session.provenance = builtProvenance;
  session.dirty = false;
  session.modifiedAt = new Date().toISOString();

  assetStore.setCapsuleRecord({
    slot: bundle.slot,
    modelName: session.name,
    manifest: builtManifest,
    provenance: builtProvenance,
    classicEnhancedBinaries: zoneBinaries,
    extendedModelJson: neuronikModelJson,
    updatedAt: builtProvenance.updatedAt,
  });

  const model: GeneratedModel = {
    slot: bundle.slot,
    name: session.name,
    zoneCount: newZones.length,
    complexity: session.processConfig.complexity,
    parameterSet: session.processConfig.parameterSet,
    createdAt: new Date().toISOString(),
    path: `Models/${String(bundle.slot).padStart(3, '0')}.model`,
    targetFormat: 'dual',
    zonesAnalysis,
    neuronikModelJson,
    provenance: builtProvenance,
    coverWebpDataUrl: session.processConfig.coverArtwork?.webpDataUrl,
  };

  host.getBank().registerImportedBundle(bundle.slot, zoneBinaries, {
    major: bundle.mapScript.versionMajor,
    minor: bundle.mapScript.versionMinor,
    build: bundle.mapScript.versionBuild,
    lineEnding: '\n',
  }, model);

  host.persist();
  host.emit({ type: 'session-changed', session });
  host.emit({ type: 'process-complete', model });
  const bank = await host.loadBank();
  host.emit({ type: 'bank-updated', bank });

  return model;
}
