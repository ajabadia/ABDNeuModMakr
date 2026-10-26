// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Bank Drawer Component
// Browse generated models and sound presets from NeuronDB
// Styled with canonical ABDShared catalog browser styles
// (.ndb-search-row, .ndb-chip, .ndb-grid, .ndb-card, .ndb-footer)
// ─────────────────────────────────────────────────────────

import { ICONS } from './icons';
import type { BankSummary } from '../core/types';
import { PARAMETER_SETS } from '../core/WebAudioPipeline';

export interface BankDrawerHandlers {
  onSelectModel: (slot: number) => void;
  onExportModel: (slot: number) => void;
}

export function getPresetCategoryInfo(category: string): { icon: string; catClass: string; paramId: number } {
  const cat = (category || '').toLowerCase();
  if (cat.includes('string')) return { icon: ICONS.param1, catClass: 'cat-1', paramId: 1 };
  if (cat.includes('bell')) return { icon: ICONS.param2, catClass: 'cat-2', paramId: 2 };
  if (cat.includes('bass') || cat.includes('pluck')) return { icon: ICONS.param3, catClass: 'cat-3', paramId: 3 };
  if (cat.includes('pad')) return { icon: ICONS.param4, catClass: 'cat-4', paramId: 4 };
  if (cat.includes('key') || cat.includes('piano')) return { icon: ICONS.param5, catClass: 'cat-5', paramId: 5 };
  if (cat.includes('wind') || cat.includes('vocal') || cat.includes('choir')) return { icon: ICONS.param6, catClass: 'cat-6', paramId: 6 };
  if (cat.includes('texture') || cat.includes('drone')) return { icon: ICONS.param7, catClass: 'cat-7', paramId: 7 };
  if (cat.includes('arp') || cat.includes('loop')) return { icon: ICONS.param8, catClass: 'cat-8', paramId: 8 };
  if (cat.includes('rhythm') || cat.includes('drum')) return { icon: ICONS.param9, catClass: 'cat-9', paramId: 9 };
  return { icon: ICONS.param0, catClass: 'cat-0', paramId: 0 };
}

export class BankDrawer {
  private container: HTMLElement;
  private handlers: BankDrawerHandlers;
  private isOpen: boolean = false;
  private drawerElement: HTMLElement | null = null;
  private currentBank: BankSummary | null = null;
  private activeTab: 'models' | 'presets' = 'models';
  private filterQuery: string = '';

  constructor(container: HTMLElement, handlers: BankDrawerHandlers) {
    this.container = container;
    this.handlers = handlers;
    this.init();
  }

  private init(): void {
    this.drawerElement = document.createElement('div');
    this.drawerElement.className = 'bank-drawer-panel is-closed';
    this.drawerElement.innerHTML = `
      <!-- Header -->
      <div class="drawer-header ndb-modal-header">
        <div class="drawer-title ndb-header-title">
          <span class="drawer-icon">${ICONS.database}</span>
          <span class="ndb-title-text">NEURONDB BANK BROWSER</span>
          <span class="panel-badge ndb-badge" id="bank-count-badge">0 ITEMS</span>
        </div>
        <button type="button" class="btn btn-close-drawer ndb-close-btn" id="btn-close-bank" title="Close Drawer (Esc)">${ICONS.close}</button>
      </div>

      <!-- Integrated Search Row (ABDMS2000 & Catalog style) -->
      <div class="ndb-search-row">
        <span class="ndb-search-icon">${ICONS.search}</span>
        <input
          type="text"
          id="bank-filter-input"
          class="ndb-search-input"
          placeholder="Search models or presets by name, slot (#000), set..."
          autocomplete="off"
          spellcheck="false"
          aria-label="Search bank"
        />
      </div>

      <!-- Category / Tab Filter Chips (ABDMS2000 style) -->
      <div class="ndb-chips-row">
        <button type="button" class="ndb-chip ${this.activeTab === 'models' ? 'active' : ''}" id="tab-models">
          <span class="ndb-chip-icon">${ICONS.database}</span>
          <span class="ndb-chip-name">GENERATED MODELS</span>
          <span class="ndb-chip-count" id="count-models">0</span>
        </button>
        <button type="button" class="ndb-chip ${this.activeTab === 'presets' ? 'active' : ''}" id="tab-presets">
          <span class="ndb-chip-icon">${ICONS.sliders}</span>
          <span class="ndb-chip-name">SOUND PRESETS</span>
          <span class="ndb-chip-count" id="count-presets">0</span>
        </button>
      </div>

      <!-- Scrollable Content Wrap -->
      <div class="ndb-content-wrap" id="bank-list-container" tabindex="0">
        <!-- Model or Preset items rendered dynamically via .ndb-grid -->
      </div>

      <!-- Selection & Status Footer (ABDMS2000 style) -->
      <div class="ndb-footer" id="bank-footer">
        <div class="ndb-footer-selection">
          <span class="ndb-footer-slot" id="bank-foot-slot">BANK</span>
          <span class="ndb-footer-details" id="bank-foot-status">No bank loaded</span>
        </div>
        <div class="neurondb-footer-actions">
          <button type="button" class="btn btn-xs" id="btn-bank-close-foot">Close</button>
        </div>
      </div>
    `;

    this.container.appendChild(this.drawerElement);

    this.drawerElement.querySelector('#btn-close-bank')?.addEventListener('click', () => {
      this.close();
    });

    this.drawerElement.querySelector('#btn-bank-close-foot')?.addEventListener('click', () => {
      this.close();
    });

    const filterInput = this.drawerElement.querySelector('#bank-filter-input') as HTMLInputElement | null;
    filterInput?.addEventListener('input', () => {
      this.filterQuery = (filterInput.value || '').trim().toLowerCase();
      if (this.activeTab === 'models') {
        this.renderModels();
      } else {
        this.renderPresets();
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.close();
      }
    });

    const tabModels = this.drawerElement.querySelector('#tab-models');
    const tabPresets = this.drawerElement.querySelector('#tab-presets');

    tabModels?.addEventListener('click', () => {
      this.activeTab = 'models';
      tabModels.classList.add('active');
      tabPresets?.classList.remove('active');
      this.renderModels();
    });

    tabPresets?.addEventListener('click', () => {
      this.activeTab = 'presets';
      tabPresets?.classList.add('active');
      tabModels?.classList.remove('active');
      this.renderPresets();
    });
  }

