// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Navbar Module
// Integrates with ABDShared's SynthNavBar (`onAction`, `activeValues`, `aboutDialog`)
// ─────────────────────────────────────────────────────────

import { createSynthNavBar } from '@abdsynths/shared/components';
import { ICONS } from './icons';
import { cloudByokClient } from '../core/ai/CloudByokClient';
import type { Session, HistoryState, TargetFormat, WorkingMode, AiAssistanceConfig } from '../core/types';

export interface NavbarHandlers {
  onNewSession: () => void;
  onOpenSession: () => void;
  onSaveSession: () => void;
  onSaveSessionAs?: () => void;
  onImportSamples: () => void;
  onImportSampler?: () => void;
  onImportFolder: () => void;
  onImportByName: () => void;
  onImportModelFolder: () => void;
  onImportModel: () => void;
  onConfigureNeuronDbFolder?: () => void;
  onExportModel: () => void;
  onExportModelAs?: () => void;
  onExportZoneAiff: () => void;
  onInstallPwa?: () => void;
  onOpenAiEngineModal?: () => void;
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
  onToggleLogs: () => void;
  /** Coverage-pill click: always surfaces the audit (never toggles it closed). Optional for backward compat. */
  onOpenAudit?: () => void;
  onSelectTheme: (theme: string) => void;
  onToggleTheme: () => void;
  onSelectThemeFamily?: (family: string) => void;
  onSetThemeMode?: (mode: 'light' | 'dark') => void;
  onToggleThemeMode?: () => void;
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
  private currentTheme = 'neuron-light';
  private currentThemeFamily = 'neuron';
  private currentThemeMode: 'light' | 'dark' = 'light';
  private currentTargetFormat: TargetFormat = 'dual';
  private currentWorkingMode: WorkingMode = 'classic';

  constructor(container: HTMLElement, handlers: NavbarHandlers) {
    this.container = container;
    this.handlers = handlers;
  }

