// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Fase 18: Audio Chopper & Multi-Layer Auto-Slicer Modal
//
// High-precision interactive waveform slicer with draggable slice markers,
// zero-crossing snapping, seam magnifier inspection (±256 samples),
// real-time zoom cut dragging for micro-adjustments, right-click context menu,
// manual silence marking, ReCycle (.rx2, .rex, .rcy) & CUE/SFZ slice file import,
// vocal & phrase mode, General MIDI Drum mapping, chromatic keybed distribution,
// and draggable Standard MIDI File (.mid) export for DAWs.
// ─────────────────────────────────────────────────────────

import { ICONS } from './icons.ts';
import { escHtml } from './escape.ts';
import { toast } from './notify.ts';
import { clamp } from '../core/dsp/DspMath.ts';
import { encodePcm16Wav } from '../core/dsp/WavDecoder.ts';
import {
  computeZoomedWaveformEnvelope,
  snapFrameToNearestZeroCrossing,
} from '../core/dsp/LoopEditorTools.ts';
import {
  sliceAudioBuffer,
  buildSlicesFromBoundaries,
  moveSliceBoundary,
  splitSliceAtFrame,
  deleteSlice,
  toggleSliceSilence,
  extractBoundaryFrames,
  DEFAULT_SLICER_OPTIONS,
  type DetectedSlice,
  type SlicerOptions,
  type SlicerResult,
} from '../core/dsp/AudioSlicerEngine.ts';
import { parseSliceFile } from '../core/dsp/SliceFileParser.ts';
import type { Zone, ExtendedRegion, WorkingMode } from '../core/types.ts';
import { midiToNoteName } from './ZoneRibbon.ts';

export interface AudioChopperContext {
  getCurrentWorkingMode: () => WorkingMode;
  onInjectClassicZones?: (
    zones: Zone[],
    audioSamples: Array<{ name: string; buffer: ArrayBuffer }>
  ) => void;
  onInjectExtendedRegions?: (
    regions: ExtendedRegion[],
    audioSamples: Array<{ name: string; buffer: ArrayBuffer }>
  ) => void;
  onAuditionPcm?: (pcm: Float32Array, sampleRate: number) => void;
  onStopAudition?: () => void;
  onRegisterSampleBuffer?: (name: string, buffer: ArrayBuffer) => void;
}

interface ContextMenuItem {
  label: string;
  icon?: string;
  isHeader?: boolean;
  isDivider?: boolean;
  isDanger?: boolean;
  onClick?: () => void;
}

export class AudioChopperModal {
  private backdropEl: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private magnifierCanvas: HTMLCanvasElement | null = null;
  private pcm: Float32Array = new Float32Array(0);
  private sampleRate: number = 44100;
  private sourceFilename: string = '';
  private context: AudioChopperContext;

  private options: SlicerOptions = { ...DEFAULT_SLICER_OPTIONS };
  private currentResult: SlicerResult | null = null;
  private selectedSliceId: string | null = null;
  private playingSliceId: string | null = null;

  // Selected boundary for Magnifier view (1..N-1 index in boundary list)
  private activeBoundaryIndex: number = 1;

  // Zoom and Canvas Viewport
  private zoomFactor: number = 1.0;
  private viewCenterNorm: number = 0.5;

  // Overview Waveform Dragging state
  private isDraggingBoundary: boolean = false;
  private draggedBoundaryIndex: number = -1;
  private hoveredBoundaryIndex: number = -1;

  // Magnifier Canvas Dragging state (sample-level micro-adjustments)
  private isDraggingMagnifier: boolean = false;
  private magDragStartMouseX: number = 0;
  private magDragStartCutFrame: number = 0;

  // Floating Context Menu element
  private activeContextMenuEl: HTMLElement | null = null;

  constructor(context: AudioChopperContext) {
    this.context = context;
  }

  public open(pcm: Float32Array, sampleRate: number, sourceFilename: string = ''): void {
    if (this.backdropEl) return;
    this.pcm = pcm;
    this.sampleRate = Math.max(1, sampleRate);
    this.sourceFilename = sourceFilename;
    this.zoomFactor = 1.0;
    this.viewCenterNorm = 0.5;
    this.selectedSliceId = null;
    this.activeBoundaryIndex = 1;

    if (this.pcm.length > 0) {
      this.recomputeSlices();
    } else {
      this.currentResult = null;
    }

    this.render();
  }

  public close(): void {
    this.context.onStopAudition?.();
    this.closeContextMenu();
    if (this.backdropEl) {
      this.backdropEl.remove();
      this.backdropEl = null;
    }
    this.canvas = null;
    this.magnifierCanvas = null;
  }

