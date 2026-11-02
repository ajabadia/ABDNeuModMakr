// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Phase 12: Batch Queue Execution Engine
// ─────────────────────────────────────────────────────────

import type {
  BatchConfig,
  BatchModelCandidate,
  BatchProgressState,
  BatchResultSummary,
} from './types.ts';
import { runMultiZonePipeline, type ZoneWavPayload } from '../dsp/PipelineRunner.ts';
import { buildTimeCapsuleEntries } from '../timeCapsule.ts';
import { createZipArchive, type ZipEntryInput } from '@abdsynths/shared/formats/neuron';
import { bridgeClient, type AxionikSaveFileEntry } from '../bridge/BridgeClient.ts';
import { parseSampleFilenameByName } from '../sampleNaming.ts';
import { createZone } from '../sessionFactory.ts';
import type { MidiNote, ProcessConfig, Zone } from '../types.ts';
import { sliceAudioBuffer, buildMidiFileBuffer, type SlicerMode } from '../dsp/AudioSlicerEngine.ts';
import { decodeWav, decodeAiff, encodePcm16Wav } from '../dsp/WavDecoder.ts';
import { isRx2Buffer, decompressRx2Audio } from '../dsp/DwopDecompressor.ts';
import { fileExtension } from '../pathUtils.ts';
import { delay, yieldToUI } from '../asyncUtils.ts';

export type BatchQueueEvent =
  | 'progress'
  | 'job-start'
  | 'job-complete'
  | 'job-failed'
  | 'queue-complete'
  | 'queue-paused'
  | 'queue-resumed'
  | 'queue-cancelled';

export type BatchEventListener = (event: BatchQueueEvent, data: any) => void;

export class BatchQueue {
  private jobs: BatchModelCandidate[] = [];
  private listeners: Set<BatchEventListener> = new Set();
  private isRunning = false;
  private isPaused = false;
  private isCancelled = false;
  private currentIndex = 0;
  private startTime = 0;
  private masterZipEntries: ZipEntryInput[] = [];

  constructor(initialJobs: BatchModelCandidate[] = []) {
    this.jobs = [...initialJobs];
  }

  public getJobs(): BatchModelCandidate[] {
    return this.jobs;
  }

  public setJobs(jobs: BatchModelCandidate[]): void {
    if (this.isRunning) {
      throw new Error('Cannot replace jobs while queue is running.');
    }
    this.jobs = [...jobs];
    this.currentIndex = 0;
  }

  public addJobs(newJobs: BatchModelCandidate[]): void {
    this.jobs.push(...newJobs);
  }

  public clear(): void {
    if (this.isRunning) {
      throw new Error('Cannot clear queue while running.');
    }
    this.jobs = [];
    this.currentIndex = 0;
    this.masterZipEntries = [];
  }

  public on(listener: BatchEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: BatchQueueEvent, data?: any): void {
    for (const listener of this.listeners) {
      try {
        listener(event, data);
      } catch {
        // Ignore listener error
      }
    }
  }

  public getProgressState(): BatchProgressState {
    const totalJobs = this.jobs.length;
    const completedJobs = this.jobs.filter((j) => j.status === 'completed').length;
    const failedJobs = this.jobs.filter((j) => j.status === 'failed').length;
    const skippedJobs = this.jobs.filter((j) => j.status === 'skipped').length;
    const elapsedMs = this.startTime > 0 ? Date.now() - this.startTime : 0;

    const currentJob = this.jobs[this.currentIndex];
    const overallPct = totalJobs > 0 ? Math.round(((completedJobs + failedJobs) / totalJobs) * 100) : 0;

    const remainingJobs = totalJobs - (completedJobs + failedJobs + skippedJobs);
    const avgDuration = completedJobs > 0 ? elapsedMs / completedJobs : 2500;
    const estimatedRemainingMs = remainingJobs > 0 ? remainingJobs * avgDuration : 0;

    let status: BatchProgressState['status'] = 'idle';
    if (this.isCancelled) status = 'cancelled';
    else if (this.isPaused) status = 'paused';
    else if (this.isRunning) status = 'running';
    else if (completedJobs + failedJobs + skippedJobs === totalJobs && totalJobs > 0) status = 'completed';

    return {
      status,
      totalJobs,
      completedJobs,
      failedJobs,
      skippedJobs,
      currentJobIndex: this.currentIndex,
      currentJobName: currentJob ? currentJob.name : '',
      currentJobPct: currentJob ? currentJob.progressPct : 0,
      overallPct,
      elapsedMs,
      estimatedRemainingMs,
    };
  }

  public pause(): void {
    if (this.isRunning && !this.isPaused) {
      this.isPaused = true;
      this.emit('queue-paused', this.getProgressState());
    }
  }

