// ─────────────────────────────────────────────────────────
// ABDShared — AiProviderSettingsPanel
// Configuration panel for Local LLM (Ollama, LM Studio) & Cloud BYOK
// ─────────────────────────────────────────────────────────

import { LocalLlmClient } from '../../Code/AiCore/LocalLlmClient.js';
import { CloudByokClient } from '../../Code/AiCore/CloudByokClient.js';

export class AiProviderSettingsPanel {
  constructor(options = {}) {
    this.container = options.container;
    this.localClient = options.localClient || new LocalLlmClient();
    this.byokClient = options.byokClient || new CloudByokClient();
    this.onSave = options.onSave || (() => {});

    if (this.container) {
      this.render();
      this.setupListeners();
    }
  }

  render() {
    if (!this.container) return;
    const localCfg = this.localClient.getConfig ? this.localClient.getConfig() : {};
    const byokCfg = this.byokClient.getConfig ? this.byokClient.getConfig() : {};

    this.container.innerHTML = `
      <div class="abd-ai-settings-card">
        <h3 class="abd-ai-settings-title">Configuracion de Asistente IA</h3>
        
        <section class="abd-ai-settings-section">
          <h4>LLM Local (Ollama / LM Studio)</h4>
          <div class="abd-ai-form-group">
            <label for="ai-local-provider">Proveedor Local:</label>
            <select id="ai-local-provider" class="abd-ai-input">
              <option value="ollama" ${localCfg.preset === 'ollama' ? 'selected' : ''}>Ollama (http://127.0.0.1:11434)</option>
              <option value="lmstudio" ${localCfg.preset === 'lmstudio' ? 'selected' : ''}>LM Studio (http://127.0.0.1:1234)</option>
              <option value="custom" ${localCfg.preset === 'custom' ? 'selected' : ''}>Personalizado</option>
            </select>
          </div>
          <div class="abd-ai-form-group">
            <label for="ai-local-url">URL Base:</label>
            <input type="text" id="ai-local-url" class="abd-ai-input" value="${localCfg.baseUrl || ''}" placeholder="http://127.0.0.1:11434" />
          </div>
          <div class="abd-ai-form-group">
            <label for="ai-local-model">Modelo Local:</label>
            <input type="text" id="ai-local-model" class="abd-ai-input" value="${localCfg.activeModel || ''}" placeholder="mistral, llama3, qwen2.5-coder..." />
            <button type="button" class="abd-copilot-btn-secondary" id="btn-ai-test-local">Probar conexion</button>
          </div>
          <div id="ai-local-status" class="abd-ai-status-row"></div>
        </section>

        <section class="abd-ai-settings-section">
          <h4>Cloud BYOK (Trae tu propia clave)</h4>
          <div class="abd-ai-form-group">
            <label for="ai-byok-provider">Proveedor Cloud:</label>
            <select id="ai-byok-provider" class="abd-ai-input">
              <option value="gemini" ${byokCfg.provider === 'gemini' ? 'selected' : ''}>Google Gemini</option>
              <option value="openai" ${byokCfg.provider === 'openai' ? 'selected' : ''}>OpenAI</option>
              <option value="anthropic" ${byokCfg.provider === 'anthropic' ? 'selected' : ''}>Anthropic Claude</option>
              <option value="openrouter" ${byokCfg.provider === 'openrouter' ? 'selected' : ''}>OpenRouter</option>
              <option value="groq" ${byokCfg.provider === 'groq' ? 'selected' : ''}>Groq</option>
            </select>
          </div>
          <div class="abd-ai-form-group">
            <label for="ai-byok-key">API Key:</label>
            <input type="password" id="ai-byok-key" class="abd-ai-input" placeholder="Introduce tu clave API..." />
          </div>
          <div class="abd-ai-form-group">
            <label for="ai-byok-storage">Persistencia de Claves:</label>
            <select id="ai-byok-storage" class="abd-ai-input">
              <option value="session" ${byokCfg.storageScope === 'session' ? 'selected' : ''}>Solo en sesion (RAM/SessionStorage)</option>
              <option value="local" ${byokCfg.storageScope === 'local' ? 'selected' : ''}>LocalStorage persistente</option>
            </select>
          </div>
        </section>

        <div class="abd-ai-actions-row">
          <button type="button" class="abd-copilot-btn-primary" id="btn-ai-save-settings">Guardar configuracion</button>
        </div>
      </div>
    `;
  }

  setupListeners() {
    if (!this.container) return;

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

      const byokProvider = this.container.querySelector('#ai-byok-provider')?.value;
      const byokKey = this.container.querySelector('#ai-byok-key')?.value;
      const byokStorage = this.container.querySelector('#ai-byok-storage')?.value;

      const updateData = {
        provider: byokProvider,
        storageScope: byokStorage
      };
      if (byokKey) {
        updateData.apiKey = byokKey;
      }
      if (this.byokClient.saveToStorage) {
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
