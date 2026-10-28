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

      <div class="audit-minimap-container">
        <div class="minimap-header-label">128-NOTE MIDI COVERAGE MAP (0..127):</div>
        ${this.buildMiniMapHtml(session)}
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
          <div class="telemetry-spacer">
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

  private buildMiniMapHtml(session: Session): string {
    const coverage = new Uint8Array(128);
    for (const z of session.zones) {
      const low = Math.max(0, Math.min(127, z.lowKey));
      const high = Math.max(0, Math.min(127, z.highKey));
      for (let k = low; k <= high; k++) {
        coverage[k]++;
      }
    }

    let segmentsHtml = '<div class="telemetry-minimap" title="128-Note MIDI Coverage Mini-Map (0..127)">';
    let currentType: 'gap' | 'ok' | 'overlap' | null = null;
    let startKey = 0;

    const flushSegment = (endKey: number) => {
      if (currentType === null) return;
      const count = endKey - startKey + 1;
      const pct = ((count / 128) * 100).toFixed(2);
      const title = `${startKey}–${endKey}: ${currentType.toUpperCase()} (${count} notes)`;
      segmentsHtml += `<div class="minimap-segment is-${currentType}" style="width: ${pct}%" title="${title}"></div>`;
    };

    for (let k = 0; k < 128; k++) {
      const type: 'gap' | 'ok' | 'overlap' =
        coverage[k] === 0 ? 'gap' : coverage[k] === 1 ? 'ok' : 'overlap';
      if (type !== currentType) {
        if (currentType !== null) {
          flushSegment(k - 1);
        }
        currentType = type;
        startKey = k;
      }
    }
    flushSegment(127);
    segmentsHtml += '</div>';

    return `
      ${segmentsHtml}
      <div class="telemetry-minimap-labels">
        <span>C-1 (0)</span>
        <span>C1 (24)</span>
        <span>C3 (48)</span>
        <span>C4 (60)</span>
        <span>C6 (84)</span>
        <span>C8 (108)</span>
        <span>G9 (127)</span>
      </div>
    `;
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

  /** Read-only visibility for drawer-exclusivity logic (additive; no behavior change). */
  public isVisible(): boolean {
    return this.isOpen;
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
