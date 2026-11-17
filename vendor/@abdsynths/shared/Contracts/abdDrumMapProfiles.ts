/**
 * @abdsynths/contracts — Contracts/abdDrumMapProfiles.ts
 * ============================================================================
 * Multi-standard & proprietary Drum Map Profiles + bidirectional Note Remapper.
 * Shared SSOT between ABDShared, ABDNeuModMakr, and ABDMCX0X.
 */

export type DrumMapMode =
  | 'gm_standard'
  | 'roland_gs_mc'
  | 'yamaha_xg_xs'
  | 'korg_ai2_n5'
  | 'hardware_native'
  | 'proprietary_custom';

export type DrumTriggerMode = 'one_shot' | 'gated';

export interface DrumSlotDefinition {
  note: number;
  name: string;
  category: string;
  muteGroup: number;
  triggerMode: DrumTriggerMode;
  pitchKeyTrack: boolean;
}

export interface DrumNoteRemapper {
  inputToSlot: Record<number, number>;
  slotToExternal: Record<number, number>;
}

export interface DrumMapProfile {
  schemaVersion: '1.0.0';
  mode: DrumMapMode;
  hardwareId?: string;
  name: string;
  minNote: number;
  maxNote: number;
  slots: DrumSlotDefinition[];
  remapper?: DrumNoteRemapper;
}

export const DRUM_MAP_MODES: readonly DrumMapMode[] = [
  'gm_standard', 'roland_gs_mc', 'yamaha_xg_xs', 'korg_ai2_n5', 'hardware_native', 'proprietary_custom',
];

export const GM_CORE_NOTES: Record<number, string> = {
  35: 'Acoustic Bass Drum', 36: 'Bass Drum 1', 37: 'Side Stick', 38: 'Acoustic Snare',
  39: 'Hand Clap', 40: 'Electric Snare', 41: 'Low Floor Tom', 42: 'Closed Hi-Hat',
  43: 'High Floor Tom', 44: 'Pedal Hi-Hat', 45: 'Low Tom', 46: 'Open Hi-Hat',
  47: 'Low-Mid Tom', 48: 'Hi-Mid Tom', 49: 'Crash Cymbal 1', 50: 'High Tom',
  51: 'Ride Cymbal 1', 52: 'Chinese Cymbal', 53: 'Ride Bell', 54: 'Tambourine',
  55: 'Splash Cymbal', 56: 'Cowbell', 57: 'Crash Cymbal 2', 58: 'Vibraslap',
  59: 'Ride Cymbal 2', 60: 'Hi Bongo', 61: 'Low Bongo', 62: 'Mute Hi Conga',
  63: 'Open Hi Conga', 64: 'Low Conga', 65: 'High Timbale', 66: 'Low Timbale',
  67: 'High Agogo', 68: 'Low Agogo', 69: 'Cabasa', 70: 'Maracas',
  71: 'Short Whistle', 72: 'Long Whistle', 73: 'Short Guiro', 74: 'Long Guiro',
  75: 'Claves', 76: 'Hi Wood Block', 77: 'Low Wood Block', 78: 'Mute Cuica',
  79: 'Open Cuica', 80: 'Mute Triangle', 81: 'Open Triangle',
};

const ROLAND_GS_MC_EXTRA: Record<number, string> = {
  11: '909 Snare 1', 12: '808 Snare 4', 13: 'Rim Snare 1', 14: 'Hyper Snare 1', 15: 'Hyper Snare 2',
  16: 'Finger Snap', 17: '909 Bass Drum 1', 18: 'Cave Bass Drum', 19: '808 Bass Drum 1', 20: '909 Bass Drum 3',
  21: 'Blip Bass Drum', 22: '606 Bass Drum 3', 23: '909 Bass Drum 9', 24: '909 Bass Drum Alt', 25: 'Snare Roll',
  26: 'Finger Snap Alt', 27: 'High Q', 28: 'Slap', 29: 'Scratch Push', 30: 'Scratch Pull',
  31: 'Sticks', 32: 'Square Click', 33: 'Metronome Click', 34: 'Metronome Bell',
  82: 'Shaker', 83: 'Jingle Bell', 84: 'Belltree', 85: 'Castanets', 86: 'Mute Surdo', 87: 'Open Surdo',
  88: 'Douby / Hit', 89: 'Strings Hit', 90: 'Syn Perc', 91: 'MG Blip 1', 92: 'Rev Blip',
  93: 'Vocal Ha!', 94: 'Vocal Hoo!', 95: 'Brass Fall', 96: 'Scratch Push FX', 97: 'Scratch Pull FX',
  98: 'Scratch Rewind', 99: 'Tape Rewind', 100: 'Vinyl Stop', 101: 'Laughing', 102: 'Screaming',
  103: 'Car Pass', 104: 'Car Crash', 105: 'Helicopter', 106: 'Jetplane', 107: 'Laser Gun',
  108: 'Burst Noise', 109: 'Starship', 110: 'Analog FX', 111: 'Bird', 112: 'Bubble',
  113: 'Wind', 114: 'Stream', 115: 'Seashore', 116: 'Thunder', 117: 'Applause', 118: 'Explosion',
  126: 'Metronome Low', 127: 'Metronome Hi',
};

