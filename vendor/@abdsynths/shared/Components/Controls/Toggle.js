/**
 * ABD Toggle — reusable LED toggle for the ABDSynths suite.
 *
 * Family rules (see components/wheel.js, knob.js, slider.js):
 *   - constructor(container, options) + setValue/getValue/destroy + onChange;
 *   - pure DOM/CSS — the catalogue's WebGL glow is intentionally dropped: an LED
 *     is a state indicator, and CSS box-shadow reaches the same look without a
 *     GL context per button;
 *   - themed via --color-* tokens; state carried by [aria-pressed] so CSS can
 *     style both states without JS class juggling;
 *   - value model: boolean.
 *
 * Skin note: unlike Knob/Slider (which paint through skin renderers), the Toggle
 * owns its <button> and a skin only restyles it via a class: 'toggle-ms2000'
 * (token variant), 'toggle-junio' (JUNiO PNG sprites per colorName).
 */

import { applySkin, CONTROL_KIND } from './skins/index.js';
import { announceTransition } from './transitionNotices.js';

/**
 * Usage:
 *   const toggle = new Toggle(el, { value: false, onChange });
 *   toggle.setValue(true);        // programatico: no dispara onChange
 *   toggle.getValue();
 *   toggle.destroy();
 *
 * @param {HTMLElement|string} container
 * @param {object} options
 *   label       text on the button.
 *   ariaLabel   accessible name override (icon-only buttons).
 *   value       initial boolean, default false.
 *   color       LED color as CSS color, default var(--color-accent, #00c3ff).
 *   skin        optional skin name ('toggle-ms2000', 'toggle-junio'...).
 *   colorName   sprite color for 'toggle-junio': orange|red|blue|grey|white|yellow.
 *   momentary   if true, behaves like a push button (fires onChange on
 *               press/release, does not latch). Default false.
 *   onChange    (boolean) => void, fires on user toggles (not on setValue) and
 *               only on a REAL transition: un press/release repetido (o un release
 *               sin press) no re-avisa. Contrato compartido de avisos de
 *               transicion, `components/transitionNotices.js`.
 */
export class Toggle
{
    constructor (container, options = {})
    {
        this.container = typeof container === 'string'
            ? document.querySelector(container)
            : container;

        if (this.container == null)
            throw new Error('ABD Toggle: container not found');

        this.options = {
            label: '',
            value: false,
            color: 'var(--color-accent, #00c3ff)',
            skin: null,
            colorName: null,
            momentary: false,
            onChange: null,
            ...options,
        };

        this.value = Boolean(this.options.value);
        this.listeners = [];
        this[CONTROL_KIND] = 'toggle';

        this.buildDom();
        this.attachInteraction();

        if (this.options.skin)
            this.skin = applySkin(this.options.skin, this.container, this);

        this.render();
    }

    buildDom ()
    {
        this.button = document.createElement('button');
        this.button.type = 'button';
        this.button.className = 'abd-toggle';
        this.button.textContent = this.options.label;

        // Accessible name: without it an unlabeled toggle is announced only by
        // state ("toggle button, pressed") — meaningless out of context.
        if (this.options.ariaLabel)
            this.button.setAttribute('aria-label', this.options.ariaLabel);
        this.button.style.setProperty('--abd-toggle-color', this.options.color);

        if (this.options.colorName)
            this.button.dataset.color = this.options.colorName;

        this.container.appendChild(this.button);
    }

    attachInteraction ()
    {
        const onClick = () =>
        {
            if (this.options.momentary)
                return;   // momentary buttons report press/release, not a latched value

            const previous = this.value;
            this.value = ! this.value;
            this.render();
            announceTransition(this.options.onChange, previous, this.value);
        };

        const onPress = () =>
        {
            if (! this.options.momentary)
                return;

            const previous = this.value;
            this.value = true;
            this.render();
            // Un segundo press sin release en medio no es una transicion nueva.
            announceTransition(this.options.onChange, previous, true);
        };

        const onRelease = () =>
        {
            if (! this.options.momentary)
                return;

            const previous = this.value;
            this.value = false;
            this.render();
            // `pointerup` dispara tambien `pointerleave`: solo avisa la primera vez.
            announceTransition(this.options.onChange, previous, false);
        };

        this.bind(this.button, 'click', onClick);
        this.bind(this.button, 'pointerdown', onPress);
        this.bind(this.button, 'pointerup', onRelease);
        this.bind(this.button, 'pointerleave', onRelease);
    }

    /** @brief addEventListener with bookkeeping so destroy() removes them all. */
    bind (element, event, handler)
    {
        element.addEventListener(event, handler);
        this.listeners.push([element, event, handler]);
    }

    render ()
    {
        this.button.setAttribute('aria-pressed', this.value ? 'true' : 'false');
    }

    /**
     * @brief Programmatic update: does NOT fire onChange (user toggles do).
     * @param {boolean} value  estado nuevo del toggle.
     */
    setValue (value)
    {
        this.value = Boolean(value);
        this.render();
    }

    getValue () { return this.value; }

    destroy ()
    {
        for (const [element, event, handler] of this.listeners)
            element.removeEventListener(event, handler);

        this.listeners.length = 0;
        this.skin?.destroy();
        this.button.remove();
    }
}
