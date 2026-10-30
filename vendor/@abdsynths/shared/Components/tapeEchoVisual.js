/**
 * ABD TapeEchoVisual — RE-201 style tape echo SVG visualization.
 * Includes: two reels, three playback heads, capstan, sync indicator, BPM display.
 *
 * Usage:
 *   const tape = new TapeEchoVisual(el, { width: 220, height: 85 });
 *   tape.setSyncEnabled(true);
 *   tape.setBPM(120);
 *   tape.setSyncDivision(3); // 1/4T
 *   tape.setHeadActive(0, true);
 */
/**
 * @param {HTMLElement|string} container
 * @param {object} options
 *   width   px, default 220.
 *   height  px, default 85.
 */
export class TapeEchoVisual {
    constructor(container, options = {}) {
        this.container = typeof container === 'string'
            ? document.querySelector(container)
            : container;

        if (!this.container) throw new Error('TapeEchoVisual: container not found');

        this.options = {
            width: options.width ?? 220,
            height: options.height ?? 85,
            ...options,
        };

        this.syncEnabled = false;
        this.bpm = 120;
        this.syncDivision = 3; // 1/4T
        this.headStates = [false, false, false];
        this.reelRotation = 0;

        this.buildDom();
        this.startAnimation();
    }

    buildDom() {
        const { width, height } = this.options;

        this.wrapper = document.createElement('div');
        this.wrapper.className = 'abd-tape-echo-visual';
        this.wrapper.style.cssText = `
            width: ${width}px;
            height: ${height}px;
            position: relative;
            overflow: visible;
        `;

        this.wrapper.innerHTML = `
            <svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" style="width: 100%; height: 100%; display: block;">
                <!-- Peak Level LED -->
                <rect id="peak-led" x="2" y="4" width="32" height="17" fill="none" stroke="none" opacity="0" />

                <!-- Tape path -->
                <path id="tape-path" d="M 28 38 Q 60 30 95 42 L 135 42 Q 165 30 192 38" fill="none" stroke="#555" stroke-width="2.5" stroke-dasharray="4 3"/>

                <!-- Left Reel -->
                <g id="reel-left">
                    <circle cx="28" cy="48" r="22" fill="#1a1a1a" stroke="#3a3a3a" stroke-width="1.5"/>
                    <circle cx="28" cy="48" r="7" fill="#252525" stroke="#4a4a4a" stroke-width="1"/>
                    <circle cx="28" cy="48" r="3" fill="#444"/>
                    <line x1="28" y1="28" x2="28" y2="68" stroke="#303030" stroke-width="1.5"/>
                    <line x1="8" y1="48" x2="48" y2="48" stroke="#303030" stroke-width="1.5"/>
                    <line x1="14" y1="34" x2="42" y2="62" stroke="#303030" stroke-width="1.5"/>
                    <line x1="14" y1="62" x2="42" y2="34" stroke="#303030" stroke-width="1.5"/>
                </g>

                <!-- Right Reel -->
                <g id="reel-right">
                    <circle cx="192" cy="48" r="22" fill="#1a1a1a" stroke="#3a3a3a" stroke-width="1.5"/>
                    <circle cx="192" cy="48" r="7" fill="#252525" stroke="#4a4a4a" stroke-width="1"/>
                    <circle cx="192" cy="48" r="3" fill="#444"/>
                    <line x1="192" y1="28" x2="192" y2="68" stroke="#303030" stroke-width="1.5"/>
                    <line x1="172" y1="48" x2="212" y2="48" stroke="#303030" stroke-width="1.5"/>
                    <line x1="178" y1="34" x2="206" y2="62" stroke="#303030" stroke-width="1.5"/>
                    <line x1="178" y1="62" x2="206" y2="34" stroke="#303030" stroke-width="1.5"/>
                </g>

                <!-- Playback Heads -->
                <g id="playback-heads">
                    <rect x="103" y="26" width="24" height="24" rx="2" fill="#222" stroke="#444" stroke-width="1" class="heads-bezel"/>
                    <rect id="head-h1" x="107" y="30" width="5" height="16" rx="1" fill="#555" stroke="#666" stroke-width="0.5"/>
                    <rect id="head-h2" x="115" y="30" width="5" height="16" rx="1" fill="#555" stroke="#666" stroke-width="0.5"/>
                    <rect id="head-h3" x="123" y="30" width="5" height="16" rx="1" fill="#555" stroke="#666" stroke-width="0.5"/>
                    <text x="115" y="58" text-anchor="middle" fill="#555" font-family="monospace" font-size="6">H1 H2 H3</text>
                </g>

                <!-- Capstan -->
                <circle id="capstan" cx="152" cy="48" r="5" fill="#2a2a2a" stroke="#555" stroke-width="1"/>
                <circle cx="162" cy="48" r="3.5" fill="#222" stroke="#3a3a3a" stroke-width="0.8"/>

                <!-- Guides -->
                <circle cx="52" cy="42" r="3" fill="#222" stroke="#3a3a3a" stroke-width="0.8"/>
                <circle cx="170" cy="42" r="3" fill="#222" stroke="#3a3a3a" stroke-width="0.8"/>

                <!-- Labels -->
                <text x="110" y="78" text-anchor="middle" fill="#555" font-family="Microgramma, monospace" font-size="8" letter-spacing="3">TAPE ECHO</text>

                <!-- Sync indicator badge -->
                <text id="svg-sync-indicator" x="115" y="20" text-anchor="middle" fill="#444" font-family="Microgramma, monospace" font-size="6" letter-spacing="1" class="svg-sync-hidden">SYNC 1/4</text>

                <!-- BPM indicator -->
                <text id="svg-bpm-indicator" x="${width - 28}" y="${height - 2}" text-anchor="end" fill="#444" font-family="Microgramma, monospace" font-size="7" letter-spacing="2" class="svg-bpm-hidden"></text>
            </svg>
        `;

        this.container.appendChild(this.wrapper);

        // Cache elements
        this.peakLedEl = this.wrapper.querySelector('#peak-led');
        this.svgSyncEl = this.wrapper.querySelector('#svg-sync-indicator');
        this.svgBpmEl = this.wrapper.querySelector('#svg-bpm-indicator');
        this.headEls = [
            this.wrapper.querySelector('#head-h1'),
            this.wrapper.querySelector('#head-h2'),
            this.wrapper.querySelector('#head-h3'),
        ];
        this.reelLeftEl = this.wrapper.querySelector('#reel-left');
        this.reelRightEl = this.wrapper.querySelector('#reel-right');
        this.capstanEl = this.wrapper.querySelector('#capstan');
    }

