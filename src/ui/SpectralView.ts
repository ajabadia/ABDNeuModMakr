// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Phase 4: Spectral & Resynthesis Monitor (`SpectralView.ts`)
//
// Interactive 2D Canvas visualization & A/B audition panel:
//   1. 2D STFT Spectrogram + Clustered Partial Trajectories Overlay
//   2. 64-Partial Harmonic Spectrum + Real-Time Web Audio FFT Overlay
//   3. A/B Waveform Comparison (Original Sample vs Additive Resynthesis)
//   4. Live dBFS Level Meter & A/B Audition Controls
// ─────────────────────────────────────────────────────────

import { SpectrumPlotter } from '@abdsynths/shared/components';
import { clamp, linearToDb } from '../core/dsp/DspMath';
import {
  computeLoopSeamAnalysis,
  computeZoomedWaveformEnvelope,
  findSmartAutoLoop,
  snapFrameToRisingZeroCrossing,
} from '../core/dsp/LoopEditorTools';
import type { AutoLoopAlgorithm, LoopMode, ZoneLoopEditorData, ZoneSpectralInspection } from '../core/types';
import { ICONS } from './icons';

export type SpectralDisplayMode =
  | 'spectrogram'
  | 'partials'
  | 'waveform-ab'
  | 'log-curve'
  | 'loop-editor';
export type AuditionTargetMode = 'original' | 'resynthesis' | 'enhanced';

export interface SpectralViewHandlers {
  onAuditionZone: (zoneId: string, mode: AuditionTargetMode) => void;
  onStopAudition: () => void;
  onKeyboardModeChange: (mode: AuditionTargetMode) => void;
  getRealtimeSpectrum: () => {
    bins: Uint8Array;
    rmsDb: number;
    isPlaying: boolean;
    mode: AuditionTargetMode | null;
  };
  /** Fase 13: Retrieve decoded PCM and loop markers for the active zone/region */
  getLoopEditorData?: () => ZoneLoopEditorData | null;
  /** Fase 13: Commit updated loop parameters back to the active ExtendedRegion / Zone */
  onUpdateLoopParams?: (changes: {
    loopMode?: LoopMode;
    loopStart?: number;
    loopEnd?: number;
    loopCrossfadeMs?: number;
  }) => void;
  /** Fase 13: Start real-time looped auditioning */
  onAuditionLoop?: (opts: {
    loopStartFrame: number;
    loopEndFrame: number;
    loopEnabled: boolean;
  }) => void;
  /** Fase 13: Live-update loop points on active AudioBufferSourceNode while dragging */
  onUpdateLiveLoopPoints?: (
    loopStartFrame: number,
    loopEndFrame: number,
    sampleRate: number,
    loopEnabled: boolean
  ) => void;
}

/**
 * Resolves a CSS custom property from the active theme on `document.documentElement`,
 * following the `BaseRenderer.resolveColor` contract from `ABDShared/Code/Scope`.
 */
function resolveThemeToken(varName: string, fallback: string): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return fallback;
  }
  const val = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return val || fallback;
}

const LAYER_TOKEN_VARS: readonly { cssVar: string; fallback: string }[] = [
  { cssVar: '--color-accent', fallback: '#00e676' },
  { cssVar: '--color-warning', fallback: '#ffb142' },
  { cssVar: '--color-cable-midi-in', fallback: '#06b6d4' },
  { cssVar: '--color-cable-midi-out', fallback: '#a855f7' },
];

function getLayerColors(): string[] {
  return LAYER_TOKEN_VARS.map((t) => resolveThemeToken(t.cssVar, t.fallback));
}

export class SpectralView {
  private readonly container: HTMLElement;
  private readonly handlers: SpectralViewHandlers;

  private inspection: ZoneSpectralInspection | null = null;
  private displayMode: SpectralDisplayMode = 'spectrogram';
  private showPartialsOverlay = true;
  private keyboardMode: AuditionTargetMode = 'original';

  // Fase 13: Interactive Waveform Loop Editor state
  private loopData: ZoneLoopEditorData | null = null;
  private loopSnapZeroCrossing = true;
  private loopSelectedAlgo: AutoLoopAlgorithm = 'pitch_periodic';
  private loopZoomFactor = 1.0;
  private loopViewCenterNorm = 0.5;
  private draggingLoopHandle: 'start' | 'end' | 'xfade' | null = null;

  private canvas: HTMLCanvasElement | null = null;
  private sharedPlotterWrap: HTMLElement | null = null;
  private sharedPlotter: SpectrumPlotter | null = null;
  private hoverInfoEl: HTMLElement | null = null;
  private meterFillEl: HTMLElement | null = null;
  private meterValEl: HTMLElement | null = null;
  private rafId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor(container: HTMLElement, handlers: SpectralViewHandlers) {
    this.container = container;
    this.handlers = handlers;
  }

  public setInspection(inspection: ZoneSpectralInspection | null): void {
    this.inspection = inspection;
    if (this.displayMode === 'loop-editor') {
      this.loopData = this.handlers.getLoopEditorData?.() ?? null;
    }
    this.renderShell();
    this.drawCanvas();
    this.ensureRealtimeLoop();
  }

  /**
   * Fase 13 — Opens the Interactive Waveform Loop Editor tab directly.
   */
  public openLoopEditor(): void {
    this.displayMode = 'loop-editor';
    this.loopData = this.handlers.getLoopEditorData?.() ?? null;
    this.renderShell();
    this.drawCanvas();
  }

  public refreshTheme(): void {
    this.drawCanvas();
  }

  public getKeyboardMode(): AuditionTargetMode {
    return this.keyboardMode;
  }

  public notifyPlaybackStarted(): void {
    this.ensureRealtimeLoop();
  }

