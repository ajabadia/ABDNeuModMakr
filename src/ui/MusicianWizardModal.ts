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

import {
  MUSICIAN_WIZARD_DEFAULTS,
  inspectWizardMaterialFilename,
  runWizardCleanStep,
  runWizardSliceAndMapStep,
  sanitizeClassicModelName,
  describeWorkingModeForMusician,
  type MusicianWizardStep,
  type WizardSliceRoleChoice,
  type WizardCleanResult,
  type WizardSliceAndMapResult,
} from '../core/wizard/musicianWizard.ts';
import {
  buildExportDestinationCards,
  resolveExportDestinationSummary,
  triggerExportDestinationAction,
  type ExportDestinationCallbacks,
  type ExportDestinationId,
} from '../app/exportDestinations.ts';
import {
  isNeuronBankOrModelInput,
  listNeuronBankModels,
  parseNeuronBankOrModelToPreset,
} from '../core/import/neuronBankImporter.ts';
import {
  listZipSamplerPrograms,
  parseUniversalSampler,
  type ParsedSamplerPreset,
} from '../core/import/rawSamplerParsers.ts';
import {
  analyzeImportPreflight,
  applyPreflightImportAdaptations,
  type ImportPreflightReport,
} from '../core/import/importPreflight.ts';
import {
  MUSICIAN_TERMS,
  fromImportPreflightReport,
  renderCommonPreflightGate,
} from './preflightGateView.ts';
import { MultiInstrumentModal } from './MultiInstrumentModal.ts';
import { resolveAiActionDeclaration } from '../core/ai/aiHonesty.ts';
import { AudioCaptureService } from '../core/AudioCaptureService.ts';
import { bridgeClient } from '../core/bridge/BridgeClient.ts';
import {
  decodeWav,
  decodeAiff,
  encodePcm16Wav,
  transcodeAnyAudioToWavBuffer,
} from '../core/dsp/WavDecoder.ts';
import { PARAMETER_SETS } from '../core/index.ts';
import type {
  ExtendedRegion,
  ParameterSetInfo,
  ProcessConfig,
  WorkingMode,
  Zone,
} from '../core/types.ts';
import { ICONS } from './icons.ts';
import { escAttr, escHtml } from './escape.ts';
import { createModalFocusTrap, type FocusTrap } from './modalFocusTrap.ts';
import { confirmDialog, toast } from './notify.ts';
import { midiToNoteName } from './ZoneRibbon.ts';

export interface MusicianWizardModalContext extends ExportDestinationCallbacks {
  getCurrentProcessConfig: () => ProcessConfig;
  getCurrentWorkingMode: () => WorkingMode;
  getParameterSets?: () => ParameterSetInfo[];
  getActiveSessionAudio?: () => {
    hasAudio: boolean;
    zoneCount: number;
    sampleName?: string;
    pcm?: Float32Array;
    sampleRate?: number;
  };
  /** Fase 35.6: Resuelve el audio cargado en un slot concreto de zona/región para rescate directo en el Paso 2 */
  getZoneSlotAudio?: (
    zoneId?: string,
    slot?: 'low' | 'high',
    regionId?: string
  ) => {
    hasAudio: boolean;
    sampleName: string;
    pcm: Float32Array;
    sampleRate: number;
  } | null;
  onAuditionPcm?: (pcm: Float32Array, sampleRate: number) => void;
  onStopAudition?: () => void;
  /** Inyecta las zonas/regiones y configuración preparadas por el asistente en la sesión activa */
  onCommitWizardInstrument: (payload: {
    modelName: string;
    expandedName: string;
    parameterSet: number;
    workingMode: WorkingMode;
    classicZones: Zone[];
    extendedRegions: ExtendedRegion[];
    audioBuffers: Map<string, ArrayBuffer>;
  }) => void;
  /** Lanza la generación espectral real (`startProcess`) tras volcar el instrumento en la sesión */
  onStartProcessModel: () => void;
  // Talleres avanzados
  onOpenAdvancedRecorder?: () => void;
  onOpenAdvancedUniversalImport?: () => void;
  onOpenAdvancedChopper?: (wavBytes?: ArrayBuffer, filename?: string) => void;
  onOpenAdvancedLoopEditor?: () => void;
  onOpenAdvancedModelConfig?: () => void;
  onOpenBatchProcessorWithFiles?: (files: Array<{ name: string; buffer: ArrayBuffer }>, originTitle?: string) => void;
  onOpenBatchProcessor?: () => void;
}

export class MusicianWizardModal {
  private readonly context: MusicianWizardModalContext;
  private backdropEl: HTMLElement | null = null;
  private focusTrap: FocusTrap | null = null;

  private currentStep: MusicianWizardStep = 'material';
  private isBusy = false;
  private errorMessage: string | null = null;

  // Step 1: Material state
  private capture = new AudioCaptureService();
  private isRecordingInline = false;
  private sourceKind: 'none' | 'raw_audio' | 'mapped_bank' = 'none';
  private sourceName = 'Mi Instrumento';
  private rawPcm: Float32Array = new Float32Array(0);
  private rawSampleRate = 44100;

  // Pre-mapped bank state (when a bank/multisample is dropped in Step 1)
  private parsedPreset: ParsedSamplerPreset | null = null;
  private preflightReport: ImportPreflightReport | null = null;
  private optBankAutoExtend = MUSICIAN_WIZARD_DEFAULTS.autoExtendKeybed;
  private optBankAdaptVelocity = MUSICIAN_WIZARD_DEFAULTS.classicTwoVelocityLayers;
  private optBankSwitchExtended = false;

  // Step 2: Clean state (with Musician Defaults pre-checked)
  private optTrimSilence = MUSICIAN_WIZARD_DEFAULTS.trimSilence;
  private optSnapZeroCrossing = MUSICIAN_WIZARD_DEFAULTS.snapZeroCrossing;
  private optDcBlock = MUSICIAN_WIZARD_DEFAULTS.dcBlock;
  private optApplyNoisePrint = MUSICIAN_WIZARD_DEFAULTS.applyNoisePrintDsp;
  private optNormalizePeak = MUSICIAN_WIZARD_DEFAULTS.normalizePeak;
  private cleanResult: WizardCleanResult | null = null;

  // Step 3: Slice & Map state ("¿batería o melodía?" with "detectar solo" by default)
  private roleChoice: WizardSliceRoleChoice = MUSICIAN_WIZARD_DEFAULTS.defaultRoleChoice;
  private sensitivity = 70;
  private optClassicTwoLayers = MUSICIAN_WIZARD_DEFAULTS.classicTwoVelocityLayers;
  private singleRootKeyOverride: number | null = null;
  private sliceMapResult: WizardSliceAndMapResult | null = null;

  // Step 4: Generate & Export state
  private modelName = 'Init Model';
  private expandedName = 'Init Model';
  private workingMode: WorkingMode = 'classic';
  private parameterSet = 0;
  private selectedDestinationId: ExportDestinationId = 'time-capsule';
  private hasCommittedToSession = false;

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
    this.loadRawPcmIntoWizard(pcm, sampleRate, filename);
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

  private loadRawPcmIntoWizard(pcm: Float32Array, sampleRate: number, filename: string): void {
    this.sourceKind = 'raw_audio';
    this.sourceName = filename;
    this.rawPcm = pcm;
    this.rawSampleRate = sampleRate;
    this.parsedPreset = null;
    this.preflightReport = null;
    this.singleRootKeyOverride = null;
    this.modelName = sanitizeClassicModelName(filename);
    this.expandedName = filename.replace(/\.[^/.]+$/, '').trim() || 'Mi Instrumento';

    this.recomputeCleanAndSlice();
    this.currentStep = 'clean';
    this.render();
  }

