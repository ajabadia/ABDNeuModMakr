/**
 * ABD StepMatrix — Canonical Step Matrix & Tracker Rows for the ABDSynths suite.
 * =============================================================================
 * A hardware-style tracker row and modulation step sequencer component.
 * Used for command matrices, step sequencers, and envelope step tables
 * across ABDMCS48SE, ABDMS2000, and ABDCZ101.
 *
 * Family rules (see knob.js, slider.js, modMatrix.js):
 *   - constructor(container, options), setRows(rows), getRows(),
 *     triggerStep(index), destroy();
 *   - framework-agnostic: pure DOM and callbacks;
 *   - themed ONLY through CSS custom properties from styles/tokens.css
 *     (the classes live in styles/components/step-matrix.css);
 *   - accessible: every control carries an aria-label that names its step and
 *     its column, the destination buttons expose aria-pressed, and the table is
 *     a labelled grid so a screen reader can announce where the focus is.
 *
 * Data model — one row is:
 *   { enabled, note, target, value, probability, delayMs, mutation, mutationAmount }
 * with `note` a MIDI number 0..127 and `probability` a 0..1 fraction.
 *
 * Usage:
 *   const matrix = new StepMatrix(el, {
 *     rows: [{ enabled: true, note: 48, target: 'engine_clock', value: 1, ... }],
 *     targets: [{ id: 'engine_clock', label: 'CLOCK' }],
 *     onChange: (index, row) => host.write(index, row),
 *   });
 *   matrix.setRows(next);      // programmatic: does NOT fire onChange
 *   matrix.triggerStep(3);     // only flashes the LED
 */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** MIDI number (0..127) to scientific pitch name ("C3"). Anything else is "–". */
export function midiNoteToName(midiNote) {
  if (midiNote < 0 || midiNote > 127 || isNaN(midiNote)) return '–';
  const octave = Math.floor(midiNote / 12) - 1;
  const name = NOTE_NAMES[midiNote % 12];
  return `${name}${octave}`;
}

export class StepMatrix {
  /**
   * @param {HTMLElement|string} container
   * @param {object} options
   * @param {Array<object>} [options.rows]
   * @param {Array<{id: string, label: string}>} options.targets
   * @param {Array<string>} [options.mutations]
   * @param {Function} [options.onChange] (rowIndex, rowPayload) => void
   * @param {Function} [options.targetRange] (targetId) => { min, max, step, decimals }
   * @param {Function} [options.formatValue] (targetId, value) => string
   * @param {number} [options.rowCount=8] rows painted when `rows` is empty
   * @param {string} [options.ariaLabel='Matriz de pasos'] accessible name
   */
  constructor(container, options = {}) {
    this.container = typeof container === 'string'
      ? document.querySelector(container)
      : container;

    if (!this.container) {
      throw new Error('StepMatrix: invalid container element');
    }

    this.options = {
      rows: options.rows || [],
      rowCount: options.rowCount || 8,
      ariaLabel: options.ariaLabel || 'Matriz de pasos',
      targets: options.targets || [
        { id: 'engine_clock', label: 'CLOCK' },
        { id: 'latch_write', label: 'LATCH' }
      ],
      mutations: options.mutations || ['none', 'increment', 'decrement', 'random', 'wrap'],
      onChange: options.onChange || (() => {}),
      targetRange: options.targetRange || ((target) => (
        target === 'latch_write'
          ? { min: 0, max: 255, step: 1, decimals: 0 }
          : { min: 0.0625, max: 8.0, step: 0.0625, decimals: 3 }
      )),
      formatValue: options.formatValue || ((target, val) => (
        target === 'latch_write' ? `0x${Number(val).toString(16).toUpperCase().padStart(2, '0')}` : `${Number(val).toFixed(3)}x`
      ))
    };

    this.rowElements = [];
    this.triggerTimers = new Map();
    this.build();
  }

