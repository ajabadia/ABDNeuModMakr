// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Fase 42.5: Bridge Models
// gestión de modelos IA (lista, descarga, progreso, URL)
// Funciones puras de dominio: reciben el núcleo ('BridgeCore') y no
// dependen del estado interno de 'BridgeClient'.
// ─────────────────────────────────────────────────────────

import { type BridgeCore, type BridgeModelInfo } from './bridgeTypes.ts';

/**
 * Fetches the registered AI models, their local installation status and download progress.
 */
export async function getModels(core: BridgeCore, timeoutMs = 5000): Promise<BridgeModelInfo[]> {
  if (!core.isConnected()) {
    return [];
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${core.getUrl()}/api/models`, {
      method: 'GET',
      headers: core.authHeaders({ Accept: 'application/json' }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: BridgeModelInfo[] };
    return data.models ?? [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}


/**
 * Triggers background download of an AI model checkpoint in the companion bridge.
 */
export async function downloadModel(core: BridgeCore, modelId: string, timeoutMs = 5000): Promise<{ status: string }> {
  if (!core.isConnected()) {
    throw new Error('Local companion bridge is offline.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${core.getUrl()}/api/models/download`, {
      method: 'POST',
      headers: core.authHeaders({
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
      body: JSON.stringify({ model_id: modelId }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      throw new Error(`Download request failed (HTTP ${res.status})`);
    }
    return (await res.json()) as { status: string };
  } finally {
    clearTimeout(timer);
  }
}


/**
 * Queries download progress for a specific model ID.
 */
export async function getModelProgress(core: BridgeCore, 
  modelId: string,
  timeoutMs = 3000
): Promise<{
  model_id: string;
  status: string;
  progress: number;
  downloaded_bytes?: number;
  total_bytes?: number;
  speed_mbps?: number;
  error?: string | null;
}> {
  if (!core.isConnected()) {
    return { model_id: modelId, status: 'offline', progress: 0 };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${core.getUrl()}/api/models/progress?model_id=${encodeURIComponent(modelId)}`, {
      method: 'GET',
      headers: core.authHeaders({ Accept: 'application/json' }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { model_id: modelId, status: 'error', progress: 0 };
    return (await res.json()) as {
      model_id: string;
      status: string;
      progress: number;
      downloaded_bytes?: number;
      total_bytes?: number;
      speed_mbps?: number;
      error?: string | null;
    };
  } catch {
    return { model_id: modelId, status: 'error', progress: 0 };
  } finally {
    clearTimeout(timer);
  }
}


/**
 * Transparently ensures a model is installed on the local disk.
 * If not installed, automatically triggers background downloading and monitors progress.
 */
export async function ensureModelInstalled(core: BridgeCore, 
  modelId: string,
  onProgress?: (progress: number, downloadedMb: number, totalMb: number, speedMbps: number) => void
): Promise<boolean> {
  if (!core.isConnected()) {
    throw new Error('Local companion bridge is offline.');
  }
  const models = await getModels(core, );
  const model = models.find((m) => m.id === modelId);
  if (model?.installed) {
    return true;
  }

  if (model?.status !== 'downloading') {
    await downloadModel(core, modelId);
  }

  return new Promise((resolve, reject) => {
    const poll = setInterval(async () => {
      try {
        const prog = await getModelProgress(core, modelId);
        const dlMb = Math.round((prog.downloaded_bytes ?? 0) / (1024 * 1024));
        const totMb = Math.round((prog.total_bytes ?? 0) / (1024 * 1024));
        onProgress?.(prog.progress, dlMb, totMb, prog.speed_mbps ?? 0);

        if (prog.status === 'ready' || (prog.progress >= 100 && prog.status !== 'error')) {
          clearInterval(poll);
          resolve(true);
        } else if (prog.status === 'error') {
          clearInterval(poll);
          reject(new Error(prog.error || `Error downloading model ${modelId}`));
        }
      } catch {
        // ignore transient poll network hiccups
      }
    }, 1000);
  });
}


/**
 * Deletes a downloaded model checkpoint from disk to free up local storage.
 */
export async function deleteModel(core: BridgeCore, modelId: string, timeoutMs = 5000): Promise<{ status: string; freed_mb?: number }> {
  if (!core.isConnected()) {
    throw new Error('Local companion bridge is offline.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${core.getUrl()}/api/models/delete`, {
      method: 'POST',
      headers: core.authHeaders({
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
      body: JSON.stringify({ model_id: modelId }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const errData = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(errData.error || `HTTP ${res.status}`);
    }
    return (await res.json()) as { status: string; freed_mb?: number };
  } finally {
    clearTimeout(timer);
  }
}


/**
 * Sets or resets a custom download URL for an AI model checkpoint.
 */
export async function updateModelUrl(core: BridgeCore, 
  modelId: string,
  newUrl: string,
  timeoutMs = 5000
): Promise<{ status: string; url: string; is_custom_url: boolean }> {
  if (!core.isConnected()) {
    throw new Error('Local companion bridge is offline.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${core.getUrl()}/api/models/url`, {
      method: 'POST',
      headers: core.authHeaders({
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
      body: JSON.stringify({ model_id: modelId, url: newUrl }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const errData = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(errData.error || `HTTP ${res.status}`);
    }
    return (await res.json()) as { status: string; url: string; is_custom_url: boolean };
  } finally {
    clearTimeout(timer);
  }
}


/**
 * Tests whether a model download URL is valid and reachable.
 */
export async function checkModelUrl(core: BridgeCore, 
  testUrl: string,
  timeoutMs = 8000
): Promise<{ reachable: boolean; status_code?: number; size_bytes?: number; error?: string }> {
  if (!testUrl || !/^https?:\/\//i.test(testUrl.trim())) {
    return { reachable: false, error: 'URL must begin with http:// or https://' };
  }

  if (core.isConnected()) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${core.getUrl()}/api/models/check_url`, {
        method: 'POST',
        headers: core.authHeaders({
          'Content-Type': 'application/json',
          Accept: 'application/json',
        }),
        body: JSON.stringify({ url: testUrl }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        return (await res.json()) as { reachable: boolean; status_code?: number; size_bytes?: number; error?: string };
      }
    } catch {
      clearTimeout(timer);
    }
  }

  // Direct browser fetch check fallback
  try {
    const resp = await fetch(testUrl, { method: 'HEAD', mode: 'cors' });
    const sizeHeader = resp.headers.get('content-length');
    const sizeBytes = sizeHeader ? parseInt(sizeHeader, 10) : undefined;
    return {
      reachable: resp.ok || resp.status === 200 || resp.status === 206,
      status_code: resp.status,
      size_bytes: Number.isNaN(sizeBytes) ? undefined : sizeBytes,
    };
  } catch (err) {
    return { reachable: false, error: String(err) };
  }
}
