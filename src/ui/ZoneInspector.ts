// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Zone Table & Sliding Zone Metadata Drawer
// Implements the canonical Hartmann MODELmaker v1.2 ZoneTableModel
// (Zone, Low Key, Root Key, High Key, Low Vel, High Vel, Detune,
// Volume, Pan) with full vertical height (up to 128 zones) and a
// right-side sliding drawer for Zone Metadata editing.
// ─────────────────────────────────────────────────────────

import type { AcousticClassificationResult, AssetStoreDiagnostics, CommonPlaybackDefaults, ExtendedModelMetadata, ExtendedRegion, MasterWaveConfig, ModelProvenance, SynthArticulationConfig, WorkingMode, KeyMappingMode, Zone, ZoneLoopEditorData } from '../core/types';
import { Knob } from '@abdsynths/shared/components';

export function getThemeColor(tokenName: string, fallback: string): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return fallback;
  }
  const val = getComputedStyle(document.documentElement)
    .getPropertyValue(tokenName)
    .trim();
  return val || fallback;
}
import { onAppLocaleChange } from '../core/i18n';
import type { InspectorContext } from './zoneInspector/types.ts';
import { renderDrawer } from './zoneInspector/drawerRenderOps.ts';
import { applyNoteHighlights } from './zoneInspector/drawerStateOps.ts';
import { renderTable } from './zoneInspector/tableRenderOps.ts';
import {
  bindDrawerAutoDetectEvents,
  bindDrawerChromeEvents,
  bindDrawerKeysEvents,
  bindDrawerKnobsEvents,
  bindDrawerReuseEvents,
} from './zoneInspector/drawerChromeEventOps.ts';
import {
  bindDrawerArticulationEvents,
  bindDrawerCommonPlaybackEvents,
  bindDrawerExtendedRegionEvents,
  bindDrawerSampleHighEvents,
  bindDrawerSampleLowEvents,
} from './zoneInspector/drawerSampleEventOps.ts';
import { bindDrawerMetadataEvents, bindTableEvents } from './zoneInspector/tableEventOps.ts';
import { clearPlayingRow, getEffectiveBpm, setPlayingRow, startAuditionStateMonitor, stopSequencePlayback, toggleSequencePlayback, updatePlayButtonStates } from './zoneInspector/playbackOps.ts';
import { destroyZoneKnobs, getExtendedContext, initDrawer, setZone } from './zoneInspector/zoneStateOps.ts';
import { handleRowPlayClick, highlightNote, releaseNote } from './zoneInspector/notePreviewOps.ts';
import { closeDrawer, closeToolsMenu, openDrawer, openLoopEditorDrawer, openModelCommonDrawer, openModelMetadataDrawer, renderExtendedRegionTableRows, renderGmDrumOptions, renderZoneTableRows, setSpectralVisible, toggleDrawer } from './zoneInspector/viewOps.ts';

