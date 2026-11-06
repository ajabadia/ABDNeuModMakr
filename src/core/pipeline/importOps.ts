import type { AudioFilePayload, BankSummary, ExtendedRegion, GeneratedModel, ModelProvenance, Session, Zone, ZoneAnalysisSummary } from '../types.ts';
import type { PipelineContext } from './types.ts';
import { importAudioFiles as importAudioFilesService, importModelFiles as importModelFilesService, importSamplesFromFolder as importSamplesFromFolderService } from '../import/modelImportService.ts';
import type { ModelImportHost } from '../import/modelImportService.ts';
import type { MasterWaveHost } from '../masterWaveService.ts';
import { BankLoadError, buildBankLoadPlan, buildFallbackBankLoadPlan } from '../bankService.ts';
import type { BankLoadPlan } from '../bankService.ts';
import { encodePcm16Wav, midiNoteToHz, synthesizeDemoWav } from '../dsp/WavDecoder.ts';
import { parseNeuronScape, parseNeuronSphere, resynthesizeNeuronModelSource } from '@abdsynths/shared/formats/neuron';
import { createInitialSession, createZone } from '../sessionFactory.ts';
import { cloneArticulation, cloneExtendedRegion, syncExtendedRegionsFromClassicZones } from '../extendedAdapter.ts';
import { importSf2PresetToNativeCapped } from '../../formats/Sf2Parser.ts';
import type { NativeSamplerImportResult } from '../../formats/Sf2Parser.ts';
import { importSfzToNative } from '../../formats/SfzParser.ts';
import { buildTimeCapsuleEntries } from '../timeCapsule.ts';
import { yieldToUI } from '../asyncUtils.ts';
import { clearHistory, newSession, pushHistory } from './sessionHistoryOps.ts';
import { lookupSampleBuffer, registerSampleBuffer } from './sampleBufferOps.ts';
import { markDirty, persistToLocalStorage } from './persistenceOps.ts';

export async function importSamplesFromFolder(ctx: PipelineContext, _folderPath: string): Promise<Zone[]> {
  return importSamplesFromFolderService(importHost(ctx), _folderPath);
}

export async function importAudioFiles(ctx: PipelineContext, files: { name: string; buffer: ArrayBuffer }[], mode: 'samples' | 'by-name' = 'samples'): Promise<Zone[]> {
  return importAudioFilesService(importHost(ctx), files, mode);
}

export async function importModelFiles(ctx: PipelineContext, files: { name: string; buffer: ArrayBuffer }[]): Promise<GeneratedModel> {
  return importModelFilesService(importHost(ctx), files);
}

export function importHost(ctx: PipelineContext): ModelImportHost & MasterWaveHost {
  return {
    getSession: () => ctx.state.session,
    ensureSession: async (name: string) => {
      if (!ctx.state.session) await newSession(ctx, name);
      return ctx.state.session!;
    },
    pushHistory: (label: string) => pushHistory(ctx, label),
    markDirty: () => markDirty(ctx),
    registerSampleBuffer: (name, buffer, options) =>
      registerSampleBuffer(ctx, name, buffer, options),
    detectPitch: (channel, sampleRate) =>
      ctx.state.analyzer.detectPitch(channel, sampleRate),
    ensureZoneDemoBuffers: (zones) => ctx.ensureZoneDemoBuffers(zones),
    getSampleBuffer: (name: string) => ctx.state.sampleBuffers.get(name),
    setSampleBuffer: (name: string, buffer: ArrayBuffer) => {
      ctx.state.sampleBuffers.set(name, buffer);
    },
    hasSampleBuffer: (name: string) => ctx.state.sampleBuffers.has(name),
    getAnalyzer: () => ctx.state.analyzer,
    getAssetStore: () => ctx.state.assetStore,
    getBank: () => ctx.state.bank,
    getImportedBinaries: () => ctx.state.importedSourceBinaries,
    persist: () => persistToLocalStorage(ctx),
    emit: (event) => ctx.emit(event),
    loadBank: () => loadBank(ctx),
    getExtendedRegions: () => getExtendedRegions(ctx),
    getProvenance: () => getModelProvenance(ctx),
    computeBufferHash: (buf, tag) => ctx.computeAudioBufferHash(buf, tag),
    getEnhancedHash: (name: string) => ctx.state.enhancedSourceHashes.get(name),
    setEnhancedHash: (name: string, hash: string) => {
      ctx.state.enhancedSourceHashes.set(name, hash);
    },
    invalidateSpectrum: (zoneId: string) => {
      ctx.state.spectralCache.delete(zoneId);
    },
    getSampleBuffers: () => ctx.state.sampleBuffers,
  };
}

