// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Zone Table & Sliding Zone Metadata Drawer
// Implements the canonical Hartmann MODELmaker v1.2 ZoneTableModel
// (Zone, Low Key, Root Key, High Key, Low Vel, High Vel, Detune,
// Volume, Pan) with full vertical height (up to 128 zones) and a
// right-side sliding drawer for Zone Metadata editing.
// ─────────────────────────────────────────────────────────

import type { WorkingMode, Zone } from '../core/types';
import {
  midiNoteToString,
  detuneToString,
  volumeToLongString,
  panToString,
} from './ZoneRibbon';
import { ICONS } from './icons';

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

      <div class="drawer-body zone-drawer-body">
        <!-- 1. Key Range & Root -->
        <div class="inspector-section section-keys">
          <div class="section-title">KEY ZONE BOUNDARIES (MIDI 0 C-2 .. 127 G8)</div>
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
                  <input type="file" id="file-input-low" accept=".wav,.aif,.aiff" multiple style="display:none" />
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
                  <input type="file" id="file-input-high" accept=".wav,.aif,.aiff" style="display:none" />
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
              <input type="range" id="slider-vel-split" min="${isExtended ? 2 : 64}" max="${isExtended ? 127 : 64}" value="${split}" ${isExtended ? '' : 'disabled'} title="${isExtended ? `Extended Mode: velocity split point (Low Vel 1..${split - 1} / High Vel ${split}..127). Stored in the session; legacy .model binaries always render the canonical 1..63 / 64..127 layers.` : 'Classic Mode strictly uses the Hartmann MODELmaker v1.2 fixed velocity split (Low Vel 1..63 / High Vel 64..127). Switch WORKING MODE → Extended (requires modern-neural export) to edit.'}" />
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
    `;

    this.bindDrawerEvents();
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
      if (
        confirm(
          `Remove zone #${this.zoneIndex + 1} (${midiNoteToString(z.lowKey)} .. ${midiNoteToString(z.highKey)})? Adjacent zones will expand to maintain 0..127 coverage.`
        )
      ) {
        this.handlers.onDeleteZone(z.id);
      }
    });
  }

  private bindDrawerEvents(): void {
    if (!this.drawerElement || !this.currentZone) return;
    const z = this.currentZone;

    this.drawerElement.querySelector('#btn-close-zone-drawer')?.addEventListener('click', () => {
      this.closeDrawer();
    });

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
  }
}