export interface ZoneInspectorHandlers {
  onSelectZone?: (zoneId: string) => void;
  onUpdateZone: (zoneId: string, changes: Partial<Zone>) => void;
  onSplitZone: (zoneId: string) => void;
  onDeleteZone: (zoneId: string) => void;
  onAuditionSample: (samplePath: string) => void;
  onLoadSampleFile?: (zoneId: string, slot: 'low' | 'high', file: File) => void;
  onDropMultipleFiles?: (files: FileList) => void;
  onToggleSpectral?: () => void;
  getLoadedSamples?: () => string[];
  getExtendedRegions?: () => ExtendedRegion[];
  onUpdateExtendedRegion?: (regionId: string, changes: Partial<ExtendedRegion>) => void;
  onAddExtendedRegion?: (partial?: Partial<ExtendedRegion>, anchorRegionId?: string) => void;
  onRemoveExtendedRegion?: (regionId: string) => void;
  onLoadSampleFileIntoRegion?: (regionId: string, file: File) => void;
  getCommonPlayback?: () => CommonPlaybackDefaults;
  onUpdateCommonPlayback?: (
    changes: Partial<CommonPlaybackDefaults>,
    resetAllOverrides?: boolean
  ) => void;
  getArticulation?: () => SynthArticulationConfig;
  onUpdateArticulation?: (changes: Partial<SynthArticulationConfig>) => void;
  getDetectedCategory?: () => string | undefined;
  getZoneClassification?: (zoneId: string) => AcousticClassificationResult | undefined;
  onAutoDetectZone?: (zoneId: string) => void;
  getMasterWaveConfig?: () => MasterWaveConfig;
  getZoneSampleFormatInfo?: (zoneId?: string, regionId?: string) => {
    sampleName: string;
    sampleRate: number;
    bitsPerSample: number;
    numChannels: number;
    durationSec: number;
    totalFrames?: number;
    byteSize?: number;
    loopStart: number;
    loopEnd: number;
  } | null;
  onPromoteZoneToMasterWave?: (zoneId: string, config: Partial<MasterWaveConfig>) => void;
  onPromoteAllZonesToMasterWave?: (config: Partial<MasterWaveConfig>) => void;
  getModelProvenance?: () => ModelProvenance | null;
  getAssetStoreDiagnostics?: () => AssetStoreDiagnostics;
  onReprocessFromPurestSource?: () => void;
  onExportTimeCapsule?: () => void;
  onOpenLoopEditor?: () => void;
  getLoopEditorData?: (zoneId?: string, regionId?: string) => ZoneLoopEditorData | null;
  onAuditionRow?: (opts: {
    zoneId?: string;
    regionId?: string;
  }) => void;
  /** Fired when a table row starts (ids) or stops (null) auditioning — drives keyboard & zone map highlight */
  onRowAuditionChange?: (row: { zoneId?: string; regionId?: string } | null) => void;
  onAuditionLoop?: (opts: {
    zoneId?: string;
    regionId?: string;
    loopStartFrame?: number;
    loopEndFrame?: number;
    loopEnabled?: boolean;
  }) => void;
  onStopAudition?: () => void;
  onUpdateLiveLoopPoints?: (
    loopStartFrame: number,
    loopEndFrame: number,
    sampleRate: number,
    loopEnabled: boolean
  ) => void;
  isAuditionPlaying?: () => boolean;
  getKeyMappingMode?: () => KeyMappingMode;
  onUpdateKeyMappingMode?: (mode: KeyMappingMode) => void;
  getExtendedMetadata?: () => ExtendedModelMetadata | undefined;
  onUpdateExtendedMetadata?: (metadata: ExtendedModelMetadata) => void;
  onOpenModelConfig?: (tab?: 'general' | 'articulation' | 'metadata' | 'artwork') => void;
  onOpenAutoSlicer?: () => void;
  onOpenAudioRecorder?: () => void;
  /** Fase 35.6: Abre el Asistente Guiado de Músico directamente en el Paso 2 con la muestra del slot */
  onOpenWizardFromZoneSample?: (opts: {
    zoneId?: string;
    slot?: 'low' | 'high';
    regionId?: string;
  }) => void;
  /** Fase 35.6: Ejecuta AutoLoop (zc-snap) en lote sobre todas las zonas/regiones con muestra */
  onAutoLoopAllZones?: () => void;
  /** Tempo / BPM (30..300, por defecto 120) para audición de Resinator v2, REX slices y secuencias cromáticas */
  getAuditionBpm?: () => number;
  onUpdateAuditionBpm?: (bpm: number) => void;
}



export class ZoneInspector {
  private container: HTMLElement;
  private drawerMount: HTMLElement;
  private drawerElement: HTMLElement | null = null;
  private isDrawerOpen: boolean = false;
  private isSpectralVisible: boolean = false;
  private handlers: ZoneInspectorHandlers;
  private currentZone: Zone | null = null;
  private allZones: Zone[] = [];
  private zoneIndex: number = 0;
  private totalZones: number = 1;
  private workingMode: WorkingMode = 'classic';
  private selectedRegionId: string | null = null;
  /** Live keyboard notes → table rows/cells they trigger (classic zone+layer or extended regions) */
  private activeNoteHits = new Map<number, { zoneId?: string; layer?: 'low' | 'high'; regionIds: string[]; startedAt: number }>();
  private noteReleaseTimers = new Map<number, number>();
  private lastExtendedRegionCount: number = 0;
  /** Top-level scope in Extended Drawer: 'region' (Sample-Specific & Overrides) vs 'model' (Model Common & Global) */
  private detuneKnob: Knob | null = null;
  private volumeKnob: Knob | null = null;
  private panKnob: Knob | null = null;
  private isDraggingKnob: boolean = false;
  /** Active row ID currently being auditioned in the table (classic zone ID or extended region ID) */
  private playingRowId: string | null = null;
  private playingRowStartedAt: number = 0;
  private auditionCheckTimer: number | null = null;
  private auditionBpm: number = 120;
  private isPlayingSequence: boolean = false;
  private seqPlayTimer: number | null = null;
  /** Fase 18 / GM Drum Map: 'chromatic' (default) vs 'drum' (GM Drum Map piece naming & collision detection) */
  private keyMappingMode: KeyMappingMode = 'chromatic';

