/**
 * LcdScreen — la pantalla del LCD (DOM), universal para la suite.
 * ================================================================
 *
 * Composicion de tres piezas heredadas:
 *   - CZ101 (WebUI/src/ui/lcdScroller.js): el autoscroll PING-PONG caracter a
 *     caracter (el texto largo se desplaza, pausa en los extremos y vuelve),
 *     con velocidad/pausa configurables. Corte por presupuesto de caracteres
 *     (medición real del ancho con fallback `widthChars` para jsdom/QA).
 *   - NEURONiK nativo (LcdDisplay.h): `showParameterPreview` — un valor aparece
 *     N ticks y la pantalla vuelve a su reposo (defaults ~2.2 s). Aquí
 *     `preview(line, text, { durationMs })`.
 *   - ABDEep (script_lcd_core.js): los avisos transitorios son una COLA con
 *     prioridad (menor número = gana) y expiración. `message(text, opts)` y su
 *     cola se llevan a la línea 0; los mensajes cortos no disparan scroll.
 *
 * Sin saber nada del synth: puro DOM + timers, inyectable y destruyible.
 * La maquina de estados (lcdMachine.js) es opcional y va aparte.
 *
 * Usage:
 *   const lcd = createLcdScreen(el, { lines: 2 });
 *   lcd.setLine(0, 'PITCH +1.2');
 *   lcd.message('save', 'GUARDADO', { priority: 1 });
 *   lcd.preview(1, 'CARGANDO', { durationMs: 800 });   // transitorio, vuelve solo
 *   lcd.clearMessage('save');                          // al cancelar la operacion
 *   lcd.destroy();
 */

const DEFAULTS = {
  lines: 2,             // 16x2 clasico; algunos synths usan 20x2 o 40x2
  widthChars: 16,       // presupuesto por linea (fallback de medicion)
  scrollStepMs: 180,    // un caracter por tick (tactil LCD, como CZ101)
  scrollPauseMs: 2000,  // pausa antes de empezar a desplazar (como CZ101)
  previewMs: 2200,      // duracion del preview (como LcdDisplay.h: 15 ticks @150ms)
};

