// ─────────────────────────────────────────────────────────
// ABDShared — CloudByokClient (Bring Your Own Key)
// Single source of truth for Cloud AI BYOK across the ABDSynths suite.
//
// STRICT PRIVACY GUARANTEE:
//   - Stored ONLY in client browser localStorage or sessionStorage.
//   - NEVER sent to, routed through, or stored on any ABDSynths server.
//   - Outbound requests connect directly from client to official endpoints.
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

export type ByokProvider = CloudAiProvider;
export type ByokStorageScope = 'local' | 'session';
export type ByokCapability = 'text' | 'image' | 'audio-cloud';

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

export type ByokKeyField =
  | 'replicateToken'
  | 'huggingfaceToken'
  | 'geminiApiKey'
  | 'openaiApiKey'
  | 'claudeApiKey'
  | 'openrouterApiKey'
  | 'deepseekApiKey'
  | 'groqApiKey'
  | 'mistralApiKey';

export interface CloudProviderMeta {
  id: CloudAiProvider;
  title: string;
  badge: string;
  keyField: ByokKeyField;
  keyTitle: string;
  keyPlaceholder: string;
  consoleUrl: string;
  capabilities: readonly ByokCapability[];
  defaultModel: string;
  summaryEs: string;
  summaryEn: string;
}

export const CLOUD_PROVIDER_METADATA: Record<CloudAiProvider, CloudProviderMeta> = {
  claude: {
    id: 'claude',
    title: 'Anthropic Claude',
    badge: 'Sonnet & Haiku',
    keyField: 'claudeApiKey',
    keyTitle: 'Anthropic Claude API Key (sk-ant-...)',
    keyPlaceholder: 'sk-ant-...',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    capabilities: ['text'],
    defaultModel: 'claude-3-5-haiku-20241022',
    summaryEs: 'Razonamiento acústico profundo, diagnóstico forense y copiloto.',
    summaryEn: 'Deep acoustic reasoning, forensic diagnosis & copilot.',
  },
  openrouter: {
    id: 'openrouter',
    title: 'OpenRouter',
    badge: 'Multi-Model',
    keyField: 'openrouterApiKey',
    keyTitle: 'OpenRouter API Key (sk-or-...)',
    keyPlaceholder: 'sk-or-...',
    consoleUrl: 'https://openrouter.ai/keys',
    capabilities: ['text', 'image'],
    defaultModel: 'openai/gpt-4o-mini',
    summaryEs: 'Pasarela universal a FLUX.1, Claude, GPT-4o, Llama y modelos abiertos.',
    summaryEn: 'Universal gateway to FLUX.1, Claude, GPT-4o, Llama & open models.',
  },
  openai: {
    id: 'openai',
    title: 'OpenAI / ChatGPT',
    badge: 'GPT-4o & DALL-E',
    keyField: 'openaiApiKey',
    keyTitle: 'OpenAI API Key (sk-...)',
    keyPlaceholder: 'sk-...',
    consoleUrl: 'https://platform.openai.com/api-keys',
    capabilities: ['text', 'image'],
    defaultModel: 'gpt-4o-mini',
    summaryEs: 'Metadatos estructurados, análisis técnico y portadas DALL-E.',
    summaryEn: 'Structured metadata, technical analysis & DALL-E artwork.',
  },
  gemini: {
    id: 'gemini',
    title: 'Google Gemini',
    badge: 'Flash & Imagen 3',
    keyField: 'geminiApiKey',
    keyTitle: 'Google Gemini API Key (AIzaSy...)',
    keyPlaceholder: 'AIzaSy...',
    consoleUrl: 'https://aistudio.google.com/app/apikey',
    capabilities: ['text', 'image'],
    defaultModel: 'gemini-2.5-flash',
    summaryEs: 'Razonamiento rápido, diagnóstico espectral y portadas con Imagen 3.',
    summaryEn: 'Fast reasoning, spectral diagnosis & Imagen 3 artwork.',
  },
  groq: {
    id: 'groq',
    title: 'Groq (LPU)',
    badge: 'LPU Real-time',
    keyField: 'groqApiKey',
    keyTitle: 'Groq API Key (gsk_...)',
    keyPlaceholder: 'gsk_...',
    consoleUrl: 'https://console.groq.com/keys',
    capabilities: ['text'],
    defaultModel: 'llama-3.1-8b-instant',
    summaryEs: 'Inferencia ultrarrápida de tokens sobre hardware LPU.',
    summaryEn: 'Ultra-fast token inference on LPU hardware.',
  },
  deepseek: {
    id: 'deepseek',
    title: 'DeepSeek',
    badge: 'V3 & R1',
    keyField: 'deepseekApiKey',
    keyTitle: 'DeepSeek API Key (sk-...)',
    keyPlaceholder: 'sk-...',
    consoleUrl: 'https://platform.deepseek.com/api_keys',
    capabilities: ['text'],
    defaultModel: 'deepseek-chat',
    summaryEs: 'Razonamiento técnico profundo con DeepSeek-V3 y R1.',
    summaryEn: 'Deep technical reasoning with DeepSeek-V3 & R1.',
  },
  mistral: {
    id: 'mistral',
    title: 'Mistral AI',
    badge: 'European AI',
    keyField: 'mistralApiKey',
    keyTitle: 'Mistral API Key',
    keyPlaceholder: '...',
    consoleUrl: 'https://console.mistral.ai/api-keys',
    capabilities: ['text'],
    defaultModel: 'mistral-small-latest',
    summaryEs: 'Modelos europeos de IA (Mistral Small, Large y Pixtral).',
    summaryEn: 'European AI models (Mistral Small, Large & Pixtral).',
  },
  replicate: {
    id: 'replicate',
    title: 'Replicate',
    badge: 'AudioSR & FLUX',
    keyField: 'replicateToken',
    keyTitle: 'Replicate API Token (r8_...)',
    keyPlaceholder: 'r8_...',
    consoleUrl: 'https://replicate.com/account/api-tokens',
    capabilities: ['image', 'audio-cloud'],
    defaultModel: '',
    summaryEs: 'GPU cloud para AudioSR / FLUX.1. Requiere Bridge local o dev-proxy por CORS.',
    summaryEn: 'Cloud GPU for AudioSR / FLUX.1. Requires local Bridge or dev-proxy for CORS.',
  },
  huggingface: {
    id: 'huggingface',
    title: 'Hugging Face',
    badge: 'Serverless',
    keyField: 'huggingfaceToken',
    keyTitle: 'HF User Access Token (hf_...)',
    keyPlaceholder: 'hf_...',
    consoleUrl: 'https://huggingface.co/settings/tokens',
    capabilities: ['image', 'audio-cloud'],
    defaultModel: '',
    summaryEs: 'Acceso a pesos protegidos e inferencia serverless en Hugging Face.',
    summaryEn: 'Access to gated weights & serverless inference on Hugging Face.',
  },
};

