/**
 * ABD IndexControl — the base of the controls whose value is an INDEX.
 *
 * Select y Segmented son el mismo control con distinto mueble: una lista de
 * entradas, el valor es el indice de la activa, un veto por entrada o por
 * especificacion, y un `setDisabled()` que recalcula en caliente cuando otro
 * parametro manda. Eso estaba escrito dos veces, igual, y las dos copias se
 * pueden quedar viejas por separado — que es como se desincroniza una familia
 * de controles: no porque nadie decidiera que dejaran de ser gemelos, sino
 * porque el que se toco el ultimo no se entero.
 *
 * Aqui vive lo que NO es el mueble: la construccion comun, las notas, el valor,
 * la divergencia y la limpieza. Alli se queda lo que los hace distintos: el
 * <select> nativo con su nota en el campo, y la radiogroup con su recorrido de
 * flechas y su tabindex rotatorio.
 *
 * LO QUE ESTA CLASE NO HACE, Y POR QUE
 *
 * No lee el vocabulario de opciones (`options.label`, `options.value`...): se lo
 * dan YA resuelto, en piezas, y la referencia entera. El vocabulario es del
 * control —lo ofrece el que se construye, y lo documente quien lo ofrece—, y
 * la auditoria de documentacion lee cada fichero por separado: una clave de
 * opciones que la base leyera al control a prometerla sin usarla. Por eso el
 * constructor recibe `entries`, `disabledSpec`, `value` y `skin` sueltos.
 *
 * Delega lo que no sabe: `buildDom`, `attachInteraction` y `render` son del
 * control, y lo mismo el `prepareEntries` que resuelve lo suyo antes de
 * construir. El veto si es de la base —es la misma regla para los dos, y escrita
 * dos veces se desincroniza—, y el recorrido de flechas lo recibe como predicado
 * para no tener que saber por que algo esta vetado.
 *
 * No inventa el mueble ni lo construye: `buildDom`, `attachInteraction` y
 * `render` los define cada control, y el constructor los llama en ese orden.
 *
 * @see optionIndex.js — la matematica del indice, sin DOM de control.
 * @see components/drag-core.js — el nucleo DRY del gesto continuo, el otro medio
 *   de la familia (el que se arrastra).
 */

import { applySkin, CONTROL_KIND } from './skins/index.js';
import { clampIndex, createNotes } from './optionIndex.js';

export class IndexControl
{
    /**
     * @param {HTMLElement|string} container
     * @param {object} partes  lo que la base necesita, ya resuelto por el control.
     * @param {string} [partes.name] el nombre del control en el error, a pelo.
     * @param {string} [partes.kind] el tipo de skin que le corresponde.
     * @param {Array} [partes.entries] las entradas ya normalizadas, en orden.
     * @param {Array<number|Function>} [partes.disabledSpec] vetos: indices, o predicado.
     * @param {number} [partes.value] el indice inicial, ya recortado al dominio.
     * @param {string} [partes.skin] el nombre de la skin, o null si no se quiere.
     * @param {object} [partes.options] la referencia entera de las opciones.
     */
    constructor (container, { name, kind, entries, disabledSpec, value, skin, options })
    {
        this.container = typeof container === 'string'
            ? document.querySelector(container)
            : container;

        if (this.container == null)
            throw new Error(`ABD ${name}: container not found`);

        this.options = options;
        this.entries = entries;
        this.disabledSpec = disabledSpec;
        this.value = value;
        this.listeners = [];
        this[CONTROL_KIND] = kind;

        // El control puede tocar sus entradas AUN sin DOM (un glyph que viene en
        // un array aparte, un variant que decide como se pintan los botones), y
        // tiene que hacerlo antes de construir: despues ya es tarde.
        this.prepareEntries();

        this.buildDom();
        this.attachInteraction();

        if (skin != null)
            this.skin = applySkin(skin, this.wrapper, this);

        this.render();
    }

    /**
     * @brief Ajusta sus entradas ANTES de que exista el DOM. No hace nada por
     *   defecto: lo implementa el control que tenga algo que resolver antes de
     *   construir.
     */
    prepareEntries () {}

    /**
     * @brief El nodo oculto que explica un veto de ESTE control, y su cableado.
     *
     * El wrapper tiene que existir ya, y el `target` es como el control encuentra
     * la entrada de un indice: un <option> en el Select, el boton del segmento
     * en el Segmented. El Select ademas cuelga la nota del CAMPO —un <option>
     * nunca toma el foco— y esa parte es suya.
     *
     * @param {string} prefix  'abd-select' o 'abd-segmented'.
     * @param {function(number): (HTMLElement|null)} target  la entrada de un indice.
     * @returns {object} el cableado, tal cual lo devuelve `createNotes` de
     *   optionIndex.js —la forma la promete ese, que es quien la construye.
     */
    createNotes (prefix, target)
    {
        return createNotes({ wrapper: this.wrapper, prefix, target });
    }

