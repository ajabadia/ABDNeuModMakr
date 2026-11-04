// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Export by Destination Modal (Fase 35.2)
//
// Musician-centric export selector with 3 destination cards:
//   1. Para tocar en AxionikVS → Cápsula del Tiempo (.zip 5 capas / AxionikDB)
//   2. Para otros samplers → Kontakt / Decent / SFZ / SF2 / MPC…
//   3. Solo audio → WAV / AIFF
//
// Uses the canonical DRY modal skeleton (`nmm-modal-backdrop`,
// `nmm-modal-window nmm-modal-l`, `nmm-modal-header`, `nmm-audio-modal-body`,
// `nmm-modal-footer`). Zero inline styles, zero literal colors.
// ─────────────────────────────────────────────────────────

import {
  TIME_CAPSULE_CANONICAL_LABEL,
  TIME_CAPSULE_ES_LABEL,
  buildExportDestinationCards,
  resolveExportDestinationSummary,
  triggerExportDestinationAction,
  type ExportDestinationCallbacks,
  type ExportDestinationId,
  type ExportSessionContext,
} from '../app/exportDestinations.ts';
import { getAppLocale, onAppLocaleChange } from '../core/i18n.ts';
import { ICONS } from './icons.ts';
import { escAttr, escHtml } from './escape.ts';
import { createModalFocusTrap, type FocusTrap } from './modalFocusTrap.ts';

export interface ExportDestinationModalContext extends ExportDestinationCallbacks {
  getSessionContext: () => ExportSessionContext;
}

export class ExportDestinationModal {
  private readonly context: ExportDestinationModalContext;
  private backdropEl: HTMLDivElement | null = null;
  private focusTrap: FocusTrap | null = null;
  private selectedId: ExportDestinationId = 'time-capsule';

  constructor(context: ExportDestinationModalContext) {
    this.context = context;
    onAppLocaleChange(() => {
      if (this.backdropEl) {
        this.backdropEl.innerHTML = this.render();
        this.bindEvents();
      }
    });
  }

  public isOpen(): boolean {
    return this.backdropEl !== null;
  }

