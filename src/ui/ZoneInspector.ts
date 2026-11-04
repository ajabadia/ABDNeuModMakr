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
import { midiNoteToString } from './ZoneRibbon';
import { ICONS } from './icons';
import { confirmDialog } from './notify';
import { onAppLocaleChange } from '../core/i18n';
import { renderExtendedRegionTableRows as tplRenderExtendedRegionTableRows, renderGmDrumOptions as tplRenderGmDrumOptions, renderZoneTableRows as tplRenderZoneTableRows } from './zoneInspector/zoneTemplates.ts';
import type { InspectorContext } from './zoneInspector/types.ts';
import { renderDrawer } from './zoneInspector/drawerRenderOps.ts';
import { applyNoteHighlights, syncActiveDom } from './zoneInspector/drawerStateOps.ts';
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
      get drawerElement() {
        return host.drawerElement;
      },
      set drawerElement(v) {
        host.drawerElement = v;
      },
      get currentZone() {
        return host.currentZone;
      },
      set currentZone(v) {
        host.currentZone = v;
      },
      get allZones() {
        return host.allZones;
      },
      set allZones(v) {
        host.allZones = v;
      },
      get zoneIndex() {
        return host.zoneIndex;
      },
      set zoneIndex(v) {
        host.zoneIndex = v;
      },
      get workingMode() {
        return host.workingMode;
      },
      set workingMode(v) {
        host.workingMode = v;
      },
      get handlers() {
        return host.handlers;
      },
      set handlers(v) {
        host.handlers = v;
      },
      get keyMappingMode() {
        return host.keyMappingMode;
      },
      set keyMappingMode(v) {
        host.keyMappingMode = v;
      },
      get container() {
        return host.container;
      },
      set container(v) {
        host.container = v;
      },
      get isDraggingKnob() {
        return host.isDraggingKnob;
      },
      set isDraggingKnob(v) {
        host.isDraggingKnob = v;
      },
      get detuneKnob() {
        return host.detuneKnob;
      },
      set detuneKnob(v) {
        host.detuneKnob = v;
      },
      get volumeKnob() {
        return host.volumeKnob;
      },
      set volumeKnob(v) {
        host.volumeKnob = v;
      },
      get panKnob() {
        return host.panKnob;
      },
      set panKnob(v) {
        host.panKnob = v;
      },
      get activeNoteHits() {
        return host.activeNoteHits;
      },
      set activeNoteHits(v) {
        host.activeNoteHits = v;
      },
      get isPlayingSequence() {
        return host.isPlayingSequence;
      },
      set isPlayingSequence(v) {
        host.isPlayingSequence = v;
      },
      get isSpectralVisible() {
        return host.isSpectralVisible;
      },
      set isSpectralVisible(v) {
        host.isSpectralVisible = v;
      },
      get totalZones() {
        return host.totalZones;
      },
      set totalZones(v) {
        host.totalZones = v;
      },
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
    this.drawerElement = document.createElement('div');
    this.drawerElement.className = 'zone-metadata-drawer-panel is-closed';
    this.drawerMount.appendChild(this.drawerElement);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeToolsMenu();
        if (this.isDrawerOpen) {
          this.closeDrawer();
        }
      }
    });

    document.addEventListener('click', (e) => {
      const dropdown = this.container.querySelector('#keymap-tools-dropdown');
      if (dropdown && !dropdown.contains(e.target as Node)) {
        this.closeToolsMenu();
      }
    });
  }

  private closeToolsMenu(): void {
    const popover = this.container.querySelector('#keymap-tools-popover');
    const toggle = this.container.querySelector('#btn-keymap-tools-toggle');
    popover?.classList.remove('is-open');
    toggle?.classList.remove('is-active');
    toggle?.setAttribute('aria-expanded', 'false');
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
    syncActiveDom(this.inspectorCtx());
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
    renderTable(this.inspectorCtx());
  }

  private renderGmDrumOptions(currentKey: number, currentId: string): string {
    const isExtended = this.workingMode === 'extended';
    const items = isExtended
      ? this.getExtendedContext().regions.map((r, i) => ({ id: r.id, index: i + 1, rootKey: r.rootKey }))
      : this.allZones.map((z, i) => ({ id: z.id, index: i + 1, rootKey: z.rootKey }));
    return tplRenderGmDrumOptions(currentKey, currentId, items);
  }

  private renderDrawer(): void {
    renderDrawer(this.inspectorCtx());
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

    const inputBpm = this.container.querySelector<HTMLInputElement>('#input-keymap-bpm');
    const applyBpmValue = (nextVal: number) => {
      const clamped = Math.max(30, Math.min(300, Math.round(nextVal || 120)));
      this.auditionBpm = clamped;
      if (inputBpm) inputBpm.value = String(clamped);
      this.handlers.onUpdateAuditionBpm?.(clamped);
    };

    inputBpm?.addEventListener('change', () => {
      applyBpmValue(Number(inputBpm.value));
    });
    inputBpm?.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        applyBpmValue(this.getEffectiveBpm() + (e.shiftKey ? 5 : 1));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        applyBpmValue(this.getEffectiveBpm() - (e.shiftKey ? 5 : 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        applyBpmValue(Number(inputBpm.value));
        inputBpm.blur();
      }
    });

    this.container.querySelector('#btn-keymap-bpm-dec')?.addEventListener('click', (e) => {
      const step = (e as MouseEvent).shiftKey ? 5 : 1;
      applyBpmValue(this.getEffectiveBpm() - step);
    });

    this.container.querySelector('#btn-keymap-bpm-inc')?.addEventListener('click', (e) => {
      const step = (e as MouseEvent).shiftKey ? 5 : 1;
      applyBpmValue(this.getEffectiveBpm() + step);
    });

    this.container.querySelector('#btn-keymap-play-seq')?.addEventListener('click', () => {
      this.toggleSequencePlayback();
    });

    this.container.querySelector('#btn-keymap-tools-toggle')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const popover = this.container.querySelector('#keymap-tools-popover');
      const toggle = this.container.querySelector('#btn-keymap-tools-toggle');
      const willOpen = !popover?.classList.contains('is-open');
      popover?.classList.toggle('is-open', willOpen);
      toggle?.classList.toggle('is-active', willOpen);
      toggle?.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });

    this.container.querySelector('#btn-open-loop-drawer')?.addEventListener('click', () => {
      this.closeToolsMenu();
      this.openLoopEditorDrawer();
    });

    this.container.querySelector('#btn-autoloop-all-zones')?.addEventListener('click', () => {
      this.closeToolsMenu();
      this.handlers.onAutoLoopAllZones?.();
    });

    this.container.querySelector('#btn-open-autoslicer')?.addEventListener('click', () => {
      this.closeToolsMenu();
      this.handlers.onOpenAutoSlicer?.();
    });

    this.container.querySelector('#btn-open-recorder')?.addEventListener('click', () => {
      this.closeToolsMenu();
      this.handlers.onOpenAudioRecorder?.();
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
    applyNoteHighlights(this.inspectorCtx(), scrollIntoView);
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
    this.stopSequencePlayback(false);
    if (!this.playingRowId) return;
    this.setPlayingRow(null);
    this.updatePlayButtonStates();
  }

  private getEffectiveBpm(): number {
    const fromHandler = this.handlers.getAuditionBpm?.();
    if (fromHandler && fromHandler >= 30 && fromHandler <= 300) {
      this.auditionBpm = Math.round(fromHandler);
    }
    return this.auditionBpm;
  }

  private toggleSequencePlayback(): void {
    if (this.isPlayingSequence) {
      this.stopSequencePlayback(true);
      return;
    }

    const isExtended = this.workingMode === 'extended';
    const steps: Array<{ rowKey: string; zoneId?: string; regionId?: string }> = [];

    if (isExtended) {
      const regions = [...(this.handlers.getExtendedRegions?.() ?? [])]
        .filter((r) => Boolean(r.sampleName))
        .sort((a, b) => a.lowKey - b.lowKey || a.rootKey - b.rootKey);
      for (const r of regions) {
        steps.push({ rowKey: r.id, zoneId: this.currentZone?.id, regionId: r.id });
      }
    } else {
      const zones = [...(this.allZones.length > 0 ? this.allZones : this.currentZone ? [this.currentZone] : [])]
        .filter((z) => Boolean(z.sampleLow || z.sampleHigh))
        .sort((a, b) => a.lowKey - b.lowKey || a.rootKey - b.rootKey);
      for (const z of zones) {
        steps.push({ rowKey: z.id, zoneId: z.id });
      }
    }

    if (steps.length === 0) return;

    this.isPlayingSequence = true;
    this.renderTable();

    let stepIdx = 0;
    const playStep = () => {
      if (!this.isPlayingSequence) return;
      const step = steps[stepIdx % steps.length];
      stepIdx++;

      this.setPlayingRow(step.rowKey, { zoneId: step.zoneId, regionId: step.regionId });
      this.updatePlayButtonStates();
      if (this.handlers.onAuditionRow) {
        this.handlers.onAuditionRow({ zoneId: step.zoneId, regionId: step.regionId });
      } else if (step.zoneId) {
        this.handlers.onAuditionLoop?.({ zoneId: step.zoneId, regionId: step.regionId });
      }

      const bpm = Math.max(30, Math.min(300, this.getEffectiveBpm()));
      // 1/8th note step duration (in ms) synced to active BPM
      const stepMs = Math.max(80, Math.round((60 / bpm / 2) * 1000));
      this.seqPlayTimer = window.setTimeout(playStep, stepMs);
    };

    playStep();
  }

  public stopSequencePlayback(stopAudio = true): void {
    if (this.seqPlayTimer !== null) {
      clearTimeout(this.seqPlayTimer);
      this.seqPlayTimer = null;
    }
    if (!this.isPlayingSequence) return;
    this.isPlayingSequence = false;
    if (stopAudio) {
      this.handlers.onStopAudition?.();
    }
    this.setPlayingRow(null);
    this.renderTable();
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


}
