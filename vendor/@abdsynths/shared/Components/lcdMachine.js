/**
 * LcdMachine — la maquina de estados del LCD, PURA (sin DOM).
 * ============================================================
 *
 * Herencia y lecciones de las cuatro estirpes de la suite:
 *   - NEURONiK nativo (Source/UI/LcdMenuManager.h, retirado en c811b75, vivo en
 *     git): estados Idle/Navigation/Edit, ItemType Parameter/MidiCC/Action,
 *     arbol GLOBAL/RESONATOR/FILTER/EFFECTS/MIDI CONTROL, y el matiz CLAVE:
 *     los items dependen del engineType -> el arbol se INYECTA, no se hardcodea.
 *   - CZ101 (WebUI/src/contracts/lcdMenu.js): el menu son DATOS derivados del
 *     registro de parametros; items con tipo, rango, paso, unidad y choices.
 *   - ABDEep (script_lcd_core.js): los mensajes transitorios son una COLA con
 *     prioridad y expiracion -> el preview con timeout vive en la pantalla,
 *     aqui solo reservamos el canal onPreview/onAction.
 *
 * Regla del paquete: la MECANICA es universal (estos ficheros), los DATOS son
 * de cada synth (el arbol se pasa en el constructor). Todo devuelto es un valor
 * nuevo (la maquina no guarda referencias al mundo exterior) y onEdit/onAction
 * comunican con el synth por callbacks: nada de DOM, nada de bridge.
 */

/**
 * Crear la maquina de estados del LCD.
 *
 * @param {Array<LcdMenuItem>} rootItems arbol del menu del synth (0, 1 o N niveles).
 * @param {Object} [hooks] callbacks del synth (todos opcionales):
 *   - onEdit(paramId, dir, state)  en EDIT, Encoder +/- (dir = -1|+1). El synth
 *     aplica el paso/rango que corresponda a SU parametro.
 *   - onAction(item, state)        un item Action se confirma con OK.
 *   - onPreview(paramId, dir, state)  en IDLE, Encoder gira: preview de parametro
 *     rapido sin entrar en menu (sintoma de knob de hardware).
 *   - onIdle(state)                se vuelve a IDLE (para repintar la pantalla).
 * @returns {LcdMachine}
 *
 * LcdMenuItem: { label, paramId?, type?, sub? } con
 *   type: 'parameter' (default) | 'cc' (aprendizaje MIDI CC) | 'action'
 *   sub:  array de subitems (el arbol es de profundidad libre: cada nivel navega
 *         con las mismas reglas — la version nativa se quedaba en 2 niveles).
 */

