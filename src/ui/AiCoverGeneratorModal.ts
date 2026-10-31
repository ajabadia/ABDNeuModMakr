// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — AI Cover Artwork Generator Modal (Fase 20)
//
// Interactive dialog for generating 512×512 WebP model cover art:
//   - Procedural acoustic spectrogram engine (offline, instant, zero-cost)
//   - Cloud BYOK neural models (Google Gemini Imagen 3, OpenAI DALL-E 3,
//     Hugging Face FLUX, Replicate)
//   - Local Companion Bridge (Port 7860)
// ─────────────────────────────────────────────────────────

import {
  ARTWORK_STYLES,
  buildAcousticArtworkPrompt,
  generateModelArtwork,
  type ArtworkProvider,
  type ArtworkStylePreset,
} from '../core/ai/ModelArtworkGenerator.ts';
import { cloudByokClient } from '../core/ai/CloudByokClient.ts';
import type { ModelCoverArtwork, ProcessConfig } from '../core/types.ts';
import { escAttr, escHtml } from './escape.ts';
import { ICONS } from './icons.ts';
import { createModalFocusTrap, type FocusTrap } from './modalFocusTrap.ts';
import { toast } from './notify.ts';

export interface AiCoverGeneratorModalContext {
  getConfig: () => ProcessConfig;
  onApplyCover: (artwork: ModelCoverArtwork) => void;
  onOpenSettings?: () => void;
}

export class AiCoverGeneratorModal {
  private readonly context: AiCoverGeneratorModalContext;
  private backdropEl: HTMLElement | null = null;
  private focusTrap: FocusTrap | null = null;

  private selectedStyle: ArtworkStylePreset = 'cyberpunk';
  private selectedProvider: ArtworkProvider = 'procedural';
  private customPrompt: string = '';
  private currentArtwork: ModelCoverArtwork | null = null;
  private isGenerating: boolean = false;
  private generationError: string | null = null;
  private generationStatusText: string = '';

  constructor(context: AiCoverGeneratorModalContext) {
    this.context = context;
    // Auto-select provider: if user has a configured BYOK key, prefer it, else procedural
    const byok = cloudByokClient.getConfig();
    if (byok.geminiApiKey?.trim()) {
      this.selectedProvider = 'gemini';
    } else if (byok.openaiApiKey?.trim()) {
      this.selectedProvider = 'openai';
    } else {
      this.selectedProvider = 'procedural';
    }
  }

  public open(): void {
    const config = this.context.getConfig();
    this.currentArtwork = config.coverArtwork ?? null;
    this.generationError = null;
    this.customPrompt = '';
    this.render();
  }

  public close(): void {
    if (this.focusTrap) {
      this.focusTrap.deactivate();
      this.focusTrap = null;
    }
    if (this.backdropEl) {
      this.backdropEl.remove();
      this.backdropEl = null;
    }
  }

  public isOpen(): boolean {
    return Boolean(this.backdropEl);
  }

