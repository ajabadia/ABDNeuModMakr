// ─────────────────────────────────────────────────────────
// AudioPreviewService — Web Audio auditioning for samples and
// zone A/B comparison (original vs neural resynthesis).
// Extracted verbatim from WebAudioPipeline (P1.1 follow-up).
// All musical/document state (zones, sample buffers, resynth
// cache) arrives through PreviewSources so this module owns
// only live WebAudio nodes, never the session.
// ─────────────────────────────────────────────────────────

import { decodeWav, synthesizeDemoWav } from './dsp/WavDecoder.ts';
import { clamp, linearToDb } from './dsp/DspMath.ts';
import { DEFAULT_SAMPLE_NAME, parseRootKeyFromFilename } from './sampleNaming.ts';
import { applyLoopCrossfade, generatePingPongLoopBuffer } from './dsp/LoopEditorTools.ts';
import type { DahdsrEnvelope, LoopMode, MidiNote, Zone } from './types.ts';

export type PreviewPlaybackMode = 'original' | 'resynthesis' | 'enhanced';

export interface PreviewSources {
  getZone(zoneId: string): Zone | undefined;
  getFirstZone(): Zone | undefined;
  getSampleBuffer(name: string): ArrayBuffer | undefined;
  setSampleBuffer(name: string, buffer: ArrayBuffer): void;
  /** Resynthesized mono PCM for the zone (Legacy DSP), if already inspected. */
  getResynthMono(zoneId: string): Float32Array | undefined;
  /** Enhanced DSP resynthesized mono PCM for the zone, if already inspected. */
  getEnhancedMono?(zoneId: string): Float32Array | undefined;
  /** Ensure the zone has been spectrally inspected (populates resynth). */
  ensureSpectrum(zoneId: string): void;
}

export class AudioPreviewService {
  private readonly sources: PreviewSources;
  private audioCtx: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private activeSourceNode: AudioBufferSourceNode | null = null;
  private activeGainNode: GainNode | null = null;
  private activePlaybackMode: PreviewPlaybackMode | null = null;

  constructor(sources: PreviewSources) {
    this.sources = sources;
  }

  public async auditionSample(
    samplePath: string,
    rootKey: MidiNote = 60
  ): Promise<void> {
    if (typeof window === 'undefined' || typeof AudioContext === 'undefined') {
      return;
    }

    this.ensureAudioContext();
    if (!this.audioCtx || !this.analyserNode) return;
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }

    this.stopAudition();

    let raw = this.sources.getSampleBuffer(samplePath);
    if (!raw) {
      const parsedKey = parseRootKeyFromFilename(samplePath, rootKey);
      raw = synthesizeDemoWav('strings', parsedKey, 44100, 1.0);
      this.sources.setSampleBuffer(samplePath, raw);
    }

    const decoded = decodeWav(raw);
    const audioBuffer = this.audioCtx.createBuffer(
      decoded.numChannels,
      decoded.numSamples,
      decoded.sampleRate
    );
    for (let ch = 0; ch < decoded.numChannels; ch++) {
      audioBuffer.copyToChannel(
        new Float32Array(decoded.channels[ch]),
        ch
      );
    }

