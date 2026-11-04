import type { PipelineContext } from './types.ts';
import type { ExtendedRegion, Session, SynthArticulationConfig } from '../types.ts';
import {
  cloneArticulation,
  cloneExtendedRegion,
  computeNextAvailableExtendedRange,
  createDefaultArticulation,
  createDefaultCommonPlayback,
  projectExtendedRegionsToClassicZones,
  syncExtendedRegionsFromClassicZones,
} from '../extendedAdapter.ts';
import { clamp } from '../dsp/DspMath.ts';
import { markDirty } from './persistenceOps.ts';
import { pushHistory } from './sessionHistoryOps.ts';

export async function addExtendedRegion(ctx: PipelineContext, partial?: Partial<ExtendedRegion>, anchorRegionId?: string): Promise<ExtendedRegion> {
  if (!ctx.state.session) throw new Error('No active session');
  if (!ctx.state.session.extendedRegions || ctx.state.session.extendedRegions.length === 0) {
    ctx.state.session.extendedRegions = syncExtendedRegionsFromClassicZones(ctx.state.session.zones);
  }
  pushHistory(ctx, 'Add Extended Region');

  const regs = ctx.state.session.extendedRegions ?? [];
  const anchorIdx = anchorRegionId ? regs.findIndex((r) => r.id === anchorRegionId) : -1;
  const anchorReg = anchorIdx >= 0 ? regs[anchorIdx] : regs[regs.length - 1] ?? null;

  const hasExplicitRange =
    partial?.lowKey !== undefined ||
    partial?.highKey !== undefined ||
    partial?.lowVel !== undefined ||
    partial?.highVel !== undefined;
  const suggestion = hasExplicitRange
    ? null
    : computeNextAvailableExtendedRange(regs, anchorReg);

  if (suggestion?.splitDonorId) {
    const donor = regs.find((r) => r.id === suggestion.splitDonorId);
    if (donor) {
      if (suggestion.splitDonorNewHighKey === -1) {
        donor.lowKey = Math.min(donor.highKey, suggestion.highKey + 1);
        if (donor.rootKey < donor.lowKey) donor.rootKey = donor.lowKey;
      } else if (typeof suggestion.splitDonorNewHighKey === 'number') {
        donor.highKey = Math.max(donor.lowKey, suggestion.splitDonorNewHighKey);
        if (donor.rootKey > donor.highKey) donor.rootKey = donor.highKey;
      }
    }
  }

  const common =
    ctx.state.session.processConfig.commonPlayback ?? createDefaultCommonPlayback();
  const nextNum = regs.length + 1;
  // Empty sample by default when creating a new region so the user never confuses it with a duplicate
  const defaultSample = partial?.sampleName ?? '';
  const lowKey = clamp(Math.round(partial?.lowKey ?? suggestion?.lowKey ?? 0), 0, 127);
  const highKey = clamp(Math.round(partial?.highKey ?? suggestion?.highKey ?? 127), lowKey, 127);
  const rootKey = clamp(
    Math.round(partial?.rootKey ?? suggestion?.rootKey ?? Math.round((lowKey + highKey) * 0.5)),
    0,
    127
  );
  const lowVel = clamp(Math.round(partial?.lowVel ?? suggestion?.lowVel ?? 1), 1, 127);
  const highVel = clamp(Math.round(partial?.highVel ?? suggestion?.highVel ?? 127), lowVel, 127);

  const newReg: ExtendedRegion = {
    id: partial?.id ?? `ext-reg-${Date.now().toString(36)}-${nextNum}`,
    sampleName: defaultSample,
    lowKey,
    highKey,
    rootKey,
    lowVel,
    highVel,
    detune: clamp(Math.round(partial?.detune ?? 0), -99, 99),
    volume: clamp(Math.round(partial?.volume ?? 0), -32, 12),
    pan: clamp(Math.round(partial?.pan ?? 0), -50, 50),
    pitchKeytrack: clamp(Math.round(partial?.pitchKeytrack ?? common.pitchKeytrack), 0, 100),
    trigger: partial?.trigger ?? common.trigger,
    seqPosition: partial?.seqPosition,
    seqLength: partial?.seqLength,
    keyFadeIn: Math.max(0, Math.round(partial?.keyFadeIn ?? 0)),
    keyFadeOut: Math.max(0, Math.round(partial?.keyFadeOut ?? 0)),
    velFadeIn: Math.max(0, Math.round(partial?.velFadeIn ?? 0)),
    velFadeOut: Math.max(0, Math.round(partial?.velFadeOut ?? 0)),
    fadeCurve: partial?.fadeCurve ?? common.fadeCurve,
    loopMode: partial?.loopMode ?? common.loopMode,
    loopStart: Math.max(0, Math.round(partial?.loopStart ?? 0)),
    loopEnd: Math.max(0, Math.round(partial?.loopEnd ?? 0)),
    loopCrossfadeMs: Math.max(0, Math.round(partial?.loopCrossfadeMs ?? 0)),
    sampleRate: partial?.sampleRate,
    numChannels: partial?.numChannels,
    hasPlaybackOverride: partial?.hasPlaybackOverride ?? false,
    hasArticulationOverride: partial?.hasArticulationOverride ?? false,
    ampEnvOverride: partial?.ampEnvOverride ? { ...partial.ampEnvOverride } : undefined,
    filterOverride: partial?.filterOverride ? { ...partial.filterOverride } : undefined,
  };

  if (anchorIdx >= 0) {
    regs.splice(anchorIdx + 1, 0, newReg);
  } else {
    regs.push(newReg);
  }
  const projected = projectExtendedRegionsToClassicZones(
    ctx.state.session.extendedRegions,
    ctx.state.session.zones,
  );
  ctx.state.session.zones = projected.zones;
  ctx.ensureZoneDemoBuffers(ctx.state.session.zones);
  markDirty(ctx);
  return cloneExtendedRegion(newReg);
}

