// ─────────────────────────────────────────────────────────
// SoundFont & Professional Sampler Standard Metadata Dictionary
// Compliant with SoundFont 2.04 RIFF INFO-list chunk specification
// and professional acoustic sampler standards (Kontakt, SFZ, HALion).
// ─────────────────────────────────────────────────────────

export interface StandardMetadataTagDef {
  key: string;
  label: string;
  category:
    | 'SoundFont 2 (RIFF INFO)'
    | 'Studio & Recording Chain'
    | 'Acoustic & Instrument Identity'
    | 'Sampler & Performance';
  placeholder: string;
  description: string;
}

export const STANDARD_SOUNDFONT_TAGS: readonly StandardMetadataTagDef[] = [
  // 1. Official SoundFont 2.04 RIFF INFO Specification
  {
    key: 'IENG',
    label: 'IENG — Sound Designer / Engineer',
    category: 'SoundFont 2 (RIFF INFO)',
    placeholder: 'e.g. John Chowning, Sound Design Lab',
    description: 'SF2 INFO IENG: Names of the sound design or audio engineering team',
  },
  {
    key: 'ICOP',
    label: 'ICOP — Copyright Statement',
    category: 'SoundFont 2 (RIFF INFO)',
    placeholder: 'e.g. © 2026 ABDSynths. All rights reserved.',
    description: 'SF2 INFO ICOP: Copyright assertion and legal ownership',
  },
  {
    key: 'ICRD',
    label: 'ICRD — Creation Date',
    category: 'SoundFont 2 (RIFF INFO)',
    placeholder: 'e.g. 2026-10-30',
    description: 'SF2 INFO ICRD: Date the audio samples or preset were authored',
  },
  {
    key: 'ISFT',
    label: 'ISFT — Authoring Software / Tool',
    category: 'SoundFont 2 (RIFF INFO)',
    placeholder: 'e.g. ABDNeuModMakr v1.2 / Polyphone',
    description: 'SF2 INFO ISFT: SoundFont creation and editing software used',
  },
  {
    key: 'IPRD',
    label: 'IPRD — Target Product / Synth',
    category: 'SoundFont 2 (RIFF INFO)',
    placeholder: 'e.g. Hartmann Neuron, ABDAxionikVS',
    description: 'SF2 INFO IPRD: Hardware instrument or synthesizer intended for playback',
  },
  {
    key: 'ICMT',
    label: 'ICMT — Comments & Performance Notes',
    category: 'SoundFont 2 (RIFF INFO)',
    placeholder: 'e.g. Recorded at 96kHz with analog valve saturation',
    description: 'SF2 INFO ICMT: Free-text remarks, microphone notes, and performance tips',
  },
  {
    key: 'isng',
    label: 'isng — Sound Engine Target',
    category: 'SoundFont 2 (RIFF INFO)',
    placeholder: 'e.g. EMU8000, AxionikVS DSP',
    description: 'SF2 INFO isng: Target wavetable synthesis engine',
  },

  // 2. Studio & Recording Chain
  {
    key: 'Microphone',
    label: 'Microphone — Transducer Model',
    category: 'Studio & Recording Chain',
    placeholder: 'e.g. Neumann U87 Ai, AKG C414, Coles 4038',
    description: 'Microphone model used to record the acoustic source',
  },
  {
    key: 'MicPosition',
    label: 'Mic Position — Placement',
    category: 'Studio & Recording Chain',
    placeholder: 'e.g. Close (15cm), Overhead, Room (3m), Binaural',
    description: 'Physical perspective or distance of the microphone',
  },
  {
    key: 'Preamp',
    label: 'Preamp / Console — Outboard Chain',
    category: 'Studio & Recording Chain',
    placeholder: 'e.g. Neve 1073, API 512c, SSL 4000G, Avalon VT-737',
    description: 'Analog preamplification and console signal path',
  },
  {
    key: 'AcousticSpace',
    label: 'Acoustic Space — Hall / Studio',
    category: 'Studio & Recording Chain',
    placeholder: 'e.g. AIR Lyndhurst Hall, Dry Iso-Booth, Abbey Road Studio 2',
    description: 'Venue or acoustic room where samples were tracked',
  },

  // 3. Acoustic & Instrument Identity
  {
    key: 'InstrumentMake',
    label: 'Instrument Make — Manufacturer / Luthier',
    category: 'Acoustic & Instrument Identity',
    placeholder: 'e.g. Steinway & Sons Model D, Fender Rhodes Mark I',
    description: 'Physical maker, brand, or model of the recorded instrument',
  },
  {
    key: 'Year',
    label: 'Year — Vintage / Fabrication',
    category: 'Acoustic & Instrument Identity',
    placeholder: 'e.g. 1974, 1982, 2026',
    description: 'Year of manufacturing of the acoustic or vintage instrument',
  },
  {
    key: 'Tuning',
    label: 'Tuning — Concert Pitch / Temperament',
    category: 'Acoustic & Instrument Identity',
    placeholder: 'e.g. A=440 Hz Equal Temperament, A=432 Hz Pythagorean',
    description: 'Reference concert pitch and musical tuning temperament',
  },

  // 4. Sampler & Performance Architecture
  {
    key: 'Genre',
    label: 'Genre — Musical Style',
    category: 'Sampler & Performance',
    placeholder: 'e.g. Cinematic Orchestral, Ambient, Techno, Jazz',
    description: 'Intended musical genre or acoustic context',
  },
  {
    key: 'RoundRobin',
    label: 'Round Robin — Hit Alternation',
    category: 'Sampler & Performance',
    placeholder: 'e.g. 4x Round Robin (Cycle / Random)',
    description: 'Hit repetition cycling to prevent machine-gunning',
  },
  {
    key: 'DynamicLayers',
    label: 'Dynamic Layers — Velocity Mapping',
    category: 'Sampler & Performance',
    placeholder: 'e.g. 4 Velocity Layers: pp, mp, f, ff',
    description: 'Velocity split resolution across the keybed',
  },
  {
    key: 'Articulations',
    label: 'Articulations — Playing Techniques',
    category: 'Sampler & Performance',
    placeholder: 'e.g. Sustain, Staccato, Pizzicato, Muted',
    description: 'Playing styles captured in this multi-sample bank',
  },
  {
    key: 'Contact',
    label: 'Contact — Creator Website / Support',
    category: 'Sampler & Performance',
    placeholder: 'e.g. https://abdsynths.com/contact',
    description: 'Sound designer support URL or contact reference',
  },
] as const;

export function findStandardTagDef(tag: string): StandardMetadataTagDef | undefined {
  return STANDARD_SOUNDFONT_TAGS.find(
    (t) => t.key.toLowerCase() === tag.trim().toLowerCase()
  );
}
