// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Phase 12: Batch Processor Modal Dialog
// ─────────────────────────────────────────────────────────

import { getAppLocale } from '../core/i18n.ts';
import { ICONS } from './icons.ts';
import { browseFilesystemFolder } from './folderPicker.ts';
import { escHtml, escAttr } from './escape.ts';
import { createModalFocusTrap, type FocusTrap } from './modalFocusTrap.ts';
import { confirmDialog, toast } from './notify.ts';
import { extractSf2PresetsToCandidates } from '../core/batch/Sf2BatchExtractor.ts';
import {
  extractFolderFilesToCandidates,
  extractFolderLoopsToCandidates,
  type FolderFileInput,
} from '../core/batch/FolderBatchExtractor.ts';
import {
  discoverTriageReport,
  extractTriageDefinitionCandidates,
  indexTriageBuffers,
  partitionTriageSelection,
  type TriageExpandedFile,
} from '../app/triageGate.ts';
import { listZipSamplerPrograms, parseUniversalSampler } from '../core/import/rawSamplerParsers.ts';
import { applyPreflightImportAdaptations } from '../core/import/importPreflight.ts';
import { parseZipArchive } from '@abdsynths/shared/formats/neuron';
import { slugifyModelName } from '../core/modelSlug.ts';
import { BatchQueue } from '../core/batch/BatchQueue.ts';
import { buildBatchPreflightSummary } from '../core/batch/preflight.ts';
import {
  MUSICIAN_TERMS,
  fromBatchPreflightSummary,
  renderCommonPreflightGate,
} from './preflightGateView.ts';
import type {
  BatchConfig,
  BatchModelCandidate,
  BatchProgressState,
  BatchResultSummary,
} from '../core/batch/types.ts';
import type {
  KeyMappingMode,
  PipelineChecklistSelection,
  PipelineStepId,
  ProcessConfig,
  ProcessSourcesInspection,
  Session,
  WorkingMode,
} from '../core/types.ts';
import {
  buildPipelineChecklistRows,
  createDefaultPipelineChecklistSelection,
  type PipelineStepDescriptor,
} from '../core/dsp/PipelineConditioningSteps.ts';
import { cloudByokClient } from '../core/ai/CloudByokClient.ts';
import { bridgeClient } from '../core/bridge/BridgeClient.ts';
import { fileExtension } from '../core/pathUtils.ts';
import { yieldToUI } from '../core/asyncUtils.ts';
import { downloadBytes } from './download.ts';
import { loadingModal, withLoading } from './LoadingModal.ts';

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

export class BatchProcessorModal {
  private backdropEl: HTMLElement | null = null;
  private focusTrap: FocusTrap | null = null;
  private currentStep: BatchModalStep = 'discover';
  private isSingleSessionMode = false;
  private queue = new BatchQueue();
  private candidates: BatchModelCandidate[] = [];
  private selectedCandidateIds = new Set<string>();
  private activeConfig: BatchConfig;
  private checklistSelection: PipelineChecklistSelection;
  private downloadedModelIds = new Set<string>();
  private context: BatchModalContext;
  private progressState: BatchProgressState | null = null;
  private finalSummary: BatchResultSummary | null = null;
  private unsubscribeQueue: (() => void) | null = null;
  private isScanningLocal = false;
  private localScanPath = 'd:\\desarrollos\\ABDSynths\\_RESOURCES\\Soundfonts';

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

