/**
 * ABD SpectrumPlotter — Analizador y visualizador de curvas espectrales logarítmicas para la suite ABDSynths.
 * 
 * Características:
 * - Eje de frecuencias logarítmico continuo (20 Hz a 20.000 Hz).
 * - Eje de magnitud en dBFS (-60 dBFS a 0 dBFS / +12 dBFS).
 * - Renderizado multi-traza vectorial SVG (Target, Model, Residual).
 * - Rejilla espectral estándar de audio profesional.
 * 
 * Uso:
 *   const plotter = new SpectrumPlotter(container, { width: 640, height: 180 });
 *   plotter.render({ targetCurve, modelCurve, residualCurve });
 */

export class SpectrumPlotter {
  constructor(container, options = {}) {
    this.container = typeof container === 'string' ? document.querySelector(container) : container;
    if (!this.container) throw new Error('SpectrumPlotter: container not found');

    this.options = {
      width: 640,
      height: 180,
      padL: 36,
      padR: 16,
      padT: 15,
      padB: 25,
      minFreq: 20,
      maxFreq: 20000,
      minDb: -60,
      maxDb: 0,
      gridColor: '#162230',
      textColor: '#64748b',
      ...options
    };

    this.svg = null;
    this.buildDom();
  }

  buildDom() {
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('viewBox', `0 0 ${this.options.width} ${this.options.height}`);
    this.svg.style.width = '100%';
    this.svg.style.height = `${this.options.height}px`;
    this.svg.style.display = 'block';

    this.container.appendChild(this.svg);
  }

  render(traces = {}) {
    if (!this.svg) return;

    const { width, height, padL, padR, padT, padB, minFreq, maxFreq, minDb, maxDb } = this.options;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    let lines = '';
    const logMin = Math.log10(minFreq);
    const logMax = Math.log10(maxFreq);
    const logRange = logMax - logMin;

    // Frecuencias de rejilla estándar: 50, 100, 250, 500, 1k, 2.5k, 5k, 10k, 20k
    const freqs = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 20000];
    freqs.forEach(f => {
      const normX = (Math.log10(f) - logMin) / logRange;
      const x = padL + normX * plotW;
      lines += `<line x1="${x.toFixed(1)}" y1="${padT}" x2="${x.toFixed(1)}" y2="${padT + plotH}" stroke="${this.options.gridColor}" stroke-dasharray="2,2"/>`;
      const label = f >= 1000 ? `${f / 1000}k` : `${f}`;
      lines += `<text x="${x.toFixed(1)}" y="${height - 8}" fill="${this.options.textColor}" font-size="8.5" text-anchor="middle" font-family="sans-serif">${label}Hz</text>`;
    });

    // Líneas horizontales de dB
    [-48, -36, -24, -12, 0].forEach(db => {
      const normY = 1.0 - ((db - minDb) / (maxDb - minDb));
      const y = padT + normY * plotH;
      lines += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${padL + plotW}" y2="${y.toFixed(1)}" stroke="${this.options.gridColor}"/>`;
      lines += `<text x="${padL - 6}" y="${(y + 3).toFixed(1)}" fill="${this.options.textColor}" font-size="8.5" text-anchor="end" font-family="sans-serif">${db}</text>`;
    });

    // Construcción de curvas
    const buildPath = (curve) => {
      if (!curve || !Array.isArray(curve) || curve.length === 0) return '';
      let path = 'M';
      for (let i = 0; i < curve.length; i++) {
        const normX = i / (curve.length - 1);
        const x = padL + normX * plotW;
        const db = Math.max(minDb, Math.min(maxDb + 12, curve[i]));
        const normY = 1.0 - ((db - minDb) / (maxDb - minDb));
        const y = padT + Math.max(0, Math.min(plotH, normY * plotH));

        path += (i === 0 ? ` ${x.toFixed(1)} ${y.toFixed(1)}` : ` L ${x.toFixed(1)} ${y.toFixed(1)}`);
      }
      return path;
    };

    const targetPath = traces.target ? `<path d="${buildPath(traces.target)}" fill="none" stroke="#00c3ff" stroke-width="2.2"/>` : '';
    const modelPath = traces.model ? `<path d="${buildPath(traces.model)}" fill="none" stroke="#00e676" stroke-width="1.8"/>` : '';
    const resPath = traces.residual ? `<path d="${buildPath(traces.residual)}" fill="none" stroke="#ff9100" stroke-width="1.8" stroke-dasharray="3,2" opacity="0.85"/>` : '';

    this.svg.innerHTML = `
      ${lines}
      ${resPath}
      ${targetPath}
      ${modelPath}
    `;
  }

  destroy() {
    if (this.svg && this.svg.parentElement) {
      this.svg.parentElement.removeChild(this.svg);
    }
  }
}
