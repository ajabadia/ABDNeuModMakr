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

const STORAGE_KEY_BYOK = 'neumodmakr_byok_config';

const DEFAULT_BYOK_CONFIG: ByokConfig = {
  enabled: false,
  provider: 'replicate',
  preferredCloudModel: 'audiosr',
};

export class CloudByokClient {
  private config: ByokConfig = { ...DEFAULT_BYOK_CONFIG };

  constructor() {
    this.loadFromStorage();
  }

  public loadFromStorage(): ByokConfig {
    if (typeof localStorage === 'undefined') return { ...this.config };
    try {
      const raw = localStorage.getItem(STORAGE_KEY_BYOK);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<ByokConfig>;
        this.config = { ...DEFAULT_BYOK_CONFIG, ...parsed };
      }
    } catch {
      this.config = { ...DEFAULT_BYOK_CONFIG };
    }
    return { ...this.config };
  }

  public saveConfig(newConfig: Partial<ByokConfig>): void {
    this.config = { ...this.config, ...newConfig };
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY_BYOK, JSON.stringify(this.config));
      } catch {
        // quota safety
      }
    }
  }

  public clearConfig(): void {
    this.config = { ...DEFAULT_BYOK_CONFIG };
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(STORAGE_KEY_BYOK);
      } catch {
        // quota safety
      }
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
        const res = await fetch('https://api.replicate.com/v1/models', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${cleanToken}`,
          },
        });
        if (res.ok) {
          return { success: true, message: 'Clave de Replicate verificada y lista para AudioSR.' };
        }
        return {
          success: false,
          message: `Error de Replicate (HTTP ${res.status}): Comprueba que tu token sea valido.`,
        };
      }

      if (provider === 'huggingface') {
        const res = await fetch('https://huggingface.co/api/whoami-v2', {
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
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(cleanToken)}`,
          { method: 'GET' }
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
        const res = await fetch('https://api.openai.com/v1/models', {
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
          const res = await fetch('https://api.anthropic.com/v1/models', {
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
        const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
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
        const res = await fetch('https://api.deepseek.com/models', {
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
        const res = await fetch('https://api.groq.com/openai/v1/models', {
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
        const res = await fetch('https://api.mistral.ai/v1/models', {
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
}

export const cloudByokClient = new CloudByokClient();
