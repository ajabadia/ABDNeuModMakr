import type { PipelineContext } from './types.ts';
import { basename } from '../pathUtils.ts';
import { MAX_IMPORT_FILE_BYTES } from '../import/modelImportService.ts';
import { decodeWav } from '../dsp/WavDecoder.ts';
import type { DecodedWav } from '../dsp/WavDecoder.ts';

export function registerSampleBuffer(ctx: PipelineContext, sampleName: string, wavBuffer: ArrayBuffer, options?: { isPromotedEnhanced?: boolean; rawSourceName?: string; isResynthesizedFromLegacy?: boolean; }): DecodedWav {
  if (wavBuffer.byteLength > MAX_IMPORT_FILE_BYTES) {
    throw new Error(
      `Sample '${sampleName}' exceeds the ${MAX_IMPORT_FILE_BYTES / (1024 * 1024)} MB per-file import limit (${(wavBuffer.byteLength / (1024 * 1024)).toFixed(1)} MB)`
    );
  }
  const decoded = decodeWav(wavBuffer);
  ctx.state.sampleBuffers.set(sampleName, wavBuffer);
  ctx.state.importedSourceBinaries.delete(sampleName);
  ctx.state.ribbonEnvelopeCache.delete(sampleName);

  if (options?.isPromotedEnhanced) {
    ctx.state.assetStore.setEnhancedAudio(sampleName, wavBuffer);
    if (options.rawSourceName) {
      ctx.state.assetStore.linkPromotedToRawSource(
        sampleName,
        options.rawSourceName
      );
    }
  } else if (!options?.isResynthesizedFromLegacy) {
    ctx.state.assetStore.setRawSource(sampleName, wavBuffer);
  }

  return decoded;
}

export function getSampleBuffer(ctx: PipelineContext, sampleName: string): ArrayBuffer | undefined {
  return lookupSampleBuffer(ctx, sampleName) ?? ctx.state.sampleBuffers.get(sampleName);
}

export function lookupSampleBuffer(ctx: PipelineContext, name: string | null | undefined): ArrayBuffer | undefined {
  if (!name) return undefined;
  const base = basename(name) || name;
  const candidates = base !== name ? [name, base] : [name];
  for (const key of candidates) {
    const hit = ctx.state.sampleBuffers.get(key);
    if (hit) return hit;
  }
  for (const key of candidates) {
    const stored =
      ctx.state.assetStore.getRawSourceSync(key) ?? ctx.state.assetStore.getEnhancedAudioSync(key);
    if (stored) {
      ctx.state.sampleBuffers.set(name, stored);
      return stored;
    }
  }
  return undefined;
}

export function getLoadedSampleNames(ctx: PipelineContext): string[] {
  const names = new Set<string>(ctx.state.sampleBuffers.keys());
  if (ctx.state.session) {
    for (const z of ctx.state.session.zones) {
      if (z.sampleLow) names.add(z.sampleLow);
      if (z.sampleHigh) names.add(z.sampleHigh);
    }
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}
