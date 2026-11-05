// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Fase 35.5: Asistente Guiado de Músico (4 Pasos)
//
// Sigue el patrón canónico de 4 pasos de `BatchProcessorModal` (`BatchModalStep`):
//   1. Material (Grabar / Importar audio o banco)
//   2. Limpiar (Huella de ruido, recorte de silencios con zc-snap, normalización, BWE con consentimiento)
//   3. Cortar y mapear ("¿batería o melodía?" con "detectar solo" por defecto vía cat-0..9)
//   4. Generar y exportar (ProcessPanel simplificado + las 3 tarjetas de destino de 35.2)
//
// Los modales existentes (`AudioRecorderModal`, `UniversalImportModal`,
// `AudioChopperModal`, `LoopEditorModal`, `ModelConfigModal`, `ExportDestinationModal`)
// quedan conectados como "Talleres Avanzados" desde cada paso.
// ─────────────────────────────────────────────────────────


import type { ExportDestinationId } from '../app/exportDestinations.ts';
import { AudioCaptureService } from '../core/AudioCaptureService.ts';
import { getAppLocale } from '../core/i18n.ts';
import type { ImportPreflightReport } from '../core/import/importPreflight.ts';
import type { ParsedSamplerPreset } from '../core/import/rawSamplerParsers.ts';
import type { WorkingMode } from '../core/types.ts';
import { MUSICIAN_WIZARD_DEFAULTS, sanitizeClassicModelName } from '../core/wizard/musicianWizard.ts';
import type { MusicianWizardStep, WizardSliceRoleChoice, WizardCleanResult, WizardSliceAndMapResult } from '../core/wizard/musicianWizard.ts';
import { escHtml } from './escape.ts';
import { ICONS } from './icons.ts';
import { createModalFocusTrap } from './modalFocusTrap.ts';
import type { FocusTrap } from './modalFocusTrap.ts';
import { toast } from './notify.ts';
import type { MusicianWizardModalContext } from './musicianWizard/wizardModalCore.ts';
import { renderStep1Material as renderStep1MaterialFn } from './musicianWizard/wizardStep1View.ts';
import { renderStep2Clean as renderStep2CleanFn } from './musicianWizard/wizardStep2View.ts';
import { renderStep3SliceAndMap as renderStep3SliceAndMapFn } from './musicianWizard/wizardStep3View.ts';
import { renderStep4GenerateAndExport as renderStep4GenerateAndExportFn } from './musicianWizard/wizardStep4View.ts';
import { bindEvents as bindEventsFn } from './musicianWizard/wizardEvents.ts';
import { loadRawPcmIntoWizard as loadRawPcmIntoWizardFn, recomputeCleanAndSlice as recomputeCleanAndSliceFn, commitPreparedInstrumentToSession as commitPreparedInstrumentToSessionFn, handleFilesSelected as handleFilesSelectedFn, loadParsedBankIntoWizard as loadParsedBankIntoWizardFn, handleToggleInlineRecord as handleToggleInlineRecordFn, handleRunAiBweInStep2 as handleRunAiBweInStep2Fn } from './musicianWizard/wizardCommitOps.ts';

export class MusicianWizardModal {
  // Fase 42.5: campos ensanchados a publicos para los modulos de `musicianWizard/`.
  readonly context: MusicianWizardModalContext;
  public backdropEl: HTMLElement | null = null;
  public focusTrap: FocusTrap | null = null;

  public currentStep: MusicianWizardStep = 'material';
  public isBusy = false;
  public errorMessage: string | null = null;

  // Step 1: Material state
  public capture = new AudioCaptureService();
  public isRecordingInline = false;
  public sourceKind: 'none' | 'raw_audio' | 'mapped_bank' = 'none';
  public sourceName = 'Mi Instrumento';
  public rawPcm: Float32Array = new Float32Array(0);
  public rawSampleRate = 44100;

  // Pre-mapped bank state (when a bank/multisample is dropped in Step 1)
  public parsedPreset: ParsedSamplerPreset | null = null;
  public preflightReport: ImportPreflightReport | null = null;
  public optBankAutoExtend = MUSICIAN_WIZARD_DEFAULTS.autoExtendKeybed;
  public optBankAdaptVelocity = MUSICIAN_WIZARD_DEFAULTS.classicTwoVelocityLayers;
  public optBankSwitchExtended = false;

  // Step 2: Clean state (with Musician Defaults pre-checked)
  public optTrimSilence = MUSICIAN_WIZARD_DEFAULTS.trimSilence;
  public optSnapZeroCrossing = MUSICIAN_WIZARD_DEFAULTS.snapZeroCrossing;
  public optDcBlock = MUSICIAN_WIZARD_DEFAULTS.dcBlock;
  public optApplyNoisePrint = MUSICIAN_WIZARD_DEFAULTS.applyNoisePrintDsp;
  public optNormalizePeak = MUSICIAN_WIZARD_DEFAULTS.normalizePeak;
  public cleanResult: WizardCleanResult | null = null;

