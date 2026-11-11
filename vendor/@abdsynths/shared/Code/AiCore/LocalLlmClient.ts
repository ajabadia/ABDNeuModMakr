// ─────────────────────────────────────────────────────────
// ABDShared — LocalLlmClient (Ollama / LM Studio / Local LLM)
// Transversal local LLM client for the ABDSynths suite.
// ─────────────────────────────────────────────────────────

import { assertSafeLoopbackHttpUrl } from './ssrf';
import { fetchWithTimeout } from './CloudByokClient';

export type LocalLlmPreset = 'ollama' | 'lmstudio' | 'custom';

export interface LocalLlmConfig {
  preset: LocalLlmPreset;
  baseUrl: string;
  activeModel?: string;
  customPort?: number;
}

export interface LocalLlmGenerateOptions {
  model?: string;
  systemPrompt?: string;
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  signal?: AbortSignal;
}

export interface LocalLlmHealthResult {
  connected: boolean;
  latencyMs: number;
  models: string[];
  activeModel?: string;
  corsBlockedLikely?: boolean;
  error?: string;
}

export type CorsRelayFn = (req: {
  baseUrl: string;
  path: string;
  method: 'GET' | 'POST';
  body?: unknown;
  signal?: AbortSignal;
}) => Promise<{ ok: boolean; status: number; json: unknown }>;

export const LOCAL_LLM_STORAGE_KEY = 'abdsynths.ai.localllm.v1';

export const DEFAULT_LOCAL_LLM_CONFIG: LocalLlmConfig = {
  preset: 'ollama',
  baseUrl: 'http://127.0.0.1:11434',
};

export class LocalLlmClient {
  private config: LocalLlmConfig = { ...DEFAULT_LOCAL_LLM_CONFIG };
  private corsRelay?: CorsRelayFn;

  constructor() {
    this.loadFromStorage();
  }

  public setCorsRelay(relayFn?: CorsRelayFn): void {
    this.corsRelay = relayFn;
  }

  public loadFromStorage(): LocalLlmConfig {
    if (typeof localStorage === 'undefined') return { ...this.config };
    try {
      const raw = localStorage.getItem(LOCAL_LLM_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<LocalLlmConfig>;
        this.config = { ...DEFAULT_LOCAL_LLM_CONFIG, ...parsed };
      }
    } catch {}
    return { ...this.config };
  }

