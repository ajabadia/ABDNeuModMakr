import { describe, expect, it } from 'vitest';
import {
  SHARED_EN,
  SHARED_ES,
  collectLocaleKeys,
  deepMergeLocales,
  createSynthI18n,
} from './index.js';

describe('ABDShared Universal 2-Tier i18n Engine', () => {
  it('SHARED_EN and SHARED_ES maintain 100% key parity', () => {
    const enKeys = collectLocaleKeys(SHARED_EN);
    const esKeys = collectLocaleKeys(SHARED_ES);

    expect(enKeys).toEqual(esKeys);
    expect(enKeys.length).toBeGreaterThan(70);
  });

  it('deepMergeLocales merges nested synth extensions cleanly without mutating base', () => {
    const synthExt = {
      navbar: {
        menuFile: 'Custom File',
        customBtn: 'Custom Action',
      },
      customSection: {
        title: 'My Synth Section',
      },
    };

    const merged = deepMergeLocales(SHARED_EN, synthExt);
    expect(merged.navbar.menuFile).toBe('Custom File');
    expect(merged.navbar.menuEdit).toBe('Edit'); // preserved from SHARED_EN
    expect(merged.navbar.customBtn).toBe('Custom Action');
    expect(merged.customSection.title).toBe('My Synth Section');
    expect(SHARED_EN.navbar.menuFile).toBe('File'); // unmutated
  });

  it('createSynthI18n switches locale, interpolates variables, and notifies subscribers', () => {
    const i18n = createSynthI18n({
      locales: {
        en: { custom: { greeting: 'Hello {name} ({count})' } },
        es: { custom: { greeting: 'Hola {name} ({count})' } },
      },
      defaultLocale: 'en',
    });

    expect(i18n.getLocale()).toBe('en');
    expect(i18n.t('common.close')).toBe('Close');
    expect(i18n.t('custom.greeting', { name: 'Axionik', count: 12 })).toBe('Hello Axionik (12)');

    let observedLocale = '';
    const unsub = i18n.onLocaleChange((loc) => {
      observedLocale = loc;
    });

    i18n.setLocale('es');
    expect(observedLocale).toBe('es');
    expect(i18n.getLocale()).toBe('es');
    expect(i18n.t('common.close')).toBe('Cerrar');
    expect(i18n.t('custom.greeting', { name: 'Axionik', count: 12 })).toBe('Hola Axionik (12)');

    unsub();
  });
});
