// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Fase 34, Fase 30 & Fase 37:
// Studio Audio Recorder, Noise/DSP Lab & Native MIDI AutoSampler
//
// Frontal del grabador sobre el núcleo portable `RecordingEngine`
// (@abdsynths/shared/dsp/take) + `AudioCaptureService` (captura de
// plataforma: getUserMedia → AudioWorklet → engine.pushSamples()),
// enriquecido con:
//   - Selector superior de modo:
//       1) Grabación Directa de Audio (Mic / Línea)
//       2) AutoSampler MIDI Integrado (Barrido Automático | Teclado MIDI en Vivo | Caja de Ritmos)
//   - Forma de onda en vivo con desplazamiento horizontal continuo y nivel de
//     zoom constante seleccionable (`2 s`, `5 s`, `10 s`, `30 s` en pantalla)
//     sin achatarse a medida que avanza la grabación, mostrando modulaciones
//     de LFO/chorus y marcas vivas `NoteOn` (verde), `NoteOff` (ámbar) y `TailEnd` (cian).
//   - Curvas de velocidad (`linear`, `high_precision`, `low_precision`,
//     `classic_neuron_2layer`, `manual_table`), gestión de colas de release
//     (`auto_decay` al suelo de ruido vs `fixed_time`), mapas de caja de ritmos
//     (`.txt`, `.json`, `.yaml` + extractor de manuales + presets de fábrica),
//     utilidad de continuar grabación interrumpida (`[Continuar desde donde se paró]`),
//     rescate no destructivo con chunk RIFF `atem`, limpieza continua previa al
//     corte y `AutoLoop` acotado estrictamente a la región sostenida (`NoteOn..NoteOff`).
// ─────────────────────────────────────────────────────────

import type { RecorderContext } from './recorder/types.ts';
import type { AudioRecorderContext, LiveWaveWindowSec, RecorderOperatingMode, SessionTake } from './recorder/types.ts';
import { normalizeNoiseProfile } from './recorder/recorderUtils.ts';
import type { MidiAutoSampleManifest, MidiCapturedNoteEvent } from '@abdsynths/shared/contracts/recordingSession';
import type { FinalizedTake } from '@abdsynths/shared/dsp/take/recordingEngine.ts';
import type { NoiseProfile, PilotNoteRecommendation, SilenceRange } from '@abdsynths/shared/dsp/take/takeDsp.ts';
import { AudioCaptureService } from '../core/AudioCaptureService.ts';
import { DEFAULT_AUTOSAMPLER_CONFIG, LiveMidiCaptureTracker, buildScheduleFromConfig, type AutoSamplerConfig, type AutoSamplerProcessedOutput } from '../core/autoSampler/MidiAutoSampleSession.ts';
import { onAppLocaleChange } from '../core/i18n.ts';
import { WebMidiAutoSamplerService, type MidiPortDescriptor } from '../core/midi/WebMidiAutoSamplerService.ts';
import { createModalFocusTrap, type FocusTrap } from './modalFocusTrap.ts';
import {
  bindWaveCanvasEvents,
  drawTakeWaveform,
  startMeterLoop,
} from './recorder/canvasOps.ts';
import {
  cancelAndDiscard,
  enableMic,
  refreshDevices,
  refreshMidiPorts,
  stopAndKeep,
  toggleRecord,
} from './recorder/captureOps.ts';
import {
  renderAutoSamplerDeck,
  renderAutoSamplerGrid,
} from './recorder/deckOps.ts';
import {
  render,
  renderTakeInspector,
  renderTakes,
  renderTransport,
  setBusy,
  syncTransportState,
} from './recorder/renderOps.ts';
import {
  runAutoSamplerPostProcessOnTake,
  runAutoSamplerSweep,
  runPilotCalibration,
  toggleLiveMidiCapture,
} from './recorder/sweepOps.ts';
import {
  applyAiEnhanceToTake,
  applyAlgorithmicDenoiseToTake,
  applyDspDenoiseToTake,
  applyNormalizeAndDcBlockToTake,
  applyTrimSilenceToTake,
  auditionSelectedRegion,
  auditionTake,
  captureNoisePrintFromSelection,
  deleteTake,
  downloadTake,
  finishTake,
  getAiDenoiseActionContext,
  injectTakeIntoSession,
  pushUndoSnapshot,
  rebuildTakeFromChannels,
  selectTake,
  sendTakeToChopper,
  undoTakeEdit,
} from './recorder/takeOps.ts';
export type { AudioRecorderContext, SessionTake, RecorderOperatingMode, LiveWaveWindowSec } from './recorder/types.ts';