export const ALL_CLOUD_PROVIDERS: readonly CloudAiProvider[] = [
  'claude',
  'openrouter',
  'openai',
  'gemini',
  'groq',
  'deepseek',
  'mistral',
  'replicate',
  'huggingface',
];

export const TEXT_CAPABLE_PROVIDERS: readonly CloudAiProvider[] = [
  'claude',
  'openai',
  'openrouter',
  'gemini',
  'groq',
  'deepseek',
  'mistral',
];

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

export type ByokTextGenerationOptions = CloudTextGenerationOptions;

export interface CloudTextGenerationResult {
  text: string;
  provider: CloudAiProvider;
  model: string;
  finishReason?: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

export type ByokTextGenerationResult = CloudTextGenerationResult;

export interface CloudByokClientOptions {
  storageScope?: ByokStorageScope;
  allowedCapabilities?: Array<'text' | 'vision' | 'image' | 'audio'>;
}

export interface PresetAiMetadata {
  tags: string[];
  notes: string;
}

export interface SampleGroupSuggestion {
  name: string;
  files: string[];
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
  } catch {
    // Fall through to markdown extraction
  }

  const mdMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (mdMatch && mdMatch[1]) {
    try {
      const parsed = JSON.parse(mdMatch[1].trim()) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as T;
      }
    } catch {
      // Fall through to brace scan
    }
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

  public isCapabilityAllowed(cap: 'text' | 'vision' | 'image' | 'audio'): boolean {
    return this.allowedCapabilities.has(cap);
  }

