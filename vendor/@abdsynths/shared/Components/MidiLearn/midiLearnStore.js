/**
 * ABDShared — midiLearnStore.js
 * =========================================================================
 * Canonical N:M (Many-to-Many) MIDI Learn & Controller Assignment Store
 * for the entire ABDSynths suite (ABDAxionikVS, ABDJUNiO601, ABDCZ101,
 * ABDEep, ABDMS2000, ABDAudioLab).
 *
 * Key Capabilities:
 * - Many-to-Many (N:M) routing:
 *   1. One physical CC/NRPN can control multiple synth parameters at once (Macro 1:N),
 *      each with independent minNorm, maxNorm, invert polarity, and response curve.
 *   2. Multiple physical CCs/NRPNs can control the same synth parameter (N:1).
 * - Two explicit learning modes:
 *   - 'replace': replaces existing bindings on the target parameter.
 *   - 'add': adds a new binding to the target parameter (preserving existing ones).
 * - Protected CC filtering (CC 6, 38, 98, 99, 100, 101, 120, 121, 123).
 * - Optional localStorage persistence + bidirectional C++ host synchronization.
 * - Full JSON import/export for sharing controller maps.
 */

export const MIDI_SOURCE_TYPES = {
  CC: 0,
  NRPN: 1,
  AFTERTOUCH: 2,
  PITCH_BEND: 3,
};

export const MIDI_CURVE_TYPES = {
  LINEAR: 0,
  EXPONENTIAL: 1,
  LOGARITHMIC: 2,
};

export const PROTECTED_CCS = new Set([6, 38, 98, 99, 100, 101, 120, 121, 123]);

const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

/**
 * Formats a MIDI source into a compact badge string (e.g. "CC 74", "NRPN 1:12", "AT", "PB").
 * @param {object} mapping
 * @returns {string}
 */
export function formatMidiSourceBadge(mapping) {
  if (!mapping) return '';
  const srcType = Number(mapping.sourceType ?? 0);
  const num = Number(mapping.number ?? 0);
  if (srcType === MIDI_SOURCE_TYPES.NRPN) {
    const msb = (num >> 7) & 0x7f;
    const lsb = num & 0x7f;
    return `NRPN ${msb}:${lsb}`;
  }
  if (srcType === MIDI_SOURCE_TYPES.AFTERTOUCH) return 'AT';
  if (srcType === MIDI_SOURCE_TYPES.PITCH_BEND) return 'PB';
  return `CC ${String(num).padStart(2, '0')}`;
}

/**
 * Formats a detailed tooltip description for a mapping.
 * @param {object} mapping
 * @returns {string}
 */
export function formatMidiMappingSummary(mapping) {
  const badge = formatMidiSourceBadge(mapping);
  const ch = Number(mapping.channel ?? 0) === 0 ? 'Omni' : `Ch ${mapping.channel}`;
  const minPct = Math.round(clamp01(mapping.minNorm ?? 0) * 100);
  const maxPct = Math.round(clamp01(mapping.maxNorm ?? 1) * 100);
  const inv = mapping.invert ? ' · INV' : '';
  return `${badge} (${ch}) · ${minPct}%..${maxPct}%${inv}`;
}

/**
 * Evaluates a normalized 0..1 MIDI input value through a mapping's range, polarity and curve.
 * @param {object} mapping
 * @param {number} inputNorm01
 * @returns {number} Evaluated normalized parameter value [0..1]
 */
export function evaluateMidiMapping(mapping, inputNorm01) {
  let x = clamp01(inputNorm01);
  if (mapping.invert) {
    x = 1 - x;
  }
  const curve = Number(mapping.curve ?? 0);
  if (curve === MIDI_CURVE_TYPES.EXPONENTIAL) {
    x = x * x;
  } else if (curve === MIDI_CURVE_TYPES.LOGARITHMIC) {
    x = Math.sqrt(x);
  }
  const minN = clamp01(mapping.minNorm ?? 0);
  const maxN = clamp01(mapping.maxNorm ?? 1);
  return clamp01(minN + x * (maxN - minN));
}

/**
 * Creates a reactive N:M MIDI Learn store.
 *
 * @param {object} [options]
 * @param {boolean} [options.persist=true]            Persist mappings in localStorage.
 * @param {string}  [options.storageKey='abd.midiLearn'] Key used in localStorage.
 * @param {number}  [options.learnTimeoutMs=10000]    Auto-cancel waiting state if no MIDI control is moved within this time (0 = disabled).
 * @param {Function} [options.onSyncToHost]           Called with `{ mappings, learning }` when state mutates locally.
 * @param {Function} [options.onApplyParam]           Called with `(targetIndex, targetKey, normVal)` when JS evaluates a MIDI message.
 */
