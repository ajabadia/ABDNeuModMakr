// @vitest-environment jsdom
/**
 * Tests de LiveSysExInspector (componente transversal reutilizable).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../tests/setup.js';
import {
  LiveSysExInspector,
  createLiveSysExInspector,
  decodeSysExHeader,
  toHexByte,
} from './LiveSysExInspector.js';

describe('LiveSysExInspector - Helpers', () => {
  it('toHexByte formatea correctamente a dos digitos mayusculas', () => {
    expect(toHexByte(0)).toBe('00');
    expect(toHexByte(10)).toBe('0A');
    expect(toHexByte(15)).toBe('0F');
    expect(toHexByte(240)).toBe('F0');
    expect(toHexByte(255)).toBe('FF');
  });

  it('decodeSysExHeader rechaza buffers invalidos o sin F0', () => {
    expect(decodeSysExHeader(null).valid).toBe(false);
    expect(decodeSysExHeader(new Uint8Array([0x00])).valid).toBe(false);
    expect(decodeSysExHeader(new Uint8Array([0x80, 0x01])).valid).toBe(false);
  });

  it('decodeSysExHeader reconoce tramas Casio CZ-Series', () => {
    const czPatch = new Uint8Array([0xf0, 0x44, 0x01, 0x00, 0x70, 0x00, 0x10, 0xf7]);
    const decoded = decodeSysExHeader(czPatch);
    expect(decoded.valid).toBe(true);
    expect(decoded.manufacturer).toContain('Casio');
    expect(decoded.model).toBe('CZ-Series');
    expect(decoded.deviceId).toBe('0x01');
    expect(decoded.hasEox).toBe(true);
  });

  it('decodeSysExHeader reconoce tramas Korg MS2000', () => {
    const korgPatch = new Uint8Array([0xf0, 0x42, 0x30, 0x58, 0x40, 0xf7]);
    const decoded = decodeSysExHeader(korgPatch);
    expect(decoded.valid).toBe(true);
    expect(decoded.manufacturer).toContain('Korg');
    expect(decoded.model).toBe('MS2000');
    expect(decoded.hasEox).toBe(true);
  });
});

describe('LiveSysExInspector - DOM & Reactividad', () => {
  let slot;

  beforeEach(() => {
    vi.useFakeTimers();
    slot = document.createElement('div');
    document.body.appendChild(slot);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('se monta e inicializa correctamente en el contenedor', () => {
    const fakeSysEx = new Uint8Array([0xf0, 0x44, 0x01, 0x00, 0x70, 0xf7]);
    const inspector = createLiveSysExInspector({
      container: slot,
      title: 'CZ101 Inspector',
      initialBuffer: fakeSysEx,
    });

    const root = slot.querySelector('.sysex-inspector');
    expect(root).not.toBeNull();
    expect(root.querySelector('.sysex-inspector__title').textContent).toBe('CZ101 Inspector');
    expect(root.querySelector('.sysex-inspector__badge--size').textContent).toBe('6 B');

    // Comprobamos celdas hex
    const bytes = root.querySelectorAll('.sysex-byte');
    expect(bytes.length).toBeGreaterThanOrEqual(6);
    expect(bytes[0].classList.contains('sysex-byte--sof')).toBe(true); // F0
    expect(bytes[5].classList.contains('sysex-byte--eof')).toBe(true); // F7

    inspector.destroy();
    expect(slot.querySelector('.sysex-inspector')).toBeNull();
  });

  it('detecta y resalta mutaciones byte a byte al actualizar el buffer', () => {
    const initial = new Uint8Array([0xf0, 0x44, 0x01, 0x00, 0x70, 0x00, 0xf7]);
    const inspector = new LiveSysExInspector({
      container: slot,
      initialBuffer: initial,
    });

    // Mutamos el byte 5 (de 0x00 a 0x7F)
    const mutated = new Uint8Array([0xf0, 0x44, 0x01, 0x00, 0x70, 0x7f, 0xf7]);
    inspector.updateBuffer(mutated);

    const byte5 = slot.querySelector('.sysex-byte[data-offset="5"]');
    expect(byte5).not.toBeNull();
    expect(byte5.textContent).toBe('7F');
    expect(byte5.classList.contains('sysex-byte--mutated')).toBe(true);

    // Tras 800ms el efecto pulso de mutación expira
    vi.advanceTimersByTime(850);
    expect(byte5.classList.contains('sysex-byte--mutated')).toBe(false);

    inspector.destroy();
  });

  it('soporta captura de Snapshot A y modo Diff A/B', () => {
    const bufA = new Uint8Array([0xf0, 0x44, 0x01, 0x00, 0x10, 0x20, 0xf7]);
    const inspector = new LiveSysExInspector({
      container: slot,
      initialBuffer: bufA,
    });

    // Capturar snapshot A
    inspector.captureSnapshotA();
    expect(inspector.snapshotA).toEqual(bufA);
    expect(inspector.diffMode).toBe(true);

    // Cambiar dos bytes en el buffer activo B
    const bufB = new Uint8Array([0xf0, 0x44, 0x01, 0x00, 0x15, 0x29, 0xf7]);
    inspector.updateBuffer(bufB);

    const diffBadge = slot.querySelector('.sysex-inspector__badge--diff');
    expect(diffBadge.style.display).not.toBe('none');
    expect(diffBadge.textContent).toBe('Δ 2 B');

    const byte4 = slot.querySelector('.sysex-byte[data-offset="4"]');
    const byte5 = slot.querySelector('.sysex-byte[data-offset="5"]');
    expect(byte4.classList.contains('sysex-byte--diff')).toBe(true);
    expect(byte5.classList.contains('sysex-byte--diff')).toBe(true);

    // Desactivar diff
    inspector.toggleDiff(false);
    expect(inspector.diffMode).toBe(false);
    expect(diffBadge.style.display).toBe('none');

    inspector.destroy();
  });

  it('permite copiar en formato Hex y Array literal', () => {
    const buf = new Uint8Array([0xf0, 0x44, 0x01, 0xf7]);
    const inspector = new LiveSysExInspector({
      container: slot,
      initialBuffer: buf,
    });

    let copiedText = '';
    const originalClipboard = navigator.clipboard;
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn((txt) => {
          copiedText = txt;
          return Promise.resolve();
        }),
      },
    });

    inspector.copyHex();
    expect(copiedText).toBe('F0 44 01 F7');

    inspector.copyArray();
    expect(copiedText).toBe('[0xF0, 0x44, 0x01, 0xF7]');

    Object.assign(navigator, { clipboard: originalClipboard });
    inspector.destroy();
  });

  it('exportSyx invoca el callback onExport con el Blob binario correspondiente', () => {
    const buf = new Uint8Array([0xf0, 0x44, 0x01, 0xf7]);
    let exportedBlob = null;
    let exportedFilename = '';

    const inspector = new LiveSysExInspector({
      container: slot,
      initialBuffer: buf,
      onExport: (blob, filename) => {
        exportedBlob = blob;
        exportedFilename = filename;
      },
    });

    inspector.exportSyx('custom_patch.syx');
    expect(exportedFilename).toBe('custom_patch.syx');
    expect(exportedBlob).not.toBeNull();
    expect(exportedBlob.size).toBe(4);

    inspector.destroy();
  });

  it('proporciona interface formal show, hide, toggle, isOpen, setBuffer y getBuffer', () => {
    const buf = new Uint8Array([0xf0, 0x44, 0x01, 0xf7]);
    let opened = false;
    let closed = false;

    const inspector = createLiveSysExInspector({
      container: slot,
      initialBuffer: buf,
      onOpen: () => { opened = true; },
      onClose: () => { closed = true; },
    });

    expect(inspector.isOpen()).toBe(true);

    inspector.hide();
    expect(inspector.isOpen()).toBe(false);
    expect(closed).toBe(true);
    expect(inspector.rootEl.style.display).toBe('none');

    inspector.show();
    expect(inspector.isOpen()).toBe(true);
    expect(opened).toBe(true);
    expect(inspector.rootEl.style.display).toBe('flex');

    inspector.toggle();
    expect(inspector.isOpen()).toBe(false);

    inspector.toggle();
    expect(inspector.isOpen()).toBe(true);

    // Buffer access
    const newBuf = new Uint8Array([0xf0, 0x44, 0x02, 0x10, 0xf7]);
    inspector.setBuffer(newBuf);
    expect(inspector.getBuffer()).toEqual(newBuf);

    inspector.destroy();
  });

  it('el boton de cierre oculta la ventana sin destruirla', () => {
    let closed = false;
    const inspector = createLiveSysExInspector({
      floating: true,
      onClose: () => { closed = true; },
    });

    expect(inspector.isOpen()).toBe(true);

    const closeBtn = inspector.rootEl.querySelector('.sysex-inspector__btn--close');
    expect(closeBtn).not.toBeNull();
    closeBtn.click();

    expect(closed).toBe(true);
    expect(inspector.isOpen()).toBe(false);
    expect(inspector.isDestroyed).toBe(false);

    // Puede reabrirse sin problemas
    inspector.show();
    expect(inspector.isOpen()).toBe(true);

    inspector.destroy();
  });

  it('pulsar Escape oculta el inspector si esta abierto', () => {
    const inspector = createLiveSysExInspector({
      floating: true,
    });
    expect(inspector.isOpen()).toBe(true);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(inspector.isOpen()).toBe(false);

    inspector.destroy();
  });

  it('control estricto de colisión: el arrastre clampa el inspector dentro del viewport sin quedar semioculto', () => {
    const inspector = createLiveSysExInspector({
      floating: true,
    });

    // Mock getBoundingClientRect
    inspector.rootEl.getBoundingClientRect = () => ({
      left: 100,
      top: 100,
      width: 720,
      height: 400,
      right: 820,
      bottom: 500,
    });

    // Disparar pointerdown en el header
    inspector.headerEl.dispatchEvent(new PointerEvent('pointerdown', { clientX: 120, clientY: 110 }));

    // Intentar arrastrar 5000px hacia la derecha y hacia abajo (muy fuera de la pantalla)
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 5120, clientY: 5110 }));

    const leftVal = parseInt(inspector.rootEl.style.left, 10);
    const topVal = parseInt(inspector.rootEl.style.top, 10);

    // Con window.innerWidth por defecto (1024 en jsdom) y rect.width 720, el máximo left debe ser <= 1024 - 720 - 8 = 296
    expect(leftVal).toBeLessThanOrEqual(window.innerWidth - 720);
    expect(leftVal).toBeGreaterThanOrEqual(8);
    expect(topVal).toBeLessThanOrEqual(window.innerHeight - 400);
    expect(topVal).toBeGreaterThanOrEqual(8);

    window.dispatchEvent(new PointerEvent('pointerup'));
    inspector.destroy();
  });

  it('popout y dock desacoplan a ventana externa y reincorporan al sintetizador', () => {
    const inspector = createLiveSysExInspector({
      floating: true,
      title: 'Test Inspector',
    });

    const mockExternalDoc = {
      title: '',
      head: {
        innerHTML: '',
        appendChild: vi.fn(),
      },
      body: {
        appendChild: vi.fn((node) => {
          node._inExternalDoc = true;
        }),
      },
    };

    const mockExternalWin = {
      closed: false,
      document: mockExternalDoc,
      addEventListener: vi.fn(),
      close: vi.fn(),
    };

    const originalOpen = window.open;
    window.open = vi.fn(() => mockExternalWin);

    expect(inspector.isDetached).toBe(false);

    // Desacoplar
    inspector.popout();
    expect(inspector.isDetached).toBe(true);
    expect(inspector.rootEl.classList.contains('sysex-inspector--detached')).toBe(true);
    expect(mockExternalDoc.body.appendChild).toHaveBeenCalledWith(inspector.rootEl);

    // Reincorporar (dock)
    inspector.dock();
    expect(inspector.isDetached).toBe(false);
    expect(inspector.rootEl.classList.contains('sysex-inspector--detached')).toBe(false);
    expect(mockExternalWin.close).toHaveBeenCalled();

    window.open = originalOpen;
    inspector.destroy();
  });
});


