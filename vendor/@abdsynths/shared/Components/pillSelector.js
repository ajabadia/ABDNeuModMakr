/**
 * ABD PillSelector — Unified, tokenized pill and chip selector component
 * for the ABDSynths suite.
 * ======================================================================
 *
 * Implements DRY, tokenized option selection via pills/chips across
 * synth drawers, toolbars, category filters, and setting dialogs.
 *
 * Provides both:
 * 1. A stateful DOM Class (`PillSelector`) with setValue/getValue/onChange/destroy.
 * 2. Pure HTML string template helpers (`pillSelectorHtml`, `pillItemHtml`, `bindPillSelector`)
 *    for reactive drawer views and fast virtual rendering.
 */

/**
 * @typedef {object} PillItem
 * @property {string|number} id         Option identifier returned in onChange.
 * @property {string} label             Display text (e.g. 'LP 24dB', '100% (Normal)').
 * @property {string} [title]           Tooltip title.
 * @property {number} [count]           Optional count badge (rendered in .abd-pill__count).
 * @property {string} [iconHtml]        Optional trusted SVG/HTML icon string.
 * @property {string} [catClass]        Optional category class ('cat-0'..'cat-9', 'cat-neutral').
 * @property {string} [variant]         Custom tokenized modifier (e.g. 'accent', 'outline').
 * @property {string} [theme]           Theme ID for theme preview pills ('ms2000', 'audiolab', etc.).
 * @property {boolean} [disabled]       Whether this option is disabled.
 */

/**
 * Escapes plain text for safe HTML rendering.
 * @param {any} s
 * @returns {string}
 */
