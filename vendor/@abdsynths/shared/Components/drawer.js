/**
 * createDrawer — cajón lateral deslizante de la familia ABD (paquete compartido).
 * ================================================================================
 *
 * El patrón de los hermanos (ABDMS2000, ABDEep, ABDCZ101): panel fijo a la derecha,
 * fondo que atenúa el lienzo, cierre con ESC y con el botón, `role="dialog"`.
 *
 * DIFERENCIA DELIBERADA con el `slideDrawer` de ABDMS2000: allí `open()` recibe un
 * `render(container)` y RECONSTRUYE el contenido en cada apertura. Aquí no: el
 * llamador monta el contenido UNA vez y el cajón solo se desplaza. Tres razones,
 * y las tres son contratos reales de la suite:
 *
 *   1. los controles tienen que estar SIEMPRE en el documento: los selftests del
 *      host y las suites cuentan celdas, y un control que solo existe mientras el
 *      cajón está abierto rompería ese recuento (y el `paint`, que pinta estado
 *      sobre celdas que el propio llamador posee);
 *   2. reconstruir por apertura pierde el foco y el gesto en curso (un arrastre
 *      que empieza con el cajón abierto se quedaría sin destino);
 *   3. con el DOM estable, abrir/cerrar es una clase CSS: nada que pueda fallar.
 *
 * FOCO: como consecuencia del punto 1, el contenido tambien existe con el cajon
 * cerrado, y un cajon con celdas tabulables no puede dejar que Tab se pasee por
 * dentro mientras esta oculto: cerrado, el cajon va `inert` (el contenido sigue
 * en el documento, contrato 1, pero fuera del orden de tabulacion y del arbol de
 * accesibilidad) y al abrir lo suelta. Las piezas del foco — inert, foco al
 * primer control del CUERPO al abrir, trampa de Tab, vuelta al DISPARADOR al
 * cerrar — viven en `overlayFocus.js`, compartidas con el slideDrawer de
 * ABDMS2000, el block-drawer de CZ101 y los modales de la familia; alli esta el
 * contrato detallado y su test.
 *
 * Es genérico: no sabe nada del synth que lo usa — recibe id, título, distintivo
 * y un `body` donde el llamador pone lo que quiera; el encabezado se puede reescribir
 * en caliente (`setHeader`) sin tocar nada del cuerpo, y el cajón avisa de sus
 * TRANSICIONES (`onOpen`/`onClose`) para que el host reaccione una sola vez por
 * apertura. Los estilos base viven en
 * `styles/components/widgets.css` (`.drawer*` con fallbacks); cada synthe afina
 * el suyo en su hoja local (anchos, tipografía) si quiere.
 */

const OPEN_CLASS = 'drawer--open';
const BACKDROP_CLASS = 'drawer-backdrop--visible';

// El CONTRATO de foco/inert (trampa de Tab, foco al abrir, vuelta al
// disparador, inert al cerrar) vive en overlayFocus.js, compartido con el
// slideDrawer de ABDMS2000, el block-drawer de CZ101 y los modales de la
// familia; su test lo prueba una sola vez (tests/overlayFocus.test.js).
import { createOverlayFocus } from './overlayFocus.js';

/**
 * @param {object} options
 * @param {string} options.id            id del cajón (y de su fondo).
 * @param {string} [options.title]       título del encabezado (aria-label del dialog).
 * @param {string} [options.badge]       distintivo corto (p. ej. "4 RUTAS").
 * @param {string} [options.closeLabel]  etiqueta accesible del cierre,
 *   default 'Cerrar (Esc)'.
 * @param {Function} [options.onOpen]    aviso de apertura; recibe el cajón.
 * @param {Function} [options.onClose]   aviso de cierre; recibe el cajón.
 *
 * Los avisos son de TRANSICION, no de intencion: `open()` sobre un cajón ya abierto
 * (o `close()` sobre uno ya cerrado) no llama a nadie — para saber si la peticion
 * cambió algo esta `isOpen()`. Y `destroy()` NO es un cierre: quitar el nodo no es
 * la transicion que `onClose` anuncia, asi que un host que tenga que soltar algo al
 * final lo suelta en su propio camino de destruccion, no en el aviso.
 *
 * Usage:
 *   const drawer = createDrawer({ id: 'routes', title: 'Rutas' });
 *   drawer.setHeader({ title: 'Rutas', badge: '5 RUTAS' }).open();
 *   if (!drawer.isOpen()) drawer.toggle();   // el toggle respeta el estado
 *   drawer.close();
 *
 * @returns {{ element: HTMLElement, backdrop: HTMLElement, body: HTMLElement,
 *             header: HTMLElement, open: Function, close: Function, toggle: Function,
 *             isOpen: Function, setHeader: Function, destroy: Function }}
 */
