import { describe, expect, it, vi } from 'vitest';
import {
  createLcdScreen,
  createLcdMachine,
  createLcdPanel,
  formatValue,
  SevenSegmentDisplay,
} from './index.js';

describe('LcdDisplay Family (ABDShared)', () => {
  it('formatValue formatea booleanos, números con decimales y choices', () => {
    expect(formatValue(1, { type: 'bool' })).toBe('ON');
    expect(formatValue(0, { type: 'bool' })).toBe('OFF');
    expect(formatValue(440, { unit: 'Hz', decimals: 1 })).toBe('440.0 Hz');
    expect(formatValue(1, { choices: [{ label: 'Saw' }, { label: 'Square' }] })).toBe('Square');
  });

  it('createLcdMachine navega por menú, submenús y entra en modo edit', () => {
    const onAction = vi.fn();
    const onEdit = vi.fn();

    const menu = [
      {
        label: 'Oscillator',
        sub: [
          { label: 'Wave', paramId: 'OSC_WAVE' },
          { label: 'Tune', paramId: 'OSC_TUNE' },
        ],
      },
      {
        label: 'Init',
        type: 'action',
      },
    ];

    const machine = createLcdMachine(menu, { onAction, onEdit });
    expect(machine.state).toBe('idle');

    // Pulsar MENU entra en navegación
    machine.onMenuPress();
    expect(machine.state).toBe('navigation');
    expect(machine.currentItem().label).toBe('Oscillator');

    // Pulsar OK entra en el submenú Oscillator
    machine.onOkPress();
    expect(machine.currentItem().label).toBe('Wave');

    // Pulsar OK entra en modo EDIT
    machine.onOkPress();
    expect(machine.state).toBe('edit');
    expect(machine.editing.paramId).toBe('OSC_WAVE');

    // Girar encoder dispara onEdit
    machine.onEncoderRotate(1);
    expect(onEdit).toHaveBeenCalledWith('OSC_WAVE', 1, expect.anything());

    // Pulsar MENU sale de EDIT a navigation
    machine.onMenuPress();
    expect(machine.state).toBe('navigation');
  });

  it('createLcdScreen crea elementos DOM y actualiza texto de líneas', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const screen = createLcdScreen(container, { lines: 2, widthChars: 16 });
    expect(container.querySelector('.abd-lcd')).not.toBeNull();

    screen.setLine(0, 'INIT PATCH');
    screen.setLine(1, 'BANK A - 01');

    const lines = container.querySelectorAll('.abd-lcd__line');
    expect(lines[0].textContent).toBe('INIT PATCH');
    expect(lines[1].textContent).toBe('BANK A - 01');

    screen.destroy();
    document.body.removeChild(container);
  });

  it('SevenSegmentDisplay inicializa los dígitos y formatea el valor', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const seg = new SevenSegmentDisplay(container, { digits: 3, value: '42' });
    const digits = container.querySelectorAll('.abd-seven-seg__digit');
    expect(digits.length).toBe(3);
    expect(digits[0].textContent).toBe(' ');
    expect(digits[1].textContent).toBe('4');
    expect(digits[2].textContent).toBe('2');

    seg.setValue('128');
    expect(digits[0].textContent).toBe('1');
    expect(digits[1].textContent).toBe('2');
    expect(digits[2].textContent).toBe('8');

    seg.destroy();
    document.body.removeChild(container);
  });
});
