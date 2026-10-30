/**
 * Control skins — how a control LOOKS, decoupled from how it BEHAVES.
 *
 * A synth picks a skin per control (or per page) without touching the control
 * logic: the Knob/Slider/Toggle classes own value + interaction + contract; a
 * skin owns DOM structure and CSS class names.
 *
 * A skin is a map of renderers, one per control type it supports:
 *
 *     { knob(host, control), slider(host, control), toggle(host, control) }
 *
 *   host      element the skin paints into (inside the control wrapper);
 *   control   the control instance (options, value... read-only here);
 *   return    { root, update, destroy }: root is removed by the control's
 *             destroy(); update() re-reads control.getValue() and repaints;
 *             destroy() frees anything the skin added beyond `root`.
 *
 * applySkin() dispatches by the control's kind (tagged via CONTROL_KIND), so a
 * synth states the skin once — `skin: 'junio'` — and each control type resolves
 * its own renderer. When a skin lacks a renderer for a kind, the 'vector' one
 * is used as fallback so partial skins stay usable.
 *
 * Built-ins:
 *   'vector'  default. Pure CSS/SVG (knob arc+pointer, fill+thumb, CSS LED,
 *             native <select>).
 *   'ms2000'  Korg-flavoured vector knob (rim/cap/dot) + token toggle variant.
 *   'junio'   Roland Juno-flavoured photo sprites (knob.png, slider cap/slot,
 *             button PNGs) from assets/junio/.
 *
 * A project registers its own skin with registerSkin('name', mapOfRenderers).
 */

const registry = new Map();

/** @brief Tag a control instance with its kind ('knob' | 'slider' | 'toggle' | 'select' | 'segmented'). */
export const CONTROL_KIND = Symbol('abd.control.kind');

/** @brief Register a skin under a name. Overwriting is allowed on purpose. */
export function registerSkin (name, renderers)
{
    registry.set(name, renderers);
}

/** @brief Get a skin renderer map, or null when unknown (caller falls back). */
export function getSkin (name)
{
    return registry.get(name) ?? null;
}

/** @brief Names registered, for diagnostics and tests. */
export function skinNames () { return [...registry.keys()]; }

/**
 * @brief Apply a skin by name to a control, dispatching by its kind.
 * Falls back to the skin's own 'vector' renderer for kinds the skin omits,
 * and to the 'vector' skin entirely when the name is unknown.
 */
export function applySkin (name, host, control)
{
    const kind = control?.[CONTROL_KIND] ?? 'knob';
    const map = registry.get(name) ?? registry.get('vector');

    if (map == null)
        throw new Error('ABD skins: no skin registered (registry empty)');

    const fn = typeof map[kind] === 'function'
        ? map[kind]
        : registry.get('vector')[kind];   // partial skins fall back per-kind

    // A kind with no renderer anywhere (a new control nobody painted) used to
    // fail as "fn is not a function", which reads as a typo in the caller.
    if (typeof fn !== 'function')
        throw new Error(`ABD skins: no renderer for control kind '${kind}'`);

    return fn(host, control);
}

/* ── vector (default) ──────────────────────────────────────────────────────── */

