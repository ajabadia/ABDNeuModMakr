// ---------------------------------------------------------
// ABDNeuModMakr - Fase 42.5: Bank Export
// empaquetado ZIP (.model) y exportacion AIFF por zona
// Funciones puras de dominio: reciben el servicio (svc) y operan
// sobre su estado publico. La API estable vive en BankService.
// ---------------------------------------------------------

import {
  decodeWav,
  encodeAiffPcm16,
  resampleAudioChannel,
  synthesizeDemoWav,
} from '../dsp/WavDecoder.ts';
import {
  createZone,
} from '../sessionFactory.ts';
import {
  DEFAULT_SAMPLE_NAME,
} from '../sampleNaming.ts';
import {
  mapArticulationToSoundOverrides,
} from '../extendedAdapter.ts';
import {
  buildTimeCapsuleZipArchive,
} from '../timeCapsule.ts';
import {
  basename,
  sanitizeFileName,
} from '../pathUtils.ts';
import {
  downloadBlob,
  downloadBytes,
} from '../../ui/download.ts';
import type {
  ZoneBinaryPair,
} from '../dsp/PipelineRunner.ts';
import type {
  ProcessConfig,
} from '../types.ts';
import type {
  BankService,
} from '../bankService.ts';

/**
 * Builds a complete PKZIP archive (`Uint8Array`) containing the Hartmann NeuronDB
 * `.model` directory (`MName`, `map.script`, `%06d.scape`, `%06d.sphere`),
 * `.sound` directory (`sound.script`, `sound.stickrec`), and modern `.neuronikmodel` v2.1.
 */
export function buildModelZipBytes(svc: BankService, slot: number): Uint8Array {
  const session = svc.ctx.getSession();
  const model = svc.generatedModels.find((m) => m.slot === slot);
  const activeSlot = model?.slot ?? slot;
  const modelName =
    model?.name ?? session?.processConfig.modelName ?? `Model${activeSlot}`;
  const zones = session?.zones ?? [
    createZone(0, 60, 127, DEFAULT_SAMPLE_NAME),
  ];
  svc.ctx.ensureDemoBuffers(zones);

  let zoneBinaries = svc.modelZoneBinaries.get(activeSlot);
  if (!zoneBinaries || zoneBinaries.length === 0) {
    const cfg: ProcessConfig = session?.processConfig ?? {
      modelName,
      modelNumber: activeSlot,
      parameterSet: model?.parameterSet ?? 0,
      complexity: model?.complexity ?? 8,
      targetFormat: model?.targetFormat ?? 'dual',
    };
    const analyzedBySample = new Map<string, ZoneBinaryPair>();
    zoneBinaries = [];
    for (const zone of zones) {
      const lowName = zone.sampleLow ?? `Zone_${zone.rootKey}.wav`;
      if (!analyzedBySample.has(lowName)) {
        const wavBuffer = zone.sampleLow
          ? (svc.ctx.getSampleBuffer(zone.sampleLow) ?? null)
          : null;
        const analyzed = svc.ctx.analyzeZone(
          { zone, wavBuffer },
          cfg
        );
        const pair: ZoneBinaryPair = {
          scapeBinary: analyzed.scapeBinary,
          sphereBinary: analyzed.sphereBinary,
        };
        analyzedBySample.set(lowName, pair);
        zoneBinaries.push(pair);
      }
      if (zone.sampleHigh && !analyzedBySample.has(zone.sampleHigh)) {
        const highBuffer = svc.ctx.getSampleBuffer(zone.sampleHigh) ?? null;
        const analyzedHigh = svc.ctx.analyzeZone(
          {
            zone: { ...zone, sampleLow: zone.sampleHigh },
            wavBuffer: highBuffer,
          },
          cfg
        );
        const pairHigh: ZoneBinaryPair = {
          scapeBinary: analyzedHigh.scapeBinary,
          sphereBinary: analyzedHigh.sphereBinary,
        };
        analyzedBySample.set(zone.sampleHigh, pairHigh);
        zoneBinaries.push(pairHigh);
      }
    }
    svc.modelZoneBinaries.set(activeSlot, zoneBinaries);
  }

  const assetStore = svc.ctx.getAssetStore();
  const rawSourceSamples = new Map<string, ArrayBuffer>();
  const enhancedAudioSamples = new Map<string, ArrayBuffer>();
  const seenSamples = new Set<string>();

  for (const z of zones) {
    for (const sName of [z.sampleLow, z.sampleHigh]) {
      if (!sName || seenSamples.has(sName)) continue;
      seenSamples.add(sName);

      const rawName = assetStore.resolveRawSampleName(sName);
      const rawBuf = assetStore.getRawSourceSync(rawName);
      if (rawBuf) {
        rawSourceSamples.set(rawName, rawBuf);
      } else if (
        !svc.ctx.hasImportedBinary(sName) &&
        !assetStore.hasEnhancedAudio(sName)
      ) {
        const activeBuf = svc.ctx.getSampleBuffer(sName);
        if (activeBuf) {
          rawSourceSamples.set(sName, activeBuf);
        }
      }

      const enhBuf = assetStore.getEnhancedAudioSync(sName);
      if (enhBuf) {
        enhancedAudioSamples.set(sName, enhBuf);
      }
    }
  }

  const legacyOriginalBundle =
    assetStore.getLegacyOriginalSlotBundleSync(activeSlot);
  const effectiveCfg: ProcessConfig = session?.processConfig ?? {
    modelName,
    modelNumber: activeSlot,
    parameterSet: model?.parameterSet ?? 0,
    complexity: model?.complexity ?? 8,
    targetFormat: model?.targetFormat ?? 'legacy-neuron',
  };

  const { zipBytes, manifest, provenance } = buildTimeCapsuleZipArchive({
    slot: activeSlot,
    modelName,
    processConfig: {
      ...effectiveCfg,
      targetFormat:
        session?.processConfig.targetFormat ??
        model?.targetFormat ??
        'legacy-neuron',
    },
    zones,
    extendedRegions: session?.extendedRegions,
    articulation: session?.articulation,
    detectedInstrumentCategory: session?.detectedInstrumentCategory,
    rawSourceSamples,
    legacyOriginalBundle,
    enhancedAudioSamples,
    classicEnhancedBinaries: zoneBinaries,
    mapScriptVersion: svc.modelMapScriptVersions.get(activeSlot),
    neuronikModelJson: model?.neuronikModelJson,
    expandedModelV2: svc.modelExpandedModelsV2.get(activeSlot),
    soundParameterOverrides: mapArticulationToSoundOverrides(
      session?.articulation
    ),
    previousProvenance: session?.provenance ?? model?.provenance,
    includeTopLevelCompatibility: true,
  });

  if (session) {
    session.provenance = provenance;
  }
  if (model) {
    model.provenance = provenance;
  }
  assetStore.setCapsuleRecord({
    slot: activeSlot,
    modelName,
    manifest,
    provenance,
    classicEnhancedBinaries: zoneBinaries,
    extendedModelJson:
      model?.neuronikModelJson ??
      JSON.stringify({ name: modelName, slot: activeSlot, format: 2 }),
    updatedAt: provenance.updatedAt,
  });

  return zipBytes;
}


