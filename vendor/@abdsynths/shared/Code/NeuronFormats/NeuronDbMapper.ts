// ─────────────────────────────────────────────────────────
// @abdsynths/shared — NeuronDbMapper (Transparent BrainMapper Engine)
//
// Transparent relational dependency analyzer, slot allocator, sound-reference
// remapper, model compactor, and ModelNames/SoundNames cache synchronizer for
// Hartmann NeuronDB libraries (Models 000..511 <-> Sounds 000..999).
//
// Inspired by Prosoniq / Hartmann <Neuron> BrainMapper v1.2.0 (`evaluateNeuronDb`,
// `replaceUniqueModelInAllSounds:by:`, `deleteAndCompactModelsStartingAtIndex:`,
// `updateModelNames`, `updateSoundNames`), designed to run automatically and
// transparently behind the shared bank layer in both ABDAxionikVS and ABDNeuModMakr.
// ─────────────────────────────────────────────────────────

import { serializeModelNamesCache } from './ModelFormat.ts';
import {
  parseSoundScript,
  serializeSoundNamesCache,
  serializeSoundScript,
} from './SoundFormat.ts';

export const PINNED_SINEW_SLOT = 511;
export const MAX_MODEL_SLOT = 511;
export const MAX_USER_MODEL_SLOT = 510;
export const EMPTY_MODEL_PLACEHOLDER = '--<empty>--';

export type ModelUsageStatus = 'in-use' | 'in-use-disabled' | 'unused';

export interface NeuronDbModelRef {
  slot: number;
  name: string;
}

export interface NeuronDbPresetRef {
  slot: number;
  name: string;
  /** Primary Resynator 1 model index (`R1ModellIndex [22]`) */
  modelIndex: number;
  /** Secondary Resynator 2 model index (`R2ModellIndex [102]`) */
  r2ModelIndex?: number;
  /** Whether Resynator 1 is enabled (`R1Switch [23]`, defaults to true) */
  r1Switch?: boolean;
  /** Whether Resynator 2 is enabled (`R2Switch [103]`, defaults to true) */
  r2Switch?: boolean;
}

export interface ModelDependencyInfo {
  slot: number;
  name: string;
  isEmptySlot: boolean;
  isPinnedSlot: boolean;
  usageStatus: ModelUsageStatus;
  /** All preset slots (0..999) referencing this model in R1 or R2 */
  usedByPresetSlots: number[];
  /** Preset slots where the referencing Resynator (R1 or R2) is switched ON */
  activePresetSlots: number[];
  /** Preset slots where the referencing Resynator is switched OFF */
  disabledPresetSlots: number[];
}

export interface PresetDependencyInfo {
  slot: number;
  name: string;
  r1ModelIndex: number;
  r2ModelIndex: number;
  r1ModelName: string;
  r2ModelName: string;
  r1Missing: boolean;
  r2Missing: boolean;
}

export interface NeuronDbEvaluation {
  modelDependencies: Map<number, ModelDependencyInfo>;
  presetDependencies: Map<number, PresetDependencyInfo>;
  activeModelCount: number;
  inUseModelCount: number;
  unusedModelCount: number;
  emptyPlaceholderSlots: number[];
}

/**
 * Returns true when a model name is blank or the canonical NeuronDB `--<empty>--` placeholder
 * (such as factory slots `340..510`).
 */
export function isEmptyModelName(name: string | undefined | null): boolean {
  if (!name) return true;
  const trimmed = name.trim();
  return trimmed.length === 0 || trimmed.toLowerCase() === EMPTY_MODEL_PLACEHOLDER;
}

/**
 * Filters out `--<empty>--` placeholder entries from a model list while preserving all real models.
 */
export function filterActiveModels<T extends NeuronDbModelRef>(models: readonly T[]): T[] {
  return models.filter((m) => !isEmptyModelName(m.name));
}

/**
 * Evaluates the full relational graph between NeuronDB Models (`000..511`) and Sounds (`000..999`),
 * classifying every model's usage status (`in-use`, `in-use-disabled`, `unused`) and resolving
 * both `R1` and `R2` model names and missing-model flags for every sound preset.
 */
