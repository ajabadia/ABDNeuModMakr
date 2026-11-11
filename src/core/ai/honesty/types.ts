// ─────────────────────────────────────────────────────────
// AI honesty — shared type contracts (status, actions, engine badges).
// ─────────────────────────────────────────────────────────

import type { AiAssistanceConfig } from '../../types.ts';
import type { ArtworkProvider } from '../ModelArtworkGenerator.ts';

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

export type AiActionId =
  | 'recorder-bwe-enhance'
  | 'recorder-ai-denoise'
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
  aiConfig?: AiAssistanceConfig;
  isDenoiseModelReady?: boolean;
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

export type ExecutionEngineKind =
  | 'native-rule'    // 🔒 Regla / Compilador Nativo
  | 'dsp'            // ⚙️ Determinista DSP (WebAudio / WASM)
  | 'local-ai'       // 🧠 IA Local (GPU Bridge / WebGPU)
  | 'cloud-ai'       // ☁️ IA Cloud (LLM / BYOK API)
  | 'fallback-dsp';  // ⚠️ Fallback a DSP (IA pedida pero modelo no descargado o sin API)

export interface ExecutionEngineBadge {
  kind: ExecutionEngineKind;
  iconKey: 'lock' | 'cpu' | 'ai' | 'cloud' | 'alert' | 'sparkle';
  shortLabel: string;
  modelOrEngineName: string;
  cssClass: string;
  tooltip: string;
  /** True when in Batch mode this step executes across all models consecutively to keep the local AI model warm */
  isBatchStageGroupedLocalAi: boolean;
}

export interface PipelineStepEngineContext {
  aiConfig?: AiAssistanceConfig;
  isBridgeConnected: boolean;
  installedBridgeModelIds?: ReadonlySet<string>;
  isCloudReady: boolean;
  cloudProviderLabel?: string | null;
  dspAlgorithm?: 'legacy' | 'enhanced';
  bridgeNeuralInferenceReady?: boolean;
}
