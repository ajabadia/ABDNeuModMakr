import type { BridgeModelInfo } from '../../core/bridge/BridgeClient';
import type { SettingsModalContext } from './types';
import { getAppLocale } from '../../core/i18n';
import { ICONS } from '../icons';
import { bridgeClient } from '../../core/bridge/BridgeClient';
import { confirmDialog } from '../notify';
import { escAttr } from '../escape';
import { escHtml } from '../escape';
import { toast } from '../notify';

export function buildBridgeModelsHtml(ctx: SettingsModalContext): string {
  const isEs = getAppLocale() === 'es';
  if (!bridgeClient.isConnected()) {
    return `
      <div class="models-empty-state is-err">
        <span class="nmm-status-pill is-err">${isEs ? 'BRIDGE OFFLINE' : 'BRIDGE OFFLINE'}</span>
        <p class="text-muted">${isEs ? 'Companion Bridge apagado (puerto 7860). Inicia bridge/server.py y pulsa Reintentar.' : 'Companion Bridge is offline (port 7860). Start bridge/server.py and press Retry.'}</p>
        <button type="button" class="btn btn-sm btn-outline" id="btn-bridge-retry">${isEs ? 'Reintentar Conexión' : 'Retry Connection'}</button>
      </div>
    `;
  }

  if (ctx.state.bridgeModelsLoading) {
    return `
      <div class="models-empty-state text-muted">
        <span class="nmm-status-pill is-accent">${isEs ? 'CARGANDO CATÁLOGO…' : 'LOADING CATALOG…'}</span>
      </div>
    `;
  }
  if (ctx.state.bridgeModelsError) {
    return `
      <div class="models-empty-state is-err">
        <span class="nmm-status-pill is-err">${isEs ? 'CATÁLOGO NO DISPONIBLE' : 'CATALOG UNAVAILABLE'}</span>
        <p class="text-muted">${isEs ? `Error HTTP/red: ${ctx.state.bridgeModelsError}` : `HTTP/network error: ${ctx.state.bridgeModelsError}`}</p>
      </div>
    `;
  }

  if (ctx.state.bridgeModels.length === 0) {
    return `
      <div class="models-empty-state text-muted">
        <span class="nmm-status-pill is-muted">${isEs ? 'CATÁLOGO VACÍO' : 'EMPTY CATALOG'}</span>
        <p class="text-muted">${isEs ? 'El bridge respondió OK pero no listó modelos.' : 'Bridge answered OK but listed no models.'}</p>
      </div>
    `;
  }

  return ctx.state.bridgeModels
    .map((m) => {
      const isDownloading = m.status === 'downloading' || ctx.state.activePollingModelIds.has(m.id);
      const isEditingUrl = ctx.state.editingUrlModelId === m.id;
      const pct = Math.min(100, Math.max(0, Math.round(m.progress)));
      const dlMb = m.downloaded_bytes ? (m.downloaded_bytes / (1024 * 1024)).toFixed(1) : '0';
      const totMb = m.total_bytes
        ? (m.total_bytes / (1024 * 1024)).toFixed(0)
        : m.size_mb.toString();
      const speedText = m.speed_mbps && m.speed_mbps > 0 ? ` &bull; ${m.speed_mbps.toFixed(1)} MB/s` : '';

      const sizeDisplay =
        m.size_mb >= 1000 ? `${(m.size_mb / 1024).toFixed(1)} GB` : `${m.size_mb} MB`;

      return `
      <div class="model-row-card ${m.installed ? 'is-installed' : ''}" data-model-id="${escAttr(m.id)}">
        <div class="nmm-item-main">
          <div class="model-row-title">
            <strong>${escHtml(m.name)}</strong>
            <span class="model-size-badge">${sizeDisplay}</span>
            <span class="model-task-badge">${escHtml(m.task)}</span>
            ${m.is_custom_url ? `<span class="nmm-status-pill is-warn" title="${isEs ? 'Mirror de descarga personalizado en uso' : 'Custom download mirror in use'}">${isEs ? 'Mirror Personalizado' : 'Custom Mirror'}</span>` : ''}
          </div>
          <p class="model-row-desc text-muted">${escHtml(m.description)}</p>
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
          ${
            isEditingUrl
              ? `
            <div class="model-url-editor-box">
              <div class="url-editor-label">${isEs ? 'URL de Descarga del Modelo:' : 'Model Download URL:'}</div>
              <div class="url-editor-input-row">
                <input type="text" class="form-control input-custom-model-url" data-id="${escAttr(m.id)}" value="${escAttr(m.url || '')}" placeholder="${escAttr(m.default_url || '')}" />
                <button type="button" class="btn btn-xs btn-outline btn-check-model-url" data-id="${escAttr(m.id)}" title="${isEs ? 'Comprobar si la URL es accesible y válida' : 'Check if URL is reachable and valid'}">${isEs ? 'Comprobar URL' : 'Check URL'}</button>
                <button type="button" class="btn btn-xs btn-primary btn-save-model-url" data-id="${escAttr(m.id)}">${isEs ? 'Guardar' : 'Save'}</button>
                <button type="button" class="btn btn-xs btn-outline btn-reset-model-url" data-id="${escAttr(m.id)}">${isEs ? 'Restaurar Oficial' : 'Reset to Official'}</button>
                <button type="button" class="btn btn-xs btn-secondary btn-cancel-model-url" data-id="${escAttr(m.id)}">${isEs ? 'Cancelar' : 'Cancel'}</button>
              </div>
              <div class="url-check-feedback" data-id="${escAttr(m.id)}"></div>
            </div>
          `
              : ''
          }
        </div>
        <div class="model-row-action">
          ${
            m.installed
              ? `
              <span class="badge-installed" title="${isEs ? 'Descargado en disco. Inferencia neuronal real pendiente: el procesado actual es DSP provisional local.' : 'Downloaded to disk. Real neural inference pending: current processing is provisional local DSP.'}">${ICONS.check} ${isEs ? 'Descargado en disco' : 'Downloaded to disk'}</span>
              <button type="button" class="btn btn-xs btn-outline btn-toggle-url-editor" data-id="${escAttr(m.id)}" title="${isEs ? 'Configurar URL / Mirror de Descarga' : 'Configure Download URL / Mirror'}">
                ${ICONS.settings} URL
              </button>
              <button type="button" class="btn btn-sm btn-outline btn-delete-model" data-id="${escAttr(m.id)}" title="${isEs ? 'Eliminar este modelo del disco local para liberar espacio' : 'Delete this model from local disk to free space'}">
                ${ICONS.trash} ${isEs ? 'Desinstalar' : 'Uninstall'}
              </button>
            `
              : isDownloading
                ? `
                <button type="button" class="btn btn-xs btn-outline btn-toggle-url-editor" data-id="${escAttr(m.id)}" title="${isEs ? 'Configurar URL / Mirror de Descarga' : 'Configure Download URL / Mirror'}">
                  ${ICONS.settings} URL
                </button>
                <button type="button" class="btn btn-sm btn-outline btn-downloading" disabled>
                  <span class="btn-spinner">${ICONS.spinner}</span>
                  <span>${isEs ? `Descargando (${pct}%)...` : `Downloading (${pct}%)...`}</span>
                </button>
              `
                : `
                <button type="button" class="btn btn-xs btn-outline btn-toggle-url-editor" data-id="${escAttr(m.id)}" title="${isEs ? 'Configurar URL / Mirror de Descarga' : 'Configure Download URL / Mirror'}">
                  ${ICONS.settings} URL
                </button>
                <button type="button" class="btn btn-sm btn-primary btn-download-model" data-id="${escAttr(m.id)}">
                  ${ICONS.zap} ${isEs ? `Descargar (${sizeDisplay})` : `Download (${sizeDisplay})`}
                </button>
              `
          }
        </div>
      </div>
    `;
    })
    .join('');
}

