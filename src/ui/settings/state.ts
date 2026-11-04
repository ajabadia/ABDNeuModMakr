import type { SettingsModalState } from './types';

/** Número de etapas de IA activas (badge del header y píldoras de submode). */
export function countActiveAiStages(state: SettingsModalState): number {
  if (!state.currentConfig.enabled) return 0;
  let count = 0;
  if (state.currentConfig.masterWave === 'ai') count++;
  if (state.currentConfig.separation === 'ai') count++;
  if (state.currentConfig.loopExpansion === 'ai') count++;
  if (state.currentConfig.classifier === 'ai') count++;
  if (state.currentConfig.denoise === 'ai') count++;
  if (state.currentConfig.pitchAndSlicer === 'ai') count++;
  if (state.currentConfig.deEsser === 'ai') count++;
  if (state.currentConfig.coverArtwork === 'local-ai' || state.currentConfig.coverArtwork === 'cloud-ai') count++;
  return count;
}