export class AudioRecorderModal {
  private backdropEl: HTMLElement | null = null;
  private focusTrap: FocusTrap | null = null;
  private readonly capture = new AudioCaptureService();
  private readonly midi = new WebMidiAutoSamplerService();
  private readonly context: AudioRecorderContext;

  private devices: MediaDeviceInfo[] = [];
  private selectedDeviceId = '';
  private takes: SessionTake[] = [];
  private selectedTakeId: string | null = null;
  private takeSeq = 0;
  private rafId = 0;
  private opening = false;

  // Configuraciones interactivas de detección de ruido, normalización y denoise (3 modos)
  private silenceThresholdDb = -48;
  private minSilenceMs = 120;
  private denoiseReductionDb = 14;
  private autoNormalizeOnFinish = false;
  private autoDetectNoiseOnFinish = true;
  private denoiseMode: 'algorithmic' | 'noise_print' | 'ai' = 'noise_print';
  private isDraggingSelection = false;
  private dragAnchorFrame = 0;

  // Fase 37: Modo de operación, ventana de zoom constante en vivo y AutoSampler
  private operatingMode: RecorderOperatingMode = 'free_audio';
  private liveWindowSec: LiveWaveWindowSec = 5;
  private autoSamplerConfig: AutoSamplerConfig = {
    ...DEFAULT_AUTOSAMPLER_CONFIG,
    manualVelocities: [...DEFAULT_AUTOSAMPLER_CONFIG.manualVelocities],
  };
  private midiOutputs: MidiPortDescriptor[] = [];
  private midiInputs: MidiPortDescriptor[] = [];
  private activeSchedule: MidiCapturedNoteEvent[] = [];
  private isSweepRunning = false;
  private sweepAbortRequested = false;
  private liveTracker: LiveMidiCaptureTracker | null = null;
  private liveMidiUnsub: (() => void) | null = null;
  private liveMarkers: Array<{ frame: number; kind: 'noteOn' | 'noteOff' | 'tailEnd'; label: string }> = [];
  private showDrumHelpPanel = false;
  private showManualExtractorPanel = false;
  private pilotDiagnosticText = '';
  private lastPilotRecommendation: PilotNoteRecommendation | null = null;

  constructor(context: AudioRecorderContext = {}) {
    this.context = context;
    this.activeSchedule = buildScheduleFromConfig(this.autoSamplerConfig);
    onAppLocaleChange(() => {
      if (this.backdropEl) {
        this.render();
      }
    });
  }

  public isOpen(): boolean {
    return this.backdropEl !== null;
  }

  public getTakes(): ReadonlyArray<SessionTake> {
    return this.takes;
  }

  public getSelectedTake(): SessionTake | null {
    if (!this.selectedTakeId) return this.takes[0] ?? null;
    return this.takes.find((t) => t.id === this.selectedTakeId) ?? this.takes[0] ?? null;
  }

  public getOperatingMode(): RecorderOperatingMode {
    return this.operatingMode;
  }

  public setOperatingMode(mode: RecorderOperatingMode): void {
    this.operatingMode = mode;
    if (this.backdropEl) {
      this.render();
    }
  }

  public getAutoSamplerConfig(): Readonly<AutoSamplerConfig> {
    return this.autoSamplerConfig;
  }

  /** Permite inyectar un take sintético o importado (útil para tests y flujo directo). */
  public addExternalTake(
    take: FinalizedTake,
    customName?: string,
    manifest?: MidiAutoSampleManifest
  ): SessionTake {
    return this.finishTake(take, customName, manifest);
  }

