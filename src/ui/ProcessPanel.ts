// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Process Panel Component
// Global Model Configuration (Model Name, Hardware Slot, Complexity 1..10,
// 10 Canonical Parameter Set Buttons, and Target Format Buttons)
// ─────────────────────────────────────────────────────────

import type { DspAlgorithmMode, ProcessConfig, ParameterSetInfo, TargetFormat, WorkingMode, Zone } from '../core/types';
import { DEFAULT_AI_ASSISTANCE_CONFIG } from '../core/types';
import { ICONS } from './icons';

const EXTENDED_MODE_TITLE_ON =
  'Extended Working Mode: N velocity layers, 2D Key x Velocity regions, crossfades, loop markers, keytrack, and ADSR/Filter/LFO articulation. Adapted automatically when exporting to Classic (.model/.sound).';

const STICK_MODES_BY_COMPLEXITY = [1, 4, 8, 12, 16, 24, 32, 42, 54, 64];

const PARAM_SET_ICONS: Record<number, string> = {
  0: ICONS.param0,
  1: ICONS.param1,
  2: ICONS.param2,
  3: ICONS.param3,
  4: ICONS.param4,
  5: ICONS.param5,
  6: ICONS.param6,
  7: ICONS.param7,
  8: ICONS.param8,
  9: ICONS.param9,
};

export interface ProcessPanelHandlers {
  onConfigChange: (config: ProcessConfig) => void;
  onStartProcess: () => void;
  onAutoDetectParameterSet?: () => void;
  onOpenAiEngineModal?: () => void;
  onSelectCoverImage?: (file: File) => void;
  onRemoveCoverImage?: () => void;
}

export interface ProcessValidationState {
  errors: string[];
  zones: Zone[];
}

export class ProcessPanel {
  private container: HTMLElement;
  private parameterSets: ParameterSetInfo[];
  private handlers: ProcessPanelHandlers;
  private currentConfig: ProcessConfig;
  private coverageErrors: string[] = [];
  private zones: Zone[] = [];
  private isConvertingCover: boolean = false;
  private convertingCoverFileName: string = '';

  constructor(
    container: HTMLElement,
    initialConfig: ProcessConfig,
    parameterSets: ParameterSetInfo[],
    handlers: ProcessPanelHandlers,
    initialValidation?: ProcessValidationState
  ) {
    this.container = container;
    this.parameterSets = parameterSets;
    this.handlers = handlers;
    this.currentConfig = { ...initialConfig };
    if (initialValidation) {
      this.coverageErrors = initialValidation.errors;
      this.zones = initialValidation.zones;
    }
    this.render();
  }

  public setCoverConverting(converting: boolean, fileName?: string): void {
    this.isConvertingCover = converting;
    this.convertingCoverFileName = fileName ?? '';
    this.render();
  }

  public setConfig(
    config: ProcessConfig,
    validation?: ProcessValidationState
  ): void {
    const prevCoverUrl = this.currentConfig.coverArtwork?.webpDataUrl ?? null;
    const nextCoverUrl = config.coverArtwork?.webpDataUrl ?? null;
    const prevMode = this.currentConfig.workingMode ?? 'classic';
    const nextMode = config.workingMode ?? 'classic';
    this.currentConfig = { ...config };
    if (validation) {
      this.coverageErrors = validation.errors;
      this.zones = validation.zones;
    }
    const activeEl = document.activeElement;
    const isTypingInput =
      activeEl instanceof HTMLInputElement &&
      (activeEl.id === 'inp-model-name' || activeEl.id === 'inp-model-slot');
    if (
      isTypingInput &&
      this.container.contains(activeEl) &&
      prevCoverUrl === nextCoverUrl &&
      prevMode === nextMode &&
      !this.isConvertingCover
    ) {
      this.syncDomValues();
      return;
    }
    this.render();
  }

  public setValidation(errors: string[], zones: Zone[]): void {
    this.coverageErrors = errors;
    this.zones = zones;
    this.syncCtaButton();
  }

  public getSufficientDataStatus(): {
    canGenerate: boolean;
    notice: string;
    tooltip: string;
  } {
    if (this.zones.length === 0) {
      return {
        canGenerate: false,
        notice: 'No keyboard zones defined.',
        tooltip: 'Cannot generate model: At least one keyboard zone is required.',
      };
    }

    const missingSampleCount = this.zones.filter((z) => !z.sampleLow).length;
    if (missingSampleCount > 0) {
      const notice =
        missingSampleCount === this.zones.length
          ? 'Assign audio sample(s) to keyboard zones to enable generation.'
          : `${missingSampleCount} zone(s) missing audio sample.`;
      return {
        canGenerate: false,
        notice,
        tooltip: `Cannot generate model: ${notice}`,
      };
    }

    if (this.coverageErrors.length > 0) {
      const firstError = this.coverageErrors[0];
      return {
        canGenerate: false,
        notice: firstError,
        tooltip: `Cannot generate model: ${firstError}`,
      };
    }

    const trimmedName = this.currentConfig.modelName.trim();
    if (trimmedName.length === 0) {
      return {
        canGenerate: false,
        notice: 'Model name cannot be blank.',
        tooltip: 'Cannot generate model: Please specify a valid model name.',
      };
    }

    const zoneLabel = this.zones.length === 1 ? '1 zone' : `${this.zones.length} zones`;
    return {
      canGenerate: true,
      notice: `Ready to process • ${zoneLabel} configured`,
      tooltip: 'Run Spectral Analysis & Generate Model (Ctrl+P / Ctrl+Enter)',
    };
  }