export function escText(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Escapes attributes for safe HTML rendering.
 * @param {any} s
 * @returns {string}
 */
export function escAttr(s) {
  return escText(s).replace(/"/g, '&quot;');
}

/**
 * Renders a single pill button HTML string.
 *
 * @param {PillItem|string} item
 * @param {string|number} [activeId]
 * @param {object} [options]
 * @param {string} [options.size] 'xs' | 'sm' | 'md' | 'lg'
 * @param {string} [options.attrName] Data attribute name (default: 'data-pill')
 * @returns {string}
 */
export function pillItemHtml(item, activeId, options = {}) {
  const norm = typeof item === 'object' && item !== null
    ? item
    : { id: item, label: String(item) };

  const id = norm.id != null ? String(norm.id) : '';
  const isActive = activeId != null && String(activeId) === id;
  const label = norm.label != null ? String(norm.label) : id;
  const title = norm.title || label;
  const attrName = options.attrName || 'data-pill';

  const classList = [
    'abd-pill',
    options.size ? `abd-pill--${options.size}` : '',
    norm.catClass || '',
    norm.variant ? `abd-pill--${norm.variant}` : '',
    norm.theme ? `theme-pill-preview` : '',
    isActive ? 'active' : '',
    norm.disabled ? 'disabled' : '',
  ].filter(Boolean).join(' ');

  const themeAttr = norm.theme ? ` data-theme="${escAttr(norm.theme)}"` : '';
  const icon = norm.iconHtml ? `<span class="abd-pill__icon">${norm.iconHtml}</span>` : '';
  const count = typeof norm.count === 'number'
    ? `<span class="abd-pill__count">${norm.count}</span>`
    : '';

  return `<button type="button" class="${classList}" ${attrName}="${escAttr(id)}"${themeAttr} title="${escAttr(title)}"${norm.disabled ? ' disabled' : ''}>${icon}<span class="abd-pill__label">${escText(label)}</span>${count}</button>`;
}

/**
 * Renders a complete group of pills with container.
 *
 * @param {Array<PillItem|string>} items
 * @param {string|number} [activeId]
 * @param {object} [options]
 * @param {string} [options.id] Container ID
 * @param {string} [options.className] Additional container classes
 * @param {string} [options.size] 'xs' | 'sm' | 'md' | 'lg'
 * @param {boolean} [options.dense] Reduced gap
 * @param {boolean} [options.nowrap] Single scrollable line
 * @param {string} [options.attrName] Data attribute for pills (default: 'data-pill')
 * @returns {string}
 */
export function pillSelectorHtml(items, activeId, options = {}) {
  const list = Array.isArray(items) ? items : [];
  const containerClasses = [
    'abd-pill-group',
    options.size ? `abd-pill-group--${options.size}` : '',
    options.dense ? 'abd-pill-group--dense' : '',
    options.nowrap ? 'abd-pill-group--nowrap' : '',
    options.className || '',
  ].filter(Boolean).join(' ');

  const idAttr = options.id ? ` id="${escAttr(options.id)}"` : '';
  const buttons = list.map((item) => pillItemHtml(item, activeId, options)).join('');

  return `<div class="${containerClasses}"${idAttr}>${buttons}</div>`;
}

/**
 * Attaches a single delegated click listener to a container with pill buttons.
 *
 * @param {HTMLElement} container
 * @param {(id: string, btn: HTMLButtonElement, event: MouseEvent) => void} onSelect
 * @param {string} [attrName='data-pill']
 * @returns {() => void} Unbind function
 */
export function bindPillSelector(container, onSelect, attrName = 'data-pill') {
  if (!container) return () => {};

  const onClick = (e) => {
    const target = e.target;
    if (!target || typeof target.closest !== 'function') return;

    const btn = target.closest(`[${attrName}], .abd-pill, .ndb-chip`);
    if (!btn || !container.contains(btn) || btn.disabled || btn.classList.contains('disabled')) {
      return;
    }

    const val = btn.getAttribute(attrName)
      || btn.getAttribute('data-theme')
      || btn.getAttribute('data-zoom')
      || btn.getAttribute('data-chip')
      || btn.getAttribute('data-algo')
      || btn.getAttribute('data-room')
      || btn.getAttribute('data-ftype')
      || btn.getAttribute('data-freqalgo')
      || btn.getAttribute('data-timealgo')
      || '';

    container.querySelectorAll(`[${attrName}], .abd-pill, .ndb-chip`).forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');

    onSelect(val, btn, e);
  };

  container.addEventListener('click', onClick);

  return () => {
    container.removeEventListener('click', onClick);
  };
}

/**
 * Stateful DOM component managing a pill selection group.
 */
export class PillSelector {
  /**
   * @param {HTMLElement|string} container
   * @param {object} options
   * @param {Array<PillItem|string>} options.items
   * @param {string|number} [options.value]
   * @param {string} [options.size] 'xs' | 'sm' | 'md' | 'lg'
   * @param {boolean} [options.dense]
   * @param {boolean} [options.nowrap]
   * @param {string} [options.className]
   * @param {(value: string|number, item: PillItem|null, event?: MouseEvent) => void} [options.onChange]
   */
  constructor(container, options = {}) {
    this.container = typeof container === 'string'
      ? document.querySelector(container)
      : container;

    if (!this.container) {
      throw new Error('[PillSelector] Container element not found');
    }

    this.options = options;
    this.items = (options.items ?? []).map((it) =>
      typeof it === 'object' && it !== null ? it : { id: it, label: String(it) }
    );
    this.value = options.value ?? (this.items[0]?.id ?? '');
    this.unbind = null;

    this.render();
  }

  render() {
    this.container.innerHTML = pillSelectorHtml(this.items, this.value, this.options);

    if (this.unbind) {
      this.unbind();
    }

    this.unbind = bindPillSelector(this.container, (id, btn, e) => {
      this.setValue(id, false, e);
    }, this.options.attrName || 'data-pill');
  }

  /**
   * @param {string|number} value
   * @param {boolean} [silent=false]
   * @param {MouseEvent} [event]
   */
  setValue(value, silent = false, event) {
    const strVal = String(value);
    if (String(this.value) === strVal && !event) return;

    this.value = value;

    // Update active class in DOM without full re-render
    const attr = this.options.attrName || 'data-pill';
    const buttons = this.container.querySelectorAll(`[${attr}], .abd-pill, .ndb-chip`);
    buttons.forEach((btn) => {
      const bVal = btn.getAttribute(attr)
        || btn.getAttribute('data-theme')
        || btn.getAttribute('data-zoom')
        || btn.getAttribute('data-chip')
        || btn.getAttribute('data-algo')
        || btn.getAttribute('data-room')
        || btn.getAttribute('data-ftype')
        || btn.getAttribute('data-freqalgo')
        || btn.getAttribute('data-timealgo')
        || '';

      const match = String(bVal) === strVal;
      btn.classList.toggle('active', match);
    });

    if (!silent && typeof this.options.onChange === 'function') {
      const item = this.items.find((it) => String(it.id) === strVal) || null;
      this.options.onChange(value, item, event);
    }
  }

  getValue() {
    return this.value;
  }

  /**
   * @param {Array<PillItem|string>} items
   */
  setItems(items) {
    this.items = (items ?? []).map((it) =>
      typeof it === 'object' && it !== null ? it : { id: it, label: String(it) }
    );
    this.render();
  }

  destroy() {
    if (this.unbind) {
      this.unbind();
      this.unbind = null;
    }
    this.container.innerHTML = '';
  }
}
