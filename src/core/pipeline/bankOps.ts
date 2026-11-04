import type { PipelineContext } from './types.ts';
import type { BankSummary, GeneratedModel, ModelCoverArtwork, Session } from '../types.ts';
import { convertImageToCoverWebp } from '../coverArtwork.ts';
import { markDirty } from './persistenceOps.ts';
import { pushHistory } from './sessionHistoryOps.ts';

export function setBankPresets(ctx: PipelineContext, presets: BankSummary['presets']): void {
  ctx.state.bank.setBankPresets(presets);
}

export async function clearGeneratedModels(ctx: PipelineContext): Promise<void> {
  return ctx.state.bank.clearGeneratedModels();
}

export function buildModelZipBytes(ctx: PipelineContext, slot: number): Uint8Array {
  return ctx.state.bank.buildModelZipBytes(slot);
}

export async function exportModel(ctx: PipelineContext, slot: number, targetPath: string): Promise<void> {
  return ctx.state.bank.exportModel(slot, targetPath);
}

export async function saveToAxionikDb(ctx: PipelineContext, options?: { customSlug?: string; customName?: string; saveAs?: boolean; sublibrary?: string; sublibraryOrdinal?: number; }): Promise<{ slug: string; path: string; isBridge: boolean; count: number; sublibrary: string }> {
  return ctx.state.bank.saveToAxionikDb(options);
}

export async function listSublibraries(ctx: PipelineContext): Promise<import('../types.ts').SublibraryInfo[]> {
  return ctx.state.bank.listSublibraries();
}

export async function createSublibrary(ctx: PipelineContext, name: string, description?: string, order?: number): Promise<import('../types.ts').SublibraryInfo> {
  return ctx.state.bank.createSublibrary(name, description, order);
}

export async function deleteSublibrary(ctx: PipelineContext, name: string): Promise<void> {
  return ctx.state.bank.deleteSublibrary(name);
}

export async function moveModelToSublibrary(ctx: PipelineContext, slugOrSlot: string | number, targetSublibrary: string): Promise<void> {
  return ctx.state.bank.moveModelToSublibrary(slugOrSlot, targetSublibrary);
}

export async function reorderModelsInSublibrary(ctx: PipelineContext, sublibrary: string, orderedSlugsOrSlots: Array<string | number>): Promise<void> {
  return ctx.state.bank.reorderModelsInSublibrary(sublibrary, orderedSlugsOrSlots);
}

export function exportZoneAsAiff(ctx: PipelineContext, zoneId: string): { filename: string; bytes: Uint8Array } {
  return ctx.state.bank.exportZoneAsAiff(zoneId);
}

export async function importModel(ctx: PipelineContext, _sourcePath: string, slot: number): Promise<GeneratedModel> {
  return ctx.state.bank.importModel(_sourcePath, slot);
}

export function setModelCoverArtwork(ctx: PipelineContext, artwork: ModelCoverArtwork | null): Session {
  if (!ctx.state.session) throw new Error('No active session');
  pushHistory(ctx, 
    artwork ? 'Set Model Cover Artwork (.webp)' : 'Remove Model Cover Artwork',
    'config:coverArtwork'
  );
  ctx.state.session.processConfig.coverArtwork = artwork ? { ...artwork } : null;
  const slot = ctx.state.session.processConfig.modelNumber;
  const existingModel = ctx.state.bank.getModelRecord(slot);
  if (existingModel) {
    existingModel.coverWebpDataUrl = artwork?.webpDataUrl;
    ctx.state.bank.upsertModel(existingModel);
    ctx.state.bank.persistBank();
  }
  markDirty(ctx);
  return ctx.state.session;
}

export async function convertAndSetModelCoverArtwork(ctx: PipelineContext, input: File | Blob | ArrayBuffer | Uint8Array, originalName?: string): Promise<ModelCoverArtwork> {
  if (!ctx.state.session) throw new Error('No active session');
  const converted = await convertImageToCoverWebp(input, {
    originalName,
  });
  setModelCoverArtwork(ctx, converted.artwork);
  return converted.artwork;
}
