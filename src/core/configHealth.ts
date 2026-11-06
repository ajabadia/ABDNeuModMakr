// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Configuration Health & Onboarding Engine (Fase 21)
//
// Rigorous health diagnostic across mandatory & optional dependencies:
//   - Mandatory: WebAudio API, LocalStorage persistence, Library soundfont folder
//   - Optional: Local Companion Bridge (Port 7860), Local neural weights
//     (AudioSR, Demucs, Basic Pitch), Cloud AI BYOK keys (Gemini, OpenAI, Claude)
//
// Gates functions requiring unconfigured dependencies and coordinates
// startup onboarding alerts & navbar health indicators.
// ─────────────────────────────────────────────────────────

import { bridgeClient } from './bridge/BridgeClient.ts';
import { cloudByokClient } from './ai/CloudByokClient.ts';
import type { SettingsModalTab } from '../ui/SettingsModal.ts';

export interface ConfigHealthItem {
  id: string;
  name: string;
  category: 'mandatory' | 'optional';
  isConfigured: boolean;
  statusBadge: string;
  description: string;
  targetTab: SettingsModalTab;
  impactSummary: string;
}

export interface ConfigHealthReport {
  overallStatus: 'ok' | 'warning' | 'error';
  mandatoryCount: number;
  mandatoryConfigured: number;
  optionalCount: number;
  optionalConfigured: number;
  hasMissingMandatory: boolean;
  hasMissingOptional: boolean;
  items: ConfigHealthItem[];
}

export const STORAGE_KEY_CONFIG_HEALTH_ON_BOOT = 'neumodmakr_config_health_on_boot';

/**
 * Fase 44.5.1 — Inventario honesto Persiste / Volátil (solo datos, no altera el
 * cómputo de `evaluateConfigHealth` para no romper umbrales existentes).
 * Renderizado en Settings → General → Almacenamiento.
 */
export const PERSISTENCE_INVENTORY: ReadonlyArray<{
  key: string;
  persists: boolean;
  labelEs: string;
  labelEn: string;
}> = [
  { key: 'abd_neumodmakr_session_v1', persists: true, labelEs: 'Sesión (zonas, processConfig, tempoSync, sublibrary)', labelEn: 'Session (zones, processConfig, tempoSync, sublibrary)' },
  { key: 'abd_neumodmakr_bank_v1', persists: true, labelEs: 'Banco (metadatos; JSON>250KB truncado con aviso)', labelEn: 'Bank (metadata; JSON>250KB truncated with warning)' },
  { key: 'neumodmakr_byok_config', persists: true, labelEs: 'Claves BYOK (9 proveedores)', labelEn: 'BYOK keys (9 providers)' },
  { key: 'neumodmakr_bridge_url/token', persists: true, labelEs: 'URL/token del Bridge', labelEn: 'Bridge URL/token' },
  { key: 'nmm_theme_family/mode + abdsynths.locale', persists: true, labelEs: 'Tema e idioma', labelEn: 'Theme & locale' },
  { key: 'sampleBuffers en memoria', persists: false, labelEs: 'Buffers de audio en memoria (incl. resintetizados legacy → demo)', labelEn: 'In-memory audio buffers (incl. legacy resynthesized → demo)' },
  { key: 'catálogo bridge / VRAM', persists: false, labelEs: 'Catálogo de modelos y estado VRAM (solo con bridge online)', labelEn: 'Model catalog & VRAM state (bridge online only)' },
];