export function renderBridgeModelsList(ctx: SettingsModalContext): void {
  if (!ctx.state.backdropEl) return;
  const container = ctx.state.backdropEl.querySelector('#bridge-models-list');
  if (container) {
    container.innerHTML = buildBridgeModelsHtml(ctx);
    bindBridgeModelActions(ctx);
  }
}

export function bindBridgeModelActions(ctx: SettingsModalContext): void {
  if (!ctx.state.backdropEl) return;

  // Download buttons
  ctx.state.backdropEl.querySelectorAll<HTMLButtonElement>('.btn-download-model').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const modelId = btn.dataset.id;
      if (!modelId) return;

      ctx.state.activePollingModelIds.add(modelId);
      const m = ctx.state.bridgeModels.find((x) => x.id === modelId);
      if (m) {
        m.status = 'downloading';
      }
      renderBridgeModelsList(ctx);
      toast(`Initiating background download for "${m?.name || modelId}"...`, 'info');

      try {
        await bridgeClient.downloadModel(modelId);
        startModelProgressPolling(ctx, modelId);
      } catch (err) {
        ctx.state.activePollingModelIds.delete(modelId);
        if (m) {
          m.status = 'error';
        }
        toast(`Error initiating download: ${String(err)}`, 'error');
        renderBridgeModelsList(ctx);
      }
    });
  });

  // Delete / Uninstall buttons
  ctx.state.backdropEl.querySelectorAll<HTMLButtonElement>('.btn-delete-model').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const modelId = btn.dataset.id;
      if (!modelId) return;
      const m = ctx.state.bridgeModels.find((x) => x.id === modelId);
      const confirmed = await confirmDialog(
        `Do you want to uninstall "${m?.name || modelId}" from local disk to free space?`,
        { title: 'Uninstall Model', confirmLabel: 'Uninstall', danger: true }
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
        toast(`Model uninstalled: ${res.freed_mb ?? 0} MB freed on disk`, 'info');
        renderBridgeModelsList(ctx);
      } catch (err) {
        toast(`Error uninstalling model: ${String(err)}`, 'error');
      }
    });
  });

  // Toggle URL Editor buttons
  ctx.state.backdropEl.querySelectorAll<HTMLButtonElement>('.btn-toggle-url-editor').forEach((btn) => {
    btn.addEventListener('click', () => {
      const modelId = btn.dataset.id;
      ctx.state.editingUrlModelId = ctx.state.editingUrlModelId === modelId ? null : (modelId ?? null);
      renderBridgeModelsList(ctx);
    });
  });

  // Check Model URL buttons
  ctx.state.backdropEl.querySelectorAll<HTMLButtonElement>('.btn-check-model-url').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const modelId = btn.dataset.id;
      if (!modelId) return;
      const input = ctx.state.backdropEl?.querySelector<HTMLInputElement>(`.input-custom-model-url[data-id="${modelId}"]`);
      const feedback = ctx.state.backdropEl?.querySelector<HTMLElement>(`.url-check-feedback[data-id="${modelId}"]`);
      const m = ctx.state.bridgeModels.find((x) => x.id === modelId);
      const urlToCheck = input?.value.trim() || m?.url || m?.default_url || '';

      if (!urlToCheck) {
        toast('Please enter a URL to check', 'warning');
        return;
      }

      const originalText = btn.textContent;
      btn.textContent = 'Checking...';
      btn.disabled = true;

      if (feedback) {
        feedback.style.display = 'block';
        feedback.style.color = 'var(--color-text-muted)';
        feedback.textContent = 'Contacting server...';
      }

      try {
        const res = await bridgeClient.checkModelUrl(urlToCheck);
        if (res.reachable) {
          const sizeStr = res.size_bytes ? ` • ${(res.size_bytes / (1024 * 1024)).toFixed(1)} MB` : '';
          if (feedback) {
            feedback.style.color = 'var(--color-success)';
            feedback.textContent = `✓ URL is reachable (HTTP ${res.status_code || 200}${sizeStr})`;
          }
          toast(`URL is reachable (HTTP ${res.status_code || 200}${sizeStr})`, 'success');
        } else {
          if (feedback) {
            feedback.style.color = 'var(--color-danger)';
            feedback.textContent = `✗ URL check failed: ${res.error || 'Server returned unreachable status'}`;
          }
          toast(`URL unreachable: ${res.error || 'Check failed'}`, 'error');
        }
      } catch (err) {
        if (feedback) {
          feedback.style.color = 'var(--color-danger)';
          feedback.textContent = `✗ Error: ${String(err)}`;
        }
        toast(`Error checking URL: ${String(err)}`, 'error');
      } finally {
        btn.textContent = originalText;
        btn.disabled = false;
      }
    });
  });

  // Save Custom URL buttons
  ctx.state.backdropEl.querySelectorAll<HTMLButtonElement>('.btn-save-model-url').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const modelId = btn.dataset.id;
      if (!modelId) return;
      const input = ctx.state.backdropEl?.querySelector<HTMLInputElement>(`.input-custom-model-url[data-id="${modelId}"]`);
      const newUrl = input?.value.trim() ?? '';
      try {
        await bridgeClient.updateModelUrl(modelId, newUrl);
        ctx.state.editingUrlModelId = null;
        await refreshBridgeModels(ctx);
        toast('Model URL updated successfully', 'success');
      } catch (err) {
        toast(`Error updating URL: ${String(err)}`, 'error');
      }
    });
  });

  // Reset Model URL to official
  ctx.state.backdropEl.querySelectorAll<HTMLButtonElement>('.btn-reset-model-url').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const modelId = btn.dataset.id;
      if (!modelId) return;
      try {
        await bridgeClient.updateModelUrl(modelId, '');
        ctx.state.editingUrlModelId = null;
        await refreshBridgeModels(ctx);
        toast('URL reset to official repository mirror', 'info');
      } catch (err) {
        toast(`Error resetting URL: ${String(err)}`, 'error');
      }
    });
  });

  // Cancel URL Editor
  ctx.state.backdropEl.querySelectorAll<HTMLButtonElement>('.btn-cancel-model-url').forEach((btn) => {
    btn.addEventListener('click', () => {
      ctx.state.editingUrlModelId = null;
      renderBridgeModelsList(ctx);
    });
  });
}

