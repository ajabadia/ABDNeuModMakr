// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Fase 42.5: Bridge Library
// biblioteca AxionikDB en disco (scan, save, sub-bibliotecas)
// Funciones puras de dominio: reciben el núcleo ('BridgeCore') y no
// dependen del estado interno de 'BridgeClient'.
// ─────────────────────────────────────────────────────────

import { type BridgeCore, type AxionikDbModelEntry, type SublibraryInfo, type AxionikSaveFileEntry } from './bridgeTypes.ts';

/**
 * Opens the native OS folder selection dialog via Companion Bridge and returns the chosen path.
 */
export async function browseLocalFolder(core: BridgeCore, 
  initialPath = '',
  title = 'Seleccionar carpeta',
  timeoutMs = 120000
): Promise<{ status: string; path: string; cancelled: boolean; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${core.getUrl()}/api/fs/browse_folder`, {
      method: 'POST',
      headers: core.authHeaders({
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
      body: JSON.stringify({ path: initialPath, title }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return (await res.json()) as { status: string; path: string; cancelled: boolean; error?: string };
  } finally {
    clearTimeout(timer);
  }
}


/**
 * Scans an AxionikDB directory for modern models.
 */
export async function scanAxionikDb(core: BridgeCore, libraryPath: string, timeoutMs = 10000): Promise<AxionikDbModelEntry[]> {
  if (!core.isConnected()) {
    throw new Error('Local companion bridge is offline.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${core.getUrl()}/api/fs/scan_axionik?path=${encodeURIComponent(libraryPath)}`, {
      method: 'GET',
      headers: core.authHeaders({ Accept: 'application/json' }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = (await res.json()) as { models?: AxionikDbModelEntry[] };
    return data.models ?? [];
  } finally {
    clearTimeout(timer);
  }
}


/**
 * Saves model files to AxionikDB/Models/<slug> on local disk via Bridge.
 */
export async function saveAxionikModel(core: BridgeCore, 
  libraryPath: string,
  slug: string,
  files: AxionikSaveFileEntry[],
  timeoutMs = 30000,
  sublibrary = 'Default'
): Promise<{ status: string; slug: string; folder: string; files_written: number }> {
  if (!core.isConnected()) {
    throw new Error('Local companion bridge is offline.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${core.getUrl()}/api/fs/save_axionik_model`, {
      method: 'POST',
      headers: core.authHeaders({
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
      body: JSON.stringify({
        library_path: libraryPath,
        slug,
        sublibrary,
        files,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const errData = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(errData.error || `HTTP ${res.status}`);
    }
    return (await res.json()) as { status: string; slug: string; folder: string; files_written: number };
  } finally {
    clearTimeout(timer);
  }
}


/**
 * Lists all hierarchical sub-libraries in the AxionikDB repository.
 */
export async function listSublibraries(core: BridgeCore, libraryPath: string, timeoutMs = 10000): Promise<SublibraryInfo[]> {
  if (!core.isConnected()) {
    throw new Error('Local companion bridge is offline.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${core.getUrl()}/api/fs/list_sublibraries?path=${encodeURIComponent(libraryPath)}`, {
      method: 'GET',
      headers: core.authHeaders({ Accept: 'application/json' }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = (await res.json()) as { sublibraries?: SublibraryInfo[] };
    return data.sublibraries ?? [{ name: 'Default', description: 'Default root sub-library', order: 1, modelCount: 0, isDefault: true }];
  } finally {
    clearTimeout(timer);
  }
}


/**
 * Creates a new hierarchical sub-library on disk with optional metadata.
 */
export async function createSublibrary(core: BridgeCore, 
  libraryPath: string,
  name: string,
  description?: string,
  order?: number,
  timeoutMs = 10000
): Promise<{ status: string; name: string }> {
  if (!core.isConnected()) {
    throw new Error('Local companion bridge is offline.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${core.getUrl()}/api/fs/create_sublibrary`, {
      method: 'POST',
      headers: core.authHeaders({
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
      body: JSON.stringify({
        library_path: libraryPath,
        name,
        description,
        order,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const errData = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(errData.error || `HTTP ${res.status}`);
    }
    return (await res.json()) as { status: string; name: string };
  } finally {
    clearTimeout(timer);
  }
}


/**
 * Deletes an empty sub-library. Rejects with an error if it contains models (strict safety rule).
 */
export async function deleteSublibrary(core: BridgeCore, 
  libraryPath: string,
  name: string,
  timeoutMs = 10000
): Promise<{ status: string; name: string }> {
  if (!core.isConnected()) {
    throw new Error('Local companion bridge is offline.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${core.getUrl()}/api/fs/delete_sublibrary`, {
      method: 'POST',
      headers: core.authHeaders({
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
      body: JSON.stringify({
        library_path: libraryPath,
        name,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const errData = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(errData.error || `HTTP ${res.status}`);
    }
    return (await res.json()) as { status: string; name: string };
  } finally {
    clearTimeout(timer);
  }
}


/**
 * Moves a model between sub-libraries, updating folder structures and manifest metadata.
 */
export async function moveAxionikModel(core: BridgeCore, 
  libraryPath: string,
  slug: string,
  targetSublibrary: string,
  sourceSublibrary?: string,
  timeoutMs = 15000
): Promise<{ status: string; slug: string; target_sublibrary: string }> {
  if (!core.isConnected()) {
    throw new Error('Local companion bridge is offline.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${core.getUrl()}/api/fs/move_axionik_model`, {
      method: 'POST',
      headers: core.authHeaders({
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
      body: JSON.stringify({
        library_path: libraryPath,
        slug,
        target_sublibrary: targetSublibrary,
        source_sublibrary: sourceSublibrary,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const errData = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(errData.error || `HTTP ${res.status}`);
    }
    return (await res.json()) as { status: string; slug: string; target_sublibrary: string };
  } finally {
    clearTimeout(timer);
  }
}


/**
 * Reorders models within a sub-library, dynamically assigning contiguous ordinal indexes.
 */
export async function reorderSublibrary(core: BridgeCore, 
  libraryPath: string,
  sublibrary: string,
  orderedSlugs: string[],
  timeoutMs = 10000
): Promise<{ status: string; sublibrary: string; reordered: number }> {
  if (!core.isConnected()) {
    throw new Error('Local companion bridge is offline.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${core.getUrl()}/api/fs/reorder_sublibrary`, {
      method: 'POST',
      headers: core.authHeaders({
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
      body: JSON.stringify({
        library_path: libraryPath,
        sublibrary,
        ordered_slugs: orderedSlugs,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const errData = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(errData.error || `HTTP ${res.status}`);
    }
    return (await res.json()) as { status: string; sublibrary: string; reordered: number };
  } finally {
    clearTimeout(timer);
  }
}


/**
 * Duplicates an existing Axionik model into a new slug and updates manifest.
 */
export async function duplicateAxionikModel(core: BridgeCore, 
  libraryPath: string,
  sourceSlug: string,
  newSlug: string,
  newName: string,
  timeoutMs = 15000
): Promise<{ status: string; source_slug: string; new_slug: string; dest_dir: string }> {
  if (!core.isConnected()) {
    throw new Error('Local companion bridge is offline.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${core.getUrl()}/api/fs/duplicate_axionik_model`, {
      method: 'POST',
      headers: core.authHeaders({
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
      body: JSON.stringify({
        library_path: libraryPath,
        source_slug: sourceSlug,
        new_slug: newSlug,
        new_name: newName,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const errData = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(errData.error || `HTTP ${res.status}`);
    }
    return (await res.json()) as { status: string; source_slug: string; new_slug: string; dest_dir: string };
  } finally {
    clearTimeout(timer);
  }
}


/**
 * Renames an existing Axionik model folder / slug and updates manifest.
 */
export async function renameAxionikModel(core: BridgeCore, 
  libraryPath: string,
  oldSlug: string,
  newSlug: string,
  newName: string,
  timeoutMs = 10000
): Promise<{ status: string; old_slug: string; new_slug: string; folder: string }> {
  if (!core.isConnected()) {
    throw new Error('Local companion bridge is offline.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${core.getUrl()}/api/fs/rename_axionik_model`, {
      method: 'POST',
      headers: core.authHeaders({
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
      body: JSON.stringify({
        library_path: libraryPath,
        old_slug: oldSlug,
        new_slug: newSlug,
        new_name: newName,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const errData = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(errData.error || `HTTP ${res.status}`);
    }
    return (await res.json()) as { status: string; old_slug: string; new_slug: string; folder: string };
  } finally {
    clearTimeout(timer);
  }
}