export function createLcdScreen(container, options = {}) {
  const opts = { ...DEFAULTS, ...options };

  // --- DOM: contenedor .abd-lcd con N filas .abd-lcd__line ---
  const root = document.createElement('div');
  root.className = 'abd-lcd';
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');

  const lineEls = [];
  for (let i = 0; i < opts.lines; i += 1) {
    const line = document.createElement('div');
    line.className = 'abd-lcd__line';
    line.textContent = '';
    root.append(line);
    lineEls.push(line);
  }
  container.append(root);

  // --- Estado de la pantalla ---
  // base: el texto de reposo de cada linea (el synth lo pone con setLine).
  // preview: texto temporal con expiracion (linea a linea).
  // queue: la cola ABDEep de mensajes transitorios (se pintan en la linea 0).
  const base = new Array(opts.lines).fill('');
  const previewState = new Array(opts.lines).fill(null); // { text, timer }
  const queue = new Map(); // id -> { text, priority, timestamp, timer }
  let activeOverlay = null; // el mensaje ganador (fuera del mapa: no compite)
  const scroll = new Array(opts.lines).fill(null); // { pos, dir, timer }
  const timers = new Set();

  const measure = () => {
    if (typeof opts.measure === 'function') return opts.measure();
    const cs = typeof getComputedStyle === 'function' ? getComputedStyle(root) : null;
    const fs = cs ? parseFloat(cs.fontSize) : 10;
    const w = root.clientWidth || 0;
    // Un mono de LCD ronda 0.6em de avance por caracter; el escroller de CZ101
    // mide el elemento real — aqui basta el budget si no hay layout (jsdom).
    const budget = w > 0 ? Math.max(1, Math.floor(w / (fs * 0.6))) : 0;
    return budget > 0 ? budget : opts.widthChars;
  };

  const later = (fn, ms) => {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
    return id;
  };

  const stopScroll = (lineIdx) => {
    const s = scroll[lineIdx];
    if (s && s.timer) {
      clearTimeout(s.timer);
      timers.delete(s.timer);
    }
    scroll[lineIdx] = null;
  };

  const paint = (lineIdx) => {
    const text = previewState[lineIdx]?.text
      ?? (lineIdx === 0 ? activeOverlay?.text ?? base[lineIdx] : base[lineIdx]);
    const el = lineEls[lineIdx];
    if (!el) return;

    const budget = opts.measure ? opts.measure() : measure();
    const chars = Math.max(1, budget);

    // Texto corto: sin scroll — el caso tipico (CZ101 no desplaza lo que cabe).
    if (text.length <= chars) {
      stopScroll(lineIdx);
      el.textContent = text;
      return;
    }

    // Texto largo: ping-pong caracter a caracter.
    const startScroll = (fromPos, fromDir) => {
      stopScroll(lineIdx);
      const state = { pos: fromPos, dir: fromDir, timer: null };
      scroll[lineIdx] = state;
      const step = () => {
        state.pos += state.dir;
        if (state.pos <= 0) { state.pos = 0; state.dir = 1; }
        const maxPos = Math.max(0, text.length - chars);
        if (state.pos >= maxPos) { state.pos = maxPos; state.dir = -1; }
        el.textContent = text.slice(state.pos, state.pos + chars);
        state.timer = later(step, opts.scrollStepMs);
      };
      el.textContent = text.slice(state.pos, state.pos + chars);
      state.timer = later(step, opts.scrollPauseMs); // later() ya lo registra
    };
    startScroll(0, 1);
  };

  const repaintAll = () => { for (let i = 0; i < opts.lines; i += 1) paint(i); };

  const clearPreview = (lineIdx) => {
    if (previewState[lineIdx]) {
      clearTimeout(previewState[lineIdx].timer);
      timers.delete(previewState[lineIdx].timer);
      previewState[lineIdx] = null;
    }
  };

  const refreshQueue = () => {
    // Prioridad menor gana; a igualdad, el mas reciente.
    activeOverlay = [...queue.values()]
      .sort((a, b) => (a.priority - b.priority) || (b.timestamp - a.timestamp))[0] ?? null;
    paint(0); // la cola vive en la linea 0
  };

  // ================= API =================

  /**
   * Texto de reposo de una linea (el synth repinta tras cada cambio).
   * @param {number} lineIdx  linea afectada.
   * @param {string} text
   */
  function setLine(lineIdx, text) {
    base[lineIdx] = String(text ?? '');
    clearPreview(lineIdx);
    paint(lineIdx);
  }

  /**
   * Preview transitorio (herencia LcdDisplay.h): aparece y vuelve al reposo.
   * @param {number} lineIdx linea afectada
   * @param {string} text texto temporal
   * @param {{ durationMs?: number }} [o] duracion (default previewMs)
   */
  function preview(lineIdx, text, o = {}) {
    clearPreview(lineIdx);
    previewState[lineIdx] = {
      text: String(text ?? ''),
      timer: later(() => {
        previewState[lineIdx] = null;
        paint(lineIdx);
      }, o.durationMs ?? opts.previewMs),
    };
    paint(lineIdx);
  }

  /**
   * Mensaje transitorio con cola ABDEep: prioridad menor gana; expira.
   * @param {string} id clave estable (nuevo push con el mismo id reemplaza)
   * @param {string} text
   * @param {{ priority?: number, durationMs?: number }} [o]
   */
  function message(id, text, o = {}) {
    const prev = queue.get(id);
    if (prev && prev.timer) {
      clearTimeout(prev.timer);
      timers.delete(prev.timer);
    }
    const entry = {
      text: String(text ?? ''),
      priority: o.priority ?? 5,
      timestamp: Date.now(),
      timer: null,
    };
    if (o.durationMs !== null) {
      entry.timer = later(() => {
        queue.delete(id);
        refreshQueue();
      }, o.durationMs ?? 2000);
    }
    queue.set(id, entry);
    refreshQueue();
  }

  /**
   * Quitar un mensaje concreto (p. ej. al cancelar una operacion).
   * @param {string} id
   */
  function clearMessage(id) {
    const e = queue.get(id);
    if (e && e.timer) { clearTimeout(e.timer); timers.delete(e.timer); }
    queue.delete(id);
    refreshQueue();
  }

  /** Limpiar previews y cola (p. ej. al cargar preset). El base se queda. */
  function reset() {
    for (let i = 0; i < opts.lines; i += 1) clearPreview(i);
    for (const [id, e] of queue) { if (e.timer) clearTimeout(e.timer); queue.delete(id); }
    activeOverlay = null;
    repaintAll();
  }

  /** destroy(): ningun timer vivo, ningun listener colgado. */
  function destroy() {
    for (const id of timers) clearTimeout(id);
    timers.clear();
    for (let i = 0; i < opts.lines; i += 1) { stopScroll(i); clearPreview(i); }
    root.remove();
  }

  return {
    root, setLine, preview, message, clearMessage, reset, destroy,
    /** Para QA/tests: presupuesto de caracteres actual de la pantalla. */
    _budget: measure,
  };
}
