// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Fase 18: Audio Chopper & Multi-Layer Auto-Slicer Modal
//
// High-precision interactive waveform slicer with draggable slice markers,
// zero-crossing snapping, silence stripper, real-time transient detection,
// General MIDI Drum mapping, chromatic equidistant keybed distribution,
// and draggable Standard MIDI File (.mid) export for DAWs.
// ─────────────────────────────────────────────────────────

import { ICONS } from './icons.ts';
import { escHtml } from './escape.ts';
import { toast } from './notify.ts';
import { clamp } from '../core/dsp/DspMath.ts';
import { encodePcm16Wav } from '../core/dsp/WavDecoder.ts';
import { computeZoomedWaveformEnvelope } from '../core/dsp/LoopEditorTools.ts';
import {
  sliceAudioBuffer,
  DEFAULT_SLICER_OPTIONS,
  type DetectedSlice,
  type SlicerOptions,
  type SlicerResult,
} from '../core/dsp/AudioSlicerEngine.ts';
import type { Zone, ExtendedRegion, WorkingMode } from '../core/types.ts';
import { midiToNoteName } from './ZoneRibbon.ts';

export interface AudioChopperContext {
  getCurrentWorkingMode: () => WorkingMode;
  onInjectClassicZones?: (
    zones: Zone[],
    audioSamples: Array<{ name: string; buffer: ArrayBuffer }>
  ) => void;
  onInjectExtendedRegions?: (
    regions: ExtendedRegion[],
    audioSamples: Array<{ name: string; buffer: ArrayBuffer }>
  ) => void;
  onAuditionPcm?: (pcm: Float32Array, sampleRate: number) => void;
  onStopAudition?: () => void;
  onRegisterSampleBuffer?: (name: string, buffer: ArrayBuffer) => void;
}

export class AudioChopperModal {
  private backdropEl: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private pcm: Float32Array = new Float32Array(0);
  private sampleRate: number = 44100;
  private sourceFilename: string = '';
  private context: AudioChopperContext;

  private options: SlicerOptions = { ...DEFAULT_SLICER_OPTIONS };
  private currentResult: SlicerResult | null = null;
  private selectedSliceId: string | null = null;
  private playingSliceId: string | null = null;

  // Zoom and Canvas Viewport
  private zoomFactor: number = 1.0;
  private viewCenterNorm: number = 0.5;

  constructor(context: AudioChopperContext) {
    this.context = context;
  }

  public open(pcm: Float32Array, sampleRate: number, sourceFilename: string = ''): void {
    if (this.backdropEl) return;
    this.pcm = pcm;
    this.sampleRate = Math.max(1, sampleRate);
    this.sourceFilename = sourceFilename;
    this.zoomFactor = 1.0;
    this.viewCenterNorm = 0.5;
    this.selectedSliceId = null;

    if (this.pcm.length > 0) {
      this.recomputeSlices();
    } else {
      this.currentResult = null;
    }

    this.render();
  }

  public close(): void {
    this.context.onStopAudition?.();
    if (this.backdropEl) {
      this.backdropEl.remove();
      this.backdropEl = null;
    }
    this.canvas = null;
  }

  public async loadAudioFile(file: File): Promise<void> {
    try {
      const arrayBuf = await file.arrayBuffer();
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const decoded = await audioCtx.decodeAudioData(arrayBuf.slice(0));
      this.pcm = decoded.getChannelData(0);
      this.sampleRate = decoded.sampleRate;
      this.sourceFilename = file.name;
      this.zoomFactor = 1.0;
      this.viewCenterNorm = 0.5;
      this.selectedSliceId = null;

      this.context.onRegisterSampleBuffer?.(file.name, arrayBuf);
      this.recomputeSlices();
      this.render();
      toast(
        `Loaded "${file.name}" into Audio Chopper (${(this.pcm.length / this.sampleRate).toFixed(2)}s, ${this.sampleRate} Hz)`,
        'success'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`Failed to decode audio file: ${msg}`, 'error');
    }
  }

