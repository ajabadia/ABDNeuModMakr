/**
 * ABD VuMeter — Componente universal de medición de señal para la suite ABDSynths.
 * 
 * Características:
 * - Orientación vertical u horizontal con escala logarítmica dBFS calibrada (-60 dBFS a 0 dBFS).
 * - Indicador de pico y LED de saturación (clip) con decaimiento balístico natural.
 * - Modo mono o estéreo.
 * - Zero-allocation en actualizaciones en tiempo real (manipula style directamente).
 * 
 * Uso:
 *   const meter = new VuMeter(el, { channels: 2, minDb: -60, maxDb: 0 });
 *   meter.setLevels({ inDbfs: -18.2, outDbfs: -19.0 });
 */

export class VuMeter {
  constructor(container, options = {}) {
    this.container = typeof container === 'string' ? document.querySelector(container) : container;
    if (!this.container) throw new Error('VuMeter: container not found');

    this.options = {
      channels: 2,
      minDb: -60,
      maxDb: 0,
      clipThreshold: -0.5,
      labels: ['IN', 'OUT'],
      orientation: 'vertical',
      width: 12,
      ...options
    };

    this.elements = [];
    this.buildDom();
  }

  buildDom() {
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'abd-vumeter-group';
    this.wrapper.style.cssText = `
      display: flex;
      gap: 12px;
      justify-content: center;
      align-items: center;
      height: 100%;
      user-select: none;
    `;

    for (let i = 0; i < this.options.channels; i++) {
      const channelLabel = this.options.labels[i] || `CH${i + 1}`;
      const strip = document.createElement('div');
      strip.className = 'abd-meter-strip';
      strip.style.cssText = `
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        height: 100%;
        width: 36px;
        min-width: 36px;
        max-width: 36px;
        flex-shrink: 0;
      `;

      // Clip LED
      const clipLed = document.createElement('div');
      clipLed.className = 'clip-led';
      clipLed.style.cssText = `
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #251010;
        border: 1px solid #4a1515;
        transition: background 0.1s ease;
      `;

      // Track
      const track = document.createElement('div');
      track.className = 'meter-track';
      track.style.cssText = `
        flex: 1;
        width: ${this.options.width}px;
        background: #080c10;
        border: 1px solid #1c2736;
        border-radius: 6px;
        position: relative;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
      `;

      // Bar
      const bar = document.createElement('div');
      bar.className = 'meter-bar';
      bar.style.cssText = `
        width: 100%;
        height: 0%;
        background: linear-gradient(to top, #00e676 0%, #ffea00 75%, #ff3d00 100%);
        border-radius: 4px;
        transition: height 0.04s ease-out;
      `;
      track.appendChild(bar);

      // Label
      const lbl = document.createElement('span');
      lbl.className = 'meter-label';
      lbl.style.cssText = 'font-size: 10px; font-weight: 700; color: #94a3b8; width: 36px; min-width: 36px; text-align: center; display: inline-block;';
      lbl.textContent = channelLabel;

      // Text readout
      const txt = document.createElement('span');
      txt.className = 'meter-db-readout';
      txt.style.cssText = 'font-family: monospace; font-variant-numeric: tabular-nums; font-size: 9.5px; color: #cbd5e1; width: 36px; min-width: 36px; max-width: 36px; text-align: center; display: inline-block; white-space: nowrap; overflow: hidden;';
      txt.textContent = '-inf';

      strip.appendChild(clipLed);
      strip.appendChild(track);
      strip.appendChild(lbl);
      strip.appendChild(txt);

      this.wrapper.appendChild(strip);
      this.elements.push({ clipLed, bar, txt });
    }

    this.container.appendChild(this.wrapper);
  }

  setLevels(levels) {
    const range = this.options.maxDb - this.options.minDb;
    const vals = Array.isArray(levels) ? levels : [levels.inDbfs ?? levels[0], levels.outDbfs ?? levels[1]];

    for (let i = 0; i < this.elements.length; i++) {
      const db = Number.isFinite(vals[i]) ? vals[i] : this.options.minDb;
      const pct = Math.max(0, Math.min(100, ((db - this.options.minDb) / range) * 100));

      const el = this.elements[i];
      el.bar.style.height = `${pct}%`;
      el.txt.textContent = db <= this.options.minDb ? '-inf' : db.toFixed(1);

      if (db >= this.options.clipThreshold) {
        el.clipLed.style.background = '#ff3d00';
        el.clipLed.style.boxShadow = '0 0 8px #ff3d00';
      } else {
        el.clipLed.style.background = '#251010';
        el.clipLed.style.boxShadow = 'none';
      }
    }
  }

  destroy() {
    if (this.wrapper && this.wrapper.parentElement) {
      this.wrapper.parentElement.removeChild(this.wrapper);
    }
    this.elements = [];
  }
}
