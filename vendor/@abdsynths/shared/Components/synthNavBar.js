/**
 * @file synthNavBar.js
 * @brief Barra de navegación superior universal (Menu Bar + Header HUD) para la suite ABDSynths.
 * 
 * Características:
 * - Paridad con el sistema de menús nativos JUCE (File / Edit / Mode / View / Help).
 * - Menús declarativos con soporte para submenús anidados (▸), checkmarks (✓), iconos (`iconHtml`) y atajos (<kbd>).
 * - Comportamiento DAW / Desktop: apertura con clic, cambio fluido entre menús al pasar el cursor (hover scrub).
 * - Ranuras flexibles (slots) para Brand/Logo, Selector de Modo, Botones de Acción (Panic/Rndm), Indicador MIDI.
 * - Auto-conexión opcional con AboutDialog en Help -> About y Help -> Check for Updates.
 * - Soporte de atajos de teclado globales y cierre accesible con tecla Escape o clic exterior.
 */

import { AboutDialog, createAboutDialog } from './aboutDialog.js';
import { escapeHtml } from '../Utils/escape.js';
import { SHARED_EN } from './I18n/locales/en.js';
import { SHARED_ES } from './I18n/locales/es.js';

function resolveNavBarLocale(explicitLocale) {
  if (explicitLocale === 'es' || explicitLocale === 'en') return explicitLocale;
  try {
    if (typeof localStorage !== 'undefined') {
      const saved =
        localStorage.getItem('abdsynths.locale') ||
        localStorage.getItem('abd_locale') ||
        localStorage.getItem('neumodmakr.locale');
      if (saved === 'es' || saved === 'en') return saved;
    }
    if (typeof document !== 'undefined' && document.documentElement?.lang) {
      const docLang = document.documentElement.lang.slice(0, 2).toLowerCase();
      if (docLang === 'es' || docLang === 'en') return docLang;
    }
  } catch {
    // Ignore storage errors
  }
  return 'en';
}

function resolveMenuText(entry, field, locale) {
  if (!entry) return '';
  const lang = resolveNavBarLocale(locale);
  if (lang === 'es' && entry[`${field}Es`]) return entry[`${field}Es`];
  if (lang === 'en' && entry[`${field}En`]) return entry[`${field}En`];
  if (entry.i18nKey) {
    const dict = lang === 'es' ? SHARED_ES : SHARED_EN;
    const parts = String(entry.i18nKey).split('.');
    let curr = dict;
    for (const p of parts) {
      curr = curr?.[p];
    }
    if (typeof curr === 'string') return curr;
  }
  return entry[field] || '';
}

/**
 * Menús estándar por defecto para sintetizadores de la suite (bilingües EN / ES).
 */
