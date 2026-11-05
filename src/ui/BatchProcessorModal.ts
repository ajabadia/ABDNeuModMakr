// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Phase 12: Batch Processor Modal Dialog
// ─────────────────────────────────────────────────────────

import { getAppLocale } from '../core/i18n.ts';
import { ICONS } from './icons.ts';
import { escHtml } from './escape.ts';
import { createModalFocusTrap, type FocusTrap } from './modalFocusTrap.ts';
import { confirmDialog } from './notify.ts';
import type { TriageExpandedFile } from '../app/triageGate.ts';
import { slugifyModelName } from '../core/modelSlug.ts';
import { BatchQueue } from '../core/batch/BatchQueue.ts';
import { MUSICIAN_TERMS } from './preflightGateView.ts';
import type { BatchConfig, BatchModelCandidate, BatchProgressState, BatchResultSummary } from '../core/batch/types.ts';
import type { KeyMappingMode, PipelineChecklistSelection } from '../core/types.ts';
import { createDefaultPipelineChecklistSelection } from '../core/dsp/PipelineConditioningSteps.ts';
import { bridgeClient } from '../core/bridge/BridgeClient.ts';
import type { BatchModalContext, BatchModalStep } from './batch/batchModalCore.ts';
import { renderDiscoverStep as renderDiscoverStepFn } from './batch/batchDiscoverView.ts';
import { renderPreflightStep as renderPreflightStepFn, renderRunningStep as renderRunningStepFn, renderDoneStep as renderDoneStepFn } from './batch/batchPreflightView.ts';
import { bindEvents as bindBatchEvents } from './batch/batchEvents.ts';
import { loadCandidates as loadCandidatesFn, loadSf2Buffer as loadSf2BufferFn, loadExpandedFiles as loadExpandedFilesFn, ingestBatchFiles as ingestBatchFilesFn, handleLoopFiles as handleLoopFilesFn, startQueue as startQueueFn, downloadBlob as downloadBlobFn } from './batch/batchQueueOps.ts';
export type { BatchModalContext, BatchModalStep } from './batch/batchModalCore.ts';

export class BatchProcessorModal {
  public backdropEl: HTMLElement | null = null;
  public focusTrap: FocusTrap | null = null;
  public currentStep: BatchModalStep = 'discover';
  public isSingleSessionMode = false;
  public queue = new BatchQueue();
  public candidates: BatchModelCandidate[] = [];
  public selectedCandidateIds = new Set<string>();
  public activeConfig: BatchConfig;
  public checklistSelection: PipelineChecklistSelection;
  public downloadedModelIds = new Set<string>();
  public context: BatchModalContext;
  public progressState: BatchProgressState | null = null;
  public finalSummary: BatchResultSummary | null = null;
  public unsubscribeQueue: (() => void) | null = null;
  public isScanningLocal = false;
  public localScanPath = 'd:\\desarrollos\\ABDSynths\\_RESOURCES\\Soundfonts';

  constructor(context: BatchModalContext) {
    this.context = context;
    const initialProc = context.getCurrentProcessConfig();
    this.checklistSelection = createDefaultPipelineChecklistSelection({
      workingMode: context.getCurrentWorkingMode(),
      keyMappingMode: initialProc.keyMappingMode ?? 'chromatic',
      hasLegacyClassicOnlySources: false,
      dspAlgorithm: initialProc.dspAlgorithm || 'legacy',
      aiConfig: initialProc.aiConfig,
      hasExistingCoverArtwork: Boolean(initialProc.coverArtwork),
    });
    this.activeConfig = {
      targetFormat: initialProc.targetFormat || 'dual',
      destination: 'axionikdb',
      destinationSublibrary: 'Default',
      complexityStrategy: 'auto',
      dspAlgorithm: initialProc.dspAlgorithm || 'legacy',
      autoAcousticClassification: true,
      ingestionMode: 'multisample',
      slicerProfile: 'drums',
      slicerSensitivity: 70,
      slicerSnapZeroCrossing: true,
      slicerBpm: 120,
      exportMidiPattern: true,
      stagePipelineVramSafety: true,
      executionOrder: 'stage-grouped',
      aiConfig: initialProc.aiConfig,
      keyMappingMode: initialProc.keyMappingMode ?? 'chromatic',
      checklistSelection: this.checklistSelection,
      outputMasterZipName: `BatchExport_${new Date().toISOString().slice(0, 10)}.zip`,
      axionikDbPath:
        (typeof localStorage !== 'undefined' ? localStorage.getItem('abd_axionikdb_path') : null) ||
        'd:\\desarrollos\\ABDSynths\\AxionikDB',
    };
  }

