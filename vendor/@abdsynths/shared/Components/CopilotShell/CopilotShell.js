// ─────────────────────────────────────────────────────────
// ABDShared — CopilotShell UI Component
// Chameleon Docked <-> Overlay right panel + Quick Command Bar (Ctrl+K)
// Collapsible right rail with chevron toggle
// ─────────────────────────────────────────────────────────

import { renderSafeCopilotMarkdown } from './copilotMarkdown.js';
import { highlightUiTarget, clearUiHighlight } from './uiSpotlight.js';
import { CONTROL_ICONS } from '../icons.js';

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
    this.kbArticles = options.kbArticles || [];
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

  initDom() {
    if (!this.container) return;
    this.container.innerHTML = `
      <div class="abd-copilot-container ${this.isCollapsed ? 'is-collapsed-rail' : ''}" id="abd-copilot-panel">
        <!-- Collapsed Rail View -->
        <div class="abd-copilot-rail ${this.isCollapsed ? '' : 'is-hidden'}" id="abd-copilot-rail">
          <button type="button" class="abd-copilot-rail-btn" id="btn-copilot-expand-rail" title="Expandir Asistente">
            ${CHEVRON_LEFT_SVG}
          </button>
          <div class="abd-copilot-rail-label">ASISTENTE</div>
        </div>

        <!-- Expanded Full View -->
        <div class="abd-copilot-full-wrap ${this.isCollapsed ? 'is-hidden' : ''}" id="abd-copilot-full-wrap">
          <div class="abd-copilot-header">
            <div class="abd-copilot-tabs">
              <button type="button" class="abd-copilot-tab-btn is-active" data-tab="assistant">Asistente</button>
              <button type="button" class="abd-copilot-tab-btn" data-tab="manual">Manual</button>
              <button type="button" class="abd-copilot-tab-btn" data-tab="log">Registro</button>
            </div>
            <div class="abd-copilot-actions">
              <button type="button" class="abd-copilot-icon-btn" id="btn-copilot-collapse" title="Colapsar hacia la derecha">
                ${CHEVRON_RIGHT_SVG}
              </button>
              <button type="button" class="abd-copilot-icon-btn" id="btn-copilot-pin" title="Fijar modo flotante">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v10m0 0l4-4m-4 4L8 8m-4 8h16"/></svg>
              </button>
              <button type="button" class="abd-copilot-icon-btn" id="btn-copilot-close" title="Cerrar panel">
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
                <textarea id="copilot-input-text" placeholder="Haz una consulta o escribe un comando..."></textarea>
                <button type="button" id="copilot-btn-send">Enviar</button>
              </div>
            </div>
            <div id="abd-copilot-tab-manual" class="abd-copilot-tab-content is-hidden">
              <input type="text" id="copilot-manual-search" placeholder="Buscar en el manual (BM25)..." />
              <div id="copilot-manual-results" class="copilot-manual-list"></div>
            </div>
            <div id="abd-copilot-tab-log" class="abd-copilot-tab-content is-hidden">
              <div class="copilot-log-actions">
                <button type="button" class="abd-copilot-btn-secondary" id="btn-copilot-undo-last">Deshacer ultima accion</button>
                <button type="button" class="abd-copilot-btn-secondary" id="btn-copilot-clear-log">Limpiar registro</button>
              </div>
              <div id="copilot-log-entries" class="copilot-log-list"></div>
            </div>
          </div>
        </div>
      </div>
    `;
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
        if (spotId) highlightUiTarget(spotId);
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
    const model = state.modelName || 'Ninguno';
    const zoneCount = state.zoneCount || 0;
    const audioF0 = audio.detectedF0Hz ? `${Math.round(audio.detectedF0Hz)} Hz` : 'N/A';
    const ins = audio.instrumentClass || 'Synth & Neutral';

    el.innerHTML = `
      <div class="copilot-hud-row">
        <span class="copilot-hud-label">Modelo:</span>
        <span class="copilot-hud-val"><span class="abd-copilot-spot-chip" data-spot-target="process-model-name">${model}</span></span>
        <span class="copilot-hud-label">Zonas:</span>
        <span class="copilot-hud-val">${zoneCount}</span>
      </div>
      <div class="copilot-hud-row">
        <span class="copilot-hud-label">F0 detectado:</span>
        <span class="copilot-hud-val">${audioF0}</span>
        <span class="copilot-hud-label">Instrumento:</span>
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
      this.appendChatMessage('assistant', 'Modo sin IA activo. Puedes consultar el manual en la pestaña correspondiente o realizar comandos directos.');
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
        <div class="copilot-proposed-title">Accion sugerida: <strong>${action.actionName || action.tool}</strong></div>
        <div class="copilot-proposed-desc">${renderSafeCopilotMarkdown(action.description || action.label || 'Deseas ejecutar esta operacion?')}</div>
        <div class="copilot-proposed-btns">
          <button type="button" class="abd-copilot-btn-primary" id="btn-copilot-action-exec">Ejecutar</button>
          <button type="button" class="abd-copilot-btn-secondary" id="btn-copilot-action-cancel">Descartar</button>
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
          this.appendChatMessage('assistant', `Accion completada: ${act.actionName || act.tool}. ${res?.summary || res?.message || ''}`);
          this.refreshDeterministicHud();
        } catch (err) {
          this.appendChatMessage('assistant', `Fallo al ejecutar accion: ${err.message || String(err)}`);
        }
      }
    });

    area.querySelector('#btn-copilot-action-cancel')?.addEventListener('click', () => {
      this.pendingAction = null;
      area.innerHTML = '';
      this.appendChatMessage('assistant', 'Accion descartada por el usuario.');
    });
  }

  searchManual(query) {
    const resEl = this.container?.querySelector('#copilot-manual-results');
    if (!resEl) return;
    const q = (query || '').toLowerCase().trim();
    const articles = this.kbArticles || [];
    const matched = !q
      ? articles
      : articles.filter((a) => (a.title + ' ' + (a.tags || a.keywords || []).join(' ') + ' ' + (a.whatItMeans || a.content || '')).toLowerCase().includes(q));

    if (matched.length === 0) {
      resEl.innerHTML = '<div class="copilot-empty">No se encontraron articulos en el manual.</div>';
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
      el.innerHTML = '<div class="copilot-empty">Sin eventos registrados.</div>';
      return;
    }
    el.innerHTML = this.logEntries.map((e) => `<div class="copilot-log-row">${renderSafeCopilotMarkdown(e)}</div>`).join('');
  }
}
