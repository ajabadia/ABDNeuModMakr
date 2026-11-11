// ─────────────────────────────────────────────────────────
// ABDShared — aiHonestyCore (AI honesty type contracts and helpers)
// Guarantees zero silent fallbacks across the entire ABDSynths suite.
// ─────────────────────────────────────────────────────────

export type ExecutionEngineKind =
  | 'native-rule'    // Regla / Compilador Nativo C++
  | 'dsp'            // Determinista DSP (WebAudio / WASM / C++)
  | 'local-ai'       // IA Local (GPU / Ollama / LM Studio / PyTorch)
  | 'cloud-ai'       // IA Cloud (LLM / BYOK API)
  | 'fallback-dsp';  // Fallback transparente a DSP

export interface ExecutionEngineBadge {
  kind: ExecutionEngineKind;
  iconKey: 'lock' | 'cpu' | 'ai' | 'cloud' | 'alert' | 'sparkle';
  shortLabel: string;
  modelOrEngineName: string;
  cssClass: string;
  tooltip: string;
  isBatchStageGroupedLocalAi?: boolean;
}

export interface AiActionDeclaration {
  actionId: string;
  primaryEngine: string;
  fallbackEngine: string;
  isPrimaryAvailable: boolean;
  buttonLabel: string;
  buttonTooltip: string;
  requiresFallbackConsent: boolean;
  consentTitle: string;
  consentMessage: string;
  consentConfirmLabel: string;
}

export interface CanonicalAiHudStatus {
  badgeText: string;
  pillClass: 'is-ai-active' | 'is-ai-hybrid' | 'is-ai-off';
  tooltip: string;
  mode: 'offline' | 'local' | 'cloud' | 'hybrid';
  activeTasksCount: number;
  totalTasksCount: number;
}

/**
 * Computa la pastilla de estado honesto canónico para la barra superior (HUD).
 */
export function computeCanonicalAiHudStatus(params: {
  enabled: boolean;
  activeTasksCount: number;
  totalTasksCount: number;
  localConnected: boolean;
  localEngineLabel?: string;
  cloudConfigured: boolean;
  cloudProviderLabel?: string;
}): CanonicalAiHudStatus {
  if (!params.enabled || params.activeTasksCount === 0) {
    return {
      badgeText: '100% DETERMINISTA',
      pillClass: 'is-ai-off',
      tooltip: 'Todas las tareas ejecutan algoritmos matemáticos deterministas locales (Cero IA activa, 100% privado y offline).',
      mode: 'offline',
      activeTasksCount: 0,
      totalTasksCount: params.totalTasksCount,
    };
  }

  const isLocal = params.localConnected;
  const isCloud = params.cloudConfigured;

  if (isLocal && isCloud) {
    return {
      badgeText: `HIBRIDO IA (${params.activeTasksCount}/${params.totalTasksCount})`,
      pillClass: 'is-ai-hybrid',
      tooltip: `Tareas IA activas: ${params.activeTasksCount}/${params.totalTasksCount}. Local: ${params.localEngineLabel || 'Conectado'} + Cloud: ${params.cloudProviderLabel || 'BYOK Activo'}.`,
      mode: 'hybrid',
      activeTasksCount: params.activeTasksCount,
      totalTasksCount: params.totalTasksCount,
    };
  }

  if (isLocal) {
    return {
      badgeText: `IA LOCAL (${params.activeTasksCount}/${params.totalTasksCount})`,
      pillClass: 'is-ai-active',
      tooltip: `Tareas IA activas: ${params.activeTasksCount}/${params.totalTasksCount} ejecutadas en tu máquina local (${params.localEngineLabel || 'Local'}). 0 bytes enviados a la nube.`,
      mode: 'local',
      activeTasksCount: params.activeTasksCount,
      totalTasksCount: params.totalTasksCount,
    };
  }

  if (isCloud) {
    return {
      badgeText: `IA CLOUD (${params.activeTasksCount}/${params.totalTasksCount})`,
      pillClass: 'is-ai-active',
      tooltip: `Tareas IA activas: ${params.activeTasksCount}/${params.totalTasksCount} asistidas por ${params.cloudProviderLabel || 'Cloud BYOK'}.`,
      mode: 'cloud',
      activeTasksCount: params.activeTasksCount,
      totalTasksCount: params.totalTasksCount,
    };
  }

  return {
    badgeText: 'FALLBACK DSP',
    pillClass: 'is-ai-off',
    tooltip: 'IA activada en configuración pero ningún motor local ni clave Cloud están disponibles. Se ejecuta DSP determinista.',
    mode: 'offline',
    activeTasksCount: 0,
    totalTasksCount: params.totalTasksCount,
  };
}
