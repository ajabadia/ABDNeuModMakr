// ─────────────────────────────────────────────────────────
// BatchProcessorModal — batchEvents (Fase 42.5)
// Funciones extraidas verbatim de `src/ui/BatchProcessorModal.ts`.
// `modal` es el nucleo estructural (`BatchModalCore`).
// ─────────────────────────────────────────────────────────

import { browseFilesystemFolder } from '../folderPicker.ts';
import { confirmDialog, toast } from '../notify.ts';
import type { PipelineChecklistSelection, PipelineStepId } from '../../core/types.ts';
import { bridgeClient } from '../../core/bridge/BridgeClient.ts';
import type { BatchModalCore } from './batchModalCore.ts';
import { downloadBlob, handleLoopFiles, ingestBatchFiles, startQueue } from './batchQueueOps.ts';


  // ── Event Bindings ─────────────────────────────────────

export function bindEvents(modal: BatchModalCore): void {
    if (!modal.backdropEl) return;

    // Close button
    modal.backdropEl.querySelector('#btn-batch-close')?.addEventListener('click', () => modal.close());

    // Step 1: Mode Switcher & Slicer Controls
    modal.backdropEl.querySelector('#btn-batch-mode-multisample')?.addEventListener('click', () => {
      modal.activeConfig.ingestionMode = 'multisample';
      modal.render();
    });

    modal.backdropEl.querySelector('#btn-batch-mode-slicer')?.addEventListener('click', () => {
      modal.activeConfig.ingestionMode = 'slicer';
      modal.render();
    });

    const profileSel = modal.backdropEl.querySelector('#sel-batch-slicer-profile') as HTMLSelectElement | null;
    profileSel?.addEventListener('change', () => {
      modal.activeConfig.slicerProfile = profileSel.value as any;
    });

    const exportMidiChk = modal.backdropEl.querySelector('#chk-batch-export-midi') as HTMLInputElement | null;
    exportMidiChk?.addEventListener('change', () => {
      modal.activeConfig.exportMidiPattern = exportMidiChk.checked;
    });

    const vramSafetyChk = modal.backdropEl.querySelector('#chk-batch-vram-safety') as HTMLInputElement | null;
    vramSafetyChk?.addEventListener('change', () => {
      modal.activeConfig.stagePipelineVramSafety = vramSafetyChk.checked;
    });

    const stageGroupedChk = modal.backdropEl.querySelector('#chk-batch-stage-grouped') as HTMLInputElement | null;
    stageGroupedChk?.addEventListener('change', () => {
      modal.activeConfig.executionOrder = stageGroupedChk.checked ? 'stage-grouped' : 'per-job';
      modal.render();
    });

    // Step 1: Dropzone drag-and-drop & File inputs
    const dropzone = modal.backdropEl.querySelector('#batch-dropzone') as HTMLElement | null;
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
      await ingestBatchFiles(modal, Array.from(files));
    });

    const loopsInput = modal.backdropEl.querySelector('#input-batch-loops') as HTMLInputElement | null;
    loopsInput?.addEventListener('change', async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files || files.length === 0) return;
      await handleLoopFiles(modal, Array.from(files));
    });

    const sf2Input = modal.backdropEl.querySelector('#input-batch-sf2') as HTMLInputElement | null;
    sf2Input?.addEventListener('change', async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files || files.length === 0) return;
      await ingestBatchFiles(modal, Array.from(files));
    });

    const folderInput = modal.backdropEl.querySelector('#input-batch-folder') as HTMLInputElement | null;
    folderInput?.addEventListener('change', async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files || files.length === 0) return;
      await ingestBatchFiles(modal, Array.from(files));
    });

    // Step 1: Browse & Scan local disk path via Companion Bridge
    const scanPathInput = modal.backdropEl.querySelector('#input-batch-scan-path') as HTMLInputElement | null;
    scanPathInput?.addEventListener('change', () => {
      modal.localScanPath = scanPathInput.value.trim() || modal.localScanPath;
    });
    const browseDiskBtn = modal.backdropEl.querySelector('#btn-batch-browse-disk');
    browseDiskBtn?.addEventListener('click', async () => {
      const picked = await browseFilesystemFolder({
        initialPath: scanPathInput?.value.trim() || modal.localScanPath,
        title: 'Seleccionar carpeta de muestras o bancos locales',
      });
      if (picked) {
        modal.localScanPath = picked;
        if (scanPathInput) scanPathInput.value = picked;
        toast(`Carpeta seleccionada: ${picked}`, 'info');
      }
    });

    const scanBtn = modal.backdropEl.querySelector('#btn-batch-scan-disk');
    scanBtn?.addEventListener('click', async () => {
      const pathInput = modal.backdropEl?.querySelector('#input-batch-scan-path') as HTMLInputElement | null;
      const targetPath = pathInput?.value.trim() || '';
      if (!targetPath) {
        toast('Please enter a directory path on your local disk.', 'warning');
        return;
      }
      modal.localScanPath = targetPath;
      modal.isScanningLocal = true;
      modal.render();
      try {
        const scanResult = await bridgeClient.scanLocalFiles(targetPath);
        const sf2Count = scanResult.files.filter((f) => f.ext.toLowerCase() === '.sf2').length;
        const wavCount = scanResult.files.filter((f) => ['.wav', '.aif', '.aiff'].includes(f.ext.toLowerCase())).length;
        toast(`Discovered ${scanResult.total_files} files (${sf2Count} soundfonts, ${wavCount} audio samples).`, 'info');
        // When soundfonts found, we can parse or offer to load
        modal.isScanningLocal = false;
        modal.render();
      } catch (err) {
        modal.isScanningLocal = false;
        toast(`Scan failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
        modal.render();
      }
    });

    // Step 2: Interactive 15-Step Pipeline Checklist Controls
    modal.backdropEl.querySelectorAll('.chk-pipeline-step').forEach((chk) => {
      chk.addEventListener('change', (e) => {
        const stepId = (e.target as HTMLElement).getAttribute('data-step-id') as PipelineStepId | null;
        if (!stepId) return;
        modal.checklistSelection.steps[stepId] = (e.target as HTMLInputElement).checked;
        modal.activeConfig.checklistSelection = modal.checklistSelection;
        modal.render();
      });
    });

    const skipProcessedChk = modal.backdropEl.querySelector('#chk-skip-already-processed') as HTMLInputElement | null;
    skipProcessedChk?.addEventListener('change', () => {
      modal.checklistSelection.skipAlreadyProcessedSamples = skipProcessedChk.checked;
      modal.activeConfig.checklistSelection = modal.checklistSelection;
      modal.render();
    });

    const groupDrumsChk = modal.backdropEl.querySelector('#chk-normalize-group-drums') as HTMLInputElement | null;
    groupDrumsChk?.addEventListener('change', () => {
      modal.checklistSelection.normalizeGroupRelativeForDrums = groupDrumsChk.checked;
      modal.activeConfig.checklistSelection = modal.checklistSelection;
      modal.render();
    });

    modal.backdropEl.querySelector('#btn-checklist-recommended')?.addEventListener('click', () => {
      modal.resetChecklistToDefaults();
      modal.render();
    });

    modal.backdropEl.querySelector('#btn-checklist-all-audio')?.addEventListener('click', () => {
      const isDrum = (modal.activeConfig.keyMappingMode ?? 'chromatic') === 'drum';
      modal.checklistSelection.steps.trimSilence = true;
      modal.checklistSelection.steps.deEsser = true;
      modal.checklistSelection.steps.denoise = true;
      modal.checklistSelection.steps.upsampleMasterWave = true;
      modal.checklistSelection.steps.normalize = true;
      if (!isDrum) {
        modal.checklistSelection.steps.pitchAndLoop = true;
      }
      modal.activeConfig.checklistSelection = modal.checklistSelection;
      modal.render();
    });

    modal.backdropEl.querySelector('#btn-checklist-open-ai-settings')?.addEventListener('click', () => {
      modal.context.onOpenAiSettings?.();
    });

    // Step 2: Toggle candidate selections
    modal.backdropEl.querySelectorAll('.chk-candidate-item').forEach((chk) => {
      chk.addEventListener('change', (e) => {
        const id = (e.target as HTMLElement).getAttribute('data-id');
        if (!id) return;
        if ((e.target as HTMLInputElement).checked) {
          modal.selectedCandidateIds.add(id);
        } else {
          modal.selectedCandidateIds.delete(id);
        }
        modal.render();
      });
    });

    modal.backdropEl.querySelector('#btn-toggle-all-candidates')?.addEventListener('click', () => {
      if (modal.selectedCandidateIds.size === modal.candidates.length) {
        modal.selectedCandidateIds.clear();
      } else {
        modal.candidates.forEach((c) => modal.selectedCandidateIds.add(c.id));
      }
      modal.render();
    });

    modal.backdropEl.querySelector('#btn-preflight-back')?.addEventListener('click', () => {
      if (modal.isSingleSessionMode) {
        modal.close();
        return;
      }
      modal.currentStep = 'discover';
      modal.render();
    });

    const destPathInput = modal.backdropEl.querySelector('#inp-batch-axionikdb-path') as HTMLInputElement | null;
    destPathInput?.addEventListener('change', () => {
      const val = destPathInput.value.trim();
      if (val) {
        modal.activeConfig.axionikDbPath = val;
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('abd_axionikdb_path', val);
        }
      }
    });

    modal.backdropEl.querySelector('#btn-batch-browse-dest')?.addEventListener('click', async () => {
      const picked = await browseFilesystemFolder({
        initialPath: destPathInput?.value.trim() || modal.activeConfig.axionikDbPath,
        title: 'Seleccionar carpeta de destino AxionikDB',
      });
      if (picked) {
        modal.activeConfig.axionikDbPath = picked;
        if (destPathInput) destPathInput.value = picked;
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('abd_axionikdb_path', picked);
        }
        toast(`Carpeta de destino actualizada: ${picked}`, 'info');
      }
    });

    const sublibInput = modal.backdropEl.querySelector('#inp-batch-target-sublib') as HTMLInputElement | null;
    sublibInput?.addEventListener('input', (e) => {
      modal.activeConfig.destinationSublibrary = (e.target as HTMLInputElement).value.trim() || 'Default';
    });

    modal.backdropEl.querySelector('#btn-preflight-start')?.addEventListener('click', async () => {
      if (modal.isSingleSessionMode) {
        const procConfig = { ...modal.context.getCurrentProcessConfig() };
        if (modal.checklistSelection.steps.enhanceClassicModel) {
          procConfig.dspAlgorithm = 'enhanced';
        }
        const checklistSnapshot: PipelineChecklistSelection = {
          steps: { ...modal.checklistSelection.steps },
          skipAlreadyProcessedSamples: modal.checklistSelection.skipAlreadyProcessedSamples,
          normalizeGroupRelativeForDrums: modal.checklistSelection.normalizeGroupRelativeForDrums,
        };
        const forceReanalyze = Boolean(
          checklistSnapshot.steps.enhanceClassicModel ||
            checklistSnapshot.steps.reconstructFromClassic
        );
        modal.cleanup();
        await modal.context.onStartSingleModelProcess?.(procConfig, {
          forceReanalyzeImported: forceReanalyze,
          checklist: checklistSnapshot,
        });
        return;
      }
      await startQueue(modal, );
    });

    // Step 3: Running controls
    modal.backdropEl.querySelector('#btn-batch-pause')?.addEventListener('click', () => {
      const state = modal.queue.getProgressState();
      if (state.status === 'paused') {
        modal.queue.resume();
      } else {
        modal.queue.pause();
      }
      modal.render();
    });

    modal.backdropEl.querySelector('#btn-batch-cancel')?.addEventListener('click', () => {
      void confirmDialog('Are you sure you want to cancel the batch?', {
        title: 'Cancel batch?',
        confirmLabel: 'Cancel batch',
        cancelLabel: 'Keep running',
        danger: true,
      }).then((ok) => {
        if (ok) modal.queue.cancel();
      });
    });

    // Step 4: Done actions
    modal.backdropEl.querySelector('#btn-download-master-zip')?.addEventListener('click', () => {
      if (modal.finalSummary?.masterZipBytes) {
        downloadBlob(modal, 
          modal.finalSummary.masterZipBytes,
          modal.activeConfig.outputMasterZipName || 'BatchExport.zip',
          'application/zip'
        );
      }
    });

    modal.backdropEl.querySelector('#btn-batch-export-json')?.addEventListener('click', () => {
      if (modal.finalSummary) {
        const text = JSON.stringify(modal.finalSummary, null, 2);
        downloadBlob(modal, new TextEncoder().encode(text), 'BatchLog.json', 'application/json');
      }
    });

    modal.backdropEl.querySelector('#btn-batch-finish-close')?.addEventListener('click', () => {
      modal.context.onRefreshBankDrawer?.();
      modal.close();
    });
  }
