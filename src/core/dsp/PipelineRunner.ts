// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — PipelineRunner
//
// Executes the complete multi-zone WAV decoding -> pitch detection ->
// temporal spectral analysis -> Scape/Sphere frame generation pipeline.
// Shared between the Web Worker and main-thread fallback.
// ─────────────────────────────────────────────────────────

import type {
  Zone,
  ProcessConfig,
  ProcessProgress,
  ZoneAnalysisSummary,
} from '../types.ts';
import { decodeWav, midiNoteToHz, synthesizeDemoWav } from './WavDecoder.ts';
import { SpectralAnalyzer } from './SpectralAnalyzer.ts';
import { buildLayerView } from './GridIndicator.ts';
import {
  complexityToLimits,
  generateScapeSphereFrames,
  patchBinaryPairParameterSet,
  resynthesizeModelToPcm,
} from './ScapeSphereGenerator.ts';
import {
  applyEnhancedSpectralModel,
  classifyAcousticSample,
  computeDspQualityScore,
  extractAcousticDescriptors,
} from './AcousticIntelligence.ts';

export interface PreservedSourceBinary {
  scapeBinary: Uint8Array;
  sphereBinary: Uint8Array;
  origParameterSet: number;
  summary: ZoneAnalysisSummary;
}

export interface ZoneWavPayload {
  zone: Zone;
  /** Raw WAV file bytes for Low Vel sample if provided; if null, synthesizes a matching acoustic demo WAV */
  wavBuffer: ArrayBuffer | null;
  /** Optional raw WAV file bytes for High Vel sample (`sampleHigh`) */
  highWavBuffer?: ArrayBuffer | null;
  /** If this zone's Low Vel sample is an unmodified source from an imported `.model`, preserve its `.scape`/`.sphere` losslessly */
  preservedLowBinary?: PreservedSourceBinary;
  /** If this zone's High Vel sample is an unmodified source from an imported `.model`, preserve its `.scape`/`.sphere` losslessly */
  preservedHighBinary?: PreservedSourceBinary;
}

export interface ZoneBinaryPair {
  scapeBinary: Uint8Array;
  sphereBinary: Uint8Array;
}

export interface PipelineRunResult {
  zonesAnalysis: ZoneAnalysisSummary[];
  neuronikModelJson: string;
  zoneBinaries: ZoneBinaryPair[];
}

function inferTimbreFromSampleName(
  sampleName: string | null
): 'bass' | 'piano' | 'strings' | 'pad' | 'bell' {
  const s = (sampleName ?? '').toLowerCase();
  if (s.includes('bass')) return 'bass';
  if (s.includes('piano') || s.includes('key')) return 'piano';
  if (s.includes('string') || s.includes('cello') || s.includes('violin')) return 'strings';
  if (s.includes('bell') || s.includes('metal') || s.includes('pluck')) return 'bell';
  return 'pad';
}

/**
 * Analyzes a single zone's WAV buffer (or synthesized acoustic buffer if none is loaded)
 * using the full TypeScript DSP pipeline.
 */