export async function loadBankModel(ctx: PipelineContext, slot: number): Promise<Session> {
  const record = ctx.state.bank.getModelRecord(slot);
  if (!record) {
    throw new BankLoadError('NOT_FOUND', `Model #${slot} is not in the bank.`);
  }

  const capsule = ctx.state.assetStore.getCapsuleRecordSync(slot);
  const legacyBundle = ctx.state.assetStore.getLegacyOriginalSlotBundleSync(slot);
  if (!record.neuronikModelJson && capsule?.extendedModelJson) {
    record.neuronikModelJson = capsule.extendedModelJson;
  }

  const binaries = ctx.state.bank.getModelBinaries(slot);
  let plan: BankLoadPlan;
  let hasAlignedBinaries = false;
  try {
    plan = buildBankLoadPlan(record, binaries);
    hasAlignedBinaries = true;
  } catch (err) {
    if (
      err instanceof BankLoadError &&
      (err.code === 'NO_BINARIES' || err.code === 'MISMATCH' || err.code === 'NO_ZONES')
    ) {
      plan = buildFallbackBankLoadPlan(record, legacyBundle?.zones);
    } else {
      throw err;
    }
  }

  if (!ctx.state.session) {
    await newSession(ctx, record.name);
  } else {
    pushHistory(ctx, `Load Model "${record.name}"`);
  }

  const analysisBySample = new Map<string, ZoneAnalysisSummary>();
  for (const s of record.zonesAnalysis ?? []) {
    if (!analysisBySample.has(s.sampleName)) {
      analysisBySample.set(s.sampleName, s);
    }
  }

  const inferTimbre = (name: string): 'bass' | 'piano' | 'bell' | 'pad' | 'strings' => {
    const lower = `${record.name} ${name}`.toLowerCase();
    if (lower.includes('piano') || lower.includes('key') || record.parameterSet === 5) return 'piano';
    if (lower.includes('bass')) return 'bass';
    if (lower.includes('bell') || lower.includes('pluck') || record.parameterSet === 2 || record.parameterSet === 3) return 'bell';
    if (lower.includes('pad') || record.parameterSet === 4 || record.parameterSet === 7) return 'pad';
    return 'strings';
  };

  const synthesizeFromAnalysisSummary = (
    summary: ZoneAnalysisSummary | undefined,
    rootKey: number,
    lowKey: number,
    highKey: number
  ): ArrayBuffer | null => {
    if (!summary || !Array.isArray(summary.amplitudes) || summary.amplitudes.length === 0) {
      return null;
    }
    const maxAmp = Math.max(...summary.amplitudes.map((a) => (Number.isFinite(a) ? Math.abs(a) : 0)), 0);
    if (maxAmp <= 1e-5) return null;
    const sr = 44100;
    const dur = Math.max(0.6, Math.min(2.5, summary.durationSec || 1.2));
    const numFrames = Math.round(sr * dur);
    const pcm = new Float32Array(numFrames);
    const baseF0 =
      summary.detectedF0Hz && summary.detectedF0Hz >= 20 && summary.detectedF0Hz <= 8000
        ? summary.detectedF0Hz
        : midiNoteToHz(rootKey);
    const numPartials = Math.min(32, summary.amplitudes.length);
    for (let p = 0; p < numPartials; p++) {
      const amp = (summary.amplitudes[p] ?? 0) / maxAmp;
      if (amp < 0.005) continue;
      const offsetCents = summary.frequencyOffsets?.[p] ?? 0;
      const freq = baseF0 * (p + 1) * Math.pow(2, offsetCents / 1200);
      if (freq >= sr * 0.46) break;
      const decayRate = 1.6 + p * 0.28;
      const twoPiF = (2 * Math.PI * freq) / sr;
      for (let n = 0; n < numFrames; n++) {
        const t = n / sr;
        const attack = Math.min(1, t / 0.008);
        const env = attack * Math.exp(-decayRate * t);
        pcm[n] += amp * env * Math.sin(twoPiF * n);
      }
    }
    let peak = 0;
    for (let n = 0; n < numFrames; n++) {
      const a = Math.abs(pcm[n]);
      if (a > peak) peak = a;
    }
    if (peak > 1e-5) {
      const scale = 0.85 / peak;
      for (let n = 0; n < numFrames; n++) pcm[n] *= scale;
    }
    return encodePcm16Wav(pcm, sr, { rootKey, lowKey, highKey, detune: 0 });
  };

  plan.sampleOrder.forEach((sampleName, i) => {
    const pair = hasAlignedBinaries
      ? binaries![i]
      : (binaries?.[i] ?? ctx.state.assetStore.getLegacyOriginalSampleSync(sampleName));
    const firstZone = plan.zones.find(
      (z) => z.sampleLow === sampleName || z.sampleHigh === sampleName
    );
    const summary = analysisBySample.get(sampleName);
    let wavBuf: ArrayBuffer | null = null;

    if (pair?.scapeBinary && pair?.sphereBinary) {
      try {
        const parsedScape = parseNeuronScape(pair.scapeBinary);
        const parsedSphere = parseNeuronSphere(pair.sphereBinary);
        const pcm =
          parsedSphere.frames.length > 0 || parsedScape
            ? resynthesizeNeuronModelSource(parsedSphere, parsedScape, 44100, 0.22)
            : null;
        wavBuf = pcm
          ? encodePcm16Wav(pcm, 44100, {
              rootKey: firstZone?.rootKey ?? 60,
              lowKey: firstZone?.lowKey ?? 0,
              highKey: firstZone?.highKey ?? 127,
              detune: 0,
            })
          : null;
      } catch {
        wavBuf = null;
      }
    }

    if (!wavBuf) {
      const cachedRawOrEnhanced = lookupSampleBuffer(ctx, sampleName);
      if (cachedRawOrEnhanced) {
        wavBuf = cachedRawOrEnhanced;
      }
    }
    if (!wavBuf) {
      wavBuf = synthesizeFromAnalysisSummary(
        summary,
        firstZone?.rootKey ?? 60,
        firstZone?.lowKey ?? 0,
        firstZone?.highKey ?? 127
      );
    }
    if (!wavBuf) {
      wavBuf = synthesizeDemoWav(
        inferTimbre(sampleName),
        firstZone?.rootKey ?? 60,
        44100,
        1.0
      );
    }
    try {
      registerSampleBuffer(ctx, sampleName, wavBuf);
    } catch {
      // Oversize buffer: keep the name reference; audition falls back to demo.
    }
    if (pair?.scapeBinary && pair?.sphereBinary) {
      ctx.state.importedSourceBinaries.set(sampleName, {
        scapeBinary: pair.scapeBinary,
        sphereBinary: pair.sphereBinary,
        origParameterSet: record.parameterSet,
        complexity: record.complexity,
        summary: summary ?? {
          zoneId: sampleName,
          lowKey: firstZone?.lowKey ?? 0,
          rootKey: firstZone?.rootKey ?? 60,
          highKey: firstZone?.highKey ?? 127,
          sampleName,
          sampleRate: 44100,
          durationSec: 1.0,
          detectedF0Hz: 440,
          targetF0Hz: 440,
          gridResidualCents: 0,
          gridObservations: 0,
          gridBand: 'green',
          gridNotice: 'Bank model (resynthesized on load)',
          layerCount: 1,
          frameCount: 0,
          activePartials: 0,
          octaveFoldCents: 0,
          biGrid: false,
          amplitudes: new Array<number>(64).fill(0),
          frequencyOffsets: new Array<number>(64).fill(0),
        },
      });
    }
  });

  const newZones: Zone[] = plan.zones.map((z) => {
    const zone = createZone(z.lowKey, z.rootKey, z.highKey, z.sampleLow);
    zone.sampleHigh = z.sampleHigh;
    return zone;
  });
  ctx.state.session!.name = record.name;
  ctx.state.session!.zones = newZones;
  ctx.state.session!.extendedRegions = syncExtendedRegionsFromClassicZones(newZones);
  ctx.state.session!.processConfig = { ...plan.processConfig };
  if (record.coverWebpDataUrl && !ctx.state.session!.processConfig.coverArtwork) {
    ctx.state.session!.processConfig.coverArtwork = {
      webpDataUrl: record.coverWebpDataUrl,
      byteLength: Math.round((record.coverWebpDataUrl.length * 3) / 4),
      width: 512,
      height: 512,
      originalName: `${record.name}.webp`,
      updatedAt: record.createdAt,
    };
    ctx.state.session!.processConfig.workingMode = 'extended';
  } else if (!record.coverWebpDataUrl) {
    ctx.state.session!.processConfig.coverArtwork = null;
  }
  ctx.state.session!.dirty = true;
  ctx.state.session!.modifiedAt = new Date().toISOString();
  ctx.ensureZoneDemoBuffers(ctx.state.session!.zones);
  persistToLocalStorage(ctx);
  ctx.emit({ type: 'session-changed', session: ctx.state.session! });
  return ctx.state.session!;
}

