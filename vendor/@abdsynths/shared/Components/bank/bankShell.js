import { escAttr, escText } from '../../Utils/escape.js';
/**
 * bankShell — carcasa presentacional del navegador de bancos NeuronDB
 * (paquete compartido).
 * ======================================================================
 *
 * La carcasa no sabe qué enseña: pinta cabecera (título, distintivo,
 * acciones), buscador, pastillas de pestaña, una fila extra opcional
 * (el host la rellena: categorías, resynator destino...), el contenedor
 * del contenido y el pie. El host pinta rejillas con `bankCard.js` y
 * decide qué significa cada gesto. Montaje y visibilidad son del host
 * (clases propias o un DrawerManager): la carcasa expone su `element`.
 *
 * Contrato de avisos: solo transiciones de pestaña/búsqueda/acciones.
 * `setTab()` programático no reavisa; el click en pastilla sí
 * (`onTabChange`). Igual que `createDrawer`: los avisos no son
 * intenciones.
 *
 * Usage:
 *   const shell = createBankShell({
 *     title: 'NEURONDB BANK BROWSER',
 *     tabs: [{ id: 'models', label: 'MODELS' }, { id: 'library', label: 'LIBRARY' }],
 *     onTabChange: (tab) => render(tab),
 *     onSearch: (q) => render(shell.activeTab),
 *     onClose: () => host.close(),
 *   });
 *   mount.appendChild(shell.element);
 *   toolbarEl.appendChild(myChips); footerEl.innerHTML = myFooter;
 *
 * @param {object} options
 * @param {string} [options.title] título de la cabecera.
 * @param {string} [options.badge] distintivo inicial.
 * @param {Array<{ id: string, label: string, iconHtml?: string }>} [options.tabs]
 * @param {string} [options.activeTab] pestaña inicial (default: primera).
 * @param {string} [options.searchPlaceholder] texto del buscador.
 * @param {Array<{ id: string, label: string, title?: string, iconHtml?: string }>} [options.headerActions]
 *   botones de la cabecera (p. ej. limpiar, configurar, cerrar).
 * @param {Array<{ id: string, label: string, title?: string, kind?: string }>} [options.footerActions]
 *   botones del pie (p. ej. refrescar, carpeta, cerrar). También los sirve
 *   `onFooterAction` por `id`; el pie lo pinta la carcasa para que no haya
 *   dos implementaciones en los hosts.
 * @param {Function} [options.onTabChange] `(tabId)`.
 * @param {Function} [options.onSearch] `(query)`.
 * @param {Function} [options.onHeaderAction] `(actionId)`.
 * @param {Function} [options.onFooterAction] `(actionId)` para `[data-footer-action]`.
 * @param {Function} [options.onClose] atajo de cierre (además del botón si lo hay).
 * @returns {{ element: HTMLElement, contentEl: HTMLElement, toolbarEl: HTMLElement,
 *             footerEl: HTMLElement, activeTab: string, setBadge: Function,
 *             setTab: Function, setTabVisible: Function, getQuery: Function,
 *             flashStatus: Function, setFootSlot: Function, setFooterStatus: Function,
 *             setBusy: Function, destroy: Function }}
 *
 * Aviso efímero centrado (`flashStatus`): el único feedback garantizado
 * para acciones que no cambian contadores (p. ej. refrescar con los
 * mismos datos). Vive sobre el pie, se auto-oculta y no depende de que
 * el usuario mire el pie: `ok` 3.5s, `working` 4s, `error` 6s.
 * Píldora sólida de alto contraste con icono por tipo.
 */
