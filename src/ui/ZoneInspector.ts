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
  AutoLoopAlgorithm,
  CommonPlaybackDefaults,
  CrossfadeCurve,
  ExtendedRegion,
  LoopMode,
  MasterChannelLayout,
  MasterPromotionMethod,
  MasterWaveConfig,
  ModelProvenance,
  SynthArticulationConfig,
  TriggerMode,
  WorkingMode,
  Zone,
  ZoneLoopEditorData,
} from '../core/types';
import {
  analyzeClassicZoneOverlaps,
  analyzeExtendedIntersections,
  createDefaultCommonPlayback,
} from '../core/extendedAdapter';
import { DEFAULT_MASTER_WAVE_CONFIG } from '../core/dsp/MasterWaveEnhancer';
import {
  computeLoopSeamAnalysis,
  computeZoomedWaveformEnvelope,
  findSmartAutoLoop,
  snapFrameToRisingZeroCrossing,
} from '../core/dsp/LoopEditorTools';
import { clamp } from '../core/dsp/DspMath';
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
  getZoneSampleFormatInfo?: (zoneId: string) => {
    sampleName: string;
    sampleRate: number;
    bitsPerSample: number;
    numChannels: number;
    durationSec: number;
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
}

function basenameOf(samplePath: string | null | undefined): string {
  if (!samplePath) return '';
  return samplePath.split(/[\\/]/).pop() || samplePath;
}