export async function importSf2Buffer(ctx: PipelineContext, buffer: ArrayBuffer, presetIndex = 0): Promise<Session> {
  // S6.4: índices de muestra validados por cabecera antes de extraer.
  const imported = importSf2PresetToNativeCapped(buffer, presetIndex);
  return applyNativeSamplerImport(ctx, imported);
}

export async function importSfzText(ctx: PipelineContext, sfzText: string, sfzFileName: string, audioFiles: AudioFilePayload[]): Promise<Session> {
  const imported = importSfzToNative(sfzText, sfzFileName, audioFiles);
  return applyNativeSamplerImport(ctx, imported);
}

export async function applyNativeSamplerImport(ctx: PipelineContext, imported: NativeSamplerImportResult): Promise<Session> {
  // Clean slate for new sampler instrument import (SoundFont SF2 / SFZ)
  ctx.state.sampleBuffers.clear();
  ctx.state.importedSourceBinaries.clear();
  ctx.state.assetStore.clearSessionAudioLayers();
  ctx.state.ribbonEnvelopeCache.clear();
  ctx.state.spectralCache.clear();

  const prevWorkingMode = ctx.state.session?.processConfig.workingMode ?? 'extended';
  const prevKeyMappingMode = ctx.state.session?.processConfig.keyMappingMode ?? 'chromatic';
  const prevAiConfig = ctx.state.session?.processConfig.aiConfig;

  ctx.state.session = createInitialSession(imported.presetName);
  const session = ctx.state.session;
  if (!session) throw new Error('No active session');
  session.processConfig.workingMode = prevWorkingMode;
  session.processConfig.keyMappingMode = prevKeyMappingMode;
  if (prevAiConfig) {
    session.processConfig.aiConfig = { ...prevAiConfig };
  }
  // Explicitly reset cover artwork to null for the new instrument
  session.processConfig.coverArtwork = null;

  // Assign imported tags & metadata cleanly
  if (imported.metadata) {
    session.processConfig.extendedMetadata = {
      ...imported.metadata,
      sourceFormat: imported.sourceFormat,
      sourcePresetName: imported.presetName,
      version: imported.metadata.version || '1.0.0',
    };
  } else {
    session.processConfig.extendedMetadata = {
      sourceFormat: imported.sourceFormat,
      sourcePresetName: imported.presetName,
      version: '1.0.0',
    };
  }

  for (let i = 0; i < imported.audioFiles.length; i++) {
    if (i > 0 && i % 6 === 0) {
      await yieldToUI(0);
    }
    const audioFile = imported.audioFiles[i];
    try {
      registerSampleBuffer(ctx, audioFile.name, audioFile.buffer);
    } catch {
      // Keep buffer directly if decode validation warns on large sample
      ctx.state.sampleBuffers.set(audioFile.name, audioFile.buffer);
    }
  }

  session.name = imported.presetName;
  session.extendedRegions = imported.extendedRegions.map(cloneExtendedRegion);
  session.zones = imported.classicZones.map((z) => ({ ...z }));
  session.articulation = cloneArticulation(imported.articulation);
  session.detectedInstrumentCategory = imported.detectedCategory;

  const maxLen = session.processConfig.targetFormat === 'modern-neural' ? 32 : 11;
  session.processConfig.modelName = imported.presetName.slice(0, maxLen) || imported.modelName;
  session.processConfig.expandedName = imported.presetName || imported.modelName;
  session.processConfig.parameterSet = imported.suggestedParameterSet;

  ctx.ensureZoneDemoBuffers(session.zones);
  clearHistory(ctx);
  pushHistory(ctx, `Import ${imported.sourceFormat.toUpperCase()} "${imported.presetName}"`);
  session.dirty = false;
  persistToLocalStorage(ctx);
  ctx.emit({ type: 'session-changed', session: session });
  return session;
}

