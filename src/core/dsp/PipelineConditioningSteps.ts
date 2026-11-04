// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Unified Pre-Flight & Batch Pipeline Conditioning Steps
//
// Canonical 15-step checklist builder, per-sample processing ledger
// (`SampleProcessingFlags`), and ordered pre-DSP audio conditioning
// shared by Single-Model (`Generate Neuron Model`) and Multi-Model
// (`Batch Processor`) execution.
// ─────────────────────────────────────────────────────────

import {
  computeNoiseProfile,
  dcBlock,
  detectSilenceRanges,
  normalizePeak,
  peakAmplitude,
} from '@abdsynths/shared/dsp/take/takeDsp.ts';
import { reduceNoiseWithProfile } from '@abdsynths/shared/dsp/take/NoiseReductionDsp.ts';
import {
  resolvePipelineStepExecutionBadge,
  type ExecutionEngineBadge,
  type PipelineStepEngineContext,
} from '../ai/aiHonesty.ts';
import { cloudByokClient } from '../ai/CloudByokClient.ts';
import { generateModelArtwork, type ArtworkProvider } from '../ai/ModelArtworkGenerator.ts';
import { bridgeClient } from '../bridge/BridgeClient.ts';
import { snapFrameToNearestZeroCrossing } from './LoopEditorTools.ts';
import { promoteBufferToMasterWave } from './MasterWaveEnhancer.ts';
import { decodeWav, encodePcm16Wav } from './WavDecoder.ts';
import type {
  AiAssistanceConfig,
  KeyMappingMode,
  ModelCoverArtwork,
  PipelineChecklistSelection,
  PipelineStepId,
  SampleProcessingFlags,
  WorkingMode,
} from '../types.ts';

export interface PipelineStepDescriptor {
  id: PipelineStepId;
  stepNumber: number;
  phase: 0 | 1 | 2 | 3;
  phaseTitle: string;
  title: string;
  description: string;
  /** True when the step cannot be unchecked by the user (mandatory for the current mode/source) */
  mandatory: boolean;
  /** False when the step is not applicable to the current mode/profile/source */
  enabled: boolean;
  /** Current checked state */
  checked: boolean;
  /** Reason pill shown when disabled or conditioned */
  conditionBadge?: string;
  /** Per-sample ledger summary (e.g. "8 pendientes · 2 ya aplicadas") */
  sampleLedgerBadge?: string;
  alreadyProcessedCount: number;
  pendingCount: number;
  /** Resolved execution engine badge (icon, color class, engine tag, model/API name) */
  engineBadge: ExecutionEngineBadge;
}

export interface BuildPipelineChecklistInput {
  workingMode: WorkingMode;
  keyMappingMode: KeyMappingMode;
  isBatchMode: boolean;
  totalModelsCount: number;
  totalSamplesCount: number;
  hasLegacyClassicOnlySources: boolean;
  hasUncoveredMidiKeys: boolean;
  hasExistingCoverArtwork: boolean;
  sampleNames: string[];
  sampleProcessingFlags?: Record<string, SampleProcessingFlags>;
  aiConfig?: AiAssistanceConfig;
  dspAlgorithm?: 'legacy' | 'enhanced';
  engineCtx: PipelineStepEngineContext;
  currentSelection?: PipelineChecklistSelection;
}

export function createDefaultPipelineChecklistSelection(
  input: Pick<
    BuildPipelineChecklistInput,
    | 'workingMode'
    | 'keyMappingMode'
    | 'hasLegacyClassicOnlySources'
    | 'aiConfig'
    | 'dspAlgorithm'
  > & {
    hasExistingCoverArtwork?: boolean;
    isCloudReady?: boolean;
    isBridgeConnected?: boolean;
  }
): PipelineChecklistSelection {
  const isClassic = input.workingMode === 'classic';
  const isDrum = input.keyMappingMode === 'drum';
  const isClassicChromatic = isClassic && !isDrum;
  const aiOn = Boolean(input.aiConfig?.enabled);
  const anyAiForCover = aiOn || Boolean(input.isCloudReady) || Boolean(input.isBridgeConnected);

  return {
    steps: {
      coverageMidi: isClassicChromatic,
      reconstructFromClassic: input.hasLegacyClassicOnlySources,
      sourceSeparation: Boolean(aiOn && input.aiConfig?.separation === 'ai'),
      trimSilence: true,
      deEsser: true,
      denoise: input.aiConfig?.denoise !== 'bypass',
      upsampleMasterWave: !isClassic || Boolean(aiOn && input.aiConfig?.masterWave === 'ai'),
      normalize: true,
      pitchAndLoop: !isDrum,
      acousticClassifier: input.aiConfig?.classifier !== 'manual',
      enhanceClassicModel: (input.dspAlgorithm ?? 'enhanced') === 'enhanced',
      compileClassicModel: true,
      compileExtendedResinator2: !isClassic,
      generateCoverArtwork: !isClassic && !input.hasExistingCoverArtwork && anyAiForCover,
      packageTimeCapsule: true,
    },
    skipAlreadyProcessedSamples: true,
    normalizeGroupRelativeForDrums: isDrum,
  };
}

