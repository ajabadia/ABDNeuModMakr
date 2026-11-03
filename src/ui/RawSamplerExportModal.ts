// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Raw Multi-Format Sampler Export Modal (Fase 16)
//
// Interactive preflight inspection & multi-format raw exporter dialog:
// - SoundFont 2 (.sf2)
// - SFZ Format (.sfz)
// - Decent Sampler (.dspreset)
// - Bitwig Studio Multisample (.multisample)
// - Native Instruments Kontakt (.nki)
// - Steinberg HALion (.vstpreset)
// - Linear Sample Chain (.wav with RIFF cue markers)
//
// Maquetación según el esqueleto canónico DRY de modales.
// ─────────────────────────────────────────────────────────

import type { CoreService } from '../core/CoreService.ts';
import type {
  RawAudioResolution,
  RawExportOptions,
  RawNormalization,
  RawPackagingLayout,
  RawSamplerFormat,
  RawSampleRate,
  RawSamplerPreflightReport,
} from '../core/export/rawSamplerTypes.ts';
import { SAMPLER_FORMAT_METADATA } from '../core/export/rawSamplerPreflight.ts';
import {
  fromRawSamplerPreflightReport,
  renderCommonPreflightGate,
} from './preflightGateView.ts';
import { ICONS } from './icons.ts';
import { toast } from './notify.ts';
import { downloadBlob } from './download.ts';
import { formatKb } from '../core/pathUtils.ts';
import { createModalFocusTrap, type FocusTrap } from './modalFocusTrap.ts';

export interface RawSamplerExportModalContext {
  core: CoreService;
  onExportSuccess?: (filename: string, totalBytes: number) => void;
}

export class RawSamplerExportModal {
  private backdropEl: HTMLElement | null = null;
  private context: RawSamplerExportModalContext;
  private focusTrap: FocusTrap | null = null;

  private currentFormat: RawSamplerFormat = 'sf2';
  private resolution: RawAudioResolution = 'original';
  private sampleRate: RawSampleRate = 'original';
  private normalization: RawNormalization = 'none';
  private layout: RawPackagingLayout = 'folder_samples';
  private isExporting = false;

  private bankName = '';
  private author = '';
  private license = '';

  private currentReport: RawSamplerPreflightReport | null = null;

  constructor(context: RawSamplerExportModalContext) {
    this.context = context;
  }

  public open(initialFormat?: RawSamplerFormat): void {
    if (initialFormat) {
      this.currentFormat = initialFormat;
    }
    const session = this.context.core.getSession();
    this.bankName = session?.processConfig.expandedName || session?.processConfig.modelName || 'SamplerBank';
    this.author = session?.processConfig.extendedMetadata?.author || 'ABDNeuModMakr User';
    this.license = session?.processConfig.extendedMetadata?.license || 'CC-BY 4.0';

    this.updatePreflightReport();
    this.render();
  }

  public close(): void {
    if (this.focusTrap) {
      this.focusTrap.deactivate();
      this.focusTrap = null;
    }
    if (this.backdropEl) {
      this.backdropEl.remove();
      this.backdropEl = null;
    }
  }

  private getCurrentOptions(): RawExportOptions {
    return {
      format: this.currentFormat,
      resolution: this.resolution,
      sampleRate: this.sampleRate,
      normalization: this.normalization,
      layout: this.layout,
      bankName: this.bankName.trim() || 'SamplerBank',
      author: this.author.trim() || 'ABDNeuModMakr User',
      license: this.license.trim() || 'CC-BY 4.0',
    };
  }

  private updatePreflightReport(): void {
    const opts = this.getCurrentOptions();
    this.currentReport = this.context.core.analyzeRawSamplerPreflight(opts);
  }

