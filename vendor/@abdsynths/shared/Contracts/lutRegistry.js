/**
 * @abdsynths/contracts — Registro de tablas LUT de firmware
 * =========================================================
 * Resuelve un `lutId` (el que declaran los parámetros con `curve: "Lut"`) a una tabla
 * de valores físicos indexada por el valor normalizado [0..1].
 *
 * Las tablas viven en `lut_tables.json`, se generan desde la ROM del instrumento con
 * `generators/ms2000_lfo_luts.mjs` y son la verdad del hardware: sustituyen a cualquier
 * fórmula analítica, que en el MS2000 se desvía hasta un ~55 % de la tabla real.
 *
 * Índice: la entrada `i` de una tabla de `n` entradas corresponde al valor normalizado
 * `i / (n - 1)`, de modo que un knob MIDI de 128 pasos (`0..127`) cae exactamente sobre
 * las 128 entradas (`raw / 127 * (n - 1) = raw`). Entre entradas se interpola linealmente.
 */

import lutTablesContract from './lut_tables.json';

/** Error lanzado cuando un parámetro declara un `lutId` que no existe en el contrato. */
export class LutNotFoundError extends Error {
  constructor(lutId) {
    super(
      `No existe la tabla LUT '${lutId}' en lut_tables.json. ` +
        `Regenera las tablas con Contracts/generators/ms2000_lfo_luts.mjs.`
    );
    this.name = 'LutNotFoundError';
    this.lutId = lutId;
  }
}

/**
 * Convierte los enteros crudos de una tabla a su unidad física.
 * @param {number[]} increments
 * @param {{ kind: string, qBits?: number, sampleRateHz?: number } | undefined} scaling
 * @returns {number[]}
 */
function toPhysicalValues(increments, scaling) {
  if (!scaling) return increments.slice();

  switch (scaling.kind) {
    case 'phase_increment': {
      const { qBits, sampleRateHz } = scaling;
      if (!Number.isFinite(qBits) || !Number.isFinite(sampleRateHz)) {
        throw new Error('scaling phase_increment requiere qBits y sampleRateHz');
      }
      const scale = sampleRateHz / Math.pow(2, qBits);
      return increments.map((increment) => increment * scale);
    }
    default:
      throw new Error(`Tipo de escala LUT no soportado: '${scaling.kind}'`);
  }
}

/** Construye y valida el registro en tiempo de carga (falla pronto si el contrato es inválido). */
function buildRegistry(contract) {
  const registry = new Map();
  const luts = contract?.luts ?? {};

  for (const [lutId, definition] of Object.entries(luts)) {
    const increments = definition?.increments;
    if (!Array.isArray(increments) || increments.length < 2) {
      throw new Error(`La tabla LUT '${lutId}' necesita al menos 2 entradas`);
    }
    if (definition.length !== undefined && definition.length !== increments.length) {
      throw new Error(
        `La tabla LUT '${lutId}' declara length ${definition.length} pero tiene ${increments.length} entradas`
      );
    }

    const values = toPhysicalValues(increments, definition.scaling);
    for (let i = 1; i < values.length; i++) {
      if (values[i] < values[i - 1]) {
        throw new Error(
          `La tabla LUT '${lutId}' no es monótona creciente: índice ${i} (${values[i]} < ${values[i - 1]})`
        );
      }
    }

    registry.set(lutId, Object.freeze({
      id: lutId,
      unit: definition.unit ?? null,
      length: values.length,
      values: Object.freeze(values),
      provenance: definition.provenance ?? null,
    }));
  }

  return registry;
}

const REGISTRY = buildRegistry(lutTablesContract);

/** @returns {string[]} Identificadores de todas las tablas disponibles. */
export function listLutIds() {
  return [...REGISTRY.keys()];
}

/**
 * @param {string} lutId
 * @returns {boolean}
 */
export function hasLut(lutId) {
  return typeof lutId === 'string' && REGISTRY.has(lutId);
}

/**
 * Devuelve la entrada completa (unidad, valores físicos y procedencia).
 * @param {string} lutId
 */
export function getLut(lutId) {
  const entry = REGISTRY.get(lutId);
  if (!entry) throw new LutNotFoundError(lutId);
  return entry;
}

/**
 * Valores físicos de la tabla (congelados; no mutar).
 * @param {string} lutId
 * @returns {readonly number[]}
 */
export function getLutValues(lutId) {
  return getLut(lutId).values;
}

/**
 * Valor físico para un normalizado [0..1], con interpolación lineal entre entradas.
 * @param {string} lutId
 * @param {number} t
 * @returns {number}
 */
export function lutValueAt(lutId, t) {
  const { values } = getLut(lutId);
  const clamped = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0;
  const last = values.length - 1;
  const position = clamped * last;
  const index = Math.floor(position);
  if (index >= last) return values[last];
  const fraction = position - index;
  return values[index] + fraction * (values[index + 1] - values[index]);
}

/**
 * Normalizado [0..1] que corresponde a un valor físico (inversa de `lutValueAt`).
 * En las mesetas de la tabla (valores repetidos, p. ej. el suelo de cuantización del
 * MS2000) devuelve el inicio de la meseta: la inversa es necesariamente many-to-one.
 * @param {string} lutId
 * @param {number} value
 * @returns {number}
 */
export function lutNormalizedForValue(lutId, value) {
  const { values } = getLut(lutId);
  if (!Number.isFinite(value)) return 0;
  const last = values.length - 1;
  if (value <= values[0]) return 0;
  if (value >= values[last]) return 1;

  // Primer índice con values[i] >= value.
  let lo = 0;
  let hi = last;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] < value) lo = mid + 1;
    else hi = mid;
  }

  const span = values[lo] - values[lo - 1];
  const fraction = span > 0 ? (value - values[lo - 1]) / span : 0;
  return (lo - 1 + fraction) / last;
}
