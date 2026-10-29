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
} from '../core/types';
import { DEFAULT_MASTER_WAVE_CONFIG } from '../core/dsp/MasterWaveEnhancer';
import { Knob } from '@abdsynths/shared/components';
import {
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
  onAddExtendedRegion?: (partial?: Partial<ExtendedRegion>) => void;
  onRemoveExtendedRegion?: (regionId: string) => void;
  onLoadSampleFileIntoRegion?: (regionId: string, file: File) => void;
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
  private lastExtendedRegionCount: number = 0;
  private activeDrawerTab: 'general' | 'extended' = 'general';
  private activeExtendedSubTab: 'region' | 'articulation' | 'master' | 'capsule' = 'region';
  private detuneKnob: Knob | null = null;
  private volumeKnob: Knob | null = null;
  private panKnob: Knob | null = null;
  private isDraggingKnob: boolean = false;

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

  public openDrawer(): void {
    this.isDrawerOpen = true;
    this.drawerElement?.classList.remove('is-closed');
    this.renderDrawer();
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
        this.activeDrawerTab = 'general';
      }
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

    const activeEl = document.activeElement;
    if (
      sameZone &&
      sameCount &&
      sameRegionCount &&
      !modeChanged &&
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

        const lowVelHtml = lowVelName
          ? `<span class="cell-vel-tag">1–${hasHigh ? zoneSplit - 1 : 127}</span> <span class="cell-sample-name">${lowVelName}</span>`
          : `<span class="cell-empty-dash">—</span>`;
        const highVelHtml = highVelName
          ? `<span class="cell-vel-tag">${zoneSplit}–127</span> <span class="cell-sample-name">${highVelName}</span>`
          : `<span class="cell-empty-dash">—</span>`;

        return `
          <tr class="zone-table-row ${isSelected ? 'is-selected' : ''}" data-zone-id="${zone.id}">
            <td class="col-zone">${idx + 1}</td>
            <td class="col-key">${lowKeyStr}</td>
            <td class="col-key is-root">${rootKeyStr}</td>
            <td class="col-key">${highKeyStr}</td>
            <td class="col-sample ${lowVelName ? 'has-sample' : 'is-empty'}" title="${zone.sampleLow ? `Vel 1..${hasHigh ? zoneSplit - 1 : 127}: ${zone.sampleLow}` : 'No Low Vel sample'}">${lowVelHtml}</td>
            <td class="col-sample ${highVelName ? 'has-sample' : 'is-empty'}" title="${zone.sampleHigh ? `Vel ${zoneSplit}..127: ${zone.sampleHigh}` : 'No High Vel sample (Low Vel covers 1..127)'}">${highVelHtml}</td>
            <td class="col-num">${detuneStr}</td>
            <td class="col-num">${volumeStr}</td>
            <td class="col-num">${panStr}</td>
            <td class="col-edit">
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

        const sampleHtml = sampleName
          ? `<span class="cell-sample-name">${sampleName}</span>`
          : `<span class="cell-empty-dash">—</span>`;

        return `
          <tr class="zone-table-row ${isSelected ? 'is-selected' : ''}" data-region-id="${reg.id}" data-zone-id="${mappedZoneId}">
            <td class="col-zone">${idx + 1}</td>
            <td class="col-key">${lowKeyStr}</td>
            <td class="col-key is-root">${rootKeyStr}</td>
            <td class="col-key">${highKeyStr}</td>
            <td class="col-vel" title="Start Velocity (1..127)"><span class="cell-vel-tag">${reg.lowVel}</span></td>
            <td class="col-vel" title="End Velocity (1..127)"><span class="cell-vel-tag">${reg.highVel}</span></td>
            <td class="col-sample ${sampleName ? 'has-sample' : 'is-empty'}" title="${reg.sampleName ? `${reg.sampleName} (Keys ${lowKeyStr}..${highKeyStr}, Vel ${reg.lowVel}..${reg.highVel})` : 'No sample assigned to this region'}">${sampleHtml}</td>
            <td class="col-mode" title="Loop Mode, Pitch Keytrack &amp; Trigger"><span class="cell-vel-tag">${modeBadge}</span></td>
            <td class="col-num">${detuneStr}</td>
            <td class="col-num">${volumeStr}</td>
            <td class="col-num">${panStr}</td>
            <td class="col-edit">
              <button type="button" class="btn-row-edit" data-edit-region-id="${reg.id}" title="Edit Region #${idx + 1} Metadata (Free Key Range, Start/End Velocity, Sample, Loop, ADSR, Filter &amp; LFO)">
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
                      <th class="col-mode" title="Loop Mode, Pitch Keytrack &amp; Trigger">Mode / Loop</th>
                      <th class="col-num" title="Fine Pitch Detune (-99..+99 cents)">Detune</th>
                      <th class="col-num" title="Region Gain (-32..+12 dB)">Volume</th>
                      <th class="col-num" title="Stereo Pan (-50..+50)">Pan</th>
                      <th class="col-edit" title="Open Region Metadata &amp; Articulation Drawer">Edit</th>
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
                  <span class="panel-caption">${midiNoteToString(activeRegion.lowKey)} .. ${midiNoteToString(activeRegion.highKey)} | Root: ${midiNoteToString(activeRegion.rootKey)} | Vel: ${activeRegion.lowVel}..${activeRegion.highVel}${sampleTitle ? ` | ${sampleTitle}` : ''}${this.handlers.getDetectedCategory?.() ? ` • ${this.handlers.getDetectedCategory?.()}` : ''}</span>
                </div>
                <div class="panel-actions">
                  <button type="button" class="btn btn-xs btn-outline ${this.isSpectralVisible ? 'is-active' : ''}" id="btn-toggle-spectral" title="Toggle Spectral &amp; A/B/C Resynthesis Inspector (Shortcut: Ctrl+E)">
                    ${ICONS.wave} Spectral / A-B
                  </button>
                  <button type="button" class="btn btn-xs btn-outline" id="btn-open-zone-drawer" title="Open Right Drawer to Edit Region #${activeIndex + 1} Metadata &amp; Extended ADSR / Filter / LFO / Loop">
                    ${ICONS.settings} Edit Region #${activeIndex + 1} + Articulation
                  </button>
                  <button type="button" class="btn btn-xs btn-outline" id="btn-split-zone" title="Add a new 2D Sampler Region (free Key &amp; Velocity range)">
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
                  <th class="col-edit" title="Open Zone Metadata Drawer">Edit</th>
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
    if (!isExtended && this.activeDrawerTab === 'extended') {
      this.activeDrawerTab = 'general';
    }
    const activeTab = isExtended ? this.activeDrawerTab : 'general';
    const loadedSamples = this.handlers.getLoadedSamples?.() ?? [];

    const extCtx = isExtended ? this.getExtendedContext() : null;
    const activeReg = extCtx?.activeRegion ?? null;
    const activeRegIdx = extCtx?.activeIndex ?? 0;

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

    const drawerTitleText =
      isExtended && activeReg
        ? `REGION #${activeRegIdx + 1} METADATA (${midiNoteToString(activeReg.lowKey)} .. ${midiNoteToString(activeReg.highKey)} • VEL ${activeReg.lowVel}..${activeReg.highVel})`
        : `ZONE #${this.zoneIndex + 1} METADATA (${midiNoteToString(z.lowKey)} .. ${midiNoteToString(z.highKey)})`;

    this.drawerElement.innerHTML = `
      <div class="drawer-header">
        <div class="drawer-title">
          <span class="drawer-icon">${ICONS.settings}</span>
          <span>${drawerTitleText}</span>
        </div>
        <button type="button" class="btn btn-close-drawer" id="btn-close-zone-drawer" title="Close Metadata Drawer">${ICONS.close}</button>
      </div>

      <div class="drawer-tab-bar" role="tablist" aria-label="Zone Metadata Tabs">
        <button
          type="button"
          role="tab"
          aria-selected="${activeTab === 'general'}"
          class="drawer-tab-pill ${activeTab === 'general' ? 'is-active' : ''}"
          data-drawer-tab="general"
          title="${isExtended ? 'General Region Parameters (Free Key Range, Start/End Velocity, Sample, Detune, Volume, Pan)' : 'General Zone Parameters (Key Range, Velocity Samples, Detune, Volume, Pan)'}"
        >
          <span class="tab-pill-icon">${ICONS.layers}</span>
          <span>General</span>
        </button>
        ${
          isExtended
            ? `
        <button
          type="button"
          role="tab"
          aria-selected="${activeTab === 'extended'}"
          class="drawer-tab-pill ${activeTab === 'extended' ? 'is-active' : ''}"
          data-drawer-tab="extended"
          title="Extended Mode Parameters (Loop, Keytrack, Crossfades, ADSR, Filter, LFO & Acoustic Intelligence)"
        >
          <span class="tab-pill-icon">${ICONS.sliders}</span>
          <span>Extended</span>
        </button>
        `
            : ''
        }
      </div>

      <div class="drawer-body zone-drawer-body">
        <div class="drawer-tab-pane ${activeTab === 'general' ? 'is-active' : 'is-hidden'}" data-tab-pane="general">
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
                  ${activeReg.sampleName ? `<button type="button" class="btn btn-xs btn-accent" id="btn-play-low" title="Audition Region Sample">${ICONS.play} Audition</button>` : ''}
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
                  ${z.sampleLow ? `<button type="button" class="btn btn-xs btn-accent" id="btn-play-low" title="Audition Low Vel Audio">${ICONS.play} Audition</button>` : ''}
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

        ${
          isExtended
            ? `<div class="drawer-tab-pane ${activeTab === 'extended' ? 'is-active' : 'is-hidden'}" data-tab-pane="extended">
                ${this.renderExtendedSectionsHtml(z, isExtended, activeReg)}
              </div>`
            : ''
        }
      </div>
    `;

    this.bindDrawerEvents();
  }

  private renderExtendedSectionsHtml(
    z: Zone,
    isExtended: boolean,
    explicitRegion?: ExtendedRegion | null
  ): string {
    if (!isExtended) return '';
    const activeReg =
      explicitRegion !== undefined
        ? explicitRegion
        : this.getExtendedContext().activeRegion;

    const subTab = this.activeExtendedSubTab;
    const art = this.handlers.getArticulation?.();
    const cls = this.handlers.getZoneClassification?.(z.id);
    const detectedCat = cls?.detectedCategory ?? this.handlers.getDetectedCategory?.() ?? 'Synth & Neutral';
    const loopMode = activeReg?.loopMode ?? 'no_loop';
    const loopStart = activeReg?.loopStart ?? 0;
    const loopEnd = activeReg?.loopEnd ?? 0;
    const loopXfade = activeReg?.loopCrossfadeMs ?? 0;
    const keytrack = activeReg?.pitchKeytrack ?? 100;
    const triggerMode = activeReg?.trigger ?? 'attack';
    const keyFadeIn = activeReg?.keyFadeIn ?? 0;
    const keyFadeOut = activeReg?.keyFadeOut ?? 0;
    const velFadeIn = activeReg?.velFadeIn ?? 0;
    const velFadeOut = activeReg?.velFadeOut ?? 0;
    const fadeCurve = activeReg?.fadeCurve ?? 'equal-power';

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
      <!-- Sub-navigation pills inside Extended Tab to reduce visual load -->
      <div class="drawer-subtab-bar" role="tablist" aria-label="Extended Subsections">
        <button
          type="button"
          role="tab"
          aria-selected="${subTab === 'region'}"
          class="drawer-subtab-pill ${subTab === 'region' ? 'is-active' : ''}"
          data-ext-subtab="region"
          title="Region Loop, Keytrack, Trigger, Crossfades &amp; Acoustic Intelligence"
        >
          ${ICONS.layers} <span>Region &amp; Loop</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected="${subTab === 'articulation'}"
          class="drawer-subtab-pill ${subTab === 'articulation' ? 'is-active' : ''}"
          data-ext-subtab="articulation"
          title="Synth Articulation (ADSR Envelope, Silver Filter &amp; Isolated LFO)"
        >
          ${ICONS.sliders} <span>Articulation</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected="${subTab === 'master'}"
          class="drawer-subtab-pill ${subTab === 'master' ? 'is-active' : ''}"
          data-ext-subtab="master"
          title="Master Wave 24-bit / 96 kHz Promotion, Loop Expansion &amp; Quad Surround"
        >
          ${ICONS.wave} <span>Master 24/96</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected="${subTab === 'capsule'}"
          class="drawer-subtab-pill ${subTab === 'capsule' ? 'is-active' : ''}"
          data-ext-subtab="capsule"
          title="5-Layer Time Capsule Container &amp; Zero Generation-Loss Lineage"
        >
          ${ICONS.database} <span>Time Capsule</span>
        </button>
      </div>

      <!-- SUB-PANE 1: Region & Loop + Acoustic Intelligence -->
      <div class="drawer-subtab-pane ${subTab === 'region' ? 'is-active' : 'is-hidden'}" data-ext-subpane="region">
        <!-- 1. Extended Region Loop, Keytrack, Trigger & Crossfades -->
        <div class="inspector-section section-extended-region" data-ext-region-id="${activeReg?.id ?? ''}">
          <div class="section-title">EXTENDED REGION: LOOP, KEYTRACK &amp; CROSSFADES</div>
          <div class="drawer-grid-3">
            <div class="form-group">
              <label for="sel-ext-loop-mode">LOOP MODE</label>
              <select id="sel-ext-loop-mode" class="drawer-select">
                <option value="no_loop" ${loopMode === 'no_loop' ? 'selected' : ''}>No Loop</option>
                <option value="loop_continuous" ${loopMode === 'loop_continuous' ? 'selected' : ''}>Continuous Loop</option>
                <option value="loop_sustain" ${loopMode === 'loop_sustain' ? 'selected' : ''}>Sustain Loop</option>
                <option value="one_shot" ${loopMode === 'one_shot' ? 'selected' : ''}>One Shot</option>
              </select>
            </div>
            <div class="form-group">
              <label for="inp-ext-loop-start">LOOP START (FRAMES)</label>
              <input type="number" id="inp-ext-loop-start" class="drawer-input" min="0" value="${loopStart}" />
            </div>
            <div class="form-group">
              <label for="inp-ext-loop-end">LOOP END (FRAMES)</label>
              <input type="number" id="inp-ext-loop-end" class="drawer-input" min="0" value="${loopEnd}" />
            </div>
          </div>

          <div class="drawer-grid-3">
            <div class="form-group">
              <label for="inp-ext-loop-xfade">LOOP XFADE (MS)</label>
              <input type="number" id="inp-ext-loop-xfade" class="drawer-input" min="0" max="5000" value="${loopXfade}" />
            </div>
            <div class="form-group">
              <label for="inp-ext-keytrack">PITCH KEYTRACK (%)</label>
              <input type="number" id="inp-ext-keytrack" class="drawer-input" min="0" max="100" value="${keytrack}" title="100% = Chromatic, 0% = Unpitched/Drum" />
            </div>
            <div class="form-group">
              <label for="sel-ext-trigger">TRIGGER MODE</label>
              <select id="sel-ext-trigger" class="drawer-select">
                <option value="attack" ${triggerMode === 'attack' ? 'selected' : ''}>Attack</option>
                <option value="release" ${triggerMode === 'release' ? 'selected' : ''}>Release</option>
                <option value="first" ${triggerMode === 'first' ? 'selected' : ''}>First Note</option>
                <option value="legato" ${triggerMode === 'legato' ? 'selected' : ''}>Legato</option>
              </select>
            </div>
          </div>

          <div class="drawer-grid-3">
            <div class="form-group">
              <label for="inp-ext-key-fade-in">KEY XFADE IN / OUT (SEMI)</label>
              <div class="drawer-pair-inputs">
                <input type="number" id="inp-ext-key-fade-in" class="drawer-input" min="0" max="64" value="${keyFadeIn}" title="Key Crossfade In (semitones)" />
                <input type="number" id="inp-ext-key-fade-out" class="drawer-input" min="0" max="64" value="${keyFadeOut}" title="Key Crossfade Out (semitones)" />
              </div>
            </div>
            <div class="form-group">
              <label for="inp-ext-vel-fade-in">VEL XFADE IN / OUT</label>
              <div class="drawer-pair-inputs">
                <input type="number" id="inp-ext-vel-fade-in" class="drawer-input" min="0" max="127" value="${velFadeIn}" title="Velocity Crossfade In" />
                <input type="number" id="inp-ext-vel-fade-out" class="drawer-input" min="0" max="127" value="${velFadeOut}" title="Velocity Crossfade Out" />
              </div>
            </div>
            <div class="form-group">
              <label for="sel-ext-fade-curve">XFADE CURVE</label>
              <select id="sel-ext-fade-curve" class="drawer-select">
                <option value="equal-power" ${fadeCurve === 'equal-power' ? 'selected' : ''}>Equal Power</option>
                <option value="linear" ${fadeCurve === 'linear' ? 'selected' : ''}>Linear</option>
                <option value="spectral-morph" ${fadeCurve === 'spectral-morph' ? 'selected' : ''}>Spectral Morph</option>
              </select>
            </div>
          </div>
        </div>

        <!-- 2. Fase 7 Acoustic Intelligence & Auto-Classification -->
        <div class="inspector-section section-acoustic-intel">
          <div class="section-header-row">
            <div class="section-title">ACOUSTIC INTELLIGENCE &amp; AUTO-CLASSIFICATION</div>
            <button type="button" class="btn btn-xs btn-accent" id="btn-auto-detect-zone-ext" title="Run YIN/MPM + HPS Pitch Detection &amp; Acoustic Parameter Set Classifier">
              ${ICONS.cpu} Auto-Detect Pitch &amp; Set
            </button>
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
      </div>

      <!-- SUB-PANE 2: Synth Articulation (ADSR, Filter, LFO) -->
      <div class="drawer-subtab-pane ${subTab === 'articulation' ? 'is-active' : 'is-hidden'}" data-ext-subpane="articulation">
        ${
          art
            ? `
        <div class="inspector-section section-articulation">
          <div class="section-title">SYNTH ARTICULATION (ADSR / FILTER / LFO &rarr; SAFE SOUND.SCRIPT)</div>

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

      <!-- SUB-PANE 3: Master Wave 24-bit / 96 kHz, Loop Expansion & Surround -->
      <div class="drawer-subtab-pane ${subTab === 'master' ? 'is-active' : 'is-hidden'}" data-ext-subpane="master">
        <div class="inspector-section">
          <div class="section-header-row">
            <div class="section-title">MASTER WAVE (24-BIT / 96 KHZ), LOOP EXPANSION &amp; SURROUND</div>
            <span class="val-pill" title="Current Zone Wave Format">${fmtBadge}</span>
          </div>
          <div class="articulation-card is-enabled">
            <div class="drawer-grid-3">
              <div class="form-group">
                <label for="sel-mw-method" title="Selects how audio is promoted to 24-bit / 96.000 Hz Master Wave">PROMOTION ENGINE</label>
                <select id="sel-mw-method" class="drawer-select">
                  <option value="direct-conversion" ${mwCfg.promotionMethod === 'direct-conversion' ? 'selected' : ''}>Direct (Sinc 96k / 24b)</option>
                  <option value="dsp-enhanced" ${mwCfg.promotionMethod === 'dsp-enhanced' ? 'selected' : ''}>DSP Enhanced (BWE + DeNoise)</option>
                  <option value="ai-bridge" ${mwCfg.promotionMethod === 'ai-bridge' ? 'selected' : ''}>AI Bridge (AudioSR/BigVGAN)</option>
                </select>
              </div>
              <div class="form-group">
                <label for="sel-mw-channels" title="Preserve original channels or expand to Stereo 2.0 or Quad Surround 4.0">SPATIAL CHANNELS</label>
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
                <button type="button" class="btn btn-xs btn-accent" id="btn-promote-zone-mw" title="Promote current zone sample to 24-bit / 96.000 Hz Master Wave & relocate optimal loop markers">
                  ${ICONS.wave} Promote Zone (24b/96k)
                </button>
                <button type="button" class="btn btn-xs btn-outline" id="btn-promote-all-mw" title="Promote all zones in session to 24-bit / 96.000 Hz Master Wave">
                  ${ICONS.layers} Promote All Zones
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- SUB-PANE 4: 5-Layer Time Capsule Container & Anti-Photocopy Lineage -->
      <div class="drawer-subtab-pane ${subTab === 'capsule' ? 'is-active' : 'is-hidden'}" data-ext-subpane="capsule">
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

    // Row selection in Zone / Region Table
    const rows = this.container.querySelectorAll<HTMLElement>('tr.zone-table-row');
    rows.forEach((row) => {
      row.addEventListener('click', (e: MouseEvent) => {
        const editBtn = (e.target as HTMLElement).closest<HTMLElement>('.btn-row-edit');
        const regionId = row.getAttribute('data-region-id');
        const zoneId = row.getAttribute('data-zone-id');

        if (isExtended && regionId) {
          const regionChanged = regionId !== this.selectedRegionId;
          this.selectedRegionId = regionId;
          if (zoneId && zoneId !== z.id && this.handlers.onSelectZone) {
            this.handlers.onSelectZone(zoneId);
          } else if (regionChanged) {
            this.renderTable();
            this.renderDrawer();
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

    this.container.querySelector('#btn-open-zone-drawer')?.addEventListener('click', () => {
      this.toggleDrawer();
    });

    this.container.querySelector('#btn-toggle-spectral')?.addEventListener('click', () => {
      this.handlers.onToggleSpectral?.();
    });

    this.container.querySelector('#btn-split-zone')?.addEventListener('click', () => {
      if (isExtended && this.handlers.onAddExtendedRegion) {
        const { activeRegion } = this.getExtendedContext();
        if (activeRegion) {
          this.handlers.onAddExtendedRegion({
            lowKey: activeRegion.lowKey,
            rootKey: activeRegion.rootKey,
            highKey: activeRegion.highKey,
            lowVel: activeRegion.lowVel,
            highVel: activeRegion.highVel,
            sampleName: activeRegion.sampleName,
            detune: activeRegion.detune,
            volume: activeRegion.volume,
            pan: activeRegion.pan,
            loopMode: activeRegion.loopMode,
            loopStart: activeRegion.loopStart,
            loopEnd: activeRegion.loopEnd,
            loopCrossfadeMs: activeRegion.loopCrossfadeMs,
            pitchKeytrack: activeRegion.pitchKeytrack,
            trigger: activeRegion.trigger,
            fadeCurve: activeRegion.fadeCurve,
          });
        } else {
          this.handlers.onAddExtendedRegion();
        }
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

  private bindDrawerEvents(): void {
    if (!this.drawerElement || !this.currentZone) return;
    const z = this.currentZone;
    const isExtended = this.workingMode === 'extended';
    const activeReg = isExtended ? this.getExtendedContext().activeRegion : null;

    this.drawerElement.querySelector('#btn-close-zone-drawer')?.addEventListener('click', () => {
      this.closeDrawer();
    });

    // Tab pills ("General" & "Extended")
    const tabBtns = this.drawerElement.querySelectorAll<HTMLButtonElement>('.drawer-tab-pill');
    tabBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-drawer-tab') === 'extended' ? 'extended' : 'general';
        if (target === this.activeDrawerTab) return;
        this.activeDrawerTab = target;
        tabBtns.forEach((b) => {
          const isMatch = b.getAttribute('data-drawer-tab') === target;
          b.classList.toggle('is-active', isMatch);
          b.setAttribute('aria-selected', String(isMatch));
        });
        this.drawerElement
          ?.querySelectorAll<HTMLElement>('.drawer-tab-pane')
          .forEach((pane) => {
            const isMatch = pane.getAttribute('data-tab-pane') === target;
            pane.classList.toggle('is-active', isMatch);
            pane.classList.toggle('is-hidden', !isMatch);
          });
      });
    });

    // Sub-tab pills inside "Extended" ("Region & Loop", "Articulation", "Master 24/96", "Time Capsule")
    const subTabBtns = this.drawerElement.querySelectorAll<HTMLButtonElement>('.drawer-subtab-pill');
    subTabBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const raw = btn.getAttribute('data-ext-subtab');
        const target: 'region' | 'articulation' | 'master' | 'capsule' =
          raw === 'articulation' || raw === 'master' || raw === 'capsule'
            ? raw
            : 'region';
        if (target === this.activeExtendedSubTab) return;
        this.activeExtendedSubTab = target;
        subTabBtns.forEach((b) => {
          const isMatch = b.getAttribute('data-ext-subtab') === target;
          b.classList.toggle('is-active', isMatch);
          b.setAttribute('aria-selected', String(isMatch));
        });
        this.drawerElement
          ?.querySelectorAll<HTMLElement>('.drawer-subtab-pane')
          .forEach((pane) => {
            const isMatch = pane.getAttribute('data-ext-subpane') === target;
            pane.classList.toggle('is-active', isMatch);
            pane.classList.toggle('is-hidden', !isMatch);
          });
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

    // Extended Region & Synth Articulation events
    const extSection = this.drawerElement.querySelector('.section-extended-region');
    const extRegionId = extSection?.getAttribute('data-ext-region-id') || '';
    if (extRegionId && this.handlers.onUpdateExtendedRegion) {
      const updateReg = (changes: Partial<ExtendedRegion>) => {
        this.handlers.onUpdateExtendedRegion?.(extRegionId, changes);
      };

      const selLoopMode = this.drawerElement.querySelector('#sel-ext-loop-mode') as HTMLSelectElement | null;
      selLoopMode?.addEventListener('change', () => {
        updateReg({ loopMode: selLoopMode.value as LoopMode });
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
        updateReg({ pitchKeytrack: Math.max(0, Math.min(100, parseInt(inpKeytrack.value, 10) || 0)) });
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
        updateReg({ trigger: selTrigger.value as TriggerMode });
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
        updateReg({ fadeCurve: selFadeCurve.value as CrossfadeCurve });
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
        const selMethod = this.drawerElement?.querySelector<HTMLSelectElement>('#sel-mw-method');
        const selChannels = this.drawerElement?.querySelector<HTMLSelectElement>('#sel-mw-channels');
        const inpLoopSec = this.drawerElement?.querySelector<HTMLInputElement>('#inp-mw-loop-sec');
        const chkBwe = this.drawerElement?.querySelector<HTMLInputElement>('#chk-mw-bwe');
        const chkDenoise = this.drawerElement?.querySelector<HTMLInputElement>('#chk-mw-denoise');

        const pm = selMethod?.value;
        const cl = selChannels?.value;
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
          minLoopDurationSec: Math.max(0, Math.min(30, parseFloat(inpLoopSec?.value ?? '4') || 0)),
          enableBandwidthExtension: Boolean(chkBwe?.checked ?? true),
          enableDenoiseGate: Boolean(chkDenoise?.checked ?? true),
        };
      };

      this.drawerElement
        .querySelector('#btn-promote-zone-mw')
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
  }
}