  private recomputeCleanAndSlice(): void {
    if (this.rawPcm.length === 0) return;
    this.cleanResult = runWizardCleanStep(this.rawPcm, this.rawSampleRate, {
      trimSilence: this.optTrimSilence,
      snapZeroCrossing: this.optSnapZeroCrossing,
      dcBlock: this.optDcBlock,
      applyNoisePrintDsp: this.optApplyNoisePrint,
      normalizePeak: this.optNormalizePeak,
    });

    this.sliceMapResult = runWizardSliceAndMapStep(
      this.cleanResult.cleanedPcm,
      this.cleanResult.sampleRate,
      {
        roleChoice: this.roleChoice,
        sensitivity: this.sensitivity,
        snapZeroCrossing: this.optSnapZeroCrossing,
        classicTwoVelocityLayers: this.optClassicTwoLayers,
        autoExtendKeybed: true,
        singleRootKeyOverride: this.singleRootKeyOverride,
        sourceName: this.sourceName,
      }
    );

    this.parameterSet = this.sliceMapResult.suggestedParameterSet;
    this.hasCommittedToSession = false;
  }

  private render(): void {
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
            <h2 id="musician-wizard-title">Asistente Guiado (4 Pasos)</h2>
            <span class="panel-badge badge-ai-on">4 PASOS</span>
          </div>
          <button type="button" class="nmm-modal-close" aria-label="Cerrar" id="btn-wiz-close">${ICONS.close}</button>
        </header>

        <nav class="nmm-batch-steps-nav" aria-label="Pasos del asistente guiado">
          <button
            type="button"
            class="nmm-batch-step-indicator ${this.currentStep === 'material' ? 'is-active' : ''}"
            data-wiz-step="material"
          >1. Material (Grabar / Importar)</button>
          <button
            type="button"
            class="nmm-batch-step-indicator ${this.currentStep === 'clean' ? 'is-active' : ''}"
            data-wiz-step="clean"
            ${!canAccessClean ? 'disabled' : ''}
          >2. Limpiar</button>
          <button
            type="button"
            class="nmm-batch-step-indicator ${this.currentStep === 'slice_map' ? 'is-active' : ''}"
            data-wiz-step="slice_map"
            ${!canAccessSlice ? 'disabled' : ''}
          >3. Cortar y mapear</button>
          <button
            type="button"
            class="nmm-batch-step-indicator ${this.currentStep === 'generate_export' ? 'is-active' : ''}"
            data-wiz-step="generate_export"
            ${!canAccessGenerate ? 'disabled' : ''}
          >4. Generar y exportar</button>
        </nav>

        <div class="nmm-modal-body nmm-batch-body">
          ${
            this.errorMessage
              ? `
            <div class="preflight-status is-error">
              <div class="preflight-status-head">
                <div class="preflight-status-title">
                  <span class="preflight-status-icon">${ICONS.alert}</span>
                  <span>Aviso del asistente</span>
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

  // ── Paso 1: Material (Grabar / Importar) ──────────────────

  private renderStep1Material(): string {
    const activeAudio = this.context.getActiveSessionAudio?.();
    const currentMode = this.context.getCurrentWorkingMode();
    const bankGateModel =
      this.preflightReport && this.parsedPreset
        ? fromImportPreflightReport(this.preflightReport, this.parsedPreset, currentMode, {
            autoExtendOuterZones: this.optBankAutoExtend,
            adaptVelocityLayers: this.optBankAdaptVelocity,
            switchToExtendedMode: this.optBankSwitchExtended,
          })
        : null;

    return `
      <div class="nmm-batch-discover-pane">
        <div class="triage-summary">
          ${ICONS.sparkle}
          <div>
            <p><strong>Paso 1 — Elige tu punto de partida musical</strong></p>
            <p>Graba una toma con micrófono/línea, suelta un archivo de audio (nota, frase o ritmo) o importa un banco ya mapeado (<code>.sf2</code>, <code>.sfz</code>, <code>.dspreset</code>, <code>.model</code> Hartmann, etc.).</p>
          </div>
        </div>

        <div class="nmm-preflight-grid">
          <!-- Opción A: Grabar toma en vivo -->
          <div class="nmm-batch-card">
            <h3>${ICONS.mic} Grabar con micrófono o línea</h3>
            <p class="nmm-batch-hint">
              Captura una nota, acorde, frase melódica o ritmo percusivo directamente en el asistente, con detección automática de huella de ruido.
            </p>
            <div class="triage-toolbar-left">
              <button
                type="button"
                class="btn ${this.isRecordingInline ? 'btn-danger' : 'btn-primary'}"
                id="btn-wiz-record-toggle"
              >
                ${this.isRecordingInline ? `${ICONS.stop} Detener grabación y continuar` : `${ICONS.mic} Empezar a grabar ahora`}
              </button>
              ${
                this.context.onOpenAdvancedRecorder
                  ? `
                <button type="button" class="btn btn-outline btn-sm" id="btn-wiz-open-adv-recorder">
                  Abrir en taller avanzado (Grabadora)…
                </button>
              `
                  : ''
              }
            </div>
            ${
              this.isRecordingInline
                ? `<div class="nmm-alert-subtle">Grabando en vivo… toca tu instrumento o micrófono y pulsa <strong>Detener grabación</strong> cuando termines.</div>`
                : ''
            }
          </div>

          <!-- Opción B: Usar audio ya cargado en la sesión -->
          <div class="nmm-batch-card">
            <h3>${ICONS.wave} Material actual de la sesión</h3>
            <p class="nmm-batch-hint">
              ${
                activeAudio?.hasAudio
                  ? `La sesión actual tiene <strong>${activeAudio.zoneCount} zona(s)</strong> cargada(s) (${escHtml(activeAudio.sampleName || 'muestra activa')}).`
                  : 'Si ya tienes muestras cargadas en la sesión, puedes pasarlas por el asistente o ir directo al Paso 4.'
              }
            </p>
            <div class="triage-toolbar-left">
              ${
                activeAudio?.pcm && activeAudio.pcm.length > 0
                  ? `
                <button type="button" class="btn btn-outline" id="btn-wiz-use-session-audio">
                  ${ICONS.play} Limpiar y mapear muestra activa
                </button>
              `
                  : ''
              }
              <button type="button" class="btn btn-outline" id="btn-wiz-skip-to-step4">
                Ir al Paso 4 con la sesión actual →
              </button>
            </div>
          </div>
        </div>

        <!-- Opción C: Importar archivo de audio o banco de instrumentos -->
        <div class="nmm-batch-card">
          <div class="triage-toolbar">
            <div class="triage-toolbar-left">
              <h3>${ICONS.folder} Importar audio o banco de instrumentos</h3>
            </div>
            <div class="triage-toolbar-right">
              ${
                this.context.onOpenAdvancedUniversalImport
                  ? `
                <button type="button" class="btn btn-outline btn-sm" id="btn-wiz-open-adv-import">
                  Abrir Importador Universal avanzado…
                </button>
              `
                  : ''
              }
            </div>
          </div>
          <p class="nmm-batch-hint">
            Si sueltas un audio (<code>.wav</code>, <code>.aif</code>, <code>.flac</code>, <code>.mp3</code>) pasará al <strong>Paso 2 (Limpiar)</strong>. Si sueltas un banco ya mapeado (<code>.sf2</code>, <code>.sfz</code>, <code>.dspreset</code>, <code>.model</code> Hartmann, <code>.zip</code>), revisaremos su adaptación aquí y podrás saltar directo al <strong>Paso 4 (Generar y exportar)</strong>.
          </p>

          <div class="nmm-dropzone" id="wiz-dropzone" tabindex="0">
            <div class="nmm-batch-dropzone-icon">${ICONS.upload}</div>
            <div class="nmm-batch-dropzone-text">
              Arrastra aquí tu <strong>archivo de audio (.wav, .aif, .flac, .mp3)</strong> o <strong>banco (.sf2, .sfz, .dspreset, .model, .zip)</strong>
            </div>
            <div class="nmm-batch-dropzone-sub">o selecciónalo desde tu equipo</div>
            <div class="nmm-batch-dropzone-actions">
              <label class="btn btn-primary">
                ${ICONS.folder} Elegir archivo de audio o banco…
                <input
                  type="file"
                  id="inp-wiz-file"
                  class="is-hidden-file"
                  accept=".wav,.aif,.aiff,.aifc,.flac,.mp3,.ogg,.oga,.m4a,.aac,.opus,.webm,.caf,.ncw,.rx2,.rex,.rcy,.model,.neuronikmodel,.nmmodel,.scape,.sphere,.nmpack,.sf2,.sfz,.iso,.img,.dsk,.bin,.hda,.out,.efe,.ede,.gkh,.e4b,.esi,.x7u,.x8u,.x3a,.krz,.k25,.k26,.akp,.pgm,.set,.fzv,.fzf,.s3p,.sxt,.dwp,.dspreset,.nki,.vstpreset,.multisample,.adv,.exs,.talsmpl,.txprog,.kmp,.ksf,.dls,.xpm,.xty,.xtd,.xpn,.zip"
                  multiple
                />
              </label>
            </div>
          </div>
        </div>

        ${
          this.sourceKind === 'mapped_bank' && this.parsedPreset && this.preflightReport && bankGateModel
            ? `
          <div class="nmm-batch-card">
            <h3>${escHtml(MUSICIAN_TERMS.preflightImport)} — ${escHtml(this.parsedPreset.presetName)}</h3>
            <p class="nmm-batch-hint">
              Este archivo ya es un instrumento mapeado (${this.parsedPreset.regions.length} regiones). No necesita re-cortarse en los pasos 2 y 3: revisa el estado de compatibilidad y pasa directamente al Paso 4.
            </p>
            ${renderCommonPreflightGate(bankGateModel)}
            ${
              this.preflightReport.keyRange.uncoveredLowNotes > 0 ||
              this.preflightReport.keyRange.uncoveredHighNotes > 0 ||
              this.preflightReport.maxVelocityLayers > 2
                ? `
            <div class="batch-slicer-row">
              ${
                this.preflightReport.keyRange.uncoveredLowNotes > 0 ||
                this.preflightReport.keyRange.uncoveredHighNotes > 0
                  ? `
              <label class="batch-check">
                <input type="checkbox" id="chk-wiz-bank-extend" ${this.optBankAutoExtend ? 'checked' : ''} />
                <span>Extender zonas extremas para cubrir todo el teclado MIDI (0..127)</span>
              </label>
              `
                  : ''
              }
              ${
                this.preflightReport.maxVelocityLayers > 2
                  ? `
              <label class="batch-check">
                <input type="checkbox" id="chk-wiz-bank-vel" ${this.optBankAdaptVelocity ? 'checked' : ''} />
                <span>Adaptar capas de velocidad a 2 capas en modo Classic</span>
              </label>
              <label class="batch-check">
                <input type="checkbox" id="chk-wiz-bank-extmode" ${this.optBankSwitchExtended ? 'checked' : ''} />
                <span>Cambiar a modo Extended (conservar ${this.preflightReport.maxVelocityLayers} capas de velocidad)</span>
              </label>
              `
                  : ''
              }
            </div>
            `
                : ''
            }
          </div>
        `
            : ''
        }

        <footer class="nmm-modal-footer">
          <div class="footer-left">
            <span class="triage-count">
              ${
                this.sourceKind === 'raw_audio'
                  ? `Audio listo: ${escHtml(this.sourceName)} (${(this.rawPcm.length / this.rawSampleRate).toFixed(2)} s)`
                  : this.sourceKind === 'mapped_bank' && this.parsedPreset
                    ? `Banco listo: ${escHtml(this.parsedPreset.presetName)} (${this.parsedPreset.regions.length} regiones)`
                    : 'Selecciona o graba material para continuar'
              }
            </span>
          </div>
          <div class="footer-right">
            <button type="button" class="btn btn-outline" id="btn-wiz-cancel">Cerrar</button>
            ${
              this.sourceKind === 'mapped_bank' && this.parsedPreset && bankGateModel?.canContinue
                ? `
              <button type="button" class="btn btn-primary" id="btn-wiz-bank-to-step4">
                ${ICONS.check} Aplicar banco e ir al Paso 4 (Generar y exportar) →
              </button>
            `
                : ''
            }
            ${
              this.sourceKind === 'raw_audio' && this.rawPcm.length > 0
                ? `
              <button type="button" class="btn btn-primary" id="btn-wiz-to-step2">
                Siguiente: 2. Limpiar →
              </button>
            `
                : ''
            }
          </div>
        </footer>
      </div>
    `;
  }

  // ── Paso 2: Limpiar ──────────────────────────────────────

  private renderStep2Clean(): string {
    const clean = this.cleanResult;
    const noiseDb =
      clean && Number.isFinite(clean.noiseProfile.levelDbfs)
        ? `${clean.noiseProfile.levelDbfs.toFixed(1)} dBFS`
        : 'Silencio limpio (<-85 dBFS)';
    const hum50 =
      clean && Number.isFinite(clean.noiseProfile.hum50HzDb)
        ? `${clean.noiseProfile.hum50HzDb.toFixed(1)} dB`
        : 'n/d';

    return `
      <div class="nmm-batch-preflight-pane">
        <div class="triage-summary">
          ${ICONS.wave}
          <div>
            <p><strong>Paso 2 — Limpiar toma antes de cortar (${escHtml(this.sourceName)})</strong></p>
            <p>Aplicamos por defecto los ajustes seguros de músico: recorte de silencios ajustado al cruce por cero (sin clics), limpieza de ruido de fondo y normalización a -1.0 dBFS.</p>
          </div>
        </div>

        <!-- Resumen de métricas Antes / Después -->
        <div class="nmm-batch-card">
          <h3>Diagnóstico de limpieza y ${escHtml(MUSICIAN_TERMS.noisePrint)}</h3>
          <div class="nmm-preflight-grid">
            <div class="profile-item">
              <span class="profile-label">${escHtml(MUSICIAN_TERMS.noisePrint)}:</span>
              <strong class="profile-val">${escHtml(noiseDb)} (Hum 50 Hz: ${escHtml(hum50)})</strong>
            </div>
            <div class="profile-item">
              <span class="profile-label">Duración (Antes → Después):</span>
              <strong class="profile-val">${clean ? `${clean.durationBeforeSec}s → ${clean.durationAfterSec}s` : '—'}</strong>
            </div>
            <div class="profile-item">
              <span class="profile-label">Silencio recortado:</span>
              <strong class="profile-val">${clean ? `Entrada: ${clean.leadingTrimmedMs} ms · Salida: ${clean.trailingTrimmedMs} ms` : '—'}</strong>
            </div>
            <div class="profile-item">
              <span class="profile-label">Nivel de Pico (Antes → Después):</span>
              <strong class="profile-val batch-val-success">${clean ? `${clean.peakBeforeDbfs} dBFS → ${clean.peakAfterDbfs} dBFS` : '—'}</strong>
            </div>
          </div>

          <div class="batch-slicer-row">
            <button type="button" class="btn btn-outline btn-sm" id="btn-wiz-audition-raw">
              ${ICONS.play} Escuchar original
            </button>
            <button type="button" class="btn btn-primary btn-sm" id="btn-wiz-audition-clean">
              ${ICONS.play} Escuchar audio limpio
            </button>
            <button type="button" class="btn btn-ghost btn-sm" id="btn-wiz-stop-audition">
              ${ICONS.stop} Detener
            </button>
          </div>
        </div>

        <!-- Opciones de limpieza con Defaults de Músico -->
        <div class="nmm-batch-card">
          <h3>Ajustes de limpieza (Defaults de músico activados)</h3>
          <div class="nmm-preflight-grid">
            <label class="batch-check">
              <input type="checkbox" id="chk-wiz-trim" ${this.optTrimSilence ? 'checked' : ''} />
              <span>Recortar silencios de entrada y salida automáticamente</span>
            </label>
            <label class="batch-check">
              <input type="checkbox" id="chk-wiz-zcsnap" ${this.optSnapZeroCrossing ? 'checked' : ''} />
              <span><strong>${escHtml(MUSICIAN_TERMS.zcSnap)}</strong> (evita chasquidos al principio y final)</span>
            </label>
            <label class="batch-check">
              <input type="checkbox" id="chk-wiz-denoise" ${this.optApplyNoisePrint ? 'checked' : ''} />
              <span>Atenuar ruido de fondo y zumbido 50/60 Hz usando la huella de ruido</span>
            </label>
            <label class="batch-check">
              <input type="checkbox" id="chk-wiz-norm" ${this.optNormalizePeak ? 'checked' : ''} />
              <span>Normalizar pico a -1.0 dBFS y eliminar offset DC</span>
            </label>
          </div>

          <div class="batch-slicer-row">
            <button type="button" class="btn btn-outline btn-sm" id="btn-wiz-ai-bwe">
              ${ICONS.sparkle} Aplicar ${escHtml(MUSICIAN_TERMS.bwe)}
            </button>
            ${
              this.context.onOpenAdvancedRecorder
                ? `
              <button type="button" class="btn btn-outline btn-sm" id="btn-wiz-step2-adv-recorder">
                Abrir en taller avanzado (Grabadora / Huella de ruido manual)…
              </button>
            `
                : ''
            }
          </div>
        </div>

        <footer class="nmm-modal-footer">
          <div class="footer-left">
            <button type="button" class="btn btn-outline" id="btn-wiz-back-step1">← 1. Material</button>
          </div>
          <div class="footer-right">
            <button type="button" class="btn btn-primary" id="btn-wiz-to-step3">
              Siguiente: 3. Cortar y mapear →
            </button>
          </div>
        </footer>
      </div>
    `;
  }

  // ── Paso 3: Cortar y mapear ──────────────────────────────

  private renderStep3SliceAndMap(): string {
    const res = this.sliceMapResult;

    const slicesRowsHtml = (res?.slices ?? [])
      .slice(0, 24)
      .map(
        (sl, idx) => `
        <tr class="triage-row" data-slice-idx="${idx}">
          <td class="triage-col-idx">#${idx + 1}</td>
          <td class="triage-item-name">${escHtml(sl.label)}</td>
          <td class="triage-num">${(sl.durationSec * 1000).toFixed(0)} ms</td>
          <td class="triage-num">Teclas ${sl.lowKey}..${sl.highKey} (Raíz ${sl.rootKey})</td>
          <td class="triage-col-action">
            <button type="button" class="btn btn-xs btn-outline btn-wiz-play-slice" data-slice-idx="${idx}">
              ${ICONS.play} Escuchar
            </button>
          </td>
        </tr>
      `
      )
      .join('');

    return `
      <div class="nmm-batch-preflight-pane">
        <div class="triage-summary">
          ${ICONS.scissors}
          <div>
            <p><strong>Paso 3 — Cortar y mapear en el teclado ("¿Batería o melodía?")</strong></p>
            <p>Por defecto el asistente analiza el timbre y los ataques para decidir solo cómo trocear y repartir las zonas en el teclado MIDI <code>0..127</code> con ajuste al cruce por cero (<code>zc-snap</code>) y 2 capas en modo Classic.</p>
          </div>
        </div>

        <!-- Selector principal: ¿Batería o melodía? con "Detectar solo" por defecto -->
        <div class="nmm-batch-card">
          <h3>¿Qué tipo de material has grabado o importado?</h3>
          <div class="triage-toolbar-left">
            <button
              type="button"
              class="btn ${this.roleChoice === 'auto' ? 'btn-primary' : 'btn-outline'}"
              data-wiz-role="auto"
            >
              ${ICONS.sparkle} Detectar solo (Recomendado)
            </button>
            <button
              type="button"
              class="btn ${this.roleChoice === 'drums' ? 'btn-primary' : 'btn-outline'}"
              data-wiz-role="drums"
            >
              ${ICONS.drum} Batería / Percusión
            </button>
            <button
              type="button"
              class="btn ${this.roleChoice === 'melody' ? 'btn-primary' : 'btn-outline'}"
              data-wiz-role="melody"
            >
              ${ICONS.piano} Melodía / Varias notas
            </button>
            <button
              type="button"
              class="btn ${this.roleChoice === 'single' ? 'btn-primary' : 'btn-outline'}"
              data-wiz-role="single"
            >
              ${ICONS.wave} Nota única sostenida
            </button>
          </div>

          ${
            res
              ? `
            <div class="preflight-status is-ok cfg-gap-top">
              <div class="preflight-status-head">
                <div class="preflight-status-title">
                  <span class="preflight-status-icon">${ICONS.check}</span>
                  <span>Veredicto: ${escHtml(res.roleLabelEs)}</span>
                </div>
                <span class="preflight-status-meta">
                  Categoría: ${escHtml(res.detectedCategory)} · Parameter Set #${res.suggestedParameterSet} (${Math.round(res.classificationConfidence * 100)}% conf.)
                </span>
              </div>
              <p>${escHtml(res.roleExplanationEs)}</p>
              <p class="nmm-batch-hint" id="wiz-auto-decision-reason">${escHtml(res.autoDecisionReasonEs)}</p>
            </div>
          `
              : ''
          }

          ${
            res && res.resolvedRole === 'single'
              ? `
            <div class="batch-slicer-row" id="wiz-single-root-correction-bar">
              <div class="batch-field">
                <label for="inp-wiz-single-root">
                  Nota raíz (${midiToNoteName(res.effectiveRootKey)} · F0 auto: ${res.detectedF0Hz.toFixed(1)} Hz):
                </label>
                <button type="button" class="btn btn-xs btn-outline" data-wiz-root-delta="-12" title="Bajar 1 octava (-12 semitonos)">-12 Oct</button>
                <button type="button" class="btn btn-xs btn-outline" data-wiz-root-delta="-1" title="Bajar 1 semitono">-1 Semi</button>
                <input
                  type="number"
                  id="inp-wiz-single-root"
                  class="form-control"
                  min="0"
                  max="127"
                  value="${res.effectiveRootKey}"
                  aria-label="Nota raíz MIDI (0..127)"
                />
                <span class="val-pill">${midiToNoteName(res.effectiveRootKey)} (MIDI ${res.effectiveRootKey})</span>
                <button type="button" class="btn btn-xs btn-outline" data-wiz-root-delta="1" title="Subir 1 semitono">+1 Semi</button>
                <button type="button" class="btn btn-xs btn-outline" data-wiz-root-delta="12" title="Subir 1 octava (+12 semitonos)">+12 Oct</button>
                ${
                  this.singleRootKeyOverride !== null && this.singleRootKeyOverride !== res.detectedRootKey
                    ? `
                  <button type="button" class="btn btn-xs btn-ghost" id="btn-wiz-root-reset-auto" title="Restaurar nota raíz estimada por F0 (${midiToNoteName(res.detectedRootKey)})">
                    Auto F0 (${midiToNoteName(res.detectedRootKey)})
                  </button>
                `
                    : ''
                }
              </div>
            </div>
          `
              : ''
          }

          <div class="batch-slicer-row">
            <div class="batch-field">
              <label for="rng-wiz-sens">Sensibilidad de corte:</label>
              <input
                type="range"
                id="rng-wiz-sens"
                min="15"
                max="95"
                step="5"
                value="${this.sensitivity}"
                ${this.roleChoice === 'single' ? 'disabled' : ''}
              />
              <span class="val-pill">${this.sensitivity}%</span>
            </div>

            <label class="batch-check">
              <input type="checkbox" id="chk-wiz-step3-zcsnap" ${this.optSnapZeroCrossing ? 'checked' : ''} />
              <span>${escHtml(MUSICIAN_TERMS.zcSnap)}</span>
            </label>

            <label class="batch-check">
              <input type="checkbox" id="chk-wiz-step3-2layers" ${this.optClassicTwoLayers ? 'checked' : ''} />
              <span>Preparar 2 capas de velocidad en Classic (Suave 1..63 / Fuerte 64..127)</span>
            </label>
          </div>
        </div>

        <!-- Tabla de zonas / rebanadas generadas -->
        <div class="nmm-batch-card">
          <div class="triage-toolbar">
            <div class="triage-toolbar-left">
              <h3>Zonas mapeadas en el teclado (${res?.classicZones.length ?? 0} zona(s) · Cobertura 0..127 completa)</h3>
            </div>
            <div class="triage-toolbar-right">
              ${
                this.context.onOpenAdvancedChopper
                  ? `
                <button type="button" class="btn btn-outline btn-sm" id="btn-wiz-open-adv-chopper">
                  ${ICONS.scissors} Ajustar cortes en taller avanzado (Audio Chopper)…
                </button>
              `
                  : ''
              }
              ${
                this.context.onOpenAdvancedLoopEditor
                  ? `
                <button type="button" class="btn btn-outline btn-sm" id="btn-wiz-open-adv-loop">
                  ${ICONS.wave} Taller de bucles (Loop Editor)…
                </button>
              `
                  : ''
              }
            </div>
          </div>

          <div class="nmm-batch-table-container">
            <table class="triage-table">
              <thead>
                <tr>
                  <th class="triage-col-idx">#</th>
                  <th>Nota / Golpe detectado</th>
                  <th>Duración</th>
                  <th>Rango de teclado MIDI</th>
                  <th class="triage-col-action">Escuchar</th>
                </tr>
              </thead>
              <tbody>
                ${slicesRowsHtml || '<tr><td colspan="5" class="triage-empty">Sin cortes</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>

        <footer class="nmm-modal-footer">
          <div class="footer-left">
            <button type="button" class="btn btn-outline" id="btn-wiz-back-step2">← 2. Limpiar</button>
          </div>
          <div class="footer-right">
            <button type="button" class="btn btn-primary" id="btn-wiz-to-step4">
              Siguiente: 4. Generar y exportar →
            </button>
          </div>
        </footer>
      </div>
    `;
  }

  // ── Paso 4: Generar y exportar (ProcessPanel simplificado + 35.2) ──

  private renderStep4GenerateAndExport(): string {
    const paramSets = this.context.getParameterSets?.() ?? PARAMETER_SETS;
    const zoneCount =
      this.sourceKind === 'mapped_bank' && this.parsedPreset
        ? this.parsedPreset.regions.length
        : (this.sliceMapResult?.classicZones.length ?? this.context.getActiveSessionAudio?.()?.zoneCount ?? 1);
    const regionCount =
      this.sourceKind === 'mapped_bank' && this.parsedPreset
        ? this.parsedPreset.regions.length
        : (this.sliceMapResult?.extendedRegions.length ?? zoneCount);

    const exportSummary = resolveExportDestinationSummary({
      modelName: this.modelName,
      expandedName: this.expandedName,
      slot: this.context.getCurrentProcessConfig().modelNumber ?? 1,
      workingMode: this.workingMode,
      zoneCount,
      regionCount,
      hasActiveZoneSample: true,
    });

    const cards = buildExportDestinationCards();

    const destCardsHtml = cards
      .map((card) => {
        const isSelected = card.id === this.selectedDestinationId;
        const icon =
          card.id === 'time-capsule'
            ? ICONS.cpu
            : card.id === 'other-samplers'
              ? ICONS.database
              : ICONS.wave;
        const quickButtonsHtml = card.secondaryActions
          .map(
            (act) => `
              <button
                type="button"
                class="btn btn-xs btn-outline"
                data-wiz-dest-quick="${escAttr(card.id)}"
                data-wiz-action-id="${escAttr(act.id)}"
              >${escHtml(act.label)}</button>`
          )
          .join('');

        return `
          <div class="issue-card ${isSelected ? 'is-info' : ''}" data-wiz-dest-card="${escAttr(card.id)}">
            <div class="issue-head">
              <span class="issue-title">${icon} ${escHtml(card.title)}</span>
              <span class="issue-tags">
                <span class="issue-tag ${isSelected ? 'is-info' : ''}">${escHtml(card.badge)}</span>
                <button
                  type="button"
                  class="btn btn-sm ${isSelected ? 'btn-primary' : 'btn-outline'}"
                  data-wiz-dest-primary="${escAttr(card.id)}"
                >${escHtml(card.primaryActionLabel)}</button>
              </span>
            </div>
            <p class="issue-desc">${escHtml(card.description)}</p>
            <div class="triage-toolbar-left">
              <span class="triage-count">${escHtml(card.targetSubtitle)}</span>
              ${quickButtonsHtml}
            </div>
          </div>
        `;
      })
      .join('');

    const paramOptionsHtml = paramSets
      .map(
        (ps) =>
          `<option value="${ps.id}" ${ps.id === this.parameterSet ? 'selected' : ''}>Set #${ps.id} — ${escHtml(ps.name)}</option>`
      )
      .join('');

    return `
      <div class="nmm-batch-preflight-pane">
        <div class="triage-summary">
          ${ICONS.cpu}
          <div>
            <p><strong>Paso 4 — Generar modelo espectral y exportar a tu destino</strong></p>
            <p>${escHtml(`${exportSummary.slotLabel} • ${exportSummary.displayName} • ${exportSummary.modeLabel} (${exportSummary.zonesLabel})`)}. Revisa el nombre y el carácter acústico, genera el modelo resintetizado o elige directamente dónde quieres llevártelo.</p>
          </div>
        </div>

        <!-- ProcessPanel simplificado -->
        <div class="nmm-batch-card">
          <div class="triage-toolbar">
            <div class="triage-toolbar-left">
              <h3>Identidad y Motor del Instrumento (ProcessPanel Simplificado)</h3>
            </div>
            <div class="triage-toolbar-right">
              ${
                this.context.onOpenAdvancedModelConfig
                  ? `
                <button type="button" class="btn btn-outline btn-sm" id="btn-wiz-open-adv-modelcfg">
                  ${ICONS.settings} Abrir taller avanzado (Configuración completa del modelo)…
                </button>
              `
                  : ''
              }
            </div>
          </div>

          <div class="nmm-preflight-grid">
            <div class="batch-field">
              <label for="inp-wiz-model-name">Nombre Hardware (Classic, máx. 11):</label>
              <input
                type="text"
                id="inp-wiz-model-name"
                class="form-control"
                maxlength="11"
                value="${escAttr(this.modelName)}"
              />
            </div>

            <div class="batch-field">
              <label for="inp-wiz-expanded-name">Nombre Extendido (AxionikVS):</label>
              <input
                type="text"
                id="inp-wiz-expanded-name"
                class="form-control"
                maxlength="64"
                value="${escAttr(this.expandedName)}"
              />
            </div>

            <div class="batch-field">
              <label for="sel-wiz-working-mode">Modo de trabajo:</label>
              <select id="sel-wiz-working-mode" class="form-control">
                <option value="classic" ${this.workingMode === 'classic' ? 'selected' : ''}>Classic (2 capas · Hardware 1:1)</option>
                <option value="extended" ${this.workingMode === 'extended' ? 'selected' : ''}>Extended (Multicapa 2D HD)</option>
              </select>
            </div>

            <div class="batch-field">
              <label for="sel-wiz-param-set">Carácter Acústico (Parameter Set):</label>
              <select id="sel-wiz-param-set" class="form-control">
                ${paramOptionsHtml}
              </select>
            </div>
          </div>

          <p class="nmm-batch-hint cfg-gap-top">
            ${escHtml(describeWorkingModeForMusician(this.workingMode))}
          </p>

          <div class="batch-slicer-row">
            <button type="button" class="btn btn-outline" id="btn-wiz-apply-session-only">
              ${ICONS.check} Volcar zonas a la sesión sin cerrar
            </button>
            <button type="button" class="btn btn-primary" id="btn-wiz-generate-model-now">
              ${ICONS.play} Generar Modelo Espectral Ahora (Análisis FFT + Resíntesis)
            </button>
          </div>
        </div>

        <!-- Pantalla de Destinos de Exportación (Fase 35.2 integrada) -->
        <div class="nmm-batch-card">
          <h3>¿Dónde quieres usar o exportar tu instrumento?</h3>
          <div class="preflight-issues">
            ${destCardsHtml}
          </div>
        </div>

        <footer class="nmm-modal-footer">
          <div class="footer-left">
            <button type="button" class="btn btn-outline" id="btn-wiz-back-from-step4">
              ← ${this.sourceKind === 'raw_audio' ? '3. Cortar y mapear' : '1. Material'}
            </button>
          </div>
          <div class="footer-right">
            <button type="button" class="btn btn-outline" id="btn-wiz-close-footer">Cerrar asistente</button>
          </div>
        </footer>
      </div>
    `;
  }

  // ── Eventos e Interacciones ──────────────────────────────

  private commitPreparedInstrumentToSession(): void {
    if (this.hasCommittedToSession) return;

    if (this.sourceKind === 'mapped_bank' && this.parsedPreset) {
      const adapted = applyPreflightImportAdaptations(this.parsedPreset, {
        autoExtendOuterZones: this.optBankAutoExtend,
        adaptVelocityLayers: this.optBankAdaptVelocity,
        switchToExtendedMode: this.optBankSwitchExtended,
        currentWorkingMode: this.workingMode,
      });
      this.workingMode = adapted.suggestedWorkingMode;
      this.context.onCommitWizardInstrument({
        modelName: sanitizeClassicModelName(this.modelName),
        expandedName: this.expandedName.trim() || this.modelName,
        parameterSet: this.parameterSet,
        workingMode: this.workingMode,
        classicZones: adapted.classicZones,
        extendedRegions: adapted.extendedRegions,
        audioBuffers: adapted.audioBuffers,
      });
      this.hasCommittedToSession = true;
      return;
    }

    if (this.sourceKind === 'raw_audio' && this.sliceMapResult) {
      this.context.onCommitWizardInstrument({
        modelName: sanitizeClassicModelName(this.modelName),
        expandedName: this.expandedName.trim() || this.modelName,
        parameterSet: this.parameterSet,
        workingMode: this.workingMode,
        classicZones: this.sliceMapResult.classicZones,
        extendedRegions: this.sliceMapResult.extendedRegions,
        audioBuffers: this.sliceMapResult.audioBuffers,
      });
      this.hasCommittedToSession = true;
    }
  }

  private async handleFilesSelected(files: FileList | File[]): Promise<void> {
    const fileArr = Array.from(files);
    if (fileArr.length === 0) return;
    const primary = fileArr[0];
    this.errorMessage = null;

    const inspection = inspectWizardMaterialFilename(primary.name, fileArr.length, false);

    try {
      this.isBusy = true;
      const buffer = await primary.arrayBuffer();

      // 1. Check if it's a Hartmann Neuron bank/model or multi-file sampler bank
      const allNames = fileArr.map((f) => f.name);
      if (isNeuronBankOrModelInput(primary.name, buffer, allNames)) {
        const models = listNeuronBankModels(primary.name, buffer);
        if (models.length > 1) {
          this.isBusy = false;
          const multi = new MultiInstrumentModal();
          multi.open({
            fileName: primary.name,
            format: 'zip',
            items: models.map((m) => ({
              id: m.id,
              index: m.index,
              name: m.name,
              regionCount: m.regionCount,
              detail: m.detail,
            })),
            onSelect: (chosen) => {
              void (async () => {
                const preset = await parseNeuronBankOrModelToPreset(
                  primary.name,
                  buffer,
                  undefined,
                  chosen.id
                );
                this.loadParsedBankIntoWizard(preset);
              })();
            },
            onProcessBatch: () => {
              this.close();
              if (this.context.onOpenBatchProcessorWithFiles) {
                this.context.onOpenBatchProcessorWithFiles([{ name: primary.name, buffer }], primary.name);
              } else {
                this.context.onOpenBatchProcessor?.();
              }
            },
          });
          return;
        }
        const preset = await parseNeuronBankOrModelToPreset(primary.name, buffer);
        this.loadParsedBankIntoWizard(preset);
        this.isBusy = false;
        return;
      }

      // 2. Single raw audio file -> decode & go to Step 2 (Clean)
      if (inspection.kind === 'raw_audio') {
        let wavBuf = buffer;
        const lower = primary.name.toLowerCase();
        if (lower.endsWith('.aif') || lower.endsWith('.aiff') || lower.endsWith('.aifc')) {
          const dec = decodeAiff(buffer);
          this.isBusy = false;
          this.loadRawPcmIntoWizard(dec.mono, dec.sampleRate, primary.name);
          return;
        }
        if (!lower.endsWith('.wav')) {
          wavBuf = await transcodeAnyAudioToWavBuffer(buffer, primary.name);
        }
        const dec = decodeWav(wavBuf);
        this.isBusy = false;
        this.loadRawPcmIntoWizard(dec.mono, dec.sampleRate, primary.name);
        return;
      }

      // 3. Pre-mapped Sampler Bank (.sf2, .sfz, .dspreset, .zip, .iso, etc.)
      if (/\.(zip|xpn|iso|img|dsk|bin|hda|out|efe|ede|gkh|e4b|esi|x7u|x8u|x3a)$/i.test(primary.name)) {
        const programs = await listZipSamplerPrograms(primary.name, buffer);
        if (programs.length > 1) {
          this.isBusy = false;
          const multi = new MultiInstrumentModal();
          multi.open({
            fileName: primary.name,
            format: (programs[0]?.format as any) || 'zip',
            items: programs.map((p) => ({
              id: p.id,
              index: p.index,
              name: p.name,
              regionCount: p.regionCount,
              detail: p.detail,
            })),
            onSelect: (chosen) => {
              void (async () => {
                const preset = await parseUniversalSampler(
                  primary.name,
                  buffer,
                  undefined,
                  String(chosen.id)
                );
                this.loadParsedBankIntoWizard(preset);
              })();
            },
            onProcessBatch: () => {
              this.close();
              if (this.context.onOpenBatchProcessorWithFiles) {
                this.context.onOpenBatchProcessorWithFiles([{ name: primary.name, buffer }], primary.name);
              } else {
                this.context.onOpenBatchProcessor?.();
              }
            },
          });
          return;
        }
      }

      const siblings = new Map<string, Uint8Array>();
      for (const f of fileArr) {
        if (f !== primary) {
          siblings.set(f.name, new Uint8Array(await f.arrayBuffer()));
        }
      }
      const preset = await parseUniversalSampler(
        primary.name,
        buffer,
        siblings.size > 0 ? siblings : undefined
      );
      this.loadParsedBankIntoWizard(preset);
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
      this.render();
    } finally {
      this.isBusy = false;
    }
  }

  private loadParsedBankIntoWizard(preset: ParsedSamplerPreset): void {
    this.sourceKind = 'mapped_bank';
    this.sourceName = preset.presetName;
    this.parsedPreset = preset;
    this.preflightReport = analyzeImportPreflight(preset, this.workingMode);
    this.optBankAutoExtend = this.preflightReport.defaultActions.autoExtendOuterZones;
    this.optBankAdaptVelocity = this.preflightReport.defaultActions.adaptVelocityLayers;
    this.optBankSwitchExtended = this.preflightReport.defaultActions.switchToExtendedMode;
    this.modelName = sanitizeClassicModelName(preset.modelName || preset.presetName);
    this.expandedName = preset.presetName || preset.modelName || 'Mi Instrumento';
    this.parameterSet = preset.suggestedParameterSet ?? 0;
    this.hasCommittedToSession = false;
    this.render();
  }

  private async handleToggleInlineRecord(): Promise<void> {
    if (!this.isRecordingInline) {
      try {
        const engine = await this.capture.open({
          trimSilence: false,
          attachNoiseProfile: true,
          autoClassify: true,
        });
        this.context.onStopAudition?.();
        engine.startRecording();
        this.isRecordingInline = true;
        this.errorMessage = null;
        this.render();
      } catch (err) {
        this.errorMessage =
          err instanceof Error
            ? `No se pudo abrir el micrófono: ${err.message}`
            : 'No se pudo iniciar la grabación de audio.';
        this.render();
      }
      return;
    }

    // Stop inline recording and advance to Step 2 (Clean)
    try {
      const engine = await this.capture.open();
      if (engine.getState() === 'recording' || engine.getState() === 'paused') {
        const take = engine.stopRecording();
        await this.capture.close();
        this.isRecordingInline = false;
        const mono =
          take.samples.length === 1
            ? take.samples[0]
            : (() => {
                const L = take.samples[0] ?? new Float32Array(0);
                const R = take.samples[1] ?? L;
                const out = new Float32Array(L.length);
                for (let i = 0; i < L.length; i++) out[i] = 0.5 * (L[i] + R[i]);
                return out;
              })();
        this.loadRawPcmIntoWizard(mono, take.sampleRate, `Toma_${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.wav`);
      }
    } catch (err) {
      this.isRecordingInline = false;
      this.errorMessage = err instanceof Error ? err.message : String(err);
      this.render();
    }
  }

  private async handleRunAiBweInStep2(): Promise<void> {
    if (!this.cleanResult || this.cleanResult.cleanedPcm.length === 0) return;

    if (!bridgeClient.isConnected()) {
      await bridgeClient.checkHealth();
    }
    const decl = resolveAiActionDeclaration('recorder-bwe-enhance', {
      isBridgeConnected: bridgeClient.isConnected(),
    });

    // Consentimiento explícito siempre que el motor primario no esté disponible (Fase 35.4 + 35.5)
    if (decl.requiresFallbackConsent) {
      const accepted = await confirmDialog(decl.consentMessage, {
        title: decl.consentTitle,
        confirmLabel: decl.consentConfirmLabel,
        cancelLabel: 'Cancelar',
      });
      if (!accepted) return;
      this.optApplyNoisePrint = true;
      this.optNormalizePeak = true;
      this.recomputeCleanAndSlice();
      this.render();
      toast(`Aplicada ${decl.fallbackEngine} (confirmado por el usuario).`, 'success');
      return;
    }

    try {
      toast('Ejecutando Reconstructor de agudos (BWE) vía Companion Bridge…', 'info');
      const wav = encodePcm16Wav(this.cleanResult.cleanedPcm, this.cleanResult.sampleRate);
      const enhancedWavBytes = await bridgeClient.enhanceAudio(wav, {
        noiseProfile: this.cleanResult.noiseProfile,
      });
      const dec = decodeWav(
        enhancedWavBytes.buffer.slice(
          enhancedWavBytes.byteOffset,
          enhancedWavBytes.byteOffset + enhancedWavBytes.byteLength
        ) as ArrayBuffer
      );
      this.rawPcm = dec.mono;
      this.rawSampleRate = dec.sampleRate;
      this.recomputeCleanAndSlice();
      this.render();
      toast('Reconstructor de agudos (BWE) aplicado con éxito.', 'success');
    } catch (err) {
      toast(`Error en BWE: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }

  private bindEvents(): void {
    const root = this.backdropEl;
    if (!root) return;

    root.querySelector('#btn-wiz-close')?.addEventListener('click', () => this.close());
    root.querySelector('#btn-wiz-cancel')?.addEventListener('click', () => this.close());
    root.querySelector('#btn-wiz-close-footer')?.addEventListener('click', () => this.close());

    // Stepper navigation buttons
    root.querySelectorAll<HTMLButtonElement>('[data-wiz-step]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const step = btn.dataset.wizStep as MusicianWizardStep | undefined;
        if (step) {
          this.currentStep = step;
          this.render();
        }
      });
    });

    // ── Step 1 events ──
    root.querySelector('#btn-wiz-record-toggle')?.addEventListener('click', () => {
      void this.handleToggleInlineRecord();
    });

    root.querySelector('#btn-wiz-open-adv-recorder')?.addEventListener('click', () => {
      this.close();
      this.context.onOpenAdvancedRecorder?.();
    });

    root.querySelector('#btn-wiz-open-adv-import')?.addEventListener('click', () => {
      this.close();
      this.context.onOpenAdvancedUniversalImport?.();
    });

    root.querySelector('#btn-wiz-use-session-audio')?.addEventListener('click', () => {
      const act = this.context.getActiveSessionAudio?.();
      if (act?.pcm && act.pcm.length > 0) {
        this.loadRawPcmIntoWizard(act.pcm, act.sampleRate ?? 44100, act.sampleName || 'Session_Audio.wav');
      }
    });

    root.querySelector('#btn-wiz-skip-to-step4')?.addEventListener('click', () => {
      this.currentStep = 'generate_export';
      this.render();
    });

    const fileInput = root.querySelector<HTMLInputElement>('#inp-wiz-file');
    fileInput?.addEventListener('change', () => {
      if (fileInput.files && fileInput.files.length > 0) {
        void this.handleFilesSelected(fileInput.files);
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
          void this.handleFilesSelected(e.dataTransfer.files);
        }
      });
    }

    root.querySelector<HTMLInputElement>('#chk-wiz-bank-extend')?.addEventListener('change', (e) => {
      this.optBankAutoExtend = (e.currentTarget as HTMLInputElement).checked;
      this.render();
    });
    root.querySelector<HTMLInputElement>('#chk-wiz-bank-vel')?.addEventListener('change', (e) => {
      this.optBankAdaptVelocity = (e.currentTarget as HTMLInputElement).checked;
      this.render();
    });
    root.querySelector<HTMLInputElement>('#chk-wiz-bank-extmode')?.addEventListener('change', (e) => {
      this.optBankSwitchExtended = (e.currentTarget as HTMLInputElement).checked;
      this.render();
    });

    root.querySelector('#btn-wiz-bank-to-step4')?.addEventListener('click', () => {
      this.commitPreparedInstrumentToSession();
      this.currentStep = 'generate_export';
      this.render();
    });

    root.querySelector('#btn-wiz-to-step2')?.addEventListener('click', () => {
      this.currentStep = 'clean';
      this.render();
    });

    // ── Step 2 events ──
    root.querySelector('#btn-wiz-audition-raw')?.addEventListener('click', () => {
      if (this.rawPcm.length > 0) {
        this.context.onAuditionPcm?.(this.rawPcm, this.rawSampleRate);
      }
    });
    root.querySelector('#btn-wiz-audition-clean')?.addEventListener('click', () => {
      if (this.cleanResult && this.cleanResult.cleanedPcm.length > 0) {
        this.context.onAuditionPcm?.(this.cleanResult.cleanedPcm, this.cleanResult.sampleRate);
      }
    });
    root.querySelector('#btn-wiz-stop-audition')?.addEventListener('click', () => {
      this.context.onStopAudition?.();
    });

    root.querySelector<HTMLInputElement>('#chk-wiz-trim')?.addEventListener('change', (e) => {
      this.optTrimSilence = (e.currentTarget as HTMLInputElement).checked;
      this.recomputeCleanAndSlice();
      this.render();
    });
    root.querySelector<HTMLInputElement>('#chk-wiz-zcsnap')?.addEventListener('change', (e) => {
      this.optSnapZeroCrossing = (e.currentTarget as HTMLInputElement).checked;
      this.recomputeCleanAndSlice();
      this.render();
    });
    root.querySelector<HTMLInputElement>('#chk-wiz-denoise')?.addEventListener('change', (e) => {
      this.optApplyNoisePrint = (e.currentTarget as HTMLInputElement).checked;
      this.recomputeCleanAndSlice();
      this.render();
    });
    root.querySelector<HTMLInputElement>('#chk-wiz-norm')?.addEventListener('change', (e) => {
      this.optNormalizePeak = (e.currentTarget as HTMLInputElement).checked;
      this.recomputeCleanAndSlice();
      this.render();
    });

    root.querySelector('#btn-wiz-ai-bwe')?.addEventListener('click', () => {
      void this.handleRunAiBweInStep2();
    });
    root.querySelector('#btn-wiz-step2-adv-recorder')?.addEventListener('click', () => {
      this.close();
      this.context.onOpenAdvancedRecorder?.();
    });

    root.querySelector('#btn-wiz-back-step1')?.addEventListener('click', () => {
      this.currentStep = 'material';
      this.render();
    });
    root.querySelector('#btn-wiz-to-step3')?.addEventListener('click', () => {
      this.currentStep = 'slice_map';
      this.render();
    });

    // ── Step 3 events ──
    root.querySelectorAll<HTMLButtonElement>('[data-wiz-role]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const role = btn.dataset.wizRole as WizardSliceRoleChoice | undefined;
        if (role) {
          this.roleChoice = role;
          this.recomputeCleanAndSlice();
          this.render();
        }
      });
    });

    root.querySelector<HTMLInputElement>('#rng-wiz-sens')?.addEventListener('change', (e) => {
      this.sensitivity = parseInt((e.currentTarget as HTMLInputElement).value, 10) || 70;
      this.recomputeCleanAndSlice();
      this.render();
    });

    root.querySelector<HTMLInputElement>('#chk-wiz-step3-zcsnap')?.addEventListener('change', (e) => {
      this.optSnapZeroCrossing = (e.currentTarget as HTMLInputElement).checked;
      this.recomputeCleanAndSlice();
      this.render();
    });

    root.querySelector<HTMLInputElement>('#chk-wiz-step3-2layers')?.addEventListener('change', (e) => {
      this.optClassicTwoLayers = (e.currentTarget as HTMLInputElement).checked;
      this.recomputeCleanAndSlice();
      this.render();
    });

    root.querySelectorAll<HTMLButtonElement>('[data-wiz-root-delta]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const delta = parseInt(btn.dataset.wizRootDelta || '0', 10);
        if (!delta || !this.sliceMapResult) return;
        const currentRoot = this.sliceMapResult.effectiveRootKey;
        this.singleRootKeyOverride = Math.max(0, Math.min(127, currentRoot + delta));
        this.recomputeCleanAndSlice();
        this.render();
      });
    });

    root.querySelector<HTMLInputElement>('#inp-wiz-single-root')?.addEventListener('change', (e) => {
      const parsed = parseInt((e.currentTarget as HTMLInputElement).value, 10);
      if (Number.isFinite(parsed)) {
        this.singleRootKeyOverride = Math.max(0, Math.min(127, Math.round(parsed)));
        this.recomputeCleanAndSlice();
        this.render();
      }
    });

    root.querySelector('#btn-wiz-root-reset-auto')?.addEventListener('click', () => {
      this.singleRootKeyOverride = null;
      this.recomputeCleanAndSlice();
      this.render();
    });

    root.querySelectorAll<HTMLButtonElement>('.btn-wiz-play-slice').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.sliceIdx || '0', 10);
        const sl = this.sliceMapResult?.slices[idx];
        if (sl && this.cleanResult) {
          this.context.onAuditionPcm?.(sl.pcm, this.cleanResult.sampleRate);
        }
      });
    });

    root.querySelector('#btn-wiz-open-adv-chopper')?.addEventListener('click', () => {
      const pcm = this.cleanResult?.cleanedPcm ?? this.rawPcm;
      const sr = this.cleanResult?.sampleRate ?? this.rawSampleRate;
      const wav = pcm.length > 0 ? encodePcm16Wav(pcm, sr) : undefined;
      this.close();
      this.context.onOpenAdvancedChopper?.(wav, this.sourceName);
    });

    root.querySelector('#btn-wiz-open-adv-loop')?.addEventListener('click', () => {
      this.commitPreparedInstrumentToSession();
      this.close();
      this.context.onOpenAdvancedLoopEditor?.();
    });

    root.querySelector('#btn-wiz-back-step2')?.addEventListener('click', () => {
      this.currentStep = 'clean';
      this.render();
    });

    root.querySelector('#btn-wiz-to-step4')?.addEventListener('click', () => {
      this.commitPreparedInstrumentToSession();
      this.currentStep = 'generate_export';
      this.render();
    });

    // ── Step 4 events ──
    root.querySelector<HTMLInputElement>('#inp-wiz-model-name')?.addEventListener('input', (e) => {
      this.modelName = sanitizeClassicModelName((e.currentTarget as HTMLInputElement).value);
      this.hasCommittedToSession = false;
    });

    root.querySelector<HTMLInputElement>('#inp-wiz-expanded-name')?.addEventListener('input', (e) => {
      this.expandedName = (e.currentTarget as HTMLInputElement).value;
      this.hasCommittedToSession = false;
    });

    root.querySelector<HTMLSelectElement>('#sel-wiz-working-mode')?.addEventListener('change', (e) => {
      this.workingMode = ((e.currentTarget as HTMLSelectElement).value as WorkingMode) || 'classic';
      this.hasCommittedToSession = false;
      this.render();
    });

    root.querySelector<HTMLSelectElement>('#sel-wiz-param-set')?.addEventListener('change', (e) => {
      this.parameterSet = parseInt((e.currentTarget as HTMLSelectElement).value, 10) || 0;
      this.hasCommittedToSession = false;
    });

    root.querySelector('#btn-wiz-open-adv-modelcfg')?.addEventListener('click', () => {
      this.commitPreparedInstrumentToSession();
      this.close();
      this.context.onOpenAdvancedModelConfig?.();
    });

    root.querySelector('#btn-wiz-apply-session-only')?.addEventListener('click', () => {
      this.commitPreparedInstrumentToSession();
      toast(`Instrumento "${this.expandedName}" volcado a la sesión activa.`, 'success');
    });

    root.querySelector('#btn-wiz-generate-model-now')?.addEventListener('click', () => {
      this.commitPreparedInstrumentToSession();
      this.close();
      this.context.onStartProcessModel();
    });

    // 35.2 Destination Cards inside Step 4
    root.querySelectorAll<HTMLElement>('[data-wiz-dest-card]').forEach((cardEl) => {
      cardEl.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('button')) return;
        const id = cardEl.dataset.wizDestCard as ExportDestinationId | undefined;
        if (id && id !== this.selectedDestinationId) {
          this.selectedDestinationId = id;
          this.render();
        }
      });
    });

    root.querySelectorAll<HTMLButtonElement>('[data-wiz-dest-primary]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.wizDestPrimary as ExportDestinationId | undefined;
        if (!id) return;
        this.commitPreparedInstrumentToSession();
        this.close();
        void triggerExportDestinationAction(id, this.context);
      });
    });

    root.querySelectorAll<HTMLButtonElement>('[data-wiz-dest-quick]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.wizDestQuick as ExportDestinationId | undefined;
        const actId = btn.dataset.wizActionId;
        if (!id || !actId) return;
        this.commitPreparedInstrumentToSession();
        this.close();
        void triggerExportDestinationAction(id, this.context, actId);
      });
    });

    root.querySelector('#btn-wiz-back-from-step4')?.addEventListener('click', () => {
      this.currentStep = this.sourceKind === 'raw_audio' ? 'slice_map' : 'material';
      this.render();
    });
  }
}
