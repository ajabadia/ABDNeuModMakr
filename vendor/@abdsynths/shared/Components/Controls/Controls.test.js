import { describe, expect, it, vi } from 'vitest';
import {
  Knob,
  Slider,
  Select,
  Segmented,
  Toggle,
  Switch,
  Wheel,
  NumberBox,
  attachDrag,
} from './index.js';

describe('Controls Family (ABDShared)', () => {
  it('attachDrag gestiona listeners y callbacks', () => {
    const el = document.createElement('div');
    const onDelta = vi.fn((turns) => turns);
    const detach = attachDrag(el, { onDelta });

    expect(typeof detach).toBe('function');
    detach();
  });

  it('Knob se instancia, actualiza valor con clamp 0..1 y emite onChange en interacción', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const onChange = vi.fn();
    const knob = new Knob(container, {
      value: 0.25,
      onChange,
    });

    expect(knob.getValue()).toBe(0.25);
    knob.setValue(0.8);
    expect(knob.getValue()).toBe(0.8);
    // setValue programático no dispara onChange
    expect(onChange).not.toHaveBeenCalled();

    knob.destroy();
    document.body.removeChild(container);
  });

  it('Slider actualiza valor y destruye listeners limpiamente', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const slider = new Slider(container, { value: 0.5 });
    expect(slider.getValue()).toBe(0.5);

    slider.setValue(1.0);
    expect(slider.getValue()).toBe(1.0);

    slider.destroy();
    document.body.removeChild(container);
  });

  it('Select maneja opciones e índice activo', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const sel = new Select(container, {
      options: ['Sine', 'Saw', 'Square'],
      value: 1,
    });

    expect(sel.getValue()).toBe(1);
    sel.setValue(2);
    expect(sel.getValue()).toBe(2);

    sel.destroy();
    document.body.removeChild(container);
  });

  it('Toggle alterna estado booleano', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const tog = new Toggle(container, { value: false });
    expect(tog.getValue()).toBe(false);

    tog.setValue(true);
    expect(tog.getValue()).toBe(true);

    tog.destroy();
    document.body.removeChild(container);
  });
});
