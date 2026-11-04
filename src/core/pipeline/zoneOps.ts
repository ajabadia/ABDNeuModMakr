import type { MidiNote, Session, Zone } from '../types.ts';
import type { PipelineContext } from './types.ts';
import { createZone } from '../sessionFactory.ts';
import { markDirty } from './persistenceOps.ts';
import { pushHistory } from './sessionHistoryOps.ts';
import { syncExtendedRegionsFromClassicZones } from '../extendedAdapter.ts';
import { clamp } from '../dsp/DspMath.ts';
import { maybeAutoDeriveModelName as autoDeriveModelName } from '../import/modelImportService.ts';

function maybeAutoDeriveModelName(ctx: PipelineContext, sampleFilename: string): void {
  if (!ctx.state.session) return;
  autoDeriveModelName(ctx.state.session, sampleFilename);
}

export function resetZonesToSingle(ctx: PipelineContext): Session {
  if (!ctx.state.session) throw new Error('No active session');
  pushHistory(ctx, 'Reset to Single 0..127 Zone');
  ctx.state.session.zones = [createZone(0, 60, 127, null)];
  ctx.state.session.extendedRegions = syncExtendedRegionsFromClassicZones(
    ctx.state.session.zones
  );
  markDirty(ctx);
  return ctx.state.session;
}

export async function addZone(ctx: PipelineContext, rootKey: MidiNote, samplePath?: string | null): Promise<Zone> {
  if (!ctx.state.session) throw new Error('No active session');

  const zones = ctx.state.session.zones;
  const hostIdx = zones.findIndex(
    (z) => z.lowKey <= rootKey && rootKey <= z.highKey
  );
  if (hostIdx === -1) {
    throw new Error(`No zone covers MIDI note ${rootKey}`);
  }

  pushHistory(ctx, `Split Zone at MIDI ${rootKey}`);

  const host = zones[hostIdx];

  // If host spans multiple keys and rootKey is at lowKey, split at midpoint
  const splitPoint =
    rootKey > host.lowKey
      ? rootKey
      : host.highKey > host.lowKey
        ? Math.ceil((host.lowKey + host.highKey) * 0.5)
        : host.lowKey;

  const effectiveSampleLow =
    samplePath !== undefined ? samplePath : null;
  const newRootKey = Math.max(
    splitPoint,
    Math.min(host.highKey, rootKey > host.lowKey ? rootKey : Math.round((splitPoint + host.highKey) * 0.5))
  );
  const newZone = createZone(
    splitPoint,
    newRootKey,
    host.highKey,
    effectiveSampleLow
  );
  if (samplePath === undefined) {
    newZone.sampleHigh = null;
    newZone.velSplit = 64;
    newZone.detune = 0;
    newZone.volume = 0;
    newZone.pan = 0;
  }
  host.highKey = Math.max(host.lowKey, splitPoint - 1);
  if (host.rootKey > host.highKey) {
    host.rootKey = host.highKey;
  }

  zones.splice(hostIdx + 1, 0, newZone);
  ctx.state.session.extendedRegions = syncExtendedRegionsFromClassicZones(
    zones,
    ctx.state.session.extendedRegions
  );
  ctx.ensureZoneDemoBuffers([newZone]);
  markDirty(ctx);
  return newZone;
}

export async function updateZone(ctx: PipelineContext, zoneId: string, changes: Partial<Zone>): Promise<Zone> {
  if (!ctx.state.session) throw new Error('No active session');
  const zones = ctx.state.session.zones;
  const idx = zones.findIndex((z) => z.id === zoneId);
  if (idx === -1) throw new Error(`Zone ${zoneId} not found`);
  const zone = zones[idx];

  const changeKeys = Object.keys(changes).sort().join(',');
  pushHistory(ctx, 
    `Update Zone (${changeKeys})`,
    `zone:${zoneId}:${changeKeys}`
  );

  const bothKeyEdgesRaw =
    changes.lowKey !== undefined && changes.highKey !== undefined;

  if (bothKeyEdgesRaw) {
    zone.lowKey = clamp(Math.round(changes.lowKey!), 0, 127);
    zone.highKey = clamp(Math.round(changes.highKey!), 0, 127);
  } else if (changes.lowKey !== undefined) {
    // Canonical MainFrame.handlePianoNote coupled LowKey adjustment (prevents key collision/gap)
    if (idx === 0) {
      zone.lowKey = 0;
    } else {
      const prev = zones[idx - 1];
      const clampedLow = Math.max(
        prev.lowKey + 1,
        Math.min(zone.highKey, Math.round(changes.lowKey))
      );
      zone.lowKey = clampedLow;
      prev.highKey = clampedLow - 1;
    }
  } else if (changes.highKey !== undefined) {
    // Canonical MainFrame.handlePianoNote coupled HighKey adjustment (prevents key collision/gap)
    if (idx === zones.length - 1) {
      zone.highKey = 127;
    } else {
      const next = zones[idx + 1];
      const clampedHigh = Math.max(
        zone.lowKey,
        Math.min(next.highKey - 1, Math.round(changes.highKey))
      );
      zone.highKey = clampedHigh;
      next.lowKey = clampedHigh + 1;
    }
  }

  if (changes.rootKey !== undefined) {
    zone.rootKey = clamp(Math.round(changes.rootKey), 0, 127);
  }
  if (changes.velSplit !== undefined) {
    const isExtended = ctx.state.session?.processConfig.workingMode === 'extended';
    zone.velSplit = isExtended ? clamp(Math.round(changes.velSplit), 2, 127) : 64;
  }
  if (changes.detune !== undefined) {
    zone.detune = clamp(changes.detune, -99, 99);
  }
  if (changes.volume !== undefined) {
    zone.volume = clamp(changes.volume, -32, 12);
  }
  if (changes.pan !== undefined) {
    zone.pan = clamp(changes.pan, -50, 50);
  }
  if (changes.sampleLow !== undefined) {
    zone.sampleLow = changes.sampleLow;
    if (changes.sampleLow) {
      maybeAutoDeriveModelName(ctx, changes.sampleLow);
    }
  }
  if (changes.sampleHigh !== undefined) {
    zone.sampleHigh = changes.sampleHigh;
  }

  ctx.state.session.extendedRegions = syncExtendedRegionsFromClassicZones(
    zones,
    ctx.state.session.extendedRegions
  );
  ctx.ensureZoneDemoBuffers([zone]);
  markDirty(ctx);
  return zone;
}

