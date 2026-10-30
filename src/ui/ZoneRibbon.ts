// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Zone Ribbon (128 MIDI Keys Partition View)
// Visualizes continuous zones across notes 0..127
// ─────────────────────────────────────────────────────────

import type { ExtendedRegion, WorkingMode, Zone } from '../core/types';
import {
  analyzeClassicZoneOverlaps,
  analyzeExtendedIntersections,
} from '../core/extendedAdapter';
import type { RowAuditionSpan } from '../core/noteMapping';
import { ICONS } from './icons';

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
  onDropSample?: (zoneId: string, slot: 'low' | 'high', file: File) => void;
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
  private extendedRegions: ExtendedRegion[] = [];
  private workingMode: WorkingMode = 'classic';
  private waveMode: 'original' | 'resynthesis' = 'original';
  private auditionSpan: RowAuditionSpan | null = null;

  constructor(container: HTMLElement, handlers: ZoneRibbonHandlers) {
    this.container = container;
    this.handlers = handlers;
  }

  public setZones(
    zones: Zone[],
    activeId: string | null,
    extendedRegions?: ExtendedRegion[],
    workingMode?: WorkingMode
  ): void {
    this.currentZones = zones;
    this.activeZoneId = activeId ?? (zones[0]?.id || null);
    if (extendedRegions !== undefined) {
      this.extendedRegions = extendedRegions;
    }
    if (workingMode !== undefined) {
      this.workingMode = workingMode;
    }
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

  /**
   * Shows the key × velocity rectangle of the row being auditioned from the table
   * (classic zone velocity layer or extended region). `null` clears it.
   */
  public setAuditionSpan(span: RowAuditionSpan | null): void {
    this.auditionSpan = span ? { ...span } : null;
    this.applyAuditionSpan();
  }

  private applyAuditionSpan(): void {
    const track = this.container.querySelector<HTMLElement>('#ribbon-track');
    if (!track) return;
    track.querySelector('.ribbon-audition-overlay')?.remove();
    track
      .querySelectorAll('.ribbon-zone-block.is-auditioning')
      .forEach((el) => el.classList.remove('is-auditioning'));
    const s = this.auditionSpan;
    if (!s) return;

    if (s.zoneId) {
      track
        .querySelector(`.ribbon-zone-block[data-zone-id="${CSS.escape(s.zoneId)}"]`)
        ?.classList.add('is-auditioning');
    }
    const leftPct = (s.lowKey / 128) * 100;
    const widthPct = (Math.max(1, s.highKey - s.lowKey + 1) / 128) * 100;
    const bottomPct = ((s.lowVel - 1) / 127) * 100;
    const heightPct = (Math.max(1, s.highVel - s.lowVel + 1) / 127) * 100;
    const overlay = document.createElement('div');
    overlay.className = 'ribbon-audition-overlay';
    overlay.style.left = `${leftPct.toFixed(3)}%`;
    overlay.style.width = `${widthPct.toFixed(3)}%`;
    overlay.style.bottom = `${bottomPct.toFixed(2)}%`;
    overlay.style.height = `${heightPct.toFixed(2)}%`;
    overlay.title = `Auditioning: Keys ${midiToNoteName(s.lowKey)}..${midiToNoteName(s.highKey)}, Root ${midiToNoteName(s.rootKey)}, Vel ${s.lowVel}..${s.highVel}`;
    const span = Math.max(1, s.highKey - s.lowKey + 1);
    const rootPct = ((s.rootKey - s.lowKey + 0.5) / span) * 100;
    overlay.innerHTML = `<span class="ribbon-audition-tag">▶ ${midiToNoteName(s.lowKey)}–${midiToNoteName(s.highKey)} · V${s.lowVel}–${s.highVel}</span><span class="ribbon-audition-root" style="left:${Math.max(0, Math.min(100, rootPct)).toFixed(1)}%"></span>`;
    track.appendChild(overlay);
  }

  private render(): void {
    const anyHasProcessed = this.currentZones.some(
      (z) => this.handlers.getWaveforms?.(z.id)?.hasProcessed ?? false
    );
    if (!anyHasProcessed && this.waveMode === 'resynthesis') {
      this.waveMode = 'original';
    }

    const extReport =
      this.workingMode === 'extended' && this.extendedRegions.length > 0
        ? analyzeExtendedIntersections(this.extendedRegions)
        : null;
    const classicOverlaps = analyzeClassicZoneOverlaps(this.currentZones);
    const classicOverlapBoxes: Array<{
      lowKey: number;
      highKey: number;
      lowVel: number;
      highVel: number;
      label: string;
    }> = [];
    for (let i = 0; i < this.currentZones.length; i++) {
      for (let j = i + 1; j < this.currentZones.length; j++) {
        const a = this.currentZones[i];
        const b = this.currentZones[j];
        const ovLow = Math.max(a.lowKey, b.lowKey);
        const ovHigh = Math.min(a.highKey, b.highKey);
        if (ovLow <= ovHigh) {
          classicOverlapBoxes.push({
            lowKey: ovLow,
            highKey: ovHigh,
            lowVel: 1,
            highVel: 127,
            label: `#${i + 1}+#${j + 1}`,
          });
        }
      }
    }

    const intersectionOverlaysHtml = extReport
      ? extReport.intersectionBoxes
          .map((box) => {
            const leftPct = (box.lowKey / 128) * 100;
            const widthPct = (Math.max(1, box.highKey - box.lowKey + 1) / 128) * 100;
            const bottomPct = ((box.lowVel - 1) / 127) * 100;
            const heightPct = (Math.max(1, box.highVel - box.lowVel + 1) / 127) * 100;
            const regListStr = box.regionIndices.map((n) => `#${n}`).join(' & ');
            const keyRangeStr = `${midiToNoteName(box.lowKey)} (${box.lowKey})..${midiToNoteName(box.highKey)} (${box.highKey})`;
            return `
              <div
                class="ribbon-intersection-overlay"
                style="left: ${leftPct.toFixed(3)}%; width: ${widthPct.toFixed(3)}%; bottom: ${bottomPct.toFixed(1)}%; height: ${heightPct.toFixed(1)}%;"
                title="Range/Velocity Intersection: Regions ${regListStr} overlap on Keys ${keyRangeStr}, Vel ${box.lowVel}..${box.highVel}"
              >
                <span class="ribbon-intersection-tag">${ICONS.alert} #${box.regionIndices.join('+')}</span>
              </div>
            `;
          })
          .join('')
      : classicOverlapBoxes
          .map((box) => {
            const leftPct = (box.lowKey / 128) * 100;
            const widthPct = (Math.max(1, box.highKey - box.lowKey + 1) / 128) * 100;
            return `
              <div
                class="ribbon-intersection-overlay"
                style="left: ${leftPct.toFixed(3)}%; width: ${widthPct.toFixed(3)}%; bottom: 0%; height: 100%;"
                title="Zone Key Overlap (${box.label}) on Keys ${midiToNoteName(box.lowKey)}..${midiToNoteName(box.highKey)}"
              >
                <span class="ribbon-intersection-tag">${ICONS.alert} ${box.label}</span>
              </div>
            `;
          })
          .join('');

    const totalIntersections = extReport
      ? extReport.totalIntersectingPairs
      : classicOverlapBoxes.length;

    const overlapHeaderPill =
      totalIntersections > 0
        ? `<span class="ribbon-overlap-pill" title="${totalIntersections} range/velocity intersection(s) detected. Highlighted in the zone map below so you can verify whether layering is intentional.">${ICONS.alert} ${totalIntersections} INTERSECTION${totalIntersections > 1 ? 'S' : ''}</span>`
        : '';

    this.container.innerHTML = `
      <div class="zone-ribbon-card">
        <div class="ribbon-header">
          <div class="ribbon-title">
            <span class="ribbon-caption">KEY (0 C-2 .. 127 G8) &times; VELOCITY (1..127) ZONE MAP</span>
            ${overlapHeaderPill}
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
            ${this.currentZones
              .map((zone, idx) =>
                this.renderZoneBlock(zone, idx, extReport, classicOverlaps[zone.id]?.overlappingZones ?? [])
              )
              .join('')}
            ${intersectionOverlaysHtml}
          </div>
        </div>

        <div class="ribbon-octave-ruler">
          ${this.renderRulerMarkers()}
        </div>
      </div>
    `;

    const trackEl = this.container.querySelector<HTMLElement>('#ribbon-track');
    this.applyAuditionSpan();

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

      el.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const id = el.getAttribute('data-zone-id');
          if (id) {
            this.handlers.onSelectZone(id);
            this.setActiveZone(id);
          }
        }
      });
    });

    // Bind sample drag & drop onto velocity bands
    const velBands = this.container.querySelectorAll<HTMLElement>('.zone-vel-band');
    velBands.forEach((band) => {
      band.addEventListener('dragover', (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        band.classList.add('is-drag-over');
      });
      band.addEventListener('dragleave', (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        band.classList.remove('is-drag-over');
      });
      band.addEventListener('drop', (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        band.classList.remove('is-drag-over');
        const block = band.closest('.ribbon-zone-block');
        const zoneId = block?.getAttribute('data-zone-id');
        const slot = band.classList.contains('zone-vel-high') ? 'high' : 'low';
        const file = e.dataTransfer?.files?.[0];
        if (zoneId && file && this.handlers.onDropSample) {
          this.handlers.onDropSample(zoneId, slot, file);
        }
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

  private renderZoneBlock(
    zone: Zone,
    index: number,
    extReport?: ReturnType<typeof analyzeExtendedIntersections> | null,
    classicOverlaps: Array<{ id: string; index: number; overlapLowKey: number; overlapHighKey: number }> = []
  ): string {
    const span = Math.max(1, zone.highKey - zone.lowKey + 1);
    const widthPct = (span / 128) * 100;
    const isSelected = zone.id === this.activeZoneId;
    const lowLabel = zone.sampleLow ? zone.sampleLow.split(/[\\/]/).pop() : '(No sample)';
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

    const extSpanIntersections = extReport
      ? extReport.intersectingKeySpans.filter(
          (sp) => sp.lowKey <= zone.highKey && sp.highKey >= zone.lowKey
        )
      : [];
    const isIntersecting = extSpanIntersections.length > 0 || classicOverlaps.length > 0;
    const intersectPeerText = extSpanIntersections.length > 0
      ? `Regions ${Array.from(new Set(extSpanIntersections.flatMap((s) => s.regionIndices))).map((n) => `#${n}`).join(', ')}`
      : classicOverlaps.length > 0
        ? `Zones ${classicOverlaps.map((o) => `#${o.index}`).join(', ')}`
        : '';

    const split = Math.max(2, Math.min(127, zone.velSplit ?? 64));
    const highPct = ((128 - split) / 127) * 100;
    const lowPct = ((split - 1) / 127) * 100;
    const highVelText = `${split}–127`;
    const lowVelText = `1–${split - 1}`;
    const highVelTitle = `High Vel (${split}..127): ${highLabel}`;
    const lowVelTitle = `Low Vel (1..${split - 1}): ${lowLabel}`;

    const velocityBandsHtml = hasHighVel
      ? `
        <div class="zone-vel-band zone-vel-high" style="height: ${highPct.toFixed(1)}%;" title="${highVelTitle}">
          ${highSvg}
          <span class="vel-band-badge">V ${highVelText}</span>
          <span class="zone-sample-tag">${highLabel}</span>
        </div>
        <div class="zone-vel-divider" title="Split Point @ ${split} · Low: 1–${split - 1} | High: ${split}–127">
          <span class="vel-divider-handle">${split}</span>
        </div>
        <div class="zone-vel-band zone-vel-low ${!zone.sampleLow ? 'is-missing-vel' : ''}" style="height: ${lowPct.toFixed(1)}%;" title="${lowVelTitle}">
          ${lowSvg}
          <span class="vel-band-badge">V ${lowVelText}</span>
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

    const zoneTitle = `Zone #${index + 1}: Keys ${lowStr} (${zone.lowKey}) .. ${highStr} (${zone.highKey}) | Root: ${rootStr} (${zone.rootKey}) | ${hasHighVel ? `Low Vel 1..${split - 1} + High Vel ${split}..127` : 'Vel 1..127'}${isIntersecting ? ` | INTERSECTION (${intersectPeerText})` : ''}`;

    return `
      <div 
        class="ribbon-zone-block ${isSelected ? 'is-selected' : ''} ${!zone.sampleLow ? 'has-no-sample' : ''} ${hasHighVel ? 'has-two-vel-layers' : ''} ${isIntersecting ? 'is-intersecting' : ''}" 
        data-zone-id="${zone.id}"
        tabindex="0"
        role="button"
        aria-label="Zone #${index + 1}: Keys ${lowStr} to ${highStr}"
        style="width: ${widthPct.toFixed(3)}%;"
        title="${zoneTitle}"
      >
        <div class="zone-block-header">
          <span class="zone-num">${isIntersecting ? `${ICONS.alert} ` : ''}#${index + 1}</span>
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
