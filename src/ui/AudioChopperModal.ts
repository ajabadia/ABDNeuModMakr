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

import type { NoiseProfile } from '../../vendor/@abdsynths/shared/Code/DspCore/TakeDsp/index.ts';
import { sliceAudioBuffer, sliceAudioBufferPreservingManualCuts, moveSliceBoundary, toggleSliceSilence, extractBoundaryFrames, DEFAULT_SLICER_OPTIONS, deleteSlice } from '../core/dsp/AudioSlicerEngine.ts';
import { clamp } from '../core/dsp/DspMath.ts';
import { snapFrameToNearestZeroCrossing } from '../core/dsp/LoopEditorTools.ts';
import { onAppLocaleChange } from '../core/i18n.ts';
import type { Zone, ExtendedRegion, WorkingMode, UnifiedSurfaceUiConfig } from '../core/types.ts';
import { unbindChopperKeyboard } from './chopper/a11yKeyboard.ts';
import { bindChopperActionEvents } from './chopper/actionEventOps.ts';
import { auditionConformedLoop, auditionFullWav, auditionSlice } from './chopper/auditionOps.ts';
import { bindChopperDetectControlsEvents, bindChopperFileEvents } from './chopper/bindEventsOps.ts';
import { drawMagnifierCanvas, drawWaveformCanvas } from './chopper/canvasOps.ts';
import { bindCanvasInteraction, bindMagnifierInteraction, bindTableEvents, closeContextMenu, showContextMenu } from './chopper/eventsOps.ts';
import { refreshTable, render, updateMagnifierHeader } from './chopper/renderOps.ts';
import type { ChopperContext } from './chopper/types.ts';
import type { FocusTrap } from './modalFocusTrap.ts';
import { toast } from './notify.ts';
import type { DetectedSlice, SlicerOptions, SlicerResult, ManualSilenceRange } from '@abdsynths/shared/contracts/types/loopSlicer.ts';
import {
  loadAudioFile,
  importSliceMarkersFile,
  loadTestDemoBeat,
  open,
  openWithAudioBuffer,
  showRx2PairingAssistantModal,
} from './chopper/chopperFileOps.ts';
import {
  closeConfirmModal,
  handleInjectConformedLoopIntoSession,
  handleInjectSlicesIntoSession,
  reconcileSlicesAfterAudioClean,
  resumeFocusTrap,
  runWhisperVocalAlignment,
  showManualCutsConfirmationModal,
  showStemSeparationModal,
  suspendFocusTrap,
} from './chopper/chopperSessionOps.ts';

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
      get backdropEl() { return host.backdropEl; },
      set backdropEl(v) { host.backdropEl = v; },
      get canvas() { return host.canvas; },
      set canvas(v) { host.canvas = v; },
      get magnifierCanvas() { return host.magnifierCanvas; },
      set magnifierCanvas(v) { host.magnifierCanvas = v; },
      get pcm() { return host.pcm; },
      set pcm(v) { host.pcm = v; },
      get zoomFactor() { return host.zoomFactor; },
      set zoomFactor(v) { host.zoomFactor = v; },
      get viewCenterNorm() { return host.viewCenterNorm; },
      set viewCenterNorm(v) { host.viewCenterNorm = v; },
      get currentResult() { return host.currentResult; },
      set currentResult(v) { host.currentResult = v; },
      get selectedSliceId() { return host.selectedSliceId; },
      set selectedSliceId(v) { host.selectedSliceId = v; },
      get hoveredBoundaryIndex() { return host.hoveredBoundaryIndex; },
      set hoveredBoundaryIndex(v) { host.hoveredBoundaryIndex = v; },
      get draggedBoundaryIndex() { return host.draggedBoundaryIndex; },
      set draggedBoundaryIndex(v) { host.draggedBoundaryIndex = v; },
      get activeBoundaryIndex() { return host.activeBoundaryIndex; },
      set activeBoundaryIndex(v) { host.activeBoundaryIndex = v; },
      get isDraggingMagnifier() { return host.isDraggingMagnifier; },
      set isDraggingMagnifier(v) { host.isDraggingMagnifier = v; },
      get context() { return host.context; },
      set context(v) { host.context = v; },
      get options() { return host.options; },
      set options(v) { host.options = v; },
      get sourceFilename() { return host.sourceFilename; },
      set sourceFilename(v) { host.sourceFilename = v; },
      get sampleRate() { return host.sampleRate; },
      set sampleRate(v) { host.sampleRate = v; },
      get playingSliceId() { return host.playingSliceId; },
      set playingSliceId(v) { host.playingSliceId = v; },
      get normalizeEnabled() { return host.normalizeEnabled; },
      set normalizeEnabled(v) { host.normalizeEnabled = v; },
      get manualCutFrames() { return host.manualCutFrames; },
      set manualCutFrames(v) { host.manualCutFrames = v; },
      get isDraggingBoundary() { return host.isDraggingBoundary; },
      set isDraggingBoundary(v) { host.isDraggingBoundary = v; },
      get magDragStartMouseX() { return host.magDragStartMouseX; },
      set magDragStartMouseX(v) { host.magDragStartMouseX = v; },
      get magDragStartCutFrame() { return host.magDragStartCutFrame; },
      set magDragStartCutFrame(v) { host.magDragStartCutFrame = v; },
      get capturedNoiseProfile() { return host.capturedNoiseProfile; },
      set capturedNoiseProfile(v) { host.capturedNoiseProfile = v; },
      get activeContextMenuEl() { return host.activeContextMenuEl; },
      set activeContextMenuEl(v) { host.activeContextMenuEl = v; },
      get manualSilenceRanges() { return host.manualSilenceRanges; },
      set manualSilenceRanges(v) { host.manualSilenceRanges = v; },
      get manualCutsPolicy() { return host.manualCutsPolicy; },
      set manualCutsPolicy(v) { host.manualCutsPolicy = v; },
      get sourcePcm() { return host.sourcePcm; },
      set sourcePcm(v) { host.sourcePcm = v; },
      get focusTrap() { return host.focusTrap; },
      set focusTrap(v) { host.focusTrap = v; },
      get nestedTrap() { return host.nestedTrap; },
      set nestedTrap(v) { host.nestedTrap = v; },
      get activeConfirmModalEl() { return host.activeConfirmModalEl; },
      set activeConfirmModalEl(v) { host.activeConfirmModalEl = v; },
      },
      isBoundaryManual: (frame) => host.isBoundaryManual(frame),
      getActiveCutFrame: () => host.getActiveCutFrame(),
      close: () => host.close(),
      checkZeroCrossing: (frame) => host.checkZeroCrossing(frame),
      bindEvents: () => host.bindEvents(),
      navigateBoundary: (delta) => host.navigateBoundary(delta),
      bindTableEvents: () => host.bindTableEvents(),
      auditionSlice: (sl, toggleStopIfSame) => host.auditionSlice(sl, toggleStopIfSame),
      showContextMenu: (x, y, items) => host.showContextMenu(x, y, items),
      removeManualBoundary: (frame) => host.removeManualBoundary(frame),
      render: () => host.render(),
      snapActiveBoundary0X: () => host.snapActiveBoundary0X(),
      handleToggleSliceSilence: (sliceId) => host.handleToggleSliceSilence(sliceId),
      registerManualBoundary: (newFrame, oldFrame) => host.registerManualBoundary(newFrame, oldFrame),
      auditionConformedLoop: () => host.auditionConformedLoop(),
      auditionFullWav: () => host.auditionFullWav(),
      bindCanvasInteraction: () => host.bindCanvasInteraction(),
      bindMagnifierInteraction: () => host.bindMagnifierInteraction(),
      drawMagnifierCanvas: () => host.drawMagnifierCanvas(),
      drawWaveformCanvas: () => host.drawWaveformCanvas(),
      handleInjectConformedLoopIntoSession: () => host.handleInjectConformedLoopIntoSession(),
      handleInjectSlicesIntoSession: () => host.handleInjectSlicesIntoSession(),
      hasManualCuts: () => host.hasManualCuts(),
      importSliceMarkersFile: (file) => host.importSliceMarkersFile(file),
      loadAudioFile: (file) => host.loadAudioFile(file),
      loadTestDemoBeat: () => host.loadTestDemoBeat(),
      nudgeActiveBoundary: (deltaSamples) => host.nudgeActiveBoundary(deltaSamples),
      recomputeSlices: (forceAuto) => host.recomputeSlices(forceAuto),
      reconcileSlicesAfterAudioClean: (actionLabel) => host.reconcileSlicesAfterAudioClean(actionLabel),
      refreshTable: () => host.refreshTable(),
      runWhisperVocalAlignment: () => host.runWhisperVocalAlignment(),
      showManualCutsConfirmationModal: (descriptionHtml, onKeep, onDiscard, onCancel) => host.showManualCutsConfirmationModal(descriptionHtml, onKeep, onDiscard, onCancel),
      showStemSeparationModal: () => host.showStemSeparationModal(),
      syncActiveSliceFromBoundary: () => host.syncActiveSliceFromBoundary(),
      updateMagnifierHeader: () => host.updateMagnifierHeader(),
      closeContextMenu: () => host.closeContextMenu(),
      suspendFocusTrap: () => host.suspendFocusTrap(),
      resumeFocusTrap: () => host.resumeFocusTrap(),
      closeConfirmModal: (resumeParent) => host.closeConfirmModal(resumeParent),
      extractBoundaryFrames: (result: SlicerResult | null, length: number) => (result ? extractBoundaryFrames(result, length) : []),
      deleteSlice: (result: SlicerResult, pcm: Float32Array, sampleRate: number, sliceId: string, options: SlicerOptions) => deleteSlice(result, pcm, sampleRate, sliceId, options),
      stopAudition: () => host.stopAudition?.(),
    };
  }

  constructor(context: AudioChopperContext) {
    this.context = context;
    onAppLocaleChange(() => {
      if (this.backdropEl) {
        this.render();
      }
    });
  }



  public close(): void {
    unbindChopperKeyboard(this.chopperCtx());
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


  /** Suspende la trampa del chopper mientras un diálogo anidado (body) tiene el foco. */

  /** Reanuda la trampa del chopper al cerrarse el diálogo anidado. */





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

  private syncActiveSliceFromBoundary(): void {
    if (!this.currentResult || this.pcm.length === 0) return;
    const boundaries = extractBoundaryFrames(this.currentResult, this.pcm.length);
    if (boundaries.length <= 2) return;
    const bIdx = clamp(this.activeBoundaryIndex, 1, boundaries.length - 2);
    const cutFrame = boundaries[bIdx];
    const hit = this.currentResult.slices.find((s) => Math.abs(s.startFrame - cutFrame) < 32);
    if (hit) {
      this.selectedSliceId = hit.id;
    }
    this.drawWaveformCanvas();
    this.drawMagnifierCanvas();
    this.updateMagnifierHeader();
    this.refreshTable();
  }

  private stopAudition(): void {
    if (this.context.onStopAudition) {
      this.context.onStopAudition();
    }
    if (this.playingSliceId) {
      this.playingSliceId = null;
      this.drawWaveformCanvas();
      this.drawMagnifierCanvas();
      this.updateMagnifierHeader();
      this.refreshTable();
    }
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
    this.bindChopperFileEvents();
    this.bindChopperDetectControlsEvents();
    this.bindChopperActionEvents();
  }

  private bindChopperFileEvents(): void {
    bindChopperFileEvents(this.chopperCtx());
  }

  private bindChopperDetectControlsEvents(): void {
    bindChopperDetectControlsEvents(this.chopperCtx());
  }

  private bindChopperActionEvents(): void {
    bindChopperActionEvents(this.chopperCtx());
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







  public open(pcm: Float32Array, sampleRate: number, sourceFilename: string = '', sliceFrames?: number[]): void {
    return open(this.chopperCtx(), pcm, sampleRate, sourceFilename, sliceFrames);
  }

  public openWithAudioBuffer(arrayBuf: ArrayBuffer, filename: string, sliceFrames?: number[]): void {
    return openWithAudioBuffer(this.chopperCtx(), arrayBuf, filename, sliceFrames);
  }

  public async loadAudioFile(file: File): Promise<void> {
    return loadAudioFile(this.chopperCtx(), file);
  }

  public async importSliceMarkersFile(file: File): Promise<void> {
    return importSliceMarkersFile(this.chopperCtx(), file);
  }

  public loadTestDemoBeat(): void {
    return loadTestDemoBeat(this.chopperCtx());
  }

  public showRx2PairingAssistantModal(rx2Filename: string, sliceFrames: number[], rx2Buffer?: ArrayBuffer, detectedSampleRate: number = 44100): void {
    return showRx2PairingAssistantModal(this.chopperCtx(), rx2Filename, sliceFrames, rx2Buffer, detectedSampleRate);
  }

  private async reconcileSlicesAfterAudioClean(actionLabel: string): Promise<void> {
    return reconcileSlicesAfterAudioClean(this.chopperCtx(), actionLabel);
  }

  private suspendFocusTrap(): void {
    return suspendFocusTrap(this.chopperCtx());
  }

  private resumeFocusTrap(): void {
    return resumeFocusTrap(this.chopperCtx());
  }

  private closeConfirmModal(resumeParent: boolean = true): void {
    return closeConfirmModal(this.chopperCtx(), resumeParent);
  }

  private showManualCutsConfirmationModal(descriptionHtml: string, onKeep: () => void, onDiscard: () => void, onCancel: () => void): void {
    return showManualCutsConfirmationModal(this.chopperCtx(), descriptionHtml, onKeep, onDiscard, onCancel);
  }

  private handleInjectConformedLoopIntoSession(): void {
    return handleInjectConformedLoopIntoSession(this.chopperCtx());
  }

  private handleInjectSlicesIntoSession(): void {
    return handleInjectSlicesIntoSession(this.chopperCtx());
  }

  private async runWhisperVocalAlignment(): Promise<void> {
    return runWhisperVocalAlignment(this.chopperCtx());
  }

  private showStemSeparationModal(): void {
    return showStemSeparationModal(this.chopperCtx());
  }
}
