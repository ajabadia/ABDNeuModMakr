/**
 * ABDShared — midiLearnDrawer.js
 * =========================================================================
 * Canonical Slide-Out View (`MidiLearnDrawer`) for inspecting, learning,
 * editing, importing, and exporting N:M MIDI Learn & CC/NRPN assignments
 * across the entire ABDSynths suite.
 *
 * Features:
 * - Live MIDI Input Activity Monitor (displays last received CC/NRPN, channel & value).
 * - Quick "+ Add Assignment" bar with searchable parameter picker and instant "Learn" trigger.
 * - Full N:M table of active assignments:
 *   - Source Type (CC / NRPN / Aftertouch / PitchBend)
 *   - Controller Number (0..127 / 0..16383)
 *   - MIDI Channel (Omni / Ch 1..16)
 *   - Target Synth Parameter (with group badge & Macro 1:N indicator when shared)
 *   - Min % / Max % range limits (0..100%)
 *   - Polarity Invert toggle (INV)
 *   - Response Curve selector (Linear / Exp / Log)
 *   - Re-Learn & Unlearn buttons per row
 * - Import (.json) / Export (.json) / Clear All actions.
 * - 100% tokenized with `--color-*`, `--space-*`, `--radius-*` (adapts to whatever theme
 *   the host synth selects) and monochrome SVGs from `CONTROL_ICONS` (zero emojis).
 */

import { CONTROL_ICONS } from '../icons.js';
import {
  MIDI_SOURCE_TYPES,
  MIDI_CURVE_TYPES,
  formatMidiSourceBadge,
} from './midiLearnStore.js';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Creates the DOM content for the canonical MIDI Learn Drawer.
 *
 * @param {object} options
 * @param {ReturnType<import('./midiLearnStore.js').createMidiLearnStore>} options.store
 * @param {Array<{ index: number, name: string, group?: string, key?: string }>} [options.parameters=[]]
 * @param {number} [options.focusParamIndex=-1]
 * @param {string} [options.synthName='ABDSynths']
 * @param {Function} [options.onClose]
 * @returns {HTMLElement}
 */
