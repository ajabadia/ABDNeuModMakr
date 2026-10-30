/**
 * ABD FilmstripFader — photorealistic hardware fader (viewport + scrolling filmstrip).
 *
 * Replicates the MS2000/SliderFilmstrip paradigm: a fixed viewport shows a
 * vertically-stacked filmstrip sprite. As the value changes, the sprite scrolls
 * behind the viewport. Not a thumb-on-track slider — the whole fader image IS
 * the moving part, like a physical fader.
 *
 * Family rules:
 *   - constructor(container, options) + setValue/getValue/destroy + onChange
 *   - interaction via drag-core (drag, wheel, arrow keys)
 *   - value model: normalised 0..1
 *   - themed via CSS tokens, sprite via options
 *
 * Usage:
 *   const fader = new FilmstripFader(el, { spriteUrl, value: 0.5, onChange });
 *   fader.setValue(0.8);
 *   fader.getValue();
 *   fader.destroy();
 *
 * @param {HTMLElement|string} container
 * @param {object} options
 *   orientation       'vertical' | 'horizontal', default 'vertical'
 *   viewportWidth     px of the visible window (default: 36 vertical, 140 horizontal)
 *   viewportHeight    px of the visible window (default: 80 vertical, 32 horizontal)
 *   spriteUrl         required: filmstrip sprite (frames stacked vertically for vertical,
 *                     horizontally for horizontal)
 *   frameWidth        px per frame (default: 58 vertical, 230 horizontal)
 *   frameHeight       px per frame (default: 107 vertical, 69 horizontal)
 *   frames            total frames (default: 128)
 *   value             initial normalised 0..1
 *   label             optional text label
 *   ariaLabel         accessible name override
 *   format            (normalised) => string readout
 *   step              keyboard step, default 0.01
 *   onChange / onDragStart / onDragEnd  callbacks
 */
import { attachDrag } from './drag-core.js';

export class FilmstripFader {
    /**
     * @param {HTMLElement|string} container  elemento o selector donde montarse.
     * @param {object} options  ver bloque de arriba: spriteUrl, frameWidth/Height,
     *                          frames, value, label, ariaLabel, format, step, callbacks.
     */
    constructor(container, options = {}) {
        this.container = typeof container === 'string'
            ? document.querySelector(container)
            : container;

        if (this.container == null)
            throw new Error('ABD FilmstripFader: container not found');

        const vertical = options.orientation !== 'horizontal';

        this.options = {
            orientation: vertical ? 'vertical' : 'horizontal',
            viewportWidth: options.viewportWidth ?? (vertical ? 36 : 140),
            viewportHeight: options.viewportHeight ?? (vertical ? 80 : 32),
            spriteUrl: options.spriteUrl ?? '',
            frameWidth: options.frameWidth ?? (vertical ? 58 : 230),
            frameHeight: options.frameHeight ?? (vertical ? 107 : 69),
            frames: options.frames ?? 128,
            value: options.value ?? 0,
            label: options.label ?? '',
            ariaLabel: options.ariaLabel ?? null,
            step: options.step ?? 0.01,
            format: options.format ?? ((v) => `${Math.round(v * 100)}%`),
            onChange: options.onChange ?? null,
            onDragStart: options.onDragStart ?? null,
            onDragEnd: options.onDragEnd ?? null,
            ...options,
        };

        if (!this.options.spriteUrl)
            throw new Error('ABD FilmstripFader: spriteUrl required');

        this.value = clamp01(this.options.value);
        this.dragDetach = null;
        this.isDragging = false;

        this.buildDom();
        this.attachInteraction();
        this.render();
    }

    buildDom() {
        const vertical = this.options.orientation === 'vertical';

        this.wrapper = document.createElement('div');
        this.wrapper.className = 'abd-filmstrip-fader'
            + (vertical ? ' abd-filmstrip-fader--vertical' : ' abd-filmstrip-fader--horizontal');

        this.wrapper.style.setProperty('--abd-fader-vw', `${this.options.viewportWidth}px`);
        this.wrapper.style.setProperty('--abd-fader-vh', `${this.options.viewportHeight}px`);

        if (this.options.label) {
            this.labelEl = document.createElement('span');
            this.labelEl.className = 'abd-filmstrip-fader__label';
            this.labelEl.textContent = this.options.label;
            this.wrapper.appendChild(this.labelEl);
        }

        // Viewport: fixed window into the sprite
        this.viewport = document.createElement('div');
        this.viewport.className = 'abd-filmstrip-fader__viewport';
        this.viewport.tabIndex = 0;
        this.viewport.setAttribute('role', 'slider');
        this.viewport.setAttribute('aria-valuemin', '0');
        this.viewport.setAttribute('aria-valuemax', '1');
        const accessibleName = this.options.ariaLabel ?? this.options.label;
        if (accessibleName)
            this.viewport.setAttribute('aria-label', accessibleName);
        if (vertical)
            this.viewport.setAttribute('aria-orientation', 'vertical');

        // Sprite element: the filmstrip that scrolls behind the viewport
        this.sprite = document.createElement('div');
        this.sprite.className = 'abd-filmstrip-fader__sprite';
        this.sprite.style.backgroundImage = `url('${this.options.spriteUrl}')`;
        this.sprite.style.backgroundRepeat = 'no-repeat';
        this.sprite.style.backgroundSize = vertical
            ? `${this.options.frameWidth}px ${this.options.frameHeight * this.options.frames}px`
            : `${this.options.frameWidth * this.options.frames}px ${this.options.frameHeight}px`;
        this.viewport.appendChild(this.sprite);

        this.valueEl = document.createElement('span');
        this.valueEl.className = 'abd-filmstrip-fader__value';

        this.wrapper.appendChild(this.viewport);
        this.wrapper.appendChild(this.valueEl);
        this.container.appendChild(this.wrapper);
    }

    attachInteraction() {
        const vertical = this.options.orientation === 'vertical';
        const dragLanePx = vertical ? this.options.viewportHeight : this.options.viewportWidth;

        this.dragDetach = attachDrag(this.viewport, {
            onDelta: (turns) => clamp01(this.value + turns),
            onValue: (newValue) => {
                this.value = newValue;
                this.render();
                this.options.onChange?.(this.value);
            },
            onDragStart: () => {
                this.isDragging = true;
                this.options.onDragStart?.();
            },
            onDragEnd: () => {
                this.isDragging = false;
                this.options.onDragEnd?.();
            },
            onStep: (direction) => clamp01(this.value + direction * this.options.step),
        }, { dragLanePx: Math.max(40, dragLanePx) });

        // Double-click to reset to default value
        this.viewport.addEventListener('dblclick', () => {
            this.value = clamp01(this.options.value ?? 0);
            this.render();
            this.options.onChange?.(this.value);
        });
    }

    render() {
        const v = this.value;
        const frames = this.options.frames;
        const frame = Math.round(v * (frames - 1));

        if (this.options.orientation === 'vertical') {
            const offset = (frame / (frames - 1)) * 100;
            this.sprite.style.backgroundPositionY = `${offset}%`;
            this.sprite.style.backgroundPositionX = 'center';
        } else {
            const offset = (frame / (frames - 1)) * 100;
            this.sprite.style.backgroundPositionX = `${offset}%`;
            this.sprite.style.backgroundPositionY = 'center';
        }

        const text = this.options.format(v);
        this.valueEl.textContent = text;
        this.viewport.setAttribute('aria-valuenow', `${v}`);
        this.viewport.setAttribute('aria-valuetext', text);
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