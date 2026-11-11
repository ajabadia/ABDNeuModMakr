/**
 * ParamGesture — el cableado único entre un control arrastrable y el gesto de
 * automatización del host.
 * ============================================================================
 * Un control de la familia (Knob, Slider, FilmstripFader, XYPad…) expone
 * `onDragStart` / `onDragEnd` y no sabe qué significan: eso lo decide el host.
 * Un arrastre de 400 px emite cientos de `onChange` —y por tanto cientos de
 * PARAM_SET—, pero para el DAW es UN gesto: sin `beginChangeGesture` /
 * `endChangeGesture` graba un punto por paso y el undo no revierte el
 * movimiento completo.
 *
 * Lo único específico de cada sintetizador es el puente: cualquier objeto con
 * `beginGesture(index)` / `endGesture(index)` que hable con su host. Abrir,
 * cerrar y agrupar parámetros es exactamente esto para toda la suite.
 *
 * Usage:
 *   const { gestureFor, gestureForGroup } = createParamGestures(bridge);
 *   new Knob(el, { ...gestureFor(ParamIdx.FilterFreq), onChange });
 *   new MultiStageShaperPad(el, { ...gestureForGroup(FREE_ENV_CONTOUR) });
 */

/**
 * @typedef {object} ParamGestureBridge
 * @property {(index: number) => void} beginGesture
 * @property {(index: number) => void} endGesture
 */

/**
 * @typedef {object} ParamGestureHandlers
 * @property {() => void} onDragStart
 * @property {() => void} onDragEnd
 */

/**
 * Devuelve los callbacks de gesto para el parámetro `index`, listos para
 * esparcir en las opciones de cualquier control arrastrable.
 *
 * @param {ParamGestureBridge} bridge
 * @param {number} index
 * @returns {ParamGestureHandlers}
 */
export function gestureFor(bridge, index) {
  return {
    onDragStart: () => bridge.beginGesture(index),
    onDragEnd: () => bridge.endGesture(index),
  };
}

/**
 * Gestos para un control que gobierna VARIOS parametros a la vez (el pad de
 * una envolvente 4L/4T mueve ocho). El host empareja begin/end por parametro,
 * asi que se abren y se cierran todos: el arrastre entero cuenta como un unico
 * cambio en cada uno y el undo revierte el movimiento completo.
 *
 * @param {ParamGestureBridge} bridge
 * @param {readonly number[]} indices
 * @returns {ParamGestureHandlers}
 */
export function gestureForGroup(bridge, indices) {
  return {
    onDragStart: () => {
      for (const index of indices) bridge.beginGesture(index);
    },
    onDragEnd: () => {
      for (const index of indices) bridge.endGesture(index);
    },
  };
}

/**
 * Ata el puente de un sintetizador una sola vez y devuelve sus dos funciones
 * ya ligadas, para que el resto del codigo no lo repita en cada llamada.
 *
 * @param {ParamGestureBridge} bridge
 * @returns {{ gestureFor: (index: number) => ParamGestureHandlers, gestureForGroup: (indices: readonly number[]) => ParamGestureHandlers }}
 */
export function createParamGestures(bridge) {
  return {
    gestureFor: (index) => gestureFor(bridge, index),
    gestureForGroup: (indices) => gestureForGroup(bridge, indices),
  };
}
