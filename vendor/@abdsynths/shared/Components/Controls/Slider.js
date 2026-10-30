/**
 * ABD Slider — reusable linear slider for the ABDSynths suite.
 *
 * Family rules apply (see components/wheel.js and knob.js):
 *   - constructor(container, options) + setValue/getValue/destroy + onChange;
 *   - interaction through the shared drag-core (drag, wheel, arrow keys);
 *   - pure DOM/CSS, theming via --color-* tokens with fallbacks;
 *   - value model: normalised 0..1.
 *
 * Orientation is horizontal (default) or vertical via `orientation`. LOOK lives
 * in a skin (components/skins): 'vector' (default fill+thumb) or 'junio'
 * (slot+cap photo sprites). A filmstrip thumb overrides the skin's thumb.
 *
 * Usage:
 *   const slider = new Slider(el, { orientation: 'vertical', value: 0.5 });
 *   slider.setValue(0.8);   // programatico: no dispara onChange
 *   slider.getValue();
 */

import { attachDrag } from './drag-core.js';
import { applySkin, CONTROL_KIND } from './skins/index.js';
import { announceSettled, createContinuousNotices } from './continuousNotices.js';

/**
 * @param {HTMLElement|string} container
 * @param {object} options
 *   orientation   'horizontal' | 'vertical', default horizontal.
 *   length        px of the track, default 160 (horizontal) / 160 (vertical).
 *   value         initial normalised 0..1.
 *   label         optional text label.
 *   ariaLabel     accessible name override (defaults to `label`'s text).
 *   format        (normalised) => string readout.
 *   step          keyboard step, default 0.01.
 *   skin          skin name (see components/skins), default 'vector'.
 *   spriteUrl     optional filmstrip sprite for the thumb (frames stacked vertically).
 *   frameWidth/frameHeight/frames  sprite geometry when spriteUrl is set.
 *   onChange    (normalised) => void, fires on user edits (not on setValue).
 *   onSettled   (normalised) => void, fires ONCE per gesture when the value settles (pointerup / drag end); only if the final value differs from the gesture start. Keyboard steps and wheel notches settle immediately.
 *   onDragStart / onDragEnd  for host gesture bridging.
 */
export class Slider
{
    constructor (container, options = {})
    {
        this.container = typeof container === 'string'
            ? document.querySelector(container)
            : container;

        if (this.container == null)
            throw new Error('ABD Slider: container not found');

        this.options = {
            orientation: 'horizontal',
            length: 160,
            value: 0,
            label: '',
            ariaLabel: null,
            step: 0.01,
            skin: 'vector',
            format: (v) => `${Math.round(v * 100)}%`,
            spriteUrl: null,
            frameWidth: 36,
            frameHeight: 36,
            frames: 1,
            onChange: null,
            onSettled: null,
            onDragStart: null,
            onDragEnd: null,
            ...options,
        };

        this.value = clamp01(this.options.value);
        this.dragDetach = null;
        this.notices = createContinuousNotices({
            onMovement: (v) => this.options.onChange?.(v),
            onSettled: (v) => this.options.onSettled?.(v),
        });
        this[CONTROL_KIND] = 'slider';

        this.buildDom();
        this.attachInteraction();
        this.render();
    }

    buildDom ()
    {
        const vertical = this.options.orientation === 'vertical';

        this.wrapper = document.createElement('div');
        this.wrapper.className = 'abd-slider'
            + (vertical ? ' abd-slider--vertical' : '');
        this.wrapper.style.setProperty(
            '--abd-slider-length', `${this.options.length}px`);

        if (this.options.label)
        {
            this.labelEl = document.createElement('span');
            this.labelEl.className = 'abd-slider__label';
            this.labelEl.textContent = this.options.label;
            this.wrapper.appendChild(this.labelEl);
        }

        this.track = document.createElement('div');
        this.track.className = 'abd-slider__track';
        this.track.tabIndex = 0;
        this.track.setAttribute('role', 'slider');
        this.track.setAttribute('aria-valuemin', '0');
        this.track.setAttribute('aria-valuemax', '1');
        // Same naming contract as knob.js: a div[role=slider] cannot be tied
        // with <label for>, so the name travels ON the track — explicit
        // ariaLabel, else the visible label's text.
        const accessibleName = this.options.ariaLabel ?? this.options.label;
        if (accessibleName)
            this.track.setAttribute('aria-label', accessibleName);
        // Orientation is meaningful to assistive tech only on the vertical
        // case ('horizontal' is the implicit default).
        if (vertical)
            this.track.setAttribute('aria-orientation', 'vertical');

        this.fill = document.createElement('div');
        this.fill.className = 'abd-slider__fill';
        this.track.appendChild(this.fill);

        this.thumb = document.createElement('div');
        this.thumb.className = 'abd-slider__thumb';
        this.track.appendChild(this.thumb);

        this.valueEl = document.createElement('span');
        this.valueEl.className = 'abd-slider__value';

        this.wrapper.appendChild(this.track);
        this.wrapper.appendChild(this.valueEl);
        this.container.appendChild(this.wrapper);

        if (this.options.spriteUrl)
            this.applySprite();

        this.skin = applySkin(this.options.skin, this.wrapper, this);
    }

    /** @brief Optional filmstrip thumb, same mechanic as the family wheels. */
    applySprite ()
    {
        const { spriteUrl, frameWidth, frameHeight, frames } = this.options;

        this.thumb.style.width = `${frameWidth}px`;
        this.thumb.style.height = `${frameHeight}px`;
        this.thumb.style.backgroundImage = `url('${spriteUrl}')`;
        this.thumb.style.backgroundRepeat = 'no-repeat';
        this.thumb.dataset.sprite = 'true';
        this.thumb.dataset.frames = `${frames}`;
    }

    attachInteraction ()
    {
        // Lane px scales with the track length so the drag feel is constant whatever
        // the slider size.
        this.dragDetach = attachDrag(this.track, {
            onDelta: (turns) => clamp01(this.value + turns),
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
        }, { dragLanePx: Math.max(60, this.options.length) });
    }

    render ()
    {
        const v = this.value;

        if (this.options.orientation === 'vertical')
        {
            this.fill.style.height = `${v * 100}%`;
            this.fill.style.width = '100%';
            this.thumb.style.bottom = `${v * 100}%`;
        }
        else
        {
            this.fill.style.width = `${v * 100}%`;
            this.fill.style.height = '100%';
            this.thumb.style.left = `${v * 100}%`;
        }

        if (this.thumb.dataset.sprite)
        {
            // Filmstrip: shift the sprite window to the frame nearest the value.
            const frames = Number(this.thumb.dataset.frames) || 1;
            const frame = Math.round(v * (frames - 1));

            this.thumb.style.backgroundPosition =
                `0 -${frame * this.options.frameHeight}px`;
        }

        const text = this.options.format(v);
        this.valueEl.textContent = text;
        this.track.setAttribute('aria-valuenow', `${v}`);
        this.track.setAttribute('aria-valuetext', text);
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
