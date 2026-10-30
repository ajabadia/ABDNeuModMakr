/**
 * bankChips — fila de pastillas de filtro del catálogo NeuronDB
 * (paquete compartido).
 * ======================================================================
 *
 * Una sola forma de pintar las pastillas de categoría en todos los
 * hosts (las que el synth ya tenía y NeuModMakr va a estrenar): la
 * fila no filtra nada, solo sirve el `id` elegido y el host decide
 * qué significa (igual que las tarjetas: servir, no cargar).
 *
 * Usage:
 *   toolbarRow.innerHTML = bankChipsHtml(items, activeId);
 *   const unbind = bindBankChips(toolbarRow, (id) => render(id));
 *
 * @typedef {object} BankChipItem
 * @param {string} BankChipItem.id        identificador servido en `onPick`.
 * @param {string} BankChipItem.label     texto visible (p. ej. `0: General`).
 * @param {number} [BankChipItem.count]   conteo entre paréntesis (se omite si falta).
 * @param {string} [BankChipItem.catClass] clase de color (`cat-N`, `cat-neutral`...). * @param {string} [BankChipItem.title] tooltip (default: el label).
 * @param {string} [BankChipItem.prefixHtml] HTML de confianza del host
 *   delante de la etiqueta (p. ej. un `N:` en negrita con color de set).
 *   Úsalo solo con fragmentos propios, nunca con texto de usuario.
 *
 * @param {BankChipItem[]} items
 * @param {string} [activeId] id con la clase `active`.
 * @returns {string} HTML de las pastillas.
 */
export function bankChipsHtml (items, activeId)
{
  const list = Array.isArray(items) ? items : [];
  return list.map((item) =>
  {
    const id = item && item.id != null ? String(item.id) : '';
    const label = item && item.label != null ? String(item.label) : '';
    const count = item && typeof item.count === 'number' ? ` (${item.count})` : '';
    const cls = ['ndb-chip', 'ndb-chip-sm', (item && item.catClass) || '', id === activeId ? 'active' : '']
      .filter(Boolean)
      .join(' ');
    const prefix = (item && item.prefixHtml) || '';
    return `<button type="button" class="${cls}" data-chip="${escAttr(id)}" title="${escAttr((item && item.title) || label)}">${prefix}${escText(label)}${count}</button>`;
  }).join('');
}

/**
 * Delegación de clicks para una fila de pastillas: un solo listener
 * por render. Devuelve `unbind()` para soltarlo.
 *
 * @param {HTMLElement} container fila con pastillas `[data-chip]` ya pintadas.
 * @param {Function} onPick recibe el `id` (string) de la pastilla.
 * @returns {Function} `unbind()` suelta el listener.
 */
export function bindBankChips (container, onPick)
{
  const onClick = (e) =>
  {
    const btn = e.target && e.target.closest ? e.target.closest('[data-chip]') : null;
    if (!btn || !container.contains(btn)) return;
    if (onPick) onPick(btn.getAttribute('data-chip') || '');
  };

  container.addEventListener('click', onClick);

  return () =>
  {
    container.removeEventListener('click', onClick);
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