export function createMidiLearnDrawerContent(options = {}) {
  const {
    store,
    parameters = [],
    focusParamIndex = -1,
    synthName = 'ABDSynths',
    onClose = null,
  } = options;

  const root = document.createElement('div');
  root.className = 'drawer-view-content abd-midi-drawer';
  root.style.cssText = 'display: flex; flex-direction: column; gap: var(--space-3); height: 100%;';

  let filterQuery = '';
  let selectedNewParamIdx = focusParamIndex >= 0
    ? focusParamIndex
    : (parameters[0]?.index ?? 274);

  const paramMap = new Map();
  for (const p of parameters) {
    paramMap.set(p.index, p);
  }

  function getParamLabel(idx, keyFallback = '') {
    const found = paramMap.get(idx);
    if (found) {
      const grp = found.group ? `${found.group} · ` : '';
      return `${grp}${found.name} [${idx}]`;
    }
    return keyFallback ? `${keyFallback} [${idx}]` : `Parameter [${idx}]`;
  }

  function renderParamOptionsHtml(selectedIdx) {
    if (!parameters.length) {
      return `<option value="${selectedIdx}">Parameter [${selectedIdx}]</option>`;
    }
    return parameters
      .map((p) => {
        const grp = p.group ? `${p.group} · ` : '';
        const sel = p.index === selectedIdx ? 'selected' : '';
        return `<option value="${p.index}" ${sel}>${escapeHtml(`${grp}${p.name} [${p.index}]`)}</option>`;
      })
      .join('');
  }

  root.innerHTML = `
    <div class="drawer-header ndb-modal-header">
      <div class="drawer-title ndb-header-title" style="display: flex; align-items: center; gap: var(--space-2);">
        <span class="drawer-icon">${CONTROL_ICONS.midiDin}</span>
        <span class="ndb-title-text">MIDI LEARN &amp; CC / NRPN MAPPING MATRIX</span>
        <span class="hud-pill stat-num" id="ml-drawer-count-badge">0 MAPPINGS</span>
      </div>
      <div class="drawer-header-actions" style="display: flex; align-items: center; gap: var(--space-2);">
        <button type="button" class="btn btn-xs btn-outline" id="btn-ml-overlay-toggle" title="Highlight all mappable controls on the synth panel">
          ${CONTROL_ICONS.target} <span>Panel Badges</span>
        </button>
        <button type="button" class="btn btn-xs btn-outline" id="btn-ml-import" title="Import MIDI Map (.json)">
          ${CONTROL_ICONS.upload} <span>Import</span>
        </button>
        <button type="button" class="btn btn-xs btn-outline" id="btn-ml-export" title="Export MIDI Map (.json)">
          ${CONTROL_ICONS.download} <span>Export</span>
        </button>
        <button type="button" class="btn btn-xs btn-outline" id="btn-ml-clear-all" title="Clear all MIDI Learn mappings">
          ${CONTROL_ICONS.trash} <span>Clear All</span>
        </button>
        <button type="button" class="btn btn-close-drawer ndb-close-btn" id="btn-ml-close" title="Close (Esc)">
          ${CONTROL_ICONS.close}
        </button>
      </div>
    </div>

    <!-- Top Status & Quick Add Bar -->
    <div class="synth-panel-card abd-midi-drawer__toolbar" style="padding: var(--space-3); display: flex; flex-direction: column; gap: var(--space-3);">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: var(--space-2);">
        <div class="abd-midi-activity-pill" id="ml-last-activity">
          <span class="abd-midi-activity-dot"></span>
          <span class="hud-label">LAST MIDI IN:</span>
          <span class="hud-value stat-num" id="ml-last-activity-text">Move any hardware knob, wheel or slider...</span>
        </div>
        <div id="ml-learning-banner" class="abd-midi-learning-banner" style="display: none;">
          <span class="abd-midi-learning-banner__pulse"></span>
          <span id="ml-learning-banner-text">Waiting for hardware controller...</span>
          <button type="button" class="btn btn-xs btn-outline" id="btn-ml-cancel-learn">Cancel</button>
        </div>
      </div>

      <div class="abd-midi-drawer__quick-add" style="display: grid; grid-template-columns: 1fr auto auto auto; gap: var(--space-2); align-items: center;">
        <select id="ml-quick-param-select" class="abd-select__field" aria-label="Target parameter to map">
          ${renderParamOptionsHtml(selectedNewParamIdx)}
        </select>
        <button type="button" class="btn btn-xs btn-primary" id="btn-ml-quick-learn" title="Put selected parameter in MIDI Learn mode and move a hardware control">
          ${CONTROL_ICONS.target} <span>Learn Hardware Move</span>
        </button>
        <button type="button" class="btn btn-xs btn-outline" id="btn-ml-quick-add-manual" title="Add manual CC mapping row for selected parameter">
          ${CONTROL_ICONS.plus} <span>Add Manual Row</span>
        </button>
        <div class="abd-midi-search-box" style="position: relative; display: flex; align-items: center;">
          <input type="search" id="ml-filter-input" class="abd-select__field" placeholder="Filter mappings..." style="padding-left: 24px; width: 155px;" />
          <span style="position: absolute; left: 7px; pointer-events: none; opacity: 0.6; display: flex;">${CONTROL_ICONS.search}</span>
        </div>
      </div>
    </div>

    <!-- Scrollable N:M Mapping Table -->
    <div class="drawer-scroll-body abd-midi-drawer__list" id="ml-mappings-list" style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: var(--space-2); padding-right: 4px;">
    </div>
  `;

  const listEl = root.querySelector('#ml-mappings-list');
  const countBadgeEl = root.querySelector('#ml-drawer-count-badge');
  const activityTextEl = root.querySelector('#ml-last-activity-text');
  const activityPillEl = root.querySelector('#ml-last-activity');
  const learningBannerEl = root.querySelector('#ml-learning-banner');
  const learningBannerTextEl = root.querySelector('#ml-learning-banner-text');
  const overlayToggleBtn = root.querySelector('#btn-ml-overlay-toggle');
  const quickParamSelect = root.querySelector('#ml-quick-param-select');
  const filterInput = root.querySelector('#ml-filter-input');

  function renderTable() {
    if (!store || !listEl) return;
    const state = store.getState();

    if (countBadgeEl) {
      countBadgeEl.textContent = `${state.mappings.length} ${state.mappings.length === 1 ? 'MAPPING' : 'MAPPINGS'}`;
    }

    if (overlayToggleBtn) {
      overlayToggleBtn.classList.toggle('btn-primary', Boolean(state.globalOverlayActive));
      overlayToggleBtn.classList.toggle('active', Boolean(state.globalOverlayActive));
      overlayToggleBtn.classList.toggle('btn-outline', !state.globalOverlayActive);
    }

    if (state.lastActivity && activityTextEl) {
      const badge = formatMidiSourceBadge(state.lastActivity);
      const ch = `Ch ${state.lastActivity.channel || 1}`;
      const val = state.lastActivity.rawValue ?? Math.round((state.lastActivity.normalizedValue || 0) * 127);
      activityTextEl.textContent = `${badge} · ${ch} · Value ${val}`;
      activityPillEl?.classList.add('is-active');
    }

    if (learningBannerEl && learningBannerTextEl) {
      if (state.isLearning) {
        const lbl = getParamLabel(state.learningTargetIndex, state.learningTargetKey);
        const modeTxt = state.learnMode === 'add' ? 'ADD MACRO / N:1' : 'REPLACE';
        const secTxt = state.learnRemainingSeconds > 0 ? ` (${state.learnRemainingSeconds}s)` : '';
        learningBannerTextEl.innerHTML = `${CONTROL_ICONS.clock || ''} <span>Listening (${escapeHtml(modeTxt)}) for <strong>${escapeHtml(lbl)}</strong> — move any MIDI controller...<strong>${secTxt}</strong></span>`;
        learningBannerEl.style.display = 'flex';
      } else {
        learningBannerEl.style.display = 'none';
      }
    }

    const q = filterQuery.trim().toLowerCase();
    const filtered = state.mappings.filter((m) => {
      if (!q) return true;
      const pLabel = getParamLabel(m.targetIndex, m.targetKey).toLowerCase();
      const sBadge = formatMidiSourceBadge(m).toLowerCase();
      return pLabel.includes(q) || sBadge.includes(q);
    });

    if (filtered.length === 0) {
      listEl.innerHTML = `
        <div class="synth-panel-card abd-midi-empty-state" style="padding: var(--space-6); text-align: center; display: flex; flex-direction: column; align-items: center; gap: var(--space-2);">
          <div style="opacity: 0.65; transform: scale(1.4); margin-bottom: 4px;">${CONTROL_ICONS.midiDin}</div>
          <div style="font-weight: 700; color: var(--color-text-main); font-size: var(--text-base);">
            ${state.mappings.length === 0 ? 'No Active MIDI Learn Assignments' : 'No Mappings Match Your Filter'}
          </div>
          <div style="color: var(--color-text-muted); font-size: var(--text-sm); max-width: 480px; line-height: 1.4;">
            Right-click any Knob, Wheel, Slider or 2D Vector Stick on the synthesizer panel and choose
            <strong>Learn MIDI Assignment</strong>, or select a parameter above and click <strong>Learn Hardware Move</strong>.
            Many-to-many (N:M) routing is supported: assign one physical CC to multiple parameters (Macro) or multiple CCs to one parameter.
          </div>
        </div>
      `;
      return;
    }

    // Count shared sources (1:N Macro) and shared targets (N:1)
    const sourceCounts = new Map();
    const targetCounts = new Map();
    for (const m of state.mappings) {
      const sKey = `${m.sourceType}:${m.number}`;
      sourceCounts.set(sKey, (sourceCounts.get(sKey) || 0) + 1);
      targetCounts.set(m.targetIndex, (targetCounts.get(m.targetIndex) || 0) + 1);
    }

    listEl.innerHTML = filtered
      .map((m) => {
        const sKey = `${m.sourceType}:${m.number}`;
        const sharedSourceCount = sourceCounts.get(sKey) || 1;
        const sharedTargetCount = targetCounts.get(m.targetIndex) || 1;
        const isRowLearning = state.isLearning && state.learningTargetIndex === m.targetIndex;
        const minPct = Math.round((m.minNorm ?? 0) * 100);
        const maxPct = Math.round((m.maxNorm ?? 1) * 100);

        let channelOpts = `<option value="0" ${m.channel === 0 ? 'selected' : ''}>Omni (All)</option>`;
        for (let ch = 1; ch <= 16; ch++) {
          channelOpts += `<option value="${ch}" ${m.channel === ch ? 'selected' : ''}>Ch ${ch}</option>`;
        }

        const macroBadge = sharedSourceCount > 1
          ? `<span class="hud-pill abd-midi-tag-macro" title="This MIDI controller modulates ${sharedSourceCount} parameters simultaneously (1:N Macro)">1:${sharedSourceCount} MACRO</span>`
          : '';
        const multiCtrlBadge = sharedTargetCount > 1
          ? `<span class="hud-pill abd-midi-tag-multi" title="${sharedTargetCount} different MIDI controllers are bound to this parameter (N:1)">${sharedTargetCount}:1 MULTI</span>`
          : '';

        return `
          <div class="synth-panel-card abd-midi-row ${isRowLearning ? 'is-row-learning' : ''}" data-row-id="${escapeHtml(m.id)}">
            <div class="abd-midi-row__top">
              <!-- Source Type + Number + Channel -->
              <div class="abd-midi-row__source-group">
                <span class="hud-pill abd-midi-source-badge">${escapeHtml(formatMidiSourceBadge(m))}</span>
                <select class="abd-select__field ml-row-source-type" data-id="${escapeHtml(m.id)}" aria-label="MIDI Source Type" style="width: 78px;">
                  <option value="${MIDI_SOURCE_TYPES.CC}" ${m.sourceType === MIDI_SOURCE_TYPES.CC ? 'selected' : ''}>CC</option>
                  <option value="${MIDI_SOURCE_TYPES.NRPN}" ${m.sourceType === MIDI_SOURCE_TYPES.NRPN ? 'selected' : ''}>NRPN</option>
                  <option value="${MIDI_SOURCE_TYPES.AFTERTOUCH}" ${m.sourceType === MIDI_SOURCE_TYPES.AFTERTOUCH ? 'selected' : ''}>Aftertouch</option>
                  <option value="${MIDI_SOURCE_TYPES.PITCH_BEND}" ${m.sourceType === MIDI_SOURCE_TYPES.PITCH_BEND ? 'selected' : ''}>PitchBend</option>
                </select>
                <input type="number" class="abd-select__field ml-row-number stat-num" data-id="${escapeHtml(m.id)}"
                  min="0" max="${m.sourceType === MIDI_SOURCE_TYPES.NRPN ? 16383 : 127}" value="${m.number}"
                  ${m.sourceType >= 2 ? 'disabled' : ''}
                  title="Controller Number (CC 0..127 or NRPN 0..16383)" style="width: 64px; text-align: center;" />
                <select class="abd-select__field ml-row-channel" data-id="${escapeHtml(m.id)}" aria-label="MIDI Channel" style="width: 92px;">
                  ${channelOpts}
                </select>
              </div>

              <!-- Target Parameter Selector -->
              <div class="abd-midi-row__target-group" style="flex: 1; min-width: 180px; display: flex; align-items: center; gap: var(--space-2);">
                <select class="abd-select__field ml-row-target" data-id="${escapeHtml(m.id)}" style="flex: 1;">
                  ${renderParamOptionsHtml(m.targetIndex)}
                </select>
                ${macroBadge}
                ${multiCtrlBadge}
              </div>

              <!-- Row Actions: Re-Learn, Clone (Macro), Delete -->
              <div class="abd-midi-row__actions" style="display: flex; align-items: center; gap: 4px;">
                <button type="button" class="btn btn-xs ${isRowLearning ? 'btn-primary active' : 'btn-outline'} ml-row-relearn"
                  data-idx="${m.targetIndex}" data-key="${escapeHtml(m.targetKey)}" title="Re-learn hardware controller for this parameter">
                  ${isRowLearning ? (CONTROL_ICONS.clock || CONTROL_ICONS.target) : CONTROL_ICONS.target}
                  <span>${isRowLearning && state.learnRemainingSeconds > 0 ? `${state.learnRemainingSeconds}s...` : 'Learn'}</span>
                </button>
                <button type="button" class="btn btn-xs btn-outline ml-row-delete" data-id="${escapeHtml(m.id)}" title="Remove this MIDI mapping">
                  ${CONTROL_ICONS.trash}
                </button>
              </div>
            </div>

            <!-- Bottom Line: Range Min/Max, Invert & Curve -->
            <div class="abd-midi-row__bottom">
              <div class="abd-midi-row__range-cell">
                <span class="hud-label">MIN:</span>
                <input type="range" class="abd-slider ml-row-min" data-id="${escapeHtml(m.id)}" min="0" max="100" value="${minPct}" step="1" style="width: 85px;" />
                <span class="hud-value stat-num" style="min-width: 32px;">${minPct}%</span>
              </div>

              <div class="abd-midi-row__range-cell">
                <span class="hud-label">MAX:</span>
                <input type="range" class="abd-slider ml-row-max" data-id="${escapeHtml(m.id)}" min="0" max="100" value="${maxPct}" step="1" style="width: 85px;" />
                <span class="hud-value stat-num" style="min-width: 32px;">${maxPct}%</span>
              </div>

              <button type="button" class="btn btn-xs ${m.invert ? 'btn-primary active' : 'btn-outline'} ml-row-invert"
                data-id="${escapeHtml(m.id)}" title="Invert controller polarity (127 -> Min, 0 -> Max)">
                ${CONTROL_ICONS.invert} <span>INV</span>
              </button>

              <div class="abd-midi-row__range-cell">
                <span class="hud-label">CURVE:</span>
                <select class="abd-select__field ml-row-curve" data-id="${escapeHtml(m.id)}" style="width: 88px;">
                  <option value="${MIDI_CURVE_TYPES.LINEAR}" ${m.curve === MIDI_CURVE_TYPES.LINEAR ? 'selected' : ''}>Linear</option>
                  <option value="${MIDI_CURVE_TYPES.EXPONENTIAL}" ${m.curve === MIDI_CURVE_TYPES.EXPONENTIAL ? 'selected' : ''}>Exponential</option>
                  <option value="${MIDI_CURVE_TYPES.LOGARITHMIC}" ${m.curve === MIDI_CURVE_TYPES.LOGARITHMIC ? 'selected' : ''}>Logarithmic</option>
                </select>
              </div>
            </div>
          </div>
        `;
      })
      .join('');
  }

  // Event Listeners
  root.querySelector('#btn-ml-close')?.addEventListener('click', () => {
    onClose?.();
  });

  overlayToggleBtn?.addEventListener('click', () => {
    store?.toggleGlobalOverlay();
  });

  root.querySelector('#btn-ml-cancel-learn')?.addEventListener('click', () => {
    store?.cancelLearning();
  });

  quickParamSelect?.addEventListener('change', () => {
    selectedNewParamIdx = parseInt(quickParamSelect.value, 10);
  });

  root.querySelector('#btn-ml-quick-learn')?.addEventListener('click', () => {
    const p = paramMap.get(selectedNewParamIdx);
    store?.startLearning(selectedNewParamIdx, p?.key || `param_${selectedNewParamIdx}`, 'add');
  });

  root.querySelector('#btn-ml-quick-add-manual')?.addEventListener('click', () => {
    const p = paramMap.get(selectedNewParamIdx);
    const lastCC = store?.getState().lastActivity?.number ?? 74;
    store?.upsertMapping({
      sourceType: MIDI_SOURCE_TYPES.CC,
      channel: 0,
      number: lastCC,
      targetIndex: selectedNewParamIdx,
      targetKey: p?.key || `param_${selectedNewParamIdx}`,
      minNorm: 0,
      maxNorm: 1,
      invert: false,
      curve: MIDI_CURVE_TYPES.LINEAR,
    });
  });

  filterInput?.addEventListener('input', () => {
    filterQuery = filterInput.value || '';
    renderTable();
  });

  root.querySelector('#btn-ml-clear-all')?.addEventListener('click', () => {
    store?.clearAll();
  });

  root.querySelector('#btn-ml-export')?.addEventListener('click', () => {
    if (!store) return;
    const json = store.exportJson(synthName);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${synthName.toLowerCase()}-midi-learn.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  root.querySelector('#btn-ml-import')?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (file && store) {
        const text = await file.text();
        store.importJson(text);
      }
      input.remove();
    });
    input.click();
  });

  // Delegated listeners for table rows
  listEl?.addEventListener('change', (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const id = target.getAttribute('data-id');
    if (!id || !store) return;

    if (target.classList.contains('ml-row-source-type')) {
      store.updateMapping(id, { sourceType: parseInt(target.value, 10) });
    } else if (target.classList.contains('ml-row-number')) {
      store.updateMapping(id, { number: parseInt(target.value || '0', 10) });
    } else if (target.classList.contains('ml-row-channel')) {
      store.updateMapping(id, { channel: parseInt(target.value, 10) });
    } else if (target.classList.contains('ml-row-target')) {
      const nextIdx = parseInt(target.value, 10);
      const p = paramMap.get(nextIdx);
      store.updateMapping(id, { targetIndex: nextIdx, targetKey: p?.key || `param_${nextIdx}` });
    } else if (target.classList.contains('ml-row-min')) {
      store.updateMapping(id, { minNorm: parseInt(target.value, 10) / 100 });
    } else if (target.classList.contains('ml-row-max')) {
      store.updateMapping(id, { maxNorm: parseInt(target.value, 10) / 100 });
    } else if (target.classList.contains('ml-row-curve')) {
      store.updateMapping(id, { curve: parseInt(target.value, 10) });
    }
  });

  listEl?.addEventListener('click', (e) => {
    const btn = e.target instanceof HTMLElement ? e.target.closest('button') : null;
    if (!btn || !store) return;

    if (btn.classList.contains('ml-row-delete')) {
      const id = btn.getAttribute('data-id');
      if (id) store.removeMapping(id);
    } else if (btn.classList.contains('ml-row-invert')) {
      const id = btn.getAttribute('data-id');
      const current = store.getState().mappings.find((m) => m.id === id);
      if (current) {
        store.updateMapping(id, { invert: !current.invert });
      }
    } else if (btn.classList.contains('ml-row-relearn')) {
      const idx = parseInt(btn.getAttribute('data-idx') || '-1', 10);
      const key = btn.getAttribute('data-key') || '';
      if (idx >= 0) {
        store.startLearning(idx, key, 'replace');
      }
    }
  });

  const unsubscribe = store ? store.subscribe(() => renderTable()) : () => {};
  renderTable();

  // Attach cleanup hook on element
  root._destroyMidiLearnDrawer = () => {
    unsubscribe();
  };

  return root;
}

