import type {
  DetectedSlice,
  ManualSilenceRange,
  SlicerOptions,
  SlicerResult,
} from '../../core/dsp/AudioSlicerEngine.ts';
import type { NoiseProfile } from '../../../vendor/@abdsynths/shared/Code/DspCore/TakeDsp/index.ts';
import type { AudioChopperContext, ContextMenuItem } from '../AudioChopperModal.ts';

export interface ChopperState {
  backdropEl: HTMLElement | null;
  canvas: HTMLCanvasElement | null;
  magnifierCanvas: HTMLCanvasElement | null;
  pcm: Float32Array;
  zoomFactor: number;
  viewCenterNorm: number;
  currentResult: SlicerResult | null;
  selectedSliceId: string | null;
  hoveredBoundaryIndex: number;
  draggedBoundaryIndex: number;
  activeBoundaryIndex: number;
  isDraggingMagnifier: boolean;
  context: AudioChopperContext;
  options: SlicerOptions;
  sourceFilename: string;
  sampleRate: number;
  playingSliceId: string | null;
  normalizeEnabled: boolean;
  manualCutFrames: Set<number>;
  isDraggingBoundary: boolean;
  magDragStartMouseX: number;
  magDragStartCutFrame: number;
  capturedNoiseProfile: NoiseProfile | null;
  activeContextMenuEl: HTMLElement | null;
  manualSilenceRanges: ManualSilenceRange[];
  manualCutsPolicy: 'prompt' | 'keep' | 'discard';
  sourcePcm: Float32Array | null;
}

export interface ChopperContext {
  state: ChopperState;
  isBoundaryManual: (frame: number) => boolean;
  getActiveCutFrame: () => number;
  close: () => void;
  checkZeroCrossing: (frame: number) => boolean;
  bindEvents: () => void;
  navigateBoundary: (delta: number) => void;
  bindTableEvents: () => void;
  auditionSlice: (slice: DetectedSlice, toggleStopIfSame?: boolean) => void;
  showContextMenu: (x: number, y: number, items: ContextMenuItem[]) => void;
  removeManualBoundary: (frame: number) => void;
  render: () => void;
  snapActiveBoundary0X: () => void;
  handleToggleSliceSilence: (sliceId: string) => void;
  registerManualBoundary: (newFrame: number, oldFrame?: number) => void;
  auditionConformedLoop: () => void;
  auditionFullWav: () => void;
  bindCanvasInteraction: () => void;
  bindMagnifierInteraction: () => void;
  drawMagnifierCanvas: () => void;
  drawWaveformCanvas: () => void;
  handleInjectConformedLoopIntoSession: () => void;
  handleInjectSlicesIntoSession: () => void;
  hasManualCuts: () => boolean;
  importSliceMarkersFile: (file: File) => Promise<void>;
  loadAudioFile: (file: File) => Promise<void>;
  loadTestDemoBeat: () => void;
  nudgeActiveBoundary: (deltaSamples: number) => void;
  recomputeSlices: (forceAuto: boolean) => void;
  reconcileSlicesAfterAudioClean: (actionLabel: string) => Promise<void>;
  refreshTable: () => void;
  runWhisperVocalAlignment: () => Promise<void>;
  showManualCutsConfirmationModal: (descriptionHtml: string, onKeep: () => void, onDiscard: () => void, onCancel: () => void) => void;
  showStemSeparationModal: () => void;
}
