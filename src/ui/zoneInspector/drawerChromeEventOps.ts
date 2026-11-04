import type { InspectorContext } from './types.ts';
import type { ExtendedRegion, Zone } from '../../core/types.ts';
import { Knob } from '@abdsynths/shared/components';
import { formatGmDrumLabel } from '../../core/gmDrumMap.ts';
import { detuneToString, midiToNoteName, panToString, volumeToLongString } from '../ZoneRibbon.ts';

export function bindDrawerChromeEvents(ui: InspectorContext, z: Zone, isExtended: boolean, activeReg: ExtendedRegion | null): void {
  if (!ui.state.drawerElement) return;
  ui.state.drawerElement.querySelector('#btn-close-zone-drawer')?.addEventListener('click', () => {
    ui.closeDrawer();
  });

  ui.state.drawerElement.querySelector('#btn-drawer-open-model-config')?.addEventListener('click', () => {
    ui.state.handlers.onOpenModelConfig?.('general');
  });

  ui.state.drawerElement.querySelector('#btn-drawer-invoke-loop')?.addEventListener('click', () => {
    ui.state.handlers.onOpenLoopEditor?.();
  });

  ui.state.drawerElement.querySelector('#btn-drawer-invoke-slicer')?.addEventListener('click', () => {
    ui.state.handlers.onOpenAutoSlicer?.();
  });

  ui.state.drawerElement.querySelector('#btn-drawer-invoke-recorder')?.addEventListener('click', () => {
    ui.state.handlers.onOpenAudioRecorder?.();
  });

  ui.state.drawerElement.querySelectorAll('#btn-sample-card-wizard').forEach((btn) => {
    btn.addEventListener('click', () => {
      ui.state.handlers.onOpenWizardFromZoneSample?.({
        zoneId: z.id,
        slot: 'low',
        regionId: isExtended && activeReg ? activeReg.id : undefined,
      });
    });
  });

  ui.state.drawerElement.querySelectorAll('#btn-sample-card-slicer').forEach((btn) => {
    btn.addEventListener('click', () => {
      ui.state.handlers.onOpenAutoSlicer?.();
    });
  });

  ui.state.drawerElement.querySelectorAll('#btn-sample-card-loop').forEach((btn) => {
    btn.addEventListener('click', () => {
      ui.state.handlers.onOpenLoopEditor?.();
    });
  });

  ui.state.drawerElement.querySelectorAll('#btn-sample-card-recorder').forEach((btn) => {
    btn.addEventListener('click', () => {
      ui.state.handlers.onOpenAudioRecorder?.();
    });
  });
}

export function bindDrawerAutoDetectEvents(ui: InspectorContext, z: Zone): void {
  if (!ui.state.drawerElement) return;
  // Fase 7 Auto-Detect Pitch & Parameter Set buttons
  const triggerAutoDetect = () => {
    ui.state.handlers.onAutoDetectZone?.(z.id);
    ui.renderDrawer();
  };
  ui.state.drawerElement
    .querySelector('#btn-auto-detect-zone-general')
    ?.addEventListener('click', triggerAutoDetect);
  ui.state.drawerElement
    .querySelector('#btn-auto-detect-zone-ext')
    ?.addEventListener('click', triggerAutoDetect);
}