  public resume(): void {
    if (this.isRunning && this.isPaused) {
      this.isPaused = false;
      this.emit('queue-resumed', this.getProgressState());
    }
  }

  public cancel(): void {
    if (this.isRunning) {
      this.isCancelled = true;
      this.isPaused = false;
      this.emit('queue-cancelled', this.getProgressState());
    }
  }

  /**
   * Executes the batch queue sequentially with fault tolerance and per-job memory pruning.
   */
  public async start(config: BatchConfig): Promise<BatchResultSummary> {
    if (this.isRunning) {
      throw new Error('Batch queue is already running.');
    }
    if (this.jobs.length === 0) {
      return {
        total: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        totalDurationMs: 0,
        jobs: [],
      };
    }

    this.isRunning = true;
    this.isPaused = false;
    this.isCancelled = false;
    this.startTime = Date.now();
    this.masterZipEntries = [];

    for (let i = 0; i < this.jobs.length; i++) {
      if (this.isCancelled) {
        // Mark all remaining pending jobs as skipped
        for (let j = i; j < this.jobs.length; j++) {
          if (this.jobs[j].status === 'pending') {
            this.jobs[j].status = 'skipped';
          }
        }
        break;
      }

      // Handle pause loop
      while (this.isPaused && !this.isCancelled) {
        await delay(100);
      }

      if (this.isCancelled) break;

      this.currentIndex = i;
      const job = this.jobs[i];
      if (job.status === 'completed' || job.status === 'skipped') {
        continue;
      }

      const jobStart = Date.now();
      job.status = 'processing';
      job.progressPct = 5;
      this.emit('job-start', { job, index: i });
      this.emit('progress', this.getProgressState());

      try {
        await this.processSingleJob(job, config);
        job.status = 'completed';
        job.progressPct = 100;
        job.durationMs = Date.now() - jobStart;
        this.emit('job-complete', { job, index: i });
      } catch (err) {
        job.status = 'failed';
        job.progressPct = 0;
        job.error = err instanceof Error ? err.message : String(err);
        job.durationMs = Date.now() - jobStart;
        this.emit('job-failed', { job, index: i, error: job.error });
      }

      // Yield event loop
      await yieldToUI(10);
      this.emit('progress', this.getProgressState());
    }

    this.isRunning = false;

    let masterZipBytes: Uint8Array | undefined;
    if (config.destination === 'zip-master' && this.masterZipEntries.length > 0) {
      masterZipBytes = createZipArchive(this.masterZipEntries);
    }

    const summary: BatchResultSummary = {
      total: this.jobs.length,
      succeeded: this.jobs.filter((j) => j.status === 'completed').length,
      failed: this.jobs.filter((j) => j.status === 'failed').length,
      skipped: this.jobs.filter((j) => j.status === 'skipped').length,
      totalDurationMs: Date.now() - this.startTime,
      jobs: [...this.jobs],
      masterZipBytes,
    };

    this.emit('queue-complete', summary);
    return summary;
  }