export function evaluateNeuronDb(
  models: readonly NeuronDbModelRef[],
  presets: readonly NeuronDbPresetRef[]
): NeuronDbEvaluation {
  const modelBySlot = new Map<number, NeuronDbModelRef>();
  const emptyPlaceholderSlots: number[] = [];

  for (const m of models) {
    modelBySlot.set(m.slot, m);
    if (isEmptyModelName(m.name)) {
      emptyPlaceholderSlots.push(m.slot);
    }
  }

  const activeRefsByModel = new Map<number, Set<number>>();
  const disabledRefsByModel = new Map<number, Set<number>>();

  const addRef = (map: Map<number, Set<number>>, modelSlot: number, presetSlot: number) => {
    let set = map.get(modelSlot);
    if (!set) {
      set = new Set<number>();
      map.set(modelSlot, set);
    }
    set.add(presetSlot);
  };

  const presetDependencies = new Map<number, PresetDependencyInfo>();

  for (const p of presets) {
    const r1Idx = p.modelIndex ?? PINNED_SINEW_SLOT;
    const r2Idx = p.r2ModelIndex ?? PINNED_SINEW_SLOT;
    const r1On = p.r1Switch !== false;
    const r2On = p.r2Switch !== false;

    if (r1On) {
      addRef(activeRefsByModel, r1Idx, p.slot);
    } else {
      addRef(disabledRefsByModel, r1Idx, p.slot);
    }

    if (r2On) {
      addRef(activeRefsByModel, r2Idx, p.slot);
    } else {
      addRef(disabledRefsByModel, r2Idx, p.slot);
    }

    const r1Entry = modelBySlot.get(r1Idx);
    const r2Entry = modelBySlot.get(r2Idx);
    const r1Missing = !r1Entry || isEmptyModelName(r1Entry.name);
    const r2Missing = !r2Entry || isEmptyModelName(r2Entry.name);

    presetDependencies.set(p.slot, {
      slot: p.slot,
      name: p.name,
      r1ModelIndex: r1Idx,
      r2ModelIndex: r2Idx,
      r1ModelName: !r1Missing && r1Entry ? r1Entry.name : r1Idx === PINNED_SINEW_SLOT ? 'sinew' : `#${String(r1Idx).padStart(3, '0')}`,
      r2ModelName: !r2Missing && r2Entry ? r2Entry.name : r2Idx === PINNED_SINEW_SLOT ? 'sinew' : `#${String(r2Idx).padStart(3, '0')}`,
      r1Missing: r1Idx !== PINNED_SINEW_SLOT && r1Missing,
      r2Missing: r2On && r2Idx !== PINNED_SINEW_SLOT && r2Missing,
    });
  }

  const modelDependencies = new Map<number, ModelDependencyInfo>();
  let activeModelCount = 0;
  let inUseModelCount = 0;
  let unusedModelCount = 0;

  for (const m of models) {
    const isEmptySlot = isEmptyModelName(m.name);
    const isPinnedSlot = m.slot === PINNED_SINEW_SLOT;
    const activeSet = activeRefsByModel.get(m.slot);
    const disabledSet = disabledRefsByModel.get(m.slot);

    const activePresetSlots = activeSet ? Array.from(activeSet).sort((a, b) => a - b) : [];
    const disabledOnlySlots = disabledSet
      ? Array.from(disabledSet)
          .filter((slot) => !activeSet?.has(slot))
          .sort((a, b) => a - b)
      : [];
    const usedByPresetSlots = Array.from(
      new Set([...activePresetSlots, ...disabledOnlySlots])
    ).sort((a, b) => a - b);

    let usageStatus: ModelUsageStatus = 'unused';
    if (!isEmptySlot) {
      activeModelCount++;
      if (activePresetSlots.length > 0) {
        usageStatus = 'in-use';
        inUseModelCount++;
      } else if (disabledOnlySlots.length > 0) {
        usageStatus = 'in-use-disabled';
        inUseModelCount++;
      } else {
        unusedModelCount++;
      }
    }

    modelDependencies.set(m.slot, {
      slot: m.slot,
      name: m.name,
      isEmptySlot,
      isPinnedSlot,
      usageStatus,
      usedByPresetSlots,
      activePresetSlots,
      disabledPresetSlots: disabledOnlySlots,
    });
  }

  return {
    modelDependencies,
    presetDependencies,
    activeModelCount,
    inUseModelCount,
    unusedModelCount,
    emptyPlaceholderSlots,
  };
}

