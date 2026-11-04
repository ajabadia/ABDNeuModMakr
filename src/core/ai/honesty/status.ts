// ─────────────────────────────────────────────────────────
// AI honesty — single canonical AI status indicator (local/bridge/cloud/offline).
// ─────────────────────────────────────────────────────────

import type { AiAssistanceConfig } from '../../types.ts';
import type { AiConnectionMode, AiSystemStatus, AiSystemStatusInput } from './types';

export function countActiveAiStages(aiConfig?: AiAssistanceConfig): number {
  if (!aiConfig?.enabled) return 0;
  let count = 0;
  if (aiConfig.masterWave === 'ai') count++;
  if (aiConfig.separation === 'ai') count++;
  if (aiConfig.loopExpansion === 'ai') count++;
  if (aiConfig.classifier === 'ai') count++;
  if (aiConfig.denoise === 'ai') count++;
  if (aiConfig.pitchAndSlicer === 'ai') count++;
  if (aiConfig.deEsser === 'ai') count++;
  if (aiConfig.coverArtwork === 'local-ai' || aiConfig.coverArtwork === 'cloud-ai') count++;
  return count;
}

/**
 * Número canónico de etapas del pipeline que admiten asistencia IA.
 * Única fuente de verdad: la usan el HUD, el ProcessPanel y los tests.
 */

export const AI_TOTAL_STAGE_COUNT = 8;

/**
 * Computes the single canonical AI status (`local / bridge / cloud / offline`).
 */

export function resolveAiSystemStatus(input: AiSystemStatusInput): AiSystemStatus {
  const totalStageCount = AI_TOTAL_STAGE_COUNT;
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
      badgeText: anyRemoteReady ? `IA: 0/${totalStageCount} ETAPAS (DSP)` : 'IA: SIN CONEXIÓN (DSP)',
      pillClass: 'is-ai-off',
      cardBadgeText: anyRemoteReady ? `0/${totalStageCount} ETAPAS · 100% DSP` : 'SIN CONEXIÓN · 100% DSP',
      cardSubtitle: anyRemoteReady
        ? 'Todas las etapas están configuradas en modo DSP determinista'
        : 'Sin conexión a motores externos y 0 etapas IA activas (100% DSP)',
      tooltip: anyRemoteReady
        ? `Estado IA: Las ${totalStageCount} etapas del pipeline están en modo DSP determinista (0/${totalStageCount} etapas IA). Haz clic para activar etapas IA.`
        : `Estado IA: Sin conexión a Bridge/Nube y 0/${totalStageCount} etapas IA activas (100 % DSP determinista). Haz clic para configurar motores IA.`,
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
