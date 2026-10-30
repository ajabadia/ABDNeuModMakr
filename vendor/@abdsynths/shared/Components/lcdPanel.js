/**
 * LcdPanel — composicion: pantalla + maquina + D-pad.
 * =====================================================
 *
 * Es la pieza que en cada synth se reescribia: el teclado de navegacion con
 * auto-repeticion (CZ101 lo tiene en holdRepeat.js, el nativo lo tenia en el
 * Editor). Aqui vive UNA vez: botones MENU/OK y cursores ‹ › ^ v con
 * hold-repeat (initial 400ms, repeat 120ms — tacto de hardware), que conducen
 * la maquina pura y repintan la pantalla.
 *
 * La composicion es OPCIONAL por pieza: un synth puede usar solo
 * createLcdScreen (readout sin menu) o solo createLcdMachine (con su propio
 * hardware de botones). El panel completo es el camino rapido del 8.3.
 */

import { createLcdMachine } from './lcdMachine.js';
import { createLcdScreen } from './lcdScreen.js';

/**
 * @param {HTMLElement|string} container
 * @param {object} options
 *   menu                arbol de items de la maquina (ver lcdMachine).
 *   hooks               onEdit/onAction/onPreview/onIdle del synth.
 *   lines               lineas de la pantalla, default 2.
 *   widthChars          caracteres por linea, default 16.
 *   repeat              hold-repeat del D-pad: { initial: 400, interval: 120 }.
 *   idle                lineas de reposo: () => [linea1, linea2].
 *   editValue           texto del valor en EDIT (el synth lo formatea).
 *   onIdleLinesChange   aviso para repintar el reposo.
 *   screen              opciones extra para createLcdScreen, tal cual.
 */
export function createLcdPanel(container, options = {}) {
  const {
    menu = [],                 // arbol de items (lcdMachine)
    hooks = {},                // onEdit/onAction/onPreview/onIdle del synth
    lines = 2,
    widthChars = 16,
    repeat = { initial: 400, interval: 120 },
    idle = () => ['', ''],     // lineas de reposo (preset/banco del synth)
    editValue = () => '',      // texto del valor en EDIT (el synth lo formatea)
    onIdleLinesChange = null,  // aviso para repintar el reposo
  } = options;

  // --- DOM: pantalla + teclado ---
  const screenWrap = document.createElement('div');
  screenWrap.className = 'abd-lcd-panel__screen';
  const screen = createLcdScreen(screenWrap, { lines, widthChars, ...options.screen });

  const pad = document.createElement('div');
  pad.className = 'abd-lcd-panel__pad';
  const buttons = {};
  // GLYPH_NAMES: the D-pad paints single-glyph buttons; the accessible name
  // spells what they do (a bare '<' or '^' reads as "less than" / "caret").
  const GLYPH_NAMES = { menu: 'Menu', ok: 'OK', left: 'Cursor left', right: 'Cursor right', up: 'Cursor up', down: 'Cursor down' };
  for (const [key, label] of [['menu', 'MENU'], ['ok', 'OK'], ['left', '‹'], ['right', '›'], ['up', '^'], ['down', 'v']]) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `abd-lcd-panel__btn abd-lcd-panel__btn--${key}`;
    btn.textContent = label;
    btn.setAttribute('aria-label', GLYPH_NAMES[key]);
    pad.append(btn);
    buttons[key] = btn;
  }
  container.append(screenWrap, pad);

  // --- Maquina + refresco de pantalla ---
  const machine = createLcdMachine(menu, hooks);

  const paint = () => {
    if (machine.state === 'idle') {
      const [l1, l2] = idle(machine) ?? ['', ''];
      screen.setLine(0, l1);
      screen.setLine(1, l2);
      return;
    }
    const valueText = machine.state === 'edit' ? String(editValue(machine.editing) ?? '') : '';
    const [l1, l2] = machine.renderLines({ editValue: valueText });
    screen.setLine(0, l1);
    screen.setLine(1, l2);
  };

  const dispatch = (action) => () => {
    action();
    paint();
  };

  // --- hold-repeat (patron de la casa, copia del contrato de CZ101) ---
  function attachHoldRepeat(el, fire) {
    if (!el) return () => {};
    let holdTimer = null;
    let repeatTimer = null;
    const clear = () => {
      if (holdTimer) clearTimeout(holdTimer);
      if (repeatTimer) clearInterval(repeatTimer);
      holdTimer = null; repeatTimer = null;
    };
    const start = (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      fire();
      clear();
      holdTimer = setTimeout(() => { repeatTimer = setInterval(fire, repeat.interval); }, repeat.initial);
    };
    const end = () => clear();
    el.addEventListener('pointerdown', start);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      clear();
      el.removeEventListener('pointerdown', start);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }

  const detachers = [
    attachHoldRepeat(buttons.menu, dispatch(machine.onMenuPress.bind(machine))),
    attachHoldRepeat(buttons.ok, dispatch(machine.onOkPress.bind(machine))),
    attachHoldRepeat(buttons.left, dispatch(() => machine.onArrow('left'))),
    attachHoldRepeat(buttons.right, dispatch(() => machine.onArrow('right'))),
    attachHoldRepeat(buttons.up, dispatch(() => machine.onArrow('up'))),
    attachHoldRepeat(buttons.down, dispatch(() => machine.onArrow('down'))),
  ];

  paint();

  return {
    /** La pantalla (setLine/preview/message/...) para los avisos del synth. */
    screen,
    /** La maquina (snapshot/setValue-less: onMenuPress/onOkPress/onArrow...). */
    machine,
    /** Repintar tras un cambio de estado del synth (preset cargado...). */
    repaint: paint,
    /** Los botones del D-pad (por si el synth quiere decorarlos). */
    buttons,
    destroy() {
      for (const detach of detachers) detach();
      screen.destroy();
      screenWrap.remove();
      pad.remove();
    },
  };
}
