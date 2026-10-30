/**
 * @abdsynths/shared — Components/I18n/locales/en.js
 * Canonical Common English (EN) Dictionary for the ABDSynths Suite.
 *
 * Rules:
 * - Single-letter descriptors and universal synth acronyms (A, D, S, R, LFO,
 *   CUTOFF, RESO, VCO, DCO, VCF, VCA, HPF, LPF, BPF, Scape, Sphere, Blender,
 *   Slicer, MIDI, CC, NRPN, SysEx, PWM, FM, AM, Hz, dB, ms) MUST NOT be translated.
 * - Every key defined in SHARED_EN must exist identically in SHARED_ES (and any
 *   future language added to ABDShared).
 */

export const SHARED_EN = {
  common: {
    close: 'Close',
    save: 'Save',
    cancel: 'Cancel',
    load: 'Load',
    export: 'Export',
    import: 'Import',
    reset: 'Reset',
    resetAll: 'Reset All',
    search: 'Search...',
    all: 'ALL',
    min: 'Min',
    max: 'Max',
    default: 'Default',
    enabled: 'Enabled',
    disabled: 'Disabled',
    status: 'Status',
    ready: 'Ready',
    active: 'Active',
    none: 'None',
    bytes: 'bytes',
    modified: 'MODIFIED',
    valuesUnit: 'values',
    clear: 'Clear',
    apply: 'Apply',
    discard: 'Discard',
    confirm: 'Confirm',
    abort: 'Abort',
    edit: 'Edit',
  },

  navbar: {
    // Standard Menu Bar Headers
    menuFile: 'File',
    menuEdit: 'Edit',
    menuMode: 'Mode',
    menuView: 'View',
    menuHelp: 'Help',

    // Standard File Menu Items
    loadBank: 'Load Bank (.json)...',
    saveBank: 'Save Bank (.json)...',
    loadPreset: 'Load Sound Preset...',
    savePreset: 'Save Sound Preset As...',
    initBank: 'Init Bank (Factory Reset)',
    initPreset: 'Init Sound (Factory Reset)',

    // Standard Edit Menu Items
    undo: 'Undo',
    redo: 'Redo',
    bankBrowser: 'Bank Browser...',
    randomize: 'Randomize Patch',
    matrixMod: 'Modulation Matrix...',
    midiLearn: 'MIDI Learn & CC Mapping Matrix...',
    hardwareSysEx: 'Hardware SysEx Dumps & Live Inspector...',
    dspCalibration: 'DSP Calibration & Magic Numbers...',
    effectsRack: 'Effects Rack...',
    globalSettings: 'Global Synth Settings...',

    // Standard View Menu Items
    zoom: 'Zoom',
    zoom100: '100% (Normal)',
    zoom125: '125% (Medium)',
    zoom150: '150% (Large)',
    colorTheme: 'Color Theme',
    language: 'Language',
    langEn: 'English (EN)',
    langEs: 'Español (ES)',

    // Standard Help Menu Items
    manual: 'Documentation / Architecture Guide...',
    checkForUpdates: 'Check for Updates...',
    about: 'About...',

    // Common HUD & Badges
    presetPillTitle: 'Active Sound Preset (Click to open Bank Browser)',
    presetLabel: 'PRESET:',
    voicesTitle: 'Active polyphonic voices',
    voicesLabel: 'VOICES:',
    cpuTitle: 'Audio DSP CPU Load',
    btnMatrixTitle: 'Modulation Matrix (Ctrl+M)',
    btnMidiTitle: 'MIDI Learn & CC/NRPN Mapping Matrix (Ctrl+L)',
    btnSysExTitle: 'Hardware SysEx Dumps & Live Inspector (Ctrl+.)',
    btnCalibTitle: 'DSP Calibration & Magic Numbers (Ctrl+;)',
    btnEffectsTitle: 'Effects Rack (Ctrl+F)',
    btnBankTitle: 'Bank Browser (Ctrl+B)',
    btnSettingsTitle: 'Global Synth Settings & Preferences (Ctrl+,)',
    btnThemeTitle: 'Cycle Color Theme',
    btnLangTitle: 'Switch Language (EN / ES)',

    // Common Quick Action Button Short Labels
    matrix: 'Matrix',
    midi: 'MIDI',
    sysex: 'SysEx',
    calib: 'Calib',
    effects: 'Effects',
    bank: 'Bank',
    settings: 'Settings',

    // Common About Dialog
    aboutAuthor: 'ABDSynths',
    aboutCopyright: '© 2026 ABDSynths',
  },

  settings: {
    drawerTitle: 'SYNTH SETTINGS',
    polyphonyCard: 'POLYPHONY & STEREO SPREAD',
    numVoicesLabel: 'Voices',
    soundPanLabel: 'Pan',
    panKeyTrackLabel: 'Pan KeyTrack',
    controllersCard: 'PERFORMANCE CONTROLLERS & PITCH BEND',
    pitchBendRangeLabel: 'PB Range',
    footswitchLabel: 'Footswitch Destination',
    uiThemeCard: 'USER INTERFACE & SCALE',
    themeLabel: 'Color Theme',
    zoomLabel: 'UI Zoom Level',
  },

  calibration: {
    drawerTitle: 'DSP CALIBRATION & MAGIC NUMBERS',
    searchPlaceholder: 'Search magic number by name, ID, description or C++ reference...',
    modifiedBtn: 'MODIFIED',
    modifiedBtnTitle: 'Show only parameters that have been modified from their factory default value',
    loadJsonBtn: 'LOAD JSON',
    loadJsonTitle: 'Load calibration configuration from a JSON file',
    exportJsonBtn: 'EXPORT JSON',
    exportJsonTitle: 'Export all current calibration values to a JSON file',
    resetAllBtn: 'RESET ALL',
    resetAllTitle: 'Restore all magic numbers to their original factory constants',
    allTab: 'ALL',
    valuesUnit: 'values',
    modShort: 'mod',
    resetGroupBtn: 'Reset Group',
    resetGroupTitle: 'Restore all values in category to their factory defaults',
    resetSingleTitle: 'Restore to factory default',
    sliderDblClickTitle: 'Double-click to restore to factory default',
    defaultTickTitle: 'Original factory default:',
    sourceRefTitle: 'Source in C++ code / binary',
    minLabel: 'Min',
    maxLabel: 'Max',
  },

  hardwareDumps: {
    drawerTitle: 'HARDWARE SYSEX DUMPS & LIVE INSPECTOR',
    connectionCard: 'MIDI PORT & CONNECTION STATUS',
    portStatusConnected: 'Connected',
    portStatusDisconnected: 'Disconnected',
    dumpTypeTitle: 'DUMP TYPE SELECTOR',
    actionRequestDump: 'Request Dump from Hardware',
    actionSendDump: 'Send Current Sound to Hardware',
    actionLoadSyx: 'Load .syx File...',
    actionExportSyx: 'Export .syx File...',
    actionApplyToSynth: 'Apply Parameters to Synth Engine',
    inspectorTitle: 'LIVE SYSEX INSPECTOR',
    diffTitle: 'A/B SYSEX COMPARISON & MUTATION DIFF',
    activityLogTitle: 'ACTIVITY LOG',
    clearLogBtn: 'Clear Log',
    waitingData: 'Waiting for SysEx transmission...',
  },

  midiLearn: {
    drawerTitle: 'MIDI LEARN & CC MAPPING MATRIX',
    learnPrompt: 'Waiting for MIDI CC message from controller...',
    clearAll: 'Clear All Mappings',
    learnReplace: 'Learn MIDI (Replace)...',
    learnAdd: 'Add Another Controller (N:1)...',
    unbindTarget: 'Remove MIDI Mapping',
    openMatrix: 'Open MIDI Mapping Matrix...',
    exportMappings: 'Export MIDI Map (.json)',
    importMappings: 'Import MIDI Map (.json)',
    channel: 'Channel',
    source: 'Source',
    target: 'Target Parameter',
    range: 'Range (Min..Max)',
    curve: 'Curve',
    invert: 'Invert',
  },
};
