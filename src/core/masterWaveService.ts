// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Master Wave Promotion Service
//
// Promotion logic extracted verbatim from `WebAudioPipeline`
// (P refactor: archivos >3000 líneas). The pipeline keeps ownership
// of mutable state (session, buffers, hashes, bank, asset store)
// and exposes it through `MasterWaveHost`; this module only
// orchestrates purest-source resolution, promotion and session update.
//
// Public API of `WebAudioPipeline` is unchanged.
// ─────────────────────────────────────────────────────────

import type {
  ExtendedRegion,
  MasterWaveConfig,
  MasterWaveResult,
  ModelProvenance,
  Session,
  Zone,
} from './types.ts';
import {
  DEFAULT_MASTER_WAVE_CONFIG,
  promoteBufferToMasterWave,
  regenerateMasterWaveFromLegacyBinaries,
} from './dsp/MasterWaveEnhancer.ts';
import { resolvePurestSourceForSample } from './timeCapsule.ts';
import { decodeWav, synthesizeDemoWav, type DecodedWav } from './dsp/WavDecoder.ts';
import { syncExtendedRegionsFromClassicZones } from './extendedAdapter.ts';
import { webNeuralEngine } from './ai/WebNeuralEngine.ts';
import type { NeuronAssetStore } from './storage/NeuronAssetStore.ts';

/** Mutable pipeline state exposed to the master-wave service. */
export interface MasterWaveHost {
  getSession(): Session | null;
  getExtendedRegions(): ExtendedRegion[];
  getAssetStore(): NeuronAssetStore;
  getSampleBuffer(name: string): ArrayBuffer | undefined;
  getSampleBuffers(): ReadonlyMap<string, ArrayBuffer>;
  registerSampleBuffer(
    sampleName: string,
    wavBuffer: ArrayBuffer,
    options?: {
      isPromotedEnhanced?: boolean;
      rawSourceName?: string;
      isResynthesizedFromLegacy?: boolean;
    }
  ): DecodedWav;
  pushHistory(label: string): void;
  markDirty(): void;
  ensureZoneDemoBuffers(zones: Zone[]): void;
  getProvenance(): ModelProvenance | null;
  computeBufferHash(buf: ArrayBuffer, extraTag?: string): string;
  getEnhancedHash(name: string): string | undefined;
  setEnhancedHash(name: string, hash: string): void;
  invalidateSpectrum(zoneId: string): void;
}