export function analyzeSingleZone(
  payload: ZoneWavPayload,
  config: ProcessConfig,
  analyzer: SpectralAnalyzer
): {
  summary: ZoneAnalysisSummary;
  zoneJson: Record<string, unknown>;
  scapeBinary: Uint8Array;
  sphereBinary: Uint8Array;
} {
  const { zone } = payload;
  const sampleName = zone.sampleLow ?? `Zone_${zone.rootKey}.wav`;
  const rawBuffer =
    payload.wavBuffer ??
    synthesizeDemoWav(inferTimbreFromSampleName(sampleName), zone.rootKey, 44100, 1.0);

  // 1. Decode RIFF/WAVE
  const decoded = decodeWav(rawBuffer);

  // 2. Compute target F0 from rootKey + detune cents, and run Fase 7 Hybrid Pitch + Acoustic Intelligence
  const detuneRatio = Math.pow(2.0, (zone.detune || 0) / 1200.0);
  const nominalF0Hz = midiNoteToHz(zone.rootKey) * detuneRatio;

  const acousticDescriptors = extractAcousticDescriptors(
    decoded.channels,
    decoded.sampleRate,
    analyzer,
    nominalF0Hz
  );
  const classification = classifyAcousticSample(acousticDescriptors, sampleName);

  // If sound is unpitched/percussive noise, anchor partial grid to nominalF0Hz so partials don't warp
  const analysisF0Hz =
    !acousticDescriptors.isPercussiveOrNoise && acousticDescriptors.detectedF0Hz > 0
      ? acousticDescriptors.detectedF0Hz
      : nominalF0Hz;

  // 3. Multi-frame temporal spectral analysis + layer clustering
  const { targetFrames } = complexityToLimits(config.complexity);
  const legacyModel = analyzer.analyzeTemporal(
    decoded.channels,
    decoded.sampleRate,
    analysisF0Hz,
    targetFrames,
    false,
    'descriptors'
  );
  const enhancedModel = applyEnhancedSpectralModel(legacyModel, acousticDescriptors);
  const dspAlgorithm = config.dspAlgorithm ?? 'legacy';
  const activeModel = dspAlgorithm === 'enhanced' ? enhancedModel : legacyModel;

  // 4. Generate Scape/Sphere frames & canonical .neuronikmodel JSON
  const compiled = generateScapeSphereFrames(activeModel, {
    ...config,
    modelName: `${config.modelName}_Z${zone.lowKey}_${zone.highKey}`,
  });

  const fold = analyzer.lastOctaveFold();
  const layerView = buildLayerView(activeModel, fold);
  const gridResidualCents = Number(analyzer.lastGridResidualCents().toFixed(2));

  // 5. Compute objective Quality Score (Original vs Legacy DSP vs Enhanced DSP)
  const evalDur = Math.min(0.6, Math.max(0.2, decoded.durationSec));
  const legacyPcm = resynthesizeModelToPcm(legacyModel, evalDur, decoded.sampleRate, analysisF0Hz);
  const enhancedPcm = resynthesizeModelToPcm(
    enhancedModel,
    evalDur,
    decoded.sampleRate,
    analysisF0Hz
  );
  const qualityScore = computeDspQualityScore(
    decoded.channels,
    legacyPcm,
    enhancedPcm,
    legacyModel,
    enhancedModel,
    dspAlgorithm,
    gridResidualCents
  );

  const summary: ZoneAnalysisSummary = {
    zoneId: zone.id,
    lowKey: zone.lowKey,
    rootKey: zone.rootKey,
    highKey: zone.highKey,
    sampleName,
    sampleRate: decoded.sampleRate,
    durationSec: Number(decoded.durationSec.toFixed(3)),
    detectedF0Hz: Number(analysisF0Hz.toFixed(2)),
    targetF0Hz: Number(nominalF0Hz.toFixed(2)),
    gridResidualCents,
    gridObservations: analyzer.lastGridObservations(),
    gridBand: analyzer.gridResidualBand(),
    gridNotice: analyzer.gridResidualNotice(),
    layerCount: activeModel.layerCount,
    frameCount: activeModel.frameCount,
    activePartials: layerView.activePartials,
    octaveFoldCents: Number(fold.foldCents.toFixed(2)),
    biGrid: fold.biGrid,
    amplitudes: Array.from(activeModel.amplitudes, (v) => Number(v.toFixed(5))),
    frequencyOffsets: Array.from(activeModel.frequencyOffsets, (v) =>
      Number(v.toFixed(3))
    ),
    dspAlgorithm,
    acousticDescriptors,
    classification,
    qualityScore,
  };

  return {
    summary,
    zoneJson: {
      zoneId: zone.id,
      lowKey: zone.lowKey,
      rootKey: zone.rootKey,
      highKey: zone.highKey,
      sampleName,
      model: compiled.neuronikJson,
    },
    scapeBinary: compiled.scapeBinary,
    sphereBinary: compiled.sphereBinary,
  };
}

/**
 * Runs the full multi-zone pipeline, reporting progress after each stage.
 */
