// ─────────────────────────────────────────────────────────────────────────────
// @abdsynths/shared — Scala Microtuning & Alternative Scale Parser (.scl / .kbm)
//
// Pure TypeScript clean-room parser for:
//   1. Huygens-Fokker Scala Scale format (.scl):
//      - Header description line
//      - Number of notes in the scale (e.g. 12, 19, 24, 31, 53, etc.)
//      - Pitch values: either cents with decimal dot (e.g. "100.0", "1200.0")
//        or rational frequency ratios (e.g. "9/8", "5/4", "3/2", "2/1")
//   2. Scala Keyboard Mapping format (.kbm):
//      - Map size, first/last MIDI note, middle note, reference note/frequency, scale degree mapping
//   3. Microtuning Table Generator:
//      - Generates exact frequency (Hz) and pitch deviation in cents (-100..+100)
//        for each of the 128 standard MIDI notes (0..127).
// ─────────────────────────────────────────────────────────────────────────────

export interface ScalaScale {
  description: string;
  count: number;
  /** Intervals in cents relative to scale root (0 is implicit base note) */
  intervalsCents: number[];
  /** Formal formal notation: cents or ratio string */
  rawIntervals: string[];
}

export interface ScalaKeyboardMapping {
  mapSize: number;
  firstMidi: number;
  lastMidi: number;
  middleMidi: number;
  referenceMidi: number;
  referenceFrequencyHz: number;
  scaleDegreeForMiddle: number;
  keys: number[]; // Mapping of MIDI key to scale degree (0..count-1)
}

export interface MicrotuningTable {
  scaleName: string;
  /** Frequency in Hz for each MIDI note 0..127 */
  frequenciesHz: Float64Array;
  /** Cents deviation from standard 12-TET tuning (A4 = 440 Hz) for notes 0..127 */
  centsOffsetFrom12Tet: Float32Array;
}

/** Standard 12-EDO / 12-TET frequency for note n with A4 (69) = 440 Hz */
export function standard12TetFrequency(note: number, a4Hz = 440.0): number {
  return a4Hz * Math.pow(2.0, (note - 69) / 12.0);
}

/**
 * Parses a Scala scale definition (.scl).
 */
export function parseScalaScale(content: string): ScalaScale {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('!')); // Strip empty lines and comments

  if (lines.length < 2) {
    throw new Error('Invalid Scala scale: missing description or degree count.');
  }

  const description = lines[0];
  const count = parseInt(lines[1], 10);
  if (Number.isNaN(count) || count < 0) {
    throw new Error(`Invalid Scala degree count: ${lines[1]}`);
  }

  const intervalsCents: number[] = [];
  const rawIntervals: string[] = [];

  for (let i = 2; i < lines.length && intervalsCents.length < count; i++) {
    const token = lines[i].split(/\s+/)[0];
    if (!token) continue;

    rawIntervals.push(token);

    if (token.includes('.')) {
      // Cents value
      const cents = parseFloat(token);
      intervalsCents.push(cents);
    } else if (token.includes('/')) {
      // Rational ratio (num / den)
      const parts = token.split('/');
      const num = parseFloat(parts[0]);
      const den = parseFloat(parts[1]);
      if (den === 0 || Number.isNaN(num) || Number.isNaN(den)) {
        throw new Error(`Invalid ratio: ${token}`);
      }
      const ratio = num / den;
      const cents = 1200.0 * (Math.log(ratio) / Math.LN2);
      intervalsCents.push(cents);
    } else {
      // Integer ratio (e.g. 2 = octave)
      const intVal = parseInt(token, 10);
      if (!Number.isNaN(intVal) && intVal > 0) {
        const cents = 1200.0 * (Math.log(intVal) / Math.LN2);
        intervalsCents.push(cents);
      }
    }
  }

  return {
    description,
    count: intervalsCents.length,
    intervalsCents,
    rawIntervals,
  };
}

/**
 * Builds a full 128-note microtuning table from a Scala scale and optional keyboard mapping.
 */