export function getModelProvenance(ctx: PipelineContext, slot?: number): ModelProvenance | null {
  const activeSlot =
    slot ?? ctx.state.session?.processConfig.modelNumber ?? 0;
  const stored = ctx.state.assetStore.getCapsuleRecordSync(activeSlot);
  if (!ctx.state.session) {
    return stored?.provenance ?? null;
  }

  const zones = ctx.state.session.zones;
  ctx.ensureZoneDemoBuffers(zones);
  const rawSourceSamples = new Map<string, ArrayBuffer>();
  const enhancedAudioSamples = new Map<string, ArrayBuffer>();

  for (const z of zones) {
    for (const sName of [z.sampleLow, z.sampleHigh]) {
      if (!sName) continue;
      const rawName = ctx.state.assetStore.resolveRawSampleName(sName);
      const rawBuf = ctx.state.assetStore.getRawSourceSync(rawName);
      if (rawBuf) {
        rawSourceSamples.set(rawName, rawBuf);
      } else if (
        !ctx.state.importedSourceBinaries.has(sName) &&
        !ctx.state.assetStore.hasEnhancedAudio(sName)
      ) {
        const activeBuf = ctx.state.sampleBuffers.get(sName);
        if (activeBuf) {
          rawSourceSamples.set(sName, activeBuf);
        }
      }
      const enhBuf = ctx.state.assetStore.getEnhancedAudioSync(sName);
      if (enhBuf) {
        enhancedAudioSamples.set(sName, enhBuf);
      }
    }
  }

  const modelRecord = ctx.state.bank.getModelRecord(activeSlot);
  const classicBins = ctx.state.bank.getModelBinaries(activeSlot) ?? [];
  const { provenance } = buildTimeCapsuleEntries({
    slot: activeSlot,
    modelName: ctx.state.session.processConfig.modelName,
    processConfig: ctx.state.session.processConfig,
    zones,
    extendedRegions: ctx.state.session.extendedRegions,
    articulation: ctx.state.session.articulation,
    detectedInstrumentCategory: ctx.state.session.detectedInstrumentCategory,
    rawSourceSamples,
    legacyOriginalBundle:
      ctx.state.assetStore.getLegacyOriginalSlotBundleSync(activeSlot),
    enhancedAudioSamples,
    classicEnhancedBinaries: classicBins,
    neuronikModelJson: modelRecord?.neuronikModelJson,
    previousProvenance:
      ctx.state.session.provenance ??
      modelRecord?.provenance ??
      stored?.provenance,
    includeTopLevelCompatibility: false,
  });

  ctx.state.session.provenance = provenance;
  return provenance;
}

export function getExtendedRegions(ctx: PipelineContext): ExtendedRegion[] {
  const session = ctx.state.session;
  if (!session) return [];
  if (!session.extendedRegions || session.extendedRegions.length === 0) {
    session.extendedRegions = syncExtendedRegionsFromClassicZones(session.zones);
  }
  return session.extendedRegions.map(cloneExtendedRegion);
}

export async function loadBank(ctx: PipelineContext): Promise<BankSummary> {
  return ctx.state.bank.loadBank();
}
