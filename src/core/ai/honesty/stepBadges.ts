// ─────────────────────────────────────────────────────────
// AI honesty — per-pipeline-step execution engine badges.
// ─────────────────────────────────────────────────────────

import type { PipelineStepId } from '../../types.ts';
import type { ExecutionEngineBadge, PipelineStepEngineContext } from './types';

function isBridgeModelAvailable(
  ctx: PipelineStepEngineContext,
  modelId: string
): boolean {
  if (!ctx.isBridgeConnected) return false;
  if (!ctx.installedBridgeModelIds || ctx.installedBridgeModelIds.size === 0) {
    // If bridge is connected and models catalog hasn't been restricted or downloads on demand
    return true;
  }
  return ctx.installedBridgeModelIds.has(modelId);
}

/**
 * Resolves the visual badge (icon, color class, engine tag, and model name) for each step
 * of the unified Pre-Flight & Batch Pipeline Checklist based on user AI config, installed
 * local Bridge models, and configured Cloud BYOK API keys.
 */

export function resolvePipelineStepExecutionBadge(
  stepId: PipelineStepId,
  ctx: PipelineStepEngineContext
): ExecutionEngineBadge {
  const aiOn = Boolean(ctx.aiConfig?.enabled);
  const cloudName = (ctx.cloudProviderLabel || 'Cloud BYOK').toUpperCase();

  switch (stepId) {
    case 'coverageMidi':
      return {
        kind: 'native-rule',
        iconKey: 'lock',
        shortLabel: 'REGLA NATIVA',
        modelOrEngineName: 'Validador KeySplit 0..127 & Proyección de Velocidades',
        cssClass: 'engine-badge--native',
        tooltip: 'Validación geométrica de zonas MIDI y adaptación de capas de velocidad.',
        isBatchStageGroupedLocalAi: false,
      };

    case 'reconstructFromClassic':
      return {
        kind: 'dsp',
        iconKey: 'cpu',
        shortLabel: 'SÍNTESIS DSP',
        modelOrEngineName: 'Reconstrucción Aditiva desde .scape/.sphere (02_legacy_original)',
        cssClass: 'engine-badge--dsp',
        tooltip: 'Sintetiza onda PCM determinista a partir de los parciales del modelo Classic original.',
        isBatchStageGroupedLocalAi: false,
      };

    case 'sourceSeparation': {
      const wantsAi = aiOn && ctx.aiConfig?.separation === 'ai';
      if (wantsAi) {
        if (isBridgeModelAvailable(ctx, 'htdemucs')) {
          return {
            kind: 'local-ai',
            iconKey: 'ai',
            shortLabel: 'IA LOCAL · GPU',
            modelOrEngineName: 'HTDemucs v4 (Bridge 7860)',
            cssClass: 'engine-badge--local-ai',
            tooltip: 'Separación neuronal con HTDemucs v4 en GPU local. En Batch se ejecuta seguido para todo el lote manteniendo el modelo caliente en VRAM.',
            isBatchStageGroupedLocalAi: true,
          };
        }
        return {
          kind: 'fallback-dsp',
          iconKey: 'alert',
          shortLabel: 'FALLBACK → DSP',
          modelOrEngineName: !ctx.isBridgeConnected
            ? 'HTDemucs (Bridge desconectado → HPSS DSP)'
            : 'HTDemucs no descargado → HPSS Mediana DSP',
          cssClass: 'engine-badge--fallback',
          tooltip: 'Configurado en IA, pero el modelo local HTDemucs no está disponible. Se ejecutará Separación Mediana HPSS determinista.',
          isBatchStageGroupedLocalAi: false,
        };
      }
      return {
        kind: 'dsp',
        iconKey: 'cpu',
        shortLabel: 'DETERMINISTA · DSP',
        modelOrEngineName: 'Separación Armónico/Percusiva (HPSS Mediana)',
        cssClass: 'engine-badge--dsp',
        tooltip: 'Separación matemática determinista mediante filtrado de mediana sobre el espectrograma STFT.',
        isBatchStageGroupedLocalAi: false,
      };
    }

    case 'trimSilence':
      return {
        kind: 'dsp',
        iconKey: 'cpu',
        shortLabel: 'DETERMINISTA · DSP',
        modelOrEngineName: 'Detector de Umbral RMS (-54 dB) + Cruce por Cero (ZC)',
        cssClass: 'engine-badge--dsp',
        tooltip: 'Recorte exacto de silencio inicial/final en cruce por cero sin alterar la fase.',
        isBatchStageGroupedLocalAi: false,
      };

    case 'deEsser': {
      const wantsAi = aiOn && (ctx.aiConfig?.deEsser === 'ai' || ctx.aiConfig?.denoise === 'ai');
      if (wantsAi) {
        if (isBridgeModelAvailable(ctx, 'deepfilter')) {
          return {
            kind: 'local-ai',
            iconKey: 'ai',
            shortLabel: 'IA LOCAL · ONNX',
            modelOrEngineName: 'DeepFilterNet 3 De-Harsh (Bridge 7860)',
            cssClass: 'engine-badge--local-ai',
            tooltip: 'Supresión neuronal de sibilancia y asperezas con DeepFilterNet 3 local. En Batch procesa todo el lote en una sola pasada.',
            isBatchStageGroupedLocalAi: true,
          };
        }
        if (ctx.isCloudReady) {
          return {
            kind: 'cloud-ai',
            iconKey: 'cloud',
            shortLabel: 'IA CLOUD · BYOK',
            modelOrEngineName: `${cloudName} + Band-Split De-Esser`,
            cssClass: 'engine-badge--cloud-ai',
            tooltip: `Ajuste adaptativo de perfil sibilante asistido por ${cloudName}.`,
            isBatchStageGroupedLocalAi: false,
          };
        }
        return {
          kind: 'fallback-dsp',
          iconKey: 'alert',
          shortLabel: 'FALLBACK → DSP',
          modelOrEngineName: 'DeepFilter no descargado → De-Esser Dinámico DSP (4.5–11 kHz)',
          cssClass: 'engine-badge--fallback',
          tooltip: 'Configurado en IA, pero DeepFilterNet 3 no está descargado. Se aplicará el De-Esser dinámico determinista de banda dividida.',
          isBatchStageGroupedLocalAi: false,
        };
      }
      return {
        kind: 'dsp',
        iconKey: 'cpu',
        shortLabel: 'DETERMINISTA · DSP',
        modelOrEngineName: 'Compresor Dinámico Sibilante Band-Split (4.5–11 kHz)',
        cssClass: 'engine-badge--dsp',
        tooltip: 'Atenuación dinámica de sibilancias y resonancias ásperas en la banda 4.5–11 kHz antes del remuestreo.',
        isBatchStageGroupedLocalAi: false,
      };
    }

    case 'denoise': {
      const wantsAi = aiOn && ctx.aiConfig?.denoise === 'ai';
      if (wantsAi) {
        if (isBridgeModelAvailable(ctx, 'deepfilter')) {
          return {
            kind: 'local-ai',
            iconKey: 'ai',
            shortLabel: 'IA LOCAL · ONNX',
            modelOrEngineName: 'DeepFilterNet 3 (Bridge 7860)',
            cssClass: 'engine-badge--local-ai',
            tooltip: 'Reducción de ruido neuronal con DeepFilterNet 3 en GPU/CPU local. En Batch se ejecuta seguido para todo el lote.',
            isBatchStageGroupedLocalAi: true,
          };
        }
        if (ctx.isCloudReady) {
          return {
            kind: 'cloud-ai',
            iconKey: 'cloud',
            shortLabel: 'IA CLOUD · BYOK',
            modelOrEngineName: `${cloudName} Assisted Denoise`,
            cssClass: 'engine-badge--cloud-ai',
            tooltip: `Limpieza de ruido asistida por ${cloudName}.`,
            isBatchStageGroupedLocalAi: false,
          };
        }
        return {
          kind: 'fallback-dsp',
          iconKey: 'alert',
          shortLabel: 'FALLBACK → DSP',
          modelOrEngineName: 'DeepFilter no disponible → Puerta Espectral + Hum 50/60 Hz DSP',
          cssClass: 'engine-badge--fallback',
          tooltip: 'Configurado en IA, pero DeepFilterNet 3 no está activo. Se usará Sustracción Espectral por Huella de Ruido + Filtro DC/Hum.',
          isBatchStageGroupedLocalAi: false,
        };
      }
      return {
        kind: 'dsp',
        iconKey: 'cpu',
        shortLabel: 'DETERMINISTA · DSP',
        modelOrEngineName: 'Sustracción por Huella de Ruido + Filtro DC/Hum 50/60 Hz',
        cssClass: 'engine-badge--dsp',
        tooltip: 'Eliminación determinista de offset DC, zumbido eléctrico (50/60 Hz) y suelo de ruido estacionario.',
        isBatchStageGroupedLocalAi: false,
      };
    }

    case 'upsampleMasterWave': {
      const wantsAi = aiOn && (ctx.aiConfig?.masterWave === 'ai' || ctx.aiConfig?.loopExpansion === 'ai');
      if (wantsAi) {
        if (isBridgeModelAvailable(ctx, 'audiosr') || isBridgeModelAvailable(ctx, 'musicgen')) {
          return {
            kind: 'local-ai',
            iconKey: 'ai',
            shortLabel: 'IA LOCAL · GPU',
            modelOrEngineName: 'AudioSR 96 kHz + MusicGen Outpainting (Bridge 7860)',
            cssClass: 'engine-badge--local-ai',
            tooltip: 'Super-resolución neuronal a 96 kHz (AudioSR) y expansión orgánica de muestras cortas (MusicGen). En Batch se ejecuta agrupado para todo el lote.',
            isBatchStageGroupedLocalAi: true,
          };
        }
        if (ctx.isCloudReady && (cloudName === 'REPLICATE' || cloudName === 'HUGGINGFACE')) {
          return {
            kind: 'cloud-ai',
            iconKey: 'cloud',
            shortLabel: 'IA CLOUD · GPU',
            modelOrEngineName: `${cloudName} AudioSR 96 kHz + BWE`,
            cssClass: 'engine-badge--cloud-ai',
            tooltip: `Super-resolución a 96 kHz en GPU Cloud mediante ${cloudName}.`,
            isBatchStageGroupedLocalAi: false,
          };
        }
        return {
          kind: 'fallback-dsp',
          iconKey: 'alert',
          shortLabel: 'FALLBACK → DSP',
          modelOrEngineName: 'AudioSR no descargado → Sinc Polifásico 24b/96 kHz + BWE DSP',
          cssClass: 'engine-badge--fallback',
          tooltip: 'Configurado en IA, pero AudioSR no está descargado ni hay clave Replicate/HF. Se ejecutará Sinc Polifásico de fase lineal + BWE armónico DSP.',
          isBatchStageGroupedLocalAi: false,
        };
      }
      return {
        kind: 'dsp',
        iconKey: 'cpu',
        shortLabel: 'DETERMINISTA · DSP',
        modelOrEngineName: 'Sinc Polifásico 24-bit / 96.000 Hz + Excitador Armónico BWE',
        cssClass: 'engine-badge--dsp',
        tooltip: 'Remuestreo polifásico Kaiser-Bessel de fase lineal a 96 kHz con reconstrucción armónica de agudos y extensión circular de bucles cortos.',
        isBatchStageGroupedLocalAi: false,
      };
    }

    case 'normalize':
      return {
        kind: 'dsp',
        iconKey: 'cpu',
        shortLabel: 'DETERMINISTA · DSP',
        modelOrEngineName: 'Normalizador de Pico (-1.0 dBFS) / Ganancia Relativa de Kit',
        cssClass: 'engine-badge--dsp',
        tooltip: 'Maximiza el rango dinámico de entrada al analizador espectral tras el filtrado y remuestreo.',
        isBatchStageGroupedLocalAi: false,
      };

    case 'pitchAndLoop': {
      const wantsAi = aiOn && ctx.aiConfig?.pitchAndSlicer === 'ai';
      if (wantsAi) {
        if (isBridgeModelAvailable(ctx, 'basicpitch')) {
          return {
            kind: 'local-ai',
            iconKey: 'ai',
            shortLabel: 'IA LOCAL · ONNX',
            modelOrEngineName: 'Spotify Basic Pitch + Whisper-tiny (Bridge 7860)',
            cssClass: 'engine-badge--local-ai',
            tooltip: 'Detección neuronal de F0 con Spotify Basic Pitch ONNX + búsqueda de loop correlacionada en período.',
            isBatchStageGroupedLocalAi: true,
          };
        }
        return {
          kind: 'fallback-dsp',
          iconKey: 'alert',
          shortLabel: 'FALLBACK → DSP',
          modelOrEngineName: 'Basic Pitch no disponible → YIN/MPM + HPS & NCC Loop DSP',
          cssClass: 'engine-badge--fallback',
          tooltip: 'Configurado en IA, pero Basic Pitch no está disponible. Se usará el detector híbrido YIN/MPM + HPS determinista.',
          isBatchStageGroupedLocalAi: false,
        };
      }
      return {
        kind: 'dsp',
        iconKey: 'cpu',
        shortLabel: 'DETERMINISTA · DSP',
        modelOrEngineName: 'Pitch Híbrido YIN/MPM + HPS & Auto-Loop NCC Zero-Crossing',
        cssClass: 'engine-badge--dsp',
        tooltip: 'Detección determinista de frecuencia fundamental F0 y puntos de bucle de fase continua.',
        isBatchStageGroupedLocalAi: false,
      };
    }

    case 'acousticClassifier': {
      const wantsAi = aiOn && ctx.aiConfig?.classifier === 'ai';
      if (wantsAi) {
        if (ctx.isCloudReady) {
          return {
            kind: 'cloud-ai',
            iconKey: 'cloud',
            shortLabel: 'LLM CLOUD · BYOK',
            modelOrEngineName: `${cloudName} + WebGPU Timbre Embeddings`,
            cssClass: 'engine-badge--cloud-ai',
            tooltip: `Clasificación semántica de categoría y Parameter Set 0..9 asistida por ${cloudName} y WebNeuralEngine.`,
            isBatchStageGroupedLocalAi: false,
          };
        }
        return {
          kind: 'local-ai',
          iconKey: 'ai',
          shortLabel: 'IA LOCAL · WEBGPU',
          modelOrEngineName: 'WebNeuralEngine Timbre Embeddings (In-Browser)',
          cssClass: 'engine-badge--local-ai',
          tooltip: 'Clasificación neuronal de timbre ejecutada localmente en el navegador vía WebGPU / WASM SIMD.',
          isBatchStageGroupedLocalAi: true,
        };
      }
      return {
        kind: 'dsp',
        iconKey: 'cpu',
        shortLabel: 'DETERMINISTA · DSP',
        modelOrEngineName: 'Árbol de Descriptores Acústicos (Attack, Inharmonicity B, Centroid)',
        cssClass: 'engine-badge--dsp',
        tooltip: 'Clasificación determinista basada en tiempo de ataque, inarmonicidad B, centroide espectral y ratio de sustain.',
        isBatchStageGroupedLocalAi: false,
      };
    }

    case 'enhanceClassicModel':
      return {
        kind: 'dsp',
        iconKey: 'cpu',
        shortLabel: 'DETERMINISTA · DSP',
        modelOrEngineName: 'Enhanced Spectral DSP (HPSS + Suavizado Temporal + Noise Gate)',
        cssClass: 'engine-badge--dsp',
        tooltip: 'Limpia parciales ruidosos y suaviza trayectorias de los 64 armónicos del modelo Classic sin perder pegada.',
        isBatchStageGroupedLocalAi: false,
      };

    case 'compileClassicModel':
      return {
        kind: 'native-rule',
        iconKey: 'lock',
        shortLabel: 'COMPILADOR CLASSIC',
        modelOrEngineName: 'Binarios .scape + .sphere (64 parciales @ 44.1 kHz) + map.script',
        cssClass: 'engine-badge--native',
        tooltip: 'Compilador binario IEEE-754 Little-Endian 100% compatible con Hartmann Neuron Hardware y modo Classic.',
        isBatchStageGroupedLocalAi: false,
      };

    case 'compileExtendedResinator2':
      return {
        kind: 'native-rule',
        iconKey: 'sparkle',
        shortLabel: 'RESINATOR V2 · HD',
        modelOrEngineName: 'axionik-expanded.json (Superficie 32..256p + 24-Bark + DDSP + Transitorio)',
        cssClass: 'engine-badge--resinator2',
        tooltip: 'Compila el modelo Extended de nueva generación (Resinator 2) con superficie espectral continua 2D o Drum Kit por tecla.',
        isBatchStageGroupedLocalAi: false,
      };

    case 'generateCoverArtwork': {
      const artPref = aiOn ? (ctx.aiConfig?.coverArtwork ?? (ctx.isCloudReady ? 'cloud-ai' : 'local-ai')) : 'procedural';
      if (artPref === 'cloud-ai') {
        if (ctx.isCloudReady) {
          return {
            kind: 'cloud-ai',
            iconKey: 'cloud',
            shortLabel: 'LLM / IMAGEN CLOUD',
            modelOrEngineName: `${cloudName} (Imagen 3 / DALL-E 3 / FLUX.1 + Prompt LLM)`,
            cssClass: 'engine-badge--cloud-ai',
            tooltip: `Generación de portada 512×512 WebP mediante API Cloud (${cloudName}) con prompt enriquecido por el motivo acústico.`,
            isBatchStageGroupedLocalAi: false,
          };
        }
        return {
          kind: 'fallback-dsp',
          iconKey: 'alert',
          shortLabel: 'FALLBACK → DSP',
          modelOrEngineName: 'Sin API Key Cloud → Espectrograma Acústico Procedural',
          cssClass: 'engine-badge--fallback',
          tooltip: 'Configurado en Cloud AI pero no hay API Key activa. Se generará la carátula con el motor Procedural Acústico local.',
          isBatchStageGroupedLocalAi: false,
        };
      }
      if (artPref === 'local-ai') {
        if (isBridgeModelAvailable(ctx, 'sdturbo')) {
          return {
            kind: 'local-ai',
            iconKey: 'ai',
            shortLabel: 'IA LOCAL · GPU',
            modelOrEngineName: 'SD-Turbo 1-Step Diffusion (Bridge 7860 · 512×512 WebP)',
            cssClass: 'engine-badge--local-ai',
            tooltip: 'Síntesis neuronal local en 1 paso con SD-Turbo en tu GPU. En Batch genera todas las portadas seguidas.',
            isBatchStageGroupedLocalAi: true,
          };
        }
        return {
          kind: 'fallback-dsp',
          iconKey: 'alert',
          shortLabel: 'FALLBACK → DSP',
          modelOrEngineName: 'SD-Turbo no descargado → Espectrograma Acústico Procedural',
          cssClass: 'engine-badge--fallback',
          tooltip: 'Configurado en IA Local pero SD-Turbo no está descargado en Bridge. Se usará el renderizador Procedural Acústico.',
          isBatchStageGroupedLocalAi: false,
        };
      }
      return {
        kind: 'dsp',
        iconKey: 'cpu',
        shortLabel: 'DETERMINISTA · DSP',
        modelOrEngineName: 'Espectrograma Acústico Procedural F0 (512×512 WebP)',
        cssClass: 'engine-badge--dsp',
        tooltip: 'Renderizado matemático instantáneo de ondas y armónicos reales del instrumento (0 ms, 100% offline).',
        isBatchStageGroupedLocalAi: false,
      };
    }

    case 'packageTimeCapsule':
      return {
        kind: 'native-rule',
        iconKey: 'lock',
        shortLabel: 'TIME CAPSULE V1',
        modelOrEngineName: 'Empaquetado 5 Capas (01_raw .. 05_extended) + Guardado',
        cssClass: 'engine-badge--native',
        tooltip: 'Empaqueta todas las capas sin pérdida junto con manifest.json y provenance.json hacia AxionikDB o archivo .zip.',
        isBatchStageGroupedLocalAi: false,
      };
  }
}
