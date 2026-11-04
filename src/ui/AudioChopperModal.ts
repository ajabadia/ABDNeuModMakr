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
import { confirmDialog, toast } from './notify.ts';
import {
  resolveAiActionDeclaration,
  separateStemsDspFallback,
} from '../core/ai/aiHonesty.ts';
import { clamp } from '../core/dsp/DspMath.ts';
import { downloadBlob } from './download.ts';
import {
  encodePcm16Wav,
  decodeWav,
  decodeAiff,
  transcodeAnyAudioToWavBuffer,
} from '../core/dsp/WavDecoder.ts';
import {
  snapFrameToNearestZeroCrossing,
} from '../core/dsp/LoopEditorTools.ts';
import {
  sliceAudioBuffer,
  sliceAudioBufferPreservingManualCuts,
  buildSlicesFromBoundaries,
  buildSlicesFromPhoneticWords,
  buildSlicesFromMidiManifest,
  moveSliceBoundary,
  deleteSlice,
  toggleSliceSilence,
  extractBoundaryFrames,
  normalizePeakPcm,
  conformLoopToTargetBpm,
  DEFAULT_SLICER_OPTIONS,
  type DetectedSlice,
  type SlicerOptions,
  type SlicerResult,
  type SlicerMode,
  type SlicerWorkflowMode,
  type ManualSilenceRange,
} from '../core/dsp/AudioSlicerEngine.ts';
import { extractManifestFromWavBytes } from '../core/autoSampler/MidiAutoSampleSession.ts';
import { parseSliceFile } from '../core/dsp/SliceFileParser.ts';
import { decompressRx2Audio, isRx2Buffer } from '../core/dsp/DwopDecompressor.ts';
import { bridgeClient } from '../core/bridge/BridgeClient.ts';
import {
  reduceNoiseWithProfile,
  type NoiseProfile,
} from '../../vendor/@abdsynths/shared/Code/DspCore/TakeDsp/index.ts';
import type { Zone, ExtendedRegion, WorkingMode, UnifiedSurfaceUiConfig } from '../core/types.ts';
import { createModalFocusTrap, type FocusTrap } from './modalFocusTrap.ts';
import type { ChopperContext } from './chopper/types.ts';
import { drawMagnifierCanvas, drawWaveformCanvas } from './chopper/canvasOps.ts';
import { refreshTable, render, updateMagnifierHeader } from './chopper/renderOps.ts';
import {
  bindCanvasInteraction,
  bindMagnifierInteraction,
  bindTableEvents,
  closeContextMenu,
  showContextMenu,
} from './chopper/eventsOps.ts';
import {
  auditionConformedLoop,
  auditionFullWav,
  auditionSlice,
} from './chopper/auditionOps.ts';

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
  onUpdateTempoSync?: (tempoSync: NonNullable<UnifiedSurfaceUiConfig['tempoSync']>) => void;
  onAuditionPcm?: (pcm: Float32Array, sampleRate: number) => void;
  onStopAudition?: () => void;
  onRegisterSampleBuffer?: (name: string, buffer: ArrayBuffer) => void;
}

export interface ContextMenuItem {
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

  // Unnormalized source audio: normalize works on a copy, never mutates this.
  private sourcePcm: Float32Array | null = null;
  private normalizeEnabled: boolean = false;

  // Manual slice boundary & silence tracking
  private manualCutFrames: Set<number> = new Set();
  private manualSilenceRanges: ManualSilenceRange[] = [];
  private manualCutsPolicy: 'prompt' | 'keep' | 'discard' = 'prompt';
  private activeConfirmModalEl: HTMLElement | null = null;

  // Trampa de foco compartida + trampa del diálogo anidado (confirm/stems viven en body).
  private focusTrap: FocusTrap | null = null;
  private nestedTrap: FocusTrap | null = null;

  // Fase 30: Captured Noise Print from selected slice or silence
  private capturedNoiseProfile: NoiseProfile | null = null;

  private chopperCtx(): ChopperContext {
    const host = this;
    return {
      state: {
      get backdropEl() {
        return host.backdropEl;
      },
      set backdropEl(v) {
        host.backdropEl = v;
      },
      get canvas() {
        return host.canvas;
      },
      set canvas(v) {
        host.canvas = v;
      },
      get magnifierCanvas() {
        return host.magnifierCanvas;
      },
      set magnifierCanvas(v) {
        host.magnifierCanvas = v;
      },
      get pcm() {
        return host.pcm;
      },
      set pcm(v) {
        host.pcm = v;
      },
      get zoomFactor() {
        return host.zoomFactor;
      },
      set zoomFactor(v) {
        host.zoomFactor = v;
      },
      get viewCenterNorm() {
        return host.viewCenterNorm;
      },
      set viewCenterNorm(v) {
        host.viewCenterNorm = v;
      },
      get currentResult() {
        return host.currentResult;
      },
      set currentResult(v) {
        host.currentResult = v;
      },
      get selectedSliceId() {
        return host.selectedSliceId;
      },
      set selectedSliceId(v) {
        host.selectedSliceId = v;
      },
      get hoveredBoundaryIndex() {
        return host.hoveredBoundaryIndex;
      },
      set hoveredBoundaryIndex(v) {
        host.hoveredBoundaryIndex = v;
      },
      get draggedBoundaryIndex() {
        return host.draggedBoundaryIndex;
      },
      set draggedBoundaryIndex(v) {
        host.draggedBoundaryIndex = v;
      },
      get activeBoundaryIndex() {
        return host.activeBoundaryIndex;
      },
      set activeBoundaryIndex(v) {
        host.activeBoundaryIndex = v;
      },
      get isDraggingMagnifier() {
        return host.isDraggingMagnifier;
      },
      set isDraggingMagnifier(v) {
        host.isDraggingMagnifier = v;
      },
      get context() {
        return host.context;
      },
      set context(v) {
        host.context = v;
      },
      get options() {
        return host.options;
      },
      set options(v) {
        host.options = v;
      },
      get sourceFilename() {
        return host.sourceFilename;
      },
      set sourceFilename(v) {
        host.sourceFilename = v;
      },
      get sampleRate() {
        return host.sampleRate;
      },
      set sampleRate(v) {
        host.sampleRate = v;
      },
      get playingSliceId() {
        return host.playingSliceId;
      },
      set playingSliceId(v) {
        host.playingSliceId = v;
      },
      get normalizeEnabled() {
        return host.normalizeEnabled;
      },
      set normalizeEnabled(v) {
        host.normalizeEnabled = v;
      },
      get manualCutFrames() {
        return host.manualCutFrames;
      },
      set manualCutFrames(v) {
        host.manualCutFrames = v;
      },
      get isDraggingBoundary() {
        return host.isDraggingBoundary;
      },
      set isDraggingBoundary(v) {
        host.isDraggingBoundary = v;
      },
      get magDragStartMouseX() {
        return host.magDragStartMouseX;
      },
      set magDragStartMouseX(v) {
        host.magDragStartMouseX = v;
      },
      get magDragStartCutFrame() {
        return host.magDragStartCutFrame;
      },
      set magDragStartCutFrame(v) {
        host.magDragStartCutFrame = v;
      },
      get capturedNoiseProfile() {
        return host.capturedNoiseProfile;
      },
      set capturedNoiseProfile(v) {
        host.capturedNoiseProfile = v;
      },
      get activeContextMenuEl() {
        return host.activeContextMenuEl;
      },
      set activeContextMenuEl(v) {
        host.activeContextMenuEl = v;
      },
      get manualSilenceRanges() {
        return host.manualSilenceRanges;
      },
      set manualSilenceRanges(v) {
        host.manualSilenceRanges = v;
      },
      },
      isBoundaryManual: (frame) => host.isBoundaryManual(frame),
      getActiveCutFrame: () => host.getActiveCutFrame(),
      close: () => host.close(),
      checkZeroCrossing: (frame) => host.checkZeroCrossing(frame),
      bindEvents: () => host.bindEvents(),
      navigateBoundary: (delta) => host.navigateBoundary(delta),
      bindTableEvents: () => host.bindTableEvents(),
      auditionSlice: (slice, toggleStopIfSame) => host.auditionSlice(slice, toggleStopIfSame),
      showContextMenu: (x, y, items) => host.showContextMenu(x, y, items),
      removeManualBoundary: (frame) => host.removeManualBoundary(frame),
      render: () => host.render(),
      snapActiveBoundary0X: () => host.snapActiveBoundary0X(),
      handleToggleSliceSilence: (sliceId) => host.handleToggleSliceSilence(sliceId),
      registerManualBoundary: (newFrame, oldFrame) => host.registerManualBoundary(newFrame, oldFrame),
    };
  }

  constructor(context: AudioChopperContext) {
    this.context = context;
  }

