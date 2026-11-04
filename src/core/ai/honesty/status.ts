// ─────────────────────────────────────────────────────────
// AI honesty — single canonical AI status indicator (local/bridge/cloud/offline).
// ─────────────────────────────────────────────────────────

import type { AiAssistanceConfig } from '../../types.ts';
import type { AiConnectionMode, AiSystemStatus, AiSystemStatusInput } from './types';
import { tApp } from '../../i18n';

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
      badgeText: tApp('aiStatus.disabledBadge'),
      pillClass: 'is-ai-off',
      cardBadgeText: tApp('aiStatus.disabledCardBadge'),
      cardSubtitle: tApp('aiStatus.disabledSubtitle'),
      tooltip: tApp('aiStatus.disabledTooltip'),
      activeStageCount: 0,
      totalStageCount,
    };
  }

  if (activeStageCount === 0) {
    const anyRemoteReady = input.isBridgeConnected || input.isCloudReady;
    return {
      mode: 'offline',
      badgeText: anyRemoteReady
        ? tApp('aiStatus.zeroStagesBadge', { total: totalStageCount })
        : tApp('aiStatus.offlineBadge'),
      pillClass: 'is-ai-off',
      cardBadgeText: anyRemoteReady
        ? tApp('aiStatus.zeroStagesCardBadge', { total: totalStageCount })
        : tApp('aiStatus.offlineCardBadge'),
      cardSubtitle: anyRemoteReady
        ? tApp('aiStatus.zeroStagesSubtitle')
        : tApp('aiStatus.offlineSubtitle'),
      tooltip: anyRemoteReady
        ? tApp('aiStatus.zeroStagesTooltip', { total: totalStageCount })
        : tApp('aiStatus.offlineTooltip', { total: totalStageCount }),
      activeStageCount: 0,
      totalStageCount,
    };
  }

  let mode: AiConnectionMode;
  let modeLabel: string;
  let detailEngine: string;

  if (input.isBridgeConnected) {
    mode = 'bridge';
    modeLabel = tApp('aiStatus.modeBridge');
    detailEngine = tApp('aiStatus.engineBridge');
  } else if (input.isCloudReady) {
    mode = 'cloud';
    modeLabel = tApp('aiStatus.modeCloud');
    detailEngine = tApp('aiStatus.engineCloud');
  } else {
    mode = 'local';
    modeLabel = tApp('aiStatus.modeLocal');
    detailEngine =
      localKind === 'webgpu'
        ? tApp('aiStatus.engineWebGpu')
        : localKind === 'wasm'
          ? tApp('aiStatus.engineWasm')
          : tApp('aiStatus.engineDsp');
  }

  const pillClass = activeStageCount === totalStageCount ? 'is-ai-active' : 'is-ai-hybrid';

  return {
    mode,
    badgeText: tApp('aiStatus.activeBadge', {
      mode: modeLabel,
      active: activeStageCount,
      total: totalStageCount,
    }),
    pillClass,
    cardBadgeText: tApp('aiStatus.activeBadge', {
      mode: modeLabel,
      active: activeStageCount,
      total: totalStageCount,
    }),
    cardSubtitle: detailEngine,
    tooltip: tApp('aiStatus.activeTooltip', {
      mode: modeLabel,
      engine: detailEngine,
      active: activeStageCount,
      total: totalStageCount,
    }),
    activeStageCount,
    totalStageCount,
  };
}