export async function exportModel(svc: BankService, slot: number, targetPath: string): Promise<void> {
  const existingModel = svc.generatedModels.find((m) => m.slot === slot);
  const activeSlot = existingModel?.slot ?? slot;
  const session = svc.ctx.getSession();
  const modelName =
    existingModel?.name ??
    session?.processConfig.modelName ??
    `Model${activeSlot}`;
  const zoneCount =
    existingModel?.zoneCount ?? session?.zones.length ?? 1;
  const complexity =
    existingModel?.complexity ?? session?.processConfig.complexity ?? 8;
  const parameterSet =
    existingModel?.parameterSet ??
    session?.processConfig.parameterSet ??
    0;

  const lowerTarget = targetPath.toLowerCase();
  const wantsJsonOnly = lowerTarget.endsWith('.nmmodel') || lowerTarget.endsWith('.neuronikmodel');
  if (wantsJsonOnly) {
    const jsonContent =
      existingModel?.neuronikModelJson ??
      JSON.stringify(
        {
          name: modelName,
          slot: activeSlot,
          zoneCount,
          complexity,
          parameterSet,
          createdAt: existingModel?.createdAt ?? new Date().toISOString(),
          format: 2,
        },
        null,
        2
      );

    if (typeof document !== 'undefined') {
      const fallback = `Model_${String(activeSlot).padStart(3, '0')}.nmmodel`;
      downloadBytes(jsonContent, basename(targetPath) || fallback, 'application/json');
    }
    return;
  }

  const zipBytes = buildModelZipBytes(svc, activeSlot);
  if (typeof document !== 'undefined') {
    const safeName = sanitizeFileName(modelName, 'model');
    const defaultZipName = `NeuronModel_${String(activeSlot).padStart(3, '0')}_${safeName}.zip`;
    const requestedName = basename(targetPath) || defaultZipName;
    downloadBlob(
      new Blob([zipBytes as unknown as BlobPart], { type: 'application/zip' }),
      requestedName.endsWith('.zip') ? requestedName : defaultZipName
    );
  }
}

/**
 * Exports a zone's audio buffer as a canonical Hartmann MODELmaker v1.2
 * 44100 Hz, 16-bit, Mono Big-Endian `FORM/AIFF` file with `INST` chunk
 * (`rootKey`, `lowKey`, `highKey`, `detune`, `gainDb`) and triggers a browser download.
 */
export function exportZoneAsAiff(svc: BankService, zoneId: string): { filename: string; bytes: Uint8Array } {
  const session = svc.ctx.getSession();
  if (!session) {
    throw new Error('No active session');
  }
  const zone =
    session.zones.find((z) => z.id === zoneId) ?? session.zones[0];
  if (!zone) {
    throw new Error('No zone available to export');
  }

  svc.ctx.ensureDemoBuffers([zone]);
  const sampleName = zone.sampleLow ?? `Zone_${zone.rootKey}.wav`;
  const raw =
    svc.ctx.getSampleBuffer(sampleName) ??
    synthesizeDemoWav('strings', zone.rootKey, 44100, 1.0);
  const decoded = decodeWav(raw);
  const mono44k = resampleAudioChannel(decoded.mono, decoded.sampleRate, 44100);

  const aiffAb = encodeAiffPcm16([mono44k], 44100, {
    rootKey: zone.rootKey,
    lowKey: zone.lowKey,
    highKey: zone.highKey,
    lowVelocity: 1,
    highVelocity: 127,
    detune: Math.round(zone.detune),
    gainDb: Math.round(zone.volume),
  });

  const basePrefix = sampleName
    .split(/[\\/]/)
    .pop()!
    .replace(/\.[^.]+$/, '')
    .replace(/[^A-Za-z0-9]/g, '');
  const rrr = String(zone.rootKey).padStart(3, '0');
  const lll = String(zone.lowKey).padStart(3, '0');
  const filename = `${basePrefix || 'Zone'}_${rrr}_${lll}_v1.aif`;
  const bytes = new Uint8Array(aiffAb);

  if (typeof document !== 'undefined') {
    downloadBytes(aiffAb, filename, 'audio/aiff');
  }

  return { filename, bytes };
}

