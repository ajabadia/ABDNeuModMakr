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
import { confirmDialog, promptDialog, toast } from './notify';
import { createBankShell } from '@abdsynths/shared/components/bank/bankShell.js';
import { bankCardHtml, bindBankCards } from '@abdsynths/shared/components/bank/bankCard.js';
import { bankChipsHtml, bindBankChips, type BankChipItem } from '@abdsynths/shared/components/bank/bankChips.js';
import { classifyBankCategory } from '@abdsynths/shared/components/bank/bankCategories.js';
import { evaluateNeuronDb, type NeuronDbEvaluation } from '@abdsynths/shared/formats/neuron';
import type { AxionikDbModelEntry } from '../core/bridge/BridgeClient';
import type { SublibraryInfo } from '../core/types';
import { AXIONIK_CATEGORIES } from '../core/modelSlug';
import { escAttr } from './escape';
import { isSafeCoverDataUrl } from '../core/bankService';
import { getAppLocale, onAppLocaleChange, tApp } from '../core/i18n';

export type BankTab = 'models' | 'presets' | 'library' | 'axionik';

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
  /**
   * Rescans the last configured library folder without a picker.
   * Returns null when no folder was ever configured (the drawer then
   * points at Folder…). Rejected on scan errors (the drawer reports it).
   */
  onRefreshLibrary?: () => Promise<{ models: number; presets: number } | null>;
  /** Live AxionikDB modern library entries */
  onRequestAxionik?: () => AxionikDbModelEntry[];
  /** Axionik model chosen for loading */
  onPickAxionik?: (slug: string) => void;
  /** Axionik model chosen for duplicating / save as */
  onDuplicateAxionik?: (slug: string) => void;
  /** Configure AxionikDB folder */
  onConfigureAxionikDbFolder?: () => void;
  /** Refresh AxionikDB */
  onRefreshAxionik?: () => Promise<number | null>;
  /** Fase 23: Live Sub-libraries list */
  onRequestSublibraries?: () => Promise<SublibraryInfo[]> | SublibraryInfo[];
  /** Fase 23: Create new sub-library */
  onCreateSublibrary?: (name: string, description?: string) => Promise<void>;
  /** Fase 23: Delete empty sub-library */
  onDeleteSublibrary?: (name: string) => Promise<void>;
  /** Fase 23: Move model between sub-libraries */
  onMoveAxionikModel?: (slug: string, targetSublibrary: string) => Promise<void>;
  /** Fase 23: Reorder models within sub-library */
  onReorderSublibrary?: (sublibrary: string, orderedSlugs: string[]) => Promise<void>;
}

export function getPresetCategoryInfo(category: string): { icon: string; catClass: string; paramId: number } {
  const { catClass, paramId } = classifyBankCategory(category);
  return { icon: ICONS[`param${paramId}` as keyof typeof ICONS] || ICONS.param0, catClass, paramId };
}

export class BankDrawer {
  private container: HTMLElement;
  private handlers: BankDrawerHandlers;
  private isOpen: boolean = false;
  private shell: ReturnType<typeof createBankShell> | null = null;
  private unbindCards: (() => void) | null = null;
  private currentBank: BankSummary | null = null;
  private dbEvaluation: NeuronDbEvaluation | null = null;
  private activeTab: BankTab = 'models';
  private readonly visibleTabs: BankTab[];
  private filterQuery: string = '';
  private selectedSlot: number | null = null;
  private selectedPresetSlot: number | null = null;
  private selectedLibrarySlot: number | null = null;
  /** Category pills (row only serves the pick; filtering stays here). */
  private selectedModelCategory: number | 'all' = 'all';
  private selectedLibraryCategory: string = 'all';
  private selectedAxionikSlug: string | null = null;
  private selectedAxionikCategory: string = 'all';
  private selectedAxionikSublibrary: string = 'all';
  private axionikSortMode: 'ordinal' | 'name' | 'date' = 'ordinal';
  private chipsUnbind: (() => void) | null = null;

  private getTabLabel(id: BankTab): string {
    if (id === 'models') return tApp('bankDrawer.tabGenerated');
    if (id === 'library') return tApp('bankDrawer.tabClassic');
    if (id === 'axionik') return tApp('bankDrawer.tabAdvanced');
    return getAppLocale() === 'es' ? 'PRESETS DE SONIDO' : 'SOUND PRESETS';
  }

