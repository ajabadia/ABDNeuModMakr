// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Deterministic Slicing from MidiAutoSampleManifest (Fase 37.6)
// ─────────────────────────────────────────────────────────

import { clamp } from '../DspMath.ts';
import { snapFrameToNearestZeroCrossing } from '../LoopEditorTools.ts';
import { detectPitchYinMpm } from '../AcousticIntelligence.ts';
import { midiToNoteName } from '../../../ui/ZoneRibbon.ts';
import { classifyDrumSlice, buildMidiFileBuffer } from './SlicerDrumAndMidi.ts';
import type { DetectedSlice, SlicerResult, MidiManifestSliceBuildOptions } from './SlicerTypes.ts';

/**
 * Cuts a continuous recording deterministically using the exact `noteOnFrame`,
 * `noteOffFrame`, and `tailEndFrame` markers recorded in a `MidiAutoSampleManifest`.
 */
export function buildSlicesFromMidiManifest(
  pcm: Float32Array,
  sampleRate: number,
  manifest: {
    mode?: string;
    latencySamples?: number;
    events: Array<{
      index: number;
      status?: string;
      midiNote: number;
      velocity: number;
      velocityLayerIndex?: number;
      roundRobinIndex?: number;
      customName?: string;
      muteGroup?: number;
      lowKey: number;
      highKey: number;
      lowVel: number;
      highVel: number;
      noteOnFrame: number;
      noteOffFrame: number;
      tailEndFrame: number;
      loopStartFrame?: number;
      loopEndFrame?: number;
    }>;
  },
  options: MidiManifestSliceBuildOptions = {}
): SlicerResult {
  const sr = Math.max(1, sampleRate);
  const totalFrames = pcm.length;
  const totalDurationSec = totalFrames / sr;
  const snapZc = options.snapZeroCrossing !== false;
  const trimTrail = options.trimTrailingSilence !== false;
  const silenceLinear = Math.pow(10, (options.silenceThresholdDb ?? -60) / 20);
  const manifestLatencyFrames = Math.max(0, Math.round(manifest.latencySamples ?? 0));
  const extraOffsetFrames = Math.round(((options.extraLatencyOffsetMs ?? 0) / 1000) * sr);
  const totalOffsetFrames = manifestLatencyFrames + extraOffsetFrames;

  const slices: DetectedSlice[] = [];
  const recordedEvents = manifest.events.filter(
    (ev) => !ev.status || ev.status === 'recorded'
  );

  for (let i = 0; i < recordedEvents.length; i++) {
    const ev = recordedEvents[i];
    let startFrame = clamp(
      Math.round(ev.noteOnFrame + totalOffsetFrames),
      0,
      Math.max(0, totalFrames - 64)
    );
    let endFrame = clamp(
      Math.round(ev.tailEndFrame + totalOffsetFrames),
      startFrame + 64,
      totalFrames
    );

    if (snapZc) {
      startFrame = snapFrameToNearestZeroCrossing(pcm, startFrame, 128);
      endFrame = snapFrameToNearestZeroCrossing(pcm, endFrame, 128);
      if (endFrame <= startFrame + 32) {
        endFrame = Math.min(totalFrames, startFrame + 64);
      }
    }

    // Fine trailing silence trim (refines block-granularity tailEndFrame)
    if (trimTrail && endFrame - startFrame > 256) {
      const minKeepFrame = Math.min(
        endFrame,
        Math.max(startFrame + 128, Math.round(ev.noteOffFrame + totalOffsetFrames))
      );
      let trimmedEnd = endFrame;
      const win = 32;
      while (trimmedEnd - win > minKeepFrame) {
        let localPeak = 0;
        for (let k = trimmedEnd - win; k < trimmedEnd; k++) {
          const a = Math.abs(pcm[k]);
          if (a > localPeak) localPeak = a;
        }
        if (localPeak <= silenceLinear) {
          trimmedEnd -= win;
        } else {
          break;
        }
      }
      if (snapZc && trimmedEnd < endFrame) {
        trimmedEnd = snapFrameToNearestZeroCrossing(pcm, trimmedEnd, 64);
      }
      endFrame = clamp(trimmedEnd, startFrame + 64, totalFrames);
    }

    const slicePcm = new Float32Array(pcm.subarray(startFrame, endFrame));
    const fadeFrames = Math.min(Math.floor(slicePcm.length / 2), Math.round(0.001 * sr));
    for (let f = 0; f < fadeFrames; f++) {
      const gIn = f / fadeFrames;
      const gOut = (fadeFrames - 1 - f) / fadeFrames;
      slicePcm[f] *= gIn;
      slicePcm[slicePcm.length - 1 - f] *= gOut;
    }

    let sumSq = 0;
    let peak = 0;
    for (let k = 0; k < slicePcm.length; k++) {
      const a = Math.abs(slicePcm[k]);
      if (a > peak) peak = a;
      sumSq += a * a;
    }
    const rms = Math.sqrt(sumSq / Math.max(1, slicePcm.length));
    const rmsDb = 20 * Math.log10(rms + 1e-9);
    const peakDb = 20 * Math.log10(peak + 1e-9);

    const noteOffOffsetFrame = clamp(
      Math.round(ev.noteOffFrame + totalOffsetFrames) - startFrame,
      64,
      slicePcm.length
    );

    // Optional analog oscillator pitch & detune verification on sustained region (khiner/AutoSampler insight)
    let f0Hz: number | undefined;
    let detuneCents = 0;
    const isDrumMode = manifest.mode === 'drum_map' || Boolean(ev.customName);

    if (!isDrumMode && slicePcm.length >= 512) {
      const sustainSub = slicePcm.subarray(
        Math.min(slicePcm.length - 256, Math.floor(noteOffOffsetFrame * 0.15)),
        Math.max(256, Math.floor(noteOffOffsetFrame * 0.9))
      );
      const pitch = detectPitchYinMpm(sustainSub.length >= 512 ? sustainSub : slicePcm, sr);
      if (pitch.f0Hz > 20 && pitch.harmonicity >= 0.45) {
        f0Hz = Math.round(pitch.f0Hz * 10) / 10;
        if (options.autoCompensateAnalogDetune) {
          const targetHz = 440 * Math.pow(2, (ev.midiNote - 69) / 12);
          const rawCents = Math.round(1200 * Math.log2(pitch.f0Hz / targetHz));
          if (Math.abs(rawCents) <= 50) {
            detuneCents = -rawCents; // Compensate drift back to 12-TET
          }
        }
      }
    }

    let label = ev.customName
      ? `${ev.customName} (${midiToNoteName(ev.midiNote)} v${ev.velocity})`
      : `${midiToNoteName(ev.midiNote)} (${ev.midiNote}) • v${ev.velocity}`;
    let category = isDrumMode ? 'percussion' : 'chromatic';
    let muteGroup = ev.muteGroup;

    if (
      isDrumMode &&
      !ev.customName &&
      options.autoClassifyUnnamedDrumHits !== false &&
      slicePcm.length >= 128
    ) {
      const drumClass = classifyDrumSlice(slicePcm, sr);
      category = drumClass.category;
      label = `${drumClass.label} [v${ev.velocity}]`;
      if (drumClass.category === 'hihat' && muteGroup === undefined) {
        muteGroup = 1;
      }
    }

    slices.push({
      id: `slice_midi_${i + 1}`,
      index: i + 1,
      startFrame,
      endFrame,
      startSec: startFrame / sr,
      endSec: endFrame / sr,
      durationSec: (endFrame - startFrame) / sr,
      rmsDb,
      peakDb,
      isSilence: false,
      ...(f0Hz !== undefined ? { f0Hz } : {}),
      rootKey: clamp(ev.midiNote, 0, 127),
      lowKey: clamp(ev.lowKey, 0, 127),
      highKey: clamp(ev.highKey, 0, 127),
      lowVel: clamp(ev.lowVel, 1, 127),
      highVel: clamp(ev.highVel, 1, 127),
      label,
      category,
      pcm: slicePcm,
      noteOffOffsetFrame,
      ...(ev.loopStartFrame !== undefined ? { loopStartFrame: ev.loopStartFrame } : {}),
      ...(ev.loopEndFrame !== undefined ? { loopEndFrame: ev.loopEndFrame } : {}),
      ...(detuneCents !== 0 ? { detuneCents } : {}),
      ...(muteGroup !== undefined ? { muteGroup } : {}),
      ...(ev.roundRobinIndex !== undefined ? { roundRobinIndex: ev.roundRobinIndex } : {}),
    });
  }

  const midiBuffer = buildMidiFileBuffer(slices, 120);

  return {
    slices,
    totalSlices: slices.length,
    validSlicesCount: slices.length,
    silenceSlicesCount: 0,
    detectedBpm: 120,
    sampleRate: sr,
    totalDurationSec,
    midiFileBuffer: midiBuffer,
  };
}
