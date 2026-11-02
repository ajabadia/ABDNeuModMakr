// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Multi-Asset Triage Modal (Fase 29)
//
// Interactive preflight triage dialog for heterogeneous sample collections,
// multi-format archives, or composite folders containing multiple instruments.
// Features individual/group checkboxes, filtering, and direct handoff to
// the Batch Processor or active session.
// ─────────────────────────────────────────────────────────

import { ICONS } from './icons.ts';
import { escHtml, escAttr } from './escape.ts';
import { createModalFocusTrap, type FocusTrap } from './modalFocusTrap.ts';
import type { DiscoveredSamplerItem, MultiAssetDiscoveryReport } from '../formats/MultiAssetDiscovery.ts';

export interface MultiAssetTriageModalOptions {
  title?: string;
  sourceName: string;
  discoveryReport: MultiAssetDiscoveryReport;
  onImportSingle: (item: DiscoveredSamplerItem) => void;
  onProcessBatch: (selectedItems: DiscoveredSamplerItem[]) => void;
  onCancel?: () => void;
}

export class MultiAssetTriageModal {
  private backdropEl: HTMLElement | null = null;
  private focusTrap: FocusTrap | null = null;
  private options: MultiAssetTriageModalOptions | null = null;
  private filterQuery = '';
  private filterFormat = 'all';
  private selectedIds = new Set<string>();

  public open(options: MultiAssetTriageModalOptions): void {
    this.close();
    this.options = options;
    this.filterQuery = '';
    this.filterFormat = 'all';
    this.selectedIds = new Set(options.discoveryReport.items.map((it) => it.id));

    const backdrop = document.createElement('div');
    backdrop.className = 'nmm-modal-backdrop nmm-triage-backdrop';
    this.backdropEl = backdrop;
    document.body.appendChild(backdrop);

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
    this.options = null;
  }

  public isOpen(): boolean {
    return Boolean(this.backdropEl);
  }

