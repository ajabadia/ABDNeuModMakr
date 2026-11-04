import type { PipelineContext } from './types.ts';
import { lookupSampleBuffer } from './sampleBufferOps.ts';
import { persistSessionToLocalStorage, restoreSessionFromLocalStorage } from '../sessionPersistence.ts';

export function markDirty(ctx: PipelineContext): void {
  if (ctx.state.session) {
    ctx.state.session.dirty = true;
    ctx.state.session.modifiedAt = new Date().toISOString();
    persistToLocalStorage(ctx);
    ctx.emit({ type: 'session-changed', session: ctx.state.session });
  }
}

export function persistToLocalStorage(ctx: PipelineContext): void {
  persistSessionToLocalStorage(ctx.state.session);
  ctx.state.bank.persistBank();
}

export function restoreFromLocalStorage(ctx: PipelineContext): void {
  const restored = restoreSessionFromLocalStorage();
  if (restored) {
    ctx.state.session = restored;
    rehydrateSessionSampleBuffers(ctx);
    ctx.ensureZoneDemoBuffers(ctx.state.session.zones);
  }
  ctx.state.bank.restoreBank();
}

function rehydrateSessionSampleBuffers(ctx: PipelineContext): void {
  if (!ctx.state.session) return;
  const names = new Set<string>();
  for (const z of ctx.state.session.zones) {
    if (z.sampleLow) names.add(z.sampleLow);
    if (z.sampleHigh) names.add(z.sampleHigh);
  }
  for (const r of ctx.state.session.extendedRegions ?? []) {
    if (r.sampleName) names.add(r.sampleName);
  }
  for (const n of names) lookupSampleBuffer(ctx, n);
}
