// ─────────────────────────────────────────────────────────
// ABDShared — CopilotShell UI Component
// Chameleon Docked <-> Overlay right panel + Quick Command Bar (Ctrl+K)
// Collapsible right rail with chevron toggle
// ─────────────────────────────────────────────────────────

import { renderSafeCopilotMarkdown } from './copilotMarkdown.js';
import { highlightUiTarget, clearUiHighlight } from './uiSpotlight.js';
import { CONTROL_ICONS } from '../icons.js';
import { SHARED_LOCALES } from '../I18n/index.js';

const CHEVRON_RIGHT_SVG = (CONTROL_ICONS && CONTROL_ICONS.chevronRight) || `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
const CHEVRON_LEFT_SVG = (CONTROL_ICONS && CONTROL_ICONS.chevronLeft) || `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;

export class CopilotShell {
  constructor(options = {}) {
    this.container = options.container;
    this.hostShellEl = options.hostShellEl || (typeof document !== 'undefined' ? document.getElementById('app-shell') : null);
    this.modalsRootEl = options.modalsRootEl || (typeof document !== 'undefined' ? document.getElementById('modals-container') : null);
    this.dockMinViewportWidth = options.dockMinViewportWidth || 1550;
    this.orchestrator = options.orchestrator || null;
    this.getHostContext = options.getHostContext || (() => ({}));
    this.onUndoLastAction = options.onUndoLastAction || (async () => ({ ok: false }));
    this.onExecuteAction = options.onExecuteAction || (async () => ({ ok: false }));
    this.onNavigateTarget = options.onNavigateTarget || null;
    this.kbArticles = options.kbArticles || [];
    this.i18n = options.i18n || (typeof window !== 'undefined' && window.__audiolab_i18n ? window.__audiolab_i18n : null);
    this.activeTab = 'assistant'; // 'assistant' | 'manual' | 'log'
    this.pinnedFloating = false;
    this.isOpen = true;
    this.isCollapsed = false; // Collapsed rail view (towards right)
    this.pendingAction = null;
    this.logEntries = [];

    if (this.container) {
      this.initDom();
      this.setupListeners();
      this.updateLayoutMode();
      this.refreshDeterministicHud();
    }
  }

  t(key, fallback = '') {
    if (this.i18n && typeof this.i18n.t === 'function') {
      const res = this.i18n.t(key);
      if (res && res !== key) return res;
    }
    // Fallback directly to SHARED_LOCALES using window.__audiolab_i18n or localStorage
    let loc = 'es';
    try {
      if (this.i18n && typeof this.i18n.getLocale === 'function') loc = this.i18n.getLocale();
      else if (typeof localStorage !== 'undefined') loc = localStorage.getItem('abdaudiolab.locale') || localStorage.getItem('abdsynths.locale') || 'es';
    } catch (_) {}
    const dict = SHARED_LOCALES[loc] || SHARED_LOCALES.es;
    const parts = key.split('.');
    let cur = dict;
    for (const p of parts) {
      if (cur && typeof cur === 'object' && p in cur) cur = cur[p];
      else { cur = null; break; }
    }
    if (typeof cur === 'string') return cur;
    return fallback || key;
  }

