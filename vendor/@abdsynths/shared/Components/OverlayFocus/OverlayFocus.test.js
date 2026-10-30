import { describe, expect, it, vi } from 'vitest';
import { createOverlayFocus, focusableWithin } from './OverlayFocus.js';

describe('OverlayFocus Component (ABDShared)', () => {
  it('detecta controles accesibles y descarta ocultos', () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <button id="btn1">Btn 1</button>
      <input id="in1" type="text" />
      <button id="btn-hidden" hidden>Hidden</button>
      <button id="btn-disabled" disabled>Disabled</button>
    `;
    document.body.appendChild(container);

    const controls = focusableWithin(container);
    expect(controls.map(c => c.id)).toEqual(['btn1', 'in1']);
    document.body.removeChild(container);
  });

  it('gestiona setInert y releaseInert con atributos WAI-ARIA', () => {
    const root = document.createElement('div');
    let closed = true;
    const focusHelper = createOverlayFocus({
      root,
      isClosed: () => closed,
    });

    focusHelper.setInert();
    expect(root.hasAttribute('inert')).toBe(true);
    expect(root.getAttribute('aria-hidden')).toBe('true');

    focusHelper.releaseInert();
    expect(root.hasAttribute('inert')).toBe(false);
    expect(root.getAttribute('aria-hidden')).toBe('false');
  });

  it('dispara onEscape sólo cuando no está cerrado', () => {
    const root = document.createElement('div');
    let closed = true;
    const onEscape = vi.fn();
    const focusHelper = createOverlayFocus({
      root,
      isClosed: () => closed,
      onEscape,
    });

    focusHelper.handleKeydown({ key: 'Escape' });
    expect(onEscape).not.toHaveBeenCalled();

    closed = false;
    focusHelper.handleKeydown({ key: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });
});
