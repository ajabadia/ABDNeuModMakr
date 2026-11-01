// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Model Configuration & Properties Modal
// Dedicated multi-tab dialog for configuring all model-level
// settings (General & Engine, Articulation & Playback,
// Extended Metadata & Tags, and Cover Artwork).
// ─────────────────────────────────────────────────────────

import type {
  DspAlgorithmMode,
  ExtendedModelMetadata,
  ParameterSetInfo,
  ProcessConfig,
  TargetFormat,
  WorkingMode,
} from '../core/types';
import { ICONS } from './icons';
import { escHtml, escAttr } from './escape';
import { createModalFocusTrap, type FocusTrap } from './modalFocusTrap';
import { toast } from './notify';
import { STANDARD_SOUNDFONT_TAGS } from '../core/soundfontMetadata';

export type ModelConfigTab = 'general' | 'articulation' | 'metadata' | 'artwork';

export interface ModelConfigModalHandlers {
  getConfig: () => ProcessConfig;
  onConfigChange: (config: ProcessConfig) => void;
  getParameterSets: () => ParameterSetInfo[];
  getSublibraries?: () => import('../core/types.ts').SublibraryInfo[] | string[];
  onCreateSublibrary?: (name: string) => Promise<void>;
  onSelectCoverImage?: (file: File) => void;
  onRemoveCoverImage?: () => void;
  onReprocessFromPurestSource?: () => void;
  onOpenAiCoverGenerator?: () => void;
}

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

function getDefaultCoverIcon(config: ProcessConfig): { iconSvg: string; label: string } {
  const isExtended = (config.workingMode ?? 'classic') === 'extended';
  const isDrum = config.keyMappingMode === 'drum';
  const paramId = config.parameterSet;

  // 1. Drum Map Mode -> GM Drum icon
  if (isDrum) {
    return {
      iconSvg: ICONS.drum,
      label: 'GM Drum Map (Default Artwork)',
    };
  }

  // 2. Canonical Parameter Set (0..9)
  if (typeof paramId === 'number' && paramId >= 0 && paramId <= 9) {
    const pIcon = PARAM_SET_ICONS[paramId] ?? ICONS.param0;
    const pNames = [
      'Default Set',
      'Stringed / Bowed',
      'Plucked & Bells',
      'Plucked & Picked',
      'Carpet Shop',
      'Piano etc.',
      'Woodwinds',
      'Extreme Pads',
      'Loop Factory',
      'Multipurpose',
    ];
    return {
      iconSvg: pIcon,
      label: `${pNames[paramId] ?? `Set #${paramId}`} (Default Artwork)`,
    };
  }

  // 3. Extended mode without assigned parameter set
  if (isExtended) {
    return {
      iconSvg: ICONS.param0,
      label: 'Default Acoustic Model (Default Artwork)',
    };
  }

  return {
    iconSvg: ICONS.param0,
    label: 'Canonical Model (Default Artwork)',
  };
}

export class ModelConfigModal {
  private backdropEl: HTMLElement | null = null;
  private focusTrap: FocusTrap | null = null;
  private activeTab: ModelConfigTab = 'general';
  private handlers: ModelConfigModalHandlers;
  private customTagKey: string = '';
  private selectedTagDropdownKey: string = 'custom';

  constructor(handlers: ModelConfigModalHandlers) {
    this.handlers = handlers;
  }

