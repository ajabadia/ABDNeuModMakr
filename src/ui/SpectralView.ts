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
import type { ZoneSpectralInspection } from '../core/types';
import { ICONS } from './icons';
import { escAttr, escHtml } from './escape';

export type SpectralDisplayMode =
  | 'spectrogram'
  | 'partials'
  | 'waveform-ab'
  | 'log-curve';
export type AuditionTargetMode = 'original' | 'resynthesis' | 'enhanced' | 'resynator_v2';

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
  onOpenLoopEditorModal?: () => void;
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
  { cssVar: '--color-accent', fallback: '#00c3ff' },
  { cssVar: '--color-warning', fallback: '#ffaa00' },
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
    this.renderShell();
    this.drawCanvas();
    this.ensureRealtimeLoop();
  }

  /**
   * Delegates to open the dedicated Waveform AutoLoop Editor modal.
   */
  public openLoopEditor(): void {
    this.handlers.onOpenLoopEditorModal?.();
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
            <span class="spectral-sample-title" title="${escAttr(sampleName)}">${escHtml(sampleName)}</span>
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
          </div>
        </div>

        <div class="spectral-canvas-wrap" id="spectral-canvas-wrap">
          <canvas id="spectral-canvas" style="display: ${this.displayMode === 'log-curve' ? 'none' : 'block'}"></canvas>
          <div id="shared-spectrum-plotter" class="shared-plotter-mount" style="display: ${this.displayMode === 'log-curve' ? 'block' : 'none'}"></div>
          <div class="spectral-overlay-bar">
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
            <button type="button" class="btn btn-xs ${this.keyboardMode === 'resynator_v2' ? 'btn-accent' : 'btn-outline'}" id="btn-play-resv2" title="Play &amp; Inspect ABDShared Resinator v2 (D: Unified Spectral Surface + 24-Bark Formant Lock + Sonic Matter Shapers)">
              ${ICONS.cpu} D: Resinator v2 (HD)
            </button>
            <button type="button" class="btn btn-xs btn-outline" id="btn-stop-audition" title="Stop Playback [Space]">
              ${ICONS.stop} Stop
            </button>
          </div>

          <div class="ab-keyb-toggle" title="Choose active signal for Graph Inspection &amp; MIDI Keyboard Audition: Original (A), Legacy DSP (B), Enhanced DSP (C), or Resinator v2 (D)">
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
            <button type="button" class="btn-keyb-mode ${this.keyboardMode === 'resynator_v2' ? 'is-active' : ''}" data-keyb="resynator_v2" title="Tocar el teclado MIDI con el nuevo motor Resinator v2 (ABDShared)">
              D: RESINATOR V2
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
          this.renderShell();
          this.drawCanvas();
        }
      });
    });

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
      .querySelector('#btn-play-resv2')
      ?.addEventListener('click', () => {
        if (this.keyboardMode !== 'resynator_v2') {
          this.keyboardMode = 'resynator_v2';
          this.handlers.onKeyboardModeChange('resynator_v2');
          this.renderShell();
        }
        this.handlers.onAuditionZone(zoneId, 'resynator_v2');
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
          ? resolveThemeToken('--color-accent', '#00c3ff')
          : resolveThemeToken('--color-warning', '#ffaa00');
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
    const accentColor = resolveThemeToken('--color-accent', '#00c3ff');
    const warningColor = resolveThemeToken('--color-warning', '#ffaa00');
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
    const legacyColor = resolveThemeToken('--color-warning', '#ffaa00');
    const enhancedColor = resolveThemeToken('--color-accent', '#00c3ff');
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
