/**
 * El catálogo de patches del Akai S950, indexado para un panel.
 *
 * QUÉ ES. Un panel que enseña los nombres y los rangos de sus controles tiene
 * que sacarlos de ALGUNA sitio. Si los escribe a mano, hay dos copias: la del
 * motor (`ABDSharedCode/SynthCore/S950PatchFields.h`, que gobierna el importador)
 * y la del panel. Las copias se separan sin ruido —alguien añade un campo al
 * motor, el panel sigue enseñando 38, y el desfase aparece el día que un patch
 * importado suena raro—.
 *
 * Este módulo cierra esa distancia: el JSON es GENERADO desde el C++ con
 * `pnpm generate:s950-contract`, y este fichero solo lo indexa. No inventa
 * nombres ni rangos, y si el contrato cambia el panel cambia con él.
 *
 * LO QUE NO HACE, Y POR QUÉ. No sabe nada de la máquina: no lee discos, no
 * traduce un byte a un valor, no recorta. Eso es de `S950Disk.h`, en C++. Aquí
 * vive lo que un panel necesita —el nombre, el rango, el grupo, a qué página
 * va— y ni una regla más. Un panel que quisiera recortar por su cuenta
 * acabaría recortando por su cuenta, que es el problema de partida.
 *
 * EL ORDEN ES PARTE DEL CONTRATO. Los `fields` vienen en el orden en que se
 * recorre el keygroup, que es como un panel los va a buscar por página. El
 * `code` es la clave estable con la que un preset los referencia. Ninguno de
 * los dos se puede reordenar sin romper algo.
 *
 * @example
 *   import { buildS950Catalogue } from '@abdsynths/shared/components/s950PatchFields.js';
 *   import contract from '@abdsynths/shared/contracts/s950_patch_fields.json';
 *
 *   const cat = buildS950Catalogue(contract);
 *   for (const field of cat.page('FILTER')) {
 *     slider.setRange(field.lo, field.hi);
 *     slider.setLabel(field.name);
 *   }
 */

/** Las cuatro codificaciones de byte que puede tener un campo. */
export const S950_ENCODINGS = Object.freeze({
  UNSIGNED: 'Unsigned',
  SIGNED: 'Signed',
  PORT: 'Port',
  BIT: 'Bit',
});

/** Las pestañas del panel, en el orden en que aparecen. */
export const S950_GROUPS = Object.freeze([
  'ENVELOPES', 'FILTER', 'LFO', 'VELOCITY', 'TUNING', 'KEYS',
]);

/**
 * El catálogo indexado, con todo lo que un panel busca en un `find`.
 *
 * @param {object} contract el JSON de `contracts/s950_patch_fields.json`
 * @returns {object} el índice, o `null` si el contrato no tiene forma de
 *   catálogo — que es un error de generación, no una instancia vacía.
 */