export function evaluateConfigHealth(): ConfigHealthReport {
  const items: ConfigHealthItem[] = [];

  // ── 1. Mandatory Items ──────────────────────────────────

  // 1.1 WebAudio API & AudioContext
  const hasWebAudio =
    typeof window !== 'undefined' &&
    Boolean(window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  items.push({
    id: 'audio_engine',
    name: 'WebAudio Synthesis Engine',
    category: 'mandatory',
    isConfigured: hasWebAudio,
    statusBadge: hasWebAudio ? 'READY' : 'UNAVAILABLE',
    description: 'Browser audio decoding, resynthesis audition, and FFT spectral inspection.',
    targetTab: 'general',
    impactSummary: hasWebAudio ? 'Operational' : 'Audio playback and spectral analysis disabled.',
  });

  // 1.2 LocalStorage & Persistence
  let hasStorage = false;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem('__health_test__', '1');
      localStorage.removeItem('__health_test__');
      hasStorage = true;
    } catch {
      hasStorage = false;
    }
  }
  items.push({
    id: 'local_storage',
    name: 'Local Session & Preferences Storage',
    category: 'mandatory',
    isConfigured: hasStorage,
    statusBadge: hasStorage ? 'READY' : 'BLOCKED',
    description: 'Persistent storage for user sessions, skins, and BYOK credentials.',
    targetTab: 'general',
    impactSummary: hasStorage ? 'Operational' : 'Preferences and state cannot be saved across sessions.',
  });

  // 1.3 SoundFont Bank Path
  const bankPath =
    typeof localStorage !== 'undefined'
      ? localStorage.getItem('neumodmakr_bank_path')
      : null;
  const hasBankPath = Boolean(bankPath && bankPath.trim().length > 0);
  items.push({
    id: 'bank_path',
    name: 'SoundFont / Sample Library Directory',
    category: 'mandatory',
    isConfigured: hasBankPath,
    statusBadge: hasBankPath ? 'CONFIGURED' : 'NOT SET',
    description: bankPath ? `Path: ${bankPath}` : 'Default SoundFont library folder for quick patch auditions.',
    targetTab: 'general',
    impactSummary: hasBankPath ? 'Configured' : 'Quick SoundFont loader will default to manual file picker.',
  });

  // ── 2. Optional / Advanced Features ─────────────────────

  // 2.1 Local Python Companion Bridge (Port 7860)
  const isBridgeConnected = bridgeClient.isConnected();
  items.push({
    id: 'companion_bridge',
    name: 'Local Companion Bridge (Python 7860)',
    category: 'optional',
    isConfigured: isBridgeConnected,
    statusBadge: isBridgeConnected ? 'CONNECTED' : 'OFFLINE',
    description: 'Local GPU VRAM worker for AudioSR, Demucs separation, and offline AI cover rendering.',
    targetTab: 'bridge',
    impactSummary: isBridgeConnected
      ? 'GPU acceleration active'
      : 'Local neural models unavailable (pure DSP fallback active).',
  });

  // 2.2 Cloud AI BYOK Keys (Fase 44: 9 proveedores, incluye deepseek/groq/mistral)
  const hasAnyCloudKey = cloudByokClient.isReady();
  items.push({
    id: 'cloud_byok',
    name: 'Cloud AI API Keys (Gemini, OpenAI, Claude, Replicate, DeepSeek, Groq, Mistral)',
    category: 'optional',
    isConfigured: hasAnyCloudKey,
    statusBadge: hasAnyCloudKey ? 'CONFIGURED' : 'UNCONFIGURED',
    description: 'Private Bring-Your-Own-Key tokens for cloud image generation and neural processing.',
    targetTab: 'cloud',
    impactSummary: hasAnyCloudKey
      ? 'Cloud neural generators enabled'
      : 'Cloud AI cover generators disabled (procedural offline mode active).',
  });

  // 2.3 AxionikDB Model Repository Path
  const axionikPath =
    typeof localStorage !== 'undefined'
      ? localStorage.getItem('abd_axionikdb_path')
      : null;
  const hasAxionikPath = Boolean(axionikPath && axionikPath.trim().length > 0);
  items.push({
    id: 'axionik_path',
    name: 'AxionikDB Model Catalog Path',
    category: 'optional',
    isConfigured: hasAxionikPath,
    statusBadge: hasAxionikPath ? 'CONFIGURED' : 'OPTIONAL',
    description: axionikPath ? `Path: ${axionikPath}` : 'Local catalog path for AxionikVS model browser synchronization.',
    targetTab: 'general',
    impactSummary: hasAxionikPath ? 'Synchronized' : 'AxionikVS local browser synchronization inactive.',
  });

  // 2.4 NeuronDB Factory Models Path
  const neuronDbPath =
    typeof localStorage !== 'undefined'
      ? localStorage.getItem('abd_neurondb_path')
      : null;
  const hasNeuronDbPath = Boolean(neuronDbPath && neuronDbPath.trim().length > 0);
  items.push({
    id: 'neurondb_path',
    name: 'NeuronDB Factory Library Path',
    category: 'optional',
    isConfigured: hasNeuronDbPath,
    statusBadge: hasNeuronDbPath ? 'CONFIGURED' : 'OPTIONAL',
    description: neuronDbPath ? `Path: ${neuronDbPath}` : 'Direct access to Hartmann Neuron 000..511 hardware models.',
    targetTab: 'general',
    impactSummary: hasNeuronDbPath ? 'Synchronized' : 'NeuronDB hardware models must be imported via file dialog.',
  });

  // Calculate totals
  const mandatoryItems = items.filter((i) => i.category === 'mandatory');
  const optionalItems = items.filter((i) => i.category === 'optional');

  const mandatoryConfigured = mandatoryItems.filter((i) => i.isConfigured).length;
  const optionalConfigured = optionalItems.filter((i) => i.isConfigured).length;

  const hasMissingMandatory = mandatoryConfigured < mandatoryItems.length;
  const hasMissingOptional = optionalConfigured < optionalItems.length;

  const overallStatus: 'ok' | 'warning' | 'error' = hasMissingMandatory
    ? 'error'
    : hasMissingOptional
      ? 'warning'
      : 'ok';

  return {
    overallStatus,
    mandatoryCount: mandatoryItems.length,
    mandatoryConfigured,
    optionalCount: optionalItems.length,
    optionalConfigured,
    hasMissingMandatory,
    hasMissingOptional,
    items,
  };
}

/**
 * Checks if a specific feature is gated by missing configuration.
 */
export function isFeatureGated(featureId: 'cloud_ai' | 'bridge_neural'): {
  gated: boolean;
  reason: string;
  targetTab: SettingsModalTab;
} {
  if (featureId === 'bridge_neural') {
    const isConn = bridgeClient.isConnected();
    if (!isConn) {
      return {
        gated: true,
        reason: 'Local Companion Bridge is offline. Start `python bridge/server.py` to enable local GPU features.',
        targetTab: 'bridge',
      };
    }
  }

  if (featureId === 'cloud_ai') {
    if (!cloudByokClient.isReady()) {
      return {
        gated: true,
        reason: 'Cloud AI requires at least one private API key (Gemini, OpenAI, Claude, Replicate, DeepSeek, Groq, Mistral).',
        targetTab: 'cloud',
      };
    }
  }

  return { gated: false, reason: '', targetTab: 'general' };
}
