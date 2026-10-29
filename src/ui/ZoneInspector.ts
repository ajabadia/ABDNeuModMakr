// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Zone Table & Sliding Zone Metadata Drawer
// Implements the canonical Hartmann MODELmaker v1.2 ZoneTableModel
// (Zone, Low Key, Root Key, High Key, Low Vel, High Vel, Detune,
// Volume, Pan) with full vertical height (up to 128 zones) and a
// right-side sliding drawer for Zone Metadata editing.
// ─────────────────────────────────────────────────────────

import type {
  AcousticClassificationResult,
  CrossfadeCurve,
  ExtendedRegion,
  LoopMode,
  SynthArticulationConfig,
  TriggerMode,
  WorkingMode,
  Zone,
} from '../core/types';
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
  getArticulation?: () => SynthArticulationConfig;
  onUpdateArticulation?: (changes: Partial<SynthArticulationConfig>) => void;
  getDetectedCategory?: () => string | undefined;
  getZoneClassification?: (zoneId: string) => AcousticClassificationResult | undefined;
  onAutoDetectZone?: (zoneId: string) => void;
}

function basenameOf(samplePath: string | null | undefined): string {
  if (!samplePath) return '';
  return samplePath.split(/[\\/]/).pop() || samplePath;
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
  private activeDrawerTab: 'general' | 'extended' = 'general';

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
    this.currentZone = zone ? { ...zone } : null;
    this.zoneIndex = index;
    this.totalZones = total;
    this.allZones = allZones ? allZones.map((z) => ({ ...z })) : zone ? [{ ...zone }] : [];

    const activeEl = document.activeElement;
    if (
      sameZone &&
      sameCount &&
      !modeChanged &&
      activeEl &&
      this.drawerElement &&
      this.drawerElement.contains(activeEl)
    ) {
      this.syncActiveDom();
      return;
    }
    this.renderTable();
    this.renderDrawer();
  }

  private syncActiveDom(): void {
    if (!this.currentZone) return;
    const z = this.currentZone;
    if (this.drawerElement) {
      const dispLow = this.drawerElement.querySelector('#disp-low-note');
      const dispRoot = this.drawerElement.querySelector('#disp-root-note');
      const dispHigh = this.drawerElement.querySelector('#disp-high-note');
      if (dispLow) dispLow.textContent = midiNoteToString(z.lowKey);
      if (dispRoot) dispRoot.textContent = midiNoteToString(z.rootKey);
      if (dispHigh) dispHigh.textContent = midiNoteToString(z.highKey);
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
    const zonesList = this.allZones.length > 0 ? this.allZones : [z];
    const canDelete = this.totalZones > 1;
    const canSplit = this.totalZones < 128 && z.highKey > z.lowKey;

    this.container.innerHTML = `
      <div class="zone-inspector-panel">
        <!-- Canonical Hartmann MODELmaker v1.2 Zone Table (1..128 Zones Max) -->
        <div class="zone-table-card">
          <div class="zone-table-scroll">
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
              <span class="panel-caption">${midiNoteToString(z.lowKey)} .. ${midiNoteToString(z.highKey)} | Root: ${midiNoteToString(z.rootKey)}${this.workingMode === 'extended' ? ` | EXTENDED (${this.handlers.getExtendedRegions?.().length ?? this.totalZones} 2D REGIONS${this.handlers.getDetectedCategory?.() ? ` • ${this.handlers.getDetectedCategory?.()}` : ''})` : ''}</span>
            </div>
            <div class="panel-actions">
              <button type="button" class="btn btn-xs btn-outline ${this.isSpectralVisible ? 'is-active' : ''}" id="btn-toggle-spectral" title="Toggle Spectral & A/B Resynthesis Inspector (Shortcut: Ctrl+E)">
                ${ICONS.wave} Spectral / A-B
              </button>
              <button type="button" class="btn btn-xs btn-outline" id="btn-open-zone-drawer" title="Open Right Drawer to Edit Zone #${this.zoneIndex + 1} Metadata${this.workingMode === 'extended' ? ' & Extended ADSR / Filter / LFO / Loop' : ''}">
                ${ICONS.settings} ${this.workingMode === 'extended' ? `Edit Zone #${this.zoneIndex + 1} + Articulation` : `Edit Zone #${this.zoneIndex + 1}`}
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
    // Velocity split rendering follows the zone's stored split (classic
    // sessions always store 64, so this renders identically there).
    const split = Math.max(2, Math.min(127, z.velSplit ?? 64));
    const isExtended = this.workingMode === 'extended';
    if (!isExtended && this.activeDrawerTab === 'extended') {
      this.activeDrawerTab = 'general';
    }
    const activeTab = isExtended ? this.activeDrawerTab : 'general';
    const loadedSamples = this.handlers.getLoadedSamples?.() ?? [];
    const lowOptionsHtml = [
      `<option value="">-- Select Loaded Sample --</option>`,
      ...loadedSamples.map(
        (s) =>
          `<option value="${s}" ${z.sampleLow === s ? 'selected' : ''}>${basenameOf(s)}</option>`
      ),
    ].join('');
    const highOptionsHtml = [
      `<option value="">-- None (Low Vel covers 1..127) --</option>`,
      ...loadedSamples.map(
        (s) =>
          `<option value="${s}" ${z.sampleHigh === s ? 'selected' : ''}>${basenameOf(s)}</option>`
      ),
    ].join('');

    this.drawerElement.innerHTML = `
      <div class="drawer-header">
        <div class="drawer-title">
          <span class="drawer-icon">${ICONS.settings}</span>
          <span>ZONE #${this.zoneIndex + 1} METADATA (${midiNoteToString(z.lowKey)} .. ${midiNoteToString(z.highKey)})</span>
        </div>
        <button type="button" class="btn btn-close-drawer" id="btn-close-zone-drawer" title="Close Zone Metadata Drawer">${ICONS.close}</button>
      </div>

      <div class="drawer-tab-bar" role="tablist" aria-label="Zone Metadata Tabs">
        <button
          type="button"
          role="tab"
          aria-selected="${activeTab === 'general'}"
          class="drawer-tab-pill ${activeTab === 'general' ? 'is-active' : ''}"
          data-drawer-tab="general"
          title="General Zone Parameters (Key Range, Velocity Samples, Detune, Volume, Pan)"
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
          <!-- 1. Key Range & Root -->
          <div class="inspector-section section-keys">
            <div class="section-header-row">
              <div class="section-title">KEY ZONE BOUNDARIES (MIDI 0 C-2 .. 127 G8)</div>
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
                  <input type="number" id="inp-low-key" min="${minLowKey}" max="${maxLowKey}" value="${z.lowKey}" ${!prevZone ? 'disabled title="First zone always starts at 0 C-2"' : ''} />
                  <span class="note-display" id="disp-low-note">${midiNoteToString(z.lowKey)}</span>
                </div>
              </div>

              <div class="form-group is-highlight">
                <label for="inp-root-key">ROOT KEY</label>
                <div class="input-with-note">
                  <input type="number" id="inp-root-key" min="0" max="127" value="${z.rootKey}" />
                  <span class="note-display" id="disp-root-note">${midiNoteToString(z.rootKey)}</span>
                </div>
              </div>

              <div class="form-group">
                <label for="inp-high-key">HIGH KEY</label>
                <div class="input-with-note">
                  <input type="number" id="inp-high-key" min="${minHighKey}" max="${maxHighKey}" value="${z.highKey}" ${!nextZone ? 'disabled title="Last zone always ends at 127 G8"' : ''} />
                  <span class="note-display" id="disp-high-note">${midiNoteToString(z.highKey)}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 2. Sample Assignment (Low Vel & High Vel) -->
          <div class="inspector-section section-samples">
            <div class="section-title">VELOCITY SAMPLE LAYERS (${isExtended ? `SPLIT 1..${split - 1} / ${split}..127` : 'CANONICAL 1..63 / 64..127'})</div>
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

              <div class="sample-vel-split-control ${isExtended ? '' : 'is-disabled'}">
                <label for="slider-vel-split" class="sample-vel-split-label">
                  <span>VELOCITY SPLIT POINT</span>
                  <span class="val-display" id="val-vel-split">${isExtended ? `${split} (1–${split - 1} / ${split}–127)` : '64 (Fixed: 1–63 / 64–127)'}</span>
                </label>
                <input type="range" id="slider-vel-split" min="${isExtended ? 2 : 64}" max="${isExtended ? 127 : 64}" value="${split}" ${isExtended ? '' : 'disabled'} title="${isExtended ? `Extended Mode: velocity split point (Low Vel 1..${split - 1} / High Vel ${split}..127). Stored in the session; legacy .model binaries always render the canonical 1..63 / 64..127 layers.` : 'Classic Mode strictly uses the Hartmann MODELmaker v1.2 fixed velocity split (Low Vel 1..63 / High Vel 64..127). Switch WORKING MODE → Extended to edit.'}" />
                <div class="sample-vel-split-hint">
                  ${isExtended ? `Extended Mode: split at ${split} (Low: 1–${split - 1}, High: ${split}–127).` : 'Classic Mode: Fixed at 64 (Low: 1–63, High: 64–127). Arbitrary split reserved for Extended Mode.'}
                </div>
              </div>
            </div>
          </div>

          <!-- 3. Canonical Tuning, Volume & Pan Controls (MainFrame Sliders) -->
          <div class="inspector-section section-trims">
            <div class="section-title">ZONE PARAMETERS (DETUNE / VOLUME / PAN)</div>
            <div class="trims-controls-stack">
              <div class="trim-control">
                <label for="slider-detune">DETUNE (-99 .. +99)</label>
                <div class="control-row">
                  <input type="range" id="slider-detune" min="-99" max="99" value="${Math.round(z.detune)}" step="1" />
                  <span class="val-display" id="val-detune">${detuneToString(z.detune)}</span>
                </div>
              </div>

              <div class="trim-control">
                <label for="slider-volume">VOLUME (-32dB .. +12dB)</label>
                <div class="control-row">
                  <input type="range" id="slider-volume" min="-32" max="12" value="${Math.round(z.volume)}" step="1" />
                  <span class="val-display" id="val-volume">${volumeToLongString(z.volume)}</span>
                </div>
              </div>

              <div class="trim-control">
                <label for="slider-pan">PAN (-50 .. +50)</label>
                <div class="control-row">
                  <input type="range" id="slider-pan" min="-50" max="50" value="${Math.round(z.pan)}" step="1" />
                  <span class="val-display" id="val-pan">${panToString(z.pan)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        ${
          isExtended
            ? `<div class="drawer-tab-pane ${activeTab === 'extended' ? 'is-active' : 'is-hidden'}" data-tab-pane="extended">
                ${this.renderExtendedSectionsHtml(z, isExtended)}
              </div>`
            : ''
        }
      </div>
    `;

    this.bindDrawerEvents();
  }

  private renderExtendedSectionsHtml(z: Zone, isExtended: boolean): string {
    if (!isExtended) return '';
    const regions = this.handlers.getExtendedRegions?.() ?? [];
    const activeReg =
      regions.find(
        (r) =>
          r.sampleName === z.sampleLow &&
          r.lowKey <= z.lowKey &&
          r.highKey >= z.highKey
      ) ??
      regions.find((r) => r.sampleName === z.sampleLow) ??
      regions[this.zoneIndex] ??
      null;

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

    return `
      <!-- 1. Fase 7 Acoustic Intelligence & Auto-Classification -->
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
            <span class="stat-chip-val">${cls ? `${cls.descriptors.detectedF0Hz.toFixed(1)} Hz (${midiNoteToString(cls.descriptors.detectedMidiNote)})` : midiNoteToString(z.rootKey)}</span>
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

      <!-- 2. Extended Region Loop, Keytrack, Trigger & Crossfades -->
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

      ${
        art
          ? `
      <!-- 3. Global Synth Articulation & Safe sound.script Mapping (ADSR, Filter, LFO) -->
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
      </div>
      `
          : ''
      }
    `;
  }

  private bindTableEvents(): void {
    if (!this.currentZone) return;
    const z = this.currentZone;

    // Row selection in canonical Zone Table
    const rows = this.container.querySelectorAll<HTMLElement>('tr.zone-table-row');
    rows.forEach((row) => {
      row.addEventListener('click', (e: MouseEvent) => {
        const editBtn = (e.target as HTMLElement).closest<HTMLElement>('.btn-row-edit');
        const zoneId = row.getAttribute('data-zone-id');
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
        const zoneId = row.getAttribute('data-zone-id');
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
      this.handlers.onSplitZone(z.id);
    });

    this.container.querySelector('#btn-delete-zone')?.addEventListener('click', () => {
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

    // Keys inputs
    const inpLow = this.drawerElement.querySelector('#inp-low-key') as HTMLInputElement | null;
    const inpRoot = this.drawerElement.querySelector('#inp-root-key') as HTMLInputElement | null;
    const inpHigh = this.drawerElement.querySelector('#inp-high-key') as HTMLInputElement | null;

    inpLow?.addEventListener('change', () => {
      const val = Math.min(127, Math.max(0, parseInt(inpLow.value, 10) || 0));
      this.handlers.onUpdateZone(z.id, { lowKey: val });
    });

    inpRoot?.addEventListener('change', () => {
      const parsed = parseInt(inpRoot.value, 10);
      const val = Math.min(127, Math.max(0, Number.isNaN(parsed) ? z.rootKey : parsed));
      this.handlers.onUpdateZone(z.id, { rootKey: val });
    });

    inpHigh?.addEventListener('change', () => {
      const val = Math.min(127, Math.max(0, parseInt(inpHigh.value, 10) || 127));
      this.handlers.onUpdateZone(z.id, { highKey: val });
    });

    // Canonical integer Trims: Detune (-99..99), Volume (-32..12 dB), Pan (-50..50)
    const slDetune = this.drawerElement.querySelector('#slider-detune') as HTMLInputElement | null;
    const valDetune = this.drawerElement.querySelector('#val-detune') as HTMLElement | null;
    slDetune?.addEventListener('input', () => {
      const val = Math.max(-99, Math.min(99, parseInt(slDetune.value, 10) || 0));
      if (valDetune) valDetune.textContent = detuneToString(val);
      this.handlers.onUpdateZone(z.id, { detune: val });
    });

    const slVol = this.drawerElement.querySelector('#slider-volume') as HTMLInputElement | null;
    const valVol = this.drawerElement.querySelector('#val-volume') as HTMLElement | null;
    slVol?.addEventListener('input', () => {
      const val = Math.max(-32, Math.min(12, parseInt(slVol.value, 10) || 0));
      if (valVol) valVol.textContent = volumeToLongString(val);
      this.handlers.onUpdateZone(z.id, { volume: val });
    });

    const slPan = this.drawerElement.querySelector('#slider-pan') as HTMLInputElement | null;
    const valPan = this.drawerElement.querySelector('#val-pan') as HTMLElement | null;
    slPan?.addEventListener('input', () => {
      const val = Math.max(-50, Math.min(50, parseInt(slPan.value, 10) || 0));
      if (valPan) valPan.textContent = panToString(val);
      this.handlers.onUpdateZone(z.id, { pan: val });
    });

    // Velocity split slider (Extended Mode only; core clamps 2..127 and
    // forces 64 in classic, so this stays consistent even if reached otherwise)
    const slSplit = this.drawerElement.querySelector('#slider-vel-split') as HTMLInputElement | null;
    const valSplit = this.drawerElement.querySelector('#val-vel-split') as HTMLElement | null;
    slSplit?.addEventListener('input', () => {
      const val = Math.max(2, Math.min(127, parseInt(slSplit.value, 10) || 64));
      if (valSplit) valSplit.textContent = `${val} (1–${val - 1} / ${val}–127)`;
      this.handlers.onUpdateZone(z.id, { velSplit: val });
    });

    // Reuse already-loaded sample dropdowns
    const selReuseLow = this.drawerElement.querySelector('#sel-reuse-low') as HTMLSelectElement | null;
    selReuseLow?.addEventListener('change', () => {
      const chosen = selReuseLow.value || null;
      if (chosen) {
        this.handlers.onUpdateZone(z.id, { sampleLow: chosen });
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

    // Sample Low actions
    const fileInputLow = this.drawerElement.querySelector('#file-input-low') as HTMLInputElement | null;
    this.drawerElement.querySelector('#btn-browse-low')?.addEventListener('click', () => {
      if (this.handlers.onLoadSampleFile && fileInputLow) {
        fileInputLow.click();
      }
    });

    fileInputLow?.addEventListener('change', () => {
      const files = fileInputLow.files;
      if (!files || files.length === 0) return;
      if (files.length > 1 && this.handlers.onDropMultipleFiles) {
        this.handlers.onDropMultipleFiles(files);
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
      } else if (this.handlers.onLoadSampleFile) {
        this.handlers.onLoadSampleFile(z.id, 'low', files[0]);
      }
    });

    this.drawerElement.querySelector('#btn-clear-low')?.addEventListener('click', () => {
      if (z.sampleHigh) {
        this.handlers.onUpdateZone(z.id, { sampleLow: z.sampleHigh, sampleHigh: null });
      } else {
        this.handlers.onUpdateZone(z.id, { sampleLow: null });
      }
    });

    this.drawerElement.querySelector('#btn-play-low')?.addEventListener('click', () => {
      if (z.sampleLow) this.handlers.onAuditionSample(z.sampleLow);
    });

    // Sample High actions
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
    }
  }
}
