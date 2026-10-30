/**
 * LcdMachine — la máquina de estados del LCD, PURA (sin DOM).
 * ============================================================
 *
 * Máquina de estados abstracta para navegación y edición de parámetros:
 * - Estados: 'idle' | 'navigation' | 'edit'.
 * - Navegación jerárquica con árbol inyectable de cualquier profundidad.
 * - Soporte D-pad: onMenuPress, onOkPress, onEncoderRotate, onArrow.
 * - Función pura de renderizado de texto de líneas y formateo numérico.
 */

export function createLcdMachine(rootItems = [], hooks = {}) {
  const machine = {
    state: 'idle',
    path: [],
    editing: null,
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

  machine.onMenuPress = () => {
    if (machine.state === 'edit') {
      machine.state = 'navigation';
      machine.editing = null;
    } else if (machine.state === 'navigation') {
      if (machine.path.length > 1) {
        machine.path.pop();
      } else if (machine.path.length === 1 && machine.path[0].index !== 0) {
        machine.path[0].index = 0;
      } else {
        exitToIdle();
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
        machine.path.push({ items: item.sub, index: 0 });
      } else if (item.type === 'action') {
        fire('onAction', item, machine);
      } else {
        machine.editing = item;
        machine.state = 'edit';
      }
    } else if (machine.state === 'edit') {
      machine.editing = null;
      machine.state = 'navigation';
    }
    return snapshot(machine);
  };

  machine.onEncoderRotate = (delta) => {
    const d = Number(delta) || 0;
    if (machine.state === 'edit') {
      if (machine.editing) fire('onEdit', machine.editing.paramId, d, machine);
    } else if (machine.state === 'navigation') {
      const level = currentLevel();
      level.index = clampWrap(level.index, itemsAt(level).length, d);
    } else if (rootItems.length && hooks.onPreview) {
      const base = machine.previewIndex < 0 ? (d > 0 ? -1 : 0) : machine.previewIndex;
      machine.previewIndex = clampWrap(base, rootItems.length, d);
      fire('onPreview', rootItems[machine.previewIndex], d, machine);
    }
    return snapshot(machine);
  };

  machine.onArrow = (dir) => {
    return machine.onEncoderRotate(dir === 'left' ? -1 : dir === 'right' ? 1 : dir === 'up' ? 5 : -5);
  };

  machine.renderLines = (values = {}) => {
    const v = {
      idleLine1: '', idleLine2: '',
      editValue: '',
    };
    Object.assign(v, values);

    if (machine.state === 'idle') return [v.idleLine1, v.idleLine2];

    if (machine.state === 'navigation') {
      const level = currentLevel();
      const inRoot = machine.path.length === 1;
      const parentLevel = inRoot ? null : machine.path[machine.path.length - 2];
      const parent = inRoot ? 'MAIN MENU'
        : (parentLevel.items[parentLevel.index]?.label ?? '');
      const current = currentItem();
      const line2 = current ? `>${current.label}` : '>';
      return [String(parent).slice(0, 16), line2.slice(0, 16)];
    }

    return [
      (machine.editing?.label ?? '').slice(0, 16),
      String(v.editValue ?? '').slice(0, 16),
    ];
  };

  machine.currentItem = currentItem;
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
