import type { AiAssistanceConfig } from '../../core/types';
import type { ClassifierMethod } from '../../core/types';
import type { CoverArtworkMethod } from '../../core/types';
import type { DeEsserMethod } from '../../core/types';
import type { DenoiseMethod } from '../../core/types';
import type { LoopExpansionMethod } from '../../core/types';
import type { MasterWaveMethod } from '../../core/types';
import type { PitchAndSlicerMethod } from '../../core/types';
import type { SeparationMethod } from '../../core/types';
import type { SettingsModalContext } from './types';
import { getAppLocale } from '../../core/i18n';
import { ICONS } from '../icons';
import { MUSICIAN_TERMS } from '../preflightGateView';
import { bridgeClient } from '../../core/bridge/BridgeClient';
import { cloudByokClient } from '../../core/ai/CloudByokClient';
import { countActiveAiStages } from './state';
import { escHtml } from '../escape';
import { toast } from '../notify';
import { syncOptionSelectionClasses, syncPresetButtons } from './webPresets';

export function renderWebTab(ctx: SettingsModalContext, cfg: AiAssistanceConfig): string {
  const isEs = getAppLocale() === 'es';
  const pitchSlicer = cfg.pitchAndSlicer ?? 'dsp';
  const deEsser = cfg.deEsser ?? 'dsp';
  const coverArt = cfg.coverArtwork ?? 'procedural';
  const isCloudReady = cloudByokClient.isReady();
  const cloudProv = cloudByokClient.getConfig().provider.toUpperCase();
  const enableAiBadge = isEs
    ? '<span class="cond-reason-badge">ACTIVA «ASISTENCIA IA»</span>'
    : '<span class="cond-reason-badge">ENABLE "AI ASSISTANCE"</span>';

  return `
    <div class="ai-hw-banner" id="ai-hw-banner">
      <div class="ai-hw-indicator">
        <span class="hw-icon">${ICONS.cpu}</span>
        <div class="hw-text">
          <strong>${isEs ? 'Aceleración por Hardware del Navegador' : 'Browser Hardware Acceleration'}</strong>
          <span id="ai-hw-desc">${ctx.state.webGpuStatus?.statusMessage ?? (isEs ? 'Detectando capacidades WebGPU / WASM SIMD...' : 'Detecting WebGPU / WASM SIMD capabilities...')}</span>
        </div>
      </div>
      <div class="ai-hw-guarantee">
        <span>${isEs ? '0 Servidores' : '0 Servers'}</span> &bull; <span>${isEs ? '0 Coste' : '0 Cost'}</span> &bull; <span>${isEs ? '100% Privado en Cliente' : '100% Client-Side Private'}</span>
      </div>
    </div>

    <fieldset class="conditioned-fieldset" ${!cfg.enabled ? 'disabled' : ''}>
      <div class="ai-stages-matrix ${!cfg.enabled ? 'is-conditioned-disabled' : ''}">
        <!-- 1. Master Wave -->
        <div class="card stage-card ${!cfg.enabled ? 'is-conditioned-disabled' : ''}">
          <div class="stage-header">
            <span class="stage-num">1</span>
            <div class="stage-info">
              <h4 class="stage-title">
                ${isEs ? 'Estándar Master Wave (24-bit / 96 kHz)' : 'Master Wave Standard (24-bit / 96 kHz)'} · ${escHtml(MUSICIAN_TERMS.bwe)}
                ${!cfg.enabled ? enableAiBadge : renderLocalModelStatusPill(ctx, 'audiosr', 'AudioSR')}
              </h4>
              <p class="stage-desc text-muted">${isEs ? 'Conversión de frecuencia de muestreo de alta fidelidad y reconstrucción de armónicos superiores.' : 'High-fidelity sample rate conversion and upper harmonic reconstruction.'}</p>
            </div>
          </div>
          <div class="stage-options">
            <label class="stage-opt ${cfg.masterWave === 'dsp' ? 'is-selected' : ''}">
              <input type="radio" name="opt-master-wave" value="dsp" ${cfg.masterWave === 'dsp' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.cpu} ${isEs ? 'Algorítmico (DSP)' : 'Algorithmic (DSP)'}</strong>
                <small>${isEs ? 'Sinc polifásico lineal + saturador armónico. Cero artefactos de red, coherente en fase.' : 'Linear polyphase sinc + harmonic saturator. Zero network artifacts, phase-coherent.'}</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.masterWave === 'ai' ? 'is-selected' : ''}">
              <input type="radio" name="opt-master-wave" value="ai" ${cfg.masterWave === 'ai' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.ai} ${isEs ? 'Extensión Neuronal (AudioSR · GPU Local / Replicate)' : 'Neural Extension (AudioSR · Local GPU / Replicate)'}</strong>
                <small>${isEs ? 'Difusión latente que genera armónicos ultra-agudos realistas hasta 48 kHz Nyquist.' : 'Latent diffusion generating realistic ultra-high harmonics up to 48 kHz Nyquist.'}</small>
              </span>
            </label>
          </div>
        </div>

        <!-- 2. Source Separation -->
        <div class="card stage-card ${!cfg.enabled ? 'is-conditioned-disabled' : ''}">
          <div class="stage-header">
            <span class="stage-num">2</span>
            <div class="stage-info">
              <h4 class="stage-title">
                ${isEs ? 'Separación de Fuentes y De-Bleeding' : 'Source Separation &amp; De-Bleeding'}
                ${!cfg.enabled ? enableAiBadge : renderLocalModelStatusPill(ctx, 'htdemucs', 'HTDemucs v4')}
              </h4>
              <p class="stage-desc text-muted">${isEs ? 'Aísla el instrumento solista si la grabación contiene sangrado de fondo o ruido de sala.' : 'Isolate the solo instrument if the recording contains background bleeding or room noise.'}</p>
            </div>
          </div>
          <div class="stage-options">
            <label class="stage-opt ${cfg.separation === 'dsp' ? 'is-selected' : ''}">
              <input type="radio" name="opt-separation" value="dsp" ${cfg.separation === 'dsp' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.cpu} ${isEs ? 'Algorítmico (HPSS)' : 'Algorithmic (HPSS)'}</strong>
                <small>${isEs ? 'Separación armónica/percusiva mediante filtrado de mediana sobre el espectrograma STFT.' : 'Harmonic/percussive separation via median filtering on the STFT spectrogram.'}</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.separation === 'ai' ? 'is-selected' : ''}">
              <input type="radio" name="opt-separation" value="ai" ${cfg.separation === 'ai' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.ai} ${isEs ? 'Separador IA (HTDemucs v4 · GPU Local)' : 'AI Separator (HTDemucs v4 · Local GPU)'}</strong>
                <small>${isEs ? 'Aislamiento quirúrgico de pistas mediante red neuronal convolucional residual.' : 'Surgical stem isolation via residual convolutional neural network.'}</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.separation === 'bypass' ? 'is-selected' : ''}">
              <input type="radio" name="opt-separation" value="bypass" ${cfg.separation === 'bypass' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.bypass} ${isEs ? 'Bypass / Directo' : 'Bypass / Direct'}</strong>
                <small>${isEs ? 'No separar; usar la muestra original tal como se grabó.' : 'Do not separate; use original sample as recorded.'}</small>
              </span>
            </label>
          </div>
        </div>

        <!-- 3. Loop Expansion -->
        <div class="card stage-card ${!cfg.enabled ? 'is-conditioned-disabled' : ''}">
          <div class="stage-header">
            <span class="stage-num">3</span>
            <div class="stage-info">
              <h4 class="stage-title">
                ${isEs ? 'Expansión Orgánica de Bucles Cortos' : 'Organic Short Loop Expansion'}
                ${!cfg.enabled ? enableAiBadge : renderLocalModelStatusPill(ctx, 'musicgen', 'MusicGen-Small')}
              </h4>
              <p class="stage-desc text-muted">${isEs ? 'Desenrolla bucles cortos para crear un sustain natural y no cíclico sin zumbidos.' : 'Unroll short loops to create natural, non-cyclic sustain without buzzing.'}</p>
            </div>
          </div>
          <div class="stage-options">
            <label class="stage-opt ${cfg.loopExpansion === 'dsp' ? 'is-selected' : ''}">
              <input type="radio" name="opt-loop-expansion" value="dsp" ${cfg.loopExpansion === 'dsp' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.cpu} ${isEs ? 'Algorítmico (Ventana Circular)' : 'Algorithmic (Circular Window)'}</strong>
                <small>${isEs ? 'Modulación periódica de fase y fundido cruzado de igual potencia en cruces por cero.' : 'Periodic phase modulation and equal-power crossfading at zero crossings.'}</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.loopExpansion === 'ai' ? 'is-selected' : ''}">
              <input type="radio" name="opt-loop-expansion" value="ai" ${cfg.loopExpansion === 'ai' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.ai} ${isEs ? 'Outpainting Neuronal (MusicGen-Small · GPU Local)' : 'Neural Outpainting (MusicGen-Small · Local GPU)'}</strong>
                <small>${isEs ? 'Continuación autorregresiva generativa para un sustain tímbrico natural.' : 'Generative autoregressive continuation for natural timbral sustain.'}</small>
              </span>
            </label>
          </div>
        </div>

        <!-- 4. Classifier -->
        <div class="card stage-card ${!cfg.enabled ? 'is-conditioned-disabled' : ''}">
          <div class="stage-header">
            <span class="stage-num">4</span>
            <div class="stage-info">
              <h4 class="stage-title">
                ${isEs ? 'Parameter Set y Clasificador Acústico' : 'Parameter Set &amp; Acoustic Classifier'}
                ${!cfg.enabled ? enableAiBadge : `<span class="cond-reason-badge is-extended-only">${ICONS.check} WEBGPU ${isCloudReady ? `+ ${escHtml(cloudProv)}` : 'LOCAL'}</span>`}
              </h4>
              <p class="stage-desc text-muted">${isEs ? 'Selección automática del Parameter Set 0..9 y etiquetado de familia instrumental.' : 'Automatic selection of Parameter Set 0..9 and instrument family tagging.'}</p>
            </div>
          </div>
          <div class="stage-options">
            <label class="stage-opt ${cfg.classifier === 'dsp' ? 'is-selected' : ''}">
              <input type="radio" name="opt-classifier" value="dsp" ${cfg.classifier === 'dsp' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.cpu} ${isEs ? 'Algorítmico (Descriptores)' : 'Algorithmic (Descriptors)'}</strong>
                <small>${isEs ? 'Ataque logarítmico, inarmonicidad B, centroide espectral y tasa de cruces por cero.' : 'Log attack, inharmonicity B, spectral centroid, and zero-crossing rate.'}</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.classifier === 'ai' ? 'is-selected' : ''}">
              <input type="radio" name="opt-classifier" value="ai" ${cfg.classifier === 'ai' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.ai} ${isEs ? 'Clasificador Neuronal (WebGPU / Cloud LLM)' : 'Neural Classifier (WebGPU / Cloud LLM)'}</strong>
                <small>${isEs ? 'Reconocimiento profundo de embeddings acústicos tímbricos en WebGPU o Cloud LLM.' : 'Deep timbral acoustic embeddings recognition in WebGPU or Cloud LLM.'}</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.classifier === 'manual' ? 'is-selected' : ''}">
              <input type="radio" name="opt-classifier" value="manual" ${cfg.classifier === 'manual' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.bypass} ${isEs ? 'Selección Manual' : 'Manual Selection'}</strong>
                <small>${isEs ? 'Seleccionar manualmente el Parameter Set 0..9 en el panel principal de proceso.' : 'Manually select Parameter Set 0..9 on the main process panel.'}</small>
              </span>
            </label>
          </div>
        </div>

        <!-- 5. Denoise -->
        <div class="card stage-card ${!cfg.enabled ? 'is-conditioned-disabled' : ''}">
          <div class="stage-header">
            <span class="stage-num">5</span>
            <div class="stage-info">
              <h4 class="stage-title">
                ${isEs ? 'Reducción de Ruido y Restauración de Audio' : 'Noise Reduction &amp; Audio Restoration'}
                ${!cfg.enabled ? enableAiBadge : renderLocalModelStatusPill(ctx, 'deepfilter', 'DeepFilterNet 3')}
              </h4>
              <p class="stage-desc text-muted">${isEs ? 'Supresión de soplo de cinta analógica y ruido ambiental de fondo en grabaciones vintage.' : 'Suppression of analog tape hiss and background ambient noise from vintage recordings.'}</p>
            </div>
          </div>
          <div class="stage-options">
            <label class="stage-opt ${cfg.denoise === 'dsp' ? 'is-selected' : ''}">
              <input type="radio" name="opt-denoise" value="dsp" ${cfg.denoise === 'dsp' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.cpu} ${isEs ? 'Algorítmico (Puerta Multibanda)' : 'Algorithmic (Multiband Gate)'}</strong>
                <small>${isEs ? 'Atenuación estática del suelo de ruido sin alterar la fase musical.' : 'Static noise-floor attenuation without altering musical phase.'}</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.denoise === 'ai' ? 'is-selected' : ''}">
              <input type="radio" name="opt-denoise" value="ai" ${cfg.denoise === 'ai' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.ai} ${isEs ? 'Denoise IA (DeepFilterNet 3 · ONNX Local)' : 'AI Denoise (DeepFilterNet 3 · Local ONNX)'}</strong>
                <small>${isEs ? 'Filtrado neuronal adaptativo que preserva los armónicos sutiles del instrumento.' : 'Adaptive neural filtering preserving subtle instrument harmonics.'}</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.denoise === 'bypass' ? 'is-selected' : ''}">
              <input type="radio" name="opt-denoise" value="bypass" ${cfg.denoise === 'bypass' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.bypass} ${isEs ? 'Desactivado / Crudo' : 'Disabled / Raw'}</strong>
                <small>${isEs ? 'Mantener la grabación original intacta sin aplicar supresión de ruido.' : 'Keep raw recording intact without applying any noise suppression.'}</small>
              </span>
            </label>
          </div>
        </div>

        <!-- 6. Pitch F0 & Vocal/Transient Slicer (Basic Pitch + Whisper-tiny) -->
        <div class="card stage-card ${!cfg.enabled ? 'is-conditioned-disabled' : ''}">
          <div class="stage-header">
            <span class="stage-num">6</span>
            <div class="stage-info">
              <h4 class="stage-title">
                ${isEs ? 'Seguimiento de Tono F0 y Slicer Vocal/Transitorios' : 'F0 Pitch Tracking &amp; Vocal/Transient Slicer'}
                ${!cfg.enabled ? enableAiBadge : `${renderLocalModelStatusPill(ctx, 'basicpitch', 'Basic Pitch')} ${renderLocalModelStatusPill(ctx, 'whispertiny', 'Whisper-tiny')}`}
              </h4>
              <p class="stage-desc text-muted">${isEs ? 'Detección de nota raíz (F0) para zonas cromáticas y alineación de fonemas/transitorios en AutoSlicer.' : 'Root key detection (F0) for chromatic zones and phoneme/transient boundary alignment in AutoSlicer.'}</p>
            </div>
          </div>
          <div class="stage-options">
            <label class="stage-opt ${pitchSlicer === 'dsp' ? 'is-selected' : ''}">
              <input type="radio" name="opt-pitch-slicer" value="dsp" ${pitchSlicer === 'dsp' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.cpu} ${isEs ? 'Algorítmico (YIN/MPM + HPS y OpenVPI)' : 'Algorithmic (YIN/MPM + HPS &amp; OpenVPI)'}</strong>
                <small>${isEs ? 'Detector F0 híbrido tiempo/frecuencia y troceador de sílabas/transitorios por valles RMS.' : 'Time/frequency hybrid F0 detector and RMS valley syllable/transient slicer.'}</small>
              </span>
            </label>
            <label class="stage-opt ${pitchSlicer === 'ai' ? 'is-selected' : ''}">
              <input type="radio" name="opt-pitch-slicer" value="ai" ${pitchSlicer === 'ai' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.ai} ${isEs ? 'Tracker Neuronal (Spotify Basic Pitch + Whisper-tiny ONNX)' : 'Neural Tracker (Spotify Basic Pitch + Whisper-tiny ONNX)'}</strong>
                <small>${isEs ? 'Seguimiento neuronal polifónico de nota/F0 y alineación de fonemas en el Bridge local.' : 'Neural polyphonic note/F0 tracking and speech phoneme alignment on local Bridge.'}</small>
              </span>
            </label>
            <label class="stage-opt ${pitchSlicer === 'bypass' ? 'is-selected' : ''}">
              <input type="radio" name="opt-pitch-slicer" value="bypass" ${pitchSlicer === 'bypass' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.bypass} ${isEs ? 'Bypass / Conservar Raíz Nominal' : 'Bypass / Keep Nominal Root'}</strong>
                <small>${isEs ? 'Confiar en la nota raíz del archivo/MIDI sin re-detectar F0 (por defecto en Drum Maps).' : 'Trust filename/MIDI root note without running F0 re-detection (default for Drum Maps).'}</small>
              </span>
            </label>
          </div>
        </div>

        <!-- 7. De-Esser & Harshness Suppression -->
        <div class="card stage-card ${!cfg.enabled ? 'is-conditioned-disabled' : ''}">
          <div class="stage-header">
            <span class="stage-num">7</span>
            <div class="stage-info">
              <h4 class="stage-title">
                ${isEs ? 'De-Esser y Supresión de Aspereza en Altas Frecuencias' : 'De-Esser &amp; High-Frequency Harshness Suppression'}
                ${!cfg.enabled ? enableAiBadge : renderLocalModelStatusPill(ctx, 'deepfilter', 'DeepFilter De-Harsh')}
              </h4>
              <p class="stage-desc text-muted">${isEs ? 'Domina la sibilancia y resonancias estridentes (4.5–11 kHz) ANTES del sobremuestreo a 96 kHz para que BWE no amplifique aspereza.' : 'Tames sibilance and shrill resonances (4.5–11 kHz) BEFORE 96 kHz upsampling so BWE does not amplify harshness.'}</p>
            </div>
          </div>
          <div class="stage-options">
            <label class="stage-opt ${deEsser === 'dsp' ? 'is-selected' : ''}">
              <input type="radio" name="opt-deesser" value="dsp" ${deEsser === 'dsp' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.cpu} ${isEs ? 'Algorítmico (De-Esser Dinámico por División de Banda)' : 'Algorithmic (Dynamic Band-Split De-Esser)'}</strong>
                <small>${isEs ? 'Compresor de banda sibilante de fase cero (4.5–11 kHz) que preserva la pegada del transitorio.' : 'Zero-phase sibilant band compressor (4.5–11 kHz) preserving transient snap.'}</small>
              </span>
            </label>
            <label class="stage-opt ${deEsser === 'ai' ? 'is-selected' : ''}">
              <input type="radio" name="opt-deesser" value="ai" ${deEsser === 'ai' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.ai} ${isEs ? 'De-Harsh Espectral IA (DeepFilterNet 3 / Nube)' : 'AI Spectral De-Harsh (DeepFilterNet 3 / Cloud)'}</strong>
                <small>${isEs ? 'Supresión neuronal selectiva de ráfagas sibilantes no armónicas y aliasing digital.' : 'Selective neural suppression of non-harmonic sibilant bursts and digital aliasing.'}</small>
              </span>
            </label>
            <label class="stage-opt ${deEsser === 'bypass' ? 'is-selected' : ''}">
              <input type="radio" name="opt-deesser" value="bypass" ${deEsser === 'bypass' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.bypass} Bypass</strong>
                <small>${isEs ? 'No atenuar la sibilancia de alta frecuencia.' : 'Do not attenuate high-frequency sibilance.'}</small>
              </span>
            </label>
          </div>
        </div>

        <!-- 8. Cover Artwork & Semantic Prompting -->
        <div class="card stage-card ${!cfg.enabled ? 'is-conditioned-disabled' : ''}">
          <div class="stage-header">
            <span class="stage-num">8</span>
            <div class="stage-info">
              <h4 class="stage-title">
                ${isEs ? 'Portada del Modelo y Prompting Semántico (512×512 WebP)' : 'Model Cover Artwork &amp; Semantic Prompting (512×512 WebP)'}
                ${
                  !cfg.enabled
                    ? enableAiBadge
                    : coverArt === 'cloud-ai'
                      ? `<span class="cond-reason-badge ${isCloudReady ? 'is-extended-only' : ''}">${isCloudReady ? `${ICONS.check} CLOUD ${escHtml(cloudProv)} ${isEs ? 'ACTIVO' : 'ACTIVE'}` : (isEs ? 'SIN API KEY CLOUD' : 'NO CLOUD API KEY')}</span>`
                      : renderLocalModelStatusPill(ctx, 'sdturbo', 'SD-Turbo')
                }
              </h4>
              <p class="stage-desc text-muted">${isEs ? 'Generación automática de portada durante la compilación individual y por lotes cuando un modelo no tiene portada propia.' : 'Automatic cover generation during Single &amp; Batch model compilation when a model has no custom cover.'}</p>
            </div>
          </div>
          <div class="stage-options">
            <label class="stage-opt ${coverArt === 'procedural' ? 'is-selected' : ''}">
              <input type="radio" name="opt-cover-artwork" value="procedural" ${coverArt === 'procedural' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.cpu} ${isEs ? 'Acústico Procedural (Espectrograma DSP)' : 'Procedural Acoustic (DSP Spectrogram)'}</strong>
                <small>${isEs ? 'Arte matemático offline instantáneo renderizado a partir de los armónicos F0 reales del instrumento.' : 'Instant offline mathematical artwork rendered from the instrument\'s real F0 harmonics.'}</small>
              </span>
            </label>
            <label class="stage-opt ${coverArt === 'local-ai' ? 'is-selected' : ''}">
              <input type="radio" name="opt-cover-artwork" value="local-ai" ${coverArt === 'local-ai' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.ai} ${isEs ? 'Difusión en GPU Local (SD-Turbo · Bridge 7860)' : 'Local GPU Diffusion (SD-Turbo · Bridge 7860)'}</strong>
                <small>${isEs ? 'Síntesis neuronal de imagen en 1 paso en tu GPU con coste cero en la nube.' : '1-step local neural image synthesis on your GPU with zero cloud cost.'}</small>
              </span>
            </label>
            <label class="stage-opt ${coverArt === 'cloud-ai' ? 'is-selected' : ''}">
              <input type="radio" name="opt-cover-artwork" value="cloud-ai" ${coverArt === 'cloud-ai' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.cloud} ${isEs ? 'IA en la Nube (Imagen 3 / DALL-E 3 / FLUX + Prompt LLM)' : 'Cloud AI (Imagen 3 / DALL-E 3 / FLUX + LLM Prompt)'}</strong>
                <small>${isEs ? 'Usa tu proveedor Cloud BYOK configurado para redactar y renderizar portadas de estudio.' : 'Uses your configured Cloud BYOK provider to craft and render studio album artwork.'}</small>
              </span>
            </label>
          </div>
        </div>
      </div>
    </fieldset>
  `;
}