  public open(initialMode?: RecorderOperatingMode): void {
    if (initialMode) {
      this.operatingMode = initialMode;
    }
    if (this.backdropEl) {
      this.backdropEl.querySelector<HTMLElement>('.nmm-modal-window')?.focus?.();
      return;
    }
    this.backdropEl = document.createElement('div');
    this.backdropEl.className = 'nmm-modal-backdrop nmm-recorder-backdrop';
    document.body.appendChild(this.backdropEl);
    this.backdropEl.addEventListener('click', (e) => {
      if (e.target === this.backdropEl) void this.close();
    });
    this.focusTrap = createModalFocusTrap(this.backdropEl, {
      onEscape: () => void this.close(),
    });
    this.focusTrap.activate();
    this.render();
    void this.refreshDevices();
    if (this.operatingMode === 'midi_autosampler') {
      void this.refreshMidiPorts();
    }
    this.startMeterLoop();
  }

  public async close(): Promise<void> {
    if (!this.backdropEl) return;
    this.sweepAbortRequested = true;
    this.midi.sendAllNotesOff();
    this.liveMidiUnsub?.();
    this.liveMidiUnsub = null;
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.context.onStopAudition?.();
    try {
      const engine = this.capture.isOpen() ? await this.capture.open() : null;
      if (engine && (engine.getState() === 'recording' || engine.getState() === 'paused')) {
        this.finishTake(engine.stopRecording());
      }
    } catch {
      // Si el motor no está disponible, no hay take que rescatar.
    }
    await this.capture.close().catch(() => undefined);
    this.focusTrap?.deactivate();
    this.focusTrap = null;
    this.backdropEl.remove();
    this.backdropEl = null;
  }

  // ── Dispositivos Audio y WebMIDI ──────────────────────────


  public async applyAiEnhanceToTake(takeId?: string): Promise<boolean> {
    return applyAiEnhanceToTake(this.recorderCtx(), takeId);
  }

  public applyAlgorithmicDenoiseToTake(takeId?: string): boolean {
    return applyAlgorithmicDenoiseToTake(this.recorderCtx(), takeId);
  }

  public applyDspDenoiseToTake(takeId?: string): boolean {
    return applyDspDenoiseToTake(this.recorderCtx(), takeId);
  }

  public applyNormalizeAndDcBlockToTake(mode: 'peak' | 'rms' = 'peak', takeId?: string): boolean {
    return applyNormalizeAndDcBlockToTake(this.recorderCtx(), mode, takeId);
  }

  public applyTrimSilenceToTake(takeId?: string): boolean {
    return applyTrimSilenceToTake(this.recorderCtx(), takeId);
  }

  private auditionSelectedRegion(): void {
    return auditionSelectedRegion(this.recorderCtx());
  }

  private auditionTake(id: string): void {
    return auditionTake(this.recorderCtx(), id);
  }

  private bindWaveCanvasEvents(
    st: SessionTake,
    mono: Float32Array,
    silences: SilenceRange[]
  ): void {
    return bindWaveCanvasEvents(this.recorderCtx(), st, mono, silences);
  }

  private cancelAndDiscard(): void {
    return cancelAndDiscard(this.recorderCtx());
  }

  public captureNoisePrintFromSelection(takeId?: string): NoiseProfile | null {
    return captureNoisePrintFromSelection(this.recorderCtx(), takeId);
  }

  private deleteTake(id: string): void {
    return deleteTake(this.recorderCtx(), id);
  }

  private downloadTake(id: string): void {
    return downloadTake(this.recorderCtx(), id);
  }

  private drawTakeWaveform(
    st: SessionTake,
    mono: Float32Array,
    silences: SilenceRange[]
  ): void {
    return drawTakeWaveform(this.recorderCtx(), st, mono, silences);
  }

  private async enableMic(): Promise<void> {
    return enableMic(this.recorderCtx());
  }

  public finishTake(
    rawTake: FinalizedTake,
    customName?: string,
    explicitManifest?: MidiAutoSampleManifest
  ): SessionTake {
    return finishTake(this.recorderCtx(), rawTake, customName, explicitManifest);
  }

