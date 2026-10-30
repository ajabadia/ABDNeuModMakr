/**
 * bankCard — tarjeta canónica del catálogo NeuronDB (paquete compartido).
 * ======================================================================
 *
 * Un solo generador de `.ndb-card` para todos los hosts: la misma
 * estructura que ya pintaban ABDNeuModMakr y ABDAxionikVS (icono,
 * cabecera slot/categoría, nombre, insignias, acciones). Los estilos
 * viven en `Assets/styles/components/catalog-browser.css`, incluida la
 * selección (`.wt-selected` / `.is-selected`).
 *
 * La tarjeta no decide nada: sirve la selección por delegación
 * (`data-slot`, `data-action`) y el host decide qué significa cargar.
 * Los textos se escapan para que un nombre con comillas no rompa los
 * atributos (con nombres normales el HTML es idéntico al de antes).
 *
 * Usage:
 *   import { bankCardHtml, bindBankCards } from '@abdsynths/shared/components/bank/bankCard.js';
 *   grid.innerHTML = cards.map(bankCardHtml).join('');
 *   const unbind = bindBankCards(grid, { onCardClick, onCardDblClick, onAction });
 *
 * @typedef {object} BankCardAction
 * @param {string} BankCardAction.id      identificador servido en `onAction`.
 * @param {string} BankCardAction.label   texto del botón.
 * @param {string} [BankCardAction.kind]  'primary' (default) o 'export'.
 * @param {string} [BankCardAction.title] tooltip del botón.
 * @param {string} [BankCardAction.iconHtml] icono inline del botón.
 *
 * @param {object} card
 * @param {string|number} card.slot       slot mostrado y servido (`#007`).
 * @param {string} [card.catClass]        clase de color (`cat-N`).
 * @param {string} [card.catLabel]        etiqueta de categoría.
 * @param {string} [card.name]            nombre visible.
 * @param {string} [card.title]           tooltip (default: el nombre).
 * @param {string} [card.iconHtml]        icono inline (el host pone el suyo).
 * @param {string[]} [card.badges]        insignias de la fila meta.
 * @param {BankCardAction[]} [card.actions] botones de la tarjeta.
 * @param {boolean} [card.selected]       pinta `wt-selected`.
 * @param {string} [card.extraClass]      clase extra de la tarjeta.
 * @returns {string} HTML de la tarjeta.
 */
export function bankCardHtml (card)
{
  const slot = card.slot ?? 0;
  const slotStr = `#${String(slot).padStart(3, '0')}`;
  const catClass = card.catClass || '';
  const name = card.name ?? '';
  const title = card.title ?? name;
  const badges = Array.isArray(card.badges) ? card.badges : [];
  const actions = Array.isArray(card.actions) ? card.actions : [];
  const cls = ['ndb-card', catClass, card.extraClass || '', card.selected ? 'wt-selected' : '']
    .filter(Boolean)
    .join(' ');

  const actionsHtml = actions.length > 0
    ? `
                <div class="ndb-card-actions">
                  ${actions.map((a) => `
                  <button type="button" class="btn btn-xs ${a.kind === 'export' ? 'btn-export' : 'btn-primary'} btn-card-action" data-slot="${escAttr(String(slot))}" data-action="${escAttr(a.id)}" title="${escAttr(a.title || a.label || '')}">
                    ${a.iconHtml || ''}${escText(a.label || '')}
                  </button>`).join('')}
                </div>`
    : '';

  return `
              <div class="${cls}" data-slot="${escAttr(String(slot))}">
                <div class="ndb-card-icon ${catClass}">
                  ${card.iconHtml || ''}
                </div>
                <div class="ndb-card-info">
                  <div class="ndb-card-top">
                    <span class="ndb-card-slot">${slotStr}</span>
                    <span class="ndb-card-cat ${catClass}">${escText(card.catLabel || '')}</span>
                  </div>
                  <div class="ndb-card-name" title="${escAttr(String(title))}">${escText(String(name))}</div>
                  <div class="ndb-card-meta">
                    ${badges.map((b) => `<span class="ndb-card-badge">${escText(String(b))}</span>`).join('')}
                  </div>
                </div>
                ${actionsHtml}
              </div>`;
}

/**
 * Delegación de eventos para una rejilla de tarjetas. Un solo trío de
 * listeners por render: click (seleccionar), doble-click (servir) y
 * botones `[data-action]` (paran la propagación para no seleccionar dos
 * veces). Devuelve `unbind` para soltarlos.
 *
 * @param {HTMLElement} container rejilla con `.ndb-card` ya pintadas.
 * @param {object} handlers
 * @param {Function} [handlers.onCardClick] recibe `slot` (number).
 * @param {Function} [handlers.onCardDblClick] recibe `slot` (number).
 * @param {Function} [handlers.onAction] recibe `{ slot, action }`.
 * @returns {Function} `unbind()` suelta los tres listeners.
 */
export function bindBankCards (container, handlers = {})
{
  const { onCardClick, onCardDblClick, onAction } = handlers;

  const toSlot = (el) =>
  {
    const card = el && el.closest ? el.closest('.ndb-card') : null;
    if (!card) return null;
    const slot = parseInt(card.getAttribute('data-slot') || '', 10);
    return Number.isNaN(slot) ? null : slot;
  };

  const onClick = (e) =>
  {
    const btn = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
    if (btn)
    {
      e.stopPropagation();
      const slot = toSlot(btn);
      if (slot !== null && onAction) onAction({ slot, action: btn.getAttribute('data-action') || '' });
      return;
    }
    if (onCardClick)
    {
      const slot = toSlot(e.target);
      if (slot !== null) onCardClick(slot);
    }
  };

  const onDblClick = (e) =>
  {
    if (!onCardDblClick) return;
    const slot = toSlot(e.target);
    if (slot !== null) onCardDblClick(slot);
  };

  container.addEventListener('click', onClick);
  container.addEventListener('dblclick', onDblClick);

  return () =>
  {
    container.removeEventListener('click', onClick);
    container.removeEventListener('dblclick', onDblClick);
  };
}

function escText (s)
{
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escAttr (s)
{
  return escText(s).replace(/"/g, '&quot;');
}
