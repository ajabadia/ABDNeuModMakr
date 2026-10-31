// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Process Panel Component
// Global Model Configuration (Summary HUD & Collapsible Icon Rail)
// ─────────────────────────────────────────────────────────

import type {
  ProcessConfig,
  ParameterSetInfo,
  Zone,
} from '../core/types';
import { ICONS } from './icons';
import { escAttr, escHtml } from './escape';
import type { ModelConfigTab } from './ModelConfigModal';

const STICK_MODES_BY_COMPLEXITY = [1, 4, 8, 12, 16, 24, 32, 42, 54, 64];

export interface ProcessPanelHandlers {
  onConfigChange: (config: ProcessConfig) => void;
  onStartProcess: () => void;
  onOpenModelConfig?: (tab?: ModelConfigTab) => void;
  onOpenAiCoverGenerator?: () => void;
  onOpenAiEngineModal?: () => void;
  onSelectCoverImage?: (file: File) => void;
  onRemoveCoverImage?: () => void;
  onToggleCollapse?: (isCollapsed: boolean) => void;
}

export interface ProcessValidationState {
  errors: string[];
  zones: Zone[];
}

const STORAGE_KEY_PANEL_COLLAPSED = 'abd_model_panel_collapsed';

export class ProcessPanel {
  private container: HTMLElement;
  private parameterSets: ParameterSetInfo[];
  private handlers: ProcessPanelHandlers;
  private currentConfig: ProcessConfig;
  private coverageErrors: string[] = [];
  private zones: Zone[] = [];
  private isConvertingCover: boolean = false;
  private convertingCoverFileName: string = '';
  private isCollapsed: boolean = false;

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
    if (typeof localStorage !== 'undefined') {
      this.isCollapsed = localStorage.getItem(STORAGE_KEY_PANEL_COLLAPSED) === 'true';
    }
    this.render();
  }

  public getIsCollapsed(): boolean {
    return this.isCollapsed;
  }

  public toggleCollapse(): void {
    this.isCollapsed = !this.isCollapsed;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_PANEL_COLLAPSED, String(this.isCollapsed));
    }
    this.handlers.onToggleCollapse?.(this.isCollapsed);
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
    this.currentConfig = { ...config };
    if (validation) {
      this.coverageErrors = validation.errors;
      this.zones = validation.zones;
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

  private syncCtaButton(): void {
    const btn = this.container.querySelector('#btn-cta-process') as HTMLButtonElement | null;
    const btnMini = this.container.querySelector('#btn-cta-process-mini') as HTMLButtonElement | null;
    const notice = this.container.querySelector('#cta-process-notice') as HTMLElement | null;
    const status = this.getSufficientDataStatus();

    if (btn) {
      btn.disabled = !status.canGenerate;
      btn.title = status.tooltip;
    }
    if (btnMini) {
      btnMini.disabled = !status.canGenerate;
      btnMini.title = status.tooltip;
      btnMini.classList.toggle('is-ready', status.canGenerate);
    }
    if (notice) {
      notice.className = `cta-notice ${status.canGenerate ? 'is-ready' : 'is-warning'}`;
      notice.textContent = status.notice;
    }
  }

  private render(): void {
    const status = this.getSufficientDataStatus();
    const isExt = (this.currentConfig.workingMode ?? 'classic') === 'extended';
    const activeName = isExt
      ? (this.currentConfig.expandedName || this.currentConfig.modelName)
      : this.currentConfig.modelName;

    const activeSet =
      this.parameterSets.find((p) => p.id === this.currentConfig.parameterSet) ||
      this.parameterSets[0];
    const recDepth =
      STICK_MODES_BY_COMPLEXITY[Math.max(0, Math.min(9, this.currentConfig.complexity - 1))] ?? 32;

    const meta = this.currentConfig.extendedMetadata ?? {};
    const tagCount = Object.keys(meta.tags ?? {}).length;
    const isAi = this.currentConfig.aiConfig?.enabled ?? false;

    // Apply class to parent column or workspace container
    const processMount = this.container.closest('.column-process');
    const workspaceCols = this.container.closest('.workspace-columns');
    if (processMount) {
      processMount.classList.toggle('is-collapsed-rail', this.isCollapsed);
    }
    if (workspaceCols) {
      workspaceCols.classList.toggle('is-sidebar-collapsed', this.isCollapsed);
    }

    if (this.isCollapsed) {
      // ─────────────────────────────────────────────────────────
      // COLLAPSED RAIL VIEW (56px)
      // ─────────────────────────────────────────────────────────
      this.container.innerHTML = `
        <div class="process-panel-rail">
          <!-- 1. Expand Toggle Button -->
          <button
            type="button"
            class="btn-rail-toggle"
            id="btn-expand-sidebar"
            title="Expand Global Model Settings Panel"
            aria-label="Expand Global Model Settings Panel"
          >
            ${ICONS.chevronRight || '»'}
          </button>

          <!-- 2. High Visibility Mini Generate Button -->
          <button
            type="button"
            class="btn-rail-cta ${status.canGenerate ? 'is-ready' : ''}"
            id="btn-cta-process-mini"
            ${status.canGenerate ? '' : 'disabled'}
            title="${status.tooltip}"
            aria-label="${status.tooltip}"
          >
            ${ICONS.play}
          </button>

          <div class="rail-divider"></div>

          <!-- 3. Model Identity Icon -->
          <button
            type="button"
            class="rail-icon-btn"
            id="rail-btn-model"
            title="Model #${String(this.currentConfig.modelNumber).padStart(3, '0')}: &quot;${escAttr(activeName)}&quot; • Click to edit"
          >
            ${ICONS.settings}
          </button>

          <!-- 4. Mode Icon -->
          <button
            type="button"
            class="rail-icon-btn ${isExt ? 'is-extended' : ''}"
            id="rail-btn-mode"
            title="Mode: ${isExt ? 'Extended 2D (HD Multi-Layer)' : 'Classic 1:1 Hardware'} • Click to change"
          >
            ${ICONS.piano}
          </button>

          <!-- 5. Complexity & DSP Engine Icon -->
          <button
            type="button"
            class="rail-icon-btn"
            id="rail-btn-engine"
            title="Complexity: Level ${this.currentConfig.complexity} (${recDepth} modes) • DSP: ${this.currentConfig.dspAlgorithm ?? 'legacy'} • Click to edit"
          >
            ${ICONS.cpu}
          </button>

          <!-- 6. Acoustic Parameter Set Icon -->
          <button
            type="button"
            class="rail-icon-btn"
            id="rail-btn-param"
            title="Parameter Set #${this.currentConfig.parameterSet}: ${escAttr(activeSet.name)} • Click to edit"
          >
            ${ICONS.layers}
          </button>

          <!-- 7. Metadata & Tags Icon -->
          <button
            type="button"
            class="rail-icon-btn ${tagCount > 0 ? 'has-tags' : ''}"
            id="rail-btn-metadata"
            title="Metadata: ${tagCount} tags attached • Click to edit"
          >
            ${ICONS.database}
          </button>

          <!-- 8. Cover Artwork Icon -->
          <button
            type="button"
            class="rail-icon-btn ${this.currentConfig.coverArtwork ? 'has-cover' : ''}"
            id="rail-btn-artwork"
            title="Cover Artwork: ${this.currentConfig.coverArtwork ? '512×512 WebP attached' : 'None'} • Click to edit"
          >
            ${this.currentConfig.coverArtwork ? `<img src="${escAttr(this.currentConfig.coverArtwork.webpDataUrl)}" class="rail-cover-thumb" alt="Cover" />` : ICONS.wave}
          </button>

          <!-- 9. AI Engine Status Icon -->
          <button
            type="button"
            class="rail-icon-btn ${isAi ? 'is-ai-active' : ''}"
            id="rail-btn-ai"
            title="AI Engine: ${isAi ? 'Active' : 'Pure DSP'} • Click to configure"
          >
            ${isAi ? ICONS.ai : ICONS.sliders}
          </button>
        </div>
      `;

      this.bindCollapsedEvents();
      return;
    }

    // ─────────────────────────────────────────────────────────
    // EXPANDED INFORMATIVE HUD VIEW
    // ─────────────────────────────────────────────────────────
    this.container.innerHTML = `
      <div class="process-panel-card">
        <!-- Panel Header with Configure & Collapse buttons -->
        <div class="panel-header">
          <div class="panel-header-title">
            <span class="panel-badge">MODEL GENERATOR</span>
            <span class="panel-caption">GLOBAL MODEL SETTINGS</span>
          </div>
          <div class="panel-header-actions">
            <button
              type="button"
              class="btn btn-xs btn-outline btn-open-model-config"
              id="btn-header-open-config"
              title="Open Full Model Configuration Dialog (General, Articulation, Metadata, Artwork)"
            >
              ${ICONS.settings} Configure Model
            </button>
            <button
              type="button"
              class="btn-hud-icon btn-collapse-panel"
              id="btn-collapse-sidebar"
              title="Collapse to Icon Rail"
              aria-label="Collapse to Icon Rail"
            >
              ${ICONS.chevronLeft || '«'}
            </button>
          </div>
        </div>

        <!-- 0. Pinned Primary Action: Generate Button -->
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

        <!-- Informative Summary HUD -->
        <div class="process-summary-hud">
          <!-- Card 1: Model Identity & Mode -->
          <div class="hud-card" id="hud-card-model" title="Click to edit Model Name and Slot">
            <div class="hud-card-header">
              <span class="hud-card-label">${ICONS.settings} MODEL IDENTITY</span>
              <button type="button" class="btn-hud-link" id="btn-hud-edit-identity">Edit</button>
            </div>
            <div class="hud-card-body">
              <div class="hud-model-main">
                <span class="hud-slot-pill">#${String(this.currentConfig.modelNumber).padStart(3, '0')}</span>
                <strong class="hud-model-name">${escHtml(activeName)}</strong>
              </div>
              <div class="hud-mode-row">
                <span class="panel-badge ${isExt ? 'badge-ai-on' : 'badge-muted'}">
                  ${isExt ? 'EXTENDED MODE (HD Multi-Layer)' : 'CLASSIC MODE (1:1 Hardware)'}
                </span>
              </div>
            </div>
          </div>

          <!-- Card 2: Engine, Complexity & Parameter Set -->
          <div class="hud-card" id="hud-card-engine" title="Click to edit Engine and Complexity">
            <div class="hud-card-header">
              <span class="hud-card-label">${ICONS.cpu} RESYNTHESIS ENGINE</span>
              <button type="button" class="btn-hud-link" id="btn-hud-edit-engine">Edit</button>
            </div>
            <div class="hud-card-body">
              <div class="hud-specs-row">
                <div class="hud-spec-pill">
                  <span class="spec-k">Format:</span>
                  <strong class="spec-v">${(this.currentConfig.targetFormat ?? 'dual').toUpperCase()}</strong>
                </div>
                <div class="hud-spec-pill">
                  <span class="spec-k">DSP:</span>
                  <strong class="spec-v">${this.currentConfig.dspAlgorithm === 'enhanced' ? 'Neural' : 'Legacy'}</strong>
                </div>
                <div class="hud-spec-pill">
                  <span class="spec-k">Modes:</span>
                  <strong class="spec-v">L${this.currentConfig.complexity} (${recDepth}m)</strong>
                </div>
              </div>
              <div class="hud-param-set-row">
                <span class="param-badge">Set #${activeSet.id}</span>
                <span class="hud-param-set-title">${escHtml(activeSet.name)}</span>
              </div>
            </div>
          </div>

          <!-- Card 3: Extended Metadata & Tags -->
          <div class="hud-card" id="hud-card-metadata" title="Click to view or edit Metadata & Tags">
            <div class="hud-card-header">
              <span class="hud-card-label">${ICONS.database} METADATA &amp; PROVENANCE</span>
              <button type="button" class="btn-hud-link" id="btn-hud-edit-metadata">Edit</button>
            </div>
            <div class="hud-card-body">
              <div class="hud-meta-preview">
                ${
                  meta.author || meta.version || meta.license
                    ? `
                  <div class="hud-meta-chips">
                    ${meta.author ? `<span class="meta-tag-chip"><strong>Author:</strong> ${escHtml(meta.author)}</span>` : ''}
                    ${meta.version ? `<span class="meta-tag-chip"><strong>v:</strong> ${escHtml(meta.version)}</span>` : ''}
                    ${meta.license ? `<span class="meta-tag-chip"><strong>Lic:</strong> ${escHtml(meta.license)}</span>` : ''}
                  </div>
                `
                    : `<span class="text-muted">No author/license defined yet.</span>`
                }
                <div class="hud-tags-count-row">
                  <span class="hud-tag-count-label">${tagCount} SoundFont / Sampler Tags</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Card 4: Cover Artwork -->
          <div class="hud-card" id="hud-card-artwork" title="Click to view or edit Cover Artwork">
            <div class="hud-card-header">
              <span class="hud-card-label">${ICONS.palette} COVER ARTWORK</span>
              <div class="hud-card-header-actions">
                <button type="button" class="btn-hud-link" id="btn-hud-ai-artwork" title="Generate Cover with AI (Fase 20)">${ICONS.sparkle || ICONS.ai} AI</button>
                <button type="button" class="btn-hud-link" id="btn-hud-edit-artwork">Edit</button>
              </div>
            </div>
            <div class="hud-card-body">
              <div class="hud-artwork-row">
                ${
                  this.isConvertingCover
                    ? `
                  <div class="hud-cover-placeholder">${ICONS.spinner}</div>
                  <div class="hud-artwork-meta">
                    <strong>Converting Artwork...</strong>
                    <span class="text-muted">${escHtml(this.convertingCoverFileName)}</span>
                  </div>
                `
                    : this.currentConfig.coverArtwork
                    ? `
                  <img src="${escAttr(this.currentConfig.coverArtwork.webpDataUrl)}" class="hud-cover-thumb" alt="Model Cover" />
                  <div class="hud-artwork-meta">
                    <strong>512×512 WebP Attached</strong>
                    <span class="text-muted">ABDAxionikVS &amp; Sampler HD</span>
                  </div>
                `
                    : `
                  <div class="hud-cover-placeholder">${ICONS.wave}</div>
                  <div class="hud-artwork-meta">
                    <span class="text-muted">No cover image attached.</span>
                  </div>
                `
                }
              </div>
            </div>
          </div>

          <!-- Card 5: AI Engine Assistance Status -->
          <div class="hud-card" id="hud-card-ai" title="Configure AI Assistance / BYOK">
            <div class="hud-card-header">
              <span class="hud-card-label">${ICONS.ai} AI ASSISTANCE</span>
              <button type="button" class="btn-hud-link" id="btn-hud-edit-ai">Settings</button>
            </div>
            <div class="hud-card-body">
              <div class="ai-status-row">
                <span class="ai-status-badge ${isAi ? 'badge-ai-active' : 'badge-ai-off'}">
                  ${isAi ? `${ICONS.ai} <span>IA ACTIVA</span>` : `${ICONS.cpu} <span>100% DSP</span>`}
                </span>
                <span class="text-muted">WebGPU &bull; Companion Bridge &bull; Cloud</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.bindExpandedEvents();
  }

  // ─────────────────────────────────────────────────────────
  // Event Binding
  // ─────────────────────────────────────────────────────────
  private bindExpandedEvents(): void {
    // Generate Button
    this.container.querySelector('#btn-cta-process')?.addEventListener('click', () => {
      this.handlers.onStartProcess();
    });

    // Collapse toggle
    this.container.querySelector('#btn-collapse-sidebar')?.addEventListener('click', () => {
      this.toggleCollapse();
    });

    // Configure model header button
    this.container.querySelector('#btn-header-open-config')?.addEventListener('click', () => {
      this.handlers.onOpenModelConfig?.('general');
    });

    // HUD Card click / edit links
    this.container.querySelector('#hud-card-model')?.addEventListener('click', () => {
      this.handlers.onOpenModelConfig?.('general');
    });
    this.container.querySelector('#hud-card-engine')?.addEventListener('click', () => {
      this.handlers.onOpenModelConfig?.('general');
    });
    this.container.querySelector('#hud-card-metadata')?.addEventListener('click', () => {
      this.handlers.onOpenModelConfig?.('metadata');
    });
    this.container.querySelector('#btn-hud-ai-artwork')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handlers.onOpenAiCoverGenerator?.();
    });
    this.container.querySelector('#hud-card-artwork')?.addEventListener('click', () => {
      this.handlers.onOpenModelConfig?.('artwork');
    });
    this.container.querySelector('#hud-card-ai')?.addEventListener('click', () => {
      this.handlers.onOpenAiEngineModal?.();
    });
  }

  private bindCollapsedEvents(): void {
    // Expand toggle
    this.container.querySelector('#btn-expand-sidebar')?.addEventListener('click', () => {
      this.toggleCollapse();
    });

    // Mini CTA Generate
    this.container.querySelector('#btn-cta-process-mini')?.addEventListener('click', () => {
      this.handlers.onStartProcess();
    });

    // Rail icon buttons
    this.container.querySelector('#rail-btn-model')?.addEventListener('click', () => {
      this.handlers.onOpenModelConfig?.('general');
    });
    this.container.querySelector('#rail-btn-mode')?.addEventListener('click', () => {
      this.handlers.onOpenModelConfig?.('general');
    });
    this.container.querySelector('#rail-btn-engine')?.addEventListener('click', () => {
      this.handlers.onOpenModelConfig?.('general');
    });
    this.container.querySelector('#rail-btn-param')?.addEventListener('click', () => {
      this.handlers.onOpenModelConfig?.('general');
    });
    this.container.querySelector('#rail-btn-metadata')?.addEventListener('click', () => {
      this.handlers.onOpenModelConfig?.('metadata');
    });
    this.container.querySelector('#rail-btn-artwork')?.addEventListener('click', () => {
      this.handlers.onOpenModelConfig?.('artwork');
    });
    this.container.querySelector('#rail-btn-ai')?.addEventListener('click', () => {
      this.handlers.onOpenAiEngineModal?.();
    });
  }
}
