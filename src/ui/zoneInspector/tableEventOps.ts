import type { InspectorContext } from './types.ts';
import { confirmDialog } from '../notify';
import { midiNoteToString } from '../ZoneRibbon';
import type { ExtendedModelMetadata } from '../../core/types';


export function bindTableEvents(ui: InspectorContext): void {
  if (!ui.state.currentZone) return;
  const z = ui.state.currentZone;
  const isExtended = ui.state.workingMode === 'extended';

  // Re-apply live keyboard note highlights after every table re-render
  ui.applyNoteHighlights(false);

  // Row selection in Zone / Region Table
  const rows = ui.state.container.querySelectorAll<HTMLElement>('tr.zone-table-row');
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
        ui.handleRowPlayClick(targetZoneId, targetRegId);
        return;
      }

      if (isExtended && regionId) {
        const regionChanged = regionId !== ui.state.selectedRegionId;
        ui.state.selectedRegionId = regionId;
        if (zoneId && zoneId !== z.id && ui.state.handlers.onSelectZone) {
          ui.state.handlers.onSelectZone(zoneId);
        } else if (regionChanged) {
          ui.renderTable();
          ui.renderDrawer();
        }
        if (loopCellBtn) {
          e.stopPropagation();
          ui.openLoopEditorDrawer(regionId);
          return;
        }
        if (editBtn) {
          e.stopPropagation();
          ui.openDrawer();
        }
        return;
      }

      if (!zoneId) return;
      if (zoneId !== z.id && ui.state.handlers.onSelectZone) {
        ui.state.handlers.onSelectZone(zoneId);
      }
      if (editBtn) {
        e.stopPropagation();
        ui.openDrawer();
      }
    });

    row.addEventListener('dblclick', () => {
      const regionId = row.getAttribute('data-region-id');
      const zoneId = row.getAttribute('data-zone-id');
      if (isExtended && regionId) {
        ui.state.selectedRegionId = regionId;
        if (zoneId && zoneId !== z.id && ui.state.handlers.onSelectZone) {
          ui.state.handlers.onSelectZone(zoneId);
        }
        ui.openDrawer();
        return;
      }
      if (zoneId && zoneId !== z.id && ui.state.handlers.onSelectZone) {
        ui.state.handlers.onSelectZone(zoneId);
      }
      ui.openDrawer();
    });
  });

  ui.state.container.querySelector('#btn-map-mode-chromatic')?.addEventListener('click', () => {
    ui.setKeyMappingMode('chromatic');
  });

  ui.state.container.querySelector('#btn-map-mode-drum')?.addEventListener('click', () => {
    ui.setKeyMappingMode('drum');
  });

  const inputBpm = ui.state.container.querySelector<HTMLInputElement>('#input-keymap-bpm');
  const applyBpmValue = (nextVal: number) => {
    const clamped = Math.max(30, Math.min(300, Math.round(nextVal || 120)));
    ui.state.auditionBpm = clamped;
    if (inputBpm) inputBpm.value = String(clamped);
    ui.state.handlers.onUpdateAuditionBpm?.(clamped);
  };

  inputBpm?.addEventListener('change', () => {
    applyBpmValue(Number(inputBpm.value));
  });
  inputBpm?.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      applyBpmValue(ui.getEffectiveBpm() + (e.shiftKey ? 5 : 1));
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      applyBpmValue(ui.getEffectiveBpm() - (e.shiftKey ? 5 : 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      applyBpmValue(Number(inputBpm.value));
      inputBpm.blur();
    }
  });

  ui.state.container.querySelector('#btn-keymap-bpm-dec')?.addEventListener('click', (e) => {
    const step = (e as MouseEvent).shiftKey ? 5 : 1;
    applyBpmValue(ui.getEffectiveBpm() - step);
  });

  ui.state.container.querySelector('#btn-keymap-bpm-inc')?.addEventListener('click', (e) => {
    const step = (e as MouseEvent).shiftKey ? 5 : 1;
    applyBpmValue(ui.getEffectiveBpm() + step);
  });

  ui.state.container.querySelector('#btn-keymap-play-seq')?.addEventListener('click', () => {
    ui.toggleSequencePlayback();
  });

  ui.state.container.querySelector('#btn-keymap-tools-toggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const popover = ui.state.container.querySelector('#keymap-tools-popover');
    const toggle = ui.state.container.querySelector('#btn-keymap-tools-toggle');
    const willOpen = !popover?.classList.contains('is-open');
    popover?.classList.toggle('is-open', willOpen);
    toggle?.classList.toggle('is-active', willOpen);
    toggle?.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  });

  ui.state.container.querySelector('#btn-open-loop-drawer')?.addEventListener('click', () => {
    ui.closeToolsMenu();
    ui.openLoopEditorDrawer();
  });

  ui.state.container.querySelector('#btn-autoloop-all-zones')?.addEventListener('click', () => {
    ui.closeToolsMenu();
    ui.state.handlers.onAutoLoopAllZones?.();
  });

  ui.state.container.querySelector('#btn-open-autoslicer')?.addEventListener('click', () => {
    ui.closeToolsMenu();
    ui.state.handlers.onOpenAutoSlicer?.();
  });

  ui.state.container.querySelector('#btn-open-recorder')?.addEventListener('click', () => {
    ui.closeToolsMenu();
    ui.state.handlers.onOpenAudioRecorder?.();
  });

  ui.state.container.querySelector('#btn-open-zone-drawer')?.addEventListener('click', () => {
    ui.toggleDrawer();
  });

  ui.state.container
    .querySelector('#btn-open-model-common-drawer')
    ?.addEventListener('click', () => {
      ui.openModelCommonDrawer();
    });

  ui.state.container.querySelector('#btn-toggle-spectral')?.addEventListener('click', () => {
    ui.state.handlers.onToggleSpectral?.();
  });

  ui.state.container.querySelector('#btn-split-zone')?.addEventListener('click', () => {
    if (isExtended && ui.state.handlers.onAddExtendedRegion) {
      const { activeRegion } = ui.getExtendedContext();
      // Create a new empty-sample region at the next available key/velocity range
      ui.state.handlers.onAddExtendedRegion(undefined, activeRegion?.id);
      return;
    }
    ui.state.handlers.onSplitZone(z.id);
  });

  ui.state.container.querySelector('#btn-delete-zone')?.addEventListener('click', () => {
    if (isExtended && ui.state.handlers.onRemoveExtendedRegion) {
      const { activeRegion, activeIndex } = ui.getExtendedContext();
      if (!activeRegion) return;
      void confirmDialog(
        `Remove region #${activeIndex + 1} (${midiNoteToString(activeRegion.lowKey)} .. ${midiNoteToString(activeRegion.highKey)}, Vel ${activeRegion.lowVel}..${activeRegion.highVel})?`,
        { confirmLabel: 'Remove region', danger: true }
      ).then((ok) => {
        if (ok) {
          ui.state.selectedRegionId = null;
          ui.state.handlers.onRemoveExtendedRegion!(activeRegion.id);
        }
      });
      return;
    }
    void confirmDialog(
      `Remove zone #${ui.state.zoneIndex + 1} (${midiNoteToString(z.lowKey)} .. ${midiNoteToString(z.highKey)})? Adjacent zones will expand to maintain 0..127 coverage.`,
      { confirmLabel: 'Remove zone', danger: true }
    ).then((ok) => {
      if (ok) ui.state.handlers.onDeleteZone(z.id);
    });
  });
}

