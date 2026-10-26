// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Process Modal Component
// Real-time neural resynthesis progress and status display
// ─────────────────────────────────────────────────────────

import type { ProcessProgress } from '../core/types';
import { ICONS } from './icons';

export interface ProcessModalHandlers {
  onCancel: () => void;
  onClose: () => void;
}

export class ProcessModal {
  private container: HTMLElement;
  private handlers: ProcessModalHandlers;
  private modalElement: HTMLElement | null = null;
  private isVisible: boolean = false;

  constructor(container: HTMLElement, handlers: ProcessModalHandlers) {
    this.container = container;
    this.handlers = handlers;
  }

  public show(initialProgress?: ProcessProgress): void {
    if (this.isVisible) return;
    this.isVisible = true;

    this.modalElement = document.createElement('div');
    this.modalElement.className = 'modal-backdrop is-visible';
    this.modalElement.innerHTML = `
      <div class="modal-dialog modal-process" role="dialog" aria-modal="true">
        <div class="modal-header">
          <div class="modal-title">
            <span class="modal-icon">${ICONS.cpu}</span>
            <span>NEURAL SPECTRAL PROCESS</span>
          </div>
          <button type="button" class="btn btn-close-modal" id="btn-modal-close" title="Close">${ICONS.close}</button>
        </div>

        <div class="modal-body">
          <div class="process-stage-status">
            <span class="stage-pulse">●</span>
            <span class="stage-message" id="modal-stage-msg">Initializing neural analysis pipeline...</span>
          </div>

          <div class="progress-bar-container">
            <div class="progress-bar-fill" id="modal-progress-fill" style="width: 0%;"></div>
          </div>

          <div class="progress-metrics-grid">
            <div class="metric-card">
              <span class="metric-label">PROGRESS</span>
              <span class="metric-value" id="modal-metric-pct">0%</span>
            </div>
            <div class="metric-card">
              <span class="metric-label">ACTIVE ZONE</span>
              <span class="metric-value" id="modal-metric-zone">0 / 0</span>
            </div>
            <div class="metric-card">
              <span class="metric-label">ELAPSED TIME</span>
              <span class="metric-value" id="modal-metric-time">0.0s</span>
            </div>
          </div>

          <div class="current-sample-banner">
            <span class="sample-banner-tag">ANALYZING SAMPLE:</span>
            <span class="sample-banner-file" id="modal-current-sample">—</span>
          </div>

          <div class="modal-console-log" id="modal-console-log">
            <div class="log-line">[0.0s] Neural engine starting...</div>
          </div>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn btn-danger btn-sm" id="btn-modal-cancel">
            ${ICONS.stop} Cancel Process
          </button>
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

    if (initialProgress) {
      this.updateProgress(initialProgress);
    }
  }

  public updateProgress(p: ProcessProgress): void {
    if (!this.isVisible || !this.modalElement) return;

    const fill = this.modalElement.querySelector('#modal-progress-fill') as HTMLElement;
    const msg = this.modalElement.querySelector('#modal-stage-msg') as HTMLElement;
    const pct = this.modalElement.querySelector('#modal-metric-pct') as HTMLElement;
    const zone = this.modalElement.querySelector('#modal-metric-zone') as HTMLElement;
    const time = this.modalElement.querySelector('#modal-metric-time') as HTMLElement;
    const sample = this.modalElement.querySelector('#modal-current-sample') as HTMLElement;
    const log = this.modalElement.querySelector('#modal-console-log') as HTMLElement;

    if (fill) fill.style.width = `${p.percent}%`;
    if (msg) msg.textContent = p.message;
    if (pct) pct.textContent = `${p.percent}%`;
    if (zone) zone.textContent = `${p.currentZone} / ${p.totalZones}`;
    if (time) time.textContent = `${(p.elapsedMs / 1000).toFixed(1)}s`;
    if (sample) sample.textContent = p.currentSample || 'Extracting model excitation...';

    if (log && p.message) {
      const line = document.createElement('div');
      line.className = 'log-line';
      line.textContent = `[${(p.elapsedMs / 1000).toFixed(1)}s] ${p.message}`;
      log.appendChild(line);
      log.scrollTop = log.scrollHeight;
    }

    if (p.status === 'completed') {
      const cancelBtn = this.modalElement.querySelector('#btn-modal-cancel') as HTMLButtonElement;
      if (cancelBtn) {
        cancelBtn.className = 'btn btn-primary btn-sm';
        cancelBtn.innerHTML = `${ICONS.check} Done`;
        cancelBtn.onclick = () => this.hide();
      }
    }
  }

  public hide(): void {
    if (!this.isVisible || !this.modalElement) return;
    this.modalElement.remove();
    this.modalElement = null;
    this.isVisible = false;
  }
}