  constructor(container: HTMLElement, handlers: BankDrawerHandlers, options?: BankDrawerOptions) {
    this.container = container;
    this.handlers = handlers;
    this.visibleTabs = options?.visibleTabs ?? ['models', 'presets'];
    if (!this.visibleTabs.includes(this.activeTab)) {
      this.activeTab = this.visibleTabs[0] ?? 'models';
    }
    this.init();
    onAppLocaleChange(() => {
      if (this.shell) {
        const titleEl = this.shell.element.querySelector('.bank-shell-title span:last-child, [data-shell-title]');
        if (titleEl) titleEl.textContent = tApp('bankDrawer.headerTitle');
        const searchInput = this.shell.element.querySelector<HTMLInputElement>('input[type="search"], input[type="text"], .bank-shell-search input');
        if (searchInput) searchInput.placeholder = tApp('bankDrawer.searchPlaceholder');
        this.visibleTabs.forEach((id) => {
          const tabBtn = this.shell?.element.querySelector(`[data-tab="${id}"]`);
          if (tabBtn) {
            const labelSpan = tabBtn.querySelector('.bank-tab-label') ?? tabBtn.firstChild;
            if (labelSpan && labelSpan.nodeType === Node.TEXT_NODE) {
              labelSpan.textContent = `${this.getTabLabel(id)} `;
            } else if (labelSpan instanceof HTMLElement) {
              labelSpan.textContent = this.getTabLabel(id);
            }
          }
        });
      }
      this.updateCounters();
      this.renderChips();
      this.renderActiveTab();
    });
  }

