/**
 * ABD Segmented — reusable inline option switcher for the ABDSynths suite.
 *
 * Family rules (see components/select.js, knob.js, slider.js, toggle.js):
 *   - constructor(container, options) + setValue/getValue/destroy + onChange;
 *   - pure DOM/CSS, themed via --color-* tokens with literal fallbacks;
 *   - silent setValue, onChange only on user edits — y solo en una TRANSICION
 *     real: elegir el segmento ya activo no avisa (transitionNotices.js).
 *
 * WHAT IS SHARED: the value, the notes, the veto, the divergence and the
 * teardown are IndexControl (indexControl.js); el indice que no necesita DOM,
 * optionIndex.js. Here queda la radiogroup: el grupo, sus botones y el estado.
 *
 * VALUE MODEL: the option INDEX (integer) — identical to the Select. It is the
 * compact SIBLING of the Select for short, always-visible lists: the native
 * <select> stays the right tool for long or occasionally-huge lists (28
 * modulation destinations need scrolling for free); a segmented control shows
 * every choice as its own button, so the trade is width for immediacy.
 *
 * WHY NOT RADIO BUTTONS: a radiogroup is the semantics (roving tabindex,
 * arrow-key navigation per WAI-ARIA), but the LOOK is the synth's: flat
 * segments sharing one border, active segment filled with the accent. Keyboard,
 * screen readers and WebView2 work through the pattern, not through pixels.
 *
 * WHERE THE STATE LIVES: in each radio's `aria-checked`, never on the group.
 * A radiogroup has no value semantics - `aria-valuenow`/`aria-valuetext` are not
 * supported on it, and on the role-less wrapper they reached no one.
 *
 * DISABLED OPTIONS: same contract as the Select; here only what is THIS
 * control's, the availability as `aria-disabled` and NEVER the native attribute.
 * A natively disabled radio leaves the tab order and the arrow walk, so it is
 * never announced. With `aria-disabled` the vetoed radio stays FOCUSABLE, y el
 * tabindex rotatorio conserva su unica parada en el radio MARCADO aunque ese
 * sea el vetado. Elegir sigue prohibido en los manejadores.
 *
 * WIDTH: segments share the row (`flex: 1 1 0`), so N options fill the cell —
 * the grid maths of a synth page decide the cell, never the control. Long
 * labels truncate with ellipsis, and NOTHING of what a segment says hides in a
 * `title`: the veto `note` travels as the segment's accessible description.
 *
 * Skins: tagged as kind 'segmented'; a skin may restyle it via the 'vector'
 * fallback (see components/skins/index.js).
 *
 * GLYPHS: an entry may carry a `glyph` (inline SVG string, see waveforms.js)
 * or the whole control may pass a `glyphs` array aligned with the options.
 * A glyphed segment renders two rows - mark above the text - with the SVG
 * following `currentColor` like every other piece of the family, so the
 * active fill inverts it for free.
 *
 * VARIANTS: `variant: 'led'` (default 'strip') swaps the shared-border strip
 * for a row of lamp buttons: dark pads whose mark lights with the accent when
 * active. Same DOM contract, same value model, only the furniture changes
 * (`.abd-segmented--led`).
 */

import { IndexControl } from './indexControl.js';
import { transitioned, announceTransition } from './transitionNotices.js';
import { arrowStepFor, clampIndex, nextEnabledIndex } from './optionIndex.js';

/**
 * Usage:
 *   const seg = new Segmented(el, { options: ['LFO', 'ENV', 'SEQ'], onChange });
 *   seg.setValue(1);
 *   seg.setDisabled([2]);
 *   seg.setNote(0, 'Solo con el motor arrancado');
 *   seg.destroy();
 *
 * @param {HTMLElement|string} container
 * @param {object} options
 *   options   array of entries: 'Label' or { label, disabled?, note? }.
 *   value     initial index, default 0.
 *   label     optional text above the group.
 *   id        optional id for the group (lets a <label for> or a host script
 *             find it; the group id is the caller's - the only ids the control
 *             mints itself are the internal ones wiring the note reasons).
 *   disabled  array of indices or (entry, index) => boolean, default [].
 *   glyphs    optional array of inline-SVG strings aligned with `options`.
 *   variant   'strip' (default) or 'led' (row of lamp buttons).
 *   skin      optional skin name (see components/skins).
 *   onChange  (index) => void, fires on user picks only (not on setValue) and
 *             only when the pick changes the value (re-picking the active segment
 *             is an intention without transition, see transitionNotices.js).
 */
export class Segmented extends IndexControl
{
    constructor (container, options = {})
    {
        super(container, {
            name: 'Segmented',
            kind: 'segmented',
            entries: (options.options ?? []).map(normalizeEntry),
            disabledSpec: options.disabled ?? [],
            value: clampTo(options.value, options.options),
            skin: options.skin,
            options,
        });
    }

    prepareEntries ()
    {
        this.variant = this.options.variant === 'led' ? 'led' : 'strip';

        // Glyphs: per-entry wins; the aligned array fills the gaps.
        if (Array.isArray(this.options.glyphs))
            this.options.glyphs.forEach((glyph, index) =>
            {
                if (this.entries[index] && this.entries[index].glyph === '')
                    this.entries[index].glyph = String(glyph ?? '');
            });
    }

