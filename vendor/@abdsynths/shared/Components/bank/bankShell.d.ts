export interface BankShellTab {
  id: string;
  label: string;
  iconHtml?: string;
}

export interface BankShellHeaderAction {
  id: string;
  label: string;
  title?: string;
  iconHtml?: string;
}

export interface BankShellFooterAction {
  id: string;
  label: string;
  title?: string;
  kind?: 'primary' | 'outline';
}

export interface BankShellOptions {
  title?: string;
  badge?: string;
  tabs?: BankShellTab[];
  activeTab?: string;
  searchPlaceholder?: string;
  headerActions?: BankShellHeaderAction[];
  footerActions?: BankShellFooterAction[];
  onTabChange?: (tab: string) => void;
  onSearch?: (query: string) => void;
  onHeaderAction?: (id: string) => void;
  onFooterAction?: (id: string) => void;
  onClose?: () => void;
}

export interface BankShell {
  element: HTMLElement;
  contentEl: HTMLElement;
  toolbarEl: HTMLElement;
  footerEl: HTMLElement;
  readonly activeTab: string;
  getQuery(): string;
  setBadge(text: string): void;
  setTabCount(tabId: string, count: number): void;
  setTab(tabId: string): void;
  focusSearch(): void;
  flashStatus(message: string, kind?: 'ok' | 'working' | 'error'): void;
  setFootSlot(text: string): void;
  setFooterStatus(text: string): void;
  setBusy(actionId: string, active: boolean): void;
  destroy(): void;
}

export function createBankShell(options?: BankShellOptions): BankShell;