    const source = this.audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.analyserNode);
    source.onended = () => {
      if (this.activeSourceNode === source) {
        this.activeSourceNode = null;
        this.activePlaybackMode = null;
      }
    };
    this.activeSourceNode = source;
    this.activePlaybackMode = 'original';
    source.start();
  }

  /**
   * Plays either the Original sample ('original'), Legacy Scape/Sphere resynthesis ('resynthesis'),
   * or Phase 7 Enhanced DSP resynthesis ('enhanced') for `zoneId`, optionally pitch-shifted to `targetNote`.
   */
  public async auditionZoneComparison(
    zoneId: string,
    mode: PreviewPlaybackMode,
    targetNote?: MidiNote
  ): Promise<void> {
    if (typeof window === 'undefined' || typeof AudioContext === 'undefined') {
      return;
    }
    const zone = this.sources.getZone(zoneId) ?? this.sources.getFirstZone();
    if (!zone) return;

    this.ensureAudioContext();
    if (!this.audioCtx || !this.analyserNode) return;
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }

    this.stopAudition();

    if ((mode === 'resynthesis' || mode === 'enhanced') && !this.sources.getResynthMono(zone.id)) {
      this.sources.ensureSpectrum(zone.id);
    }
    const resynthMono =
      mode === 'enhanced'
        ? (this.sources.getEnhancedMono?.(zone.id) ?? this.sources.getResynthMono(zone.id))
        : this.sources.getResynthMono(zone.id);

    const semitoneShift =
      targetNote !== undefined
        ? targetNote - zone.rootKey + (zone.detune || 0) / 100
        : (zone.detune || 0) / 100;
    const playbackRate = Math.pow(2.0, semitoneShift / 12.0);
    const linearGain = Math.pow(10.0, (zone.volume || 0) / 20.0);

    let audioBuffer: AudioBuffer;
    if ((mode === 'resynthesis' || mode === 'enhanced') && resynthMono) {
      const mono = resynthMono;
      audioBuffer = this.audioCtx.createBuffer(1, mono.length, 44100);
      audioBuffer.copyToChannel(new Float32Array(mono), 0);
    } else {
      const sampleName = zone.sampleLow ?? DEFAULT_SAMPLE_NAME;
      const raw =
        this.sources.getSampleBuffer(sampleName) ??
        synthesizeDemoWav('strings', zone.rootKey, 44100, 1.0);
      const decoded = decodeWav(raw);
      audioBuffer = this.audioCtx.createBuffer(
        decoded.numChannels,
        decoded.numSamples,
        decoded.sampleRate
      );
      for (let ch = 0; ch < decoded.numChannels; ch++) {
        audioBuffer.copyToChannel(new Float32Array(decoded.channels[ch]), ch);
      }
    }

    const source = this.audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.playbackRate.value = clamp(playbackRate, 0.125, 8.0);

    const gainNode = this.audioCtx.createGain();
    gainNode.gain.value = clamp(linearGain, 0.05, 4.0);

    source.connect(gainNode);
    gainNode.connect(this.analyserNode);

    source.onended = () => {
      if (this.activeSourceNode === source) {
        this.activeSourceNode = null;
        this.activePlaybackMode = null;
        if (this.activeGainNode === gainNode) {
          try {
            gainNode.disconnect();
          } catch {
            // Ignore if already disconnected
          }
          this.activeGainNode = null;
        }
      }
    };

    this.activeSourceNode = source;
    this.activeGainNode = gainNode;
    this.activePlaybackMode = mode;
    source.start();
  }

  /**
   * Fase 13 — Starts real-time looped auditioning for the Waveform Loop Editor.
   * Supports forward, ping-pong (bidirectional), and crossfade smoothing.
   */
  public async auditionLoopSample(opts: {
    sampleName: string;
    rootKey?: MidiNote;
    loopStartFrame: number;
    loopEndFrame: number;
    loopEnabled?: boolean;
    loopMode?: LoopMode;
    loopCrossfadeMs?: number;
    volumeDb?: number;
    pan?: number;
    detuneCents?: number;
    ampEnv?: DahdsrEnvelope;
  }): Promise<void> {
    if (typeof window === 'undefined' || typeof AudioContext === 'undefined') {
      return;
    }
    this.ensureAudioContext();
    if (!this.audioCtx || !this.analyserNode) return;
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }

    this.stopAudition();

    const samplePath = opts.sampleName || DEFAULT_SAMPLE_NAME;
    const rootKey = opts.rootKey ?? 60;
    let raw = this.sources.getSampleBuffer(samplePath);
    if (!raw) {
      const parsedKey = parseRootKeyFromFilename(samplePath, rootKey);
      raw = synthesizeDemoWav('strings', parsedKey, 44100, 1.0);
      this.sources.setSampleBuffer(samplePath, raw);
    }

    const decoded = decodeWav(raw);
    const sr = Math.max(1, decoded.sampleRate);
    const totalFrames = Math.max(2, decoded.numSamples);
    const effStartFrame =
      opts.loopStartFrame >= 0 && opts.loopStartFrame < totalFrames - 1
        ? opts.loopStartFrame
        : Math.floor(totalFrames * 0.2);
    const effEndFrame =
      opts.loopEndFrame > effStartFrame && opts.loopEndFrame <= totalFrames
        ? opts.loopEndFrame
        : Math.max(effStartFrame + 1, Math.floor(totalFrames * 0.85));

    const isPingPong = opts.loopMode === 'ping_pong';
    const xfadeFrames =
      opts.loopCrossfadeMs && opts.loopCrossfadeMs > 0
        ? Math.round((opts.loopCrossfadeMs / 1000) * sr)
        : 0;

    let processedChannels = decoded.channels;
    let actualStartFrame = effStartFrame;
    let actualEndFrame = effEndFrame;

    // Apply circular equal-power crossfade if configured
    if (xfadeFrames > 0 && !isPingPong) {
      processedChannels = decoded.channels.map((ch) =>
        applyLoopCrossfade(ch, effStartFrame, effEndFrame, xfadeFrames, 'equal-power')
      );
    }

    // Ping-Pong: unroll [start..end] + [end..start] alternating mirror
    if (isPingPong) {
      const p0 = generatePingPongLoopBuffer(decoded.channels[0], effStartFrame, effEndFrame);
      actualStartFrame = p0.loopStart;
      actualEndFrame = p0.loopEnd;
      if (decoded.numChannels === 1) {
        processedChannels = [p0.pcm];
      } else {
        processedChannels = decoded.channels.map(
          (ch) => generatePingPongLoopBuffer(ch, effStartFrame, effEndFrame).pcm
        );
      }
    }

    const outNumSamples = processedChannels[0].length;
    const audioBuffer = this.audioCtx.createBuffer(
      decoded.numChannels,
      outNumSamples,
      decoded.sampleRate
    );
    for (let ch = 0; ch < decoded.numChannels; ch++) {
      audioBuffer.copyToChannel(new Float32Array(processedChannels[ch]), ch);
    }

    const source = this.audioCtx.createBufferSource();
    source.buffer = audioBuffer;

    if (opts.detuneCents !== undefined && opts.detuneCents !== 0 && !isNaN(opts.detuneCents)) {
      source.detune.value = opts.detuneCents;
    }

    const totalDurSec = outNumSamples / sr;
    const startSec = clamp(actualStartFrame / sr, 0, Math.max(0, totalDurSec - 0.002));
    const endSec = clamp(actualEndFrame / sr, startSec + 0.002, totalDurSec);
    const loopOn =
      opts.loopEnabled !== false &&
      opts.loopMode !== 'no_loop' &&
      opts.loopMode !== 'one_shot' &&
      endSec > startSec;

    source.loop = loopOn;
    if (loopOn) {
      source.loopStart = startSec;
      source.loopEnd = endSec;
    }

    const volumeDb = typeof opts.volumeDb === 'number' ? opts.volumeDb : 0;
    const targetLinearGain = clamp(Math.pow(10.0, volumeDb / 20.0), 0.0001, 4.0);

    const gainNode = this.audioCtx.createGain();
    const now = this.audioCtx.currentTime;

    if (opts.ampEnv) {
      const env = opts.ampEnv;
      const dSec = Math.max(0, env.delaySec || 0);
      const aSec = Math.max(0.002, env.attackSec || 0.005);
      const hSec = Math.max(0, env.holdSec || 0);
      const decSec = Math.max(0.002, env.decaySec || 0.01);
      const susLvl = clamp(typeof env.sustainLevel === 'number' ? env.sustainLevel : 1.0, 0, 1);
      const susGain = clamp(targetLinearGain * susLvl, 0.00001, 4.0);

      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.setValueAtTime(0.00001, now);

      const tAttackStart = now + dSec;
      if (dSec > 0.001) {
        gainNode.gain.setValueAtTime(0.00001, tAttackStart);
      }
      const tHoldStart = tAttackStart + aSec;
      gainNode.gain.linearRampToValueAtTime(targetLinearGain, tHoldStart);

      const tDecayStart = tHoldStart + hSec;
      if (hSec > 0.001) {
        gainNode.gain.setValueAtTime(targetLinearGain, tDecayStart);
      }
      const tSustainStart = tDecayStart + decSec;
      gainNode.gain.linearRampToValueAtTime(susGain, tSustainStart);

      if (!loopOn) {
        const totalSampleDur = outNumSamples / sr;
        const relSec = Math.max(0.02, env.releaseSec || 0.05);
        const tReleaseStart = Math.max(tSustainStart, now + Math.max(0, totalSampleDur - relSec));
        gainNode.gain.setValueAtTime(susGain, tReleaseStart);
        gainNode.gain.linearRampToValueAtTime(0.00001, tReleaseStart + relSec);
      }
    } else {
      gainNode.gain.setValueAtTime(targetLinearGain, now);
    }

    let lastNode: AudioNode = gainNode;
    if (
      typeof opts.pan === 'number' &&
      opts.pan !== 0 &&
      typeof (this.audioCtx as any).createStereoPanner === 'function'
    ) {
      const panner = (this.audioCtx as any).createStereoPanner() as StereoPannerNode;
      panner.pan.value = clamp(opts.pan / 50.0, -1.0, 1.0);
      gainNode.connect(panner);
      lastNode = panner;
    }

    source.connect(gainNode);
    lastNode.connect(this.analyserNode);

    source.onended = () => {
      if (this.activeSourceNode === source) {
        this.activeSourceNode = null;
        this.activePlaybackMode = null;
        if (this.activeGainNode === gainNode) {
          try {
            gainNode.disconnect();
            if (lastNode !== gainNode) {
              lastNode.disconnect();
            }
          } catch {
            // Ignore if already disconnected
          }
          this.activeGainNode = null;
        }
      }
    };
    this.activeSourceNode = source;
    this.activeGainNode = gainNode;
    this.activePlaybackMode = 'original';
    // Start at loopStart so the user immediately hears the loop region & seam
    const offsetSec = loopOn ? Math.max(0, startSec) : 0;
    source.start(0, offsetSec);
  }

  /**
   * Fase 13 — Updates `loopStart` and `loopEnd` in real time on the active `AudioBufferSourceNode`
   * while the user drags loop markers in the Waveform Loop Editor.
   */
  public updateLiveLoopPoints(
    loopStartFrame: number,
    loopEndFrame: number,
    sampleRate: number,
    loopEnabled: boolean = true
  ): void {
    if (!this.activeSourceNode || !this.activeSourceNode.buffer) return;
    const sr = Math.max(1, sampleRate || this.activeSourceNode.buffer.sampleRate);
    const dur = this.activeSourceNode.buffer.duration;
    const startSec = clamp(loopStartFrame / sr, 0, Math.max(0, dur - 0.002));
    const endSec = clamp(loopEndFrame / sr, startSec + 0.002, dur);
    const loopOn = loopEnabled && loopEndFrame > loopStartFrame;
    this.activeSourceNode.loop = loopOn;
    if (loopOn) {
      this.activeSourceNode.loopStart = startSec;
      this.activeSourceNode.loopEnd = endSec;
    }
  }

  public stopAudition(): void {
    if (this.activeGainNode && this.audioCtx) {
      try {
        const now = this.audioCtx.currentTime;
        const cur = this.activeGainNode.gain.value;
        this.activeGainNode.gain.cancelScheduledValues(now);
        this.activeGainNode.gain.setValueAtTime(Math.max(0.00001, cur), now);
        this.activeGainNode.gain.linearRampToValueAtTime(0.00001, now + 0.025);
      } catch {
        // Ignore
      }
    }
    if (this.activeSourceNode) {
      const s = this.activeSourceNode;
      try {
        if (this.audioCtx) {
          s.stop(this.audioCtx.currentTime + 0.03);
        } else {
          s.stop();
        }
      } catch {
        // Ignore if already stopped
      }
      this.activeSourceNode = null;
      this.activePlaybackMode = null;
    }
    if (this.activeGainNode) {
      const gn = this.activeGainNode;
      setTimeout(() => {
        try {
          gn.disconnect();
        } catch {
          // Ignore
        }
      }, 40);
      this.activeGainNode = null;
    }
  }

  /**
   * Returns real-time Web Audio FFT bins (0..255) and RMS level (dBFS) during playback.
   */
  public getRealtimeSpectrum(): {
    bins: Uint8Array;
    rmsDb: number;
    isPlaying: boolean;
    mode: PreviewPlaybackMode | null;
  } {
    if (!this.analyserNode || !this.activeSourceNode) {
      return {
        bins: new Uint8Array(64),
        rmsDb: -96,
        isPlaying: false,
        mode: null,
      };
    }

    const freqBins = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.getByteFrequencyData(freqBins);

    const timeBytes = new Uint8Array(this.analyserNode.fftSize);
    this.analyserNode.getByteTimeDomainData(timeBytes);
    let sumSq = 0;
    for (let i = 0; i < timeBytes.length; i++) {
      const norm = (timeBytes[i] - 128) / 128.0;
      sumSq += norm * norm;
    }
    const rms = Math.sqrt(sumSq / timeBytes.length);
    const rmsDb = Number(linearToDb(rms, -96, 1e-5).toFixed(1));

    return {
      bins: freqBins.subarray(0, 128),
      rmsDb,
      isPlaying: true,
      mode: this.activePlaybackMode,
    };
  }

  /** Closes the shared AudioContext and drops analyser state. */
  public disposeAudio(): void {
    this.stopAudition();
    if (this.audioCtx) {
      void this.audioCtx.close();
      this.audioCtx = null;
      this.analyserNode = null;
    }
  }

  private ensureAudioContext(): void {
    if (typeof window === 'undefined' || typeof AudioContext === 'undefined') {
      return;
    }
    if (!this.audioCtx) {
      this.audioCtx = new AudioContext();
      this.analyserNode = this.audioCtx.createAnalyser();
      this.analyserNode.fftSize = 2048;
      this.analyserNode.smoothingTimeConstant = 0.78;
      this.analyserNode.connect(this.audioCtx.destination);
    }
  }
}
