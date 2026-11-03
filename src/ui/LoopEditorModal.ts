// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Waveform AutoLoop Editor & Seam Magnifier Modal
//
// Interactive high-precision loop editor dialog with zero-crossing
// snapping, splice seam magnification (step/slope continuity),
// crossfade calculation, auto-loop algorithms (F0, NCC, Seam Energy),
// zoomable waveform viewport, and live Web Audio auditioning.
// ─────────────────────────────────────────────────────────

import { ICONS } from './icons.ts';
import { escHtml } from './escape.ts';
import { toast } from './notify.ts';
import { clamp } from '../core/dsp/DspMath.ts';
import { createModalFocusTrap, type FocusTrap } from './modalFocusTrap.ts';
import type { AutoLoopAlgorithm, LoopMode, ZoneLoopEditorData } from '../core/types.ts';
import {
  computeLoopSeamAnalysis,
  computeZoomedWaveformEnvelope,
  findSmartAutoLoop,
  snapFrameToRisingZeroCrossing,
} from '../core/dsp/LoopEditorTools.ts';
import { decodeWav, transcodeAnyAudioToWavBuffer } from '../core/dsp/WavDecoder.ts';

export interface LoopEditorModalContext {
  getLoopEditorData: (zoneId?: string, regionId?: string) => ZoneLoopEditorData | null;
  onUpdateLoopParams: (changes: {
    zoneId?: string;
    regionId?: string;
    loopMode?: LoopMode;
    loopStart?: number;
    loopEnd?: number;
    loopCrossfadeMs?: number;
  }) => Promise<void> | void;
  onAuditionLoop?: (opts: {
    zoneId?: string;
    regionId?: string;
    loopStartFrame?: number;
    loopEndFrame?: number;
    loopEnabled?: boolean;
  }) => void;
  onStopAudition?: () => void;
  onUpdateLiveLoopPoints?: (
    startFrame: number,
    endFrame: number,
    sampleRate: number,
    loopEnabled: boolean
  ) => void;
  onRegisterSampleBuffer?: (name: string, buffer: ArrayBuffer) => void;
  isAuditionPlaying?: () => boolean;
}

function resolveThemeToken(varName: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const val = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return val || fallback;
}

export class LoopEditorModal {
  private backdropEl: HTMLElement | null = null;
  private focusTrap: FocusTrap | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private context: LoopEditorModalContext;

  private currentZoneId?: string;
  private currentRegionId?: string;
  private loopData: ZoneLoopEditorData | null = null;

  // Viewport & zoom state
  private zoomFactor: number = 1.0;
  private viewCenterNorm: number = 0.5;
  private snapZeroCrossing: boolean = true;
  private selectedAlgo: AutoLoopAlgorithm = 'pitch_periodic';
  private draggingHandle: 'start' | 'end' | null = null;

  constructor(context: LoopEditorModalContext) {
    this.context = context;
  }

  public open(target?: { zoneId?: string; regionId?: string }): void {
    if (this.backdropEl) return;

    this.currentZoneId = target?.zoneId;
    this.currentRegionId = target?.regionId;
    this.zoomFactor = 1.0;
    this.viewCenterNorm = 0.5;
    this.draggingHandle = null;

    const data = this.context.getLoopEditorData(this.currentZoneId, this.currentRegionId);
    if (data && data.monoPcm && data.monoPcm.length > 0) {
      this.loopData = { ...data };
    } else {
      this.loopData = null;
    }

    this.render();
  }

  public close(): void {
    this.context.onStopAudition?.();
    if (this.focusTrap) {
      this.focusTrap.deactivate();
      this.focusTrap = null;
    }
    if (this.backdropEl) {
      this.backdropEl.remove();
      this.backdropEl = null;
    }
    this.canvas = null;
  }

  public isOpen(): boolean {
    return Boolean(this.backdropEl);
  }

  public async loadAudioFile(file: File): Promise<void> {
    try {
      const rawBuf = await file.arrayBuffer();
      const wavBuf = await transcodeAnyAudioToWavBuffer(rawBuf, file.name);
      const decoded = decodeWav(wavBuf);
      const pcm = decoded.mono;
      const sr = decoded.sampleRate;
      const totalFrames = pcm.length;

      this.context.onRegisterSampleBuffer?.(file.name, wavBuf);

      const inst = decoded.instrument;
      const hasEmbeddedLoop =
        inst &&
        inst.loopStart !== undefined &&
        inst.loopEnd !== undefined &&
        inst.loopEnd > inst.loopStart;

      this.loopData = {
        zoneId: this.currentZoneId ?? 'custom',
        sampleName: file.name,
        sampleRate: sr,
        totalFrames,
        numChannels: decoded.numChannels,
        durationSec: totalFrames / sr,
        monoPcm: pcm,
        loopStart: hasEmbeddedLoop ? inst.loopStart! : Math.floor(totalFrames * 0.2),
        loopEnd: hasEmbeddedLoop
          ? inst.loopEnd!
          : Math.max(Math.floor(totalFrames * 0.2) + 64, Math.floor(totalFrames * 0.85)),
        loopCrossfadeMs: 20,
        loopMode: hasEmbeddedLoop && inst.loopMode ? inst.loopMode : 'loop_continuous',
        rootKey: inst?.rootKey ?? 60,
      };

      this.zoomFactor = 1.0;
      this.viewCenterNorm = 0.5;
      this.render();
      toast(`Loaded "${file.name}" into AutoLoop Editor (${(totalFrames / sr).toFixed(2)}s)`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`Failed to load audio: ${msg}`, 'error');
    }
  }