function countSampleFlag(
  sampleNames: string[],
  flagsMap: Record<string, SampleProcessingFlags> | undefined,
  flagKey: keyof SampleProcessingFlags
): { done: number; pending: number; badge?: string } {
  const total = sampleNames.length;
  if (total === 0) return { done: 0, pending: 0 };
  let done = 0;
  if (flagsMap) {
    for (const s of sampleNames) {
      if (flagsMap[s]?.[flagKey]) done++;
    }
  }
  const pending = Math.max(0, total - done);
  const badge =
    done > 0
      ? `${pending} pendiente(s) · ${done} ya procesada(s)`
      : `${total} muestra(s) lista(s)`;
  return { done, pending, badge };
}

/**
 * Builds the canonical 15-step ordered checklist across the 4 phases for both
 * Single-Model (`Generate Neuron Model`) and Batch (`Batch Processor`).
 */
export function buildPipelineChecklistRows(
  input: BuildPipelineChecklistInput
): PipelineStepDescriptor[] {
  const isClassic = input.workingMode === 'classic';
  const isDrum = input.keyMappingMode === 'drum';
  const sel =
    input.currentSelection ??
    createDefaultPipelineChecklistSelection({
      workingMode: input.workingMode,
      keyMappingMode: input.keyMappingMode,
      hasLegacyClassicOnlySources: input.hasLegacyClassicOnlySources,
      hasExistingCoverArtwork: input.hasExistingCoverArtwork,
      aiConfig: input.aiConfig,
      dspAlgorithm: input.dspAlgorithm,
      isCloudReady: input.engineCtx.isCloudReady,
      isBridgeConnected: input.engineCtx.isBridgeConnected,
    });

  const phase0 = 'FASE 0 — Validación de Mapa MIDI y Capas';
  const phase1 = 'FASE 1 — Restauración y Preparación de Audio Base (Pre-DSP)';
  const phase2 = 'FASE 2 — Clasificación Acústica y Modelo Classic (04_classic_enhanced)';
  const phase3 = 'FASE 3 — Modelo Extended Resinator 2, Carátula IA y Cápsula del Tiempo';

  const cReconstruct = countSampleFlag(
    input.sampleNames,
    input.sampleProcessingFlags,
    'reconstructedFromClassic'
  );
  const cSep = countSampleFlag(
    input.sampleNames,
    input.sampleProcessingFlags,
    'stemSeparated'
  );
  const cTrim = countSampleFlag(
    input.sampleNames,
    input.sampleProcessingFlags,
    'silenceTrimmed'
  );
  const cDeEss = countSampleFlag(
    input.sampleNames,
    input.sampleProcessingFlags,
    'deEssed'
  );
  const cDenoise = countSampleFlag(
    input.sampleNames,
    input.sampleProcessingFlags,
    'denoised'
  );
  const cMaster = countSampleFlag(
    input.sampleNames,
    input.sampleProcessingFlags,
    'upsampledMasterWave'
  );
  const cNorm = countSampleFlag(
    input.sampleNames,
    input.sampleProcessingFlags,
    'normalized'
  );
  const cPitch = countSampleFlag(
    input.sampleNames,
    input.sampleProcessingFlags,
    'pitchDetected'
  );

  const rows: PipelineStepDescriptor[] = [
    // ── FASE 0 ──
    {
      id: 'coverageMidi',
      stepNumber: 1,
      phase: 0,
      phaseTitle: phase0,
      title: isDrum
        ? 'Extensión de Cobertura MIDI (0..127) en Drum Map'
        : 'Revisión de Cobertura MIDI (0..127) y Proyección de Velocidades',
      description:
        isClassic && !isDrum
          ? 'Obligatorio en Modo Classic Cromático: los 341 modelos originales de Hartmann Neuron (map.script) exigen cubrir 0..127 sin huecos y proyectar a 2 capas de velocidad (Low 1..63 / High 64..127).'
          : isDrum
            ? 'En un Drum Map / Percusión no es obligatorio cubrir las 128 teclas: desmarcado conserva exactamente los pads asignados; márcalo solo si deseas estirar los golpes extremos hasta 0 y 127.'
            : 'En Modo Extended Cromático no es obligatorio estirar las notas extremas (la Superficie Espectral Continua calibra todo el rango); márcalo si deseas estirar la primera y última región hasta 0 y 127.',
      mandatory: isClassic && !isDrum,
      enabled: true,
      checked: isClassic && !isDrum ? true : Boolean(sel.steps.coverageMidi),
      conditionBadge:
        isClassic && !isDrum
          ? 'OBLIGATORIO EN CLASSIC CROMÁTICO'
          : isDrum
            ? 'NO REQUERIDO EN DRUM MAP (OPCIONAL)'
            : 'OPCIONAL EN EXTENDED CROMÁTICO',
      alreadyProcessedCount: 0,
      pendingCount: input.totalModelsCount,
      engineBadge: resolvePipelineStepExecutionBadge('coverageMidi', input.engineCtx),
    },

    // ── FASE 1 ──
    {
      id: 'reconstructFromClassic',
      stepNumber: 2,
      phase: 1,
      phaseTitle: phase1,
      title: 'Obtener onda base desde Modelo Classic (02_legacy_original → PCM)',
      description:
        'Sintetiza audio WAV a partir de los parciales .scape/.sphere cuando el proyecto proviene de un modelo vintage sin muestras WAV originales.',
      mandatory: input.hasLegacyClassicOnlySources && !isClassic,
      enabled: input.hasLegacyClassicOnlySources,
      checked: input.hasLegacyClassicOnlySources
        ? Boolean(sel.steps.reconstructFromClassic || !isClassic)
        : false,
      conditionBadge: input.hasLegacyClassicOnlySources
        ? 'FUENTE .MODEL DETECTADA'
        : 'YA TIENE MUESTRAS WAV',
      sampleLedgerBadge: input.hasLegacyClassicOnlySources ? cReconstruct.badge : undefined,
      alreadyProcessedCount: cReconstruct.done,
      pendingCount: input.hasLegacyClassicOnlySources ? cReconstruct.pending : 0,
      engineBadge: resolvePipelineStepExecutionBadge('reconstructFromClassic', input.engineCtx),
    },
    {
      id: 'sourceSeparation',
      stepNumber: 3,
      phase: 1,
      phaseTitle: phase1,
      title: 'Aislamiento de Fuente y De-Bleeding (Separación de Stems)',
      description:
        'Aísla el instrumento principal o limpia sangrado acústico de sala antes de recortar y analizar.',
      mandatory: false,
      enabled: true,
      checked: Boolean(sel.steps.sourceSeparation),
      sampleLedgerBadge: cSep.badge,
      alreadyProcessedCount: cSep.done,
      pendingCount: cSep.pending,
      engineBadge: resolvePipelineStepExecutionBadge('sourceSeparation', input.engineCtx),
    },
    {
      id: 'trimSilence',
      stepNumber: 4,
      phase: 1,
      phaseTitle: phase1,
      title: isDrum
        ? 'Quitar aire previo al golpe (Trim Pre-Attack One-Shot + Cruce por Cero)'
        : 'Quitar silencios de inicio y cola (Trim Silence + Cruce por Cero)',
      description: isDrum
        ? 'Elimina el retardo mudo antes de cada golpe de batería para disparo inmediato sin comerse la caída natural.'
        : 'Va el primero sobre la onda para no desperdiciar frames espectrales del ataque en silencio ni medir suelo vacío al normalizar.',
      mandatory: false,
      enabled: true,
      checked: Boolean(sel.steps.trimSilence),
      sampleLedgerBadge: cTrim.badge,
      alreadyProcessedCount: cTrim.done,
      pendingCount: cTrim.pending,
      engineBadge: resolvePipelineStepExecutionBadge('trimSilence', input.engineCtx),
    },
    {
      id: 'deEsser',
      stepNumber: 5,
      phase: 1,
      phaseTitle: phase1,
      title: 'De-Esser y Supresión de Asperezas (4.5–11 kHz)',
      description:
        'Atenúa sibilancias y resonancias metálicas ANTES de subir a 96 kHz para evitar que el reconstructor de agudos (BWE) las multiplique.',
      mandatory: false,
      enabled: true,
      checked: Boolean(sel.steps.deEsser),
      sampleLedgerBadge: cDeEss.badge,
      alreadyProcessedCount: cDeEss.done,
      pendingCount: cDeEss.pending,
      engineBadge: resolvePipelineStepExecutionBadge('deEsser', input.engineCtx),
    },
    {
      id: 'denoise',
      stepNumber: 6,
      phase: 1,
      phaseTitle: phase1,
      title: 'Reducción de Ruido Estacionario y Filtro DC / Hum (50/60 Hz)',
      description:
        'Limpia soplo de cinta analógica, zumbido eléctrico y desplazamiento DC conservando los armónicos del instrumento.',
      mandatory: false,
      enabled: true,
      checked: Boolean(sel.steps.denoise),
      sampleLedgerBadge: cDenoise.badge,
      alreadyProcessedCount: cDenoise.done,
      pendingCount: cDenoise.pending,
      engineBadge: resolvePipelineStepExecutionBadge('denoise', input.engineCtx),
    },
    {
      id: 'upsampleMasterWave',
      stepNumber: 7,
      phase: 1,
      phaseTitle: phase1,
      title: isDrum
        ? 'Subir de resolución a Master Wave (24-bit / 96.000 Hz + BWE Transitorio)'
        : 'Subir de resolución a Master Wave (24-bit / 96.000 Hz + BWE + Extensión de Muestras Cortas)',
      description: isDrum
        ? 'Promociona los golpes del kit a 24-bit / 96 kHz en 03_enhanced_audio sin añadir bucles artificiales.'
        : 'Promociona las muestras a 24-bit / 96 kHz con reconstrucción de aire armónico y desenrollado orgánico de muestras cortas.',
      mandatory: false,
      enabled: true,
      checked: Boolean(sel.steps.upsampleMasterWave),
      sampleLedgerBadge: cMaster.badge,
      alreadyProcessedCount: cMaster.done,
      pendingCount: cMaster.pending,
      engineBadge: resolvePipelineStepExecutionBadge('upsampleMasterWave', input.engineCtx),
    },
    {
      id: 'normalize',
      stepNumber: 8,
      phase: 1,
      phaseTitle: phase1,
      title: isDrum
        ? 'Normalizar Nivel del Kit (Ganancia Relativa de Grupo a -1.0 dBFS)'
        : 'Normalizar Nivel por Muestra (-1.0 dBFS)',
      description: isDrum
        ? 'Va después del filtrado/96 kHz: aplica la misma ganancia a todo el kit para que el golpe más fuerte llegue a -1 dBFS sin romper el balance entre bombo, caja y platos.'
        : 'Va al final del acondicionamiento de audio (tras De-Esser y 96 kHz) para que todas las zonas entren al analizador espectral con rango dinámico óptimo y sin clipping.',
      mandatory: false,
      enabled: true,
      checked: Boolean(sel.steps.normalize),
      sampleLedgerBadge: cNorm.badge,
      alreadyProcessedCount: cNorm.done,
      pendingCount: cNorm.pending,
      engineBadge: resolvePipelineStepExecutionBadge('normalize', input.engineCtx),
    },
    {
      id: 'pitchAndLoop',
      stepNumber: 9,
      phase: 1,
      phaseTitle: phase1,
      title: 'Detección de Pitch Raíz (F0) y Auto-Loop con Crossfade en Cruce por Cero',
      description: isDrum
        ? 'Omitido en Drum Maps: los golpes percusivos mantienen su tecla asignada sin re-afinación cromática ni bucle de sustain.'
        : 'Detecta la nota fundamental F0 (rootKey + fineTune) y ajusta puntos de bucle estacionarios sin clics.',
      mandatory: false,
      enabled: !isDrum,
      checked: isDrum ? false : Boolean(sel.steps.pitchAndLoop),
      conditionBadge: isDrum ? 'SOLO CROMÁTICO (OMITIDO EN DRUM MAP)' : undefined,
      sampleLedgerBadge: !isDrum ? cPitch.badge : undefined,
      alreadyProcessedCount: cPitch.done,
      pendingCount: isDrum ? 0 : cPitch.pending,
      engineBadge: resolvePipelineStepExecutionBadge('pitchAndLoop', input.engineCtx),
    },

    // ── FASE 2 ──
    {
      id: 'acousticClassifier',
      stepNumber: 10,
      phase: 2,
      phaseTitle: phase2,
      title: 'Clasificación Acústica Automática y Parameter Set (0..9)',
      description:
        'Identifica la familia acústica del instrumento y selecciona el Parameter Set óptimo para Scape y Sphere.',
      mandatory: false,
      enabled: true,
      checked: Boolean(sel.steps.acousticClassifier),
      alreadyProcessedCount: 0,
      pendingCount: input.totalModelsCount,
      engineBadge: resolvePipelineStepExecutionBadge('acousticClassifier', input.engineCtx),
    },
    {
      id: 'enhanceClassicModel',
      stepNumber: 11,
      phase: 2,
      phaseTitle: phase2,
      title: 'Mejorar Modelo Vintage / Classic (Enhanced Spectral DSP)',
      description:
        'Aplica separación armónico-percusiva HPSS, suavizado temporal de trayectorias y puerta de ruido sobre los 64 parciales (desmárcalo para usar el algoritmo Legacy 2001 crudo).',
      mandatory: false,
      enabled: true,
      checked: Boolean(sel.steps.enhanceClassicModel),
      alreadyProcessedCount: 0,
      pendingCount: input.totalModelsCount,
      engineBadge: resolvePipelineStepExecutionBadge('enhanceClassicModel', input.engineCtx),
    },
    {
      id: 'compileClassicModel',
      stepNumber: 12,
      phase: 2,
      phaseTitle: phase2,
      title: 'Generar Modelo Classic (.scape + .sphere + map.script a 64 parciales)',
      description:
        'Compila los binarios IEEE-754 a 44.1 kHz compatibles con el hardware Hartmann Neuron, NeuronVS y modo Classic.',
      mandatory: isClassic,
      enabled: true,
      checked: isClassic ? true : Boolean(sel.steps.compileClassicModel),
      conditionBadge: isClassic ? 'OBLIGATORIO EN CLASSIC' : 'COMPATIBILIDAD DUAL (04_classic_enhanced)',
      alreadyProcessedCount: 0,
      pendingCount: input.totalModelsCount,
      engineBadge: resolvePipelineStepExecutionBadge('compileClassicModel', input.engineCtx),
    },

    // ── FASE 3 ──
    {
      id: 'compileExtendedResinator2',
      stepNumber: 13,
      phase: 3,
      phaseTitle: phase3,
      title: isDrum
        ? 'Generar Modelo Expanded / Resinator 2 (Topología Drum Kit Per-Key + Transitorio Híbrido)'
        : 'Generar Modelo Expanded / Resinator 2 (Superficie Continua 2D + 32..256 Parciales)',
      description: isClassic
        ? 'Deshabilitado en modo Classic. Cambia a modo EXTENDED para compilar axionik-expanded.json con el nuevo motor Resinator 2.'
        : isDrum
          ? 'Compila 05_extended_model/axionik-expanded.json con topología discreta por tecla (sin mezclar timbres entre pads), micro-transitorio PCM en fase, residuo DDSP y tempoSync.'
          : 'Compila 05_extended_model/axionik-expanded.json con Superficie Espectral Unificada (Pitch × Velocity), 32..256 parciales adaptativos, 24 bandas Formant Bark, residuo DDSP y shapers.',
      mandatory: !isClassic,
      enabled: !isClassic,
      checked: !isClassic,
      conditionBadge: isClassic ? 'SOLO MODO EXTENDED' : 'OBLIGATORIO EN EXTENDED',
      alreadyProcessedCount: 0,
      pendingCount: isClassic ? 0 : input.totalModelsCount,
      engineBadge: resolvePipelineStepExecutionBadge('compileExtendedResinator2', input.engineCtx),
    },
    {
      id: 'generateCoverArtwork',
      stepNumber: 14,
      phase: 3,
      phaseTitle: phase3,
      title: 'Generar Carátula del Modelo (cover.webp 512×512)',
      description: isClassic
        ? 'Exclusivo de paquetes Extended / AxionikDB (los slots Classic 000..511 no almacenan portada WebP).'
        : input.hasExistingCoverArtwork && !input.isBatchMode
          ? 'El modelo ya tiene una carátula asignada. Márcalo solo si deseas regenerarla automáticamente.'
          : 'Genera la portada 512×512 WebP acorde al instrumento y categoría acústica usando el motor configurado.',
      mandatory: false,
      enabled: !isClassic,
      checked: isClassic ? false : Boolean(sel.steps.generateCoverArtwork),
      conditionBadge: isClassic
        ? 'SOLO MODO EXTENDED'
        : input.hasExistingCoverArtwork && !input.isBatchMode
          ? 'YA TIENE CARÁTULA'
          : undefined,
      alreadyProcessedCount: input.hasExistingCoverArtwork && !input.isBatchMode ? 1 : 0,
      pendingCount: isClassic ? 0 : input.totalModelsCount,
      engineBadge: resolvePipelineStepExecutionBadge('generateCoverArtwork', input.engineCtx),
    },
    {
      id: 'packageTimeCapsule',
      stepNumber: 15,
      phase: 3,
      phaseTitle: phase3,
      title: 'Empaquetar Cápsula del Tiempo (5 Capas) y Guardar en Destino',
      description:
        'Ensambla 01_raw_source, 02_legacy_original, 03_enhanced_audio, 04_classic_enhanced y 05_extended_model con manifest.json y provenance.json.',
      mandatory: true,
      enabled: true,
      checked: true,
      conditionBadge: 'OBLIGATORIO',
      alreadyProcessedCount: 0,
      pendingCount: input.totalModelsCount,
      engineBadge: resolvePipelineStepExecutionBadge('packageTimeCapsule', input.engineCtx),
    },
  ];

  return rows;
}

