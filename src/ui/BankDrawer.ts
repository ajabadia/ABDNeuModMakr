// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Bank Drawer Component
// Browse generated models and sound presets from NeuronDB
// ─────────────────────────────────────────────────────────

import { ICONS } from './icons';
import type { BankSummary } from '../core/types';

export interface BankDrawerHandlers {
  onSelectModel: (slot: number) => void;
  onExportModel: (slot: number) => void;
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
      <div class="drawer-header">
        <div class="drawer-title">
          <span class="drawer-icon">${ICONS.database}</span>
          <span>NEURONDB BANK BROWSER</span>
        </div>
        <button type="button" class="btn btn-close-drawer" id="btn-close-bank" title="Close Drawer">${ICONS.close}</button>
      </div>

      <div class="drawer-body">
        <div class="bank-tabs">
          <button type="button" class="bank-tab is-active" id="tab-models">GENERATED MODELS</button>
          <button type="button" class="bank-tab" id="tab-presets">SOUND PRESETS</button>
        </div>

        <div class="bank-search-bar">
          <input
            type="text"
            id="bank-filter-input"
            class="bank-filter-input"
            placeholder="Search models or presets (name, slot #000, category)..."
            autocomplete="off"
          />
        </div>

        <div class="bank-content-list" id="bank-list-container">
          <!-- Model or Preset items rendered dynamically -->
        </div>
      </div>
    `;

    this.container.appendChild(this.drawerElement);

    this.drawerElement.querySelector('#btn-close-bank')?.addEventListener('click', () => {
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
      tabModels.classList.add('is-active');
      tabPresets?.classList.remove('is-active');
      this.renderModels();
    });

    tabPresets?.addEventListener('click', () => {
      this.activeTab = 'presets';
      tabPresets?.classList.add('is-active');
      tabModels?.classList.remove('is-active');
      this.renderPresets();
    });
  }

  public setBank(bank: BankSummary): void {
    this.currentBank = bank;
    if (this.activeTab === 'models') {
      this.renderModels();
    } else {
      this.renderPresets();
    }
  }

  private renderModels(): void {
    if (!this.drawerElement || !this.currentBank) return;
    const container = this.drawerElement.querySelector('#bank-list-container');
    if (!container) return;

    if (this.currentBank.models.length === 0) {
      container.innerHTML = `
        <div class="bank-empty-state">
          <span>No models generated in this bank yet.</span>
          <span class="empty-sub">Create zones, assign samples, and click Process to generate models.</span>
        </div>
      `;
      return;
    }

    const filtered = this.filterQuery
      ? this.currentBank.models.filter(
          (m) =>
            m.name.toLowerCase().includes(this.filterQuery) ||
            String(m.slot).includes(this.filterQuery)
        )
      : this.currentBank.models;

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="bank-empty-state">
          <span>No models found matching "${this.filterQuery}".</span>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="bank-items-grid">
        ${filtered.map((m) => `
          <div class="bank-model-item">
            <div class="model-item-header">
              <span class="model-slot-tag">#${String(m.slot).padStart(3, '0')}</span>
              <span class="model-item-name">${m.name}</span>
            </div>
            <div class="model-item-meta">
              <span>Zones: ${m.zoneCount}</span>
              <span>Complexity: ${m.complexity}/10</span>
              <span>ParamSet: #${m.parameterSet}</span>
            </div>
            <div class="model-item-actions">
              <button type="button" class="btn btn-xs btn-select-model" data-slot="${m.slot}">Select Slot</button>
              <button type="button" class="btn btn-xs btn-export" data-slot="${m.slot}">${ICONS.folder} Export .zip</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    container.querySelectorAll('.btn-select-model').forEach((btn) => {
      btn.addEventListener('click', () => {
        const slot = parseInt(btn.getAttribute('data-slot') || '0', 10);
        this.handlers.onSelectModel(slot);
      });
    });

    container.querySelectorAll('.btn-export').forEach((btn) => {
      btn.addEventListener('click', () => {
        const slot = parseInt(btn.getAttribute('data-slot') || '0', 10);
        this.handlers.onExportModel(slot);
      });
    });
  }

  private renderPresets(): void {
    if (!this.drawerElement || !this.currentBank) return;
    const container = this.drawerElement.querySelector('#bank-list-container');
    if (!container) return;

    const filtered = this.filterQuery
      ? this.currentBank.presets.filter(
          (p) =>
            p.name.toLowerCase().includes(this.filterQuery) ||
            p.category.toLowerCase().includes(this.filterQuery) ||
            String(p.slot).includes(this.filterQuery) ||
            String(p.modelIndex).includes(this.filterQuery)
        )
      : this.currentBank.presets;

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="bank-empty-state">
          <span>No presets found matching "${this.filterQuery}".</span>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="bank-items-grid">
        ${filtered.map((p) => `
          <div class="bank-preset-item">
            <div class="preset-item-header">
              <span class="preset-slot-tag">#${String(p.slot).padStart(3, '0')}</span>
              <span class="preset-name">${p.name}</span>
              <span class="preset-category-pill">${p.category}</span>
            </div>
            <div class="preset-item-meta">
              <span>Uses Model #${String(p.modelIndex).padStart(3, '0')}</span>
            </div>
          </div>
        `).join('')}
      </div>
    `;
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
