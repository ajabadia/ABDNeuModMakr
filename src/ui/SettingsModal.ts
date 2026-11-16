// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Unified Settings & AI Processing Modal (shell)
// Mounts the single shared UnifiedAiSettingsPanel from @abdsynths/shared
// inside the IA tab; General tab lives in ./settings/tabGeneral.ts.
// ─────────────────────────────────────────────────────────

import type {
  AiAssistanceConfig,
  ClassifierMethod,
  CoverArtworkMethod,
  DeEsserMethod,
  DenoiseMethod,
  LoopExpansionMethod,
  MasterWaveMethod,
  PitchAndSlicerMethod,
  SeparationMethod,
} from '../core/types';
import { bridgeClient } from '../core/bridge/BridgeClient';
import { webNeuralEngine } from '../core/ai/WebNeuralEngine';
import { createModalFocusTrap } from './modalFocusTrap';
import {
  UnifiedAiSettingsPanel,
  type UnifiedAiCompanionBridgeConfig,
  type UnifiedAiPresetDescriptor,
  type UnifiedAiTabId,
  type UnifiedAiTaskDescriptor,
} from '@abdsynths/shared/components/copilot';
import { LocalLlmClient } from '@abdsynths/shared/ai';
import { cloudByokClient } from '../core/ai/CloudByokClient';
import type {
  AiSubTab,
  SettingsMainTab,
  SettingsModalContext,
  SettingsModalHandlers,
  SettingsModalState,
  SettingsModalTab,
} from './settings/types';
import { createSettingsModalState } from './settings/types';
import { countActiveAiStages } from './settings/state';
import { bindGeneralTabEvents, renderGeneralTab } from './settings/tabGeneral';
import { ICONS } from './icons';
import { toast } from './notify';
import { getAppLocale, onAppLocaleChange } from '../core/i18n';
import { updateBridgeBadge, updateHardwareBadge } from './settings/badges';

export type {
  AiSubTab,
  SettingsMainTab,
  SettingsModalHandlers,
  SettingsModalTab,
} from './settings/types';

function toUnifiedTab(sub: AiSubTab): UnifiedAiTabId {
  switch (sub) {
    case 'cloud':
      return 'cloud-byok';
    case 'bridge':
      return 'local-models';
    case 'copilot':
      return 'local-llm';
    case 'web':
    default:
      return 'tasks';
  }
}

function fromUnifiedTab(tab: UnifiedAiTabId): AiSubTab {
  switch (tab) {
    case 'cloud-byok':
      return 'cloud';
    case 'local-models':
      return 'bridge';
    case 'local-llm':
      return 'copilot';
    case 'tasks':
    default:
      return 'web';
  }
}

function sanitizeNeuModAiConfig(cfg: AiAssistanceConfig): AiAssistanceConfig {
  return {
    ...cfg,
    separation: cfg.separation === 'ai' ? 'dsp' : cfg.separation,
    denoise: cfg.denoise === 'ai' ? 'dsp' : cfg.denoise,
    pitchAndSlicer: cfg.pitchAndSlicer === 'ai' ? 'dsp' : (cfg.pitchAndSlicer ?? 'dsp'),
    deEsser: cfg.deEsser === 'ai' ? 'dsp' : (cfg.deEsser ?? 'dsp'),
    coverArtwork: cfg.coverArtwork === 'local-ai' ? 'procedural' : (cfg.coverArtwork ?? 'procedural'),
  };
}

export class SettingsModal {
  private readonly state: SettingsModalState = createSettingsModalState();
  private handlers: SettingsModalHandlers;
  private readonly localLlmClient = new LocalLlmClient();
  private unifiedPanel: UnifiedAiSettingsPanel | null = null;

  public get currentTab(): SettingsModalTab {
    return this.state.activeMainTab === 'general' ? 'general' : this.state.activeAiSubTab;
  }