export function createDrawer({
  id,
  title = '',
  badge = '',
  closeLabel = 'Cerrar (Esc)',
  onOpen = null,
  onClose = null,
}) {
  const backdrop = document.createElement('div');
  backdrop.className = 'drawer-backdrop';
  backdrop.dataset.drawerBackdrop = id;

  const element = document.createElement('aside');
  element.className = 'drawer';
  element.id = id;
  element.dataset.drawer = id;
  element.setAttribute('role', 'dialog');
  element.setAttribute('aria-modal', 'true');
  element.setAttribute('aria-label', title);
  element.setAttribute('aria-hidden', 'true');
  // Cerrado el contenido NO es tabulable. `inert` quita el cajon entero del orden
  // de tabulacion (y del arbol de accesibilidad) SIN sacar un solo nodo del DOM
  // —el contrato n.º 1 de la cabecera—, asi que los recuentos de los selftests
  // del host y el `paint` del llamador siguen viendo exactamente las mismas
  // celdas. `aria-hidden` se queda: dice lo mismo a quien no entiende `inert`.
  element.setAttribute('inert', '');
  // Ultimo recurso del foco: un cajon sin ningun control enfocable (llamador que
  // se lo deja vacio y quita el cierre) se puede enfocar a si mismo y asi la
  // trampa de Tab tiene donde quedarse.
  element.setAttribute('tabindex', '-1');

  const header = document.createElement('div');
  header.className = 'drawer__header';

  const badgeElement = document.createElement('span');
  badgeElement.className = 'drawer__badge';
  badgeElement.textContent = badge;

  const titleElement = document.createElement('h2');
  titleElement.className = 'drawer__title';
  titleElement.textContent = title;

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'drawer__close';
  closeButton.textContent = '✕';
  closeButton.title = closeLabel;
  closeButton.setAttribute('aria-label', closeLabel);

  const body = document.createElement('div');
  body.className = 'drawer__body';

  header.append(badgeElement, titleElement, closeButton);
  element.append(header, body);

  let open = false;
  // Un componente destruido no muta: si no, `open()` sobre un cajon ya quitado
  // seguiria cambiando estado y clases de nodos que nadie verá.
  let destroyed = false;

  // El CONTRATO de foco (trampa de Tab, foco al abrir, vuelta al disparador,
  // inert, Escape) lo lleva overlayFocus.js; el estado y los avisos siguen
  // siendo de este cajon.
  const focus = createOverlayFocus({
    root: element,
    body,
    isClosed: () => !open,
    onEscape: () => closeDrawer(),
  });
  const onKeyDown = focus.handleKeydown;

  closeButton.addEventListener('click', () => closeDrawer());
  backdrop.addEventListener('click', () => closeDrawer());
  focus.attach();

  function closeDrawer() {
    if (destroyed || !open) return;

    open = false;
    element.classList.remove(OPEN_CLASS);
    backdrop.classList.remove(BACKDROP_CLASS);

    // El foco sale ANTES del aviso: quien recibe `onClose` ya mira una pantalla
    // con el foco donde estaba antes de abrir. Y sale ANTES del `inert`: hacer
    // inerte el contenedor con el foco dentro lo tira a <body> —justo lo que la
    // devolucion al disparador existe para evitar—.
    focus.restoreFocus();
    focus.setInert();

    // El aviso va DESPUES del cambio: quien lo recibe mira el DOM o llama a
    // `isOpen()` y ve el cajón ya cerrado.
    onClose?.(api);
  }

  function openDrawer() {
    if (destroyed || open) return;

    // Quien tenia el foco al abrir lo apunta el modulo (solo si es un nodo real
    // de fuera del cajon: ni <body> ni algo de dentro, que no es un disparador
    // al que volver) para devolverselo al cerrar.
    focus.rememberTrigger();

    open = true;
    element.classList.add(OPEN_CLASS);
    // Antes del foco: un contenedor `inert` no deja enfocar lo de dentro, asi que
    // el `focusFirst` de mas abajo encontraria el cajon sordo.
    focus.releaseInert();
    backdrop.classList.add(BACKDROP_CLASS);

    onOpen?.(api);

    // El foco entra DESPUES del aviso: un host que reordena o repinta el cuerpo
    // en `onOpen` decide cual es el primer control, y el cajon lo busca entonces.
    focus.focusFirst();
  }

  // La página los cuelga del documento (position: fixed), como los hermanos.
  document.body.append(backdrop, element);

  const api = {
    element,
    backdrop,
    body,
    header,
    open: openDrawer,
    close: closeDrawer,
    toggle: () => (open ? closeDrawer() : openDrawer()),
    isOpen: () => open,

    /**
     * Reescribe el encabezado SIN reconstruir nada: el título visible y el
     * `aria-label` del dialog son el MISMO dato (es el nombre del cajón), y el
     * distintivo es corto y cambia con el contenido (p. ej. el número de rutas).
     * Un campo que no venga en el objeto se queda como estaba; uno que venga vacío
     * se limpia. Devuelve el cajón, para encadenar
     * (`drawer.setHeader({ badge: '5 RUTAS' }).open()`).
     *
     * @param {{title?: string, badge?: string}} [next]
     */
    setHeader({ title: nextTitle, badge: nextBadge } = {}) {
      if (destroyed) return api;

      if (nextTitle !== undefined) {
        titleElement.textContent = String(nextTitle ?? '');
        element.setAttribute('aria-label', titleElement.textContent);
      }

      if (nextBadge !== undefined)
        badgeElement.textContent = String(nextBadge ?? '');

      return api;
    },

    destroy() {
      destroyed = true;
      focus.detach();
      backdrop.remove();
      element.remove();
    },
  };

  return api;
}