  private inspectorCtx(): InspectorContext {
    const host = this;
    return {
      state: {
      get drawerElement() { return host.drawerElement; },
      set drawerElement(v) { host.drawerElement = v; },
      get selectedRegionId() { return host.selectedRegionId; },
      set selectedRegionId(v) { host.selectedRegionId = v; },
      get auditionBpm() { return host.auditionBpm; },
      set auditionBpm(v) { host.auditionBpm = v; },
      get currentZone() { return host.currentZone; },
      set currentZone(v) { host.currentZone = v; },
      get allZones() { return host.allZones; },
      set allZones(v) { host.allZones = v; },
      get zoneIndex() { return host.zoneIndex; },
      set zoneIndex(v) { host.zoneIndex = v; },
      get workingMode() { return host.workingMode; },
      set workingMode(v) { host.workingMode = v; },
      get handlers() { return host.handlers; },
      set handlers(v) { host.handlers = v; },
      get keyMappingMode() { return host.keyMappingMode; },
      set keyMappingMode(v) { host.keyMappingMode = v; },
      get container() { return host.container; },
      set container(v) { host.container = v; },
      get isDraggingKnob() { return host.isDraggingKnob; },
      set isDraggingKnob(v) { host.isDraggingKnob = v; },
      get detuneKnob() { return host.detuneKnob; },
      set detuneKnob(v) { host.detuneKnob = v; },
      get volumeKnob() { return host.volumeKnob; },
      set volumeKnob(v) { host.volumeKnob = v; },
      get panKnob() { return host.panKnob; },
      set panKnob(v) { host.panKnob = v; },
      get activeNoteHits() { return host.activeNoteHits; },
      set activeNoteHits(v) { host.activeNoteHits = v; },
      get isPlayingSequence() { return host.isPlayingSequence; },
      set isPlayingSequence(v) { host.isPlayingSequence = v; },
      get isSpectralVisible() { return host.isSpectralVisible; },
      set isSpectralVisible(v) { host.isSpectralVisible = v; },
      get totalZones() { return host.totalZones; },
      set totalZones(v) { host.totalZones = v; },
      get auditionCheckTimer() { return host.auditionCheckTimer; },
      set auditionCheckTimer(v) { host.auditionCheckTimer = v; },
      get playingRowId() { return host.playingRowId; },
      set playingRowId(v) { host.playingRowId = v; },
      get playingRowStartedAt() { return host.playingRowStartedAt; },
      set playingRowStartedAt(v) { host.playingRowStartedAt = v; },
      get seqPlayTimer() { return host.seqPlayTimer; },
      set seqPlayTimer(v) { host.seqPlayTimer = v; },
      get drawerMount() { return host.drawerMount; },
      set drawerMount(v) { host.drawerMount = v; },
      get isDrawerOpen() { return host.isDrawerOpen; },
      set isDrawerOpen(v) { host.isDrawerOpen = v; },
      get lastExtendedRegionCount() { return host.lastExtendedRegionCount; },
      set lastExtendedRegionCount(v) { host.lastExtendedRegionCount = v; },
      get noteReleaseTimers() { return host.noteReleaseTimers; },
      set noteReleaseTimers(v) { host.noteReleaseTimers = v; },
      },
      destroyZoneKnobs: () => host.destroyZoneKnobs(),
      getExtendedContext: () => host.getExtendedContext(),
      renderGmDrumOptions: (currentKey, currentId) => host.renderGmDrumOptions(currentKey, currentId),
      bindDrawerEvents: () => host.bindDrawerEvents(),
      getEffectiveBpm: () => host.getEffectiveBpm(),
      bindTableEvents: () => host.bindTableEvents(),
      renderZoneTableRows: (zones, activeId) => host.renderZoneTableRows(zones, activeId),
      renderExtendedRegionTableRows: (regions, activeRegionId) => host.renderExtendedRegionTableRows(regions, activeRegionId),
      closeDrawer: () => host.closeDrawer(),
      renderDrawer: () => host.renderDrawer(),
      handleRowPlayClick: (zoneId, regionId) => host.handleRowPlayClick(zoneId, regionId),
      bindDrawerMetadataEvents: () => host.bindDrawerMetadataEvents(),
      applyNoteHighlights: (scrollIntoView) => host.applyNoteHighlights(scrollIntoView),
      closeToolsMenu: () => host.closeToolsMenu(),
      openDrawer: () => host.openDrawer(),
      openLoopEditorDrawer: (regionId) => host.openLoopEditorDrawer(regionId),
      openModelCommonDrawer: () => host.openModelCommonDrawer(),
      renderTable: () => host.renderTable(),
      setKeyMappingMode: (mode) => host.setKeyMappingMode(mode),
      toggleDrawer: () => host.toggleDrawer(),
      toggleSequencePlayback: () => host.toggleSequencePlayback(),
      setPlayingRow: (rowKey, ids) => host.setPlayingRow(rowKey, ids),
      startAuditionStateMonitor: () => host.startAuditionStateMonitor(),
      updatePlayButtonStates: () => host.updatePlayButtonStates(),
    };
  }

