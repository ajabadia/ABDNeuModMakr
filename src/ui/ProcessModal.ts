// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Process Modal Component
// Real-time neural resynthesis progress and status display
// ─────────────────────────────────────────────────────────

import { getAppLocale } from '../core/i18n.ts';
import type { ProcessProgress } from '../core/types';
import { ICONS } from './icons';
import { createModalFocusTrap, type FocusTrap } from './modalFocusTrap.ts';

export interface ProcessModalHandlers {
  onCancel: () => void;
  onClose: () => void;
  onExport?: () => void;
}

export class ProcessModal {
  private container: HTMLElement;
  private handlers: ProcessModalHandlers;
  private modalElement: HTMLElement | null = null;
  private isVisible: boolean = false;
  private currentStatus: ProcessProgress['status'] = 'idle';
  private focusTrap: FocusTrap | null = null;

  constructor(container: HTMLElement, handlers: ProcessModalHandlers) {
    this.container = container;
    this.handlers = handlers;
  }

  public show(initialProgress?: ProcessProgress): void {
    if (this.isVisible) return;
    this.isVisible = true;
    const isEs = getAppLocale() === 'es';

    this.modalElement = document.createElement('div');
    this.modalElement.className = 'nmm-modal-backdrop';
    this.modalElement.innerHTML = `
      <div class="nmm-modal-window nmm-modal-m modal-process" role="dialog" aria-modal="true">
        <div class="nmm-modal-header">
          <div class="nmm-modal-header-title">
            <span class="modal-icon">${ICONS.cpu}</span>
            <span>${isEs ? 'PROCESO ESPECTRAL NEURONAL' : 'NEURAL SPECTRAL PROCESS'}</span>
          </div>
          <button type="button" class="nmm-modal-close" id="btn-modal-close" title="${isEs ? 'Cerrar' : 'Close'}">${ICONS.close}</button>
        </div>

        <div class="nmm-modal-body">
          <div class="process-stage-status">
            <span class="stage-pulse">●</span>
            <span class="stage-message" id="modal-stage-msg">${isEs ? 'Inicializando tubería de análisis neuronal...' : 'Initializing neural analysis pipeline...'}</span>
          </div>

          <div class="progress-bar-container">
            <div class="progress-bar-fill" id="modal-progress-fill" style="width: 0%;"></div>
          </div>

          <div class="progress-metrics-grid">
            <div class="metric-card">
              <span class="metric-label">${isEs ? 'PROGRESO' : 'PROGRESS'}</span>
              <span class="metric-value" id="modal-metric-pct">0%</span>
            </div>
            <div class="metric-card">
              <span class="metric-label">${isEs ? 'ZONA ACTIVA' : 'ACTIVE ZONE'}</span>
              <span class="metric-value" id="modal-metric-zone">0 / 0</span>
            </div>
            <div class="metric-card">
              <span class="metric-label">${isEs ? 'TIEMPO TRANSCURRIDO' : 'ELAPSED TIME'}</span>
              <span class="metric-value" id="modal-metric-time">0.0s</span>
            </div>
          </div>

          <div class="current-sample-banner">
            <span class="sample-banner-tag">${isEs ? 'ANALIZANDO MUESTRA:' : 'ANALYZING SAMPLE:'}</span>
            <span class="sample-banner-file" id="modal-current-sample">—</span>
          </div>

          <div class="modal-console-log" id="modal-console-log">
            <div class="log-line">[0.0s] ${isEs ? 'Iniciando motor neuronal...' : 'Neural engine starting...'}</div>
          </div>
        </div>

        <div class="nmm-modal-footer" id="modal-process-footer">
          <div class="footer-right">
            <button type="button" class="btn btn-outline btn-sm is-hidden" id="btn-modal-export">
              ${ICONS.database} ${isEs ? 'Exportar…' : 'Export…'}
            </button>
            <button type="button" class="btn btn-danger btn-sm" id="btn-modal-cancel">
              ${ICONS.stop} ${isEs ? 'Cancelar Proceso' : 'Cancel Process'}
            </button>
          </div>
        </div>
      </div>
    `;

    this.container.appendChild(this.modalElement);

    this.modalElement.querySelector('#btn-modal-close')?.addEventListener('click', () => {
      this.handlers.onClose();
      this.hide();
    });

    this.modalElement.querySelector('#btn-modal-cancel')?.addEventListener('click', () => {
      this.handlers.onCancel();
    });

    if (!this.focusTrap && this.modalElement) {
      this.focusTrap = createModalFocusTrap(this.modalElement, {
        initialFocusSelector: '#btn-modal-cancel',
        onEscape: () => {
          if (!this.isVisible) return;
          if (this.currentStatus === 'completed' || this.currentStatus === 'error' || this.currentStatus === 'cancelled') {
            this.handlers.onClose();
            this.hide();
          } else {
            this.handlers.onCancel();
          }
        },
      });
      this.focusTrap.activate();
    }

    if (initialProgress) {
      this.updateProgress(initialProgress);
    }
  }

