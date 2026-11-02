// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Fase 34: Audio Recorder Modal
//
// Frontal del grabador sobre el núcleo portable `RecordingEngine`
// (@abdsynths/shared/dsp/take) + `AudioCaptureService` (captura de
// plataforma: getUserMedia → AudioWorklet → engine.pushSamples()).
//
// Estilo: reutiliza la estructura `nmm-modal-*`, botones `btn`,
// badges `panel-badge` y `val-pill` del resto de la app; el CSS
// propio (`nmm-recorder-*` en style.css) solo usa tokens generales
// de ABDShared (`var(--color-…)` / `var(--space-…)` / …), sin
// colores hardcodeados.
// ─────────────────────────────────────────────────────────

import { ICONS } from './icons.ts';
import { escHtml } from './escape.ts';
import { toast } from './notify.ts';
import { downloadBlob } from './download.ts';
import { createModalFocusTrap, type FocusTrap } from './modalFocusTrap.ts';
import { AudioCaptureService } from '../core/AudioCaptureService.ts';
import type {
  FinalizedTake,
  RecorderState,
} from '@abdsynths/shared/dsp/take/recordingEngine.ts';

export interface AudioRecorderContext {
  onAuditionPcm?: (pcm: Float32Array, sampleRate: number) => void;
  onStopAudition?: () => void;
  /** Envía un take al Chopper (deslice/destino de 34.4). Recibe WAV 16-bit + nombre. */
  onSendToChopper?: (wavBytes: ArrayBuffer, filename: string) => void;
}

interface SessionTake {
  id: string;
  name: string;
  take: FinalizedTake;
}