  constructor(
    container: HTMLElement,
    handlers: ZoneInspectorHandlers,
    drawerMount?: HTMLElement
  ) {
    this.container = container;
    this.handlers = handlers;
    if (this.handlers.getKeyMappingMode) {
      this.keyMappingMode = this.handlers.getKeyMappingMode();
    }
    this.drawerMount =
      drawerMount ||
      document.querySelector<HTMLElement>('#drawers-container') ||
      document.body;
    this.initDrawer();
    onAppLocaleChange(() => {
      this.renderTable();
      if (this.isDrawerOpen) {
        this.renderDrawer();
      }
    });
  }

  private initDrawer(): void {
    initDrawer(this.inspectorCtx());
  }

  private closeToolsMenu(): void {
    closeToolsMenu(this.inspectorCtx());
  }

  public getSelectedRegionId(): string | null {
    return this.selectedRegionId;
  }

  public setSelectedRegionId(regionId: string | null): void {
    this.selectedRegionId = regionId;
  }

  public openDrawer(): void {
    openDrawer(this.inspectorCtx());
  }

  public openLoopEditorDrawer(regionId?: string): void {
    openLoopEditorDrawer(this.inspectorCtx(), regionId);
  }

  public openModelCommonDrawer(): void {
    openModelCommonDrawer(this.inspectorCtx());
  }

  public openModelMetadataDrawer(): void {
    openModelMetadataDrawer(this.inspectorCtx());
  }

  public closeDrawer(): void {
    closeDrawer(this.inspectorCtx());
  }

  public toggleDrawer(): void {
    toggleDrawer(this.inspectorCtx());
  }

  public setSpectralVisible(visible: boolean): void {
    setSpectralVisible(this.inspectorCtx(), visible);
  }

  private getExtendedContext(): {
    regions: ExtendedRegion[];
    activeRegion: ExtendedRegion | null;
    activeIndex: number;
  } {
    return getExtendedContext(this.inspectorCtx());
  }


  public getKeyMappingMode(): KeyMappingMode {
    return this.keyMappingMode;
  }

  public setKeyMappingMode(mode: KeyMappingMode): void {
    if (this.keyMappingMode === mode) return;
    this.keyMappingMode = mode;
    this.handlers.onUpdateKeyMappingMode?.(mode);
    this.renderTable();
    if (this.isDrawerOpen) this.renderDrawer();
  }

  public setZone(zone: Zone | null, index: number, total: number, allZones?: Zone[], workingMode?: WorkingMode, keyMappingMode?: KeyMappingMode): void {
    setZone(this.inspectorCtx(), zone, index, total, allZones, workingMode, keyMappingMode);
  }

  private destroyZoneKnobs(): void {
    destroyZoneKnobs(this.inspectorCtx());
  }


  private renderZoneTableRows(zones: Zone[], activeId: string): string {
    return renderZoneTableRows(this.inspectorCtx(), zones, activeId);
  }

  private renderExtendedRegionTableRows(regions: ExtendedRegion[], activeRegionId: string): string {
    return renderExtendedRegionTableRows(this.inspectorCtx(), regions, activeRegionId);
  }

  private renderTable(): void {
    renderTable(this.inspectorCtx());
  }

  private renderGmDrumOptions(currentKey: number, currentId: string): string {
    return renderGmDrumOptions(this.inspectorCtx(), currentKey, currentId);
  }

  private renderDrawer(): void {
    renderDrawer(this.inspectorCtx());
  }

  private bindTableEvents(): void {
    bindTableEvents(this.inspectorCtx());
  }

  /**
   * Highlights the table row(s) a keyboard note triggers.
   * Classic: the zone row plus its Low Vel / High Vel cell for the played velocity.
   * Extended: every region row whose key AND velocity ranges contain the note.
   */
  public highlightNote(note: number, hit: { zoneId?: string; layer?: 'low' | 'high'; regionIds: string[] }): void {
    highlightNote(this.inspectorCtx(), note, hit);
  }

