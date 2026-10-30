// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Unified Settings & AI Processing Modal
// Centralizes:
//   1. General & Appearance: Hardware Synthesizer Skins, Light/Dark Mode,
//      Classic vs Extended Creation Mode, and Local Library Folders.
//   2. Web Engine (WebGPU + WASM SIMD): 100% Free, zero backend in-browser DSP.
//   3. Cloud AI (BYOK): Private user-billed cloud APIs (Replicate, HF, Gemini).
//   4. Companion Bridge: Local Python + RTX 3070 GPU VRAM, transparent model
//      manager (download, uninstall, custom mirror URLs) and disk scanner.
// ─────────────────────────────────────────────────────────

import type {
  AiAssistanceConfig,
  ClassifierMethod,
  DenoiseMethod,
  LoopExpansionMethod,
  MasterWaveMethod,
  SeparationMethod,
  WorkingMode,
} from '../core/types';
import {
  bridgeClient,
  type AxionikDbModelEntry,
  type BridgeModelInfo,
  type BridgeScanResult,
} from '../core/bridge/BridgeClient';
import { webNeuralEngine, type WebGpuDeviceStatus } from '../core/ai/WebNeuralEngine';
import { cloudByokClient, type CloudAiProvider } from '../core/ai/CloudByokClient';
import { ICONS } from './icons';
import { toast } from './notify';
import { escHtml, escAttr } from './escape';
import { createModalFocusTrap, type FocusTrap } from './modalFocusTrap';

export interface SettingsModalHandlers {
  onUpdateAiConfig: (config: AiAssistanceConfig) => void;
  onSelectThemeFamily: (family: string) => void;
  onSetThemeMode: (mode: 'light' | 'dark') => void;
  onSetWorkingMode: (mode: WorkingMode) => void;
  getCurrentThemeFamily?: () => string;
  getCurrentThemeMode?: () => 'light' | 'dark';
  getCurrentWorkingMode?: () => WorkingMode;
}

export type SettingsModalTab = 'general' | 'ai' | 'web' | 'cloud' | 'bridge';
export type SettingsMainTab = 'general' | 'ai';
export type AiSubTab = 'web' | 'cloud' | 'bridge';

const STORAGE_KEY_BANK_PATH = 'neumodmakr_bank_path';
const DEFAULT_BANK_PATH = 'd:\\desarrollos\\ABDSynths\\_RESOURCES\\Soundfonts';

const STORAGE_KEY_AXIONIK_DB_PATH = 'abd_axionikdb_path';
const DEFAULT_AXIONIK_DB_PATH = 'd:\\desarrollos\\ABDSynths\\AxionikDB';

const STORAGE_KEY_NEURON_DB_PATH = 'abd_neurondb_path';
const DEFAULT_NEURON_DB_PATH = 'd:\\desarrollos\\ABDSynths\\NeuronDB';

export class SettingsModal {
  private backdropEl: HTMLElement | null = null;
  private focusTrap: FocusTrap | null = null;
  private storageEstimate: { usage: number; quota: number; percent: number } | null = null;
  private currentConfig: AiAssistanceConfig = {
    enabled: false,
    masterWave: 'dsp',
    separation: 'dsp',
    loopExpansion: 'dsp',
    classifier: 'dsp',
    denoise: 'dsp',
  };
  private activeMainTab: SettingsMainTab = 'general';
  private activeAiSubTab: AiSubTab = 'web';
  private handlers: SettingsModalHandlers;
  private unsubscribeBridge: (() => void) | null = null;
  private webGpuStatus: WebGpuDeviceStatus | null = null;
  private isTestingByok = false;
  private byokTestResult: { success: boolean; message: string } | null = null;
  private bridgeModels: BridgeModelInfo[] = [];
  private activePollingModelIds = new Set<string>();
  private downloadPollTimer: ReturnType<typeof setInterval> | null = null;
  private showPassword = false;
  private editingUrlModelId: string | null = null;
  private scanResults: BridgeScanResult | null = null;
  private isScanning = false;
  private isScanningAxionik = false;
  private axionikScanResults: AxionikDbModelEntry[] | null = null;
  private isScanningNeuronDb = false;
  private neuronDbScanResults: BridgeScanResult | null = null;

  public get currentTab(): SettingsModalTab {
    return this.activeMainTab === 'general' ? 'general' : this.activeAiSubTab;
  }

  constructor(handlers: SettingsModalHandlers) {
    this.handlers = handlers;
  }

  public async open(
    tab: SettingsModalTab = 'general',
    config?: AiAssistanceConfig
  ): Promise<void> {
    if (config) {
      this.currentConfig = { ...config };
    }
    if (tab === 'general') {
      this.activeMainTab = 'general';
    } else if (tab === 'ai') {
      this.activeMainTab = 'ai';
    } else if (tab === 'web' || tab === 'cloud' || tab === 'bridge') {
      this.activeMainTab = 'ai';
      this.activeAiSubTab = tab;
    }
    this.webGpuStatus = webNeuralEngine.getDeviceStatus();

    if (!this.backdropEl) {
      this.backdropEl = document.createElement('div');
      this.backdropEl.className = 'modal-backdrop is-hidden';
      document.body.appendChild(this.backdropEl);
    }

    // Query storage quota asynchronously
    if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.estimate === 'function') {
      try {
        const est = await navigator.storage.estimate();
        const usage = est.usage ?? 0;
        const quota = est.quota ?? 1;
        this.storageEstimate = {
          usage,
          quota,
          percent: Math.min(100, Math.round((usage / quota) * 100)),
        };
      } catch {
        this.storageEstimate = null;
      }
    }

    this.render();
    this.backdropEl.classList.remove('is-hidden');

    if (!this.focusTrap && this.backdropEl) {
      this.focusTrap = createModalFocusTrap(this.backdropEl, {
        onEscape: () => this.close(),
        initialFocusSelector: '#btn-close-settings-modal',
      });
    }
    this.focusTrap?.activate();

    // Async init WebGPU status
    void webNeuralEngine.init().then((st) => {
      this.webGpuStatus = st;
      this.updateHardwareBadge();
    });