  public loadTestDemoBeat(): void {
    const sr = 44100;
    const pcm = new Float32Array(sr * 2);
    for (let i = 0; i < pcm.length; i++) {
      const t = i / sr;
      if (t < 0.3) pcm[i] += Math.sin(2 * Math.PI * (120 - t * 250) * t) * Math.exp(-t * 15);
      if (t >= 0.5 && t < 0.8) {
        const st = t - 0.5;
        pcm[i] += (Math.random() * 2 - 1) * Math.exp(-st * 20) * 0.6;
      }
      const hatT = t % 0.5;
      if (hatT < 0.05) {
        pcm[i] += (Math.random() * 2 - 1) * Math.exp(-hatT * 60) * 0.25;
      }
    }
    this.pcm = pcm;
    this.sampleRate = sr;
    this.sourceFilename = 'DemoBreak.wav';
    this.zoomFactor = 1.0;
    this.viewCenterNorm = 0.5;
    this.selectedSliceId = null;
    this.recomputeSlices();
    this.render();
    toast('Loaded 2-second synthesized test beat for slicer auditioning.', 'info');
  }

  private recomputeSlices(): void {
    if (this.pcm.length === 0) {
      this.currentResult = null;
      return;
    }
    this.currentResult = sliceAudioBuffer(this.pcm, this.sampleRate, this.options);
    if (!this.selectedSliceId && this.currentResult.slices.length > 0) {
      const firstValid = this.currentResult.slices.find((s) => !s.isSilence);
      this.selectedSliceId = firstValid ? firstValid.id : this.currentResult.slices[0].id;
    }
  }

