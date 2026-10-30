/**
 * ABD Wheel — reusable filmstrip modulation wheel (PITCH / MOD).
 *
 * Renders a label, a sprite sheet driven by a hidden vertical range slider,
 * and a value readout. The readout is NOT paint-only: the same formatted text
 * goes to `aria-valuetext`, so a reader hears "+1.2" instead of the raw range
 * number (0..127, or -8192..8191 on the pitch wheel). Designed to be themed via
 * --kbd-* / --color-* tokens (see styles/components/wheels.css) and shared
 * across ABDSynths projects.
 *
 * Usage:
 *   import { Wheel } from '@abdsynths/shared/components/wheel.js';
 *   const wheel = new Wheel(container, {
 *     type: 'pitch',            // 'pitch' | 'mod'
 *     spriteUrl: 'assets/bender.png',
 *     frameWidth: 18, frameHeight: 76, frames: 101,
 *     onChange: (normalized) => {},
 *   });
 *   wheel.setValue(0.5, false);   // actualizacion silenciosa (no dispara onChange)
 *   wheel.destroy();
 *
 * El contenedor es de la rueda y lo PINTA al construir: da igual lo que tuviera
 * dentro, sale con una rueda. (Dos Wheel sobre el mismo contenedor dejan al primero
 * apuntando a nodos ya sustituidos: el contenedor es de uno.)
 */

import { announceSettled, createContinuousNotices } from './continuousNotices.js';

const FRAME_HEIGHT = 76;
const FRAMES = 101;

/**
 * @param {HTMLElement|string} container
 * @param {object} options
 *   type            'pitch' (springs back to 0 on release) or 'mod' (stays),
 *                   default 'mod'.
 *   spriteUrl       filmstrip sprite, default 'assets/bender.png'.
 *   frameWidth      px per frame, default 18.
 *   frameHeight     px per frame, default 76.
 *   frames          frames in the sprite, default 101.
 *   initialFrame    frame painted before any value, default the middle one.
 *   min / max       raw range, default -8192..8191 (pitch) or 0..127 (mod).
 *   label           text above the wheel, default 'PITCH' / 'MOD'.
 *   valueFormatter  (raw) => string readout; the same text is announced.
 *   onChange        (raw) => void, fires on user edits (not on setValue).
 *   onSettled       (raw) => void, fires ONCE per gesture when the value settles (pointerup / change); only if the final value differs from the gesture start. Keyboard steps and wheel notches settle immediately; pitch-wheel spring-back is a movement, not a settled commit.
 */
export class Wheel {
  constructor(container, options = {}) {
    this.container = container;
    this.type = options.type || 'mod';
    this.spriteUrl = options.spriteUrl || 'assets/bender.png';
    this.frameWidth = options.frameWidth || 18;
    this.frameHeight = options.frameHeight || FRAME_HEIGHT;
    this.frames = options.frames || FRAMES;
    this._initialFrame = options.initialFrame ?? Math.floor((this.frames - 1) / 2);
    this.onChange = options.onChange || (() => {});
    this.onSettled = options.onSettled || (() => {});
    this.isPitch = this.type === 'pitch';
    this.min = options.min !== undefined ? options.min : this.isPitch ? -8192 : 0;
    this.max = options.max !== undefined ? options.max : this.isPitch ? 8191 : 127;
    this.label = options.label || (this.isPitch ? 'PITCH' : 'MOD');
    this.valueFormatter = options.valueFormatter || this.defaultValueFormatter.bind(this);
    this._destroyed = false;
    this.notices = createContinuousNotices({
      onMovement: (v) => this.onChange(v),
      onSettled: (v) => this.onSettled(v),
    });

    this.render();
    this.attachEvents();
  }

  defaultValueFormatter(val) {
    if (this.isPitch) {
      const semitones = Math.round((val / 8192) * 20) / 10;
      return semitones > 0 ? `+${semitones}` : `${semitones}`;
    }
    return `${Math.round(val)}`;
  }

  render() {
    // Sin guard por contenido previo: aquel `return` dejaba this.slider sin definir
    // y attachEvents reventaba despues con un TypeError ("Cannot read properties of
    // undefined (reading 'addEventListener')") que no decia nada de la causa real.
    // La rueda repinta su contenedor: es suyo (1:1).
    this.container.classList.add('kbd-wheel-wrapper');
    this.container.innerHTML = `
      <label class="kbd-wheel-label">${this.label}</label>
      <div class="kbd-wheel-sprite"
           style="position:relative;width:${this.frameWidth}px;height:${this.frameHeight}px;background-image:url('${this.spriteUrl}');background-position:0px ${this.isPitch ? -(this._initialFrame * this.frameHeight) : 0}px;background-repeat:no-repeat;border-radius:3px;box-shadow:inset 0 2px 4px rgba(0,0,0,0.8);cursor:pointer;user-select:none;touch-action:none;">
        <input type="range" class="kbd-wheel-slider" min="${this.min}" max="${this.max}" value="0" step="1"
          aria-label="${this.isPitch ? 'Pitch Bend Wheel' : 'Modulation Wheel'}"
          style="position:absolute;top:0;left:0;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);border:0;opacity:0;pointer-events:none;">
      </div>
      <div class="kbd-wheel-value">${this.valueFormatter(0)}</div>
    `;
    this.sprite = this.container.querySelector('.kbd-wheel-sprite');
    this.slider = this.container.querySelector('.kbd-wheel-slider');
    this.valueEl = this.container.querySelector('.kbd-wheel-value');

    this.updateValueText(parseInt(this.slider.value, 10));
  }

