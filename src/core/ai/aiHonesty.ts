// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — AI Honesty & Unified Status Contract (Fase 35.4)
//
// Pure, zero-DOM module providing:
//   1. Single canonical AI system status indicator:
//        `local` | `bridge` | `cloud` | `offline`
//      used across Navbar HUD and ProcessPanel.
//   2. Per-button AI action declarations (`resolveAiActionDeclaration`):
//      Every AI button declares its primary engine and its deterministic
//      fallback BEFORE acting, and requires explicit user confirmation
//      when the primary engine is unavailable (zero silent fallbacks).
// ─────────────────────────────────────────────────────────

import type { AiAssistanceConfig } from '../types.ts';
import type { ArtworkProvider } from './ModelArtworkGenerator.ts';

export type AiConnectionMode = 'local' | 'bridge' | 'cloud' | 'offline';

export interface AiSystemStatusInput {
  aiConfig?: AiAssistanceConfig;
  isBridgeConnected: boolean;
  isCloudReady: boolean;
  localProvider?: 'webgpu' | 'wasm' | 'dsp';
}

export interface AiSystemStatus {
  mode: AiConnectionMode;
  /** Short canonical badge text for the single HUD indicator */
  badgeText: string;
  /** CSS modifier class for `.hud-ai-pill` */
  pillClass: 'is-ai-active' | 'is-ai-hybrid' | 'is-ai-off';
  /** Short human label for ProcessPanel card */
  cardBadgeText: string;
  /** Subtitle for ProcessPanel card */
  cardSubtitle: string;
  /** Detailed tooltip explaining active stages, active engine, and fallback */
  tooltip: string;
  activeStageCount: number;
  totalStageCount: number;
}

export function countActiveAiStages(aiConfig?: AiAssistanceConfig): number {
  if (!aiConfig?.enabled) return 0;
  let count = 0;
  if (aiConfig.masterWave === 'ai') count++;
  if (aiConfig.separation === 'ai') count++;
  if (aiConfig.loopExpansion === 'ai') count++;
  if (aiConfig.classifier === 'ai') count++;
  if (aiConfig.denoise === 'ai') count++;
  return count;
}

/**
 * Computes the single canonical AI status (`local / bridge / cloud / offline`).
 */
export function resolveAiSystemStatus(input: AiSystemStatusInput): AiSystemStatus {
  const totalStageCount = 5;
  const enabled = Boolean(input.aiConfig?.enabled);
  const activeStageCount = countActiveAiStages(input.aiConfig);
  const localKind = input.localProvider ?? 'webgpu';

  if (!enabled) {
    return {
      mode: 'offline',
      badgeText: 'IA: DESACTIVADA (DSP)',
      pillClass: 'is-ai-off',
      cardBadgeText: 'DESACTIVADA · 100% DSP',
      cardSubtitle: 'Asistencia IA desactivada (motor matemático determinista)',
      tooltip:
        'Estado IA: Desactivada por configuración (100 % DSP determinista). Haz clic para configurar motores IA (Local, Bridge o Nube).',
      activeStageCount: 0,
      totalStageCount,
    };
  }

  if (activeStageCount === 0) {
    const anyRemoteReady = input.isBridgeConnected || input.isCloudReady;
    return {
      mode: 'offline',
      badgeText: anyRemoteReady ? 'IA: 0/5 ETAPAS (DSP)' : 'IA: SIN CONEXIÓN (DSP)',
      pillClass: 'is-ai-off',
      cardBadgeText: anyRemoteReady ? '0/5 ETAPAS · 100% DSP' : 'SIN CONEXIÓN · 100% DSP',
      cardSubtitle: anyRemoteReady
        ? 'Todas las etapas están configuradas en modo DSP determinista'
        : 'Sin conexión a motores externos y 0 etapas IA activas (100% DSP)',
      tooltip: anyRemoteReady
        ? 'Estado IA: Las 5 etapas del pipeline están en modo DSP determinista (0/5 etapas IA). Haz clic para activar etapas IA.'
        : 'Estado IA: Sin conexión a Bridge/Nube y 0/5 etapas IA activas (100 % DSP determinista). Haz clic para configurar motores IA.',
      activeStageCount: 0,
      totalStageCount,
    };
  }

  let mode: AiConnectionMode;
  let modeLabel: string;
  let detailEngine: string;

  if (input.isBridgeConnected) {
    mode = 'bridge';
    modeLabel = 'BRIDGE';
    detailEngine = 'Companion Bridge Local (Python GPU/CPU :7860)';
  } else if (input.isCloudReady) {
    mode = 'cloud';
    modeLabel = 'NUBE';
    detailEngine = 'Cloud BYOK API (Clave privada en navegador)';
  } else {
    mode = 'local';
    modeLabel = 'LOCAL';
    detailEngine =
      localKind === 'webgpu'
        ? 'Navegador Local (WebGPU / WASM)'
        : localKind === 'wasm'
          ? 'Navegador Local (WASM SIMD)'
          : 'Navegador Local (DSP Determinista)';
  }

  const pillClass = activeStageCount === totalStageCount ? 'is-ai-active' : 'is-ai-hybrid';

  return {
    mode,
    badgeText: `IA: ${modeLabel} (${activeStageCount}/${totalStageCount})`,
    pillClass,
    cardBadgeText: `IA: ${modeLabel} (${activeStageCount}/${totalStageCount})`,
    cardSubtitle: detailEngine,
    tooltip: `Estado IA: ${modeLabel} — ${detailEngine}. Etapas activas: ${activeStageCount}/${totalStageCount}. Ninguna acción IA hace fallback silencioso.`,
    activeStageCount,
    totalStageCount,
  };
}

