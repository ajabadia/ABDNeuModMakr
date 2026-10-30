/**
 * ABD Unified Keyboard Component
 * ==============================
 * Best-of-breed piano keybed assembled from ABDMS2000, ABDEep, and ABDCZ101.
 *
 * Features inherited per source:
 *   ABDEep:   velocity curves, pressure display (AT+MW+PB), pitch-bend displacement,
 *             LED color by arp/seq/chord state, per-key ivory texture
 *   ABDCZ101: vintage wear stains, QWERTY keyboard, 49-key CZ-101 parity
 *   ABDMS2000: responsive key count, wheel filmstrip, touch support
 */

// ── Imports from utils (pure functions, no DOM state) ──
import {
  QWERTY_MAP, NOTE_NAMES, OCTAVE_PATTERN, midiToName,
  applyVelocityCurve, SCALE_INTERVALS, isInScale, snapToScale,
  applyIvoryTexture, applyVintageWear, getQwertyLabelForNote,
} from './utils.js';

// Shared filmstrip wheel component (ABDSharedAssets) — single source of truth
import { createWheel } from '@abdsynths/shared/components/wheel.js';

// Re-export CZ101_PRESET so existing consumers don't break
export { CZ101_PRESET } from './utils.js';

/**
 * Create a fully functional keyboard component.
 * @param {Object} deps - Dependencies and configuration
 * @returns {Object} Keyboard instance
 */
