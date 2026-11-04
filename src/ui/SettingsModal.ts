// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Unified Settings & AI Processing Modal (shell)
// El estado y el contrato viven en ./settings/types; cada pestaña
// (General, Web Engine, Cloud BYOK, Companion Bridge) y sus binders
// están en ./settings/tab*. Aquí solo quedan montaje, render y binding
// de la navegación principal.
// ─────────────────────────────────────────────────────────

import type { AiAssistanceConfig } from '../core/types';
import { bridgeClient } from '../core/bridge/BridgeClient';
import { webNeuralEngine } from '../core/ai/WebNeuralEngine';
import { createModalFocusTrap } from './modalFocusTrap';
import type {
  AiSubTab,
  SettingsMainTab,
  SettingsModalContext,
  SettingsModalHandlers,
  SettingsModalState,
  SettingsModalTab,
} from './settings/types';
import { createSettingsModalState } from './settings/types';
import { countActiveAiStages } from './settings/state';
import { renderGeneralTab } from './settings/tabGeneral';
import { renderWebTab } from './settings/tabWeb';
import { renderMasterWebBar } from './settings/webPresets';
import { renderCloudTab } from './settings/tabCloud';
import { renderBridgeTab } from './settings/tabBridge';
import { refreshBridgeModels } from './settings/bridgeModels';
import { ICONS } from './icons';
import { toast } from './notify';
import { getAppLocale, onAppLocaleChange } from '../core/i18n';
import { updateBridgeBadge, updateHardwareBadge } from './settings/badges';
import { bindBridgeTabEvents } from './settings/tabBridge';
import { bindCloudTabEvents } from './settings/tabCloud';
import { bindGeneralTabEvents } from './settings/tabGeneral';
import { bindWebTabEvents } from './settings/tabWeb';

export type {
  AiSubTab,
  SettingsMainTab,
  SettingsModalHandlers,
  SettingsModalTab,
} from './settings/types';

export class SettingsModal {
  private readonly state: SettingsModalState = createSettingsModalState();
  private handlers: SettingsModalHandlers;

  public get currentTab(): SettingsModalTab {
    return this.state.activeMainTab === 'general' ? 'general' : this.state.activeAiSubTab;
  }

  constructor(handlers: SettingsModalHandlers) {
    this.handlers = handlers;
    onAppLocaleChange(() => {
      if (this.state.backdropEl && !this.state.backdropEl.classList.contains('is-hidden')) {
        this.render();
      }
    });
  }

  /** Contexto compartido con las pestañas (estado por referencia). */
  private ctx(): SettingsModalContext {
    return {
      state: this.state,
      handlers: this.handlers,
      rerender: () => this.render(),
      close: () => this.close(),
    };
  }

  public async open(tab: SettingsModalTab = 'general', config?: AiAssistanceConfig): Promise<void> {
      if (config) {
        this.state.currentConfig = { ...config };
      }
      if (tab === 'general') {
        this.state.activeMainTab = 'general';
      } else if (tab === 'ai') {
        this.state.activeMainTab = 'ai';
      } else if (tab === 'web' || tab === 'cloud' || tab === 'bridge') {
        this.state.activeMainTab = 'ai';
        this.state.activeAiSubTab = tab;
      }
      this.state.webGpuStatus = webNeuralEngine.getDeviceStatus();

      if (!this.state.backdropEl) {
        this.state.backdropEl = document.createElement('div');
        this.state.backdropEl.className = 'nmm-modal-backdrop is-hidden';
        document.body.appendChild(this.state.backdropEl);
      }

      // Query storage quota asynchronously
      if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.estimate === 'function') {
        try {
          const est = await navigator.storage.estimate();
          const usage = est.usage ?? 0;
          const quota = est.quota ?? 1;
          this.state.storageEstimate = {
            usage,
            quota,
            percent: Math.min(100, Math.round((usage / quota) * 100)),
          };
        } catch {
          this.state.storageEstimate = null;
        }
      }

      this.render();
      this.state.backdropEl.classList.remove('is-hidden');

      if (!this.state.focusTrap && this.state.backdropEl) {
        this.state.focusTrap = createModalFocusTrap(this.state.backdropEl, {
          onEscape: () => this.close(),
          initialFocusSelector: '#btn-close-settings-modal',
        });
      }
      this.state.focusTrap?.activate();