registerSkin('vector', {
    knob (host, control)
    {
        const root = document.createElement('div');
        root.className = 'abd-skin abd-skin--vector';

        const size = control.options?.size ?? 64;
        const sweep = 270;
        const start = -135;   // classic knob sweep: -135..+135 degrees
        // El cero de un mando bipolar es el CENTRO del recorrido, y el arco se
        // llena desde ahi. El puntero NO cambia de sitio: bipolar es como se
        // PINTA el relleno, no donde esta el mando.
        const bipolar = control.options?.bipolar === true;
        const origin = bipolar ? 0.5 : 0;

        root.innerHTML = `
            <svg class="abd-knob__svg" viewBox="0 0 50 50" width="${size}" height="${size}"
                 aria-hidden="true">
                <circle class="abd-knob__track" cx="25" cy="25" r="20.5"></circle>
                <circle class="abd-knob__arc" cx="25" cy="25" r="20.5"></circle>
                <circle class="abd-knob__mod-halo" cx="25" cy="25" r="20.5"></circle>
                <circle class="abd-knob__mod-ring" cx="25" cy="25" r="20.5"></circle>
                ${bipolar ? '<circle class="abd-knob__rest" cx="25" cy="10" r="1.3"></circle>' : ''}
                <line class="abd-knob__pointer" x1="25" y1="25" x2="25" y2="12"></line>
            </svg>`;

        const arc = root.querySelector('.abd-knob__arc');
        const pointer = root.querySelector('.abd-knob__pointer');
        const modHalo = root.querySelector('.abd-knob__mod-halo');
        const modRing = root.querySelector('.abd-knob__mod-ring');
        const circumference = 2 * Math.PI * 20.5;

        /*
         * LA VENTANA DE 270 GRADOS, en CSS y no en el atributo `transform`.
         *
         * Estaba como atributo (`transform="rotate(135 25 25)"`) y ademas se
         * ponia `style.transformOrigin` en el mismo elemento. Poner CUALQUIER
         * propiedad CSS de transform sobre un elemento SVG hace que la propiedad
         * `transform` CSS mande sobre el atributo, asi que el atributo se
         * ignoraba: el arco de valor se dibujaba en su sitio pero girado, y de
         * hecho medido en el navegador no pintaba nada (0 pixeles). Ahora la
         * rotacion va por CSS, con su origen, como el puntero.
         */
        for (const el of [arc, modHalo, modRing])
        {
            // El circulo de SVG arranca en las tres en punto y avanza en sentido
            // horario, asi que la ventana de 270 grados tiene que GIRARSE 135
            // grados para empezar a las siete y media y dejar el hueco de 90
            // ABAJO, que es donde el ojo ya sabe que no hay mando. Es el mismo
            // 135 que llevaba antes el atributo, con el signo cambiado porque
            // ahora la rotacion se aplica en el CSS.
            el.style.transform = `rotate(${-start}deg)`;
            el.style.transformOrigin = '25px 25px';
        }

        host.appendChild(root);

        return {
            root,
            update ()
            {
                const v = typeof control.getValue === 'function' ? control.getValue() : 0;
                /*
                 * EL RELLENO, y por que las dos lineas van juntas.
                 *
                 * El arco se pinta con UN trazo cuyo largo es lo encendido y
                 * cuyo angulo de arranque es el origen: el `dasharray` lleva la
                 * LONGITUD y el `dashoffset` lleva el ARRANQUE (en negativo, que
                 * es lo que desplaza el trazo hacia delante).
                 *
                 * Antes el `dasharray` era fijo (los 270 grados de la ventana) y
                 * solo se movia el `dashoffset`, y eso NO puede acortar un
                 * trazo: solo lo desplaza. Medido en el navegador, el arco salia
                 * de 0 grados con el valor a 0.25, de 50 con 0.5 y de 180 con
                 * 1 (en vez de 0 / 67.5 / 135 / 202.5 / 270), y con valores
                 * bajos la luz caia en el hueco de abajo, que es justo donde no
                 * hay mando. El puntero siempre estuvo bien: lo que estaba mal
                 * era el relleno.
                 *
                 * En unipolar el origen es el extremo izquierdo; en bipolar, el
                 * CENTRE, y entonces el mismo tramo se dibuja hacia los dos
                 * lados segun la senal.
                 */
                const from = Math.min(v, origin) * sweep;
                const len = Math.abs(v - origin) * sweep;

                // Un trazo de largo cero con `stroke-linecap: round` NO es
                // invisible: el navegador pinta el remate, un punto. En unipolar
                // cae en el inicio del recorrido y en bipolar EN EL CENTRO, justo
                // donde esta la marca del cero, y ahi un punto se lee como un
                // valor. Sin relleno, sin arco.
                arc.style.display = len < 1.0e-6 ? 'none' : '';
                arc.style.strokeDasharray = `${(len / 360) * circumference} ${circumference}`;
                arc.style.strokeDashoffset = `${-(from / 360) * circumference}`;
                pointer.style.transform = `rotate(${start + v * sweep}deg)`;
                pointer.style.transformOrigin = '25px 25px';

                // Modulation ring: from the VALUE's angle to the MODULATED one,
                // signed (a bidirectional LFO sweeps backwards). Same arc the
                // native LookAndFeel strokes; halo first, ring on top.
                const mod = typeof control.getModulation === 'function'
                    ? control.getModulation() : 0;
                const modFrom = v * sweep;
                const to = Math.min(1, Math.max(-1, mod)) * sweep;

                if (Math.abs(to) < 1.0e-3)
                {
                    modHalo.style.display = 'none';
                    modRing.style.display = 'none';
                }
                else
                {
                    const begin = Math.min(modFrom, modFrom + to);
                    const span = Math.abs(to);

                    for (const el of [modHalo, modRing])
                    {
                        el.style.display = '';
                        // Misma receta que el arco de valor, y por el MISMO
                        // motivo: si el anillo se pintara con la convencion
                        // contraria, caeria al lado del arco en vez de encima.
                        el.style.strokeDasharray = `${(span / 360) * circumference} ${circumference}`;
                        el.style.strokeDashoffset = `${-(begin / 360) * circumference}`;
                    }
                }
            },
            destroy () {},
        };
    },

    slider (host, control)
    {
        // Default look: track/fill/thumb the Slider builds itself — tag only.
        control.wrapper.classList.add('abd-skin--vector');

        return { root: control.wrapper, update () {}, destroy () {} };
    },

    toggle (host, control)
    {
        // Default look: button + CSS LED the Toggle builds itself — tag only.
        control.button.classList.add('abd-skin--vector');

        return { root: control.button, update () {}, destroy () {} };
    },

    select (host, control)
    {
        // Default look: the native <select>, styled by widgets.css — tag only.
        // A skin that wants its own list restyles `control.field` here.
        control.wrapper.classList.add('abd-skin--vector');

        return { root: control.wrapper, update () {}, destroy () {} };
    },

    segmented (host, control)
    {
        // Default look: flat segments styled by widgets.css — tag only, like
        // the select: the control builds its own DOM, the skin only names it.
        control.wrapper.classList.add('abd-skin--vector');

        return { root: control.wrapper, update () {}, destroy () {} };
    },

    numberbox (host, control)
    {
        // Default look: dark field + paired buttons styled by widgets.css —
        // tag only, same deal as the select/segmented above.
        control.wrapper.classList.add('abd-skin--vector');

        return { root: control.wrapper, update () {}, destroy () {} };
    },
});

