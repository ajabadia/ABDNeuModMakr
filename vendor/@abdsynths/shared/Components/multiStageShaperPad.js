/**
 * ABD MultiStageShaperPad — Reusable Multi-Stage (4L/4T & ADSR) Envelope Pad for the ABDSynths suite.
 * ============================================================================
 * Designed for multi-stage envelopes and contour generators:
 *   - 4 Levels (L1, L2, L3, L4): Bipolar (-1.0 .. +1.0) or Unipolar (0.0 .. +1.0)
 *   - 4 Times (T1, T2, T3, T4): Normalized duration per stage (0.0 .. 1.0)
 *   - Loop / Mode flags: Normal (one-shot), Repeat (loop L1..L3 as multi-stage LFO)
 *
 * Canonical visual style (unified across all drawers):
 *   - Stage header bar: START (L:0) | STAGE 1 | STAGE 2 | STAGE 3 | RELEASE (STAGE 4)
 *     (or custom stageLabels for ADSR: START | ATTACK | DECAY | SUSTAIN | RELEASE)
 *   - Smooth vertical gradient fill under the curve + dashed baseline
 *   - Clean circular accent handles (#ff9f1c) without cluttered P1..P4 text labels
 */

const clamp = (v, min, max) => Math.min(max, Math.max(min, Number.isFinite(v) ? v : min));

let instanceCounter = 0;

export class MultiStageShaperPad {
  /**
   * @param {HTMLElement|string} container
   * @param {object} [options]
   */
  constructor(container, options = {}) {
    this.container = typeof container === 'string'
      ? document.querySelector(container)
      : container;

    if (!this.container) {
      throw new Error('ABD MultiStageShaperPad: container not found');
    }

    this.uid = ++instanceCounter;
    this.options = {
      label: '4L/4T SHAPER CONTOUR',
      caption: '4-Stage Dynamic Contour',
      bipolar: true,
      editable: true,
      bare: false,
      showModeButtons: true,
      stageLabels: null,
      viewBoxWidth: 600,
      viewBoxHeight: 130,
      times: [0.2, 0.4, 0.3, 0.5],       // T1, T2, T3, T4 (0..1)
      levels: [0.8, -0.4, 0.5, 0.0],     // L1, L2, L3, L4 (-1..1 if bipolar, 0..1 if unipolar)
      mode: 1,                           // 0 = Off, 1 = Normal, 2 = Repeat
      onChange: null,
      ...options,
    };

    this.times = [...this.options.times];
    this.levels = [...this.options.levels];
    this.mode = this.options.mode;
    this.activeHandle = null;
    this.isDragging = false;
    this._destroyed = false;

    this.initCumX();
    this.buildDom();
    this.updateVisuals();
    this.bindEvents();
  }

  initCumX() {
    let acc = 0;
    this.cumX = [];
    for (let i = 0; i < 4; i++) {
      acc += Math.max(0.02, this.times[i] ?? 0.2);
      this.cumX.push(acc);
    }
    const maxAcc = Math.max(0.2, acc);
    for (let i = 0; i < 4; i++) {
      this.cumX[i] = clamp(this.cumX[i] / maxAcc, 0.05 * (i + 1), 1.0);
    }
    for (let i = 1; i < 4; i++) {
      if (this.cumX[i] <= this.cumX[i - 1]) {
        this.cumX[i] = Math.min(1.0, this.cumX[i - 1] + 0.05);
      }
    }
  }

