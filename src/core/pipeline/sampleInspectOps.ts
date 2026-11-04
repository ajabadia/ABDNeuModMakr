import type { PipelineContext } from './types.ts';
import type { AssetStoreDiagnostics, Zone } from '../types.ts';
import type {
  RawExportOptions,
  RawExportResult,
  RawSamplerPreflightReport,
} from '../export/rawSamplerTypes.ts';
import {
  buildZoneRibbonWaveforms,
  emptyRibbonWaveforms,
  getSampleEnvelope,
  type EnvelopeStore,
  type ZoneRibbonWaveformsData,
} from '../waveforms.ts';
import { synthesizeDemoWav } from '../dsp/WavDecoder.ts';
import { exportRawSamplerLibrary } from '../export/RawSamplerExporter.ts';
import { analyzeRawSamplerPreflight as analyzeRawSamplerPreflightService } from '../export/rawSamplerPreflight.ts';
import { getSampleBuffer } from './sampleBufferOps.ts';
import { lookupSampleBuffer } from './sampleBufferOps.ts';

export function getZoneRibbonWaveforms(ctx: PipelineContext, zoneId: string): ZoneRibbonWaveformsData {
  const zone = ctx.state.session?.zones.find((z) => z.id === zoneId);
  if (!zone) return emptyRibbonWaveforms();
  const store: EnvelopeStore = {
    buffers: ctx.state.sampleBuffers,
    cache: ctx.state.ribbonEnvelopeCache,
  };
  const slot = ctx.state.session?.processConfig.modelNumber ?? 0;
  const cachedSpec = ctx.state.spectralCache.get(zone.id);
  const isEnhancedAlgo =
    (ctx.state.session?.processConfig.dspAlgorithm ?? 'legacy') === 'enhanced';
  const activeResynthMono = isEnhancedAlgo
    ? (cachedSpec?.enhancedMono ?? cachedSpec?.resynthMono ?? null)
    : (cachedSpec?.resynthMono ?? null);
  return buildZoneRibbonWaveforms({
    lowOriginal: getSampleEnvelope(store, zone.sampleLow, zone.rootKey),
    highOriginal: zone.sampleHigh
      ? getSampleEnvelope(store, zone.sampleHigh, zone.rootKey)
      : null,
    resynthMono: activeResynthMono,
    hasModelBinaries: ctx.state.bank.hasBinaries(slot),
  });
}

export function ensureZoneDemoBuffers(ctx: PipelineContext, zones: Zone[]): void {
  for (const z of zones) {
    if (z.sampleLow && !lookupSampleBuffer(ctx, z.sampleLow)) {
      const lower = z.sampleLow.toLowerCase();
      const timbre = lower.includes('bass')
        ? 'bass'
        : lower.includes('piano')
          ? 'piano'
          : lower.includes('bell')
            ? 'bell'
            : lower.includes('pad')
              ? 'pad'
              : 'strings';
      ctx.state.sampleBuffers.set(
        z.sampleLow,
        synthesizeDemoWav(timbre, z.rootKey, 44100, 1.0)
      );
    }
  }
}

export function analyzeRawSamplerPreflight(ctx: PipelineContext, options: RawExportOptions): RawSamplerPreflightReport {
  if (!ctx.state.session) {
    throw new Error('No active session initialized');
  }
  return analyzeRawSamplerPreflightService(ctx.state.session, options, (name) => getSampleBuffer(ctx, name));
}

export function exportRawSampler(ctx: PipelineContext, options: RawExportOptions): Promise<RawExportResult> {
  if (!ctx.state.session) {
    throw new Error('No active session initialized');
  }
  return exportRawSamplerLibrary(ctx.state.session, options, (name) => getSampleBuffer(ctx, name));
}

export function getAssetStoreDiagnostics(ctx: PipelineContext): AssetStoreDiagnostics {
  return ctx.state.assetStore.getDiagnostics();
}
