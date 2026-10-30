/**
 * LA REGLA DE CUARENTENA, EN UN SOLO SITIO PARA JS.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUE ES ESTO Y POR QUE ESTA FUERA DE `tests/`.
 *
 * Antes de este fichero la regla vivia en tres sitios de JavaScript que no se
 * conocian entre si: la lista `CUARENTENAS` de `tests/helpers/validateSchema.js`,
 * los tests de `schemaValidator.test.js` y —lo que mas dolia— nada en el
 * preflight. Ese ultimo "nada" es el agujero real: `check-generated-contracts.mjs`
 * es la puerta que BLOQUEA, vigila el catalogo entero, y era incapaz de decir
 * que un contrato estaba retenido. No porque no quisiera, sino porque la regla
 * no estaba escrita en ningun sitio al que el preflight pudiera mirar.
 *
 * Y lo esta aqui, en `utils/`, y no en `tests/helpers/`, por una razon concreta:
 * un modulo de tests es codigo de test. El preflight es una puerta de la rama,
 * y una puerta no puede importar de la suite que vigila: en cuanto hace falta
 * para funcionar, se ejecuta en un sitio donde la suite no se ejecuta, y un
 * fichero que solo existe para el test es un fichero que el dia que hace falta
 * no esta.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUE DICE, Y POR QUE DICE JUSTO ESTO.
 *
 * Solo `POLITICA.valorEstado` en `POLITICA.campoEstado` retiene. Cualquier otra
 * cosa no retiene, y eso parece lo contrario de lo prudente.
 *
 * Es lo contrario. Retener es lo DESTRUCTIVO: esconde hardware del cajon del
 * laboratorio sin que nada lo diga. Un `status` mal escrito tiene que verse, no
 * desaparecer. Si manana se declara un estado nuevo, lo que tiene que pasar es
 * que este modulo lo ignore y que el aviso lo ponga quien valida, que es donde si
 * hay donde avisar. Por eso el enum del esquema tiene un solo valor, y por eso
 * `auditar()` se queja de un estado desconocido en vez de retenerlo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Y LA PARTE QUE NO SE PUEDE COMPARTIR.
 *
 * La mitad de C++ de esta regla —`HardwareContractQuarantine`, en el
 * laboratorio— declara los mismos dos nombres. No se puede compartir el
 * fichero: uno es C++ y el otro es JS, y un preflight no puede llamar a un
 * metodo estatico de C++ ni al reves.
 *
 * Lo que se puede es atarlos por el FICHERO DEL DATO, que es lo que los dos
 * leen. `estadosDeclaradosPorElEsquema()` y `comprobarContraElEsquema()` hacen
 * esa mitad desde aqui, y el test de C++ `El literal de C++ es el que declara el
 * enum del esquema` la hace desde alla. Los dos comparan contra el MISMO
 * fichero: el enum de `contracts/hardware_profile.schema.json`.
 *
 * El fallo que ese par de comprobaciones tapa es malo y silencioso. Alguien
 * renombra el enum del esquema y actualiza los contratos. JS sigue
 * funcionando, porque JS mira el dato y el dato es el nuevo. El literal de C++
 * se queda en el viejo, ya no casa con nada, y la cuarentena de C++ deja de
 * funcionar PARA SIEMPRE: el registro carga el contrato dudoso, el adapter lo
 * carga, y no hay ningun test rojo en ningun lado. Lo unico que se ve es un
 * Aparato que no existe apareciendo en el cajon como si fuera real.
 */

/**
 * Los nombres de la regla.
 *
 * Congelado y en un solo objeto, y no tres `const` sueltas, por una razon
 * concreta: si alguien recorre las claves para compararlas con el esquema —que
 * es lo que hacen los dos tests de pin— un objeto con el nombre del campo y el
 * nombre del valor juntos se compara entero. Con tres sueltas, comparar "la
 * regla" obliga a acordarse de cuales son.
 */