  public saveToStorage(cfg: Partial<LocalLlmConfig>): void {
    this.config = { ...this.config, ...cfg };
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LOCAL_LLM_STORAGE_KEY, JSON.stringify(this.config));
    }
  }

  public getConfig(): LocalLlmConfig {
    return { ...this.config };
  }

  public setPreset(preset: LocalLlmPreset, customPort?: number): void {
    let baseUrl = 'http://127.0.0.1:11434';
    if (preset === 'lmstudio') {
      baseUrl = 'http://127.0.0.1:1234';
    } else if (preset === 'custom' && customPort) {
      baseUrl = `http://127.0.0.1:${customPort}`;
    }
    this.saveToStorage({ preset, baseUrl, customPort });
  }

  public getEffectiveBaseUrl(): string {
    return assertSafeLoopbackHttpUrl(
      this.config.baseUrl,
      [11434, 1234, 8080, 8000, ...(this.config.customPort ? [this.config.customPort] : [])]
    );
  }

  public async checkHealthAndListModels(timeoutMs = 2500): Promise<LocalLlmHealthResult> {
    const t0 = performance.now();
    let baseUrl = '';
    try {
      baseUrl = this.getEffectiveBaseUrl();
    } catch (err: unknown) {
      return {
        connected: false,
        latencyMs: 0,
        models: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // 1. Intentar GET /v1/models (OpenAI format, supported by LM Studio and modern Ollama)
    try {
      const res = await this.performRequest({
        baseUrl,
        path: '/v1/models',
        method: 'GET',
        timeoutMs,
      });

      if (res.ok && res.json && typeof res.json === 'object') {
        const data = (res.json as { data?: Array<{ id: string }> }).data;
        const models = Array.isArray(data) ? data.map((m) => m.id).filter(Boolean) : [];
        const latencyMs = Math.round(performance.now() - t0);
        return {
          connected: true,
          latencyMs,
          models,
          activeModel: this.config.activeModel ?? models[0],
        };
      }
    } catch (err: unknown) {
      if (this.isLikelyCorsError(err)) {
        return {
          connected: false,
          latencyMs: Math.round(performance.now() - t0),
          models: [],
          corsBlockedLikely: true,
          error: 'CORS bloqueado por el servidor local. Activa Companion Bridge o define OLLAMA_ORIGINS=*',
        };
      }
    }

    // 2. Fallback a GET /api/tags (Ollama native format)
    try {
      const res = await this.performRequest({
        baseUrl,
        path: '/api/tags',
        method: 'GET',
        timeoutMs,
      });

      if (res.ok && res.json && typeof res.json === 'object') {
        const modelsRaw = (res.json as { models?: Array<{ name: string }> }).models;
        const models = Array.isArray(modelsRaw) ? modelsRaw.map((m) => m.name).filter(Boolean) : [];
        const latencyMs = Math.round(performance.now() - t0);
        return {
          connected: true,
          latencyMs,
          models,
          activeModel: this.config.activeModel ?? models[0],
        };
      }
    } catch (err: unknown) {
      if (this.isLikelyCorsError(err)) {
        return {
          connected: false,
          latencyMs: Math.round(performance.now() - t0),
          models: [],
          corsBlockedLikely: true,
          error: 'CORS bloqueado por el servidor local. Activa Companion Bridge o define OLLAMA_ORIGINS=*',
        };
      }
    }

    return {
      connected: false,
      latencyMs: Math.round(performance.now() - t0),
      models: [],
      error: `No response from local LLM at ${baseUrl}`,
    };
  }

  public async generateText(
    prompt: string,
    options: LocalLlmGenerateOptions = {}
  ): Promise<{ text: string; model: string }> {
    const baseUrl = this.getEffectiveBaseUrl();
    const model = options.model ?? this.config.activeModel;
    if (!model) {
      throw new Error(`[LocalLlmClient] No model selected for local LLM at ${baseUrl}`);
    }

    const messages: any[] = [];
    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    if (options.messages && options.messages.length > 0) {
      for (const m of options.messages) {
        messages.push({ role: m.role, content: m.content });
      }
    }
    messages.push({ role: 'user', content: prompt });

    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: options.temperature ?? 0.2,
      ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
      ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    };

    // 1. Try /v1/chat/completions
    try {
      const res = await this.performRequest({
        baseUrl,
        path: '/v1/chat/completions',
        method: 'POST',
        body,
        signal: options.signal,
        timeoutMs: 60000,
      });

      if (res.ok && res.json && typeof res.json === 'object') {
        const data = res.json as any;
        const text = data?.choices?.[0]?.message?.content ?? '';
        return { text, model };
      }
    } catch (err: unknown) {
      if (this.isLikelyCorsError(err)) {
        throw new Error('CORS bloqueado al conectar con LLM local. Inicia Companion Bridge o inicia Ollama con OLLAMA_ORIGINS=*');
      }
    }

    // 2. Fallback to Ollama native /api/chat if /v1/chat/completions fails
    const ollamaBody = {
      model,
      messages,
      stream: false,
      options: {
        temperature: options.temperature ?? 0.2,
      },
      ...(options.jsonMode ? { format: 'json' } : {}),
    };

    const res2 = await this.performRequest({
      baseUrl,
      path: '/api/chat',
      method: 'POST',
      body: ollamaBody,
      signal: options.signal,
      timeoutMs: 60000,
    });

    if (!res2.ok) {
      throw new Error(`Local LLM error (status ${res2.status})`);
    }

    const data2 = res2.json as any;
    const text2 = data2?.message?.content ?? '';
    return { text: text2, model };
  }

  private async performRequest(params: {
    baseUrl: string;
    path: string;
    method: 'GET' | 'POST';
    body?: unknown;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<{ ok: boolean; status: number; json: unknown }> {
    const fullUrl = `${params.baseUrl}${params.path}`;
    try {
      const res = await fetchWithTimeout(
        fullUrl,
        {
          method: params.method,
          headers: {
            'Content-Type': 'application/json',
          },
          body: params.body ? JSON.stringify(params.body) : undefined,
          signal: params.signal,
        },
        params.timeoutMs ?? 15000
      );
      const json = await res.json().catch(() => null);
      return { ok: res.ok, status: res.status, json };
    } catch (fetchErr: unknown) {
      // Si falla y hay relay disponible, reintentar por relay
      if (this.corsRelay) {
        return await this.corsRelay({
          baseUrl: params.baseUrl,
          path: params.path,
          method: params.method,
          body: params.body,
          signal: params.signal,
        });
      }
      throw fetchErr;
    }
  }

  private isLikelyCorsError(err: unknown): boolean {
    if (typeof window === 'undefined') return false;
    const h = window.location.hostname.toLowerCase();
    const isLocalHost = h === '127.0.0.1' || h === 'localhost';
    if (!isLocalHost && err instanceof TypeError) {
      return true;
    }
    return false;
  }
}
