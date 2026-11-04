// ─────────────────────────────────────────────────────────
// Model Configuration — Tab 3: Metadata, Tags & Time Capsule (HTML renderer).
// ─────────────────────────────────────────────────────────

import { getAppLocale } from '../../core/i18n';
import { STANDARD_SOUNDFONT_TAGS } from '../../core/soundfontMetadata';
import type { ExtendedModelMetadata, ProcessConfig } from '../../core/types';
import { ICONS } from '../icons';
import { escHtml, escAttr } from '../escape';
import { activeTagDescription, activeTagPlaceholder } from './tagHelpers';
import type { ModelConfigTabContext } from './types';

export function renderMetadataTab(ctx: ModelConfigTabContext, config: ProcessConfig): string {
    const isEs = getAppLocale() === 'es';
    const isExtended = (config.workingMode ?? 'classic') === 'extended';
    const meta: ExtendedModelMetadata = config.extendedMetadata ?? {};
    const customAttrs = meta.customAttributes ?? [];

    return `
      <div class="model-cfg-grid">
        <!-- 1. General Provenance & Attribution -->
        <fieldset class="conditioned-fieldset" ${!isExtended ? 'disabled' : ''}>
          <div class="card ${!isExtended ? 'is-conditioned-disabled' : ''}">
            <div class="model-cfg-card-header">
              <h4>
                ${ICONS.database} ${isEs ? 'Procedencia y Atribución Extendida del Modelo' : 'Extended Model Provenance &amp; Attribution'}
                ${!isExtended ? `<span class="cond-reason-badge is-extended-only">${isEs ? 'SOLO MODO EXTENDED' : 'EXTENDED MODE ONLY'}</span>` : ''}
              </h4>
              <span class="nmm-hint">${isEs ? 'Preservado en AxionikDB e instrumentos sampler modernos' : 'Preserved across AxionikDB and modern sampler instruments'}</span>
            </div>

            <div class="form-row-dual">
              <div class="form-group flex-1">
                <label for="inp-cfg-meta-author">${isEs ? 'AUTOR / DISEÑADOR DE SONIDO' : 'AUTHOR / SOUND DESIGNER'}</label>
                <input
                  type="text"
                  id="inp-cfg-meta-author"
                  class="form-control"
                  value="${escAttr(meta.author ?? '')}"
                  placeholder="${isEs ? 'Nombre del diseñador de sonido o creador...' : 'Sound designer or creator name...'}"
                />
              </div>
              <div class="form-group flex-1">
                <label for="inp-cfg-meta-version">${isEs ? 'VERSIÓN' : 'VERSION'}</label>
                <input
                  type="text"
                  id="inp-cfg-meta-version"
                  class="form-control"
                  value="${escAttr(meta.version ?? '1.0.0')}"
                  placeholder="1.0.0"
                />
              </div>
            </div>

            <div class="form-row-dual">
              <div class="form-group flex-1">
                <label for="inp-cfg-meta-license">${isEs ? 'LICENCIA' : 'LICENSE'}</label>
                <input
                  type="text"
                  id="inp-cfg-meta-license"
                  class="form-control"
                  value="${escAttr(meta.license ?? '')}"
                  placeholder="${isEs ? 'ej. CC-BY 4.0, CC0, Comercial' : 'e.g. CC-BY 4.0, CC0, Commercial'}"
                />
              </div>
              <div class="form-group flex-1">
                <label for="inp-cfg-meta-url">${isEs ? 'URL DE ORIGEN / FUENTE SF2' : 'SOURCE / SF2 ORIGIN URL'}</label>
                <input
                  type="url"
                  id="inp-cfg-meta-url"
                  class="form-control"
                  value="${escAttr(meta.sourceUrl ?? '')}"
                  placeholder="https://..."
                />
              </div>
            </div>

            <div class="form-group">
              <label for="inp-cfg-meta-desc">${isEs ? 'DESCRIPCIÓN Y NOTAS DE INTERPRETACIÓN' : 'DESCRIPTION &amp; PERFORMANCE NOTES'}</label>
              <textarea
                id="inp-cfg-meta-desc"
                class="form-control"
                rows="3"
                placeholder="${isEs ? 'Características acústicas, colocación de micrófonos, sugerencias de interpretación...' : 'Acoustic characteristics, microphone placement, performance suggestions...'}"
              >${escHtml(meta.description ?? '')}</textarea>
            </div>
          </div>
        </fieldset>

        <!-- 2. SoundFont & Sampler Metadata Tags -->
        <fieldset class="conditioned-fieldset" ${!isExtended ? 'disabled' : ''}>
          <div class="card ${!isExtended ? 'is-conditioned-disabled' : ''}">
            <div class="model-cfg-card-header">
              <h4>
                ${ICONS.layers} ${isEs ? `Etiquetas de Metadatos SoundFont y Sampler (${customAttrs.length})` : `SoundFont &amp; Sampler Metadata Tags (${customAttrs.length})`}
                ${!isExtended ? `<span class="cond-reason-badge is-extended-only">${isEs ? 'SOLO MODO EXTENDED' : 'EXTENDED MODE ONLY'}</span>` : ''}
              </h4>
              <span class="nmm-hint">${isEs ? 'Etiquetas RIFF INFO chunk (IENG, ICOP, ICRD, ISFT) y atributos de grabación de estudio' : 'RIFF INFO chunk tags (IENG, ICOP, ICRD, ISFT) and studio recording attributes'}</span>
            </div>

            <!-- Add Tag Bar -->
            <div class="meta-tag-adder-card">
              <div class="meta-tag-adder-row">
                <div class="form-group tag-select-group">
                  <label for="sel-cfg-standard-tag">${isEs ? 'ATRIBUTO DE METADATOS ESTÁNDAR' : 'STANDARD METADATA ATTRIBUTE'}</label>
                  <select id="sel-cfg-standard-tag" class="form-control">
                    <option value="custom" ${ctx.tags.selectedKey === 'custom' ? 'selected' : ''}>
                      ${isEs ? '★ Etiqueta Personalizada (Clave definida por usuario)...' : '★ Custom Tag (User-defined key)...'}
                    </option>
                    ${STANDARD_SOUNDFONT_TAGS.map(
                      (t) => `
                      <option value="${escAttr(t.key)}" ${ctx.tags.selectedKey === t.key ? 'selected' : ''}>
                        [${escHtml(t.category)}] ${escHtml(t.label)}
                      </option>
                    `
                    ).join('')}
                  </select>
                </div>

                <div class="form-group tag-key-group ${ctx.tags.selectedKey !== 'custom' ? 'is-hidden' : ''}" id="group-cfg-custom-key">
                  <label for="inp-cfg-custom-tag-key">${isEs ? 'CLAVE PERSONALIZADA' : 'CUSTOM KEY'}</label>
                  <input
                    type="text"
                    id="inp-cfg-custom-tag-key"
                    class="form-control font-mono"
                    placeholder="${isEs ? 'ej. MicDistance' : 'e.g. MicDistance'}"
                    value="${escAttr(ctx.tags.customKey)}"
                  />
                </div>

                <div class="form-group flex-1 tag-val-group">
                  <label for="inp-cfg-tag-val">${isEs ? 'VALOR DEL ATRIBUTO' : 'ATTRIBUTE VALUE'}</label>
                  <input
                    type="text"
                    id="inp-cfg-tag-val"
                    class="form-control"
                    placeholder="${escAttr(activeTagPlaceholder(ctx.tags.selectedKey))}"
                  />
                </div>

                <div class="tag-btn-group">
                  <label>&nbsp;</label>
                  <button type="button" class="btn btn-primary" id="btn-cfg-add-tag">
                    ${ICONS.plus} ${isEs ? 'Añadir Etiqueta' : 'Add Tag'}
                  </button>
                </div>
              </div>
              <p class="tag-helper-desc" id="cfg-tag-helper-text">${escHtml(activeTagDescription(ctx.tags.selectedKey))}</p>
            </div>

            <!-- Active Tags List -->
            <div class="meta-tags-list-container">
              ${
                customAttrs.length === 0
                  ? `<p class="text-muted empty-tags-note">${isEs ? 'Aún no se han definido etiquetas de metadatos. Selecciona un atributo arriba y pulsa «Añadir Etiqueta».' : 'No metadata tags defined yet. Select an attribute above and click "Add Tag".'}</p>`
                  : `
                <div class="meta-tags-grid">
                  ${customAttrs
                    .map(
                      (item, idx) => `
                    <div class="meta-tag-item-card">
                      <div class="tag-item-info">
                        <strong class="tag-item-key">${escHtml(item.tag)}</strong>
                        <span class="tag-item-val">${escHtml(item.value)}</span>
                      </div>
                      <button type="button" class="btn-remove-tag" data-remove-tag-idx="${idx}" title="${isEs ? `Eliminar etiqueta ${escAttr(item.tag)}` : `Remove tag ${escAttr(item.tag)}`}">
                        ${ICONS.trash}
                      </button>
                    </div>
                  `
                    )
                    .join('')}
                </div>
              `
              }
            </div>
          </div>
        </fieldset>

        <!-- 3. 5-Layer Time Capsule & Provenance -->
        <div class="card">
          <div class="model-cfg-card-header">
            <h4>${ICONS.layers} ${isEs ? 'Cápsula del Tiempo de 5 Capas y Procedencia' : '5-Layer Time Capsule &amp; Provenance'}</h4>
            <span class="nmm-hint">${isEs ? 'Trazabilidad de origen no destructiva con cero pérdida generacional' : 'Non-destructive origin tracking with zero generation loss'}</span>
          </div>
          <p class="cfg-explainer">
            ${isEs ? 'El sistema de Cápsula del Tiempo almacena el audio original en crudo junto con los parámetros de resíntesis. En cualquier momento puedes lanzar un reprocesado sin pérdidas desde la fuente acústica más pura sin degradación de calidad.' : 'The Time Capsule system stores original raw audio along with resynthesis parameters. At any time, you can trigger a lossless reprocess from the purest acoustic source without quality degradation.'}
          </p>
          <div class="cfg-gap-top">
            <button type="button" class="btn btn-outline" id="btn-cfg-reprocess-capsule" title="${isEs ? 'Reprocesado sin pérdidas desde la fuente acústica original inalterada' : 'Lossless reprocess from original unaltered acoustic source'}">
              ${ICONS.cpu} ${isEs ? 'Reprocesar desde la Fuente Más Pura (0 Pérdida Generacional)' : 'Reprocess From Purest Source (0 Generation Loss)'}
            </button>
          </div>
        </div>
      </div>
    `;
}
