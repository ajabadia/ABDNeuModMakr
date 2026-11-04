// ─────────────────────────────────────────────────────────
// Model Configuration — shared constant tables.
// Single source for parameter-set icons/labels so the General
// and Artwork tabs cannot drift apart.
// ─────────────────────────────────────────────────────────

import { ICONS } from '../icons';
import type { ProcessConfig } from '../../core/types';

export const STICK_MODES_BY_COMPLEXITY = [1, 4, 8, 12, 16, 24, 32, 42, 54, 64];

export const PARAM_SET_ICONS: Record<number, string> = {
  0: ICONS.param0,
  1: ICONS.param1,
  2: ICONS.param2,
  3: ICONS.param3,
  4: ICONS.param4,
  5: ICONS.param5,
  6: ICONS.param6,
  7: ICONS.param7,
  8: ICONS.param8,
  9: ICONS.param9,
};

const PARAM_SET_NAMES = [
  'Default Set',
  'Stringed / Bowed',
  'Plucked & Bells',
  'Plucked & Picked',
  'Carpet Shop',
  'Piano etc.',
  'Woodwinds',
  'Extreme Pads',
  'Loop Factory',
  'Multipurpose',
];

export interface DefaultCoverIcon {
  iconSvg: string;
  label: string;
}

/** Resolves the fallback artwork shown when a model has no cover image. */
export function getDefaultCoverIcon(config: ProcessConfig): DefaultCoverIcon {
  const isExtended = (config.workingMode ?? 'classic') === 'extended';
  const isDrum = config.keyMappingMode === 'drum';
  const paramId = config.parameterSet;

  if (isDrum) {
    return { iconSvg: ICONS.drum, label: 'GM Drum Map (Default Artwork)' };
  }

  if (typeof paramId === 'number' && paramId >= 0 && paramId <= 9) {
    return {
      iconSvg: PARAM_SET_ICONS[paramId] ?? ICONS.param0,
      label: `${PARAM_SET_NAMES[paramId] ?? `Set #${paramId}`} (Default Artwork)`,
    };
  }

  if (isExtended) {
    return { iconSvg: ICONS.param0, label: 'Default Acoustic Model (Default Artwork)' };
  }

  return { iconSvg: ICONS.param0, label: 'Canonical Model (Default Artwork)' };
}
