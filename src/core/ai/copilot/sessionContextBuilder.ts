// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — sessionContextBuilder
// Ultra-fast (<2ms) deterministic snapshot for Copilot HUD and LLM
// ─────────────────────────────────────────────────────────

import type { CoreService } from '../../CoreService.ts';
import type { KbArticle } from '../../../../vendor/@abdsynths/shared/Code/AiCore/kbSearch.ts';
import { CANONICAL_UI_TARGETS, buildNeuronSystemPrompt, getNeuronKnowledgeBase } from './neuronManualKb.ts';

export interface HostContextSnapshot {
  activeScope?: string;
  systemPromptBase: string;
  knowledgeBase: readonly KbArticle[];
  sessionSnapshot: Record<string, unknown>;
  allowedUiTargets: readonly string[];
  nowPlayingSummary: string;
  nextActionChecklist: Array<{ text: string; done: boolean; targetSpot?: string }>;
  suggestedPrompts: string[];
  stateSnapshot: {
    workingMode: 'classic' | 'extended';
    modelName: string;
    expandedName: string;
    parameterSet: number;
    parameterSetName: string;
    complexity: number;
    recDepth: number;
    dspAlgorithm: 'legacy' | 'enhanced';
    zoneCount: number;
    extendedRegionCount: number;
    loadedSamplesCount: number;
    bridgeConnected: boolean;
    coverageIssuesCount: number;
    activeZone?: {
      index: number;
      lowKey: number;
      rootKey: number;
      highKey: number;
      sampleName: string;
      detectedF0Hz: number;
      durationSec: number;
      hasLoop: boolean;
    };
    zonesOverview: string[];
    activeModal: string;
  };
  acousticSnapshot: {
    detectedF0Hz?: number;
    instrumentClass?: string;
  };
}

const PARAMETER_SET_NAMES = [
  'Synth & Neutral',
  'Strings / Winds & Brass',
  'Keyboards',
  'Plucked',
  'Bass',
  'Winds & Voice',
  'Pads & Textures',
  'Mallets & Bells',
  'Drums & Loop Factory',
  'SFX & Experimental',
];

const REC_DEPTH_TABLE = [1, 4, 8, 12, 16, 24, 32, 42, 54, 64];

export function buildSessionContext(core: CoreService, activeModalName = 'none'): HostContextSnapshot {
  const session = core.getSession();
  const config = session?.processConfig;
  const zones = session?.zones || [];
  const extRegions = session?.extendedRegions || [];
  const pSet = Math.max(0, Math.min(9, config?.parameterSet ?? 0));
  const cVal = Math.max(1, Math.min(10, config?.complexity ?? 5));
  const rDepth = REC_DEPTH_TABLE[cVal - 1] ?? 16;
  const workingMode = config?.workingMode || 'classic';

  let loadedSamples = 0;
  for (const z of zones) {
    if (z.sampleLow || z.sampleHigh) {
      loadedSamples++;
    }
  }

  const cov = core.validateCoverage ? core.validateCoverage() : [];
  const covErrors = Array.isArray(cov) ? cov.length : 0;

  // Active zone
  const activeZ = zones[0];
  let activeZoneData: HostContextSnapshot['stateSnapshot']['activeZone'];
  if (activeZ) {
    activeZoneData = {
      index: 0,
      lowKey: activeZ.lowKey,
      rootKey: activeZ.rootKey,
      highKey: activeZ.highKey,
      sampleName: activeZ.sampleLow || activeZ.sampleHigh || 'Sin muestra',
      detectedF0Hz: 0,
      durationSec: 0,
      hasLoop: false,
    };
  }

  // First 12 zones summary
  const zonesOverview = zones.slice(0, 12).map((z, i) => {
    const sName = (z.sampleLow || z.sampleHigh) ? `"${z.sampleLow || z.sampleHigh}"` : 'vacía';
    return `z${i}: [${z.lowKey}..${z.highKey}] root=${z.rootKey} ${sName}`;
  });
  if (zones.length > 12) {
    zonesOverview.push(`... y ${zones.length - 12} zonas más`);
  }

  // Dynamic suggested prompts
  const suggestedPrompts: string[] = [];
  if (loadedSamples === 0) {
    suggestedPrompts.push('¿Cómo creo mi primer modelo?');
    suggestedPrompts.push('Diferencia entre Classic y Extended');
    suggestedPrompts.push('Abrir Asistente para Músicos');
  } else if (covErrors > 0) {
    suggestedPrompts.push('Reparar huecos MIDI en el teclado');
    suggestedPrompts.push('Recomendar Parameter Set y Complejidad');
    suggestedPrompts.push('Revisar zonas antes de compilar');
  } else if (activeModalName === 'loop-editor') {
    suggestedPrompts.push('¿Cómo evito clics en este bucle?');
    suggestedPrompts.push('Aplicar auto-loop a todas las zonas');
  } else {
    suggestedPrompts.push('Revisar si está óptimo para compilar');
    suggestedPrompts.push('Sugerir Parameter Set según mis muestras');
    suggestedPrompts.push('Abrir compilación Preflight');
  }

  // Checklist
  const nextActionChecklist = [
    {
      text: loadedSamples > 0 ? `${loadedSamples} muestra(s) cargada(s)` : 'Importar muestras de audio',
      done: loadedSamples > 0,
      targetSpot: 'nav-import-samples',
    },
    {
      text: covErrors === 0 ? 'Cobertura de teclado 0..127 completa' : `${covErrors} error(es) de cobertura MIDI`,
      done: covErrors === 0,
      targetSpot: 'btn-auto-repair',
    },
    {
      text: `Compilar modelo "${config?.modelName || 'Model'}"`,
      done: false,
      targetSpot: 'process-start-btn',
    },
  ];

  const nowPlayingSummary = loadedSamples === 0
    ? 'Sesión vacía. Importa archivos WAV/AIFF o abre el Asistente para Músicos.'
    : `Modelo "${config?.modelName || 'Model'}" (${workingMode.toUpperCase()}) con ${zones.length} zonas en Parameter Set ${pSet} (${PARAMETER_SET_NAMES[pSet]}).`;

  const stateSnapshot = {
    workingMode,
    modelName: config?.modelName || 'Model',
    expandedName: config?.expandedName || '',
    parameterSet: pSet,
    parameterSetName: PARAMETER_SET_NAMES[pSet] || 'Unknown',
    complexity: cVal,
    recDepth: rDepth,
    dspAlgorithm: config?.dspAlgorithm || 'enhanced',
    zoneCount: zones.length,
    extendedRegionCount: extRegions.length,
    loadedSamplesCount: loadedSamples,
    bridgeConnected: false,
    coverageIssuesCount: covErrors,
    activeZone: activeZoneData,
    zonesOverview,
    activeModal: activeModalName,
  };

  return {
    activeScope: activeModalName !== 'none' ? activeModalName : 'global',
    systemPromptBase: buildNeuronSystemPrompt('es'),
    knowledgeBase: getNeuronKnowledgeBase('es'),
    sessionSnapshot: stateSnapshot,
    allowedUiTargets: CANONICAL_UI_TARGETS,
    nowPlayingSummary,
    nextActionChecklist,
    suggestedPrompts,
    stateSnapshot,
    acousticSnapshot: {
      detectedF0Hz: activeZoneData?.detectedF0Hz,
      instrumentClass: PARAMETER_SET_NAMES[pSet],
    },
  };
}
