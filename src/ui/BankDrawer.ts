// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Bank Drawer (thin adapter over ABDShared bank UI)
// Browse generated models and library models from NeuronDB.
// Shell + cards come from `@abdsynths/shared/components/bank` — this
// file only adapts them to CoreService: tabs shown, data mapping and
// the serve-don't-apply handlers. Same public API as before.
// ─────────────────────────────────────────────────────────

import { ICONS } from './icons';
import type { BankSummary } from '../core/types';
import type { NeuronDbModelEntry } from './NeuronDbModal';
import { PARAMETER_SETS } from '../core';
import { confirmDialog, toast } from './notify';
import { createBankShell } from '@abdsynths/shared/components/bank/bankShell.js';
import { bankCardHtml, bindBankCards } from '@abdsynths/shared/components/bank/bankCard.js';
import { classifyBankCategory } from '@abdsynths/shared/components/bank/bankCategories.js';

export type BankTab = 'models' | 'presets' | 'library';

export interface BankDrawerOptions {
  /** Tabs rendered by the drawer. Default `['models', 'presets']`.
   * Hosts show only what they can serve: NeuModMakr hides presets. */
  visibleTabs?: BankTab[];
}

export interface BankDrawerHandlers {
  /**
   * Model chosen for loading (double-click / Load). The component only
   * serves the slot — the host decides what loading means (NeuModMakr
   * restores the full session, the synth loads into its engine).
   */
  onSelectModel: (slot: number) => void;
  onExportModel: (slot: number) => void;
  onClearModels?: () => void;
  onConfigureNeuronDbFolder?: () => void;
  /**
   * Preset selection (presets tab). The component only serves the
   * selection — the host decides what loading means (same contract as
   * ABDAxionikVS, whose synth applies the preset to its engine).
   * Optional: when absent, the drawer falls back to
   * `onSelectModel(preset.modelIndex)`.
   */
  onSelectPreset?: (slot: number, name: string, modelIndex: number) => void;
  /** Live library-folder entries (pull model — the owner mutates them in place during scans). */
  onRequestLibrary?: () => NeuronDbModelEntry[];
  /** Library entry chosen for loading (double-click / Load). */
  onPickLibrary?: (slot: number) => void;
}

export function getPresetCategoryInfo(category: string): { icon: string; catClass: string; paramId: number } {
  const { catClass, paramId } = classifyBankCategory(category);
  return { icon: ICONS[`param${paramId}` as keyof typeof ICONS] || ICONS.param0, catClass, paramId };
}

const TAB_LABELS: Record<BankTab, string> = {
  models: 'GENERATED MODELS',
  presets: 'SOUND PRESETS',
  library: 'LIBRARY',
};

export class BankDrawer {
  private container: HTMLElement;
  private handlers: BankDrawerHandlers;
  private isOpen: boolean = false;
  private shell: ReturnType<typeof createBankShell> | null = null;
  private unbindCards: (() => void) | null = null;
  private currentBank: BankSummary | null = null;
  private activeTab: BankTab = 'models';
  private readonly visibleTabs: BankTab[];
  private filterQuery: string = '';
  private selectedSlot: number | null = null;
  private selectedPresetSlot: number | null = null;
  private selectedLibrarySlot: number | null = null;

  constructor(container: HTMLElement, handlers: BankDrawerHandlers, options?: BankDrawerOptions) {
    this.container = container;
    this.handlers = handlers;
    this.visibleTabs = options?.visibleTabs ?? ['models', 'presets'];
    if (!this.visibleTabs.includes(this.activeTab)) {
      this.activeTab = this.visibleTabs[0] ?? 'models';
    }
    this.init();
  }

