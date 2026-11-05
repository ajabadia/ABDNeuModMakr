// ─────────────────────────────────────────────────────────
// MusicianWizardModal — wizardEvents (Fase 42.5)
// Funciones extraidas verbatim de `src/ui/MusicianWizardModal.ts`.
// `modal` es el nucleo estructural (`WizardModalCore`).
// ─────────────────────────────────────────────────────────

import { triggerExportDestinationAction } from '../../app/exportDestinations.ts';
import type { ExportDestinationId } from '../../app/exportDestinations.ts';
import { encodePcm16Wav } from '../../core/dsp/WavDecoder.ts';
import type { WorkingMode } from '../../core/types.ts';
import { sanitizeClassicModelName } from '../../core/wizard/musicianWizard.ts';
import type { MusicianWizardStep, WizardSliceRoleChoice } from '../../core/wizard/musicianWizard.ts';
import { toast } from '../notify.ts';
import { loadRawPcmIntoWizard, recomputeCleanAndSlice, commitPreparedInstrumentToSession, handleFilesSelected, handleToggleInlineRecord, handleRunAiBweInStep2 } from './wizardCommitOps.ts';
import type { WizardModalCore } from './wizardModalCore.ts';

export function bindEvents(modal: WizardModalCore): void {
    const root = modal.backdropEl;
    if (!root) return;

    root.querySelector('#btn-wiz-close')?.addEventListener('click', () => modal.close());
    root.querySelector('#btn-wiz-cancel')?.addEventListener('click', () => modal.close());
    root.querySelector('#btn-wiz-close-footer')?.addEventListener('click', () => modal.close());

    // Stepper navigation buttons
    root.querySelectorAll<HTMLButtonElement>('[data-wiz-step]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const step = btn.dataset.wizStep as MusicianWizardStep | undefined;
        if (step) {
          modal.currentStep = step;
          modal.render();
        }
      });
    });

    // ── Step 1 events ──
    root.querySelector('#btn-wiz-record-toggle')?.addEventListener('click', () => {
      void handleToggleInlineRecord(modal);
    });

    root.querySelector('#btn-wiz-open-adv-recorder')?.addEventListener('click', () => {
      modal.close();
      modal.context.onOpenAdvancedRecorder?.();
    });

    root.querySelector('#btn-wiz-open-adv-import')?.addEventListener('click', () => {
      modal.close();
      modal.context.onOpenAdvancedUniversalImport?.();
    });

    root.querySelector('#btn-wiz-use-session-audio')?.addEventListener('click', () => {
      const act = modal.context.getActiveSessionAudio?.();
      if (act?.pcm && act.pcm.length > 0) {
        loadRawPcmIntoWizard(modal, act.pcm, act.sampleRate ?? 44100, act.sampleName || 'Session_Audio.wav');
      }
    });

    root.querySelector('#btn-wiz-skip-to-step4')?.addEventListener('click', () => {
      modal.currentStep = 'generate_export';
      modal.render();
    });

    const fileInput = root.querySelector<HTMLInputElement>('#inp-wiz-file');
    fileInput?.addEventListener('change', () => {
      if (fileInput.files && fileInput.files.length > 0) {
        void handleFilesSelected(modal, fileInput.files);
      }
    });

    const dropzone = root.querySelector<HTMLElement>('#wiz-dropzone');
    if (dropzone) {
      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('is-drag-over');
      });
      dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('is-drag-over');
      });
      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('is-drag-over');
        if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
          void handleFilesSelected(modal, e.dataTransfer.files);
        }
      });
    }

    root.querySelector<HTMLInputElement>('#chk-wiz-bank-extend')?.addEventListener('change', (e) => {
      modal.optBankAutoExtend = (e.currentTarget as HTMLInputElement).checked;
      modal.render();
    });
    root.querySelector<HTMLInputElement>('#chk-wiz-bank-vel')?.addEventListener('change', (e) => {
      modal.optBankAdaptVelocity = (e.currentTarget as HTMLInputElement).checked;
      modal.render();
    });
    root.querySelector<HTMLInputElement>('#chk-wiz-bank-extmode')?.addEventListener('change', (e) => {
      modal.optBankSwitchExtended = (e.currentTarget as HTMLInputElement).checked;
      modal.render();
    });

    root.querySelector('#btn-wiz-bank-to-step4')?.addEventListener('click', () => {
      commitPreparedInstrumentToSession(modal);
      modal.currentStep = 'generate_export';
      modal.render();
    });

    root.querySelector('#btn-wiz-to-step2')?.addEventListener('click', () => {
      modal.currentStep = 'clean';
      modal.render();
    });

    // ── Step 2 events ──
    root.querySelector('#btn-wiz-audition-raw')?.addEventListener('click', () => {
      if (modal.rawPcm.length > 0) {
        modal.context.onAuditionPcm?.(modal.rawPcm, modal.rawSampleRate);
      }
    });
    root.querySelector('#btn-wiz-audition-clean')?.addEventListener('click', () => {
      if (modal.cleanResult && modal.cleanResult.cleanedPcm.length > 0) {
        modal.context.onAuditionPcm?.(modal.cleanResult.cleanedPcm, modal.cleanResult.sampleRate);
      }
    });
    root.querySelector('#btn-wiz-stop-audition')?.addEventListener('click', () => {
      modal.context.onStopAudition?.();
    });

    root.querySelector<HTMLInputElement>('#chk-wiz-trim')?.addEventListener('change', (e) => {
      modal.optTrimSilence = (e.currentTarget as HTMLInputElement).checked;
      recomputeCleanAndSlice(modal);
      modal.render();
    });
    root.querySelector<HTMLInputElement>('#chk-wiz-zcsnap')?.addEventListener('change', (e) => {
      modal.optSnapZeroCrossing = (e.currentTarget as HTMLInputElement).checked;
      recomputeCleanAndSlice(modal);
      modal.render();
    });
    root.querySelector<HTMLInputElement>('#chk-wiz-denoise')?.addEventListener('change', (e) => {
      modal.optApplyNoisePrint = (e.currentTarget as HTMLInputElement).checked;
      recomputeCleanAndSlice(modal);
      modal.render();
    });
    root.querySelector<HTMLInputElement>('#chk-wiz-norm')?.addEventListener('change', (e) => {
      modal.optNormalizePeak = (e.currentTarget as HTMLInputElement).checked;
      recomputeCleanAndSlice(modal);
      modal.render();
    });

    root.querySelector('#btn-wiz-ai-bwe')?.addEventListener('click', () => {
      void handleRunAiBweInStep2(modal);
    });
    root.querySelector('#btn-wiz-step2-adv-recorder')?.addEventListener('click', () => {
      modal.close();
      modal.context.onOpenAdvancedRecorder?.();
    });

    root.querySelector('#btn-wiz-back-step1')?.addEventListener('click', () => {
      modal.currentStep = 'material';
      modal.render();
    });
    root.querySelector('#btn-wiz-to-step3')?.addEventListener('click', () => {
      modal.currentStep = 'slice_map';
      modal.render();
    });

    // ── Step 3 events ──
    root.querySelectorAll<HTMLButtonElement>('[data-wiz-role]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const role = btn.dataset.wizRole as WizardSliceRoleChoice | undefined;
        if (role) {
          modal.roleChoice = role;
          recomputeCleanAndSlice(modal);
          modal.render();
        }
      });
    });

    root.querySelector<HTMLInputElement>('#rng-wiz-sens')?.addEventListener('change', (e) => {
      modal.sensitivity = parseInt((e.currentTarget as HTMLInputElement).value, 10) || 70;
      recomputeCleanAndSlice(modal);
      modal.render();
    });

    root.querySelector<HTMLInputElement>('#chk-wiz-step3-zcsnap')?.addEventListener('change', (e) => {
      modal.optSnapZeroCrossing = (e.currentTarget as HTMLInputElement).checked;
      recomputeCleanAndSlice(modal);
      modal.render();
    });

    root.querySelector<HTMLInputElement>('#chk-wiz-step3-2layers')?.addEventListener('change', (e) => {
      modal.optClassicTwoLayers = (e.currentTarget as HTMLInputElement).checked;
      recomputeCleanAndSlice(modal);
      modal.render();
    });

    root.querySelectorAll<HTMLButtonElement>('[data-wiz-root-delta]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const delta = parseInt(btn.dataset.wizRootDelta || '0', 10);
        if (!delta || !modal.sliceMapResult) return;
        const currentRoot = modal.sliceMapResult.effectiveRootKey;
        modal.singleRootKeyOverride = Math.max(0, Math.min(127, currentRoot + delta));
        recomputeCleanAndSlice(modal);
        modal.render();
      });
    });

    root.querySelector<HTMLInputElement>('#inp-wiz-single-root')?.addEventListener('change', (e) => {
      const parsed = parseInt((e.currentTarget as HTMLInputElement).value, 10);
      if (Number.isFinite(parsed)) {
        modal.singleRootKeyOverride = Math.max(0, Math.min(127, Math.round(parsed)));
        recomputeCleanAndSlice(modal);
        modal.render();
      }
    });

    root.querySelector('#btn-wiz-root-reset-auto')?.addEventListener('click', () => {
      modal.singleRootKeyOverride = null;
      recomputeCleanAndSlice(modal);
      modal.render();
    });

    root.querySelectorAll<HTMLButtonElement>('.btn-wiz-play-slice').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.sliceIdx || '0', 10);
        const sl = modal.sliceMapResult?.slices[idx];
        if (sl && modal.cleanResult) {
          modal.context.onAuditionPcm?.(sl.pcm, modal.cleanResult.sampleRate);
        }
      });
    });

    root.querySelector('#btn-wiz-open-adv-chopper')?.addEventListener('click', () => {
      const pcm = modal.cleanResult?.cleanedPcm ?? modal.rawPcm;
      const sr = modal.cleanResult?.sampleRate ?? modal.rawSampleRate;
      const wav = pcm.length > 0 ? encodePcm16Wav(pcm, sr) : undefined;
      modal.close();
      modal.context.onOpenAdvancedChopper?.(wav, modal.sourceName);
    });

    root.querySelector('#btn-wiz-open-adv-loop')?.addEventListener('click', () => {
      commitPreparedInstrumentToSession(modal);
      modal.close();
      modal.context.onOpenAdvancedLoopEditor?.();
    });

    root.querySelector('#btn-wiz-back-step2')?.addEventListener('click', () => {
      modal.currentStep = 'clean';
      modal.render();
    });

    root.querySelector('#btn-wiz-to-step4')?.addEventListener('click', () => {
      commitPreparedInstrumentToSession(modal);
      modal.currentStep = 'generate_export';
      modal.render();
    });

    // ── Step 4 events ──
    root.querySelector<HTMLInputElement>('#inp-wiz-model-name')?.addEventListener('input', (e) => {
      modal.modelName = sanitizeClassicModelName((e.currentTarget as HTMLInputElement).value);
      modal.hasCommittedToSession = false;
    });

    root.querySelector<HTMLInputElement>('#inp-wiz-expanded-name')?.addEventListener('input', (e) => {
      modal.expandedName = (e.currentTarget as HTMLInputElement).value;
      modal.hasCommittedToSession = false;
    });

    root.querySelector<HTMLSelectElement>('#sel-wiz-working-mode')?.addEventListener('change', (e) => {
      modal.workingMode = ((e.currentTarget as HTMLSelectElement).value as WorkingMode) || 'classic';
      modal.hasCommittedToSession = false;
      modal.render();
    });

    root.querySelector<HTMLSelectElement>('#sel-wiz-param-set')?.addEventListener('change', (e) => {
      modal.parameterSet = parseInt((e.currentTarget as HTMLSelectElement).value, 10) || 0;
      modal.hasCommittedToSession = false;
    });

    root.querySelector('#btn-wiz-open-adv-modelcfg')?.addEventListener('click', () => {
      commitPreparedInstrumentToSession(modal);
      modal.close();
      modal.context.onOpenAdvancedModelConfig?.();
    });

    root.querySelector('#btn-wiz-apply-session-only')?.addEventListener('click', () => {
      commitPreparedInstrumentToSession(modal);
      toast(`Instrumento "${modal.expandedName}" volcado a la sesión activa.`, 'success');
    });

    root.querySelector('#btn-wiz-generate-model-now')?.addEventListener('click', () => {
      commitPreparedInstrumentToSession(modal);
      modal.close();
      modal.context.onStartProcessModel();
    });

    // 35.2 Destination Cards inside Step 4
    root.querySelectorAll<HTMLElement>('[data-wiz-dest-card]').forEach((cardEl) => {
      cardEl.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('button')) return;
        const id = cardEl.dataset.wizDestCard as ExportDestinationId | undefined;
        if (id && id !== modal.selectedDestinationId) {
          modal.selectedDestinationId = id;
          modal.render();
        }
      });
    });

    root.querySelectorAll<HTMLButtonElement>('[data-wiz-dest-primary]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.wizDestPrimary as ExportDestinationId | undefined;
        if (!id) return;
        commitPreparedInstrumentToSession(modal);
        modal.close();
        void triggerExportDestinationAction(id, modal.context);
      });
    });

    root.querySelectorAll<HTMLButtonElement>('[data-wiz-dest-quick]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.wizDestQuick as ExportDestinationId | undefined;
        const actId = btn.dataset.wizActionId;
        if (!id || !actId) return;
        commitPreparedInstrumentToSession(modal);
        modal.close();
        void triggerExportDestinationAction(id, modal.context, actId);
      });
    });

    root.querySelector('#btn-wiz-back-from-step4')?.addEventListener('click', () => {
      modal.currentStep = modal.sourceKind === 'raw_audio' ? 'slice_map' : 'material';
      modal.render();
    });
  }
