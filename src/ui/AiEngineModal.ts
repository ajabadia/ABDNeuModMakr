// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — AI Assistance & DSP Engine Matrix Modal
// Allows granular per-stage selection between 100% deterministic
// local DSP and local AI Companion Bridge neural models, with
// presets and instant live status.
// ─────────────────────────────────────────────────────────

import type {
  AiAssistanceConfig,
  ClassifierMethod,
  DenoiseMethod,
  LoopExpansionMethod,
  MasterWaveMethod,
  SeparationMethod,
} from '../core/types';
import { bridgeClient, type BridgeStatus } from '../core/bridge/BridgeClient';
import { ICONS } from './icons';
import { toast } from './notify';

export interface AiEngineModalHandlers {
  onUpdateAiConfig: (config: AiAssistanceConfig) => void;
  onOpenBridgeStatus?: () => void;
}

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
  private handlers: AiEngineModalHandlers;
  private unsubscribeBridge: (() => void) | null = null;

  constructor(handlers: AiEngineModalHandlers) {
    this.handlers = handlers;
  }

  public open(config: AiAssistanceConfig): void {
    this.currentConfig = { ...config };

    if (!this.backdropEl) {
      this.backdropEl = document.createElement('div');
      this.backdropEl.className = 'modal-backdrop is-hidden';
      document.body.appendChild(this.backdropEl);
    }

    this.render();
    this.backdropEl.classList.remove('is-hidden');

    this.unsubscribeBridge = bridgeClient.subscribe(() => {
      this.updateBridgeBadge();
    });
    void bridgeClient.checkHealth();
  }

  public close(): void {
    if (this.unsubscribeBridge) {
      this.unsubscribeBridge();
      this.unsubscribeBridge = null;
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

  private render(): void {
    if (!this.backdropEl) return;
    const cfg = this.currentConfig;
    const bridge = bridgeClient.getStatus();
    const activeAiCount = this.countActiveAiStages();

    this.backdropEl.innerHTML = `
      <div class="process-modal-card ai-engine-modal-card" role="dialog" aria-modal="true" aria-label="AI & DSP Processing Engine Matrix">
        <!-- Header -->
        <div class="modal-header ai-modal-header">
          <div class="modal-title">
            <span class="modal-icon">${ICONS.cpu}</span>
            <span>MOTOR DE PROCESADO: DSP VS. ASISTENCIA IA</span>
            <span class="panel-badge ${cfg.enabled ? 'badge-ai-on' : 'badge-muted'}" id="ai-active-badge">
              ${cfg.enabled ? `✨ IA: ${activeAiCount}/5 ETAPAS` : '⚙️ DSP PURO (IA OFF)'}
            </span>
          </div>
          <button type="button" class="btn btn-close-modal" id="btn-close-ai-modal" title="Close (Esc)">
            ${ICONS.close}
          </button>
        </div>

        <!-- Master Switch & Presets Bar -->
        <div class="ai-master-bar">
          <div class="ai-master-toggle-wrap">
            <label class="toggle-switch-label" for="ai-master-toggle">
              <input type="checkbox" id="ai-master-toggle" ${cfg.enabled ? 'checked' : ''} />
              <span class="toggle-slider"></span>
              <span class="toggle-title">Habilitar Asistencia por IA</span>
            </label>
            <span class="ai-master-hint text-muted">
              (Si está desactivada, el 100% de los procesos se ejecutan con algoritmos matemáticos deterministas en WebAudio)
            </span>
          </div>

          <div class="ai-presets-group">
            <span class="presets-label">Perfiles Rápidos:</span>
            <button type="button" class="btn btn-sm btn-preset" id="btn-preset-all-dsp" title="Todo por algoritmos matemáticos clásicos (rápido y determinista)">
              ⚙️ 100% DSP
            </button>
            <button type="button" class="btn btn-sm btn-preset btn-preset-highlight" id="btn-preset-hybrid" title="Mezcla óptima recomendada (Super-res DSP + Separación y Outpainting IA)">
              ⚡ Híbrido Óptimo
            </button>
            <button type="button" class="btn btn-sm btn-preset" id="btn-preset-all-ai" title="Todas las etapas asistidas por modelos de IA">
              ✨ Máxima Calidad IA
            </button>
          </div>
        </div>

        <!-- Body: Modular Stages Matrix -->
        <div class="modal-body ai-modal-body">
          <div class="ai-stages-matrix">
            <!-- 1. Master Wave -->
            <div class="stage-card">
              <div class="stage-header">
                <span class="stage-num">1</span>
                <div class="stage-info">
                  <h4 class="stage-title">Master Wave Standard (24-bit / 96 kHz)</h4>
                  <p class="stage-desc text-muted">Remuestreo de alta fidelidad y reconstrucción de frecuencias superiores perdidas.</p>
                </div>
              </div>
              <div class="stage-options">
                <label class="stage-opt ${cfg.masterWave === 'dsp' ? 'is-selected' : ''}">
                  <input type="radio" name="opt-master-wave" value="dsp" ${cfg.masterWave === 'dsp' ? 'checked' : ''} />
                  <span class="opt-body">
                    <strong>⚙️ Algorítmico (DSP)</strong>
                    <small>Sinc polifásico determinista + saturador de armónicos. Cero alucinaciones, fase lineal.</small>
                  </span>
                </label>
                <label class="stage-opt ${cfg.masterWave === 'ai' ? 'is-selected' : ''}">
                  <input type="radio" name="opt-master-wave" value="ai" ${cfg.masterWave === 'ai' ? 'checked' : ''} />
                  <span class="opt-body">
                    <strong>✨ Modelo IA (AudioSR)</strong>
                    <small>Reconstrucción por difusión latente de aire y brillo (>20 kHz) en grabaciones limitadas.</small>
                  </span>
                </label>
                <label class="stage-opt ${cfg.masterWave === 'bypass' ? 'is-selected' : ''}">
                  <input type="radio" name="opt-master-wave" value="bypass" ${cfg.masterWave === 'bypass' ? 'checked' : ''} />
                  <span class="opt-body">
                    <strong>✋ Original / Bypass</strong>
                    <small>Conservar la frecuencia de muestreo y bits originales sin procesar.</small>
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
                  <p class="stage-desc text-muted">División del sonido en excitación inicial (ataque) y cuerpo armónico resonante.</p>
                </div>
              </div>
              <div class="stage-options">
                <label class="stage-opt ${cfg.separation === 'dsp' ? 'is-selected' : ''}">
                  <input type="radio" name="opt-separation" value="dsp" ${cfg.separation === 'dsp' ? 'checked' : ''} />
                  <span class="opt-body">
                    <strong>⚙️ Algorítmico (HPSS)</strong>
                    <small>Filtros de mediana espectral STFT (Harmonic/Percussive Source Separation).</small>
                  </span>
                </label>
                <label class="stage-opt ${cfg.separation === 'ai' ? 'is-selected' : ''}">
                  <input type="radio" name="opt-separation" value="ai" ${cfg.separation === 'ai' ? 'checked' : ''} />
                  <span class="opt-body">
                    <strong>✨ Modelo IA (HTDemucs)</strong>
                    <small>Separación quirúrgica de fuentes neuronales para aislar el golpe del sostenido.</small>
                  </span>
                </label>
                <label class="stage-opt ${cfg.separation === 'bypass' ? 'is-selected' : ''}">
                  <input type="radio" name="opt-separation" value="bypass" ${cfg.separation === 'bypass' ? 'checked' : ''} />
                  <span class="opt-body">
                    <strong>✋ Directo 1:1</strong>
                    <small>Misma señal para Scape y Sphere sin separar componentes.</small>
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
                  <p class="stage-desc text-muted">Tratamiento de bucles sostenidos para evitar el efecto "avispero" mecánico.</p>
                </div>
              </div>
              <div class="stage-options">
                <label class="stage-opt ${cfg.loopExpansion === 'dsp' ? 'is-selected' : ''}">
                  <input type="radio" name="opt-loop" value="dsp" ${cfg.loopExpansion === 'dsp' ? 'checked' : ''} />
                  <span class="opt-body">
                    <strong>⚙️ Algorítmico (NCC + Zero-Crossing)</strong>
                    <small>Empalme geométrico exacto de cruces por cero sin alterar la muestra.</small>
                  </span>
                </label>
                <label class="stage-opt ${cfg.loopExpansion === 'ai' ? 'is-selected' : ''}">
                  <input type="radio" name="opt-loop" value="ai" ${cfg.loopExpansion === 'ai' ? 'checked' : ''} />
                  <span class="opt-body">
                    <strong>✨ Audio Outpainting IA</strong>
                    <small>Genera 4-6 segundos de evolución orgánica natural sin ciclos idénticos repetitivos.</small>
                  </span>
                </label>
                <label class="stage-opt ${cfg.loopExpansion === 'manual' ? 'is-selected' : ''}">
                  <input type="radio" name="opt-loop" value="manual" ${cfg.loopExpansion === 'manual' ? 'checked' : ''} />
                  <span class="opt-body">
                    <strong>✋ Puntos Manuales</strong>
                    <small>Respetar fielmente los puntos de loop fijados por el usuario en el editor.</small>
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
                  <p class="stage-desc text-muted">Asignación automática de los ejes de modelado acústico (Pianos, Cuerdas, Maderas, etc.).</p>
                </div>
              </div>
              <div class="stage-options">
                <label class="stage-opt ${cfg.classifier === 'dsp' ? 'is-selected' : ''}">
                  <input type="radio" name="opt-classifier" value="dsp" ${cfg.classifier === 'dsp' ? 'checked' : ''} />
                  <span class="opt-body">
                    <strong>⚙️ Algorítmico Heurístico</strong>
                    <small>Cálculo de centroide espectral, ataque temporal y distribución de armónicos.</small>
                  </span>
                </label>
                <label class="stage-opt ${cfg.classifier === 'ai' ? 'is-selected' : ''}">
                  <input type="radio" name="opt-classifier" value="ai" ${cfg.classifier === 'ai' ? 'checked' : ''} />
                  <span class="opt-body">
                    <strong>✨ Clasificador Neuronal</strong>
                    <small>Reconocimiento profundo de tímbrica y género de instrumento por embeddings de audio.</small>
                  </span>
                </label>
                <label class="stage-opt ${cfg.classifier === 'manual' ? 'is-selected' : ''}">
                  <input type="radio" name="opt-classifier" value="manual" ${cfg.classifier === 'manual' ? 'checked' : ''} />
                  <span class="opt-body">
                    <strong>✋ Selección Manual</strong>
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
                  <p class="stage-desc text-muted">Eliminación de soplido de cinta analógica y ruido de fondo de samples históricos.</p>
                </div>
              </div>
              <div class="stage-options">
                <label class="stage-opt ${cfg.denoise === 'dsp' ? 'is-selected' : ''}">
                  <input type="radio" name="opt-denoise" value="dsp" ${cfg.denoise === 'dsp' ? 'checked' : ''} />
                  <span class="opt-body">
                    <strong>⚙️ Algorítmico (Puerta Multibanda)</strong>
                    <small>Atenuación espectral por bandas según umbral de suelo de ruido estático.</small>
                  </span>
                </label>
                <label class="stage-opt ${cfg.denoise === 'ai' ? 'is-selected' : ''}">
                  <input type="radio" name="opt-denoise" value="ai" ${cfg.denoise === 'ai' ? 'checked' : ''} />
                  <span class="opt-body">
                    <strong>✨ Denoise IA (DeepFilter)</strong>
                    <small>Supresión neuronal de ruido conservando micro-armónicos y resonancias sutiles.</small>
                  </span>
                </label>
                <label class="stage-opt ${cfg.denoise === 'bypass' ? 'is-selected' : ''}">
                  <input type="radio" name="opt-denoise" value="bypass" ${cfg.denoise === 'bypass' ? 'checked' : ''} />
                  <span class="opt-body">
                    <strong>✋ Desactivado / Crudo</strong>
                    <small>Preservar la grabación tal como está sin ningún filtrado de ruido.</small>
                  </span>
                </label>
              </div>
            </div>
          </div>

          <!-- Bridge Connection Bar in Modal -->
          <div class="ai-bridge-footer-bar" id="ai-bridge-footer-bar">
            ${this.buildBridgeStatusBanner(bridge)}
          </div>
        </div>

        <!-- Footer -->
        <div class="modal-footer ai-modal-footer">
          <button type="button" class="btn btn-secondary" id="btn-cancel-ai-modal">Cerrar</button>
          <button type="button" class="btn btn-primary" id="btn-apply-ai-modal">Aplicar Configuración</button>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private buildBridgeStatusBanner(bridge: BridgeStatus): string {
    const isOnline = bridge.connected;
    if (isOnline) {
      return `
        <div class="bridge-status-mini is-online">
          <span class="mini-dot dot-online"></span>
          <span>Companion Bridge Conectado (<code>${bridge.url}</code> &bull; ${bridge.latencyMs ?? 0} ms &bull; ${bridge.capabilities?.device ?? 'CPU'})</span>
        </div>
      `;
    }
    return `
      <div class="bridge-status-mini is-offline">
        <span class="mini-dot dot-offline"></span>
        <span>Companion Bridge Desconectado (<code>${bridge.url}</code>). Las etapas configuradas en IA usarán automáticamente el fallback DSP hasta que ejecutes <code>bridge\\run_bridge.bat</code>.</span>
        <button type="button" class="btn btn-xs btn-outline" id="btn-open-bridge-help">Ver Instrucciones</button>
      </div>
    `;
  }

  private updateBridgeBadge(): void {
    if (!this.backdropEl) return;
    const bar = this.backdropEl.querySelector('#ai-bridge-footer-bar');
    if (bar) {
      bar.innerHTML = this.buildBridgeStatusBanner(bridgeClient.getStatus());
      bar.querySelector('#btn-open-bridge-help')?.addEventListener('click', () => {
        this.close();
        this.handlers.onOpenBridgeStatus?.();
      });
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
        masterWave: 'dsp', // DSP sinc is mathematically linear phase & bit-perfect
        separation: 'ai',  // Demucs is superior for transient/harmonic separation
        loopExpansion: 'ai', // Outpainting avoids micro-loop buzzing
        classifier: 'dsp', // Fast local heuristics
        denoise: 'dsp',    // Multiband gate
      };
      this.render();
      toast('Perfil aplicado: Híbrido Óptimo (DSP para audio exacto, IA para sostenido y separación)', 'success');
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

    // Stage radio changes
    const bindRadios = (name: string, update: (val: string) => void) => {
      this.backdropEl?.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach((r) => {
        r.addEventListener('change', () => {
          if (r.checked) {
            update(r.value);
            // Auto-enable master if an AI option is chosen
            if (r.value === 'ai' && !this.currentConfig.enabled) {
              this.currentConfig.enabled = true;
              if (masterToggle) masterToggle.checked = true;
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

    // Open bridge help from footer
    this.backdropEl.querySelector('#btn-open-bridge-help')?.addEventListener('click', () => {
      this.close();
      this.handlers.onOpenBridgeStatus?.();
    });

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

  private syncActiveBadge(): void {
    if (!this.backdropEl) return;
    const badge = this.backdropEl.querySelector('#ai-active-badge');
    if (badge) {
      const activeAiCount = this.countActiveAiStages();
      badge.className = `panel-badge ${this.currentConfig.enabled ? 'badge-ai-on' : 'badge-muted'}`;
      badge.textContent = this.currentConfig.enabled
        ? `✨ IA: ${activeAiCount}/5 ETAPAS`
        : '⚙️ DSP PURO (IA OFF)';
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
