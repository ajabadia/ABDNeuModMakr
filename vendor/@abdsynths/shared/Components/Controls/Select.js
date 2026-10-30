/**
 * ABD Select — reusable option list for the ABDSynths suite.
 *
 * Family rules (see components/knob.js, slider.js, toggle.js):
 *   - constructor(container, options) + setValue/getValue/destroy + onChange;
 *   - pure DOM/CSS, themed via --color-* tokens with literal fallbacks;
 *   - silent setValue, onChange only on user edits.
 *
 * WHAT IS SHARED, AND WHERE: the value, the notes that explain a veto, the
 * divergence and the teardown are IndexControl (indexControl.js); the index
 * maths that needs no DOM is optionIndex.js. What is left here is the native
 * <select>: the field and its options, the change event, and the state in the
 * DOM. The veto (`isIndexDisabled`) is in the base: it is the same rule for the
 * two, and written twice it is how a family stops being a family.
 *
 * VALUE MODEL: the option INDEX (integer) — the discrete sibling of the
 * Toggle's boolean. Normalising to 0..1 stays with the caller on purpose: for a
 * `choice` parameter the index<->normalised mapping carries that parameter's own
 * skew/interval (generated contract), so folding it in here would drag
 * plugin-side maths into the shared layer. Same rule as the rest of the family:
 * the caller owns real units, the control owns the gesture.
 *
 * WHY A NATIVE <select>: keyboard, screen readers, touch and WebView2 all work
 * for free, and a 28-entry list needs scrolling that a custom listbox would have
 * to reimplement (and get wrong). The look is CSS; the behaviour is this class.
 * It is also the only member that does NOT use drag-core: dragging through 28
 * discrete entries picks a value by accident, which is worse than not offering
 * it. The dropdown and the arrow keys cover editing; a test pins that.
 *
 * DISABLED OPTIONS: an entry is unavailable by its own `disabled` flag or by the
 * `disabled` spec the control takes (indices or a predicate), which
 * `setDisabled()` recomputes at runtime. The second is the pattern a synth needs
 * when a list depends on ANOTHER parameter (NEURONiK's modulation destinations
 * depend on the engine); the reason lives in the entry as a `note`. A value that
 * lands on a disabled option is NOT rewritten: it is kept and flagged
 * (`isDivergent()`, `[data-divergent]`) so the UI can show host state it cannot
 * offer instead of silently changing it. Who is vetoed is optionIndex.js.
 *
 * ANNOUNCED, NOT JUST SEEN, AND IT TAKES TWO: the `note` is the option's
 * accessible DESCRIPTION (`aria-describedby`), never a `title`. A title is
 * mouse-only for a person, and for an option nobody can focus it reaches nobody
 * at all. The note nodes live OUTSIDE the <option>: a note inside it is
 * swallowed into the option's accessible NAME (measured in Chromium, as in
 * Segmented). And because an <option> never takes focus, the reason of the
 * option IN USE is ALSO copied onto the field's own description (measured: with
 * the value on a vetoed option the combobox exposed `description=""` while the
 * option carried the note) — that copy is `setFieldNote`, y es de este control
 * y no de la base.
 *
 * Skins: tagged as kind 'select'; a skin may restyle it via the 'vector'
 * fallback (see components/skins/index.js).
 */

import { IndexControl } from './indexControl.js';
import { clampIndex } from './optionIndex.js';

/**
 * Usage:
 *   const select = new Select(el, { options: ['Recta', 'Tri', 'Saw'], onChange });
 *   select.setValue(2);
 *   select.setDisabled([0]);            // vetos en caliente: indices o predicado
 *   select.setNote(0, 'Requiere el motor Neurotik');
 *   select.destroy();
 *
 * @param {HTMLElement|string} container
 * @param {object} options
 *   options   array of entries: 'Label' or { label, disabled?, note? }.
 *   value     initial index, default 0.
 *   label     optional text above the list.
 *   id        optional id for the <select> (lets a <label for> or a host
 *             script find it; the field id is the caller's - the only ids the
 *             control mints itself are the internal ones wiring the note reasons).
 *   disabled  array of indices or (entry, index) => boolean, default [].
 *   skin      optional skin name (see components/skins).
 *   onChange  (index) => void, fires on user picks only (not on setValue).
 */
export class Select extends IndexControl
{
    constructor (container, options = {})
    {
        super(container, {
            name: 'Select',
            kind: 'select',
            entries: (options.options ?? []).map(normalizeEntry),
            disabledSpec: options.disabled ?? [],
            value: clampIndex((options.options ?? []).length, options.value),
            skin: options.skin,
            options,
        });
    }

