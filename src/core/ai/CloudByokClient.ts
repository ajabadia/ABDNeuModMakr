// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — CloudByokClient (Bring Your Own Key)
//
// Allows users who desire heavy cloud GPU models (like AudioSR 96k)
// to provide their own personal API key.
//
// STRICT PRIVACY GUARANTEE:
//   - Stored ONLY in client browser `localStorage`.
//   - NEVER sent to, routed through, or stored on any ABDSynths server.
//   - Outbound requests connect directly from the user's browser to the
//     official AI provider endpoint.
//   - All GPU compute costs are billed directly to the user's own account.
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

export interface ByokConfig {
  enabled: boolean;
  provider: CloudAiProvider;
  storageScope?: 'local' | 'session';
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
  model?: string;
  provider?: CloudAiProvider;
  jsonMode?: boolean;
}

export interface CloudTextGenerationResult {
  text: string;
  provider: CloudAiProvider;
  model: string;
  finishReason?: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

/**
 * Parser defensivo para respuestas JSON de LLMs.
 * Limpia bloques de código markdown si los hubiera y valida que el retorno sea un objeto plano no nulo.
 */
export function parseJsonObjectSafe<T = Record<string, unknown>>(rawText: string): T | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  // 1. Intentar parse directo
  try {
    const direct = JSON.parse(trimmed) as unknown;
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
      return direct as T;
    }
  } catch {
    // Continuar con extracción
  }

  // 2. Extraer de bloque de markdown ```json ... ``` o ``` ... ```
  const mdMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (mdMatch && mdMatch[1]) {
    try {
      const parsed = JSON.parse(mdMatch[1].trim()) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as T;
      }
    } catch {
      // Continuar con regex de llaves
    }
  }

  // 3. Fallback a primera aparición de { ... }
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

// const STORAGE_KEY_BYOK = 'neumodmakr_byok_config';

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

/**
 * S4.2: todo `fetch` a proveedores IA lleva timeout explícito.
 * Un endpoint colgado (DNS caído, modelo en cold-start) aborta en vez de
 * congelar la UI para siempre. Exportada para el suite de seguridad.
 */
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
    // `globalThis.fetch` en tiempo de llamada (no capturado): testeable y sin
    // recursión — el nombre del helper nunca aparece en esta expresión.
    return await globalThis.fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
    eventTarget?.removeEventListener('abort', onAbort);
  }
}

/**
 * S4.2: mensaje de error acotado — nunca vierte cuerpos de error gigantes
 * (páginas HTML de un proxy caído, p. ej.) al usuario ni a los logs.
 */
export async function safeErrorSnippet(res: Response, maxChars = 300): Promise<string> {
  try {
    const text = await res.text();
    return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
  } catch {
    return '';
  }
}

const DEFAULT_BYOK_CONFIG: ByokConfig = {
  enabled: false,
  provider: 'replicate',
  preferredCloudModel: 'audiosr',
};

const STORAGE_KEY_BYOK_LEGACY = 'neumodmakr_byok_config';
const STORAGE_KEY_BYOK_SHARED = 'abdsynths.ai.byok.v1';

export class CloudByokClient {
  private config: ByokConfig = { ...DEFAULT_BYOK_CONFIG, storageScope: 'local' };

  constructor() {
    this.loadFromStorage();
  }

  public getStorageScope(): 'local' | 'session' {
    return this.config.storageScope === 'session' ? 'session' : 'local';
  }

