// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Process Panel Component
// Global Model Configuration (Model Name, Hardware Slot, Complexity 1..10,
// 10 Canonical Parameter Set Buttons, and Target Format Buttons)
// ─────────────────────────────────────────────────────────

import type { ProcessConfig, ParameterSetInfo, TargetFormat, Zone } from '../core/types';
import { ICONS } from './icons';

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

  public setConfig(
    config: ProcessConfig,
    validation?: ProcessValidationState
  ): void {
    this.currentConfig = { ...config };
    if (validation) {
      this.coverageErrors = validation.errors;
      this.zones = validation.zones;
    }
    const activeEl = document.activeElement;
    if (activeEl && this.container.contains(activeEl)) {
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

    this.syncCtaButton();
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
          <!-- 0. Working Mode (Classic vs Extended) -->
          <div class="form-group param-set-group">
            <label title="Working Mode governs interface limits and workflow (Classic = canonical Hartmann MODELmaker v1.2)">WORKING MODE</label>
            <div class="working-mode-buttons-grid" role="radiogroup" aria-label="Working Mode">
              <button
                type="button"
                class="btn-working-mode is-active"
                data-working-mode="classic"
                title="Classic Working Mode: Canonical Hartmann MODELmaker v1.2 rules (2 velocity layers 1..63 / 64..127, 11-char MName)"
              >
                Classic Mode
              </button>
              <button
                type="button"
                class="btn-working-mode is-disabled-future"
                data-working-mode="extended"
                disabled
                title="Extended Working Mode (multi-velocity splits, extended envelopes — coming in future phase; will save exclusively in Extended .nmmodel)"
              >
                Extended Mode <span class="mode-soon-tag">SOON</span>
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
            <label title="Selects the 20 mnAN/fdAN morphing axes for Scape and Sphere">PARAMETER SET (0..9)</label>
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

    const targetBtns = this.container.querySelectorAll<HTMLButtonElement>('.btn-target-format');
    targetBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const fmt = (btn.getAttribute('data-target-format') || 'dual') as TargetFormat;
        this.currentConfig.targetFormat = fmt;
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

