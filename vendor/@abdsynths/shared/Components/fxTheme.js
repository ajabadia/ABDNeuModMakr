/**
 * FX themes — how an effect slot LOOKS, decoupled from what the effect IS.
 *
 * The same idea as skins/index.js, one level up: a skin says how a KNOB looks,
 * an fx theme says how a whole EFFECT MODULE looks. A project picks a theme
 * per family, or overrides the tokens, without touching the effect list.
 *
 * WHY BY FAMILY AND NOT BY EFFECT. There are 57 effect ids. A theme per effect
 * is 57 entries that nobody can tell apart, and 57 chances for the look to drift
 * from the catalogue. A theme per FAMILY is eleven, they are actually
 * distinguishable, and adding a variant is a row in contracts/fx-effects.json
 * that inherits its family's look for free.
 *
 * WHERE THE COLOUR LIVES, AND WHY IT IS IN BOTH PLACES.
 *
 *   1. Here, as literal FALLBACKS on the same token names.
 *   2. In styles/components/fx.css, as the real declaration:
 *        [data-fx-theme='reverb'] { --fx-bg: ...; }
 *
 * Both, on purpose, and with a test that fails if the two disagree (see
 * tests/fxTheme.test.js). One place alone is not enough:
 *
 *   - CSS alone cannot be validated. Nobody notices a theme that applies to a
 *     family that no effect uses, or one whose tokens were renamed, until
 *     someone looks at the screen.
 *   - JS alone paints nothing. Themes reached from JS alone die the day someone
 *     writes the colours into the component with inline styles instead.
 *
 * So the registry carries the metadata and the fallbacks, the CSS carries the
 * look, and the test is what keeps them from drifting. That is the same
 * division skins/index.js has between the registry and skins-junio.css.
 *
 * THEMING IS BY CUSTOM PROPERTY, per the family rule of COMPONENTS.md. A synth
 * that wants its own look overrides the tokens and nothing else:
 *
 *     .fx-module[data-fx-theme='reverb'] {
 *         --fx-accent: #ff2d95;
 *     }
 *
 * Usage:
 *   import { getFxTheme, fxThemeStyle, buildFxThemeIndex } from '@abdsynths/shared/components';
 *   const index = buildFxThemeIndex(catalogue);   // from contracts/fx-effects.json
 *   el.dataset.fxTheme = index.familyFor(39);     // 'space' for the Space Echo
 *   el.style.cssText = fxThemeStyle(index.familyFor(39));
 */

/** The token names every theme declares. A theme missing one fails the test. */
export const FX_THEME_TOKENS = Object.freeze([
  'bg',       // module background
  'border',   // frame / separator
  'text',     // label and readout text on that background
  'accent',   // the one colour that identifies the family (LED, meter, focus)
  'glow',     // the accent as a translucent wash, for shadows and fills
]);

/** The theme every family falls back to, and the one an unknown family gets. */
const NEUTRAL = Object.freeze({
  bg: 'var(--color-panel-surface, #151f2e)',
  border: 'var(--color-panel-border-dim, rgba(0, 195, 255, 0.1))',
  text: 'var(--color-text-main, #f0f7ff)',
  accent: 'var(--color-accent, #00c3ff)',
  glow: 'var(--color-accent-dim, rgba(0, 195, 255, 0.15))',
});

const registry = new Map([['bypass', NEUTRAL]]);

/**
 * @brief Register a theme under a family name. Overwriting is allowed.
 *
 * `theme` must declare every key of FX_THEME_TOKENS. A partial theme is a bug
 * that only shows up as one unstyled corner, so the test rejects it rather than
 * trusting the caller.
 *
 * @param {string} family
 * @param {Record<string, string>} theme
 */
export function registerFxTheme (family, theme)
{
  registry.set(family, Object.freeze({ ...NEUTRAL, ...theme }));
}

/**
 * @brief Get a theme by family, or the neutral one when unknown.
 *
 * Falling back rather than throwing is deliberate: an effect with no theme yet
 * should render as a plain module, not blank the rack.
 */
export function getFxTheme (family)
{
  return registry.get(family) ?? NEUTRAL;
}

/** @brief Families registered, for diagnostics and tests. */
export function fxThemeNames ()
{
  return [...registry.keys()];
}

/** @brief The neutral theme, for a caller that wants to compare against it. */
export function getNeutralFxTheme ()
{
  return NEUTRAL;
}

/**
 * @brief Build the inline style string that injects a family's custom
 * properties onto an element.
 *
 * This is the JS half of the theming, for the case where the element cannot
 * carry `data-fx-theme` (a knob rendered into a third-party widget, say). When
 * it can, prefer setting the attribute: the stylesheet then wins over these
 * values, so a project's own CSS is not fighting an inline style.
 *
 * @param {string} family
 * @returns {string}
 */
