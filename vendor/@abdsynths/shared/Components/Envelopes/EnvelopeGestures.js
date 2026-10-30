/**
 * EnvelopeGestures — la matematica del gesto de las asas y su cableado.
 * ============================================================================
 * Generica a proposito: aqui no se lee ninguna opcion ni se sabe que clase la
 * usa. El pad (envelopePad.js) le pasa lectores y escritores y esto resuelve
 * el QUE: que valor sale del gesto, como se pinta el asa activa.
 *
 * El gesto es ABSOLUTO por asa, como el XYPad de la familia (excepcion
 * documentada de la regla drag-core): el asa sigue al puntero, no hay lane de
 * arrastre. La X mapea por la INVERSA de la raiz que dibuja (lo que ves es lo
 * que coges) y la Y del asa central es lineal. El mapeo se captura AL EMPEZAR
 * el gesto — su `k` queda fijo durante todo el arrastre: el ancho del tramo
 * cambia con el valor, y re-derivarlo en cada movimiento haria que el asa
 * acelera sobre si misma.
 *
 * Usage:
 *   const detach = attachEnvelopeHandle(handle, 'attack', handlers);
 *   detach();   // destroy() del control
 */

import { ENVELOPE_VIEWBOX } from './envelopeCurve.js';

const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

/** El asa de cada tramo de rampa y el punto de la curva donde vive. */
export const ENVELOPE_HANDLES = [
    { segment: 'attack', point: 1 },
    { segment: 'decay', point: 2 },
    { segment: 'release', point: 4 },
];

/** Nombre accesible de cada asa (ingles, como el resto de la familia). */
export const HANDLE_NAMES = {
    attack: 'Attack',
    decay: 'Decay / Sustain',
    release: 'Release',
};

/**
 * El estado del gesto para UN asa, capturado en el pointerdown. `k` es la
 * pendiente de la inversa de la raiz: la constante con la que los pixeles del
 * gesto se convierten en tramos de raiz. `yFactor` es lo mismo para el eje de
 * nivel, que si es lineal.
 *
 * @param {object} args
 *   - segmentValue  valor del tramo al empezar (0..1).
 *   - sustainValue  sustain al empezar (para el asa central).
 *   - segmentPx  ancho del tramo en px de viewBox.
 *   - pxPerUnit  px reales por unidad de viewBox.
 *   - stageHeight  alto del stage en px reales.
 *   - minShare  el MIN_SEGMENT_SHARE del dibujo (suelo de la raiz).
 * @returns {object} el estado del gesto (lo consumen dragSegment/dragSustain)
 */
export function captureGesture ({ segmentValue, sustainValue, segmentPx, pxPerUnit, stageHeight, minShare })
{
    const s0 = Math.sqrt(Math.max(0, segmentValue));

    return {
        s0,
        sus0: sustainValue,
        k: (segmentPx * pxPerUnit) / Math.max(s0, Math.sqrt(minShare)),
        // El eje de nivel ocupa el viewBox menos su margen (2 px arriba y
        // abajo), escalado a los px reales del stage.
        yFactor: ((ENVELOPE_VIEWBOX.height - 4) / ENVELOPE_VIEWBOX.height) * stageHeight,
    };
}

/**
 * El valor del tramo (0..1) tras mover el asa: el pixel delta del gesto, por
 * la constante capturada, de vuelta de raiz a valor.
 *
 * @param {object} drag  lo que devolvio captureGesture
 * @param {number} deltaX  desplazamiento horizontal del puntero, en px reales
 * @returns {number} el valor del tramo, 0..1
 */
export function dragSegment (drag, deltaX)
{
    const s = clamp01(drag.s0 + deltaX / drag.k);

    return s * s;
}

/**
 * El SUSTAIN tras mover el asa central en vertical (lineal). `pxUp` es el
 * recorrido del puntero hacia ARRIBA, ya invertido por el llamador
 * (`startY - clientY`): subir el puntero sube el nivel.
 *
 * @param {object} drag  lo que devolvio captureGesture
 * @param {number} pxUp  px de recorrido hacia arriba, en px reales
 * @returns {number} el sustain, 0..1
 */
export function dragSustain (drag, pxUp)
{
    return clamp01(drag.sus0 + pxUp / drag.yFactor);
}

