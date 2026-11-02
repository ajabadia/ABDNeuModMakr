// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Zone Table & Sliding Zone Metadata Drawer
// Implements the canonical Hartmann MODELmaker v1.2 ZoneTableModel
// (Zone, Low Key, Root Key, High Key, Low Vel, High Vel, Detune,
// Volume, Pan) with full vertical height (up to 128 zones) and a
// right-side sliding drawer for Zone Metadata editing.
// ─────────────────────────────────────────────────────────

import type {
  AcousticClassificationResult,
  AssetStoreDiagnostics,
  CommonPlaybackDefaults,
  CrossfadeCurve,
  ExtendedModelMetadata,
  ExtendedRegion,
  LoopMode,
  MasterChannelLayout,
  MasterPromotionMethod,
  MasterWaveConfig,
  ModelProvenance,
  SynthArticulationConfig,
  TriggerMode,
  WorkingMode,
  KeyMappingMode,
  Zone,
  ZoneLoopEditorData,
} from '../core/types';
import {
  analyzeClassicZoneOverlaps,
  analyzeExtendedIntersections,
  createDefaultCommonPlayback,
} from '../core/extendedAdapter';
import {
  formatGmDrumLabel,
  analyzeDrumCollisions,
} from '../core/gmDrumMap';
import { DEFAULT_MASTER_WAVE_CONFIG } from '../core/dsp/MasterWaveEnhancer';
import { computeZoomedWaveformEnvelope } from '../core/dsp/LoopEditorTools';
import { Knob } from '@abdsynths/shared/components';

