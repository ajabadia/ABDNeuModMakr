// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Multi-Asset Triage Modal (Fase 29, puerta Fase 35)
// Puerta de triaje para contenido mixto (carpeta / multi-archivo / .zip):
// el usuario decide por entidad — carga directa o lote al Batch.
// Maquetación según el sistema de las modales de laboratorio de audio:
// misma ventana, mismos 4 niveles, cero colores literales.
// ─────────────────────────────────────────────────────────

import { ICONS } from './icons.ts';
import { escHtml, escAttr } from './escape.ts';
import { createModalFocusTrap, type FocusTrap } from './modalFocusTrap.ts';
import type {
  DiscoveredSamplerItem,
  MultiAssetDiscoveryReport,
} from '../formats/MultiAssetDiscovery.ts';

export interface TriageModalOptions {
  sourceName: string;
  discoveryReport: MultiAssetDiscoveryReport;
  onImportSingle: (item: DiscoveredSamplerItem) => void;
  onProcessBatch: (selected: DiscoveredSamplerItem[]) => void;
  onCancel?: () => void;
}

export class MultiAssetTriageModal {
  private backdropEl: HTMLDivElement | null = null;
  private options: TriageModalOptions | null = null;
  private focusTrap: FocusTrap | null = null;
  private searchTerm = '';
  private selectedIds = new Set<string>();

  public isOpen(): boolean {
    return this.backdropEl !== null;
  }