  /**
   * Processes a single model candidate through the full analysis and Time Capsule generation pipeline.
   */
  private async processSingleJob(
    job: BatchModelCandidate,
    config: BatchConfig
  ): Promise<void> {
    // 1. Resolve zones and raw audio buffers
    const rawSamples = new Map<string, ArrayBuffer>();
    for (const f of job.files) {
      rawSamples.set(f.name, f.buffer);
    }

    const isAutoSlicer =
      job.sourceType === 'auto-slicer' ||
      job.sourceType === 'loop-rx2' ||
      config.ingestionMode === 'slicer';

    let zones: Zone[] = [];
    let midiPatternFile: { name: string; buffer: ArrayBuffer } | null = null;

    if (isAutoSlicer && job.files.length > 0) {
      const sourceFile = job.files[0];
      const sliceResult = this.sliceCandidateAudio(sourceFile, job, config);
      zones = sliceResult.zones;
      for (const [name, buf] of sliceResult.sliceSamples.entries()) {
        rawSamples.set(name, buf);
      }
      if (sliceResult.midiBuffer) {
        job.midiPatternBytes = sliceResult.midiBuffer;
        midiPatternFile = {
          name: `${job.slug}_groove.mid`,
          buffer: sliceResult.midiBuffer.buffer as ArrayBuffer,
        };
        rawSamples.set(midiPatternFile.name, midiPatternFile.buffer);
      }
      job.detectedSliceCount = zones.length;
      job.zoneCount = zones.length;
    } else {
      if (job.classicZones && job.classicZones.length > 0) {
        zones = job.classicZones;
      } else {
        zones = this.buildZonesFromFiles(job.files);
      }
    }

    if (zones.length === 0) {
      throw new Error('No valid zones could be mapped from input audio files.');
    }

    job.progressPct = 25;
    this.emit('progress', this.getProgressState());

    // 2. Resolve complexity and parameterSet
    const complexity =
      config.complexityStrategy === 'auto'
        ? job.suggestedComplexity || 8
        : config.complexityStrategy;

    const parameterSet = config.autoAcousticClassification
      ? job.suggestedParameterSet || 0
      : 0;

    const procConfig: ProcessConfig = {
      modelNumber: 1,
      modelName: job.name.substring(0, 32),
      complexity,
      parameterSet,
      targetFormat: config.targetFormat,
      dspAlgorithm: config.dspAlgorithm,
      workingMode: 'extended',
    };

    // 3. Prepare payloads for PipelineRunner
    const payloads: ZoneWavPayload[] = zones.map((zone) => {
      const sName = zone.sampleLow || `Zone_${zone.rootKey}.wav`;
      const wavBuffer = rawSamples.get(sName) || rawSamples.values().next().value;
      if (!wavBuffer) {
        throw new Error(`Missing audio buffer for sample "${sName}" in model "${job.name}"`);
      }
      return {
        zone,
        wavBuffer,
      };
    });

    job.progressPct = 40;
    this.emit('progress', this.getProgressState());

    // 4. Run DSP analysis
    const result = await runMultiZonePipeline(
      payloads,
      procConfig,
      (p) => {
        job.progressPct = 40 + Math.round((p.percent / 100) * 35);
        this.emit('progress', this.getProgressState());
      },
      () => this.isCancelled
    );

    job.progressPct = 80;
    this.emit('progress', this.getProgressState());

    // 5. Build Time Capsule package entries
    const capsuleResult = buildTimeCapsuleEntries({
      slot: 1,
      modelName: job.name,
      processConfig: procConfig,
      zones,
      extendedRegions: job.extendedRegions,
      articulation: job.articulation,
      detectedInstrumentCategory: job.detectedCategory,
      rawSourceSamples: rawSamples,
      classicEnhancedBinaries: result.zoneBinaries,
    });

    job.progressPct = 90;
    this.emit('progress', this.getProgressState());

    // 6. Handle Destination
    if (config.destination === 'zip-master') {
      for (const entry of capsuleResult.entries) {
        this.masterZipEntries.push({
          path: `${job.slug}/${entry.path}`,
          data: entry.data,
        });
      }
      if (midiPatternFile) {
        this.masterZipEntries.push({
          path: `${job.slug}/04_midi/${midiPatternFile.name}`,
          data: new Uint8Array(midiPatternFile.buffer),
        });
      }
    } else if (config.destination === 'axionikdb') {
      if (bridgeClient.isConnected()) {
        const filesToSave: AxionikSaveFileEntry[] = capsuleResult.entries.map((e) => {
          if (typeof e.data === 'string') {
            return {
              path: e.path,
              content: e.data,
            };
          }
          return {
            path: e.path,
            content_b64: this.uint8ArrayToBase64(e.data),
          };
        });
        if (midiPatternFile) {
          filesToSave.push({
            path: `04_midi/${midiPatternFile.name}`,
            content_b64: this.uint8ArrayToBase64(new Uint8Array(midiPatternFile.buffer)),
          });
        }
        const targetSub = job.sublibrary || config.destinationSublibrary || 'Default';
        await bridgeClient.saveAxionikModel(
          config.axionikDbPath || 'd:\\desarrollos\\ABDSynths\\AxionikDB',
          job.slug,
          filesToSave,
          30000,
          targetSub
        );
      } else {
        // Fallback: collect into master zip if bridge offline
        for (const entry of capsuleResult.entries) {
          this.masterZipEntries.push({
            path: `${job.slug}/${entry.path}`,
            data: entry.data,
          });
        }
        if (midiPatternFile) {
          this.masterZipEntries.push({
            path: `${job.slug}/04_midi/${midiPatternFile.name}`,
            data: new Uint8Array(midiPatternFile.buffer),
          });
        }
      }
    }

    // 7. Fase 25: Stage memory safety: force garbage collection & VRAM flush if bridge online
    if (config.stagePipelineVramSafety !== false && bridgeClient.isConnected()) {
      try {
        await bridgeClient.clearMemoryCache();
      } catch {
        // non-blocking
      }
    }
  }

