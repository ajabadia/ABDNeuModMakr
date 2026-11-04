import { escHtml } from '../escape.ts';
import { MUSICIAN_TERMS } from '../preflightGateView.ts';
import type { ContextMenuItem } from '../AudioChopperModal.ts';
import { captureNoisePrintFromRegion } from '../../../vendor/@abdsynths/shared/Code/DspCore/TakeDsp/index.ts';
import { ICONS } from '../icons.ts';
import { toast } from '../notify.ts';
import { clamp } from '../../core/dsp/DspMath.ts';
import { deleteSlice, extractBoundaryFrames, moveSliceBoundary, splitSliceAtFrame } from '../../core/dsp/AudioSlicerEngine.ts';
import type { ChopperContext } from './types.ts';
import { drawMagnifierCanvas, drawWaveformCanvas } from './canvasOps.ts';
import { refreshTable, updateMagnifierHeader } from './renderOps.ts';

export function bindCanvasInteraction(ui: ChopperContext): void {
  if (!ui.state.backdropEl) return;
  const canvas = ui.state.backdropEl.querySelector('#chopper-waveform-canvas') as HTMLCanvasElement | null;
  if (!canvas) return;

  const getFrameFromMouseX = (clientX: number): number => {
    const rect = canvas.getBoundingClientRect();
    const clickXNorm = clamp((clientX - rect.left) / rect.width, 0, 1);
    const totalFrames = ui.state.pcm.length;
    const zoom = clamp(ui.state.zoomFactor, 1, 16);
    const windowFrames = Math.max(64, Math.round(totalFrames / zoom));
    const centerFrame = clamp(Math.round(ui.state.viewCenterNorm * totalFrames), 0, totalFrames);
    const viewStart = clamp(centerFrame - Math.floor(windowFrames * 0.5), 0, Math.max(0, totalFrames - windowFrames));
    return Math.round(viewStart + clickXNorm * windowFrames);
  };

  const getXFromFrame = (frame: number): number => {
    const rect = canvas.getBoundingClientRect();
    const totalFrames = ui.state.pcm.length;
    const zoom = clamp(ui.state.zoomFactor, 1, 16);
    const windowFrames = Math.max(64, Math.round(totalFrames / zoom));
    const centerFrame = clamp(Math.round(ui.state.viewCenterNorm * totalFrames), 0, totalFrames);
    const viewStart = clamp(centerFrame - Math.floor(windowFrames * 0.5), 0, Math.max(0, totalFrames - windowFrames));
    const viewSpan = Math.max(1, windowFrames);
    return ((frame - viewStart) / viewSpan) * rect.width;
  };

  // Hover & Drag detection for overview boundary lines
  canvas.addEventListener('mousemove', (e: MouseEvent) => {
    if (ui.state.isDraggingBoundary) {
      if (!ui.state.currentResult) return;
      const targetFrame = getFrameFromMouseX(e.clientX);
      ui.state.currentResult = moveSliceBoundary(
        ui.state.currentResult,
        ui.state.pcm,
        ui.state.sampleRate,
        ui.state.draggedBoundaryIndex,
        targetFrame,
        ui.state.options.snapZeroCrossing,
        ui.state.options
      );
      ui.state.activeBoundaryIndex = ui.state.draggedBoundaryIndex;
      drawWaveformCanvas(ui, );
      drawMagnifierCanvas(ui, );
      updateMagnifierHeader(ui, );
      refreshTable(ui, );
      return;
    }

    if (!ui.state.currentResult || ui.state.pcm.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const boundaries = extractBoundaryFrames(ui.state.currentResult, ui.state.pcm.length);

    let foundIdx = -1;
    for (let bIdx = 1; bIdx < boundaries.length - 1; bIdx++) {
      const bx = getXFromFrame(boundaries[bIdx]);
      if (Math.abs(mouseX - bx) <= 7) {
        foundIdx = bIdx;
        break;
      }
    }

    if (foundIdx !== ui.state.hoveredBoundaryIndex) {
      ui.state.hoveredBoundaryIndex = foundIdx;
      canvas.style.cursor = foundIdx > 0 ? 'col-resize' : 'crosshair';
      drawWaveformCanvas(ui, );
    }
  });

  canvas.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.button !== 0) return; // Only left button for boundary dragging/selecting
    closeContextMenu(ui, );

    if (ui.state.hoveredBoundaryIndex > 0) {
      ui.state.isDraggingBoundary = true;
      ui.state.draggedBoundaryIndex = ui.state.hoveredBoundaryIndex;
      ui.state.activeBoundaryIndex = ui.state.hoveredBoundaryIndex;
      drawWaveformCanvas(ui, );
      drawMagnifierCanvas(ui, );
      updateMagnifierHeader(ui, );
      return;
    }

    // Normal click: select slice and update active boundary
    const clickedFrame = getFrameFromMouseX(e.clientX);
    const hit = ui.state.currentResult?.slices.find(
      (s) => clickedFrame >= s.startFrame && clickedFrame <= s.endFrame
    );
    if (hit) {
      ui.state.selectedSliceId = hit.id;
      if (ui.state.currentResult) {
        const boundaries = extractBoundaryFrames(ui.state.currentResult, ui.state.pcm.length);
        // If first slice, select boundary #1; otherwise select boundary at slice start
        const bIdx = boundaries.findIndex((b) => Math.abs(b - hit.startFrame) < 32);
        ui.state.activeBoundaryIndex = bIdx > 0 && bIdx < boundaries.length - 1 ? bIdx : 1;
      }
      ui.auditionSlice(hit);
      drawWaveformCanvas(ui, );
      drawMagnifierCanvas(ui, );
      updateMagnifierHeader(ui, );
      refreshTable(ui, );
    }
  });

  window.addEventListener('mouseup', () => {
    if (ui.state.isDraggingBoundary) {
      ui.state.isDraggingBoundary = false;
      ui.state.draggedBoundaryIndex = -1;
      drawWaveformCanvas(ui, );
      drawMagnifierCanvas(ui, );
      updateMagnifierHeader(ui, );
      refreshTable(ui, );
    }
  });

  // Right-Click Context Menu on Waveform (on cut line or empty space)
  canvas.addEventListener('contextmenu', (e: MouseEvent) => {
    e.preventDefault();
    if (!ui.state.currentResult || ui.state.pcm.length === 0) return;

    const clickedFrame = getFrameFromMouseX(e.clientX);
    const boundaries = extractBoundaryFrames(ui.state.currentResult, ui.state.pcm.length);

    // Check if right-clicked directly on a boundary line
    const hoveredBIdx = ui.state.hoveredBoundaryIndex;
    if (hoveredBIdx > 0 && hoveredBIdx < boundaries.length - 1) {
      const bFrame = boundaries[hoveredBIdx];
      const sliceLeft = ui.state.currentResult.slices[hoveredBIdx - 1];
      const sliceRight = ui.state.currentResult.slices[hoveredBIdx];

      showContextMenu(ui, e.clientX, e.clientY, [
        { label: `Cut Boundary #${hoveredBIdx} (${bFrame.toLocaleString()} smp)`, isHeader: true },
        {
          label: 'Delete Cut Boundary',
          icon: ICONS.trash,
          isDanger: true,
          onClick: () => {
            if (sliceRight) {
              ui.removeManualBoundary(sliceRight.startFrame);
              ui.state.currentResult = deleteSlice(ui.state.currentResult!, ui.state.pcm, ui.state.sampleRate, sliceRight.id, ui.state.options);
              ui.state.activeBoundaryIndex = Math.max(1, hoveredBIdx - 1);
              ui.render();
              toast(`Removed cut boundary #${hoveredBIdx}.`, 'info');
            }
          },
        },
        {
          label: 'Snap to 0-Crossing',
          icon: ICONS.wave,
          onClick: () => {
            ui.state.activeBoundaryIndex = hoveredBIdx;
            ui.snapActiveBoundary0X();
          },
        },
        {
          label: 'Inspect in Magnifier',
          icon: ICONS.scissors,
          onClick: () => {
            ui.state.activeBoundaryIndex = hoveredBIdx;
            drawMagnifierCanvas(ui, );
            updateMagnifierHeader(ui, );
          },
        },
        { label: '', isDivider: true },
        ...(sliceLeft
          ? [
              {
                label: `Play Left: Slice #${sliceLeft.index}`,
                icon: ICONS.play,
                onClick: () => ui.auditionSlice(sliceLeft),
              },
              {
                label: sliceLeft.isSilence ? `Unmute Left Slice #${sliceLeft.index}` : `Mute Left Slice #${sliceLeft.index}`,
                icon: ICONS.eyeOff,
                onClick: () => {
                  ui.handleToggleSliceSilence(sliceLeft.id);
                },
              },
            ]
          : []),
        ...(sliceRight
          ? [
              {
                label: `Play Right: Slice #${sliceRight.index}`,
                icon: ICONS.play,
                onClick: () => ui.auditionSlice(sliceRight),
              },
              {
                label: sliceRight.isSilence ? `Unmute Right Slice #${sliceRight.index}` : `Mute Right Slice #${sliceRight.index}`,
                icon: ICONS.eyeOff,
                onClick: () => {
                  ui.handleToggleSliceSilence(sliceRight.id);
                },
              },
            ]
          : []),
      ]);
      return;
    }

    // Otherwise, right-clicked on empty area within a slice:
    const hitSlice = ui.state.currentResult.slices.find(
      (s) => clickedFrame >= s.startFrame && clickedFrame <= s.endFrame
    );

    showContextMenu(ui, e.clientX, e.clientY, [
      { label: hitSlice ? `Slice #${hitSlice.index} (${((clickedFrame / ui.state.sampleRate) * 1000).toFixed(1)} ms)` : 'Audio Waveform', isHeader: true },
      {
        label: `+ Add Cut Marker Here (${clickedFrame.toLocaleString()} smp)`,
        icon: ICONS.plus,
        onClick: () => {
          ui.registerManualBoundary(clickedFrame);
          ui.state.currentResult = splitSliceAtFrame(
            ui.state.currentResult!,
            ui.state.pcm,
            ui.state.sampleRate,
            clickedFrame,
            ui.state.options.snapZeroCrossing,
            ui.state.options
          );
          const updatedBoundaries = extractBoundaryFrames(ui.state.currentResult!, ui.state.pcm.length);
          const newIdx = updatedBoundaries.findIndex((b) => Math.abs(b - clickedFrame) < 64);
          if (newIdx > 0 && newIdx < updatedBoundaries.length - 1) {
            ui.state.activeBoundaryIndex = newIdx;
          }
          ui.render();
          toast(`Added slice cut at ${clickedFrame.toLocaleString()} smp.`, 'success');
        },
      },
      ...(hitSlice
        ? [
            {
              label: `Audition Slice #${hitSlice.index}`,
              icon: ICONS.play,
              onClick: () => ui.auditionSlice(hitSlice),
            },
            {
              label: hitSlice.isSilence ? `Unmute Slice (Mark Active)` : `Mark as Silence (Mute)`,
              icon: ICONS.eyeOff,
              onClick: () => {
                ui.handleToggleSliceSilence(hitSlice.id);
              },
            },
            {
              label: `${MUSICIAN_TERMS.noisePrint} — Slice #${hitSlice.index}`,
              icon: ICONS.wave,
              onClick: () => {
                ui.state.capturedNoiseProfile = captureNoisePrintFromRegion(ui.state.pcm, ui.state.sampleRate, {
                  startFrame: hitSlice.startFrame,
                  endFrame: hitSlice.endFrame,
                  label: `Slice #${hitSlice.index}`,
                });
                toast(
                  `Captured noise print from Slice #${hitSlice.index} (${ui.state.capturedNoiseProfile.levelDbfs.toFixed(1)} dBFS). Ready for DSP cleaning or AI Enhance!`,
                  'success'
                );
                ui.render();
              },
            },
            { label: '', isDivider: true },
            {
              label: `Delete Slice #${hitSlice.index}`,
              icon: ICONS.trash,
              isDanger: true,
              onClick: () => {
                ui.removeManualBoundary(hitSlice.startFrame);
                ui.state.currentResult = deleteSlice(ui.state.currentResult!, ui.state.pcm, ui.state.sampleRate, hitSlice.id, ui.state.options);
                ui.render();
                toast(`Deleted slice #${hitSlice.index}.`, 'info');
              },
            },
          ]
        : []),
    ]);
  });

  // Double-click to split slice at frame
  canvas.addEventListener('dblclick', (e: MouseEvent) => {
    if (!ui.state.currentResult || ui.state.pcm.length === 0) return;
    const splitFrame = getFrameFromMouseX(e.clientX);
    ui.registerManualBoundary(splitFrame);
    ui.state.currentResult = splitSliceAtFrame(
      ui.state.currentResult,
      ui.state.pcm,
      ui.state.sampleRate,
      splitFrame,
      ui.state.options.snapZeroCrossing,
      ui.state.options
    );

    const boundaries = extractBoundaryFrames(ui.state.currentResult, ui.state.pcm.length);
    const newBIdx = boundaries.findIndex((b) => Math.abs(b - splitFrame) < 64);
    if (newBIdx > 0 && newBIdx < boundaries.length - 1) {
      ui.state.activeBoundaryIndex = newBIdx;
    }

    toast(`Added slice cut at ${splitFrame.toLocaleString()} smp.`, 'success');
    ui.render();
  });
}