  public loadDemoSustainedLoop(): void {
    const sr = 44100;
    const durSec = 3.0;
    const totalFrames = Math.round(sr * durSec);
    const pcm = new Float32Array(totalFrames);

    // Synthesize a rich harmonic cello/organ tone with natural micro-vibrato
    const f0 = 220.0; // A3
    for (let i = 0; i < totalFrames; i++) {
      const t = i / sr;
      const vib = Math.sin(2 * Math.PI * 4.8 * t) * 1.5;
      const freq = f0 + vib;
      const env = Math.min(1.0, t / 0.15) * Math.min(1.0, (durSec - t) / 0.25);

      const h1 = Math.sin(2 * Math.PI * freq * t) * 0.55;
      const h2 = Math.sin(2 * Math.PI * freq * 2 * t) * 0.28;
      const h3 = Math.sin(2 * Math.PI * freq * 3 * t) * 0.16;
      const h4 = Math.sin(2 * Math.PI * freq * 4 * t) * 0.08;
      const h5 = Math.sin(2 * Math.PI * freq * 5 * t) * 0.04;

      pcm[i] = (h1 + h2 + h3 + h4 + h5) * env;
    }

    this.loopData = {
      zoneId: this.currentZoneId ?? 'demo',
      sampleName: 'DemoSustainedCello.wav',
      sampleRate: sr,
      totalFrames,
      numChannels: 1,
      durationSec: durSec,
      monoPcm: pcm,
      loopStart: Math.floor(totalFrames * 0.25),
      loopEnd: Math.floor(totalFrames * 0.8),
      loopCrossfadeMs: 25,
      loopMode: 'loop_continuous',
      rootKey: 57,
    };

    this.zoomFactor = 1.0;
    this.viewCenterNorm = 0.5;
    this.render();
    toast('Loaded 3-second harmonic sustained test tone into AutoLoop Editor.', 'info');
  }

