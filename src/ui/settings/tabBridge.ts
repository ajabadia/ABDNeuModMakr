import type { SettingsModalContext } from './types';
import { getAppLocale } from '../../core/i18n';
import { ICONS } from '../icons';
import { bridgeClient } from '../../core/bridge/BridgeClient';
import { escAttr } from '../escape';
import { escHtml } from '../escape';
import { toast } from '../notify';
import { buildBridgeModelsHtml, bindBridgeModelActions, refreshBridgeModels } from './bridgeModels';

export function renderBridgeTab(ctx: SettingsModalContext): string {
  const isEs = getAppLocale() === 'es';
  const bridge = bridgeClient.getStatus();
  const isOnline = bridge.connected;
  const bridgeUrl = escAttr(bridgeClient.getUrl());
  const bridgeToken = escAttr(bridgeClient.getBridgeToken());

  return `
    <div class="ai-bridge-tab-container">
      <!-- Status Card -->
      <div class="card bridge-status-card ${isOnline ? 'is-connected' : 'is-disconnected'}">
        <div class="bridge-card-header">
          <div class="bridge-card-title">
            <span class="bridge-dot ${isOnline ? 'dot-online' : 'dot-offline'}"></span>
            <strong>${isEs ? 'Companion Bridge Local (Python y GPU)' : 'Local Companion Bridge (Python &amp; GPU)'}</strong>
          </div>
          <span class="bridge-badge">${isOnline ? (isEs ? 'CONECTADO (7860)' : 'ONLINE (7860)') : (isEs ? 'DESCONECTADO' : 'DISCONNECTED')}</span>
        </div>

        <div class="bridge-details-grid">
          <div class="bridge-detail-item">
            <span class="detail-label">${isEs ? 'Endpoint Local:' : 'Local Endpoint:'}</span>
            <span class="detail-value"><code>${escHtml(bridge.url)}</code></span>
          </div>
          <div class="bridge-detail-item">
            <span class="detail-label">${isEs ? 'Dispositivo de Cómputo:' : 'Compute Device:'}</span>
            <span class="detail-value">${escHtml(bridge.capabilities?.device ?? 'N/A')} (${escHtml(bridge.capabilities?.gpu_name || (isEs ? 'Respaldo CPU' : 'CPU Fallback'))})</span>
          </div>
          <div class="bridge-detail-item">
            <span class="detail-label">${isEs ? 'Aceleración GPU:' : 'GPU Acceleration:'}</span>
            <span class="detail-value">${bridge.capabilities?.gpu ? (isEs ? 'Activada (CUDA / VRAM)' : 'Enabled (CUDA / VRAM)') : (isEs ? 'Desactivada' : 'Disabled')}</span>
          </div>
          <div class="bridge-detail-item">
            <span class="detail-label">${isEs ? 'Latencia Loopback:' : 'Loopback Latency:'}</span>
            <span class="detail-value">${bridge.latencyMs ?? 0} ms</span>
          </div>
          ${!isOnline ? `<div class="bridge-detail-item"><span class="detail-label">VRAM:</span><span class="detail-value"><span class="nmm-status-pill is-warn">${isEs ? 'VRAM desconocida (bridge offline)' : 'VRAM unknown (bridge offline)'}</span></span></div>` : ''}
        </div>

        ${
          !isOnline
            ? `
          <div class="bridge-offline-instructions">
            <p>
              ${
                isEs
                  ? 'El Companion Bridge conecta tu navegador (incluso alojado en Vercel) con tu GPU dedicada local (ej. RTX 3070 8GB VRAM) para ejecutar modelos neuronales pesados con cero coste de servidor y sin subir tu audio a la nube. Para iniciarlo, ejecuta en tu terminal:'
                  : 'The Companion Bridge connects your browser (even when hosted on Vercel) to your local dedicated GPU (e.g. RTX 3070 8GB VRAM) to execute heavy neural models with zero server costs and zero audio uploads. To launch it, run in your terminal:'
              }
            </p>
            <pre class="bridge-code-snippet"><code>start.bat  (${isEs ? 'Inicia la aplicación y el companion bridge' : 'Launches app and companion bridge'})
${isEs ? 'o bien:' : 'or:'}
python bridge/server.py</code></pre>
            <div class="bridge-retry-row">
              <button type="button" class="btn btn-sm btn-outline" id="btn-bridge-retry">
                ${ICONS.refresh} ${isEs ? 'Reintentar Conexión Ahora' : 'Retry Connection Now'}
              </button>
            </div>
          </div>
        `
            : ''
        }
      </div>

      <!-- Bridge Connection Settings (S5: endpoint + token, ambos en localStorage) -->
      <div class="card bridge-connection-card">
        <div class="byok-field-group">
          <label class="byok-field-label" for="bridge-url-input">${isEs ? 'URL del Endpoint del Bridge:' : 'Bridge Endpoint URL:'}</label>
          <div class="byok-input-row">
            <div class="byok-input-wrap">
              <input
                type="text"
                id="bridge-url-input"
                class="form-control byok-key-field"
                placeholder="http://127.0.0.1:7860"
                value="${bridgeUrl}"
                spellcheck="false"
                autocomplete="off"
              />
            </div>
            <button type="button" class="btn btn-secondary" id="btn-bridge-save-url">${isEs ? 'Guardar y Reconectar' : 'Save &amp; Reconnect'}</button>
          </div>
        </div>
        <div class="byok-field-group">
          <label class="byok-field-label" for="bridge-token-input">Bridge Token (X-Bridge-Token):</label>
          <div class="byok-input-row">
            <div class="byok-input-wrap">
              <input
                type="password"
                id="bridge-token-input"
                class="form-control byok-key-field"
                placeholder="${isEs ? 'Token impreso por bridge/server.py (vacío = sin auth)' : 'Token printed by bridge/server.py (empty = no auth)'}"
                value="${bridgeToken}"
                spellcheck="false"
                autocomplete="off"
              />
            </div>
            <button type="button" class="btn btn-outline" id="btn-bridge-clear-token" title="${isEs ? 'Borrar token del almacenamiento local del navegador' : 'Clear token from local browser storage'}">${isEs ? 'Limpiar' : 'Clear'}</button>
          </div>
          <small class="text-muted">${isEs ? 'Se envía como cabecera <code>X-Bridge-Token</code>. El bridge la exige solo si defines <code>ABD_BRIDGE_TOKEN</code>.' : 'Sent as <code>X-Bridge-Token</code> header. The bridge only requires it if you set <code>ABD_BRIDGE_TOKEN</code>.'}</small>
        </div>
      </div>

      <!-- Models Downloader Section -->
      <div class="card bridge-models-section">
        <div class="models-section-header">
          <div class="header-left">
            <h4>${isEs ? 'Catálogo de Modelos Neuronales Locales' : 'Local Neural Model Catalog'}</h4>
            <p class="text-muted">
              ${isEs ? 'Pre-descarga multihilo transparente de modelos directamente a tu GPU local.' : 'Transparent multithreaded model pre-download directly to your local GPU.'}
              <br/>
              <small class="bridge-note-small">${isEs ? '(Nota: Los modelos también se descargan automáticamente bajo demanda la primera vez si no se pre-descargan aquí. "Descargado en disco" ≠ cargado en VRAM: la inferencia neuronal real está pendiente y el procesado actual es DSP provisional local.)' : '(Note: Models are also downloaded automatically on first demand if not pre-fetched here. "Downloaded to disk" ≠ loaded in VRAM: real neural inference is pending and current processing is provisional local DSP.)'}</small>
            </p>
          </div>
          <button type="button" class="btn btn-xs btn-outline" id="btn-refresh-models">
            ${ICONS.refresh} ${isEs ? 'Actualizar Lista' : 'Refresh List'}
          </button>
        </div>

        <div class="models-list" id="bridge-models-list">
          ${buildBridgeModelsHtml(ctx)}
        </div>
      </div>
    </div>
  `;
}

