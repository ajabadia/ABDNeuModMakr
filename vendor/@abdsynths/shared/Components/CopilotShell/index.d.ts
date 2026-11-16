export { CopilotShell } from './CopilotShell.js';
export { AiProviderSettingsPanel } from './AiProviderSettingsPanel.js';
export { renderSafeCopilotMarkdown } from './copilotMarkdown.js';
export { highlightUiTarget, clearUiHighlight } from './uiSpotlight.js';

export type UnifiedAiTabId = 'tasks' | 'local-llm' | 'cloud-byok' | 'local-models';

export interface UnifiedAiTaskOptionDescriptor {
  value: string;
  label: string;
  hint?: string;
  comingSoon?: boolean;
  disabled?: boolean;
  supportedInApp?: boolean;
}

export interface UnifiedAiTaskDescriptor {
  id: string;
  title: string;
  description?: string;
  defaultValue?: string;
  options: UnifiedAiTaskOptionDescriptor[];
}

export interface UnifiedAiPresetDescriptor {
  id: string;
  label: string;
  apply: (current: Record<string, unknown>) => Record<string, unknown>;
}

export interface UnifiedAiCompanionBridgeConfig {
  title?: string;
  connected: boolean;
  url: string;
  statusText?: string;
  cudaAvailable?: boolean;
  cudaDevice?: string;
  cpuCount?: number;
  onConnect?: (url: string) => Promise<void> | void;
  onDisconnect?: () => void;
}

export interface UnifiedAiSettingsPanelOptions {
  container: HTMLElement;
  appId?: string;
  locale?: string;
  i18n?: { getLocale?: () => string; t?: (key: string) => string };
  activeTab?: UnifiedAiTabId;
  localClient?: unknown;
  byokClient?: unknown;
  orchestrator?: unknown;
  tasksConfig?: { enabled: boolean; tasks: Record<string, string> };
  taskDescriptors?: UnifiedAiTaskDescriptor[];
  presets?: UnifiedAiPresetDescriptor[];
  safetyNote?: string;
  tasksFooterHtml?: string;
  onBindTasksFooter?: (slotEl: HTMLElement) => void;
  supportedByokCapabilities?: Array<'text' | 'image' | 'audio-cloud'>;
  companionBridge?: UnifiedAiCompanionBridgeConfig | null;
  modelStoreBridge?: unknown;
  onTabChange?: (tabId: UnifiedAiTabId) => void;
  onTasksChange?: (nextConfig: { enabled: boolean; tasks: Record<string, string> }) => void;
  onLocalLlmChange?: (localCfg: unknown, engineMode: string) => void;
  onByokChange?: (byokCfg: unknown) => void;
  onSave?: (payload: unknown) => void;
}

export class UnifiedAiSettingsPanel {
  constructor(options?: UnifiedAiSettingsPanelOptions);
  setActiveTab(tabId: UnifiedAiTabId): void;
  updateTasksConfig(nextConfig: { enabled: boolean; tasks: Record<string, string> }): void;
  updateCompanionBridge(nextBridge: UnifiedAiCompanionBridgeConfig | null): void;
  setTasksFooterHtml(html: string): void;
  refreshModelStore(): Promise<unknown>;
  render(): void;
  destroy(): void;
}