  // Step 3: Slice & Map state ("¿batería o melodía?" with "detectar solo" by default)
  public roleChoice: WizardSliceRoleChoice = MUSICIAN_WIZARD_DEFAULTS.defaultRoleChoice;
  public sensitivity = 70;
  public optClassicTwoLayers = MUSICIAN_WIZARD_DEFAULTS.classicTwoVelocityLayers;
  public singleRootKeyOverride: number | null = null;
  public sliceMapResult: WizardSliceAndMapResult | null = null;

  // Step 4: Generate & Export state
  public modelName = 'Init Model';
  public expandedName = 'Init Model';
  public workingMode: WorkingMode = 'classic';
  public parameterSet = 0;
  public selectedDestinationId: ExportDestinationId = 'time-capsule';
  public hasCommittedToSession = false;


  constructor(context: MusicianWizardModalContext) {
    this.context = context;
  }


  public isOpen(): boolean {
    return this.backdropEl !== null;
  }


  public open(initialStep: MusicianWizardStep = 'material'): void {
    this.close();
    const proc = this.context.getCurrentProcessConfig();
    this.workingMode = proc.workingMode ?? 'classic';
    this.modelName = sanitizeClassicModelName(proc.modelName || 'Init Model');
    this.expandedName = proc.expandedName || proc.modelName || 'Init Model';
    this.parameterSet = proc.parameterSet ?? 0;
    this.currentStep = initialStep;
    this.errorMessage = null;
    this.hasCommittedToSession = false;

    // Reset Musician Defaults on open
    this.optTrimSilence = MUSICIAN_WIZARD_DEFAULTS.trimSilence;
    this.optSnapZeroCrossing = MUSICIAN_WIZARD_DEFAULTS.snapZeroCrossing;
    this.optDcBlock = MUSICIAN_WIZARD_DEFAULTS.dcBlock;
    this.optApplyNoisePrint = MUSICIAN_WIZARD_DEFAULTS.applyNoisePrintDsp;
    this.optNormalizePeak = MUSICIAN_WIZARD_DEFAULTS.normalizePeak;
    this.optClassicTwoLayers = MUSICIAN_WIZARD_DEFAULTS.classicTwoVelocityLayers;
    this.roleChoice = MUSICIAN_WIZARD_DEFAULTS.defaultRoleChoice;
    this.singleRootKeyOverride = null;

    this.render();
  }

  /**
   * Permite abrir el asistente con un buffer WAV/audio ya grabado o cargado.
   */

  public openWithRawAudio(pcm: Float32Array, sampleRate: number, filename: string): void {
    this.open('clean');
    loadRawPcmIntoWizardFn(this, pcm, sampleRate, filename);
  }

  /**
   * Fase 35.6: Abre el asistente directamente en el Paso 2 (`clean`) rescatando la muestra
   * asignada a un slot de zona (`sampleLow` / `sampleHigh`) o región 2D sin reimportar desde disco.
   */

  public openWithZoneSample(
    zoneId?: string,
    slot: 'low' | 'high' = 'low',
    regionId?: string
  ): boolean {
    const slotAudio = this.context.getZoneSlotAudio?.(zoneId, slot, regionId);
    if (slotAudio && slotAudio.hasAudio && slotAudio.pcm.length > 0) {
      this.openWithRawAudio(slotAudio.pcm, slotAudio.sampleRate, slotAudio.sampleName);
      toast(
        `Muestra "${slotAudio.sampleName}" cargada en el Paso 2 (Limpiar y mapear).`,
        'info'
      );
      return true;
    }
    const fallback = this.context.getActiveSessionAudio?.();
    if (fallback && fallback.hasAudio && fallback.pcm && fallback.pcm.length > 0) {
      this.openWithRawAudio(
        fallback.pcm,
        fallback.sampleRate ?? 44100,
        fallback.sampleName ?? 'Zone_Sample.wav'
      );
      toast(
        `Muestra "${fallback.sampleName ?? 'Zone_Sample.wav'}" cargada en el Paso 2 (Limpiar y mapear).`,
        'info'
      );
      return true;
    }
    toast('Asigna antes un archivo de audio al slot para poder limpiarlo y mapearlo.', 'warning');
    return false;
  }


  public close(): void {
    this.context.onStopAudition?.();
    if (this.capture.isOpen()) {
      void this.capture.close();
    }
    this.isRecordingInline = false;
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
      this.backdropEl.addEventListener('mousedown', (e) => {
        if (e.target === this.backdropEl && !this.isBusy && !this.isRecordingInline) {
          this.close();
        }
      });
      document.body.appendChild(this.backdropEl);
    }

    let stepBodyHtml = '';
    if (this.currentStep === 'material') {
      stepBodyHtml = this.renderStep1Material();
    } else if (this.currentStep === 'clean') {
      stepBodyHtml = this.renderStep2Clean();
    } else if (this.currentStep === 'slice_map') {
      stepBodyHtml = this.renderStep3SliceAndMap();
    } else {
      stepBodyHtml = this.renderStep4GenerateAndExport();
    }

