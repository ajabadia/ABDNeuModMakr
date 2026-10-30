// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — PWA & Service Worker Manager (Fase 10.B)
//
// Handles offline service worker registration, install prompts
// and standalone desktop app detection.
// ─────────────────────────────────────────────────────────

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export class PwaManager {
  private deferredPrompt: BeforeInstallPromptEvent | null = null;
  private isStandalone = false;
  private onInstallableCallbacks: Array<(canInstall: boolean) => void> = [];

  constructor() {
    this.checkStandalone();
    this.bindEvents();
  }

  private checkStandalone(): void {
    if (typeof window === 'undefined') return;
    this.isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      // @ts-expect-error iOS Safari navigator.standalone check
      (navigator.standalone === true);
  }

  private bindEvents(): void {
    if (typeof window === 'undefined') return;

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e as BeforeInstallPromptEvent;
      this.notifyInstallable(true);
    });

    window.addEventListener('appinstalled', () => {
      this.deferredPrompt = null;
      this.isStandalone = true;
      this.notifyInstallable(false);
      console.log('✅ NEURON MODELmaker successfully installed as desktop PWA.');
    });
  }

  public registerServiceWorker(): void {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    // Only register on HTTPS or localhost
    const isLocalhost =
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1';
    const isHttps = window.location.protocol === 'https:';

    if (!isHttps && !isLocalhost) {
      return;
    }

    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((reg) => {
          console.log('[PWA] Service Worker active, scope:', reg.scope);
          // Check for worker updates
          reg.addEventListener('updatefound', () => {
            const installing = reg.installing;
            if (installing) {
              installing.addEventListener('statechange', () => {
                if (
                  installing.state === 'installed' &&
                  navigator.serviceWorker.controller
                ) {
                  console.log('[PWA] New version ready for offline use.');
                }
              });
            }
          });
        })
        .catch((err) => {
          console.warn('[PWA] Service Worker registration skipped:', err);
        });
    });
  }

  public onInstallableChange(cb: (canInstall: boolean) => void): () => void {
    this.onInstallableCallbacks.push(cb);
    cb(this.canInstall());
    return () => {
      this.onInstallableCallbacks = this.onInstallableCallbacks.filter((c) => c !== cb);
    };
  }

  private notifyInstallable(canInstall: boolean): void {
    for (const cb of this.onInstallableCallbacks) {
      cb(canInstall);
    }
  }

  public canInstall(): boolean {
    return !this.isStandalone && this.deferredPrompt !== null;
  }

  public getIsStandalone(): boolean {
    return this.isStandalone;
  }

  public async triggerInstall(): Promise<boolean> {
    if (!this.deferredPrompt) {
      return false;
    }
    await this.deferredPrompt.prompt();
    const choice = await this.deferredPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      this.deferredPrompt = null;
      this.notifyInstallable(false);
      return true;
    }
    return false;
  }
}

export const pwaManager = new PwaManager();
