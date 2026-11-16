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
import type {
  DahdsrEnvelope,
  LoopMode,
  MidiNote,
  OffMode,
  RegionFilterConfig,
  Zone,
} from './types.ts';
import { selectVoiceToSteal } from '@abdsynths/shared/formats/sampler';

export interface PolyNoteOnOptions {
  note: MidiNote;
  velocity?: number; // 1..127
  sampleName: string;
  rootKey?: MidiNote;
  pitchKeytrack?: number; // 0..100
  detuneCents?: number;
  volumeDb?: number;
  pan?: number; // -50..+50
  gainMultiplier?: number; // e.g. crossfade * rt_decay
  loopMode?: LoopMode;
  loopStartFrame?: number;
  loopEndFrame?: number;
  loopCrossfadeMs?: number;
  sampleStartFrame?: number;
  sampleEndFrame?: number;
  reversed?: boolean;
  ampEnv?: DahdsrEnvelope;
  filter?: RegionFilterConfig;
  muteGroup?: number;
  offMode?: OffMode;
  offTimeSec?: number;
  maxPolyphony?: number;
  isReleaseTrigger?: boolean;
}

interface PolyVoiceState {
  id: string;
  note: MidiNote;
  startedAtMs: number;
  released: boolean;
  muteGroup?: number;
  offMode: OffMode;
  offTimeSec: number;
  releaseSec: number;
  sustainLevel: number;
  targetGain: number;
  sourceNode: AudioBufferSourceNode;
  gainNode: GainNode;
  nodes: AudioNode[];
}

export type PreviewPlaybackMode = 'original' | 'resynthesis' | 'enhanced' | 'resynator_v2';

export interface PreviewSources {
  getZone(zoneId: string): Zone | undefined;
  getFirstZone(): Zone | undefined;
  getSampleBuffer(name: string): ArrayBuffer | undefined;
  setSampleBuffer(name: string, buffer: ArrayBuffer): void;
  /** Resynthesized mono PCM for the zone (Legacy DSP), if already inspected. */
  getResynthMono(zoneId: string): Float32Array | undefined;
  /** Enhanced DSP resynthesized mono PCM for the zone, if already inspected. */
  getEnhancedMono?(zoneId: string): Float32Array | undefined;
  /** Resynator v2 (motor WASM) stereo PCM for the zone at `targetNote`. */
  getResynatorV2Stereo?(
    zoneId: string,
    targetNote?: MidiNote
  ): Promise<{ left: Float32Array; right: Float32Array; sampleRate: number } | undefined>;
  /** Ensure the zone has been spectrally inspected (populates resynth). */
  ensureSpectrum(zoneId: string): void;
}

