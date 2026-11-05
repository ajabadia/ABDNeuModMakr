// ─────────────────────────────────────────────────────────
// BatchProcessorModal — nucleo estructural (Fase 42.5)
// Tipos de contexto/paso + interfaz que expone el estado y la API
// que usan los modulos de `src/ui/batch/`.
// ─────────────────────────────────────────────────────────

import type {
  BatchConfig,
  BatchModelCandidate,
  BatchProgressState,
  BatchResultSummary,
} from '../../core/batch/types.ts';
import type {
  PipelineChecklistSelection,
  ProcessConfig,
  ProcessSourcesInspection,
  Session,
  WorkingMode,
} from '../../core/types.ts';
import type { BatchQueue } from '../../core/batch/BatchQueue.ts';
import type { TriageExpandedFile } from '../../app/triageGate.ts';

export interface BatchModalContext {
  getCurrentProcessConfig: () => ProcessConfig;
  getCurrentWorkingMode: () => WorkingMode;
  getAiEngineStatusLabel: () => string;
  getActiveSession?: () => Session | null;
  inspectProcessSources?: () => ProcessSourcesInspection;
  getLoadedSampleNames?: () => string[];
  validateCoverage?: () => string[];
  onStartSingleModelProcess?: (
    config: ProcessConfig,
    options: { forceReanalyzeImported: boolean; checklist: PipelineChecklistSelection }
  ) => Promise<void>;
  onOpenAiSettings?: () => void;
  onRefreshBankDrawer?: () => void;
}

export type BatchModalStep = 'discover' | 'preflight' | 'running' | 'done';

export interface BatchModalCore {
  backdropEl: HTMLElement | null;
  currentStep: BatchModalStep;
  isSingleSessionMode: boolean;
  queue: BatchQueue;
  candidates: BatchModelCandidate[];
  selectedCandidateIds: Set<string>;
  activeConfig: BatchConfig;
  checklistSelection: PipelineChecklistSelection;
  downloadedModelIds: Set<string>;
  context: BatchModalContext;
  progressState: BatchProgressState | null;
  finalSummary: BatchResultSummary | null;
  unsubscribeQueue: (() => void) | null;
  isScanningLocal: boolean;
  localScanPath: string;
  open(): void;
  close(): void;
  cleanup(): void;
  render(): void;
  resetChecklistToDefaults(): void;
  loadCandidates(candidates: BatchModelCandidate[], originTitle?: string): void;
  loadSf2Buffer(buffer: ArrayBuffer, soundFontName: string): void;
  loadExpandedFiles(inputFiles: TriageExpandedFile[],
    originTitle?: string): Promise<void>;
  ingestBatchFiles(files: File[]): Promise<void>;
  handleLoopFiles(files: File[]): Promise<void>;
  startQueue(): Promise<void>;
  downloadBlob(bytes: Uint8Array, fileName: string, mimeType: string): void;
}
