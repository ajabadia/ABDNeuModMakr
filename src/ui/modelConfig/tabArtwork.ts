// ─────────────────────────────────────────────────────────
// Model Configuration — Tab 4: Cover Artwork (HTML renderer).
// ─────────────────────────────────────────────────────────

import type { ProcessConfig } from '../../core/types';
import { ICONS } from '../icons';
import { escHtml, escAttr } from '../escape';
import { getDefaultCoverIcon } from './constants';

export function renderArtworkTab(config: ProcessConfig): string {
    const isExtended = (config.workingMode ?? 'classic') === 'extended';
    const cover = config.coverArtwork;
    const defaultIcon = getDefaultCoverIcon(config);

    return `
      <div class="model-cfg-grid">
        <fieldset class="conditioned-fieldset" ${!isExtended ? 'disabled' : ''}>
          <div class="card ${!isExtended ? 'is-conditioned-disabled' : ''}">
            <div class="model-cfg-card-header">
              <h4>
                ${ICONS.palette} Model Cover Artwork (512×512 WebP)
                ${!isExtended ? '<span class="cond-reason-badge is-extended-only">SOLO MODO EXTENDED</span>' : ''}
              </h4>
              <span class="nmm-hint">Rendered in ABDAxionikVS catalog, SoundFont browser, and modern VST3/AU wrappers</span>
            </div>

            <div class="cover-artwork-editor-layout">
              <div class="cover-preview-card">
                ${
                  cover
                    ? `
                  <div class="cover-image-frame has-cover">
                    <img src="${escAttr(cover.webpDataUrl)}" alt="Model Cover Artwork" class="cover-preview-img" />
                    <div class="cover-badge-dimensions">${cover.width}×${cover.height} WebP</div>
                  </div>
                  <div class="cover-actions-row">
                    <button type="button" class="btn btn-danger btn-sm" id="btn-cfg-remove-cover">
                      ${ICONS.trash} Remove Artwork
                    </button>
                  </div>
                `
                    : `
                  <div class="cover-image-frame is-empty">
                    <div class="cover-empty-placeholder">
                      <div class="cover-watermark-icon">${defaultIcon.iconSvg}</div>
                      <span class="empty-badge">DEFAULT ARTWORK</span>
                      <span class="empty-text">${escHtml(defaultIcon.label)}</span>
                    </div>
                  </div>
                `
                }
              </div>

              <div class="cover-upload-card">
                <label>UPLOAD OR REPLACE ARTWORK</label>
                <div class="cover-dropzone" id="cfg-cover-dropzone">
                  <span class="dropzone-icon">${ICONS.plus}</span>
                  <strong>Drag &amp; Drop Image Here</strong>
                  <span class="text-muted">PNG, JPEG, WebP, SVG, AVIF (Auto-converted to 512×512 WebP)</span>
                  <button type="button" class="btn btn-outline btn-sm" id="btn-cfg-pick-cover">
                    Browse File...
                  </button>
                  <input type="file" id="inp-cfg-cover-file" class="is-hidden-file" accept="image/*" />
                </div>

                <!-- AI Artwork Generator (Roadmap Phase 20) -->
                <div class="ai-artwork-generator-banner">
                  <div class="ai-generator-info">
                    <strong class="ai-generator-title">${ICONS.sparkle} AI Cover Artwork Generator</strong>
                    <span class="nmm-hint">Generate unique 512×512 neural cover art tailored to model name and acoustic timbre.</span>
                  </div>
                  <button type="button" class="btn btn-outline btn-ai-generate" id="btn-cfg-ai-cover" title="AI Cover Artwork Generation (Roadmap Phase 20)">
                    ${ICONS.sparkle} Generate with AI <span class="badge-ai-soon">Fase 20</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </fieldset>
      </div>
    `;
}
