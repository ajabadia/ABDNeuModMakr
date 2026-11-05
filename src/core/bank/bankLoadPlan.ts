// ---------------------------------------------------------
// ABDNeuModMakr - Fase 42.5: Bank Load Plan
// Ensamblado puro del plan de carga: validacion y fallback. Sin estado.
// ---------------------------------------------------------

import type {
  ZoneBinaryPair,
} from '../dsp/PipelineRunner.ts';
import type {
  GeneratedModel,
  ProcessConfig,
  Zone,
} from '../types.ts';

export type BankLoadIssue = 'NOT_FOUND' | 'NO_BINARIES' | 'MISMATCH' | 'NO_ZONES';

export class BankLoadError extends Error {
  readonly code: BankLoadIssue;
  constructor(code: BankLoadIssue, message: string) {
    super(message);
    this.name = 'BankLoadError';
    this.code = code;
  }
}

export interface BankLoadZone {
  lowKey: number;
  rootKey: number;
  highKey: number;
  sampleLow: string;
  sampleHigh: string | null;
}

export interface BankLoadPlan {
  zones: BankLoadZone[];
  processConfig: ProcessConfig;
  /** Ordered unique sample names, aligned 1:1 with the stored binaries. */
  sampleOrder: string[];
}

interface NeuronikZoneJson {
  lowKey?: unknown;
  rootKey?: unknown;
  highKey?: unknown;
  sampleName?: unknown;
  sampleHigh?: unknown;
}

function readNeuronikZones(json: string | undefined): BankLoadZone[] | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as { zones?: NeuronikZoneJson[] };
    if (!parsed || !Array.isArray(parsed.zones) || parsed.zones.length === 0) return null;
    const zones: BankLoadZone[] = [];
    for (const z of parsed.zones) {
      if (
        typeof z?.lowKey !== 'number' ||
        typeof z?.rootKey !== 'number' ||
        typeof z?.highKey !== 'number' ||
        typeof z?.sampleName !== 'string' ||
        z.sampleName.length === 0
      ) {
        return null;
      }
      zones.push({
        lowKey: z.lowKey,
        rootKey: z.rootKey,
        highKey: z.highKey,
        sampleLow: z.sampleName,
        sampleHigh: typeof z.sampleHigh === 'string' && z.sampleHigh.length > 0 ? z.sampleHigh : null,
      });
    }
    return zones;
  } catch {
    return null;
  }
}

/**
 * Pure assembly for full-session model loads. Maps a bank record +
 * its cached binaries to zones, config and the sample order aligned
 * with the binaries. Throws `BankLoadError` — never touches session,
 * storage or DSP, so it is unit-testable in Node.
 */
export function buildBankLoadPlan(
  model: GeneratedModel | undefined,
  binaries: ZoneBinaryPair[] | undefined
): BankLoadPlan {
  if (!model) {
    throw new BankLoadError('NOT_FOUND', 'Model is not in the bank.');
  }
  const zones =
    readNeuronikZones(model.neuronikModelJson) ??
    (model.zonesAnalysis ?? []).map((s) => ({
      lowKey: s.lowKey,
      rootKey: s.rootKey,
      highKey: s.highKey,
      sampleLow: s.sampleName,
      sampleHigh: null as string | null,
    }));
  if (zones.length === 0) {
    throw new BankLoadError(
      'NO_ZONES',
      `Model "${model.name}" has no zone data to load.`
    );
  }
  if (!binaries || binaries.length === 0) {
    throw new BankLoadError(
      'NO_BINARIES',
      `Model "${model.name}" has no compiled audio cached (the bank was restored without binaries). Re-import or regenerate it.`
    );
  }
  const sampleOrder: string[] = [];
  const seen = new Set<string>();
  for (const z of zones) {
    for (const name of [z.sampleLow, z.sampleHigh]) {
      if (name && !seen.has(name)) {
        seen.add(name);
        sampleOrder.push(name);
      }
    }
  }
  if (sampleOrder.length !== binaries.length) {
    throw new BankLoadError(
      'MISMATCH',
      `Model "${model.name}" binary cache does not match its zone layout (${binaries.length} binaries for ${sampleOrder.length} samples). Re-import or regenerate it.`
    );
  }
  return {
    zones,
    processConfig: {
      modelName: model.name,
      expandedName: model.name,
      modelNumber: model.slot,
      parameterSet: model.parameterSet,
      complexity: model.complexity,
      targetFormat: model.targetFormat ?? 'dual',
      ...(model.coverWebpDataUrl
        ? {
            workingMode: 'extended' as const,
            coverArtwork: {
              webpDataUrl: model.coverWebpDataUrl,
              byteLength: Math.round((model.coverWebpDataUrl.length * 3) / 4),
              width: 512,
              height: 512,
              originalName: `${model.name}.webp`,
              updatedAt: model.createdAt,
            },
          }
        : {}),
    },
    sampleOrder,
  };
}