    /**
     * @brief El <label> o <span> del titulo, y el enganche a un id del llamante.
     *
     * El id del control es del llamante (para que un <label for> o un script del
     * host lo encuentre); lo unico que la base inventa son los nodos de plumbing
     * de las notas, y esos los nombra optionIndex.js. Sin id no hay <label for>:
     * un <label> sin `for` no nombra nada, y el control lo dice con `aria-label`.
     *
     * El texto y el id LLEGAN como valores, no como `this.options.label`: la base
     * no lee el vocabulario de opciones (ver la cabecera), asi que el control es
     * el unico que lo documenta y el unico que lo ofrece.
     *
     * @param {string} prefix  'abd-select' o 'abd-segmented'.
     * @param {string} label  el texto del titulo; vacio es no hay titulo.
     * @param {string|null} id  el id que dio el llamante, o null.
     * @returns {HTMLElement|null} el elemento del titulo, o null si no hay titulo.
     */
    createLabel (prefix, label, id)
    {
        this.labelEl = null;

        if (! label)
            return null;

        this.labelEl = document.createElement(id ? 'label' : 'span');
        this.labelEl.className = `${prefix}__label`;
        this.labelEl.textContent = label;

        if (id)
            this.labelEl.htmlFor = id;

        this.wrapper.appendChild(this.labelEl);
        this.wrapper.classList.add(`${prefix}--labelled`);

        return this.labelEl;
    }

    /** @brief Anota un listener para poder soltarlo entero en destroy(). */
    listen (element, event, handler)
    {
        element.addEventListener(event, handler);
        this.listeners.push([element, event, handler]);
    }

    /** @brief Is this index unavailable under its flag or the disabled spec? */
    isIndexDisabled (index)
    {
        const entry = this.entries[index];

        if (entry == null)
            return true;

        // El flag de la PROPIA entrada veta por si mismo: el motivo suele estar ahi
        // al lado (`note`) y obligar a repetir el indice en la lista era una trampa
        // silenciosa. Manda el flag: ningun spec permisivo lo levanta.
        if (entry.disabled)
            return true;

        if (typeof this.disabledSpec === 'function')
            return Boolean(this.disabledSpec(entry, index));

        return (this.disabledSpec ?? []).includes(index);
    }

    /**
     * @brief Current value sits on an entry the UI cannot offer (host state).
     * The value is deliberately KEPT: see the class note on disabled entries.
     * @returns {boolean} si el valor esta en una entrada que la UI no puede ofrecer.
     */
    isDivergent ()
    {
        return this.isIndexDisabled(this.value);
    }

    /**
     * @brief Recompute availability (e.g. another parameter changed).
     * @param {Array<number|Function>} spec  vetos: indices, o (entry, index) => boolean.
     */
    setDisabled (spec)
    {
        this.disabledSpec = spec ?? [];
        this.render();
    }

    /**
     * @brief Cambia EN CALIENTE el motivo del veto de una entrada.
     *
     * Un veto puede depender de otro parametro ("requiere el motor Neurotik"), asi
     * que el PORQUE tambien es dinamico: setDisabled dice QUE esta vetado y setNote
     * explica POR QUE. Texto nuevo estrena la nota si aun no habia; texto vacio la
     * retira con su descripcion. Un indice desconocido se ignora.
     *
     * @param {number} index  posicion de la entrada (0..n-1); una desconocida se ignora.
     * @param {string} text  motivo nuevo; vacio retira la nota.
     */
    setNote (index, text)
    {
        const entry = this.entries[index];

        if (entry == null)
            return;

        entry.note = String(text ?? '');
        this.notes.wire(index, entry.note);
    }

    /** @brief Motivos del veto, en orden (diagnostico y tests). */
    getNotes ()
    {
        return this.entries.map((entry) => entry.note);
    }

    /**
     * @brief Programmatic update: does NOT fire onChange (user picks do).
     * @param {number} index  indice de la entrada activa; clampIndex recorta al dominio.
     */
    setValue (index)
    {
        this.value = this.clampIndex(index);
        this.render();
    }

    /** @returns {number} el indice de la entrada activa. */
    getValue ()
    {
        return this.value;
    }

    /** @returns {Array<string>} las etiquetas de las entradas, en orden. */
    getLabels ()
    {
        return this.entries.map((entry) => entry.label);
    }

    clampIndex (index)
    {
        return clampIndex(this.entries.length, index);
    }

    destroy ()
    {
        for (const [element, event, handler] of this.listeners)
            element.removeEventListener(event, handler);

        this.listeners.length = 0;
        this.skin?.destroy();
        this.wrapper.remove();
    }
}
