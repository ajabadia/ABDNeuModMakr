/**
 * bankCategories — clasificación canónica de presets por parameter set
 * (paquete compartido).
 * ======================================================================
 *
 * Unión de las reglas que vivían duplicadas en ABDNeuModMakr y
 * ABDAxionikVS: la misma categoría cae siempre en el mismo `cat-N`.
 *
 * No devuelve iconos: cada host mapea `paramId` a su propio juego de
 * ICONS. Solo decide la clase CSS (`cat-N`, ya definida en
 * `Assets/styles/components/catalog-browser.css`) y el set numérico.
 *
 * Usage:
 *   import { classifyBankCategory } from '@abdsynths/shared/components/bank/bankCategories.js';
 *   const { catClass, paramId } = classifyBankCategory('Silk Strings');
 *
 * @param {string} category nombre de categoría (cualquier capitalización).
 * @returns {{ catClass: string, paramId: number }} `cat-0`/`0` si no encaja.
 */
export const BANK_CATEGORY_LABELS = {
  en: {
    0: 'General',
    1: 'Strings / Solo',
    2: 'Bells / World',
    3: 'Bass / Pluck',
    4: 'Pads / Showcase',
    5: 'Keys / Organ',
    6: 'Winds / Vocal',
    7: 'Textures / FX',
    8: 'Arp / Loops',
    9: 'Rhythm / Drums',
  },
  es: {
    0: 'General',
    1: 'Cuerdas / Solistas',
    2: 'Campanas / Étnico',
    3: 'Bajos / Punteo',
    4: 'Pads / Showcase',
    5: 'Teclados / Órgano',
    6: 'Vientos / Voces',
    7: 'Texturas / FX',
    8: 'Arpegios / Loops',
    9: 'Ritmos / Percusión',
  },
};

export function getBankCategoryLabel(paramId, locale) {
  let lang = locale;
  if (lang !== 'es' && lang !== 'en') {
    try {
      if (typeof localStorage !== 'undefined') {
        const saved =
          localStorage.getItem('abdsynths.locale') ||
          localStorage.getItem('abd_locale') ||
          localStorage.getItem('neumodmakr.locale');
        if (saved === 'es' || saved === 'en') lang = saved;
      }
    } catch {
      // ignore
    }
  }
  const dict = lang === 'es' ? BANK_CATEGORY_LABELS.es : BANK_CATEGORY_LABELS.en;
  return dict[paramId] || dict[0];
}

export function classifyBankCategory (category)
{
  const cat = (category || '').toLowerCase();
  if (cat.includes('string') || cat.includes('solo') || cat.includes('chord')) return { catClass: 'cat-1', paramId: 1 };
  if (cat.includes('bell') || cat.includes('percussion') || cat.includes('world')) return { catClass: 'cat-2', paramId: 2 };
  if (cat.includes('bass') || cat.includes('pluck') || cat.includes('plugged')) return { catClass: 'cat-3', paramId: 3 };
  if (cat.includes('pad') || cat.includes('showcase')) return { catClass: 'cat-4', paramId: 4 };
  if (cat.includes('key') || cat.includes('piano') || cat.includes('organ')) return { catClass: 'cat-5', paramId: 5 };
  if (cat.includes('wind') || cat.includes('reed') || cat.includes('brass') || cat.includes('vocal') || cat.includes('voice') || cat.includes('choir')) return { catClass: 'cat-6', paramId: 6 };
  if (cat.includes('texture') || cat.includes('drone') || cat.includes('fx')) return { catClass: 'cat-7', paramId: 7 };
  if (cat.includes('arp') || cat.includes('loop') || cat.includes('sequenced')) return { catClass: 'cat-8', paramId: 8 };
  if (cat.includes('rhythm') || cat.includes('drum')) return { catClass: 'cat-9', paramId: 9 };
  return { catClass: 'cat-0', paramId: 0 };
}