  private getAiDenoiseActionContext() {
    return getAiDenoiseActionContext(this.recorderCtx());
  }

  private injectTakeIntoSession(id: string): void {
    return injectTakeIntoSession(this.recorderCtx(), id);
  }

  private pushUndoSnapshot(st: SessionTake): void {
    return pushUndoSnapshot(this.recorderCtx(), st);
  }

  private rebuildTakeFromChannels(
    st: SessionTake,
    channels: Float32Array[],
    sampleRate = st.take.sampleRate,
    noiseProfile = normalizeNoiseProfile(st.take.noiseProfile)
  ): void {
    return rebuildTakeFromChannels(this.recorderCtx(), st, channels, sampleRate, noiseProfile);
  }

  private async refreshDevices(): Promise<void> {
    return refreshDevices(this.recorderCtx());
  }

  private async refreshMidiPorts(): Promise<void> {
    return refreshMidiPorts(this.recorderCtx());
  }

  private render(): void {
    return render(this.recorderCtx());
  }

  private renderAutoSamplerDeck(): void {
    return renderAutoSamplerDeck(this.recorderCtx());
  }

  private renderAutoSamplerGrid(): void {
    return renderAutoSamplerGrid(this.recorderCtx());
  }

  private renderTakeInspector(): void {
    return renderTakeInspector(this.recorderCtx());
  }

  private renderTakes(): void {
    return renderTakes(this.recorderCtx());
  }

  private renderTransport(): void {
    return renderTransport(this.recorderCtx());
  }

  public runAutoSamplerPostProcessOnTake(st: SessionTake): AutoSamplerProcessedOutput | null {
    return runAutoSamplerPostProcessOnTake(this.recorderCtx(), st);
  }

  public async runAutoSamplerSweep(options?: {
    resumeTakeId?: string;
    specificCellIndex?: number;
  }): Promise<SessionTake | null> {
    return runAutoSamplerSweep(this.recorderCtx(), options);
  }

  private async runPilotCalibration(): Promise<void> {
    return runPilotCalibration(this.recorderCtx());
  }

  private selectTake(id: string): void {
    return selectTake(this.recorderCtx(), id);
  }

  private sendTakeToChopper(id: string): void {
    return sendTakeToChopper(this.recorderCtx(), id);
  }

  private setBusy(busy: boolean): void {
    return setBusy(this.recorderCtx(), busy);
  }

  private startMeterLoop(): void {
    return startMeterLoop(this.recorderCtx());
  }

  private stopAndKeep(): void {
    return stopAndKeep(this.recorderCtx());
  }

  private syncTransportState(): void {
    return syncTransportState(this.recorderCtx());
  }

  private async toggleLiveMidiCapture(): Promise<void> {
    return toggleLiveMidiCapture(this.recorderCtx());
  }

  private async toggleRecord(): Promise<void> {
    return toggleRecord(this.recorderCtx());
  }

  public undoTakeEdit(takeId?: string): boolean {
    return undoTakeEdit(this.recorderCtx(), takeId);
  }

