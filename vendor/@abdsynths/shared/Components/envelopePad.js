/**
 * EnvelopePad — el CONTROL de la curva ADSR (las tres asas arrastrables).
 * ============================================================================
 * El gesto del editor de envolventes del Mz950 reimplementado desde cero (el
 * original es AGPLv3): misma idea — tres asas, hit-test generoso, asa activa
 * resaltada — sin una linea de su codigo. La geometria vive en
 * envelopeCurve.js y el gesto en envelopeGestures.js; aqui solo queda el
 * mueble y el contrato de la familia (wheel.js, knob.js, xypad.js): mismo
 * constructor/setValue/getValue/destroy, onChange solo en ediciones de
 * usuario, theming solo por custom properties. Dos modos: VISTA
 * (`editable: false`, lo que hoy consume el lienzo y el cajon de NEURONiK) y
 * CONTROL (default), que anade las TRES ASAS: el pico arrastra el ATTACK (X),
 * la esquina del decay arrastra DECAY (X) y SUSTAIN (Y) a la vez, y la ultima
 * arrastra el RELEASE (X).
 *
 * Value model: `{ attack, decay, sustain, release }` NORMALIZADO 0..1 POR
 * SEGMENTO (regla 1 de la familia); el mapeo a segundos es del LLAMADOR. La
 * curva se dibuja con la MISMA compresion raiz venga de tiempos reales (la
 * vista de fabrica) o de normalizados (aqui): es de ratios, no de unidades.
 *
 * Usage:
 *   const pad = new EnvelopePad(el, { label: 'ENV 1' });
 *   pad.setValue({ attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.1 });
 *   pad.setLevel(0.8);       // aguja de telemetria en vivo
 *   pad.destroy();
 */

import {
    DEFAULT_ENVELOPE,
    ENVELOPE_SEGMENTS,
    ENVELOPE_VIEWBOX,
    NEEDLE_FLOOR,
    createEnvelopeStage,
    envelopeAreaPath,
    envelopeLinePath,
    envelopeNeedlePath,
    envelopePoints,
} from './envelopeCurve.js';
import { ENVELOPE_HANDLES, HANDLE_NAMES, attachEnvelopeHandle } from './envelopeGestures.js';

const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

/**
 * El control (ver la cabecera del fichero para el contrato y el value model).
 */
export class EnvelopePad
{
    /**
     * @param {HTMLElement|string} container
     * @param {object} [options]
     *   - value  valor inicial `{ attack, decay, sustain, release }` 0..1; los
     *     segmentos que falten toman DEFAULT_ENVELOPE. Default DEFAULT_ENVELOPE.
     *   - label  texto encima del dibujo (y nombre accesible de iota). Default ''.
     *   - ariaLabel  nombre accesible, en lugar del label. Default null.
     *   - editable  monta las tres asas arrastrables; `false` es la VISTA pura:
     *     pinta y aguja, cero gestos. Default true.
     *   - showValues  lectura "A · D · S · R" bajo el dibujo. Default true.
     *   - step  paso del teclado. Default 0.01.
     *   - format  (valor 0..1) => texto, para el aria y la lectura. Default
     *     dos decimales.
     *   - onChange  (valor) => void, SOLO en ediciones de usuario. Default null.
     *   - onDragStart / onDragEnd  gesto abierto/cerrado, para el host. Default null.
     */
    constructor (container, options = {})
    {
        this.container = typeof container === 'string'
            ? document.querySelector(container)
            : container;

        if (this.container == null)
            throw new Error('ABD EnvelopePad: container not found');

        this.options = {
            value: DEFAULT_ENVELOPE,
            label: '',
            ariaLabel: null,
            editable: true,
            showValues: true,
            step: 0.01,
            format: (v) => (Number.isFinite(v) ? v : 0).toFixed(2),
            onChange: null,
            onDragStart: null,
            onDragEnd: null,
            ...options,
        };

        const initial = this.options.value ?? DEFAULT_ENVELOPE;

        // Los segmentos que faltan toman el default: un valor parcial del host
        // no aplana los tramos que no menciono.
        this.value = {
            attack: clamp01(initial.attack ?? DEFAULT_ENVELOPE.attack),
            decay: clamp01(initial.decay ?? DEFAULT_ENVELOPE.decay),
            sustain: clamp01(initial.sustain ?? DEFAULT_ENVELOPE.sustain),
            release: clamp01(initial.release ?? DEFAULT_ENVELOPE.release),
        };

        this._destroyed = false;
        this._drag = null;          // estado del gesto en curso (envelopeGestures)
        this._detaches = [];

        this.buildDom();
        this.render();
    }

    buildDom ()
    {
        this.wrapper = document.createElement('div');
        this.wrapper.className = 'abd-envpad';

        if (this.options.label)
        {
            this.labelEl = document.createElement('span');
            this.labelEl.className = 'abd-envpad__label';
            this.labelEl.textContent = this.options.label;
            this.wrapper.appendChild(this.labelEl);
        }

        const { stage, area, line, needle } = createEnvelopeStage({
            aria: this.options.ariaLabel ?? this.options.label ?? '',
        });

        this.stage = stage;
        this.areaEl = area;
        this.lineEl = line;
        this.needleEl = needle;
        this.handles = [];

        if (this.options.editable)
            this.buildHandles();

        if (this.options.showValues)
        {
            this.readout = document.createElement('span');
            this.readout.className = 'abd-envpad__values';
            this.stage.appendChild(this.readout);
        }

        this.wrapper.appendChild(this.stage);
        this.container.appendChild(this.wrapper);
    }

