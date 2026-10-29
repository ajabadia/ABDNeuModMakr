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
import type { MidiNote, Zone } from './types.ts';

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

  public stopAudition(): void {
    if (this.activeSourceNode) {
      try {
        this.activeSourceNode.stop();
        this.activeSourceNode.disconnect();
      } catch {
        // Ignore if already stopped
      }
      this.activeSourceNode = null;
      this.activePlaybackMode = null;
    }
    if (this.activeGainNode) {
      try {
        this.activeGainNode.disconnect();
      } catch {
        // Ignore if already disconnected
      }
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