  buildDom() {
    const W = this.options.viewBoxWidth;
    const H = this.options.viewBoxHeight;
    const midY = this.options.bipolar ? Math.round(H / 2) : H - 10;
    const gradId = `abd-shaper-grad-${this.uid}`;

    const defaultStageLabels = this.options.bipolar
      ? ['START (L:0)', 'STAGE 1', 'STAGE 2', 'STAGE 3', 'RELEASE (STAGE 4)']
      : ['START', 'STAGE 1 (ATK)', 'STAGE 2 (DEC)', 'STAGE 3 (SUS)', 'STAGE 4 (REL)'];
    const labels = Array.isArray(this.options.stageLabels) && this.options.stageLabels.length === 5
      ? this.options.stageLabels
      : defaultStageLabels;

    let handlesSvg = '';
    for (let idx = 0; idx < 4; idx++) {
      handlesSvg += `
        <g class="shaper-handle-group" data-handle="${idx}">
          ${this.options.editable ? `<ellipse class="shaper-handle-hit" cx="0" cy="0" rx="14" ry="14" fill="transparent" cursor="grab" />` : ''}
          <ellipse class="shaper-handle-outer" cx="0" cy="0" rx="5" ry="5" fill="#ff9f1c" />
        </g>
      `;
    }

    const stageBoxHtml = `
      <div class="shaper-svg-container" style="background: rgba(0, 0, 0, 0.35); border: 1px solid var(--color-panel-border-dim, rgba(255,255,255,0.08)); border-radius: var(--radius-sm, 6px); padding: var(--space-3, 10px); position: relative; touch-action: none;">
        <div style="display: flex; justify-content: space-between; font-size: 9px; color: var(--color-text-muted, #94a3b8); margin-bottom: 4px; font-family: var(--font-mono, monospace);">
          <span>${labels[0]}</span>
          <span>${labels[1]}</span>
          <span>${labels[2]}</span>
          <span>${labels[3]}</span>
          <span>${labels[4]}</span>
        </div>
        <svg viewBox="0 0 ${W} ${H}" style="width: 100%; height: ${H}px; display: block; overflow: visible;">
          <defs>
            <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--color-accent, #38bdf8)" stop-opacity="0.38" />
              <stop offset="100%" stop-color="var(--color-accent, #38bdf8)" stop-opacity="0.02" />
            </linearGradient>
          </defs>
          <line x1="0" y1="${midY}" x2="${W}" y2="${midY}" stroke="rgba(255,255,255,0.15)" stroke-dasharray="4,4" />
          <path class="shaper-fill" d="" fill="url(#${gradId})" />
          <path class="shaper-curve" d="" fill="none" stroke="var(--color-accent, #38bdf8)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
          ${handlesSvg}
        </svg>
      </div>
    `;

    if (this.options.bare) {
      this.container.innerHTML = stageBoxHtml;
    } else {
      const modeButtonsHtml = this.options.showModeButtons ? `
        <div class="shaper-modes" style="display: flex; gap: 4px;">
          <button type="button" class="btn btn-xs ${this.mode === 1 ? 'btn-primary active' : 'btn-outline'} btn-shaper-mode" data-mode="1">Normal</button>
          <button type="button" class="btn btn-xs ${this.mode === 2 ? 'btn-primary active' : 'btn-outline'} btn-shaper-mode" data-mode="2">Repeat</button>
        </div>
      ` : '';

      this.container.innerHTML = `
        <div class="abd-multistage-shaper-card synth-panel-card" style="padding: var(--space-3, 12px); background: var(--color-panel-surface, #1e222b); border: 1px solid var(--color-border-subtle, #333a47); border-radius: var(--radius-md, 8px); display: flex; flex-direction: column; gap: var(--space-2, 8px);">
          <div class="shaper-header" style="display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="panel-badge" style="font-size: 9px; font-weight: 700; color: var(--color-accent, #38bdf8);">${this.options.label}</span>
              <span class="panel-caption" style="font-size: 10px; color: var(--color-text-muted, #94a3b8);">${this.options.caption}</span>
            </div>
            ${modeButtonsHtml}
          </div>
          ${stageBoxHtml}
        </div>
      `;
    }

    this.svgEl = this.container.querySelector('svg');
    this.fillPathEl = this.container.querySelector('.shaper-fill');
    this.linePathEl = this.container.querySelector('.shaper-curve');
    this.handleHitEls = Array.from(this.container.querySelectorAll('.shaper-handle-hit'));
    this.handleOuterEls = Array.from(this.container.querySelectorAll('.shaper-handle-outer'));
  }

  calculatePoints(W, H, minL, maxL) {
    const marginX = 10;
    const availW = W - marginX * 2;
    const marginY = 10;
    const availH = H - marginY * 2;

    return this.cumX.map((cx, idx) => {
      const x = marginX + clamp(cx, 0.0, 1.0) * availW;
      const normL = (this.levels[idx] - minL) / (maxL - minL);
      const y = marginY + (1.0 - clamp(normL, 0.0, 1.0)) * availH;

      return { x: Math.round(x), y: Math.round(y) };
    });
  }

  buildPathD(points, H, midY) {
    const startX = 10;
    const startY = midY;

    let lineD = `M ${startX} ${startY}`;
    points.forEach((pt) => {
      lineD += ` L ${pt.x} ${pt.y}`;
    });

    const lastX = points.length > 0 ? points[points.length - 1].x : startX;
    const baseCloseY = this.options.bipolar ? (H - 4) : midY;
    const areaD = `${lineD} L ${lastX} ${baseCloseY} L ${startX} ${baseCloseY} Z`;

    return { lineD, areaD };
  }