    startAnimation() {
        this._animating = true;
        this._animate();
    }

    _animate() {
        if (!this._animating) return;

        // Rotate reels
        this.reelRotation += 0.8;
        if (this.reelLeftEl) this.reelLeftEl.style.transform = `rotate(${this.reelRotation}deg)`;
        if (this.reelRightEl) this.reelRightEl.style.transform = `rotate(${-this.reelRotation}deg)`;
        if (this.capstanEl) this.capstanEl.style.transform = `rotate(${this.reelRotation * 2}deg)`;

        // Animate playback heads (simulate tape movement)
        this.headEls.forEach((head, i) => {
            if (head && this.headStates[i]) {
                head.style.fill = '#ff4400';
                head.style.boxShadow = '0 0 4px #ff4400';
            } else if (head) {
                head.style.fill = '#555';
                head.style.boxShadow = 'none';
            }
        });

        requestAnimationFrame(() => this._animate());
    }

    /** Trigger peak LED flash. */
    triggerPeak(duration = 60) {
        if (this.peakLedEl) {
            this.peakLedEl.style.opacity = '1';
            this.peakLedEl.style.fill = '#ff4400';
            clearTimeout(this._peakTimeout);
            this._peakTimeout = setTimeout(() => {
                if (this.peakLedEl) this.peakLedEl.style.opacity = '0';
            }, duration);
        }
    }

    /**
     * Set head active/inactive (0,1,2).
     * @param {number} index  head index, 0..2.
     * @param {boolean} active
     */
    setHeadActive(index, active) {
        this.headStates[index] = !!active;
    }

    /**
     * Set sync enabled state.
     * @param {boolean} enabled
     */
    setSyncEnabled(enabled) {
        this.syncEnabled = !!enabled;
        if (this.svgSyncEl) {
            this.svgSyncEl.classList.toggle('svg-sync-hidden', !enabled);
            this.svgSyncEl.classList.toggle('svg-sync-visible', enabled);
            this.svgSyncEl.textContent = enabled ? `SYNC ${this._divisionName()}` : '';
        }
    }

    /**
     * Set BPM display.
     * @param {number} bpm
     */
    setBPM(bpm) {
        this.bpm = bpm;
        if (this.svgBpmEl) {
            this.svgBpmEl.classList.toggle('svg-bpm-hidden', !this.syncEnabled);
            this.svgBpmEl.textContent = `${bpm} BPM`;
        }
    }

    /**
     * Set sync division (0-8).
     * @param {number} index
     */
    setSyncDivision(index) {
        this.syncDivision = index;
        if (this.svgSyncEl && this.syncEnabled) {
            this.svgSyncEl.textContent = `SYNC ${this._divisionName()}`;
        }
    }

    _divisionName() {
        const names = ['1/1', '1/2', '1/4', '1/4T', '1/8', '1/8T', '1/16', '1/16T', '1/32'];
        return names[this.syncDivision] ?? '1/4';
    }

    destroy() {
        this._animating = false;
        clearTimeout(this._peakTimeout);
        this.wrapper.remove();
    }
}