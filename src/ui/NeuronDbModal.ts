// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — NeuronDB Directory Browser Modal
// Displays all <NNN>.model subdirectories found in a NeuronDB / Models folder
// with progressive fast header inspection (MName, map.script, 64-byte .sphere header).
// ─────────────────────────────────────────────────────────

import { ICONS } from './icons';
import { PARAMETER_SETS } from '../core/WebAudioPipeline';
import { midiToNoteName } from './ZoneRibbon';

export interface NeuronDbModelEntry {
  slot: number;
  folderName: string;
  name: string;
  zoneCount: number | null;
  sourceCount: number | null;
  lowKey: number | null;
  highKey: number | null;
  parameterSet: number | null;
  stickModes: number | null;
  complexity: number | null;
  loadedMeta: boolean;
}

const STICK_TABLE = [1, 4, 8, 12, 16, 24, 32, 42, 54, 64];

export function stickModesToComplexity(stickModes: number): number {
  const idx = STICK_TABLE.findIndex((s) => s >= stickModes);
  return idx >= 0 ? idx + 1 : 8;
}

export class NeuronDbModal {
  private backdropEl: HTMLElement | null = null;
  private entries: NeuronDbModelEntry[] = [];
  private searchQuery = '';
  private filterParamSet: number | 'all' = 'all';
  private filterComplexity: number | 'all' = 'all';
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
    this.selectedSlot = this.entries[0]?.slot ?? null;
    this.onPickSlot = onPick;

    if (!this.backdropEl) {
      this.backdropEl = document.createElement('div');
      this.backdropEl.className = 'modal-backdrop is-hidden';
      document.body.appendChild(this.backdropEl);
    }

    this.backdropEl.innerHTML = `
      <div class="neurondb-modal-card">
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
            placeholder="Search by slot (#338), model name..."
            autocomplete="off"
          />
          <div class="neurondb-filter-group">
            <label class="neurondb-filter-label" for="sel-ndb-param">PARAM SET:</label>
            <select id="sel-ndb-param" class="neurondb-select-filter" title="Filter by Parameter Set (0..9)">
              <option value="all">All Sets (0..9)</option>
              ${PARAMETER_SETS.map((ps) => `<option value="${ps.id}">${ps.id}: ${ps.name}</option>`).join('')}
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

        <div class="neurondb-table-wrap">
          <table class="neurondb-table">
            <thead>
              <tr>
                <th class="col-ndb-slot">SLOT</th>
                <th class="col-ndb-name">MODEL NAME</th>
                <th class="col-ndb-zones">ZONES</th>
                <th class="col-ndb-sources">SOURCES</th>
                <th class="col-ndb-param">PARAMETER SET</th>
                <th class="col-ndb-comp">COMPLEXITY</th>
                <th class="col-ndb-action">ACTION</th>
              </tr>
            </thead>
            <tbody id="ndb-tbody"></tbody>
          </table>
        </div>

        <div class="modal-footer neurondb-footer">
          <span class="neurondb-hint">Click any row to select, double-click or press <strong>Load Selected Model</strong> to import into workspace.</span>
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

    searchInp?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && this.selectedSlot !== null) {
        e.preventDefault();
        this.triggerPick(this.selectedSlot);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
        onCancel?.();
      }
    });

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

  private getFilteredEntries(): NeuronDbModelEntry[] {
    return this.entries.filter((e) => {
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
          <td colspan="7" class="neurondb-empty-cell">No models match "${this.searchQuery}"</td>
        </tr>
      `;
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
