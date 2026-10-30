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

export interface SettingsModalHandlers {
  onUpdateAiConfig: (config: AiAssistanceConfig) => void;
  onSelectThemeFamily: (family: string) => void;
  onSetThemeMode: (mode: 'light' | 'dark') => void;
  onSetWorkingMode: (mode: WorkingMode) => void;
  getCurrentThemeFamily?: () => string;
  getCurrentThemeMode?: () => 'light' | 'dark';
  getCurrentWorkingMode?: () => WorkingMode;
}

export type SettingsModalTab = 'general' | 'web' | 'cloud' | 'bridge';

const STORAGE_KEY_BANK_PATH = 'neumodmakr_bank_path';
const DEFAULT_BANK_PATH = 'd:\\desarrollos\\ABDSynths\\_RESOURCES\\Soundfonts';

const STORAGE_KEY_AXIONIK_DB_PATH = 'abd_axionikdb_path';
const DEFAULT_AXIONIK_DB_PATH = 'd:\\desarrollos\\ABDSynths\\AxionikDB';

const STORAGE_KEY_NEURON_DB_PATH = 'abd_neurondb_path';
const DEFAULT_NEURON_DB_PATH = 'd:\\desarrollos\\ABDSynths\\NeuronDB';

export class SettingsModal {
  private backdropEl: HTMLElement | null = null;
  private currentConfig: AiAssistanceConfig = {
    enabled: false,
    masterWave: 'dsp',
    separation: 'dsp',
    loopExpansion: 'dsp',
    classifier: 'dsp',
    denoise: 'dsp',
  };
  private currentTab: SettingsModalTab = 'general';
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
    this.currentTab = tab;
    this.webGpuStatus = webNeuralEngine.getDeviceStatus();

    if (!this.backdropEl) {
      this.backdropEl = document.createElement('div');
      this.backdropEl.className = 'modal-backdrop is-hidden';
      document.body.appendChild(this.backdropEl);
    }

    this.render();
    this.backdropEl.classList.remove('is-hidden');

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
      <div class="process-modal-card ai-engine-modal-card settings-modal-card" role="dialog" aria-modal="true" aria-label="Ajustes Generales y Motor de Procesamiento">
        <!-- Header -->
        <div class="modal-header ai-modal-header">
          <div class="modal-title">
            <span class="modal-icon">${ICONS.settings}</span>
            <span>CONFIGURACIÓN &amp; MOTOR IA</span>
            <span class="panel-badge ${cfg.enabled ? 'badge-ai-on' : 'badge-muted'}" id="ai-active-badge">
              ${cfg.enabled ? `IA: ${activeAiCount}/5 ETAPAS` : 'DSP PURO (IA OFF)'}
            </span>
          </div>
          <button type="button" class="btn btn-close-modal" id="btn-close-settings-modal" title="Cerrar (Esc)">
            ${ICONS.close}
          </button>
        </div>

        <!-- Mode Navigation Tabs -->
        <div class="ai-tabs-nav">
          <button type="button" class="ai-tab-btn ${this.currentTab === 'general' ? 'is-active' : ''}" data-tab="general">
            <span class="ai-tab-icon">${ICONS.sliders}</span>
            <span class="ai-tab-title">General</span>
            <span class="ai-tab-tag">Tema, Modo y Rutas</span>
          </button>
          <button type="button" class="ai-tab-btn ${this.currentTab === 'web' ? 'is-active' : ''}" data-tab="web">
            <span class="ai-tab-icon">${ICONS.cpu}</span>
            <span class="ai-tab-title">Motor Web Integrado</span>
            <span class="ai-tab-tag">De Serie (100% Gratis)</span>
          </button>
          <button type="button" class="ai-tab-btn ${this.currentTab === 'cloud' ? 'is-active' : ''}" data-tab="cloud">
            <span class="ai-tab-icon">${ICONS.cloud}</span>
            <span class="ai-tab-title">Cloud AI (BYOK)</span>
            <span class="ai-tab-tag">Clave Personal</span>
          </button>
          <button type="button" class="ai-tab-btn ${this.currentTab === 'bridge' ? 'is-active' : ''}" data-tab="bridge">
            <span class="ai-tab-icon">${ICONS.database}</span>
            <span class="ai-tab-title">Companion Bridge</span>
            <span class="ai-tab-tag">GPU Local (VRAM)</span>
          </button>
        </div>

        <!-- Master Switch & Presets Bar (Shown in Web Tab) -->
        ${this.currentTab === 'web' ? this.renderMasterWebBar(cfg) : ''}

        <!-- Tab Body -->
        <div class="modal-body ai-modal-body">
          ${this.currentTab === 'general' ? this.renderGeneralTab() : ''}
          ${this.currentTab === 'web' ? this.renderWebTab(cfg) : ''}
          ${this.currentTab === 'cloud' ? this.renderCloudTab() : ''}
          ${this.currentTab === 'bridge' ? this.renderBridgeTab() : ''}
        </div>