    buildDom ()
    {
        this.wrapper = document.createElement('div');
        this.wrapper.className = 'abd-segmented';

        if (this.variant !== 'strip')
            this.wrapper.classList.add(`abd-segmented--${this.variant}`);

        // Same <label for> deal as Select: reachable by name when the caller
        // gives an id. The target is the ACTIVE button, so focus/label agree.
        this.createLabel('abd-segmented', this.options.label, this.options.id);

        this.group = document.createElement('div');
        this.group.className = 'abd-segmented__group';
        this.group.setAttribute('role', 'radiogroup');

        if (this.options.id)
        {
            this.group.id = this.options.id;

            if (this.labelEl != null)
            {
                this.group.setAttribute('aria-labelledby', `${this.options.id}-label`);
                this.labelEl.id = `${this.options.id}-label`;
            }
        }
        else if (this.options.label)
            this.group.setAttribute('aria-label', this.options.label);

        // El grupo se cuelga ANTES del bucle: asi el contenedor de notas (creado al
        // primer motivo) queda detras de los radios, donde se lee.
        this.wrapper.appendChild(this.group);

        // Reasons for the vetoes: one hidden description per entry carrying a
        // `note`, wired to its radio with aria-describedby OUTSIDE the buttons — a
        // hidden node inside would be swallowed into the radio's accessible NAME.
        this.notes = this.createNotes('abd-segmented', (index) => this.buttons[index]);

        this.buttons = [];

        this.entries.forEach((entry, index) =>
        {
            const button = document.createElement('button');

            button.type = 'button';
            button.className = 'abd-segmented__segment';
            button.setAttribute('role', 'radio');
            button.dataset.index = `${index}`;

            if (entry.glyph !== '')
            {
                button.classList.add('abd-segmented__segment--glyphed');

                const glyphSpan = document.createElement('span');
                glyphSpan.className = 'abd-segmented__glyph';
                glyphSpan.innerHTML = entry.glyph;   // trusted: the suite's own SVGs
                button.appendChild(glyphSpan);
            }

            const textSpan = document.createElement('span');
            textSpan.className = 'abd-segmented__text';
            textSpan.textContent = entry.label;
            button.appendChild(textSpan);

            this.group.appendChild(button);
            this.buttons[index] = button;

            // El motivo (si lo hay) como descripcion del radio: fuera del boton.
            this.notes.wire(index, entry.note);
        });

        this.container.appendChild(this.wrapper);
    }

    attachInteraction ()
    {
        const onActivate = (event) =>
        {
            const index = Number(event.currentTarget.dataset.index);

            if (this.isIndexDisabled(index))
                return;   // a refused value reports nothing, like Select

            this.commit(index);
        };

        const onKey = (event) =>
        {
            // Arrow keys walk the options (wrapping), like a native radiogroup.
            const step = arrowStepFor(event.key);

            if (step === 0)
                return;

            event.preventDefault();

            const previous = this.value;
            const next = nextEnabledIndex(
                (at) => this.isIndexDisabled(at), this.entries.length, previous, step);

            if (! transitioned(previous, next) || this.isIndexDisabled(next))
                return;

            this.commit(next);
            this.buttons[this.value]?.focus();
        };

        for (const button of this.buttons)
            this.listen(button, 'click', onActivate);

        // Keys live on the GROUP with delegation: focus follows the roving
        // tabindex (it sits on the active segment), and one listener covers
        // every focused segment.
        this.listen(this.group, 'keydown', onKey);
    }

    /**
     * @brief Un gesto del usuario que cambia el valor: el cambia, se pinta y se
     *   avisa. Que no haya TRANSICION se decide antes de llamar (transitioned),
     *   porque una intencion sin cambio no pinta ni avisa.
     */
    commit (index)
    {
        const previous = this.value;

        this.value = index;
        this.render();
        announceTransition(this.options.onChange, previous, index);
    }

    /** @brief Push value + availability into the DOM. */
    render ()
    {
        this.buttons.forEach((button, index) =>
        {
            const active = index === this.value;
            const disabled = this.isIndexDisabled(index);

            button.classList.toggle('is-active', active);
            // The state lives HERE, one radio at a time: aria-checked is what a
            // reader announces. The group carries NO value semantics -
            // aria-valuenow / aria-valuetext are not supported on a radiogroup,
            // and on the role-less wrapper they were inert anyway.
            button.setAttribute('aria-checked', active ? 'true' : 'false');
            // aria-disabled, NOT the native attribute: a natively disabled radio
            // loses focus, and with it the announcement of its own state and of
            // the note explaining the veto. The veto is still enforced in the
            // click and arrow handlers (isIndexDisabled), so nothing becomes
            // pickable - only announceable.
            if (disabled)
                button.setAttribute('aria-disabled', 'true');
            else
                button.removeAttribute('aria-disabled');

            // No `title` here: the veto reason is the segment's accessible
            // DESCRIPTION, wired in buildDom, and that is what a reader announces.
            // A title is mouse-only for a person and never reached the reader.
            // Roving tabindex: exactly ONE stop, and it is the CHECKED radio
            // (APG: Tab enters a radiogroup on the checked button). Availability
            // is aria-disabled, so the checked radio is focusable even when it is
            // the vetoed one: a divergent value keeps BOTH its stop and its
            // announcement. The old fallback - handing the stop to the first
            // available option - only compensated for the native `disabled`
            // attribute, and it left the divergent state unreadable.
            button.tabIndex = active ? 0 : -1;
        });

        // A divergent value stays visible and flagged, never rewritten.
        this.wrapper.dataset.divergent = this.isDivergent() ? 'true' : 'false';
    }
}

/** 'Label' and { label, glyph, disabled, note } are both accepted, everywhere. */
function normalizeEntry (entry)
{
    if (typeof entry === 'string')
        return { label: entry, glyph: '', disabled: false, note: '' };

    return {
        label: `${entry?.label ?? ''}`,
        glyph: entry?.glyph != null ? String(entry.glyph) : '',
        disabled: Boolean(entry?.disabled),
        note: entry?.note ?? '',
    };
}

/** El valor inicial, recortado al dominio de las entradas. */
const clampTo = (value, lista) =>
    clampIndex((lista ?? []).length, value);
