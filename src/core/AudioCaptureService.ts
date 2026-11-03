/**
 * AudioCaptureService — adaptador de plataforma (vive en la app, NO en Shared).
 * ============================================================================
 * Une `getUserMedia` + AudioWorklet con el núcleo portable `RecordingEngine`
 * (`@abdsynths/shared/dsp/take/recordingEngine.ts`):
 *
 *   micrófono → MediaStreamSource → worklet tap → engine.pushSamples()
 *
 * Todo lo testeable (máquina de estados, takes, WAV, transporte) vive en
 * Shared; aquí solo hay APIs de plataforma: permisos, AudioContext, deviceId
 * y el mapeo `FinalizedTake` → contrato `RecordingTake`.
 */
import { RecordingEngine } from '@abdsynths/shared/dsp/take/recordingEngine.ts';
import type {
  AudioInputSource,
  FinalizedTake,
  RecorderState,
  TakeDescriptors,
} from '@abdsynths/shared/dsp/take/recordingEngine.ts';
import type { RecordingTake } from '@abdsynths/shared/contracts/recordingSession.ts';

export interface CaptureOpenOptions {
  deviceId?: string;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  trimSilence?: boolean;
  minSilenceMs?: number;
  attachNoiseProfile?: boolean;
  descriptors?: TakeDescriptors;
  autoClassify?: boolean;
}

const TAP_PROCESSOR_NAME = 'abd-capture-tap';

const TAP_PROCESSOR_CODE = `
registerProcessor('${TAP_PROCESSOR_NAME}', class extends AudioWorkletProcessor {
  constructor() { super(); this.batch = []; }
  process(inputs) {
    const ch = inputs[0];
    if (ch && ch.length > 0) {
      this.batch.push(ch.map((c) => c.slice(0)));
      // ~8 bloques de 128 frames ≈ 21 ms a 48 kHz: menos mensajes, misma fidelidad.
      if (this.batch.length >= 8) { this.port.postMessage(this.batch); this.batch = []; }
    }
    return true;
  }
});`;

async function ensureTapProcessor(ctx: AudioContext): Promise<void> {
  const worklet = ctx.audioWorklet;
  const existing = (worklet as unknown as Record<string, unknown>).__abdTapLoaded;
  if (existing) return;
  const blob = new Blob([TAP_PROCESSOR_CODE], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  try {
    await worklet.addModule(url);
    (worklet as unknown as Record<string, unknown>).__abdTapLoaded = true;
  } finally {
    URL.revokeObjectURL(url);
  }
}

class WorkletInputSource implements AudioInputSource {
  readonly sampleRate: number;
  readonly channels: number;
  private readonly onBlock: (channels: Float32Array[]) => void;
  private readonly stream: MediaStream;
  private readonly ctx: AudioContext;
  private readonly tap: AudioWorkletNode;
  private readonly sink: GainNode;

  constructor(
    stream: MediaStream,
    ctx: AudioContext,
    tap: AudioWorkletNode,
    sink: GainNode,
    onBlock: (channels: Float32Array[]) => void
  ) {
    this.stream = stream;
    this.ctx = ctx;
    this.tap = tap;
    this.sink = sink;
    this.onBlock = onBlock;
    this.sampleRate = ctx.sampleRate;
    this.channels = tap.channelCount;
    this.tap.port.onmessage = (ev: MessageEvent<Float32Array[][]>) => {
      for (const block of ev.data) this.onBlock(block);
    };
  }

  async start(): Promise<void> {
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  async stop(): Promise<void> {
    this.tap.port.onmessage = null;
    this.tap.disconnect();
    this.sink.disconnect();
    for (const track of this.stream.getTracks()) track.stop();
    await this.ctx.close();
  }
}

export class AudioCaptureService {
  // El ciclo de vida lo posee el motor: `engine.close()` → `source.stop()`
  // cierra tracks + AudioContext. Aquí solo se conserva el engine.
  private engine: RecordingEngine | null = null;

  /** Dispositivos físicos de entrada disponibles (requiere permiso previo en algunos navegadores). */
  static async listDevices(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'audioinput');
  }

  isOpen(): boolean {
    return this.engine !== null;
  }

  getState(): RecorderState {
    return this.engine?.getState() ?? 'idle';
  }

  /** Abre el micro y deja el motor en `monitoring`. Lanza si no hay captura disponible. */
  async open(options: CaptureOpenOptions = {}): Promise<RecordingEngine> {
    if (this.engine) return this.engine;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('AudioCaptureService.open() needs getUserMedia (secure context + input device).');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(options.deviceId ? { deviceId: { exact: options.deviceId } } : {}),
        echoCancellation: options.echoCancellation ?? false,
        noiseSuppression: options.noiseSuppression ?? false,
        autoGainControl: options.autoGainControl ?? false,
      },
    });
    const ctx = new AudioContext();
    try {
      await ensureTapProcessor(ctx);
      const srcNode = ctx.createMediaStreamSource(stream);
      const trackSettings = stream.getAudioTracks()[0]?.getSettings();
      const channels = Math.min(2, Math.max(1, trackSettings?.channelCount ?? srcNode.channelCount));
      const tap = new AudioWorkletNode(ctx, TAP_PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [channels],
      });
      const sink = ctx.createGain();
      sink.gain.value = 0; // el tap solo observa; el grafo necesita estar "tirado" para procesar.
      srcNode.connect(tap).connect(sink).connect(ctx.destination);

      let engineRef: RecordingEngine | null = null;
      const input = new WorkletInputSource(stream, ctx, tap, sink, (block) =>
        engineRef?.pushSamples(block)
      );
      const engine = new RecordingEngine(
        input,
        {
          ...(options.trimSilence !== undefined ? { trimSilence: options.trimSilence } : {}),
          ...(options.minSilenceMs !== undefined ? { minSilenceMs: options.minSilenceMs } : {}),
          ...(options.attachNoiseProfile !== undefined
            ? { attachNoiseProfile: options.attachNoiseProfile }
            : {}),
          ...(options.descriptors ? { descriptors: options.descriptors } : {}),
          autoClassify: options.autoClassify ?? true,
        }
      );
      engineRef = engine;
      this.engine = engine;
      await engine.beginMonitoring();
      return engine;
    } catch (err) {
      for (const track of stream.getTracks()) track.stop();
      await ctx.close().catch(() => undefined);
      throw err;
    }
  }

  /** Cierra micro + contexto y vuelve a `idle`. */
  async close(): Promise<void> {
    const engine = this.engine;
    this.engine = null;
    if (engine && engine.getState() !== 'idle') await engine.close();
  }

  /**
   * Convierte un take finalizado al contrato `RecordingTake` (el motor no
   * acuña ids: la política id/índice es de la app/sesión).
   */
  static toRecordingTake(take: FinalizedTake, id: string, index: number): RecordingTake {
    return {
      id,
      index,
      durationSec: take.durationSec,
      sampleRate: take.sampleRate,
      channels: take.channels,
      classification: take.classification,
      classificationConfidence: take.classificationConfidence,
      peakDbfs: take.peakDbfs,
      ...(take.noiseProfile ? { noiseProfile: take.noiseProfile } : {}),
    };
  }
}
