// ─────────────────────────────────────────────────────────
// ABDShared — AiProviderSettingsPanel
// Configuration panel for Local LLM (Ollama, LM Studio) & Cloud BYOK
// ─────────────────────────────────────────────────────────

import { LocalLlmClient } from '../../Code/AiCore/LocalLlmClient.js';
import { CloudByokClient, CLOUD_PROVIDER_METADATA } from '../../Code/AiCore/CloudByokClient.js';
import { SHARED_LOCALES } from '../I18n/index.js';

function normalizeByokProvider(provider) {
  if (!provider) return 'gemini';
  return provider === 'anthropic' ? 'claude' : provider;
}

function escapeAttr(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export class AiProviderSettingsPanel {
  constructor(options = {}) {
    this.container = options.container;
    this.localClient = options.localClient || new LocalLlmClient();
    this.byokClient = options.byokClient || new CloudByokClient();
    this.onSave = options.onSave || (() => {});
    this.i18n = options.i18n || (typeof window !== 'undefined' && window.__audiolab_i18n ? window.__audiolab_i18n : null);

    if (this.container) {
      this.render();
      this.setupListeners();
    }
  }

  t(key, fallback = '') {
    if (this.i18n && typeof this.i18n.t === 'function') {
      const res = this.i18n.t(key);
      if (res && res !== key) return res;
    }
    let loc = 'es';
    try {
      if (this.i18n && typeof this.i18n.getLocale === 'function') loc = this.i18n.getLocale();
      else if (typeof localStorage !== 'undefined') loc = localStorage.getItem('abdaudiolab.locale') || localStorage.getItem('abdsynths.locale') || 'es';
    } catch (_) {}
    const dict = SHARED_LOCALES[loc] || SHARED_LOCALES.es;
    const parts = key.split('.');
    let cur = dict;
    for (const p of parts) {
      if (cur && typeof cur === 'object' && p in cur) cur = cur[p];
      else { cur = null; break; }
    }
    if (typeof cur === 'string') return cur;
    return fallback || key;
  }

  setLocale(locale) {
    if (this.i18n && typeof this.i18n.setLocale === 'function') {
      this.i18n.setLocale(locale);
    }
    this.render();
    this.setupListeners();
  }

  render() {
    if (!this.container) return;
    const localCfg = this.localClient.getConfig ? this.localClient.getConfig() : {};
    const byokCfg = this.byokClient.getConfig ? this.byokClient.getConfig() : {};
    const activeProvider = normalizeByokProvider(byokCfg.provider);
    const activeKey = this.byokClient.getActiveApiKey
      ? this.byokClient.getActiveApiKey(activeProvider)
      : (byokCfg[CLOUD_PROVIDER_METADATA[activeProvider]?.keyField] || '');
    const keyPlaceholder = CLOUD_PROVIDER_METADATA[activeProvider]?.keyPlaceholder || this.t('copilot.apiKeyPlaceholder', 'Introduce tu clave API...');

    this.container.innerHTML = `
      <div class="abd-ai-settings-card">
        <h3 class="abd-ai-settings-title">${this.t('copilot.aiSettingsTitle', 'Configuración de Asistente IA')}</h3>
        
        <section class="abd-ai-settings-section">
          <h4>${this.t('copilot.localLlmHeading', 'LLM Local (Ollama / LM Studio)')}</h4>
          <div class="abd-ai-form-group">
            <label for="ai-local-provider">${this.t('copilot.localProviderLabel', 'Proveedor Local:')}</label>
            <select id="ai-local-provider" class="abd-ai-input">
              <option value="ollama" ${localCfg.preset === 'ollama' ? 'selected' : ''}>Ollama (http://127.0.0.1:11434)</option>
              <option value="lmstudio" ${localCfg.preset === 'lmstudio' ? 'selected' : ''}>LM Studio (http://127.0.0.1:1234)</option>
              <option value="custom" ${localCfg.preset === 'custom' ? 'selected' : ''}>${this.t('copilot.customOption', 'Personalizado')}</option>
            </select>
          </div>
          <div class="abd-ai-form-group">
            <label for="ai-local-url">${this.t('copilot.baseUrlLabel', 'URL Base:')}</label>
            <input type="text" id="ai-local-url" class="abd-ai-input" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" value="${escapeAttr(localCfg.baseUrl || '')}" placeholder="http://127.0.0.1:11434" />
          </div>
          <div class="abd-ai-form-group">
            <label for="ai-local-model">${this.t('copilot.localModelLabel', 'Modelo Local:')}</label>
            <input type="text" id="ai-local-model" class="abd-ai-input" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" value="${escapeAttr(localCfg.activeModel || '')}" placeholder="mistral, llama3, qwen2.5-coder..." />
            <button type="button" class="abd-copilot-btn-secondary" id="btn-ai-test-local">${this.t('copilot.testConnBtn', 'Probar conexión')}</button>
          </div>
          <div id="ai-local-status" class="abd-ai-status-row"></div>
        </section>

        <section class="abd-ai-settings-section">
          <h4>${this.t('copilot.cloudByokHeading', 'Cloud BYOK (Trae tu propia clave)')}</h4>
          <div class="abd-ai-form-group">
            <label for="ai-byok-provider">${this.t('copilot.cloudProviderLabel', 'Proveedor Cloud:')}</label>
            <select id="ai-byok-provider" class="abd-ai-input">
              <option value="gemini" ${activeProvider === 'gemini' ? 'selected' : ''}>Google Gemini</option>
              <option value="openai" ${activeProvider === 'openai' ? 'selected' : ''}>OpenAI</option>
              <option value="claude" ${activeProvider === 'claude' ? 'selected' : ''}>Anthropic Claude</option>
              <option value="openrouter" ${activeProvider === 'openrouter' ? 'selected' : ''}>OpenRouter</option>
              <option value="groq" ${activeProvider === 'groq' ? 'selected' : ''}>Groq</option>
              <option value="deepseek" ${activeProvider === 'deepseek' ? 'selected' : ''}>DeepSeek</option>
              <option value="mistral" ${activeProvider === 'mistral' ? 'selected' : ''}>Mistral</option>
            </select>
          </div>
          <div class="abd-ai-form-group">
            <label for="ai-byok-key">${this.t('copilot.apiKeyLabel', 'API Key:')}</label>
            <input type="password" id="ai-byok-key" class="abd-ai-input" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" value="${escapeAttr(activeKey)}" placeholder="${escapeAttr(keyPlaceholder)}" />
          </div>
          <div class="abd-ai-form-group">
            <label for="ai-byok-storage">${this.t('copilot.keyPersistenceLabel', 'Persistencia de Claves:')}</label>
            <select id="ai-byok-storage" class="abd-ai-input">
              <option value="session" ${byokCfg.storageScope === 'session' ? 'selected' : ''}>${this.t('copilot.sessionOnlyOption', 'Solo en sesión (RAM/SessionStorage)')}</option>
              <option value="local" ${byokCfg.storageScope !== 'session' ? 'selected' : ''}>${this.t('copilot.localStorageOption', 'LocalStorage persistente')}</option>
            </select>
          </div>
        </section>

        <div class="abd-ai-actions-row">
          <button type="button" class="abd-copilot-btn-primary" id="btn-ai-save-settings">${this.t('copilot.saveSettingsBtn', 'Guardar configuración')}</button>
        </div>
      </div>
    `;
  }

  setupListeners() {
    if (!this.container) return;

    this.container.querySelector('#ai-byok-provider')?.addEventListener('change', (ev) => {
      const target = ev.target;
      const provider = normalizeByokProvider(target?.value);
      const keyInput = this.container.querySelector('#ai-byok-key');
      if (keyInput) {
        const meta = CLOUD_PROVIDER_METADATA[provider];
        const cfg = this.byokClient.getConfig ? this.byokClient.getConfig() : {};
        const keyVal = this.byokClient.getActiveApiKey
          ? this.byokClient.getActiveApiKey(provider)
          : (meta ? (cfg[meta.keyField] || '') : '');
        keyInput.value = keyVal || '';
        if (meta?.keyPlaceholder) keyInput.placeholder = meta.keyPlaceholder;
      }
    });

    this.container.querySelector('#btn-ai-test-local')?.addEventListener('click', async () => {
      const statusEl = this.container.querySelector('#ai-local-status');
      if (statusEl) statusEl.textContent = 'Verificando conexion...';
      const res = await this.localClient.checkHealthAndListModels();
      if (statusEl) {
        if (res.connected) {
          statusEl.textContent = `Conexion exitosa. Modelos disponibles: ${(res.models || []).join(', ') || 'OK'}`;
          statusEl.style.color = 'var(--color-success, #34d399)';
        } else {
          statusEl.textContent = `Error de conexion: ${res.error || 'No disponible'}`;
          statusEl.style.color = 'var(--color-danger, #f87171)';
        }
      }
    });

    this.container.querySelector('#btn-ai-save-settings')?.addEventListener('click', () => {
      const localPreset = this.container.querySelector('#ai-local-provider')?.value;
      const localUrl = this.container.querySelector('#ai-local-url')?.value;
      const localModel = this.container.querySelector('#ai-local-model')?.value;

      if (this.localClient.saveToStorage) {
        this.localClient.saveToStorage({
          preset: localPreset,
          baseUrl: localUrl,
          activeModel: localModel
        });
      }

      const byokProvider = normalizeByokProvider(this.container.querySelector('#ai-byok-provider')?.value);
      const byokKey = (this.container.querySelector('#ai-byok-key')?.value || '').trim();
      const byokStorage = this.container.querySelector('#ai-byok-storage')?.value;

      const updateData = {
        provider: byokProvider,
        storageScope: byokStorage
      };
      const keyField = CLOUD_PROVIDER_METADATA[byokProvider]?.keyField;
      if (keyField && byokKey) {
        updateData[keyField] = byokKey;
        updateData.enabled = true;
      }
      if (this.byokClient.saveConfig) {
        this.byokClient.saveConfig(updateData);
      } else if (this.byokClient.saveToStorage) {
        this.byokClient.saveToStorage(updateData);
      }

      if (this.onSave) {
        this.onSave({
          local: this.localClient.getConfig ? this.localClient.getConfig() : {},
          byok: this.byokClient.getConfig ? this.byokClient.getConfig() : {}
        });
      }
    });
  }
}
