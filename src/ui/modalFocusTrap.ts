// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Accessible Modal Keyboard Focus Trap
// Traps Tab / Shift+Tab navigation within open modal dialogs,
// auto-focuses initial element, and restores focus upon closing.
// ─────────────────────────────────────────────────────────

export interface FocusTrapOptions {
  initialFocusSelector?: string;
  onEscape?: () => void;
}

export interface FocusTrap {
  activate: () => void;
  deactivate: () => void;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function createModalFocusTrap(
  modalElement: HTMLElement,
  options?: FocusTrapOptions
): FocusTrap {
  let previouslyFocusedElement: HTMLElement | null = null;
  let isActive = false;

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!isActive) return;

    if (event.key === 'Escape') {
      if (options?.onEscape) {
        event.preventDefault();
        options.onEscape();
      }
      return;
    }

    if (event.key !== 'Tab') return;

    const focusables = Array.from(
      modalElement.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    ).filter((el) => el.offsetParent !== null && !el.hasAttribute('disabled'));

    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (event.shiftKey) {
      if (document.activeElement === first || !modalElement.contains(document.activeElement)) {
        event.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last || !modalElement.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  return {
    activate() {
      if (isActive) return;
      isActive = true;
      previouslyFocusedElement = document.activeElement as HTMLElement | null;

      window.addEventListener('keydown', handleKeyDown, true);

      // Focus initial element after current tick
      requestAnimationFrame(() => {
        if (!isActive) return;
        let target: HTMLElement | null = null;
        if (options?.initialFocusSelector) {
          target = modalElement.querySelector<HTMLElement>(options.initialFocusSelector);
        }
        if (!target) {
          const focusables = Array.from(
            modalElement.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
          ).filter((el) => el.offsetParent !== null && !el.hasAttribute('disabled'));
          target = focusables[0] ?? modalElement;
        }
        target?.focus();
      });
    },

    deactivate() {
      if (!isActive) return;
      isActive = false;
      window.removeEventListener('keydown', handleKeyDown, true);

      if (previouslyFocusedElement && typeof previouslyFocusedElement.focus === 'function') {
        previouslyFocusedElement.focus();
        previouslyFocusedElement = null;
      }
    },
  };
}
