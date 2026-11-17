// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Multi-Mode Drum Map & Collision Detection
//
// DRY wrapper over @abdsynths/shared/contracts/abdDrumMapProfiles.
// Preserves legacy GM Level 1 API (35..81) while supporting Roland GS/MC-303,
// Yamaha XG/XS/CS2x, Korg N5/AI2, Hardware Native, and Proprietary 0..127 maps.
// ─────────────────────────────────────────────────────────

import {
  DRUM_MAP_MODES,
  GM_CORE_NOTES,
  getDrumMapProfile,
  getDrumNoteMap,
  getDrumSlotName,
  type DrumMapMode,
  type DrumNoteRemapper,
  type DrumTriggerMode,
} from '@abdsynths/shared/contracts/abdDrumMapProfiles.ts';
import { midiToNoteName } from '../ui/ZoneRibbon.ts';

export { DRUM_MAP_MODES, type DrumMapMode, type DrumNoteRemapper, type DrumTriggerMode };

export interface GmDrumDefinition {
  note: number;
  name: string;
}

/** Canonical General MIDI Level 1 Drum Map (MIDI Notes 35..81) */
export const GM_DRUM_MAP: Record<number, string> = GM_CORE_NOTES;

/** Checks if a MIDI note is within the standard GM Drum Map range (35..81) */
export function isGmDrumNote(midiNote: number): boolean {
  return midiNote >= 35 && midiNote <= 81 && GM_DRUM_MAP[midiNote] !== undefined;
}

/** Returns the GM drum name or null if outside the standard map */
export function getGmDrumName(midiNote: number): string | null {
  return GM_DRUM_MAP[midiNote] ?? null;
}

/** Resolves a drum note name for any supported DrumMapMode (GM, GS/MC, XG/XS, Korg AI2/N5, Hardware, Proprietary) */
export function getDrumNoteNameByMode(
  midiNote: number,
  mode: DrumMapMode = 'gm_standard',
  hardwareId = 'boss_dr5'
): string | null {
  if (mode === 'gm_standard') return getGmDrumName(midiNote);
  return getDrumSlotName(mode, midiNote, hardwareId);
}

/** Canonical formatter: "${drumName} (${midiNote} ${noteName})" */
export function formatDrumLabelByMode(
  midiNote: number,
  mode: DrumMapMode = 'gm_standard',
  hardwareId = 'boss_dr5'
): string {
  const noteName = midiToNoteName(midiNote);
  const drumName = getDrumNoteNameByMode(midiNote, mode, hardwareId);
  return drumName ? `${drumName} (${midiNote} ${noteName})` : `Custom Perc (${midiNote} ${noteName})`;
}

/** Legacy GM formatter preserved for existing UI/test callers */
export function formatGmDrumLabel(midiNote: number): string {
  return formatDrumLabelByMode(midiNote, 'gm_standard');
}

/** Lists all drum entries in ascending note order for the requested DrumMapMode */
export function listDrumEntriesByMode(
  mode: DrumMapMode = 'gm_standard',
  hardwareId = 'boss_dr5'
): Array<{ note: number; name: string; label: string; category: string; muteGroup: number }> {
  const profile = getDrumMapProfile(mode, hardwareId);
  return profile.slots.map((slot) => ({
    note: slot.note,
    name: slot.name,
    label: `${slot.name} (${slot.note} ${midiToNoteName(slot.note)})`,
    category: slot.category,
    muteGroup: slot.muteGroup,
  }));
}

/** Returns all standard GM drum entries in ascending note order (35..81) */
export function listGmDrumEntries(): Array<{ note: number; name: string; label: string }> {
  const result: Array<{ note: number; name: string; label: string }> = [];
  for (let note = 35; note <= 81; note++) {
    const name = GM_DRUM_MAP[note];
    if (name) {
      result.push({ note, name, label: formatGmDrumLabel(note) });
    }
  }
  return result;
}

export interface DrumCollisionPeer {
  id: string;
  index: number;
  rootKey: number;
  lowKey: number;
  highKey: number;
  lowVel: number;
  highVel: number;
}

export interface DrumCollisionInfo {
  key: number;
  noteName: string;
  drumLabel: string;
  peerIds: string[];
  peerIndices: number[];
  peers: DrumCollisionPeer[];
}

export interface DrumCollisionReport {
  collisionMap: Record<string, DrumCollisionInfo>;
  totalCollisions: number;
  collidingKeys: number[];
}

/** Analyzes collisions across zones/regions using labels from the requested DrumMapMode */
export function analyzeDrumCollisionsForMode(
  items: Array<{ id: string; lowKey: number; highKey: number; rootKey: number; lowVel?: number; highVel?: number }>,
  mode: DrumMapMode = 'gm_standard',
  hardwareId = 'boss_dr5'
): DrumCollisionReport {
  const collisionMap: Record<string, DrumCollisionInfo> = {};
  const collidingKeysSet = new Set<number>();
  let totalCollidingItems = 0;
  const noteNames = getDrumNoteMap(mode, hardwareId);

  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    const aLowVel = a.lowVel ?? 1;
    const aHighVel = a.highVel ?? 127;
    const peers: DrumCollisionPeer[] = [];

    for (let j = 0; j < items.length; j++) {
      if (i === j) continue;
      const b = items[j];
      const bLowVel = b.lowVel ?? 1;
      const bHighVel = b.highVel ?? 127;
      const keyOverlap =
        a.rootKey === b.rootKey ||
        Math.max(a.lowKey, b.lowKey) <= Math.min(a.highKey, b.highKey);
      const velOverlap = Math.max(aLowVel, bLowVel) <= Math.min(aHighVel, bHighVel);

      if (keyOverlap && velOverlap) {
        peers.push({
          id: b.id,
          index: j + 1,
          rootKey: b.rootKey,
          lowKey: b.lowKey,
          highKey: b.highKey,
          lowVel: bLowVel,
          highVel: bHighVel,
        });
      }
    }

    if (peers.length > 0) {
      collidingKeysSet.add(a.rootKey);
      totalCollidingItems++;
      const resolvedName = noteNames[a.rootKey];
      const noteName = midiToNoteName(a.rootKey);
      collisionMap[a.id] = {
        key: a.rootKey,
        noteName,
        drumLabel: resolvedName ? `${resolvedName} (${a.rootKey} ${noteName})` : `Custom Perc (${a.rootKey} ${noteName})`,
        peerIds: peers.map((p) => p.id),
        peerIndices: peers.map((p) => p.index),
        peers,
      };
    }
  }

  return {
    collisionMap,
    totalCollisions: totalCollidingItems,
    collidingKeys: Array.from(collidingKeysSet).sort((a, b) => a - b),
  };
}

/** Legacy GM collision detector preserved for existing callers */
export function analyzeDrumCollisions(
  items: Array<{ id: string; lowKey: number; highKey: number; rootKey: number; lowVel?: number; highVel?: number }>
): DrumCollisionReport {
  return analyzeDrumCollisionsForMode(items, 'gm_standard');
}
