// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — NeuronDB Browser Modal
// Canonical modal for browsing, filtering, and previewing
// Hartmann Factory & User models with full keyboard navigation
// ─────────────────────────────────────────────────────────

import { ICONS } from './icons';
import { midiToNoteName } from './ZoneRibbon';
import { PARAMETER_SETS } from '../core/WebAudioPipeline';

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

    if (!this.backdropEl) {
      this.backdropEl = document.createElement('div');
      this.backdropEl.className = 'modal-backdrop is-hidden';
      document.body.appendChild(this.backdropEl);
    }

    this.backdropEl.innerHTML = `
      <div class="neurondb-modal-card" role="dialog" aria-modal="true" aria-label="NeuronDB Model Browser">
        <div class="modal-header">
          <div class="modal-title">
            <span class="modal-icon">${ICONS.database}</span>
            <span>NEURONDB MODEL BROWSER</span>
            <span class="panel-badge" id="ndb-count-badge">${this.entries.length} MODELS</span>
          </div>
          <button type="button" class="btn btn-close-modal" id="btn-close-ndb-modal" title="Close (Esc)">${ICONS.close}</button>
        </div>

        <div class="neurondb-toolbar">
          <input
            type="text"
            id="inp-ndb-search"
            class="neurondb-search-input"
            placeholder="Search by slot (#338), model name, parameter set..."
            autocomplete="off"
            aria-label="Search models"
          />
          <div class="neurondb-filter-group">
            <label class="neurondb-filter-label" for="sel-ndb-param">PARAM SET:</label>
            <select id="sel-ndb-param" class="neurondb-select-filter" title="Filter by Parameter Set (0..9)">
              <option value="all">All Sets (0..9)</option>
              ${PARAMETER_SETS.map((ps: { id: number; name: string }) => `<option value="${ps.id}">${ps.id}: ${ps.name}</option>`).join('')}
            </select>
          </div>
          <div class="neurondb-filter-group">
            <label class="neurondb-filter-label" for="sel-ndb-comp">COMPLEXITY:</label>
            <select id="sel-ndb-comp" class="neurondb-select-filter" title="Filter by Analysis Complexity (1..10)">
              <option value="all">All (1..10)</option>
              ${STICK_TABLE.map((m, idx) => `<option value="${idx + 1}">Lvl ${idx + 1} (${m}m)</option>`).join('')}
            </select>
          </div>
          <span class="neurondb-scan-status" id="ndb-scan-status">Scanning model headers...</span>
        </div>

        <div class="neurondb-table-wrap" id="ndb-table-wrap" tabindex="0">
          <table class="neurondb-table">
            <thead>
              <tr id="ndb-thead-tr">
                ${this.buildTheadHtml()}
              </tr>
            </thead>
            <tbody id="ndb-tbody"></tbody>
          </table>
        </div>

        <div class="modal-footer neurondb-footer">
          <span class="neurondb-hint">Click row, double-click or use <strong>↑ / ↓</strong> and <strong>Enter</strong> to load into workspace.</span>
          <div class="neurondb-footer-actions">
            <button type="button" class="btn" id="btn-cancel-ndb-modal">Cancel</button>
            <button type="button" class="btn btn-primary" id="btn-load-ndb-modal">
              <span class="btn-icon">${ICONS.folder}</span>
              <span>Load Selected Model</span>
            </button>
          </div>
        </div>
      </div>
    `;

    this.backdropEl.classList.remove('is-hidden');
    this.backdropEl.style.display = 'flex';
    this.bindHeaderSort();
    this.renderRows();

    const searchInp = this.backdropEl.querySelector<HTMLInputElement>('#inp-ndb-search');
    searchInp?.focus();
    searchInp?.addEventListener('input', () => {
      this.searchQuery = searchInp.value.trim().toLowerCase();
      this.renderRows();
    });

    const selParam = this.backdropEl.querySelector<HTMLSelectElement>('#sel-ndb-param');
    selParam?.addEventListener('change', () => {
      this.filterParamSet = selParam.value === 'all' ? 'all' : parseInt(selParam.value, 10);
      this.renderRows();
    });

    const selComp = this.backdropEl.querySelector<HTMLSelectElement>('#sel-ndb-comp');
    selComp?.addEventListener('change', () => {
      this.filterComplexity = selComp.value === 'all' ? 'all' : parseInt(selComp.value, 10);
      this.renderRows();
    });

    // Keyboard navigation: ArrowUp, ArrowDown, Enter, Escape
    const handleKeyNav = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.selectNextRow(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.selectNextRow(-1);
      } else if (e.key === 'Enter') {
        if (this.selectedSlot !== null) {
          e.preventDefault();
          this.triggerPick(this.selectedSlot);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeHandler();
      }
    };

    searchInp?.addEventListener('keydown', handleKeyNav);
    this.backdropEl.querySelector('#ndb-table-wrap')?.addEventListener('keydown', (e) => handleKeyNav(e as KeyboardEvent));

    const closeHandler = () => {
      this.close();
      onCancel?.();
    };

    this.backdropEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeHandler();
      }
    });

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
  }

  public isAborted(): boolean {
    return this.abortScan;
  }

  public updateEntry(updated: NeuronDbModelEntry): void {
    if (this.abortScan || !this.backdropEl || this.backdropEl.classList.contains('is-hidden')) {
      return;
    }
    const idx = this.entries.findIndex((e) => e.slot === updated.slot);
    if (idx >= 0) {
      this.entries[idx] = { ...updated };
    }
    const row = this.backdropEl.querySelector<HTMLTableRowElement>(
      `tr[data-slot="${updated.slot}"]`
    );
    if (row) {
      row.innerHTML = this.buildRowInnerHtml(updated);
      this.bindRowButton(row, updated.slot);
    }
  }

  public setScanProgress(done: number, total: number): void {
    const statusEl = this.backdropEl?.querySelector('#ndb-scan-status');
    if (!statusEl) return;
    if (done >= total) {
      statusEl.textContent = `All ${total} model headers ready`;
    } else {
      statusEl.textContent = `Inspecting headers: ${done} / ${total}...`;
    }
  }

  public close(): void {
    this.abortScan = true;
    if (this.backdropEl) {
      this.backdropEl.classList.add('is-hidden');
      this.backdropEl.style.display = 'none';
    }
  }

  private triggerPick(slot: number): void {
    const cb = this.onPickSlot;
    this.close();
    cb?.(slot);
  }

  private buildTheadHtml(): string {
    const cols: Array<{ id: NeuronDbSortColumn; label: string; cls: string }> = [
      { id: 'slot', label: 'SLOT', cls: 'col-ndb-slot' },
      { id: 'name', label: 'MODEL NAME', cls: 'col-ndb-name' },
      { id: 'zones', label: 'ZONES', cls: 'col-ndb-zones' },
      { id: 'sources', label: 'SOURCES', cls: 'col-ndb-sources' },
      { id: 'param', label: 'PARAMETER SET', cls: 'col-ndb-param' },
      { id: 'comp', label: 'COMPLEXITY', cls: 'col-ndb-comp' },
    ];

    return `
      ${cols
        .map((c) => {
          const isSorted = this.sortColumn === c.id;
          const arrow = isSorted ? (this.sortAsc ? '▲' : '▼') : '';
          return `
            <th class="${c.cls} is-sortable ${isSorted ? 'is-sorted' : ''}" data-sort="${c.id}" title="Sort by ${c.label}">
              ${c.label} <span class="sort-indicator">${arrow}</span>
            </th>
          `;
        })
        .join('')}
      <th class="col-ndb-action">ACTION</th>
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
        this.renderRows();
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

  private selectNextRow(delta: number): void {
    const filtered = this.getFilteredEntries();
    if (filtered.length === 0) return;
    const currentIdx = filtered.findIndex((e) => e.slot === this.selectedSlot);
    let nextIdx = currentIdx + delta;
    if (nextIdx < 0) nextIdx = 0;
    if (nextIdx >= filtered.length) nextIdx = filtered.length - 1;
    this.selectedSlot = filtered[nextIdx].slot;

    const tbody = this.backdropEl?.querySelector<HTMLElement>('#ndb-tbody');
    if (!tbody) return;
    tbody.querySelectorAll('tr.neurondb-row').forEach((r) => {
      const isSel = r.getAttribute('data-slot') === String(this.selectedSlot);
      r.classList.toggle('is-selected', isSel);
      if (isSel) {
        r.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
  }

  private resetFilters(): void {
    this.searchQuery = '';
    this.filterParamSet = 'all';
    this.filterComplexity = 'all';
    const sInp = this.backdropEl?.querySelector<HTMLInputElement>('#inp-ndb-search');
    if (sInp) sInp.value = '';
    const sParam = this.backdropEl?.querySelector<HTMLSelectElement>('#sel-ndb-param');
    if (sParam) sParam.value = 'all';
    const sComp = this.backdropEl?.querySelector<HTMLSelectElement>('#sel-ndb-comp');
    if (sComp) sComp.value = 'all';
    this.renderRows();
  }

  private renderRows(): void {
    const tbody = this.backdropEl?.querySelector<HTMLElement>('#ndb-tbody');
    const badge = this.backdropEl?.querySelector<HTMLElement>('#ndb-count-badge');
    if (!tbody) return;

    const filtered = this.getFilteredEntries();
    if (badge) {
      badge.textContent =
        filtered.length === this.entries.length
          ? `${this.entries.length} MODELS`
          : `${filtered.length} / ${this.entries.length} MODELS`;
    }

    if (filtered.length > 0 && (this.selectedSlot === null || !filtered.some((e) => e.slot === this.selectedSlot))) {
      this.selectedSlot = filtered[0].slot;
    }

    if (filtered.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="neurondb-empty-cell">
            <div class="neurondb-empty-state">
              <span class="empty-icon">${ICONS.database}</span>
              <span class="empty-msg">No models match the filter criteria</span>
              <button type="button" class="btn btn-xs btn-primary" id="btn-ndb-reset-filter">Reset Filters</button>
            </div>
          </td>
        </tr>
      `;
      tbody.querySelector('#btn-ndb-reset-filter')?.addEventListener('click', () => {
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
      });
      row.addEventListener('dblclick', () => {
        this.triggerPick(slot);
      });
      this.bindRowButton(row, slot);
    });
  }

  private bindRowButton(row: HTMLTableRowElement, slot: number): void {
    const btn = row.querySelector<HTMLButtonElement>('.btn-ndb-load-row');
    btn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.triggerPick(slot);
    });
  }

  private buildRowInnerHtml(e: NeuronDbModelEntry): string {
    const slotStr = `#${String(e.slot).padStart(3, '0')}`;
    const nameHtml = e.name
      ? `<span class="ndb-model-name">${e.name}</span>`
      : `<span class="ndb-dim">...</span>`;

    let zonesHtml = `<span class="ndb-dim">...</span>`;
    if (e.zoneCount !== null) {
      const spanStr =
        e.lowKey !== null && e.highKey !== null
          ? ` <span class="ndb-key-span">(${midiToNoteName(e.lowKey)}..${midiToNoteName(e.highKey)})</span>`
          : '';
      zonesHtml = `${e.zoneCount} zone${e.zoneCount === 1 ? '' : 's'}${spanStr}`;
    }

    const sourcesHtml =
      e.sourceCount !== null
        ? `${e.sourceCount} pair${e.sourceCount === 1 ? '' : 's'}`
        : `<span class="ndb-dim">...</span>`;

    let paramHtml = `<span class="ndb-dim">...</span>`;
    if (e.parameterSet !== null) {
      const ps = PARAMETER_SETS[e.parameterSet];
      paramHtml = ps
        ? `<span class="ndb-param-tag">${ps.id}: ${ps.name}</span>`
        : `Set ${e.parameterSet}`;
    }

    let compHtml = `<span class="ndb-dim">...</span>`;
    if (e.complexity !== null && e.stickModes !== null) {
      compHtml = `Lvl ${e.complexity} <span class="ndb-key-span">(${e.stickModes}m)</span>`;
    }

    return `
      <td class="col-ndb-slot">${slotStr}</td>
      <td class="col-ndb-name">${nameHtml}</td>
      <td class="col-ndb-zones">${zonesHtml}</td>
      <td class="col-ndb-sources">${sourcesHtml}</td>
      <td class="col-ndb-param">${paramHtml}</td>
      <td class="col-ndb-comp">${compHtml}</td>
      <td class="col-ndb-action">
        <button type="button" class="btn btn-xs btn-ndb-load-row" title="Load ${slotStr} ${e.name}">Load</button>
      </td>
    `;
  }
}
