// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Zone Ribbon (128 MIDI Keys Partition View)
// Visualizes continuous zones across notes 0..127
// ─────────────────────────────────────────────────────────

import type { Zone } from '../core/types';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * Canonical Hartmann MODELmaker v1.2 MIDI note name (`0 = C-2`, `60 = C3`, `127 = G8`).
 * Verified against `neuronapp.NeuronApp.noteNames` (`MODELmaker_1_2.exe`).
 */
export function midiToNoteName(midi: number): string {
  if (midi < 0 || midi > 127) return '';
  const octave = Math.floor(midi / 12) - 2;
  const name = NOTE_NAMES[midi % 12];
  return `${name}${octave}`;
}

/**
 * Canonical Hartmann MODELmaker v1.2 `NeuronApp.midiNoteToString(int)` formatter
 * (`"0   C-2"`, `"60  C3"`, `"127 G8"`). Returns `""` if `midi < 0 || midi > 127`.
 */
export function midiNoteToString(midi: number): string {
  if (midi < 0 || midi > 127) return '';
  const pad = midi < 10 ? '   ' : midi < 100 ? '  ' : ' ';
  return `${midi}${pad}${midiToNoteName(midi)}`;
}

/**
 * Canonical `NeuronApp.detuneToString(int)` (`-99..+99` -> `"0"`, `"-N"`, `"+N"`).
 */
export function detuneToString(detune: number): string {
  const v = Math.round(detune);
  if (v < 0) return `-${-v}`;
  if (v > 0) return `+${v}`;
  return '0';
}

/**
 * Canonical `NeuronApp.volumeToString(int)` (`-32..+12` -> `"0"`, `"-N"`, `"+N"`).
 */
export function volumeToString(volume: number): string {
  const v = Math.round(volume);
  if (v < 0) return `-${-v}`;
  if (v > 0) return `+${v}`;
  return '0';
}

/**
 * Canonical `NeuronApp.volumeToLongString(int)` (`-32..+12` -> `"0dB"`, `"-NdB"`, `"+NdB"`).
 */
export function volumeToLongString(volume: number): string {
  const v = Math.round(volume);
  if (v < 0) return `-${-v}dB`;
  if (v > 0) return `+${v}dB`;
  return '0dB';
}

/**
 * Canonical `NeuronApp.panToString(int)` (`-50..+50` -> `"0"`, `"-N"`, `"+N"`).
 */
export function panToString(pan: number): string {
  const v = Math.round(pan);
  if (v < 0) return `-${-v}`;
  if (v > 0) return `+${v}`;
  return '0';
}

export interface ZoneRibbonWaveforms {
  lowOriginal: number[];
  highOriginal: number[] | null;
  processed: number[] | null;
  hasProcessed: boolean;
}

export interface ZoneRibbonHandlers {
  onSelectZone: (zoneId: string) => void;
  onSplitZone: (zoneId: string, splitKey: number) => void;
  onUpdateZone?: (zoneId: string, changes: Partial<Zone>) => void;
  getWaveforms?: (zoneId: string) => ZoneRibbonWaveforms;
  onWaveModeChange?: (mode: 'original' | 'resynthesis') => void;
}

function buildWatermarkSvg(peaks: number[], isProcessed: boolean): string {
  if (!peaks || peaks.length === 0) return '';
  const n = peaks.length;
  const topPoints: string[] = [];
  const botPoints: string[] = [];
  for (let i = 0; i < n; i++) {
    const x = ((i / Math.max(1, n - 1)) * 100).toFixed(1);
    const amp = Math.max(0.04, Math.min(0.95, peaks[i] ?? 0));
    const yTop = (20 - amp * 17).toFixed(1);
    const yBot = (20 + amp * 17).toFixed(1);
    topPoints.push(`${x},${yTop}`);
    botPoints.unshift(`${x},${yBot}`);
  }
  const polyPoints = [...topPoints, ...botPoints].join(' ');
  return `
    <svg class="zone-waveform-watermark ${isProcessed ? 'is-processed' : 'is-original'}" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1="20" x2="100" y2="20" class="watermark-centerline" />
      <polygon points="${polyPoints}" class="watermark-polygon" />
    </svg>
  `;
}

export class ZoneRibbon {
  private container: HTMLElement;
  private handlers: ZoneRibbonHandlers;
  private activeZoneId: string | null = null;
  private currentZones: Zone[] = [];
  private waveMode: 'original' | 'resynthesis' = 'original';

  constructor(container: HTMLElement, handlers: ZoneRibbonHandlers) {
    this.container = container;
    this.handlers = handlers;
  }

  public setZones(zones: Zone[], activeId: string | null): void {
    this.currentZones = zones;
    this.activeZoneId = activeId ?? (zones[0]?.id || null);
    this.render();
  }

  public setActiveZone(zoneId: string): void {
    this.activeZoneId = zoneId;
    const items = this.container.querySelectorAll('.ribbon-zone-block');
    items.forEach((el) => {
      const elId = el.getAttribute('data-zone-id');
      el.classList.toggle('is-selected', elId === zoneId);
    });
  }

