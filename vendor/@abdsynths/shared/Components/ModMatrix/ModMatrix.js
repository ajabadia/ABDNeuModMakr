/**
 * ABD ModMatrix — the shared modulation matrix view for the ABDSynths suite.
 * =============================================================================
 * One component, three synths. It takes a route list and a source/destination
 * table and paints the matrix; it knows NOTHING about any particular synth's
 * vocabulary, because the ids arrive as plain indices (see
 * `contracts/modulation_matrix.schema.json` and `abd::synth::ModMatrixT`).
 *
 * WHAT IT FUSES (and why neither original was enough)
 * ----------------------------------------------------
 * From ABDEep's view: the FLOW (a bezier from source to destination whose
 * thickness is the depth and whose hue is its sign), the category colours, and
 * **compact** — shifting the live routes to the front so the empty ones sink.
 * A 32-slot matrix with six routes in it is mostly empty rows, and compacting
 * is what makes it readable.
 *
 * From ABDNeural's view: the live SIGNED CONTRIBUTION per destination, and the
 * "click a row to open the editor of that slot" gesture. Those two are what
 * turn the matrix from a list into something you read at a glance.
 *
 * Family rules (see knob.js, xypad.js, drawer.js):
 *   - constructor(container, options), paint(data), setLive(data), destroy();
 *   - framework-agnostic: DOM in, callbacks out. No bridge, no engine, no state;
 *   - themed ONLY through CSS custom properties from styles/tokens.css;
 *   - keyboard: the list is real buttons; the flow lines are aria-hidden and the
 *     same information is in the rows, so nothing depends on seeing them.
 *
 * IT IS NOT A CONTROL
 * -------------------
 * The matrix has no parameter of its own: it is a VIEW of the route slots. So it
 * never writes a value. It reports gestures (`onSelectSlot`, `onCompact`) and
 * the host decides what they mean — that is what lets the same component live in
 * ABDEep's modal and in NEURONiK's drawer.
 *
 * Value model
 * -----------
 * A route is `{ source, destination, amount }` with INDICES, and `amount` in the
 * destination's own units (bipolar is the host's business: the DeepMind sends
 * -1..+1, the shared contract normalises for display). `setLive` takes
 * `{ [destinationIndex]: contribution }` in the same units, for the signed bar.
 *
 * Usage:
 *   const matrix = new ModMatrix(el, {
 *     contract,                 // the parsed modulation_matrix JSON
 *     onSelectSlot: (i) => openDrawer(i),
 *     onCompact: () => compactRoutes(),
 *   });
 *   matrix.paint(routes);                        // [{source, destination, amount}]
 *   matrix.setLive({ 10: -0.4 });                // the engine's live contribution
 *
 * @param {HTMLElement|string} container  where the matrix is mounted.
 * @param {object} [options]              see the constructor for the full list.
 * @returns {ModMatrix} the view, for paint()/setLive()/destroy().
 */


/** Rows of the list, and lanes of the flow. Kept small: the list is the truth. */
const MIN_FLOW_LANES = 4;
const MAX_FLOW_LANES = 12;

/** Below this the depth line is too thin to read as anything. */
const MIN_LINE_WIDTH = 1;

/**
 * The category → token mapping. Every colour comes from a token, never a
 * literal: a synth that wants its own palette overrides the token, not this file.
 */
const CATEGORY_TOKEN = {
    none: 'var(--text-dim, #888)',
    lfo: 'var(--accent-teal, #4ecdc4)',
    envelope: 'var(--accent-green, #6abf69)',
    performance: 'var(--color-gold, #d4a843)',
    pedal: 'var(--accent-blue, #5b9bd5)',
    voice: 'var(--accent-pink, #e68a8a)',
    other: 'var(--accent-blue, #5b9bd5)',
};

const categoryToken = (category) => CATEGORY_TOKEN[category] ?? CATEGORY_TOKEN.other;