/**
 * Dynamic split-band De-Esser (4.5 kHz – 11 kHz) that attenuates harsh sibilant bursts
 * and shrill resonances before 96 kHz upsampling / BWE.
 */
export function applyDynamicBandDeEsserDsp(
  pcm: Float32Array,
  sampleRate: number,
  thresholdDb: number = -22,
  maxReductionDb: number = 7.5
): Float32Array {
  const n = pcm.length;
  if (n < 64) return new Float32Array(pcm);
  const sr = Math.max(8000, sampleRate);

  // Isolate sibilant band (approx 4.5 kHz .. 11 kHz) via cascaded one-pole filters
  const fcLow = Math.min(4500, sr * 0.42);
  const rcLow = 1.0 / (2.0 * Math.PI * fcLow);
  const dt = 1.0 / sr;
  const alphaLow = dt / (rcLow + dt);

  const fcHigh = Math.min(11500, sr * 0.48);
  const rcHigh = 1.0 / (2.0 * Math.PI * fcHigh);
  const alphaHigh = dt / (rcHigh + dt);

  const out = new Float32Array(n);
  const threshLin = Math.pow(10, thresholdDb / 20);
  const minGain = Math.pow(10, -Math.abs(maxReductionDb) / 20);
  const attackCoeff = Math.exp(-1.0 / (0.0015 * sr));
  const releaseCoeff = Math.exp(-1.0 / (0.035 * sr));

  let lpLow = 0;
  let lpHigh = 0;
  let envSib = 0;
  let envFull = 0;

  for (let i = 0; i < n; i++) {
    const x = pcm[i];
    lpLow += alphaLow * (x - lpLow);
    lpHigh += alphaHigh * (x - lpHigh);
    const sibBand = lpHigh - lpLow;
    const restBand = x - sibBand;

    const absSib = Math.abs(sibBand);
    const absFull = Math.abs(x);
    envSib = absSib > envSib ? attackCoeff * envSib + (1 - attackCoeff) * absSib : releaseCoeff * envSib;
    envFull = 0.995 * envFull + 0.005 * absFull;

    // Trigger compression when sibilant band exceeds threshold and dominates broadband energy
    let gain = 1.0;
    if (envSib > threshLin && envSib > envFull * 0.38) {
      const overRatio = envSib / Math.max(1e-6, threshLin);
      const rawGain = 1.0 / Math.sqrt(overRatio);
      gain = Math.max(minGain, Math.min(1.0, rawGain));
    }
    out[i] = restBand + sibBand * gain;
  }

  return out;
}