export function bindMagnifierInteraction(ui: ChopperContext): void {
  if (!ui.state.backdropEl) return;
  const magCanvas = ui.state.backdropEl.querySelector('#chopper-magnifier-canvas') as HTMLCanvasElement | null;
  if (!magCanvas) return;

  magCanvas.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.button !== 0) return;
    closeContextMenu(ui, );
    if (!ui.state.currentResult || ui.state.pcm.length === 0) return;

    ui.state.isDraggingMagnifier = true;
    ui.state.magDragStartMouseX = e.clientX;
    ui.state.magDragStartCutFrame = ui.getActiveCutFrame();
    drawMagnifierCanvas(ui, );
  });

  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (!ui.state.isDraggingMagnifier || !ui.state.currentResult || ui.state.pcm.length === 0) return;
    if (!ui.state.magnifierCanvas) return;

    const rect = ui.state.magnifierCanvas.getBoundingClientRect();
    const deltaX = e.clientX - ui.state.magDragStartMouseX;
    const totalMagnifierWindowSamples = 512;
    const samplesPerPixel = totalMagnifierWindowSamples / Math.max(1, rect.width);
    const deltaSamples = Math.round(deltaX * samplesPerPixel);
    const targetFrame = ui.state.magDragStartCutFrame + deltaSamples;

    const boundaries = extractBoundaryFrames(ui.state.currentResult, ui.state.pcm.length);
    if (boundaries.length <= 2) return;
    const bIdx = clamp(ui.state.activeBoundaryIndex, 1, boundaries.length - 2);

    ui.registerManualBoundary(targetFrame, ui.state.magDragStartCutFrame);

    ui.state.currentResult = moveSliceBoundary(
      ui.state.currentResult,
      ui.state.pcm,
      ui.state.sampleRate,
      bIdx,
      targetFrame,
      false, // Real-time exact sample dragging (no snap during drag)
      ui.state.options
    );

    drawWaveformCanvas(ui, );
    drawMagnifierCanvas(ui, );
    updateMagnifierHeader(ui, );
    refreshTable(ui, );
  });

  window.addEventListener('mouseup', () => {
    if (ui.state.isDraggingMagnifier) {
      ui.state.isDraggingMagnifier = false;
      drawWaveformCanvas(ui, );
      drawMagnifierCanvas(ui, );
      updateMagnifierHeader(ui, );
      refreshTable(ui, );
    }
  });
}

