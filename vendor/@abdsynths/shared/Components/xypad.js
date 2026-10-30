/**
 * ABD XYPad — reusable 2D pad for the ABDSynths suite.
 *
 * Family rules (see components/wheel.js, knob.js, slider.js):
 *   - same contract: constructor(container, options), setValue/getValue/destroy,
 *     onChange + onDragStart/onDragEnd for host gesture bridging;
 *   - framework-agnostic: DOM + options in, callbacks out; no bridge code here;
 *   - themed only via CSS custom properties from styles/tokens.css;
 *   - keyboard: arrows move the thumb, PageUp/Down bigger steps, Home/End corners.
 *
 * Value model — the NEURONiK pad convention (XYPad.cpp):
 *   - value = { x, y } NORMALISED 0..1 each;
 *   - y = 1 is the TOP of the pad (screen Y grows downward, pad Y grows up);
 *   - onChange fires with { x, y } on user edits; setValue() is silent by
 *     default so programmatic updates (bridge snapshots) don't echo back. Como el
 *     resto del linaje, el aviso es de TRANSICION, no de intencion: empujar una
 *     flecha contra el borde, o pedir el punto donde ya esta, no avisa
 *     (transitionNotices.js);
 *   - unlike knob/slider, the pad is an ABSOLUTE surface: clicking jumps there.
 *
 * Corner labels (optional): `corners: [topLeft, topRight, bottomLeft,
 * bottomRight]` paints one label per corner (a morph pad naming the model that
 * lives at each corner — the native XYPad::paint does the same). Empty strings
 * hide their corner. While corners are visible the percent readout is hidden:
 * the corners say WHAT is where and the crosshair says WHERE; the value stays
 * readable through aria-valuetext. Update them any time with setCorners().
 *
 * Usage:
 *   const pad = new XYPad(el, { x: 0.5, y: 0.5, onChange, onDragStart, onDragEnd });
 *   pad.setValue({ x: 0.2, y: 0.8 });   // silent, for external updates
 *   pad.setCorners(['Piano', '', 'Bell', '']); // labels, any time
 *   pad.getValue();                      // -> { x, y }
 */

import { announceSettled, createContinuousNotices } from './continuousNotices.js';

const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

const CORNER_POSITIONS = ['tl', 'tr', 'bl', 'br'];

/**
 * @param {HTMLElement|string} container
 * @param {object} options
 *   x / y           initial value, normalised 0..1 each, default 0.5.
 *   width / height  px, default 220.
 *   label           text above the pad, optional (doubles as its accessible name).
 *   ariaLabel       accessible name override, optional.
 *   step            keyboard step, default 0.01.
 *   format          (normalised) => string readout, default percent.
 *   corners         [topLeft, topRight, bottomLeft, bottomRight] labels; empty
 *                   strings hide their corner. setCorners() updates them later.
 *   onChange    ({ x, y }) => void, fires on user edits (not on setValue) — aviso por MOVIMIENTO, por paso.
 *   onSettled   ({ x, y }) => void, fires ONCE per gesture when the drag settles (pointerup); only if the final point differs from the gesture start. A drag that ends where it started does not settle; programmatic setValue never settles. Keyboard steps settle immediately.
 *   onDragStart / onDragEnd  for host gesture bridging (automation).
 */
export class XYPad
{
    constructor (container, options = {})
    {
        this.container = typeof container === 'string'
            ? document.querySelector(container)
            : container;

        if (this.container == null)
            throw new Error('ABD XYPad: container not found');

        this.options = {
            x: 0.5,
            y: 0.5,
            width: 220,
            height: 220,
            label: '',
            ariaLabel: null,
            step: 0.01,
            format: (v) => `${Math.round(v * 100)}%`,
            corners: null,
            onChange: null,
            onSettled: null,
            onDragStart: null,
            onDragEnd: null,
            ...options,
        };

        this.value = { x: clamp01(this.options.x), y: clamp01(this.options.y) };
        this._destroyed = false;
        this._dragging = false;
        this.notices = createContinuousNotices({
            onMovement: (v) => this.options.onChange?.(v),
            onSettled: (v) => this.options.onSettled?.(v),
        });

        this.buildDom();
        this.attachInteraction();
        this.render();
    }