  build() {
    this.container.innerHTML = '';
    const tableWrap = document.createElement('div');
    tableWrap.className = 'step-matrix-wrap';

    const table = document.createElement('table');
    table.className = 'step-matrix-table';
    table.setAttribute('aria-label', this.options.ariaLabel);
    this.table = table;

    const thead = document.createElement('thead');
    thead.innerHTML = `
      <tr>
        <th scope="col" class="th-step">#</th>
        <th scope="col" class="th-trig">TRIG</th>
        <th scope="col" class="th-on">ON</th>
        <th scope="col" class="th-note">NOTA</th>
        <th scope="col" class="th-dest">DESTINO</th>
        <th scope="col" class="th-val">VALOR</th>
        <th scope="col" class="th-prob">PROB</th>
        <th scope="col" class="th-delay">DELAY</th>
        <th scope="col" class="th-mut">MUTACIÓN</th>
        <th scope="col" class="th-amt">PASO</th>
      </tr>
    `;
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    this.tbody = tbody;
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    this.container.appendChild(tableWrap);

    const initialRows = this.options.rows.length > 0
      ? this.options.rows
      : Array(this.options.rowCount).fill(null);
    initialRows.forEach((row, idx) => {
      this.buildRow(idx, row);
    });
  }

  buildRow(index, initialData = null) {
    const tr = document.createElement('tr');
    tr.className = 'step-matrix-row';
    tr.dataset.step = String(index);
    const where = `Paso ${index + 1}`;

    // 1. Step Number
    const tdStep = document.createElement('td');
    tdStep.className = 'td-step';
    const stepNum = document.createElement('span');
    stepNum.className = 'step-num-badge';
    stepNum.textContent = String(index + 1).padStart(2, '0');
    tdStep.appendChild(stepNum);

    // 2. Trig LED — purely decorative: the state is also in [data-triggered],
    // which is what the CSS and the tests read.
    const tdTrig = document.createElement('td');
    tdTrig.className = 'td-trig';
    const trigLed = document.createElement('span');
    trigLed.className = 'step-trig-led';
    trigLed.setAttribute('aria-hidden', 'true');
    tdTrig.appendChild(trigLed);

    // 3. Enabled Toggle
    const tdOn = document.createElement('td');
    tdOn.className = 'td-on';
    const enableCheck = document.createElement('input');
    enableCheck.type = 'checkbox';
    enableCheck.className = 'step-toggle-input';
    enableCheck.setAttribute('aria-label', `${where}: activo`);
    enableCheck.checked = initialData ? Boolean(initialData.enabled) : (index === 0);
    tdOn.appendChild(enableCheck);

    // 4. Note input + Note Name
    const tdNote = document.createElement('td');
    tdNote.className = 'td-note';
    const noteWrap = document.createElement('div');
    noteWrap.className = 'step-note-wrap';
    const noteInput = document.createElement('input');
    noteInput.type = 'number';
    noteInput.min = '0';
    noteInput.max = '127';
    noteInput.className = 'step-note-input';
    noteInput.setAttribute('aria-label', `${where}: nota MIDI`);
    noteInput.value = initialData ? String(initialData.note) : String(48 + index);
    const noteLabel = document.createElement('span');
    noteLabel.className = 'step-note-label';
    noteLabel.setAttribute('aria-hidden', 'true');
    noteLabel.textContent = midiNoteToName(Number(noteInput.value));
    noteWrap.append(noteInput, noteLabel);
    tdNote.appendChild(noteWrap);

    // 5. Target Selector (Segmented buttons)
    const tdDest = document.createElement('td');
    tdDest.className = 'td-dest';
    const destGroup = document.createElement('div');
    destGroup.className = 'step-segmented-group';
    destGroup.setAttribute('role', 'group');
    destGroup.setAttribute('aria-label', `${where}: destino`);
    let currentTarget = initialData?.target || this.options.targets[0].id;
    const destButtons = [];

    this.options.targets.forEach((tgt) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'step-seg-btn';
      btn.dataset.id = tgt.id;
      btn.textContent = tgt.label;
      btn.setAttribute('aria-pressed', String(tgt.id === currentTarget));
      if (tgt.id === currentTarget) btn.classList.add('active');
      destGroup.appendChild(btn);
      destButtons.push(btn);
    });
    tdDest.appendChild(destGroup);

    // 6. Value Slider + Display
    const tdVal = document.createElement('td');
    tdVal.className = 'td-val';
    const valWrap = document.createElement('div');
    valWrap.className = 'step-val-wrap';
    const valRange = document.createElement('input');
    valRange.type = 'range';
    valRange.className = 'step-val-slider';
    valRange.setAttribute('aria-label', `${where}: valor`);
    const rangeCfg = this.options.targetRange(currentTarget);
    valRange.min = String(rangeCfg.min);
    valRange.max = String(rangeCfg.max);
    valRange.step = String(rangeCfg.step);
    valRange.value = initialData ? String(initialData.value) : (currentTarget === 'latch_write' ? '18' : '1.0');
    const valDisplay = document.createElement('output');
    valDisplay.className = 'step-val-output';
    valDisplay.textContent = this.options.formatValue(currentTarget, valRange.value);
    valWrap.append(valRange, valDisplay);
    tdVal.appendChild(valWrap);

