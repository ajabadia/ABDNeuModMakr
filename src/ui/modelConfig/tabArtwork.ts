// ─────────────────────────────────────────────────────────
// Model Configuration — Tab 4: Cover Artwork (HTML renderer).
// ─────────────────────────────────────────────────────────

import { getAppLocale } from '../../core/i18n';
import type { ProcessConfig } from '../../core/types';
import { ICONS } from '../icons';
import { escHtml, escAttr } from '../escape';
import { getDefaultCoverIcon } from './constants';

export function renderArtworkTab(config: ProcessConfig): string {
    const isEs = getAppLocale() === 'es';
    const isExtended = (config.workingMode ?? 'classic') === 'extended';
    const cover = config.coverArtwork;
    const defaultIcon = getDefaultCoverIcon(config);

    return `
      <div class="model-cfg-grid">
        <fieldset class="conditioned-fieldset" ${!isExtended ? 'disabled' : ''}>
          <div class="card ${!isExtended ? 'is-conditioned-disabled' : ''}">
            <div class="model-cfg-card-header">
              <h4>
                ${ICONS.palette} ${isEs ? 'Portada del Modelo (512×512 WebP)' : 'Model Cover Artwork (512×512 WebP)'}
                ${!isExtended ? `<span class="cond-reason-badge is-extended-only">${isEs ? 'SOLO MODO EXTENDED' : 'EXTENDED MODE ONLY'}</span>` : ''}
              </h4>
              <span class="nmm-hint">${isEs ? 'Renderizada en el catálogo de ABDAxionikVS, navegador SoundFont y wrappers VST3/AU modernos' : 'Rendered in ABDAxionikVS catalog, SoundFont browser, and modern VST3/AU wrappers'}</span>
            </div>

            <div class="cover-artwork-editor-layout">
              <div class="cover-preview-card">
                ${
                  cover
                    ? `
                  <div class="cover-image-frame has-cover">
                    <img src="${escAttr(cover.webpDataUrl)}" alt="${isEs ? 'Portada del Modelo' : 'Model Cover Artwork'}" class="cover-preview-img" />
                    <div class="cover-badge-dimensions">${cover.width}×${cover.height} WebP</div>
                  </div>
                  <div class="cover-actions-row">
                    <button type="button" class="btn btn-danger btn-sm" id="btn-cfg-remove-cover">
                      ${ICONS.trash} ${isEs ? 'Quitar Portada' : 'Remove Artwork'}
                    </button>
                  </div>
                `
                    : `
                  <div class="cover-image-frame is-empty">
                    <div class="cover-empty-placeholder">
                      <div class="cover-watermark-icon">${defaultIcon.iconSvg}</div>
                      <span class="empty-badge">${isEs ? 'PORTADA POR DEFECTO' : 'DEFAULT ARTWORK'}</span>
                      <span class="empty-text">${escHtml(defaultIcon.label)}</span>
                    </div>
                  </div>
                `
                }
              </div>

              <div class="cover-upload-card">
                <label>${isEs ? 'SUBIR O REEMPLAZAR PORTADA' : 'UPLOAD OR REPLACE ARTWORK'}</label>
                <div class="cover-dropzone" id="cfg-cover-dropzone">
                  <span class="dropzone-icon">${ICONS.plus}</span>
                  <strong>${isEs ? 'Arrastra y Suelta una Imagen Aquí' : 'Drag &amp; Drop Image Here'}</strong>
                  <span class="text-muted">${isEs ? 'PNG, JPEG, WebP, SVG, AVIF (Convertida automáticamente a WebP 512×512)' : 'PNG, JPEG, WebP, SVG, AVIF (Auto-converted to 512×512 WebP)'}</span>
                  <button type="button" class="btn btn-outline btn-sm" id="btn-cfg-pick-cover">
                    ${isEs ? 'Examinar Archivo...' : 'Browse File...'}
                  </button>
                  <input type="file" id="inp-cfg-cover-file" class="is-hidden-file" accept="image/*" />
                </div>

                <!-- AI Artwork Generator (Roadmap Phase 20) -->
                <div class="ai-artwork-generator-banner">
                  <div class="ai-generator-info">
                    <strong class="ai-generator-title">${ICONS.sparkle} ${isEs ? 'Generador IA de Portada' : 'AI Cover Artwork Generator'}</strong>
                    <span class="nmm-hint">${isEs ? 'Genera portadas neuronales únicas en 512×512 adaptadas al nombre del modelo y a su timbre acústico.' : 'Generate unique 512×512 neural cover art tailored to model name and acoustic timbre.'}</span>
                  </div>
                  <button type="button" class="btn btn-outline btn-ai-generate" id="btn-cfg-ai-cover" title="${isEs ? 'Generación de Portada por IA (Fase 20)' : 'AI Cover Artwork Generation (Roadmap Phase 20)'}">
                    ${ICONS.sparkle} ${isEs ? 'Generar con IA' : 'Generate with AI'} <span class="badge-ai-soon">${isEs ? 'Fase 20' : 'Phase 20'}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </fieldset>
      </div>
    `;
}
