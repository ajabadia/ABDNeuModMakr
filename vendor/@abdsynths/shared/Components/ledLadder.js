/**
 * ABD LedLadder — Indicador vertical de LEDs discretos reutilizable para ABDSynths.
 * 
 * Diseñado según las convenciones de ABDShared:
 * - Renderiza una escala vertical de segmentos LED discretos (ladder/bar o dot).
 * - Soporta modo unipolar [0.0, 1.0] y bipolar [-1.0, +1.0] (cero central).
 * - Flechas direccionales opcionales (▲ / ▼) como en las consolas físicas de síntesis.
 * - Cero alocaciones de memoria durante setValue() para telemetría a 60 FPS.
 * - Estilado gobernado estrictamente por los tokens globales (--color-accent, etc.).
 * 
 * Uso:
 *   import { LedLadder } from '@abdsynths/shared/components/ledLadder.js';
 *   const ladder = new LedLadder(container, {
 *     segments: 10,
 *     mode: 'bar',       // 'bar' | 'dot'
 *     bipolar: false,
 *     showArrows: true,
 *   });
 *   ladder.setValue(0.75);
 *   ladder.destroy();
 */

export class LedLadder {
  /**
   * @param {HTMLElement|string} container
   * @param {object} [options]
   *   segments     Número de segmentos LED (default 10).
   *   mode         'bar' (acumulativo) o 'dot' (LED único activo), default 'bar'.
   *   bipolar      true para cero central [-1.0, +1.0], false para [0.0, 1.0] (default false).
   *   showArrows   true para incluir indicadores flecha superior e inferior (default true).
   *   width        ancho del segmento en px (default 16).
   *   segmentHeight alto de cada segmento en px (default 4).
   *   ariaLabel    etiqueta accesible (default 'LED Indicator').
   */
  constructor(container, options = {}) {
    this.container = typeof container === 'string'
      ? document.querySelector(container)
      : container;

    if (!this.container) throw new Error('LedLadder: container not found');

    this.options = {
      segments: options.segments ?? 10,
      mode: options.mode ?? 'bar',
      bipolar: Boolean(options.bipolar),
      showArrows: options.showArrows ?? true,
      width: options.width ?? 16,
      segmentHeight: options.segmentHeight ?? 4,
      ariaLabel: options.ariaLabel ?? 'LED Indicator',
      ...options,
    };

    this.numSegments = Math.max(2, this.options.segments);
    this.value = this.options.bipolar ? 0.0 : 0.0;
    this.segments = [];
    this.arrowUp = null;
    this.arrowDown = null;
    this._destroyed = false;

    this.buildDom();
    this.setValue(this.value);
  }

  buildDom() {
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'abd-led-ladder';
    this.wrapper.setAttribute('role', 'meter');
    this.wrapper.setAttribute('aria-label', this.options.ariaLabel);
    this.wrapper.setAttribute('aria-valuemin', this.options.bipolar ? '-1.0' : '0.0');
    this.wrapper.setAttribute('aria-valuemax', '1.0');
    this.wrapper.setAttribute('aria-valuenow', '0.0');

    // Flecha superior opcional
    if (this.options.showArrows) {
      this.arrowUp = document.createElement('div');
      this.arrowUp.className = 'abd-led-ladder__arrow abd-led-ladder__arrow--up';
      this.arrowUp.innerHTML = '&#9650;';
      this.wrapper.appendChild(this.arrowUp);
    }

    // Pista de segmentos (de abajo hacia arriba visualmente)
    this.track = document.createElement('div');
    this.track.className = 'abd-led-ladder__track';
    this.track.style.setProperty('--abd-led-width', `${this.options.width}px`);

    this.segments = new Array(this.numSegments);
    for (let i = 0; i < this.numSegments; i++) {
      const seg = document.createElement('div');
      seg.className = 'abd-led-ladder__segment';
      seg.style.setProperty('--abd-led-height', `${this.options.segmentHeight}px`);
      this.track.appendChild(seg);
      this.segments[i] = seg;
    }
    this.wrapper.appendChild(this.track);

    // Flecha inferior opcional
    if (this.options.showArrows) {
      this.arrowDown = document.createElement('div');
      this.arrowDown.className = 'abd-led-ladder__arrow abd-led-ladder__arrow--down';
      this.arrowDown.innerHTML = '&#9660;';
      this.wrapper.appendChild(this.arrowDown);
    }

    this.container.appendChild(this.wrapper);
  }

  /**
   * Actualiza el valor visual del ladder sin alocación dinámica de memoria.
   * @param {number} val  Valor normalizado: [0, 1] o [-1, +1] en modo bipolar.
   */
  setValue(val) {
    if (this._destroyed) return;
    const isBipolar = this.options.bipolar;
    const clamped = isBipolar
      ? Math.max(-1.0, Math.min(1.0, Number(val) || 0.0))
      : Math.max(0.0, Math.min(1.0, Number(val) || 0.0));

    this.value = clamped;
    this.wrapper.setAttribute('aria-valuenow', clamped.toFixed(3));

    const total = this.numSegments;
    const isDot = this.options.mode === 'dot';

    if (isBipolar) {
      // Modo bipolar: centro neutro
      const mid = (total % 2 === 1) ? Math.floor(total / 2) : Math.floor(total / 2) - 1;
      const upSpan = total - 1 - mid;
      const downSpan = mid;
      const target = clamped >= 0
        ? mid + Math.round(clamped * upSpan)
        : mid + Math.round(clamped * downSpan);

      for (let i = 0; i < total; i++) {
        let lit = false;
        if (isDot) {
          lit = (i === target);
        } else {
          if (clamped >= 0) {
            lit = (i >= mid && i <= target);
          } else {
            lit = (i <= mid && i >= target);
          }
        }
        this.segments[i].classList.toggle('abd-led-ladder__segment--lit', lit);
      }

      if (this.arrowUp) {
        this.arrowUp.classList.toggle('abd-led-ladder__arrow--active', clamped >= 0.95);
      }
      if (this.arrowDown) {
        this.arrowDown.classList.toggle('abd-led-ladder__arrow--active', clamped <= -0.95);
      }
    } else {
      // Modo unipolar: [0.0, 1.0]
      const activeCount = Math.round(clamped * total);
      const dotIndex = Math.min(total - 1, Math.floor(clamped * total));

      for (let i = 0; i < total; i++) {
        const lit = isDot ? (clamped > 0 && i === dotIndex) : (i < activeCount);
        this.segments[i].classList.toggle('abd-led-ladder__segment--lit', lit);
      }

      if (this.arrowUp) {
        this.arrowUp.classList.toggle('abd-led-ladder__arrow--active', clamped >= 0.98);
      }
      if (this.arrowDown) {
        this.arrowDown.classList.toggle('abd-led-ladder__arrow--active', clamped <= 0.02);
      }
    }
  }

  getValue() {
    return this.value;
  }

  setMode(mode) {
    if (mode === 'bar' || mode === 'dot') {
      this.options.mode = mode;
      this.setValue(this.value);
    }
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this.wrapper && this.wrapper.parentNode) {
      this.wrapper.remove();
    }
  }
}
