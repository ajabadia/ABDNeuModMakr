import type { InspectorContext } from './types.ts';
import { ICONS } from '../icons';


export function toggleSequencePlayback(ui: InspectorContext): void {
  if (ui.state.isPlayingSequence) {
    stopSequencePlayback(ui, true);
    return;
  }

  const isExtended = ui.state.workingMode === 'extended';
  const steps: Array<{ rowKey: string; zoneId?: string; regionId?: string }> = [];

  if (isExtended) {
    const regions = [...(ui.state.handlers.getExtendedRegions?.() ?? [])]
      .filter((r) => Boolean(r.sampleName))
      .sort((a, b) => a.lowKey - b.lowKey || a.rootKey - b.rootKey);
    for (const r of regions) {
      steps.push({ rowKey: r.id, zoneId: ui.state.currentZone?.id, regionId: r.id });
    }
  } else {
    const zones = [...(ui.state.allZones.length > 0 ? ui.state.allZones : ui.state.currentZone ? [ui.state.currentZone] : [])]
      .filter((z) => Boolean(z.sampleLow || z.sampleHigh))
      .sort((a, b) => a.lowKey - b.lowKey || a.rootKey - b.rootKey);
    for (const z of zones) {
      steps.push({ rowKey: z.id, zoneId: z.id });
    }
  }

  if (steps.length === 0) return;

  ui.state.isPlayingSequence = true;
  ui.renderTable();

  let stepIdx = 0;
  const playStep = () => {
    if (!ui.state.isPlayingSequence) return;
    const step = steps[stepIdx % steps.length];
    stepIdx++;

    setPlayingRow(ui, step.rowKey, { zoneId: step.zoneId, regionId: step.regionId });
    updatePlayButtonStates(ui, );
    if (ui.state.handlers.onAuditionRow) {
      ui.state.handlers.onAuditionRow({ zoneId: step.zoneId, regionId: step.regionId });
    } else if (step.zoneId) {
      ui.state.handlers.onAuditionLoop?.({ zoneId: step.zoneId, regionId: step.regionId });
    }

    const bpm = Math.max(30, Math.min(300, getEffectiveBpm(ui, )));
    // 1/8th note step duration (in ms) synced to active BPM
    const stepMs = Math.max(80, Math.round((60 / bpm / 2) * 1000));
    ui.state.seqPlayTimer = window.setTimeout(playStep, stepMs);
  };

  playStep();
}

export function stopSequencePlayback(ui: InspectorContext, stopAudio = true): void {
  if (ui.state.seqPlayTimer !== null) {
    clearTimeout(ui.state.seqPlayTimer);
    ui.state.seqPlayTimer = null;
  }
  if (!ui.state.isPlayingSequence) return;
  ui.state.isPlayingSequence = false;
  if (stopAudio) {
    ui.state.handlers.onStopAudition?.();
  }
  setPlayingRow(ui, null);
  ui.renderTable();
}

export function setPlayingRow(ui: InspectorContext, rowKey: string | null, ids?: { zoneId?: string; regionId?: string }): void {
  const changed = rowKey !== ui.state.playingRowId;
  ui.state.playingRowId = rowKey;
  ui.state.playingRowStartedAt = rowKey ? performance.now() : 0;
  if (rowKey) {
    ui.state.handlers.onRowAuditionChange?.(ids ?? {});
  } else if (changed) {
    ui.state.handlers.onRowAuditionChange?.(null);
  }
}

export function updatePlayButtonStates(ui: InspectorContext): void {
  const playButtons = ui.state.container.querySelectorAll<HTMLButtonElement>('.btn-row-play');
  playButtons.forEach((btn) => {
    const rowId = btn.getAttribute('data-play-row-id');
    const isPlaying = ui.state.playingRowId !== null && rowId === ui.state.playingRowId;
    btn.classList.toggle('is-playing', isPlaying);
    btn.innerHTML = isPlaying ? ICONS.stop : ICONS.play;
    btn.setAttribute(
      'title',
      isPlaying
        ? 'Stop auditioning'
        : 'Audition sample (Loop, DAHDSR Envelopes, Volume, Pan, Detune)'
    );
  });

  const isExtended = ui.state.workingMode === 'extended';
  const activeReg = isExtended ? ui.getExtendedContext().activeRegion : null;
  const rowKey = isExtended ? (activeReg?.id ?? ui.state.currentZone?.id ?? '') : (ui.state.currentZone?.id ?? '');
  const isDrawerPlaying = ui.state.playingRowId !== null && ui.state.playingRowId === rowKey;

  const drawerStatusDot = ui.state.drawerElement?.querySelector('.drawer-waveform-status-info .status-indicator-dot');
  const drawerStatusText = ui.state.drawerElement?.querySelector('.drawer-waveform-status-info .status-text');
  if (drawerStatusDot) drawerStatusDot.classList.toggle('is-active', isDrawerPlaying);
  if (drawerStatusText) {
    drawerStatusText.textContent = isDrawerPlaying
      ? 'Auditioning (Synced with Table Play)'
      : 'Ready for audition (Volume, Pan, Detune & Loop applied)';
  }
}

export function clearPlayingRow(ui: InspectorContext): void {
  stopSequencePlayback(ui, false);
  if (!ui.state.playingRowId) return;
  setPlayingRow(ui, null);
  updatePlayButtonStates(ui, );
}

export function getEffectiveBpm(ui: InspectorContext): number {
  const fromHandler = ui.state.handlers.getAuditionBpm?.();
  if (fromHandler && fromHandler >= 30 && fromHandler <= 300) {
    ui.state.auditionBpm = Math.round(fromHandler);
  }
  return ui.state.auditionBpm;
}

export function startAuditionStateMonitor(ui: InspectorContext): void {
  if (ui.state.auditionCheckTimer !== null) {
    clearInterval(ui.state.auditionCheckTimer);
    ui.state.auditionCheckTimer = null;
  }
  ui.state.auditionCheckTimer = window.setInterval(() => {
    if (ui.state.playingRowId) {
      // Grace period: decoding/AudioContext resume may delay the actual start
      if (performance.now() - ui.state.playingRowStartedAt < 600) return;
      const isPlaying = ui.state.handlers.isAuditionPlaying?.() ?? false;
      if (!isPlaying) {
        setPlayingRow(ui, null);
        updatePlayButtonStates(ui, );
        if (ui.state.auditionCheckTimer !== null) {
          clearInterval(ui.state.auditionCheckTimer);
          ui.state.auditionCheckTimer = null;
        }
      }
    } else {
      if (ui.state.auditionCheckTimer !== null) {
        clearInterval(ui.state.auditionCheckTimer);
        ui.state.auditionCheckTimer = null;
      }
    }
  }, 150);
}