export function bindTableEvents(ui: ChopperContext): void {
  if (!ui.state.backdropEl) return;

  ui.state.backdropEl.querySelectorAll<HTMLTableRowElement>('.nmm-data-table tbody tr').forEach((tr) => {
    tr.addEventListener('click', () => {
      const sliceId = tr.dataset.sliceId;
      const sl = ui.state.currentResult?.slices.find((s) => s.id === sliceId);
      if (sl && ui.state.currentResult) {
        ui.state.selectedSliceId = sl.id;
        const boundaries = extractBoundaryFrames(ui.state.currentResult, ui.state.pcm.length);
        const bIdx = boundaries.findIndex((b) => Math.abs(b - sl.startFrame) < 32);
        ui.state.activeBoundaryIndex = bIdx > 0 && bIdx < boundaries.length - 1 ? bIdx : 1;
        ui.auditionSlice(sl);
        drawWaveformCanvas(ui, );
        drawMagnifierCanvas(ui, );
        updateMagnifierHeader(ui, );
        refreshTable(ui, );
      }
    });
  });

  ui.state.backdropEl.querySelectorAll<HTMLButtonElement>('.btn-play-slice').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const sliceId = btn.dataset.sliceId;
      const sl = ui.state.currentResult?.slices.find((s) => s.id === sliceId);
      if (sl) ui.auditionSlice(sl);
    });
  });

  ui.state.backdropEl.querySelectorAll<HTMLButtonElement>('.btn-toggle-silence-row').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const sliceId = btn.dataset.sliceId;
      if (sliceId && ui.state.currentResult) {
        ui.handleToggleSliceSilence(sliceId);
      }
    });
  });

  ui.state.backdropEl.querySelectorAll<HTMLButtonElement>('.btn-delete-slice').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const sliceId = btn.dataset.sliceId;
      if (sliceId && ui.state.currentResult) {
        const sl = ui.state.currentResult.slices.find((s) => s.id === sliceId);
        if (sl) ui.removeManualBoundary(sl.startFrame);
        ui.state.currentResult = deleteSlice(ui.state.currentResult, ui.state.pcm, ui.state.sampleRate, sliceId, ui.state.options);
        const boundaries = extractBoundaryFrames(ui.state.currentResult, ui.state.pcm.length);
        if (ui.state.activeBoundaryIndex >= boundaries.length - 1) {
          ui.state.activeBoundaryIndex = Math.max(1, boundaries.length - 2);
        }
        ui.render();
        toast('Removed slice marker.', 'info');
      }
    });
  });
}

