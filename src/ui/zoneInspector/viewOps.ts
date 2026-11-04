import type { InspectorContext } from './types.ts';
import { renderExtendedRegionTableRows as tplRenderExtendedRegionTableRows, renderGmDrumOptions as tplRenderGmDrumOptions, renderZoneTableRows as tplRenderZoneTableRows } from './zoneTemplates.ts';
import type { Zone, ExtendedRegion } from '../../core/types';


export function openDrawer(ui: InspectorContext): void {
  ui.state.isDrawerOpen = true;
  ui.state.drawerElement?.classList.remove('is-closed');
  ui.renderDrawer();
}

export function openLoopEditorDrawer(ui: InspectorContext, regionId?: string): void {
  if (regionId) {
    ui.state.selectedRegionId = regionId;
  }
  ui.state.handlers.onOpenLoopEditor?.();
}

export function openModelCommonDrawer(ui: InspectorContext): void {
  if (ui.state.handlers.onOpenModelConfig) {
    ui.state.handlers.onOpenModelConfig('general');
  } else {
    openDrawer(ui, );
  }
}

export function openModelMetadataDrawer(ui: InspectorContext): void {
  if (ui.state.handlers.onOpenModelConfig) {
    ui.state.handlers.onOpenModelConfig('metadata');
  } else {
    openDrawer(ui, );
  }
}

export function closeDrawer(ui: InspectorContext): void {
  ui.state.isDrawerOpen = false;
  ui.state.drawerElement?.classList.add('is-closed');
}

export function toggleDrawer(ui: InspectorContext): void {
  if (ui.state.isDrawerOpen) {
    closeDrawer(ui, );
  } else {
    openDrawer(ui, );
  }
}

export function closeToolsMenu(ui: InspectorContext): void {
  const popover = ui.state.container.querySelector('#keymap-tools-popover');
  const toggle = ui.state.container.querySelector('#btn-keymap-tools-toggle');
  popover?.classList.remove('is-open');
  toggle?.classList.remove('is-active');
  toggle?.setAttribute('aria-expanded', 'false');
}

export function setSpectralVisible(ui: InspectorContext, visible: boolean): void {
  ui.state.isSpectralVisible = visible;
  const btn = ui.state.container.querySelector('#btn-toggle-spectral');
  if (btn) {
    btn.classList.toggle('is-active', visible);
  }
}

export function renderZoneTableRows(ui: InspectorContext, zones: Zone[], activeId: string): string {
  return tplRenderZoneTableRows(zones, activeId, {
    keyMappingMode: ui.state.keyMappingMode,
    playingRowId: ui.state.playingRowId,
  });
}

export function renderExtendedRegionTableRows(ui: InspectorContext, regions: ExtendedRegion[], activeRegionId: string): string {
  return tplRenderExtendedRegionTableRows(regions, activeRegionId, ui.state.allZones, ui.state.currentZone, {
    keyMappingMode: ui.state.keyMappingMode,
    playingRowId: ui.state.playingRowId,
  });
}

export function renderGmDrumOptions(ui: InspectorContext, currentKey: number, currentId: string): string {
  const isExtended = ui.state.workingMode === 'extended';
  const items = isExtended
    ? ui.getExtendedContext().regions.map((r, i) => ({ id: r.id, index: i + 1, rootKey: r.rootKey }))
    : ui.state.allZones.map((z, i) => ({ id: z.id, index: i + 1, rootKey: z.rootKey }));
  return tplRenderGmDrumOptions(currentKey, currentId, items);
}
