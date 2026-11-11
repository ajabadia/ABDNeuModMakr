// ─────────────────────────────────────────────────────────
// ABDShared — CloudByokClient (Bring Your Own Key)
// Transversal cloud AI client for the ABDSynths suite.
//
// STRICT PRIVACY GUARANTEE:
//   - Stored in client browser localStorage or sessionStorage.
//   - NEVER sent to, routed through, or stored on any ABDSynths server.
//   - Outbound requests connect directly to official endpoints.
// ─────────────────────────────────────────────────────────

export type CloudAiProvider =
  | 'replicate'
  | 'huggingface'
  | 'gemini'
  | 'openai'
  | 'claude'
  | 'openrouter'
  | 'deepseek'
  | 'groq'
  | 'mistral';

export type ByokStorageScope = 'local' | 'session';

export interface ByokConfig {
  enabled: boolean;
  provider: CloudAiProvider;
  storageScope?: ByokStorageScope;
  replicateToken?: string;
  huggingfaceToken?: string;
  geminiApiKey?: string;
  openaiApiKey?: string;
  claudeApiKey?: string;
  openrouterApiKey?: string;
  deepseekApiKey?: string;
  groqApiKey?: string;
  mistralApiKey?: string;
  preferredCloudModel?: 'audiosr' | 'demucs';
}

export interface CloudTextGenerationOptions {
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  model?: string;
  provider?: CloudAiProvider;
  jsonMode?: boolean;
  signal?: AbortSignal;
  inlineData?: { mimeType: string; base64: string };
}

export interface CloudTextGenerationResult {
  text: string;
  provider: CloudAiProvider;
  model: string;
  finishReason?: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

export interface CloudByokClientOptions {
  storageScope?: ByokStorageScope;
  allowedCapabilities?: Array<'text' | 'vision' | 'image' | 'audio'>;
}

export const SHARED_STORAGE_KEY_BYOK = 'abdsynths.ai.byok.v1';
export const LEGACY_STORAGE_KEY_BYOK = 'neumodmakr_byok_config';

export function parseJsonObjectSafe<T = Record<string, unknown>>(rawText: string): T | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  try {
    const direct = JSON.parse(trimmed) as unknown;
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
      return direct as T;
    }
  } catch {}

  const mdMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (mdMatch && mdMatch[1]) {
    try {
      const parsed = JSON.parse(mdMatch[1].trim()) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as T;
      }
    } catch {}
  }

  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as T;
      }
    } catch {
      return null;
    }
  }

  return null;
}

export function redactUrlForLog(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    const idx = rawUrl.indexOf('?');
    return idx >= 0 ? rawUrl.slice(0, idx) : rawUrl;
  }
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 30000
): Promise<Response> {
  const eventTarget = init.signal;
  const ctrl = new AbortController();
  const onAbort = (): void => {
    ctrl.abort((eventTarget as AbortSignal | undefined)?.reason);
  };
  eventTarget?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    ctrl.abort(new Error(`AI request timed out after ${timeoutMs}ms: ${redactUrlForLog(url)}`));
  }, timeoutMs);
  try {
    return await globalThis.fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
    eventTarget?.removeEventListener('abort', onAbort);
  }
}

export async function safeErrorSnippet(res: Response, maxChars = 300): Promise<string> {
  try {
    const text = await res.text();
    return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
  } catch {
    return '';
  }
}

export const DEFAULT_BYOK_CONFIG: ByokConfig = {
  enabled: false,
  provider: 'gemini',
  storageScope: 'local',
};

export class CloudByokClient {
  private config: ByokConfig = { ...DEFAULT_BYOK_CONFIG };
  private allowedCapabilities: Set<string>;

  constructor(options: CloudByokClientOptions = {}) {
    if (options.storageScope) {
      this.config.storageScope = options.storageScope;
    }
    this.allowedCapabilities = new Set(options.allowedCapabilities ?? ['text', 'vision', 'image', 'audio']);
    this.loadFromStorage();
  }

  public getStorageScope(): ByokStorageScope {
    return this.config.storageScope ?? 'local';
  }

  public setStorageScope(scope: ByokStorageScope): void {
    const prevScope = this.getStorageScope();
    this.config.storageScope = scope;
    if (typeof localStorage !== 'undefined' && typeof sessionStorage !== 'undefined') {
      if (prevScope === 'local' && scope === 'session') {
        localStorage.removeItem(SHARED_STORAGE_KEY_BYOK);
      } else if (prevScope === 'session' && scope === 'local') {
        sessionStorage.removeItem(SHARED_STORAGE_KEY_BYOK);
      }
    }
    this.saveToStorage(this.config);
  }

