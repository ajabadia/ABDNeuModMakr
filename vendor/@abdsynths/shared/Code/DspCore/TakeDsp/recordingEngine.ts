/**
 * @abdsynths/shared — Code/DspCore/TakeDsp/recordingEngine.ts
 * =========================================================================
 * Portable recording core (zero dependencies, no DOM, no platform audio
 * APIs). Owns the recorder state machine, take assembly, metering and
 * finalization (trim + peak + noise profile + optional classification +
 * 16-bit WAV encoding) by reusing `takeDsp.ts`.
 *
 * Platform capture stays OUTSIDE: the host app (or ABDAudioLab WebUI)
 * implements the thin `AudioInputSource` adapter (getUserMedia / JUCE /
 * AudioWorklet…) and feeds raw chunks with `pushSamples()`. Same provider
 * pattern as `WebNeuralEngine` (portable core + injected provider).
 *
 * Transport actions mirror the `TransportBinding` contract
 * (`Contracts/recordingSession.ts`): 'record' | 'stop' | 'pause' |
 * 'play' | 'togglePlay'. 'ff' / 'rw' are playback-only and report `false`
 * (this engine is capture, not playback — honest boundary).
 */

import {
  peakAmplitude,
  detectSilenceRanges,
  trimSilence,
  computeNoiseProfile,
  classifyTake,
  extractTakeFeatures,
} from './takeDsp.ts';
import type { TakeNoiseProfile } from '../../../Contracts/recordingSession.ts';

/** Recorder lifecycle. `stopped` is transient: `stopRecording()` finalizes
 *  the take and returns to `monitoring` (source still open). */
export type RecorderState =
  | 'idle'
  | 'monitoring'
  | 'recording'
  | 'paused'
  | 'stopped';

/**
 * Thin platform adapter implemented by each host. The engine never touches
 * `getUserMedia`, `AudioContext` or MIDI itself — it only consumes chunks.
 */
export interface AudioInputSource {
  readonly sampleRate: number;
  readonly channels: number;
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
}

/** Acoustic hints for `classifyTake()`; when omitted the take stays 'unknown'. */
export interface TakeDescriptors {
  harmonicity01: number;
  transientDensity01: number;
  f0Confidence01: number;
  spectralFlatness01: number;
}

export interface RecordingEngineOptions {
  /** Trim leading/trailing silence on finalize (uses `trimSilence`). */
  trimSilence?: boolean;
  /** Minimum silence to cut, in ms. */
  minSilenceMs?: number;
  /** Attach a `TakeNoiseProfile` computed from the leading silence (or the
   *  head of the take when there is none). */
  attachNoiseProfile?: boolean;
  /** Log-scale spectrum bands for the noise profile. */
  noiseBands?: number;
  /** Optional descriptors for take classification at stop time. */
  descriptors?: TakeDescriptors;
  /** Automatically extract acoustic descriptors and classify the take when `descriptors` is omitted. */
  autoClassify?: boolean;
}

export interface FinalizedTake {
  durationSec: number;
  sampleRate: number;
  channels: number;
  peakDbfs: number;
  classification: 'chromatic' | 'drums' | 'unknown';
  classificationConfidence: number;
  noiseProfile?: TakeNoiseProfile;
  /** Per-channel samples (post-trim). */
  samples: Float32Array[];
  /** 16-bit PCM WAV bytes of `samples`. */
  wav: Uint8Array;
}

export interface MeterLevels {
  peakLeft: number;
  peakRight: number;
  peakDbfs: number;
}

const DEFAULT_OPTIONS: Required<Omit<RecordingEngineOptions, 'descriptors'>> & {
  descriptors?: TakeDescriptors;
} = {
  trimSilence: true,
  minSilenceMs: 120,
  attachNoiseProfile: true,
  noiseBands: 8,
  descriptors: undefined,
  autoClassify: false,
};

function toDbfs(linearPeak: number): number {
  return linearPeak <= 0 ? -Infinity : 20 * Math.log10(linearPeak);
}

/**
 * Encodes deinterleaved per-channel float samples as 16-bit PCM WAV
 * (pure function, no platform APIs).
 */
export function encodeWav16(
  channels: Float32Array[],
  sampleRate: number
): Uint8Array {
  const numChannels = channels.length;
  const frames = channels[0]?.length ?? 0;
  const dataBytes = frames * numChannels * 2;
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const writeAscii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) out[offset + i] = text.charCodeAt(i);
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, Math.max(1, Math.round(sampleRate)), true);
  view.setUint32(28, Math.max(1, Math.round(sampleRate)) * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);
  let o = 44;
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < numChannels; c++) {
      const v = Math.max(-1, Math.min(1, channels[c][f] ?? 0));
      view.setInt16(o, Math.round(v * 32767), true);
      o += 2;
    }
  }
  return out;
}