const YAMAHA_XG_XS_EXTRA: Record<number, string> = {
  13: 'Surdo Mute', 14: 'Surdo Open', 15: 'Hi Q', 16: 'Whip Slap', 17: 'Scratch Push', 18: 'Scratch Pull',
  19: 'Finger Snap', 20: 'Click Noise', 21: 'Metronome Click', 22: 'Metronome Bell', 23: 'Seq Click L', 24: 'Seq Click H',
  25: 'Brush Tap', 26: 'Brush Swirl', 27: 'Brush Slap', 28: 'Brush Swirl W/Attack', 29: 'Snare Roll', 30: 'Castanet',
  31: 'Snare Soft', 32: 'Sticks', 33: 'Kick Soft', 34: 'Open Rim Shot', 82: 'Shaker', 83: 'Jingle Bell',
  84: 'Bell Tree', 85: 'XS Rim Heavy', 86: 'XS Mute Surdo', 87: 'XS Open Surdo', 88: 'XS Synth Kick',
  89: 'XS Techno Clap', 90: 'XS Analog Hat C', 91: 'XS Analog Hat O', 92: 'XS Break Snare', 93: 'XS Lo-Fi Rim',
  94: 'XS Hit Cymbal', 95: 'XS Electro Tom', 96: 'XS Perc Loop Hit', 97: 'XS Vox Breath', 98: 'XS Noise Sweep',
  99: 'XS Reverse Crash', 100: 'XS Sub Drop',
};

const KORG_AI2_N5_EXTRA: Record<number, string> = {
  24: 'Orch / Synth BD', 25: 'Rim Snare Korg', 26: 'Brush Tap', 27: 'High Q', 28: 'Slap',
  29: 'Scratch Push', 30: 'Scratch Pull', 31: 'Sticks', 32: 'Square Click', 33: 'Metronome Click',
  34: 'Metronome Bell', 82: 'Shaker', 83: 'Jingle Bell', 84: 'Wind Chimes', 85: 'Castanets',
};

const HARDWARE_NATIVE_MAPS: Record<string, Record<number, string>> = {
  boss_dr5: { 35: 'DR-5 Kick 2', 36: 'DR-5 Kick 1', 37: 'DR-5 Rimshot', 38: 'DR-5 Snare 1', 39: 'DR-5 Clap', 42: 'DR-5 Closed Hat', 44: 'DR-5 Pedal Hat', 46: 'DR-5 Open Hat', 49: 'DR-5 Crash', 51: 'DR-5 Ride' },
  quasimidi_309: { 36: '309 Kick Section', 38: '309 Snare Section', 42: '309 Hi-Hat Closed', 46: '309 Hi-Hat Open', 48: '309 Perc Set A', 50: '309 Perc Set B' },
  emu_orbit_carnival: { 36: 'E-mu Sub Kick', 37: 'E-mu Tight Rim', 38: 'E-mu Break Snare', 39: 'E-mu Dance Clap', 42: 'E-mu Closed Hat', 46: 'E-mu Open Hat', 48: 'Orbit Hit 1', 50: 'Orbit Beat Slice' },
  akai_mpc: Object.fromEntries(Array.from({ length: 16 }, (_, i) => [36 + i, `Pad A${String(i + 1).padStart(2, '0')}`])),
  elektron_8track: { 0: 'Track 1 Kick', 1: 'Track 2 Snare', 2: 'Track 3 Tom / Rim', 3: 'Track 4 Clap', 4: 'Track 5 Cowbell / Perc', 5: 'Track 6 Closed Hat', 6: 'Track 7 Open Hat', 7: 'Track 8 Cymbal / FX' },
};

