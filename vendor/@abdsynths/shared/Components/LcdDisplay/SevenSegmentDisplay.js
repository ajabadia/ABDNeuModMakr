/**
 * ABD SevenSegmentDisplay — Display LED de 7 segmentos.
 * ====================================================
 */

export class SevenSegmentDisplay {
  constructor(container, options = {}) {
    this.container = typeof container === 'string'
      ? document.querySelector(container)
      : container;

    if (!this.container) throw new Error('SevenSegmentDisplay: container not found');

    this.options = {
      digits: options.digits ?? 3,
      fontSize: options.fontSize ?? '24px',
      color: options.color ?? '#ff4400',
      fontFamily: options.fontFamily ?? 'SevenSegment, monospace',
      value: options.value ?? '',
      ...options,
    };

    this.buildDom();
    this.setValue(this.options.value);
  }

  buildDom() {
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'abd-seven-seg';
    this.wrapper.style.cssText = `
      display: inline-flex;
      gap: 2px;
      font-family: ${this.options.fontFamily};
      font-size: ${this.options.fontSize};
      color: ${this.options.color};
      letter-spacing: 1px;
      font-variant-numeric: tabular-nums;
    `;

    this.digits = [];
    for (let i = 0; i < this.options.digits; i++) {
      const d = document.createElement('span');
      d.className = 'abd-seven-seg__digit';
      d.style.cssText = `
        min-width: 0.6em;
        text-align: center;
      `;
      d.textContent = '8';
      this.wrapper.appendChild(d);
      this.digits.push(d);
    }

    this.container.appendChild(this.wrapper);
  }

  setValue(value) {
    const str = String(value).padStart(this.options.digits, ' ');
    for (let i = 0; i < this.options.digits; i++) {
      this.digits[i].textContent = str[i] || ' ';
    }
  }

  destroy() {
    this.wrapper.remove();
  }
}