  constructor(handlers: SettingsModalHandlers) {
    this.handlers = handlers;
    onAppLocaleChange(() => {
      if (this.state.backdropEl && !this.state.backdropEl.classList.contains('is-hidden')) {
        this.render();
      }
    });
  }

  /** Contexto compartido con la pestaña General (estado por referencia). */
  private ctx(): SettingsModalContext {
    return {
      state: this.state,
      handlers: this.handlers,
      rerender: () => this.render(),
      close: () => this.close(),
    };
  }

  public async open(tab: SettingsModalTab = 'general', config?: AiAssistanceConfig): Promise<void> {
    if (config) {
      this.state.currentConfig = sanitizeNeuModAiConfig({ ...config });
    }
    if (tab === 'general') {
      this.state.activeMainTab = 'general';
    } else if (tab === 'ai') {
      this.state.activeMainTab = 'ai';
    } else if (tab === 'web' || tab === 'cloud' || tab === 'bridge' || tab === 'copilot') {
      this.state.activeMainTab = 'ai';
      this.state.activeAiSubTab = tab;
    }
    this.state.webGpuStatus = webNeuralEngine.getDeviceStatus();

    if (!this.state.backdropEl) {
      this.state.backdropEl = document.createElement('div');
      this.state.backdropEl.className = 'nmm-modal-backdrop is-hidden';
      document.body.appendChild(this.state.backdropEl);
    }

    if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.estimate === 'function') {
      try {
        const est = await navigator.storage.estimate();
        const usage = est.usage ?? 0;
        const quota = est.quota ?? 1;
        this.state.storageEstimate = {
          usage,
          quota,
          percent: Math.min(100, Math.round((usage / quota) * 100)),
        };
      } catch {
        this.state.storageEstimate = null;
      }
    }

    this.render();
    this.state.backdropEl.classList.remove('is-hidden');

    if (!this.state.focusTrap && this.state.backdropEl) {
      this.state.focusTrap = createModalFocusTrap(this.state.backdropEl, {
        onEscape: () => this.close(),
        initialFocusSelector: '#btn-close-settings-modal',
      });
    }
    this.state.focusTrap?.activate();

    void webNeuralEngine.init().then((st) => {
      this.state.webGpuStatus = st;
      updateHardwareBadge(this.state);
    });