    /** Las tres asas: role=slider enfocable cada una, aria de valor por asa. */
    buildHandles ()
    {
        this.wrapper.classList.add('abd-envpad--editable');

        for (const { segment, point } of ENVELOPE_HANDLES)
        {
            const handle = document.createElement('div');
            handle.className = 'abd-envpad__handle';
            handle.dataset.segment = segment;
            handle.setAttribute('role', 'slider');
            handle.setAttribute('tabindex', '0');

            const name = this.options.ariaLabel ?? this.options.label;
            handle.setAttribute('aria-label', name
                ? `${name} — ${HANDLE_NAMES[segment]}`
                : HANDLE_NAMES[segment]);
            handle.setAttribute('aria-valuemin', '0');
            handle.setAttribute('aria-valuemax', '1');

            this._detaches.push(attachEnvelopeHandle(handle, segment, {
                dragState: (next) => (next === undefined ? this._drag : (this._drag = next)),
                valueOf: (key) => this.value[key],
                pointsOf: () => envelopePoints(this.value, ENVELOPE_VIEWBOX),
                rectOf: () => this.stage.getBoundingClientRect(),
                minShare: 0.05,
                step: this.options.step,
                onAssign: (key, value) => this._assign(key, value),
                onStart: () => this.options.onDragStart?.(),
                onEnd: () => this.options.onDragEnd?.(),
            }));

            this.stage.appendChild(handle);
            this.handles.push({ segment, point, element: handle });
        }
    }

    /**
     * Asigna UN segmento (edicion de usuario): repinta y avisa solo si el
     * valor cambia de verdad — empujar contra el borde no es una transicion.
     */
    _assign (segment, next)
    {
        const v = clamp01(next);

        if (v === this.value[segment]) return;

        this.value = { ...this.value, [segment]: v };
        this.render();
        this.options.onChange?.(this.getValue());
    }

    /**
     * Actualizacion programatica, SILENCIOSA por defecto (snapshots del
     * bridge): con `notify` avisa una vez, y solo si algo cambio de verdad.
     * Los campos que faltan conservan su valor.
     *
     * @param {{attack?: number, decay?: number, sustain?: number, release?: number}} value
     * @param {boolean} [notify]
     */
    setValue (value, notify = false)
    {
        if (this._destroyed) return;

        const v = value ?? {};
        const next = {
            attack: clamp01(v.attack ?? this.value.attack),
            decay: clamp01(v.decay ?? this.value.decay),
            sustain: clamp01(v.sustain ?? this.value.sustain),
            release: clamp01(v.release ?? this.value.release),
        };

        const changed = ENVELOPE_SEGMENTS.some((segment) => next[segment] !== this.value[segment]);

        this.value = next;
        this.render();

        if (notify && changed) this.options.onChange?.(this.getValue());
    }

    /** @returns {object} copia del valor, `{ attack, decay, sustain, release }` 0..1. */
    getValue () { return { ...this.value }; }

    /**
     * Aguja de nivel en vivo (telemetria del motor), 0..1. Pintura, no estado:
     * bajo `NEEDLE_FLOOR` la aguja se esconde. Vale en ambos modos.
     *
     * @param {number} level
     */
    setLevel (level)
    {
        if (this._destroyed) return;

        const value = typeof level === 'number' && Number.isFinite(level) ? level : 0;

        if (value <= NEEDLE_FLOOR)
        {
            this.needleEl.dataset.visible = 'false';
            return;
        }

        this.needleEl.dataset.visible = 'true';
        this.needleEl.setAttribute('d', envelopeNeedlePath(value, ENVELOPE_VIEWBOX));
    }

    render ()
    {
        if (this._destroyed) return;

        const pts = envelopePoints(this.value, ENVELOPE_VIEWBOX);
        const format = this.options.format;

        this.lineEl.setAttribute('d', envelopeLinePath(pts));
        this.areaEl.setAttribute('d', envelopeAreaPath(pts, ENVELOPE_VIEWBOX));

        for (const { segment, point, element } of this.handles)
        {
            const p = pts[point];

            element.style.left = `${(p.x / ENVELOPE_VIEWBOX.width) * 100}%`;
            element.style.top = `${(p.y / ENVELOPE_VIEWBOX.height) * 100}%`;
            element.setAttribute('aria-valuenow', `${this.value[segment]}`);

            // El asa central arrastra DOS valores: el valuetext los nombra a los dos.
            element.setAttribute('aria-valuetext', segment === 'decay'
                ? `Decay ${format(this.value.decay)}, Sustain ${format(this.value.sustain)}`
                : format(this.value[segment]));
        }

        if (this.readout)
            this.readout.textContent = `A ${format(this.value.attack)} · D ${format(this.value.decay)}`
                + ` · S ${format(this.value.sustain)} · R ${format(this.value.release)}`;
    }

    destroy ()
    {
        if (this._destroyed) return;

        this._destroyed = true;

        for (const detach of this._detaches) detach();
        this._detaches = [];
        this.wrapper.remove();
    }
}