    const isEs = getAppLocale() === 'es';
    const canAccessClean = this.sourceKind === 'raw_audio' && this.rawPcm.length > 0;
    const canAccessSlice = canAccessClean && Boolean(this.cleanResult);
    const canAccessGenerate =
      (canAccessSlice && Boolean(this.sliceMapResult)) ||
      (this.sourceKind === 'mapped_bank' && Boolean(this.parsedPreset));

    this.backdropEl.innerHTML = `
      <div class="nmm-modal-window nmm-modal-xl nmm-batch-window" role="dialog" aria-modal="true" aria-labelledby="musician-wizard-title">
        <header class="nmm-modal-header">
          <div class="nmm-modal-header-title">
            <span class="modal-icon">${ICONS.sparkle}</span>
            <h2 id="musician-wizard-title">${isEs ? 'Asistente Guiado (4 Pasos)' : 'Guided Musician Wizard (4 Steps)'}</h2>
            <span class="panel-badge badge-ai-on">${isEs ? '4 PASOS' : '4 STEPS'}</span>
          </div>
          <button type="button" class="nmm-modal-close" aria-label="${isEs ? 'Cerrar' : 'Close'}" id="btn-wiz-close">${ICONS.close}</button>
        </header>

        <nav class="nmm-batch-steps-nav" aria-label="${isEs ? 'Pasos del asistente guiado' : 'Guided wizard steps'}">
          <button
            type="button"
            class="nmm-batch-step-indicator ${this.currentStep === 'material' ? 'is-active' : ''}"
            data-wiz-step="material"
          >${isEs ? '1. Material (Grabar / Importar)' : '1. Material (Record / Import)'}</button>
          <button
            type="button"
            class="nmm-batch-step-indicator ${this.currentStep === 'clean' ? 'is-active' : ''}"
            data-wiz-step="clean"
            ${!canAccessClean ? 'disabled' : ''}
          >${isEs ? '2. Limpiar' : '2. Clean'}</button>
          <button
            type="button"
            class="nmm-batch-step-indicator ${this.currentStep === 'slice_map' ? 'is-active' : ''}"
            data-wiz-step="slice_map"
            ${!canAccessSlice ? 'disabled' : ''}
          >${isEs ? '3. Cortar y mapear' : '3. Slice & Map'}</button>
          <button
            type="button"
            class="nmm-batch-step-indicator ${this.currentStep === 'generate_export' ? 'is-active' : ''}"
            data-wiz-step="generate_export"
            ${!canAccessGenerate ? 'disabled' : ''}
          >${isEs ? '4. Generar y exportar' : '4. Generate & Export'}</button>
        </nav>

        <div class="nmm-modal-body nmm-batch-body">
          ${
            this.errorMessage
              ? `
            <div class="preflight-status is-error">
              <div class="preflight-status-head">
                <div class="preflight-status-title">
                  <span class="preflight-status-icon">${ICONS.alert}</span>
                  <span>${isEs ? 'Aviso del asistente' : 'Wizard notice'}</span>
                </div>
              </div>
              <p>${escHtml(this.errorMessage)}</p>
            </div>
          `
              : ''
          }
          ${stepBodyHtml}
        </div>
      </div>
    `;

    this.bindEvents();

    if (!this.focusTrap && this.backdropEl) {
      const winEl = this.backdropEl.querySelector<HTMLElement>('.nmm-modal-window');
      if (winEl) {
        this.focusTrap = createModalFocusTrap(winEl, {
          onEscape: () => {
            if (!this.isBusy && !this.isRecordingInline) this.close();
          },
        });
        this.focusTrap.activate();
      }
    }
  }

  public renderStep1Material(): string {
    return renderStep1MaterialFn(this);
  }

  public renderStep2Clean(): string {
    return renderStep2CleanFn(this);
  }

  public renderStep3SliceAndMap(): string {
    return renderStep3SliceAndMapFn(this);
  }

  public renderStep4GenerateAndExport(): string {
    return renderStep4GenerateAndExportFn(this);
  }

  public loadRawPcmIntoWizard(pcm: Float32Array, sampleRate: number, filename: string): void {
    return loadRawPcmIntoWizardFn(this, pcm, sampleRate, filename);
  }

  public recomputeCleanAndSlice(): void {
    return recomputeCleanAndSliceFn(this);
  }

  public commitPreparedInstrumentToSession(): void {
    return commitPreparedInstrumentToSessionFn(this);
  }

  public async handleFilesSelected(files: FileList | File[]): Promise<void> {
    return await handleFilesSelectedFn(this, files);
  }

  public loadParsedBankIntoWizard(preset: ParsedSamplerPreset): void {
    return loadParsedBankIntoWizardFn(this, preset);
  }

  public async handleToggleInlineRecord(): Promise<void> {
    return await handleToggleInlineRecordFn(this);
  }

  public async handleRunAiBweInStep2(): Promise<void> {
    return await handleRunAiBweInStep2Fn(this);
  }

  public bindEvents(): void {
    return bindEventsFn(this);
  }
}
