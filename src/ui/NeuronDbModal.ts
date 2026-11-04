// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — NeuronDB Browser Modal
// Canonical modal for browsing, filtering, and previewing
// Hartmann Factory & User models with full keyboard navigation.
// Styled after the ABDMS2000 Wavetable / Sound Browser aesthetic:
// category chips, search with integrated icon, dual Table/Grid views,
// and high-contrast informative selection footer.
// ─────────────────────────────────────────────────────────

import { getAppLocale } from '../core/i18n.ts';
import { ICONS } from './icons';
import { createModalFocusTrap, type FocusTrap } from './modalFocusTrap.ts';
import { midiToNoteName } from './ZoneRibbon';
import { PARAMETER_SETS } from '../core';
import { escHtml, escAttr } from './escape';

export interface NeuronDbModelEntry {
  slot: number;
  folderName?: string;
  name: string;
  zoneCount: number | null;
  lowKey: number | null;
  highKey: number | null;
  sourceCount: number | null;
  parameterSet: number | null;
  complexity: number | null;
  stickModes: number | null;
  modelPath?: string;
  loadedMeta?: boolean;
}

export type NeuronDbSortColumn = 'slot' | 'name' | 'zones' | 'sources' | 'param' | 'comp';
export type NeuronDbViewMode = 'grid' | 'table';

const STICK_TABLE = [4, 8, 8, 12, 16, 20, 32, 32, 48, 64];

export function stickModesToComplexity(modes: number): number {
  const idx = STICK_TABLE.indexOf(modes);
  return idx >= 0 ? idx + 1 : Math.max(1, Math.min(10, Math.round(modes / 6.4)));
}

export class NeuronDbModal {
  private backdropEl: HTMLElement | null = null;
  private entries: NeuronDbModelEntry[] = [];
  private searchQuery = '';
  private filterParamSet: number | 'all' = 'all';
  private filterComplexity: number | 'all' = 'all';
  private sortColumn: NeuronDbSortColumn = 'slot';
  private sortAsc = true;
  private selectedSlot: number | null = null;
  private abortScan = false;
  private onPickSlot: ((slot: number) => void) | null = null;
  private viewMode: NeuronDbViewMode = 'grid';
  private focusTrap: FocusTrap | null = null;