export function createLcdMachine(rootItems, hooks = {}) {
  const machine = {
    /** Estado actual: 'idle' | 'navigation' | 'edit'. */
    state: 'idle',
    /** Pila de navegacion: [{ items, index }] desde la raiz. */
    path: [],
    /** Item activo en EDIT (el synth le escribe el valor). */
    editing: null,
    /** Indice del item en preview en IDLE (Encoder rapido); -1 = ninguno. */
    previewIndex: -1,
  };

  const fire = (name, ...args) => {
    const fn = hooks[name];
    if (typeof fn === 'function') fn(...args);
  };

  const currentLevel = () => (machine.path.length ? machine.path[machine.path.length - 1] : null);

  const itemsAt = (level) => (level ? level.items : rootItems);

  const clampWrap = (index, size, delta) => {
    if (size <= 0) return 0;
    return (((index + delta) % size) + size) % size;
  };

  const exitToIdle = () => {
    machine.state = 'idle';
    machine.path = [];
    machine.editing = null;
    machine.previewIndex = -1;
    fire('onIdle', machine);
  };

  const currentItem = () => {
    const level = currentLevel();
    if (!level) return null;
    return level.items[level.index] ?? null;
  };

  // --- d-pad: la interfaz que comparte con el C++ (onMenuPress/onOkPress/
  //     onEncoderRotate/onArrow), mismos nombres que LcdMenuManager ---

  machine.onMenuPress = () => {
    if (machine.state === 'edit') {
      // Cancelar edicion y volver a navegacion.
      machine.state = 'navigation';
      machine.editing = null;
    } else if (machine.state === 'navigation') {
      if (machine.path.length > 1) {
        machine.path.pop(); // subir un nivel
      } else if (machine.path.length === 1 && machine.path[0].index !== 0) {
        machine.path[0].index = 0; // en la raiz: volver al primer item...
      } else {
        exitToIdle(); // ...y en el primer item, salir al reposo
      }
    } else {
      machine.state = 'navigation';
      machine.path = [{ items: rootItems, index: 0 }];
    }
    return snapshot(machine);
  };

  machine.onOkPress = () => {
    if (machine.state === 'navigation') {
      const item = currentItem();
      if (!item) return snapshot(machine);
      if (item.sub && item.sub.length) {
        // Entrar en el subnivel.
        machine.path.push({ items: item.sub, index: 0 });
      } else if (item.type === 'action') {
        fire('onAction', item, machine); // la accion se dispara ya
      } else {
        machine.editing = item; // parameter / cc -> a EDITAR
        machine.state = 'edit';
      }
    } else if (machine.state === 'edit') {
      // Confirmar y volver a navegacion.
      machine.editing = null;
      machine.state = 'navigation';
    }
    return snapshot(machine);
  };

  machine.onEncoderRotate = (delta) => {
    // Delta CRUDO: las flechas pasan +/-5 (ajuste grueso) y el encoder +/-1.
    // La navegacion mueve N items; onEdit entrega N pasos al synth.
    const d = Number(delta) || 0;
    if (machine.state === 'edit') {
      if (machine.editing) fire('onEdit', machine.editing.paramId, d, machine);
    } else if (machine.state === 'navigation') {
      const level = currentLevel();
      level.index = clampWrap(level.index, itemsAt(level).length, d);
    } else if (rootItems.length && hooks.onPreview) {
      // IDLE con Encoder: preview rapido de parametros (el synth decide).
      const base = machine.previewIndex < 0 ? (d > 0 ? -1 : 0) : machine.previewIndex;
      machine.previewIndex = clampWrap(base, rootItems.length, d);
      fire('onPreview', rootItems[machine.previewIndex], d, machine);
    }
    return snapshot(machine);
  };

  machine.onArrow = (dir) => {
    // Los cursores de la pantalla son el Encoder con un paso: ‹ › = -1/+1,
    // ^ v = +5/-5 (ajuste grueso, como el D-pad del 8.3).
    return machine.onEncoderRotate(dir === 'left' ? -1 : dir === 'right' ? 1 : dir === 'up' ? 5 : -5);
  };

  /** Componer el texto de las 2 lineas (16 chars) para un estado dado. */
  machine.renderLines = (values = {}) => {
    const v = {
      idleLine1: '', idleLine2: '', // datos del synth (preset/banco...)
      editValue: '',                // texto del valor en EDIT
    };
    Object.assign(v, values);

    if (machine.state === 'idle') return [v.idleLine1, v.idleLine2];

    if (machine.state === 'navigation') {
      const level = currentLevel();
      const inRoot = machine.path.length === 1;
      // Linea 1 = donde estoy (raiz: "MAIN MENU"; subnivel: la etiqueta del
      // item padre, que es el item corriente del nivel anterior en la pila).
      // Linea 2 = el item corriente, con '>' como cursor de seleccion.
      const parentLevel = inRoot ? null : machine.path[machine.path.length - 2];
      const parent = inRoot ? 'MAIN MENU'
        : (parentLevel.items[parentLevel.index]?.label ?? '');
      const current = currentItem();
      const line2 = current ? `>${current.label}` : '>';
      return [String(parent).slice(0, 16), line2.slice(0, 16)];
    }

    // EDIT: linea 1 = etiqueta del item, linea 2 = el valor que pinta el synth.
    return [
      (machine.editing?.label ?? '').slice(0, 16),
      String(v.editValue ?? '').slice(0, 16),
    ];
  };

  machine.currentItem = currentItem;

  /** Fotograma completo del estado (para el render de la pantalla y los tests). */
  machine.snapshot = () => snapshot(machine);

  return machine;
}

function snapshot(machine) {
  const level = machine.path.length ? machine.path[machine.path.length - 1] : null;
  const item = level ? level.items[level.index] ?? null : null;
  const items = level ? level.items : [];
  return {
    state: machine.state,
    depth: machine.path.length,
    index: level ? level.index : -1,
    count: items.length,
    item,
    editing: machine.editing,
    breadcrumb: machine.path.map((l) => l.items[l.index]?.label ?? '?'),
  };
}

/**
 * @typedef {object} ValueSpec  como se formatea el valor de un item: un mapa de
 *   etiquetas, un SI/NO o un numero con su unidad. La nombra `formatValue`, de abajo, y sus
 *   `@property` son la lista de lo que el formateo sabe mirar.
 * @property {string} [type]  'bool' para SI/NO; lo demas se formatea como numero.
 * @property {Array<{label: string}>} [choices]  etiquetas cuando el valor es un indice.
 * @property {string} [unit]  sufijo del numero (`HZ`, `dB`...).
 * @property {number} [decimals]  cifras decimales del numero formateado, default 2.
 */

/**
 * formatValue — formatear el valor de un item para la linea del LCD.
 * Separado de la maquina porque es lo unico que cada synth suele querer
 * personalizar (unidades, mapeos, booleanos a OFF/ON...).
 *
 * @param {number|null} value valor crudo del parametro
 * @param {ValueSpec} spec
 */
export function formatValue(value, spec = {}) {
  if (spec.choices) {
    const idx = Math.round(value ?? 0);
    const choice = spec.choices[idx];
    return choice ? choice.label : String(idx);
  }
  if (spec.type === 'bool') return value ? 'ON' : 'OFF';
  const decimals = spec.decimals ?? 2;
  const n = Number(value ?? 0);
  const text = Number.isFinite(n) ? n.toFixed(decimals) : '0';
  return spec.unit ? `${text} ${spec.unit}`.replace(/\.00 /, ' ').trimEnd() : text;
}
