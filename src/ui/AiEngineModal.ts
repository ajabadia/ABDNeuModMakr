// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — AI Assistance & DSP Engine Matrix Modal
// Allows granular per-stage selection between:
//   1. In-Browser WebGPU / WASM SIMD (100% free, zero backend, client hardware)
//   2. Cloud AI (Bring-Your-Own-Key, localStorage privacy, user-billed)
//   3. Local Companion Bridge (Local Python + RTX 3070 GPU VRAM)
// ─────────────────────────────────────────────────────────

import type {
  AiAssistanceConfig,
  ClassifierMethod,
  DenoiseMethod,
  LoopExpansionMethod,
  MasterWaveMethod,
  SeparationMethod,
} from '../core/types';
import { bridgeClient, type BridgeModelInfo } from '../core/bridge/BridgeClient';
import { webNeuralEngine, type WebGpuDeviceStatus } from '../core/ai/WebNeuralEngine';
import { cloudByokClient, type CloudAiProvider } from '../core/ai/CloudByokClient';
import { ICONS } from './icons';
import { toast } from './notify';

export interface AiEngineModalHandlers {
  onUpdateAiConfig: (config: AiAssistanceConfig) => void;
  onOpenBridgeStatus?: () => void;
}

type ModalTab = 'web' | 'cloud' | 'bridge';

export class AiEngineModal {
  private backdropEl: HTMLElement | null = null;
  private currentConfig: AiAssistanceConfig = {
    enabled: false,
    masterWave: 'dsp',
    separation: 'dsp',
    loopExpansion: 'dsp',
    classifier: 'dsp',
    denoise: 'dsp',
  };
  private currentTab: ModalTab = 'web';
  private handlers: AiEngineModalHandlers;
  private unsubscribeBridge: (() => void) | null = null;
  private webGpuStatus: WebGpuDeviceStatus | null = null;
  private isTestingByok = false;
  private byokTestResult: { success: boolean; message: string } | null = null;
  private bridgeModels: BridgeModelInfo[] = [];
  private activePollingModelIds = new Set<string>();
  private downloadPollTimer: ReturnType<typeof setInterval> | null = null;
  private showPassword = false;

  constructor(handlers: AiEngineModalHandlers) {
    this.handlers = handlers;
  }

  public async open(config: AiAssistanceConfig): Promise<void> {
    this.currentConfig = { ...config };
    this.webGpuStatus = webNeuralEngine.getDeviceStatus();

    if (!this.backdropEl) {
      this.backdropEl = document.createElement('div');
      this.backdropEl.className = 'modal-backdrop is-hidden';
      document.body.appendChild(this.backdropEl);
    }

    this.render();
    this.backdropEl.classList.remove('is-hidden');

    // Async init WebGPU status
    void webNeuralEngine.init().then((st) => {
      this.webGpuStatus = st;
      this.updateHardwareBadge();
    });

    // Bridge status subscription
    this.unsubscribeBridge = bridgeClient.subscribe(() => {
      this.updateBridgeBadge();
      void this.refreshBridgeModels();
    });
    void bridgeClient.checkHealth();
    void this.refreshBridgeModels();
  }

  public close(): void {
    if (this.unsubscribeBridge) {
      this.unsubscribeBridge();
      this.unsubscribeBridge = null;
    }
    if (this.downloadPollTimer) {
      clearInterval(this.downloadPollTimer);
      this.downloadPollTimer = null;
    }
    this.backdropEl?.classList.add('is-hidden');
  }

  private countActiveAiStages(): number {
    if (!this.currentConfig.enabled) return 0;
    let count = 0;
    if (this.currentConfig.masterWave === 'ai') count++;
    if (this.currentConfig.separation === 'ai') count++;
    if (this.currentConfig.loopExpansion === 'ai') count++;
    if (this.currentConfig.classifier === 'ai') count++;
    if (this.currentConfig.denoise === 'ai') count++;
    return count;
  }

  private async refreshBridgeModels(): Promise<void> {
    if (!bridgeClient.isConnected()) {
      this.bridgeModels = [];
      return;
    }
    try {
      this.bridgeModels = await bridgeClient.getModels();
      for (const m of this.bridgeModels) {
        if (m.status === 'downloading') {
          this.startModelProgressPolling(m.id);
        }
      }
      this.renderBridgeModelsList();
    } catch {
      // offline
    }
  }

