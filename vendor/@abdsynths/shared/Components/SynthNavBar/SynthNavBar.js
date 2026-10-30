/**
 * @file SynthNavBar.js
 * @brief Barra de navegación superior universal (Menu Bar + Header HUD) para la suite ABDSynths.
 * 
 * Características:
 * - Paridad con el sistema de menús nativos JUCE (File / Edit / Mode / View / Help).
 * - Menús declarativos con soporte para submenús anidados (▸), checkmarks (✓) y atajos (<kbd>).
 * - Comportamiento DAW / Desktop: apertura con clic, cambio fluido entre menús al pasar el cursor (hover scrub).
 * - Ranuras flexibles (slots) para Brand/Logo, Selector de Modo, Botones de Acción (Panic/Rndm), Indicador MIDI.
 * - Auto-conexión opcional con AboutDialog en Help -> About y Help -> Check for Updates.
 * - Soporte de atajos de teclado globales y cierre accesible con tecla Escape o clic exterior.
 */

import { AboutDialog, createAboutDialog } from '../AboutDialog/index.js';

/**
 * Menús estándar por defecto para sintetizadores de la suite.
 */
export const DEFAULT_NAVBAR_MENUS = [
  {
    name: 'File',
    items: [
      { id: 100, label: 'Load Bank (.json)...', action: 'loadBank' },
      { id: 101, label: 'Save Bank (.json)...', action: 'saveBank', shortcut: 'Ctrl+Shift+S' },
      { separator: true },
      { id: 104, label: 'Load Patch...', action: 'loadPatch', shortcut: 'Ctrl+O' },
      { id: 105, label: 'Save Patch As...', action: 'savePatchAs', shortcut: 'Ctrl+S' },
      { separator: true },
      { id: 102, label: 'Init Bank (Factory Reset)', action: 'initBank' },
      { id: 103, label: 'Reset Current Patch', action: 'resetPatch', shortcut: 'Ctrl+N' }
    ]
  },
  {
    name: 'Edit',
    items: [
      { id: 200, label: 'Undo', action: 'undo', shortcut: 'Ctrl+Z' },
      { id: 201, label: 'Redo', action: 'redo', shortcut: 'Ctrl+Y' },
      { separator: true },
      { id: 203, label: 'Bank Manager...', action: 'bankManager' },
      { id: 204, label: 'Randomize Patch', action: 'randomize' }
    ]
  },
  {
    name: 'View',
    items: [
      {
        id: 300,
        label: 'Zoom',
        submenu: [
          { id: 301, label: '100%', action: 'zoom', value: 1.0 },
          { id: 302, label: '125%', action: 'zoom', value: 1.25 },
          { id: 303, label: '150%', action: 'zoom', value: 1.5 }
        ]
      }
    ]
  },
  {
    name: 'Help',
    items: [
      { id: 900, label: 'Documentation / Wiki', action: 'manual', shortcut: 'F1' },
      { id: 902, label: 'Check for Updates...', action: 'checkForUpdates' },
      { separator: true },
      { id: 901, label: 'About...', action: 'about' }
    ]
  }
];

/**
 * Comprueba si un ítem de menú está activo/marcado.
 */
export function isItemChecked(item, activeValues) {
  if (!item) return false;
  if (item.checked === true) return true;
  if (!item.action) return false;

  let currentVal = undefined;
  if (typeof activeValues === 'function') {
    currentVal = activeValues(item.action);
  } else if (activeValues && typeof activeValues === 'object') {
    currentVal = activeValues[item.action];
  }

  if (currentVal !== undefined && item.value !== undefined) {
    return currentVal === item.value;
  }
  return false;
}

/**
 * Renderiza el HTML de un ítem de menú de manera pura.
 */
