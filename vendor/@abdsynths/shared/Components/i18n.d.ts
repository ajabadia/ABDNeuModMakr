export type SharedLocale = 'en' | 'es' | (string & {});

export interface SharedTranslations {
  common: {
    close: string;
    save: string;
    cancel: string;
    load: string;
    export: string;
    import: string;
    reset: string;
    resetAll: string;
    search: string;
    all: string;
    min: string;
    max: string;
    default: string;
    enabled: string;
    disabled: string;
    status: string;
    ready: string;
    active: string;
    none: string;
    bytes: string;
    modified: string;
    valuesUnit: string;
    clear: string;
    apply: string;
    discard: string;
    confirm: string;
    abort: string;
    edit: string;
  };
  navbar: {
    menuFile: string;
    menuEdit: string;
    menuMode: string;
    menuView: string;
    menuHelp: string;
    loadBank: string;
    saveBank: string;
    loadPreset: string;
    savePreset: string;
    initBank: string;
    initPreset: string;
    undo: string;
    redo: string;
    bankBrowser: string;
    randomize: string;
    matrixMod: string;
    midiLearn: string;
    hardwareSysEx: string;
    dspCalibration: string;
    effectsRack: string;
    globalSettings: string;
    zoom: string;
    zoom100: string;
    zoom125: string;
    zoom150: string;
    colorTheme: string;
    language: string;
    langEn: string;
    langEs: string;
    manual: string;
    checkForUpdates: string;
    about: string;
    presetPillTitle: string;
    presetLabel: string;
    voicesTitle: string;
    voicesLabel: string;
    cpuTitle: string;
    btnMatrixTitle: string;
    btnMidiTitle: string;
    btnSysExTitle: string;
    btnCalibTitle: string;
    btnEffectsTitle: string;
    btnBankTitle: string;
    btnSettingsTitle: string;
    btnThemeTitle: string;
    btnLangTitle: string;
    matrix: string;
    midi: string;
    sysex: string;
    calib: string;
    effects: string;
    bank: string;
    settings: string;
    aboutAuthor: string;
    aboutCopyright: string;
  };
  settings: {
    drawerTitle: string;
    polyphonyCard: string;
    numVoicesLabel: string;
    soundPanLabel: string;
    panKeyTrackLabel: string;
    controllersCard: string;
    pitchBendRangeLabel: string;
    footswitchLabel: string;
    uiThemeCard: string;
    themeLabel: string;
    zoomLabel: string;
  };
  calibration: {
    drawerTitle: string;
    searchPlaceholder: string;
    modifiedBtn: string;
    modifiedBtnTitle: string;
    loadJsonBtn: string;
    loadJsonTitle: string;
    exportJsonBtn: string;
    exportJsonTitle: string;
    resetAllBtn: string;
    resetAllTitle: string;
    allTab: string;
    valuesUnit: string;
    modShort: string;
    resetGroupBtn: string;
    resetGroupTitle: string;
    resetSingleTitle: string;
    sliderDblClickTitle: string;
    defaultTickTitle: string;
    sourceRefTitle: string;
    minLabel: string;
    maxLabel: string;
  };
  hardwareDumps: {
    drawerTitle: string;
    connectionCard: string;
    portStatusConnected: string;
    portStatusDisconnected: string;
    dumpTypeTitle: string;
    actionRequestDump: string;
    actionSendDump: string;
    actionLoadSyx: string;
    actionExportSyx: string;
    actionApplyToSynth: string;
    inspectorTitle: string;
    diffTitle: string;
    activityLogTitle: string;
    clearLogBtn: string;
    waitingData: string;
  };
  midiLearn: {
    drawerTitle: string;
    learnPrompt: string;
    clearAll: string;
    learnReplace: string;
    learnAdd: string;
    unbindTarget: string;
    openMatrix: string;
    exportMappings: string;
    importMappings: string;
    channel: string;
    source: string;
    target: string;
    range: string;
    curve: string;
    invert: string;
  };
}

export const SHARED_EN: SharedTranslations;
export const SHARED_ES: SharedTranslations;
export const SHARED_LOCALES: Record<'en' | 'es', SharedTranslations>;
export const DEFAULT_STORAGE_KEY: string;

export function deepMergeLocales<T extends Record<string, any>, U extends Record<string, any>>(
  baseObj: T,
  overrideObj: U
): T & U;

export function collectLocaleKeys(obj: Record<string, any>, prefix?: string): string[];

export interface SynthI18nOptions<TLocale extends string = 'en' | 'es'> {
  locales?: Partial<Record<TLocale, Record<string, any>>>;
  defaultLocale?: TLocale;
  storageKey?: string;
  legacyStorageKeys?: string[];
  detectBrowserLocale?: boolean;
}

export interface SynthI18nInstance<TLocale extends string = 'en' | 'es', TDict = SharedTranslations> {
  initI18n(): TLocale;
  getLocale(): TLocale;
  setLocale(locale: TLocale): void;
  onLocaleChange(callback: (locale: TLocale) => void): () => void;
  t(path: string, params?: Record<string, string | number>): string;
  applyI18n(root?: ParentNode): void;
  getSupportedLocales(): TLocale[];
  getDictionary(locale?: TLocale): TDict;
  extendLocale(locale: TLocale, partialDict: Record<string, any>): void;
}

export function createSynthI18n<TLocale extends string = 'en' | 'es', TDict = SharedTranslations>(
  options?: SynthI18nOptions<TLocale>
): SynthI18nInstance<TLocale, TDict>;
