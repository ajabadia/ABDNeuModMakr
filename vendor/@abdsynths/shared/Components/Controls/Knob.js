/**
 * ABD Knob — reusable rotary knob for the ABDSynths suite.
 *
 * BEHAVIOUR lives here (value 0..1, drag via drag-core, contract), LOOK lives in
 * a skin (components/skins). Skins are swappable per synth:
 *
 *   new Knob(el, { skin: 'ms2000' })   vector with rim/cap/dot
 *   new Knob(el, { skin: 'junio'  })   photographic filmstrip
 *   new Knob(el)                       'vector' (default)
 *
 * Family contract (see COMPONENTS.md): constructor(container, options),
 * setValue/getValue/destroy, onChange on user edits only, themed via tokens.
 *
 * Usage:
 *   const knob = new Knob(el, { skin: 'ms2000', value: 0.5 });
 *   knob.setValue(0.75);        // programatico: no dispara onChange
 *   knob.setModulation(0.2);    // anillo de modulacion: pinta, no cambia el valor
 *   knob.getValue();
 *   new Knob(el).destroy();   // de un solo uso: sin guardar referencia
 */

import { attachDrag } from './drag-core.js';
import { applySkin, CONTROL_KIND } from './skins/index.js';
import { announceSettled, createContinuousNotices } from './continuousNotices.js';

const SWEEP_DEGREES = 270;   // classic knob sweep: -135..+135
const START_ANGLE = -135;

/**
 * @param {HTMLElement|string} container  Element or selector to mount into.
 * @param {object} options
 *   size        px, default 64.
 *   value       initial normalised 0..1, default 0.
 *   label       text above the knob, optional. Doubles as the slider's
 *               accessible name (see ariaLabel).
 *   skin        skin name (see components/skins), default 'vector'.
 *   bipolar     if true the value arc fills from the CENTRE (normalised 0.5)
 *               instead of from the left end, and a tick marks the rest
 *               position: a centred parameter reads as ZERO instead of as a
 *               guess. Default false (unipolar, arc from the left end).
 *               Quien lo declara es el HOST, porque el host es quien sabe el
 *               rango real: el knob solo ve 0..1, y un 0.5 normalizado no es un
 *               cero hasta que alguien con el rango dice que lo es.
 *   ariaLabel   explicit accessible name for the role=slider dial, when the
 *               visible label is absent or must differ from it.
 *   format      (normalised) => string for the readout, default percent.
 *   step        keyboard step, default 0.01.
 *   onChange    (normalised) => void, fires on user edits (not on setValue).
 *   onSettled   (normalised) => void, fires ONCE per gesture when the value settles (pointerup / drag end); only if the final value differs from the value at gesture start — the commit for undo and automation. A drag that ends where it started (clamped against the edge, or released without moving) does not settle, and programmatic setValue never settles. Keyboard steps and wheel notches are not gestures: each transitioning step settles immediately.
 *   onDragStart / onDragEnd  for host gesture bridging.
 *
 * MODULATION RING (telemetry-driven, real-time only): setModulation(normalised)
 * asks the skin to paint a ring from the value's angle to the modulated angle —
 * how a mod matrix sums onto the parameter (the native LookAndFeel draws the
 * same arc). It never fires onChange and never touches the value: telemetry is
 * paint, not state. clearModulation() removes it.
 */
export class Knob
{
    constructor (container, options = {})
    {
        this.container = typeof container === 'string'
            ? document.querySelector(container)
            : container;

        if (this.container == null)
            throw new Error('ABD Knob: container not found');

        this.options = {
            size: 64,
            value: 0,
            label: '',
            ariaLabel: null,
            skin: 'vector',
            bipolar: false,
            step: 0.01,
            format: (v) => `${Math.round(v * 100)}%`,
            onChange: null,
            onSettled: null,
            onDragStart: null,
            onDragEnd: null,
            ...options,
        };

        this.value = clamp01(this.options.value);
        this.dragDetach = null;
        this.modAmount = 0;   // signed, normalised against the parameter range
        this.notices = createContinuousNotices({
            onMovement: (v) => this.options.onChange?.(v),
            onSettled: (v) => this.options.onSettled?.(v),
        });
        this[CONTROL_KIND] = 'knob';

        this.buildDom();
        this.attachInteraction();
        this.render();
    }

