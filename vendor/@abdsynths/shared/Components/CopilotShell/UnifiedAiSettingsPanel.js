// ─────────────────────────────────────────────────────────────────────────────
// ABDShared — UnifiedAiSettingsPanel
// Single shared 4-tab AI configuration panel across the ABDSynths suite
// (ABDNeuModMakr & ABDAudioLab). Zero replicas: apps pass capability flags,
// task descriptors, and their platform bridge for shared local model weights.
// ─────────────────────────────────────────────────────────────────────────────

import { LocalLlmClient } from '../../Code/AiCore/LocalLlmClient.js';
import {
  CloudByokClient,
  CLOUD_PROVIDER_METADATA,
  ALL_CLOUD_PROVIDERS,
} from '../../Code/AiCore/CloudByokClient.js';
import { listCatalogModelsForApp } from '../../Code/AiCore/ModelRegistry.js';

const TAB_IDS = ['tasks', 'local-llm', 'cloud-byok', 'local-models'];

function escapeHtml(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeHttpsHref(url) {
  const raw = String(url ?? '').trim();
  return /^https:\/\//i.test(raw) ? raw : '#';
}

export class UnifiedAiSettingsPanel {
  constructor(options = {}) {
    this.container = options.container || null;
    this.appId = options.appId || 'abdsynths';
    this.locale = this._resolveLocale(options.locale, options.i18n);
    this.i18n = options.i18n || null;
    this.activeTab = TAB_IDS.includes(options.activeTab) ? options.activeTab : 'tasks';

    this.localClient = options.localClient || new LocalLlmClient();
    this.byokClient = options.byokClient || new CloudByokClient();
    this.orchestrator = options.orchestrator || null;

    this.tasksConfig = options.tasksConfig ? { ...options.tasksConfig } : { enabled: false, tasks: {} };
    this.taskDescriptors = Array.isArray(options.taskDescriptors) ? options.taskDescriptors : [];
    this.presets = Array.isArray(options.presets) ? options.presets : [];
    this.safetyNote = options.safetyNote || '';
    this.tasksFooterHtml = options.tasksFooterHtml || '';
    this.onBindTasksFooter = typeof options.onBindTasksFooter === 'function' ? options.onBindTasksFooter : null;

    const caps = Array.isArray(options.supportedByokCapabilities) && options.supportedByokCapabilities.length > 0
      ? options.supportedByokCapabilities
      : ['text', 'image', 'audio-cloud'];
    this.supportedCapabilities = new Set(caps);

    this.companionBridge = options.companionBridge || null;
    this.modelStoreBridge = options.modelStoreBridge || null;

    this.onTabChange = typeof options.onTabChange === 'function' ? options.onTabChange : null;
    this.onTasksChange = typeof options.onTasksChange === 'function' ? options.onTasksChange : null;
    this.onLocalLlmChange = typeof options.onLocalLlmChange === 'function' ? options.onLocalLlmChange : null;
    this.onByokChange = typeof options.onByokChange === 'function' ? options.onByokChange : null;
    this.onSave = typeof options.onSave === 'function' ? options.onSave : null;

    this._detectedLocalModels = [];
    this._localTestStatus = null;
    this._byokStatusByProvider = {};
    this._unmaskedProviders = new Set();
    this._expandedUrlModels = new Set();
    this._workdirStatusMsg = null;

    this._storeStatus = {
      workdir: {
        models_root: '',
        source: 'unknown',
        exists: false,
        writable: false,
        free_gb: null,
      },
      models: listCatalogModelsForApp(this.appId),
      offline: !this.modelStoreBridge,
      loading: Boolean(this.modelStoreBridge),
    };

    this._pollTimers = new Map();
    this._destroyed = false;

    if (this.container) {
      this.render();
      if (this.modelStoreBridge) {
        void this.refreshModelStore();
      }
    }
  }

  _resolveLocale(explicitLocale, i18n) {
    if (explicitLocale) return String(explicitLocale).toLowerCase().startsWith('en') ? 'en' : 'es';
    try {
      if (i18n && typeof i18n.getLocale === 'function') {
        const l = i18n.getLocale();
        return String(l).toLowerCase().startsWith('en') ? 'en' : 'es';
      }
      if (typeof localStorage !== 'undefined') {
        const l = localStorage.getItem('abdaudiolab.locale') || localStorage.getItem('abdsynths.locale') || 'es';
        return String(l).toLowerCase().startsWith('en') ? 'en' : 'es';
      }
    } catch (_) {
      // Ignore storage errors in restricted contexts
    }
    return 'es';
  }

  _txt(es, en) {
    return this.locale === 'en' ? en : es;
  }

  setLocale(nextLocale) {
    const resolved = this._resolveLocale(nextLocale, this.i18n);
    if (resolved === this.locale) return;
    this.locale = resolved;
    this.render();
  }

  updateTasksConfig(nextConfig) {
    this.tasksConfig = nextConfig ? { ...nextConfig } : { enabled: false, tasks: {} };
    this.render();
  }

  updateCompanionBridge(nextBridge) {
    this.companionBridge = nextBridge || null;
    this.render();
  }

  setTasksFooterHtml(html) {
    this.tasksFooterHtml = String(html || '');
    if (this.activeTab === 'tasks') {
      this.render();
    }
  }

  setActiveTab(tabId) {
    if (!TAB_IDS.includes(tabId) || tabId === this.activeTab) return;
    this.activeTab = tabId;
    this.render();
    if (tabId === 'local-models' && this.modelStoreBridge) {
      void this.refreshModelStore();
    }
    if (this.onTabChange) {
      this.onTabChange(tabId);
    }
  }

  async refreshModelStore() {
    if (!this.modelStoreBridge || this._destroyed) return this._storeStatus;
    try {
      const payload = await this.modelStoreBridge.getStatus();
      if (this._destroyed) return payload;
      if (payload && typeof payload === 'object') {
        this._storeStatus = {
          workdir: payload.workdir || this._storeStatus.workdir,
          models: Array.isArray(payload.models) && payload.models.length > 0
            ? payload.models
            : listCatalogModelsForApp(this.appId),
          offline: Boolean(payload.offline),
          error: payload.error || '',
          loading: false,
        };
      }
    } catch (err) {
      this._storeStatus = {
        ...this._storeStatus,
        offline: true,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    this._syncDownloadPolling();
    if (!this._destroyed) {
      this.render();
    }
    return this._storeStatus;
  }

  _syncDownloadPolling() {
    const downloadingIds = new Set(
      (this._storeStatus.models || [])
        .filter((m) => m.download_state?.status === 'downloading')
        .map((m) => m.id)
    );
    for (const [id, timer] of this._pollTimers.entries()) {
      if (!downloadingIds.has(id)) {
        clearInterval(timer);
        this._pollTimers.delete(id);
      }
    }
    if (typeof this.modelStoreBridge?.getDownloadProgress === 'function') {
      for (const id of downloadingIds) {
        this._ensurePollDownload(id);
      }
    }
  }

  _ensurePollDownload(modelId) {
    if (this._pollTimers.has(modelId) || typeof this.modelStoreBridge?.getDownloadProgress !== 'function') return;
    const timer = setInterval(async () => {
      if (this._destroyed) {
        clearInterval(timer);
        this._pollTimers.delete(modelId);
        return;
      }
      try {
        const prog = await this.modelStoreBridge.getDownloadProgress(modelId);
        const list = this._storeStatus.models || [];
        const target = list.find((m) => m.id === modelId);
        if (target && prog) {
          target.download_state = {
            status: prog.status || target.download_state?.status || 'downloading',
            progress: typeof prog.progress === 'number' ? prog.progress : (target.download_state?.progress || 0),
            downloaded_bytes: prog.downloaded_bytes,
            total_bytes: prog.total_bytes,
            speed_mbps: prog.speed_mbps,
            error: prog.error || null,
          };
          if (prog.status === 'ready' || prog.status === 'error' || prog.status === 'missing') {
            clearInterval(timer);
            this._pollTimers.delete(modelId);
            await this.refreshModelStore();
            return;
          }
          this.render();
        }
      } catch (_) {
        clearInterval(timer);
        this._pollTimers.delete(modelId);
      }
    }, 650);
    this._pollTimers.set(modelId, timer);
  }

  destroy() {
    this._destroyed = true;
    for (const timer of this._pollTimers.values()) {
      clearInterval(timer);
    }
    this._pollTimers.clear();
  }

  render() {
    if (!this.container || this._destroyed) return;

    const tabs = [
      { id: 'tasks', label: this._txt('Tareas & Routing IA', 'AI Tasks & Routing') },
      { id: 'local-llm', label: this._txt('LLM Local (Ollama / LM Studio)', 'Local LLM (Ollama / LM Studio)') },
      { id: 'cloud-byok', label: this._txt('Cloud BYOK (APIs)', 'Cloud BYOK (APIs)') },
      { id: 'local-models', label: this._txt('Modelos Locales & Carpeta', 'Local Models & Folder') },
    ];

    const byokConfiguredCount = this.byokClient.getConfig
      ? ALL_CLOUD_PROVIDERS.filter((p) => this.byokClient.hasValidKey?.(p)).length
      : 0;
    const installedModelsCount = (this._storeStatus.models || []).filter((m) => m.installed).length;
    const totalModelsCount = (this._storeStatus.models || []).length;

    const tabHtml = tabs
      .map((tab) => {
        const isSelected = this.activeTab === tab.id;
        return `
          <button
            type="button"
            role="tab"
            id="abd-ai-tab-${tab.id}"
            class="abd-unified-ai-tab ${isSelected ? 'is-active' : ''}"
            data-abd-ai-tab="${tab.id}"
            aria-selected="${isSelected ? 'true' : 'false'}"
            aria-controls="abd-ai-panel-${tab.id}"
            tabindex="${isSelected ? '0' : '-1'}"
          >${escapeHtml(tab.label)}</button>
        `;
      })
      .join('');

    this.container.innerHTML = `
      <div class="abd-unified-ai-root" data-app-id="${escapeHtml(this.appId)}">
        <div class="abd-unified-ai-summary-strip">
          <span class="abd-unified-ai-chip">${escapeHtml(this.appId)}</span>
          <span class="abd-unified-ai-chip ${this.tasksConfig?.enabled ? 'is-on' : ''}">
            ${this.tasksConfig?.enabled
              ? this._txt('Capa IA: ACTIVA', 'AI Layer: ACTIVE')
              : this._txt('Capa IA: 100% DETERMINISTA', 'AI Layer: 100% DETERMINISTIC')}
          </span>
          <span class="abd-unified-ai-chip ${byokConfiguredCount > 0 ? 'is-on' : ''}">
            Cloud BYOK: ${byokConfiguredCount}
          </span>
          <span class="abd-unified-ai-chip ${installedModelsCount > 0 ? 'is-on' : ''}">
            ${this._txt('Modelos locales', 'Local models')}: ${installedModelsCount}/${totalModelsCount}
          </span>
        </div>

        <div class="abd-unified-ai-tabs" role="tablist" aria-label="${escapeHtml(this._txt('Configuración unificada de IA', 'Unified AI Configuration'))}">
          ${tabHtml}
        </div>

        <div
          class="abd-unified-ai-panel"
          role="tabpanel"
          id="abd-ai-panel-tasks"
          aria-labelledby="abd-ai-tab-tasks"
          ${this.activeTab === 'tasks' ? '' : 'hidden'}
        >
          <div class="abd-unified-ai-panel-inner">
            ${this.activeTab === 'tasks' ? this._renderTasksTab() : ''}
          </div>
        </div>

        <div
          class="abd-unified-ai-panel"
          role="tabpanel"
          id="abd-ai-panel-local-llm"
          aria-labelledby="abd-ai-tab-local-llm"
          ${this.activeTab === 'local-llm' ? '' : 'hidden'}
        >
          <div class="abd-unified-ai-panel-inner">
            ${this.activeTab === 'local-llm' ? this._renderLocalLlmTab() : ''}
          </div>
        </div>

        <div
          class="abd-unified-ai-panel"
          role="tabpanel"
          id="abd-ai-panel-cloud-byok"
          aria-labelledby="abd-ai-tab-cloud-byok"
          ${this.activeTab === 'cloud-byok' ? '' : 'hidden'}
        >
          <div class="abd-unified-ai-panel-inner">
            ${this.activeTab === 'cloud-byok' ? this._renderCloudByokTab() : ''}
          </div>
        </div>

        <div
          class="abd-unified-ai-panel"
          role="tabpanel"
          id="abd-ai-panel-local-models"
          aria-labelledby="abd-ai-tab-local-models"
          ${this.activeTab === 'local-models' ? '' : 'hidden'}
        >
          <div class="abd-unified-ai-panel-inner">
            ${this.activeTab === 'local-models' ? this._renderLocalModelsTab() : ''}
          </div>
        </div>
      </div>
    `;

    this._bindEvents();
  }

  _renderTasksTab() {
    const enabled = Boolean(this.tasksConfig?.enabled);
    const taskValues = this.tasksConfig?.tasks || {};
    const banner = this.safetyNote || this._txt(
      'Modo seguro activable por tarea. Desactivar el interruptor maestro deja la app en modo 100% determinista sin inferencia externa. Las opciones aún en desarrollo se marcan explícitamente como PRÓXIMAMENTE.',
      'Per-task opt-in AI routing. Turning off the master switch runs 100% deterministic DSP without external inference. Features still under development are marked COMING SOON.'
    );

    const presetsHtml = this.presets.length > 0
      ? `
        <div class="abd-unified-ai-presets">
          <span class="abd-unified-ai-muted">${this._txt('Perfiles rápidos:', 'Quick presets:')}</span>
          ${this.presets
            .map(
              (p) => `
                <button type="button" class="abd-copilot-btn-secondary" data-abd-ai-preset="${escapeHtml(p.id)}">
                  ${escapeHtml(p.label)}
                </button>
              `
            )
            .join('')}
        </div>
      `
      : '';

    const cardsHtml = this.taskDescriptors.length > 0
      ? this.taskDescriptors
          .map((task) => {
            const currentVal = taskValues[task.id] ?? task.defaultValue ?? task.options?.[0]?.value ?? '';
            const optsHtml = (task.options || [])
              .map((opt) => {
                const isComingSoon = Boolean(opt.comingSoon);
                const isUnused = opt.supportedInApp === false;
                const isDisabled = Boolean(opt.disabled) || isComingSoon || isUnused || !enabled;
                const isChecked = String(currentVal) === String(opt.value);
                const inputId = `abd-task-${task.id}-${opt.value}`;

                return `
                  <label
                    for="${escapeHtml(inputId)}"
                    class="abd-unified-ai-option ${isChecked ? 'is-selected' : ''} ${isComingSoon || isUnused || opt.disabled ? 'is-disabled' : ''}"
                  >
                    <input
                      type="radio"
                      id="${escapeHtml(inputId)}"
                      name="abd-task-${escapeHtml(task.id)}"
                      value="${escapeHtml(opt.value)}"
                      data-abd-task-id="${escapeHtml(task.id)}"
                      data-abd-coming-soon="${isComingSoon ? '1' : '0'}"
                      ${isChecked ? 'checked' : ''}
                      ${isDisabled ? 'disabled' : ''}
                    />
                    <span class="abd-unified-ai-option-body">
                      <span class="abd-unified-ai-option-top">
                        <strong>${escapeHtml(opt.label)}</strong>
                        ${isComingSoon
                          ? `<span class="abd-unified-ai-badge abd-unified-ai-badge-soon">${this._txt('PRÓXIMAMENTE', 'COMING SOON')}</span>`
                          : ''}
                        ${!isComingSoon && isUnused
                          ? `<span class="abd-unified-ai-badge abd-unified-ai-badge-unused">${this._txt('No usado en esta app', 'Not used in this app')}</span>`
                          : ''}
                      </span>
                      ${opt.hint ? `<span class="abd-unified-ai-muted">${escapeHtml(opt.hint)}</span>` : ''}
                    </span>
                  </label>
                `;
              })
              .join('');

            const selectedOpt = (task.options || []).find((o) => String(o.value) === String(currentVal));
            const chipLabel = selectedOpt?.label || String(currentVal);

            return `
              <section class="abd-unified-ai-card">
                <div class="abd-unified-ai-card-head">
                  <div>
                    <h4 class="abd-unified-ai-card-title">${escapeHtml(task.title)}</h4>
                    ${task.description ? `<p class="abd-unified-ai-muted">${escapeHtml(task.description)}</p>` : ''}
                  </div>
                  <span class="abd-unified-ai-chip ${enabled ? 'is-on' : ''}">${escapeHtml(chipLabel)}</span>
                </div>
                <div class="abd-unified-ai-options-grid">
                  ${optsHtml}
                </div>
              </section>
            `;
          })
          .join('')
      : `<p class="abd-unified-ai-muted">${this._txt('No hay tareas IA configuradas en este contexto.', 'No AI tasks registered in this context.')}</p>`;

    return `
      <div class="abd-unified-ai-banner">${escapeHtml(banner)}</div>
      <div class="abd-unified-ai-card">
        <label for="abd-ai-master-enabled" class="abd-unified-ai-switch-row">
          <input type="checkbox" id="abd-ai-master-enabled" ${enabled ? 'checked' : ''} />
          <span>
            <strong>${this._txt('Activar Capa IA Asistida', 'Enable Assisted AI Layer')}</strong>
            <span class="abd-unified-ai-muted">
              ${enabled
                ? this._txt('Las tareas habilitadas pueden usar su motor seleccionado.', 'Enabled tasks can invoke their selected engine.')
                : this._txt('Desactivado: ejecución 100% determinista.', 'Disabled: 100% deterministic execution.')}
            </span>
          </span>
        </label>
        ${presetsHtml}
      </div>
      <div class="abd-unified-ai-tasks-list">
        ${cardsHtml}
      </div>
      ${this.tasksFooterHtml ? `<div class="abd-unified-ai-footer-slot" id="abd-ai-tasks-footer-slot">${this.tasksFooterHtml}</div>` : ''}
    `;
  }

  _renderLocalLlmTab() {
    const localCfg = this.localClient.getConfig ? this.localClient.getConfig() : {
      preset: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      activeModel: '',
    };
    const orchState = this.orchestrator?.getConfig ? this.orchestrator.getConfig() : { engineMode: 'deterministic' };
    const engineMode = orchState.engineMode || 'deterministic';

    const modelOptionsHtml = this._detectedLocalModels.length > 0
      ? `
        <div class="abd-ai-form-group">
          <label for="abd-ai-local-model-select">${this._txt('Modelos detectados en el servidor:', 'Detected models on server:')}</label>
          <select id="abd-ai-local-model-select" class="abd-ai-input">
            <option value="">${this._txt('-- Selecciona un modelo detectado --', '-- Pick a detected model --')}</option>
            ${this._detectedLocalModels
              .map(
                (m) => `
                  <option value="${escapeHtml(m)}" ${localCfg.activeModel === m ? 'selected' : ''}>
                    ${escapeHtml(m)}
                  </option>
                `
              )
              .join('')}
          </select>
        </div>
      `
      : '';

    const statusBadge = this._localTestStatus
      ? `<div id="abd-ai-local-status" class="abd-ai-status-row" style="color:${this._localTestStatus.ok ? 'var(--color-success, #34d399)' : 'var(--color-danger, #f87171)'}">${escapeHtml(this._localTestStatus.message)}</div>`
      : `<div id="abd-ai-local-status" class="abd-ai-status-row"></div>`;

    return `
      <div class="abd-unified-ai-card">
        <h4 class="abd-unified-ai-card-title">${this._txt('Servidor LLM Local (Loopback 127.0.0.1)', 'Local LLM Server (Loopback 127.0.0.1)')}</h4>
        <p class="abd-unified-ai-muted">
          ${this._txt(
            'Conecta con Ollama (:11434), LM Studio (:1234) o un servidor OpenAI-compatible en tu equipo. Restringido por seguridad a direcciones locales loopback.',
            'Connects to Ollama (:11434), LM Studio (:1234) or a local OpenAI-compatible server. Security-restricted to loopback hosts.'
          )}
        </p>

        <div class="abd-ai-form-group">
          <label for="abd-ai-local-preset">${this._txt('Proveedor Local', 'Local Provider')}</label>
          <select id="abd-ai-local-preset" class="abd-ai-input">
            <option value="ollama" ${localCfg.preset === 'ollama' ? 'selected' : ''}>Ollama (http://127.0.0.1:11434)</option>
            <option value="lmstudio" ${localCfg.preset === 'lmstudio' ? 'selected' : ''}>LM Studio (http://127.0.0.1:1234)</option>
            <option value="custom" ${localCfg.preset === 'custom' ? 'selected' : ''}>${this._txt('Personalizado (localhost)', 'Custom (localhost)')}</option>
          </select>
        </div>

        <div class="abd-ai-form-group">
          <label for="abd-ai-local-url">${this._txt('URL Base (Loopback)', 'Base URL (Loopback)')}</label>
          <input
            type="text"
            id="abd-ai-local-url"
            class="abd-ai-input"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="none"
            spellcheck="false"
            value="${escapeHtml(localCfg.baseUrl || 'http://127.0.0.1:11434')}"
            placeholder="http://127.0.0.1:11434"
          />
        </div>

        ${modelOptionsHtml}

        <div class="abd-ai-form-group">
          <label for="abd-ai-local-model">${this._txt('Modelo Activo', 'Active Model')}</label>
          <input
            type="text"
            id="abd-ai-local-model"
            class="abd-ai-input"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="none"
            spellcheck="false"
            value="${escapeHtml(localCfg.activeModel || '')}"
            placeholder="llama3.2, qwen2.5-coder, mistral..."
          />
        </div>

        <div class="abd-ai-form-group">
          <label for="abd-ai-engine-mode">${this._txt('Motor Activo del Copiloto', 'Active Copilot Engine')}</label>
          <select id="abd-ai-engine-mode" class="abd-ai-input">
            <option value="deterministic" ${engineMode === 'deterministic' ? 'selected' : ''}>${this._txt('Determinista (Búsqueda local)', 'Deterministic (Local search)')}</option>
            <option value="local-llm" ${engineMode === 'local-llm' ? 'selected' : ''}>${this._txt('LLM Local (Ollama / LM Studio)', 'Local LLM (Ollama / LM Studio)')}</option>
            <option value="cloud-byok" ${engineMode === 'cloud-byok' ? 'selected' : ''}>${this._txt('Cloud BYOK', 'Cloud BYOK')}</option>
          </select>
        </div>

        ${statusBadge}

        <div class="abd-ai-actions-row">
          <button type="button" class="abd-copilot-btn-secondary" id="abd-ai-local-detect">
            ${this._txt('Detectar Modelos / Probar', 'Detect Models / Test')}
          </button>
          <button type="button" class="abd-copilot-btn-primary" id="abd-ai-local-save">
            ${this._txt('Guardar LLM Local', 'Save Local LLM')}
          </button>
        </div>
      </div>
    `;
  }

  _renderCloudByokTab() {
    const cfg = this.byokClient.getConfig ? this.byokClient.getConfig() : { enabled: false, provider: 'gemini', storageScope: 'local' };
    const scope = this.byokClient.getStorageScope ? this.byokClient.getStorageScope() : (cfg.storageScope || 'local');

    const cardsHtml = ALL_CLOUD_PROVIDERS.map((providerId) => {
      const meta = CLOUD_PROVIDER_METADATA[providerId];
      if (!meta) return '';
      const supported = meta.capabilities.some((cap) => this.supportedCapabilities.has(cap));
      const keyVal = this.byokClient.getActiveApiKey ? this.byokClient.getActiveApiKey(providerId) : '';
      const isConfigured = Boolean(keyVal);
      const isPrimary = cfg.provider === providerId;
      const isUnmasked = this._unmaskedProviders.has(providerId);
      const status = this._byokStatusByProvider[providerId];
      const capsText = meta.capabilities
        .map((cap) => {
          if (cap === 'text') return this._txt('texto', 'text');
          if (cap === 'image') return this._txt('imagen', 'image');
          if (cap === 'audio-cloud') return this._txt('audio cloud', 'cloud audio');
          return cap;
        })
        .join(', ');

      return `
        <section class="abd-unified-ai-provider-card ${isConfigured ? 'is-configured' : ''} ${!supported ? 'abd-unified-ai-provider-unused' : ''}">
          <div class="abd-unified-ai-card-head">
            <div>
              <div class="abd-unified-ai-title-row">
                <h4 class="abd-unified-ai-card-title">${escapeHtml(meta.title)}</h4>
                <span class="abd-unified-ai-badge">${escapeHtml(meta.badge)}</span>
                <span class="abd-unified-ai-badge ${isConfigured ? 'is-ok' : ''}">
                  ${isConfigured ? this._txt('Configurada', 'Configured') : this._txt('Sin clave', 'No key')}
                </span>
                ${isPrimary ? `<span class="abd-unified-ai-badge is-primary">${this._txt('Principal', 'Primary')}</span>` : ''}
                ${!supported ? `<span class="abd-unified-ai-badge abd-unified-ai-badge-unused">${this._txt('No usado en esta app', 'Not used in this app')}</span>` : ''}
              </div>
              <p class="abd-unified-ai-muted">${escapeHtml(this._txt(meta.summaryEs, meta.summaryEn))} (${escapeHtml(capsText)})</p>
            </div>
            <a
              class="abd-copilot-btn-secondary abd-unified-ai-link-btn"
              href="${escapeHtml(safeHttpsHref(meta.consoleUrl))}"
              target="_blank"
              rel="noopener noreferrer"
            >${this._txt('Obtener API Key', 'Get API Key')} ↗</a>
          </div>

          <div class="abd-unified-ai-key-row">
            <label class="abd-unified-ai-sr-only" for="abd-byok-key-${escapeHtml(providerId)}">${escapeHtml(this._txt(`Clave API de ${meta.title}`, meta.keyTitle))}</label>
            <input
              type="${isUnmasked ? 'text' : 'password'}"
              id="abd-byok-key-${escapeHtml(providerId)}"
              class="abd-ai-input"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="none"
              spellcheck="false"
              value="${escapeHtml(keyVal)}"
              placeholder="${escapeHtml(meta.keyPlaceholder)}"
              data-abd-byok-input="${escapeHtml(providerId)}"
              ${!supported ? 'disabled' : ''}
            />
            <button
              type="button"
              class="abd-copilot-btn-secondary"
              data-abd-byok-unmask="${escapeHtml(providerId)}"
              aria-pressed="${isUnmasked ? 'true' : 'false'}"
              aria-label="${escapeHtml(this._txt('Mostrar u ocultar clave API', 'Show or hide API key'))}"
              ${!supported ? 'disabled' : ''}
            >${isUnmasked ? this._txt('Ocultar', 'Hide') : this._txt('Mostrar', 'Show')}</button>
            <button
              type="button"
              class="abd-copilot-btn-primary"
              data-abd-byok-save="${escapeHtml(providerId)}"
              ${!supported ? 'disabled' : ''}
            >${this._txt('Guardar', 'Save')}</button>
            <button
              type="button"
              class="abd-copilot-btn-secondary"
              data-abd-byok-test="${escapeHtml(providerId)}"
              ${!supported ? 'disabled' : ''}
            >${this._txt('Probar', 'Test')}</button>
            <button
              type="button"
              class="abd-copilot-btn-secondary"
              data-abd-byok-clear="${escapeHtml(providerId)}"
              ${!supported || !isConfigured ? 'disabled' : ''}
            >${this._txt('Borrar', 'Clear')}</button>
          </div>
          ${status
            ? `<div class="abd-ai-status-row" style="color:${status.ok ? 'var(--color-success, #34d399)' : 'var(--color-danger, #f87171)'}">${escapeHtml(status.message)}</div>`
            : ''}
        </section>
      `;
    }).join('');

    return `
      <div class="abd-unified-ai-banner">
        ${this._txt(
          'Privacidad estricta BYOK: tus claves se guardan únicamente en el almacenamiento local de tu navegador/sesión y solo salen hacia los endpoints oficiales elegidos.',
          'Strict BYOK privacy: API keys remain strictly inside your browser/session storage and only connect directly to official endpoints.'
        )}
      </div>

      <div class="abd-unified-ai-card abd-unified-ai-byok-controls">
        <label for="abd-ai-byok-enabled" class="abd-unified-ai-switch-row">
          <input type="checkbox" id="abd-ai-byok-enabled" ${cfg.enabled ? 'checked' : ''} />
          <span><strong>${this._txt('Habilitar Cloud BYOK globalmente', 'Enable Cloud BYOK globally')}</strong></span>
        </label>

        <div class="abd-unified-ai-byok-scope">
          <label for="abd-ai-byok-scope">${this._txt('Persistencia de claves:', 'Key persistence:')}</label>
          <select id="abd-ai-byok-scope" class="abd-ai-input">
            <option value="local" ${scope === 'local' ? 'selected' : ''}>${this._txt('Persistente (localStorage)', 'Persistent (localStorage)')}</option>
            <option value="session" ${scope === 'session' ? 'selected' : ''}>${this._txt('Solo sesión (sessionStorage)', 'Session only (sessionStorage)')}</option>
          </select>
          <button type="button" class="abd-copilot-btn-secondary" id="abd-ai-byok-clear-all">
            ${this._txt('Borrar todas las claves', 'Clear all keys')}
          </button>
        </div>
      </div>

      <div class="abd-unified-ai-providers-list">
        ${cardsHtml}
      </div>
    `;
  }

  _renderLocalModelsTab() {
    const workdir = this._storeStatus.workdir || {};
    const models = this._storeStatus.models || listCatalogModelsForApp(this.appId);
    const offline = Boolean(this._storeStatus.offline);

    const sourceLabels = {
      env: this._txt('Variable de entorno (ABDSYNTHS_MODELS_DIR)', 'Environment var (ABDSYNTHS_MODELS_DIR)'),
      custom: this._txt('Ruta personalizada', 'Custom path'),
      dev_resources: this._txt('Carpeta compartida _RESOURCES/AIModels', 'Shared _RESOURCES/AIModels folder'),
      default_documents: this._txt('Documentos/ABDSynths/Models', 'Documents/ABDSynths/Models'),
      unknown: this._txt('Sin verificar', 'Unverified'),
    };

    const companionHtml = this.companionBridge
      ? `
        <section class="abd-unified-ai-card">
          <div class="abd-unified-ai-card-head">
            <div>
              <h4 class="abd-unified-ai-card-title">${escapeHtml(this.companionBridge.title || this._txt('Companion Bridge Local (Python / PyTorch)', 'Local Companion Bridge (Python / PyTorch)'))}</h4>
              <p class="abd-unified-ai-muted">${escapeHtml(this.companionBridge.statusText || '')}</p>
            </div>
            <span class="abd-unified-ai-chip ${this.companionBridge.connected ? 'is-on' : ''}">
              ${this.companionBridge.connected ? this._txt('CONECTADO', 'CONNECTED') : this._txt('DESCONECTADO', 'OFFLINE')}
            </span>
          </div>
          <div class="abd-unified-ai-workdir-row">
            <label class="abd-unified-ai-sr-only" for="abd-ai-bridge-url">${this._txt('URL del Companion Bridge', 'Companion Bridge URL')}</label>
            <input
              type="text"
              id="abd-ai-bridge-url"
              class="abd-ai-input"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="none"
              spellcheck="false"
              value="${escapeHtml(this.companionBridge.url || 'http://127.0.0.1:17420')}"
            />
            <button type="button" class="abd-copilot-btn-primary" id="abd-ai-bridge-connect">
              ${this.companionBridge.connected ? this._txt('Reconectar', 'Reconnect') : this._txt('Conectar', 'Connect')}
            </button>
            ${this.companionBridge.connected && this.companionBridge.onDisconnect
              ? `<button type="button" class="abd-copilot-btn-secondary" id="abd-ai-bridge-disconnect">${this._txt('Desconectar', 'Disconnect')}</button>`
              : ''}
          </div>
          ${this.companionBridge.connected
            ? `<div class="abd-unified-ai-muted" style="margin-top:6px;">GPU: ${escapeHtml(this.companionBridge.cudaAvailable ? this.companionBridge.cudaDevice || 'CUDA' : this._txt('Solo CPU', 'CPU fallback'))} · CPUs: ${escapeHtml(String(this.companionBridge.cpuCount ?? '-'))}</div>`
            : ''}
        </section>
      `
      : '';

    const modelsHtml = models
      .map((m) => {
        const installed = Boolean(m.installed);
        const supported = m.supported_in_app !== false;
        const comingSoon = Boolean(m.coming_soon || !m.inference_wired);
        const dlStatus = m.download_state?.status || (installed ? 'ready' : 'missing');
        const dlProgress = Math.max(0, Math.min(100, Number(m.download_state?.progress || 0)));
        const isDownloading = dlStatus === 'downloading';
        const isUrlOpen = this._expandedUrlModels.has(m.id);
        const canMutate = Boolean(this.modelStoreBridge) && !offline;

        const usedByBadges = (m.used_by || [])
          .map((u) => `<span class="abd-unified-ai-badge">${escapeHtml(u)}</span>`)
          .join('');

        return `
          <section class="abd-unified-ai-model-card ${installed ? 'is-installed' : ''} ${!supported ? 'is-unused' : ''}">
            <div class="abd-unified-ai-card-head">
              <div>
                <div class="abd-unified-ai-title-row">
                  <h4 class="abd-unified-ai-card-title">${escapeHtml(m.name)}</h4>
                  <span class="abd-unified-ai-badge">${escapeHtml(String(m.size_mb))} MB</span>
                  <span class="abd-unified-ai-badge ${installed ? 'is-ok' : ''}">
                    ${installed ? this._txt('Instalado', 'Installed') : this._txt('No descargado', 'Not downloaded')}
                  </span>
                  ${comingSoon
                    ? `<span class="abd-unified-ai-badge abd-unified-ai-badge-soon">${this._txt('PRÓXIMAMENTE', 'COMING SOON')}</span>`
                    : ''}
                  ${!supported
                    ? `<span class="abd-unified-ai-badge abd-unified-ai-badge-unused">${this._txt('No usado en esta app', 'Not used in this app')}</span>`
                    : ''}
                  ${usedByBadges}
                </div>
                <p class="abd-unified-ai-muted">${escapeHtml(this._txt(m.description_es, m.description_en))}</p>
                <div class="abd-unified-ai-model-path">
                  <code>${escapeHtml(m.folder_path || `<modelsRoot>/${m.id}/${m.filename}`)}</code>
                </div>
              </div>

              <div class="abd-unified-ai-model-actions">
                ${!installed
                  ? `<button type="button" class="abd-copilot-btn-primary" data-abd-model-download="${escapeHtml(m.id)}" ${!canMutate || isDownloading ? 'disabled' : ''}>
                      ${isDownloading ? `${this._txt('Descargando', 'Downloading')} ${dlProgress.toFixed(0)}%` : this._txt('Descargar', 'Download')}
                    </button>`
                  : `<button type="button" class="abd-copilot-btn-secondary" data-abd-model-delete="${escapeHtml(m.id)}" ${!canMutate ? 'disabled' : ''}>
                      ${this._txt('Eliminar', 'Delete')}
                    </button>`}
                <button type="button" class="abd-copilot-btn-secondary" data-abd-model-toggle-url="${escapeHtml(m.id)}">
                  ${this._txt('URL', 'URL')}
                </button>
              </div>
            </div>

            ${isDownloading
              ? `<div class="abd-unified-ai-progress-track"><div class="abd-unified-ai-progress-fill" style="width:${dlProgress}%"></div></div>`
              : ''}

            ${m.download_state?.error
              ? `<div class="abd-ai-status-row" style="color:var(--color-danger, #f87171)">${escapeHtml(m.download_state.error)}</div>`
              : ''}

            ${isUrlOpen
              ? `
                <div class="abd-unified-ai-workdir-row" style="margin-top:8px;">
                  <label class="abd-unified-ai-sr-only" for="abd-ai-model-url-${escapeHtml(m.id)}">URL ${escapeHtml(m.name)}</label>
                  <input
                    type="text"
                    id="abd-ai-model-url-${escapeHtml(m.id)}"
                    class="abd-ai-input"
                    autocomplete="off"
                    autocorrect="off"
                    autocapitalize="none"
                    spellcheck="false"
                    value="${escapeHtml(m.url || m.default_url || '')}"
                  />
                  <button
                    type="button"
                    class="abd-copilot-btn-secondary"
                    data-abd-model-save-url="${escapeHtml(m.id)}"
                    ${!canMutate ? 'disabled' : ''}
                  >${this._txt('Guardar URL', 'Save URL')}</button>
                </div>
              `
              : ''}
          </section>
        `;
      })
      .join('');

    return `
      <section class="abd-unified-ai-card">
        <div class="abd-unified-ai-card-head">
          <div>
            <h4 class="abd-unified-ai-card-title">${this._txt('Directorio de Trabajo Compartido de Modelos', 'Shared Models Working Directory')}</h4>
            <p class="abd-unified-ai-muted">
              ${this._txt(
                'ABDNeuModMakr y ABDAudioLab comparten esta carpeta raíz (<ruta>/<model_id>/). Cada modelo se descarga una sola vez y se verifica al instante mediante model_manifest.json.',
                'ABDNeuModMakr and ABDAudioLab share this single root folder (<root>/<model_id>/). Weights download once and verify instantly via model_manifest.json.'
              )}
            </p>
          </div>
          <span class="abd-unified-ai-badge">${escapeHtml(sourceLabels[workdir.source] || workdir.source || 'shared')}</span>
        </div>

        <div class="abd-unified-ai-workdir-row">
          <label class="abd-unified-ai-sr-only" for="abd-ai-workdir-input">${this._txt('Ruta del directorio de modelos', 'Models directory path')}</label>
          <input
            type="text"
            id="abd-ai-workdir-input"
            class="abd-ai-input"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="none"
            spellcheck="false"
            value="${escapeHtml(workdir.models_root || '')}"
            placeholder="D:\\ABDSynths\\Models"
          />
          <button type="button" class="abd-copilot-btn-primary" id="abd-ai-workdir-save" ${!this.modelStoreBridge ? 'disabled' : ''}>
            ${this._txt('Guardar / Crear Ruta', 'Save / Create Path')}
          </button>
          ${typeof this.modelStoreBridge?.browseWorkdir === 'function'
            ? `<button type="button" class="abd-copilot-btn-secondary" id="abd-ai-workdir-browse">${this._txt('Examinar...', 'Browse...')}</button>`
            : ''}
          ${typeof this.modelStoreBridge?.openWorkdir === 'function'
            ? `<button type="button" class="abd-copilot-btn-secondary" id="abd-ai-workdir-open">${this._txt('Abrir Carpeta', 'Open Folder')}</button>`
            : ''}
          ${typeof this.modelStoreBridge?.resetWorkdir === 'function'
            ? `<button type="button" class="abd-copilot-btn-secondary" id="abd-ai-workdir-reset">${this._txt('Por Defecto', 'Reset Default')}</button>`
            : ''}
        </div>

        <div class="abd-unified-ai-muted" style="margin-top:6px;">
          ${workdir.models_root
            ? `${workdir.exists ? this._txt('Carpeta existente', 'Folder exists') : this._txt('Se creará al guardar', 'Will be created on save')} · ${workdir.writable ? this._txt('Con permisos de escritura', 'Writable') : this._txt('Solo lectura / pendiente', 'Read-only / pending')}${typeof workdir.free_gb === 'number' ? ` · ${workdir.free_gb.toFixed(1)} ${this._txt('GB libres', 'GB free')}` : ''}`
            : this._txt('Introduce una ruta para crear tu directorio de trabajo de modelos compartidos.', 'Enter a path to create your shared models working directory.')}
        </div>

        ${this._workdirStatusMsg
          ? `<div id="abd-ai-workdir-status" class="abd-ai-status-row" style="color:${this._workdirStatusMsg.ok ? 'var(--color-success, #34d399)' : 'var(--color-danger, #f87171)'}">${escapeHtml(this._workdirStatusMsg.message)}</div>`
          : ''}
      </section>

      ${companionHtml}

      ${offline
        ? `<div class="abd-unified-ai-banner">${this._txt(
            'El gestor de disco está desconectado o sin responder. Conecta el servicio/backend local para descargar, crear carpetas o borrar pesos.',
            'Local disk manager is offline. Connect the local backend to create folders or download/delete weights.'
          )}</div>`
        : ''}

      <div class="abd-unified-ai-models-list">
        ${modelsHtml}
      </div>
    `;
  }

  _bindEvents() {
    if (!this.container) return;

    // 1. Tabs + ARIA keyboard navigation
    const tabButtons = Array.from(this.container.querySelectorAll('[role="tab"]'));
    tabButtons.forEach((btn, idx) => {
      btn.addEventListener('click', () => {
        const nextTab = btn.getAttribute('data-abd-ai-tab');
        if (nextTab) this.setActiveTab(nextTab);
      });
      btn.addEventListener('keydown', (ev) => {
        let nextIdx = -1;
        if (ev.key === 'ArrowRight') nextIdx = (idx + 1) % tabButtons.length;
        else if (ev.key === 'ArrowLeft') nextIdx = (idx - 1 + tabButtons.length) % tabButtons.length;
        else if (ev.key === 'Home') nextIdx = 0;
        else if (ev.key === 'End') nextIdx = tabButtons.length - 1;
        if (nextIdx >= 0) {
          ev.preventDefault();
          const target = tabButtons[nextIdx];
          const nextTab = target?.getAttribute('data-abd-ai-tab');
          if (nextTab) {
            this.setActiveTab(nextTab);
            this.container.querySelector(`#abd-ai-tab-${nextTab}`)?.focus();
          }
        }
      });
    });

    // 2. Tasks tab handlers
    this.container.querySelector('#abd-ai-master-enabled')?.addEventListener('change', (ev) => {
      this.tasksConfig = {
        ...this.tasksConfig,
        enabled: Boolean(ev.target.checked),
      };
      this.render();
      this.onTasksChange?.(this.tasksConfig);
      this.onSave?.({ tasks: this.tasksConfig });
    });

    this.container.querySelectorAll('[data-abd-ai-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-abd-ai-preset');
        const preset = this.presets.find((p) => p.id === id);
        if (preset && typeof preset.apply === 'function') {
          const nextCfg = preset.apply(this.tasksConfig);
          if (nextCfg) {
            this.tasksConfig = { ...nextCfg };
            this.render();
            this.onTasksChange?.(this.tasksConfig);
            this.onSave?.({ tasks: this.tasksConfig });
          }
        }
      });
    });

    this.container.querySelectorAll('input[data-abd-task-id]').forEach((radio) => {
      radio.addEventListener('change', () => {
        if (radio.getAttribute('data-abd-coming-soon') === '1' || radio.disabled) return;
        const taskId = radio.getAttribute('data-abd-task-id');
        if (!taskId) return;
        this.tasksConfig = {
          ...this.tasksConfig,
          tasks: {
            ...(this.tasksConfig.tasks || {}),
            [taskId]: radio.value,
          },
        };
        this.render();
        this.onTasksChange?.(this.tasksConfig);
        this.onSave?.({ tasks: this.tasksConfig });
      });
    });

    if (this.activeTab === 'tasks' && this.onBindTasksFooter) {
      const slot = this.container.querySelector('#abd-ai-tasks-footer-slot');
      if (slot) this.onBindTasksFooter(slot);
    }

    // 3. Local LLM tab handlers
    this.container.querySelector('#abd-ai-local-preset')?.addEventListener('change', (ev) => {
      const preset = ev.target.value;
      if (this.localClient.setPreset) {
        this.localClient.setPreset(preset);
        const urlEl = this.container.querySelector('#abd-ai-local-url');
        if (urlEl && this.localClient.getConfig) {
          urlEl.value = this.localClient.getConfig().baseUrl || '';
        }
      }
    });

    this.container.querySelector('#abd-ai-local-model-select')?.addEventListener('change', (ev) => {
      const picked = ev.target.value;
      const modelInput = this.container.querySelector('#abd-ai-local-model');
      if (picked && modelInput) {
        modelInput.value = picked;
      }
    });

    this.container.querySelector('#abd-ai-local-detect')?.addEventListener('click', async () => {
      const preset = this.container.querySelector('#abd-ai-local-preset')?.value || 'ollama';
      const baseUrl = this.container.querySelector('#abd-ai-local-url')?.value?.trim() || '';
      const activeModel = this.container.querySelector('#abd-ai-local-model')?.value?.trim() || '';
      this.localClient.saveToStorage?.({ preset, baseUrl, activeModel });

      this._localTestStatus = { ok: true, message: this._txt('Consultando servidor loopback...', 'Querying loopback server...') };
      const statusEl = this.container.querySelector('#abd-ai-local-status');
      if (statusEl) statusEl.textContent = this._localTestStatus.message;

      const res = await this.localClient.checkHealthAndListModels(2500, this.locale);
      if (res.connected) {
        this._detectedLocalModels = Array.isArray(res.models) ? res.models : [];
        if (!activeModel && this._detectedLocalModels.length > 0) {
          this.localClient.saveToStorage?.({ activeModel: this._detectedLocalModels[0] });
        }
        this._localTestStatus = {
          ok: true,
          message: `${this._txt('Conectado. Modelos detectados:', 'Connected. Models found:')} ${this._detectedLocalModels.join(', ') || 'OK'}`,
        };
      } else {
        this._detectedLocalModels = [];
        this._localTestStatus = {
          ok: false,
          message: `${this._txt('No disponible:', 'Unavailable:')} ${res.error || 'Connection error'}`,
        };
      }
      this.render();
    });

    this.container.querySelector('#abd-ai-local-save')?.addEventListener('click', () => {
      const preset = this.container.querySelector('#abd-ai-local-preset')?.value || 'ollama';
      const baseUrl = this.container.querySelector('#abd-ai-local-url')?.value?.trim() || '';
      const activeModel = this.container.querySelector('#abd-ai-local-model')?.value?.trim() || '';
      const engineMode = this.container.querySelector('#abd-ai-engine-mode')?.value || 'deterministic';

      this.localClient.saveToStorage?.({ preset, baseUrl, activeModel });
      this.orchestrator?.saveToStorage?.({ engineMode });
      this._localTestStatus = {
        ok: true,
        message: this._txt('Configuración LLM Local guardada.', 'Local LLM configuration saved.'),
      };
      this.render();

      const localCfg = this.localClient.getConfig ? this.localClient.getConfig() : { preset, baseUrl, activeModel };
      this.onLocalLlmChange?.(localCfg, engineMode);
      this.onSave?.({ local: localCfg, engineMode, byok: this.byokClient.getConfig?.() || {} });
    });

    // 4. Cloud BYOK tab handlers
    this.container.querySelector('#abd-ai-byok-enabled')?.addEventListener('change', (ev) => {
      const enabled = Boolean(ev.target.checked);
      this.byokClient.saveConfig?.({ enabled });
      this.render();
      this.onByokChange?.(this.byokClient.getConfig?.() || {});
    });

    this.container.querySelector('#abd-ai-byok-scope')?.addEventListener('change', (ev) => {
      const scope = ev.target.value === 'session' ? 'session' : 'local';
      if (this.byokClient.setStorageScope) this.byokClient.setStorageScope(scope);
      else this.byokClient.saveConfig?.({ storageScope: scope });
      this.render();
      this.onByokChange?.(this.byokClient.getConfig?.() || {});
    });

    this.container.querySelector('#abd-ai-byok-clear-all')?.addEventListener('click', () => {
      this.byokClient.clearConfig?.();
      this._byokStatusByProvider = {};
      this.render();
      this.onByokChange?.(this.byokClient.getConfig?.() || {});
    });

    this.container.querySelectorAll('[data-abd-byok-unmask]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const provider = btn.getAttribute('data-abd-byok-unmask');
        if (!provider) return;
        if (this._unmaskedProviders.has(provider)) this._unmaskedProviders.delete(provider);
        else this._unmaskedProviders.add(provider);
        this.render();
      });
    });

    this.container.querySelectorAll('[data-abd-byok-save]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const provider = btn.getAttribute('data-abd-byok-save');
        const meta = provider ? CLOUD_PROVIDER_METADATA[provider] : null;
        if (!provider || !meta) return;
        const input = this.container.querySelector(`#abd-byok-key-${provider}`);
        const keyVal = (input?.value || '').trim();
        this.byokClient.saveConfig?.({
          [meta.keyField]: keyVal,
          provider,
          enabled: keyVal ? true : Boolean(this.byokClient.getConfig?.().enabled),
        });
        this._byokStatusByProvider[provider] = {
          ok: Boolean(keyVal),
          message: keyVal
            ? this._txt('Clave guardada localmente.', 'Key saved locally.')
            : this._txt('Clave vacía guardada.', 'Empty key saved.'),
        };
        this.render();
        this.onByokChange?.(this.byokClient.getConfig?.() || {});
        this.onSave?.({ byok: this.byokClient.getConfig?.() || {} });
      });
    });

    this.container.querySelectorAll('[data-abd-byok-clear]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const provider = btn.getAttribute('data-abd-byok-clear');
        const meta = provider ? CLOUD_PROVIDER_METADATA[provider] : null;
        if (!provider || !meta) return;
        this.byokClient.saveConfig?.({ [meta.keyField]: '' });
        this._byokStatusByProvider[provider] = {
          ok: true,
          message: this._txt('Clave eliminada.', 'Key cleared.'),
        };
        this.render();
        this.onByokChange?.(this.byokClient.getConfig?.() || {});
      });
    });

    this.container.querySelectorAll('[data-abd-byok-test]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const provider = btn.getAttribute('data-abd-byok-test');
        const meta = provider ? CLOUD_PROVIDER_METADATA[provider] : null;
        if (!provider || !meta) return;
        const input = this.container.querySelector(`#abd-byok-key-${provider}`);
        const keyVal = (input?.value || '').trim();
        if (keyVal) {
          this.byokClient.saveConfig?.({ [meta.keyField]: keyVal, provider });
        }
        this._byokStatusByProvider[provider] = {
          ok: true,
          message: this._txt('Verificando conexión con API...', 'Verifying API connection...'),
        };
        this.render();

        const res = await this.byokClient.testConnection?.(provider, undefined, this.locale);
        this._byokStatusByProvider[provider] = {
          ok: Boolean(res?.ok ?? res?.success),
          message: `${res?.message || (res?.ok ? 'OK' : 'Error')}${typeof res?.latencyMs === 'number' ? ` (${res.latencyMs} ms)` : ''}`,
        };
        this.render();
      });
    });

    // 5. Local Models & Shared Workdir tab handlers
    this.container.querySelector('#abd-ai-workdir-save')?.addEventListener('click', async () => {
      if (!this.modelStoreBridge) return;
      const input = this.container.querySelector('#abd-ai-workdir-input');
      const nextPath = (input?.value || '').trim();
      if (!nextPath) {
        this._workdirStatusMsg = {
          ok: false,
          message: this._txt('Introduce una ruta válida.', 'Enter a valid path.'),
        };
        this.render();
        return;
      }
      try {
        const payload = await this.modelStoreBridge.setWorkdir(nextPath);
        if (payload?.workdir) {
          this._storeStatus = {
            workdir: payload.workdir,
            models: Array.isArray(payload.models) ? payload.models : this._storeStatus.models,
            offline: Boolean(payload.offline),
            loading: false,
          };
        }
        this._workdirStatusMsg = {
          ok: payload?.ok !== false,
          message: payload?.error || this._txt('Carpeta compartida creada y guardada.', 'Shared folder created and saved.'),
        };
      } catch (err) {
        this._workdirStatusMsg = {
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        };
      }
      this.render();
    });

    this.container.querySelector('#abd-ai-workdir-browse')?.addEventListener('click', async () => {
      if (!this.modelStoreBridge?.browseWorkdir) return;
      const picked = await this.modelStoreBridge.browseWorkdir();
      if (!picked) return;
      const payload = await this.modelStoreBridge.setWorkdir(picked);
      if (payload?.workdir) {
        this._storeStatus = {
          workdir: payload.workdir,
          models: Array.isArray(payload.models) ? payload.models : this._storeStatus.models,
          offline: Boolean(payload.offline),
          loading: false,
        };
      }
      this._workdirStatusMsg = {
        ok: payload?.ok !== false,
        message: payload?.error || this._txt('Nueva carpeta compartida aplicada.', 'New shared folder applied.'),
      };
      this.render();
    });

    this.container.querySelector('#abd-ai-workdir-open')?.addEventListener('click', async () => {
      await this.modelStoreBridge?.openWorkdir?.();
    });

    this.container.querySelector('#abd-ai-workdir-reset')?.addEventListener('click', async () => {
      if (!this.modelStoreBridge?.resetWorkdir) return;
      const payload = await this.modelStoreBridge.resetWorkdir();
      if (payload?.workdir) {
        this._storeStatus = {
          workdir: payload.workdir,
          models: Array.isArray(payload.models) ? payload.models : this._storeStatus.models,
          offline: Boolean(payload.offline),
          loading: false,
        };
      }
      this._workdirStatusMsg = {
        ok: payload?.ok !== false,
        message: payload?.error || this._txt('Ruta restablecida al valor por defecto.', 'Path reset to default.'),
      };
      this.render();
    });

    this.container.querySelector('#abd-ai-bridge-connect')?.addEventListener('click', async () => {
      const url = (this.container.querySelector('#abd-ai-bridge-url')?.value || '').trim();
      if (this.companionBridge?.onConnect) {
        await this.companionBridge.onConnect(url);
        await this.refreshModelStore();
      }
    });

    this.container.querySelector('#abd-ai-bridge-disconnect')?.addEventListener('click', () => {
      this.companionBridge?.onDisconnect?.();
    });

    this.container.querySelectorAll('[data-abd-model-toggle-url]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-abd-model-toggle-url');
        if (!id) return;
        if (this._expandedUrlModels.has(id)) this._expandedUrlModels.delete(id);
        else this._expandedUrlModels.add(id);
        this.render();
      });
    });

    this.container.querySelectorAll('[data-abd-model-save-url]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-abd-model-save-url');
        const url = (this.container.querySelector(`#abd-ai-model-url-${id}`)?.value || '').trim();
        if (!id || !url || !this.modelStoreBridge?.updateModelUrl) return;
        const res = await this.modelStoreBridge.updateModelUrl(id, url);
        if (res?.ok) {
          this._expandedUrlModels.delete(id);
          await this.refreshModelStore();
        } else if (res?.error) {
          this._workdirStatusMsg = { ok: false, message: res.error };
          this.render();
        }
      });
    });

    this.container.querySelectorAll('[data-abd-model-download]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-abd-model-download');
        if (!id || !this.modelStoreBridge?.downloadModel) return;
        const res = await this.modelStoreBridge.downloadModel(id);
        if (res && res.ok === false && res.error) {
          this._workdirStatusMsg = { ok: false, message: res.error };
          this.render();
        } else {
          const item = (this._storeStatus.models || []).find((m) => m.id === id);
          if (item) {
            item.download_state = { status: 'downloading', progress: 1 };
          }
          this._ensurePollDownload(id);
          this.render();
        }
      });
    });

    this.container.querySelectorAll('[data-abd-model-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-abd-model-delete');
        if (!id || !this.modelStoreBridge?.deleteModel) return;
        await this.modelStoreBridge.deleteModel(id);
        await this.refreshModelStore();
      });
    });
  }
}