function getThemeColor(tokenName: string, fallback: string): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return fallback;
  }
  const val = getComputedStyle(document.documentElement)
    .getPropertyValue(tokenName)
    .trim();
  return val || fallback;
}
import {
  midiToNoteName,
  midiNoteToString,
  detuneToString,
  volumeToLongString,
  panToString,
} from './ZoneRibbon';
import { ICONS } from './icons';
import { confirmDialog } from './notify';
import { escAttr, escHtml } from './escape';
import { formatBytes } from '../core/pathUtils.ts';
import {
  basenameOf,
  formatRegionModeBadge,
  renderExtendedRegionTableRows as tplRenderExtendedRegionTableRows,
  renderGmDrumOptions as tplRenderGmDrumOptions,
  renderZoneTableRows as tplRenderZoneTableRows,
} from './zoneInspector/zoneTemplates.ts';

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
  /** Fase 18 / GM Drum Map: 'chromatic' (default) vs 'drum' (GM Drum Map piece naming & collision detection) */
  private keyMappingMode: KeyMappingMode = 'chromatic';

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
  }

  private initDrawer(): void {
    this.drawerElement = document.createElement('div');
    this.drawerElement.className = 'zone-metadata-drawer-panel is-closed';
    this.drawerMount.appendChild(this.drawerElement);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isDrawerOpen) {
        this.closeDrawer();
      }
    });
  }

  public getSelectedRegionId(): string | null {
    return this.selectedRegionId;
  }

  public setSelectedRegionId(regionId: string | null): void {
    this.selectedRegionId = regionId;
  }

  public openDrawer(): void {
    this.isDrawerOpen = true;
    this.drawerElement?.classList.remove('is-closed');
    this.renderDrawer();
  }

  public openLoopEditorDrawer(regionId?: string): void {
    if (regionId) {
      this.selectedRegionId = regionId;
    }
    this.handlers.onOpenLoopEditor?.();
  }

  public openModelCommonDrawer(): void {
    if (this.handlers.onOpenModelConfig) {
      this.handlers.onOpenModelConfig('general');
    } else {
      this.openDrawer();
    }
  }

  public openModelMetadataDrawer(): void {
    if (this.handlers.onOpenModelConfig) {
      this.handlers.onOpenModelConfig('metadata');
    } else {
      this.openDrawer();
    }
  }

  public closeDrawer(): void {
    this.isDrawerOpen = false;
    this.drawerElement?.classList.add('is-closed');
  }

  public toggleDrawer(): void {
    if (this.isDrawerOpen) {
      this.closeDrawer();
    } else {
      this.openDrawer();
    }
  }

  public setSpectralVisible(visible: boolean): void {
    this.isSpectralVisible = visible;
    const btn = this.container.querySelector('#btn-toggle-spectral');
    if (btn) {
      btn.classList.toggle('is-active', visible);
    }
  }

  private getExtendedContext(): {
    regions: ExtendedRegion[];
    activeRegion: ExtendedRegion | null;
    activeIndex: number;
  } {
    const regions = this.handlers.getExtendedRegions?.() ?? [];
    if (regions.length === 0) {
      return { regions: [], activeRegion: null, activeIndex: 0 };
    }
    let idx = this.selectedRegionId
      ? regions.findIndex((r) => r.id === this.selectedRegionId)
      : -1;
    if (idx < 0 && this.currentZone) {
      const z = this.currentZone;
      idx = regions.findIndex(
        (r) =>
          r.sampleName === z.sampleLow &&
          r.lowKey <= z.lowKey &&
          r.highKey >= z.highKey
      );
      if (idx < 0) {
        idx = regions.findIndex(
          (r) => r.lowKey <= z.highKey && r.highKey >= z.lowKey
        );
      }
      if (idx < 0 && z.sampleLow) {
        idx = regions.findIndex((r) => r.sampleName === z.sampleLow);
      }
    }
    if (idx < 0) {
      idx = Math.max(0, Math.min(regions.length - 1, this.zoneIndex));
    }
    const activeRegion = regions[idx] ?? regions[0];
    this.selectedRegionId = activeRegion.id;
    return { regions, activeRegion, activeIndex: idx };
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

  public setZone(
    zone: Zone | null,
    index: number,
    total: number,
    allZones?: Zone[],
    workingMode?: WorkingMode,
    keyMappingMode?: KeyMappingMode
  ): void {
    const modeChanged = workingMode !== undefined && workingMode !== this.workingMode;
    const keyMappingChanged =
      keyMappingMode !== undefined && keyMappingMode !== this.keyMappingMode;
    if (workingMode !== undefined) {
      this.workingMode = workingMode;
    }
    if (keyMappingMode !== undefined) {
      this.keyMappingMode = keyMappingMode;
    } else if (this.handlers.getKeyMappingMode) {
      this.keyMappingMode = this.handlers.getKeyMappingMode();
    }
    const sameZone = this.currentZone && zone && this.currentZone.id === zone.id;
    const sameCount = allZones ? allZones.length === this.allZones.length : true;
    const extRegions =
      this.workingMode === 'extended'
        ? (this.handlers.getExtendedRegions?.() ?? [])
        : [];
    const sameRegionCount = extRegions.length === this.lastExtendedRegionCount;
    this.lastExtendedRegionCount = extRegions.length;

    if (!sameZone && zone && this.workingMode === 'extended' && extRegions.length > 0) {
      const currentReg = extRegions.find((r) => r.id === this.selectedRegionId);
      const overlapsZone =
        currentReg &&
        currentReg.lowKey <= zone.highKey &&
        currentReg.highKey >= zone.lowKey;
      if (!overlapsZone) {
        const matchReg =
          extRegions.find(
            (r) =>
              r.sampleName === zone.sampleLow &&
              r.lowKey <= zone.highKey &&
              r.highKey >= zone.lowKey
          ) ??
          extRegions.find(
            (r) => r.lowKey <= zone.highKey && r.highKey >= zone.lowKey
          );
        if (matchReg) {
          this.selectedRegionId = matchReg.id;
        }
      }
    }

    this.currentZone = zone ? { ...zone } : null;
    this.zoneIndex = index;
    this.totalZones = total;
    this.allZones = allZones ? allZones.map((z) => ({ ...z })) : zone ? [{ ...zone }] : [];

    if (this.handlers.isAuditionPlaying && !this.handlers.isAuditionPlaying()) {
      this.setPlayingRow(null);
    }

    const activeEl = document.activeElement;
    if (
      sameZone &&
      sameCount &&
      sameRegionCount &&
      !modeChanged &&
      !keyMappingChanged &&
      ((activeEl &&
        this.drawerElement &&
        this.drawerElement.contains(activeEl)) ||
        this.isDraggingKnob)
    ) {
      this.syncActiveDom();
      return;
    }
    this.renderTable();
    this.renderDrawer();
  }

  private destroyZoneKnobs(): void {
    if (this.auditionCheckTimer !== null) {
      clearInterval(this.auditionCheckTimer);
      this.auditionCheckTimer = null;
    }
    this.detuneKnob?.destroy();
    this.detuneKnob = null;
    this.volumeKnob?.destroy();
    this.volumeKnob = null;
    this.panKnob?.destroy();
    this.panKnob = null;
  }

  private syncActiveDom(): void {
    if (!this.currentZone) return;
    if (this.workingMode === 'extended') {
      const { activeRegion } = this.getExtendedContext();
      if (activeRegion) {
        if (this.drawerElement) {
          const dispLow = this.drawerElement.querySelector('#disp-low-note');
          const dispRoot = this.drawerElement.querySelector('#disp-root-note');
          const dispHigh = this.drawerElement.querySelector('#disp-high-note');
          const dispVelSpan = this.drawerElement.querySelector('#disp-vel-span');
          if (dispLow) dispLow.textContent = midiToNoteName(activeRegion.lowKey);
          if (dispRoot) dispRoot.textContent = midiToNoteName(activeRegion.rootKey);
          if (dispHigh) dispHigh.textContent = midiToNoteName(activeRegion.highKey);
          if (dispVelSpan) {
            const spanSteps = Math.max(1, activeRegion.highVel - activeRegion.lowVel + 1);
            dispVelSpan.textContent = `Vel ${activeRegion.lowVel}..${activeRegion.highVel} (${spanSteps})`;
          }

          const valDetune = this.drawerElement.querySelector('#val-detune');
          const valVolume = this.drawerElement.querySelector('#val-volume');
          const valPan = this.drawerElement.querySelector('#val-pan');
          if (valDetune) valDetune.textContent = detuneToString(activeRegion.detune);
          if (valVolume) valVolume.textContent = volumeToLongString(activeRegion.volume);
          if (valPan) valPan.textContent = panToString(activeRegion.pan);

          if (!this.isDraggingKnob) {
            this.detuneKnob?.setValue((Math.round(activeRegion.detune) + 99) / 198);
            this.volumeKnob?.setValue((Math.round(activeRegion.volume) + 32) / 44);
            this.panKnob?.setValue((Math.round(activeRegion.pan) + 50) / 100);
          }
        }

        const activeRow = this.container.querySelector(
          `tr.zone-table-row[data-region-id="${activeRegion.id}"]`
        );
        if (activeRow) {
          const cells = activeRow.querySelectorAll('td');
          if (cells.length >= 11) {
            const sampleBase = basenameOf(activeRegion.sampleName);
            cells[1].textContent = midiNoteToString(activeRegion.lowKey);
            cells[2].className =
              'col-key is-root' + (this.keyMappingMode === 'drum' ? ' is-drum-piece' : '');
            cells[2].innerHTML =
              this.keyMappingMode === 'drum'
                ? `<span class="drum-piece-text">${escHtml(formatGmDrumLabel(activeRegion.rootKey))}</span>`
                : midiNoteToString(activeRegion.rootKey);
            cells[3].textContent = midiNoteToString(activeRegion.highKey);
            cells[4].textContent = '';
            cells[4].innerHTML = `<span class="cell-vel-tag">${activeRegion.lowVel}</span>`;
            cells[5].innerHTML = `<span class="cell-vel-tag">${activeRegion.highVel}</span>`;
            cells[6].innerHTML = sampleBase
              ? `<span class="cell-sample-name">${escHtml(sampleBase)}</span>`
              : `<span class="cell-empty-dash">—</span>`;
            cells[7].innerHTML = `<span class="cell-vel-tag">${formatRegionModeBadge(activeRegion)}</span>`;
            cells[8].textContent = detuneToString(activeRegion.detune);
            cells[9].textContent = volumeToLongString(activeRegion.volume);
            cells[10].textContent = panToString(activeRegion.pan);
          }
        }
        return;
      }
    }

    const z = this.currentZone;
    if (this.drawerElement) {
      const dispLow = this.drawerElement.querySelector('#disp-low-note');
      const dispRoot = this.drawerElement.querySelector('#disp-root-note');
      const dispHigh = this.drawerElement.querySelector('#disp-high-note');
      if (dispLow) dispLow.textContent = midiToNoteName(z.lowKey);
      if (dispRoot) dispRoot.textContent = midiToNoteName(z.rootKey);
      if (dispHigh) dispHigh.textContent = midiToNoteName(z.highKey);

      const valDetune = this.drawerElement.querySelector('#val-detune');
      const valVolume = this.drawerElement.querySelector('#val-volume');
      const valPan = this.drawerElement.querySelector('#val-pan');
      if (valDetune) valDetune.textContent = detuneToString(z.detune);
      if (valVolume) valVolume.textContent = volumeToLongString(z.volume);
      if (valPan) valPan.textContent = panToString(z.pan);

      if (!this.isDraggingKnob) {
        this.detuneKnob?.setValue((Math.round(z.detune) + 99) / 198);
        this.volumeKnob?.setValue((Math.round(z.volume) + 32) / 44);
        this.panKnob?.setValue((Math.round(z.pan) + 50) / 100);
      }
    }

    // Update the active row cells in the canonical Zone Table
    const activeRow = this.container.querySelector(
      `tr.zone-table-row[data-zone-id="${z.id}"]`
    );
    if (activeRow) {
      const cells = activeRow.querySelectorAll('td');
      if (cells.length >= 9) {
        const hasHigh = Boolean(z.sampleHigh);
        const rowSplit = Math.max(2, Math.min(127, z.velSplit ?? 64));
        const lowVelName = basenameOf(z.sampleLow);
        const highVelName = basenameOf(z.sampleHigh);
        cells[1].textContent = midiNoteToString(z.lowKey);
        cells[2].className =
          'col-key is-root' + (this.keyMappingMode === 'drum' ? ' is-drum-piece' : '');
        cells[2].innerHTML =
          this.keyMappingMode === 'drum'
            ? `<span class="drum-piece-text">${escHtml(formatGmDrumLabel(z.rootKey))}</span>`
            : midiNoteToString(z.rootKey);
        cells[3].textContent = midiNoteToString(z.highKey);
        cells[4].innerHTML = lowVelName
          ? `<span class="cell-vel-tag">1–${hasHigh ? rowSplit - 1 : 127}</span> <span class="cell-sample-name">${escHtml(lowVelName)}</span>`
          : `<span class="cell-empty-dash">—</span>`;
        cells[5].innerHTML = highVelName
          ? `<span class="cell-vel-tag">${rowSplit}–127</span> <span class="cell-sample-name">${escHtml(highVelName)}</span>`
          : `<span class="cell-empty-dash">—</span>`;
        cells[6].textContent = detuneToString(z.detune);
        cells[7].textContent = volumeToLongString(z.volume);
        cells[8].textContent = panToString(z.pan);
      }
    }
  }

  private renderZoneTableRows(zones: Zone[], activeId: string): string {
    return tplRenderZoneTableRows(zones, activeId, {
      keyMappingMode: this.keyMappingMode,
      playingRowId: this.playingRowId,
    });
  }

  private renderExtendedRegionTableRows(
    regions: ExtendedRegion[],
    activeRegionId: string
  ): string {
    return tplRenderExtendedRegionTableRows(regions, activeRegionId, this.allZones, this.currentZone, {
      keyMappingMode: this.keyMappingMode,
      playingRowId: this.playingRowId,
    });
  }

  private renderTable(): void {
    if (!this.currentZone) {
      this.container.innerHTML = `
        <div class="zone-inspector-empty">
          <div class="empty-icon">${ICONS.layers}</div>
          <div class="empty-text">No zone selected</div>
        </div>
      `;
      return;
    }

    const z = this.currentZone;
    const isExtended = this.workingMode === 'extended';

    if (isExtended) {
      const { regions, activeRegion, activeIndex } = this.getExtendedContext();
      if (regions.length > 0 && activeRegion) {
        const canDeleteReg = regions.length > 1;
        const sampleTitle = basenameOf(activeRegion.sampleName);
        const extReport = analyzeExtendedIntersections(regions);
        const intersectCount = extReport.totalIntersectingPairs;
        const intersectBadgeHtml =
          intersectCount > 0
            ? `<span class="panel-badge is-overlap-badge" title="${intersectCount} Key &amp; Velocity intersection(s) detected across regions">${ICONS.alert} ${intersectCount} INTERSECTION${intersectCount > 1 ? 'S' : ''}</span>`
            : '';

        const isDrumMode = this.keyMappingMode === 'drum';
        const drumCollisionReport = isDrumMode
          ? analyzeDrumCollisions(
              regions.map((r) => ({
                id: r.id,
                lowKey: r.lowKey,
                highKey: r.highKey,
                rootKey: r.rootKey,
                lowVel: r.lowVel,
                highVel: r.highVel,
              }))
            )
          : null;
        const drumCollisionBadgeHtml =
          drumCollisionReport && drumCollisionReport.totalCollisions > 0
            ? `<span class="panel-badge is-collision-badge" title="${drumCollisionReport.totalCollisions} GM Drum collision(s) detected across regions">${ICONS.alert} ${drumCollisionReport.totalCollisions} DRUM COLLISION${drumCollisionReport.totalCollisions > 1 ? 'S' : ''}</span>`
            : '';

        this.container.innerHTML = `
          <div class="zone-inspector-panel">
            <!-- Extended Mode 2D Multi-Region Sampler Table (1 Row per Sampler Region) -->
            <div class="zone-table-card">
              <div class="zone-table-toolbar">
                <div class="key-mapping-mode-group">
                  <span class="toolbar-mode-label">KEY MAP:</span>
                  <button type="button" class="btn btn-xs ${!isDrumMode ? 'btn-accent is-active' : 'btn-outline'}" id="btn-map-mode-chromatic" title="Standard Chromatic Keyboard Mapping (Piano / Synth pitch scale C-2..G8)">
                    ${ICONS.piano} Chromatic
                  </button>
                  <button type="button" class="btn btn-xs ${isDrumMode ? 'btn-accent is-active' : 'btn-outline'}" id="btn-map-mode-drum" title="General MIDI Drum Map (Percussion piece names, auto-placement &amp; collision detection)">
                    ${ICONS.drum} GM Drum Map
                  </button>
                </div>
                <div class="panel-actions">
                  <button type="button" class="btn btn-xs btn-outline" id="btn-open-loop-drawer" title="Open Interactive Waveform Loop Editor &amp; Zero-Crossing Seam Magnifier for Region #${activeIndex + 1}">
                    ${ICONS.wave} Loop Editor
                  </button>
                  <button type="button" class="btn btn-xs btn-outline" id="btn-open-autoslicer" title="Audio Chopper &amp; Auto-Slicer (Transient Slicing, GM Drum Auto-Map, MIDI Drag-and-Drop)">
                    ${ICONS.scissors || '✂'} AutoSlicer
                  </button>
                  <button type="button" class="btn btn-xs btn-outline ${this.isSpectralVisible ? 'is-active' : ''}" id="btn-toggle-spectral" title="Toggle Spectral &amp; A/B/C Resynthesis Inspector (Shortcut: Ctrl+E)">
                    ${ICONS.wave} Spectral / A-B
                  </button>
                  <button type="button" class="btn btn-xs btn-outline" id="btn-open-zone-drawer" title="Edit Selected Region #${activeIndex + 1} (Particular Sample, Keys, Velocity, Loop Points &amp; Region Exceptions)">
                    ${ICONS.settings} Edit Region #${activeIndex + 1}
                  </button>
                  <button type="button" class="btn btn-xs btn-outline" id="btn-open-model-common-drawer" title="Open Model Configuration &amp; Global Properties">
                    ${ICONS.sliders} Model Settings
                  </button>
                  <button type="button" class="btn btn-xs btn-outline" id="btn-split-zone" title="Create a new empty Sampler Region at the next available Key/Velocity range">
                    ${ICONS.plus} New Region
                  </button>
                  <button type="button" class="btn btn-xs btn-danger" id="btn-delete-zone" ${!canDeleteReg ? 'disabled' : ''} title="Remove selected Sampler Region">
                    ${ICONS.trash} Remove Region
                  </button>
                </div>
              </div>
              <div class="zone-table-scroll" tabindex="0" role="region" aria-label="Extended 2D Sampler Regions Table">
                <table class="canonical-zone-table is-extended-table" aria-label="Extended 2D Sampler Regions Table">
                  <thead>
                    <tr>
                      <th class="col-zone" title="Sampler Region Index">Region</th>
                      <th class="col-key" title="Region Start MIDI Note (0..127)">Low Key</th>
                      <th class="col-key ${isDrumMode ? 'col-drum-piece' : ''}" title="${isDrumMode ? 'General MIDI Drum Piece and Root Note' : 'Sample Root / Unity Pitch MIDI Note (0..127)'}">${isDrumMode ? 'Drum Piece (Root)' : 'Root Key'}</th>
                      <th class="col-key" title="Region End MIDI Note (0..127)">High Key</th>
                      <th class="col-vel" title="Start Velocity (1..127)">Low Vel</th>
                      <th class="col-vel" title="End Velocity (1..127)">High Vel</th>
                      <th class="col-sample" title="Assigned Audio Sample for this Region">Sample</th>
                      <th class="col-mode" title="Click any cell to open the Interactive Waveform Loop Editor">Mode / Loop</th>
                      <th class="col-num" title="Fine Pitch Detune (-99..+99 cents)">Detune</th>
                      <th class="col-num" title="Region Gain (-32..+12 dB)">Volume</th>
                      <th class="col-num" title="Stereo Pan (-50..+50)">Pan</th>
                      <th class="col-edit" title="Audition / Edit Region Metadata &amp; Exceptions Drawer">Act</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${this.renderExtendedRegionTableRows(regions, activeRegion.id)}
                  </tbody>
                </table>
              </div>
              <div class="zone-table-footer">
                <div class="zone-table-status">
                  <span class="panel-badge ${isDrumMode ? 'is-drum-mode-badge' : ''}">${isDrumMode ? `${ICONS.drum} GM DRUM MAP` : `REGION #${activeIndex + 1} (${regions.length} REGIONS)`}</span>
                  ${isDrumMode ? drumCollisionBadgeHtml : intersectBadgeHtml}
                  <span class="panel-caption">${isDrumMode ? `Drum: ${escHtml(formatGmDrumLabel(activeRegion.rootKey))} | Key: ${activeRegion.rootKey} (${midiToNoteName(activeRegion.rootKey)}) | Vel: ${activeRegion.lowVel}..${activeRegion.highVel}${sampleTitle ? ` | ${escHtml(sampleTitle)}` : ''}` : `${midiNoteToString(activeRegion.lowKey)} .. ${midiNoteToString(activeRegion.highKey)} | Root: ${midiNoteToString(activeRegion.rootKey)} | Vel: ${activeRegion.lowVel}..${activeRegion.highVel}${sampleTitle ? ` | ${escHtml(sampleTitle)}` : ' | Empty Sample'}${this.handlers.getDetectedCategory?.() ? ` • ${escHtml(this.handlers.getDetectedCategory?.())}` : ''}`}</span>
                </div>
              </div>
            </div>
          </div>
        `;
        this.bindTableEvents();
        return;
      }
    }

    const zonesList = this.allZones.length > 0 ? this.allZones : [z];
    const canDelete = this.totalZones > 1;
    const canSplit = this.totalZones < 128 && z.highKey > z.lowKey;

    const isDrumMode = this.keyMappingMode === 'drum';
    const drumCollisionReport = isDrumMode
      ? analyzeDrumCollisions(
          zonesList.map((zn) => ({
            id: zn.id,
            lowKey: zn.lowKey,
            highKey: zn.highKey,
            rootKey: zn.rootKey,
            lowVel: 1,
            highVel: 127,
          }))
        )
      : null;
    const drumCollisionBadgeHtml =
      drumCollisionReport && drumCollisionReport.totalCollisions > 0
        ? `<span class="panel-badge is-collision-badge" title="${drumCollisionReport.totalCollisions} GM Drum collision(s) detected across zones">${ICONS.alert} ${drumCollisionReport.totalCollisions} DRUM COLLISION${drumCollisionReport.totalCollisions > 1 ? 'S' : ''}</span>`
        : '';

    this.container.innerHTML = `
      <div class="zone-inspector-panel">
        <!-- Canonical Hartmann MODELmaker v1.2 Zone Table (1..128 Zones Max) -->
        <div class="zone-table-card">
          <div class="zone-table-toolbar">
            <div class="key-mapping-mode-group">
              <span class="toolbar-mode-label">KEY MAP:</span>
              <button type="button" class="btn btn-xs ${!isDrumMode ? 'btn-accent is-active' : 'btn-outline'}" id="btn-map-mode-chromatic" title="Standard Chromatic Keyboard Mapping (Piano / Synth pitch scale C-2..G8)">
                ${ICONS.piano} Chromatic
              </button>
              <button type="button" class="btn btn-xs ${isDrumMode ? 'btn-accent is-active' : 'btn-outline'}" id="btn-map-mode-drum" title="General MIDI Drum Map (Percussion piece names, auto-placement &amp; collision detection)">
                ${ICONS.drum} GM Drum Map
              </button>
            </div>
            <div class="panel-actions">
              <button type="button" class="btn btn-xs btn-outline" id="btn-open-loop-drawer" title="Open Interactive Waveform Loop Editor &amp; Zero-Crossing Seam Magnifier for Zone #${this.zoneIndex + 1}">
                ${ICONS.wave} Loop Editor
              </button>
              <button type="button" class="btn btn-xs btn-outline" id="btn-open-autoslicer" title="Audio Chopper &amp; Auto-Slicer (Transient Slicing, GM Drum Auto-Map, MIDI Drag-and-Drop)">
                ${ICONS.scissors || '✂'} AutoSlicer
              </button>
              <button type="button" class="btn btn-xs btn-outline ${this.isSpectralVisible ? 'is-active' : ''}" id="btn-toggle-spectral" title="Toggle Spectral &amp; A/B Resynthesis Inspector (Shortcut: Ctrl+E)">
                ${ICONS.wave} Spectral / A-B
              </button>
              <button type="button" class="btn btn-xs btn-outline" id="btn-open-zone-drawer" title="Open Right Drawer to Edit Zone #${this.zoneIndex + 1} Metadata">
                ${ICONS.settings} Edit Zone #${this.zoneIndex + 1}
              </button>
              <button type="button" class="btn btn-xs btn-outline" id="btn-split-zone" ${!canSplit ? 'disabled' : ''} title="New Zone / Split at Root Key (Max 128 zones, 1 per MIDI key)">
                ${ICONS.plus} New Zone
              </button>
              <button type="button" class="btn btn-xs btn-danger" id="btn-delete-zone" ${!canDelete ? 'disabled' : ''} title="Remove Zone and merge boundaries (Shortcut: Delete)">
                ${ICONS.trash} Remove Zone
              </button>
            </div>
          </div>
          <div class="zone-table-scroll" tabindex="0" role="region" aria-label="Canonical Hartmann Key Zone Table">
            <table class="canonical-zone-table" aria-label="Canonical Hartmann Key Zone Table">
              <thead>
                <tr>
                  <th class="col-zone">Zone</th>
                  <th class="col-key">Low Key</th>
                  <th class="col-key ${isDrumMode ? 'col-drum-piece' : ''}">${isDrumMode ? 'Drum Piece (Root)' : 'Root Key'}</th>
                  <th class="col-key">High Key</th>
                  <th class="col-sample">Low Vel</th>
                  <th class="col-sample">High Vel</th>
                  <th class="col-num">Detune</th>
                  <th class="col-num">Volume</th>
                  <th class="col-num">Pan</th>
                  <th class="col-edit" title="Audition / Edit Zone Metadata Drawer">Act</th>
                </tr>
              </thead>
              <tbody>
                ${this.renderZoneTableRows(zonesList, z.id)}
              </tbody>
            </table>
          </div>
          <div class="zone-table-footer">
            <div class="zone-table-status">
              <span class="panel-badge ${isDrumMode ? 'is-drum-mode-badge' : ''}">${isDrumMode ? `${ICONS.drum} GM DRUM MAP` : `ZONE #${this.zoneIndex + 1} (${this.totalZones} / 128 MAX)`}</span>
              ${isDrumMode ? drumCollisionBadgeHtml : ''}
              <span class="panel-caption">${isDrumMode ? `Drum: ${escHtml(formatGmDrumLabel(z.rootKey))} | Key: ${z.rootKey} (${midiToNoteName(z.rootKey)})` : `${midiNoteToString(z.lowKey)} .. ${midiNoteToString(z.highKey)} | Root: ${midiNoteToString(z.rootKey)}`}</span>
            </div>
          </div>
        </div>
      </div>
    `;

    this.bindTableEvents();
  }

  private renderGmDrumOptions(currentKey: number, currentId: string): string {
    const isExtended = this.workingMode === 'extended';
    const items = isExtended
      ? this.getExtendedContext().regions.map((r, i) => ({ id: r.id, index: i + 1, rootKey: r.rootKey }))
      : this.allZones.map((z, i) => ({ id: z.id, index: i + 1, rootKey: z.rootKey }));
    return tplRenderGmDrumOptions(currentKey, currentId, items);
  }

  private renderDrawer(): void {
    this.destroyZoneKnobs();
    if (!this.drawerElement || !this.currentZone) return;
    const z = this.currentZone;
    const zonesList = this.allZones.length > 0 ? this.allZones : [z];
    const prevZone = this.zoneIndex > 0 ? zonesList[this.zoneIndex - 1] : null;
    const nextZone = this.zoneIndex < zonesList.length - 1 ? zonesList[this.zoneIndex + 1] : null;
    const minLowKey = prevZone ? prevZone.lowKey + 1 : 0;
    const maxLowKey = prevZone ? z.highKey : 0;
    const minHighKey = nextZone ? z.lowKey : 127;
    const maxHighKey = nextZone ? nextZone.highKey - 1 : 127;
    const hasHighVel = Boolean(z.sampleHigh);
    const split = Math.max(2, Math.min(127, z.velSplit ?? 64));
    const isExtended = this.workingMode === 'extended';
    const loadedSamples = this.handlers.getLoadedSamples?.() ?? [];

    const extCtx = isExtended ? this.getExtendedContext() : null;
    const extRegions = extCtx?.regions ?? [];
    const activeReg = extCtx?.activeRegion ?? null;
    const activeRegIdx = extCtx?.activeIndex ?? 0;

    // Overlap analysis for active region / zone
    const extOverlaps = isExtended ? analyzeExtendedIntersections(extRegions) : null;
    const regOverlapInfo =
      isExtended && activeReg && extOverlaps
        ? extOverlaps.byRegionId[activeReg.id]
        : undefined;
    const classicOverlaps = !isExtended ? analyzeClassicZoneOverlaps(zonesList) : null;
    const zoneOverlapPeers =
      !isExtended && classicOverlaps
        ? classicOverlaps[z.id]?.overlappingZones ?? []
        : [];

    let drumCollisionDrawerAlertHtml = '';
    if (this.keyMappingMode === 'drum') {
      const itemsForColl = isExtended
        ? extRegions.map((r) => ({
            id: r.id,
            lowKey: r.lowKey,
            highKey: r.highKey,
            rootKey: r.rootKey,
            lowVel: r.lowVel,
            highVel: r.highVel,
          }))
        : zonesList.map((zn) => ({
            id: zn.id,
            lowKey: zn.lowKey,
            highKey: zn.highKey,
            rootKey: zn.rootKey,
            lowVel: 1,
            highVel: 127,
          }));
      const collReport = analyzeDrumCollisions(itemsForColl);
      const activeItemId = isExtended && activeReg ? activeReg.id : z.id;
      const cInfo = collReport.collisionMap[activeItemId];
      if (cInfo) {
        drumCollisionDrawerAlertHtml = `
          <div class="drum-collision-alert">
            <span class="alert-icon">${ICONS.alert}</span>
            <div class="alert-content">
              <strong>GM Drum Collision Detected!</strong>
              <div>Drum piece <strong>${escHtml(cInfo.drumLabel)}</strong> is also mapped to ${cInfo.peerIndices.map((i) => `${isExtended ? 'Region' : 'Zone'} #${i}`).join(', ')} with overlapping velocity. Change drum piece or adjust velocity layers to avoid playback conflict.</div>
            </div>
          </div>
        `;
      }
    }

    const currentPrimarySample =
      isExtended && activeReg ? activeReg.sampleName : z.sampleLow;
    const lowOptionsHtml = [
      `<option value="">-- Select Loaded Sample --</option>`,
      ...loadedSamples.map(
        (s) =>
          `<option value="${escAttr(s)}" ${currentPrimarySample === s ? 'selected' : ''}>${escHtml(basenameOf(s))}</option>`
      ),
    ].join('');
    const highOptionsHtml = [
      `<option value="">-- None (Low Vel covers 1..127) --</option>`,
      ...loadedSamples.map(
        (s) =>
          `<option value="${escAttr(s)}" ${z.sampleHigh === s ? 'selected' : ''}>${escHtml(basenameOf(s))}</option>`
      ),
    ].join('');

    const effLowKey = isExtended && activeReg ? activeReg.lowKey : z.lowKey;
    const effRootKey = isExtended && activeReg ? activeReg.rootKey : z.rootKey;
    const effHighKey = isExtended && activeReg ? activeReg.highKey : z.highKey;
    const effDetune = isExtended && activeReg ? activeReg.detune : z.detune;
    const effVolume = isExtended && activeReg ? activeReg.volume : z.volume;
    const effPan = isExtended && activeReg ? activeReg.pan : z.pan;

    const effFmtInfo = this.handlers.getZoneSampleFormatInfo?.(z.id, activeReg?.id) ?? null;

    const formatByteSize = (bytes?: number): string => {
      if (!bytes || bytes <= 0) return '—';
      return formatBytes(bytes);
    };

    const renderTechSpecsBox = (info: NonNullable<ReturnType<NonNullable<ZoneInspectorHandlers['getZoneSampleFormatInfo']>>>) => {
      if (!info) return '';
      const chLabel =
        info.numChannels === 4
          ? '4.0 Quad'
          : info.numChannels === 2
            ? '2.0 Stereo'
            : info.numChannels === 1
              ? '1.0 Mono'
              : `${info.numChannels} ch`;
      const resLabel = `${info.bitsPerSample}-bit PCM`;
      const rateLabel = `${(info.sampleRate / 1000).toFixed(1)} kHz`;
      const sizeLabel = formatByteSize(info.byteSize);
      const framesCount = info.totalFrames ?? Math.round(info.durationSec * info.sampleRate);
      const durLabel = `${info.durationSec.toFixed(3)}s (${framesCount.toLocaleString()} f)`;
      const hasLoop = info.loopEnd > info.loopStart;
      const loopLabel = hasLoop
        ? `${info.loopStart.toLocaleString()}..${info.loopEnd.toLocaleString()}`
        : 'No Loop';

      return `
        <div class="sample-tech-spec-box" title="Sample Technical Specifications">
          <div class="spec-cell">
            <span class="spec-label">FILE SIZE</span>
            <span class="spec-value is-highlight">${sizeLabel}</span>
          </div>
          <div class="spec-cell">
            <span class="spec-label">CHANNELS</span>
            <span class="spec-value">${chLabel}</span>
          </div>
          <div class="spec-cell">
            <span class="spec-label">RESOLUTION</span>
            <span class="spec-value">${resLabel}</span>
          </div>
          <div class="spec-cell">
            <span class="spec-label">SAMPLE RATE</span>
            <span class="spec-value">${rateLabel}</span>
          </div>
          <div class="spec-cell">
            <span class="spec-label">DURATION</span>
            <span class="spec-value">${durLabel}</span>
          </div>
          <div class="spec-cell">
            <span class="spec-label">LOOP RANGE</span>
            <span class="spec-value ${hasLoop ? 'is-loop' : 'is-muted'}">${loopLabel}</span>
          </div>
        </div>
      `;
    };

    const regSampleLabel =
      isExtended && activeReg
        ? activeReg.sampleName
          ? basenameOf(activeReg.sampleName)
          : 'Empty Sample'
        : '';

    const drawerTitleText =
      isExtended && activeReg
        ? `REGION #${activeRegIdx + 1}: ${regSampleLabel} (${midiNoteToString(activeReg.lowKey)}..${midiNoteToString(activeReg.highKey)} • VEL ${activeReg.lowVel}..${activeReg.highVel})`
        : `ZONE #${this.zoneIndex + 1} METADATA (${midiNoteToString(z.lowKey)} .. ${midiNoteToString(z.highKey)})`;

    let overlapAlertHtml = '';
    if (isExtended && regOverlapInfo && regOverlapInfo.fullIntersections.length > 0) {
      const peerText = regOverlapInfo.fullIntersections
        .map((p) => `Region #${p.index}`)
        .join(', ');
      overlapAlertHtml = `
        <div class="overlap-alert-banner is-warning">
          <span class="overlap-alert-icon">${ICONS.alert}</span>
          <div class="overlap-alert-body">
            <strong>2D Key &amp; Velocity Intersection Detected</strong>
            <span>This region overlaps in both key range and velocity with <strong>${peerText}</strong>. Both samples will trigger simultaneously in the intersecting range unless crossfaded or adjusted.</span>
          </div>
        </div>
      `;
    } else if (!isExtended && zoneOverlapPeers.length > 0) {
      const peerText = zoneOverlapPeers.map((p) => `Zone #${p.index}`).join(', ');
      overlapAlertHtml = `
        <div class="overlap-alert-banner is-warning">
          <span class="overlap-alert-icon">${ICONS.alert}</span>
          <div class="overlap-alert-body">
            <strong>Key Range Overlap Detected</strong>
            <span>This zone overlaps with <strong>${peerText}</strong>.</span>
          </div>
        </div>
      `;
    }

    this.drawerElement.innerHTML = `
      <div class="drawer-header">
        <div class="drawer-title">
          <span class="drawer-icon">${ICONS.layers}</span>
          <span>${escHtml(drawerTitleText)}</span>
        </div>
        <div class="drawer-header-actions">
          <button type="button" class="btn btn-xs btn-outline" id="btn-drawer-open-model-config" title="Open Model Configuration Modal (Mode, Engine, Articulation, Metadata, Artwork)">
            ${ICONS.sliders} Model Settings
          </button>
          <button type="button" class="btn btn-close-drawer" id="btn-close-zone-drawer" title="Close Metadata Drawer">${ICONS.close}</button>
        </div>
      </div>

      <div class="drawer-body zone-drawer-body">
        ${overlapAlertHtml}

        <!-- 1. Key Range, Root & (in Extended Mode) Start/End Velocity -->
        <div class="inspector-section section-keys">
              <div class="section-header-row">
                <div class="section-title">${isExtended ? 'KEY &amp; VELOCITY BOUNDARIES (FREE 2D REGION)' : 'KEY ZONE BOUNDARIES (MIDI 0 C-2 .. 127 G8)'}</div>
                ${
                  this.handlers.onAutoDetectZone
                    ? `<button type="button" class="btn btn-xs btn-outline" id="btn-auto-detect-zone-general" title="Auto-detect root note (YIN/MPM + HPS) and optimal Parameter Set (0..9) from audio signal">
                        ${ICONS.cpu} Auto-Detect Pitch &amp; Set
                      </button>`
                    : ''
                }
              </div>
              ${
                this.keyMappingMode === 'drum'
                  ? `
              <div class="card card--tight card--accent-left gm-drum-assignment-card">
                <div class="drum-selector-header">
                  <label for="sel-gm-drum" class="drum-selector-label">${ICONS.drum} GM DRUM INSTRUMENT / PIECE ASSIGNMENT</label>
                  <span class="drum-assigned-tag">${formatGmDrumLabel(effRootKey)}</span>
                </div>
                <select id="sel-gm-drum" class="form-control select-gm-drum" title="Assign drum piece to this ${isExtended ? 'region' : 'zone'} (automatically aligns position to its designated MIDI note)">
                  ${this.renderGmDrumOptions(effRootKey, isExtended && activeReg ? activeReg.id : z.id)}
                </select>
                ${drumCollisionDrawerAlertHtml}
              </div>
              `
                  : ''
              }
              <div class="keys-inputs-row">
                <div class="form-group">
                  <label for="inp-low-key">LOW KEY</label>
                  <div class="input-with-note">
                    <input type="number" id="inp-low-key" min="${isExtended ? 0 : minLowKey}" max="${isExtended ? 127 : maxLowKey}" value="${effLowKey}" ${!isExtended && !prevZone ? 'disabled title="First zone always starts at 0 C-2 in Classic Mode"' : ''} />
                    <span class="note-display" id="disp-low-note">${midiToNoteName(effLowKey)}</span>
                  </div>
                </div>

                <div class="form-group is-highlight">
                  <label for="inp-root-key">${this.keyMappingMode === 'drum' ? 'DRUM KEY' : 'ROOT KEY'}</label>
                  <div class="input-with-note">
                    <input type="number" id="inp-root-key" min="0" max="127" value="${effRootKey}" />
                    <span class="note-display" id="disp-root-note">${this.keyMappingMode === 'drum' ? formatGmDrumLabel(effRootKey) : midiToNoteName(effRootKey)}</span>
                  </div>
                </div>

                <div class="form-group">
                  <label for="inp-high-key">HIGH KEY</label>
                  <div class="input-with-note">
                    <input type="number" id="inp-high-key" min="${isExtended ? 0 : minHighKey}" max="${isExtended ? 127 : maxHighKey}" value="${effHighKey}" ${!isExtended && !nextZone ? 'disabled title="Last zone always ends at 127 G8 in Classic Mode"' : ''} />
                    <span class="note-display" id="disp-high-note">${midiToNoteName(effHighKey)}</span>
                  </div>
                </div>
              </div>
              ${
                isExtended && activeReg
                  ? `
              <div class="keys-inputs-row" style="margin-top: 8px;">
                <div class="form-group">
                  <label for="inp-ext-low-vel">LOW VEL (START 1..127)</label>
                  <div class="input-with-note">
                    <input type="number" id="inp-ext-low-vel" min="1" max="127" value="${activeReg.lowVel}" title="Region Start Velocity (1..127)" />
                    <span class="note-display">Start</span>
                  </div>
                </div>

                <div class="form-group">
                  <label for="inp-ext-high-vel">HIGH VEL (END 1..127)</label>
                  <div class="input-with-note">
                    <input type="number" id="inp-ext-high-vel" min="1" max="127" value="${activeReg.highVel}" title="Region End Velocity (1..127)" />
                    <span class="note-display">End</span>
                  </div>
                </div>

                <div class="form-group is-highlight">
                  <label>VELOCITY SPAN</label>
                  <div class="input-with-note">
                    <span class="note-display" id="disp-vel-span" style="width: 100%; text-align: center;">Vel ${activeReg.lowVel}..${activeReg.highVel} (${Math.max(1, activeReg.highVel - activeReg.lowVel + 1)})</span>
                  </div>
                </div>
              </div>
              `
                  : ''
              }
            </div>

            <!-- 2. Sample Assignment -->
            ${
              isExtended && activeReg
                ? `
            <div class="inspector-section section-samples">
              <div class="section-title">REGION SAMPLE ASSIGNMENT (1 SAMPLE PER 2D REGION)</div>
              <div class="samples-slots-stack">
                <div class="sample-slot-card ${activeReg.sampleName ? 'has-file' : 'is-empty'}" id="card-sample-low">
                  <div class="sample-slot-header">
                    <span class="sample-slot-tag" id="tag-vel-low">REGION SAMPLE (KEYS ${midiNoteToString(activeReg.lowKey)}..${midiNoteToString(activeReg.highKey)} • VEL ${activeReg.lowVel}..${activeReg.highVel})</span>
                    <div style="display: inline-flex; align-items: center; gap: 6px;">
                      <button type="button" class="btn btn-xs btn-outline" id="btn-sample-card-slicer" title="Open AutoSlicer for this sample">${ICONS.scissors} Slicer</button>
                      <button type="button" class="btn btn-xs btn-outline" id="btn-sample-card-loop" title="Open Interactive Waveform Loop Editor for this sample">${ICONS.wave} Loop Editor</button>
                      ${activeReg.sampleName ? `<button type="button" class="btn btn-xs btn-accent" id="btn-play-low" title="Audition Region Sample">${ICONS.play} Audition</button>` : ''}
                    </div>
                  </div>
                  <div class="sample-slot-body">
                    <select class="sample-reuse-select" id="sel-reuse-low" title="Select an already-loaded sample from session memory">
                      ${lowOptionsHtml}
                    </select>
                    <div class="sample-actions">
                      <input type="file" id="file-input-low" accept=".wav,.aif,.aiff" multiple class="is-hidden-file" />
                      <button type="button" class="btn btn-xs btn-outline" id="btn-browse-low" title="Load new WAV/AIFF from disk into this region">${ICONS.folder} Browse...</button>
                      ${activeReg.sampleName ? `<button type="button" class="btn btn-xs btn-ghost" id="btn-clear-low" title="Clear Region Sample">${ICONS.close}</button>` : ''}
                    </div>
                  </div>
                  ${activeReg.sampleName && effFmtInfo ? renderTechSpecsBox(effFmtInfo) : ''}
                </div>
              </div>
            </div>
            `
                : `
            <div class="inspector-section section-samples">
              <div class="section-title">VELOCITY SAMPLE LAYERS (CANONICAL 1..63 / 64..127)</div>
              <div class="samples-slots-stack">
                <div class="sample-slot-card ${z.sampleLow ? 'has-file' : 'is-empty'}" id="card-sample-low">
                  <div class="sample-slot-header">
                    <span class="sample-slot-tag" id="tag-vel-low">LOW VEL SAMPLE (VEL 1..${hasHighVel ? split - 1 : 127})</span>
                    <div style="display: inline-flex; align-items: center; gap: 6px;">
                      <button type="button" class="btn btn-xs btn-outline" id="btn-sample-card-slicer" title="Open AutoSlicer for this sample">${ICONS.scissors} Slicer</button>
                      <button type="button" class="btn btn-xs btn-outline" id="btn-sample-card-loop" title="Open Interactive Waveform Loop Editor for this sample">${ICONS.wave} Loop Editor</button>
                      ${z.sampleLow ? `<button type="button" class="btn btn-xs btn-accent" id="btn-play-low" title="Audition Low Vel Audio">${ICONS.play} Audition</button>` : ''}
                    </div>
                  </div>
                  <div class="sample-slot-body">
                    <select class="sample-reuse-select" id="sel-reuse-low" title="Select an already-loaded sample from session memory (reused without re-analyzing)">
                      ${lowOptionsHtml}
                    </select>
                    <div class="sample-actions">
                      <input type="file" id="file-input-low" accept=".wav,.aif,.aiff" multiple class="is-hidden-file" />
                      <button type="button" class="btn btn-xs btn-outline" id="btn-browse-low" title="Load new WAV/AIFF from disk">${ICONS.folder} Browse...</button>
                      ${z.sampleLow ? `<button type="button" class="btn btn-xs btn-ghost" id="btn-clear-low" title="Clear Low Vel Sample">${ICONS.close}</button>` : ''}
                    </div>
                  </div>
                  ${z.sampleLow && effFmtInfo ? renderTechSpecsBox(effFmtInfo) : ''}
                </div>

                <div class="sample-slot-card ${z.sampleHigh ? 'has-file' : 'is-empty'}" id="card-sample-high">
                  <div class="sample-slot-header">
                    <span class="sample-slot-tag" id="tag-vel-high">HIGH VEL SAMPLE (${hasHighVel ? `VEL ${split}..127` : 'OPTIONAL 64..127'})</span>
                    ${z.sampleHigh ? `<button type="button" class="btn btn-xs btn-accent" id="btn-play-high" title="Audition High Vel Audio">${ICONS.play} Audition</button>` : ''}
                  </div>
                  <div class="sample-slot-body">
                    <select class="sample-reuse-select" id="sel-reuse-high" title="Select an already-loaded sample from session memory (reused without re-analyzing)">
                      ${highOptionsHtml}
                    </select>
                    <div class="sample-actions">
                      <input type="file" id="file-input-high" accept=".wav,.aif,.aiff" class="is-hidden-file" />
                      <button type="button" class="btn btn-xs btn-outline" id="btn-browse-high" title="Load new WAV/AIFF from disk">${ICONS.folder} Browse...</button>
                      ${z.sampleHigh ? `<button type="button" class="btn btn-xs btn-ghost" id="btn-clear-high" title="Clear High Vel Sample">${ICONS.close}</button>` : ''}
                    </div>
                  </div>
                </div>

                <div class="sample-vel-split-control is-disabled">
                  <label for="slider-vel-split" class="sample-vel-split-label">
                    <span>VELOCITY SPLIT POINT</span>
                    <span class="val-display" id="val-vel-split">64 (Fixed: 1–63 / 64–127)</span>
                  </label>
                  <input type="range" id="slider-vel-split" min="64" max="64" value="64" disabled title="Classic Mode strictly uses the Hartmann MODELmaker v1.2 fixed velocity split (Low Vel 1..63 / High Vel 64..127). Switch WORKING MODE → Extended for free per-region start/end velocities." />
                  <div class="sample-vel-split-hint">
                    Classic Mode: Fixed at 64 (Low: 1–63, High: 64–127). Switch to Extended Mode for free per-region velocity ranges.
                  </div>
                </div>
              </div>
            </div>
            `
            }

            <!-- 3. Canonical Tuning, Volume & Pan Controls (Rotary Knobs from @abdsynths/shared) -->
            <div class="inspector-section section-trims">
              <div class="section-title">${isExtended ? 'REGION PARAMETERS (DETUNE / VOLUME / PAN)' : 'ZONE PARAMETERS (DETUNE / VOLUME / PAN)'}</div>
              <div class="zone-knobs-row">
                <div class="synth-knob-cell" title="Fine Detune (-99 .. +99 cents). Double-click knob to reset to 0.">
                  <div id="knob-zone-detune"></div>
                  <span class="synth-knob-num stat-num" id="val-detune">${detuneToString(effDetune)}</span>
                  <span class="synth-knob-title">DETUNE (-99..+99)</span>
                </div>

                <div class="synth-knob-cell" title="Volume (-32dB .. +12dB). Double-click knob to reset to 0dB.">
                  <div id="knob-zone-volume"></div>
                  <span class="synth-knob-num stat-num" id="val-volume">${volumeToLongString(effVolume)}</span>
                  <span class="synth-knob-title">VOLUME (-32..+12dB)</span>
                </div>

                <div class="synth-knob-cell" title="Pan (-50 .. +50). Double-click knob to reset to Center (0).">
                  <div id="knob-zone-pan"></div>
                  <span class="synth-knob-num stat-num" id="val-pan">${panToString(effPan)}</span>
                  <span class="synth-knob-title">PAN (-50..+50)</span>
                </div>
              </div>
            </div>

            <!-- 5. Interactive Audio Tools & Modals Bar -->
            <div class="inspector-section section-tools">
              <div class="section-title">INTERACTIVE AUDIO EDITORS</div>
              <div class="drawer-tools-row">
                <button type="button" class="btn btn-sm btn-outline flex-1" id="btn-drawer-invoke-loop" title="Open Interactive Waveform Loop Editor &amp; Zero-Crossing Seam Magnifier Modal">
                  ${ICONS.wave} AutoLoop Editor...
                </button>
                <button type="button" class="btn btn-sm btn-outline flex-1" id="btn-drawer-invoke-slicer" title="Open Audio Chopper &amp; Multi-Layer Auto-Slicer Modal">
                  ${ICONS.scissors} AutoSlicer...
                </button>
              </div>
            </div>
          </div>
        </div>
      `;

      this.bindDrawerEvents();
      requestAnimationFrame(() => this.drawDrawerPreviewWaveform());
    }

  private bindTableEvents(): void {
    if (!this.currentZone) return;
    const z = this.currentZone;
    const isExtended = this.workingMode === 'extended';

    // Re-apply live keyboard note highlights after every table re-render
    this.applyNoteHighlights(false);

    // Row selection in Zone / Region Table
    const rows = this.container.querySelectorAll<HTMLElement>('tr.zone-table-row');
    rows.forEach((row) => {
      row.addEventListener('click', (e: MouseEvent) => {
        const playBtn = (e.target as HTMLElement).closest<HTMLElement>('.btn-row-play');
        const editBtn = (e.target as HTMLElement).closest<HTMLElement>('.btn-row-edit');
        const loopCellBtn = (e.target as HTMLElement).closest<HTMLElement>('.btn-cell-loop');
        const regionId = row.getAttribute('data-region-id');
        const zoneId = row.getAttribute('data-zone-id');

        if (playBtn) {
          e.stopPropagation();
          const targetRegId = isExtended ? (regionId || playBtn.getAttribute('data-play-region-id')) : null;
          const targetZoneId = zoneId || playBtn.getAttribute('data-play-zone-id') || null;
          this.handleRowPlayClick(targetZoneId, targetRegId);
          return;
        }

        if (isExtended && regionId) {
          const regionChanged = regionId !== this.selectedRegionId;
          this.selectedRegionId = regionId;
          if (zoneId && zoneId !== z.id && this.handlers.onSelectZone) {
            this.handlers.onSelectZone(zoneId);
          } else if (regionChanged) {
            this.renderTable();
            this.renderDrawer();
          }
          if (loopCellBtn) {
            e.stopPropagation();
            this.openLoopEditorDrawer(regionId);
            return;
          }
          if (editBtn) {
            e.stopPropagation();
            this.openDrawer();
          }
          return;
        }

        if (!zoneId) return;
        if (zoneId !== z.id && this.handlers.onSelectZone) {
          this.handlers.onSelectZone(zoneId);
        }
        if (editBtn) {
          e.stopPropagation();
          this.openDrawer();
        }
      });

      row.addEventListener('dblclick', () => {
        const regionId = row.getAttribute('data-region-id');
        const zoneId = row.getAttribute('data-zone-id');
        if (isExtended && regionId) {
          this.selectedRegionId = regionId;
          if (zoneId && zoneId !== z.id && this.handlers.onSelectZone) {
            this.handlers.onSelectZone(zoneId);
          }
          this.openDrawer();
          return;
        }
        if (zoneId && zoneId !== z.id && this.handlers.onSelectZone) {
          this.handlers.onSelectZone(zoneId);
        }
        this.openDrawer();
      });
    });

    this.container.querySelector('#btn-map-mode-chromatic')?.addEventListener('click', () => {
      this.setKeyMappingMode('chromatic');
    });

    this.container.querySelector('#btn-map-mode-drum')?.addEventListener('click', () => {
      this.setKeyMappingMode('drum');
    });

    this.container.querySelector('#btn-open-loop-drawer')?.addEventListener('click', () => {
      this.openLoopEditorDrawer();
    });

    this.container.querySelector('#btn-open-autoslicer')?.addEventListener('click', () => {
      this.handlers.onOpenAutoSlicer?.();
    });

    this.container.querySelector('#btn-open-zone-drawer')?.addEventListener('click', () => {
      this.toggleDrawer();
    });

    this.container
      .querySelector('#btn-open-model-common-drawer')
      ?.addEventListener('click', () => {
        this.openModelCommonDrawer();
      });

    this.container.querySelector('#btn-toggle-spectral')?.addEventListener('click', () => {
      this.handlers.onToggleSpectral?.();
    });

    this.container.querySelector('#btn-split-zone')?.addEventListener('click', () => {
      if (isExtended && this.handlers.onAddExtendedRegion) {
        const { activeRegion } = this.getExtendedContext();
        // Create a new empty-sample region at the next available key/velocity range
        this.handlers.onAddExtendedRegion(undefined, activeRegion?.id);
        return;
      }
      this.handlers.onSplitZone(z.id);
    });

    this.container.querySelector('#btn-delete-zone')?.addEventListener('click', () => {
      if (isExtended && this.handlers.onRemoveExtendedRegion) {
        const { activeRegion, activeIndex } = this.getExtendedContext();
        if (!activeRegion) return;
        void confirmDialog(
          `Remove region #${activeIndex + 1} (${midiNoteToString(activeRegion.lowKey)} .. ${midiNoteToString(activeRegion.highKey)}, Vel ${activeRegion.lowVel}..${activeRegion.highVel})?`,
          { confirmLabel: 'Remove region', danger: true }
        ).then((ok) => {
          if (ok) {
            this.selectedRegionId = null;
            this.handlers.onRemoveExtendedRegion!(activeRegion.id);
          }
        });
        return;
      }
      void confirmDialog(
        `Remove zone #${this.zoneIndex + 1} (${midiNoteToString(z.lowKey)} .. ${midiNoteToString(z.highKey)})? Adjacent zones will expand to maintain 0..127 coverage.`,
        { confirmLabel: 'Remove zone', danger: true }
      ).then((ok) => {
        if (ok) this.handlers.onDeleteZone(z.id);
      });
    });
  }

  /**
   * Highlights the table row(s) a keyboard note triggers.
   * Classic: the zone row plus its Low Vel / High Vel cell for the played velocity.
   * Extended: every region row whose key AND velocity ranges contain the note.
   */
  public highlightNote(
    note: number,
    hit: { zoneId?: string; layer?: 'low' | 'high'; regionIds: string[] }
  ): void {
    const pending = this.noteReleaseTimers.get(note);
    if (pending !== undefined) {
      clearTimeout(pending);
      this.noteReleaseTimers.delete(note);
    }
    this.activeNoteHits.set(note, { ...hit, regionIds: [...hit.regionIds], startedAt: performance.now() });
    this.applyNoteHighlights(true);
  }

  /** Clears a note highlight (kept visible ≥ 250 ms so quick taps are still noticeable). */
  public releaseNote(note: number): void {
    const hit = this.activeNoteHits.get(note);
    if (!hit) return;
    const remaining = Math.max(0, 250 - (performance.now() - hit.startedAt));
    const clear = () => {
      this.noteReleaseTimers.delete(note);
      this.activeNoteHits.delete(note);
      this.applyNoteHighlights(false);
    };
    if (remaining === 0) {
      clear();
    } else {
      this.noteReleaseTimers.set(note, window.setTimeout(clear, remaining));
    }
  }

  private applyNoteHighlights(scrollIntoView: boolean): void {
    const isExtended = this.workingMode === 'extended';
    this.container
      .querySelectorAll('.is-note-active, .is-note-layer-active')
      .forEach((el) => el.classList.remove('is-note-active', 'is-note-layer-active'));
    if (this.activeNoteHits.size === 0) return;

    let firstRow: HTMLElement | null = null;
    for (const hit of this.activeNoteHits.values()) {
      if (isExtended) {
        for (const regId of hit.regionIds) {
          const row = this.container.querySelector<HTMLElement>(
            `tr.zone-table-row[data-region-id="${CSS.escape(regId)}"]`
          );
          if (!row) continue;
          row.classList.add('is-note-active');
          row.querySelector('.col-sample')?.classList.add('is-note-layer-active');
          firstRow ??= row;
        }
      } else if (hit.zoneId) {
        const row = this.container.querySelector<HTMLElement>(
          `tr.zone-table-row[data-zone-id="${CSS.escape(hit.zoneId)}"]:not([data-region-id])`
        );
        if (!row) continue;
        row.classList.add('is-note-active');
        row
          .querySelector(`td[data-vel-layer="${hit.layer ?? 'low'}"]`)
          ?.classList.add('is-note-layer-active');
        firstRow ??= row;
      }
    }

    if (scrollIntoView && firstRow) {
      const scroller = firstRow.closest<HTMLElement>('.zone-table-scroll');
      if (scroller) {
        const sRect = scroller.getBoundingClientRect();
        const rRect = firstRow.getBoundingClientRect();
        const head = scroller.querySelector('thead')?.getBoundingClientRect().height ?? 0;
        if (rRect.top < sRect.top + head) {
          scroller.scrollTop -= sRect.top + head - rRect.top;
        } else if (rRect.bottom > sRect.bottom) {
          scroller.scrollTop += rRect.bottom - sRect.bottom;
        }
      }
    }
  }

  private handleRowPlayClick(zoneId: string | null, regionId: string | null): void {
    const isExtended = this.workingMode === 'extended';
    const rowKey = isExtended ? (regionId ?? zoneId ?? '') : (zoneId ?? '');
    if (!rowKey) return;

    if (this.playingRowId === rowKey) {
      this.handlers.onStopAudition?.();
      this.setPlayingRow(null);
      this.updatePlayButtonStates();
      return;
    }

    const rowIds = {
      zoneId: zoneId || undefined,
      regionId: isExtended && regionId ? regionId : undefined,
    };
    this.setPlayingRow(rowKey, rowIds);
    this.updatePlayButtonStates();

    if (this.handlers.onAuditionRow) {
      this.handlers.onAuditionRow(rowIds);
    } else if (isExtended && regionId) {
      this.selectedRegionId = regionId;
      const targetZoneId = zoneId || this.currentZone?.id;
      this.handlers.onAuditionLoop?.({
        zoneId: targetZoneId,
        regionId: regionId,
      });
    } else if (zoneId) {
      this.handlers.onAuditionLoop?.({
        zoneId: zoneId,
        regionId: undefined,
      });
    }

    this.startAuditionStateMonitor();
  }

  private updatePlayButtonStates(): void {
    const playButtons = this.container.querySelectorAll<HTMLButtonElement>('.btn-row-play');
    playButtons.forEach((btn) => {
      const rowId = btn.getAttribute('data-play-row-id');
      const isPlaying = this.playingRowId !== null && rowId === this.playingRowId;
      btn.classList.toggle('is-playing', isPlaying);
      btn.innerHTML = isPlaying ? ICONS.stop : ICONS.play;
      btn.setAttribute(
        'title',
        isPlaying
          ? 'Stop auditioning'
          : 'Audition sample (Loop, DAHDSR Envelopes, Volume, Pan, Detune)'
      );
    });

    const isExtended = this.workingMode === 'extended';
    const activeReg = isExtended ? this.getExtendedContext().activeRegion : null;
    const rowKey = isExtended ? (activeReg?.id ?? this.currentZone?.id ?? '') : (this.currentZone?.id ?? '');
    const isDrawerPlaying = this.playingRowId !== null && this.playingRowId === rowKey;

    const drawerStatusDot = this.drawerElement?.querySelector('.drawer-waveform-status-info .status-indicator-dot');
    const drawerStatusText = this.drawerElement?.querySelector('.drawer-waveform-status-info .status-text');
    if (drawerStatusDot) drawerStatusDot.classList.toggle('is-active', isDrawerPlaying);
    if (drawerStatusText) {
      drawerStatusText.textContent = isDrawerPlaying
        ? 'Auditioning (Synced with Table Play)'
        : 'Ready for audition (Volume, Pan, Detune & Loop applied)';
    }
  }

  /** Called when another audition source (e.g. the keyboard) takes over playback. */
  public clearPlayingRow(): void {
    if (!this.playingRowId) return;
    this.setPlayingRow(null);
    this.updatePlayButtonStates();
  }

  /**
   * Single place that changes the auditioning row, so the keyboard and the zone map
   * highlights always follow start / manual stop / natural end of playback.
   */
  private setPlayingRow(
    rowKey: string | null,
    ids?: { zoneId?: string; regionId?: string }
  ): void {
    const changed = rowKey !== this.playingRowId;
    this.playingRowId = rowKey;
    this.playingRowStartedAt = rowKey ? performance.now() : 0;
    if (rowKey) {
      this.handlers.onRowAuditionChange?.(ids ?? {});
    } else if (changed) {
      this.handlers.onRowAuditionChange?.(null);
    }
  }

  private startAuditionStateMonitor(): void {
    if (this.auditionCheckTimer !== null) {
      clearInterval(this.auditionCheckTimer);
      this.auditionCheckTimer = null;
    }
    this.auditionCheckTimer = window.setInterval(() => {
      if (this.playingRowId) {
        // Grace period: decoding/AudioContext resume may delay the actual start
        if (performance.now() - this.playingRowStartedAt < 600) return;
        const isPlaying = this.handlers.isAuditionPlaying?.() ?? false;
        if (!isPlaying) {
          this.setPlayingRow(null);
          this.updatePlayButtonStates();
          if (this.auditionCheckTimer !== null) {
            clearInterval(this.auditionCheckTimer);
            this.auditionCheckTimer = null;
          }
        }
      } else {
        if (this.auditionCheckTimer !== null) {
          clearInterval(this.auditionCheckTimer);
          this.auditionCheckTimer = null;
        }
      }
    }, 150);
  }

  private bindDrawerEvents(): void {
    if (!this.drawerElement || !this.currentZone) return;
    const z = this.currentZone;
    const isExtended = this.workingMode === 'extended';
    const activeReg = isExtended ? this.getExtendedContext().activeRegion : null;

    this.drawerElement.querySelector('#btn-close-zone-drawer')?.addEventListener('click', () => {
      this.closeDrawer();
    });

    this.drawerElement.querySelector('#btn-drawer-open-model-config')?.addEventListener('click', () => {
      this.handlers.onOpenModelConfig?.('general');
    });

    this.drawerElement.querySelector('#btn-drawer-invoke-loop')?.addEventListener('click', () => {
      this.handlers.onOpenLoopEditor?.();
    });

    this.drawerElement.querySelector('#btn-drawer-invoke-slicer')?.addEventListener('click', () => {
      this.handlers.onOpenAutoSlicer?.();
    });

    this.drawerElement.querySelectorAll('#btn-sample-card-slicer').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.handlers.onOpenAutoSlicer?.();
      });
    });

    this.drawerElement.querySelectorAll('#btn-sample-card-loop').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.handlers.onOpenLoopEditor?.();
      });
    });

    // Fase 7 Auto-Detect Pitch & Parameter Set buttons
    const triggerAutoDetect = () => {
      this.handlers.onAutoDetectZone?.(z.id);
      this.renderDrawer();
    };
    this.drawerElement
      .querySelector('#btn-auto-detect-zone-general')
      ?.addEventListener('click', triggerAutoDetect);
    this.drawerElement
      .querySelector('#btn-auto-detect-zone-ext')
      ?.addEventListener('click', triggerAutoDetect);

    // Keys & Velocity inputs
    const inpLow = this.drawerElement.querySelector('#inp-low-key') as HTMLInputElement | null;
    const inpRoot = this.drawerElement.querySelector('#inp-root-key') as HTMLInputElement | null;
    const inpHigh = this.drawerElement.querySelector('#inp-high-key') as HTMLInputElement | null;
    const inpExtLowVel = this.drawerElement.querySelector('#inp-ext-low-vel') as HTMLInputElement | null;
    const inpExtHighVel = this.drawerElement.querySelector('#inp-ext-high-vel') as HTMLInputElement | null;
    const selGmDrum = this.drawerElement.querySelector('#sel-gm-drum') as HTMLSelectElement | null;

    selGmDrum?.addEventListener('change', () => {
      const targetKey = parseInt(selGmDrum.value, 10);
      if (Number.isNaN(targetKey) || targetKey < 0 || targetKey > 127) return;

      if (isExtended && activeReg && this.handlers.onUpdateExtendedRegion) {
        this.handlers.onUpdateExtendedRegion(activeReg.id, {
          rootKey: targetKey,
          lowKey: targetKey,
          highKey: targetKey,
        });
      } else if (this.handlers.onUpdateZone) {
        this.handlers.onUpdateZone(z.id, {
          rootKey: targetKey,
          lowKey: targetKey,
          highKey: targetKey,
        });
      }
    });

    inpLow?.addEventListener('input', () => {
      const v = parseInt(inpLow.value, 10);
      if (!Number.isNaN(v) && v >= 0 && v <= 127) {
        const d = this.drawerElement?.querySelector('#disp-low-note');
        if (d) d.textContent = midiToNoteName(v);
      }
    });

    inpLow?.addEventListener('change', () => {
      const val = Math.min(127, Math.max(0, parseInt(inpLow.value, 10) || 0));
      if (isExtended && activeReg && this.handlers.onUpdateExtendedRegion) {
        this.handlers.onUpdateExtendedRegion(activeReg.id, { lowKey: val });
      } else {
        this.handlers.onUpdateZone(z.id, { lowKey: val });
      }
    });

    inpRoot?.addEventListener('input', () => {
      const v = parseInt(inpRoot.value, 10);
      if (!Number.isNaN(v) && v >= 0 && v <= 127) {
        const d = this.drawerElement?.querySelector('#disp-root-note');
        if (d) {
          d.textContent =
            this.keyMappingMode === 'drum'
              ? formatGmDrumLabel(v)
              : midiToNoteName(v);
        }
      }
    });

    inpRoot?.addEventListener('change', () => {
      const parsed = parseInt(inpRoot.value, 10);
      const fallback = isExtended && activeReg ? activeReg.rootKey : z.rootKey;
      const val = Math.min(127, Math.max(0, Number.isNaN(parsed) ? fallback : parsed));
      if (this.keyMappingMode === 'drum' && selGmDrum) {
        selGmDrum.value = String(val);
      }
      if (isExtended && activeReg && this.handlers.onUpdateExtendedRegion) {
        this.handlers.onUpdateExtendedRegion(activeReg.id, {
          rootKey: val,
          ...(this.keyMappingMode === 'drum' ? { lowKey: val, highKey: val } : {}),
        });
      } else {
        this.handlers.onUpdateZone(z.id, {
          rootKey: val,
          ...(this.keyMappingMode === 'drum' ? { lowKey: val, highKey: val } : {}),
        });
      }
    });

    inpHigh?.addEventListener('input', () => {
      const v = parseInt(inpHigh.value, 10);
      if (!Number.isNaN(v) && v >= 0 && v <= 127) {
        const d = this.drawerElement?.querySelector('#disp-high-note');
        if (d) d.textContent = midiToNoteName(v);
      }
    });

    inpHigh?.addEventListener('change', () => {
      const val = Math.min(127, Math.max(0, parseInt(inpHigh.value, 10) || 127));
      if (isExtended && activeReg && this.handlers.onUpdateExtendedRegion) {
        this.handlers.onUpdateExtendedRegion(activeReg.id, { highKey: val });
      } else {
        this.handlers.onUpdateZone(z.id, { highKey: val });
      }
    });

    inpExtLowVel?.addEventListener('change', () => {
      if (!activeReg || !this.handlers.onUpdateExtendedRegion) return;
      const val = Math.min(127, Math.max(1, parseInt(inpExtLowVel.value, 10) || 1));
      const newHigh = Math.max(val, activeReg.highVel);
      this.handlers.onUpdateExtendedRegion(activeReg.id, { lowVel: val, highVel: newHigh });
    });

    inpExtHighVel?.addEventListener('change', () => {
      if (!activeReg || !this.handlers.onUpdateExtendedRegion) return;
      const val = Math.min(127, Math.max(1, parseInt(inpExtHighVel.value, 10) || 127));
      const newLow = Math.min(val, activeReg.lowVel);
      this.handlers.onUpdateExtendedRegion(activeReg.id, { lowVel: newLow, highVel: val });
    });

    // Canonical integer Trims via @abdsynths/shared Knob:
    // Detune (-99..+99, center 0), Volume (-32..+12 dB, default 0 dB), Pan (-50..+50, center 0)
    const initDetuneVal = isExtended && activeReg ? activeReg.detune : z.detune;
    const initVolVal = isExtended && activeReg ? activeReg.volume : z.volume;
    const initPanVal = isExtended && activeReg ? activeReg.pan : z.pan;

    const detuneMount = this.drawerElement.querySelector('#knob-zone-detune') as HTMLElement | null;
    const valDetune = this.drawerElement.querySelector('#val-detune') as HTMLElement | null;
    if (detuneMount) {
      const initDetuneNorm = Math.max(0, Math.min(1, (Math.round(initDetuneVal) + 99) / 198));
      this.detuneKnob = new Knob(detuneMount, {
        size: 38,
        value: 0.5, // double-click resets to 0 cents
        bipolar: true,
        step: 1 / 198,
        label: 'DETUNE',
        format: (normVal: number) => detuneToString(Math.round(normVal * 198 - 99)),
        onDragStart: () => {
          this.isDraggingKnob = true;
        },
        onDragEnd: () => {
          this.isDraggingKnob = false;
        },
        onChange: (normVal: number) => {
          const val = Math.max(-99, Math.min(99, Math.round(normVal * 198 - 99)));
          if (valDetune) valDetune.textContent = detuneToString(val);
          if (isExtended && activeReg && this.handlers.onUpdateExtendedRegion) {
            this.handlers.onUpdateExtendedRegion(activeReg.id, { detune: val });
          } else {
            this.handlers.onUpdateZone(z.id, { detune: val });
          }
        },
      });
      this.detuneKnob.setValue(initDetuneNorm);
    }

    const volMount = this.drawerElement.querySelector('#knob-zone-volume') as HTMLElement | null;
    const valVol = this.drawerElement.querySelector('#val-volume') as HTMLElement | null;
    if (volMount) {
      const initVolNorm = Math.max(0, Math.min(1, (Math.round(initVolVal) + 32) / 44));
      this.volumeKnob = new Knob(volMount, {
        size: 38,
        value: 32 / 44, // double-click resets to 0 dB
        bipolar: false,
        step: 1 / 44,
        label: 'VOLUME',
        format: (normVal: number) => volumeToLongString(Math.round(normVal * 44 - 32)),
        onDragStart: () => {
          this.isDraggingKnob = true;
        },
        onDragEnd: () => {
          this.isDraggingKnob = false;
        },
        onChange: (normVal: number) => {
          const val = Math.max(-32, Math.min(12, Math.round(normVal * 44 - 32)));
          if (valVol) valVol.textContent = volumeToLongString(val);
          if (isExtended && activeReg && this.handlers.onUpdateExtendedRegion) {
            this.handlers.onUpdateExtendedRegion(activeReg.id, { volume: val });
          } else {
            this.handlers.onUpdateZone(z.id, { volume: val });
          }
        },
      });
      this.volumeKnob.setValue(initVolNorm);
    }

    const panMount = this.drawerElement.querySelector('#knob-zone-pan') as HTMLElement | null;
    const valPan = this.drawerElement.querySelector('#val-pan') as HTMLElement | null;
    if (panMount) {
      const initPanNorm = Math.max(0, Math.min(1, (Math.round(initPanVal) + 50) / 100));
      this.panKnob = new Knob(panMount, {
        size: 38,
        value: 0.5, // double-click resets to 0 (center)
        bipolar: true,
        step: 1 / 100,
        label: 'PAN',
        format: (normVal: number) => panToString(Math.round(normVal * 100 - 50)),
        onDragStart: () => {
          this.isDraggingKnob = true;
        },
        onDragEnd: () => {
          this.isDraggingKnob = false;
        },
        onChange: (normVal: number) => {
          const val = Math.max(-50, Math.min(50, Math.round(normVal * 100 - 50)));
          if (valPan) valPan.textContent = panToString(val);
          if (isExtended && activeReg && this.handlers.onUpdateExtendedRegion) {
            this.handlers.onUpdateExtendedRegion(activeReg.id, { pan: val });
          } else {
            this.handlers.onUpdateZone(z.id, { pan: val });
          }
        },
      });
      this.panKnob.setValue(initPanNorm);
    }

    // Reuse already-loaded sample dropdowns
    const selReuseLow = this.drawerElement.querySelector('#sel-reuse-low') as HTMLSelectElement | null;
    selReuseLow?.addEventListener('change', () => {
      const chosen = selReuseLow.value || null;
      if (chosen) {
        if (isExtended && activeReg && this.handlers.onUpdateExtendedRegion) {
          this.handlers.onUpdateExtendedRegion(activeReg.id, { sampleName: chosen });
        } else {
          this.handlers.onUpdateZone(z.id, { sampleLow: chosen });
        }
      }
    });

    const selReuseHigh = this.drawerElement.querySelector('#sel-reuse-high') as HTMLSelectElement | null;
    selReuseHigh?.addEventListener('change', () => {
      const chosen = selReuseHigh.value || null;
      if (chosen && !z.sampleLow) {
        this.handlers.onUpdateZone(z.id, { sampleLow: chosen, sampleHigh: null });
      } else {
        this.handlers.onUpdateZone(z.id, { sampleHigh: chosen });
      }
    });

    // Sample Low / Region Sample actions
    const fileInputLow = this.drawerElement.querySelector('#file-input-low') as HTMLInputElement | null;
    this.drawerElement.querySelector('#btn-browse-low')?.addEventListener('click', () => {
      if (fileInputLow) {
        fileInputLow.click();
      }
    });

    fileInputLow?.addEventListener('change', () => {
      const files = fileInputLow.files;
      if (!files || files.length === 0) return;
      if (files.length > 1 && this.handlers.onDropMultipleFiles) {
        this.handlers.onDropMultipleFiles(files);
      } else if (isExtended && activeReg && this.handlers.onLoadSampleFileIntoRegion) {
        this.handlers.onLoadSampleFileIntoRegion(activeReg.id, files[0]);
      } else if (this.handlers.onLoadSampleFile) {
        this.handlers.onLoadSampleFile(z.id, 'low', files[0]);
      }
    });

    const cardLow = this.drawerElement.querySelector('#card-sample-low') as HTMLElement | null;
    cardLow?.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      cardLow.classList.add('is-dragover');
    });
    cardLow?.addEventListener('dragleave', () => {
      cardLow.classList.remove('is-dragover');
    });
    cardLow?.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      cardLow.classList.remove('is-dragover');
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      if (files.length > 1 && this.handlers.onDropMultipleFiles) {
        this.handlers.onDropMultipleFiles(files);
      } else if (isExtended && activeReg && this.handlers.onLoadSampleFileIntoRegion) {
        this.handlers.onLoadSampleFileIntoRegion(activeReg.id, files[0]);
      } else if (this.handlers.onLoadSampleFile) {
        this.handlers.onLoadSampleFile(z.id, 'low', files[0]);
      }
    });

    this.drawerElement.querySelector('#btn-clear-low')?.addEventListener('click', () => {
      if (isExtended && activeReg && this.handlers.onUpdateExtendedRegion) {
        this.handlers.onUpdateExtendedRegion(activeReg.id, { sampleName: '' });
        return;
      }
      if (z.sampleHigh) {
        this.handlers.onUpdateZone(z.id, { sampleLow: z.sampleHigh, sampleHigh: null });
      } else {
        this.handlers.onUpdateZone(z.id, { sampleLow: null });
      }
    });

    this.drawerElement.querySelector('#btn-play-low')?.addEventListener('click', () => {
      this.handleRowPlayClick(z.id, isExtended && activeReg ? activeReg.id : null);
    });

    this.drawerElement.querySelector('.drawer-waveform-play-btn')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.handleRowPlayClick(z.id, isExtended && activeReg ? activeReg.id : null);
    });

    // Sample High actions (Classic Mode)
    const fileInputHigh = this.drawerElement.querySelector('#file-input-high') as HTMLInputElement | null;
    this.drawerElement.querySelector('#btn-browse-high')?.addEventListener('click', () => {
      if (this.handlers.onLoadSampleFile && fileInputHigh) {
        fileInputHigh.click();
      }
    });

    fileInputHigh?.addEventListener('change', () => {
      const file = fileInputHigh.files?.[0];
      if (file && this.handlers.onLoadSampleFile) {
        this.handlers.onLoadSampleFile(z.id, 'high', file);
      }
    });

    const cardHigh = this.drawerElement.querySelector('#card-sample-high') as HTMLElement | null;
    cardHigh?.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      cardHigh.classList.add('is-dragover');
    });
    cardHigh?.addEventListener('dragleave', () => {
      cardHigh.classList.remove('is-dragover');
    });
    cardHigh?.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      cardHigh.classList.remove('is-dragover');
      const file = e.dataTransfer?.files?.[0];
      if (file && this.handlers.onLoadSampleFile) {
        this.handlers.onLoadSampleFile(z.id, 'high', file);
      }
    });

    this.drawerElement.querySelector('#btn-clear-high')?.addEventListener('click', () => {
      this.handlers.onUpdateZone(z.id, { sampleHigh: null });
    });

    this.drawerElement.querySelector('#btn-play-high')?.addEventListener('click', () => {
      if (z.sampleHigh) this.handlers.onAuditionSample(z.sampleHigh);
    });

    // Extended Region Loop, Inheritance & Custom Override events
    const extSection = this.drawerElement.querySelector('.section-extended-region');
    const extRegionId = extSection?.getAttribute('data-ext-region-id') || '';
    if (extRegionId && this.handlers.onUpdateExtendedRegion) {
      const updateReg = (changes: Partial<ExtendedRegion>) => {
        this.handlers.onUpdateExtendedRegion?.(extRegionId, changes);
      };

      const chkPbOverride = this.drawerElement.querySelector(
        '#chk-reg-playback-override'
      ) as HTMLInputElement | null;
      chkPbOverride?.addEventListener('change', () => {
        const enableOverride = Boolean(chkPbOverride.checked);
        const commonPb =
          this.handlers.getCommonPlayback?.() ?? createDefaultCommonPlayback();
        if (enableOverride) {
          updateReg({
            hasPlaybackOverride: true,
            loopMode: activeReg?.loopMode ?? commonPb.loopMode,
            pitchKeytrack: activeReg?.pitchKeytrack ?? commonPb.pitchKeytrack,
            trigger: activeReg?.trigger ?? commonPb.trigger,
            fadeCurve: activeReg?.fadeCurve ?? commonPb.fadeCurve,
          });
        } else {
          updateReg({
            hasPlaybackOverride: false,
            loopMode: commonPb.loopMode,
            pitchKeytrack: commonPb.pitchKeytrack,
            trigger: commonPb.trigger,
            fadeCurve: commonPb.fadeCurve,
          });
        }
      });

      const chkArtOverride = this.drawerElement.querySelector(
        '#chk-reg-art-override'
      ) as HTMLInputElement | null;
      chkArtOverride?.addEventListener('change', () => {
        const enableArtOvr = Boolean(chkArtOverride.checked);
        const globalArt = this.handlers.getArticulation?.();
        if (enableArtOvr) {
          updateReg({
            hasArticulationOverride: true,
            ampEnvOverride: activeReg?.ampEnvOverride ?? {
              attackSec: globalArt?.ampEnv.attackSec ?? 0.005,
              decaySec: globalArt?.ampEnv.decaySec ?? 0.25,
              sustainLevel: globalArt?.ampEnv.sustainLevel ?? 1.0,
              releaseSec: globalArt?.ampEnv.releaseSec ?? 0.2,
            },
            filterOverride: activeReg?.filterOverride ?? {
              cutoffHz: globalArt?.filter.cutoffHz ?? 18000,
              resonanceDb: globalArt?.filter.resonanceDb ?? 0,
            },
          });
        } else {
          updateReg({
            hasArticulationOverride: false,
            ampEnvOverride: undefined,
            filterOverride: undefined,
          });
        }
      });

      const bindRegionArtOverrideInputs = () => {
        if (!activeReg) return;
        const inpA = this.drawerElement?.querySelector('#inp-reg-amp-a') as HTMLInputElement | null;
        const inpD = this.drawerElement?.querySelector('#inp-reg-amp-d') as HTMLInputElement | null;
        const inpS = this.drawerElement?.querySelector('#inp-reg-amp-s') as HTMLInputElement | null;
        const inpR = this.drawerElement?.querySelector('#inp-reg-amp-r') as HTMLInputElement | null;
        const inpCut = this.drawerElement?.querySelector('#inp-reg-flt-cut') as HTMLInputElement | null;
        const inpReso = this.drawerElement?.querySelector('#inp-reg-flt-reso') as HTMLInputElement | null;

        updateReg({
          hasArticulationOverride: true,
          ampEnvOverride: {
            attackSec: Math.max(0.002, parseFloat(inpA?.value ?? '0.005') || 0.005),
            decaySec: Math.max(0.005, parseFloat(inpD?.value ?? '0.25') || 0.25),
            sustainLevel: Math.max(0, Math.min(1, parseFloat(inpS?.value ?? '1') || 0)),
            releaseSec: Math.max(0.01, parseFloat(inpR?.value ?? '0.2') || 0.2),
          },
          filterOverride: {
            cutoffHz: Math.max(20, Math.min(20000, parseFloat(inpCut?.value ?? '18000') || 18000)),
            resonanceDb: Math.max(0, Math.min(40, parseFloat(inpReso?.value ?? '0') || 0)),
          },
        });
      };

      for (const sel of [
        '#inp-reg-amp-a',
        '#inp-reg-amp-d',
        '#inp-reg-amp-s',
        '#inp-reg-amp-r',
        '#inp-reg-flt-cut',
        '#inp-reg-flt-reso',
      ]) {
        this.drawerElement
          .querySelector(sel)
          ?.addEventListener('change', bindRegionArtOverrideInputs);
      }

      const selLoopMode = this.drawerElement.querySelector('#sel-ext-loop-mode') as HTMLSelectElement | null;
      selLoopMode?.addEventListener('change', () => {
        updateReg({ hasPlaybackOverride: true, loopMode: selLoopMode.value as LoopMode });
      });

      const inpLoopStart = this.drawerElement.querySelector('#inp-ext-loop-start') as HTMLInputElement | null;
      inpLoopStart?.addEventListener('change', () => {
        updateReg({ loopStart: Math.max(0, parseInt(inpLoopStart.value, 10) || 0) });
      });

      const inpLoopEnd = this.drawerElement.querySelector('#inp-ext-loop-end') as HTMLInputElement | null;
      inpLoopEnd?.addEventListener('change', () => {
        updateReg({ loopEnd: Math.max(0, parseInt(inpLoopEnd.value, 10) || 0) });
      });

      const inpLoopXfade = this.drawerElement.querySelector('#inp-ext-loop-xfade') as HTMLInputElement | null;
      inpLoopXfade?.addEventListener('change', () => {
        updateReg({ loopCrossfadeMs: Math.max(0, parseInt(inpLoopXfade.value, 10) || 0) });
      });

      const inpKeytrack = this.drawerElement.querySelector('#inp-ext-keytrack') as HTMLInputElement | null;
      inpKeytrack?.addEventListener('change', () => {
        updateReg({
          hasPlaybackOverride: true,
          pitchKeytrack: Math.max(0, Math.min(100, parseInt(inpKeytrack.value, 10) || 0)),
        });
      });

      const inpKeyFadeIn = this.drawerElement.querySelector('#inp-ext-key-fade-in') as HTMLInputElement | null;
      inpKeyFadeIn?.addEventListener('change', () => {
        updateReg({ keyFadeIn: Math.max(0, parseInt(inpKeyFadeIn.value, 10) || 0) });
      });

      const inpKeyFadeOut = this.drawerElement.querySelector('#inp-ext-key-fade-out') as HTMLInputElement | null;
      inpKeyFadeOut?.addEventListener('change', () => {
        updateReg({ keyFadeOut: Math.max(0, parseInt(inpKeyFadeOut.value, 10) || 0) });
      });

      const selTrigger = this.drawerElement.querySelector('#sel-ext-trigger') as HTMLSelectElement | null;
      selTrigger?.addEventListener('change', () => {
        updateReg({ hasPlaybackOverride: true, trigger: selTrigger.value as TriggerMode });
      });

      const inpVelFadeIn = this.drawerElement.querySelector('#inp-ext-vel-fade-in') as HTMLInputElement | null;
      inpVelFadeIn?.addEventListener('change', () => {
        updateReg({ velFadeIn: Math.max(0, Math.min(127, parseInt(inpVelFadeIn.value, 10) || 0)) });
      });

      const inpVelFadeOut = this.drawerElement.querySelector('#inp-ext-vel-fade-out') as HTMLInputElement | null;
      inpVelFadeOut?.addEventListener('change', () => {
        updateReg({ velFadeOut: Math.max(0, Math.min(127, parseInt(inpVelFadeOut.value, 10) || 0)) });
      });

      const selFadeCurve = this.drawerElement.querySelector('#sel-ext-fade-curve') as HTMLSelectElement | null;
      selFadeCurve?.addEventListener('change', () => {
        updateReg({ hasPlaybackOverride: true, fadeCurve: selFadeCurve.value as CrossfadeCurve });
      });
    }

    // Model Common Playback Defaults bindings
    if (this.handlers.onUpdateCommonPlayback) {
      const selCommonLoop = this.drawerElement.querySelector(
        '#sel-common-loop-mode'
      ) as HTMLSelectElement | null;
      selCommonLoop?.addEventListener('change', () => {
        this.handlers.onUpdateCommonPlayback?.({
          loopMode: selCommonLoop.value as LoopMode,
        });
      });

      const inpCommonKeytrack = this.drawerElement.querySelector(
        '#inp-common-keytrack'
      ) as HTMLInputElement | null;
      inpCommonKeytrack?.addEventListener('change', () => {
        this.handlers.onUpdateCommonPlayback?.({
          pitchKeytrack: Math.max(
            0,
            Math.min(100, parseInt(inpCommonKeytrack.value, 10) || 0)
          ),
        });
      });

      const selCommonTrigger = this.drawerElement.querySelector(
        '#sel-common-trigger'
      ) as HTMLSelectElement | null;
      selCommonTrigger?.addEventListener('change', () => {
        this.handlers.onUpdateCommonPlayback?.({
          trigger: selCommonTrigger.value as TriggerMode,
        });
      });

      const selCommonFadeCurve = this.drawerElement.querySelector(
        '#sel-common-fade-curve'
      ) as HTMLSelectElement | null;
      selCommonFadeCurve?.addEventListener('change', () => {
        this.handlers.onUpdateCommonPlayback?.({
          fadeCurve: selCommonFadeCurve.value as CrossfadeCurve,
        });
      });

      this.drawerElement
        .querySelector('#btn-reset-all-pb-overrides')
        ?.addEventListener('click', () => {
          this.handlers.onUpdateCommonPlayback?.({}, true);
        });
    }

    if (this.handlers.onUpdateArticulation && this.handlers.getArticulation) {
      const bindArt = () => {
        const curr = this.handlers.getArticulation!();
        const chkAmp = this.drawerElement?.querySelector('#chk-art-amp-env') as HTMLInputElement | null;
        const chkBake = this.drawerElement?.querySelector('#chk-art-bake-env') as HTMLInputElement | null;
        const inpAmpA = this.drawerElement?.querySelector('#inp-art-amp-a') as HTMLInputElement | null;
        const inpAmpD = this.drawerElement?.querySelector('#inp-art-amp-d') as HTMLInputElement | null;
        const inpAmpS = this.drawerElement?.querySelector('#inp-art-amp-s') as HTMLInputElement | null;
        const inpAmpR = this.drawerElement?.querySelector('#inp-art-amp-r') as HTMLInputElement | null;

        const chkFlt = this.drawerElement?.querySelector('#chk-art-filter') as HTMLInputElement | null;
        const selFltType = this.drawerElement?.querySelector('#sel-art-filter-type') as HTMLSelectElement | null;
        const inpFltCut = this.drawerElement?.querySelector('#inp-art-filter-cutoff') as HTMLInputElement | null;
        const inpFltReso = this.drawerElement?.querySelector('#inp-art-filter-reso') as HTMLInputElement | null;

        const chkLfo = this.drawerElement?.querySelector('#chk-art-lfo') as HTMLInputElement | null;
        const inpLfoFreq = this.drawerElement?.querySelector('#inp-art-lfo-freq') as HTMLInputElement | null;
        const inpLfoDelay = this.drawerElement?.querySelector('#inp-art-lfo-delay') as HTMLInputElement | null;
        const inpLfoPitch = this.drawerElement?.querySelector('#inp-art-lfo-pitch') as HTMLInputElement | null;

        this.handlers.onUpdateArticulation!({
          ampEnvEnabled: Boolean(chkAmp?.checked),
          bakeEnvelopeIntoWave: Boolean(chkBake?.checked),
          ampEnv: {
            ...curr.ampEnv,
            attackSec: Math.max(0.002, parseFloat(inpAmpA?.value ?? String(curr.ampEnv.attackSec)) || 0.005),
            decaySec: Math.max(0.005, parseFloat(inpAmpD?.value ?? String(curr.ampEnv.decaySec)) || 0.25),
            sustainLevel: Math.max(0, Math.min(1, parseFloat(inpAmpS?.value ?? String(curr.ampEnv.sustainLevel)) || 0)),
            releaseSec: Math.max(0.01, parseFloat(inpAmpR?.value ?? String(curr.ampEnv.releaseSec)) || 0.2),
          },
          filter: {
            ...curr.filter,
            enabled: Boolean(chkFlt?.checked),
            type: (selFltType?.value === 'hpf' || selFltType?.value === 'bpf' ? selFltType.value : 'lpf'),
            cutoffHz: Math.max(20, Math.min(20000, parseFloat(inpFltCut?.value ?? String(curr.filter.cutoffHz)) || 18000)),
            resonanceDb: Math.max(0, Math.min(40, parseFloat(inpFltReso?.value ?? String(curr.filter.resonanceDb)) || 0)),
          },
          vibLfo: {
            ...curr.vibLfo,
            enabled: Boolean(chkLfo?.checked),
            freqHz: Math.max(0.05, Math.min(50, parseFloat(inpLfoFreq?.value ?? String(curr.vibLfo.freqHz)) || 5)),
            delaySec: Math.max(0, Math.min(10, parseFloat(inpLfoDelay?.value ?? String(curr.vibLfo.delaySec)) || 0)),
            toPitchCents: Math.max(-1200, Math.min(1200, parseFloat(inpLfoPitch?.value ?? String(curr.vibLfo.toPitchCents)) || 0)),
          },
        });
      };

      const artSelectors = [
        '#chk-art-amp-env',
        '#chk-art-bake-env',
        '#inp-art-amp-a',
        '#inp-art-amp-d',
        '#inp-art-amp-s',
        '#inp-art-amp-r',
        '#chk-art-filter',
        '#sel-art-filter-type',
        '#inp-art-filter-cutoff',
        '#inp-art-filter-reso',
        '#chk-art-lfo',
        '#inp-art-lfo-freq',
        '#inp-art-lfo-delay',
        '#inp-art-lfo-pitch',
      ];
      for (const sel of artSelectors) {
        this.drawerElement.querySelector(sel)?.addEventListener('change', bindArt);
      }

      // Fase 8 Master Wave promotion bindings
      const readMwConfig = (): Partial<MasterWaveConfig> => {
        const fallback =
          this.handlers.getMasterWaveConfig?.() ?? DEFAULT_MASTER_WAVE_CONFIG;
        const selMethod = this.drawerElement?.querySelector<HTMLSelectElement>('#sel-mw-method');
        const selChannels = this.drawerElement?.querySelector<HTMLSelectElement>('#sel-mw-channels');
        const inpLoopSec = this.drawerElement?.querySelector<HTMLInputElement>('#inp-mw-loop-sec');
        const chkBwe = this.drawerElement?.querySelector<HTMLInputElement>('#chk-mw-bwe');
        const chkDenoise = this.drawerElement?.querySelector<HTMLInputElement>('#chk-mw-denoise');

        const pm = selMethod?.value ?? fallback.promotionMethod;
        const cl = selChannels?.value ?? fallback.channelLayout;
        return {
          promotionMethod:
            pm === 'direct-conversion' || pm === 'ai-bridge'
              ? (pm as MasterPromotionMethod)
              : 'dsp-enhanced',
          channelLayout:
            cl === 'stereo' || cl === 'quad-surround'
              ? (cl as MasterChannelLayout)
              : 'original',
          targetSampleRate: 96000,
          targetBitDepth: 24,
          minLoopDurationSec: Math.max(
            0,
            Math.min(30, parseFloat(inpLoopSec?.value ?? String(fallback.minLoopDurationSec)) || 0)
          ),
          enableBandwidthExtension: Boolean(chkBwe ? chkBwe.checked : fallback.enableBandwidthExtension),
          enableDenoiseGate: Boolean(chkDenoise ? chkDenoise.checked : fallback.enableDenoiseGate),
        };
      };

      this.drawerElement
        .querySelector('#btn-promote-zone-mw')
        ?.addEventListener('click', () => {
          this.handlers.onPromoteZoneToMasterWave?.(z.id, readMwConfig());
        });

      this.drawerElement
        .querySelector('#btn-promote-zone-mw-reg')
        ?.addEventListener('click', () => {
          this.handlers.onPromoteZoneToMasterWave?.(z.id, readMwConfig());
        });

      this.drawerElement
        .querySelector('#btn-promote-all-mw')
        ?.addEventListener('click', () => {
          this.handlers.onPromoteAllZonesToMasterWave?.(readMwConfig());
        });

      this.drawerElement
        .querySelector('#btn-reprocess-purest')
        ?.addEventListener('click', () => {
          this.handlers.onReprocessFromPurestSource?.();
        });

      this.drawerElement
        .querySelector('#btn-export-time-capsule')
        ?.addEventListener('click', () => {
          this.handlers.onExportTimeCapsule?.();
        });

      this.bindDrawerMetadataEvents();
    }
  }

  private bindDrawerMetadataEvents(): void {
    if (!this.drawerElement) return;

    const getMeta = (): ExtendedModelMetadata => {
      return this.handlers.getExtendedMetadata?.() ?? {};
    };

    const updateMeta = (changes: Partial<ExtendedModelMetadata>) => {
      const cur = getMeta();
      const updated: ExtendedModelMetadata = {
        ...cur,
        ...changes,
      };
      this.handlers.onUpdateExtendedMetadata?.(updated);
    };

    const authorInp = this.drawerElement.querySelector('#drawer-meta-inp-author') as HTMLInputElement | null;
    authorInp?.addEventListener('input', () => {
      updateMeta({ author: authorInp.value.trim() });
    });

    const versionInp = this.drawerElement.querySelector('#drawer-meta-inp-version') as HTMLInputElement | null;
    versionInp?.addEventListener('input', () => {
      updateMeta({ version: versionInp.value.trim() });
    });

    const licenseInp = this.drawerElement.querySelector('#drawer-meta-inp-license') as HTMLInputElement | null;
    licenseInp?.addEventListener('input', () => {
      updateMeta({ license: licenseInp.value.trim() });
    });

    const urlInp = this.drawerElement.querySelector('#drawer-meta-inp-source-url') as HTMLInputElement | null;
    urlInp?.addEventListener('input', () => {
      updateMeta({ sourceUrl: urlInp.value.trim() });
    });

    const descInp = this.drawerElement.querySelector('#drawer-meta-inp-description') as HTMLTextAreaElement | null;
    descInp?.addEventListener('input', () => {
      updateMeta({ description: descInp.value.trim() });
    });

    this.drawerElement.querySelector('#btn-drawer-add-meta-tag')?.addEventListener('click', () => {
      const cur = getMeta();
      const attrs = [...(cur.customAttributes ?? [])];
      attrs.push({ tag: '', value: '' });
      updateMeta({ customAttributes: attrs });
      this.renderDrawer();
    });

    this.drawerElement.querySelectorAll<HTMLSelectElement>('.sel-drawer-meta-tag').forEach((sel) => {
      sel.addEventListener('change', () => {
        const idx = parseInt(sel.dataset.index ?? '-1', 10);
        const cur = getMeta();
        const attrs = [...(cur.customAttributes ?? [])];
        if (idx >= 0 && attrs[idx]) {
          const selectedVal = sel.value;
          if (selectedVal === '__custom__') {
            attrs[idx].tag = '';
          } else {
            attrs[idx].tag = selectedVal;
          }
          updateMeta({ customAttributes: attrs });
          this.renderDrawer();
        }
      });
    });

    this.drawerElement.querySelectorAll<HTMLInputElement>('.inp-drawer-meta-tag').forEach((inp) => {
      inp.addEventListener('input', () => {
        const idx = parseInt(inp.dataset.index ?? '-1', 10);
        const cur = getMeta();
        const attrs = [...(cur.customAttributes ?? [])];
        if (idx >= 0 && attrs[idx]) {
          attrs[idx].tag = inp.value;
          updateMeta({ customAttributes: attrs });
        }
      });
    });

    this.drawerElement.querySelectorAll<HTMLInputElement>('.inp-drawer-meta-val').forEach((inp) => {
      inp.addEventListener('input', () => {
        const idx = parseInt(inp.dataset.index ?? '-1', 10);
        const cur = getMeta();
        const attrs = [...(cur.customAttributes ?? [])];
        if (idx >= 0 && attrs[idx]) {
          attrs[idx].value = inp.value;
          updateMeta({ customAttributes: attrs });
        }
      });
    });

    this.drawerElement.querySelectorAll<HTMLButtonElement>('.btn-drawer-remove-meta-tag').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index ?? '-1', 10);
        const cur = getMeta();
        const attrs = [...(cur.customAttributes ?? [])];
        if (idx >= 0 && idx < attrs.length) {
          attrs.splice(idx, 1);
          updateMeta({ customAttributes: attrs });
          this.renderDrawer();
        }
      });
    });
  }

  private drawDrawerPreviewWaveform(): void {
    if (!this.drawerElement) return;
    const canvas = this.drawerElement.querySelector('#drawer-preview-waveform-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const isExtended = this.workingMode === 'extended';
    const activeReg = isExtended ? this.getExtendedContext().activeRegion : null;
    const d =
      this.handlers.getLoopEditorData?.(this.currentZone?.id, activeReg?.id) ??
      null;

    const rect = canvas.getBoundingClientRect();
    const width = Math.max(300, Math.floor(rect.width || 560));
    const height = Math.max(50, Math.floor(rect.height || 64));
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    const themeBg = getThemeColor('--color-panel-surface', '#151f2e');
    const themeMuted = getThemeColor('--color-text-muted', '#7e9bb5');
    const themeAccent = getThemeColor('--color-accent', '#00c3ff');
    const themeWarning = getThemeColor('--color-warning', '#ffaa00');
    const themeAccentRgb = getThemeColor('--color-accent-rgb', '0, 195, 255');
    const themeMono = getThemeColor('--font-mono', 'monospace');

    // Background
    ctx.fillStyle = themeBg;
    ctx.fillRect(0, 0, width, height);

    if (!d || !d.monoPcm || d.monoPcm.length === 0) {
      ctx.fillStyle = themeMuted;
      ctx.font = `11px ${themeMono}`;
      ctx.fillText('No sample audio buffer loaded', 14, height * 0.55);
      ctx.restore();
      return;
    }

    // Grid center line
    const centerY = height * 0.5;
    ctx.strokeStyle = `rgba(${themeAccentRgb}, 0.15)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(width, centerY);
    ctx.stroke();

    // Loop region highlight if loop exists
    if (d.loopEnd > d.loopStart && d.totalFrames > 0) {
      const loopStartX = (d.loopStart / d.totalFrames) * width;
      const loopEndX = (d.loopEnd / d.totalFrames) * width;
      ctx.fillStyle = `rgba(${themeAccentRgb}, 0.14)`;
      ctx.fillRect(loopStartX, 0, loopEndX - loopStartX, height);

      // Loop start line
      ctx.strokeStyle = themeAccent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(loopStartX, 0);
      ctx.lineTo(loopStartX, height);
      ctx.stroke();

      // Loop end line
      ctx.strokeStyle = themeWarning;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(loopEndX, 0);
      ctx.lineTo(loopEndX, height);
      ctx.stroke();
    }

    // Waveform envelope
    const numPoints = Math.min(width, 400);
    const env = computeZoomedWaveformEnvelope(d.monoPcm, 0, d.totalFrames, numPoints);
    const ampScale = height * 0.44;

    // Draw gradient waveform bars / fill
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, `rgba(${themeAccentRgb}, 0.45)`);
    grad.addColorStop(0.5, `rgba(${themeAccentRgb}, 0.8)`);
    grad.addColorStop(1, `rgba(${themeAccentRgb}, 1)`);

    ctx.fillStyle = grad;
    const stepX = width / numPoints;
    for (let i = 0; i < numPoints; i++) {
      const x = i * stepX;
      const maxVal = env.max[i] ?? 0;
      const minVal = env.min[i] ?? 0;
      const topY = centerY - maxVal * ampScale;
      const botY = centerY - minVal * ampScale;
      const barH = Math.max(1.5, botY - topY);
      ctx.fillRect(x, topY, Math.max(1, stepX - 0.5), barH);
    }

    ctx.restore();
  }

}