  private getMaxNameLength(): number {
    return this.currentConfig.targetFormat === 'modern-neural' ? 32 : 11;
  }

  private syncDomValues(): void {
    const inpSlot = this.container.querySelector('#inp-model-slot') as HTMLInputElement | null;
    const inpName = this.container.querySelector('#inp-model-name') as HTMLInputElement | null;
    const valComp = this.container.querySelector('#val-complexity') as HTMLElement | null;
    const nameCounter = this.container.querySelector('#val-name-counter') as HTMLElement | null;

    const maxLen = this.getMaxNameLength();
    if (inpSlot && document.activeElement !== inpSlot) {
      inpSlot.value = String(this.currentConfig.modelNumber);
    }
    if (inpName) {
      inpName.maxLength = maxLen;
      if (document.activeElement !== inpName) {
        inpName.value = this.currentConfig.modelName;
      }
    }
    if (nameCounter) {
      const len = (inpName?.value ?? this.currentConfig.modelName).length;
      nameCounter.textContent = `${len} / ${maxLen}`;
    }
    if (valComp) {
      const recDepth = STICK_MODES_BY_COMPLEXITY[Math.max(0, Math.min(9, this.currentConfig.complexity - 1))] ?? 32;
      valComp.textContent = `${this.currentConfig.complexity} / 10 (${recDepth} modes)`;
    }

    // Sync Complexity buttons (1..10)
    const compBtns = this.container.querySelectorAll<HTMLButtonElement>('.btn-complexity');
    compBtns.forEach((btn) => {
      const val = parseInt(btn.getAttribute('data-complexity') || '8', 10);
      btn.classList.toggle('is-active', val === this.currentConfig.complexity);
    });

    // Sync Parameter Set buttons
    const paramBtns = this.container.querySelectorAll<HTMLButtonElement>('.btn-param-set');
    paramBtns.forEach((btn) => {
      const id = parseInt(btn.getAttribute('data-param-set') || '0', 10);
      btn.classList.toggle('is-active', id === this.currentConfig.parameterSet);
    });
    const infoCard = this.container.querySelector('#param-set-info-card') as HTMLElement;
    if (infoCard) {
      infoCard.className = `param-set-info-card cat-${this.currentConfig.parameterSet}`;
    }

    // Sync Target Format buttons
    const activeTarget = this.currentConfig.targetFormat ?? 'dual';
    const targetBtns = this.container.querySelectorAll<HTMLButtonElement>('.btn-target-format');
    targetBtns.forEach((btn) => {
      const fmt = btn.getAttribute('data-target-format');
      btn.classList.toggle('is-active', fmt === activeTarget);
    });

    // Sync DSP Algorithm buttons (Legacy vs Enhanced)
    const activeDsp = this.currentConfig.dspAlgorithm ?? 'legacy';
    const dspBtns = this.container.querySelectorAll<HTMLButtonElement>('.btn-dsp-algorithm');
    dspBtns.forEach((btn) => {
      const alg = btn.getAttribute('data-dsp-algorithm');
      btn.classList.toggle('is-active', alg === activeDsp);
    });

    this.syncWorkingModeButtons();
    this.syncAiButtons();
    this.syncCtaButton();
  }

  private syncAiButtons(): void {
    const isAi = this.currentConfig.aiConfig?.enabled ?? false;
    const badge = this.container.querySelector('#panel-ai-badge');
    if (badge) {
      badge.className = `ai-status-badge ${isAi ? 'badge-ai-active' : 'badge-ai-off'}`;
      badge.innerHTML = isAi ? `${ICONS.ai} <span>IA ACTIVA</span>` : `${ICONS.cpu} <span>100% DSP</span>`;
    }
    const btnDsp = this.container.querySelector('#btn-panel-ai-dsp');
    const btnAi = this.container.querySelector('#btn-panel-ai-modal');
    btnDsp?.classList.toggle('is-active', !isAi);
    btnAi?.classList.toggle('is-active', isAi);
  }