function formatRegionModeBadge(reg: ExtendedRegion): string {
  const loopLabel =
    reg.loopMode === 'loop_continuous'
      ? 'Loop'
      : reg.loopMode === 'loop_sustain'
        ? 'Sustain'
        : reg.loopMode === 'one_shot'
          ? 'One-Shot'
          : 'No Loop';
  const keytrackTag =
    reg.pitchKeytrack !== undefined && reg.pitchKeytrack !== 100
      ? ` • Key ${reg.pitchKeytrack}%`
      : '';
  const trigTag =
    reg.trigger && reg.trigger !== 'attack'
      ? ` • ${reg.trigger.charAt(0).toUpperCase() + reg.trigger.slice(1)}`
      : '';
  return `${loopLabel}${keytrackTag}${trigTag}`;
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
  private activeDrawerScope: 'region' | 'model' = 'region';
  /** Sub-pill inside 'region' scope: 'general' (Keys, Vel, Sample, Knobs) vs 'loop-acoustic' (Loop points, Exceptions, Acoustic) */
  private activeRegionSubTab: 'general' | 'loop-acoustic' = 'general';
  /** Sub-pill inside 'model' scope: 'common-playback' | 'articulation' | 'master' | 'capsule' */
  private activeModelSubTab: 'common-playback' | 'articulation' | 'master' | 'capsule' = 'common-playback';
  private detuneKnob: Knob | null = null;
  private volumeKnob: Knob | null = null;
  private panKnob: Knob | null = null;
  private isDraggingKnob: boolean = false;
  /** Fase 13: Embedded Interactive Waveform Loop Editor state inside Drawer */
  private drawerLoopData: ZoneLoopEditorData | null = null;
  private drawerLoopSnapZeroCrossing: boolean = true;
  private drawerLoopSelectedAlgo: AutoLoopAlgorithm = 'pitch_periodic';
  private drawerLoopZoomFactor: number = 1.0;
  private drawerLoopViewCenterNorm: number = 0.5;
  private draggingDrawerLoopHandle: 'start' | 'end' | null = null;
  /** Active row ID currently being auditioned in the table (classic zone ID or extended region ID) */
  private playingRowId: string | null = null;
  private playingRowStartedAt: number = 0;
  private auditionCheckTimer: number | null = null;

  constructor(
    container: HTMLElement,
    handlers: ZoneInspectorHandlers,
    drawerMount?: HTMLElement
  ) {
    this.container = container;
    this.handlers = handlers;
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

  public openDrawer(
    scope?: 'region' | 'model',
    regSubTab?: 'general' | 'loop-acoustic'
  ): void {
    if (scope) {
      this.activeDrawerScope = scope;
    }
    if (regSubTab) {
      this.activeRegionSubTab = regSubTab;
    }
    this.drawerLoopData = null;
    this.isDrawerOpen = true;
    this.drawerElement?.classList.remove('is-closed');
    this.renderDrawer();
  }

  public openLoopEditorDrawer(regionId?: string): void {
    if (regionId) {
      this.selectedRegionId = regionId;
    }
    this.openDrawer('region', 'loop-acoustic');
  }

  public openModelCommonDrawer(): void {
    this.openDrawer('model');
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

  private findZoneIdForRegion(reg: ExtendedRegion): string {
    const zMatch =
      this.allZones.find(
        (z) =>
          (z.sampleLow === reg.sampleName || z.sampleHigh === reg.sampleName) &&
          z.lowKey <= reg.highKey &&
          z.highKey >= reg.lowKey
      ) ??
      this.allZones.find(
        (z) => z.lowKey <= reg.highKey && z.highKey >= reg.lowKey
      ) ??
      this.currentZone;
    return zMatch?.id ?? '';
  }

  public setZone(
    zone: Zone | null,
    index: number,
    total: number,
    allZones?: Zone[],
    workingMode?: WorkingMode
  ): void {
    const modeChanged = workingMode !== undefined && workingMode !== this.workingMode;
    if (workingMode !== undefined) {
      this.workingMode = workingMode;
      if (this.workingMode !== 'extended') {
        this.activeDrawerScope = 'region';
      }
    }
    const sameZone = this.currentZone && zone && this.currentZone.id === zone.id;
    if (!sameZone) {
      this.drawerLoopData = null;
    }
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
      ((activeEl &&
        this.drawerElement &&
        this.drawerElement.contains(activeEl)) ||
        this.isDraggingKnob ||
        this.draggingDrawerLoopHandle !== null)
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
          if (dispLow) dispLow.textContent = midiNoteToString(activeRegion.lowKey);
          if (dispRoot) dispRoot.textContent = midiNoteToString(activeRegion.rootKey);
          if (dispHigh) dispHigh.textContent = midiNoteToString(activeRegion.highKey);
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
            cells[2].textContent = midiNoteToString(activeRegion.rootKey);
            cells[3].textContent = midiNoteToString(activeRegion.highKey);
            cells[4].innerHTML = `<span class="cell-vel-tag">${activeRegion.lowVel}</span>`;
            cells[5].innerHTML = `<span class="cell-vel-tag">${activeRegion.highVel}</span>`;
            cells[6].innerHTML = sampleBase
              ? `<span class="cell-sample-name">${sampleBase}</span>`
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
      if (dispLow) dispLow.textContent = midiNoteToString(z.lowKey);
      if (dispRoot) dispRoot.textContent = midiNoteToString(z.rootKey);
      if (dispHigh) dispHigh.textContent = midiNoteToString(z.highKey);

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
        cells[2].textContent = midiNoteToString(z.rootKey);
        cells[3].textContent = midiNoteToString(z.highKey);
        cells[4].innerHTML = lowVelName
          ? `<span class="cell-vel-tag">1–${hasHigh ? rowSplit - 1 : 127}</span> <span class="cell-sample-name">${lowVelName}</span>`
          : `<span class="cell-empty-dash">—</span>`;
        cells[5].innerHTML = highVelName
          ? `<span class="cell-vel-tag">${rowSplit}–127</span> <span class="cell-sample-name">${highVelName}</span>`
          : `<span class="cell-empty-dash">—</span>`;
        cells[6].textContent = detuneToString(z.detune);
        cells[7].textContent = volumeToLongString(z.volume);
        cells[8].textContent = panToString(z.pan);
      }
    }
  }

  private renderZoneTableRows(zones: Zone[], activeId: string): string {
    const overlaps = analyzeClassicZoneOverlaps(zones);
    return zones
      .map((zone, idx) => {
        const isSelected = zone.id === activeId;
        const lowKeyStr = midiNoteToString(zone.lowKey);
        const rootKeyStr = midiNoteToString(zone.rootKey);
        const highKeyStr = midiNoteToString(zone.highKey);
        const lowVelName = basenameOf(zone.sampleLow);
        const highVelName = basenameOf(zone.sampleHigh);
        const hasHigh = Boolean(highVelName);
        const zoneSplit = Math.max(2, Math.min(127, zone.velSplit ?? 64));
        const detuneStr = detuneToString(zone.detune);
        const volumeStr = volumeToLongString(zone.volume);
        const panStr = panToString(zone.pan);

        const peerOverlaps = overlaps[zone.id]?.overlappingZones ?? [];
        const hasOverlap = peerOverlaps.length > 0;
        const overlapTip = hasOverlap
          ? `Key range overlaps with Zone(s) ${peerOverlaps.map((p) => `#${p.index}`).join(', ')}`
          : '';

        const lowVelHtml = lowVelName
          ? `<span class="cell-vel-tag">1–${hasHigh ? zoneSplit - 1 : 127}</span> <span class="cell-sample-name">${lowVelName}</span>`
          : `<span class="cell-empty-dash">—</span>`;
        const highVelHtml = highVelName
          ? `<span class="cell-vel-tag">${zoneSplit}–127</span> <span class="cell-sample-name">${highVelName}</span>`
          : `<span class="cell-empty-dash">—</span>`;

        const isCurrentPlaying = this.playingRowId === zone.id;

        return `
          <tr class="zone-table-row ${isSelected ? 'is-selected' : ''} ${hasOverlap ? 'has-region-intersection' : ''}" data-zone-id="${zone.id}">
            <td class="col-zone" title="${overlapTip}">${hasOverlap ? `<span class="cell-overlap-icon">${ICONS.alert}</span>` : ''}${idx + 1}</td>
            <td class="col-key ${hasOverlap ? 'is-overlap-cell' : ''}" title="${overlapTip}">${lowKeyStr}</td>
            <td class="col-key is-root">${rootKeyStr}</td>
            <td class="col-key ${hasOverlap ? 'is-overlap-cell' : ''}" title="${overlapTip}">${highKeyStr}</td>
            <td class="col-sample ${lowVelName ? 'has-sample' : 'is-empty'}" data-vel-layer="low" title="${zone.sampleLow ? `Vel 1..${hasHigh ? zoneSplit - 1 : 127}: ${zone.sampleLow}` : 'No Low Vel sample'}">${lowVelHtml}</td>
            <td class="col-sample ${highVelName ? 'has-sample' : 'is-empty'}" data-vel-layer="high" title="${zone.sampleHigh ? `Vel ${zoneSplit}..127: ${zone.sampleHigh}` : 'No High Vel sample (Low Vel covers 1..127)'}">${highVelHtml}</td>
            <td class="col-num">${detuneStr}</td>
            <td class="col-num">${volumeStr}</td>
            <td class="col-num">${panStr}</td>
            <td class="col-edit">
              <button type="button" class="btn-row-play ${isCurrentPlaying ? 'is-playing' : ''}" data-play-zone-id="${zone.id}" data-play-row-id="${zone.id}" title="${isCurrentPlaying ? 'Stop auditioning' : `Audition Zone #${idx + 1} (Loop, Volume, Pan, Detune)`}">
                ${isCurrentPlaying ? ICONS.stop : ICONS.play}
              </button>
              <button type="button" class="btn-row-edit" data-edit-zone-id="${zone.id}" title="Edit Zone #${idx + 1} Metadata (Keys, Samples, Detune, Volume, Pan)">
                ${ICONS.settings}
              </button>
            </td>
          </tr>
        `;
      })
      .join('');
  }

  private renderExtendedRegionTableRows(
    regions: ExtendedRegion[],
    activeRegionId: string
  ): string {
    const extReport = analyzeExtendedIntersections(regions);
    return regions
      .map((reg, idx) => {
        const isSelected = reg.id === activeRegionId;
        const lowKeyStr = midiNoteToString(reg.lowKey);
        const rootKeyStr = midiNoteToString(reg.rootKey);
        const highKeyStr = midiNoteToString(reg.highKey);
        const sampleName = basenameOf(reg.sampleName);
        const modeBadge = formatRegionModeBadge(reg);
        const detuneStr = detuneToString(reg.detune);
        const volumeStr = volumeToLongString(reg.volume);
        const panStr = panToString(reg.pan);
        const mappedZoneId = this.findZoneIdForRegion(reg);

        const ovInfo = extReport.byRegionId[reg.id];
        const fullPeers = ovInfo?.fullIntersections ?? [];
        const keyOnlyPeers = ovInfo?.keyOnlyOverlaps ?? [];
        const hasFullIntersect = fullPeers.length > 0;
        const hasKeySplitOverlap = !hasFullIntersect && keyOnlyPeers.length > 0;
        const hasException = Boolean(reg.hasPlaybackOverride || reg.hasArticulationOverride);

        const fullIntersectTip = hasFullIntersect
          ? `Key & Velocity Intersection with ${fullPeers
              .map(
                (p) =>
                  `Region #${p.index} (Keys ${midiToNoteName(p.overlapLowKey)}..${midiToNoteName(p.overlapHighKey)}, Vel ${p.overlapLowVel}..${p.overlapHighVel})`
              )
              .join('; ')}`
          : '';
        const keySplitTip = hasKeySplitOverlap
          ? `Shared Key Range (Velocity Layer Split) with ${keyOnlyPeers
              .map((p) => `Region #${p.index} (Vel ${p.lowVel}..${p.highVel})`)
              .join('; ')}`
          : '';
        const keyCellClass = hasFullIntersect
          ? 'is-overlap-cell'
          : hasKeySplitOverlap
            ? 'is-key-layer-cell'
            : '';
        const velCellClass = hasFullIntersect ? 'is-overlap-cell' : '';

        const sampleHtml = sampleName
          ? `<span class="cell-sample-name">${sampleName}</span>`
          : `<span class="cell-empty-dash">—</span>`;

        const ovrBadgeHtml = hasException
          ? `<span class="cell-ovr-badge" title="Custom Exception active in Region #${idx + 1} (overrides Model Common settings)">OVR</span>`
          : '';

        const isCurrentPlaying = this.playingRowId === reg.id;

        return `
          <tr class="zone-table-row ${isSelected ? 'is-selected' : ''} ${hasFullIntersect ? 'has-region-intersection' : ''}" data-region-id="${reg.id}" data-zone-id="${mappedZoneId}">
            <td class="col-zone" title="${fullIntersectTip || keySplitTip || `Region #${idx + 1}`}">${hasFullIntersect ? `<span class="cell-overlap-icon" title="${fullIntersectTip}">${ICONS.alert}</span>` : hasKeySplitOverlap ? `<span class="cell-layer-icon" title="${keySplitTip}">${ICONS.layers}</span>` : ''}${idx + 1}</td>
            <td class="col-key ${keyCellClass}" title="${fullIntersectTip || keySplitTip}">${lowKeyStr}</td>
            <td class="col-key is-root">${rootKeyStr}</td>
            <td class="col-key ${keyCellClass}" title="${fullIntersectTip || keySplitTip}">${highKeyStr}</td>
            <td class="col-vel ${velCellClass}" title="${fullIntersectTip || `Start Velocity (1..127)`}"><span class="cell-vel-tag ${hasFullIntersect ? 'is-overlap-tag' : ''}">${reg.lowVel}</span></td>
            <td class="col-vel ${velCellClass}" title="${fullIntersectTip || `End Velocity (1..127)`}"><span class="cell-vel-tag ${hasFullIntersect ? 'is-overlap-tag' : ''}">${reg.highVel}</span></td>
            <td class="col-sample ${sampleName ? 'has-sample' : 'is-empty'}" title="${reg.sampleName ? `${reg.sampleName} (Keys ${lowKeyStr}..${highKeyStr}, Vel ${reg.lowVel}..${reg.highVel})` : 'Empty Region — Browse or drop a WAV/AIFF sample'}">${sampleHtml}</td>
            <td class="col-mode">
              <button type="button" class="btn-cell-loop" data-loop-region-id="${reg.id}" title="Click to open Interactive Waveform Loop Editor for Region #${idx + 1} (${hasException ? 'Custom Region Exception' : 'Inherited from Model Common'})">
                ${ICONS.wave} <span>${modeBadge}</span>${ovrBadgeHtml}
              </button>
            </td>
            <td class="col-num">${detuneStr}</td>
            <td class="col-num">${volumeStr}</td>
            <td class="col-num">${panStr}</td>
            <td class="col-edit">
              <button type="button" class="btn-row-play ${isCurrentPlaying ? 'is-playing' : ''}" data-play-region-id="${reg.id}" data-play-row-id="${reg.id}" data-play-zone-id="${mappedZoneId}" title="${isCurrentPlaying ? 'Stop auditioning' : `Audition Region #${idx + 1} (Loop, DAHDSR Envelopes, Volume, Pan, Detune)`}">
                ${isCurrentPlaying ? ICONS.stop : ICONS.play}
              </button>
              <button type="button" class="btn-row-edit" data-edit-region-id="${reg.id}" title="Edit Region #${idx + 1} Metadata (Sample, Keys, Vel, Loop &amp; Exceptions)">
                ${ICONS.settings}
              </button>
            </td>
          </tr>
        `;
      })
      .join('');
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

        this.container.innerHTML = `
          <div class="zone-inspector-panel">
            <!-- Extended Mode 2D Multi-Region Sampler Table (1 Row per Sampler Region) -->
            <div class="zone-table-card">
              <div class="zone-table-scroll" tabindex="0" role="region" aria-label="Extended 2D Sampler Regions Table">
                <table class="canonical-zone-table is-extended-table" aria-label="Extended 2D Sampler Regions Table">
                  <thead>
                    <tr>
                      <th class="col-zone" title="Sampler Region Index">Region</th>
                      <th class="col-key" title="Region Start MIDI Note (0..127)">Low Key</th>
                      <th class="col-key" title="Sample Root / Unity Pitch MIDI Note (0..127)">Root Key</th>
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
                  <span class="panel-badge">REGION #${activeIndex + 1} (${regions.length} REGIONS)</span>
                  ${intersectBadgeHtml}
                  <span class="panel-caption">${midiNoteToString(activeRegion.lowKey)} .. ${midiNoteToString(activeRegion.highKey)} | Root: ${midiNoteToString(activeRegion.rootKey)} | Vel: ${activeRegion.lowVel}..${activeRegion.highVel}${sampleTitle ? ` | ${sampleTitle}` : ' | Empty Sample'}${this.handlers.getDetectedCategory?.() ? ` • ${this.handlers.getDetectedCategory?.()}` : ''}</span>
                </div>
                <div class="panel-actions">
                  <button type="button" class="btn btn-xs btn-accent ${this.isDrawerOpen && this.activeDrawerScope === 'region' && this.activeRegionSubTab === 'loop-acoustic' ? 'is-active' : ''}" id="btn-open-loop-drawer" title="Open Interactive Waveform Loop Editor &amp; Zero-Crossing Seam Magnifier for Region #${activeIndex + 1}">
                    ${ICONS.wave} Loop Editor
                  </button>
                  <button type="button" class="btn btn-xs btn-outline ${this.isSpectralVisible ? 'is-active' : ''}" id="btn-toggle-spectral" title="Toggle Spectral &amp; A/B/C Resynthesis Inspector (Shortcut: Ctrl+E)">
                    ${ICONS.wave} Spectral / A-B
                  </button>
                  <button type="button" class="btn btn-xs btn-outline" id="btn-open-zone-drawer" title="Edit Selected Region #${activeIndex + 1} (Particular Sample, Keys, Velocity, Loop Points &amp; Region Exceptions)">
                    ${ICONS.settings} Edit Region #${activeIndex + 1}
                  </button>
                  <button type="button" class="btn btn-xs btn-outline" id="btn-open-model-common-drawer" title="Open Model Common &amp; Global Settings (Common Playback Defaults, Master Articulation, Master 24/96 &amp; Time Capsule)">
                    ${ICONS.sliders} Model Common &amp; Global
                  </button>
                  <button type="button" class="btn btn-xs btn-outline" id="btn-split-zone" title="Create a new empty Sampler Region at the next available Key/Velocity range">
                    ${ICONS.plus} New Region
                  </button>
                  <button type="button" class="btn btn-xs btn-danger" id="btn-delete-zone" ${!canDeleteReg ? 'disabled' : ''} title="Remove selected Sampler Region">
                    ${ICONS.trash} Remove Region
                  </button>
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

    this.container.innerHTML = `
      <div class="zone-inspector-panel">
        <!-- Canonical Hartmann MODELmaker v1.2 Zone Table (1..128 Zones Max) -->
        <div class="zone-table-card">
          <div class="zone-table-scroll" tabindex="0" role="region" aria-label="Canonical Hartmann Key Zone Table">
            <table class="canonical-zone-table" aria-label="Canonical Hartmann Key Zone Table">
              <thead>
                <tr>
                  <th class="col-zone">Zone</th>
                  <th class="col-key">Low Key</th>
                  <th class="col-key">Root Key</th>
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
              <span class="panel-badge">ZONE #${this.zoneIndex + 1} (${this.totalZones} / 128 MAX)</span>
              <span class="panel-caption">${midiNoteToString(z.lowKey)} .. ${midiNoteToString(z.highKey)} | Root: ${midiNoteToString(z.rootKey)}</span>
            </div>
            <div class="panel-actions">
              <button type="button" class="btn btn-xs btn-accent ${this.isDrawerOpen && this.activeRegionSubTab === 'loop-acoustic' ? 'is-active' : ''}" id="btn-open-loop-drawer" title="Open Interactive Waveform Loop Editor &amp; Zero-Crossing Seam Magnifier for Zone #${this.zoneIndex + 1}">
                ${ICONS.wave} Loop Editor
              </button>
              <button type="button" class="btn btn-xs btn-outline ${this.isSpectralVisible ? 'is-active' : ''}" id="btn-toggle-spectral" title="Toggle Spectral & A/B Resynthesis Inspector (Shortcut: Ctrl+E)">
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
        </div>
      </div>
    `;

    this.bindTableEvents();
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
    if (!isExtended) {
      this.activeDrawerScope = 'region';
    }
    const activeScope = isExtended ? this.activeDrawerScope : 'region';
    const regSubTab = this.activeRegionSubTab;
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

    const currentPrimarySample =
      isExtended && activeReg ? activeReg.sampleName : z.sampleLow;
    const lowOptionsHtml = [
      `<option value="">-- Select Loaded Sample --</option>`,
      ...loadedSamples.map(
        (s) =>
          `<option value="${s}" ${currentPrimarySample === s ? 'selected' : ''}>${basenameOf(s)}</option>`
      ),
    ].join('');
    const highOptionsHtml = [
      `<option value="">-- None (Low Vel covers 1..127) --</option>`,
      ...loadedSamples.map(
        (s) =>
          `<option value="${s}" ${z.sampleHigh === s ? 'selected' : ''}>${basenameOf(s)}</option>`
      ),
    ].join('');

    const effLowKey = isExtended && activeReg ? activeReg.lowKey : z.lowKey;
    const effRootKey = isExtended && activeReg ? activeReg.rootKey : z.rootKey;
    const effHighKey = isExtended && activeReg ? activeReg.highKey : z.highKey;
    const effDetune = isExtended && activeReg ? activeReg.detune : z.detune;
    const effVolume = isExtended && activeReg ? activeReg.volume : z.volume;
    const effPan = isExtended && activeReg ? activeReg.pan : z.pan;

    const regSampleLabel =
      isExtended && activeReg
        ? activeReg.sampleName
          ? basenameOf(activeReg.sampleName)
          : 'Empty Sample'
        : '';

    const drawerTitleText =
      isExtended && activeScope === 'model'
        ? `MODEL COMMON & GLOBAL EXTENDED SETTINGS (${extRegions.length} REGIONS)`
        : isExtended && activeReg
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
          <span class="drawer-icon">${ICONS.settings}</span>
          <span>${drawerTitleText}</span>
        </div>
        <button type="button" class="btn btn-close-drawer" id="btn-close-zone-drawer" title="Close Metadata Drawer">${ICONS.close}</button>
      </div>

      ${
        isExtended
          ? `
      <div class="drawer-tab-bar" role="tablist" aria-label="Extended Scope Tabs">
        <button
          type="button"
          role="tab"
          aria-selected="${activeScope === 'region'}"
          class="drawer-tab-pill ${activeScope === 'region' ? 'is-active' : ''}"
          data-drawer-scope="region"
          title="Particular parameters for Selected Region #${activeRegIdx + 1} (Key/Vel Range, Sample, Detune/Vol/Pan, Loop Points &amp; Custom Overrides)"
        >
          <span class="tab-pill-icon">${ICONS.layers}</span>
          <span>Region #${activeRegIdx + 1}: ${regSampleLabel}</span>
          ${activeReg?.hasPlaybackOverride || activeReg?.hasArticulationOverride ? '<span class="cell-ovr-badge">OVR</span>' : ''}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected="${activeScope === 'model'}"
          class="drawer-tab-pill ${activeScope === 'model' ? 'is-active' : ''}"
          data-drawer-scope="model"
          title="Common &amp; Global parameters replicated across all regions unless overridden (Common Playback, Instrument Articulation, Master 24/96 Standard, Time Capsule)"
        >
          <span class="tab-pill-icon">${ICONS.sliders}</span>
          <span>Model Common &amp; Global</span>
        </button>
      </div>
      `
          : ''
      }

      <div class="drawer-body zone-drawer-body">
        <!-- SCOPE 1: PARTICULAR REGION / CLASSIC ZONE -->
        <div class="drawer-tab-pane ${activeScope === 'region' ? 'is-active' : 'is-hidden'}" data-scope-pane="region">
          <div class="drawer-subtab-bar" role="tablist" aria-label="Region Particular Subsections">
            <button
              type="button"
              role="tab"
              aria-selected="${regSubTab === 'general'}"
              class="drawer-subtab-pill ${regSubTab === 'general' ? 'is-active' : ''}"
              data-reg-subtab="general"
              title="Region Mapping (Key &amp; Velocity Range), Sample Assignment &amp; Detune / Volume / Pan Knobs"
            >
              ${ICONS.layers} <span>Mapping &amp; Sample</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected="${regSubTab === 'loop-acoustic'}"
              class="drawer-subtab-pill ${regSubTab === 'loop-acoustic' ? 'is-active' : ''}"
              data-reg-subtab="loop-acoustic"
              title="Interactive Waveform Loop Editor, Zero-Crossing Seam Magnifier, Crossfade Widths &amp; Region Exceptions"
            >
              ${ICONS.wave} <span>${isExtended ? 'Loop Editor, Fades &amp; Exceptions' : 'Loop Editor &amp; Acoustic'}</span>
              ${activeReg?.hasPlaybackOverride || activeReg?.hasArticulationOverride ? '<span class="cell-ovr-badge">OVR</span>' : ''}
            </button>
          </div>

          <!-- REGION SUB-PANE A: Mapping, Sample & Knobs -->
          <div class="drawer-subtab-pane ${regSubTab === 'general' ? 'is-active' : 'is-hidden'}" data-reg-subpane="general">
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
              <div class="keys-inputs-row">
                <div class="form-group">
                  <label for="inp-low-key">LOW KEY</label>
                  <div class="input-with-note">
                    <input type="number" id="inp-low-key" min="${isExtended ? 0 : minLowKey}" max="${isExtended ? 127 : maxLowKey}" value="${effLowKey}" ${!isExtended && !prevZone ? 'disabled title="First zone always starts at 0 C-2 in Classic Mode"' : ''} />
                    <span class="note-display" id="disp-low-note">${midiNoteToString(effLowKey)}</span>
                  </div>
                </div>

                <div class="form-group is-highlight">
                  <label for="inp-root-key">ROOT KEY</label>
                  <div class="input-with-note">
                    <input type="number" id="inp-root-key" min="0" max="127" value="${effRootKey}" />
                    <span class="note-display" id="disp-root-note">${midiNoteToString(effRootKey)}</span>
                  </div>
                </div>

                <div class="form-group">
                  <label for="inp-high-key">HIGH KEY</label>
                  <div class="input-with-note">
                    <input type="number" id="inp-high-key" min="${isExtended ? 0 : minHighKey}" max="${isExtended ? 127 : maxHighKey}" value="${effHighKey}" ${!isExtended && !nextZone ? 'disabled title="Last zone always ends at 127 G8 in Classic Mode"' : ''} />
                    <span class="note-display" id="disp-high-note">${midiNoteToString(effHighKey)}</span>
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
          </div>

          <!-- REGION SUB-PANE B: Interactive Waveform Loop Editor, Exceptions & Sample Acoustic -->
          <div class="drawer-subtab-pane ${regSubTab === 'loop-acoustic' ? 'is-active' : 'is-hidden'}" data-reg-subpane="loop-acoustic">
            ${this.renderRegionLoopAndExceptionsHtml(z, activeReg)}
          </div>
        </div>

        <!-- SCOPE 2: MODEL COMMON & GLOBAL SETTINGS (Extended Only) -->
        ${
          isExtended
            ? `<div class="drawer-tab-pane ${activeScope === 'model' ? 'is-active' : 'is-hidden'}" data-scope-pane="model">
                ${this.renderModelCommonSectionsHtml(z, extRegions)}
              </div>`
            : ''
        }
      </div>
    `;

    this.bindDrawerEvents();
    if (regSubTab === 'loop-acoustic') {
      requestAnimationFrame(() => this.drawDrawerLoopCanvas());
    }
  }

  private ensureDrawerLoopData(zoneId?: string, regionId?: string): ZoneLoopEditorData | null {
    if (!this.drawerLoopData) {
      this.drawerLoopData =
        this.handlers.getLoopEditorData?.(
          zoneId ?? this.currentZone?.id,
          regionId ?? this.selectedRegionId ?? undefined
        ) ?? null;
    }
    return this.drawerLoopData;
  }

  private renderRegionLoopAndExceptionsHtml(
    z: Zone,
    activeReg: ExtendedRegion | null
  ): string {
    const commonPb =
      this.handlers.getCommonPlayback?.() ?? createDefaultCommonPlayback();
    const globalArt = this.handlers.getArticulation?.();
    const cls = this.handlers.getZoneClassification?.(z.id);
    const detectedCat =
      cls?.detectedCategory ??
      this.handlers.getDetectedCategory?.() ??
      'Synth & Neutral';

    const hasPbOvr = Boolean(activeReg?.hasPlaybackOverride);
    const hasArtOvr = Boolean(activeReg?.hasArticulationOverride);

    const loopData = this.ensureDrawerLoopData(z.id, activeReg?.id);
    const sr = Math.max(1, loopData?.sampleRate ?? 44100);
    const totalFrames = Math.max(2, loopData?.totalFrames ?? 44100);

    const loopMode = hasPbOvr
      ? (activeReg?.loopMode ?? loopData?.loopMode ?? commonPb.loopMode)
      : (commonPb.loopMode !== 'no_loop' ? commonPb.loopMode : (loopData?.loopMode ?? 'loop_continuous'));
    const keytrack = hasPbOvr
      ? (activeReg?.pitchKeytrack ?? commonPb.pitchKeytrack)
      : commonPb.pitchKeytrack;
    const triggerMode = hasPbOvr
      ? (activeReg?.trigger ?? commonPb.trigger)
      : commonPb.trigger;
    const fadeCurve = hasPbOvr
      ? (activeReg?.fadeCurve ?? commonPb.fadeCurve)
      : commonPb.fadeCurve;

    const loopStart =
      activeReg && activeReg.loopEnd > activeReg.loopStart
        ? activeReg.loopStart
        : (loopData?.loopStart ?? 0);
    const loopEnd =
      activeReg && activeReg.loopEnd > activeReg.loopStart
        ? activeReg.loopEnd
        : (loopData?.loopEnd ?? Math.floor(totalFrames * 0.85));
    const loopXfade = activeReg?.loopCrossfadeMs ?? loopData?.loopCrossfadeMs ?? 15;
    const keyFadeIn = activeReg?.keyFadeIn ?? 0;
    const keyFadeOut = activeReg?.keyFadeOut ?? 0;
    const velFadeIn = activeReg?.velFadeIn ?? 0;
    const velFadeOut = activeReg?.velFadeOut ?? 0;

    const startSecStr = (loopStart / sr).toFixed(3);
    const endSecStr = (loopEnd / sr).toFixed(3);
    const isPlayingLoop = Boolean(this.handlers.isAuditionPlaying?.());

    const regAmpA =
      activeReg?.ampEnvOverride?.attackSec ?? globalArt?.ampEnv.attackSec ?? 0.005;
    const regAmpD =
      activeReg?.ampEnvOverride?.decaySec ?? globalArt?.ampEnv.decaySec ?? 0.25;
    const regAmpS =
      activeReg?.ampEnvOverride?.sustainLevel ??
      globalArt?.ampEnv.sustainLevel ??
      1.0;
    const regAmpR =
      activeReg?.ampEnvOverride?.releaseSec ??
      globalArt?.ampEnv.releaseSec ??
      0.2;
    const regFltCut =
      activeReg?.filterOverride?.cutoffHz ?? globalArt?.filter.cutoffHz ?? 18000;
    const regFltReso =
      activeReg?.filterOverride?.resonanceDb ??
      globalArt?.filter.resonanceDb ??
      0;

    const fmtInfo = this.handlers.getZoneSampleFormatInfo?.(z.id) ?? null;
    const chBadge =
      fmtInfo?.numChannels === 4
        ? '4.0 Quad'
        : fmtInfo?.numChannels === 2
          ? '2.0 Stereo'
          : fmtInfo?.numChannels === 1
            ? '1.0 Mono'
            : 'Unassigned';
    const fmtBadge = fmtInfo
      ? `${(fmtInfo.sampleRate / 1000).toFixed(1)} kHz / ${fmtInfo.bitsPerSample}-bit • ${chBadge} • ${fmtInfo.durationSec.toFixed(2)}s`
      : 'No Sample Loaded';

    return `
      <!-- 1. Interactive Waveform Loop Editor, Zero-Crossing Seam Magnifier & Boundary Crossfades -->
      <div class="inspector-section section-extended-region" data-ext-region-id="${activeReg?.id ?? ''}">
        <div class="section-header-row">
          <div class="section-title">INTERACTIVE WAVEFORM LOOP EDITOR &amp; ZERO-CROSSING SEAM MAGNIFIER</div>
          <span class="val-pill" title="Current Sample Audio Format">${fmtBadge}</span>
        </div>

        <div class="drawer-loop-editor-box">
          <div class="drawer-loop-toolbar">
            <button type="button" class="btn-overlay-toggle ${this.drawerLoopSnapZeroCrossing ? 'is-on' : ''}" id="btn-drawer-loop-snap" title="Snap dragged L-START / L-END handles to nearest rising zero-crossing">
              0-X Snap: ${this.drawerLoopSnapZeroCrossing ? 'ON' : 'OFF'}
            </button>
            <label class="loop-ed-field" title="Select Auto-Loop Algorithm">
              <select id="sel-drawer-loop-algo" class="loop-ed-select">
                <option value="pitch_periodic" ${this.drawerLoopSelectedAlgo === 'pitch_periodic' ? 'selected' : ''}>F0 Period-Lock</option>
                <option value="ncc_zc" ${this.drawerLoopSelectedAlgo === 'ncc_zc' ? 'selected' : ''}>NCC Zero-Crossing</option>
                <option value="min_seam_energy" ${this.drawerLoopSelectedAlgo === 'min_seam_energy' ? 'selected' : ''}>Min Seam Discontinuity</option>
                <option value="equal_power_xfade" ${this.drawerLoopSelectedAlgo === 'equal_power_xfade' ? 'selected' : ''}>Equal-Power X-Fade</option>
              </select>
            </label>
            <button type="button" class="btn-overlay-toggle is-action-accent" id="btn-drawer-loop-autofind" title="Automatically find optimal click-free loop points using the selected algorithm">
              ${ICONS.cpu} Run Auto-Loop
            </button>
            <button type="button" class="btn-overlay-toggle" id="btn-drawer-loop-zoom-in" title="Zoom In Waveform around Loop Region">
              Zoom +
            </button>
            <button type="button" class="btn-overlay-toggle" id="btn-drawer-loop-zoom-reset" title="Reset Waveform Zoom (1x)">
              1x
            </button>
            <button type="button" class="btn btn-xs btn-accent" id="btn-drawer-loop-play" title="Audition sample in continuous hardware loop (updates live while dragging L-START / L-END)">
              ${isPlayingLoop ? `■ Stop Loop` : `${ICONS.play} Loop Play`}
            </button>
          </div>
          <div class="drawer-loop-canvas-wrap">
            <canvas id="drawer-loop-canvas" class="drawer-loop-canvas" width="680" height="190"></canvas>
          </div>
          <div class="drawer-loop-hint">
            Drag <strong>L-START</strong> or <strong>L-END</strong> handles (or double-click waveform) • Right pane shows <strong>Zero-Crossing Seam Magnifier</strong> (±64 samples)
          </div>
        </div>

        <div class="drawer-grid-3" style="margin-top: 8px;">
          <div class="form-group">
            <div class="label-with-val">
              <label for="inp-ext-loop-start">LOOP START (FRAMES)</label>
              <span class="val-pill" id="lbl-drawer-loop-start-sec">${startSecStr}s</span>
            </div>
            <input type="number" id="inp-ext-loop-start" class="drawer-input" min="0" max="${Math.max(0, totalFrames - 2)}" value="${loopStart}" />
          </div>
          <div class="form-group">
            <div class="label-with-val">
              <label for="inp-ext-loop-end">LOOP END (FRAMES)</label>
              <span class="val-pill" id="lbl-drawer-loop-end-sec">${endSecStr}s</span>
            </div>
            <input type="number" id="inp-ext-loop-end" class="drawer-input" min="1" max="${totalFrames}" value="${loopEnd}" />
          </div>
          <div class="form-group">
            <div class="label-with-val">
              <label for="inp-ext-loop-xfade">LOOP XFADE (MS)</label>
              <span class="val-pill">Equal-Power</span>
            </div>
            <input type="number" id="inp-ext-loop-xfade" class="drawer-input" min="0" max="5000" value="${loopXfade}" />
          </div>
        </div>

        <div class="drawer-grid-2" style="margin-top: 8px;">
          <div class="form-group">
            <label for="inp-ext-key-fade-in">KEY XFADE IN / OUT (SEMITONES)</label>
            <div class="drawer-pair-inputs">
              <input type="number" id="inp-ext-key-fade-in" class="drawer-input" min="0" max="64" value="${keyFadeIn}" title="Key Crossfade In (semitones)" />
              <input type="number" id="inp-ext-key-fade-out" class="drawer-input" min="0" max="64" value="${keyFadeOut}" title="Key Crossfade Out (semitones)" />
            </div>
          </div>
          <div class="form-group">
            <label for="inp-ext-vel-fade-in">VEL XFADE IN / OUT (VELOCITY UNITS)</label>
            <div class="drawer-pair-inputs">
              <input type="number" id="inp-ext-vel-fade-in" class="drawer-input" min="0" max="127" value="${velFadeIn}" title="Velocity Crossfade In" />
              <input type="number" id="inp-ext-vel-fade-out" class="drawer-input" min="0" max="127" value="${velFadeOut}" title="Velocity Crossfade Out" />
            </div>
          </div>
        </div>
      </div>

      <!-- 2. Playback Rules: Inherited from Model Common vs Custom Region Exception -->
      <div class="inspector-section">
        <div class="inheritance-card ${hasPbOvr ? 'is-overridden' : 'is-inherited'}">
          <div class="inheritance-card-header">
            <div class="inheritance-status">
              <span class="inheritance-badge ${hasPbOvr ? 'is-override' : 'is-common'}">
                ${hasPbOvr ? 'CUSTOM EXCEPTION (OVR)' : 'INHERITED FROM MODEL COMMON'}
              </span>
              <span class="inheritance-desc">
                ${
                  hasPbOvr
                    ? 'This region uses custom playback rules instead of Model Common.'
                    : 'Replicated from Model Common. Toggle Custom Exception to override only for this region.'
                }
              </span>
            </div>
            <div class="inheritance-actions">
              <label class="articulation-toggle-label" title="Enable custom Loop Mode, Keytrack, Trigger &amp; XFade Curve exception for this region">
                <input type="checkbox" class="articulation-checkbox" id="chk-reg-playback-override" ${hasPbOvr ? 'checked' : ''} />
                <span>Custom Exception</span>
              </label>
              <button type="button" class="btn btn-xs btn-ghost" id="btn-goto-model-common-pb" title="Edit Model Common Playback Defaults for all regions">
                Edit Common &rarr;
              </button>
            </div>
          </div>

          <div class="drawer-grid-4 ${hasPbOvr ? '' : 'is-inherited-disabled'}">
            <div class="form-group">
              <label for="sel-ext-loop-mode">LOOP MODE</label>
              <select id="sel-ext-loop-mode" class="drawer-select" ${hasPbOvr ? '' : 'disabled'}>
                <option value="no_loop" ${loopMode === 'no_loop' ? 'selected' : ''}>No Loop</option>
                <option value="loop_continuous" ${loopMode === 'loop_continuous' ? 'selected' : ''}>Continuous (Forward)</option>
                <option value="ping_pong" ${loopMode === 'ping_pong' ? 'selected' : ''}>Ping-Pong (⇄ Alternating)</option>
                <option value="loop_sustain" ${loopMode === 'loop_sustain' ? 'selected' : ''}>Sustain Loop</option>
                <option value="loop_backward" ${loopMode === 'loop_backward' ? 'selected' : ''}>Reverse Loop</option>
                <option value="one_shot" ${loopMode === 'one_shot' ? 'selected' : ''}>One Shot</option>
              </select>
            </div>
            <div class="form-group">
              <label for="inp-ext-keytrack">KEYTRACK (%)</label>
              <input type="number" id="inp-ext-keytrack" class="drawer-input" min="0" max="100" value="${keytrack}" ${hasPbOvr ? '' : 'disabled'} title="100% = Chromatic, 0% = Unpitched/Drum" />
            </div>
            <div class="form-group">
              <label for="sel-ext-trigger">TRIGGER</label>
              <select id="sel-ext-trigger" class="drawer-select" ${hasPbOvr ? '' : 'disabled'}>
                <option value="attack" ${triggerMode === 'attack' ? 'selected' : ''}>Attack</option>
                <option value="release" ${triggerMode === 'release' ? 'selected' : ''}>Release</option>
                <option value="first" ${triggerMode === 'first' ? 'selected' : ''}>First Note</option>
                <option value="legato" ${triggerMode === 'legato' ? 'selected' : ''}>Legato</option>
              </select>
            </div>
            <div class="form-group">
              <label for="sel-ext-fade-curve">XFADE CURVE</label>
              <select id="sel-ext-fade-curve" class="drawer-select" ${hasPbOvr ? '' : 'disabled'}>
                <option value="equal-power" ${fadeCurve === 'equal-power' ? 'selected' : ''}>Equal Power</option>
                <option value="linear" ${fadeCurve === 'linear' ? 'selected' : ''}>Linear</option>
                <option value="spectral-morph" ${fadeCurve === 'spectral-morph' ? 'selected' : ''}>Spectral Morph</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <!-- 3. Articulation Exception: Inherited from Global Instrument Articulation vs Custom Region ADSR/Filter -->
      <div class="inspector-section">
        <div class="inheritance-card ${hasArtOvr ? 'is-overridden' : 'is-inherited'}">
          <div class="inheritance-card-header">
            <div class="inheritance-status">
              <span class="inheritance-badge ${hasArtOvr ? 'is-override' : 'is-common'}">
                ${hasArtOvr ? 'CUSTOM ARTICULATION EXCEPTION' : 'INHERITED FROM MODEL ARTICULATION'}
              </span>
              <span class="inheritance-desc">
                ${
                  hasArtOvr
                    ? 'Custom per-region ADSR / Filter active for this sample.'
                    : 'Uses global Instrument Articulation (ADSR, Silver Filter, LFO).'
                }
              </span>
            </div>
            <div class="inheritance-actions">
              <label class="articulation-toggle-label" title="Override ADSR Envelope &amp; Filter Cutoff/Reso specifically for this region">
                <input type="checkbox" class="articulation-checkbox" id="chk-reg-art-override" ${hasArtOvr ? 'checked' : ''} />
                <span>Custom ADSR / Filter</span>
              </label>
              <button type="button" class="btn btn-xs btn-ghost" id="btn-goto-model-common-art" title="Open Global Instrument Articulation">
                Edit Global &rarr;
              </button>
            </div>
          </div>

          ${
            hasArtOvr
              ? `
          <div class="drawer-grid-4">
            <div class="form-group">
              <label for="inp-reg-amp-a">ATTACK (S)</label>
              <input type="number" id="inp-reg-amp-a" class="drawer-input" min="0" max="12" step="0.01" value="${regAmpA}" />
            </div>
            <div class="form-group">
              <label for="inp-reg-amp-d">DECAY (S)</label>
              <input type="number" id="inp-reg-amp-d" class="drawer-input" min="0" max="15" step="0.01" value="${regAmpD}" />
            </div>
            <div class="form-group">
              <label for="inp-reg-amp-s">SUSTAIN (0..1)</label>
              <input type="number" id="inp-reg-amp-s" class="drawer-input" min="0" max="1" step="0.05" value="${regAmpS}" />
            </div>
            <div class="form-group">
              <label for="inp-reg-amp-r">RELEASE (S)</label>
              <input type="number" id="inp-reg-amp-r" class="drawer-input" min="0" max="15" step="0.01" value="${regAmpR}" />
            </div>
          </div>
          <div class="drawer-grid-2" style="margin-top: 6px;">
            <div class="form-group">
              <label for="inp-reg-flt-cut">REGION FILTER CUTOFF (HZ)</label>
              <input type="number" id="inp-reg-flt-cut" class="drawer-input" min="20" max="20000" step="10" value="${regFltCut}" />
            </div>
            <div class="form-group">
              <label for="inp-reg-flt-reso">REGION FILTER RESO (DB)</label>
              <input type="number" id="inp-reg-flt-reso" class="drawer-input" min="0" max="40" step="0.5" value="${regFltReso}" />
            </div>
          </div>
          `
              : ''
          }
        </div>
      </div>

      <!-- 4. Sample Acoustic Intelligence & Per-Sample 24/96 Action -->
      <div class="inspector-section section-acoustic-intel">
        <div class="section-header-row">
          <div class="section-title">SAMPLE ACOUSTIC INTELLIGENCE &amp; 24/96 PROMOTION</div>
          <div class="section-header-row">
            <button type="button" class="btn btn-xs btn-outline" id="btn-promote-zone-mw-reg" title="Promote this sample to 24-bit / 96.000 Hz Master Wave using the Model Common 24/96 standard">
              ${ICONS.wave} Promote This Sample (24b/96k)
            </button>
            <button type="button" class="btn btn-xs btn-accent" id="btn-auto-detect-zone-ext" title="Run YIN/MPM + HPS Pitch Detection &amp; Acoustic Parameter Set Classifier">
              ${ICONS.cpu} Auto-Detect Pitch &amp; Set
            </button>
          </div>
        </div>
        <div class="acoustic-intel-grid">
          <div class="acoustic-stat-chip">
            <span class="stat-chip-lbl">INSTRUMENT CATEGORY</span>
            <span class="stat-chip-val is-accent">${detectedCat}</span>
          </div>
          <div class="acoustic-stat-chip">
            <span class="stat-chip-lbl">RECOMMENDED SET</span>
            <span class="stat-chip-val">Set ${cls ? cls.recommendedParameterSet : 'Auto'} ${cls ? `(${Math.round(cls.confidence * 100)}%)` : ''}</span>
          </div>
          <div class="acoustic-stat-chip">
            <span class="stat-chip-lbl">DETECTED PITCH (F0)</span>
            <span class="stat-chip-val">${cls ? `${cls.descriptors.detectedF0Hz.toFixed(1)} Hz (${midiNoteToString(cls.descriptors.detectedMidiNote)})` : midiNoteToString(activeReg?.rootKey ?? z.rootKey)}</span>
          </div>
          <div class="acoustic-stat-chip">
            <span class="stat-chip-lbl">HARMONICITY / TYPE</span>
            <span class="stat-chip-val">${cls ? `${Math.round(cls.descriptors.harmonicity * 100)}% • ${cls.descriptors.isPercussiveOrNoise ? 'Perc/Noise' : 'Harmonic'}` : 'Harmonic'}</span>
          </div>
          <div class="acoustic-stat-chip">
            <span class="stat-chip-lbl">ATTACK / SUSTAIN</span>
            <span class="stat-chip-val">${cls ? `${cls.descriptors.attackMs} ms • ${Math.round(cls.descriptors.sustainRatio * 100)}%` : '—'}</span>
          </div>
          <div class="acoustic-stat-chip">
            <span class="stat-chip-lbl">STIFFNESS (B) / CENTROID</span>
            <span class="stat-chip-val">${cls ? `${cls.descriptors.inharmonicityB.toFixed(4)} • ${cls.descriptors.spectralCentroidHz} Hz` : '—'}</span>
          </div>
        </div>
        ${cls?.rationale ? `<div class="acoustic-rationale-banner">${cls.rationale}</div>` : ''}
      </div>
    `;
  }

  private renderModelCommonSectionsHtml(
    z: Zone,
    extRegions: ExtendedRegion[]
  ): string {
    const subTab = this.activeModelSubTab;
    const commonPb =
      this.handlers.getCommonPlayback?.() ?? createDefaultCommonPlayback();
    const pbOverrideCount = extRegions.filter((r) => r.hasPlaybackOverride).length;
    const artOverrideCount = extRegions.filter((r) => r.hasArticulationOverride).length;

    const art = this.handlers.getArticulation?.();
    const mwCfg = this.handlers.getMasterWaveConfig?.() ?? DEFAULT_MASTER_WAVE_CONFIG;
    const fmtInfo = this.handlers.getZoneSampleFormatInfo?.(z.id) ?? null;
    const chBadge =
      fmtInfo?.numChannels === 4
        ? '4.0 Quad Surround'
        : fmtInfo?.numChannels === 2
          ? '2.0 Stereo'
          : fmtInfo?.numChannels === 1
            ? '1.0 Mono'
            : 'Unassigned';
    const fmtBadge = fmtInfo
      ? `${(fmtInfo.sampleRate / 1000).toFixed(1)} kHz / ${fmtInfo.bitsPerSample}-bit • ${chBadge} • ${fmtInfo.durationSec.toFixed(2)}s`
      : 'No Sample Loaded';

    const prov = this.handlers.getModelProvenance?.() ?? null;
    const diag = this.handlers.getAssetStoreDiagnostics?.() ?? null;
    const primaryLabel =
      prov?.primarySourceLayer === '02_legacy_original'
        ? '02_legacy_original (.scape/.sphere)'
        : '01_raw_source (Lossless WAV)';
    const activeLabel = prov?.activeAnalysisSourceLayer ?? '01_raw_source';
    const reprocessCnt = prov?.reprocessCount ?? 0;
    const storeKb = diag ? Math.round(diag.totalBytes / 1024) : 0;
    const storeBadge = diag
      ? `${diag.backend === 'indexeddb' ? 'IndexedDB' : 'Memory'} • ${storeKb} KB (${prov?.presentLayers.length ?? 0}/5 layers)`
      : '5-Layer Container';
    const layerList: Array<{
      id: '01_raw_source' | '02_legacy_original' | '03_enhanced_audio' | '04_classic_enhanced' | '05_extended_model';
      label: string;
    }> = [
      { id: '01_raw_source', label: '01 Raw Source' },
      { id: '02_legacy_original', label: '02 Legacy Orig' },
      { id: '03_enhanced_audio', label: '03 Master 24/96' },
      { id: '04_classic_enhanced', label: '04 Classic Enh' },
      { id: '05_extended_model', label: '05 Extended Mod' },
    ];

    return `
      <!-- Sub-navigation pills inside Model Common & Global Tab -->
      <div class="drawer-subtab-bar" role="tablist" aria-label="Model Common &amp; Global Subsections">
        <button
          type="button"
          role="tab"
          aria-selected="${subTab === 'common-playback'}"
          class="drawer-subtab-pill ${subTab === 'common-playback' ? 'is-active' : ''}"
          data-model-subtab="common-playback"
          title="Common Playback Defaults replicated across all regions unless a region enables Custom Exception"
        >
          ${ICONS.layers} <span>Common Playback</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected="${subTab === 'articulation'}"
          class="drawer-subtab-pill ${subTab === 'articulation' ? 'is-active' : ''}"
          data-model-subtab="articulation"
          title="Global Instrument Synth Articulation (ADSR Envelope, Silver Filter &amp; Isolated LFO)"
        >
          ${ICONS.sliders} <span>Instrument Articulation</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected="${subTab === 'master'}"
          class="drawer-subtab-pill ${subTab === 'master' ? 'is-active' : ''}"
          data-model-subtab="master"
          title="Model-Wide Master Wave 24-bit / 96 kHz Promotion Standard, Loop Expansion &amp; Quad Surround"
        >
          ${ICONS.wave} <span>Master 24/96 Standard</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected="${subTab === 'capsule'}"
          class="drawer-subtab-pill ${subTab === 'capsule' ? 'is-active' : ''}"
          data-model-subtab="capsule"
          title="5-Layer Time Capsule Container &amp; Zero Generation-Loss Lineage"
        >
          ${ICONS.database} <span>Time Capsule</span>
        </button>
      </div>

      <!-- MODEL SUB-PANE 1: Common Playback Defaults -->
      <div class="drawer-subtab-pane ${subTab === 'common-playback' ? 'is-active' : 'is-hidden'}" data-model-subpane="common-playback">
        <div class="inspector-section">
          <div class="section-header-row">
            <div class="section-title">COMMON PLAYBACK DEFAULTS (REPLICATED TO ALL REGIONS)</div>
            <span class="val-pill">
              ${extRegions.length - pbOverrideCount}/${extRegions.length} inheriting${pbOverrideCount > 0 ? ` • ${pbOverrideCount} OVR` : ''}
            </span>
          </div>
          <div class="articulation-card is-enabled">
            <div class="articulation-card-header">
              <span class="stat-chip-lbl">
                Changes here automatically apply to all regions except those marked with a custom exception (OVR).
              </span>
              ${
                pbOverrideCount > 0
                  ? `<button type="button" class="btn btn-xs btn-outline" id="btn-reset-all-pb-overrides" title="Clear all regional playback exceptions so every region inherits Model Common">
                      Reset ${pbOverrideCount} Exception(s) to Common
                    </button>`
                  : ''
              }
            </div>
            <div class="drawer-grid-4">
              <div class="form-group">
                <label for="sel-common-loop-mode">DEFAULT LOOP MODE</label>
                <select id="sel-common-loop-mode" class="drawer-select">
                  <option value="no_loop" ${commonPb.loopMode === 'no_loop' ? 'selected' : ''}>No Loop</option>
                  <option value="loop_continuous" ${commonPb.loopMode === 'loop_continuous' ? 'selected' : ''}>Continuous (Forward)</option>
                  <option value="ping_pong" ${commonPb.loopMode === 'ping_pong' ? 'selected' : ''}>Ping-Pong (⇄ Alternating)</option>
                  <option value="loop_sustain" ${commonPb.loopMode === 'loop_sustain' ? 'selected' : ''}>Sustain Loop</option>
                  <option value="loop_backward" ${commonPb.loopMode === 'loop_backward' ? 'selected' : ''}>Reverse Loop</option>
                  <option value="one_shot" ${commonPb.loopMode === 'one_shot' ? 'selected' : ''}>One Shot</option>
                </select>
              </div>
              <div class="form-group">
                <label for="inp-common-keytrack">DEFAULT KEYTRACK (%)</label>
                <input type="number" id="inp-common-keytrack" class="drawer-input" min="0" max="100" value="${commonPb.pitchKeytrack}" title="100% = Chromatic instrument, 0% = Unpitched/Drum kit" />
              </div>
              <div class="form-group">
                <label for="sel-common-trigger">DEFAULT TRIGGER</label>
                <select id="sel-common-trigger" class="drawer-select">
                  <option value="attack" ${commonPb.trigger === 'attack' ? 'selected' : ''}>Attack</option>
                  <option value="release" ${commonPb.trigger === 'release' ? 'selected' : ''}>Release</option>
                  <option value="first" ${commonPb.trigger === 'first' ? 'selected' : ''}>First Note</option>
                  <option value="legato" ${commonPb.trigger === 'legato' ? 'selected' : ''}>Legato</option>
                </select>
              </div>
              <div class="form-group">
                <label for="sel-common-fade-curve">DEFAULT XFADE CURVE</label>
                <select id="sel-common-fade-curve" class="drawer-select">
                  <option value="equal-power" ${commonPb.fadeCurve === 'equal-power' ? 'selected' : ''}>Equal Power</option>
                  <option value="linear" ${commonPb.fadeCurve === 'linear' ? 'selected' : ''}>Linear</option>
                  <option value="spectral-morph" ${commonPb.fadeCurve === 'spectral-morph' ? 'selected' : ''}>Spectral Morph</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- MODEL SUB-PANE 2: Global Instrument Articulation (ADSR, Filter, LFO) -->
      <div class="drawer-subtab-pane ${subTab === 'articulation' ? 'is-active' : 'is-hidden'}" data-model-subpane="articulation">
        ${
          art
            ? `
        <div class="inspector-section section-articulation">
          <div class="section-header-row">
            <div class="section-title">INSTRUMENT SYNTH ARTICULATION (ADSR / FILTER / LFO &rarr; SAFE SOUND.SCRIPT)</div>
            <span class="val-pill">${extRegions.length - artOverrideCount}/${extRegions.length} inheriting</span>
          </div>

          <!-- Amp Envelope -->
          <div class="articulation-card ${art.ampEnvEnabled ? 'is-enabled' : ''}">
            <div class="articulation-card-header">
              <label class="articulation-toggle-label">
                <input type="checkbox" class="articulation-checkbox" id="chk-art-amp-env" ${art.ampEnvEnabled ? 'checked' : ''} />
                <span>Export Amp Envelope (DAHDSR &rarr; R1AmpEnvA/D/S/R)</span>
              </label>
              <label class="articulation-sub-toggle" title="Bake amplitude decay contour into classic wave before analysis">
                <input type="checkbox" class="articulation-checkbox" id="chk-art-bake-env" ${art.bakeEnvelopeIntoWave ? 'checked' : ''} />
                <span>Bake ADSR</span>
              </label>
            </div>
            <div class="drawer-grid-4">
              <div class="form-group">
                <label for="inp-art-amp-a">ATTACK (S)</label>
                <input type="number" id="inp-art-amp-a" class="drawer-input" min="0" max="12" step="0.01" value="${art.ampEnv.attackSec}" />
              </div>
              <div class="form-group">
                <label for="inp-art-amp-d">DECAY (S)</label>
                <input type="number" id="inp-art-amp-d" class="drawer-input" min="0" max="15" step="0.01" value="${art.ampEnv.decaySec}" />
              </div>
              <div class="form-group">
                <label for="inp-art-amp-s">SUSTAIN (0..1)</label>
                <input type="number" id="inp-art-amp-s" class="drawer-input" min="0" max="1" step="0.05" value="${art.ampEnv.sustainLevel}" />
              </div>
              <div class="form-group">
                <label for="inp-art-amp-r">RELEASE (S)</label>
                <input type="number" id="inp-art-amp-r" class="drawer-input" min="0" max="15" step="0.01" value="${art.ampEnv.releaseSec}" />
              </div>
            </div>
          </div>

          <!-- Filter -->
          <div class="articulation-card ${art.filter.enabled ? 'is-enabled' : ''}">
            <div class="articulation-card-header">
              <label class="articulation-toggle-label">
                <input type="checkbox" class="articulation-checkbox" id="chk-art-filter" ${art.filter.enabled ? 'checked' : ''} />
                <span>Export Filter (Silver Filter Cutoff / Reso / Env)</span>
              </label>
            </div>
            <div class="drawer-grid-3">
              <div class="form-group">
                <label for="sel-art-filter-type">TYPE</label>
                <select id="sel-art-filter-type" class="drawer-select">
                  <option value="lpf" ${art.filter.type === 'lpf' ? 'selected' : ''}>LPF (Low-Pass)</option>
                  <option value="bpf" ${art.filter.type === 'bpf' ? 'selected' : ''}>BPF (Band-Pass)</option>
                  <option value="hpf" ${art.filter.type === 'hpf' ? 'selected' : ''}>HPF (High-Pass)</option>
                </select>
              </div>
              <div class="form-group">
                <label for="inp-art-filter-cutoff">CUTOFF (HZ)</label>
                <input type="number" id="inp-art-filter-cutoff" class="drawer-input" min="20" max="20000" step="10" value="${art.filter.cutoffHz}" />
              </div>
              <div class="form-group">
                <label for="inp-art-filter-reso">RESO (DB)</label>
                <input type="number" id="inp-art-filter-reso" class="drawer-input" min="0" max="40" step="0.5" value="${art.filter.resonanceDb}" />
              </div>
            </div>
          </div>

          <!-- Vibrato / Mod LFO -->
          <div class="articulation-card ${art.vibLfo.enabled ? 'is-enabled' : ''}">
            <div class="articulation-card-header">
              <label class="articulation-toggle-label" title="Safe-mapped: Scape, Sphere & Blender LFO depths are explicitly locked to 0 so LFO never causes unwanted spectral morphing">
                <input type="checkbox" class="articulation-checkbox" id="chk-art-lfo" ${art.vibLfo.enabled ? 'checked' : ''} />
                <span>Export LFO (Isolated Pitch / Filter / Amp &mdash; Scape/Sphere Zeroed)</span>
              </label>
            </div>
            <div class="drawer-grid-3">
              <div class="form-group">
                <label for="inp-art-lfo-freq">RATE (HZ)</label>
                <input type="number" id="inp-art-lfo-freq" class="drawer-input" min="0.05" max="30" step="0.1" value="${art.vibLfo.freqHz}" />
              </div>
              <div class="form-group">
                <label for="inp-art-lfo-delay">DELAY (S)</label>
                <input type="number" id="inp-art-lfo-delay" class="drawer-input" min="0" max="10" step="0.05" value="${art.vibLfo.delaySec}" />
              </div>
              <div class="form-group">
                <label for="inp-art-lfo-pitch">PITCH (CENTS)</label>
                <input type="number" id="inp-art-lfo-pitch" class="drawer-input" min="-1200" max="1200" step="5" value="${art.vibLfo.toPitchCents}" />
              </div>
            </div>
          </div>
        </div>`
            : ''
        }
      </div>

      <!-- MODEL SUB-PANE 3: Master Wave 24-bit / 96 kHz Standard -->
      <div class="drawer-subtab-pane ${subTab === 'master' ? 'is-active' : 'is-hidden'}" data-model-subpane="master">
        <div class="inspector-section">
          <div class="section-header-row">
            <div class="section-title">MODEL-WIDE MASTER WAVE STANDARD (24-BIT / 96 KHZ &amp; SURROUND)</div>
            <span class="val-pill" title="Current Selected Sample Format">${fmtBadge}</span>
          </div>
          <div class="articulation-card is-enabled">
            <div class="drawer-grid-3">
              <div class="form-group">
                <label for="sel-mw-method" title="Selects how audio is promoted to 24-bit / 96.000 Hz Master Wave across the instrument">PROMOTION ENGINE (MODEL STANDARD)</label>
                <select id="sel-mw-method" class="drawer-select">
                  <option value="direct-conversion" ${mwCfg.promotionMethod === 'direct-conversion' ? 'selected' : ''}>Direct (Sinc 96k / 24b)</option>
                  <option value="dsp-enhanced" ${mwCfg.promotionMethod === 'dsp-enhanced' ? 'selected' : ''}>DSP Enhanced (BWE + DeNoise)</option>
                  <option value="ai-bridge" ${mwCfg.promotionMethod === 'ai-bridge' ? 'selected' : ''}>AI Bridge (AudioSR/BigVGAN)</option>
                </select>
              </div>
              <div class="form-group">
                <label for="sel-mw-channels" title="Preserve original channels or expand instrument to Stereo 2.0 or Quad Surround 4.0">SPATIAL CHANNELS</label>
                <select id="sel-mw-channels" class="drawer-select">
                  <option value="original" ${mwCfg.channelLayout === 'original' ? 'selected' : ''}>Original Channels</option>
                  <option value="stereo" ${mwCfg.channelLayout === 'stereo' ? 'selected' : ''}>Stereo 2.0 (Mono-Safe)</option>
                  <option value="quad-surround" ${mwCfg.channelLayout === 'quad-surround' ? 'selected' : ''}>Quad Surround 4.0 (Neuron)</option>
                </select>
              </div>
              <div class="form-group">
                <label for="inp-mw-loop-sec" title="Unroll short SF2/WAV loops to X seconds with organic modulation & zero-crossing Auto-Loop Finder (0 = keep original length)">MIN LOOP DURATION (S)</label>
                <input type="number" id="inp-mw-loop-sec" class="drawer-input" min="0" max="16" step="0.5" value="${mwCfg.minLoopDurationSec}" />
              </div>
            </div>
            <div class="articulation-card-header">
              <label class="articulation-sub-toggle" title="Harmonic Bandwidth Extension up to 42 kHz in 96 kHz Master Wave">
                <input type="checkbox" class="articulation-checkbox" id="chk-mw-bwe" ${mwCfg.enableBandwidthExtension ? 'checked' : ''} />
                <span>Ultrasonic BWE (42 kHz Air)</span>
              </label>
              <label class="articulation-sub-toggle" title="Suppress quantization floor noise from legacy 8/16-bit samples">
                <input type="checkbox" class="articulation-checkbox" id="chk-mw-denoise" ${mwCfg.enableDenoiseGate ? 'checked' : ''} />
                <span>Quantization De-Noise Gate</span>
              </label>
              <div class="section-header-row">
                <button type="button" class="btn btn-xs btn-outline" id="btn-promote-zone-mw" title="Promote only the currently selected sample to 24-bit / 96.000 Hz Master Wave">
                  ${ICONS.wave} Promote Selected Sample
                </button>
                <button type="button" class="btn btn-xs btn-accent" id="btn-promote-all-mw" title="Promote all samples in the model to 24-bit / 96.000 Hz Master Wave">
                  ${ICONS.layers} Promote All Samples (24b/96k)
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- MODEL SUB-PANE 4: 5-Layer Time Capsule Container & Anti-Photocopy Lineage -->
      <div class="drawer-subtab-pane ${subTab === 'capsule' ? 'is-active' : 'is-hidden'}" data-model-subpane="capsule">
        <div class="inspector-section">
          <div class="section-header-row">
            <div class="section-title">TIME CAPSULE (5-LAYER CONTAINER &amp; ANTI-PHOTOCOPY LINEAGE)</div>
            <span class="val-pill" title="NeuronAssetStore Persistence Status">${storeBadge}</span>
          </div>

          <div class="acoustic-intel-grid">
            <div class="acoustic-stat-chip is-present">
              <span class="stat-chip-lbl">PUREST ORIGIN LAYER</span>
              <span class="stat-chip-val is-accent" title="${primaryLabel}">${primaryLabel}</span>
            </div>
            <div class="acoustic-stat-chip is-present">
              <span class="stat-chip-lbl">ACTIVE ANALYSIS INPUT</span>
              <span class="stat-chip-val" title="${activeLabel}">${activeLabel}</span>
            </div>
            <div class="acoustic-stat-chip is-present">
              <span class="stat-chip-lbl">REPROCESS PASSES</span>
              <span class="stat-chip-val">${reprocessCnt} (0 Gen-Loss)</span>
            </div>
          </div>

          <div class="section-title" style="margin-top: var(--space-3);">CONTAINER LAYERS (01 .. 05)</div>
          <div class="acoustic-intel-grid">
            ${layerList
              .map((l) => {
                const st = prov?.layerStats?.[l.id];
                const kb = st ? (st.totalBytes / 1024).toFixed(1) : '0.0';
                const isPresent = Boolean(st?.present);
                return `
            <div class="acoustic-stat-chip ${isPresent ? 'is-present' : 'is-empty'}">
              <span class="stat-chip-lbl">${l.label.toUpperCase()}</span>
              <span class="stat-chip-val">${isPresent ? `${st!.fileCount} file(s) • ${kb} KB` : 'Empty (—)'}</span>
            </div>`;
              })
              .join('')}
          </div>

          <div class="articulation-card is-enabled" style="margin-top: var(--space-3);">
            <div class="articulation-card-header">
              <span class="stat-chip-lbl" title="Guarantees re-analysis always pulls from 01_raw_source or 02_legacy_original, never re-compressing 04_classic_enhanced">
                Zero Generation-Loss Lineage Active
              </span>
              <div class="section-header-row">
                <button type="button" class="btn btn-xs btn-accent" id="btn-reprocess-purest" title="Re-analyze all zones strictly from purest origin layer (01_raw_source or 02_legacy_original) with zero generation loss">
                  ${ICONS.cpu} Reprocess Purest Source
                </button>
                <button type="button" class="btn btn-xs btn-outline" id="btn-export-time-capsule" title="Export 5-Layer Multi-Format Time Capsule (.zip) with manifest.json & provenance.json">
                  ${ICONS.database} Export Time Capsule (.zip)
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
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
          if (regionChanged) {
            this.drawerLoopData = null;
          }
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
            this.openDrawer('region', 'general');
          }
          return;
        }

        if (!zoneId) return;
        if (zoneId !== z.id && this.handlers.onSelectZone) {
          this.handlers.onSelectZone(zoneId);
        }
        if (editBtn) {
          e.stopPropagation();
          this.openDrawer('region', 'general');
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
          this.openDrawer('region');
          return;
        }
        if (zoneId && zoneId !== z.id && this.handlers.onSelectZone) {
          this.handlers.onSelectZone(zoneId);
        }
        this.openDrawer('region');
      });
    });

    this.container.querySelector('#btn-open-loop-drawer')?.addEventListener('click', () => {
      if (
        this.isDrawerOpen &&
        this.activeDrawerScope === 'region' &&
        this.activeRegionSubTab === 'loop-acoustic'
      ) {
        this.closeDrawer();
      } else {
        this.openLoopEditorDrawer();
      }
    });

    this.container.querySelector('#btn-open-zone-drawer')?.addEventListener('click', () => {
      if (
        this.isDrawerOpen &&
        this.activeDrawerScope === 'region' &&
        this.activeRegionSubTab === 'general'
      ) {
        this.closeDrawer();
      } else {
        this.openDrawer('region', 'general');
      }
    });

    this.container
      .querySelector('#btn-open-model-common-drawer')
      ?.addEventListener('click', () => {
        if (this.isDrawerOpen && this.activeDrawerScope === 'model') {
          this.closeDrawer();
        } else {
          this.openDrawer('model');
        }
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

    // Top-level Scope pills ("Region #X" vs "Model Common & Global")
    const scopeBtns = this.drawerElement.querySelectorAll<HTMLButtonElement>(
      '.drawer-tab-pill[data-drawer-scope]'
    );
    scopeBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-drawer-scope') === 'model' ? 'model' : 'region';
        if (target === this.activeDrawerScope) return;
        this.activeDrawerScope = target;
        this.renderDrawer();
      });
    });

    // Sub-tab pills inside "Region #X" ("Mapping & Sample" vs "Loop, Exceptions & Acoustic")
    const regSubBtns = this.drawerElement.querySelectorAll<HTMLButtonElement>(
      '.drawer-subtab-pill[data-reg-subtab]'
    );
    regSubBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const target =
          btn.getAttribute('data-reg-subtab') === 'loop-acoustic'
            ? 'loop-acoustic'
            : 'general';
        if (target === this.activeRegionSubTab) return;
        this.activeRegionSubTab = target;
        this.renderDrawer();
      });
    });

    // Sub-tab pills inside "Model Common & Global" ("Common Playback", "Instrument Articulation", "Master 24/96 Standard", "Time Capsule")
    const modelSubBtns = this.drawerElement.querySelectorAll<HTMLButtonElement>(
      '.drawer-subtab-pill[data-model-subtab]'
    );
    modelSubBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const raw = btn.getAttribute('data-model-subtab');
        const target: 'common-playback' | 'articulation' | 'master' | 'capsule' =
          raw === 'articulation' || raw === 'master' || raw === 'capsule'
            ? raw
            : 'common-playback';
        if (target === this.activeModelSubTab) return;
        this.activeModelSubTab = target;
        this.renderDrawer();
      });
    });

    // Quick-jump links from Region inheritance cards to Model Common tabs
    this.drawerElement
      .querySelector('#btn-goto-model-common-pb')
      ?.addEventListener('click', () => {
        this.activeDrawerScope = 'model';
        this.activeModelSubTab = 'common-playback';
        this.renderDrawer();
      });

    this.drawerElement
      .querySelector('#btn-goto-model-common-art')
      ?.addEventListener('click', () => {
        this.activeDrawerScope = 'model';
        this.activeModelSubTab = 'articulation';
        this.renderDrawer();
      });

    this.drawerElement
      .querySelector('#btn-sample-card-loop')
      ?.addEventListener('click', () => {
        this.activeDrawerScope = 'region';
        this.activeRegionSubTab = 'loop-acoustic';
        this.renderDrawer();
      });

    this.drawerElement
      .querySelector('#btn-open-loop-editor')
      ?.addEventListener('click', () => {
        this.handlers.onOpenLoopEditor?.();
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

    inpLow?.addEventListener('change', () => {
      const val = Math.min(127, Math.max(0, parseInt(inpLow.value, 10) || 0));
      if (isExtended && activeReg && this.handlers.onUpdateExtendedRegion) {
        this.handlers.onUpdateExtendedRegion(activeReg.id, { lowKey: val });
      } else {
        this.handlers.onUpdateZone(z.id, { lowKey: val });
      }
    });

    inpRoot?.addEventListener('change', () => {
      const parsed = parseInt(inpRoot.value, 10);
      const fallback = isExtended && activeReg ? activeReg.rootKey : z.rootKey;
      const val = Math.min(127, Math.max(0, Number.isNaN(parsed) ? fallback : parsed));
      if (isExtended && activeReg && this.handlers.onUpdateExtendedRegion) {
        this.handlers.onUpdateExtendedRegion(activeReg.id, { rootKey: val });
      } else {
        this.handlers.onUpdateZone(z.id, { rootKey: val });
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
      const sampleToPlay = isExtended && activeReg ? activeReg.sampleName : z.sampleLow;
      if (sampleToPlay) this.handlers.onAuditionSample(sampleToPlay);
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
    }

    this.bindDrawerLoopEditorEvents(z, activeReg);
  }

  private getDrawerLoopViewWindow(totalFrames: number): { viewStart: number; viewEnd: number } {
    const zoom = clamp(this.drawerLoopZoomFactor, 1, 32);
    const span = Math.max(64, Math.round(totalFrames / zoom));
    const half = Math.floor(span * 0.5);
    const center = Math.round(clamp(this.drawerLoopViewCenterNorm, 0, 1) * totalFrames);
    const viewStart = clamp(center - half, 0, Math.max(0, totalFrames - span));
    const viewEnd = clamp(viewStart + span, viewStart + 1, totalFrames);
    return { viewStart, viewEnd };
  }

  private syncDrawerLoopInputs(d: ZoneLoopEditorData): void {
    if (!this.drawerElement) return;
    const sr = Math.max(1, d.sampleRate);
    const inpStart = this.drawerElement.querySelector('#inp-ext-loop-start') as HTMLInputElement | null;
    const inpEnd = this.drawerElement.querySelector('#inp-ext-loop-end') as HTMLInputElement | null;
    const lblStart = this.drawerElement.querySelector('#lbl-drawer-loop-start-sec');
    const lblEnd = this.drawerElement.querySelector('#lbl-drawer-loop-end-sec');
    if (inpStart && document.activeElement !== inpStart) inpStart.value = String(d.loopStart);
    if (inpEnd && document.activeElement !== inpEnd) inpEnd.value = String(d.loopEnd);
    if (lblStart) lblStart.textContent = `${(d.loopStart / sr).toFixed(3)}s`;
    if (lblEnd) lblEnd.textContent = `${(d.loopEnd / sr).toFixed(3)}s`;
  }

  private bindDrawerLoopEditorEvents(z: Zone, activeReg: ExtendedRegion | null): void {
    if (!this.drawerElement) return;
    const extRegionId = activeReg?.id ?? '';

    const persistLoopToRegion = (changes: Partial<ExtendedRegion>) => {
      if (extRegionId && this.handlers.onUpdateExtendedRegion) {
        this.handlers.onUpdateExtendedRegion(extRegionId, changes);
      }
    };

    this.drawerElement.querySelector('#btn-drawer-loop-snap')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.drawerLoopSnapZeroCrossing = !this.drawerLoopSnapZeroCrossing;
      const btn = this.drawerElement?.querySelector('#btn-drawer-loop-snap');
      if (btn) {
        btn.classList.toggle('is-on', this.drawerLoopSnapZeroCrossing);
        btn.textContent = `0-X Snap: ${this.drawerLoopSnapZeroCrossing ? 'ON' : 'OFF'}`;
      }
      this.drawDrawerLoopCanvas();
    });

    this.drawerElement.querySelector('#sel-drawer-loop-algo')?.addEventListener('change', (e) => {
      this.drawerLoopSelectedAlgo = (e.target as HTMLSelectElement).value as AutoLoopAlgorithm;
    });

    this.drawerElement.querySelector('#btn-drawer-loop-autofind')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const d = this.ensureDrawerLoopData(z.id, activeReg?.id);
      if (!d) return;
      const candStart = d.loopStart > 0 ? d.loopStart : Math.floor(d.totalFrames * 0.2);
      const candEnd = d.loopEnd > candStart + 64 ? d.loopEnd : Math.floor(d.totalFrames * 0.85);
      const knownF0 = d.rootKey ? 440 * Math.pow(2, (d.rootKey - 69) / 12) : undefined;
      const opt = findSmartAutoLoop(d.monoPcm, d.sampleRate, {
        algorithm: this.drawerLoopSelectedAlgo,
        candidateStartFrame: candStart,
        candidateEndFrame: candEnd,
        knownF0Hz: knownF0,
        targetCrossfadeMs: d.loopCrossfadeMs > 0 ? d.loopCrossfadeMs : 20,
      });
      d.loopStart = opt.loopStart;
      d.loopEnd = opt.loopEnd;
      d.loopCrossfadeMs = opt.loopCrossfadeMs;
      if (d.loopMode === 'no_loop') {
        d.loopMode = 'loop_continuous';
      }
      this.syncDrawerLoopInputs(d);
      this.drawDrawerLoopCanvas();
      this.handlers.onUpdateLiveLoopPoints?.(d.loopStart, d.loopEnd, d.sampleRate, true);
      persistLoopToRegion({
        hasPlaybackOverride: true,
        loopMode: d.loopMode,
        loopStart: d.loopStart,
        loopEnd: d.loopEnd,
        loopCrossfadeMs: d.loopCrossfadeMs,
      });
    });

    this.drawerElement.querySelector('#btn-drawer-loop-zoom-in')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const d = this.ensureDrawerLoopData(z.id, activeReg?.id);
      if (d) {
        this.drawerLoopViewCenterNorm = ((d.loopStart + d.loopEnd) * 0.5) / Math.max(1, d.totalFrames);
      }
      this.drawerLoopZoomFactor = this.drawerLoopZoomFactor >= 16 ? 1 : this.drawerLoopZoomFactor * 2;
      this.drawDrawerLoopCanvas();
    });

    this.drawerElement.querySelector('#btn-drawer-loop-zoom-reset')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.drawerLoopZoomFactor = 1.0;
      this.drawerLoopViewCenterNorm = 0.5;
      this.drawDrawerLoopCanvas();
    });

    this.drawerElement.querySelector('#btn-drawer-loop-play')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const playBtn = this.drawerElement?.querySelector('#btn-drawer-loop-play');
      const isPlaying = Boolean(this.handlers.isAuditionPlaying?.());
      if (isPlaying) {
        this.handlers.onStopAudition?.();
        if (playBtn) playBtn.innerHTML = `${ICONS.play} Loop Play`;
        return;
      }
      const d = this.ensureDrawerLoopData(z.id, activeReg?.id);
      if (!d) return;
      if (d.loopEnd <= d.loopStart) {
        d.loopStart = Math.floor(d.totalFrames * 0.2);
        d.loopEnd = Math.max(d.loopStart + 1, Math.floor(d.totalFrames * 0.85));
      }
      if (d.loopMode === 'no_loop') {
        d.loopMode = 'loop_continuous';
      }
      this.syncDrawerLoopInputs(d);
      persistLoopToRegion({
        hasPlaybackOverride: true,
        loopMode: d.loopMode,
        loopStart: d.loopStart,
        loopEnd: d.loopEnd,
      });
      this.handlers.onAuditionLoop?.({
        zoneId: z.id,
        regionId: activeReg?.id,
        loopStartFrame: d.loopStart,
        loopEndFrame: d.loopEnd,
        loopEnabled: true,
      });
      if (playBtn) playBtn.innerHTML = `■ Stop Loop`;
      this.drawDrawerLoopCanvas();
    });

    // Also update canvas & live audio when #inp-ext-loop-start, #inp-ext-loop-end, or #inp-ext-loop-xfade are edited
    const inpLoopStart = this.drawerElement.querySelector('#inp-ext-loop-start') as HTMLInputElement | null;
    const inpLoopEnd = this.drawerElement.querySelector('#inp-ext-loop-end') as HTMLInputElement | null;
    const inpLoopXfade = this.drawerElement.querySelector('#inp-ext-loop-xfade') as HTMLInputElement | null;

    inpLoopStart?.addEventListener('input', () => {
      const d = this.ensureDrawerLoopData(z.id, activeReg?.id);
      if (!d) return;
      d.loopStart = clamp(parseInt(inpLoopStart.value, 10) || 0, 0, Math.max(0, d.loopEnd - 1));
      this.syncDrawerLoopInputs(d);
      this.handlers.onUpdateLiveLoopPoints?.(d.loopStart, d.loopEnd, d.sampleRate, true);
      this.drawDrawerLoopCanvas();
    });

    inpLoopEnd?.addEventListener('input', () => {
      const d = this.ensureDrawerLoopData(z.id, activeReg?.id);
      if (!d) return;
      d.loopEnd = clamp(parseInt(inpLoopEnd.value, 10) || d.totalFrames, d.loopStart + 1, d.totalFrames);
      this.syncDrawerLoopInputs(d);
      this.handlers.onUpdateLiveLoopPoints?.(d.loopStart, d.loopEnd, d.sampleRate, true);
      this.drawDrawerLoopCanvas();
    });

    inpLoopXfade?.addEventListener('input', () => {
      const d = this.ensureDrawerLoopData(z.id, activeReg?.id);
      if (!d) return;
      d.loopCrossfadeMs = clamp(parseInt(inpLoopXfade.value, 10) || 0, 0, 5000);
      this.drawDrawerLoopCanvas();
    });

    // Interactive pointer drag, double-click & wheel zoom on #drawer-loop-canvas
    const canvasEl = this.drawerElement.querySelector('#drawer-loop-canvas') as HTMLCanvasElement | null;
    if (!canvasEl) return;

    const getMetrics = (clientX: number) => {
      const rect = canvasEl.getBoundingClientRect();
      const waveW = rect.width * 0.68;
      const relX = clientX - rect.left;
      const normX = clamp(relX / Math.max(1, waveW), 0, 1);
      return { rect, waveW, relX, normX };
    };

    const applyDraggedFrame = (d: ZoneLoopEditorData, rawFrame: number) => {
      const minGap = Math.max(16, Math.round(d.sampleRate * 0.005));
      if (this.draggingDrawerLoopHandle === 'start') {
        let f = clamp(rawFrame, 0, Math.max(0, d.loopEnd - minGap));
        if (this.drawerLoopSnapZeroCrossing) {
          f = clamp(snapFrameToRisingZeroCrossing(d.monoPcm, f, 256), 0, Math.max(0, d.loopEnd - minGap));
        }
        d.loopStart = f;
      } else if (this.draggingDrawerLoopHandle === 'end') {
        let f = clamp(rawFrame, d.loopStart + minGap, d.totalFrames);
        if (this.drawerLoopSnapZeroCrossing) {
          f = clamp(snapFrameToRisingZeroCrossing(d.monoPcm, f, 256), d.loopStart + minGap, d.totalFrames);
        }
        d.loopEnd = f;
      }
      this.syncDrawerLoopInputs(d);
      this.handlers.onUpdateLiveLoopPoints?.(
        d.loopStart,
        d.loopEnd,
        d.sampleRate,
        d.loopMode !== 'no_loop' && d.loopMode !== 'one_shot'
      );
      this.drawDrawerLoopCanvas();
    };

    canvasEl.addEventListener('pointerdown', (e) => {
      const d = this.ensureDrawerLoopData(z.id, activeReg?.id);
      if (!d) return;
      const { waveW, relX } = getMetrics(e.clientX);
      if (relX > waveW) return;

      const { viewStart, viewEnd } = this.getDrawerLoopViewWindow(d.totalFrames);
      const viewSpan = Math.max(1, viewEnd - viewStart);
      const startX = ((d.loopStart - viewStart) / viewSpan) * waveW;
      const endX = ((d.loopEnd - viewStart) / viewSpan) * waveW;
      const distStart = Math.abs(relX - startX);
      const distEnd = Math.abs(relX - endX);

      if (distStart <= 20 && distStart <= distEnd) {
        this.draggingDrawerLoopHandle = 'start';
        canvasEl.setPointerCapture(e.pointerId);
      } else if (distEnd <= 20) {
        this.draggingDrawerLoopHandle = 'end';
        canvasEl.setPointerCapture(e.pointerId);
      }
    });

    canvasEl.addEventListener('dblclick', (e) => {
      const d = this.ensureDrawerLoopData(z.id, activeReg?.id);
      if (!d) return;
      const { waveW, relX, normX } = getMetrics(e.clientX);
      if (relX > waveW) return;
      const { viewStart, viewEnd } = this.getDrawerLoopViewWindow(d.totalFrames);
      const viewSpan = Math.max(1, viewEnd - viewStart);
      const startX = ((d.loopStart - viewStart) / viewSpan) * waveW;
      const endX = ((d.loopEnd - viewStart) / viewSpan) * waveW;
      this.draggingDrawerLoopHandle = Math.abs(relX - startX) <= Math.abs(relX - endX) ? 'start' : 'end';
      const targetFrame = Math.round(viewStart + normX * viewSpan);
      applyDraggedFrame(d, targetFrame);
      this.draggingDrawerLoopHandle = null;
      persistLoopToRegion({ loopStart: d.loopStart, loopEnd: d.loopEnd });
    });

    canvasEl.addEventListener('pointermove', (e) => {
      if (!this.draggingDrawerLoopHandle) return;
      const d = this.ensureDrawerLoopData(z.id, activeReg?.id);
      if (!d) return;
      const { normX } = getMetrics(e.clientX);
      const { viewStart, viewEnd } = this.getDrawerLoopViewWindow(d.totalFrames);
      const targetFrame = Math.round(viewStart + normX * Math.max(1, viewEnd - viewStart));
      applyDraggedFrame(d, targetFrame);
    });

    const finishDrag = (e: PointerEvent) => {
      if (!this.draggingDrawerLoopHandle) return;
      this.draggingDrawerLoopHandle = null;
      try {
        canvasEl.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      const d = this.drawerLoopData;
      if (d) {
        persistLoopToRegion({
          loopStart: d.loopStart,
          loopEnd: d.loopEnd,
        });
      }
    };

    canvasEl.addEventListener('pointerup', finishDrag);
    canvasEl.addEventListener('pointercancel', finishDrag);

    canvasEl.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const d = this.ensureDrawerLoopData(z.id, activeReg?.id);
        if (!d) return;
        const { normX } = getMetrics(e.clientX);
        const { viewStart, viewEnd } = this.getDrawerLoopViewWindow(d.totalFrames);
        const focusFrame = viewStart + normX * (viewEnd - viewStart);
        this.drawerLoopViewCenterNorm = clamp(focusFrame / Math.max(1, d.totalFrames), 0, 1);
        const factor = e.deltaY < 0 ? 1.35 : 1 / 1.35;
        this.drawerLoopZoomFactor = clamp(this.drawerLoopZoomFactor * factor, 1, 32);
        this.drawDrawerLoopCanvas();
      },
      { passive: false }
    );
  }

  private drawDrawerLoopCanvas(): void {
    if (!this.drawerElement) return;
    const canvas = this.drawerElement.querySelector('#drawer-loop-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const d = this.ensureDrawerLoopData();
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(360, Math.floor(rect.width || 680));
    const height = Math.max(150, Math.floor(rect.height || 190));
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
    }
    ctx.save();
    ctx.scale(dpr, dpr);

    const bgColor = getThemeColor('--color-panel-surface', '#151f2e');
    const origColor = getThemeColor('--color-cable-midi-in', '#06b6d4');
    const accentColor = getThemeColor('--color-accent', '#00c3ff');
    const warningColor = getThemeColor('--color-warning', '#ffaa00');
    const mutedColor = getThemeColor('--color-text-muted', '#7e9bb5');
    const borderColor = getThemeColor('--color-panel-border-strong', 'rgba(0, 195, 255, 0.45)');
    const dimGridColor = getThemeColor('--color-panel-border', 'rgba(0, 195, 255, 0.2)');

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);

    if (!d) {
      ctx.fillStyle = mutedColor;
      ctx.font = '11px monospace';
      ctx.fillText('Load a sample into this region to edit loop points', 16, height * 0.5);
      ctx.restore();
      return;
    }

    const waveW = Math.floor(width * 0.68);
    const seamX0 = waveW + 1;
    const seamW = Math.max(80, width - seamX0);

    const { viewStart, viewEnd } = this.getDrawerLoopViewWindow(d.totalFrames);
    const viewSpan = Math.max(1, viewEnd - viewStart);
    const env = computeZoomedWaveformEnvelope(
      d.monoPcm,
      viewStart,
      viewEnd,
      Math.min(420, Math.max(120, Math.floor(waveW / 2)))
    );

    const centerY = height * 0.54;
    const ampSpan = height * 0.36;

    // 1. Center zero-axis
    ctx.strokeStyle = dimGridColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(waveW, centerY);
    ctx.stroke();

    // 2. Shaded Loop Region [loopStart .. loopEnd]
    const loopStartX = clamp(((d.loopStart - viewStart) / viewSpan) * waveW, 0, waveW);
    const loopEndX = clamp(((d.loopEnd - viewStart) / viewSpan) * waveW, 0, waveW);
    if (loopEndX > loopStartX) {
      ctx.fillStyle = accentColor;
      ctx.globalAlpha = 0.14;
      ctx.fillRect(loopStartX, 18, loopEndX - loopStartX, height - 22);
      ctx.globalAlpha = 1.0;

      const xfadeFrames = Math.round((d.loopCrossfadeMs / 1000) * d.sampleRate);
      if (xfadeFrames > 0) {
        const xfadeStartX = clamp(
          ((d.loopEnd - xfadeFrames - viewStart) / viewSpan) * waveW,
          loopStartX,
          loopEndX
        );
        if (loopEndX > xfadeStartX + 1) {
          ctx.fillStyle = warningColor;
          ctx.globalAlpha = 0.18;
          ctx.fillRect(xfadeStartX, 18, loopEndX - xfadeStartX, height - 22);
          ctx.globalAlpha = 1.0;

          ctx.strokeStyle = warningColor;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(xfadeStartX, height - 6);
          ctx.lineTo(loopEndX, 20);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      if (d.loopMode === 'ping_pong') {
        ctx.fillStyle = accentColor;
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('⇄ PING-PONG', (loopStartX + loopEndX) * 0.5, 30);
      } else if (d.loopMode === 'loop_backward') {
        ctx.fillStyle = warningColor;
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('← REVERSE', (loopStartX + loopEndX) * 0.5, 30);
      }
    }

    // 3. Waveform envelope
    const cols = env.max.length;
    const colW = waveW / Math.max(1, cols);
    for (let c = 0; c < cols; c++) {
      const x = c * colW;
      const inLoop = x >= loopStartX && x <= loopEndX;
      ctx.fillStyle = inLoop ? accentColor : origColor;
      ctx.globalAlpha = inLoop ? 0.92 : 0.58;
      const minV = clamp(env.min[c] ?? 0, -1, 1);
      const maxV = clamp(env.max[c] ?? 0, -1, 1);
      const yTop = centerY - maxV * ampSpan;
      const yBot = centerY - minV * ampSpan;
      ctx.fillRect(x, yTop, Math.max(1, colW - 0.4), Math.max(1.5, yBot - yTop));
    }
    ctx.globalAlpha = 1.0;

    // 4. Draggable L-START and L-END markers
    const drawMarker = (x: number, label: string, color: string, alignRight: boolean) => {
      if (x < 0 || x > waveW) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, 18);
      ctx.lineTo(x, height - 4);
      ctx.stroke();

      const flagW = 54;
      const flagH = 15;
      const fx = alignRight ? Math.max(0, x - flagW) : Math.min(waveW - flagW, x);
      ctx.fillStyle = color;
      ctx.fillRect(fx, 19, flagW, flagH);
      ctx.fillStyle = bgColor;
      ctx.font = 'bold 9px monospace';
      ctx.fillText(label, fx + 4, 30);
    };

    drawMarker(loopStartX, 'L-START', accentColor, false);
    drawMarker(loopEndX, 'L-END', warningColor, true);

    ctx.font = 'bold 10px monospace';
    ctx.fillStyle = origColor;
    ctx.fillText(
      `WAVEFORM (${basenameOf(d.sampleName)} • ${d.totalFrames} frames • Zoom ${this.drawerLoopZoomFactor.toFixed(1)}x)`,
      8,
      13
    );

    // 5. Divider
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(waveW, 0);
    ctx.lineTo(waveW, height);
    ctx.stroke();

    // 6. Right Pane: Zero-Crossing Seam Magnifier
    const seam = computeLoopSeamAnalysis(d.monoPcm, d.loopStart, d.loopEnd, 64);
    const midSeamX = seamX0 + seamW * 0.5;

    ctx.strokeStyle = dimGridColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(seamX0, centerY);
    ctx.lineTo(width, centerY);
    ctx.moveTo(midSeamX, 18);
    ctx.lineTo(midSeamX, height - 18);
    ctx.stroke();

    const halfW = seamW * 0.45;
    const wFrames = Math.max(2, seam.windowFrames);

    // Pre-End incoming curve (left of seam)
    ctx.strokeStyle = warningColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < wFrames; i++) {
      const x = midSeamX - halfW + (i / (wFrames - 1)) * halfW;
      const y = centerY - clamp(seam.preEndSamples[i] ?? 0, -1, 1) * ampSpan * 1.15;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Post-Start outgoing curve (right of seam)
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < wFrames; i++) {
      const x = midSeamX + (i / (wFrames - 1)) * halfW;
      const y = centerY - clamp(seam.postStartSamples[i] ?? 0, -1, 1) * ampSpan * 1.15;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    const spliceY = centerY - clamp(seam.postStartSamples[0] ?? 0, -1, 1) * ampSpan * 1.15;
    ctx.fillStyle = seam.seamQualityPercent >= 80 ? accentColor : warningColor;
    ctx.beginPath();
    ctx.arc(midSeamX, spliceY, 3.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = 'bold 10px monospace';
    ctx.fillStyle = seam.seamQualityPercent >= 80 ? accentColor : warningColor;
    ctx.fillText(`SEAM MAGNIFIER (${seam.seamQualityPercent}%)`, seamX0 + 6, 13);
    ctx.font = '9px monospace';
    ctx.fillStyle = mutedColor;
    ctx.fillText(
      `ΔStep: ${seam.stepDiscontinuity.toFixed(3)} • NCC: ${(seam.nccScore * 100).toFixed(0)}%`,
      seamX0 + 6,
      height - 6
    );

    ctx.restore();
  }
}