  private refreshBridgeModelsSnapshot(): void {
    if (!bridgeClient.isConnected()) return;
    void bridgeClient
      .getModels()
      .then((models) => {
        if (Array.isArray(models)) {
          this.downloadedModelIds.clear();
          for (const m of models) {
            if (m.installed) this.downloadedModelIds.add(m.id);
          }
          if (this.backdropEl && this.currentStep === 'preflight') {
            this.render();
          }
        }
      })
      .catch(() => {
        // non-blocking
      });
  }

  public resetChecklistToDefaults(): void {
    const currentProc = this.context.getCurrentProcessConfig();
    const session = this.context.getActiveSession?.() ?? null;
    const srcInspect = this.context.inspectProcessSources?.();
    const hasLegacyOnly = Boolean(
      this.isSingleSessionMode &&
        srcInspect &&
        srcInspect.importedSources.length > 0 &&
        srcInspect.newAudioSources.length === 0
    );
    const keyMode: KeyMappingMode = this.isSingleSessionMode
      ? (currentProc.keyMappingMode ?? 'chromatic')
      : this.activeConfig.ingestionMode === 'slicer' && this.activeConfig.slicerProfile === 'drums'
        ? 'drum'
        : (currentProc.keyMappingMode ?? 'chromatic');

    this.checklistSelection = createDefaultPipelineChecklistSelection({
      workingMode: this.context.getCurrentWorkingMode(),
      keyMappingMode: keyMode,
      hasLegacyClassicOnlySources: hasLegacyOnly,
      dspAlgorithm: currentProc.dspAlgorithm || 'legacy',
      aiConfig: currentProc.aiConfig,
      hasExistingCoverArtwork: Boolean(session?.processConfig.coverArtwork),
    });
    this.activeConfig.checklistSelection = this.checklistSelection;
    this.activeConfig.keyMappingMode = keyMode;
  }

  public open(): void {
    if (this.backdropEl) return;
    this.isSingleSessionMode = false;
    this.currentStep = 'discover';
    this.candidates = [];
    this.selectedCandidateIds.clear();
    this.progressState = null;
    this.finalSummary = null;

    // Refresh active config with current session state
    const currentProc = this.context.getCurrentProcessConfig();
    this.activeConfig.dspAlgorithm = currentProc.dspAlgorithm || 'legacy';
    this.activeConfig.targetFormat = currentProc.targetFormat || 'dual';
    this.activeConfig.aiConfig = currentProc.aiConfig;
    this.resetChecklistToDefaults();
    this.refreshBridgeModelsSnapshot();

    this.render();
  }