  initDom() {
    if (!this.container) return;
    this.container.innerHTML = `
      <div class="abd-copilot-container ${this.isCollapsed ? 'is-collapsed-rail' : ''}" id="abd-copilot-panel">
        <!-- Collapsed Rail View -->
        <div class="abd-copilot-rail ${this.isCollapsed ? '' : 'is-hidden'}" id="abd-copilot-rail">
          <button type="button" class="abd-copilot-rail-btn" id="btn-copilot-expand-rail" title="${this.t('copilot.expandRail', 'Expandir Asistente')}">
            ${CHEVRON_LEFT_SVG}
          </button>
          <div class="abd-copilot-rail-label" id="copilot-rail-label">${this.t('copilot.railLabel', 'ASISTENTE')}</div>
        </div>

        <!-- Expanded Full View -->
        <div class="abd-copilot-full-wrap ${this.isCollapsed ? 'is-hidden' : ''}" id="abd-copilot-full-wrap">
          <div class="abd-copilot-header">
            <div class="abd-copilot-tabs">
              <button type="button" class="abd-copilot-tab-btn is-active" data-tab="assistant" id="tab-btn-assistant">${this.t('copilot.tabAssistant', 'Asistente')}</button>
              <button type="button" class="abd-copilot-tab-btn" data-tab="manual" id="tab-btn-manual">${this.t('copilot.tabManual', 'Manual')}</button>
              <button type="button" class="abd-copilot-tab-btn" data-tab="log" id="tab-btn-log">${this.t('copilot.tabLog', 'Registro')}</button>
            </div>
            <div class="abd-copilot-actions">
              <button type="button" class="abd-copilot-icon-btn" id="btn-copilot-collapse" title="${this.t('copilot.collapse', 'Colapsar hacia la derecha')}">
                ${CHEVRON_RIGHT_SVG}
              </button>
              <button type="button" class="abd-copilot-icon-btn" id="btn-copilot-pin" title="${this.t('copilot.pin', 'Fijar modo flotante')}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v10m0 0l4-4m-4 4L8 8m-4 8h16"/></svg>
              </button>
              <button type="button" class="abd-copilot-icon-btn" id="btn-copilot-close" title="${this.t('copilot.close', 'Cerrar panel')}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
          </div>
          <div class="abd-copilot-body" id="abd-copilot-body">
            <div id="abd-copilot-tab-assistant" class="abd-copilot-tab-content">
              <div id="copilot-deterministic-status" class="copilot-card"></div>
              <div id="copilot-chat-stream" class="copilot-chat-history"></div>
              <div id="copilot-proposed-action-area"></div>
              <div id="copilot-zero-chips" class="copilot-chips-row"></div>
              <div class="copilot-input-row">
                <textarea id="copilot-input-text" placeholder="${this.t('copilot.inputPlaceholder', 'Haz una consulta o escribe un comando...')}"></textarea>
                <button type="button" id="copilot-btn-send">${this.t('copilot.send', 'Enviar')}</button>
              </div>
            </div>
            <div id="abd-copilot-tab-manual" class="abd-copilot-tab-content is-hidden">
              <input type="text" id="copilot-manual-search" placeholder="${this.t('copilot.searchManualPlaceholder', 'Buscar en el manual (BM25)...')}" />
              <div id="copilot-manual-results" class="copilot-manual-list"></div>
            </div>
            <div id="abd-copilot-tab-log" class="abd-copilot-tab-content is-hidden">
              <div class="copilot-log-actions">
                <button type="button" class="abd-copilot-btn-secondary" id="btn-copilot-undo-last">${this.t('copilot.undoLastAction', 'Deshacer última acción')}</button>
                <button type="button" class="abd-copilot-btn-secondary" id="btn-copilot-clear-log">${this.t('copilot.clearLog', 'Limpiar registro')}</button>
              </div>
              <div id="copilot-log-entries" class="copilot-log-list"></div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  applyI18n() {
    const panel = this.container?.querySelector('#abd-copilot-panel');
    if (!panel) return;

    const expandBtn = panel.querySelector('#btn-copilot-expand-rail');
    if (expandBtn) expandBtn.title = this.t('copilot.expandRail', 'Expandir Asistente');

    const railLabel = panel.querySelector('#copilot-rail-label');
    if (railLabel) railLabel.textContent = this.t('copilot.railLabel', 'ASISTENTE');

    const tabAssistant = panel.querySelector('#tab-btn-assistant');
    if (tabAssistant) tabAssistant.textContent = this.t('copilot.tabAssistant', 'Asistente');

    const tabManual = panel.querySelector('#tab-btn-manual');
    if (tabManual) tabManual.textContent = this.t('copilot.tabManual', 'Manual');

    const tabLog = panel.querySelector('#tab-btn-log');
    if (tabLog) tabLog.textContent = this.t('copilot.tabLog', 'Registro');

    const collapseBtn = panel.querySelector('#btn-copilot-collapse');
    if (collapseBtn) collapseBtn.title = this.t('copilot.collapse', 'Colapsar hacia la derecha');

    const pinBtn = panel.querySelector('#btn-copilot-pin');
    if (pinBtn) pinBtn.title = this.t('copilot.pin', 'Fijar modo flotante');

    const closeBtn = panel.querySelector('#btn-copilot-close');
    if (closeBtn) closeBtn.title = this.t('copilot.close', 'Cerrar panel');

    const inputArea = panel.querySelector('#copilot-input-text');
    if (inputArea) inputArea.placeholder = this.t('copilot.inputPlaceholder', 'Haz una consulta o escribe un comando...');

    const sendBtn = panel.querySelector('#copilot-btn-send');
    if (sendBtn) sendBtn.textContent = this.t('copilot.send', 'Enviar');

    const manualInput = panel.querySelector('#copilot-manual-search');
    if (manualInput) manualInput.placeholder = this.t('copilot.searchManualPlaceholder', 'Buscar en el manual (BM25)...');

    const undoBtn = panel.querySelector('#btn-copilot-undo-last');
    if (undoBtn) undoBtn.textContent = this.t('copilot.undoLastAction', 'Deshacer última acción');

    const clearLogBtn = panel.querySelector('#btn-copilot-clear-log');
    if (clearLogBtn) clearLogBtn.textContent = this.t('copilot.clearLog', 'Limpiar registro');

    this.refreshDeterministicHud();
    if (this.activeTab === 'manual') {
      this.searchManual(manualInput?.value || '');
    } else if (this.activeTab === 'log') {
      this.renderLogEntries();
    }
  }

  setupListeners() {
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => this.updateLayoutMode());
    }
    if (this.modalsRootEl && typeof MutationObserver !== 'undefined') {
      const obs = new MutationObserver(() => this.updateLayoutMode());
      obs.observe(this.modalsRootEl, { childList: true, subtree: true, attributes: true });
    }

    const panel = this.container?.querySelector('#abd-copilot-panel');
    if (!panel) return;

    // Tabs
    panel.querySelectorAll('.abd-copilot-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        if (tab) this.setActiveTab(tab);
      });
    });

    // Close, pin and collapse
    panel.querySelector('#btn-copilot-close')?.addEventListener('click', () => this.toggle(false));
    panel.querySelector('#btn-copilot-collapse')?.addEventListener('click', () => this.setCollapsed(true));
    panel.querySelector('#btn-copilot-expand-rail')?.addEventListener('click', () => this.setCollapsed(false));

    panel.querySelector('#btn-copilot-pin')?.addEventListener('click', () => {
      this.pinnedFloating = !this.pinnedFloating;
      panel.querySelector('#btn-copilot-pin')?.classList.toggle('is-pinned', this.pinnedFloating);
      this.updateLayoutMode();
    });

    // Spotlight clicks
    panel.addEventListener('click', (e) => {
      const target = e.target.closest('.abd-copilot-spot-chip');
      if (target) {
        const spotId = target.getAttribute('data-spot-target');
        if (spotId) {
          highlightUiTarget(spotId);
          if (typeof this.onNavigateTarget === 'function') {
            this.onNavigateTarget(spotId);
          } else if (typeof document !== 'undefined') {
            const el = document.querySelector(`[data-ai-target="${CSS.escape(spotId)}"]`);
            if (el && typeof el.click === 'function') {
              el.click();
            }
          }
        }
      }
    });

    panel.addEventListener('mouseover', (e) => {
      const target = e.target.closest('.abd-copilot-spot-chip');
      if (target) {
        const spotId = target.getAttribute('data-spot-target');
        if (spotId) highlightUiTarget(spotId, 1800);
      }
    });

    // Chat submit
    const sendBtn = panel.querySelector('#copilot-btn-send');
    const inputArea = panel.querySelector('#copilot-input-text');
    const handleSend = () => {
      const text = inputArea?.value?.trim();
      if (!text) return;
      if (inputArea) inputArea.value = '';
      this.sendMessage(text);
    };

    sendBtn?.addEventListener('click', handleSend);
    inputArea?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });

    // Manual search
    const manualInput = panel.querySelector('#copilot-manual-search');
    manualInput?.addEventListener('input', () => {
      this.searchManual(manualInput.value);
    });

    // Log undo
    panel.querySelector('#btn-copilot-undo-last')?.addEventListener('click', async () => {
      const res = await this.onUndoLastAction();
      if (res && res.message) {
        this.addLogEntry(`Deshacer: ${res.message}`);
      }
      this.refreshDeterministicHud();
    });

    panel.querySelector('#btn-copilot-clear-log')?.addEventListener('click', () => {
      this.logEntries = [];
      this.renderLogEntries();
    });
  }

  setCollapsed(collapsed) {
    this.isCollapsed = Boolean(collapsed);
    const panel = this.container?.querySelector('#abd-copilot-panel');
    const rail = this.container?.querySelector('#abd-copilot-rail');
    const full = this.container?.querySelector('#abd-copilot-full-wrap');

    if (panel) {
      panel.classList.toggle('is-collapsed-rail', this.isCollapsed);
    }
    if (rail) {
      rail.classList.toggle('is-hidden', !this.isCollapsed);
    }
    if (full) {
      full.classList.toggle('is-hidden', this.isCollapsed);
    }

    if (this.hostShellEl) {
      if (this.isCollapsed) {
        this.hostShellEl.setAttribute('data-copilot-collapsed', 'true');
      } else {
        this.hostShellEl.removeAttribute('data-copilot-collapsed');
      }
    }
    this.updateLayoutMode();
  }

  updateLayoutMode() {
    const panel = this.container?.querySelector('#abd-copilot-panel');
    if (!panel) return;

    let isModalOpen = false;
    if (this.modalsRootEl) {
      const modalActive = this.modalsRootEl.querySelector('.modal-backdrop:not(.is-hidden), [role="dialog"]');
      isModalOpen = Boolean(modalActive);
    }

    const isNarrow = typeof window !== 'undefined' ? window.innerWidth < this.dockMinViewportWidth : false;
    const shouldOverlay = this.pinnedFloating || isNarrow || isModalOpen;

    if (shouldOverlay) {
      panel.classList.add('is-overlay');
      this.hostShellEl?.removeAttribute('data-copilot-docked');
    } else {
      panel.classList.remove('is-overlay');
      this.hostShellEl?.setAttribute('data-copilot-docked', 'true');
    }
  }

  setActiveTab(tab) {
    this.activeTab = tab;
    const panel = this.container?.querySelector('#abd-copilot-panel');
    if (!panel) return;
    panel.querySelectorAll('.abd-copilot-tab-btn').forEach((btn) => {
      btn.classList.toggle('is-active', btn.getAttribute('data-tab') === tab);
    });
    panel.querySelectorAll('.abd-copilot-tab-content').forEach((sec) => {
      sec.classList.toggle('is-hidden', sec.id !== `abd-copilot-tab-${tab}`);
    });
    if (tab === 'manual') {
      this.searchManual(panel.querySelector('#copilot-manual-search')?.value || '');
    } else if (tab === 'log') {
      this.renderLogEntries();
    }
  }

  toggle(force) {
    this.isOpen = typeof force === 'boolean' ? force : !this.isOpen;
    if (this.container) {
      this.container.style.display = this.isOpen ? '' : 'none';
    }
    if (this.isOpen && this.isCollapsed) {
      this.setCollapsed(false);
    }
    this.updateLayoutMode();
  }

  refreshDeterministicHud() {
    const el = this.container?.querySelector('#copilot-deterministic-status');
    if (!el) return;
    const ctx = this.getHostContext ? this.getHostContext() : {};
    const state = ctx.stateSnapshot || {};
    const audio = ctx.acousticSnapshot || {};
    const model = state.modelName || this.t('copilot.none', 'Ninguno');
    const zoneCount = state.zoneCount || 0;
    const audioF0 = audio.detectedF0Hz ? `${Math.round(audio.detectedF0Hz)} Hz` : 'N/A';
    const ins = audio.instrumentClass || 'Synth & Neutral';

    el.innerHTML = `
      <div class="copilot-hud-row">
        <span class="copilot-hud-label">${this.t('copilot.modelLabel', 'Modelo:')}</span>
        <span class="copilot-hud-val"><span class="abd-copilot-spot-chip" data-spot-target="process-model-name">${model}</span></span>
        <span class="copilot-hud-label">${this.t('copilot.zonesLabel', 'Zonas:')}</span>
        <span class="copilot-hud-val">${zoneCount}</span>
      </div>
      <div class="copilot-hud-row">
        <span class="copilot-hud-label">${this.t('copilot.f0Label', 'F0 detectado:')}</span>
        <span class="copilot-hud-val">${audioF0}</span>
        <span class="copilot-hud-label">${this.t('copilot.instrumentLabel', 'Instrumento:')}</span>
        <span class="copilot-hud-val">${ins}</span>
      </div>
    `;

    // Suggested Chips
    const chipsEl = this.container?.querySelector('#copilot-zero-chips');
    if (chipsEl && ctx.suggestedPrompts) {
      chipsEl.innerHTML = ctx.suggestedPrompts.map((p) => `
        <button type="button" class="copilot-chip-btn">${renderSafeCopilotMarkdown(p)}</button>
      `).join('');
      chipsEl.querySelectorAll('.copilot-chip-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.sendMessage(btn.textContent.trim());
        });
      });
    }
  }

  appendChatMessage(role, content) {
    const stream = this.container?.querySelector('#copilot-chat-stream');
    if (!stream) return;
    const msgEl = document.createElement('div');
    msgEl.className = `copilot-msg copilot-msg-${role}`;
    msgEl.innerHTML = renderSafeCopilotMarkdown(content);
    stream.appendChild(msgEl);
    stream.scrollTop = stream.scrollHeight;
  }

  async sendMessage(text) {
    this.appendChatMessage('user', text);
    this.addLogEntry(`Consulta: ${text}`);

    if (!this.orchestrator) {
      this.appendChatMessage('assistant', this.t('copilot.noAiModeMessage', 'Modo sin IA activo. Puedes consultar el manual en la pestaña correspondiente o realizar comandos directos.'));
      return;
    }

    const hostCtx = this.getHostContext ? this.getHostContext() : {};
    try {
      const response = this.orchestrator.processTurn
        ? await this.orchestrator.processTurn(text, hostCtx)
        : await this.orchestrator.handlePrompt(text, hostCtx);

      const reply = response.reply || response.replyText;
      if (reply) {
        this.appendChatMessage('assistant', reply);
      }
      if (Array.isArray(response.highlightTargets)) {
        for (const targetId of response.highlightTargets) {
          highlightUiTarget(targetId);
        }
      }
      const actions = response.proposedActions || (response.proposedAction ? [response.proposedAction] : []);
      if (actions.length > 0) {
        for (const action of actions) {
          this.renderProposedAction(action);
        }
      }
    } catch (err) {
      this.appendChatMessage('assistant', `Error en consulta: ${err.message || String(err)}`);
    }
  }

  renderProposedAction(action) {
    const area = this.container?.querySelector('#copilot-proposed-action-area');
    if (!area) return;
    this.pendingAction = action;

    area.innerHTML = `
      <div class="copilot-proposed-card">
        <div class="copilot-proposed-title">${this.t('copilot.suggestedAction', 'Acción sugerida:')} <strong>${action.actionName || action.tool}</strong></div>
        <div class="copilot-proposed-desc">${renderSafeCopilotMarkdown(action.description || action.label || 'Deseas ejecutar esta operacion?')}</div>
        <div class="copilot-proposed-btns">
          <button type="button" class="abd-copilot-btn-primary" id="btn-copilot-action-exec">${this.t('copilot.execute', 'Ejecutar')}</button>
          <button type="button" class="abd-copilot-btn-secondary" id="btn-copilot-action-cancel">${this.t('copilot.dismiss', 'Descartar')}</button>
        </div>
      </div>
    `;

    area.querySelector('#btn-copilot-action-exec')?.addEventListener('click', async () => {
      const act = this.pendingAction;
      this.pendingAction = null;
      area.innerHTML = '';
      if (act && this.onExecuteAction) {
        this.addLogEntry(`Ejecutando accion: ${act.actionName || act.tool}`);
        try {
          const res = await this.onExecuteAction(act);
          this.appendChatMessage('assistant', `${this.t('copilot.actionExecuted', 'Acción completada:')} ${act.actionName || act.tool}. ${res?.summary || res?.message || ''}`);
          this.refreshDeterministicHud();
        } catch (err) {
          this.appendChatMessage('assistant', `Fallo al ejecutar accion: ${err.message || String(err)}`);
        }
      }
    });

    area.querySelector('#btn-copilot-action-cancel')?.addEventListener('click', () => {
      this.pendingAction = null;
      area.innerHTML = '';
      this.appendChatMessage('assistant', this.t('copilot.actionDismissed', 'Acción descartada por el usuario.'));
    });
  }

  searchManual(query) {
    const resEl = this.container?.querySelector('#copilot-manual-results');
    if (!resEl) return;
    const norm = (str) => String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const stopWords = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'al', 'en', 'con', 'por', 'para', 'que', 'como', 'mi', 'tu', 'su', 'es', 'son', 'the', 'is', 'in', 'to', 'for', 'of', 'how', 'what']);
    const qRaw = norm(query).trim();
    const qTokens = (qRaw.match(/[a-z0-9_]{2,}/g) || []).filter((w) => !stopWords.has(w));
    const articles = this.kbArticles || [];

    let matched = articles;
    if (qRaw) {
      const terms = qTokens.length > 0 ? qTokens : [qRaw];
      const scored = articles.map((a) => {
        const titleNorm = norm(a.title);
        const tagsNorm = norm((a.tags || a.keywords || []).join(' '));
        const bodyNorm = norm((a.whatItMeans || a.content || '') + ' ' + (a.howToFixSteps || []).join(' '));
        let score = 0;
        for (const t of terms) {
          const stem = t.length > 4 ? t.replace(/(ciones|ando|iendo|ar|er|ir|es|s|o|a|e)$/, '') : t;
          if (titleNorm.includes(t) || (stem.length >= 4 && titleNorm.includes(stem))) score += 3;
          if (tagsNorm.includes(t) || (stem.length >= 4 && tagsNorm.includes(stem))) score += 2.5;
          if (bodyNorm.includes(t) || (stem.length >= 4 && bodyNorm.includes(stem))) score += 1;
        }
        return { a, score };
      });
      matched = scored.filter((item) => item.score > 0).sort((x, y) => y.score - x.score).map((item) => item.a);
    }

    if (matched.length === 0) {
      resEl.innerHTML = `<div class="copilot-empty">${this.t('copilot.noManualArticles', 'No se encontraron artículos en el manual.')}</div>`;
      return;
    }

    resEl.innerHTML = matched.map((a) => {
      const stepsHtml = Array.isArray(a.howToFixSteps) && a.howToFixSteps.length > 0
        ? `<div class="copilot-manual-steps">${a.howToFixSteps.map((s) => `<div class="copilot-manual-step-item"><span>•</span><span>${renderSafeCopilotMarkdown(s)}</span></div>`).join('')}</div>`
        : '';
      const chipHtml = Array.isArray(a.uiTargets) && a.uiTargets.length > 0
        ? a.uiTargets.map((t) => `<button type="button" class="abd-copilot-spot-chip" data-spot-target="${t.targetId}">${t.label}</button>`).join(' ')
        : '';

      return `
        <div class="copilot-manual-card">
          <div class="copilot-manual-title">${renderSafeCopilotMarkdown(a.title)}</div>
          <div class="copilot-manual-snippet">${renderSafeCopilotMarkdown(a.whatItMeans || (a.content ? a.content.slice(0, 160) : ''))}</div>
          ${stepsHtml}
          ${chipHtml ? `<div style="margin-top:6px;">${chipHtml}</div>` : ''}
        </div>
      `;
    }).join('');
  }

  addLogEntry(entry) {
    const timestamp = new Date().toLocaleTimeString();
    this.logEntries.unshift(`[${timestamp}] ${entry}`);
    if (this.logEntries.length > 50) this.logEntries.pop();
    if (this.activeTab === 'log') {
      this.renderLogEntries();
    }
  }

  renderLogEntries() {
    const el = this.container?.querySelector('#copilot-log-entries');
    if (!el) return;
    if (this.logEntries.length === 0) {
      el.innerHTML = `<div class="copilot-empty">${this.t('copilot.noLogEntries', 'Sin eventos registrados.')}</div>`;
      return;
    }
    el.innerHTML = this.logEntries.map((e) => `<div class="copilot-log-row">${renderSafeCopilotMarkdown(e)}</div>`).join('');
  }
}