    // 7. Probability
    const tdProb = document.createElement('td');
    tdProb.className = 'td-prob';
    const probWrap = document.createElement('div');
    probWrap.className = 'step-prob-wrap';
    const probRange = document.createElement('input');
    probRange.type = 'range';
    probRange.min = '0';
    probRange.max = '1';
    probRange.step = '0.01';
    probRange.className = 'step-prob-slider';
    probRange.setAttribute('aria-label', `${where}: probabilidad`);
    probRange.value = initialData ? String(initialData.probability) : '1.0';
    const probDisplay = document.createElement('output');
    probDisplay.className = 'step-prob-output';
    probDisplay.textContent = `${Math.round(Number(probRange.value) * 100)}%`;
    probWrap.append(probRange, probDisplay);
    tdProb.appendChild(probWrap);

    // 8. Delay (ms)
    const tdDelay = document.createElement('td');
    tdDelay.className = 'td-delay';
    const delayWrap = document.createElement('div');
    delayWrap.className = 'step-delay-wrap';
    const delayInput = document.createElement('input');
    delayInput.type = 'number';
    delayInput.min = '0';
    delayInput.max = '5000';
    delayInput.step = '1';
    delayInput.className = 'step-delay-input';
    delayInput.setAttribute('aria-label', `${where}: retardo en milisegundos`);
    delayInput.value = initialData ? String(Math.round(initialData.delayMs)) : '0';
    const delayUnit = document.createElement('span');
    delayUnit.className = 'step-unit';
    delayUnit.setAttribute('aria-hidden', 'true');
    delayUnit.textContent = 'ms';
    delayWrap.append(delayInput, delayUnit);
    tdDelay.appendChild(delayWrap);

