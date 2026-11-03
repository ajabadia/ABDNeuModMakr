// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Multi-Instrument Selection & Batch Modal
//
// When a multi-instrument container (e.g. SF2 with multiple
// presets, or a folder with multiple SFZ definitions) is loaded,
// this modal presents the list of instruments, allowing the user
// to pick an individual instrument to load or immediately send
// the entire collection to the Batch Processor.
//
// Maquetación según el esqueleto canónico DRY de modales
// (comparte kit con la puerta de triaje): ventana L, resumen
// superior, barra de búsqueda, tabla con scroll 200px y pie.
// ─────────────────────────────────────────────────────────

import { ICONS } from './icons.ts';
import { escHtml, escAttr } from './escape.ts';
import { createModalFocusTrap, type FocusTrap } from './modalFocusTrap.ts';

export interface MultiInstrumentItem {
  id: string;
  index: number;
  name: string;
  bank?: number;
  presetNumber?: number;
  regionCount?: number;
  detail?: string;
}

export type MultiInstrumentContainerFormat = 'sf2' | 'sfz' | 'mpc' | 'folder' | 'zip' | 'disk' | 'akai';

export interface MultiInstrumentModalOptions {
  title?: string;
  fileName: string;
  format: MultiInstrumentContainerFormat;
  items: MultiInstrumentItem[];
  onSelect: (item: MultiInstrumentItem) => void;
  onProcessBatch: () => void;
  onCancel?: () => void;
  /** Optional AI-assisted re-clustering callback when deducing instruments from a directory of loose samples. */
  onDeduceWithAi?: () => Promise<MultiInstrumentItem[] | null>;
}

export class MultiInstrumentModal {
  private backdropEl: HTMLElement | null = null;
  private options: MultiInstrumentModalOptions | null = null;
  private focusTrap: FocusTrap | null = null;
  private filterQuery = '';
  private selectedIndex = 0;
  private isAiGrouping = false;