export class ModMatrix {
    /**
     * @param {HTMLElement|string} container
     * @param {object} options
     * @param {object} options.contract          parsed modulation_matrix contract
     * @param {number} [options.visibleSlots]    rows shown at once, default 8
     * @param {Function} [options.onSelectSlot]  (slotIndex) => void
     * @param {Function} [options.onCompact]     () => void
     * @param {Function} [options.onAnnounce]    (mensaje) => void — aviso de
     *                                           gesto ya cerrado. La matriz no
     *                                           tiene gesto continuo (no es un
     *                                           control), asi que no usa los
     *                                           notices de arrastre: solo
     *                                           necesita poder decir "hecho".
     * @param {boolean} [options.compact]        show the compact button, default
     *                                           true when there are more slots
     *                                           than fit.
     */
    constructor(container, options = {}) {
        this.container = typeof container === 'string'
            ? document.querySelector(container)
            : container;

        this.contract = options.contract ?? { slots: 8, sources: [], destinations: [] };
        this.sources = this.contract.sources ?? [];
        this.destinations = this.contract.destinations ?? [];
        this.slotCount = this.contract.slots ?? 8;
        this.visibleSlots = options.visibleSlots ?? Math.min(this.slotCount, 8);
        this.onSelectSlot = options.onSelectSlot ?? null;
        this.onCompact = options.onCompact ?? null;
        this.onAnnounce = options.onAnnounce ?? null;
        this.showCompact = options.compact ?? this.slotCount > this.visibleSlots;

        this.routes = [];
        this.live = new Map();
        this.rowElements = [];

        if (!this.container) {
            throw new Error('ModMatrix: el contenedor no existe');
        }

        this.#build();
    }

    // ── Estructura ──────────────────────────────────────────────────────────

    #build() {
        const root = document.createElement('div');
        root.className = 'mod-matrix';

        // Cabecera: cuántas rutas hay vivas, sobre cuántas caben.
        const header = document.createElement('div');
        header.className = 'mod-matrix__header';

        this.countElement = document.createElement('span');
        this.countElement.className = 'mod-matrix__count';
        header.appendChild(this.countElement);

        if (this.showCompact && this.onCompact) {
            this.compactButton = document.createElement('button');
            this.compactButton.type = 'button';
            this.compactButton.className = 'mod-matrix__compact';
            this.compactButton.textContent = 'Compactar';
            this.compactButton.title =
                'Mueve las rutas vivas al principio y deja vacías al final';
            this.compactButton.addEventListener('click', () => {
                this.onCompact?.();
                this.onAnnounce?.('Rutas compactadas');
            });
            header.appendChild(this.compactButton);
        }

        root.appendChild(header);

        // La lista: la forma accesible, la que se puede tabular y leer.
        this.listElement = document.createElement('div');
        this.listElement.className = 'mod-matrix__list';
        this.listElement.setAttribute('role', 'list');
        root.appendChild(this.listElement);

        // El grafo: la misma información dibujada. aria-hidden porque duplica
        // lo que la lista ya dice, y una línea no se puede tabular.
        this.flowElement = document.createElement('div');
        this.flowElement.className = 'mod-matrix__flow';
        this.flowElement.setAttribute('aria-hidden', 'true');
        root.appendChild(this.flowElement);

