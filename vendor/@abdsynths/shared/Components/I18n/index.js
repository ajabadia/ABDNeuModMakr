/**
 * @abdsynths/shared — Components/I18n/index.js
 * Universal Reactive Internationalization (i18n) Engine for the ABDSynths Suite.
 *
 * Implements the 2-Tier Architecture:
 *   Tier 1 (Core): Common terminology in SHARED_LOCALES (SHARED_EN / SHARED_ES).
 *   Tier 2 (Synth): Synthesizer-specific dictionary extensions merged cleanly on top.
 *
 * Features:
 * - Instant runtime locale switching ('en' | 'es', extensible to any language).
 * - Deep merge of SHARED_LOCALES + synth-specific locales via `createSynthI18n()`.
 * - Declarative DOM binding (`data-i18n`, `data-i18n-title`, `data-i18n-placeholder`).
 * - Variable interpolation: `t('key', { count: 5 })`.
 * - Suite-wide persistence in `localStorage` (`abdsynths.locale`) with optional
 *   legacy key migration (e.g. `axionik.locale`).
 * - Built-in key parity verifier `collectLocaleKeys()` for automated testing.
 */

import { SHARED_EN } from './locales/en.js';
import { SHARED_ES } from './locales/es.js';

export { SHARED_EN, SHARED_ES };

export const SHARED_LOCALES = {
  en: SHARED_EN,
  es: SHARED_ES,
};

export const DEFAULT_STORAGE_KEY = 'abdsynths.locale';

/**
 * Deeply merges two plain objects without mutating inputs.
 * Values in `overrideObj` take precedence over `baseObj`.
 */
export function deepMergeLocales(baseObj, overrideObj) {
  if (!overrideObj || typeof overrideObj !== 'object') {
    return baseObj ? { ...baseObj } : {};
  }
  const result = { ...(baseObj || {}) };
  for (const [key, val] of Object.entries(overrideObj)) {
    if (
      val !== null &&
      typeof val === 'object' &&
      !Array.isArray(val) &&
      typeof result[key] === 'object' &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMergeLocales(result[key], val);
    } else {
      result[key] = val;
    }
  }
  return result;
}

/**
 * Recursively collects all dot-separated leaf key paths of a locale object.
 * Used in unit tests to guarantee 100% key parity across languages.
 */
export function collectLocaleKeys(obj, prefix = '') {
  let keys = [];
  if (!obj || typeof obj !== 'object') return keys;
  for (const [k, v] of Object.entries(obj)) {
    const fullPath = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      keys = keys.concat(collectLocaleKeys(v, fullPath));
    } else {
      keys.push(fullPath);
    }
  }
  return keys.sort();
}

function getNestedValue(obj, path) {
  if (!obj || typeof obj !== 'object' || !path) return undefined;
  const parts = String(path).split('.');
  let curr = obj;
  for (const part of parts) {
    if (curr === undefined || curr === null) return undefined;
    curr = curr[part];
  }
  return curr;
}

/**
 * Creates a reactive i18n instance combining SHARED_LOCALES with synth-specific locales.
 *
 * @param {object} options
 * @param {Record<string, object>} [options.locales] - Map of synth-specific locales (e.g. `{ en: synthEn, es: synthEs }`)
 * @param {string} [options.defaultLocale='en'] - Fallback default locale
 * @param {string} [options.storageKey='abdsynths.locale'] - Primary localStorage key
 * @param {string[]} [options.legacyStorageKeys=[]] - Optional fallback storage keys to check/sync
 * @param {boolean} [options.detectBrowserLocale=true] - When false, an unsaved profile starts in
 *   `defaultLocale` instead of `navigator.language` (apps whose default language is fixed)
 */