export function renderMenuItemHtml(item, activeValues) {
  if (!item) return '';
  if (item.separator) {
    return '<div class="nav-separator" role="separator"></div>';
  }

  const checked = isItemChecked(item, activeValues);
  const checkMark = checked ? '<span class="nav-check">✓</span> ' : '<span class="nav-check-spacer"></span>';

  if (item.submenu && Array.isArray(item.submenu)) {
    const subHtml = item.submenu.map(sub => renderMenuItemHtml(sub, activeValues)).join('');
    return `
      <div class="nav-item nav-has-sub" role="menuitem" aria-haspopup="true">
        <span class="nav-item-content">${checkMark}${escapeHtml(item.label)}</span>
        <span class="nav-arrow" aria-hidden="true">▸</span>
        <div class="nav-submenu" role="menu">
          ${subHtml}
        </div>
      </div>
    `;
  }

  const kbd = item.shortcut ? `<kbd class="nav-kbd">${escapeHtml(item.shortcut)}</kbd>` : '';
  const valAttr = item.value !== undefined ? ` data-value="${escapeHtml(String(item.value))}"` : '';
  const disabledAttr = item.disabled ? ' disabled' : '';

  return `
    <button type="button" class="nav-item" role="menuitem" data-action="${escapeHtml(item.action || '')}"${valAttr}${disabledAttr}>
      <span class="nav-item-content">${checkMark}${escapeHtml(item.label)}</span>
      ${kbd}
    </button>
  `;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Componente SynthNavBar.
 */
export class SynthNavBar {
  constructor(options = {}) {
    this.options = {
      menus: DEFAULT_NAVBAR_MENUS,
      brand: {
        title: 'ABD Synth',
        subtitle: ''
      },
      actions: {},
      activeValues: {},
      enableGlobalShortcuts: true,
      ...options
    };

    this.container = typeof this.options.container === 'string'
      ? document.querySelector(this.options.container)
      : this.options.container;

    this.element = null;
    this.menuBarEl = null;
    this.dropdownEl = null;
    this.activeMenuName = null;
    this.isMenuOpen = false;
    this.aboutDialog = null;

    this._boundOnClickOutside = this._onClickOutside.bind(this);
    this._boundOnKeyDown = this._onKeyDown.bind(this);

    this._initAboutDialog();
    this._mount();
    this._wireEvents();
  }

  _initAboutDialog() {
    if (this.options.aboutDialog instanceof AboutDialog) {
      this.aboutDialog = this.options.aboutDialog;
    } else if (this.options.aboutDialog && typeof this.options.aboutDialog === 'object') {
      this.aboutDialog = createAboutDialog({
        appName: this.options.brand?.title || 'ABD Synth',
        subtitle: this.options.brand?.subtitle || '',
        ...this.options.aboutDialog
      });
    } else if (this.options.aboutDialog !== false) {
      this.aboutDialog = createAboutDialog({
        appName: this.options.brand?.title || 'ABD Synth',
        subtitle: this.options.brand?.subtitle || ''
      });
    }
  }

  _mount() {
    this.element = document.createElement('nav');
    this.element.className = 'navbar abd-synth-navbar';
    this.element.setAttribute('role', 'navigation');
    this.element.setAttribute('aria-label', 'Main Navigation Bar');

    const brandPosition = this.options.brandPosition || 'left';
    const brandHtml = this._buildBrandHtml();
    const menusHtml = this._buildMenusHeaderHtml();

    this.element.innerHTML = `
      <div class="nav-left">
        ${brandPosition === 'left' ? brandHtml : ''}
        <div class="menu-bar nav-menu-bar" role="menubar">
          ${menusHtml}
        </div>
        <div class="menu-dropdown nav-dropdown" role="menu" hidden></div>
      </div>
      <div class="nav-center"></div>
      <div class="nav-right">
        ${brandPosition === 'right' ? brandHtml : ''}
      </div>
    `;

    this.menuBarEl = this.element.querySelector('.nav-menu-bar');
    this.dropdownEl = this.element.querySelector('.nav-dropdown');

    const centerContainer = this.element.querySelector('.nav-center');
    if (centerContainer && this.options.centerSlot) {
      if (typeof this.options.centerSlot === 'string') {
        centerContainer.innerHTML = this.options.centerSlot;
      } else if (this.options.centerSlot instanceof HTMLElement) {
        centerContainer.appendChild(this.options.centerSlot);
      }
    }

    const rightContainer = this.element.querySelector('.nav-right');
    if (rightContainer && this.options.rightSlot) {
      if (typeof this.options.rightSlot === 'string') {
        const slotEl = document.createElement('div');
        slotEl.innerHTML = this.options.rightSlot;
        if (brandPosition === 'right') {
          rightContainer.insertBefore(slotEl, rightContainer.firstChild);
        } else {
          rightContainer.appendChild(slotEl);
        }
      } else if (this.options.rightSlot instanceof HTMLElement) {
        if (brandPosition === 'right') {
          rightContainer.insertBefore(this.options.rightSlot, rightContainer.firstChild);
        } else {
          rightContainer.appendChild(this.options.rightSlot);
        }
      }
    }

    if (this.container) {
      this.container.appendChild(this.element);
    } else {
      document.body.insertBefore(this.element, document.body.firstChild);
    }
  }

  _buildBrandHtml() {
    const brand = this.options.brand || {};
    const title = brand.title ? `<span class="brand-title">${escapeHtml(brand.title)}</span>` : '';
    const subtitle = brand.subtitle ? `<span class="brand-subtitle">${escapeHtml(brand.subtitle)}</span>` : '';
    const logo = brand.logoHtml || '';

    return `
      <div class="nav-brand">
        ${logo}
        ${title}
        ${subtitle}
      </div>
    `;
  }

  _buildMenusHeaderHtml() {
    return (this.options.menus || []).map(menu => `
      <button type="button" class="menu-trigger nav-menu-trigger" role="menuitem" aria-haspopup="true" aria-expanded="false" data-menu="${escapeHtml(menu.name)}">
        ${escapeHtml(menu.name)}
      </button>
    `).join('');
  }

  _wireEvents() {
    if (!this.menuBarEl) return;

    const triggers = this.menuBarEl.querySelectorAll('.nav-menu-trigger');
    triggers.forEach(trigger => {
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const menuName = trigger.dataset.menu;
        if (this.isMenuOpen && this.activeMenuName === menuName) {
          this.closeDropdown();
        } else {
          this.openDropdown(menuName, trigger);
        }
      });

      trigger.addEventListener('mouseenter', () => {
        if (this.isMenuOpen && this.activeMenuName !== trigger.dataset.menu) {
          this.openDropdown(trigger.dataset.menu, trigger);
        }
      });
    });

    if (this.dropdownEl) {
      this.dropdownEl.addEventListener('click', (e) => {
        const itemBtn = e.target.closest('button.nav-item');
        if (!itemBtn || itemBtn.disabled) return;

        const action = itemBtn.dataset.action;
        const rawValue = itemBtn.dataset.value;
        let value = undefined;
        if (rawValue !== undefined && rawValue !== '') {
          value = /^-?\d+(\.\d+)?$/.test(rawValue) ? Number(rawValue) : rawValue;
        }

        this.triggerAction(action, value, e, itemBtn);
        this.closeDropdown();
      });
    }

    document.addEventListener('click', this._boundOnClickOutside);
    document.addEventListener('keydown', this._boundOnKeyDown);
  }

  _onClickOutside(e) {
    if (!this.element.contains(e.target)) {
      this.closeDropdown();
    }
  }

  _onKeyDown(e) {
    if (e.key === 'Escape') {
      if (this.isMenuOpen) {
        e.preventDefault();
        this.closeDropdown();
      }
      return;
    }

    if (this.options.enableGlobalShortcuts && !this._isInputTarget(e.target)) {
      const matched = this._findShortcutMatch(e);
      if (matched) {
        e.preventDefault();
        this.triggerAction(matched.action, matched.value, e);
      }
    }
  }

  _isInputTarget(el) {
    if (!el) return false;
    const tag = el.tagName?.toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  _findShortcutMatch(e) {
    const key = e.key.toUpperCase();
    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;
    const alt = e.altKey;

    for (const menu of this.options.menus || []) {
      for (const item of menu.items || []) {
        if (item.shortcut && item.action) {
          const parts = item.shortcut.toUpperCase().split('+').map(p => p.trim());
          const reqCtrl = parts.includes('CTRL') || parts.includes('CMD');
          const reqShift = parts.includes('SHIFT');
          const reqAlt = parts.includes('ALT');
          const reqKey = parts[parts.length - 1];

          if (ctrl === reqCtrl && shift === reqShift && alt === reqAlt && key === reqKey) {
            return item;
          }
        }
      }
    }
    return null;
  }

  openDropdown(menuName, triggerEl = null) {
    const menu = (this.options.menus || []).find(m => m.name === menuName);
    if (!menu || !this.dropdownEl) return;

    this.activeMenuName = menuName;
    this.isMenuOpen = true;

    this.menuBarEl.querySelectorAll('.nav-menu-trigger').forEach(trig => {
      const isActive = trig.dataset.menu === menuName;
      trig.classList.toggle('active', isActive);
      trig.setAttribute('aria-expanded', String(isActive));
    });

    this.dropdownEl.innerHTML = (menu.items || [])
      .map(item => renderMenuItemHtml(item, this.options.activeValues))
      .join('');

    const targetTrigger = triggerEl || this.menuBarEl.querySelector(`.nav-menu-trigger[data-menu="${menuName}"]`);
    if (targetTrigger) {
      const trigRect = targetTrigger.getBoundingClientRect();
      const parentRect = this.element.getBoundingClientRect();
      this.dropdownEl.style.left = `${Math.max(0, trigRect.left - parentRect.left)}px`;
    }

    this.dropdownEl.hidden = false;
  }

  closeDropdown() {
    if (!this.isMenuOpen) return;
    this.isMenuOpen = false;
    this.activeMenuName = null;

    if (this.dropdownEl) {
      this.dropdownEl.hidden = true;
    }

    if (this.menuBarEl) {
      this.menuBarEl.querySelectorAll('.nav-menu-trigger').forEach(trig => {
        trig.classList.remove('active');
        trig.setAttribute('aria-expanded', 'false');
      });
    }
  }

  triggerAction(action, value = undefined, event = null, triggerEl = null) {
    if (!action) return;

    if (action === 'about' && this.aboutDialog) {
      this.aboutDialog.open(triggerEl);
    } else if (action === 'checkForUpdates' && this.aboutDialog) {
      this.aboutDialog.open(triggerEl);
      this.aboutDialog.checkForUpdates();
    }

    if (typeof this.options.actions[action] === 'function') {
      this.options.actions[action](value, event);
    }

    if (typeof this.options.onAction === 'function') {
      this.options.onAction(action, value, event);
    }
  }

  setActiveValues(newValues) {
    this.options.activeValues = newValues;
    if (this.isMenuOpen && this.activeMenuName) {
      this.openDropdown(this.activeMenuName);
    }
  }

  destroy() {
    document.removeEventListener('click', this._boundOnClickOutside);
    document.removeEventListener('keydown', this._boundOnKeyDown);

    if (this.aboutDialog) {
      this.aboutDialog.destroy();
    }

    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }
}

export function createSynthNavBar(options) {
  return new SynthNavBar(options);
}