export function createBankShell (options = {})
{
  const {
    title = 'NEURONDB BANK BROWSER',
    badge = '',
    tabs = [],
    activeTab = (tabs[0] && tabs[0].id) || 'models',
    searchPlaceholder = 'Search by name or slot...',
    headerActions = [],
    footerActions = [],
    onTabChange = null,
    onSearch = null,
    onHeaderAction = null,
    onFooterAction = null,
    onClose = null,
  } = options;

  const state = { tab: activeTab, query: '' };
  const aborter = new AbortController();
  let flashTimer = null;
  const on = (el, type, fn) => el.addEventListener(type, fn, { signal: aborter.signal });

  const element = document.createElement('div');
  element.className = 'bank-drawer-panel';
  element.innerHTML = `
      <div class="drawer-header ndb-modal-header">
        <div class="drawer-title ndb-header-title">
          <span class="drawer-icon" data-shell-icon></span>
          <span class="ndb-title-text">${escText(title)}</span>
          <span class="panel-badge ndb-badge" data-shell-badge>${escText(badge)}</span>
        </div>
        <div class="drawer-header-actions">
          ${headerActions.map((a) => `
          <button type="button" class="btn btn-close-drawer ndb-close-btn" data-header-action="${escAttr(a.id)}" title="${escAttr(a.title || a.label || '')}">${a.iconHtml || escText(a.label || '')}</button>`).join('')}
        </div>
      </div>
      <div class="ndb-search-row">
        <span class="ndb-search-icon" data-shell-search-icon></span>
        <input
          type="text"
          class="ndb-search-input"
          data-shell-search
          placeholder="${escAttr(searchPlaceholder)}"
          autocomplete="off"
          spellcheck="false"
          aria-label="Search bank"
        />
      </div>
      <div class="ndb-chips-row" data-shell-tabs role="tablist" aria-label="Bank tabs">
        ${tabs.map((t) => `
        <button type="button" role="tab" aria-selected="${t.id === state.tab ? 'true' : 'false'}" class="ndb-chip ${t.id === state.tab ? 'active' : ''}" data-shell-tab="${escAttr(t.id)}">
          ${t.iconHtml ? `<span class="ndb-chip-icon">${t.iconHtml}</span>` : ''}
          <span class="ndb-chip-name">${escText(t.label)}</span>
          <span class="ndb-chip-count" data-shell-tab-count="${escAttr(t.id)}">0</span>
        </button>`).join('')}
      </div>
      <div data-shell-toolbar></div>
      <div class="ndb-content-wrap" data-shell-content tabindex="0"></div>
      <div class="ndb-footer" data-shell-footer>
        <div class="ndb-footer-selection">
          <span class="ndb-footer-slot" data-shell-foot-slot></span>
          <span class="ndb-footer-details" data-shell-foot-status></span>
        </div>
        <div class="neurondb-footer-actions">
          ${footerActions.map((a) => `
          <button type="button" class="btn btn-xs ${a.kind === 'primary' ? 'btn-primary' : a.kind === 'outline' ? 'btn-outline' : ''}" data-footer-action="${escAttr(a.id)}" title="${escAttr(a.title || a.label || '')}">${escText(a.label || '')}</button>`).join('')}
        </div>
      </div>
  `;

  const contentEl = element.querySelector('[data-shell-content]');
  const toolbarEl = element.querySelector('[data-shell-toolbar]');
  const footerEl = element.querySelector('[data-shell-footer]');
  const searchInput = element.querySelector('[data-shell-search]');
  const tabsRow = element.querySelector('[data-shell-tabs]');

  const paintTabs = () =>
  {
    element.querySelectorAll('[data-shell-tab]').forEach((chip) =>
    {
      const isActive = chip.getAttribute('data-shell-tab') === state.tab;
      chip.classList.toggle('active', isActive);
      chip.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  };

  on(element, 'click', (e) =>
  {
    const tabBtn = e.target && e.target.closest ? e.target.closest('[data-shell-tab]') : null;
    if (tabBtn)
    {
      const id = tabBtn.getAttribute('data-shell-tab') || '';
      if (id && id !== state.tab)
      {
        state.tab = id;
        paintTabs();
        if (onTabChange) onTabChange(id);
      }
      return;
    }
    const headBtn = e.target && e.target.closest ? e.target.closest('[data-header-action]') : null;
    if (headBtn)
    {
      const id = headBtn.getAttribute('data-header-action') || '';
      if (id === 'close')
      {
        if (onClose) onClose();
        return;
      }
      if (onHeaderAction) onHeaderAction(id);
      return;
    }
    const footBtn = e.target && e.target.closest ? e.target.closest('[data-footer-action]') : null;
    if (footBtn && onFooterAction)
    {
      onFooterAction(footBtn.getAttribute('data-footer-action') || '');
    }
  });

  if (tabsRow)
  {
    on(tabsRow, 'keydown', (e) =>
    {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      const visibleTabs = Array.from(tabsRow.querySelectorAll('[data-shell-tab]')).filter(
        (btn) => !btn.hidden && btn.style.display !== 'none'
      );
      if (visibleTabs.length === 0) return;
      const currentIdx = visibleTabs.indexOf(document.activeElement);
      let nextIdx = currentIdx >= 0 ? currentIdx : visibleTabs.findIndex((b) => b.getAttribute('data-shell-tab') === state.tab);
      if (e.key === 'ArrowRight') nextIdx = (nextIdx + 1) % visibleTabs.length;
      else if (e.key === 'ArrowLeft') nextIdx = (nextIdx - 1 + visibleTabs.length) % visibleTabs.length;
      else if (e.key === 'Home') nextIdx = 0;
      else if (e.key === 'End') nextIdx = visibleTabs.length - 1;
      const nextBtn = visibleTabs[nextIdx];
      if (nextBtn)
      {
        e.preventDefault();
        nextBtn.focus();
        nextBtn.click();
      }
    });
  }

  if (contentEl)
  {
    on(contentEl, 'keydown', (e) =>
    {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
      const cards = Array.from(contentEl.querySelectorAll('.ndb-card'));
      if (cards.length === 0) return;
      const activeCard = document.activeElement && document.activeElement.closest
        ? document.activeElement.closest('.ndb-card')
        : null;
      const curIdx = activeCard ? cards.indexOf(activeCard) : -1;
      let nextIdx = curIdx >= 0 ? curIdx : 0;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nextIdx = Math.min(cards.length - 1, curIdx + 1);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') nextIdx = Math.max(0, curIdx - 1);
      else if (e.key === 'Home') nextIdx = 0;
      else if (e.key === 'End') nextIdx = cards.length - 1;
      const nextCard = cards[nextIdx];
      if (nextCard)
      {
        e.preventDefault();
        if (!nextCard.hasAttribute('tabindex')) nextCard.setAttribute('tabindex', '0');
        nextCard.focus();
      }
    });
  }

  if (searchInput && onSearch)
  {
    on(searchInput, 'input', () =>
    {
      state.query = (searchInput.value || '').trim().toLowerCase();
      onSearch(state.query);
    });
  }

  return {
    element,
    contentEl,
    toolbarEl,
    footerEl,
    get activeTab () { return state.tab; },
    getQuery () { return state.query; },
    setBadge (text)
    {
      const badgeEl = element.querySelector('[data-shell-badge]');
      if (badgeEl) badgeEl.textContent = text;
    },
    setTabCount (tabId, count)
    {
      // Sin CSS.escape a propósito: funciona en jsdom y en todos los
      // navegadores objetivo sin polyfill.
      const chips = element.querySelectorAll('[data-shell-tab-count]');
      for (const chip of chips)
      {
        if (chip.getAttribute('data-shell-tab-count') === tabId)
        {
          chip.textContent = String(count);
          break;
        }
      }
    },
    setTab (tabId)
    {
      if (!tabId || tabId === state.tab) return;
      state.tab = tabId;
      paintTabs();
    },
    setTabVisible (tabId, visible)
    {
      if (!tabId) return;
      const show = visible !== false;
      element.querySelectorAll('[data-shell-tab]').forEach((chip) =>
      {
        if (chip.getAttribute('data-shell-tab') === tabId)
        {
          chip.hidden = !show;
          chip.style.display = show ? '' : 'none';
        }
      });
    },
    setTitle (newTitle)
    {
      const titleEl = element.querySelector(".ndb-title-text");
      if (titleEl) titleEl.textContent = newTitle == null ? "" : String(newTitle);
    },
    setSearchPlaceholder (placeholder)
    {
      const input = element.querySelector("[data-shell-search]");
      if (input) input.placeholder = placeholder == null ? "" : String(placeholder);
    },
    setTabLabels (labelsById)
    {
      if (!labelsById || typeof labelsById !== "object") return;
      element.querySelectorAll("[data-shell-tab]").forEach((chip) =>
      {
        const id = chip.getAttribute("data-shell-tab");
        if (id && labelsById[id])
        {
          const nameEl = chip.querySelector(".ndb-chip-name");
          if (nameEl) nameEl.textContent = String(labelsById[id]);
        }
      });
    },
    setFooterActionLabels (labelsById)
    {
      if (!labelsById || typeof labelsById !== "object") return;
      element.querySelectorAll("[data-footer-action]").forEach((btn) =>
      {
        const id = btn.getAttribute("data-footer-action");
        if (id && labelsById[id])
        {
          btn.textContent = String(labelsById[id]);
        }
      });
    },
    setHeaderActionTitle (actionId, newTitle)
    {
      if (!actionId) return;
      const btn = element.querySelector(`[data-header-action="${actionId}"]`);
      if (btn) btn.setAttribute("title", newTitle == null ? "" : String(newTitle));
    },
    focusSearch ()
    {
      const input = element.querySelector('[data-shell-search]');
      if (input) setTimeout(() => input.focus(), 80);
    },
    setFootSlot (text)
    {
      const slotEl = element.querySelector('[data-shell-foot-slot]');
      if (slotEl) slotEl.textContent = text == null ? '' : String(text);
    },
    setFooterStatus (text)
    {
      const statusEl = element.querySelector('[data-shell-foot-status]');
      if (statusEl) statusEl.textContent = text == null ? '' : String(text);
    },
    setBusy (actionId, active)
    {
      if (!actionId) return;
      const on = active === true;
      element
        .querySelectorAll(`[data-header-action="${actionId}"], [data-footer-action="${actionId}"]`)
        .forEach((btn) =>
        {
          btn.disabled = on;
          btn.classList.toggle('is-refreshing', on);
        });
    },
    flashStatus (message, kind)
    {
      const valid = kind === 'error' || kind === 'working' ? kind : 'ok';
      const icons = { ok: '✓', working: '⟳', error: '⚠' };
      let overlay = element.querySelector('[data-shell-flash]');
      if (!overlay)
      {
        overlay = document.createElement('div');
        overlay.className = 'bank-shell-flash';
        overlay.setAttribute('data-shell-flash', '');
        overlay.setAttribute('role', 'status');
        element.appendChild(overlay);
      }
      if (flashTimer) clearTimeout(flashTimer);
      overlay.className = `bank-shell-flash is-visible is-${valid}`;
      overlay.innerHTML =
        `<span class="bank-shell-flash-icon" aria-hidden="true">${icons[valid]}</span>` +
        `<span class="bank-shell-flash-text">${escText(message == null ? '' : String(message))}</span>`;
      const hold = valid === 'error' ? 6000 : valid === 'working' ? 4000 : 3500;
      flashTimer = setTimeout(() =>
      {
        overlay.classList.remove('is-visible');
        flashTimer = null;
      }, hold);
    },
    destroy ()
    {
      if (flashTimer) clearTimeout(flashTimer);
      flashTimer = null;
      aborter.abort();
      element.remove();
    },
  };
}
