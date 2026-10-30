// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Model Slug & Axionik Taxonomy
// Canonical identifier derivation without the 0..511 legacy slot limit.
// ─────────────────────────────────────────────────────────

export const AXIONIK_CATEGORIES = [
  { id: 'vocal-choir', name: 'Vocal & Choir', defaultParamSet: 5 },
  { id: 'drums-perc', name: 'Drums & Percussion Kit', defaultParamSet: 8 },
  { id: 'orchestral-strings', name: 'Orchestral & Strings', defaultParamSet: 1 },
  { id: 'acoustic-pianos', name: 'Keyboards & Acoustic Pianos', defaultParamSet: 2 },
  { id: 'electric-pianos', name: 'Electric Pianos & Tines', defaultParamSet: 2 },
  { id: 'bass-low-end', name: 'Bass & Low End', defaultParamSet: 4 },
  { id: 'plucked-ethnic', name: 'Plucked & Ethnic / World', defaultParamSet: 3 },
  { id: 'brass-horns', name: 'Brass & Horns', defaultParamSet: 1 },
  { id: 'woodwinds-reeds', name: 'Woodwinds & Reeds', defaultParamSet: 1 },
  { id: 'mallets-chromatic', name: 'Mallets & Chromatic Perc', defaultParamSet: 7 },
  { id: 'pads-atmospheres', name: 'Pads & Atmospheres', defaultParamSet: 6 },
  { id: 'synth-leads', name: 'Synth Leads & Solos', defaultParamSet: 0 },
  { id: 'sfx-cinematic', name: 'SFX, Drones & Cinematic', defaultParamSet: 9 },
  { id: 'arps-sequences', name: 'Arpeggiated & Sequences', defaultParamSet: 8 },
  { id: 'synth-neutral', name: 'Synth & Neutral', defaultParamSet: 0 },
] as const;

export type AxionikCategoryName = (typeof AXIONIK_CATEGORIES)[number]['name'];

/**
 * Derives a clean, filesystem-safe semantic slug from any model name.
 * e.g. "Steinway Grand Piano #1" -> "steinway-grand-piano-1"
 */
export function slugifyModelName(name: string): string {
  const clean = (name || 'untitled')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 48);
  return clean || 'model';
}

/**
 * Avoids duplicate folder collisions when saving into AxionikDB/Models/.
 */
export function createUniqueModelSlug(name: string, existingSlugs: Set<string> | string[]): string {
  const base = slugifyModelName(name);
  const set = existingSlugs instanceof Set ? existingSlugs : new Set(existingSlugs);
  if (!set.has(base)) return base;
  let counter = 2;
  while (set.has(`${base}-${counter}`)) {
    counter++;
  }
  return `${base}-${counter}`;
}

/**
 * Resolves the legacy 0..9 Parameter Set from an Axionik category name.
 */
export function mapAxionikCategoryToParameterSet(category: string): number {
  const found = AXIONIK_CATEGORIES.find(
    (c) => c.name.toLowerCase() === category.toLowerCase()
  );
  return found?.defaultParamSet ?? 0;
}
