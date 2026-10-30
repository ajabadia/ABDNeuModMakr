// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Loading / Progress Modal
// Provides a sleek visual loading overlay with an animated spinner
// and status updates during heavy operations (SF2 import, folder scan,
// multi-file decode, model processing) so the app never feels frozen.
// ─────────────────────────────────────────────────────────

export class LoadingModal {
  private backdropEl: HTMLElement | null = null;
  private titleEl: HTMLElement | null = null;
  private subtitleEl: HTMLElement | null = null;
  private activeCount = 0;

  private ensureDom(): void {
    if (this.backdropEl) return;
    if (typeof document === 'undefined') return;

    this.backdropEl = document.createElement('div');
    this.backdropEl.className = 'loading-modal-backdrop is-hidden';
    this.backdropEl.setAttribute('role', 'status');
    this.backdropEl.setAttribute('aria-live', 'polite');
    this.backdropEl.innerHTML = `
      <div class="loading-modal-card">
        <div class="loading-spinner-ring">
          <svg class="spinner-svg" viewBox="0 0 50 50">
            <circle class="spinner-track" cx="25" cy="25" r="20" fill="none" stroke-width="4"></circle>
            <circle class="spinner-glow" cx="25" cy="25" r="20" fill="none" stroke-width="4"></circle>
          </svg>
        </div>
        <div class="loading-text-stack">
          <h3 class="loading-title" id="loading-modal-title">TRABAJANDO...</h3>
          <p class="loading-subtitle" id="loading-modal-subtitle">Por favor espera un momento...</p>
        </div>
      </div>
    `;
    document.body.appendChild(this.backdropEl);

    this.titleEl = this.backdropEl.querySelector('#loading-modal-title');
    this.subtitleEl = this.backdropEl.querySelector('#loading-modal-subtitle');
  }

  public show(title: string, subtitle = 'Procesando datos de audio...'): void {
    this.ensureDom();
    if (!this.backdropEl) return;

    this.activeCount++;
    if (this.titleEl) this.titleEl.textContent = title;
    if (this.subtitleEl) this.subtitleEl.textContent = subtitle;

    this.backdropEl.classList.remove('is-hidden');
  }

  public setMessage(subtitle: string): void {
    if (this.subtitleEl) {
      this.subtitleEl.textContent = subtitle;
    }
  }

  public hide(): void {
    this.activeCount = Math.max(0, this.activeCount - 1);
    if (this.activeCount === 0 && this.backdropEl) {
      this.backdropEl.classList.add('is-hidden');
    }
  }

  public forceHide(): void {
    this.activeCount = 0;
    this.backdropEl?.classList.add('is-hidden');
  }
}

export const loadingModal = new LoadingModal();

/**
 * Executes an asynchronous task with an immediate visual loading spinner modal.
 * Yields one frame to the browser event loop before running `task` so the DOM
 * can paint the spinner before the JavaScript main thread performs heavy computation.
 */
export async function withLoading<T>(
  title: string,
  subtitle: string,
  task: () => Promise<T>
): Promise<T> {
  loadingModal.show(title, subtitle);
  // Yield 50ms so browser paints the loading card and spinner
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
  try {
    return await task();
  } finally {
    loadingModal.hide();
  }
}