        this.container.replaceChildren(root);
        this.rootElement = root;
        this.#buildRows();
    }

    #buildRows() {
        this.rowElements = [];

        for (let slot = 1; slot <= this.visibleSlots; slot++) {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'mod-matrix__row';
            row.dataset.slot = String(slot);
            row.setAttribute('role', 'listitem');
            row.addEventListener('click', () => this.onSelectSlot?.(slot));

            const badge = document.createElement('span');
            badge.className = 'mod-matrix__slot';
            badge.textContent = String(slot);
            row.appendChild(badge);

            const source = document.createElement('span');
            source.className = 'mod-matrix__source';
            row.appendChild(source);

            const arrow = document.createElement('span');
            arrow.className = 'mod-matrix__arrow';
            arrow.textContent = '→';
            row.appendChild(arrow);

            const destination = document.createElement('span');
            destination.className = 'mod-matrix__destination';
            row.appendChild(destination);

            const amount = document.createElement('span');
            amount.className = 'mod-matrix__amount';
            row.appendChild(amount);

            // La contribución con signo del motor, en vivo. Es lo que convierte
            // la lista en algo legible de un vistazo: no dice lo que pediste,
            // dice lo que está pasando.
            const bar = document.createElement('span');
            bar.className = 'mod-matrix__live';
            bar.dataset.side = 'none';
            row.appendChild(bar);

            this.listElement.appendChild(row);
            this.rowElements.push({ row, source, destination, amount, bar });
        }
    }

    // ── Datos ───────────────────────────────────────────────────────────────

    /**
     * Pinta las rutas.
     *
     * Un slot es "vivo" si su fuente no es la inerte y su cantidad no es 0: es
     * la MISMA regla que el motor (`ModMatrixT::isInert` y el descarte de
     * amount 0), para que lo que la vista llama activa sea lo que suena.
     *
     * @param {Array<{source: number, destination: number, amount: number}>} [routes]
     *        las rutas, en orden, con ÍNDICES. Compactar, en el host, es
     *        reordenar este array antes de llamar aquí.
     * @returns {void}
     */
    paint(routes = []) {
        // Las rutas llegan EN ORDEN: la fila i es la ruta i. Compactar, en el
        // host, es reordenar este array antes de llamar aqui.
        this.routes = Array.isArray(routes) ? routes.slice(0, this.visibleSlots) : [];

        this.#paintRows();
        this.#paintFlow();
        this.#paintCount();
    }

    /**
     * La contribución VIVA que el motor acumula por destino.
     *
     * Viene de la telemetría, así que llega a ~15 Hz y por eso no repinta la
     * lista: solo las barras. Un destino ausente o a cero deja la barra neutra.
     *
     * @param {Object<number, number>} [contributions]
     *        contribución por ÍNDICE de destino, en las unidades de la ruta y
     *        con su signo: `{ 10: -0.4, 1: 0.2 }`.
     * @returns {void}
     */
    setLive(contributions = {}) {
        this.live = contributions && typeof contributions === 'object'
            ? new Map(Object.entries(contributions).map(([k, v]) => [Number(k), Number(v)]))
            : new Map();

        for (const { row, bar } of this.rowElements) {
            const destination = Number(row.dataset.destination ?? -1);
            const value = destination >= 0 ? this.live.get(destination) : undefined;
            this.#paintLiveBar(bar, value);
        }
    }

    #paintRows() {
        this.rowElements.forEach((elements, index) => {
            const { row, source, destination, amount } = elements;
            const route = this.routes[index];

            if (!route) {
                row.dataset.live = 'false';
                row.dataset.sourceCategory = 'none';
                source.textContent = '—';
                destination.textContent = 'Libre';
                amount.textContent = '';
                delete row.dataset.destination;
                return;
            }

            const sourceEntry = this.sources[route.source];
            const destinationEntry = this.destinations[route.destination];
            const isLive = this.#isRouteLive(route);

            row.dataset.live = String(isLive);
            row.dataset.sourceCategory = sourceEntry?.category ?? 'other';
            row.dataset.destination = String(route.destination);

            source.textContent = sourceEntry?.label ?? `Fuente ${route.source}`;
            destination.textContent = destinationEntry?.label ?? `Destino ${route.destination}`;

            // La cantidad se muestra en las unidades del destino, con su signo:
            // el signo es la información (una ruta invertida suena al revés).
            const magnitude = Math.abs(route.amount);
            amount.textContent = (route.amount < 0 ? '−' : '') + formatAmount(magnitude);
            amount.dataset.sign = route.amount < 0 ? 'negative' : 'positive';

            // Una ruta que el motor no puede hacer (implemented: false) se
            // marca: la tabla lo dice, y la vista no finge que vaya a sonar.
            row.dataset.implemented = String(destinationEntry?.implemented !== false);
            row.title = row.title || describeRoute(sourceEntry, destinationEntry, route);
        });
    }

    #paintFlow() {
        const lanes = Math.min(Math.max(this.routes.length, MIN_FLOW_LANES), MAX_FLOW_LANES);
        this.flowElement.style.setProperty('--mod-matrix-lanes', String(lanes));

        // El grafo se dibuja con el MISMO dato que la lista: no tiene estado
        // propio, así que no puede quedarse desfasado respecto a ella.
        const items = this.routes.map((route) => {
            const sourceEntry = this.sources[route.source];
            const destinationEntry = this.destinations[route.destination];
            const live = this.#isRouteLive(route);

            const source = document.createElement('span');
            source.className = 'mod-matrix__flow-source';
            source.textContent = sourceEntry?.label ?? '?';
            source.style.setProperty('--mod-matrix-tint', categoryToken(sourceEntry?.category));

            const line = document.createElement('span');
            line.className = 'mod-matrix__flow-line';
            const depth = Math.min(1, Math.abs(route.amount));
            line.style.setProperty(
                '--mod-matrix-thickness',
                String(MIN_LINE_WIDTH + depth * 4),
            );
            line.dataset.sign = route.amount < 0 ? 'negative' : 'positive';
            line.dataset.live = String(live);

            const destination = document.createElement('span');
            destination.className = 'mod-matrix__flow-destination';
            destination.textContent = destinationEntry?.label ?? '?';
            destination.style.setProperty(
                '--mod-matrix-tint',
                categoryToken(destinationEntry?.category),
            );

            return { source, line, destination };
        });

        this.flowElement.replaceChildren(
            ...items.flatMap((item) => [item.source, item.line, item.destination]),
        );
    }

    #paintCount() {
        const live = this.routes.filter((route) => this.#isRouteLive(route)).length;
        this.countElement.textContent = `${live} / ${this.slotCount} rutas`;
    }

    #paintLiveBar(bar, value) {
        if (value === undefined || !Number.isFinite(value) || value === 0) {
            bar.dataset.side = 'none';
            bar.style.setProperty('--mod-matrix-live', '0');
            return;
        }
        bar.dataset.side = value < 0 ? 'negative' : 'positive';
        bar.style.setProperty('--mod-matrix-live', String(Math.min(1, Math.abs(value))));
    }

    /**
     * ¿La ruta cuenta? La MISMA regla que el motor: fuente inerte o cantidad
     * cero = no cuenta. Si la vista y el motor no coinciden aquí, la matriz
     * miente sobre lo que suena.
     */
    #isRouteLive(route) {
        const sourceInert = this.sources[route.source]?.category === 'none';
        const destinationInert = this.destinations[route.destination]?.parameterId === null
            && this.destinations[route.destination]?.label === 'Off';

        return !sourceInert && !destinationInert && route.amount !== 0;
    }

    // ── Ciclo de vida ───────────────────────────────────────────────────────

    destroy() {
        this.container?.replaceChildren();
        this.rowElements = [];
        this.routes = [];
        this.live = new Map();
    }
}

/** La cantidad, con las unidades de la tabla si las hay. */
function formatAmount(value) {
    if (!Number.isFinite(value)) return '0';
    if (value === 0) return '0';
    // Tres decimales es lo que distingue 0.001 de 0 en una ruta fina, y nada mas.
    return value < 0.01 ? value.toFixed(3) : value.toFixed(2);
}

function describeRoute(source, destination, route) {
    const from = source?.label ?? `Fuente ${route.source}`;
    const to = destination?.label ?? `Destino ${route.destination}`;
    const sign = route.amount < 0 ? '−' : '+';
    return `${from} → ${to}  ${sign}${formatAmount(Math.abs(route.amount))}`;
}

export default ModMatrix;
