/**
 * EnvelopeCurve — la geometria de la curva ADSR y la VISTA de fabrica.
 * ============================================================================
 * La matematica es PURA (puntos y `d` de los paths, sin DOM) y la vista es el
 * modo sin gesto del EnvelopePad: pinta desde los valores REALES de sus cuatro
 * controles y expone la aguja de nivel. El mapeo normalizado→real llega por
 * `toReal`, porque el skew es del contrato del host, no de este paquete.
 *
 * Dos decisiones que no son obvias:
 *
 *   - **Los tiempos se comprimen con raiz**: el rango real va de 1 ms a 5 s en
 *     los hosts tipicos. En escala lineal un ataque de 1 ms seria un trazo de
 *     medio pixel; la raiz mantiene legibles los dos extremos sin mentir sobre
 *     el orden;
 *   - **el tramo de sostenido tiene ancho propio** (no es un tiempo): sin el,
 *     un sustain sin ataque ni release pareceria una meseta de ancho cero.
 *
 * Value model: `envelopePoints` toma tiempos en la unidad del llamador y
 * sostenido 0..1. La compresion es de RATIOS, asi que da igual si vienen de
 * segundos reales (vista) o de valores normalizados (control).
 *
 * Usage:
 *   const curve = createEnvelopeCurve({ controls, prefix: 'env' });
 *   host.append(curve.element);
 */

/** Orden de los tramos: sufijo de id (`envAttack`/...) y clave del valor. */
export const ENVELOPE_SEGMENTS = ['attack', 'decay', 'sustain', 'release'];

/** Geometria del viewBox. El CSS estira el SVG a su contenedor. */
export const ENVELOPE_VIEWBOX = { width: 100, height: 48 };

/** Valor inicial del pad (los defaults de fabrica de la ficha de origen). */
export const DEFAULT_ENVELOPE = { attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.1 };

const PAD = 2;                  // margen en px del viewBox, para que el trazo no se corte
const SUSTAIN_SHARE = 0.18;     // ancho del tramo de sostenido, en fraccion del total
const MIN_SEGMENT_SHARE = 0.05; // ninguna rampa se queda en nada (1 ms tiene que verse)

const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Puntos de la curva, en coordenadas del viewBox (y crece hacia ABAJO, como el SVG).
 *
 * values lleva los cuatro tramos: attack/decay/release en la unidad del
 * llamador y sustain 0..1. Devuelve cinco puntos: start, pico, fin de decay,
 * fin de sostenido y fin de release, cada uno `{ x, y }`.
 *
 * @param {object} values  los cuatro tramos (ver arriba).
 * @param {object} [viewbox]  geometria del dibujo. Default ENVELOPE_VIEWBOX.
 */
export function envelopePoints (values, viewbox = ENVELOPE_VIEWBOX)
{
    const width = viewbox.width;
    const height = viewbox.height;
    const top = PAD;
    const bottom = height - PAD;
    const y = (level) => bottom - Math.min(1, Math.max(0, level)) * (bottom - top);

    const attack = Math.max(0, Number(values.attack) || 0);
    const decay = Math.max(0, Number(values.decay) || 0);
    const release = Math.max(0, Number(values.release) || 0);
    const sustain = Math.min(1, Math.max(0, Number(values.sustain) || 0));

    // Raiz normalizada: el mayor de los tres tiempos ocupa (1 - sostenido) del ancho.
    const longest = Math.max(attack, decay, release, 1e-6);
    const rampSpace = width * (1 - SUSTAIN_SHARE);
    const shareOf = (seconds) => Math.max(MIN_SEGMENT_SHARE, Math.sqrt(seconds / longest)) * rampSpace;

    const shares = [attack, decay, release].map(shareOf);
    const total = shares[0] + shares[1] + shares[2];
    const scale = total > rampSpace ? rampSpace / total : 1;   // nunca desborda el viewBox

    const xAttack = shares[0] * scale;
    const xDecay = xAttack + shares[1] * scale;
    const xSustain = xDecay + width * SUSTAIN_SHARE;
    const xRelease = xSustain + shares[2] * scale;

    return [
        { x: 0, y: y(0) },
        { x: xAttack, y: y(1) },
        { x: xDecay, y: y(sustain) },
        { x: xSustain, y: y(sustain) },
        { x: xRelease, y: y(0) },
    ];
}

