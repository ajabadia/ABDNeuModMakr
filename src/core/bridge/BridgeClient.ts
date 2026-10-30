// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Local Companion Bridge Client (Fase 10.B)
// Connects the Web Audio frontend to the local Python companion
// server (bridge/server.py) for accelerated DSP, AI outpainting,
// and direct filesystem access.
// ─────────────────────────────────────────────────────────

export interface BridgeLibraries {
  numpy: boolean;
  soundfile: boolean;
  scipy: boolean;
  torch: boolean;
}

export interface BridgeCapabilities {
  status: string;
  app: string;
  version: string;
  python: string;
  device: string;
  gpu: boolean;
  gpu_name: string;
  libraries: BridgeLibraries;
  capabilities: string[];
}

export interface BridgeStatus {
  connected: boolean;
  url: string;
  latencyMs?: number;
  capabilities?: BridgeCapabilities;
  lastChecked?: number;
  error?: string;
}

export interface BridgeScanFile {
  name: string;
  path: string;
  size: number;
  ext: string;
}

export interface BridgeScanResult {
  scanned_path: string;
  total_files: number;
  files: BridgeScanFile[];
}

export interface AxionikDbModelEntry {
  slug: string;
  name: string;
  category: string;
  parameterSet: number;
  zoneCount: number;
  complexity: number;
  hasCover: boolean;
  createdAt?: string;
  updatedAt?: string;
  folderPath: string;
}

export interface AxionikSaveFileEntry {
  path: string;
  content?: string;
  content_b64?: string;
}

export interface BridgeEnhanceOptions {
  targetSampleRate?: number;
  targetLoopSec?: number;
  capabilities?: string[];
  timeoutMs?: number;
  textPrompt?: string;
}

export interface BridgeModelInfo {
  id: string;
  name: string;
  task: string;
  filename: string;
  size_mb: number;
  description: string;
  url?: string;
  default_url?: string;
  is_custom_url?: boolean;
  installed: boolean;
  status: 'ready' | 'downloading' | 'available' | 'error' | 'idle';
  progress: number;
  downloaded_bytes?: number;
  total_bytes?: number;
  speed_mbps?: number;
  error?: string | null;
}

export const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:7860';
const STORAGE_KEY_URL = 'neumodmakr_bridge_url';
const MAX_BRIDGE_URL_LENGTH = 500;

/** S4.1: la URL del bridge es entrada no confiable (localStorage/UI). Solo http(s), sin credenciales. */
export function validateBridgeUrl(v: unknown): string {
  const fallback = DEFAULT_BRIDGE_URL;
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'string') throw new Error('Invalid bridge URL: must be a string');
  const t = v.trim();
  if (t.length === 0) return fallback;
  if (t.length > MAX_BRIDGE_URL_LENGTH) throw new Error(`Invalid bridge URL: too long (max ${MAX_BRIDGE_URL_LENGTH})`);
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    throw new Error('Invalid bridge URL: must be a valid http(s) URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Invalid bridge URL: only http(s) allowed');
  }
  if (u.username || u.password) throw new Error('Invalid bridge URL: credentials in URL are blocked');
  return t.replace(/\/+$/, '');
}

export type BridgeStatusListener = (status: BridgeStatus) => void;

const STORAGE_KEY_TOKEN = 'neumodmakr_bridge_token';

export class BridgeClient {
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