  public getStorageScope(): ByokStorageScope {
    return this.config.storageScope === 'session' ? 'session' : 'local';
  }

  public setStorageScope(scope: ByokStorageScope): void {
    const prevScope = this.getStorageScope();
    this.config.storageScope = scope;
    if (typeof localStorage !== 'undefined' && typeof sessionStorage !== 'undefined') {
      if (prevScope === 'local' && scope === 'session') {
        localStorage.removeItem(SHARED_STORAGE_KEY_BYOK);
        localStorage.removeItem(LEGACY_STORAGE_KEY_BYOK);
      } else if (prevScope === 'session' && scope === 'local') {
        sessionStorage.removeItem(SHARED_STORAGE_KEY_BYOK);
      }
    }
    this.saveToStorage(this.config);
  }

  public loadFromStorage(): ByokConfig {
    let raw: string | null = null;
    let cameFromLegacy = false;

    if (typeof sessionStorage !== 'undefined') {
      raw = sessionStorage.getItem(SHARED_STORAGE_KEY_BYOK);
    }
    if (!raw && typeof localStorage !== 'undefined') {
      raw = localStorage.getItem(SHARED_STORAGE_KEY_BYOK);
      if (!raw) {
        raw = localStorage.getItem(LEGACY_STORAGE_KEY_BYOK);
        cameFromLegacy = Boolean(raw);
      }
    }

    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<ByokConfig>;
        this.config = { ...DEFAULT_BYOK_CONFIG, ...parsed };
        if (cameFromLegacy) {
          this.saveToStorage(this.config);
        }
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
    if (targetScope === 'session') {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(SHARED_STORAGE_KEY_BYOK, str);
      }
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(SHARED_STORAGE_KEY_BYOK);
        localStorage.removeItem(LEGACY_STORAGE_KEY_BYOK);
      }
    } else {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SHARED_STORAGE_KEY_BYOK, str);
      }
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(SHARED_STORAGE_KEY_BYOK);
      }
    }
  }

  public saveConfig(cfg: Partial<ByokConfig>): void {
    this.saveToStorage(cfg);
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

  public clearConfig(): void {
    this.clearStorage();
  }

  public getConfig(): ByokConfig {
    return { ...this.config };
  }

  public isConfigured(provider?: CloudAiProvider): boolean {
    const p = provider ?? this.config.provider;
    return Boolean(this.getActiveApiKey(p));
  }

  public hasValidKey(provider?: CloudAiProvider): boolean {
    return this.isConfigured(provider);
  }

  public isReady(): boolean {
    return ALL_CLOUD_PROVIDERS.some((p) => this.hasValidKey(p));
  }

  public getActiveApiKey(provider?: CloudAiProvider): string {
    const p = provider ?? this.config.provider;
    const field = CLOUD_PROVIDER_METADATA[p]?.keyField;
    if (!field) return '';
    return (this.config[field] ?? '').trim();
  }

  public getKeyForProvider(provider: CloudAiProvider): string | undefined {
    const field = CLOUD_PROVIDER_METADATA[provider]?.keyField;
    return field ? this.config[field] : undefined;
  }

  public getFirstAvailableTextProvider(): CloudAiProvider | null {
    if (TEXT_CAPABLE_PROVIDERS.includes(this.config.provider) && this.hasValidKey(this.config.provider)) {
      return this.config.provider;
    }
    for (const p of TEXT_CAPABLE_PROVIDERS) {
      if (this.hasValidKey(p)) return p;
    }
    return null;
  }

  public async fetchReplicate(
    apiPathOrUrl: string,
    token: string,
    init: { method?: string; body?: unknown } = {}
  ): Promise<Response> {
    const cleanToken = token.trim();
    const relPath = apiPathOrUrl.startsWith('https://api.replicate.com')
      ? apiPathOrUrl.slice('https://api.replicate.com'.length)
      : apiPathOrUrl.startsWith('/')
        ? apiPathOrUrl
        : `/${apiPathOrUrl}`;
    const method = (init.method ?? 'GET').toUpperCase();
    const bodyStr =
      init.body !== undefined
        ? typeof init.body === 'string'
          ? init.body
          : JSON.stringify(init.body)
        : undefined;

    // 1. Local Vite dev-server proxy (`/api/proxy/replicate/...`)
    try {
      const proxyRes = await fetchWithTimeout(`/api/proxy/replicate${relPath}`, {
        method,
        headers: {
          Authorization: `Bearer ${cleanToken}`,
          Accept: 'application/json',
          ...(bodyStr !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(bodyStr !== undefined ? { body: bodyStr } : {}),
      });
      const contentType = proxyRes.headers.get('content-type') || '';
      if (proxyRes.status !== 404 || contentType.includes('application/json')) {
        return proxyRes;
      }
    } catch {
      // Fall through to Companion Bridge proxy
    }

    // 2. Local Companion Bridge pass-through
    try {
      const bridgeUrl =
        (typeof localStorage !== 'undefined' && localStorage.getItem('neumodmakr_bridge_url')) ||
        'http://127.0.0.1:7860';
      const bridgeRes = await fetchWithTimeout(`${bridgeUrl.replace(/\/+$/, '')}/api/cloud/replicate_proxy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          path: relPath,
          method,
          token: cleanToken,
          ...(init.body !== undefined ? { body: init.body } : {}),
        }),
      });
      if (bridgeRes.status !== 404 && bridgeRes.status !== 502) {
        return bridgeRes;
      }
    } catch {
      // Fall through to direct fetch
    }

    // 3. Direct fetch (WebView2 / Electron / non-CORS runtimes)
    return fetchWithTimeout(`https://api.replicate.com${relPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${cleanToken}`,
        Accept: 'application/json',
        ...(bodyStr !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(bodyStr !== undefined ? { body: bodyStr } : {}),
    });
  }

  public async generateText(
    prompt: string,
    options: CloudTextGenerationOptions = {}
  ): Promise<CloudTextGenerationResult> {
    const provider = options.provider ?? this.getFirstAvailableTextProvider() ?? this.config.provider;
    if (provider === 'replicate' || provider === 'huggingface') {
      throw new Error(
        `Provider "${provider}" is dedicated to audio/vision weights. Select a text LLM provider (Claude, OpenRouter, OpenAI, Gemini, etc.).`
      );
    }

    const apiKey = this.getActiveApiKey(provider);
    if (!apiKey) {
      throw new Error(`[CloudByokClient] No personal API key configured for provider: ${provider}`);
    }

    switch (provider) {
      case 'gemini':
        return this.callGeminiText(prompt, apiKey, options);
      case 'claude':
        return this.callClaudeText(prompt, apiKey, options);
      case 'openai':
        return this.callOpenAiCompatibleText(
          'https://api.openai.com/v1/chat/completions',
          prompt,
          apiKey,
          options.model ?? CLOUD_PROVIDER_METADATA.openai.defaultModel,
          provider,
          options
        );
      case 'deepseek':
        return this.callOpenAiCompatibleText(
          'https://api.deepseek.com/chat/completions',
          prompt,
          apiKey,
          options.model ?? CLOUD_PROVIDER_METADATA.deepseek.defaultModel,
          provider,
          options
        );
      case 'groq':
        return this.callOpenAiCompatibleText(
          'https://api.groq.com/openai/v1/chat/completions',
          prompt,
          apiKey,
          options.model ?? CLOUD_PROVIDER_METADATA.groq.defaultModel,
          provider,
          options
        );
      case 'mistral':
        return this.callOpenAiCompatibleText(
          'https://api.mistral.ai/v1/chat/completions',
          prompt,
          apiKey,
          options.model ?? CLOUD_PROVIDER_METADATA.mistral.defaultModel,
          provider,
          options
        );
      case 'openrouter':
        return this.callOpenAiCompatibleText(
          'https://openrouter.ai/api/v1/chat/completions',
          prompt,
          apiKey,
          options.model ?? CLOUD_PROVIDER_METADATA.openrouter.defaultModel,
          provider,
          options,
          {
            'HTTP-Referer': 'https://abd-neumodmakr.vercel.app',
            'X-Title': 'ABDNeuModMakr Neural Synthesizer',
          }
        );
      default:
        throw new Error(`[CloudByokClient] Provider ${provider} does not support text generation.`);
    }
  }

  private async callGeminiText(
    prompt: string,
    apiKey: string,
    opts: CloudTextGenerationOptions
  ): Promise<CloudTextGenerationResult> {
    const model = opts.model ?? CLOUD_PROVIDER_METADATA.gemini.defaultModel;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    const contents: unknown[] = [];
    if (opts.messages && opts.messages.length > 0) {
      for (const m of opts.messages) {
        contents.push({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        });
      }
    }
    const userParts: unknown[] = [{ text: prompt }];
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

    const res = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(body),
        signal: opts.signal,
      },
      45000
    );

    if (!res.ok) {
      const err = await safeErrorSnippet(res);
      throw new Error(`Gemini error HTTP ${res.status}: ${err}`);
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
    };
    const text = (data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
    const finishReason = data?.candidates?.[0]?.finishReason;
    const usage = data?.usageMetadata
      ? {
          promptTokens: data.usageMetadata.promptTokenCount,
          completionTokens: data.usageMetadata.candidatesTokenCount,
          totalTokens: data.usageMetadata.totalTokenCount,
        }
      : undefined;

    return { text, provider: 'gemini', model, finishReason, usage };
  }

  private async callClaudeText(
    prompt: string,
    apiKey: string,
    opts: CloudTextGenerationOptions
  ): Promise<CloudTextGenerationResult> {
    const model = opts.model ?? CLOUD_PROVIDER_METADATA.claude.defaultModel;
    const url = 'https://api.anthropic.com/v1/messages';

    const messages: Array<{ role: string; content: unknown }> = [];
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
            type: 'image',
            source: {
              type: 'base64',
              media_type: opts.inlineData.mimeType,
              data: opts.inlineData.base64,
            },
          },
          { type: 'text', text: prompt },
        ],
      });
    } else {
      messages.push({ role: 'user', content: prompt });
    }

    const body: Record<string, unknown> = {
      model,
      max_tokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature ?? 0.2,
      messages,
    };
    if (opts.systemPrompt) {
      body.system = opts.systemPrompt;
    }

    const res = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'dangerously-allow-browser': 'true',
        },
        body: JSON.stringify(body),
        signal: opts.signal,
      },
      45000
    );

    if (!res.ok) {
      const err = await safeErrorSnippet(res);
      throw new Error(`Claude error HTTP ${res.status}: ${err}`);
    }

    const data = (await res.json()) as {
      content?: Array<{ type?: string; text?: string }>;
      stop_reason?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = (data?.content?.find((c) => c.type === 'text')?.text ?? data?.content?.[0]?.text ?? '').trim();
    const finishReason = data?.stop_reason;
    const usage = data?.usage
      ? {
          promptTokens: data.usage.input_tokens,
          completionTokens: data.usage.output_tokens,
          totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
        }
      : undefined;

    return { text, provider: 'claude', model, finishReason, usage };
  }

  private async callOpenAiCompatibleText(
    endpoint: string,
    prompt: string,
    apiKey: string,
    defaultModel: string,
    provider: CloudAiProvider,
    opts: CloudTextGenerationOptions,
    extraHeaders: Record<string, string> = {}
  ): Promise<CloudTextGenerationResult> {
    const model = opts.model ?? defaultModel;
    const messages: unknown[] = [];
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

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...extraHeaders,
    };

    let res = await fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: opts.signal,
      },
      45000
    );

    if (!res.ok && opts.jsonMode && res.status === 400) {
      delete body.response_format;
      res = await fetchWithTimeout(
        endpoint,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: opts.signal,
        },
        45000
      );
    }

    if (!res.ok) {
      const err = await safeErrorSnippet(res);
      throw new Error(`${provider} error HTTP ${res.status}: ${err}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const text = (data?.choices?.[0]?.message?.content ?? '').trim();
    const finishReason = data?.choices?.[0]?.finish_reason;
    const usage = data?.usage
      ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        }
      : undefined;

    return { text, provider, model, finishReason, usage };
  }

  public async testConnection(
    providerOverride?: CloudAiProvider,
    tokenOverride?: string,
    locale: 'es' | 'en' = 'es'
  ): Promise<{ ok: boolean; success: boolean; message: string; latencyMs: number }> {
    const provider = providerOverride ?? this.config.provider;
    const cleanToken = (tokenOverride ?? this.getActiveApiKey(provider)).trim();
    const isEn = String(locale).toLowerCase().startsWith('en');
    const loc = (es: string, en: string): string => (isEn ? en : es);
    const t0 = performance.now();

    if (!cleanToken) {
      return {
        ok: false,
        success: false,
        message: loc('La clave API no puede estar vacía.', 'API key cannot be empty.'),
        latencyMs: 0,
      };
    }

    const elapsed = (): number => Math.round(performance.now() - t0);
    const done = (ok: boolean, message: string) => ({
      ok,
      success: ok,
      message,
      latencyMs: elapsed(),
    });

    try {
      if (provider === 'replicate') {
        try {
          const res = await this.fetchReplicate('/v1/account', cleanToken, { method: 'GET' });
          if (res.ok) {
            const acct = (await res.json().catch(() => ({}))) as { username?: string };
            const userLabel = acct.username ? ` (@${acct.username})` : '';
            return done(
              true,
              loc(
                `Clave de Replicate verificada${userLabel} y lista para AudioSR / FLUX.1.`,
                `Replicate token verified${userLabel} and ready for AudioSR / FLUX.1.`
              )
            );
          }
          if (res.status === 401 || res.status === 403) {
            return done(
              false,
              loc(
                `Error de Replicate (HTTP ${res.status}): Token inválido o revocado.`,
                `Replicate error (HTTP ${res.status}): Invalid or revoked token.`
              )
            );
          }
          return done(
            false,
            loc(
              `Error de Replicate (HTTP ${res.status}): Comprueba que tu token sea válido.`,
              `Replicate error (HTTP ${res.status}): Check that your token is valid.`
            )
          );
        } catch {
          if (/^r8_[A-Za-z0-9]{20,}$/.test(cleanToken)) {
            return done(
              true,
              loc(
                'Formato de token Replicate validado (r8_...). Guardado y listo para uso.',
                'Replicate token format validated (r8_...). Saved and ready to use.'
              )
            );
          }
          return done(
            false,
            loc(
              'Formato de token Replicate inválido (debe comenzar por r8_).',
              'Invalid Replicate token format (must start with r8_).'
            )
          );
        }
      }

      if (provider === 'huggingface') {
        const res = await fetchWithTimeout('https://huggingface.co/api/whoami-v2', {
          method: 'GET',
          headers: { Authorization: `Bearer ${cleanToken}` },
        });
        if (res.ok) {
          const user = (await res.json().catch(() => ({}))) as { name?: string };
          return done(
            true,
            loc(
              `Hugging Face conectado (Usuario: ${user.name || 'OK'}).`,
              `Hugging Face connected (User: ${user.name || 'OK'}).`
            )
          );
        }
        return done(
          false,
          loc(
            `Error de Hugging Face (HTTP ${res.status}): Token inválido o sin permisos.`,
            `Hugging Face error (HTTP ${res.status}): Invalid token or insufficient permissions.`
          )
        );
      }

      if (provider === 'gemini') {
        const res = await fetchWithTimeout('https://generativelanguage.googleapis.com/v1beta/models', {
          method: 'GET',
          headers: { 'x-goog-api-key': cleanToken },
        });
        return res.ok
          ? done(true, loc('Google Gemini API Key verificada correctamente.', 'Google Gemini API Key verified successfully.'))
          : done(
              false,
              loc(
                `Error de Gemini (HTTP ${res.status}): Clave incorrecta o sin cuota habilitada.`,
                `Gemini error (HTTP ${res.status}): Invalid key or quota not enabled.`
              )
            );
      }

      if (provider === 'openai') {
        const res = await fetchWithTimeout('https://api.openai.com/v1/models', {
          method: 'GET',
          headers: { Authorization: `Bearer ${cleanToken}` },
        });
        return res.ok
          ? done(true, loc('OpenAI API Key verificada correctamente.', 'OpenAI API Key verified successfully.'))
          : done(
              false,
              loc(
                `Error de OpenAI (HTTP ${res.status}): Clave incorrecta o sin cuota.`,
                `OpenAI error (HTTP ${res.status}): Invalid key or insufficient quota.`
              )
            );
      }

      if (provider === 'claude') {
        try {
          const res = await fetchWithTimeout('https://api.anthropic.com/v1/models', {
            method: 'GET',
            headers: {
              'x-api-key': cleanToken,
              'anthropic-version': '2023-06-01',
              'dangerously-allow-browser': 'true',
            },
          });
          if (res.ok) {
            return done(true, loc('Anthropic Claude API Key verificada.', 'Anthropic Claude API Key verified.'));
          }
          if (res.status === 401 || res.status === 403) {
            return done(
              false,
              loc(
                `Error de Anthropic Claude (HTTP ${res.status}): Clave incorrecta o no autorizada.`,
                `Anthropic Claude error (HTTP ${res.status}): Invalid or unauthorized key.`
              )
            );
          }
        } catch {
          if (cleanToken.startsWith('sk-ant-') && cleanToken.length > 25) {
            return done(
              true,
              loc(
                'Formato de clave Anthropic Claude validado (sk-ant-...). Lista para uso.',
                'Anthropic Claude key format validated (sk-ant-...). Ready to use.'
              )
            );
          }
        }
        const looksOk = cleanToken.startsWith('sk-ant-') && cleanToken.length > 25;
        return done(
          looksOk,
          looksOk
            ? loc('Formato de clave Anthropic Claude validado.', 'Anthropic Claude key format validated.')
            : loc(
                'Comprueba el formato de tu clave Anthropic (debe iniciar con sk-ant-).',
                'Check your Anthropic key format (must start with sk-ant-).'
              )
        );
      }

      if (provider === 'openrouter') {
        const res = await fetchWithTimeout('https://openrouter.ai/api/v1/auth/key', {
          method: 'GET',
          headers: { Authorization: `Bearer ${cleanToken}` },
        });
        if (res.ok) {
          const data = (await res.json().catch(() => ({}))) as { data?: { label?: string } };
          const label = data.data?.label || loc('Activo', 'Active');
          return done(true, loc(`OpenRouter Key verificada (${label}).`, `OpenRouter Key verified (${label}).`));
        }
        return done(
          false,
          loc(
            `Error de OpenRouter (HTTP ${res.status}): Clave API no válida.`,
            `OpenRouter error (HTTP ${res.status}): Invalid API key.`
          )
        );
      }

      if (provider === 'deepseek') {
        const res = await fetchWithTimeout('https://api.deepseek.com/models', {
          method: 'GET',
          headers: { Authorization: `Bearer ${cleanToken}` },
        });
        return res.ok
          ? done(true, loc('DeepSeek API Key verificada.', 'DeepSeek API Key verified.'))
          : done(
              false,
              loc(
                `Error de DeepSeek (HTTP ${res.status}): Clave incorrecta o sin saldo.`,
                `DeepSeek error (HTTP ${res.status}): Invalid key or insufficient balance.`
              )
            );
      }

      if (provider === 'groq') {
        const res = await fetchWithTimeout('https://api.groq.com/openai/v1/models', {
          method: 'GET',
          headers: { Authorization: `Bearer ${cleanToken}` },
        });
        return res.ok
          ? done(true, loc('Groq API Key verificada.', 'Groq API Key verified.'))
          : done(
              false,
              loc(
                `Error de Groq (HTTP ${res.status}): Clave incorrecta.`,
                `Groq error (HTTP ${res.status}): Invalid key.`
              )
            );
      }

      if (provider === 'mistral') {
        const res = await fetchWithTimeout('https://api.mistral.ai/v1/models', {
          method: 'GET',
          headers: { Authorization: `Bearer ${cleanToken}` },
        });
        return res.ok
          ? done(true, loc('Mistral AI Key verificada correctamente.', 'Mistral AI Key verified successfully.'))
          : done(
              false,
              loc(
                `Error de Mistral (HTTP ${res.status}): Clave incorrecta.`,
                `Mistral error (HTTP ${res.status}): Invalid key.`
              )
            );
      }

      return done(false, loc(`Proveedor no soportado: ${provider}`, `Unsupported provider: ${provider}`));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return done(false, loc(`Error de conexión de red: ${msg}`, `Network connection error: ${msg}`));
    }
  }

  public async generateAcousticTimbreDescription(
    modelName: string,
    category: string,
    parameterSetName: string,
    detectedF0Hz?: number,
    preferredProvider?: CloudAiProvider
  ): Promise<string | null> {
    const provider = preferredProvider ?? this.getFirstAvailableTextProvider();
    if (!provider) return null;

    const f0Info = detectedF0Hz && detectedF0Hz > 0 ? ` with fundamental pitch ~${Math.round(detectedF0Hz)} Hz` : '';
    const systemPrompt =
      'You are an expert synthesizer sound designer and acoustic engineer. Provide concise, vivid, poetic yet technically accurate acoustic timbre characterizations. Never use markdown headers or bullet points; reply with 2-3 flowing sentences describing the sonic character, resonant traits, transient attack, and atmospheric vibe.';

    const prompt = `Synthesizer sound model name: "${modelName}" (${category})${f0Info}. Parameter set: "${parameterSetName}". Characterize the acoustic timbre, harmonic richness, overtone evolution, and emotional sound palette of this patch in 2-3 vivid sentences.`;

    try {
      const result = await this.generateText(prompt, {
        provider,
        maxTokens: 180,
        temperature: 0.65,
        systemPrompt,
      });
      return result.text || null;
    } catch {
      return null;
    }
  }

  public async generatePresetTagsAndNotes(
    modelName: string,
    category: string,
    summary: string,
    preferredProvider?: CloudAiProvider
  ): Promise<PresetAiMetadata | null> {
    const provider = preferredProvider ?? this.getFirstAvailableTextProvider();
    if (!provider) return null;

    const systemPrompt =
      'You are an acoustic timbre curator for a neural synthesizer. Return valid JSON only with keys "tags" (array of 4-6 concise lowercase acoustic tags) and "notes" (a 1-2 sentence program note).';

    const prompt = `Model: "${modelName}", Category: "${category}". Technical details: ${summary}. Output JSON: { "tags": [...], "notes": "..." }`;

    try {
      const result = await this.generateText(prompt, {
        provider,
        maxTokens: 200,
        temperature: 0.4,
        systemPrompt,
        jsonMode: true,
      });
      const parsed = parseJsonObjectSafe<{ tags?: unknown[]; notes?: unknown }>(result.text);
      if (!parsed) return null;
      return {
        tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : [],
        notes: String(parsed.notes || '').trim(),
      };
    } catch {
      return null;
    }
  }

  public async groupSampleFilenamesIntoInstruments(
    filenames: string[],
    preferredProvider?: CloudAiProvider
  ): Promise<SampleGroupSuggestion[] | null> {
    if (filenames.length === 0) return null;
    const provider = preferredProvider ?? this.getFirstAvailableTextProvider();
    if (!provider) return null;

    const systemPrompt =
      'You are an audio sample library organizer. Given a list of audio sample filenames (which include pitch/note names like C3, F#4, MIDI numbers like 060, or velocity layers like v1, vel127), group the files into distinct musical instruments. Return valid JSON only: { "instruments": [ { "name": "Instrument Name", "files": ["exact_filename_1.wav", ...] } ] }. Every input filename must appear in exactly one group.';

    const capped = filenames.slice(0, 200);
    const prompt = `Group these ${capped.length} sample filenames by musical instrument:\n${JSON.stringify(capped)}`;

    try {
      const result = await this.generateText(prompt, {
        provider,
        maxTokens: 1200,
        temperature: 0.1,
        systemPrompt,
        jsonMode: true,
      });
      const parsed = parseJsonObjectSafe<{
        instruments?: Array<{ name?: string; files?: string[] }>;
      }>(result.text);
      if (!parsed || !Array.isArray(parsed.instruments) || parsed.instruments.length === 0) {
        return null;
      }
      const validGroups = parsed.instruments
        .filter((g) => g && typeof g.name === 'string' && Array.isArray(g.files) && g.files.length > 0)
        .map((g) => ({
          name: String(g.name).trim(),
          files: g.files!.map(String),
        }));
      return validGroups.length > 0 ? validGroups : null;
    } catch {
      return null;
    }
  }
}

export const cloudByokClient = new CloudByokClient();