export function createKeyboard(deps = {}) {
  const {
    containerId = 'piano-keyboard',
    wheelPitchId = 'pitch-wheel-container',
    wheelModId = 'mod-wheel-container',
    octUpId = 'oct-up',
    octDownId = 'oct-down',
    ledUpId = 'led-up',
    ledDownId = 'led-down',
    panicBtnId = null,
    onNoteOn = () => {},
    onNoteOff = () => {},
    onPitchBend = () => {},
    onModWheel = () => {},
    onPanic = null,
    onOctaveChange = null,
    onSustainChange = null,
    onHoldChange = null,
    onRetrigChange = null,
    onSostenutoChange = null,
    onSoftPedalChange = null,
    onAftertouch = null,
    onVelocityChange = null,
    onCollapseChange = null,
    sustainBtnId = null,
    holdBtnId = null,
    retrigBtnId = null,
    sostenutoBtnId = null,
    softPedalBtnId = null,
    config = {}
  } = deps;

  const cfg = {
    numOctaves: config.numOctaves ?? 4,
    startNote: config.startNote ?? 36,
    // Layout FIJO del host: numOctaves/startNote son los del host y no se
    // recalculan por ancho disponible (ABDEep 4 octavas desde C2, CZ101 sus
    // 49 teclas). Sin esto, el keybed se re-acomoda por ancho.
    fixedOctaves: config.fixedOctaves ?? false,
    maxOctaveShift: config.maxOctaveShift ?? 3,
    velocitySource: config.velocitySource ?? 'fixed',
    velocityCurve: config.velocityCurve ?? 'normal',
    fixedVelocity: config.fixedVelocity ?? 0.85,
    ledColor: config.ledColor ?? null,
    enablePressureDisplay: config.enablePressureDisplay ?? false,
    enablePitchBendDisplace: config.enablePitchBendDisplace ?? false,
    enableIvoryTexture: config.enableIvoryTexture ?? false,
    enableVintageWear: config.enableVintageWear ?? false,
    enableQwerty: config.enableQwerty ?? true,
    showQwertyLabels: config.showQwertyLabels ?? (config.enableQwerty ?? true),
    enableTouch: config.enableTouch ?? true,
    enableAftertouch: config.enableAftertouch ?? false,
    aftertouchMode: config.aftertouchMode ?? 'channel',
    aftertouchSensitivity: config.aftertouchSensitivity ?? 0.5,
    enableAccessibility: config.enableAccessibility ?? false,
    enableCollapse: config.enableCollapse ?? false,
    enableResizeObserver: config.enableResizeObserver ?? true,
    enableHold: config.enableHold ?? true,
    enableRetrig: config.enableRetrig ?? true,
    retrigIntervalMs: config.retrigIntervalMs ?? 800,
    retrigGateRatio: config.retrigGateRatio ?? 0.6,
    enableSostenuto: config.enableSostenuto ?? false,
    enableSoftPedal: config.enableSoftPedal ?? false,
    softPedalFactor: config.softPedalFactor ?? 0.65,
    enableScaleFilter: config.enableScaleFilter ?? false,
    scaleType: config.scaleType ?? 'major',
    scaleRoot: config.scaleRoot ?? 60,
    scaleSnapMode: config.scaleSnapMode ?? 'block',
    enableChordMemory: config.enableChordMemory ?? false,
    maxChordSlots: config.maxChordSlots ?? 12,
    getLedColor: config.getLedColor ?? null,
    getPressureState: config.getPressureState ?? null,
    enablePanic: config.enablePanic ?? true,
    enableWheels: config.enableWheels ?? true,
    zones: Array.isArray(config.zones) ? [...config.zones] : [],
    activeZoneIndex: config.activeZoneIndex ?? 0,
  };

  // ── State ──
  let octaveShift = 0;
  let sustainOn = false;
  let holdOn = false;
  let retrigOn = false;
  let _retrigIntervalMs = Math.max(100, Number(cfg.retrigIntervalMs) || 800);
  let _retrigGateRatio = Math.max(0.1, Math.min(0.95, Number(cfg.retrigGateRatio) || 0.6));
  let _retrigTimerId = null;
  let _retrigGateOffTimeoutId = null;
  let _retrigGateOffState = false;
  let _showQwertyLabels = !!cfg.showQwertyLabels;
  let _channelAftertouch = 0;
  const activeKeys = new Map();
  const _latchedNotes = new Set();
  const qwertyActive = new Set();
  const _activePointers = new Map();
  const _suppressedPointerUp = new Set();
  let destroyed = false;
  let _pressureRafId = null;
  let _focusedKeyIndex = -1;
  let _liveRegion = null;
  let _collapsed = false;
  let _resizeObserver = null;
  let sostenutoOn = false;
  const _sostenutoCaptured = new Set();
  let softPedalOn = false;
  const _chords = new Array(cfg.maxChordSlots).fill(null);

  // True while setPitchBend()/setModWheel() apply host-driven wheel moves.
  // Prevents the UI update from echoing back through onChange as if the user
  // had dragged the wheel (v0.2: native->page feedback support).
  let suppressWheelCallbacks = false;

  const container = document.getElementById(containerId);
  if (!container) {
    console.warn(`[Keyboard] Container #${containerId} not found`);
    return {
      destroy() {}, panic() {}, sweep() {}, getOctave: () => 0,
      setPitchBend() {}, setModWheel() {}, notesOffVisual() {},
      setHold() {}, getHold: () => false, toggleHold() {},
      latchNote() {}, unlatchNote() {}, getLatchedNotes: () => [],
      setRetrig() {}, getRetrig: () => false, toggleRetrig() {},
      setRetrigInterval() {}, getRetrigInterval: () => 800,
      setQwertyLabels() {}, getQwertyLabels: () => false, toggleQwertyLabels() {},
      setZones() {}, setActiveZone() {}, getZones: () => [], getActiveZone: () => 0,
    };
  }

  let _keysWrapper = null;

  function _cleanupKeyVisuals(element, immediate = false) {
    if (!element) return;
    element.classList.remove('active', 'kbd-sustained', 'kbd-latched', 'kbd-retrig-gate-off');
    element.style.removeProperty('--kbd-velocity');
    if (immediate) {
      element.classList.remove('kbd-pressure-release', 'kbd-pressured', 'kbd-pitch-bent');
      element.style.removeProperty('--kbd-pressure');
      element.style.removeProperty('--kbd-mw-pressure');
      element.style.removeProperty('--kbd-pb-offset');
      return;
    }
    if (cfg.enablePressureDisplay &&
        (element.classList.contains('kbd-pressured') || element.classList.contains('kbd-pitch-bent'))) {
      element.style.setProperty('--kbd-pressure', '0');
      element.style.setProperty('--kbd-mw-pressure', '0');
      element.classList.add('kbd-pressure-release');
      const onEnd = () => {
        element.classList.remove('kbd-pressure-release', 'kbd-pressured', 'kbd-pitch-bent');
        element.style.removeProperty('--kbd-pressure');
        element.style.removeProperty('--kbd-mw-pressure');
        element.style.removeProperty('--kbd-pb-offset');
      };
      element.addEventListener('transitionend', onEnd, { once: true });
      setTimeout(() => { if (element.classList.contains('kbd-pressure-release')) onEnd(); }, 500);
    }
  }

  function _fullyReleaseNote(midiNote, fireNoteOff = true) {
    _latchedNotes.delete(midiNote);
    for (const [pid, note] of _activePointers) {
      if (note === midiNote) _activePointers.delete(pid);
    }
    if (!activeKeys.has(midiNote)) return;
    const state = activeKeys.get(midiNote);
    const { actualNote, element, retrigMuted } = state;

    if (cfg.enableAftertouch && onAftertouch) {
      if (cfg.aftertouchMode === 'polyphonic') {
        onAftertouch(actualNote, 0);
      } else if (_channelAftertouch > 0) {
        _channelAftertouch = 0;
        onAftertouch(-1, 0);
      }
    }

    activeKeys.delete(midiNote);
    _cleanupKeyVisuals(element);
    if (cfg.enableAccessibility) updateKeyAriaPressed(midiNote, false);
    if (fireNoteOff && !retrigMuted) {
      onNoteOff(actualNote);
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  KEYBED RENDERING
  // ══════════════════════════════════════════════════════════════

  // Responsive octave count calculation based on available width
  function calculateResponsiveLayout(width) {
    const minKeyW = 20;
    const maxKeyW = 36;
    const targetW = 26;
    const candidates = [
      { octaves: 4, startNote: 36 }, // 49 keys, 29 white
      { octaves: 3, startNote: 48 }, // 37 keys, 22 white
      { octaves: 2, startNote: 48 }, // 25 keys, 15 white
      { octaves: 5, startNote: 24 }, // 61 keys, 36 white
    ];
    let best = candidates[0];
    let bestDiff = 9999;
    for (const c of candidates) {
      const whiteCount = c.octaves * 7 + 1;
      const keyW = width / whiteCount;
      if (keyW >= minKeyW && keyW <= maxKeyW) {
        const diff = Math.abs(keyW - targetW);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = c;
        }
      }
    }
    if (width > 1250) return { octaves: 5, startNote: 24 };
    if (bestDiff < 9999) return best;
    if (width < 450) return { octaves: 2, startNote: 48 };
    if (width < 680) return { octaves: 3, startNote: 48 };
    return { octaves: 4, startNote: 36 };
  }


  function renderKeybed() {
    container.classList.add('kbd-piano-keys');
    container.classList.toggle('kbd-hide-qwerty-labels', !_showQwertyLabels || !cfg.enableQwerty);
    if (!_keysWrapper) {
      _keysWrapper = container.querySelector('.kbd-keys-wrapper');
      if (!_keysWrapper) {
        _keysWrapper = document.createElement('div');
        _keysWrapper.className = 'kbd-keys-wrapper';
        container.prepend(_keysWrapper);
      }
    }
    const availW = _keysWrapper.clientWidth || container.clientWidth;
    if (availW > 120 && !cfg.fixedOctaves) {
      const resp = calculateResponsiveLayout(availW);
      cfg.numOctaves = resp.octaves;
      cfg.startNote = resp.startNote;
    }
    _keysWrapper.innerHTML = '';
    for (let oct = 0; oct < cfg.numOctaves; oct++) {
      const base = cfg.startNote + oct * 12;
      for (const p of OCTAVE_PATTERN) {
        const whiteNote = base + p.offset;
        const whiteKey = createKeyElement(whiteNote, false);
        if (p.sharp !== null) {
          const blackKey = createKeyElement(base + p.sharp, true);
          whiteKey.appendChild(blackKey);
        }
        _keysWrapper.appendChild(whiteKey);
      }
    }
    _keysWrapper.appendChild(createKeyElement(cfg.startNote + cfg.numOctaves * 12, false));
    applyZoneVisuals();
  }

  function createKeyElement(midiNote, isBlack) {
    const key = document.createElement('div');
    key.className = isBlack ? 'kbd-black-key' : 'kbd-white-key';
    key.dataset.note = midiNote;
    if (cfg.enableIvoryTexture && !isBlack) applyIvoryTexture(key, midiNote);
    if (cfg.enableVintageWear) applyVintageWear(key, midiNote, isBlack);
    if (cfg.enableAccessibility) applyKeyAria(key, midiNote);

    const qwertyLabel = getQwertyLabelForNote(midiNote, cfg.startNote);
    if (qwertyLabel) {
      key.dataset.qwerty = qwertyLabel;
      if (cfg.enableQwerty) {
        const labelSpan = document.createElement('span');
        labelSpan.className = 'kbd-qwerty-label';
        labelSpan.setAttribute('aria-hidden', 'true');
        labelSpan.textContent = qwertyLabel;
        key.appendChild(labelSpan);
      }
    }

    const stopNote = (e) => {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      const pid = e && e.pointerId != null ? e.pointerId : null;
      if (pid != null && _suppressedPointerUp.has(pid)) {
        _suppressedPointerUp.delete(pid);
        return;
      }
      if (pid != null && e && (e.type === 'pointerup' || e.type === 'pointercancel')) {
        _activePointers.delete(pid);
      } else if (pid == null && e && (e.type === 'pointerup' || e.type === 'pointercancel' || e.type === 'touchend' || e.type === 'touchcancel')) {
        _activePointers.delete(1);
      }
      if (!activeKeys.has(midiNote)) return;
      const state = activeKeys.get(midiNote);
      const { element, pointerId: heldPointerId } = state;

      // Multi-touch: only the pointer that started the note can stop it
      if (pid != null && heldPointerId != null && pid !== heldPointerId) return;

      state.physicallyHeld = false;
      state.pointerId = null;

      // Latch / Hold mode: keep note active until toggled off or Hold is disabled
      if (holdOn || state.latched || _latchedNotes.has(midiNote)) {
        state.latched = true;
        _latchedNotes.add(midiNote);
        if (element) {
          element.classList.add('kbd-latched');
          if (!state.retrigMuted) element.classList.add('active');
        }
        return;
      }

      // Sostenuto: if this note was captured, don't release until sostenuto is off
      if (sostenutoOn && _sostenutoCaptured.has(midiNote)) return;

      // Sustain: hold notes in activeKeys until sustain is turned off
      if (sustainOn && e && (e.type === 'pointerup' || e.type === 'pointerleave' || e.type === 'pointerout' || e.type === 'pointercancel' || e.type === 'touchend' || e.type === 'touchcancel')) {
        state.sustained = true;
        if (element) {
          element.classList.add('kbd-sustained');
        }
        return;
      }

      _fullyReleaseNote(midiNote, true);
    };

    const playNote = (e) => {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      const newPid = e && e.pointerId != null ? e.pointerId : null;
      const isLatchGesture = holdOn || Boolean(e && (e.shiftKey || e.button === 2));
      const actualNote = Math.max(0, Math.min(127, midiNote + octaveShift));

      if (activeKeys.has(midiNote)) {
        const existing = activeKeys.get(midiNote);
        if ((existing.latched || _latchedNotes.has(midiNote)) && isLatchGesture) {
          // Clicking an already-latched key in Hold/Shift mode unlatches and stops it
          _suppressedPointerUp.add(newPid ?? 1);
          _fullyReleaseNote(midiNote, true);
          return;
        }
        if (!existing.physicallyHeld && existing.sustained) {
          if (isLatchGesture) {
            existing.latched = true;
            _latchedNotes.add(midiNote);
            existing.sustained = false;
            existing.physicallyHeld = true;
            existing.pointerId = newPid;
            key.classList.remove('kbd-sustained');
            key.classList.add('active', 'kbd-latched');
            return;
          }
          // Re-strike a sustained note: release previous voice before re-triggering
          _fullyReleaseNote(midiNote, true);
        } else {
          // Multi-touch: different pointer on same key — transfer ownership
          if (newPid != null && existing.pointerId !== newPid) {
            existing.pointerId = newPid;
          }
          if (isLatchGesture) {
            existing.latched = true;
            _latchedNotes.add(midiNote);
            key.classList.add('kbd-latched');
          }
          return;
        }
      }

      // Scale filter: check if note is in scale
      let noteToPlay = actualNote;
      if (_scaleEnabled) {
        const intervals = SCALE_INTERVALS[_scaleType] || SCALE_INTERVALS.major;
        if (!isInScale(actualNote, _scaleRoot, intervals)) {
          if (_scaleSnapMode === 'block') return;
          if (_scaleSnapMode === 'snap') noteToPlay = snapToScale(actualNote, _scaleRoot, intervals);
        }
      }

      let velocity = cfg.fixedVelocity;
      if (cfg.velocitySource === 'yPosition' && e && e.clientY != null) {
        const rect = key.getBoundingClientRect();
        if (rect.height > 0) {
          const relY = (e.clientY - rect.top) / rect.height;
          const raw = Math.max(0.15, Math.min(1.0, 0.15 + relY * 0.85));
          velocity = Math.max(0.01, Math.min(1.0, applyVelocityCurve(raw, cfg.velocityCurve)));
        }
      }

      // Soft pedal attenuates velocity
      if (softPedalOn) velocity *= cfg.softPedalFactor;

      if (e && (e.type === 'pointerdown' || e.type === 'pointerover') && !isLatchGesture) {
        _activePointers.set(newPid ?? 1, midiNote);
      }

      if (isLatchGesture) {
        _latchedNotes.add(midiNote);
      }

      activeKeys.set(midiNote, {
        actualNote: noteToPlay,
        element: key,
        velocity,
        startPointerY: e ? (e.clientY ?? null) : null,
        pointerId: newPid,
        physicallyHeld: true,
        sustained: false,
        latched: isLatchGesture,
        retrigMuted: false,
        source: 'pointer',
        stopFn: stopNote,
      });
      key.classList.add('active');
      if (isLatchGesture) key.classList.add('kbd-latched');
      key.style.setProperty('--kbd-velocity', velocity.toFixed(3));

      if (cfg.enableAccessibility) {
        updateKeyAriaPressed(midiNote, true);
        announce(`${midiToName(noteToPlay)} on, velocity ${Math.round(velocity * 100)}%`);
      }

      const color = (cfg.getLedColor) ? cfg.getLedColor() : (cfg.ledColor || 'var(--color-accent)');
      key.style.setProperty('--kbd-led-color', color);

      onNoteOn(noteToPlay, velocity);
      if (onVelocityChange) onVelocityChange(noteToPlay, velocity);
    };

    key.addEventListener('pointerdown', playNote);
    key.addEventListener('pointerup', stopNote);
    key.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); });

    // Glissando: dragging a depressed pointer across keys releases the previous key and plays the new one
    key.addEventListener('pointerover', (e) => {
      if (e.target !== key) return;
      const pid = e.pointerId ?? 1;
      const isDragging = ((e.buttons ?? 0) & 1) === 1 || _activePointers.has(pid);
      if (!isDragging || holdOn || e.shiftKey) return;
      const prevNote = _activePointers.get(pid);
      if (prevNote !== undefined && prevNote !== midiNote && activeKeys.has(prevNote)) {
        const prevState = activeKeys.get(prevNote);
        if (prevState && prevState.stopFn && !prevState.latched && !_latchedNotes.has(prevNote)) {
          prevState.stopFn({
            type: 'pointerleave',
            pointerId: pid,
            preventDefault() {},
            stopPropagation() {},
          });
        }
      }
      _activePointers.set(pid, midiNote);
      playNote(e);
    });

    if (cfg.enableAftertouch) {
      key.addEventListener('pointermove', (e) => {
        if (!activeKeys.has(midiNote)) return;
        const state = activeKeys.get(midiNote);
        if (state.startPointerY == null) return;
        const deltaY = state.startPointerY - (e.clientY ?? state.startPointerY);
        const maxDelta = key.getBoundingClientRect().height * 0.8;
        const rawPressure = Math.max(0, Math.min(1, (deltaY / maxDelta) * cfg.aftertouchSensitivity * 2));
        const pressure = Math.round(rawPressure * 127) / 127;
        if (cfg.aftertouchMode === 'polyphonic') {
          if (onAftertouch) onAftertouch(state.actualNote, pressure);
        } else if (pressure !== _channelAftertouch) {
          _channelAftertouch = pressure;
          if (onAftertouch) onAftertouch(-1, pressure);
        }
      });
    }

    if (cfg.enableTouch) {
      key.addEventListener('touchstart', playNote, { passive: false });
      key.addEventListener('touchend', stopNote, { passive: false });
      key.addEventListener('touchcancel', stopNote, { passive: false });
    }
    return key;
  }

  // ══════════════════════════════════════════════════════════════
  //  ACCESSIBILITY
  // ══════════════════════════════════════════════════════════════

  function announce(message) {
    if (!cfg.enableAccessibility || !_liveRegion) return;
    _liveRegion.textContent = message;
  }

  function getAllKeyElements() {
    return Array.from((_keysWrapper || container).querySelectorAll('.kbd-white-key, .kbd-black-key'));
  }

  function applyKeyAria(keyEl, midiNote) {
    keyEl.setAttribute('role', 'button');
    keyEl.setAttribute('tabindex', '-1');
    keyEl.setAttribute('aria-label', `Note ${midiToName(midiNote)} (MIDI ${midiNote})`);
    keyEl.setAttribute('aria-pressed', 'false');
  }

  function updateKeyAriaPressed(midiNote, pressed) {
    const keyEl = (_keysWrapper || container).querySelector(`[data-note="${midiNote}"]`);
    if (keyEl) keyEl.setAttribute('aria-pressed', pressed ? 'true' : 'false');
  }

  function focusKey(index) {
    const keys = getAllKeyElements();
    if (keys.length === 0) return;
    if (_focusedKeyIndex >= 0 && _focusedKeyIndex < keys.length) {
      keys[_focusedKeyIndex].setAttribute('tabindex', '-1');
    }
    _focusedKeyIndex = Math.max(0, Math.min(keys.length - 1, index));
    keys[_focusedKeyIndex].setAttribute('tabindex', '0');
    keys[_focusedKeyIndex].focus();
  }

  function setupAccessibility() {
    if (!cfg.enableAccessibility) return;
    _liveRegion = document.createElement('div');
    _liveRegion.setAttribute('role', 'status');
    _liveRegion.setAttribute('aria-live', 'polite');
    _liveRegion.setAttribute('aria-atomic', 'true');
    _liveRegion.className = 'kbd-sr-only';
    container.appendChild(_liveRegion);
    container.setAttribute('role', 'group');
    container.setAttribute('aria-label', 'Virtual piano keyboard');
    getAllKeyElements().forEach((keyEl) => {
      applyKeyAria(keyEl, parseInt(keyEl.dataset.note, 10));
    });
    const keys = getAllKeyElements();
    if (keys.length > 0) { keys[0].setAttribute('tabindex', '0'); _focusedKeyIndex = 0; }
    container.addEventListener('keydown', handleA11yKeyNav);
  }

  function handleA11yKeyNav(e) {
    if (!cfg.enableAccessibility) return;
    const keys = getAllKeyElements();
    if (keys.length === 0) return;
    switch (e.key) {
      case 'ArrowRight': e.preventDefault(); focusKey(_focusedKeyIndex + 1); announceNote(keys[_focusedKeyIndex]); break;
      case 'ArrowLeft': e.preventDefault(); focusKey(_focusedKeyIndex - 1); announceNote(keys[_focusedKeyIndex]); break;
      case 'ArrowUp': e.preventDefault(); focusKey(Math.max(0, _focusedKeyIndex - 7)); announceNote(keys[_focusedKeyIndex]); break;
      case 'ArrowDown': e.preventDefault(); focusKey(Math.min(keys.length - 1, _focusedKeyIndex + 7)); announceNote(keys[_focusedKeyIndex]); break;
      case 'Home': e.preventDefault(); focusKey(0); announceNote(keys[0]); break;
      case 'End': e.preventDefault(); focusKey(keys.length - 1); announceNote(keys[keys.length - 1]); break;
    }
  }

  function announceNote(keyEl) {
    if (!keyEl) return;
    const midiNote = parseInt(keyEl.dataset.note, 10);
    announce(`${midiToName(midiNote)}, MIDI ${midiNote}${activeKeys.has(midiNote) ? ', playing' : ''}`);
  }

  // ══════════════════════════════════════════════════════════════
  //  OCTAVE SHIFT + LEDS
  // ══════════════════════════════════════════════════════════════

  function updateOctaveLEDs() {
    const ledUp = document.getElementById(ledUpId);
    const ledDown = document.getElementById(ledDownId);
    if (!ledUp || !ledDown) return;
    const octVal = octaveShift / 12;
    ledUp.className = 'kbd-octave-led';
    ledDown.className = 'kbd-octave-led';
    if (octVal === 1) ledUp.classList.add('blink');
    else if (octVal >= 2) ledUp.classList.add('on');
    else if (octVal === -1) ledDown.classList.add('blink');
    else if (octVal <= -2) ledDown.classList.add('on');
  }

  function shiftOctave(delta) {
    const maxSemitones = cfg.maxOctaveShift * 12;
    octaveShift = Math.max(-maxSemitones, Math.min(maxSemitones, octaveShift + delta * 12));
    updateOctaveLEDs();
    const oct = octaveShift / 12;
    if (cfg.enableAccessibility) announce(`Octave shift ${oct > 0 ? '+' : ''}${oct}`);
    if (onOctaveChange) onOctaveChange(oct);
  }

  // ══════════════════════════════════════════════════════════════
  //  QWERTY KEYBOARD
  // ══════════════════════════════════════════════════════════════

  function handleKeydown(e) {
    if (destroyed) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

    // Ctrl+Q → Panic
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'q') {
      e.preventDefault(); panic(); return;
    }
    // Ctrl+Shift+Space → Toggle Sostenuto
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === ' ') {
      e.preventDefault(); toggleSostenuto(); return;
    }
    // Ctrl+Alt+Space → Toggle Soft Pedal
    if ((e.ctrlKey || e.metaKey) && e.altKey && e.key === ' ') {
      e.preventDefault(); toggleSoftPedal(); return;
    }
    // Ctrl+Space → Toggle Sustain
    if ((e.ctrlKey || e.metaKey) && e.key === ' ') {
      e.preventDefault(); toggleSustain(); return;
    }
    // Ctrl+H → Toggle Hold / Latch
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'h' && cfg.enableHold) {
      e.preventDefault(); toggleHold(); return;
    }
    // Alt+R → Toggle Retrig
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'r' && cfg.enableRetrig) {
      e.preventDefault(); toggleRetrig(); return;
    }

    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.key === 'ArrowUp') { e.preventDefault(); shiftOctave(1); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); shiftOctave(-1); return; }
    if (!cfg.enableQwerty) return;

    const key = e.key.toLowerCase();
    if (QWERTY_MAP[key] !== undefined && !qwertyActive.has(key)) {
      qwertyActive.add(key);
      const midiNote = cfg.startNote + QWERTY_MAP[key];

      // Scale filter: check if note is in scale
      let noteToPlay = Math.max(0, Math.min(127, midiNote + octaveShift));
      if (_scaleEnabled) {
        const intervals = SCALE_INTERVALS[_scaleType] || SCALE_INTERVALS.major;
        if (!isInScale(noteToPlay, _scaleRoot, intervals)) {
          if (_scaleSnapMode === 'block') return;
          if (_scaleSnapMode === 'snap') noteToPlay = snapToScale(noteToPlay, _scaleRoot, intervals);
        }
      }

      const shouldLatch = holdOn || e.shiftKey;

      // Toggle off if already latched and pressed again in Hold/Shift mode
      if (shouldLatch && _latchedNotes.has(midiNote)) {
        _latchedNotes.delete(midiNote);
        _fullyReleaseNote(midiNote, true);
        return;
      }

      // If note was sustained (not physically held), re-strike it cleanly
      if (activeKeys.has(midiNote)) {
        const existing = activeKeys.get(midiNote);
        if (!existing.physicallyHeld) {
          _fullyReleaseNote(midiNote, true);
        }
      }

      if (!activeKeys.has(midiNote)) {
        let velocity = cfg.fixedVelocity;
        if (softPedalOn) velocity *= cfg.softPedalFactor;

        const keyEl = (_keysWrapper || container).querySelector(`[data-note="${midiNote}"]`);
        if (keyEl) {
          keyEl.classList.add('active');
          keyEl.classList.remove('kbd-sustained', 'kbd-retrig-gate-off');
          if (shouldLatch) keyEl.classList.add('kbd-latched');
          keyEl.style.setProperty('--kbd-velocity', velocity.toFixed(3));
          const color = (cfg.getLedColor) ? cfg.getLedColor() : (cfg.ledColor || 'var(--color-accent)');
          keyEl.style.setProperty('--kbd-led-color', color);
        }
        if (shouldLatch) _latchedNotes.add(midiNote);
        activeKeys.set(midiNote, {
          actualNote: noteToPlay,
          element: keyEl || null,
          velocity,
          physicallyHeld: true,
          sustained: false,
          source: 'qwerty',
        });
        onNoteOn(noteToPlay, velocity);
        if (onVelocityChange) onVelocityChange(noteToPlay, velocity);
        if (cfg.enableAccessibility) {
          updateKeyAriaPressed(midiNote, true);
          announce(`${midiToName(noteToPlay)} on, velocity ${Math.round(velocity * 100)}%`);
        }
      }
    }
  }

  function handleKeyup(e) {
    if (destroyed) return;
    if (!cfg.enableQwerty) return;
    const key = e.key.toLowerCase();
    if (QWERTY_MAP[key] !== undefined && qwertyActive.has(key)) {
      qwertyActive.delete(key);
      const midiNote = cfg.startNote + QWERTY_MAP[key];
      if (activeKeys.has(midiNote)) {
        const entry = activeKeys.get(midiNote);
        entry.physicallyHeld = false;
        if (holdOn || _latchedNotes.has(midiNote)) {
          _latchedNotes.add(midiNote);
          if (entry.element) entry.element.classList.add('kbd-latched');
          return;
        }
        if (sostenutoOn && _sostenutoCaptured.has(midiNote)) return;
        if (sustainOn) {
          entry.sustained = true;
          if (entry.element) entry.element.classList.add('kbd-sustained');
          return;
        }
        _fullyReleaseNote(midiNote, true);
      }
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  GLOBAL POINTER-UP SAFETY (prevents stuck notes when dragging
  //  outside the keyboard toward SlideDrawer / Dashboard knobs)
  // ══════════════════════════════════════════════════════════════

  function handleGlobalPointerUp(e) {
    if (destroyed) return;
    const pid = e && e.pointerId != null ? e.pointerId : null;
    if (pid != null) {
      _activePointers.delete(pid);
    } else {
      _activePointers.clear();
    }

    if (cfg.enableAftertouch && _channelAftertouch > 0) {
      _channelAftertouch = 0;
      if (onAftertouch) onAftertouch(-1, 0);
    }

    for (const [baseNote, entry] of Array.from(activeKeys.entries())) {
      if (entry.source === 'pointer' && entry.physicallyHeld) {
        if (pid != null && entry.pointerId != null && entry.pointerId !== pid) continue;
        entry.physicallyHeld = false;
        entry.pointerId = null;
        if (holdOn || entry.latched || _latchedNotes.has(baseNote)) {
          entry.latched = true;
          _latchedNotes.add(baseNote);
          if (entry.element) entry.element.classList.add('kbd-latched');
          continue;
        }
        if (sostenutoOn && _sostenutoCaptured.has(baseNote)) continue;
        if (sustainOn) {
          entry.sustained = true;
          if (entry.element) entry.element.classList.add('kbd-sustained');
          continue;
        }
        _fullyReleaseNote(baseNote, true);
      }
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  PITCH / MOD WHEELS
  //  Delegates markup, visuals, spring-reset and value readout to the
  //  shared filmstrip Wheel from @abdsynths/shared (single source).
  // ══════════════════════════════════════════════════════════════

  const wheels = [];

  function setupWheel(elementId, isPitch) {
    const wheel = createWheel(elementId, {
      type: isPitch ? 'pitch' : 'mod',
      onChange: (val) => {
        if (suppressWheelCallbacks) return; // host-driven move, not user input
        if (isPitch) onPitchBend(val / 8192.0);
        else onModWheel(val / 127.0);
      },
    });
    if (wheel) wheels.push(wheel);
    return wheel;
  }

  // ══════════════════════════════════════════════════════════════
  //  HOST-DRIVEN FEEDBACK (v0.2)
  //  Let the owning page reflect external MIDI state (hardware controller,
  //  DAW playback, a native-side bridge) on the keyboard UI.
  // ══════════════════════════════════════════════════════════════

  let pitchWheel = null;
  let modWheel = null;

  /** Reflect an external pitch bend (-1..+1) on the pitch wheel without
   *  echoing the move back through onPitchBend. Wheel slider range is
   *  signed (-8192..+8191) with 0 = center. */
  function setPitchBend(normalized) {
    if (!pitchWheel) return;
    const v = Math.max(-1, Math.min(1, Number(normalized) || 0));
    suppressWheelCallbacks = true;
    pitchWheel.setValue(Math.round(v > 0 ? v * 8191 : v * 8192), false);
    suppressWheelCallbacks = false;
  }

  /** Reflect an external mod wheel value (0..1) on the mod wheel without
   *  echoing the move back through onModWheel. */
  function setModWheel(normalized) {
    if (!modWheel) return;
    const v = Math.max(0, Math.min(1, Number(normalized) || 0));
    suppressWheelCallbacks = true;
    modWheel.setValue(Math.round(v * 127.0), false);
    suppressWheelCallbacks = false;
  }

  /** Clear key highlights for notes the host says are no longer sounding
   *  (does NOT fire onNoteOff — the sound side already happened). Unknown
   *  notes are ignored, so it is safe to call with any note list. */
  function notesOffVisual(midiNotes) {
    if (!Array.isArray(midiNotes)) return;
    for (const n of midiNotes) _releaseKey(Number(n));
  }

  // ══════════════════════════════════════════════════════════════
  //  PRESSURE DISPLAY (from ABDEep)
  // ══════════════════════════════════════════════════════════════

  let _prevAT = 0, _prevMW = 0, _prevPB = 0;

  function updatePressureDisplay() {
    _pressureRafId = null;
    let at = 0, mw = 0, pb = 0;
    if (cfg.getPressureState) {
      const state = cfg.getPressureState();
      at = Math.max(0, Math.min(1, state.aftertouch || 0));
      mw = Math.max(0, Math.min(1, state.modWheel || 0));
      pb = Math.max(-1, Math.min(1, state.pitchBend || 0));
    } else if (cfg.enableAftertouch) {
      at = _channelAftertouch;
    }
    if (Math.abs(at - _prevAT) < 0.01 && Math.abs(mw - _prevMW) < 0.01 && Math.abs(pb - _prevPB) < 0.01) {
      _pressureRafId = requestAnimationFrame(updatePressureDisplay);
      return;
    }
    _prevAT = at; _prevMW = mw; _prevPB = pb;
    const combined = Math.max(at, mw);
    const pbPx = Math.round(pb * 6);
    for (const [, { element }] of activeKeys) {
      if (!element) continue;
      if (combined > 0.01) {
        element.style.setProperty('--kbd-pressure', combined.toFixed(3));
        element.style.setProperty('--kbd-mw-pressure', mw > 0.01 ? mw.toFixed(3) : '0');
        element.classList.add('kbd-pressured');
      } else {
        element.style.removeProperty('--kbd-pressure');
        element.style.removeProperty('--kbd-mw-pressure');
        element.classList.remove('kbd-pressured');
      }
      if (cfg.enablePitchBendDisplace && Math.abs(pb) > 0.01) {
        element.style.setProperty('--kbd-pb-offset', pbPx + 'px');
        element.classList.add('kbd-pitch-bent');
      } else {
        element.style.removeProperty('--kbd-pb-offset');
        element.classList.remove('kbd-pitch-bent');
      }
    }
    _pressureRafId = requestAnimationFrame(updatePressureDisplay);
  }

  // ══════════════════════════════════════════════════════════════
  //  LED ANIMATIONS
  // ══════════════════════════════════════════════════════════════

  function sweep(direction = 'right', speedMs = 12) {
    const keys = Array.from((_keysWrapper || container).querySelectorAll('.kbd-white-key, .kbd-black-key'));
    if (!keys.length) return;
    const ordered = direction === 'left' ? [...keys].reverse() : keys;
    ordered.forEach((key, i) => {
      setTimeout(() => {
        if (destroyed) return;
        key.classList.add('kbd-led-sweep');
        setTimeout(() => key.classList.remove('kbd-led-sweep'), 180);
      }, i * speedMs);
    });
  }

  function panicFlash() {
    const keys = Array.from((_keysWrapper || container).querySelectorAll('.kbd-white-key, .kbd-black-key'));
    const panicLed = container.querySelector('.kbd-panic-led');
    if (!keys.length && !panicLed) return;
    let flashes = 0;
    const interval = setInterval(() => {
      keys.forEach(k => k.classList.toggle('kbd-led-panic'));
      if (panicLed) {
        panicLed.style.background = flashes % 2 === 0 ? '#ff2233' : '#3a1010';
        panicLed.style.boxShadow = flashes % 2 === 0 ? '0 0 8px #ff2233, 0 0 16px rgba(255,34,51,0.5)' : 'inset 0 1px 2px rgba(0,0,0,0.6)';
      }
      flashes++;
      if (flashes >= 6) {
        clearInterval(interval);
        keys.forEach(k => k.classList.remove('kbd-led-panic'));
        if (panicLed) { panicLed.style.background = ''; panicLed.style.boxShadow = ''; }
      }
    }, 90);
  }

  // ══════════════════════════════════════════════════════════════
  //  SUSTAIN PEDAL (CC#64)
  // ══════════════════════════════════════════════════════════════

  function updateSustainVisuals() {
    const led = container.querySelector('.kbd-sustain-led');
    const btn = container.querySelector('.kbd-sustain-btn');
    if (led) sustainOn ? led.classList.add('on') : led.classList.remove('on');
    if (btn) sustainOn ? btn.classList.add('active') : btn.classList.remove('active');
  }

  function setSustain(on) {
    const val = !!on;
    if (val === sustainOn) return;
    sustainOn = val;

    if (!sustainOn) {
      // Release all sustained notes that are no longer physically held, latched, or sostenuto-captured
      for (const [baseNote, entry] of Array.from(activeKeys.entries())) {
        if (!entry.physicallyHeld && !entry.latched && !_latchedNotes.has(baseNote) && !(sostenutoOn && _sostenutoCaptured.has(baseNote))) {
          _fullyReleaseNote(baseNote, true);
        } else {
          entry.sustained = false;
          if (entry.element) entry.element.classList.remove('kbd-sustained');
        }
      }
    }

    updateSustainVisuals();
    if (cfg.enableAccessibility) announce(`Sustain ${sustainOn ? 'on' : 'off'}`);
    if (onSustainChange) onSustainChange(sustainOn);
  }

  function toggleSustain() { setSustain(!sustainOn); }

  // ══════════════════════════════════════════════════════════════
  //  SOSTENUTO PEDAL (CC#66)
  //  Captures all currently active notes when engaged.
  // ══════════════════════════════════════════════════════════════

  function updateSostenutoVisuals() {
    const led = container.querySelector('.kbd-sostenuto-led');
    const btn = container.querySelector('.kbd-sostenuto-btn');
    if (led) sostenutoOn ? led.classList.add('on') : led.classList.remove('on');
    if (btn) sostenutoOn ? btn.classList.add('active') : btn.classList.remove('active');
  }

  function setSostenuto(on) {
    const val = !!on;
    if (val === sostenutoOn) return;
    sostenutoOn = val;
    if (sostenutoOn) {
      _sostenutoCaptured.clear();
      for (const [baseNote] of activeKeys) _sostenutoCaptured.add(baseNote);
    } else {
      const captured = Array.from(_sostenutoCaptured);
      _sostenutoCaptured.clear();
      for (const baseNote of captured) {
        const entry = activeKeys.get(baseNote);
        if (entry && !entry.physicallyHeld && !entry.latched && !_latchedNotes.has(baseNote) && !sustainOn) {
          _fullyReleaseNote(baseNote, true);
        }
      }
    }
    updateSostenutoVisuals();
    if (cfg.enableAccessibility) announce(`Sostenuto ${sostenutoOn ? 'on' : 'off'}`);
    if (onSostenutoChange) onSostenutoChange(sostenutoOn);
  }

  function toggleSostenuto() { setSostenuto(!sostenutoOn); }

  // ══════════════════════════════════════════════════════════════
  //  SOFT PEDAL (CC#67)
  //  Attenuates velocity values when active.
  // ══════════════════════════════════════════════════════════════

  function updateSoftPedalVisuals() {
    const led = container.querySelector('.kbd-soft-led');
    const btn = container.querySelector('.kbd-soft-btn');
    if (led) softPedalOn ? led.classList.add('on') : led.classList.remove('on');
    if (btn) softPedalOn ? btn.classList.add('active') : btn.classList.remove('active');
  }

  function setSoftPedal(on) {
    const val = !!on;
    if (val === softPedalOn) return;
    softPedalOn = val;
    updateSoftPedalVisuals();
    if (cfg.enableAccessibility) announce(`Soft pedal ${softPedalOn ? 'on' : 'off'}`);
    if (onSoftPedalChange) onSoftPedalChange(softPedalOn);
  }

  function toggleSoftPedal() { setSoftPedal(!softPedalOn); }

  // ══════════════════════════════════════════════════════════════
  //  HOLD / LATCH MODE (UX2.4 — Hands-Free One-Mouse Editing)
  //  Allows pinning notes or chords with a mouse click so the user
  //  can move the cursor up to edit SlideDrawer / Dashboard knobs.
  // ══════════════════════════════════════════════════════════════

  function updateHoldVisuals() {
    const led = container.querySelector('.kbd-hold-led');
    const btn = container.querySelector('.kbd-hold-btn');
    if (led) holdOn ? led.classList.add('on') : led.classList.remove('on');
    if (btn) {
      holdOn ? btn.classList.add('active') : btn.classList.remove('active');
      btn.setAttribute('aria-pressed', String(holdOn));
    }
  }

  function setHold(on) {
    const val = !!on;
    if (val === holdOn) return;
    holdOn = val;

    if (holdOn) {
      // Latch any currently active notes
      for (const [baseNote, entry] of activeKeys) {
        entry.latched = true;
        _latchedNotes.add(baseNote);
        if (entry.element) entry.element.classList.add('kbd-latched');
      }
    } else {
      // Unlatch all notes and release those not physically held or sustained
      _latchedNotes.clear();
      for (const [baseNote, entry] of Array.from(activeKeys.entries())) {
        entry.latched = false;
        if (entry.element) entry.element.classList.remove('kbd-latched');
        if (!entry.physicallyHeld) {
          if (sustainOn) {
            entry.sustained = true;
            if (entry.element) entry.element.classList.add('kbd-sustained');
          } else if (!(sostenutoOn && _sostenutoCaptured.has(baseNote))) {
            _fullyReleaseNote(baseNote, true);
          }
        }
      }
    }

    updateHoldVisuals();
    if (cfg.enableAccessibility) announce(`Hold ${holdOn ? 'on' : 'off'}`);
    if (onHoldChange) onHoldChange(holdOn);
  }

  function toggleHold() { setHold(!holdOn); }

  function latchNote(midiNote, velocity = cfg.fixedVelocity) {
    const baseNote = Number(midiNote);
    if (Number.isNaN(baseNote)) return;
    let noteToPlay = Math.max(0, Math.min(127, baseNote + octaveShift));
    if (_scaleEnabled) {
      const intervals = SCALE_INTERVALS[_scaleType] || SCALE_INTERVALS.major;
      if (!isInScale(noteToPlay, _scaleRoot, intervals)) {
        if (_scaleSnapMode === 'block') return;
        if (_scaleSnapMode === 'snap') noteToPlay = snapToScale(noteToPlay, _scaleRoot, intervals);
      }
    }
    const vel = Math.max(0.05, Math.min(1.0, Number(velocity) || cfg.fixedVelocity));
    const keyEl = (_keysWrapper || container).querySelector(`[data-note="${baseNote}"]`);
    _latchedNotes.add(baseNote);

    if (activeKeys.has(baseNote)) {
      const entry = activeKeys.get(baseNote);
      entry.latched = true;
      entry.sustained = false;
      if (entry.element) {
        entry.element.classList.add('active', 'kbd-latched');
        entry.element.classList.remove('kbd-sustained');
      }
      return;
    }

    if (keyEl) {
      keyEl.classList.add('active', 'kbd-latched');
      keyEl.style.setProperty('--kbd-velocity', vel.toFixed(3));
      const color = (cfg.getLedColor) ? cfg.getLedColor() : (cfg.ledColor || 'var(--color-accent)');
      keyEl.style.setProperty('--kbd-led-color', color);
    }
    activeKeys.set(baseNote, {
      actualNote: noteToPlay,
      element: keyEl || null,
      velocity: vel,
      physicallyHeld: false,
      sustained: false,
      latched: true,
      retrigMuted: false,
      source: 'latch',
    });
    onNoteOn(noteToPlay, vel);
    if (onVelocityChange) onVelocityChange(noteToPlay, vel);
    if (cfg.enableAccessibility) updateKeyAriaPressed(baseNote, true);
  }

  function unlatchNote(midiNote) {
    const baseNote = Number(midiNote);
    if (!_latchedNotes.has(baseNote) && !(activeKeys.has(baseNote) && activeKeys.get(baseNote).latched)) return;
    _latchedNotes.delete(baseNote);
    const entry = activeKeys.get(baseNote);
    if (!entry) return;
    entry.latched = false;
    if (entry.element) entry.element.classList.remove('kbd-latched');
    if (!entry.physicallyHeld) {
      if (sustainOn) {
        entry.sustained = true;
        if (entry.element) entry.element.classList.add('kbd-sustained');
      } else if (!(sostenutoOn && _sostenutoCaptured.has(baseNote))) {
        _fullyReleaseNote(baseNote, true);
      }
    }
  }

  function getLatchedNotes() {
    const notes = [];
    for (const baseNote of _latchedNotes) {
      const entry = activeKeys.get(baseNote);
      notes.push(entry ? entry.actualNote : Math.max(0, Math.min(127, baseNote + octaveShift)));
    }
    return notes.sort((a, b) => a - b);
  }

  // ══════════════════════════════════════════════════════════════
  //  RETRIG / AUTO-REPEAT MODE (UX2.4 — Envelope Editing Aid)
  //  Periodically re-triggers active/latched notes so users can
  //  adjust EG Attack / Decay / Release with a single mouse.
  // ══════════════════════════════════════════════════════════════

  function updateRetrigVisuals() {
    const led = container.querySelector('.kbd-retrig-led');
    const btn = container.querySelector('.kbd-retrig-btn');
    if (led) retrigOn ? led.classList.add('on') : led.classList.remove('on');
    if (btn) {
      retrigOn ? btn.classList.add('active') : btn.classList.remove('active');
      btn.setAttribute('aria-pressed', String(retrigOn));
    }
  }

  function _scheduleRetrigGateOff() {
    if (_retrigGateOffTimeoutId) {
      clearTimeout(_retrigGateOffTimeoutId);
      _retrigGateOffTimeoutId = null;
    }
    const gateOnMs = Math.max(20, Math.round(_retrigIntervalMs * _retrigGateRatio));
    _retrigGateOffTimeoutId = setTimeout(() => {
      _retrigGateOffTimeoutId = null;
      if (destroyed || !retrigOn || activeKeys.size === 0) return;
      _retrigGateOffState = true;
      for (const [, entry] of activeKeys) {
        entry.retrigMuted = true;
        if (entry.element) entry.element.classList.add('kbd-retrig-gate-off');
        onNoteOff(entry.actualNote);
      }
    }, gateOnMs);
  }

  function _stopRetrigLoop() {
    if (_retrigTimerId) {
      clearInterval(_retrigTimerId);
      _retrigTimerId = null;
    }
    if (_retrigGateOffTimeoutId) {
      clearTimeout(_retrigGateOffTimeoutId);
      _retrigGateOffTimeoutId = null;
    }
    if (_retrigGateOffState) {
      _retrigGateOffState = false;
      for (const [, entry] of activeKeys) {
        entry.retrigMuted = false;
        if (entry.element) {
          entry.element.classList.remove('kbd-retrig-gate-off');
          entry.element.classList.add('active');
        }
        onNoteOn(entry.actualNote, entry.velocity);
      }
    } else {
      for (const [, entry] of activeKeys) {
        entry.retrigMuted = false;
        if (entry.element) entry.element.classList.remove('kbd-retrig-gate-off');
      }
    }
  }

  function _startRetrigLoop() {
    _stopRetrigLoop();
    if (!retrigOn || destroyed) return;
    _scheduleRetrigGateOff();
    _retrigTimerId = setInterval(() => {
      if (destroyed || !retrigOn) {
        _stopRetrigLoop();
        return;
      }
      if (activeKeys.size === 0) {
        _retrigGateOffState = false;
        _scheduleRetrigGateOff();
        return;
      }
      for (const [, entry] of activeKeys) {
        if (!_retrigGateOffState && !entry.retrigMuted) {
          onNoteOff(entry.actualNote);
        }
        entry.retrigMuted = false;
        if (entry.element) {
          entry.element.classList.remove('kbd-retrig-gate-off');
          entry.element.classList.add('active');
        }
        onNoteOn(entry.actualNote, entry.velocity);
        if (onVelocityChange) onVelocityChange(entry.actualNote, entry.velocity);
      }
      _retrigGateOffState = false;
      _scheduleRetrigGateOff();
    }, _retrigIntervalMs);
  }

  function setRetrig(on) {
    const val = !!on;
    if (val === retrigOn) return;
    retrigOn = val;
    if (retrigOn) {
      _startRetrigLoop();
    } else {
      _stopRetrigLoop();
    }
    updateRetrigVisuals();
    if (cfg.enableAccessibility) announce(`Retrigger ${retrigOn ? 'on' : 'off'}`);
    if (onRetrigChange) onRetrigChange(retrigOn);
  }

  function toggleRetrig() { setRetrig(!retrigOn); }

  function setRetrigInterval(ms) {
    const clamped = Math.max(100, Math.min(5000, Number(ms) || 800));
    _retrigIntervalMs = clamped;
    cfg.retrigIntervalMs = clamped;
    if (retrigOn) _startRetrigLoop();
  }

  // ══════════════════════════════════════════════════════════════
  //  QWERTY KEY LABELS (UX2.4 — Z..M, Q..P visual hints)
  // ══════════════════════════════════════════════════════════════

  function setQwertyLabels(show) {
    _showQwertyLabels = !!show;
    cfg.showQwertyLabels = _showQwertyLabels;
    const hide = !_showQwertyLabels || !cfg.enableQwerty;
    container.classList.toggle('kbd-hide-qwerty-labels', hide);
    if (_keysWrapper) _keysWrapper.classList.toggle('kbd-hide-qwerty-labels', hide);
  }

  function toggleQwertyLabels() { setQwertyLabels(!_showQwertyLabels); }

  // ══════════════════════════════════════════════════════════════
  //  SCALE FILTER — lock keys to a musical scale
  // ══════════════════════════════════════════════════════════════

  let _scaleType = cfg.scaleType;
  let _scaleRoot = cfg.scaleRoot;
  let _scaleSnapMode = cfg.scaleSnapMode;
  let _scaleEnabled = cfg.enableScaleFilter;

  function getScaleIntervals() {
    return SCALE_INTERVALS[_scaleType] || SCALE_INTERVALS.major;
  }

  function applyScaleVisuals() {
    if (!_scaleEnabled) {
      getAllKeyElements().forEach((keyEl) => {
        keyEl.classList.remove('kbd-scale-in', 'kbd-scale-out');
      });
      return;
    }
    const intervals = getScaleIntervals();
    getAllKeyElements().forEach((keyEl) => {
      const midi = parseInt(keyEl.dataset.note, 10);
      const actualNote = Math.max(0, Math.min(127, midi + octaveShift));
      if (isInScale(actualNote, _scaleRoot, intervals)) {
        keyEl.classList.remove('kbd-scale-out');
        keyEl.classList.add('kbd-scale-in');
      } else {
        keyEl.classList.remove('kbd-scale-in');
        keyEl.classList.add('kbd-scale-out');
      }
    });
  }

  function setScaleFilter(type, root) {
    if (type === null || type === undefined) {
      _scaleEnabled = false;
      applyScaleVisuals();
      return;
    }
    _scaleEnabled = true;
    _scaleType = type;
    if (root !== undefined) _scaleRoot = root;
    applyScaleVisuals();
  }

  // ══════════════════════════════════════════════════════════════
  //  MULTIZONE SUPPORT (Sample / Synth Mapping)
  // ══════════════════════════════════════════════════════════════

  let _zones = Array.isArray(cfg.zones) ? [...cfg.zones] : [];
  let _activeZoneIndex = cfg.activeZoneIndex ?? 0;

  function applyZoneVisuals() {
    const keys = getAllKeyElements();
    if (!keys || keys.length === 0) return;

    keys.forEach((keyEl) => {
      keyEl.classList.remove(
        'kbd-in-zone',
        'kbd-in-active-zone',
        'kbd-zone-root',
        'kbd-zone-boundary-low',
        'kbd-zone-boundary-high'
      );
      keyEl.style.removeProperty('--kbd-zone-color');
    });

    if (!_zones || _zones.length === 0) return;

    keys.forEach((keyEl) => {
      const midi = parseInt(keyEl.dataset.note, 10);
      if (isNaN(midi)) return;

      for (let i = 0; i < _zones.length; i++) {
        const zone = _zones[i];
        if (!zone) continue;
        const low = zone.lowKey ?? zone.low ?? 0;
        const high = zone.highKey ?? zone.high ?? 127;
        const root = zone.rootKey ?? zone.root;
        const isActive = (i === _activeZoneIndex) || (zone.id != null && zone.id === _activeZoneIndex);

        if (midi >= low && midi <= high) {
          keyEl.classList.add('kbd-in-zone');
          if (isActive) {
            keyEl.classList.add('kbd-in-active-zone');
          }
          if (zone.color) {
            keyEl.style.setProperty('--kbd-zone-color', zone.color);
          }
          if (root != null && midi === root) {
            keyEl.classList.add('kbd-zone-root');
          }
          if (midi === low) {
            keyEl.classList.add('kbd-zone-boundary-low');
          }
          if (midi === high) {
            keyEl.classList.add('kbd-zone-boundary-high');
          }
        }
      }
    });
  }

  function setZones(zones, activeIndex) {
    _zones = Array.isArray(zones) ? [...zones] : [];
    if (activeIndex !== undefined) {
      _activeZoneIndex = activeIndex;
    }
    applyZoneVisuals();
  }

  function setActiveZone(indexOrId) {
    _activeZoneIndex = indexOrId;
    applyZoneVisuals();
  }

  function getZones() {
    return [..._zones];
  }

  function getActiveZone() {
    return _activeZoneIndex;
  }

  // ══════════════════════════════════════════════════════════════
  //  COLLAPSE / EXPAND
  // ══════════════════════════════════════════════════════════════

  function setCollapsed(collapsed) {
    if (!cfg.enableCollapse) return;
    const val = !!collapsed;
    if (val === _collapsed) return;
    _collapsed = val;
    const chevron = container.querySelector('.kbd-collapse-btn');
    if (chevron) {
      const label = chevron.querySelector('.kbd-collapse-chevron');
      if (label) label.textContent = _collapsed ? '▴' : '▾';
      chevron.setAttribute('aria-label', _collapsed ? 'Expand keyboard' : 'Collapse keyboard');
    }
    if (_collapsed) {
      container.classList.add('kbd-collapsed');
      if (_keysWrapper) _keysWrapper.classList.add('kbd-collapsed');
    } else {
      container.classList.remove('kbd-collapsed');
      if (_keysWrapper) _keysWrapper.classList.remove('kbd-collapsed');
    }
    if (cfg.enableAccessibility) announce(_collapsed ? 'Keyboard collapsed' : 'Keyboard expanded');
    if (onCollapseChange) onCollapseChange(_collapsed);
  }

  function toggleCollapse() { setCollapsed(!_collapsed); }

  // ══════════════════════════════════════════════════════════════
  //  CHORD MEMORY — save and replay note groups
  // ══════════════════════════════════════════════════════════════

  function _highlightKey(midiNote, velocity) {
    const keyEl = (_keysWrapper || container).querySelector(`[data-note="${midiNote}"]`);
    if (keyEl) {
      keyEl.classList.add('active');
      keyEl.style.setProperty('--kbd-led-color', cfg.ledColor || 'var(--color-accent)');
      if (velocity != null) keyEl.style.setProperty('--kbd-velocity', velocity.toFixed(3));
    }
  }

  function _releaseKey(midiNote) {
    for (const [baseNote, { actualNote, element }] of activeKeys) {
      if (actualNote === midiNote) {
        _latchedNotes.delete(baseNote);
        _cleanupKeyVisuals(element, true);
        activeKeys.delete(baseNote);
        return;
      }
    }
    _latchedNotes.delete(midiNote);
    const keyEl = (_keysWrapper || container).querySelector(`[data-note="${midiNote}"]`);
    if (keyEl) _cleanupKeyVisuals(keyEl, true);
  }

  function saveChord(slot, notes) {
    if (!cfg.enableChordMemory) return;
    const s = Math.max(0, Math.min(_chords.length - 1, slot));
    if (notes && Array.isArray(notes)) {
      _chords[s] = notes.slice().sort((a, b) => a - b);
    } else {
      _chords[s] = Array.from(activeKeys.values()).map(n => n.actualNote).sort((a, b) => a - b);
    }
    if (cfg.enableAccessibility) announce(`Chord ${s + 1} saved: ${_chords[s].length} notes`);
  }

  function playChord(slot) {
    if (!cfg.enableChordMemory) return;
    const s = Math.max(0, Math.min(_chords.length - 1, slot));
    const notes = _chords[s];
    if (!notes || notes.length === 0) return;
    for (const note of notes) {
      const vel = cfg.fixedVelocity;
      _highlightKey(note, vel);
      onNoteOn(note, vel);
      if (onVelocityChange) onVelocityChange(note, vel);
    }
    if (cfg.enableAccessibility) announce(`Chord ${s + 1} played: ${notes.length} notes`);
  }

  function releaseChord(slot) {
    if (!cfg.enableChordMemory) return;
    const s = Math.max(0, Math.min(_chords.length - 1, slot));
    const notes = _chords[s];
    if (!notes) return;
    for (const note of notes) { _releaseKey(note); onNoteOff(note); }
    if (cfg.enableAccessibility) announce(`Chord ${s + 1} released`);
  }

  function getChords() { return _chords.map(chord => chord ? [...chord] : null); }

  function clearChord(slot) {
    if (!cfg.enableChordMemory) return;
    const s = Math.max(0, Math.min(_chords.length - 1, slot));
    _chords[s] = null;
  }

  function clearAllChords() {
    if (!cfg.enableChordMemory) return;
    for (let i = 0; i < _chords.length; i++) _chords[i] = null;
  }

  // ══════════════════════════════════════════════════════════════
  //  PANIC
  // ══════════════════════════════════════════════════════════════

  function panic() {
    _activePointers.clear();
    _suppressedPointerUp.clear();
    if (retrigOn) setRetrig(false);
    else _stopRetrigLoop();
    _latchedNotes.clear();
    if (holdOn) setHold(false);
    if (sustainOn) setSustain(false);
    if (sostenutoOn) setSostenuto(false);
    if (softPedalOn) setSoftPedal(false);
    if (_channelAftertouch > 0) { _channelAftertouch = 0; if (onAftertouch) onAftertouch(-1, 0); }
    for (const [, { actualNote, element }] of activeKeys) {
      _cleanupKeyVisuals(element, true);
      onNoteOff(actualNote);
    }
    activeKeys.clear();
    qwertyActive.clear();
    if (cfg.enableAccessibility) announce('Panic: All notes off');
    panicFlash();
    if (onPanic) onPanic();
  }

  // ══════════════════════════════════════════════════════════════
  //  INIT
  // ══════════════════════════════════════════════════════════════

  function init() {
    renderKeybed();
    if (cfg.enableWheels) {
      pitchWheel = setupWheel(wheelPitchId, true);
      modWheel = setupWheel(wheelModId, false);
    }

    const octUp = document.getElementById(octUpId);
    const octDown = document.getElementById(octDownId);
    if (octUp) octUp.addEventListener('click', () => shiftOctave(1));
    if (octDown) octDown.addEventListener('click', () => shiftOctave(-1));

    // Panic button
    if (cfg.enablePanic) {
      if (panicBtnId) {
        const panicBtn = document.getElementById(panicBtnId);
        if (panicBtn) panicBtn.addEventListener('click', panic);
      } else {
        const autoPanic = document.createElement('div');
        autoPanic.className = 'kbd-panic-btn';
        autoPanic.setAttribute('role', 'button');
        autoPanic.setAttribute('tabindex', '0');
        autoPanic.setAttribute('aria-label', 'All Notes Off — Panic (Ctrl+Q)');
        autoPanic.setAttribute('title', 'Panic: All Notes Off (Ctrl+Q)');
        autoPanic.innerHTML = `<span class="kbd-panic-led"></span><span class="kbd-panic-label">ALL<br>OFF</span>`;
        autoPanic.addEventListener('click', panic);
        autoPanic.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); panic(); } });
        container.appendChild(autoPanic);
      }
    }

    // Sustain button
    if (sustainBtnId) {
      const sustainBtn = document.getElementById(sustainBtnId);
      if (sustainBtn) sustainBtn.addEventListener('click', toggleSustain);
    } else {
      const autoSustain = document.createElement('div');
      autoSustain.className = 'kbd-sustain-btn';
      autoSustain.setAttribute('role', 'button');
      autoSustain.setAttribute('tabindex', '0');
      autoSustain.setAttribute('aria-label', 'Sustain Pedal On/Off (Ctrl+Space)');
      autoSustain.setAttribute('title', 'Sustain Pedal: Toggle Hold (Ctrl+Space)');
      autoSustain.innerHTML = `<span class="kbd-sustain-led"></span><span class="kbd-sustain-label">SUST</span>`;
      autoSustain.addEventListener('click', toggleSustain);
      autoSustain.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSustain(); } });
      container.appendChild(autoSustain);
    }

    // Hold / Latch button (UX2.4)
    if (holdBtnId) {
      const holdBtn = document.getElementById(holdBtnId);
      if (holdBtn) holdBtn.addEventListener('click', toggleHold);
    } else if (cfg.enableHold) {
      const autoHold = document.createElement('div');
      autoHold.className = 'kbd-hold-btn';
      autoHold.setAttribute('role', 'button');
      autoHold.setAttribute('tabindex', '0');
      autoHold.setAttribute('aria-pressed', 'false');
      autoHold.setAttribute('aria-label', 'Hold / Latch Notes On/Off (Ctrl+H or Shift+Click key)');
      autoHold.setAttribute('title', 'Hold / Latch: Pin clicked notes for hands-free editing (Ctrl+H or Shift+Click key)');
      autoHold.innerHTML = `<span class="kbd-hold-led"></span><span class="kbd-hold-label">HOLD</span>`;
      autoHold.addEventListener('click', toggleHold);
      autoHold.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleHold(); } });
      container.appendChild(autoHold);
    }

    // Retrig / Auto-Repeat button (UX2.4)
    if (retrigBtnId) {
      const retrigBtn = document.getElementById(retrigBtnId);
      if (retrigBtn) retrigBtn.addEventListener('click', toggleRetrig);
    } else if (cfg.enableRetrig) {
      const autoRetrig = document.createElement('div');
      autoRetrig.className = 'kbd-retrig-btn';
      autoRetrig.setAttribute('role', 'button');
      autoRetrig.setAttribute('tabindex', '0');
      autoRetrig.setAttribute('aria-pressed', 'false');
      autoRetrig.setAttribute('aria-label', 'Retrigger Active Notes On/Off (Alt+R)');
      autoRetrig.setAttribute('title', 'Retrig: Periodically re-trigger held/latched notes while editing envelopes (Alt+R)');
      autoRetrig.innerHTML = `<span class="kbd-retrig-led"></span><span class="kbd-retrig-label">RETRIG</span>`;
      autoRetrig.addEventListener('click', toggleRetrig);
      autoRetrig.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleRetrig(); } });
      container.appendChild(autoRetrig);
    }

    // Sostenuto button (CC#66)
    if (sostenutoBtnId) {
      const sostBtn = document.getElementById(sostenutoBtnId);
      if (sostBtn) sostBtn.addEventListener('click', toggleSostenuto);
    } else if (cfg.enableSostenuto) {
      const autoSost = document.createElement('div');
      autoSost.className = 'kbd-sostenuto-btn';
      autoSost.setAttribute('role', 'button');
      autoSost.setAttribute('tabindex', '0');
      autoSost.setAttribute('aria-label', 'Sostenuto Pedal On/Off (CC#66)');
      autoSost.setAttribute('title', 'Sostenuto Pedal: Hold Active Notes (CC#66)');
      autoSost.innerHTML = `<span class="kbd-sostenuto-led"></span><span class="kbd-sostenuto-label">SOST</span>`;
      autoSost.addEventListener('click', toggleSostenuto);
      autoSost.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSostenuto(); } });
      container.appendChild(autoSost);
    }

    // Soft pedal button (CC#67)
    if (softPedalBtnId) {
      const softBtn = document.getElementById(softPedalBtnId);
      if (softBtn) softBtn.addEventListener('click', toggleSoftPedal);
    } else if (cfg.enableSoftPedal) {
      const autoSoft = document.createElement('div');
      autoSoft.className = 'kbd-soft-btn';
      autoSoft.setAttribute('role', 'button');
      autoSoft.setAttribute('tabindex', '0');
      autoSoft.setAttribute('aria-label', 'Soft Pedal On/Off (CC#67)');
      autoSoft.setAttribute('title', 'Soft Pedal: Attenuate Velocity (CC#67)');
      autoSoft.innerHTML = `<span class="kbd-soft-led"></span><span class="kbd-soft-label">SOFT</span>`;
      autoSoft.addEventListener('click', toggleSoftPedal);
      autoSoft.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSoftPedal(); } });
      container.appendChild(autoSoft);
    }

    // Collapse button
    if (cfg.enableCollapse) {
      const chevron = document.createElement('div');
      chevron.className = 'kbd-collapse-btn';
      chevron.setAttribute('role', 'button');
      chevron.setAttribute('tabindex', '0');
      chevron.setAttribute('aria-label', 'Collapse keyboard');
      chevron.setAttribute('title', 'Collapse/Expand keyboard');
      chevron.innerHTML = `<span class="kbd-collapse-chevron">▾</span>`;
      chevron.addEventListener('click', toggleCollapse);
      chevron.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCollapse(); } });
      container.appendChild(chevron);
    }

    if (cfg.enableQwerty) {
      window.addEventListener('keydown', handleKeydown);
      window.addEventListener('keyup', handleKeyup);
    }

    // Always listen to global pointerup/pointercancel so dragging outside the keybed releases cleanly
    window.addEventListener('pointerup', handleGlobalPointerUp);
    window.addEventListener('pointercancel', handleGlobalPointerUp);

    updateOctaveLEDs();

    if (cfg.enablePressureDisplay && (cfg.getPressureState || cfg.enableAftertouch)) {
      _pressureRafId = requestAnimationFrame(updatePressureDisplay);
    }

    setupAccessibility();
    applyScaleVisuals();

    // ResizeObserver
    let _lastWidth = 0, _lastHeight = 0;
    if (cfg.enableResizeObserver && typeof ResizeObserver !== 'undefined') {
      _resizeObserver = new ResizeObserver((entries) => {
        if (destroyed || _collapsed) return;
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          if (Math.abs(width - _lastWidth) < 6 && Math.abs(height - _lastHeight) < 6) continue;
          _lastWidth = width; _lastHeight = height;
          const availW = (_keysWrapper && _keysWrapper.clientWidth) || width;
          if (availW > 120 && !cfg.fixedOctaves) {
            const resp = calculateResponsiveLayout(availW);
            if (resp.octaves !== cfg.numOctaves || resp.startNote !== cfg.startNote) {
              cfg.numOctaves = resp.octaves;
              cfg.startNote = resp.startNote;
              renderKeybed();
              if (cfg.enableAccessibility) setupAccessibility();
              applyScaleVisuals();
              applyZoneVisuals();
            }
          }
        }
      });
      _resizeObserver.observe(container);
    }
  }

  init();

  return {
    panic,
    sweep,
    getOctave: () => octaveShift / 12,
    setOctave: (oct) => {
      octaveShift = Math.max(-cfg.maxOctaveShift * 12, Math.min(cfg.maxOctaveShift * 12, oct * 12));
      updateOctaveLEDs();
      if (cfg.enableAccessibility) announce(`Octave shift ${oct > 0 ? '+' : ''}${oct}`);
      if (onOctaveChange) onOctaveChange(oct);
    },
    releaseNote: (midiNote) => { _releaseKey(midiNote); onNoteOff(midiNote); },
    highlightNote: (midiNote, velocity) => { _highlightKey(midiNote, velocity); },
    // Host-driven feedback API (v0.2)
    setPitchBend,
    setModWheel,
    notesOffVisual,
    setSustain,
    getSustain: () => sustainOn,
    toggleSustain,
    // Hold / Latch API (UX2.4)
    setHold,
    getHold: () => holdOn,
    toggleHold,
    latchNote,
    unlatchNote,
    getLatchedNotes,
    // Retrig / Auto-Repeat API (UX2.4)
    setRetrig,
    getRetrig: () => retrigOn,
    toggleRetrig,
    setRetrigInterval,
    getRetrigInterval: () => _retrigIntervalMs,
    // QWERTY Labels API (UX2.4)
    setQwertyLabels,
    getQwertyLabels: () => _showQwertyLabels,
    toggleQwertyLabels,
    // Sostenuto API (CC#66)
    setSostenuto,
    getSostenuto: () => sostenutoOn,
    toggleSostenuto,
    // Soft Pedal API (CC#67)
    setSoftPedal,
    getSoftPedal: () => softPedalOn,
    toggleSoftPedal,
    // Scale Filter API
    setScaleFilter,
    getScaleFilter: () => _scaleEnabled ? { type: _scaleType, root: _scaleRoot, snapMode: _scaleSnapMode } : null,
    setScaleSnapMode: (mode) => { _scaleSnapMode = mode; cfg.scaleSnapMode = mode; applyScaleVisuals(); },
    disableScaleFilter: () => setScaleFilter(null),
    // Collapse API
    collapse: () => setCollapsed(true),
    expand: () => setCollapsed(false),
    toggleCollapse,
    isCollapsed: () => _collapsed,
    // Chord Memory API
    saveChord, playChord, releaseChord, getChords, clearChord, clearAllChords,
    // Aftertouch API
    setAftertouch: (note, pressure) => {
      const p = Math.max(0, Math.min(1, pressure));
      if (note === -1 || note === null) {
        if (p === _channelAftertouch) return;
        _channelAftertouch = p;
        if (onAftertouch) onAftertouch(-1, p);
      } else {
        if (onAftertouch) onAftertouch(note, p);
      }
    },
    releaseAftertouch: (note) => {
      if (note === -1 || note === null) { _channelAftertouch = 0; if (onAftertouch) onAftertouch(-1, 0); }
      else { if (onAftertouch) onAftertouch(note, 0); }
    },
    getAftertouch: () => _channelAftertouch,
    // Visual / config API
    setLedColor: (color) => { cfg.ledColor = color; },
    setOctaveCount: (numOctaves, startNote) => {
      cfg.numOctaves = numOctaves;
      if (startNote !== undefined) cfg.startNote = startNote;
      renderKeybed();
      applyScaleVisuals();
    },
    // Multizone mapping API
    setZones,
    setActiveZone,
    getZones,
    getActiveZone,
    getActiveNotes: () => Array.from(activeKeys.values()).map(n => n.actualNote),
    destroy: () => {
      destroyed = true;
      _stopRetrigLoop();
      if (_pressureRafId) cancelAnimationFrame(_pressureRafId);
      if (_resizeObserver) { _resizeObserver.disconnect(); _resizeObserver = null; }
      if (cfg.enableQwerty) { window.removeEventListener('keydown', handleKeydown); window.removeEventListener('keyup', handleKeyup); }
      window.removeEventListener('pointerup', handleGlobalPointerUp);
      window.removeEventListener('pointercancel', handleGlobalPointerUp);
      if (cfg.enableAccessibility) container.removeEventListener('keydown', handleA11yKeyNav);
      for (const wheel of wheels) wheel.destroy();
      container.innerHTML = '';
      activeKeys.clear();
      _latchedNotes.clear();
      qwertyActive.clear();
    }
  };
}

