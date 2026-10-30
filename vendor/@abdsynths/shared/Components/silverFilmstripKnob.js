/**
 * ABD SilverFilmstripKnob — RE-201 style large silver filmstrip knob.
 * Two variants:
 *   - 'preset': 12 positions (silver_re201_preset.png, 100x1200px, 100x100 each)
 *   - 'normal': 31 positions (silver_re201_normal.png, 60x1860px, 60x60 each)
 *
 * Usage:
 *   const knob = new SilverFilmstripKnob(el, { variant: 'preset', value: 0.5, onChange });
 *   knob.setValue(0.7);          // programatico: no dispara onChange
 *   knob.getMeta();
 *   knob.destroy();
 *   new SilverFilmstripKnob(el, { variant: 'normal', value: 0.3, onChange });
 */
import { attachDrag } from './drag-core.js';

/**
 * @param {HTMLElement|string} container
 * @param {object} options
 *   variant    'preset' (12 positions, default) or 'normal' (31 positions).
 *   value      initial position 0..1, default 0.
 *   size       px, default 100 ('preset') / 60 ('normal').
 *   label      optional text label.
 *   spriteUrl  filmstrip sprite, default one per variant.
 *   frames     positions in the sprite, default 12 / 31 by variant.
 *   frameSize  px per frame, default 100 / 60 by variant.
 *   onChange / onDragStart / onDragEnd  callbacks; setValue stays silent.
 */
export class SilverFilmstripKnob {
    constructor(container, options = {}) {
        this.container = typeof container === 'string'
            ? document.querySelector(container)
            : container;

        if (!this.container) throw new Error('SilverFilmstripKnob: container not found');

        this.options = {
            variant: options.variant ?? 'preset', // 'preset' | 'normal'
            value: options.value ?? 0,
            size: options.size ?? (options.variant === 'preset' ? 100 : 60),
            label: options.label ?? '',
            spriteUrl: options.spriteUrl ?? this._defaultSpriteUrl(options.variant),
            frames: options.frames ?? (options.variant === 'preset' ? 12 : 31),
            frameSize: options.frameSize ?? (options.variant === 'preset' ? 100 : 60),
            onChange: options.onChange ?? null,
            onDragStart: options.onDragStart ?? null,
            onDragEnd: options.onDragEnd ?? null,
            ...options,
        };

        this.value = clamp01(this.options.value);
        this.dragDetach = null;

        this.buildDom();
        this.attachInteraction();
        this.render();
    }

    _defaultSpriteUrl(variant) {
        return variant === 'preset'
            ? './assets/junio/silver_re201_preset.png'
            : './assets/junio/silver_re201_normal.png';
    }

    buildDom() {
        const { size, frameSize, frames, spriteUrl } = this.options;

        this.wrapper = document.createElement('div');
        this.wrapper.className = 'abd-silver-filmstrip-knob';
        this.wrapper.style.cssText = `
            display: inline-flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
            user-select: none;
        `;

        if (this.options.label) {
            this.labelEl = document.createElement('span');
            this.labelEl.className = 'abd-silver-filmstrip-knob__label';
            this.labelEl.style.cssText = `
                font-size: 10px;
                font-weight: 600;
                color: var(--color-text-muted, #7e9bb5);
                text-transform: uppercase;
                letter-spacing: 0.5px;
            `;
            this.labelEl.textContent = this.options.label;
            this.wrapper.appendChild(this.labelEl);
        }

        // Knob viewport (the visible filmstrip frame)
        this.dial = document.createElement('div');
        this.dial.className = 'abd-silver-filmstrip-knob__dial';
        this.dial.style.cssText = `
            position: relative;
            width: ${size}px;
            height: ${size}px;
            cursor: grab;
            touch-action: none;
            outline: none;
            overflow: hidden;
            border-radius: 50%;
            box-shadow: inset 0 2px 6px rgba(0,0,0,0.5), 0 2px 4px rgba(0,0,0,0.3);
        `;

        // Filmstrip element — the actual sprite that scrolls
        this.filmstrip = document.createElement('div');
        this.filmstrip.className = 'abd-silver-filmstrip-knob__filmstrip';
        this.filmstrip.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: ${frameSize}px;
            height: ${frameSize * frames}px;
            background-image: url('${spriteUrl}');
            background-repeat: no-repeat;
            background-size: ${frameSize}px ${frameSize * frames}px;
            background-position: center 0%;
            pointer-events: none;
            transition: background-position 0ms; /* instant for drag */
        `;
        this.dial.appendChild(this.filmstrip);

        this.wrapper.appendChild(this.dial);
        this.container.appendChild(this.wrapper);
    }

    attachInteraction() {
        this.dragDetach = attachDrag(this.dial, {
            onDelta: (turns) => clamp01(this.value + turns * 0.5),
            onValue: (newValue) => {
                this.value = newValue;
                this.render();
                this.options.onChange?.(this.value, this.getMeta());
            },
            onDragStart: () => this.options.onDragStart?.(),
            onDragEnd: () => this.options.onDragEnd?.(),
            onStep: (direction) => {
                const step = 1 / (this.options.frames - 1);
                return clamp01(this.value + direction * step);
            },
        }, { dragLanePx: 120 });
    }

    render() {
        const { frames, frameSize } = this.options;
        const frame = Math.round(this.value * (frames - 1));
        const yOffset = frame * frameSize;
        this.filmstrip.style.backgroundPosition = `center -${yOffset}px`;
    }

    getMeta() {
        const frame = Math.round(this.value * (this.options.frames - 1));
        return {
            index: frame,
            frame: frame + 1,
            totalFrames: this.options.frames,
        };
    }

    /**
     * @brief Programmatic update: does NOT fire onChange (user edits do).
     * @param {number} value  normalizado 0..1; se recorta.
     */
    setValue(value) {
        this.value = clamp01(Number(value) || 0);
        this.render();
    }

    getValue() { return this.value; }

    destroy() {
        this.dragDetach?.();
        this.wrapper.remove();
    }
}

function clamp01(v) { return Math.min(1, Math.max(0, v)); }