export function startModelProgressPolling(ctx: SettingsModalContext, modelId: string): void {
  ctx.state.activePollingModelIds.add(modelId);
  if (ctx.state.downloadPollTimer) return;

  ctx.state.downloadPollTimer = setInterval(async () => {
    if (ctx.state.activePollingModelIds.size === 0) {
      if (ctx.state.downloadPollTimer) {
        clearInterval(ctx.state.downloadPollTimer);
        ctx.state.downloadPollTimer = null;
      }
      return;
    }

    for (const mId of Array.from(ctx.state.activePollingModelIds)) {
      try {
        const prog = await bridgeClient.getModelProgress(mId);
        const model = ctx.state.bridgeModels.find((m) => m.id === mId);
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
            ctx.state.activePollingModelIds.delete(mId);
            toast(`Model "${model.name}" downloaded and ready on GPU`, 'success');
          } else if (prog.status === 'error') {
            ctx.state.activePollingModelIds.delete(mId);
            toast(`Download failed for "${model.name}": ${prog.error ?? 'Network error'}`, 'error');
          }
        }
      } catch {
        // transient poll error
      }
    }
    renderBridgeModelsList(ctx);
  }, 1000);
}

export async function refreshBridgeModels(ctx: SettingsModalContext): Promise<void> {
  if (!bridgeClient.isConnected()) {
    ctx.state.bridgeModels = [];
    ctx.state.bridgeModelsError = null;
    ctx.state.bridgeModelsLoading = false;
    renderBridgeModelsList(ctx);
    return;
  }
  ctx.state.bridgeModelsLoading = true;
  ctx.state.bridgeModelsError = null;
  renderBridgeModelsList(ctx);
  try {
    ctx.state.bridgeModels = await bridgeClient.getModels();
    for (const m of ctx.state.bridgeModels) {
      if (m.status === 'downloading') {
        startModelProgressPolling(ctx, m.id);
      }
    }
  } catch (err) {
    ctx.state.bridgeModels = [];
    ctx.state.bridgeModelsError = String(err instanceof Error ? err.message : err);
  } finally {
    ctx.state.bridgeModelsLoading = false;
    renderBridgeModelsList(ctx);
  }
}