export const POLITICA = Object.freeze({
  /** El campo del contrato que lleva la marca. */
  campoEstado: 'status',
  /** El unico valor de `campoEstado` que retiene. */
  valorEstado: 'quarantined',
  /** El campo del contrato que lleva el motivo. */
  campoMotivo: 'statusReason',
  /** Lo que se dice de un retenido que no dice por que. */
  motivoPorDefecto: 'sin statusReason en el contrato',
});

/**
 * TODAS las reglas de cuarentena que este repositorio conoce, en orden.
 *
 * `POLITICA` era un objeto suelto y ahora hay una lista, porque el esquema puede
 * declarar mas de una regla y esta mitad de JS tiene que saber de todas. El
 * generador compara la lista entera, no solo la primera: si el mapa declara una
 * segunda regla y aqui no, se queja en vez de generar una cabecera que C++ no
 * tiene con quien comparar.
 *
 * `POLITICA` sigue siendo la PRIMERA, porque los usos de este repo —`veredicto`,
 * `auditar`, el cajon— atienden una regla, y un retenido por la segunda no lo mira
 * nadie todavia. Que se mire es una decision que se escribe, no que pase sola.
 */
export const POLITICAS = Object.freeze([
  Object.freeze({
    /** El campo del contrato que lleva la marca. */
    campoEstado: 'status',
    /** El unico valor de `campoEstado` que retiene. */
    valorEstado: 'quarantined',
    /** El campo del contrato que lleva el motivo. */
    campoMotivo: 'statusReason',
  }),
]);

/**
 * Dice si un contrato esta retenido, y por que.
 *
 * Un `contrato` que no es un objeto no retiene. Un JSON ilegible tampoco llega
 * aqui: quien lo lee es `auditar()`, y ahi se cuenta como lo que es —un
 * fichero que no se ha podido mirar— y no como un contrato sano.
 *
 * @param {object} contrato
 * @returns {{retenido: boolean, motivo: string|null, faltaMotivo: boolean}}
 */
export function veredicto(contrato) {
  if (contrato === null || typeof contrato !== 'object' || Array.isArray(contrato))
    return { retenido: false, motivo: null, faltaMotivo: false };

  if (contrato[POLITICA.campoEstado] !== POLITICA.valorEstado)
    return { retenido: false, motivo: null, faltaMotivo: false };

  const bruto = contrato[POLITICA.campoMotivo];
  const esTexto = typeof bruto === 'string';

  // Retenido SIN motivo es un retenido sin explicacion, que es justo el fallo
  // que la marca se invento para tapar. Se devuelve `faltaMotivo` aparte del
  // motivo por defecto para que quien audita pueda DIROLO en vez de repetir el
  // texto que el laboratorio va a inventar.
  //
  // Un `statusReason` que existe pero no es texto NO cuenta aqui: lo cuenta
  // `auditar()` como lo que es —un tipo equivocado— y no como un motivo
  // ausente. Son dos fallos distintos y arreglarlos es editar cosas distintas, y
  // un mensaje que los mezcla obliga a abrir el fichero para saber cual es cual.
  const vacio = bruto === undefined || (esTexto && bruto.trim() === '');

  return {
    retenido: true,
    motivo: esTexto && bruto.trim() !== '' ? bruto.trim() : null,
    faltaMotivo: vacio,
  };
}

/** Solo el si o el no. Para quien no necesita el motivo y no debe inventarse uno. */
export function esRetenido(contrato) {
  return veredicto(contrato).retenido;
}

/** El motivo de un retenido, o `null` si no esta retenido o no dice por que. */
export function motivoDe(contrato) {
  return veredicto(contrato).motivo;
}

/**
 * El motivo TAL COMO se muestra, con el texto por defecto puesto cuando falta.
 *
 * Es lo que necesita la interfaz: un retenido sin motivo tiene que aparecer con
 * ALGUN texto, porque un hueco en la lista de retenidos vuelve a ser el problema
 * original. Pero quien muestra esto no puede distinguir "no dice por que" de
 * "dice esto", asi que no se use para decidir nada: para eso esta
 * `veredicto().faltaMotivo`.
 */