export type AiActionId =
  | 'recorder-bwe-enhance'
  | 'chopper-bwe-enhance'
  | 'chopper-whisper-align'
  | 'chopper-demucs-split'
  | 'artwork-generate'
  | 'artwork-llm-prompt';

export interface AiActionContext {
  isBridgeConnected: boolean;
  isCloudReady?: boolean;
  selectedArtworkProvider?: ArtworkProvider;
  artworkProviderReady?: boolean;
  activeTextLlmProvider?: string | null;
}

export interface AiActionDeclaration {
  actionId: AiActionId;
  /** Name of the intended primary AI engine */
  primaryEngine: string;
  /** Name of the deterministic/procedural alternative when primary is unavailable */
  fallbackEngine: string;
  /** True when the primary engine is ready right now */
  isPrimaryAvailable: boolean;
  /** Visible button label declaring the active or primary engine */
  buttonLabel: string;
  /** Detailed tooltip declaring both primary engine and fallback */
  buttonTooltip: string;
  /** True when clicking the button must ask explicit confirmation before running the fallback */
  requiresFallbackConsent: boolean;
  /** Dialog title when asking consent to run the fallback */
  consentTitle: string;
  /** Dialog message explaining why primary is unavailable and what the alternative will do */
  consentMessage: string;
  /** Confirm button label for the fallback dialog */
  consentConfirmLabel: string;
}

/**
 * Resolves the explicit engine & fallback declaration for any AI action button.
 * Guarantees zero silent fallbacks: if `isPrimaryAvailable` is false, the caller
 * must present `consentMessage` via `confirmDialog` before running `fallbackEngine`.
 */
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
export function separateStemsDspFallback(
  pcm: Float32Array,
  sampleRate: number,
  stems: readonly string[],
  encodeWavFn: (samples: Float32Array, sr: number) => ArrayBuffer
): Record<string, ArrayBuffer> {
  const n = pcm.length;
  const out: Record<string, ArrayBuffer> = {};
  if (n === 0) return out;

  // One-pole low-pass at ~180 Hz (bass) and ~3200 Hz (vocals/mid body)
  const rcLow = 1.0 / (2.0 * Math.PI * 180.0);
  const dt = 1.0 / Math.max(8000, sampleRate);
  const alphaLow = dt / (rcLow + dt);

  const rcHigh = 1.0 / (2.0 * Math.PI * 3200.0);
  const alphaHigh = dt / (rcHigh + dt);

  const bass = new Float32Array(n);
  const midBand = new Float32Array(n);
  const highs = new Float32Array(n);

  let lp180 = 0;
  let lp3200 = 0;
  for (let i = 0; i < n; i++) {
    const x = pcm[i];
    lp180 += alphaLow * (x - lp180);
    lp3200 += alphaHigh * (x - lp3200);
    bass[i] = lp180;
    midBand[i] = lp3200 - lp180;
    highs[i] = x - lp3200;
  }

  // Envelope follower for transient/percussive vs harmonic gating
  const fastAttack = Math.exp(-1.0 / (0.002 * sampleRate));
  const slowRelease = Math.exp(-1.0 / (0.065 * sampleRate));
  let envFast = 0;
  let envSlow = 0;
  const drums = new Float32Array(n);
  const sustainedMid = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const absX = Math.abs(pcm[i]);
    envFast = absX > envFast ? fastAttack * envFast + (1 - fastAttack) * absX : slowRelease * envFast;
    envSlow = 0.999 * envSlow + 0.001 * absX;
    const transientRatio = envSlow > 1e-5 ? Math.min(1, Math.max(0, (envFast - envSlow) / (envSlow * 2.5))) : 0;
    drums[i] = pcm[i] * transientRatio + highs[i] * 0.45;
    sustainedMid[i] = midBand[i] * (1 - 0.65 * transientRatio);
  }

  for (const stem of stems) {
    if (stem === 'bass') {
      out.bass = encodeWavFn(bass, sampleRate);
    } else if (stem === 'drums') {
      out.drums = encodeWavFn(drums, sampleRate);
    } else if (stem === 'vocals') {
      out.vocals = encodeWavFn(sustainedMid, sampleRate);
    } else if (stem === 'instrumental') {
      const inst = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        inst[i] = bass[i] + highs[i] + (midBand[i] - sustainedMid[i] * 0.7);
      }
      out.instrumental = encodeWavFn(inst, sampleRate);
    }
  }

  return out;
}