    buildDom ()
    {
        this.wrapper = document.createElement('div');
        this.wrapper.className = 'abd-knob';
        this.wrapper.style.setProperty('--abd-knob-size', `${this.options.size}px`);
        // En el wrapper, y NO solo en la piel: es la UNICA seña que ve un host
        // que_no_ skin (un tema, un test de accesibilidad, un CSS propio) para
        // saber que este mando tiene el cero en el centro.
        this.wrapper.dataset.bipolar = this.options.bipolar ? 'true' : 'false';

        if (this.options.label)
        {
            this.labelEl = document.createElement('span');
            this.labelEl.className = 'abd-knob__label';
            this.labelEl.textContent = this.options.label;
            this.wrapper.appendChild(this.labelEl);
        }

        // Interaction surface: focusable, role=slider, owned by drag-core.
        this.dial = document.createElement('div');
        this.dial.className = 'abd-knob__dial';
        this.dial.tabIndex = 0;
        this.dial.setAttribute('role', 'slider');
        this.dial.setAttribute('aria-valuemin', '0');
        this.dial.setAttribute('aria-valuemax', '1');
        // Accessible name: a div[role=slider] cannot be tied with <label
        // for> (that is form-element only), so the name travels ON the
        // dial — explicit ariaLabel, else the visible label's text.
        const accessibleName = this.options.ariaLabel ?? this.options.label;
        if (accessibleName)
            this.dial.setAttribute('aria-label', accessibleName);

        // The skin paints INSIDE the interaction surface and owns its own DOM.
        this.skin = applySkin(this.options.skin, this.dial, this);

        this.wrapper.appendChild(this.dial);
        this.container.appendChild(this.wrapper);
    }

    attachInteraction ()
    {
        this.dragDetach = attachDrag(this.dial, {
            // 0.75 turns of the drag lane spans the full 0..1 range.
            onDelta: (turns) => clamp01(this.value + turns * 0.75),
            onValue: (newValue) =>
            {
                const previous = this.value;
                this.value = newValue;
                this.render();
                const moved = this.notices.announceMovement(previous, newValue);
                if (moved && ! this.notices.isActive())
                    announceSettled(this.options.onSettled, previous, newValue);
            },
            onDragStart: () =>
            {
                this.notices.begin(this.value);
                this.options.onDragStart?.();
            },
            onDragEnd: () =>
            {
                this.notices.end(this.value);
                this.options.onDragEnd?.();
            },
            onStep: (direction) => clamp01(this.value + direction * this.options.step),
        });

        // Double-click to reset to default value
        this.dial.addEventListener('dblclick', () =>
        {
            const previous = this.value;
            this.value = clamp01(this.options.value ?? 0);
            this.render();
            const moved = this.notices.announceMovement(previous, this.value);
            if (moved && ! this.notices.isActive())
                announceSettled(this.options.onSettled, previous, this.value);
        });
    }

    /**
     * @brief Modulation amount for the ring: SIGNED normalised offset relative
     * to the parameter's range — native semantics ((mod - rangeStart) /
     * rangeLength), negative with bidirectional LFOs. Updates the skin only.
     * NaN/undefined mean "no data this frame" and clear rather than poison.
     * @param {number} modAmount  signed normalised offset, -1..1.
     */
    setModulation (modAmount)
    {
        const amount = Number(modAmount);

        this.modAmount = Number.isFinite(amount) ? Math.min(1, Math.max(-1, amount)) : 0;
        this.render();
    }

    /** @brief No modulation this frame: ring off. */
    clearModulation ()
    {
        this.modAmount = 0;
        this.render();
    }

    /** @brief Current modulation amount, for skins and tests. */
    getModulation () { return this.modAmount; }

    /** @brief Push the current value into the skin + aria. Skins re-read getValue. */
    render ()
    {
        this.skin?.update();
        this.dial.setAttribute('aria-valuenow', `${this.value}`);
        this.dial.setAttribute('aria-valuetext', this.options.format(this.value));
    }

    /**
     * @brief Programmatic update: does NOT fire onChange (user edits do).
     * @param {number} value  normalised 0..1.
     */
    setValue (value)
    {
        this.value = clamp01(Number(value) || 0);
        this.render();
    }

    getValue () { return this.value; }

    destroy ()
    {
        this.dragDetach?.();
        this.skin?.destroy();
        this.wrapper.remove();
    }
}

function clamp01 (v) { return Math.min(1, Math.max(0, v)); }