  public mount(
    initialSession: Session,
    initialCoverage: string[],
    initialTheme = 'neuron-light'
  ): void {
    this.currentTheme = initialTheme;
    this.currentTargetFormat = initialSession.processConfig.targetFormat ?? 'dual';

    const brand = {
      title: '',
      subtitle: '',
      logoHtml: `<span class="neuron-logo-mark" title="MODELmaker">${ICONS.cpu}</span>`,
    };

    const menus = [
      {
        name: 'File',
        items: [
          { id: 101, label: 'New Session (Reset)', action: 'newSession' },
          { id: 102, label: 'Open Session (.nmsession.json)...', action: 'openSession', shortcut: 'Ctrl+O' },
          {
            id: 103,
            label: 'Save...',
            submenu: [
              { id: 1031, label: 'Save Session', action: 'saveSession', shortcut: 'Ctrl+S' },
              { id: 1032, label: 'Save Session As...', action: 'saveSessionAs', shortcut: 'Ctrl+Shift+S' },
              { separator: true },
              { id: 1033, label: 'Save Model Pack (.zip)...', action: 'exportModel', shortcut: 'Ctrl+T' },
              { id: 1034, label: 'Save Model Pack As (.zip)...', action: 'exportModelAs', shortcut: 'Ctrl+Shift+T' },
            ],
          },
          { separator: true },
          { id: 104, label: 'Import Audio Files (.wav / .aif)...', action: 'importSamples', shortcut: 'Ctrl+I' },
          { id: 1045, label: 'Import Audio by Name (Hartmann)...', action: 'importByName', shortcut: 'Ctrl+N' },
          { id: 105, label: 'Import Audio Folder...', action: 'importFolder' },
          { id: 1055, label: 'Import SoundFont / SFZ (.sf2, .sfz)...', action: 'importSampler' },
          { separator: true },
          { id: 106, label: 'Import Model Folder (<NNN>.model)...', action: 'importModelFolder' },
          { id: 1065, label: 'Configure NeuronDB Library Folder...', action: 'configureNeuronDbFolder' },
          { id: 107, label: 'Import Model Files / .zip...', action: 'importModel' },
          { separator: true },
          { id: 109, label: 'Export Active Zone as Legacy AIFF (44.1k/16b)...', action: 'exportZoneAiff' },
        ],
      },
      {
        name: 'Edit',
        items: [
          { id: 201, label: 'Undo', action: 'undo', shortcut: 'Ctrl+Z' },
          { id: 202, label: 'Redo', action: 'redo', shortcut: 'Ctrl+Y' },
          { separator: true },
          { id: 203, label: 'New Zone (Split at Root Key)', action: 'addZone', shortcut: 'Insert' },
          { id: 204, label: 'Remove Selected Zone', action: 'removeZone', shortcut: 'Delete' },
          { separator: true },
          { id: 205, label: 'Auto-Repair MIDI Coverage (0..127)', action: 'autoRepairCoverage' },
          { id: 206, label: 'Reset to Single Zone (0..127)', action: 'clearZones' },
        ],
      },
      {
        name: 'Model',
        items: [
          { id: 301, label: 'Process Model Now...', action: 'startProcess', shortcut: 'Ctrl+P' },
          { id: 302, label: 'Validate MIDI Coverage (0..127)', action: 'validateCoverage' },
          { separator: true },
          {
            id: 303,
            label: 'Working Mode',
            submenu: [
              { id: 304, label: 'Classic Mode (MODELmaker v1.2)', action: 'setWorkingMode', value: 'classic' },
              { id: 305, label: 'Extended Mode (N-Layer / 2D Regions)', action: 'setWorkingMode', value: 'extended' },
            ],
          },
          {
            id: 306,
            label: 'Export / Save Mode',
            submenu: [
              { id: 307, label: 'Dual (.model + .nmmodel)', action: 'setTargetFormat', value: 'dual' },
              { id: 308, label: 'Classic (.model / .sound)', action: 'setTargetFormat', value: 'legacy-neuron' },
              { id: 309, label: 'Extended (.nmmodel)', action: 'setTargetFormat', value: 'modern-neural' },
            ],
          },
          { separator: true },
          { id: 310, label: 'AI Assistance & DSP Processing Engine...', action: 'openAiEngineModal' },
        ],
      },
      {
        name: 'View',
        items: [
          { id: 401, label: 'Zone Metadata Editor Drawer', action: 'toggleZoneDrawer', shortcut: 'Ctrl+M' },
          { id: 402, label: 'Spectral & A/B Resynthesis Inspector', action: 'toggleSpectral', shortcut: 'Ctrl+E' },
          { separator: true },
          { id: 403, label: 'NeuronDB Bank Browser', action: 'toggleBank', shortcut: 'Ctrl+B' },
          { id: 404, label: 'Telemetry & Coverage Audit', action: 'toggleLogs', shortcut: 'Ctrl+L' },
          { separator: true },
          {
            id: 405,
            label: 'Hardware Skin',
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
            label: 'Appearance Mode',
            submenu: [
              { id: 413, label: 'Light Mode', action: 'setThemeMode', value: 'light' },
              { id: 414, label: 'Dark Mode', action: 'setThemeMode', value: 'dark' },
              { separator: true },
              { id: 415, label: 'Toggle Light / Dark', action: 'toggleThemeMode' },
            ],
          },
        ],
      },
      {
        name: 'Help',
        items: [
          { id: 901, label: 'Hartmann MODELmaker User Guide...', action: 'manual', shortcut: 'F1' },
          { id: 902, label: 'NASAnalysis.dll & Dual-Target Specs...', action: 'specs' },
          { separator: true },
          { id: 903, label: 'Install Desktop App (PWA)...', action: 'installPwa' },
          { id: 905, label: 'Local Companion Bridge & GPU Status...', action: 'openBridgeModal' },
          { id: 904, label: 'About NEURON MODELmaker...', action: 'about' },
        ],
      },
    ];

    // Center HUD Slot
    const centerSlot = document.createElement('div');
    centerSlot.className = 'nav-hud-center';
    centerSlot.innerHTML = `
      <div class="hud-pill hud-model-pill" title="Active target model slot and hardware name">
        <span class="hud-label">TARGET MODEL:</span>
        <span class="hud-value hud-model-name" id="hud-model-name">#000 ${initialSession.processConfig.modelName}</span>
      </div>
      <div class="hud-pill hud-coverage-pill" id="hud-coverage-pill" title="Click to inspect or repair MIDI 0..127 coverage">
        <span class="hud-icon">${initialCoverage.length === 0 ? ICONS.check : ICONS.alert}</span>
        <span class="hud-coverage-text">${initialCoverage.length === 0 ? '128/128 MIDI KEYS OK' : `${initialCoverage.length} GAPS DETECTED`}</span>
      </div>
      <div class="hud-pill hud-ai-pill is-ai-off" id="hud-ai-pill" title="Asistencia por IA vs. Motor Algorítmico DSP. Haz clic para abrir el configurador de IA.">
        <span class="hud-ai-icon">${ICONS.ai}</span>
        <span class="hud-ai-text" id="hud-ai-text">MODO IA: OFF (DSP)</span>
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
      <button type="button" class="btn btn-hud-icon" id="nav-btn-bank" title="NeuronDB Bank Browser (Ctrl+B)">
        ${ICONS.database}
      </button>
      <button type="button" class="btn btn-hud-icon" id="nav-btn-logs" title="Validation Log Drawer (Ctrl+L)">
        ${ICONS.terminal}
      </button>
      <button type="button" class="btn btn-hud-icon btn-theme-mode-toggle" id="nav-btn-theme-mode" title="${this.currentThemeMode === 'light' ? 'Cambiar a Modo Oscuro' : 'Cambiar a Modo Claro'}">
        <span class="theme-mode-icon">${this.currentThemeMode === 'light' ? ICONS.moon : ICONS.sun}</span>
      </button>
      <button type="button" class="btn btn-hud-icon btn-theme-toggle" id="nav-btn-theme" title="Siguiente sintetizador / skin">
        <span class="theme-icon">${ICONS.palette}</span>
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
      },
      aboutDialog: {
        appName: 'NEURON MODELmaker',
        subtitle: 'Hartmann Spectral Reconstructor & Dual-Target Model Generator',
        version: '1.2.0',
        buildInfo: 'NASAnalysis.dll 1:1 WebAudio DSP + Dual-Target (.model/.sound + .nmmodel)',
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
      this.handlers.onOpenAiEngineModal?.();
    });

    this.aiPillElement?.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.handlers.onOpenAiEngineModal?.();
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
    rightSlot.querySelector('#nav-btn-logs')?.addEventListener('click', () => this.handlers.onToggleLogs());
    this.themeModeBtn = rightSlot.querySelector('#nav-btn-theme-mode');
    this.themeModeBtn?.addEventListener('click', () => {
      this.handlers.onToggleThemeMode?.();
    });
    rightSlot.querySelector('#nav-btn-theme')?.addEventListener('click', () => this.handlers.onToggleTheme());
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
      this.themeModeBtn.title = isLight ? 'Cambiar a Modo Oscuro' : 'Cambiar a Modo Claro';
      this.themeModeBtn.innerHTML = `<span class="theme-mode-icon">${isLight ? ICONS.moon : ICONS.sun}</span>`;
    }
    this.syncActiveMenuChecks();
  }

  public updateSession(session: Session, coverageErrors: string[], isBridgeConnected = false): void {
    this.currentTargetFormat = session.processConfig.targetFormat ?? 'dual';
    this.currentWorkingMode = session.processConfig.workingMode ?? 'classic';
    this.syncActiveMenuChecks();
    this.updateAiState(session.processConfig.aiConfig, isBridgeConnected);

    if (this.statusElement) {
      const slot = String(session.processConfig.modelNumber).padStart(3, '0');
      const dirtyMark = session.dirty ? ' *' : '';
      this.statusElement.textContent = `#${slot} ${session.processConfig.modelName}${dirtyMark}`;
    }