export function bindDrawerKeysEvents(ui: InspectorContext, z: Zone, isExtended: boolean, activeReg: ExtendedRegion | null): void {
  if (!ui.state.drawerElement) return;
  // Keys & Velocity inputs
  const inpLow = ui.state.drawerElement.querySelector('#inp-low-key') as HTMLInputElement | null;
  const inpRoot = ui.state.drawerElement.querySelector('#inp-root-key') as HTMLInputElement | null;
  const inpHigh = ui.state.drawerElement.querySelector('#inp-high-key') as HTMLInputElement | null;
  const inpExtLowVel = ui.state.drawerElement.querySelector('#inp-ext-low-vel') as HTMLInputElement | null;
  const inpExtHighVel = ui.state.drawerElement.querySelector('#inp-ext-high-vel') as HTMLInputElement | null;
  const selGmDrum = ui.state.drawerElement.querySelector('#sel-gm-drum') as HTMLSelectElement | null;

  selGmDrum?.addEventListener('change', () => {
    const targetKey = parseInt(selGmDrum.value, 10);
    if (Number.isNaN(targetKey) || targetKey < 0 || targetKey > 127) return;

    if (isExtended && activeReg && ui.state.handlers.onUpdateExtendedRegion) {
      ui.state.handlers.onUpdateExtendedRegion(activeReg.id, {
        rootKey: targetKey,
        lowKey: targetKey,
        highKey: targetKey,
      });
    } else if (ui.state.handlers.onUpdateZone) {
      ui.state.handlers.onUpdateZone(z.id, {
        rootKey: targetKey,
        lowKey: targetKey,
        highKey: targetKey,
      });
    }
  });

  inpLow?.addEventListener('input', () => {
    const v = parseInt(inpLow.value, 10);
    if (!Number.isNaN(v) && v >= 0 && v <= 127) {
      const d = ui.state.drawerElement?.querySelector('#disp-low-note');
      if (d) d.textContent = midiToNoteName(v);
    }
  });

  inpLow?.addEventListener('change', () => {
    const val = Math.min(127, Math.max(0, parseInt(inpLow.value, 10) || 0));
    if (isExtended && activeReg && ui.state.handlers.onUpdateExtendedRegion) {
      ui.state.handlers.onUpdateExtendedRegion(activeReg.id, { lowKey: val });
    } else {
      ui.state.handlers.onUpdateZone(z.id, { lowKey: val });
    }
  });

  inpRoot?.addEventListener('input', () => {
    const v = parseInt(inpRoot.value, 10);
    if (!Number.isNaN(v) && v >= 0 && v <= 127) {
      const d = ui.state.drawerElement?.querySelector('#disp-root-note');
      if (d) {
        d.textContent =
          ui.state.keyMappingMode === 'drum'
            ? formatGmDrumLabel(v)
            : midiToNoteName(v);
      }
    }
  });

  inpRoot?.addEventListener('change', () => {
    const parsed = parseInt(inpRoot.value, 10);
    const fallback = isExtended && activeReg ? activeReg.rootKey : z.rootKey;
    const val = Math.min(127, Math.max(0, Number.isNaN(parsed) ? fallback : parsed));
    if (ui.state.keyMappingMode === 'drum' && selGmDrum) {
      selGmDrum.value = String(val);
    }
    if (isExtended && activeReg && ui.state.handlers.onUpdateExtendedRegion) {
      ui.state.handlers.onUpdateExtendedRegion(activeReg.id, {
        rootKey: val,
        ...(ui.state.keyMappingMode === 'drum' ? { lowKey: val, highKey: val } : {}),
      });
    } else {
      ui.state.handlers.onUpdateZone(z.id, {
        rootKey: val,
        ...(ui.state.keyMappingMode === 'drum' ? { lowKey: val, highKey: val } : {}),
      });
    }
  });

  inpHigh?.addEventListener('input', () => {
    const v = parseInt(inpHigh.value, 10);
    if (!Number.isNaN(v) && v >= 0 && v <= 127) {
      const d = ui.state.drawerElement?.querySelector('#disp-high-note');
      if (d) d.textContent = midiToNoteName(v);
    }
  });

  inpHigh?.addEventListener('change', () => {
    const val = Math.min(127, Math.max(0, parseInt(inpHigh.value, 10) || 127));
    if (isExtended && activeReg && ui.state.handlers.onUpdateExtendedRegion) {
      ui.state.handlers.onUpdateExtendedRegion(activeReg.id, { highKey: val });
    } else {
      ui.state.handlers.onUpdateZone(z.id, { highKey: val });
    }
  });

  inpExtLowVel?.addEventListener('change', () => {
    if (!activeReg || !ui.state.handlers.onUpdateExtendedRegion) return;
    const val = Math.min(127, Math.max(1, parseInt(inpExtLowVel.value, 10) || 1));
    const newHigh = Math.max(val, activeReg.highVel);
    ui.state.handlers.onUpdateExtendedRegion(activeReg.id, { lowVel: val, highVel: newHigh });
  });

  inpExtHighVel?.addEventListener('change', () => {
    if (!activeReg || !ui.state.handlers.onUpdateExtendedRegion) return;
    const val = Math.min(127, Math.max(1, parseInt(inpExtHighVel.value, 10) || 127));
    const newLow = Math.min(val, activeReg.lowVel);
    ui.state.handlers.onUpdateExtendedRegion(activeReg.id, { lowVel: newLow, highVel: val });
  });
}

