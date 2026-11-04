// ─────────────────────────────────────────────────────────
// Estado y contrato compartido del modal de Settings.
// Las pestañas no conocen la clase: reciben este contexto.
// ─────────────────────────────────────────────────────────

import type { AiAssistanceConfig, WorkingMode } from '../../core/types';
import type {
  AxionikDbModelEntry,
  BridgeModelInfo,
  BridgeScanResult,
} from '../../core/bridge/BridgeClient';
import type { WebGpuDeviceStatus } from '../../core/ai/WebNeuralEngine';
import type { FocusTrap } from '../modalFocusTrap';

export interface SettingsModalHandlers {
  onUpdateAiConfig: (config: AiAssistanceConfig) => void;
  onSelectThemeFamily: (family: string) => void;
  onSetThemeMode: (mode: 'light' | 'dark') => void;
  onSetWorkingMode?: (mode: WorkingMode) => void;
  getCurrentThemeFamily?: () => string;
  getCurrentThemeMode?: () => 'light' | 'dark';
  getCurrentWorkingMode?: () => WorkingMode;
}

export type SettingsModalTab = 'general' | 'ai' | 'web' | 'cloud' | 'bridge';
export type SettingsMainTab = 'general' | 'ai';
export type AiSubTab = 'web' | 'cloud' | 'bridge';

/** Todo lo mutable del modal: vive en la instancia y se comparte por referencia. */
export interface SettingsModalState {
  backdropEl: HTMLElement | null;
  focusTrap: FocusTrap | null;
  storageEstimate: { usage: number; quota: number; percent: number } | null;
  currentConfig: AiAssistanceConfig;
  activeMainTab: SettingsMainTab;
  activeAiSubTab: AiSubTab;
  unsubscribeBridge: (() => void) | null;
  webGpuStatus: WebGpuDeviceStatus | null;
  isTestingByok: boolean;
  byokTestResult: { success: boolean; message: string } | null;
  bridgeModels: BridgeModelInfo[];
  activePollingModelIds: Set<string>;
  downloadPollTimer: ReturnType<typeof setInterval> | null;
  showPassword: boolean;
  editingUrlModelId: string | null;
  scanResults: BridgeScanResult | null;
  isScanning: boolean;
  isScanningAxionik: boolean;
  axionikScanResults: AxionikDbModelEntry[] | null;
  isScanningNeuronDb: boolean;
  neuronDbScanResults: BridgeScanResult | null;
}

export function createSettingsModalState(): SettingsModalState {
  return {
    backdropEl: null,
    focusTrap: null,
    storageEstimate: null,
    currentConfig: {
      enabled: false,
      masterWave: 'dsp',
      separation: 'dsp',
      loopExpansion: 'dsp',
      classifier: 'dsp',
      denoise: 'dsp',
      pitchAndSlicer: 'dsp',
      deEsser: 'dsp',
      coverArtwork: 'procedural',
    },
    activeMainTab: 'general',
    activeAiSubTab: 'web',
    unsubscribeBridge: null,
    webGpuStatus: null,
    isTestingByok: false,
    byokTestResult: null,
    bridgeModels: [],
    activePollingModelIds: new Set<string>(),
    downloadPollTimer: null,
    showPassword: false,
    editingUrlModelId: null,
    scanResults: null,
    isScanning: false,
    isScanningAxionik: false,
    axionikScanResults: null,
    isScanningNeuronDb: false,
    neuronDbScanResults: null,
  };
}

/** Lo que cada pestaña necesita del shell. */
export interface SettingsModalContext {
  readonly state: SettingsModalState;
  readonly handlers: SettingsModalHandlers;
  rerender(): void;
  close(): void;
}
