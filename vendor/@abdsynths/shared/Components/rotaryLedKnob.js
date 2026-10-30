/**
 * ABD RotaryLedKnob — Rotary encoder knob with circular discrete LED collar.
 *
 * Designed for high-end synthesizer consoles, master output sections, and
 * parameter controls requiring instant visual feedback of level + discrete LED ring.
 *
 * Family contract (see components/knob.js, wheel.js, ledLadder.js):
 *   - constructor(container, options) + setValue/getValue/destroy;
 *   - themed strictly through CSS custom properties (--color-*, --space-*);
 *   - zero hardcoded colors: adapts seamlessly to dark and light (audiolab-light) themes;
 *   - full touch, drag, wheel, and keyboard accessibility via drag-core.
 *
 * Usage:
 *   import { RotaryLedKnob } from '@abdsynths/shared/components/rotaryLedKnob.js';
 *   const knob = new RotaryLedKnob(container, {
 *     size: 64,
 *     value: 0.85,
 *     numLeds: 15,
 *     onChange: (v) => console.log('Volume:', v),
 *   });
 */

import { attachDrag } from './drag-core.js';

const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
const START_ANGLE = -135;
const SWEEP_ANGLE = 270;

export class RotaryLedKnob {
  /**
   * @param {HTMLElement|string} container  Element or selector to mount into.
   * @param {object} [options]
   *   size        px diameter, default 64.
   *   value       normalised 0..1, default 0.85.
   *   numLeds     number of discrete LEDs in the collar, default 15.
   *   bipolar     if true, LEDs illuminate outwards from center (0.5), default false.
   *   step        keyboard/wheel increment step, default 0.01.
   *   label       optional label displayed above the knob.
   *   ariaLabel   accessible label for screen readers.
   *   format      (normalised) => string for readout, default percent.
   *   showValue   whether to render built-in value readout text below knob.
   *   onChange    (normalised) => void, called on interactive edits.
   *   onSettled   (normalised) => void, called when user interaction finishes.
   *   onDragStart () => void.
   *   onDragEnd   () => void.
   */
  constructor(container, options = {}) {
    this.container = typeof container === 'string'
      ? document.querySelector(container)
      : container;

    if (!this.container) throw new Error('ABD RotaryLedKnob: container not found');

    this.options = {
      size: 64,
      value: 0.85,
      numLeds: 15,
      bipolar: false,
      step: 0.01,
      label: '',
      ariaLabel: 'Rotary LED Knob',
      format: (v) => `${Math.round(v * 100)}%`,
      showValue: false,
      onChange: null,
      onSettled: null,
      onDragStart: null,
      onDragEnd: null,
      ...options,
    };

    this.value = clamp01(this.options.value);
    this.dragDetach = null;
    this.ledDots = [];
    this.capEl = null;
    this.valueEl = null;
    this.dialEl = null;
    this.wrapper = null;

    this.buildDom();
    this.attachInteraction();
    this.updateVisuals();
  }