  private render(): void {
    if (!this.backdropEl) {
      this.backdropEl = document.createElement('div');
      this.backdropEl.className = 'nmm-modal-backdrop';
      document.body.appendChild(this.backdropEl);

      this.backdropEl.addEventListener('click', (e) => {
        if (e.target === this.backdropEl && !this.isExporting) this.close();
      });
    }

    const report = this.currentReport!;
    const meta = SAMPLER_FORMAT_METADATA[this.currentFormat];
    const gateModel = fromRawSamplerPreflightReport(report, meta, {
      resolution: this.resolution,
      sampleRate: this.sampleRate,
      normalization: this.normalization,
      layout: this.layout,
    });

    const formats: Array<{ id: RawSamplerFormat; label: string; badge: string }> = [
      { id: 'sf2', label: 'SoundFont 2 (.sf2)', badge: 'RIFF sfbk' },
      { id: 'sfz', label: 'SFZ Format (.sfz)', badge: 'Open Text' },
      { id: 'dspreset', label: 'Decent Sampler (.dspreset)', badge: 'XML + UI' },
      { id: 'mpc_xpm', label: 'Akai MPC Program (.xpm)', badge: 'Keygroup/Drum' },
      { id: 'mpc_xpn', label: 'Akai MPC Expansion (.xpn)', badge: 'MPC Pack' },
      { id: 'ableton_adv', label: 'Ableton Sampler (.adv)', badge: 'Live GZIP' },
      { id: 'exs24', label: 'Apple Logic EXS24 (.exs)', badge: 'SOBT Binary' },
      { id: 'tal_sampler', label: 'TAL-Sampler (.talsmpl)', badge: '4-Layer XML' },
      { id: 'tx16wx', label: 'CWITEC TX16Wx (.txprog)', badge: 'TX 3.0 XML' },
      { id: 'korg_kmp', label: 'Korg Trinity/Triton (.KMP)', badge: 'KMP + KSF' },
      { id: 'dls', label: 'MMA Downloadable Sounds (.dls)', badge: 'RIFF DLS2' },
      { id: 'multisample', label: 'Bitwig Studio (.multisample)', badge: 'DAW Package' },
      { id: 'nki', label: 'Kontakt (.nki XML)', badge: 'NI Multisample' },
      { id: 'vstpreset', label: 'HALion (.vstpreset)', badge: 'Steinberg' },
      { id: 'sample_chain', label: 'Linear Sample Chain (.wav)', badge: 'Cue Markers' },
    ];

    this.backdropEl.innerHTML = `
      <div class="nmm-modal-window nmm-modal-xl" role="dialog" aria-modal="true" aria-label="Exportar banco a formato sampler">
        <div class="nmm-modal-header">
          <div class="nmm-modal-header-title">
            <span class="modal-icon">${ICONS.database}</span>
            <div>
              <h2>Universal Raw Multi-Format Sampler Exporter</h2>
              <p class="nmm-header-sub">Muestras y zonas originales sin transformación (Fase 16)</p>
            </div>
          </div>
          <button type="button" class="btn btn-close-modal" id="btn-close-sampler-modal" title="Cerrar (Esc)" aria-label="Cerrar">${ICONS.close}</button>
        </div>

        <div class="raw-export-body">
          <div class="raw-settings">
            <div class="form-group">
              <label>Formato de Sampler Destino</label>
              <div class="raw-format-list">
                ${formats
                  .map(
                    (f) => `
                  <button type="button" class="raw-format-btn ${this.currentFormat === f.id ? 'is-active' : ''}" data-format="${f.id}">
                    <span>${f.label}</span>
                    <span class="raw-format-badge">${f.badge}</span>
                  </button>
                `
                  )
                  .join('')}
              </div>
            </div>

            <div class="raw-card">
              <span class="raw-card-title">Configuración de Audio</span>
              <div class="form-group">
                <label for="sel-audio-resolution">Resolución de Bits:</label>
                <select id="sel-audio-resolution" class="form-control">
                  <option value="original" ${this.resolution === 'original' ? 'selected' : ''}>Conservar Original (Source Bit Depth)</option>
                  <option value="pcm16" ${this.resolution === 'pcm16' ? 'selected' : ''}>16-bit PCM (Compatibilidad Universal / SF2)</option>
                  <option value="pcm24" ${this.resolution === 'pcm24' ? 'selected' : ''}>24-bit PCM (Alta Definición Master)</option>
                </select>
              </div>
              <div class="form-group">
                <label for="sel-audio-samplerate">Frecuencia de Muestreo:</label>
                <select id="sel-audio-samplerate" class="form-control">
                  <option value="original" ${this.sampleRate === 'original' ? 'selected' : ''}>Conservar Original (Source Rate)</option>
                  <option value="44100" ${this.sampleRate === 44100 ? 'selected' : ''}>44.100 Hz (CD Audio Standard)</option>
                  <option value="48000" ${this.sampleRate === 48000 ? 'selected' : ''}>48.000 Hz (Broadcast / Pro Studio)</option>
                  <option value="96000" ${this.sampleRate === 96000 ? 'selected' : ''}>96.000 Hz (Master Wave High-Res)</option>
                </select>
              </div>
              <div class="form-group">
                <label for="sel-audio-norm">Normalización de Pico:</label>
                <select id="sel-audio-norm" class="form-control">
                  <option value="none" ${this.normalization === 'none' ? 'selected' : ''}>Sin Normalizar (Preservar Dinámica Original)</option>
                  <option value="0db" ${this.normalization === '0db' ? 'selected' : ''}>Normalizar a 0 dBFS Peak</option>
                  <option value="minus_0_3db" ${this.normalization === 'minus_0_3db' ? 'selected' : ''}>Normalizar a -0.3 dBFS True-Peak</option>
                </select>
              </div>
              <div class="form-group">
                <label for="sel-audio-layout">Estructura de Empaquetado:</label>
                <select id="sel-audio-layout" class="form-control">
                  <option value="folder_samples" ${this.layout === 'folder_samples' ? 'selected' : ''}>Carpeta Samples/ + Definición (.zip)</option>
                  <option value="monolithic" ${this.layout === 'monolithic' ? 'selected' : ''}>Monolítico (Directo en formato destino)</option>
                </select>
              </div>
            </div>

            <div class="form-group">
              <label for="input-bank-name">Nombre del Banco / Preset:</label>
              <input id="input-bank-name" type="text" class="form-control" value="${this.bankName.replace(/"/g, '&quot;')}" />
              <div class="raw-meta-grid">
                <div class="form-group">
                  <label for="input-author">Autor:</label>
                  <input id="input-author" type="text" class="form-control" value="${this.author.replace(/"/g, '&quot;')}" />
                </div>
                <div class="form-group">
                  <label for="input-license">Licencia:</label>
                  <input id="input-license" type="text" class="form-control" value="${this.license.replace(/"/g, '&quot;')}" />
                </div>
              </div>
            </div>
          </div>

          <div class="raw-preflight">
            <div class="triage-summary">
              <span>${ICONS.database}</span>
              <div>
                <p><strong>${meta.title}</strong></p>
                <p>${meta.description}</p>
              </div>
            </div>

            ${renderCommonPreflightGate(gateModel)}
          </div>
        </div>

        <footer class="nmm-modal-footer">
          <div class="footer-left">
            <span class="triage-count">Modo: <strong>${this.context.core.getSession()?.processConfig.workingMode || 'classic'}</strong> | Salida: <strong>${meta.extension}</strong></span>
          </div>
          <div class="footer-right">
            <button type="button" id="btn-cancel-sampler-export" class="btn btn-ghost">${gateModel.adjustLabel}</button>
            <button type="button" id="btn-run-sampler-export" class="btn btn-primary" ${!gateModel.canContinue || this.isExporting ? 'disabled' : ''}>
              ${this.isExporting ? 'Exportando y Empaquetando…' : gateModel.continueLabel}
            </button>
          </div>
        </footer>
      </div>
    `;

    if (!this.focusTrap) {
      this.focusTrap = createModalFocusTrap(this.backdropEl, {
        onEscape: () => {
          if (!this.isExporting) this.close();
        },
      });
      this.focusTrap.activate();
    }

    this.bindEvents();
  }

