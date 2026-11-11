/**
 * ABD MiniWaveScope — small Canvas waveform display for synth frontends.
 * ==============================================================================
 * Paints one short buffer of samples with phosphor persistence, DAC
 * quantization steps and retro oscilloscope grid lines. It is a DISPLAY: it does
 * not touch the audio thread and it does not analyse spectrum.
 *
 * Two ways to feed it:
 *   1. `setSamples(float32array)` on every host frame — the real samples, which
 *      is what a plugin does from its editor timer.
 *   2. `start()` — no host samples, so it SYNTHESIZES a square wave from
 *      `updateFromEngine({ level, frequency, sounding })` to keep the panel
 *      alive while the engine is idle. That wave is decorative, not measured.
 *
 * Deliberately smaller than the suite's other displays: `@abdsynths/shared/scope`
 * (createScope) mounts the full scope frame, and `SpectrumPlotter` does log
 * spectrum analysis. This one is for a corner panel of a few dozen pixels.
 */

export class MiniWaveScope {
  /**
   * @param {HTMLCanvasElement|string} canvas
   * @param {object} [options]
   * @param {string} [options.lineColor='#00e676'] trace color while sounding
   * @param {string} [options.gridColor='rgba(0, 230, 118, 0.12)'] grid color
   * @param {boolean} [options.stepped=true] draw stepped DAC lines instead of a smoothed curve
   * @param {number} [options.bits=8] bit resolution of the quantization steps
   * @param {number} [options.bufferLength=128] samples painted per sweep
   * @param {string} [options.decayStyle='rgba(10, 14, 20, 0.35)'] trail layer of the persistence
   * @param {string} [options.idleColor='rgba(126, 155, 181, 0.35)'] trace color when silent
   */
  constructor(canvas, options = {}) {
    this.canvas = typeof canvas === 'string'
      ? document.querySelector(canvas)
      : canvas;

    if (!this.canvas) {
      throw new Error('MiniWaveScope: invalid canvas element');
    }

    this.ctx = this.canvas.getContext('2d');

    this.options = {
      lineColor: options.lineColor || '#00e676',
      gridColor: options.gridColor || 'rgba(0, 230, 118, 0.12)',
      stepped: options.stepped !== undefined ? options.stepped : true,
      bits: options.bits || 8,
      bufferLength: options.bufferLength || 128,
      decayStyle: options.decayStyle || 'rgba(10, 14, 20, 0.35)',
      idleColor: options.idleColor || 'rgba(126, 155, 181, 0.35)'
    };

    this.buffer = new Float32Array(this.options.bufferLength);
    this.phase = 0;
    this.animating = false;
    this.hasExternalSamples = false;
    this.currentLevel = 0;
    this.currentFrequency = 440;
    this.isSounding = false;

    this.draw();
  }

  /** Engine status used by the synthesized (idle) sweep only. */
  updateFromEngine({ level = 0, frequency = 440, sounding = false } = {}) {
    this.currentLevel = level;
    this.currentFrequency = frequency > 0 ? frequency : 440;
    this.isSounding = sounding;
  }

  /**
   * Paints real samples. Values are expected in -1..1; longer arrays are
   * truncated to `bufferLength`, shorter ones are followed by silence.
   * Calling this switches the display out of the synthesized sweep.
   */
  setSamples(samples) {
    if (!samples || !samples.length) return;
    const len = this.buffer.length;
    const levels = Math.pow(2, this.options.bits - 1);

    for (let i = 0; i < len; ++i) {
      let sample = i < samples.length ? samples[i] : 0;
      if (!isFinite(sample)) sample = 0;
      sample = Math.max(-1, Math.min(1, sample));
      if (this.options.stepped) sample = Math.round(sample * levels) / levels;
      this.buffer[i] = sample;
    }

    this.hasExternalSamples = true;
    this.isSounding = true;
    this.draw();
  }

  /** Self-driving animation for panels that have no host samples. */
  start() {
    if (this.animating) return;
    this.animating = true;
    const loop = () => {
      if (!this.animating) return;
      this.tick();
      this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this.animating = false;
  }

  /** Fills the buffer with the synthesized square wave (no-op once real samples arrive). */
  tick() {
    if (this.hasExternalSamples) return;

    const len = this.buffer.length;
    const cycles = Math.max(1, Math.min(8, (this.currentFrequency / 440.0) * 2));
    const step = (cycles * 2 * Math.PI) / len;
    const amp = this.isSounding ? Math.max(0.08, Math.min(0.9, this.currentLevel * 1.5)) : 0.0;
    const levels = Math.pow(2, this.options.bits - 1);

    for (let i = 0; i < len; ++i) {
      const p = this.phase + i * step;
      // Pulse / square wave characteristic of 8048 firmware demo
      let sample = Math.sin(p) >= 0 ? 1.0 : -1.0;
      if (this.options.stepped) {
        sample = Math.round(sample * levels) / levels;
      }
      this.buffer[i] = sample * amp;
    }

    this.phase += (this.currentFrequency / 44100.0) * 2 * Math.PI * 4;
    if (this.phase > 2 * Math.PI) this.phase -= 2 * Math.PI;
  }

  draw() {
    const ctx = this.ctx;
    if (!ctx) return;   // canvas without a 2d context: headless hosts just get no pixels

    const w = this.canvas.width;
    const h = this.canvas.height;
    if (w <= 0 || h <= 0) return;

    // Soft decay trail
    ctx.fillStyle = this.options.decayStyle;
    ctx.fillRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = this.options.gridColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    // Center horizontal
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    // Vertical divisions
    const divs = 4;
    for (let i = 1; i < divs; ++i) {
      const x = (w / divs) * i;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    ctx.stroke();

    // Waveform
    ctx.lineWidth = 2;
    ctx.strokeStyle = this.isSounding ? this.options.lineColor : this.options.idleColor;
    ctx.shadowColor = this.isSounding ? this.options.lineColor : 'transparent';
    ctx.shadowBlur = this.isSounding ? 6 : 0;

    ctx.beginPath();
    const len = this.buffer.length;
    const sliceWidth = len > 1 ? w / (len - 1) : w;

    for (let i = 0; i < len; ++i) {
      const v = this.buffer[i];
      const y = (h / 2) - (v * (h * 0.42));
      const x = i * sliceWidth;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else if (this.options.stepped) {
        const prevV = this.buffer[i - 1];
        const prevY = (h / 2) - (prevV * (h * 0.42));
        ctx.lineTo(x, prevY);
        ctx.lineTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  destroy() {
    this.stop();
    this.hasExternalSamples = false;
    this.buffer.fill(0);
  }
}
