// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — General MIDI (GM) Drum Map & Collision Detection
//
// Canonical mapping from MIDI note numbers (35..81) to General MIDI Level 1
// Percussion Sound Names. Provides note label formatting with note numbers
// and names: e.g. "Acoustic Snare (38 D1)", collision detection across
// zones/regions, and assigned-note tracking.
// ─────────────────────────────────────────────────────────

import { midiToNoteName } from '../ui/ZoneRibbon.ts';

export interface GmDrumDefinition {
  note: number;
  name: string;
}

/**
 * Canonical General MIDI Level 1 Drum Map (MIDI Notes 35..81)
 */
export const GM_DRUM_MAP: Record<number, string> = {
  35: 'Acoustic Bass Drum',
  36: 'Bass Drum 1',
  37: 'Side Stick',
  38: 'Acoustic Snare',
  39: 'Hand Clap',
  40: 'Electric Snare',
  41: 'Low Floor Tom',
  42: 'Closed Hi-Hat',
  43: 'High Floor Tom',
  44: 'Pedal Hi-Hat',
  45: 'Low Tom',
  46: 'Open Hi-Hat',
  47: 'Low-Mid Tom',
  48: 'Hi-Mid Tom',
  49: 'Crash Cymbal 1',
  50: 'High Tom',
  51: 'Ride Cymbal 1',
  52: 'Chinese Cymbal',
  53: 'Ride Bell',
  54: 'Tambourine',
  55: 'Splash Cymbal',
  56: 'Cowbell',
  57: 'Crash Cymbal 2',
  58: 'Vibraslap',
  59: 'Ride Cymbal 2',
  60: 'Hi Bongo',
  61: 'Low Bongo',
  62: 'Mute Hi Conga',
  63: 'Open Hi Conga',
  64: 'Low Conga',
  65: 'High Timbale',
  66: 'Low Timbale',
  67: 'High Agogo',
  68: 'Low Agogo',
  69: 'Cabasa',
  70: 'Maracas',
  71: 'Short Whistle',
  72: 'Long Whistle',
  73: 'Short Guiro',
  74: 'Long Guiro',
  75: 'Claves',
  76: 'Hi Wood Block',
  77: 'Low Wood Block',
  78: 'Mute Cuica',
  79: 'Open Cuica',
  80: 'Mute Triangle',
  81: 'Open Triangle',
};

/** Checks if a MIDI note is within the standard GM Drum Map range (35..81) */
export function isGmDrumNote(midiNote: number): boolean {
  return midiNote >= 35 && midiNote <= 81 && GM_DRUM_MAP[midiNote] !== undefined;
}

/** Returns the GM drum name or null if outside the standard map */
export function getGmDrumName(midiNote: number): string | null {
  return GM_DRUM_MAP[midiNote] ?? null;
}

/**
 * Canonical formatter: "${drumName} (${midiNote} ${noteName})"
 * Example: "Acoustic Snare (38 D1)", "Closed Hi-Hat (42 F#1)", "Bass Drum 1 (36 C1)"
 */
export function formatGmDrumLabel(midiNote: number): string {
  const noteName = midiToNoteName(midiNote);
  const drumName = GM_DRUM_MAP[midiNote];
  if (drumName) {
    return `${drumName} (${midiNote} ${noteName})`;
  }
  return `Custom Perc (${midiNote} ${noteName})`;
}

/**
 * Returns all standard GM drum entries in ascending note order (35..81)
 */
export function listGmDrumEntries(): Array<{ note: number; name: string; label: string }> {
  const result: Array<{ note: number; name: string; label: string }> = [];
  for (let note = 35; note <= 81; note++) {
    const name = GM_DRUM_MAP[note];
    if (name) {
      result.push({
        note,
        name,
        label: formatGmDrumLabel(note),
      });
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
  collisionMap: Record<string, DrumCollisionInfo>; // Keyed by item id
  totalCollisions: number;                         // Total number of conflicting items
  collidingKeys: number[];                         // Distinct MIDI notes in collision
}

/**
 * Analyzes collisions across zones or regions.
 * A collision occurs when two or more items have identical rootKeys or overlapping key ranges
 * AND overlapping velocity ranges.
 */
export function analyzeDrumCollisions(
  items: Array<{
    id: string;
    lowKey: number;
    highKey: number;
    rootKey: number;
    lowVel?: number;
    highVel?: number;
  }>
): DrumCollisionReport {
  const collisionMap: Record<string, DrumCollisionInfo> = {};
  const collidingKeysSet = new Set<number>();
  let totalCollidingItems = 0;

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

      // Key match or overlap (in drum mode, rootKey match is primary, key range overlap is checked)
      const keyOverlap =
        a.rootKey === b.rootKey ||
        (Math.max(a.lowKey, b.lowKey) <= Math.min(a.highKey, b.highKey));

      // Velocity range overlap
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
      collisionMap[a.id] = {
        key: a.rootKey,
        noteName: midiToNoteName(a.rootKey),
        drumLabel: formatGmDrumLabel(a.rootKey),
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
