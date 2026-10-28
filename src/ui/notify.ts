// ─────────────────────────────────────────────────────────
// Toast + confirm dialog (non-blocking replacements for
// window.alert() / window.confirm()).
// Alerts freeze the app and are untestable in Node; toasts
// log to Telemetry through the caller's ctx.log and vanish.
// ─────────────────────────────────────────────────────────

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

const TOAST_TTL_MS = 5000;

function ensureStack(): HTMLElement {
  let stack = document.querySelector<HTMLElement>('#toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'toast-stack';
    stack.setAttribute('aria-live', 'polite');
    document.body.appendChild(stack);
  }
  return stack;
}

export function toast(message: string, kind: ToastKind = 'info'): void {
  if (typeof document === 'undefined') return;
  const stack = ensureStack();
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  el.addEventListener('click', () => el.remove());
  stack.appendChild(el);
  window.setTimeout(() => el.remove(), TOAST_TTL_MS);
}

export interface ConfirmOptions {
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

/**
 * Non-blocking confirm. Resolves true on Accept, false on
 * Cancel / backdrop click / Escape. Focus lands on Cancel
 * for destructive actions, on Accept otherwise.
 */
export function confirmDialog(message: string, opts: ConfirmOptions = {}): Promise<boolean> {
  const { confirmLabel = 'Accept', cancelLabel = 'Cancel', danger = false } = opts;
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'confirm-backdrop';
    backdrop.innerHTML = `
      <div class="confirm-box" role="alertdialog" aria-modal="true">
        <p class="confirm-msg"></p>
        <div class="confirm-actions">
          <button type="button" class="btn btn-xs btn-confirm-cancel"></button>
          <button type="button" class="btn btn-xs ${danger ? 'btn-danger' : 'btn-primary'} btn-confirm-ok"></button>
        </div>
      </div>
    `;
    (backdrop.querySelector('.confirm-msg') as HTMLElement).textContent = message;
    const btnCancel = backdrop.querySelector('.btn-confirm-cancel') as HTMLButtonElement;
    const btnOk = backdrop.querySelector('.btn-confirm-ok') as HTMLButtonElement;
    btnCancel.textContent = cancelLabel;
    btnOk.textContent = confirmLabel;

    let settled = false;
    const done = (value: boolean): void => {
      if (settled) return;
      settled = true;
      backdrop.remove();
      resolve(value);
    };
    btnOk.addEventListener('click', () => done(true));
    btnCancel.addEventListener('click', () => done(false));
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) done(false);
    });
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape') done(false);
      },
      { once: true }
    );
    document.body.appendChild(backdrop);
    (danger ? btnCancel : btnOk).focus();
  });
}
