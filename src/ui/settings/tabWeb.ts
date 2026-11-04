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
import { ICONS } from '../icons';
import { MUSICIAN_TERMS } from '../preflightGateView';
import { bridgeClient } from '../../core/bridge/BridgeClient';
import { cloudByokClient } from '../../core/ai/CloudByokClient';
import { countActiveAiStages } from './state';
import { escHtml } from '../escape';
import { toast } from '../notify';
import { syncOptionSelectionClasses, syncPresetButtons } from './webPresets';

export function renderWebTab(ctx: SettingsModalContext, cfg: AiAssistanceConfig): string {
  const pitchSlicer = cfg.pitchAndSlicer ?? 'dsp';
  const deEsser = cfg.deEsser ?? 'dsp';
  const coverArt = cfg.coverArtwork ?? 'procedural';
  const isCloudReady = cloudByokClient.isReady();
  const cloudProv = cloudByokClient.getConfig().provider.toUpperCase();

  return `
    <div class="ai-hw-banner" id="ai-hw-banner">
      <div class="ai-hw-indicator">
        <span class="hw-icon">${ICONS.cpu}</span>
        <div class="hw-text">
          <strong>Browser Hardware Acceleration</strong>
          <span id="ai-hw-desc">${ctx.state.webGpuStatus?.statusMessage ?? 'Detecting WebGPU / WASM SIMD capabilities...'}</span>
        </div>
      </div>
      <div class="ai-hw-guarantee">
        <span>0 Servers</span> &bull; <span>0 Cost</span> &bull; <span>100% Client-Side Private</span>
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
                Master Wave Standard (24-bit / 96 kHz) · ${escHtml(MUSICIAN_TERMS.bwe)}
                ${!cfg.enabled ? '<span class="cond-reason-badge">ACTIVA "ENABLE AI ASSISTANCE"</span>' : renderLocalModelStatusPill(ctx, 'audiosr', 'AudioSR')}
              </h4>
              <p class="stage-desc text-muted">High-fidelity sample rate conversion and upper harmonic reconstruction.</p>
            </div>
          </div>
          <div class="stage-options">
            <label class="stage-opt ${cfg.masterWave === 'dsp' ? 'is-selected' : ''}">
              <input type="radio" name="opt-master-wave" value="dsp" ${cfg.masterWave === 'dsp' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.cpu} Algorithmic (DSP)</strong>
                <small>Linear polyphase sinc + harmonic saturator. Zero network artifacts, phase-coherent.</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.masterWave === 'ai' ? 'is-selected' : ''}">
              <input type="radio" name="opt-master-wave" value="ai" ${cfg.masterWave === 'ai' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.ai} Neural Extension (AudioSR · Local GPU / Replicate)</strong>
                <small>Latent diffusion generating realistic ultra-high harmonics up to 48 kHz Nyquist.</small>
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
                Source Separation &amp; De-Bleeding
                ${!cfg.enabled ? '<span class="cond-reason-badge">ACTIVA "ENABLE AI ASSISTANCE"</span>' : renderLocalModelStatusPill(ctx, 'htdemucs', 'HTDemucs v4')}
              </h4>
              <p class="stage-desc text-muted">Isolate the solo instrument if the recording contains background bleeding or room noise.</p>
            </div>
          </div>
          <div class="stage-options">
            <label class="stage-opt ${cfg.separation === 'dsp' ? 'is-selected' : ''}">
              <input type="radio" name="opt-separation" value="dsp" ${cfg.separation === 'dsp' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.cpu} Algorithmic (HPSS)</strong>
                <small>Harmonic/percussive separation via median filtering on the STFT spectrogram.</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.separation === 'ai' ? 'is-selected' : ''}">
              <input type="radio" name="opt-separation" value="ai" ${cfg.separation === 'ai' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.ai} AI Separator (HTDemucs v4 · Local GPU)</strong>
                <small>Surgical stem isolation via residual convolutional neural network.</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.separation === 'bypass' ? 'is-selected' : ''}">
              <input type="radio" name="opt-separation" value="bypass" ${cfg.separation === 'bypass' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.bypass} Bypass / Direct</strong>
                <small>Do not separate; use original sample as recorded.</small>
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
                Organic Short Loop Expansion
                ${!cfg.enabled ? '<span class="cond-reason-badge">ACTIVA "ENABLE AI ASSISTANCE"</span>' : renderLocalModelStatusPill(ctx, 'musicgen', 'MusicGen-Small')}
              </h4>
              <p class="stage-desc text-muted">Unroll short loops to create natural, non-cyclic sustain without buzzing.</p>
            </div>
          </div>
          <div class="stage-options">
            <label class="stage-opt ${cfg.loopExpansion === 'dsp' ? 'is-selected' : ''}">
              <input type="radio" name="opt-loop-expansion" value="dsp" ${cfg.loopExpansion === 'dsp' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.cpu} Algorithmic (Circular Window)</strong>
                <small>Periodic phase modulation and equal-power crossfading at zero crossings.</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.loopExpansion === 'ai' ? 'is-selected' : ''}">
              <input type="radio" name="opt-loop-expansion" value="ai" ${cfg.loopExpansion === 'ai' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.ai} Neural Outpainting (MusicGen-Small · Local GPU)</strong>
                <small>Generative autoregressive continuation for natural timbral sustain.</small>
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
                Parameter Set &amp; Acoustic Classifier
                ${!cfg.enabled ? '<span class="cond-reason-badge">ACTIVA "ENABLE AI ASSISTANCE"</span>' : `<span class="cond-reason-badge is-extended-only">${ICONS.check} WEBGPU ${isCloudReady ? `+ ${escHtml(cloudProv)}` : 'LOCAL'}</span>`}
              </h4>
              <p class="stage-desc text-muted">Automatic selection of Parameter Set 0..9 and instrument family tagging.</p>
            </div>
          </div>
          <div class="stage-options">
            <label class="stage-opt ${cfg.classifier === 'dsp' ? 'is-selected' : ''}">
              <input type="radio" name="opt-classifier" value="dsp" ${cfg.classifier === 'dsp' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.cpu} Algorithmic (Descriptors)</strong>
                <small>Log attack, inharmonicity B, spectral centroid, and zero-crossing rate.</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.classifier === 'ai' ? 'is-selected' : ''}">
              <input type="radio" name="opt-classifier" value="ai" ${cfg.classifier === 'ai' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.ai} Neural Classifier (WebGPU / Cloud LLM)</strong>
                <small>Deep timbral acoustic embeddings recognition in WebGPU or Cloud LLM.</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.classifier === 'manual' ? 'is-selected' : ''}">
              <input type="radio" name="opt-classifier" value="manual" ${cfg.classifier === 'manual' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.bypass} Manual Selection</strong>
                <small>Manually select Parameter Set 0..9 on the main process panel.</small>
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
                Noise Reduction &amp; Audio Restoration
                ${!cfg.enabled ? '<span class="cond-reason-badge">ACTIVA "ENABLE AI ASSISTANCE"</span>' : renderLocalModelStatusPill(ctx, 'deepfilter', 'DeepFilterNet 3')}
              </h4>
              <p class="stage-desc text-muted">Suppression of analog tape hiss and background ambient noise from vintage recordings.</p>
            </div>
          </div>
          <div class="stage-options">
            <label class="stage-opt ${cfg.denoise === 'dsp' ? 'is-selected' : ''}">
              <input type="radio" name="opt-denoise" value="dsp" ${cfg.denoise === 'dsp' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.cpu} Algorithmic (Multiband Gate)</strong>
                <small>Static noise-floor attenuation without altering musical phase.</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.denoise === 'ai' ? 'is-selected' : ''}">
              <input type="radio" name="opt-denoise" value="ai" ${cfg.denoise === 'ai' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.ai} AI Denoise (DeepFilterNet 3 · Local ONNX)</strong>
                <small>Adaptive neural filtering preserving subtle instrument harmonics.</small>
              </span>
            </label>
            <label class="stage-opt ${cfg.denoise === 'bypass' ? 'is-selected' : ''}">
              <input type="radio" name="opt-denoise" value="bypass" ${cfg.denoise === 'bypass' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.bypass} Disabled / Raw</strong>
                <small>Keep raw recording intact without applying any noise suppression.</small>
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
                F0 Pitch Tracking &amp; Vocal/Transient Slicer
                ${!cfg.enabled ? '<span class="cond-reason-badge">ACTIVA "ENABLE AI ASSISTANCE"</span>' : `${renderLocalModelStatusPill(ctx, 'basicpitch', 'Basic Pitch')} ${renderLocalModelStatusPill(ctx, 'whispertiny', 'Whisper-tiny')}`}
              </h4>
              <p class="stage-desc text-muted">Root key detection (F0) for chromatic zones and phoneme/transient boundary alignment in AutoSlicer.</p>
            </div>
          </div>
          <div class="stage-options">
            <label class="stage-opt ${pitchSlicer === 'dsp' ? 'is-selected' : ''}">
              <input type="radio" name="opt-pitch-slicer" value="dsp" ${pitchSlicer === 'dsp' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.cpu} Algorithmic (YIN/MPM + HPS &amp; OpenVPI)</strong>
                <small>Time/frequency hybrid F0 detector and RMS valley syllable/transient slicer.</small>
              </span>
            </label>
            <label class="stage-opt ${pitchSlicer === 'ai' ? 'is-selected' : ''}">
              <input type="radio" name="opt-pitch-slicer" value="ai" ${pitchSlicer === 'ai' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.ai} Neural Tracker (Spotify Basic Pitch + Whisper-tiny ONNX)</strong>
                <small>Neural polyphonic note/F0 tracking and speech phoneme alignment on local Bridge.</small>
              </span>
            </label>
            <label class="stage-opt ${pitchSlicer === 'bypass' ? 'is-selected' : ''}">
              <input type="radio" name="opt-pitch-slicer" value="bypass" ${pitchSlicer === 'bypass' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.bypass} Bypass / Keep Nominal Root</strong>
                <small>Trust filename/MIDI root note without running F0 re-detection (default for Drum Maps).</small>
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
                De-Esser &amp; High-Frequency Harshness Suppression
                ${!cfg.enabled ? '<span class="cond-reason-badge">ACTIVA "ENABLE AI ASSISTANCE"</span>' : renderLocalModelStatusPill(ctx, 'deepfilter', 'DeepFilter De-Harsh')}
              </h4>
              <p class="stage-desc text-muted">Tames sibilance and shrill resonances (4.5–11 kHz) BEFORE 96 kHz upsampling so BWE does not amplify harshness.</p>
            </div>
          </div>
          <div class="stage-options">
            <label class="stage-opt ${deEsser === 'dsp' ? 'is-selected' : ''}">
              <input type="radio" name="opt-deesser" value="dsp" ${deEsser === 'dsp' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.cpu} Algorithmic (Dynamic Band-Split De-Esser)</strong>
                <small>Zero-phase sibilant band compressor (4.5–11 kHz) preserving transient snap.</small>
              </span>
            </label>
            <label class="stage-opt ${deEsser === 'ai' ? 'is-selected' : ''}">
              <input type="radio" name="opt-deesser" value="ai" ${deEsser === 'ai' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.ai} AI Spectral De-Harsh (DeepFilterNet 3 / Cloud)</strong>
                <small>Selective neural suppression of non-harmonic sibilant bursts and digital aliasing.</small>
              </span>
            </label>
            <label class="stage-opt ${deEsser === 'bypass' ? 'is-selected' : ''}">
              <input type="radio" name="opt-deesser" value="bypass" ${deEsser === 'bypass' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.bypass} Bypass</strong>
                <small>Do not attenuate high-frequency sibilance.</small>
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
                Model Cover Artwork &amp; Semantic Prompting (512×512 WebP)
                ${
                  !cfg.enabled
                    ? '<span class="cond-reason-badge">ACTIVA "ENABLE AI ASSISTANCE"</span>'
                    : coverArt === 'cloud-ai'
                      ? `<span class="cond-reason-badge ${isCloudReady ? 'is-extended-only' : ''}">${isCloudReady ? `${ICONS.check} CLOUD ${escHtml(cloudProv)} ACTIVO` : 'SIN API KEY CLOUD'}</span>`
                      : renderLocalModelStatusPill(ctx, 'sdturbo', 'SD-Turbo')
                }
              </h4>
              <p class="stage-desc text-muted">Automatic cover generation during Single &amp; Batch model compilation when a model has no custom cover.</p>
            </div>
          </div>
          <div class="stage-options">
            <label class="stage-opt ${coverArt === 'procedural' ? 'is-selected' : ''}">
              <input type="radio" name="opt-cover-artwork" value="procedural" ${coverArt === 'procedural' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.cpu} Procedural Acoustic (DSP Spectrogram)</strong>
                <small>Instant offline mathematical artwork rendered from the instrument's real F0 harmonics.</small>
              </span>
            </label>
            <label class="stage-opt ${coverArt === 'local-ai' ? 'is-selected' : ''}">
              <input type="radio" name="opt-cover-artwork" value="local-ai" ${coverArt === 'local-ai' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.ai} Local GPU Diffusion (SD-Turbo · Bridge 7860)</strong>
                <small>1-step local neural image synthesis on your GPU with zero cloud cost.</small>
              </span>
            </label>
            <label class="stage-opt ${coverArt === 'cloud-ai' ? 'is-selected' : ''}">
              <input type="radio" name="opt-cover-artwork" value="cloud-ai" ${coverArt === 'cloud-ai' ? 'checked' : ''} />
              <span class="opt-body">
                <strong>${ICONS.cloud} Cloud AI (Imagen 3 / DALL-E 3 / FLUX + LLM Prompt)</strong>
                <small>Uses your configured Cloud BYOK provider to craft and render studio album artwork.</small>
              </span>
            </label>
          </div>
        </div>
      </div>
    </fieldset>
  `;
}

export function renderLocalModelStatusPill(ctx: SettingsModalContext, modelId: string, label: string): string {
  if (!bridgeClient.isConnected()) {
    return `<span class="cond-reason-badge" title="Companion Bridge desconectado (puerto 7860)">BRIDGE OFFLINE</span>`;
  }
  if (ctx.state.bridgeModels.length === 0) {
    return `<span class="cond-reason-badge is-extended-only">${escHtml(label)} · BRIDGE ONLINE</span>`;
  }
  const installed = isLocalModelInstalled(ctx, modelId);
  return installed
    ? `<span class="cond-reason-badge is-extended-only" title="Modelo descargado y listo en GPU local">${ICONS.check} ${escHtml(label)} DESCARGADO</span>`
    : `<span class="cond-reason-badge" title="Pendiente de descarga en pestaña Companion Bridge">${ICONS.download} ${escHtml(label)} SIN DESCARGAR</span>`;
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