  updateVisuals() {
    if (this._destroyed || !this.svgEl) return;

    const minL = this.options.bipolar ? -1.0 : 0.0;
    const maxL = 1.0;
    const W = this.options.viewBoxWidth;
    const H = this.options.viewBoxHeight;
    const midY = this.options.bipolar ? Math.round(H / 2) : H - 10;

    const points = this.calculatePoints(W, H, minL, maxL);
    const pathD = this.buildPathD(points, H, midY);

    if (this.fillPathEl) this.fillPathEl.setAttribute('d', pathD.areaD);
    if (this.linePathEl) this.linePathEl.setAttribute('d', pathD.lineD);

    const rect = this.svgEl.getBoundingClientRect();
    const sx = (rect && rect.width > 0) ? (rect.width / W) : 1;
    const sy = (rect && rect.height > 0) ? (rect.height / H) : 1;
    const outerRx = (5 / sx).toFixed(2);
    const outerRy = (5 / sy).toFixed(2);
    const hitRx = (14 / sx).toFixed(2);
    const hitRy = (14 / sy).toFixed(2);

    points.forEach((pt, idx) => {
      if (this.handleHitEls[idx]) {
        this.handleHitEls[idx].setAttribute('cx', String(pt.x));
        this.handleHitEls[idx].setAttribute('cy', String(pt.y));
        this.handleHitEls[idx].setAttribute('rx', hitRx);
        this.handleHitEls[idx].setAttribute('ry', hitRy);
      }
      if (this.handleOuterEls[idx]) {
        this.handleOuterEls[idx].setAttribute('cx', String(pt.x));
        this.handleOuterEls[idx].setAttribute('cy', String(pt.y));
        this.handleOuterEls[idx].setAttribute('rx', outerRx);
        this.handleOuterEls[idx].setAttribute('ry', outerRy);
      }
    });

    this.container.querySelectorAll('.btn-shaper-mode').forEach((btn) => {
      const mode = parseInt(btn.getAttribute('data-mode') || '1', 10);
      if (mode === this.mode) {
        btn.classList.add('btn-primary', 'active');
        btn.classList.remove('btn-outline');
      } else {
        btn.classList.remove('btn-primary', 'active');
        btn.classList.add('btn-outline');
      }
    });
  }

  bindEvents() {
    this.container.querySelectorAll('.btn-shaper-mode').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget;
        const newMode = parseInt(target.getAttribute('data-mode') || '1', 10);
        this.setMode(newMode);
      });
    });

    if (!this.options.editable || !this.svgEl) return;

    this.handlePointerDown = (e) => {
      const handleGroup = e.target.closest('.shaper-handle-group');
      if (!handleGroup) return;

      this.activeHandle = parseInt(handleGroup.getAttribute('data-handle') || '0', 10);
      this.isDragging = true;
      e.target.setPointerCapture(e.pointerId);
    };

    this.handlePointerMove = (e) => {
      if (!this.isDragging || this.activeHandle === null) return;

      const rect = this.svgEl.getBoundingClientRect();
      const marginX = 10;
      const marginY = 10;
      const availW = Math.max(1, rect.width - marginX * 2);
      const availH = Math.max(1, rect.height - marginY * 2);

      const clientX = clamp(e.clientX - rect.left - marginX, 0, availW);
      const clientY = clamp(e.clientY - rect.top - marginY, 0, availH);

      const normY = 1.0 - (clientY / availH);
      const minL = this.options.bipolar ? -1.0 : 0.0;
      const newL = minL + normY * (1.0 - minL);
      this.levels[this.activeHandle] = clamp(newL, minL, 1.0);

      const targetX = clamp(clientX / availW, 0.05, 1.0);
      const k = this.activeHandle;

      const minX = k === 0 ? 0.04 : this.cumX[k - 1] + 0.03;
      const maxX = k === 3 ? 1.0 : this.cumX[k + 1] - 0.03;

      this.cumX[k] = clamp(targetX, minX, maxX);

      this.times[0] = this.cumX[0];
      for (let i = 1; i < 4; i++) {
        this.times[i] = Math.max(0.01, this.cumX[i] - this.cumX[i - 1]);
      }

      this.updateVisuals();

      if (typeof this.options.onChange === 'function') {
        this.options.onChange({
          times: [...this.times],
          levels: [...this.levels],
          mode: this.mode,
        });
      }
    };

    this.handlePointerUp = (e) => {
      if (this.isDragging) {
        this.isDragging = false;
        this.activeHandle = null;
        try {
          e.target.releasePointerCapture(e.pointerId);
        } catch (_) {}
      }
    };

    this.svgEl.addEventListener('pointerdown', this.handlePointerDown);
    this.svgEl.addEventListener('pointermove', this.handlePointerMove);
    this.svgEl.addEventListener('pointerup', this.handlePointerUp);
    this.svgEl.addEventListener('pointercancel', this.handlePointerUp);

    if (typeof ResizeObserver !== 'undefined' && this.svgEl) {
      this.resizeObserver = new ResizeObserver(() => {
        this.updateVisuals();
      });
      this.resizeObserver.observe(this.svgEl);
    }
  }

  setMode(mode) {
    this.mode = mode;
    this.updateVisuals();
    if (typeof this.options.onChange === 'function') {
      this.options.onChange({
        times: [...this.times],
        levels: [...this.levels],
        mode: this.mode,
      });
    }
  }

  setValue({ times, levels, mode }, notify = false) {
    if (Array.isArray(times)) {
      this.times = [...times];
      this.initCumX();
    }
    if (Array.isArray(levels)) this.levels = [...levels];
    if (typeof mode === 'number') this.mode = mode;

    this.updateVisuals();

    if (notify && typeof this.options.onChange === 'function') {
      this.options.onChange({
        times: [...this.times],
        levels: [...this.levels],
        mode: this.mode,
      });
    }
  }

  getValue() {
    return {
      times: [...this.times],
      levels: [...this.levels],
      mode: this.mode,
    };
  }

  destroy() {
    this._destroyed = true;
    this.resizeObserver?.disconnect();
    this.container.innerHTML = '';
  }
}
