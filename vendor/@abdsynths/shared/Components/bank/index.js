/**
 * bank — navegador de bancos NeuronDB (carcasa + tarjetas + categorías
 * + pastillas).
 *
 * Presentacional a propósito: sirve selecciones y acciones por
 * callbacks, nunca decide qué significa cargar. Cada host (MODELmaker,
 * synth) adapta sus datos y su montaje.
 */

export { createBankShell } from './bankShell.js';
export { bankCardHtml, bindBankCards } from './bankCard.js';
export { bankChipsHtml, bindBankChips } from './bankChips.js';
export { classifyBankCategory } from './bankCategories.js';
