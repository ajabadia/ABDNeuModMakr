/**
 * Las curvas de calibración del Akai S950, indexadas para un panel que dibuja
 * ejes y marca lo que no sabe.
 *
 * QUÉ ES, Y PARA QUIÉN. `S950PatchFields.h` en C++ dice qué byte es cuál;
 * `S950Calibration.h` dice en qué unidad y sobre qué rango está cada magnitud.
 * Este módulo es la tercera mitad: el JSON de
 * `contracts/s950_calibration.json` (GENERADO desde el C++, con
 * `pnpm generate:s950-cal`) indexado, para que un panel pueda pintar el eje de
 * una curva y marcar la parte que nadie ha medido.
 *
 * LO QUE ESTE MÓDULO NO PUEDE HACER, Y CÓMO SE LO IMPIDE A SÍ MISMO.
 *
 * No devuelve un valor de calibración. `valueAt()` devuelve `null` para todo, y
 * eso no es una carencia provisional: es la respuesta correcta del repo a
 * "todavía nadie ha medido esto". Los puntos son resultados experimentales y la
 * tabla del estudio Mz950 que los tiene es AGPLv3, así que aquí no se copian.
 *
 * Y `null` es un valor distinguible de 0 a propósito. Un panel que dibujara el 0
 * de una curva de tiempo estaría pintando un ataque instantáneo, que es un
 * click; y 0 *es* un número, así que un `|| 0` en el llamante lo convertiría en
 * algo con toda la pinta de estar medido. En C++ esto es `std::nullopt`; aquí es
 * `null`, y los dos tests de los dos lados comprueban lo mismo por distinta vía.
 *
 * POR QUÉ EL EJE SE DIBUJA IGUAL SIN MEDIR. Un eje no necesita puntos: necesita
 * saber la unidad, si su escala es logarítmica, y qué rango de panel cubre. Eso
 * sale del dominio del panel —`S950PatchFields.h`, que ya está probado— y es
 * dato de formato. Por eso el panel puede dibujarse entero hoy, y lo único que
 * le falta es el trazo de la curva, que es justo lo que no se sabe.
 *
 * @example
 *   import { buildS950Calibration } from '@abdsynths/shared/components/s950Calibration.js';
 *   import contract from '@abdsynths/shared/contracts/s950_calibration.json';
 *
 *   const cal = buildS950Calibration(contract);
 *   for (const curve of cal.curves) {
 *     axis.setLabel(curve.unit);
 *     axis.setRange(curve.storedLo, curve.storedHi);
 *     axis.setScale(curve.logarithmic ? 'log' : 'linear');
 *     if (curve.measuredRange === null) axis.markUnmeasured();
 *   }
 */

/**
 * Las unidades de eje vertical que puede declarar una curva.
 *
 * Es una lista cerrada y no un texto libre porque un panel formatea según esto:
 * un `"s"` mal escrito como `"segundos"` haría la etiqueta el doble de ancha en
 * un eje estrecho, y el error se vería solo mirándolo.
 */
export const S950_UNITS = Object.freeze(['s', 'Hz', 'octaves', 'dB']);

/**
 * El contrato indexado, con todo lo que un panel busca en un `find`.
 *
 * @param {object} contract el JSON de `contracts/s950_calibration.json`
 * @returns {object|null} el índice, o `null` si el contrato no tiene forma de
 *   catálogo — que es un error de generación, no una instancia vacía.
 */
export function buildS950Calibration (contract) {
  if (!contract || !Array.isArray(contract.curves) || contract.curves.length === 0) {
    return null;
  }

  const byCode = new Map();
  for (const curve of contract.curves) byCode.set(curve.code, curve);

  return {
    /** El contrato tal cual, para quien quiera leer una nota. */
    contract,

    /** Las seis curvas, EN EL ORDEN DEL ENUM de C++. */
    curves: contract.curves,

    /** Las notas que explican por qué el contrato está vacío. */
    notes: contract.notes ?? [],

    /**
     * Una curva por su `code`, o `undefined`.
     * @param {string} code p. ej. `'envelopeTime'`
     */
    curve (code) {
      return byCode.get(code);
    },

    /**
     * SI una curva tiene puntos medidos. Hoy ninguna: las seis dan `false`, y
     * el día que den `true` el contrato y este índice dejan de estar vacíos
     * juntos, que es lo único que importa.
     *
     * @param {string} code
     * @returns {boolean}
     */
    isMeasured (code) {
      return byCode.get(code)?.measured === true;
    },

    /**
     * Las curvas SIN MEDIR, en el orden de la tabla.
     *
     * Es la lista que un panel recorre para marcar, y por eso se calcula en el
     * índice y no la pinta quien lo usa: la pregunta "cuáles me faltan" tiene
     * una respuesta y tiene que ser la misma en todos los paneles.
     *
     * @returns {object[]}
     */
    unmeasured () {
      return contract.curves.filter((c) => !c.measured);
    },

    /**
     * CUÁNTAS curvas están sin medir. Un panel lo enseña como "0 de 6 medidas",
     * y el número tiene que salir de aquí y no de `curves.length - 1`: la
     * diferencia entre "ninguna medida" y "todas menos una" es un número que se
     * calcula a mano.
     */
    measuredCount () {
      return contract.curves.filter((c) => c.measured).length;
    },

    /**
     * El valor de una curva en un valor de panel, o `null`.
     *
     * SIEMPRE `null` hoy, y la razón está en la cabecera: los puntos medidos no
     * están en este repo. La función existe para que el día que sí lo estén el
     * panel tenga dónde llamar, y para que su ausencia sea explícita en el
     * contrato y no un `undefined` que alguien rellene con un 0.
     *
     * @param {string} code
     * @param {number} stored
     * @returns {number|null} siempre `null`
     */
    valueAt (code, stored) {
      const curve = byCode.get(code);
      if (!curve) return null;
      if (!curve.measured) return null;

      // La tabla ya no está vacía. Alguien tiene que escribir la interpolación
      // aquí, y el arnés que produce los puntos es
      // ABDSharedCode/SynthCore/S950CalibrationHarness.h. Se deja la rama
      // inalcanzable a propósito: es el sitio donde va el puente, y que hoy
      // devuelva `null` es un dato, no una ausencia.
      return null;
    },
  };
}