export class RecordingEngine {
  private readonly source: AudioInputSource;
  private readonly options: typeof DEFAULT_OPTIONS;
  private state: RecorderState = 'idle';
  private takeBuffers: Float32Array[][] = [];
  private recordedFrames = 0;
  private meterPeakLeft = 0;
  private meterPeakRight = 0;

  constructor(source: AudioInputSource, options: RecordingEngineOptions = {}) {
    if (!source || source.sampleRate <= 0 || source.channels < 1) {
      throw new Error('RecordingEngine needs a source with sampleRate > 0 and channels >= 1.');
    }
    this.source = source;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  getState(): RecorderState {
    return this.state;
  }

  getRecordedFrames(): number {
    return this.recordedFrames;
  }

  getRecordedSec(): number {
    return this.recordedFrames / this.source.sampleRate;
  }

  getLevels(): MeterLevels {
    const peak = Math.max(this.meterPeakLeft, this.meterPeakRight);
    return { peakLeft: this.meterPeakLeft, peakRight: this.meterPeakRight, peakDbfs: toDbfs(peak) };
  }

  /** Opens the source and enters `monitoring` (meters live, nothing stored). */
  async beginMonitoring(): Promise<void> {
    this.requireState(['idle'], 'beginMonitoring');
    await this.source.start();
    this.resetMeter();
    this.state = 'monitoring';
  }

  /** `monitoring`/`paused` → `recording`. Starts a fresh take (discards any paused one — use `resumeRecording()` to keep it). */
  startRecording(): void {
    this.requireState(['monitoring', 'paused'], 'startRecording');
    this.takeBuffers = [];
    this.recordedFrames = 0;
    this.resetMeter();
    this.state = 'recording';
  }

  /** `recording` → `paused`. Chunks pushed while paused update meters but are not stored. */
  pauseRecording(): void {
    this.requireState(['recording'], 'pauseRecording');
    this.state = 'paused';
  }

  /** `paused` → `recording`, keeping the stored chunks. */
  resumeRecording(): void {
    this.requireState(['paused'], 'resumeRecording');
    this.state = 'recording';
  }

  /**
   * Feeds one block of deinterleaved samples. Mono hosts pass a single
   * channel; stereo hosts pass `[left, right]`. Extra channels are ignored,
   * missing ones are treated as silence.
   */
  pushSamples(channelData: Float32Array[]): void {
    if (this.state !== 'recording' && this.state !== 'paused' && this.state !== 'monitoring') return;
    const n = this.source.channels;
    const frames = channelData[0]?.length ?? 0;
    if (frames === 0) return;
    const left = channelData[0] ?? new Float32Array(frames);
    const right = n > 1 ? channelData[1] ?? new Float32Array(frames) : left;
    const blockLeft = peakAmplitude(left);
    const blockRight = peakAmplitude(right);
    // Smooth ballistic decay (~21 ms block -> ~200 ms VU release) so live meters drop when signal ceases
    this.meterPeakLeft = Math.max(blockLeft, this.meterPeakLeft * 0.85);
    this.meterPeakRight = Math.max(blockRight, this.meterPeakRight * 0.85);
    if (this.state !== 'recording') return;
    const stored: Float32Array[] = [];
    for (let c = 0; c < n; c++) {
      stored.push(Float32Array.from(channelData[c] ?? new Float32Array(frames)));
    }
    this.takeBuffers.push(stored);
    this.recordedFrames += frames;
  }

  /**
   * Finalizes the take (`recording`/`paused` → `monitoring`): concatenates,
   * optionally trims silence, measures peak, attaches the noise profile and
   * classification, and encodes the WAV. The source stays open for the next take.
   */
  stopRecording(): FinalizedTake {
    this.requireState(['recording', 'paused'], 'stopRecording');
    const sr = this.source.sampleRate;
    const n = this.source.channels;
    const channels: Float32Array[] = [];
    for (let c = 0; c < n; c++) {
      const out = new Float32Array(this.recordedFrames);
      let o = 0;
      for (const block of this.takeBuffers) {
        out.set(block[c], o);
        o += block[c].length;
      }
      channels.push(out);
    }

    let peak = 0;
    for (const ch of channels) peak = Math.max(peak, peakAmplitude(ch));

    // Build mono mix once for silence detection, noise profiling, and acoustic feature extraction
    const mix = new Float32Array(channels[0].length);
    if (channels[0].length > 0) {
      for (const ch of channels) {
        for (let i = 0; i < mix.length; i++) mix[i] += ch[i] / n;
      }
    }

    let noiseProfile: TakeNoiseProfile | undefined;
    if (this.options.attachNoiseProfile && channels[0].length > 0) {
      const silentRanges = detectSilenceRanges(mix, sr, {
        minSilenceMs: Math.min(80, this.options.minSilenceMs),
      });
      if (silentRanges.length > 0) {
        // Pick the longest silent/room-tone segment for accurate noise print
        const bestSilence = silentRanges.reduce((best, r) =>
          r.endFrame - r.startFrame > best.endFrame - best.startFrame ? r : best
        );
        const slice = channels[0].subarray(
          bestSilence.startFrame,
          Math.max(bestSilence.startFrame + 1, bestSilence.endFrame)
        );
        noiseProfile = computeNoiseProfile(slice, sr, this.options.noiseBands);
      } else {
        const headFrames = Math.min(channels[0].length, Math.round(sr * 0.5));
        noiseProfile = computeNoiseProfile(
          channels[0].slice(0, Math.max(1, headFrames)),
          sr,
          this.options.noiseBands
        );
      }
    }

    let finalChannels = channels;
    let finalMix = mix;
    if (this.options.trimSilence && channels[0].length > 0) {
      const { leadingMs, trailingMs } = trimSilence(mix, sr, {
        minSilenceMs: this.options.minSilenceMs,
      });
      const lead = Math.min(channels[0].length, Math.round((leadingMs / 1000) * sr));
      const trail = Math.min(
        channels[0].length - lead,
        Math.round((trailingMs / 1000) * sr)
      );
      const end = channels[0].length - trail;
      if (end > lead) {
        finalChannels = channels.map((ch) => ch.slice(lead, end));
        finalMix = mix.subarray(lead, end);
      }
    }

    const desc =
      this.options.descriptors ??
      (this.options.autoClassify && finalMix.length > 0
        ? extractTakeFeatures(finalMix, sr)
        : undefined);
    const classified = desc
      ? classifyTake(desc)
      : { kind: 'unknown' as const, confidence: 0 };

    const take: FinalizedTake = {
      durationSec: finalChannels[0].length / sr,
      sampleRate: sr,
      channels: n,
      peakDbfs: toDbfs(peak),
      classification: classified.kind,
      classificationConfidence: classified.confidence,
      ...(noiseProfile ? { noiseProfile } : {}),
      samples: finalChannels,
      wav: encodeWav16(finalChannels, sr),
    };
    this.takeBuffers = [];
    this.recordedFrames = 0;
    this.state = 'monitoring';
    return take;
  }

  /** Discards the current take (`recording`/`paused` → `monitoring`). */
  cancelTake(): void {
    this.requireState(['recording', 'paused'], 'cancelTake');
    this.takeBuffers = [];
    this.recordedFrames = 0;
    this.state = 'monitoring';
  }

  /** Closes the source (`monitoring` → `idle`). */
  async close(): Promise<void> {
    this.requireState(['monitoring', 'idle'], 'close');
    if (this.state === 'monitoring') await this.source.stop();
    this.state = 'idle';
  }

  /**
   * Maps a `TransportBinding` action onto the engine. Returns `true` when the
   * action was consumed. 'ff' / 'rw' / unknown actions return `false`
   * (playback-only: this engine is capture).
   */
  handleTransportAction(action: string): boolean {
    switch (action) {
      case 'record':
        if (this.state === 'monitoring' || this.state === 'paused') {
          this.startRecording();
          return true;
        }
        return false;
      case 'stop':
        if (this.state === 'recording' || this.state === 'paused') {
          this.stopRecording();
          return true;
        }
        return false;
      case 'pause':
        if (this.state === 'recording') {
          this.pauseRecording();
          return true;
        }
        return false;
      case 'play':
      case 'togglePlay':
        if (this.state === 'paused') {
          this.resumeRecording();
          return true;
        }
        return false;
      default:
        return false;
    }
  }

  private requireState(allowed: RecorderState[], op: string): void {
    if (!allowed.includes(this.state)) {
      throw new Error(
        `RecordingEngine.${op}() illegal from state '${this.state}' (allowed: ${allowed.join(', ')}).`
      );
    }
  }

  private resetMeter(): void {
    this.meterPeakLeft = 0;
    this.meterPeakRight = 0;
  }
}