  public open(initialDestination: ExportDestinationId = 'time-capsule'): void {
    this.close();
    this.selectedId = initialDestination;

    this.backdropEl = document.createElement('div');
    this.backdropEl.className = 'nmm-modal-backdrop';
    this.backdropEl.innerHTML = this.render();
    this.backdropEl.addEventListener('mousedown', (e) => {
      if (e.target === this.backdropEl) this.close();
    });
    document.body.appendChild(this.backdropEl);

    this.bindEvents();

    if (!this.focusTrap && this.backdropEl) {
      this.focusTrap = createModalFocusTrap(this.backdropEl, {
        onEscape: () => this.close(),
        initialFocusSelector: '#btn-export-dest-run',
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
  }

  private iconForDestination(id: ExportDestinationId): string {
    if (id === 'time-capsule') return ICONS.cpu;
    if (id === 'other-samplers') return ICONS.database;
    return ICONS.wave;
  }

  private render(): string {
    const isEs = getAppLocale() === 'es';
    const sessionCtx = this.context.getSessionContext();
    const summary = resolveExportDestinationSummary(sessionCtx);
    const cards = buildExportDestinationCards();
    const activeCard = cards.find((c) => c.id === this.selectedId) ?? cards[0];
    const capsuleLabel = isEs ? TIME_CAPSULE_ES_LABEL : TIME_CAPSULE_CANONICAL_LABEL;

    const cardsHtml = cards
      .map((card) => {
        const isSelected = card.id === this.selectedId;
        const quickButtonsHtml = card.secondaryActions
          .map(
            (act) => `
              <button
                type="button"
                class="btn btn-xs btn-outline"
                data-dest-quick="${escAttr(card.id)}"
                data-action-id="${escAttr(act.id)}"
              >${escHtml(act.label)}</button>`
          )
          .join('');

        return `
          <div class="issue-card ${isSelected ? 'is-info' : ''}" data-dest-card="${escAttr(card.id)}">
            <div class="issue-head">
              <span class="issue-title">${this.iconForDestination(card.id)} ${escHtml(card.title)}</span>
              <span class="issue-tags">
                <span class="issue-tag ${isSelected ? 'is-info' : ''}">${escHtml(card.badge)}</span>
                <button
                  type="button"
                  class="btn btn-sm ${isSelected ? 'btn-primary' : 'btn-outline'}"
                  data-dest-primary="${escAttr(card.id)}"
                >${escHtml(card.primaryActionLabel)}</button>
              </span>
            </div>
            <p class="issue-desc">${escHtml(card.description)}</p>
            <div class="triage-toolbar-left">
              <span class="triage-count">${escHtml(card.targetSubtitle)}</span>
              ${quickButtonsHtml}
            </div>
          </div>`;
      })
      .join('');

    return `
      <div class="nmm-modal-window nmm-modal-l" role="dialog" aria-modal="true" aria-label="${isEs ? 'Exportar instrumento por destino' : 'Export instrument by destination'}">
        <div class="nmm-modal-header">
          <div class="nmm-modal-header-title">
            <span class="modal-icon">${ICONS.database}</span>
            <div>
              <h2>${isEs ? 'Exportar instrumento: ¿dónde lo vas a tocar?' : 'Export Instrument: Where will you play it?'}</h2>
              <p class="nmm-header-sub">${isEs ? `Elige el destino para ${escHtml(summary.displayName)} (${escHtml(summary.slotLabel)} · ${escHtml(summary.zonesLabel)})` : `Choose the destination for ${escHtml(summary.displayName)} (${escHtml(summary.slotLabel)} · ${escHtml(summary.zonesLabel)})`}</p>
            </div>
          </div>
          <button type="button" class="btn btn-close-modal" id="btn-export-dest-close" title="${isEs ? 'Cerrar (Esc)' : 'Close (Esc)'}" aria-label="${isEs ? 'Cerrar' : 'Close'}">${ICONS.close}</button>
        </div>

        <div class="nmm-audio-modal-body">
          <div class="triage-summary">
            <span>${ICONS.layers}</span>
            <div>
              <p>${isEs ? `<strong>${escHtml(summary.displayName)}</strong> (${escHtml(summary.slotLabel)}) está en modo <strong>${escHtml(summary.modeLabel)}</strong> con <strong>${escHtml(summary.zonesLabel)}</strong>.` : `<strong>${escHtml(summary.displayName)}</strong> (${escHtml(summary.slotLabel)}) is in <strong>${escHtml(summary.modeLabel)}</strong> mode with <strong>${escHtml(summary.zonesLabel)}</strong>.`}</p>
              <p>${isEs ? `Para conservar las 5 capas sin pérdida generacional usa siempre la <strong>${escHtml(capsuleLabel)}</strong> o guárdalo en <strong>AxionikDB</strong>.` : `To preserve all 5 layers with zero generation loss, always use the <strong>${escHtml(capsuleLabel)}</strong> or save it to <strong>AxionikDB</strong>.`}</p>
            </div>
          </div>

          <div class="preflight-issues" id="export-dest-cards-list">
            ${cardsHtml}
          </div>
        </div>

        <footer class="nmm-modal-footer">
          <div class="footer-left">
            <span class="triage-count">${isEs ? 'Destino activo:' : 'Active destination:'} <strong>${escHtml(activeCard.badge)}</strong></span>
          </div>
          <div class="footer-right">
            <button type="button" class="btn btn-ghost" id="btn-export-dest-cancel">${isEs ? 'Cerrar' : 'Close'}</button>
            <button type="button" class="btn btn-primary" id="btn-export-dest-run">${escHtml(activeCard.primaryActionLabel)}</button>
          </div>
        </footer>
      </div>`;
  }

  private bindEvents(): void {
    const root = this.backdropEl;
    if (!root) return;

    root.querySelector('#btn-export-dest-close')?.addEventListener('click', () => this.close());
    root.querySelector('#btn-export-dest-cancel')?.addEventListener('click', () => this.close());

    root.querySelector('#btn-export-dest-run')?.addEventListener('click', () => {
      const targetId = this.selectedId;
      this.close();
      void triggerExportDestinationAction(targetId, this.context);
    });

    root.querySelectorAll<HTMLElement>('[data-dest-card]').forEach((cardEl) => {
      cardEl.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('button')) return;
        const id = cardEl.getAttribute('data-dest-card') as ExportDestinationId | null;
        if (id && id !== this.selectedId) {
          this.selectedId = id;
          root.innerHTML = this.render();
          this.bindEvents();
        }
      });
    });

    root.querySelectorAll<HTMLButtonElement>('[data-dest-primary]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-dest-primary') as ExportDestinationId | null;
        if (!id) return;
        this.close();
        void triggerExportDestinationAction(id, this.context);
      });
    });

    root.querySelectorAll<HTMLButtonElement>('[data-dest-quick]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const destId = btn.getAttribute('data-dest-quick') as ExportDestinationId | null;
        const actionId = btn.getAttribute('data-action-id') ?? undefined;
        if (!destId) return;
        this.close();
        void triggerExportDestinationAction(destId, this.context, actionId);
      });
    });
  }
}
