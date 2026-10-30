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
        await new Promise((r) => setTimeout(r, 100));
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
      await new Promise((r) => setTimeout(r, 10));
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

    let zones: Zone[] = [];
    if (job.classicZones && job.classicZones.length > 0) {
      zones = job.classicZones;
    } else {
      zones = this.buildZonesFromFiles(job.files);
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
        await bridgeClient.saveAxionikModel(
          config.axionikDbPath || 'd:\\desarrollos\\ABDSynths\\AxionikDB',
          job.slug,
          filesToSave
        );
      } else {
        // Fallback: collect into master zip if bridge offline
        for (const entry of capsuleResult.entries) {
          this.masterZipEntries.push({
            path: `${job.slug}/${entry.path}`,
            data: entry.data,
          });
        }
      }
    }
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