/* ── ms2000: Korg-flavoured vector (extracted from ABDMS2000 rotaryKnob) ───── */

registerSkin('ms2000', {
    knob (host, control)
    {
        const root = document.createElement('div');
        root.className = 'abd-skin abd-skin--ms2000';

        const size = control.options?.size ?? 64;

        root.innerHTML = `
            <svg viewBox="0 0 50 50" class="abd-ms2000-knob" width="${size}" height="${size}"
                 aria-hidden="true">
                <circle cx="25" cy="25" r="23" class="abd-ms2000-knob__rim"/>
                <circle cx="25" cy="25" r="19" class="abd-ms2000-knob__cap"/>
                <circle cx="25" cy="25" r="21.5" class="abd-ms2000-knob__mod-halo"
                        transform="rotate(135 25 25)"/>
                <circle cx="25" cy="25" r="21.5" class="abd-ms2000-knob__mod-ring"
                        transform="rotate(135 25 25)"/>
                <g class="abd-ms2000-knob__indicator-group">
                    <rect x="24" y="8" width="2" height="9" rx="1"
                          class="abd-ms2000-knob__tick"/>
                    <circle cx="25" cy="25" r="2.5" class="abd-ms2000-knob__dot"/>
                </g>
            </svg>`;

        const group = root.querySelector('.abd-ms2000-knob__indicator-group');
        const modHalo = root.querySelector('.abd-ms2000-knob__mod-halo');
        const modRing = root.querySelector('.abd-ms2000-knob__mod-ring');
        const ringCircumference = 2 * Math.PI * 21.5;

        host.appendChild(root);

        return {
            root,
            update ()
            {
                const v = typeof control.getValue === 'function' ? control.getValue() : 0;

                group.style.transform = `rotate(${-135 + v * 270}deg)`;
                group.style.transformOrigin = '25px 25px';

                // Same signed arc as the vector skin, on its own outer radius.
                const mod = typeof control.getModulation === 'function'
                    ? control.getModulation() : 0;
                const from = v * 270;
                const to = Math.min(1, Math.max(-1, mod)) * 270;

                if (Math.abs(to) < 1.0e-3)
                {
                    modHalo.style.display = 'none';
                    modRing.style.display = 'none';
                }
                else
                {
                    const begin = Math.min(from, from + to);
                    const span = Math.abs(to);

                    for (const el of [modHalo, modRing])
                    {
                        el.style.display = '';
                        el.style.strokeDasharray = `${(span / 360) * ringCircumference} ${ringCircumference}`;
                        el.style.strokeDashoffset = `${ringCircumference - (begin / 360) * ringCircumference}`;
                    }
                }
            },
            destroy () {},
        };
    },

    toggle (host, control)
    {
        // Token variant of the LED button (same mechanic, MS2000 typography).
        control.button.classList.add('abd-toggle--ms2000');

        return { root: control.button, update () {}, destroy () {} };
    },
    select (host, control)
    {
        // Token variant of the list (same mechanic, MS2000 typography).
        control.field.classList.add('abd-select__field--ms2000');

        return { root: control.wrapper, update () {}, destroy () {} };
    },

    segmented (host, control)
    {
        // Token variant of the segment row (same mechanic, MS2000 typography).
        control.wrapper.classList.add('abd-segmented--ms2000');

        return { root: control.wrapper, update () {}, destroy () {} };
    },

    slider (host, control)
    {
        // MS2000 filmstrip fader: vertical uses 58x107px frames, horizontal 230x69px.
        // Sprite URL and geometry come from control.options (spriteUrl, frameWidth, frameHeight, frames).
        const vertical = control.options?.orientation === 'vertical';
        const spriteUrl = control.options?.spriteUrl ?? (vertical
            ? './assets/ST_Fader_58x107_128.png'
            : './assets/ST_Fader_230x69_128f.png');
        const frameWidth = control.options?.frameWidth ?? (vertical ? 58 : 230);
        const frameHeight = control.options?.frameHeight ?? (vertical ? 107 : 69);
        const frames = control.options?.frames ?? 128;

        control.wrapper.classList.add('abd-slider--ms2000');
        control.track.classList.add('abd-slider__track--ms2000');
        control.thumb.classList.add('abd-slider__thumb--ms2000');

        // Apply filmstrip to thumb if sprite provided
        if (spriteUrl) {
            control.thumb.style.width = `${frameWidth}px`;
            control.thumb.style.height = `${frameHeight}px`;
            control.thumb.style.backgroundImage = `url('${spriteUrl}')`;
            control.thumb.style.backgroundRepeat = 'no-repeat';
            control.thumb.dataset.frames = `${frames}`;
            control.thumb.dataset.frameHeight = `${frameHeight}`;
        }

        return {
            root: control.wrapper,
            update ()
            {
                if (!spriteUrl) return;
                const v = typeof control.getValue === 'function' ? control.getValue() : 0;
                const frame = Math.round(v * (frames - 1));
                control.thumb.style.backgroundPosition = `0 -${frame * frameHeight}px`;
            },
            destroy () {},
        };
    },
});