export function createMicrotuningTable(
  scale: ScalaScale,
  mapping?: Partial<ScalaKeyboardMapping>,
  a4Hz = 440.0
): MicrotuningTable {
  const freqs = new Float64Array(128);
  const centsOffset = new Float32Array(128);

  const refNote = mapping?.referenceMidi ?? 69; // A4
  const refFreq = mapping?.referenceFrequencyHz ?? a4Hz;
  const middleNote = mapping?.middleMidi ?? 60; // Middle C

  // Scale repeats by the formal octave interval (last entry, usually 1200 cents / 2/1)
  const formalOctaveCents =
    scale.intervalsCents.length > 0
      ? scale.intervalsCents[scale.intervalsCents.length - 1]
      : 1200.0;
  const N = Math.max(1, scale.count);

  for (let note = 0; note < 128; note++) {
    // Delta relative to middle note
    const deltaKeys = note - middleNote;
    let octaveStep = Math.floor(deltaKeys / N);
    let scaleDegree = deltaKeys % N;
    if (scaleDegree < 0) {
      scaleDegree += N;
    }

    const degreeCents = scaleDegree === 0 ? 0 : scale.intervalsCents[scaleDegree - 1];
    const totalCentsFromMiddle = octaveStep * formalOctaveCents + degreeCents;

    // Derive middle note frequency based on refNote
    const refDelta = refNote - middleNote;
    const refOct = Math.floor(refDelta / N);
    let refDeg = refDelta % N;
    if (refDeg < 0) refDeg += N;
    const refDegCents = refDeg === 0 ? 0 : scale.intervalsCents[refDeg - 1];
    const refTotalCentsFromMiddle = refOct * formalOctaveCents + refDegCents;

    const middleFreqHz = refFreq / Math.pow(2.0, refTotalCentsFromMiddle / 1200.0);
    const noteFreqHz = middleFreqHz * Math.pow(2.0, totalCentsFromMiddle / 1200.0);
    freqs[note] = noteFreqHz;

    // Compare with standard 12-TET note frequency
    const standardHz = standard12TetFrequency(note, a4Hz);
    const diffCents = 1200.0 * (Math.log(noteFreqHz / standardHz) / Math.LN2);
    centsOffset[note] = diffCents;
  }

  return {
    scaleName: scale.description || 'Scala Microtuning',
    frequenciesHz: freqs,
    centsOffsetFrom12Tet: centsOffset,
  };
}

/**
 * Clean-room parametric Railsback stretch-tuning curve generator.
 * Models acoustic string inharmonicity: bass notes are progressively flat and
 * treble notes progressively sharp around `referenceMidi` (default A4 = 69).
 * `amount01` in 0..1 scales the maximum deviation (up to ~±35 cents at extremes).
 */
export function createRailsbackStretchTable(
  amount01: number,
  referenceMidi = 69,
): Float32Array {
  const amt = Math.max(0, Math.min(1, Number.isFinite(amount01) ? amount01 : 0));
  const out = new Float32Array(128);
  if (amt <= 0) return out;

  for (let note = 0; note < 128; note++) {
    const semi = note - referenceMidi;
    const oct = semi / 12.0;
    // Asymmetric cubic-like stretch: gentle in middle register, steeper in bass/treble extremes
    const sign = oct >= 0 ? 1 : -1;
    const absOct = Math.abs(oct);
    const baseCents = sign * (1.8 * absOct + 1.15 * Math.pow(absOct, 2.15));
    // Slight extra treble stretch above C6 (84)
    const trebleBoost = note > 84 ? 0.35 * ((note - 84) / 12.0) ** 1.6 : 0;
    out[note] = Math.max(-45, Math.min(45, (baseCents + trebleBoost) * amt));
  }
  return out;
}

/**
 * Applies a per-note cents stretch table on top of an existing `MicrotuningTable`.
 */
export function applyStretchTuningToTable(
  base: MicrotuningTable,
  stretchCents: Float32Array,
): MicrotuningTable {
  const frequenciesHz = new Float64Array(128);
  const centsOffsetFrom12Tet = new Float32Array(128);
  for (let note = 0; note < 128; note++) {
    const delta = stretchCents[note] ?? 0;
    frequenciesHz[note] = base.frequenciesHz[note] * Math.pow(2.0, delta / 1200.0);
    centsOffsetFrom12Tet[note] = base.centsOffsetFrom12Tet[note] + delta;
  }
  return {
    scaleName: `${base.scaleName} + Stretch`,
    frequenciesHz,
    centsOffsetFrom12Tet,
  };
}
