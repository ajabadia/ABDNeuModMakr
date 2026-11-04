import type { SettingsModalState } from './types';
import { bridgeClient } from '../../core/bridge/BridgeClient';

export function updateHardwareBadge(state: SettingsModalState): void {
  if (!state.backdropEl) return;
  const desc = state.backdropEl.querySelector('#ai-hw-desc');
  if (desc && state.webGpuStatus) {
    desc.textContent = state.webGpuStatus.statusMessage;
  }
  const footerStatus = state.backdropEl.querySelector('#ai-footer-device-status');
  if (footerStatus && state.webGpuStatus) {
    footerStatus.textContent = `[${state.webGpuStatus.activeProvider.toUpperCase()}] ${state.webGpuStatus.adapterName || 'DSP Nativo'}`;
  }
}

export function updateBridgeBadge(state: SettingsModalState): void {
  if (!state.backdropEl) return;
  const bridge = bridgeClient.getStatus();
  const isOnline = bridge.connected;
  const badge = state.backdropEl.querySelector('#bridge-header-badge');
  if (badge) {
    badge.className = `panel-badge ${isOnline ? 'badge-success' : 'badge-muted'}`;
    badge.textContent = isOnline ? '● EN LÍNEA (7860)' : '○ DESCONECTADO';
  }
}
