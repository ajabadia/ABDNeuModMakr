// ─────────────────────────────────────────────────────────
// Model Configuration — Tab 1: General & Engine (HTML renderer).
// ─────────────────────────────────────────────────────────

import { getAppLocale } from '../../core/i18n';
import type { ProcessConfig } from '../../core/types';
import { ICONS } from '../icons';
import { escHtml, escAttr } from '../escape';
import { PARAM_SET_ICONS, STICK_MODES_BY_COMPLEXITY } from './constants';
import type { ModelConfigTabContext } from './types';

export function renderGeneralTab(ctx: ModelConfigTabContext, config: ProcessConfig): string {
    const isEs = getAppLocale() === 'es';
    const isExtended = (config.workingMode ?? 'classic') === 'extended';
    const pSets = ctx.handlers.getParameterSets();
    const activeSet = pSets.find((p) => p.id === config.parameterSet) || pSets[0];
    const recDepth = STICK_MODES_BY_COMPLEXITY[Math.max(0, Math.min(9, config.complexity - 1))] ?? 32;

    const currentSub = config.sublibrary || 'Default';
    const sublibsRaw = ctx.handlers.getSublibraries?.() ?? ['Default'];
    const sublibNames = sublibsRaw.map((s) => (typeof s === 'string' ? s : s.name));
    if (!sublibNames.includes('Default')) sublibNames.unshift('Default');
    if (!sublibNames.includes(currentSub)) sublibNames.push(currentSub);

    const sublibOptionsHtml = sublibNames
      .map((name) => `<option value="${escAttr(name)}" ${name === currentSub ? 'selected' : ''}>${escHtml(name)}</option>`)
      .join('');

    return `
      <div class="model-cfg-grid">
        <!-- 1. Identity & Slot -->
        <div class="card">
          <div class="model-cfg-card-header">
            <h4>${ICONS.settings} ${isEs ? 'Identidad y Nombre del Modelo' : 'Model Identity &amp; Naming'}</h4>
            <span class="nmm-hint">${isEs ? 'Posición en memoria hardware, nombre clásico de pantalla y título extendido de nueva generación' : 'Hardware memory location, classic display name and extended next-gen title'}</span>
          </div>
          <div class="model-identity-dual-grid">
            <!-- Row 1: Classic Hardware Name + Slot -->
            <fieldset class="conditioned-fieldset" ${isExtended ? 'disabled' : ''}>
              <div class="form-row-classic-identity ${isExtended ? 'is-conditioned-disabled' : ''}">
                <div class="form-group flex-1">
                  <div class="label-with-val">
                    <label for="inp-cfg-model-name">
                      ${ICONS.cpu} ${isEs ? 'NOMBRE CLÁSICO DEL MODELO (HARDWARE HARTMANN)' : 'CLASSIC MODEL NAME (HARTMANN HARDWARE)'}
                      ${isExtended ? `<span class="cond-reason-badge is-classic-only">${isEs ? 'SOLO MODO CLASSIC' : 'CLASSIC MODE ONLY'}</span>` : ''}
                    </label>
                    <span class="val-pill" id="val-cfg-name-counter">
                      ${(config.modelName || '').length}/11 ${isEs ? 'caract.' : 'chars'}
                    </span>
                  </div>
                  <input
                    type="text"
                    id="inp-cfg-model-name"
                    class="form-control"
                    maxlength="11"
                    value="${escAttr(config.modelName || '')}"
                    placeholder="${isEs ? 'Máx 11 caract. (ej. Lead01)...' : 'Max 11 chars (e.g. Lead01)...'}"
                  />
                </div>

                <div class="form-group form-group-slot">
                  <div class="label-with-val">
                    <label for="inp-cfg-model-slot">${isEs ? 'SLOT HARDWARE' : 'HARDWARE SLOT'}</label>
                    <span class="val-pill" id="val-cfg-slot-badge">#${String(config.modelNumber ?? 0).padStart(3, '0')}</span>
                  </div>
                  <input
                    type="number"
                    id="inp-cfg-model-slot"
                    class="form-control"
                    min="0"
                    max="511"
                    value="${config.modelNumber ?? 0}"
                  />
                </div>
              </div>
            </fieldset>

            <!-- Row 2: Extended / Modern Name (No character limit, no bank number) -->
            <fieldset class="conditioned-fieldset" ${!isExtended ? 'disabled' : ''}>
              <div class="form-row-extended-identity ${!isExtended ? 'is-conditioned-disabled' : ''}">
                <div class="form-group flex-1">
                  <div class="label-with-val">
                    <label for="inp-cfg-expanded-name">
                      ${ICONS.layers} ${isEs ? 'NOMBRE EXTENDIDO DEL MODELO (MODERNO / AXIONIK)' : 'EXTENDED MODEL NAME (MODERN / AXIONIK)'}
                      ${!isExtended ? `<span class="cond-reason-badge is-extended-only">${isEs ? 'SOLO MODO EXTENDED' : 'EXTENDED MODE ONLY'}</span>` : ''}
                    </label>
                    <span class="val-pill" id="val-cfg-expanded-counter">
                      ${(config.expandedName || config.modelName || '').length} ${isEs ? 'caract. (Sin límite)' : 'chars (No limit)'}
                    </span>
                  </div>
                  <input
                    type="text"
                    id="inp-cfg-expanded-name"
                    class="form-control"
                    value="${escAttr(config.expandedName ?? config.modelName ?? '')}"
                    placeholder="${isEs ? 'Título completo sin restricciones (ej. Cinematic Acoustic Guitar 1974 Strumming)...' : 'Unrestricted full patch title (e.g. Cinematic Acoustic Guitar 1974 Strumming)...'}"
                  />
                </div>
                <div class="form-group form-group-subbank-preview">
                  <div class="label-with-val">
                    <label for="sel-cfg-sublibrary">${isEs ? 'SUB-LIBRERÍA (Fase 23)' : 'SUB-LIBRARY (Phase 23)'}</label>
                    <span class="val-pill" id="val-cfg-sublib-ordinal">#${config.sublibraryOrdinal ?? 1}</span>
                  </div>
                  <div class="cfg-inline-row">
                    <select id="sel-cfg-sublibrary" class="form-control cfg-flex-1" title="${isEs ? 'Asignar modelo a sub-librería en AxionikDB' : 'Assign model to sub-library in AxionikDB'}">
                      ${sublibOptionsHtml}
                    </select>
                    <button type="button" class="btn btn-outline btn-xs" id="btn-cfg-new-sublibrary" title="${isEs ? 'Crear nueva sub-librería...' : 'Create new sub-library...'}">
                      ${ICONS.folder}
                    </button>
                    <input
                      type="number"
                      id="inp-cfg-sublib-ordinal"
                      class="form-control cfg-ordinal-input"
                      min="1"
                      max="999"
                      value="${config.sublibraryOrdinal ?? 1}"
                      title="${isEs ? 'Índice ordinal de posición en la sub-librería' : 'Ordinal position index in sub-library'}"
                    />
                  </div>
                </div>
              </div>
            </fieldset>
          </div>
        </div>

        <!-- 2. Creation & Keyboard Mapping Mode -->
        <div class="card">
          <div class="model-cfg-card-header">
            <h4>${ICONS.piano} ${isEs ? 'Modo de Creación y Mapeo de Teclado' : 'Creation &amp; Keyboard Mapping Mode'}</h4>
            <span class="nmm-hint">${isEs ? 'Rige la estructura del teclado, capas de velocidad y restricciones del hardware físico' : 'Governs keyboard structure, velocity layers, and physical hardware constraints'}</span>
          </div>
          <div class="settings-working-mode-grid">
            <label class="settings-mode-opt ${!isExtended ? 'is-selected' : ''}">
              <input type="radio" name="cfg-working-mode" value="classic" ${!isExtended ? 'checked' : ''} />
              <div class="mode-opt-body">
                <div class="mode-opt-title">
                  <strong>${isEs ? 'Modo Clásico (Hartmann Neuron 2002)' : 'Classic Mode (Hartmann Neuron 2002)'}</strong>
                  <span class="panel-badge badge-muted">${isEs ? 'Hardware Original 1:1' : '1:1 Hardware Original'}</span>
                </div>
                <p class="text-muted">
                  ${isEs ? 'Columnas de teclado contiguas <code>0..127</code> sin huecos ni solapes. Dos capas de velocidad fijas en el valor <code>64</code> (Low y High). Nombres de modelo estrictamente limitados a 11 caracteres para compatibilidad con la pantalla física.' : 'Contiguous keyboard <code>0..127</code> columns with no gaps or overlaps. Two velocity layers fixed at value <code>64</code> (Low and High). Model names strictly capped at 11 characters for physical display compatibility.'}
                </p>
              </div>
            </label>

            <label class="settings-mode-opt ${isExtended ? 'is-selected' : ''}">
              <input type="radio" name="cfg-working-mode" value="extended" ${isExtended ? 'checked' : ''} />
              <div class="mode-opt-body">
                <div class="mode-opt-title">
                  <strong>${isEs ? 'Modo Extended (Modern Neural / Next-Gen)' : 'Extended Mode (Modern Neural / Next-Gen)'}</strong>
                  <span class="panel-badge badge-ai-on">${isEs ? 'HD Multicapa' : 'HD Multi-Layer'}</span>
                </div>
                <p class="text-muted">
                  ${isEs ? 'Mapeo 2D arbitrario (Tecla &times; Velocidad). Múltiples divisiones de velocidad, fundidos cruzados dinámicos, envolventes DAHDSR, bucles ping-pong y portada WebP 512&times;512 del modelo.' : 'Arbitrary 2D mapping (Key &times; Velocity). Multiple velocity splits, dynamic crossfades, DAHDSR envelopes, ping-pong loops, and 512&times;512 WebP model cover artwork.'}
                </p>
              </div>
            </label>
          </div>

          <div class="settings-mode-reassurance-box">
            <span class="reassurance-icon">${ICONS.check}</span>
            <div class="reassurance-text">
              <strong>${isEs ? 'Compatibilidad Bidireccional Segura y No Destructiva:' : 'Safe Non-Destructive Bidirectional Compatibility:'}</strong>
              <p>
                ${isEs ? 'Puedes alternar entre los modos Clásico y Extended en cualquier momento. Al volver al Modo Clásico, las regiones de velocidad multicapa <strong>no se borran</strong>: el compilador proyecta y compensa matemáticamente las ganancias relativas (<span class="math-snippet">10<sup>&Delta;G/20</sup></span>) para preservar el equilibrio sonoro exacto dentro de las restricciones del hardware original.' : 'You can switch between Classic and Extended modes at any time. When switching back to Classic Mode, multi-layer velocity regions are <strong>not deleted</strong>: the compiler mathematically projects and compensates relative gains (<span class="math-snippet">10<sup>&Delta;G/20</sup></span>) to preserve exact sonic balance within original hardware constraints.'}
              </p>
            </div>
          </div>
        </div>

        <!-- 3. Target Format & DSP Engine -->
        <div class="card">
          <div class="model-cfg-card-header">
            <h4>${ICONS.cpu} ${isEs ? 'Formato de Exportación y Motor de Resíntesis' : 'Target Export Format &amp; Resynthesis Engine'}</h4>
            <span class="nmm-hint">${isEs ? 'Archivos de destino de compilación y pipeline de modelado espectral' : 'Compilation destination files and spectral modeling pipeline'}</span>
          </div>
          <div class="model-cfg-engine-row">
            <div class="form-group">
              <label>${isEs ? 'FORMATO DE EXPORTACIÓN DESTINO' : 'TARGET EXPORT FORMAT'}</label>
              <div class="btn-group-toggle" role="radiogroup">
                <button type="button" class="btn-target-format ${(config.targetFormat ?? 'dual') === 'dual' ? 'is-active' : ''}" data-fmt="dual">
                  Dual (.model + .sound)
                </button>
                <button type="button" class="btn-target-format ${(config.targetFormat ?? 'dual') === 'legacy-neuron' ? 'is-active' : ''}" data-fmt="legacy-neuron" ${isExtended ? `disabled title="${isEs ? 'La exportación exclusiva Legacy (.model) es propia del Modo Classic; usa Dual o Modern Neural en Modo Extended' : 'Legacy-only (.model) export is exclusive to Classic Mode; use Dual or Modern Neural in Extended Mode'}"` : ''}>
                  Legacy Neuron (.model) ${isExtended ? '<span class="cond-reason-badge is-classic-only">CLASSIC</span>' : ''}
                </button>
                <button type="button" class="btn-target-format ${(config.targetFormat ?? 'dual') === 'modern-neural' ? 'is-active' : ''}" data-fmt="modern-neural" ${!isExtended ? `disabled title="${isEs ? 'Solo disponible en Modo Extended' : 'Only available in Extended Mode'}"` : ''}>
                  Modern Neural (.sound) ${!isExtended ? '<span class="cond-reason-badge is-extended-only">EXTENDED</span>' : ''}
                </button>
              </div>
            </div>

            <div class="form-group">
              <label>${isEs ? 'ALGORITMO DSP DE RESÍNTESIS' : 'DSP RESYNTHESIS ALGORITHM'}</label>
              <div class="btn-group-toggle" role="radiogroup">
                <button type="button" class="btn-dsp-algorithm ${(config.dspAlgorithm ?? 'legacy') === 'legacy' ? 'is-active' : ''}" data-alg="legacy" ${isExtended ? `disabled title="${isEs ? 'Exclusivo del Modo Classic 1:1 Hardware' : 'Exclusive to Classic 1:1 Hardware Mode'}"` : ''}>
                  Hartmann Legacy (2002) ${isExtended ? '<span class="cond-reason-badge is-classic-only">CLASSIC</span>' : ''}
                </button>
                <button type="button" class="btn-dsp-algorithm ${(config.dspAlgorithm ?? 'legacy') === 'enhanced' ? 'is-active' : ''}" data-alg="enhanced" ${!isExtended ? `disabled title="${isEs ? 'Solo disponible en Modo Extended' : 'Only available in Extended Mode'}"` : ''}>
                  Modern Neural Resynthesis ${!isExtended ? '<span class="cond-reason-badge is-extended-only">EXTENDED</span>' : ''}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- 4. Analysis Complexity (1..10) & Unified Surface Topology -->
        <div class="card">
          <div class="model-cfg-card-header">
            <h4>${ICONS.wave} ${isEs ? 'Complejidad de Análisis y Superficie Espectral Unificada' : 'Analysis Complexity &amp; Unified Spectral Surface'}</h4>
            <span class="nmm-hint">${isEs ? 'Controla la resolución armónica adaptativa (32..256 parciales) y la topología continua Pitch × Velocity' : 'Controls adaptive harmonic resolution (32..256 partials) and continuous Pitch &times; Velocity surface topology'}</span>
          </div>
          <fieldset class="conditioned-fieldset" ${!isExtended ? 'disabled' : ''}>
            <div class="form-row-dual ${!isExtended ? 'is-conditioned-disabled' : ''}" style="margin-bottom: 10px;">
              <div class="form-group flex-1">
                <label for="sel-cfg-surf-res-strategy">
                  ${isEs ? 'RESOLUCIÓN DEL MODELO (VARIABLES)' : 'MODEL RESOLUTION (VARIABLES)'}
                  ${!isExtended ? `<span class="cond-reason-badge is-extended-only">${isEs ? 'SOLO MODO EXTENDED' : 'EXTENDED MODE ONLY'}</span>` : ''}
                </label>
                <select id="sel-cfg-surf-res-strategy" class="form-control">
                  <option value="auto" ${(config.unifiedSurfaceConfig?.resolutionStrategy ?? 'auto') === 'auto' ? 'selected' : ''}>${isEs ? 'Automática según contenido (Compact 32p → Ultra-HD 256p)' : 'Automatic by content (Compact 32p → Ultra-HD 256p)'}</option>
                  <option value="manual" ${config.unifiedSurfaceConfig?.resolutionStrategy === 'manual' ? 'selected' : ''}>${isEs ? 'Manual por Nivel de Complejidad (1..10)' : 'Manual by Complexity Level (1..10)'}</option>
                </select>
              </div>
              <div class="form-group flex-1">
                <label for="sel-cfg-surf-topology">
                  ${isEs ? 'TOPOLOGÍA DE LA SUPERFICIE UNIFICADA' : 'UNIFIED SURFACE TOPOLOGY'}
                  ${!isExtended ? `<span class="cond-reason-badge is-extended-only">${isEs ? 'SOLO MODO EXTENDED' : 'EXTENDED MODE ONLY'}</span>` : ''}
                </label>
                <select id="sel-cfg-surf-topology" class="form-control">
                  <option value="auto" ${(config.unifiedSurfaceConfig?.topologyMode ?? 'auto') === 'auto' ? 'selected' : ''}>${isEs ? 'Auto-Detectar (Melódica 2D vs Kit Percusivo por Tecla)' : 'Auto-Detect (2D Melodic vs Per-Key Drum Kit)'}</option>
                  <option value="melodic_surface" ${config.unifiedSurfaceConfig?.topologyMode === 'melodic_surface' ? 'selected' : ''}>${isEs ? 'Forzar Superficie Melódica Continua (Pitch × Velocity)' : 'Force Continuous Melodic Surface (Pitch × Velocity)'}</option>
                  <option value="drum_kit_surface" ${config.unifiedSurfaceConfig?.topologyMode === 'drum_kit_surface' ? 'selected' : ''}>${isEs ? 'Forzar Kit Percusivo por Tecla (Aislar Notas / Continuo en Vel)' : 'Force Per-Key Drum Kit (Isolate Keys / Continuous in Vel)'}</option>
                </select>
              </div>
            </div>
          </fieldset>
          <fieldset class="conditioned-fieldset" ${isExtended && (config.unifiedSurfaceConfig?.resolutionStrategy ?? 'auto') === 'auto' ? 'disabled' : ''}>
            <div class="${isExtended && (config.unifiedSurfaceConfig?.resolutionStrategy ?? 'auto') === 'auto' ? 'is-conditioned-disabled' : ''}">
              <div class="label-with-val">
                <label>
                  ${isEs ? 'NIVEL DE COMPLEJIDAD' : 'COMPLEXITY LEVEL'}
                  ${isExtended && (config.unifiedSurfaceConfig?.resolutionStrategy ?? 'auto') === 'auto' ? `<span class="cond-reason-badge">${isEs ? 'AUTOMÁTICO SEGÚN CONTENIDO (Cambia a Manual arriba para fijar 1..10)' : 'AUTOMATIC BY CONTENT (Switch to Manual above to lock 1..10)'}</span>` : ''}
                </label>
                <span class="val-pill" id="val-cfg-complexity">${config.complexity} / 10 (${recDepth} stick modes)</span>
              </div>
              <div class="complexity-buttons-grid" role="radiogroup">
                ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
                  .map(
                    (v) => `
                  <button type="button" class="btn-complexity ${config.complexity === v ? 'is-active' : ''}" data-complexity="${v}">
                    ${v}
                  </button>
                `
                  )
                  .join('')}
              </div>
            </div>
          </fieldset>
        </div>

        <!-- 5. Acoustic Parameter Set (0..9) -->
        <div class="card">
          <div class="model-cfg-card-header">
            <h4>${ICONS.layers} ${isEs ? 'Parameter Set Canónico (Categoría de Modelado Físico)' : 'Canonical Parameter Set (Physical Modeling Category)'}</h4>
            <span class="nmm-hint">${isEs ? 'Determina el comportamiento del excitador/resonador de modelado físico en el hardware Hartmann' : 'Determines the physical modeling exciter/resonator behavior in the Hartmann hardware'}</span>
          </div>
          <div class="param-set-buttons-grid" role="radiogroup">
            ${pSets
              .map(
                (p) => `
              <button
                type="button"
                class="btn-param-set cat-${p.id} ${config.parameterSet === p.id ? 'is-active' : ''}"
                data-param-set="${p.id}"
                title="${p.id}: ${escAttr(p.name)} [${escAttr(p.category)}] — ${escAttr(p.description)}"
              >
                <span class="param-btn-num">${p.id}</span>
                <span class="param-btn-icon">${PARAM_SET_ICONS[p.id] ?? ICONS.param0}</span>
                <span class="param-btn-label">${escHtml(p.name)}</span>
                <span class="param-btn-cat">${escHtml(p.category)}</span>
              </button>
            `
              )
              .join('')}
          </div>
          <div class="param-set-info-card cat-${config.parameterSet}" id="cfg-param-set-info">
            <div class="param-set-info-header">
              <span class="param-badge">Set #${activeSet.id}</span>
              <strong>${escHtml(activeSet.name)}</strong>
            </div>
            <p class="param-set-desc">${escHtml(activeSet.description)}</p>
          </div>
        </div>
      </div>
    `;
}
