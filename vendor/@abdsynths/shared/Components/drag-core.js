/**
 * ABDSharedAssets — shared pointer-drag behaviour for controls (knob, slider...).
 *
 * DRY core: one drag mapper with gesture callbacks, used by every control in the
 * family so the interaction feel is identical. No control implements its own
 * pointer maths.
 *
 * Family rules (see components/wheel.js, the first member):
 *   - framework-agnostic: DOM + options in, callbacks out; no JUCE, no bridge;
 *   - themed exclusively through CSS custom properties (--color-*, --text-*);
 *   - every control cleans up after itself in destroy().
 */

/**
 * Attach vertical-drag (and wheel) value editing to an element.
 *
 * The element is made focusable so keyboard (ArrowUp/Down) works too — the same
 * convention as a native <input type=range>.
 *
 * @param {HTMLElement} element      The draggable surface.
 * @param {{ onDelta: function(number, number): number, onDragStart?: function(): void,
 *          onDragEnd?: function(): void, onStep?: function(number): number }} handlers
 * @param {function(number, number): number} handlers.onDelta
 *   Receives (deltaTurns, pixelDelta) — RELATIVE to the previous move: pixels
 *   travelled since the last pointer event divided by a full drag lane
 *   (options.dragLanePx, default 150 px). Handlers add it to the current value
 *   (value + turns), so each pixel of travel counts exactly once — an absolute
 *   from-start delta here would compound with the handler's own accumulation
 *   and the control would accelerate quadratically. Return the new value.
 * @param {function(number): void} [handlers.onValue]   Notified with the value each
 *          handler returned (host-side hook).
 * @param {function(): void} [handlers.onDragStart]  User grabbed the control.
 * @param {function(): void} [handlers.onDragEnd]    User released it.
 * @param {function(number): number} [handlers.onStep]  Keyboard step; returns new value.
 * @param {object} [options] { dragLanePx }
 * @returns {function(): void} detach — removes every listener (call from destroy()).
 *
 * Usage:
 *   const detach = attachDrag(el, {
 *     onDelta: (turns) => value + turns,
 *     onStep: (direction) => clamp(value + direction, 0, 1),
 *   });
 *   detach();
 */
export function attachDrag (element, handlers, options = {})
{
    const dragLanePx = options.dragLanePx ?? 150;

    let dragging = false;
    let lastY = 0;
    let lastX = 0;

    const onPointerDown = (event) =>
    {
        dragging = true;
        lastY = event.clientY;
        lastX = event.clientX;
        element.setPointerCapture?.(event.pointerId);
        element.focus?.({ preventScroll: true });
        handlers.onDragStart?.();
        event.preventDefault();
    };

    const onPointerMove = (event) =>
    {
        if (! dragging)
            return;

        // Vertical drag dominates, but horizontal component lets horizontal sliders
        // feel natural too (whichever axis moves more wins). Deltas are relative to
        // the PREVIOUS position, so value tracks the pointer 1:1 (no compounding).
        const dy = lastY - event.clientY;
        const dx = event.clientX - lastX;
        const pixelDelta = Math.abs(dy) >= Math.abs(dx) ? dy : dx;

        lastY = event.clientY;
        lastX = event.clientX;

        const speed = event.shiftKey ? 0.2 : 1.0; // Shift = fine tune (0.2x)
        const newValue = handlers.onDelta(pixelDelta / dragLanePx * speed, pixelDelta);

        if (newValue !== undefined)
            handlers.onValue?.(newValue);
    };

    const endDrag = () =>
    {
        if (! dragging)
            return;

        dragging = false;
        handlers.onDragEnd?.();
    };

    const onWheel = (event) =>
    {
        // One wheel notch = 1/20 of the drag lane, a fine step.
        event.preventDefault();
        const step = -event.deltaY / (dragLanePx * 20);
        const newValue = handlers.onDelta(step, 0);

        if (newValue !== undefined)
            handlers.onValue?.(newValue);
    };

    const onKeyDown = (event) =>
    {
        if (! handlers.onStep)
            return;

        const steps = {
            ArrowUp: 1, ArrowRight: 1,
            ArrowDown: -1, ArrowLeft: -1,
        };
        const direction = steps[event.key];

        if (direction === undefined)
            return;

        event.preventDefault();
        const newValue = handlers.onStep(direction);

        if (newValue !== undefined)
            handlers.onValue?.(newValue);
    };

    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', endDrag);
    element.addEventListener('pointercancel', endDrag);
    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('keydown', onKeyDown);

    return function detach ()
    {
        element.removeEventListener('pointerdown', onPointerDown);
        element.removeEventListener('pointermove', onPointerMove);
        element.removeEventListener('pointerup', endDrag);
        element.removeEventListener('pointercancel', endDrag);
        element.removeEventListener('wheel', onWheel);
        element.removeEventListener('keydown', onKeyDown);
    };
}

/**
 * Clamp a number into [min, max]. Shared by the whole family so bounds behave
 * identically everywhere.
 *
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp (value, min, max)
{
    return Math.min(max, Math.max(min, value));
}
