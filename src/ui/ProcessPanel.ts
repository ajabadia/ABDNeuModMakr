// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Process Panel Component
// Global Model Configuration (Summary HUD & Collapsible Icon Rail)
// ─────────────────────────────────────────────────────────

import type {
  ProcessConfig,
  ParameterSetInfo,
  Zone,
} from '../core/types';
import { bridgeClient } from '../core/bridge/BridgeClient';
import { cloudByokClient } from '../core/ai/CloudByokClient';
import { webNeuralEngine } from '../core/ai/WebNeuralEngine';
import { resolveAiSystemStatus } from '../core/ai/aiHonesty';
import { getAppLocale, onAppLocaleChange, tApp } from '../core/i18n';
import { ICONS } from './icons';
import { escAttr, escHtml } from './escape';
import type { ModelConfigTab } from './ModelConfigModal';

const STICK_MODES_BY_COMPLEXITY = [1, 4, 8, 12, 16, 24, 32, 42, 54, 64];

export interface ProcessPanelHandlers {
  onConfigChange: (config: ProcessConfig) => void;
  onStartProcess: () => void;
  onOpenMusicianWizard?: () => void;
  onOpenModelConfig?: (tab?: ModelConfigTab) => void;
  onOpenExportDestination?: () => void;
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
    onAppLocaleChange(() => {
      this.render();
    });
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
    const es = getAppLocale() === 'es';
    if (this.zones.length === 0) {
      return {
        canGenerate: false,
        notice: es ? 'No hay zonas de teclado definidas.' : 'No keyboard zones defined.',
        tooltip: es
          ? 'No se puede generar el modelo: Se requiere al menos una zona de teclado.'
          : 'Cannot generate model: At least one keyboard zone is required.',
      };
    }

    const missingSampleCount = this.zones.filter((z) => !z.sampleLow).length;
    if (missingSampleCount > 0) {
      const notice =
        missingSampleCount === this.zones.length
          ? tApp('processPanel.ctaNoSamplesNotice')
          : es
            ? `Falta muestra de audio en ${missingSampleCount} zona(s).`
            : `${missingSampleCount} zone(s) missing audio sample.`;
      return {
        canGenerate: false,
        notice,
        tooltip: `${es ? 'No se puede generar el modelo' : 'Cannot generate model'}: ${notice}`,
      };
    }

    if (this.coverageErrors.length > 0) {
      const firstError = this.coverageErrors[0];
      return {
        canGenerate: false,
        notice: firstError,
        tooltip: `${es ? 'No se puede generar el modelo' : 'Cannot generate model'}: ${firstError}`,
      };
    }

    const trimmedName = this.currentConfig.modelName.trim();
    if (trimmedName.length === 0) {
      return {
        canGenerate: false,
        notice: es ? 'El nombre del modelo no puede estar vacío.' : 'Model name cannot be blank.',
        tooltip: es
          ? 'No se puede generar el modelo: Indica un nombre válido.'
          : 'Cannot generate model: Please specify a valid model name.',
      };
    }

