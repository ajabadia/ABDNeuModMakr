// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Audio Chopper Keyboard Accessibility (Fase 38)
// Global keyboard handler inside the chopper modal only.
// Arrow keys move the active cut boundary, table rows select
// slices, Delete/Backspace removes the current boundary,
// and Enter/Space auditions the selected slice.
//
// The modal already has an Esc handler via createModalFocusTrap;
// this layer extends it with single-key operations that do not
// steal browser/OS shortcuts (Ctrl+C, Ctrl+V, Ctrl+Z) belonging
// to the host app.
// ─────────────────────────────────────────────────────────

import type { ChopperContext } from './types.ts';
import { toast } from '../notify.ts';


export function bindChopperKeyboard(ui: ChopperContext): void {
  if (!ui.state.backdropEl) return;

  const onKey = (e: KeyboardEvent): void => {
    // Ignore when a text input or contenteditable is focused
    if (isTypingTarget(e.target)) return;

    switch (e.key) {
      case 'ArrowLeft': {
        e.preventDefault();
        if (!ui.state.currentResult || ui.state.pcm.length === 0) return;
        if (e.shiftKey) {
          ui.nudgeActiveBoundary(e.altKey ? -10 : -1);
        } else {
          ui.navigateBoundary(-1);
        }
        break;
      }
      case 'ArrowRight': {
        e.preventDefault();
        if (!ui.state.currentResult || ui.state.pcm.length === 0) return;
        if (e.shiftKey) {
          ui.nudgeActiveBoundary(e.altKey ? 10 : 1);
        } else {
          ui.navigateBoundary(1);
        }
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        focusPreviousTableRow(ui);
        break;
      }
      case 'ArrowDown': {
        e.preventDefault();
        focusNextTableRow(ui);
        break;
      }
      case 'Home': {
        e.preventDefault();
        if (!ui.state.currentResult || ui.state.pcm.length === 0) return;
        ui.state.activeBoundaryIndex = 1;
        ui.syncActiveSliceFromBoundary();
        ui.drawWaveformCanvas();
        ui.drawMagnifierCanvas();
        ui.updateMagnifierHeader();
        ui.refreshTable();
        break;
      }
      case 'End': {
        e.preventDefault();
        if (!ui.state.currentResult || ui.state.pcm.length === 0) return;
        const boundaries = ui.extractBoundaryFrames(ui.state.currentResult, ui.state.pcm.length);
        if (boundaries.length > 2) {
          ui.state.activeBoundaryIndex = boundaries.length - 2;
          ui.syncActiveSliceFromBoundary();
        }
        ui.drawWaveformCanvas();
        ui.drawMagnifierCanvas();
        ui.updateMagnifierHeader();
        ui.refreshTable();
        break;
      }
      case 'Enter':
      case ' ': {
        e.preventDefault();
        if (!ui.state.selectedSliceId || !ui.state.currentResult) return;
        const sl = ui.state.currentResult.slices.find((s) => s.id === ui.state.selectedSliceId);
        if (sl) ui.auditionSlice(sl, e.key === ' ' || (e.key === 'Enter' && e.shiftKey));
        break;
      }
      case 'Delete':
      case 'Backspace': {
        e.preventDefault();
        if (!ui.state.currentResult) return;
        const boundaries = ui.extractBoundaryFrames(ui.state.currentResult, ui.state.pcm.length);
        if (boundaries.length <= 2) {
          toast('Need at least 2 boundaries to delete.', 'warning');
          return;
        }
        const bIdx = Math.max(1, Math.min(ui.state.activeBoundaryIndex, boundaries.length - 2));
        const bFrame = boundaries[bIdx];
        const slice = ui.state.currentResult.slices[bIdx];
        if (!slice) {
          toast('No slice at active boundary.', 'warning');
          return;
        }
        ui.removeManualBoundary(bFrame);
        ui.state.currentResult = ui.deleteSlice(
          ui.state.currentResult,
          ui.state.pcm,
          ui.state.sampleRate,
          slice.id,
          ui.state.options
        );
        ui.state.activeBoundaryIndex = Math.max(1, bIdx - 1);
        ui.syncActiveSliceFromBoundary();
        ui.drawWaveformCanvas();
        ui.drawMagnifierCanvas();
        ui.refreshTable();
        ui.updateMagnifierHeader();
        toast(`Deleted slice #${slice.index}.`, 'info');
        break;
      }
      case 'Escape': {
        e.preventDefault();
        if (ui.state.activeContextMenuEl) {
          ui.closeContextMenu();
          return;
        }
        if (ui.state.playingSliceId) {
          ui.stopAudition?.();
          ui.state.playingSliceId = null;
          ui.drawWaveformCanvas();
          ui.drawMagnifierCanvas();
          break;
        }
        break;
      }
      // The following shortcuts are intentionally NOT handled here
      // because they belong to the host app and the focus trap.
      // They are listed for clarity only:
      //   Ctrl+C, Ctrl+V, Ctrl+A, Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z
      //   Ctrl+S, Ctrl+R, Ctrl+P, Ctrl+D, etc.
      default:
        break;
    }
  };

  ui.state.backdropEl.addEventListener('keydown', onKey);
  ui.state._chopperKeyboardHandler = onKey as ((e: Event) => void) | undefined;
}

