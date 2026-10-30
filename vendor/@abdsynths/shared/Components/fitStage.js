/**
 * FitStage — the design-canvas-to-viewport fit (page infrastructure).
 * ================================================================
 *
 * The canvas is FIXED-DESIGN (the layout of the controls is a number, not a
 * print) and the editor window is resizable: without a fit, a window shorter
 * than the design CUTS the bottom (footer and keyboard strip) out of view.
 *
 * The fix is page-level: scale the canvas with `transform` so it falls whole
 * inside the viewport, centring the leftover axis. `transform` does not change
 * the layout box, so the page must keep `body { overflow: hidden }` (a usage
 * requirement, documented in COMPONENTS.md) — otherwise the unscaled box would
 * generate scrollbars.
 *
 * This is page INFRASTRUCTURE, not a control: no constructor/setValue contract,
 * just two pure/mount functions. Design size always comes as a parameter — the
 * package never knows a synth's canvas; each synth passes its own from its own
 * SSOT (NEURONiK: `CANVAS` from sections.js; CZ101: its 1409x768).
 *
 * Scales are clamped to [minScale, maxScale] (defaults 0.25x..3x, the range of
 * NEURONiK's old native zoom). A caller may widen or narrow them: clamping is
 * the mechanism, the numbers are per-synth.
 *
 * `onlyShrink` (default false) caps the scale at 1x: never upscale past the
 * design. For FLUID pages (MS2000's responsive dashboard) whose design size is
 * their natural size: identity above it, shrink+centre below it -- and at
 * identity the centring margins are zeroed, so a 100%-width fluid app keeps
 * filling the viewport untouched.
 */

/**
 * Scale and centring so the design falls whole inside the viewport.
 *
 * @param {object} p
 * @param {number} p.viewportWidth   available width (CSS px)
 * @param {number} p.viewportHeight  available height (CSS px)
 * @param {number} p.designWidth     design canvas width
 * @param {number} p.designHeight    design canvas height
 * @param {number} [p.minScale=0.25] lower clamp (per-synth, optional)
 * @param {number} [p.maxScale=3]    upper clamp (per-synth, optional)
 * @param {boolean} [p.onlyShrink=false] cap the scale at 1 (never upscale); at
 *   identity the centring offsets are 0 so fluid layouts stay untouched
 * @param {number} [p.stageWidth]  natural (unscaled) stage box width, when the
 *   stage's CSS box may exceed the design (fluid floor); defaults to the design
 * @param {number} [p.stageHeight] natural (unscaled) stage box height, the same
 *   case on the vertical axis; defaults to the design height
 * @returns {{ scale: number, offsetX: number, offsetY: number }}
 *   `scale` clamped to [minScale, maxScale]; offsets (>= 0) centre the spare axis.
 *   Centring is computed against the SCALED STAGE BOX (design x scale, see the
 *   box note): for a fluid stage whose CSS box can exceed the design on one axis
 *   (min-width floor) it centres the actually-scaled element, never clipping the
 *   edge the scale axis does not constrain.
 */
export function computeFit({
  viewportWidth,
  viewportHeight,
  designWidth,
  designHeight,
  minScale = 0.25,
  maxScale = 3,
  onlyShrink = false,
  stageWidth,
  stageHeight,
}) {
  const vw = Math.max(1, Number(viewportWidth) || 0);
  const vh = Math.max(1, Number(viewportHeight) || 0);
  const dw = Math.max(1, Number(designWidth) || 0);
  const dh = Math.max(1, Number(designHeight) || 0);

  const min = Math.max(0, Number(minScale) || 0);
  const max = Math.max(min, Number(maxScale) || min);

  let scale = Math.min(max, Math.max(min, Math.min(vw / dw, vh / dh)));
  if (onlyShrink) scale = Math.min(scale, 1);

  // At identity (onlyShrink) zero the margins: a fluid app at 100% width must
  // keep filling the viewport, not get pushed aside by centring.
  const centre = !(onlyShrink && scale >= 1);

  // Box note: the stage's real scaled box is (dw*scale) x (dh*scale) when its
  // CSS follows the design size — the fixed-canvas case, where this equals the
  // plain (vw - dw*scale)/2 centring. A FLUID stage may be BIGGER than that on
  // the non-constraining axis (min-width/min-height floor): centring the scaled
  // design box there would clip one edge, so the caller can declare the real
  // NATURAL (unscaled) box and the centre targets the scaled element.
  const boxW = Math.max(1, Number(stageWidth) || dw);
  const boxH = Math.max(1, Number(stageHeight) || dh);
  const fitW = Math.min(vw, Math.max(dw * scale, boxW * scale));
  const fitH = Math.min(vh, Math.max(dh * scale, boxH * scale));

  return {
    scale,
    offsetX: centre ? Math.max(0, (vw - fitW) / 2) : 0,
    offsetY: centre ? Math.max(0, (vh - fitH) / 2) : 0,
  };
}

/**
 * Mount the fit on the stage element and keep it fresh on every resize.
 *
 * @param {HTMLElement} stage      the design canvas (carries the design size in CSS)
 * @param {object} [options]
 * @param {number} options.width   design width
 * @param {number} options.height  design height
 * @param {number} [options.minScale=0.25] lower clamp
 * @param {number} [options.maxScale=3]    upper clamp
 * @param {boolean} [options.onlyShrink=false] never scale above 1x (fluid pages)
 * @param {object} [options.viewport]  object with innerWidth/innerHeight and
 *   addEventListener (injectable for tests; default `window`)
 * @returns {() => void} removes the resize listener
 */
export function mountFitStage(stage, { width, height, minScale, maxScale, onlyShrink, viewport = window } = {}) {
  const apply = () => {
    // Natural (unscaled) box of the stage, measured live: fixed-canvas stages
    // measure exactly the design (or 0 in jsdom -> design fallback, same result);
    // a fluid stage with a CSS floor measures its real box, so cross-axis
    // centring stays honest. `transform` never affects offsetWidth/Height.
    const naturalW = stage.offsetWidth || width;
    const naturalH = stage.offsetHeight || height;
    const { scale, offsetX, offsetY } = computeFit({
      viewportWidth: viewport.innerWidth,
      viewportHeight: viewport.innerHeight,
      designWidth: width,
      designHeight: height,
      minScale,
      maxScale,
      onlyShrink,
      stageWidth: naturalW,
      stageHeight: naturalH,
    });

    stage.style.transformOrigin = 'top left';
    if (scale === 1 && offsetX === 0 && offsetY === 0) {
      // Identity: clear instead of scale(1) — a lingering transform (even at
      // 1) creates a CSS containing block and would re-anchor position:fixed
      // overlays (dropdowns, drawers) to the stage. Identity must be a no-op.
      stage.style.transform = '';
      stage.style.marginLeft = '0px';
      stage.style.marginTop = '0px';
    } else {
      stage.style.transform = `scale(${scale})`;
      stage.style.marginLeft = `${offsetX}px`;
      stage.style.marginTop = `${offsetY}px`;
    }
  };

  apply();
  viewport.addEventListener('resize', apply);

  return () => viewport.removeEventListener('resize', apply);
}
