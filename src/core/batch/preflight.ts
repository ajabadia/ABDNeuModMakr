// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Phase 12: Batch Preflight Inspection
// ─────────────────────────────────────────────────────────

import type {
  BatchConfig,
  BatchModelCandidate,
} from './types.ts';

export interface BatchPreflightModelItem {
  id: string;
  name: string;
  slug: string;
  sourceOrigin: string;
  fileCount: number;
  fileNames: string[];
  zoneCount: number;
  detectedCategory: string;
  suggestedParameterSet: number;
  selected: boolean;
}

export interface BatchPreflightSummary {
  totalDiscovered: number;
  selectedCount: number;
  totalFiles: number;
  totalBytesEstimate: number;
  estimatedDurationSec: number;
  executionProfile: {
    dspAlgorithm: 'legacy' | 'enhanced';
    dspAlgorithmLabel: string;
    targetFormat: 'dual' | 'legacy-neuron' | 'modern-neural';
    targetFormatLabel: string;
    workingMode: 'classic' | 'extended';
    workingModeLabel: string;
    aiEngineLabel: string;
    complexityLabel: string;
    destinationLabel: string;
    destinationPathOrName: string;
  };
  models: BatchPreflightModelItem[];
}

/**
 * Builds the comprehensive preflight manifest summarizing what the batch processor
 * will do, how it will execute, and which files/models will be processed.
 */
export function buildBatchPreflightSummary(
  candidates: BatchModelCandidate[],
  config: BatchConfig,
  runtimeContext: {
    workingMode: 'classic' | 'extended';
    aiEngineLabel: string;
    selectedIds?: Set<string>;
  }
): BatchPreflightSummary {
  let totalFiles = 0;
  let totalBytesEstimate = 0;

  const models: BatchPreflightModelItem[] = candidates.map((c) => {
    const isSelected = runtimeContext.selectedIds ? runtimeContext.selectedIds.has(c.id) : true;
    const fCount = c.files.length;
    let bytes = 0;
    for (const f of c.files) {
      bytes += f.buffer.byteLength;
    }

    if (isSelected) {
      totalFiles += fCount;
      totalBytesEstimate += bytes;
    }

    return {
      id: c.id,
      name: c.name,
      slug: c.slug,
      sourceOrigin: c.sourceOrigin,
      fileCount: fCount,
      fileNames: c.files.slice(0, 5).map((f) => f.name),
      zoneCount: c.zoneCount,
      detectedCategory: c.detectedCategory,
      suggestedParameterSet: c.suggestedParameterSet,
      selected: isSelected,
    };
  });

  const selectedCount = models.filter((m) => m.selected).length;
  // Estimated duration: ~1.5s per model zone on standard CPU / Web Worker
  const totalZones = candidates
    .filter((c) => (runtimeContext.selectedIds ? runtimeContext.selectedIds.has(c.id) : true))
    .reduce((sum, c) => sum + Math.max(1, c.zoneCount), 0);
  const estimatedDurationSec = Math.max(2, Math.round(totalZones * 1.4));

  const dspAlgorithmLabel =
    config.dspAlgorithm === 'enhanced'
      ? 'Classic Enhanced (Phase 7 YIN/MPM + Spectral Descriptors)'
      : 'Legacy Hartmann 2002 (44.1kHz Mono Radix-2 STFT)';

  const targetFormatLabel =
    config.targetFormat === 'dual'
      ? 'Dual-Target (Classic 5-Layer Time Capsule + Modern Float32)'
      : config.targetFormat === 'modern-neural'
        ? 'Modern Neural (.nmmodel multi-layer Float32)'
        : 'Strict Legacy Neuron (.scape / .sphere / map.script)';

  const workingModeLabel =
    runtimeContext.workingMode === 'extended'
      ? 'Extended Mode (Key x Velocity 2D Regions, loop points & articulation)'
      : 'Classic Mode (Contiguous columns, 2 velocity layers split at 64)';

  const complexityLabel =
    config.complexityStrategy === 'auto'
      ? 'Auto-Adaptive (Assigned per-model by acoustic intelligence)'
      : `Fixed Level ${config.complexityStrategy} (${config.complexityStrategy * 6 + 4} frames / depth)`;

  let destinationLabel = 'Master ZIP Package';
  let destinationPathOrName = config.outputMasterZipName || `BatchExport_${new Date().toISOString().slice(0, 10)}.zip`;

  if (config.destination === 'axionikdb') {
    destinationLabel = 'AxionikDB Local Repository';
    destinationPathOrName = config.axionikDbPath || 'd:\\desarrollos\\ABDSynths\\AxionikDB\\Models';
  } else if (config.destination === 'neurondb') {
    destinationLabel = 'Classic NeuronDB Bank';
    destinationPathOrName = config.neuronDbPath || 'Models/000.model .. 511.model';
  }

  return {
    totalDiscovered: candidates.length,
    selectedCount,
    totalFiles,
    totalBytesEstimate,
    estimatedDurationSec,
    executionProfile: {
      dspAlgorithm: config.dspAlgorithm,
      dspAlgorithmLabel,
      targetFormat: config.targetFormat,
      targetFormatLabel,
      workingMode: runtimeContext.workingMode,
      workingModeLabel,
      aiEngineLabel: runtimeContext.aiEngineLabel,
      complexityLabel,
      destinationLabel,
      destinationPathOrName,
    },
    models,
  };
}