  public open(tab: ModelConfigTab = 'general'): void {
    this.activeTab = tab;
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

  public updateConfig(): void {
    if (this.backdropEl) {
      this.render();
    }
  }

  private render(): void {
    const config = this.handlers.getConfig();
    const isExtended = (config.workingMode ?? 'classic') === 'extended';

    if (!this.backdropEl) {
      this.backdropEl = document.createElement('div');
      this.backdropEl.className = 'nmm-modal-backdrop model-config-backdrop';
      document.body.appendChild(this.backdropEl);

      this.backdropEl.addEventListener('click', (e) => {
        if (e.target === this.backdropEl) this.close();
      });
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.backdropEl) this.close();
      });
    }

    let tabBodyHtml = '';
    if (this.activeTab === 'general') {
      tabBodyHtml = this.renderGeneralTab(config);
    } else if (this.activeTab === 'articulation') {
      tabBodyHtml = this.renderArticulationTab(config);
    } else if (this.activeTab === 'metadata') {
      tabBodyHtml = this.renderMetadataTab(config);
    } else if (this.activeTab === 'artwork') {
      tabBodyHtml = this.renderArtworkTab(config);
    }

    const tagCount = config.extendedMetadata?.customAttributes?.length ?? 0;

    this.backdropEl.innerHTML = `
      <div class="nmm-modal-window model-config-window" role="dialog" aria-modal="true" aria-labelledby="model-config-title">
        <header class="nmm-modal-header">
          <div class="nmm-modal-header-title">
            <span class="nmm-modal-header-icon">${ICONS.sliders}</span>
            <h2 id="model-config-title">Model Configuration</h2>
            <span class="panel-badge ${isExtended ? 'badge-ai-on' : 'badge-muted'}">
              ${isExtended ? 'EXTENDED MODE (HD)' : 'CLASSIC 1:1 HARDWARE'}
            </span>
          </div>
          <button type="button" class="nmm-modal-close" aria-label="Close" id="btn-model-config-close">
            ${ICONS.close || '✕'}
          </button>
        </header>

        <!-- Navigation Tabs -->
        <nav class="model-config-tabs-nav" aria-label="Model Configuration Sections">
          <button type="button" class="model-tab-btn ${this.activeTab === 'general' ? 'is-active' : ''}" data-tab="general">
            <span class="tab-icon">${ICONS.cpu}</span>
            <div class="tab-label">
              <span class="tab-title">Mode &amp; Engine</span>
              <span class="tab-sub">Neuron 2002 / HD Multi-Layer</span>
            </div>
          </button>
          <button type="button" class="model-tab-btn ${this.activeTab === 'articulation' ? 'is-active' : ''}" data-tab="articulation">
            <span class="tab-icon">${ICONS.piano}</span>
            <div class="tab-label">
              <span class="tab-title">Playback &amp; Articulation</span>
              <span class="tab-sub">Glide, Bend &amp; Standard 24/96</span>
            </div>
          </button>
          <button type="button" class="model-tab-btn ${this.activeTab === 'metadata' ? 'is-active' : ''}" data-tab="metadata">
            <span class="tab-icon">${ICONS.database}</span>
            <div class="tab-label">
              <span class="tab-title">Metadata &amp; Tags</span>
              <span class="tab-sub">${tagCount > 0 ? `${tagCount} Tags Defined` : 'SoundFont &amp; Provenance'}</span>
            </div>
          </button>
          <button type="button" class="model-tab-btn ${this.activeTab === 'artwork' ? 'is-active' : ''}" data-tab="artwork">
            <span class="tab-icon">${ICONS.palette}</span>
            <div class="tab-label">
              <span class="tab-title">Cover Artwork</span>
              <span class="tab-sub">${config.coverArtwork ? '512×512 WebP Attached' : 'No Cover Image'}</span>
            </div>
          </button>
        </nav>

        <div class="nmm-modal-body model-config-body">
          ${tabBodyHtml}
        </div>
      </div>
    `;

    if (!this.focusTrap && this.backdropEl) {
      this.focusTrap = createModalFocusTrap(this.backdropEl, {
        onEscape: () => this.close(),
        initialFocusSelector: '#btn-model-config-close',
      });
      this.focusTrap.activate();
    }

    this.bindEvents();
  }

  // ─────────────────────────────────────────────────────────
  // TAB 1: General & Engine
  // ─────────────────────────────────────────────────────────
  private renderGeneralTab(config: ProcessConfig): string {
    const isExtended = (config.workingMode ?? 'classic') === 'extended';
    const pSets = this.handlers.getParameterSets();
    const activeSet = pSets.find((p) => p.id === config.parameterSet) || pSets[0];
    const recDepth = STICK_MODES_BY_COMPLEXITY[Math.max(0, Math.min(9, config.complexity - 1))] ?? 32;

    const currentSub = config.sublibrary || 'Default';
    const sublibsRaw = this.handlers.getSublibraries?.() ?? ['Default'];
    const sublibNames = sublibsRaw.map((s) => (typeof s === 'string' ? s : s.name));
    if (!sublibNames.includes('Default')) sublibNames.unshift('Default');
    if (!sublibNames.includes(currentSub)) sublibNames.push(currentSub);

    const sublibOptionsHtml = sublibNames
      .map((name) => `<option value="${escAttr(name)}" ${name === currentSub ? 'selected' : ''}>${escHtml(name)}</option>`)
      .join('');

    return `
      <div class="model-cfg-grid">
        <!-- 1. Identity & Slot -->
        <div class="model-cfg-card">
          <div class="model-cfg-card-header">
            <h4>${ICONS.settings} Model Identity &amp; Naming</h4>
            <span class="cfg-hint">Hardware memory location, classic display name and extended next-gen title</span>
          </div>
          <div class="model-identity-dual-grid">
            <!-- Row 1: Classic Hardware Name + Slot -->
            <div class="form-row-classic-identity">
              <div class="form-group flex-1">
                <div class="label-with-val">
                  <label for="inp-cfg-model-name">
                    ${ICONS.cpu} CLASSIC MODEL NAME (HARTMANN HARDWARE)
                  </label>
                  <span class="val-pill" id="val-cfg-name-counter">
                    ${(config.modelName || '').length}/11 chars
                  </span>
                </div>
                <input
                  type="text"
                  id="inp-cfg-model-name"
                  class="form-control"
                  maxlength="11"
                  value="${escAttr(config.modelName || '')}"
                  placeholder="Max 11 chars (e.g. Lead01)..."
                />
              </div>

              <div class="form-group form-group-slot">
                <div class="label-with-val">
                  <label for="inp-cfg-model-slot">HARDWARE SLOT</label>
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

            <!-- Row 2: Extended / Modern Name (No character limit, no bank number) -->
            <div class="form-row-extended-identity">
              <div class="form-group flex-1">
                <div class="label-with-val">
                  <label for="inp-cfg-expanded-name">
                    ${ICONS.layers} EXTENDED MODEL NAME (MODERN / AXIONIK)
                  </label>
                  <span class="val-pill" id="val-cfg-expanded-counter">
                    ${(config.expandedName || config.modelName || '').length} chars (No limit)
                  </span>
                </div>
                <input
                  type="text"
                  id="inp-cfg-expanded-name"
                  class="form-control"
                  value="${escAttr(config.expandedName ?? config.modelName ?? '')}"
                  placeholder="Unrestricted full patch title (e.g. Cinematic Acoustic Guitar 1974 Strumming)..."
                />
              </div>
              <div class="form-group form-group-subbank-preview">
                <div class="label-with-val">
                  <label for="sel-cfg-sublibrary">SUB-LIBRARY (Fase 23)</label>
                  <span class="val-pill" id="val-cfg-sublib-ordinal">#${config.sublibraryOrdinal ?? 1}</span>
                </div>
                <div style="display: flex; gap: 6px; align-items: center;">
                  <select id="sel-cfg-sublibrary" class="form-control" style="flex: 1;" title="Assign model to sub-library in AxionikDB">
                    ${sublibOptionsHtml}
                  </select>
                  <button type="button" class="btn btn-outline btn-xs" id="btn-cfg-new-sublibrary" title="Create new sub-library..." style="padding: 4px 8px;">
                    ${ICONS.folder || '+'}
                  </button>
                  <input
                    type="number"
                    id="inp-cfg-sublib-ordinal"
                    class="form-control"
                    min="1"
                    max="999"
                    value="${config.sublibraryOrdinal ?? 1}"
                    title="Ordinal position index in sub-library"
                    style="width: 58px; text-align: center;"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 2. Creation & Keyboard Mapping Mode -->
        <div class="model-cfg-card">
          <div class="model-cfg-card-header">
            <h4>${ICONS.piano} Creation &amp; Keyboard Mapping Mode</h4>
            <span class="cfg-hint">Governs keyboard structure, velocity layers, and physical hardware constraints</span>
          </div>
          <div class="settings-working-mode-grid">
            <label class="settings-mode-opt ${!isExtended ? 'is-selected' : ''}">
              <input type="radio" name="cfg-working-mode" value="classic" ${!isExtended ? 'checked' : ''} />
              <div class="mode-opt-body">
                <div class="mode-opt-title">
                  <strong>Classic Mode (Hartmann Neuron 2002)</strong>
                  <span class="panel-badge badge-muted">1:1 Hardware Original</span>
                </div>
                <p class="text-muted">
                  Contiguous keyboard <code>0..127</code> columns with no gaps or overlaps. Two velocity layers fixed at value <code>64</code> (Low and High). Model names strictly capped at 11 characters for physical display compatibility.
                </p>
              </div>
            </label>

            <label class="settings-mode-opt ${isExtended ? 'is-selected' : ''}">
              <input type="radio" name="cfg-working-mode" value="extended" ${isExtended ? 'checked' : ''} />
              <div class="mode-opt-body">
                <div class="mode-opt-title">
                  <strong>Extended Mode (Modern Neural / Next-Gen)</strong>
                  <span class="panel-badge badge-ai-on">HD Multi-Layer</span>
                </div>
                <p class="text-muted">
                  Arbitrary 2D mapping (Key &times; Velocity). Multiple velocity splits, dynamic crossfades, DAHDSR envelopes, ping-pong loops, and 512&times;512 WebP model cover artwork.
                </p>
              </div>
            </label>
          </div>

          <div class="settings-mode-reassurance-box">
            <span class="reassurance-icon">${ICONS.check}</span>
            <div class="reassurance-text">
              <strong>Safe Non-Destructive Bidirectional Compatibility:</strong>
              <p>
                You can switch between Classic and Extended modes at any time. When switching back to Classic Mode, multi-layer velocity regions are <strong>not deleted</strong>: the compiler mathematically projects and compensates relative gains (<span class="math-snippet">10<sup>&Delta;G/20</sup></span>) to preserve exact sonic balance within original hardware constraints.
              </p>
            </div>
          </div>
        </div>

        <!-- 3. Target Format & DSP Engine -->
        <div class="model-cfg-card">
          <div class="model-cfg-card-header">
            <h4>${ICONS.cpu} Target Export Format &amp; Resynthesis Engine</h4>
            <span class="cfg-hint">Compilation destination files and spectral modeling pipeline</span>
          </div>
          <div class="model-cfg-engine-row">
            <div class="form-group">
              <label>TARGET EXPORT FORMAT</label>
              <div class="btn-group-toggle" role="radiogroup">
                <button type="button" class="btn-target-format ${(config.targetFormat ?? 'dual') === 'dual' ? 'is-active' : ''}" data-fmt="dual">
                  Dual (.model + .sound)
                </button>
                <button type="button" class="btn-target-format ${(config.targetFormat ?? 'dual') === 'legacy-neuron' ? 'is-active' : ''}" data-fmt="legacy-neuron">
                  Legacy Neuron (.model)
                </button>
                <button type="button" class="btn-target-format ${(config.targetFormat ?? 'dual') === 'modern-neural' ? 'is-active' : ''}" data-fmt="modern-neural">
                  Modern Neural (.sound)
                </button>
              </div>
            </div>

            <div class="form-group">
              <label>DSP RESYNTHESIS ALGORITHM</label>
              <div class="btn-group-toggle" role="radiogroup">
                <button type="button" class="btn-dsp-algorithm ${(config.dspAlgorithm ?? 'legacy') === 'legacy' ? 'is-active' : ''}" data-alg="legacy">
                  Hartmann Legacy (2002)
                </button>
                <button type="button" class="btn-dsp-algorithm ${(config.dspAlgorithm ?? 'legacy') === 'enhanced' ? 'is-active' : ''}" data-alg="enhanced">
                  Modern Neural Resynthesis
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- 4. Analysis Complexity (1..10) -->
        <div class="model-cfg-card">
          <div class="model-cfg-card-header">
            <h4>${ICONS.wave} Analysis Complexity &amp; Modal Density</h4>
            <span class="cfg-hint">Controls FFT stick mode resolution: higher levels retain harmonic shimmer at cost of compile time</span>
          </div>
          <div class="label-with-val">
            <label>COMPLEXITY LEVEL</label>
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

        <!-- 5. Acoustic Parameter Set (0..9) -->
        <div class="model-cfg-card">
          <div class="model-cfg-card-header">
            <h4>${ICONS.layers} Canonical Parameter Set (Physical Modeling Category)</h4>
            <span class="cfg-hint">Determines the physical modeling exciter/resonator behavior in the Hartmann hardware</span>
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

  // ─────────────────────────────────────────────────────────
  // TAB 2: Playback & Articulation
  // ─────────────────────────────────────────────────────────
  private renderArticulationTab(config: ProcessConfig): string {
    const cp = config.commonPlayback ?? {
      loopMode: 'no_loop',
      pitchKeytrack: 100,
      trigger: 'attack',
      fadeCurve: 'equal-power',
    };

    return `
      <div class="model-cfg-grid">
        <div class="model-cfg-card">
          <div class="model-cfg-card-header">
            <h4>${ICONS.piano} Global Instrument Playback &amp; Keytrack</h4>
            <span class="cfg-hint">Global defaults applied across all model zones and regions</span>
          </div>

          <div class="form-row-dual">
            <div class="form-group flex-1">
              <label for="sel-cfg-loop-mode">DEFAULT LOOP MODE</label>
              <select id="sel-cfg-loop-mode" class="form-control">
                <option value="no_loop" ${cp.loopMode === 'no_loop' ? 'selected' : ''}>One-Shot (No Loop)</option>
                <option value="loop_continuous" ${cp.loopMode === 'loop_continuous' ? 'selected' : ''}>Continuous Forward Loop</option>
                <option value="ping_pong" ${cp.loopMode === 'ping_pong' ? 'selected' : ''}>Ping-Pong (Alternate)</option>
                <option value="loop_sustain" ${cp.loopMode === 'loop_sustain' ? 'selected' : ''}>Sustain Loop (Release One-Shot)</option>
              </select>
            </div>

            <div class="form-group flex-1">
              <label for="sel-cfg-trigger">NOTE TRIGGER LOGIC</label>
              <select id="sel-cfg-trigger" class="form-control">
                <option value="attack" ${cp.trigger === 'attack' ? 'selected' : ''}>Attack (Key-On Normal)</option>
                <option value="release" ${cp.trigger === 'release' ? 'selected' : ''}>Release Trigger (Key-Off Release Sample)</option>
                <option value="first" ${cp.trigger === 'first' ? 'selected' : ''}>Legato First Note Only</option>
                <option value="legato" ${cp.trigger === 'legato' ? 'selected' : ''}>Legato Connected Notes Only</option>
              </select>
            </div>
          </div>

          <div class="form-row-dual">
            <div class="form-group flex-1">
              <label for="sel-cfg-fade-curve">CROSSFADE CURVE</label>
              <select id="sel-cfg-fade-curve" class="form-control">
                <option value="equal-power" ${cp.fadeCurve === 'equal-power' ? 'selected' : ''}>Equal Power (3dB Dip Free - Acoustic Standard)</option>
                <option value="linear" ${cp.fadeCurve === 'linear' ? 'selected' : ''}>Linear Gain</option>
                <option value="spectral-morph" ${cp.fadeCurve === 'spectral-morph' ? 'selected' : ''}>Spectral Morph</option>
              </select>
            </div>

            <div class="form-group flex-1">
              <div class="label-with-val">
                <label for="inp-cfg-keytrack">PITCH KEYTRACK</label>
                <span class="val-pill" id="val-cfg-keytrack">${cp.pitchKeytrack ?? 100}%</span>
              </div>
              <input
                type="range"
                id="inp-cfg-keytrack"
                min="0"
                max="200"
                step="5"
                value="${cp.pitchKeytrack ?? 100}"
                class="form-range"
              />
            </div>
          </div>
        </div>

        <div class="model-cfg-card">
          <div class="model-cfg-card-header">
            <h4>${ICONS.wave} Master 24/96 Standard &amp; Dynamic Range</h4>
            <span class="cfg-hint">Studio-grade master wave resynthesis standards</span>
          </div>
          <p class="cfg-explainer">
            When Master 24/96 processing is applied, original samples are promoted using cubic hermite interpolation and zero-crossing seam alignment. This ensures zero phase distortion when models are triggered in polyphonic environments.
          </p>
          <div class="master-specs-grid">
            <div class="master-spec-badge">
              <strong>SAMPLE RATE</strong>
              <span>96.000 Hz</span>
            </div>
            <div class="master-spec-badge">
              <strong>BIT DEPTH</strong>
              <span>24-bit PCM</span>
            </div>
            <div class="master-spec-badge">
              <strong>SEAM SNAPPING</strong>
              <span>Zero-Crossing &plusmn;128 smp</span>
            </div>
            <div class="master-spec-badge">
              <strong>PHASE CORRELATION</strong>
              <span>Stereo Orthogonal</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ─────────────────────────────────────────────────────────
  // TAB 3: Metadata & Tags
  // ─────────────────────────────────────────────────────────
  private renderMetadataTab(config: ProcessConfig): string {
    const meta: ExtendedModelMetadata = config.extendedMetadata ?? {};
    const customAttrs = meta.customAttributes ?? [];

    return `
      <div class="model-cfg-grid">
        <!-- 1. General Provenance & Attribution -->
        <div class="model-cfg-card">
          <div class="model-cfg-card-header">
            <h4>${ICONS.database} Extended Model Provenance &amp; Attribution</h4>
            <span class="cfg-hint">Preserved across AxionikDB and modern sampler instruments</span>
          </div>

          <div class="form-row-dual">
            <div class="form-group flex-1">
              <label for="inp-cfg-meta-author">AUTHOR / SOUND DESIGNER</label>
              <input
                type="text"
                id="inp-cfg-meta-author"
                class="form-control"
                value="${escAttr(meta.author ?? '')}"
                placeholder="Sound designer or creator name..."
              />
            </div>
            <div class="form-group flex-1">
              <label for="inp-cfg-meta-version">VERSION</label>
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
              <label for="inp-cfg-meta-license">LICENSE</label>
              <input
                type="text"
                id="inp-cfg-meta-license"
                class="form-control"
                value="${escAttr(meta.license ?? '')}"
                placeholder="e.g. CC-BY 4.0, CC0, Commercial"
              />
            </div>
            <div class="form-group flex-1">
              <label for="inp-cfg-meta-url">SOURCE / SF2 ORIGIN URL</label>
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
            <label for="inp-cfg-meta-desc">DESCRIPTION &amp; PERFORMANCE NOTES</label>
            <textarea
              id="inp-cfg-meta-desc"
              class="form-control"
              rows="3"
              placeholder="Acoustic characteristics, microphone placement, performance suggestions..."
            >${escHtml(meta.description ?? '')}</textarea>
          </div>
        </div>

        <!-- 2. SoundFont & Sampler Metadata Tags -->
        <div class="model-cfg-card">
          <div class="model-cfg-card-header">
            <h4>${ICONS.layers} SoundFont &amp; Sampler Metadata Tags (${customAttrs.length})</h4>
            <span class="cfg-hint">RIFF INFO chunk tags (IENG, ICOP, ICRD, ISFT) and studio recording attributes</span>
          </div>

          <!-- Add Tag Bar -->
          <div class="meta-tag-adder-card">
            <div class="meta-tag-adder-row">
              <div class="form-group tag-select-group">
                <label for="sel-cfg-standard-tag">STANDARD METADATA ATTRIBUTE</label>
                <select id="sel-cfg-standard-tag" class="form-control">
                  <option value="custom" ${this.selectedTagDropdownKey === 'custom' ? 'selected' : ''}>
                    ★ Custom Tag (User-defined key)...
                  </option>
                  ${STANDARD_SOUNDFONT_TAGS.map(
                    (t) => `
                    <option value="${escAttr(t.key)}" ${this.selectedTagDropdownKey === t.key ? 'selected' : ''}>
                      [${escHtml(t.category)}] ${escHtml(t.label)}
                    </option>
                  `
                  ).join('')}
                </select>
              </div>

              <div class="form-group tag-key-group" id="group-cfg-custom-key" ${this.selectedTagDropdownKey !== 'custom' ? 'style="display:none"' : ''}>
                <label for="inp-cfg-custom-tag-key">CUSTOM KEY</label>
                <input
                  type="text"
                  id="inp-cfg-custom-tag-key"
                  class="form-control font-mono"
                  placeholder="e.g. MicDistance"
                  value="${escAttr(this.customTagKey)}"
                />
              </div>

              <div class="form-group flex-1 tag-val-group">
                <label for="inp-cfg-tag-val">ATTRIBUTE VALUE</label>
                <input
                  type="text"
                  id="inp-cfg-tag-val"
                  class="form-control"
                  placeholder="${escAttr(this.getActiveTagPlaceholder())}"
                />
              </div>

              <div class="tag-btn-group">
                <label>&nbsp;</label>
                <button type="button" class="btn btn-primary" id="btn-cfg-add-tag">
                  ${ICONS.plus} Add Tag
                </button>
              </div>
            </div>
            <p class="tag-helper-desc" id="cfg-tag-helper-text">${escHtml(this.getActiveTagDescription())}</p>
          </div>

          <!-- Active Tags List -->
          <div class="meta-tags-list-container">
            ${
              customAttrs.length === 0
                ? `<p class="text-muted empty-tags-note">No metadata tags defined yet. Select an attribute above and click "Add Tag".</p>`
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
                    <button type="button" class="btn-remove-tag" data-remove-tag-idx="${idx}" title="Remove tag ${escAttr(item.tag)}">
                      ${ICONS.trash || '✕'}
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

        <!-- 3. 5-Layer Time Capsule & Provenance -->
        <div class="model-cfg-card">
          <div class="model-cfg-card-header">
            <h4>${ICONS.layers} 5-Layer Time Capsule &amp; Provenance</h4>
            <span class="cfg-hint">Non-destructive origin tracking with zero generation loss</span>
          </div>
          <p class="cfg-explainer">
            The Time Capsule system stores original raw audio along with resynthesis parameters. At any time, you can trigger a lossless reprocess from the purest acoustic source without quality degradation.
          </p>
          <div style="margin-top: 10px;">
            <button type="button" class="btn btn-outline" id="btn-cfg-reprocess-capsule" title="Lossless reprocess from original unaltered acoustic source">
              ${ICONS.cpu} Reprocess From Purest Source (0 Generation Loss)
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // ─────────────────────────────────────────────────────────
  // TAB 4: Cover Artwork
  // ─────────────────────────────────────────────────────────
  private renderArtworkTab(config: ProcessConfig): string {
    const cover = config.coverArtwork;
    const defaultIcon = getDefaultCoverIcon(config);

    return `
      <div class="model-cfg-grid">
        <div class="model-cfg-card">
          <div class="model-cfg-card-header">
            <h4>${ICONS.palette} Model Cover Artwork (512×512 WebP)</h4>
            <span class="cfg-hint">Rendered in ABDAxionikVS catalog, SoundFont browser, and modern VST3/AU wrappers</span>
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
                <input type="file" id="inp-cfg-cover-file" accept="image/*" style="display:none" />
              </div>

              <!-- AI Artwork Generator (Roadmap Phase 20) -->
              <div class="ai-artwork-generator-banner">
                <div class="ai-generator-info">
                  <strong class="ai-generator-title">${ICONS.sparkle || ICONS.ai} AI Cover Artwork Generator</strong>
                  <span class="ai-generator-desc">Generate unique 512×512 neural cover art tailored to model name and acoustic timbre.</span>
                </div>
                <button type="button" class="btn btn-outline btn-ai-generate" id="btn-cfg-ai-cover" title="AI Cover Artwork Generation (Roadmap Phase 20)">
                  ${ICONS.sparkle || ICONS.ai} Generate with AI <span class="badge-ai-soon">Fase 20</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ─────────────────────────────────────────────────────────
  // Helper methods for Tag dropdown
  // ─────────────────────────────────────────────────────────
  private getActiveTagPlaceholder(): string {
    if (this.selectedTagDropdownKey === 'custom') {
      return 'Enter custom attribute value...';
    }
    const def = STANDARD_SOUNDFONT_TAGS.find((t) => t.key === this.selectedTagDropdownKey);
    return def ? def.placeholder : 'Enter value...';
  }

  private getActiveTagDescription(): string {
    if (this.selectedTagDropdownKey === 'custom') {
      return 'Custom user tag: stored alongside model metadata and preserved during export.';
    }
    const def = STANDARD_SOUNDFONT_TAGS.find((t) => t.key === this.selectedTagDropdownKey);
    return def ? def.description : '';
  }

  // ─────────────────────────────────────────────────────────
  // Event Binding
  // ─────────────────────────────────────────────────────────
  private bindEvents(): void {
    if (!this.backdropEl) return;

    // Close button
    this.backdropEl.querySelector('#btn-model-config-close')?.addEventListener('click', () => this.close());

    // Tab buttons
    this.backdropEl.querySelectorAll<HTMLButtonElement>('.model-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab') as ModelConfigTab;
        if (tab && tab !== this.activeTab) {
          this.activeTab = tab;
          this.render();
        }
      });
    });

    if (this.activeTab === 'general') {
      this.bindGeneralEvents();
    } else if (this.activeTab === 'articulation') {
      this.bindArticulationEvents();
    } else if (this.activeTab === 'metadata') {
      this.bindMetadataEvents();
    } else if (this.activeTab === 'artwork') {
      this.bindArtworkEvents();
    }
  }

  private bindGeneralEvents(): void {
    if (!this.backdropEl) return;
    const config = this.handlers.getConfig();

    // Classic model name (max 11 chars)
    const inpName = this.backdropEl.querySelector<HTMLInputElement>('#inp-cfg-model-name');
    const nameCounter = this.backdropEl.querySelector<HTMLElement>('#val-cfg-name-counter');
    inpName?.addEventListener('input', () => {
      const val = inpName.value.slice(0, 11);
      config.modelName = val;
      if (nameCounter) nameCounter.textContent = `${val.length}/11 chars`;
      this.handlers.onConfigChange({ ...config });
    });

    // Extended model name (unrestricted length)
    const inpExpanded = this.backdropEl.querySelector<HTMLInputElement>('#inp-cfg-expanded-name');
    const expCounter = this.backdropEl.querySelector<HTMLElement>('#val-cfg-expanded-counter');
    inpExpanded?.addEventListener('input', () => {
      const val = inpExpanded.value;
      config.expandedName = val;
      if (expCounter) expCounter.textContent = `${val.length} chars (No limit)`;
      this.handlers.onConfigChange({ ...config });
    });

    // Model slot (0..511)
    const inpSlot = this.backdropEl.querySelector<HTMLInputElement>('#inp-cfg-model-slot');
    const slotBadge = this.backdropEl.querySelector<HTMLElement>('#val-cfg-slot-badge');
    inpSlot?.addEventListener('input', () => {
      const num = parseInt(inpSlot.value, 10);
      if (!isNaN(num) && num >= 0 && num <= 511) {
        config.modelNumber = num;
        if (slotBadge) slotBadge.textContent = `#${String(num).padStart(3, '0')}`;
        this.handlers.onConfigChange({ ...config });
      }
    });

    // Sub-library assignment (Fase 23)
    const selSub = this.backdropEl.querySelector<HTMLSelectElement>('#sel-cfg-sublibrary');
    selSub?.addEventListener('change', () => {
      config.sublibrary = selSub.value;
      this.handlers.onConfigChange({ ...config });
    });

    // Sub-library ordinal index (Fase 23)
    const inpOrdinal = this.backdropEl.querySelector<HTMLInputElement>('#inp-cfg-sublib-ordinal');
    const valOrdinal = this.backdropEl.querySelector<HTMLElement>('#val-cfg-sublib-ordinal');
    inpOrdinal?.addEventListener('input', () => {
      const ord = parseInt(inpOrdinal.value, 10);
      if (!isNaN(ord) && ord > 0) {
        config.sublibraryOrdinal = ord;
        if (valOrdinal) valOrdinal.textContent = `#${ord}`;
        this.handlers.onConfigChange({ ...config });
      }
    });

    // New Sub-library creation button (Fase 23)
    this.backdropEl.querySelector('#btn-cfg-new-sublibrary')?.addEventListener('click', async () => {
      const entered = typeof window !== 'undefined' ? window.prompt('Enter new Sub-library name:', '') : null;
      if (!entered || !entered.trim()) return;
      const clean = entered.trim();
      try {
        await this.handlers.onCreateSublibrary?.(clean);
        config.sublibrary = clean;
        this.handlers.onConfigChange({ ...config });
        this.render();
        toast(`Created sub-library "${clean}"`, 'success');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        toast(`Error creating sub-library: ${msg}`, 'error');
      }
    });

    // Working mode radio
    this.backdropEl.querySelectorAll<HTMLInputElement>('input[name="cfg-working-mode"]').forEach((r) => {
      r.addEventListener('change', () => {
        if (r.checked) {
          const mode = r.value as WorkingMode;
          config.workingMode = mode;
          this.handlers.onConfigChange({ ...config });
          this.render();
          toast(
            `Switched Working Mode: ${mode === 'classic' ? 'Classic (1:1 Hardware)' : 'Extended (HD Multi-Layer)'}`,
            'info'
          );
        }
      });
    });

    // Target format
    this.backdropEl.querySelectorAll<HTMLButtonElement>('.btn-target-format').forEach((btn) => {
      btn.addEventListener('click', () => {
        const fmt = btn.getAttribute('data-fmt') as TargetFormat;
        if (fmt) {
          config.targetFormat = fmt;
          this.handlers.onConfigChange({ ...config });
          this.render();
        }
      });
    });

    // DSP Algorithm
    this.backdropEl.querySelectorAll<HTMLButtonElement>('.btn-dsp-algorithm').forEach((btn) => {
      btn.addEventListener('click', () => {
        const alg = btn.getAttribute('data-alg') as DspAlgorithmMode;
        if (alg) {
          config.dspAlgorithm = alg;
          this.handlers.onConfigChange({ ...config });
          this.render();
        }
      });
    });

    // Complexity (1..10)
    this.backdropEl.querySelectorAll<HTMLButtonElement>('.btn-complexity').forEach((btn) => {
      btn.addEventListener('click', () => {
        const comp = parseInt(btn.getAttribute('data-complexity') || '8', 10);
        config.complexity = comp;
        this.handlers.onConfigChange({ ...config });
        this.render();
      });
    });

    // Parameter Set (0..9)
    this.backdropEl.querySelectorAll<HTMLButtonElement>('.btn-param-set').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ps = parseInt(btn.getAttribute('data-param-set') || '0', 10);
        config.parameterSet = ps;
        this.handlers.onConfigChange({ ...config });
        this.render();
      });
    });
  }

  private bindArticulationEvents(): void {
    if (!this.backdropEl) return;
    const config = this.handlers.getConfig();
    const cp = config.commonPlayback ?? {
      loopMode: 'no_loop',
      pitchKeytrack: 100,
      trigger: 'attack',
      fadeCurve: 'equal-power',
    };

    const selLoop = this.backdropEl.querySelector<HTMLSelectElement>('#sel-cfg-loop-mode');
    selLoop?.addEventListener('change', () => {
      cp.loopMode = selLoop.value as any;
      config.commonPlayback = { ...cp };
      this.handlers.onConfigChange({ ...config });
    });

    const selTrigger = this.backdropEl.querySelector<HTMLSelectElement>('#sel-cfg-trigger');
    selTrigger?.addEventListener('change', () => {
      cp.trigger = selTrigger.value as any;
      config.commonPlayback = { ...cp };
      this.handlers.onConfigChange({ ...config });
    });

    const selFade = this.backdropEl.querySelector<HTMLSelectElement>('#sel-cfg-fade-curve');
    selFade?.addEventListener('change', () => {
      cp.fadeCurve = selFade.value as any;
      config.commonPlayback = { ...cp };
      this.handlers.onConfigChange({ ...config });
    });

    const inpKeytrack = this.backdropEl.querySelector<HTMLInputElement>('#inp-cfg-keytrack');
    const valKeytrack = this.backdropEl.querySelector<HTMLElement>('#val-cfg-keytrack');
    inpKeytrack?.addEventListener('input', () => {
      const val = parseInt(inpKeytrack.value, 10);
      cp.pitchKeytrack = val;
      if (valKeytrack) valKeytrack.textContent = `${val}%`;
      config.commonPlayback = { ...cp };
      this.handlers.onConfigChange({ ...config });
    });
  }

  private bindMetadataEvents(): void {
    if (!this.backdropEl) return;
    const config = this.handlers.getConfig();
    const meta: ExtendedModelMetadata = config.extendedMetadata ?? {};

    const syncMeta = () => {
      config.extendedMetadata = { ...meta };
      this.handlers.onConfigChange({ ...config });
    };

    // Author
    this.backdropEl.querySelector<HTMLInputElement>('#inp-cfg-meta-author')?.addEventListener('input', (e) => {
      meta.author = (e.target as HTMLInputElement).value;
      syncMeta();
    });

    // Version
    this.backdropEl.querySelector<HTMLInputElement>('#inp-cfg-meta-version')?.addEventListener('input', (e) => {
      meta.version = (e.target as HTMLInputElement).value;
      syncMeta();
    });

    // License
    this.backdropEl.querySelector<HTMLInputElement>('#inp-cfg-meta-license')?.addEventListener('input', (e) => {
      meta.license = (e.target as HTMLInputElement).value;
      syncMeta();
    });

    // URL
    this.backdropEl.querySelector<HTMLInputElement>('#inp-cfg-meta-url')?.addEventListener('input', (e) => {
      meta.sourceUrl = (e.target as HTMLInputElement).value;
      syncMeta();
    });

    // Description
    this.backdropEl.querySelector<HTMLTextAreaElement>('#inp-cfg-meta-desc')?.addEventListener('input', (e) => {
      meta.description = (e.target as HTMLTextAreaElement).value;
      syncMeta();
    });

    // Tag selector dropdown
    const selTag = this.backdropEl.querySelector<HTMLSelectElement>('#sel-cfg-standard-tag');
    const customKeyGroup = this.backdropEl.querySelector<HTMLElement>('#group-cfg-custom-key');
    const tagHelper = this.backdropEl.querySelector<HTMLElement>('#cfg-tag-helper-text');
    const inpVal = this.backdropEl.querySelector<HTMLInputElement>('#inp-cfg-tag-val');

    selTag?.addEventListener('change', () => {
      this.selectedTagDropdownKey = selTag.value;
      if (customKeyGroup) {
        customKeyGroup.style.display = this.selectedTagDropdownKey === 'custom' ? '' : 'none';
      }
      if (tagHelper) {
        tagHelper.textContent = this.getActiveTagDescription();
      }
      if (inpVal) {
        inpVal.placeholder = this.getActiveTagPlaceholder();
      }
    });

    // Custom tag key input
    const inpCustomKey = this.backdropEl.querySelector<HTMLInputElement>('#inp-cfg-custom-tag-key');
    inpCustomKey?.addEventListener('input', () => {
      this.customTagKey = inpCustomKey.value;
    });

    // Add Tag Button
    this.backdropEl.querySelector('#btn-cfg-add-tag')?.addEventListener('click', () => {
      let finalKey = '';
      if (this.selectedTagDropdownKey === 'custom') {
        finalKey = (inpCustomKey?.value ?? '').trim().replace(/[^A-Za-z0-9_-]/g, '');
        if (!finalKey) {
          toast('Please specify a valid tag key.', 'warning');
          return;
        }
      } else {
        finalKey = this.selectedTagDropdownKey;
      }

      const val = (inpVal?.value ?? '').trim();
      if (!val) {
        toast('Please enter a value for the tag.', 'warning');
        return;
      }

      if (!meta.customAttributes) meta.customAttributes = [];
      meta.customAttributes.push({ tag: finalKey, value: val });
      syncMeta();
      toast(`Added tag "${finalKey}": "${val}"`, 'success');
      this.render();
    });

    // Remove Tag buttons
    this.backdropEl.querySelectorAll<HTMLButtonElement>('.btn-remove-tag').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-remove-tag-idx') ?? '-1', 10);
        if (idx >= 0 && meta.customAttributes && meta.customAttributes[idx]) {
          const removed = meta.customAttributes.splice(idx, 1)[0];
          syncMeta();
          toast(`Removed tag "${removed?.tag ?? idx}".`, 'info');
          this.render();
        }
      });
    });

    // 5-Layer Time Capsule Reprocess button
    this.backdropEl.querySelector('#btn-cfg-reprocess-capsule')?.addEventListener('click', () => {
      if (this.handlers.onReprocessFromPurestSource) {
        this.handlers.onReprocessFromPurestSource();
      } else {
        toast('Triggered lossless reprocess from purest source for current Time Capsule.', 'info');
      }
    });
  }

  private bindArtworkEvents(): void {
    if (!this.backdropEl) return;

    // Pick cover file
    const fileInp = this.backdropEl.querySelector<HTMLInputElement>('#inp-cfg-cover-file');
    this.backdropEl.querySelector('#btn-cfg-pick-cover')?.addEventListener('click', () => {
      fileInp?.click();
    });

    fileInp?.addEventListener('change', () => {
      const f = fileInp.files?.[0];
      if (f) {
        this.handlers.onSelectCoverImage?.(f);
      }
    });

    // Remove cover
    this.backdropEl.querySelector('#btn-cfg-remove-cover')?.addEventListener('click', () => {
      this.handlers.onRemoveCoverImage?.();
    });

    // Dropzone
    const dz = this.backdropEl.querySelector<HTMLElement>('#cfg-cover-dropzone');
    if (dz) {
      dz.addEventListener('dragover', (e) => {
        e.preventDefault();
        dz.classList.add('is-dragover');
      });
      dz.addEventListener('dragleave', () => {
        dz.classList.remove('is-dragover');
      });
      dz.addEventListener('drop', (e) => {
        e.preventDefault();
        dz.classList.remove('is-dragover');
        const f = e.dataTransfer?.files?.[0];
        if (f && f.type.startsWith('image/')) {
          this.handlers.onSelectCoverImage?.(f);
        } else {
          toast('Please drop an image file (PNG, JPG, WebP, SVG, AVIF).', 'warning');
        }
      });
    }

    // AI Artwork Generator (Roadmap Phase 20)
    this.backdropEl.querySelector('#btn-cfg-ai-cover')?.addEventListener('click', () => {
      if (this.handlers.onOpenAiCoverGenerator) {
        this.handlers.onOpenAiCoverGenerator();
      } else {
        toast('Opening AI Cover Artwork Generator...', 'info');
      }
    });
  }
}