export function bindDrawerKnobsEvents(ui: InspectorContext, z: Zone, isExtended: boolean, activeReg: ExtendedRegion | null): void {
  if (!ui.state.drawerElement) return;
  // Canonical integer Trims via @abdsynths/shared Knob:
  // Detune (-99..+99, center 0), Volume (-32..+12 dB, default 0 dB), Pan (-50..+50, center 0)
  const initDetuneVal = isExtended && activeReg ? activeReg.detune : z.detune;
  const initVolVal = isExtended && activeReg ? activeReg.volume : z.volume;
  const initPanVal = isExtended && activeReg ? activeReg.pan : z.pan;

  const detuneMount = ui.state.drawerElement.querySelector('#knob-zone-detune') as HTMLElement | null;
  const valDetune = ui.state.drawerElement.querySelector('#val-detune') as HTMLElement | null;
  if (detuneMount) {
    const initDetuneNorm = Math.max(0, Math.min(1, (Math.round(initDetuneVal) + 99) / 198));
    ui.state.detuneKnob = new Knob(detuneMount, {
      size: 38,
      value: 0.5, // double-click resets to 0 cents
      bipolar: true,
      step: 1 / 198,
      label: 'DETUNE',
      format: (normVal: number) => detuneToString(Math.round(normVal * 198 - 99)),
      onDragStart: () => {
        ui.state.isDraggingKnob = true;
      },
      onDragEnd: () => {
        ui.state.isDraggingKnob = false;
      },
      onChange: (normVal: number) => {
        const val = Math.max(-99, Math.min(99, Math.round(normVal * 198 - 99)));
        if (valDetune) valDetune.textContent = detuneToString(val);
        if (isExtended && activeReg && ui.state.handlers.onUpdateExtendedRegion) {
          ui.state.handlers.onUpdateExtendedRegion(activeReg.id, { detune: val });
        } else {
          ui.state.handlers.onUpdateZone(z.id, { detune: val });
        }
      },
    });
    ui.state.detuneKnob.setValue(initDetuneNorm);
  }

  const volMount = ui.state.drawerElement.querySelector('#knob-zone-volume') as HTMLElement | null;
  const valVol = ui.state.drawerElement.querySelector('#val-volume') as HTMLElement | null;
  if (volMount) {
    const initVolNorm = Math.max(0, Math.min(1, (Math.round(initVolVal) + 32) / 44));
    ui.state.volumeKnob = new Knob(volMount, {
      size: 38,
      value: 32 / 44, // double-click resets to 0 dB
      bipolar: false,
      step: 1 / 44,
      label: 'VOLUME',
      format: (normVal: number) => volumeToLongString(Math.round(normVal * 44 - 32)),
      onDragStart: () => {
        ui.state.isDraggingKnob = true;
      },
      onDragEnd: () => {
        ui.state.isDraggingKnob = false;
      },
      onChange: (normVal: number) => {
        const val = Math.max(-32, Math.min(12, Math.round(normVal * 44 - 32)));
        if (valVol) valVol.textContent = volumeToLongString(val);
        if (isExtended && activeReg && ui.state.handlers.onUpdateExtendedRegion) {
          ui.state.handlers.onUpdateExtendedRegion(activeReg.id, { volume: val });
        } else {
          ui.state.handlers.onUpdateZone(z.id, { volume: val });
        }
      },
    });
    ui.state.volumeKnob.setValue(initVolNorm);
  }

  const panMount = ui.state.drawerElement.querySelector('#knob-zone-pan') as HTMLElement | null;
  const valPan = ui.state.drawerElement.querySelector('#val-pan') as HTMLElement | null;
  if (panMount) {
    const initPanNorm = Math.max(0, Math.min(1, (Math.round(initPanVal) + 50) / 100));
    ui.state.panKnob = new Knob(panMount, {
      size: 38,
      value: 0.5, // double-click resets to 0 (center)
      bipolar: true,
      step: 1 / 100,
      label: 'PAN',
      format: (normVal: number) => panToString(Math.round(normVal * 100 - 50)),
      onDragStart: () => {
        ui.state.isDraggingKnob = true;
      },
      onDragEnd: () => {
        ui.state.isDraggingKnob = false;
      },
      onChange: (normVal: number) => {
        const val = Math.max(-50, Math.min(50, Math.round(normVal * 100 - 50)));
        if (valPan) valPan.textContent = panToString(val);
        if (isExtended && activeReg && ui.state.handlers.onUpdateExtendedRegion) {
          ui.state.handlers.onUpdateExtendedRegion(activeReg.id, { pan: val });
        } else {
          ui.state.handlers.onUpdateZone(z.id, { pan: val });
        }
      },
    });
    ui.state.panKnob.setValue(initPanNorm);
  }
}

export function bindDrawerReuseEvents(ui: InspectorContext, z: Zone, isExtended: boolean, activeReg: ExtendedRegion | null): void {
  if (!ui.state.drawerElement) return;
  // Reuse already-loaded sample dropdowns
  const selReuseLow = ui.state.drawerElement.querySelector('#sel-reuse-low') as HTMLSelectElement | null;
  selReuseLow?.addEventListener('change', () => {
    const chosen = selReuseLow.value || null;
    if (chosen) {
      if (isExtended && activeReg && ui.state.handlers.onUpdateExtendedRegion) {
        ui.state.handlers.onUpdateExtendedRegion(activeReg.id, { sampleName: chosen });
      } else {
        ui.state.handlers.onUpdateZone(z.id, { sampleLow: chosen });
      }
    }
  });

  const selReuseHigh = ui.state.drawerElement.querySelector('#sel-reuse-high') as HTMLSelectElement | null;
  selReuseHigh?.addEventListener('change', () => {
    const chosen = selReuseHigh.value || null;
    if (chosen && !z.sampleLow) {
      ui.state.handlers.onUpdateZone(z.id, { sampleLow: chosen, sampleHigh: null });
    } else {
      ui.state.handlers.onUpdateZone(z.id, { sampleHigh: chosen });
    }
  });
}