    const zoneWord =
      this.zones.length === 1
        ? tApp('processPanel.zoneSingular')
        : tApp('processPanel.zonePlural');
    return {
      canGenerate: true,
      notice: es
        ? `Listo para procesar • ${this.zones.length} ${zoneWord} configurada${this.zones.length === 1 ? '' : 's'}`
        : `Ready to process • ${this.zones.length} ${zoneWord} configured`,
      tooltip: tApp('processPanel.railGenerateTitle'),
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
    const byok = cloudByokClient.getConfig();
    const aiStatus = resolveAiSystemStatus({
      aiConfig: this.currentConfig.aiConfig,
      isBridgeConnected: bridgeClient.isConnected(),
      isCloudReady: Boolean(byok.enabled && cloudByokClient.hasValidKey()),
      localProvider: webNeuralEngine.getDeviceStatus().activeProvider,
    });
    const isAi = aiStatus.mode !== 'offline';

    // Apply class to parent column or workspace container
    const processMount = this.container.closest('.column-process');
    const workspaceCols = this.container.closest('.workspace-columns');
    if (processMount) {
      processMount.classList.toggle('is-collapsed-rail', this.isCollapsed);
    }
    if (workspaceCols) {
      workspaceCols.classList.toggle('is-sidebar-collapsed', this.isCollapsed);
    }

    const es = getAppLocale() === 'es';
    const editLabel = es ? 'Editar' : 'Edit';
    const settingsLabel = es ? 'Ajustes' : 'Settings';

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
            title="${escAttr(tApp('processPanel.railExpandTitle'))}"
            aria-label="${escAttr(tApp('processPanel.railExpandTitle'))}"
          >
            ${ICONS.chevronRight || '»'}
          </button>

          <!-- 2. High Visibility Mini Generate Button -->
          <button
            type="button"
            class="btn-rail-cta ${status.canGenerate ? 'is-ready' : ''}"
            id="btn-cta-process-mini"
            ${status.canGenerate ? '' : 'disabled'}
            title="${escAttr(status.tooltip)}"
            aria-label="${escAttr(status.tooltip)}"
          >
            ${ICONS.play}
          </button>

          <div class="rail-divider"></div>

          <!-- 3. Model Identity Icon -->
          <button
            type="button"
            class="rail-icon-btn"
            id="rail-btn-model"
            title="${escAttr(tApp('processPanel.railIdentityTitle'))} — #${String(this.currentConfig.modelNumber).padStart(3, '0')}: &quot;${escAttr(activeName)}&quot;"
          >
            ${ICONS.settings}
          </button>

          <!-- 4. Mode Icon -->
          <button
            type="button"
            class="rail-icon-btn ${isExt ? 'is-extended' : ''}"
            id="rail-btn-mode"
            title="${isExt ? (es ? 'Modo Extendido 2D (HD Multi-Capa)' : 'Extended 2D (HD Multi-Layer)') : (es ? 'Modo Clásico 1:1 Hardware' : 'Classic 1:1 Hardware')}"
          >
            ${ICONS.piano}
          </button>

          <!-- 5. Complexity & DSP Engine Icon -->
          <button
            type="button"
            class="rail-icon-btn"
            id="rail-btn-engine"
            title="${escAttr(tApp('processPanel.railEngineTitle'))} — L${this.currentConfig.complexity} (${recDepth})"
          >
            ${ICONS.cpu}
          </button>

          <!-- 6. Acoustic Parameter Set Icon -->
          <button
            type="button"
            class="rail-icon-btn"
            id="rail-btn-param"
            title="Parameter Set #${this.currentConfig.parameterSet}: ${escAttr(activeSet.name)}"
          >
            ${ICONS.layers}
          </button>

          <!-- 7. Metadata & Tags Icon -->
          <button
            type="button"
            class="rail-icon-btn ${tagCount > 0 ? 'has-tags' : ''}"
            id="rail-btn-metadata"
            title="${escAttr(tApp('processPanel.railMetadataTitle'))} (${tagCount} tags)"
          >
            ${ICONS.database}
          </button>

          <!-- 8. Cover Artwork Icon -->
          <button
            type="button"
            class="rail-icon-btn ${this.currentConfig.coverArtwork ? 'has-cover' : ''}"
            id="rail-btn-artwork"
            title="${escAttr(tApp('processPanel.railArtworkTitle'))}"
          >
            ${this.currentConfig.coverArtwork ? `<img src="${escAttr(this.currentConfig.coverArtwork.webpDataUrl)}" class="rail-cover-thumb" alt="Cover" />` : ICONS.wave}
          </button>

          <!-- 9. AI Engine Status Icon -->
          <button
            type="button"
            class="rail-icon-btn ${isAi ? 'is-ai-active' : ''}"
            id="rail-btn-ai"
            title="${escAttr(aiStatus.tooltip)}"
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
            <span class="panel-badge">${escHtml(tApp('processPanel.headerBadge'))}</span>
            <span class="panel-caption">${escHtml(tApp('processPanel.headerSubtitle'))}</span>
          </div>
          <div class="panel-header-actions">
            <button
              type="button"
              class="btn btn-xs btn-primary"
              id="btn-header-open-wizard"
              title="${escAttr(tApp('processPanel.btnWizardTitle'))}"
            >
              ${ICONS.sparkle} ${escHtml(tApp('processPanel.btnWizard'))}
            </button>
            <button
              type="button"
              class="btn btn-xs btn-outline btn-open-export-dest"
              id="btn-header-open-export"
              title="${escAttr(tApp('processPanel.btnExportTitle'))}"
            >
              ${ICONS.database} ${escHtml(tApp('processPanel.btnExport'))}
            </button>
            <button
              type="button"
              class="btn btn-xs btn-outline btn-open-model-config"
              id="btn-header-open-config"
              title="${escAttr(tApp('processPanel.btnConfigureTitle'))}"
            >
              ${ICONS.settings} ${escHtml(tApp('processPanel.btnConfigure'))}
            </button>
            <button
              type="button"
              class="btn-hud-icon btn-collapse-panel"
              id="btn-collapse-sidebar"
              title="${escAttr(tApp('processPanel.btnCollapseTitle'))}"
              aria-label="${escAttr(tApp('processPanel.btnCollapseTitle'))}"
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
            title="${escAttr(status.tooltip)}"
          >
            <span class="btn-icon">${ICONS.play}</span>
            <span>${escHtml(tApp('processPanel.ctaGenerate'))}</span>
          </button>
          <p class="cta-notice ${status.canGenerate ? 'is-ready' : 'is-warning'}" id="cta-process-notice">
            ${escHtml(status.notice)}
          </p>
        </div>

        <!-- Informative Summary HUD -->
        <div class="process-summary-hud">
          <!-- Card 1: Model Identity & Mode -->
          <div class="hud-card" id="hud-card-model" title="${escAttr(tApp('processPanel.railIdentityTitle'))}">
            <div class="hud-card-header">
              <span class="hud-card-label">${ICONS.settings} ${escHtml(tApp('processPanel.cardIdentityTitle'))}</span>
              <button type="button" class="btn-hud-link" id="btn-hud-edit-identity">${editLabel}</button>
            </div>
            <div class="hud-card-body">
              <div class="hud-model-main">
                <span class="hud-slot-pill">#${String(this.currentConfig.modelNumber).padStart(3, '0')}</span>
                <strong class="hud-model-name">${escHtml(activeName)}</strong>
              </div>
              <div class="hud-mode-row">
                <span class="panel-badge ${isExt ? 'badge-ai-on' : 'badge-muted'}">
                  ${isExt ? (es ? 'MODO EXTENDIDO (HD Multi-Capa)' : 'EXTENDED MODE (HD Multi-Layer)') : (es ? 'MODO CLÁSICO (Hardware 1:1)' : 'CLASSIC MODE (1:1 Hardware)')}
                </span>
              </div>
            </div>
          </div>

          <!-- Card 2: Engine, Complexity & Parameter Set -->
          <div class="hud-card" id="hud-card-engine" title="${escAttr(tApp('processPanel.railEngineTitle'))}">
            <div class="hud-card-header">
              <span class="hud-card-label">${ICONS.cpu} ${escHtml(tApp('processPanel.cardEngineTitle'))}</span>
              <button type="button" class="btn-hud-link" id="btn-hud-edit-engine">${editLabel}</button>
            </div>
            <div class="hud-card-body">
              <div class="hud-specs-row">
                <div class="hud-spec-pill">
                  <span class="spec-k">${es ? 'Formato:' : 'Format:'}</span>
                  <strong class="spec-v">${(this.currentConfig.targetFormat ?? 'dual').toUpperCase()}</strong>
                </div>
                <div class="hud-spec-pill">
                  <span class="spec-k">DSP:</span>
                  <strong class="spec-v">${this.currentConfig.dspAlgorithm === 'enhanced' ? 'Neural' : (es ? 'Clásico' : 'Legacy')}</strong>
                </div>
                <div class="hud-spec-pill">
                  <span class="spec-k">${es ? 'Modos:' : 'Modes:'}</span>
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
          <div class="hud-card ${!isExt ? 'is-conditioned-muted' : ''}" id="hud-card-metadata" title="${!isExt ? (es ? 'Exclusivo de Modo Extendido (HD) • Clic para inspeccionar' : 'Exclusive to Extended Mode (HD) • Click to inspect') : escAttr(tApp('processPanel.railMetadataTitle'))}">
            <div class="hud-card-header">
              <span class="hud-card-label">
                ${ICONS.database} ${escHtml(tApp('processPanel.cardMetadataTitle'))}
                ${!isExt ? `<span class="cond-reason-badge is-extended-only">${es ? 'SOLO EXTENDIDO' : 'EXTENDED ONLY'}</span>` : ''}
              </span>
              <button type="button" class="btn-hud-link" id="btn-hud-edit-metadata">${editLabel}</button>
            </div>
            <div class="hud-card-body">
              <div class="hud-meta-preview">
                ${
                  meta.author || meta.version || meta.license
                    ? `
                  <div class="hud-meta-chips">
                    ${meta.author ? `<span class="meta-tag-chip"><strong>${es ? 'Autor:' : 'Author:'}</strong> ${escHtml(meta.author)}</span>` : ''}
                    ${meta.version ? `<span class="meta-tag-chip"><strong>v:</strong> ${escHtml(meta.version)}</span>` : ''}
                    ${meta.license ? `<span class="meta-tag-chip"><strong>Lic:</strong> ${escHtml(meta.license)}</span>` : ''}
                  </div>
                `
                    : `<span class="text-muted">${es ? 'Sin autor/licencia definidos aún.' : 'No author/license defined yet.'}</span>`
                }
                <div class="hud-tags-count-row">
                  <span class="hud-tag-count-label">${tagCount} ${es ? 'Etiquetas SoundFont / Sampler' : 'SoundFont / Sampler Tags'}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Card 4: Cover Artwork -->
          <div class="hud-card ${!isExt ? 'is-conditioned-muted' : ''}" id="hud-card-artwork" title="${!isExt ? (es ? 'Exclusivo de Modo Extendido (HD) • Clic para inspeccionar' : 'Exclusive to Extended Mode (HD) • Click to inspect') : escAttr(tApp('processPanel.railArtworkTitle'))}">
            <div class="hud-card-header">
              <span class="hud-card-label">
                ${ICONS.palette} ${escHtml(tApp('processPanel.cardArtworkTitle'))}
                ${!isExt ? `<span class="cond-reason-badge is-extended-only">${es ? 'SOLO EXTENDIDO' : 'EXTENDED ONLY'}</span>` : ''}
              </span>
              <div class="hud-card-header-actions">
                <button type="button" class="btn-hud-link" id="btn-hud-ai-artwork" ${!isExt ? 'disabled' : ''} title="${!isExt ? (es ? 'Solo disponible en Modo Extendido' : 'Only available in Extended Mode') : (es ? 'Generar Portada con IA (Fase 20)' : 'Generate Cover with AI (Fase 20)')}">${ICONS.sparkle || ICONS.ai} IA</button>
                <button type="button" class="btn-hud-link" id="btn-hud-edit-artwork">${editLabel}</button>
              </div>
            </div>
            <div class="hud-card-body">
              <div class="hud-artwork-row">
                ${
                  this.isConvertingCover
                    ? `
                  <div class="hud-cover-placeholder">${ICONS.spinner}</div>
                  <div class="hud-artwork-meta">
                    <strong>${es ? 'Convirtiendo portada...' : 'Converting Artwork...'}</strong>
                    <span class="text-muted">${escHtml(this.convertingCoverFileName)}</span>
                  </div>
                `
                    : this.currentConfig.coverArtwork
                    ? `
                  <img src="${escAttr(this.currentConfig.coverArtwork.webpDataUrl)}" class="hud-cover-thumb" alt="Model Cover" />
                  <div class="hud-artwork-meta">
                    <strong>${es ? '512×512 WebP Adjunto' : '512×512 WebP Attached'}</strong>
                    <span class="text-muted">ABDAxionikVS &amp; Sampler HD</span>
                  </div>
                `
                    : `
                  <div class="hud-cover-placeholder">${ICONS.wave}</div>
                  <div class="hud-artwork-meta">
                    <span class="text-muted">${es ? 'Sin imagen de portada adjunta.' : 'No cover image attached.'}</span>
                  </div>
                `
                }
              </div>
            </div>
          </div>

          <!-- Card 5: AI Engine Assistance Status -->
          <div class="hud-card" id="hud-card-ai" title="${escAttr(aiStatus.tooltip)}">
            <div class="hud-card-header">
              <span class="hud-card-label">${ICONS.ai} ${escHtml(tApp('processPanel.cardAiTitle'))}</span>
              <button type="button" class="btn-hud-link" id="btn-hud-edit-ai">${settingsLabel}</button>
            </div>
            <div class="hud-card-body">
              <div class="ai-status-row">
                <span class="ai-status-badge ${isAi ? 'badge-ai-active' : 'badge-ai-off'}">
                  ${isAi ? `${ICONS.ai} <span>${escHtml(aiStatus.cardBadgeText)}</span>` : `${ICONS.cpu} <span>${escHtml(aiStatus.cardBadgeText)}</span>`}
                </span>
                <span class="text-muted">${escHtml(aiStatus.cardSubtitle)}</span>
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
    this.container.querySelector('#btn-header-open-wizard')?.addEventListener('click', () => {
      this.handlers.onOpenMusicianWizard?.();
    });
    this.container.querySelector('#btn-header-open-config')?.addEventListener('click', () => {
      this.handlers.onOpenModelConfig?.('general');
    });
    this.container.querySelector('#btn-header-open-export')?.addEventListener('click', () => {
      this.handlers.onOpenExportDestination?.();
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