export function showContextMenu(ui: ChopperContext, x: number, y: number, items: ContextMenuItem[]): void {
  closeContextMenu(ui, );

  const menu = document.createElement('div');
  menu.className = 'chopper-context-menu';
  menu.style.left = `${Math.min(window.innerWidth - 210, Math.max(10, x))}px`;
  menu.style.top = `${Math.min(window.innerHeight - 250, Math.max(10, y))}px`;

  items.forEach((it) => {
    if (it.isHeader) {
      const header = document.createElement('div');
      header.className = 'chopper-menu-header';
      header.textContent = it.label;
      menu.appendChild(header);
    } else if (it.isDivider) {
      const div = document.createElement('div');
      div.className = 'chopper-menu-divider';
      menu.appendChild(div);
    } else {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `chopper-menu-item ${it.isDanger ? 'danger-item' : ''}`;
      btn.innerHTML = `${it.icon || ''} <span>${escHtml(it.label)}</span>`;
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        closeContextMenu(ui, );
        it.onClick?.();
      });
      menu.appendChild(btn);
    }
  });

  document.body.appendChild(menu);
  ui.state.activeContextMenuEl = menu;

  const onOutsideClick = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) {
      closeContextMenu(ui, );
      window.removeEventListener('click', onOutsideClick);
    }
  };
  setTimeout(() => {
    window.addEventListener('click', onOutsideClick);
  }, 10);
}

export function closeContextMenu(ui: ChopperContext): void {
  if (ui.state.activeContextMenuEl) {
    ui.state.activeContextMenuEl.remove();
    ui.state.activeContextMenuEl = null;
  }
}
