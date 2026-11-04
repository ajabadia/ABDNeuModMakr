// ─────────────────────────────────────────────────────────
// AI honesty — per-button engine/fallback declarations (zero silent fallbacks).
// ─────────────────────────────────────────────────────────

import type { AiActionContext, AiActionDeclaration, AiActionId } from './types';

export function resolveAiActionDeclaration(
  actionId: AiActionId,
  ctx: AiActionContext
): AiActionDeclaration {
  switch (actionId) {
    case 'recorder-bwe-enhance': {
      const primary = 'Bridge IA (AudioSR 96 kHz + limpieza con huella de ruido)';
      const fallback = 'Alternativa DSP local (Sustracción espectral + filtro hum 50/60 Hz + normalización -1 dB)';
      const avail = ctx.isBridgeConnected;
      return {
        actionId,
        primaryEngine: primary,
        fallbackEngine: fallback,
        isPrimaryAvailable: avail,
        buttonLabel: avail
          ? 'Reconstructor de agudos (BWE · Bridge IA)'
          : 'Reconstructor de agudos (BWE · Alternativa DSP)',
        buttonTooltip: `Motor principal: ${primary}. Si no está disponible: ${fallback} (previa confirmación).`,
        requiresFallbackConsent: !avail,
        consentTitle: 'Companion Bridge sin conexión — ¿Usar alternativa DSP local?',
        consentMessage:
          `El motor principal "${primary}" no está conectado (puerto 7860).\n\n` +
          `Alternativa disponible: ${fallback}.\n\n` +
          `¿Quieres aplicar la alternativa DSP local sobre esta grabación o cancelar?`,
        consentConfirmLabel: 'Usar alternativa DSP local',
      };
    }

    case 'recorder-ai-denoise': {
      const stageEnabled = Boolean(ctx.aiConfig?.enabled && ctx.aiConfig?.denoise === 'ai');
      const hasBridgeDenoise = ctx.isBridgeConnected && (ctx.isDenoiseModelReady !== false) && stageEnabled;
      const hasCloudLlm = Boolean(ctx.isCloudReady || ctx.activeTextLlmProvider);
      const avail = hasBridgeDenoise || hasCloudLlm;
      const llmLabel = ctx.activeTextLlmProvider ? ctx.activeTextLlmProvider.toUpperCase() : 'Cloud BYOK';
      const primary = hasBridgeDenoise
        ? 'DeepFilterNet 3 (Modelo IA local habilitado en Etapa 5 + Companion Bridge)'
        : hasCloudLlm
          ? `Denoise asistido por IA (${llmLabel} API Key configurada + DeepFilter/Bridge)`
          : 'DeepFilterNet 3 (Etapa 5 AI Denoise) o API Key de LLM potente (Claude/GPT-4o/Gemini)';
      const fallback = 'Denoise determinista local (Sustracción espectral por Huella de Ruido + Filtro Hum 50/60 Hz)';

      let missingReason = '';
      if (!stageEnabled && !hasCloudLlm) {
        missingReason =
          '• La Etapa 5 "AI Denoise (DeepFilterNet 3)" no está habilitada en Settings → IA (actualmente en modo DSP/Bypass), y tampoco hay una API Key de un LLM potente configurada en Cloud BYOK.';
      } else if (!ctx.isBridgeConnected && !hasCloudLlm) {
        missingReason =
          '• El Companion Bridge local (DeepFilterNet 3, puerto 7860) no está conectado y no hay una API Key de LLM potente configurada en Cloud BYOK.';
      } else if (ctx.isDenoiseModelReady === false && !hasCloudLlm) {
        missingReason =
          '• El modelo DeepFilterNet 3 (deepfilter) no está descargado/habilitado en Companion Bridge y no hay una API Key de LLM potente configurada.';
      }

      return {
        actionId,
        primaryEngine: primary,
        fallbackEngine: fallback,
        isPrimaryAvailable: avail,
        buttonLabel: avail ? 'Denoise IA (DeepFilter / Cloud)' : 'Denoise IA (No habilitado → DSP)',
        buttonTooltip: `Motor IA: ${primary}. Requiere tener habilitado AI Denoise (DeepFilterNet 3) o API Key de LLM potente configurada. Alternativa: ${fallback}.`,
        requiresFallbackConsent: !avail,
        consentTitle: 'Modelo Denoise IA no habilitado o sin API Key — ¿Usar Denoise DSP?',
        consentMessage:
          `Para ejecutar Denoise por IA se comprueba que el modelo "DeepFilterNet 3" (Etapa 5: AI Denoise) esté habilitado o que exista una API Key de un LLM potente configurada:\n\n` +
          `${missingReason}\n\n` +
          `Alternativa disponible: ${fallback}.\n\n` +
          `¿Quieres aplicar la alternativa DSP local ahora o cancelar para habilitar el modelo / API Key en Settings?`,
        consentConfirmLabel: 'Usar Denoise DSP local',
      };
    }

    case 'chopper-bwe-enhance': {
      const primary = 'Bridge IA (AudioSR 96 kHz + limpieza con huella de ruido)';
      const fallback = 'Alternativa DSP local (Puerta espectral + filtro hum 50/60 Hz)';
      const avail = ctx.isBridgeConnected;
      return {
        actionId,
        primaryEngine: primary,
        fallbackEngine: fallback,
        isPrimaryAvailable: avail,
        buttonLabel: avail ? 'AI Enhance (Bridge IA)' : 'AI Enhance (Alternativa DSP)',
        buttonTooltip: `Motor principal: ${primary}. Alternativa: ${fallback} (previa confirmación).`,
        requiresFallbackConsent: !avail,
        consentTitle: 'Companion Bridge sin conexión — ¿Usar limpieza DSP local?',
        consentMessage:
          `El motor principal "${primary}" no está conectado.\n\n` +
          `Alternativa disponible: ${fallback}.\n\n` +
          `¿Quieres ejecutar la limpieza espectral DSP local sobre el audio cargado o cancelar?`,
        consentConfirmLabel: 'Usar alternativa DSP local',
      };
    }

    case 'chopper-whisper-align': {
      const primary = 'Bridge IA (OpenAI Whisper-tiny alineación fonética)';
      const fallback = 'Alternativa DSP local (Segmentador silábico OpenVPI por valles de energía RMS)';
      const avail = ctx.isBridgeConnected;
      return {
        actionId,
        primaryEngine: primary,
        fallbackEngine: fallback,
        isPrimaryAvailable: avail,
        buttonLabel: avail ? 'AI Vocal Align (Whisper Bridge)' : 'AI Vocal Align (Alternativa OpenVPI)',
        buttonTooltip: `Motor principal: ${primary}. Alternativa: ${fallback} (previa confirmación).`,
        requiresFallbackConsent: !avail,
        consentTitle: 'Whisper-tiny (Bridge) sin conexión — ¿Usar segmentación vocal DSP?',
        consentMessage:
          `El motor principal "${primary}" requiere el Companion Bridge conectado.\n\n` +
          `Alternativa disponible: ${fallback}.\n\n` +
          `¿Quieres segmentar las frases vocales con el detector DSP OpenVPI local o cancelar?`,
        consentConfirmLabel: 'Usar segmentador DSP local',
      };
    }

    case 'chopper-demucs-split': {
      const primary = 'Bridge IA (HTDemucs v4 separación neuronal de 4 stems)';
      const fallback = 'Alternativa DSP local (Separación Mid/Side + filtrado armónico/percusivo en navegador)';
      const avail = ctx.isBridgeConnected;
      return {
        actionId,
        primaryEngine: primary,
        fallbackEngine: fallback,
        isPrimaryAvailable: avail,
        buttonLabel: avail ? 'Separate Stems (Demucs Bridge)' : 'Separate Stems (Alternativa DSP)',
        buttonTooltip: `Motor principal: ${primary}. Alternativa: ${fallback} (previa confirmación).`,
        requiresFallbackConsent: !avail,
        consentTitle: 'HTDemucs (Bridge) sin conexión — ¿Usar separación de stems DSP local?',
        consentMessage:
          `El motor principal "${primary}" requiere el Companion Bridge conectado.\n\n` +
          `Alternativa disponible: ${fallback}.\n\n` +
          `¿Quieres separar los stems mediante el motor DSP local o cancelar?`,
        consentConfirmLabel: 'Separar con DSP local',
      };
    }

    case 'artwork-generate': {
      const provider = ctx.selectedArtworkProvider ?? 'procedural';
      if (provider === 'procedural') {
        const primary = 'Motor Procedural Acústico (Canvas matemático local)';
        return {
          actionId,
          primaryEngine: primary,
          fallbackEngine: primary,
          isPrimaryAvailable: true,
          buttonLabel: 'Generate Artwork (Procedural Local)',
          buttonTooltip: `Motor activo: ${primary}. 100 % en navegador, sin red ni coste.`,
          requiresFallbackConsent: false,
          consentTitle: '',
          consentMessage: '',
          consentConfirmLabel: '',
        };
      }
      if (provider === 'bridge') {
        const primary = 'Companion Bridge Local (SD-Turbo / PIL :7860)';
        const fallback = 'Motor Procedural Acústico (Canvas matemático local)';
        const avail = ctx.isBridgeConnected;
        return {
          actionId,
          primaryEngine: primary,
          fallbackEngine: fallback,
          isPrimaryAvailable: avail,
          buttonLabel: avail
            ? 'Generate Artwork (Bridge IA)'
            : 'Generate Artwork (Bridge Offline → Procedural)',
          buttonTooltip: `Motor seleccionado: ${primary}. Alternativa si no está conectado: ${fallback} (previa confirmación).`,
          requiresFallbackConsent: !avail,
          consentTitle: 'Companion Bridge sin conexión — ¿Generar portada con motor Procedural local?',
          consentMessage:
            `Has seleccionado "${primary}", pero el servidor local no responde en el puerto 7860.\n\n` +
            `Alternativa disponible: ${fallback}.\n\n` +
            `¿Quieres generar la portada con el motor Procedural local o cancelar?`,
          consentConfirmLabel: 'Usar motor Procedural local',
        };
      }
      const cloudName = provider.toUpperCase();
      const primary = `Nube BYOK (${cloudName})`;
      const fallback = 'Motor Procedural Acústico (Canvas matemático local)';
      const avail = Boolean(ctx.artworkProviderReady);
      return {
        actionId,
        primaryEngine: primary,
        fallbackEngine: fallback,
        isPrimaryAvailable: avail,
        buttonLabel: avail
          ? `Generate Artwork (${cloudName} Cloud)`
          : `Generate Artwork (${cloudName} sin clave → Procedural)`,
        buttonTooltip: `Motor seleccionado: ${primary}. Alternativa si falta clave: ${fallback} (previa confirmación).`,
        requiresFallbackConsent: !avail,
        consentTitle: `Clave API de ${cloudName} no configurada — ¿Usar motor Procedural local?`,
        consentMessage:
          `El proveedor en la nube "${primary}" no tiene una clave API configurada en Settings (BYOK).\n\n` +
          `Alternativa disponible: ${fallback}.\n\n` +
          `¿Quieres generar la portada ahora con el motor Procedural local o cancelar para configurar tu clave?`,
        consentConfirmLabel: 'Usar motor Procedural local',
      };
    }

    case 'artwork-llm-prompt': {
      const llm = ctx.activeTextLlmProvider;
      const primary = llm ? `Nube BYOK (${llm.toUpperCase()} LLM)` : 'Nube BYOK (Claude / OpenAI / OpenRouter / Gemini)';
      const fallback = 'Plantilla descriptiva acústica local (determinista por categoría y F0)';
      const avail = Boolean(llm);
      return {
        actionId,
        primaryEngine: primary,
        fallbackEngine: fallback,
        isPrimaryAvailable: avail,
        buttonLabel: avail
          ? `Enhance Prompt (${llm!.toUpperCase()} Cloud)`
          : 'Enhance Prompt (Alternativa Plantilla Local)',
        buttonTooltip: `Motor principal: ${primary}. Alternativa: ${fallback} (previa confirmación).`,
        requiresFallbackConsent: !avail,
        consentTitle: 'Sin clave LLM en la nube — ¿Enriquecer prompt con plantilla acústica local?',
        consentMessage:
          `No hay ninguna clave API configurada para "${primary}".\n\n` +
          `Alternativa disponible: ${fallback}.\n\n` +
          `¿Quieres enriquecer el prompt con descriptores acústicos deterministas locales o cancelar?`,
        consentConfirmLabel: 'Usar plantilla acústica local',
      };
    }
  }
}

/**
 * Local deterministic stem separation fallback (used ONLY after explicit user consent
 * when Companion Bridge HTDemucs is offline). Produces 16-bit WAV ArrayBuffers for the requested stems.
 */
