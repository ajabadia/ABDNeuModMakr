import type { PipelineContext } from './types.ts';
import { decodeWav, synthesizeDemoWav } from '../dsp/WavDecoder.ts';
import type { ZoneSpectralInspection, SpectralPartialTrack, ZoneAnalysisSummary } from '../types.ts';
import { analyzeSingleZone } from '../dsp/PipelineRunner.ts';
import { complexityToLimits, resynthesizeModelToPcm } from '../dsp/ScapeSphereGenerator.ts';
import { applyEnhancedSpectralModel } from '../dsp/AcousticIntelligence.ts';
import { buildLayerView } from '../dsp/GridIndicator.ts';
import { linearToDb, clamp } from '../dsp/DspMath.ts';
import { computeStft } from '../dsp/FftEngine.ts';

export function inspectZoneSpectrum(ctx: PipelineContext, zoneId: string): ZoneSpectralInspection {
  if (!ctx.state.session) throw new Error('No active session');
  const zone =
    ctx.state.session.zones.find((z) => z.id === zoneId) ?? ctx.state.session.zones[0];
  if (!zone) throw new Error(`Zone ${zoneId} not found`);

  ctx.ensureZoneDemoBuffers([zone]);
  const sampleName = zone.sampleLow ?? `Zone_${zone.rootKey}.wav`;
  const wavBuffer =
    (zone.sampleLow ? ctx.state.sampleBuffers.get(zone.sampleLow) : null) ??
    synthesizeDemoWav('strings', zone.rootKey, 44100, 1.0);

  const cfg = ctx.state.session.processConfig;
  const cacheKey = `${zone.id}|${sampleName}|${wavBuffer.byteLength}|${zone.rootKey}|${zone.detune}|${cfg.complexity}|${cfg.parameterSet}|${cfg.dspAlgorithm ?? 'legacy'}`;
  const cached = ctx.state.spectralCache.get(zone.id);
  if (cached && cached.key === cacheKey) {
    return cached.inspection;
  }

  const decoded = decodeWav(wavBuffer);
  const { summary } = analyzeSingleZone({ zone, wavBuffer }, cfg, ctx.state.analyzer);

  // Run temporal model analysis to extract multi-layer partial trajectories & additive resynthesis
  const { targetFrames } = complexityToLimits(cfg.complexity);
  const spectralModel = ctx.state.analyzer.analyzeTemporal(
    decoded.channels,
    decoded.sampleRate,
    summary.detectedF0Hz,
    targetFrames,
    false,
    'descriptors'
  );
  const octaveFold = ctx.state.analyzer.lastOctaveFold();
  const enhancedModel = applyEnhancedSpectralModel(
    spectralModel,
    summary.acousticDescriptors
  );
  const legacyLayerView = buildLayerView(spectralModel, octaveFold);
  const enhancedLayerView = buildLayerView(enhancedModel, octaveFold);

  const resynthDuration = Math.min(2.5, Math.max(0.6, decoded.durationSec));
  const resynthMono = resynthesizeModelToPcm(
    spectralModel,
    resynthDuration,
    44100,
    summary.detectedF0Hz
  );
  const enhancedMono = resynthesizeModelToPcm(
    enhancedModel,
    resynthDuration,
    44100,
    summary.detectedF0Hz
  );

  const computeEnvelopePeaks = (
    samples: Float32Array,
    columns = 180
  ): { min: number[]; max: number[]; rmsDb: number } => {
    const min = new Array<number>(columns).fill(0);
    const max = new Array<number>(columns).fill(0);
    if (samples.length === 0) return { min, max, rmsDb: -96 };

    let sumSq = 0;
    for (let i = 0; i < samples.length; i++) {
      sumSq += samples[i] * samples[i];
    }
    const rms = Math.sqrt(sumSq / samples.length);
    const rmsDb = Number(linearToDb(rms, -96).toFixed(1));

    for (let c = 0; c < columns; c++) {
      const i0 = Math.floor((c * samples.length) / columns);
      const i1 = Math.max(
        i0 + 1,
        Math.floor(((c + 1) * samples.length) / columns)
      );
      let lo = 1.0;
      let hi = -1.0;
      for (let i = i0; i < i1 && i < samples.length; i++) {
        const v = samples[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      min[c] = lo <= hi ? Number(lo.toFixed(4)) : 0;
      max[c] = lo <= hi ? Number(hi.toFixed(4)) : 0;
    }
    return { min, max, rmsDb };
  };

  const waveformPeaks = computeEnvelopePeaks(decoded.mono, 180);
  const resynthPeaks = computeEnvelopePeaks(resynthMono, 180);
  const enhancedResynthPeaks = computeEnvelopePeaks(enhancedMono, 180);

  const maxFreqHz = Math.min(
    decoded.sampleRate * 0.45,
    Math.max(4500, summary.detectedF0Hz * 36)
  );
  const displayBins = 96;

  const buildSpectrogramGrid = (
    pcm: Float32Array,
    sr: number
  ): {
    frameCount: number;
    binCount: number;
    maxFreqHz: number;
    magnitudes: number[][];
  } => {
    const maxAnalysisSamples = Math.min(pcm.length, Math.floor(sr * 3.0));
    const stftSlice = pcm.subarray(0, maxAnalysisSamples);
    const frameSize = 2048;
    const hopSize = Math.max(
      256,
      Math.floor(Math.max(1, stftSlice.length - frameSize) / 36)
    );
    const stft = computeStft(stftSlice, {
      frameSize,
      hopSize,
      windowType: 'blackman-harris',
      sampleRate: sr,
    });
    const maxBin = Math.max(
      16,
      Math.min(stft.numBins - 1, Math.round(maxFreqHz / stft.binWidthHz))
    );

    let peakMag = 1e-9;
    for (const fr of stft.frames) {
      for (let b = 1; b <= maxBin; b++) {
        if (fr.magnitudes[b] > peakMag) peakMag = fr.magnitudes[b];
      }
    }

    const magnitudes: number[][] = [];
    for (const fr of stft.frames) {
      const col = new Array<number>(displayBins).fill(0);
      for (let dbIdx = 0; dbIdx < displayBins; dbIdx++) {
        const b0 = Math.max(1, Math.floor((dbIdx * maxBin) / displayBins));
        const b1 = Math.max(
          b0 + 1,
          Math.floor(((dbIdx + 1) * maxBin) / displayBins)
        );
        let binMax = 0;
        for (let b = b0; b < b1 && b <= maxBin; b++) {
          if (fr.magnitudes[b] > binMax) binMax = fr.magnitudes[b];
        }
        const relDb = linearToDb(binMax / peakMag, -120);
        col[dbIdx] = Number(clamp((relDb + 72) / 72, 0, 1).toFixed(3));
      }
      magnitudes.push(col);
    }

    return {
      frameCount: magnitudes.length,
      binCount: displayBins,
      maxFreqHz: Math.round(maxFreqHz),
      magnitudes,
    };
  };

  const spectrogram = buildSpectrogramGrid(decoded.mono, decoded.sampleRate);
  const legacySpectrogram = buildSpectrogramGrid(resynthMono, 44100);
  const enhancedSpectrogram = buildSpectrogramGrid(enhancedMono, 44100);

  const buildTracksAndPartials = (
    model: typeof spectralModel,
    lv: typeof legacyLayerView
  ): { tracks: SpectralPartialTrack[]; partials: number[] } => {
    const tracks: SpectralPartialTrack[] = [];
    const partials = new Array<number>(64).fill(0);
    for (let k = 0; k < 64; k++) {
      const assignedLayer = Math.max(0, lv.layerOfPartial[k]);
      const peakAmp = lv.peakOfPartial[k];
      const nFrames = Math.max(1, model.numFramesOf(assignedLayer));
      const frames: { timeNorm: number; freqHz: number; amplitude: number }[] = [];
      let ampSum = 0;
      let maxFrameAmp = 0;

      for (let f = 0; f < nFrames; f++) {
        const timeNorm = nFrames > 1 ? f / (nFrames - 1) : 0;
        const amp = Math.abs(model.ampAt(assignedLayer, f, k));
        const offHz = model.offsetAt(assignedLayer, f, k);
        const f0Frame =
          model.f0AtLayer(assignedLayer, f) > 0
            ? model.f0AtLayer(assignedLayer, f)
            : summary.detectedF0Hz;
        const freqHz = Math.max(20, (k + 1) * f0Frame + offHz);
        ampSum += amp;
        if (amp > maxFrameAmp) maxFrameAmp = amp;
        frames.push({
          timeNorm: Number(timeNorm.toFixed(3)),
          freqHz: Number(freqHz.toFixed(2)),
          amplitude: Number(amp.toFixed(4)),
        });
      }

      const meanAmp = ampSum / Math.max(1, nFrames);
      partials[k] = Number(clamp(Math.max(meanAmp * 1.15, maxFrameAmp * 0.85), 0, 1).toFixed(4));

      if (peakAmp < 1e-4 && (summary.amplitudes[k] ?? 0) < 1e-4) continue;
      if (frames.length === 1) {
        frames.push({ ...frames[0], timeNorm: 1.0 });
      }

      tracks.push({
        partialIndex: k + 1,
        harmonicMultiple: k + 1,
        layerIndex: assignedLayer,
        meanAmplitude: Number(meanAmp.toFixed(4)),
        frames,
      });
    }
    return { tracks, partials };
  };

  const legacyBuilt = buildTracksAndPartials(spectralModel, legacyLayerView);
  const enhancedBuilt = buildTracksAndPartials(enhancedModel, enhancedLayerView);
  const isEnhancedActive = (cfg.dspAlgorithm ?? 'legacy') === 'enhanced';

  const inspection: ZoneSpectralInspection = {
    zoneId: zone.id,
    sampleName,
    sampleRate: decoded.sampleRate,
    durationSec: Number(decoded.durationSec.toFixed(3)),
    summary,
    waveformPeaks,
    resynthPeaks,
    enhancedResynthPeaks,
    qualityScore: summary.qualityScore,
    classification: summary.classification,
    spectrogram,
    legacySpectrogram,
    enhancedSpectrogram,
    partialTracks: isEnhancedActive ? enhancedBuilt.tracks : legacyBuilt.tracks,
    legacyPartialTracks: legacyBuilt.tracks,
    enhancedPartialTracks: enhancedBuilt.tracks,
    legacyPartials: legacyBuilt.partials,
    enhancedPartials: enhancedBuilt.partials,
  };

  ctx.state.spectralCache.set(zone.id, {
    key: cacheKey,
    inspection,
    resynthMono,
    enhancedMono,
    enhancedModel,
    decodedMono: decoded.mono,
    decodedSampleRate: decoded.sampleRate,
    detectedF0Hz: summary.detectedF0Hz,
    durationSec: resynthDuration,
  });

  return inspection;
}

export function analyzeZoneImmediate(ctx: PipelineContext, zoneId: string): ZoneAnalysisSummary {
  if (!ctx.state.session) throw new Error('No active session');
  const zone = ctx.state.session.zones.find((z) => z.id === zoneId);
  if (!zone) throw new Error(`Zone ${zoneId} not found`);

  const wavBuffer = zone.sampleLow
    ? (ctx.state.sampleBuffers.get(zone.sampleLow) ?? null)
    : null;

  const { summary } = analyzeSingleZone(
    { zone, wavBuffer },
    ctx.state.session.processConfig,
    ctx.state.analyzer
  );
  return summary;
}

export function getZoneSampleFormatInfo(
  ctx: PipelineContext,
  zoneId?: string,
  regionId?: string
): {
  sampleName: string;
  sampleRate: number;
  bitsPerSample: number;
  numChannels: number;
  durationSec: number;
  totalFrames: number;
  byteSize: number;
  loopStart: number;
  loopEnd: number;
} | null {
  if (!ctx.state.session) return null;
  const isClassic = (ctx.state.session.processConfig.workingMode ?? 'classic') === 'classic';
  const extRegions = ctx.state.session.extendedRegions ?? [];

  let targetZone = zoneId ? ctx.state.session.zones.find((z) => z.id === zoneId) : undefined;
  let targetReg =
    !isClassic && extRegions.length > 0
      ? (regionId
          ? extRegions.find((r) => r.id === regionId)
          : undefined)
      : undefined;

  if (!targetReg && regionId) {
    targetReg = extRegions.find((r) => r.id === regionId);
  }
  if (!targetZone && targetReg) {
    targetZone = ctx.state.session.zones.find(
      (z) =>
        targetReg!.id.includes(z.id) ||
        (targetReg!.sampleName && (z.sampleLow === targetReg!.sampleName || z.sampleHigh === targetReg!.sampleName)) ||
        (targetReg!.lowKey === z.lowKey && targetReg!.highKey === z.highKey)
    );
  }
  if (!targetZone) {
    targetZone = ctx.state.session.zones[0];
  }
  if (!targetZone && !targetReg) return null;

  const sampleName =
    (isClassic ? targetZone?.sampleLow : (targetReg?.sampleName || targetZone?.sampleLow)) ??
    targetZone?.sampleLow;
  if (!sampleName) return null;

  const buf = ctx.state.sampleBuffers.get(sampleName);
  if (!buf) return null;
  try {
    const dec = decodeWav(buf);
    const loopStart =
      targetReg && targetReg.loopEnd > targetReg.loopStart
        ? targetReg.loopStart
        : (dec.instrument?.loopStart ?? 0);
    const loopEnd =
      targetReg && targetReg.loopEnd > targetReg.loopStart
        ? targetReg.loopEnd
        : (dec.instrument?.loopEnd ?? 0);
    return {
      sampleName,
      sampleRate: dec.sampleRate,
      bitsPerSample: dec.bitsPerSample,
      numChannels: dec.numChannels,
      durationSec: Number(dec.durationSec.toFixed(3)),
      totalFrames: dec.mono.length,
      byteSize: buf.byteLength,
      loopStart,
      loopEnd,
    };
  } catch {
    return null;
  }
}