  /**
   * Syncs Working Mode buttons with the current config. Both Classic and
   * Extended creation modes are freely selectable at any time; when
   * exporting to classic ('legacy-neuron' or 'dual'), extended regions
   * are automatically adapted via extendedAdapter.
   */
  private syncWorkingModeButtons(): void {
    const mode = this.currentConfig.workingMode ?? 'classic';
    const modeBtns = this.container.querySelectorAll<HTMLButtonElement>('.btn-working-mode[data-working-mode]');
    modeBtns.forEach((btn) => {
      const m = btn.getAttribute('data-working-mode');
      btn.classList.toggle('is-active', m === mode || (m === 'classic' && mode !== 'extended'));
      if (m === 'extended') {
        btn.classList.remove('is-disabled-future');
        btn.removeAttribute('disabled');
        btn.title = EXTENDED_MODE_TITLE_ON;
        const tag = btn.querySelector('.mode-soon-tag') as HTMLElement | null;
        if (tag) tag.hidden = true;
      }
    });
  }

  private syncCtaButton(): void {
    const btn = this.container.querySelector('#btn-cta-process') as HTMLButtonElement | null;
    const notice = this.container.querySelector('#cta-process-notice') as HTMLElement | null;
    const status = this.getSufficientDataStatus();

    if (btn) {
      btn.disabled = !status.canGenerate;
      btn.title = status.tooltip;
    }
    if (notice) {
      notice.className = `cta-notice ${status.canGenerate ? 'is-ready' : 'is-warning'}`;
      notice.textContent = status.notice;
    }
  }