  /**
   * Fase 25: Slices an audio loop into individual drum hits or chromatic notes,
   * generates standard 16-bit WAV samples, maps zones, and extracts MIDI groove pattern.
   */
  private sliceCandidateAudio(
    file: { name: string; buffer: ArrayBuffer },
    job: BatchModelCandidate,
    config: BatchConfig
  ): {
    zones: Zone[];
    sliceSamples: Map<string, ArrayBuffer>;
    midiBuffer: Uint8Array | null;
  } {
    const rawSamples = new Map<string, ArrayBuffer>();
    const ext = fileExtension(file.name);
    const isRx2 = ext === 'rx2' || ext === 'rex' || isRx2Buffer(file.buffer);

    let pcm: Float32Array;
    let sampleRate = 44100;
    let detectedBpm = config.slicerBpm || 120;

    if (isRx2) {
      const rx2Res = decompressRx2Audio(file.buffer);
      pcm = rx2Res.channels[0];
      sampleRate = rx2Res.sampleRate;
    } else {
      let decoded: { channels: Float32Array[]; sampleRate: number };
      if (ext === 'aif' || ext === 'aiff') {
        decoded = decodeAiff(file.buffer);
      } else {
        decoded = decodeWav(file.buffer);
      }
      sampleRate = decoded.sampleRate;
      if (decoded.channels.length === 1) {
        pcm = decoded.channels[0];
      } else {
        pcm = new Float32Array(decoded.channels[0].length);
        const inv = 1 / decoded.channels.length;
        for (let i = 0; i < pcm.length; i++) {
          let sum = 0;
          for (let ch = 0; ch < decoded.channels.length; ch++) {
            sum += decoded.channels[ch][i];
          }
          pcm[i] = sum * inv;
        }
      }
    }

    const slicerMode: SlicerMode = (job.slicerProfile || config.slicerProfile || 'drums') as SlicerMode;
    const slicerRes = sliceAudioBuffer(pcm, sampleRate, {
      mode: slicerMode,
      sensitivity: config.slicerSensitivity ?? 70,
      silenceThresholdDb: -42,
      preRollMs: 3,
      postRollMs: 8,
      snapZeroCrossing: config.slicerSnapZeroCrossing ?? true,
      bpm: detectedBpm,
      gridDivision: '1/16',
      allowOverlap: false,
      chromaticBaseNote: 36,
    });

    const validSlices = slicerRes.slices.filter((s) => !s.isSilence);
    if (validSlices.length === 0) {
      throw new Error(`AutoSlicer could not detect any valid audio slices in "${file.name}".`);
    }

    const zones: Zone[] = [];
    validSlices.forEach((sl, idx) => {
      const sliceWavName = `${job.slug}_slice${String(idx + 1).padStart(2, '0')}.wav`;
      const wavBuffer = encodePcm16Wav(sl.pcm, sampleRate, {
        rootKey: sl.rootKey,
        lowKey: sl.lowKey,
        highKey: sl.highKey,
      });
      rawSamples.set(sliceWavName, wavBuffer);

      zones.push(
        createZone(
          sl.lowKey as MidiNote,
          sl.rootKey as MidiNote,
          sl.highKey as MidiNote,
          sliceWavName
        )
      );
    });

    let midiBuffer: Uint8Array | null = null;
    if (config.exportMidiPattern !== false) {
      midiBuffer = slicerRes.midiFileBuffer || buildMidiFileBuffer(validSlices, detectedBpm);
    }

    return {
      zones,
      sliceSamples: rawSamples,
      midiBuffer,
    };
  }

  /**
   * Automatically partitions MIDI notes 0..127 across audio files using Hartmann naming rules.
   */
  private buildZonesFromFiles(files: { name: string; buffer: ArrayBuffer }[]): Zone[] {
    const parsed = files.map((f) => {
      const p = parseSampleFilenameByName(f.name.replace(/\.[^.]+$/, ''));
      return {
        file: f,
        rootKey: p.rootKey >= 0 ? (p.rootKey as MidiNote) : (60 as MidiNote),
      };
    });

    parsed.sort((a, b) => a.rootKey - b.rootKey);
    const zones: Zone[] = [];

    for (let i = 0; i < parsed.length; i++) {
      const cur = parsed[i];
      const prev = i > 0 ? parsed[i - 1] : null;
      const next = i < parsed.length - 1 ? parsed[i + 1] : null;

      const lowKey = prev ? Math.floor((prev.rootKey + cur.rootKey) / 2) + 1 : 0;
      const highKey = next ? Math.floor((cur.rootKey + next.rootKey) / 2) : 127;

      zones.push(
        createZone(
          Math.min(127, Math.max(0, lowKey)) as MidiNote,
          cur.rootKey,
          Math.min(127, Math.max(0, highKey)) as MidiNote,
          cur.file.name
        )
      );
    }

    return zones;
  }

  private uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    if (typeof btoa !== 'undefined') {
      return btoa(binary);
    }
    const nodeBuf = (globalThis as unknown as { Buffer?: { from: (s: string, enc: string) => { toString: (e: string) => string } } }).Buffer;
    if (nodeBuf) {
      return nodeBuf.from(binary, 'binary').toString('base64');
    }
    return '';
  }
}