  private render(): void {
    const config = this.context.getConfig();
    const modelName = config.modelName || 'NewModel';
    const expandedName = config.expandedName || modelName;
    const pSet = config.parameterSet ?? 0;
    const category = config.extendedMetadata?.category ?? 'Synthesizer';

    const promptText = buildAcousticArtworkPrompt({
      modelName,
      expandedName,
      parameterSet: pSet,
      category,
      style: this.selectedStyle,
      customPrompt: this.customPrompt,
    });

    if (!this.backdropEl) {
      this.backdropEl = document.createElement('div');
      this.backdropEl.className = 'nmm-modal-backdrop ai-cover-modal-backdrop';
      document.body.appendChild(this.backdropEl);

      this.backdropEl.addEventListener('click', (e) => {
        if (e.target === this.backdropEl && !this.isGenerating) this.close();
      });
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.backdropEl && !this.isGenerating) this.close();
      });
    }

    const providerKeyStatus = this.getProviderKeyStatus(this.selectedProvider);

    this.backdropEl.innerHTML = `
      <div class="nmm-modal-window ai-cover-modal-window" role="dialog" aria-modal="true" aria-labelledby="ai-cover-title">
        <header class="nmm-modal-header">
          <div class="nmm-modal-header-title">
            <span class="nmm-modal-header-icon">${ICONS.palette}</span>
            <h2 id="ai-cover-title">AI Model Cover Artwork Generator</h2>
            <span class="panel-badge badge-ai-on">FASE 20 — NEURAL &amp; PROCEDURAL</span>
          </div>
          <button type="button" class="nmm-modal-close" id="btn-ai-cover-close" aria-label="Close" ${this.isGenerating ? 'disabled' : ''}>
            ${ICONS.close || '✕'}
          </button>
        </header>

        <div class="nmm-modal-body ai-cover-modal-body">
          <div class="ai-cover-grid">
            <!-- Left: Artwork Preview & Actions -->
            <div class="ai-cover-preview-col">
              <div class="ai-cover-frame ${this.isGenerating ? 'is-generating' : ''}">
                ${
                  this.isGenerating
                    ? `
                  <div class="ai-cover-generating-state">
                    <div class="neural-pulse-spinner">${ICONS.sparkle || ICONS.ai}</div>
                    <strong class="generating-title">Synthesizing Neural Artwork...</strong>
                    <span class="generating-sub">${escHtml(this.generationStatusText || 'Rendering acoustic soundwaves...')}</span>
                  </div>
                `
                    : this.currentArtwork
                      ? `
                  <img src="${escAttr(this.currentArtwork.webpDataUrl)}" alt="Cover Preview" class="ai-cover-img" />
                  <div class="ai-cover-badge-meta">
                    <span>${this.currentArtwork.width}×${this.currentArtwork.height} WebP</span>
                    <span>${Math.round(this.currentArtwork.byteLength / 1024)} KB</span>
                  </div>
                `
                      : `
                  <div class="ai-cover-empty-placeholder">
                    <div class="placeholder-icon">${ICONS.wave}</div>
                    <strong>Ready to Generate</strong>
                    <span>Select an artistic style and click Generate below</span>
                  </div>
                `
                }
              </div>

              ${
                this.currentArtwork && !this.isGenerating
                  ? `
                <div class="ai-cover-actions-bar">
                  <button type="button" class="btn btn-primary btn-sm flex-1" id="btn-ai-cover-apply" title="Apply this artwork as model cover">
                    ${ICONS.check} Accept &amp; Apply as Model Cover
                  </button>
                  <button type="button" class="btn btn-outline btn-sm" id="btn-ai-cover-download" title="Download WebP image">
                    ${ICONS.download} Download
                  </button>
                  <button type="button" class="btn btn-outline btn-sm" id="btn-ai-cover-regen" title="Generate another variation">
                    ${ICONS.refresh} Regenerate
                  </button>
                </div>
              `
                  : ''
              }
            </div>

            <!-- Right: Controls, Style, Prompt & Provider -->
            <div class="ai-cover-controls-col">
              <!-- Context Card -->
              <div class="ai-ctrl-card">
                <div class="ai-ctrl-header">
                  <strong>${ICONS.cpu} Acoustic Timbre Profile</strong>
                  <span class="text-muted">Target: ${escHtml(expandedName)}</span>
                </div>
                <div class="ai-tags-row">
                  <span class="val-pill">Model: <strong>${escHtml(modelName)}</strong></span>
                  <span class="val-pill">Set: <strong>#${pSet}</strong></span>
                  <span class="val-pill">Category: <strong>${escHtml(category)}</strong></span>
                  <span class="val-pill">Output: <strong>512×512 WebP</strong></span>
                </div>
              </div>

              <!-- Style Selector -->
              <div class="ai-ctrl-card">
                <div class="ai-ctrl-header">
                  <strong>${ICONS.palette} Artistic Aesthetic Style</strong>
                  <span class="text-muted">Visual palette and synthesis genre</span>
                </div>
                <div class="ai-styles-grid">
                  ${ARTWORK_STYLES.map(
                    (s) => `
                    <button type="button" class="btn-style-pill ${this.selectedStyle === s.id ? 'is-selected' : ''}" data-style="${s.id}">
                      <div class="style-title">${escHtml(s.name)}</div>
                      <div class="style-desc">${escHtml(s.description)}</div>
                    </button>
                  `
                  ).join('')}
                </div>
              </div>

              <!-- Prompt Editor -->
              <div class="ai-ctrl-card">
                <div class="ai-ctrl-header">
                  <label for="txt-ai-prompt"><strong>${ICONS.edit} Acoustic Prompt</strong></label>
                  <button type="button" class="btn btn-xs btn-outline" id="btn-reset-prompt" title="Reset prompt to acoustic default">
                    ${ICONS.refresh} Reset to Default
                  </button>
                </div>
                <textarea
                  id="txt-ai-prompt"
                  class="form-control ai-prompt-textarea"
                  rows="3"
                  placeholder="Acoustic description used for diffusion..."
                >${escHtml(promptText)}</textarea>
              </div>

              <!-- Provider Selection -->
              <div class="ai-ctrl-card">
                <div class="ai-ctrl-header">
                  <strong>${ICONS.sparkle || ICONS.ai} Generative Engine / Provider</strong>
                  <span class="text-muted">Local or Cloud BYOK</span>
                </div>
                <div class="ai-provider-select-row">
                  <select id="sel-ai-provider" class="form-control flex-1">
                    <option value="procedural" ${this.selectedProvider === 'procedural' ? 'selected' : ''}>
                      Procedural Acoustic Spectrogram (Instant • Offline • Free)
                    </option>
                    <option value="bridge" ${this.selectedProvider === 'bridge' ? 'selected' : ''}>
                      Local Companion Bridge (Python 7860 • Instant)
                    </option>
                    <option value="gemini" ${this.selectedProvider === 'gemini' ? 'selected' : ''}>
                      Google Gemini (Imagen 3 • BYOK)
                    </option>
                    <option value="openai" ${this.selectedProvider === 'openai' ? 'selected' : ''}>
                      OpenAI (DALL-E 3 • BYOK)
                    </option>
                    <option value="huggingface" ${this.selectedProvider === 'huggingface' ? 'selected' : ''}>
                      Hugging Face (FLUX.1-schnell • BYOK)
                    </option>
                    <option value="replicate" ${this.selectedProvider === 'replicate' ? 'selected' : ''}>
                      Replicate (FLUX / SDXL • BYOK)
                    </option>
                  </select>
                </div>
                <div class="provider-key-status ${providerKeyStatus.statusClass}">
                  ${providerKeyStatus.message}
                  ${
                    providerKeyStatus.showSettingsLink
                      ? `<button type="button" class="btn-link" id="btn-open-settings-byok">Open Settings (Ctrl+,)</button>`
                      : ''
                  }
                </div>
              </div>

              <!-- Error Banner -->
              ${
                this.generationError
                  ? `
                <div class="ai-error-banner">
                  <span class="error-icon">${ICONS.alert}</span>
                  <div class="error-msg">${escHtml(this.generationError)}</div>
                </div>
              `
                  : ''
              }
            </div>
          </div>
        </div>

        <footer class="nmm-modal-footer">
          <button type="button" class="btn btn-outline" id="btn-ai-cover-cancel" ${this.isGenerating ? 'disabled' : ''}>
            Close
          </button>
          <button type="button" class="btn btn-primary btn-ai-generate-main" id="btn-ai-cover-generate" ${this.isGenerating ? 'disabled' : ''}>
            ${this.isGenerating ? ICONS.spinner : ICONS.sparkle || ICONS.ai}
            ${this.isGenerating ? 'Generating Artwork...' : 'Generate Artwork'}
          </button>
        </footer>
      </div>
    `;

    if (!this.focusTrap && this.backdropEl) {
      this.focusTrap = createModalFocusTrap(this.backdropEl, {
        onEscape: () => {
          if (!this.isGenerating) this.close();
        },
        initialFocusSelector: '#btn-ai-cover-generate',
      });
      this.focusTrap.activate();
    }

    this.bindEvents();
  }

  private getProviderKeyStatus(provider: ArtworkProvider): {
    message: string;
    statusClass: string;
    showSettingsLink: boolean;
  } {
    if (provider === 'procedural') {
      return {
        message: 'Direct mathematical canvas rendering. 100% offline, zero latency, zero cost.',
        statusClass: 'status-ok',
        showSettingsLink: false,
      };
    }
    if (provider === 'bridge') {
      return {
        message: 'Companion Bridge active at http://127.0.0.1:7860.',
        statusClass: 'status-ok',
        showSettingsLink: false,
      };
    }

    const byok = cloudByokClient.getConfig();
    if (provider === 'gemini') {
      if (byok.geminiApiKey?.trim()) {
        return {
          message: 'Google Gemini API Key is configured in BYOK storage.',
          statusClass: 'status-ok',
          showSettingsLink: false,
        };
      }
      return {
        message: 'Google Gemini API Key is not configured.',
        statusClass: 'status-warn',
        showSettingsLink: true,
      };
    }
    if (provider === 'openai') {
      if (byok.openaiApiKey?.trim()) {
        return {
          message: 'OpenAI API Key is configured in BYOK storage.',
          statusClass: 'status-ok',
          showSettingsLink: false,
        };
      }
      return {
        message: 'OpenAI API Key is not configured.',
        statusClass: 'status-warn',
        showSettingsLink: true,
      };
    }
    if (provider === 'huggingface') {
      if (byok.huggingfaceToken?.trim()) {
        return {
          message: 'Hugging Face Token is configured in BYOK storage.',
          statusClass: 'status-ok',
          showSettingsLink: false,
        };
      }
      return {
        message: 'Hugging Face Token is not configured.',
        statusClass: 'status-warn',
        showSettingsLink: true,
      };
    }
    if (provider === 'replicate') {
      if (byok.replicateToken?.trim()) {
        return {
          message: 'Replicate Token is configured in BYOK storage.',
          statusClass: 'status-ok',
          showSettingsLink: false,
        };
      }
      return {
        message: 'Replicate API Token is not configured.',
        statusClass: 'status-warn',
        showSettingsLink: true,
      };
    }

    return { message: '', statusClass: '', showSettingsLink: false };
  }

  private bindEvents(): void {
    if (!this.backdropEl) return;

    // Close buttons
    this.backdropEl.querySelector('#btn-ai-cover-close')?.addEventListener('click', () => {
      if (!this.isGenerating) this.close();
    });
    this.backdropEl.querySelector('#btn-ai-cover-cancel')?.addEventListener('click', () => {
      if (!this.isGenerating) this.close();
    });

    // Style buttons
    this.backdropEl.querySelectorAll<HTMLButtonElement>('.btn-style-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        const style = btn.getAttribute('data-style') as ArtworkStylePreset;
        if (style) {
          this.selectedStyle = style;
          this.render();
        }
      });
    });

    // Provider select
    const selProvider = this.backdropEl.querySelector<HTMLSelectElement>('#sel-ai-provider');
    selProvider?.addEventListener('change', () => {
      this.selectedProvider = selProvider.value as ArtworkProvider;
      this.render();
    });

    // Open Settings link
    this.backdropEl.querySelector('#btn-open-settings-byok')?.addEventListener('click', () => {
      this.close();
      this.context.onOpenSettings?.();
    });

    // Reset prompt button
    this.backdropEl.querySelector('#btn-reset-prompt')?.addEventListener('click', () => {
      this.customPrompt = '';
      this.render();
    });

    // Prompt textarea change
    const txtPrompt = this.backdropEl.querySelector<HTMLTextAreaElement>('#txt-ai-prompt');
    txtPrompt?.addEventListener('input', () => {
      this.customPrompt = txtPrompt.value;
    });

    // Generate button
    this.backdropEl.querySelector('#btn-ai-cover-generate')?.addEventListener('click', () => {
      this.triggerGenerate();
    });

    // Regenerate button
    this.backdropEl.querySelector('#btn-ai-cover-regen')?.addEventListener('click', () => {
      this.triggerGenerate();
    });

    // Apply button
    this.backdropEl.querySelector('#btn-ai-cover-apply')?.addEventListener('click', () => {
      if (this.currentArtwork) {
        this.context.onApplyCover(this.currentArtwork);
        toast('Model cover artwork updated (512×512 WebP attached).', 'success');
        this.close();
      }
    });

    // Download button
    this.backdropEl.querySelector('#btn-ai-cover-download')?.addEventListener('click', () => {
      if (this.currentArtwork) {
        this.downloadArtwork(this.currentArtwork);
      }
    });
  }

  private async triggerGenerate(): Promise<void> {
    if (this.isGenerating) return;

    const config = this.context.getConfig();
    const modelName = config.modelName || 'NewModel';
    const expandedName = config.expandedName || modelName;
    const pSet = config.parameterSet ?? 0;
    const category = config.extendedMetadata?.category ?? 'Synthesizer';

    this.isGenerating = true;
    this.generationError = null;
    this.generationStatusText = `Connecting to ${this.selectedProvider}...`;
    this.render();

    const result = await generateModelArtwork({
      modelName,
      expandedName,
      parameterSet: pSet,
      category,
      style: this.selectedStyle,
      customPrompt: this.customPrompt,
      provider: this.selectedProvider,
    });

    this.isGenerating = false;

    if (result.success && result.coverArtwork) {
      this.currentArtwork = result.coverArtwork;
      this.generationError = null;
      toast(`Artwork generated successfully in ${(result.generationTimeMs / 1000).toFixed(2)}s`, 'success');
    } else {
      this.generationError = result.error || 'Failed to generate artwork.';
      toast(`Artwork generation error: ${this.generationError}`, 'error');
    }

    this.render();
  }

  private downloadArtwork(artwork: ModelCoverArtwork): void {
    const config = this.context.getConfig();
    const slug = (config.modelName || 'cover').toLowerCase().replace(/[^a-z0-9]/g, '_');
    const a = document.createElement('a');
    a.href = artwork.webpDataUrl;
    a.download = `${slug}_cover_512x512.webp`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast(`Downloaded "${slug}_cover_512x512.webp"`, 'info');
  }
}