export async function updateExtendedRegion(ctx: PipelineContext, regionId: string, changes: Partial<ExtendedRegion>): Promise<ExtendedRegion> {
  if (!ctx.state.session) throw new Error('No active session');
  if (!ctx.state.session.extendedRegions || ctx.state.session.extendedRegions.length === 0) {
    ctx.state.session.extendedRegions = syncExtendedRegionsFromClassicZones(ctx.state.session.zones);
  }
  const idx = ctx.state.session.extendedRegions.findIndex((r) => r.id === regionId);
  if (idx < 0) throw new Error(`Extended region '${regionId}' not found`);

  const keys = Object.keys(changes).sort().join(',');
  pushHistory(ctx, `Update Region ${regionId} (${keys})`, `ext-reg:${regionId}:${keys}`);

  const curr = ctx.state.session.extendedRegions[idx];
  const nextLowKey = changes.lowKey !== undefined ? clamp(Math.round(changes.lowKey), 0, 127) : curr.lowKey;
  const nextHighKey = changes.highKey !== undefined ? clamp(Math.round(changes.highKey), nextLowKey, 127) : Math.max(nextLowKey, curr.highKey);
  const nextRootKey = changes.rootKey !== undefined ? clamp(Math.round(changes.rootKey), 0, 127) : curr.rootKey;
  const nextLowVel = changes.lowVel !== undefined ? clamp(Math.round(changes.lowVel), 1, 127) : curr.lowVel;
  const nextHighVel = changes.highVel !== undefined ? clamp(Math.round(changes.highVel), nextLowVel, 127) : Math.max(nextLowVel, curr.highVel);

  const updated: ExtendedRegion = {
    ...curr,
    ...changes,
    id: curr.id,
    lowKey: nextLowKey,
    highKey: nextHighKey,
    rootKey: nextRootKey,
    lowVel: nextLowVel,
    highVel: nextHighVel,
    detune: changes.detune !== undefined ? clamp(Math.round(changes.detune), -99, 99) : curr.detune,
    volume: changes.volume !== undefined ? clamp(Math.round(changes.volume), -32, 12) : curr.volume,
    pan: changes.pan !== undefined ? clamp(Math.round(changes.pan), -50, 50) : curr.pan,
    pitchKeytrack:
      changes.pitchKeytrack !== undefined
        ? clamp(Math.round(changes.pitchKeytrack), 0, 100)
        : curr.pitchKeytrack,
  };

  ctx.state.session.extendedRegions[idx] = updated;
  const projected = projectExtendedRegionsToClassicZones(
    ctx.state.session.extendedRegions,
    ctx.state.session.zones,
  );
  ctx.state.session.zones = projected.zones;
  markDirty(ctx);
  return cloneExtendedRegion(updated);
}

export async function removeExtendedRegion(ctx: PipelineContext, regionId: string): Promise<void> {
  if (!ctx.state.session) throw new Error('No active session');
  if (!ctx.state.session.extendedRegions || ctx.state.session.extendedRegions.length <= 1) {
    return;
  }
  pushHistory(ctx, `Remove Extended Region ${regionId}`);
  ctx.state.session.extendedRegions = ctx.state.session.extendedRegions.filter((r) => r.id !== regionId);
  const projected = projectExtendedRegionsToClassicZones(
    ctx.state.session.extendedRegions,
    ctx.state.session.zones,
  );
  ctx.state.session.zones = projected.zones;
  markDirty(ctx);
}

export function getArticulation(ctx: PipelineContext): SynthArticulationConfig {
  if (!ctx.state.session) return createDefaultArticulation();
  if (!ctx.state.session.articulation) {
    ctx.state.session.articulation = createDefaultArticulation();
  }
  return cloneArticulation(ctx.state.session.articulation);
}

export function updateArticulation(ctx: PipelineContext, changes: Partial<SynthArticulationConfig>): Session {
  if (!ctx.state.session) throw new Error('No active session');
  const keys = Object.keys(changes).sort().join(',');
  pushHistory(ctx, `Update Articulation (${keys})`, `articulation:${keys}`);

  const curr = ctx.state.session.articulation
    ? cloneArticulation(ctx.state.session.articulation)
    : createDefaultArticulation();

  ctx.state.session.articulation = {
    ...curr,
    ...changes,
    ampEnv: changes.ampEnv ? { ...curr.ampEnv, ...changes.ampEnv } : curr.ampEnv,
    modEnv: changes.modEnv ? { ...curr.modEnv, ...changes.modEnv } : curr.modEnv,
    filter: changes.filter ? { ...curr.filter, ...changes.filter } : curr.filter,
    vibLfo: changes.vibLfo ? { ...curr.vibLfo, ...changes.vibLfo } : curr.vibLfo,
    modLfo: changes.modLfo ? { ...curr.modLfo, ...changes.modLfo } : curr.modLfo,
  };

  markDirty(ctx);
  return ctx.state.session;
}
