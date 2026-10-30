/**
 * ABD avisos CONTINUOS — contrato hermano de transitionNotices para controles continuos.
 *
 * Los controles continuos (Knob, Slider, Wheel y el arrastre del XYPad) tienen DOS
 * avisos distintos durante un gesto, y no son el mismo:
 *
 * - MOVIMIENTO (`onChange` vivo): por cada paso DENTRO del gesto que cambia el
 *   valor (por frame, por notch, por pixel). Avisa por transicion real, paso a paso.
 *   Si el paso deja el valor donde estaba (clamp al borde, valor ya en el extremo),
 *   no avisa. Es el aviso vivo, para pintar y para que el host siga el gesto.
 * - ASENTAMIENTO (`onSettled`): UNA vez AL CERRAR el gesto, y solo si el
 *   valor final difiere del que habia AL ABRIRLO. Un gesto que no se movio (arrastrar
 *   contra el borde, click sin desplazar, soltar la rueda de pitch sin haberla movido)
 *   no asienta nada, aunque haya habido eventos de puntero. Es el aviso para undo,
 *   automatizacion y persistencia — el que agrupa el gesto en un solo paso.
 *
 * La igualdad del valor es la MISMA que en transitionNotices.js (sameControlValue):
 * cubre el `number` 0..1 de Knob/Slider/Wheel y el `{x, y}` del XYPad (que entrega
 * copias nuevas por cada setValue, asi que `===` diria que todo es transicion).
 * El seguimiento del gesto vive aqui para que ningun control reinvente su idea de
 * "cuando empieza y cuando asienta".
 *
 * Uso en un control continuo:
 *
 *   import { createContinuousNotices } from './continuousNotices.js';
 *
 *   this.notices = createContinuousNotices({
 *     onMovement: (v) => handleMovement(v),
 *     onSettled:  (v) => handleSettled(v),
 *   });
 *
 *   // al abrir gesto (pointerdown / drag start)
 *   this.notices.begin(this.value);
 *
 *   // por cada paso dentro del gesto
 *   const prev = this.value;
 *   this.value = next;
 *   this.render();
 *   this.notices.announceMovement(prev, next);
 *
 *   // al cerrar gesto (pointerup / drag end)
 *   this.notices.end(this.value);
 *
 * Rueda y teclado son movimientos sin gesto con asentamiento inmediato: cada paso
 * ya es su propio asentamiento, pero sigue la misma regla de transicion (empujar
 * contra el borde no asienta). El helper no los distingue: si no hay `begin`,
 * `announceMovement` sigue avisando por paso y `end` no hace nada.
 */

import { announceTransition, sameControlValue } from './transitionNotices.js';

export { sameControlValue };

/**
 * Aviso por movimiento: un paso dentro del gesto. Es la misma transicion que
 * announceTransition, con nombre de continuo.
 * @param {Function|null} [notify] callback del host por movimiento.
 * @param {*} previous valor antes del paso.
 * @param {*} next valor despues del paso.
 * @returns {boolean} true si hubo transicion y se aviso.
 */
export function announceMovement (notify, previous, next)
{
    return announceTransition(notify, previous, next);
}

/**
 * Aviso de asentamiento: el cierre del gesto compara el inicio con el final.
 * Tambien es una transicion, pero de gesto.
 * @param {Function|null} [notify] callback del host por asentamiento.
 * @param {*} gestureStart valor al abrir el gesto.
 * @param {*} gestureEnd valor al cerrar el gesto.
 * @returns {boolean} true si hubo asentamiento y se aviso.
 */
export function announceSettled (notify, gestureStart, gestureEnd)
{
    return announceTransition(notify, gestureStart, gestureEnd);
}

/**
 * Seguimiento de un gesto continuo: recuerda donde empezo y avisa al asentar.
 *
 * @param {object} [options] objeto de callbacks del gesto.
 * @param {Function|null} [options.onMovement]  (valor) => void — aviso por paso.
 * @param {Function|null} [options.onSettled]   (valor) => void — aviso al cerrar.
 * @returns {{ begin: function(*):boolean, announceMovement: function(*,*):boolean, end: function(*):boolean, isActive: function():boolean, getStart: function():* }}
 */
export function createContinuousNotices ({ onMovement, onSettled } = {})
{
    let active = false;
    let startValue = null;

    function clone (v)
    {
        if (v == null || typeof v !== 'object')
            return v;

        const copy = {};

        for (const k of Object.keys(v))
            copy[k] = v[k];

        return copy;
    }

    return {
        /**
         * Abre el gesto recordando el valor inicial. No re-abre si ya esta activo.
         * @param {*} value valor al inicio del gesto.
         * @returns {boolean} true si se abrio.
         */
        begin (value)
        {
            if (active)
                return false;

            active = true;
            startValue = clone(value);
            return true;
        },

        /**
         * Emite aviso por movimiento si el paso es una transicion real.
         * @param {*} previous valor antes del paso.
         * @param {*} next valor despues del paso.
         * @returns {boolean} true si hubo transicion y se aviso.
         */
        announceMovement (previous, next)
        {
            return announceTransition(onMovement, previous, next);
        },

        /**
         * Cierra el gesto y emite aviso de asentamiento si el final difiere del inicio.
         * Un gesto que no se movio no asienta. No hace nada si no habia gesto.
         * @param {*} finalValue valor al cerrar el gesto.
         * @returns {boolean} true si hubo asentamiento y se aviso.
         */
        end (finalValue)
        {
            if (! active)
                return false;

            const start = startValue;

            active = false;
            startValue = null;

            return announceTransition(onSettled, start, finalValue);
        },

        /** @returns {boolean} true mientras el gesto esta abierto. */
        isActive () { return active; },

        /** @returns {*} copia del valor inicial del gesto, o null si no hay gesto. */
        getStart () { return clone(startValue); },
    };
}