export const DEFAULT_NAVBAR_MENUS = [
  {
    name: 'File',
    nameEs: 'Archivo',
    i18nKey: 'navbar.menuFile',
    items: [
      { id: 100, label: 'Load Bank (.json)...', labelEs: 'Cargar Banco (.json)...', i18nKey: 'navbar.loadBank', action: 'loadBank' },
      { id: 101, label: 'Save Bank (.json)...', labelEs: 'Guardar Banco (.json)...', i18nKey: 'navbar.saveBank', action: 'saveBank', shortcut: 'Ctrl+Shift+S' },
      { separator: true },
      { id: 104, label: 'Load Patch...', labelEs: 'Cargar Sonido...', i18nKey: 'navbar.loadPreset', action: 'loadPatch', shortcut: 'Ctrl+O' },
      { id: 105, label: 'Save Patch As...', labelEs: 'Guardar Sonido Como...', i18nKey: 'navbar.savePreset', action: 'savePatchAs', shortcut: 'Ctrl+S' },
      { separator: true },
      { id: 102, label: 'Init Bank (Factory Reset)', labelEs: 'Iniciar Banco (Restablecer Fábrica)', i18nKey: 'navbar.initBank', action: 'initBank' },
      { id: 103, label: 'Reset Current Patch', labelEs: 'Restablecer Sonido Actual', i18nKey: 'navbar.initPreset', action: 'resetPatch', shortcut: 'Ctrl+N' }
    ]
  },
  {
    name: 'Edit',
    nameEs: 'Edición',
    i18nKey: 'navbar.menuEdit',
    items: [
      { id: 200, label: 'Undo', labelEs: 'Deshacer', i18nKey: 'navbar.undo', action: 'undo', shortcut: 'Ctrl+Z' },
      { id: 201, label: 'Redo', labelEs: 'Rehacer', i18nKey: 'navbar.redo', action: 'redo', shortcut: 'Ctrl+Y' },
      { separator: true },
      { id: 203, label: 'Bank Manager...', labelEs: 'Navegador de Bancos...', i18nKey: 'navbar.bankBrowser', action: 'bankManager' },
      { id: 204, label: 'Randomize Patch', labelEs: 'Aleatorizar Sonido', i18nKey: 'navbar.randomize', action: 'randomize' }
    ]
  },
  {
    name: 'View',
    nameEs: 'Ver',
    i18nKey: 'navbar.menuView',
    items: [
      {
        id: 300,
        label: 'Zoom',
        labelEs: 'Escala (Zoom)',
        i18nKey: 'navbar.zoom',
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
    nameEs: 'Ayuda',
    i18nKey: 'navbar.menuHelp',
    items: [
      { id: 900, label: 'Documentation / Wiki', labelEs: 'Documentación / Guía...', i18nKey: 'navbar.manual', action: 'manual', shortcut: 'F1' },
      { id: 902, label: 'Check for Updates...', labelEs: 'Buscar Actualizaciones...', i18nKey: 'navbar.checkForUpdates', action: 'checkForUpdates' },
      { separator: true },
      { id: 901, label: 'About...', labelEs: 'Acerca de...', i18nKey: 'navbar.about', action: 'about' }
    ]
  }
];

export function getDefaultNavbarMenus(locale) {
  const lang = resolveNavBarLocale(locale);
  const localizeItem = (item) => {
    if (!item || item.separator) return item;
    const copy = { ...item, label: resolveMenuText(item, 'label', lang) };
    if (Array.isArray(item.submenu)) {
      copy.submenu = item.submenu.map(localizeItem);
    }
    return copy;
  };
  return DEFAULT_NAVBAR_MENUS.map((menu) => ({
    ...menu,
    displayName: resolveMenuText(menu, 'name', lang),
    items: (menu.items || []).map(localizeItem),
  }));
}

/**
 * Comprueba si un ítem de menú está activo/marcado.
 * @param {object} item
 * @param {Function|object} activeValues
 * @returns {boolean}
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
 * @param {object} item
 * @param {Function|object} activeValues
 * @returns {string}
 */
export function renderMenuItemHtml(item, activeValues, locale) {
  if (!item) return '';
  if (item.separator) {
    return '<div class="nav-separator" role="separator"></div>';
  }

  const checked = isItemChecked(item, activeValues);
  const checkMark = checked ? '<span class="nav-check">✓</span> ' : '<span class="nav-check-spacer"></span>';
  const iconHtml = item.iconHtml ? `<span class="nav-item-icon">${item.iconHtml}</span>` : '';
  const resolvedLabel = resolveMenuText(item, 'label', locale);

  if (item.submenu && Array.isArray(item.submenu)) {
    const subHtml = item.submenu.map(sub => renderMenuItemHtml(sub, activeValues, locale)).join('');
    return `
      <div class="nav-item nav-has-sub" role="menuitem" aria-haspopup="true">
        <span class="nav-item-content">${checkMark}${iconHtml}${escapeHtml(resolvedLabel)}</span>
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
      <span class="nav-item-content">${checkMark}${iconHtml}${escapeHtml(resolvedLabel)}</span>
      ${kbd}
    </button>
  `;
}



/**
 * Componente SynthNavBar.
 */
export class SynthNavBar {
  /**
   * @param {object} options
   * @param {HTMLElement|string} [options.container] Contenedor DOM o selector.
   * @param {object} [options.brand] Información de marca ({ title, subtitle, logoHtml, version }).
   * @param {Array} [options.menus] Lista declarativa de menús (defaults a DEFAULT_NAVBAR_MENUS).
   * @param {object} [options.actions] Mapa de funciones callback por nombre de acción.
   * @param {Function|object} [options.activeValues] Estado activo para radios y checks.
   * @param {AboutDialog|object} [options.aboutDialog] Instancia o configuración de AboutDialog.
   * @param {HTMLElement|string} [options.centerSlot] Contenido personalizado central.
   * @param {HTMLElement|string} [options.rightSlot] Contenido personalizado a la derecha.
   * @param {boolean} [options.enableGlobalShortcuts=true] Escuchar atajos globales registrados.
   * @param {Function} [options.onAction] Callback genérico para todas las acciones (action, value, e).
   */
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
      // Instancia por defecto lista para usar
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

    // Montar slots si existen
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
        ${escapeHtml(resolveMenuText(menu, 'name', this.options.locale))}
      </button>
    `).join('');
  }

  setLocale(locale) {
    if (locale === 'es' || locale === 'en') {
      this.options.locale = locale;
    } else {
      delete this.options.locale;
    }
    if (this.menuBarEl) {
      this.menuBarEl.querySelectorAll('.nav-menu-trigger').forEach((trig) => {
        const menuName = trig.dataset.menu;
        const menu = (this.options.menus || []).find((m) => m.name === menuName);
        if (menu) {
          trig.textContent = resolveMenuText(menu, 'name', this.options.locale);
        }
      });
    }
    if (this.isMenuOpen && this.activeMenuName) {
      this.openDropdown(this.activeMenuName);
    }
    if (this.aboutDialog && typeof this.aboutDialog.setLocale === 'function') {
      this.aboutDialog.setLocale(this.options.locale);
    }
  }

  _wireEvents() {
    if (!this.menuBarEl) return;

    // Clic en los disparadores de menú
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

      // Scrubbing de menús al mover el ratón (comportamiento estándar de menús de escritorio)
      trigger.addEventListener('mouseenter', () => {
        if (this.isMenuOpen && this.activeMenuName !== trigger.dataset.menu) {
          this.openDropdown(trigger.dataset.menu, trigger);
        }
      });
    });

    // Clic en ítems de menú del dropdown
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

    // Comprobar atajos de teclado globales
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

  /**
   * Abre el dropdown para un menú específico.
   * @param {string} menuName
   * @param {HTMLElement} [triggerEl]
   */
  openDropdown(menuName, triggerEl = null) {
    const menu = (this.options.menus || []).find(m => m.name === menuName);
    if (!menu || !this.dropdownEl) return;

    this.activeMenuName = menuName;
    this.isMenuOpen = true;

    // Actualizar estados visuales de los disparadores
    this.menuBarEl.querySelectorAll('.nav-menu-trigger').forEach(trig => {
      const isActive = trig.dataset.menu === menuName;
      trig.classList.toggle('active', isActive);
      trig.setAttribute('aria-expanded', String(isActive));
    });

    // Renderizar ítems
    this.dropdownEl.innerHTML = (menu.items || [])
      .map(item => renderMenuItemHtml(item, this.options.activeValues))
      .join('');

    // Posicionamiento alineado al disparador
    const targetTrigger = triggerEl || this.menuBarEl.querySelector(`.nav-menu-trigger[data-menu="${menuName}"]`);
    if (targetTrigger) {
      const trigRect = targetTrigger.getBoundingClientRect();
      const parentRect = this.element.getBoundingClientRect();
      this.dropdownEl.style.left = `${Math.max(0, trigRect.left - parentRect.left)}px`;
    }

    this.dropdownEl.hidden = false;
  }

  /**
   * Cierra cualquier menú desplegable activo.
   */
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

  /**
   * Invoca una acción de menú registrada o delegada.
   * @param {string} action
   * @param {any} [value]
   * @param {Event} [event]
   * @param {HTMLElement} [triggerEl]
   */
  triggerAction(action, value = undefined, event = null, triggerEl = null) {
    if (!action) return;

    // Acciones reservadas transversales
    if (action === 'about' && this.aboutDialog) {
      this.aboutDialog.open(triggerEl);
    } else if (action === 'checkForUpdates' && this.aboutDialog) {
      this.aboutDialog.open(triggerEl);
      this.aboutDialog.checkForUpdates();
    }

    // Callbacks del consumidor
    if (typeof this.options.actions[action] === 'function') {
      this.options.actions[action](value, event);
    }

    if (typeof this.options.onAction === 'function') {
      this.options.onAction(action, value, event);
    }
  }

  /**
   * Actualiza los valores activos (radios/checks) y refresca si el menú está abierto.
   * @param {object|Function} newValues
   */
  setActiveValues(newValues) {
    this.options.activeValues = newValues;
    if (this.isMenuOpen && this.activeMenuName) {
      this.openDropdown(this.activeMenuName);
    }
  }

  /**
   * Limpia eventos y elimina el elemento DOM si fue creado por este componente.
   */
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

/**
 * Función de factoría para instanciar SynthNavBar.
 * @param {object} options
 * @returns {SynthNavBar}
 */
export function createSynthNavBar(options) {
  return new SynthNavBar(options);
}

export const SysExIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h3l3-8 4 16 4-10 3 4h3"/><path d="M9 8l2 3-2 2"/><path d="M13 8l2 3-2 2"/></svg>`;
