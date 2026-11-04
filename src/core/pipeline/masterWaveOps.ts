import type { PipelineContext } from './types.ts';
import type {
  MasterWaveConfig,
  MasterWaveResult,
  ModelProvenance,
  ReprocessPurestOptions,
} from '../types.ts';
import { clamp } from '../dsp/DspMath.ts';
import { DEFAULT_MASTER_WAVE_CONFIG } from '../dsp/MasterWaveEnhancer.ts';
import { resolvePurestSourceForSample } from '../timeCapsule.ts';
import { getModelProvenance } from './importOps.ts';
import { importHost } from './importOps.ts';
import { promoteAllZonesToMasterWave as promoteAllZonesToMasterWaveService } from '../masterWaveService.ts';
import { promoteZoneToMasterWave as promoteZoneToMasterWaveService } from '../masterWaveService.ts';
import { startProcess } from './processOps.ts';

export async function reprocessFromPurestSource(ctx: PipelineContext, options?: ReprocessPurestOptions): Promise<ModelProvenance> {
  if (!ctx.state.session) {
    throw new Error('No active session to reprocess');
  }

  const prevProv = getModelProvenance(ctx);
  const cfg = ctx.state.session.processConfig;
  if (options?.dspAlgorithm !== undefined) {
    cfg.dspAlgorithm = options.dspAlgorithm;
  }
  if (options?.complexity !== undefined) {
    cfg.complexity = clamp(Math.round(options.complexity), 1, 10);
  }
  if (options?.parameterSet !== undefined) {
    cfg.parameterSet = clamp(Math.round(options.parameterSet), 0, 9);
  }
  if (options?.masterWaveConfig) {
    cfg.masterWaveConfig = {
      ...DEFAULT_MASTER_WAVE_CONFIG,
      ...(cfg.masterWaveConfig ?? {}),
      ...options.masterWaveConfig,
    };
  }

  let primaryUsed: '01_raw_source' | '02_legacy_original' =
    prevProv?.primarySourceLayer ?? '01_raw_source';

  // Step 1: Restore or promote every zone strictly from its purest origin layer (`01_raw_source` or `02_legacy_original`)
  const shouldPromoteMasterWave =
    options?.promoteToMasterWave ??
    Boolean(prevProv?.masterWavePromoted);

  for (const zone of ctx.state.session.zones) {
    const currentLow = zone.sampleLow;
    if (!currentLow) continue;

    const purest = resolvePurestSourceForSample(
      currentLow,
      ctx.state.assetStore,
      ctx.state.sampleBuffers
    );
    if (!purest) continue;

    primaryUsed = purest.sourceLayer;

    if (shouldPromoteMasterWave || purest.sourceLayer === '02_legacy_original') {
      await promoteZoneToMasterWave(ctx, zone.id, cfg.masterWaveConfig, {
        forceRebuild: options?.forceRebuild,
        preserveManualLoops: true,
      });
    } else if (purest.sourceLayer === '01_raw_source') {
      // Restore zone directly to unaltered 01_raw_source WAV buffer
      ctx.state.sampleBuffers.set(purest.rawSampleName, purest.rawBuffer);
      zone.sampleLow = purest.rawSampleName;
    }
  }

  // Step 2: Increment reprocessCount & record anti-photocopy lineage step
  const nextReprocessCount = (prevProv?.reprocessCount ?? 0) + 1;
  const analysisSource:
    | '01_raw_source'
    | '02_legacy_original'
    | '03_enhanced_audio' =
    shouldPromoteMasterWave || primaryUsed === '02_legacy_original'
      ? '03_enhanced_audio'
      : primaryUsed;

  const reprocessStep = {
    timestamp: new Date().toISOString(),
    sourceLayer: analysisSource,
    targetLayer: '04_classic_enhanced' as const,
    algorithm: `Reprocess#${nextReprocessCount}-NAS-${cfg.dspAlgorithm ?? 'legacy'}-c${cfg.complexity}-ps${cfg.parameterSet}`,
    details: `Zero-generation-loss reprocess #${nextReprocessCount} from purest origin (${primaryUsed} -> ${analysisSource} -> 04_classic_enhanced & 05_extended_model)`,
  };

  if (ctx.state.session.provenance) {
    ctx.state.session.provenance.reprocessCount = nextReprocessCount;
    ctx.state.session.provenance.primarySourceLayer = primaryUsed;
    ctx.state.session.provenance.history.push(reprocessStep);
  }

  // Step 3: Run full spectral analysis with `forceReanalyzeImported: true` so it computes fresh
  // `04_classic_enhanced` and `05_extended_model` from `03_enhanced_audio` / `01_raw_source`
  await startProcess(ctx, ctx.state.session.processConfig, {
    forceReanalyzeImported: true,
  });

  const finalProv = getModelProvenance(ctx)!;
  finalProv.reprocessCount = Math.max(
    finalProv.reprocessCount,
    nextReprocessCount
  );
  finalProv.primarySourceLayer = primaryUsed;
  return finalProv;
}

export async function promoteZoneToMasterWave(ctx: PipelineContext, zoneId?: string, config?: Partial<MasterWaveConfig>, options?: { forceRebuild?: boolean; preserveManualLoops?: boolean }): Promise<MasterWaveResult | null> {
  return promoteZoneToMasterWaveService(importHost(ctx), zoneId, config, options);
}

export async function promoteAllZonesToMasterWave(ctx: PipelineContext, config?: Partial<MasterWaveConfig>, options?: { forceRebuild?: boolean; preserveManualLoops?: boolean }): Promise<MasterWaveResult[]> {
  return promoteAllZonesToMasterWaveService(importHost(ctx), config, options);
}
