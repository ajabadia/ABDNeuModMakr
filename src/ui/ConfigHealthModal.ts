// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Configuration Health & Onboarding Modal (Fase 21)
//
// Interactive startup readiness check:
//   - Distinguishes Mandatory vs Optional items
//   - Direct links to Settings tabs (General, Companion Bridge, Cloud BYOK)
//   - Explains what features are gated/disabled when not configured
//   - Persistent startup alert preference
// ─────────────────────────────────────────────────────────

import {
  evaluateConfigHealth,
  STORAGE_KEY_CONFIG_HEALTH_ON_BOOT,
  type ConfigHealthReport,
} from '../core/configHealth.ts';
import type { SettingsModalTab } from './SettingsModal.ts';
import { escHtml, escAttr } from './escape.ts';
import { ICONS } from './icons.ts';
import { createModalFocusTrap, type FocusTrap } from './modalFocusTrap.ts';

export interface ConfigHealthModalContext {
  onOpenSettings: (tab: SettingsModalTab) => void;
}

export class ConfigHealthModal {
  private readonly context: ConfigHealthModalContext;
  private backdropEl: HTMLElement | null = null;
  private focusTrap: FocusTrap | null = null;
  private report: ConfigHealthReport | null = null;

  constructor(context: ConfigHealthModalContext) {
    this.context = context;
  }

  public open(): void {
    this.report = evaluateConfigHealth();
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
  }

  public isOpen(): boolean {
    return Boolean(this.backdropEl);
  }