export async function runMultiZonePipeline(
  payloads: ZoneWavPayload[],
  config: ProcessConfig,
  onProgress: (progress: ProcessProgress) => void,
  isCancelled: () => boolean
): Promise<PipelineRunResult> {
  const startTime = Date.now();
  const totalZones = payloads.length;
  const analyzer = new SpectralAnalyzer();
  const zonesAnalysis: ZoneAnalysisSummary[] = [];
  const zoneModelsJson: Record<string, unknown>[] = [];
  const zoneBinaries: ZoneBinaryPair[] = [];
  // Canonical SessionData.createSourceMap() deduplication cache: each unique sample file is analyzed once
  const analyzedBySample = new Map<
    string,
    ReturnType<typeof analyzeSingleZone>
  >();

  for (let i = 0; i < totalZones; i++) {
    if (isCancelled()) {
      throw new Error('Process cancelled by user');
    }

    const item = payloads[i];
    const sampleName = item.zone.sampleLow ?? `Zone_${item.zone.rootKey}.wav`;
    const cachedLow = analyzedBySample.get(sampleName);

    onProgress({
      status: 'running',
      currentZone: i + 1,
      totalZones,
      currentSample: sampleName,
      percent: Math.round((i / totalZones) * 100),
      message: cachedLow
        ? `Zone ${i + 1}/${totalZones}: reusing already-analyzed source (${sampleName})...`
        : item.preservedLowBinary
          ? `Zone ${i + 1}/${totalZones}: preserving original .scape / .sphere binary losslessly (${sampleName})...`
          : `Analyzing zone ${i + 1}/${totalZones} (${sampleName}): WAV decode + 8192-pt STFT...`,
      elapsedMs: Date.now() - startTime,
    });

    // Yield to event loop so cancel messages / UI updates can be processed
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    if (isCancelled()) {
      throw new Error('Process cancelled by user');
    }

    let lowResult = cachedLow;
    if (!lowResult) {
      if (item.preservedLowBinary) {
        const patched = patchBinaryPairParameterSet(
          item.preservedLowBinary.scapeBinary,
          item.preservedLowBinary.sphereBinary,
          config.parameterSet,
          item.preservedLowBinary.origParameterSet
        );
        lowResult = {
          summary: { ...item.preservedLowBinary.summary },
          zoneJson: {
            zoneId: item.zone.id,
            lowKey: item.zone.lowKey,
            rootKey: item.zone.rootKey,
            highKey: item.zone.highKey,
            sampleName,
            preservedLossless: true,
          },
          scapeBinary: patched.scapeBinary,
          sphereBinary: patched.sphereBinary,
        };
      } else {
        lowResult = analyzeSingleZone(item, config, analyzer);
      }
      analyzedBySample.set(sampleName, lowResult);
      zoneBinaries.push({
        scapeBinary: lowResult.scapeBinary,
        sphereBinary: lowResult.sphereBinary,
      });
    }

    // If zone also has a distinct High Vel sample, deduplicate and analyze it via createSourceMap() order
    if (item.zone.sampleHigh && !analyzedBySample.has(item.zone.sampleHigh)) {
      let highResult: ReturnType<typeof analyzeSingleZone>;
      if (item.preservedHighBinary) {
        const patchedHigh = patchBinaryPairParameterSet(
          item.preservedHighBinary.scapeBinary,
          item.preservedHighBinary.sphereBinary,
          config.parameterSet,
          item.preservedHighBinary.origParameterSet
        );
        highResult = {
          summary: { ...item.preservedHighBinary.summary, sampleName: item.zone.sampleHigh },
          zoneJson: {
            zoneId: item.zone.id,
            lowKey: item.zone.lowKey,
            rootKey: item.zone.rootKey,
            highKey: item.zone.highKey,
            sampleName: item.zone.sampleHigh,
            preservedLossless: true,
          },
          scapeBinary: patchedHigh.scapeBinary,
          sphereBinary: patchedHigh.sphereBinary,
        };
      } else {
        const highZone: Zone = {
          ...item.zone,
          sampleLow: item.zone.sampleHigh,
        };
        highResult = analyzeSingleZone(
          {
            zone: highZone,
            wavBuffer: item.highWavBuffer ?? item.wavBuffer,
          },
          config,
          analyzer
        );
      }
      analyzedBySample.set(item.zone.sampleHigh, highResult);
      zoneBinaries.push({
        scapeBinary: highResult.scapeBinary,
        sphereBinary: highResult.sphereBinary,
      });
    }

    const summary: ZoneAnalysisSummary = {
      ...lowResult.summary,
      zoneId: item.zone.id,
      lowKey: item.zone.lowKey,
      rootKey: item.zone.rootKey,
      highKey: item.zone.highKey,
      sampleName,
    };
    const zoneJson: Record<string, unknown> = {
      ...lowResult.zoneJson,
      zoneId: item.zone.id,
      lowKey: item.zone.lowKey,
      rootKey: item.zone.rootKey,
      highKey: item.zone.highKey,
      sampleName,
      sampleHigh: item.zone.sampleHigh,
    };

    zonesAnalysis.push(summary);
    zoneModelsJson.push(zoneJson);

    onProgress({
      status: 'running',
      currentZone: i + 1,
      totalZones,
      currentSample: sampleName,
      percent: Math.round(((i + 1) / totalZones) * 100),
      message: `Zone ${i + 1}/${totalZones} complete: f0=${summary.detectedF0Hz} Hz, ${summary.gridNotice}, ${summary.layerCount} layer(s)`,
      elapsedMs: Date.now() - startTime,
    });
  }

  // Build top-level multi-zone .neuronikmodel bundle (primary zone at root for v2/v2.1 compatibility)
  const primaryModel =
    (zoneModelsJson[0]?.model as Record<string, unknown> | undefined) ?? {};
  const bundleJson = {
    ...primaryModel,
    name: config.modelName,
    slot: config.modelNumber,
    complexity: config.complexity,
    parameterSet: config.parameterSet,
    zoneCount: totalZones,
    zones: zoneModelsJson,
  };

  return {
    zonesAnalysis,
    neuronikModelJson: JSON.stringify(bundleJson, null, 2),
    zoneBinaries,
  };
}
