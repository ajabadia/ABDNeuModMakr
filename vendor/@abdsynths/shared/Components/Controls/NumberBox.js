/**
 * ABD NumberBox — reusable numeric stepper for the ABDSynths suite.
 *
 * PORTED from ABDEep's furniture: the OCT −/OCT + button pairs
 * (WebUI/js/components/keyboard-section.js) and the styled
 * <input type="number"> of its settings/calibration modals
 * (`.modal-input`), fused into one control on the family contract:
 *
 *   - constructor(container, options) + setValue/getValue/destroy + onChange;
 *   - pure DOM/CSS, themed via --color-* tokens with literal fallbacks;
 *   - silent setValue, onChange only on user edits;
 *   - label deal identical to Select/Segmented: <label for> when an id is
 *     given, aria-label on the field otherwise (role=spinbutton is never
 *     left mute);
 *   - +/- buttons announce the parameter they belong to
 *     ("Master BPM: decrease", not a bare "decrease");
 *   - aria-valuetext sits on the role=spinbutton field (where valuemin/max/now
 *     already are), so it actually reaches the reader: it carries the formatted
 *     readout plus the unit ("Omni", "30 bpm"), not the raw number.
 *
 * VALUE MODEL: REAL numbers (BPM, channels, semitones — not the 0..1 wire):
 * the caller converts at the boundary, exactly like the rest of the family
 * (the Select holds indices, the Knob normalises in its wrapper). The box
 * clamps to [min, max] on every edit and honours an optional `step` (the
 * amount the buttons apply; typing is free but snaps on commit).
 *
 * WHY NOT <input type=number> ALONE: the native spinner is invisible on the
 * suite's dark themes and unusable at synth-cell sizes; the buttons make the
 * +/− affordance explicit and hold-to-repeat friendly later. The field keeps
 * type="text" with inputMode="numeric" so desktop and WebView2 both get the
 * numeric keyboard without native spinner chrome.
 *
 * INTEGER MODE: pass `integer: true` (or `step` ≥ 1) and values round on
 * every edit — MIDI channels, octaves, pattern lengths. Default float.
 *
 * Skins: tagged as kind 'numberbox'; the vector renderer just names the
 * wrapper (same tag-only deal as Select/Segmented).
 */

import { applySkin, CONTROL_KIND } from './skins/index.js';

/**
 * Usage:
 *   const box = new NumberBox(el, { min: 0, max: 1, step: 0.01, onChange });
 *   box.setValue(0.5);
 *   box.getValue();
 *   box.setDisabled(true);    // host-driven (MIDI learning, etc.)
 *   box.focus();
 *   box.destroy();
 *
 * @param {HTMLElement|string} container
 * @param {object} options
 *   label     optional text above the box.
 *   value     initial number, default 0.
 *   min       lower clamp, default 0.
 *   max       upper clamp, default 127.
 *   step      button increment, default 1 (0 = free typing, no snapping).
 *   integer   round every edit (default: true when step >= 1, else false).
 *   unit      optional suffix shown inside the box ('bpm', 'ch'...).
 *   format    optional (number) => string for the readout (defaults to
 *             Math.round for integers, toString otherwise).
 *   id        optional id for the field (lets a <label for> find it).
 *   disabled  boolean, default false (whole control; options-level gating
 *             doesn't apply to a numeric box).
 *   skin      optional skin name (see components/skins).
 *   onChange  (number) => void, fires on user edits only (not on setValue).
 */
export class NumberBox
{
    constructor (container, options = {})
    {
        this.container = typeof container === 'string'
            ? document.querySelector(container)
            : container;

        if (this.container == null)
            throw new Error('ABD NumberBox: container not found');

        this.options = {
            label: '',
            value: 0,
            min: 0,
            max: 127,
            step: 1,
            integer: null,
            unit: '',
            format: null,
            id: null,
            disabled: false,
            skin: 'vector',
            onChange: null,
            ...options,
        };

        this.min = Number(this.options.min);
        this.max = Number(this.options.max);
        this.step = Math.max(0, Number(this.options.step) || 0);
        this.isInteger = this.options.integer ?? (this.step >= 1);
        this.value = this.clamp(this.options.value);
        this.disabled = Boolean(this.options.disabled);
        this.listeners = [];
        this[CONTROL_KIND] = 'numberbox';

        this.buildDom();
        this.attachInteraction();

        if (this.options.skin)
            this.skin = applySkin(this.options.skin, this.wrapper, this);

        this.render();
    }