  public open(
    initialEntries: NeuronDbModelEntry[],
    onPick: (slot: number) => void,
    onCancel?: () => void
  ): void {
    this.abortScan = false;
    this.entries = [...initialEntries].sort((a, b) => a.slot - b.slot);
    this.searchQuery = '';
    this.filterParamSet = 'all';
    this.filterComplexity = 'all';
    this.sortColumn = 'slot';
    this.sortAsc = true;
    this.selectedSlot = this.entries[0]?.slot ?? null;
    this.onPickSlot = onPick;

    const isEs = getAppLocale() === 'es';
    if (!this.backdropEl) {
      this.backdropEl = document.createElement('div');
      this.backdropEl.className = 'nmm-modal-backdrop is-hidden';
      document.body.appendChild(this.backdropEl);
    }

    this.backdropEl.innerHTML = `
      <div class="nmm-modal-window nmm-modal-xl neurondb-modal-card" role="dialog" aria-modal="true" aria-label="${isEs ? 'Explorador de Modelos NeuronDB' : 'NeuronDB Model Browser'}">
        <!-- Header -->
        <div class="nmm-modal-header ndb-modal-header">
          <div class="nmm-modal-header-title ndb-header-title">
            <span class="modal-icon">${ICONS.database}</span>
            <h2 class="ndb-title-text">${isEs ? 'EXPLORADOR DE MODELOS NEURONDB' : 'NEURONDB MODEL BROWSER'}</h2>
            <span class="panel-badge ndb-badge" id="ndb-count-badge">${this.entries.length} ${isEs ? 'MODELOS' : 'MODELS'}</span>
          </div>
          <button type="button" class="nmm-modal-close ndb-close-btn" id="btn-close-ndb-modal" title="${isEs ? 'Cerrar (Esc)' : 'Close (Esc)'}">${ICONS.close}</button>
        </div>

        <!-- Integrated Search Row (ABDMS2000 style) -->
        <div class="ndb-search-row">
          <span class="ndb-search-icon">${ICONS.search}</span>
          <input
            type="text"
            id="inp-ndb-search"
            class="ndb-search-input"
            placeholder="${isEs ? 'Buscar modelos por nombre, slot (#338) o conjunto de parámetros...' : 'Search models by name, slot (#338), or parameter set...'}"
            autocomplete="off"
            spellcheck="false"
            aria-label="${isEs ? 'Buscar modelos' : 'Search models'}"
          />
          <div class="ndb-view-toggle">
            <button type="button" class="ndb-view-btn ${this.viewMode === 'grid' ? 'active' : ''}" id="btn-view-grid" title="${isEs ? 'Vista en Cuadrícula' : 'Grid View'}">
              ${ICONS.grid}
            </button>
            <button type="button" class="ndb-view-btn ${this.viewMode === 'table' ? 'active' : ''}" id="btn-view-table" title="${isEs ? 'Vista en Tabla' : 'Table View'}">
              ${ICONS.list}
            </button>
          </div>
        </div>

        <!-- Category Filter Chips (ABDMS2000 style) -->
        <div class="ndb-chips-row" id="ndb-chips-container"></div>

        <!-- Secondary Filter Toolbar (Complexity + Status) -->
        <div class="neurondb-toolbar">
          <div class="neurondb-filter-group">
            <label class="neurondb-filter-label" for="sel-ndb-comp">${isEs ? 'COMPLEJIDAD:' : 'COMPLEXITY:'}</label>
            <select id="sel-ndb-comp" class="neurondb-select-filter" title="${isEs ? 'Filtrar por Complejidad de Análisis (1..10)' : 'Filter by Analysis Complexity (1..10)'}">
              <option value="all">${isEs ? 'Todas (1..10)' : 'All (1..10)'}</option>
              ${STICK_TABLE.map((m, idx) => `<option value="${idx + 1}">${isEs ? 'Niv' : 'Lvl'} ${idx + 1} (${m}m)</option>`).join('')}
            </select>
          </div>
          <span class="neurondb-scan-status" id="ndb-scan-status">${isEs ? 'Escaneando cabeceras de modelos...' : 'Scanning model headers...'}</span>
        </div>

        <!-- Main Content Area: Grid or Table -->
        <div class="ndb-content-wrap" id="ndb-content-wrap" tabindex="0">
          <!-- Grid View Container -->
          <div class="ndb-grid ${this.viewMode === 'grid' ? '' : 'is-hidden'}" id="ndb-grid-view"></div>

          <!-- Table View Container -->
          <div class="neurondb-table-wrap ${this.viewMode === 'table' ? '' : 'is-hidden'}" id="ndb-table-wrap">
            <table class="neurondb-table">
              <thead>
                <tr id="ndb-thead-tr">
                  ${this.buildTheadHtml()}
                </tr>
              </thead>
              <tbody id="ndb-tbody"></tbody>
            </table>
          </div>
        </div>

        <!-- High-Contrast Informative Selection Footer (ABDMS2000 style) -->
        <div class="nmm-modal-footer ndb-footer">
          <div class="ndb-footer-selection" id="ndb-footer-sel">
            <span class="ndb-footer-slot" id="ndb-foot-slot">#000</span>
            <span class="ndb-footer-name" id="ndb-foot-name">—</span>
            <span class="ndb-footer-details" id="ndb-foot-details"></span>
          </div>
          <div class="footer-right neurondb-footer-actions">
            <button type="button" class="btn" id="btn-cancel-ndb-modal">${isEs ? 'Cancelar' : 'Cancel'}</button>
            <button type="button" class="btn btn-primary ndb-select-btn" id="btn-load-ndb-modal">
              <span class="btn-icon">${ICONS.folder}</span>
              <span>${isEs ? 'CARGAR MODELO' : 'LOAD MODEL'}</span>
            </button>
          </div>
        </div>
      </div>
    `;

    this.backdropEl.classList.remove('is-hidden');
    this.renderCategoryChips();
    this.bindHeaderSort();
    this.renderView();

    const searchInp = this.backdropEl.querySelector<HTMLInputElement>('#inp-ndb-search');
    searchInp?.focus();
    searchInp?.addEventListener('input', () => {
      this.searchQuery = searchInp.value.trim().toLowerCase();
      this.renderView();
    });

    const selComp = this.backdropEl.querySelector<HTMLSelectElement>('#sel-ndb-comp');
    selComp?.addEventListener('change', () => {
      this.filterComplexity = selComp.value === 'all' ? 'all' : parseInt(selComp.value, 10);
      this.renderView();
    });

    // View mode toggle
    const btnGrid = this.backdropEl.querySelector<HTMLButtonElement>('#btn-view-grid');
    const btnTable = this.backdropEl.querySelector<HTMLButtonElement>('#btn-view-table');
    btnGrid?.addEventListener('click', () => {
      this.viewMode = 'grid';
      btnGrid.classList.add('active');
      btnTable?.classList.remove('active');
      this.backdropEl?.querySelector('#ndb-grid-view')?.classList.remove('is-hidden');
      this.backdropEl?.querySelector('#ndb-table-wrap')?.classList.add('is-hidden');
      this.renderView();
    });
    btnTable?.addEventListener('click', () => {
      this.viewMode = 'table';
      btnTable.classList.add('active');
      btnGrid?.classList.remove('active');
      this.backdropEl?.querySelector('#ndb-table-wrap')?.classList.remove('is-hidden');
      this.backdropEl?.querySelector('#ndb-grid-view')?.classList.add('is-hidden');
      this.renderView();
    });

    // Keyboard navigation: ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Enter, Escape
    const handleKeyNav = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.selectNext(this.viewMode === 'grid' ? 3 : 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.selectNext(this.viewMode === 'grid' ? -3 : -1);
      } else if (e.key === 'ArrowRight' && this.viewMode === 'grid') {
        e.preventDefault();
        this.selectNext(1);
      } else if (e.key === 'ArrowLeft' && this.viewMode === 'grid') {
        e.preventDefault();
        this.selectNext(-1);
      } else if (e.key === 'Enter') {
        if (this.selectedSlot !== null) {
          e.preventDefault();
          this.triggerPick(this.selectedSlot);
        }
      }
      // Escape lo gestiona el focus trap compartido (onEscape -> closeHandler).
    };