    this.state.unsubscribeBridge = bridgeClient.subscribe(() => {
      updateBridgeBadge(this.state);
      if (this.unifiedPanel) {
        this.unifiedPanel.updateCompanionBridge(this.buildCompanionBridgeConfig());
        void this.unifiedPanel.refreshModelStore();
      }
    });
    void bridgeClient.checkHealth();
  }

  public close(): void {
    this.unifiedPanel?.destroy();
    this.unifiedPanel = null;
    if (this.state.focusTrap) {
      this.state.focusTrap.deactivate();
    }
    if (this.state.unsubscribeBridge) {
      this.state.unsubscribeBridge();
      this.state.unsubscribeBridge = null;
    }
    if (this.state.downloadPollTimer) {
      clearInterval(this.state.downloadPollTimer);
      this.state.downloadPollTimer = null;
    }
    this.state.backdropEl?.classList.add('is-hidden');
  }

  private render(): void {
    if (!this.state.backdropEl) return;
    this.unifiedPanel?.destroy();
    this.unifiedPanel = null;

    const cfg = this.state.currentConfig;
    const activeAiCount = countActiveAiStages(this.state);
    const es = getAppLocale() === 'es';

    this.state.backdropEl.innerHTML = `
      <div class="ai-engine-modal-card settings-modal-card" role="dialog" aria-modal="true" aria-label="${es ? 'Ajustes Generales y Configuración de Motor IA' : 'General Settings and AI Engine Configuration'}">
        <!-- Header -->
        <div class="nmm-modal-header ai-modal-header">
          <div class="nmm-modal-header-title">
            <span class="modal-icon">${ICONS.settings}</span>
            <span>${es ? 'AJUSTES Y MOTOR IA' : 'SETTINGS &amp; AI ENGINE'}</span>
            <span class="panel-badge ${cfg.enabled ? 'badge-ai-on' : 'badge-muted'}" id="ai-active-badge">
              ${cfg.enabled ? (es ? `IA: ${activeAiCount}/8 ETAPAS` : `AI: ${activeAiCount}/8 STAGES`) : (es ? '100% DSP (IA OFF)' : 'PURE DSP (AI OFF)')}
            </span>
          </div>
          <button type="button" class="nmm-modal-close" id="btn-close-settings-modal" title="${es ? 'Cerrar (Esc)' : 'Close (Esc)'}">
            ${ICONS.close}
          </button>
        </div>

        <!-- Primary Navigation Tabs (General | IA) -->
        <div class="ai-tabs-nav modal-primary-tabs">
          <button type="button" class="primary-tab-btn ${this.state.activeMainTab === 'general' ? 'is-active' : ''}" data-main-tab="general">
            <span class="primary-tab-icon">${ICONS.sliders}</span>
            <div class="primary-tab-text">
              <span class="primary-tab-title">General</span>
              <span class="primary-tab-tag">${es ? 'Temas, Idioma y Rutas' : 'Themes, Language &amp; Paths'}</span>
            </div>
          </button>
          <button type="button" class="primary-tab-btn ${this.state.activeMainTab === 'ai' ? 'is-active' : ''}" data-main-tab="ai">
            <span class="primary-tab-icon">${ICONS.cpu}</span>
            <div class="primary-tab-text">
              <span class="primary-tab-title">${es ? 'IA' : 'AI'}</span>
              <span class="primary-tab-tag">${es ? 'Panel Unificado ABDSynths (Tareas, LLM Local, BYOK, Modelos)' : 'Unified ABDSynths Panel (Tasks, Local LLM, BYOK, Models)'}</span>
            </div>
          </button>
        </div>

        <!-- Tab Body -->
        <div class="modal-body ai-modal-body">
          ${this.state.activeMainTab === 'general' ? renderGeneralTab(this.ctx()) : '<div id="nmm-unified-ai-mount"></div>'}
        </div>

        <!-- Footer -->
        <div class="nmm-modal-footer ai-modal-footer">
          <div class="ai-footer-info">
            <span class="text-muted" id="ai-footer-device-status">
              ${this.state.webGpuStatus?.statusMessage || (es ? 'Motor de procesamiento listo y en línea.' : 'Processing engine ready and online.')}
            </span>
          </div>
          <div class="footer-right ai-footer-actions">
            <button type="button" class="btn btn-secondary" id="btn-cancel-settings-modal">${es ? 'Cerrar' : 'Close'}</button>
            <button type="button" class="btn btn-primary" id="btn-apply-settings-modal">${es ? 'Aplicar Ajustes' : 'Apply Settings'}</button>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    if (!this.state.backdropEl) return;

    this.state.backdropEl.querySelector('#btn-close-settings-modal')?.addEventListener('click', () => this.close());
    this.state.backdropEl.querySelector('#btn-cancel-settings-modal')?.addEventListener('click', () => this.close());

    this.state.backdropEl.querySelector('#btn-apply-settings-modal')?.addEventListener('click', () => {
      this.handlers.onUpdateAiConfig(sanitizeNeuModAiConfig({ ...this.state.currentConfig }));
      this.close();
      toast('Settings saved and applied successfully', 'success');
    });

    this.state.backdropEl.querySelectorAll<HTMLButtonElement>('.primary-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mainTab = btn.dataset.mainTab as SettingsMainTab;
        if (mainTab && mainTab !== this.state.activeMainTab) {
          this.state.activeMainTab = mainTab;
          this.render();
        }
      });
    });

    if (this.state.activeMainTab === 'general') {
      bindGeneralTabEvents(this.ctx());
    } else {
      const mount = this.state.backdropEl.querySelector<HTMLElement>('#nmm-unified-ai-mount');
      if (mount) {
        this.mountUnifiedAiPanel(mount);
      }
    }
  }

  private buildCompanionBridgeConfig(): UnifiedAiCompanionBridgeConfig {
    const st = bridgeClient.getStatus();
    const es = getAppLocale() === 'es';
    return {
      title: 'Companion Bridge Local (Python / PyTorch)',
      connected: st.connected,
      url: st.url,
      statusText: st.connected
        ? `${st.capabilities?.python || 'Python'} · ${st.capabilities?.gpu ? st.capabilities?.gpu_name : 'CPU'}`
        : st.error || (es
          ? 'Inicia python bridge/server.py para descargar modelos y compartir la carpeta entre aplicaciones.'
          : 'Start python bridge/server.py to download weights and share the workspace folder across apps.'),
      cudaAvailable: Boolean(st.capabilities?.gpu),
      cudaDevice: st.capabilities?.gpu_name || '',
      onConnect: async (url: string) => {
        if (url && url !== bridgeClient.getUrl()) {
          bridgeClient.setUrl(url);
        }
        await bridgeClient.checkHealth();
      },
    };
  }

  private buildTaskDescriptors(es: boolean): UnifiedAiTaskDescriptor[] {
    return [
      {
        id: 'masterWave',
        title: es ? '1. Estándar Master Wave (24-bit / 96 kHz)' : '1. Master Wave Standard (24-bit / 96 kHz)',
        description: es
          ? 'Sobremuestreo de alta fidelidad y reconstrucción armónica superior.'
          : 'High-fidelity sample rate conversion and upper harmonic reconstruction.',
        options: [
          {
            value: 'dsp',
            label: es ? 'Algorítmico (Sinc Polifásico DSP)' : 'Algorithmic (Polyphase Sinc DSP)',
            hint: es ? 'Determinista, fase coherente y latencia cero.' : 'Deterministic, phase-coherent, zero latency.',
          },
          {
            value: 'ai',
            label: es ? 'Extensión Neuronal (Cloud / Replicate BYOK)' : 'Neural Extension (Cloud / Replicate BYOK)',
            hint: es ? 'Super-resolución en la nube vía Replicate API cuando hay clave BYOK configurada.' : 'Cloud super-resolution via Replicate API when a BYOK key is configured.',
          },
        ],
      },
      {
        id: 'separation',
        title: es ? '2. Separación de Fuentes y De-Bleeding' : '2. Source Separation & De-Bleeding',
        description: es
          ? 'Aísla el instrumento solista si la grabación tiene sangrado o reverberación de sala.'
          : 'Isolates solo instrument from room bleed or accompaniment.',
        options: [
          {
            value: 'dsp',
            label: es ? 'Algorítmico (HPSS Mediana STFT)' : 'Algorithmic (STFT Median HPSS)',
            hint: es ? 'Separación armónica/percusiva local determinista.' : 'Deterministic local harmonic/percussive separation.',
          },
          {
            value: 'ai',
            label: es ? 'Separador IA (HTDemucs v4 · GPU Local)' : 'AI Separator (HTDemucs v4 · Local GPU)',
            hint: es ? 'Inferencia neuronal HTDemucs en preparación; hoy se usa HPSS.' : 'HTDemucs neural inference pending wiring; currently runs HPSS.',
            comingSoon: true,
          },
          {
            value: 'bypass',
            label: 'Bypass / Direct',
            hint: es ? 'Conservar señal original sin separación.' : 'Keep original signal without separation.',
          },
        ],
      },
      {
        id: 'loopExpansion',
        title: es ? '3. Expansión Orgánica de Bucles Cortos' : '3. Organic Short Loop Expansion',
        description: es
          ? 'Extiende muestras cortas para sostener notas largas sin ciclos perceptibles.'
          : 'Extends short samples for natural sustain without audible cycling.',
        options: [
          {
            value: 'dsp',
            label: es ? 'Algorítmico (Ventana Circular + NCC)' : 'Algorithmic (Circular Window + NCC)',
            hint: es ? 'Correlación cruzada en cruces por cero.' : 'Zero-crossing normalized cross-correlation.',
          },
          {
            value: 'ai',
            label: es ? 'Outpainting Neuronal (Replicate / Cloud BYOK)' : 'Neural Outpainting (Replicate / Cloud BYOK)',
            hint: es ? 'Continuación generativa en la nube vía Replicate BYOK.' : 'Generative continuation via Replicate Cloud BYOK.',
          },
        ],
      },
      {
        id: 'classifier',
        title: es ? '4. Parameter Set y Clasificador Acústico' : '4. Parameter Set & Acoustic Classifier',
        description: es
          ? 'Detección automática del Parameter Set 0..9, familia y notas tímbricas.'
          : 'Automatic Parameter Set 0..9 classification, family and timbral metadata.',
        options: [
          {
            value: 'dsp',
            label: es ? 'Algorítmico (Descriptores espectrales)' : 'Algorithmic (Spectral descriptors)',
            hint: es ? 'Centroide espectral, ataque logarítmico e inarmonicidad.' : 'Spectral centroid, log attack & inharmonicity.',
          },
          {
            value: 'ai',
            label: es ? 'Clasificador & Etiquetado IA (WebGPU / Cloud LLM)' : 'AI Classifier & Tagging (WebGPU / Cloud LLM)',
            hint: es ? 'Genera notas y etiquetas tímbricas usando tu proveedor Cloud LLM BYOK.' : 'Generates timbral tags & notes using your Cloud LLM BYOK provider.',
          },
          {
            value: 'manual',
            label: es ? 'Selección Manual' : 'Manual Selection',
            hint: es ? 'Control manual 0..9 en el panel principal.' : 'Manual 0..9 selection in main process panel.',
          },
        ],
      },
      {
        id: 'denoise',
        title: es ? '5. Reducción de Ruido y Restauración' : '5. Noise Reduction & Restoration',
        description: es
          ? 'Supresión de soplo de cinta analógica y ruido estacionario de fondo.'
          : 'Suppresses tape hiss and stationary background noise.',
        options: [
          {
            value: 'dsp',
            label: es ? 'Algorítmico (Puerta Multibanda / Sustracción)' : 'Algorithmic (Multiband Gate / Spectral)',
            hint: es ? 'Limpieza espectral determinista sin pérdida de fase.' : 'Deterministic spectral noise suppression.',
          },
          {
            value: 'ai',
            label: es ? 'Denoise IA (DeepFilterNet 3 · ONNX)' : 'AI Denoise (DeepFilterNet 3 · ONNX)',
            hint: es ? 'Descarga compartida disponible; inferencia ONNX en preparación.' : 'Shared weights download ready; ONNX inference pending.',
            comingSoon: true,
          },
          {
            value: 'bypass',
            label: es ? 'Desactivado / Crudo' : 'Disabled / Raw',
          },
        ],
      },
      {
        id: 'pitchAndSlicer',
        title: es ? '6. Seguimiento de Tono F0 y Slicer' : '6. F0 Pitch Tracking & Slicer',
        description: es
          ? 'Detección de nota raíz y alineación automática de transitorios.'
          : 'Root key detection and transient boundary slicing.',
        options: [
          {
            value: 'dsp',
            label: es ? 'Algorítmico (YIN/MPM + OpenVPI)' : 'Algorithmic (YIN/MPM + OpenVPI)',
            hint: es ? 'Detector híbrido F0 y corte por valles RMS.' : 'Hybrid F0 detector and RMS valley slicer.',
          },
          {
            value: 'ai',
            label: es ? 'Tracker Neuronal (Basic Pitch + Whisper-tiny)' : 'Neural Tracker (Basic Pitch + Whisper-tiny)',
            hint: es ? 'Pesos descargables; conector ONNX en preparación.' : 'Downloadable weights; ONNX runtime wiring pending.',
            comingSoon: true,
          },
          {
            value: 'bypass',
            label: 'Bypass',
          },
        ],
      },
      {
        id: 'deEsser',
        title: es ? '7. De-Esser y Control de Sibilancia' : '7. De-Esser & High-Frequency Control',
        description: es
          ? 'Controla sibilancias entre 4.5 y 11 kHz antes del sobremuestreo.'
          : 'Tames sibilant bursts (4.5–11 kHz) prior to upsampling.',
        options: [
          {
            value: 'dsp',
            label: es ? 'Algorítmico (División de Banda Dinámica)' : 'Algorithmic (Dynamic Band-Split)',
            hint: es ? 'Compresor sibilante de fase cero.' : 'Zero-phase split-band de-esser.',
          },
          {
            value: 'ai',
            label: es ? 'De-Harsh IA (DeepFilterNet 3)' : 'AI Spectral De-Harsh (DeepFilterNet 3)',
            hint: es ? 'Inferencia neuronal pendiente.' : 'Neural inference pending.',
            comingSoon: true,
          },
          {
            value: 'bypass',
            label: 'Bypass',
          },
        ],
      },
      {
        id: 'coverArtwork',
        title: es ? '8. Portada del Modelo (512×512 WebP)' : '8. Model Cover Artwork (512×512 WebP)',
        description: es
          ? 'Generación automática de carátula cuando el instrumento no tiene imagen propia.'
          : 'Automatic cover art synthesis when an instrument has no custom image.',
        options: [
          {
            value: 'procedural',
            label: es ? 'Procedural Acústico (DSP)' : 'Acoustic Procedural (DSP)',
            hint: es ? 'Síntesis local basada en espectro y timbre sin coste.' : 'Free local synthesis from spectrogram & timbre.',
          },
          {
            value: 'local-ai',
            label: es ? 'Difusión Local (SD-Turbo GPU)' : 'Local Diffusion (SD-Turbo GPU)',
            hint: es ? 'Generación local de imagen en preparación.' : 'Local GPU image generation pending.',
            comingSoon: true,
          },
          {
            value: 'cloud-ai',
            label: es ? 'Generación Cloud (BYOK Imagen / FLUX / DALL-E)' : 'Cloud Artwork (BYOK Imagen / FLUX / DALL-E)',
            hint: es ? 'Conecta con OpenAI, Gemini, Replicate u OpenRouter usando tu clave.' : 'Calls OpenAI, Gemini, Replicate or OpenRouter with your BYOK key.',
          },
          {
            value: 'bypass',
            label: 'Bypass',
          },
        ],
      },
    ];
  }

  private mountUnifiedAiPanel(mount: HTMLElement): void {
    const es = getAppLocale() === 'es';
    const sanitized = sanitizeNeuModAiConfig(this.state.currentConfig);
    this.state.currentConfig = sanitized;

    const presets: UnifiedAiPresetDescriptor[] = [
      {
        id: 'pure-dsp',
        label: es ? '100% DSP Puro (IA Off)' : '100% Pure DSP (AI Off)',
        apply: () => ({
          enabled: false,
          tasks: {
            masterWave: 'dsp',
            separation: 'dsp',
            loopExpansion: 'dsp',
            classifier: 'dsp',
            denoise: 'dsp',
            pitchAndSlicer: 'dsp',
            deEsser: 'dsp',
            coverArtwork: 'procedural',
          },
        }),
      },
      {
        id: 'cloud-assisted',
        label: es ? 'DSP + Cloud BYOK Real' : 'DSP + Real Cloud BYOK',
        apply: () => ({
          enabled: true,
          tasks: {
            masterWave: 'ai',
            separation: 'dsp',
            loopExpansion: 'ai',
            classifier: 'ai',
            denoise: 'dsp',
            pitchAndSlicer: 'dsp',
            deEsser: 'dsp',
            coverArtwork: 'cloud-ai',
          },
        }),
      },
    ];

    this.unifiedPanel = new UnifiedAiSettingsPanel({
      container: mount,
      appId: 'abdneumodmakr',
      locale: es ? 'es' : 'en',
      activeTab: toUnifiedTab(this.state.activeAiSubTab),
      localClient: this.localLlmClient,
      byokClient: cloudByokClient,
      supportedByokCapabilities: ['text', 'image', 'audio-cloud'],
      safetyNote: es
        ? 'Las etapas marcadas PRÓXIMAMENTE muestran claramente funciones locales PyTorch/ONNX pendientes de cableado de inferencia. Las tareas Cloud BYOK y el gestor compartido de modelos funcionan con tus APIs y carpetas reales.'
        : 'Options badged COMING SOON indicate local PyTorch/ONNX inference wiring still in progress. Cloud BYOK tasks and the shared workspace model store operate live.',
      tasksConfig: {
        enabled: sanitized.enabled,
        tasks: {
          masterWave: sanitized.masterWave,
          separation: sanitized.separation,
          loopExpansion: sanitized.loopExpansion,
          classifier: sanitized.classifier,
          denoise: sanitized.denoise,
          pitchAndSlicer: sanitized.pitchAndSlicer ?? 'dsp',
          deEsser: sanitized.deEsser ?? 'dsp',
          coverArtwork: sanitized.coverArtwork ?? 'procedural',
        },
      },
      taskDescriptors: this.buildTaskDescriptors(es),
      presets,
      companionBridge: this.buildCompanionBridgeConfig(),
      modelStoreBridge: {
        getStatus: () => bridgeClient.getModelsWorkdir(),
        setWorkdir: (path: string) => bridgeClient.setModelsWorkdir(path),
        resetWorkdir: () => bridgeClient.resetModelsWorkdir(),
        browseWorkdir: () => bridgeClient.browseModelsWorkdir(),
        openWorkdir: () => bridgeClient.openModelsWorkdir(),
        downloadModel: async (modelId: string) => {
          try {
            await bridgeClient.downloadModel(modelId);
            return { ok: true };
          } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
          }
        },
        getDownloadProgress: (modelId: string) => bridgeClient.getModelProgress(modelId),
        deleteModel: async (modelId: string) => {
          try {
            await bridgeClient.deleteModel(modelId);
            return { ok: true };
          } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
          }
        },
        updateModelUrl: async (modelId: string, url: string) => {
          try {
            const res = await bridgeClient.updateModelUrl(modelId, url);
            return { ok: true, url: res.url };
          } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
          }
        },
      },
      onTabChange: (tabId) => {
        this.state.activeAiSubTab = fromUnifiedTab(tabId);
      },
      onTasksChange: (next) => {
        const t = next.tasks || {};
        this.state.currentConfig = sanitizeNeuModAiConfig({
          enabled: Boolean(next.enabled),
          masterWave: (t.masterWave as MasterWaveMethod) || 'dsp',
          separation: (t.separation as SeparationMethod) || 'dsp',
          loopExpansion: (t.loopExpansion as LoopExpansionMethod) || 'dsp',
          classifier: (t.classifier as ClassifierMethod) || 'dsp',
          denoise: (t.denoise as DenoiseMethod) || 'dsp',
          pitchAndSlicer: (t.pitchAndSlicer as PitchAndSlicerMethod) || 'dsp',
          deEsser: (t.deEsser as DeEsserMethod) || 'dsp',
          coverArtwork: (t.coverArtwork as CoverArtworkMethod) || 'procedural',
        });
        const badge = this.state.backdropEl?.querySelector('#ai-active-badge');
        if (badge) {
          const activeAiCount = countActiveAiStages(this.state);
          badge.className = `panel-badge ${this.state.currentConfig.enabled ? 'badge-ai-on' : 'badge-muted'}`;
          badge.textContent = this.state.currentConfig.enabled
            ? (es ? `IA: ${activeAiCount}/8 ETAPAS` : `AI: ${activeAiCount}/8 STAGES`)
            : (es ? '100% DSP (IA OFF)' : 'PURE DSP (AI OFF)');
        }
        this.handlers.onUpdateAiConfig({ ...this.state.currentConfig });
      },
    });
  }
}