  private bindEvents(): void {
    if (!this.backdropEl) return;

    // Close buttons
    const btnClose = this.backdropEl.querySelector('#btn-close-sampler-modal');
    btnClose?.addEventListener('click', () => this.close());

    const btnCancel = this.backdropEl.querySelector('#btn-cancel-sampler-export');
    btnCancel?.addEventListener('click', () => this.close());

    // Format buttons
    const formatBtns = this.backdropEl.querySelectorAll<HTMLButtonElement>('.raw-format-btn');
    formatBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const fmt = btn.getAttribute('data-format') as RawSamplerFormat;
        if (fmt && fmt !== this.currentFormat) {
          this.currentFormat = fmt;
          this.updatePreflightReport();
          this.render();
        }
      });
    });

    // Audio selects
    const selRes = this.backdropEl.querySelector<HTMLSelectElement>('#sel-audio-resolution');
    selRes?.addEventListener('change', () => {
      this.resolution = selRes.value as RawAudioResolution;
      this.updatePreflightReport();
      this.render();
    });

    const selRate = this.backdropEl.querySelector<HTMLSelectElement>('#sel-audio-samplerate');
    selRate?.addEventListener('change', () => {
      this.sampleRate = selRate.value === 'original' ? 'original' : (Number(selRate.value) as RawSampleRate);
      this.updatePreflightReport();
      this.render();
    });

    const selNorm = this.backdropEl.querySelector<HTMLSelectElement>('#sel-audio-norm');
    selNorm?.addEventListener('change', () => {
      this.normalization = selNorm.value as RawNormalization;
      this.updatePreflightReport();
      this.render();
    });

    const selLayout = this.backdropEl.querySelector<HTMLSelectElement>('#sel-audio-layout');
    selLayout?.addEventListener('change', () => {
      this.layout = selLayout.value as RawPackagingLayout;
      this.updatePreflightReport();
      this.render();
    });

    // Metadata inputs
    const inputName = this.backdropEl.querySelector<HTMLInputElement>('#input-bank-name');
    inputName?.addEventListener('input', () => {
      this.bankName = inputName.value;
    });

    const inputAuthor = this.backdropEl.querySelector<HTMLInputElement>('#input-author');
    inputAuthor?.addEventListener('input', () => {
      this.author = inputAuthor.value;
    });

    const inputLicense = this.backdropEl.querySelector<HTMLInputElement>('#input-license');
    inputLicense?.addEventListener('input', () => {
      this.license = inputLicense.value;
    });

    // Run Export Button
    const btnExport = this.backdropEl.querySelector<HTMLButtonElement>('#btn-run-sampler-export');
    btnExport?.addEventListener('click', () => void this.handleExport());
  }

  private async handleExport(): Promise<void> {
    if (this.isExporting || !this.currentReport?.canExport) return;

    this.isExporting = true;
    this.render();

    try {
      const opts = this.getCurrentOptions();
      const result = await this.context.core.exportRawSampler(opts);

      // Trigger browser file download
      const rawSlice = result.data.buffer.slice(
        result.data.byteOffset,
        result.data.byteOffset + result.data.byteLength
      ) as ArrayBuffer;
      const blob = new Blob([rawSlice], { type: result.mimeType });
      downloadBlob(blob, result.filename);

      const kbSize = formatKb(result.stats.totalBytes);
      toast(`Exported ${result.filename} (${kbSize} KB) successfully.`, 'success');
      this.context.onExportSuccess?.(result.filename, result.stats.totalBytes);

      this.isExporting = false;
      this.close();
    } catch (err) {
      this.isExporting = false;
      this.render();
      const msg = err instanceof Error ? err.message : String(err);
      toast(`Export failed: ${msg}`, 'error');
    }
  }
}