export function renderLocalModelStatusPill(ctx: SettingsModalContext, modelId: string, label: string): string {
  const isEs = getAppLocale() === 'es';
  if (!bridgeClient.isConnected()) {
    return `<span class="cond-reason-badge" title="${isEs ? 'Companion Bridge desconectado (puerto 7860)' : 'Companion Bridge disconnected (port 7860)'}">BRIDGE OFFLINE</span>`;
  }
  if (ctx.state.bridgeModels.length === 0) {
    return `<span class="cond-reason-badge is-extended-only">${escHtml(label)} · BRIDGE ONLINE</span>`;
  }
  const installed = isLocalModelInstalled(ctx, modelId);
  return installed
    ? `<span class="cond-reason-badge is-extended-only" title="${isEs ? 'Modelo descargado y listo en GPU local' : 'Model downloaded and ready on local GPU'}">${ICONS.check} ${escHtml(label)} ${isEs ? 'DESCARGADO' : 'INSTALLED'}</span>`
    : `<span class="cond-reason-badge" title="${isEs ? 'Pendiente de descarga en pestaña Companion Bridge' : 'Pending download in Companion Bridge tab'}">${ICONS.download} ${escHtml(label)} ${isEs ? 'SIN DESCARGAR' : 'NOT DOWNLOADED'}</span>`;
}