  private render(): void {
    const activeSet =
      this.parameterSets.find((p) => p.id === this.currentConfig.parameterSet) ||
      this.parameterSets[0];
    const maxLen = this.getMaxNameLength();
    const recDepth =
      STICK_MODES_BY_COMPLEXITY[Math.max(0, Math.min(9, this.currentConfig.complexity - 1))] ?? 32;
    const activeTarget = this.currentConfig.targetFormat ?? 'dual';
    const status = this.getSufficientDataStatus();

    this.container.innerHTML = `
      <div class="process-panel-card">
        <div class="panel-header">
          <div class="panel-header-title">
            <span class="panel-badge">MODEL GENERATOR</span>
            <span class="panel-caption">GLOBAL MODEL SETTINGS</span>
          </div>
        </div>

        <!-- 0. Top Action CTA: permanently visible at top of card -->
        <div class="process-cta-box">
          <button
            type="button"
            class="btn btn-primary btn-cta-process"
            id="btn-cta-process"
            ${status.canGenerate ? '' : 'disabled'}
            title="${status.tooltip}"
          >
            <span class="btn-icon">${ICONS.play}</span>
            <span>GENERATE NEURON MODEL</span>
          </button>
          <p class="cta-notice ${status.canGenerate ? 'is-ready' : 'is-warning'}" id="cta-process-notice">
            ${status.notice}
          </p>
        </div>

        <div class="process-form">
          <!-- 0. Working Mode (Classic vs Extended; extended gated on modern-neural) -->
          <div class="form-group param-set-group">
            <label title="Working Mode governs interface limits and workflow (Classic = canonical Hartmann MODELmaker v1.2)">WORKING MODE</label>
            <div class="working-mode-buttons-grid" role="radiogroup" aria-label="Working Mode">
              <button
                type="button"
                class="btn-working-mode ${(this.currentConfig.workingMode ?? 'classic') !== 'extended' ? 'is-active' : ''}"
                data-working-mode="classic"
                title="Classic Working Mode: Canonical Hartmann MODELmaker v1.2 rules (2 velocity layers 1..63 / 64..127, 11-char MName)"
              >
                Classic Mode
              </button>
              <button
                type="button"
                class="btn-working-mode ${(this.currentConfig.workingMode ?? 'classic') === 'extended' ? 'is-active' : ''}"
                data-working-mode="extended"
                title="${EXTENDED_MODE_TITLE_ON}"
              >
                Extended Mode
              </button>
            </div>
          </div>

          <!-- 1. Model Name (primary, auto-derived from first sample) & Hardware Slot -->
          <div class="form-row-name-slot">
            <div class="form-group">
              <div class="label-with-val">
                <label for="inp-model-name" title="Auto-filled from first sample if not edited manually. Hardware MName max 11 ASCII chars; Extended .nmmodel max 32.">MODEL NAME</label>
                <span class="val-pill" id="val-name-counter">${this.currentConfig.modelName.length} / ${maxLen}</span>
              </div>
              <input type="text" id="inp-model-name" maxlength="${maxLen}" value="${this.currentConfig.modelName}" placeholder="Auto from sample..." title="Model Name (max ${maxLen} chars)" />
            </div>

            <div class="form-group">
              <div class="label-with-val">
                <label for="inp-model-slot" title="Hardware NeuronDB directory index (000.model .. 511.model)">SLOT</label>
                <span class="val-pill" id="val-slot-badge">#${String(this.currentConfig.modelNumber).padStart(3, '0')}</span>
              </div>
              <div class="input-with-prefix">
                <span class="input-prefix">#</span>
                <input type="number" id="inp-model-slot" min="0" max="511" value="${this.currentConfig.modelNumber}" title="Hardware Model Slot (0..511)" />
              </div>
            </div>
          </div>

          ${
            (this.currentConfig.workingMode ?? 'classic') === 'extended'
              ? (() => {
                  const cov = this.currentConfig.coverArtwork;
                  const kb = cov ? (cov.byteLength / 1024).toFixed(1) : '0';
                  const isConv = this.isConvertingCover;
                  return `
          <!-- 1b. Fase 14: Model Cover Artwork (.webp) — Exclusive to Extended Mode -->
          <div class="form-group cover-artwork-group" id="cover-artwork-dropzone" title="Drag &amp; drop an image (PNG, JPG, WEBP, AVIF, SVG) or click to set the Extended Model Cover Artwork (auto-converted to 512x512 .webp in Layer 05)">
            <div class="label-with-val">
              <label>MODEL COVER ARTWORK (.WEBP)</label>
              <span class="val-pill ${cov ? 'is-ready-pill' : ''}">${isConv ? 'CONVERTING TO .WEBP...' : cov ? `WEBP • ${cov.width}×${cov.height} • ${kb} KB` : 'EXTENDED ONLY'}</span>
            </div>
            <div class="cover-artwork-card ${cov ? 'has-cover' : ''} ${isConv ? 'is-converting' : ''}">
              <div class="cover-artwork-thumb ${cov ? 'has-cover' : ''}" id="btn-pick-cover-thumb" title="${isConv ? 'Converting image...' : cov ? 'Click to view large preview (512×512)' : 'Click to upload image'}">
                ${
                  isConv
                    ? `<span class="cover-artwork-spinner" aria-label="Converting to WebP"></span>`
                    : cov
                      ? `<img src="${cov.webpDataUrl}" alt="${this.currentConfig.modelName} cover" class="cover-artwork-img" />
                         <span class="cover-thumb-hover-hint" aria-hidden="true">${ICONS.expand}</span>`
                      : `<span class="cover-artwork-placeholder">${ICONS.layers}</span>`
                }
              </div>
              <div class="cover-artwork-meta">
                <span class="cover-artwork-title">${isConv ? `Converting "${this.convertingCoverFileName || 'image'}" to .webp...` : cov ? `${cov.originalName || 'cover.webp'} → cover.webp` : 'Drop or Pick Cover Image'}</span>
                <span class="cover-artwork-sub">${isConv ? 'Center-cropping & encoding 512×512 RIFF WEBP...' : cov ? `Converted 512×512 WebP (${kb} KB) • 05_extended_model/cover.webp` : 'Converts JPG / PNG / SVG / WEBP to 512×512 .webp'}</span>
                <div class="cover-artwork-actions">
                  ${
                    cov && !isConv
                      ? `<button type="button" class="btn btn-xs btn-outline" id="btn-view-large-cover" title="Ver portada en grande (512×512 WebP)">${ICONS.expand} Ver en grande</button>`
                      : ''
                  }
                  <button type="button" class="btn btn-xs btn-outline" id="btn-pick-cover-image" ${isConv ? 'disabled' : ''}>
                    ${ICONS.folder} ${isConv ? 'Converting...' : cov ? 'Replace Cover...' : 'Upload Cover...'}
                  </button>
                  ${
                    cov && !isConv
                      ? `<button type="button" class="btn btn-xs btn-outline btn-danger-hover" id="btn-remove-cover-image" title="Remove cover artwork">${ICONS.trash}</button>`
                      : ''
                  }
                </div>
              </div>
              <input type="file" id="inp-cover-image-file" accept="image/*,.jpg,.jpeg,.png,.webp,.avif,.svg,.bmp" hidden />
            </div>

            <!-- Cover Artwork Modal Dialog (Modern <dialog> standard) -->
            ${
              cov
                ? `
            <dialog id="dlg-cover-preview" class="cover-artwork-dialog" aria-labelledby="dlg-cover-title">
              <div class="cover-dialog-shell">
                <div class="modal-header">
                  <div class="modal-title" id="dlg-cover-title">
                    <span>${ICONS.layers}</span>
                    <span>COVER ARTWORK PREVIEW</span>
                    <span class="val-pill is-ready-pill">512 × 512 WEBP</span>
                  </div>
                  <button type="button" class="btn-close-modal" id="btn-close-cover-modal" title="Cerrar modal (Esc)">
                    ${ICONS.close}
                  </button>
                </div>
                <div class="modal-body cover-dialog-body">
                  <div class="cover-dialog-preview-wrapper">
                    <img id="img-cover-dialog-preview" src="${cov.webpDataUrl}" alt="${this.currentConfig.modelName} cover preview" class="cover-dialog-preview-img" />
                  </div>
                  <div class="cover-dialog-meta-grid">
                    <div class="cover-meta-item">
                      <span class="cover-meta-label">FORMAT</span>
                      <span class="cover-meta-value">RIFF WEBP (512×512)</span>
                    </div>
                    <div class="cover-meta-item">
                      <span class="cover-meta-label">FILE SIZE</span>
                      <span class="cover-meta-value">${kb} KB</span>
                    </div>
                    <div class="cover-meta-item">
                      <span class="cover-meta-label">TARGET LAYER</span>
                      <span class="cover-meta-value">05_extended_model/cover.webp</span>
                    </div>
                    <div class="cover-meta-item">
                      <span class="cover-meta-label">ASPECT RATIO</span>
                      <span class="cover-meta-value">1:1 Square (Center-Cropped)</span>
                    </div>
                    <div class="cover-meta-item cover-meta-item-full">
                      <span class="cover-meta-label">ORIGINAL SOURCE</span>
                      <span class="cover-meta-value" title="${cov.originalName || 'cover.webp'}">${cov.originalName || 'cover.webp'}</span>
                    </div>
                  </div>
                </div>
                <div class="modal-footer cover-dialog-footer">
                  <div class="cover-dialog-footer-left">
                    <button type="button" class="btn btn-sm btn-outline" id="btn-dialog-replace-cover">
                      ${ICONS.folder} Replace Cover...
                    </button>
                    <button type="button" class="btn btn-sm btn-outline btn-danger-hover" id="btn-dialog-remove-cover">
                      ${ICONS.trash} Remove
                    </button>
                  </div>
                  <button type="button" class="btn btn-sm btn-primary" id="btn-dialog-close-cover">
                    Cerrar
                  </button>
                </div>
              </div>
            </dialog>`
                : ''
            }
          </div>
                  `;
                })()
              : ''
          }

          <div class="validation-inline-bar is-ok is-compact-hidden" id="val-config-status">
            <span class="val-status-icon">${ICONS.alert}</span>
            <span class="val-status-text" id="val-config-text"></span>
          </div>

          <!-- 2. Complexity Matrix (1..10 discrete levels) -->
          <div class="form-group complexity-group">
            <div class="label-with-val">
              <label title="Controls discrete stickModes / recDepth in .scape and .sphere frames">ANALYSIS COMPLEXITY (1..10)</label>
              <span class="val-pill" id="val-complexity">${this.currentConfig.complexity} / 10 (${recDepth} modes)</span>
            </div>
            <div class="complexity-buttons-grid" role="radiogroup" aria-label="Analysis Complexity (1..10)">
              ${STICK_MODES_BY_COMPLEXITY.map((modes, idx) => {
                const level = idx + 1;
                return `
                  <button
                    type="button"
                    class="btn-complexity ${level === this.currentConfig.complexity ? 'is-active' : ''}"
                    data-complexity="${level}"
                    title="Complexity ${level}: ${modes} stick modes (recursion depth)"
                  >
                    <span class="comp-btn-num">${level}</span>
                    <span class="comp-btn-modes">${modes}m</span>
                  </button>
                `;
              }).join('')}
            </div>
          </div>

          <!-- 3. Parameter Set (0..9) in Single Column with Representative Icons -->
          <div class="form-group param-set-group">
            <div class="label-with-val">
              <label title="Selects the 20 mnAN/fdAN morphing axes for Scape and Sphere">PARAMETER SET (0..9)</label>
              <button
                type="button"
                class="btn btn-xs btn-outline"
                id="btn-auto-detect-param-set"
                title="Auto-detect instrument category and optimal Parameter Set (0..9) from zone audio"
              >
                ${ICONS.cpu} Auto-Detect
              </button>
            </div>
            <div class="param-set-buttons-grid" role="radiogroup" aria-label="Parameter Set (0..9)">
              ${this.parameterSets
                .map(
                  (ps) => `
                <button
                  type="button"
                  class="btn-param-set cat-${ps.id} ${ps.id === this.currentConfig.parameterSet ? 'is-active' : ''}"
                  data-param-set="${ps.id}"
                  title="${ps.id}: ${ps.name} [${ps.category}] — ${ps.description}"
                >
                  <span class="param-btn-num">${ps.id}</span>
                  <span class="param-btn-icon">${PARAM_SET_ICONS[ps.id] ?? ICONS.param0}</span>
                  <span class="param-btn-label">${ps.name}</span>
                  <span class="param-btn-cat">${ps.category}</span>
                </button>
              `
                )
                .join('')}
            </div>

            <div class="param-set-info-card cat-${activeSet.id}" id="param-set-info-card">
              <div class="param-set-info-header">
                <span class="param-set-badge" id="disp-param-cat">${activeSet.category}</span>
                <span class="param-set-name" id="disp-param-name">${activeSet.id}: ${activeSet.name}</span>
              </div>
              <div class="param-set-desc" id="disp-param-desc">${activeSet.description}</div>
            </div>
          </div>

          <!-- 3b. DSP Algorithm Mode (Legacy 2001 DSP vs Enhanced Neural DSP) -->
          <div class="form-group param-set-group">
            <label title="Selects between canonical 2001 Legacy DSP and Enhanced DSP (HPSS + trajectory smoothing + noise floor suppression)">DSP ALGORITHM</label>
            <div class="working-mode-buttons-grid" role="radiogroup" aria-label="DSP Algorithm">
              <button
                type="button"
                class="btn-working-mode btn-dsp-algorithm ${(this.currentConfig.dspAlgorithm ?? 'legacy') !== 'enhanced' ? 'is-active' : ''}"
                data-dsp-algorithm="legacy"
                title="Legacy 2001 DSP: Canonical Hartmann MODELmaker v1.2 partial extraction"
              >
                Legacy DSP
              </button>
              <button
                type="button"
                class="btn-working-mode btn-dsp-algorithm ${(this.currentConfig.dspAlgorithm ?? 'legacy') === 'enhanced' ? 'is-active' : ''}"
                data-dsp-algorithm="enhanced"
                title="Enhanced DSP: HPSS harmonic-percussive separation, trajectory smoothing &amp; high-order noise floor suppression"
              >
                Enhanced DSP
              </button>
            </div>
          </div>

          <!-- 3c. AI Assistance vs Algorithmic DSP Engine -->
          <div class="form-group param-set-group">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
              <label title="Conmuta entre procesamiento 100% Algorítmico (DSP Local) y Asistencia por Modelos de IA (AudioSR, Demucs, Outpainting)">ASISTENCIA POR IA</label>
              <span class="ai-status-badge ${this.currentConfig.aiConfig?.enabled ? 'badge-ai-active' : 'badge-ai-off'}" id="panel-ai-badge">
                ${this.currentConfig.aiConfig?.enabled ? `${ICONS.ai} <span>IA ACTIVA</span>` : `${ICONS.cpu} <span>100% DSP</span>`}
              </span>
            </div>
            <div class="working-mode-buttons-grid" role="radiogroup" aria-label="Asistencia por IA">
              <button
                type="button"
                class="btn-working-mode btn-ai-config-mode ${!this.currentConfig.aiConfig?.enabled ? 'is-active' : ''}"
                id="btn-panel-ai-dsp"
                title="100% Algorítmico: Ejecuta todas las etapas con DSP matemático determinista en WebAudio"
              >
                ${ICONS.cpu} DSP Puro
              </button>
              <button
                type="button"
                class="btn-working-mode btn-ai-config-mode ${this.currentConfig.aiConfig?.enabled ? 'is-active' : ''}"
                id="btn-panel-ai-modal"
                title="Abrir matriz modular de Asistencia por IA (AudioSR, Demucs, Outpainting) o perfiles rápidos"
              >
                ${ICONS.ai} Configurar IA...
              </button>
            </div>
          </div>

          <!-- 4. Export / Save Mode (Dual, Classic, Extended) -->
          <div class="form-group param-set-group">
            <label title="Selects what format(s) are generated and saved on export: Dual (.model + .nmmodel), Classic (.model / .sound), or Extended (.nmmodel with source audio)">EXPORT / SAVE MODE</label>
            <div class="target-format-buttons-grid" role="radiogroup" aria-label="Export Mode">
              <button
                type="button"
                class="btn-target-format ${activeTarget === 'dual' ? 'is-active' : ''}"
                data-target-format="dual"
                title="Dual Export: Generates both Classic (.model + .sound) and Extended (.nmmodel + Samples/)"
              >
                Dual (Both)
              </button>
              <button
                type="button"
                class="btn-target-format ${activeTarget === 'legacy-neuron' ? 'is-active' : ''}"
                data-target-format="legacy-neuron"
                title="Classic Export: Hartmann Neuron (.model + .sound)"
              >
                Classic (.model)
              </button>
              <button
                type="button"
                class="btn-target-format ${activeTarget === 'modern-neural' ? 'is-active' : ''}"
                data-target-format="modern-neural"
                title="Extended Export: Float32 .nmmodel + original source audio samples"
              >
                Extended (.nmmodel)
              </button>
            </div>
          </div>
        </div>
      </div>
    `;


    this.bindEvents();
  }