  private render(): void {
    if (!this.backdropEl || !this.options) return;

    const { sourceName, discoveryReport } = this.options;
    const { items, totalSamples, totalSizeBytes, formatBreakdown } = discoveryReport;

    const q = this.filterQuery.trim().toLowerCase();
    const filtered = items.filter((it) => {
      if (this.filterFormat !== 'all' && it.format !== this.filterFormat) {
        return false;
      }
      if (!q) return true;
      return (
        it.name.toLowerCase().includes(q) ||
        it.formatLabel.toLowerCase().includes(q) ||
        it.primaryFilePath.toLowerCase().includes(q) ||
        it.detail.toLowerCase().includes(q)
      );
    });

    const formatKeys = Object.keys(formatBreakdown).sort();
    const sizeMb = (totalSizeBytes / (1024 * 1024)).toFixed(1);

    this.backdropEl.innerHTML = `
      <div class="nmm-modal-window nmm-triage-window" role="dialog" aria-modal="true" aria-labelledby="triage-title" style="max-width: 950px; width: 92vw; max-height: 90vh; display: flex; flex-direction: column;">
        <div class="nmm-modal-header" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 18px; border-bottom: 1px solid var(--border-color, #333);">
          <div class="nmm-modal-title" id="triage-title" style="display: flex; align-items: center; gap: 8px; font-weight: 700;">
            <span class="nmm-modal-icon">${ICONS.layers}</span>
            <span>MULTI-ASSET IMPORT TRIAGE & BATCH GATEWAY (FASE 29)</span>
          </div>
          <button type="button" class="btn btn-close-drawer btn-modal-close" id="btn-triage-close" title="Cancel">
            ${ICONS.close}
          </button>
        </div>

        <div class="nmm-modal-body nmm-triage-body" style="padding: 16px; overflow-y: auto; flex: 1;">
          <div class="nmm-triage-banner" style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-color, #333); border-radius: 6px; padding: 12px 16px; margin-bottom: 14px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <span style="font-weight: 600; font-size: 1.05rem;">${escHtml(sourceName)}</span>
              <div style="display: flex; gap: 8px;">
                <span class="badge badge-accent">${items.length} INSTRUMENTS</span>
                <span class="badge badge-outline">${totalSamples} SAMPLES</span>
                <span class="badge badge-outline">${sizeMb} MB</span>
              </div>
            </div>
            <p style="margin: 0; font-size: 0.85rem; color: var(--text-dim, #aaa); line-height: 1.4;">
              Discovered <strong>${items.length} distinct sampler entities / presets</strong> inside this container.
              Select items using checkboxes to process them via the Batch Processor, or click <strong>Load Single</strong> on any row to import it immediately into your active session.
            </p>
          </div>

          <div class="nmm-triage-controls" style="display: flex; gap: 10px; align-items: center; margin-bottom: 12px; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 240px; display: flex; align-items: center; background: rgba(0,0,0,0.2); border: 1px solid var(--border-color, #444); border-radius: 4px; padding: 0 8px;">
              <span style="margin-right: 6px; opacity: 0.6;">${ICONS.search || ''}</span>
              <input
                type="text"
                id="inp-triage-search"
                class="form-control"
                style="border: none; background: transparent; width: 100%; outline: none; padding: 6px 0;"
                placeholder="Filter by instrument name, path, or format..."
                value="${escAttr(this.filterQuery)}"
              />
              ${this.filterQuery ? `<button type="button" class="btn btn-xs btn-outline" id="btn-triage-clear-search">Clear</button>` : ''}
            </div>

            <select id="sel-triage-format" class="form-control" style="width: auto; padding: 5px 10px;">
              <option value="all" ${this.filterFormat === 'all' ? 'selected' : ''}>All Formats (${items.length})</option>
              ${formatKeys
                .map((label) => {
                  const sampleItem = items.find((it) => it.formatLabel === label);
                  const fmtVal = sampleItem ? sampleItem.format : 'all';
                  return `<option value="${fmtVal}" ${this.filterFormat === fmtVal ? 'selected' : ''}>${escHtml(label)} (${formatBreakdown[label]})</option>`;
                })
                .join('')}
            </select>

            <div style="display: flex; gap: 6px;">
              <button type="button" class="btn btn-xs btn-outline" id="btn-triage-select-all">Select All</button>
              <button type="button" class="btn btn-xs btn-outline" id="btn-triage-deselect-all">Deselect All</button>
            </div>
          </div>

          <div class="nmm-triage-table-wrap" style="border: 1px solid var(--border-color, #333); border-radius: 4px; overflow: hidden; background: rgba(0,0,0,0.15);">
            <table class="nmm-triage-table" style="width: 100%; border-collapse: collapse; font-size: 0.85rem; text-align: left;">
              <thead>
                <tr style="background: rgba(255,255,255,0.04); border-bottom: 1px solid var(--border-color, #333);">
                  <th style="width: 40px; padding: 8px; text-align: center;">
                    <input type="checkbox" id="chk-triage-header" ${filtered.length > 0 && filtered.every((it) => this.selectedIds.has(it.id)) ? 'checked' : ''} />
                  </th>
                  <th style="width: 40px; padding: 8px;">#</th>
                  <th style="padding: 8px;">Format</th>
                  <th style="padding: 8px;">Instrument / Preset Name</th>
                  <th style="padding: 8px;">Samples</th>
                  <th style="padding: 8px;">Details / Path</th>
                  <th style="padding: 8px; text-align: right;">Action</th>
                </tr>
              </thead>
              <tbody>
                ${
                  filtered.length === 0
                    ? `<tr><td colspan="7" style="padding: 24px; text-align: center; color: var(--text-dim, #888);">No instruments match "${escHtml(this.filterQuery)}"</td></tr>`
                    : filtered
                        .map((it, idx) => {
                          const isChecked = this.selectedIds.has(it.id);
                          const sizeStr = (it.totalSizeBytes / 1024).toFixed(0);
                          return `
                            <tr class="triage-row ${isChecked ? 'is-selected' : ''}" style="border-bottom: 1px solid rgba(255,255,255,0.05); transition: background 0.15s ease;" data-id="${escAttr(it.id)}">
                              <td style="padding: 8px; text-align: center;">
                                <input type="checkbox" class="chk-triage-item" data-id="${escAttr(it.id)}" ${isChecked ? 'checked' : ''} />
                              </td>
                              <td style="padding: 8px; opacity: 0.6;">${idx + 1}</td>
                              <td style="padding: 8px;"><span class="badge badge-accent" style="font-size: 0.72rem;">${escHtml(it.formatLabel)}</span></td>
                              <td style="padding: 8px; font-weight: 600;">${escHtml(it.name)}</td>
                              <td style="padding: 8px;">${it.sampleCount} <span style="opacity: 0.5;">(${sizeStr} KB)</span></td>
                              <td style="padding: 8px; font-size: 0.8rem; opacity: 0.8; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escAttr(it.primaryFilePath)}">
                                ${escHtml(it.detail || it.primaryFilePath)}
                              </td>
                              <td style="padding: 8px; text-align: right;">
                                <button type="button" class="btn btn-xs btn-outline btn-triage-load-single" data-id="${escAttr(it.id)}" title="Import this single instrument into current session">
                                  ${ICONS.play || ''} Load Single
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

        <div class="nmm-modal-footer nmm-triage-footer" style="padding: 12px 18px; border-top: 1px solid var(--border-color, #333); display: flex; justify-content: space-between; align-items: center;">
          <button type="button" class="btn btn-outline" id="btn-triage-cancel">
            Cancel
          </button>
          <div style="display: flex; gap: 10px; align-items: center;">
            <span style="font-size: 0.85rem; opacity: 0.8;">
              <strong>${this.selectedIds.size}</strong> of ${items.length} selected for batch
            </span>
            <button
              type="button"
              class="btn btn-accent"
              id="btn-triage-proceed-batch"
              ${this.selectedIds.size === 0 ? 'disabled' : ''}
              title="Send selected instruments directly to the Batch Processor queue"
            >
              ${ICONS.cpu || ''} Process ${this.selectedIds.size} Selected in Batch Processor
            </button>
          </div>
        </div>
      </div>
    `;

    this.bindEvents(filtered);
  }

  private bindEvents(filtered: DiscoveredSamplerItem[]): void {
    if (!this.backdropEl || !this.options) return;

    // Close
    this.backdropEl.querySelector('#btn-triage-close')?.addEventListener('click', () => {
      this.options?.onCancel?.();
      this.close();
    });
    this.backdropEl.querySelector('#btn-triage-cancel')?.addEventListener('click', () => {
      this.options?.onCancel?.();
      this.close();
    });

    // Search input
    const inpSearch = this.backdropEl.querySelector('#inp-triage-search') as HTMLInputElement | null;
    inpSearch?.addEventListener('input', () => {
      this.filterQuery = inpSearch.value;
      this.render();
      const nextInp = this.backdropEl?.querySelector('#inp-triage-search') as HTMLInputElement | null;
      if (nextInp) {
        nextInp.focus();
        nextInp.selectionStart = nextInp.selectionEnd = nextInp.value.length;
      }
    });

    this.backdropEl.querySelector('#btn-triage-clear-search')?.addEventListener('click', () => {
      this.filterQuery = '';
      this.render();
    });

    // Format filter
    const selFormat = this.backdropEl.querySelector('#sel-triage-format') as HTMLSelectElement | null;
    selFormat?.addEventListener('change', () => {
      this.filterFormat = selFormat.value;
      this.render();
    });

    // Select all / Deselect all
    this.backdropEl.querySelector('#btn-triage-select-all')?.addEventListener('click', () => {
      for (const it of filtered) {
        this.selectedIds.add(it.id);
      }
      this.render();
    });

    this.backdropEl.querySelector('#btn-triage-deselect-all')?.addEventListener('click', () => {
      for (const it of filtered) {
        this.selectedIds.delete(it.id);
      }
      this.render();
    });

    // Header checkbox
    const chkHeader = this.backdropEl.querySelector('#chk-triage-header') as HTMLInputElement | null;
    chkHeader?.addEventListener('change', () => {
      const check = chkHeader.checked;
      for (const it of filtered) {
        if (check) this.selectedIds.add(it.id);
        else this.selectedIds.delete(it.id);
      }
      this.render();
    });

    // Item checkboxes
    const itemCheckboxes = this.backdropEl.querySelectorAll('.chk-triage-item');
    itemCheckboxes.forEach((chk) => {
      chk.addEventListener('change', (e) => {
        const id = (e.target as HTMLElement).getAttribute('data-id');
        if (!id) return;
        if ((e.target as HTMLInputElement).checked) {
          this.selectedIds.add(id);
        } else {
          this.selectedIds.delete(id);
        }
        this.render();
      });
    });

    // Single item load
    const loadButtons = this.backdropEl.querySelectorAll('.btn-triage-load-single');
    loadButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const item = this.options?.discoveryReport.items.find((it) => it.id === id);
        if (item && this.options) {
          this.close();
          this.options.onImportSingle(item);
        }
      });
    });

    // Proceed to Batch
    this.backdropEl.querySelector('#btn-triage-proceed-batch')?.addEventListener('click', () => {
      if (!this.options || this.selectedIds.size === 0) return;
      const selected = this.options.discoveryReport.items.filter((it) => this.selectedIds.has(it.id));
      this.close();
      this.options.onProcessBatch(selected);
    });
  }
}
