// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Note → Zone/Region mapping
//
// Pure helpers resolving which table row(s) and which sample a played
// MIDI note + velocity triggers, honoring both working modes:
//   - Classic:  one zone per key range, two velocity layers split at `velSplit`
//               (Low Vel = 1..split-1, High Vel = split..127; Low covers 1..127
//               when the zone has no High Vel sample).
//   - Extended: free 2D key × velocity regions; several regions may respond to
//               the same note (velocity layers sharing keys, round-robin sets).
// ─────────────────────────────────────────────────────────

import type { ExtendedRegion, MidiNote, TriggerMode, Zone } from './types.ts';
import type { SamplerArticulationEngine } from '@abdsynths/shared/formats/sampler';

export type ClassicVelocityLayer = 'low' | 'high';

export interface NoteTargets {
  /** Classic: zone owning the note (Extended: zone mapped to the first region, if any) */
  zoneId?: string;
  /** Classic only: which velocity column (Low Vel / High Vel) sounds */
  layer?: ClassicVelocityLayer;
  /** Extended only: every region whose key AND velocity ranges contain the note */
  regionIds: string[];
  /** Sample that should sound for this note/velocity (first match) */
  sampleName?: string;
  /** Root key of that sample (for pitch shifting) */
  rootKey?: MidiNote;
  /** Selected region object when in extended mode */
  region?: ExtendedRegion;
  /** Trigger mode (attack or release) */
  trigger?: TriggerMode;
}

/** Converts a normalized keyboard velocity (0..1) or MIDI velocity to 1..127. */
export function toMidiVelocity(velocity: number | undefined): number {
  if (velocity === undefined || !Number.isFinite(velocity)) return 100;
  const v = velocity <= 1 ? velocity * 127 : velocity;
  return Math.max(1, Math.min(127, Math.round(v)));
}

/** Classic layer selection, identical to the ranges shown in the zone table. */
export function classicLayerForVelocity(zone: Zone, velocity127: number): ClassicVelocityLayer {
  if (!zone.sampleHigh) return 'low';
  const split = Math.max(2, Math.min(127, zone.velSplit ?? 64));
  return velocity127 >= split ? 'high' : 'low';
}

export function resolveClassicNoteTargets(
  zones: Zone[],
  note: MidiNote,
  velocity127: number
): NoteTargets {
  const zone = zones.find((z) => note >= z.lowKey && note <= z.highKey);
  if (!zone) return { regionIds: [] };
  const layer = classicLayerForVelocity(zone, velocity127);
  const sampleName =
    (layer === 'high' ? zone.sampleHigh : zone.sampleLow) || zone.sampleLow || zone.sampleHigh || undefined;
  return { zoneId: zone.id, layer, regionIds: [], sampleName, rootKey: zone.rootKey };
}

export function computeRegionCrossfadeGain(
  region: ExtendedRegion,
  note: MidiNote,
  velocity127: number,
): number {
  let gain = 1.0;
  const evalCurve = (t: number): number => {
    const c = Math.max(0, Math.min(1, t));
    return region.fadeCurve === 'linear' ? c : Math.sin(c * Math.PI * 0.5);
  };
  if (region.keyFadeIn > 0 && note < region.lowKey + region.keyFadeIn) {
    gain *= evalCurve((note - region.lowKey + 1) / (region.keyFadeIn + 1));
  }
  if (region.keyFadeOut > 0 && note > region.highKey - region.keyFadeOut) {
    gain *= evalCurve((region.highKey - note + 1) / (region.keyFadeOut + 1));
  }
  if (region.velFadeIn > 0 && velocity127 < region.lowVel + region.velFadeIn) {
    gain *= evalCurve((velocity127 - region.lowVel + 1) / (region.velFadeIn + 1));
  }
  if (region.velFadeOut > 0 && velocity127 > region.highVel - region.velFadeOut) {
    gain *= evalCurve((region.highVel - velocity127 + 1) / (region.velFadeOut + 1));
  }
  return Math.max(0, Math.min(1, gain));
}

export function resolveExtendedNoteTargets(
  regions: ExtendedRegion[],
  note: MidiNote,
  velocity127: number,
  trigger: TriggerMode = 'attack',
  engine?: SamplerArticulationEngine,
): NoteTargets {
  const hits = regions.filter(
    (r) =>
      note >= r.lowKey &&
      note <= r.highKey &&
      velocity127 >= r.lowVel &&
      velocity127 <= r.highVel
  );

  // Separate by trigger mode (attack vs release)
  const triggerMatches = hits.filter((r) => (r.trigger || 'attack') === trigger);
  const activePool = triggerMatches.length > 0 ? triggerMatches : (trigger === 'release' ? [] : hits);

  const selected =
    engine && activePool.length > 0
      ? engine.selectRegionForNote(activePool, note, velocity127, trigger)
      : (activePool.find((r) => r.sampleName) ?? activePool[0]);

  return {
    regionIds: hits.map((r) => r.id),
    sampleName: selected?.sampleName || undefined,
    rootKey: selected?.rootKey,
    region: selected,
    trigger: selected?.trigger || 'attack',
  };
}

/** Key × velocity rectangle of a table row being auditioned (keyboard + zone map highlight). */
export interface RowAuditionSpan {
  zoneId?: string;
  regionId?: string;
  lowKey: MidiNote;
  highKey: MidiNote;
  rootKey: MidiNote;
  lowVel: number;
  highVel: number;
}

/**
 * Resolves the key/velocity span of the row played with the table ▶ button.
 * Classic: the zone's keys and the velocity layer `auditionRow` plays
 *          (Low Vel, or High Vel when the zone only has a High sample).
 * Extended: the region's own key × velocity rectangle.
 */
export function resolveRowAuditionSpan(
  zones: Zone[],
  regions: ExtendedRegion[],
  isExtended: boolean,
  row: { zoneId?: string; regionId?: string }
): RowAuditionSpan | null {
  if (isExtended && row.regionId) {
    const r = regions.find((x) => x.id === row.regionId);
    if (r) {
      return {
        zoneId: row.zoneId,
        regionId: r.id,
        lowKey: r.lowKey,
        highKey: r.highKey,
        rootKey: r.rootKey,
        lowVel: r.lowVel,
        highVel: r.highVel,
      };
    }
  }
  const z = row.zoneId ? zones.find((x) => x.id === row.zoneId) : undefined;
  if (!z) return null;
  const split = Math.max(2, Math.min(127, z.velSplit ?? 64));
  const playsHighOnly = !z.sampleLow && !!z.sampleHigh;
  const [lowVel, highVel] = playsHighOnly
    ? [split, 127]
    : z.sampleHigh
      ? [1, split - 1]
      : [1, 127];
  return { zoneId: z.id, lowKey: z.lowKey, highKey: z.highKey, rootKey: z.rootKey, lowVel, highVel };
}