    buildDom ()
    {
        this.wrapper = document.createElement('div');
        this.wrapper.className = 'abd-select';

        // A <label for> is worth the four lines: it makes the list reachable by
        // clicking its name and by screen readers. Only when the caller gave an id.
        this.createLabel('abd-select', this.options.label, this.options.id);

        this.field = document.createElement('select');
        this.field.className = 'abd-select__field';

        if (this.options.id)
            this.field.id = this.options.id;

        // El campo se cuelga ANTES del bucle: asi el contenedor de notas (creado al
        // primer motivo) queda detras de la lista, donde se lee.
        this.wrapper.appendChild(this.field);

        // Reasons for the vetoes: one hidden description per entry carrying a
        // `note`, wired to its <option> with aria-describedby OUTSIDE the options.
        // The wiring is IndexControl (optionIndex.js); the copy on the FIELD is
        // this control's own (setFieldNote).
        this.notes = this.createNotes('abd-select', (index) => this.field.options[index]);
        this.fieldNoteId = null;      // la nota que el control puso en el campo

        this.entries.forEach((entry, index) =>
        {
            const option = document.createElement('option');

            option.value = `${index}`;
            option.textContent = entry.label;

            this.field.appendChild(option);

            // El motivo (si lo hay) como descripcion del option: fuera de el.
            this.notes.wire(index, entry.note);
        });

        this.container.appendChild(this.wrapper);
    }

    attachInteraction ()
    {
        const onChange = () =>
        {
            const index = Number(this.field.value);

            // A disabled entry is not selectable: put the field back and report
            // nothing, rather than emitting a value the UI just refused.
            if (this.isIndexDisabled(index))
            {
                this.render();
                return;
            }

            this.value = index;
            this.render();
            this.options.onChange?.(this.value);
        };

        this.listen(this.field, 'change', onChange);
    }

    /**
     * @brief El motivo del veto cambia, y el CAMPO tambien lo dice.
     *
     * La base cablea la nota en la <option>; aqui hay que repintar, porque el
     * campo apunta a la nota de su valor actual y esa copia se decide en render.
     *
     * @param {number} index  posicion de la entrada (0..n-1); una desconocida se ignora.
     * @param {string} text  motivo nuevo; vacio retira la nota.
     */
    setNote (index, text)
    {
        super.setNote(index, text);
        this.render();
    }

    /** @brief Push value + availability into the DOM. */
    render ()
    {
        const count = this.entries.length;
        const hasOptions = count > 0;

        if (hasOptions)
            this.field.value = `${this.clampIndex(this.value)}`;

        [...this.field.options].forEach((option, index) =>
        {
            // The veto reason is NOT a title: it is the option's accessible
            // description, wired in buildDom. A title is mouse-only for a person,
            // and an option nobody can focus reaches nobody with it.
            option.disabled = this.isIndexDisabled(index);   // recomputed: dynamic
        });

        // The whole field stays enabled: a divergent value is information, not a
        // lock. With no entries at all there is nothing to pick.
        this.field.disabled = ! hasOptions;
        this.wrapper.dataset.divergent = this.isDivergent() && hasOptions ? 'true' : 'false';

        // Y el motivo viaja tambien al CAMPO cuando la opcion vetada es la que
        // esta en uso: nadie enfoca un <option>, quien anuncia es el <select>.
        this.setFieldNote(this.field.options[this.value]?.getAttribute('aria-describedby') ?? null);

        // NO aria-valuenow / aria-valuetext aqui. Un <select> nativo es role
        // combobox, y la semantica de valor (valuemin/max/now/text) solo la
        // soportan slider, spinbutton, progressbar, meter, scrollbar y separator:
        // escritos aqui eran inertes, y el lector seguia anunciando el valor del
        // campo - que el propio <select> ya expone, asi que no se pierde nada.
        // La invariante esta fijada en tests/ariaInvariants.test.js.
    }

    /**
     * @brief Apunta la descripcion del CAMPO a la nota de su valor actual.
     *
     * `null` la retira. El campo puede traer una descripcion puesta desde fuera: el
     * control solo sustituye la SUYA (this.fieldNoteId) y respeta las demas.
     */
    setFieldNote (noteId)
    {
        const hostIds = (this.field.getAttribute('aria-describedby') ?? '')
            .split(' ')
            .filter((id) => id !== '' && id !== this.fieldNoteId);

        if (noteId != null)
            hostIds.push(noteId);

        this.fieldNoteId = noteId ?? null;

        if (hostIds.length > 0)
            this.field.setAttribute('aria-describedby', hostIds.join(' '));
        else
            this.field.removeAttribute('aria-describedby');
    }
}

/** 'Label' and { label, disabled, note } are both accepted, everywhere. */
function normalizeEntry (entry)
{
    if (typeof entry === 'string')
        return { label: entry, disabled: false, note: '' };

    return {
        label: `${entry?.label ?? ''}`,
        disabled: Boolean(entry?.disabled),
        note: entry?.note ?? '',
    };
}
