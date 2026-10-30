/**
 * ABDSharedAssets — theme switcher (page infrastructure, not a control).
 * =========================================================================
 *
 * Un selector de TEMAS universal: el interruptor es compartido, los temas son
 * de cada synth. Cada botón aplica su tema con `data-theme` en el elemento
 * raíz que se le dé (convención de la suite: `<html>` como MS2000, o `<body>`
 * como el demo — ambos funcionan porque tokens.css y backgrounds.css resuelven
 * en el elemento tematizado y heredan hacia abajo).
 *
 * ¿Qué es un "tema" aquí? Un juego de tokens en styles/tokens.css. La suite
 * trae dos: `dark` (el `:root`, sin atributo) y `light` ([data-theme="light"]).
 * Un synth define los suyos añadiendo bloques `[data-theme="..."]` — NO copia
 * CSS de widgets: solo tokens. Todo lo demás (widgets, skins, fondo tintable,
 * LCD, sombras) es universal y le llega gratis.
 *
 * Cada tema puede llevar, ademas del id y la etiqueta:
 *   - `bodyClass`: clase que el switcher aplica a <body> mientras el tema esta
 *     activo (politica de DUENO unico: retira la anterior al cambiar y al
 *     destroy). Asi los skins tipo `skin-*` viajan como DATO del tema.
 *   - `payload`: dato opaco del synth (p. ej. el indice de `synthMode`) que el
 *     switcher entrega a onChange como segundo argumento y expone en `.payload`.
 *
 * Usage:
 *   import { ThemeSwitcher } from '@abdsynths/shared/components';
 *   const ts = new ThemeSwitcher(container, {
 *     themes: [{ id: 'dark', label: 'Dark' }, { id: 'light', label: 'Light' }],
 *     root: document.documentElement,      // default
 *     storageKey: 'neuronik.theme',        // opcional: recuerda la elección
 *     variant: 'buttons' | 'select',       // default 'buttons'; 'select' = selector unico
 *     onChange: (id, payload) => {},
 *   });
 *   // ts.value -> tema activo; ts.payload -> el payload del tema activo;
 *   // (ts?.value / ts?.payload: el mismo acceso con encadenado opcional,
 *   //  por si el switch puede faltar en ese punto)
 *   ts.setValue('light', { fromUser: false });   // silencioso: no notifica
 *   ts.destroy();
 */

const DEFAULT_THEMES = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
];

export class ThemeSwitcher {
  /**
   * @param {HTMLElement} container
   * @param {object} [options]
   * @param {Array<{id: string, label: string, bodyClass?: string, payload?: *}>} [options.themes]
   * @param {HTMLElement} [options.root]       dónde se aplica data-theme (default documentElement)
   * @param {string} [options.storageKey]      si se da, persiste la elección
   * @param {string} [options.initialTheme]    tema inicial (default: guardado o el primero)
   * @param {'buttons'|'select'} [options.variant]  'buttons' (default) o 'select' compacto
   * @param {(themeId: string, payload: *) => void} [options.onChange]
   */
  constructor(container, {
    themes = DEFAULT_THEMES,
    root = typeof document !== 'undefined' ? document.documentElement : null,
    storageKey = null,
    initialTheme = null,
    variant = 'buttons',
    onChange = null,
  } = {}) {
    if (!container) throw new Error('ThemeSwitcher: container requerido');
    if (!root) throw new Error('ThemeSwitcher: sin root ni document');
    if (!Array.isArray(themes) || themes.length === 0) {
      throw new Error('ThemeSwitcher: themes vacío');
    }
    const ids = themes.map((t) => t.id);
    if (new Set(ids).size !== ids.length) {
      throw new Error('ThemeSwitcher: ids de tema duplicados');
    }

    this._themes = themes.map((t) => ({ ...t }));
    this._root = root;
    this._storageKey = storageKey;
    this._onChange = onChange || null;
    this._buttons = new Map();
    this._handlers = new Map();
    this._payloads = new Map(this._themes.map((t) => [t.id, t.payload]));
    this._appliedBodyClass = null;
    this._variant = variant === 'select' ? 'select' : 'buttons';

    if (this._variant === 'select') {
      // El selector UNICO: un <select> nativo compacto (accesible de serie).
      // Un tema por <option>; el valor ES el id del tema.
      this._element = document.createElement('select');
      this._element.className = 'abd-theme-switcher abd-theme-switcher--select';
      this._element.setAttribute('aria-label', 'Theme');

      for (const theme of this._themes) {
        const option = document.createElement('option');
        option.value = theme.id;
        option.textContent = theme.label;
        this._element.append(option);
        this._buttons.set(theme.id, option);
      }

      const onSelect = () => this.setValue(this._element.value, { fromUser: true });
      this._element.addEventListener('change', onSelect);
      this._handlers.set('__select__', onSelect);
    } else {
      this._element = document.createElement('div');
      this._element.className = 'abd-theme-switcher';
      this._element.setAttribute('role', 'group');
      this._element.setAttribute('aria-label', 'Theme');

      for (const theme of this._themes) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'abd-theme-switcher__btn';
        btn.textContent = theme.label;
        btn.dataset.themeId = theme.id;
        const onClick = () => this.setValue(theme.id, { fromUser: true });
        btn.addEventListener('click', onClick);
        this._handlers.set(theme.id, onClick);
        this._element.append(btn);
        this._buttons.set(theme.id, btn);
      }
    }
    container.append(this._element);

