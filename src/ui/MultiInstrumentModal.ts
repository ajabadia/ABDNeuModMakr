// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Multi-Instrument Selection & Batch Modal
//
// When a multi-instrument container (e.g. SF2 with multiple
// presets, or a folder with multiple SFZ definitions) is loaded,
// this modal presents the list of instruments, allowing the user
// to pick an individual instrument to load or immediately send
// the entire collection to the Batch Processor.
// ─────────────────────────────────────────────────────────

import { ICONS } from './icons.ts';
import { escHtml, escAttr } from './escape.ts';

export interface MultiInstrumentItem {
  id: string;
  index: number;
  name: string;
  bank?: number;
  presetNumber?: number;
  regionCount?: number;
  detail?: string;
}

export interface MultiInstrumentModalOptions {
  title?: string;
  fileName: string;
  format: 'sf2' | 'sfz';
  items: MultiInstrumentItem[];
  onSelect: (item: MultiInstrumentItem) => void;
  onProcessBatch: () => void;
  onCancel?: () => void;
}

export class MultiInstrumentModal {
  private backdropEl: HTMLElement | null = null;
  private options: MultiInstrumentModalOptions | null = null;
  private filterQuery = '';
  private selectedIndex = 0;

  public open(options: MultiInstrumentModalOptions): void {
    this.close();
    this.options = options;
    this.filterQuery = '';
    this.selectedIndex = 0;

    const backdrop = document.createElement('div');
    backdrop.className = 'nmm-modal-backdrop nmm-multi-inst-backdrop';
    this.backdropEl = backdrop;
    document.body.appendChild(backdrop);

    this.render();
  }

  public close(): void {
    if (this.backdropEl) {
      this.backdropEl.remove();
      this.backdropEl = null;
    }
    this.options = null;
  }

  private render(): void {
    if (!this.backdropEl || !this.options) return;

    const { fileName, format, items } = this.options;
    const q = this.filterQuery.trim().toLowerCase();
    const filtered = q
      ? items.filter((it) => it.name.toLowerCase().includes(q) || (it.detail && it.detail.toLowerCase().includes(q)))
      : items;

    const formatBadge = format.toUpperCase();

    this.backdropEl.innerHTML = `
      <div class="nmm-modal-window nmm-multi-inst-window" role="dialog" aria-modal="true" aria-labelledby="multi-inst-title">
        <div class="nmm-modal-header">
          <div class="nmm-modal-title" id="multi-inst-title">
            <span class="nmm-modal-icon">${ICONS.layers}</span>
            <span>MULTI-INSTRUMENT ${escHtml(formatBadge)} DETECTED</span>
          </div>
          <button type="button" class="btn btn-close-drawer btn-modal-close" id="btn-multi-inst-close" title="Cancel">
            ${ICONS.close}
          </button>
        </div>

        <div class="nmm-modal-body nmm-multi-inst-body">
          <div class="nmm-multi-inst-banner">
            <div class="nmm-multi-inst-file">
              <span class="file-name">${escHtml(fileName)}</span>
              <span class="badge badge-accent">${items.length} INSTRUMENTS</span>
            </div>
            <p class="nmm-multi-inst-desc">
              This SoundFont contains <strong>${items.length} playable instruments / presets</strong>.
              Select one to load directly into your editing session, or process all presets unattended into separate models via the Batch Processor.
            </p>
          </div>

          <div class="nmm-multi-inst-search-row">
            <span class="search-icon">${ICONS.search || ''}</span>
            <input
              type="text"
              id="inp-multi-inst-filter"
              class="form-control nmm-multi-inst-search"
              placeholder="Search / filter instruments by name (e.g. Piano, Bass, Strings)..."
              value="${escAttr(this.filterQuery)}"
              autofocus
            />
            ${this.filterQuery ? `<button type="button" class="btn btn-xs btn-outline" id="btn-clear-search">Clear</button>` : ''}
          </div>

          <div class="nmm-multi-inst-list-wrap" tabindex="0">
            <table class="nmm-multi-inst-table">
              <thead>
                <tr>
                  <th class="col-idx">#</th>
                  <th class="col-bank">Bank : Prog</th>
                  <th class="col-name">Instrument / Preset Name</th>
                  <th class="col-regions">Structure</th>
                  <th class="col-act">Action</th>
                </tr>
              </thead>
              <tbody>
                ${
                  filtered.length === 0
                    ? `<tr><td colspan="5" class="empty-cell">No instruments match "${escHtml(this.filterQuery)}"</td></tr>`
                    : filtered
                        .map((it) => {
                          const isSel = it.index === this.selectedIndex;
                          const bankStr =
                            it.bank !== undefined && it.presetNumber !== undefined
                              ? `${String(it.bank).padStart(3, '0')} : ${String(it.presetNumber).padStart(3, '0')}`
                              : `—`;
                          const regStr =
                            it.regionCount !== undefined
                              ? `${it.regionCount} region${it.regionCount === 1 ? '' : 's'}`
                              : it.detail || 'Standard';

                          return `
                            <tr class="multi-inst-row ${isSel ? 'is-selected' : ''}" data-index="${it.index}">
                              <td class="col-idx">${it.index + 1}</td>
                              <td class="col-bank"><span class="bank-tag">${escHtml(bankStr)}</span></td>
                              <td class="col-name"><strong>${escHtml(it.name)}</strong></td>
                              <td class="col-regions"><span class="reg-tag">${escHtml(regStr)}</span></td>
                              <td class="col-act">
                                <button type="button" class="btn btn-xs btn-accent btn-load-this-inst" data-index="${it.index}" title="Load this instrument">
                                  ${ICONS.play} Load
                                </button>
                              </td>
                            </tr>
                          `;
                        })
                        .join('')
                }
              </tbody>
            </table>
          </div>
        </div>

        <div class="nmm-modal-footer nmm-multi-inst-footer">
          <button type="button" class="btn btn-outline" id="btn-multi-inst-cancel">
            Cancel
          </button>
          <div class="footer-actions-right">
            <button
              type="button"
              class="btn btn-outline btn-batch-call"
              id="btn-multi-inst-batch"
              title="Batch process all ${items.length} instruments unattended into Hartmann Neuron models"
            >
              ${ICONS.cpu} ⚡ Process All in Batch Processor (${items.length} Models)
            </button>
            <button
              type="button"
              class="btn btn-accent"
              id="btn-multi-inst-load-selected"
              title="Load the selected instrument into the current workspace"
            >
              ${ICONS.check} Load Selected Instrument
            </button>
          </div>
        </div>
      </div>
    `;

    this.bindEvents(filtered);
  }