/**
 * Cablear UN asa: drag absoluto + resaltado de la asa activa + teclado. Los
 * lectores (`dragState`, `valueOf`, `pointsOf`, `rectOf`) van por callbacks
 * para que esto no lea ninguna opcion del control que lo usa. Teclado: flecha
 * = un paso (el asa central lleva arriba/abajo al SUSTAIN), Shift x10,
 * PageUp/PageDown x10, Home/End al tope.
 *
 * @param {HTMLElement} handle  el elemento asa (role=slider, tabindex=0)
 * @param {string} segment  el tramo que arrastra: 'attack', 'decay' o 'release'
 * @param {object} handlers
 *   - dragState  getter/setter del estado del gesto: sin argumento devuelve el
 *     vivo (null = gesto cerrado); con argumento, lo guarda.
 *   - valueOf  (segment) => valor actual 0..1.
 *   - pointsOf  () => los cinco puntos vivos de la curva (envelopePoints).
 *   - rectOf  () => el rect del stage (getBoundingClientRect).
 *   - minShare  el suelo de la raiz del dibujo (MIN_SEGMENT_SHARE), number.
 *   - step  el paso del teclado, number.
 *   - onAssign  (segment, value) => escribir el valor como EDICION de usuario.
 *   - onStart / onEnd  gesto abierto/cerrado, para el host.
 * @returns {function(): void} detach — quita todos los listeners.
 */
export function attachEnvelopeHandle (handle, segment, handlers)
{
    let dragging = false;

    const index = ENVELOPE_HANDLES.findIndex((h) => h.segment === segment);
    const point = ENVELOPE_HANDLES[index].point;

    const onPointerDown = (event) =>
    {
        event.preventDefault();
        try { handle.setPointerCapture(event.pointerId); } catch { /* jsdom */ }
        handle.focus({ preventScroll: true });

        const rect = handlers.rectOf();
        const pts = handlers.pointsOf();
        const segWidth = Math.max(1, pts[point].x - pts[point - 1].x);
        const pxPerUnit = rect.width > 0 ? rect.width / ENVELOPE_VIEWBOX.width : 1;

        handlers.dragState({
            ...captureGesture({
                segmentValue: handlers.valueOf(segment),
                sustainValue: handlers.valueOf('sustain'),
                segmentPx: segWidth,
                pxPerUnit,
                stageHeight: rect.height > 0 ? rect.height : 1,
                minShare: handlers.minShare,
            }),
            startX: event.clientX,
            startY: event.clientY,
        });

        dragging = true;
        handle.classList.add('abd-envpad__handle--active');
        handlers.onStart?.();
    };

    const onPointerMove = (event) =>
    {
        const drag = handlers.dragState();

        if (!dragging || !drag) return;

        // El asa central es la esquina del Mz950: X lleva el DECAY y Y el
        // SUSTAIN, los dos a la vez. Las otras, solo su tramo en X.
        if (segment === 'decay')
            handlers.onAssign('sustain', dragSustain(drag, drag.startY - event.clientY));

        handlers.onAssign(segment, dragSegment(drag, event.clientX - drag.startX));
    };

    const endDrag = () =>
    {
        if (!dragging) return;

        dragging = false;
        handlers.dragState(null);
        handle.classList.remove('abd-envpad__handle--active');
        handlers.onEnd?.();
    };

    const onKeyDown = (event) =>
    {
        const step = handlers.step;
        // Shift = x10, como promete la cabecera del control (PageUp/Down tambien).
        const big = event.shiftKey ? step * 10 : step;

        const bump = (key, delta) =>
        {
            handlers.onAssign(key, handlers.valueOf(key) + delta);
            event.preventDefault();
        };

        switch (event.key)
        {
            case 'ArrowRight': bump(segment, big); break;
            case 'ArrowLeft': bump(segment, -big); break;
            // En el asa central, arriba/abajo llevan el SUSTAIN.
            case 'ArrowUp': bump(segment === 'decay' ? 'sustain' : segment, big); break;
            case 'ArrowDown': bump(segment === 'decay' ? 'sustain' : segment, -big); break;
            case 'PageUp': bump(segment, step * 10); break;
            case 'PageDown': bump(segment, -step * 10); break;
            case 'Home': bump(segment, -handlers.valueOf(segment)); break;
            case 'End': bump(segment, 1 - handlers.valueOf(segment)); break;
            default: break;
        }
    };

    handle.addEventListener('pointerdown', onPointerDown);
    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
    handle.addEventListener('keydown', onKeyDown);

    return function detach ()
    {
        handle.removeEventListener('pointerdown', onPointerDown);
        handle.removeEventListener('pointermove', onPointerMove);
        handle.removeEventListener('pointerup', endDrag);
        handle.removeEventListener('pointercancel', endDrag);
        handle.removeEventListener('keydown', onKeyDown);
    };
}