    // 9. Mutation Select
    const tdMut = document.createElement('td');
    tdMut.className = 'td-mut';
    const mutSelect = document.createElement('select');
    mutSelect.className = 'step-mut-select';
    mutSelect.setAttribute('aria-label', `${where}: mutación`);
    this.options.mutations.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m.toUpperCase();
      mutSelect.appendChild(opt);
    });
    mutSelect.value = initialData?.mutation || 'none';
    tdMut.appendChild(mutSelect);

    // 10. Mutation Amount
    const tdAmt = document.createElement('td');
    tdAmt.className = 'td-amt';
    const amtInput = document.createElement('input');
    amtInput.type = 'number';
    amtInput.min = '0';
    amtInput.step = '0.001';
    amtInput.className = 'step-amt-input';
    amtInput.setAttribute('aria-label', `${where}: cantidad de mutación`);
    amtInput.value = initialData ? String(initialData.mutationAmount) : (currentTarget === 'latch_write' ? '1' : '0.0625');
    tdAmt.appendChild(amtInput);

    tr.append(tdStep, tdTrig, tdOn, tdNote, tdDest, tdVal, tdProb, tdDelay, tdMut, tdAmt);
    this.tbody.appendChild(tr);

    const refs = {
      tr, trigLed, enableCheck, noteInput, noteLabel, currentTarget, destButtons,
      valRange, valDisplay, probRange, probDisplay, delayInput, mutSelect, amtInput
    };
    this.rowElements[index] = refs;

    // Dispatcher
    const notifyChange = () => {
      const payload = this.rowData(index);
      noteLabel.textContent = midiNoteToName(payload.note);
      valDisplay.textContent = this.options.formatValue(payload.target, payload.value);
      probDisplay.textContent = `${Math.round(payload.probability * 100)}%`;
      tr.classList.toggle('step-row-disabled', !payload.enabled);
      this.options.onChange(index, payload);
    };

    // Event listeners
    enableCheck.addEventListener('change', notifyChange);
    noteInput.addEventListener('input', () => {
      noteLabel.textContent = midiNoteToName(Number(noteInput.value));
    });
    noteInput.addEventListener('change', notifyChange);

    destButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        if (refs.currentTarget === btn.dataset.id) return;
        refs.currentTarget = btn.dataset.id;
        destButtons.forEach((b) => {
          const isActive = b === btn;
          b.classList.toggle('active', isActive);
          b.setAttribute('aria-pressed', String(isActive));
        });
        const r = this.options.targetRange(refs.currentTarget);
        valRange.min = String(r.min);
        valRange.max = String(r.max);
        valRange.step = String(r.step);
        valRange.value = refs.currentTarget === 'latch_write' ? '18' : '1.0';
        amtInput.value = refs.currentTarget === 'latch_write' ? '1' : '0.0625';
        notifyChange();
      });
    });

    valRange.addEventListener('input', () => {
      valDisplay.textContent = this.options.formatValue(refs.currentTarget, valRange.value);
    });
    valRange.addEventListener('change', notifyChange);

    probRange.addEventListener('input', () => {
      probDisplay.textContent = `${Math.round(Number(probRange.value) * 100)}%`;
    });
    probRange.addEventListener('change', notifyChange);

    delayInput.addEventListener('change', notifyChange);
    mutSelect.addEventListener('change', notifyChange);
    amtInput.addEventListener('change', notifyChange);

    tr.classList.toggle('step-row-disabled', !enableCheck.checked);
  }

  /** Current payload of one row, in the same shape `setRows` and `onChange` use. */
  rowData(index) {
    const refs = this.rowElements[index];
    if (!refs) return null;
    return {
      enabled: refs.enableCheck.checked,
      note: Number(refs.noteInput.value),
      target: refs.currentTarget,
      value: Number(refs.valRange.value),
      probability: Number(refs.probRange.value),
      delayMs: Number(refs.delayInput.value),
      mutation: refs.mutSelect.value,
      mutationAmount: Number(refs.amtInput.value)
    };
  }

  /** Every row in order. Rows that were never painted are left out. */
  getRows() {
    return this.rowElements
      .map((_, index) => this.rowData(index))
      .filter((row) => row !== null);
  }

  /**
   * Applies rows from the host. Rows beyond the painted ones are APPENDED (the
   * host does not have to know how many rows exist beforehand), and the element
   * that currently has the focus is never overwritten under the user's fingers.
   */
  setRows(rows) {
    if (!Array.isArray(rows)) return;
    const active = document.activeElement;

    rows.forEach((row, idx) => {
      if (!this.rowElements[idx]) this.buildRow(idx, row);
      const refs = this.rowElements[idx];

      refs.tr.classList.toggle('step-row-disabled', !row.enabled);
      if (active !== refs.enableCheck) refs.enableCheck.checked = Boolean(row.enabled);
      if (active !== refs.noteInput) refs.noteInput.value = String(row.note);
      refs.noteLabel.textContent = midiNoteToName(row.note);

      if (refs.currentTarget !== row.target) {
        refs.currentTarget = row.target;
        refs.destButtons.forEach((b) => {
          const isActive = b.dataset.id === row.target;
          b.classList.toggle('active', isActive);
          b.setAttribute('aria-pressed', String(isActive));
        });
        const r = this.options.targetRange(row.target);
        refs.valRange.min = String(r.min);
        refs.valRange.max = String(r.max);
        refs.valRange.step = String(r.step);
      }

      if (active !== refs.valRange) refs.valRange.value = String(row.value);
      refs.valDisplay.textContent = this.options.formatValue(row.target, row.value);

      if (active !== refs.probRange) refs.probRange.value = String(row.probability);
      refs.probDisplay.textContent = `${Math.round(row.probability * 100)}%`;

      if (active !== refs.delayInput) refs.delayInput.value = String(Math.round(row.delayMs));
      if (active !== refs.mutSelect) refs.mutSelect.value = row.mutation;
      if (active !== refs.amtInput) refs.amtInput.value = String(row.mutationAmount);
    });
  }

  /** Flashes the row LED for 180 ms. Two calls inside that window restart it. */
  triggerStep(index) {
    const refs = this.rowElements[index];
    if (!refs) return;
    refs.tr.classList.add('step-triggered');
    refs.tr.dataset.triggered = 'true';
    refs.trigLed.classList.add('active');

    if (this.triggerTimers.has(index)) {
      clearTimeout(this.triggerTimers.get(index));
    }
    const timer = setTimeout(() => {
      refs.tr.classList.remove('step-triggered');
      delete refs.tr.dataset.triggered;
      refs.trigLed.classList.remove('active');
      this.triggerTimers.delete(index);
    }, 180);
    this.triggerTimers.set(index, timer);
  }

  destroy() {
    this.triggerTimers.forEach((timer) => clearTimeout(timer));
    this.triggerTimers.clear();
    this.rowElements = [];
    if (this.container) this.container.innerHTML = '';
  }
}