  public open(options: MultiInstrumentModalOptions): void {
    this.close();
    this.options = options;
    this.filterQuery = '';
    this.selectedIndex = 0;

    const backdrop = document.createElement('div');
    backdrop.className = 'nmm-modal-backdrop';
    this.backdropEl = backdrop;
    document.body.appendChild(backdrop);

    this.render();

    if (!this.focusTrap && this.backdropEl) {
      this.focusTrap = createModalFocusTrap(this.backdropEl, {
        onEscape: () => {
          this.options?.onCancel?.();
          this.close();
        },
        initialFocusSelector: '#inp-multi-inst-filter',
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

  private render(): void {
    if (!this.backdropEl || !this.options) return;

    const { fileName, format, items } = this.options;
    const q = this.filterQuery.trim().toLowerCase();
    const filtered = q
      ? items.filter((it) => it.name.toLowerCase().includes(q) || (it.detail && it.detail.toLowerCase().includes(q)))
      : items;

    const formatBadge = format.toUpperCase();
    const containerNoun =
      format === 'sf2'
        ? 'SoundFont'
        : format === 'mpc'
          ? 'Akai MPC expansion'
          : format === 'folder'
            ? 'sample directory'
            : format === 'disk' || format === 'akai'
              ? 'Akai S-Series disk image'
              : format === 'zip'
                ? 'archive'
                : 'collection';

    this.backdropEl.innerHTML = `
      <div class="nmm-modal-window nmm-modal-l nmm-multi-inst-window" role="dialog" aria-modal="true" aria-labelledby="multi-inst-title">
        <div class="nmm-modal-header">
          <div class="nmm-modal-header-title" id="multi-inst-title">
            <span class="modal-icon">${ICONS.layers}</span>
            <h2>MULTI-INSTRUMENT ${escHtml(formatBadge)} DETECTED</h2>
            <span class="badge badge-accent">${items.length} INSTRUMENTS</span>
          </div>
          <button type="button" class="btn btn-close-modal" id="btn-multi-inst-close" title="Cancel" aria-label="Cerrar">
            ${ICONS.close}
          </button>
        </div>

        <div class="nmm-triage-body">
          <div class="triage-summary">
            <span>${ICONS.layers}</span>
            <div>
              <p><strong>${escHtml(fileName)}</strong> trae ${items.length} instrumentos en este ${escHtml(containerNoun)}.</p>
              <p>Carga uno directo en la sesión o procesa la colección entera en el Batch.</p>
            </div>
          </div>

          <div class="triage-toolbar">
            <div class="triage-toolbar-left">
              <input
                type="text"
                id="inp-multi-inst-filter"
                class="form-control triage-search"
                placeholder="Filtrar por nombre (p. ej. Piano, Bass, Strings)…"
                value="${escAttr(this.filterQuery)}"
                autocomplete="off"
                spellcheck="false"
              />
              ${this.filterQuery ? `<button type="button" class="btn btn-sm btn-outline" id="btn-clear-search">Limpiar</button>` : ''}
            </div>
            <div class="triage-toolbar-right">
              ${
                this.options.onDeduceWithAi
                  ? `<button type="button" class="btn btn-sm btn-outline" id="btn-ai-deduce-inst" ${this.isAiGrouping ? 'disabled' : ''} title="Reagrupar por instrumento con IA (BYOK LLM)">
                      ${ICONS.sparkle} ${this.isAiGrouping ? 'Agrupando…' : 'Agrupar por nombre (IA)'}
                    </button>`
                  : ''
              }
            </div>
          </div>

          <div class="triage-table-panel">
            <div class="triage-table-scroll">
              <table class="triage-table">
                <thead>
                  <tr>
                    <th class="triage-col-idx">#</th>
                    <th class="triage-col-bank">Bank : Prog</th>
                    <th>Instrumento</th>
                    <th class="triage-col-regions">Estructura</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  ${
                    filtered.length === 0
                      ? `<tr><td colspan="5"><div class="triage-empty">Sin coincidencias para «${escHtml(this.filterQuery)}».</div></td></tr>`
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
                              <tr class="triage-row ${isSel ? 'triage-row-selected' : ''}" data-index="${it.index}">
                                <td class="triage-col-idx">${it.index + 1}</td>
                                <td class="triage-col-bank"><span class="bank-tag">${escHtml(bankStr)}</span></td>
                                <td><div class="triage-item-name">${escHtml(it.name)}</div></td>
                                <td class="triage-col-regions"><span class="reg-tag">${escHtml(regStr)}</span></td>
                                <td class="triage-col-action">
                                  <button type="button" class="btn btn-sm btn-accent btn-load-this-inst" data-index="${it.index}" title="Cargar este instrumento">
                                    ${ICONS.play} Cargar
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
            <p class="triage-hint">Doble clic carga el instrumento · «Procesar» manda la colección entera al Batch</p>
          </div>
        </div>

        <footer class="nmm-modal-footer">
          <div class="footer-left">
            <button type="button" class="btn btn-ghost" id="btn-multi-inst-cancel">
              Cerrar
            </button>
          </div>
          <div class="footer-right">
            <button
              type="button"
              class="btn btn-outline btn-batch-call"
              id="btn-multi-inst-batch"
              title="Procesar los ${items.length} instrumentos en el Batch"
            >
              ${ICONS.cpu} Procesar todo en Batch (${items.length})
            </button>
            <button
              type="button"
              class="btn btn-accent"
              id="btn-multi-inst-load-selected"
              title="Cargar el instrumento seleccionado"
            >
              ${ICONS.check} Cargar seleccionado
            </button>
          </div>
        </footer>
      </div>
    `;

    this.bindEvents(filtered);
  }

  private bindEvents(filtered: MultiInstrumentItem[]): void {
    if (!this.backdropEl || !this.options) return;

    // Clic fuera cierra (con aviso de cancelación)
    this.backdropEl.addEventListener('mousedown', (e) => {
      if (e.target === this.backdropEl) {
        this.options?.onCancel?.();
        this.close();
      }
    });

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

    this.backdropEl.querySelector('#btn-ai-deduce-inst')?.addEventListener('click', async () => {
      if (!this.options?.onDeduceWithAi || this.isAiGrouping) return;
      this.isAiGrouping = true;
      this.render();
      try {
        const updatedItems = await this.options.onDeduceWithAi();
        if (updatedItems && updatedItems.length > 0 && this.options) {
          this.options.items = updatedItems;
          this.selectedIndex = 0;
        }
      } finally {
        this.isAiGrouping = false;
        this.render();
      }
    });

    // Row selection & double click
    this.backdropEl.querySelectorAll('.triage-row').forEach((row) => {
      row.addEventListener('click', () => {
        const idx = parseInt((row as HTMLElement).dataset.index ?? '0', 10);
        this.selectedIndex = idx;
        this.backdropEl?.querySelectorAll('.triage-row').forEach((r) => r.classList.remove('triage-row-selected'));
        row.classList.add('triage-row-selected');
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
  }
}