  private render(): void {
    if (!this.backdropEl) {
      this.backdropEl = document.createElement('div');
      this.backdropEl.className = 'nmm-modal-backdrop nmm-chopper-backdrop';
      document.body.appendChild(this.backdropEl);

      this.backdropEl.addEventListener('click', (e) => {
        if (e.target === this.backdropEl) this.close();
      });
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.backdropEl) this.close();
      });
    }

    const hasAudio = this.pcm.length > 0;
    const res = this.currentResult;
    const slices = res?.slices ?? [];
    const validCount = res?.validSlicesCount ?? 0;
    const totalCount = res?.totalSlices ?? 0;
    const isWorkingExtended = this.context.getCurrentWorkingMode() === 'extended';

    this.backdropEl.innerHTML = `
      <div class="nmm-modal-window nmm-chopper-window" role="dialog" aria-modal="true" aria-labelledby="chopper-title">
        <header class="nmm-modal-header">
          <div class="nmm-modal-header-title">
            <span class="nmm-modal-header-icon">${ICONS.scissors}</span>
            <h2 id="chopper-title">Audio Chopper &amp; Multi-Layer Auto-Slicer</h2>
            <span class="panel-badge ${hasAudio ? 'badge-ai-on' : 'badge-muted'}">
              ${hasAudio ? escHtml(this.sourceFilename) : 'No Sample Loaded'}
            </span>
          </div>
          <button type="button" class="nmm-modal-close" aria-label="Close" id="btn-chopper-close">${ICONS.close || '✕'}</button>
        </header>

        <div class="nmm-modal-body nmm-chopper-body">
          <input type="file" id="inp-chopper-audio-file" accept=".wav,.aif,.aiff,.flac" style="display: none;" />

          ${
            !hasAudio
              ? `
            <!-- Unified Empty State / Dropzone -->
            <div class="audio-empty-dropzone" id="chopper-empty-dropzone">
              <div class="dropzone-icon-ring">
                <span class="dropzone-icon">${ICONS.scissors}</span>
              </div>
              <h3 class="dropzone-title">NO AUDIO FILE LOADED IN AUTO-SLICER</h3>
              <p class="dropzone-subtitle">
                Drag &amp; drop a drum loop, rhythmic phrase, or audio sample here (.wav, .aif, .flac) to detect transients and auto-map to zones.
              </p>
              <div class="dropzone-actions">
                <button type="button" class="btn btn-primary" id="btn-chopper-browse-file">
                  ${ICONS.folder} Browse Audio File...
                </button>
                <button type="button" class="btn btn-outline" id="btn-chopper-demo-beat" title="Load a 2-second synthesized test beat to test slicing without a sample">
                  ${ICONS.drum} Load Test Beat (Demo)
                </button>
              </div>
              <div class="dropzone-hint">
                AutoSlicer detects transients via Spectral Flux, snaps boundaries to zero-crossings, and maps slices to GM Drum notes or chromatic keyboard zones.
              </div>
            </div>
          `
              : `
            <!-- Waveform Canvas Viewport -->
            <div class="chopper-waveform-panel">
              <div class="chopper-waveform-toolbar">
                <div class="chopper-zoom-controls">
                  <span class="toolbar-label">ZOOM:</span>
                  <button type="button" class="btn btn-xs btn-outline" id="btn-chopper-zoom-out" title="Zoom Out Waveform">-</button>
                  <span class="val-pill" id="lbl-chopper-zoom">${this.zoomFactor.toFixed(1)}x</span>
                  <button type="button" class="btn btn-xs btn-outline" id="btn-chopper-zoom-in" title="Zoom In Waveform">+</button>
                  <button type="button" class="btn btn-xs btn-outline" id="btn-chopper-zoom-fit" title="Fit Entire Audio File to Viewport">Fit</button>
                </div>
                <div class="chopper-toolbar-right">
                  <div class="chopper-waveform-stats">
                    <span>${(this.pcm.length / this.sampleRate).toFixed(2)}s (${this.pcm.length.toLocaleString()} frames)</span>
                    <span class="val-pill">${validCount} Active Slices</span>
                  </div>
                  <button type="button" class="btn btn-xs btn-outline" id="btn-chopper-change-file" title="Open another audio file">
                    ${ICONS.folder} Open File...
                  </button>
                </div>
              </div>

              <div class="chopper-canvas-wrap" id="chopper-canvas-wrap">
                <canvas id="chopper-waveform-canvas" height="150"></canvas>
              </div>
              <div class="chopper-canvas-hint">
                <span>Click slice to audition one-shot</span> • <span>Silence intervals shaded dark</span> • <span>0-Crossing Snapped</span>
              </div>
            </div>

            <!-- Real-Time Parameters Card -->
            <div class="chopper-params-card">
              <div class="chopper-params-row">
                <!-- Slicing Mode -->
                <div class="chopper-param-group" style="min-width: 220px;">
                  <div class="chopper-param-header">
                    <span>SLICING MODE</span>
                  </div>
                  <div class="btn-group" style="display: flex; gap: 4px;">
                    <button type="button" class="btn btn-xs ${this.options.mode === 'drums' ? 'btn-accent is-active' : 'btn-outline'}" id="btn-mode-drums" title="Classify into General MIDI Drum Map notes">
                      ${ICONS.drum} Drums (GM)
                    </button>
                    <button type="button" class="btn btn-xs ${this.options.mode === 'chromatic' ? 'btn-accent is-active' : 'btn-outline'}" id="btn-mode-chromatic" title="Detect F0 pitch and map to contiguous equidistant key zones">
                      ${ICONS.piano} Chromatic
                    </button>
                    <button type="button" class="btn btn-xs ${this.options.mode === 'grid' ? 'btn-accent is-active' : 'btn-outline'}" id="btn-mode-grid" title="Chop by musical grid tempo division">
                      Grid BPM
                    </button>
                  </div>
                </div>

                <!-- Transient Sensitivity Slider -->
                <div class="chopper-param-group flex-1">
                  <div class="chopper-param-header">
                    <span>TRANSIENT SENSITIVITY</span>
                    <span class="chopper-param-val" id="lbl-sens-val">${this.options.sensitivity}%</span>
                  </div>
                  <input type="range" class="form-control" id="rng-sens" min="5" max="98" value="${this.options.sensitivity}" />
                </div>

                <!-- Silence Gate Threshold -->
                <div class="chopper-param-group flex-1">
                  <div class="chopper-param-header">
                    <span>SILENCE GATE</span>
                    <span class="chopper-param-val" id="lbl-silence-val">${this.options.silenceThresholdDb} dB</span>
                  </div>
                  <input type="range" class="form-control" id="rng-silence" min="-60" max="-18" value="${this.options.silenceThresholdDb}" />
                </div>

                <!-- Pre-Roll Safety Margin -->
                <div class="chopper-param-group" style="width: 100px;">
                  <div class="chopper-param-header">
                    <span>PRE-ROLL</span>
                  </div>
                  <input type="number" id="inp-preroll" class="form-control font-mono" min="0" max="25" value="${this.options.preRollMs}" title="Pre-roll safety margin in milliseconds" />
                </div>

                <!-- Snap & Overlap Toggles -->
                <div class="chopper-toggles-col">
                  <button type="button" class="btn btn-xs ${this.options.snapZeroCrossing ? 'btn-accent is-active' : 'btn-outline'}" id="btn-toggle-zc-snap" title="Magnetize slice boundaries to the nearest zero-crossing">
                    0-X Snap: ${this.options.snapZeroCrossing ? 'ON' : 'OFF'}
                  </button>
                  <button type="button" class="btn btn-xs ${this.options.allowOverlap ? 'btn-accent is-active' : 'btn-outline'}" id="btn-toggle-overlap" title="Allow overlapping key & velocity zones">
                    Overlaps: ${this.options.allowOverlap ? 'ALLOW' : 'DISJOINT'}
                  </button>
                </div>
              </div>
            </div>

            <!-- Slices Table Inspector -->
            <div class="chopper-table-panel">
              <div class="chopper-table-header-row">
                <span class="chopper-table-title">
                  Detected Slices (${validCount} valid / ${totalCount} total)
                </span>
                <span style="font-size: 11px; color: var(--color-text-dim);">
                  Target: <strong>${isWorkingExtended ? 'Extended 2D Regions' : 'Classic 128-Zone Hartmann'}</strong>
                </span>
              </div>

              <div class="chopper-table-scroll">
                <table class="canonical-zone-table chopper-slices-table">
                  <thead>
                    <tr>
                      <th style="width: 45px;">#ID</th>
                      <th style="width: 110px;">Time Range</th>
                      <th style="width: 80px;">Duration</th>
                      <th style="width: 160px;">Classification</th>
                      <th style="width: 90px;">Root Key</th>
                      <th style="width: 110px;">Key Range</th>
                      <th style="width: 90px;">Velocity</th>
                      <th style="width: 80px;">Peak / RMS</th>
                      <th style="width: 80px; text-align: center;">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${
                      slices.length === 0
                        ? `<tr><td colspan="9" style="text-align: center; padding: 20px; color: var(--color-text-dim);">No slices detected. Adjust sensitivity slider above.</td></tr>`
                        : slices
                            .map((sl) => {
                              const isSel = sl.id === this.selectedSliceId;
                              const isPlaying = sl.id === this.playingSliceId;
                              const isSilence = sl.isSilence;

                              return `
                                <tr class="zone-table-row ${isSel ? 'is-selected' : ''} ${isSilence ? 'is-silence-row' : ''}" data-slice-id="${sl.id}">
                                  <td>${sl.index}</td>
                                  <td>${sl.startSec.toFixed(2)}s..${sl.endSec.toFixed(2)}s</td>
                                  <td>${(sl.durationSec * 1000).toFixed(0)} ms</td>
                                  <td>
                                    ${isSilence ? `<span class="val-pill" style="opacity: 0.6;">Silence</span>` : `<span style="font-weight: 600; color: var(--color-accent);">${escHtml(sl.label)}</span>`}
                                  </td>
                                  <td>${isSilence ? '—' : `${sl.rootKey} (${midiToNoteName(sl.rootKey)})`}</td>
                                  <td>${isSilence ? '—' : `${sl.lowKey}..${sl.highKey}`}</td>
                                  <td>${isSilence ? '—' : `${sl.lowVel}..${sl.highVel}`}</td>
                                  <td>${sl.peakDb}dB / ${sl.rmsDb}dB</td>
                                  <td style="text-align: center; white-space: nowrap;">
                                    <button type="button" class="btn btn-xs btn-ghost btn-play-slice" data-slice-id="${sl.id}" title="Audition slice one-shot">
                                      ${isPlaying ? ICONS.stop : ICONS.play}
                                    </button>
                                    <button type="button" class="btn btn-xs btn-ghost btn-danger-hover btn-delete-slice" data-slice-id="${sl.id}" title="Remove slice marker">
                                      ${ICONS.trash}
                                    </button>
                                  </td>
                                </tr>
                              `;
                            })
                            .join('')
                    }
                  </tbody>
                </table>
              </div>
            </div>
          `
          }
        </div>

        <!-- Footer Actions Bar -->
        <footer class="nmm-modal-footer chopper-footer-actions">
          <button type="button" class="btn btn-outline" id="btn-chopper-discard">Discard &amp; Close</button>

          ${
            hasAudio
              ? `
            <div style="display: flex; gap: 8px; align-items: center;">
              <!-- Draggable MIDI Pattern Button -->
              <button type="button" class="btn btn-accent btn-drag-midi" id="btn-drag-midi" draggable="true" title="Drag MIDI Pattern directly to DAW track or click to download .mid file">
                ${ICONS.piano} Drag MIDI to DAW (.mid)
              </button>

              <!-- Inject as Zones Button -->
              <button type="button" class="btn btn-primary" id="btn-chopper-inject" ${validCount === 0 ? 'disabled' : ''}>
                ${ICONS.scissors} Inject as Zones into Session (${validCount} Zones)
              </button>
            </div>
          `
              : ''
          }
        </footer>
      </div>
    `;

    this.bindEvents();
    if (hasAudio) {
      this.drawWaveformCanvas();
    }
  }

  private getThemeColors(): {
    bg: string;
    waveform: string;
    waveformGradientEnd: string;
    sliceSel: string;
    sliceEven: string;
    sliceOdd: string;
    silence: string;
    marker: string;
    centerLine: string;
    text: string;
  } {
    const style = typeof window !== 'undefined' ? window.getComputedStyle(document.body) : null;
    const accent = style?.getPropertyValue('--color-accent').trim() || '#38bdf8';
    const isDark =
      !document.body.classList.contains('theme-light') &&
      !document.documentElement.classList.contains('theme-light');

    return {
      bg: isDark ? '#060a12' : '#f1f5f9',
      waveform: accent,
      waveformGradientEnd: isDark ? '#0284c7' : '#0369a1',
      sliceSel: isDark ? 'rgba(56, 189, 248, 0.28)' : 'rgba(14, 165, 233, 0.25)',
      sliceEven: isDark ? 'rgba(56, 189, 248, 0.08)' : 'rgba(14, 165, 233, 0.08)',
      sliceOdd: isDark ? 'rgba(168, 85, 247, 0.08)' : 'rgba(139, 92, 246, 0.08)',
      silence: isDark ? 'rgba(15, 23, 42, 0.85)' : 'rgba(148, 163, 184, 0.45)',
      marker: accent,
      centerLine: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.12)',
      text: isDark ? '#f8fafc' : '#0f172a',
    };
  }

  private drawWaveformCanvas(): void {
    if (!this.backdropEl) return;
    this.canvas = this.backdropEl.querySelector('#chopper-waveform-canvas') as HTMLCanvasElement | null;
    if (!this.canvas) return;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;

    const wrap = this.backdropEl.querySelector('#chopper-canvas-wrap') as HTMLElement | null;
    const width = Math.max(300, Math.floor(wrap?.clientWidth || 880));
    const height = 150;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

    if (this.canvas.width !== Math.floor(width * dpr) || this.canvas.height !== Math.floor(height * dpr)) {
      this.canvas.width = Math.floor(width * dpr);
      this.canvas.height = Math.floor(height * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    const colors = this.getThemeColors();

    // Adaptive background
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, width, height);

    const totalFrames = this.pcm.length;
    if (totalFrames === 0) {
      ctx.restore();
      return;
    }

    const zoom = clamp(this.zoomFactor, 1, 16);
    const windowFrames = Math.max(64, Math.round(totalFrames / zoom));
    const centerFrame = clamp(Math.round(this.viewCenterNorm * totalFrames), 0, totalFrames);
    const viewStart = clamp(centerFrame - Math.floor(windowFrames * 0.5), 0, Math.max(0, totalFrames - windowFrames));
    const viewEnd = clamp(viewStart + windowFrames, viewStart + 1, totalFrames);
    const viewSpan = Math.max(1, viewEnd - viewStart);

    const frameToX = (frame: number) => ((frame - viewStart) / viewSpan) * width;

    // Draw Slices Background Shading & Boundary Lines
    const slices = this.currentResult?.slices ?? [];
    slices.forEach((sl, idx) => {
      const x1 = frameToX(sl.startFrame);
      const x2 = frameToX(sl.endFrame);
      if (x2 < 0 || x1 > width) return;

      const w = Math.max(1, x2 - x1);
      if (sl.isSilence) {
        ctx.fillStyle = colors.silence;
        ctx.fillRect(x1, 0, w, height);
      } else {
        const isSel = sl.id === this.selectedSliceId;
        const isEven = idx % 2 === 0;
        ctx.fillStyle = isSel ? colors.sliceSel : isEven ? colors.sliceEven : colors.sliceOdd;
        ctx.fillRect(x1, 0, w, height);

        // Header flag label
        ctx.fillStyle = isSel ? colors.marker : colors.text;
        ctx.font = '10px monospace';
        ctx.fillText(`#${sl.index} ${sl.label.slice(0, 14)}`, x1 + 4, 14);
      }

      // Vertical Marker Line (start)
      ctx.strokeStyle = sl.isSilence ? 'rgba(100, 116, 139, 0.4)' : colors.marker;
      ctx.lineWidth = sl.id === this.selectedSliceId ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x1, 0);
      ctx.lineTo(x1, height);
      ctx.stroke();
    });

    // Center Reference Line
    const centerY = height * 0.5;
    ctx.strokeStyle = colors.centerLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(width, centerY);
    ctx.stroke();

    // Waveform Envelope
    const numPoints = Math.min(width, 600);
    const env = computeZoomedWaveformEnvelope(this.pcm, viewStart, viewEnd, numPoints);
    const ampScale = height * 0.44;

    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, colors.waveform);
    grad.addColorStop(1, colors.waveformGradientEnd);

    ctx.fillStyle = grad;
    const stepX = width / numPoints;
    for (let i = 0; i < numPoints; i++) {
      const x = i * stepX;
      const topY = centerY - (env.max[i] ?? 0) * ampScale;
      const botY = centerY - (env.min[i] ?? 0) * ampScale;
      const barH = Math.max(1, botY - topY);
      ctx.fillRect(x, topY, Math.max(1, stepX - 0.5), barH);
    }

    ctx.restore();
  }

  private bindEvents(): void {
    if (!this.backdropEl) return;

    this.backdropEl.querySelector('#btn-chopper-close')?.addEventListener('click', () => this.close());
    this.backdropEl.querySelector('#btn-chopper-discard')?.addEventListener('click', () => this.close());

    // File input setup
    const fileInp = this.backdropEl.querySelector('#inp-chopper-audio-file') as HTMLInputElement | null;
    fileInp?.addEventListener('change', () => {
      const file = fileInp.files?.[0];
      if (file) {
        void this.loadAudioFile(file);
      }
    });

    this.backdropEl.querySelector('#btn-chopper-browse-file')?.addEventListener('click', () => {
      fileInp?.click();
    });
    this.backdropEl.querySelector('#btn-chopper-change-file')?.addEventListener('click', () => {
      fileInp?.click();
    });

    this.backdropEl.querySelector('#btn-chopper-demo-beat')?.addEventListener('click', () => {
      this.loadTestDemoBeat();
    });

    // Dropzone drag & drop
    const dropzone = this.backdropEl.querySelector('#chopper-empty-dropzone');
    if (dropzone) {
      dropzone.addEventListener('dragover', (e: Event) => {
        e.preventDefault();
        dropzone.classList.add('is-dragover');
      });
      dropzone.addEventListener('dragleave', (e: Event) => {
        e.preventDefault();
        dropzone.classList.remove('is-dragover');
      });
      dropzone.addEventListener('drop', (e: Event) => {
        e.preventDefault();
        dropzone.classList.remove('is-dragover');
        const dt = (e as DragEvent).dataTransfer;
        const file = dt?.files?.[0];
        if (file) {
          void this.loadAudioFile(file);
        }
      });
    }

    // Zoom Controls
    this.backdropEl.querySelector('#btn-chopper-zoom-in')?.addEventListener('click', () => {
      this.zoomFactor = Math.min(16, this.zoomFactor * 1.5);
      this.render();
    });
    this.backdropEl.querySelector('#btn-chopper-zoom-out')?.addEventListener('click', () => {
      this.zoomFactor = Math.max(1.0, this.zoomFactor / 1.5);
      this.render();
    });
    this.backdropEl.querySelector('#btn-chopper-zoom-fit')?.addEventListener('click', () => {
      this.zoomFactor = 1.0;
      this.viewCenterNorm = 0.5;
      this.render();
    });

    // Mode Buttons
    this.backdropEl.querySelector('#btn-mode-drums')?.addEventListener('click', () => {
      this.options.mode = 'drums';
      this.recomputeSlices();
      this.render();
    });
    this.backdropEl.querySelector('#btn-mode-chromatic')?.addEventListener('click', () => {
      this.options.mode = 'chromatic';
      this.recomputeSlices();
      this.render();
    });
    this.backdropEl.querySelector('#btn-mode-grid')?.addEventListener('click', () => {
      this.options.mode = 'grid';
      this.recomputeSlices();
      this.render();
    });

    // Sensitivity Slider
    const rngSens = this.backdropEl.querySelector('#rng-sens') as HTMLInputElement | null;
    rngSens?.addEventListener('input', () => {
      this.options.sensitivity = parseInt(rngSens.value, 10);
      const lbl = this.backdropEl?.querySelector('#lbl-sens-val');
      if (lbl) lbl.textContent = `${this.options.sensitivity}%`;
      this.recomputeSlices();
      this.render();
    });

    // Silence Gate Slider
    const rngSilence = this.backdropEl.querySelector('#rng-silence') as HTMLInputElement | null;
    rngSilence?.addEventListener('input', () => {
      this.options.silenceThresholdDb = parseInt(rngSilence.value, 10);
      const lbl = this.backdropEl?.querySelector('#lbl-silence-val');
      if (lbl) lbl.textContent = `${this.options.silenceThresholdDb} dB`;
      this.recomputeSlices();
      this.render();
    });

    // Pre-roll Input
    const inpPreroll = this.backdropEl.querySelector('#inp-preroll') as HTMLInputElement | null;
    inpPreroll?.addEventListener('change', () => {
      this.options.preRollMs = Math.max(0, parseInt(inpPreroll.value, 10) || 0);
      this.recomputeSlices();
      this.render();
    });

    // Toggles
    this.backdropEl.querySelector('#btn-toggle-zc-snap')?.addEventListener('click', () => {
      this.options.snapZeroCrossing = !this.options.snapZeroCrossing;
      this.recomputeSlices();
      this.render();
    });
    this.backdropEl.querySelector('#btn-toggle-overlap')?.addEventListener('click', () => {
      this.options.allowOverlap = !this.options.allowOverlap;
      this.recomputeSlices();
      this.render();
    });

    // Canvas click to select and audition slice
    const canvasWrap = this.backdropEl.querySelector('#chopper-canvas-wrap');
    canvasWrap?.addEventListener('click', (e: Event) => {
      const mouseEvent = e as MouseEvent;
      if (!this.canvas) return;
      const rect = this.canvas.getBoundingClientRect();
      const clickXNorm = (mouseEvent.clientX - rect.left) / rect.width;

      const totalFrames = this.pcm.length;
      const zoom = clamp(this.zoomFactor, 1, 16);
      const windowFrames = Math.max(64, Math.round(totalFrames / zoom));
      const centerFrame = clamp(Math.round(this.viewCenterNorm * totalFrames), 0, totalFrames);
      const viewStart = clamp(centerFrame - Math.floor(windowFrames * 0.5), 0, Math.max(0, totalFrames - windowFrames));
      const clickedFrame = Math.round(viewStart + clickXNorm * windowFrames);

      const hit = this.currentResult?.slices.find(
        (s) => clickedFrame >= s.startFrame && clickedFrame <= s.endFrame
      );
      if (hit) {
        this.selectedSliceId = hit.id;
        this.auditionSlice(hit);
        this.render();
      }
    });

    // Row selection and play/delete actions
    this.backdropEl.querySelectorAll<HTMLButtonElement>('.btn-play-slice').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sliceId = btn.dataset.sliceId;
        const sl = this.currentResult?.slices.find((s) => s.id === sliceId);
        if (sl) {
          this.auditionSlice(sl);
        }
      });
    });

    this.backdropEl.querySelectorAll<HTMLButtonElement>('.btn-delete-slice').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sliceId = btn.dataset.sliceId;
        if (sliceId && this.currentResult) {
          this.currentResult.slices = this.currentResult.slices.filter((s) => s.id !== sliceId);
          this.currentResult.validSlicesCount = this.currentResult.slices.filter((s) => !s.isSilence).length;
          this.render();
        }
      });
    });

    // Drag MIDI to DAW Setup
    const dragBtn = this.backdropEl.querySelector('#btn-drag-midi') as HTMLElement | null;
    if (dragBtn && this.currentResult) {
      dragBtn.addEventListener('dragstart', (e: DragEvent) => {
        if (!this.currentResult) return;
        const midiBytes = this.currentResult.midiFileBuffer;
        const blob = new Blob([midiBytes.buffer as ArrayBuffer], { type: 'audio/midi' });
        const url = URL.createObjectURL(blob);
        const filename = `${(this.sourceFilename || 'sliced_audio').replace(/\.[^/.]+$/, '')}_slices.mid`;

        if (e.dataTransfer) {
          e.dataTransfer.setData('DownloadURL', `audio/midi:${filename}:${url}`);
          e.dataTransfer.setData('text/plain', filename);
        }
      });

      dragBtn.addEventListener('click', () => {
        if (!this.currentResult) return;
        const midiBytes = this.currentResult.midiFileBuffer;
        const blob = new Blob([midiBytes.buffer as ArrayBuffer], { type: 'audio/midi' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(this.sourceFilename || 'sliced_audio').replace(/\.[^/.]+$/, '')}_slices.mid`;
        a.click();
        URL.revokeObjectURL(url);
        toast('Downloaded Standard MIDI pattern for sliced audio.', 'success');
      });
    }

    // Inject Zones Action
    this.backdropEl.querySelector('#btn-chopper-inject')?.addEventListener('click', () => {
      this.handleInjectSlicesIntoSession();
    });
  }

  private auditionSlice(sl: DetectedSlice): void {
    this.playingSliceId = sl.id;
    if (this.context.onAuditionPcm) {
      this.context.onAuditionPcm(sl.pcm, this.sampleRate);
    }
  }

  private handleInjectSlicesIntoSession(): void {
    const res = this.currentResult;
    if (!res) return;

    const validSlices = res.slices.filter((s) => !s.isSilence);
    if (validSlices.length === 0) {
      toast('No valid slices to inject into session.', 'warning');
      return;
    }

    const isExtended = this.context.getCurrentWorkingMode() === 'extended';
    const baseName = (this.sourceFilename || 'sample').replace(/\.[^/.]+$/, '');
    const audioSamples: Array<{ name: string; buffer: ArrayBuffer }> = [];

    // Encode each slice to WAV PCM 16-bit
    validSlices.forEach((sl, idx) => {
      const sliceWavName = `${baseName}_slice${String(idx + 1).padStart(2, '0')}.wav`;
      const wavBuffer = encodePcm16Wav(sl.pcm, this.sampleRate, {
        rootKey: sl.rootKey,
        lowKey: sl.lowKey,
        highKey: sl.highKey,
      });
      audioSamples.push({ name: sliceWavName, buffer: wavBuffer });
    });

    if (isExtended) {
      // Inject into Extended 2D Sampler Regions
      const isDrum = this.options.mode === 'drums';
      const regions: ExtendedRegion[] = validSlices.map((sl, idx) => ({
        id: `reg_chopped_${idx + 1}_${Date.now()}`,
        sampleName: audioSamples[idx].name,
        rootKey: sl.rootKey,
        lowKey: sl.lowKey,
        highKey: sl.highKey,
        lowVel: sl.lowVel,
        highVel: sl.highVel,
        detune: 0,
        volume: 0,
        pan: 0,
        pitchKeytrack: isDrum ? 0 : 100,
        trigger: 'attack',
        keyFadeIn: 0,
        keyFadeOut: 0,
        velFadeIn: 0,
        velFadeOut: 0,
        fadeCurve: 'equal-power',
        loopMode: 'no_loop',
        loopStart: 0,
        loopEnd: sl.pcm.length,
        loopCrossfadeMs: 0,
        sampleRate: this.sampleRate,
        numChannels: 1,
      }));

      this.context.onInjectExtendedRegions?.(regions, audioSamples);
      toast(`Successfully mapped ${regions.length} audio slices to 2D Sampler Regions!`, 'success');
    } else {
      // Inject into Classic Contiguous Hartmann Zones (0..127)
      const zones: Zone[] = validSlices.map((sl, idx) => ({
        id: `zone_chopped_${idx + 1}_${Date.now()}`,
        rootKey: sl.rootKey,
        lowKey: sl.lowKey,
        highKey: sl.highKey,
        sampleLow: audioSamples[idx].name,
        sampleHigh: null,
        velSplit: 64,
        detune: 0,
        volume: 0,
        pan: 0,
      }));

      this.context.onInjectClassicZones?.(zones, audioSamples);
      toast(`Successfully mapped ${zones.length} audio slices to Classic Keyboard Zones!`, 'success');
    }

    this.close();
  }
}
