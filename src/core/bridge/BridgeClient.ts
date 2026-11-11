// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Local Companion Bridge Client (Fase 10.B)
// Connects the Web Audio frontend to the local Python companion
// server (bridge/server.py) for accelerated DSP, AI outpainting,
// and direct filesystem access.
// ─────────────────────────────────────────────────────────

import { type BridgeCore, type BridgeStatus, type BridgeStatusListener, type BridgeCapabilities, type BridgeScanResult, type AxionikDbModelEntry, type SublibraryInfo, type AxionikSaveFileEntry, type StemSeparationResult, type PhonemeAlignmentResult, type BridgeMemoryStatus, type BridgeEnhanceOptions, type BridgeModelInfo } from './bridgeTypes.ts';
import { DEFAULT_BRIDGE_URL, validateBridgeUrl } from './bridgeTypes.ts';
const STORAGE_KEY_URL = 'neumodmakr_bridge_url';
export type { BridgeLibraries, BridgeCapabilities, BridgeStatus, BridgeScanFile, BridgeScanResult, AxionikDbModelEntry, SublibraryInfo, AxionikSaveFileEntry, StemSeparationResult, PhonemeWord, PhonemeAlignmentResult, BridgeMemoryStatus, BridgeEnhanceOptions, BridgeModelInfo, BridgeStatusListener } from './bridgeTypes.ts';
export { DEFAULT_BRIDGE_URL, validateBridgeUrl } from './bridgeTypes.ts';
import { scanLocalFiles, enhanceAudio, decodeRx2Audio, separateStems, alignPhonemes, getMemoryStatus, clearMemoryCache } from './bridgeAudio.ts';
import { getModels, downloadModel, getModelProgress, ensureModelInstalled, deleteModel, updateModelUrl, checkModelUrl } from './bridgeModels.ts';
import { browseLocalFolder, scanAxionikDb, saveAxionikModel, listSublibraries, createSublibrary, deleteSublibrary, moveAxionikModel, reorderSublibrary, duplicateAxionikModel, renameAxionikModel } from './bridgeLibrary.ts';

const STORAGE_KEY_TOKEN = 'neumodmakr_bridge_token';

export class BridgeClient implements BridgeCore {
  private url: string;
  private currentStatus: BridgeStatus;
  private listeners = new Set<BridgeStatusListener>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private inFlightCheck: Promise<BridgeStatus> | null = null;

  constructor(initialUrl?: string) {
    if (initialUrl) {
      this.url = validateBridgeUrl(initialUrl);
    } else if (typeof localStorage !== 'undefined') {
      try {
        this.url = validateBridgeUrl(localStorage.getItem(STORAGE_KEY_URL) || DEFAULT_BRIDGE_URL);
      } catch {
        this.url = DEFAULT_BRIDGE_URL;
      }
    } else {
      this.url = DEFAULT_BRIDGE_URL;
    }

    this.currentStatus = {
      connected: false,
      url: this.url,
      lastChecked: 0,
    };
  }

  public getUrl(): string {
    return this.url;
  }

  public setBridgeToken(token: string): void {
    if (typeof localStorage !== 'undefined') {
      if (token.trim().length > 0) localStorage.setItem(STORAGE_KEY_TOKEN, token.trim());
      else localStorage.removeItem(STORAGE_KEY_TOKEN);
    }
  }

  public getBridgeToken(): string {
    try {
      return typeof localStorage !== 'undefined' ? (localStorage.getItem(STORAGE_KEY_TOKEN) ?? '') : '';
    } catch {
      return '';
    }
  }

