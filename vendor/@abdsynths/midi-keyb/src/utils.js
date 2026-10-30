/**
 * ABDKeyboard — Pure Utility Functions
 * ======================================
 * Stateless helpers for MIDI note handling, velocity curves, scale theory,
 * per-key textures, and the CZ-101 preset.
 *
 * Extracted from keyboard.js to keep the main component file focused on
 * stateful logic and DOM interactions.
 */

// ── QWERTY mapping (Ableton/JUCE standard) ──
export const QWERTY_MAP = {
  'z': 0, 's': 1, 'x': 2, 'd': 3, 'c': 4, 'v': 5, 'g': 6, 'b': 7,
  'h': 8, 'n': 9, 'j': 10, 'm': 11, ',': 12, 'l': 13, '.': 14, ';': 15, '/': 16,
  'q': 12, '2': 13, 'w': 14, '3': 15, 'e': 16, 'r': 17, '5': 18, 't': 19,
  '6': 20, 'y': 21, '7': 22, 'u': 23, 'i': 24, '9': 25, 'o': 26, '0': 27,
  'p': 28, '[': 29, '=': 30, ']': 31
};

// Canonical display label per semitone offset from startNote (Z..M lower row, Q..] upper row)
export const OFFSET_TO_QWERTY_LABEL = {
  0: 'Z', 1: 'S', 2: 'X', 3: 'D', 4: 'C', 5: 'V', 6: 'G', 7: 'B',
  8: 'H', 9: 'N', 10: 'J', 11: 'M',
  12: 'Q', 13: '2', 14: 'W', 15: '3', 16: 'E', 17: 'R', 18: '5', 19: 'T',
  20: '6', 21: 'Y', 22: '7', 23: 'U',
  24: 'I', 25: '9', 26: 'O', 27: '0', 28: 'P', 29: '[', 30: '=', 31: ']'
};

/** Return the visual QWERTY key label for a given keybed MIDI note, or null if out of QWERTY range */
export function getQwertyLabelForNote(midiNote, startNote) {
  const offset = midiNote - startNote;
  return OFFSET_TO_QWERTY_LABEL[offset] || null;
}


export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const OCTAVE_PATTERN = [
  { offset: 0, sharp: 1 }, { offset: 2, sharp: 3 }, { offset: 4, sharp: null },
  { offset: 5, sharp: 6 }, { offset: 7, sharp: 8 }, { offset: 9, sharp: 10 }, { offset: 11, sharp: null }
];

/** Convert MIDI note number to readable name (e.g., 60 → 'C4') */
export function midiToName(midi) {
  return NOTE_NAMES[midi % 12] + Math.floor(midi / 12 - 1);
}

// ── Velocity curves (from ABDEep) ──
export function applyVelocityCurve(raw, curve) {
  switch (curve) {
    case 'soft':   return raw * raw;
    case 'hard':   return Math.sqrt(raw);
    case 'linear': return raw;
    case 'fixed':  return 100 / 127;
    default:       return raw; // 'normal'
  }
}

// ── Scale definitions (semitone intervals from root) ──
export const SCALE_INTERVALS = {
  major:           [0, 2, 4, 5, 7, 9, 11],
  minor:           [0, 2, 3, 5, 7, 8, 10],
  harmonicMinor:   [0, 2, 3, 5, 7, 8, 11],
  melodicMinor:    [0, 2, 3, 5, 7, 9, 11],
  dorian:          [0, 2, 3, 5, 7, 9, 10],
  phrygian:        [0, 1, 3, 5, 7, 8, 10],
  lydian:          [0, 2, 4, 6, 7, 9, 11],
  mixolydian:      [0, 2, 4, 5, 7, 9, 10],
  locrian:         [0, 1, 3, 5, 6, 8, 10],
  pentatonicMajor: [0, 2, 4, 7, 9],
  pentatonicMinor: [0, 3, 5, 7, 10],
  blues:           [0, 3, 5, 6, 7, 10],
  wholeTone:       [0, 2, 4, 6, 8, 10],
  chromatic:       [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  japanese:        [0, 1, 5, 7, 8],
  arabian:         [0, 2, 4, 5, 6, 8, 10],
};

/** Check if a MIDI note belongs to a scale */
export function isInScale(midiNote, rootNote, intervals) {
  const semitone = ((midiNote - rootNote) % 12 + 12) % 12;
  return intervals.includes(semitone);
}

/** Find nearest note in scale (for snap mode) */
export function snapToScale(midiNote, rootNote, intervals) {
  const semitone = ((midiNote - rootNote) % 12 + 12) % 12;
  if (intervals.includes(semitone)) return midiNote;
  for (let offset = 1; offset <= 6; offset++) {
    if (intervals.includes((semitone + offset) % 12)) return midiNote + offset;
    if (intervals.includes((semitone - offset + 12) % 12)) return midiNote - offset;
  }
  return midiNote;
}

// ── Presets ──
/** CZ-101 preset: 49 keys, vintage wear, no wheels, QWERTY enabled */
export const CZ101_PRESET = {
  numOctaves: 4,
  startNote: 48, // C3 (CZ-101 range: C3–C7)
  enableVintageWear: true,
  enableQwerty: true,
  enableIvoryTexture: false,
  enablePressureDisplay: false,
  enablePitchBendDisplace: false,
  enableAftertouch: false,
};

// ── Per-key ivory texture (from ABDEep) ──
export function applyIvoryTexture(key, midiNote) {
  const seed = (midiNote * 12345) % 100;
  const hue = 40 + (seed % 6 - 3);
  const sat = 18 + (seed % 6);
  const light = 90 - (seed % 5);
  const dirtStart = 85 + (seed % 10);
  const dirtOpacity = 0.05 + (seed % 12) / 100.0;
  key.style.setProperty('--kbd-ivory-base', `hsl(${hue}, ${sat}%, ${light}%)`);
  key.style.setProperty('--kbd-ivory-top', `hsl(${hue}, ${sat}%, ${light + 6}%)`);
  key.style.setProperty('--kbd-ivory-bottom', `hsl(${hue}, ${sat}%, ${light - 5}%)`);
  key.style.setProperty('--kbd-dirt-color', `rgba(105, 90, 75, ${dirtOpacity})`);
  key.style.setProperty('--kbd-dirt-start', `${dirtStart}%`);
}

// ── Vintage wear stains (from ABDCZ101) ──
export function applyVintageWear(key, midiNote, isBlack) {
  const h = (midiNote * 2654435761) % 100;
  if (isBlack) {
    if (h % 7 === 0) key.classList.add('kbd-stain-worn');
    return;
  }
  if (h % 5 === 0) key.classList.add('kbd-stain-yellow');
  if (h % 9 === 0) key.classList.add('kbd-stain-scuff');
  if (h % 13 === 0) key.classList.add('kbd-stain-ding');
}
