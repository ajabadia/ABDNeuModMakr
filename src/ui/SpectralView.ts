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
import type { ZoneSpectralInspection } from '../core/types.ts';
import { ICONS } from './icons.ts';

export type SpectralDisplayMode = 'spectrogram' | 'partials' | 'waveform-ab' | 'log-curve';
export type AuditionTargetMode = 'original' | 'resynthesis';

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

    this.container.innerHTML = `
      <div class="spectral-view-panel">
        <div class="spectral-header">
          <div class="spectral-title-group">
            <span class="panel-badge">${ICONS.wave} SPECTRAL &amp; A/B MONITOR</span>
            <span class="spectral-sample-title" title="${sampleName}">${sampleName}</span>
            <span class="spectral-meta-pill">${(sampleRate / 1000).toFixed(1)} kHz | ${durationSec.toFixed(2)}s</span>
            <span class="spectral-grid-pill ${bandClass}" title="${summary.gridNotice}">
              f0: ${summary.detectedF0Hz.toFixed(2)} Hz (${summary.gridResidualCents.toFixed(1)} ct) | ${summary.activePartials} Partials | ${summary.layerCount} Layer${summary.layerCount > 1 ? 's' : ''}
            </span>
          </div>

          <div class="spectral-mode-tabs">
            <button type="button" class="btn-spec-tab ${this.displayMode === 'spectrogram' ? 'is-active' : ''}" data-mode="spectrogram">
              2D SPECTROGRAM
            </button>
            <button type="button" class="btn-spec-tab ${this.displayMode === 'partials' ? 'is-active' : ''}" data-mode="partials">
              64 PARTIALS
            </button>
            <button type="button" class="btn-spec-tab ${this.displayMode === 'waveform-ab' ? 'is-active' : ''}" data-mode="waveform-ab">
              WAVEFORM A/B
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
            <button type="button" class="btn btn-xs btn-info" id="btn-play-orig" title="Play Original Sample (A) [Space]">
              ${ICONS.play} A: Original (${this.inspection.waveformPeaks.rmsDb} dB)
            </button>
            <button type="button" class="btn btn-xs btn-accent" id="btn-play-resynth" title="Play Additive Scape/Sphere Resynthesis (B)">
              ${ICONS.cpu} B: Resynthesis (${this.inspection.resynthPeaks.rmsDb} dB)
            </button>
            <button type="button" class="btn btn-xs btn-outline" id="btn-stop-audition" title="Stop Playback [Space]">
              ${ICONS.stop} Stop
            </button>
          </div>

          <div class="ab-keyb-toggle" title="Choose whether clicking the bottom MIDI keyboard plays Original (A) or Neural Resynthesis (B)">
            <span class="keyb-mode-label">${ICONS.piano} KEYBOARD AUDITION:</span>
            <button type="button" class="btn-keyb-mode ${this.keyboardMode === 'original' ? 'is-active' : ''}" data-keyb="original">
              A: ORIGINAL
            </button>
            <button type="button" class="btn-keyb-mode ${this.keyboardMode === 'resynthesis' ? 'is-active' : ''}" data-keyb="resynthesis">
              B: RESYNTHESIS
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

    // A/B Audition buttons
    this.container
      .querySelector('#btn-play-orig')
      ?.addEventListener('click', () => {
        this.handlers.onAuditionZone(zoneId, 'original');
        this.ensureRealtimeLoop();
      });

    this.container
      .querySelector('#btn-play-resynth')
      ?.addEventListener('click', () => {
        this.handlers.onAuditionZone(zoneId, 'resynthesis');
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

  private handleCanvasHover(e: MouseEvent): void {
    if (!this.canvas || !this.inspection || !this.hoverInfoEl) return;
    const rect = this.canvas.getBoundingClientRect();
    const xNorm = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
    const yNorm = Math.max(0, Math.min(1, (e.clientY - rect.top) / Math.max(1, rect.height)));

    if (this.displayMode === 'spectrogram') {
      const timeSec = xNorm * this.inspection.durationSec;
      const freqHz = (1 - yNorm) * this.inspection.spectrogram.maxFreqHz;
      const harmIdx = Math.max(
        1,
        Math.round(freqHz / Math.max(1, this.inspection.summary.detectedF0Hz))
      );
      this.hoverInfoEl.textContent = `t = ${timeSec.toFixed(2)}s | freq = ${freqHz.toFixed(0)} Hz (~H${harmIdx})`;
    } else if (this.displayMode === 'partials') {
      const pIdx = Math.min(63, Math.max(0, Math.floor(xNorm * 64)));
      const amp = this.inspection.summary.amplitudes[pIdx] ?? 0;
      const offHz = this.inspection.summary.frequencyOffsets[pIdx] ?? 0;
      const freqHz = (pIdx + 1) * this.inspection.summary.detectedF0Hz + offHz;
      const track = this.inspection.partialTracks.find(
        (t) => t.partialIndex === pIdx + 1
      );
      const layerNum = (track?.layerIndex ?? 0) + 1;
      const ampDb = amp > 1e-5 ? `${(20 * Math.log10(amp)).toFixed(1)} dB` : '-inf dB';
      this.hoverInfoEl.textContent = `Partial H${pIdx + 1}: ${freqHz.toFixed(1)} Hz (Δ ${offHz >= 0 ? '+' : ''}${offHz.toFixed(1)} Hz) | Amp: ${ampDb} | Layer L${layerNum}`;
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
      this.hoverInfoEl.textContent = `t = ${timeSec.toFixed(2)}s | Orig Peak: ${origPeak.toFixed(3)} | Resynth Peak: ${resPeak.toFixed(3)}`;
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

    // Build 64-point log-frequency dB curves for Target (Original STFT mean), Model (64 Partials), and Residual
    const numPoints = 64;
    const targetCurve: number[] = [];
    const modelCurve: number[] = [];
    const residualCurve: number[] = [];

    const { spectrogram, summary } = this.inspection;
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
      const harmIdx = Math.min(63, Math.max(0, Math.round(freqHz / f0) - 1));
      const pAmp = summary.amplitudes[harmIdx] ?? 0;
      const modelDb = pAmp > 1e-4 ? Math.max(-60, 20 * Math.log10(pAmp)) : -58;

      const resDb = Math.max(-60, Math.min(0, -48 + Math.abs(targetDb - modelDb) * 0.6));

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
    const { spectrogram, partialTracks } = this.inspection;
    const cols = Math.max(1, spectrogram.frameCount);
    const rows = Math.max(1, spectrogram.binCount);
    const cellW = width / cols;
    const cellH = height / rows;
    const layerColors = getLayerColors();

    // 1. Render STFT magnitude heatmap
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
    const { summary, partialTracks } = this.inspection;
    const padBottom = 18;
    const plotH = height - padBottom - 8;
    const layerColors = getLayerColors();
    const mutedColor = resolveThemeToken('--color-text-muted', '#7e9bb5');
    const accentColor = resolveThemeToken('--color-accent', '#00e676');
    const infoColor = resolveThemeToken('--color-cable-midi-in', '#06b6d4');

    // Horizontal dB grid lines
    ctx.strokeStyle = resolveThemeToken('--color-panel-border', 'rgba(0, 195, 255, 0.2)');
    ctx.lineWidth = 1;
    for (let g = 1; g <= 3; g++) {
      const y = 8 + (plotH * g) / 4;
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
      const amp = summary.amplitudes[k] ?? 0;
      const relDb = amp > 1e-5 ? 20 * Math.log10(amp) : -72;
      const normH = Math.max(0.02, Math.min(1, (relDb + 60) / 60));
      const bh = normH * plotH;
      const x = k * barSlotW + (barSlotW - barW) * 0.5;
      const y = 8 + plotH - bh;

      const layerIdx = layerByPartial.get(k + 1) ?? 0;
      ctx.fillStyle = layerColors[layerIdx % layerColors.length];
      ctx.globalAlpha = amp > 1e-4 ? 0.9 : 0.22;
      ctx.fillRect(x, y, barW, bh);

      // Harmonic number labels every 8 partials
      if (k === 0 || (k + 1) % 8 === 0) {
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = mutedColor;
        ctx.font = '9px monospace';
        ctx.fillText(`H${k + 1}`, x - 2, height - 4);
      }
    }
    ctx.globalAlpha = 1.0;

    // Real-time Web Audio FFT overlay curve during playback
    if (rt && rt.isPlaying && rt.bins.length > 0) {
      ctx.strokeStyle = rt.mode === 'resynthesis' ? accentColor : infoColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      const n = Math.min(64, rt.bins.length);
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * width;
        const norm = rt.bins[i] / 255.0;
        const y = 8 + plotH * (1.0 - norm);
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
    const halfH = height * 0.5;
    const origColor = resolveThemeToken('--color-cable-midi-in', '#06b6d4');
    const resynthColor = resolveThemeToken('--color-accent', '#00e676');
    const borderColor = resolveThemeToken('--color-panel-border-strong', 'rgba(0, 195, 255, 0.45)');
    const dimGridColor = resolveThemeToken('--color-panel-border', 'rgba(0, 195, 255, 0.2)');

    // Divider line between A (top) and B (bottom)
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, halfH);
    ctx.lineTo(width, halfH);
    ctx.stroke();

    const drawEnvelope = (
      peaks: { min: number[]; max: number[] },
      centerY: number,
      ampSpan: number,
      color: string,
      isActivePlayback: boolean
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
      ctx.globalAlpha = isActivePlayback ? 0.95 : 0.78;
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

    // Top half: Original Sample (A)
    drawEnvelope(
      waveformPeaks,
      halfH * 0.5,
      halfH * 0.42,
      origColor,
      rt?.isPlaying === true && rt.mode === 'original'
    );

    // Bottom half: Additive Scape/Sphere Resynthesis (B)
    drawEnvelope(
      resynthPeaks,
      halfH * 1.5,
      halfH * 0.42,
      resynthColor,
      rt?.isPlaying === true && rt.mode === 'resynthesis'
    );

    // Labels
    ctx.font = 'bold 10px monospace';
    ctx.fillStyle = origColor;
    ctx.fillText(
      `A: ORIGINAL SAMPLE (${waveformPeaks.rmsDb} dB RMS)`,
      8,
      14
    );
    ctx.fillStyle = resynthColor;
    ctx.fillText(
      `B: NEURAL SCAPE/SPHERE RESYNTHESIS (${resynthPeaks.rmsDb} dB RMS)`,
      8,
      halfH + 14
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
