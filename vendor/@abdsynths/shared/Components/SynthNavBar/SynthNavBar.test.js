import { describe, expect, it, vi } from 'vitest';
import {
  SynthNavBar,
  createSynthNavBar,
  DEFAULT_NAVBAR_MENUS,
  isItemChecked,
  renderMenuItemHtml,
} from './SynthNavBar.js';

describe('SynthNavBar Component (ABDShared)', () => {
  it('DEFAULT_NAVBAR_MENUS incluye las secciones estándar de la suite', () => {
    const names = DEFAULT_NAVBAR_MENUS.map(m => m.name);
    expect(names).toEqual(['File', 'Edit', 'View', 'Help']);
  });

  it('renderMenuItemHtml genera separadores y botones con atajos', () => {
    const sep = renderMenuItemHtml({ separator: true });
    expect(sep).toContain('class="nav-separator"');

    const itemHtml = renderMenuItemHtml({
      label: 'Save Patch',
      action: 'savePatch',
      shortcut: 'Ctrl+S',
    });
    expect(itemHtml).toContain('Save Patch');
    expect(itemHtml).toContain('data-action="savePatch"');
    expect(itemHtml).toContain('<kbd class="nav-kbd">Ctrl+S</kbd>');
  });

  it('isItemChecked evalúa correctamente valores activos o funciones', () => {
    const item = { action: 'zoom', value: 1.25 };
    expect(isItemChecked(item, { zoom: 1.25 })).toBe(true);
    expect(isItemChecked(item, { zoom: 1.0 })).toBe(false);
    expect(isItemChecked(item, (act) => act === 'zoom' ? 1.25 : null)).toBe(true);
  });

  it('instancia el navbar en el DOM con brand y menús', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const nav = createSynthNavBar({
      container,
      brand: { title: 'ABD Synth Lab', subtitle: 'Pro' },
      aboutDialog: false,
    });

    expect(nav.element).not.toBeNull();
    const titleEl = nav.element.querySelector('.brand-title');
    expect(titleEl.textContent).toBe('ABD Synth Lab');

    const triggers = nav.element.querySelectorAll('.nav-menu-trigger');
    expect(triggers.length).toBe(4);

    nav.destroy();
    document.body.removeChild(container);
  });

  it('abre dropdown al pulsar un menú y ejecuta la acción al hacer clic en un ítem', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const onAction = vi.fn();
    const nav = new SynthNavBar({
      container,
      onAction,
      aboutDialog: false,
    });

    const fileTrigger = nav.element.querySelector('.nav-menu-trigger[data-menu="File"]');
    fileTrigger.click();

    expect(nav.isMenuOpen).toBe(true);
    expect(nav.dropdownEl.hidden).toBe(false);

    const resetBtn = nav.dropdownEl.querySelector('button[data-action="resetPatch"]');
    expect(resetBtn).not.toBeNull();
    resetBtn.click();

    expect(onAction).toHaveBeenCalledWith('resetPatch', undefined, expect.anything());
    expect(nav.isMenuOpen).toBe(false);
    expect(nav.dropdownEl.hidden).toBe(true);

    nav.destroy();
    document.body.removeChild(container);
  });
});