  public updateProgress(p: ProcessProgress): void {
    if (!this.isVisible || !this.modalElement) return;
    this.currentStatus = p.status;

    const fill = this.modalElement.querySelector('#modal-progress-fill') as HTMLElement;
    const msg = this.modalElement.querySelector('#modal-stage-msg') as HTMLElement;
    const pct = this.modalElement.querySelector('#modal-metric-pct') as HTMLElement;
    const zone = this.modalElement.querySelector('#modal-metric-zone') as HTMLElement;
    const time = this.modalElement.querySelector('#modal-metric-time') as HTMLElement;
    const sample = this.modalElement.querySelector('#modal-current-sample') as HTMLElement;
    const log = this.modalElement.querySelector('#modal-console-log') as HTMLElement;
    const cancelBtn = this.modalElement.querySelector('#btn-modal-cancel') as HTMLButtonElement;
    const exportBtn = this.modalElement.querySelector('#btn-modal-export') as HTMLButtonElement | null;

    const isEs = getAppLocale() === 'es';
    if (fill) fill.style.width = `${p.percent}%`;
    if (msg) msg.textContent = p.message;
    if (pct) pct.textContent = `${p.percent}%`;
    if (zone) zone.textContent = `${p.currentZone} / ${p.totalZones}`;
    if (time) time.textContent = `${(p.elapsedMs / 1000).toFixed(1)}s`;
    if (sample) sample.textContent = p.currentSample || (isEs ? 'Extrayendo excitación del modelo...' : 'Extracting model excitation...');

    if (log && p.message) {
      const line = document.createElement('div');
      line.className = 'log-line';
      line.textContent = `[${(p.elapsedMs / 1000).toFixed(1)}s] ${p.message}`;
      log.appendChild(line);
      log.scrollTop = log.scrollHeight;
    }

    if (p.status === 'completed' && cancelBtn) {
      if (exportBtn && this.handlers.onExport) {
        exportBtn.classList.remove('is-hidden');
        exportBtn.onclick = () => {
          this.handlers.onClose();
          this.hide();
          this.handlers.onExport?.();
        };
      }
      cancelBtn.className = 'btn btn-primary btn-sm';
      cancelBtn.innerHTML = `${ICONS.check} ${isEs ? 'Listo' : 'Done'}`;
      cancelBtn.onclick = () => {
        this.handlers.onClose();
        this.hide();
      };
    } else if ((p.status === 'error' || p.status === 'cancelled') && cancelBtn) {
      cancelBtn.className = 'btn btn-outline btn-sm';
      cancelBtn.innerHTML = `${ICONS.close} ${isEs ? 'Cerrar' : 'Close'}`;
      cancelBtn.onclick = () => {
        this.handlers.onClose();
        this.hide();
      };
    }
  }

  public hide(): void {
    if (!this.isVisible || !this.modalElement) return;
    if (this.focusTrap) {
      this.focusTrap.deactivate();
      this.focusTrap = null;
    }
    this.modalElement.remove();
    this.modalElement = null;
    this.isVisible = false;
  }
}
