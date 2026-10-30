/**
 * ABD vocabulary of a control whose value is an INDEX — the layer Select and
 * Segmented share, and the reason they no longer llevan cada una su copia.
 *
 * Los dos son el mismo control con distinto mueble: una lista de entradas, un
 * valor que es el indice de la activa, un veto por entrada o por especificacion,
 * y un motivo que hay que ANUNCIAR. Eso ultimo es lo caro: el motivo no puede
 * ser un `title` (es de raton, y para quien no puede ver un <option> no llega a
 * nadie), asi que viaja como DESCRIPCION accesible de la entrada, y para eso hace
 * falta un nodo oculto por motivo y un cableado que sobreviva a que el motivo
 * cambie en caliente. Ese cableado estaba escrito dos veces, igual, con el
 * prefijo de clase cambiado — y dos copias de una cosa delicate son dos sitios
 * donde se puede quedar vieja una.
 *
 * LO QUE ESTA AQUI Y LO QUE NO
 *
 * Aqui esta el MATEMATICA Y EL DOM COMPARTIDO: quien esta vetado, cual es el
 * siguiente indice disponible, el recorte del valor, y el nodo de nota con su
 * `aria-describedby`. No esta el DOM de cada control —el <select> nativo y su
 * nota en el campo, la radiogroup y su recorrido con flechas—, que es justo lo
 * que los hace distintos y lo que se queda en su fichero.
 *
 * Las ENTRADAS las normaliza cada control en su fichero (`normalizeEntry`), y no
 * aqui a proposito: la forma de una entrada es parte de la regla de la auditoria
 * que lee `select.js` y `segmented.js` por su nombre, y moverla dejaria esa
 * regla mirando un sitio donde ya no esta. Lo que se comparte es lo que las dos
 * hacen con la entrada, no la entrada.
 */

/** Cuantos nodos de nota se han creado. Uno solo para los dos controles, y no
 *  uno por fichero: los ids de `aria-describedby` tienen que ser unicos en la
 *  pagina, y dos contadores que empiezan en uno los hacen duplicar en cuanto una
 *  pagina lleva los dos controles. */
let noteSequence = 0;

/**
 * @brief Recorta el indice pedido al dominio de las entradas.
 *
 * @param {number} count  cuantas entradas hay; sin entradas el valor es 0.
 * @param {number} index  el indice pedido, que se redondea (un 1.4 de un host que
 *   normaliza a 0..1 es la entrada 1) y se recorta por los dos extremos.
 * @returns {number} el indice que de verdad existe.
 */
export function clampIndex (count, index)
{
    if (count === 0)
        return 0;

    const n = Math.round(Number(index));

    return Math.min(count - 1, Math.max(0, Number.isFinite(n) ? n : 0));
}

/** El paso que pide una tecla de flecha: +1 a la derecha y abajo, -1 a la
 *  izquierda y arriba, y 0 para todo lo demas (la tecla no es del recorrido). */
export function arrowStepFor (key)
{
    if (key === 'ArrowRight' || key === 'ArrowDown')
        return 1;

    if (key === 'ArrowLeft' || key === 'ArrowUp')
        return -1;

    return 0;
}

/**
 * @brief El siguiente indice DISPONIBLE desde `from`, dando `step` vueltas.
 *
 * El recorrido de flechas de una radiogroup es circular y salta los vetados: si
 * se topa con uno, sigue; si esta todo vetado, se queda donde estaba. El bucle
 * esta acotado por el numero de entradas, asi que no puede dar vueltas sin fin
 * cuando no hay ninguna disponible.
 *
 * POR QUE RECIBE EL PREDICADO Y NO LAS ENTRADAS: quien decide que esta vetado es
 * el control —su `isIndexDisabled`, que lee su propia entrada y aplica su
 * propio spec—, y el recorrido solo necesita preguntarselo. Asi la regla del
 * veto vive en el fichero del control, que es donde la puede leer, y aqui no se
 * reimplementa una segunda vez para que las dos seseparen.
 *
 * @param {function(number): boolean} isDisabled  pregunta por un indice.
 * @param {number} count  cuantas entradas hay, que acota las vueltas.
 * @param {number} from  el indice desde el que se mira.
 * @param {number} step  +1 o -1.
 * @returns {number} el indice alcanzado, que puede ser vetado si no hay ninguno libre.
 */
export function nextEnabledIndex (isDisabled, count, from, step)
{
    if (count === 0)
        return 0;

    let next = from;

    for (let hops = 0; hops < count; hops += 1)
    {
        next = (next + step + count) % count;

        if (! isDisabled(next))
            break;
    }

    return next;
}

/**
 * @brief El nodo oculto que explica un veto, y el `aria-describedby` que lo cuelga.
 *
 * Una sola via de entrada al DOM para el motivo: la construccion (estado inicial)
 * y `setNote` (cambio en caliente) llaman a `wire` y no a otra cosa. El nodo vive
 * FUERA de la entrada a la que describe, a proposito: uno dentro se traga en su
 * NOMBRE accesible y la entrada se lee como "Neurotik Requiere el motor
 * Neurotik". Y el contenedor se retira en cuanto se queda sin notas, para no
 * dejar un <div> vacio en el DOM.
 *
 * @param {object} opciones
 *   wrapper  el contenedor donde se cuelga el <div> de notas.
 *   prefix   'abd-select' o 'abd-segmented': de ahi salen las clases y el id.
 *   target   (indice) => el elemento al que se cablea la descripcion, o null.
 * @returns {{wire: function(number, string): void}}
 */
export function createNotes ({ wrapper, prefix, target })
{
    let container = null;
    const nodes = [];       // un nodo por indice con motivo (o null)

    const ensureContainer = () =>
    {
        if (container == null)
        {
            container = document.createElement('div');
            container.className = `${prefix}__notes`;
        }

        if (container.parentNode !== wrapper)
            wrapper.appendChild(container);

        return container;
    };

    return {
        /**
         * @brief Crea, actualiza o retira la nota de un indice, y la cablea.
         * @param {number} index  posicion de la entrada; una desconocida se ignora.
         * @param {string} text  el motivo; vacio retira la nota con su descripcion.
         */
        wire (index, text)
        {
            const element = target(index);

            if (element == null)
                return;

            if (! text)
            {
                // Sin motivo no queda descripcion: ni atributo ni nodo vacio.
                element.removeAttribute('aria-describedby');
                nodes[index]?.remove();
                nodes[index] = null;

                if (container != null && container.childElementCount === 0)
                {
                    container.remove();
                    container = null;
                }

                return;
            }

            let node = nodes[index];

            if (node == null)
            {
                node = document.createElement('span');
                node.className = `${prefix}__note`;
                node.id = `${prefix}-note-${noteSequence += 1}`;
                nodes[index] = node;
                ensureContainer().appendChild(node);

                // The note stops being a mouse-only tooltip: it becomes the entry's
                // accessible description, so whoever announces the vetoed entry also
                // announces WHY it is vetoed.
                element.setAttribute('aria-describedby', node.id);
            }

            node.textContent = text;
        },
    };
}
