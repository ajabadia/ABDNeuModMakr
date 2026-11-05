// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Accessible Modal Keyboard Focus Trap
// Thin wrapper around the shared overlay focus contract
// (@abdsynths/shared/components / createOverlayFocus).
//
// Keeps the existing FocusTrap { activate, deactivate } surface and the
// FocusTrapOptions { initialFocusSelector?, onEscape? } contract so the
// 14 consuming modals do not need to change.
//
// Behaviour is intentionally kept close to the previous local trap:
//   - Escape closes the dialog and preventDefault() is kept so the key is
//     consumed by the dialog and does not leak to the browser/audio host.
//   - Tab / Shift+Tab cycles within the modal's reachable controls.
//   - On open, focus moves to the initial selector (if given) or to the
//     first reachable control; on close, focus returns to the trigger.
// ─────────────────────────────────────────────────────────

import { createOverlayFocus, focusableWithin } from '@abdsynths/shared/components';

export interface FocusTrapOptions {
  initialFocusSelector?: string;
  onEscape?: () => void;
}

export interface FocusTrap {
  activate: () => void;
  deactivate: () => void;
}

const dataModalBodySelector = '.nmm-modal-body, .modal-body, [data-modal-body]';

export function createModalFocusTrap(
  modalElement: HTMLElement,
  options?: FocusTrapOptions
): FocusTrap {
  let isActive = false;

  const overlay = createOverlayFocus({
    root: modalElement,
    body: modalElement.querySelector<HTMLElement>(dataModalBodySelector) ?? modalElement,
    isClosed: () => !isActive,
    onEscape: () => {
      const onEscape = options?.onEscape;
      if (onEscape) {
        onEscape();
        return;
      }
      // Fallback: close the dialog through the same local contract the modals
      // already use for Escape-driven closure.
      if (typeof modalElement.closest === 'function') {
        const dialog = modalElement.closest<HTMLElement>('[role="dialog"][aria-modal="true"]');
        if (dialog && typeof (dialog as any).close === 'function') {
          (dialog as any).close();
        }
      }
    },
  });

  return {
    activate() {
      if (isActive) return;
      isActive = true;

      overlay.rememberTrigger();
      overlay.releaseInert();
      overlay.attach();

      requestAnimationFrame(() => {
        if (!isActive) return;

        if (options?.initialFocusSelector) {
          const target = modalElement.querySelector<HTMLElement>(options.initialFocusSelector);
          if (target && !target.hasAttribute('disabled')) {
            target.focus({ preventScroll: true });
            return;
          }
        }

        overlay.focusFirst();
      });
    },

    deactivate() {
      if (!isActive) return;
      isActive = false;

      overlay.detach();
      overlay.setInert();
      overlay.restoreFocus();
    },
  };
}

// Keep the old selector list available for any local code that inspected it
// directly (none of the 14 consumers should depend on it, but be safe).
export { focusableWithin };
