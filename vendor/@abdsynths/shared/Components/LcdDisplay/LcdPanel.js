/**
 * LcdPanel — composición: pantalla + máquina + D-pad.
 * ====================================================
 */

import { createLcdMachine } from './LcdMachine.js';
import { createLcdScreen } from './LcdScreen.js';

export function createLcdPanel(container, options = {}) {
  const {
    menu = [],
    hooks = {},
    lines = 2,
    widthChars = 16,
    repeat = { initial: 400, interval: 120 },
    idle = () => ['', ''],
    editValue = () => '',
    onIdleLinesChange = null,
  } = options;

  const targetContainer = typeof container === 'string'
    ? document.querySelector(container)
    : container;

  const screenWrap = document.createElement('div');
  screenWrap.className = 'abd-lcd-panel__screen';
  const screen = createLcdScreen(screenWrap, { lines, widthChars, ...options.screen });

  const pad = document.createElement('div');
  pad.className = 'abd-lcd-panel__pad';
  const buttons = {};
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
  targetContainer.append(screenWrap, pad);

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
    screen,
    machine,
    repaint: paint,
    buttons,
    destroy() {
      for (const detach of detachers) detach();
      screen.destroy();
      screenWrap.remove();
      pad.remove();
    },
  };
}