  /** @internal Superficie usada por los submódulos `bridge*` vía `BridgeCore`. */
  public authHeaders(base: Record<string, string> = {}): Record<string, string> {
    try {
      const t = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY_TOKEN) : null;
      if (t && t.trim().length > 0) return { ...base, 'X-Bridge-Token': t.trim() };
    } catch { /* ignore */ }
    return base;
  }

  public setUrl(newUrl: string): void {
    const clean = validateBridgeUrl(newUrl.trim() || DEFAULT_BRIDGE_URL);
    if (clean === this.url) return;
    this.url = clean;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_URL, clean);
    }
    this.currentStatus = {
      connected: false,
      url: this.url,
      lastChecked: 0,
    };
    this.notify();
    void this.checkHealth();
  }

  public getStatus(): BridgeStatus {
    return this.currentStatus;
  }

  public isConnected(): boolean {
    return this.currentStatus.connected;
  }

  public subscribe(listener: BridgeStatusListener): () => void {
    this.listeners.add(listener);
    listener(this.currentStatus);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.currentStatus);
      } catch {
        // Safe listener execution
      }
    }
  }

  /**
   * Performs an asynchronous, non-blocking health check against the local companion bridge.
   * Employs an aggressive timeout so the UI never hangs even if the port is unreachable.
   */
  public async checkHealth(timeoutMs = 1200): Promise<BridgeStatus> {
    if (this.inFlightCheck) {
      return this.inFlightCheck;
    }

    this.inFlightCheck = (async () => {
      const start = performance.now();
      try {
        if (typeof fetch === 'undefined') {
          this.currentStatus = {
            connected: false,
            url: this.url,
            lastChecked: Date.now(),
            error: 'fetch unavailable in environment',
          };
          this.notify();
          return this.currentStatus;
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        const healthEndpoint = `${this.url}/api/health`;
        const res = await fetch(healthEndpoint, {
          method: 'GET',
          headers: this.authHeaders({ Accept: 'application/json' }),
          signal: controller.signal,
        });
        clearTimeout(timer);

        const latencyMs = Math.round(performance.now() - start);

        if (res.ok) {
          const data = (await res.json()) as BridgeCapabilities;
          this.currentStatus = {
            connected: true,
            url: this.url,
            latencyMs,
            capabilities: data,
            lastChecked: Date.now(),
          };
        } else {
          this.currentStatus = {
            connected: false,
            url: this.url,
            latencyMs,
            lastChecked: Date.now(),
            error: `HTTP ${res.status}: ${res.statusText}`,
          };
        }
      } catch (err) {
        this.currentStatus = {
          connected: false,
          url: this.url,
          lastChecked: Date.now(),
          error: err instanceof Error ? err.message : 'Bridge unreachable',
        };
      } finally {
        this.inFlightCheck = null;
        this.notify();
      }
      return this.currentStatus;
    })();

    return this.inFlightCheck;
  }

  /**
   * Starts periodic polling of the bridge status.
   * Returns a cleanup function to stop polling.
   */
  public startAutoPolling(intervalMs = 10000): () => void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }
    void this.checkHealth();
    this.pollTimer = setInterval(() => {
      void this.checkHealth();
    }, Math.max(3000, intervalMs));

    return () => {
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
    };
  }

  public stopAutoPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }


  // ── Delegación Fase 42.5: Audio/DSP (bridgeAudio.ts) ──
  public async scanLocalFiles(targetPath: string, timeoutMs = 8000): Promise<BridgeScanResult> {
    return scanLocalFiles(this, targetPath, timeoutMs);
  }

  public async enhanceAudio(
    audioData: Uint8Array | ArrayBuffer,
    options: BridgeEnhanceOptions = {}
  ): Promise<Uint8Array> {
    return enhanceAudio(this, audioData, options);
  }

  public async decodeRx2Audio(
    rx2Buffer: ArrayBuffer,
    filename = 'loop.rx2',
    timeoutMs = 15000
  ): Promise<{ wavBuffer: ArrayBuffer; info: any; decodedFrames: number }> {
    return decodeRx2Audio(this, rx2Buffer, filename, timeoutMs);
  }

  public async separateStems(
    audioBuffer: ArrayBuffer,
    options?: { stems?: string[]; filename?: string; timeoutMs?: number }
  ): Promise<StemSeparationResult> {
    return separateStems(this, audioBuffer, options);
  }

  public async alignPhonemes(
    audioBuffer: ArrayBuffer,
    options?: { filename?: string; timeoutMs?: number }
  ): Promise<PhonemeAlignmentResult> {
    return alignPhonemes(this, audioBuffer, options);
  }

  public async getMemoryStatus(timeoutMs = 5000): Promise<BridgeMemoryStatus | null> {
    return getMemoryStatus(this, timeoutMs);
  }

  public async clearMemoryCache(timeoutMs = 5000): Promise<BridgeMemoryStatus | null> {
    return clearMemoryCache(this, timeoutMs);
  }


  // ── Delegación Fase 42.5: Modelos IA (bridgeModels.ts) ──
  public async getModels(timeoutMs = 5000): Promise<BridgeModelInfo[]> {
    return getModels(this, timeoutMs);
  }

  public async downloadModel(modelId: string, timeoutMs = 5000): Promise<{ status: string }> {
    return downloadModel(this, modelId, timeoutMs);
  }

  public async getModelProgress(
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
    return getModelProgress(this, modelId, timeoutMs);
  }

  public async ensureModelInstalled(
    modelId: string,
    onProgress?: (progress: number, downloadedMb: number, totalMb: number, speedMbps: number) => void
  ): Promise<boolean> {
    return ensureModelInstalled(this, modelId, onProgress);
  }

  public async deleteModel(modelId: string, timeoutMs = 5000): Promise<{ status: string; freed_mb?: number }> {
    return deleteModel(this, modelId, timeoutMs);
  }

  public async updateModelUrl(
    modelId: string,
    newUrl: string,
    timeoutMs = 5000
  ): Promise<{ status: string; url: string; is_custom_url: boolean }> {
    return updateModelUrl(this, modelId, newUrl, timeoutMs);
  }

  public async checkModelUrl(
    testUrl: string,
    timeoutMs = 8000
  ): Promise<{ reachable: boolean; status_code?: number; size_bytes?: number; error?: string }> {
    return checkModelUrl(this, testUrl, timeoutMs);
  }


  // ── Delegación Fase 42.5: Biblioteca AxionikDB (bridgeLibrary.ts) ──
  public async browseLocalFolder(
    initialPath = '',
    title = 'Seleccionar carpeta',
    timeoutMs = 120000
  ): Promise<{ status: string; path: string; cancelled: boolean; error?: string }> {
    return browseLocalFolder(this, initialPath, title, timeoutMs);
  }

  public async scanAxionikDb(libraryPath: string, timeoutMs = 10000): Promise<AxionikDbModelEntry[]> {
    return scanAxionikDb(this, libraryPath, timeoutMs);
  }

  public async saveAxionikModel(
    libraryPath: string,
    slug: string,
    files: AxionikSaveFileEntry[],
    timeoutMs = 30000,
    sublibrary = 'Default'
  ): Promise<{ status: string; slug: string; folder: string; files_written: number }> {
    return saveAxionikModel(this, libraryPath, slug, files, timeoutMs, sublibrary);
  }

  public async listSublibraries(libraryPath: string, timeoutMs = 10000): Promise<SublibraryInfo[]> {
    return listSublibraries(this, libraryPath, timeoutMs);
  }

  public async createSublibrary(
    libraryPath: string,
    name: string,
    description?: string,
    order?: number,
    timeoutMs = 10000
  ): Promise<{ status: string; name: string }> {
    return createSublibrary(this, libraryPath, name, description, order, timeoutMs);
  }

  public async deleteSublibrary(
    libraryPath: string,
    name: string,
    timeoutMs = 10000
  ): Promise<{ status: string; name: string }> {
    return deleteSublibrary(this, libraryPath, name, timeoutMs);
  }

  public async moveAxionikModel(
    libraryPath: string,
    slug: string,
    targetSublibrary: string,
    sourceSublibrary?: string,
    timeoutMs = 15000
  ): Promise<{ status: string; slug: string; target_sublibrary: string }> {
    return moveAxionikModel(this, libraryPath, slug, targetSublibrary, sourceSublibrary, timeoutMs);
  }

  public async reorderSublibrary(
    libraryPath: string,
    sublibrary: string,
    orderedSlugs: string[],
    timeoutMs = 10000
  ): Promise<{ status: string; sublibrary: string; reordered: number }> {
    return reorderSublibrary(this, libraryPath, sublibrary, orderedSlugs, timeoutMs);
  }

  public async duplicateAxionikModel(
    libraryPath: string,
    sourceSlug: string,
    newSlug: string,
    newName: string,
    timeoutMs = 15000
  ): Promise<{ status: string; source_slug: string; new_slug: string; dest_dir: string }> {
    return duplicateAxionikModel(this, libraryPath, sourceSlug, newSlug, newName, timeoutMs);
  }

  public async renameAxionikModel(
    libraryPath: string,
    oldSlug: string,
    newSlug: string,
    newName: string,
    timeoutMs = 10000
  ): Promise<{ status: string; old_slug: string; new_slug: string; folder: string }> {
    return renameAxionikModel(this, libraryPath, oldSlug, newSlug, newName, timeoutMs);
  }

  public async proxyLocalLlmRequest(req: {
    baseUrl: string;
    path: string;
    method: 'GET' | 'POST';
    body?: unknown;
    signal?: AbortSignal;
  }): Promise<{ ok: boolean; status: number; json: unknown }> {
    const res = await fetch(`${this.url}/api/local-llm/proxy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.authHeaders(),
      },
      body: JSON.stringify(req),
      signal: req.signal,
    });
    if (!res.ok) {
      return { ok: false, status: res.status, json: await res.json().catch(() => null) };
    }
    const data = (await res.json()) as { ok: boolean; status: number; json: unknown };
    return data;
  }

}

/** Global singleton instance for the application */
export const bridgeClient = new BridgeClient();
