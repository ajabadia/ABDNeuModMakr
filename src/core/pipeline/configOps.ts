import type { PipelineContext } from './types.ts';
import type { ProcessSourcesInspection } from '../types.ts';
import {
  cloneCommonPlayback,
  createDefaultArticulation,
  createDefaultCommonPlayback,
  projectExtendedRegionsToClassicZones,
  syncExtendedRegionsFromClassicZones,
} from '../extendedAdapter.ts';
import { markDirty } from './persistenceOps.ts';
import { pushHistory } from './sessionHistoryOps.ts';
import { DEFAULT_AI_ASSISTANCE_CONFIG } from '../types.ts';
import type { ProcessConfig, Session } from '../types.ts';
import { clamp } from '../dsp/DspMath.ts';
import { DEFAULT_MASTER_WAVE_CONFIG } from '../dsp/MasterWaveEnhancer.ts';

export function updateProcessConfig(ctx: PipelineContext, changes: Partial<ProcessConfig>): Session {
  if (!ctx.state.session) throw new Error('No active session');
  const keys = Object.keys(changes).sort().join(',');

  // Validate before recording history so rejected changes never leave a phantom undo step
  if (changes.workingMode !== undefined) {
    if (changes.workingMode !== 'classic' && changes.workingMode !== 'extended') {
      throw new Error("Invalid workingMode: must be 'classic' | 'extended'");
    }
  }
  if (changes.keyMappingMode !== undefined) {
    if (changes.keyMappingMode !== 'chromatic' && changes.keyMappingMode !== 'drum') {
      throw new Error("Invalid keyMappingMode: must be 'chromatic' | 'drum'");
    }
  }

  pushHistory(ctx, `Change Process Settings (${keys})`, `config:${keys}`);

  const cfg = ctx.state.session.processConfig;
  if (changes.modelNumber !== undefined) {
    cfg.modelNumber = clamp(Math.round(changes.modelNumber), 0, 511);
  }
  if (changes.modelName !== undefined) {
    const maxLen = (changes.targetFormat ?? cfg.targetFormat) === 'modern-neural' ? 32 : 11;
    const trimmed = changes.modelName.replace(/[\r\n\t]/g, '').slice(0, maxLen);
    cfg.modelName = trimmed.length > 0 ? trimmed : 'UNTITLED';
  }
  if (changes.expandedName !== undefined) {
    const trimmed = changes.expandedName.replace(/[\r\n\t]/g, '').trim();
    cfg.expandedName = trimmed.length > 0 ? trimmed : 'UNTITLED';
  }
  if (changes.extendedMetadata !== undefined) {
    cfg.extendedMetadata = {
      ...(cfg.extendedMetadata ?? {}),
      ...changes.extendedMetadata,
    };
  }
  if (changes.complexity !== undefined) {
    cfg.complexity = clamp(Math.round(changes.complexity), 1, 10);
  }
  if (changes.parameterSet !== undefined) {
    cfg.parameterSet = clamp(Math.round(changes.parameterSet), 0, 9);
  }
  if (changes.targetFormat !== undefined) {
    cfg.targetFormat = changes.targetFormat;
    if (cfg.targetFormat !== 'modern-neural' && cfg.modelName.length > 11) {
      cfg.modelName = cfg.modelName.slice(0, 11);
    }
  }
  if (changes.workingMode !== undefined) {
    const prevMode = cfg.workingMode ?? 'classic';
    cfg.workingMode = changes.workingMode;
    if (!cfg.expandedName || cfg.expandedName.trim().length === 0) {
      cfg.expandedName = cfg.modelName || 'UNTITLED';
    }
    if (!cfg.modelName || cfg.modelName.trim().length === 0) {
      cfg.modelName = (cfg.expandedName || 'UNTITLED').slice(0, 11);
    }
    if (changes.workingMode === 'extended') {
      if (!ctx.state.session.extendedRegions || ctx.state.session.extendedRegions.length === 0) {
        ctx.state.session.extendedRegions = syncExtendedRegionsFromClassicZones(
          ctx.state.session.zones
        );
      }
      if (!ctx.state.session.articulation) {
        ctx.state.session.articulation = createDefaultArticulation();
      }
    } else if (prevMode === 'extended' && ctx.state.session.extendedRegions?.length) {
      const projected = projectExtendedRegionsToClassicZones(
        ctx.state.session.extendedRegions,
        ctx.state.session.zones,
      );
      ctx.state.session.zones = projected.zones;
    }
  }
  if (changes.keyMappingMode !== undefined) {
    cfg.keyMappingMode = changes.keyMappingMode;
  }
  if (changes.dspAlgorithm !== undefined) {
    cfg.dspAlgorithm = changes.dspAlgorithm === 'enhanced' ? 'enhanced' : 'legacy';
    ctx.state.spectralCache.clear();
  }
  if (changes.masterWaveConfig !== undefined) {
    cfg.masterWaveConfig = {
      ...(cfg.masterWaveConfig ?? DEFAULT_MASTER_WAVE_CONFIG),
      ...changes.masterWaveConfig,
    };
  }
  if (changes.commonPlayback !== undefined) {
    const nextCommon = cloneCommonPlayback({
      ...(cfg.commonPlayback ?? createDefaultCommonPlayback()),
      ...changes.commonPlayback,
    });
    cfg.commonPlayback = nextCommon;
    if (ctx.state.session.extendedRegions) {
      for (const reg of ctx.state.session.extendedRegions) {
        if (!reg.hasPlaybackOverride) {
          reg.loopMode = nextCommon.loopMode;
          reg.pitchKeytrack = nextCommon.pitchKeytrack;
          reg.trigger = nextCommon.trigger;
          reg.fadeCurve = nextCommon.fadeCurve;
        }
      }
    }
  }
  if (changes.coverArtwork !== undefined) {
    cfg.coverArtwork = changes.coverArtwork ? { ...changes.coverArtwork } : null;
  }
  if (changes.aiConfig !== undefined) {
    cfg.aiConfig = {
      ...(cfg.aiConfig ?? DEFAULT_AI_ASSISTANCE_CONFIG),
      ...changes.aiConfig,
    };
  }
  if (changes.unifiedSurfaceConfig !== undefined) {
    cfg.unifiedSurfaceConfig = {
      ...(cfg.unifiedSurfaceConfig ?? {}),
      ...changes.unifiedSurfaceConfig,
    };
  }

  markDirty(ctx);
  return ctx.state.session;
}

export function inspectProcessSources(ctx: PipelineContext): ProcessSourcesInspection {
  const importedSources: string[] = [];
  const newAudioSources: string[] = [];
  const seen = new Set<string>();
  let importedComplexity: number | null = null;

  if (ctx.state.session) {
    for (const z of ctx.state.session.zones) {
      for (const sName of [z.sampleLow, z.sampleHigh]) {
        if (!sName || seen.has(sName)) continue;
        seen.add(sName);
        const imp = ctx.state.importedSourceBinaries.get(sName);
        if (imp) {
          importedSources.push(sName);
          if (importedComplexity === null) {
            importedComplexity = imp.complexity;
          }
        } else {
          newAudioSources.push(sName);
        }
      }
    }
  }

  const currComp = ctx.state.session?.processConfig.complexity ?? 8;
  const complexityChanged =
    importedSources.length > 0 &&
    importedComplexity !== null &&
    currComp !== importedComplexity;

  return {
    importedSources,
    newAudioSources,
    importedComplexity,
    complexityChanged,
  };
}