export async function removeZone(ctx: PipelineContext, zoneId: string): Promise<void> {
  if (!ctx.state.session) throw new Error('No active session');
  const zones = ctx.state.session.zones;
  if (zones.length <= 1) {
    throw new Error('Cannot remove the last zone');
  }

  const idx = zones.findIndex((z) => z.id === zoneId);
  if (idx === -1) throw new Error(`Zone ${zoneId} not found`);

  pushHistory(ctx, `Remove Zone #${idx + 1}`);

  const removed = zones[idx];
  zones.splice(idx, 1);

  if (idx > 0) {
    zones[idx - 1].highKey = removed.highKey;
  } else if (zones.length > 0) {
    zones[0].lowKey = removed.lowKey;
  }

  ctx.state.spectralCache.delete(zoneId);
  markDirty(ctx);
}

export function validateCoverage(ctx: PipelineContext): string[] {
  const errors: string[] = [];
  const zones = ctx.state.session?.zones ?? [];
  if (zones.length === 0) {
    errors.push('No zones defined');
    return errors;
  }

  const sorted = [...zones].sort((a, b) => a.lowKey - b.lowKey);

  if (sorted[0].lowKey !== 0) {
    errors.push(
      `Gap at start: first zone starts at ${sorted[0].lowKey}, expected 0`
    );
  }
  if (sorted[sorted.length - 1].highKey !== 127) {
    errors.push(
      `Gap at end: last zone ends at ${sorted[sorted.length - 1].highKey}, expected 127`
    );
  }

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (curr.lowKey !== prev.highKey + 1) {
      if (curr.lowKey <= prev.highKey) {
        errors.push(
          `Overlap between zones at keys ${prev.highKey}–${curr.lowKey}`
        );
      } else {
        errors.push(
          `Gap between keys ${prev.highKey + 1}–${curr.lowKey - 1}`
        );
      }
    }
  }

  for (const z of zones) {
    if (!z.sampleLow && z.sampleHigh) {
      errors.push(
        `Zone ${z.lowKey}–${z.highKey}: High Vel sample assigned without Low Vel sample (velocity gap 1–63)`
      );
    } else if (!z.sampleLow) {
      errors.push(`Zone ${z.lowKey}–${z.highKey}: no sample assigned`);
    }
  }

  return errors;
}

export function autoRepairCoverage(ctx: PipelineContext): Session {
  if (!ctx.state.session) throw new Error('No active session');
  pushHistory(ctx, 'Auto-Repair MIDI Coverage 0..127');

  if (ctx.state.session.zones.length === 0) {
    ctx.state.session.zones = [createZone(0, 60, 127, null)];
    markDirty(ctx);
    return ctx.state.session;
  }

  // Sort zones by lowKey ascending, then rootKey ascending
  const sorted = [...ctx.state.session.zones].sort(
    (a, b) => a.lowKey - b.lowKey || a.rootKey - b.rootKey
  );

  // Cap total zones to 128 at most
  const capped = sorted.slice(0, 128);
  const n = capped.length;

  for (let i = 0; i < n; i++) {
    const z = capped[i];
    if (i === 0) {
      z.lowKey = 0;
    } else {
      const prev = capped[i - 1];
      const minAllowedLow = i;
      const maxAllowedLow = 128 - (n - i);
      const desiredLow = Math.max(prev.lowKey + 1, z.lowKey);
      z.lowKey = Math.max(minAllowedLow, Math.min(maxAllowedLow, desiredLow));
      prev.highKey = z.lowKey - 1;
    }
    if (i === n - 1) {
      z.highKey = 127;
    }
  }

  for (const z of capped) {
    z.rootKey = Math.max(z.lowKey, Math.min(z.highKey, z.rootKey));
    z.velSplit = 64;
    if (!z.sampleLow && z.sampleHigh) {
      z.sampleLow = z.sampleHigh;
      z.sampleHigh = null;
    }
    if (!z.sampleLow) {
      z.sampleLow = `Strings_${z.rootKey}_C4.wav`;
    }
  }

  ctx.state.session.zones = capped;
  ctx.state.session.extendedRegions = syncExtendedRegionsFromClassicZones(
    ctx.state.session.zones,
    ctx.state.session.extendedRegions
  );
  ctx.ensureZoneDemoBuffers(ctx.state.session.zones);
  markDirty(ctx);
  return ctx.state.session;
}
