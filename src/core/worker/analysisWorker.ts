// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Spectral Analysis Web Worker
//
// Runs the WAV decode -> STFT -> harmonic peak-picking ->
// layer clustering -> Scape/Sphere generation pipeline off
// the main UI thread.
// ─────────────────────────────────────────────────────────

import type {
  ProcessConfig,
  ProcessProgress,
  ZoneAnalysisSummary,
} from '../types.ts';
import {
  runMultiZonePipeline,
  type ZoneWavPayload,
  type ZoneBinaryPair,
} from '../dsp/PipelineRunner.ts';

export type WorkerInboundMessage =
  | {
      type: 'start';
      payloads: ZoneWavPayload[];
      config: ProcessConfig;
    }
  | {
      type: 'cancel';
    };

export type WorkerOutboundMessage =
  | {
      type: 'progress';
      progress: ProcessProgress;
    }
  | {
      type: 'complete';
      zonesAnalysis: ZoneAnalysisSummary[];
      neuronikModelJson: string;
      zoneBinaries: ZoneBinaryPair[];
      elapsedMs: number;
    }
  | {
      type: 'cancelled';
      elapsedMs: number;
    }
  | {
      type: 'error';
      error: string;
    };

let cancelRequested = false;

const workerScope = self as unknown as {
  onmessage: ((ev: MessageEvent<WorkerInboundMessage>) => void) | null;
  postMessage: (msg: WorkerOutboundMessage) => void;
};

workerScope.onmessage = async (event: MessageEvent<WorkerInboundMessage>) => {
  const msg = event.data;

  if (msg.type === 'cancel') {
    cancelRequested = true;
    return;
  }

  if (msg.type === 'start') {
    cancelRequested = false;
    const startTime = Date.now();

    try {
      const result = await runMultiZonePipeline(
        msg.payloads,
        msg.config,
        (progress) => {
          workerScope.postMessage({ type: 'progress', progress });
        },
        () => cancelRequested
      );

      workerScope.postMessage({
        type: 'complete',
        zonesAnalysis: result.zonesAnalysis,
        neuronikModelJson: result.neuronikModelJson,
        zoneBinaries: result.zoneBinaries,
        elapsedMs: Date.now() - startTime,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (cancelRequested || message.includes('cancelled')) {
        workerScope.postMessage({
          type: 'cancelled',
          elapsedMs: Date.now() - startTime,
        });
      } else {
        workerScope.postMessage({
          type: 'error',
          error: message,
        });
      }
    }
  }
};