export function createSynthI18n(options = {}) {
  const customLocales = options.locales || {};
  const defaultLocale = options.defaultLocale || 'en';
  const storageKey = options.storageKey || DEFAULT_STORAGE_KEY;
  const legacyKeys = Array.isArray(options.legacyStorageKeys) ? options.legacyStorageKeys : [];
  const detectBrowserLocale = options.detectBrowserLocale !== false;

  // Build merged dictionary for all supported languages
  const allLangCodes = new Set([
    ...Object.keys(SHARED_LOCALES),
    ...Object.keys(customLocales),
  ]);

  const dictionaries = {};
  for (const lang of allLangCodes) {
    dictionaries[lang] = deepMergeLocales(
      SHARED_LOCALES[lang] || {},
      customLocales[lang] || {}
    );
  }

  let currentLocale = defaultLocale;
  const subscribers = new Set();

  function isSupported(lang) {
    return Boolean(lang && dictionaries[lang]);
  }

  function initI18n() {
    try {
      if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem(storageKey);
        if (isSupported(saved)) {
          currentLocale = saved;
          return currentLocale;
        }
        for (const legacyKey of legacyKeys) {
          const legacySaved = localStorage.getItem(legacyKey);
          if (isSupported(legacySaved)) {
            currentLocale = legacySaved;
            localStorage.setItem(storageKey, currentLocale);
            return currentLocale;
          }
        }
      }
    } catch {
      // Ignore storage access errors in restricted environments
    }

    const browserLang =
      detectBrowserLocale && typeof navigator !== 'undefined' && navigator.language
        ? navigator.language.slice(0, 2).toLowerCase()
        : defaultLocale;

    if (isSupported(browserLang)) {
      currentLocale = browserLang;
    } else {
      currentLocale = defaultLocale;
    }

    return currentLocale;
  }

  function getLocale() {
    return currentLocale;
  }

  function getSupportedLocales() {
    return Array.from(allLangCodes);
  }

  function getDictionary(locale = currentLocale) {
    return dictionaries[locale] || dictionaries[defaultLocale] || SHARED_EN;
  }

  function t(path, params) {
    const activeDict = dictionaries[currentLocale] || dictionaries[defaultLocale] || SHARED_EN;
    const fallbackDict = dictionaries[defaultLocale] || SHARED_EN;

    const val = getNestedValue(activeDict, path) ?? getNestedValue(fallbackDict, path);

    if (typeof val === 'string') {
      if (!params) return val;
      return val.replace(/\{(\w+)\}/g, (_, k) =>
        params[k] !== undefined ? String(params[k]) : `{${k}}`
      );
    }

    if (typeof val === 'function') {
      try {
        return val(params);
      } catch {
        return path;
      }
    }

    return path;
  }

  function applyI18n(root) {
    if (typeof document === 'undefined') return;
    const target = root || document;

    target.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (key) {
        el.textContent = t(key);
      }
    });

    target.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const key = el.getAttribute('data-i18n-title');
      if (key) {
        el.setAttribute('title', t(key));
      }
    });

    target.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key && 'placeholder' in el) {
        el.placeholder = t(key);
      }
    });
  }

  function setLocale(locale) {
    if (!isSupported(locale)) return;
    if (currentLocale === locale) return;

    currentLocale = locale;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(storageKey, locale);
        for (const legacyKey of legacyKeys) {
          localStorage.setItem(legacyKey, locale);
        }
      }
    } catch {
      // Ignore storage errors
    }

    applyI18n();

    subscribers.forEach((cb) => {
      try {
        cb(currentLocale);
      } catch (err) {
        console.error('[ABDShared i18n] Error in locale subscriber:', err);
      }
    });
  }

  function onLocaleChange(callback) {
    subscribers.add(callback);
    return () => subscribers.delete(callback);
  }

  /**
   * Registers or extends a locale dynamically at runtime.
   */
  function extendLocale(locale, partialDict) {
    allLangCodes.add(locale);
    dictionaries[locale] = deepMergeLocales(
      dictionaries[locale] || SHARED_LOCALES[locale] || {},
      partialDict
    );
  }

  return {
    initI18n,
    getLocale,
    setLocale,
    onLocaleChange,
    t,
    applyI18n,
    getSupportedLocales,
    getDictionary,
    extendLocale,
  };
}
