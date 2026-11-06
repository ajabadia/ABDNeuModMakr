import type { PipelineContext } from './types.ts';
import { decodeWav, midiNoteToHz, synthesizeDemoWav } from '../dsp/WavDecoder.ts';
import { inspectZoneSpectrum } from './spectralOps.ts';
import { markDirty } from './persistenceOps.ts';
import { pushHistory } from './sessionHistoryOps.ts';
import type { MidiNote, AcousticClassificationResult } from '../types.ts';
import { buildAxionikExpandedModel } from '../expandedModelWriter.ts';
import { renderResynatorWasm } from '../dsp/ResynatorV2Wasm.ts';
import { syncExtendedRegionsFromClassicZones } from '../extendedAdapter.ts';
import { extractAcousticDescriptors, classifyAcousticSample } from '../dsp/AcousticIntelligence.ts';
import { clamp } from '../dsp/DspMath.ts';

/**
 * Sintetiza el estéreo de preescucha con el MOTOR Resynator v2 (WASM).
 * Construye el documento del modelo con el writer y lo renderiza en el
 * artefacto compilado de `AxionikExpandedSynthesizer.h`. Sin espejos.
 */
export async function synthesizeZoneResynatorV2(ctx: PipelineContext, zoneId: string, targetNote?: MidiNote, velocity = 100, hostBpm?: number): Promise<{ left: Float32Array; right: Float32Array; sampleRate: number } | undefined> {
  if (!ctx.state.session) return undefined;
  const session = ctx.state.session;
  const zone =
    session.zones.find((z) => z.id === zoneId) ?? session.zones[0];
  if (!zone) return undefined;

  if (!ctx.state.spectralCache.has(zone.id)) {
    inspectZoneSpectrum(ctx, zone.id);
  }
  const cached = ctx.state.spectralCache.get(zone.id);
  if (!cached) return undefined;

  const surfCfg = session.processConfig.unifiedSurfaceConfig ?? {};
  const sampleName = zone.sampleLow ?? `Zone_${zone.rootKey}.wav`;
  const tempoSync =
    surfCfg.tempoSync ??
    (hostBpm
      ? {
          enabled: true,
          sourceBpm: 120,
          targetBpm: hostBpm,
          barCount: 1,
          timeSignature: [4, 4] as [number, number],
          grooveMode: 'slice_synced' as const,
          sliceStartFrames: [0],
        }
      : undefined);
  const regions =
    session.extendedRegions && session.extendedRegions.length > 0
      ? session.extendedRegions
      : syncExtendedRegionsFromClassicZones([{ ...zone, sampleLow: sampleName }]);
  const doc = buildAxionikExpandedModel({
    slot: session.processConfig.modelNumber,
    modelName: session.processConfig.modelName,
    expandedName: session.processConfig.expandedName || session.processConfig.modelName,
    processConfig: {
      ...session.processConfig,
      unifiedSurfaceConfig: tempoSync ? { ...surfCfg, tempoSync } : surfCfg,
    },
    spectral: cached.enhancedModel,
    spectralBySample: { [sampleName]: cached.enhancedModel },
    regions,
    articulation: session.articulation,
    detectedInstrumentCategory: session.detectedInstrumentCategory,
    qualityScore: cached.inspection.summary.qualityScore,
    acousticDescriptors: cached.inspection.summary.acousticDescriptors,
    populateAdvancedSpectralExtensions: true,
    buildUnifiedSurface: true,
    hasHybridTransient: surfCfg.preserveHybridTransients !== false,
  });
  // El motor resuelve su propia f0; esto solo tapa huecos como hacía la
  // preescucha anterior para que ningún frame viaje sin referencia tonal.
  const fallbackF0Hz = cached.detectedF0Hz > 0 ? cached.detectedF0Hz : midiNoteToHz(zone.rootKey);
  const patchFrames = (frames: { f0Hz?: number; timeSec?: number }[]): void => {
    const n = Math.max(1, frames.length);
    for (let f = 0; f < frames.length; f++) {
      const fr = frames[f];
      if (!fr.f0Hz || fr.f0Hz <= 0) fr.f0Hz = fallbackF0Hz;
      fr.timeSec = Number(((f / Math.max(1, n - 1)) * cached.durationSec).toFixed(4));
    }
  };
  patchFrames(doc.spectral.frames);
  if (doc.spectralBySample) {
    for (const s of Object.values(doc.spectralBySample)) patchFrames(s.frames);
  }

  const midiNote = targetNote ?? zone.rootKey;
  const totalDurSec = Math.min(
    8.0,
    Math.max(0.35, cached.durationSec + (surfCfg.releaseExtendSec ?? 0) * 0.65)
  );
  const out = await renderResynatorWasm({
    modelJson: JSON.stringify(doc),
    midiNote,
    velocity01: clamp(velocity, 1, 127) / 127,
    seconds: totalDurSec,
    sampleRate: 44100,
  });
  return { left: out.stereoL, right: out.stereoR, sampleRate: 44100 };
}

export function autoDetectZonePitchAndParameterSet(ctx: PipelineContext, zoneId?: string, applyToSession = true): AcousticClassificationResult {
  if (!ctx.state.session) throw new Error('No active session');
  const zone =
    (zoneId ? ctx.state.session.zones.find((z) => z.id === zoneId) : null) ??
    ctx.state.session.zones[0];
  if (!zone) throw new Error('No zone available for acoustic detection');

  ctx.ensureZoneDemoBuffers([zone]);
  const sampleName = zone.sampleLow ?? `Zone_${zone.rootKey}.wav`;
  const wavBuffer =
    (zone.sampleLow ? ctx.state.sampleBuffers.get(zone.sampleLow) : null) ??
    synthesizeDemoWav('strings', zone.rootKey, 44100, 1.0);

  const decoded = decodeWav(wavBuffer);
  const nominalF0Hz = midiNoteToHz(zone.rootKey);
  const descriptors = extractAcousticDescriptors(
    decoded.channels,
    decoded.sampleRate,
    ctx.state.analyzer,
    nominalF0Hz
  );
  const result = classifyAcousticSample(descriptors, sampleName);

  if (applyToSession) {
    pushHistory(ctx, `Auto-Detect Pitch & Parameter Set (${sampleName})`);
    if (!descriptors.isPercussiveOrNoise && descriptors.pitchConfidence >= 0.35) {
      zone.rootKey = clamp(descriptors.detectedMidiNote, 0, 127);
      zone.detune = clamp(descriptors.detectedCentOffset, -99, 99);
    } else if (
      descriptors.isPercussiveOrNoise &&
      ctx.state.session.extendedRegions
    ) {
      const reg = ctx.state.session.extendedRegions.find(
        (r) => r.sampleName === zone.sampleLow
      );
      if (reg) {
        reg.pitchKeytrack = 0;
      }
    }
    ctx.state.session.processConfig.parameterSet = clamp(
      result.recommendedParameterSet,
      0,
      9
    );
    ctx.state.session.detectedInstrumentCategory = result.detectedCategory;
    ctx.state.spectralCache.delete(zone.id);
    markDirty(ctx);
  }

  return result;
}
