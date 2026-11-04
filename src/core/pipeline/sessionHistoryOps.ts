import type { ExtendedRegion, HistoryState, ProcessConfig, Session, SynthArticulationConfig, Zone } from '../types.ts';
import type { PipelineContext } from './types.ts';
import { createInitialSession, createZone } from '../sessionFactory.ts';
import { parseSessionJson } from '../sessionSchema.ts';

export async function newSession(ctx: PipelineContext, name = 'Untitled'): Promise<Session> {
  ctx.state.sampleBuffers.clear();
  ctx.state.importedSourceBinaries.clear();
  ctx.state.assetStore.clearSessionAudioLayers();
  ctx.state.ribbonEnvelopeCache.clear();
  ctx.state.spectralCache.clear();
  ctx.state.session = createInitialSession(name);
  clearHistory(ctx);
  ctx.persistToLocalStorage();
  ctx.emit({ type: 'session-changed', session: ctx.state.session });
  return ctx.state.session;
}

export async function loadSession(ctx: PipelineContext, idOrJson: string): Promise<Session> {
  if (idOrJson.trim().startsWith('{')) {
    return loadSessionFromJson(ctx, idOrJson);
  }
  ctx.state.session = createInitialSession('Hartmann MultiSession');
  clearHistory(ctx);
  ctx.state.session.zones = [
    createZone(0, 24, 35, 'Bass_24_C1.wav'),
    createZone(36, 48, 59, 'Piano_48_C3.wav'),
    createZone(60, 72, 83, 'Strings_72_C5.wav'),
    createZone(84, 96, 107, 'Pad_96_C7.wav'),
    createZone(108, 115, 127, 'Bell_115_G8.wav'),
  ];
  ctx.state.session.zones[2].sampleHigh = 'Strings_72_C5_v2.wav';
  ctx.ensureZoneDemoBuffers(ctx.state.session.zones);
  ctx.persistToLocalStorage();
  ctx.emit({ type: 'session-changed', session: ctx.state.session });
  return ctx.state.session;
}

export async function saveSession(ctx: PipelineContext, _session: Session): Promise<void> {
  if (ctx.state.session) {
    ctx.state.session.dirty = false;
    ctx.state.session.modifiedAt = new Date().toISOString();
    ctx.persistToLocalStorage();
    ctx.emit({ type: 'session-changed', session: ctx.state.session });
  }
}

export function exportSessionJson(ctx: PipelineContext): string {
  if (!ctx.state.session) {
    throw new Error('No active session to export');
  }
  return JSON.stringify(
    {
      magic: 'NEURONMM_SESSION',
      version: '1.2.0',
      exportedAt: new Date().toISOString(),
      session: ctx.state.session,
    },
    null,
    2
  );
}

export async function loadSessionFromJson(ctx: PipelineContext, jsonText: string): Promise<Session> {
  const newSession = parseSessionJson(jsonText);
  ctx.state.session = newSession;
  clearHistory(ctx);
  pruneOrphanBuffers(ctx);
  ctx.ensureZoneDemoBuffers(newSession.zones);
  ctx.persistToLocalStorage();
  ctx.emit({ type: 'session-changed', session: newSession });
  return newSession;
}

export function pruneOrphanBuffers(ctx: PipelineContext): { removedCount: number; freedBytesEstimate: number } {
  const activeNames = new Set<string>();

  if (ctx.state.session) {
    for (const z of ctx.state.session.zones) {
      if (z.sampleLow) activeNames.add(z.sampleLow);
      if (z.sampleHigh) activeNames.add(z.sampleHigh);
    }
    if (ctx.state.session.extendedRegions) {
      for (const r of ctx.state.session.extendedRegions) {
        if (r.sampleName) activeNames.add(r.sampleName);
      }
    }
  }

  const historyNames = ctx.state.history.getReferencedSampleNames();
  for (const name of historyNames) {
    activeNames.add(name);
  }

  let removedCount = 0;
  let freedBytesEstimate = 0;

  for (const [key, buffer] of ctx.state.sampleBuffers.entries()) {
    if (!activeNames.has(key)) {
      freedBytesEstimate += buffer.byteLength;
      ctx.state.sampleBuffers.delete(key);
      ctx.state.ribbonEnvelopeCache.delete(key);
      removedCount++;
    }
  }

  if (ctx.state.session) {
    const activeZoneIds = new Set(ctx.state.session.zones.map((z) => z.id));
    for (const zoneId of ctx.state.spectralCache.keys()) {
      if (!activeZoneIds.has(zoneId)) {
        ctx.state.spectralCache.delete(zoneId);
      }
    }
  }

  return { removedCount, freedBytesEstimate };
}