  /**
   * Opens the unified modal directly at Step 2 (`Preflight & Pipeline Checklist`)
   * for the active single-model session (`Generate Neuron Model` button).
   */
  public openForActiveSession(): void {
    if (this.backdropEl) return;
    const session = this.context.getActiveSession?.();
    if (!session) return;

    this.isSingleSessionMode = true;
    this.currentStep = 'preflight';
    this.progressState = null;
    this.finalSummary = null;

    const currentProc = this.context.getCurrentProcessConfig();
    this.activeConfig.dspAlgorithm = currentProc.dspAlgorithm || 'legacy';
    this.activeConfig.targetFormat = currentProc.targetFormat || 'dual';
    this.activeConfig.aiConfig = currentProc.aiConfig;
    this.activeConfig.keyMappingMode = currentProc.keyMappingMode ?? 'chromatic';

    const modelTitle = (currentProc.expandedName || currentProc.modelName || session.name || 'Active Model').trim();
    const sampleNames = this.context.getLoadedSampleNames?.() ?? [];
    const zoneCount =
      currentProc.workingMode === 'extended' && session.extendedRegions && session.extendedRegions.length > 0
        ? session.extendedRegions.length
        : session.zones.length;

    const activeCandidate: BatchModelCandidate = {
      id: `active-session-${session.id}`,
      name: modelTitle,
      slug: slugifyModelName(modelTitle),
      sourceType: 'folder-pack',
      sourceOrigin: `Active Session (${currentProc.keyMappingMode === 'drum' ? 'Drum Map' : 'Chromatic'})`,
      zoneCount: Math.max(1, zoneCount),
      detectedCategory: session.detectedInstrumentCategory || 'Synth',
      suggestedParameterSet: currentProc.parameterSet ?? 0,
      suggestedComplexity: currentProc.complexity ?? 8,
      status: 'pending',
      progressPct: 0,
      files: sampleNames.map((name) => ({ name, buffer: new ArrayBuffer(0) })),
      classicZones: session.zones,
      extendedRegions: session.extendedRegions,
      articulation: session.articulation,
    };

    this.candidates = [activeCandidate];
    this.selectedCandidateIds = new Set([activeCandidate.id]);
    this.resetChecklistToDefaults();
    this.refreshBridgeModelsSnapshot();

    this.render();
  }

  public close(): void {
    if (this.queue.getProgressState().status === 'running') {
      void confirmDialog('A batch process is currently running. Do you want to cancel it and exit?', {
        title: 'Cancel batch?',
        confirmLabel: 'Cancel batch',
        cancelLabel: 'Keep running',
        danger: true,
      }).then((ok) => {
        if (ok) {
          this.queue.cancel();
          this.cleanup();
        }
      });
      return;
    }
    this.cleanup();
  }

  public cleanup(): void {
    if (this.unsubscribeQueue) {
      this.unsubscribeQueue();
      this.unsubscribeQueue = null;
    }
    if (this.focusTrap) {
      this.focusTrap.deactivate();
      this.focusTrap = null;
    }
    if (this.backdropEl) {
      this.backdropEl.remove();
      this.backdropEl = null;
    }
  }

