import type { InspectorContext } from './types.ts';


export function handleRowPlayClick(ui: InspectorContext, zoneId: string | null, regionId: string | null): void {
  const isExtended = ui.state.workingMode === 'extended';
  const rowKey = isExtended ? (regionId ?? zoneId ?? '') : (zoneId ?? '');
  if (!rowKey) return;

  if (ui.state.playingRowId === rowKey) {
    ui.state.handlers.onStopAudition?.();
    ui.setPlayingRow(null);
    ui.updatePlayButtonStates();
    return;
  }

  const rowIds = {
    zoneId: zoneId || undefined,
    regionId: isExtended && regionId ? regionId : undefined,
  };
  ui.setPlayingRow(rowKey, rowIds);
  ui.updatePlayButtonStates();

  if (ui.state.handlers.onAuditionRow) {
    ui.state.handlers.onAuditionRow(rowIds);
  } else if (isExtended && regionId) {
    ui.state.selectedRegionId = regionId;
    const targetZoneId = zoneId || ui.state.currentZone?.id;
    ui.state.handlers.onAuditionLoop?.({
      zoneId: targetZoneId,
      regionId: regionId,
    });
  } else if (zoneId) {
    ui.state.handlers.onAuditionLoop?.({
      zoneId: zoneId,
      regionId: undefined,
    });
  }

  ui.startAuditionStateMonitor();
}

export function highlightNote(ui: InspectorContext, note: number, hit: { zoneId?: string; layer?: 'low' | 'high'; regionIds: string[] }): void {
  const pending = ui.state.noteReleaseTimers.get(note);
  if (pending !== undefined) {
    clearTimeout(pending);
    ui.state.noteReleaseTimers.delete(note);
  }
  ui.state.activeNoteHits.set(note, { ...hit, regionIds: [...hit.regionIds], startedAt: performance.now() });
  ui.applyNoteHighlights(true);
}

export function releaseNote(ui: InspectorContext, note: number): void {
  const hit = ui.state.activeNoteHits.get(note);
  if (!hit) return;
  const remaining = Math.max(0, 250 - (performance.now() - hit.startedAt));
  const clear = () => {
    ui.state.noteReleaseTimers.delete(note);
    ui.state.activeNoteHits.delete(note);
    ui.applyNoteHighlights(false);
  };
  if (remaining === 0) {
    clear();
  } else {
    ui.state.noteReleaseTimers.set(note, window.setTimeout(clear, remaining));
  }
}