  private bindEvents(filtered: MultiInstrumentItem[]): void {
    if (!this.backdropEl || !this.options) return;

    // Close / Cancel
    this.backdropEl.querySelector('#btn-multi-inst-close')?.addEventListener('click', () => {
      this.options?.onCancel?.();
      this.close();
    });
    this.backdropEl.querySelector('#btn-multi-inst-cancel')?.addEventListener('click', () => {
      this.options?.onCancel?.();
      this.close();
    });

    // Filter input
    const inpFilter = this.backdropEl.querySelector('#inp-multi-inst-filter') as HTMLInputElement | null;
    inpFilter?.addEventListener('input', () => {
      this.filterQuery = inpFilter.value;
      this.render();
      // Keep focus in input
      const nextInput = this.backdropEl?.querySelector('#inp-multi-inst-filter') as HTMLInputElement | null;
      if (nextInput) {
        nextInput.focus();
        nextInput.selectionStart = nextInput.selectionEnd = nextInput.value.length;
      }
    });

    this.backdropEl.querySelector('#btn-clear-search')?.addEventListener('click', () => {
      this.filterQuery = '';
      this.render();
    });

    // Row selection & double click
    this.backdropEl.querySelectorAll('.multi-inst-row').forEach((row) => {
      row.addEventListener('click', () => {
        const idx = parseInt((row as HTMLElement).dataset.index ?? '0', 10);
        this.selectedIndex = idx;
        this.backdropEl?.querySelectorAll('.multi-inst-row').forEach((r) => r.classList.remove('is-selected'));
        row.classList.add('is-selected');
      });

      row.addEventListener('dblclick', () => {
        const idx = parseInt((row as HTMLElement).dataset.index ?? '0', 10);
        const item = this.options?.items.find((it) => it.index === idx) || this.options?.items[0];
        if (item) {
          this.options?.onSelect(item);
          this.close();
        }
      });
    });

    // Individual Load button in row
    this.backdropEl.querySelectorAll('.btn-load-this-inst').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt((btn as HTMLElement).dataset.index ?? '0', 10);
        const item = this.options?.items.find((it) => it.index === idx) || this.options?.items[0];
        if (item) {
          this.options?.onSelect(item);
          this.close();
        }
      });
    });

    // Bottom "Load Selected" button
    this.backdropEl.querySelector('#btn-multi-inst-load-selected')?.addEventListener('click', () => {
      const item = this.options?.items.find((it) => it.index === this.selectedIndex) || filtered[0] || this.options?.items[0];
      if (item) {
        this.options?.onSelect(item);
        this.close();
      }
    });

    // Batch Process button
    this.backdropEl.querySelector('#btn-multi-inst-batch')?.addEventListener('click', () => {
      this.options?.onProcessBatch();
      this.close();
    });

    // Escape key
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        window.removeEventListener('keydown', handleKeydown);
        this.options?.onCancel?.();
        this.close();
      }
    };
    window.addEventListener('keydown', handleKeydown);
  }
}
