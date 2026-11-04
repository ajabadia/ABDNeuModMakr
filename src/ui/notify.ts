// ─────────────────────────────────────────────────────────
// Toast + confirm dialog (non-blocking replacements for
// window.alert() / window.confirm()).
// Alerts freeze the app and are untestable in Node; toasts
// log to Telemetry through the caller's ctx.log and vanish.
// ─────────────────────────────────────────────────────────

import { ICONS } from './icons.ts';
import { createModalFocusTrap } from './modalFocusTrap.ts';

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

/**
 * Announces asynchronous operation status (batch progress, stem separation, BWE, errors)
 * to screen readers via a persistent visually-hidden live region.
 */
export function announceToScreenReader(
  message: string,
  priority: 'polite' | 'assertive' = 'polite'
): void {
  if (typeof document === 'undefined' || !message.trim()) return;
  const regionId = `a11y-live-${priority}`;
  let region = document.getElementById(regionId);
  if (!region) {
    region = document.createElement('div');
    region.id = regionId;
    region.className = 'sr-only';
    region.setAttribute('aria-live', priority);
    region.setAttribute('aria-atomic', 'true');
    region.setAttribute('role', priority === 'assertive' ? 'alert' : 'status');
    document.body.appendChild(region);
  }
  region.textContent = '';
  window.setTimeout(() => {
    if (region) region.textContent = message;
  }, 20);
}

export function toast(message: string, kind: ToastKind = 'info'): void {
  if (typeof document === 'undefined') return;
  const stack = ensureStack();
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.setAttribute('role', kind === 'error' || kind === 'warning' ? 'alert' : 'status');
  el.textContent = message;
  el.addEventListener('click', () => el.remove());
  stack.appendChild(el);
  announceToScreenReader(message, kind === 'error' || kind === 'warning' ? 'assertive' : 'polite');
  window.setTimeout(() => el.remove(), TOAST_TTL_MS);
}

export interface ConfirmOptions {
  title?: string;
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
  const { title = 'Confirm', confirmLabel = 'Accept', cancelLabel = 'Cancel', danger = false } = opts;
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'confirm-backdrop';
    backdrop.innerHTML = `
      <div class="confirm-box nmm-modal-m" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-desc">
        <div class="nmm-modal-header">
          <div class="nmm-modal-header-title">
            <span class="modal-icon">${ICONS.alert}</span>
            <h2 id="confirm-title" class="confirm-title-text"></h2>
          </div>
        </div>
        <p id="confirm-desc" class="confirm-msg"></p>
        <footer class="nmm-modal-footer">
          <div class="footer-left"></div>
          <div class="footer-right">
            <button type="button" class="btn btn-sm btn-ghost btn-confirm-cancel"></button>
            <button type="button" class="btn btn-sm ${danger ? 'btn-danger' : 'btn-primary'} btn-confirm-ok"></button>
          </div>
        </footer>
      </div>
    `;
    (backdrop.querySelector('.confirm-title-text') as HTMLElement).textContent = title;
    (backdrop.querySelector('.confirm-msg') as HTMLElement).textContent = message;
    const btnCancel = backdrop.querySelector('.btn-confirm-cancel') as HTMLButtonElement;
    const btnOk = backdrop.querySelector('.btn-confirm-ok') as HTMLButtonElement;
    btnCancel.textContent = cancelLabel;
    btnOk.textContent = confirmLabel;

    let settled = false;
    const trap = createModalFocusTrap(backdrop, { onEscape: () => done(false) });
    const done = (value: boolean): void => {
      if (settled) return;
      settled = true;
      trap.deactivate();
      backdrop.remove();
      resolve(value);
    };
    btnOk.addEventListener('click', () => done(true));
    btnCancel.addEventListener('click', () => done(false));
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) done(false);
    });
    document.body.appendChild(backdrop);
    trap.activate();
    (danger ? btnCancel : btnOk).focus();
  });
}

export interface PromptOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  placeholder?: string;
}

/**
 * Non-blocking prompt. Resolves the entered text on Accept,
 * null on Cancel / backdrop click / Escape. Replaces the
 * remaining window.prompt(...) calls without freezing the app.
 */
export function promptDialog(message: string, defaultValue = '', opts: PromptOptions = {}): Promise<string | null> {
  const { title = 'Input', confirmLabel = 'Accept', cancelLabel = 'Cancel', placeholder = '' } = opts;
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'confirm-backdrop';
    backdrop.innerHTML = `
      <div class="confirm-box nmm-modal-m" role="dialog" aria-modal="true" aria-labelledby="prompt-title" aria-describedby="prompt-desc">
        <div class="nmm-modal-header">
          <div class="nmm-modal-header-title">
            <span class="modal-icon">${ICONS.edit ?? ''}</span>
            <h2 id="prompt-title" class="prompt-title-text"></h2>
          </div>
        </div>
        <div class="prompt-body">
          <p id="prompt-desc" class="prompt-msg"></p>
          <input type="text" class="form-control prompt-input" aria-labelledby="prompt-title" aria-describedby="prompt-desc" />
        </div>
        <footer class="nmm-modal-footer">
          <div class="footer-left"></div>
          <div class="footer-right">
            <button type="button" class="btn btn-sm btn-ghost btn-prompt-cancel"></button>
            <button type="button" class="btn btn-sm btn-primary btn-prompt-ok"></button>
          </div>
        </footer>
      </div>
    `;
    (backdrop.querySelector('.prompt-title-text') as HTMLElement).textContent = title;
    (backdrop.querySelector('.prompt-msg') as HTMLElement).textContent = message;
    const input = backdrop.querySelector('.prompt-input') as HTMLInputElement;
    input.value = defaultValue;
    if (placeholder) input.placeholder = placeholder;
    const btnCancel = backdrop.querySelector('.btn-prompt-cancel') as HTMLButtonElement;
    const btnOk = backdrop.querySelector('.btn-prompt-ok') as HTMLButtonElement;
    btnCancel.textContent = cancelLabel;
    btnOk.textContent = confirmLabel;

    let settled = false;
    const trap = createModalFocusTrap(backdrop, {
      onEscape: () => done(null),
      initialFocusSelector: '.prompt-input',
    });
    const done = (value: string | null): void => {
      if (settled) return;
      settled = true;
      trap.deactivate();
      backdrop.remove();
      resolve(value);
    };
    btnOk.addEventListener('click', () => done(input.value));
    btnCancel.addEventListener('click', () => done(null));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done(input.value);
    });
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) done(null);
    });
    document.body.appendChild(backdrop);
    trap.activate();
    input.focus();
    input.select();
  });
}