export function inferDrumMuteGroup(name: string): number {
  if (/hi-?hat|closed\s*hh|open\s*hh|\bhat\b/i.test(name)) return 1;
  if (/triangle/i.test(name)) return 2;
  if (/cuica/i.test(name)) return 3;
  if (/whistle/i.test(name)) return 4;
  if (/guiro/i.test(name)) return 5;
  if (/surdo/i.test(name)) return 6;
  if (/scratch/i.test(name)) return 7;
  return 0;
}

export function classifyDrumNoteCategory(name: string): string {
  if (/kick|bass drum|\bbd\b/i.test(name)) return 'kick';
  if (/snare|\bsd\b/i.test(name)) return 'snare';
  if (/rim|side stick/i.test(name)) return 'sidestick';
  if (/clap|snap/i.test(name)) return 'clap';
  if (/closed.*hat|closed hh/i.test(name)) return 'hat_closed';
  if (/pedal.*hat/i.test(name)) return 'hat_pedal';
  if (/open.*hat|\boh\b/i.test(name)) return 'hat_open';
  if (/tom/i.test(name)) return 'tom';
  if (/crash|ride|cymbal|splash|chinese/i.test(name)) return 'cymbal';
  if (/vox|vocal|laugh|scream|ha!|hoo!/i.test(name)) return 'vocal';
  if (/loop|slice|hit|fall|sweep|drop|fx|laser|wind|thunder|car|helicopter|jet|explosion/i.test(name)) return 'fx';
  return 'perc';
}

export function getDrumNoteMap(mode: DrumMapMode, hardwareId = 'boss_dr5'): Record<number, string> {
  if (mode === 'gm_standard') return { ...GM_CORE_NOTES };
  if (mode === 'roland_gs_mc') return { ...GM_CORE_NOTES, ...ROLAND_GS_MC_EXTRA };
  if (mode === 'yamaha_xg_xs') return { ...GM_CORE_NOTES, ...YAMAHA_XG_XS_EXTRA };
  if (mode === 'korg_ai2_n5') return { ...GM_CORE_NOTES, ...KORG_AI2_N5_EXTRA };
  if (mode === 'hardware_native') return { ...(HARDWARE_NATIVE_MAPS[hardwareId] ?? HARDWARE_NATIVE_MAPS.boss_dr5) };
  return Object.fromEntries(Array.from({ length: 128 }, (_, n) => [n, `Custom Slot ${n}`]));
}

export function getDrumSlotName(mode: DrumMapMode, midiNote: number, hardwareId = 'boss_dr5'): string | null {
  return getDrumNoteMap(mode, hardwareId)[midiNote] ?? null;
}

export function getDrumMapProfile(mode: DrumMapMode, hardwareId = 'boss_dr5'): DrumMapProfile {
  const noteMap = getDrumNoteMap(mode, hardwareId);
  const notes = Object.keys(noteMap).map(Number).sort((a, b) => a - b);
  const slots: DrumSlotDefinition[] = notes.map((note) => {
    const name = noteMap[note];
    const isGated = /brass fall|loop|strings hit|wind|seashore|stream|rain/i.test(name);
    return {
      note,
      name,
      category: classifyDrumNoteCategory(name),
      muteGroup: inferDrumMuteGroup(name),
      triggerMode: isGated ? 'gated' : 'one_shot',
      pitchKeyTrack: false,
    };
  });
  return {
    schemaVersion: '1.0.0',
    mode,
    ...(mode === 'hardware_native' ? { hardwareId } : {}),
    name: mode === 'hardware_native' ? `Hardware Native (${hardwareId})` : mode,
    minNote: notes[0] ?? 0,
    maxNote: notes[notes.length - 1] ?? 127,
    slots,
  };
}

export function resolveRemappedDrumNote(
  note: number,
  remapper?: DrumNoteRemapper,
  direction: 'input' | 'external' = 'input'
): number {
  const clamped = Math.max(0, Math.min(127, Math.round(note)));
  if (!remapper) return clamped;
  const table = direction === 'input' ? remapper.inputToSlot : remapper.slotToExternal;
  const mapped = table?.[clamped];
  return typeof mapped === 'number' && mapped >= 0 && mapped <= 127 ? Math.round(mapped) : clamped;
}