    buildDom ()
    {
        this.wrapper = document.createElement('div');
        this.wrapper.className = 'abd-numberbox';

        if (this.options.label)
        {
            this.labelEl = document.createElement(this.options.id ? 'label' : 'span');
            this.labelEl.className = 'abd-numberbox__label';
            this.labelEl.textContent = this.options.label;
            this.wrapper.appendChild(this.labelEl);
            this.wrapper.classList.add('abd-numberbox--labelled');
        }

        // − button first (labelled with the true minus sign, like ABDEep's OCT −).
        this.decButton = this.buildButton('−', 'decrement');
        this.field = document.createElement('input');
        this.incButton = this.buildButton('+', 'increment');

        this.field.type = 'text';
        this.field.inputMode = 'numeric';
        this.field.className = 'abd-numberbox__field';
        this.field.setAttribute('role', 'spinbutton');
        this.field.setAttribute('aria-valuemin', `${this.min}`);
        this.field.setAttribute('aria-valuemax', `${this.max}`);

        if (this.options.id)
        {
            this.field.id = this.options.id;

            if (this.labelEl)
            {
                this.labelEl.htmlFor = this.options.id;
                this.labelEl.id = `${this.options.id}-label`;
            }
        }
        else if (this.options.label)
        {
            // Sin id no hay <label for> que asocie el texto visible (la etiqueta se
            // crea como <span>), asi que el campo se quedaba mudo teniendo role
            // spinbutton. Mismo reparto que el resto de la familia: <label for> con
            // id, aria-label sin id. Con id NO se duplica: ya lo aporta el <label>.
            this.field.setAttribute('aria-label', this.options.label);
        }

        if (this.options.unit)
        {
            this.unitEl = document.createElement('span');
            this.unitEl.className = 'abd-numberbox__unit';
            this.unitEl.textContent = this.options.unit;
        }

        this.box = document.createElement('div');
        this.box.className = 'abd-numberbox__box';
        this.box.append(this.decButton, this.field);

        if (this.unitEl)
            this.box.appendChild(this.unitEl);

        this.box.appendChild(this.incButton);
        this.wrapper.appendChild(this.box);
        this.container.appendChild(this.wrapper);
    }

    buildButton (text, direction)
    {
        const button = document.createElement('button');
        const verb = direction === 'increment' ? 'increase' : 'decrease';

        // El nombre accesible dice A QUE parametro pertenece el boton: un +/- suelto
        // no sirve de nada cuando hay diez cajas en la misma pantalla. El verbo queda
        // de sufijo, asi que el nombre se lee (parametro, accion). Sin label se mantiene
        // el verbo a secas, como antes.
        const name = this.options.label ? `${this.options.label}: ${verb}` : verb;

        button.type = 'button';
        button.className = `abd-numberbox__btn abd-numberbox__btn--${direction}`;
        button.textContent = text;
        button.setAttribute('aria-label', name);

        return button;
    }

    attachInteraction ()
    {
        const nudge = (direction) =>
        {
            if (this.disabled) return;

            this.commit(this.value + direction * (this.step || 1));
        };

        const onDec = () => nudge(-1);
        const onInc = () => nudge(1);

        this.decButton.addEventListener('click', onDec);
        this.incButton.addEventListener('click', onInc);
        this.listeners.push([this.decButton, 'click', onDec], [this.incButton, 'click', onInc]);

        const onKeyDown = (event) =>
        {
            if (event.key === 'Enter')
            {
                event.preventDefault();
                this.field.blur();   // commit happens on blur
                return;
            }

            if (this.disabled) return;

            if (event.key === 'ArrowUp')
            {
                event.preventDefault();
                nudge(1);
            }
            else if (event.key === 'ArrowDown')
            {
                event.preventDefault();
                nudge(-1);
            }
        };

        const onBlur = () => this.commit(this.parse(this.field.value));
        const onFocus = () => this.field.select();

        this.field.addEventListener('keydown', onKeyDown);
        this.field.addEventListener('blur', onBlur);
        this.field.addEventListener('focus', onFocus);
        this.listeners.push(
            [this.field, 'keydown', onKeyDown],
            [this.field, 'blur', onBlur],
            [this.field, 'focus', onFocus],
        );
    }