    buildDom ()
    {
        this.wrapper = document.createElement('div');
        this.wrapper.className = 'abd-xypad';
        this.wrapper.style.setProperty('--abd-xypad-w', `${this.options.width}px`);
        this.wrapper.style.setProperty('--abd-xypad-h', `${this.options.height}px`);

        if (this.options.label)
        {
            this.labelEl = document.createElement('span');
            this.labelEl.className = 'abd-xypad__label';
            this.labelEl.textContent = this.options.label;
            this.wrapper.appendChild(this.labelEl);
        }

        this.pad = document.createElement('div');
        this.pad.className = 'abd-xypad__pad';
        this.pad.tabIndex = 0;
        // role=slider, not 'application': the keyboard MOVES the value (arrows,
        // PageUp/Down, Home/End), which is exactly the slider contract. Absolute
        // pointer jumps are an input method, not a role.
        this.pad.setAttribute('role', 'slider');
        this.pad.setAttribute('aria-valuemin', '0');
        this.pad.setAttribute('aria-valuemax', '1');
        const accessibleName = this.options.ariaLabel ?? this.options.label;
        this.pad.setAttribute('aria-label', accessibleName || 'X-Y pad');
        this.pad.setAttribute('aria-valuenow', `${this.value.x}`);
        this.pad.setAttribute('aria-valuetext', this.formatXY());

        this.pad.innerHTML = `
            <div class="abd-xypad__grid"></div>
            <div class="abd-xypad__line abd-xypad__line--v"></div>
            <div class="abd-xypad__line abd-xypad__line--h"></div>
            <div class="abd-xypad__thumb"></div>
            <span class="abd-xypad__readout">${this.formatXY()}</span>`;

        this.renderAria();
        this.lineV = this.pad.querySelector('.abd-xypad__line--v');
        this.lineH = this.pad.querySelector('.abd-xypad__line--h');
        this.thumb = this.pad.querySelector('.abd-xypad__thumb');
        this.readout = this.pad.querySelector('.abd-xypad__readout');

        this.wrapper.appendChild(this.pad);

        this.renderCorners();

        this.container.appendChild(this.wrapper);
    }

    /** @brief aria-valuenow follows the live value (valuetext does the pair). */
    renderAria ()
    {
        this.pad.setAttribute('aria-valuenow', `${this.value.x}`);
        this.pad.setAttribute('aria-valuetext', this.formatXY());
    }

    attachInteraction ()
    {
        // Absolute positioning: the pad IS the value surface. Pointer down jumps
        // to that point. Y inversion lives here: screen y -> pad y = 1 - ratio.
        this.pad.addEventListener('pointerdown', (event) => {
            this._dragging = true;
            this.notices.begin(this.value);
            try { this.pad.setPointerCapture(event.pointerId); } catch { /* jsdom */ }
            this.pad.focus({ preventScroll: true });
            if (this.options.onDragStart) this.options.onDragStart();
            this.applyPointerPosition(event);
        });

        this.pad.addEventListener('pointermove', (event) => {
            this.applyPointerPosition(event);
        });

        const endDrag = () => {
            if (!this._dragging) return;
            this._dragging = false;
            this.notices.end(this.value);
            if (this.options.onDragEnd) this.options.onDragEnd();
        };

        this.pad.addEventListener('pointerup', endDrag);
        this.pad.addEventListener('pointercancel', endDrag);

        // Keyboard: arrows = one step; PageUp/Down = ten; Home/End = corners.
        this.pad.addEventListener('keydown', (event) => {
            const step = this.options.step;
            const { x, y } = this.value;

            switch (event.key)
            {
                case 'ArrowLeft':  this.setValue({ x: x - step, y }, true); break;
                case 'ArrowRight': this.setValue({ x: x + step, y }, true); break;
                case 'ArrowUp':    this.setValue({ x, y: y + step }, true); break;
                case 'ArrowDown':  this.setValue({ x, y: y - step }, true); break;
                case 'PageUp':     this.setValue({ x, y: y + step * 10 }, true); break;
                case 'PageDown':   this.setValue({ x, y: y - step * 10 }, true); break;
                case 'Home':       this.setValue({ x: 0, y: 0 }, true); break;
                case 'End':        this.setValue({ x: 1, y: 1 }, true); break;
                default: return;
            }

            event.preventDefault();
        });
    }