  private render(): void {
    if (!this.backdropEl) return;
    const cfg = this.currentConfig;
    const activeAiCount = this.countActiveAiStages();

    this.backdropEl.innerHTML = `
      <div class="process-modal-card ai-engine-modal-card" role="dialog" aria-modal="true" aria-label="AI & DSP Processing Engine Matrix">
        <!-- Header -->
        <div class="modal-header ai-modal-header">
          <div class="modal-title">
            <span class="modal-icon">${ICONS.ai}</span>
            <span>MOTOR DE PROCESADO Y ASISTENCIA IA</span>
            <span class="panel-badge ${cfg.enabled ? 'badge-ai-on' : 'badge-muted'}" id="ai-active-badge">
              ${cfg.enabled ? `IA: ${activeAiCount}/5 ETAPAS` : 'DSP PURO (IA OFF)'}
            </span>
          </div>
          <button type="button" class="btn btn-close-modal" id="btn-close-ai-modal" title="Cerrar (Esc)">
            ${ICONS.close}
          </button>
        </div>

        <!-- Mode Navigation Tabs -->
        <div class="ai-tabs-nav">
          <button type="button" class="ai-tab-btn ${this.currentTab === 'web' ? 'is-active' : ''}" data-tab="web">
            <span class="ai-tab-icon">${ICONS.cpu}</span>
            <span class="ai-tab-title">Motor Web Integrado</span>
            <span class="ai-tab-tag">De Serie (100% Gratis)</span>
          </button>
          <button type="button" class="ai-tab-btn ${this.currentTab === 'cloud' ? 'is-active' : ''}" data-tab="cloud">
            <span class="ai-tab-icon">${ICONS.cloud}</span>
            <span class="ai-tab-title">Cloud AI (BYOK)</span>
            <span class="ai-tab-tag">Clave Personal</span>
          </button>
          <button type="button" class="ai-tab-btn ${this.currentTab === 'bridge' ? 'is-active' : ''}" data-tab="bridge">
            <span class="ai-tab-icon">${ICONS.database}</span>
            <span class="ai-tab-title">Companion Bridge</span>
            <span class="ai-tab-tag">GPU Local (VRAM)</span>
          </button>
        </div>

        <!-- Master Switch & Presets Bar (Shared in Web Tab) -->
        ${this.currentTab === 'web' ? this.renderMasterWebBar(cfg) : ''}

        <!-- Tab Body -->
        <div class="modal-body ai-modal-body">
          ${this.currentTab === 'web' ? this.renderWebTab(cfg) : ''}
          ${this.currentTab === 'cloud' ? this.renderCloudTab() : ''}
          ${this.currentTab === 'bridge' ? this.renderBridgeTab() : ''}
        </div>

        <!-- Footer -->
        <div class="modal-footer ai-modal-footer">
          <div class="ai-footer-info">
            <span class="text-muted" id="ai-footer-device-status">
              ${this.webGpuStatus?.statusMessage || 'Inicializando motor neuronal...'}
            </span>
          </div>
          <div class="ai-footer-actions">
            <button type="button" class="btn btn-secondary" id="btn-cancel-ai-modal">Cerrar</button>
            <button type="button" class="btn btn-primary" id="btn-apply-ai-modal">Aplicar Configuración</button>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private renderMasterWebBar(cfg: AiAssistanceConfig): string {
    return `
      <div class="ai-master-bar">
        <div class="ai-master-toggle-wrap">
          <label class="toggle-switch-label" for="ai-master-toggle">
            <input type="checkbox" id="ai-master-toggle" ${cfg.enabled ? 'checked' : ''} />
            <span class="toggle-slider"></span>
            <span class="toggle-title">Habilitar Asistencia por IA</span>
          </label>
          <span class="ai-master-hint text-muted">
            (Si está apagado, el 100% de los procesos se ejecutan con algoritmos matemáticos deterministas en WebAudio)
          </span>
        </div>

        <div class="ai-presets-group">
          <span class="presets-label">Perfiles Rápidos:</span>
          <button type="button" class="btn btn-sm btn-preset" id="btn-preset-all-dsp" title="Todo por algoritmos matemáticos clásicos (rápido y determinista)">
            ${ICONS.cpu} 100% DSP
          </button>
          <button type="button" class="btn btn-sm btn-preset btn-preset-highlight" id="btn-preset-hybrid" title="Mezcla óptima recomendada (DSP Sinc + Separación y Outpainting IA)">
            ${ICONS.zap} Híbrido Óptimo
          </button>
          <button type="button" class="btn btn-sm btn-preset btn-preset-ai" id="btn-preset-all-ai" title="Todas las etapas asistidas por IA">
            ${ICONS.ai} Máxima Calidad IA
          </button>
        </div>
      </div>
    `;
  }

  private renderWebTab(cfg: AiAssistanceConfig): string {
    return `
      <div class="ai-hw-banner" id="ai-hw-banner">
        <div class="ai-hw-indicator">
          <span class="hw-icon">${ICONS.cpu}</span>
          <div class="hw-text">
            <strong>Aceleración de Hardware del Navegador</strong>
            <span id="ai-hw-desc">${this.webGpuStatus?.statusMessage ?? 'Detectando capacidades WebGPU/WASM...'}</span>
          </div>
        </div>
        <div class="ai-hw-guarantee">
          <span>0 Servidores</span> &bull; <span>0 Coste</span> &bull; <span>100% Privado en Cliente</span>
        </div>
      </div>

      <div class="ai-stages-matrix">
        <!-- 1. Master Wave -->
        <div class="stage-card">
          <div class="stage-header">
            <span class="stage-num">1</span>
            <div class="stage-info">
              <h4 class="stage-title">Master Wave Standard (24-bit / 96 kHz)</h4>
              <p class="stage-desc text-muted">Remuestreo de alta fidelidad y reconstrucción de frecuencias armónicas superiores.</p>
            </div>
          </div>
          <div class="stage-options">
            <label class="stage-opt ${cfg.masterWave === 'dsp' ? 'is-selected' : ''}">
              <input type="radio" name="opt-master-wave" value="dsp" ${cfg.masterWave === 'dsp' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.cpu} Algorítmico (DSP)</strong>
                <small>Sinc polifásico lineal + saturador armónico. Cero artefactos de red, fase coherente.</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.masterWave === 'ai' ? 'is-selected' : ''}">
              <input type="radio" name="opt-master-wave" value="ai" ${cfg.masterWave === 'ai' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.ai} Modelo Neuronal (AudioSR)</strong>
                <small>Difusión latente para sintetizar aire y brillo ultrasónico (>20 kHz) en samples oscuros.</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.masterWave === 'bypass' ? 'is-selected' : ''}">
              <input type="radio" name="opt-master-wave" value="bypass" ${cfg.masterWave === 'bypass' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.bypass} Original / Bypass</strong>
                <small>Conservar la frecuencia de muestreo y profundidad de bits originales sin tocar.</small>
              </span>
            </label>
          </div>
        </div>

        <!-- 2. Scape vs Sphere -->
        <div class="stage-card">
          <div class="stage-header">
            <span class="stage-num">2</span>
            <div class="stage-info">
              <h4 class="stage-title">Separación Transitorio vs. Resonancia (Scape / Sphere)</h4>
              <p class="stage-desc text-muted">División de la onda en componente impulsiva (ataque) y armónicos estacionarios.</p>
            </div>
          </div>
          <div class="stage-options">
            <label class="stage-opt ${cfg.separation === 'dsp' ? 'is-selected' : ''}">
              <input type="radio" name="opt-separation" value="dsp" ${cfg.separation === 'dsp' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.cpu} Algorítmico (HPSS)</strong>
                <small>Filtros de mediana espectral STFT en tiempo real (Harmonic/Percussive Separation).</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.separation === 'ai' ? 'is-selected' : ''}">
              <input type="radio" name="opt-separation" value="ai" ${cfg.separation === 'ai' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.ai} Modelo IA (HTDemucs)</strong>
                <small>Separación neuronal de precisión para aislar la percusión del cuerpo resonante.</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.separation === 'bypass' ? 'is-selected' : ''}">
              <input type="radio" name="opt-separation" value="bypass" ${cfg.separation === 'bypass' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.bypass} Directo 1:1</strong>
                <small>Misma señal analizada para Scape y Sphere sin particionar fuentes.</small>
              </span>
            </label>
          </div>
        </div>

        <!-- 3. Loop Expansion -->
        <div class="stage-card">
          <div class="stage-header">
            <span class="stage-num">3</span>
            <div class="stage-info">
              <h4 class="stage-title">Expansión de Sostenido & Auto-Loop</h4>
              <p class="stage-desc text-muted">Tratamiento de bucles sostenidos para eliminar el zumbido de micro-loop repetitivo.</p>
            </div>
          </div>
          <div class="stage-options">
            <label class="stage-opt ${cfg.loopExpansion === 'dsp' ? 'is-selected' : ''}">
              <input type="radio" name="opt-loop" value="dsp" ${cfg.loopExpansion === 'dsp' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.cpu} Algorítmico (NCC + Zero-Crossing)</strong>
                <small>Empalme geométrico exacto de cruces por cero sin alterar el timbre original.</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.loopExpansion === 'ai' ? 'is-selected' : ''}">
              <input type="radio" name="opt-loop" value="ai" ${cfg.loopExpansion === 'ai' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.ai} Audio Outpainting IA</strong>
                <small>Genera evolución temporal continua para sostener notas largas sin bucles estáticos.</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.loopExpansion === 'manual' ? 'is-selected' : ''}">
              <input type="radio" name="opt-loop" value="manual" ${cfg.loopExpansion === 'manual' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.bypass} Puntos Manuales</strong>
                <small>Respetar estrictamente los puntos fijados a mano por el usuario en el editor.</small>
              </span>
            </label>
          </div>
        </div>

        <!-- 4. Classifier -->
        <div class="stage-card">
          <div class="stage-header">
            <span class="stage-num">4</span>
            <div class="stage-info">
              <h4 class="stage-title">Clasificación Tímbrica y Parameter Set (0..9)</h4>
              <p class="stage-desc text-muted">Asignación automática de los ejes de síntesis (Cuerdas, Pianos, Maderas, Pads...).</p>
            </div>
          </div>
          <div class="stage-options">
            <label class="stage-opt ${cfg.classifier === 'dsp' ? 'is-selected' : ''}">
              <input type="radio" name="opt-classifier" value="dsp" ${cfg.classifier === 'dsp' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.cpu} Algorítmico Heurístico</strong>
                <small>Cálculo de centroide espectral, tiempo de ataque y relación armónico/inarmónico.</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.classifier === 'ai' ? 'is-selected' : ''}">
              <input type="radio" name="opt-classifier" value="ai" ${cfg.classifier === 'ai' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.ai} Clasificador Neuronal</strong>
                <small>Reconocimiento tímbrico profundo por embeddings acústicos en WebGPU.</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.classifier === 'manual' ? 'is-selected' : ''}">
              <input type="radio" name="opt-classifier" value="manual" ${cfg.classifier === 'manual' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.bypass} Selección Manual</strong>
                <small>Elegir manualmente el Parameter Set 0..9 en el panel principal.</small>
              </span>
            </label>
          </div>
        </div>

        <!-- 5. Denoise -->
        <div class="stage-card">
          <div class="stage-header">
            <span class="stage-num">5</span>
            <div class="stage-info">
              <h4 class="stage-title">Reducción de Ruido y Restauración</h4>
              <p class="stage-desc text-muted">Supresión de soplido de cinta analógica y ruido de fondo de grabaciones antiguas.</p>
            </div>
          </div>
          <div class="stage-options">
            <label class="stage-opt ${cfg.denoise === 'dsp' ? 'is-selected' : ''}">
              <input type="radio" name="opt-denoise" value="dsp" ${cfg.denoise === 'dsp' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.cpu} Algorítmico (Puerta Multibanda)</strong>
                <small>Atenuación estática según suelo de ruido sin alterar la fase musical.</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.denoise === 'ai' ? 'is-selected' : ''}">
              <input type="radio" name="opt-denoise" value="ai" ${cfg.denoise === 'ai' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.ai} Denoise IA (DeepFilter)</strong>
                <small>Filtrado neuronal adaptativo que preserva los armónicos sutiles del instrumento.</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.denoise === 'bypass' ? 'is-selected' : ''}">
              <input type="radio" name="opt-denoise" value="bypass" ${cfg.denoise === 'bypass' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.bypass} Desactivado / Crudo</strong>
                <small>Preservar la grabación íntegra sin aplicar ningún reductor de ruido.</small>
              </span>
            </label>
          </div>
        </div>
      </div>
    `;
  }

  private renderCloudTab(): string {
    const byok = cloudByokClient.getConfig();
    const currentToken =
      byok.provider === 'replicate'
        ? byok.replicateToken ?? ''
        : byok.provider === 'huggingface'
          ? byok.huggingfaceToken ?? ''
          : byok.geminiApiKey ?? '';

    return `
      <div class="ai-byok-container">
        <!-- Privacy & Direct Billing Guarantee Banner -->
        <div class="byok-guarantee-card">
          <div class="guarantee-icon">${ICONS.lock}</div>
          <div class="guarantee-content">
            <h4>Garantía Estricta de Privacidad y Coste Cero para el Servidor</h4>
            <p>
              Tus claves API se almacenan <strong>única y exclusivamente en tu navegador (localStorage)</strong>.
              Jamás se envían ni se guardan en ningún servidor de ABDSynths. Todas las solicitudes viajan de forma directa desde tu navegador hacia el proveedor oficial, y los costes de computación de la GPU Cloud se cargan a tu cuenta personal.
            </p>
          </div>
        </div>

        <!-- BYOK Config Form -->
        <div class="byok-form-card">
          <div class="byok-header-row">
            <label class="toggle-switch-label" for="byok-enable-toggle">
              <input type="checkbox" id="byok-enable-toggle" ${byok.enabled ? 'checked' : ''} />
              <span class="toggle-slider"></span>
              <span class="toggle-title">Habilitar Cloud AI (BYOK)</span>
            </label>
            <span class="byok-status-pill ${byok.enabled ? 'is-active' : 'is-inactive'}">
              ${byok.enabled ? 'Cloud AI Habilitado' : 'Cloud AI Inactivo'}
            </span>
          </div>

          <div class="byok-field-group">
            <label class="byok-field-label">Proveedor Cloud Preferido:</label>
            <div class="byok-provider-grid">
              <label class="byok-provider-opt ${byok.provider === 'replicate' ? 'is-selected' : ''}">
                <input type="radio" name="byok-provider" value="replicate" ${byok.provider === 'replicate' ? 'checked' : ''} />
                <span class="provider-title">Replicate</span>
                <span class="provider-desc">Ideal para AudioSR (Super-resolución a 96kHz) y MusicGen.</span>
              </label>
              <label class="byok-provider-opt ${byok.provider === 'huggingface' ? 'is-selected' : ''}">
                <input type="radio" name="byok-provider" value="huggingface" ${byok.provider === 'huggingface' ? 'checked' : ''} />
                <span class="provider-title">Hugging Face</span>
                <span class="provider-desc">Inference Endpoints para Demucs y clasificadores de timbre.</span>
              </label>
              <label class="byok-provider-opt ${byok.provider === 'gemini' ? 'is-selected' : ''}">
                <input type="radio" name="byok-provider" value="gemini" ${byok.provider === 'gemini' ? 'checked' : ''} />
                <span class="provider-title">Google Gemini</span>
                <span class="provider-desc">Análisis semántico acústico y generación de metadatos de modelos.</span>
              </label>
            </div>
          </div>

          <div class="byok-field-group">
            <label class="byok-field-label" for="byok-api-key-input">
              Clave API / Token de Acceso Personal (${byok.provider.toUpperCase()}):
            </label>
            <div class="byok-input-wrapper">
              <span class="byok-input-icon">${ICONS.key}</span>
              <input
                type="${this.showPassword ? 'text' : 'password'}"
                id="byok-api-key-input"
                class="byok-input"
                placeholder="Introduce tu clave API (ej. r8_... o hf_...)"
                value="${currentToken}"
                autocomplete="off"
                spellcheck="false"
              />
              <button type="button" class="btn btn-hud-icon byok-eye-btn" id="btn-toggle-eye" title="${this.showPassword ? 'Ocultar clave' : 'Mostrar clave'}">
                ${this.showPassword ? ICONS.eyeOff : ICONS.eye}
              </button>
            </div>
          </div>

          <div class="byok-actions-row">
            <button type="button" class="btn btn-outline" id="btn-test-byok" ${this.isTestingByok ? 'disabled' : ''}>
              ${this.isTestingByok ? `${ICONS.refresh} Comprobando...` : `${ICONS.zap} Verificar Conexión con Proveedor`}
            </button>
            <button type="button" class="btn btn-text text-danger" id="btn-clear-byok">
              ${ICONS.trash} Borrar Clave de este Navegador
            </button>
          </div>

          ${
            this.byokTestResult
              ? `
            <div class="byok-test-banner ${this.byokTestResult.success ? 'is-success' : 'is-error'}">
              <span class="test-icon">${this.byokTestResult.success ? ICONS.check : ICONS.alert}</span>
              <span class="test-msg">${this.byokTestResult.message}</span>
            </div>
          `
              : ''
          }
        </div>
      </div>
    `;
  }

  private renderBridgeTab(): string {
    const bridge = bridgeClient.getStatus();
    const isOnline = bridge.connected;

    return `
      <div class="ai-bridge-tab-container">
        <!-- Status Card -->
        <div class="bridge-status-card ${isOnline ? 'is-connected' : 'is-disconnected'}">
          <div class="bridge-card-header">
            <div class="bridge-card-title">
              <span class="bridge-dot ${isOnline ? 'dot-online' : 'dot-offline'}"></span>
              <strong>Companion Bridge Local (Python &amp; GPU)</strong>
            </div>
            <span class="bridge-badge">${isOnline ? 'EN LÍNEA (7860)' : 'DESCONECTADO'}</span>
          </div>

          <div class="bridge-details-grid">
            <div class="bridge-detail-item">
              <span class="detail-label">Endpoint Local:</span>
              <span class="detail-value"><code>${bridge.url}</code></span>
            </div>
            <div class="bridge-detail-item">
              <span class="detail-label">Dispositivo Hardware:</span>
              <span class="detail-value">${bridge.capabilities?.device ?? 'N/A'} (${bridge.capabilities?.gpu_name || 'CPU Fallback'})</span>
            </div>
            <div class="bridge-detail-item">
              <span class="detail-label">Aceleración GPU:</span>
              <span class="detail-value">${bridge.capabilities?.gpu ? 'Activada (CUDA / VRAM)' : 'Desactivada'}</span>
            </div>
            <div class="bridge-detail-item">
              <span class="detail-label">Latencia Loopback:</span>
              <span class="detail-value">${bridge.latencyMs ?? 0} ms</span>
            </div>
          </div>

          ${
            !isOnline
              ? `
            <div class="bridge-offline-instructions">
              <p>
                El Companion Bridge permite exprimir tu GPU local (por ejemplo, RTX 3070 8GB VRAM) para procesar modelos sin consumir cuota de red.
                Para arrancarlo, ejecuta en tu terminal:
              </p>
              <pre class="bridge-code-snippet"><code>start.bat  (Arranca la app y el Bridge minimizado)
o bien:
cd bridge &amp;&amp; run_bridge.bat</code></pre>
              <div class="bridge-retry-row">
                <button type="button" class="btn btn-sm btn-outline" id="btn-bridge-retry">
                  ${ICONS.refresh} Reintentar Conexión Ahora
                </button>
              </div>
            </div>
          `
              : ''
          }
        </div>

        <!-- Models Downloader Section -->
        <div class="bridge-models-section">
          <div class="models-section-header">
            <div class="header-left">
              <h4>Catálogo de Modelos Neuronales Locales</h4>
              <p class="text-muted">
                Pre-descarga transparente multihilo directamente a tu GPU local.
                <br/>
                <small style="opacity: 0.85;">(Nota: Si no los descargas aquí, el sistema los descargará de forma 100% transparente y automática la primera vez que actives su función en el proyecto).</small>
              </p>
            </div>
            <button type="button" class="btn btn-xs btn-outline" id="btn-refresh-models">
              ${ICONS.refresh} Actualizar Lista
            </button>
          </div>

          <div class="models-list" id="bridge-models-list">
            ${this.buildBridgeModelsHtml()}
          </div>
        </div>
      </div>
    `;
  }

  private buildBridgeModelsHtml(): string {
    if (!bridgeClient.isConnected()) {
      return `
        <div class="models-empty-state text-muted">
          Conecta el Companion Bridge en local para gestionar y descargar modelos neuronales a tu GPU.
        </div>
      `;
    }

    if (this.bridgeModels.length === 0) {
      return `
        <div class="models-empty-state text-muted">
          Cargando catálogo de modelos disponibles...
        </div>
      `;
    }

    return this.bridgeModels
      .map((m) => {
        const isDownloading = m.status === 'downloading' || this.activePollingModelIds.has(m.id);
        const pct = Math.min(100, Math.max(0, Math.round(m.progress)));
        const dlMb = m.downloaded_bytes ? (m.downloaded_bytes / (1024 * 1024)).toFixed(1) : '0';
        const totMb = m.total_bytes
          ? (m.total_bytes / (1024 * 1024)).toFixed(0)
          : m.size_mb.toString();
        const speedText = m.speed_mbps && m.speed_mbps > 0 ? ` &bull; ${m.speed_mbps.toFixed(1)} MB/s` : '';

        const sizeDisplay = m.size_mb >= 1000
          ? `${(m.size_mb / 1024).toFixed(1)} GB`
          : `${m.size_mb} MB`;

        return `
        <div class="model-row-card ${m.installed ? 'is-installed' : ''}" data-model-id="${m.id}">
          <div class="model-row-main">
            <div class="model-row-title">
              <strong>${m.name}</strong>
              <span class="model-size-badge">${sizeDisplay}</span>
              <span class="model-task-badge">${m.task}</span>
            </div>
            <p class="model-row-desc text-muted">${m.description}</p>
            ${
              isDownloading
                ? `
              <div class="model-progress-bar-wrap">
                <div class="model-progress-bar-bg">
                  <div class="model-progress-bar" style="width: ${pct}%"></div>
                </div>
                <span class="model-progress-text">${pct}% &bull; ${dlMb} / ${totMb} MB${speedText}</span>
              </div>
            `
                : ''
            }
          </div>
          <div class="model-row-action">
            ${
              m.installed
                ? `
                <span class="badge-installed">${ICONS.check} Instalado en Disco</span>
                <button type="button" class="btn btn-sm btn-outline btn-delete-model" data-id="${m.id}" title="Eliminar este modelo del disco para liberar espacio">
                  ${ICONS.trash} Desinstalar
                </button>
              `
                : isDownloading
                  ? `<button type="button" class="btn btn-sm btn-outline btn-downloading" disabled>
                      <span class="btn-spinner">${ICONS.spinner}</span>
                      <span>Descargando (${pct}%)...</span>
                    </button>`
                  : `<button type="button" class="btn btn-sm btn-primary btn-download-model" data-id="${m.id}">
                      ${ICONS.zap} Descargar (${sizeDisplay})
                    </button>`
            }
          </div>
        </div>
      `;
      })
      .join('');
  }

  private renderBridgeModelsList(): void {
    if (!this.backdropEl) return;
    const container = this.backdropEl.querySelector('#bridge-models-list');
    if (container) {
      container.innerHTML = this.buildBridgeModelsHtml();
      this.bindBridgeModelActions();
    }
  }

  private updateHardwareBadge(): void {
    if (!this.backdropEl) return;
    const desc = this.backdropEl.querySelector('#ai-hw-desc');
    if (desc && this.webGpuStatus) {
      desc.textContent = this.webGpuStatus.statusMessage;
    }
    const footerStatus = this.backdropEl.querySelector('#ai-footer-device-status');
    if (footerStatus && this.webGpuStatus) {
      footerStatus.textContent = this.webGpuStatus.statusMessage;
    }
  }

  private updateBridgeBadge(): void {
    if (!this.backdropEl || this.currentTab !== 'bridge') return;
    const card = this.backdropEl.querySelector('.bridge-status-card');
    if (card) {
      this.render();
    }
  }

  private bindEvents(): void {
    if (!this.backdropEl) return;

    const close = () => this.close();
    this.backdropEl.querySelector('#btn-close-ai-modal')?.addEventListener('click', close);
    this.backdropEl.querySelector('#btn-cancel-ai-modal')?.addEventListener('click', close);

    // Escape key
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !this.backdropEl?.classList.contains('is-hidden')) {
        close();
      }
    };
    window.addEventListener('keydown', onKey);

    // Tab buttons
    this.backdropEl.querySelectorAll<HTMLButtonElement>('.ai-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab as ModalTab;
        if (tab && tab !== this.currentTab) {
          this.currentTab = tab;
          this.render();
        }
      });
    });

    if (this.currentTab === 'web') {
      this.bindWebTabEvents();
    } else if (this.currentTab === 'cloud') {
      this.bindCloudTabEvents();
    } else if (this.currentTab === 'bridge') {
      this.bindBridgeTabEvents();
    }

    // Apply button
    this.backdropEl.querySelector('#btn-apply-ai-modal')?.addEventListener('click', () => {
      this.handlers.onUpdateAiConfig({ ...this.currentConfig });
      const activeCount = this.countActiveAiStages();
      if (this.currentConfig.enabled) {
        toast(`Configuración aplicada: Asistencia IA activa (${activeCount}/5 etapas)`, 'success');
      } else {
        toast('Configuración aplicada: Modo 100% Algorítmico (DSP Puro)', 'info');
      }
      this.close();
    });
  }

  private bindWebTabEvents(): void {
    if (!this.backdropEl) return;

    // Master toggle
    const masterToggle = this.backdropEl.querySelector<HTMLInputElement>('#ai-master-toggle');
    masterToggle?.addEventListener('change', () => {
      this.currentConfig.enabled = masterToggle.checked;
      this.syncActiveBadge();
    });

    // Presets
    this.backdropEl.querySelector('#btn-preset-all-dsp')?.addEventListener('click', () => {
      this.currentConfig = {
        enabled: false,
        masterWave: 'dsp',
        separation: 'dsp',
        loopExpansion: 'dsp',
        classifier: 'dsp',
        denoise: 'dsp',
      };
      this.render();
      toast('Perfil aplicado: 100% Algorítmico (DSP Puro)', 'info');
    });

    this.backdropEl.querySelector('#btn-preset-hybrid')?.addEventListener('click', () => {
      this.currentConfig = {
        enabled: true,
        masterWave: 'dsp',
        separation: 'ai',
        loopExpansion: 'ai',
        classifier: 'dsp',
        denoise: 'dsp',
      };
      this.render();
      toast('Perfil aplicado: Híbrido Óptimo (DSP Sinc + Separación y Outpainting IA)', 'success');
    });

    this.backdropEl.querySelector('#btn-preset-all-ai')?.addEventListener('click', () => {
      this.currentConfig = {
        enabled: true,
        masterWave: 'ai',
        separation: 'ai',
        loopExpansion: 'ai',
        classifier: 'ai',
        denoise: 'ai',
      };
      this.render();
      toast('Perfil aplicado: Máxima Calidad IA en todas las etapas', 'success');
    });

    // Stage radios
    const bindRadios = (name: string, update: (val: string) => void) => {
      this.backdropEl?.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach((r) => {
        r.addEventListener('change', () => {
          if (r.checked) {
            update(r.value);
            if (r.value === 'ai' && !this.currentConfig.enabled) {
              this.currentConfig.enabled = true;
              const toggle = this.backdropEl?.querySelector<HTMLInputElement>('#ai-master-toggle');
              if (toggle) toggle.checked = true;
            }
            this.syncActiveBadge();
            this.syncOptionSelectionClasses();
          }
        });
      });
    };

    bindRadios('opt-master-wave', (val) => { this.currentConfig.masterWave = val as MasterWaveMethod; });
    bindRadios('opt-separation', (val) => { this.currentConfig.separation = val as SeparationMethod; });
    bindRadios('opt-loop', (val) => { this.currentConfig.loopExpansion = val as LoopExpansionMethod; });
    bindRadios('opt-classifier', (val) => { this.currentConfig.classifier = val as ClassifierMethod; });
    bindRadios('opt-denoise', (val) => { this.currentConfig.denoise = val as DenoiseMethod; });
  }

  private bindCloudTabEvents(): void {
    if (!this.backdropEl) return;

    // Toggle show/hide password
    this.backdropEl.querySelector('#btn-toggle-eye')?.addEventListener('click', () => {
      this.showPassword = !this.showPassword;
      this.render();
    });

    // BYOK Enable toggle
    const enableToggle = this.backdropEl.querySelector<HTMLInputElement>('#byok-enable-toggle');
    enableToggle?.addEventListener('change', () => {
      cloudByokClient.saveConfig({ enabled: enableToggle.checked });
      this.render();
    });

    // Provider radio selection
    this.backdropEl.querySelectorAll<HTMLInputElement>('input[name="byok-provider"]').forEach((r) => {
      r.addEventListener('change', () => {
        if (r.checked) {
          const provider = r.value as CloudAiProvider;
          cloudByokClient.saveConfig({ provider });
          this.byokTestResult = null;
          this.render();
        }
      });
    });

    // API Key input change
    const keyInput = this.backdropEl.querySelector<HTMLInputElement>('#byok-api-key-input');
    keyInput?.addEventListener('input', () => {
      const val = keyInput.value.trim();
      const currentProvider = cloudByokClient.getConfig().provider;
      if (currentProvider === 'replicate') {
        cloudByokClient.saveConfig({ replicateToken: val });
      } else if (currentProvider === 'huggingface') {
        cloudByokClient.saveConfig({ huggingfaceToken: val });
      } else if (currentProvider === 'gemini') {
        cloudByokClient.saveConfig({ geminiApiKey: val });
      }
    });

    // Test connection button
    this.backdropEl.querySelector('#btn-test-byok')?.addEventListener('click', async () => {
      const provider = cloudByokClient.getConfig().provider;
      const key = keyInput?.value.trim() ?? '';
      this.isTestingByok = true;
      this.byokTestResult = null;
      this.render();

      const result = await cloudByokClient.testConnection(provider, key);
      this.isTestingByok = false;
      this.byokTestResult = result;
      this.render();
    });

    // Clear key button
    this.backdropEl.querySelector('#btn-clear-byok')?.addEventListener('click', () => {
      cloudByokClient.clearConfig();
      this.byokTestResult = null;
      this.render();
      toast('Claves borradas del almacenamiento local del navegador', 'info');
    });
  }

  private bindBridgeTabEvents(): void {
    if (!this.backdropEl) return;

    this.backdropEl.querySelector('#btn-bridge-retry')?.addEventListener('click', async () => {
      toast('Comprobando Companion Bridge...', 'info');
      await bridgeClient.checkHealth();
      await this.refreshBridgeModels();
      this.render();
    });

    this.backdropEl.querySelector('#btn-refresh-models')?.addEventListener('click', async () => {
      await this.refreshBridgeModels();
      this.render();
    });

    this.bindBridgeModelActions();
  }

  private bindBridgeModelActions(): void {
    if (!this.backdropEl) return;

    this.backdropEl.querySelectorAll<HTMLButtonElement>('.btn-download-model').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const modelId = btn.dataset.id;
        if (!modelId) return;

        this.activePollingModelIds.add(modelId);
        const m = this.bridgeModels.find((x) => x.id === modelId);
        if (m) {
          m.status = 'downloading';
        }
        this.renderBridgeModelsList();
        toast(`Iniciando descarga multihilo de "${m?.name || modelId}" en el Bridge...`, 'info');

        try {
          await bridgeClient.downloadModel(modelId);
          this.startModelProgressPolling(modelId);
        } catch (err) {
          this.activePollingModelIds.delete(modelId);
          if (m) {
            m.status = 'error';
          }
          toast(`Error al iniciar descarga: ${String(err)}`, 'error');
          this.renderBridgeModelsList();
        }
      });
    });

    // Delete / Uninstall buttons
    this.backdropEl.querySelectorAll<HTMLButtonElement>('.btn-delete-model').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const modelId = btn.dataset.id;
        if (!modelId) return;
        const m = this.bridgeModels.find((x) => x.id === modelId);
        const confirmed = window.confirm(
          `¿Deseas desinstalar "${m?.name || modelId}" de tu disco local para liberar espacio?`
        );
        if (!confirmed) return;

        try {
          const res = await bridgeClient.deleteModel(modelId);
          if (m) {
            m.installed = false;
            m.status = 'available';
            m.progress = 0;
            m.downloaded_bytes = 0;
          }
          toast(`Modelo desinstalado: ${res.freed_mb ?? 0} MB liberados en disco`, 'info');
          this.renderBridgeModelsList();
        } catch (err) {
          toast(`Error al desinstalar modelo: ${String(err)}`, 'error');
        }
      });
    });
  }

  private startModelProgressPolling(modelId: string): void {
    this.activePollingModelIds.add(modelId);
    if (this.downloadPollTimer) return;

    this.downloadPollTimer = setInterval(async () => {
      if (this.activePollingModelIds.size === 0) {
        if (this.downloadPollTimer) {
          clearInterval(this.downloadPollTimer);
          this.downloadPollTimer = null;
        }
        return;
      }

      for (const mId of Array.from(this.activePollingModelIds)) {
        try {
          const prog = await bridgeClient.getModelProgress(mId);
          const model = this.bridgeModels.find((m) => m.id === mId);
          if (model) {
            model.progress = prog.progress;
            model.status = prog.status as BridgeModelInfo['status'];
            model.downloaded_bytes = prog.downloaded_bytes;
            model.total_bytes = prog.total_bytes;
            model.speed_mbps = prog.speed_mbps;

            if (prog.status === 'ready' || (prog.progress >= 100 && prog.status !== 'error')) {
              model.installed = true;
              model.status = 'ready';
              model.progress = 100;
              this.activePollingModelIds.delete(mId);
              toast(`Modelo "${model.name}" descargado y listo en disco / GPU`, 'success');
            } else if (prog.status === 'error') {
              this.activePollingModelIds.delete(mId);
              toast(`Fallo en la descarga de "${model.name}": ${prog.error ?? 'Error de red'}`, 'error');
            }
          }
        } catch {
          // transient poll error
        }
      }
      this.renderBridgeModelsList();
    }, 1000);
  }

  private syncActiveBadge(): void {
    if (!this.backdropEl) return;
    const badge = this.backdropEl.querySelector('#ai-active-badge');
    if (badge) {
      const activeAiCount = this.countActiveAiStages();
      badge.className = `panel-badge ${this.currentConfig.enabled ? 'badge-ai-on' : 'badge-muted'}`;
      badge.textContent = this.currentConfig.enabled
        ? `IA: ${activeAiCount}/5 ETAPAS`
        : 'DSP PURO (IA OFF)';
    }
  }

  private syncOptionSelectionClasses(): void {
    if (!this.backdropEl) return;
    this.backdropEl.querySelectorAll('.stage-opt').forEach((label) => {
      const input = label.querySelector<HTMLInputElement>('input[type="radio"]');
      label.classList.toggle('is-selected', Boolean(input?.checked));
    });
  }
}