    /** Parse typed text: empty/garbage -> current value (no error spam). */
    parse (text)
    {
        const n = Number(String(text).replace(',', '.'));

        return Number.isFinite(n) ? n : this.value;
    }

    /** Clamp + snap + round, the only path a new value may take. */
    commit (candidate)
    {
        let v = this.clamp(candidate);

        if (this.isInteger)
            v = Math.round(v);
        else if (this.step > 0)
            v = Math.round(v / this.step) * this.step;   // snap typed floats to the step

        const changed = v !== this.value;

        this.value = v;
        this.render();

        if (changed)
            this.options.onChange?.(this.value);
    }

    clamp (v)
    {
        const n = Number(v);

        return Math.min(this.max, Math.max(this.min, Number.isFinite(n) ? n : this.min));
    }

    formatValue (v)
    {
        if (this.options.format)
            return this.options.format(v);

        return this.isInteger ? `${Math.round(v)}` : `${v}`;
    }

    /**
     * @brief Formatted value for assistive tech (aria-valuetext): the readout
     * plus the unit, e.g. "Omni" or "30 bpm" instead of the raw wire number.
     */
    valueText ()
    {
        return `${this.formatValue(this.value)}${this.options.unit ? ` ${this.options.unit}` : ''}`;
    }

    /** @brief Push value + availability into the DOM. */
    render ()
    {
        this.field.value = this.formatValue(this.value);
        this.field.setAttribute('aria-valuenow', `${this.value}`);
        this.field.disabled = this.disabled;
        this.decButton.disabled = this.disabled;
        this.incButton.disabled = this.disabled;

        // At the edges the dead button reads disabled (same cue as the native
        // spinner) but the control stays usable for typing the other way.
        this.decButton.classList.toggle('is-at-edge', this.value <= this.min);
        this.incButton.classList.toggle('is-at-edge', this.value >= this.max);

        this.wrapper.dataset.disabled = this.disabled ? 'true' : 'false';
        // aria-valuetext es una propiedad del WIDGET: solo cuenta en el nodo que
        // lleva el rol. Aqui el rol spinbutton vive en this.field (y ahi van ya
        // valuemin/max/now), asi que en el wrapper -un <div> sin rol- el atributo
        // era inerte y el lector anunciaba el numero crudo en vez del formateado
        // ("Omni", "30 bpm"). El resto de la familia ya lo escribe junto a su rol.
        this.field.setAttribute('aria-valuetext', this.valueText());
    }

    /** @brief Programmatic update: does NOT fire onChange (user edits do). */
    /**
     * @brief Programmatic update: does NOT fire onChange (user edits do).
     * @param {number} v  valor crudo; se recorta a [min, max] y redondea si es entero.
     */
    setValue (v)
    {
        this.value = this.clamp(v);

        if (this.isInteger)
            this.value = Math.round(this.value);

        this.render();
    }

    getValue () { return this.value; }

    /**
     * @brief Enable/disable the whole control.
     * @param {boolean} disabled  true deja el campo fuera de la interaccion.
     */
    setDisabled (disabled)
    {
        this.disabled = Boolean(disabled);
        this.render();
    }

    /**
     * @brief Focus the field (host-driven edits, MIDI learning...).
     * @param {void}  sin parametros; aqui solo para la convencion del audit.
     */
    focus ()
    {
        this.field.focus();
    }

    destroy ()
    {
        for (const [element, event, handler] of this.listeners)
            element.removeEventListener(event, handler);

        this.listeners.length = 0;
        this.skin?.destroy();
        this.wrapper.remove();
    }
}