export async function promoteZoneToMasterWave(
  host: MasterWaveHost,
  zoneId?: string,
  config?: Partial<MasterWaveConfig>,
  options?: { forceRebuild?: boolean; preserveManualLoops?: boolean }
): Promise<MasterWaveResult | null> {
  const session = host.getSession();
  if (!session) return null;
  const zone =
    (zoneId ? session.zones.find((z) => z.id === zoneId) : null) ??
    session.zones[0];
  if (!zone) return null;

  host.ensureZoneDemoBuffers([zone]);
  const currentSampleName = zone.sampleLow ?? `Zone_${zone.rootKey}.wav`;

  const extRegions = host.getExtendedRegions();
  const matchReg = extRegions.find(
    (r) => r.sampleName === currentSampleName || r.id === `ext-${zone.id}-low`
  );

  const mergedCfg: MasterWaveConfig = {
    ...DEFAULT_MASTER_WAVE_CONFIG,
    ...(session.processConfig.masterWaveConfig ?? {}),
    ...(config ?? {}),
  };
  session.processConfig.masterWaveConfig = mergedCfg;

  const assetStore = host.getAssetStore();

  // Anti-Photocopy Rule: Always resolve the purest origin layer (`01_raw_source` or `02_legacy_original`)
  const purest = resolvePurestSourceForSample(
    currentSampleName,
    assetStore,
    host.getSampleBuffers()
  );

  let promoted: { result: MasterWaveResult; wav24Buffer: ArrayBuffer };
  let originSampleName = currentSampleName;
  let sourceLayerUsed: '01_raw_source' | '02_legacy_original' = '01_raw_source';

  // Manual loop detection & preservation
  const isManualLoop = Boolean(
    options?.preserveManualLoops ||
    (matchReg && matchReg.loopEnd > matchReg.loopStart && matchReg.loopMode !== 'no_loop')
  );
  const existingLoopStart = matchReg?.loopStart ?? 0;
  const existingLoopEnd = matchReg?.loopEnd ?? 0;
  const existingLoopMode = matchReg?.loopMode ?? 'loop_continuous';

  if (purest?.sourceLayer === '02_legacy_original') {
    sourceLayerUsed = '02_legacy_original';
    originSampleName = purest.sampleName;
    promoted = regenerateMasterWaveFromLegacyBinaries(
      purest.legacyRecord.scapeBinary,
      purest.legacyRecord.sphereBinary,
      zone.rootKey,
      zone.id,
      originSampleName,
      mergedCfg
    );
  } else {
    sourceLayerUsed = '01_raw_source';
    originSampleName = purest?.rawSampleName ?? currentSampleName;
    const rawBuf =
      purest?.rawBuffer ??
      (zone.sampleLow ? host.getSampleBuffer(zone.sampleLow) : undefined) ??
      synthesizeDemoWav('strings', zone.rootKey, 44100, 1.0);

    // Ensure unaltered raw source is stored in `01_raw_source` before promotion
    if (!assetStore.hasRawSource(originSampleName)) {
      assetStore.setRawSource(originSampleName, rawBuf);
    }

    // Content Hash & Idempotent Cache Check (Dirty Tracking)
    const cfgTag = `${mergedCfg.promotionMethod}_${mergedCfg.targetSampleRate}_${mergedCfg.channelLayout}_${mergedCfg.enableBandwidthExtension}`;
    const rawFingerprint = host.computeBufferHash(rawBuf, cfgTag);
    const baseStem = originSampleName.replace(/\.(wav|aif|aiff)$/i, '');
    const expectedMasterName = baseStem.endsWith('_96k24b') ? `${baseStem}.wav` : `${baseStem}_96k24b.wav`;

    if (
      !options?.forceRebuild &&
      host.getEnhancedHash(originSampleName) === rawFingerprint &&
      assetStore.hasEnhancedAudio(expectedMasterName)
    ) {
      const cachedBuf = assetStore.getEnhancedAudioSync(expectedMasterName)!;
      const decodedRaw = decodeWav(rawBuf);
      const channelsCount = mergedCfg.channelLayout === 'stereo' ? 2 : mergedCfg.channelLayout === 'quad-surround' ? 4 : 1;
      promoted = {
        wav24Buffer: cachedBuf,
        result: {
          zoneId: zone.id,
          sampleName: originSampleName,
          masterSampleName: expectedMasterName,
          originalSampleRate: decodedRaw.sampleRate || 44100,
          masterSampleRate: mergedCfg.targetSampleRate,
          bitDepth: 24,
          numChannels: channelsCount,
          originalDurationSec: Number(decodedRaw.durationSec.toFixed(3)),
          masterDurationSec: Number(((cachedBuf.byteLength / (3 * channelsCount)) / mergedCfg.targetSampleRate).toFixed(3)),
          loopExpanded: false,
          loopStart: existingLoopStart,
          loopEnd: existingLoopEnd,
          loopDurationSec: Math.max(0, (existingLoopEnd - existingLoopStart) / mergedCfg.targetSampleRate),
          zeroCrossingCorrelation: 1.0,
          promotionMethodUsed: mergedCfg.promotionMethod,
          aiProviderUsed: undefined,
        },
      };
    } else {
      let sustainHint: { loopStart: number; loopEnd: number } | undefined;
      const aiCfg = session.processConfig.aiConfig;
      if (aiCfg?.enabled && aiCfg.loopExpansion === 'ai') {
        try {
          const dec = decodeWav(rawBuf);
          if (dec.channels.length > 0) {
            const sustainRes = await webNeuralEngine.findSustainWindow(dec.channels[0], dec.sampleRate);
            if (sustainRes && sustainRes.loopEnd > sustainRes.loopStart + 64) {
              sustainHint = { loopStart: sustainRes.loopStart, loopEnd: sustainRes.loopEnd };
            }
          }
        } catch {
          // safe fallback
        }
      }

      promoted = await promoteBufferToMasterWave(
        rawBuf,
        originSampleName,
        zone.id,
        mergedCfg,
        {
          rootKey: zone.rootKey,
          detuneCents: zone.detune,
          loopStart: matchReg?.loopStart,
          loopEnd: matchReg?.loopEnd,
          sustainWindowHint: sustainHint,
          loopMode:
            matchReg?.loopMode === 'ping_pong' || matchReg?.loopMode === 'loop_backward'
              ? 'loop_continuous'
              : matchReg?.loopMode,
        }
      );
      host.setEnhancedHash(originSampleName, rawFingerprint);
    }
  }

  host.pushHistory(`Promote "${originSampleName}" to 24-bit/96kHz Master Wave`);
  host.registerSampleBuffer(
    promoted.result.masterSampleName,
    promoted.wav24Buffer,
    {
      isPromotedEnhanced: true,
      rawSourceName: originSampleName,
    }
  );
  zone.sampleLow = promoted.result.masterSampleName;

  if (!session.extendedRegions || session.extendedRegions.length === 0) {
    session.extendedRegions = syncExtendedRegionsFromClassicZones(session.zones);
  }
  for (const reg of session.extendedRegions) {
    if (
      reg.sampleName === currentSampleName ||
      reg.sampleName === originSampleName ||
      reg.id === `ext-${zone.id}-low`
    ) {
      reg.sampleName = promoted.result.masterSampleName;
      reg.sampleRate = promoted.result.masterSampleRate;
      reg.numChannels = promoted.result.numChannels;

      if (isManualLoop && existingLoopEnd > existingLoopStart) {
        // Scale manual loop frame positions proportionally only if sample rate changed
        const origBuf = purest?.sourceLayer === '01_raw_source' ? purest.rawBuffer : null;
        const currentRate = matchReg?.sampleRate ?? (origBuf ? decodeWav(origBuf).sampleRate : 44100);
        const scale =
          currentRate > 0 && currentRate !== promoted.result.masterSampleRate
            ? promoted.result.masterSampleRate / currentRate
            : 1.0;
        reg.loopStart = Math.round(existingLoopStart * scale);
        reg.loopEnd = Math.round(existingLoopEnd * scale);
        reg.loopMode = existingLoopMode;
      } else {
        reg.loopStart = promoted.result.loopStart;
        reg.loopEnd = promoted.result.loopEnd;
        if (reg.loopMode === 'no_loop' && promoted.result.loopEnd > promoted.result.loopStart) {
          reg.loopMode = 'loop_continuous';
        }
      }
    }
  }

  // Record lineage step in session provenance
  const prevProv = host.getProvenance();
  const step = {
    timestamp: new Date().toISOString(),
    sourceLayer: sourceLayerUsed,
    targetLayer: '03_enhanced_audio' as const,
    algorithm: `MasterWave-${mergedCfg.promotionMethod}-96kHz-24bit-${promoted.result.numChannels}ch`,
    details: `Promoted "${originSampleName}" -> "${promoted.result.masterSampleName}" from ${sourceLayerUsed}`,
  };
  if (prevProv) {
    prevProv.history.push(step);
    prevProv.masterWavePromoted = true;
    prevProv.activeAnalysisSourceLayer = '03_enhanced_audio';
    prevProv.updatedAt = step.timestamp;
    session.provenance = prevProv;
  }

  host.invalidateSpectrum(zone.id);
  host.markDirty();
  return promoted.result;
}

export async function promoteAllZonesToMasterWave(
  host: MasterWaveHost,
  config?: Partial<MasterWaveConfig>,
  options?: { forceRebuild?: boolean; preserveManualLoops?: boolean }
): Promise<MasterWaveResult[]> {
  if (!host.getSession()) return [];
  const results: MasterWaveResult[] = [];
  for (const z of host.getSession()!.zones) {
    const res = await promoteZoneToMasterWave(host, z.id, config, options);
    if (res) results.push(res);
  }
  return results;
}
