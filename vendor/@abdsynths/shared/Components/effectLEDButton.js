/**
 * ABD EffectLEDButton — Photo-sprite button with LED states (on/off).
 * Matches Junio .sq buttons: 6 colors, each with off/on sprite.
 *
 * Colors: orange, yellow, beige (white), patch-blue, grey, red
 *
 * Usage:
 *   const button = new EffectLEDButton(el, { color: 'orange', value: false, onChange });
 *   button.setValue(true);       // programatico: SI dispara onChange
 *   button.setValueSilent(true); // para restaurar estado sin avisar
 *   button.destroy();
 */
/**
 * El color que ve el host, y el color con el que se llaman los sprites.
 *
 * Los seis sets se nombran por como se ven en la maquina (`beige`,
 * `patch-blue`), pero los ficheros de la foto se llaman por el color del
 * sprite (`button_white_*`, `button_blue_*`). Los otros cuatro coinciden.
 *
 * Va ANTES del JSDoc de la clase, no entre el JSDoc y la clase: el audit exige
 * que la firma documentada sea la que de verdad declara el modulo.
 */
const SPRITE_NAME = {
    beige: 'white',
    'patch-blue': 'blue',
};

/**
 * @param {HTMLElement|string} container
 * @param {object} options
 *   color      sprite set: orange | yellow | beige | patch-blue | grey | red,
 *              default 'orange'.
 *   value      initial state, default false (LED off).
 *   label      optional text painted on the button.
 *   size       'normal' (default) or 'tiny'.
 *   momentary  if true it is a push button: lit while pressed, never latches
 *              (onChange(true) on press, onChange(false) on release).
 *   onChange   (boolean) => void, fires on user presses only.
 */
export class EffectLEDButton {
    constructor(container, options = {}) {
        this.container = typeof container === 'string'
            ? document.querySelector(container)
            : container;

        if (!this.container) throw new Error('EffectLEDButton: container not found');

        this.options = {
            color: options.color ?? 'orange',     // orange, yellow, beige, patch-blue, grey, red
            value: options.value ?? false,
            label: options.label ?? '',
            momentary: options.momentary ?? false,
            size: options.size ?? 'normal',       // normal | tiny
            onChange: options.onChange ?? null,
            ...options,
        };

        this.value = Boolean(this.options.value);
        this.buildDom();
        this.attachEvents();
        this.render();
    }

    buildDom() {
        const { color, size } = this.options;
        const isTiny = size === 'tiny';
        // El NOMBRE que ve el host y el NOMBRE del fichero no son lo mismo: los
        // seis sets se llaman por su color en la maquina (beige, patch-blue) y
        // los sprites por el color de la foto (white, blue). Sin el mapa de
        // SPRITE_NAME, `beige` pedia `button_beige_off.png`, que no existe, y
        // salia un boton vacio en silencio: el 404 no lo ve nadie en un test
        // de jsdom. El resto de rutas usan el mismo helper.
        const sprite = SPRITE_NAME[color] ?? color;

        this.button = document.createElement('button');
        this.button.className = `abd-effect-led-btn abd-effect-led-btn--${color} ${isTiny ? 'abd-effect-led-btn--tiny' : ''}`;
        this.button.style.cssText = `
            width: ${isTiny ? '28px' : '44px'};
            height: ${isTiny ? '20px' : '32px'};
            background: transparent;
            border: none;
            cursor: pointer;
            transition: transform 0.05s, filter 0.1s;
            display: flex;
            align-items: center;
            justify-content: center;
            background-image: url('../../assets/junio/button_${sprite}_off.png');
            background-repeat: no-repeat;
            background-size: contain;
            background-position: center;
        `;

        if (this.options.label) {
            this.labelEl = document.createElement('span');
            this.labelEl.style.cssText = `
                font-size: 7px;
                font-weight: 600;
                color: var(--color-text-muted, #7e9bb5);
                text-transform: uppercase;
                letter-spacing: 0.5px;
                margin-top: ${isTiny ? '2px' : '4px'};
                display: block;
                text-align: center;
                width: 100%;
            `;
            this.labelEl.textContent = this.options.label;
            this.button.appendChild(this.labelEl);
        }

        this.container.appendChild(this.button);
    }

    attachEvents() {
        const pressDown = () => {
            this.button.style.transform = 'translateY(1px)';
            this.button.style.filter = 'brightness(0.85)';
        };
        const pressUp = () => {
            this.button.style.transform = '';
            this.button.style.filter = '';
        };

        this.button.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            pressDown();
            if (!this.options.momentary) {
                this.value = !this.value;
                this.render();
                this.options.onChange?.(this.value);
            } else {
                this.value = true;
                this.render();
                this.options.onChange?.(true);
            }
        });

        this.button.addEventListener('pointerup', () => {
            pressUp();
            if (this.options.momentary) {
                this.value = false;
                this.render();
                this.options.onChange?.(false);
            }
        });

        this.button.addEventListener('pointerleave', () => {
            this.button.style.transform = '';
            this.button.style.filter = '';
            if (this.options.momentary) {
                this.value = false;
                this.render();
                this.options.onChange?.(false);
            }
        });
    }

    render() {
        const state = this.value ? 'on' : 'off';
        this.button.style.backgroundImage = `url('../../assets/junio/button_${this.#spriteName()}_${state}.png')`;
        this.button.setAttribute('data-active', this.value ? 'true' : 'false');
    }

    /**
     * El nombre del sprite de ESTE boton: el del alias, no el que pidio el host.
     * Vive en un sitio solo porque las tres rutas que pintan (al construir, al
     * pulsar y al restaurar) tienen que pintar el mismo fichero: con el
     * nombre a pelo, el boton nacia bien y se vaciaba en la primera pulsacion.
     */
    #spriteName() {
        return SPRITE_NAME[this.options.color] ?? this.options.color;
    }

    /**
     * @brief Programmatic update — fires onChange.
     * @param {boolean} value  estado nuevo del boton.
     */
    setValue(value) {
        this.value = Boolean(value);
        this.render();
        this.options.onChange?.(this.value);
    }

    /**
     * Silent update (no onChange).
     * @param {boolean} value  estado nuevo, sin aviso al host.
     */
    setValueSilent(value) {
        this.value = Boolean(value);
        const state = this.value ? 'on' : 'off';
        this.button.style.backgroundImage = `url('../../assets/junio/button_${this.#spriteName()}_${state}.png')`;
        this.button.setAttribute('data-active', this.value ? 'true' : 'false');
    }

    getValue() { return this.value; }

    destroy() {
        this.button.remove();
    }
}