export function fxThemeStyle (family)
{
  const t = getFxTheme (family);

  return FX_THEME_TOKENS
    .map((token) => `--fx-${token}: ${t[token]};`)
    .join(' ');
}

/**
 * @brief Index a loaded catalogue (contracts/fx-effects.json) by effect id.
 *
 * The theme layer deliberately does NOT read the catalogue itself: that would
 * tie a pure styling module to a JSON fetch, and the same registry has to work
 * in a synth that has its own list. What it offers instead is this, so the
 * mapping lives in one place per project and there is a single call to audit.
 *
 * Every returned function takes one documented argument:
 *
 *   familyFor(id)  -> the family of an effect id, or null for an unknown id
 *   nameFor(id)    -> its display name, or null
 *   families()     -> the families in use, for diagnostics
 *   ids()          -> the ids in the catalogue
 *
 * @param {{effects: Array<{id: number, family: string, name: string}>}} catalogue
 *        the parsed contracts/fx-effects.json
 * @returns {{familyFor: (id: number) => string|null,
 *            nameFor: (id: number) => string|null,
 *            families: () => string[],
 *            ids: () => number[]}}
 */
export function buildFxThemeIndex (catalogue)
{
  const byId = new Map();

  for (const effect of catalogue?.effects ?? [])
    byId.set(effect.id, effect);

  /**
   * @brief The family of an effect id, or null when the id is unknown.
   * @param {number} id - the effect id the engine speaks (0 is bypass)
   * @returns {string|null}
   */
  function familyFor (id)
  {
    return byId.get(id)?.family ?? null;
  }

  /**
   * @brief The display name of an effect id, or null when unknown.
   * @param {number} id - the effect id the engine speaks
   * @returns {string|null}
   */
  function nameFor (id)
  {
    return byId.get(id)?.name ?? null;
  }

  /**
   * @brief The families in use by this catalogue, for diagnostics and tests.
   * @returns {string[]}
   */
  function families ()
  {
    return [...new Set([...byId.values()].map((e) => e.family))];
  }

  /**
   * @brief The effect ids present in this catalogue.
   * @returns {number[]}
   */
  function ids ()
  {
    return [...byId.keys()];
  }

  return { familyFor, nameFor, families, ids };
}

/* ── the built-in families ─────────────────────────────────────────────────── */

registerFxTheme('reverb', {
  bg: '#101c28',
  border: '#1d3a4d',
  text: '#d8ecf7',
  accent: '#5ad1e6',
  glow: 'rgba(90, 209, 230, 0.18)',
});

registerFxTheme('delay', {
  bg: '#141c2b',
  border: '#243a55',
  text: '#dce7f5',
  accent: '#7aa2f7',
  glow: 'rgba(122, 162, 247, 0.18)',
});

registerFxTheme('tape', {
  bg: '#241a12',
  border: '#4a3524',
  text: '#f0e0cc',
  accent: '#e0a458',
  glow: 'rgba(224, 164, 88, 0.2)',
});

registerFxTheme('chorus', {
  bg: '#1a1630',
  border: '#312a55',
  text: '#e2dcf7',
  accent: '#a78bfa',
  glow: 'rgba(167, 139, 250, 0.18)',
});

registerFxTheme('modulation', {
  bg: '#2a1430',
  border: '#48235a',
  text: '#f3ddf7',
  accent: '#e879f9',
  glow: 'rgba(232, 121, 249, 0.18)',
});

registerFxTheme('filter', {
  bg: '#12242a',
  border: '#1f424b',
  text: '#d6f0f2',
  accent: '#4fd1c5',
  glow: 'rgba(79, 209, 197, 0.18)',
});

registerFxTheme('dynamics', {
  bg: '#20261a',
  border: '#3a452c',
  text: '#e6f0d8',
  accent: '#a3d977',
  glow: 'rgba(163, 217, 119, 0.18)',
});

registerFxTheme('distortion', {
  bg: '#2b1414',
  border: '#532424',
  text: '#f7dcdc',
  accent: '#ff6b6b',
  glow: 'rgba(255, 107, 107, 0.2)',
});

registerFxTheme('pitch', {
  bg: '#26142b',
  border: '#45234e',
  text: '#f2dcf7',
  accent: '#c792ea',
  glow: 'rgba(199, 146, 234, 0.18)',
});

registerFxTheme('space', {
  bg: '#0b1a24',
  border: '#14384a',
  text: '#cfeaf5',
  accent: '#26c6da',
  glow: 'rgba(38, 198, 218, 0.22)',
});