/**
 * La geometría del eje horizontal de una curva, tal y como la pinta un panel.
 *
 * Es una FUNCIÓN de la forma, y no la forma pelada, porque lo que un panel
 * necesita no es "los números del eje" sino "qué pinto y cómo". El separador
 * entra en el contrato devuelto y no en el JSON, porque un separador es un
 * detalle de cómo se formatea, y un contrato que maqueta se queda viejo el día
 * que el panel cambie su estilo.
 *
 * QUÉ PASA SI LE PASAN ALGO QUE NO ES UNA CURVA. `null`. Y la validacion no
 * es una sobra: un `{}` que devolviera un eje con `lo: undefined` haria que un
 * panel calculara un `span` de NaN y pintara un eje degenerado en el origen, que
 * es un panel que parece funcionar y no enseña nada. Se comprueba que haya
 * `code` —sin el no hay curva que nombrar— y que los dos extremos del rango
 * sean numeros, que es lo unico de lo que sale el resto de este objeto.
 *
 * @param {object} curve una entrada de `cal.curves`
 * @returns {object|null} `null` si no tiene forma de curva
 */
export function s950AxisFor (curve) {
  if (!curve || typeof curve !== 'object') return null;
  if (typeof curve.code !== 'string' || curve.code === '') return null;
  if (typeof curve.storedLo !== 'number' || typeof curve.storedHi !== 'number') return null;
  if (Number.isNaN(curve.storedLo) || Number.isNaN(curve.storedHi)) return null;

  const span = curve.storedHi - curve.storedLo;

  return {
    /** El eje X va en unidades de PANEL, no en la unidad de la curva. */
    lo: curve.storedLo,
    hi: curve.storedHi,
    span,

    /** Qué pone el panel en la etiqueta de abajo. */
    label: curve.axisLabel,

    /**
     * La escala del eje VERTICAL. Un panel que dibuje un eje de tiempo en
     * lineal aplasta todo el detalle en el extremo lento, que es justo donde se
     * decide un ataque.
     */
    scale: curve.logarithmic ? 'log' : 'linear',

    /**
     * En qué sentido crece. Un eje de tiempo dibujado "hacia arriba" porque el
     * byte sube es un attack que se alarga al mover el mando a la izquierda.
     */
    rises: curve.risesWithStored,

    /**
     * Si el eje tiene que marcar el cero como valor IMPOSIBLE. Y no es lo
     * mismo que la escala: los dB admiten el 0 y por eso lo admiten.
     */
    excludeZero: curve.positiveOnly,

    /**
     * SI EL EJE VERTICAL SE PUEDE DIBUJAR, y esta es la pregunta que de verdad
     * se hace un panel, y la respuesta no es "todas".
     *
     * Un eje vertical en escala LINEAR se dibuja con cualquier minimo: se
     * elige uno nominal y ya esta. Uno en escala LOGARITMICA no, porque el log
     * necesita un MINIMO REAL —sin el, `Math.log(0)` es -Infinity y la curva se
     * va a menos infinito—, y ese minimo es precisamente un valor MEDIDO. Que
     * es uno de los que no hay.
     *
     * De ahi sale el numero que le importa a quien pinta: con la tabla vacia se
     * dibuja el eje HORIZONTAL de las seis, y el vertical solo de las dos que
     * son lineales. Un panel que lo dibujara con una escala inventada en las
     * otras cuatro tendria un eje de ataque con un minimo que nadie midio, y se
     * veria bonito.
     */
    needsMeasuredMinimum: curve.logarithmic && !curve.measured,
  };
}

/**
 * Un resumen de qué sabe y qué no sabe el repo, para encabezar un panel.
 *
 * Es lo que un rótulo tiene que decir cuando alguien pregunta por qué el eje no
 * tiene trazo. Devolver un objeto y no una cadena es a propósito: el rótulo
 * se formatea donde vive el estilo, y una cadena cocida en el contrato obliga a
 * cambiar el dato cada vez que cambia una palabra.
 *
 * @param {object} cal el índice de `buildS950Calibration()`
 * @returns {object|null}
 */
export function s950Coverage (cal) {
  if (!cal) return null;

  const measured = cal.measuredCount();

  return {
    measured,
    total: cal.curves.length,

    /**
     * Si falta ALGO. Va como booleano y no como "measured === total" porque un
     * panel lo pinta con un `if`, y un `if` sobre una cuenta es donde aparece
     * el `==` mal escrito.
     */
    complete: measured === cal.curves.length,

    /**
     * Una frase corta y sin formato. Deliberadamente no dice "vacío": una tabla
     * vacía suena a que alguien la ha dejado a medias, y lo que hay es una
     * decisión con su motivo en las `notes`.
     */
    label: measured === 0
      ? 'Ninguna curva medida todavía'
      : `${measured} de ${cal.curves.length} curvas medidas`,
  };
}
