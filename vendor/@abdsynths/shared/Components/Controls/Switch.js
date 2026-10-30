/**
 * ABD Switch — reusable physical toggle switch for the ABDSynths suite.
 *
 * Family rules (see components/knob.js, toggle.js):
 *   - constructor(container, options) + setValue/getValue/destroy + onChange;
 *   - authentic hardware toggle aesthetic (beveled collar, metallic lever, status LED);
 *   - pure DOM/CSS, themed via --color-* tokens with literal fallbacks;
 *   - value model: boolean;
 *   - accessible: role="switch", aria-checked, keyboard navigable (Space/Enter/Arrows).
 */
import { announceTransition } from './transitionNotices.js';

export class Switch {
  constructor(container, options = {}) {
    this.container = typeof container === 'string' ? document.querySelector(container) : container;

    if (this.container == null) {
      throw new Error('ABD Switch: container not found');
    }

    this.options = {
      label: '',
      value: false,
      size: 50,
      ariaLabel: null,
      onChange: null,
      ...options,
    };

    this.value = Boolean(this.options.value);
    this.listeners = [];

    this.buildDom();
    this.attachInteraction();
    this.render();
  }

  buildDom() {
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'abd-switch';
    this.wrapper.style.setProperty('--abd-switch-size', `${this.options.size}px`);

    if (this.options.label) {
      this.labelEl = document.createElement('span');
      this.labelEl.className = 'abd-switch__label';
      this.labelEl.textContent = this.options.label;
      this.wrapper.appendChild(this.labelEl);
    }

    this.switchEl = document.createElement('div');
    this.switchEl.className = 'abd-switch__control';
    this.switchEl.tabIndex = 0;
    this.switchEl.setAttribute('role', 'switch');
    const accessibleName = this.options.ariaLabel ?? this.options.label;
    if (accessibleName) {
      this.switchEl.setAttribute('aria-label', accessibleName);
    }
    this.switchEl.setAttribute('aria-checked', this.value ? 'true' : 'false');

    this.switchEl.innerHTML = `
            <div class="abd-switch__bezel">
                <div class="abd-switch__led" aria-hidden="true"></div>
                <div class="abd-switch__slot">
                    <div class="abd-switch__lever" aria-hidden="true">
                        <div class="abd-switch__lever-tip"></div>
                    </div>
                </div>
            </div>
        `;
    this.wrapper.appendChild(this.switchEl);

    this.valueEl = document.createElement('span');
    this.valueEl.className = 'abd-switch__value';
    this.valueEl.textContent = this.value ? 'ON' : 'OFF';
    this.wrapper.appendChild(this.valueEl);

    this.container.appendChild(this.wrapper);
  }

  attachInteraction() {
    const toggle = () => {
      const previous = this.value;
      this.value = !this.value;
      this.render();
      announceTransition(this.options.onChange, previous, this.value);
    };

    const onClick = (e) => {
      e.preventDefault();
      toggle();
    };

    const onKeyDown = (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        toggle();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
        e.preventDefault();
        if (!this.value) toggle();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
        e.preventDefault();
        if (this.value) toggle();
      }
    };

    this.bind(this.switchEl, 'click', onClick);
    this.bind(this.switchEl, 'keydown', onKeyDown);
  }

  bind(element, event, handler) {
    element.addEventListener(event, handler);
    this.listeners.push([element, event, handler]);
  }

  render() {
    this.switchEl.setAttribute('aria-checked', this.value ? 'true' : 'false');
    this.wrapper.classList.toggle('abd-switch--active', this.value);

    if (this.valueEl) {
      this.valueEl.textContent = this.value ? 'ON' : 'OFF';
      this.valueEl.classList.toggle('active', this.value);
    }
  }

  /** Programmatic update — does NOT fire onChange. */
  setValue(value) {
    this.value = Boolean(value);
    this.render();
  }

  getValue() {
    return this.value;
  }

  destroy() {
    for (const [element, event, handler] of this.listeners) {
      element.removeEventListener(event, handler);
    }
    this.listeners.length = 0;
    this.wrapper.remove();
  }
}
