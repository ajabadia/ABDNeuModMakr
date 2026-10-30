/**
 * ABD SevenSegmentDisplay — 7-segment LED display (3 chars default).
 * Matches ABDJUNiO601 #seven-segment-display using SevenSegment.ttf.
 */
/**
 * Usage:
 *   const display = new SevenSegmentDisplay(el, { digits: 3 });
 *   display.setValue('128');
 *   display.destroy();
 *
 * @param {HTMLElement|string} container
 * @param {object} options
 *   digits      characters shown, default 3.
 *   fontSize    CSS font size, default '24px'.
 *   color       lit color, default '#ff4400'.
 *   fontFamily  display font, default 'SevenSegment, monospace'.
 *   value       initial text, default ''.
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

    /**
     * Pinta el valor: cada digito en su celda, relleno con espacios a la izquierda.
     * @param {number|string} value  valor a mostrar; se trunca a `digits`.
     */
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