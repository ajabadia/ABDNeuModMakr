import type { PipelineContext } from './types.ts';
import type { DahdsrEnvelope, LoopMode, MidiNote, ZoneLoopEditorData } from '../types.ts';
import { clamp } from '../dsp/DspMath.ts';
import { decodeWav, synthesizeDemoWav, type DecodedWav } from '../dsp/WavDecoder.ts';
import { getExtendedRegions } from './importOps.ts';
import { lookupSampleBuffer } from './sampleBufferOps.ts';

export function getZoneLoopEditorData(ctx: PipelineContext, zoneId?: string, regionId?: string): ZoneLoopEditorData | null {
  if (!ctx.state.session) return null;
  const isClassic = (ctx.state.session.processConfig.workingMode ?? 'classic') === 'classic';
  const extRegions = getExtendedRegions(ctx);

  let targetZone = zoneId ? ctx.state.session.zones.find((z) => z.id === zoneId) : undefined;
  let activeReg =
    !isClassic && extRegions.length > 0
      ? (regionId
          ? extRegions.find((r) => r.id === regionId)
          : targetZone
            ? extRegions.find(
                (r) =>
                  r.id.includes(targetZone!.id) ||
                  (targetZone!.sampleLow && r.sampleName === targetZone!.sampleLow) ||
                  (r.lowKey === targetZone!.lowKey && r.highKey === targetZone!.highKey)
              )
            : undefined)
      : (regionId ? extRegions.find((r) => r.id === regionId) ?? null : null);

  if (!activeReg && !isClassic && extRegions.length > 0) {
    activeReg = extRegions[0];
  }
  if (!targetZone) {
    if (activeReg) {
      targetZone = ctx.state.session.zones.find(
        (z) =>
          activeReg!.id.includes(z.id) ||
          (activeReg!.sampleName && (z.sampleLow === activeReg!.sampleName || z.sampleHigh === activeReg!.sampleName)) ||
          (activeReg!.lowKey === z.lowKey && activeReg!.highKey === z.highKey)
      );
    }
    if (!targetZone) {
      targetZone = ctx.state.session.zones[0];
    }
  }

  if (!targetZone && !activeReg) return null;

  const sampleName =
    (isClassic
      ? (targetZone?.sampleLow || targetZone?.sampleHigh)
      : (activeReg?.sampleName || targetZone?.sampleLow || targetZone?.sampleHigh)) || undefined;

  const rootKey =
    (isClassic ? targetZone?.rootKey : (activeReg?.rootKey ?? targetZone?.rootKey)) ?? 60;

  let raw: ArrayBuffer | undefined = lookupSampleBuffer(ctx, sampleName);
  let effectiveSampleName = sampleName;

  if (!raw) {
    const demoKey = `__demo_${(activeReg?.id ?? targetZone?.id ?? 'zone').replace(/[^a-zA-Z0-9_-]/g, '_')}_k${rootKey}.wav`;
    raw = ctx.state.sampleBuffers.get(demoKey);
    if (!raw) {
      raw = synthesizeDemoWav('strings', rootKey, 44100, 1.0);
      ctx.state.sampleBuffers.set(demoKey, raw);
    }
    effectiveSampleName = demoKey;
  }

  let decoded: DecodedWav;
  try {
    decoded = decodeWav(raw);
  } catch {
    raw = synthesizeDemoWav('strings', rootKey, 44100, 1.0);
    decoded = decodeWav(raw);
  }

  const totalFrames = Math.max(1, decoded.numSamples);
  const defaultLoopStart =
    decoded.instrument?.loopStart ?? Math.floor(totalFrames * 0.2);
  const defaultLoopEnd =
    decoded.instrument?.loopEnd && decoded.instrument.loopEnd > defaultLoopStart
      ? decoded.instrument.loopEnd
      : Math.floor(totalFrames * 0.85);

  const commonMode = ctx.state.session.processConfig.commonPlayback?.loopMode;
  const loopMode = activeReg?.hasPlaybackOverride
    ? (activeReg.loopMode ?? 'no_loop')
    : (commonMode && commonMode !== 'no_loop' ? commonMode : (activeReg?.loopMode ?? 'no_loop'));
  const loopStart =
    activeReg && activeReg.loopEnd > activeReg.loopStart
      ? clamp(activeReg.loopStart, 0, Math.max(0, totalFrames - 2))
      : clamp(defaultLoopStart, 0, Math.max(0, totalFrames - 2));
  const loopEnd =
    activeReg && activeReg.loopEnd > activeReg.loopStart
      ? clamp(activeReg.loopEnd, loopStart + 1, totalFrames)
      : clamp(defaultLoopEnd, loopStart + 1, totalFrames);
  const loopCrossfadeMs = activeReg?.loopCrossfadeMs ?? 15;
  const hasExplicitLoopPoints = Boolean(
    (activeReg && activeReg.loopEnd > activeReg.loopStart) ||
      (decoded.instrument?.loopEnd &&
        decoded.instrument.loopEnd > (decoded.instrument.loopStart ?? 0))
  );

  return {
    zoneId: targetZone?.id ?? 'zone-1',
    regionId: activeReg?.id,
    hasExplicitLoopPoints,
    sampleName: effectiveSampleName ?? 'Demo_Sample.wav',
    sampleRate: decoded.sampleRate,
    bitsPerSample: decoded.bitsPerSample,
    byteSize: raw?.byteLength ?? 0,
    numChannels: decoded.numChannels,
    totalFrames,
    durationSec: decoded.durationSec,
    monoPcm: decoded.mono,
    loopMode,
    loopStart,
    loopEnd,
    loopCrossfadeMs,
    rootKey,
  };
}