export function createMidiLearnStore(options = {}) {
  const {
    persist = true,
    storageKey = 'abd.midiLearn.v1',
    learnTimeoutMs = 10000,
    onSyncToHost = null,
    onApplyParam = null,
  } = options;

  /** @type {Array<object>} */
  let mappings = [];
  let learningTargetIndex = -1;
  let learningTargetKey = '';
  /** @type {'none' | 'replace' | 'add'} */
  let learnMode = 'none';
  let learnTimerId = null;
  let learnCountdownIntervalId = null;
  let learnRemainingSeconds = 0;
  let globalOverlayActive = false;
  let idSeq = 1;
  let lastActivity = null;

  function clearLearnTimer() {
    if (learnTimerId !== null) {
      clearTimeout(learnTimerId);
      learnTimerId = null;
    }
    if (learnCountdownIntervalId !== null) {
      clearInterval(learnCountdownIntervalId);
      learnCountdownIntervalId = null;
    }
    learnRemainingSeconds = 0;
  }

  function armLearnTimer() {
    clearLearnTimer();
    if (learnTimeoutMs > 0) {
      learnRemainingSeconds = Math.max(1, Math.ceil(learnTimeoutMs / 1000));
      learnCountdownIntervalId = setInterval(() => {
        if (learnRemainingSeconds > 1) {
          learnRemainingSeconds -= 1;
          notify(false);
        }
      }, 1000);
      learnTimerId = setTimeout(() => {
        clearLearnTimer();
        if (learnMode !== 'none' || learningTargetIndex >= 0 || learningTargetKey) {
          learningTargetIndex = -1;
          learningTargetKey = '';
          learnMode = 'none';
          notify(true);
        }
      }, learnTimeoutMs);
    }
  }

  /** @type {Set<Function>} */
  const listeners = new Set();

  function nextId() {
    idSeq += 1;
    return `ml_${Date.now().toString(36)}_${idSeq}`;
  }

  function sanitizeMapping(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const targetIndex = Number.isFinite(Number(raw.targetIndex)) ? Math.round(Number(raw.targetIndex)) : -1;
    const targetKey = typeof raw.targetKey === 'string' ? raw.targetKey : '';
    if (targetIndex < 0 && !targetKey) return null;

    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id : nextId(),
      sourceType: Math.max(0, Math.min(3, Math.round(Number(raw.sourceType ?? 0)))),
      channel: Math.max(0, Math.min(16, Math.round(Number(raw.channel ?? 0)))),
      number: Math.max(0, Math.min(16383, Math.round(Number(raw.number ?? 74)))),
      targetIndex,
      targetKey,
      minNorm: clamp01(Number(raw.minNorm ?? 0)),
      maxNorm: clamp01(Number(raw.maxNorm ?? 1)),
      invert: Boolean(raw.invert),
      curve: Math.max(0, Math.min(2, Math.round(Number(raw.curve ?? 0)))),
    };
  }

  function saveToStorage() {
    if (!persist || typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(mappings));
    } catch (_err) {
      // Ignore storage quota / private browsing errors
    }
  }

  function loadFromStorage() {
    if (!persist || typeof localStorage === 'undefined') return;
    try {
      const text = localStorage.getItem(storageKey);
      if (!text) return;
      const parsed = JSON.parse(text);
      const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.mappings) ? parsed.mappings : []);
      mappings = list.map(sanitizeMapping).filter(Boolean);
    } catch (_err) {
      mappings = [];
    }
  }

  function notify(syncHost = true) {
    if (syncHost) {
      saveToStorage();
      if (typeof onSyncToHost === 'function') {
        onSyncToHost({
          mappings: mappings.map((m) => ({ ...m })),
          learningTargetIndex,
          learningTargetKey,
          learnMode,
        });
      }
    }
    const snapshot = getState();
    for (const fn of listeners) {
      try {
        fn(snapshot);
      } catch (err) {
        console.error('[MidiLearnStore listener error]', err);
      }
    }
  }

  function getState() {
    return {
      mappings: mappings.map((m) => ({ ...m })),
      learningTargetIndex,
      learningTargetKey,
      learnMode,
      isLearning: learnMode !== 'none' && (learningTargetIndex >= 0 || Boolean(learningTargetKey)),
      learnRemainingSeconds,
      globalOverlayActive,
      lastActivity: lastActivity ? { ...lastActivity } : null,
    };
  }

  loadFromStorage();

  return {
    getState,

    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      listener(getState());
      return () => listeners.delete(listener);
    },

    /**
     * Starts interactive MIDI Learn for a parameter.
     * @param {number} targetIndex
     * @param {string} [targetKey='']
     * @param {'replace'|'add'} [mode='replace']
     */
    startLearning(targetIndex, targetKey = '', mode = 'replace') {
      learningTargetIndex = Number.isFinite(Number(targetIndex)) ? Math.round(Number(targetIndex)) : -1;
      learningTargetKey = String(targetKey || '');
      learnMode = mode === 'add' ? 'add' : 'replace';
      armLearnTimer();
      notify(true);
    },

    cancelLearning() {
      clearLearnTimer();
      if (learnMode === 'none' && learningTargetIndex === -1 && !learningTargetKey) return;
      learningTargetIndex = -1;
      learningTargetKey = '';
      learnMode = 'none';
      notify(true);
    },

    setGlobalOverlayActive(active) {
      const next = Boolean(active);
      if (globalOverlayActive === next) return;
      globalOverlayActive = next;
      if (!next && learnMode !== 'none') {
        clearLearnTimer();
        learningTargetIndex = -1;
        learningTargetKey = '';
        learnMode = 'none';
      }
      notify(false);
    },

    toggleGlobalOverlay() {
      this.setGlobalOverlayActive(!globalOverlayActive);
      return globalOverlayActive;
    },

    /**
     * Returns all mappings targeting a given parameter index or key.
     */
    getMappingsForTarget(targetIndex, targetKey = '') {
      const idx = Number.isFinite(Number(targetIndex)) ? Math.round(Number(targetIndex)) : -1;
      return mappings.filter((m) => (idx >= 0 && m.targetIndex === idx) || (targetKey && m.targetKey === targetKey));
    },

    /**
     * Returns all mappings driven by a given MIDI source (useful to see 1:N macro assignments).
     */
    getMappingsForSource(sourceType, number, channel = 0) {
      return mappings.filter(
        (m) =>
          m.sourceType === sourceType &&
          m.number === number &&
          (channel === 0 || m.channel === 0 || m.channel === channel)
      );
    },

    /**
     * Adds or updates a mapping entry.
     */
    upsertMapping(entry) {
      const clean = sanitizeMapping(entry);
      if (!clean) return null;
      const existingIdx = mappings.findIndex((m) => m.id === clean.id);
      if (existingIdx >= 0) {
        mappings[existingIdx] = clean;
      } else {
        mappings.push(clean);
      }
      notify(true);
      return clean;
    },

    /**
     * Updates partial properties of an existing mapping by ID.
     */
    updateMapping(id, patch) {
      const idx = mappings.findIndex((m) => m.id === id);
      if (idx < 0) return false;
      const merged = sanitizeMapping({ ...mappings[idx], ...patch, id });
      if (!merged) return false;
      mappings[idx] = merged;
      notify(true);
      return true;
    },

    /**
     * Removes a single mapping by its unique ID.
     */
    removeMapping(id) {
      const before = mappings.length;
      mappings = mappings.filter((m) => m.id !== id);
      if (mappings.length !== before) {
        notify(true);
        return true;
      }
      return false;
    },

    /**
     * Unbinds all mappings for a specific target parameter.
     */
    unbindTarget(targetIndex, targetKey = '') {
      const idx = Number.isFinite(Number(targetIndex)) ? Math.round(Number(targetIndex)) : -1;
      const before = mappings.length;
      mappings = mappings.filter(
        (m) => !((idx >= 0 && m.targetIndex === idx) || (targetKey && m.targetKey === targetKey))
      );
      if (mappings.length !== before) {
        notify(true);
        return true;
      }
      return false;
    },

    /**
     * Clears all mappings in the store.
     */
    clearAll() {
      clearLearnTimer();
      mappings = [];
      learningTargetIndex = -1;
      learningTargetKey = '';
      learnMode = 'none';
      notify(true);
    },

    /**
     * Processes an incoming MIDI control message (from WebMIDI, UI test or C++ bridge).
     */
    handleIncomingMidi({
      sourceType = MIDI_SOURCE_TYPES.CC,
      channel = 1,
      number = 0,
      rawValue = 0,
      normalizedValue = undefined,
    }) {
      if (sourceType === MIDI_SOURCE_TYPES.CC && PROTECTED_CCS.has(number)) {
        return { consumed: false };
      }

      const norm = normalizedValue !== undefined ? clamp01(normalizedValue) : clamp01(rawValue / 127);
      lastActivity = {
        sourceType,
        channel,
        number,
        rawValue,
        normalizedValue: norm,
        timestamp: Date.now(),
      };

      // 1. Learning active?
      if (learnMode !== 'none' && (learningTargetIndex >= 0 || learningTargetKey)) {
        const targetIdx = learningTargetIndex;
        const targetK = learningTargetKey;

        if (learnMode === 'replace') {
          mappings = mappings.filter(
            (m) => !((targetIdx >= 0 && m.targetIndex === targetIdx) || (targetK && m.targetKey === targetK))
          );
        }

        const duplicate = mappings.find(
          (m) =>
            ((targetIdx >= 0 && m.targetIndex === targetIdx) || (targetK && m.targetKey === targetK)) &&
            m.sourceType === sourceType &&
            m.number === number &&
            (m.channel === 0 || m.channel === channel)
        );

        let created = duplicate;
        if (!duplicate) {
          created = sanitizeMapping({
            id: nextId(),
            sourceType,
            channel: 0, // Default to Omni so any MIDI channel works seamlessly
            number,
            targetIndex: targetIdx,
            targetKey: targetK,
            minNorm: 0,
            maxNorm: 1,
            invert: false,
            curve: MIDI_CURVE_TYPES.LINEAR,
          });
          if (created) mappings.push(created);
        }

        clearLearnTimer();
        learningTargetIndex = -1;
        learningTargetKey = '';
        learnMode = 'none';
        notify(true);
        return { consumed: true, learned: created };
      }

      // 2. Evaluate active N:M mappings
      const matched = mappings.filter(
        (m) => m.sourceType === sourceType && m.number === number && (m.channel === 0 || m.channel === channel)
      );

      if (matched.length === 0) {
        notify(false);
        return { consumed: false };
      }

      const evaluated = [];
      for (const m of matched) {
        const outNorm = evaluateMidiMapping(m, norm);
        evaluated.push({ mapping: m, normalizedValue: outNorm });
        if (typeof onApplyParam === 'function') {
          onApplyParam(m.targetIndex, m.targetKey, outNorm);
        }
      }
      notify(false);
      return { consumed: true, evaluated };
    },

    /**
     * Synchronizes state received from the native C++ backend without echoing back.
     */
    syncFromHost(payload) {
      if (!payload || typeof payload !== 'object') return;
      if (Array.isArray(payload.mappings)) {
        mappings = payload.mappings.map(sanitizeMapping).filter(Boolean);
      }
      if (typeof payload.learningTargetIndex === 'number') {
        learningTargetIndex = payload.learningTargetIndex;
      }
      if (typeof payload.learningTargetKey === 'string') {
        learningTargetKey = payload.learningTargetKey;
      }
      if (typeof payload.learnMode === 'number') {
        learnMode = payload.learnMode === 2 ? 'add' : payload.learnMode === 1 ? 'replace' : 'none';
      } else if (typeof payload.learnMode === 'string') {
        learnMode = payload.learnMode;
      }
      if (learnMode === 'none') {
        clearLearnTimer();
      }
      saveToStorage();
      notify(false);
    },

    /**
     * Records last MIDI activity telemetry from C++ host.
     */
    recordActivity(activity) {
      if (!activity || typeof activity !== 'object') return;
      lastActivity = {
        sourceType: Number(activity.sourceType ?? 0),
        channel: Number(activity.channel ?? 1),
        number: Number(activity.number ?? 0),
        rawValue: Number(activity.rawValue ?? 0),
        normalizedValue: clamp01(Number(activity.normalizedValue ?? 0)),
        timestamp: Date.now(),
      };
      notify(false);
    },

    /**
     * Exports the current mappings to a formatted JSON string.
     */
    exportJson(synthName = 'ABDSynths') {
      return JSON.stringify(
        {
          schema: 'abd.midiLearn.v1',
          synth: synthName,
          exportedAt: new Date().toISOString(),
          mappings,
        },
        null,
        2
      );
    },

    /**
     * Imports mappings from a JSON string or object.
     */
    importJson(jsonInput) {
      try {
        const parsed = typeof jsonInput === 'string' ? JSON.parse(jsonInput) : jsonInput;
        const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.mappings) ? parsed.mappings : null);
        if (!list) return { ok: false, count: 0 };
        mappings = list.map(sanitizeMapping).filter(Boolean);
        learningTargetIndex = -1;
        learningTargetKey = '';
        learnMode = 'none';
        notify(true);
        return { ok: true, count: mappings.length };
      } catch (_err) {
        return { ok: false, count: 0 };
      }
    },
  };
}

