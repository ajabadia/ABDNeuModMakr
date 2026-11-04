import type { PipelineContext } from './types.ts';
import { decodeWav, midiNoteToHz, synthesizeDemoWav } from '../dsp/WavDecoder.ts';
import { synthesizeResynatorV2Preview } from '@abdsynths/shared/dsp/neuron-analysis';
import { inspectZoneSpectrum } from './spectralOps.ts';
import { markDirty } from './persistenceOps.ts';
import { pushHistory } from './sessionHistoryOps.ts';
import type { MidiNote, AcousticClassificationResult } from '../types.ts';
import { buildSpectralModel } from '../expandedModelWriter.ts';
import { buildUnifiedSpectralSurface, evaluateUnifiedSpectralSurface } from '../dsp/UnifiedSpectralSurface.ts';
import { extractAcousticDescriptors, classifyAcousticSample } from '../dsp/AcousticIntelligence.ts';
import { clamp } from '../dsp/DspMath.ts';

export function synthesizeZoneResynatorV2(ctx: PipelineContext, zoneId: string, targetNote?: MidiNote, velocity = 100, hostBpm?: number): { left: Float32Array; right: Float32Array; sampleRate: number } | undefined {
  if (!ctx.state.session) return undefined;
  const zone =
    ctx.state.session.zones.find((z) => z.id === zoneId) ?? ctx.state.session.zones[0];
  if (!zone) return undefined;

  if (!ctx.state.spectralCache.has(zone.id)) {
    inspectZoneSpectrum(ctx, zone.id);
  }
  const cached = ctx.state.spectralCache.get(zone.id);
  if (!cached) return undefined;

  const surfCfg = ctx.state.session.processConfig.unifiedSurfaceConfig ?? {};
  const axSpectral = buildSpectralModel(cached.enhancedModel, undefined, undefined, true);
  const frameCount = Math.max(1, axSpectral.frames.length);
  for (let f = 0; f < frameCount; f++) {
    const fr = axSpectral.frames[f];
    if (!fr.f0Hz || fr.f0Hz <= 0) {
      fr.f0Hz = cached.detectedF0Hz > 0 ? cached.detectedF0Hz : midiNoteToHz(zone.rootKey);
    }
    fr.timeSec = Number(((f / Math.max(1, frameCount - 1)) * cached.durationSec).toFixed(4));
  }

  const effectiveHostBpm =
    hostBpm ?? surfCfg.tempoSync?.targetBpm ?? surfCfg.tempoSync?.sourceBpm;
  const effectiveTempoSync =
    surfCfg.tempoSync ??
    (effectiveHostBpm
      ? {
          enabled: true,
          sourceBpm: 120,
          targetBpm: effectiveHostBpm,
          barCount: 1,
          timeSignature: [4, 4] as [number, number],
          grooveMode: 'slice_synced' as const,
          sliceStartFrames: [0],
        }
      : undefined);

  const sampleName = zone.sampleLow ?? `Zone_${zone.rootKey}.wav`;
  const surface = buildUnifiedSpectralSurface({
    regions: [
      {
        id: zone.id,
        sampleRef: sampleName,
        lowKey: zone.lowKey,
        highKey: zone.highKey,
        rootKey: zone.rootKey,
        lowVel: 1,
        highVel: 127,
      },
    ],
    primarySpectral: axSpectral,
    spectralBySample: { [sampleName]: axSpectral },
    resolutionStrategy: surfCfg.resolutionStrategy ?? 'auto',
    complexity: ctx.state.session.processConfig.complexity,
    topologyOverride: surfCfg.topologyMode ?? 'auto',
    tempoSync: effectiveTempoSync,
  });

  const midiNote = targetNote ?? zone.rootKey;
  const evaluated = evaluateUnifiedSpectralSurface(surface, {
    midiNote,
    velocity,
    attackShorten01: surfCfg.attackShorten01 ?? 0,
    releaseExtendSec: surfCfg.releaseExtendSec ?? 0,
    formantLock01: surfCfg.formantLock01 ?? 1.0,
    includeOutliers: surfCfg.includeOutliers ?? false,
    hostBpm: effectiveHostBpm,
  });

  const baseDur =
    cached.durationSec *
    (evaluated.tempoScaleFactor && evaluated.tempoScaleFactor > 0
      ? 1 / evaluated.tempoScaleFactor
      : 1);
  const totalDurSec = Math.min(
    8.0,
    Math.max(0.35, baseDur + (surfCfg.releaseExtendSec ?? 0) * 0.65)
  );

  const preserveTransients = surfCfg.preserveHybridTransients !== false;
  const transientFrames = Math.min(
    cached.decodedMono.length,
    Math.floor(0.03 * cached.decodedSampleRate)
  );
  const transientPcm =
    preserveTransients && (surfCfg.attackShorten01 ?? 0) < 0.5 && transientFrames > 0
      ? cached.decodedMono.subarray(0, transientFrames)
      : undefined;

  const synthOut = synthesizeResynatorV2Preview({
    frames: evaluated.frames,
    targetF0Hz: evaluated.targetF0Hz,
    partialCount: evaluated.partialCount,
    startFrameIndex: evaluated.startFrameIndex,
    sustainStartFrame: evaluated.sustainStartFrame,
    sustainEndFrame: evaluated.sustainEndFrame,
    sustainBehavior: evaluated.sustainBehavior,
    modulation: evaluated.modulation,
    shapers: {
      inharmonicityB:
        surfCfg.inharmonicityB ??
        cached.inspection.summary.acousticDescriptors?.inharmonicityB ??
        0,
      parity: surfCfg.parity ?? 0,
      residualMix: surfCfg.residualMix ?? 0.15,
      formantPreserve: surfCfg.formantLock01 ?? 1.0,
      spatialSpread: 0.55,
    },
    transientPcm,
    hybridTransient: transientPcm
      ? {
          durationMs: 22,
          crossfadeMs: 8,
          gainDb: 0,
        }
      : undefined,
    durationSec: totalDurSec,
    sampleRate: 44100,
  });

  return {
    left: synthOut.stereoL,
    right: synthOut.stereoR,
    sampleRate: synthOut.sampleRate,
  };
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
