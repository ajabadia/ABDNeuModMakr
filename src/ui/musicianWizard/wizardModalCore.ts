// ─────────────────────────────────────────────────────────
// MusicianWizardModal — nucleo estructural (Fase 42.5)
// Contexto + interfaz que expone el estado y la API que usan
// los modulos de `src/ui/musicianWizard/`.
// ─────────────────────────────────────────────────────────

import type { ExportDestinationCallbacks, ExportDestinationId } from '../../app/exportDestinations.ts';
import type { AudioCaptureService } from '../../core/AudioCaptureService.ts';
import type { ImportPreflightReport } from '../../core/import/importPreflight.ts';
import type { ParsedSamplerPreset } from '../../core/import/rawSamplerParsers.ts';
import type { ProcessConfig, WorkingMode, ParameterSetInfo, Zone, ExtendedRegion } from '../../core/types.ts';
import type { MusicianWizardStep, WizardCleanResult, WizardSliceRoleChoice, WizardSliceAndMapResult } from '../../core/wizard/musicianWizard.ts';
import type { FocusTrap } from '../modalFocusTrap.ts';

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


export interface WizardModalCore {
  context: MusicianWizardModalContext;
  backdropEl: HTMLElement | null;
  focusTrap: FocusTrap | null;
  currentStep: MusicianWizardStep;
  isBusy: boolean;
  errorMessage: string | null;
  capture: AudioCaptureService;
  isRecordingInline: boolean;
  sourceKind: 'none' | 'raw_audio' | 'mapped_bank';
  sourceName: string;
  rawPcm: Float32Array;
  rawSampleRate: number;
  parsedPreset: ParsedSamplerPreset | null;
  preflightReport: ImportPreflightReport | null;
  optBankAutoExtend: boolean;
  optBankAdaptVelocity: boolean;
  optBankSwitchExtended: boolean;
  optTrimSilence: boolean;
  optSnapZeroCrossing: boolean;
  optDcBlock: boolean;
  optApplyNoisePrint: boolean;
  optNormalizePeak: boolean;
  cleanResult: WizardCleanResult | null;
  roleChoice: WizardSliceRoleChoice;
  sensitivity: number;
  optClassicTwoLayers: boolean;
  singleRootKeyOverride: number | null;
  sliceMapResult: WizardSliceAndMapResult | null;
  modelName: string;
  expandedName: string;
  workingMode: WorkingMode;
  parameterSet: number;
  selectedDestinationId: ExportDestinationId;
  hasCommittedToSession: boolean;
  close(): void;
  render(): void;
  renderStep1Material(): string;
  renderStep2Clean(): string;
  renderStep3SliceAndMap(): string;
  renderStep4GenerateAndExport(): string;
  loadRawPcmIntoWizard(pcm: Float32Array, sampleRate: number, filename: string): void;
  recomputeCleanAndSlice(): void;
  commitPreparedInstrumentToSession(): void;
  handleFilesSelected(files: FileList | File[]): Promise<void>;
  loadParsedBankIntoWizard(preset: ParsedSamplerPreset): void;
  handleToggleInlineRecord(): Promise<void>;
  handleRunAiBweInStep2(): Promise<void>;
  bindEvents(): void;
}