  private render(): void {
    if (!this.backdropEl) {
      this.backdropEl = document.createElement('div');
      this.backdropEl.className = 'nmm-modal-backdrop nmm-loop-backdrop';
      document.body.appendChild(this.backdropEl);

      this.backdropEl.addEventListener('click', (e) => {
        if (e.target === this.backdropEl) this.close();
      });
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.backdropEl) this.close();
      });
    }

    const d = this.loopData;
    const hasAudio = Boolean(d && d.monoPcm && d.monoPcm.length > 0);

    let formatBadge = 'No Sample Loaded';
    if (d && hasAudio) {
      const sec = (d.totalFrames / d.sampleRate).toFixed(2);
      formatBadge = `${d.sampleName || 'Sample'} • ${(d.sampleRate / 1000).toFixed(1)} kHz • ${sec}s`;
    }

    const seamAnalysis = hasAudio && d ? computeLoopSeamAnalysis(d.monoPcm, d.loopStart, d.loopEnd, 128) : null;
    const seamScore = seamAnalysis ? seamAnalysis.seamQualityPercent.toFixed(0) : '0';

    this.backdropEl.innerHTML = `
      <div class="nmm-modal-window nmm-loop-window" role="dialog" aria-modal="true" aria-labelledby="loop-modal-title">
        <header class="nmm-modal-header">
          <div class="nmm-modal-header-title">
            <span class="nmm-modal-header-icon">${ICONS.wave}</span>
            <h2 id="loop-modal-title">Waveform AutoLoop Editor &amp; Zero-Crossing Seam Magnifier</h2>
            <span class="panel-badge ${hasAudio ? 'badge-ai-on' : 'badge-muted'}">
              ${escHtml(formatBadge)}
            </span>
          </div>
          <button type="button" class="nmm-modal-close" aria-label="Close" id="btn-loop-modal-close">
            ${ICONS.close || '✕'}
          </button>
        </header>

        <div class="nmm-modal-body nmm-loop-body">
          <input type="file" id="inp-loop-file-picker" accept=".wav,.aif,.aiff,.aifc,.flac,.mp3,.ogg,.oga,.m4a,.aac,.opus,.webm,.caf,.ncw,audio/*" class="is-hidden-file" />

          ${
            !hasAudio
              ? `
            <!-- Unified Empty State / Dropzone -->
            <div class="audio-empty-dropzone" id="loop-empty-dropzone">
              <div class="dropzone-icon-ring">
                <span class="dropzone-icon">${ICONS.wave}</span>
              </div>
              <h3 class="dropzone-title">NO AUDIO SAMPLE LOADED IN AUTOLOOP EDITOR</h3>
              <p class="dropzone-subtitle">
                Drag &amp; drop an audio sample here (.wav, .aif, .flac) or load demo audio to test seamless loop detection and zero-crossing alignment.
              </p>
              <div class="dropzone-actions">
                <button type="button" class="btn btn-primary" id="btn-loop-browse-file">
                  ${ICONS.folder} Browse Audio File...
                </button>
                <button type="button" class="btn btn-outline" id="btn-loop-demo-audio">
                  ${ICONS.wave} Load Demo Sustained Loop
                </button>
              </div>
              <div class="dropzone-hint">
                AutoLoop analyzes pitch periodicity, cross-correlation (NCC), and zero-crossing seams to eliminate clicks during sustained playback.
              </div>
            </div>
          `
              : `
            <!-- Waveform Viewport Panel -->
            <div class="loop-viewport-panel">
              <div class="loop-viewport-toolbar">
                <div class="loop-zoom-group">
                  <span class="toolbar-label">ZOOM:</span>
                  <button type="button" class="btn btn-xs btn-outline" id="btn-loop-zoom-out" title="Zoom Out Waveform">-</button>
                  <span class="val-pill" id="lbl-loop-zoom">${this.zoomFactor.toFixed(1)}x</span>
                  <button type="button" class="btn btn-xs btn-outline" id="btn-loop-zoom-in" title="Zoom In Waveform">+</button>
                  <button type="button" class="btn btn-xs btn-outline" id="btn-loop-zoom-fit" title="Fit Entire Waveform">Fit</button>
                </div>
                <div class="loop-toolbar-right">
                  <span class="loop-seam-quality-badge" id="badge-seam-score" title="Click-free splice continuity score">
                    Seam Match: <strong>${seamScore}%</strong>
                  </span>
                  <button type="button" class="btn btn-xs btn-outline" id="btn-loop-change-file" title="Open another audio file">
                    ${ICONS.folder} Replace File...
                  </button>
                </div>
              </div>

              <div class="loop-canvas-wrapper" id="loop-canvas-wrapper">
                <canvas id="loop-editor-canvas" height="160"></canvas>
              </div>

              <div class="loop-canvas-legend">
                <span>Drag <strong>L-START</strong> (Green) or <strong>L-END</strong> (Cyan) markers</span>
                <span>• Shaded amber = Crossfade</span>
                <span>• Right pane = Zero-Crossing Seam Magnifier (&plusmn;64 smp)</span>
              </div>
            </div>

            <!-- Parameters Card -->
            <div class="loop-controls-card">
              <div class="loop-controls-grid">
                <!-- 1. Loop Mode -->
                <div class="form-group">
                  <label for="sel-loop-modal-mode">LOOP MODE</label>
                  <select id="sel-loop-modal-mode" class="form-control">
                    <option value="no_loop" ${d?.loopMode === 'no_loop' ? 'selected' : ''}>One-Shot (No Loop)</option>
                    <option value="loop_continuous" ${d?.loopMode === 'loop_continuous' ? 'selected' : ''}>Continuous Forward Loop</option>
                    <option value="ping_pong" ${d?.loopMode === 'ping_pong' ? 'selected' : ''}>Ping-Pong (⇄ Alternate)</option>
                    <option value="loop_sustain" ${d?.loopMode === 'loop_sustain' ? 'selected' : ''}>Sustain Loop</option>
                  </select>
                </div>

                <!-- 2. Loop Start -->
                <div class="form-group">
                  <div class="label-with-val">
                    <label for="inp-loop-modal-start">LOOP START (FRAMES)</label>
                    <span class="val-pill" id="lbl-loop-start-sec">${((d?.loopStart ?? 0) / (d?.sampleRate ?? 44100)).toFixed(3)}s</span>
                  </div>
                  <input type="number" id="inp-loop-modal-start" class="form-control font-mono" min="0" max="${Math.max(0, (d?.totalFrames ?? 1) - 2)}" value="${d?.loopStart ?? 0}" />
                </div>

                <!-- 3. Loop End -->
                <div class="form-group">
                  <div class="label-with-val">
                    <label for="inp-loop-modal-end">LOOP END (FRAMES)</label>
                    <span class="val-pill" id="lbl-loop-end-sec">${((d?.loopEnd ?? 0) / (d?.sampleRate ?? 44100)).toFixed(3)}s</span>
                  </div>
                  <input type="number" id="inp-loop-modal-end" class="form-control font-mono" min="1" max="${d?.totalFrames ?? 1}" value="${d?.loopEnd ?? 1}" />
                </div>

                <!-- 4. Crossfade Duration -->
                <div class="form-group">
                  <div class="label-with-val">
                    <label for="inp-loop-modal-xfade">CROSSFADE (MS)</label>
                    <span class="val-pill" id="lbl-loop-xfade-val">${d?.loopCrossfadeMs ?? 20} ms</span>
                  </div>
                  <input type="range" id="inp-loop-modal-xfade" class="form-range" min="0" max="500" value="${d?.loopCrossfadeMs ?? 20}" />
                </div>
              </div>

              <!-- Action Bar -->
              <div class="loop-action-bar">
                <div class="loop-action-bar-left">
                  <button type="button" class="btn btn-sm ${this.snapZeroCrossing ? 'btn-accent' : 'btn-outline'}" id="btn-loop-toggle-snap" title="Snap dragged markers to rising zero-crossings">
                    0-X Snap: ${this.snapZeroCrossing ? 'ON' : 'OFF'}
                  </button>

                  <div class="loop-algo-group">
                    <label for="sel-loop-algo-picker">ALGORITHM:</label>
                    <select id="sel-loop-algo-picker" class="form-control form-control-sm">
                      <option value="pitch_periodic" ${this.selectedAlgo === 'pitch_periodic' ? 'selected' : ''}>F0 Period-Lock (Autocorr)</option>
                      <option value="ncc_zc" ${this.selectedAlgo === 'ncc_zc' ? 'selected' : ''}>Normalized Cross-Correlation (NCC)</option>
                      <option value="min_seam_energy" ${this.selectedAlgo === 'min_seam_energy' ? 'selected' : ''}>Minimum Seam Discontinuity</option>
                      <option value="equal_power_xfade" ${this.selectedAlgo === 'equal_power_xfade' ? 'selected' : ''}>Equal-Power Crossfade</option>
                    </select>
                    <button type="button" class="btn btn-sm btn-primary" id="btn-loop-run-autofind" title="Automatically find optimal click-free loop points">
                      ${ICONS.cpu} Run Auto-Loop
                    </button>
                  </div>
                </div>

                <div class="loop-action-bar-right">
                  <button type="button" class="btn btn-sm btn-accent" id="btn-loop-audition-play" title="Audition sample in continuous hardware loop">
                    ${this.context.isAuditionPlaying?.() ? `■ Stop Audition` : `${ICONS.play} Play Loop`}
                  </button>
                </div>
              </div>
            </div>
          `
          }
        </div>

        <footer class="nmm-modal-footer">
          <div class="footer-left">
            <button type="button" class="btn btn-ghost" id="btn-loop-modal-discard">Discard &amp; Close</button>
          </div>
          <div class="footer-right">
            ${
              hasAudio
                ? `<button type="button" class="btn btn-primary" id="btn-loop-modal-apply">
                    ${ICONS.check} Apply Loop Points
                  </button>`
                : ''
            }
          </div>
        </footer>
      </div>
    `;

    if (!this.focusTrap && this.backdropEl) {
      this.focusTrap = createModalFocusTrap(this.backdropEl, {
        onEscape: () => this.close(),
        initialFocusSelector: '#btn-loop-modal-close',
      });
      this.focusTrap.activate();
    }

    this.bindEvents();
    if (hasAudio) {
      requestAnimationFrame(() => this.drawCanvas());
    }
  }

  private bindEvents(): void {
    if (!this.backdropEl) return;

    this.backdropEl.querySelector('#btn-loop-modal-close')?.addEventListener('click', () => this.close());
    this.backdropEl.querySelector('#btn-loop-modal-discard')?.addEventListener('click', () => this.close());

    // File input picker
    const filePicker = this.backdropEl.querySelector<HTMLInputElement>('#inp-loop-file-picker');
    filePicker?.addEventListener('change', () => {
      const file = filePicker.files?.[0];
      if (file) void this.loadAudioFile(file);
    });

    const triggerFilePicker = () => filePicker?.click();
    this.backdropEl.querySelector('#btn-loop-browse-file')?.addEventListener('click', triggerFilePicker);
    this.backdropEl.querySelector('#btn-loop-change-file')?.addEventListener('click', triggerFilePicker);

    // Demo audio button
    this.backdropEl.querySelector('#btn-loop-demo-audio')?.addEventListener('click', () => this.loadDemoSustainedLoop());

    // Drag and drop onto empty dropzone
    const dropzone = this.backdropEl.querySelector<HTMLElement>('#loop-empty-dropzone');
    if (dropzone) {
      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('is-dragover');
      });
      dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('is-dragover');
      });
      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('is-dragover');
        const file = e.dataTransfer?.files?.[0];
        if (file) void this.loadAudioFile(file);
      });
    }

    const d = this.loopData;
    if (!d) return;

    // Zoom controls
    this.backdropEl.querySelector('#btn-loop-zoom-in')?.addEventListener('click', () => {
      this.zoomFactor = Math.min(32, this.zoomFactor * 2);
      this.drawCanvas();
      const lbl = this.backdropEl?.querySelector('#lbl-loop-zoom');
      if (lbl) lbl.textContent = `${this.zoomFactor.toFixed(1)}x`;
    });

    this.backdropEl.querySelector('#btn-loop-zoom-out')?.addEventListener('click', () => {
      this.zoomFactor = Math.max(1, this.zoomFactor / 2);
      this.drawCanvas();
      const lbl = this.backdropEl?.querySelector('#lbl-loop-zoom');
      if (lbl) lbl.textContent = `${this.zoomFactor.toFixed(1)}x`;
    });

    this.backdropEl.querySelector('#btn-loop-zoom-fit')?.addEventListener('click', () => {
      this.zoomFactor = 1.0;
      this.viewCenterNorm = 0.5;
      this.drawCanvas();
      const lbl = this.backdropEl?.querySelector('#lbl-loop-zoom');
      if (lbl) lbl.textContent = `1.0x`;
    });

    // Loop Mode
    const selMode = this.backdropEl.querySelector<HTMLSelectElement>('#sel-loop-modal-mode');
    selMode?.addEventListener('change', () => {
      d.loopMode = selMode.value as LoopMode;
      this.notifyLiveUpdate();
    });

    // Loop Start / End inputs
    const inpStart = this.backdropEl.querySelector<HTMLInputElement>('#inp-loop-modal-start');
    const inpEnd = this.backdropEl.querySelector<HTMLInputElement>('#inp-loop-modal-end');
    const lblStartSec = this.backdropEl.querySelector<HTMLElement>('#lbl-loop-start-sec');
    const lblEndSec = this.backdropEl.querySelector<HTMLElement>('#lbl-loop-end-sec');

    inpStart?.addEventListener('input', () => {
      const v = clamp(parseInt(inpStart.value, 10) || 0, 0, Math.max(0, d.loopEnd - 16));
      d.loopStart = v;
      if (lblStartSec) lblStartSec.textContent = `${(v / d.sampleRate).toFixed(3)}s`;
      this.notifyLiveUpdate();
      this.drawCanvas();
    });

    inpEnd?.addEventListener('input', () => {
      const v = clamp(parseInt(inpEnd.value, 10) || 1, d.loopStart + 16, d.totalFrames);
      d.loopEnd = v;
      if (lblEndSec) lblEndSec.textContent = `${(v / d.sampleRate).toFixed(3)}s`;
      this.notifyLiveUpdate();
      this.drawCanvas();
    });

    // Crossfade slider
    const inpXfade = this.backdropEl.querySelector<HTMLInputElement>('#inp-loop-modal-xfade');
    const lblXfade = this.backdropEl.querySelector<HTMLElement>('#lbl-loop-xfade-val');
    inpXfade?.addEventListener('input', () => {
      const v = clamp(parseInt(inpXfade.value, 10) || 0, 0, 500);
      d.loopCrossfadeMs = v;
      if (lblXfade) lblXfade.textContent = `${v} ms`;
      this.drawCanvas();
    });

    // 0-X Snap toggle
    const btnSnap = this.backdropEl.querySelector<HTMLButtonElement>('#btn-loop-toggle-snap');
    btnSnap?.addEventListener('click', () => {
      this.snapZeroCrossing = !this.snapZeroCrossing;
      if (btnSnap) {
        btnSnap.textContent = `0-X Snap: ${this.snapZeroCrossing ? 'ON' : 'OFF'}`;
        btnSnap.className = `btn btn-sm ${this.snapZeroCrossing ? 'btn-accent' : 'btn-outline'}`;
      }
    });

    // Algorithm selector
    const selAlgo = this.backdropEl.querySelector<HTMLSelectElement>('#sel-loop-algo-picker');
    selAlgo?.addEventListener('change', () => {
      if (selAlgo) this.selectedAlgo = selAlgo.value as AutoLoopAlgorithm;
    });

    // Run Auto-Loop button
    this.backdropEl.querySelector('#btn-loop-run-autofind')?.addEventListener('click', () => {
      const candStart = d.loopStart > 0 ? d.loopStart : Math.floor(d.totalFrames * 0.2);
      const candEnd = d.loopEnd > candStart + 64 ? d.loopEnd : Math.floor(d.totalFrames * 0.85);
      const knownF0 = d.rootKey ? 440 * Math.pow(2, (d.rootKey - 69) / 12) : undefined;

      const res = findSmartAutoLoop(d.monoPcm, d.sampleRate, {
        algorithm: this.selectedAlgo,
        candidateStartFrame: candStart,
        candidateEndFrame: candEnd,
        knownF0Hz: knownF0,
        targetCrossfadeMs: d.loopCrossfadeMs > 0 ? d.loopCrossfadeMs : 20,
      });

      d.loopStart = res.loopStart;
      d.loopEnd = res.loopEnd;
      d.loopCrossfadeMs = res.loopCrossfadeMs;
      if (d.loopMode === 'no_loop') d.loopMode = 'loop_continuous';

      this.render();
      toast(`Auto-Loop identified optimal loop bounds via ${this.selectedAlgo}`, 'success');
      this.notifyLiveUpdate();
    });

    // Play/Stop Audition button
    const btnPlay = this.backdropEl.querySelector<HTMLButtonElement>('#btn-loop-audition-play');
    btnPlay?.addEventListener('click', () => {
      const isPlaying = Boolean(this.context.isAuditionPlaying?.());
      if (isPlaying) {
        this.context.onStopAudition?.();
        if (btnPlay) btnPlay.innerHTML = `${ICONS.play} Play Loop`;
      } else {
        if (d.loopMode === 'no_loop') d.loopMode = 'loop_continuous';
        this.context.onAuditionLoop?.({
          zoneId: this.currentZoneId,
          regionId: this.currentRegionId,
          loopStartFrame: d.loopStart,
          loopEndFrame: d.loopEnd,
          loopEnabled: true,
        });
        if (btnPlay) btnPlay.innerHTML = `■ Stop Audition`;
      }
    });

    // Apply Button
    this.backdropEl.querySelector('#btn-loop-modal-apply')?.addEventListener('click', async () => {
      await this.context.onUpdateLoopParams({
        zoneId: this.currentZoneId,
        regionId: this.currentRegionId,
        loopMode: d.loopMode,
        loopStart: d.loopStart,
        loopEnd: d.loopEnd,
        loopCrossfadeMs: d.loopCrossfadeMs,
      });
      toast(`Applied loop points (${d.loopStart} .. ${d.loopEnd}) to zone.`, 'success');
      this.close();
    });

    // Canvas interaction
    this.canvas = this.backdropEl.querySelector<HTMLCanvasElement>('#loop-editor-canvas');
    if (this.canvas) {
      this.bindCanvasEvents(this.canvas);
    }
  }

  private notifyLiveUpdate(): void {
    if (!this.loopData) return;
    const d = this.loopData;
    this.context.onUpdateLiveLoopPoints?.(
      d.loopStart,
      d.loopEnd,
      d.sampleRate,
      d.loopMode !== 'no_loop'
    );
  }

  private bindCanvasEvents(canvas: HTMLCanvasElement): void {
    const d = this.loopData;
    if (!d) return;

    const getMetrics = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const waveW = rect.width * 0.72;
      const relX = clientX - rect.left;
      const relY = clientY - rect.top;
      const normX = clamp(relX / Math.max(1, waveW), 0, 1);
      return { rect, waveW, relX, relY, normX };
    };

    canvas.addEventListener('pointerdown', (e) => {
      const { waveW, relX } = getMetrics(e.clientX, e.clientY);
      if (relX > waveW) return; // Inside Seam Magnifier pane

      const { viewStart, viewEnd } = this.getViewWindow();
      const viewSpan = Math.max(1, viewEnd - viewStart);
      const startX = ((d.loopStart - viewStart) / viewSpan) * waveW;
      const endX = ((d.loopEnd - viewStart) / viewSpan) * waveW;

      const hitDistStart = Math.abs(relX - startX);
      const hitDistEnd = Math.abs(relX - endX);

      if (hitDistStart < 16 && hitDistStart <= hitDistEnd) {
        this.draggingHandle = 'start';
        canvas.setPointerCapture(e.pointerId);
      } else if (hitDistEnd < 16) {
        this.draggingHandle = 'end';
        canvas.setPointerCapture(e.pointerId);
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!this.draggingHandle) return;
      const { waveW, relX } = getMetrics(e.clientX, e.clientY);
      const { viewStart, viewEnd } = this.getViewWindow();
      const viewSpan = Math.max(1, viewEnd - viewStart);
      const targetFrame = viewStart + (clamp(relX, 0, waveW) / waveW) * viewSpan;

      const minGap = Math.max(16, Math.round(d.sampleRate * 0.005));
      if (this.draggingHandle === 'start') {
        let f = clamp(Math.round(targetFrame), 0, Math.max(0, d.loopEnd - minGap));
        if (this.snapZeroCrossing) {
          f = clamp(snapFrameToRisingZeroCrossing(d.monoPcm, f, 256), 0, Math.max(0, d.loopEnd - minGap));
        }
        d.loopStart = f;
      } else if (this.draggingHandle === 'end') {
        let f = clamp(Math.round(targetFrame), d.loopStart + minGap, d.totalFrames);
        if (this.snapZeroCrossing) {
          f = clamp(snapFrameToRisingZeroCrossing(d.monoPcm, f, 256), d.loopStart + minGap, d.totalFrames);
        }
        d.loopEnd = f;
      }

      this.syncInputs();
      this.notifyLiveUpdate();
      this.drawCanvas();
    });

    const finishDrag = (e: PointerEvent) => {
      if (this.draggingHandle) {
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }
        this.draggingHandle = null;
      }
    };

    canvas.addEventListener('pointerup', finishDrag);
    canvas.addEventListener('pointercancel', finishDrag);

    // Double-click to set marker
    canvas.addEventListener('dblclick', (e) => {
      const { waveW, relX } = getMetrics(e.clientX, e.clientY);
      if (relX > waveW) return;
      const { viewStart, viewEnd } = this.getViewWindow();
      const viewSpan = Math.max(1, viewEnd - viewStart);
      let targetFrame = Math.round(viewStart + (relX / waveW) * viewSpan);
      if (this.snapZeroCrossing) {
        targetFrame = snapFrameToRisingZeroCrossing(d.monoPcm, targetFrame, 256);
      }

      const distStart = Math.abs(targetFrame - d.loopStart);
      const distEnd = Math.abs(targetFrame - d.loopEnd);
      if (distStart < distEnd) {
        d.loopStart = clamp(targetFrame, 0, d.loopEnd - 16);
      } else {
        d.loopEnd = clamp(targetFrame, d.loopStart + 16, d.totalFrames);
      }

      this.syncInputs();
      this.notifyLiveUpdate();
      this.drawCanvas();
    });

    // Wheel zoom
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const { normX } = getMetrics(e.clientX, e.clientY);
        const { viewStart, viewEnd } = this.getViewWindow();
        const focusFrame = viewStart + normX * (viewEnd - viewStart);
        this.viewCenterNorm = clamp(focusFrame / Math.max(1, d.totalFrames), 0, 1);
        const factor = e.deltaY < 0 ? 1.35 : 1 / 1.35;
        this.zoomFactor = clamp(this.zoomFactor * factor, 1, 32);
        this.drawCanvas();

        const lbl = this.backdropEl?.querySelector('#lbl-loop-zoom');
        if (lbl) lbl.textContent = `${this.zoomFactor.toFixed(1)}x`;
      },
      { passive: false }
    );
  }

  private syncInputs(): void {
    if (!this.backdropEl || !this.loopData) return;
    const d = this.loopData;
    const inpStart = this.backdropEl.querySelector<HTMLInputElement>('#inp-loop-modal-start');
    const inpEnd = this.backdropEl.querySelector<HTMLInputElement>('#inp-loop-modal-end');
    const lblStartSec = this.backdropEl.querySelector<HTMLElement>('#lbl-loop-start-sec');
    const lblEndSec = this.backdropEl.querySelector<HTMLElement>('#lbl-loop-end-sec');

    if (inpStart) inpStart.value = String(d.loopStart);
    if (inpEnd) inpEnd.value = String(d.loopEnd);
    if (lblStartSec) lblStartSec.textContent = `${(d.loopStart / d.sampleRate).toFixed(3)}s`;
    if (lblEndSec) lblEndSec.textContent = `${(d.loopEnd / d.sampleRate).toFixed(3)}s`;
  }

  private getViewWindow(): { viewStart: number; viewEnd: number } {
    const d = this.loopData;
    if (!d) return { viewStart: 0, viewEnd: 0 };
    const zoom = clamp(this.zoomFactor, 1, 32);
    const span = Math.max(64, Math.round(d.totalFrames / zoom));
    const half = Math.floor(span * 0.5);
    const center = Math.round(clamp(this.viewCenterNorm, 0, 1) * d.totalFrames);
    const viewStart = clamp(center - half, 0, Math.max(0, d.totalFrames - span));
    const viewEnd = clamp(viewStart + span, viewStart + 1, d.totalFrames);
    return { viewStart, viewEnd };
  }

  private drawCanvas(): void {
    if (!this.canvas || !this.loopData) return;
    const d = this.loopData;
    const canvas = this.canvas;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    ctx.clearRect(0, 0, width, height);

    const waveW = Math.floor(width * 0.72);
    const seamX0 = waveW + 1;
    const seamW = Math.max(80, width - seamX0);

    const accentColor = resolveThemeToken('--color-accent', 'currentColor');
    const warningColor = resolveThemeToken('--color-warning', 'currentColor');
    const successColor = resolveThemeToken('--color-success', accentColor);
    const dangerColor = resolveThemeToken('--color-danger', warningColor);
    const dimGridColor = resolveThemeToken('--color-panel-border-dim', 'currentColor');
    const borderColor = resolveThemeToken('--color-panel-border', 'currentColor');
    const textColor = resolveThemeToken('--color-text-muted', 'currentColor');
    const elevatedBg = resolveThemeToken('--color-panel-surface-elevated', 'transparent');

    const { viewStart, viewEnd } = this.getViewWindow();
    const viewSpan = Math.max(1, viewEnd - viewStart);
    const env = computeZoomedWaveformEnvelope(d.monoPcm, viewStart, viewEnd, Math.min(480, Math.max(120, Math.floor(waveW / 2))));

    const centerY = height * 0.5;
    const ampSpan = height * 0.38;

    // Center zero line
    ctx.strokeStyle = dimGridColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(waveW, centerY);
    ctx.stroke();

    // Shaded loop region
    const loopStartX = clamp(((d.loopStart - viewStart) / viewSpan) * waveW, 0, waveW);
    const loopEndX = clamp(((d.loopEnd - viewStart) / viewSpan) * waveW, 0, waveW);
    if (loopEndX > loopStartX) {
      ctx.fillStyle = accentColor;
      ctx.globalAlpha = 0.12;
      ctx.fillRect(loopStartX, 0, loopEndX - loopStartX, height);
      ctx.globalAlpha = 1.0;

      // Crossfade area
      const xfadeFrames = Math.round((d.loopCrossfadeMs / 1000) * d.sampleRate);
      if (xfadeFrames > 0) {
        const xfadeStartX = clamp(((d.loopEnd - xfadeFrames - viewStart) / viewSpan) * waveW, loopStartX, loopEndX);
        if (loopEndX > xfadeStartX + 1) {
          ctx.fillStyle = warningColor;
          ctx.globalAlpha = 0.2;
          ctx.fillRect(xfadeStartX, 0, loopEndX - xfadeStartX, height);
          ctx.globalAlpha = 1.0;
        }
      }
    }

    // Waveform envelope
    ctx.fillStyle = accentColor;
    ctx.beginPath();
    const colCount = env.max.length;
    for (let i = 0; i < colCount; i++) {
      const x = (i / Math.max(1, colCount - 1)) * waveW;
      const topY = centerY - (env.max[i] ?? 0) * ampSpan;
      const botY = centerY - (env.min[i] ?? 0) * ampSpan;
      ctx.fillRect(x, topY, Math.max(1, waveW / colCount), Math.max(1, botY - topY));
    }

    // Marker L-START (Success token)
    ctx.strokeStyle = successColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(loopStartX, 0);
    ctx.lineTo(loopStartX, height);
    ctx.stroke();

    ctx.fillStyle = successColor;
    ctx.font = 'bold 10px monospace';
    ctx.fillText('L-START', Math.min(waveW - 48, loopStartX + 4), 14);

    // Marker L-END (Accent token)
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(loopEndX, 0);
    ctx.lineTo(loopEndX, height);
    ctx.stroke();

    ctx.fillStyle = accentColor;
    ctx.font = 'bold 10px monospace';
    ctx.fillText('L-END', Math.max(4, loopEndX - 40), 14);

    // Divider for Seam Magnifier
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(seamX0, 0);
    ctx.lineTo(seamX0, height);
    ctx.stroke();

    // ─────────────────────────────────────────────────────────
    // Seam Magnifier (Right 28%)
    // ─────────────────────────────────────────────────────────
    const seam = computeLoopSeamAnalysis(d.monoPcm, d.loopStart, d.loopEnd, 64);
    const w = seam.windowFrames;
    const seamCenterY = centerY;
    const seamAmp = height * 0.35;

    ctx.fillStyle = elevatedBg;
    ctx.fillRect(seamX0, 0, seamW, height);

    ctx.strokeStyle = dimGridColor;
    ctx.beginPath();
    ctx.moveTo(seamX0, seamCenterY);
    ctx.lineTo(width, seamCenterY);
    ctx.stroke();

    // Splice Line
    const seamMidX = seamX0 + seamW * 0.5;
    ctx.strokeStyle = warningColor;
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.moveTo(seamMidX, 0);
    ctx.lineTo(seamMidX, height);
    ctx.stroke();
    ctx.setLineDash([]);

    // Curve A: Pre-End approaching seam from left
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < w; i++) {
      const x = seamX0 + (i / w) * (seamMidX - seamX0);
      const y = seamCenterY - seam.preEndSamples[i] * seamAmp;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Curve B: Post-Start continuing from seam to right
    ctx.strokeStyle = successColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < w; i++) {
      const x = seamMidX + (i / w) * (width - seamMidX);
      const y = seamCenterY - seam.postStartSamples[i] * seamAmp;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Overlay Header & Score in Seam Magnifier
    ctx.fillStyle = textColor;
    ctx.font = '10px monospace';
    ctx.fillText('SEAM MAGNIFIER', seamX0 + 8, 14);

    ctx.fillStyle = seam.seamQualityPercent >= 85 ? successColor : seam.seamQualityPercent >= 60 ? warningColor : dangerColor;
    ctx.font = 'bold 11px monospace';
    ctx.fillText(`${seam.seamQualityPercent.toFixed(0)}% MATCH`, width - 75, 14);

    // Update Dom badge if present
    const scoreBadge = this.backdropEl?.querySelector('#badge-seam-score');
    if (scoreBadge) {
      scoreBadge.innerHTML = `Seam Match: <strong>${seam.seamQualityPercent.toFixed(0)}%</strong>`;
    }
  }
}
