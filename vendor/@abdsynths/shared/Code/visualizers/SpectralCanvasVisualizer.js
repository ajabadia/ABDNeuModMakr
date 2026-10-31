/**
 * ABDShared — SpectralCanvasVisualizer
 * ====================================
 * High-performance, theme-aware 2D Canvas audio visualizer component supporting:
 *   1. 2D STFT Spectrogram Matrix Heatmap (Time × Frequency × dB)
 *   2. Clustered Harmonic Partial Trajectories Overlay (F0..Fmax)
 *   3. 64-Partial Discrete Harmonic Spectrum with Real-time FFT Curve
 *   4. A/B Waveform Envelope Comparison (Original Sample vs Neural Resynthesis)
 *
 * Designed for zero runtime allocation in animation frames, Hi-DPI scaling,
 * and seamless embedding across ABDSynths instruments (ABDNeuModMakr, ABDAxionikVS, Scope).
 */

function resolveCssToken(varName, fallback) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return fallback;
  const val = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return val || fallback;
}

export class SpectralCanvasVisualizer {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.displayMode = options.displayMode || 'spectrogram'; // 'spectrogram' | 'partials' | 'waveform-ab'
    this.showPartialsOverlay = options.showPartialsOverlay ?? true;
    this.minDb = options.minDb ?? -96;
    this.maxDb = options.maxDb ?? 0;
    // Defaults resolve the shared --color-layer-* tokens (SSOT: tokens.css);
    // the literal fallbacks keep standalone usage working without shared styles.
    this.layerColors = options.layerColors || [
      resolveCssToken('--color-layer-1', '#00e676'), // Drone / Primary
      resolveCssToken('--color-layer-2', '#ffb142'), // Crest / Transients
      resolveCssToken('--color-layer-3', '#06b6d4'), // Inharmonic / Air
      resolveCssToken('--color-layer-4', '#a855f7'), // Morph
    ];
  }

  setDisplayMode(mode) {
    this.displayMode = mode;
  }

  setShowPartialsOverlay(show) {
    this.showPartialsOverlay = show;
  }

  render(data, realtime) {
    if (!this.canvas || !this.ctx || !data) return;

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const parent = this.canvas.parentElement;
    const width = Math.max(200, parent ? parent.clientWidth : this.canvas.width / dpr);
    const height = Math.max(80, parent ? parent.clientHeight : this.canvas.height / dpr);

    if (
      this.canvas.width !== Math.round(width * dpr) ||
      this.canvas.height !== Math.round(height * dpr)
    ) {
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
    }

    const ctx = this.ctx;
    ctx.save();
    ctx.scale(dpr, dpr);

    // Background fill
    const bg = this.displayMode === 'spectrogram'
      ? resolveCssToken('--color-lcd-bg', '#102216')
      : resolveCssToken('--color-panel-surface', '#151f2e');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    if (this.displayMode === 'spectrogram' && data.spectrogram) {
      this._renderSpectrogram(ctx, width, height, data);
    } else if (this.displayMode === 'partials' && data.summary) {
      this._renderPartials(ctx, width, height, data, realtime);
    } else if (this.displayMode === 'waveform-ab' && data.waveformPeaks) {
      this._renderWaveformAb(ctx, width, height, data, realtime);
    }

    ctx.restore();
  }

  _renderSpectrogram(ctx, width, height, data) {
    const { spectrogram, partialTracks } = data;
    const cols = Math.max(1, spectrogram.frameCount);
    const rows = Math.max(1, spectrogram.binCount);
    const cellW = width / cols;
    const cellH = height / rows;

    // 1. Draw STFT magnitude heatmap
    for (let c = 0; c < cols; c++) {
      const colMags = spectrogram.magnitudes[c];
      if (!colMags) continue;
      const x = c * cellW;
      for (let r = 0; r < rows; r++) {
        const val = colMags[r] ?? 0;
        if (val <= 0.02) continue;
        const y = height - (r + 1) * cellH;
        ctx.fillStyle = this._magToHeatColor(val);
        ctx.fillRect(x, y, Math.ceil(cellW), Math.ceil(cellH));
      }
    }

    // Grid lines
    ctx.strokeStyle = resolveCssToken('--color-panel-border', 'rgba(0, 195, 255, 0.15)');
    ctx.lineWidth = 1;
    for (let g = 1; g <= 4; g++) {
      const y = (height * g) / 5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // 2. Overlay Partial Trajectories color-coded by layer
    if (this.showPartialsOverlay && partialTracks && partialTracks.length > 0) {
      const maxFreq = Math.max(1, spectrogram.maxFreqHz || 12000);
      for (const track of partialTracks) {
        if (!track.frames || track.frames.length === 0) continue;
        const color = this.layerColors[track.layerIndex % this.layerColors.length];
        ctx.strokeStyle = color;
        ctx.lineWidth = track.partialIndex === 1 ? 2.2 : 1.25;
        ctx.globalAlpha = Math.max(0.4, Math.min(0.95, 0.4 + (track.meanAmplitude || 0.5) * 1.4));

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

  _renderPartials(ctx, width, height, data, realtime) {
    const { summary, partialTracks } = data;
    const padBottom = 18;
    const plotH = height - padBottom - 8;
    const numPartials = Math.min(64, summary.amplitudes ? summary.amplitudes.length : 0);
    const barSlotW = width / Math.max(1, numPartials);

    // Grid
    ctx.strokeStyle = resolveCssToken('--color-panel-border', 'rgba(0, 195, 255, 0.15)');
    ctx.lineWidth = 1;
    for (let g = 1; g <= 3; g++) {
      const y = 8 + (plotH * g) / 4;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    const layerMap = new Map();
    if (partialTracks) {
      for (const t of partialTracks) {
        layerMap.set(t.partialIndex, t.layerIndex);
      }
    }

    for (let i = 0; i < numPartials; i++) {
      const amp = summary.amplitudes[i] ?? 0;
      const hNorm = Math.max(0, Math.min(1, Math.pow(amp, 0.65)));
      const barH = hNorm * plotH;
      const x = i * barSlotW + barSlotW * 0.15;
      const w = Math.max(1, barSlotW * 0.7);
      const y = 8 + plotH - barH;

      const layer = layerMap.get(i + 1) ?? 0;
      ctx.fillStyle = this.layerColors[layer % this.layerColors.length];
      ctx.fillRect(x, y, w, barH);
    }

    // Realtime FFT curve overlay if playing
    if (realtime && realtime.isPlaying && realtime.bins && realtime.bins.length > 0) {
      ctx.strokeStyle = resolveCssToken('--color-accent', '#00c3ff');
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      const bins = realtime.bins;
      const len = bins.length;
      for (let i = 0; i < len; i++) {
        const x = (i / (len - 1)) * width;
        const norm = bins[i] / 255;
        const y = 8 + plotH - norm * plotH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  _renderWaveformAb(ctx, width, height, data, realtime) {
    const { waveformPeaks, resynthPeaks } = data;
    const midY = height / 2;
    const ampY = midY * 0.88;

    ctx.strokeStyle = resolveCssToken('--color-panel-border', 'rgba(0, 195, 255, 0.2)');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();

    // Original wave (Cyan)
    if (waveformPeaks && waveformPeaks.max) {
      ctx.fillStyle = `rgba(${resolveCssToken('--color-accent-rgb', '0, 195, 255')}, 0.35)`;
      this._drawPeaks(ctx, width, midY, ampY, waveformPeaks.max, waveformPeaks.min);
    }

    // Resynthesis wave (Emerald Green)
    if (resynthPeaks && resynthPeaks.max) {
      ctx.fillStyle = `rgba(${resolveCssToken('--color-success-rgb', '0, 230, 118')}, 0.45)`;
      this._drawPeaks(ctx, width, midY, ampY, resynthPeaks.max, resynthPeaks.min);
    }
  }

  _drawPeaks(ctx, width, midY, ampY, maxVals, minVals) {
    const len = maxVals.length;
    if (len === 0) return;
    ctx.beginPath();
    for (let i = 0; i < len; i++) {
      const x = (i / (len - 1)) * width;
      const y = midY - (maxVals[i] ?? 0) * ampY;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let i = len - 1; i >= 0; i--) {
      const x = (i / (len - 1)) * width;
      const y = midY - (minVals[i] ?? 0) * ampY;
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  }

  _magToHeatColor(val) {
    const norm = Math.max(0, Math.min(1, val));
    if (norm < 0.25) {
      const t = norm / 0.25;
      return `rgb(0, ${Math.round(40 + t * 90)}, ${Math.round(80 + t * 120)})`;
    } else if (norm < 0.55) {
      const t = (norm - 0.25) / 0.3;
      return `rgb(0, ${Math.round(130 + t * 110)}, ${Math.round(200 - t * 80)})`;
    } else if (norm < 0.82) {
      const t = (norm - 0.55) / 0.27;
      return `rgb(${Math.round(t * 240)}, 245, ${Math.round(120 - t * 110)})`;
    } else {
      const t = (norm - 0.82) / 0.18;
      return `rgb(255, ${Math.round(245 - t * 40)}, ${Math.round(t * 180)})`;
    }
  }
}