  private recorderCtx(): RecorderContext {
    const host = this;
    return {
      state: {
    get backdropEl() { return host.backdropEl; },
    set backdropEl(v: HTMLElement | null) { host.backdropEl = v; },
    get focusTrap() { return host.focusTrap; },
    set focusTrap(v: FocusTrap | null) { host.focusTrap = v; },
    get capture() { return host.capture; },
    get midi() { return host.midi; },
    get context() { return host.context; },
    get devices() { return host.devices; },
    set devices(v: MediaDeviceInfo[]) { host.devices = v; },
    get selectedDeviceId() { return host.selectedDeviceId; },
    set selectedDeviceId(v: string) { host.selectedDeviceId = v; },
    get takes() { return host.takes; },
    set takes(v: SessionTake[]) { host.takes = v; },
    get selectedTakeId() { return host.selectedTakeId; },
    set selectedTakeId(v: string | null) { host.selectedTakeId = v; },
    get takeSeq() { return host.takeSeq; },
    set takeSeq(v: number) { host.takeSeq = v; },
    get rafId() { return host.rafId; },
    set rafId(v: number) { host.rafId = v; },
    get opening() { return host.opening; },
    set opening(v: boolean) { host.opening = v; },
    get silenceThresholdDb() { return host.silenceThresholdDb; },
    set silenceThresholdDb(v: number) { host.silenceThresholdDb = v; },
    get minSilenceMs() { return host.minSilenceMs; },
    set minSilenceMs(v: number) { host.minSilenceMs = v; },
    get denoiseReductionDb() { return host.denoiseReductionDb; },
    set denoiseReductionDb(v: number) { host.denoiseReductionDb = v; },
    get autoNormalizeOnFinish() { return host.autoNormalizeOnFinish; },
    set autoNormalizeOnFinish(v: boolean) { host.autoNormalizeOnFinish = v; },
    get autoDetectNoiseOnFinish() { return host.autoDetectNoiseOnFinish; },
    set autoDetectNoiseOnFinish(v: boolean) { host.autoDetectNoiseOnFinish = v; },
    get denoiseMode() { return host.denoiseMode; },
    set denoiseMode(v: 'algorithmic' | 'noise_print' | 'ai') { host.denoiseMode = v; },
    get isDraggingSelection() { return host.isDraggingSelection; },
    set isDraggingSelection(v: boolean) { host.isDraggingSelection = v; },
    get dragAnchorFrame() { return host.dragAnchorFrame; },
    set dragAnchorFrame(v: number) { host.dragAnchorFrame = v; },
    get operatingMode() { return host.operatingMode; },
    set operatingMode(v: RecorderOperatingMode) { host.operatingMode = v; },
    get liveWindowSec() { return host.liveWindowSec; },
    set liveWindowSec(v: LiveWaveWindowSec) { host.liveWindowSec = v; },
    get autoSamplerConfig() { return host.autoSamplerConfig; },
    set autoSamplerConfig(v: AutoSamplerConfig) { host.autoSamplerConfig = v; },
    get midiOutputs() { return host.midiOutputs; },
    set midiOutputs(v: MidiPortDescriptor[]) { host.midiOutputs = v; },
    get midiInputs() { return host.midiInputs; },
    set midiInputs(v: MidiPortDescriptor[]) { host.midiInputs = v; },
    get activeSchedule() { return host.activeSchedule; },
    set activeSchedule(v: MidiCapturedNoteEvent[]) { host.activeSchedule = v; },
    get isSweepRunning() { return host.isSweepRunning; },
    set isSweepRunning(v: boolean) { host.isSweepRunning = v; },
    get sweepAbortRequested() { return host.sweepAbortRequested; },
    set sweepAbortRequested(v: boolean) { host.sweepAbortRequested = v; },
    get liveTracker() { return host.liveTracker; },
    set liveTracker(v: LiveMidiCaptureTracker | null) { host.liveTracker = v; },
    get liveMidiUnsub() { return host.liveMidiUnsub; },
    set liveMidiUnsub(v: (() => void) | null) { host.liveMidiUnsub = v; },
    get liveMarkers() { return host.liveMarkers; },
    set liveMarkers(v: Array<{ frame: number; kind: 'noteOn' | 'noteOff' | 'tailEnd'; label: string }>) { host.liveMarkers = v; },
    get showDrumHelpPanel() { return host.showDrumHelpPanel; },
    set showDrumHelpPanel(v: boolean) { host.showDrumHelpPanel = v; },
    get showManualExtractorPanel() { return host.showManualExtractorPanel; },
    set showManualExtractorPanel(v: boolean) { host.showManualExtractorPanel = v; },
    get pilotDiagnosticText() { return host.pilotDiagnosticText; },
    set pilotDiagnosticText(v: string) { host.pilotDiagnosticText = v; },
    get lastPilotRecommendation() { return host.lastPilotRecommendation; },
    set lastPilotRecommendation(v: PilotNoteRecommendation | null) { host.lastPilotRecommendation = v; }
      },
    applyAiEnhanceToTake: (takeId?: string): Promise<boolean> => this.applyAiEnhanceToTake(takeId),
    applyAlgorithmicDenoiseToTake: (takeId?: string): boolean => this.applyAlgorithmicDenoiseToTake(takeId),
    applyDspDenoiseToTake: (takeId?: string): boolean => this.applyDspDenoiseToTake(takeId),
    applyNormalizeAndDcBlockToTake: (mode: 'peak' | 'rms' = 'peak', takeId?: string): boolean => this.applyNormalizeAndDcBlockToTake(mode, takeId),
    auditionSelectedRegion: (): void => this.auditionSelectedRegion(),
    auditionTake: (id: string): void => this.auditionTake(id),
    bindWaveCanvasEvents: (
    st: SessionTake,
    mono: Float32Array,
    silences: SilenceRange[]
  ): void => this.bindWaveCanvasEvents(st, mono, silences),
    cancelAndDiscard: (): void => this.cancelAndDiscard(),
    captureNoisePrintFromSelection: (takeId?: string): NoiseProfile | null => this.captureNoisePrintFromSelection(takeId),
    close: (): Promise<void> => this.close(),
    deleteTake: (id: string): void => this.deleteTake(id),
    downloadTake: (id: string): void => this.downloadTake(id),
    drawTakeWaveform: (
    st: SessionTake,
    mono: Float32Array,
    silences: SilenceRange[]
  ): void => this.drawTakeWaveform(st, mono, silences),
    enableMic: (): Promise<void> => this.enableMic(),
    finishTake: (
    rawTake: FinalizedTake,
    customName?: string,
    explicitManifest?: MidiAutoSampleManifest
  ): SessionTake => this.finishTake(rawTake, customName, explicitManifest),
    getAiDenoiseActionContext: () => this.getAiDenoiseActionContext(),
    getSelectedTake: (): SessionTake | null => this.getSelectedTake(),
    injectTakeIntoSession: (id: string): void => this.injectTakeIntoSession(id),
    pushUndoSnapshot: (st: SessionTake): void => this.pushUndoSnapshot(st),
    rebuildTakeFromChannels: (
    st: SessionTake,
    channels: Float32Array[],
    sampleRate = st.take.sampleRate,
    noiseProfile = normalizeNoiseProfile(st.take.noiseProfile)
  ): void => this.rebuildTakeFromChannels(st, channels, sampleRate, noiseProfile),
    refreshDevices: (): Promise<void> => this.refreshDevices(),
    refreshMidiPorts: (): Promise<void> => this.refreshMidiPorts(),
    render: (): void => this.render(),
    renderAutoSamplerDeck: (): void => this.renderAutoSamplerDeck(),
    renderAutoSamplerGrid: (): void => this.renderAutoSamplerGrid(),
    renderTakeInspector: (): void => this.renderTakeInspector(),
    renderTakes: (): void => this.renderTakes(),
    renderTransport: (): void => this.renderTransport(),
    runAutoSamplerPostProcessOnTake: (st: SessionTake): AutoSamplerProcessedOutput | null => this.runAutoSamplerPostProcessOnTake(st),
    runAutoSamplerSweep: (options?: {
    resumeTakeId?: string;
    specificCellIndex?: number;
  }): Promise<SessionTake | null> => this.runAutoSamplerSweep(options),
    runPilotCalibration: (): Promise<void> => this.runPilotCalibration(),
    selectTake: (id: string): void => this.selectTake(id),
    sendTakeToChopper: (id: string): void => this.sendTakeToChopper(id),
    setBusy: (busy: boolean): void => this.setBusy(busy),
    startMeterLoop: (): void => this.startMeterLoop(),
    stopAndKeep: (): void => this.stopAndKeep(),
    syncTransportState: (): void => this.syncTransportState(),
    toggleLiveMidiCapture: (): Promise<void> => this.toggleLiveMidiCapture(),
    toggleRecord: (): Promise<void> => this.toggleRecord(),
    undoTakeEdit: (takeId?: string): boolean => this.undoTakeEdit(takeId)
    };
  }
}