  private authHeaders(base: Record<string, string> = {}): Record<string, string> {
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

  /**
   * Queries the companion bridge to scan a local filesystem path for models, soundfonts, and samples.
   */
  public async scanLocalFiles(targetPath: string, timeoutMs = 8000): Promise<BridgeScanResult> {
    if (!this.currentStatus.connected) {
      throw new Error('Local companion bridge is offline.');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = `${this.url}/api/fs/scan?path=${encodeURIComponent(targetPath)}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: this.authHeaders({ Accept: 'application/json' }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        throw new Error(`Filesystem scan failed (HTTP ${res.status})`);
      }
      return (await res.json()) as BridgeScanResult;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Sends audio bytes to the bridge for high-fidelity 24/96k sinc resampling,
   * BWE harmonic expansion, and organic loop outpainting.
   */
  public async enhanceAudio(
    audioData: Uint8Array | ArrayBuffer,
    options: BridgeEnhanceOptions = {}
  ): Promise<Uint8Array> {
    if (!this.currentStatus.connected) {
      throw new Error('Local companion bridge is offline.');
    }

    const targetSr = options.targetSampleRate ?? 96000;
    const targetLoopSec = options.targetLoopSec ?? 0.0;
    const caps = options.capabilities ?? ['resample-96k', 'harmonic-bwe', 'loop-expansion'];
    const timeoutMs = options.timeoutMs ?? 30000;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const endpoint = `${this.url}/api/enhance`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: this.authHeaders({
          'Content-Type': 'audio/wav',
          'X-Target-Sample-Rate': String(targetSr),
          'X-Target-Loop-Sec': String(targetLoopSec),
          'X-Capabilities': caps.join(','),
          ...(options.textPrompt ? { 'X-Text-Prompt': options.textPrompt } : {}),
        }),
        body: audioData instanceof Uint8Array ? (audioData.buffer as ArrayBuffer) : audioData,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Audio enhancement failed (HTTP ${res.status}): ${errText}`);
      }

      const buffer = await res.arrayBuffer();
      return new Uint8Array(buffer);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Fetches the registered AI models, their local installation status and download progress.
   */
  public async getModels(timeoutMs = 5000): Promise<BridgeModelInfo[]> {
    if (!this.currentStatus.connected) {
      return [];
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.url}/api/models`, {
        method: 'GET',
        headers: this.authHeaders({ Accept: 'application/json' }),
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
  public async downloadModel(modelId: string, timeoutMs = 5000): Promise<{ status: string }> {
    if (!this.currentStatus.connected) {
      throw new Error('Local companion bridge is offline.');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.url}/api/models/download`, {
        method: 'POST',
        headers: this.authHeaders({
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
    if (!this.currentStatus.connected) {
      return { model_id: modelId, status: 'offline', progress: 0 };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.url}/api/models/progress?model_id=${encodeURIComponent(modelId)}`, {
        method: 'GET',
        headers: this.authHeaders({ Accept: 'application/json' }),
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
  public async ensureModelInstalled(
    modelId: string,
    onProgress?: (progress: number, downloadedMb: number, totalMb: number, speedMbps: number) => void
  ): Promise<boolean> {
    if (!this.currentStatus.connected) {
      throw new Error('Local companion bridge is offline.');
    }
    const models = await this.getModels();
    const model = models.find((m) => m.id === modelId);
    if (model?.installed) {
      return true;
    }

    if (model?.status !== 'downloading') {
      await this.downloadModel(modelId);
    }

    return new Promise((resolve, reject) => {
      const poll = setInterval(async () => {
        try {
          const prog = await this.getModelProgress(modelId);
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
  public async deleteModel(modelId: string, timeoutMs = 5000): Promise<{ status: string; freed_mb?: number }> {
    if (!this.currentStatus.connected) {
      throw new Error('Local companion bridge is offline.');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.url}/api/models/delete`, {
        method: 'POST',
        headers: this.authHeaders({
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
  public async updateModelUrl(
    modelId: string,
    newUrl: string,
    timeoutMs = 5000
  ): Promise<{ status: string; url: string; is_custom_url: boolean }> {
    if (!this.currentStatus.connected) {
      throw new Error('Local companion bridge is offline.');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.url}/api/models/url`, {
        method: 'POST',
        headers: this.authHeaders({
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
  public async checkModelUrl(
    testUrl: string,
    timeoutMs = 8000
  ): Promise<{ reachable: boolean; status_code?: number; size_bytes?: number; error?: string }> {
    if (!testUrl || !/^https?:\/\//i.test(testUrl.trim())) {
      return { reachable: false, error: 'URL must begin with http:// or https://' };
    }

    if (this.currentStatus.connected) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(`${this.url}/api/models/check_url`, {
          method: 'POST',
          headers: this.authHeaders({
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

  /**
   * Scans an AxionikDB directory for modern models.
   */
  public async scanAxionikDb(libraryPath: string, timeoutMs = 10000): Promise<AxionikDbModelEntry[]> {
    if (!this.currentStatus.connected) {
      throw new Error('Local companion bridge is offline.');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.url}/api/fs/scan_axionik?path=${encodeURIComponent(libraryPath)}`, {
        method: 'GET',
        headers: this.authHeaders({ Accept: 'application/json' }),
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
  public async saveAxionikModel(
    libraryPath: string,
    slug: string,
    files: AxionikSaveFileEntry[],
    timeoutMs = 30000
  ): Promise<{ status: string; slug: string; folder: string; files_written: number }> {
    if (!this.currentStatus.connected) {
      throw new Error('Local companion bridge is offline.');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.url}/api/fs/save_axionik_model`, {
        method: 'POST',
        headers: this.authHeaders({
          'Content-Type': 'application/json',
          Accept: 'application/json',
        }),
        body: JSON.stringify({
          library_path: libraryPath,
          slug,
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
   * Duplicates an existing Axionik model into a new slug and updates manifest.
   */
  public async duplicateAxionikModel(
    libraryPath: string,
    sourceSlug: string,
    newSlug: string,
    newName: string,
    timeoutMs = 15000
  ): Promise<{ status: string; source_slug: string; new_slug: string; dest_dir: string }> {
    if (!this.currentStatus.connected) {
      throw new Error('Local companion bridge is offline.');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.url}/api/fs/duplicate_axionik_model`, {
        method: 'POST',
        headers: this.authHeaders({
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
  public async renameAxionikModel(
    libraryPath: string,
    oldSlug: string,
    newSlug: string,
    newName: string,
    timeoutMs = 10000
  ): Promise<{ status: string; old_slug: string; new_slug: string; folder: string }> {
    if (!this.currentStatus.connected) {
      throw new Error('Local companion bridge is offline.');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.url}/api/fs/rename_axionik_model`, {
        method: 'POST',
        headers: this.authHeaders({
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
}

/** Global singleton instance for the application */
export const bridgeClient = new BridgeClient();
