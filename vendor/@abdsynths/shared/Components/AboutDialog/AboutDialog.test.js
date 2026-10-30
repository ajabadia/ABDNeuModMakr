import { describe, expect, it, vi } from 'vitest';
import { AboutDialog, createAboutDialog } from './AboutDialog.js';

describe('AboutDialog Component (ABDShared)', () => {
  it('instancia el modal en el DOM con identidad y accesibilidad', () => {
    const dialog = createAboutDialog({
      appName: 'ABD SuperSynth',
      version: '1.2.3',
      buildNumber: 42,
    });

    const el = document.getElementById('abd-about-dialog');
    expect(el).not.toBeNull();
    expect(el.hidden).toBe(true);
    expect(el.getAttribute('role')).toBe('dialog');
    expect(el.getAttribute('aria-modal')).toBe('true');

    const title = el.querySelector('.abd-about-title');
    expect(title.textContent).toBe('ABD SuperSynth');

    const ver = el.querySelector('.abd-about-version');
    expect(ver.textContent).toBe('v1.2.3');

    dialog.destroy();
    expect(document.getElementById('abd-about-dialog')).toBeNull();
  });

  it('abre y cierra el diálogo gestionando visibilidad y foco', () => {
    const onClose = vi.fn();
    const dialog = new AboutDialog({
      appName: 'TestSynth',
      onClose,
    });

    dialog.open();
    expect(dialog.rootEl.hidden).toBe(false);
    expect(dialog.rootEl.getAttribute('aria-hidden')).toBe('false');

    dialog.close();
    expect(dialog.rootEl.hidden).toBe(true);
    expect(dialog.rootEl.getAttribute('aria-hidden')).toBe('true');
    expect(onClose).toHaveBeenCalledTimes(1);

    dialog.destroy();
  });

  it('muestra el resultado de actualización cuando hay nueva versión', () => {
    const dialog = new AboutDialog({
      appName: 'TestSynth',
      version: '1.0.0',
    });

    dialog.renderUpdateResult({
      currentVersion: '1.0.0',
      latestVersion: '2.0.0',
      isUpdateAvailable: true,
      downloadUrl: 'https://example.com/download',
    });

    expect(dialog.statusEl.textContent).toContain('New version available: 2.0.0');
    expect(dialog.actionEl.hidden).toBe(false);
    expect(dialog.downloadBtn.href).toBe('https://example.com/download');

    dialog.destroy();
  });
});
