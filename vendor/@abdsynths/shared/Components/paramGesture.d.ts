/**
 * El puente es lo único que aporta cada sintetizador: su canal hacia el host.
 */
export interface ParamGestureBridge {
  beginGesture(index: number): void;
  endGesture(index: number): void;
}

/** Callbacks que espera cualquier control arrastrable de la familia. */
export interface ParamGestureHandlers {
  onDragStart: () => void;
  onDragEnd: () => void;
}

/** Gesto de un único parámetro. */
export function gestureFor(bridge: ParamGestureBridge, index: number): ParamGestureHandlers;

/** Gesto conjunto: abre y cierra todos los parámetros del control. */
export function gestureForGroup(
  bridge: ParamGestureBridge,
  indices: readonly number[],
): ParamGestureHandlers;

export interface ParamGestures {
  gestureFor(index: number): ParamGestureHandlers;
  gestureForGroup(indices: readonly number[]): ParamGestureHandlers;
}

/** Ata el puente una vez y devuelve `gestureFor` / `gestureForGroup` ya ligados. */
export function createParamGestures(bridge: ParamGestureBridge): ParamGestures;
