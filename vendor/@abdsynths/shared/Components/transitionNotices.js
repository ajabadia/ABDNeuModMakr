/**
 * ABD avisos de TRANSICION — contrato compartido de la familia.
 *
 * Un control AVISA de sus TRANSICIONES, no de sus INTENCIONES: el callback de un
 * cambio de estado se dispara UNA vez por cambio REAL de valor, y nunca cuando la
 * peticion deja el valor donde estaba. Abrir un cajon ya abierto (`drawer.js`),
 * elegir el segmento que ya estaba activo, o empujar una flecha contra el borde
 * del pad son peticiones SIN transicion: no avisan. Para saber si la peticion
 * cambio algo esta el valor (`isOpen()`, `getValue()`), no el callback.
 *
 * El cajon lo estreno al formalizar que `destroy()` no es un cierre; aqui vive la
 * regla para que Toggle (boolean), Segmented (indice) y XYPad ({x, y}) no repitan
 * cada uno su idea de "cambio", y para que un control nuevo la herede en vez de
 * decidirla por su cuenta. La igualdad del valor ES parte del contrato, no del
 * mobiliario: el `{x, y}` del pad entrega copias nuevas en cada `setValue`, asi que
 * un `===` diria que TODO es una transicion; por eso se compara aqui.
 *
 * Uso en un control (el aviso, no el trabajo):
 *
 *     const previous = this.value;
 *     this.value = next;
 *     this.render();
 *     announceTransition(notify, previous, next);   // notify = el callback del host
 */

/**
 * Igualdad de valor de control: primitivos (boolean, indice) y puntos con forma
 * `{x, y}`. Dos objetos son el mismo valor si tienen las mismas claves con los
 * mismos valores; con distinto juego de claves, no.
 */
export function sameControlValue (a, b)
{
    if (a === b)
        return true;

    if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object')
        return false;

    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    return keysA.length === keysB.length
        && keysA.every((key) => a[key] === b[key]);
}

/**
 * `true` si `next` es una transicion real desde `previous` (el valor cambio). Es
 * la pregunta que un control con estado se hace antes de anunciar algo: sin
 * transicion no hay nada que avisar.
 */
export function transitioned (previous, next)
{
    return ! sameControlValue(previous, next);
}

/**
 * Emite `notify(next)` SOLO si hay transicion. Devuelve si la hubo (para no
 * repetir el calculo) y tolera que no haya callback: el aviso es del llamador, no
 * del control. El valor que viaja es `next` —el estado ya nuevo—.
 *
 * @param {Function|null} [notify]  callback del host (`onChange`).
 * @param {*} previous  valor antes de la peticion.
 * @param {*} next      valor despues de la peticion.
 * @returns {boolean} true si hubo transicion (y aviso quien escuchaba).
 */
export function announceTransition (notify, previous, next)
{
    if (! transitioned(previous, next))
        return false;

    if (typeof notify === 'function')
        notify(next);

    return true;
}
