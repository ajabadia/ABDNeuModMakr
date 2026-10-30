/**
 * LcdScreen — la pantalla del LCD (DOM), universal para la suite ABDSynths.
 * ========================================================================
 *
 * Características:
 * - Autoscroll ping-pong carácter a carácter para textos que exceden el ancho.
 * - Soporte para preview transitorio de parámetros (`preview(line, text, { durationMs })`).
 * - Cola de mensajes transitorios con prioridad y expiración (`message`, `clearMessage`).
 * - Destrucción limpia y segura de todos los timers.
 */

const DEFAULTS = {
  lines: 2,             // 16x2 clásico (o 20x2, 40x2)
  widthChars: 16,       // presupuesto de caracteres por línea
  scrollStepMs: 180,    // tick de avance de carácter
  scrollPauseMs: 2000,  // pausa en extremos
  previewMs: 2200,      // duración de preview de parámetro
};

export function createLcdScreen(container, options = {}) {
  const opts = { ...DEFAULTS, ...options };

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

  const base = new Array(opts.lines).fill('');
  const previewState = new Array(opts.lines).fill(null);
  const queue = new Map();
  let activeOverlay = null;
  const scroll = new Array(opts.lines).fill(null);
  const timers = new Set();

  const measure = () => {
    if (typeof opts.measure === 'function') return opts.measure();
    const cs = typeof getComputedStyle === 'function' ? getComputedStyle(root) : null;
    const fs = cs ? parseFloat(cs.fontSize) : 10;
    const w = root.clientWidth || 0;
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

    if (text.length <= chars) {
      stopScroll(lineIdx);
      el.textContent = text;
      return;
    }

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
      state.timer = later(step, opts.scrollPauseMs);
    };
    startScroll(0, 1);
  };

  const repaintAll = () => {
    for (let i = 0; i < opts.lines; i += 1) paint(i);
  };

  const clearPreview = (lineIdx) => {
    if (previewState[lineIdx]) {
      clearTimeout(previewState[lineIdx].timer);
      timers.delete(previewState[lineIdx].timer);
      previewState[lineIdx] = null;
    }
  };

  const refreshQueue = () => {
    activeOverlay = [...queue.values()]
      .sort((a, b) => (a.priority - b.priority) || (b.timestamp - a.timestamp))[0] ?? null;
    paint(0);
  };

  function setLine(lineIdx, text) {
    base[lineIdx] = String(text ?? '');
    clearPreview(lineIdx);
    paint(lineIdx);
  }

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

  function clearMessage(id) {
    const e = queue.get(id);
    if (e && e.timer) { clearTimeout(e.timer); timers.delete(e.timer); }
    queue.delete(id);
    refreshQueue();
  }

  function reset() {
    for (let i = 0; i < opts.lines; i += 1) clearPreview(i);
    for (const [id, e] of queue) { if (e.timer) clearTimeout(e.timer); queue.delete(id); }
    activeOverlay = null;
    repaintAll();
  }

  function destroy() {
    for (const id of timers) clearTimeout(id);
    timers.clear();
    for (let i = 0; i < opts.lines; i += 1) { stopScroll(i); clearPreview(i); }
    root.remove();
  }

  return {
    root, setLine, preview, message, clearMessage, reset, destroy,
    _budget: measure,
  };
}