  private updateValidationBanner(rawSlot: number, rawName: string): void {
    const bar = this.container.querySelector('#val-config-status') as HTMLElement | null;
    const txt = this.container.querySelector('#val-config-text') as HTMLElement | null;
    const slotBadge = this.container.querySelector('#val-slot-badge') as HTMLElement | null;
    const nameCounter = this.container.querySelector('#val-name-counter') as HTMLElement | null;
    const maxLen = this.getMaxNameLength();

    if (nameCounter) {
      nameCounter.textContent = `${rawName.length} / ${maxLen}`;
    }

    const clampedSlot = Math.min(511, Math.max(0, Number.isNaN(rawSlot) ? 0 : rawSlot));
    if (slotBadge) {
      slotBadge.textContent = `#${String(clampedSlot).padStart(3, '0')}`;
    }

    if (!bar || !txt) return;

    if (Number.isNaN(rawSlot) || rawSlot < 0 || rawSlot > 511) {
      bar.className = 'validation-inline-bar is-warning';
      txt.textContent = `Slot out of range (${rawSlot}) — clamped to #${String(clampedSlot).padStart(3, '0')} (valid: 0..511)`;
      return;
    }

    if (rawName.trim().length === 0) {
      bar.className = 'validation-inline-bar is-warning';
      txt.textContent = `Empty model name — will default to "UNTITLED"`;
      return;
    }

    if (/[^\x20-\x7E]/.test(rawName)) {
      bar.className = 'validation-inline-bar is-warning';
      txt.textContent = `Non-ASCII characters detected — hardware LCD supports ASCII 32..126`;
      return;
    }

    bar.className = 'validation-inline-bar is-ok is-compact-hidden';
    txt.textContent = '';
  }