        <!-- Footer -->
        <div class="modal-footer ai-modal-footer">
          <div class="ai-footer-info">
            <span class="text-muted" id="ai-footer-device-status">
              ${this.webGpuStatus?.statusMessage || 'Motor preparado y en línea.'}
            </span>
          </div>
          <div class="ai-footer-actions">
            <button type="button" class="btn btn-secondary" id="btn-cancel-settings-modal">Cerrar</button>
            <button type="button" class="btn btn-primary" id="btn-apply-settings-modal">Aplicar Configuración</button>
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
      { id: 'neuron', name: 'Hartmann Neuron', desc: 'Hardware original (2002), perillas grises y display azul' },
      { id: 'virus-snow', name: 'Access Virus Snow', desc: 'Estética blanca inmaculada estilo módulo desktop (2008)' },
      { id: 'audiolab', name: 'AudioLab Precision', desc: 'Diseño clínico de alta precisión y máximo contraste visual' },
      { id: 'ms2000', name: 'Korg MS2000', desc: 'Panel azul verdoso retro analógico de modelado físico' },
      { id: 'advanced', name: 'Hartmann Advanced', desc: 'Edición especial ampliada con acentos ámbar' },
      { id: 'cz101', name: 'Casio CZ-101', desc: 'Panel clásico de síntesis de distorsión de fase (1984)' },
    ];

    return `
      <div class="settings-general-container">
        <!-- 1. Apariencia y Hardware Skin -->
        <div class="settings-section-card">
          <div class="settings-card-header">
            <h4>${ICONS.palette} Familia de Hardware Skin &amp; Sintetizador</h4>
            <span class="text-muted">Personaliza la estética visual inspirada en máquinas míticas.</span>
          </div>
          <div class="settings-skins-grid">
            ${skinFamilies
              .map(
                (s) => `
              <label class="settings-skin-opt ${curFamily === s.id ? 'is-selected' : ''}">
                <input type="radio" name="opt-theme-family" value="${s.id}" ${curFamily === s.id ? 'checked' : ''} />
                <div class="skin-opt-body">
                  <strong>${s.name}</strong>
                  <small class="text-muted">${s.desc}</small>
                </div>
              </label>
            `
              )
              .join('')}
          </div>

          <div class="settings-appearance-mode-row">
            <span class="settings-sublabel">Modo de Luminosidad:</span>
            <div class="mode-pill-toggle">
              <button type="button" class="btn btn-sm ${curMode === 'light' ? 'btn-primary' : 'btn-outline'}" id="btn-set-mode-light">
                ${ICONS.sun} Modo Claro
              </button>
              <button type="button" class="btn btn-sm ${curMode === 'dark' ? 'btn-primary' : 'btn-outline'}" id="btn-set-mode-dark">
                ${ICONS.moon} Modo Oscuro
              </button>
            </div>
          </div>
        </div>

        <!-- 2. Modo de Trabajo y Creación (Working Mode) -->
        <div class="settings-section-card">
          <div class="settings-card-header">
            <h4>${ICONS.piano} Modo de Creación y Mapeo del Teclado</h4>
            <span class="text-muted">Define cómo se construyen y organizan las zonas y capas de velocidad.</span>
          </div>
          <div class="settings-working-mode-grid">
            <label class="settings-mode-opt ${curWorkingMode === 'classic' ? 'is-selected' : ''}">
              <input type="radio" name="opt-working-mode" value="classic" ${curWorkingMode === 'classic' ? 'checked' : ''} />
              <div class="mode-opt-body">
                <div class="mode-opt-title">
                  <strong>Modo Clásico (Hartmann Neuron 2002)</strong>
                  <span class="panel-badge badge-muted">1:1 Hardware Original</span>
                </div>
                <p class="text-muted">
                  Columnas contiguas de teclado <code>0..127</code> sin huecos ni solapamientos. Dos capas de velocidad fijas en el valor <code>64</code> (Low y High). Nombres de modelo limitados estrictamente a 11 caracteres para compatibilidad con la pantalla del sintetizador físico.
                </p>
              </div>
            </label>

            <label class="settings-mode-opt ${curWorkingMode === 'extended' ? 'is-selected' : ''}">
              <input type="radio" name="opt-working-mode" value="extended" ${curWorkingMode === 'extended' ? 'checked' : ''} />
              <div class="mode-opt-body">
                <div class="mode-opt-title">
                  <strong>Modo Extendido (Modern Neural / Next-Gen)</strong>
                  <span class="panel-badge badge-ai-on">HD Multi-Capa</span>
                </div>
                <p class="text-muted">
                  Mapeo 2D libre tipo sampler profesional (Key &times; Velocity). Múltiples velocidades por nota, crossfades dinámicos, envolventes DAHDSR, bucles ping-pong y artwork de modelo en WebP 512&times;512.
                </p>
              </div>
            </label>
          </div>

          <div class="settings-mode-reassurance-box">
            <span class="reassurance-icon">${ICONS.check}</span>
            <div class="reassurance-text">
              <strong>Compatibilidad Bidireccional Segura y No Destructiva:</strong>
              <p>
                Puedes cambiar de modo libremente en cualquier momento. Si has añadido capas en Modo Extendido y vuelves a Modo Clásico, los datos extendidos <strong>no se borran</strong>: el compilador inteligente proyecta y compensa matemáticamente las ganancias relativas (<span class="math-snippet">10<sup>&Delta;G/20</sup></span>) para reproducir el balance sonoro exacto dentro de los límites del hardware original.
              </p>
            </div>
          </div>
        </div>

        <!-- 3. Carpetas de Bancos y Archivos Locales -->
        <div class="settings-section-card">
          <div class="settings-card-header">
            <h4>${ICONS.folder} Carpetas de Librería Local (AxionikDB, NeuronDB &amp; Recursos)</h4>
            <span class="text-muted">Configura las rutas a tus librerías locales para sincronizarlas con el Companion Bridge.</span>
          </div>

          <div class="settings-libraries-container">
            <!-- 1. AxionikDB (Modo Avanzado) -->
            <div class="library-path-card">
              <div class="library-path-header">
                <strong>Librería AxionikDB (Modo Avanzado / Time-Capsule)</strong>
                <span class="text-muted">Modelos con slugs semánticos y Time Capsule auto-contenida (<code>manifest.json</code> + <code>cover.webp</code>).</span>
              </div>
              <div class="bank-path-input-wrap">
                <input type="text" id="input-axionikdb-path" class="form-control" value="${savedAxionikDbPath}" placeholder="${DEFAULT_AXIONIK_DB_PATH}" />
                <button type="button" class="btn btn-primary" id="btn-scan-axionikdb-dir" ${isBridgeOnline ? '' : 'disabled'}>
                  ${ICONS.search} ${this.isScanningAxionik ? 'Escaneando...' : 'Escanear AxionikDB'}
                </button>
              </div>
            </div>

            <!-- 2. NeuronDB (Modo Clásico) -->
            <div class="library-path-card" style="margin-top: 12px;">
              <div class="library-path-header">
                <strong>Librería NeuronDB (Modo Clásico / Hartmann 000..511)</strong>
                <span class="text-muted">Bancos compatibles con sintetizador Hartmann Neuron original y emulador clásico.</span>
              </div>
              <div class="bank-path-input-wrap">
                <input type="text" id="input-neurondb-path" class="form-control" value="${savedNeuronDbPath}" placeholder="${DEFAULT_NEURON_DB_PATH}" />
                <button type="button" class="btn btn-outline" id="btn-scan-neurondb-dir" ${isBridgeOnline ? '' : 'disabled'}>
                  ${ICONS.search} ${this.isScanningNeuronDb ? 'Escaneando...' : 'Escanear NeuronDB'}
                </button>
              </div>
            </div>

            <!-- 3. Recursos SoundFonts / Raw Samples -->
            <div class="library-path-card" style="margin-top: 12px;">
              <div class="library-path-header">
                <strong>Colección SoundFonts y Muestras Raw</strong>
                <span class="text-muted">Fuentes de muestras acústicas (.sf2, .sfz, .wav) para importación directa.</span>
              </div>
              <div class="bank-path-input-wrap">
                <input type="text" id="input-bank-path" class="form-control" value="${savedBankPath}" placeholder="${DEFAULT_BANK_PATH}" />
                <button type="button" class="btn btn-outline" id="btn-scan-bank-dir" ${isBridgeOnline ? '' : 'disabled'}>
                  ${ICONS.search} ${this.isScanning ? 'Escaneando...' : 'Escanear Muestras'}
                </button>
              </div>
            </div>

            ${
              !isBridgeOnline
                ? `<p class="bank-bridge-offline-hint text-muted" style="margin-top: 10px;">
                    Para explorar carpetas locales sin límites del navegador, inicia el Companion Bridge (<code>bridge/server.py</code>).
                  </p>`
                : ''
            }
          </div>

          <!-- Scan Results Area -->
          <div id="settings-scan-results-wrap" class="settings-scan-results-wrap">
            ${this.buildScanResultsHtml()}
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
            <strong>Modelos detectados en AxionikDB:</strong>
            <span class="panel-badge badge-success">${this.axionikScanResults.length} modelos</span>
          </div>
          <div class="scan-files-list">
            ${this.axionikScanResults
              .slice(0, 30)
              .map(
                (m) => `
              <div class="scan-file-row">
                <span class="scan-file-name"><strong>${m.name}</strong> <small class="text-muted">(${m.slug})</small></span>
                <span class="scan-file-size text-muted">${m.category} &bull; Set ${m.parameterSet} &bull; ${m.zoneCount} zonas</span>
                <span class="scan-file-ext">${m.hasCover ? 'Cover OK' : 'No cover'}</span>
              </div>
            `
              )
              .join('')}
            ${
              this.axionikScanResults.length > 30
                ? `<div class="scan-more text-muted">+${this.axionikScanResults.length - 30} modelos adicionales disponibles en el explorador de bancos.</div>`
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
            <strong>Archivos encontrados en NeuronDB (<code>${this.neuronDbScanResults.scanned_path}</code>):</strong>
            <span class="panel-badge badge-success">${this.neuronDbScanResults.total_files} archivos</span>
          </div>
          <div class="scan-files-list">
            ${this.neuronDbScanResults.files
              .slice(0, 30)
              .map(
                (f) => `
              <div class="scan-file-row">
                <span class="scan-file-name">${f.name}</span>
                <span class="scan-file-size text-muted">${Math.round(f.size / 1024)} KB</span>
                <span class="scan-file-ext">${f.ext}</span>
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
          <strong>Archivos encontrados en <code>${this.scanResults.scanned_path}</code>:</strong>
          <span class="panel-badge badge-success">${this.scanResults.total_files} archivos</span>
        </div>
        <div class="scan-files-list">
          ${this.scanResults.files
            .slice(0, 30)
            .map(
              (f) => `
            <div class="scan-file-row">
              <span class="scan-file-name">${f.name}</span>
              <span class="scan-file-size text-muted">${Math.round(f.size / 1024)} KB</span>
              <span class="scan-file-ext">${f.ext}</span>
            </div>
          `
            )
            .join('')}
          ${
            this.scanResults.total_files > 30
              ? `<div class="scan-more text-muted">+${this.scanResults.total_files - 30} archivos adicionales disponibles en el explorador de bancos.</div>`
              : ''
          }
        </div>
      </div>
    `;
  }

  private renderMasterWebBar(cfg: AiAssistanceConfig): string {
    return `
      <div class="ai-master-bar">
        <div class="ai-master-toggle-wrap">
          <label class="toggle-switch-label" for="ai-master-toggle">
            <input type="checkbox" id="ai-master-toggle" ${cfg.enabled ? 'checked' : ''} />
            <span class="toggle-slider"></span>
            <span class="toggle-title">Habilitar Asistencia por IA</span>
          </label>
          <span class="ai-master-hint text-muted">
            (Si está apagado, el 100% de los procesos se ejecutan con algoritmos matemáticos deterministas en WebAudio)
          </span>
        </div>

        <div class="ai-presets-group">
          <span class="presets-label">Perfiles Rápidos:</span>
          <button type="button" class="btn btn-sm btn-preset" id="btn-preset-all-dsp" title="Todo por algoritmos matemáticos clásicos (rápido y determinista)">
            ${ICONS.cpu} 100% DSP
          </button>
          <button type="button" class="btn btn-sm btn-preset btn-preset-highlight" id="btn-preset-hybrid" title="Mezcla óptima recomendada (DSP Sinc + Separación y Outpainting IA)">
            ${ICONS.zap} Híbrido Óptimo
          </button>
          <button type="button" class="btn btn-sm btn-preset btn-preset-ai" id="btn-preset-all-ai" title="Todas las etapas asistidas por IA">
            ${ICONS.ai} Máxima Calidad IA
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
            <strong>Aceleración de Hardware del Navegador</strong>
            <span id="ai-hw-desc">${this.webGpuStatus?.statusMessage ?? 'Detectando capacidades WebGPU/WASM...'}</span>
          </div>
        </div>
        <div class="ai-hw-guarantee">
          <span>0 Servidores</span> &bull; <span>0 Coste</span> &bull; <span>100% Privado en Cliente</span>
        </div>
      </div>

      <div class="ai-stages-matrix">
        <!-- 1. Master Wave -->
        <div class="stage-card">
          <div class="stage-header">
            <span class="stage-num">1</span>
            <div class="stage-info">
              <h4 class="stage-title">Master Wave Standard (24-bit / 96 kHz)</h4>
              <p class="stage-desc text-muted">Remuestreo de alta fidelidad y reconstrucción de frecuencias armónicas superiores.</p>
            </div>
          </div>
          <div class="stage-options">
            <label class="stage-opt ${cfg.masterWave === 'dsp' ? 'is-selected' : ''}">
              <input type="radio" name="opt-master-wave" value="dsp" ${cfg.masterWave === 'dsp' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.cpu} Algorítmico (DSP)</strong>
                <small>Sinc polifásico lineal + saturador armónico. Cero artefactos de red, fase coherente.</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.masterWave === 'ai' ? 'is-selected' : ''}">
              <input type="radio" name="opt-master-wave" value="ai" ${cfg.masterWave === 'ai' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.ai} Extensión Neuronal (AudioSR)</strong>
                <small>Difusión latente que genera armónicos ultra-agudos realistas hasta 48 kHz Nyquist.</small>
              </span>
            </label>
          </div>
        </div>

        <!-- 2. Source Separation -->
        <div class="stage-card">
          <div class="stage-header">
            <span class="stage-num">2</span>
            <div class="stage-info">
              <h4 class="stage-title">Separación de Fuentes y Desangrado (De-bleeding)</h4>
              <p class="stage-desc text-muted">Aislar el instrumento solista si la muestra contiene sangrado de micrófono o ruido.</p>
            </div>
          </div>
          <div class="stage-options">
            <label class="stage-opt ${cfg.separation === 'dsp' ? 'is-selected' : ''}">
              <input type="radio" name="opt-separation" value="dsp" ${cfg.separation === 'dsp' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.cpu} Algorítmico (HPSS)</strong>
                <small>Separación armónico/percusiva por filtrado de medianas sobre el espectrograma STFT.</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.separation === 'ai' ? 'is-selected' : ''}">
              <input type="radio" name="opt-separation" value="ai" ${cfg.separation === 'ai' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.ai} Separador IA (Demucs v4)</strong>
                <small>Aislamiento quirúrgico por red neuronal convolucional residual.</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.separation === 'bypass' ? 'is-selected' : ''}">
              <input type="radio" name="opt-separation" value="bypass" ${cfg.separation === 'bypass' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.bypass} Bypass / Directo</strong>
                <small>No separar; utilizar la muestra original tal cual fue grabada.</small>
              </span>
            </label>
          </div>
        </div>

        <!-- 3. Loop Expansion -->
        <div class="stage-card">
          <div class="stage-header">
            <span class="stage-num">3</span>
            <div class="stage-info">
              <h4 class="stage-title">Expansión Orgánica de Bucles Cortos</h4>
              <p class="stage-desc text-muted">Desenrollar samples con loops diminutos para generar sustain natural sin zumbidos.</p>
            </div>
          </div>
          <div class="stage-options">
            <label class="stage-opt ${cfg.loopExpansion === 'dsp' ? 'is-selected' : ''}">
              <input type="radio" name="opt-loop-expansion" value="dsp" ${cfg.loopExpansion === 'dsp' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.cpu} Algorítmico (Ventana Circular)</strong>
                <small>Modulación periódica de fase y crossfade de igual potencia en cruces por cero.</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.loopExpansion === 'ai' ? 'is-selected' : ''}">
              <input type="radio" name="opt-loop-expansion" value="ai" ${cfg.loopExpansion === 'ai' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.ai} Outpainting Neuronal</strong>
                <small>Síntesis generativa autorregresiva de continuación tímbrica infinita.</small>
              </span>
            </label>
          </div>
        </div>

        <!-- 4. Classifier -->
        <div class="stage-card">
          <div class="stage-header">
            <span class="stage-num">4</span>
            <div class="stage-info">
              <h4 class="stage-title">Clasificador de Parámetros y Familia Acústica</h4>
              <p class="stage-desc text-muted">Selección automática del Parameter Set 0..9 y etiquetado de instrumentos.</p>
            </div>
          </div>
          <div class="stage-options">
            <label class="stage-opt ${cfg.classifier === 'dsp' ? 'is-selected' : ''}">
              <input type="radio" name="opt-classifier" value="dsp" ${cfg.classifier === 'dsp' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.cpu} Algorítmico (Descriptores)</strong>
                <small>Ataque logarítmico, inarmonicidad B, centroide espectral y tasa de cruce por cero.</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.classifier === 'ai' ? 'is-selected' : ''}">
              <input type="radio" name="opt-classifier" value="ai" ${cfg.classifier === 'ai' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.ai} Clasificador Neuronal</strong>
                <small>Reconocimiento tímbrico profundo por embeddings acústicos en WebGPU.</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.classifier === 'manual' ? 'is-selected' : ''}">
              <input type="radio" name="opt-classifier" value="manual" ${cfg.classifier === 'manual' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.bypass} Selección Manual</strong>
                <small>Elegir manualmente el Parameter Set 0..9 en el panel principal.</small>
              </span>
            </label>
          </div>
        </div>

        <!-- 5. Denoise -->
        <div class="stage-card">
          <div class="stage-header">
            <span class="stage-num">5</span>
            <div class="stage-info">
              <h4 class="stage-title">Reducción de Ruido y Restauración</h4>
              <p class="stage-desc text-muted">Supresión de soplido de cinta analógica y ruido de fondo de grabaciones antiguas.</p>
            </div>
          </div>
          <div class="stage-options">
            <label class="stage-opt ${cfg.denoise === 'dsp' ? 'is-selected' : ''}">
              <input type="radio" name="opt-denoise" value="dsp" ${cfg.denoise === 'dsp' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.cpu} Algorítmico (Puerta Multibanda)</strong>
                <small>Atenuación estática según suelo de ruido sin alterar la fase musical.</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.denoise === 'ai' ? 'is-selected' : ''}">
              <input type="radio" name="opt-denoise" value="ai" ${cfg.denoise === 'ai' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.ai} Denoise IA (DeepFilter)</strong>
                <small>Filtrado neuronal adaptativo que preserva los armónicos sutiles del instrumento.</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.denoise === 'bypass' ? 'is-selected' : ''}">
              <input type="radio" name="opt-denoise" value="bypass" ${cfg.denoise === 'bypass' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.bypass} Desactivado / Crudo</strong>
                <small>Preservar la grabación íntegra sin aplicar ningún reductor de ruido.</small>
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

    return `
      <div class="ai-byok-container">
        <!-- Privacy & Direct Billing Guarantee Banner -->
        <div class="byok-guarantee-card">
          <div class="guarantee-icon">${ICONS.lock}</div>
          <div class="guarantee-content">
            <h4>Garantía Estricta de Privacidad y Coste Cero para el Servidor</h4>
            <p>
              Tus claves API se almacenan <strong>única y exclusivamente en tu navegador (localStorage)</strong>.
              Jamás se envían ni se guardan en ningún servidor de ABDSynths. Todas las solicitudes viajan de forma directa desde tu navegador hacia el proveedor oficial, y los costes de computación de la GPU Cloud se cargan a tu cuenta personal.
            </p>
          </div>
        </div>

        <!-- BYOK Config Form -->
        <div class="byok-form-card">
          <div class="byok-header-row">
            <label class="toggle-switch-label" for="byok-enable-toggle">
              <input type="checkbox" id="byok-enable-toggle" ${byok.enabled ? 'checked' : ''} />
              <span class="toggle-slider"></span>
              <span class="toggle-title">Habilitar Cloud AI (BYOK)</span>
            </label>
            <span class="byok-status-pill ${byok.enabled ? 'is-active' : 'is-inactive'}">
              ${byok.enabled ? 'Cloud AI Habilitado' : 'Cloud AI Inactivo'}
            </span>
          </div>

          <div class="byok-field-group">
            <label class="byok-field-label">Proveedor Cloud Preferido:</label>
            <div class="byok-provider-grid">
              <label class="byok-provider-opt ${byok.provider === 'replicate' ? 'is-selected' : ''}">
                <input type="radio" name="byok-provider" value="replicate" ${byok.provider === 'replicate' ? 'checked' : ''} />
                <span class="provider-title">Replicate</span>
                <span class="provider-desc">Ideal para AudioSR (Super-resolución a 96kHz) y MusicGen.</span>
              </label>
              <label class="byok-provider-opt ${byok.provider === 'huggingface' ? 'is-selected' : ''}">
                <input type="radio" name="byok-provider" value="huggingface" ${byok.provider === 'huggingface' ? 'checked' : ''} />
                <span class="provider-title">Hugging Face (Inference API)</span>
                <span class="provider-desc">Acceso a miles de checkpoints abiertos y aceleradores serverless.</span>
              </label>
              <label class="byok-provider-opt ${byok.provider === 'gemini' ? 'is-selected' : ''}">
                <input type="radio" name="byok-provider" value="gemini" ${byok.provider === 'gemini' ? 'checked' : ''} />
                <span class="provider-title">Google Gemini (AI Studio)</span>
                <span class="provider-desc">Análisis y razonamiento multimodal de espectros y descriptores.</span>
              </label>
            </div>
          </div>

          <div class="byok-field-group">
            <label class="byok-field-label" for="byok-api-key-input">
              Clave de API (${byok.provider === 'replicate' ? 'Replicate API Token' : byok.provider === 'huggingface' ? 'HF User Access Token' : 'Gemini API Key'}):
            </label>
            <div class="byok-input-row">
              <div class="byok-input-wrap">
                <input
                  type="${this.showPassword ? 'text' : 'password'}"
                  id="byok-api-key-input"
                  class="form-control byok-key-field"
                  placeholder="Introduce tu clave personal (p. ej. r8_... / hf_... / AIzaSy...)"
                  value="${currentToken}"
                  autocomplete="off"
                  spellcheck="false"
                />
                <button type="button" class="btn btn-icon byok-toggle-visibility" id="btn-toggle-key-visibility" title="Mostrar/ocultar clave">
                  ${this.showPassword ? ICONS.eyeOff : ICONS.eye}
                </button>
              </div>
              <button type="button" class="btn btn-secondary" id="btn-test-byok" ${this.isTestingByok ? 'disabled' : ''}>
                ${this.isTestingByok ? `${ICONS.spinner} Verificando...` : `${ICONS.zap} Verificar Clave`}
              </button>
              <button type="button" class="btn btn-outline" id="btn-clear-byok" title="Borrar clave del almacenamiento local">
                ${ICONS.trash}
              </button>
            </div>
            <small class="text-muted byok-help-hint">
              ${
                byok.provider === 'replicate'
                  ? 'Obtén tu token personal en <a href="https://replicate.com/account/api-tokens" target="_blank" rel="noopener">replicate.com/account/api-tokens</a>.'
                  : byok.provider === 'huggingface'
                    ? 'Obtén tu token en <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noopener">huggingface.co/settings/tokens</a>.'
                    : 'Obtén tu clave gratuita en <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener">aistudio.google.com</a>.'
              }
            </small>
          </div>

          ${
            this.byokTestResult
              ? `
            <div class="byok-test-banner ${this.byokTestResult.success ? 'is-success' : 'is-error'}">
              <span class="test-icon">${this.byokTestResult.success ? ICONS.check : ICONS.alert}</span>
              <span class="test-msg">${this.byokTestResult.message}</span>
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
              <strong>Companion Bridge Local (Python &amp; GPU)</strong>
            </div>
            <span class="bridge-badge">${isOnline ? 'EN LÍNEA (7860)' : 'DESCONECTADO'}</span>
          </div>

          <div class="bridge-details-grid">
            <div class="bridge-detail-item">
              <span class="detail-label">Endpoint Local:</span>
              <span class="detail-value"><code>${bridge.url}</code></span>
            </div>
            <div class="bridge-detail-item">
              <span class="detail-label">Dispositivo Hardware:</span>
              <span class="detail-value">${bridge.capabilities?.device ?? 'N/A'} (${bridge.capabilities?.gpu_name || 'CPU Fallback'})</span>
            </div>
            <div class="bridge-detail-item">
              <span class="detail-label">Aceleración GPU:</span>
              <span class="detail-value">${bridge.capabilities?.gpu ? 'Activada (CUDA / VRAM)' : 'Desactivada'}</span>
            </div>
            <div class="bridge-detail-item">
              <span class="detail-label">Latencia Loopback:</span>
              <span class="detail-value">${bridge.latencyMs ?? 0} ms</span>
            </div>
          </div>

          ${
            !isOnline
              ? `
            <div class="bridge-offline-instructions">
              <p>
                El Companion Bridge permite conectar tu navegador (incluso desde Vercel) a tu GPU dedicada local (por ejemplo, RTX 3070 8GB VRAM) para ejecutar modelos pesados a coste cero y sin subir audio a servidores remotos.
                Para arrancarlo, ejecuta en tu terminal:
              </p>
              <pre class="bridge-code-snippet"><code>start.bat  (Arranca la app y el Bridge minimizado)
o bien:
python bridge/server.py</code></pre>
              <div class="bridge-retry-row">
                <button type="button" class="btn btn-sm btn-outline" id="btn-bridge-retry">
                  ${ICONS.refresh} Reintentar Conexión Ahora
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
              <h4>Catálogo de Modelos Neuronales Locales</h4>
              <p class="text-muted">
                Pre-descarga transparente multihilo directamente a tu GPU local.
                <br/>
                <small style="opacity: 0.85;">(Nota: Si no los descargas aquí, el sistema los descargará de forma 100% transparente y automática la primera vez que actives su función en el proyecto).</small>
              </p>
            </div>
            <button type="button" class="btn btn-xs btn-outline" id="btn-refresh-models">
              ${ICONS.refresh} Actualizar Lista
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
          Conecta el Companion Bridge en local para gestionar, descargar o desinstalar modelos neuronales en tu GPU.
        </div>
      `;
    }

    if (this.bridgeModels.length === 0) {
      return `
        <div class="models-empty-state text-muted">
          Cargando catálogo de modelos disponibles...
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
        <div class="model-row-card ${m.installed ? 'is-installed' : ''}" data-model-id="${m.id}">
          <div class="model-row-main">
            <div class="model-row-title">
              <strong>${m.name}</strong>
              <span class="model-size-badge">${sizeDisplay}</span>
              <span class="model-task-badge">${m.task}</span>
              ${m.is_custom_url ? '<span class="model-custom-url-badge" title="URL personalizada en uso">Mirror Custom</span>' : ''}
            </div>
            <p class="model-row-desc text-muted">${m.description}</p>
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
                <div class="url-editor-label">URL de descarga del modelo:</div>
                <div class="url-editor-input-row">
                  <input type="text" class="form-control input-custom-model-url" data-id="${m.id}" value="${m.url || ''}" placeholder="${m.default_url || ''}" />
                  <button type="button" class="btn btn-xs btn-primary btn-save-model-url" data-id="${m.id}">Guardar</button>
                  <button type="button" class="btn btn-xs btn-outline btn-reset-model-url" data-id="${m.id}">Restablecer Oficial</button>
                  <button type="button" class="btn btn-xs btn-secondary btn-cancel-model-url" data-id="${m.id}">Cancelar</button>
                </div>
              </div>
            `
                : ''
            }
          </div>
          <div class="model-row-action">
            <button type="button" class="btn btn-xs btn-outline btn-toggle-url-editor" data-id="${m.id}" title="Configurar URL / Mirror de descarga">
              ${ICONS.settings} URL
            </button>
            ${
              m.installed
                ? `
                <span class="badge-installed">${ICONS.check} Instalado en Disco</span>
                <button type="button" class="btn btn-sm btn-outline btn-delete-model" data-id="${m.id}" title="Eliminar este modelo del disco para liberar espacio">
                  ${ICONS.trash} Desinstalar
                </button>
              `
                : isDownloading
                  ? `<button type="button" class="btn btn-sm btn-outline btn-downloading" disabled>
                      <span class="btn-spinner">${ICONS.spinner}</span>
                      <span>Descargando (${pct}%)...</span>
                    </button>`
                  : `<button type="button" class="btn btn-sm btn-primary btn-download-model" data-id="${m.id}">
                      ${ICONS.zap} Descargar (${sizeDisplay})
                    </button>`
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
      toast('Configuración guardada y aplicada con éxito', 'success');
    });

    // Tab Navigation
    this.backdropEl.querySelectorAll<HTMLButtonElement>('.ai-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab as SettingsModalTab;
        if (tab && tab !== this.currentTab) {
          this.currentTab = tab;
          this.render();
        }
      });
    });

    if (this.currentTab === 'general') {
      this.bindGeneralTabEvents();
    } else if (this.currentTab === 'web') {
      this.bindWebTabEvents();
    } else if (this.currentTab === 'cloud') {
      this.bindCloudTabEvents();
    } else if (this.currentTab === 'bridge') {
      this.bindBridgeTabEvents();
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
          toast(`Modo de creación cambiado a: ${mode === 'classic' ? 'Clásico (1:1 Hardware)' : 'Extendido (HD Multi-Capa)'}`, 'info');
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
        toast(`AxionikDB escaneado: ${this.axionikScanResults.length} modelos encontrados`, 'success');
      } catch (err) {
        toast(`Error al escanear AxionikDB: ${String(err)}`, 'error');
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
        toast(`NeuronDB escaneado: ${this.neuronDbScanResults.total_files} archivos encontrados`, 'success');
      } catch (err) {
        toast(`Error al escanear NeuronDB: ${String(err)}`, 'error');
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
        toast(`Escaneo completado: ${this.scanResults.total_files} archivos encontrados`, 'success');
      } catch (err) {
        toast(`Error al escanear directorio: ${String(err)}`, 'error');
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
      toast('Perfil aplicado: 100% DSP Matemático Clásico', 'info');
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
      toast('Perfil aplicado: Híbrido Óptimo (DSP Sinc + IA en Outpainting/Denoise)', 'success');
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
      toast('Perfil aplicado: Máxima Calidad Asistida por IA (5/5 etapas)', 'success');
    });

    // Stage radio changes
    const bindRadio = (name: string, setter: (val: string) => void) => {
      this.backdropEl?.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach((r) => {
        r.addEventListener('change', () => {
          if (r.checked) {
            setter(r.value);
            this.syncActiveBadge();
            this.syncOptionSelectionClasses();
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
      toast('Claves borradas del almacenamiento local del navegador', 'info');
    });
  }

  private bindBridgeTabEvents(): void {
    if (!this.backdropEl) return;

    this.backdropEl.querySelector('#btn-bridge-retry')?.addEventListener('click', async () => {
      toast('Comprobando Companion Bridge...', 'info');
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
        toast(`Iniciando descarga multihilo de "${m?.name || modelId}" en el Bridge...`, 'info');

        try {
          await bridgeClient.downloadModel(modelId);
          this.startModelProgressPolling(modelId);
        } catch (err) {
          this.activePollingModelIds.delete(modelId);
          if (m) {
            m.status = 'error';
          }
          toast(`Error al iniciar descarga: ${String(err)}`, 'error');
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
          `¿Deseas desinstalar "${m?.name || modelId}" de tu disco local para liberar espacio?`
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
          toast(`Modelo desinstalado: ${res.freed_mb ?? 0} MB liberados en disco`, 'info');
          this.renderBridgeModelsList();
        } catch (err) {
          toast(`Error al desinstalar modelo: ${String(err)}`, 'error');
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
          toast('URL del modelo actualizada correctamente', 'success');
        } catch (err) {
          toast(`Error al actualizar URL: ${String(err)}`, 'error');
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
          toast('URL restablecida a la fuente oficial', 'info');
        } catch (err) {
          toast(`Error al restablecer URL: ${String(err)}`, 'error');
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
              toast(`Modelo "${model.name}" descargado y listo en disco / GPU`, 'success');
            } else if (prog.status === 'error') {
              this.activePollingModelIds.delete(mId);
              toast(`Fallo en la descarga de "${model.name}": ${prog.error ?? 'Error de red'}`, 'error');
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
        ? `IA: ${activeAiCount}/5 ETAPAS`
        : 'DSP PURO (IA OFF)';
    }
  }

  private syncOptionSelectionClasses(): void {
    if (!this.backdropEl) return;
    this.backdropEl.querySelectorAll('.stage-opt').forEach((label) => {
      const input = label.querySelector<HTMLInputElement>('input[type="radio"]');
      label.classList.toggle('is-selected', Boolean(input?.checked));
    });
  }
}
