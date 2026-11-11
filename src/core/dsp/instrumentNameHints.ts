// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Instrument Name Classification Hints
// Pure heuristics module decoupled from binary parsers.
// ─────────────────────────────────────────────────────────

/**
 * Classifies an instrument name into an acoustic category and Hartmann
 * Parameter Set (`0..9`) from preset/instrument/sample naming heuristics.
 */
export function classifyInstrumentAndParameterSet(name: string): {
  category: string;
  parameterSet: number;
} {
  const n = String(name || '').toLowerCase();
  if (/drum|kit|snare|kick|hihat|hat|tom|cymbal|conga|bongo|timpani|taiko|djembe|cajon|perc/.test(n)) {
    return { category: 'Drums & Percussion Kit', parameterSet: 8 };
  }
  if (/violin|viola|cello|contrabass|string|orchestra|ensemble|arco|pizz|quartet|symphon/.test(n)) {
    return { category: 'Orchestral & Strings', parameterSet: 1 };
  }
  if (/rhodes|wurli|clav|epiano|tine|fm piano|dx7/.test(n)) {
    return { category: 'Electric Pianos & Tines', parameterSet: 2 };
  }
  if (/piano|grand|upright|organ|harpsi|spinel|accord/.test(n)) {
    return { category: 'Keyboards & Acoustic Pianos', parameterSet: 2 };
  }
  if (/bass|sub|808|fretless|slap|contrabass|upright bass|synth bass|acid/.test(n)) {
    return { category: 'Bass & Low End', parameterSet: 4 };
  }
  if (/guitar|harp|banjo|mandolin|lute|sitar|koto|shamisen|oud|pipa|ukulele|pluck/.test(n)) {
    return { category: 'Plucked & Ethnic / World', parameterSet: 3 };
  }
  if (/sax|flute|oboe|clarinet|bassoon|wind|reed|harmonica|pipe|panflute|recorder|bagpipe/.test(n)) {
    return { category: 'Woodwinds & Reeds', parameterSet: 1 };
  }
  if (/trumpet|trombone|tuba|cornet|french horn|brass|fanfare/.test(n)) {
    return { category: 'Brass & Horns', parameterSet: 1 };
  }
  if (/choir|voice|vocal|vox|aah|ooh|soprano voice|tenor voice|opera|acapella|chant/.test(n)) {
    return { category: 'Vocal & Choir', parameterSet: 5 };
  }
  if (/bell|marimba|vibes|vibraphone|xylophone|glock|kalimba|chime|mallet|gong|tubular|celesta|music box/.test(n)) {
    return { category: 'Mallets & Chromatic Perc', parameterSet: 7 };
  }
  if (/pad|atmos|ambient|sweep|drone|warm|halo|shimmer|ethereal|soundscape/.test(n)) {
    return { category: 'Pads & Atmospheres', parameterSet: 6 };
  }
  if (/arp|loop|groove|beat|sequence|riff|phrase/.test(n)) {
    return { category: 'Arpeggiated & Sequences', parameterSet: 8 };
  }
  if (/lead|solo|mono|saw lead|square lead|sync lead|screamer/.test(n)) {
    return { category: 'Synth Leads & Solos', parameterSet: 0 };
  }
  if (/sfx|fx|noise|laser|riser|hit|impact|glitch|sweep|drop/.test(n)) {
    return { category: 'SFX, Drones & Cinematic', parameterSet: 9 };
  }
  return { category: 'Synth & Neutral', parameterSet: 0 };
}
