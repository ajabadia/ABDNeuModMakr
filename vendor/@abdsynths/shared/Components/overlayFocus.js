/**
 * overlayFocus — contrato de foco/inert de los overlays de la familia ABD.
 * ========================================================================
 *
 * Lo que ya hacia el cajon compartido (`components/drawer.js`) y lo que de ahi
 * en adelante hacen TODOS los overlays de la familia (el `slideDrawer` de
 * ABDMS2000, el block-drawer de CZ101, los modales de banco, about,
 * diagnostico y osciloscopio):
 *
 *   1. CERRADO, el overlay va `inert` + `aria-hidden="true"`: su contenido
 *      sigue en el documento (los selftests de la familia cuentan celdas) pero
 *      fuera del orden de tabulacion y del arbol de accesibilidad. Al abrir se
 *      suelta; al cerrar se restaura DESPUES de devolver el foco (hacer inert
 *      un contenedor con el foco dentro lo tira a <body>).
 *   2. AL ABRIR, el foco entra en el primer control del CUERPO (no en la X del
 *      encabezado) — DESPUES del aviso de apertura del host, que puede
 *      repoblar el cuerpo y decidir cual es el primero. Sin controles, el
 *      propio overlay se enfoca (ultimo recurso, con tabindex="-1").
 *   3. ABIERTO, Tab/Shift+Tab CICLAN por sus controles y no se escapan. La
 *      trampa solo actua cuando el foco esta DENTRO: con varios overlays
 *      abiertos, el que no tiene el foco no secuestra el teclado del otro.
 *   4. AL CERRAR, el foco vuelve al DISPARADOR (lo apunta el propio modulo:
 *      `document.activeElement` en el instante de abrir, fuera del overlay).
 *      Se limpia en cada cierre — dos cierres no devuelven el foco dos veces —
 *      y un nodo que ya no cuelga del documento no se toca.
 *   5. Escape CIERRA si el overlay esta abierto (el cierre lo ejecuta el
 *      dueño via `onEscape`: el estado y el aviso siguen siendo suyos), sin
 *      mirar donde este el foco — como venia haciendo la familia.
 *   6. Sin material no hay contrato: si el overlay no existe, todo es no-op.
 *
 * El cajon compartido (`components/drawer.js`) usa ESTE modulo para su foco:
 * el contrato vive en un solo sitio y su test lo prueba una sola vez.
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
 * Los controles tabulables de `root` que de verdad se pueden alcanzar: fuera
 * los `hidden` (propios o heredados) y los que no se pintan. No se mira
 * `offsetParent`, que en un DOM sin layout (jsdom) siempre es `null`.
 */
export function focusableWithin(root) {
  return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)).filter((node) => {
    if (node.closest('[hidden]')) return false;

    const style = window.getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });
}

/**
 * Crea la API de foco de un overlay. `root` es el overlay entero (con su
 * encabezado), `body` el contenedor del contenido (`focusFirst` prefiere sus
 * controles a los del encabezado) e `isClosed` se consulta en cada tecla, asi
 * que el estado abierto/cerrado lo sigue poseyendo el componente.
 *
 * @param {{ root: HTMLElement, body?: HTMLElement|null, isClosed: Function,
 *            onEscape?: Function|null }} spec
 * @returns {{ attach: Function, detach: Function, setInert: Function,
 *             releaseInert: Function, focusFirst: Function, restoreFocus: Function,
 *             rememberTrigger: Function, trapTab: Function, handleKeydown: Function }}
 */
export function createOverlayFocus({ root, body = null, isClosed, onEscape = null }) {
  let lastFocused = null;

  /**
   * Tab dentro del overlay es un CICLO entre sus controles: en los bordes (el
   * primero hacia atras, el ultimo hacia delante) el overlay se queda con la
   * tecla y salta al otro extremo; en medio no toca nada y tabula el
   * navegador. Si el foco no esta dentro no se intercepta.
   */
  function trapTab(event) {
    if (!root.contains(document.activeElement)) return;

    const controls = focusableWithin(root);

    if (controls.length === 0) {
      // Sin controles no hay ciclo posible: la tecla se queda en el overlay.
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

  /** Escape (si esta abierto) pide el cierre; Tab activa la trampa. */
  function handleKeydown(event) {
    if (isClosed()) return;

    if (event.key === 'Escape') onEscape?.();
    else if (event.key === 'Tab') trapTab(event);
  }

  /** El primer control del cuerpo; luego el del overlay entero; y, sin nada, el overlay mismo. */
  function focusFirst() {
    const target =
      (body ? focusableWithin(body)[0] : undefined) ??
      focusableWithin(root)[0] ??
      root;
    target.focus({ preventScroll: true });
  }

  /**
   * Devuelve el foco al disparador del ultimo `open()`. `lastFocused` se
   * limpia siempre: dos cierres no pueden devolver el foco dos veces, y el
   * nodo que ya no cuelga del documento no se toca.
   */
  function restoreFocus() {
    const target = lastFocused;
    lastFocused = null;

    if (target?.isConnected && typeof target.focus === 'function') {
      target.focus({ preventScroll: true });
    }
  }

  /**
   * Apunta el disparador: quien tenia el foco al abrir, SOLO si es un nodo
   * real de fuera del overlay (ni <body> ni algo de dentro, que no es un
   * disparador al que volver).
   */
  function rememberTrigger() {
    const active = document.activeElement;
    lastFocused =
      active && active !== document.body && !root.contains(active) ? active : null;
  }

  /** Cerrado: fuera de tabulacion y del arbol de accesibilidad, sin sacarlo del DOM. */
  function setInert() {
    root.setAttribute('inert', '');
    root.setAttribute('aria-hidden', 'true');
  }

  /** Abierto: de vuelta al documento (ANTES de mover el foco: un contenedor inert es sordo). */
  function releaseInert() {
    root.removeAttribute('inert');
    root.setAttribute('aria-hidden', 'false');
  }

  /** Teclado global (Escape + trampa de Tab). El dueño lo ata y lo suelta en destroy(). */
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