  public open(
    pcm: Float32Array,
    sampleRate: number,
    sourceFilename: string = '',
    sliceFrames?: number[]
  ): void {
    // Recarga permitida: si el modal ya está abierto, se sustituye el audio
    // y se repinta (antes se ignoraba en silencio y solo salía el toast).
    if (this.backdropEl) {
      this.context.onStopAudition?.();
    }
    this.setWorkingAudio(pcm);
    this.sampleRate = Math.max(1, sampleRate);
    this.sourceFilename = sourceFilename;
    this.zoomFactor = 1.0;
    this.viewCenterNorm = 0.5;
    this.selectedSliceId = null;
    this.activeBoundaryIndex = 1;
    this.manualSilenceRanges = [];
    this.manualCutsPolicy = 'prompt';

    if (sliceFrames && sliceFrames.length > 1) {
      this.manualCutFrames = new Set(sliceFrames.filter((f) => f > 0 && f < this.pcm.length));
      this.currentResult = buildSlicesFromBoundaries(
        this.pcm,
        this.sampleRate,
        sliceFrames,
        this.options
      );
      this.selectedSliceId = this.currentResult.slices[0]?.id ?? null;
    } else {
      this.manualCutFrames.clear();
      if (this.pcm.length > 0) {
        this.recomputeSlices();
      } else {
        this.currentResult = null;
      }
    }

    this.render();

    if (!this.focusTrap && this.backdropEl) {
      this.focusTrap = createModalFocusTrap(this.backdropEl, {
        initialFocusSelector: '#btn-chopper-close',
        onEscape: () => {
          if (this.activeContextMenuEl) {
            this.closeContextMenu();
          } else if (this.backdropEl) {
            this.close();
          }
        },
      });
      this.focusTrap.activate();
    }
  }

  public openWithAudioBuffer(arrayBuf: ArrayBuffer, filename: string, sliceFrames?: number[]): void {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.rx2') || lower.endsWith('.rex') || lower.endsWith('.rcy')) {
      void this._handleRx2Buffer(arrayBuf, filename, sliceFrames);
      return;
    }
    const isAif = lower.endsWith('.aif') || lower.endsWith('.aiff');
    const decoded = isAif ? decodeAiff(arrayBuf) : decodeWav(arrayBuf);
    let mono: Float32Array;
    if (decoded.channels.length === 1) {
      mono = decoded.channels[0];
    } else {
      mono = new Float32Array(decoded.channels[0].length);
      for (let i = 0; i < mono.length; i++) {
        mono[i] = (decoded.channels[0][i] + decoded.channels[1][i]) * 0.5;
      }
    }

    // Fase 37.6: Check if WAV contains an embedded MidiAutoSampleManifest (`atem` chunk)
    if (!isAif && (!sliceFrames || sliceFrames.length === 0)) {
      const autoManifest = extractManifestFromWavBytes(arrayBuf);
      if (autoManifest && autoManifest.events.length > 0) {
        this.open(mono, decoded.sampleRate, filename);
        this.currentResult = buildSlicesFromMidiManifest(mono, decoded.sampleRate, autoManifest);
        const boundaries = extractBoundaryFrames(this.currentResult, mono.length);
        this.manualCutFrames = new Set(boundaries.filter((f) => f > 0 && f < mono.length));
        this.selectedSliceId = this.currentResult.slices[0]?.id ?? null;
        this.render();
        toast(
          `Cargadas ${this.currentResult.slices.length} notas/velocidades desde el manifiesto MIDI de AutoSampler (${filename})`,
          'success'
        );
        return;
      }
    }