export function unbindChopperKeyboard(ui: ChopperContext): void {
  if (!ui.state.backdropEl || typeof ui.state._chopperKeyboardHandler !== 'function') return;
  ui.state.backdropEl.removeEventListener('keydown', ui.state._chopperKeyboardHandler);
  ui.state._chopperKeyboardHandler = undefined;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!target) return false;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return false;
}

function focusPreviousTableRow(ui: ChopperContext): void {
  if (!ui.state.backdropEl || !ui.state.currentResult) return;
  const rows = ui.state.backdropEl.querySelectorAll<HTMLTableRowElement>('.nmm-data-table tbody tr');
  if (rows.length === 0) return;
  const currentIndex = Array.from(rows).findIndex((tr) => tr.dataset.sliceId === ui.state.selectedSliceId);
  const targetIndex = currentIndex > 0 ? currentIndex - 1 : 0;
  const target = rows[targetIndex];
  if (!target) return;
  const sl = ui.state.currentResult.slices.find((s) => s.id === target.dataset.sliceId);
  if (!sl) return;
  ui.state.selectedSliceId = sl.id;
  const boundaries = ui.extractBoundaryFrames(ui.state.currentResult, ui.state.pcm.length);
  const bIdx = boundaries.findIndex((b) => Math.abs(b - sl.startFrame) < 32);
  ui.state.activeBoundaryIndex = bIdx > 0 && bIdx < boundaries.length - 1 ? bIdx : 1;
  target.focus();
  ui.drawWaveformCanvas();
  ui.drawMagnifierCanvas();
  ui.updateMagnifierHeader();
  ui.refreshTable();
}

function focusNextTableRow(ui: ChopperContext): void {
  if (!ui.state.backdropEl || !ui.state.currentResult) return;
  const rows = ui.state.backdropEl.querySelectorAll<HTMLTableRowElement>('.nmm-data-table tbody tr');
  if (rows.length === 0) return;
  const currentIndex = Array.from(rows).findIndex((tr) => tr.dataset.sliceId === ui.state.selectedSliceId);
  const targetIndex = currentIndex < rows.length - 1 ? currentIndex + 1 : rows.length - 1;
  const target = rows[targetIndex];
  if (!target) return;
  const sl = ui.state.currentResult.slices.find((s) => s.id === target.dataset.sliceId);
  if (!sl) return;
  ui.state.selectedSliceId = sl.id;
  const boundaries = ui.extractBoundaryFrames(ui.state.currentResult, ui.state.pcm.length);
  const bIdx = boundaries.findIndex((b) => Math.abs(b - sl.startFrame) < 32);
  ui.state.activeBoundaryIndex = bIdx > 0 && bIdx < boundaries.length - 1 ? bIdx : 1;
  target.focus();
  ui.drawWaveformCanvas();
  ui.drawMagnifierCanvas();
  ui.updateMagnifierHeader();
  ui.refreshTable();
}
