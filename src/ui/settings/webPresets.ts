import type { AiAssistanceConfig } from '../../core/types';
import type { SettingsModalContext } from './types';
import { getAppLocale } from '../../core/i18n';
import { ICONS } from '../icons';

export function renderMasterWebBar(cfg: AiAssistanceConfig): string {
  const activePreset = getActiveAiPreset(cfg);
  const es = getAppLocale() === 'es';

  return `
    <div class="ai-master-bar">
      <div class="ai-master-toggle-wrap">
        <label class="toggle-switch-label" for="ai-master-toggle">
          <input type="checkbox" id="ai-master-toggle" ${cfg.enabled ? 'checked' : ''} />
          <span class="toggle-slider"></span>
          <span class="toggle-title">${es ? 'Activar Asistencia IA' : 'Enable AI Assistance'}</span>
        </label>
        <span class="nmm-hint text-muted">
          ${es ? '(Si se desactiva, el 100% del procesado se ejecuta con DSP algorítmico determinista en WebAudio)' : '(When disabled, 100% of processing runs with deterministic algorithmic DSP in WebAudio)'}
        </span>
      </div>

      <div class="ai-presets-group" id="ai-presets-group">
        <span class="presets-label">${es ? 'Presets Rápidos:' : 'Quick Presets:'}</span>
        <button type="button" class="btn btn-sm btn-preset ${activePreset === 'dsp' ? 'btn-preset-highlight' : ''}" id="btn-preset-all-dsp" title="${es ? 'Algoritmos matemáticos deterministas puros (rápido y reproducible)' : 'Pure deterministic classic math algorithms (fast and reproducible)'}">
          ${ICONS.cpu} 100% DSP
        </button>
        <button type="button" class="btn btn-sm btn-preset ${activePreset === 'hybrid' ? 'btn-preset-highlight' : ''}" id="btn-preset-hybrid" title="${es ? 'Equilibrio óptimo recomendado (DSP Sinc + Separación y Outpainting IA)' : 'Recommended optimal balance (Sinc DSP + AI Separation &amp; Outpainting)'}">
          ${ICONS.zap} ${es ? 'Híbrido Óptimo' : 'Optimal Hybrid'}
        </button>
        <button type="button" class="btn btn-sm btn-preset ${activePreset === 'max' ? 'btn-preset-highlight' : ''}" id="btn-preset-all-ai" title="${es ? 'Todas las etapas del pipeline asistidas por IA' : 'All processing stages AI-assisted'}">
          ${ICONS.sparkle} ${es ? 'Máxima Calidad IA' : 'Max AI Quality'}
        </button>
        <button type="button" class="btn btn-sm btn-preset ${activePreset === 'custom' ? 'btn-preset-highlight' : ''}" id="btn-preset-custom" title="${es ? 'Configuración personalizada (combinación manual de etapas)' : 'Custom configuration (non-standard combination of stages)'}">
          ${ICONS.sliders} ${es ? 'Personalizado' : 'Custom'}
        </button>
      </div>
    </div>
  `;
}

export function getActiveAiPreset(cfg: AiAssistanceConfig): 'dsp' | 'hybrid' | 'max' | 'custom' {
  if (!cfg.enabled) {
    return 'dsp';
  }
  const pitchSlicer = cfg.pitchAndSlicer ?? 'dsp';
  const deEsser = cfg.deEsser ?? 'dsp';
  const coverArt = cfg.coverArtwork ?? 'procedural';

  const isDsp =
    cfg.masterWave === 'dsp' &&
    cfg.separation === 'dsp' &&
    cfg.loopExpansion === 'dsp' &&
    cfg.classifier === 'dsp' &&
    cfg.denoise === 'dsp' &&
    pitchSlicer === 'dsp' &&
    deEsser === 'dsp' &&
    coverArt === 'procedural';
  if (isDsp) return 'dsp';

  const isHybrid =
    cfg.masterWave === 'dsp' &&
    cfg.separation === 'ai' &&
    cfg.loopExpansion === 'ai' &&
    cfg.classifier === 'dsp' &&
    cfg.denoise === 'ai' &&
    pitchSlicer === 'ai' &&
    deEsser === 'dsp';
  if (isHybrid) return 'hybrid';

  const isMax =
    cfg.masterWave === 'ai' &&
    cfg.separation === 'ai' &&
    cfg.loopExpansion === 'ai' &&
    cfg.classifier === 'ai' &&
    cfg.denoise === 'ai' &&
    pitchSlicer === 'ai' &&
    deEsser === 'ai' &&
    (coverArt === 'local-ai' || coverArt === 'cloud-ai');
  if (isMax) return 'max';

  return 'custom';
}

export function syncOptionSelectionClasses(ctx: SettingsModalContext): void {
  if (!ctx.state.backdropEl) return;
  ctx.state.backdropEl.querySelectorAll('.stage-opt').forEach((label) => {
    const input = label.querySelector<HTMLInputElement>('input[type="radio"]');
    label.classList.toggle('is-selected', Boolean(input?.checked));
  });
}

export function syncPresetButtons(ctx: SettingsModalContext): void {
  const group = ctx.state.backdropEl?.querySelector('#ai-presets-group');
  if (!group) return;
  const activePreset = getActiveAiPreset(ctx.state.currentConfig);

  const btnDsp = group.querySelector('#btn-preset-all-dsp');
  const btnHybrid = group.querySelector('#btn-preset-hybrid');
  const btnMax = group.querySelector('#btn-preset-all-ai');
  const btnCustom = group.querySelector('#btn-preset-custom');

  btnDsp?.classList.toggle('btn-preset-highlight', activePreset === 'dsp');
  btnHybrid?.classList.toggle('btn-preset-highlight', activePreset === 'hybrid');
  btnMax?.classList.toggle('btn-preset-highlight', activePreset === 'max');
  btnCustom?.classList.toggle('btn-preset-highlight', activePreset === 'custom');
}