  private render(): void {
    if (!this.report) return;

    if (!this.backdropEl) {
      this.backdropEl = document.createElement('div');
      this.backdropEl.className = 'nmm-modal-backdrop config-health-modal-backdrop';
      document.body.appendChild(this.backdropEl);

      this.backdropEl.addEventListener('click', (e) => {
        if (e.target === this.backdropEl) this.close();
      });
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.backdropEl) this.close();
      });
    }

    const showOnBoot =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem(STORAGE_KEY_CONFIG_HEALTH_ON_BOOT) !== 'false'
        : true;

    const mandatoryItems = this.report.items.filter((i) => i.category === 'mandatory');
    const optionalItems = this.report.items.filter((i) => i.category === 'optional');

    const statusBadgeClass =
      this.report.overallStatus === 'error'
        ? 'badge-health-error'
        : this.report.overallStatus === 'warning'
          ? 'badge-health-warn'
          : 'badge-health-ok';

    const statusTitle =
      this.report.overallStatus === 'error'
        ? 'MANDATORY SETUP NEEDED'
        : this.report.overallStatus === 'warning'
          ? 'SETUP RECOMMENDED'
          : 'ALL SYSTEMS OPERATIONAL';

    this.backdropEl.innerHTML = `
      <div class="nmm-modal-window nmm-modal-l config-health-modal-window" role="dialog" aria-modal="true" aria-labelledby="health-modal-title">
        <header class="nmm-modal-header">
          <div class="nmm-modal-header-title">
            <span class="modal-icon">${ICONS.cpu}</span>
            <h2 id="health-modal-title">System Configuration &amp; Readiness Diagnostic</h2>
            <span class="panel-badge ${statusBadgeClass}">FASE 21 — ${statusTitle}</span>
          </div>
          <button type="button" class="nmm-modal-close" id="btn-health-close" aria-label="Close">
            ${ICONS.close}
          </button>
        </header>

        <div class="nmm-modal-body nmm-modal-scroll-body">
          <!-- Overview Banner -->
          <div class="health-overview-strip">
            <div class="health-metric">
              <span class="metric-val ${this.report.hasMissingMandatory ? 'val-err' : 'val-ok'}">
                ${this.report.mandatoryConfigured} / ${this.report.mandatoryCount}
              </span>
              <span class="metric-lbl">Mandatory Essentials</span>
            </div>
            <div class="health-metric">
              <span class="metric-val ${this.report.hasMissingOptional ? 'val-warn' : 'val-ok'}">
                ${this.report.optionalConfigured} / ${this.report.optionalCount}
              </span>
              <span class="metric-lbl">Optional &amp; AI Accelerators</span>
            </div>
            <div class="health-metric-desc">
              <p>
                ${
                  this.report.hasMissingMandatory
                    ? 'Some core services require configuration before full audio model processing can proceed.'
                    : this.report.hasMissingOptional
                      ? 'Core engine is 100% operational in Pure DSP mode. Connect Companion Bridge or Cloud BYOK to unlock AI features.'
                      : 'All mandatory and optional accelerators are fully configured and ready.'
                }
              </p>
            </div>
          </div>

          <!-- Section 1: Mandatory Components -->
          <div class="health-section">
            <h3 class="health-section-heading">
              <span class="health-sec-icon">${ICONS.check}</span>
              Configuración Obligatoria (Core System)
            </h3>
            <div class="health-card-list">
              ${mandatoryItems
                .map(
                  (item) => `
                <div class="health-item-card ${item.isConfigured ? 'is-ready' : 'is-missing-mandatory'}">
                  <div class="health-item-status-icon">
                    ${item.isConfigured ? ICONS.check : ICONS.alert}
                  </div>
                  <div class="health-item-info">
                    <div class="health-item-head">
                      <strong>${escHtml(item.name)}</strong>
                      <span class="health-pill ${item.isConfigured ? 'pill-ok' : 'pill-err'}">${escHtml(item.statusBadge)}</span>
                    </div>
                    <p class="health-item-desc">${escHtml(item.description)}</p>
                    <div class="health-item-impact">
                      <em>Impact:</em> ${escHtml(item.impactSummary)}
                    </div>
                  </div>
                  <div class="health-item-action">
                    <button type="button" class="btn btn-outline btn-health-config" data-tab="${escAttr(item.targetTab)}">
                      ${item.isConfigured ? 'Edit...' : 'Configure...'}
                    </button>
                  </div>
                </div>
              `
                )
                .join('')}
            </div>
          </div>

          <!-- Section 2: Optional Components -->
          <div class="health-section">
            <h3 class="health-section-heading">
              <span class="health-sec-icon">${ICONS.sparkle}</span>
              Configuración Opcional &amp; Aceleración IA (Recomendado)
            </h3>
            <div class="health-card-list">
              ${optionalItems
                .map(
                  (item) => `
                <div class="health-item-card ${item.isConfigured ? 'is-ready' : 'is-unconfigured-optional'}">
                  <div class="health-item-status-icon">
                    ${item.isConfigured ? ICONS.check : ICONS.sparkle}
                  </div>
                  <div class="health-item-info">
                    <div class="health-item-head">
                      <strong>${escHtml(item.name)}</strong>
                      <span class="health-pill ${item.isConfigured ? 'pill-ok' : 'pill-warn'}">${escHtml(item.statusBadge)}</span>
                    </div>
                    <p class="health-item-desc">${escHtml(item.description)}</p>
                    <div class="health-item-impact">
                      <em>Unlocks:</em> ${escHtml(item.impactSummary)}
                    </div>
                  </div>
                  <div class="health-item-action">
                    <button type="button" class="btn btn-outline btn-health-config" data-tab="${escAttr(item.targetTab)}">
                      ${item.isConfigured ? 'Manage...' : 'Set Up...'}
                    </button>
                  </div>
                </div>
              `
                )
                .join('')}
            </div>
          </div>
        </div>

        <footer class="nmm-modal-footer">
          <label class="health-boot-chk">
            <input type="checkbox" id="chk-health-boot" ${showOnBoot ? 'checked' : ''} />
            <span>Show diagnostic on startup when components are unconfigured</span>
          </label>
          <div class="footer-right">
            <button type="button" class="btn btn-outline" id="btn-health-open-settings">
              ${ICONS.settings} Open Full Preferences
            </button>
            <button type="button" class="btn btn-primary" id="btn-health-continue">
              Continue to MODELmaker
            </button>
          </div>
        </footer>
      </div>
    `;

    if (!this.focusTrap && this.backdropEl) {
      this.focusTrap = createModalFocusTrap(this.backdropEl, {
        onEscape: () => this.close(),
        initialFocusSelector: '#btn-health-continue',
      });
      this.focusTrap.activate();
    }

    this.bindEvents();
  }

  private bindEvents(): void {
    if (!this.backdropEl) return;

    this.backdropEl.querySelector('#btn-health-close')?.addEventListener('click', () => this.close());
    this.backdropEl.querySelector('#btn-health-continue')?.addEventListener('click', () => this.close());

    this.backdropEl.querySelector('#btn-health-open-settings')?.addEventListener('click', () => {
      this.close();
      this.context.onOpenSettings('general');
    });

    // Checkbox for boot diagnostic
    const chkBoot = this.backdropEl.querySelector<HTMLInputElement>('#chk-health-boot');
    chkBoot?.addEventListener('change', () => {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY_CONFIG_HEALTH_ON_BOOT, chkBoot.checked ? 'true' : 'false');
      }
    });

    // Individual configure buttons
    this.backdropEl.querySelectorAll<HTMLButtonElement>('.btn-health-config[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab') as SettingsModalTab;
        this.close();
        this.context.onOpenSettings(tab || 'general');
      });
    });
  }
}
