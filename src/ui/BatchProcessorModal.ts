// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Phase 12: Batch Processor Modal Dialog
// ─────────────────────────────────────────────────────────

import { ICONS } from './icons.ts';
import { escHtml, escAttr } from './escape.ts';
import { createModalFocusTrap, type FocusTrap } from './modalFocusTrap.ts';
import { toast } from './notify.ts';
import { extractSf2PresetsToCandidates } from '../core/batch/Sf2BatchExtractor.ts';
import { extractFolderFilesToCandidates, type FolderFileInput } from '../core/batch/FolderBatchExtractor.ts';
import { BatchQueue } from '../core/batch/BatchQueue.ts';
import { buildBatchPreflightSummary } from '../core/batch/preflight.ts';
import type {
  BatchConfig,
  BatchModelCandidate,
  BatchProgressState,
  BatchResultSummary,
} from '../core/batch/types.ts';
import type { ProcessConfig, WorkingMode } from '../core/types.ts';
import { bridgeClient } from '../core/bridge/BridgeClient.ts';

export interface BatchModalContext {
  getCurrentProcessConfig: () => ProcessConfig;
  getCurrentWorkingMode: () => WorkingMode;
  getAiEngineStatusLabel: () => string;
  onRefreshBankDrawer?: () => void;
}

export type BatchModalStep = 'discover' | 'preflight' | 'running' | 'done';

export class BatchProcessorModal {
  private backdropEl: HTMLElement | null = null;
  private focusTrap: FocusTrap | null = null;
  private currentStep: BatchModalStep = 'discover';
  private queue = new BatchQueue();
  private candidates: BatchModelCandidate[] = [];
  private selectedCandidateIds = new Set<string>();
  private activeConfig: BatchConfig;
  private context: BatchModalContext;
  private progressState: BatchProgressState | null = null;
  private finalSummary: BatchResultSummary | null = null;
  private unsubscribeQueue: (() => void) | null = null;
  private isScanningLocal = false;

  constructor(context: BatchModalContext) {
    this.context = context;
    const initialProc = context.getCurrentProcessConfig();
    this.activeConfig = {
      targetFormat: initialProc.targetFormat || 'dual',
      destination: 'axionikdb',
      complexityStrategy: 'auto',
      dspAlgorithm: initialProc.dspAlgorithm || 'legacy',
      autoAcousticClassification: true,
      outputMasterZipName: `BatchExport_${new Date().toISOString().slice(0, 10)}.zip`,
      axionikDbPath:
        (typeof localStorage !== 'undefined' ? localStorage.getItem('abd_axionikdb_path') : null) ||
        'd:\\desarrollos\\ABDSynths\\AxionikDB',
    };
  }

  public open(): void {
    if (this.backdropEl) return;
    this.currentStep = 'discover';
    this.candidates = [];
    this.selectedCandidateIds.clear();
    this.progressState = null;
    this.finalSummary = null;

    // Refresh active config with current session state
    const currentProc = this.context.getCurrentProcessConfig();
    this.activeConfig.dspAlgorithm = currentProc.dspAlgorithm || 'legacy';
    this.activeConfig.targetFormat = currentProc.targetFormat || 'dual';

    this.render();
  }

  public close(): void {
    if (this.queue.getProgressState().status === 'running') {
      if (!confirm('A batch process is currently running. Do you want to cancel it and exit?')) {
        return;
      }
      this.queue.cancel();
    }
    this.cleanup();
  }

  private cleanup(): void {
    if (this.unsubscribeQueue) {
      this.unsubscribeQueue();
      this.unsubscribeQueue = null;
    }
    if (this.focusTrap) {
      this.focusTrap.deactivate();
      this.focusTrap = null;
    }
    if (this.backdropEl) {
      this.backdropEl.remove();
      this.backdropEl = null;
    }
  }