  private render(): void {
    const anyHasProcessed = this.currentZones.some(
      (z) => this.handlers.getWaveforms?.(z.id)?.hasProcessed ?? false
    );
    if (!anyHasProcessed && this.waveMode === 'resynthesis') {
      this.waveMode = 'original';
    }

    this.container.innerHTML = `
      <div class="zone-ribbon-card">
        <div class="ribbon-header">
          <div class="ribbon-title">
            <span class="ribbon-caption">KEY (0 C-2 .. 127 G8) &times; VELOCITY (1..127) ZONE MAP</span>
          </div>
          <div class="ribbon-header-right">
            <span class="ribbon-hint">Drag vertical border = Key Split (no overlap) &bull; Double-Click = Split Zone</span>
            <div class="ribbon-wave-toggle" role="group" aria-label="Zone Waveform Display">
              <span class="ribbon-wave-label">WAVE:</span>
              <button type="button" class="btn-ribbon-wave ${this.waveMode === 'original' ? 'is-active' : ''}" data-wave-mode="original" title="Show Original Sample Waveform in Zone Map">
                A: Original
              </button>
              <button type="button" class="btn-ribbon-wave ${this.waveMode === 'resynthesis' ? 'is-active' : ''}" data-wave-mode="resynthesis" ${!anyHasProcessed ? 'disabled title="Generate or inspect model first to view Processed Resynthesis Waveform"' : 'title="Show Processed Resynthesis Waveform in Zone Map"'}>
                B: Processed
              </button>
            </div>
          </div>
        </div>

        <div class="ribbon-map-row">
          <div class="ribbon-vel-axis" title="MIDI Velocity Range (1..127)">
            <span>127</span>
            <span>64</span>
            <span>1</span>
          </div>
          <div class="ribbon-strip-track" id="ribbon-track">
            ${this.currentZones.map((zone, idx) => this.renderZoneBlock(zone, idx)).join('')}
          </div>
        </div>

        <div class="ribbon-octave-ruler">
          ${this.renderRulerMarkers()}
        </div>
      </div>
    `;

    const trackEl = this.container.querySelector<HTMLElement>('#ribbon-track');

    // Bind waveform mode toggle buttons (A: Original vs B: Processed)
    const waveBtns = this.container.querySelectorAll<HTMLButtonElement>('.btn-ribbon-wave');
    waveBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const mode = (btn.getAttribute('data-wave-mode') || 'original') as 'original' | 'resynthesis';
        if (mode !== this.waveMode) {
          this.waveMode = mode;
          this.handlers.onWaveModeChange?.(mode);
          this.render();
        }
      });
    });

    // Bind click and split events on zone blocks
    const blocks = this.container.querySelectorAll<HTMLElement>('.ribbon-zone-block');
    blocks.forEach((el) => {
      el.addEventListener('click', (e: MouseEvent) => {
        if ((e.target as HTMLElement).closest('.zone-key-resizer, .zone-vel-resizer')) {
          return;
        }
        const id = el.getAttribute('data-zone-id');
        if (!id) return;
        if (e.altKey) {
          e.preventDefault();
          this.splitBlockAtMouse(el, id, e);
          return;
        }
        this.handlers.onSelectZone(id);
        this.setActiveZone(id);
      });

      el.addEventListener('dblclick', (e: MouseEvent) => {
        if ((e.target as HTMLElement).closest('.zone-key-resizer, .zone-vel-resizer')) {
          return;
        }
        const id = el.getAttribute('data-zone-id');
        if (!id) return;
        e.preventDefault();
        this.splitBlockAtMouse(el, id, e);
      });
    });

    // Bind collision-free vertical Key Boundary dragging between Zone i and Zone i+1
    const keyResizers = this.container.querySelectorAll<HTMLElement>('.zone-key-resizer');
    keyResizers.forEach((handle) => {
      handle.addEventListener('mousedown', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const zoneId = handle.getAttribute('data-zone-id');
        const idx = this.currentZones.findIndex((z) => z.id === zoneId);
        if (!zoneId || idx < 0 || idx >= this.currentZones.length - 1 || !trackEl) return;

        const currZone = this.currentZones[idx];
        const nextZone = this.currentZones[idx + 1];
        const minHigh = currZone.lowKey;
        const maxHigh = nextZone.highKey - 1;
        let lastHigh = currZone.highKey;

        const onMove = (moveEvt: MouseEvent) => {
          const rect = trackEl.getBoundingClientRect();
          const relX = Math.max(0, Math.min(1, (moveEvt.clientX - rect.left) / Math.max(1, rect.width)));
          const midiAtCursor = Math.floor(relX * 128);
          const clampedHigh = Math.max(minHigh, Math.min(maxHigh, midiAtCursor));
          if (clampedHigh !== lastHigh) {
            lastHigh = clampedHigh;
            this.handlers.onUpdateZone?.(zoneId, { highKey: clampedHigh });
          }
        };

        const onUp = () => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });
    });
  }

  private splitBlockAtMouse(el: HTMLElement, zoneId: string, e: MouseEvent): void {
    const zone = this.currentZones.find((z) => z.id === zoneId);
    if (!zone || zone.highKey <= zone.lowKey) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0.05, Math.min(0.95, (e.clientX - rect.left) / Math.max(1, rect.width)));
    const span = zone.highKey - zone.lowKey + 1;
    const splitKey = Math.max(
      zone.lowKey + 1,
      Math.min(zone.highKey, zone.lowKey + Math.round(ratio * span))
    );
    this.handlers.onSplitZone(zoneId, splitKey);
  }

  private renderZoneBlock(zone: Zone, index: number): string {
    const span = Math.max(1, zone.highKey - zone.lowKey + 1);
    const widthPct = (span / 128) * 100;
    const isSelected = zone.id === this.activeZoneId;
    const lowLabel = zone.sampleLow ? zone.sampleLow.split(/[\\/]/).pop() : 'NO SAMPLE';
    const highLabel = zone.sampleHigh ? zone.sampleHigh.split(/[\\/]/).pop() : null;
    const lowStr = midiToNoteName(zone.lowKey);
    const highStr = midiToNoteName(zone.highKey);
    const rootStr = midiToNoteName(zone.rootKey);
    const hasHighVel = Boolean(highLabel);
    const rootRelPct =
      span > 1
        ? ((zone.rootKey - zone.lowKey + 0.5) / span) * 100
        : 50;
    const canResizeRight = index < this.currentZones.length - 1;
    const wf = this.handlers.getWaveforms?.(zone.id);
    const useProcessed = this.waveMode === 'resynthesis' && wf?.processed && wf.processed.length > 0;
    const lowPeaks = useProcessed ? wf!.processed! : (wf?.lowOriginal ?? []);
    const highPeaks = useProcessed ? wf!.processed! : (wf?.highOriginal ?? lowPeaks);
    const lowSvg = buildWatermarkSvg(lowPeaks, Boolean(useProcessed));
    const highSvg = buildWatermarkSvg(highPeaks, Boolean(useProcessed));

    const velocityBandsHtml = hasHighVel
      ? `
        <div class="zone-vel-band zone-vel-high" style="height: 50%;" title="High Vel (64..127): ${highLabel}">
          ${highSvg}
          <span class="vel-band-badge">V 64–127</span>
          <span class="zone-sample-tag">${highLabel}</span>
        </div>
        <div class="zone-vel-divider"></div>
        <div class="zone-vel-band zone-vel-low ${!zone.sampleLow ? 'is-missing-vel' : ''}" style="height: 50%;" title="Low Vel (1..63): ${lowLabel}">
          ${lowSvg}
          <span class="vel-band-badge">V 1–63</span>
          <span class="zone-sample-tag">${lowLabel}</span>
        </div>
      `
      : `
        <div class="zone-vel-band zone-vel-full" style="height: 100%;" title="Full Velocity (1..127): ${lowLabel}">
          ${lowSvg}
          <span class="vel-band-badge">V 1–127</span>
          <span class="zone-sample-tag">${lowLabel}</span>
        </div>
      `;

    return `
      <div 
        class="ribbon-zone-block ${isSelected ? 'is-selected' : ''} ${!zone.sampleLow ? 'has-no-sample' : ''} ${hasHighVel ? 'has-two-vel-layers' : ''}" 
        data-zone-id="${zone.id}"
        style="width: ${widthPct.toFixed(3)}%;"
        title="Zone #${index + 1}: Keys ${lowStr} (${zone.lowKey}) .. ${highStr} (${zone.highKey}) | Root: ${rootStr} (${zone.rootKey}) | ${hasHighVel ? 'Low Vel 1..63 + High Vel 64..127' : 'Vel 1..127'}"
      >
        <div class="zone-block-header">
          <span class="zone-num">#${index + 1}</span>
          <span class="zone-range">${lowStr}–${highStr}</span>
          <span class="zone-root-marker">R:${rootStr}</span>
        </div>
        <div class="zone-block-body">
          ${velocityBandsHtml}
          <div class="zone-root-pin-line" style="left: ${rootRelPct.toFixed(1)}%;" title="Root Key: ${rootStr} (${zone.rootKey})"></div>
        </div>
        ${canResizeRight ? `<div class="zone-key-resizer" data-zone-id="${zone.id}" title="Drag to move boundary between Zone #${index + 1} and Zone #${index + 2}"></div>` : ''}
      </div>
    `;
  }

  private renderRulerMarkers(): string {
    const markers: string[] = [];
    for (let note = 0; note <= 120; note += 12) {
      const leftPct = (note / 128) * 100;
      markers.push(`
        <div class="ruler-mark" style="left: ${leftPct.toFixed(2)}%;">
          <span class="ruler-tick">|</span>
          <span class="ruler-label">${midiToNoteName(note)} (${note})</span>
        </div>
      `);
    }
    // Add end marker 127
    markers.push(`
      <div class="ruler-mark ruler-mark-end" style="left: ${(127 / 128 * 100).toFixed(2)}%;">
        <span class="ruler-tick">|</span>
        <span class="ruler-label">${midiToNoteName(127)} (127)</span>
      </div>
    `);
    return markers.join('');
  }
}