/**
 * Transparently finds a safe model slot in `000..510` so saving or importing a model
 * never overwrites `#511 sinew` or an `'in-use'` model referenced by presets:
 *   1. If `preferredSlot` (`0..510`) is unallocated or `--<empty>--` or `'unused'`, returns it.
 *   2. Otherwise searches `0..510` for the first unallocated or `--<empty>--` slot.
 *   3. If all `0..510` slots have models, returns the first `'unused'` model slot in `0..510`.
 *   4. Falls back to `preferredSlot` clamped to `0..510` if every single slot is in use.
 */
export function findNextFreeModelSlot(
  models: readonly NeuronDbModelRef[],
  presets: readonly NeuronDbPresetRef[],
  preferredSlot = 0
): number {
  const evalResult = evaluateNeuronDb(models, presets);
  const clampedPreferred = Math.max(0, Math.min(MAX_USER_MODEL_SLOT, Math.trunc(preferredSlot)));

  const isUnallocatedOrEmpty = (slot: number): boolean => {
    if (slot < 0 || slot > MAX_USER_MODEL_SLOT) return false;
    const dep = evalResult.modelDependencies.get(slot);
    if (!dep) return true;
    return dep.isEmptySlot && dep.usageStatus === 'unused';
  };

  const isUnusedSlot = (slot: number): boolean => {
    if (slot < 0 || slot > MAX_USER_MODEL_SLOT) return false;
    const dep = evalResult.modelDependencies.get(slot);
    if (!dep) return true;
    return dep.usageStatus === 'unused';
  };

  if (preferredSlot !== PINNED_SINEW_SLOT && isUnallocatedOrEmpty(clampedPreferred)) {
    return clampedPreferred;
  }

  for (let slot = 0; slot <= MAX_USER_MODEL_SLOT; slot++) {
    if (isUnallocatedOrEmpty(slot)) {
      return slot;
    }
  }

  if (preferredSlot !== PINNED_SINEW_SLOT && isUnusedSlot(clampedPreferred)) {
    return clampedPreferred;
  }

  for (let slot = 0; slot <= MAX_USER_MODEL_SLOT; slot++) {
    if (isUnusedSlot(slot)) {
      return slot;
    }
  }

  return clampedPreferred;
}

/**
 * Replaces all references to `oldModelSlot` with `newModelSlot` across a preset catalog
 * (`R1ModellIndex` and `R2ModellIndex`), mirroring BrainMapper's `replaceUniqueModelInAllSounds:by:`.
 */
export function remapModelInPresets<T extends NeuronDbPresetRef>(
  presets: readonly T[],
  oldModelSlot: number,
  newModelSlot: number
): { presets: T[]; affectedPresetSlots: number[] } {
  const affectedPresetSlots: number[] = [];
  const updated = presets.map((p) => {
    const r1Match = p.modelIndex === oldModelSlot;
    const r2Match = p.r2ModelIndex === oldModelSlot;
    if (!r1Match && !r2Match) return p;

    affectedPresetSlots.push(p.slot);
    return {
      ...p,
      modelIndex: r1Match ? newModelSlot : p.modelIndex,
      ...(p.r2ModelIndex !== undefined
        ? { r2ModelIndex: r2Match ? newModelSlot : p.r2ModelIndex }
        : {}),
    };
  });

  return { presets: updated, affectedPresetSlots };
}

/**
 * Transparently rewrites `R1ModellIndex` and/or `R2ModellIndex` inside a `sound.script` text
 * when a model is moved or remapped from `oldModelSlot` to `newModelSlot`.
 */