function formatTakeTime(totalSec: number): string {
  const s = Math.max(0, totalSec);
  const mm = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  const tenths = Math.floor((s * 10) % 10);
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${tenths}`;
}

function mixToMono(take: FinalizedTake): Float32Array {
  const { samples } = take;
  if (samples.length === 1) return samples[0];
  const len = samples[0].length;
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let acc = 0;
    for (const ch of samples) acc += ch[i];
    out[i] = acc / samples.length;
  }
  return out;
}

const STATE_BADGE: Record<RecorderState, string> = {
  idle: 'IDLE',
  monitoring: 'MONITORING',
  recording: 'REC',
  paused: 'PAUSED',
  stopped: 'STOPPED',
};

export class AudioRecorderModal {
  private backdropEl: HTMLElement | null = null;
  private focusTrap: FocusTrap | null = null;
  private readonly capture = new AudioCaptureService();
  private readonly context: AudioRecorderContext;

  private devices: MediaDeviceInfo[] = [];
  private selectedDeviceId = '';
  private takes: SessionTake[] = [];
  private takeSeq = 0;
  private rafId = 0;
  private opening = false;

  constructor(context: AudioRecorderContext = {}) {
    this.context = context;
  }

  public isOpen(): boolean {
    return this.backdropEl !== null;
  }

  public open(): void {
    if (this.backdropEl) {
      this.backdropEl.querySelector<HTMLElement>('.nmm-modal-window')?.focus?.();
      return;
    }
    this.backdropEl = document.createElement('div');
    this.backdropEl.className = 'nmm-modal-backdrop nmm-recorder-backdrop';
    document.body.appendChild(this.backdropEl);
    this.backdropEl.addEventListener('click', (e) => {
      if (e.target === this.backdropEl) void this.close();
    });
    this.focusTrap = createModalFocusTrap(this.backdropEl, {
      onEscape: () => void this.close(),
    });
    this.focusTrap.activate();
    this.render();
    void this.refreshDevices();
    this.startMeterLoop();
  }

  public async close(): Promise<void> {
    if (!this.backdropEl) return;
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.context.onStopAudition?.();
    try {
      const engine = this.capture.isOpen() ? await this.capture.open() : null;
      if (engine && (engine.getState() === 'recording' || engine.getState() === 'paused')) {
        this.finishTake(engine.stopRecording());
      }
    } catch {
      // Si el motor no está disponible, no hay take que rescatar.
    }
    await this.capture.close().catch(() => undefined);
    this.focusTrap?.deactivate();
    this.focusTrap = null;
    this.backdropEl.remove();
    this.backdropEl = null;
  }

  // ── Dispositivos ──────────────────────────────────────────

  private async refreshDevices(): Promise<void> {
    try {
      this.devices = await AudioCaptureService.listDevices();
    } catch {
      this.devices = [];
    }
    const sel = this.backdropEl?.querySelector<HTMLSelectElement>('#rec-device');
    if (!sel) return;
    sel.innerHTML =
      this.devices.length === 0
        ? `<option value="">Default input</option>`
        : this.devices
            .map(
              (d, i) =>
                `<option value="${escHtml(d.deviceId)}">${escHtml(d.label || `Input ${i + 1}`)}</option>`
            )
            .join('');
    if (this.selectedDeviceId) sel.value = this.selectedDeviceId;
  }

  private async enableMic(): Promise<void> {
    if (this.opening || this.capture.isOpen()) return;
    this.opening = true;
    this.setBusy(true);
    try {
      const sel = this.backdropEl?.querySelector<HTMLSelectElement>('#rec-device');
      this.selectedDeviceId = sel?.value ?? '';
      await this.capture.open({
        ...(this.selectedDeviceId ? { deviceId: this.selectedDeviceId } : {}),
        trimSilence: true,
        attachNoiseProfile: true,
      });
      this.renderTransport();
    } catch (err) {
      toast(`Microphone unavailable: ${err instanceof Error ? err.message : String(err)}`, 'warning');
    } finally {
      this.opening = false;
      this.setBusy(false);
    }
  }

  // ── Transporte ────────────────────────────────────────────

  private async toggleRecord(): Promise<void> {
    let engine;
    try {
      engine = await this.capture.open();
    } catch {
      await this.enableMic();
      return;
    }
    const state = engine.getState();
    if (state === 'monitoring') {
      this.context.onStopAudition?.();
      engine.startRecording();
    } else if (state === 'recording') {
      engine.pauseRecording();
    } else if (state === 'paused') {
      engine.resumeRecording();
    }
    this.renderTransport();
  }

  private stopAndKeep(): void {
    if (!this.capture.isOpen()) return;
    void this.capture.open().then((engine) => {
      if (engine.getState() === 'recording' || engine.getState() === 'paused') {
        this.finishTake(engine.stopRecording());
      }
      this.renderTransport();
    });
  }

  private cancelAndDiscard(): void {
    if (!this.capture.isOpen()) return;
    void this.capture.open().then((engine) => {
      if (engine.getState() === 'recording' || engine.getState() === 'paused') {
        engine.cancelTake();
        toast('Take discarded.', 'info');
      }
      this.renderTransport();
    });
  }

  private finishTake(take: FinalizedTake): void {
    this.takeSeq += 1;
    const name = `Take ${String(this.takeSeq).padStart(2, '0')}`;
    this.takes.unshift({
      id: `take-${Date.now()}-${this.takeSeq}`,
      name,
      take,
    });
    const cls = take.classification === 'unknown' ? 'unclassified' : take.classification;
    toast(
      `${name} kept: ${take.durationSec.toFixed(2)}s, peak ${take.peakDbfs.toFixed(1)} dBFS, ${cls}.`,
      'success'
    );
    this.renderTakes();
  }

  // ── Takes: audition / chopper / download / delete ─────────

  private auditionTake(id: string): void {
    const found = this.takes.find((t) => t.id === id);
    if (!found || !this.context.onAuditionPcm) return;
    this.context.onAuditionPcm(mixToMono(found.take), found.take.sampleRate);
  }

  private sendTakeToChopper(id: string): void {
    const found = this.takes.find((t) => t.id === id);
    if (!found || !this.context.onSendToChopper) return;
    this.context.onSendToChopper(found.take.wav.slice(0).buffer as ArrayBuffer, `${found.name}.wav`);
  }

  private downloadTake(id: string): void {
    const found = this.takes.find((t) => t.id === id);
    if (!found) return;
    downloadBlob(new Blob([found.take.wav.slice(0)], { type: 'audio/wav' }), `${found.name}.wav`);
  }

  private deleteTake(id: string): void {
    this.takes = this.takes.filter((t) => t.id !== id);
    this.renderTakes();
  }

  // ── Render ────────────────────────────────────────────────

  private render(): void {
    if (!this.backdropEl) return;
    this.backdropEl.innerHTML = `
      <div class="nmm-modal-window nmm-recorder-window" role="dialog" aria-modal="true" aria-labelledby="recorder-title" tabindex="-1">
        <header class="nmm-modal-header">
          <div class="nmm-modal-header-title">
            <span class="nmm-recorder-rec-dot" id="rec-state-dot" aria-hidden="true"></span>
            <h2 id="recorder-title">Audio Recorder</h2>
            <span class="panel-badge badge-muted" id="rec-state-badge">IDLE</span>
          </div>
          <button type="button" class="nmm-modal-close" aria-label="Close" id="btn-recorder-close">${ICONS.close}</button>
        </header>

        <div class="nmm-modal-body nmm-recorder-body">
          <div class="nmm-recorder-devicebar">
            <label class="nmm-recorder-device-label" for="rec-device">INPUT</label>
            <select id="rec-device" class="nmm-recorder-device-select" aria-label="Input device"></select>
            <button type="button" class="btn btn-xs btn-outline" id="btn-rec-refresh-devices" title="Refresh input devices">${ICONS.refresh} Rescan</button>
            <button type="button" class="btn btn-xs btn-outline" id="btn-rec-enable-mic">${ICONS.mic} Enable mic</button>
          </div>

          <div class="nmm-recorder-lcdrow">
            <div class="nmm-recorder-lcd" aria-live="polite">
              <span id="rec-lcd-time">00:00.0</span>
            </div>
            <span class="val-pill" id="rec-peak-pill">−∞ dBFS</span>
            <span class="val-pill" id="rec-class-pill">no take yet</span>
          </div>

          <div class="nmm-recorder-meters" aria-hidden="true">
            <div class="nmm-recorder-meter"><span>L</span><div class="nmm-recorder-meter-track"><div class="nmm-recorder-meter-fill" id="rec-meter-l"></div></div></div>
            <div class="nmm-recorder-meter"><span>R</span><div class="nmm-recorder-meter-track"><div class="nmm-recorder-meter-fill" id="rec-meter-r"></div></div></div>
          </div>

          <div class="nmm-recorder-transport" id="rec-transport"></div>

          <div class="nmm-recorder-takes-head">
            <span>SESSION TAKES</span>
            <span class="val-pill" id="rec-takes-count">0</span>
          </div>
          <div class="nmm-recorder-takes" id="rec-takes"></div>
        </div>
      </div>`;

    this.backdropEl.querySelector('#btn-recorder-close')?.addEventListener('click', () => void this.close());
    this.backdropEl
      .querySelector('#btn-rec-refresh-devices')
      ?.addEventListener('click', () => void this.refreshDevices());
    this.backdropEl
      .querySelector('#btn-rec-enable-mic')
      ?.addEventListener('click', () => void this.enableMic());
    this.backdropEl
      .querySelector('#rec-device')
      ?.addEventListener('change', () => void this.enableMic());

    this.renderTransport();
    this.renderTakes();
  }

  private renderTransport(): void {
    const box = this.backdropEl?.querySelector('#rec-transport');
    if (!box) return;
    box.innerHTML = `
      <button type="button" class="btn btn-danger-solid" id="btn-rec-record" title="Record / pause / resume">${ICONS.record} REC</button>
      <button type="button" class="btn btn-outline" id="btn-rec-stop" title="Stop and keep take">${ICONS.stop} Stop</button>
      <button type="button" class="btn btn-xs btn-outline" id="btn-rec-cancel" title="Discard current take">${ICONS.trash} Discard</button>`;
    box.querySelector('#btn-rec-record')?.addEventListener('click', () => void this.toggleRecord());
    box.querySelector('#btn-rec-stop')?.addEventListener('click', () => this.stopAndKeep());
    box.querySelector('#btn-rec-cancel')?.addEventListener('click', () => this.cancelAndDiscard());
    this.syncTransportState();
  }

  private renderTakes(): void {
    const list = this.backdropEl?.querySelector('#rec-takes');
    const count = this.backdropEl?.querySelector('#rec-takes-count');
    if (!list) return;
    if (count) count.textContent = String(this.takes.length);
    if (this.takes.length === 0) {
      list.innerHTML = `<div class="nmm-recorder-takes-empty">No takes yet — enable the mic and press REC.</div>`;
      return;
    }
    list.innerHTML = this.takes
      .map((t) => {
        const cls = t.take.classification === 'unknown' ? 'unclassified' : t.take.classification;
        return `
        <div class="nmm-recorder-take" data-take-id="${escHtml(t.id)}">
          <span class="nmm-recorder-take-name">${escHtml(t.name)}</span>
          <span class="val-pill font-mono">${t.take.durationSec.toFixed(2)}s · ${t.take.peakDbfs.toFixed(1)} dBFS</span>
          <span class="panel-badge badge-ai-on">${escHtml(cls)} ${(t.take.classificationConfidence * 100).toFixed(0)}%</span>
          <span class="nmm-recorder-take-actions">
            <button type="button" class="btn btn-xs btn-outline" data-act="audition" title="Audition take">${ICONS.play}</button>
            <button type="button" class="btn btn-xs btn-outline" data-act="chopper" title="Send to Audio Chopper">${ICONS.scissors}</button>
            <button type="button" class="btn btn-xs btn-outline" data-act="download" title="Download WAV">${ICONS.download}</button>
            <button type="button" class="btn btn-xs btn-outline" data-act="delete" title="Delete take">${ICONS.trash}</button>
          </span>
        </div>`;
      })
      .join('');
    list.querySelectorAll<HTMLButtonElement>('button[data-act]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const row = btn.closest('[data-take-id]');
        const id = row?.getAttribute('data-take-id');
        if (!id) return;
        const act = btn.getAttribute('data-act');
        if (act === 'audition') this.auditionTake(id);
        else if (act === 'chopper') this.sendTakeToChopper(id);
        else if (act === 'download') this.downloadTake(id);
        else if (act === 'delete') this.deleteTake(id);
      });
    });
  }

  // ── Estado vivo: medidores + LCD + badge ──────────────────

  private setBusy(busy: boolean): void {
    this.backdropEl
      ?.querySelectorAll<HTMLButtonElement>('#btn-rec-enable-mic, #btn-rec-refresh-devices')
      .forEach((b) => {
        b.disabled = busy;
      });
  }

  private syncTransportState(): void {
    if (!this.backdropEl) return;
    const state: RecorderState = this.capture.isOpen() ? this.capture.getState() : 'idle';
    const badge = this.backdropEl.querySelector('#rec-state-badge');
    if (badge) {
      badge.textContent = STATE_BADGE[state];
      badge.className = `panel-badge ${state === 'recording' ? 'badge-ai-on' : 'badge-muted'}`;
    }
    const dot = this.backdropEl.querySelector('#rec-state-dot');
    if (dot) dot.className = `nmm-recorder-rec-dot${state === 'recording' ? ' is-rec' : ''}${state === 'paused' ? ' is-paused' : ''}`;
    const recBtn = this.backdropEl.querySelector<HTMLButtonElement>('#btn-rec-record');
    if (recBtn) {
      recBtn.disabled = !this.capture.isOpen();
      recBtn.innerHTML =
        state === 'recording'
          ? `${ICONS.pause} PAUSE`
          : state === 'paused'
            ? `${ICONS.play} RESUME`
            : `${ICONS.record} REC`;
    }
    const stopBtn = this.backdropEl.querySelector<HTMLButtonElement>('#btn-rec-stop');
    if (stopBtn) stopBtn.disabled = state !== 'recording' && state !== 'paused';
    const cancelBtn = this.backdropEl.querySelector<HTMLButtonElement>('#btn-rec-cancel');
    if (cancelBtn) cancelBtn.disabled = state !== 'recording' && state !== 'paused';
  }

  private startMeterLoop(): void {
    const tick = () => {
      if (!this.backdropEl) return;
      if (this.capture.isOpen()) {
        void this.capture.open().then((engine) => {
          if (!this.backdropEl) return;
          const levels = engine.getLevels();
          const l = this.backdropEl.querySelector<HTMLElement>('#rec-meter-l');
          const r = this.backdropEl.querySelector<HTMLElement>('#rec-meter-r');
          if (l) l.style.width = `${Math.min(100, Math.max(0, levels.peakLeft * 100)).toFixed(1)}%`;
          if (r) r.style.width = `${Math.min(100, Math.max(0, levels.peakRight * 100)).toFixed(1)}%`;
          const time = this.backdropEl.querySelector('#rec-lcd-time');
          if (time) time.textContent = formatTakeTime(engine.getRecordedSec());
          const peak = this.backdropEl.querySelector('#rec-peak-pill');
          if (peak) {
            peak.textContent =
              levels.peakDbfs === -Infinity ? '−∞ dBFS' : `${levels.peakDbfs.toFixed(1)} dBFS`;
          }
          this.syncTransportState();
        });
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }
}