    // Bridge status subscription
    this.unsubscribeBridge = bridgeClient.subscribe(() => {
      this.updateBridgeBadge();
      void this.refreshBridgeModels();
    });
    void bridgeClient.checkHealth();
    void this.refreshBridgeModels();
  }

  public close(): void {
    if (this.focusTrap) {
      this.focusTrap.deactivate();
    }
    if (this.unsubscribeBridge) {
      this.unsubscribeBridge();
      this.unsubscribeBridge = null;
    }
    if (this.downloadPollTimer) {
      clearInterval(this.downloadPollTimer);
      this.downloadPollTimer = null;
    }
    this.backdropEl?.classList.add('is-hidden');
  }

  private countActiveAiStages(): number {
    if (!this.currentConfig.enabled) return 0;
    let count = 0;
    if (this.currentConfig.masterWave === 'ai') count++;
    if (this.currentConfig.separation === 'ai') count++;
    if (this.currentConfig.loopExpansion === 'ai') count++;
    if (this.currentConfig.classifier === 'ai') count++;
    if (this.currentConfig.denoise === 'ai') count++;
    return count;
  }

  private async refreshBridgeModels(): Promise<void> {
    if (!bridgeClient.isConnected()) {
      this.bridgeModels = [];
      return;
    }
    try {
      this.bridgeModels = await bridgeClient.getModels();
      for (const m of this.bridgeModels) {
        if (m.status === 'downloading') {
          this.startModelProgressPolling(m.id);
        }
      }
      this.renderBridgeModelsList();
    } catch {
      // offline
    }
  }

  private render(): void {
    if (!this.backdropEl) return;
    const cfg = this.currentConfig;
    const activeAiCount = this.countActiveAiStages();

    this.backdropEl.innerHTML = `
      <div class="process-modal-card ai-engine-modal-card settings-modal-card" role="dialog" aria-modal="true" aria-label="General Settings and AI Engine Configuration">
        <!-- Header -->
        <div class="modal-header ai-modal-header">
          <div class="modal-title">
            <span class="modal-icon">${ICONS.settings}</span>
            <span>SETTINGS &amp; AI ENGINE</span>
            <span class="panel-badge ${cfg.enabled ? 'badge-ai-on' : 'badge-muted'}" id="ai-active-badge">
              ${cfg.enabled ? `AI: ${activeAiCount}/5 STAGES` : 'PURE DSP (AI OFF)'}
            </span>
          </div>
          <button type="button" class="btn btn-close-modal" id="btn-close-settings-modal" title="Close (Esc)">
            ${ICONS.close}
          </button>
        </div>

        <!-- Primary Navigation Tabs (General | IA) -->
        <div class="ai-tabs-nav modal-primary-tabs">
          <button type="button" class="primary-tab-btn ${this.activeMainTab === 'general' ? 'is-active' : ''}" data-main-tab="general">
            <span class="primary-tab-icon">${ICONS.sliders}</span>
            <div class="primary-tab-text">
              <span class="primary-tab-title">General</span>
              <span class="primary-tab-tag">Themes, Mode &amp; Paths</span>
            </div>
          </button>
          <button type="button" class="primary-tab-btn ${this.activeMainTab === 'ai' ? 'is-active' : ''}" data-main-tab="ai">
            <span class="primary-tab-icon">${ICONS.cpu}</span>
            <div class="primary-tab-text">
              <span class="primary-tab-title">IA</span>
              <span class="primary-tab-tag">Web Engine, Cloud BYOK &amp; Local GPU</span>
            </div>
          </button>
        </div>

        <!-- AI Engine Sub-tabs (Visible only when in IA tab) -->
        ${
          this.activeMainTab === 'ai'
            ? `
          <div class="ai-subtabs-nav">
            <button type="button" class="ai-subtab-btn ${this.activeAiSubTab === 'web' ? 'is-active' : ''}" data-ai-subtab="web">
              <span class="subtab-icon">${ICONS.cpu}</span>
              <span class="subtab-title">Built-in Web Engine</span>
              <span class="subtab-tag">In-Browser (100% Free)</span>
            </button>
            <button type="button" class="ai-subtab-btn ${this.activeAiSubTab === 'bridge' ? 'is-active' : ''}" data-ai-subtab="bridge">
              <span class="subtab-icon">${ICONS.database}</span>
              <span class="subtab-title">Companion Bridge</span>
              <span class="subtab-tag">Local GPU (VRAM)</span>
            </button>
            <button type="button" class="ai-subtab-btn ${this.activeAiSubTab === 'cloud' ? 'is-active' : ''}" data-ai-subtab="cloud">
              <span class="subtab-icon">${ICONS.cloud}</span>
              <span class="subtab-title">Cloud AI (BYOK)</span>
              <span class="subtab-tag">Private User Keys</span>
            </button>
          </div>
        `
            : ''
        }

        <!-- Master Switch & Presets Bar (Shown in Web Tab under IA) -->
        ${this.activeMainTab === 'ai' && this.activeAiSubTab === 'web' ? this.renderMasterWebBar(cfg) : ''}

        <!-- Tab Body -->
        <div class="modal-body ai-modal-body">
          ${this.activeMainTab === 'general' ? this.renderGeneralTab() : ''}
          ${this.activeMainTab === 'ai' && this.activeAiSubTab === 'web' ? this.renderWebTab(cfg) : ''}
          ${this.activeMainTab === 'ai' && this.activeAiSubTab === 'cloud' ? this.renderCloudTab() : ''}
          ${this.activeMainTab === 'ai' && this.activeAiSubTab === 'bridge' ? this.renderBridgeTab() : ''}
        </div>

        <!-- Footer -->
        <div class="modal-footer ai-modal-footer">
          <div class="ai-footer-info">
            <span class="text-muted" id="ai-footer-device-status">
              ${this.webGpuStatus?.statusMessage || 'Processing engine ready and online.'}
            </span>
          </div>
          <div class="ai-footer-actions">
            <button type="button" class="btn btn-secondary" id="btn-cancel-settings-modal">Close</button>
            <button type="button" class="btn btn-primary" id="btn-apply-settings-modal">Apply Settings</button>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private renderGeneralTab(): string {
    const curFamily = this.handlers.getCurrentThemeFamily?.() ?? 'neuron';
    const curMode = this.handlers.getCurrentThemeMode?.() ?? 'light';
    const curWorkingMode = this.handlers.getCurrentWorkingMode?.() ?? 'classic';
    const savedAxionikDbPath = localStorage.getItem(STORAGE_KEY_AXIONIK_DB_PATH) || DEFAULT_AXIONIK_DB_PATH;
    const savedNeuronDbPath = localStorage.getItem(STORAGE_KEY_NEURON_DB_PATH) || DEFAULT_NEURON_DB_PATH;
    const savedBankPath = localStorage.getItem(STORAGE_KEY_BANK_PATH) || DEFAULT_BANK_PATH;
    const isBridgeOnline = bridgeClient.isConnected();

    const skinFamilies = [
      { id: 'neuron', name: 'Hartmann Neuron', desc: 'Original hardware (2002), gray knobs and blue OLED display' },
      { id: 'virus-snow', name: 'Access Virus Snow', desc: 'Pristine white desktop module aesthetics (2008)' },
      { id: 'audiolab', name: 'AudioLab Precision', desc: 'Clinical high-contrast audio inspection lab' },
      { id: 'ms2000', name: 'Korg MS2000', desc: 'Retro teal analog-modeling physical synthesizer panel' },
      { id: 'advanced', name: 'Hartmann Advanced', desc: 'Expanded special edition with warm amber accents' },
      { id: 'cz101', name: 'Casio CZ-101', desc: 'Classic phase-distortion synthesizer panel (1984)' },
    ];

    return `
      <div class="settings-general-container">
        <!-- 1. Appearance & Hardware Skin -->
        <div class="settings-section-card">
          <div class="settings-card-header">
            <h4>${ICONS.palette} Hardware Synthesizer Skin &amp; Theme</h4>
            <span class="text-muted">Personalize the application aesthetic inspired by legendary hardware.</span>
          </div>
          <div class="settings-skins-grid">
            ${skinFamilies
              .map(
                (s) => `
              <label class="settings-skin-opt ${curFamily === s.id ? 'is-selected' : ''}" title="${escAttr(s.desc)}">
                <input type="radio" name="opt-theme-family" value="${s.id}" ${curFamily === s.id ? 'checked' : ''} />
                <div class="skin-opt-body">
                  <strong>${escHtml(s.name)}</strong>
                </div>
              </label>
            `
              )
              .join('')}
          </div>

          <div class="settings-appearance-mode-row">
            <span class="settings-sublabel">Appearance Mode:</span>
            <div class="mode-pill-toggle">
              <button type="button" class="btn btn-sm ${curMode === 'light' ? 'btn-primary' : 'btn-outline'}" id="btn-set-mode-light">
                ${ICONS.sun} Light Mode
              </button>
              <button type="button" class="btn btn-sm ${curMode === 'dark' ? 'btn-primary' : 'btn-outline'}" id="btn-set-mode-dark">
                ${ICONS.moon} Dark Mode
              </button>
            </div>
          </div>
        </div>

        <!-- 2. Working Mode & Keyboard Mapping -->
        <div class="settings-section-card">
          <div class="settings-card-header">
            <h4>${ICONS.piano} Creation &amp; Keyboard Mapping Mode</h4>
            <span class="text-muted">Defines how keyboard zones and velocity layers are structured.</span>
          </div>
          <div class="settings-working-mode-grid">
            <label class="settings-mode-opt ${curWorkingMode === 'classic' ? 'is-selected' : ''}">
              <input type="radio" name="opt-working-mode" value="classic" ${curWorkingMode === 'classic' ? 'checked' : ''} />
              <div class="mode-opt-body">
                <div class="mode-opt-title">
                  <strong>Classic Mode (Hartmann Neuron 2002)</strong>
                  <span class="panel-badge badge-muted">1:1 Hardware Original</span>
                </div>
                <p class="text-muted">
                  Contiguous keyboard <code>0..127</code> columns with no gaps or overlaps. Two velocity layers fixed at value <code>64</code> (Low and High). Model names strictly capped at 11 characters for physical display compatibility.
                </p>
              </div>
            </label>

            <label class="settings-mode-opt ${curWorkingMode === 'extended' ? 'is-selected' : ''}">
              <input type="radio" name="opt-working-mode" value="extended" ${curWorkingMode === 'extended' ? 'checked' : ''} />
              <div class="mode-opt-body">
                <div class="mode-opt-title">
                  <strong>Extended Mode (Modern Neural / Next-Gen)</strong>
                  <span class="panel-badge badge-ai-on">HD Multi-Layer</span>
                </div>
                <p class="text-muted">
                  Arbitrary 2D mapping (Key &times; Velocity). Multiple velocity splits, dynamic crossfades, DAHDSR envelopes, ping-pong loops, and 512&times;512 WebP model cover artwork.
                </p>
              </div>
            </label>
          </div>

          <div class="settings-mode-reassurance-box">
            <span class="reassurance-icon">${ICONS.check}</span>
            <div class="reassurance-text">
              <strong>Safe Non-Destructive Bidirectional Compatibility:</strong>
              <p>
                You can switch between Classic and Extended modes at any time. When switching back to Classic Mode, multi-layer velocity regions are <strong>not deleted</strong>: the compiler mathematically projects and compensates relative gains (<span class="math-snippet">10<sup>&Delta;G/20</sup></span>) to preserve exact sonic balance within original hardware constraints.
              </p>
            </div>
          </div>
        </div>

        <!-- 3. Local Library Folders -->
        <div class="settings-section-card">
          <div class="settings-card-header">
            <h4>${ICONS.folder} Local Library Folders (AxionikDB, NeuronDB &amp; Samples)</h4>
            <span class="text-muted">Configure paths to your local libraries to synchronize with the Companion Bridge.</span>
          </div>

          <div class="settings-libraries-container">
            <!-- 1. AxionikDB (Advanced Mode) -->
            <div class="library-path-card">
              <div class="library-path-header">
                <strong>AxionikDB Library (Advanced / Time-Capsule)</strong>
                <span class="text-muted">Models with semantic slugs and self-contained Time Capsules (<code>manifest.json</code> + <code>cover.webp</code>).</span>
              </div>
              <div class="bank-path-input-wrap">
                <input type="text" id="input-axionikdb-path" class="form-control" value="${escAttr(savedAxionikDbPath)}" placeholder="${escAttr(DEFAULT_AXIONIK_DB_PATH)}" />
                <button type="button" class="btn btn-primary" id="btn-scan-axionikdb-dir" ${isBridgeOnline ? '' : 'disabled'}>
                  ${ICONS.search} ${this.isScanningAxionik ? 'Scanning...' : 'Scan AxionikDB'}
                </button>
              </div>
            </div>

            <!-- 2. NeuronDB (Classic Mode) -->
            <div class="library-path-card" style="margin-top: 12px;">
              <div class="library-path-header">
                <strong>NeuronDB Library (Classic / Hartmann 000..511)</strong>
                <span class="text-muted">Banks compatible with Hartmann Neuron hardware &amp; classic software.</span>
              </div>
              <div class="bank-path-input-wrap">
                <input type="text" id="input-neurondb-path" class="form-control" value="${escAttr(savedNeuronDbPath)}" placeholder="${escAttr(DEFAULT_NEURON_DB_PATH)}" />
                <button type="button" class="btn btn-outline" id="btn-scan-neurondb-dir" ${isBridgeOnline ? '' : 'disabled'}>
                  ${ICONS.search} ${this.isScanningNeuronDb ? 'Scanning...' : 'Scan NeuronDB'}
                </button>
              </div>
            </div>

            <!-- 3. SoundFonts / Raw Samples -->
            <div class="library-path-card" style="margin-top: 12px;">
              <div class="library-path-header">
                <strong>SoundFonts &amp; Raw Sample Collection</strong>
                <span class="text-muted">Acoustic audio sources (.sf2, .sfz, .wav) for direct sample import.</span>
              </div>
              <div class="bank-path-input-wrap">
                <input type="text" id="input-bank-path" class="form-control" value="${escAttr(savedBankPath)}" placeholder="${escAttr(DEFAULT_BANK_PATH)}" />
                <button type="button" class="btn btn-outline" id="btn-scan-bank-dir" ${isBridgeOnline ? '' : 'disabled'}>
                  ${ICONS.search} ${this.isScanning ? 'Scanning...' : 'Scan Samples'}
                </button>
              </div>
            </div>

            ${
              !isBridgeOnline
                ? `<p class="bank-bridge-offline-hint text-muted" style="margin-top: 10px;">
                    To scan local directories without browser sandbox restrictions, launch the Companion Bridge (<code>bridge/server.py</code>).
                  </p>`
                : ''
            }
          </div>

          <!-- Scan Results Area -->
          <div id="settings-scan-results-wrap" class="settings-scan-results-wrap">
            ${this.buildScanResultsHtml()}
          </div>
        </div>

        <!-- 4. Storage Quota & Offline Persistence -->
        <div class="settings-section-card">
          <div class="settings-card-header">
            <h4>${ICONS.database} Offline Storage &amp; IndexedDB Quota</h4>
            <span class="text-muted">Persistent browser storage for audio buffers, time capsules, and models.</span>
          </div>
          <div class="settings-storage-row">
            ${
              this.storageEstimate
                ? `
              <div class="storage-estimate-box ${this.storageEstimate.percent > 80 ? 'is-warning' : ''}">
                <div class="storage-text">
                  <strong>IndexedDB Storage:</strong>
                  <span>${(this.storageEstimate.usage / (1024 * 1024)).toFixed(1)} MB used of ${(this.storageEstimate.quota / (1024 * 1024 * 1024)).toFixed(1)} GB available (${this.storageEstimate.percent}%)</span>
                </div>
                ${
                  this.storageEstimate.percent > 80
                    ? `<span class="panel-badge badge-warning">High Storage Usage (>80%)</span>`
                    : `<span class="panel-badge badge-success">Storage Healthy</span>`
                }
              </div>
            `
                : `
              <div class="storage-estimate-box">
                <span class="text-muted">Storage quota estimation available in standard browser sessions.</span>
              </div>
            `
            }
          </div>
        </div>
      </div>
    `;
  }

  private buildScanResultsHtml(): string {
    if (this.axionikScanResults && this.axionikScanResults.length > 0) {
      return `
        <div class="scan-summary-card">
          <div class="scan-summary-header">
            <strong>Models detected in AxionikDB:</strong>
            <span class="panel-badge badge-success">${this.axionikScanResults.length} models</span>
          </div>
          <div class="scan-files-list">
            ${this.axionikScanResults
              .slice(0, 30)
              .map(
                (m) => `
              <div class="scan-file-row">
                <span class="scan-file-name"><strong>${escHtml(m.name)}</strong> <small class="text-muted">(${escHtml(m.slug)})</small></span>
                <span class="scan-file-size text-muted">${escHtml(m.category)} &bull; Set ${m.parameterSet} &bull; ${m.zoneCount} zones</span>
                <span class="scan-file-ext">${m.hasCover ? 'Cover OK' : 'No cover'}</span>
              </div>
            `
              )
              .join('')}
            ${
              this.axionikScanResults.length > 30
                ? `<div class="scan-more text-muted">+${this.axionikScanResults.length - 30} additional models available in Bank Browser.</div>`
                : ''
            }
          </div>
        </div>
      `;
    }

    if (this.neuronDbScanResults) {
      return `
        <div class="scan-summary-card">
          <div class="scan-summary-header">
            <strong>Files found in NeuronDB (<code>${escHtml(this.neuronDbScanResults.scanned_path)}</code>):</strong>
            <span class="panel-badge badge-success">${this.neuronDbScanResults.total_files} files</span>
          </div>
          <div class="scan-files-list">
            ${this.neuronDbScanResults.files
              .slice(0, 30)
              .map(
                (f) => `
              <div class="scan-file-row">
                <span class="scan-file-name">${escHtml(f.name)}</span>
                <span class="scan-file-size text-muted">${Math.round(f.size / 1024)} KB</span>
                <span class="scan-file-ext">${escHtml(f.ext)}</span>
              </div>
            `
              )
              .join('')}
          </div>
        </div>
      `;
    }

    if (!this.scanResults) return '';
    return `
      <div class="scan-summary-card">
        <div class="scan-summary-header">
          <strong>Files found in <code>${escHtml(this.scanResults.scanned_path)}</code>:</strong>
          <span class="panel-badge badge-success">${this.scanResults.total_files} files</span>
        </div>
        <div class="scan-files-list">
          ${this.scanResults.files
            .slice(0, 30)
            .map(
              (f) => `
            <div class="scan-file-row">
              <span class="scan-file-name">${escHtml(f.name)}</span>
              <span class="scan-file-size text-muted">${Math.round(f.size / 1024)} KB</span>
              <span class="scan-file-ext">${escHtml(f.ext)}</span>
            </div>
          `
            )
            .join('')}
          ${
            this.scanResults.total_files > 30
              ? `<div class="scan-more text-muted">+${this.scanResults.total_files - 30} additional files available in Bank Browser.</div>`
              : ''
          }
        </div>
      </div>
    `;
  }

  private getActiveAiPreset(cfg: AiAssistanceConfig): 'dsp' | 'hybrid' | 'max' | 'custom' {
    if (!cfg.enabled) {
      return 'dsp';
    }
    const isDsp =
      cfg.masterWave === 'dsp' &&
      cfg.separation === 'dsp' &&
      cfg.loopExpansion === 'dsp' &&
      cfg.classifier === 'dsp' &&
      cfg.denoise === 'dsp';
    if (isDsp) return 'dsp';

    const isHybrid =
      cfg.masterWave === 'dsp' &&
      cfg.separation === 'ai' &&
      cfg.loopExpansion === 'ai' &&
      cfg.classifier === 'dsp' &&
      cfg.denoise === 'ai';
    if (isHybrid) return 'hybrid';

    const isMax =
      cfg.masterWave === 'ai' &&
      cfg.separation === 'ai' &&
      cfg.loopExpansion === 'ai' &&
      cfg.classifier === 'ai' &&
      cfg.denoise === 'ai';
    if (isMax) return 'max';

    return 'custom';
  }

  private renderMasterWebBar(cfg: AiAssistanceConfig): string {
    const activePreset = this.getActiveAiPreset(cfg);

    return `
      <div class="ai-master-bar">
        <div class="ai-master-toggle-wrap">
          <label class="toggle-switch-label" for="ai-master-toggle">
            <input type="checkbox" id="ai-master-toggle" ${cfg.enabled ? 'checked' : ''} />
            <span class="toggle-slider"></span>
            <span class="toggle-title">Enable AI Assistance</span>
          </label>
          <span class="ai-master-hint text-muted">
            (When disabled, 100% of processing runs with deterministic algorithmic DSP in WebAudio)
          </span>
        </div>

        <div class="ai-presets-group" id="ai-presets-group">
          <span class="presets-label">Quick Presets:</span>
          <button type="button" class="btn btn-sm btn-preset ${activePreset === 'dsp' ? 'btn-preset-highlight' : ''}" id="btn-preset-all-dsp" title="Pure deterministic classic math algorithms (fast and reproducible)">
            ${ICONS.cpu} 100% DSP
          </button>
          <button type="button" class="btn btn-sm btn-preset ${activePreset === 'hybrid' ? 'btn-preset-highlight' : ''}" id="btn-preset-hybrid" title="Recommended optimal balance (Sinc DSP + AI Separation &amp; Outpainting)">
            ${ICONS.zap} Optimal Hybrid
          </button>
          <button type="button" class="btn btn-sm btn-preset ${activePreset === 'max' ? 'btn-preset-highlight' : ''}" id="btn-preset-all-ai" title="All processing stages AI-assisted">
            ${ICONS.sparkle} Max AI Quality
          </button>
          <button type="button" class="btn btn-sm btn-preset ${activePreset === 'custom' ? 'btn-preset-highlight' : ''}" id="btn-preset-custom" title="Custom configuration (non-standard combination of stages)">
            ${ICONS.sliders} Custom
          </button>
        </div>
      </div>
    `;
  }

  private renderWebTab(cfg: AiAssistanceConfig): string {
    return `
      <div class="ai-hw-banner" id="ai-hw-banner">
        <div class="ai-hw-indicator">
          <span class="hw-icon">${ICONS.cpu}</span>
          <div class="hw-text">
            <strong>Browser Hardware Acceleration</strong>
            <span id="ai-hw-desc">${this.webGpuStatus?.statusMessage ?? 'Detecting WebGPU / WASM SIMD capabilities...'}</span>
          </div>
        </div>
        <div class="ai-hw-guarantee">
          <span>0 Servers</span> &bull; <span>0 Cost</span> &bull; <span>100% Client-Side Private</span>
        </div>
      </div>

      <div class="ai-stages-matrix">
        <!-- 1. Master Wave -->
        <div class="stage-card">
          <div class="stage-header">
            <span class="stage-num">1</span>
            <div class="stage-info">
              <h4 class="stage-title">Master Wave Standard (24-bit / 96 kHz)</h4>
              <p class="stage-desc text-muted">High-fidelity sample rate conversion and upper harmonic reconstruction.</p>
            </div>
          </div>
          <div class="stage-options">
            <label class="stage-opt ${cfg.masterWave === 'dsp' ? 'is-selected' : ''}">
              <input type="radio" name="opt-master-wave" value="dsp" ${cfg.masterWave === 'dsp' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.cpu} Algorithmic (DSP)</strong>
                <small>Linear polyphase sinc + harmonic saturator. Zero network artifacts, phase-coherent.</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.masterWave === 'ai' ? 'is-selected' : ''}">
              <input type="radio" name="opt-master-wave" value="ai" ${cfg.masterWave === 'ai' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.ai} Neural Extension (AudioSR)</strong>
                <small>Latent diffusion generating realistic ultra-high harmonics up to 48 kHz Nyquist.</small>
              </span>
            </label>
          </div>
        </div>

        <!-- 2. Source Separation -->
        <div class="stage-card">
          <div class="stage-header">
            <span class="stage-num">2</span>
            <div class="stage-info">
              <h4 class="stage-title">Source Separation &amp; De-Bleeding</h4>
              <p class="stage-desc text-muted">Isolate the solo instrument if the recording contains background bleeding or room noise.</p>
            </div>
          </div>
          <div class="stage-options">
            <label class="stage-opt ${cfg.separation === 'dsp' ? 'is-selected' : ''}">
              <input type="radio" name="opt-separation" value="dsp" ${cfg.separation === 'dsp' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.cpu} Algorithmic (HPSS)</strong>
                <small>Harmonic/percussive separation via median filtering on the STFT spectrogram.</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.separation === 'ai' ? 'is-selected' : ''}">
              <input type="radio" name="opt-separation" value="ai" ${cfg.separation === 'ai' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.ai} AI Separator (Demucs v4)</strong>
                <small>Surgical stem isolation via residual convolutional neural network.</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.separation === 'bypass' ? 'is-selected' : ''}">
              <input type="radio" name="opt-separation" value="bypass" ${cfg.separation === 'bypass' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.bypass} Bypass / Direct</strong>
                <small>Do not separate; use original sample as recorded.</small>
              </span>
            </label>
          </div>
        </div>

        <!-- 3. Loop Expansion -->
        <div class="stage-card">
          <div class="stage-header">
            <span class="stage-num">3</span>
            <div class="stage-info">
              <h4 class="stage-title">Organic Short Loop Expansion</h4>
              <p class="stage-desc text-muted">Unroll short loops to create natural, non-cyclic sustain without buzzing.</p>
            </div>
          </div>
          <div class="stage-options">
            <label class="stage-opt ${cfg.loopExpansion === 'dsp' ? 'is-selected' : ''}">
              <input type="radio" name="opt-loop-expansion" value="dsp" ${cfg.loopExpansion === 'dsp' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.cpu} Algorithmic (Circular Window)</strong>
                <small>Periodic phase modulation and equal-power crossfading at zero crossings.</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.loopExpansion === 'ai' ? 'is-selected' : ''}">
              <input type="radio" name="opt-loop-expansion" value="ai" ${cfg.loopExpansion === 'ai' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.ai} Neural Outpainting</strong>
                <small>Generative autoregressive continuation for natural timbral sustain.</small>
              </span>
            </label>
          </div>
        </div>

        <!-- 4. Classifier -->
        <div class="stage-card">
          <div class="stage-header">
            <span class="stage-num">4</span>
            <div class="stage-info">
              <h4 class="stage-title">Parameter Set &amp; Acoustic Classifier</h4>
              <p class="stage-desc text-muted">Automatic selection of Parameter Set 0..9 and instrument family tagging.</p>
            </div>
          </div>
          <div class="stage-options">
            <label class="stage-opt ${cfg.classifier === 'dsp' ? 'is-selected' : ''}">
              <input type="radio" name="opt-classifier" value="dsp" ${cfg.classifier === 'dsp' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.cpu} Algorithmic (Descriptors)</strong>
                <small>Log attack, inharmonicity B, spectral centroid, and zero-crossing rate.</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.classifier === 'ai' ? 'is-selected' : ''}">
              <input type="radio" name="opt-classifier" value="ai" ${cfg.classifier === 'ai' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.ai} Neural Classifier</strong>
                <small>Deep timbral acoustic embeddings recognition in WebGPU.</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.classifier === 'manual' ? 'is-selected' : ''}">
              <input type="radio" name="opt-classifier" value="manual" ${cfg.classifier === 'manual' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.bypass} Manual Selection</strong>
                <small>Manually select Parameter Set 0..9 on the main process panel.</small>
              </span>
            </label>
          </div>
        </div>

        <!-- 5. Denoise -->
        <div class="stage-card">
          <div class="stage-header">
            <span class="stage-num">5</span>
            <div class="stage-info">
              <h4 class="stage-title">Noise Reduction &amp; Audio Restoration</h4>
              <p class="stage-desc text-muted">Suppression of analog tape hiss and background ambient noise from vintage recordings.</p>
            </div>
          </div>
          <div class="stage-options">
            <label class="stage-opt ${cfg.denoise === 'dsp' ? 'is-selected' : ''}">
              <input type="radio" name="opt-denoise" value="dsp" ${cfg.denoise === 'dsp' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.cpu} Algorithmic (Multiband Gate)</strong>
                <small>Static noise-floor attenuation without altering musical phase.</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.denoise === 'ai' ? 'is-selected' : ''}">
              <input type="radio" name="opt-denoise" value="ai" ${cfg.denoise === 'ai' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.ai} AI Denoise (DeepFilter)</strong>
                <small>Adaptive neural filtering preserving subtle instrument harmonics.</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.denoise === 'bypass' ? 'is-selected' : ''}">
              <input type="radio" name="opt-denoise" value="bypass" ${cfg.denoise === 'bypass' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.bypass} Disabled / Raw</strong>
                <small>Keep raw recording intact without applying any noise suppression.</small>
              </span>
            </label>
          </div>
        </div>
      </div>
    `;
  }

  private renderCloudTab(): string {
    const byok = cloudByokClient.getConfig();
    const currentToken =
      byok.provider === 'replicate'
        ? byok.replicateToken ?? ''
        : byok.provider === 'huggingface'
          ? byok.huggingfaceToken ?? ''
          : byok.geminiApiKey ?? '';

    const providerMeta = {
      replicate: {
        url: 'https://replicate.com/account/api-tokens',
        label: 'Obtain Replicate API Token',
      },
      huggingface: {
        url: 'https://huggingface.co/settings/tokens',
        label: 'Obtain Hugging Face User Token',
      },
      gemini: {
        url: 'https://aistudio.google.com/app/apikey',
        label: 'Get Google AI Studio API Key',
      },
    }[byok.provider] ?? {
      url: 'https://replicate.com/account/api-tokens',
      label: 'Obtain API Token',
    };

    return `
      <div class="ai-byok-container">
        <!-- Privacy & Direct Billing Guarantee Banner -->
        <div class="byok-guarantee-card">
          <div class="guarantee-icon">${ICONS.lock}</div>
          <div class="guarantee-content">
            <h4>Strict Privacy &amp; Zero Server Cost Guarantee</h4>
            <p>
              Your API keys are stored <strong>solely and exclusively in your local browser (localStorage)</strong>.
              They are never transmitted to or saved on any ABDSynths server. All requests travel directly from your browser to the official provider endpoint, with computing costs billed to your personal provider account.
            </p>
          </div>
        </div>

        <!-- BYOK Config Form -->
        <div class="byok-form-card">
          <div class="byok-header-row">
            <label class="toggle-switch-label" for="byok-enable-toggle">
              <input type="checkbox" id="byok-enable-toggle" ${byok.enabled ? 'checked' : ''} />
              <span class="toggle-slider"></span>
              <span class="toggle-title">Enable Cloud AI (BYOK)</span>
            </label>
            <span class="byok-status-pill ${byok.enabled ? 'is-active' : 'is-inactive'}">
              ${byok.enabled ? 'Cloud AI Active' : 'Cloud AI Inactive'}
            </span>
          </div>

          <div class="byok-field-group">
            <label class="byok-field-label">Preferred Cloud Provider:</label>
            <div class="byok-provider-grid">
              <label class="byok-provider-opt ${byok.provider === 'replicate' ? 'is-selected' : ''}">
                <input type="radio" name="byok-provider" value="replicate" ${byok.provider === 'replicate' ? 'checked' : ''} />
                <span class="provider-title">Replicate</span>
                <span class="provider-desc">Best for AudioSR (96kHz Super-Resolution) and MusicGen models.</span>
              </label>
              <label class="byok-provider-opt ${byok.provider === 'huggingface' ? 'is-selected' : ''}">
                <input type="radio" name="byok-provider" value="huggingface" ${byok.provider === 'huggingface' ? 'checked' : ''} />
                <span class="provider-title">Hugging Face (Inference API)</span>
                <span class="provider-desc">Access to open checkpoints and serverless accelerated inference.</span>
              </label>
              <label class="byok-provider-opt ${byok.provider === 'gemini' ? 'is-selected' : ''}">
                <input type="radio" name="byok-provider" value="gemini" ${byok.provider === 'gemini' ? 'checked' : ''} />
                <span class="provider-title">Google Gemini (AI Studio)</span>
                <span class="provider-desc">Multimodal spectral analysis and acoustic reasoning.</span>
              </label>
            </div>
          </div>

          <div class="byok-field-group">
            <label class="byok-field-label" for="byok-api-key-input">
              API Key (${byok.provider === 'replicate' ? 'Replicate API Token' : byok.provider === 'huggingface' ? 'HF User Access Token' : 'Gemini API Key'}):
            </label>
            <div class="byok-input-row">
              <div class="byok-input-wrap">
                <input
                  type="${this.showPassword ? 'text' : 'password'}"
                  id="byok-api-key-input"
                  class="form-control byok-key-field"
                  placeholder="Enter your personal key (e.g. r8_... / hf_... / AIzaSy...)"
                  value="${escAttr(currentToken)}"
                  autocomplete="new-password"
                  spellcheck="false"
                />
                <button type="button" class="btn btn-icon byok-toggle-visibility" id="btn-toggle-key-visibility" title="Show / hide key">
                  ${this.showPassword ? ICONS.eyeOff : ICONS.eye}
                </button>
              </div>
              <button type="button" class="btn btn-secondary" id="btn-test-byok" ${this.isTestingByok ? 'disabled' : ''}>
                ${this.isTestingByok ? `${ICONS.spinner} Verifying...` : `${ICONS.zap} Verify Key`}
              </button>
              <button type="button" class="btn btn-outline" id="btn-clear-byok" title="Clear key from local browser storage">
                ${ICONS.trash}
              </button>
            </div>
            <div class="byok-url-action-row">
              <a
                href="${escAttr(providerMeta.url)}"
                target="_blank"
                rel="noopener noreferrer"
                class="btn btn-sm btn-secondary byok-url-btn"
                title="Open ${escAttr(providerMeta.label)} dashboard in a new tab"
              >
                ${ICONS.externalLink}
                <span>${escHtml(providerMeta.label)}</span>
              </a>
            </div>
          </div>

          ${
            this.byokTestResult
              ? `
            <div class="byok-test-banner ${this.byokTestResult.success ? 'is-success' : 'is-error'}">
              <span class="test-icon">${this.byokTestResult.success ? ICONS.check : ICONS.alert}</span>
              <span class="test-msg">${escHtml(this.byokTestResult.message)}</span>
            </div>
          `
              : ''
          }
        </div>
      </div>
    `;
  }

  private renderBridgeTab(): string {
    const bridge = bridgeClient.getStatus();
    const isOnline = bridge.connected;

    return `
      <div class="ai-bridge-tab-container">
        <!-- Status Card -->
        <div class="bridge-status-card ${isOnline ? 'is-connected' : 'is-disconnected'}">
          <div class="bridge-card-header">
            <div class="bridge-card-title">
              <span class="bridge-dot ${isOnline ? 'dot-online' : 'dot-offline'}"></span>
              <strong>Local Companion Bridge (Python &amp; GPU)</strong>
            </div>
            <span class="bridge-badge">${isOnline ? 'ONLINE (7860)' : 'DISCONNECTED'}</span>
          </div>

          <div class="bridge-details-grid">
            <div class="bridge-detail-item">
              <span class="detail-label">Local Endpoint:</span>
              <span class="detail-value"><code>${escHtml(bridge.url)}</code></span>
            </div>
            <div class="bridge-detail-item">
              <span class="detail-label">Compute Device:</span>
              <span class="detail-value">${escHtml(bridge.capabilities?.device ?? 'N/A')} (${escHtml(bridge.capabilities?.gpu_name || 'CPU Fallback')})</span>
            </div>
            <div class="bridge-detail-item">
              <span class="detail-label">GPU Acceleration:</span>
              <span class="detail-value">${bridge.capabilities?.gpu ? 'Enabled (CUDA / VRAM)' : 'Disabled'}</span>
            </div>
            <div class="bridge-detail-item">
              <span class="detail-label">Loopback Latency:</span>
              <span class="detail-value">${bridge.latencyMs ?? 0} ms</span>
            </div>
          </div>

          ${
            !isOnline
              ? `
            <div class="bridge-offline-instructions">
              <p>
                The Companion Bridge connects your browser (even when hosted on Vercel) to your local dedicated GPU (e.g. RTX 3070 8GB VRAM) to execute heavy neural models with zero server costs and zero audio uploads.
                To launch it, run in your terminal:
              </p>
              <pre class="bridge-code-snippet"><code>start.bat  (Launches app and companion bridge)
or:
python bridge/server.py</code></pre>
              <div class="bridge-retry-row">
                <button type="button" class="btn btn-sm btn-outline" id="btn-bridge-retry">
                  ${ICONS.refresh} Retry Connection Now
                </button>
              </div>
            </div>
          `
              : ''
          }
        </div>

        <!-- Models Downloader Section -->
        <div class="bridge-models-section">
          <div class="models-section-header">
            <div class="header-left">
              <h4>Local Neural Model Catalog</h4>
              <p class="text-muted">
                Transparent multithreaded model pre-download directly to your local GPU.
                <br/>
                <small style="opacity: 0.85;">(Note: Models are also downloaded automatically on first demand if not pre-fetched here).</small>
              </p>
            </div>
            <button type="button" class="btn btn-xs btn-outline" id="btn-refresh-models">
              ${ICONS.refresh} Refresh List
            </button>
          </div>

          <div class="models-list" id="bridge-models-list">
            ${this.buildBridgeModelsHtml()}
          </div>
        </div>
      </div>
    `;
  }

  private buildBridgeModelsHtml(): string {
    if (!bridgeClient.isConnected()) {
      return `
        <div class="models-empty-state text-muted">
          Connect the local Companion Bridge to manage, download, or uninstall GPU neural models.
        </div>
      `;
    }

    if (this.bridgeModels.length === 0) {
      return `
        <div class="models-empty-state text-muted">
          Loading catalog of available models...
        </div>
      `;
    }

    return this.bridgeModels
      .map((m) => {
        const isDownloading = m.status === 'downloading' || this.activePollingModelIds.has(m.id);
        const isEditingUrl = this.editingUrlModelId === m.id;
        const pct = Math.min(100, Math.max(0, Math.round(m.progress)));
        const dlMb = m.downloaded_bytes ? (m.downloaded_bytes / (1024 * 1024)).toFixed(1) : '0';
        const totMb = m.total_bytes
          ? (m.total_bytes / (1024 * 1024)).toFixed(0)
          : m.size_mb.toString();
        const speedText = m.speed_mbps && m.speed_mbps > 0 ? ` &bull; ${m.speed_mbps.toFixed(1)} MB/s` : '';

        const sizeDisplay =
          m.size_mb >= 1000 ? `${(m.size_mb / 1024).toFixed(1)} GB` : `${m.size_mb} MB`;

        return `
        <div class="model-row-card ${m.installed ? 'is-installed' : ''}" data-model-id="${escAttr(m.id)}">
          <div class="model-row-main">
            <div class="model-row-title">
              <strong>${escHtml(m.name)}</strong>
              <span class="model-size-badge">${sizeDisplay}</span>
              <span class="model-task-badge">${escHtml(m.task)}</span>
              ${m.is_custom_url ? '<span class="model-custom-url-badge" title="Custom download mirror in use">Custom Mirror</span>' : ''}
            </div>
            <p class="model-row-desc text-muted">${escHtml(m.description)}</p>
            ${
              isDownloading
                ? `
              <div class="model-progress-bar-wrap">
                <div class="model-progress-bar-bg">
                  <div class="model-progress-bar" style="width: ${pct}%"></div>
                </div>
                <span class="model-progress-text">${pct}% &bull; ${dlMb} / ${totMb} MB${speedText}</span>
              </div>
            `
                : ''
            }
            ${
              isEditingUrl
                ? `
              <div class="model-url-editor-box">
                <div class="url-editor-label">Model Download URL:</div>
                <div class="url-editor-input-row">
                  <input type="text" class="form-control input-custom-model-url" data-id="${escAttr(m.id)}" value="${escAttr(m.url || '')}" placeholder="${escAttr(m.default_url || '')}" />
                  <button type="button" class="btn btn-xs btn-outline btn-check-model-url" data-id="${escAttr(m.id)}" title="Check if URL is reachable and valid">Check URL</button>
                  <button type="button" class="btn btn-xs btn-primary btn-save-model-url" data-id="${escAttr(m.id)}">Save</button>
                  <button type="button" class="btn btn-xs btn-outline btn-reset-model-url" data-id="${escAttr(m.id)}">Reset to Official</button>
                  <button type="button" class="btn btn-xs btn-secondary btn-cancel-model-url" data-id="${escAttr(m.id)}">Cancel</button>
                </div>
                <div class="url-check-feedback" data-id="${escAttr(m.id)}" style="display: none; margin-top: 6px; font-size: 11px; font-family: var(--font-mono);"></div>
              </div>
            `
                : ''
            }
          </div>
          <div class="model-row-action">
            ${
              m.installed
                ? `
                <span class="badge-installed">${ICONS.check} Installed on Disk</span>
                <button type="button" class="btn btn-xs btn-outline btn-toggle-url-editor" data-id="${escAttr(m.id)}" title="Configure Download URL / Mirror">
                  ${ICONS.settings} URL
                </button>
                <button type="button" class="btn btn-sm btn-outline btn-delete-model" data-id="${escAttr(m.id)}" title="Delete this model from local disk to free space">
                  ${ICONS.trash} Uninstall
                </button>
              `
                : isDownloading
                  ? `
                  <button type="button" class="btn btn-xs btn-outline btn-toggle-url-editor" data-id="${escAttr(m.id)}" title="Configure Download URL / Mirror">
                    ${ICONS.settings} URL
                  </button>
                  <button type="button" class="btn btn-sm btn-outline btn-downloading" disabled>
                    <span class="btn-spinner">${ICONS.spinner}</span>
                    <span>Downloading (${pct}%)...</span>
                  </button>
                `
                  : `
                  <button type="button" class="btn btn-xs btn-outline btn-toggle-url-editor" data-id="${escAttr(m.id)}" title="Configure Download URL / Mirror">
                    ${ICONS.settings} URL
                  </button>
                  <button type="button" class="btn btn-sm btn-primary btn-download-model" data-id="${escAttr(m.id)}">
                    ${ICONS.zap} Download (${sizeDisplay})
                  </button>
                `
            }
          </div>
        </div>
      `;
      })
      .join('');
  }

  private renderBridgeModelsList(): void {
    if (!this.backdropEl) return;
    const container = this.backdropEl.querySelector('#bridge-models-list');
    if (container) {
      container.innerHTML = this.buildBridgeModelsHtml();
      this.bindBridgeModelActions();
    }
  }

  private updateHardwareBadge(): void {
    if (!this.backdropEl) return;
    const desc = this.backdropEl.querySelector('#ai-hw-desc');
    if (desc && this.webGpuStatus) {
      desc.textContent = this.webGpuStatus.statusMessage;
    }
    const footerStatus = this.backdropEl.querySelector('#ai-footer-device-status');
    if (footerStatus && this.webGpuStatus) {
      footerStatus.textContent = `[${this.webGpuStatus.activeProvider.toUpperCase()}] ${this.webGpuStatus.adapterName || 'DSP Nativo'}`;
    }
  }

  private updateBridgeBadge(): void {
    if (!this.backdropEl) return;
    const bridge = bridgeClient.getStatus();
    const isOnline = bridge.connected;
    const badge = this.backdropEl.querySelector('#bridge-header-badge');
    if (badge) {
      badge.className = `panel-badge ${isOnline ? 'badge-success' : 'badge-muted'}`;
      badge.textContent = isOnline ? '● EN LÍNEA (7860)' : '○ DESCONECTADO';
    }
  }

  private bindEvents(): void {
    if (!this.backdropEl) return;

    // Close buttons
    this.backdropEl.querySelector('#btn-close-settings-modal')?.addEventListener('click', () => this.close());
    this.backdropEl.querySelector('#btn-cancel-settings-modal')?.addEventListener('click', () => this.close());

    // Apply button
    this.backdropEl.querySelector('#btn-apply-settings-modal')?.addEventListener('click', () => {
      this.handlers.onUpdateAiConfig({ ...this.currentConfig });
      this.close();
      toast('Settings saved and applied successfully', 'success');
    });

    // Primary Tab Navigation (General | IA)
    this.backdropEl.querySelectorAll<HTMLButtonElement>('.primary-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mainTab = btn.dataset.mainTab as SettingsMainTab;
        if (mainTab && mainTab !== this.activeMainTab) {
          this.activeMainTab = mainTab;
          this.render();
        }
      });
    });

    // AI Sub-tab Navigation (Web | Cloud | Bridge)
    this.backdropEl.querySelectorAll<HTMLButtonElement>('.ai-subtab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const subtab = btn.dataset.aiSubtab as AiSubTab;
        if (subtab && subtab !== this.activeAiSubTab) {
          this.activeAiSubTab = subtab;
          this.render();
        }
      });
    });

    if (this.activeMainTab === 'general') {
      this.bindGeneralTabEvents();
    } else {
      if (this.activeAiSubTab === 'web') {
        this.bindWebTabEvents();
      } else if (this.activeAiSubTab === 'cloud') {
        this.bindCloudTabEvents();
      } else if (this.activeAiSubTab === 'bridge') {
        this.bindBridgeTabEvents();
      }
    }
  }

  private bindGeneralTabEvents(): void {
    if (!this.backdropEl) return;

    // Theme family radio
    this.backdropEl.querySelectorAll<HTMLInputElement>('input[name="opt-theme-family"]').forEach((r) => {
      r.addEventListener('change', () => {
        if (r.checked) {
          this.handlers.onSelectThemeFamily(r.value);
          this.render();
        }
      });
    });

    // Appearance mode pills
    this.backdropEl.querySelector('#btn-set-mode-light')?.addEventListener('click', () => {
      this.handlers.onSetThemeMode('light');
      this.render();
    });
    this.backdropEl.querySelector('#btn-set-mode-dark')?.addEventListener('click', () => {
      this.handlers.onSetThemeMode('dark');
      this.render();
    });

    // Working mode radio
    this.backdropEl.querySelectorAll<HTMLInputElement>('input[name="opt-working-mode"]').forEach((r) => {
      r.addEventListener('change', () => {
        if (r.checked) {
          const mode = r.value as WorkingMode;
          this.handlers.onSetWorkingMode(mode);
          this.render();
          toast(`Working mode switched to: ${mode === 'classic' ? 'Classic (1:1 Hardware)' : 'Extended (HD Multi-Layer)'}`, 'info');
        }
      });
    });

    // AxionikDB path scan
    const axionikPathInput = this.backdropEl.querySelector<HTMLInputElement>('#input-axionikdb-path');
    axionikPathInput?.addEventListener('change', () => {
      localStorage.setItem(STORAGE_KEY_AXIONIK_DB_PATH, axionikPathInput.value.trim());
    });
    this.backdropEl.querySelector('#btn-scan-axionikdb-dir')?.addEventListener('click', async () => {
      const p = axionikPathInput?.value.trim() || DEFAULT_AXIONIK_DB_PATH;
      localStorage.setItem(STORAGE_KEY_AXIONIK_DB_PATH, p);
      this.isScanningAxionik = true;
      this.render();
      try {
        this.axionikScanResults = await bridgeClient.scanAxionikDb(p);
        toast(`AxionikDB scanned: ${this.axionikScanResults.length} models found`, 'success');
      } catch (err) {
        toast(`Error scanning AxionikDB: ${String(err)}`, 'error');
      } finally {
        this.isScanningAxionik = false;
        this.render();
      }
    });

    // NeuronDB path scan
    const neuronDbPathInput = this.backdropEl.querySelector<HTMLInputElement>('#input-neurondb-path');
    neuronDbPathInput?.addEventListener('change', () => {
      localStorage.setItem(STORAGE_KEY_NEURON_DB_PATH, neuronDbPathInput.value.trim());
    });
    this.backdropEl.querySelector('#btn-scan-neurondb-dir')?.addEventListener('click', async () => {
      const p = neuronDbPathInput?.value.trim() || DEFAULT_NEURON_DB_PATH;
      localStorage.setItem(STORAGE_KEY_NEURON_DB_PATH, p);
      this.isScanningNeuronDb = true;
      this.render();
      try {
        this.neuronDbScanResults = await bridgeClient.scanLocalFiles(p);
        toast(`NeuronDB scanned: ${this.neuronDbScanResults.total_files} files found`, 'success');
      } catch (err) {
        toast(`Error scanning NeuronDB: ${String(err)}`, 'error');
      } finally {
        this.isScanningNeuronDb = false;
        this.render();
      }
    });

    // Soundfonts / Raw Bank path scan
    const pathInput = this.backdropEl.querySelector<HTMLInputElement>('#input-bank-path');
    pathInput?.addEventListener('change', () => {
      localStorage.setItem(STORAGE_KEY_BANK_PATH, pathInput.value.trim());
    });

    this.backdropEl.querySelector('#btn-scan-bank-dir')?.addEventListener('click', async () => {
      const p = pathInput?.value.trim() || DEFAULT_BANK_PATH;
      localStorage.setItem(STORAGE_KEY_BANK_PATH, p);
      this.isScanning = true;
      this.render();
      try {
        this.scanResults = await bridgeClient.scanLocalFiles(p);
        toast(`Scan complete: ${this.scanResults.total_files} files found`, 'success');
      } catch (err) {
        toast(`Error scanning directory: ${String(err)}`, 'error');
      } finally {
        this.isScanning = false;
        this.render();
      }
    });
  }

  private bindWebTabEvents(): void {
    if (!this.backdropEl) return;

    // Master AI toggle
    const masterToggle = this.backdropEl.querySelector<HTMLInputElement>('#ai-master-toggle');
    masterToggle?.addEventListener('change', () => {
      this.currentConfig.enabled = masterToggle.checked;
      this.syncActiveBadge();
      this.syncPresetButtons();
    });

    // Preset buttons
    this.backdropEl.querySelector('#btn-preset-all-dsp')?.addEventListener('click', () => {
      this.currentConfig = {
        enabled: false,
        masterWave: 'dsp',
        separation: 'dsp',
        loopExpansion: 'dsp',
        classifier: 'dsp',
        denoise: 'dsp',
      };
      this.render();
      toast('Preset applied: 100% Deterministic Algorithmic DSP', 'info');
    });

    this.backdropEl.querySelector('#btn-preset-hybrid')?.addEventListener('click', () => {
      this.currentConfig = {
        enabled: true,
        masterWave: 'dsp',
        separation: 'ai',
        loopExpansion: 'ai',
        classifier: 'dsp',
        denoise: 'ai',
      };
      this.render();
      toast('Preset applied: Optimal Hybrid (Sinc DSP + AI Outpainting/Denoise)', 'success');
    });

    this.backdropEl.querySelector('#btn-preset-all-ai')?.addEventListener('click', () => {
      this.currentConfig = {
        enabled: true,
        masterWave: 'ai',
        separation: 'ai',
        loopExpansion: 'ai',
        classifier: 'ai',
        denoise: 'ai',
      };
      this.render();
      toast('Preset applied: Maximum Quality AI-Assisted (5/5 stages)', 'success');
    });

    // Stage radio changes
    const bindRadio = (name: string, setter: (val: string) => void) => {
      this.backdropEl?.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach((r) => {
        r.addEventListener('change', () => {
          if (r.checked) {
            setter(r.value);
            this.syncActiveBadge();
            this.syncOptionSelectionClasses();
            this.syncPresetButtons();
          }
        });
      });
    };

    bindRadio('opt-master-wave', (v) => (this.currentConfig.masterWave = v as MasterWaveMethod));
    bindRadio('opt-separation', (v) => (this.currentConfig.separation = v as SeparationMethod));
    bindRadio('opt-loop-expansion', (v) => (this.currentConfig.loopExpansion = v as LoopExpansionMethod));
    bindRadio('opt-classifier', (v) => (this.currentConfig.classifier = v as ClassifierMethod));
    bindRadio('opt-denoise', (v) => (this.currentConfig.denoise = v as DenoiseMethod));
  }

  private bindCloudTabEvents(): void {
    if (!this.backdropEl) return;

    // Toggle key visibility
    this.backdropEl.querySelector('#btn-toggle-key-visibility')?.addEventListener('click', () => {
      this.showPassword = !this.showPassword;
      this.render();
    });

    // BYOK Enable toggle
    const enableToggle = this.backdropEl.querySelector<HTMLInputElement>('#byok-enable-toggle');
    enableToggle?.addEventListener('change', () => {
      cloudByokClient.saveConfig({ enabled: enableToggle.checked });
      this.render();
    });

    // Provider radio selection
    this.backdropEl.querySelectorAll<HTMLInputElement>('input[name="byok-provider"]').forEach((r) => {
      r.addEventListener('change', () => {
        if (r.checked) {
          const provider = r.value as CloudAiProvider;
          cloudByokClient.saveConfig({ provider });
          this.byokTestResult = null;
          this.render();
        }
      });
    });

    // API Key input change
    const keyInput = this.backdropEl.querySelector<HTMLInputElement>('#byok-api-key-input');
    keyInput?.addEventListener('input', () => {
      const val = keyInput.value.trim();
      const currentProvider = cloudByokClient.getConfig().provider;
      if (currentProvider === 'replicate') {
        cloudByokClient.saveConfig({ replicateToken: val });
      } else if (currentProvider === 'huggingface') {
        cloudByokClient.saveConfig({ huggingfaceToken: val });
      } else if (currentProvider === 'gemini') {
        cloudByokClient.saveConfig({ geminiApiKey: val });
      }
    });

    // Test connection button
    this.backdropEl.querySelector('#btn-test-byok')?.addEventListener('click', async () => {
      const provider = cloudByokClient.getConfig().provider;
      const key = keyInput?.value.trim() ?? '';
      this.isTestingByok = true;
      this.byokTestResult = null;
      this.render();

      const result = await cloudByokClient.testConnection(provider, key);
      this.isTestingByok = false;
      this.byokTestResult = result;
      this.render();
    });

    // Clear key button
    this.backdropEl.querySelector('#btn-clear-byok')?.addEventListener('click', () => {
      cloudByokClient.clearConfig();
      this.byokTestResult = null;
      this.render();
      toast('Keys cleared from local browser storage', 'info');
    });
  }

  private bindBridgeTabEvents(): void {
    if (!this.backdropEl) return;

    this.backdropEl.querySelector('#btn-bridge-retry')?.addEventListener('click', async () => {
      toast('Checking Companion Bridge connection...', 'info');
      await bridgeClient.checkHealth();
      await this.refreshBridgeModels();
      this.render();
    });

    this.backdropEl.querySelector('#btn-refresh-models')?.addEventListener('click', async () => {
      await this.refreshBridgeModels();
      this.render();
    });

    this.bindBridgeModelActions();
  }

  private bindBridgeModelActions(): void {
    if (!this.backdropEl) return;

    // Download buttons
    this.backdropEl.querySelectorAll<HTMLButtonElement>('.btn-download-model').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const modelId = btn.dataset.id;
        if (!modelId) return;

        this.activePollingModelIds.add(modelId);
        const m = this.bridgeModels.find((x) => x.id === modelId);
        if (m) {
          m.status = 'downloading';
        }
        this.renderBridgeModelsList();
        toast(`Initiating background download for "${m?.name || modelId}"...`, 'info');

        try {
          await bridgeClient.downloadModel(modelId);
          this.startModelProgressPolling(modelId);
        } catch (err) {
          this.activePollingModelIds.delete(modelId);
          if (m) {
            m.status = 'error';
          }
          toast(`Error initiating download: ${String(err)}`, 'error');
          this.renderBridgeModelsList();
        }
      });
    });

    // Delete / Uninstall buttons
    this.backdropEl.querySelectorAll<HTMLButtonElement>('.btn-delete-model').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const modelId = btn.dataset.id;
        if (!modelId) return;
        const m = this.bridgeModels.find((x) => x.id === modelId);
        const confirmed = window.confirm(
          `Do you want to uninstall "${m?.name || modelId}" from local disk to free space?`
        );
        if (!confirmed) return;

        try {
          const res = await bridgeClient.deleteModel(modelId);
          if (m) {
            m.installed = false;
            m.status = 'available';
            m.progress = 0;
            m.downloaded_bytes = 0;
          }
          toast(`Model uninstalled: ${res.freed_mb ?? 0} MB freed on disk`, 'info');
          this.renderBridgeModelsList();
        } catch (err) {
          toast(`Error uninstalling model: ${String(err)}`, 'error');
        }
      });
    });

    // Toggle URL Editor buttons
    this.backdropEl.querySelectorAll<HTMLButtonElement>('.btn-toggle-url-editor').forEach((btn) => {
      btn.addEventListener('click', () => {
        const modelId = btn.dataset.id;
        this.editingUrlModelId = this.editingUrlModelId === modelId ? null : (modelId ?? null);
        this.renderBridgeModelsList();
      });
    });

    // Check Model URL buttons
    this.backdropEl.querySelectorAll<HTMLButtonElement>('.btn-check-model-url').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const modelId = btn.dataset.id;
        if (!modelId) return;
        const input = this.backdropEl?.querySelector<HTMLInputElement>(`.input-custom-model-url[data-id="${modelId}"]`);
        const feedback = this.backdropEl?.querySelector<HTMLElement>(`.url-check-feedback[data-id="${modelId}"]`);
        const m = this.bridgeModels.find((x) => x.id === modelId);
        const urlToCheck = input?.value.trim() || m?.url || m?.default_url || '';

        if (!urlToCheck) {
          toast('Please enter a URL to check', 'warning');
          return;
        }

        const originalText = btn.textContent;
        btn.textContent = 'Checking...';
        btn.disabled = true;

        if (feedback) {
          feedback.style.display = 'block';
          feedback.style.color = 'var(--color-text-muted)';
          feedback.textContent = 'Contacting server...';
        }

        try {
          const res = await bridgeClient.checkModelUrl(urlToCheck);
          if (res.reachable) {
            const sizeStr = res.size_bytes ? ` • ${(res.size_bytes / (1024 * 1024)).toFixed(1)} MB` : '';
            if (feedback) {
              feedback.style.color = 'var(--color-success)';
              feedback.textContent = `✓ URL is reachable (HTTP ${res.status_code || 200}${sizeStr})`;
            }
            toast(`URL is reachable (HTTP ${res.status_code || 200}${sizeStr})`, 'success');
          } else {
            if (feedback) {
              feedback.style.color = 'var(--color-danger)';
              feedback.textContent = `✗ URL check failed: ${res.error || 'Server returned unreachable status'}`;
            }
            toast(`URL unreachable: ${res.error || 'Check failed'}`, 'error');
          }
        } catch (err) {
          if (feedback) {
            feedback.style.color = 'var(--color-danger)';
            feedback.textContent = `✗ Error: ${String(err)}`;
          }
          toast(`Error checking URL: ${String(err)}`, 'error');
        } finally {
          btn.textContent = originalText;
          btn.disabled = false;
        }
      });
    });

    // Save Custom URL buttons
    this.backdropEl.querySelectorAll<HTMLButtonElement>('.btn-save-model-url').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const modelId = btn.dataset.id;
        if (!modelId) return;
        const input = this.backdropEl?.querySelector<HTMLInputElement>(`.input-custom-model-url[data-id="${modelId}"]`);
        const newUrl = input?.value.trim() ?? '';
        try {
          await bridgeClient.updateModelUrl(modelId, newUrl);
          this.editingUrlModelId = null;
          await this.refreshBridgeModels();
          toast('Model URL updated successfully', 'success');
        } catch (err) {
          toast(`Error updating URL: ${String(err)}`, 'error');
        }
      });
    });

    // Reset Model URL to official
    this.backdropEl.querySelectorAll<HTMLButtonElement>('.btn-reset-model-url').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const modelId = btn.dataset.id;
        if (!modelId) return;
        try {
          await bridgeClient.updateModelUrl(modelId, '');
          this.editingUrlModelId = null;
          await this.refreshBridgeModels();
          toast('URL reset to official repository mirror', 'info');
        } catch (err) {
          toast(`Error resetting URL: ${String(err)}`, 'error');
        }
      });
    });

    // Cancel URL Editor
    this.backdropEl.querySelectorAll<HTMLButtonElement>('.btn-cancel-model-url').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.editingUrlModelId = null;
        this.renderBridgeModelsList();
      });
    });
  }

  private startModelProgressPolling(modelId: string): void {
    this.activePollingModelIds.add(modelId);
    if (this.downloadPollTimer) return;

    this.downloadPollTimer = setInterval(async () => {
      if (this.activePollingModelIds.size === 0) {
        if (this.downloadPollTimer) {
          clearInterval(this.downloadPollTimer);
          this.downloadPollTimer = null;
        }
        return;
      }

      for (const mId of Array.from(this.activePollingModelIds)) {
        try {
          const prog = await bridgeClient.getModelProgress(mId);
          const model = this.bridgeModels.find((m) => m.id === mId);
          if (model) {
            model.progress = prog.progress;
            model.status = prog.status as BridgeModelInfo['status'];
            model.downloaded_bytes = prog.downloaded_bytes;
            model.total_bytes = prog.total_bytes;
            model.speed_mbps = prog.speed_mbps;

            if (prog.status === 'ready' || (prog.progress >= 100 && prog.status !== 'error')) {
              model.installed = true;
              model.status = 'ready';
              model.progress = 100;
              this.activePollingModelIds.delete(mId);
              toast(`Model "${model.name}" downloaded and ready on GPU`, 'success');
            } else if (prog.status === 'error') {
              this.activePollingModelIds.delete(mId);
              toast(`Download failed for "${model.name}": ${prog.error ?? 'Network error'}`, 'error');
            }
          }
        } catch {
          // transient poll error
        }
      }
      this.renderBridgeModelsList();
    }, 1000);
  }

  private syncActiveBadge(): void {
    if (!this.backdropEl) return;
    const badge = this.backdropEl.querySelector('#ai-active-badge');
    if (badge) {
      const activeAiCount = this.countActiveAiStages();
      badge.className = `panel-badge ${this.currentConfig.enabled ? 'badge-ai-on' : 'badge-muted'}`;
      badge.textContent = this.currentConfig.enabled
        ? `AI: ${activeAiCount}/5 STAGES`
        : 'PURE DSP (AI OFF)';
    }
  }

  private syncOptionSelectionClasses(): void {
    if (!this.backdropEl) return;
    this.backdropEl.querySelectorAll('.stage-opt').forEach((label) => {
      const input = label.querySelector<HTMLInputElement>('input[type="radio"]');
      label.classList.toggle('is-selected', Boolean(input?.checked));
    });
  }

  private syncPresetButtons(): void {
    const group = this.backdropEl?.querySelector('#ai-presets-group');
    if (!group) return;
    const activePreset = this.getActiveAiPreset(this.currentConfig);

    const btnDsp = group.querySelector('#btn-preset-all-dsp');
    const btnHybrid = group.querySelector('#btn-preset-hybrid');
    const btnMax = group.querySelector('#btn-preset-all-ai');
    const btnCustom = group.querySelector('#btn-preset-custom');

    btnDsp?.classList.toggle('btn-preset-highlight', activePreset === 'dsp');
    btnHybrid?.classList.toggle('btn-preset-highlight', activePreset === 'hybrid');
    btnMax?.classList.toggle('btn-preset-highlight', activePreset === 'max');
    btnCustom?.classList.toggle('btn-preset-highlight', activePreset === 'custom');
  }
}