  /** Clears a note highlight (kept visible ≥ 250 ms so quick taps are still noticeable). */
  public releaseNote(note: number): void {
    releaseNote(this.inspectorCtx(), note);
  }

  private applyNoteHighlights(scrollIntoView: boolean): void {
    applyNoteHighlights(this.inspectorCtx(), scrollIntoView);
  }

  private handleRowPlayClick(zoneId: string | null, regionId: string | null): void {
    handleRowPlayClick(this.inspectorCtx(), zoneId, regionId);
  }

  private updatePlayButtonStates(): void {
    updatePlayButtonStates(this.inspectorCtx());
  }

  /** Called when another audition source (e.g. the keyboard) takes over playback. */
  public clearPlayingRow(): void {
    clearPlayingRow(this.inspectorCtx());
  }

  private getEffectiveBpm(): number {
    return getEffectiveBpm(this.inspectorCtx());
  }

  private toggleSequencePlayback(): void {
    toggleSequencePlayback(this.inspectorCtx());
  }

  public stopSequencePlayback(stopAudio = true): void {
    stopSequencePlayback(this.inspectorCtx(), stopAudio);
  }

  /**
   * Single place that changes the auditioning row, so the keyboard and the zone map
   * highlights always follow start / manual stop / natural end of playback.
   */
  private setPlayingRow(rowKey: string | null, ids?: { zoneId?: string; regionId?: string }): void {
    setPlayingRow(this.inspectorCtx(), rowKey, ids);
  }

  private startAuditionStateMonitor(): void {
    startAuditionStateMonitor(this.inspectorCtx());
  }

  private bindDrawerEvents(): void {
    if (!this.drawerElement || !this.currentZone) return;
    const z = this.currentZone;
    const isExtended = this.workingMode === 'extended';
    const activeReg = isExtended ? this.getExtendedContext().activeRegion : null;

    this.bindDrawerChromeEvents(z, isExtended, activeReg);
    this.bindDrawerAutoDetectEvents(z);
    this.bindDrawerKeysEvents(z, isExtended, activeReg);
    this.bindDrawerKnobsEvents(z, isExtended, activeReg);
    this.bindDrawerReuseEvents(z, isExtended, activeReg);
    this.bindDrawerSampleLowEvents(z, isExtended, activeReg);
    this.bindDrawerSampleHighEvents(z);
    this.bindDrawerExtendedRegionEvents(activeReg);
    this.bindDrawerCommonPlaybackEvents();
    this.bindDrawerArticulationEvents(z);
  }

  private bindDrawerChromeEvents(z: Zone, isExtended: boolean, activeReg: ExtendedRegion | null): void {
    bindDrawerChromeEvents(this.inspectorCtx(), z, isExtended, activeReg);
  }

  private bindDrawerAutoDetectEvents(z: Zone): void {
    bindDrawerAutoDetectEvents(this.inspectorCtx(), z);
  }

  private bindDrawerKeysEvents(z: Zone, isExtended: boolean, activeReg: ExtendedRegion | null): void {
    bindDrawerKeysEvents(this.inspectorCtx(), z, isExtended, activeReg);
  }

  private bindDrawerKnobsEvents(z: Zone, isExtended: boolean, activeReg: ExtendedRegion | null): void {
    bindDrawerKnobsEvents(this.inspectorCtx(), z, isExtended, activeReg);
  }

  private bindDrawerReuseEvents(z: Zone, isExtended: boolean, activeReg: ExtendedRegion | null): void {
    bindDrawerReuseEvents(this.inspectorCtx(), z, isExtended, activeReg);
  }

  private bindDrawerSampleLowEvents(z: Zone, isExtended: boolean, activeReg: ExtendedRegion | null): void {
    bindDrawerSampleLowEvents(this.inspectorCtx(), z, isExtended, activeReg);
  }

  private bindDrawerSampleHighEvents(z: Zone): void {
    bindDrawerSampleHighEvents(this.inspectorCtx(), z);
  }

  private bindDrawerExtendedRegionEvents(activeReg: ExtendedRegion | null): void {
    bindDrawerExtendedRegionEvents(this.inspectorCtx(), activeReg);
  }

  private bindDrawerCommonPlaybackEvents(): void {
    bindDrawerCommonPlaybackEvents(this.inspectorCtx());
  }

  private bindDrawerArticulationEvents(z: Zone): void {
    bindDrawerArticulationEvents(this.inspectorCtx(), z);
  }

  private bindDrawerMetadataEvents(): void {
    bindDrawerMetadataEvents(this.inspectorCtx());
  }


}