export function isLocalModelInstalled(ctx: SettingsModalContext, modelId: string): boolean {
  if (!bridgeClient.isConnected()) return false;
  const found = ctx.state.bridgeModels.find((m) => m.id === modelId);
  return found ? Boolean(found.installed) : false;
}

export function bindWebTabEvents(ctx: SettingsModalContext): void {
  if (!ctx.state.backdropEl) return;

  // Master AI toggle
  const masterToggle = ctx.state.backdropEl.querySelector<HTMLInputElement>('#ai-master-toggle');
  masterToggle?.addEventListener('change', () => {
    ctx.state.currentConfig.enabled = masterToggle.checked;
    syncActiveBadge(ctx);
    syncPresetButtons(ctx);
  });

  // Preset buttons
  ctx.state.backdropEl.querySelector('#btn-preset-all-dsp')?.addEventListener('click', () => {
    ctx.state.currentConfig = {
      enabled: false,
      masterWave: 'dsp',
      separation: 'dsp',
      loopExpansion: 'dsp',
      classifier: 'dsp',
      denoise: 'dsp',
      pitchAndSlicer: 'dsp',
      deEsser: 'dsp',
      coverArtwork: 'procedural',
    };
    ctx.rerender();
    toast('Preset applied: 100% Deterministic Algorithmic DSP', 'info');
  });

  ctx.state.backdropEl.querySelector('#btn-preset-hybrid')?.addEventListener('click', () => {
    ctx.state.currentConfig = {
      enabled: true,
      masterWave: 'dsp',
      separation: 'ai',
      loopExpansion: 'ai',
      classifier: 'dsp',
      denoise: 'ai',
      pitchAndSlicer: 'ai',
      deEsser: 'dsp',
      coverArtwork: cloudByokClient.isReady() ? 'cloud-ai' : 'procedural',
    };
    ctx.rerender();
    toast('Preset applied: Optimal Hybrid (Sinc DSP + AI Outpainting/Denoise/Pitch)', 'success');
  });

  ctx.state.backdropEl.querySelector('#btn-preset-all-ai')?.addEventListener('click', () => {
    ctx.state.currentConfig = {
      enabled: true,
      masterWave: 'ai',
      separation: 'ai',
      loopExpansion: 'ai',
      classifier: 'ai',
      denoise: 'ai',
      pitchAndSlicer: 'ai',
      deEsser: 'ai',
      coverArtwork: cloudByokClient.isReady() ? 'cloud-ai' : 'local-ai',
    };
    ctx.rerender();
    toast('Preset applied: Maximum Quality AI-Assisted (8/8 stages)', 'success');
  });

  // Stage radio changes
  const bindRadio = (name: string, setter: (val: string) => void) => {
    ctx.state.backdropEl?.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach((r) => {
      r.addEventListener('change', () => {
        if (r.checked) {
          setter(r.value);
          syncActiveBadge(ctx);
          syncOptionSelectionClasses(ctx);
          syncPresetButtons(ctx);
        }
      });
    });
  };

  bindRadio('opt-master-wave', (v) => (ctx.state.currentConfig.masterWave = v as MasterWaveMethod));
  bindRadio('opt-separation', (v) => (ctx.state.currentConfig.separation = v as SeparationMethod));
  bindRadio('opt-loop-expansion', (v) => (ctx.state.currentConfig.loopExpansion = v as LoopExpansionMethod));
  bindRadio('opt-classifier', (v) => (ctx.state.currentConfig.classifier = v as ClassifierMethod));
  bindRadio('opt-denoise', (v) => (ctx.state.currentConfig.denoise = v as DenoiseMethod));
  bindRadio('opt-pitch-slicer', (v) => (ctx.state.currentConfig.pitchAndSlicer = v as PitchAndSlicerMethod));
  bindRadio('opt-deesser', (v) => (ctx.state.currentConfig.deEsser = v as DeEsserMethod));
  bindRadio('opt-cover-artwork', (v) => (ctx.state.currentConfig.coverArtwork = v as CoverArtworkMethod));
}

export function syncActiveBadge(ctx: SettingsModalContext): void {
  if (!ctx.state.backdropEl) return;
  const badge = ctx.state.backdropEl.querySelector('#ai-active-badge');
  if (badge) {
    const activeAiCount = countActiveAiStages(ctx.state);
    badge.className = `panel-badge ${ctx.state.currentConfig.enabled ? 'badge-ai-on' : 'badge-muted'}`;
    badge.textContent = ctx.state.currentConfig.enabled
      ? `AI: ${activeAiCount}/8 STAGES`
      : 'PURE DSP (AI OFF)';
  }
}