export function motivoParaMostrar(contrato) {
  const v = veredicto(contrato);
  return v.retenido ? (v.motivo ?? POLITICA.motivoPorDefecto) : null;
}

/**
 * Los problemas que tiene un contrato para con la regla. `[]` si ninguno.
 *
 * Tres, y los tres son fallos de verdad, no advertencias de estilo:
 *
 *   - un estado que la regla no conoce: nadie lo va a retener, en ningun
 *     lenguaje, asi que quien lo escribio creyo que estaba haciendo algo.
 *   - retenido sin motivo: el laboratorio va a inventar un texto y el cajon va
 *     a mostrar un sitio sin explicar nada.
 *   - `statusReason` con un tipo que no es texto: la regla no lo retiene como
 *     motivo y el esquema tampoco lo deberia dejar pasar.
 *
 * @param {string} nombre  el nombre de fichero, para que el mensaje lo nombre.
 * @param {object} contrato
 * @returns {string[]}
 */
export function auditar(nombre, contrato) {
  const problemas = [];

  if (contrato === null || typeof contrato !== 'object' || Array.isArray(contrato))
    return [`${nombre}: no es un objeto JSON`];

  const estado = contrato[POLITICA.campoEstado];

  if (estado !== undefined && estado !== POLITICA.valorEstado) {
    problemas.push(
      `${nombre}: ${POLITICA.campoEstado} es "${estado}" y la regla solo conoce `
      + `"${POLITICA.valorEstado}". Nadie lo va a retener, en ningun lenguaje, `
      + 'asi que o se cambia el enum del esquema o se deja de poner el campo.');
  }

  const v = veredicto(contrato);

  if (v.retenido && v.faltaMotivo) {
    problemas.push(
      `${nombre}: retenido por cuarentena y sin ${POLITICA.campoMotivo}. El `
      + 'laboratorio va a inventar un texto, y un retenido sin '
      + 'explicacion es justo lo que la marca deberia evitar.');
  }

  const bruto = contrato[POLITICA.campoMotivo];

  if (bruto !== undefined && typeof bruto !== 'string') {
    problemas.push(
      `${nombre}: ${POLITICA.campoMotivo} es de tipo ${typeof bruto} y la regla `
      + 'solo sabe leer texto. El texto que apareceria en el cajon seria '
      + `"${POLITICA.motivoPorDefecto}", que no es lo que el contrato dice.`);
  }

  return problemas;
}

/**
 * Los valores que el enum del esquema declara para el campo del estado.
 *
 * Se lee el ESQUEMA, no los contratos, a proposito. El enum es lo que declara
 * que estados existen; los contratos son instancias de ese enum. Preguntar a los
 * contratos es como una puerta que vigila la puerta.
 *
 * @param {object} esquema
 * @returns {string[]|null} los valores, o `null` si el esquema no lo declara.
 */
export function estadosDeclaradosPorElEsquema(esquema) {
  const campo = esquema?.properties?.[POLITICA.campoEstado];

  if (campo === undefined || !Array.isArray(campo.enum))
    return null;

  return campo.enum.filter((v) => typeof v === 'string');
}

/**
 * Si a un esquema le APLICA la regla de cuarentena.
 *
 * Y la respuesta es "depende del esquema", que es la parte que hace este modulo
 * mas pequeno de lo que parece a primera vista.
 *
 * De los seis esquemas de `contracts/`, solo uno —el de perfiles de hardware—
 * declara `status`. Los otros cinco gobiernan cosas que no son un Aparato: los
 * efectos de FX, las matrices de modulacion, los campos del patch del S950. Un
 * esquema de esos NO tiene que declarar `status`, y exigirselo seria un error de
 * este codigo, no un hallazgo: pondria en rojo una rama que esta bien, que es
 * la forma mas rapida de que un preflight deje de importarce.
 *
 * O sea: la regla se aplica a los contratos que pueden marcarse, y un esquema
 * que no declara el campo es un esquema cuyos contratos no se pueden marcar. Eso
 * no es un agujero si el resto del enunciado se cumple —y se comprueba con
 * `ningunEsquemaAplica()`—, porque siempre habra un esquema que si la aplica.
 *
 * @param {object} esquema
 * @returns {boolean}
 */
