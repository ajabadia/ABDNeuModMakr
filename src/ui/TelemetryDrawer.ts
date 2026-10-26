// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Telemetry & Log Drawer
// Inspects coverage integrity, gaps, and core events
// ─────────────────────────────────────────────────────────

import { ICONS } from './icons';
import type { Session } from '../core/types';

export class TelemetryDrawer {
  private container: HTMLElement;
  private isOpen: boolean = false;
  private drawerElement: HTMLElement | null = null;
  private logs: string[] = [];
  private onAutoRepair: (() => void) | null = null;

  constructor(container: HTMLElement, onAutoRepair?: () => void) {
    this.container = container;
    this.onAutoRepair = onAutoRepair ?? null;
    this.init();
  }

  private init(): void {
    this.drawerElement = document.createElement('div');
    this.drawerElement.className = 'telemetry-drawer-panel is-closed';
    this.drawerElement.innerHTML = `
      <div class="drawer-header">
        <div class="drawer-title">
          <span class="drawer-icon">${ICONS.terminal}</span>
          <span>TELEMETRY & MIDI COVERAGE AUDIT</span>
        </div>
        <button type="button" class="btn btn-close-drawer" id="btn-close-telemetry" title="Close Drawer">${ICONS.close}</button>
      </div>

      <div class="drawer-body">
        <div class="audit-summary-box" id="telemetry-audit-box">
          <!-- Dynamic audit report -->
        </div>

        <div class="drawer-section-title">ENGINE EVENT STREAM</div>
        <div class="telemetry-log-stream" id="telemetry-log-stream">
          <div class="log-entry">[00:00:00] ABDNeuModMakr session engine initialized.</div>
        </div>
      </div>
    `;

    this.container.appendChild(this.drawerElement);

    this.drawerElement.querySelector('#btn-close-telemetry')?.addEventListener('click', () => {
      this.close();
    });
  }

  public updateAudit(session: Session, errors: string[]): void {
    if (!this.drawerElement) return;
    const box = this.drawerElement.querySelector('#telemetry-audit-box');
    if (!box) return;

    const hasGaps = errors.length > 0;
    const assignedSamples = session.zones.filter((z) => Boolean(z.sampleLow)).length;
    const totalZones = session.zones.length;

    box.innerHTML = `
      <div class="audit-status-badge ${hasGaps ? 'has-error' : 'is-ok'}">
        <span class="badge-icon">${hasGaps ? ICONS.alert : ICONS.check}</span>
        <span class="badge-text">${hasGaps ? 'COVERAGE ISSUES DETECTED' : 'CONTINUOUS COVERAGE 0..127 VERIFIED'}</span>
      </div>

      <div class="audit-metrics-row">
        <div class="audit-stat">
          <span class="stat-num">${totalZones}</span>
          <span class="stat-lbl">ZONES</span>
        </div>
        <div class="audit-stat">
          <span class="stat-num">${assignedSamples} / ${totalZones}</span>
          <span class="stat-lbl">SAMPLES ASSIGNED</span>
        </div>
        <div class="audit-stat">
          <span class="stat-num">128</span>
          <span class="stat-lbl">MIDI NOTES</span>
        </div>
      </div>

      ${hasGaps ? `
        <div class="audit-errors-list">
          <div class="errors-heading">Errors requiring attention:</div>
          ${errors.map((err) => `<div class="error-item">${ICONS.alert} ${err}</div>`).join('')}
          <div style="margin-top: 10px;">
            <button type="button" class="btn btn-sm btn-primary" id="btn-drawer-auto-repair" title="Automatically sort zones, close gaps/overlaps across 0..127, and clamp root keys">
              ${ICONS.repair} Auto-Repair MIDI 0..127 Coverage
            </button>
          </div>
        </div>
      ` : `
        <div class="audit-ok-notice">
          All 128 MIDI note slots are partitioned continuously with no gaps or overlaps. Session is ready for Model Maker processing.
        </div>
      `}
    `;

    box.querySelector('#btn-drawer-auto-repair')?.addEventListener('click', () => {
      this.onAutoRepair?.();
    });
  }

  public addLog(message: string): void {
    const time = new Date().toLocaleTimeString();
    this.logs.push(`[${time}] ${message}`);
    if (this.logs.length > 500) {
      this.logs.shift();
    }

    if (this.drawerElement) {
      const stream = this.drawerElement.querySelector('#telemetry-log-stream');
      if (stream) {
        const line = document.createElement('div');
        line.className = 'log-entry';
        line.textContent = `[${time}] ${message}`;
        stream.appendChild(line);
        while (stream.children.length > 500) {
          stream.removeChild(stream.firstElementChild!);
        }
        stream.scrollTop = stream.scrollHeight;
      }
    }
  }

  public toggle(): void {
    this.isOpen = !this.isOpen;
    this.drawerElement?.classList.toggle('is-closed', !this.isOpen);
    this.drawerElement?.classList.toggle('is-open', this.isOpen);
  }

  public open(): void {
    this.isOpen = true;
    this.drawerElement?.classList.remove('is-closed');
    this.drawerElement?.classList.add('is-open');
  }

  public close(): void {
    this.isOpen = false;
    this.drawerElement?.classList.remove('is-open');
    this.drawerElement?.classList.add('is-closed');
  }
}
