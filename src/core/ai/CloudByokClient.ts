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

export type CloudAiProvider = 'replicate' | 'huggingface' | 'gemini';

export interface ByokConfig {
  enabled: boolean;
  provider: CloudAiProvider;
  replicateToken?: string;
  huggingfaceToken?: string;
  geminiApiKey?: string;
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