    const stored = storageKey ? this._readStorage() : null;
    const start = initialTheme ?? stored ?? this._themes[0].id;
    this._apply(start, { fromUser: false });
  }

  get element() { return this._element; }

  get value() { return this._value; }

  get themeIds() { return this._themes.map((t) => t.id); }

  /** El payload del tema activo (undefined si el tema no declaro ninguno). */
  get payload() { return this._payloads.get(this._value); }

  /**
   * Aplica un tema por id.
   * @param {string} themeId
   * @param {{ fromUser?: boolean }} [o]  `{ fromUser }`: gesto del usuario, notifica a onChange.
   */
  setValue(themeId, { fromUser = true } = {}) {
    if (!this._buttons.has(themeId)) {
      throw new Error(`ThemeSwitcher: tema desconocido "${themeId}"`);
    }
    this._apply(themeId, { fromUser });
  }

  /** Quita los listeners, la clase de body y el elemento; idempotente. */
  destroy() {
    for (const [id, fn] of this._handlers) {
      if (id === '__select__') {
        this._element?.removeEventListener('change', fn);
      } else {
        this._buttons.get(id)?.removeEventListener('click', fn);
      }
    }
    this._handlers.clear();
    this._buttons.clear();
    this._removeAppliedBodyClass();
    this._element.remove();
  }

  _removeAppliedBodyClass() {
    if (this._appliedBodyClass && typeof document !== 'undefined' && document.body) {
      document.body.classList.remove(this._appliedBodyClass);
    }
    this._appliedBodyClass = null;
  }

  _apply(themeId, { fromUser }) {
    this._value = themeId;
    if (themeId === 'dark') {
      // 'dark' es el :root (sin atributo): así el default de la página no
      // depende de que el atributo exista.
      this._root.removeAttribute('data-theme');
    } else {
      this._root.setAttribute('data-theme', themeId);
    }

    // bodyClass (politica de dueno unico): la del tema activo vive, la anterior
    // sale. El switcher es el DUENO de esa clase mientras exista.
    const bodyClass = this._themes.find((t) => t.id === themeId)?.bodyClass ?? null;
    if (typeof document !== 'undefined' && document.body) {
      if (this._appliedBodyClass && this._appliedBodyClass !== bodyClass) {
        document.body.classList.remove(this._appliedBodyClass);
      }
      if (bodyClass) document.body.classList.add(bodyClass);
    }
    this._appliedBodyClass = bodyClass;

    if (this._variant === 'select') {
      if (this._element.value !== themeId) this._element.value = themeId;
    } else {
      for (const [id, btn] of this._buttons) {
        btn.classList.toggle('is-active', id === themeId);
        btn.setAttribute('aria-pressed', id === themeId ? 'true' : 'false');
      }
    }
    if (this._storageKey) {
      try { localStorage.setItem(this._storageKey, themeId); } catch { /* sandbox */ }
    }
    if (fromUser) this._onChange?.(themeId, this._payloads.get(themeId));
  }

  _readStorage() {
    try {
      const v = localStorage.getItem(this._storageKey);
      return this._buttons.has(v) ? v : null;
    } catch { return null; }
  }
}
