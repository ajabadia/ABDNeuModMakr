/**
 * Waveform glyphs — the suite's canonical LFO/oscillator shapes.
 * ==============================================================
 *
 * Six shapes shared by every synth that has an LFO (or an oscillator): the
 * INDEX ORDER here matches the contract order used by the family
 * ("Sine, Triangle, Saw Up, Saw Down, Square, Random S&H" — the order the
 * native engines already publish in their generated parameter contracts).
 *
 * Each glyph is a complete inline SVG string (24x16 viewBox) drawn with
 * `fill="none"` and `stroke="currentColor"` inside the 24x8 MID BAND of the
 * canvas — so furniture decides where the mark sits (two-row segment puts it
 * above the text, LED buttons put it alone) and the theme decides the colour:
 * the mark follows the control's `currentColor` token like every other piece
 * of the family. No external assets, no CSS loading, WebView2-safe.
 *
 * Pure module: no DOM access at import time, safe for tests and worklets.
 */

/** Internal SVG shell: marks are drawn in the y=4..12 mid band of a 24x16 box. */
function svg (inner)
{
    return `<svg viewBox="0 0 24 16" width="24" height="16" aria-hidden="true" focusable="false">${inner}</svg>`;
}

const STROKE = 'stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"';

/** The six shapes, in contract index order. */
export const WAVEFORM_GLYPHS = [
    // 0 — Sine: one full period of a smooth arch.
    svg(`<path d="M2 8 C5 1.5, 8 1.5, 12 8 S 19 14.5, 22 8" ${STROKE}/>`),

    // 1 — Triangle: peak in the first half, valley in the second.
    svg(`<path d="M2 11 L7 4 L12 12 L17 4 L22 12" ${STROKE}/>`),

    // 2 — Saw Up: two rising ramps with vertical resets.
    svg(`<path d="M2 12 L11 4 L11 12 L20 4 L20 12" ${STROKE}/>`),

    // 3 — Saw Down: two falling ramps with vertical resets.
    svg(`<path d="M2 4 L11 12 L11 4 L20 12 L20 4" ${STROKE}/>`),

    // 4 — Square: two symmetric pulses (rise-fall, fall-rise).
    svg(`<path d="M2 12 L2 4 L12 4 L12 12 L22 12 L22 4" ${STROKE}/>`),

    // 5 — Random S&H: five sample dots at fixed pseudo-random levels.
    svg(
        [
            '<circle cx="3" cy="9" r="1.4" fill="currentColor"/>',
            '<circle cx="8" cy="5" r="1.4" fill="currentColor"/>',
            '<circle cx="12" cy="12" r="1.4" fill="currentColor"/>',
            '<circle cx="17" cy="6" r="1.4" fill="currentColor"/>',
            '<circle cx="21" cy="10" r="1.4" fill="currentColor"/>',
        ].join(''),
    ),
];

/** Short display names, same index order (used as button text under glyphs). */
export const WAVEFORM_NAMES = ['SINE', 'TRI', 'SAW↑', 'SAW↓', 'SQR', 'S&H'];

/** Contract-order label list for hosts that build options generically. */
export function waveformName (index)
{
    return WAVEFORM_NAMES[index] ?? '';
}