export class AudioPreviewService {
  private readonly sources: PreviewSources;
  private audioCtx: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private activeSourceNode: AudioBufferSourceNode | null = null;
  private activeGainNode: GainNode | null = null;
  private activeIntermediateNodes: AudioNode[] = [];
  private activePlaybackMode: PreviewPlaybackMode | null = null;
  private activePolyVoices = new Map<string, PolyVoiceState>();
  private polyVoiceSeq = 0;

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
      try {
        source.disconnect();
      } catch {
        // Ignore if already disconnected
      }
      if (this.activeSourceNode === source) {
        this.activeSourceNode = null;
        this.activePlaybackMode = null;
      }
    };
    this.activeSourceNode = source;
    this.activeIntermediateNodes = [];
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
    targetNote?: MidiNote,
    sampleOverride?: { sampleName: string; rootKey: MidiNote }
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

    if ((mode === 'resynthesis' || mode === 'enhanced' || mode === 'resynator_v2') && !this.sources.getResynthMono(zone.id)) {
      this.sources.ensureSpectrum(zone.id);
    }
    const resynthMono =
      mode === 'enhanced'
        ? (this.sources.getEnhancedMono?.(zone.id) ?? this.sources.getResynthMono(zone.id))
        : this.sources.getResynthMono(zone.id);
    const resynatorV2Stereo =
      mode === 'resynator_v2'
        ? await this.sources.getResynatorV2Stereo?.(zone.id, targetNote)
        : undefined;

    // Original mode can play a specific velocity layer / extended region sample
    const useOverride = mode === 'original' && !!sampleOverride?.sampleName;
    const pitchRoot = useOverride ? sampleOverride!.rootKey : zone.rootKey;
    const semitoneShift =
      targetNote !== undefined
        ? targetNote - pitchRoot + (zone.detune || 0) / 100
        : (zone.detune || 0) / 100;
    // Note: Resynator v2 synthesizes directly at targetNote with Formant Locking, so playbackRate stays 1.0
    const playbackRate =
      mode === 'resynator_v2' && resynatorV2Stereo
        ? 1.0
        : Math.pow(2.0, semitoneShift / 12.0);
    const linearGain = Math.pow(10.0, (zone.volume || 0) / 20.0);

    let audioBuffer: AudioBuffer;
    if (mode === 'resynator_v2' && resynatorV2Stereo) {
      audioBuffer = this.audioCtx.createBuffer(
        2,
        resynatorV2Stereo.left.length,
        resynatorV2Stereo.sampleRate
      );
      audioBuffer.copyToChannel(new Float32Array(resynatorV2Stereo.left), 0);
      audioBuffer.copyToChannel(new Float32Array(resynatorV2Stereo.right), 1);
    } else if ((mode === 'resynthesis' || mode === 'enhanced') && resynthMono) {
      const mono = resynthMono;
      audioBuffer = this.audioCtx.createBuffer(1, mono.length, 44100);
      audioBuffer.copyToChannel(new Float32Array(mono), 0);
    } else {
      const sampleName = useOverride
        ? sampleOverride!.sampleName
        : (zone.sampleLow ?? DEFAULT_SAMPLE_NAME);
      const raw =
        this.sources.getSampleBuffer(sampleName) ??
        synthesizeDemoWav('strings', pitchRoot, 44100, 1.0);
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
      try {
        source.disconnect();
      } catch {
        // Ignore if already disconnected
      }
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
    this.activeIntermediateNodes = [gainNode];
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
    targetKey?: MidiNote;
    loopStartFrame: number;
    loopEndFrame: number;
    loopEnabled?: boolean;
    loopMode?: LoopMode;
    loopCrossfadeMs?: number;
    volumeDb?: number;
    pan?: number;
    detuneCents?: number;
    ampEnv?: DahdsrEnvelope;
    startFromLoopStart?: boolean;
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
      // Transient demo tone: never cache it under the real sample name, so a later
      // reload/hydration of the genuine sample is not shadowed by a stale demo buffer.
      const parsedKey = parseRootKeyFromFilename(samplePath, rootKey);
      raw = synthesizeDemoWav('strings', parsedKey, 44100, 1.0);
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

    // Only reshape the PCM (crossfade / ping-pong unroll) when a loop will actually play.
    // Otherwise a one-shot audition would hear the mirrored ping-pong tail or a
    // crossfaded seam baked into the buffer ("doubled" sound).
    const wantLoop =
      opts.loopEnabled !== false &&
      opts.loopMode !== 'no_loop' &&
      opts.loopMode !== 'one_shot';
    const isPingPong = wantLoop && opts.loopMode === 'ping_pong';
    const xfadeFrames =
      wantLoop && opts.loopCrossfadeMs && opts.loopCrossfadeMs > 0
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

    if (
      typeof opts.targetKey === 'number' &&
      typeof opts.rootKey === 'number' &&
      opts.targetKey !== opts.rootKey
    ) {
      const semitoneShift = opts.targetKey - opts.rootKey;
      source.playbackRate.value = clamp(Math.pow(2.0, semitoneShift / 12.0), 0.125, 8.0);
    } else {
      source.playbackRate.value = 1.0;
    }

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
      try {
        source.disconnect();
      } catch {
        // Ignore if already disconnected
      }
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
    this.activeIntermediateNodes = lastNode !== gainNode ? [gainNode, lastNode] : [gainNode];
    this.activePlaybackMode = 'original';
    // When startFromLoopStart is true (e.g. Waveform Loop Editor preview), start at loopStart.
    // Otherwise start from 0 so the sample plays from the beginning naturally.
    const offsetSec = opts.startFromLoopStart && loopOn ? Math.max(0, startSec) : 0;
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
    this.stopAllPolyVoices();
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
          setTimeout(() => {
            try {
              s.disconnect();
            } catch {
              // Ignore
            }
          }, 40);
        } else {
          s.stop();
          try {
            s.disconnect();
          } catch {
            // Ignore
          }
        }
      } catch {
        // Ignore if already stopped
      }
      this.activeSourceNode = null;
      this.activePlaybackMode = null;
    }
    if (this.activeIntermediateNodes.length > 0) {
      const nodesToDisconnect = [...this.activeIntermediateNodes];
      this.activeIntermediateNodes = [];
      setTimeout(() => {
        for (const n of nodesToDisconnect) {
          try {
            n.disconnect();
          } catch {
            // Ignore if already disconnected
          }
        }
      }, 40);
      this.activeGainNode = null;
    }
  }

  public async playPolyNoteOn(opts: PolyNoteOnOptions): Promise<void> {
    if (typeof window === 'undefined' || typeof AudioContext === 'undefined') {
      return;
    }
    this.ensureAudioContext();
    if (!this.audioCtx || !this.analyserNode) return;
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }

    // 1. Choke groups (group / off_by)
    if (opts.muteGroup && opts.muteGroup > 0) {
      for (const v of Array.from(this.activePolyVoices.values())) {
        if (v.muteGroup === opts.muteGroup && !v.released) {
          this.chokePolyVoice(v);
        }
      }
    }

    // 2. Polyphony cap + clean-room envelope/age voice stealing
    const maxPoly = Math.max(1, Math.min(64, opts.maxPolyphony ?? 32));
    while (this.activePolyVoices.size >= maxPoly) {
      const nowMs = performance.now();
      const victimId = selectVoiceToSteal(
        Array.from(this.activePolyVoices.values()).map((v) => ({
          id: v.id,
          ageMs: Math.max(0, nowMs - v.startedAtMs),
          envelopeLevel: v.released ? v.sustainLevel * 0.25 : v.sustainLevel,
        })),
      );
      if (!victimId) break;
      const victim = this.activePolyVoices.get(victimId);
      if (!victim) break;
      this.fadeAndRemovePolyVoice(victim, 0.008);
    }

    const samplePath = opts.sampleName || DEFAULT_SAMPLE_NAME;
    const rootKey = opts.rootKey ?? 60;
    let raw = this.sources.getSampleBuffer(samplePath);
    if (!raw) {
      const parsedKey = parseRootKeyFromFilename(samplePath, rootKey);
      raw = synthesizeDemoWav('strings', parsedKey, 44100, 1.0);
    }

    const decoded = decodeWav(raw);
    const sr = Math.max(1, decoded.sampleRate);
    const totalFrames = Math.max(2, decoded.numSamples);
    const startTrim = clamp(opts.sampleStartFrame ?? 0, 0, totalFrames - 2);
    const endTrim = clamp(opts.sampleEndFrame ?? totalFrames, startTrim + 2, totalFrames);

    let channels: Float32Array[] = decoded.channels.map((ch) =>
      startTrim > 0 || endTrim < totalFrames ? ch.slice(startTrim, endTrim) : new Float32Array(ch),
    );
    const shouldReverse = Boolean(opts.reversed || opts.loopMode === 'loop_backward');
    if (shouldReverse) {
      channels = channels.map((ch) => {
        const rev = new Float32Array(ch.length);
        for (let i = 0; i < ch.length; i++) rev[i] = ch[ch.length - 1 - i];
        return rev;
      });
    }

    const trimmedLen = Math.max(2, channels[0].length);
    const relLoopStart = clamp((opts.loopStartFrame ?? 0) - startTrim, 0, trimmedLen - 2);
    const relLoopEnd = clamp((opts.loopEndFrame ?? 0) - startTrim, relLoopStart + 1, trimmedLen);
    const wantLoop =
      !opts.isReleaseTrigger &&
      opts.loopMode !== undefined &&
      opts.loopMode !== 'no_loop' &&
      opts.loopMode !== 'one_shot' &&
      relLoopEnd > relLoopStart + 1;
    const isPingPong = wantLoop && opts.loopMode === 'ping_pong';
    const xfadeFrames =
      wantLoop && opts.loopCrossfadeMs && opts.loopCrossfadeMs > 0
        ? Math.round((opts.loopCrossfadeMs / 1000) * sr)
        : 0;

    let actualStartFrame = relLoopStart;
    let actualEndFrame = relLoopEnd;
    if (xfadeFrames > 0 && !isPingPong) {
      channels = channels.map((ch) =>
        applyLoopCrossfade(ch, relLoopStart, relLoopEnd, xfadeFrames, 'equal-power'),
      );
    }
    if (isPingPong) {
      const p0 = generatePingPongLoopBuffer(channels[0], relLoopStart, relLoopEnd);
      actualStartFrame = p0.loopStart;
      actualEndFrame = p0.loopEnd;
      channels =
        decoded.numChannels === 1
          ? [p0.pcm]
          : channels.map((ch) => generatePingPongLoopBuffer(ch, relLoopStart, relLoopEnd).pcm);
    }

    const outNumSamples = channels[0].length;
    const audioBuffer = this.audioCtx.createBuffer(decoded.numChannels, outNumSamples, sr);
    for (let ch = 0; ch < decoded.numChannels; ch++) {
      audioBuffer.copyToChannel(new Float32Array(channels[ch]), ch);
    }

    const source = this.audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    const keytrack = (opts.pitchKeytrack ?? 100) / 100;
    const semitoneShift = (opts.note - rootKey) * keytrack;
    source.playbackRate.value = clamp(Math.pow(2.0, semitoneShift / 12.0), 0.125, 8.0);
    if (opts.detuneCents) {
      source.detune.value = opts.detuneCents;
    }

    const durSec = outNumSamples / sr;
    const loopStartSec = clamp(actualStartFrame / sr, 0, Math.max(0, durSec - 0.002));
    const loopEndSec = clamp(actualEndFrame / sr, loopStartSec + 0.002, durSec);
    if (wantLoop && loopEndSec > loopStartSec) {
      source.loop = true;
      source.loopStart = loopStartSec;
      source.loopEnd = loopEndSec;
    }

    const velNorm = clamp((opts.velocity ?? 100) / 127, 0.02, 1.0);
    const volLinear = Math.pow(10.0, (opts.volumeDb ?? 0) / 20.0);
    const mult = clamp(opts.gainMultiplier ?? 1.0, 0, 1);
    const targetLinearGain = clamp(volLinear * velNorm * mult, 0.00005, 4.0);

    const gainNode = this.audioCtx.createGain();
    const now = this.audioCtx.currentTime;
    const env = opts.ampEnv;
    const releaseSec = Math.max(0.015, env?.releaseSec ?? 0.2);
    const sustainLevel = clamp(env?.sustainLevel ?? 1.0, 0, 1);

    if (env) {
      const dSec = Math.max(0, env.delaySec || 0);
      const aSec = Math.max(0.002, env.attackSec || 0.005);
      const hSec = Math.max(0, env.holdSec || 0);
      const decSec = Math.max(0.002, env.decaySec || 0.01);
      const susGain = clamp(targetLinearGain * sustainLevel, 0.00001, 4.0);
      const startGain = clamp(targetLinearGain * (env.startLevel ?? 0), 0.00001, 4.0);

      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.setValueAtTime(startGain, now);
      const tAttackStart = now + dSec;
      if (dSec > 0.001) gainNode.gain.setValueAtTime(startGain, tAttackStart);
      const tHoldStart = tAttackStart + aSec;
      gainNode.gain.linearRampToValueAtTime(targetLinearGain, tHoldStart);
      const tDecayStart = tHoldStart + hSec;
      if (hSec > 0.001) gainNode.gain.setValueAtTime(targetLinearGain, tDecayStart);
      gainNode.gain.linearRampToValueAtTime(susGain, tDecayStart + decSec);
    } else {
      gainNode.gain.setValueAtTime(targetLinearGain, now);
    }

    const nodes: AudioNode[] = [];
    let tail: AudioNode = source;

    if (opts.filter?.enabled && typeof this.audioCtx.createBiquadFilter === 'function') {
      const biquad = this.audioCtx.createBiquadFilter();
      biquad.type =
        opts.filter.type === 'hpf'
          ? 'highpass'
          : opts.filter.type === 'bpf'
            ? 'bandpass'
            : opts.filter.type === 'notch' || opts.filter.type === 'brf'
              ? 'notch'
              : 'lowpass';
      biquad.frequency.value = clamp(opts.filter.cutoffHz || 18000, 20, 20000);
      biquad.Q.value = clamp(Math.pow(10, (opts.filter.resonanceDb ?? 0) / 20), 0.5, 20);
      tail.connect(biquad);
      tail = biquad;
      nodes.push(biquad);
    }

    tail.connect(gainNode);
    tail = gainNode;
    nodes.push(gainNode);

    if (
      typeof opts.pan === 'number' &&
      opts.pan !== 0 &&
      typeof (this.audioCtx as unknown as { createStereoPanner?: () => StereoPannerNode }).createStereoPanner === 'function'
    ) {
      const panner = (this.audioCtx as unknown as { createStereoPanner: () => StereoPannerNode }).createStereoPanner();
      panner.pan.value = clamp(opts.pan / 50.0, -1.0, 1.0);
      tail.connect(panner);
      tail = panner;
      nodes.push(panner);
    }

    tail.connect(this.analyserNode);

    const voiceId = `pv_${++this.polyVoiceSeq}`;
    const voiceState: PolyVoiceState = {
      id: voiceId,
      note: opts.note,
      startedAtMs: performance.now(),
      released: Boolean(opts.isReleaseTrigger),
      muteGroup: opts.muteGroup,
      offMode: opts.offMode ?? 'fast',
      offTimeSec: opts.offTimeSec ?? 0.06,
      releaseSec,
      sustainLevel,
      targetGain: targetLinearGain,
      sourceNode: source,
      gainNode,
      nodes,
    };

    source.onended = () => {
      this.cleanupPolyVoice(voiceState);
    };

    this.activePolyVoices.set(voiceId, voiceState);
    this.activePlaybackMode = 'original';
    source.start(0);
  }

  /**
   * Releases all sustaining polyphonic voices for `note` and returns the held duration
   * in seconds (used by `trigger=release` / `rt_decay`).
   */
  public releasePolyNote(note: MidiNote): number | undefined {
    const nowMs = performance.now();
    let maxHoldSec: number | undefined;
    for (const v of Array.from(this.activePolyVoices.values())) {
      if (v.note === note && !v.released) {
        const holdSec = Math.max(0, (nowMs - v.startedAtMs) / 1000);
        if (maxHoldSec === undefined || holdSec > maxHoldSec) {
          maxHoldSec = holdSec;
        }
        v.released = true;
        this.fadeAndRemovePolyVoice(v, v.releaseSec);
      }
    }
    return maxHoldSec;
  }

  public stopAllPolyVoices(): void {
    for (const v of Array.from(this.activePolyVoices.values())) {
      this.fadeAndRemovePolyVoice(v, 0.015);
    }
  }

  private chokePolyVoice(v: PolyVoiceState): void {
    v.released = true;
    if (v.offMode === 'normal') {
      this.fadeAndRemovePolyVoice(v, v.releaseSec);
    } else if (v.offMode === 'time') {
      this.fadeAndRemovePolyVoice(v, Math.max(0.004, v.offTimeSec));
    } else {
      this.fadeAndRemovePolyVoice(v, 0.006);
    }
  }

  private fadeAndRemovePolyVoice(v: PolyVoiceState, fadeSec: number): void {
    this.activePolyVoices.delete(v.id);
    if (!this.audioCtx) {
      try { v.sourceNode.stop(); } catch { /* ignore */ }
      this.cleanupPolyVoice(v);
      return;
    }
    try {
      const now = this.audioCtx.currentTime;
      const cur = Math.max(0.00001, v.gainNode.gain.value);
      v.gainNode.gain.cancelScheduledValues(now);
      v.gainNode.gain.setValueAtTime(cur, now);
      v.gainNode.gain.linearRampToValueAtTime(0.00001, now + fadeSec);
      v.sourceNode.stop(now + fadeSec + 0.01);
      setTimeout(() => this.cleanupPolyVoice(v), Math.round((fadeSec + 0.03) * 1000));
    } catch {
      this.cleanupPolyVoice(v);
    }
  }

  private cleanupPolyVoice(v: PolyVoiceState): void {
    this.activePolyVoices.delete(v.id);
    try { v.sourceNode.disconnect(); } catch { /* ignore */ }
    for (const n of v.nodes) {
      try { n.disconnect(); } catch { /* ignore */ }
    }
    if (!this.activeSourceNode && this.activePolyVoices.size === 0) {
      this.activePlaybackMode = null;
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
    if (!this.analyserNode || (!this.activeSourceNode && this.activePolyVoices.size === 0)) {
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