      // Async init WebGPU status
      void webNeuralEngine.init().then((st) => {
        this.state.webGpuStatus = st;
        updateHardwareBadge(this.state);
      });

      // Bridge status subscription
      this.state.unsubscribeBridge = bridgeClient.subscribe(() => {
        updateBridgeBadge(this.state);
        void refreshBridgeModels(this.ctx());
      });
      void bridgeClient.checkHealth();
      void refreshBridgeModels(this.ctx());
  }

  public close(): void {
      if (this.state.focusTrap) {
        this.state.focusTrap.deactivate();
      }
      if (this.state.unsubscribeBridge) {
        this.state.unsubscribeBridge();
        this.state.unsubscribeBridge = null;
      }
      if (this.state.downloadPollTimer) {
        clearInterval(this.state.downloadPollTimer);
        this.state.downloadPollTimer = null;
      }
      this.state.backdropEl?.classList.add('is-hidden');
  }

  private render(): void {
      if (!this.state.backdropEl) return;
      const cfg = this.state.currentConfig;
      const activeAiCount = countActiveAiStages(this.state);
      const es = getAppLocale() === 'es';

      this.state.backdropEl.innerHTML = `
        <div class="ai-engine-modal-card settings-modal-card" role="dialog" aria-modal="true" aria-label="${es ? 'Ajustes Generales y Configuración de Motor IA' : 'General Settings and AI Engine Configuration'}">
          <!-- Header -->
          <div class="nmm-modal-header ai-modal-header">
            <div class="nmm-modal-header-title">
              <span class="modal-icon">${ICONS.settings}</span>
              <span>${es ? 'AJUSTES Y MOTOR IA' : 'SETTINGS &amp; AI ENGINE'}</span>
              <span class="panel-badge ${cfg.enabled ? 'badge-ai-on' : 'badge-muted'}" id="ai-active-badge">
                ${cfg.enabled ? (es ? `IA: ${activeAiCount}/8 ETAPAS` : `AI: ${activeAiCount}/8 STAGES`) : (es ? '100% DSP (IA OFF)' : 'PURE DSP (AI OFF)')}
              </span>
            </div>
            <button type="button" class="nmm-modal-close" id="btn-close-settings-modal" title="${es ? 'Cerrar (Esc)' : 'Close (Esc)'}">
              ${ICONS.close}
            </button>
          </div>

          <!-- Primary Navigation Tabs (General | IA) -->
          <div class="ai-tabs-nav modal-primary-tabs">
            <button type="button" class="primary-tab-btn ${this.state.activeMainTab === 'general' ? 'is-active' : ''}" data-main-tab="general">
              <span class="primary-tab-icon">${ICONS.sliders}</span>
              <div class="primary-tab-text">
                <span class="primary-tab-title">General</span>
                <span class="primary-tab-tag">${es ? 'Temas, Idioma y Rutas' : 'Themes, Language &amp; Paths'}</span>
              </div>
            </button>
            <button type="button" class="primary-tab-btn ${this.state.activeMainTab === 'ai' ? 'is-active' : ''}" data-main-tab="ai">
              <span class="primary-tab-icon">${ICONS.cpu}</span>
              <div class="primary-tab-text">
                <span class="primary-tab-title">${es ? 'IA' : 'AI'}</span>
                <span class="primary-tab-tag">${es ? 'Motor Web, Cloud BYOK y GPU Local' : 'Web Engine, Cloud BYOK &amp; Local GPU'}</span>
              </div>
            </button>
          </div>

          <!-- AI Engine Sub-tabs (Visible only when in IA tab) -->
          ${
            this.state.activeMainTab === 'ai'
              ? `
            <div class="ai-subtabs-nav">
              <button type="button" class="ai-subtab-btn ${this.state.activeAiSubTab === 'web' ? 'is-active' : ''}" data-ai-subtab="web">
                <span class="subtab-icon">${ICONS.cpu}</span>
                <div class="subtab-text">
                  <span class="subtab-title">${es ? 'Motor Web Integrado' : 'Built-in Web Engine'}</span>
                  <span class="subtab-tag">${es ? 'En Navegador (100% Gratis)' : 'In-Browser (100% Free)'}</span>
                </div>
              </button>
              <button type="button" class="ai-subtab-btn ${this.state.activeAiSubTab === 'bridge' ? 'is-active' : ''}" data-ai-subtab="bridge">
                <span class="subtab-icon">${ICONS.database}</span>
                <div class="subtab-text">
                  <span class="subtab-title">Companion Bridge</span>
                  <span class="subtab-tag">${es ? 'GPU Local (VRAM)' : 'Local GPU (VRAM)'}</span>
                </div>
              </button>
              <button type="button" class="ai-subtab-btn ${this.state.activeAiSubTab === 'cloud' ? 'is-active' : ''}" data-ai-subtab="cloud">
                <span class="subtab-icon">${ICONS.cloud}</span>
                <div class="subtab-text">
                  <span class="subtab-title">${es ? 'IA en la Nube (BYOK)' : 'Cloud AI (BYOK)'}</span>
                  <span class="subtab-tag">${es ? 'Claves Privadas del Usuario' : 'Private User Keys'}</span>
                </div>
              </button>
            </div>
          `
              : ''
          }

          <!-- Master Switch & Presets Bar (Shown in Web Tab under IA) -->
          ${this.state.activeMainTab === 'ai' && this.state.activeAiSubTab === 'web' ? renderMasterWebBar(cfg) : ''}

          <!-- Tab Body -->
          <div class="modal-body ai-modal-body">
            ${this.state.activeMainTab === 'general' ? renderGeneralTab(this.ctx()) : ''}
            ${this.state.activeMainTab === 'ai' && this.state.activeAiSubTab === 'web' ? renderWebTab(this.ctx(), cfg) : ''}
            ${this.state.activeMainTab === 'ai' && this.state.activeAiSubTab === 'cloud' ? renderCloudTab(this.ctx()) : ''}
            ${this.state.activeMainTab === 'ai' && this.state.activeAiSubTab === 'bridge' ? renderBridgeTab(this.ctx()) : ''}
          </div>

          <!-- Footer -->
          <div class="nmm-modal-footer ai-modal-footer">
            <div class="ai-footer-info">
              <span class="text-muted" id="ai-footer-device-status">
                ${this.state.webGpuStatus?.statusMessage || (es ? 'Motor de procesamiento listo y en línea.' : 'Processing engine ready and online.')}
              </span>
            </div>
            <div class="footer-right ai-footer-actions">
              <button type="button" class="btn btn-secondary" id="btn-cancel-settings-modal">${es ? 'Cerrar' : 'Close'}</button>
              <button type="button" class="btn btn-primary" id="btn-apply-settings-modal">${es ? 'Aplicar Ajustes' : 'Apply Settings'}</button>
            </div>
          </div>
        </div>
      `;

      this.bindEvents();
  }

  private bindEvents(): void {
      if (!this.state.backdropEl) return;

      // Close buttons
      this.state.backdropEl.querySelector('#btn-close-settings-modal')?.addEventListener('click', () => this.close());
      this.state.backdropEl.querySelector('#btn-cancel-settings-modal')?.addEventListener('click', () => this.close());

      // Apply button
      this.state.backdropEl.querySelector('#btn-apply-settings-modal')?.addEventListener('click', () => {
        this.handlers.onUpdateAiConfig({ ...this.state.currentConfig });
        this.close();
        toast('Settings saved and applied successfully', 'success');
      });

      // Primary Tab Navigation (General | IA)
      this.state.backdropEl.querySelectorAll<HTMLButtonElement>('.primary-tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const mainTab = btn.dataset.mainTab as SettingsMainTab;
          if (mainTab && mainTab !== this.state.activeMainTab) {
            this.state.activeMainTab = mainTab;
            this.render();
          }
        });
      });

      // AI Sub-tab Navigation (Web | Cloud | Bridge)
      this.state.backdropEl.querySelectorAll<HTMLButtonElement>('.ai-subtab-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const subtab = btn.dataset.aiSubtab as AiSubTab;
          if (subtab && subtab !== this.state.activeAiSubTab) {
            this.state.activeAiSubTab = subtab;
            this.render();
          }
        });
      });

      if (this.state.activeMainTab === 'general') {
        bindGeneralTabEvents(this.ctx());
      } else {
        if (this.state.activeAiSubTab === 'web') {
          bindWebTabEvents(this.ctx());
        } else if (this.state.activeAiSubTab === 'cloud') {
          bindCloudTabEvents(this.ctx());
        } else if (this.state.activeAiSubTab === 'bridge') {
          bindBridgeTabEvents(this.ctx());
        }
      }
  }
}