    searchInp?.addEventListener('keydown', handleKeyNav);
    this.backdropEl.querySelector('#ndb-content-wrap')?.addEventListener('keydown', (e) => handleKeyNav(e as KeyboardEvent));

    const closeHandler = () => {
      this.close();
      onCancel?.();
    };

    this.backdropEl.querySelector('#btn-close-ndb-modal')?.addEventListener('click', closeHandler);
    this.backdropEl.querySelector('#btn-cancel-ndb-modal')?.addEventListener('click', closeHandler);
    this.backdropEl.onclick = (e) => {
      if (e.target === this.backdropEl) {
        closeHandler();
      }
    };
    this.backdropEl.querySelector('#btn-load-ndb-modal')?.addEventListener('click', () => {
      if (this.selectedSlot !== null) {
        this.triggerPick(this.selectedSlot);
      }
    });

    // Trampa de foco compartida (recreada en cada apertura: closeHandler captura el onCancel vigente).
    // De paso elimina el goteo del listener manual de Escape, que se acumulaba en cada open().
    this.focusTrap?.deactivate();
    if (this.backdropEl) {
      this.focusTrap = createModalFocusTrap(this.backdropEl, {
        initialFocusSelector: '#inp-ndb-search',
        onEscape: () => closeHandler(),
      });
      this.focusTrap.activate();
    }
  }

  public isAborted(): boolean {
    return this.abortScan;
  }

  /**
   * Allows a background header scan (e.g. drawer refresh) without
   * opening the modal: closing the modal sets the abort flag, and the
   * scan loops stop on it. The drawer refresh resets it first.
   */
  public beginBackgroundScan(): void {
    this.abortScan = false;
  }

  public updateEntry(updated: NeuronDbModelEntry): void {
    if (this.abortScan || !this.backdropEl || this.backdropEl.classList.contains('is-hidden')) {
      return;
    }
    const idx = this.entries.findIndex((e) => e.slot === updated.slot);
    if (idx >= 0) {
      this.entries[idx] = { ...updated };
    }

    if (this.viewMode === 'table') {
      const row = this.backdropEl.querySelector<HTMLTableRowElement>(
        `tr[data-slot="${updated.slot}"]`
      );
      if (row) {
        row.innerHTML = this.buildRowInnerHtml(updated);
        this.bindRowButton(row, updated.slot);
      }
    } else {
      const card = this.backdropEl.querySelector<HTMLElement>(
        `.ndb-card[data-slot="${updated.slot}"]`
      );
      if (card) {
        const temp = document.createElement('div');
        temp.innerHTML = this.buildCardHtml(updated);
        const newCard = temp.firstElementChild as HTMLElement;
        if (newCard) {
          card.replaceWith(newCard);
          this.bindCardEvents(newCard, updated.slot);
        }
      }
    }
    this.updateFooterSelection();
  }

  public setScanProgress(done: number, total: number): void {
    const statusEl = this.backdropEl?.querySelector('#ndb-scan-status');
    if (!statusEl) return;
    const isEs = getAppLocale() === 'es';
    if (done >= total) {
      statusEl.textContent = isEs ? `Las ${total} cabeceras de modelos están listas` : `All ${total} model headers ready`;
    } else {
      statusEl.textContent = isEs ? `Inspeccionando cabeceras: ${done} / ${total}...` : `Inspecting headers: ${done} / ${total}...`;
    }
    this.renderCategoryChips();
  }

  public close(): void {
    this.abortScan = true;
    if (this.focusTrap) {
      this.focusTrap.deactivate();
    }
    if (this.backdropEl) {
      this.backdropEl.classList.add('is-hidden');
    }
  }

  private triggerPick(slot: number): void {
    const cb = this.onPickSlot;
    this.close();
    cb?.(slot);
  }

  // ── Category Chips Row (ABDMS2000 style) ───────────────────────────
  private renderCategoryChips(): void {
    const container = this.backdropEl?.querySelector<HTMLElement>('#ndb-chips-container');
    if (!container) return;

    // Count per parameter set
    const counts: Record<number, number> = {};
    for (const e of this.entries) {
      if (e.parameterSet !== null) {
        counts[e.parameterSet] = (counts[e.parameterSet] || 0) + 1;
      }
    }

    const isEs = getAppLocale() === 'es';
    let html = `
      <button type="button" class="ndb-chip ${this.filterParamSet === 'all' ? 'active' : ''}" data-param="all">
        <span class="ndb-chip-name">${isEs ? 'TODOS' : 'ALL'}</span>
        <span class="ndb-chip-count">${this.entries.length}</span>
      </button>
    `;

    PARAMETER_SETS.forEach((ps: { id: number; name: string }) => {
      const count = counts[ps.id] || 0;
      const isActive = this.filterParamSet === ps.id;
      const iconKey = `param${ps.id}` as keyof typeof ICONS;
      const iconSvg = ICONS[iconKey] || '';
      html += `
        <button type="button" class="ndb-chip cat-${ps.id} ${isActive ? 'active' : ''}" data-param="${ps.id}">
          <span class="ndb-chip-icon">${iconSvg}</span>
          <span class="ndb-chip-name">${ps.id}: ${ps.name}</span>
          <span class="ndb-chip-count">${count}</span>
        </button>
      `;
    });

    container.innerHTML = html;

    container.querySelectorAll('.ndb-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const val = chip.getAttribute('data-param');
        this.filterParamSet = val === 'all' ? 'all' : parseInt(val || '0', 10);
        this.renderCategoryChips();
        this.renderView();
      });
    });
  }

  // ── Sorting ──────────────────────────────────────────────────────────
  private buildTheadHtml(): string {
    const isEs = getAppLocale() === 'es';
    const cols: Array<{ id: NeuronDbSortColumn; label: string; cls: string }> = [
      { id: 'slot', label: 'SLOT', cls: 'col-ndb-slot' },
      { id: 'name', label: isEs ? 'NOMBRE DEL MODELO' : 'MODEL NAME', cls: 'col-ndb-name' },
      { id: 'zones', label: isEs ? 'ZONAS' : 'ZONES', cls: 'col-ndb-zones' },
      { id: 'sources', label: isEs ? 'FUENTES' : 'SOURCES', cls: 'col-ndb-sources' },
      { id: 'param', label: isEs ? 'CONJUNTO PARÁM.' : 'PARAMETER SET', cls: 'col-ndb-param' },
      { id: 'comp', label: isEs ? 'COMPLEJIDAD' : 'COMPLEXITY', cls: 'col-ndb-comp' },
    ];

    return `
      ${cols
        .map((c) => {
          const isSorted = this.sortColumn === c.id;
          const arrow = isSorted ? (this.sortAsc ? '▲' : '▼') : '';
          return `
            <th class="${c.cls} is-sortable ${isSorted ? 'is-sorted' : ''}" data-sort="${c.id}" title="${isEs ? `Ordenar por ${c.label}` : `Sort by ${c.label}`}">
              ${c.label} <span class="sort-indicator">${arrow}</span>
            </th>
          `;
        })
        .join('')}
      <th class="col-ndb-action">${isEs ? 'ACCIÓN' : 'ACTION'}</th>
    `;
  }

  private bindHeaderSort(): void {
    const theadTr = this.backdropEl?.querySelector('#ndb-thead-tr');
    if (!theadTr) return;

    theadTr.querySelectorAll<HTMLTableCellElement>('th.is-sortable').forEach((th) => {
      th.addEventListener('click', () => {
        const col = th.getAttribute('data-sort') as typeof this.sortColumn;
        if (!col) return;
        if (this.sortColumn === col) {
          this.sortAsc = !this.sortAsc;
        } else {
          this.sortColumn = col;
          this.sortAsc = true;
        }
        theadTr.innerHTML = this.buildTheadHtml();
        this.bindHeaderSort();
        this.renderView();
      });
    });
  }

  private getFilteredEntries(): NeuronDbModelEntry[] {
    const filtered = this.entries.filter((e) => {
      if (this.filterParamSet !== 'all') {
        if (e.parameterSet !== this.filterParamSet) return false;
      }
      if (this.filterComplexity !== 'all') {
        if (e.complexity !== this.filterComplexity) return false;
      }
      if (this.searchQuery) {
        const q = this.searchQuery;
        const slotStr = String(e.slot).padStart(3, '0');
        const nameStr = e.name.toLowerCase();
        const paramName =
          e.parameterSet !== null
            ? (PARAMETER_SETS[e.parameterSet]?.name.toLowerCase() ?? '')
            : '';
        const match =
          slotStr.includes(q) ||
          String(e.slot) === q ||
          `#${slotStr}`.includes(q) ||
          nameStr.includes(q) ||
          paramName.includes(q);
        if (!match) return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      let cmp = 0;
      switch (this.sortColumn) {
        case 'slot':
          cmp = a.slot - b.slot;
          break;
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'zones':
          cmp = (a.zoneCount ?? 0) - (b.zoneCount ?? 0);
          break;
        case 'sources':
          cmp = (a.sourceCount ?? 0) - (b.sourceCount ?? 0);
          break;
        case 'param':
          cmp = (a.parameterSet ?? -1) - (b.parameterSet ?? -1);
          break;
        case 'comp':
          cmp = (a.complexity ?? -1) - (b.complexity ?? -1);
          break;
      }
      return this.sortAsc ? cmp : -cmp;
    });

    return filtered;
  }

  private selectNext(delta: number): void {
    const filtered = this.getFilteredEntries();
    if (filtered.length === 0) return;
    const currentIdx = filtered.findIndex((e) => e.slot === this.selectedSlot);
    let nextIdx = currentIdx + delta;
    if (nextIdx < 0) nextIdx = 0;
    if (nextIdx >= filtered.length) nextIdx = filtered.length - 1;
    this.selectedSlot = filtered[nextIdx].slot;

    if (this.viewMode === 'table') {
      const tbody = this.backdropEl?.querySelector<HTMLElement>('#ndb-tbody');
      if (!tbody) return;
      tbody.querySelectorAll('tr.neurondb-row').forEach((r) => {
        const isSel = r.getAttribute('data-slot') === String(this.selectedSlot);
        r.classList.toggle('is-selected', isSel);
        if (isSel) {
          r.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      });
    } else {
      const grid = this.backdropEl?.querySelector<HTMLElement>('#ndb-grid-view');
      if (!grid) return;
      grid.querySelectorAll('.ndb-card').forEach((c) => {
        const isSel = c.getAttribute('data-slot') === String(this.selectedSlot);
        c.classList.toggle('wt-selected', isSel);
        if (isSel) {
          c.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      });
    }
    this.updateFooterSelection();
  }

  private updateFooterSelection(): void {
    if (!this.backdropEl) return;
    const isEs = getAppLocale() === 'es';
    const sel = this.entries.find((e) => e.slot === this.selectedSlot);
    const slotEl = this.backdropEl.querySelector<HTMLElement>('#ndb-foot-slot');
    const nameEl = this.backdropEl.querySelector<HTMLElement>('#ndb-foot-name');
    const detEl = this.backdropEl.querySelector<HTMLElement>('#ndb-foot-details');
    if (!sel) {
      if (slotEl) slotEl.textContent = '---';
      if (nameEl) nameEl.textContent = isEs ? 'Sin selección' : 'No selection';
      if (detEl) detEl.textContent = '';
      return;
    }

    if (slotEl) slotEl.textContent = `#${String(sel.slot).padStart(3, '0')}`;
    if (nameEl) nameEl.textContent = sel.name || (isEs ? 'Sin título' : 'Untitled');
    if (detEl) {
      const psName = sel.parameterSet !== null ? PARAMETER_SETS[sel.parameterSet]?.name || 'Set ' + sel.parameterSet : isEs ? 'Set desconocido' : 'Unknown Set';
      const zStr = sel.zoneCount !== null ? (isEs ? `${sel.zoneCount} Zonas` : `${sel.zoneCount} Zones`) : isEs ? 'Zonas pendientes' : 'Pending zones';
      const cStr = sel.complexity !== null ? `${isEs ? 'Niv' : 'Lvl'} ${sel.complexity}` : '';
      detEl.textContent = `— ${psName} | ${zStr} ${cStr ? '| ' + cStr : ''}`;
    }
  }

  private renderView(): void {
    const isEs = getAppLocale() === 'es';
    const badge = this.backdropEl?.querySelector<HTMLElement>('#ndb-count-badge');
    const filtered = this.getFilteredEntries();

    if (badge) {
      badge.textContent =
        filtered.length === this.entries.length
          ? `${this.entries.length} ${isEs ? 'MODELOS' : 'MODELS'}`
          : `${filtered.length} / ${this.entries.length} ${isEs ? 'MODELOS' : 'MODELS'}`;
    }

    if (filtered.length > 0 && (this.selectedSlot === null || !filtered.some((e) => e.slot === this.selectedSlot))) {
      this.selectedSlot = filtered[0].slot;
    }

    if (this.viewMode === 'grid') {
      this.renderGrid(filtered);
    } else {
      this.renderTable(filtered);
    }
    this.updateFooterSelection();
  }

  // ── Grid Rendering (Cards style like ABDMS2000) ──────────────────
  private renderGrid(filtered: NeuronDbModelEntry[]): void {
    const grid = this.backdropEl?.querySelector<HTMLElement>('#ndb-grid-view');
    if (!grid) return;

    const isEs = getAppLocale() === 'es';
    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="neurondb-empty-state">
          <span class="empty-icon">${ICONS.database}</span>
          <span class="empty-msg">${isEs ? 'Ningún modelo coincide con los filtros' : 'No models match the filter criteria'}</span>
          <button type="button" class="btn btn-xs btn-primary" id="btn-ndb-reset-filter-grid">${isEs ? 'Restablecer Filtros' : 'Reset Filters'}</button>
        </div>
      `;
      grid.querySelector('#btn-ndb-reset-filter-grid')?.addEventListener('click', () => {
        this.resetFilters();
      });
      return;
    }

    grid.innerHTML = filtered.map((e) => this.buildCardHtml(e)).join('');

    grid.querySelectorAll<HTMLElement>('.ndb-card').forEach((card) => {
      const slot = parseInt(card.getAttribute('data-slot') || '0', 10);
      this.bindCardEvents(card, slot);
    });
  }

  private buildCardHtml(e: NeuronDbModelEntry): string {
    const isSel = e.slot === this.selectedSlot;
    const slotStr = `#${String(e.slot).padStart(3, '0')}`;
    const ps = e.parameterSet !== null ? PARAMETER_SETS[e.parameterSet] : null;
    const catClass = ps ? `cat-${ps.id}` : 'cat-neutral';
    const catName = ps ? `${ps.id}: ${ps.name}` : (e.parameterSet !== null ? `Set ${e.parameterSet}` : 'Pending');
    const iconKey = ps ? (`param${ps.id}` as keyof typeof ICONS) : 'database';
    const iconSvg = ICONS[iconKey] || ICONS.database;

    let zonesBadge = '';
    if (e.zoneCount !== null) {
      const spanStr =
        e.lowKey !== null && e.highKey !== null
          ? ` (${midiToNoteName(e.lowKey)}..${midiToNoteName(e.highKey)})`
          : '';
      zonesBadge = `${e.zoneCount}z${spanStr}`;
    }

    const compBadge = e.complexity !== null ? `Lvl ${e.complexity}` : '';

    return `
      <div class="ndb-card ${isSel ? 'wt-selected' : ''}" data-slot="${e.slot}">
        <div class="ndb-card-icon ${catClass}">
          ${iconSvg}
        </div>
        <div class="ndb-card-info">
          <div class="ndb-card-top">
            <span class="ndb-card-slot">${slotStr}</span>
            <span class="ndb-card-cat ${catClass}">${escHtml(catName)}</span>
          </div>
          <div class="ndb-card-name" title="${escAttr(e.name || slotStr)}">${escHtml(e.name || 'Untitled')}</div>
          <div class="ndb-card-meta">
            ${zonesBadge ? `<span class="ndb-card-badge">${zonesBadge}</span>` : ''}
            ${compBadge ? `<span class="ndb-card-badge">${compBadge}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  private bindCardEvents(card: HTMLElement, slot: number): void {
    card.addEventListener('click', () => {
      this.selectedSlot = slot;
      const grid = this.backdropEl?.querySelector<HTMLElement>('#ndb-grid-view');
      grid?.querySelectorAll('.ndb-card').forEach((c) => {
        c.classList.toggle('wt-selected', c === card);
      });
      this.updateFooterSelection();
    });
    card.addEventListener('dblclick', () => {
      this.triggerPick(slot);
    });
  }

  // ── Table Rendering ──────────────────────────────────────────────────
  private renderTable(filtered: NeuronDbModelEntry[]): void {
    const tbody = this.backdropEl?.querySelector<HTMLElement>('#ndb-tbody');
    if (!tbody) return;

    const isEs = getAppLocale() === 'es';
    if (filtered.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="neurondb-empty-cell">
            <div class="neurondb-empty-state">
              <span class="empty-icon">${ICONS.database}</span>
              <span class="empty-msg">${isEs ? 'Ningún modelo coincide con los filtros' : 'No models match the filter criteria'}</span>
              <button type="button" class="btn btn-xs btn-primary" id="btn-ndb-reset-filter-table">${isEs ? 'Restablecer Filtros' : 'Reset Filters'}</button>
            </div>
          </td>
        </tr>
      `;
      tbody.querySelector('#btn-ndb-reset-filter-table')?.addEventListener('click', () => {
        this.resetFilters();
      });
      return;
    }

    tbody.innerHTML = filtered
      .map(
        (e) => `
        <tr class="neurondb-row ${e.slot === this.selectedSlot ? 'is-selected' : ''}" data-slot="${e.slot}">
          ${this.buildRowInnerHtml(e)}
        </tr>
      `
      )
      .join('');

    tbody.querySelectorAll<HTMLTableRowElement>('tr.neurondb-row').forEach((row) => {
      const slot = parseInt(row.getAttribute('data-slot') || '0', 10);
      row.addEventListener('click', () => {
        this.selectedSlot = slot;
        tbody.querySelectorAll('tr.neurondb-row').forEach((r) => {
          r.classList.toggle('is-selected', r === row);
        });
        this.updateFooterSelection();
      });
      row.addEventListener('dblclick', () => {
        this.triggerPick(slot);
      });
      this.bindRowButton(row, slot);
    });
  }

  private resetFilters(): void {
    this.searchQuery = '';
    this.filterParamSet = 'all';
    this.filterComplexity = 'all';
    const sInp = this.backdropEl?.querySelector<HTMLInputElement>('#inp-ndb-search');
    if (sInp) sInp.value = '';
    const sComp = this.backdropEl?.querySelector<HTMLSelectElement>('#sel-ndb-comp');
    if (sComp) sComp.value = 'all';
    this.renderCategoryChips();
    this.renderView();
  }

  private bindRowButton(row: HTMLTableRowElement, slot: number): void {
    const btn = row.querySelector<HTMLButtonElement>('.btn-ndb-load-row');
    btn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.triggerPick(slot);
    });
  }

  private buildRowInnerHtml(e: NeuronDbModelEntry): string {
    const isEs = getAppLocale() === 'es';
    const slotStr = `#${String(e.slot).padStart(3, '0')}`;
    const nameHtml = e.name
      ? `<span class="ndb-model-name">${escHtml(e.name)}</span>`
      : `<span class="ndb-dim">...</span>`;

    let zonesHtml = `<span class="ndb-dim">...</span>`;
    if (e.zoneCount !== null) {
      const spanStr =
        e.lowKey !== null && e.highKey !== null
          ? ` <span class="ndb-key-span">(${midiToNoteName(e.lowKey)}..${midiToNoteName(e.highKey)})</span>`
          : '';
      zonesHtml = isEs
        ? `${e.zoneCount} ${e.zoneCount === 1 ? 'zona' : 'zonas'}${spanStr}`
        : `${e.zoneCount} zone${e.zoneCount === 1 ? '' : 's'}${spanStr}`;
    }

    const sourcesHtml =
      e.sourceCount !== null
        ? isEs
          ? `${e.sourceCount} ${e.sourceCount === 1 ? 'par' : 'pares'}`
          : `${e.sourceCount} pair${e.sourceCount === 1 ? '' : 's'}`
        : `<span class="ndb-dim">...</span>`;

    let paramHtml = `<span class="ndb-dim">...</span>`;
    if (e.parameterSet !== null) {
      const ps = PARAMETER_SETS[e.parameterSet];
      const catClass = ps ? `cat-${ps.id}` : '';
      paramHtml = ps
        ? `<span class="ndb-param-tag ${catClass}">${ps.id}: ${escHtml(ps.name)}</span>`
        : `Set ${e.parameterSet}`;
    }

    let compHtml = `<span class="ndb-dim">...</span>`;
    if (e.complexity !== null && e.stickModes !== null) {
      compHtml = `${isEs ? 'Niv' : 'Lvl'} ${e.complexity} <span class="ndb-key-span">(${e.stickModes}m)</span>`;
    }

    return `
      <td class="col-ndb-slot">${slotStr}</td>
      <td class="col-ndb-name">${nameHtml}</td>
      <td class="col-ndb-zones">${zonesHtml}</td>
      <td class="col-ndb-sources">${sourcesHtml}</td>
      <td class="col-ndb-param">${paramHtml}</td>
      <td class="col-ndb-comp">${compHtml}</td>
      <td class="col-ndb-action">
        <button type="button" class="btn btn-xs btn-ndb-load-row" title="${isEs ? `Cargar ${slotStr}` : `Load ${slotStr}`} ${escAttr(e.name || '')}">${isEs ? 'Cargar' : 'Load'}</button>
      </td>
    `;
  }
}
