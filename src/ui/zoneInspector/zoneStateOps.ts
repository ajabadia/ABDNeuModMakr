import type { InspectorContext } from './types.ts';
import { syncActiveDom } from './drawerStateOps.ts';
import type { Zone, WorkingMode, KeyMappingMode, ExtendedRegion } from '../../core/types';


export function setZone(ui: InspectorContext, zone: Zone | null, index: number, total: number, allZones?: Zone[], workingMode?: WorkingMode, keyMappingMode?: KeyMappingMode): void {
  const modeChanged = workingMode !== undefined && workingMode !== ui.state.workingMode;
  const keyMappingChanged =
    keyMappingMode !== undefined && keyMappingMode !== ui.state.keyMappingMode;
  if (workingMode !== undefined) {
    ui.state.workingMode = workingMode;
  }
  if (keyMappingMode !== undefined) {
    ui.state.keyMappingMode = keyMappingMode;
  } else if (ui.state.handlers.getKeyMappingMode) {
    ui.state.keyMappingMode = ui.state.handlers.getKeyMappingMode();
  }
  const sameZone = ui.state.currentZone && zone && ui.state.currentZone.id === zone.id;
  const sameCount = allZones ? allZones.length === ui.state.allZones.length : true;
  const extRegions =
    ui.state.workingMode === 'extended'
      ? (ui.state.handlers.getExtendedRegions?.() ?? [])
      : [];
  const sameRegionCount = extRegions.length === ui.state.lastExtendedRegionCount;
  ui.state.lastExtendedRegionCount = extRegions.length;

  if (!sameZone && zone && ui.state.workingMode === 'extended' && extRegions.length > 0) {
    const currentReg = extRegions.find((r) => r.id === ui.state.selectedRegionId);
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
        ui.state.selectedRegionId = matchReg.id;
      }
    }
  }

  ui.state.currentZone = zone ? { ...zone } : null;
  ui.state.zoneIndex = index;
  ui.state.totalZones = total;
  ui.state.allZones = allZones ? allZones.map((z) => ({ ...z })) : zone ? [{ ...zone }] : [];

  if (ui.state.handlers.isAuditionPlaying && !ui.state.handlers.isAuditionPlaying()) {
    ui.setPlayingRow(null);
  }

  const activeEl = document.activeElement;
  if (
    sameZone &&
    sameCount &&
    sameRegionCount &&
    !modeChanged &&
    !keyMappingChanged &&
    ((activeEl &&
      ui.state.drawerElement &&
      ui.state.drawerElement.contains(activeEl)) ||
      ui.state.isDraggingKnob)
  ) {
    syncActiveDom(ui);
    return;
  }
  ui.renderTable();
  ui.renderDrawer();
}

export function initDrawer(ui: InspectorContext): void {
  ui.state.drawerElement = document.createElement('div');
  ui.state.drawerElement.className = 'zone-metadata-drawer-panel is-closed';
  ui.state.drawerMount.appendChild(ui.state.drawerElement);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      ui.closeToolsMenu();
      if (ui.state.isDrawerOpen) {
        ui.closeDrawer();
      }
    }
  });

  document.addEventListener('click', (e) => {
    const dropdown = ui.state.container.querySelector('#keymap-tools-dropdown');
    if (dropdown && !dropdown.contains(e.target as Node)) {
      ui.closeToolsMenu();
    }
  });
}

export function destroyZoneKnobs(ui: InspectorContext): void {
  if (ui.state.auditionCheckTimer !== null) {
    clearInterval(ui.state.auditionCheckTimer);
    ui.state.auditionCheckTimer = null;
  }
  ui.state.detuneKnob?.destroy();
  ui.state.detuneKnob = null;
  ui.state.volumeKnob?.destroy();
  ui.state.volumeKnob = null;
  ui.state.panKnob?.destroy();
  ui.state.panKnob = null;
}

export function getExtendedContext(ui: InspectorContext): {
    regions: ExtendedRegion[];
    activeRegion: ExtendedRegion | null;
    activeIndex: number;
  } {
  const regions = ui.state.handlers.getExtendedRegions?.() ?? [];
  if (regions.length === 0) {
    return { regions: [], activeRegion: null, activeIndex: 0 };
  }
  let idx = ui.state.selectedRegionId
    ? regions.findIndex((r) => r.id === ui.state.selectedRegionId)
    : -1;
  if (idx < 0 && ui.state.currentZone) {
    const z = ui.state.currentZone;
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
    idx = Math.max(0, Math.min(regions.length - 1, ui.state.zoneIndex));
  }
  const activeRegion = regions[idx] ?? regions[0];
  ui.state.selectedRegionId = activeRegion.id;
  return { regions, activeRegion, activeIndex: idx };
}