/* ── junio: photographic sprites (extracted from ABDJUNiO601 assets) ───────── */

registerSkin('junio', {
    knob (host, control)
    {
        // Junio EXACT structure: .knob-ring (filmstrip bg with knob graphics + radial marks) > .knob (white marker line)
        // The .knob-ring IS the filmstrip element with the knob graphic + radial marks as background (FIXED).
        // The .knob is a child div that rotates around the center of the knob graphic.
        // Matches ABDJUNiO601 Source/UI/WebUI/css/controls.css lines 61-81
        const root = document.createElement('div');
        root.className = 'abd-knob-ring';  // Exact class from Junio

        const sprite = control.options?.spriteUrl ?? './assets/junio/knob.png';
        const size = control.options?.size ?? 64;

        root.style.cssText = `
            width: ${size}px;
            height: ${size}px;
            background: url('${sprite}') no-repeat center;
            background-size: contain;
            position: relative;
            cursor: grab;
            touch-action: none;
        `;

        // The marker line - EXACT match to Junio .knob (controls.css lines 70-81)
        const marker = document.createElement('div');
        marker.className = 'knob';  // Exact class from Junio
        marker.style.cssText = `
            position: absolute;
            width: 2px;
            height: 6px;
            background: var(--white);
            left: 50%;
            top: 17px;
            transform: translateX(-50%);
            transform-origin: center 13px;  // 13px from top of knob = center of knob graphic
            box-shadow: 0 0 2px rgba(0, 0, 0, 0.5);
            border-radius: 1px;
        `;

        root.appendChild(marker);
        host.appendChild(root);

        return {
            root,
            update ()
            {
                const v = typeof control.getValue === 'function' ? control.getValue() : 0;
                // Junio: translateX(-50%) rotate(${val * 270 - 135}deg)
                const angle = v * 270 - 135;
                marker.style.transform = `translateX(-50%) rotate(${angle}deg)`;
            },
            destroy () {},
        };
    },

    slider (host, control)
    {
        // Junio EXACT: .v-slider (slot bg) > .track (inner) > .handle (cap)
        // Vertical: .v-slider (32x160) with .track (4x144) and .handle (32x16)
        // Horizontal: .v-slider-mini (160x32) with .track (144x4) and .handle (16x32)
        // Source: ABDJUNiO601 Source/UI/WebUI/css/controls.css lines 32-58
        // Sync logic: ui-sliders.js lines 390-397
        
        const isVertical = control.options.orientation === 'vertical';
        
        if (isVertical) {
            control.wrapper.classList.add('v-slider');
            control.wrapper.style.cssText = `
                width: 32px;
                height: 160px;
                background: url('../../assets/junio/slider_slot.png') no-repeat center center;
                background-size: contain;
                position: relative;
                cursor: ns-resize;
            `;
        } else {
            control.wrapper.classList.add('v-slider', 'v-slider-mini');
            control.wrapper.style.cssText = `
                width: 160px;
                height: 32px;
                background: url('../../assets/junio/slider_slot.png') no-repeat center center;
                background-size: contain;
                position: relative;
                cursor: ew-resize;
            `;
        }
        
        // Inner track element (Junio .track) - 8px padding
        const track = document.createElement('div');
        track.className = 'track';
        if (control.options.orientation === 'vertical') {
            track.style.cssText = `
                position: absolute;
                top: 8px;
                bottom: 8px;
                width: 4px;
                left: 14px;
                background: transparent;
            `;
        } else {
            track.style.cssText = `
                position: absolute;
                left: 8px;
                right: 8px;
                top: 0;
                bottom: 0;
                height: 4px;
                background: transparent;
            `;
        }
        control.wrapper.appendChild(track);

        // Handle (cap) - EXACT match to Junio .handle
        const handle = document.createElement('div');
        handle.className = 'handle';
        if (control.options.orientation === 'vertical') {
            handle.style.cssText = `
                position: absolute;
                width: 32px;
                height: 16px;
                left: 0;
                background: url('../../assets/junio/slider_cap.png') no-repeat center center;
                background-size: contain;
                pointer-events: none;
            `;
        } else {
            handle.style.cssText = `
                position: absolute;
                width: 16px;
                height: 32px;
                top: 0;
                left: 0;
                background: url('../../assets/junio/slider_cap.png') no-repeat center center;
                background-size: contain;
                pointer-events: none;
            `;
        }
        control.wrapper.appendChild(handle);

        // Override render to move cap EXACTLY like Junio syncUI (ui-sliders.js lines 390-397)
        const originalRender = control.render.bind(control);
        control.render = () => {
            originalRender();
            const v = control.getValue();
            const track = control.wrapper.querySelector('.track');
            const handleEl = control.wrapper.querySelector('.handle');
            const isVertical = control.options.orientation === 'vertical';
            const containerDim = isVertical ? track.clientHeight : track.clientWidth;
            const handleDim = isVertical ? handleEl.clientHeight : handleEl.clientWidth;
            const availableSpace = Math.max(0, containerDim - handleDim);
            if (availableSpace >= 0) {
                const pos = (1 - v) * availableSpace;
                if (isVertical) {
                    handleEl.style.top = `${pos}px`;
                    handleEl.style.left = '0';
                } else {
                    handleEl.style.left = `${pos}px`;
                    handleEl.style.top = '0';
                }
            }
        };

        return { 
            root: control.wrapper, 
            update: () => control.render(), 
            destroy () {} 
        };
    },

    toggle (host, control)
    {
        // Sprite buttons: CSS picks on/off PNG by [data-color] + [aria-pressed].
        control.button.classList.add('abd-toggle--junio');

        return { root: control.button, update () {}, destroy () {} };
    },
});