    if (this.coverageElement) {
      const isOk = coverageErrors.length === 0;
      this.coverageElement.className = `hud-pill hud-coverage-pill ${isOk ? 'is-valid' : 'is-error'}`;
      this.coverageElement.innerHTML = `
        <span class="hud-icon">${isOk ? ICONS.check : ICONS.alert}</span>
        <span class="hud-coverage-text">${isOk ? '128/128 MIDI KEYS OK' : `${coverageErrors.length} GAPS DETECTED`}</span>
      `;
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
    const enabled = aiConfig?.enabled ?? false;
    if (!enabled) {
      this.aiPillElement.className = 'hud-pill hud-ai-pill is-ai-off';
      this.aiTextElement.textContent = 'MODO IA: OFF (DSP)';
      this.aiPillElement.title = 'Modo 100% Algorítmico (DSP Puro). Haz clic para abrir el configurador y activar Asistencia por IA.';
      return;
    }

    let count = 0;
    if (aiConfig?.masterWave === 'ai') count++;
    if (aiConfig?.separation === 'ai') count++;
    if (aiConfig?.loopExpansion === 'ai') count++;
    if (aiConfig?.classifier === 'ai') count++;
    if (aiConfig?.denoise === 'ai') count++;

    const isAllAi = count === 5;
    const byok = cloudByokClient.getConfig();
    const isCloudByok = byok.enabled && cloudByokClient.hasValidKey();
    const providerLabel = isBridgeConnected
      ? 'GPU LOCAL'
      : isCloudByok
        ? 'CLOUD BYOK'
        : 'WEBGPU';

    this.aiPillElement.className = `hud-pill hud-ai-pill ${isAllAi ? 'is-ai-active' : 'is-ai-hybrid'}`;
    this.aiTextElement.textContent = isAllAi
      ? `MODO IA: ${providerLabel} (5/5)`
      : `MODO IA: ${providerLabel} (${count}/5)`;
    this.aiPillElement.title = `Asistencia IA: ${count}/5 etapas activas [${providerLabel}]. Haz clic para abrir la matriz modular.`;
  }


