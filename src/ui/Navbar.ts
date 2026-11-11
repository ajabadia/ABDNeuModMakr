// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Navbar Module
// Integrates with ABDShared's SynthNavBar (`onAction`, `activeValues`, `aboutDialog`)
// ─────────────────────────────────────────────────────────

import { createSynthNavBar } from '@abdsynths/shared/components';
import { ICONS } from './icons';
import { toast } from './notify';
import { getAppLocale, setAppLocale, onAppLocaleChange, tApp, type AppLocale } from '../core/i18n';
import { cloudByokClient } from '../core/ai/CloudByokClient';
import { webNeuralEngine } from '../core/ai/WebNeuralEngine';
import { resolveAiSystemStatus } from '../core/ai/aiHonesty';
import { TIME_CAPSULE_CANONICAL_LABEL } from '../app/exportDestinations';
import type { Session, HistoryState, TargetFormat, WorkingMode, AiAssistanceConfig } from '../core/types';

export type SettingsModalTab = 'general' | 'ai' | 'web' | 'cloud' | 'bridge';

export interface NavbarHandlers {
  onNewSession: () => void;
  onOpenSession: () => void;
  onSaveSession: () => void;
  onSaveSessionAs?: () => void;
  onSaveToAxionikDb?: () => void;
  onSaveToAxionikDbAs?: () => void;
  onImportSamples: () => void;
  onUniversalSmartImport?: () => void;
  onImportSampler?: () => void;
  onImportFolder: () => void;
  onImportByName: () => void;
  onImportModelFolder: () => void;
  onImportModel: () => void;
  onConfigureNeuronDbFolder?: () => void;
  onExportModel: () => void;
  onExportModelAs?: () => void;
  onExportSampler?: () => void;
  onOpenExportDestination?: () => void;
  onExportZoneAiff: () => void;
  onInstallPwa?: () => void;
  onOpenAiEngineModal?: () => void;
  onOpenSettingsModal?: (tab?: SettingsModalTab) => void;
  onOpenConfigHealthModal?: () => void;
  onToggleAiAssistance?: () => void;
  onOpenBridgeModal?: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onAddZone: () => void;
  onRemoveZone: () => void;
  onClearZones: () => void;
  onAutoRepairCoverage: () => void;
  onStartProcess: () => void;
  onValidateCoverage: () => void;
  onSetTargetFormat: (format: TargetFormat) => void;
  onSetWorkingMode?: (mode: WorkingMode) => void;
  onToggleZoneDrawer: () => void;
  onToggleSpectral: () => void;
  onToggleBank: () => void;
  onOpenBatchModal?: () => void;
  onOpenMusicianWizard?: () => void;
  onOpenModelConfig?: () => void;
  onOpenAiCoverGenerator?: () => void;
  onOpenAudioChopper?: () => void;
  onOpenAudioRecorder?: () => void;
  onOpenLoopEditor?: () => void;
  onAutoLoopAllZones?: () => void;
  onToggleLogs: () => void;
  onToggleCopilot?: () => void;
  /** Coverage-pill click: always surfaces the audit (never toggles it closed). Optional for backward compat. */
  onOpenAudit?: () => void;
  onSelectTheme: (theme: string) => void;
  onToggleTheme: () => void;
  onSelectThemeFamily?: (family: string) => void;
  onSetThemeMode?: (mode: 'light' | 'dark') => void;
  onToggleThemeMode?: () => void;
  onSetLocale?: (locale: AppLocale) => void;
  onToggleLocale?: () => void;
}

export class AppNavbar {
  private container: HTMLElement;
  private handlers: NavbarHandlers;
  private navBarInstance: {
    setActiveValues: (vals: Record<string, unknown> | ((action: string) => unknown)) => void;
  } | null = null;
  private statusElement: HTMLElement | null = null;
  private coverageElement: HTMLElement | null = null;
  private aiPillElement: HTMLElement | null = null;
  private aiTextElement: HTMLElement | null = null;
  private processBtn: HTMLButtonElement | null = null;
  private undoBtn: HTMLButtonElement | null = null;
  private redoBtn: HTMLButtonElement | null = null;
  private docModalEl: HTMLElement | null = null;
  private themeModeBtn: HTMLButtonElement | null = null;
  private langBtn: HTMLButtonElement | null = null;
  private currentTheme = 'neuron-light';
  private currentThemeFamily = 'neuron';
  private currentThemeMode: 'light' | 'dark' = 'light';
  private currentLocale: AppLocale = getAppLocale();
  private currentTargetFormat: TargetFormat = 'dual';
  private currentWorkingMode: WorkingMode = 'classic';
  private lastSession: Session | null = null;
  private lastCoverage: string[] = [];
  private lastIsBridgeConnected = false;
  private lastHistory: HistoryState | null = null;

  constructor(container: HTMLElement, handlers: NavbarHandlers) {
    this.container = container;
    this.handlers = handlers;
  }