  private init(): void {
    const es = getAppLocale() === 'es';
    this.shell = createBankShell({
      title: tApp('bankDrawer.headerTitle'),
      badge: '0 ITEMS',
      tabs: this.visibleTabs.map((id) => ({ id, label: this.getTabLabel(id) })),
      activeTab: this.activeTab,
      searchPlaceholder: tApp('bankDrawer.searchPlaceholder'),
      headerActions: [
        { id: 'refresh', label: es ? 'Refrescar' : 'Refresh', title: es ? 'Reescanear carpeta de librería' : 'Refresh library folder (rescan)', iconHtml: ICONS.refresh },
        { id: 'folder', label: es ? 'Carpeta' : 'Folder', title: es ? 'Configurar carpeta de librería NeuronDB' : 'Configure NeuronDB library folder', iconHtml: ICONS.folder },
        { id: 'clear', label: es ? 'Vaciar' : 'Clear', title: tApp('bankDrawer.btnClearTitle'), iconHtml: ICONS.trash },
        { id: 'close', label: es ? 'Cerrar' : 'Close', title: tApp('bankDrawer.btnCloseTitle'), iconHtml: ICONS.close },
      ],
      // No footer actions: the header already serves Refresh/Folder/Clear/
      // Close. The footer keeps the slot + status line (bank summary,
      // refresh record, selection) with no duplicated buttons.
      onTabChange: (tab) => {
        this.activeTab = tab as BankTab;
        this.renderChips();
        this.renderActiveTab();
      },
      onSearch: (query) => {
        this.filterQuery = query;
        this.renderActiveTab();
      },
      onHeaderAction: (id) => {
        if (id === 'refresh') this.refreshBank();
        else if (id === 'folder') this.handlers.onConfigureNeuronDbFolder?.();
        else if (id === 'clear') this.confirmClearModels();
      },
      onFooterAction: (id) => {
        if (id === 'refresh') this.refreshBank();
        else if (id === 'folder') this.handlers.onConfigureNeuronDbFolder?.();
        else if (id === 'close') this.close();
      },
      onClose: () => this.close(),
    });
    this.shell.element.classList.add('is-closed');
    const iconEl = this.shell.element.querySelector('[data-shell-icon]');
    if (iconEl) iconEl.innerHTML = ICONS.database;
    const searchIconEl = this.shell.element.querySelector('[data-shell-search-icon]');
    if (searchIconEl) searchIconEl.innerHTML = ICONS.search;
    // The shell owns the footer skeleton (slot + status + actions).
    this.shell.setFootSlot('BANK');
    this.shell.setFooterStatus('No bank loaded');
    this.renderChips();

    this.container.appendChild(this.shell.element);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  public setBank(bank: BankSummary, selectedSlot?: number | null): void {
    this.currentBank = bank;
    this.dbEvaluation = evaluateNeuronDb(bank.models, bank.presets);
    if (selectedSlot !== undefined) {
      this.selectedSlot = selectedSlot;
    }
    this.selectedPresetSlot = null;
    this.updateCounters();
    this.renderChips();
    this.renderActiveTab();
  }

  /**
   * User-facing library refresh: working state first, then the host
   * rescan result (or a pointer at Folder… when nothing was ever
   * configured). Same feedback contract as the synth.
   */
  public refreshBank(): void {
    if (!this.shell) return;
    this.shell.setFooterStatus('Refreshing library…');
    this.shell.flashStatus('Refreshing library…', 'working');
    const shellAny = this.shell as any;
    shellAny?.setBusy?.('refresh', true);
    void (async () => {
      try {
        const res = await this.handlers.onRefreshLibrary?.();
        if (!res) {
          const msg = 'No library folder configured yet — use Folder…';
          this.shell?.setFooterStatus(msg);
          this.shell?.flashStatus(msg, 'ok');
          return;
        }
        this.updateCounters();
        this.renderChips();
        this.renderActiveTab();
        const time = new Date().toLocaleTimeString();
        const msg = `Library refreshed · ${res.models} models, ${res.presets} presets · ${time}`;
        this.shell?.setFooterStatus(msg);
        this.shell?.flashStatus(`Library refreshed · ${res.models} models, ${res.presets} presets`, 'ok');
      } catch (err) {
        const message = `Refresh failed: ${err instanceof Error ? err.message : String(err)}`;
        this.shell?.setFooterStatus(message);
        this.shell?.flashStatus(message, 'error');
      } finally {
        shellAny?.setBusy?.('refresh', false);
      }
    })();
  }

  private updateCounters(): void {
    if (!this.shell) return;
    const mCount = this.currentBank?.models.length ?? 0;
    const pCount = this.currentBank?.presets.length ?? 0;
    const lCount = this.handlers.onRequestLibrary?.().length ?? 0;
    const s = this.shell as any;
    if (typeof s.setTabCount === 'function') {
      s.setTabCount('models', mCount);
      s.setTabCount('presets', pCount);
      s.setTabCount('library', lCount);
    } else if (typeof s.setTabLabels === 'function') {
      s.setTabLabels({
        models: `MODELS (${mCount})`,
        presets: `PRESETS (${pCount})`,
        library: `LIBRARY (${lCount})`,
      });
    }
    this.updateFooterSelection();
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
    this.shell.setFootSlot(
      this.selectedSlot === null ? 'BANK' : `#${String(this.selectedSlot).padStart(3, '0')}`
    );
    if (this.activeTab === 'library' && this.selectedLibrarySlot !== null) {
      const entry = this.handlers.onRequestLibrary?.().find((e) => e.slot === this.selectedLibrarySlot);
      this.shell.setFooterStatus(
        entry ? `${base} | Sel: ${entry.name || entry.folderName}` : base
      );
      return;
    }
    if (this.activeTab === 'axionik' && this.selectedAxionikSlug !== null) {
      const entry = this.handlers.onRequestAxionik?.().find((e) => e.slug === this.selectedAxionikSlug);
      this.shell.setFooterStatus(
        entry ? `${base} | Sel: ${entry.name} (${entry.slug})` : base
      );
      return;
    }
    if (this.activeTab === 'presets' && this.selectedPresetSlot !== null) {
      const preset = this.currentBank?.presets.find((p) => p.slot === this.selectedPresetSlot);
      this.shell.setFooterStatus(
        preset
          ? `${base} | Sel: ${preset.name} (→ Model #${String(preset.modelIndex).padStart(3, '0')})`
          : base
      );
      return;
    }
    this.shell.setFooterStatus(sel ? `${base} | Sel: ${sel.name}` : base);
  }

  /**
   * Category pills for the models/library tabs (the row only serves the
   * pick; filtering stays host logic — same contract as the synth).
   */
  private renderChips(): void {
    if (!this.shell) return;
    this.chipsUnbind?.();
    this.chipsUnbind = null;
    const built = this.chipItemsForTab();
    if (!built) {
      this.shell.toolbarEl.innerHTML = '';
      return;
    }
    this.shell.toolbarEl.innerHTML =
      '<div class="ndb-chips-row bank-shell-chips-row" id="ndb-cat-chips-row"></div>';
    const row = this.shell.toolbarEl.querySelector('#ndb-cat-chips-row') as HTMLElement;
    row.innerHTML = bankChipsHtml(built.items, built.activeId);
    this.chipsUnbind = bindBankChips(row, (id) => {
      if (this.activeTab === 'models') {
        this.selectedModelCategory = id === 'all' ? 'all' : parseInt(id || '0', 10);
      } else if (this.activeTab === 'library') {
        this.selectedLibraryCategory = id;
      } else if (this.activeTab === 'axionik') {
        this.selectedAxionikCategory = id;
      }
      this.renderChips();
      this.renderActiveTab();
    });
  }

  private chipItemsForTab(): { items: BankChipItem[]; activeId: string } | null {
    const allLabel = tApp('bankDrawer.filterAll');
    if (this.activeTab === 'models' && this.currentBank) {
      const counts: Record<number, number> = {};
      for (const m of this.currentBank.models) {
        counts[m.parameterSet] = (counts[m.parameterSet] || 0) + 1;
      }
      // All ten sets always: same pill row whatever the bank contains.
      const items: BankChipItem[] = [{ id: 'all', label: allLabel, count: this.currentBank.models.length }];
      for (let i = 0; i <= 9; i++) {
        const count = counts[i] || 0;
        const ps = PARAMETER_SETS[i];
        const setName = ps ? ps.name : `Set ${i}`;
        items.push({
          id: String(i),
          label: ps ? ps.category : setName,
          count,
          catClass: `cat-${i}`,
          title: setName,
          prefixHtml: `<strong class="cat-${i}">${i}:</strong> `,
        });
      }
      return {
        items,
        activeId: this.selectedModelCategory === 'all' ? 'all' : String(this.selectedModelCategory),
      };
    }
    if (this.activeTab === 'library') {
      const entries = this.handlers.onRequestLibrary?.() ?? [];
      const counts: Record<number, number> = {};
      let pending = 0;
      for (const e of entries) {
        if (e.parameterSet === null) pending++;
        else counts[e.parameterSet] = (counts[e.parameterSet] || 0) + 1;
      }
      // All ten sets always: same pill row whatever the folder contains.
      const items: BankChipItem[] = [{ id: 'all', label: allLabel, count: entries.length }];
      for (let i = 0; i <= 9; i++) {
        const count = counts[i] || 0;
        const ps = PARAMETER_SETS[i];
        const setName = ps ? ps.name : `Set ${i}`;
        items.push({
          id: String(i),
          label: ps ? ps.category : setName,
          count,
          catClass: `cat-${i}`,
          title: setName,
          prefixHtml: `<strong class="cat-${i}">${i}:</strong> `,
        });
      }
      if (pending > 0 || entries.length === 0) {
        items.push({
          id: 'pending',
          label: getAppLocale() === 'es' ? 'Pendiente' : 'Pending',
          count: pending,
          catClass: 'cat-neutral',
          title: getAppLocale() === 'es' ? 'Aún no escaneado' : 'Not scanned yet',
        });
      }
      return { items, activeId: this.selectedLibraryCategory };
    }
    if (this.activeTab === 'axionik') {
      const entries = this.handlers.onRequestAxionik?.() ?? [];
      const counts: Record<string, number> = {};
      for (const e of entries) {
        counts[e.category] = (counts[e.category] || 0) + 1;
      }
      const items: BankChipItem[] = [{ id: 'all', label: allLabel, count: entries.length }];
      for (const cat of AXIONIK_CATEGORIES) {
        const count = counts[cat.name] || 0;
        items.push({
          id: cat.name,
          label: cat.name,
          count,
        });
      }
      return { items, activeId: this.selectedAxionikCategory };
    }
    return null;
  }

  private renderActiveTab(): void {
    if (this.activeTab === 'presets') {
      this.renderPresets();
    } else if (this.activeTab === 'library') {
      this.renderLibrary();
    } else if (this.activeTab === 'axionik') {
      this.renderAxionik();
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

    const inCategory =
      this.selectedModelCategory === 'all'
        ? this.currentBank.models
        : this.currentBank.models.filter((m) => m.parameterSet === this.selectedModelCategory);
    const filtered = this.filterQuery
      ? inCategory.filter(
          (m) =>
            m.name.toLowerCase().includes(this.filterQuery) ||
            String(m.slot).includes(this.filterQuery) ||
            `#${String(m.slot).padStart(3, '0')}`.includes(this.filterQuery) ||
            (PARAMETER_SETS[m.parameterSet]?.name.toLowerCase().includes(this.filterQuery) ?? false)
        )
      : inCategory;

    this.shell.setBadge(
      filtered.length === totalModels
        ? `${totalModels} MODELS`
        : `${filtered.length} / ${totalModels} MODELS`
    );

    if (filtered.length === 0) {
      const emptyMsg = this.filterQuery
        ? `No models found matching "${this.filterQuery}"`
        : 'No models in this category yet';
      container.innerHTML = `
        <div class="neurondb-empty-state">
          <span class="empty-icon">${ICONS.database}</span>
          <span class="empty-msg">${emptyMsg}</span>
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
            const dep = this.dbEvaluation?.modelDependencies.get(m.slot);
            const usedCount = dep ? dep.usedByPresetSlots.length : 0;
            const es = getAppLocale() === 'es';
            const usageBadge =
              usedCount > 0
                ? `${usedCount} ${tApp('bankDrawer.badgeSounds')}`
                : es ? 'Sin uso' : 'Unused';
            const safeCover = isSafeCoverDataUrl(m.coverWebpDataUrl) ? m.coverWebpDataUrl : undefined;
            const cardIconHtml = safeCover
              ? `<img src="${escAttr(safeCover)}" alt="${escAttr(m.name)}" class="ndb-card-cover-img" />`
              : ICONS[iconKey] || ICONS.database;
            const zoneWord = m.zoneCount === 1 ? tApp('bankDrawer.badgeZoneSingular') : tApp('bankDrawer.badgeZonePlural');
            const badges = [
              `${m.zoneCount} ${zoneWord}`,
              `Lvl ${m.complexity}`,
              usageBadge,
            ];
            if (safeCover) {
              badges.push('WEBP');
            }
            return bankCardHtml({
              slot: m.slot,
              catClass,
              catLabel: catName,
              name: m.name,
              iconHtml: cardIconHtml,
              badges,
              actions: [
                { id: 'load', label: tApp('bankDrawer.btnLoad'), title: tApp('bankDrawer.btnLoadTitle') },
                { id: 'export', label: tApp('bankDrawer.btnCapsule'), kind: 'export', title: tApp('bankDrawer.btnCapsuleCardTitle'), iconHtml: ICONS.folder },
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

    const inCategory =
      this.selectedLibraryCategory === 'all'
        ? entries
        : this.selectedLibraryCategory === 'pending'
          ? entries.filter((e) => e.parameterSet === null)
          : entries.filter((e) => e.parameterSet === parseInt(this.selectedLibraryCategory, 10));
    const filtered = this.filterQuery
      ? inCategory.filter(
          (e) =>
            (e.name || '').toLowerCase().includes(this.filterQuery) ||
            (e.folderName || '').toLowerCase().includes(this.filterQuery) ||
            String(e.slot).includes(this.filterQuery) ||
            `#${String(e.slot).padStart(3, '0')}`.includes(this.filterQuery)
        )
      : inCategory;

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
      const emptyMsg = this.filterQuery
        ? `No library models found matching "${this.filterQuery}"`
        : 'No library models in this category yet';
      container.innerHTML = `
        <div class="neurondb-empty-state">
          <span class="empty-icon">${ICONS.folder}</span>
          <span class="empty-msg">${emptyMsg}</span>
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

  private renderAxionik(): void {
    if (!this.shell) return;
    const container = this.shell.contentEl;

    const entries = this.handlers.onRequestAxionik?.() ?? [];

    // Harvest sublibraries from models + Default
    const sublibSet = new Set<string>(['Default']);
    for (const e of entries) {
      if (e.sublibrary && e.sublibrary.trim().length > 0) {
        sublibSet.add(e.sublibrary.trim());
      }
    }
    const sublibList = Array.from(sublibSet).sort((a, b) => (a === 'Default' ? -1 : b === 'Default' ? 1 : a.localeCompare(b)));

    // Filter by Sub-library
    const inSublib =
      this.selectedAxionikSublibrary === 'all'
        ? entries
        : entries.filter((e) => (e.sublibrary || 'Default').toLowerCase() === this.selectedAxionikSublibrary.toLowerCase());

    // Filter by Category
    const inCategory =
      this.selectedAxionikCategory === 'all'
        ? inSublib
        : inSublib.filter((e) => e.category === this.selectedAxionikCategory);

    // Filter by Search Query
    const filtered = this.filterQuery
      ? inCategory.filter(
          (e) =>
            (e.name || '').toLowerCase().includes(this.filterQuery.toLowerCase()) ||
            (e.slug || '').toLowerCase().includes(this.filterQuery.toLowerCase()) ||
            (e.category || '').toLowerCase().includes(this.filterQuery.toLowerCase()) ||
            (e.sublibrary || '').toLowerCase().includes(this.filterQuery.toLowerCase())
        )
      : inCategory;

    // Sort models
    if (this.axionikSortMode === 'ordinal') {
      filtered.sort((a, b) => (a.sublibraryOrdinal ?? 999) - (b.sublibraryOrdinal ?? 999));
    } else if (this.axionikSortMode === 'name') {
      filtered.sort((a, b) => a.name.localeCompare(b.name));
    } else if (this.axionikSortMode === 'date') {
      filtered.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    }

    this.shell.setBadge(
      filtered.length === entries.length
        ? `${entries.length} IN AXIONIKDB`
        : `${filtered.length} / ${entries.length} IN AXIONIKDB`
    );

    if (entries.length === 0) {
      container.innerHTML = `
        <div class="neurondb-empty-state">
          <span class="empty-icon">${ICONS.database}</span>
          <span class="empty-msg">No models in AxionikDB library yet</span>
          <span class="ndb-dim">Save your extended models to AxionikDB or configure the library folder in Settings.</span>
          <button type="button" class="btn btn-xs btn-primary ndb-empty-action" id="btn-axionik-configure">
            <span class="btn-icon">${ICONS.folder}</span>
            <span>Configure AxionikDB Folder...</span>
          </button>
        </div>
      `;
      container.querySelector('#btn-axionik-configure')?.addEventListener('click', () => {
        this.handlers.onConfigureAxionikDbFolder?.();
      });
      return;
    }

    const currentSubModelsCount = entries.filter(
      (e) => (e.sublibrary || 'Default').toLowerCase() === this.selectedAxionikSublibrary.toLowerCase()
    ).length;
    const canDeleteSub =
      this.selectedAxionikSublibrary !== 'all' &&
      this.selectedAxionikSublibrary.toLowerCase() !== 'default' &&
      currentSubModelsCount === 0;

    const sublibOptionsHtml = sublibList
      .map((s) => {
        const count = entries.filter((e) => (e.sublibrary || 'Default').toLowerCase() === s.toLowerCase()).length;
        return `<option value="${escAttr(s)}" ${s.toLowerCase() === this.selectedAxionikSublibrary.toLowerCase() ? 'selected' : ''}>${escAttr(s)} (${count})</option>`;
      })
      .join('');

    const toolbarHtml = `
      <div class="axionik-sublib-toolbar">
        <div class="bank-inline-row">
          <span class="bank-toolbar-label">Sub-library:</span>
          <select id="sel-axionik-sublib" class="form-control bank-toolbar-select">
            <option value="all" ${this.selectedAxionikSublibrary === 'all' ? 'selected' : ''}>All Sub-libraries (${entries.length})</option>
            ${sublibOptionsHtml}
          </select>
          <button type="button" class="btn btn-xs btn-outline" id="btn-axionik-new-sublib" title="Create new sub-library">
            ${ICONS.plus} New
          </button>
          <button type="button" class="btn btn-xs btn-outline bank-del-btn" id="btn-axionik-del-sublib" title="Delete current sub-library (must be empty)" ${canDeleteSub ? '' : 'disabled'}>
            ${ICONS.trash} Delete
          </button>
        </div>
        <div class="bank-inline-row">
          <span class="bank-toolbar-label">Sort:</span>
          <select id="sel-axionik-sort" class="form-control bank-toolbar-select">
            <option value="ordinal" ${this.axionikSortMode === 'ordinal' ? 'selected' : ''}>Ordinal # (Manual)</option>
            <option value="name" ${this.axionikSortMode === 'name' ? 'selected' : ''}>Name (A-Z)</option>
            <option value="date" ${this.axionikSortMode === 'date' ? 'selected' : ''}>Recent Date</option>
          </select>
        </div>
      </div>
    `;

    if (filtered.length === 0) {
      const emptyMsg = this.filterQuery
        ? `No AxionikDB models matching "${this.filterQuery}"`
        : `No AxionikDB models in ${this.selectedAxionikSublibrary === 'all' ? 'this category' : `sub-library "${this.selectedAxionikSublibrary}"`}`;
      container.innerHTML = `
        ${toolbarHtml}
        <div class="neurondb-empty-state">
          <span class="empty-icon">${ICONS.database}</span>
          <span class="empty-msg">${emptyMsg}</span>
        </div>
      `;
      this.bindAxionikToolbarEvents(sublibList);
      return;
    }

    container.innerHTML = `
      ${toolbarHtml}
      <div class="ndb-grid axionik-grid">
        ${filtered
          .map((e, idx) => {
            const catClass = `cat-${e.parameterSet ?? 0}`;
            const iconKey = (`param${e.parameterSet ?? 0}` as keyof typeof ICONS);
            const subLabel = e.sublibrary || 'Default';
            const ordLabel = e.sublibraryOrdinal ? `#${e.sublibraryOrdinal}` : `#${idx + 1}`;

            const cardActions = [
              { id: 'load', label: 'Load', title: `Load Model "${e.name}" into the editor` },
              { id: 'duplicate', label: 'Duplicate', title: `Duplicate / Save As...`, iconHtml: ICONS.layers },
              { id: 'move', label: 'Move...', title: `Move to another sub-library`, iconHtml: ICONS.folder },
            ];

            if (this.axionikSortMode === 'ordinal') {
              cardActions.push({ id: 'up', label: '▲', title: 'Move Up in ordinal order' });
              cardActions.push({ id: 'down', label: '▼', title: 'Move Down in ordinal order' });
            }

            return bankCardHtml({
              slot: idx,
              catClass,
              catLabel: e.category,
              name: e.name,
              iconHtml: ICONS[iconKey] || ICONS.database,
              badges: [
                `${subLabel} (${ordLabel})`,
                `${e.zoneCount} Zones`,
                `Set ${e.parameterSet}`,
                e.hasCover ? 'Cover OK' : 'No Cover',
              ],
              actions: cardActions,
              selected: e.slug === this.selectedAxionikSlug,
            });
          })
          .join('')}
      </div>
    `;

    this.bindAxionikToolbarEvents(sublibList);

    this.bindCards({
      onCardClick: (slot) => {
        const item = filtered[slot];
        if (item) {
          this.selectedAxionikSlug = item.slug;
          this.updateFooterSelection();
        }
      },
      onCardDblClick: (slot) => {
        const item = filtered[slot];
        if (item) {
          this.selectedAxionikSlug = item.slug;
          this.handlers.onPickAxionik?.(item.slug);
        }
      },
      onAction: async ({ slot, action }) => {
        const item = filtered[slot];
        if (!item) return;
        this.selectedAxionikSlug = item.slug;

        if (action === 'load') {
          this.handlers.onPickAxionik?.(item.slug);
        } else if (action === 'duplicate') {
          this.handlers.onDuplicateAxionik?.(item.slug);
        } else if (action === 'move') {
          const currentSub = item.sublibrary || 'Default';
          const entered = await promptDialog(`Move "${item.name}" to sub-library (e.g. Default, Pads, Lead):`, currentSub, {
            title: 'Move Model',
            confirmLabel: 'Move',
          });
          if (!entered || !entered.trim() || entered.trim() === currentSub) return;
          const targetSub = entered.trim();
          try {
            await this.handlers.onMoveAxionikModel?.(item.slug, targetSub);
            item.sublibrary = targetSub;
            this.renderAxionik();
            toast(`Moved "${item.name}" to "${targetSub}"`, 'success');
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            toast(`Failed to move model: ${msg}`, 'error');
          }
        } else if (action === 'up' && slot > 0) {
          const prev = filtered[slot - 1];
          const curOrd = item.sublibraryOrdinal ?? (slot + 1);
          const prevOrd = prev.sublibraryOrdinal ?? slot;
          item.sublibraryOrdinal = prevOrd;
          prev.sublibraryOrdinal = curOrd;
          const currentSub = item.sublibrary || 'Default';
          const orderedSlugs = filtered.map((m) => m.slug);
          // Swap
          orderedSlugs[slot] = prev.slug;
          orderedSlugs[slot - 1] = item.slug;
          await this.handlers.onReorderSublibrary?.(currentSub, orderedSlugs);
          this.renderAxionik();
        } else if (action === 'down' && slot < filtered.length - 1) {
          const next = filtered[slot + 1];
          const curOrd = item.sublibraryOrdinal ?? (slot + 1);
          const nextOrd = next.sublibraryOrdinal ?? (slot + 2);
          item.sublibraryOrdinal = nextOrd;
          next.sublibraryOrdinal = curOrd;
          const currentSub = item.sublibrary || 'Default';
          const orderedSlugs = filtered.map((m) => m.slug);
          // Swap
          orderedSlugs[slot] = next.slug;
          orderedSlugs[slot + 1] = item.slug;
          await this.handlers.onReorderSublibrary?.(currentSub, orderedSlugs);
          this.renderAxionik();
        }
      },
    });
  }

  private bindAxionikToolbarEvents(_sublibList: string[]): void {
    if (!this.shell) return;
    const container = this.shell.contentEl;

    const selSub = container.querySelector<HTMLSelectElement>('#sel-axionik-sublib');
    selSub?.addEventListener('change', () => {
      this.selectedAxionikSublibrary = selSub.value;
      this.renderAxionik();
    });

    const selSort = container.querySelector<HTMLSelectElement>('#sel-axionik-sort');
    selSort?.addEventListener('change', () => {
      this.axionikSortMode = selSort.value as 'ordinal' | 'name' | 'date';
      this.renderAxionik();
    });

    container.querySelector('#btn-axionik-new-sublib')?.addEventListener('click', async () => {
      const entered = await promptDialog('Enter new Sub-library name:', '', {
        title: 'New Sub-library',
        confirmLabel: 'Create',
      });
      if (!entered || !entered.trim()) return;
      const clean = entered.trim();
      try {
        await this.handlers.onCreateSublibrary?.(clean);
        this.selectedAxionikSublibrary = clean;
        this.renderAxionik();
        toast(`Created sub-library "${clean}"`, 'success');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        toast(`Failed to create sub-library: ${msg}`, 'error');
      }
    });

    container.querySelector('#btn-axionik-del-sublib')?.addEventListener('click', async () => {
      if (this.selectedAxionikSublibrary === 'all' || this.selectedAxionikSublibrary.toLowerCase() === 'default') {
        return;
      }
      const subName = this.selectedAxionikSublibrary;
      const confirmed = await confirmDialog(
        `Are you sure you want to delete the empty sub-library "${subName}"?`,
        { confirmLabel: 'Delete Sub-library', cancelLabel: 'Cancel' }
      );
      if (!confirmed) return;
      try {
        await this.handlers.onDeleteSublibrary?.(subName);
        this.selectedAxionikSublibrary = 'all';
        this.renderAxionik();
        toast(`Deleted sub-library "${subName}"`, 'success');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        toast(`Cannot delete sub-library: ${msg}`, 'error');
      }
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
    const s = this.shell as any;
    if (typeof s?.focusSearch === 'function') {
      s.focusSearch();
    } else {
      (this.shell?.toolbarEl.querySelector('input') as HTMLInputElement | null)?.focus();
    }
    // Check storage quota and alert user if exceeding 80%
    if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.estimate === 'function') {
      navigator.storage.estimate().then((est) => {
        if (est.quota && est.usage) {
          const pct = Math.round((est.usage / est.quota) * 100);
          if (pct >= 80) {
            this.shell?.setFooterStatus(`Storage warning: browser storage is ${pct}% full (${Math.round(est.usage / (1024 * 1024))}MB used). Consider uninstalling unused models in Settings.`);
          }
        }
      }).catch(() => {
        // Ignore storage estimate failure
      });
    }
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
    this.chipsUnbind?.();
    this.chipsUnbind = null;
    this.shell?.destroy();
    this.shell = null;
  }
}
