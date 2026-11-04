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
import { createDefaultCommonPlayback } from '../core/extendedAdapter';
import { formatGmDrumLabel } from '../core/gmDrumMap';
import { DEFAULT_MASTER_WAVE_CONFIG } from '../core/dsp/MasterWaveEnhancer';
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
import {
  midiToNoteName,
  midiNoteToString,
  detuneToString,
  volumeToLongString,
  panToString,
} from './ZoneRibbon';
import { ICONS } from './icons';
import { confirmDialog } from './notify';
import { onAppLocaleChange } from '../core/i18n';
import { renderExtendedRegionTableRows as tplRenderExtendedRegionTableRows, renderGmDrumOptions as tplRenderGmDrumOptions, renderZoneTableRows as tplRenderZoneTableRows } from './zoneInspector/zoneTemplates.ts';
import type { InspectorContext } from './zoneInspector/types.ts';
import { renderDrawer } from './zoneInspector/drawerRenderOps.ts';
import { applyNoteHighlights, syncActiveDom } from './zoneInspector/drawerStateOps.ts';
import { renderTable } from './zoneInspector/tableRenderOps.ts';

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

    this.drawerElement.querySelector('#btn-drawer-invoke-recorder')?.addEventListener('click', () => {
      this.handlers.onOpenAudioRecorder?.();
    });

    this.drawerElement.querySelectorAll('#btn-sample-card-wizard').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.handlers.onOpenWizardFromZoneSample?.({
          zoneId: z.id,
          slot: 'low',
          regionId: isExtended && activeReg ? activeReg.id : undefined,
        });
      });
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

    this.drawerElement.querySelectorAll('#btn-sample-card-recorder').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.handlers.onOpenAudioRecorder?.();
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


}