    applyPointerPosition (event)
    {
        if (!this._dragging) return;

        const rect = this.pad.getBoundingClientRect();

        // Y inversion: y = 1 - (clientY - top)/height, clamped 0..1.
        const x = clamp01((event.clientX - rect.left) / rect.width);
        const y = clamp01(1 - (event.clientY - rect.top) / rect.height);

        this.setValue({ x, y }, true);
    }

    /**
     * Silent, programmatic update (bridge snapshots). Notifies only when asked,
     * and then only on a REAL transition: the same point is an intention, not a
     * transition, and calls nobody.
     * @param {{ x: number, y: number }} value  normalised 0..1 each.
     * @param {boolean} [notify]  cuando es true, avisa del cambio (una vez, y solo
     *                            si el punto cambio).
     */
    setValue ({ x, y }, notify = false)
    {
        if (this._destroyed) return;

        const previous = this.value;
        this.value = { x: clamp01(x), y: clamp01(y) };
        this.render();

        if (notify)
        {
            const moved = this.notices.announceMovement(previous, this.value);
            if (moved && ! this.notices.isActive())
                announceSettled(this.options.onSettled, previous, this.value);
        }
    }

    /** @returns {object} copia del valor actual, `{ x, y }` normalizado 0..1. */
    getValue () { return { ...this.value }; }

    /**
     * Corner labels, any time after construction: [topLeft, topRight,
     * bottomLeft, bottomRight]. An empty string hides its corner; `null`
     * removes every label. Rebuilding four spans is cheaper than diffing them.
     * @param {Array} corners  hasta cuatro etiquetas; `null` las quita todas.
     */
    setCorners (corners)
    {
        this.options.corners = Array.isArray(corners) ? corners.slice(0, 4) : null;
        this.renderCorners();
    }

    renderCorners ()
    {
        for (const stale of this.pad.querySelectorAll('.abd-xypad__corner'))
            stale.remove();

        const corners = this.options.corners;

        if (!Array.isArray(corners)) return;

        this.wrapper.classList.add('abd-xypad--corners');

        corners.forEach((text, index) =>
        {
            if (!text) return;

            const span = document.createElement('span');

            span.className = 'abd-xypad__corner';
            span.dataset.corner = CORNER_POSITIONS[index];
            span.textContent = text;
            this.pad.appendChild(span);
        });
    }

    render ()
    {
        if (this._destroyed) return;

        const { x, y } = this.value;
        const pct = (v) => `${v * 100}%`;

        // Screen coords: top = y 1 (same inversion as JUCE XYPad.cpp).
        this.lineV.style.left = pct(x);
        this.lineH.style.top = pct(1 - y);
        this.thumb.style.left = pct(x);
        this.thumb.style.top = pct(1 - y);

        const text = this.formatXY();
        this.readout.textContent = text;
        this.pad.setAttribute('aria-valuenow', `${x}`);
        this.pad.setAttribute('aria-valuetext', text);
    }

    formatXY ()
    {
        return `X ${this.options.format(this.value.x)} / Y ${this.options.format(this.value.y)}`;
    }

    destroy ()
    {
        if (this._destroyed) return;

        this._destroyed = true;
        this.wrapper.remove();
    }
}
