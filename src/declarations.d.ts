declare module '@abdsynths/shared/components/bank/bankShell.js' {
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
}

declare module '@abdsynths/shared/components/bank/bankCard.js' {
  export interface BankCardAction {
    id: string;
    label: string;
    kind?: 'primary' | 'export';
    title?: string;
    iconHtml?: string;
  }
  export interface BankCardData {
    slot: string | number;
    catClass?: string;
    catLabel?: string;
    name?: string;
    title?: string;
    iconHtml?: string;
    badges?: string[];
    actions?: BankCardAction[];
    selected?: boolean;
    extraClass?: string;
  }
  export function bankCardHtml(card: BankCardData): string;
  export function bindBankCards(
    container: HTMLElement,
    handlers?: {
      onCardClick?: (slot: number) => void;
      onCardDblClick?: (slot: number) => void;
      onAction?: (info: { slot: number; action: string }) => void;
    }
  ): () => void;
}

declare module '@abdsynths/shared/components/bank/bankCategories.js' {
  export function classifyBankCategory(category: string): {
    catClass: string;
    paramId: number;
  };
}

declare module '@abdsynths/shared/components/bank/bankChips.js' {
  export interface BankChipItem {
    id: string;
    label: string;
    count?: number;
    catClass?: string;
    title?: string;
    prefixHtml?: string;
  }
  export function bankChipsHtml(items: BankChipItem[], activeId?: string): string;
  export function bindBankChips(container: HTMLElement, onPick: (id: string) => void): () => void;
}

declare module '@abdsynths/midi-keyb' {
  export interface KeyboardZone {
    id?: string | number;
    lowKey: number;
    highKey: number;
    rootKey?: number;
    color?: string;
  }

  export interface KeyboardConfig {
    numOctaves?: number;
    startNote?: number;
    fixedOctaves?: boolean;
    maxOctaveShift?: number;
    velocitySource?: string;
    velocityCurve?: string;
    fixedVelocity?: number;
    ledColor?: string | null;
    enablePressureDisplay?: boolean;
    enablePitchBendDisplace?: boolean;
    enableIvoryTexture?: boolean;
    enableVintageWear?: boolean;
    enableQwerty?: boolean;
    showQwertyLabels?: boolean;
    enableTouch?: boolean;
    enableAftertouch?: boolean;
    enableAccessibility?: boolean;
    enableCollapse?: boolean;
    enableResizeObserver?: boolean;
    enablePanic?: boolean;
    enableWheels?: boolean;
    enableSustain?: boolean;
    enableHold?: boolean;
    enableRetrig?: boolean;
    enableSostenuto?: boolean;
    enableSoftPedal?: boolean;
    zones?: KeyboardZone[];
    activeZoneIndex?: number | string;
  }

  export interface KeyboardDeps {
    containerId?: string;
    wheelPitchId?: string | null;
    wheelModId?: string | null;
    octUpId?: string | null;
    octDownId?: string | null;
    panicBtnId?: string | null;
    onNoteOn?: (note: number) => void;
    onNoteOff?: (note: number) => void;
    onPitchBend?: (value: number) => void;
    onModWheel?: (value: number) => void;
    onCollapseChange?: (collapsed: boolean) => void;
    config?: KeyboardConfig;
  }

  export interface KeyboardInstance {
    destroy: () => void;
    panic: () => void;
    setOctaveCount: (numOctaves: number, startNote?: number) => void;
    setZones: (zones: KeyboardZone[], activeZoneIndex?: number | string | null) => void;
    setActiveZone: (indexOrId: number | string | null) => void;
    getZones: () => KeyboardZone[];
    getActiveZone: () => number | string;
    getActiveNotes: () => number[];
    setPitchBend: (val: number) => void;
    setModWheel: (val: number) => void;
  }

  export function createKeyboard(deps?: KeyboardDeps): KeyboardInstance;
}
