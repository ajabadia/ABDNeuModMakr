import { describe, expect, it } from 'vitest';
import { computeFit, mountFitStage } from './FitStage.js';

function fakeViewport(w = 1409, h = 768) {
  const listeners = new Map();
  return {
    listeners,
    innerWidth: w,
    innerHeight: h,
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name),
    fire(name) {
      for (const fn of listeners.values()) fn();
    },
  };
}

describe('FitStage Component (ABDShared)', () => {
  const DESIGN = { width: 1409, height: 768 };

  it('calcula la escala y centrado para dimensiones idénticas al diseño', () => {
    const res = computeFit({
      viewportWidth: 1409,
      viewportHeight: 768,
      designWidth: 1409,
      designHeight: 768,
    });
    expect(res.scale).toBe(1);
    expect(res.offsetX).toBe(0);
    expect(res.offsetY).toBe(0);
  });

  it('calcula reducción a escala 0.5 cuando el viewport es la mitad', () => {
    const res = computeFit({
      viewportWidth: 704.5,
      viewportHeight: 384,
      designWidth: 1409,
      designHeight: 768,
    });
    expect(res.scale).toBeCloseTo(0.5, 3);
    expect(res.offsetX).toBe(0);
    expect(res.offsetY).toBe(0);
  });

  it('centra el eje sobrante cuando la relación de aspecto no coincide', () => {
    const res = computeFit({
      viewportWidth: 2000,
      viewportHeight: 768,
      designWidth: 1409,
      designHeight: 768,
    });
    expect(res.scale).toBe(1);
    expect(res.offsetX).toBeCloseTo((2000 - 1409) / 2, 1);
    expect(res.offsetY).toBe(0);
  });

  it('respeta minScale y maxScale', () => {
    const resMin = computeFit({
      viewportWidth: 100,
      viewportHeight: 100,
      designWidth: 1000,
      designHeight: 1000,
      minScale: 0.25,
    });
    expect(resMin.scale).toBe(0.25);

    const resMax = computeFit({
      viewportWidth: 10000,
      viewportHeight: 10000,
      designWidth: 1000,
      designHeight: 1000,
      maxScale: 2.0,
    });
    expect(resMax.scale).toBe(2.0);
  });

  it('mountFitStage aplica estilos limpios en escala 1 y transforma al escalar', () => {
    const stage = { style: {} };
    const viewport = fakeViewport(1409, 768);

    const detach = mountFitStage(stage, { ...DESIGN, viewport });

    expect(stage.style.transform).toBe('');
    expect(stage.style.marginLeft).toBe('0px');
    expect(stage.style.marginTop).toBe('0px');

    viewport.innerWidth = 704.5;
    viewport.innerHeight = 384;
    viewport.fire('resize');

    expect(stage.style.transform).toBe('scale(0.5)');

    detach();
    viewport.innerWidth = 2000;
    viewport.fire('resize');
    expect(stage.style.transform).toBe('scale(0.5)'); // no cambia tras detach
  });
});