  buildDom() {
    const size = this.options.size;
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'abd-rotary-led';

    if (this.options.label) {
      const lbl = document.createElement('span');
      lbl.className = 'abd-rotary-led__label';
      lbl.textContent = this.options.label;
      this.wrapper.appendChild(lbl);
    }

    this.dialEl = document.createElement('div');
    this.dialEl.className = 'abd-rotary-led__dial';
    this.dialEl.tabIndex = 0;
    this.dialEl.setAttribute('role', 'slider');
    this.dialEl.setAttribute('aria-valuemin', '0');
    this.dialEl.setAttribute('aria-valuemax', '100');
    this.dialEl.setAttribute('aria-valuenow', String(Math.round(this.value * 100)));
    this.dialEl.setAttribute('aria-label', this.options.ariaLabel || this.options.label || 'Rotary LED Knob');
    this.dialEl.style.width = `${size}px`;
    this.dialEl.style.height = `${size}px`;

    // Generate discrete LED dots along the 270° collar arc
    let ledsSvg = '';
    const numLeds = Math.max(5, this.options.numLeds);
    for (let i = 0; i < numLeds; i++) {
      const frac = i / (numLeds - 1);
      const angleDeg = START_ANGLE + frac * SWEEP_ANGLE;
      const angleRad = (angleDeg - 90) * (Math.PI / 180);
      const lx = (50 + 40 * Math.cos(angleRad)).toFixed(2);
      const ly = (50 + 40 * Math.sin(angleRad)).toFixed(2);
      ledsSvg += `<circle class="led-dot" cx="${lx}" cy="${ly}" r="3.2" data-idx="${i}" />`;
    }

    this.dialEl.innerHTML = `
      <svg class="abd-rotary-led__svg" viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true">
        <!-- Outer bezel ring -->
        <circle class="abd-rotary-led__bezel" cx="50" cy="50" r="47" />

        <!-- LED collar arc dots -->
        <g class="abd-rotary-led__collar">
          ${ledsSvg}
        </g>

        <!-- Central rotating knob cap (rotates around 50 50) -->
        <g class="abd-rotary-led__cap" style="transform-origin: 50px 50px;">
          <!-- Dial cap body -->
          <circle class="abd-rotary-led__cap-body" cx="50" cy="50" r="29" />
          <!-- Dial inner bevel groove -->
          <circle class="abd-rotary-led__cap-inset" cx="50" cy="50" r="26" fill="none" />
          <!-- Indicator pointer line extending to outer rim -->
          <line class="abd-rotary-led__pointer-line" x1="50" y1="23" x2="50" y2="38" />
          <!-- Indicator dot near outer edge -->
          <circle class="abd-rotary-led__pointer-dot" cx="50" cy="25" r="2" />
        </g>
      </svg>
    `;

    this.wrapper.appendChild(this.dialEl);

    if (this.options.showValue) {
      this.valueEl = document.createElement('span');
      this.valueEl.className = 'abd-rotary-led__value';
      this.valueEl.textContent = this.options.format(this.value);
      this.wrapper.appendChild(this.valueEl);
    }

    this.container.appendChild(this.wrapper);

    this.capEl = this.dialEl.querySelector('.abd-rotary-led__cap');
    this.ledDots = Array.from(this.dialEl.querySelectorAll('.led-dot'));
  }

  attachInteraction() {
    this.dragDetach = attachDrag(this.dialEl, {
      onDelta: (turns) => {
        const next = clamp01(this.value + turns * 0.75);
        this.value = next;
        this.updateVisuals();
        this.options.onChange?.(this.value);
        return next;
      },
      onStep: (dir) => {
        const next = clamp01(this.value + dir * this.options.step);
        this.value = next;
        this.updateVisuals();
        this.options.onChange?.(this.value);
        this.options.onSettled?.(this.value);
        return next;
      },
      onDragStart: () => {
        this.options.onDragStart?.();
      },
      onDragEnd: () => {
        this.options.onDragEnd?.();
        this.options.onSettled?.(this.value);
      },
    });

    // Double-click to reset to default value
    this.dialEl.addEventListener('dblclick', () => {
      this.setValue(this.options.value ?? 0.85, true);
    });
  }

  updateVisuals() {
    const angleDeg = START_ANGLE + this.value * SWEEP_ANGLE;

    // Rotate the central dial cap and pointer line
    if (this.capEl) {
      this.capEl.style.transform = `rotate(${angleDeg}deg)`;
    }

    // Light up discrete LEDs
    const numLeds = this.options.numLeds;
    const bipolar = this.options.bipolar;
    const activeCount = Math.round(this.value * (numLeds - 1));
    const midIdx = (numLeds - 1) / 2;

    for (let i = 0; i < numLeds; i++) {
      const dot = this.ledDots[i];
      if (!dot) continue;
      let isLit = false;
      if (bipolar) {
        const target = this.value * (numLeds - 1);
        if (target >= midIdx) {
          isLit = i >= midIdx && i <= target;
        } else {
          isLit = i <= midIdx && i >= target;
        }
      } else {
        isLit = i <= activeCount;
      }
      dot.classList.toggle('is-active', isLit);
    }

    if (this.dialEl) {
      this.dialEl.setAttribute('aria-valuenow', String(Math.round(this.value * 100)));
    }

    if (this.valueEl) {
      this.valueEl.textContent = this.options.format(this.value);
    }
  }

  setValue(val, notify = false) {
    this.value = clamp01(val);
    this.updateVisuals();
    if (notify) {
      this.options.onChange?.(this.value);
      this.options.onSettled?.(this.value);
    }
  }

  getValue() {
    return this.value;
  }

  destroy() {
    this.dragDetach?.();
    if (this.wrapper && this.wrapper.parentNode) {
      this.wrapper.parentNode.removeChild(this.wrapper);
    }
    this.ledDots = [];
    this.capEl = null;
    this.dialEl = null;
    this.wrapper = null;
  }
}