export function bindDrawerMetadataEvents(ui: InspectorContext): void {
  if (!ui.state.drawerElement) return;

  const getMeta = (): ExtendedModelMetadata => {
    return ui.state.handlers.getExtendedMetadata?.() ?? {};
  };

  const updateMeta = (changes: Partial<ExtendedModelMetadata>) => {
    const cur = getMeta();
    const updated: ExtendedModelMetadata = {
      ...cur,
      ...changes,
    };
    ui.state.handlers.onUpdateExtendedMetadata?.(updated);
  };

  const authorInp = ui.state.drawerElement.querySelector('#drawer-meta-inp-author') as HTMLInputElement | null;
  authorInp?.addEventListener('input', () => {
    updateMeta({ author: authorInp.value.trim() });
  });

  const versionInp = ui.state.drawerElement.querySelector('#drawer-meta-inp-version') as HTMLInputElement | null;
  versionInp?.addEventListener('input', () => {
    updateMeta({ version: versionInp.value.trim() });
  });

  const licenseInp = ui.state.drawerElement.querySelector('#drawer-meta-inp-license') as HTMLInputElement | null;
  licenseInp?.addEventListener('input', () => {
    updateMeta({ license: licenseInp.value.trim() });
  });

  const urlInp = ui.state.drawerElement.querySelector('#drawer-meta-inp-source-url') as HTMLInputElement | null;
  urlInp?.addEventListener('input', () => {
    updateMeta({ sourceUrl: urlInp.value.trim() });
  });

  const descInp = ui.state.drawerElement.querySelector('#drawer-meta-inp-description') as HTMLTextAreaElement | null;
  descInp?.addEventListener('input', () => {
    updateMeta({ description: descInp.value.trim() });
  });

  ui.state.drawerElement.querySelector('#btn-drawer-add-meta-tag')?.addEventListener('click', () => {
    const cur = getMeta();
    const attrs = [...(cur.customAttributes ?? [])];
    attrs.push({ tag: '', value: '' });
    updateMeta({ customAttributes: attrs });
    ui.renderDrawer();
  });

  ui.state.drawerElement.querySelectorAll<HTMLSelectElement>('.sel-drawer-meta-tag').forEach((sel) => {
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
        ui.renderDrawer();
      }
    });
  });

  ui.state.drawerElement.querySelectorAll<HTMLInputElement>('.inp-drawer-meta-tag').forEach((inp) => {
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

  ui.state.drawerElement.querySelectorAll<HTMLInputElement>('.inp-drawer-meta-val').forEach((inp) => {
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

  ui.state.drawerElement.querySelectorAll<HTMLButtonElement>('.btn-drawer-remove-meta-tag').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index ?? '-1', 10);
      const cur = getMeta();
      const attrs = [...(cur.customAttributes ?? [])];
      if (idx >= 0 && idx < attrs.length) {
        attrs.splice(idx, 1);
        updateMeta({ customAttributes: attrs });
        ui.renderDrawer();
      }
    });
  });
}