  private bindEvents(): void {
    const inpSlot = this.container.querySelector('#inp-model-slot') as HTMLInputElement;
    const inpName = this.container.querySelector('#inp-model-name') as HTMLInputElement;

    inpSlot?.addEventListener('input', () => {
      const parsed = parseInt(inpSlot.value, 10);
      this.updateValidationBanner(parsed, inpName?.value ?? this.currentConfig.modelName);
      const val = Math.min(511, Math.max(0, Number.isNaN(parsed) ? 0 : parsed));
      this.currentConfig.modelNumber = val;
      this.handlers.onConfigChange({ ...this.currentConfig });
    });

    inpSlot?.addEventListener('blur', () => {
      inpSlot.value = String(this.currentConfig.modelNumber);
      this.updateValidationBanner(this.currentConfig.modelNumber, this.currentConfig.modelName);
    });

    inpName?.addEventListener('input', () => {
      const maxLen = this.getMaxNameLength();
      const raw = inpName.value;
      this.updateValidationBanner(this.currentConfig.modelNumber, raw);
      const val = raw.trim().slice(0, maxLen) || 'UNTITLED';
      this.currentConfig.modelName = val;
      this.handlers.onConfigChange({ ...this.currentConfig });
    });

    const valComp = this.container.querySelector('#val-complexity') as HTMLElement;
    const compBtns = this.container.querySelectorAll<HTMLButtonElement>('.btn-complexity');
    compBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const val = parseInt(btn.getAttribute('data-complexity') || '8', 10);
        const recDepth = STICK_MODES_BY_COMPLEXITY[Math.max(0, Math.min(9, val - 1))] ?? 32;
        if (valComp) {
          valComp.textContent = `${val} / 10 (${recDepth} modes)`;
        }
        compBtns.forEach((b) => b.classList.toggle('is-active', b === btn));
        this.currentConfig.complexity = val;
        this.handlers.onConfigChange({ ...this.currentConfig });
      });
    });

    const dispCat = this.container.querySelector('#disp-param-cat') as HTMLElement;
    const dispName = this.container.querySelector('#disp-param-name') as HTMLElement;
    const dispDesc = this.container.querySelector('#disp-param-desc') as HTMLElement;

    const paramBtns = this.container.querySelectorAll<HTMLButtonElement>('.btn-param-set');
    paramBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const setId = parseInt(btn.getAttribute('data-param-set') || '0', 10);
        this.currentConfig.parameterSet = setId;
        paramBtns.forEach((b) => b.classList.toggle('is-active', b === btn));
        const found = this.parameterSets.find((p) => p.id === setId);
        if (found) {
          const infoCardEl = this.container.querySelector('#param-set-info-card') as HTMLElement;
          if (infoCardEl) {
            infoCardEl.className = `param-set-info-card cat-${found.id}`;
          }
          dispCat.textContent = found.category;
          dispName.textContent = `${found.id}: ${found.name}`;
          dispDesc.textContent = found.description;
        }
        this.handlers.onConfigChange({ ...this.currentConfig });
      });
    });

    const modeBtns = this.container.querySelectorAll<HTMLButtonElement>('.btn-working-mode[data-working-mode]');
    modeBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.hasAttribute('disabled')) return;
        const m = (btn.getAttribute('data-working-mode') === 'extended' ? 'extended' : 'classic') as WorkingMode;
        if ((this.currentConfig.workingMode ?? 'classic') === m) return;
        this.currentConfig.workingMode = m;
        this.render();
        this.handlers.onConfigChange({ ...this.currentConfig });
      });
    });
    this.syncWorkingModeButtons();

    // Fase 14: Model Cover Artwork (.webp) file picker & drag-and-drop & Modal Preview
    const fileCoverInp = this.container.querySelector('#inp-cover-image-file') as HTMLInputElement | null;
    const triggerCoverPick = () => fileCoverInp?.click();
    this.container.querySelector('#btn-pick-cover-image')?.addEventListener('click', triggerCoverPick);

    const coverDialog = this.container.querySelector('#dlg-cover-preview') as HTMLDialogElement | null;
    const openCoverModal = () => {
      if (this.currentConfig.coverArtwork?.webpDataUrl && coverDialog) {
        if (typeof coverDialog.showModal === 'function') {
          coverDialog.showModal();
        } else {
          coverDialog.setAttribute('open', '');
        }
      }
    };
    const closeCoverModal = () => {
      if (coverDialog) {
        if (typeof coverDialog.close === 'function') {
          coverDialog.close();
        } else {
          coverDialog.removeAttribute('open');
        }
      }
    };

    if (this.currentConfig.coverArtwork) {
      this.container.querySelector('#btn-pick-cover-thumb')?.addEventListener('click', openCoverModal);
    } else {
      this.container.querySelector('#btn-pick-cover-thumb')?.addEventListener('click', triggerCoverPick);
    }

    this.container.querySelector('#btn-view-large-cover')?.addEventListener('click', openCoverModal);
    this.container.querySelector('#btn-close-cover-modal')?.addEventListener('click', closeCoverModal);
    this.container.querySelector('#btn-dialog-close-cover')?.addEventListener('click', closeCoverModal);
    this.container.querySelector('#btn-dialog-replace-cover')?.addEventListener('click', () => {
      closeCoverModal();
      triggerCoverPick();
    });
    this.container.querySelector('#btn-dialog-remove-cover')?.addEventListener('click', () => {
      closeCoverModal();
      this.handlers.onRemoveCoverImage?.();
    });

    // Close on backdrop click
    coverDialog?.addEventListener('click', (e) => {
      if (e.target === coverDialog) {
        closeCoverModal();
      }
    });

    fileCoverInp?.addEventListener('change', () => {
      const f = fileCoverInp.files?.[0];
      if (f) {
        this.handlers.onSelectCoverImage?.(f);
        fileCoverInp.value = '';
      }
    });
    this.container.querySelector('#btn-remove-cover-image')?.addEventListener('click', () => {
      this.handlers.onRemoveCoverImage?.();
    });
    const coverDropzone = this.container.querySelector('#cover-artwork-dropzone') as HTMLElement | null;
    if (coverDropzone) {
      coverDropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        coverDropzone.classList.add('is-dragover');
      });
      coverDropzone.addEventListener('dragleave', () => {
        coverDropzone.classList.remove('is-dragover');
      });
      coverDropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        coverDropzone.classList.remove('is-dragover');
        const f = e.dataTransfer?.files?.[0];
        if (
          f &&
          (f.type.startsWith('image/') ||
            /\.(jpe?g|png|webp|avif|svg|bmp|gif)$/i.test(f.name))
        ) {
          this.handlers.onSelectCoverImage?.(f);
        }
      });
    }

    const dspBtns = this.container.querySelectorAll<HTMLButtonElement>('.btn-dsp-algorithm');
    dspBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const alg = (btn.getAttribute('data-dsp-algorithm') === 'enhanced' ? 'enhanced' : 'legacy') as DspAlgorithmMode;
        if ((this.currentConfig.dspAlgorithm ?? 'legacy') === alg) return;
        this.currentConfig.dspAlgorithm = alg;
        dspBtns.forEach((b) => b.classList.toggle('is-active', b === btn));
        this.handlers.onConfigChange({ ...this.currentConfig });
      });
    });

    this.container.querySelector('#btn-auto-detect-param-set')?.addEventListener('click', () => {
      this.handlers.onAutoDetectParameterSet?.();
    });

    // AI Assistance buttons
    this.container.querySelector('#btn-panel-ai-dsp')?.addEventListener('click', () => {
      this.currentConfig.aiConfig = {
        ...(this.currentConfig.aiConfig ?? DEFAULT_AI_ASSISTANCE_CONFIG),
        enabled: false,
      };
      this.syncAiButtons();
      this.handlers.onConfigChange({ ...this.currentConfig });
    });

    this.container.querySelector('#btn-panel-ai-modal')?.addEventListener('click', () => {
      this.handlers.onOpenAiEngineModal?.();
    });

    const targetBtns = this.container.querySelectorAll<HTMLButtonElement>('.btn-target-format');
    targetBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const fmt = (btn.getAttribute('data-target-format') || 'dual') as TargetFormat;
        this.currentConfig.targetFormat = fmt;
        this.syncWorkingModeButtons();
        targetBtns.forEach((b) => b.classList.toggle('is-active', b === btn));
        const maxLen = this.getMaxNameLength();
        if (inpName) {
          inpName.maxLength = maxLen;
          if (this.currentConfig.modelName.length > maxLen) {
            this.currentConfig.modelName = this.currentConfig.modelName.slice(0, maxLen);
            inpName.value = this.currentConfig.modelName;
          }
        }
        this.updateValidationBanner(this.currentConfig.modelNumber, this.currentConfig.modelName);
        this.handlers.onConfigChange({ ...this.currentConfig });
      });
    });

    this.container.querySelector('#btn-cta-process')?.addEventListener('click', () => {
      if (!this.getSufficientDataStatus().canGenerate) return;
      this.handlers.onStartProcess();
    });
  }
}

