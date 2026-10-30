/**
 * OverlayFocus — Contrato de foco/inert de los overlays de la familia ABD.
 * ========================================================================
 *
 * Contrato transversal de accesibilidad:
 *   1. CERRADO: inert + aria-hidden="true".
 *   2. AL ABRIR: foco en primer control del cuerpo o contenedor.
 *   3. ABIERTO: trampa de Tab/Shift+Tab cíclica.
 *   4. AL CERRAR: restauración del foco al elemento disparador.
 *   5. Escape: cierre accesible del overlay.
 */

/** Lo que el navegador tabula dentro de un contenedor, en orden de DOM. */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Los controles tabulables de `root` que de verdad se pueden alcanzar.
 */
export function focusableWithin(root) {
  if (!root) return [];
  return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)).filter((node) => {
    if (node.closest('[hidden]')) return false;

    const style = window.getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });
}

/**
 * Crea la API de foco de un overlay.
 *
 * @param {{ root: HTMLElement, body?: HTMLElement|null, isClosed: Function,
 *            onEscape?: Function|null }} spec
 */
export function createOverlayFocus({ root, body = null, isClosed, onEscape = null }) {
  let lastFocused = null;

  function trapTab(event) {
    if (!root || !root.contains(document.activeElement)) return;

    const controls = focusableWithin(root);

    if (controls.length === 0) {
      event.preventDefault();
      root.focus({ preventScroll: true });
      return;
    }

    const first = controls[0];
    const last = controls[controls.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }

  function handleKeydown(event) {
    if (isClosed()) return;

    if (event.key === 'Escape') onEscape?.();
    else if (event.key === 'Tab') trapTab(event);
  }

  function focusFirst() {
    if (!root) return;
    const target =
      (body ? focusableWithin(body)[0] : undefined) ??
      focusableWithin(root)[0] ??
      root;
    target.focus({ preventScroll: true });
  }

  function restoreFocus() {
    const target = lastFocused;
    lastFocused = null;

    if (target?.isConnected && typeof target.focus === 'function') {
      target.focus({ preventScroll: true });
    }
  }

  function rememberTrigger() {
    const active = document.activeElement;
    lastFocused =
      active && active !== document.body && (!root || !root.contains(active)) ? active : null;
  }

  function setInert() {
    if (!root) return;
    root.setAttribute('inert', '');
    root.setAttribute('aria-hidden', 'true');
  }

  function releaseInert() {
    if (!root) return;
    root.removeAttribute('inert');
    root.setAttribute('aria-hidden', 'false');
  }

  function attach() {
    document.addEventListener('keydown', handleKeydown);
  }

  function detach() {
    document.removeEventListener('keydown', handleKeydown);
  }

  return {
    attach,
    detach,
    setInert,
    releaseInert,
    focusFirst,
    restoreFocus,
    rememberTrigger,
    trapTab,
    handleKeydown,
  };
}