  private syncActiveMenuChecks(): void {
    this.navBarInstance?.setActiveValues({
      setWorkingMode: this.currentWorkingMode,
      setTargetFormat: this.currentTargetFormat,
      selectTheme: this.currentTheme,
      selectThemeFamily: this.currentThemeFamily,
      setThemeMode: this.currentThemeMode,
    });
  }

  public updateHistory(history: HistoryState): void {
    if (this.undoBtn) {
      this.undoBtn.disabled = !history.canUndo;
      this.undoBtn.title = history.canUndo
        ? `Undo: ${history.undoLabel} (Ctrl+Z)`
        : 'Nothing to Undo (Ctrl+Z)';
    }
    if (this.redoBtn) {
      this.redoBtn.disabled = !history.canRedo;
      this.redoBtn.title = history.canRedo
        ? `Redo: ${history.redoLabel} (Ctrl+Y)`
        : 'Nothing to Redo (Ctrl+Y)';
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
      this.docModalEl.className = 'modal-backdrop is-hidden';
      document.body.appendChild(this.docModalEl);
    }

    const isManual = mode === 'manual';
    const title = isManual
      ? 'HARTMANN NEURON MODELMAKER — USER GUIDE'
      : 'NASANALYSIS.DLL & DUAL-TARGET ENGINE SPECS';

    const bodyHtml = isManual
      ? `
        <div class="doc-modal-content">
          <h4>1. Canonical Key Zone Table (MIDI 0 C-2 .. 127 G8)</h4>
          <p>Every Neuron model requires continuous coverage of all 128 MIDI keys (<code>0 C-2</code> through <code>127 G8</code>) with no gaps or overlaps. Each row in the canonical Zone Table defines 9 fields: <strong>Zone</strong>, <strong>Low Key</strong>, <strong>Root Key</strong>, <strong>High Key</strong>, <strong>Low Vel</strong>, <strong>High Vel</strong>, <strong>Detune</strong> (<code>-99..+99</code>), <strong>Volume</strong> (<code>-32dB..+12dB</code>), and <strong>Pan</strong> (<code>-50..+50</code>).</p>
          <h4>2. Importing Audio Samples & Folders</h4>
          <ul>
            <li><strong>Import Samples (Ctrl+I) / Import Folder</strong>: Reads embedded AIFF <code>INST</code> or WAV <code>smpl</code> pitch/key/velocity metadata (<code>lowVelocity &lt; 64</code> → Low Vel, <code>&ge; 64</code> → High Vel), with automatic pitch detection fallback.</li>
            <li><strong>Import by Name (Ctrl+N)</strong>: Parses the Hartmann naming convention <code>name_rrr_lll_v1.aif</code> / <code>_v2.aif</code> (where <code>rrr</code> is Root Key <code>000..127</code> and <code>lll</code> is Low Key <code>000..127</code>).</li>
            <li><strong>Export Active Zone as Legacy AIFF</strong>: Converts any loaded WAV/AIFF zone to a canonical <code>44.1 kHz, 16-bit, Mono Big-Endian FORM/AIFF</code> with <code>INST</code> chunk for legacy hardware tools.</li>
          </ul>
          <h4>3. Keyboard Shortcuts</h4>
          <p><code>Ctrl+O</code> Open Session &bull; <code>Ctrl+S</code> Save Session &bull; <code>Ctrl+I</code> Import Samples &bull; <code>Ctrl+N</code> Import by Name &bull; <code>Ctrl+Z / Ctrl+Y</code> Undo / Redo &bull; <code>Insert</code> New Zone &bull; <code>Delete</code> Remove Zone &bull; <code>Ctrl+P</code> Process Model &bull; <code>Ctrl+T</code> Export ZIP &bull; <code>Space</code> Play/Stop Audition.</p>
        </div>
      `
      : `
        <div class="doc-modal-content">
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
      <div class="process-modal-card doc-modal-card">
        <div class="modal-header">
          <div class="modal-title">
            <span class="modal-icon">${ICONS.cpu}</span>
            <span>${title}</span>
          </div>
          <button type="button" class="btn btn-close-modal" id="btn-close-doc-modal">${ICONS.close}</button>
        </div>
        <div class="modal-body doc-modal-body">
          ${bodyHtml}
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-primary" id="btn-ok-doc-modal">Close</button>
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
      case 'exportModel': this.handlers.onExportModel(); break;
      case 'exportModelAs': this.handlers.onExportModelAs?.(); break;
      case 'exportZoneAiff': this.handlers.onExportZoneAiff(); break;
      case 'undo': this.handlers.onUndo(); break;
      case 'redo': this.handlers.onRedo(); break;
      case 'addZone': this.handlers.onAddZone(); break;
      case 'removeZone': this.handlers.onRemoveZone(); break;
      case 'clearZones': this.handlers.onClearZones(); break;
      case 'autoRepairCoverage': this.handlers.onAutoRepairCoverage(); break;
      case 'startProcess': this.handlers.onStartProcess(); break;
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
      case 'openAiEngineModal': this.handlers.onOpenAiEngineModal?.(); break;
      case 'openBridgeModal': this.handlers.onOpenBridgeModal?.(); break;
      case 'manual': this.showDocModal('manual'); break;
      case 'specs': this.showDocModal('specs'); break;
      case 'installPwa': this.handlers.onInstallPwa?.(); break;
      // Note: 'about' and 'checkForUpdates' are handled natively by SynthNavBar's aboutDialog instance
    }
  }
}