/**
 * Executes the selected Phase 1 pre-DSP conditioning steps on a map of sample buffers
 * in canonical order (Trim Silence -> De-Esser -> Denoise -> Upsample 96kHz -> Normalize),
 * updating `sampleProcessingFlags` per sample and skipping already-marked samples when requested.
 */
export async function executeCanonicalPhase1SampleConditioning(params: {
  samples: Map<string, ArrayBuffer>;
  checklist: PipelineChecklistSelection;
  keyMappingMode: KeyMappingMode;
  sampleFlags: Record<string, SampleProcessingFlags>;
  aiConfig?: AiAssistanceConfig | null;
  onSampleEnhanced?: (sampleName: string, enhancedWav: ArrayBuffer) => void;
}): Promise<void> {
  const { samples, checklist, keyMappingMode, sampleFlags, aiConfig, onSampleEnhanced } = params;
  const skipDone = checklist.skipAlreadyProcessedSamples !== false;
  const isDrum = keyMappingMode === 'drum';
  const nowIso = new Date().toISOString();
  const bridgeOnline = bridgeClient.isConnected();

  const ensureFlags = (name: string): SampleProcessingFlags => {
    if (!sampleFlags[name]) {
      sampleFlags[name] = {};
    }
    return sampleFlags[name];
  };

  // Pass 1: Source Separation -> Trim Silence -> De-Esser -> Denoise -> Master Wave 96 kHz per sample
  for (const [sName, initialAb] of Array.from(samples.entries())) {
    if (sName.endsWith('.mid')) continue;
    const flags = ensureFlags(sName);
    let rawAb = initialAb;

    // Step 3: Source Separation / De-bleeding (HTDemucs Local AI if enabled & online)
    if (checklist.steps.sourceSeparation && (!skipDone || !flags.stemSeparated)) {
      if (aiConfig?.enabled && aiConfig.separation === 'ai' && bridgeOnline) {
        try {
          const sepRes = await bridgeClient.separateStems(rawAb, {
            stems: ['instrumental'],
            filename: sName,
          });
          if (sepRes.stems?.instrumental) {
            rawAb = sepRes.stems.instrumental;
            samples.set(sName, rawAb);
            onSampleEnhanced?.(sName, rawAb);
          }
        } catch {
          // keep original buffer on bridge error
        }
      }
      flags.stemSeparated = true;
      flags.updatedAt = nowIso;
    }

    let decoded: ReturnType<typeof decodeWav>;
    try {
      decoded = decodeWav(rawAb);
    } catch {
      continue;
    }
    if (!decoded.mono || decoded.mono.length < 64) continue;

    let working: Float32Array = new Float32Array(decoded.mono);
    let sr = decoded.sampleRate;
    let modified = false;

    // Step 4: Trim Silence + Zero-Crossing Snap
    if (checklist.steps.trimSilence && (!skipDone || !flags.silenceTrimmed)) {
      const silenceRanges = detectSilenceRanges(working, sr, {
        thresholdDb: isDrum ? -48 : -46,
        minSilenceMs: isDrum ? 25 : 60,
        hangoverMs: isDrum ? 40 : 30,
      });
      let startFrame = 0;
      let endFrame = working.length;
      for (const r of silenceRanges) {
        if (r.startFrame === 0) {
          // In Drum Map mode, preserve a 0.5ms pre-attack cushion
          const cushionFrames = isDrum ? Math.round(sr * 0.0005) : 0;
          startFrame = Math.max(0, r.endFrame - cushionFrames);
        }
        if (!isDrum && r.endFrame >= working.length) {
          endFrame = Math.min(endFrame, r.startFrame);
        }
      }
      if (endFrame > startFrame + 64 && (startFrame > 0 || endFrame < working.length)) {
        startFrame = snapFrameToNearestZeroCrossing(working, startFrame, 256);
        endFrame = snapFrameToNearestZeroCrossing(working, endFrame, 256);
        if (endFrame > startFrame + 64) {
          working = working.slice(startFrame, endFrame);
          modified = true;
        }
      }
      flags.silenceTrimmed = true;
      flags.updatedAt = nowIso;
    }

    // Step 5: De-Esser (4.5 - 11 kHz) BEFORE upsampling
    if (checklist.steps.deEsser && (!skipDone || !flags.deEssed)) {
      working = applyDynamicBandDeEsserDsp(working, sr);
      flags.deEssed = true;
      flags.updatedAt = nowIso;
      modified = true;
    }

    // Step 6: Denoise + DC Block / Hum Removal (DeepFilterNet 3 Local AI or Spectral Gate DSP)
    if (checklist.steps.denoise && (!skipDone || !flags.denoised)) {
      let denoisedViaAi = false;
      if (aiConfig?.enabled && aiConfig.denoise === 'ai' && bridgeOnline) {
        try {
          const tempWav = encodePcm16Wav(working, sr, decoded.instrument);
          const enhanced = await bridgeClient.enhanceAudio(new Uint8Array(tempWav), {
            targetSampleRate: sr,
            capabilities: ['spectral-denoise', 'deepfilter'],
          });
          const aiBuf = enhanced.buffer.slice(
            enhanced.byteOffset,
            enhanced.byteOffset + enhanced.byteLength
          ) as ArrayBuffer;
          const aiDec = decodeWav(aiBuf);
          if (aiDec.mono && aiDec.mono.length > 64) {
            working = new Float32Array(aiDec.mono);
            sr = aiDec.sampleRate;
            denoisedViaAi = true;
            modified = true;
          }
        } catch {
          // Fallback to deterministic DSP denoise
        }
      }
      if (!denoisedViaAi) {
        working = dcBlock(working, sr);
        const headLen = Math.min(working.length, Math.max(64, Math.round(sr * 0.1)));
        const np = computeNoiseProfile(working.subarray(0, headLen), sr);
        if (Number.isFinite(np.levelDbfs) && np.levelDbfs > -85) {
          working = reduceNoiseWithProfile(working, sr, np, {
            reductionDb: 9,
            removeHum: true,
          });
        }
        modified = true;
      }
      flags.denoised = true;
      flags.updatedAt = nowIso;
    }

    // Step 7: Upsample to Master Wave (24-bit / 96.000 Hz + BWE + Short Loop Expansion for Chromatic)
    if (checklist.steps.upsampleMasterWave && (!skipDone || !flags.upsampledMasterWave)) {
      let upsampledViaAi = false;
      if (aiConfig?.enabled && aiConfig.masterWave === 'ai' && bridgeOnline) {
        try {
          const tempWav = encodePcm16Wav(working, sr, decoded.instrument);
          const enhanced = await bridgeClient.enhanceAudio(new Uint8Array(tempWav), {
            targetSampleRate: 96000,
            capabilities: ['resample-96k', 'harmonic-bwe'],
          });
          const aiBuf = enhanced.buffer.slice(
            enhanced.byteOffset,
            enhanced.byteOffset + enhanced.byteLength
          ) as ArrayBuffer;
          const aiDec = decodeWav(aiBuf);
          if (aiDec.mono && aiDec.mono.length > 64) {
            working = new Float32Array(aiDec.mono);
            sr = aiDec.sampleRate;
            upsampledViaAi = true;
            modified = true;
          }
        } catch {
          // Fallback to DSP Master Wave promotion
        }
      }
      if (!upsampledViaAi) {
        try {
          const tempWav = encodePcm16Wav(working, sr, decoded.instrument);
          const promoted = await promoteBufferToMasterWave(tempWav, sName, 'zone-cond', {
            promotionMethod: 'dsp-enhanced',
            channelLayout: 'original',
            targetSampleRate: 96000,
            targetBitDepth: 24,
            minLoopDurationSec: isDrum ? 0 : 3.0,
            enableBandwidthExtension: true,
            enableDenoiseGate: false,
          });
          if (promoted.channels[0] && promoted.channels[0].length > 0) {
            working = new Float32Array(promoted.channels[0]);
            sr = promoted.result.masterSampleRate;
            modified = true;
          }
        } catch {
          // Fallback: keep current working buffer if promotion fails
        }
      }
      flags.upsampledMasterWave = true;
      flags.updatedAt = nowIso;
    }

    if (modified) {
      const encoded = encodePcm16Wav(working, sr, decoded.instrument);
      samples.set(sName, encoded);
      onSampleEnhanced?.(sName, encoded);
    }
  }

  // Pass 2: Step 8 — Normalize (Relative Group Peak for Drum Maps, or Per-Sample Peak for Chromatic)
  if (checklist.steps.normalize) {
    if (isDrum && checklist.normalizeGroupRelativeForDrums !== false) {
      // Find maximum peak across the entire drum kit so relative mix balance is preserved
      let maxKitPeak = 0;
      const targets: Array<{ name: string; decoded: ReturnType<typeof decodeWav> }> = [];
      for (const [sName, ab] of samples.entries()) {
        if (sName.endsWith('.mid')) continue;
        const flags = ensureFlags(sName);
        if (skipDone && flags.normalized) continue;
        try {
          const dec = decodeWav(ab);
          if (dec.mono && dec.mono.length > 0) {
            const pk = peakAmplitude(dec.mono);
            if (pk > maxKitPeak) maxKitPeak = pk;
            targets.push({ name: sName, decoded: dec });
          }
        } catch {
          // ignore non-wav
        }
      }
      const targetPeakLin = Math.pow(10, -1.0 / 20); // -1.0 dBFS
      if (maxKitPeak > 1e-5 && Math.abs(maxKitPeak - targetPeakLin) > 1e-3) {
        const groupGain = targetPeakLin / maxKitPeak;
        for (const t of targets) {
          const scaled = new Float32Array(t.decoded.mono.length);
          for (let i = 0; i < scaled.length; i++) {
            scaled[i] = Math.max(-1, Math.min(1, t.decoded.mono[i] * groupGain));
          }
          const encoded = encodePcm16Wav(scaled, t.decoded.sampleRate, t.decoded.instrument);
          samples.set(t.name, encoded);
          onSampleEnhanced?.(t.name, encoded);
          const flags = ensureFlags(t.name);
          flags.normalized = true;
          flags.updatedAt = nowIso;
        }
      }
    } else {
      // Chromatic / per-sample normalization to -1.0 dBFS
      for (const [sName, ab] of Array.from(samples.entries())) {
        if (sName.endsWith('.mid')) continue;
        const flags = ensureFlags(sName);
        if (skipDone && flags.normalized) continue;
        try {
          const dec = decodeWav(ab);
          if (dec.mono && dec.mono.length > 0) {
            const norm = normalizePeak(dec.mono, -1.0);
            const encoded = encodePcm16Wav(norm, dec.sampleRate, dec.instrument);
            samples.set(sName, encoded);
            onSampleEnhanced?.(sName, encoded);
            flags.normalized = true;
            flags.updatedAt = nowIso;
          }
        } catch {
          // ignore
        }
      }
    }
  }
}