/**
 * Fallback assembly for legacy or localStorage-only bank models whose
 * `.scape`/`.sphere` binary cache was not persisted or differs in count.
 * Reconstructs the full zone layout from `neuronikModelJson`, `zonesAnalysis`,
 * `legacyZones`, or `zoneCount` so older models can always be loaded into the editor.
 */
export function buildFallbackBankLoadPlan(
  model: GeneratedModel,
  legacyZones?: Zone[]
): BankLoadPlan {
  let zones: BankLoadZone[] =
    readNeuronikZones(model.neuronikModelJson) ??
    (model.zonesAnalysis ?? [])
      .filter((s) => typeof s?.sampleName === 'string' && s.sampleName.length > 0)
      .map((s) => ({
        lowKey: s.lowKey,
        rootKey: s.rootKey,
        highKey: s.highKey,
        sampleLow: s.sampleName,
        sampleHigh: null as string | null,
      }));

  if (zones.length === 0 && legacyZones && legacyZones.length > 0) {
    zones = legacyZones.map((z, idx) => ({
      lowKey: z.lowKey,
      rootKey: z.rootKey,
      highKey: z.highKey,
      sampleLow: z.sampleLow || `${model.name}_Z${idx + 1}.wav`,
      sampleHigh: z.sampleHigh ?? null,
    }));
  }

  if (zones.length === 0) {
    const count = Math.max(1, Math.min(128, model.zoneCount || 1));
    const safePrefix = model.name.replace(/[^A-Za-z0-9_-]/g, '_') || `Model_${model.slot}`;
    zones = [];
    for (let i = 0; i < count; i++) {
      const lowKey = Math.round((i * 128) / count);
      const highKey = i === count - 1 ? 127 : Math.max(lowKey, Math.round(((i + 1) * 128) / count) - 1);
      const rootKey = count === 1 ? 60 : Math.min(127, Math.max(0, Math.round((lowKey + highKey) * 0.5)));
      zones.push({
        lowKey,
        rootKey,
        highKey,
        sampleLow: `${safePrefix}_Z${String(i + 1).padStart(2, '0')}_k${rootKey}.wav`,
        sampleHigh: null,
      });
    }
  }

  const sampleOrder: string[] = [];
  const seen = new Set<string>();
  for (const z of zones) {
    for (const name of [z.sampleLow, z.sampleHigh]) {
      if (name && !seen.has(name)) {
        seen.add(name);
        sampleOrder.push(name);
      }
    }
  }

  return {
    zones,
    processConfig: {
      modelName: model.name.slice(0, 11) || 'UNTITLED',
      expandedName: model.name,
      modelNumber: model.slot,
      parameterSet: model.parameterSet,
      complexity: model.complexity,
      targetFormat: model.targetFormat ?? 'dual',
      ...(model.coverWebpDataUrl
        ? {
            workingMode: 'extended' as const,
            coverArtwork: {
              webpDataUrl: model.coverWebpDataUrl,
              byteLength: Math.round((model.coverWebpDataUrl.length * 3) / 4),
              width: 512,
              height: 512,
              originalName: `${model.name}.webp`,
              updatedAt: model.createdAt,
            },
          }
        : {}),
    },
    sampleOrder,
  };
}