  private init(): void {
    this.shell = createBankShell({
      title: 'NEURONDB BANK BROWSER',
      badge: '0 ITEMS',
      tabs: this.visibleTabs.map((id) => ({ id, label: TAB_LABELS[id] })),
      activeTab: this.activeTab,
      searchPlaceholder: 'Search models or presets by name, slot (#000), set...',
      headerActions: [
        { id: 'clear', label: 'Clear', title: 'Clear all generated models from bank', iconHtml: ICONS.trash },
        { id: 'close', label: 'Close', title: 'Close Drawer (Esc)', iconHtml: ICONS.close },
      ],
      onTabChange: (tab) => {
        this.activeTab = tab as BankTab;
        this.renderActiveTab();
      },
      onSearch: (query) => {
        this.filterQuery = query;
        this.renderActiveTab();
      },
      onHeaderAction: (id) => {
        if (id === 'clear') this.confirmClearModels();
      },
      onFooterAction: (id) => {
        if (id === 'close') this.close();
      },
      onClose: () => this.close(),
    });
    this.shell.element.classList.add('is-closed');
    const iconEl = this.shell.element.querySelector('[data-shell-icon]');
    if (iconEl) iconEl.innerHTML = ICONS.database;
    const searchIconEl = this.shell.element.querySelector('[data-shell-search-icon]');
    if (searchIconEl) searchIconEl.innerHTML = ICONS.search;
    this.renderFooter();

    this.container.appendChild(this.shell.element);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  public setBank(bank: BankSummary, selectedSlot?: number | null): void {
    this.currentBank = bank;
    if (selectedSlot !== undefined) {
      this.selectedSlot = selectedSlot;
    }
    this.selectedPresetSlot = null;
    this.updateCounters();
    this.renderActiveTab();
  }

  private updateCounters(): void {
    if (!this.shell) return;
    const mCount = this.currentBank?.models.length ?? 0;
    const pCount = this.currentBank?.presets.length ?? 0;
    const lCount = this.handlers.onRequestLibrary?.().length ?? 0;
    this.shell.setTabCount('models', mCount);
    this.shell.setTabCount('presets', pCount);
    this.shell.setTabCount('library', lCount);
    this.updateFooterSelection();
  }

  private renderFooter(): void {
    if (!this.shell) return;
    this.shell.footerEl.innerHTML = `
      <div class="ndb-footer-selection">
        <span class="ndb-footer-slot" id="bank-foot-slot">BANK</span>
        <span class="ndb-footer-details" id="bank-foot-status">No bank loaded</span>
      </div>
      <div class="neurondb-footer-actions">
        <button type="button" class="btn btn-xs" data-footer-action="close">Close</button>
      </div>
    `;
  }

  /** Active editor slot (mirrors the NeuronDB modal). Null = none selected yet. */
  public setSelectedSlot(slot: number | null): void {
    this.selectedSlot = slot;
    this.renderActiveTab();
    this.updateFooterSelection();
  }

  /** Library-tab highlight (selection only — the host loads on double-click / Load). */
  public setSelectedLibrary(slot: number | null): void {
    this.selectedLibrarySlot = slot;
    this.renderActiveTab();
    this.updateFooterSelection();
  }

  /** Preset-tab highlight (selection only — the host decides on Load). */
  public setSelectedPreset(presetSlot: number | null): void {
    this.selectedPresetSlot = presetSlot;
    this.renderActiveTab();
    this.updateFooterSelection();
  }

  /** Read-only visibility for drawer-exclusivity logic (additive; no behavior change). */
  public isVisible(): boolean {
    return this.isOpen;
  }

  private confirmClearModels(): void {
    if (!this.currentBank || this.currentBank.models.length === 0) {
      toast('There are no generated models to clear in this bank.', 'warning');
      return;
    }
    const count = this.currentBank.models.length;
    void confirmDialog(
      `Clear all ${count} generated model(s) from the bank? This cannot be undone.`,
      { confirmLabel: 'Clear all', danger: true }
    ).then((ok) => {
      if (ok) this.handlers.onClearModels?.();
    });
  }

  private servePreset(presetSlot: number, name: string, modelIndex: number): void {
    if (this.handlers.onSelectPreset) {
      this.handlers.onSelectPreset(presetSlot, name, modelIndex);
    } else {
      // Legacy fallback: hosts without a preset loader keep the old
      // switch-editor-to-model behavior.
      this.handlers.onSelectModel(modelIndex);
    }
  }

  private updateFooterSelection(): void {
    if (!this.shell) return;
    const mCount = this.currentBank?.models.length ?? 0;
    const pCount = this.currentBank?.presets.length ?? 0;
    const parts: string[] = [];
    if (this.visibleTabs.includes('models')) {
      parts.push(`${mCount} model${mCount === 1 ? '' : 's'}`);
    }
    if (this.visibleTabs.includes('presets')) {
      parts.push(`${pCount} preset${pCount === 1 ? '' : 's'}`);
    }
    if (this.visibleTabs.includes('library')) {
      const lCount = this.handlers.onRequestLibrary?.().length ?? 0;
      parts.push(`${lCount} in library`);
    }
    const base = parts.join(' | ');
    const sel =
      this.selectedSlot === null
        ? undefined
        : this.currentBank?.models.find((m) => m.slot === this.selectedSlot);
    const slotEl = this.shell.element.querySelector('#bank-foot-slot');
    if (slotEl) {
      slotEl.textContent =
        this.selectedSlot === null ? 'BANK' : `#${String(this.selectedSlot).padStart(3, '0')}`;
    }
    const footStatusEl = this.shell.element.querySelector('#bank-foot-status');
    if (!footStatusEl) return;
    if (this.activeTab === 'library' && this.selectedLibrarySlot !== null) {
      const entry = this.handlers.onRequestLibrary?.().find((e) => e.slot === this.selectedLibrarySlot);
      footStatusEl.textContent = entry
        ? `${base} | Sel: ${entry.name || entry.folderName}`
        : base;
      return;
    }
    if (this.activeTab === 'presets' && this.selectedPresetSlot !== null) {
      const preset = this.currentBank?.presets.find((p) => p.slot === this.selectedPresetSlot);
      footStatusEl.textContent = preset
        ? `${base} | Sel: ${preset.name} (→ Model #${String(preset.modelIndex).padStart(3, '0')})`
        : base;
      return;
    }
    footStatusEl.textContent = sel ? `${base} | Sel: ${sel.name}` : base;
  }

  private renderActiveTab(): void {
    if (this.activeTab === 'presets') {
      this.renderPresets();
    } else if (this.activeTab === 'library') {
      this.renderLibrary();
    } else {
      this.renderModels();
    }
  }

  private bindCards(handlers: {
    onCardClick: (slot: number) => void;
    onCardDblClick: (slot: number) => void;
    onAction: (info: { slot: number; action: string }) => void;
  }): void {
    this.unbindCards?.();
    this.unbindCards = null;
    if (!this.shell) return;
    this.unbindCards = bindBankCards(this.shell.contentEl, handlers);
  }

  private renderModels(): void {
    if (!this.shell || !this.currentBank) return;
    const container = this.shell.contentEl;

    const totalModels = this.currentBank.models.length;

    if (totalModels === 0) {
      this.shell.setBadge('0 MODELS');
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

    this.shell.setBadge(
      filtered.length === totalModels
        ? `${totalModels} MODELS`
        : `${filtered.length} / ${totalModels} MODELS`
    );

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
            return bankCardHtml({
              slot: m.slot,
              catClass,
              catLabel: catName,
              name: m.name,
              iconHtml: ICONS[iconKey] || ICONS.database,
              badges: [
                `${m.zoneCount} Zone${m.zoneCount === 1 ? '' : 's'}`,
                `Lvl ${m.complexity}`,
              ],
              actions: [
                { id: 'load', label: 'Load', title: `Load Model #${m.slot} into the editor (replaces current session, undoable)` },
                { id: 'export', label: 'Export .zip', kind: 'export', title: 'Export .zip package', iconHtml: ICONS.folder },
              ],
              selected: m.slot === this.selectedSlot,
            });
          })
          .join('')}
      </div>
    `;

    // Single click only highlights; double-click / Load serves the slot
    // and the host performs the full load into the editor session.
    this.bindCards({
      onCardClick: (slot) => this.setSelectedSlot(slot),
      onCardDblClick: (slot) => {
        this.setSelectedSlot(slot);
        this.handlers.onSelectModel(slot);
      },
      onAction: ({ slot, action }) => {
        if (action === 'export') {
          this.handlers.onExportModel(slot);
          return;
        }
        this.setSelectedSlot(slot);
        this.handlers.onSelectModel(slot);
      },
    });
  }

  private renderPresets(): void {
    if (!this.shell || !this.currentBank) return;
    const container = this.shell.contentEl;

    const totalPresets = this.currentBank.presets.length;

    if (totalPresets === 0) {
      this.shell.setBadge('0 PRESETS');
      container.innerHTML = `
        <div class="neurondb-empty-state">
          <span class="empty-icon">${ICONS.sliders}</span>
          <span class="empty-msg">No sound presets loaded</span>
          <span class="ndb-dim">Presets are loaded from NeuronDB/Sounds or your library folder.</span>
          <button type="button" class="btn btn-xs btn-primary ndb-empty-action" id="btn-configure-neurondb-lib">
            <span class="btn-icon">${ICONS.folder}</span>
            <span>Configure NeuronDB Library Folder...</span>
          </button>
        </div>
      `;
      container.querySelector('#btn-configure-neurondb-lib')?.addEventListener('click', () => {
        this.handlers.onConfigureNeuronDbFolder?.();
      });
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

    this.shell.setBadge(
      filtered.length === totalPresets
        ? `${totalPresets} PRESETS`
        : `${filtered.length} / ${totalPresets} PRESETS`
    );

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
            return bankCardHtml({
              slot: p.slot,
              catClass: catInfo.catClass,
              catLabel: p.category || 'Preset',
              name: p.name,
              iconHtml: catInfo.icon,
              badges: [`Uses Model #${String(p.modelIndex).padStart(3, '0')}`, `${p.parameterCount} params`],
              actions: [
                { id: 'load', label: 'Load Sound', title: `Load Sound Preset #${String(p.slot).padStart(3, '0')}` },
              ],
              selected: p.slot === this.selectedPresetSlot,
            });
          })
          .join('')}
      </div>
    `;

    // Single click only highlights: the preset is served to the host on
    // double-click / Load, which decides what loading means. (Mirrors the
    // synth: browsing must not retarget the editor on every click.)
    this.bindCards({
      onCardClick: (slot) => this.setSelectedPreset(slot),
      onCardDblClick: (slot) => {
        const card = filtered.find((p) => p.slot === slot);
        this.setSelectedPreset(slot);
        if (card) this.servePreset(slot, card.name, card.modelIndex);
      },
      onAction: ({ slot, action }) => {
        if (action !== 'load') return;
        const card = filtered.find((p) => p.slot === slot);
        this.setSelectedPreset(slot);
        if (card) this.servePreset(slot, card.name, card.modelIndex);
      },
    });
  }

  private renderLibrary(): void {
    if (!this.shell) return;
    const container = this.shell.contentEl;

    const entries = this.handlers.onRequestLibrary?.() ?? [];

    const filtered = this.filterQuery
      ? entries.filter(
          (e) =>
            (e.name || '').toLowerCase().includes(this.filterQuery) ||
            (e.folderName || '').toLowerCase().includes(this.filterQuery) ||
            String(e.slot).includes(this.filterQuery) ||
            `#${String(e.slot).padStart(3, '0')}`.includes(this.filterQuery)
        )
      : entries;

    this.shell.setBadge(
      filtered.length === entries.length
        ? `${entries.length} IN LIBRARY`
        : `${filtered.length} / ${entries.length} IN LIBRARY`
    );

    if (entries.length === 0) {
      container.innerHTML = `
        <div class="neurondb-empty-state">
          <span class="empty-icon">${ICONS.folder}</span>
          <span class="empty-msg">No library folder scanned yet</span>
          <span class="ndb-dim">Select a NeuronDB library folder to browse its models here.</span>
          <button type="button" class="btn btn-xs btn-primary ndb-empty-action" id="btn-library-configure">
            <span class="btn-icon">${ICONS.folder}</span>
            <span>Select Library Folder...</span>
          </button>
        </div>
      `;
      container.querySelector('#btn-library-configure')?.addEventListener('click', () => {
        this.handlers.onConfigureNeuronDbFolder?.();
      });
      return;
    }

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="neurondb-empty-state">
          <span class="empty-icon">${ICONS.folder}</span>
          <span class="empty-msg">No library models found matching "${this.filterQuery}"</span>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="ndb-grid">
        ${filtered
          .map((e) => {
            // Same parameter-set coloring as the models tab / NeuronDB modal.
            const ps = e.parameterSet !== null ? PARAMETER_SETS[e.parameterSet] : null;
            const catClass = ps ? `cat-${ps.id}` : 'cat-neutral';
            const catName = ps ? `${ps.id}: ${ps.name}` : 'Pending';
            const iconKey = ps ? (`param${ps.id}` as keyof typeof ICONS) : 'database';
            const range =
              e.lowKey !== null && e.highKey !== null ? `MM ${e.lowKey}..${e.highKey}` : (e.folderName ?? '');
            return bankCardHtml({
              slot: e.slot,
              catClass,
              catLabel: catName,
              name: e.name || e.folderName,
              iconHtml: ICONS[iconKey] || ICONS.database,
              badges: [
                ...(e.zoneCount !== null ? [`${e.zoneCount} Zone${e.zoneCount === 1 ? '' : 's'}`] : []),
                ...(e.complexity !== null ? [`Lvl ${e.complexity}`] : []),
                range,
              ],
              actions: [
                { id: 'load', label: 'Load', title: `Load library Model #${String(e.slot).padStart(3, '0')} into the editor` },
              ],
              selected: e.slot === this.selectedLibrarySlot,
            });
          })
          .join('')}
      </div>
    `;

    this.bindCards({
      onCardClick: (slot) => this.setSelectedLibrary(slot),
      onCardDblClick: (slot) => {
        this.setSelectedLibrary(slot);
        this.handlers.onPickLibrary?.(slot);
      },
      onAction: ({ slot, action }) => {
        if (action !== 'load') return;
        this.setSelectedLibrary(slot);
        this.handlers.onPickLibrary?.(slot);
      },
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
    this.shell?.element.classList.remove('is-closed');
    this.shell?.element.classList.add('is-open');
    this.shell?.focusSearch();
  }

  public close(): void {
    this.isOpen = false;
    this.shell?.element.classList.remove('is-open');
    this.shell?.element.classList.add('is-closed');
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.isOpen) {
      this.close();
    }
  };

  public destroy(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    this.unbindCards?.();
    this.unbindCards = null;
    this.shell?.destroy();
    this.shell = null;
  }
}