export function esquemaAplica(esquema) {
  return esquema?.properties?.[POLITICA.campoEstado] !== undefined;
}

/**
 * Si NINGUN esquema declara el campo del estado.
 *
 * Es el agujero que el punto anterior deja abierto, y por eso es una funcion
 * aparte y no una nota al pie: una regla que ningun esquema puede aplicar no
 * esta vigente, por muy escrita que este en este modulo. Sin este chequeo, basta
 * con que alguien quite `status` de `hardware_profile.schema.json` para que la
 * cuarentena de todo el mundo deje de poder usarse, y no hay ni un rojo.
 *
 * @param {object[]} esquemas
 * @returns {boolean}
 */
export function ningunEsquemaAplica(esquemas) {
  return !esquemas.some((esquema) => esquemaAplica(esquema));
}

/**
 * Que le falta a la regla de este lado para ser la misma que la del esquema.
 *
 * Solo se llama con esquemas a los que `esquemaAplica()` dice que si, asi que
 * aqui el campo del estado esta declarado y lo que se comprueba es que declare
 * la cosa que esta regla necesita.
 *
 * @param {object} esquema
 * @returns {string[]} problemas. Vacio = las dos mitades dicen lo mismo.
 */
export function comprobarContraElEsquema(esquema) {
  const problemas = [];

  if (!esquemaAplica(esquema)) {
    return [`este esquema no declara "${POLITICA.campoEstado}" y se ha comparado con la `
      + 'regla. O no le aplica, y entonces no hay que compararlo, o le aplica y le '
      + 'falta el campo. Las dos cosas son un fallo de este codigo.'];
  }

  const declarados = estadosDeclaradosPorElEsquema(esquema);

  if (declarados === null) {
    problemas.push(
      `declara "${POLITICA.campoEstado}" pero no un enum. Sin enum no hay forma de `
      + 'saber que estados existen, y con `additionalProperties: false` un '
      + 'contrato con `status` no valida contra el esquema.');
  } else {
    if (!declarados.includes(POLITICA.valorEstado)) {
      problemas.push(
        `el enum de "${POLITICA.campoEstado}" no contiene "${POLITICA.valorEstado}", `
        + 'que es lo que esta regla mira. Con el enum como esta, ningun contrato '
        + 'puede retenerse.');
    }

    if (declarados.length > 1) {
      problemas.push(
        `el enum de "${POLITICA.campoEstado}" declara ${declarados.length} valores `
        + `(${declarados.join(', ')}) y la regla conoce uno. Cada valor extra es un `
        + 'estado que el laboratorio no va a retener y este repositorio tampoco '
        + 'vigila: dos verdades sobre si ese contrato se muestra.');
    }
  }

  if (esquema?.properties?.[POLITICA.campoMotivo] === undefined) {
    problemas.push(
      `el esquema no declara "${POLITICA.campoMotivo}", el campo del que sale el `
      + 'motivo que se muestra en el cajon.');
  }

  return problemas;
}