export function getSession(ctx: PipelineContext): Session | null {
  return ctx.state.session;
}

export function clearHistory(ctx: PipelineContext): void {
  ctx.state.history.clear();
  ctx.emit({ type: 'history-changed', history: getHistoryState(ctx) });
}

export function pushHistory(ctx: PipelineContext, label: string, coalesceKey?: string): void {
  if (!ctx.state.session) return;
  const recorded = ctx.state.history.push(
    {
      sessionName: ctx.state.session.name,
      zones: ctx.state.session.zones,
      extendedRegions: ctx.state.session.extendedRegions,
      articulation: ctx.state.session.articulation,
      detectedInstrumentCategory: ctx.state.session.detectedInstrumentCategory,
      processConfig: ctx.state.session.processConfig,
    },
    label,
    coalesceKey
  );
  if (recorded) {
    pruneOrphanBuffers(ctx);
  }
  ctx.emit({ type: 'history-changed', history: getHistoryState(ctx) });
}

export function getHistoryState(ctx: PipelineContext): HistoryState {
  return ctx.state.history.getState();
}

export function applyHistoryDocument(
  ctx: PipelineContext,
  doc: {
  sessionName?: string;
  zones: Zone[];
  extendedRegions?: ExtendedRegion[];
  articulation?: SynthArticulationConfig;
  detectedInstrumentCategory?: string;
  processConfig: ProcessConfig;
  }
): void {
  if (!ctx.state.session) return;
  if (doc.sessionName !== undefined) ctx.state.session.name = doc.sessionName;
  ctx.state.session.zones = structuredClone(doc.zones);
  ctx.state.session.extendedRegions = doc.extendedRegions
    ? structuredClone(doc.extendedRegions)
    : undefined;
  ctx.state.session.articulation = doc.articulation
    ? structuredClone(doc.articulation)
    : undefined;
  ctx.state.session.detectedInstrumentCategory = doc.detectedInstrumentCategory;
  ctx.state.session.processConfig = structuredClone(doc.processConfig);
  ctx.state.session.dirty = true;
  ctx.state.session.modifiedAt = new Date().toISOString();
  ctx.ensureZoneDemoBuffers(ctx.state.session.zones);
  ctx.persistToLocalStorage();
  ctx.emit({ type: 'session-changed', session: ctx.state.session });
  ctx.emit({ type: 'history-changed', history: getHistoryState(ctx) });
}

export function undo(ctx: PipelineContext): Session | null {
  if (!ctx.state.session) return null;
  const restored = ctx.state.history.undo({
    sessionName: ctx.state.session.name,
    zones: ctx.state.session.zones,
    extendedRegions: ctx.state.session.extendedRegions,
    articulation: ctx.state.session.articulation,
    detectedInstrumentCategory: ctx.state.session.detectedInstrumentCategory,
    processConfig: ctx.state.session.processConfig,
  });
  if (!restored) return null;
  applyHistoryDocument(ctx, restored);
  return ctx.state.session;
}

export function redo(ctx: PipelineContext): Session | null {
  if (!ctx.state.session) return null;
  const restored = ctx.state.history.redo({
    sessionName: ctx.state.session.name,
    zones: ctx.state.session.zones,
    extendedRegions: ctx.state.session.extendedRegions,
    articulation: ctx.state.session.articulation,
    detectedInstrumentCategory: ctx.state.session.detectedInstrumentCategory,
    processConfig: ctx.state.session.processConfig,
  });
  if (!restored) return null;
  applyHistoryDocument(ctx, restored);
  return ctx.state.session;
}
