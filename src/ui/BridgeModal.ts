// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Local Companion Bridge Modal (Fase 10.B)
// Status inspection, configuration, hardware capabilities,
// filesystem scanning, and launcher guide for the local Python AI bridge.
// ─────────────────────────────────────────────────────────

import { bridgeClient, type BridgeStatus, type BridgeScanResult } from '../core/bridge/BridgeClient';
import { ICONS } from './icons';
import { toast } from './notify';

export class BridgeModal {
  private backdropEl: HTMLElement | null = null;
  private scanResults: BridgeScanResult | null = null;
  private isScanning = false;
  private unsubscribe: (() => void) | null = null;

  public open(): void {
    if (!this.backdropEl) {
      this.backdropEl = document.createElement('div');
      this.backdropEl.className = 'modal-backdrop is-hidden';
      document.body.appendChild(this.backdropEl);
    }

    this.render();
    this.backdropEl.classList.remove('is-hidden');

    // Subscribe to live status updates while modal is open
    this.unsubscribe = bridgeClient.subscribe(() => {
      this.updateStatusSection();
    });

    // Check health immediately on open
    void bridgeClient.checkHealth();
  }

  public close(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.backdropEl?.classList.add('is-hidden');
  }

  private render(): void {
    if (!this.backdropEl) return;
    const status = bridgeClient.getStatus();
    const isOnline = status.connected;

    this.backdropEl.innerHTML = `
      <div class="process-modal-card bridge-modal-card" role="dialog" aria-modal="true" aria-label="Local Companion Bridge">
        <!-- Header -->
        <div class="modal-header bridge-modal-header">
          <div class="modal-title">
            <span class="modal-icon">${ICONS.cpu}</span>
            <span>LOCAL AI & COMPANION BRIDGE</span>
            <span class="panel-badge ${isOnline ? 'badge-success' : 'badge-muted'}" id="bridge-header-badge">
              ${isOnline ? '● ONLINE' : '○ OFFLINE'}
            </span>
          </div>
          <button type="button" class="btn btn-close-modal" id="btn-close-bridge-modal" title="Close (Esc)">
            ${ICONS.close}
          </button>
        </div>

        <!-- Body -->
        <div class="modal-body bridge-modal-body">
          <!-- Connection Settings Bar -->
          <div class="bridge-config-bar">
            <div class="bridge-input-group">
              <label for="bridge-url-input" class="bridge-label">Bridge Server URL:</label>
              <input type="text" id="bridge-url-input" class="form-control bridge-url-field" value="${status.url}" placeholder="http://127.0.0.1:7860" />
            </div>
            <button type="button" class="btn btn-secondary" id="btn-test-bridge">
              ${ICONS.refresh ?? '↻'} Check Connection
            </button>
          </div>

          <!-- Live Status Details Container -->
          <div id="bridge-details-container" class="bridge-details-box">
            ${this.buildStatusHtml(status)}
          </div>

          <!-- Local Filesystem Bridge Section -->
          <div class="bridge-section">
            <h4 class="bridge-section-title">
              <span class="bridge-section-icon">${ICONS.folder}</span>
              Direct Local Filesystem Scan (NeuronDB & SoundFonts)
            </h4>
            <p class="bridge-text-muted">
              Scan local folders on your system without browser upload limits or sandbox restrictions:
            </p>
            <div class="bridge-scan-bar">
              <input type="text" id="bridge-scan-path" class="form-control bridge-path-field"
                placeholder="e.g. d:\\desarrollos\\ABDSynths\\_RESOURCES\\Soundfonts or C:\\NeuronDB"
                value="d:\\desarrollos\\ABDSynths\\_RESOURCES\\Soundfonts" />
              <button type="button" class="btn btn-primary" id="btn-run-fs-scan" ${!isOnline ? 'disabled' : ''}>
                Scan Directory
              </button>
            </div>
            <div id="bridge-scan-results" class="bridge-scan-results">
              ${this.buildScanResultsHtml()}
            </div>
          </div>

          <!-- Setup & Launch Instructions -->
          <div class="bridge-section bridge-guide-section">
            <h4 class="bridge-section-title">
              <span class="bridge-section-icon">${ICONS.terminal}</span>
              How to Launch the Local Bridge
            </h4>
            <div class="bridge-guide-cards">
              <div class="bridge-guide-card">
                <h5>1. Windows 1-Click Launch</h5>
                <p>Run the launcher script included in your workspace:</p>
                <pre class="bridge-code-block"><code>bridge\\run_bridge.bat</code></pre>
                <small class="bridge-text-muted">Runs on standard Python with built-in HTTP server. Zero manual pip install required for core features.</small>
              </div>

              <div class="bridge-guide-card">
                <h5>2. Optional GPU / AI Dependencies</h5>
                <p>For PyTorch CUDA acceleration and advanced models (Demucs / AudioSR):</p>
                <pre class="bridge-code-block"><code>pip install -r bridge/requirements.txt</code></pre>
                <small class="bridge-text-muted">Automatically enables CUDA when an NVIDIA GPU is detected.</small>
              </div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="modal-footer bridge-modal-footer">
          <div class="bridge-footer-note">
            <span>ℹ️ 100% Progressive Enhancement: ABDNeuModMakr works standalone offline in any browser. The local companion bridge provides accelerated Python DSP and direct disk access.</span>
          </div>
          <button type="button" class="btn btn-primary" id="btn-ok-bridge-modal">Close</button>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private buildStatusHtml(status: BridgeStatus): string {
    if (!status.connected) {
      return `
        <div class="bridge-status-card status-disconnected">
          <div class="status-card-header">
            <span class="status-indicator-dot dot-offline"></span>
            <strong>Bridge Disconnected (${status.url})</strong>
          </div>
          <div class="status-card-body">
            <p>The companion Python server is not currently reachable. The web app is running in standalone WebAudio DSP mode.</p>
            ${status.error ? `<div class="status-error-msg">Reason: ${status.error}</div>` : ''}
            <p class="status-hint">Double-click <code>bridge\\run_bridge.bat</code> in the repository root to start the server.</p>
          </div>
        </div>
      `;
    }

    const caps = status.capabilities;
    const libs = caps?.libraries;
    const hasGpu = caps?.gpu ?? false;

    return `
      <div class="bridge-status-card status-connected">
        <div class="status-card-header">
          <div class="status-header-left">
            <span class="status-indicator-dot dot-online"></span>
            <strong>Bridge Online — ${caps?.app ?? 'ABDNeuModMakr-Bridge'} v${caps?.version ?? '1.0'}</strong>
          </div>
          <span class="bridge-latency-tag">${status.latencyMs ?? 0} ms</span>
        </div>
        
        <div class="status-grid">
          <div class="status-cell">
            <span class="cell-label">Python:</span>
            <span class="cell-val">${caps?.python ?? 'Unknown'}</span>
          </div>
          <div class="status-cell">
            <span class="cell-label">Compute Device:</span>
            <span class="cell-val ${hasGpu ? 'text-success' : ''}">${caps?.device ?? 'cpu'} ${hasGpu ? `(${caps?.gpu_name})` : ''}</span>
          </div>
          <div class="status-cell">
            <span class="cell-label">NumPy:</span>
            <span class="cell-val ${libs?.numpy ? 'text-success' : 'text-muted'}">${libs?.numpy ? 'Available' : 'Not installed'}</span>
          </div>
          <div class="status-cell">
            <span class="cell-label">SoundFile:</span>
            <span class="cell-val ${libs?.soundfile ? 'text-success' : 'text-muted'}">${libs?.soundfile ? 'Available' : 'Not installed'}</span>
          </div>
          <div class="status-cell">
            <span class="cell-label">SciPy:</span>
            <span class="cell-val ${libs?.scipy ? 'text-success' : 'text-muted'}">${libs?.scipy ? 'Available' : 'Not installed'}</span>
          </div>
          <div class="status-cell">
            <span class="cell-label">PyTorch / CUDA:</span>
            <span class="cell-val ${libs?.torch ? 'text-success' : 'text-muted'}">${libs?.torch ? (hasGpu ? 'CUDA Enabled' : 'CPU Only') : 'Not installed'}</span>
          </div>
        </div>

        <div class="status-caps-row">
          <span class="caps-label">Active Capabilities:</span>
          <div class="caps-tags">
            ${(caps?.capabilities ?? []).map((c) => `<span class="cap-tag">${c}</span>`).join('')}
          </div>
        </div>
      </div>
    `;
  }

  private buildScanResultsHtml(): string {
    if (this.isScanning) {
      return `<div class="scan-loading-indicator"><span class="spinner-small"></span> Scanning directory via local companion bridge...</div>`;
    }
    if (!this.scanResults) {
      return `<div class="scan-placeholder text-muted">Enter a directory path and click "Scan Directory" to view local models and audio files.</div>`;
    }

    const res = this.scanResults;
    if (res.total_files === 0) {
      return `<div class="scan-empty text-muted">No supported synth models (.model, .nmmodel, .sound), soundfonts (.sf2, .sfz), or audio files found in <code>${res.scanned_path}</code>.</div>`;
    }

    const items = res.files.slice(0, 50);
    return `
      <div class="scan-summary">
        <strong>Found ${res.total_files} file(s)</strong> in <code>${res.scanned_path}</code> ${res.total_files > 50 ? '(showing first 50)' : ''}:
      </div>
      <div class="scan-list-box">
        <table class="scan-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Type</th>
              <th>Size</th>
              <th>Path</th>
            </tr>
          </thead>
          <tbody>
            ${items
              .map(
                (f) => `
              <tr>
                <td class="scan-filename"><strong>${f.name}</strong></td>
                <td><span class="file-ext-badge ext-${f.ext.replace('.', '')}">${f.ext.toUpperCase()}</span></td>
                <td>${(f.size / 1024).toFixed(1)} KB</td>
                <td class="scan-path-cell" title="${f.path}">${f.path}</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  private updateStatusSection(): void {
    if (!this.backdropEl) return;
    const status = bridgeClient.getStatus();
    const isOnline = status.connected;

    const badge = this.backdropEl.querySelector('#bridge-header-badge');
    if (badge) {
      badge.className = `panel-badge ${isOnline ? 'badge-success' : 'badge-muted'}`;
      badge.textContent = isOnline ? '● ONLINE' : '○ OFFLINE';
    }

    const container = this.backdropEl.querySelector('#bridge-details-container');
    if (container) {
      container.innerHTML = this.buildStatusHtml(status);
    }

    const scanBtn = this.backdropEl.querySelector<HTMLButtonElement>('#btn-run-fs-scan');
    if (scanBtn) {
      scanBtn.disabled = !isOnline;
    }
  }

  private bindEvents(): void {
    if (!this.backdropEl) return;

    // Close buttons
    const close = () => this.close();
    this.backdropEl.querySelector('#btn-close-bridge-modal')?.addEventListener('click', close);
    this.backdropEl.querySelector('#btn-ok-bridge-modal')?.addEventListener('click', close);

    // Escape key
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !this.backdropEl?.classList.contains('is-hidden')) {
        close();
      }
    };
    window.addEventListener('keydown', onKey);

    // Click outside
    this.backdropEl.addEventListener('click', (e) => {
      if (e.target === this.backdropEl) {
        close();
      }
    });

    // Test Connection
    this.backdropEl.querySelector('#btn-test-bridge')?.addEventListener('click', async () => {
      const urlInput = this.backdropEl?.querySelector<HTMLInputElement>('#bridge-url-input');
      if (urlInput) {
        bridgeClient.setUrl(urlInput.value);
      }
      const testBtn = this.backdropEl?.querySelector<HTMLButtonElement>('#btn-test-bridge');
      if (testBtn) {
        testBtn.disabled = true;
        testBtn.textContent = 'Checking...';
      }
      try {
        const res = await bridgeClient.checkHealth();
        if (res.connected) {
          toast(`Local AI Companion Bridge Connected (${res.latencyMs} ms)`, 'success');
        } else {
          toast(`Bridge connection failed: ${res.error ?? 'Unreachable'}`, 'warning');
        }
      } finally {
        if (testBtn) {
          testBtn.disabled = false;
          testBtn.textContent = 'Check Connection';
        }
      }
    });

    // Run FS Scan
    this.backdropEl.querySelector('#btn-run-fs-scan')?.addEventListener('click', async () => {
      const pathInput = this.backdropEl?.querySelector<HTMLInputElement>('#bridge-scan-path');
      const targetPath = pathInput?.value.trim() || '';
      if (!targetPath) {
        toast('Please enter a directory path to scan.', 'warning');
        return;
      }

      this.isScanning = true;
      const resContainer = this.backdropEl?.querySelector('#bridge-scan-results');
      if (resContainer) {
        resContainer.innerHTML = this.buildScanResultsHtml();
      }

      try {
        this.scanResults = await bridgeClient.scanLocalFiles(targetPath);
        toast(`Scan complete: ${this.scanResults.total_files} file(s) found.`, 'success');
      } catch (err) {
        toast(`Filesystem scan error: ${err instanceof Error ? err.message : String(err)}`, 'error');
        this.scanResults = null;
      } finally {
        this.isScanning = false;
        if (resContainer) {
          resContainer.innerHTML = this.buildScanResultsHtml();
        }
      }
    });
  }
}

/** Global singleton instance */
export const bridgeModal = new BridgeModal();