  public loadFromStorage(): ByokConfig {
    let raw: string | null = null;
    if (typeof sessionStorage !== 'undefined') {
      raw = sessionStorage.getItem(SHARED_STORAGE_KEY_BYOK);
    }
    if (!raw && typeof localStorage !== 'undefined') {
      raw = localStorage.getItem(SHARED_STORAGE_KEY_BYOK);
      if (!raw) {
        raw = localStorage.getItem(LEGACY_STORAGE_KEY_BYOK);
      }
    }

    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<ByokConfig>;
        this.config = { ...DEFAULT_BYOK_CONFIG, ...parsed };
      } catch {
        this.config = { ...DEFAULT_BYOK_CONFIG };
      }
    } else {
      this.config = { ...DEFAULT_BYOK_CONFIG };
    }
    return { ...this.config };
  }

  public saveToStorage(cfg: Partial<ByokConfig>): void {
    this.config = { ...this.config, ...cfg };
    const targetScope = this.getStorageScope();
    const str = JSON.stringify(this.config);
    if (targetScope === 'session' && typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(SHARED_STORAGE_KEY_BYOK, str);
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(SHARED_STORAGE_KEY_BYOK);
      }
    } else if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SHARED_STORAGE_KEY_BYOK, str);
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(SHARED_STORAGE_KEY_BYOK);
      }
    }
  }

  public clearStorage(): void {
    this.config = { ...DEFAULT_BYOK_CONFIG };
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(SHARED_STORAGE_KEY_BYOK);
      localStorage.removeItem(LEGACY_STORAGE_KEY_BYOK);
    }
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(SHARED_STORAGE_KEY_BYOK);
    }
  }

  public getConfig(): ByokConfig {
    return { ...this.config };
  }

  public isConfigured(provider?: CloudAiProvider): boolean {
    const p = provider ?? this.config.provider;
    switch (p) {
      case 'gemini': return Boolean(this.config.geminiApiKey?.trim());
      case 'openai': return Boolean(this.config.openaiApiKey?.trim());
      case 'claude': return Boolean(this.config.claudeApiKey?.trim());
      case 'openrouter': return Boolean(this.config.openrouterApiKey?.trim());
      case 'deepseek': return Boolean(this.config.deepseekApiKey?.trim());
      case 'groq': return Boolean(this.config.groqApiKey?.trim());
      case 'mistral': return Boolean(this.config.mistralApiKey?.trim());
      case 'replicate': return Boolean(this.config.replicateToken?.trim());
      case 'huggingface': return Boolean(this.config.huggingfaceToken?.trim());
      default: return false;
    }
  }

  public getActiveApiKey(provider?: CloudAiProvider): string {
    const p = provider ?? this.config.provider;
    switch (p) {
      case 'gemini': return this.config.geminiApiKey?.trim() ?? '';
      case 'openai': return this.config.openaiApiKey?.trim() ?? '';
      case 'claude': return this.config.claudeApiKey?.trim() ?? '';
      case 'openrouter': return this.config.openrouterApiKey?.trim() ?? '';
      case 'deepseek': return this.config.deepseekApiKey?.trim() ?? '';
      case 'groq': return this.config.groqApiKey?.trim() ?? '';
      case 'mistral': return this.config.mistralApiKey?.trim() ?? '';
      case 'replicate': return this.config.replicateToken?.trim() ?? '';
      case 'huggingface': return this.config.huggingfaceToken?.trim() ?? '';
      default: return '';
    }
  }

  public async generateText(
    prompt: string,
    options: CloudTextGenerationOptions = {}
  ): Promise<CloudTextGenerationResult> {
    const provider = options.provider ?? this.config.provider;
    const apiKey = this.getActiveApiKey(provider);
    if (!apiKey) {
      throw new Error(`[CloudByokClient] No API key configured for provider: ${provider}`);
    }

    switch (provider) {
      case 'gemini': return this.callGeminiText(prompt, apiKey, options);
      case 'claude': return this.callClaudeText(prompt, apiKey, options);
      case 'openai': return this.callOpenAiCompatibleText('https://api.openai.com/v1/chat/completions', prompt, apiKey, options.model ?? 'gpt-4o-mini', provider, options);
      case 'deepseek': return this.callOpenAiCompatibleText('https://api.deepseek.com/chat/completions', prompt, apiKey, options.model ?? 'deepseek-chat', provider, options);
      case 'groq': return this.callOpenAiCompatibleText('https://api.groq.com/openai/v1/chat/completions', prompt, apiKey, options.model ?? 'llama-3.3-70b-versatile', provider, options);
      case 'mistral': return this.callOpenAiCompatibleText('https://api.mistral.ai/v1/chat/completions', prompt, apiKey, options.model ?? 'mistral-small-latest', provider, options);
      case 'openrouter': return this.callOpenAiCompatibleText('https://openrouter.ai/api/v1/chat/completions', prompt, apiKey, options.model ?? 'google/gemini-2.5-flash', provider, options);
      default:
        throw new Error(`[CloudByokClient] Provider ${provider} does not support text generation directly.`);
    }
  }

  private async callGeminiText(
    prompt: string,
    apiKey: string,
    opts: CloudTextGenerationOptions
  ): Promise<CloudTextGenerationResult> {
    const model = opts.model ?? 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    const contents: any[] = [];
    if (opts.systemPrompt) {
      // Gemini v1beta supports systemInstruction
    }
    if (opts.messages && opts.messages.length > 0) {
      for (const m of opts.messages) {
        contents.push({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        });
      }
    }
    const userParts: any[] = [{ text: prompt }];
    if (opts.inlineData) {
      userParts.unshift({
        inlineData: {
          mimeType: opts.inlineData.mimeType,
          data: opts.inlineData.base64,
        },
      });
    }
    contents.push({ role: 'user', parts: userParts });

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: opts.temperature ?? 0.2,
        maxOutputTokens: opts.maxTokens ?? 2048,
        ...(opts.jsonMode ? { responseMimeType: 'application/json' } : {}),
      },
    };
    if (opts.systemPrompt) {
      body.systemInstruction = {
        parts: [{ text: opts.systemPrompt }],
      };
    }

    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    }, 45000);

    if (!res.ok) {
      const err = await safeErrorSnippet(res);
      throw new Error(`Gemini error HTTP ${res.status}: ${err}`);
    }

    const data = (await res.json()) as any;
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const finishReason = data?.candidates?.[0]?.finishReason;
    const usage = data?.usageMetadata ? {
      promptTokens: data.usageMetadata.promptTokenCount,
      completionTokens: data.usageMetadata.candidatesTokenCount,
      totalTokens: data.usageMetadata.totalTokenCount,
    } : undefined;

    return { text, provider: 'gemini', model, finishReason, usage };
  }

  private async callClaudeText(
    prompt: string,
    apiKey: string,
    opts: CloudTextGenerationOptions
  ): Promise<CloudTextGenerationResult> {
    const model = opts.model ?? 'claude-3-5-haiku-20241022';
    const url = 'https://api.anthropic.com/v1/messages';

    const messages: any[] = [];
    if (opts.messages && opts.messages.length > 0) {
      for (const m of opts.messages) {
        messages.push({ role: m.role, content: m.content });
      }
    }
    const contentParts: any[] = [];
    if (opts.inlineData) {
      contentParts.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: opts.inlineData.mimeType,
          data: opts.inlineData.base64,
        },
      });
    }
    contentParts.push({ type: 'text', text: prompt });
    messages.push({ role: 'user', content: contentParts });

    const body: Record<string, unknown> = {
      model,
      max_tokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature ?? 0.2,
      messages,
    };
    if (opts.systemPrompt) {
      body.system = opts.systemPrompt;
    }

    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'dangerously-allow-browser': 'true',
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    }, 45000);

    if (!res.ok) {
      const err = await safeErrorSnippet(res);
      throw new Error(`Claude error HTTP ${res.status}: ${err}`);
    }

    const data = (await res.json()) as any;
    const text = data?.content?.[0]?.text ?? '';
    const finishReason = data?.stop_reason;
    const usage = data?.usage ? {
      promptTokens: data.usage.input_tokens,
      completionTokens: data.usage.output_tokens,
      totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
    } : undefined;

    return { text, provider: 'claude', model, finishReason, usage };
  }

  private async callOpenAiCompatibleText(
    endpoint: string,
    prompt: string,
    apiKey: string,
    defaultModel: string,
    provider: CloudAiProvider,
    opts: CloudTextGenerationOptions
  ): Promise<CloudTextGenerationResult> {
    const model = opts.model ?? defaultModel;
    const messages: any[] = [];
    if (opts.systemPrompt) {
      messages.push({ role: 'system', content: opts.systemPrompt });
    }
    if (opts.messages && opts.messages.length > 0) {
      for (const m of opts.messages) {
        messages.push({ role: m.role, content: m.content });
      }
    }
    if (opts.inlineData) {
      messages.push({
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:${opts.inlineData.mimeType};base64,${opts.inlineData.base64}` },
          },
          { type: 'text', text: prompt },
        ],
      });
    } else {
      messages.push({ role: 'user', content: prompt });
    }

    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: opts.temperature ?? 0.2,
      max_tokens: opts.maxTokens ?? 2048,
    };
    if (opts.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    let res = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    }, 45000);

    // Fallback si response_format no estuviera soportado por el modelo especifico
    if (!res.ok && opts.jsonMode && res.status === 400) {
      delete body.response_format;
      res = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: opts.signal,
      }, 45000);
    }

    if (!res.ok) {
      const err = await safeErrorSnippet(res);
      throw new Error(`${provider} error HTTP ${res.status}: ${err}`);
    }

    const data = (await res.json()) as any;
    const text = data?.choices?.[0]?.message?.content ?? '';
    const finishReason = data?.choices?.[0]?.finish_reason;
    const usage = data?.usage ? {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens,
    } : undefined;

    return { text, provider, model, finishReason, usage };
  }

  public async testConnection(provider?: CloudAiProvider): Promise<{ ok: boolean; message: string; latencyMs: number }> {
    const p = provider ?? this.config.provider;
    const t0 = performance.now();
    try {
      const res = await this.generateText('Reply with the word OK.', {
        provider: p,
        maxTokens: 5,
        temperature: 0,
      });
      const latencyMs = Math.round(performance.now() - t0);
      return {
        ok: true,
        message: `Connected successfully to ${p} (${res.model}) in ${latencyMs}ms.`,
        latencyMs,
      };
    } catch (err: unknown) {
      const latencyMs = Math.round(performance.now() - t0);
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        message: `Connection failed: ${msg}`,
        latencyMs,
      };
    }
  }
}