export function remapModelInSoundScript(
  scriptText: string,
  oldModelSlot: number,
  newModelSlot: number
): { scriptText: string; changed: boolean } {
  const parsed = parseSoundScript(scriptText);
  let changed = false;

  if (parsed.r1ModelIndex === oldModelSlot) {
    parsed.r1ModelIndex = newModelSlot;
    parsed.values.set('R1ModellIndex', newModelSlot);
    changed = true;
  }
  if (parsed.r2ModelIndex === oldModelSlot) {
    parsed.r2ModelIndex = newModelSlot;
    parsed.values.set('R2ModellIndex', newModelSlot);
    changed = true;
  }

  if (!changed) {
    return { scriptText, changed: false };
  }

  return {
    scriptText: serializeSoundScript(parsed),
    changed: true,
  };
}

/**
 * Compacts/consolidates a NeuronDB model list starting at `startSlot` (removing `--<empty>--`
 * placeholders and closing slot gaps while keeping `#511 sinew` pinned at `511`), and
 * automatically remaps all affected `R1` and `R2` model indices in `presets`.
 */
export function consolidateNeuronDbModels<
  M extends NeuronDbModelRef,
  P extends NeuronDbPresetRef,
>(
  models: readonly M[],
  presets: readonly P[],
  startSlot = 0
): {
  models: M[];
  presets: P[];
  slotRemap: Map<number, number>;
  removedEmptySlots: number[];
} {
  const clampedStart = Math.max(0, Math.min(MAX_USER_MODEL_SLOT, Math.trunc(startSlot)));
  const sorted = [...models].sort((a, b) => a.slot - b.slot);
  const removedEmptySlots: number[] = [];
  const slotRemap = new Map<number, number>();
  const compactedModels: M[] = [];

  let nextSlot = clampedStart;

  for (const m of sorted) {
    if (isEmptyModelName(m.name)) {
      removedEmptySlots.push(m.slot);
      continue;
    }

    if (m.slot === PINNED_SINEW_SLOT || m.slot < clampedStart) {
      compactedModels.push(m);
      if (m.slot >= clampedStart && m.slot !== PINNED_SINEW_SLOT && m.slot >= nextSlot) {
        nextSlot = m.slot + 1;
      }
      continue;
    }

    const assignedSlot = Math.min(MAX_USER_MODEL_SLOT, nextSlot++);
    if (assignedSlot !== m.slot) {
      slotRemap.set(m.slot, assignedSlot);
      compactedModels.push({
        ...m,
        slot: assignedSlot,
      });
    } else {
      compactedModels.push(m);
    }
  }

  const updatedPresets =
    slotRemap.size === 0
      ? [...presets]
      : presets.map((p) => {
          const newR1 = slotRemap.get(p.modelIndex) ?? p.modelIndex;
          const newR2 =
            p.r2ModelIndex !== undefined
              ? (slotRemap.get(p.r2ModelIndex) ?? p.r2ModelIndex)
              : undefined;
          if (newR1 === p.modelIndex && newR2 === p.r2ModelIndex) {
            return p;
          }
          return {
            ...p,
            modelIndex: newR1,
            ...(newR2 !== undefined ? { r2ModelIndex: newR2 } : {}),
          };
        });

  return {
    models: compactedModels,
    presets: updatedPresets,
    slotRemap,
    removedEmptySlots,
  };
}

/**
 * Generates canonical `NeuronDB/ModelNames` (512 lines) and `NeuronDB/SoundNames` (1000 lines)
 * cache files from the current models and presets, matching BrainMapper's `updateModelNames`
 * and `updateSoundNames`.
 */
export function syncNeuronDbNamesCaches(
  models: readonly NeuronDbModelRef[],
  presets: readonly NeuronDbPresetRef[]
): { modelNamesCache: string; soundNamesCache: string } {
  const modelMap = new Map<number, string>();
  for (const m of models) {
    if (!isEmptyModelName(m.name)) {
      modelMap.set(m.slot, m.name);
    }
  }
  if (!modelMap.has(PINNED_SINEW_SLOT)) {
    modelMap.set(PINNED_SINEW_SLOT, 'sinew');
  }

  const soundMap = new Map<number, string>();
  for (const p of presets) {
    if (p.name && p.name.trim().length > 0) {
      soundMap.set(p.slot, p.name);
    }
  }

  return {
    modelNamesCache: serializeModelNamesCache(modelMap),
    soundNamesCache: serializeSoundNamesCache(soundMap),
  };
}