  private buildMenus() {
    const es = this.currentLocale === 'es';
    return [
      {
        name: tApp('navbar.menuFile'),
        items: [
          { id: 101, label: es ? 'Nueva Sesión (Reiniciar)' : 'New Session (Reset)', action: 'newSession' },
          { id: 102, label: es ? 'Abrir Sesión (.nmsession.json)...' : 'Open Session (.nmsession.json)...', action: 'openSession', shortcut: 'Ctrl+O' },
          {
            id: 103,
            label: es ? 'Guardar...' : 'Save...',
            submenu: [
              { id: 1031, label: es ? 'Guardar Sesión' : 'Save Session', action: 'saveSession', shortcut: 'Ctrl+S' },
              { id: 1032, label: es ? 'Guardar Sesión Como...' : 'Save Session As...', action: 'saveSessionAs', shortcut: 'Ctrl+Shift+S' },
              { separator: true },
              { id: 1033, label: es ? 'Guardar Modelo en AxionikDB...' : 'Save Model to AxionikDB...', action: 'saveToAxionikDb' },
              { id: 1034, label: es ? 'Guardar Modelo en AxionikDB Como (Duplicar)...' : 'Save Model to AxionikDB As (Duplicate)...', action: 'saveToAxionikDbAs' },
              { separator: true },
              { id: 1035, label: `${es ? 'Exportar' : 'Export'} ${TIME_CAPSULE_CANONICAL_LABEL}...`, action: 'exportModel', shortcut: 'Ctrl+T' },
              { id: 1036, label: es ? 'Exportar Cápsula del Tiempo Como (.zip)...' : 'Export Time Capsule As (.zip)...', action: 'exportModelAs', shortcut: 'Ctrl+Shift+T' },
            ],
          },
          { separator: true },
          { id: 104, label: es ? 'Importación Inteligente Universal...' : 'Universal Smart Import...', action: 'universalSmartImport', shortcut: 'Ctrl+I' },
          {
            id: 1040,
            label: es ? 'Importar Formatos Específicos' : 'Import Specific Formats',
            submenu: [
              { id: 1041, label: es ? 'Importar Archivos de Audio (.wav / .aif / .flac)...' : 'Import Audio Files (.wav / .aif / .flac)...', action: 'importSamples' },
              { id: 1045, label: es ? 'Importar Audio por Nombre (Convención Hartmann)...' : 'Import Audio by Name (Hartmann convention)...', action: 'importByName', shortcut: 'Ctrl+N' },
              { id: 105,  label: es ? 'Importar Carpeta de Audio...' : 'Import Audio Folder...', action: 'importFolder' },
              { separator: true },
              { id: 1055, label: es ? 'Importar Sampler / Imagen de Disco (.sf2, .sfz, .iso, .akp, .exb)...' : 'Import Sampler / Disk Image (.sf2, .sfz, .iso, .akp, .exb)...', action: 'importSampler' },
              { separator: true },
              { id: 106,  label: es ? 'Importar Carpeta de Modelo (<NNN>.model)...' : 'Import Model Folder (<NNN>.model)...', action: 'importModelFolder' },
              { id: 107,  label: es ? 'Importar Archivos de Modelo / .zip...' : 'Import Model Files / .zip...', action: 'importModel' },
            ],
          },
          { id: 1065, label: es ? 'Configurar Carpeta de Librería NeuronDB...' : 'Configure NeuronDB Library Folder...', action: 'configureNeuronDbFolder' },
          { separator: true },
          { id: 1085, label: es ? 'Exportar Instrumento (Elegir Destino)...' : 'Export Instrument (Choose Destination)...', action: 'openExportDestination', shortcut: 'Ctrl+Shift+X' },
          { id: 109, label: es ? 'Exportar Zona Activa como AIFF Clásico (44.1k/16b)...' : 'Export Active Zone as Legacy AIFF (44.1k/16b)...', action: 'exportZoneAiff' },
        ],
      },
      {
        name: tApp('navbar.menuEdit'),
        items: [
          { id: 201, label: tApp('navbar.editUndo'), action: 'undo', shortcut: 'Ctrl+Z' },
          { id: 202, label: tApp('navbar.editRedo'), action: 'redo', shortcut: 'Ctrl+Y' },
          { separator: true },
          { id: 203, label: tApp('navbar.editAddZone'), action: 'addZone', shortcut: 'Insert' },
          { id: 204, label: tApp('navbar.editRemoveZone'), action: 'removeZone', shortcut: 'Delete' },
          { id: 206, label: tApp('navbar.editResetZones'), action: 'clearZones' },
          { separator: true },
          { id: 205, label: tApp('navbar.editAutoRepair'), action: 'autoRepairCoverage' },
          { id: 302, label: es ? 'Validar Cobertura MIDI (0..127)' : 'Validate MIDI Coverage (0..127)', action: 'validateCoverage' },
          { separator: true },
          { id: 207, label: tApp('navbar.viewSettings'), action: 'openSettingsModal', shortcut: 'Ctrl+,' },
        ],
      },
      {
        name: tApp('navbar.menuModel'),
        items: [
          { id: 3011, label: tApp('navbar.modelSettings'), action: 'openModelConfig', shortcut: 'Ctrl+M' },
          {
            id: 3000,
            label: es ? 'Herramientas' : 'Tools',
            submenu: [
              { id: 3016, label: tApp('navbar.fileRecordAudio'), action: 'openAudioRecorder' },
              { id: 3013, label: es ? 'Editor de Bucles (Forma de Onda y Cruce por Cero)...' : 'Loop Editor (Waveform & Zero-Crossing)...', action: 'openLoopEditor' },
              { id: 3017, label: tApp('zoneInspector.toolAutoLoopAll'), action: 'autoLoopAllZones' },
              { id: 3012, label: tApp('navbar.fileAutoSlicer'), action: 'openAudioChopper' },
              { separator: true },
              { id: 3014, label: tApp('navbar.modelArtwork'), action: 'openAiCoverGenerator' },
              { id: 3010, label: tApp('navbar.modelGuidedWizard'), action: 'openMusicianWizard', shortcut: 'Ctrl+Shift+W' },
            ],
          },
          { separator: true },
          { id: 301, label: tApp('navbar.modelGenerate'), action: 'startProcess', shortcut: 'Ctrl+P' },
          { id: 3015, label: tApp('navbar.fileBatchCreator'), action: 'openBatchModal', shortcut: 'Ctrl+Shift+B' },
          { separator: true },
          {
            id: 303,
            label: es ? 'Modo de Trabajo' : 'Working Mode',
            submenu: [
              { id: 304, label: es ? 'Modo Clásico (Hardware 1:1)' : 'Classic Mode (1:1 Hardware)', action: 'setWorkingMode', value: 'classic' },
              { id: 305, label: es ? 'Modo Extendido (HD Multi-Capa)' : 'Extended Mode (HD Multi-Layer)', action: 'setWorkingMode', value: 'extended' },
            ],
          },
          {
            id: 306,
            label: es ? 'Formato de Exportación / Guardado' : 'Export / Save Mode',
            submenu: [
              { id: 307, label: 'Dual (.model + .nmmodel)', action: 'setTargetFormat', value: 'dual' },
              { id: 308, label: es ? 'Clásico (.model / .sound)' : 'Classic (.model / .sound)', action: 'setTargetFormat', value: 'legacy-neuron' },
              { id: 309, label: es ? 'Extendido (.nmmodel)' : 'Extended (.nmmodel)', action: 'setTargetFormat', value: 'modern-neural' },
            ],
          },
          { separator: true },
          { id: 310, label: tApp('navbar.modelAiPipeline'), action: 'openAiEngineModal' },
          { id: 906, label: tApp('navbar.helpCompanion'), action: 'openBridgeModal' },
        ],
      },
      {
        name: tApp('navbar.menuView'),
        items: [
          { id: 401, label: es ? 'Cajón Editor de Metadatos de Zona' : 'Zone Metadata Editor Drawer', action: 'toggleZoneDrawer', shortcut: 'Ctrl+J' },
          { id: 402, label: tApp('navbar.viewSpectral'), action: 'toggleSpectral', shortcut: 'Ctrl+E' },
          { separator: true },
          { id: 403, label: tApp('navbar.viewBank'), action: 'toggleBank', shortcut: 'Ctrl+B' },
          { id: 404, label: tApp('navbar.viewTelemetry'), action: 'toggleLogs', shortcut: 'Ctrl+L' },
          { separator: true },
          {
            id: 405,
            label: tApp('navbar.viewThemeSkin'),
            submenu: [
              { id: 406, label: 'Hartmann Neuron (2002)', action: 'selectThemeFamily', value: 'neuron' },
              { id: 407, label: 'Access Virus Snow (2008)', action: 'selectThemeFamily', value: 'virus-snow' },
              { id: 408, label: 'AudioLab Precision', action: 'selectThemeFamily', value: 'audiolab' },
              { id: 409, label: 'Korg MS2000', action: 'selectThemeFamily', value: 'ms2000' },
              { id: 410, label: 'Hartmann Advanced', action: 'selectThemeFamily', value: 'advanced' },
              { id: 411, label: 'Casio CZ-101', action: 'selectThemeFamily', value: 'cz101' },
            ],
          },
          {
            id: 412,
            label: tApp('navbar.viewColorMode'),
            submenu: [
              { id: 413, label: tApp('navbar.viewModeLight'), action: 'setThemeMode', value: 'light' },
              { id: 414, label: tApp('navbar.viewModeDark'), action: 'setThemeMode', value: 'dark' },
              { separator: true },
              { id: 415, label: tApp('navbar.btnThemeModeTitle'), action: 'toggleThemeMode' },
            ],
          },
          {
            id: 416,
            label: tApp('navbar.viewLanguage'),
            submenu: [
              { id: 417, label: 'Español (ES)', action: 'setLocale', value: 'es', iconHtml: ICONS.flagEs },
              { id: 418, label: 'English (EN)', action: 'setLocale', value: 'en', iconHtml: ICONS.flagEn },
              { separator: true },
              { id: 419, label: es ? 'Alternar ES / EN' : 'Toggle ES / EN', action: 'toggleLocale' },
            ],
          },
        ],
      },
      {
        name: tApp('navbar.menuHelp'),
        items: [
          { id: 900, label: es ? 'Asistente Copiloto IA (F1)' : 'Copilot AI Assistant (F1)', action: 'toggleCopilot', shortcut: 'F1' },
          { id: 9001, label: es ? 'Comando Rápido IA (Ctrl+K)' : 'Quick AI Command (Ctrl+K)', action: 'toggleCopilot', shortcut: 'Ctrl+K' },
          { id: 901, label: tApp('navbar.helpGuide'), action: 'manual' },
          { id: 902, label: es ? 'Especificaciones NASAnalysis.dll y Dual-Target...' : 'NASAnalysis.dll & Dual-Target Specs...', action: 'specs' },
          { separator: true },
          { id: 9005, label: es ? 'Diagnóstico y Salud de Configuración del Sistema...' : 'System Configuration Health & Diagnostics...', action: 'openConfigHealth' },
          { id: 903, label: es ? 'Instalar Aplicación de Escritorio (PWA)...' : 'Install Desktop App (PWA)...', action: 'installPwa' },
          { separator: true },
          { id: 904, label: tApp('navbar.helpAbout'), action: 'about' },
        ],
      },
    ];
  }

