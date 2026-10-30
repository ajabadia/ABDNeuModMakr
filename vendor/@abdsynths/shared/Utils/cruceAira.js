/**
 * LA MEDICION DEL CRUCE AIRA, COMO DATO Y NO COMO TEXTO.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTO ESTA EN `utils/` Y NO EN EL SCRIPT NI EN EL TEST
 *
 * El "7 de 31" estaba escrito en tres sitios a la vez —el `statusReason` del
 * contrato, la lista `CUARENTENAS` del helper y un `toEqual` con los siete
 * nombres— y no habia nada que dijera de donde salia. Eso es una cifra que se
 * queda vieja hablando: el test mide el cruce en vivo, asi que cuando el cruce
 * cambia el test se pone rojo, pero el TEXTO del motivo puede seguir diciendo
 * "solo 7" mientras el test ya dice ocho, porque los dos son texto libre que
 * nadie compara con la medida.
 *
 * Aqui la cifra se produce una vez, en una funcion pura, y el texto sale de
 * ella. El script que la imprime y el test que la comprueban leen la misma
 * fuente, asi que no pueden discrepar: si la medida cambia, los tres se mueven
 * o se ponen rojos.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE EL CRITERIO ES "31 DE 31" Y NO "CASAN CASI TODOS"
 *
 * La pregunta no es si coinciden mucho. La pregunta es si son el mismo
 * catalogo. Una libreria con 31 bloques que casa 30 con el AIRA sigue siendo
 * una libreria con un bloque que el AIRA no tiene, y ese bloque sale en el
 * cajon del laboratorio como si fuera hardware. Un 30 de 31 no es "casi bien":
 * es un aparato mas que existe. Por eso la puerta es exacta, y por eso una
 * medida de 24 de 24 es diagnostico y no solo ruido.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LO QUE NO HACE
 *
 * No levanta la cuarentena ni la pone. Decide cual de las dos listas describe
 * el hardware, y eso no se puede medir: depende de cual de los dos ficheros
 * tenga el error, y el error es humano. Lo que hace es poner el numero delante
 * de quien tiene que decidir, y ponerlo en un sitio del que no se puede
 * desincronizar solo.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));

/** El directorio de contratos de este paquete. */
export const CONTRATOS = path.resolve(aqui, '..', 'contracts');

/** El fichero que lleva el catalogo de la libreria, con 31 bloques. */
export const LIBRERIA = 'roland_aira_submodules.json';

/** El fichero que lleva los 31 modulos del AIRA Modular. */
export const HARDWARE = 'roland_aira_patch_spec.json';

const leer = (directorio, nombre) =>
  JSON.parse(readFileSync(path.join(directorio, nombre), 'utf8'));

/**
 * Mide el cruce entre los dos catalogos.
 *
 * El cruce es por `id`, que es el unico campo que los dos lados comparten: el
 * motor no lleva `typeIdHex`, asi que no hay campo mejor. Y se quita el
 * `empty`: el patch_spec declara 32 entradas y la primera es el slot vacio, no
 * un modulo. Contar 32 contra 31 daria un desajuste de uno que no existe, y un
 * numero que miente es peor que no dar ninguno.
 *
 * @param {string} [directorio] donde estan los contratos; el de este paquete
 * @returns {{
 *   bloques: number, modulos: number,
 *   comunes: string[], soloLibreria: string[], soloHardware: string[],
 *   completo: boolean, desajuste: number
 * }}
 */
export function medirCruceAira(directorio = CONTRATOS) {
  const libreria = leer(directorio, LIBRERIA);
  const hardware = leer(directorio, HARDWARE);

  const bloques = libreria.functions.map((f) => f.id);
  const modulos = hardware.submodules.filter((s) => s.id !== 'empty').map((s) => s.id);

  const enLibreria = new Set(bloques);
  const enHardware = new Set(modulos);

  const comunes = bloques.filter((id) => enHardware.has(id)).sort();
  const soloLibreria = [...enLibreria].filter((id) => !enHardware.has(id)).sort();
  const soloHardware = modulos.filter((id) => !enLibreria.has(id)).sort();

  return {
    bloques: bloques.length,
    modulos: modulos.length,
    comunes,
    soloLibreria,
    soloHardware,
    // Exacto, y no "casi": ver la nota de arriba sobre el 30 de 31.
    completo: bloques.length === modulos.length && comunes.length === bloques.length,
    desajuste: soloLibreria.length,
  };
}

/**
 * El `statusReason` que la medida obliga a escribir.
 *
 * Una sola frase con la cuenta exacta, y sin adjectives. "Desactualizado" o
 * "sospechoso" no se pueden comprobar; "solo 7 de 31 casan por nombre" se puede
 * volver a medir y sale igual o sale distinta. Y el cierre dice DONDE se mide,
 * que es lo que permite que alguien lo vuelva a hacer sin saber de donde salio
 * el numero la primera vez.
 *
 * @param {ReturnType<typeof medirCruceAira>} medida
 * @returns {string}
 */
export function motivoDeLaCuarentena(medida) {
  return `De ${medida.bloques} bloques, solo ${medida.comunes.length} casan por nombre `
    + `con los ${medida.modulos} modulos del patch_spec; los otros ${medida.desajuste} de cada `
    + 'lado no coinciden. Medido por scripts/medir-cruce-aira.mjs';
}