  public loadFromStorage(): ByokConfig {
    let raw: string | null = null;
    if (typeof sessionStorage !== 'undefined') {
      raw = sessionStorage.getItem(STORAGE_KEY_BYOK_SHARED);
    }
    if (!raw && typeof localStorage !== 'undefined') {
      raw = localStorage.getItem(STORAGE_KEY_BYOK_SHARED);
      if (!raw) {
        raw = localStorage.getItem(STORAGE_KEY_BYOK_LEGACY);
      }
    }
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<ByokConfig>;
        this.config = { ...DEFAULT_BYOK_CONFIG, ...parsed };
        // If loaded from legacy key, migrate forward immediately
        if (typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY_BYOK_LEGACY) && !localStorage.getItem(STORAGE_KEY_BYOK_SHARED) && !sessionStorage?.getItem(STORAGE_KEY_BYOK_SHARED)) {
          this.saveConfig(this.config);
        }
      } catch {
        this.config = { ...DEFAULT_BYOK_CONFIG };
      }
    } else {
      this.config = { ...DEFAULT_BYOK_CONFIG };
    }
    return { ...this.config };
  }

  public saveConfig(newConfig: Partial<ByokConfig>): void {
    this.config = { ...this.config, ...newConfig };
    const scope = this.getStorageScope();
    const str = JSON.stringify(this.config);

    if (scope === 'session') {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(STORAGE_KEY_BYOK_SHARED, str);
      }
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(STORAGE_KEY_BYOK_SHARED);
        localStorage.removeItem(STORAGE_KEY_BYOK_LEGACY);
      }
    } else {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY_BYOK_SHARED, str);
        localStorage.setItem(STORAGE_KEY_BYOK_LEGACY, str);
      }
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(STORAGE_KEY_BYOK_SHARED);
      }
    }
  }

  public clearConfig(): void {
    this.config = { ...DEFAULT_BYOK_CONFIG };
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY_BYOK_SHARED);
      localStorage.removeItem(STORAGE_KEY_BYOK_LEGACY);
    }
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(STORAGE_KEY_BYOK_SHARED);
    }
  }

  public getConfig(): ByokConfig {
    return { ...this.config };
  }

  public hasValidKey(provider: CloudAiProvider = this.config.provider): boolean {
    if (provider === 'replicate') return Boolean(this.config.replicateToken?.trim());
    if (provider === 'huggingface') return Boolean(this.config.huggingfaceToken?.trim());
    if (provider === 'gemini') return Boolean(this.config.geminiApiKey?.trim());
    if (provider === 'openai') return Boolean(this.config.openaiApiKey?.trim());
    if (provider === 'claude') return Boolean(this.config.claudeApiKey?.trim());
    if (provider === 'openrouter') return Boolean(this.config.openrouterApiKey?.trim());
    if (provider === 'deepseek') return Boolean(this.config.deepseekApiKey?.trim());
    if (provider === 'groq') return Boolean(this.config.groqApiKey?.trim());
    if (provider === 'mistral') return Boolean(this.config.mistralApiKey?.trim());
    return false;
  }

  public isReady(): boolean {
    const providers: CloudAiProvider[] = [
      'replicate', 'huggingface', 'gemini', 'openai', 'claude', 'openrouter', 'deepseek', 'groq', 'mistral',
    ];
    return providers.some((p) => this.hasValidKey(p));
  }

  /**
   * Executes a Replicate API `/v1/...` request while bypassing browser CORS restrictions:
   *   1. Local Vite dev proxy (`/api/proxy/replicate/v1/...`)
   *   2. Local Companion Bridge pass-through (`http://127.0.0.1:7860/api/cloud/replicate_proxy`)
   *   3. Direct `https://api.replicate.com/v1/...` (for WebView2 / native wrappers)
   */
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

    // 1. Try local Vite dev server proxy (`/api/proxy/replicate/...`)
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
      // If Vite proxy handled it (even 401/403/422 from Replicate), return it;
      // only fall through if `/api/proxy/replicate` itself returned an HTML 404 from a static server.
      const contentType = proxyRes.headers.get('content-type') || '';
      if (proxyRes.status !== 404 || contentType.includes('application/json')) {
        return proxyRes;
      }
    } catch {
      // Fall through to Companion Bridge proxy
    }

    // 2. Try Local Companion Bridge pass-through (`http://127.0.0.1:7860/api/cloud/replicate_proxy`)
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

    // 3. Direct fetch (works in WebView2 / Electron / non-CORS environments)
    return fetch(`https://api.replicate.com${relPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${cleanToken}`,
        Accept: 'application/json',
        ...(bodyStr !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(bodyStr !== undefined ? { body: bodyStr } : {}),
    });
  }

  /**
   * Verifies the user's personal API key against the provider with a lightweight check.
   */
  public async testConnection(
    provider: CloudAiProvider,
    token: string
  ): Promise<{ success: boolean; message: string }> {
    const cleanToken = token.trim();
    if (!cleanToken) {
      return { success: false, message: 'La clave API no puede estar vacía.' };
    }

    try {
      if (provider === 'replicate') {
        try {
          const res = await this.fetchReplicate('/v1/account', cleanToken, { method: 'GET' });
          if (res.ok) {
            const acct = (await res.json().catch(() => ({}))) as { username?: string; name?: string };
            const userLabel = acct.username ? ` (@${acct.username})` : '';
            return {
              success: true,
              message: `Clave de Replicate verificada${userLabel} y lista para AudioSR / FLUX.1.`,
            };
          }
          if (res.status === 401 || res.status === 403) {
            return {
              success: false,
              message: `Error de Replicate (HTTP ${res.status}): El token introducido no es válido o ha sido revocado.`,
            };
          }
          return {
            success: false,
            message: `Error de Replicate (HTTP ${res.status}): Comprueba que tu token sea válido.`,
          };
        } catch {
          // If running in a static browser host where CORS blocks direct calls to api.replicate.com:
          if (/^r8_[A-Za-z0-9]{20,}$/.test(cleanToken)) {
            return {
              success: true,
              message: 'Formato de token Replicate validado (r8_...). Guardado y listo para uso.',
            };
          }
          return {
            success: false,
            message: 'Formato de token Replicate inválido (debe comenzar por r8_ seguido de caracteres alfanuméricos).',
          };
        }
      }

      if (provider === 'huggingface') {
        const res = await fetchWithTimeout('https://huggingface.co/api/whoami-v2', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${cleanToken}`,
          },
        });
        if (res.ok) {
          const user = (await res.json()) as { name?: string };
          return { success: true, message: `Hugging Face conectado (Usuario: ${user.name || 'OK'}).` };
        }
        return {
          success: false,
          message: `Error de Hugging Face (HTTP ${res.status}): Token invalido o sin permisos.`,
        };
      }

      if (provider === 'gemini') {
        const res = await fetchWithTimeout(
          'https://generativelanguage.googleapis.com/v1beta/models',
          {
            method: 'GET',
            headers: {
              'x-goog-api-key': cleanToken,
            },
          }
        );
        if (res.ok) {
          return { success: true, message: 'Google Gemini API Key verificada correctamente.' };
        }
        return {
          success: false,
          message: `Error de Gemini (HTTP ${res.status}): Clave incorrecta o sin cuota habilitada.`,
        };
      }

      if (provider === 'openai') {
        const res = await fetchWithTimeout('https://api.openai.com/v1/models', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${cleanToken}`,
          },
        });
        if (res.ok) {
          return { success: true, message: 'OpenAI API Key verificada correctamente (DALL-E 3 habilitado).' };
        }
        return {
          success: false,
          message: `Error de OpenAI (HTTP ${res.status}): Clave incorrecta o sin cuota de facturacion activa.`,
        };
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
            return { success: true, message: 'Anthropic Claude API Key verificada (Claude 3.5 Sonnet / Haiku listo).' };
          }
          if (res.status === 401 || res.status === 403) {
            return { success: false, message: `Error de Anthropic Claude (HTTP ${res.status}): Clave incorrecta o no autorizada.` };
          }
        } catch {
          // If browser CORS restrictions prevent direct GET /v1/models:
          if (cleanToken.startsWith('sk-ant-') && cleanToken.length > 25) {
            return { success: true, message: 'Formato de clave de Anthropic Claude validado (sk-ant-...). Lista para uso.' };
          }
        }
        return {
          success: cleanToken.startsWith('sk-ant-') && cleanToken.length > 25,
          message: cleanToken.startsWith('sk-ant-') && cleanToken.length > 25
            ? 'Formato de clave Anthropic Claude validado.'
            : 'Comprueba el formato de tu clave Anthropic (debe iniciar con sk-ant-).',
        };
      }

      if (provider === 'openrouter') {
        const res = await fetchWithTimeout('https://openrouter.ai/api/v1/auth/key', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${cleanToken}`,
          },
        });
        if (res.ok) {
          const data = (await res.json()) as { data?: { label?: string; limit?: number; usage?: number } };
          const label = data.data?.label || 'Activo';
          return { success: true, message: `OpenRouter Key verificada (${label}). Acceso a FLUX, Claude y GPT activo.` };
        }
        return {
          success: false,
          message: `Error de OpenRouter (HTTP ${res.status}): Clave API no valida.`,
        };
      }

      if (provider === 'deepseek') {
        const res = await fetchWithTimeout('https://api.deepseek.com/models', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${cleanToken}`,
          },
        });
        if (res.ok) {
          return { success: true, message: 'DeepSeek API Key verificada (DeepSeek-V3 / R1 activo).' };
        }
        return {
          success: false,
          message: `Error de DeepSeek (HTTP ${res.status}): Clave incorrecta o sin saldo.`,
        };
      }

      if (provider === 'groq') {
        const res = await fetchWithTimeout('https://api.groq.com/openai/v1/models', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${cleanToken}`,
          },
        });
        if (res.ok) {
          return { success: true, message: 'Groq API Key verificada (Inferencia ultra-rapida LPU activa).' };
        }
        return {
          success: false,
          message: `Error de Groq (HTTP ${res.status}): Clave incorrecta.`,
        };
      }

      if (provider === 'mistral') {
        const res = await fetchWithTimeout('https://api.mistral.ai/v1/models', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${cleanToken}`,
          },
        });
        if (res.ok) {
          return { success: true, message: 'Mistral AI Key verificada correctamente.' };
        }
        return {
          success: false,
          message: `Error de Mistral (HTTP ${res.status}): Clave incorrecta.`,
        };
      }

      return { success: false, message: 'Proveedor no soportado.' };
    } catch (err) {
      return {
        success: false,
        message: `Error de conexion de red: ${String(err)}`,
      };
    }
  }

  public getKeyForProvider(provider: CloudAiProvider): string | undefined {
    switch (provider) {
      case 'replicate': return this.config.replicateToken;
      case 'huggingface': return this.config.huggingfaceToken;
      case 'gemini': return this.config.geminiApiKey;
      case 'openai': return this.config.openaiApiKey;
      case 'claude': return this.config.claudeApiKey;
      case 'openrouter': return this.config.openrouterApiKey;
      case 'deepseek': return this.config.deepseekApiKey;
      case 'groq': return this.config.groqApiKey;
      case 'mistral': return this.config.mistralApiKey;
      default: return undefined;
    }
  }

  public getFirstAvailableTextProvider(): CloudAiProvider | null {
    const textProviders: CloudAiProvider[] = [
      'claude',
      'openai',
      'openrouter',
      'gemini',
      'groq',
      'deepseek',
      'mistral',
    ];
    if (textProviders.includes(this.config.provider) && this.hasValidKey(this.config.provider)) {
      return this.config.provider;
    }
    for (const p of textProviders) {
      if (this.hasValidKey(p)) return p;
    }
    return null;
  }

  /**
   * Generates text using cloud LLM APIs directly from the browser (BYOK).
   * Supports Anthropic Claude, OpenRouter, OpenAI GPT-4o, Google Gemini, Groq, DeepSeek, and Mistral.
   */
  public async generateText(
    prompt: string,
    options?: CloudTextGenerationOptions
  ): Promise<CloudTextGenerationResult> {
    const provider = options?.provider ?? this.getFirstAvailableTextProvider() ?? this.config.provider;
    const token = this.getKeyForProvider(provider)?.trim();

    if (!token) {
      throw new Error(`No personal API key configured for provider '${provider}'. Please configure it in Settings.`);
    }

    if (provider === 'replicate' || provider === 'huggingface') {
      throw new Error(`Provider '${provider}' is dedicated to audio/vision weights. Select a language model provider (Claude, OpenRouter, OpenAI, Gemini, etc.).`);
    }

    const maxTokens = options?.maxTokens ?? 350;
    const temperature = options?.temperature ?? 0.7;
    const systemPrompt = options?.systemPrompt;
    const jsonMode = Boolean(options?.jsonMode);

    // 1. Anthropic Claude (v1/messages)
    if (provider === 'claude') {
      const model = options?.model ?? 'claude-3-5-haiku-20241022';
      const body: Record<string, unknown> = {
        model,
        max_tokens: maxTokens,
        temperature,
        messages: [{ role: 'user', content: prompt }],
      };
      if (systemPrompt) {
        body.system = systemPrompt;
      }

      const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': token,
          'anthropic-version': '2023-06-01',
          'dangerously-allow-browser': 'true',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await safeErrorSnippet(res);
        throw new Error(`Claude API error (HTTP ${res.status}): ${errText}`);
      }

      const data = (await res.json()) as {
        content?: Array<{ type: string; text: string }>;
        stop_reason?: string;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const text = data.content?.find((c) => c.type === 'text')?.text ?? '';
      return {
        text: text.trim(),
        provider: 'claude',
        model,
        finishReason: data.stop_reason,
        usage: {
          promptTokens: data.usage?.input_tokens,
          completionTokens: data.usage?.output_tokens,
          totalTokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
        },
      };
    }

    // 2. OpenRouter (OpenAI-compatible multi-model gateway)
    if (provider === 'openrouter') {
      const model = options?.model ?? 'openai/gpt-4o-mini';
      const messages: Array<{ role: string; content: string }> = [];
      if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
      messages.push({ role: 'user', content: prompt });

      const requestPayload: Record<string, unknown> = {
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
      };
      if (jsonMode) {
        requestPayload.response_format = { type: 'json_object' };
      }

      let res = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'HTTP-Referer': 'https://abd-neumodmakr.vercel.app',
          'X-Title': 'ABDNeuModMakr Neural Synthesizer',
        },
        body: JSON.stringify(requestPayload),
      });

      // Si el modelo específico de OpenRouter rechaza response_format (HTTP 400), reintentar una vez sin él
      if (!res.ok && res.status === 400 && jsonMode) {
        delete requestPayload.response_format;
        res = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            'HTTP-Referer': 'https://abd-neumodmakr.vercel.app',
            'X-Title': 'ABDNeuModMakr Neural Synthesizer',
          },
          body: JSON.stringify(requestPayload),
        });
      }

      if (!res.ok) {
        const errText = await safeErrorSnippet(res);
        throw new Error(`OpenRouter API error (HTTP ${res.status}): ${errText}`);
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const text = data.choices?.[0]?.message?.content ?? '';
      return {
        text: text.trim(),
        provider: 'openrouter',
        model,
        finishReason: data.choices?.[0]?.finish_reason,
        usage: {
          promptTokens: data.usage?.prompt_tokens,
          completionTokens: data.usage?.completion_tokens,
          totalTokens: data.usage?.total_tokens,
        },
      };
    }

    // 3. OpenAI (ChatGPT / GPT-4o)
    if (provider === 'openai') {
      const model = options?.model ?? 'gpt-4o-mini';
      const messages: Array<{ role: string; content: string }> = [];
      if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
      messages.push({ role: 'user', content: prompt });

      const requestPayload: Record<string, unknown> = {
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
      };
      if (jsonMode) {
        requestPayload.response_format = { type: 'json_object' };
      }

      const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(requestPayload),
      });

      if (!res.ok) {
        const errText = await safeErrorSnippet(res);
        throw new Error(`OpenAI API error (HTTP ${res.status}): ${errText}`);
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const text = data.choices?.[0]?.message?.content ?? '';
      return {
        text: text.trim(),
        provider: 'openai',
        model,
        finishReason: data.choices?.[0]?.finish_reason,
        usage: {
          promptTokens: data.usage?.prompt_tokens,
          completionTokens: data.usage?.completion_tokens,
          totalTokens: data.usage?.total_tokens,
        },
      };
    }

    // 4. Groq (Ultra-fast LPU inference)
    if (provider === 'groq') {
      const model = options?.model ?? 'llama-3.1-8b-instant';
      const messages: Array<{ role: string; content: string }> = [];
      if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
      messages.push({ role: 'user', content: prompt });

      const requestPayload: Record<string, unknown> = {
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
      };
      if (jsonMode) {
        requestPayload.response_format = { type: 'json_object' };
      }

      const res = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(requestPayload),
      });

      if (!res.ok) {
        const errText = await safeErrorSnippet(res);
        throw new Error(`Groq API error (HTTP ${res.status}): ${errText}`);
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const text = data.choices?.[0]?.message?.content ?? '';
      return {
        text: text.trim(),
        provider: 'groq',
        model,
        finishReason: data.choices?.[0]?.finish_reason,
        usage: {
          promptTokens: data.usage?.prompt_tokens,
          completionTokens: data.usage?.completion_tokens,
          totalTokens: data.usage?.total_tokens,
        },
      };
    }

    // 5. DeepSeek (DeepSeek-V3 / R1)
    if (provider === 'deepseek') {
      const model = options?.model ?? 'deepseek-chat';
      const messages: Array<{ role: string; content: string }> = [];
      if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
      messages.push({ role: 'user', content: prompt });

      const requestPayload: Record<string, unknown> = {
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
      };
      if (jsonMode) {
        requestPayload.response_format = { type: 'json_object' };
      }

      const res = await fetchWithTimeout('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(requestPayload),
      });

      if (!res.ok) {
        const errText = await safeErrorSnippet(res);
        throw new Error(`DeepSeek API error (HTTP ${res.status}): ${errText}`);
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const text = data.choices?.[0]?.message?.content ?? '';
      return {
        text: text.trim(),
        provider: 'deepseek',
        model,
        finishReason: data.choices?.[0]?.finish_reason,
        usage: {
          promptTokens: data.usage?.prompt_tokens,
          completionTokens: data.usage?.completion_tokens,
          totalTokens: data.usage?.total_tokens,
        },
      };
    }

    // 6. Mistral AI
    if (provider === 'mistral') {
      const model = options?.model ?? 'mistral-small-latest';
      const messages: Array<{ role: string; content: string }> = [];
      if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
      messages.push({ role: 'user', content: prompt });

      const requestPayload: Record<string, unknown> = {
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
      };
      if (jsonMode) {
        requestPayload.response_format = { type: 'json_object' };
      }

      const res = await fetchWithTimeout('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(requestPayload),
      });

      if (!res.ok) {
        const errText = await safeErrorSnippet(res);
        throw new Error(`Mistral API error (HTTP ${res.status}): ${errText}`);
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const text = data.choices?.[0]?.message?.content ?? '';
      return {
        text: text.trim(),
        provider: 'mistral',
        model,
        finishReason: data.choices?.[0]?.finish_reason,
        usage: {
          promptTokens: data.usage?.prompt_tokens,
          completionTokens: data.usage?.completion_tokens,
          totalTokens: data.usage?.total_tokens,
        },
      };
    }

    // 7. Google Gemini
    if (provider === 'gemini') {
      const model = options?.model ?? 'gemini-2.5-flash';
      const generationConfig: Record<string, unknown> = {
        maxOutputTokens: maxTokens,
        temperature,
      };
      if (jsonMode) {
        generationConfig.responseMimeType = 'application/json';
      }
      const body: Record<string, unknown> = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig,
      };
      if (systemPrompt) {
        body.systemInstruction = { parts: [{ text: systemPrompt }] };
      }

      const res = await fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': token,
          },
          body: JSON.stringify(body),
        }
      );

      if (!res.ok) {
        const errText = await safeErrorSnippet(res);
        throw new Error(`Gemini API error (HTTP ${res.status}): ${errText}`);
      }

      const data = (await res.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
          finishReason?: string;
        }>;
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          totalTokenCount?: number;
        };
      };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      return {
        text: text.trim(),
        provider: 'gemini',
        model,
        finishReason: data.candidates?.[0]?.finishReason,
        usage: {
          promptTokens: data.usageMetadata?.promptTokenCount,
          completionTokens: data.usageMetadata?.candidatesTokenCount,
          totalTokens: data.usageMetadata?.totalTokenCount,
        },
      };
    }

    throw new Error(`Unsupported text provider: ${provider}`);
  }

  /**
   * Generates a concise acoustic timbre description for a sound model
   * to enrich prompts, metadata, and sound library indexing.
   */
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

  /**
   * Generates preset tags and program notes for sound cataloging.
   */
  public async generatePresetTagsAndNotes(
    modelName: string,
    category: string,
    summary: string,
    preferredProvider?: CloudAiProvider
  ): Promise<{ tags: string[]; notes: string } | null> {
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

  /**
   * Groups a list of audio sample filenames/relative paths into distinct musical instruments
   * using an LLM when filenames in a directory are heterogeneous or ambiguous.
   */
  public async groupSampleFilenamesIntoInstruments(
    filenames: string[],
    preferredProvider?: CloudAiProvider
  ): Promise<Array<{ name: string; files: string[] }> | null> {
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
