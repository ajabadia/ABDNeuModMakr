export interface CopilotShellOptions {
  container?: HTMLElement | null;
  hostShellEl?: HTMLElement | null;
  modalsRootEl?: HTMLElement | null;
  dockMinViewportWidth?: number;
  orchestrator?: any;
  getHostContext?: () => any;
  onUndoLastAction?: () => Promise<{ ok: boolean; message?: string }>;
  onExecuteAction?: (action: any) => Promise<{ ok: boolean; message?: string }>;
  kbArticles?: any[];
}

export declare class CopilotShell {
  container: HTMLElement | null;
  hostShellEl: HTMLElement | null;
  modalsRootEl: HTMLElement | null;
  dockMinViewportWidth: number;
  orchestrator: any;
  activeTab: 'assistant' | 'manual' | 'log';
  isOpen: boolean;

  constructor(options?: CopilotShellOptions);
  initDom(): void;
  setupListeners(): void;
  updateLayoutMode(): void;
  setActiveTab(tab: 'assistant' | 'manual' | 'log'): void;
  toggle(force?: boolean): void;
  refreshDeterministicHud(): void;
  appendChatMessage(role: string, content: string): void;
  sendMessage(text: string): Promise<void>;
  renderProposedAction(action: any): void;
  searchManual(query: string): void;
  addLogEntry(entry: string): void;
  renderLogEntries(): void;
}