  public mount(
    initialSession: Session,
    initialCoverage: string[],
    initialTheme = 'neuron-light'
  ): void {
    this.currentTheme = initialTheme;
    this.currentTargetFormat = initialSession.processConfig.targetFormat ?? 'dual';
    this.lastSession = initialSession;
    this.lastCoverage = initialCoverage;

    const brand = {
      title: '',
      subtitle: '',
      logoHtml: `<span class="neuron-logo-mark" title="MODELmaker">${ICONS.cpu}</span>`,
    };

    const menus = this.buildMenus();

    // Center HUD Slot
    const centerSlot = document.createElement('div');
    centerSlot.className = 'nav-hud-center';
    const isInitExt = (initialSession.processConfig.workingMode ?? 'classic') === 'extended';
    const initName = isInitExt ? (initialSession.processConfig.expandedName || initialSession.processConfig.modelName) : initialSession.processConfig.modelName;
    const initSlot = String(initialSession.processConfig.modelNumber).padStart(3, '0');
    const initCharInfo = isInitExt ? `${initName.length} chars (Extended)` : `${initName.length}/11 chars`;
    centerSlot.innerHTML = `
      <div class="hud-pill hud-model-pill" title="Active target model slot, hardware name, and character length">
        <span class="hud-label" id="hud-model-label">${tApp('navbar.hudTargetModel')}</span>
        <span class="hud-value hud-model-name" id="hud-model-name">#${initSlot} &bull; ${initName} &bull; ${initCharInfo}</span>
      </div>
      <div class="hud-pill hud-coverage-pill" id="hud-coverage-pill" data-ai-target="btn-auto-repair" title="${initialCoverage.length === 0 ? tApp('navbar.hudMidiTooltipOk') : tApp('navbar.hudMidiTooltipErr')}">
        <span class="hud-icon">${initialCoverage.length === 0 ? ICONS.check : ICONS.piano}</span>
        <span class="hud-coverage-text">${initialCoverage.length === 0 ? tApp('navbar.hudMidiOk') : `${initialCoverage.length} ${tApp('navbar.hudMidiGaps')}`}</span>
      </div>
      <div class="hud-pill hud-ai-pill is-ai-off" id="hud-ai-pill" data-ai-target="nav-ai-status-pill" title="Algorithmic DSP mode (AI Off). Click to configure AI assistance.">
        <span class="hud-ai-icon">${ICONS.ai}</span>
        <span class="hud-ai-text" id="hud-ai-text">${tApp('aiStatus.disabledBadge')}</span>
        <span class="hud-ai-chevron">${ICONS.settings}</span>
      </div>
    `;

    // Right Slot
    const rightSlot = document.createElement('div');
    rightSlot.className = 'nav-hud-right';
    rightSlot.innerHTML = `
      <button type="button" class="btn btn-hud-icon" id="nav-btn-undo" title="Nothing to Undo (Ctrl+Z)" disabled>
        ${ICONS.undo}
      </button>
      <button type="button" class="btn btn-hud-icon" id="nav-btn-redo" title="Nothing to Redo (Ctrl+Y)" disabled>
        ${ICONS.redo}
      </button>
      <button type="button" class="btn btn-hud-icon" id="nav-btn-spectral" title="Toggle Spectral & A/B Resynthesis Inspector (Ctrl+E)">
        ${ICONS.wave}
      </button>
      <button type="button" class="btn btn-hud-icon" id="nav-btn-bank" data-ai-target="nav-bank-btn" title="NeuronDB Bank Browser (Ctrl+B)">
        ${ICONS.database}
      </button>
      <button type="button" class="btn btn-hud-icon" id="nav-btn-batch" data-ai-target="nav-batch-processor" title="Batch Processor &amp; Multi-Model Queue (Ctrl+Shift+B)">
        ${ICONS.layers}
      </button>
      <button type="button" class="btn btn-hud-icon" id="nav-btn-copilot" data-ai-target="nav-copilot-toggle" title="Copilot Assistant (F1)">
        ${ICONS.sparkle || ICONS.ai}
      </button>
      <button type="button" class="btn btn-hud-icon" id="nav-btn-logs" title="Validation Log Drawer (Ctrl+L)">
        ${ICONS.terminal}
      </button>
      <button type="button" class="btn btn-hud-icon btn-lang-toggle" id="nav-btn-lang" title="${this.getLangButtonTitle()}" aria-label="${this.getLangButtonTitle()}">
        <span class="lang-flag-icon">${this.currentLocale === 'es' ? ICONS.flagEs : ICONS.flagEn}</span>
      </button>
      <button type="button" class="btn btn-hud-icon btn-theme-mode-toggle" id="nav-btn-theme-mode" title="${this.currentThemeMode === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}">
        <span class="theme-mode-icon">${this.currentThemeMode === 'light' ? ICONS.moon : ICONS.sun}</span>
      </button>
      <button type="button" class="btn btn-hud-icon btn-theme-toggle" id="nav-btn-theme" title="Next synthesizer skin">
        <span class="theme-icon">${ICONS.palette}</span>
      </button>
      <button type="button" class="btn btn-hud-icon btn-settings-toggle" id="nav-btn-settings" title="General Settings &amp; AI Configuration (Ctrl+,)">
        <span class="settings-icon">${ICONS.settings}</span>
        <span class="nav-health-dot is-hidden" id="nav-settings-dot"></span>
      </button>
    `;

    this.navBarInstance = createSynthNavBar({
      container: this.container,
      brand,
      menus,
      centerSlot,
      rightSlot,
      enableGlobalShortcuts: false,
      activeValues: {
        setWorkingMode: 'classic',
        setTargetFormat: this.currentTargetFormat,
        selectTheme: this.currentTheme,
        selectThemeFamily: this.currentThemeFamily,
        setThemeMode: this.currentThemeMode,
        setLocale: this.currentLocale,
      },
      aboutDialog: {
        appName: 'NEURON MODELmaker',
        subtitle: 'Hartmann Spectral Reconstructor & Dual-Target Model Generator',
        version: '1.2.0',
        buildInfo: 'NASAnalysis.dll 1:1 WebAudio DSP + Dual-Target (.model/.sound + .nmmodel). ' +
          'Format research credits: ConvertWithMoss by Juergen Mossgraber (LGPL-3.0, mossgrabers.de) used as a format specification reference for Akai MPC, Kontakt/NCW, Ableton .adv, Logic .exs, TAL-Sampler, TX16Wx, Korg KMP/KSF, DLS, Bitwig .multisample, Decent Sampler, SF2 and SFZ; independent clean-room TypeScript implementation in @abdsynths/shared/formats/sampler.',
        author: 'ABDSynths',
        copyright: '© 2026 ABDSynths',
      },
      onAction: (action: string, value?: unknown) => {
        this.dispatchMenuAction(action, value);
      },
    });

    this.statusElement = centerSlot.querySelector('#hud-model-name');
    this.coverageElement = centerSlot.querySelector('#hud-coverage-pill');
    this.aiPillElement = centerSlot.querySelector('#hud-ai-pill');
    this.aiTextElement = centerSlot.querySelector('#hud-ai-text');
    this.processBtn = rightSlot.querySelector('#nav-btn-process');
    this.undoBtn = rightSlot.querySelector('#nav-btn-undo');
    this.redoBtn = rightSlot.querySelector('#nav-btn-redo');

    // AI HUD Pill click & contextmenu -> opens the AI configuration matrix modal directly
    this.aiPillElement?.addEventListener('click', () => {
      if (this.handlers.onOpenSettingsModal) {
        this.handlers.onOpenSettingsModal('web');
      } else {
        this.handlers.onOpenAiEngineModal?.();
      }
    });

    this.aiPillElement?.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.handlers.onOpenSettingsModal) {
        this.handlers.onOpenSettingsModal('bridge');
      } else {
        this.handlers.onOpenAiEngineModal?.();
      }
    });

    // Initial AI indicator sync
    this.updateAiState(initialSession.processConfig.aiConfig);

    // Center coverage pill click -> always surface the coverage audit.
    // (Toggle semantics hid the audit under an open Bank drawer, which
    // made the click look like it opened the Bank manager instead.)
    this.coverageElement?.addEventListener('click', () => {
      if (this.handlers.onOpenAudit) {
        this.handlers.onOpenAudit();
      } else {
        this.handlers.onToggleLogs();
      }
    });

    // Right slot button clicks
    this.undoBtn?.addEventListener('click', () => this.handlers.onUndo());
    this.redoBtn?.addEventListener('click', () => this.handlers.onRedo());
    this.processBtn?.addEventListener('click', () => this.handlers.onStartProcess());
    rightSlot.querySelector('#nav-btn-spectral')?.addEventListener('click', () => this.handlers.onToggleSpectral());
    rightSlot.querySelector('#nav-btn-bank')?.addEventListener('click', () => this.handlers.onToggleBank());
    rightSlot.querySelector('#nav-btn-batch')?.addEventListener('click', () => this.handlers.onOpenBatchModal?.());
    rightSlot.querySelector('#nav-btn-copilot')?.addEventListener('click', () => {
      if (this.handlers.onToggleCopilot) {
        this.handlers.onToggleCopilot();
      } else {
        this.handlers.onToggleLogs();
      }
    });
    rightSlot.querySelector('#nav-btn-logs')?.addEventListener('click', () => this.handlers.onToggleLogs());
    this.langBtn = rightSlot.querySelector('#nav-btn-lang');
    this.langBtn?.addEventListener('click', () => {
      this.toggleLocale();
    });
    this.themeModeBtn = rightSlot.querySelector('#nav-btn-theme-mode');
    this.themeModeBtn?.addEventListener('click', () => {
      this.handlers.onToggleThemeMode?.();
    });
    rightSlot.querySelector('#nav-btn-theme')?.addEventListener('click', () => this.handlers.onToggleTheme());
    rightSlot.querySelector('#nav-btn-settings')?.addEventListener('click', () => {
      if (this.handlers.onOpenSettingsModal) {
        this.handlers.onOpenSettingsModal('general');
      } else {
        this.handlers.onOpenAiEngineModal?.();
      }
    });

    onAppLocaleChange((nextLocale) => {
      this.currentLocale = nextLocale;
      this.syncLangButtonUI();
      this.refreshLocaleUI();
      this.syncActiveMenuChecks();
    });
  }

  private refreshLocaleUI(): void {
    const menus = this.buildMenus();
    if (this.navBarInstance && (this.navBarInstance as any).options) {
      (this.navBarInstance as any).options.menus = menus;
    }
    const triggers = this.container.querySelectorAll('.nav-menu-trigger');
    triggers.forEach((btn, idx) => {
      if (menus[idx]) {
        btn.textContent = menus[idx].name;
      }
    });

    const modelLabel = this.container.querySelector('#hud-model-label');
    if (modelLabel) {
      modelLabel.textContent = tApp('navbar.hudTargetModel');
    }

    const specBtn = this.container.querySelector<HTMLElement>('#nav-btn-spectral');
    if (specBtn) specBtn.title = `${tApp('navbar.viewSpectral')} (Ctrl+E)`;
    const bankBtn = this.container.querySelector<HTMLElement>('#nav-btn-bank');
    if (bankBtn) bankBtn.title = `${tApp('navbar.btnBankTitle')} (Ctrl+B)`;
    const batchBtn = this.container.querySelector<HTMLElement>('#nav-btn-batch');
    if (batchBtn) batchBtn.title = `${tApp('navbar.btnBatchTitle')} (Ctrl+Shift+B)`;
    const copilotBtn = this.container.querySelector<HTMLElement>('#nav-btn-copilot');
    if (copilotBtn) copilotBtn.title = `${this.currentLocale === 'es' ? 'Asistente Copiloto' : 'Copilot Assistant'} (F1)`;
    const logsBtn = this.container.querySelector<HTMLElement>('#nav-btn-logs');
    if (logsBtn) logsBtn.title = `${tApp('navbar.btnTelemetryTitle')} (Ctrl+L)`;
    const themeBtn = this.container.querySelector<HTMLElement>('#nav-btn-theme');
    if (themeBtn) themeBtn.title = tApp('navbar.btnThemeTitle');
    const settingsBtn = this.container.querySelector<HTMLElement>('#nav-btn-settings');
    if (settingsBtn) settingsBtn.title = `${tApp('navbar.btnSettingsTitle')} (Ctrl+,)`;

    if (this.lastSession) {
      this.updateSession(this.lastSession, this.lastCoverage, this.lastIsBridgeConnected);
    }
    if (this.lastHistory) {
      this.updateHistory(this.lastHistory);
    }
  }

  private getLangButtonTitle(): string {
    return this.currentLocale === 'es'
      ? 'Idioma: Español (clic para cambiar a English)'
      : 'Language: English (click to switch to Español)';
  }

  private syncLangButtonUI(): void {
    if (!this.langBtn) return;
    const title = this.getLangButtonTitle();
    this.langBtn.title = title;
    this.langBtn.setAttribute('aria-label', title);
    this.langBtn.innerHTML = `<span class="lang-flag-icon">${this.currentLocale === 'es' ? ICONS.flagEs : ICONS.flagEn}</span>`;
  }

  public setLocale(locale: AppLocale): void {
    if (locale !== 'es' && locale !== 'en') return;
    setAppLocale(locale);
    this.currentLocale = locale;
    this.syncLangButtonUI();
    this.refreshLocaleUI();
    this.syncActiveMenuChecks();
    this.handlers.onSetLocale?.(locale);
  }

  public toggleLocale(): void {
    const next: AppLocale = this.currentLocale === 'es' ? 'en' : 'es';
    this.setLocale(next);
    toast(tApp('settings.langChangedToast'), 'info');
    this.handlers.onToggleLocale?.();
  }

  public setSpectralVisible(visible: boolean): void {
    const btn = this.container.querySelector('#nav-btn-spectral');
    btn?.classList.toggle('is-active', visible);
  }

  public setTheme(theme: string): void {
    this.currentTheme = theme;
    this.syncActiveMenuChecks();
  }

  public setThemeState(state: { theme: string; family: string; mode: 'light' | 'dark' }): void {
    this.currentTheme = state.theme;
    this.currentThemeFamily = state.family;
    this.currentThemeMode = state.mode;
    if (this.themeModeBtn) {
      const isLight = state.mode === 'light';
      const es = this.currentLocale === 'es';
      this.themeModeBtn.title = isLight
        ? (es ? 'Cambiar a Modo Oscuro' : 'Switch to Dark Mode')
        : (es ? 'Cambiar a Modo Claro' : 'Switch to Light Mode');
      this.themeModeBtn.innerHTML = `<span class="theme-mode-icon">${isLight ? ICONS.moon : ICONS.sun}</span>`;
    }
    this.syncActiveMenuChecks();
  }

  public updateSession(session: Session, coverageErrors: string[], isBridgeConnected = false): void {
    this.lastSession = session;
    this.lastCoverage = coverageErrors;
    this.lastIsBridgeConnected = isBridgeConnected;
    this.currentTargetFormat = session.processConfig.targetFormat ?? 'dual';
    this.currentWorkingMode = session.processConfig.workingMode ?? 'classic';
    this.syncActiveMenuChecks();
    this.updateAiState(session.processConfig.aiConfig, isBridgeConnected);

    if (this.statusElement) {
      const slot = String(session.processConfig.modelNumber).padStart(3, '0');
      const dirtyMark = session.dirty ? ' *' : '';
      const isExt = (session.processConfig.workingMode ?? 'classic') === 'extended';
      const displayName = isExt ? (session.processConfig.expandedName || session.processConfig.modelName) : session.processConfig.modelName;
      const es = this.currentLocale === 'es';
      const charInfo = isExt
        ? `${displayName.length} ${es ? 'car. (Extendido)' : 'chars (Extended)'}`
        : `${displayName.length}/11 ${es ? 'car.' : 'chars'}`;
      this.statusElement.textContent = `#${slot} \u2022 ${displayName}${dirtyMark} \u2022 ${charInfo}`;
    }

    if (this.coverageElement) {
      const isOk = coverageErrors.length === 0;
      const hasAnySample = session.zones.some((z) => Boolean(z.sampleLow || z.sampleHigh));

      if (!hasAnySample && session.zones.length <= 1) {
        // Initial empty state: show neutral onboarding guidance instead of red alarm
        this.coverageElement.className = 'hud-pill hud-coverage-pill is-neutral';
        this.coverageElement.title = tApp('navbar.hudMidiTooltipOk');
        this.coverageElement.innerHTML = `
          <span class="hud-icon">${ICONS.piano}</span>
          <span class="hud-coverage-text">${tApp('navbar.hudMidiReady')}</span>
        `;
      } else {
        this.coverageElement.className = `hud-pill hud-coverage-pill ${isOk ? 'is-valid' : 'is-error'}`;
        this.coverageElement.title = isOk ? tApp('navbar.hudMidiTooltipOk') : tApp('navbar.hudMidiTooltipErr');
        this.coverageElement.innerHTML = `
          <span class="hud-icon">${isOk ? ICONS.check : ICONS.alert}</span>
          <span class="hud-coverage-text">${isOk ? tApp('navbar.hudMidiOk') : `${coverageErrors.length} ${tApp('navbar.hudMidiGaps')}`}</span>
        `;
      }
    }

    if (this.processBtn) {
      const hasSamples = session.zones.length > 0 && session.zones.every((z) => Boolean(z.sampleLow));
      const canProcess = coverageErrors.length === 0 && hasSamples;
      this.processBtn.disabled = !canProcess;
      this.processBtn.title = canProcess
        ? 'Process Model Now (Ctrl+P)'
        : `Cannot process: ${coverageErrors[0] ?? 'Assign audio sample(s) to keyboard zones'}`;
    }
  }

  public updateAiState(aiConfig?: AiAssistanceConfig, isBridgeConnected = false): void {
    if (!this.aiPillElement || !this.aiTextElement) return;
    const byok = cloudByokClient.getConfig();
    const isCloudReady = Boolean(byok.enabled && cloudByokClient.hasValidKey());
    const status = resolveAiSystemStatus({
      aiConfig,
      isBridgeConnected,
      isCloudReady,
      localProvider: webNeuralEngine.getDeviceStatus().activeProvider,
    });

    this.aiPillElement.className = `hud-pill hud-ai-pill ${status.pillClass}`;
    this.aiPillElement.dataset.aiMode = status.mode;
    this.aiTextElement.textContent = status.badgeText;
    this.aiPillElement.title = status.tooltip;
  }


  private syncActiveMenuChecks(): void {
    this.navBarInstance?.setActiveValues({
      setWorkingMode: this.currentWorkingMode,
      setTargetFormat: this.currentTargetFormat,
      selectTheme: this.currentTheme,
      selectThemeFamily: this.currentThemeFamily,
      setThemeMode: this.currentThemeMode,
      setLocale: this.currentLocale,
    });
  }

  public updateHistory(history: HistoryState): void {
    this.lastHistory = history;
    const es = this.currentLocale === 'es';
    if (this.undoBtn) {
      this.undoBtn.disabled = !history.canUndo;
      this.undoBtn.title = history.canUndo
        ? `${tApp('navbar.editUndo')}: ${history.undoLabel} (Ctrl+Z)`
        : es ? 'Nada que deshacer (Ctrl+Z)' : 'Nothing to Undo (Ctrl+Z)';
    }
    if (this.redoBtn) {
      this.redoBtn.disabled = !history.canRedo;
      this.redoBtn.title = history.canRedo
        ? `${tApp('navbar.editRedo')}: ${history.redoLabel} (Ctrl+Y)`
        : es ? 'Nada que rehacer (Ctrl+Y)' : 'Nothing to Redo (Ctrl+Y)';
    }
  }

  public setProcessing(isProcessing: boolean): void {
    if (this.processBtn) {
      this.processBtn.disabled = isProcessing;
      this.processBtn.classList.toggle('is-processing', isProcessing);
      this.processBtn.querySelector('.btn-text')!.textContent = isProcessing ? 'PROCESSING...' : 'PROCESS';
    }
  }

  public showDocModal(mode: 'manual' | 'specs'): void {
    if (!this.docModalEl) {
      this.docModalEl = document.createElement('div');
      this.docModalEl.className = 'nmm-modal-backdrop is-hidden';
      document.body.appendChild(this.docModalEl);
    }

    const isManual = mode === 'manual';
    const title = isManual
      ? 'HARTMANN NEURON MODELMAKER — USER GUIDE'
      : 'NASANALYSIS.DLL & DUAL-TARGET ENGINE SPECS';

    const bodyHtml = isManual
      ? `
        <div>
          <h4>1. Canonical Key Zone Table (MIDI 0 C-2 .. 127 G8)</h4>
          <p>Every Neuron model requires continuous coverage of all 128 MIDI keys (<code>0 C-2</code> through <code>127 G8</code>) with no gaps or overlaps. Each row in the canonical Zone Table defines 9 fields: <strong>Zone</strong>, <strong>Low Key</strong>, <strong>Root Key</strong>, <strong>High Key</strong>, <strong>Low Vel</strong>, <strong>High Vel</strong>, <strong>Detune</strong> (<code>-99..+99</code>), <strong>Volume</strong> (<code>-32dB..+12dB</code>), and <strong>Pan</strong> (<code>-50..+50</code>).</p>
          <h4>2. Importing Audio Samples &amp; Banks</h4>
          <ul>
            <li><strong>Universal Smart Import (Ctrl+I)</strong>: Single entry point for all import formats. Drop or browse <code>.wav</code>, <code>.aif</code>, <code>.sf2</code>, <code>.sfz</code>, <code>.dspreset</code>, <code>.nki</code>, <code>.vstpreset</code>, <code>.multisample</code>, <code>.rx2</code>/<code>.rex</code>, <code>.cue</code>, <code>.zip</code>. Auto-detects by binary header and routes to: SoundFont/SFZ importer, Decent Sampler/Kontakt/HALion parser, or Audio Chopper (REX/slice files). Interactive Preflight panel for incompatibilities and auto-adaptations.</li>
            <li><strong>Advanced Import submenu</strong>: Direct access to legacy paths: Import Audio Files, Import by Name (Hartmann <code>name_rrr_lll_v1.aif</code>), Import Folder, Import SoundFont/SFZ.</li>
            <li><strong>Export Active Zone as Legacy AIFF</strong>: Converts any loaded zone to <code>44.1 kHz / 16-bit / Mono Big-Endian FORM/AIFF</code> with <code>INST</code> chunk for legacy hardware tools.</li>
          </ul>
          <h4>3. Keyboard Shortcuts</h4>
          <p><code>Ctrl+O</code> Open Session &bull; <code>Ctrl+S</code> Save Session &bull; <code>Ctrl+I</code> Universal Smart Import &bull; <code>Ctrl+N</code> Import by Name &bull; <code>Ctrl+Z / Ctrl+Y</code> Undo / Redo &bull; <code>Insert</code> New Zone &bull; <code>Delete</code> Remove Zone &bull; <code>Ctrl+P</code> Process Model &bull; <code>Ctrl+T</code> Export Time Capsule (.zip) &bull; <code>Ctrl+Shift+X</code> Export by Destination &bull; <code>Space</code> Play/Stop Audition.</p>
        </div>
      `
      : `
        <div>
          <h4>1. Native Pipeline Reconstructed from NASAnalysis.dll (SHA-256 434e2ac9...)</h4>
          <ul>
            <li><strong>Complexity 1..10 &rarr; Recursion Depth</strong>: <code>[1, 4, 8, 12, 16, 24, 32, 42, 54, 64]</code> modes (<code>stick</code>), with <code>paso = max(4, nextpow2(stick))</code> and <code>nb &isin; {1, 25, 61}</code>.</li>
            <li><strong>6152-Byte Additive Partial Block (FUN_10007e00)</strong>: 2048-point Welch-windowed Phase Vocoder with 512-sample hop, storing 1024 partials sorted descending by amplitude (<code>uint16 freq[1024]</code> in <code>0.5 Hz</code> units, <code>uint16 amp[1024]</code>, <code>uint16 bin[1024]</code>).</li>
            <li><strong>20 Parameter Set Axis Tables (0..9)</strong>: Exact 12x8-byte ASCII morph axes in <code>mnAN</code> (104 B) and 6 float pairs in <code>fdAN</code> (56 B) for both <code>.scape</code> (<code>csAN</code>) and <code>.sphere</code> (<code>psAN</code>).</li>
          </ul>
          <h4>2. Dual-Target Architecture</h4>
          <ul>
            <li><strong>Legacy Hardware (<code>.model</code> / <code>.sound</code>)</strong>: Generates <code>&lt;NNN&gt;.model/</code> (<code>MName</code>, <code>map.script</code>, <code>%06d.scape</code>, <code>%06d.sphere</code>) and 445-parameter <code>&lt;NNN&gt;.sound/</code>.</li>
            <li><strong>Extended Spectral (<code>.nmmodel</code>)</strong>: Preserves unquantized <code>Float32</code> frequencies in Hz, multi-layer harmonic/interlaced clustering, and stereo metadata.</li>
          </ul>
        </div>
      `;

    this.docModalEl.innerHTML = `
      <div class="nmm-modal-window nmm-modal-m">
        <div class="nmm-modal-header">
          <div class="nmm-modal-header-title">
            <span class="modal-icon">${ICONS.cpu}</span>
            <span>${title}</span>
          </div>
          <button type="button" class="nmm-modal-close" id="btn-close-doc-modal" aria-label="Close">${ICONS.close}</button>
        </div>
        <div class="nmm-modal-body doc-modal-body">
          ${bodyHtml}
        </div>
        <div class="nmm-modal-footer">
          <div class="footer-right">
            <button type="button" class="btn btn-primary" id="btn-ok-doc-modal">Close</button>
          </div>
        </div>
      </div>
    `;

    this.docModalEl.classList.remove('is-hidden');
    const close = () => this.docModalEl?.classList.add('is-hidden');
    this.docModalEl.querySelector('#btn-close-doc-modal')?.addEventListener('click', close);
    this.docModalEl.querySelector('#btn-ok-doc-modal')?.addEventListener('click', close);
  }

  private dispatchMenuAction(action: string, value?: unknown): void {
    switch (action) {
      case 'newSession': this.handlers.onNewSession(); break;
      case 'openSession': this.handlers.onOpenSession(); break;
      case 'saveSession': this.handlers.onSaveSession(); break;
      case 'saveSessionAs': this.handlers.onSaveSessionAs?.(); break;
      case 'importSamples': this.handlers.onImportSamples(); break;
      case 'importSampler': this.handlers.onImportSampler?.(); break;
      case 'importFolder': this.handlers.onImportFolder(); break;
      case 'importByName': this.handlers.onImportByName(); break;
      case 'importModelFolder': this.handlers.onImportModelFolder(); break;
      case 'configureNeuronDbFolder': this.handlers.onConfigureNeuronDbFolder?.(); break;
      case 'importModel': this.handlers.onImportModel(); break;
      case 'saveToAxionikDb': this.handlers.onSaveToAxionikDb?.(); break;
      case 'saveToAxionikDbAs': this.handlers.onSaveToAxionikDbAs?.(); break;
      case 'exportModel': this.handlers.onExportModel(); break;
      case 'exportModelAs': this.handlers.onExportModelAs?.(); break;
      case 'exportZoneAiff': this.handlers.onExportZoneAiff(); break;
      case 'exportSampler': this.handlers.onExportSampler?.(); break;
      case 'openExportDestination': this.handlers.onOpenExportDestination?.(); break;
      case 'undo': this.handlers.onUndo(); break;
      case 'redo': this.handlers.onRedo(); break;
      case 'addZone': this.handlers.onAddZone(); break;
      case 'removeZone': this.handlers.onRemoveZone(); break;
      case 'clearZones': this.handlers.onClearZones(); break;
      case 'autoRepairCoverage': this.handlers.onAutoRepairCoverage(); break;
      case 'startProcess': this.handlers.onStartProcess(); break;
      case 'openBatchModal': this.handlers.onOpenBatchModal?.(); break;
      case 'openMusicianWizard': this.handlers.onOpenMusicianWizard?.(); break;
      case 'validateCoverage': this.handlers.onValidateCoverage(); break;
      case 'setTargetFormat':
        if (value === 'dual' || value === 'legacy-neuron' || value === 'modern-neural') {
          this.handlers.onSetTargetFormat(value);
        }
        break;
      case 'setWorkingMode':
        if (value === 'classic' || value === 'extended') {
          this.handlers.onSetWorkingMode?.(value);
        }
        break;
      case 'toggleZoneDrawer': this.handlers.onToggleZoneDrawer(); break;
      case 'toggleSpectral': this.handlers.onToggleSpectral(); break;
      case 'toggleBank': this.handlers.onToggleBank(); break;
      case 'toggleCopilot':
        if (this.handlers.onToggleCopilot) this.handlers.onToggleCopilot();
        else this.handlers.onToggleLogs();
        break;
      case 'toggleLogs': this.handlers.onToggleLogs(); break;
      case 'selectTheme':
        if (typeof value === 'string' && value.length > 0) {
          this.handlers.onSelectTheme(value);
        }
        break;
      case 'toggleTheme': this.handlers.onToggleTheme(); break;
      case 'selectThemeFamily':
        if (typeof value === 'string' && value.length > 0) {
          this.handlers.onSelectThemeFamily?.(value);
        }
        break;
      case 'setThemeMode':
        if (value === 'light' || value === 'dark') {
          this.handlers.onSetThemeMode?.(value);
        }
        break;
      case 'toggleThemeMode': this.handlers.onToggleThemeMode?.(); break;
      case 'setLocale':
        if (value === 'es' || value === 'en') {
          this.setLocale(value);
          toast(tApp('settings.langChangedToast'), 'info');
        }
        break;
      case 'toggleLocale':
        this.toggleLocale();
        break;
      case 'openSettingsModal':
        if (this.handlers.onOpenSettingsModal) {
          this.handlers.onOpenSettingsModal('general');
        } else {
          this.handlers.onOpenAiEngineModal?.();
        }
        break;
      case 'openAiEngineModal':
        if (this.handlers.onOpenSettingsModal) {
          this.handlers.onOpenSettingsModal('web');
        } else {
          this.handlers.onOpenAiEngineModal?.();
        }
        break;
      case 'openBridgeModal':
        if (this.handlers.onOpenSettingsModal) {
          this.handlers.onOpenSettingsModal('bridge');
        } else {
          this.handlers.onOpenBridgeModal?.();
        }
        break;
      case 'universalSmartImport': this.handlers.onUniversalSmartImport?.(); break;
      case 'openConfigHealth': this.handlers.onOpenConfigHealthModal?.(); break;
      case 'manual': this.showDocModal('manual'); break;
      case 'specs': this.showDocModal('specs'); break;
      case 'installPwa': this.handlers.onInstallPwa?.(); break;
      case 'openModelConfig': this.handlers.onOpenModelConfig?.(); break;
      case 'openAiCoverGenerator': this.handlers.onOpenAiCoverGenerator?.(); break;
      case 'openAudioChopper': this.handlers.onOpenAudioChopper?.(); break;
      case 'openAudioRecorder': this.handlers.onOpenAudioRecorder?.(); break;
      case 'openLoopEditor': this.handlers.onOpenLoopEditor?.(); break;
      case 'autoLoopAllZones': this.handlers.onAutoLoopAllZones?.(); break;
      // Note: 'about' and 'checkForUpdates' are handled natively by SynthNavBar's aboutDialog instance
    }
  }

  public updateConfigHealthBadge(hasMissingMandatory: boolean, hasMissingOptional: boolean): void {
    const dot = this.container.querySelector<HTMLElement>('#nav-settings-dot');
    const btn = this.container.querySelector<HTMLElement>('#nav-btn-settings');
    if (!dot) return;

    if (hasMissingMandatory) {
      dot.className = 'nav-health-dot dot-err';
      dot.title = 'Configuration Alert: Mandatory settings required';
      btn?.setAttribute('title', 'Configuration Alert: Mandatory settings required. Click to check.');
    } else if (hasMissingOptional) {
      dot.className = 'nav-health-dot dot-warn';
      dot.title = 'Configuration Recommendation: Optional AI accelerators available';
      btn?.setAttribute('title', 'General Settings & AI Configuration (Optional features pending). Click to check.');
    } else {
      dot.className = 'nav-health-dot is-hidden';
      btn?.setAttribute('title', 'General Settings & AI Configuration (Ctrl+,)');
    }
  }
}