/** `d` del trazo, con dos decimales (un `d` estable no repinta por ruido de float). */
export function envelopeLinePath (points)
{
    const at = (point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`;

    return `M${at(points[0])} ` + points.slice(1).map((point) => `L${at(point)}`).join(' ');
}

/** `d` del area rellena bajo la curva (cierra por la base del viewBox). */
export function envelopeAreaPath (points, viewbox = ENVELOPE_VIEWBOX)
{
    const base = (viewbox.height - PAD).toFixed(2);

    return `${envelopeLinePath(points)} L${points[points.length - 1].x.toFixed(2)},${base} L0.00,${base} Z`;
}

/** Suelo de silencio de la aguja: por debajo, `data-visible` va a false. */
export const NEEDLE_FLOOR = 0.004;

/**
 * `d` de la AGUJA de nivel: una linea horizontal a la altura del valor que la
 * envolvente esta sacando AHORA (0..1). Por debajo de `NEEDLE_FLOOR` hay
 * silencio y la aguja se esconde (`data-visible`).
 *
 * @param {number} level  nivel 0..1 (fuera de rango se clava)
 * @param {object} [viewbox]  geometria del dibujo. Default ENVELOPE_VIEWBOX.
 * @returns {string} el `d` del path
 */
export function envelopeNeedlePath (level, viewbox = ENVELOPE_VIEWBOX)
{
    const bottom = viewbox.height - PAD;
    const clamped = Math.min(1, Math.max(0, Number(level) || 0));
    const y = bottom - clamped * (bottom - PAD);

    return `M0,${y.toFixed(2)} L${viewbox.width},${y.toFixed(2)}`;
}

/**
 * El mueble del dibujo: un stage con el SVG de la curva (area, trazo y
 * aguja), listo para montar asas encima. Lo usa el pad y cualquiera que
 * quiera la misma anatomia sin repetir el DOM.
 *
 * @param {object} options
 *   - aria  etiqueta accesible del SVG.
 *   - viewbox  geometria del dibujo. Default ENVELOPE_VIEWBOX.
 * @returns {object}  el mueble: stage (el contenedor), svg, area, line y
 *   needle (los tres paths del dibujo).
 *
 * Usage:
 *   const mueble = createEnvelopeStage({ aria: 'ENV 1' });
 *   host.append(mueble.stage);
 */
export function createEnvelopeStage ({ aria, viewbox = ENVELOPE_VIEWBOX })
{
    const stage = document.createElement('div');
    stage.className = 'abd-envpad__stage';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${viewbox.width} ${viewbox.height}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', aria);

    const area = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    area.setAttribute('class', 'abd-envpad__area');

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.setAttribute('class', 'abd-envpad__line');

    const needle = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    needle.setAttribute('class', 'abd-envpad__needle');
    needle.dataset.visible = 'false';

    svg.append(area, line, needle);
    stage.appendChild(svg);

    return { stage, svg, area, line, needle };
}

/**
 * La VISTA de la curva ADSR, tal como la consume un panel. Sin gestos: es el
 * modo `editable: false` del EnvelopePad, con caption.
 *
 * @param {object} options
 *   - controls  view-models del contrato: los cuatro controles del prefijo.
 *   - toReal  (control, normalizado) => valor real. Default identidad.
 *   - prefix  sufijo de id de los cuatro controles. Default 'env'.
 *   - dataset  valor de data-visual. Default 'amp-envelope'.
 *   - label  etiqueta bajo el dibujo. Default 'AMP ENV'.
 *   - title  tooltip de la vista. Default 'Envelope curve'.
 *   - aria  etiqueta accesible del SVG. Default 'ADSR envelope curve'.
 *   - viewbox  geometria del dibujo. Default ENVELOPE_VIEWBOX.
 *   - captionClass  clase del caption. Default 'abd-envpad__caption'.
 * @returns {object}  la vista: element (lista para montar), paint(parameters),
 *   setLevel(level), parameterIds y destroy().
 *
 * Usage:
 *   const curve = createEnvelopeCurve({ controls, prefix: 'env' });
 *   host.append(curve.element);
 */
export function createEnvelopeCurve ({
    controls,
    toReal = (control, normalized) => normalized,
    prefix = 'env',
    dataset = 'amp-envelope',
    label = 'AMP ENV',
    title = 'Envelope curve',
    aria = 'ADSR envelope curve',
    viewbox = ENVELOPE_VIEWBOX,
    captionClass = 'abd-envpad__caption',
})
{
    /** Los cuatro tramos por nombre (`attack` -> control de `envAttack`). */
    const bySegment = ENVELOPE_SEGMENTS.map((segment) => ({
        segment,
        control: controls.find((control) => control.id === `${prefix}${cap(segment)}`),
    }));

    // OJO: NO lleva la clase de celda de parametro del host — es una VISTA y
    // no ocupa celda de parametro. La identidad visual la pone `dataset`.
    const element = document.createElement('div');
    element.className = 'abd-envpad abd-envpad--view';
    element.dataset.visual = dataset;
    element.title = title;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${viewbox.width} ${viewbox.height}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', aria);

    const area = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    area.setAttribute('class', 'abd-envpad__area');

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.setAttribute('class', 'abd-envpad__line');

    // Aguja de nivel (telemetria en vivo): oculta hasta que llega el primer
    // frame con nivel por encima del suelo.
    const needle = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    needle.setAttribute('class', 'abd-envpad__needle');
    needle.dataset.visible = 'false';

    svg.append(area, line, needle);
    element.append(svg);

    // El caption SIEMPRE, tambien vacio: un span sin texto mide cero pero el
    // gap del flex-column no, y quitarlo cambiaria la altura del dibujo
    // (medido en la ficha del cajon de NEURONiK: 2 px de mas de curva).
    const caption = document.createElement('span');
    caption.className = captionClass;
    caption.textContent = label;
    element.append(caption);

    /** Nivel actual de la envolvente (0..1, del frame de telemetria). */
    function setLevel (level)
    {
        const value = typeof level === 'number' && Number.isFinite(level) ? level : 0;

        if (value <= NEEDLE_FLOOR)
        {
            needle.dataset.visible = 'false';
            return;
        }

        needle.dataset.visible = 'true';
        needle.setAttribute('d', envelopeNeedlePath(value, viewbox));
    }

    /** Repinta desde los valores NORMALIZADOS del snapshot del store. */
    function paint (parameters = {})
    {
        const values = {};

        for (const { segment, control } of bySegment)
            values[segment] = control
                ? toReal(control, parameters[control.id] ?? 0)
                : 0;

        const points = envelopePoints(values, viewbox);

        line.setAttribute('d', envelopeLinePath(points));
        area.setAttribute('d', envelopeAreaPath(points, viewbox));
    }

    paint();   // estado inicial: los defaults del contrato

    return {
        element,
        paint,
        setLevel,
        parameterIds: bySegment.filter(({ control }) => control).map(({ control }) => control.id),
        destroy ()
        {
            element.textContent = '';
        },
    };
}
