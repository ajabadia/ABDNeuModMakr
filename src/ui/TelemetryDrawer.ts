// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Telemetry & Log Drawer
// Inspects coverage integrity, gaps, and core events
// ─────────────────────────────────────────────────────────

import { escHtml } from './escape';
import { ICONS } from './icons';
import { midiToNoteName } from './ZoneRibbon';
import { onAppLocaleChange, tApp } from '../core/i18n';
import type { Session } from '../core/types';

export class TelemetryDrawer {
  private container: HTMLElement;
  private isOpen: boolean = false;
  private drawerElement: HTMLElement | null = null;
  private logs: string[] = [];
  private onAutoRepair: (() => void) | null = null;
  private lastSession: Session | null = null;
  private lastErrors: string[] = [];

  constructor(container: HTMLElement, onAutoRepair?: () => void) {
    this.container = container;
    this.onAutoRepair = onAutoRepair ?? null;
    this.init();
    onAppLocaleChange(() => {
      const titleSpan = this.drawerElement?.querySelector('#telemetry-title-text');
      if (titleSpan) titleSpan.textContent = tApp('telemetryDrawer.headerTitle');
      const closeBtn = this.drawerElement?.querySelector<HTMLElement>('#btn-close-telemetry');
      if (closeBtn) closeBtn.title = tApp('telemetryDrawer.btnCloseTitle');
      const secTitle = this.drawerElement?.querySelector('#telemetry-sec-stream');
      if (secTitle) secTitle.textContent = tApp('telemetryDrawer.sectionEventStream');
      if (this.lastSession) {
        this.updateAudit(this.lastSession, this.lastErrors);
      }
    });
  }

  private init(): void {
    this.drawerElement = document.createElement('div');
    this.drawerElement.className = 'telemetry-drawer-panel is-closed';
    this.drawerElement.innerHTML = `
      <div class="drawer-header">
        <div class="drawer-title">
          <span class="drawer-icon">${ICONS.terminal}</span>
          <span id="telemetry-title-text">${tApp('telemetryDrawer.headerTitle')}</span>
        </div>
        <button type="button" class="btn btn-close-drawer" id="btn-close-telemetry" title="${tApp('telemetryDrawer.btnCloseTitle')}">${ICONS.close}</button>
      </div>

      <div class="drawer-body">
        <div class="audit-summary-box" id="telemetry-audit-box">
          <!-- Dynamic audit report -->
        </div>

        <div class="drawer-section-title" id="telemetry-sec-stream">${tApp('telemetryDrawer.sectionEventStream')}</div>
        <div class="telemetry-log-stream" id="telemetry-log-stream">
          <div class="log-entry">[00:00:00] ${tApp('telemetryDrawer.initLog')}</div>
        </div>
      </div>
    `;

    this.container.appendChild(this.drawerElement);

    this.drawerElement.querySelector('#btn-close-telemetry')?.addEventListener('click', () => {
      this.close();
    });
  }

  public updateAudit(session: Session, errors: string[]): void {
    this.lastSession = session;
    this.lastErrors = errors;
    if (!this.drawerElement) return;
    const box = this.drawerElement.querySelector('#telemetry-audit-box');
    if (!box) return;

    const hasGaps = errors.length > 0;
    const assignedSamples = session.zones.filter((z) => Boolean(z.sampleLow)).length;
    const totalZones = session.zones.length;

    box.innerHTML = `
      <div class="audit-status-badge ${hasGaps ? 'has-error' : 'is-ok'}">
        <span class="badge-icon">${hasGaps ? ICONS.alert : ICONS.check}</span>
        <span class="badge-text">${hasGaps ? tApp('telemetryDrawer.statusIssues') : tApp('telemetryDrawer.statusVerified')}</span>
      </div>

      <div class="audit-minimap-container">
        <div class="minimap-header-label">${tApp('telemetryDrawer.minimapHeader')}</div>
        ${this.buildMiniMapHtml(session)}
      </div>

      <div class="audit-metrics-row">
        <div class="audit-stat">
          <span class="stat-num">${totalZones}</span>
          <span class="stat-lbl">${tApp('telemetryDrawer.statZones')}</span>
        </div>
        <div class="audit-stat">
          <span class="stat-num">${assignedSamples} / ${totalZones}</span>
          <span class="stat-lbl">${tApp('telemetryDrawer.statSamples')}</span>
        </div>
        <div class="audit-stat">
          <span class="stat-num">128</span>
          <span class="stat-lbl">${tApp('telemetryDrawer.statMidiNotes')}</span>
        </div>
      </div>

      ${hasGaps ? `
        <div class="audit-errors-list">
          <div class="errors-heading">${tApp('telemetryDrawer.errorsHeading')}</div>
          ${errors.map((err) => `<div class="error-item">${ICONS.alert} ${escHtml(err)}</div>`).join('')}
          <div class="telemetry-spacer">
            <button type="button" class="btn btn-sm btn-primary" id="btn-drawer-auto-repair" title="${tApp('telemetryDrawer.btnAutoRepairTitle')}">
              ${ICONS.repair} ${tApp('telemetryDrawer.btnAutoRepair')}
            </button>
          </div>
        </div>
      ` : `
        <div class="audit-ok-notice">
          ${tApp('telemetryDrawer.okNotice')}
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
        <span>${midiToNoteName(0)} (0)</span>
        <span>${midiToNoteName(24)} (24)</span>
        <span>${midiToNoteName(48)} (48)</span>
        <span>${midiToNoteName(60)} (60)</span>
        <span>${midiToNoteName(84)} (84)</span>
        <span>${midiToNoteName(108)} (108)</span>
        <span>${midiToNoteName(127)} (127)</span>
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