  public open(options: TriageModalOptions): void {
    this.close();
    this.options = options;
    this.searchTerm = '';
    this.selectedIds = new Set(options.discoveryReport.items.map((it) => it.id));

    this.backdropEl = document.createElement('div');
    this.backdropEl.className = 'nmm-modal-backdrop';
    this.backdropEl.innerHTML = this.render();
    document.body.appendChild(this.backdropEl);

    this.bindEvents();

    if (!this.focusTrap && this.backdropEl) {
      this.focusTrap = createModalFocusTrap(this.backdropEl, {
        onEscape: () => {
          this.options?.onCancel?.();
          this.close();
        },
        initialFocusSelector: '#inp-triage-search',
      });
      this.focusTrap.activate();
    }
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

  private render(): string {
    const opts = this.options!;
    const items = this.filteredItems();
    const formats = new Set(opts.discoveryReport.items.map((it) => it.formatLabel));

    const summaryHtml = `
      <div class="triage-summary">
        <span>${ICONS.layers}</span>
        <div>
          <p><strong>${escHtml(opts.sourceName)}</strong> trae ${opts.discoveryReport.items.length} piezas en ${formats.size} formatos (${escHtml([...formats].join(' · '))}). Elige qué hacer con cada una.</p>
          <p>Directo a la sesión: audio y SF2. El resto se prepara en el Batch o va a Importación universal (Ctrl+I).</p>
        </div>
      </div>`;

    const rowsHtml = items
      .map((item, i) => {
        const checked = this.selectedIds.has(item.id) ? 'checked' : '';
        const badgeClass = this.isDefinitionFormat(item.format) ? 'badge-accent' : 'badge-neutral';
        return `
          <tr data-item-id="${escAttr(item.id)}" class="${checked ? 'triage-row-selected' : ''}">
            <td class="triage-col-check"><input type="checkbox" class="triage-check" data-idx="${i}" ${checked} aria-label="Seleccionar ${escAttr(item.name)}" /></td>
            <td>
              <div class="triage-item-name">${escHtml(item.name)}</div>
              <div class="triage-item-detail">${escHtml(item.detail)} · ${this.formatSize(item.totalSizeBytes)}</div>
            </td>
            <td><span class="badge ${badgeClass}">${escHtml(item.formatLabel)}</span></td>
            <td class="triage-num">${escHtml(String(item.sampleCount))}</td>
            <td class="triage-col-action"><button type="button" class="btn btn-sm btn-outline" data-act="load" data-idx="${i}">Cargar</button></td>
          </tr>`;
      })
      .join('');

    return `
    <div class="nmm-modal-window nmm-triage-window" role="dialog" aria-modal="true" aria-label="Contenido mixto: elegir qué hacer con cada pieza">
      <div class="nmm-modal-header">
        <div class="nmm-modal-header-title">
          <span class="nmm-modal-header-icon">${ICONS.layers}</span>
          <h2>Contenido mixto: ¿qué hacemos con cada cosa?</h2>
          <span class="badge badge-accent" id="triage-format-badge">${formats.size} ${formats.size === 1 ? 'formato' : 'formatos'}</span>
        </div>
        <button type="button" class="nmm-modal-close" id="btn-triage-close" aria-label="Cerrar">${ICONS.close}</button>
      </div>
      <div class="nmm-triage-body">
        ${summaryHtml}
        <div class="triage-toolbar">
          <div class="triage-toolbar-left">
            <input type="text" id="inp-triage-search" class="form-control triage-search" placeholder="Filtrar piezas…" value="${escAttr(this.searchTerm)}" autocomplete="off" spellcheck="false" />
          </div>
          <div class="triage-toolbar-right">
            <span class="triage-count"><span class="val-pill" id="triage-sel-count">${this.selectedIds.size}</span> seleccionadas</span>
            <button type="button" class="btn btn-sm btn-outline" id="btn-triage-select-all">Todas</button>
            <button type="button" class="btn btn-sm btn-outline" id="btn-triage-clear">Ninguna</button>
          </div>
        </div>
        <div class="triage-table-panel">
          <div class="triage-table-scroll">
            <table class="triage-table nmm-data-table">
              <thead><tr><th></th><th>Pieza</th><th>Formato</th><th>Muestras</th><th></th></tr></thead>
              <tbody id="triage-items-body">${rowsHtml}</tbody>
            </table>
            <div id="triage-list-empty" class="triage-empty${items.length === 0 ? '' : ' is-hidden'}">
              <p id="triage-empty-msg">Sin coincidencias para «${escHtml(this.searchTerm)}».</p>
            </div>
          </div>
          <p class="triage-hint">«Cargar» mete el audio directo en la sesión · «Procesar» manda la selección al Batch · el resto va por Importación universal (Ctrl+I)</p>
        </div>
      </div>
      <footer class="nmm-modal-footer">
        <div class="footer-left">
          <button type="button" class="btn btn-ghost" id="btn-triage-cancel">Cerrar</button>
        </div>
        <div class="footer-right">
          <button type="button" class="btn btn-primary" id="btn-triage-process">Procesar selección</button>
        </div>
      </footer>
    </div>`;
  }

  private isDefinitionFormat(format: string): boolean {
    return format !== 'sample_pack' && format !== 'loop_slice';
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  private filteredItems(): DiscoveredSamplerItem[] {
    const term = this.searchTerm.trim().toLowerCase();
    const all = this.options?.discoveryReport.items ?? [];
    if (!term) return all;
    return all.filter(
      (it) =>
        it.name.toLowerCase().includes(term) ||
        it.formatLabel.toLowerCase().includes(term) ||
        it.detail.toLowerCase().includes(term)
    );
  }

  private bindEvents(): void {
    const root = this.backdropEl!;
    root.addEventListener('mousedown', (e) => {
      if (e.target === root) {
        this.options?.onCancel?.();
        this.close();
      }
    });
    root.querySelector('#btn-triage-close')?.addEventListener('click', () => {
      this.options?.onCancel?.();
      this.close();
    });
    root.querySelector('#btn-triage-cancel')?.addEventListener('click', () => {
      this.options?.onCancel?.();
      this.close();
    });
    root.querySelector('#btn-triage-process')?.addEventListener('click', () => {
      const selected =
        this.options?.discoveryReport.items.filter((it) => this.selectedIds.has(it.id)) ?? [];
      this.options?.onProcessBatch(selected);
      this.close();
    });
    root.querySelector('#inp-triage-search')?.addEventListener('input', (e) => {
      this.searchTerm = (e.target as HTMLInputElement).value;
      this.refreshList();
    });
    root.querySelector('#btn-triage-select-all')?.addEventListener('click', () => {
      for (const it of this.filteredItems()) this.selectedIds.add(it.id);
      this.refreshList();
    });
    root.querySelector('#btn-triage-clear')?.addEventListener('click', () => {
      for (const it of this.filteredItems()) this.selectedIds.delete(it.id);
      this.refreshList();
    });
    root.querySelector('#triage-items-body')?.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-act="load"]') as HTMLElement | null;
      if (btn) {
        const idx = Number(btn.dataset.idx ?? '-1');
        const item = this.filteredItems()[idx];
        if (item) {
          this.options?.onImportSingle(item);
          this.close();
        }
        return;
      }
      const row = (e.target as HTMLElement).closest('tr[data-item-id]') as HTMLElement | null;
      if (!row || (e.target as HTMLElement).closest('button')) return;
      const id = row.dataset.itemId!;
      if (this.selectedIds.has(id)) this.selectedIds.delete(id);
      else this.selectedIds.add(id);
      this.refreshList();
    });
    root.querySelector('#triage-items-body')?.addEventListener('change', (e) => {
      const box = (e.target as HTMLElement).closest('.triage-check') as HTMLInputElement | null;
      if (!box) return;
      const idx = Number(box.dataset.idx ?? '-1');
      const item = this.filteredItems()[idx];
      if (!item) return;
      if (box.checked) this.selectedIds.add(item.id);
      else this.selectedIds.delete(item.id);
      this.refreshList();
    });
  }

  private refreshList(): void {
    if (!this.backdropEl || !this.options) return;
    const items = this.filteredItems();
    const body = this.backdropEl.querySelector('#triage-items-body');
    if (body) {
      body.innerHTML = items
        .map((item, i) => {
          const checked = this.selectedIds.has(item.id) ? 'checked' : '';
          const badgeClass = this.isDefinitionFormat(item.format) ? 'badge-accent' : 'badge-neutral';
          return `
          <tr data-item-id="${escAttr(item.id)}" class="${checked ? 'triage-row-selected' : ''}">
            <td class="triage-col-check"><input type="checkbox" class="triage-check" data-idx="${i}" ${checked} aria-label="Seleccionar ${escAttr(item.name)}" /></td>
            <td>
              <div class="triage-item-name">${escHtml(item.name)}</div>
              <div class="triage-item-detail">${escHtml(item.detail)} · ${this.formatSize(item.totalSizeBytes)}</div>
            </td>
            <td><span class="badge ${badgeClass}">${escHtml(item.formatLabel)}</span></td>
            <td class="triage-num">${escHtml(String(item.sampleCount))}</td>
            <td class="triage-col-action"><button type="button" class="btn btn-sm btn-outline" data-act="load" data-idx="${i}">Cargar</button></td>
          </tr>`;
        })
        .join('');
    }
    const empty = this.backdropEl.querySelector('#triage-list-empty') as HTMLElement | null;
    if (empty) empty.classList.toggle('is-hidden', items.length !== 0);
    const msg = this.backdropEl.querySelector('#triage-empty-msg');
    if (msg) msg.textContent = `Sin coincidencias para «${this.searchTerm}».`;
    this.updateProcessButton();
  }

  private updateProcessButton(): void {
    if (!this.backdropEl) return;
    const btn = this.backdropEl.querySelector('#btn-triage-process') as HTMLButtonElement | null;
    if (btn) {
      btn.textContent = `Procesar selección (${this.selectedIds.size})`;
      btn.disabled = this.selectedIds.size === 0;
    }
    const pill = this.backdropEl.querySelector('#triage-sel-count');
    if (pill) pill.textContent = String(this.selectedIds.size);
  }
}
