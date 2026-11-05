// ---------------------------------------------------------
// ABDNeuModMakr - Fase 42.5: Bank Sublibraries
// CRUD de sub-bibliotecas jerarquicas
// Funciones puras de dominio: reciben el servicio (svc) y operan
// sobre su estado publico. La API estable vive en BankService.
// ---------------------------------------------------------

import {
  bridgeClient,
} from '../bridge/BridgeClient.ts';
import type {
  SublibraryInfo,
} from '../types.ts';
import type {
  BankService,
} from '../bankService.ts';

/**
 * Returns all available sub-libraries, including model counts and display ordering.
 */
export async function listSublibraries(svc: BankService, ): Promise<SublibraryInfo[]> {
  if (bridgeClient.isConnected()) {
    try {
      const libPath =
        (typeof localStorage !== 'undefined'
          ? localStorage.getItem('abd_axionikdb_path')
          : null) || 'd:\\desarrollos\\ABDSynths\\AxionikDB';
      const bridgeSubs = await bridgeClient.listSublibraries(libPath);
      if (bridgeSubs && bridgeSubs.length > 0) return bridgeSubs;
    } catch {
      // Fallback to local
    }
  }

  const counts = new Map<string, number>();
  for (const m of svc.generatedModels) {
    const sub = m.sublibrary || 'Default';
    counts.set(sub, (counts.get(sub) || 0) + 1);
  }

  return svc.sublibraries
    .map((s) => ({
      ...s,
      modelCount: counts.get(s.name) || 0,
    }))
    .sort((a, b) => (a.isDefault ? -1 : b.isDefault ? 1 : a.order - b.order));
}


/**
 * Creates a new sub-library in AxionikDB / local storage.
 */
export async function createSublibrary(svc: BankService, name: string, description?: string, order?: number): Promise<SublibraryInfo> {
  const cleanName = name.trim();
  if (!cleanName || cleanName.length > 64) {
    throw new Error('Invalid sub-library name (1-64 characters allowed).');
  }

  if (bridgeClient.isConnected()) {
    try {
      const libPath =
        (typeof localStorage !== 'undefined'
          ? localStorage.getItem('abd_axionikdb_path')
          : null) || 'd:\\desarrollos\\ABDSynths\\AxionikDB';
      await bridgeClient.createSublibrary(libPath, cleanName, description, order);
    } catch (err) {
      console.warn('Bridge createSublibrary warning:', err);
    }
  }

  const existing = svc.sublibraries.find((s) => s.name.toLowerCase() === cleanName.toLowerCase());
  if (existing) return existing;

  const newSub: SublibraryInfo = {
    name: cleanName,
    description: description || `Sub-library: ${cleanName}`,
    order: order ?? svc.sublibraries.length + 1,
    modelCount: 0,
    isDefault: cleanName === 'Default',
  };
  svc.sublibraries.push(newSub);
  svc.persistSublibraries();
  return newSub;
}


/**
 * Deletes a sub-library with STRICT safety rule:
 * Throws an error if the sub-library contains any models.
 */
export async function deleteSublibrary(svc: BankService, name: string): Promise<void> {
  const cleanName = name.trim();
  if (cleanName.toLowerCase() === 'default') {
    throw new Error('Cannot delete Default root sub-library.');
  }

  const modelsInSub = svc.generatedModels.filter(
    (m) => (m.sublibrary || 'Default').toLowerCase() === cleanName.toLowerCase()
  );
  if (modelsInSub.length > 0) {
    throw new Error(
      `Cannot delete sub-library "${cleanName}": it contains ${modelsInSub.length} model(s). Move or delete its models first.`
    );
  }

  if (bridgeClient.isConnected()) {
    const libPath =
      (typeof localStorage !== 'undefined'
        ? localStorage.getItem('abd_axionikdb_path')
        : null) || 'd:\\desarrollos\\ABDSynths\\AxionikDB';
    await bridgeClient.deleteSublibrary(libPath, cleanName);
  }

  svc.sublibraries = svc.sublibraries.filter((s) => s.name.toLowerCase() !== cleanName.toLowerCase());
  svc.persistSublibraries();
}


/**
 * Transfers a model to another sub-library and recalculates ordinal positions.
 */
export async function moveModelToSublibrary(svc: BankService, slugOrSlot: string | number, targetSublibrary: string): Promise<void> {
  const targetSub = targetSublibrary.trim() || 'Default';
  const model = svc.generatedModels.find((m) => m.slug === slugOrSlot || m.slot === slugOrSlot);
  if (!model) throw new Error(`Model not found: ${slugOrSlot}`);

  const sourceSub = model.sublibrary || 'Default';
  if (sourceSub === targetSub) return;

  if (model.slug && bridgeClient.isConnected()) {
    try {
      const libPath =
        (typeof localStorage !== 'undefined'
          ? localStorage.getItem('abd_axionikdb_path')
          : null) || 'd:\\desarrollos\\ABDSynths\\AxionikDB';
      await bridgeClient.moveAxionikModel(libPath, model.slug, targetSub, sourceSub);
    } catch (err) {
      console.warn('Bridge moveAxionikModel error:', err);
    }
  }

  model.sublibrary = targetSub;
  const targetModels = svc.generatedModels.filter((m) => (m.sublibrary || 'Default') === targetSub);
  model.sublibraryOrdinal = targetModels.length;
  svc.persistBank();
}


/**
 * Reorders models within a sub-library, assigning sequential contiguous ordinals (1, 2, 3...).
 */
export async function reorderModelsInSublibrary(svc: BankService, 
  sublibrary: string,
  orderedSlugsOrSlots: Array<string | number>
): Promise<void> {
  const sub = sublibrary.trim() || 'Default';
  const slugs: string[] = [];

  orderedSlugsOrSlots.forEach((id, idx) => {
    const model = svc.generatedModels.find((m) => m.slug === id || m.slot === id);
    if (model && (model.sublibrary || 'Default') === sub) {
      model.sublibraryOrdinal = idx + 1;
      if (model.slug) slugs.push(model.slug);
    }
  });

  if (slugs.length > 0 && bridgeClient.isConnected()) {
    try {
      const libPath =
        (typeof localStorage !== 'undefined'
          ? localStorage.getItem('abd_axionikdb_path')
          : null) || 'd:\\desarrollos\\ABDSynths\\AxionikDB';
      await bridgeClient.reorderSublibrary(libPath, sub, slugs);
    } catch (err) {
      console.warn('Bridge reorderSublibrary error:', err);
    }
  }

  svc.persistBank();
}

