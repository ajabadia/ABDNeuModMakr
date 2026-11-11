// ─────────────────────────────────────────────────────────
// ABDShared — uiSpotlight (Spotlight ring for UI targets)
// ─────────────────────────────────────────────────────────

let activeRing = null;
let activeTimer = null;

export function clearUiHighlight() {
  if (activeTimer) {
    clearTimeout(activeTimer);
    activeTimer = null;
  }
  if (activeRing && activeRing.parentNode) {
    activeRing.parentNode.removeChild(activeRing);
    activeRing = null;
  }
}

/**
 * Busca un elemento con [data-ai-target="targetId"], hace scroll suave
 * y posiciona un anillo flotante de pulso.
 */
export function highlightUiTarget(targetId, durationMs = 2600) {
  clearUiHighlight();
  if (!targetId || typeof document === 'undefined') return false;

  const safeSelector = `[data-ai-target="${CSS.escape(targetId)}"]`;
  const el = document.querySelector(safeSelector);
  if (!el || el.getClientRects().length === 0) {
    return false;
  }

  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const rect = el.getBoundingClientRect();
  const ring = document.createElement('div');
  ring.className = 'abd-ai-spotlight-ring';
  ring.style.cssText = `
    position: fixed;
    top: ${rect.top - 4}px;
    left: ${rect.left - 4}px;
    width: ${rect.width + 8}px;
    height: ${rect.height + 8}px;
    border-radius: 6px;
    border: 2px solid var(--accent, #3b82f6);
    box-shadow: 0 0 14px var(--accent, #3b82f6);
    pointer-events: none;
    z-index: 13000;
    transition: all 0.2s ease-out;
  `;

  document.body.appendChild(ring);
  activeRing = ring;

  activeTimer = setTimeout(() => {
    clearUiHighlight();
  }, durationMs);

  return true;
}