export async function playLoopEditorData(ctx: PipelineContext, data: ZoneLoopEditorData, opts: { loopStartFrame?: number; loopEndFrame?: number; loopEnabled: boolean; loopMode: LoopMode; startFromLoopStart: boolean; volumeDb?: number; pan?: number; detuneCents?: number; ampEnv?: DahdsrEnvelope; }): Promise<void> {
  if (!ctx.state.session) return;
  let { volumeDb, pan, detuneCents, ampEnv } = opts;

  // Use the ids actually resolved by getZoneLoopEditorData (never the UI selection)
  const reg = data.regionId
    ? ctx.state.session.extendedRegions?.find((r) => r.id === data.regionId)
    : undefined;
  if (reg) {
    if (volumeDb === undefined) volumeDb = reg.volume;
    if (pan === undefined) pan = reg.pan;
    if (detuneCents === undefined) detuneCents = reg.detune;
    if (ampEnv === undefined) {
      const globalEnv = ctx.state.session.articulation?.ampEnv;
      if (reg.hasArticulationOverride && reg.ampEnvOverride && globalEnv) {
        ampEnv = { ...globalEnv, ...reg.ampEnvOverride };
      } else if (globalEnv && ctx.state.session.articulation?.ampEnvEnabled !== false) {
        ampEnv = globalEnv;
      }
    }
  } else {
    const zone = ctx.state.session.zones.find((z) => z.id === data.zoneId);
    if (zone) {
      if (volumeDb === undefined) volumeDb = zone.volume;
      if (pan === undefined) pan = zone.pan;
      if (detuneCents === undefined) detuneCents = zone.detune;
      if (ampEnv === undefined && ctx.state.session.articulation?.ampEnv && ctx.state.session.articulation.ampEnvEnabled) {
        ampEnv = ctx.state.session.articulation.ampEnv;
      }
    }
  }

  const startFrame =
    opts.loopStartFrame !== undefined && opts.loopStartFrame >= 0
      ? opts.loopStartFrame
      : data.loopStart;
  const endFrame =
    opts.loopEndFrame !== undefined && opts.loopEndFrame > startFrame
      ? opts.loopEndFrame
      : data.loopEnd;

  await ctx.state.preview.auditionLoopSample({
    sampleName: data.sampleName,
    rootKey: data.rootKey,
    loopStartFrame: startFrame,
    loopEndFrame: endFrame,
    loopEnabled: opts.loopEnabled,
    loopMode: opts.loopMode,
    loopCrossfadeMs: data.loopCrossfadeMs,
    volumeDb,
    pan,
    detuneCents,
    ampEnv,
    startFromLoopStart: opts.startFromLoopStart,
  });
}

export async function auditionLoop(ctx: PipelineContext, zoneId: string, opts?: { regionId?: string; loopStartFrame?: number; loopEndFrame?: number; loopEnabled?: boolean; volumeDb?: number; pan?: number; detuneCents?: number; ampEnv?: DahdsrEnvelope; }): Promise<void> {
  const data = getZoneLoopEditorData(ctx, zoneId, opts?.regionId);
  if (!data) return;
  const loopEnabled = opts?.loopEnabled !== false;
  const isLoopingMode = data.loopMode !== 'no_loop' && data.loopMode !== 'one_shot';
  await playLoopEditorData(ctx, data, {
    ...opts,
    loopEnabled,
    loopMode: loopEnabled && !isLoopingMode ? 'loop_continuous' : data.loopMode,
    startFromLoopStart: loopEnabled,
  });
}

export async function auditionRow(ctx: PipelineContext, opts: { zoneId?: string; regionId?: string; }): Promise<void> {
  const data = getZoneLoopEditorData(ctx, opts.zoneId, opts.regionId);
  if (!data) return;
  const isLoopingMode = data.loopMode !== 'no_loop' && data.loopMode !== 'one_shot';
  const loopEnabled = isLoopingMode && Boolean(data.hasExplicitLoopPoints);
  await playLoopEditorData(ctx, data, {
    loopEnabled,
    loopMode: loopEnabled ? data.loopMode : 'no_loop',
    startFromLoopStart: false,
  });
}

export function updateLiveLoopPoints(ctx: PipelineContext, loopStartFrame: number, loopEndFrame: number, sampleRate: number, loopEnabled: boolean = true): void {
  ctx.state.preview.updateLiveLoopPoints(
    loopStartFrame,
    loopEndFrame,
    sampleRate,
    loopEnabled
  );
}

export async function auditionSample(ctx: PipelineContext, samplePath: string, rootKey: MidiNote = 60): Promise<void> {
  return ctx.state.preview.auditionSample(samplePath, rootKey);
}

export async function auditionZoneComparison(ctx: PipelineContext, zoneId: string, mode: 'original' | 'resynthesis' | 'enhanced' | 'resynator_v2', targetNote?: MidiNote, sampleOverride?: { sampleName: string; rootKey: MidiNote }): Promise<void> {
  return ctx.state.preview.auditionZoneComparison(zoneId, mode, targetNote, sampleOverride);
}

export function stopAudition(ctx: PipelineContext): void {
  ctx.state.preview.stopAudition();
}

export function getRealtimeSpectrum(ctx: PipelineContext): {
    bins: Uint8Array;
    rmsDb: number;
    isPlaying: boolean;
    mode: 'original' | 'resynthesis' | 'enhanced' | 'resynator_v2' | null;
  } {
  return ctx.state.preview.getRealtimeSpectrum();
}