/**
 * Si la regla que el GENERADOR ha derivado del enum es la misma regla que esta.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUE HACE FALTA, Y POR QUE ESTA EN ESTE FICHERO Y NO EN EL GENERADOR
 *
 * El criterio mecanico del generador y `POLITICA` son las dos mitades de la misma
 * pregunta, y hasta ahora no se miraban. El generador deriva el campo del unico
 * `enum` de un valor y sale con un verde, porque su unico criterio es que el
 * esquema tenga UN enum de un valor. Ese criterio no sabe que ese enum sea el del
 * estado: le valdria igual cualquier otro, y el error se lleva por delante la
 * regla sin avisar.
 *
 * El fallo medido, con el renombrado hecho a proposito, que es lo que haria
 * alguien migrando bien: `status` pasa a `estado` y `statusReason` a
 * `estadoReason`. El generador escribe una cabecera que mira `estado`, dice
 * "escrita" y sale con 0. El dato sigue diciendo `status`. La cabecera y el DATO
 * ya no hablan, el laboratorio va a dejar de retener en silencio, y lo unico que
 * se ve es un rojo de otra puerta, cuando el contrato ya se leia como sano. El
 * mensaje de arreglo era ademas equivocado: decia regenera, y regenerar es
 * justo lo que fija el error.
 *
 * Y el sitio de la comprobacion es este y no el generador porque lo que se
 * compara son los NOMBRES, y los nombres estan en `POLITICA`. Si el generador
 * se comprobara contra su propia salida compararia el enum consigo mismo y no
 * diria nada: hace falta un segundo origen, y el unico que existe es la mitad de
 * JS de la misma regla.
 *
 * Lo que NO hace es elegir. Si las dos mitades no coinciden, esto se queja y se
 * para. Un renombrado son tres cambios, el enum, la politica y los contratos que
 * llevan la marca, y decidir cual de las dos listas es la buena no es de un
 * script.
 *
 * @param {{campoEstado: string, valorEstado: string, campoMotivo: string}} derivada
 *   lo que el generador dedujo del enum.
 * @returns {string[]} problemas. Vacio = el enum y la politica son la misma regla.
 */
export function contratoDerivaIgual(derivadas) {
  if (!Array.isArray(derivadas))
    return ['el generador no ha devuelto una lista de reglas, sino ' + typeof derivadas];

  if (derivadas.length === 0)
    return ['el generador no ha derivado ninguna regla. Una cuarentena sin reglas no retiene nada, y eso parece funcionar hasta que se cuela un Aparato dudoso.'];

  // Las dos mitades tienen que declarar el MISMO numero de reglas, y se comparan
  // por POSICION. La posicion es el contrato: el mapa del esquema es una lista
  // ordenada y esta tambien, asi que la segunda significa lo mismo en los dos
  // lados. Sin eso, un mapa reordenado moveria las reglas de sitio y el error seria
  // invisible.
  if (derivadas.length !== POLITICAS.length) {
    return [
      `el esquema declara ${derivadas.length} regla(s) de cuarentena y este repositorio solo conoce ${POLITICAS.length}. Una regla que este repositorio no vigila es una regla que C++ aplicara sin que nadie la compruebe: o se anade a POLITICAS, o se quita la entrada del mapa.`,
    ];
  }
  const problemas = [];

  // Se comparan los tres por separado y no el objeto entero, porque cada uno se
  // rompe por su cuenta. Un cambio en el VALOR no es un renombrado: es una marca
  // nueva, y esa se decide sola.
  derivadas.forEach((derivada, i) => {
    const declarada = POLITICAS[i];
    const donde = 'la regla ' + i;

    const pares = [
      [declarada.campoEstado, derivada.campoEstado, 'el campo que lleva la marca'],
      [declarada.valorEstado, derivada.valorEstado, 'el valor que retiene'],
      [declarada.campoMotivo, derivada.campoMotivo, 'el campo del motivo'],
    ];

    for (const [declarado, derivado, que] of pares) {
      if (declarado === derivado)
        continue;

      problemas.push(
        donde + ', ' + que
          + `: la regla de este repositorio lo llama "${declarado}" y el mapa del esquema ha derivado "${derivado}". El mapa DECLARA el campo y su motivo, asi que esto ya no es una adivinanza: o el mapa se ha editado sin actualizar esta lista, o al reves. Las dos cosas son un renombrado a medias.`,
      );
    }
  });

  if (problemas.length > 0) {
    problemas.push(
      'Regenerar la cabecera NO lo arregla: deja a C++ mirando un campo que el dato '
        + 'no tiene, y la cuarentena dejaria de retener en silencio. Un renombrado son '
        + 'tres cambios a la vez, el mapa del esquema, esta lista y los contratos que '
        + 'llevan la marca, y cual de las dos listas es la buena no lo decide un script.',
    );
  }

  return problemas;
}