/**
 * Generates 512x512 WebP Cover Artwork during the pipeline (Step 14) according to
 * the configured AI stage (`local-ai` -> Companion Bridge SD-Turbo, `cloud-ai` -> Cloud BYOK,
 * or `procedural` -> Deterministic Canvas Spectrogram), falling back safely to procedural
 * if the remote/local AI endpoint fails.
 */
export async function generatePipelineModelArtwork(params: {
  modelName: string;
  expandedName?: string;
  parameterSet?: number;
  category?: string;
  sampleNames?: string[];
  aiConfig?: AiAssistanceConfig | null;
}): Promise<ModelCoverArtwork | null> {
  const mode = params.aiConfig?.enabled ? (params.aiConfig.coverArtwork ?? 'procedural') : 'procedural';
  let preferredProvider: ArtworkProvider = 'procedural';

  if (mode === 'local-ai' && bridgeClient.isConnected()) {
    preferredProvider = 'bridge';
  } else if (mode === 'cloud-ai') {
    const byokCfg = cloudByokClient.getConfig();
    if (byokCfg.geminiApiKey?.trim()) preferredProvider = 'gemini';
    else if (byokCfg.openaiApiKey?.trim()) preferredProvider = 'openai';
    else if (byokCfg.openrouterApiKey?.trim()) preferredProvider = 'openrouter';
    else if (byokCfg.huggingfaceToken?.trim()) preferredProvider = 'huggingface';
    else if (byokCfg.replicateToken?.trim()) preferredProvider = 'replicate';
    else if (byokCfg.claudeApiKey?.trim()) preferredProvider = 'claude';
  }

  const res = await generateModelArtwork({
    modelName: params.modelName,
    expandedName: params.expandedName || params.modelName,
    parameterSet: params.parameterSet ?? 0,
    category: params.category,
    sampleNames: params.sampleNames,
    style: 'cyberpunk',
    provider: preferredProvider,
  });

  if (res.success && res.coverArtwork) {
    return res.coverArtwork;
  }

  // Fallback to procedural 512x512 WebP if local/cloud provider failed
  if (preferredProvider !== 'procedural') {
    const fallback = await generateModelArtwork({
      modelName: params.modelName,
      expandedName: params.expandedName || params.modelName,
      parameterSet: params.parameterSet ?? 0,
      category: params.category,
      sampleNames: params.sampleNames,
      style: 'cyberpunk',
      provider: 'procedural',
    });
    if (fallback.success && fallback.coverArtwork) {
      return fallback.coverArtwork;
    }
  }

  return null;
}