    this.open(mono, decoded.sampleRate, filename, sliceFrames);
  }

  public close(): void {
    this.context.onStopAudition?.();
    this.closeContextMenu();
    this.closeConfirmModal(false);
    if (this.nestedTrap) {
      this.nestedTrap.deactivate();
      this.nestedTrap = null;
    }
    if (this.focusTrap) {
      this.focusTrap.deactivate();
      this.focusTrap = null;
    }
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

      // Check if it's a ReCycle file (.rx2, .rex, .rcy)
      if (/\.(rx2|rex|rcy)$/i.test(file.name)) {
        await this._handleRx2Buffer(arrayBuf, file.name);
        return;
      }

      // Check if it's a slice marker or CUE/SFZ file (.sfz, .cue, .txt)
      const isSliceFileExt = /\.(sfz|cue|txt)$/i.test(file.name);
      if (isSliceFileExt) {
        const parsed = parseSliceFile(arrayBuf, file.name, this.sampleRate);
        if (parsed && parsed.sliceFrames.length > 0) {
          if (parsed.pcm && parsed.pcm.length > 0) {
            this.pcm = parsed.pcm;
            this.sampleRate = parsed.sampleRate || 44100;
          } else if (this.pcm.length === 0) {
            // Generate synthetic acoustic preview buffer corresponding to slice boundaries
            const maxFrame = Math.max(...parsed.sliceFrames);
            const totalLen = Math.max(maxFrame + 22050, Math.round((parsed.sampleRate || 44100) * 2));
            const synthPcm = new Float32Array(totalLen);
            for (const f of parsed.sliceFrames) {
              if (f < synthPcm.length) {
                synthPcm[f] = 0.8;
                if (f + 1 < synthPcm.length) synthPcm[f + 1] = -0.5;
                if (f + 2 < synthPcm.length) synthPcm[f + 2] = 0.2;
              }
            }
            this.pcm = synthPcm;
            this.sampleRate = parsed.sampleRate || 44100;
          }
          if (this.pcm.length > 0) {
            this.sourceFilename = file.name;
            this.manualCutFrames = new Set(parsed.sliceFrames.filter((f) => f > 0 && f < this.pcm.length));
            this.manualSilenceRanges = [];
            this.manualCutsPolicy = 'prompt';
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

      // Universal Audio Decode (WAV, AIFF/AIFC, FLAC, CAF, MP3, OGG, M4A/AAC, Opus)
      const wavBuf = await transcodeAnyAudioToWavBuffer(arrayBuf, file.name);
      const decWav = decodeWav(wavBuf);
      this.pcm = decWav.mono;
      this.sampleRate = decWav.sampleRate;
      this.sourceFilename = file.name;
      this.zoomFactor = 1.0;
      this.viewCenterNorm = 0.5;
      this.selectedSliceId = null;
      this.activeBoundaryIndex = 1;

      this.context.onRegisterSampleBuffer?.(file.name, wavBuf);

      // Check if standard WAV / AIFF contains embedded slice cues
      const embedded = parseSliceFile(arrayBuf, file.name, this.sampleRate);
      if (embedded && embedded.sliceFrames.length > 1) {
        this.manualCutFrames = new Set(embedded.sliceFrames.filter((f) => f > 0 && f < this.pcm.length));
        this.manualSilenceRanges = [];
        this.manualCutsPolicy = 'prompt';
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
        this.manualCutFrames.clear();
        this.manualSilenceRanges = [];
        this.manualCutsPolicy = 'prompt';
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

      this.manualCutFrames = new Set(parsed.sliceFrames.filter((f) => f > 0 && f < this.pcm.length));
      this.manualSilenceRanges = [];
      this.manualCutsPolicy = 'prompt';
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
    this.setWorkingAudio(pcm);
    this.sampleRate = sr;
    this.sourceFilename = 'DemoBreak.wav';
    this.zoomFactor = 1.0;
    this.viewCenterNorm = 0.5;
    this.selectedSliceId = null;
    this.activeBoundaryIndex = 1;
    this.manualCutFrames.clear();
    this.manualSilenceRanges = [];
    this.manualCutsPolicy = 'prompt';
    this.recomputeSlices();
    this.render();
    toast('Loaded 2-second synthesized test beat for slicer auditioning.', 'info');
  }

  private isBoundaryManual(frame: number): boolean {
    if (this.manualCutFrames.has(frame)) return true;
    for (const mf of this.manualCutFrames) {
      if (Math.abs(mf - frame) <= 6) return true;
    }
    return false;
  }

  private registerManualBoundary(newFrame: number, oldFrame?: number): void {
    if (oldFrame !== undefined) {
      for (const mf of Array.from(this.manualCutFrames)) {
        if (Math.abs(mf - oldFrame) <= 6) {
          this.manualCutFrames.delete(mf);
        }
      }
    }
    this.manualCutFrames.add(newFrame);
  }

  private removeManualBoundary(frame: number): void {
    for (const mf of Array.from(this.manualCutFrames)) {
      if (Math.abs(mf - frame) <= 6) {
        this.manualCutFrames.delete(mf);
      }
    }
  }

  private hasManualCuts(): boolean {
    return this.manualCutFrames.size > 0 || this.manualSilenceRanges.length > 0;
  }

  /** Guarda el original sin tocar y deriva el buffer de trabajo (copia normalizada si está activo). */
  private setWorkingAudio(pcm: Float32Array): void {
    this.sourcePcm = pcm;
    this.pcm = this.applyNormalize(pcm);
  }

  private applyNormalize(pcm: Float32Array): Float32Array {
    if (!this.normalizeEnabled || pcm.length === 0) return pcm;
    return normalizePeakPcm(pcm).pcm;
  }

  private recomputeSlices(forceAuto: boolean = false): void {
    if (this.pcm.length === 0) {
      this.currentResult = null;
      return;
    }
    if (forceAuto || (!this.hasManualCuts())) {
      this.currentResult = sliceAudioBuffer(this.pcm, this.sampleRate, this.options);
    } else {
      this.currentResult = sliceAudioBufferPreservingManualCuts(
        this.pcm,
        this.sampleRate,
        this.options,
        Array.from(this.manualCutFrames),
        this.manualSilenceRanges
      );
    }
    if (!this.selectedSliceId && this.currentResult.slices.length > 0) {
      const firstValid = this.currentResult.slices.find((s) => !s.isSilence);
      this.selectedSliceId = firstValid ? firstValid.id : this.currentResult.slices[0].id;
    }
    const boundaries = extractBoundaryFrames(this.currentResult, this.pcm.length);
    if (this.activeBoundaryIndex >= boundaries.length - 1) {
      this.activeBoundaryIndex = Math.max(1, boundaries.length - 2);
    }
  }

  private handleToggleSliceSilence(sliceId: string): void {
    if (!this.currentResult) return;
    const sl = this.currentResult.slices.find((s) => s.id === sliceId);
    if (!sl) return;
    const willBeSilence = !sl.isSilence;
    this.currentResult = toggleSliceSilence(this.currentResult, sliceId, this.sampleRate, this.options);

    if (willBeSilence) {
      this.manualSilenceRanges.push({ start: sl.startFrame, end: sl.endFrame });
    } else {
      this.manualSilenceRanges = this.manualSilenceRanges.filter(
        (r) => !(Math.abs(r.start - sl.startFrame) < 32 && Math.abs(r.end - sl.endFrame) < 32)
      );
    }

    this.drawWaveformCanvas();
    this.drawMagnifierCanvas();
    this.refreshTable();
  }

  private async reconcileSlicesAfterAudioClean(actionLabel: string): Promise<void> {
    if (!this.hasManualCuts()) {
      this.recomputeSlices(true);
      this.render();
      toast(`${actionLabel} (cortes automáticos recalculados sobre el audio limpio).`, 'success');
      return;
    }

    if (this.manualCutsPolicy === 'discard') {
      this.manualCutFrames.clear();
      this.manualSilenceRanges = [];
      this.recomputeSlices(true);
      this.render();
      toast(`${actionLabel} (cortes recalculados automáticamente).`, 'success');
      return;
    }

    if (this.manualCutsPolicy === 'keep') {
      this.recomputeSlices(false);
      this.render();
      toast(`${actionLabel} (cortes manuales preservados).`, 'success');
      return;
    }

    const recalculateAuto = await confirmDialog(
      `La limpieza o mejora cambió la señal de audio y tienes ${this.manualCutFrames.size} corte(s) manual(es).\n\n¿Recalcular cortes automáticamente sobre el audio limpio (descartando ediciones manuales) o conservar tus marcas manuales?`,
      {
        title: 'La limpieza cambió el audio — ¿Recalcular cortes?',
        confirmLabel: 'Recalcular cortes (Auto)',
        cancelLabel: 'Conservar cortes manuales',
      }
    );

    if (recalculateAuto) {
      this.manualCutFrames.clear();
      this.manualSilenceRanges = [];
      this.recomputeSlices(true);
      this.render();
      toast(`${actionLabel} (cortes recalculados sobre el audio limpio).`, 'success');
    } else {
      this.recomputeSlices(false);
      this.render();
      toast(`${actionLabel} (cortes manuales conservados).`, 'info');
    }
  }

  /** Suspende la trampa del chopper mientras un diálogo anidado (body) tiene el foco. */
  private suspendFocusTrap(): void {
    this.focusTrap?.deactivate();
  }

  /** Reanuda la trampa del chopper al cerrarse el diálogo anidado. */
  private resumeFocusTrap(): void {
    if (this.backdropEl && this.focusTrap) {
      this.focusTrap.activate();
    }
  }

  private closeConfirmModal(resumeParent: boolean = true): void {
    if (this.nestedTrap) {
      this.nestedTrap.deactivate();
      this.nestedTrap = null;
    }
    if (this.activeConfirmModalEl) {
      this.activeConfirmModalEl.remove();
      this.activeConfirmModalEl = null;
    }
    if (resumeParent) {
      this.resumeFocusTrap();
    }
  }

  private showManualCutsConfirmationModal(
    descriptionHtml: string,
    onKeep: () => void,
    onDiscard: () => void,
    onCancel: () => void
  ): void {
    this.closeConfirmModal();

    const modal = document.createElement('div');
    modal.className = 'nmm-modal-backdrop nmm-confirm-backdrop';
    modal.innerHTML = `
      <div class="nmm-modal-window nmm-confirm-window">
        <header class="nmm-modal-header">
          <div class="nmm-modal-header-title">
            <span class="nmm-modal-header-icon">${ICONS.scissors}</span>
            <h2>Manual Slice Edits Detected</h2>
          </div>
          <button type="button" class="nmm-modal-close" id="btn-confirm-close" aria-label="Close">${ICONS.close}</button>
        </header>
        <div class="nmm-modal-body nmm-audio-modal-body">
          <p>
            ${descriptionHtml}
          </p>
          <div class="nmm-audio-controls-card">
            <span class="badge-manual-cuts">Manual Customizations:</span>
            <ul>
              <li><strong>${this.manualCutFrames.size}</strong> manual slice cut marker(s)</li>
              ${this.manualSilenceRanges.length > 0 ? `<li><strong>${this.manualSilenceRanges.length}</strong> manual silence interval(s)</li>` : ''}
            </ul>
          </div>
          <p class="nmm-audio-table-hint">
            How would you like to handle your manual cuts?
          </p>
          <label class="batch-check nmm-audio-table-hint">
            <input type="checkbox" class="articulation-checkbox switch--sm" id="chk-remember-policy" />
            <span>Remember choice for subsequent changes in this session</span>
          </label>
        </div>
        <footer class="nmm-modal-footer">
          <div class="footer-left">
            <button type="button" class="btn btn-ghost" id="btn-cuts-cancel">Cancel</button>
          </div>
          <div class="footer-right">
            <button type="button" class="btn btn-danger-solid" id="btn-cuts-discard">Discard Cuts (Auto)</button>
            <button type="button" class="btn btn-primary" id="btn-cuts-keep">Keep Manual Cuts</button>
          </div>
        </footer>
      </div>
    `;

    document.body.appendChild(modal);
    this.activeConfirmModalEl = modal;

    // El diálogo anidado vive fuera del backdrop: trampa propia + padre en pausa.
    this.suspendFocusTrap();
    this.nestedTrap = createModalFocusTrap(modal, {
      initialFocusSelector: '#btn-cuts-keep',
      onEscape: () => {
        this.closeConfirmModal();
        onCancel();
      },
    });
    this.nestedTrap.activate();

    const rememberCheck = modal.querySelector('#chk-remember-policy') as HTMLInputElement | null;

    modal.querySelector('#btn-confirm-close')?.addEventListener('click', () => {
      this.closeConfirmModal();
      onCancel();
    });
    modal.querySelector('#btn-cuts-cancel')?.addEventListener('click', () => {
      this.closeConfirmModal();
      onCancel();
    });
    modal.querySelector('#btn-cuts-discard')?.addEventListener('click', () => {
      const remember = rememberCheck?.checked;
      if (remember) this.manualCutsPolicy = 'discard';
      this.closeConfirmModal();
      onDiscard();
    });
    modal.querySelector('#btn-cuts-keep')?.addEventListener('click', () => {
      const remember = rememberCheck?.checked;
      if (remember) this.manualCutsPolicy = 'keep';
      this.closeConfirmModal();
      onKeep();
    });
  }

  private async _handleRx2Buffer(
    arrayBuf: ArrayBuffer,
    filename: string,
    providedSliceFrames?: number[]
  ): Promise<void> {
    const parsed = parseSliceFile(arrayBuf, filename, this.sampleRate);
    const sliceFrames =
      providedSliceFrames && providedSliceFrames.length > 0
        ? providedSliceFrames
        : (parsed?.sliceFrames ?? []);

    // 1. Direct in-browser client-side TypeScript decompression (100% offline, Vercel-ready)
    if (isRx2Buffer(arrayBuf)) {
      try {
        const decompressed = decompressRx2Audio(arrayBuf);
        const wavName = filename.replace(/\.(rx2|rex|rcy)$/i, '.wav');
        this.context.onRegisterSampleBuffer?.(wavName, decompressed.wavBuffer);

        let mono: Float32Array;
        if (decompressed.channels.length === 1) {
          mono = decompressed.channels[0];
        } else {
          mono = new Float32Array(decompressed.channels[0].length);
          for (let i = 0; i < mono.length; i++) {
            mono[i] = (decompressed.channels[0][i] + decompressed.channels[1][i]) * 0.5;
          }
        }

        const effectiveSlices = sliceFrames.length > 0 ? sliceFrames : decompressed.sliceFrames;
        this.open(mono, decompressed.sampleRate, wavName, effectiveSlices);
        toast(
          `Decompressed ${effectiveSlices.length} slices from ${filename} (${decompressed.channels.length === 2 ? 'Stereo' : 'Mono'}, ${decompressed.sampleRate} Hz) in browser`,
          'success'
        );
        return;
      } catch (tsErr) {
        console.warn('In-browser DWOP decompression failed, attempting Bridge fallback:', tsErr);
      }
    }

    // 2. Fallback to Companion Bridge if local daemon is running
    if (bridgeClient.isConnected()) {
      try {
        toast('Decompressing REX2 audio via Companion Bridge...', 'info');
        const { wavBuffer, info } = await bridgeClient.decodeRx2Audio(arrayBuf, filename);
        const wavName = filename.replace(/\.(rx2|rex|rcy)$/i, '.wav');
        this.context.onRegisterSampleBuffer?.(wavName, wavBuffer);

        const decoded = decodeWav(wavBuffer);
        let mono: Float32Array;
        if (decoded.channels.length === 1) {
          mono = decoded.channels[0];
        } else {
          mono = new Float32Array(decoded.channels[0].length);
          for (let i = 0; i < mono.length; i++) {
            mono[i] = (decoded.channels[0][i] + decoded.channels[1][i]) * 0.5;
          }
        }

        this.open(mono, decoded.sampleRate, wavName, sliceFrames);
        toast(
          `Decompressed ${sliceFrames.length} slices from ${filename} (${info.channels === 2 ? 'Stereo' : 'Mono'}, ${info.sample_rate} Hz) via Bridge`,
          'success'
        );
        return;
      } catch (err) {
        console.warn('Companion Bridge REX2 decode failed, falling back to pairing dialog:', err);
      }
    }

    // 3. Fallback to pairing assistant dialog
    this.showRx2PairingAssistantModal(filename, sliceFrames, arrayBuf, parsed?.sampleRate);
  }

  public showRx2PairingAssistantModal(
    rx2Filename: string,
    sliceFrames: number[],
    rx2Buffer?: ArrayBuffer,
    detectedSampleRate: number = 44100
  ): void {
    this.closeConfirmModal();

    const modal = document.createElement('div');
    modal.className = 'nmm-modal-backdrop nmm-confirm-backdrop';
    modal.id = 'rx2-pairing-modal';
    modal.innerHTML = `
      <div class="nmm-modal-window nmm-confirm-window">
        <header class="nmm-modal-header">
          <div class="nmm-modal-header-title">
            <span class="nmm-modal-header-icon">${ICONS.wave}</span>
            <h2>REX2 Audio Pairing Assistant</h2>
          </div>
          <button type="button" class="nmm-modal-close" id="btn-rx2-pairing-close" aria-label="Close">${ICONS.close}</button>
        </header>

        <div class="nmm-modal-body nmm-audio-modal-body">
          <div class="nmm-audio-controls-card">
            <strong>Proprietary DWOP Audio Compression Detected</strong>
            <p class="nmm-audio-table-hint">
              File <code>${escHtml(rx2Filename)}</code> contains <strong>${sliceFrames.length} slice markers</strong>, but its audio uses Reason Studios' DWOP compression format which cannot be decompressed in standard browsers without the Companion Bridge.
            </p>
          </div>

          <div class="nmm-audio-controls-card">
            <strong>Option 1: Pair with Equivalent WAV / AIFF (Recommended)</strong>
            <p class="nmm-audio-table-hint">
              Select the uncompressed audio file exported alongside this loop. All ${sliceFrames.length} slice boundaries will be mapped precisely onto it.
            </p>
            <input type="file" id="inp-rx2-companion-wav" accept=".wav,.aif,.aiff,.flac" class="is-hidden-file" />
            <button type="button" class="btn btn-primary" id="btn-rx2-browse-wav">
              ${ICONS.folder} Select Companion Audio File...
            </button>
          </div>

          <div class="nmm-audio-controls-card">
            <strong>Option 2: Native Companion Bridge Decompression</strong>
            <p class="nmm-audio-table-hint">
              Start the local Python Companion Bridge (<code>python bridge/server.py</code> on port 7860). When active, REX2 files decompress automatically in the background.
            </p>
            <button type="button" class="btn btn-outline" id="btn-rx2-retry-bridge">
              ${ICONS.refresh} Check Bridge Connection &amp; Retry
            </button>
          </div>

          <div class="nmm-audio-controls-card">
            <strong>Option 3: Inspect Slices with Synthetic Impulse Preview</strong>
            <p class="nmm-audio-table-hint">
              Generate synthetic transient impulses at slice boundaries to inspect, edit, or export slice points without audio.
            </p>
            <button type="button" class="btn btn-outline" id="btn-rx2-use-synthetic">
              Open Slices in Synthetic Mode
            </button>
          </div>
        </div>

        <footer class="nmm-modal-footer">
          <div class="footer-left">
            <button type="button" class="btn btn-ghost" id="btn-rx2-pairing-cancel">Cancel</button>
          </div>
          <div class="footer-right"></div>
        </footer>
      </div>
    `;

    document.body.appendChild(modal);
    this.activeConfirmModalEl = modal;

    // Diálogo anidado fuera del backdrop: trampa propia + padre en pausa.
    // Todos los cierres pasan por closeConfirmModal(), que reanuda al padre.
    this.suspendFocusTrap();
    this.nestedTrap = createModalFocusTrap(modal, {
      initialFocusSelector: '#btn-rx2-browse-wav',
      onEscape: () => this.closeConfirmModal(),
    });
    this.nestedTrap.activate();

    modal.querySelector('#btn-rx2-pairing-close')?.addEventListener('click', () => {
      this.closeConfirmModal();
    });
    modal.querySelector('#btn-rx2-pairing-cancel')?.addEventListener('click', () => {
      this.closeConfirmModal();
    });

    const fileInp = modal.querySelector('#inp-rx2-companion-wav') as HTMLInputElement | null;
    modal.querySelector('#btn-rx2-browse-wav')?.addEventListener('click', () => {
      fileInp?.click();
    });

    fileInp?.addEventListener('change', async () => {
      const companionFile = fileInp.files?.[0];
      if (!companionFile) return;
      try {
        const cBuf = await companionFile.arrayBuffer();
        this.closeConfirmModal();
        this.openWithAudioBuffer(cBuf, companionFile.name, sliceFrames);
        toast(`Paired "${rx2Filename}" slices with audio "${companionFile.name}"!`, 'success');
      } catch (err) {
        toast(`Failed to load companion audio: ${err instanceof Error ? err.message : String(err)}`, 'error');
      }
    });

    modal.querySelector('#btn-rx2-retry-bridge')?.addEventListener('click', async () => {
      if (rx2Buffer) {
        await bridgeClient.checkHealth();
        if (bridgeClient.isConnected()) {
          this.closeConfirmModal();
          await this._handleRx2Buffer(rx2Buffer, rx2Filename, sliceFrames);
        } else {
          toast('Companion Bridge is still offline at http://127.0.0.1:7860.', 'warning');
        }
      } else {
        toast('No REX2 buffer stored to retry. Please reload the file.', 'warning');
      }
    });

    modal.querySelector('#btn-rx2-use-synthetic')?.addEventListener('click', () => {
      this.closeConfirmModal();
      const sr = detectedSampleRate || 44100;
      const maxFrame = sliceFrames.length > 0 ? Math.max(...sliceFrames) : sr;
      const totalLen = Math.max(maxFrame + 22050, Math.round(sr * 2));
      const synthPcm = new Float32Array(totalLen);
      for (const f of sliceFrames) {
        if (f < synthPcm.length) {
          synthPcm[f] = 0.8;
          if (f + 1 < synthPcm.length) synthPcm[f + 1] = -0.5;
          if (f + 2 < synthPcm.length) synthPcm[f + 2] = 0.2;
        }
      }
      this.open(synthPcm, sr, rx2Filename, sliceFrames);
      toast(`Loaded ${sliceFrames.length} REX2 slice markers with synthetic impulse waveform.`, 'info');
    });
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
    render(this.chopperCtx());
  }


  private drawWaveformCanvas(): void {
    drawWaveformCanvas(this.chopperCtx());
  }

  private drawMagnifierCanvas(): void {
    drawMagnifierCanvas(this.chopperCtx());
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

    this.registerManualBoundary(newF, currentF);

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

    this.registerManualBoundary(snapped, currentF);

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
    updateMagnifierHeader(this.chopperCtx());
  }

  private refreshTable(): void {
    refreshTable(this.chopperCtx());
  }

  private closeContextMenu(): void {
    closeContextMenu(this.chopperCtx());
  }

  private showContextMenu(x: number, y: number, items: ContextMenuItem[]): void {
    showContextMenu(this.chopperCtx(), x, y, items);
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

    this.backdropEl.querySelector('#btn-chopper-whisper-align')?.addEventListener('click', () => {
      void this.runWhisperVocalAlignment();
    });
    this.backdropEl.querySelector('#btn-chopper-demucs-split')?.addEventListener('click', () => {
      this.showStemSeparationModal();
    });

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

    // Mode Switching with Manual Cuts Guard
    const switchMode = (newMode: SlicerMode, defaultMinSlice?: number) => {
      if (this.options.mode === newMode) return;
      if (this.hasManualCuts() && this.manualCutsPolicy === 'prompt') {
        this.showManualCutsConfirmationModal(
          `You are switching <strong>Slicing Mode</strong> to <strong>${newMode.toUpperCase()}</strong>.`,
          () => {
            this.options.mode = newMode;
            if (defaultMinSlice !== undefined) this.options.minSliceMs = defaultMinSlice;
            this.recomputeSlices(false);
            this.render();
            toast(`Mode switched to ${newMode}: manual cuts preserved.`, 'success');
          },
          () => {
            this.options.mode = newMode;
            if (defaultMinSlice !== undefined) this.options.minSliceMs = defaultMinSlice;
            this.manualCutFrames.clear();
            this.manualSilenceRanges = [];
            this.recomputeSlices(true);
            this.render();
            toast(`Mode switched to ${newMode}: reset to auto.`, 'info');
          },
          () => {
            // Cancelled: leave mode unchanged
          }
        );
        return;
      }
      this.options.mode = newMode;
      if (defaultMinSlice !== undefined) this.options.minSliceMs = defaultMinSlice;
      this.recomputeSlices(this.manualCutsPolicy === 'discard');
      this.render();
    };

    const switchWorkflowMode = (newWf: SlicerWorkflowMode) => {
      if ((this.options.workflowMode ?? 'rex_groove_loop') === newWf) return;
      this.options.workflowMode = newWf;
      this.recomputeSlices(false);
      this.render();
      toast(
        newWf === 'one_shot_extractor'
          ? 'Modo 1 activado: Cortar y Mapear One-Shots (Cromático o Caja de Ritmos nota a nota).'
          : 'Modo 2 activado: Bucle Rítmico / Melodía tipo REX (BPM, Groove MIDI y Conformador de Tempo).',
        'info'
      );
    };

    this.backdropEl.querySelector('#btn-wf-oneshot')?.addEventListener('click', () => {
      switchWorkflowMode('one_shot_extractor');
    });
    this.backdropEl.querySelector('#btn-wf-rex')?.addEventListener('click', () => {
      switchWorkflowMode('rex_groove_loop');
    });

    const inpBars = this.backdropEl.querySelector<HTMLInputElement>('#inp-chopper-bars');
    inpBars?.addEventListener('change', () => {
      const bars = Math.max(1, Math.min(64, parseInt(inpBars.value, 10) || 2));
      this.options.barCount = bars;
      this.recomputeSlices(false);
      this.render();
    });

    const inpTargetBpm = this.backdropEl.querySelector<HTMLInputElement>('#inp-chopper-target-bpm');
    inpTargetBpm?.addEventListener('change', () => {
      const bpm = Math.max(20, Math.min(300, parseFloat(inpTargetBpm.value) || 120));
      this.options.targetBpm = bpm;
      this.recomputeSlices(false);
      this.render();
      toast(`Target BPM ajustado a ${bpm} BPM (transitorios de 25 ms bloqueados).`, 'info');
    });

    this.backdropEl.querySelector('#btn-chopper-play-conformed')?.addEventListener('click', () => {
      this.auditionConformedLoop();
    });

    this.backdropEl.querySelector('#btn-mode-drums')?.addEventListener('click', () => switchMode('drums', 45));
    this.backdropEl.querySelector('#btn-mode-vocals')?.addEventListener('click', () => switchMode('vocals', 250));
    this.backdropEl.querySelector('#btn-mode-chromatic')?.addEventListener('click', () => switchMode('chromatic'));
    this.backdropEl.querySelector('#btn-mode-grid')?.addEventListener('click', () => switchMode('grid'));

    // Sensitivity Slider with Manual Cuts Protection
    const rngSens = this.backdropEl.querySelector('#rng-sens') as HTMLInputElement | null;
    let prevSensVal = this.options.sensitivity;

    rngSens?.addEventListener('input', () => {
      const newSens = parseInt(rngSens.value, 10);
      if (newSens === this.options.sensitivity) return;

      if (this.hasManualCuts()) {
        if (this.manualCutsPolicy === 'prompt') {
          this.showManualCutsConfirmationModal(
            `You are changing <strong>Transient Sensitivity</strong> from ${this.options.sensitivity}% to ${newSens}%.`,
            () => {
              this.options.sensitivity = newSens;
              prevSensVal = newSens;
              const lbl = this.backdropEl?.querySelector('#lbl-sens-val');
              if (lbl) lbl.textContent = `${this.options.sensitivity}%`;
              this.recomputeSlices(false);
              this.render();
              toast(`Sensitivity set to ${newSens}%: preserved ${this.manualCutFrames.size} manual cut(s).`, 'success');
            },
            () => {
              this.options.sensitivity = newSens;
              prevSensVal = newSens;
              this.manualCutFrames.clear();
              this.manualSilenceRanges = [];
              const lbl = this.backdropEl?.querySelector('#lbl-sens-val');
              if (lbl) lbl.textContent = `${this.options.sensitivity}%`;
              this.recomputeSlices(true);
              this.render();
              toast(`Sensitivity set to ${newSens}%: reset to automatic transient detection.`, 'info');
            },
            () => {
              rngSens.value = String(prevSensVal);
              const lbl = this.backdropEl?.querySelector('#lbl-sens-val');
              if (lbl) lbl.textContent = `${prevSensVal}%`;
            }
          );
          return;
        } else if (this.manualCutsPolicy === 'keep') {
          this.options.sensitivity = newSens;
          prevSensVal = newSens;
          const lbl = this.backdropEl?.querySelector('#lbl-sens-val');
          if (lbl) lbl.textContent = `${this.options.sensitivity}%`;
          this.recomputeSlices(false);
          this.drawWaveformCanvas();
          this.drawMagnifierCanvas();
          this.refreshTable();
          return;
        }
      }

      this.options.sensitivity = newSens;
      prevSensVal = newSens;
      const lbl = this.backdropEl?.querySelector('#lbl-sens-val');
      if (lbl) lbl.textContent = `${this.options.sensitivity}%`;
      this.recomputeSlices(this.manualCutsPolicy === 'discard');
      this.render();
    });

    // Silence Gate Slider with Manual Cuts Protection
    const rngSilence = this.backdropEl.querySelector('#rng-silence') as HTMLInputElement | null;
    let prevSilenceVal = this.options.silenceThresholdDb;

    rngSilence?.addEventListener('input', () => {
      const newSilence = parseInt(rngSilence.value, 10);
      if (newSilence === this.options.silenceThresholdDb) return;

      if (this.hasManualCuts()) {
        if (this.manualCutsPolicy === 'prompt') {
          this.showManualCutsConfirmationModal(
            `You are changing <strong>Silence Gate Threshold</strong> from ${this.options.silenceThresholdDb} dB to ${newSilence} dB.`,
            () => {
              this.options.silenceThresholdDb = newSilence;
              prevSilenceVal = newSilence;
              const lbl = this.backdropEl?.querySelector('#lbl-silence-val');
              if (lbl) lbl.textContent = `${this.options.silenceThresholdDb} dB`;
              this.recomputeSlices(false);
              this.render();
              toast(`Silence gate set to ${newSilence} dB: preserved manual edits.`, 'success');
            },
            () => {
              this.options.silenceThresholdDb = newSilence;
              prevSilenceVal = newSilence;
              this.manualCutFrames.clear();
              this.manualSilenceRanges = [];
              const lbl = this.backdropEl?.querySelector('#lbl-silence-val');
              if (lbl) lbl.textContent = `${this.options.silenceThresholdDb} dB`;
              this.recomputeSlices(true);
              this.render();
              toast(`Silence gate set to ${newSilence} dB: reset to auto.`, 'info');
            },
            () => {
              rngSilence.value = String(prevSilenceVal);
              const lbl = this.backdropEl?.querySelector('#lbl-silence-val');
              if (lbl) lbl.textContent = `${prevSilenceVal} dB`;
            }
          );
          return;
        } else if (this.manualCutsPolicy === 'keep') {
          this.options.silenceThresholdDb = newSilence;
          prevSilenceVal = newSilence;
          const lbl = this.backdropEl?.querySelector('#lbl-silence-val');
          if (lbl) lbl.textContent = `${this.options.silenceThresholdDb} dB`;
          this.recomputeSlices(false);
          this.drawWaveformCanvas();
          this.drawMagnifierCanvas();
          this.refreshTable();
          return;
        }
      }

      this.options.silenceThresholdDb = newSilence;
      prevSilenceVal = newSilence;
      const lbl = this.backdropEl?.querySelector('#lbl-silence-val');
      if (lbl) lbl.textContent = `${this.options.silenceThresholdDb} dB`;
      this.recomputeSlices(this.manualCutsPolicy === 'discard');
      this.render();
    });

    // Detect Silences Toggle (inserts cuts around silent intervals >= minSilenceMs and mutes them so they do not go to the zone matrix)
    this.backdropEl.querySelector('#btn-toggle-silence-detect')?.addEventListener('click', () => {
      this.options.detectSilences = this.options.detectSilences === false;
      this.recomputeSlices(false);
      this.render();
      const n = this.currentResult?.silenceSlicesCount ?? 0;
      toast(
        this.options.detectSilences === false
          ? 'Silence detection OFF: all slices active.'
          : `Silence detection ON: ${n} silent interval(s) cut and muted (excluded from Zone Matrix).`,
        'info'
      );
    });

    // Min Silence Duration Input (flags only: boundaries never move, manuals preserved)
    const inpMinSilence = this.backdropEl.querySelector('#inp-minsilence') as HTMLInputElement | null;
    inpMinSilence?.addEventListener('change', () => {
      const v = parseInt(inpMinSilence.value, 10);
      this.options.minSilenceMs = Number.isFinite(v) ? Math.max(0, Math.min(2000, v)) : 120;
      this.recomputeSlices(false);
      this.render();
    });

    // Peak Normalize Toggle (gain only: boundaries and manual frames never move)
    this.backdropEl.querySelector('#btn-toggle-normalize')?.addEventListener('click', () => {
      if (!this.sourcePcm || this.sourcePcm.length === 0) {
        toast('Load audio before toggling Normalize.', 'warning');
        return;
      }
      this.normalizeEnabled = !this.normalizeEnabled;
      if (this.normalizeEnabled) {
        const { pcm, appliedGainDb, inputPeakDb } = normalizePeakPcm(this.sourcePcm);
        this.pcm = pcm;
        this.recomputeSlices(false);
        this.render();
        toast(`Normalized to -1 dBFS: ${appliedGainDb >= 0 ? '+' : ''}${appliedGainDb.toFixed(1)} dB (was ${inputPeakDb.toFixed(1)} dBFS).`, 'success');
      } else {
        this.pcm = this.sourcePcm;
        this.recomputeSlices(false);
        this.render();
        toast('Normalize OFF: back to original levels.', 'info');
      }
    });

    // Reset Manual Cuts to Full Auto
    this.backdropEl.querySelector('#btn-reset-cuts-auto')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.manualCutFrames.clear();
      this.manualSilenceRanges = [];
      this.manualCutsPolicy = 'prompt';
      this.recomputeSlices(true);
      this.render();
      toast('Reset all slices to automatic transient detection.', 'info');
    });

    // Min Slice Ms Input
    const inpMinSlice = this.backdropEl.querySelector('#inp-minslice') as HTMLInputElement | null;
    inpMinSlice?.addEventListener('change', () => {
      this.options.minSliceMs = Math.max(10, parseInt(inpMinSlice.value, 10) || 45);
      this.recomputeSlices(this.manualCutsPolicy === 'discard');
      this.render();
    });

    // Pre-roll Input
    const inpPreroll = this.backdropEl.querySelector('#inp-preroll') as HTMLInputElement | null;
    inpPreroll?.addEventListener('change', () => {
      this.options.preRollMs = Math.max(0, parseInt(inpPreroll.value, 10) || 0);
      this.recomputeSlices(this.manualCutsPolicy === 'discard');
      this.render();
    });

    // Toggles
    this.backdropEl.querySelector('#btn-toggle-zc-snap')?.addEventListener('click', () => {
      this.options.snapZeroCrossing = !this.options.snapZeroCrossing;
      this.recomputeSlices(this.manualCutsPolicy === 'discard');
      this.render();
    });
    this.backdropEl.querySelector('#btn-toggle-overlap')?.addEventListener('click', () => {
      this.options.allowOverlap = !this.options.allowOverlap;
      this.recomputeSlices(this.manualCutsPolicy === 'discard');
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

    this.backdropEl.querySelector('#btn-chopper-play-full')?.addEventListener('click', () => {
      this.auditionFullWav();
    });

    this.backdropEl.querySelector('#btn-mag-play-full')?.addEventListener('click', () => {
      this.auditionFullWav();
    });

    this.backdropEl.querySelector('#btn-mag-play-slice')?.addEventListener('click', () => {
      const sl = this.currentResult?.slices.find((s) => s.id === this.selectedSliceId) || this.currentResult?.slices[0];
      if (sl) this.auditionSlice(sl, true);
    });

    this.backdropEl.querySelector('#btn-mag-toggle-silence')?.addEventListener('click', () => {
      if (this.selectedSliceId && this.currentResult) {
        this.handleToggleSliceSilence(this.selectedSliceId);
      }
    });

    this.backdropEl.querySelector('#btn-mag-del-boundary')?.addEventListener('click', () => {
      if (this.currentResult) {
        const boundaries = extractBoundaryFrames(this.currentResult, this.pcm.length);
        if (boundaries.length <= 2) return;
        const bIdx = clamp(this.activeBoundaryIndex, 1, boundaries.length - 2);
        const bFrame = boundaries[bIdx];
        this.removeManualBoundary(bFrame);

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
        downloadBlob(blob, `${(this.sourceFilename || 'sliced_audio').replace(/\.[^/.]+$/, '')}_slices.mid`);
        toast('Downloaded Standard MIDI pattern for sliced audio.', 'success');
      });
    }

    // Inject Conformed Loop at Target BPM Action
    this.backdropEl.querySelector('#btn-chopper-inject-loop')?.addEventListener('click', () => {
      this.handleInjectConformedLoopIntoSession();
    });

    // Inject Zones Action
    this.backdropEl.querySelector('#btn-chopper-inject')?.addEventListener('click', () => {
      this.handleInjectSlicesIntoSession();
    });

    // Fase 30 & 35.6: DSP Denoise button (recomputes auto slices or asks if manual cuts exist)
    this.backdropEl.querySelector('#btn-chopper-dsp-denoise')?.addEventListener('click', async () => {
      if (this.pcm.length === 0) return;
      try {
        const profile = this.capturedNoiseProfile || {
          levelDbfs: -48,
          spectrumBands: new Array(16).fill(1 / 16),
          hum50HzDb: -80,
          hum60HzDb: -80,
        };
        const cleaned = reduceNoiseWithProfile(this.pcm, this.sampleRate, profile, {
          reductionDb: 15,
          removeHum: true,
        });
        this.pcm = cleaned;
        await this.reconcileSlicesAfterAudioClean('Cleaned audio using DSP Spectral Gate');
      } catch (err) {
        toast(`DSP Denoise failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
      }
    });

    // Fase 30, 35.4 & 35.6: AI Enhance button passing captured noise profile to bridge (with explicit fallback consent & manual-cuts check)
    this.backdropEl.querySelector('#btn-chopper-ai-enhance')?.addEventListener('click', async () => {
      if (this.pcm.length === 0) return;
      if (!bridgeClient.isConnected()) {
        await bridgeClient.checkHealth();
      }
      const decl = resolveAiActionDeclaration('chopper-bwe-enhance', {
        isBridgeConnected: bridgeClient.isConnected(),
      });
      if (decl.requiresFallbackConsent) {
        const ok = await confirmDialog(decl.consentMessage, {
          title: decl.consentTitle,
          confirmLabel: decl.consentConfirmLabel,
          cancelLabel: 'Cancelar',
        });
        if (!ok) return;
        const profile = this.capturedNoiseProfile || {
          levelDbfs: -48,
          spectrumBands: new Array(16).fill(1 / 16),
          hum50HzDb: -80,
          hum60HzDb: -80,
        };
        this.pcm = reduceNoiseWithProfile(this.pcm, this.sampleRate, profile, {
          reductionDb: 15,
          removeHum: true,
        });
        await this.reconcileSlicesAfterAudioClean(
          `Aplicada ${decl.fallbackEngine} (confirmado por el usuario)`
        );
        return;
      }

      try {
        const wavBytes = encodePcm16Wav(this.pcm, this.sampleRate);
        toast('Sending audio to AI Bridge with noise profile removal...', 'info');
        const enhancedBytes = await bridgeClient.enhanceAudio(wavBytes, {
          targetSampleRate: 96000,
          capabilities: ['resample-96k', 'harmonic-bwe', 'spectral-denoise'],
          noiseProfile: this.capturedNoiseProfile || undefined,
        });
        const decoded = decodeWav(
          enhancedBytes.buffer.slice(
            enhancedBytes.byteOffset,
            enhancedBytes.byteOffset + enhancedBytes.byteLength
          ) as ArrayBuffer
        );
        const oldRate = this.sampleRate;
        this.pcm = decoded.mono || decoded.channels[0];
        this.sampleRate = decoded.sampleRate;
        if (oldRate > 0 && this.sampleRate !== oldRate && this.hasManualCuts()) {
          const ratio = this.sampleRate / oldRate;
          const rescaled = new Set<number>();
          for (const mf of this.manualCutFrames) {
            rescaled.add(Math.round(mf * ratio));
          }
          this.manualCutFrames = rescaled;
          this.manualSilenceRanges = this.manualSilenceRanges.map((r) => ({
            start: Math.round(r.start * ratio),
            end: Math.round(r.end * ratio),
          }));
        }
        await this.reconcileSlicesAfterAudioClean(
          'Audio enhanced via Bridge AI with noise profile removed!'
        );
      } catch (err) {
        toast(`AI Enhance failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
      }
    });
  }

  private bindCanvasInteraction(): void {
    bindCanvasInteraction(this.chopperCtx());
  }

  private bindMagnifierInteraction(): void {
    bindMagnifierInteraction(this.chopperCtx());
  }

  private bindTableEvents(): void {
    bindTableEvents(this.chopperCtx());
  }

  private auditionSlice(sl: DetectedSlice, toggleStopIfSame: boolean = false): void {
    auditionSlice(this.chopperCtx(), sl, toggleStopIfSame);
  }

  private auditionFullWav(): void {
    auditionFullWav(this.chopperCtx());
  }

  private auditionConformedLoop(): void {
    auditionConformedLoop(this.chopperCtx());
  }



  private handleInjectConformedLoopIntoSession(): void {
    const res = this.currentResult;
    if (!res || this.pcm.length === 0) return;

    const validSlices = res.slices.filter((s) => !s.isSilence);
    if (validSlices.length === 0) {
      toast('No valid slices to conform into a loop.', 'warning');
      return;
    }

    const sourceBpm = res.detectedBpm || this.options.bpm || 120;
    const targetBpm = this.options.targetBpm ?? res.targetBpm ?? sourceBpm;
    const barCount = res.detectedBars ?? this.options.barCount ?? 2;

    const conformed = conformLoopToTargetBpm(
      this.pcm,
      this.sampleRate,
      res.slices,
      sourceBpm,
      targetBpm,
      { barCount }
    );

    const isExtended = this.context.getCurrentWorkingMode() === 'extended';
    const baseName = (this.sourceFilename || 'loop').replace(/\.[^/.]+$/, '');
    const loopWavName = `${baseName}_loop_${Math.round(targetBpm)}bpm.wav`;
    const rootKey = this.options.mode === 'chromatic' ? (validSlices[0]?.rootKey ?? 60) : 60;
    const wavBuffer = encodePcm16Wav(conformed.pcm, this.sampleRate, {
      rootKey,
      lowKey: 0,
      highKey: 127,
      loopStart: 0,
      loopEnd: Math.max(0, conformed.pcm.length - 1),
    });

    const audioSamples = [{ name: loopWavName, buffer: wavBuffer }];

    // Persist Tempo-Sync contract metadata for the ABDAxionikVS Resinator v2
    this.context.onUpdateTempoSync?.({
      enabled: true,
      sourceBpm: targetBpm,
      targetBpm,
      barCount,
      timeSignature: [4, 4],
      grooveMode: this.options.mode === 'chromatic' ? 'melodic_phrase' : 'rex_loop',
      sliceCount: validSlices.length,
    });

    if (isExtended) {
      const region: ExtendedRegion = {
        id: `reg_loop_${Date.now()}`,
        sampleName: loopWavName,
        rootKey,
        lowKey: 0,
        highKey: 127,
        lowVel: 1,
        highVel: 127,
        detune: 0,
        volume: 0,
        pan: 0,
        pitchKeytrack: this.options.mode === 'drums' ? 0 : 100,
        trigger: 'attack',
        keyFadeIn: 0,
        keyFadeOut: 0,
        velFadeIn: 0,
        velFadeOut: 0,
        fadeCurve: 'equal-power',
        loopMode: 'loop_continuous',
        loopStart: 0,
        loopEnd: conformed.pcm.length,
        loopCrossfadeMs: 5,
        sampleRate: this.sampleRate,
        numChannels: 1,
      };
      this.context.onInjectExtendedRegions?.([region], audioSamples);
      toast(
        `Inyectado Loop Continuo conformado a ${targetBpm} BPM (${barCount} compases) + Tempo-Sync activo para Resinator v2.`,
        'success'
      );
    } else {
      const zone: Zone = {
        id: `zone_loop_${Date.now()}`,
        rootKey,
        lowKey: 0,
        highKey: 127,
        sampleLow: loopWavName,
        sampleHigh: null,
        velSplit: 64,
        detune: 0,
        volume: 0,
        pan: 0,
      };
      this.context.onInjectClassicZones?.([zone], audioSamples);
      toast(`Inyectado Loop Continuo conformado a ${targetBpm} BPM en sesión Classic.`, 'success');
    }

    this.close();
  }

  private handleInjectSlicesIntoSession(): void {
    const res = this.currentResult;
    if (!res) return;

    const validSlices = res.slices.filter((s) => !s.isSilence);
    if (validSlices.length === 0) {
      toast('No valid slices to inject into session.', 'warning');
      return;
    }

    // If in REX / Groove Loop workflow, also store Tempo-Sync metadata in ProcessConfig
    if ((this.options.workflowMode ?? 'rex_groove_loop') === 'rex_groove_loop') {
      const sourceBpm = res.detectedBpm || this.options.bpm || 120;
      const targetBpm = this.options.targetBpm ?? res.targetBpm ?? sourceBpm;
      const barCount = res.detectedBars ?? this.options.barCount ?? 2;
      this.context.onUpdateTempoSync?.({
        enabled: true,
        sourceBpm,
        targetBpm,
        barCount,
        timeSignature: [4, 4],
        grooveMode: this.options.mode === 'chromatic' ? 'melodic_phrase' : 'sliced_kit',
        sliceCount: validSlices.length,
      });
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

  private async runWhisperVocalAlignment(): Promise<void> {
    if (this.pcm.length === 0) {
      toast('Please load or drop an audio file before aligning vocal phonemes.', 'warning');
      return;
    }

    if (!bridgeClient.isConnected()) {
      await bridgeClient.checkHealth();
    }
    const decl = resolveAiActionDeclaration('chopper-whisper-align', {
      isBridgeConnected: bridgeClient.isConnected(),
    });
    if (decl.requiresFallbackConsent) {
      const ok = await confirmDialog(decl.consentMessage, {
        title: decl.consentTitle,
        confirmLabel: decl.consentConfirmLabel,
        cancelLabel: 'Cancelar',
      });
      if (!ok) return;
      this.options.mode = 'vocals';
      this.manualSilenceRanges = [];
      this.manualCutFrames.clear();
      this.recomputeSlices(true);
      this.render();
      toast(`Aplicada ${decl.fallbackEngine} (confirmado por el usuario).`, 'success');
      return;
    }

    const btn = this.backdropEl?.querySelector('#btn-chopper-whisper-align') as HTMLButtonElement | null;
    if (btn) btn.disabled = true;

    toast('Analyzing vocal phonemes with Whisper-tiny...', 'info');

    try {
      const wavBuf = encodePcm16Wav(this.pcm, this.sampleRate);
      const res = await bridgeClient.alignPhonemes(wavBuf);

      if (!res.success || !res.words || res.words.length === 0) {
        toast(`Whisper alignment: ${res.error || 'No distinct vocal phonemes or words detected in audio.'}`, 'warning');
        return;
      }

      this.options.mode = 'vocals';
      this.manualSilenceRanges = [];
      this.manualCutsPolicy = 'prompt';

      this.currentResult = buildSlicesFromPhoneticWords(
        this.pcm,
        this.sampleRate,
        res.words,
        this.options
      );

      this.manualCutFrames = new Set(
        this.currentResult.slices
          .map((s) => s.startFrame)
          .filter((f) => f > 0 && f < this.pcm.length)
      );

      this.selectedSliceId = this.currentResult.slices[0]?.id ?? null;
      this.activeBoundaryIndex = 1;

      this.render();
      toast(
        `Aligned ${res.words.length} vocal segments via Whisper-tiny (${((res.durationSec ?? 0) * 1000).toFixed(0)}ms total)!`,
        'success'
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`Whisper alignment error: ${msg}`, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  private showStemSeparationModal(): void {
    if (this.pcm.length === 0) {
      toast('Please load an audio file first before separating stems.', 'warning');
      return;
    }

    const modal = document.createElement('div');
    modal.className = 'nmm-modal-backdrop nmm-stem-split-backdrop';
    modal.innerHTML = `
      <div class="nmm-modal-window nmm-confirm-window">
        <header class="nmm-modal-header">
          <div class="nmm-modal-header-title">
            <span class="nmm-modal-header-icon">${ICONS.wave}</span>
            <h2>Demucs AI Stem Separation</h2>
          </div>
          <button type="button" class="nmm-modal-close" id="btn-stem-close" aria-label="Close">${ICONS.close}</button>
        </header>
        <div class="nmm-modal-body nmm-audio-modal-body">
          <p>
            Isolate vocal lines or instrument stems using Demucs neural stem separation (or high-fidelity Mid/Side DSP fallback) before slicing.
          </p>
          <div class="nmm-audio-controls-card">
            <div class="nmm-audio-table-title">Stems to Separate:</div>
            <div class="nmm-audio-params-grid">
              <label class="batch-check">
                <input type="checkbox" class="articulation-checkbox switch--sm" id="chk-stem-vocals" checked />
                <span>Vocals (Acapella)</span>
              </label>
              <label class="batch-check">
                <input type="checkbox" class="articulation-checkbox switch--sm" id="chk-stem-drums" checked />
                <span>Drums (Percussion)</span>
              </label>
              <label class="batch-check">
                <input type="checkbox" class="articulation-checkbox switch--sm" id="chk-stem-bass" checked />
                <span>Bass (Low-End)</span>
              </label>
              <label class="batch-check">
                <input type="checkbox" class="articulation-checkbox switch--sm" id="chk-stem-instrumental" checked />
                <span>Instrumental (Other)</span>
              </label>
            </div>
          </div>
          <div id="stem-results-container" class="nmm-audio-table-panel is-hidden">
            <div class="nmm-audio-table-title">Separated Audio Stems:</div>
            <div id="stem-buttons-list" class="nmm-recorder-takes"></div>
          </div>
          <div id="stem-processing-indicator" class="nmm-audio-table-hint is-hidden">
            <span>Running Demucs stem separation via Companion Bridge...</span>
          </div>
        </div>
        <footer class="nmm-modal-footer">
          <div class="footer-left">
            <button type="button" class="btn btn-ghost" id="btn-stem-cancel">Close</button>
          </div>
          <div class="footer-right">
            <button type="button" class="btn btn-primary" id="btn-stem-run">${ICONS.sparkle} Run Separation</button>
          </div>
        </footer>
      </div>
    `;

    document.body.appendChild(modal);

    const closeModal = () => {
      if (this.nestedTrap) {
        this.nestedTrap.deactivate();
        this.nestedTrap = null;
      }
      modal.remove();
      this.resumeFocusTrap();
    };

    // Diálogo anidado fuera del backdrop: trampa propia + padre en pausa.
    this.suspendFocusTrap();
    this.nestedTrap = createModalFocusTrap(modal, {
      initialFocusSelector: '#btn-stem-run',
      onEscape: () => closeModal(),
    });
    this.nestedTrap.activate();

    modal.querySelector('#btn-stem-close')?.addEventListener('click', closeModal);
    modal.querySelector('#btn-stem-cancel')?.addEventListener('click', closeModal);

    const runBtn = modal.querySelector('#btn-stem-run') as HTMLButtonElement | null;
    const processingEl = modal.querySelector('#stem-processing-indicator') as HTMLElement | null;
    const resultsContainer = modal.querySelector('#stem-results-container') as HTMLElement | null;
    const listEl = modal.querySelector('#stem-buttons-list') as HTMLElement | null;

    runBtn?.addEventListener('click', async () => {
      const stems: string[] = [];
      if ((modal.querySelector('#chk-stem-vocals') as HTMLInputElement)?.checked) stems.push('vocals');
      if ((modal.querySelector('#chk-stem-drums') as HTMLInputElement)?.checked) stems.push('drums');
      if ((modal.querySelector('#chk-stem-bass') as HTMLInputElement)?.checked) stems.push('bass');
      if ((modal.querySelector('#chk-stem-instrumental') as HTMLInputElement)?.checked) stems.push('instrumental');

      if (stems.length === 0) {
        toast('Select at least one stem to separate.', 'warning');
        return;
      }

      if (!bridgeClient.isConnected()) {
        await bridgeClient.checkHealth();
      }
      const decl = resolveAiActionDeclaration('chopper-demucs-split', {
        isBridgeConnected: bridgeClient.isConnected(),
      });

      const renderStemRows = (stemMap: Record<string, ArrayBuffer>, usedLabel: string) => {
        if (resultsContainer && listEl) {
          resultsContainer.classList.remove('is-hidden');
          listEl.innerHTML = '';

          const stemEntries = Object.entries(stemMap);
          if (stemEntries.length === 0) {
            listEl.innerHTML = '<div class="nmm-recorder-takes-empty">No stems were returned.</div>';
          }

          for (const [name, buf] of stemEntries) {
            const row = document.createElement('div');
            row.className = 'nmm-recorder-take';

            const label = document.createElement('span');
            label.className = 'nmm-recorder-take-name';
            label.textContent = `${name} (${(buf.byteLength / 1024).toFixed(1)} KB)`;

            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'nmm-recorder-take-actions';

            const loadBtn = document.createElement('button');
            loadBtn.type = 'button';
            loadBtn.className = 'btn btn-xs btn-primary';
            loadBtn.textContent = 'Load into Slicer';
            loadBtn.addEventListener('click', () => {
              try {
                const decoded = decodeWav(buf);
                this.pcm = decoded.mono || decoded.channels[0];
                this.sampleRate = decoded.sampleRate;
                const baseName = (this.sourceFilename || 'audio').replace(/\.[^/.]+$/, '');
                this.sourceFilename = `${baseName}_${name}.wav`;
                this.context.onRegisterSampleBuffer?.(this.sourceFilename, buf);
                this.recomputeSlices(true);
                this.render();
                closeModal();
                toast(`Loaded "${name}" stem into Audio Chopper!`, 'success');
              } catch (e: unknown) {
                const errStr = e instanceof Error ? e.message : String(e);
                toast(`Failed to load stem: ${errStr}`, 'error');
              }
            });

            actionsDiv.appendChild(loadBtn);
            row.appendChild(label);
            row.appendChild(actionsDiv);
            listEl.appendChild(row);
          }
        }
        toast(usedLabel, 'success');
      };

      if (decl.requiresFallbackConsent) {
        const ok = await confirmDialog(decl.consentMessage, {
          title: decl.consentTitle,
          confirmLabel: decl.consentConfirmLabel,
          cancelLabel: 'Cancelar',
        });
        if (!ok) return;
        const fallbackStems = separateStemsDspFallback(
          this.pcm,
          this.sampleRate,
          stems,
          (samples, sr) => encodePcm16Wav(samples, sr)
        );
        renderStemRows(fallbackStems, `Stems separados con ${decl.fallbackEngine} (confirmado por el usuario).`);
        return;
      }

      if (runBtn) runBtn.disabled = true;
      if (processingEl) processingEl.classList.remove('is-hidden');

      try {
        const wavBuf = encodePcm16Wav(this.pcm, this.sampleRate);
        const res = await bridgeClient.separateStems(wavBuf, { stems });

        if (!res.success) {
          toast(`Demucs separation failed: ${res.error || 'Unknown error'}`, 'error');
          return;
        }

        renderStemRows(res.stems, 'Stem separation completed successfully via HTDemucs Bridge!');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        toast(`Stem separation error: ${msg}`, 'error');
      } finally {
        if (runBtn) runBtn.disabled = false;
        if (processingEl) processingEl.classList.add('is-hidden');
      }
    });
  }
}