  updateVisuals(val) {
    const pct = this.isPitch ? (val + 8192) / 16383 : val / this.max;
    const frame = Math.max(0, Math.min(this.frames - 2, Math.round(pct * (this.frames - 1))));
    this.sprite.style.backgroundPosition = `0px -${frame * this.frameHeight}px`;
    this.valueEl.textContent = this.valueFormatter(val);
    this.updateValueText(val);
  }

  /** El readout formateado tambien como valor anunciable (no el numero crudo). */
  updateValueText(val) {
    this.slider.setAttribute('aria-valuetext', this.valueFormatter(val));
  }

  /**
   * Actualiza el valor de la rueda; `notify` dispara onChange cuando es true.
   * @param {number} val  valor crudo, se recorta a [min, max].
   * @param {boolean} [notify]  cuando es false no dispara onChange.
   */
  setValue(val, notify = true) {
    const clamped = Math.max(this.min, Math.min(this.max, val));
    this.slider.value = clamped;
    this.updateVisuals(clamped);
    if (notify) {
      const prev = this._rawPrev;
      this._rawPrev = clamped;
      this.notices.announceMovement(prev, clamped);
      this.onChange(clamped);
    }
  }

  reset() {
    this.setValue(0);
  }

  attachEvents() {
    const getRaw = () => parseInt(this.slider.value, 10);
    this._rawPrev = getRaw();

    const beginGesture = () => this.notices.begin(getRaw());
    const endGesture = () => {
      const cur = getRaw();
      this.notices.end(cur);
      this._rawPrev = cur;
    };

    this.slider.addEventListener('pointerdown', beginGesture);
    this.slider.addEventListener('pointerup', endGesture);
    this.slider.addEventListener('pointercancel', endGesture);
    this.slider.addEventListener('change', endGesture);

    const onInput = () => {
      const val = getRaw();
      const prev = this._rawPrev;
      this._rawPrev = val;
      this.updateVisuals(val);
      const moved = this.notices.announceMovement(prev, val);
      if (moved && !this.notices.isActive()) announceSettled(this.onSettled, prev, val);
    };
    this.slider.addEventListener('input', onInput);

    // Direct pointer drag on the wheel sprite surface
    let isDragging = false;
    let startY = 0;
    let startVal = 0;
    const totalRange = this.max - this.min;
    const dragLanePx = 150;

    const onPointerDown = (e) => {
      isDragging = true;
      startY = e.clientY;
      startVal = getRaw();
      this._rawPrev = startVal;
      this.sprite.setPointerCapture?.(e.pointerId);
      this.notices.begin(startVal);
      e.preventDefault();
    };

    const onPointerMove = (e) => {
      if (!isDragging) return;
      const dy = startY - e.clientY; // upward drag increases value
      const speed = e.shiftKey ? 0.2 : 1.0;
      const deltaVal = (dy / dragLanePx) * totalRange * speed;
      const newVal = Math.max(this.min, Math.min(this.max, Math.round(startVal + deltaVal)));
      if (newVal !== getRaw()) {
        this.setValue(newVal, true);
      }
    };

    const onPointerUp = (e) => {
      if (!isDragging) return;
      isDragging = false;
      this.sprite.releasePointerCapture?.(e.pointerId);
      if (this.isPitch) {
        const prev = getRaw();
        this.slider.value = 0;
        this._rawPrev = 0;
        this.updateVisuals(0);
        this.notices.announceMovement(prev, 0);
        this.onChange(0);
      } else {
        const cur = getRaw();
        this.notices.end(cur);
        this._rawPrev = cur;
      }
    };

    this.sprite.addEventListener('pointerdown', onPointerDown);
    this.sprite.addEventListener('pointermove', onPointerMove);
    this.sprite.addEventListener('pointerup', onPointerUp);
    this.sprite.addEventListener('pointercancel', onPointerUp);

    // Mouse wheel adjustment on the sprite
    this.sprite.addEventListener('wheel', (e) => {
      e.preventDefault();
      const step = -Math.sign(e.deltaY) * Math.max(1, Math.round(totalRange / 20));
      const cur = getRaw();
      this.setValue(Math.max(this.min, Math.min(this.max, cur + step)), true);
    });

    if (this.isPitch) {
      const resetSpring = () => {
        const prev = this._rawPrev;
        this.slider.value = 0;
        this._rawPrev = 0;
        this.updateVisuals(0);
        // spring movement is not a settled commit: it returns to rest
        this.notices.announceMovement(prev, 0);
        this.onChange(0);
      };
      this.slider.addEventListener('mouseup', resetSpring);
      this.slider.addEventListener('touchend', resetSpring);
      this.slider.addEventListener('mouseleave', (e) => {
        if (e.buttons === 1) resetSpring();
      });
    }

    const onDblClick = () => {
      const prev = this._rawPrev;
      this.slider.value = 0;
      this._rawPrev = 0;
      this.updateVisuals(0);
      const moved = this.notices.announceMovement(prev, 0);
      if (moved && !this.notices.isActive()) announceSettled(this.onSettled, prev, 0);
      this.onChange(0);
    };
    this.slider.addEventListener('dblclick', onDblClick);
    this.sprite.addEventListener('dblclick', onDblClick);
  }

  /** Quita el marcado que pinto en el contenedor; idempotente. */
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this.container) this.container.innerHTML = '';
  }
}

/**
 * Convenience factory mirroring the legacy createKeyboard API.
 * @param {string|Element} elementId Container element or its id.
 * @param {Object} config { type, spriteUrl, onChange }
 * @returns {Wheel|null}
 */
export function createWheel(elementId, config = {}) {
  const el = typeof elementId === 'string' ? document.getElementById(elementId) : elementId;
  if (!el) return null;
  return new Wheel(el, config);
}