  public dispose(): void {
    if (this.rafId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.sharedPlotter?.destroy();
    this.sharedPlotter = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  private renderShell(): void {
    this.sharedPlotter?.destroy();
    this.sharedPlotter = null;

    if (!this.inspection) {
      this.container.innerHTML = `
        <div class="spectral-view-panel is-empty">
          <div class="empty-icon">${ICONS.wave}</div>
          <div class="empty-text">Select a zone to inspect its 2D spectrogram and neural partial layers</div>
        </div>
      `;
      return;
    }

    const { summary, sampleName, sampleRate, durationSec } = this.inspection;
    const bandClass =
      summary.gridBand === 'green'
        ? 'band-green'
        : summary.gridBand === 'amber'
          ? 'band-amber'
          : summary.gridBand === 'orange'
            ? 'band-orange'
            : 'band-nodata';

    const qScore = this.inspection.qualityScore ?? summary.qualityScore;
    const enhancedPeaks = this.inspection.enhancedResynthPeaks ?? this.inspection.resynthPeaks;

    this.container.innerHTML = `
      <div class="spectral-view-panel">
        <div class="spectral-header">
          <div class="spectral-title-group">
            <span class="panel-badge">${ICONS.wave} SPECTRAL &amp; A/B/C MONITOR</span>
            <span class="spectral-sample-title" title="${sampleName}">${sampleName}</span>
            <span class="spectral-meta-pill">${(sampleRate / 1000).toFixed(1)} kHz | ${durationSec.toFixed(2)}s</span>
            <span class="spectral-grid-pill ${bandClass}" title="${summary.gridNotice}">
              f0: ${summary.detectedF0Hz.toFixed(2)} Hz (${summary.gridResidualCents.toFixed(1)} ct) | ${summary.activePartials} Partials | ${summary.layerCount} Layer${summary.layerCount > 1 ? 's' : ''}
            </span>
            ${
              qScore
                ? `<span class="spectral-meta-pill" title="Objective Resynthesis Quality Score (Cosine Similarity + Envelope Correlation + Residual SNR)">
                    Quality: Enhanced ${qScore.enhancedScore.toFixed(1)}% | Legacy ${qScore.legacyScore.toFixed(1)}%
                  </span>`
                : ''
            }
          </div>

          <div class="spectral-mode-tabs">
            <button type="button" class="btn-spec-tab ${this.displayMode === 'spectrogram' ? 'is-active' : ''}" data-mode="spectrogram">
              2D SPECTROGRAM
            </button>
            <button type="button" class="btn-spec-tab ${this.displayMode === 'partials' ? 'is-active' : ''}" data-mode="partials">
              64 PARTIALS
            </button>
            <button type="button" class="btn-spec-tab ${this.displayMode === 'waveform-ab' ? 'is-active' : ''}" data-mode="waveform-ab">
              WAVEFORM A/B/C
            </button>
            <button type="button" class="btn-spec-tab ${this.displayMode === 'log-curve' ? 'is-active' : ''}" data-mode="log-curve" title="ABDShared SpectrumPlotter (20 Hz..20 kHz Target vs Model vs Residual)">
              LOG CURVE
            </button>
            <button type="button" class="btn-spec-tab ${this.displayMode === 'loop-editor' ? 'is-active' : ''}" data-mode="loop-editor" title="Fase 13: Interactive Waveform Loop Editor &amp; Zero-Crossing Seam Magnifier">
              LOOP EDITOR
            </button>
          </div>
        </div>

        <div class="spectral-canvas-wrap" id="spectral-canvas-wrap">
          <canvas id="spectral-canvas" style="display: ${this.displayMode === 'log-curve' ? 'none' : 'block'}"></canvas>
          <div id="shared-spectrum-plotter" class="shared-plotter-mount" style="display: ${this.displayMode === 'log-curve' ? 'block' : 'none'}"></div>
          <div class="spectral-overlay-bar">
            ${
              this.displayMode === 'loop-editor'
                ? this.renderLoopEditorToolbarHtml()
                : `
            <div class="layer-legend">
              <span class="legend-item"><i class="layer-swatch layer-swatch-1"></i>L1 Harmonic</span>
              <span class="legend-item"><i class="layer-swatch layer-swatch-2"></i>L2 Sub/Crest</span>
              <span class="legend-item"><i class="layer-swatch layer-swatch-3"></i>L3 Transient</span>
              ${
                this.displayMode === 'spectrogram'
                  ? `<button type="button" class="btn-overlay-toggle ${this.showPartialsOverlay ? 'is-on' : ''}" id="btn-toggle-overlay">
                      ${ICONS.layers} Partials Overlay: ${this.showPartialsOverlay ? 'ON' : 'OFF'}
                    </button>`
                  : ''
              }
            </div>
            <div class="spectral-hover-readout" id="spectral-hover-readout">
              Hover graph to inspect frequency, partial &amp; layer
            </div>
            `
            }
          </div>
        </div>

        <div class="spectral-ab-footer">
          <div class="ab-buttons-group">
            <button type="button" class="btn btn-xs ${this.keyboardMode === 'original' ? 'btn-info' : 'btn-outline'}" id="btn-play-orig" title="Play &amp; Inspect Original Sample (A) [Space]">
              ${ICONS.play} A: Original (${this.inspection.waveformPeaks.rmsDb} dB)
            </button>
            <button type="button" class="btn btn-xs ${this.keyboardMode === 'resynthesis' ? 'btn-accent' : 'btn-outline'}" id="btn-play-resynth" title="Play &amp; Inspect Legacy Additive Scape/Sphere Resynthesis (B)">
              ${ICONS.cpu} B: Legacy DSP (${this.inspection.resynthPeaks.rmsDb} dB)
            </button>
            <button type="button" class="btn btn-xs ${this.keyboardMode === 'enhanced' ? 'btn-accent' : 'btn-outline'}" id="btn-play-enhanced" title="Play &amp; Inspect Enhanced DSP Resynthesis (C: HPSS + Trajectory Smoothing + Noise Floor Gate)">
              ${ICONS.cpu} C: Enhanced DSP (${enhancedPeaks.rmsDb} dB)
            </button>
            <button type="button" class="btn btn-xs btn-outline" id="btn-stop-audition" title="Stop Playback [Space]">
              ${ICONS.stop} Stop
            </button>
          </div>

          <div class="ab-keyb-toggle" title="Choose active signal for Graph Inspection &amp; MIDI Keyboard Audition: Original (A), Legacy DSP (B), or Enhanced DSP (C)">
            <span class="keyb-mode-label">${ICONS.piano} SOURCE / KEYB:</span>
            <button type="button" class="btn-keyb-mode ${this.keyboardMode === 'original' ? 'is-active' : ''}" data-keyb="original">
              A: ORIGINAL
            </button>
            <button type="button" class="btn-keyb-mode ${this.keyboardMode === 'resynthesis' ? 'is-active' : ''}" data-keyb="resynthesis">
              B: LEGACY
            </button>
            <button type="button" class="btn-keyb-mode ${this.keyboardMode === 'enhanced' ? 'is-active' : ''}" data-keyb="enhanced">
              C: ENHANCED
            </button>
          </div>

          <div class="ab-level-meter">
            <span class="meter-label">OUT</span>
            <div class="meter-track">
              <div class="meter-fill" id="spectral-meter-fill" style="width: 0%"></div>
            </div>
            <span class="meter-val" id="spectral-meter-val">-96.0 dB</span>
          </div>
        </div>
      </div>
    `;

    this.canvas = this.container.querySelector('#spectral-canvas');
    this.sharedPlotterWrap = this.container.querySelector('#shared-spectrum-plotter');
    this.hoverInfoEl = this.container.querySelector('#spectral-hover-readout');
    this.meterFillEl = this.container.querySelector('#spectral-meter-fill');
    this.meterValEl = this.container.querySelector('#spectral-meter-val');

    this.bindEvents();
  }

  private bindEvents(): void {
    if (!this.inspection) return;
    const zoneId = this.inspection.zoneId;

    // Mode tabs
    this.container.querySelectorAll('.btn-spec-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-mode') as SpectralDisplayMode | null;
        if (mode && mode !== this.displayMode) {
          this.displayMode = mode;
          if (mode === 'loop-editor') {
            this.loopData = this.handlers.getLoopEditorData?.() ?? null;
          }
          this.renderShell();
          this.drawCanvas();
        }
      });
    });

    if (this.displayMode === 'loop-editor') {
      this.bindLoopEditorEvents();
    }

    // Toggle partials overlay on 2D spectrogram
    this.container
      .querySelector('#btn-toggle-overlay')
      ?.addEventListener('click', () => {
        this.showPartialsOverlay = !this.showPartialsOverlay;
        this.renderShell();
        this.drawCanvas();
      });

    // A/B/C Audition buttons (also switch the active graph source to A, B, or C)
    this.container
      .querySelector('#btn-play-orig')
      ?.addEventListener('click', () => {
        if (this.keyboardMode !== 'original') {
          this.keyboardMode = 'original';
          this.handlers.onKeyboardModeChange('original');
          this.renderShell();
        }
        this.handlers.onAuditionZone(zoneId, 'original');
        this.drawCanvas();
        this.ensureRealtimeLoop();
      });

    this.container
      .querySelector('#btn-play-resynth')
      ?.addEventListener('click', () => {
        if (this.keyboardMode !== 'resynthesis') {
          this.keyboardMode = 'resynthesis';
          this.handlers.onKeyboardModeChange('resynthesis');
          this.renderShell();
        }
        this.handlers.onAuditionZone(zoneId, 'resynthesis');
        this.drawCanvas();
        this.ensureRealtimeLoop();
      });

    this.container
      .querySelector('#btn-play-enhanced')
      ?.addEventListener('click', () => {
        if (this.keyboardMode !== 'enhanced') {
          this.keyboardMode = 'enhanced';
          this.handlers.onKeyboardModeChange('enhanced');
          this.renderShell();
        }
        this.handlers.onAuditionZone(zoneId, 'enhanced');
        this.drawCanvas();
        this.ensureRealtimeLoop();
      });

    this.container
      .querySelector('#btn-stop-audition')
      ?.addEventListener('click', () => {
        this.handlers.onStopAudition();
        this.drawCanvas();
      });

    // Keyboard audition mode buttons
    this.container.querySelectorAll('.btn-keyb-mode').forEach((btn) => {
      btn.addEventListener('click', () => {
        const kbMode = btn.getAttribute('data-keyb') as AuditionTargetMode | null;
        if (kbMode && kbMode !== this.keyboardMode) {
          this.keyboardMode = kbMode;
          this.handlers.onKeyboardModeChange(kbMode);
          this.renderShell();
          this.drawCanvas();
        }
      });
    });

    // Hover readout on canvas
    if (this.canvas) {
      this.canvas.addEventListener('mousemove', (e) => this.handleCanvasHover(e));
      this.canvas.addEventListener('mouseleave', () => {
        if (this.hoverInfoEl) {
          this.hoverInfoEl.textContent =
            'Hover graph to inspect frequency, partial & layer';
        }
      });
    }

    // ResizeObserver for crisp HiDPI rendering
    const wrap = this.container.querySelector('#spectral-canvas-wrap');
    if (wrap && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver?.disconnect();
      this.resizeObserver = new ResizeObserver(() => {
        this.drawCanvas();
      });
      this.resizeObserver.observe(wrap);
    }
  }

  private getActivePartials(): number[] {
    if (!this.inspection) return [];
    if (this.keyboardMode === 'enhanced' && this.inspection.enhancedPartials) {
      return this.inspection.enhancedPartials;
    }
    if (this.keyboardMode === 'resynthesis' && this.inspection.legacyPartials) {
      return this.inspection.legacyPartials;
    }
    return this.inspection.summary.amplitudes;
  }

  private getActivePartialTracks() {
    if (!this.inspection) return [];
    if (this.keyboardMode === 'enhanced' && this.inspection.enhancedPartialTracks) {
      return this.inspection.enhancedPartialTracks;
    }
    if (this.keyboardMode === 'resynthesis' && this.inspection.legacyPartialTracks) {
      return this.inspection.legacyPartialTracks;
    }
    return this.inspection.partialTracks;
  }

  private getActiveSpectrogram() {
    if (!this.inspection) return null;
    if (this.keyboardMode === 'enhanced' && this.inspection.enhancedSpectrogram) {
      return this.inspection.enhancedSpectrogram;
    }
    if (this.keyboardMode === 'resynthesis' && this.inspection.legacySpectrogram) {
      return this.inspection.legacySpectrogram;
    }
    return this.inspection.spectrogram;
  }

  private handleCanvasHover(e: MouseEvent): void {
    if (!this.canvas || !this.inspection || !this.hoverInfoEl) return;
    const rect = this.canvas.getBoundingClientRect();
    const xNorm = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
    const yNorm = Math.max(0, Math.min(1, (e.clientY - rect.top) / Math.max(1, rect.height)));

    if (this.displayMode === 'spectrogram') {
      const spec = this.getActiveSpectrogram() ?? this.inspection.spectrogram;
      const timeSec = xNorm * this.inspection.durationSec;
      const freqHz = (1 - yNorm) * spec.maxFreqHz;
      const harmIdx = Math.max(
        1,
        Math.round(freqHz / Math.max(1, this.inspection.summary.detectedF0Hz))
      );
      const srcTag =
        this.keyboardMode === 'enhanced'
          ? 'C: Enhanced'
          : this.keyboardMode === 'resynthesis'
            ? 'B: Legacy'
            : 'A: Original';
      this.hoverInfoEl.textContent = `[${srcTag}] t = ${timeSec.toFixed(2)}s | freq = ${freqHz.toFixed(0)} Hz (~H${harmIdx})`;
    } else if (this.displayMode === 'partials') {
      const pIdx = Math.min(63, Math.max(0, Math.floor(xNorm * 64)));
      const activeAmps = this.getActivePartials();
      const amp = activeAmps[pIdx] ?? 0;
      const origAmp = this.inspection.summary.amplitudes[pIdx] ?? 0;
      const offHz = this.inspection.summary.frequencyOffsets[pIdx] ?? 0;
      const freqHz = (pIdx + 1) * this.inspection.summary.detectedF0Hz + offHz;
      const tracks = this.getActivePartialTracks();
      const track = tracks.find((t) => t.partialIndex === pIdx + 1);
      const layerNum = (track?.layerIndex ?? 0) + 1;
      const ampDb = amp > 1e-5 ? `${linearToDb(amp).toFixed(1)} dB` : '-inf dB';
      const origDb = origAmp > 1e-5 ? `${linearToDb(origAmp).toFixed(1)} dB` : '-inf dB';
      this.hoverInfoEl.textContent = `Partial H${pIdx + 1}: ${freqHz.toFixed(1)} Hz | Active: ${ampDb} (Orig: ${origDb}) | Layer L${layerNum}`;
    } else {
      const timeSec = xNorm * this.inspection.durationSec;
      const col = Math.min(
        this.inspection.waveformPeaks.max.length - 1,
        Math.floor(xNorm * this.inspection.waveformPeaks.max.length)
      );
      const origPeak = Math.max(
        Math.abs(this.inspection.waveformPeaks.min[col] ?? 0),
        Math.abs(this.inspection.waveformPeaks.max[col] ?? 0)
      );
      const resPeak = Math.max(
        Math.abs(this.inspection.resynthPeaks.min[col] ?? 0),
        Math.abs(this.inspection.resynthPeaks.max[col] ?? 0)
      );
      const enhPeaks = this.inspection.enhancedResynthPeaks ?? this.inspection.resynthPeaks;
      const enhPeak = Math.max(
        Math.abs(enhPeaks.min[col] ?? 0),
        Math.abs(enhPeaks.max[col] ?? 0)
      );
      this.hoverInfoEl.textContent = `t = ${timeSec.toFixed(2)}s | A Orig: ${origPeak.toFixed(3)} | B Legacy: ${resPeak.toFixed(3)} | C Enhanced: ${enhPeak.toFixed(3)}`;
    }
  }

  private ensureRealtimeLoop(): void {
    if (typeof requestAnimationFrame === 'undefined') return;
    if (this.rafId !== null) return;

    const tick = () => {
      const rt = this.handlers.getRealtimeSpectrum();
      this.updateMeter(rt.rmsDb, rt.isPlaying);

      if (rt.isPlaying) {
        this.drawCanvas(rt);
        this.rafId = requestAnimationFrame(tick);
      } else {
        this.rafId = null;
        this.drawCanvas();
      }
    };

    this.rafId = requestAnimationFrame(tick);
  }

  private updateMeter(rmsDb: number, isPlaying: boolean): void {
    if (!this.meterFillEl || !this.meterValEl) return;
    if (!isPlaying || rmsDb <= -90) {
      this.meterFillEl.style.width = '0%';
      this.meterValEl.textContent = '-96.0 dB';
      return;
    }
    const pct = Math.max(0, Math.min(100, ((rmsDb + 60) / 60) * 100));
    this.meterFillEl.style.width = `${pct.toFixed(1)}%`;
    this.meterValEl.textContent = `${rmsDb.toFixed(1)} dB`;
  }

  private drawCanvas(rt?: {
    bins: Uint8Array;
    rmsDb: number;
    isPlaying: boolean;
    mode: AuditionTargetMode | null;
  }): void {
    if (!this.inspection) return;

    if (this.displayMode === 'log-curve') {
      this.drawSharedLogCurveMode();
      return;
    }

    if (!this.canvas) return;
    const wrap = this.canvas.parentElement;
    if (!wrap) return;

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const width = Math.max(300, wrap.clientWidth);
    const height = Math.max(110, wrap.clientHeight);

    if (
      this.canvas.width !== Math.round(width * dpr) ||
      this.canvas.height !== Math.round(height * dpr)
    ) {
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
    }

    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);

    // Theme-aware background fill
    const bgColor =
      this.displayMode === 'spectrogram'
        ? resolveThemeToken('--color-lcd-bg', '#102216')
        : resolveThemeToken('--color-panel-surface', '#151f2e');
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);

    if (this.displayMode === 'spectrogram') {
      this.drawSpectrogramMode(ctx, width, height);
    } else if (this.displayMode === 'partials') {
      this.drawPartialsMode(ctx, width, height, rt);
    } else if (this.displayMode === 'loop-editor') {
      this.drawLoopEditorMode(ctx, width, height);
    } else {
      this.drawWaveformAbMode(ctx, width, height, rt);
    }

    ctx.restore();
  }

  private drawSharedLogCurveMode(): void {
    if (!this.sharedPlotterWrap || !this.inspection) return;
    const wrap = this.sharedPlotterWrap.parentElement;
    const width = Math.max(320, wrap?.clientWidth || 640);
    const height = Math.max(110, wrap?.clientHeight || 140);

    this.sharedPlotter?.destroy();
    this.sharedPlotterWrap.innerHTML = '';

    this.sharedPlotter = new SpectrumPlotter(this.sharedPlotterWrap, {
      width,
      height,
      minDb: -60,
      maxDb: 0,
      gridColor: resolveThemeToken('--color-panel-border', 'rgba(0, 195, 255, 0.2)'),
      textColor: resolveThemeToken('--color-text-muted', '#7e9bb5'),
    });

    // Build 64-point log-frequency dB curves for Target (Original STFT mean), Model (Active B/C Partials), and Residual
    const numPoints = 64;
    const targetCurve: number[] = [];
    const modelCurve: number[] = [];
    const residualCurve: number[] = [];

    const { spectrogram, summary } = this.inspection;
    const modelPartials =
      this.keyboardMode === 'enhanced'
        ? (this.inspection.enhancedPartials ?? summary.amplitudes)
        : (this.inspection.legacyPartials ?? summary.amplitudes);
    const f0 = Math.max(20, summary.detectedF0Hz);
    const logMin = Math.log10(20);
    const logMax = Math.log10(20000);

    for (let i = 0; i < numPoints; i++) {
      const normX = i / (numPoints - 1);
      const freqHz = Math.pow(10, logMin + normX * (logMax - logMin));

      // Interpolate average STFT magnitude at freqHz
      const binPos = Math.min(
        spectrogram.binCount - 1,
        Math.max(0, Math.round((freqHz / Math.max(1, spectrogram.maxFreqHz)) * (spectrogram.binCount - 1)))
      );
      let meanNorm = 0;
      for (let c = 0; c < spectrogram.frameCount; c++) {
        meanNorm += spectrogram.magnitudes[c]?.[binPos] ?? 0;
      }
      meanNorm /= Math.max(1, spectrogram.frameCount);
      const targetDb = -60 + meanNorm * 58;

      // Nearest harmonic partial amplitude
      const harmIdx = clamp(Math.round(freqHz / f0) - 1, 0, 63);
      const pAmp = modelPartials[harmIdx] ?? 0;
      const modelDb = pAmp > 1e-4 ? Math.max(-60, linearToDb(pAmp)) : -58;

      const resDb = clamp(-48 + Math.abs(targetDb - modelDb) * 0.6, -60, 0);

      targetCurve.push(Number(targetDb.toFixed(1)));
      modelCurve.push(Number(modelDb.toFixed(1)));
      residualCurve.push(Number(resDb.toFixed(1)));
    }

    this.sharedPlotter.render({
      target: targetCurve,
      model: modelCurve,
      residual: residualCurve,
    });
  }

  private drawSpectrogramMode(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number
  ): void {
    if (!this.inspection) return;
    const spectrogram = this.getActiveSpectrogram() ?? this.inspection.spectrogram;
    const partialTracks = this.getActivePartialTracks();
    const cols = Math.max(1, spectrogram.frameCount);
    const rows = Math.max(1, spectrogram.binCount);
    const cellW = width / cols;
    const cellH = height / rows;
    const layerColors = getLayerColors();

    // 1. Render STFT magnitude heatmap for the active source (A: Original, B: Legacy DSP, or C: Enhanced DSP)
    for (let c = 0; c < cols; c++) {
      const colMags = spectrogram.magnitudes[c];
      if (!colMags) continue;
      const x = c * cellW;
      for (let r = 0; r < rows; r++) {
        const val = colMags[r] ?? 0;
        if (val <= 0.02) continue;
        const y = height - (r + 1) * cellH;
        ctx.fillStyle = this.magnitudeToHeatColor(val);
        ctx.fillRect(x, y, Math.ceil(cellW), Math.ceil(cellH));
      }
    }

    // Subtle frequency grid lines
    ctx.strokeStyle = resolveThemeToken('--color-panel-border', 'rgba(0, 195, 255, 0.2)');
    ctx.lineWidth = 1;
    for (let g = 1; g <= 4; g++) {
      const y = (height * g) / 5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // 2. Render Partial Trajectories Overlay color-coded by layer
    if (this.showPartialsOverlay && partialTracks.length > 0) {
      const maxFreq = Math.max(1, spectrogram.maxFreqHz);
      for (const track of partialTracks) {
        if (track.frames.length === 0) continue;
        const color = layerColors[track.layerIndex % layerColors.length];
        ctx.strokeStyle = color;
        ctx.lineWidth = track.partialIndex === 1 ? 2.2 : 1.35;
        ctx.globalAlpha = Math.max(
          0.4,
          Math.min(0.95, 0.4 + track.meanAmplitude * 1.4)
        );

        ctx.beginPath();
        for (let i = 0; i < track.frames.length; i++) {
          const pt = track.frames[i];
          const x = pt.timeNorm * width;
          const y = height - Math.min(1, pt.freqHz / maxFreq) * height;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1.0;
    }

    // 3. Source mode badge in top-left corner
    const badgeLabel =
      this.keyboardMode === 'enhanced'
        ? 'C: ENHANCED DSP RESYNTHESIS STFT + TRAJECTORIES'
        : this.keyboardMode === 'resynthesis'
          ? 'B: LEGACY SCAPE/SPHERE RESYNTHESIS STFT + TRAJECTORIES'
          : 'A: ORIGINAL SAMPLE STFT + DETECTED PARTIAL TRAJECTORIES';
    ctx.font = 'bold 10px monospace';
    ctx.fillStyle =
      this.keyboardMode === 'original'
        ? resolveThemeToken('--color-cable-midi-in', '#06b6d4')
        : this.keyboardMode === 'enhanced'
          ? resolveThemeToken('--color-accent', '#00e676')
          : resolveThemeToken('--color-warning', '#ffb142');
    ctx.fillText(badgeLabel, 8, 14);
  }

  private drawPartialsMode(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    rt?: {
      bins: Uint8Array;
      rmsDb: number;
      isPlaying: boolean;
      mode: AuditionTargetMode | null;
    }
  ): void {
    if (!this.inspection) return;
    const { summary } = this.inspection;
    const activePartials = this.getActivePartials();
    const partialTracks = this.getActivePartialTracks();
    const padBottom = 18;
    const padTop = 20;
    const plotH = Math.max(40, height - padBottom - padTop);
    const layerColors = getLayerColors();
    const mutedColor = resolveThemeToken('--color-text-muted', '#7e9bb5');
    const accentColor = resolveThemeToken('--color-accent', '#00e676');
    const warningColor = resolveThemeToken('--color-warning', '#ffb142');
    const infoColor = resolveThemeToken('--color-cable-midi-in', '#06b6d4');

    // Horizontal dB grid lines
    ctx.strokeStyle = resolveThemeToken('--color-panel-border', 'rgba(0, 195, 255, 0.2)');
    ctx.lineWidth = 1;
    for (let g = 1; g <= 3; g++) {
      const y = padTop + (plotH * g) / 4;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Layer lookup map
    const layerByPartial = new Map<number, number>();
    for (const t of partialTracks) {
      layerByPartial.set(t.partialIndex, t.layerIndex);
    }

    const barSlotW = width / 64;
    const barW = Math.max(2, barSlotW * 0.66);

    for (let k = 0; k < 64; k++) {
      const amp = activePartials[k] ?? 0;
      const relDb = linearToDb(amp, -72, 1e-5);
      const normH = clamp((relDb + 60) / 60, 0.02, 1);
      const bh = normH * plotH;
      const x = k * barSlotW + (barSlotW - barW) * 0.5;
      const y = padTop + plotH - bh;

      const layerIdx = layerByPartial.get(k + 1) ?? 0;
      ctx.fillStyle = layerColors[layerIdx % layerColors.length];
      ctx.globalAlpha = amp > 1e-4 ? 0.9 : 0.22;
      ctx.fillRect(x, y, barW, bh);

      // When viewing B (Legacy) or C (Enhanced), draw reference tick of A (Original) for direct visual comparison
      if (this.keyboardMode !== 'original') {
        const origAmp = summary.amplitudes[k] ?? 0;
        if (origAmp > 1e-4) {
          const origDb = linearToDb(origAmp, -72, 1e-5);
          const origNormH = clamp((origDb + 60) / 60, 0.02, 1);
          const origY = padTop + plotH - origNormH * plotH;
          ctx.fillStyle = infoColor;
          ctx.globalAlpha = 0.85;
          ctx.fillRect(x - 1, origY - 1, barW + 2, 2);
        }
      }

      // Harmonic number labels every 8 partials
      if (k === 0 || (k + 1) % 8 === 0) {
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = mutedColor;
        ctx.font = '9px monospace';
        ctx.fillText(`H${k + 1}`, x - 2, height - 4);
      }
    }
    ctx.globalAlpha = 1.0;

    // Mode header label
    ctx.font = 'bold 10px monospace';
    ctx.fillStyle =
      this.keyboardMode === 'original'
        ? infoColor
        : this.keyboardMode === 'enhanced'
          ? accentColor
          : warningColor;
    const modeTitle =
      this.keyboardMode === 'enhanced'
        ? 'C: ENHANCED DSP 64 PARTIALS (CYAN TICKS = A: ORIGINAL REFERENCE)'
        : this.keyboardMode === 'resynthesis'
          ? 'B: LEGACY SCAPE/SPHERE 64 PARTIALS (CYAN TICKS = A: ORIGINAL REFERENCE)'
          : 'A: ORIGINAL SAMPLE 64 HARMONIC PARTIALS';
    ctx.fillText(modeTitle, 8, 14);

    // Real-time Web Audio FFT overlay curve during playback
    if (rt && rt.isPlaying && rt.bins.length > 0) {
      ctx.strokeStyle =
        rt.mode === 'enhanced'
          ? accentColor
          : rt.mode === 'resynthesis'
            ? warningColor
            : infoColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      const n = Math.min(64, rt.bins.length);
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * width;
        const norm = rt.bins[i] / 255.0;
        const y = padTop + plotH * (1.0 - norm);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  private drawWaveformAbMode(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    rt?: {
      bins: Uint8Array;
      rmsDb: number;
      isPlaying: boolean;
      mode: AuditionTargetMode | null;
    }
  ): void {
    if (!this.inspection) return;
    const { waveformPeaks, resynthPeaks } = this.inspection;
    const enhancedPeaks = this.inspection.enhancedResynthPeaks ?? resynthPeaks;
    const laneH = height / 3;
    const origColor = resolveThemeToken('--color-cable-midi-in', '#06b6d4');
    const legacyColor = resolveThemeToken('--color-warning', '#ffb142');
    const enhancedColor = resolveThemeToken('--color-accent', '#00e676');
    const borderColor = resolveThemeToken('--color-panel-border-strong', 'rgba(0, 195, 255, 0.45)');
    const dimGridColor = resolveThemeToken('--color-panel-border', 'rgba(0, 195, 255, 0.2)');

    // Divider lines between A (top), B (middle), and C (bottom)
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1;
    for (let div = 1; div <= 2; div++) {
      const yDiv = laneH * div;
      ctx.beginPath();
      ctx.moveTo(0, yDiv);
      ctx.lineTo(width, yDiv);
      ctx.stroke();
    }

    const drawEnvelope = (
      peaks: { min: number[]; max: number[] },
      centerY: number,
      ampSpan: number,
      color: string,
      isHighlighted: boolean
    ) => {
      const cols = peaks.max.length;
      if (cols === 0) return;
      const colW = width / cols;

      // Center zero-axis
      ctx.strokeStyle = dimGridColor;
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(width, centerY);
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.globalAlpha = isHighlighted ? 0.96 : 0.68;
      for (let c = 0; c < cols; c++) {
        const minV = Math.max(-1, Math.min(1, peaks.min[c] ?? 0));
        const maxV = Math.max(-1, Math.min(1, peaks.max[c] ?? 0));
        const yTop = centerY - maxV * ampSpan;
        const yBot = centerY - minV * ampSpan;
        const h = Math.max(1.5, yBot - yTop);
        ctx.fillRect(c * colW, yTop, Math.max(1, colW - 0.5), h);
      }
      ctx.globalAlpha = 1.0;
    };

    const activeMode = rt?.isPlaying && rt.mode ? rt.mode : this.keyboardMode;

    // Lane 1 (Top): Original Sample (A)
    drawEnvelope(
      waveformPeaks,
      laneH * 0.54,
      laneH * 0.40,
      origColor,
      activeMode === 'original'
    );

    // Lane 2 (Middle): Legacy Additive Scape/Sphere Resynthesis (B)
    drawEnvelope(
      resynthPeaks,
      laneH * 1.54,
      laneH * 0.40,
      legacyColor,
      activeMode === 'resynthesis'
    );

    // Lane 3 (Bottom): Enhanced DSP Resynthesis (C)
    drawEnvelope(
      enhancedPeaks,
      laneH * 2.54,
      laneH * 0.40,
      enhancedColor,
      activeMode === 'enhanced'
    );

    // Labels
    ctx.font = 'bold 10px monospace';
    ctx.fillStyle = origColor;
    ctx.fillText(
      `A: ORIGINAL SAMPLE (${waveformPeaks.rmsDb} dB RMS)${activeMode === 'original' ? ' [ACTIVE]' : ''}`,
      8,
      13
    );
    ctx.fillStyle = legacyColor;
    ctx.fillText(
      `B: LEGACY SCAPE/SPHERE RESYNTHESIS (${resynthPeaks.rmsDb} dB RMS)${activeMode === 'resynthesis' ? ' [ACTIVE]' : ''}`,
      8,
      laneH + 13
    );
    ctx.fillStyle = enhancedColor;
    ctx.fillText(
      `C: ENHANCED DSP RESYNTHESIS (${enhancedPeaks.rmsDb} dB RMS)${activeMode === 'enhanced' ? ' [ACTIVE]' : ''}`,
      8,
      laneH * 2 + 13
    );
  }

  // ── Fase 13: Interactive Waveform Loop Editor & Zero-Crossing Seam Magnifier ──

  private ensureLoopData(): ZoneLoopEditorData | null {
    if (!this.loopData) {
      this.loopData = this.handlers.getLoopEditorData?.() ?? null;
    }
    return this.loopData;
  }

  private getLoopViewFrameWindow(totalFrames: number): { viewStart: number; viewEnd: number } {
    const zoom = clamp(this.loopZoomFactor, 1, 32);
    const span = Math.max(64, Math.round(totalFrames / zoom));
    const half = Math.floor(span * 0.5);
    const center = Math.round(clamp(this.loopViewCenterNorm, 0, 1) * totalFrames);
    const viewStart = clamp(center - half, 0, Math.max(0, totalFrames - span));
    const viewEnd = clamp(viewStart + span, viewStart + 1, totalFrames);
    return { viewStart, viewEnd };
  }

  private renderLoopEditorToolbarHtml(): string {
    const d = this.ensureLoopData();
    if (!d) {
      return `<div class="spectral-hover-readout">No sample loaded for loop editing</div>`;
    }
    const sr = Math.max(1, d.sampleRate);
    const startSec = (d.loopStart / sr).toFixed(3);
    const endSec = (d.loopEnd / sr).toFixed(3);
    const loopLenSec = (Math.max(0, d.loopEnd - d.loopStart) / sr).toFixed(3);

    return `
      <div class="loop-editor-toolbar">
        <label class="loop-ed-field" title="Loop playback mode">
          <span>MODE</span>
          <select id="sel-loop-ed-mode" class="loop-ed-select">
            <option value="no_loop" ${d.loopMode === 'no_loop' ? 'selected' : ''}>No Loop</option>
            <option value="loop_continuous" ${d.loopMode === 'loop_continuous' ? 'selected' : ''}>Continuous (Forward)</option>
            <option value="ping_pong" ${d.loopMode === 'ping_pong' ? 'selected' : ''}>Ping-Pong (⇄ Alternating)</option>
            <option value="loop_sustain" ${d.loopMode === 'loop_sustain' ? 'selected' : ''}>Sustain</option>
            <option value="loop_backward" ${d.loopMode === 'loop_backward' ? 'selected' : ''}>Reverse Loop</option>
            <option value="one_shot" ${d.loopMode === 'one_shot' ? 'selected' : ''}>One Shot</option>
          </select>
        </label>
        <label class="loop-ed-field" title="Loop Start in sample frames (${startSec}s)">
          <span>START</span>
          <input type="number" id="inp-loop-ed-start" class="loop-ed-input" min="0" max="${Math.max(0, d.totalFrames - 2)}" value="${d.loopStart}" />
          <span class="loop-ed-unit" id="lbl-loop-ed-start-sec">${startSec}s</span>
        </label>
        <label class="loop-ed-field" title="Loop End in sample frames (${endSec}s • Len: ${loopLenSec}s)">
          <span>END</span>
          <input type="number" id="inp-loop-ed-end" class="loop-ed-input" min="1" max="${d.totalFrames}" value="${d.loopEnd}" />
          <span class="loop-ed-unit" id="lbl-loop-ed-end-sec">${endSec}s</span>
        </label>
        <label class="loop-ed-field" title="Equal-power loop crossfade duration (ms)">
          <span>X-FADE</span>
          <input type="number" id="inp-loop-ed-xfade" class="loop-ed-input loop-ed-input-sm" min="0" max="2000" value="${d.loopCrossfadeMs}" />
          <span class="loop-ed-unit">ms</span>
        </label>
        <button type="button" class="btn-overlay-toggle ${this.loopSnapZeroCrossing ? 'is-on' : ''}" id="btn-loop-ed-snap" title="Snap dragged Loop Start / Loop End handles to nearest rising zero-crossing">
          0-X Snap: ${this.loopSnapZeroCrossing ? 'ON' : 'OFF'}
        </button>
        <label class="loop-ed-field" title="Auto-Loop algorithm">
          <select id="sel-loop-ed-algo" class="loop-ed-select">
            <option value="pitch_periodic" ${this.loopSelectedAlgo === 'pitch_periodic' ? 'selected' : ''}>F0 Period-Lock</option>
            <option value="ncc_zc" ${this.loopSelectedAlgo === 'ncc_zc' ? 'selected' : ''}>NCC Zero-Crossing</option>
            <option value="min_seam_energy" ${this.loopSelectedAlgo === 'min_seam_energy' ? 'selected' : ''}>Min Seam Discontinuity</option>
            <option value="equal_power_xfade" ${this.loopSelectedAlgo === 'equal_power_xfade' ? 'selected' : ''}>Equal-Power X-Fade</option>
          </select>
        </label>
        <button type="button" class="btn-overlay-toggle is-action-accent" id="btn-loop-ed-autofind" title="Automatically find optimal click-free loop points using selected algorithm">
          ${ICONS.cpu} Run Auto-Loop
        </button>
        <button type="button" class="btn-overlay-toggle" id="btn-loop-ed-zoom-in" title="Zoom In Waveform">
          Zoom +
        </button>
        <button type="button" class="btn-overlay-toggle" id="btn-loop-ed-zoom-reset" title="Reset Waveform Zoom (1x)">
          1x
        </button>
        <button type="button" class="btn-overlay-toggle is-on" id="btn-loop-ed-play" title="Audition sample in continuous hardware loop (updates live while dragging markers)">
          ${this.handlers.getRealtimeSpectrum?.()?.isPlaying ? `■ Stop Loop` : `${ICONS.play} Loop Play`}
        </button>
      </div>
      <div class="spectral-hover-readout" id="spectral-hover-readout">
        Drag L-START / L-END handles (or double-click waveform) • Right pane: Seam Magnifier
      </div>
    `;
  }

  private syncLoopToolbarDom(): void {
    const d = this.loopData;
    if (!d) return;
    const sr = Math.max(1, d.sampleRate);
    const inpStart = this.container.querySelector('#inp-loop-ed-start') as HTMLInputElement | null;
    const inpEnd = this.container.querySelector('#inp-loop-ed-end') as HTMLInputElement | null;
    const inpXfade = this.container.querySelector('#inp-loop-ed-xfade') as HTMLInputElement | null;
    const lblStart = this.container.querySelector('#lbl-loop-ed-start-sec');
    const lblEnd = this.container.querySelector('#lbl-loop-ed-end-sec');
    if (inpStart && document.activeElement !== inpStart) inpStart.value = String(d.loopStart);
    if (inpEnd && document.activeElement !== inpEnd) inpEnd.value = String(d.loopEnd);
    if (inpXfade && document.activeElement !== inpXfade) inpXfade.value = String(d.loopCrossfadeMs);
    if (lblStart) lblStart.textContent = `${(d.loopStart / sr).toFixed(3)}s`;
    if (lblEnd) lblEnd.textContent = `${(d.loopEnd / sr).toFixed(3)}s`;
  }

  private bindLoopEditorEvents(): void {
    const toolbarEl = this.container.querySelector('.loop-editor-toolbar') as HTMLElement | null;
    toolbarEl?.addEventListener('pointerdown', (e) => e.stopPropagation());
    toolbarEl?.addEventListener('mousedown', (e) => e.stopPropagation());
    toolbarEl?.addEventListener('click', (e) => e.stopPropagation());

    const selMode = this.container.querySelector('#sel-loop-ed-mode') as HTMLSelectElement | null;
    const inpStart = this.container.querySelector('#inp-loop-ed-start') as HTMLInputElement | null;
    const inpEnd = this.container.querySelector('#inp-loop-ed-end') as HTMLInputElement | null;
    const inpXfade = this.container.querySelector('#inp-loop-ed-xfade') as HTMLInputElement | null;

    selMode?.addEventListener('change', () => {
      const d = this.ensureLoopData();
      if (!d) return;
      d.loopMode = selMode.value as LoopMode;
      this.handlers.onUpdateLiveLoopPoints?.(
        d.loopStart,
        d.loopEnd,
        d.sampleRate,
        d.loopMode !== 'no_loop' && d.loopMode !== 'one_shot'
      );
      this.handlers.onUpdateLoopParams?.({
        loopMode: d.loopMode,
        loopStart: d.loopStart,
        loopEnd: d.loopEnd,
      });
      this.drawCanvas();
    });

    const commitStartEndFromInputs = () => {
      const d = this.ensureLoopData();
      if (!d) return;
      let nextStart = clamp(parseInt(inpStart?.value || '0', 10) || 0, 0, Math.max(0, d.totalFrames - 2));
      let nextEnd = clamp(parseInt(inpEnd?.value || String(d.totalFrames), 10) || d.totalFrames, nextStart + 1, d.totalFrames);
      if (this.loopSnapZeroCrossing) {
        nextStart = snapFrameToRisingZeroCrossing(d.monoPcm, nextStart, 256);
        nextEnd = Math.max(nextStart + 1, snapFrameToRisingZeroCrossing(d.monoPcm, nextEnd, 256));
      }
      d.loopStart = nextStart;
      d.loopEnd = nextEnd;
      this.syncLoopToolbarDom();
      this.handlers.onUpdateLiveLoopPoints?.(d.loopStart, d.loopEnd, d.sampleRate, d.loopMode !== 'no_loop');
      this.handlers.onUpdateLoopParams?.({ loopStart: d.loopStart, loopEnd: d.loopEnd });
      this.drawCanvas();
    };

    inpStart?.addEventListener('change', commitStartEndFromInputs);
    inpEnd?.addEventListener('change', commitStartEndFromInputs);

    inpXfade?.addEventListener('change', () => {
      const d = this.ensureLoopData();
      if (!d) return;
      d.loopCrossfadeMs = clamp(parseInt(inpXfade.value || '0', 10) || 0, 0, 2000);
      this.syncLoopToolbarDom();
      this.handlers.onUpdateLoopParams?.({ loopCrossfadeMs: d.loopCrossfadeMs });
      this.drawCanvas();
    });

    this.container.querySelector('#btn-loop-ed-snap')?.addEventListener('click', () => {
      this.loopSnapZeroCrossing = !this.loopSnapZeroCrossing;
      this.renderShell();
      this.drawCanvas();
    });

    this.container.querySelector('#sel-loop-ed-algo')?.addEventListener('change', (e) => {
      this.loopSelectedAlgo = (e.target as HTMLSelectElement).value as AutoLoopAlgorithm;
    });

    this.container.querySelector('#btn-loop-ed-autofind')?.addEventListener('click', () => {
      const d = this.ensureLoopData();
      if (!d) return;
      const candStart = d.loopStart > 0 ? d.loopStart : Math.floor(d.totalFrames * 0.2);
      const candEnd = d.loopEnd > candStart + 64 ? d.loopEnd : Math.floor(d.totalFrames * 0.85);
      const knownF0 = d.rootKey ? 440 * Math.pow(2, (d.rootKey - 69) / 12) : undefined;
      const res = findSmartAutoLoop(d.monoPcm, d.sampleRate, {
        algorithm: this.loopSelectedAlgo,
        candidateStartFrame: candStart,
        candidateEndFrame: candEnd,
        knownF0Hz: knownF0,
        targetCrossfadeMs: d.loopCrossfadeMs > 0 ? d.loopCrossfadeMs : 20,
      });
      d.loopStart = res.loopStart;
      d.loopEnd = res.loopEnd;
      d.loopCrossfadeMs = res.loopCrossfadeMs;
      if (d.loopMode === 'no_loop') {
        d.loopMode = 'loop_continuous';
      }
      this.renderShell();
      this.drawCanvas();
      this.handlers.onUpdateLiveLoopPoints?.(d.loopStart, d.loopEnd, d.sampleRate, true);
      this.handlers.onUpdateLoopParams?.({
        loopMode: d.loopMode,
        loopStart: d.loopStart,
        loopEnd: d.loopEnd,
        loopCrossfadeMs: d.loopCrossfadeMs,
      });
    });

    this.container.querySelector('#btn-loop-ed-zoom-in')?.addEventListener('click', () => {
      const d = this.ensureLoopData();
      if (d) {
        this.loopViewCenterNorm = ((d.loopStart + d.loopEnd) * 0.5) / Math.max(1, d.totalFrames);
      }
      this.loopZoomFactor = this.loopZoomFactor >= 16 ? 1 : this.loopZoomFactor * 2;
      this.drawCanvas();
    });

    this.container.querySelector('#btn-loop-ed-zoom-reset')?.addEventListener('click', () => {
      this.loopZoomFactor = 1.0;
      this.loopViewCenterNorm = 0.5;
      this.drawCanvas();
    });

    this.container.querySelector('#btn-loop-ed-play')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isPlaying = Boolean(this.handlers.getRealtimeSpectrum?.()?.isPlaying);
      if (isPlaying) {
        this.handlers.onStopAudition?.();
        this.renderShell();
        this.drawCanvas();
        return;
      }
      const d = this.ensureLoopData();
      if (!d) return;
      if (d.loopEnd <= d.loopStart) {
        d.loopStart = Math.floor(d.totalFrames * 0.2);
        d.loopEnd = Math.max(d.loopStart + 1, Math.floor(d.totalFrames * 0.85));
      }
      if (d.loopMode === 'no_loop') {
        d.loopMode = 'loop_continuous';
      }
      this.handlers.onUpdateLoopParams?.({
        loopMode: d.loopMode,
        loopStart: d.loopStart,
        loopEnd: d.loopEnd,
      });
      this.handlers.onAuditionLoop?.({
        loopStartFrame: d.loopStart,
        loopEndFrame: d.loopEnd,
        loopEnabled: true,
      });
      this.renderShell();
      this.drawCanvas();
      this.ensureRealtimeLoop();
    });

    // Pointer drag & wheel zoom on canvas
    if (this.canvas) {
      const canvasEl = this.canvas;
      const getWavePaneMetrics = (clientX: number, clientY: number) => {
        const rect = canvasEl.getBoundingClientRect();
        const waveW = rect.width * 0.7;
        const relX = clientX - rect.left;
        const relY = clientY - rect.top;
        const normX = clamp(relX / Math.max(1, waveW), 0, 1);
        return { rect, waveW, relX, relY, normX };
      };

      canvasEl.addEventListener('pointerdown', (e) => {
        if (this.displayMode !== 'loop-editor') return;
        const d = this.ensureLoopData();
        if (!d) return;
        const { rect, waveW, relX, relY } = getWavePaneMetrics(e.clientX, e.clientY);
        if (relX > waveW) return; // Clicked inside Seam Magnifier pane
        if (relY > rect.height - 32) return; // Ignore clicks in bottom overlay bar zone

        const { viewStart, viewEnd } = this.getLoopViewFrameWindow(d.totalFrames);
        const viewSpan = Math.max(1, viewEnd - viewStart);
        const startX = ((d.loopStart - viewStart) / viewSpan) * waveW;
        const endX = ((d.loopEnd - viewStart) / viewSpan) * waveW;

        const distStart = Math.abs(relX - startX);
        const distEnd = Math.abs(relX - endX);
        if (distStart <= 18 && distStart <= distEnd) {
          this.draggingLoopHandle = 'start';
          canvasEl.setPointerCapture(e.pointerId);
        } else if (distEnd <= 18) {
          this.draggingLoopHandle = 'end';
          canvasEl.setPointerCapture(e.pointerId);
        }
      });

      canvasEl.addEventListener('dblclick', (e) => {
        if (this.displayMode !== 'loop-editor') return;
        const d = this.ensureLoopData();
        if (!d) return;
        const { rect, waveW, relX, relY, normX } = getWavePaneMetrics(e.clientX, e.clientY);
        if (relX > waveW || relY > rect.height - 32) return;
        const { viewStart, viewEnd } = this.getLoopViewFrameWindow(d.totalFrames);
        const viewSpan = Math.max(1, viewEnd - viewStart);
        const startX = ((d.loopStart - viewStart) / viewSpan) * waveW;
        const endX = ((d.loopEnd - viewStart) / viewSpan) * waveW;
        const distStart = Math.abs(relX - startX);
        const distEnd = Math.abs(relX - endX);
        this.draggingLoopHandle = distStart <= distEnd ? 'start' : 'end';
        const targetFrame = Math.round(viewStart + normX * viewSpan);
        this.applyDraggedLoopFrame(d, targetFrame);
        this.draggingLoopHandle = null;
        this.handlers.onUpdateLoopParams?.({
          loopStart: d.loopStart,
          loopEnd: d.loopEnd,
        });
      });

      canvasEl.addEventListener('pointermove', (e) => {
        if (this.displayMode !== 'loop-editor' || !this.draggingLoopHandle) return;
        const d = this.ensureLoopData();
        if (!d) return;
        const { normX } = getWavePaneMetrics(e.clientX, e.clientY);
        const { viewStart, viewEnd } = this.getLoopViewFrameWindow(d.totalFrames);
        const targetFrame = Math.round(viewStart + normX * Math.max(1, viewEnd - viewStart));
        this.applyDraggedLoopFrame(d, targetFrame);
      });

      const finishDrag = (e: PointerEvent) => {
        if (!this.draggingLoopHandle) return;
        this.draggingLoopHandle = null;
        try {
          canvasEl.releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }
        const d = this.loopData;
        if (d) {
          this.handlers.onUpdateLoopParams?.({
            loopStart: d.loopStart,
            loopEnd: d.loopEnd,
          });
        }
      };

      canvasEl.addEventListener('pointerup', finishDrag);
      canvasEl.addEventListener('pointercancel', finishDrag);

      canvasEl.addEventListener(
        'wheel',
        (e) => {
          if (this.displayMode !== 'loop-editor') return;
          e.preventDefault();
          const d = this.ensureLoopData();
          if (!d) return;
          const { normX } = getWavePaneMetrics(e.clientX, e.clientY);
          const { viewStart, viewEnd } = this.getLoopViewFrameWindow(d.totalFrames);
          const focusFrame = viewStart + normX * (viewEnd - viewStart);
          this.loopViewCenterNorm = clamp(focusFrame / Math.max(1, d.totalFrames), 0, 1);
          const factor = e.deltaY < 0 ? 1.35 : 1 / 1.35;
          this.loopZoomFactor = clamp(this.loopZoomFactor * factor, 1, 32);
          this.drawCanvas();
        },
        { passive: false }
      );
    }
  }

  private applyDraggedLoopFrame(d: ZoneLoopEditorData, rawFrame: number): void {
    const minGap = Math.max(16, Math.round(d.sampleRate * 0.005));
    if (this.draggingLoopHandle === 'start') {
      let f = clamp(rawFrame, 0, Math.max(0, d.loopEnd - minGap));
      if (this.loopSnapZeroCrossing) {
        f = clamp(snapFrameToRisingZeroCrossing(d.monoPcm, f, 256), 0, Math.max(0, d.loopEnd - minGap));
      }
      d.loopStart = f;
    } else if (this.draggingLoopHandle === 'end') {
      let f = clamp(rawFrame, d.loopStart + minGap, d.totalFrames);
      if (this.loopSnapZeroCrossing) {
        f = clamp(snapFrameToRisingZeroCrossing(d.monoPcm, f, 256), d.loopStart + minGap, d.totalFrames);
      }
      d.loopEnd = f;
    }
    this.syncLoopToolbarDom();
    this.handlers.onUpdateLiveLoopPoints?.(
      d.loopStart,
      d.loopEnd,
      d.sampleRate,
      d.loopMode !== 'no_loop'
    );
    this.drawCanvas();
  }

  private drawLoopEditorMode(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number
  ): void {
    const d = this.ensureLoopData();
    if (!d) return;

    const waveW = Math.floor(width * 0.7);
    const seamX0 = waveW + 1;
    const seamW = Math.max(80, width - seamX0);

    const origColor = resolveThemeToken('--color-cable-midi-in', '#06b6d4');
    const accentColor = resolveThemeToken('--color-accent', '#00e676');
    const warningColor = resolveThemeToken('--color-warning', '#ffb142');
    const mutedColor = resolveThemeToken('--color-text-muted', '#7e9bb5');
    const borderColor = resolveThemeToken('--color-panel-border-strong', 'rgba(0, 195, 255, 0.45)');
    const dimGridColor = resolveThemeToken('--color-panel-border', 'rgba(0, 195, 255, 0.2)');

    const { viewStart, viewEnd } = this.getLoopViewFrameWindow(d.totalFrames);
    const viewSpan = Math.max(1, viewEnd - viewStart);
    const env = computeZoomedWaveformEnvelope(d.monoPcm, viewStart, viewEnd, Math.min(480, Math.max(120, Math.floor(waveW / 2))));

    const centerY = height * 0.54;
    const ampSpan = height * 0.36;

    // 1. Center zero-axis in Waveform Pane
    ctx.strokeStyle = dimGridColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(waveW, centerY);
    ctx.stroke();

    // 2. Shaded active loop region [loopStart .. loopEnd]
    const loopStartX = clamp(((d.loopStart - viewStart) / viewSpan) * waveW, 0, waveW);
    const loopEndX = clamp(((d.loopEnd - viewStart) / viewSpan) * waveW, 0, waveW);
    if (loopEndX > loopStartX) {
      ctx.fillStyle = accentColor;
      ctx.globalAlpha = 0.13;
      ctx.fillRect(loopStartX, 20, loopEndX - loopStartX, height - 24);
      ctx.globalAlpha = 1.0;

      // Crossfade ramp before loopEnd
      const xfadeFrames = Math.round((d.loopCrossfadeMs / 1000) * d.sampleRate);
      if (xfadeFrames > 0) {
        const xfadeStartX = clamp(((d.loopEnd - xfadeFrames - viewStart) / viewSpan) * waveW, loopStartX, loopEndX);
        if (loopEndX > xfadeStartX + 1) {
          ctx.fillStyle = warningColor;
          ctx.globalAlpha = 0.18;
          ctx.fillRect(xfadeStartX, 20, loopEndX - xfadeStartX, height - 24);
          ctx.globalAlpha = 1.0;

          ctx.strokeStyle = warningColor;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(xfadeStartX, height - 6);
          ctx.lineTo(loopEndX, 22);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      if (d.loopMode === 'ping_pong') {
        ctx.fillStyle = accentColor;
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('⇄ PING-PONG', (loopStartX + loopEndX) * 0.5, 32);
      } else if (d.loopMode === 'loop_backward') {
        ctx.fillStyle = warningColor;
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('← REVERSE', (loopStartX + loopEndX) * 0.5, 32);
      }
    }

    // 3. Draw Waveform Envelope in Left Pane
    const cols = env.max.length;
    const colW = waveW / Math.max(1, cols);
    for (let c = 0; c < cols; c++) {
      const x = c * colW;
      const inLoop = x >= loopStartX && x <= loopEndX;
      ctx.fillStyle = inLoop ? accentColor : origColor;
      ctx.globalAlpha = inLoop ? 0.92 : 0.58;
      const minV = clamp(env.min[c] ?? 0, -1, 1);
      const maxV = clamp(env.max[c] ?? 0, -1, 1);
      const yTop = centerY - maxV * ampSpan;
      const yBot = centerY - minV * ampSpan;
      ctx.fillRect(x, yTop, Math.max(1, colW - 0.4), Math.max(1.5, yBot - yTop));
    }
    ctx.globalAlpha = 1.0;

    // 4. Draw draggable L-START and L-END markers & flag handles
    const drawMarker = (x: number, label: string, color: string, alignRight: boolean) => {
      if (x < 0 || x > waveW) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, 18);
      ctx.lineTo(x, height - 4);
      ctx.stroke();

      const flagW = 54;
      const flagH = 15;
      const fx = alignRight ? Math.max(0, x - flagW) : Math.min(waveW - flagW, x);
      ctx.fillStyle = color;
      ctx.fillRect(fx, 20, flagW, flagH);
      ctx.fillStyle = resolveThemeToken('--color-panel-surface', '#0d1520');
      ctx.font = 'bold 9px monospace';
      ctx.fillText(label, fx + 4, 31);
    };

    drawMarker(loopStartX, 'L-START', accentColor, false);
    drawMarker(loopEndX, 'L-END', warningColor, true);

    ctx.font = 'bold 10px monospace';
    ctx.fillStyle = origColor;
    const zoomStr = `${this.loopZoomFactor.toFixed(1)}x`;
    ctx.fillText(
      `WAVEFORM LOOP EDITOR (${d.sampleName} • ${d.totalFrames} frames • Zoom ${zoomStr})`,
      8,
      13
    );

    // 5. Vertical divider between Waveform Pane and Seam Magnifier Pane
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(waveW, 0);
    ctx.lineTo(waveW, height);
    ctx.stroke();

    // 6. Right Pane: LOOP SEAM / ZERO-CROSSING MAGNIFIER
    const seam = computeLoopSeamAnalysis(d.monoPcm, d.loopStart, d.loopEnd, 96);
    const midSeamX = seamX0 + seamW * 0.5;

    // Zero-crossing crosshair in Magnifier
    ctx.strokeStyle = dimGridColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(seamX0, centerY);
    ctx.lineTo(width, centerY);
    ctx.moveTo(midSeamX, 20);
    ctx.lineTo(midSeamX, height - 18);
    ctx.stroke();

    const halfW = seamW * 0.46;
    const wFrames = Math.max(1, seam.windowFrames);

    // Ghost continuation curves (dashed)
    ctx.save();
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = mutedColor;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1.2;

    // Ghost post-end on right side of seam
    ctx.beginPath();
    for (let i = 0; i < wFrames; i++) {
      const x = midSeamX + (i / (wFrames - 1)) * halfW;
      const y = centerY - clamp(seam.ghostPostEndSamples[i] ?? 0, -1, 1) * ampSpan * 1.15;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Ghost pre-start on left side of seam
    ctx.beginPath();
    for (let i = 0; i < wFrames; i++) {
      const x = midSeamX - halfW + (i / (wFrames - 1)) * halfW;
      const y = centerY - clamp(seam.ghostPreStartSamples[i] ?? 0, -1, 1) * ampSpan * 1.15;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();

    // Active spliced curve approaching Loop End (left half of Magnifier)
    ctx.strokeStyle = warningColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < wFrames; i++) {
      const x = midSeamX - halfW + (i / (wFrames - 1)) * halfW;
      const y = centerY - clamp(seam.preEndSamples[i] ?? 0, -1, 1) * ampSpan * 1.15;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Active spliced curve departing Loop Start (right half of Magnifier)
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < wFrames; i++) {
      const x = midSeamX + (i / (wFrames - 1)) * halfW;
      const y = centerY - clamp(seam.postStartSamples[i] ?? 0, -1, 1) * ampSpan * 1.15;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Seam splice node circle
    const spliceY = centerY - clamp(seam.postStartSamples[0] ?? 0, -1, 1) * ampSpan * 1.15;
    ctx.fillStyle = seam.seamQualityPercent >= 80 ? accentColor : warningColor;
    ctx.beginPath();
    ctx.arc(midSeamX, spliceY, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // Seam Magnifier header & metrics
    ctx.font = 'bold 10px monospace';
    ctx.fillStyle = seam.seamQualityPercent >= 80 ? accentColor : warningColor;
    ctx.fillText(
      `SEAM MAGNIFIER • QUALITY ${seam.seamQualityPercent}%`,
      seamX0 + 8,
      13
    );
    ctx.font = '9px monospace';
    ctx.fillStyle = mutedColor;
    ctx.fillText(
      `ΔStep: ${seam.stepDiscontinuity.toFixed(4)} | NCC: ${(seam.nccScore * 100).toFixed(0)}%`,
      seamX0 + 8,
      height - 6
    );
  }

  private magnitudeToHeatColor(norm: number): string {
    const v = Math.max(0, Math.min(1, norm));
    if (v < 0.35) {
      const t = v / 0.35;
      const r = Math.round(8 + t * 10);
      const g = Math.round(18 + t * 75);
      const b = Math.round(38 + t * 90);
      return `rgb(${r},${g},${b})`;
    }
    if (v < 0.72) {
      const t = (v - 0.35) / 0.37;
      const r = Math.round(18 + t * 10);
      const g = Math.round(93 + t * 137);
      const b = Math.round(128 - t * 10);
      return `rgb(${r},${g},${b})`;
    }
    const t = (v - 0.72) / 0.28;
    const r = Math.round(28 + t * 227);
    const g = Math.round(230 + t * 25);
    const b = Math.round(118 + t * 100);
    return `rgb(${r},${g},${b})`;
  }
}