export function buildS950Catalogue (contract) {
  if (!contract || !Array.isArray(contract.fields) || contract.fields.length === 0) {
    return null;
  }

  const byCode = new Map();
  for (const field of contract.fields) byCode.set(field.code, field);

  const byByte = new Map();
  for (const field of contract.fields) {
    if (!byByte.has(field.byteOffset)) byByte.set(field.byteOffset, []);
    byByte.get(field.byteOffset).push(field);
  }

  const trimById = new Map();
  for (const trim of contract.performTrims ?? []) trimById.set(trim.code, trim);

  const portByValue = new Map();
  for (const port of contract.outputPorts ?? []) portByValue.set(port.panelValue, port);
  const portByCode = new Map();
  for (const port of contract.outputPorts ?? []) portByCode.set(port.code, port);

  return {
    /** El contrato tal cual, para quien quiera leer una nota. */
    contract,

    /** Los 38 campos, en el orden del keygroup. */
    fields: contract.fields,

    /** La geometria del registro: tamanos, zonas y mascaras del byte de flags. */
    geometry: contract.geometry ?? {},

    /** Los trims de Perform, indexados por su codigo. */
    trims: contract.performTrims ?? [],

    /** Las once salidas, indexadas por valor de panel y por codigo. */
    ports: contract.outputPorts ?? [],

    /**
     * Un campo por su `code`, o `undefined`.
     * @param {string} code p. ej. `'softFine'`
     */
    field (code) {
      return byCode.get(code);
    },

    /**
     * Un flag por su `code`, o `undefined`. Es `field()` con el tipo
     * comprobado, porque un flag y un campo no se repiten aunque ambos
     * acepten 0 y 1: uno es un bit de un byte compartido y el otro un número.
     */
    flag (code) {
      const f = byCode.get(code);
      return f?.encoding === S950_ENCODINGS.BIT ? f : undefined;
    },

    /**
     * Todos los campos que viven en el MISMO byte, en el orden de la tabla.
     *
     * Es la pregunta que hay que hacer antes de escribir en un byte: si hay
     * más de uno, hay que hacer lectura-modificación-escritura. Salir de
     * cualquiera de los dos es perder el otro, y el bit reservado 0x02 con él.
     */
    sharingByte (byteOffset) {
      return byByte.get(byteOffset) ?? [];
    },

    /**
     * Los campos de una pestaña del panel, en el orden de la tabla.
     *
     * @param {string} groupName una de `S950_GROUPS`
     * @returns {object[]} los campos de esa pestaña
     */
    page (groupName) {
      return contract.fields.filter((f) => f.group === groupName);
    },

    /**
     * El trim de Perform que mueve un campo, o `undefined`.
     * @param {string} fieldCode p. ej. `'softFilter'`
     */
    trimFor (fieldCode) {
      const f = byCode.get(fieldCode);
      return f?.trimId ? trimById.get(f.trimId) : undefined;
    },

    /** Un trim por su `code`, o `undefined`. */
    trim (code) {
      return trimById.get(code);
    },

    /** La salida de un valor de panel, o `undefined`. */
    port (panelValue) {
      return portByValue.get(panelValue);
    },

    /** La salida por su codigo estable (`'all'`, `'mono3'`…), o `undefined`. */
    portByCode (code) {
      return portByCode.get(code);
    },

    /**
     * El valor efectivo de un campo con un trim puesto: `valor + offset`,
     * recortado al rango del campo.
     *
     * Va AQUÍ y no en el panel porque es la regla del motor, y porque el
     * recorte importa: un offset de +99 sobre un campo que acaba en 50 no es un
     * mando que llega lejos, es un mando cuyo valor se sale. Un panel que
     * sumara sin recortar enseñaría un 149 donde el motor suena con 50.
     *
     * @param {string} code   el campo
     * @param {number} stored el valor guardado en el keygroup
     * @param {number} offset el trim, o 0 si no hay ninguno
     */
    effectiveValue (code, stored, offset = 0) {
      const f = byCode.get(code);
      if (!f) return undefined;
      const sum = stored + (offset ?? 0);
      return Math.max(f.lo, Math.min(f.hi, sum));
    },
  };
}

/**
 * El nombre de un campo, ya sea el de la máquina o el que se pinta.
 *
 * La versión cruda es `ALL`, `MONO1`. La formateada es `All`, `Mono 1`. El
 * contrato guarda la cruda a propósito —un contrato que maqueta se queda viejo
 * el día que el panel cambie su estilo, y entonces el desfase parece del panel
 * cuando es del dato—, así que la tipografía va aquí, en el sitio que la elige.
 *
 * @param {string} raw por ejemplo `'MONO1'`
 * @returns {string} por ejemplo `'Mono 1'`
 */
export function formatS950Name (raw) {
  const mono = /^MONO(\d+)$/.exec(raw ?? '');
  if (mono) return `Mono ${Number(mono[1])}`;

  const s = String(raw ?? '');
  if (s === 'ALL') return 'All';

  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Un campo es bipolar si su rango cruza el cero. Sirve para decidir si un mando
 * se pinta centrado o no, y es una DERIVADA del rango, no una columna más: si
 * el rango cambia, esto cambia con él y no puede quedarse viejo.
 */
export function isS950Bipolar (field) {
  return !!field && field.encoding !== S950_ENCODINGS.BIT && field.lo < 0 && field.hi > 0;
}