  public setBank(bank: BankSummary): void {
    this.currentBank = bank;
    this.updateCounters();
    if (this.activeTab === 'models') {
      this.renderModels();
    } else {
      this.renderPresets();
    }
  }

  private updateCounters(): void {
    if (!this.drawerElement) return;
    const mCount = this.currentBank?.models.length ?? 0;
    const pCount = this.currentBank?.presets.length ?? 0;

    const countModelsEl = this.drawerElement.querySelector('#count-models');
    if (countModelsEl) countModelsEl.textContent = String(mCount);

    const countPresetsEl = this.drawerElement.querySelector('#count-presets');
    if (countPresetsEl) countPresetsEl.textContent = String(pCount);

    const footStatusEl = this.drawerElement.querySelector('#bank-foot-status');
    if (footStatusEl) footStatusEl.textContent = `${mCount} model${mCount === 1 ? '' : 's'} | ${pCount} preset${pCount === 1 ? '' : 's'}`;
  }

  private renderModels(): void {
    if (!this.drawerElement || !this.currentBank) return;
    const container = this.drawerElement.querySelector('#bank-list-container');
    if (!container) return;

    const badge = this.drawerElement.querySelector('#bank-count-badge');
    const totalModels = this.currentBank.models.length;

    if (totalModels === 0) {
      if (badge) badge.textContent = '0 MODELS';
      container.innerHTML = `
        <div class="neurondb-empty-state">
          <span class="empty-icon">${ICONS.database}</span>
          <span class="empty-msg">No models generated in this bank yet</span>
          <span class="ndb-dim">Create zones, assign samples, and click Process to generate models.</span>
        </div>
      `;
      return;
    }

    const filtered = this.filterQuery
      ? this.currentBank.models.filter(
          (m) =>
            m.name.toLowerCase().includes(this.filterQuery) ||
            String(m.slot).includes(this.filterQuery) ||
            `#${String(m.slot).padStart(3, '0')}`.includes(this.filterQuery) ||
            (PARAMETER_SETS[m.parameterSet]?.name.toLowerCase().includes(this.filterQuery) ?? false)
        )
      : this.currentBank.models;

    if (badge) {
      badge.textContent =
        filtered.length === totalModels
          ? `${totalModels} MODELS`
          : `${filtered.length} / ${totalModels} MODELS`;
    }

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="neurondb-empty-state">
          <span class="empty-icon">${ICONS.database}</span>
          <span class="empty-msg">No models found matching "${this.filterQuery}"</span>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="ndb-grid">
        ${filtered
          .map((m) => {
            const ps = PARAMETER_SETS[m.parameterSet];
            const catClass = ps ? `cat-${ps.id}` : 'cat-neutral';
            const catName = ps ? `${ps.id}: ${ps.name}` : `Set ${m.parameterSet}`;
            const iconKey = ps ? (`param${ps.id}` as keyof typeof ICONS) : 'database';
            const iconSvg = ICONS[iconKey] || ICONS.database;

            return `
              <div class="ndb-card" data-slot="${m.slot}">
                <div class="ndb-card-icon ${catClass}">
                  ${iconSvg}
                </div>
                <div class="ndb-card-info">
                  <div class="ndb-card-top">
                    <span class="ndb-card-slot">#${String(m.slot).padStart(3, '0')}</span>
                    <span class="ndb-card-cat ${catClass}">${catName}</span>
                  </div>
                  <div class="ndb-card-name" title="${m.name}">${m.name}</div>
                  <div class="ndb-card-meta">
                    <span class="ndb-card-badge">${m.zoneCount} Zone${m.zoneCount === 1 ? '' : 's'}</span>
                    <span class="ndb-card-badge">Lvl ${m.complexity}</span>
                  </div>
                </div>
                <div class="ndb-card-actions">
                  <button type="button" class="btn btn-xs btn-primary btn-select-model" data-slot="${m.slot}" title="Set active editor slot to #${m.slot}">
                    Select Slot
                  </button>
                  <button type="button" class="btn btn-xs btn-export" data-slot="${m.slot}" title="Export .zip package">
                    <span class="btn-icon">${ICONS.folder}</span> Export .zip
                  </button>
                </div>
              </div>
            `;
          })
          .join('')}
      </div>
    `;

    container.querySelectorAll<HTMLElement>('.ndb-card').forEach((card) => {
      const slot = parseInt(card.getAttribute('data-slot') || '0', 10);
      card.addEventListener('dblclick', () => {
        this.handlers.onSelectModel(slot);
      });
    });

    container.querySelectorAll('.btn-select-model').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const slot = parseInt(btn.getAttribute('data-slot') || '0', 10);
        this.handlers.onSelectModel(slot);
      });
    });

    container.querySelectorAll('.btn-export').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const slot = parseInt(btn.getAttribute('data-slot') || '0', 10);
        this.handlers.onExportModel(slot);
      });
    });
  }

  private renderPresets(): void {
    if (!this.drawerElement || !this.currentBank) return;
    const container = this.drawerElement.querySelector('#bank-list-container');
    if (!container) return;

    const badge = this.drawerElement.querySelector('#bank-count-badge');
    const totalPresets = this.currentBank.presets.length;

    if (totalPresets === 0) {
      if (badge) badge.textContent = '0 PRESETS';
      container.innerHTML = `
        <div class="neurondb-empty-state">
          <span class="empty-icon">${ICONS.sliders}</span>
          <span class="empty-msg">No sound presets available in this bank</span>
        </div>
      `;
      return;
    }

    const filtered = this.filterQuery
      ? this.currentBank.presets.filter(
          (p) =>
            p.name.toLowerCase().includes(this.filterQuery) ||
            p.category.toLowerCase().includes(this.filterQuery) ||
            String(p.slot).includes(this.filterQuery) ||
            String(p.modelIndex).includes(this.filterQuery)
        )
      : this.currentBank.presets;

    if (badge) {
      badge.textContent =
        filtered.length === totalPresets
          ? `${totalPresets} PRESETS`
          : `${filtered.length} / ${totalPresets} PRESETS`;
    }

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="neurondb-empty-state">
          <span class="empty-icon">${ICONS.sliders}</span>
          <span class="empty-msg">No presets found matching "${this.filterQuery}"</span>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="ndb-grid">
        ${filtered
          .map((p) => {
            const catInfo = getPresetCategoryInfo(p.category);
            return `
              <div class="ndb-card" data-slot="${p.slot}" data-model="${p.modelIndex}">
                <div class="ndb-card-icon ${catInfo.catClass}">
                  ${catInfo.icon}
                </div>
                <div class="ndb-card-info">
                  <div class="ndb-card-top">
                    <span class="ndb-card-slot">#${String(p.slot).padStart(3, '0')}</span>
                    <span class="ndb-card-cat ${catInfo.catClass}">${p.category || 'Preset'}</span>
                  </div>
                  <div class="ndb-card-name" title="${p.name}">${p.name}</div>
                  <div class="ndb-card-meta">
                    <span class="ndb-card-badge">Uses Model #${String(p.modelIndex).padStart(3, '0')}</span>
                  </div>
                </div>
                <div class="ndb-card-actions">
                  <button type="button" class="btn btn-xs btn-primary btn-select-preset-model" data-slot="${p.modelIndex}" title="Switch editor to Model #${p.modelIndex}">
                    Select Model
                  </button>
                </div>
              </div>
            `;
          })
          .join('')}
      </div>
    `;

    container.querySelectorAll<HTMLElement>('.ndb-card').forEach((card) => {
      const modelSlot = parseInt(card.getAttribute('data-model') || '0', 10);
      card.addEventListener('dblclick', () => {
        this.handlers.onSelectModel(modelSlot);
      });
    });

    container.querySelectorAll('.btn-select-preset-model').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const modelSlot = parseInt(btn.getAttribute('data-slot') || '0', 10);
        this.handlers.onSelectModel(modelSlot);
      });
    });
  }

  public toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  public open(): void {
    this.isOpen = true;
    this.drawerElement?.classList.remove('is-closed');
    this.drawerElement?.classList.add('is-open');
    const filterInput = this.drawerElement?.querySelector('#bank-filter-input') as HTMLInputElement | null;
    if (filterInput) {
      setTimeout(() => filterInput.focus(), 80);
    }
  }

  public close(): void {
    this.isOpen = false;
    this.drawerElement?.classList.remove('is-open');
    this.drawerElement?.classList.add('is-closed');
  }
}