export function bindBridgeTabEvents(ctx: SettingsModalContext): void {
  if (!ctx.state.backdropEl) return;

  ctx.state.backdropEl.querySelector('#bridge-url-input')?.addEventListener('change', async () => {
    const input = ctx.state.backdropEl?.querySelector<HTMLInputElement>('#bridge-url-input');
    const val = input?.value.trim() ?? '';
    try {
      bridgeClient.setUrl(val || 'http://127.0.0.1:7860');
      toast('Bridge endpoint saved. Reconnecting…', 'info');
    } catch (err) {
      toast(`Invalid bridge URL: ${String(err)}`, 'error');
    }
    await bridgeClient.checkHealth();
    ctx.rerender();
  });
  ctx.state.backdropEl.querySelector('#btn-bridge-save-url')?.addEventListener('click', async () => {
    const input = ctx.state.backdropEl?.querySelector<HTMLInputElement>('#bridge-url-input');
    const val = input?.value.trim() ?? '';
    try {
      bridgeClient.setUrl(val || 'http://127.0.0.1:7860');
      toast('Bridge endpoint saved. Reconnecting…', 'info');
    } catch (err) {
      toast(`Invalid bridge URL: ${String(err)}`, 'error');
    }
    await bridgeClient.checkHealth();
    ctx.rerender();
  });
  ctx.state.backdropEl.querySelector('#bridge-token-input')?.addEventListener('change', () => {
    const input = ctx.state.backdropEl?.querySelector<HTMLInputElement>('#bridge-token-input');
    bridgeClient.setBridgeToken(input?.value ?? '');
    toast('Bridge token saved locally', 'info');
  });
  ctx.state.backdropEl.querySelector('#btn-bridge-clear-token')?.addEventListener('click', () => {
    bridgeClient.setBridgeToken('');
    ctx.rerender();
    toast('Bridge token cleared', 'info');
  });

  ctx.state.backdropEl.querySelector('#btn-bridge-retry')?.addEventListener('click', async () => {
    toast('Checking Companion Bridge connection...', 'info');
    await bridgeClient.checkHealth();
    await refreshBridgeModels(ctx);
    ctx.rerender();
  });

  ctx.state.backdropEl.querySelector('#btn-refresh-models')?.addEventListener('click', async () => {
    await refreshBridgeModels(ctx);
    ctx.rerender();
  });

  bindBridgeModelActions(ctx);
}