  private resetChecklistToDefaults(): void {
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

  private cleanup(): void {
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

  private render(): void {
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

  // ── Step 1: Discovery ──────────────────────────────────

  private renderDiscoverStep(): string {
    const isEs = getAppLocale() === 'es';
    const isBridgeOnline = bridgeClient.isConnected();
    const defaultScanPath = this.localScanPath;
    const isSlicer = this.activeConfig.ingestionMode === 'slicer';

    return `
      <div class="nmm-batch-discover-pane">
        <!-- Ingestion Mode Selector -->
        <div class="nmm-batch-card batch-pane-head">
          <div class="triage-toolbar">
            <div class="triage-toolbar-left">
              <strong class="batch-pane-title">${isEs ? 'Estrategia de Ingesta:' : 'Ingestion Strategy:'}</strong>
              <span class="nmm-batch-hint batch-pane-hint">
                ${isSlicer ? (isEs ? 'Tratar cada bucle de audio como un kit/modelo individual, autodetectar cortes e incluir patrón MIDI.' : 'Treat each audio loop as an individual kit/model, auto-detect slices and bundle groove MIDI.') : isEs ? 'Agrupar múltiples archivos de muestras en modelos de instrumentos multizona.' : 'Group multiple sample files into multi-zone instrument models.'}
              </span>
            </div>
            <div class="footer-right">
              <button type="button" class="btn ${!isSlicer ? 'btn-primary' : 'btn-outline'}" id="btn-batch-mode-multisample">
                ${isEs ? 'Instrumentos Multimuestra' : 'Multisample Instruments'}
              </button>
              <button type="button" class="btn ${isSlicer ? 'btn-primary' : 'btn-outline'}" id="btn-batch-mode-slicer">
                ${ICONS.scissors} ${isEs ? 'AutoSlicer por Lotes (Bucles y Ritmos)' : 'Batch AutoSlicer (Loops & Beats)'}
              </button>
            </div>
          </div>

          <div class="batch-slicer-row">
            <div class="batch-field ${!isSlicer ? 'is-conditioned-disabled' : ''}">
              <label for="sel-batch-slicer-profile">
                ${isEs ? 'Perfil de Corte:' : 'Slicing Profile:'}
                ${!isSlicer ? `<span class="cond-reason-badge">${isEs ? 'SOLO AUTOSLICER' : 'AUTOSLICER ONLY'}</span>` : ''}
              </label>
              <select id="sel-batch-slicer-profile" class="form-control" ${!isSlicer ? `disabled title="${isEs ? 'Solo disponible en modo Batch AutoSlicer' : 'Only available in Batch AutoSlicer mode'}"` : ''}>
                <option value="drums" ${this.activeConfig.slicerProfile === 'drums' ? 'selected' : ''}>${isEs ? 'Batería (Mapa General MIDI C1..B2)' : 'Drums (General MIDI C1..B2 Map)'}</option>
                <option value="chromatic" ${this.activeConfig.slicerProfile === 'chromatic' ? 'selected' : ''}>${isEs ? 'Cromático (Tono F0 + Equidistante 0..127)' : 'Chromatic (F0 Pitch + Equidistant 0..127)'}</option>
                <option value="vocals" ${this.activeConfig.slicerProfile === 'vocals' ? 'selected' : ''}>${isEs ? 'Voces y Frases (Valles de Silencio)' : 'Vocals & Phrases (Silence Valleys)'}</option>
                <option value="grid" ${this.activeConfig.slicerProfile === 'grid' ? 'selected' : ''}>${isEs ? 'Rejilla Musical (División 1/16)' : 'Musical Grid (1/16 Beat Division)'}</option>
              </select>
            </div>

            <label class="batch-check ${!isSlicer ? 'is-conditioned-disabled' : ''}">
              <input type="checkbox" class="articulation-checkbox switch--sm" id="chk-batch-export-midi" ${this.activeConfig.exportMidiPattern !== false ? 'checked' : ''} ${!isSlicer ? 'disabled' : ''} />
              <span>${isEs ? 'Generar e Incluir Patrón Groove MIDI (.mid)' : 'Generate & Bundle Groove MIDI Pattern (.mid)'} ${!isSlicer ? `<span class="cond-reason-badge">${isEs ? 'SOLO AUTOSLICER' : 'AUTOSLICER ONLY'}</span>` : ''}</span>
            </label>

            <label class="batch-check" title="${isEs ? 'Agrupa el trabajo por etapas (1. Ingesta -> 2. Separación -> 3. Denoise -> 4. Super-Resolución/Clasificación -> 5. Síntesis Espectral) sobre todo el lote de una vez para no cargar y descargar modelos IA/DSP en cada archivo' : 'Groups work by stage across the entire batch so AI/DSP models stay warm in memory instead of loading/unloading per file'}">
              <input type="checkbox" class="articulation-checkbox switch--sm" id="chk-batch-stage-grouped" ${this.activeConfig.executionOrder !== 'per-job' ? 'checked' : ''} />
              <span>${isEs ? 'Cola por Fases (Modelo IA/DSP caliente en memoria)' : 'Stage-Grouped Queue (Keep AI/DSP model warm in memory)'}</span>
            </label>

            <label class="batch-check ${this.activeConfig.executionOrder === 'per-job' ? 'is-conditioned-disabled' : ''}">
              <input type="checkbox" class="articulation-checkbox switch--sm" id="chk-batch-vram-safety" ${this.activeConfig.stagePipelineVramSafety !== false ? 'checked' : ''} ${this.activeConfig.executionOrder === 'per-job' ? 'disabled' : ''} />
              <span title="${isEs ? 'Libera memoria CUDA entre etapas del pipeline para evitar falta de VRAM en gráficas de 6/8 GB' : 'Flushes CUDA memory between pipeline stages to prevent GPU OOM on 6/8 GB cards'}">${isEs ? 'Vaciado Seguro de VRAM por Etapa' : 'VRAM Stage Safety Flush'} ${this.activeConfig.executionOrder === 'per-job' ? `<span class="cond-reason-badge">${isEs ? 'REQUIERE COLA POR FASES' : 'REQUIRES STAGE QUEUE'}</span>` : ''}</span>
            </label>
          </div>
        </div>

        <div class="nmm-batch-card">
          <h3>${isEs ? 'Seleccionar Material de Origen' : 'Select Source Material'}</h3>
          <p class="nmm-batch-hint">
            ${
              isSlicer
                ? isEs
                  ? 'Convierte en lote bucles de batería, pistas vocales o archivos ReCycle (.rx2/.rex/.rcy) en kits de modelos troceados independientes.'
                  : 'Batch convert drum loops, vocal tracks, or ReCycle (.rx2/.rex/.rcy) files into independent sliced model kits.'
                : isEs
                  ? 'Convierte bancos de samplers multiformato (.sf2, .sfz, .dspreset, .nki, .vstpreset, .multisample, .adv, .exs, .talsmpl, .txprog, .kmp, .dls, .xpm), imágenes de disco hardware (.iso, .img, .dsk, .efe), modelos Hartmann Neuron (.model, .neuronikmodel, .scape/.sphere), archivos .zip o carpetas de audio en una sola pasada desatendida.'
                  : 'Convert multi-format sampler banks (.sf2, .sfz, .dspreset, .nki, .vstpreset, .multisample, .adv, .exs, .talsmpl, .txprog, .kmp, .dls, .xpm), hardware disk images (.iso, .img, .dsk, .efe), Hartmann Neuron models (.model, .neuronikmodel, .scape/.sphere), .zip archives, or multi-folder audio packs in a single unattended pass.'
            }
          </p>

          <div class="nmm-batch-dropzone" id="batch-dropzone">
            <div class="nmm-batch-dropzone-icon">${ICONS.upload}</div>
            <div class="nmm-batch-dropzone-text">
              ${
                isSlicer
                  ? isEs
                    ? 'Arrastra y suelta <strong>bucles de audio (.wav, .aif, .flac, .mp3, .ogg, .rx2, .rex, .zip)</strong> o carpetas de bucles aquí'
                    : 'Drag & drop <strong>audio loops (.wav, .aif, .flac, .mp3, .ogg, .rx2, .rex, .zip)</strong> or loop folders here'
                  : isEs
                    ? 'Arrastra y suelta <strong>.sf2, .sfz, .dspreset, .nki, .exs, .xpm, .adv, .vstpreset, .multisample, .kmp, .dls, .model, .iso/.img/.dsk, .zip</strong> o carpetas de audio aquí'
                    : 'Drag & drop <strong>.sf2, .sfz, .dspreset, .nki, .exs, .xpm, .adv, .vstpreset, .multisample, .kmp, .dls, .model, .iso/.img/.dsk, .zip</strong>, or audio folders here'
              }
            </div>
            <div class="nmm-batch-dropzone-sub">${isEs ? 'o usa los botones inferiores' : 'or use the buttons below'}</div>
            
            <div class="nmm-batch-dropzone-actions">
              ${
                !isSlicer
                  ? `
              <label class="btn btn-primary">
                ${ICONS.folder} ${isEs ? 'Elegir Bancos, Presets, Discos o ZIP (.sf2, .sfz, .nki, .exs, .xpm, .model, .iso, .zip...)' : 'Select Banks, Presets, Disks or ZIP (.sf2, .sfz, .nki, .exs, .xpm, .model, .iso, .zip...)'}
                <input type="file" id="input-batch-sf2" accept=".model,.neuronikmodel,.nmmodel,.scape,.sphere,.nmpack,.script,.sf2,.sfz,.nki,.vstpreset,.dspreset,.multisample,.adv,.exs,.talsmpl,.txprog,.kmp,.ksf,.dls,.xpm,.xty,.xtd,.xpn,.pgm,.akp,.s3p,.sxt,.dwp,.krz,.k25,.k26,.x7u,.x8u,.x3a,.iso,.img,.dsk,.out,.hda,.efe,.ede,.rx2,.rex,.rcy,.cue,.wav,.aif,.aiff,.aifc,.flac,.mp3,.ogg,.oga,.m4a,.aac,.opus,.webm,.caf,.ncw,.zip" multiple class="is-hidden-file" />
              </label>
              `
                  : `
              <label class="btn btn-primary">
                ${ICONS.scissors} ${isEs ? 'Elegir Bucles (.wav, .flac, .mp3, .ogg, .rx2, .rex, .zip)' : 'Select Loops (.wav, .flac, .mp3, .ogg, .rx2, .rex, .zip)'}
                <input type="file" id="input-batch-loops" accept=".wav,.aif,.aiff,.aifc,.flac,.mp3,.ogg,.oga,.m4a,.aac,.opus,.webm,.caf,.ncw,.rx2,.rex,.rcy,.cue,.zip" multiple class="is-hidden-file" />
              </label>
              `
              }

              <label class="btn btn-outline">
                ${isEs ? `Seleccionar Carpeta ${isSlicer ? 'de Bucles' : 'Multiformato / Audio'}` : `Select ${isSlicer ? 'Loops Folder' : 'Multi-Format / Audio Folder'}`}
                <input type="file" id="input-batch-folder" webkitdirectory directory multiple class="is-hidden-file" />
              </label>
            </div>
          </div>
        </div>

        <div class="nmm-batch-card ${!isBridgeOnline ? 'is-conditioned-disabled' : ''}">
          <h3>${isEs ? 'Escáner de Disco Local Companion Bridge' : 'Companion Bridge Local Disk Scanner'} ${!isBridgeOnline ? `<span class="cond-reason-badge">${isEs ? 'BRIDGE DESCONECTADO (7860)' : 'BRIDGE OFFLINE (7860)'}</span>` : ''}</h3>
          <p class="nmm-batch-hint">
            ${isEs ? 'Escanea carpetas locales de gran capacidad sin cargar gigabytes de audio crudo en la memoria del navegador.' : 'Scan high-capacity local disk folders without loading gigabytes of raw audio into browser memory.'}
          </p>
          <div class="nmm-batch-scan-row">
            <input type="text" id="input-batch-scan-path" class="form-control" value="${escAttr(defaultScanPath)}" placeholder="C:\\path\\to\\soundfonts" />
            <button type="button" class="btn btn-outline" id="btn-batch-browse-disk" title="${isEs ? 'Navegar por el sistema de archivos para seleccionar la carpeta a escanear' : 'Browse filesystem to select the folder to scan'}">
              ${ICONS.folder} ${isEs ? 'Examinar...' : 'Browse...'}
            </button>
            <button type="button" class="btn btn-primary" id="btn-batch-scan-disk" ${!isBridgeOnline ? 'disabled' : ''}>
              ${ICONS.search} ${this.isScanningLocal ? (isEs ? 'Escaneando...' : 'Scanning...') : isEs ? 'Escanear Carpeta' : 'Scan Folder'}
            </button>
          </div>
          ${!isBridgeOnline ? `<div class="nmm-alert-subtle">${isEs ? 'Companion Bridge está desconectado. Inicia el servicio bridge en <code>127.0.0.1:7860</code> para escanear rutas de disco local directamente.' : 'Companion Bridge is offline. Start the bridge daemon on <code>127.0.0.1:7860</code> to scan local disk paths directly.'}</div>` : ''}
        </div>
      </div>
    `;
  }

  // ── Step 2: Preflight Summary ──────────────────────────

  private renderEngineBadgeHtml(row: PipelineStepDescriptor): string {
    const b = row.engineBadge;
    const iconSvg =
      b.iconKey === 'sparkle'
        ? ICONS.sparkle
        : b.iconKey === 'ai'
          ? ICONS.ai
          : b.iconKey === 'cloud'
            ? ICONS.cloud
            : b.iconKey === 'alert'
              ? ICONS.alert
              : b.iconKey === 'lock'
                ? ICONS.lock
                : ICONS.cpu;

    const batchQueuePill =
      !this.isSingleSessionMode &&
      this.activeConfig.executionOrder !== 'per-job' &&
      b.isBatchStageGroupedLocalAi
        ? `<span class="engine-badge-queue-pill" title="En proceso Batch, este modelo IA se mantiene caliente en VRAM y procesa todas las muestras del lote de forma consecutiva antes de pasar al siguiente paso">${ICONS.zap} COLA IA SEGUIDA</span>`
        : '';

    return `
      <div class="pipeline-engine-badge ${escAttr(b.cssClass)}" title="${escAttr(b.tooltip)}">
        <span class="engine-badge-icon">${iconSvg}</span>
        <span class="engine-badge-label">${escHtml(b.shortLabel)}</span>
        <span class="engine-badge-sep">·</span>
        <span class="engine-badge-model">${escHtml(b.modelOrEngineName)}</span>
        ${batchQueuePill}
      </div>
    `;
  }

  private renderPipelineChecklistCard(): string {
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

    const sampleNames = this.isSingleSessionMode
      ? (this.context.getLoadedSampleNames?.() ?? [])
      : this.candidates
          .filter((c) => this.selectedCandidateIds.has(c.id))
          .flatMap((c) => c.files.map((f) => f.name));

    const byokCfg = cloudByokClient.getConfig();
    const firstCloudProvider = cloudByokClient.getFirstAvailableTextProvider();
    const hasCloudImageProvider = Boolean(
      byokCfg.geminiApiKey?.trim() ||
        byokCfg.openaiApiKey?.trim() ||
        byokCfg.openrouterApiKey?.trim() ||
        byokCfg.huggingfaceToken?.trim() ||
        byokCfg.replicateToken?.trim() ||
        byokCfg.claudeApiKey?.trim()
    );
    let cloudImageProviderName = 'Cloud BYOK';
    if (byokCfg.geminiApiKey?.trim()) cloudImageProviderName = 'Google Imagen 3 (Gemini)';
    else if (byokCfg.openaiApiKey?.trim()) cloudImageProviderName = 'OpenAI DALL-E 3';
    else if (byokCfg.openrouterApiKey?.trim()) cloudImageProviderName = 'OpenRouter FLUX.1';
    else if (byokCfg.huggingfaceToken?.trim()) cloudImageProviderName = 'HuggingFace FLUX.1';
    else if (byokCfg.replicateToken?.trim()) cloudImageProviderName = 'Replicate FLUX.1';
    else if (byokCfg.claudeApiKey?.trim()) cloudImageProviderName = 'Anthropic Claude SVG';

    const covErrs = this.isSingleSessionMode && this.context.validateCoverage ? this.context.validateCoverage() : [];

    const rows = buildPipelineChecklistRows({
      workingMode: this.context.getCurrentWorkingMode(),
      keyMappingMode: keyMode,
      isBatchMode: !this.isSingleSessionMode,
      totalModelsCount: Math.max(1, this.selectedCandidateIds.size),
      totalSamplesCount: sampleNames.length,
      hasLegacyClassicOnlySources: hasLegacyOnly,
      hasUncoveredMidiKeys: covErrs.length > 0,
      hasExistingCoverArtwork: Boolean(session?.processConfig.coverArtwork),
      sampleNames,
      sampleProcessingFlags: session?.sampleProcessingFlags,
      aiConfig: currentProc.aiConfig,
      dspAlgorithm: currentProc.dspAlgorithm || 'legacy',
      currentSelection: this.checklistSelection,
      engineCtx: {
        aiConfig: currentProc.aiConfig,
        isBridgeConnected: bridgeClient.isConnected(),
        installedBridgeModelIds: this.downloadedModelIds,
        isCloudReady: hasCloudImageProvider || Boolean(firstCloudProvider),
        cloudProviderLabel: hasCloudImageProvider ? cloudImageProviderName : firstCloudProvider,
        dspAlgorithm: currentProc.dspAlgorithm || 'legacy',
      },
    });

    const phases: Array<{ phase: 0 | 1 | 2 | 3; rows: PipelineStepDescriptor[] }> = [
      { phase: 0, rows: rows.filter((r) => r.phase === 0) },
      { phase: 1, rows: rows.filter((r) => r.phase === 1) },
      { phase: 2, rows: rows.filter((r) => r.phase === 2) },
      { phase: 3, rows: rows.filter((r) => r.phase === 3) },
    ];

    const phaseHtml = phases
      .map((p) => {
        const title = p.rows[0]?.phaseTitle ?? `FASE ${p.phase}`;
        const itemsHtml = p.rows
          .map((row) => {
            const stateClass = !row.enabled
              ? 'is-disabled'
              : row.mandatory
                ? 'is-mandatory'
                : row.checked
                  ? 'is-checked'
                  : '';
            return `
              <div class="pipeline-step-row ${stateClass}">
                <div class="pipeline-step-check-col">
                  ${
                    row.mandatory
                      ? `<span class="pipeline-mandatory-lock" title="Paso obligatorio para garantizar la integridad del modelo">${ICONS.lock}</span>`
                      : `<input type="checkbox" class="articulation-checkbox switch--sm chk-pipeline-step" data-step-id="${escAttr(row.id)}" ${row.checked ? 'checked' : ''} ${!row.enabled ? 'disabled' : ''} />`
                  }
                </div>
                <div class="pipeline-step-main-col">
                  <div class="pipeline-step-header-line">
                    <span class="pipeline-step-num">#${row.stepNumber}</span>
                    <strong class="pipeline-step-title">${escHtml(row.title)}</strong>
                    ${
                      row.conditionBadge
                        ? `<span class="pipeline-cond-badge ${row.mandatory ? 'is-mandatory' : !row.enabled ? 'is-disabled' : ''}">${escHtml(row.conditionBadge)}</span>`
                        : ''
                    }
                    ${
                      row.sampleLedgerBadge
                        ? `<span class="pipeline-ledger-badge" title="Estado de marcas por muestra (Sample Processing Ledger)">${ICONS.check} ${escHtml(row.sampleLedgerBadge)}</span>`
                        : ''
                    }
                  </div>
                  <p class="pipeline-step-desc">${escHtml(row.description)}</p>
                </div>
                <div class="pipeline-step-engine-col">
                  ${this.renderEngineBadgeHtml(row)}
                </div>
              </div>
            `;
          })
          .join('');

        return `
          <div class="pipeline-phase-block">
            <div class="pipeline-phase-header">${escHtml(title)}</div>
            <div class="pipeline-phase-list">${itemsHtml}</div>
          </div>
        `;
      })
      .join('');

    const isEs = getAppLocale() === 'es';
    const isDrum = keyMode === 'drum';

    return `
      <div class="nmm-batch-card pipeline-checklist-card">
        <div class="pipeline-checklist-top">
          <div>
            <h3>${isEs ? 'Pipeline de Procesos y Motores de Ejecución (15 Pasos en Orden Canónico)' : 'Process Pipeline & Execution Engines (15 Steps in Canonical Order)'}</h3>
            <p class="nmm-batch-hint">
              ${isEs ? `Selecciona los procesos a ejecutar. Los pasos con candado (${ICONS.lock}) son obligatorios para el modo activo (<strong>${this.context.getCurrentWorkingMode().toUpperCase()} · ${isDrum ? 'DRUM MAP' : 'CHROMATIC'}</strong>). Cada etiqueta muestra si el paso correrá con <strong>DSP Determinista</strong>, <strong>IA Local GPU</strong>, <strong>IA Cloud BYOK</strong> o <strong>Resinator 2 HD</strong>.` : `Select the processes to execute. Locked steps (${ICONS.lock}) are mandatory for the active mode (<strong>${this.context.getCurrentWorkingMode().toUpperCase()} · ${isDrum ? 'DRUM MAP' : 'CHROMATIC'}</strong>). Each badge shows whether the step runs with <strong>Deterministic DSP</strong>, <strong>Local GPU AI</strong>, <strong>Cloud BYOK AI</strong>, or <strong>Resinator 2 HD</strong>.`}
            </p>
          </div>
          <div class="pipeline-checklist-actions">
            <button type="button" class="btn btn-outline btn--sm" id="btn-checklist-recommended">
              ${isEs ? 'Recomendados' : 'Recommended'}
            </button>
            <button type="button" class="btn btn-outline btn--sm" id="btn-checklist-all-audio">
              ${isEs ? 'Activar Todo Audio Pre-DSP' : 'Enable All Pre-DSP Audio'}
            </button>
            <button type="button" class="btn btn-ghost btn--sm" id="btn-checklist-open-ai-settings">
              ${ICONS.sparkle} ${isEs ? 'Configurar IA (8 Etapas)' : 'Configure AI (8 Stages)'}
            </button>
          </div>
        </div>

        <div class="pipeline-checklist-options-bar">
          <label class="batch-check">
            <input type="checkbox" class="articulation-checkbox switch--sm" id="chk-skip-already-processed" ${this.checklistSelection.skipAlreadyProcessedSamples !== false ? 'checked' : ''} />
            <span>${isEs ? 'Omitir procesos en muestras que ya tengan esa marca aplicada (Sample Processing Ledger)' : 'Skip processes on samples that already have that ledger flag applied (Sample Processing Ledger)'}</span>
          </label>
          ${
            isDrum
              ? `
          <label class="batch-check">
            <input type="checkbox" class="articulation-checkbox switch--sm" id="chk-normalize-group-drums" ${this.checklistSelection.normalizeGroupRelativeForDrums !== false ? 'checked' : ''} />
            <span>${isEs ? 'Normalización relativa de grupo en Drum Maps (conservar mezcla entre bombo, caja y charles)' : 'Group-relative normalization in Drum Maps (preserve mix balance across kick, snare, and hi-hats)'}</span>
          </label>
          `
              : ''
          }
        </div>

        <div class="pipeline-phases-container">
          ${phaseHtml}
        </div>
      </div>
    `;
  }

  private renderPreflightStep(): string {
    const isEs = getAppLocale() === 'es';
    const summary = buildBatchPreflightSummary(this.candidates, this.activeConfig, {
      workingMode: this.context.getCurrentWorkingMode(),
      aiEngineLabel: this.context.getAiEngineStatusLabel(),
      selectedIds: this.selectedCandidateIds,
    });
    const gateModel = fromBatchPreflightSummary(summary);

    // Check if Classic mode coverage has errors in single session mode when coverageMidi auto-repair is unchecked
    const coverageErrors =
      this.isSingleSessionMode && this.context.validateCoverage
        ? this.context.validateCoverage()
        : [];
    const classicCoverageNotice =
      this.isSingleSessionMode && coverageErrors.length > 0
        ? `<div class="nmm-alert-subtle pipeline-coverage-notice">
            <strong>${isEs ? 'Nota de Cobertura MIDI:' : 'MIDI Coverage Note:'}</strong> ${isEs ? `Se detectaron ${coverageErrors.length} hueco(s)/solapamiento(s) en 0..127.` : `Detected ${coverageErrors.length} gap(s)/overlap(s) in 0..127.`}
            ${
              this.checklistSelection.steps.coverageMidi
                ? isEs
                  ? 'El Paso #1 (Cobertura MIDI) reparará automáticamente los rangos antes de sintetizar.'
                  : 'Step #1 (MIDI Coverage) will automatically repair ranges before synthesizing.'
                : isEs
                  ? 'En modo Extended (especialmente Drum Maps) se permiten teclas sin asignar.'
                  : 'In Extended mode (especially Drum Maps) unassigned keys are allowed.'
            }
          </div>`
        : '';

    const isAllSelected = this.selectedCandidateIds.size === this.candidates.length;

    const rowsHtml = summary.models.map((m) => {
      const isChecked = this.selectedCandidateIds.has(m.id);
      const fullExpandedName = m.name.trim();
      const classicMName = fullExpandedName.slice(0, 11).trim() || 'UNTITLED';
      return `
        <tr class="nmm-batch-table-row ${isChecked ? 'is-selected' : ''}">
          <td class="col-check">
            <input type="checkbox" class="articulation-checkbox switch--sm chk-candidate-item" data-id="${escAttr(m.id)}" ${isChecked ? 'checked' : ''} ${this.isSingleSessionMode ? 'disabled' : ''} />
          </td>
          <td class="col-name">
            <strong>${escHtml(fullExpandedName)}</strong>
            <span class="nmm-badge-slug" title="${isEs ? 'Classic MName (11 caracteres máx.) · Extended sin límite' : 'Classic MName (11 chars max) · Unlimited Extended'}">Classic: ${escHtml(classicMName)}</span>
            <span class="nmm-badge-slug">${escHtml(m.slug)}</span>
            ${m.isSlicer ? `<span class="issue-tag is-success">Slicer (${m.slicerProfile || 'drums'})</span>` : ''}
          </td>
          <td class="col-origin">${escHtml(m.sourceOrigin)}</td>
          <td class="col-zones">${m.zoneCount} ${m.isSlicer ? (isEs ? 'corte(s) · MIDI' : 'slice(s) · MIDI') : isEs ? 'zona(s)' : 'zone(s)'} · ${m.fileCount} ${isEs ? 'archivo(s)' : 'file(s)'}</td>
          <td class="col-cat">
            <span class="nmm-badge-cat" title="${isEs ? 'Clasificación Dual: Categoría Extended + Parameter Set Classic (0..9)' : 'Dual Classification: Extended Category + Classic Parameter Set (0..9)'}">Ext: ${escHtml(m.detectedCategory)} · Classic Set ${m.suggestedParameterSet}</span>
          </td>
        </tr>
      `;
    }).join('');

    const primaryActionLabel = this.isSingleSessionMode
      ? isEs
        ? 'Ejecutar Pipeline y Generar Modelo Neuron'
        : 'Execute Pipeline & Generate Neuron Model'
      : gateModel.continueLabel;

    return `
      <div class="nmm-batch-preflight-pane">
        <!-- Unified Common Preflight Gate (Fase 35.3) -->
        ${renderCommonPreflightGate(gateModel)}
        ${classicCoverageNotice}

        <!-- Interactive 15-Step Pipeline Checklist (Fase 0..3) -->
        ${this.renderPipelineChecklistCard()}

        <!-- Execution Profile -->
        <div class="nmm-batch-card nmm-preflight-profile">
          <h3>${isEs ? 'Perfil de Ejecución (Heredado de la Sesión Activa)' : 'Execution Profile (Inherited from Active Session)'}</h3>
          <div class="nmm-metric-grid">
            <div class="nmm-metric-card">
              <span class="nmm-metric-lbl">${isEs ? 'Algoritmo DSP:' : 'DSP Algorithm:'}</span>
              <strong class="nmm-metric-val">${escHtml(summary.executionProfile.dspAlgorithmLabel)}</strong>
            </div>
            <div class="nmm-metric-card">
              <span class="nmm-metric-lbl">${isEs ? 'Modo de Trabajo:' : 'Working Mode:'}</span>
              <strong class="nmm-metric-val">${escHtml(summary.executionProfile.workingModeLabel)} (${(this.activeConfig.keyMappingMode ?? 'chromatic') === 'drum' ? 'DRUM MAP' : 'CHROMATIC'})</strong>
            </div>
            <div class="nmm-metric-card">
              <span class="nmm-metric-lbl">${isEs ? 'Motor IA:' : 'AI Engine:'}</span>
              <strong class="nmm-metric-val">${escHtml(summary.executionProfile.aiEngineLabel)}</strong>
            </div>
            <div class="nmm-metric-card">
              <span class="nmm-metric-lbl">${isEs ? 'Complejidad:' : 'Complexity:'}</span>
              <strong class="nmm-metric-val">${escHtml(summary.executionProfile.complexityLabel)}</strong>
            </div>
            <div class="nmm-metric-card nmm-metric-card--full">
              <span class="nmm-metric-lbl">${isEs ? 'Destino' : 'Destination'} (${escHtml(summary.executionProfile.destinationLabel)}):</span>
              ${
                this.activeConfig.destination === 'axionikdb'
                  ? `
              <div class="bank-path-input-wrap">
                <input type="text" id="inp-batch-axionikdb-path" class="form-control" value="${escAttr(this.activeConfig.axionikDbPath || 'd:\\desarrollos\\ABDSynths\\AxionikDB')}" placeholder="d:\\desarrollos\\ABDSynths\\AxionikDB" />
                <button type="button" class="btn btn-outline btn--sm" id="btn-batch-browse-dest" title="${isEs ? 'Navegar por el sistema de archivos para seleccionar la carpeta de destino AxionikDB' : 'Browse filesystem to select destination AxionikDB folder'}">
                  ${ICONS.folder} ${isEs ? 'Examinar...' : 'Browse...'}
                </button>
              </div>
              `
                  : `<strong class="nmm-metric-val"><code>${escHtml(summary.executionProfile.destinationPathOrName)}</code></strong>`
              }
            </div>
            <div class="nmm-metric-card ${this.context.getCurrentWorkingMode() === 'classic' ? 'is-conditioned-disabled' : ''}">
              <span class="nmm-metric-lbl">
                ${isEs ? 'Sub-librería de Destino:' : 'Destination Sub-library:'}
                ${this.context.getCurrentWorkingMode() === 'classic' ? `<span class="cond-reason-badge is-extended-only">${isEs ? 'SOLO EXTENDED' : 'EXTENDED ONLY'}</span>` : ''}
              </span>
              <div class="batch-field">
                <input type="text" id="inp-batch-target-sublib" class="form-control batch-sublib-input" value="${escAttr(this.activeConfig.destinationSublibrary || 'Default')}" placeholder="Default" ${this.context.getCurrentWorkingMode() === 'classic' ? `disabled title="${isEs ? 'Sub-libraries en AxionikDB son exclusivas del Modo Extended' : 'Sub-libraries in AxionikDB are exclusive to Extended Mode'}"` : ''} />
              </div>
            </div>
            <div class="nmm-metric-card">
              <span class="nmm-metric-lbl">${isEs ? 'Duración Estimada:' : 'Estimated Duration:'}</span>
              <strong class="nmm-metric-val">~${summary.estimatedDurationSec} ${isEs ? 'segundos' : 'seconds'}</strong>
            </div>
            ${
              summary.executionProfile.slicerProfileLabel
                ? `
            <div class="nmm-metric-card">
              <span class="nmm-metric-lbl">AutoSlicer Pipeline:</span>
              <strong class="nmm-metric-val batch-val-success">${escHtml(summary.executionProfile.slicerProfileLabel)}</strong>
            </div>
            `
                : ''
            }
          </div>
        </div>

        <!-- Discovered Models Table -->
        ${
          !this.isSingleSessionMode
            ? `
        <div class="nmm-batch-card nmm-preflight-table-card">
          <div class="nmm-preflight-table-header">
            <h3>${isEs ? `Modelos y Archivos Descubiertos (${summary.selectedCount} de ${summary.totalDiscovered} seleccionados)` : `Discovered Models & Files (${summary.selectedCount} of ${summary.totalDiscovered} selected)`}</h3>
            <div class="nmm-preflight-table-actions">
              <button type="button" class="btn btn-ghost" id="btn-toggle-all-candidates">
                ${isAllSelected ? (isEs ? 'Deseleccionar Todos' : 'Deselect All') : isEs ? 'Seleccionar Todos' : 'Select All'}
              </button>
            </div>
          </div>

          <div class="nmm-batch-table-container">
            <table class="nmm-batch-table">
              <thead>
                <tr>
                  <th class="col-check"></th>
                  <th class="col-name">${isEs ? 'Nombre del Modelo y Slug' : 'Model Name & Slug'}</th>
                  <th class="col-origin">${isEs ? 'Origen' : 'Source Origin'}</th>
                  <th class="col-zones">${isEs ? 'Cobertura' : 'Coverage'}</th>
                  <th class="col-cat">${isEs ? 'Clasificación' : 'Classification'}</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
            </table>
          </div>
        </div>
        `
            : ''
        }

        <footer class="nmm-modal-footer">
          <div class="footer-left">
            <span class="triage-count">${this.isSingleSessionMode ? `${isEs ? 'Modelo activo:' : 'Active model:'} ${escHtml(this.candidates[0]?.name || 'Session')}` : isEs ? `${summary.selectedCount} de ${summary.totalDiscovered} seleccionados` : `${summary.selectedCount} of ${summary.totalDiscovered} selected`}</span>
          </div>
          <div class="footer-right">
            <button type="button" class="btn btn-outline" id="btn-preflight-back">
              ${this.isSingleSessionMode ? (isEs ? 'Cancelar' : 'Cancel') : gateModel.adjustLabel}
            </button>
            <button type="button" class="btn btn-primary" id="btn-preflight-start" ${!gateModel.canContinue ? 'disabled' : ''}>
              ${escHtml(primaryActionLabel)}
            </button>
          </div>
        </footer>
      </div>
    `;
  }

  // ── Step 3: Execution ──────────────────────────────────

  private renderRunningStep(): string {
    const isEs = getAppLocale() === 'es';
    const s = this.progressState || this.queue.getProgressState();
    const isPaused = s.status === 'paused';

    const jobRows = this.candidates
      .filter((c) => this.selectedCandidateIds.has(c.id))
      .map((j) => {
        let statusBadge = `<span class="status-pending">${isEs ? 'Pendiente' : 'Pending'}</span>`;
        if (j.status === 'processing') {
          statusBadge = `<span class="status-processing"><span class="nmm-spinner"></span> ${isEs ? 'Procesando' : 'Processing'} (${j.progressPct}%)</span>`;
        } else if (j.status === 'completed') {
          statusBadge = `<span class="status-completed">${isEs ? 'Completado' : 'Completed'}</span>`;
        } else if (j.status === 'failed') {
          statusBadge = `<span class="status-failed" title="${escAttr(j.error || '')}">${isEs ? 'Fallido' : 'Failed'}</span>`;
        } else if (j.status === 'skipped') {
          statusBadge = `<span class="status-skipped">${isEs ? 'Omitido' : 'Skipped'}</span>`;
        }

        return `
          <tr class="nmm-batch-run-row ${j.status}">
            <td class="col-name"><strong>${escHtml(j.name)}</strong></td>
            <td class="col-slug"><code>${escHtml(j.slug)}</code></td>
            <td class="col-status">${statusBadge}</td>
            <td class="col-duration">${j.durationMs ? `${(j.durationMs / 1000).toFixed(1)}s` : '-'}</td>
          </tr>
        `;
      }).join('');

    return `
      <div class="nmm-batch-running-pane">
        <div class="nmm-batch-card">
          <div class="nmm-batch-progress-header">
            <h3>${isEs ? `Procesando Lote: ${s.completedJobs + s.failedJobs} de ${s.totalJobs} modelos` : `Processing Batch: ${s.completedJobs + s.failedJobs} of ${s.totalJobs} models`}</h3>
            <span class="nmm-batch-overall-pct">${s.overallPct}%</span>
          </div>

          <div class="nmm-batch-progress-bar-wrap">
            <div class="nmm-batch-progress-bar-fill" style="width: ${s.overallPct}%"></div>
          </div>

          <div class="nmm-batch-progress-stats">
            <span>${isEs ? 'Etapa:' : 'Stage:'} <strong>${escHtml(s.currentStageLabel || `${isEs ? 'Etapa' : 'Stage'} ${s.currentStageIndex || 1}/${s.totalStages || 5}`)}</strong></span>
            <span>${isEs ? 'Actual:' : 'Current:'} <strong>${escHtml(s.currentJobName || (isEs ? 'Preparando...' : 'Preparing...'))}</strong></span>
            <span>${isEs ? 'Transcurrido:' : 'Elapsed:'} ${(s.elapsedMs / 1000).toFixed(0)}s</span>
            <span>ETA: ${(s.estimatedRemainingMs / 1000).toFixed(0)}s</span>
          </div>
        </div>

        <div class="nmm-batch-card nmm-batch-run-table-card">
          <div class="nmm-batch-table-container">
            <table class="nmm-batch-table">
              <thead>
                <tr>
                  <th class="col-name">${isEs ? 'Modelo' : 'Model'}</th>
                  <th class="col-slug">Slug</th>
                  <th class="col-status">${isEs ? 'Estado' : 'Status'}</th>
                  <th class="col-duration">${isEs ? 'Tiempo' : 'Time'}</th>
                </tr>
              </thead>
              <tbody>
                ${jobRows}
              </tbody>
            </table>
          </div>
        </div>

        <footer class="nmm-modal-footer">
          <div class="footer-left">
            <span class="triage-count">${isEs ? `${s.completedJobs + s.failedJobs} de ${s.totalJobs}` : `${s.completedJobs + s.failedJobs} of ${s.totalJobs}`} · ETA ${(s.estimatedRemainingMs / 1000).toFixed(0)}s</span>
          </div>
          <div class="footer-right">
            <button type="button" class="btn btn-outline" id="btn-batch-pause">
              ${isPaused ? (isEs ? 'Reanudar' : 'Resume') : isEs ? 'Pausar' : 'Pause'}
            </button>
            <button type="button" class="btn btn-danger-solid" id="btn-batch-cancel">${isEs ? 'Cancelar Lote' : 'Cancel Batch'}</button>
          </div>
        </footer>
      </div>
    `;
  }

  // ── Step 4: Completion Summary ─────────────────────────

  private renderDoneStep(): string {
    const isEs = getAppLocale() === 'es';
    const sum = this.finalSummary;
    if (!sum) return '';

    const hasZip = !!sum.masterZipBytes;
    const zipSizeMb = hasZip ? (sum.masterZipBytes!.byteLength / (1024 * 1024)).toFixed(2) : '0';

    return `
      <div class="nmm-batch-done-pane">
        <div class="nmm-batch-card nmm-batch-summary-card">
          <h3>${isEs ? 'Procesamiento por Lotes Finalizado' : 'Batch Processing Finished'}</h3>
          <p class="nmm-batch-hint">${isEs ? `Completado en ${(sum.totalDurationMs / 1000).toFixed(1)} segundos.` : `Completed in ${(sum.totalDurationMs / 1000).toFixed(1)} seconds.`}</p>

          <div class="nmm-batch-summary-stats">
            <div class="stat-box success">
              <span class="stat-num">${sum.succeeded}</span>
              <span class="stat-lbl">${isEs ? 'Exitosos' : 'Succeeded'}</span>
            </div>
            <div class="stat-box danger">
              <span class="stat-num">${sum.failed}</span>
              <span class="stat-lbl">${isEs ? 'Fallidos' : 'Failed'}</span>
            </div>
            <div class="stat-box neutral">
              <span class="stat-num">${sum.skipped}</span>
              <span class="stat-lbl">${isEs ? 'Omitidos' : 'Skipped'}</span>
            </div>
          </div>
        </div>

        <footer class="nmm-modal-footer">
          <div class="footer-left">
            <span class="triage-count">${sum.succeeded} ok · ${sum.failed} ${isEs ? 'fallidos' : 'failed'} · ${sum.skipped} ${isEs ? 'omitidos' : 'skipped'}</span>
          </div>
          <div class="footer-right">
            ${hasZip ? `<button type="button" class="btn btn-primary" id="btn-download-master-zip">${isEs ? `Descargar ZIP Maestro (${zipSizeMb} MB)` : `Download Master ZIP (${zipSizeMb} MB)`}</button>` : ''}
            <button type="button" class="btn btn-outline" id="btn-batch-export-json">${isEs ? 'Exportar Registro (JSON)' : 'Export Log (JSON)'}</button>
            <button type="button" class="btn btn-ghost" id="btn-batch-finish-close">${isEs ? 'Cerrar' : 'Close'}</button>
          </div>
        </footer>
      </div>
    `;
  }

  // ── Event Bindings ─────────────────────────────────────

  private bindEvents(): void {
    if (!this.backdropEl) return;

    // Close button
    this.backdropEl.querySelector('#btn-batch-close')?.addEventListener('click', () => this.close());

    // Step 1: Mode Switcher & Slicer Controls
    this.backdropEl.querySelector('#btn-batch-mode-multisample')?.addEventListener('click', () => {
      this.activeConfig.ingestionMode = 'multisample';
      this.render();
    });

    this.backdropEl.querySelector('#btn-batch-mode-slicer')?.addEventListener('click', () => {
      this.activeConfig.ingestionMode = 'slicer';
      this.render();
    });

    const profileSel = this.backdropEl.querySelector('#sel-batch-slicer-profile') as HTMLSelectElement | null;
    profileSel?.addEventListener('change', () => {
      this.activeConfig.slicerProfile = profileSel.value as any;
    });

    const exportMidiChk = this.backdropEl.querySelector('#chk-batch-export-midi') as HTMLInputElement | null;
    exportMidiChk?.addEventListener('change', () => {
      this.activeConfig.exportMidiPattern = exportMidiChk.checked;
    });

    const vramSafetyChk = this.backdropEl.querySelector('#chk-batch-vram-safety') as HTMLInputElement | null;
    vramSafetyChk?.addEventListener('change', () => {
      this.activeConfig.stagePipelineVramSafety = vramSafetyChk.checked;
    });

    const stageGroupedChk = this.backdropEl.querySelector('#chk-batch-stage-grouped') as HTMLInputElement | null;
    stageGroupedChk?.addEventListener('change', () => {
      this.activeConfig.executionOrder = stageGroupedChk.checked ? 'stage-grouped' : 'per-job';
      this.render();
    });

    // Step 1: Dropzone drag-and-drop & File inputs
    const dropzone = this.backdropEl.querySelector('#batch-dropzone') as HTMLElement | null;
    dropzone?.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    });
    dropzone?.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
    });
    dropzone?.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      await this.ingestBatchFiles(Array.from(files));
    });

    const loopsInput = this.backdropEl.querySelector('#input-batch-loops') as HTMLInputElement | null;
    loopsInput?.addEventListener('change', async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files || files.length === 0) return;
      await this.handleLoopFiles(Array.from(files));
    });

    const sf2Input = this.backdropEl.querySelector('#input-batch-sf2') as HTMLInputElement | null;
    sf2Input?.addEventListener('change', async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files || files.length === 0) return;
      await this.ingestBatchFiles(Array.from(files));
    });

    const folderInput = this.backdropEl.querySelector('#input-batch-folder') as HTMLInputElement | null;
    folderInput?.addEventListener('change', async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files || files.length === 0) return;
      await this.ingestBatchFiles(Array.from(files));
    });

    // Step 1: Browse & Scan local disk path via Companion Bridge
    const scanPathInput = this.backdropEl.querySelector('#input-batch-scan-path') as HTMLInputElement | null;
    scanPathInput?.addEventListener('change', () => {
      this.localScanPath = scanPathInput.value.trim() || this.localScanPath;
    });
    const browseDiskBtn = this.backdropEl.querySelector('#btn-batch-browse-disk');
    browseDiskBtn?.addEventListener('click', async () => {
      const picked = await browseFilesystemFolder({
        initialPath: scanPathInput?.value.trim() || this.localScanPath,
        title: 'Seleccionar carpeta de muestras o bancos locales',
      });
      if (picked) {
        this.localScanPath = picked;
        if (scanPathInput) scanPathInput.value = picked;
        toast(`Carpeta seleccionada: ${picked}`, 'info');
      }
    });

    const scanBtn = this.backdropEl.querySelector('#btn-batch-scan-disk');
    scanBtn?.addEventListener('click', async () => {
      const pathInput = this.backdropEl?.querySelector('#input-batch-scan-path') as HTMLInputElement | null;
      const targetPath = pathInput?.value.trim() || '';
      if (!targetPath) {
        toast('Please enter a directory path on your local disk.', 'warning');
        return;
      }
      this.localScanPath = targetPath;
      this.isScanningLocal = true;
      this.render();
      try {
        const scanResult = await bridgeClient.scanLocalFiles(targetPath);
        const sf2Count = scanResult.files.filter((f) => f.ext.toLowerCase() === '.sf2').length;
        const wavCount = scanResult.files.filter((f) => ['.wav', '.aif', '.aiff'].includes(f.ext.toLowerCase())).length;
        toast(`Discovered ${scanResult.total_files} files (${sf2Count} soundfonts, ${wavCount} audio samples).`, 'info');
        // When soundfonts found, we can parse or offer to load
        this.isScanningLocal = false;
        this.render();
      } catch (err) {
        this.isScanningLocal = false;
        toast(`Scan failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
        this.render();
      }
    });

    // Step 2: Interactive 15-Step Pipeline Checklist Controls
    this.backdropEl.querySelectorAll('.chk-pipeline-step').forEach((chk) => {
      chk.addEventListener('change', (e) => {
        const stepId = (e.target as HTMLElement).getAttribute('data-step-id') as PipelineStepId | null;
        if (!stepId) return;
        this.checklistSelection.steps[stepId] = (e.target as HTMLInputElement).checked;
        this.activeConfig.checklistSelection = this.checklistSelection;
        this.render();
      });
    });

    const skipProcessedChk = this.backdropEl.querySelector('#chk-skip-already-processed') as HTMLInputElement | null;
    skipProcessedChk?.addEventListener('change', () => {
      this.checklistSelection.skipAlreadyProcessedSamples = skipProcessedChk.checked;
      this.activeConfig.checklistSelection = this.checklistSelection;
      this.render();
    });

    const groupDrumsChk = this.backdropEl.querySelector('#chk-normalize-group-drums') as HTMLInputElement | null;
    groupDrumsChk?.addEventListener('change', () => {
      this.checklistSelection.normalizeGroupRelativeForDrums = groupDrumsChk.checked;
      this.activeConfig.checklistSelection = this.checklistSelection;
      this.render();
    });

    this.backdropEl.querySelector('#btn-checklist-recommended')?.addEventListener('click', () => {
      this.resetChecklistToDefaults();
      this.render();
    });

    this.backdropEl.querySelector('#btn-checklist-all-audio')?.addEventListener('click', () => {
      const isDrum = (this.activeConfig.keyMappingMode ?? 'chromatic') === 'drum';
      this.checklistSelection.steps.trimSilence = true;
      this.checklistSelection.steps.deEsser = true;
      this.checklistSelection.steps.denoise = true;
      this.checklistSelection.steps.upsampleMasterWave = true;
      this.checklistSelection.steps.normalize = true;
      if (!isDrum) {
        this.checklistSelection.steps.pitchAndLoop = true;
      }
      this.activeConfig.checklistSelection = this.checklistSelection;
      this.render();
    });

    this.backdropEl.querySelector('#btn-checklist-open-ai-settings')?.addEventListener('click', () => {
      this.context.onOpenAiSettings?.();
    });

    // Step 2: Toggle candidate selections
    this.backdropEl.querySelectorAll('.chk-candidate-item').forEach((chk) => {
      chk.addEventListener('change', (e) => {
        const id = (e.target as HTMLElement).getAttribute('data-id');
        if (!id) return;
        if ((e.target as HTMLInputElement).checked) {
          this.selectedCandidateIds.add(id);
        } else {
          this.selectedCandidateIds.delete(id);
        }
        this.render();
      });
    });

    this.backdropEl.querySelector('#btn-toggle-all-candidates')?.addEventListener('click', () => {
      if (this.selectedCandidateIds.size === this.candidates.length) {
        this.selectedCandidateIds.clear();
      } else {
        this.candidates.forEach((c) => this.selectedCandidateIds.add(c.id));
      }
      this.render();
    });

    this.backdropEl.querySelector('#btn-preflight-back')?.addEventListener('click', () => {
      if (this.isSingleSessionMode) {
        this.close();
        return;
      }
      this.currentStep = 'discover';
      this.render();
    });

    const destPathInput = this.backdropEl.querySelector('#inp-batch-axionikdb-path') as HTMLInputElement | null;
    destPathInput?.addEventListener('change', () => {
      const val = destPathInput.value.trim();
      if (val) {
        this.activeConfig.axionikDbPath = val;
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('abd_axionikdb_path', val);
        }
      }
    });

    this.backdropEl.querySelector('#btn-batch-browse-dest')?.addEventListener('click', async () => {
      const picked = await browseFilesystemFolder({
        initialPath: destPathInput?.value.trim() || this.activeConfig.axionikDbPath,
        title: 'Seleccionar carpeta de destino AxionikDB',
      });
      if (picked) {
        this.activeConfig.axionikDbPath = picked;
        if (destPathInput) destPathInput.value = picked;
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('abd_axionikdb_path', picked);
        }
        toast(`Carpeta de destino actualizada: ${picked}`, 'info');
      }
    });

    const sublibInput = this.backdropEl.querySelector('#inp-batch-target-sublib') as HTMLInputElement | null;
    sublibInput?.addEventListener('input', (e) => {
      this.activeConfig.destinationSublibrary = (e.target as HTMLInputElement).value.trim() || 'Default';
    });

    this.backdropEl.querySelector('#btn-preflight-start')?.addEventListener('click', async () => {
      if (this.isSingleSessionMode) {
        const procConfig = { ...this.context.getCurrentProcessConfig() };
        if (this.checklistSelection.steps.enhanceClassicModel) {
          procConfig.dspAlgorithm = 'enhanced';
        }
        const checklistSnapshot: PipelineChecklistSelection = {
          steps: { ...this.checklistSelection.steps },
          skipAlreadyProcessedSamples: this.checklistSelection.skipAlreadyProcessedSamples,
          normalizeGroupRelativeForDrums: this.checklistSelection.normalizeGroupRelativeForDrums,
        };
        const forceReanalyze = Boolean(
          checklistSnapshot.steps.enhanceClassicModel ||
            checklistSnapshot.steps.reconstructFromClassic
        );
        this.cleanup();
        await this.context.onStartSingleModelProcess?.(procConfig, {
          forceReanalyzeImported: forceReanalyze,
          checklist: checklistSnapshot,
        });
        return;
      }
      await this.startQueue();
    });

    // Step 3: Running controls
    this.backdropEl.querySelector('#btn-batch-pause')?.addEventListener('click', () => {
      const state = this.queue.getProgressState();
      if (state.status === 'paused') {
        this.queue.resume();
      } else {
        this.queue.pause();
      }
      this.render();
    });

    this.backdropEl.querySelector('#btn-batch-cancel')?.addEventListener('click', () => {
      void confirmDialog('Are you sure you want to cancel the batch?', {
        title: 'Cancel batch?',
        confirmLabel: 'Cancel batch',
        cancelLabel: 'Keep running',
        danger: true,
      }).then((ok) => {
        if (ok) this.queue.cancel();
      });
    });

    // Step 4: Done actions
    this.backdropEl.querySelector('#btn-download-master-zip')?.addEventListener('click', () => {
      if (this.finalSummary?.masterZipBytes) {
        this.downloadBlob(
          this.finalSummary.masterZipBytes,
          this.activeConfig.outputMasterZipName || 'BatchExport.zip',
          'application/zip'
        );
      }
    });

    this.backdropEl.querySelector('#btn-batch-export-json')?.addEventListener('click', () => {
      if (this.finalSummary) {
        const text = JSON.stringify(this.finalSummary, null, 2);
        this.downloadBlob(new TextEncoder().encode(text), 'BatchLog.json', 'application/json');
      }
    });

    this.backdropEl.querySelector('#btn-batch-finish-close')?.addEventListener('click', () => {
      this.context.onRefreshBankDrawer?.();
      this.close();
    });
  }

  // ── Source Ingestion Helpers ───────────────────────────

  public loadCandidates(candidates: BatchModelCandidate[], originTitle?: string): void {
    if (candidates.length === 0) return;
    if (!this.backdropEl) {
      this.open();
    }
    this.isSingleSessionMode = false;
    this.candidates = candidates;
    this.selectedCandidateIds = new Set(candidates.map((c) => c.id));
    const allDrum = candidates.every((c) => /drum|kit|perc/i.test(c.detectedCategory || ''));
    this.activeConfig.keyMappingMode = allDrum
      ? 'drum'
      : (this.context.getCurrentProcessConfig().keyMappingMode ?? 'chromatic');
    this.resetChecklistToDefaults();
    this.currentStep = 'preflight';
    this.render();
    if (originTitle) {
      toast(`Loaded ${candidates.length} candidates from ${originTitle}.`, 'success');
    }
  }

  public loadSf2Buffer(buffer: ArrayBuffer, soundFontName: string): void {
    try {
      const extracted = extractSf2PresetsToCandidates(buffer, { soundFontName: soundFontName.replace(/\.[^.]+$/, '') });
      if (extracted.length === 0) {
        toast(`No presets found in SoundFont "${soundFontName}".`, 'warning');
        return;
      }
      this.loadCandidates(extracted, soundFontName);
    } catch (err) {
      toast(`Failed to read SoundFont: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }

  /**
   * Unified multi-format batch ingestion from in-memory expanded files/containers:
   * Can be invoked directly from the Nav-bar / MultiInstrumentModal / UniversalImportModal
   * without forcing the user to re-select the file or folder.
   */
  public async loadExpandedFiles(
    inputFiles: TriageExpandedFile[],
    originTitle?: string
  ): Promise<void> {
    if (inputFiles.length === 0) return;
    try {
      if (!this.backdropEl) {
        this.open();
      }
      await withLoading(
        originTitle ? `PREPARING BATCH: ${originTitle}...` : 'PREPARING BATCH CANDIDATES...',
        'EXPANDING ARCHIVES & SCANNING PROGRAMS...',
        async () => {
          const expandedFiles: TriageExpandedFile[] = [];
          for (const f of inputFiles) {
            const ext = fileExtension(f.name);
            if (ext === 'zip') {
              try {
                const zipEntries = parseZipArchive(new Uint8Array(f.buffer));
                for (const entry of zipEntries) {
                  if (entry.data.byteLength > 0) {
                    expandedFiles.push({
                      name: entry.path,
                      buffer: entry.data.buffer.slice(
                        entry.data.byteOffset,
                        entry.data.byteOffset + entry.data.byteLength
                      ) as ArrayBuffer,
                    });
                  }
                }
                continue;
              } catch {
                // Fall through if not a standard zip or if it's a disguised container
              }
            }
            expandedFiles.push(f);
          }

          if (this.activeConfig.ingestionMode === 'slicer') {
            const loopInputs: FolderFileInput[] = expandedFiles.map((ef) => ({
              path: ef.name,
              name: ef.name.split('/').pop() || ef.name,
              buffer: ef.buffer,
            }));
            const extractedLoops = extractFolderLoopsToCandidates(loopInputs, {
              slicerProfile: this.activeConfig.slicerProfile || 'drums',
              bpm: this.activeConfig.slicerBpm,
            });
            if (extractedLoops.length === 0) {
              toast('No supported loop or audio files found for Batch AutoSlicer.', 'warning');
              return;
            }
            this.loadCandidates(extractedLoops, originTitle || 'Batch AutoSlicer');
            return;
          }

          const allCandidates: BatchModelCandidate[] = [];

          // 1. Discover multi-asset definitions (.sf2, .sfz, .dspreset, .nki, .vstpreset, .exs, .xpm, .model, etc.)
          const byPath = indexTriageBuffers(expandedFiles);
          const report = await discoverTriageReport(expandedFiles, originTitle || 'Batch Selection');
          if (report && report.items.length > 0) {
            const partition = partitionTriageSelection(report.items, byPath);
            for (const sf2 of partition.sf2Blobs) {
              const baseName = (sf2.name.split('/').pop() || sf2.name).replace(/\.[^.]+$/, '');
              const sf2Candidates = extractSf2PresetsToCandidates(sf2.buffer, { soundFontName: baseName });
              allCandidates.push(...sf2Candidates);
            }
            if (partition.skipped.length > 0) {
              const { candidates: defCandidates } = await extractTriageDefinitionCandidates(partition.skipped, byPath);
              allCandidates.push(...defCandidates);
            }
            if (partition.audioInputs.length > 0) {
              const audioCandidates = extractFolderFilesToCandidates(partition.audioInputs);
              allCandidates.push(...audioCandidates);
            }
          }

          // 2. Fallback for standalone files not covered by triage discovery (e.g. .iso/.img/.dsk, standalone .sf2, or raw audio)
          if (allCandidates.length === 0) {
            const fallbackAudioInputs: FolderFileInput[] = [];
            for (const ef of expandedFiles) {
              const baseName = ef.name.split('/').pop() || ef.name;
              const ext = fileExtension(baseName);
              if (ext === 'sf2') {
                const sf2Candidates = extractSf2PresetsToCandidates(ef.buffer, {
                  soundFontName: baseName.replace(/\.[^.]+$/, ''),
                });
                allCandidates.push(...sf2Candidates);
              } else {
                const siblings = new Map<string, Uint8Array>();
                for (const other of expandedFiles) {
                  if (other === ef) continue;
                  const otherBase = other.name.split('/').pop() || other.name;
                  siblings.set(otherBase, new Uint8Array(other.buffer));
                  siblings.set(other.name.replace(/\\/g, '/'), new Uint8Array(other.buffer));
                }
                let parsedAsContainer = false;
                if (!['wav', 'aif', 'aiff', 'aifc', 'flac', 'mp3', 'ogg', 'oga', 'm4a', 'aac', 'opus', 'webm', 'caf'].includes(ext)) {
                  try {
                    const diskProgs = await listZipSamplerPrograms(baseName, ef.buffer);
                    const progIdsToExtract = diskProgs.length > 0 ? diskProgs.map((p) => p.id) : [undefined];
                    for (let idx = 0; idx < progIdsToExtract.length; idx++) {
                      const progId = progIdsToExtract[idx];
                      if (idx > 0 && idx % 6 === 0) {
                        loadingModal.setMessage(
                          `EXTRACTING PROGRAMS FROM ${baseName.toUpperCase()} (${idx + 1}/${progIdsToExtract.length})...`
                        );
                        await yieldToUI(0);
                      }
                      try {
                        const preset = await parseUniversalSampler(baseName, ef.buffer, siblings, progId);
                        if (preset && preset.audioBuffers.size > 0) {
                          const adapted = applyPreflightImportAdaptations(preset, {
                            autoExtendOuterZones: false,
                            adaptVelocityLayers: true,
                            switchToExtendedMode: true,
                            currentWorkingMode: 'extended',
                          });
                          const batchFiles = Array.from(adapted.audioBuffers.entries(), ([name, buffer]) => ({
                            name,
                            buffer,
                          }));
                          const displayName = preset.presetName || baseName.replace(/\.[^.]+$/, '');
                          allCandidates.push({
                            id: `uni-${allCandidates.length + 1}-${slugifyModelName(displayName)}`,
                            name: displayName,
                            slug: slugifyModelName(displayName),
                            sourceType: 'folder-pack',
                            sourceOrigin: progId ? `${ef.name} [${progId}]` : ef.name,
                            zoneCount: Math.max(1, adapted.classicZones.length || adapted.extendedRegions.length),
                            detectedCategory: preset.detectedCategory || 'Auto',
                            suggestedParameterSet: Number.isFinite(Number(preset.suggestedParameterSet))
                              ? Math.max(0, Math.min(9, Number(preset.suggestedParameterSet)))
                              : 0,
                            suggestedComplexity: 8,
                            status: 'pending',
                            progressPct: 0,
                            files: batchFiles,
                            classicZones: adapted.classicZones,
                            extendedRegions: adapted.extendedRegions,
                          });
                          parsedAsContainer = true;
                        }
                      } catch {
                        // Continue with remaining programs in disk image
                      }
                    }
                  } catch {
                    // Not a container preset or missing external samples
                  }
                }
                if (!parsedAsContainer) {
                  fallbackAudioInputs.push({
                    path: ef.name,
                    name: baseName,
                    buffer: ef.buffer,
                  });
                }
              }
            }
            if (fallbackAudioInputs.length > 0) {
              allCandidates.push(...extractFolderFilesToCandidates(fallbackAudioInputs));
            }
          }

          if (allCandidates.length === 0) {
            toast('No supported sampler banks, presets, disk images, or audio files found in selection.', 'warning');
            return;
          }

          this.loadCandidates(allCandidates, originTitle);
        }
      );
    } catch (err) {
      toast(`Failed to ingest batch files: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }

  /**
   * Unified multi-format batch ingestion from File[]:
   * Supports .sf2, .sfz, .dspreset, .nki, .vstpreset, .multisample, .adv, .exs,
   * .talsmpl, .txprog, .kmp, .ksf, .dls, .xpm, .xty, .xtd, .xpn, .pgm, .akp,
   * .s3p, .sxt, .dwp, .krz, .k25, .k26, .x7u, .x8u, .x3a, .model, .neuronikmodel,
   * .nmmodel, .nmpack, .scape, .sphere, .iso, .img, .dsk, .out, .hda, .efe, .ede,
   * .zip, .rx2, .rex, .rcy, .cue, and all audio formats.
   */
  public async ingestBatchFiles(files: File[]): Promise<void> {
    if (files.length === 0) return;
    const expandedFiles: TriageExpandedFile[] = [];
    for (const f of files) {
      const relPath = f.webkitRelativePath || f.name;
      const buf = await f.arrayBuffer();
      expandedFiles.push({ name: relPath, buffer: buf });
    }
    const originTitle = files.length === 1 ? files[0].name : `${files.length} files`;
    await this.loadExpandedFiles(expandedFiles, originTitle);
  }

  /**
   * Fase 25: Handles batch selection of loop and beat files.
   */
  private async handleLoopFiles(files: File[]): Promise<void> {
    try {
      const fileInputs: FolderFileInput[] = [];
      for (const f of files) {
        fileInputs.push({
          path: f.name,
          name: f.name,
          buffer: await f.arrayBuffer(),
        });
      }

      const extracted = extractFolderLoopsToCandidates(fileInputs, {
        slicerProfile: this.activeConfig.slicerProfile || 'drums',
        bpm: this.activeConfig.slicerBpm,
      });

      if (extracted.length === 0) {
        toast('No supported loop or audio files (.wav, .rx2, .rex, .flac, .mp3, .ogg) selected.', 'warning');
        return;
      }

      this.candidates = extracted;
      this.selectedCandidateIds = new Set(extracted.map((c) => c.id));
      this.currentStep = 'preflight';
      this.render();
      toast(`Discovered ${extracted.length} loop(s) for Batch AutoSlicer.`, 'success');
    } catch (err) {
      toast(`Failed to read loop files: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }

  // ── Queue Execution ────────────────────────────────────

  private async startQueue(): Promise<void> {
    const selectedJobs = this.candidates.filter((c) => this.selectedCandidateIds.has(c.id));
    if (selectedJobs.length === 0) {
      toast('Please select at least one model to process.', 'warning');
      return;
    }

    this.activeConfig.aiConfig = this.context.getCurrentProcessConfig().aiConfig;
    this.activeConfig.checklistSelection = this.checklistSelection;
    if (this.checklistSelection.steps.enhanceClassicModel) {
      this.activeConfig.dspAlgorithm = 'enhanced';
    }
    this.queue.setJobs(selectedJobs);
    this.currentStep = 'running';
    this.render();

    this.unsubscribeQueue = this.queue.on((event, data) => {
      if (event === 'progress') {
        this.progressState = data as BatchProgressState;
        this.render();
      } else if (event === 'stage-start') {
        this.progressState = this.queue.getProgressState();
        this.render();
      } else if (event === 'queue-complete') {
        this.finalSummary = data as BatchResultSummary;
        this.currentStep = 'done';
        this.render();
      }
    });

    try {
      await this.queue.start(this.activeConfig);
    } catch (err) {
      toast(`Batch queue error: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }

  private downloadBlob(bytes: Uint8Array, fileName: string, mimeType: string): void {
    downloadBytes(bytes as unknown as BlobPart, fileName, mimeType);
  }
}
