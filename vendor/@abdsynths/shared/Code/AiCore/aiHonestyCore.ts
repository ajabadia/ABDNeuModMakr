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
export function computeCanonicalAiHudStatus(
  params: {
    enabled: boolean;
    activeTasksCount: number;
    totalTasksCount: number;
    localConnected: boolean;
    localEngineLabel?: string;
    cloudConfigured: boolean;
    cloudProviderLabel?: string;
  },
  locale: 'es' | 'en' = 'es'
): CanonicalAiHudStatus {
  const isEn = String(locale).toLowerCase().startsWith('en');
  const loc = (es: string, en: string): string => (isEn ? en : es);

  if (!params.enabled || params.activeTasksCount === 0) {
    return {
      badgeText: loc('100% DETERMINISTA', '100% DETERMINISTIC'),
      pillClass: 'is-ai-off',
      tooltip: loc(
        'Todas las tareas ejecutan algoritmos matemáticos deterministas locales (Cero IA activa, 100% privado y offline).',
        'All tasks run local deterministic mathematical algorithms (Zero AI active, 100% private and offline).'
      ),
      mode: 'offline',
      activeTasksCount: 0,
      totalTasksCount: params.totalTasksCount,
    };
  }

  const isLocal = params.localConnected;
  const isCloud = params.cloudConfigured;

  if (isLocal && isCloud) {
    return {
      badgeText: loc(
        `HIBRIDO IA (${params.activeTasksCount}/${params.totalTasksCount})`,
        `AI HYBRID (${params.activeTasksCount}/${params.totalTasksCount})`
      ),
      pillClass: 'is-ai-hybrid',
      tooltip: loc(
        `Tareas IA activas: ${params.activeTasksCount}/${params.totalTasksCount}. Local: ${params.localEngineLabel || 'Conectado'} + Cloud: ${params.cloudProviderLabel || 'BYOK Activo'}.`,
        `Active AI tasks: ${params.activeTasksCount}/${params.totalTasksCount}. Local: ${params.localEngineLabel || 'Connected'} + Cloud: ${params.cloudProviderLabel || 'BYOK Active'}.`
      ),
      mode: 'hybrid',
      activeTasksCount: params.activeTasksCount,
      totalTasksCount: params.totalTasksCount,
    };
  }

  if (isLocal) {
    return {
      badgeText: loc(
        `IA LOCAL (${params.activeTasksCount}/${params.totalTasksCount})`,
        `LOCAL AI (${params.activeTasksCount}/${params.totalTasksCount})`
      ),
      pillClass: 'is-ai-active',
      tooltip: loc(
        `Tareas IA activas: ${params.activeTasksCount}/${params.totalTasksCount} ejecutadas en tu máquina local (${params.localEngineLabel || 'Local'}). 0 bytes enviados a la nube.`,
        `Active AI tasks: ${params.activeTasksCount}/${params.totalTasksCount} running on your local machine (${params.localEngineLabel || 'Local'}). 0 bytes sent to cloud.`
      ),
      mode: 'local',
      activeTasksCount: params.activeTasksCount,
      totalTasksCount: params.totalTasksCount,
    };
  }

  if (isCloud) {
    return {
      badgeText: loc(
        `IA CLOUD (${params.activeTasksCount}/${params.totalTasksCount})`,
        `CLOUD AI (${params.activeTasksCount}/${params.totalTasksCount})`
      ),
      pillClass: 'is-ai-active',
      tooltip: loc(
        `Tareas IA activas: ${params.activeTasksCount}/${params.totalTasksCount} asistidas por ${params.cloudProviderLabel || 'Cloud BYOK'}.`,
        `Active AI tasks: ${params.activeTasksCount}/${params.totalTasksCount} assisted by ${params.cloudProviderLabel || 'Cloud BYOK'}.`
      ),
      mode: 'cloud',
      activeTasksCount: params.activeTasksCount,
      totalTasksCount: params.totalTasksCount,
    };
  }

  return {
    badgeText: loc('FALLBACK DSP', 'DSP FALLBACK'),
    pillClass: 'is-ai-off',
    tooltip: loc(
      'IA activada en configuración pero ningún motor local ni clave Cloud están disponibles. Se ejecuta DSP determinista.',
      'AI is enabled in configuration, but neither a local engine nor a Cloud key is available. Running deterministic DSP.'
    ),
    mode: 'offline',
    activeTasksCount: 0,
    totalTasksCount: params.totalTasksCount,
  };
}