  public render(): void {
    if (!this.backdropEl) {
      this.backdropEl = document.createElement('div');
      this.backdropEl.className = 'nmm-modal-backdrop nmm-batch-backdrop';
      document.body.appendChild(this.backdropEl);

      this.backdropEl.addEventListener('click', (e) => {
        if (e.target === this.backdropEl) this.close();
      });
    }

    let bodyHtml = '';
    if (this.currentStep === 'discover') {
      bodyHtml = this.renderDiscoverStep();
    } else if (this.currentStep === 'preflight') {
      bodyHtml = this.renderPreflightStep();
    } else if (this.currentStep === 'running') {
      bodyHtml = this.renderRunningStep();
    } else if (this.currentStep === 'done') {
      bodyHtml = this.renderDoneStep();
    }

    const isEs = getAppLocale() === 'es';
    const modalTitle = this.isSingleSessionMode
      ? isEs
        ? 'Generar Modelo Neuron — Pre-Flight y Checklist de Pipeline'
        : 'Generate Neuron Model — Pre-Flight & Pipeline Checklist'
      : isEs
        ? 'Procesador por Lotes y Checklist Unificado de Pipeline'
        : 'Batch Processor & Unified Pipeline Checklist';

    this.backdropEl.innerHTML = `
      <div class="nmm-modal-window nmm-modal-xl nmm-batch-window" role="dialog" aria-modal="true" aria-labelledby="batch-modal-title">
        <header class="nmm-modal-header">
          <div class="nmm-modal-header-title">
            <span class="modal-icon">${this.isSingleSessionMode ? ICONS.cpu : ICONS.layers}</span>
            <h2 id="batch-modal-title">${escHtml(modalTitle)}</h2>
          </div>
          <button type="button" class="nmm-modal-close" aria-label="${isEs ? 'Cerrar' : 'Close'}" id="btn-batch-close">${ICONS.close}</button>
        </header>

        <nav class="nmm-batch-steps-nav" aria-label="${isEs ? 'Etapas del progreso del lote' : 'Batch progress stages'}">
          ${
            this.isSingleSessionMode
              ? `<div class="nmm-batch-step-indicator is-active">${isEs ? '1. Pre-Flight y Checklist de Pipeline (15 Pasos · Motor DSP / IA / Resinator 2)' : '1. Pre-Flight & Pipeline Checklist (15 Steps · DSP Engine / AI / Resinator 2)'}</div>`
              : `
          <div class="nmm-batch-step-indicator ${this.currentStep === 'discover' ? 'is-active' : ''}">${isEs ? '1. Descubrimiento' : '1. Discovery'}</div>
          <div class="nmm-batch-step-indicator ${this.currentStep === 'preflight' ? 'is-active' : ''}">2. ${escHtml(MUSICIAN_TERMS.preflightBatch)} &amp; Pipeline</div>
          <div class="nmm-batch-step-indicator ${this.currentStep === 'running' ? 'is-active' : ''}">${isEs ? '3. Ejecución' : '3. Execution'}</div>
          <div class="nmm-batch-step-indicator ${this.currentStep === 'done' ? 'is-active' : ''}">${isEs ? '4. Informe' : '4. Report'}</div>
          `
          }
        </nav>

        <div class="nmm-modal-body nmm-batch-body">
          ${bodyHtml}
        </div>
      </div>
    `;

    this.bindEvents();

    if (!this.focusTrap) {
      this.focusTrap = createModalFocusTrap(
        this.backdropEl.querySelector('.nmm-batch-window')!,
        { onEscape: () => this.close() }
      );
      this.focusTrap.activate();
    }
  }


  // -- Delegacion Fase 42.5: vistas (batchDiscoverView/batchPreflightView) --
  private renderDiscoverStep(): string {
    return renderDiscoverStepFn(this);
  }
  private renderPreflightStep(): string {
    return renderPreflightStepFn(this);
  }
  private renderRunningStep(): string {
    return renderRunningStepFn(this);
  }
  private renderDoneStep(): string {
    return renderDoneStepFn(this);
  }

  // -- Delegacion Fase 42.5: eventos (batchEvents) --
  private bindEvents(): void {
    bindBatchEvents(this);
  }

  // -- Delegacion Fase 42.5: cola (batchQueueOps) --
  public loadCandidates(candidates: BatchModelCandidate[], originTitle?: string): void {
    loadCandidatesFn(this, candidates, originTitle);
  }
  public loadSf2Buffer(buffer: ArrayBuffer, soundFontName: string): void {
    loadSf2BufferFn(this, buffer, soundFontName);
  }
  public async loadExpandedFiles(inputFiles: TriageExpandedFile[],
    originTitle?: string): Promise<void> {
    return loadExpandedFilesFn(this, inputFiles, originTitle);
  }
  public async ingestBatchFiles(files: File[]): Promise<void> {
    return ingestBatchFilesFn(this, files);
  }
  public async handleLoopFiles(files: File[]): Promise<void> {
    return handleLoopFilesFn(this, files);
  }
  public async startQueue(): Promise<void> {
    return startQueueFn(this);
  }
  public downloadBlob(bytes: Uint8Array, fileName: string, mimeType: string): void {
    downloadBlobFn(this, bytes, fileName, mimeType);
  }
}
