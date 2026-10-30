/**
 * ABD enhanceRangeInputs — auto-skin <input type="range"> into FilmstripFader.
 *
 * Drop-in replacement for the MS2000 initFilmstrips(). Scans a root element
 * for range inputs and replaces each with a photorealistic FilmstripFader,
 * preserving the original input as a hidden accessibility sync target.
 *
 * @param {HTMLElement} root       Container to search (default: document)
 * @param {object} options         Global defaults (per-input attrs override)
 *   spriteUrl          Filmstrip sprite URL (required)
 *   frameWidth         px per frame
 *   frameHeight        px per frame
 *   frames             total frames (default 128)
 *   orientationAttr    data attribute for orientation (default: 'data-orientation')
 *   verticalClass      class that forces vertical (default: 'vocoder-v-slider')
 *   verticalAttr       attribute that forces vertical (default: 'orient="vertical"')
 *
 * Each <input type="range"> can override via:
 *   data-sprite-url, data-frame-width, data-frame-height, data-frames,
 *   data-orientation, data-viewport-width, data-viewport-height
 *
 * The original input is kept as a hidden overlay (opacity: 0, z-index: 5)
 * so form submission, validation, and screen readers still work.
 *
 * Usage:
 *   import { enhanceRangeInputs } from '@abdsynths/shared/utils';
 *   enhanceRangeInputs(document.body, { spriteUrl: '/assets/fader.png' });
 */
import { FilmstripFader } from '../Components/index.js';

function clamp01(v) { return Math.min(1, Math.max(0, v)); }

function parseFloatOr(v, def) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : def;
}

function parseIntOr(v, def) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : def;
}

export function enhanceRangeInputs(root = document, options = {}) {
    const sliders = root.querySelectorAll('input[type="range"]');

    sliders.forEach(input => {
        if (input._filmstripEnhanced)
            return;

        // Orientation detection
        const isVertical = input.classList.contains(options.verticalClass ?? 'vocoder-v-slider')
            || input.dataset.orientation === 'vertical'
            || input.getAttribute(options.verticalAttr ?? 'orient') === 'vertical'
            || input.getAttribute('data-orientation') === 'vertical';

        // Per-input overrides (data-attrs win over global options)
        const spriteUrl = input.dataset.spriteUrl ?? options.spriteUrl;
        if (!spriteUrl) {
            console.warn('[enhanceRangeInputs] spriteUrl missing for', input);
            return;
        }

        const frameWidth = parseIntOr(input.dataset.frameWidth, options.frameWidth ?? (isVertical ? 58 : 230));
        const frameHeight = parseIntOr(input.dataset.frameHeight, options.frameHeight ?? (isVertical ? 107 : 69));
        const frames = parseIntOr(input.dataset.frames, options.frames ?? 128);
        const viewportWidth = parseIntOr(input.dataset.viewportWidth, options.viewportWidth ?? (isVertical ? 36 : 140));
        const viewportHeight = parseIntOr(input.dataset.viewportHeight, options.viewportHeight ?? (isVertical ? 80 : 32));

        const min = parseFloatOr(input.min, 0);
        const max = parseFloatOr(input.max, 127);
        const initialValue = parseFloatOr(input.value, min);
        const normalised = clamp01((initialValue - min) / (max - min || 1));

        // Create FilmstripFader wrapper
        const fader = new FilmstripFader(input.parentElement, {
            orientation: isVertical ? 'vertical' : 'horizontal',
            spriteUrl,
            frameWidth,
            frameHeight,
            frames,
            viewportWidth,
            viewportHeight,
            value: normalised,
            label: input.dataset.label ?? '',
            ariaLabel: input.getAttribute('aria-label') ?? input.id ?? '',
            format: (v) => {
                const realVal = min + v * (max - min);
                const unit = input.dataset.unit ?? '';
                return `${Math.round(realVal)}${unit ? ' ' + unit : ''}`;
            },
            onChange: (v) => {
                const realVal = min + v * (max - min);
                input.value = realVal;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            },
        });

        // Keep original input as hidden accessibility sync target
        input.style.position = 'absolute';
        input.style.top = '0';
        input.style.left = '0';
        input.style.width = '100%';
        input.style.height = '100%';
        input.style.opacity = '0';
        input.style.pointerEvents = 'none';
        input.style.zIndex = '5';
        input.style.margin = '0';

        // Sync: FilmstripFader -> input (already done in onChange above)
        // Sync: input -> FilmstripFader (for programmatic updates)
        const syncFromInput = () => {
            const val = parseFloatOr(input.value, min);
            const norm = clamp01((val - min) / (max - min || 1));
            fader.setValue(norm);
        };
        input.addEventListener('input', syncFromInput);
        input.addEventListener('change', syncFromInput);

        // Mark as enhanced
        input._filmstripEnhanced = true;
        input._filmstripFader = fader;

        // Cleanup on removal (optional: MutationObserver could auto-destroy)
        const originalRemove = input.remove.bind(input);
        input.remove = () => {
            fader.destroy();
            input.removeEventListener('input', syncFromInput);
            input.removeEventListener('change', syncFromInput);
            originalRemove();
        };
    });
}

/** @brief Destroy all enhanced faders in a root. */
export function destroyEnhancedRangeInputs(root = document) {
    const sliders = root.querySelectorAll('input[type="range"]');
    sliders.forEach(input => {
        if (input._filmstripFader) {
            input._filmstripFader.destroy();
            input._filmstripFader = null;
            input._filmstripEnhanced = false;
        }
    });
}