  private render(): void {
    if (!this.backdropEl) {
      this.backdropEl = document.createElement('div');
      this.backdropEl.className = 'nmm-modal-backdrop nmm-batch-backdrop';
      document.body.appendChild(this.backdropEl);

      this.backdropEl.addEventListener('click', (e) => {
        if (e.target === this.backdropEl) this.close();
      });
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.backdropEl) this.close();
      });
    }

    let bodyHtml = '';
    if (this.currentStep === 'discover') {
      bodyHtml = this.renderDiscoverStep();
    } else if (this.currentStep === 'preflight') {
      bodyHtml = this.renderPreflightStep();
    } else if (this.currentStep === 'running') {
      bodyHtml = this.renderRunningStep();
    } else if (this.currentStep === 'done') {
      bodyHtml = this.renderDoneStep();
    }

    this.backdropEl.innerHTML = `
      <div class="nmm-modal-window nmm-batch-window" role="dialog" aria-modal="true" aria-labelledby="batch-modal-title">
        <header class="nmm-modal-header">
          <div class="nmm-modal-header-title">
            <span class="nmm-modal-header-icon">${ICONS.layers || ''}</span>
            <h2 id="batch-modal-title">Batch Processor (Phase 12)</h2>
          </div>
          <button type="button" class="nmm-modal-close" aria-label="Close" id="btn-batch-close">${ICONS.close || 'X'}</button>
        </header>

        <nav class="nmm-batch-steps-nav" aria-label="Batch progress stages">
          <div class="nmm-batch-step-indicator ${this.currentStep === 'discover' ? 'is-active' : ''}">1. Discovery</div>
          <div class="nmm-batch-step-indicator ${this.currentStep === 'preflight' ? 'is-active' : ''}">2. Preflight Summary</div>
          <div class="nmm-batch-step-indicator ${this.currentStep === 'running' ? 'is-active' : ''}">3. Execution</div>
          <div class="nmm-batch-step-indicator ${this.currentStep === 'done' ? 'is-active' : ''}">4. Report</div>
        </nav>

        <div class="nmm-modal-body nmm-batch-body">
          ${bodyHtml}
        </div>
      </div>
    `;

    this.bindEvents();

    if (!this.focusTrap) {
      this.focusTrap = createModalFocusTrap(
        this.backdropEl.querySelector('.nmm-batch-window')!,
        { onEscape: () => this.close() }
      );
      this.focusTrap.activate();
    }
  }

  // ── Step 1: Discovery ──────────────────────────────────

  private renderDiscoverStep(): string {
    const isBridgeOnline = bridgeClient.isConnected();
    const defaultScanPath = 'd:\\desarrollos\\ABDSynths\\_RESOURCES\\Soundfonts';

    return `
      <div class="nmm-batch-discover-pane">
        <div class="nmm-batch-card">
          <h3>Select Source Material</h3>
          <p class="nmm-batch-hint">
            Convert entire SoundFonts (multi-preset), multi-folder sample packs, or historic NeuronDB collections in a single unattended pass.
          </p>

          <div class="nmm-batch-dropzone" id="batch-dropzone">
            <div class="nmm-batch-dropzone-icon">${ICONS.upload || ''}</div>
            <div class="nmm-batch-dropzone-text">Drag & drop <strong>.sf2</strong>, <strong>.zip</strong>, or audio folders here</div>
            <div class="nmm-batch-dropzone-sub">or use the buttons below</div>
            
            <div class="nmm-batch-dropzone-actions">
              <label class="nmm-btn nmm-btn-secondary">
                Select SoundFont (.sf2)
                <input type="file" id="input-batch-sf2" accept=".sf2" style="display: none;" />
              </label>

              <label class="nmm-btn nmm-btn-secondary">
                Select Audio Folder
                <input type="file" id="input-batch-folder" webkitdirectory directory multiple style="display: none;" />
              </label>
            </div>
          </div>
        </div>

        <div class="nmm-batch-card">
          <h3>Companion Bridge Local Disk Scanner</h3>
          <p class="nmm-batch-hint">
            Scan high-capacity local disk folders without loading gigabytes of raw audio into browser memory.
          </p>
          <div class="nmm-batch-scan-row">
            <input type="text" id="input-batch-scan-path" class="nmm-input" value="${escAttr(defaultScanPath)}" placeholder="C:\\path\\to\\soundfonts" />
            <button type="button" class="nmm-btn nmm-btn-primary" id="btn-batch-scan-disk" ${!isBridgeOnline ? 'disabled' : ''}>
              ${this.isScanningLocal ? 'Scanning...' : 'Scan Folder'}
            </button>
          </div>
          ${!isBridgeOnline ? `<div class="nmm-alert-subtle">Companion Bridge is offline. Start the bridge daemon on <code>127.0.0.1:7860</code> to scan local disk paths directly.</div>` : ''}
        </div>
      </div>
    `;
  }

  // ── Step 2: Preflight Summary ──────────────────────────

  private renderPreflightStep(): string {
    const summary = buildBatchPreflightSummary(this.candidates, this.activeConfig, {
      workingMode: this.context.getCurrentWorkingMode(),
      aiEngineLabel: this.context.getAiEngineStatusLabel(),
      selectedIds: this.selectedCandidateIds,
    });

    const isAllSelected = this.selectedCandidateIds.size === this.candidates.length;

    const rowsHtml = summary.models.map((m) => {
      const isChecked = this.selectedCandidateIds.has(m.id);
      return `
        <tr class="nmm-batch-table-row ${isChecked ? 'is-selected' : ''}">
          <td class="col-check">
            <input type="checkbox" class="chk-candidate-item" data-id="${escAttr(m.id)}" ${isChecked ? 'checked' : ''} />
          </td>
          <td class="col-name">
            <strong>${escHtml(m.name)}</strong>
            <span class="nmm-badge-slug">${escHtml(m.slug)}</span>
          </td>
          <td class="col-origin">${escHtml(m.sourceOrigin)}</td>
          <td class="col-zones">${m.zoneCount} zone(s) · ${m.fileCount} file(s)</td>
          <td class="col-cat">
            <span class="nmm-badge-cat">${escHtml(m.detectedCategory)} (Set ${m.suggestedParameterSet})</span>
          </td>
        </tr>
      `;
    }).join('');

    return `
      <div class="nmm-batch-preflight-pane">
        <!-- Execution Profile -->
        <div class="nmm-batch-card nmm-preflight-profile">
          <h3>Execution Profile (Inherited from Active Session)</h3>
          <div class="nmm-preflight-grid">
            <div class="profile-item">
              <span class="profile-label">DSP Algorithm:</span>
              <strong class="profile-val">${escHtml(summary.executionProfile.dspAlgorithmLabel)}</strong>
            </div>
            <div class="profile-item">
              <span class="profile-label">Working Mode:</span>
              <strong class="profile-val">${escHtml(summary.executionProfile.workingModeLabel)}</strong>
            </div>
            <div class="profile-item">
              <span class="profile-label">AI Engine:</span>
              <strong class="profile-val">${escHtml(summary.executionProfile.aiEngineLabel)}</strong>
            </div>
            <div class="profile-item">
              <span class="profile-label">Complexity:</span>
              <strong class="profile-val">${escHtml(summary.executionProfile.complexityLabel)}</strong>
            </div>
            <div class="profile-item">
              <span class="profile-label">Destination:</span>
              <strong class="profile-val">${escHtml(summary.executionProfile.destinationLabel)} (<code>${escHtml(summary.executionProfile.destinationPathOrName)}</code>)</strong>
            </div>
            <div class="profile-item">
              <span class="profile-label">Estimated Duration:</span>
              <strong class="profile-val">~${summary.estimatedDurationSec} seconds</strong>
            </div>
          </div>
        </div>

        <!-- Discovered Models Table -->
        <div class="nmm-batch-card nmm-preflight-table-card">
          <div class="nmm-preflight-table-header">
            <h3>Discovered Models & Files (${summary.selectedCount} of ${summary.totalDiscovered} selected)</h3>
            <div class="nmm-preflight-table-actions">
              <button type="button" class="nmm-btn nmm-btn-subtle" id="btn-toggle-all-candidates">
                ${isAllSelected ? 'Deselect All' : 'Select All'}
              </button>
            </div>
          </div>

          <div class="nmm-batch-table-container">
            <table class="nmm-batch-table">
              <thead>
                <tr>
                  <th class="col-check"></th>
                  <th class="col-name">Model Name & Slug</th>
                  <th class="col-origin">Source Origin</th>
                  <th class="col-zones">Coverage</th>
                  <th class="col-cat">Classification</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Action Footer -->
        <div class="nmm-batch-footer-row">
          <button type="button" class="nmm-btn nmm-btn-subtle" id="btn-preflight-back">Back</button>
          <button type="button" class="nmm-btn nmm-btn-primary" id="btn-preflight-start" ${summary.selectedCount === 0 ? 'disabled' : ''}>
            Start Batch Processing (${summary.selectedCount} Models)
          </button>
        </div>
      </div>
    `;
  }

  // ── Step 3: Execution ──────────────────────────────────

  private renderRunningStep(): string {
    const s = this.progressState || this.queue.getProgressState();
    const isPaused = s.status === 'paused';

    const jobRows = this.candidates
      .filter((c) => this.selectedCandidateIds.has(c.id))
      .map((j) => {
        let statusBadge = '<span class="status-pending">Pending</span>';
        if (j.status === 'processing') {
          statusBadge = `<span class="status-processing"><span class="nmm-spinner"></span> Processing (${j.progressPct}%)</span>`;
        } else if (j.status === 'completed') {
          statusBadge = '<span class="status-completed">Completed</span>';
        } else if (j.status === 'failed') {
          statusBadge = `<span class="status-failed" title="${escAttr(j.error || '')}">Failed</span>`;
        } else if (j.status === 'skipped') {
          statusBadge = '<span class="status-skipped">Skipped</span>';
        }

        return `
          <tr class="nmm-batch-run-row ${j.status}">
            <td class="col-name"><strong>${escHtml(j.name)}</strong></td>
            <td class="col-slug"><code>${escHtml(j.slug)}</code></td>
            <td class="col-status">${statusBadge}</td>
            <td class="col-duration">${j.durationMs ? `${(j.durationMs / 1000).toFixed(1)}s` : '-'}</td>
          </tr>
        `;
      }).join('');

    return `
      <div class="nmm-batch-running-pane">
        <div class="nmm-batch-card">
          <div class="nmm-batch-progress-header">
            <h3>Processing Batch: ${s.completedJobs + s.failedJobs} of ${s.totalJobs} models</h3>
            <span class="nmm-batch-overall-pct">${s.overallPct}%</span>
          </div>

          <div class="nmm-batch-progress-bar-wrap">
            <div class="nmm-batch-progress-bar-fill" style="width: ${s.overallPct}%"></div>
          </div>

          <div class="nmm-batch-progress-stats">
            <span>Current: <strong>${escHtml(s.currentJobName || 'Preparing...')}</strong></span>
            <span>Elapsed: ${(s.elapsedMs / 1000).toFixed(0)}s</span>
            <span>ETA: ${(s.estimatedRemainingMs / 1000).toFixed(0)}s</span>
          </div>
        </div>

        <div class="nmm-batch-card nmm-batch-run-table-card">
          <div class="nmm-batch-table-container">
            <table class="nmm-batch-table">
              <thead>
                <tr>
                  <th class="col-name">Model</th>
                  <th class="col-slug">Slug</th>
                  <th class="col-status">Status</th>
                  <th class="col-duration">Time</th>
                </tr>
              </thead>
              <tbody>
                ${jobRows}
              </tbody>
            </table>
          </div>
        </div>

        <div class="nmm-batch-footer-row">
          <button type="button" class="nmm-btn nmm-btn-danger" id="btn-batch-cancel">Cancel Batch</button>
          <button type="button" class="nmm-btn nmm-btn-secondary" id="btn-batch-pause">
            ${isPaused ? 'Resume' : 'Pause'}
          </button>
        </div>
      </div>
    `;
  }

  // ── Step 4: Completion Summary ─────────────────────────

  private renderDoneStep(): string {
    const sum = this.finalSummary;
    if (!sum) return '';

    const hasZip = !!sum.masterZipBytes;
    const zipSizeMb = hasZip ? (sum.masterZipBytes!.byteLength / (1024 * 1024)).toFixed(2) : '0';

    return `
      <div class="nmm-batch-done-pane">
        <div class="nmm-batch-card nmm-batch-summary-card">
          <h3>Batch Processing Finished</h3>
          <p class="nmm-batch-hint">Completed in ${(sum.totalDurationMs / 1000).toFixed(1)} seconds.</p>

          <div class="nmm-batch-summary-stats">
            <div class="stat-box success">
              <span class="stat-num">${sum.succeeded}</span>
              <span class="stat-lbl">Succeeded</span>
            </div>
            <div class="stat-box danger">
              <span class="stat-num">${sum.failed}</span>
              <span class="stat-lbl">Failed</span>
            </div>
            <div class="stat-box neutral">
              <span class="stat-num">${sum.skipped}</span>
              <span class="stat-lbl">Skipped</span>
            </div>
          </div>
        </div>

        <div class="nmm-batch-footer-row">
          ${hasZip ? `<button type="button" class="nmm-btn nmm-btn-primary" id="btn-download-master-zip">Download Master ZIP (${zipSizeMb} MB)</button>` : ''}
          <button type="button" class="nmm-btn nmm-btn-secondary" id="btn-batch-export-json">Export Log (JSON)</button>
          <button type="button" class="nmm-btn nmm-btn-subtle" id="btn-batch-finish-close">Close</button>
        </div>
      </div>
    `;
  }

  // ── Event Bindings ─────────────────────────────────────

  private bindEvents(): void {
    if (!this.backdropEl) return;

    // Close button
    this.backdropEl.querySelector('#btn-batch-close')?.addEventListener('click', () => this.close());

    // Step 1: File inputs
    const sf2Input = this.backdropEl.querySelector('#input-batch-sf2') as HTMLInputElement | null;
    sf2Input?.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      await this.handleSf2File(file);
    });

    const folderInput = this.backdropEl.querySelector('#input-batch-folder') as HTMLInputElement | null;
    folderInput?.addEventListener('change', async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files || files.length === 0) return;
      await this.handleFolderFiles(Array.from(files));
    });

    // Step 1: Scan local disk path via Companion Bridge
    const scanBtn = this.backdropEl.querySelector('#btn-batch-scan-disk');
    scanBtn?.addEventListener('click', async () => {
      const pathInput = this.backdropEl?.querySelector('#input-batch-scan-path') as HTMLInputElement | null;
      const targetPath = pathInput?.value.trim() || '';
      if (!targetPath) {
        toast('Please enter a directory path on your local disk.', 'warning');
        return;
      }
      this.isScanningLocal = true;
      this.render();
      try {
        const scanResult = await bridgeClient.scanLocalFiles(targetPath);
        const sf2Count = scanResult.files.filter((f) => f.ext.toLowerCase() === '.sf2').length;
        const wavCount = scanResult.files.filter((f) => ['.wav', '.aif', '.aiff'].includes(f.ext.toLowerCase())).length;
        toast(`Discovered ${scanResult.total_files} files (${sf2Count} soundfonts, ${wavCount} audio samples).`, 'info');
        // When soundfonts found, we can parse or offer to load
        this.isScanningLocal = false;
        this.render();
      } catch (err) {
        this.isScanningLocal = false;
        toast(`Scan failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
        this.render();
      }
    });

    // Step 2: Toggle candidate selections
    this.backdropEl.querySelectorAll('.chk-candidate-item').forEach((chk) => {
      chk.addEventListener('change', (e) => {
        const id = (e.target as HTMLElement).getAttribute('data-id');
        if (!id) return;
        if ((e.target as HTMLInputElement).checked) {
          this.selectedCandidateIds.add(id);
        } else {
          this.selectedCandidateIds.delete(id);
        }
        this.render();
      });
    });

    this.backdropEl.querySelector('#btn-toggle-all-candidates')?.addEventListener('click', () => {
      if (this.selectedCandidateIds.size === this.candidates.length) {
        this.selectedCandidateIds.clear();
      } else {
        this.candidates.forEach((c) => this.selectedCandidateIds.add(c.id));
      }
      this.render();
    });

    this.backdropEl.querySelector('#btn-preflight-back')?.addEventListener('click', () => {
      this.currentStep = 'discover';
      this.render();
    });

    this.backdropEl.querySelector('#btn-preflight-start')?.addEventListener('click', async () => {
      await this.startQueue();
    });

    // Step 3: Running controls
    this.backdropEl.querySelector('#btn-batch-pause')?.addEventListener('click', () => {
      const state = this.queue.getProgressState();
      if (state.status === 'paused') {
        this.queue.resume();
      } else {
        this.queue.pause();
      }
      this.render();
    });

    this.backdropEl.querySelector('#btn-batch-cancel')?.addEventListener('click', () => {
      if (confirm('Are you sure you want to cancel the batch?')) {
        this.queue.cancel();
      }
    });

    // Step 4: Done actions
    this.backdropEl.querySelector('#btn-download-master-zip')?.addEventListener('click', () => {
      if (this.finalSummary?.masterZipBytes) {
        this.downloadBlob(
          this.finalSummary.masterZipBytes,
          this.activeConfig.outputMasterZipName || 'BatchExport.zip',
          'application/zip'
        );
      }
    });

    this.backdropEl.querySelector('#btn-batch-export-json')?.addEventListener('click', () => {
      if (this.finalSummary) {
        const text = JSON.stringify(this.finalSummary, null, 2);
        this.downloadBlob(new TextEncoder().encode(text), 'BatchLog.json', 'application/json');
      }
    });

    this.backdropEl.querySelector('#btn-batch-finish-close')?.addEventListener('click', () => {
      this.context.onRefreshBankDrawer?.();
      this.close();
    });
  }

  // ── Source Ingestion Helpers ───────────────────────────

  private async handleSf2File(file: File): Promise<void> {
    try {
      const buf = await file.arrayBuffer();
      const extracted = extractSf2PresetsToCandidates(buf, { soundFontName: file.name.replace(/\.[^.]+$/, '') });
      if (extracted.length === 0) {
        toast(`No presets found in SoundFont "${file.name}".`, 'warning');
        return;
      }
      this.candidates = extracted;
      this.selectedCandidateIds = new Set(extracted.map((c) => c.id));
      this.currentStep = 'preflight';
      this.render();
      toast(`Discovered ${extracted.length} presets from "${file.name}".`, 'success');
    } catch (err) {
      toast(`Failed to read SoundFont: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }

  private async handleFolderFiles(files: File[]): Promise<void> {
    try {
      const fileInputs: FolderFileInput[] = [];
      for (const f of files) {
        const ext = f.name.split('.').pop()?.toLowerCase();
        if (ext === 'wav' || ext === 'aif' || ext === 'aiff') {
          fileInputs.push({
            path: f.webkitRelativePath || f.name,
            name: f.name,
            buffer: await f.arrayBuffer(),
          });
        }
      }

      const extracted = extractFolderFilesToCandidates(fileInputs);
      if (extracted.length === 0) {
        toast('No WAV or AIFF sample files found in selected directory.', 'warning');
        return;
      }
      this.candidates = extracted;
      this.selectedCandidateIds = new Set(extracted.map((c) => c.id));
      this.currentStep = 'preflight';
      this.render();
      toast(`Discovered ${extracted.length} model sets from folder.`, 'success');
    } catch (err) {
      toast(`Failed to read folder files: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }

  // ── Queue Execution ────────────────────────────────────

  private async startQueue(): Promise<void> {
    const selectedJobs = this.candidates.filter((c) => this.selectedCandidateIds.has(c.id));
    if (selectedJobs.length === 0) {
      toast('Please select at least one model to process.', 'warning');
      return;
    }

    this.queue.setJobs(selectedJobs);
    this.currentStep = 'running';
    this.render();

    this.unsubscribeQueue = this.queue.on((event, data) => {
      if (event === 'progress') {
        this.progressState = data as BatchProgressState;
        this.render();
      } else if (event === 'queue-complete') {
        this.finalSummary = data as BatchResultSummary;
        this.currentStep = 'done';
        this.render();
      }
    });

    try {
      await this.queue.start(this.activeConfig);
    } catch (err) {
      toast(`Batch queue error: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }

  private downloadBlob(bytes: Uint8Array, fileName: string, mimeType: string): void {
    const blob = new Blob([bytes as any], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 100);
  }
}
