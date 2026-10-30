/**
 * ABD PeakLED — RE-201 style peak level LED (inside SVG or standalone).
 * Small rectangular LED that lights on signal peaks.
 */
/**
 * Usage:
 *   const led = new PeakLED(el, { color: '#ff4400' });
 *   led.trigger();               // destello de 80ms (default)
 *   led.setState(true);          // modo VU: encendido fijo
 *   led.destroy();
 *
 * @param {HTMLElement|string} container
 * @param {object} options
 *   width      px, default 32.
 *   height     px, default 17.
 *   color      lit color, default '#ff4400'.
 *   glowColor  halo color, default '#ff4400'.
 *   spriteUrl  sprite used when useSprite is on, default
 *              './assets/junio/re201_peak_led.png'.
 *   useSprite  paint from the sprite instead of the CSS LED, default true.
 */
export class PeakLED {
    constructor(container, options = {}) {
        this.container = typeof container === 'string'
            ? document.querySelector(container)
            : container;

        if (!this.container) throw new Error('PeakLED: container not found');

        this.options = {
            width: options.width ?? 32,
            height: options.height ?? 17,
            color: options.color ?? '#ff4400',
            glowColor: options.glowColor ?? '#ff4400',
            spriteUrl: options.spriteUrl ?? './assets/junio/re201_peak_led.png',
            useSprite: options.useSprite ?? true,
            ...options,
        };

        this.active = false;
        this.buildDom();
    }

    buildDom() {
        if (this.options.useSprite) {
            this.element = document.createElement('img');
            this.element.src = this.options.spriteUrl;
            this.element.style.cssText = `
                width: ${this.options.width}px;
                height: ${this.options.height}px;
                display: block;
                opacity: 0;
                transition: opacity 0.05s;
            `;
        } else {
            this.element = document.createElement('div');
            this.element.style.cssText = `
                width: ${this.options.width}px;
                height: ${this.options.height}px;
                background: ${this.options.color};
                border-radius: 2px;
                opacity: 0;
                transition: opacity 0.05s;
                box-shadow: 0 0 6px ${this.options.glowColor};
            `;
        }

        this.container.appendChild(this.element);
    }

    /**
     * Trigger peak — flashes the LED briefly.
     * @param {number} [duration]  milisegundos de destello (default 80).
     */
    trigger(duration = 80) {
        if (this.active) return;
        this.active = true;
        this.element.style.opacity = '1';
        setTimeout(() => {
            this.active = false;
            this.element.style.opacity = '0';
        }, duration);
    }

    /**
     * Set continuous state (for VU-like behavior).
     * @param {boolean} on  true deja el LED fijo encendido.
     */
    setState(on) {
        this.element.style.opacity = on ? '1' : '0';
    }

    destroy() {
        this.element.remove();
    }
}