  public async loadAudioFile(file: File): Promise<void> {
    try {
      const arrayBuf = await file.arrayBuffer();

      // Check if it's a slice marker or ReCycle file first (.rx2, .rex, .rcy, .sfz, .cue, .txt)
      const isSliceFileExt = /\.(rx2|rex|rcy|sfz|cue|txt)$/i.test(file.name);
      if (isSliceFileExt) {
        const parsed = parseSliceFile(arrayBuf, file.name, this.sampleRate);
        if (parsed && parsed.sliceFrames.length > 0) {
          if (parsed.pcm && parsed.pcm.length > 0) {
            this.pcm = parsed.pcm;
            this.sampleRate = parsed.sampleRate || 44100;
          }
          if (this.pcm.length > 0) {
            this.sourceFilename = file.name;
            this.currentResult = buildSlicesFromBoundaries(
              this.pcm,
              this.sampleRate,
              parsed.sliceFrames,
              this.options
            );
            this.selectedSliceId = this.currentResult.slices[0]?.id ?? null;
            this.activeBoundaryIndex = 1;
            this.render();
            toast(
              `Imported ${parsed.sliceFrames.length} slices from ${parsed.formatLabel} (${file.name})`,
              'success'
            );
            return;
          }
        }
      }

      // Standard Audio Decode
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const decoded = await audioCtx.decodeAudioData(arrayBuf.slice(0));
      this.pcm = decoded.getChannelData(0);
      this.sampleRate = decoded.sampleRate;
      this.sourceFilename = file.name;
      this.zoomFactor = 1.0;
      this.viewCenterNorm = 0.5;
      this.selectedSliceId = null;
      this.activeBoundaryIndex = 1;

      this.context.onRegisterSampleBuffer?.(file.name, arrayBuf);

      // Check if standard WAV / AIFF contains embedded slice cues
      const embedded = parseSliceFile(arrayBuf, file.name, this.sampleRate);
      if (embedded && embedded.sliceFrames.length > 1) {
        this.currentResult = buildSlicesFromBoundaries(
          this.pcm,
          this.sampleRate,
          embedded.sliceFrames,
          this.options
        );
        this.selectedSliceId = this.currentResult.slices[0]?.id ?? null;
        toast(
          `Loaded "${file.name}" with ${embedded.sliceFrames.length} embedded ${embedded.formatLabel} slices!`,
          'success'
        );
      } else {
        this.recomputeSlices();
        toast(
          `Loaded "${file.name}" into Audio Chopper (${(this.pcm.length / this.sampleRate).toFixed(2)}s, ${this.sampleRate} Hz)`,
          'success'
        );
      }

      this.render();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`Failed to decode audio file: ${msg}`, 'error');
    }
  }

  public async importSliceMarkersFile(file: File): Promise<void> {
    if (this.pcm.length === 0) {
      toast('Please load an audio file first before importing a slice marker track.', 'warning');
      return;
    }
    try {
      const arrayBuf = await file.arrayBuffer();
      const parsed = parseSliceFile(arrayBuf, file.name, this.sampleRate);
      if (!parsed || parsed.sliceFrames.length === 0) {
        toast(`Could not find valid slice markers in "${file.name}".`, 'error');
        return;
      }

      this.currentResult = buildSlicesFromBoundaries(
        this.pcm,
        this.sampleRate,
        parsed.sliceFrames,
        this.options
      );
      this.selectedSliceId = this.currentResult.slices[0]?.id ?? null;
      this.activeBoundaryIndex = 1;
      this.render();
      toast(
        `Applied ${parsed.sliceFrames.length} slices from ${parsed.formatLabel} (${file.name})!`,
        'success'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`Failed to parse slice file: ${msg}`, 'error');
    }
  }

  public loadTestDemoBeat(): void {
    const sr = 44100;
    const pcm = new Float32Array(sr * 2);
    for (let i = 0; i < pcm.length; i++) {
      const t = i / sr;
      if (t < 0.3) pcm[i] += Math.sin(2 * Math.PI * (120 - t * 250) * t) * Math.exp(-t * 15);
      if (t >= 0.5 && t < 0.8) {
        const st = t - 0.5;
        pcm[i] += (Math.random() * 2 - 1) * Math.exp(-st * 20) * 0.6;
      }
      const hatT = t % 0.5;
      if (hatT < 0.05) {
        pcm[i] += (Math.random() * 2 - 1) * Math.exp(-hatT * 60) * 0.25;
      }
    }
    this.pcm = pcm;
    this.sampleRate = sr;
    this.sourceFilename = 'DemoBreak.wav';
    this.zoomFactor = 1.0;
    this.viewCenterNorm = 0.5;
    this.selectedSliceId = null;
    this.activeBoundaryIndex = 1;
    this.recomputeSlices();
    this.render();
    toast('Loaded 2-second synthesized test beat for slicer auditioning.', 'info');
  }

  private recomputeSlices(): void {
    if (this.pcm.length === 0) {
      this.currentResult = null;
      return;
    }
    this.currentResult = sliceAudioBuffer(this.pcm, this.sampleRate, this.options);
    if (!this.selectedSliceId && this.currentResult.slices.length > 0) {
      const firstValid = this.currentResult.slices.find((s) => !s.isSilence);
      this.selectedSliceId = firstValid ? firstValid.id : this.currentResult.slices[0].id;
    }
    const boundaries = extractBoundaryFrames(this.currentResult, this.pcm.length);
    if (this.activeBoundaryIndex >= boundaries.length - 1) {
      this.activeBoundaryIndex = Math.max(1, boundaries.length - 2);
    }
  }

  private getActiveCutFrame(): number {
    if (!this.currentResult || this.pcm.length === 0) return 0;
    const boundaries = extractBoundaryFrames(this.currentResult, this.pcm.length);
    if (boundaries.length <= 2) return Math.floor(this.pcm.length / 2);
    const idx = clamp(this.activeBoundaryIndex, 1, boundaries.length - 2);
    return boundaries[idx] ?? 0;
  }

  private checkZeroCrossing(frame: number): boolean {
    if (this.pcm.length === 0 || frame < 0 || frame >= this.pcm.length) return false;
    const prev = frame > 0 ? this.pcm[frame - 1] : 0;
    const curr = this.pcm[frame];
    const next = frame < this.pcm.length - 1 ? this.pcm[frame + 1] : 0;
    return (
      (prev <= 0 && curr >= 0 && (prev < 0 || curr > 0)) ||
      (prev >= 0 && curr <= 0 && (prev > 0 || curr < 0)) ||
      (curr <= 0 && next >= 0 && (curr < 0 || next > 0)) ||
      (curr >= 0 && next <= 0 && (curr > 0 || next < 0)) ||
      Math.abs(curr) < 0.005
    );
  }

  private render(): void {
    if (!this.backdropEl) {
      this.backdropEl = document.createElement('div');
      this.backdropEl.className = 'nmm-modal-backdrop nmm-chopper-backdrop';
      document.body.appendChild(this.backdropEl);

      this.backdropEl.addEventListener('click', (e) => {
        if (e.target === this.backdropEl) this.close();
      });
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          if (this.activeContextMenuEl) {
            this.closeContextMenu();
          } else if (this.backdropEl) {
            this.close();
          }
        }
      });
    }

    const hasAudio = this.pcm.length > 0;
    const res = this.currentResult;
    const slices = res?.slices ?? [];
    const validCount = res?.validSlicesCount ?? 0;
    const totalCount = res?.totalSlices ?? 0;
    const isWorkingExtended = this.context.getCurrentWorkingMode() === 'extended';
    const activeCutFrame = this.getActiveCutFrame();
    const activeBoundaryIdx = this.activeBoundaryIndex;

    const cutSampleVal = this.pcm.length > 0 && activeCutFrame < this.pcm.length ? this.pcm[activeCutFrame] : 0;
    const isZeroCrossingGood = this.checkZeroCrossing(activeCutFrame);

    this.backdropEl.innerHTML = `
      <div class="nmm-modal-window nmm-chopper-window" role="dialog" aria-modal="true" aria-labelledby="chopper-title">
        <header class="nmm-modal-header">
          <div class="nmm-modal-header-title">
            <span class="nmm-modal-header-icon">${ICONS.scissors}</span>
            <h2 id="chopper-title">Audio Chopper &amp; Multi-Layer Auto-Slicer</h2>
            <span class="panel-badge ${hasAudio ? 'badge-ai-on' : 'badge-muted'}">
              ${hasAudio ? escHtml(this.sourceFilename) : 'No Sample Loaded'}
            </span>
          </div>
          <button type="button" class="nmm-modal-close" aria-label="Close" id="btn-chopper-close">${ICONS.close || '✕'}</button>
        </header>

        <div class="nmm-modal-body nmm-chopper-body">
          <input type="file" id="inp-chopper-audio-file" accept=".wav,.aif,.aiff,.flac,.rx2,.rex,.rcy,.sfz,.cue,.txt" style="display: none;" />
          <input type="file" id="inp-chopper-markers-file" accept=".rx2,.rex,.rcy,.sfz,.cue,.txt,.wav,.aif" style="display: none;" />

          ${
            !hasAudio
              ? `
            <!-- Unified Empty State / Dropzone -->
            <div class="audio-empty-dropzone" id="chopper-empty-dropzone">
              <div class="dropzone-icon-ring">
                <span class="dropzone-icon">${ICONS.scissors}</span>
              </div>
              <h3 class="dropzone-title">NO AUDIO FILE LOADED IN AUTO-SLICER</h3>
              <p class="dropzone-subtitle">
                Drag &amp; drop a drum loop, vocal track, rhythmic phrase, or ReCycle slice file (.wav, .aif, .flac, .rx2, .rex, .sfz) to auto-detect or import slices.
              </p>
              <div class="dropzone-actions">
                <button type="button" class="btn btn-primary" id="btn-chopper-browse-file">
                  ${ICONS.folder} Browse Audio or Slice File...
                </button>
                <button type="button" class="btn btn-outline" id="btn-chopper-demo-beat" title="Load a 2-second synthesized test beat to test slicing without a sample">
                  ${ICONS.drum} Load Test Beat (Demo)
                </button>
              </div>
              <div class="dropzone-hint">
                AutoSlicer detects transients via Spectral Flux, supports ReCycle (.rx2/.rex) tables, snaps boundaries to zero-crossings, and maps slices to GM Drum notes or chromatic keyboard zones.
              </div>
            </div>
          `
              : `
            <!-- Waveform Canvas Viewport -->
            <div class="chopper-waveform-panel">
              <div class="chopper-waveform-toolbar">
                <div class="chopper-zoom-controls">
                  <span class="toolbar-label">ZOOM:</span>
                  <button type="button" class="btn btn-xs btn-outline" id="btn-chopper-zoom-out" title="Zoom Out Waveform">-</button>
                  <span class="val-pill" id="lbl-chopper-zoom">${this.zoomFactor.toFixed(1)}x</span>
                  <button type="button" class="btn btn-xs btn-outline" id="btn-chopper-zoom-in" title="Zoom In Waveform">+</button>
                  <button type="button" class="btn btn-xs btn-outline" id="btn-chopper-zoom-fit" title="Fit Entire Audio File to Viewport">Fit</button>
                </div>
                <div class="chopper-toolbar-right">
                  <div class="chopper-waveform-stats">
                    <span>${(this.pcm.length / this.sampleRate).toFixed(2)}s (${this.pcm.length.toLocaleString()} frames)</span>
                    <span class="val-pill">${validCount} Active Slices</span>
                  </div>
                  <button type="button" class="btn btn-xs btn-outline" id="btn-chopper-import-cues" title="Import ReCycle (.rx2, .rex, .rcy), SFZ, or CUE text slice marker file">
                    ${ICONS.database} Import ReCycle / Cues...
                  </button>
                  <button type="button" class="btn btn-xs btn-outline" id="btn-chopper-change-file" title="Open another audio file">
                    ${ICONS.folder} Open File...
                  </button>
                </div>
              </div>

              <div class="chopper-canvas-wrap" id="chopper-canvas-wrap" style="position: relative;">
                <canvas id="chopper-waveform-canvas" height="150"></canvas>
              </div>
              <div class="chopper-canvas-hint">
                <span>Left-drag markers to move</span> • <span>Right-click line/slice for Actions</span> • <span>Double-click or Right-click to Add Cut</span>
              </div>
            </div>

            <!-- Cut-Point Magnifier & Sample Nudge Panel (AutoLoop Seam Style) -->
            <div class="chopper-magnifier-panel">
              <div class="chopper-magnifier-toolbar">
                <div class="chopper-magnifier-title-box">
                  <span style="color: var(--color-accent);">${ICONS.wave}</span>
                  <span>CUT POINT MAGNIFIER (±256 smp):</span>
                  <button type="button" class="btn btn-xs btn-outline" id="btn-mag-prev-cut" title="Previous cut boundary">&lt; Prev Cut</button>
                  <strong>Boundary #${activeBoundaryIdx}</strong>
                  <button type="button" class="btn btn-xs btn-outline" id="btn-mag-next-cut" title="Next cut boundary">Next Cut &gt;</button>
                  <span class="val-pill font-mono">${activeCutFrame.toLocaleString()} smp (${((activeCutFrame / this.sampleRate) * 1000).toFixed(1)} ms)</span>
                  <span class="${isZeroCrossingGood ? 'pill-zc-good' : 'pill-zc-warn'}">
                    ${isZeroCrossingGood ? '0-X MATCH' : `0-X OFFSET (${(cutSampleVal * 100).toFixed(1)}%)`}
                  </span>
                </div>

                <div class="chopper-magnifier-nudge-group">
                  <span style="font-size: 11px; color: var(--color-text-dim); margin-right: 4px;">NUDGE:</span>
                  <button type="button" class="btn btn-xs btn-outline" id="btn-nudge-m100" title="Nudge boundary -100 samples">&lt;&lt; -100</button>
                  <button type="button" class="btn btn-xs btn-outline" id="btn-nudge-m10" title="Nudge boundary -10 samples">&lt; -10</button>
                  <button type="button" class="btn btn-xs btn-outline" id="btn-nudge-m1" title="Nudge boundary -1 sample">-1</button>
                  <button type="button" class="btn btn-xs btn-accent" id="btn-nudge-snap0x" title="Snap boundary to nearest zero-crossing">Snap 0-X</button>
                  <button type="button" class="btn btn-xs btn-outline" id="btn-nudge-p1" title="Nudge boundary +1 sample">+1</button>
                  <button type="button" class="btn btn-xs btn-outline" id="btn-nudge-p10" title="Nudge boundary +10 samples">+10 &gt;</button>
                  <button type="button" class="btn btn-xs btn-outline" id="btn-nudge-p100" title="Nudge boundary +100 samples">+100 &gt;&gt;</button>
                  <button type="button" class="btn btn-xs btn-outline" id="btn-mag-play-slice" title="Audition selected slice">
                    ${ICONS.play} Play
                  </button>
                  <button type="button" class="btn btn-xs btn-outline" id="btn-mag-toggle-silence" title="Toggle silence for current slice">
                    ${ICONS.eyeOff || 'Mute'} Silence
                  </button>
                  <button type="button" class="btn btn-xs btn-outline" id="btn-mag-del-boundary" title="Delete this cut boundary" style="color: #ef4444;">
                    ${ICONS.trash} Del Cut
                  </button>
                </div>
              </div>

              <div class="chopper-magnifier-canvas-wrap" id="chopper-mag-canvas-wrap" style="position: relative; cursor: ew-resize;">
                <canvas id="chopper-magnifier-canvas" height="84"></canvas>
              </div>
            </div>

            <!-- Real-Time Parameters Card -->
            <div class="chopper-params-card">
              <div class="chopper-params-row">
                <!-- Slicing Mode -->
                <div class="chopper-param-group" style="min-width: 290px;">
                  <div class="chopper-param-header">
                    <span>SLICING MODE</span>
                  </div>
                  <div class="btn-group" style="display: flex; gap: 4px;">
                    <button type="button" class="btn btn-xs ${this.options.mode === 'drums' ? 'btn-accent is-active' : 'btn-outline'}" id="btn-mode-drums" title="Classify into General MIDI Drum Map notes">
                      ${ICONS.drum} Drums (GM)
                    </button>
                    <button type="button" class="btn btn-xs ${this.options.mode === 'vocals' ? 'btn-accent is-active' : 'btn-outline'}" id="btn-mode-vocals" title="Vocal & phrase segmentation (OpenVPI silence valley segmentation, avoids micro-chatter)">
                      ${ICONS.wave} Vocals / Phrase
                    </button>
                    <button type="button" class="btn btn-xs ${this.options.mode === 'chromatic' ? 'btn-accent is-active' : 'btn-outline'}" id="btn-mode-chromatic" title="Detect F0 pitch and map to contiguous equidistant key zones">
                      ${ICONS.piano} Chromatic
                    </button>
                    <button type="button" class="btn btn-xs ${this.options.mode === 'grid' ? 'btn-accent is-active' : 'btn-outline'}" id="btn-mode-grid" title="Chop by musical grid tempo division">
                      Grid BPM
                    </button>
                  </div>
                </div>

                <!-- Transient Sensitivity Slider -->
                <div class="chopper-param-group flex-1">
                  <div class="chopper-param-header">
                    <span>TRANSIENT SENSITIVITY</span>
                    <span class="chopper-param-val" id="lbl-sens-val">${this.options.sensitivity}%</span>
                  </div>
                  <input type="range" class="form-control" id="rng-sens" min="5" max="98" value="${this.options.sensitivity}" />
                </div>

                <!-- Silence Gate Threshold -->
                <div class="chopper-param-group flex-1">
                  <div class="chopper-param-header">
                    <span>SILENCE GATE</span>
                    <span class="chopper-param-val" id="lbl-silence-val">${this.options.silenceThresholdDb} dB</span>
                  </div>
                  <input type="range" class="form-control" id="rng-silence" min="-60" max="-18" value="${this.options.silenceThresholdDb}" />
                </div>

                <!-- Min Slice Ms Input -->
                <div class="chopper-param-group" style="width: 100px;">
                  <div class="chopper-param-header">
                    <span>MIN SLICE</span>
                  </div>
                  <input type="number" id="inp-minslice" class="form-control font-mono" min="20" max="1000" step="10" value="${this.options.minSliceMs ?? (this.options.mode === 'vocals' ? 250 : 45)}" title="Minimum slice duration in milliseconds" />
                </div>

                <!-- Pre-Roll Safety Margin -->
                <div class="chopper-param-group" style="width: 90px;">
                  <div class="chopper-param-header">
                    <span>PRE-ROLL</span>
                  </div>
                  <input type="number" id="inp-preroll" class="form-control font-mono" min="0" max="25" value="${this.options.preRollMs}" title="Pre-roll safety margin in milliseconds" />
                </div>

                <!-- Snap & Overlap Toggles -->
                <div class="chopper-toggles-col">
                  <button type="button" class="btn btn-xs ${this.options.snapZeroCrossing ? 'btn-accent is-active' : 'btn-outline'}" id="btn-toggle-zc-snap" title="Magnetize slice boundaries to the nearest zero-crossing">
                    0-X Snap: ${this.options.snapZeroCrossing ? 'ON' : 'OFF'}
                  </button>
                  <button type="button" class="btn btn-xs ${this.options.allowOverlap ? 'btn-accent is-active' : 'btn-outline'}" id="btn-toggle-overlap" title="Allow overlapping key & velocity zones">
                    Overlaps: ${this.options.allowOverlap ? 'ALLOW' : 'DISJOINT'}
                  </button>
                </div>
              </div>
            </div>

            <!-- Slices Table Inspector -->
            <div class="chopper-table-panel">
              <div class="chopper-table-header-row">
                <span class="chopper-table-title">
                  Detected Slices (${validCount} valid / ${totalCount} total)
                </span>
                <span style="font-size: 11px; color: var(--color-text-dim);">
                  Target: <strong>${isWorkingExtended ? 'Extended 2D Regions' : 'Classic 128-Zone Hartmann'}</strong>
                </span>
              </div>

              <div class="chopper-table-scroll">
                <table class="canonical-zone-table chopper-slices-table">
                  <thead>
                    <tr>
                      <th style="width: 45px;">#ID</th>
                      <th style="width: 110px;">Time Range</th>
                      <th style="width: 80px;">Duration</th>
                      <th style="width: 160px;">Classification</th>
                      <th style="width: 90px;">Root Key</th>
                      <th style="width: 110px;">Key Range</th>
                      <th style="width: 90px;">Velocity</th>
                      <th style="width: 80px;">Peak / RMS</th>
                      <th style="width: 110px; text-align: center;">Actions</th>
                    </tr>
                  </thead>
                  <tbody id="chopper-tbody">
                    ${this.renderTableRows(slices)}
                  </tbody>
                </table>
              </div>
            </div>
          `
          }
        </div>

        <!-- Footer Actions Bar -->
        <footer class="nmm-modal-footer chopper-footer-actions">
          <button type="button" class="btn btn-outline" id="btn-chopper-discard">Discard &amp; Close</button>

          ${
            hasAudio
              ? `
            <div style="display: flex; gap: 8px; align-items: center;">
              <!-- Draggable MIDI Pattern Button -->
              <button type="button" class="btn btn-accent btn-drag-midi" id="btn-drag-midi" draggable="true" title="Drag MIDI Pattern directly to DAW track or click to download .mid file">
                ${ICONS.piano} Drag MIDI to DAW (.mid)
              </button>

              <!-- Inject as Zones Button -->
              <button type="button" class="btn btn-primary" id="btn-chopper-inject" ${validCount === 0 ? 'disabled' : ''}>
                ${ICONS.scissors} Inject as Zones into Session (${validCount} Zones)
              </button>
            </div>
          `
              : ''
          }
        </footer>
      </div>
    `;

    this.bindEvents();
    if (hasAudio) {
      this.drawWaveformCanvas();
      this.drawMagnifierCanvas();
    }
  }

  private renderTableRows(slices: DetectedSlice[]): string {
    if (slices.length === 0) {
      return `<tr><td colspan="9" style="text-align: center; padding: 20px; color: var(--color-text-dim);">No slices detected. Adjust sensitivity slider above.</td></tr>`;
    }
    return slices
      .map((sl) => {
        const isSel = sl.id === this.selectedSliceId;
        const isPlaying = sl.id === this.playingSliceId;
        const isSilence = sl.isSilence;

        return `
          <tr class="zone-table-row ${isSel ? 'is-selected' : ''} ${isSilence ? 'is-silence-row' : ''}" data-slice-id="${sl.id}">
            <td>${sl.index}</td>
            <td>${sl.startSec.toFixed(2)}s..${sl.endSec.toFixed(2)}s</td>
            <td>${(sl.durationSec * 1000).toFixed(0)} ms</td>
            <td>
              ${isSilence ? `<span class="val-pill" style="opacity: 0.6;">Silence</span>` : `<span style="font-weight: 600; color: var(--color-accent);">${escHtml(sl.label)}</span>`}
            </td>
            <td>${isSilence ? '—' : `${sl.rootKey} (${midiToNoteName(sl.rootKey)})`}</td>
            <td>${isSilence ? '—' : `${sl.lowKey}..${sl.highKey}`}</td>
            <td>${isSilence ? '—' : `${sl.lowVel}..${sl.highVel}`}</td>
            <td>${sl.peakDb}dB / ${sl.rmsDb}dB</td>
            <td style="text-align: center; white-space: nowrap;">
              <button type="button" class="btn btn-xs btn-ghost btn-play-slice" data-slice-id="${sl.id}" title="Audition slice one-shot">
                ${isPlaying ? ICONS.stop : ICONS.play}
              </button>
              <button type="button" class="btn btn-xs ${isSilence ? 'btn-outline' : 'btn-ghost'} btn-toggle-silence-row" data-slice-id="${sl.id}" title="${isSilence ? 'Unmute (Mark as active)' : 'Mute (Mark as silence)'}">
                ${isSilence ? 'Unmute' : 'Mute'}
              </button>
              <button type="button" class="btn btn-xs btn-ghost btn-danger-hover btn-delete-slice" data-slice-id="${sl.id}" title="Remove slice marker">
                ${ICONS.trash}
              </button>
            </td>
          </tr>
        `;
      })
      .join('');
  }

  private getThemeColors(): {
    bg: string;
    waveform: string;
    waveformGradientEnd: string;
    sliceSel: string;
    sliceEven: string;
    sliceOdd: string;
    silence: string;
    marker: string;
    markerHover: string;
    centerLine: string;
    text: string;
  } {
    const style = typeof window !== 'undefined' ? window.getComputedStyle(document.body) : null;
    const accent = style?.getPropertyValue('--color-accent').trim() || '#38bdf8';
    const isDark =
      !document.body.classList.contains('theme-light') &&
      !document.documentElement.classList.contains('theme-light');

    return {
      bg: isDark ? '#060a12' : '#f1f5f9',
      waveform: accent,
      waveformGradientEnd: isDark ? '#0284c7' : '#0369a1',
      sliceSel: isDark ? 'rgba(56, 189, 248, 0.28)' : 'rgba(14, 165, 233, 0.25)',
      sliceEven: isDark ? 'rgba(56, 189, 248, 0.08)' : 'rgba(14, 165, 233, 0.08)',
      sliceOdd: isDark ? 'rgba(168, 85, 247, 0.08)' : 'rgba(139, 92, 246, 0.08)',
      silence: isDark ? 'rgba(15, 23, 42, 0.85)' : 'rgba(148, 163, 184, 0.45)',
      marker: accent,
      markerHover: '#f59e0b',
      centerLine: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.12)',
      text: isDark ? '#f8fafc' : '#0f172a',
    };
  }

  private drawWaveformCanvas(): void {
    if (!this.backdropEl) return;
    this.canvas = this.backdropEl.querySelector('#chopper-waveform-canvas') as HTMLCanvasElement | null;
    if (!this.canvas) return;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;

    const wrap = this.backdropEl.querySelector('#chopper-canvas-wrap') as HTMLElement | null;
    const width = Math.max(300, Math.floor(wrap?.clientWidth || 880));
    const height = 150;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

    if (this.canvas.width !== Math.floor(width * dpr) || this.canvas.height !== Math.floor(height * dpr)) {
      this.canvas.width = Math.floor(width * dpr);
      this.canvas.height = Math.floor(height * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    const colors = this.getThemeColors();
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, width, height);

    const totalFrames = this.pcm.length;
    if (totalFrames === 0) {
      ctx.restore();
      return;
    }

    const zoom = clamp(this.zoomFactor, 1, 16);
    const windowFrames = Math.max(64, Math.round(totalFrames / zoom));
    const centerFrame = clamp(Math.round(this.viewCenterNorm * totalFrames), 0, totalFrames);
    const viewStart = clamp(centerFrame - Math.floor(windowFrames * 0.5), 0, Math.max(0, totalFrames - windowFrames));
    const viewEnd = clamp(viewStart + windowFrames, viewStart + 1, totalFrames);
    const viewSpan = Math.max(1, viewEnd - viewStart);

    const frameToX = (frame: number) => ((frame - viewStart) / viewSpan) * width;

    // Draw Slices Background Shading & Non-Overlapping Labels
    const slices = this.currentResult?.slices ?? [];
    slices.forEach((sl, idx) => {
      const x1 = frameToX(sl.startFrame);
      const x2 = frameToX(sl.endFrame);
      if (x2 < 0 || x1 > width) return;

      const w = Math.max(1, x2 - x1);
      if (sl.isSilence) {
        ctx.fillStyle = colors.silence;
        ctx.fillRect(x1, 0, w, height);
      } else {
        const isSel = sl.id === this.selectedSliceId;
        const isEven = idx % 2 === 0;
        ctx.fillStyle = isSel ? colors.sliceSel : isEven ? colors.sliceEven : colors.sliceOdd;
        ctx.fillRect(x1, 0, w, height);

        if (isSel) {
          const labelText = `#${sl.index} ${sl.label}`;
          ctx.font = 'bold 10px monospace';
          const textW = ctx.measureText(labelText).width;
          const badgeW = Math.min(Math.max(textW + 10, 48), Math.max(w, 48));

          ctx.fillStyle = colors.marker;
          ctx.fillRect(x1, 2, badgeW, 14);

          ctx.fillStyle = '#060a12';
          ctx.fillText(labelText, x1 + 5, 13);
        } else if (w >= 44) {
          ctx.fillStyle = colors.text;
          ctx.font = '10px monospace';
          const maxChars = Math.max(2, Math.floor((w - 8) / 7));
          const labelText = `#${sl.index} ${sl.label.slice(0, maxChars)}`;
          ctx.fillText(labelText, x1 + 4, 14);
        }
      }
    });

    // Center Reference Line
    const centerY = height * 0.5;
    ctx.strokeStyle = colors.centerLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(width, centerY);
    ctx.stroke();

    // Waveform Envelope
    const numPoints = Math.min(width, 600);
    const env = computeZoomedWaveformEnvelope(this.pcm, viewStart, viewEnd, numPoints);
    const ampScale = height * 0.44;

    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, colors.waveform);
    grad.addColorStop(1, colors.waveformGradientEnd);

    ctx.fillStyle = grad;
    const stepX = width / numPoints;
    for (let i = 0; i < numPoints; i++) {
      const x = i * stepX;
      const topY = centerY - (env.max[i] ?? 0) * ampScale;
      const botY = centerY - (env.min[i] ?? 0) * ampScale;
      const barH = Math.max(1, botY - topY);
      ctx.fillRect(x, topY, Math.max(1, stepX - 0.5), barH);
    }

    // Draw Draggable Boundary Lines with Handles
    const boundaries = extractBoundaryFrames(this.currentResult || { slices: [] } as any, totalFrames);
    for (let bIdx = 1; bIdx < boundaries.length - 1; bIdx++) {
      const bFrame = boundaries[bIdx];
      const bx = frameToX(bFrame);
      if (bx < -5 || bx > width + 5) continue;

      const isHovered = bIdx === this.hoveredBoundaryIndex || bIdx === this.draggedBoundaryIndex;
      const isActive = bIdx === this.activeBoundaryIndex;

      ctx.strokeStyle = isHovered ? colors.markerHover : isActive ? '#10b981' : colors.marker;
      ctx.lineWidth = isHovered || isActive ? 2.5 : 1.5;

      ctx.beginPath();
      ctx.moveTo(bx, 0);
      ctx.lineTo(bx, height);
      ctx.stroke();

      // Top drag handle triangle
      ctx.fillStyle = isHovered ? colors.markerHover : isActive ? '#10b981' : colors.marker;
      ctx.beginPath();
      ctx.moveTo(bx - 5, 0);
      ctx.lineTo(bx + 5, 0);
      ctx.lineTo(bx, 8);
      ctx.closePath();
      ctx.fill();

      // Bottom drag handle triangle
      ctx.beginPath();
      ctx.moveTo(bx - 5, height);
      ctx.lineTo(bx + 5, height);
      ctx.lineTo(bx, height - 8);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  private drawMagnifierCanvas(): void {
    if (!this.backdropEl) return;
    this.magnifierCanvas = this.backdropEl.querySelector('#chopper-magnifier-canvas') as HTMLCanvasElement | null;
    if (!this.magnifierCanvas) return;
    const ctx = this.magnifierCanvas.getContext('2d');
    if (!ctx) return;

    const wrap = this.backdropEl.querySelector('#chopper-mag-canvas-wrap') as HTMLElement | null;
    const width = Math.max(200, Math.floor(wrap?.clientWidth || 880));
    const height = 84;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

    if (this.magnifierCanvas.width !== Math.floor(width * dpr) || this.magnifierCanvas.height !== Math.floor(height * dpr)) {
      this.magnifierCanvas.width = Math.floor(width * dpr);
      this.magnifierCanvas.height = Math.floor(height * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    const colors = this.getThemeColors();
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, width, height);

    if (this.pcm.length === 0) {
      ctx.restore();
      return;
    }

    const cutFrame = this.getActiveCutFrame();
    const halfWindow = 256;
    const startFrame = cutFrame - halfWindow;
    const endFrame = cutFrame + halfWindow;
    const centerY = height * 0.5;

    // Center zero reference line
    ctx.strokeStyle = colors.centerLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(width, centerY);
    ctx.stroke();

    // Waveform line for ±256 sample window
    const ampScale = height * 0.42;
    ctx.strokeStyle = colors.waveform;
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    const totalSamples = endFrame - startFrame;
    for (let i = 0; i < totalSamples; i++) {
      const frame = startFrame + i;
      const x = (i / totalSamples) * width;
      const val = frame >= 0 && frame < this.pcm.length ? this.pcm[frame] : 0;
      const y = centerY - val * ampScale;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // Individual sample points
    ctx.fillStyle = colors.waveform;
    for (let i = 0; i < totalSamples; i += 4) {
      const frame = startFrame + i;
      const x = (i / totalSamples) * width;
      const val = frame >= 0 && frame < this.pcm.length ? this.pcm[frame] : 0;
      const y = centerY - val * ampScale;
      ctx.fillRect(x - 1, y - 1, 2, 2);
    }

    // Center Cut Line (green or highlighted orange if dragging)
    const centerX = width * 0.5;
    const isDragging = this.isDraggingMagnifier;
    ctx.strokeStyle = isDragging ? '#f59e0b' : '#10b981';
    ctx.lineWidth = isDragging ? 3 : 2;
    ctx.setLineDash(isDragging ? [] : [4, 2]);
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, height);
    ctx.stroke();
    ctx.setLineDash([]);

    // Cut point highlight dot
    const centerVal = cutFrame >= 0 && cutFrame < this.pcm.length ? this.pcm[cutFrame] : 0;
    const centerDotY = centerY - centerVal * ampScale;
    ctx.fillStyle = isDragging ? '#f59e0b' : '#10b981';
    ctx.beginPath();
    ctx.arc(centerX, centerDotY, isDragging ? 5 : 4, 0, Math.PI * 2);
    ctx.fill();

    // Handle Triangles
    ctx.fillStyle = isDragging ? '#f59e0b' : '#10b981';
    ctx.beginPath();
    ctx.moveTo(centerX - 6, 0);
    ctx.lineTo(centerX + 6, 0);
    ctx.lineTo(centerX, 9);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(centerX - 6, height);
    ctx.lineTo(centerX + 6, height);
    ctx.lineTo(centerX, height - 9);
    ctx.closePath();
    ctx.fill();

    // Visual drag hint
    ctx.font = '10px monospace';
    ctx.fillStyle = isDragging ? '#f59e0b' : 'rgba(16, 185, 129, 0.8)';
    const hintText = isDragging ? 'DRAGGING CUT POINT (MICRO-ADJUST)' : 'CLICK & DRAG TO MICRO-ADJUST CUT (±256 smp)';
    ctx.fillText(hintText, 10, 14);

    ctx.restore();
  }

  private navigateBoundary(delta: number): void {
    if (!this.currentResult || this.pcm.length === 0) return;
    const boundaries = extractBoundaryFrames(this.currentResult, this.pcm.length);
    if (boundaries.length <= 2) return;

    const maxIdx = boundaries.length - 2;
    this.activeBoundaryIndex = clamp(this.activeBoundaryIndex + delta, 1, maxIdx);

    // Select the slice starting at this boundary
    const cutFrame = boundaries[this.activeBoundaryIndex];
    const hit = this.currentResult.slices.find((s) => Math.abs(s.startFrame - cutFrame) < 32);
    if (hit) {
      this.selectedSliceId = hit.id;
    }

    this.drawWaveformCanvas();
    this.drawMagnifierCanvas();
    this.updateMagnifierHeader();
    this.refreshTable();
  }

  private nudgeActiveBoundary(deltaSamples: number): void {
    if (!this.currentResult || this.pcm.length === 0) return;
    const boundaries = extractBoundaryFrames(this.currentResult, this.pcm.length);
    if (boundaries.length <= 2) return;

    const bIdx = clamp(this.activeBoundaryIndex, 1, boundaries.length - 2);
    const currentF = boundaries[bIdx];
    const newF = currentF + deltaSamples;

    this.currentResult = moveSliceBoundary(
      this.currentResult,
      this.pcm,
      this.sampleRate,
      bIdx,
      newF,
      false,
      this.options
    );

    this.drawWaveformCanvas();
    this.drawMagnifierCanvas();
    this.refreshTable();
    this.updateMagnifierHeader();
  }

  private snapActiveBoundary0X(): void {
    if (!this.currentResult || this.pcm.length === 0) return;
    const boundaries = extractBoundaryFrames(this.currentResult, this.pcm.length);
    if (boundaries.length <= 2) return;

    const bIdx = clamp(this.activeBoundaryIndex, 1, boundaries.length - 2);
    const currentF = boundaries[bIdx];
    const snapped = snapFrameToNearestZeroCrossing(this.pcm, currentF, 256);

    this.currentResult = moveSliceBoundary(
      this.currentResult,
      this.pcm,
      this.sampleRate,
      bIdx,
      snapped,
      false,
      this.options
    );

    this.drawWaveformCanvas();
    this.drawMagnifierCanvas();
    this.refreshTable();
    this.updateMagnifierHeader();
    const delta = snapped - currentF;
    toast(`Boundary #${bIdx} snapped to zero-crossing (${delta >= 0 ? '+' : ''}${delta} smp).`, 'info');
  }

  private updateMagnifierHeader(): void {
    if (!this.backdropEl) return;
    const activeCutFrame = this.getActiveCutFrame();
    const cutSampleVal = this.pcm.length > 0 && activeCutFrame < this.pcm.length ? this.pcm[activeCutFrame] : 0;
    const isZeroCrossingGood = this.checkZeroCrossing(activeCutFrame);

    const titleBox = this.backdropEl.querySelector('.chopper-magnifier-title-box');
    if (titleBox) {
      titleBox.innerHTML = `
        <span style="color: var(--color-accent);">${ICONS.wave}</span>
        <span>CUT POINT MAGNIFIER (±256 smp):</span>
        <button type="button" class="btn btn-xs btn-outline" id="btn-mag-prev-cut" title="Previous slice boundary">&lt; Prev Cut</button>
        <strong>Boundary #${this.activeBoundaryIndex}</strong>
        <button type="button" class="btn btn-xs btn-outline" id="btn-mag-next-cut" title="Next slice boundary">Next Cut &gt;</button>
        <span class="val-pill font-mono">${activeCutFrame.toLocaleString()} smp (${((activeCutFrame / this.sampleRate) * 1000).toFixed(1)} ms)</span>
        <span class="${isZeroCrossingGood ? 'pill-zc-good' : 'pill-zc-warn'}">
          ${isZeroCrossingGood ? '0-X MATCH' : `0-X OFFSET (${(cutSampleVal * 100).toFixed(1)}%)`}
        </span>
      `;

      this.backdropEl.querySelector('#btn-mag-prev-cut')?.addEventListener('click', () => this.navigateBoundary(-1));
      this.backdropEl.querySelector('#btn-mag-next-cut')?.addEventListener('click', () => this.navigateBoundary(1));
    }
  }

  private refreshTable(): void {
    if (!this.backdropEl) return;
    const tbody = this.backdropEl.querySelector('#chopper-tbody');
    if (tbody && this.currentResult) {
      tbody.innerHTML = this.renderTableRows(this.currentResult.slices);
      this.bindTableEvents();
    }
  }

  private closeContextMenu(): void {
    if (this.activeContextMenuEl) {
      this.activeContextMenuEl.remove();
      this.activeContextMenuEl = null;
    }
  }

  private showContextMenu(x: number, y: number, items: ContextMenuItem[]): void {
    this.closeContextMenu();

    const menu = document.createElement('div');
    menu.className = 'chopper-context-menu';
    menu.style.left = `${Math.min(window.innerWidth - 210, Math.max(10, x))}px`;
    menu.style.top = `${Math.min(window.innerHeight - 250, Math.max(10, y))}px`;

    items.forEach((it) => {
      if (it.isHeader) {
        const header = document.createElement('div');
        header.className = 'chopper-menu-header';
        header.textContent = it.label;
        menu.appendChild(header);
      } else if (it.isDivider) {
        const div = document.createElement('div');
        div.className = 'chopper-menu-divider';
        menu.appendChild(div);
      } else {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `chopper-menu-item ${it.isDanger ? 'danger-item' : ''}`;
        btn.innerHTML = `${it.icon || ''} <span>${escHtml(it.label)}</span>`;
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this.closeContextMenu();
          it.onClick?.();
        });
        menu.appendChild(btn);
      }
    });

    document.body.appendChild(menu);
    this.activeContextMenuEl = menu;

    const onOutsideClick = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) {
        this.closeContextMenu();
        window.removeEventListener('click', onOutsideClick);
      }
    };
    setTimeout(() => {
      window.addEventListener('click', onOutsideClick);
    }, 10);
  }

  private bindEvents(): void {
    if (!this.backdropEl) return;

    this.backdropEl.querySelector('#btn-chopper-close')?.addEventListener('click', () => this.close());
    this.backdropEl.querySelector('#btn-chopper-discard')?.addEventListener('click', () => this.close());

    // File inputs setup
    const fileInp = this.backdropEl.querySelector('#inp-chopper-audio-file') as HTMLInputElement | null;
    fileInp?.addEventListener('change', () => {
      const file = fileInp.files?.[0];
      if (file) void this.loadAudioFile(file);
    });

    const markerInp = this.backdropEl.querySelector('#inp-chopper-markers-file') as HTMLInputElement | null;
    markerInp?.addEventListener('change', () => {
      const file = markerInp.files?.[0];
      if (file) void this.importSliceMarkersFile(file);
    });

    this.backdropEl.querySelector('#btn-chopper-browse-file')?.addEventListener('click', () => fileInp?.click());
    this.backdropEl.querySelector('#btn-chopper-change-file')?.addEventListener('click', () => fileInp?.click());
    this.backdropEl.querySelector('#btn-chopper-import-cues')?.addEventListener('click', () => markerInp?.click());

    this.backdropEl.querySelector('#btn-chopper-demo-beat')?.addEventListener('click', () => {
      this.loadTestDemoBeat();
    });

    // Dropzone drag & drop
    const dropzone = this.backdropEl.querySelector('#chopper-empty-dropzone');
    if (dropzone) {
      dropzone.addEventListener('dragover', (e: Event) => {
        e.preventDefault();
        dropzone.classList.add('is-dragover');
      });
      dropzone.addEventListener('dragleave', (e: Event) => {
        e.preventDefault();
        dropzone.classList.remove('is-dragover');
      });
      dropzone.addEventListener('drop', (e: Event) => {
        e.preventDefault();
        dropzone.classList.remove('is-dragover');
        const dt = (e as DragEvent).dataTransfer;
        const file = dt?.files?.[0];
        if (file) void this.loadAudioFile(file);
      });
    }

    // Zoom Controls
    this.backdropEl.querySelector('#btn-chopper-zoom-in')?.addEventListener('click', () => {
      this.zoomFactor = Math.min(16, this.zoomFactor * 1.5);
      this.render();
    });
    this.backdropEl.querySelector('#btn-chopper-zoom-out')?.addEventListener('click', () => {
      this.zoomFactor = Math.max(1.0, this.zoomFactor / 1.5);
      this.render();
    });
    this.backdropEl.querySelector('#btn-chopper-zoom-fit')?.addEventListener('click', () => {
      this.zoomFactor = 1.0;
      this.viewCenterNorm = 0.5;
      this.render();
    });

    // Mode Buttons
    this.backdropEl.querySelector('#btn-mode-drums')?.addEventListener('click', () => {
      this.options.mode = 'drums';
      this.options.minSliceMs = 45;
      this.recomputeSlices();
      this.render();
    });
    this.backdropEl.querySelector('#btn-mode-vocals')?.addEventListener('click', () => {
      this.options.mode = 'vocals';
      this.options.minSliceMs = 250;
      this.recomputeSlices();
      this.render();
    });
    this.backdropEl.querySelector('#btn-mode-chromatic')?.addEventListener('click', () => {
      this.options.mode = 'chromatic';
      this.recomputeSlices();
      this.render();
    });
    this.backdropEl.querySelector('#btn-mode-grid')?.addEventListener('click', () => {
      this.options.mode = 'grid';
      this.recomputeSlices();
      this.render();
    });

    // Sensitivity Slider
    const rngSens = this.backdropEl.querySelector('#rng-sens') as HTMLInputElement | null;
    rngSens?.addEventListener('input', () => {
      this.options.sensitivity = parseInt(rngSens.value, 10);
      const lbl = this.backdropEl?.querySelector('#lbl-sens-val');
      if (lbl) lbl.textContent = `${this.options.sensitivity}%`;
      this.recomputeSlices();
      this.render();
    });

    // Silence Gate Slider
    const rngSilence = this.backdropEl.querySelector('#rng-silence') as HTMLInputElement | null;
    rngSilence?.addEventListener('input', () => {
      this.options.silenceThresholdDb = parseInt(rngSilence.value, 10);
      const lbl = this.backdropEl?.querySelector('#lbl-silence-val');
      if (lbl) lbl.textContent = `${this.options.silenceThresholdDb} dB`;
      this.recomputeSlices();
      this.render();
    });

    // Min Slice Ms Input
    const inpMinSlice = this.backdropEl.querySelector('#inp-minslice') as HTMLInputElement | null;
    inpMinSlice?.addEventListener('change', () => {
      this.options.minSliceMs = Math.max(10, parseInt(inpMinSlice.value, 10) || 45);
      this.recomputeSlices();
      this.render();
    });

    // Pre-roll Input
    const inpPreroll = this.backdropEl.querySelector('#inp-preroll') as HTMLInputElement | null;
    inpPreroll?.addEventListener('change', () => {
      this.options.preRollMs = Math.max(0, parseInt(inpPreroll.value, 10) || 0);
      this.recomputeSlices();
      this.render();
    });

    // Toggles
    this.backdropEl.querySelector('#btn-toggle-zc-snap')?.addEventListener('click', () => {
      this.options.snapZeroCrossing = !this.options.snapZeroCrossing;
      this.recomputeSlices();
      this.render();
    });
    this.backdropEl.querySelector('#btn-toggle-overlap')?.addEventListener('click', () => {
      this.options.allowOverlap = !this.options.allowOverlap;
      this.recomputeSlices();
      this.render();
    });

    // Cut-Point Magnifier Toolbar Buttons
    this.backdropEl.querySelector('#btn-mag-prev-cut')?.addEventListener('click', () => this.navigateBoundary(-1));
    this.backdropEl.querySelector('#btn-mag-next-cut')?.addEventListener('click', () => this.navigateBoundary(1));

    this.backdropEl.querySelector('#btn-nudge-m100')?.addEventListener('click', () => this.nudgeActiveBoundary(-100));
    this.backdropEl.querySelector('#btn-nudge-m10')?.addEventListener('click', () => this.nudgeActiveBoundary(-10));
    this.backdropEl.querySelector('#btn-nudge-m1')?.addEventListener('click', () => this.nudgeActiveBoundary(-1));
    this.backdropEl.querySelector('#btn-nudge-snap0x')?.addEventListener('click', () => this.snapActiveBoundary0X());
    this.backdropEl.querySelector('#btn-nudge-p1')?.addEventListener('click', () => this.nudgeActiveBoundary(1));
    this.backdropEl.querySelector('#btn-nudge-p10')?.addEventListener('click', () => this.nudgeActiveBoundary(10));
    this.backdropEl.querySelector('#btn-nudge-p100')?.addEventListener('click', () => this.nudgeActiveBoundary(100));

    this.backdropEl.querySelector('#btn-mag-play-slice')?.addEventListener('click', () => {
      const sl = this.currentResult?.slices.find((s) => s.id === this.selectedSliceId) || this.currentResult?.slices[0];
      if (sl) this.auditionSlice(sl);
    });

    this.backdropEl.querySelector('#btn-mag-toggle-silence')?.addEventListener('click', () => {
      if (this.selectedSliceId && this.currentResult) {
        this.currentResult = toggleSliceSilence(this.currentResult, this.selectedSliceId, this.sampleRate, this.options);
        this.drawWaveformCanvas();
        this.refreshTable();
      }
    });

    this.backdropEl.querySelector('#btn-mag-del-boundary')?.addEventListener('click', () => {
      if (this.currentResult) {
        const boundaries = extractBoundaryFrames(this.currentResult, this.pcm.length);
        if (boundaries.length <= 2) return;
        const bIdx = clamp(this.activeBoundaryIndex, 1, boundaries.length - 2);
        // Find slice starting at this boundary and delete it
        const slice = this.currentResult.slices[bIdx];
        if (slice) {
          this.currentResult = deleteSlice(this.currentResult, this.pcm, this.sampleRate, slice.id, this.options);
          this.activeBoundaryIndex = Math.max(1, bIdx - 1);
          this.render();
          toast(`Removed cut boundary #${bIdx}.`, 'info');
        }
      }
    });

    // Waveform & Magnifier Canvas Interactions
    this.bindCanvasInteraction();
    this.bindMagnifierInteraction();

    // Table rows play/silence/delete events
    this.bindTableEvents();

    // Drag MIDI to DAW Setup
    const dragBtn = this.backdropEl.querySelector('#btn-drag-midi') as HTMLElement | null;
    if (dragBtn && this.currentResult) {
      dragBtn.addEventListener('dragstart', (e: DragEvent) => {
        if (!this.currentResult) return;
        const midiBytes = this.currentResult.midiFileBuffer;
        const blob = new Blob([midiBytes.buffer as ArrayBuffer], { type: 'audio/midi' });
        const url = URL.createObjectURL(blob);
        const filename = `${(this.sourceFilename || 'sliced_audio').replace(/\.[^/.]+$/, '')}_slices.mid`;

        if (e.dataTransfer) {
          e.dataTransfer.setData('DownloadURL', `audio/midi:${filename}:${url}`);
          e.dataTransfer.setData('text/plain', filename);
        }
      });

      dragBtn.addEventListener('click', () => {
        if (!this.currentResult) return;
        const midiBytes = this.currentResult.midiFileBuffer;
        const blob = new Blob([midiBytes.buffer as ArrayBuffer], { type: 'audio/midi' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(this.sourceFilename || 'sliced_audio').replace(/\.[^/.]+$/, '')}_slices.mid`;
        a.click();
        URL.revokeObjectURL(url);
        toast('Downloaded Standard MIDI pattern for sliced audio.', 'success');
      });
    }

    // Inject Zones Action
    this.backdropEl.querySelector('#btn-chopper-inject')?.addEventListener('click', () => {
      this.handleInjectSlicesIntoSession();
    });
  }

  private bindCanvasInteraction(): void {
    if (!this.backdropEl) return;
    const canvas = this.backdropEl.querySelector('#chopper-waveform-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;

    const getFrameFromMouseX = (clientX: number): number => {
      const rect = canvas.getBoundingClientRect();
      const clickXNorm = clamp((clientX - rect.left) / rect.width, 0, 1);
      const totalFrames = this.pcm.length;
      const zoom = clamp(this.zoomFactor, 1, 16);
      const windowFrames = Math.max(64, Math.round(totalFrames / zoom));
      const centerFrame = clamp(Math.round(this.viewCenterNorm * totalFrames), 0, totalFrames);
      const viewStart = clamp(centerFrame - Math.floor(windowFrames * 0.5), 0, Math.max(0, totalFrames - windowFrames));
      return Math.round(viewStart + clickXNorm * windowFrames);
    };

    const getXFromFrame = (frame: number): number => {
      const rect = canvas.getBoundingClientRect();
      const totalFrames = this.pcm.length;
      const zoom = clamp(this.zoomFactor, 1, 16);
      const windowFrames = Math.max(64, Math.round(totalFrames / zoom));
      const centerFrame = clamp(Math.round(this.viewCenterNorm * totalFrames), 0, totalFrames);
      const viewStart = clamp(centerFrame - Math.floor(windowFrames * 0.5), 0, Math.max(0, totalFrames - windowFrames));
      const viewSpan = Math.max(1, windowFrames);
      return ((frame - viewStart) / viewSpan) * rect.width;
    };

    // Hover & Drag detection for overview boundary lines
    canvas.addEventListener('mousemove', (e: MouseEvent) => {
      if (this.isDraggingBoundary) {
        if (!this.currentResult) return;
        const targetFrame = getFrameFromMouseX(e.clientX);
        this.currentResult = moveSliceBoundary(
          this.currentResult,
          this.pcm,
          this.sampleRate,
          this.draggedBoundaryIndex,
          targetFrame,
          this.options.snapZeroCrossing,
          this.options
        );
        this.activeBoundaryIndex = this.draggedBoundaryIndex;
        this.drawWaveformCanvas();
        this.drawMagnifierCanvas();
        this.updateMagnifierHeader();
        this.refreshTable();
        return;
      }

      if (!this.currentResult || this.pcm.length === 0) return;
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const boundaries = extractBoundaryFrames(this.currentResult, this.pcm.length);

      let foundIdx = -1;
      for (let bIdx = 1; bIdx < boundaries.length - 1; bIdx++) {
        const bx = getXFromFrame(boundaries[bIdx]);
        if (Math.abs(mouseX - bx) <= 7) {
          foundIdx = bIdx;
          break;
        }
      }

      if (foundIdx !== this.hoveredBoundaryIndex) {
        this.hoveredBoundaryIndex = foundIdx;
        canvas.style.cursor = foundIdx > 0 ? 'col-resize' : 'crosshair';
        this.drawWaveformCanvas();
      }
    });

    canvas.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button !== 0) return; // Only left button for boundary dragging/selecting
      this.closeContextMenu();

      if (this.hoveredBoundaryIndex > 0) {
        this.isDraggingBoundary = true;
        this.draggedBoundaryIndex = this.hoveredBoundaryIndex;
        this.activeBoundaryIndex = this.hoveredBoundaryIndex;
        this.drawWaveformCanvas();
        this.drawMagnifierCanvas();
        this.updateMagnifierHeader();
        return;
      }

      // Normal click: select slice and update active boundary
      const clickedFrame = getFrameFromMouseX(e.clientX);
      const hit = this.currentResult?.slices.find(
        (s) => clickedFrame >= s.startFrame && clickedFrame <= s.endFrame
      );
      if (hit) {
        this.selectedSliceId = hit.id;
        if (this.currentResult) {
          const boundaries = extractBoundaryFrames(this.currentResult, this.pcm.length);
          // If first slice, select boundary #1; otherwise select boundary at slice start
          const bIdx = boundaries.findIndex((b) => Math.abs(b - hit.startFrame) < 32);
          this.activeBoundaryIndex = bIdx > 0 && bIdx < boundaries.length - 1 ? bIdx : 1;
        }
        this.auditionSlice(hit);
        this.drawWaveformCanvas();
        this.drawMagnifierCanvas();
        this.updateMagnifierHeader();
        this.refreshTable();
      }
    });

    window.addEventListener('mouseup', () => {
      if (this.isDraggingBoundary) {
        this.isDraggingBoundary = false;
        this.draggedBoundaryIndex = -1;
        this.drawWaveformCanvas();
        this.drawMagnifierCanvas();
        this.updateMagnifierHeader();
        this.refreshTable();
      }
    });

    // Right-Click Context Menu on Waveform (on cut line or empty space)
    canvas.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      if (!this.currentResult || this.pcm.length === 0) return;

      const clickedFrame = getFrameFromMouseX(e.clientX);
      const boundaries = extractBoundaryFrames(this.currentResult, this.pcm.length);

      // Check if right-clicked directly on a boundary line
      const hoveredBIdx = this.hoveredBoundaryIndex;
      if (hoveredBIdx > 0 && hoveredBIdx < boundaries.length - 1) {
        const bFrame = boundaries[hoveredBIdx];
        const sliceLeft = this.currentResult.slices[hoveredBIdx - 1];
        const sliceRight = this.currentResult.slices[hoveredBIdx];

        this.showContextMenu(e.clientX, e.clientY, [
          { label: `Cut Boundary #${hoveredBIdx} (${bFrame.toLocaleString()} smp)`, isHeader: true },
          {
            label: 'Delete Cut Boundary',
            icon: ICONS.trash,
            isDanger: true,
            onClick: () => {
              if (sliceRight) {
                this.currentResult = deleteSlice(this.currentResult!, this.pcm, this.sampleRate, sliceRight.id, this.options);
                this.activeBoundaryIndex = Math.max(1, hoveredBIdx - 1);
                this.render();
                toast(`Removed cut boundary #${hoveredBIdx}.`, 'info');
              }
            },
          },
          {
            label: 'Snap to 0-Crossing',
            icon: ICONS.wave,
            onClick: () => {
              this.activeBoundaryIndex = hoveredBIdx;
              this.snapActiveBoundary0X();
            },
          },
          {
            label: 'Inspect in Magnifier',
            icon: ICONS.scissors,
            onClick: () => {
              this.activeBoundaryIndex = hoveredBIdx;
              this.drawMagnifierCanvas();
              this.updateMagnifierHeader();
            },
          },
          { label: '', isDivider: true },
          ...(sliceLeft
            ? [
                {
                  label: `Play Left: Slice #${sliceLeft.index}`,
                  icon: ICONS.play,
                  onClick: () => this.auditionSlice(sliceLeft),
                },
                {
                  label: sliceLeft.isSilence ? `Unmute Left Slice #${sliceLeft.index}` : `Mute Left Slice #${sliceLeft.index}`,
                  icon: ICONS.eyeOff,
                  onClick: () => {
                    this.currentResult = toggleSliceSilence(this.currentResult!, sliceLeft.id, this.sampleRate, this.options);
                    this.drawWaveformCanvas();
                    this.refreshTable();
                  },
                },
              ]
            : []),
          ...(sliceRight
            ? [
                {
                  label: `Play Right: Slice #${sliceRight.index}`,
                  icon: ICONS.play,
                  onClick: () => this.auditionSlice(sliceRight),
                },
                {
                  label: sliceRight.isSilence ? `Unmute Right Slice #${sliceRight.index}` : `Mute Right Slice #${sliceRight.index}`,
                  icon: ICONS.eyeOff,
                  onClick: () => {
                    this.currentResult = toggleSliceSilence(this.currentResult!, sliceRight.id, this.sampleRate, this.options);
                    this.drawWaveformCanvas();
                    this.refreshTable();
                  },
                },
              ]
            : []),
        ]);
        return;
      }

      // Otherwise, right-clicked on empty area within a slice:
      const hitSlice = this.currentResult.slices.find(
        (s) => clickedFrame >= s.startFrame && clickedFrame <= s.endFrame
      );

      this.showContextMenu(e.clientX, e.clientY, [
        { label: hitSlice ? `Slice #${hitSlice.index} (${((clickedFrame / this.sampleRate) * 1000).toFixed(1)} ms)` : 'Audio Waveform', isHeader: true },
        {
          label: `+ Add Cut Marker Here (${clickedFrame.toLocaleString()} smp)`,
          icon: ICONS.plus,
          onClick: () => {
            this.currentResult = splitSliceAtFrame(
              this.currentResult!,
              this.pcm,
              this.sampleRate,
              clickedFrame,
              this.options.snapZeroCrossing,
              this.options
            );
            const updatedBoundaries = extractBoundaryFrames(this.currentResult!, this.pcm.length);
            const newIdx = updatedBoundaries.findIndex((b) => Math.abs(b - clickedFrame) < 64);
            if (newIdx > 0 && newIdx < updatedBoundaries.length - 1) {
              this.activeBoundaryIndex = newIdx;
            }
            this.render();
            toast(`Added slice cut at ${clickedFrame.toLocaleString()} smp.`, 'success');
          },
        },
        ...(hitSlice
          ? [
              {
                label: `Audition Slice #${hitSlice.index}`,
                icon: ICONS.play,
                onClick: () => this.auditionSlice(hitSlice),
              },
              {
                label: hitSlice.isSilence ? `Unmute Slice (Mark Active)` : `Mark as Silence (Mute)`,
                icon: ICONS.eyeOff,
                onClick: () => {
                  this.currentResult = toggleSliceSilence(this.currentResult!, hitSlice.id, this.sampleRate, this.options);
                  this.drawWaveformCanvas();
                  this.refreshTable();
                },
              },
              { label: '', isDivider: true },
              {
                label: `Delete Slice #${hitSlice.index}`,
                icon: ICONS.trash,
                isDanger: true,
                onClick: () => {
                  this.currentResult = deleteSlice(this.currentResult!, this.pcm, this.sampleRate, hitSlice.id, this.options);
                  this.render();
                  toast(`Deleted slice #${hitSlice.index}.`, 'info');
                },
              },
            ]
          : []),
      ]);
    });

    // Double-click to split slice at frame
    canvas.addEventListener('dblclick', (e: MouseEvent) => {
      if (!this.currentResult || this.pcm.length === 0) return;
      const splitFrame = getFrameFromMouseX(e.clientX);
      this.currentResult = splitSliceAtFrame(
        this.currentResult,
        this.pcm,
        this.sampleRate,
        splitFrame,
        this.options.snapZeroCrossing,
        this.options
      );

      const boundaries = extractBoundaryFrames(this.currentResult, this.pcm.length);
      const newBIdx = boundaries.findIndex((b) => Math.abs(b - splitFrame) < 64);
      if (newBIdx > 0 && newBIdx < boundaries.length - 1) {
        this.activeBoundaryIndex = newBIdx;
      }

      toast(`Added slice cut at ${splitFrame.toLocaleString()} smp.`, 'success');
      this.render();
    });
  }

  private bindMagnifierInteraction(): void {
    if (!this.backdropEl) return;
    const magCanvas = this.backdropEl.querySelector('#chopper-magnifier-canvas') as HTMLCanvasElement | null;
    if (!magCanvas) return;

    magCanvas.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button !== 0) return;
      this.closeContextMenu();
      if (!this.currentResult || this.pcm.length === 0) return;

      this.isDraggingMagnifier = true;
      this.magDragStartMouseX = e.clientX;
      this.magDragStartCutFrame = this.getActiveCutFrame();
      this.drawMagnifierCanvas();
    });

    window.addEventListener('mousemove', (e: MouseEvent) => {
      if (!this.isDraggingMagnifier || !this.currentResult || this.pcm.length === 0) return;
      if (!this.magnifierCanvas) return;

      const rect = this.magnifierCanvas.getBoundingClientRect();
      const deltaX = e.clientX - this.magDragStartMouseX;
      const totalMagnifierWindowSamples = 512;
      const samplesPerPixel = totalMagnifierWindowSamples / Math.max(1, rect.width);
      const deltaSamples = Math.round(deltaX * samplesPerPixel);
      const targetFrame = this.magDragStartCutFrame + deltaSamples;

      const boundaries = extractBoundaryFrames(this.currentResult, this.pcm.length);
      if (boundaries.length <= 2) return;
      const bIdx = clamp(this.activeBoundaryIndex, 1, boundaries.length - 2);

      this.currentResult = moveSliceBoundary(
        this.currentResult,
        this.pcm,
        this.sampleRate,
        bIdx,
        targetFrame,
        false, // Real-time exact sample dragging (no snap during drag)
        this.options
      );

      this.drawWaveformCanvas();
      this.drawMagnifierCanvas();
      this.updateMagnifierHeader();
      this.refreshTable();
    });

    window.addEventListener('mouseup', () => {
      if (this.isDraggingMagnifier) {
        this.isDraggingMagnifier = false;
        this.drawWaveformCanvas();
        this.drawMagnifierCanvas();
        this.updateMagnifierHeader();
        this.refreshTable();
      }
    });
  }

  private bindTableEvents(): void {
    if (!this.backdropEl) return;

    this.backdropEl.querySelectorAll<HTMLTableRowElement>('.chopper-slices-table tbody tr').forEach((tr) => {
      tr.addEventListener('click', () => {
        const sliceId = tr.dataset.sliceId;
        const sl = this.currentResult?.slices.find((s) => s.id === sliceId);
        if (sl && this.currentResult) {
          this.selectedSliceId = sl.id;
          const boundaries = extractBoundaryFrames(this.currentResult, this.pcm.length);
          const bIdx = boundaries.findIndex((b) => Math.abs(b - sl.startFrame) < 32);
          this.activeBoundaryIndex = bIdx > 0 && bIdx < boundaries.length - 1 ? bIdx : 1;
          this.auditionSlice(sl);
          this.drawWaveformCanvas();
          this.drawMagnifierCanvas();
          this.updateMagnifierHeader();
          this.refreshTable();
        }
      });
    });

    this.backdropEl.querySelectorAll<HTMLButtonElement>('.btn-play-slice').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sliceId = btn.dataset.sliceId;
        const sl = this.currentResult?.slices.find((s) => s.id === sliceId);
        if (sl) this.auditionSlice(sl);
      });
    });

    this.backdropEl.querySelectorAll<HTMLButtonElement>('.btn-toggle-silence-row').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sliceId = btn.dataset.sliceId;
        if (sliceId && this.currentResult) {
          this.currentResult = toggleSliceSilence(this.currentResult, sliceId, this.sampleRate, this.options);
          this.drawWaveformCanvas();
          this.refreshTable();
        }
      });
    });

    this.backdropEl.querySelectorAll<HTMLButtonElement>('.btn-delete-slice').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sliceId = btn.dataset.sliceId;
        if (sliceId && this.currentResult) {
          this.currentResult = deleteSlice(this.currentResult, this.pcm, this.sampleRate, sliceId, this.options);
          const boundaries = extractBoundaryFrames(this.currentResult, this.pcm.length);
          if (this.activeBoundaryIndex >= boundaries.length - 1) {
            this.activeBoundaryIndex = Math.max(1, boundaries.length - 2);
          }
          this.render();
          toast('Removed slice marker.', 'info');
        }
      });
    });
  }

  private auditionSlice(sl: DetectedSlice): void {
    this.playingSliceId = sl.id;
    if (this.context.onAuditionPcm) {
      this.context.onAuditionPcm(sl.pcm, this.sampleRate);
    }
  }

  private handleInjectSlicesIntoSession(): void {
    const res = this.currentResult;
    if (!res) return;

    const validSlices = res.slices.filter((s) => !s.isSilence);
    if (validSlices.length === 0) {
      toast('No valid slices to inject into session.', 'warning');
      return;
    }

    const isExtended = this.context.getCurrentWorkingMode() === 'extended';
    const baseName = (this.sourceFilename || 'sample').replace(/\.[^/.]+$/, '');
    const audioSamples: Array<{ name: string; buffer: ArrayBuffer }> = [];

    validSlices.forEach((sl, idx) => {
      const sliceWavName = `${baseName}_slice${String(idx + 1).padStart(2, '0')}.wav`;
      const wavBuffer = encodePcm16Wav(sl.pcm, this.sampleRate, {
        rootKey: sl.rootKey,
        lowKey: sl.lowKey,
        highKey: sl.highKey,
      });
      audioSamples.push({ name: sliceWavName, buffer: wavBuffer });
    });

    if (isExtended) {
      const isDrum = this.options.mode === 'drums';
      const regions: ExtendedRegion[] = validSlices.map((sl, idx) => ({
        id: `reg_chopped_${idx + 1}_${Date.now()}`,
        sampleName: audioSamples[idx].name,
        rootKey: sl.rootKey,
        lowKey: sl.lowKey,
        highKey: sl.highKey,
        lowVel: sl.lowVel,
        highVel: sl.highVel,
        detune: 0,
        volume: 0,
        pan: 0,
        pitchKeytrack: isDrum ? 0 : 100,
        trigger: 'attack',
        keyFadeIn: 0,
        keyFadeOut: 0,
        velFadeIn: 0,
        velFadeOut: 0,
        fadeCurve: 'equal-power',
        loopMode: 'no_loop',
        loopStart: 0,
        loopEnd: sl.pcm.length,
        loopCrossfadeMs: 0,
        sampleRate: this.sampleRate,
        numChannels: 1,
      }));

      this.context.onInjectExtendedRegions?.(regions, audioSamples);
      toast(`Successfully mapped ${regions.length} audio slices to 2D Sampler Regions!`, 'success');
    } else {
      const zones: Zone[] = validSlices.map((sl, idx) => ({
        id: `zone_chopped_${idx + 1}_${Date.now()}`,
        rootKey: sl.rootKey,
        lowKey: sl.lowKey,
        highKey: sl.highKey,
        sampleLow: audioSamples[idx].name,
        sampleHigh: null,
        velSplit: 64,
        detune: 0,
        volume: 0,
        pan: 0,
      }));

      this.context.onInjectClassicZones?.(zones, audioSamples);
      toast(`Successfully mapped ${zones.length} audio slices to Classic Keyboard Zones!`, 'success');
    }

    this.close();
  }
}
