import type { CloudAiProvider } from '../../core/ai/CloudByokClient';
import type { SettingsModalContext } from './types';
import { ICONS } from '../icons';
import { cloudByokClient } from '../../core/ai/CloudByokClient';
import { escAttr } from '../escape';
import { escHtml } from '../escape';
import { toast } from '../notify';

export function renderCloudTab(ctx: SettingsModalContext): string {
  const byok = cloudByokClient.getConfig();
  const currentToken =
    byok.provider === 'replicate'
      ? byok.replicateToken ?? ''
      : byok.provider === 'huggingface'
        ? byok.huggingfaceToken ?? ''
        : byok.provider === 'openai'
          ? byok.openaiApiKey ?? ''
          : byok.provider === 'claude'
            ? byok.claudeApiKey ?? ''
            : byok.provider === 'openrouter'
              ? byok.openrouterApiKey ?? ''
              : byok.provider === 'deepseek'
                ? byok.deepseekApiKey ?? ''
                : byok.provider === 'groq'
                  ? byok.groqApiKey ?? ''
                  : byok.provider === 'mistral'
                    ? byok.mistralApiKey ?? ''
                    : byok.geminiApiKey ?? '';

  const providerMeta = {
    replicate: {
      url: 'https://replicate.com/account/api-tokens',
      label: 'Obtain Replicate API Token',
      keyTitle: 'Replicate API Token (r8_...)',
    },
    huggingface: {
      url: 'https://huggingface.co/settings/tokens',
      label: 'Obtain Hugging Face User Token',
      keyTitle: 'HF User Access Token (hf_...)',
    },
    gemini: {
      url: 'https://aistudio.google.com/app/apikey',
      label: 'Get Google AI Studio API Key',
      keyTitle: 'Google Gemini API Key (AIzaSy...)',
    },
    openai: {
      url: 'https://platform.openai.com/api-keys',
      label: 'Get OpenAI API Key',
      keyTitle: 'OpenAI API Key (sk-...)',
    },
    claude: {
      url: 'https://console.anthropic.com/settings/keys',
      label: 'Get Anthropic Claude API Key',
      keyTitle: 'Anthropic Claude API Key (sk-ant-...)',
    },
    openrouter: {
      url: 'https://openrouter.ai/keys',
      label: 'Get OpenRouter API Key',
      keyTitle: 'OpenRouter API Key (sk-or-...)',
    },
    deepseek: {
      url: 'https://platform.deepseek.com/api_keys',
      label: 'Get DeepSeek API Key',
      keyTitle: 'DeepSeek API Key (sk-...)',
    },
    groq: {
      url: 'https://console.groq.com/keys',
      label: 'Get Groq API Key',
      keyTitle: 'Groq API Key (gsk_...)',
    },
    mistral: {
      url: 'https://console.mistral.ai/api-keys',
      label: 'Get Mistral API Key',
      keyTitle: 'Mistral API Key',
    },
  }[byok.provider] ?? {
    url: 'https://replicate.com/account/api-tokens',
    label: 'Obtain API Token',
    keyTitle: 'API Key',
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
      <div class="card byok-form-card">
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

        <fieldset class="conditioned-fieldset" ${!byok.enabled ? 'disabled' : ''}>
          <div class="byok-field-group ${!byok.enabled ? 'is-conditioned-disabled' : ''}">
            <label class="byok-field-label">
              Preferred Cloud Provider:
              ${!byok.enabled ? '<span class="cond-reason-badge">ACTIVA "ENABLE CLOUD AI (BYOK)"</span>' : ''}
            </label>
            <div class="byok-provider-grid">
              <label class="byok-provider-opt ${byok.provider === 'claude' ? 'is-selected' : ''}">
                <input type="radio" name="byok-provider" value="claude" ${byok.provider === 'claude' ? 'checked' : ''} />
                <div class="nmm-title-row">
                  <span class="provider-title">Anthropic Claude</span>
                  <span class="provider-pill-badge">Sonnet &amp; Haiku</span>
                </div>
                <span class="provider-desc">Deep acoustic reasoning, timbre characterization &amp; prompt synthesis.</span>
              </label>
              <label class="byok-provider-opt ${byok.provider === 'openrouter' ? 'is-selected' : ''}">
                <input type="radio" name="byok-provider" value="openrouter" ${byok.provider === 'openrouter' ? 'checked' : ''} />
                <div class="nmm-title-row">
                  <span class="provider-title">OpenRouter</span>
                  <span class="provider-pill-badge">Multi-Model</span>
                </div>
                <span class="provider-desc">Universal gateway to FLUX.1, Claude, GPT-4o, Llama-3 &amp; open models.</span>
              </label>
              <label class="byok-provider-opt ${byok.provider === 'openai' ? 'is-selected' : ''}">
                <input type="radio" name="byok-provider" value="openai" ${byok.provider === 'openai' ? 'checked' : ''} />
                <div class="nmm-title-row">
                  <span class="provider-title">OpenAI / ChatGPT</span>
                  <span class="provider-pill-badge">GPT-4o &amp; DALL-E</span>
                </div>
                <span class="provider-desc">Neural album artwork, structured metadata &amp; timbre tagging.</span>
              </label>
              <label class="byok-provider-opt ${byok.provider === 'gemini' ? 'is-selected' : ''}">
                <input type="radio" name="byok-provider" value="gemini" ${byok.provider === 'gemini' ? 'checked' : ''} />
                <div class="nmm-title-row">
                  <span class="provider-title">Google Gemini</span>
                  <span class="provider-pill-badge">Flash &amp; Imagen 3</span>
                </div>
                <span class="provider-desc">Multimodal spectral analysis, reasoning &amp; Imagen 3 artwork.</span>
              </label>
              <label class="byok-provider-opt ${byok.provider === 'groq' ? 'is-selected' : ''}">
                <input type="radio" name="byok-provider" value="groq" ${byok.provider === 'groq' ? 'checked' : ''} />
                <div class="nmm-title-row">
                  <span class="provider-title">Groq (LPU Speed)</span>
                  <span class="provider-pill-badge">LPU Real-time</span>
                </div>
                <span class="provider-desc">Ultra-fast token inference for instant prompt refinement.</span>
              </label>
              <label class="byok-provider-opt ${byok.provider === 'deepseek' ? 'is-selected' : ''}">
                <input type="radio" name="byok-provider" value="deepseek" ${byok.provider === 'deepseek' ? 'checked' : ''} />
                <div class="nmm-title-row">
                  <span class="provider-title">DeepSeek</span>
                  <span class="provider-pill-badge">R1 Reasoning</span>
                </div>
                <span class="provider-desc">DeepSeek-V3 &amp; R1 deep reasoning for timbre analysis.</span>
              </label>
              <label class="byok-provider-opt ${byok.provider === 'mistral' ? 'is-selected' : ''}">
                <input type="radio" name="byok-provider" value="mistral" ${byok.provider === 'mistral' ? 'checked' : ''} />
                <div class="nmm-title-row">
                  <span class="provider-title">Mistral AI</span>
                  <span class="provider-pill-badge">European AI</span>
                </div>
                <span class="provider-desc">European AI models (Mistral Large, Codestral &amp; Pixtral).</span>
              </label>
              <label class="byok-provider-opt ${byok.provider === 'replicate' ? 'is-selected' : ''}">
                <input type="radio" name="byok-provider" value="replicate" ${byok.provider === 'replicate' ? 'checked' : ''} />
                <div class="nmm-title-row">
                  <span class="provider-title">Replicate</span>
                  <span class="provider-pill-badge">AudioSR GPU</span>
                </div>
                <span class="provider-desc">Best for AudioSR (96kHz Super-Resolution) and MusicGen models.</span>
              </label>
              <label class="byok-provider-opt ${byok.provider === 'huggingface' ? 'is-selected' : ''}">
                <input type="radio" name="byok-provider" value="huggingface" ${byok.provider === 'huggingface' ? 'checked' : ''} />
                <div class="nmm-title-row">
                  <span class="provider-title">Hugging Face</span>
                  <span class="provider-pill-badge">Serverless</span>
                </div>
                <span class="provider-desc">Access to open checkpoints and serverless accelerated inference.</span>
              </label>
            </div>
          </div>

          <div class="byok-field-group ${!byok.enabled ? 'is-conditioned-disabled' : ''}">
            <label class="byok-field-label" for="byok-api-key-input">
              API Key (${escHtml(providerMeta.keyTitle)}):
              ${!byok.enabled ? '<span class="cond-reason-badge">ACTIVA "ENABLE CLOUD AI (BYOK)"</span>' : ''}
            </label>
            <div class="byok-input-row">
              <div class="byok-input-wrap">
                <input
                  type="${ctx.state.showPassword ? 'text' : 'password'}"
                  id="byok-api-key-input"
                  class="form-control byok-key-field"
                  placeholder="Enter your personal key (e.g. sk-... / r8_... / hf_... / AIzaSy...)"
                  value="${escAttr(currentToken)}"
                  autocomplete="new-password"
                  spellcheck="false"
                />
                <button type="button" class="btn btn-icon byok-toggle-visibility" id="btn-toggle-key-visibility" title="Show / hide key">
                  ${ctx.state.showPassword ? ICONS.eyeOff : ICONS.eye}
                </button>
              </div>
              <button type="button" class="btn btn-secondary" id="btn-test-byok" ${ctx.state.isTestingByok || !byok.enabled ? 'disabled' : ''}>
                ${ctx.state.isTestingByok ? `${ICONS.spinner} Verifying...` : `${ICONS.zap} Verify Key`}
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
        </fieldset>

        ${
          ctx.state.byokTestResult
            ? `
          <div class="byok-test-banner ${ctx.state.byokTestResult.success ? 'is-success' : 'is-error'}">
            <span class="test-icon">${ctx.state.byokTestResult.success ? ICONS.check : ICONS.alert}</span>
            <span class="test-msg">${escHtml(ctx.state.byokTestResult.message)}</span>
          </div>
        `
            : ''
        }
      </div>
    </div>
  `;
}

export function bindCloudTabEvents(ctx: SettingsModalContext): void {
  if (!ctx.state.backdropEl) return;

  // Toggle key visibility
  ctx.state.backdropEl.querySelector('#btn-toggle-key-visibility')?.addEventListener('click', () => {
    ctx.state.showPassword = !ctx.state.showPassword;
    ctx.rerender();
  });

  // BYOK Enable toggle
  const enableToggle = ctx.state.backdropEl.querySelector<HTMLInputElement>('#byok-enable-toggle');
  enableToggle?.addEventListener('change', () => {
    cloudByokClient.saveConfig({ enabled: enableToggle.checked });
    ctx.rerender();
  });

  // Provider radio selection
  ctx.state.backdropEl.querySelectorAll<HTMLInputElement>('input[name="byok-provider"]').forEach((r) => {
    r.addEventListener('change', () => {
      if (r.checked) {
        const provider = r.value as CloudAiProvider;
        cloudByokClient.saveConfig({ provider });
        ctx.state.byokTestResult = null;
        ctx.rerender();
      }
    });
  });

  // API Key input change
  const keyInput = ctx.state.backdropEl.querySelector<HTMLInputElement>('#byok-api-key-input');
  keyInput?.addEventListener('input', () => {
    const val = keyInput.value.trim();
    const currentProvider = cloudByokClient.getConfig().provider;
    if (currentProvider === 'replicate') {
      cloudByokClient.saveConfig({ replicateToken: val });
    } else if (currentProvider === 'huggingface') {
      cloudByokClient.saveConfig({ huggingfaceToken: val });
    } else if (currentProvider === 'gemini') {
      cloudByokClient.saveConfig({ geminiApiKey: val });
    } else if (currentProvider === 'openai') {
      cloudByokClient.saveConfig({ openaiApiKey: val });
    } else if (currentProvider === 'claude') {
      cloudByokClient.saveConfig({ claudeApiKey: val });
    } else if (currentProvider === 'openrouter') {
      cloudByokClient.saveConfig({ openrouterApiKey: val });
    } else if (currentProvider === 'deepseek') {
      cloudByokClient.saveConfig({ deepseekApiKey: val });
    } else if (currentProvider === 'groq') {
      cloudByokClient.saveConfig({ groqApiKey: val });
    } else if (currentProvider === 'mistral') {
      cloudByokClient.saveConfig({ mistralApiKey: val });
    }
  });

  // Test connection button
  ctx.state.backdropEl.querySelector('#btn-test-byok')?.addEventListener('click', async () => {
    const provider = cloudByokClient.getConfig().provider;
    const key = keyInput?.value.trim() ?? '';
    ctx.state.isTestingByok = true;
    ctx.state.byokTestResult = null;
    ctx.rerender();

    const result = await cloudByokClient.testConnection(provider, key);
    ctx.state.isTestingByok = false;
    ctx.state.byokTestResult = result;
    ctx.rerender();
  });

  // Clear key button
  ctx.state.backdropEl.querySelector('#btn-clear-byok')?.addEventListener('click', () => {
    cloudByokClient.clearConfig();
    ctx.state.byokTestResult = null;
    ctx.rerender();
    toast('Keys cleared from local browser storage', 'info');
  });
}
