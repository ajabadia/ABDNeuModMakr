// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Raw Multi-Format Sampler Export Modal (Fase 16 + Fase 32)
//
// Interactive preflight inspection & simultaneous multi-format raw exporter dialog:
// 1. Nombre del Banco / Preset y Metadatos (Primero)
// 2. Configuración de Audio y Empaquetado (Segundo)
// 3. Formatos de Sampler Destino — 35 formatos con exportación simple o simultánea (Tercero)
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
import { getAppLocale, onAppLocaleChange } from '../core/i18n.ts';
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
  onBack?: () => void;
}

export const ALL_EXPORTABLE_SAMPLER_FORMATS: Array<{
  id: RawSamplerFormat;
  label: string;
  badge: string;
}> = [
  { id: 'sf2', label: 'SoundFont 2 (.sf2)', badge: 'RIFF sfbk' },
  { id: 'sfz', label: 'SFZ Format (.sfz)', badge: 'Open Text' },
  { id: 'dspreset', label: 'Decent Sampler (.dspreset)', badge: 'XML + UI' },
  { id: 'nki', label: 'Kontakt (.nki XML)', badge: 'NI Multisample' },
  { id: 'mpc_xpm', label: 'Akai MPC Program (.xpm)', badge: 'Keygroup/Drum' },
  { id: 'mpc_xpn', label: 'Akai MPC Expansion (.xpn)', badge: 'MPC Pack' },
  { id: 'akai_akp', label: 'Akai S5000/S6000/Z4/Z8 (.akp)', badge: 'RIFF APRG' },
  { id: 'ableton_adv', label: 'Ableton Sampler (.adv)', badge: 'Live GZIP' },
  { id: 'exs24', label: 'Apple Logic EXS24 (.exs)', badge: 'SOBT Binary' },
  { id: 'vstpreset', label: 'Steinberg HALion (.vstpreset)', badge: 'Steinberg' },
  { id: 'multisample', label: 'Bitwig Studio (.multisample)', badge: 'DAW Package' },
  { id: 'tal_sampler', label: 'TAL-Sampler (.talsmpl)', badge: '4-Layer XML' },
  { id: 'tx16wx', label: 'CWITEC TX16Wx (.txprog)', badge: 'TX 3.0 XML' },
  { id: 'directwave', label: 'FL Studio DirectWave (.dwp)', badge: 'Image-Line' },
  { id: 'reason_nnxt', label: 'Reason NN-XT (.sxt)', badge: 'IFF PTCH' },
  { id: 'renoise', label: 'Renoise Instrument (.xrni)', badge: 'Tracker XML' },
  { id: 'bliss', label: 'discoDSP Bliss (.zbp)', badge: 'ZIP Bank' },
  { id: 'soundbox', label: 'Audiomodern Soundbox (.sbpack)', badge: '4-Layer XML' },
  { id: 'omnisphere', label: 'Spectrasonics Omnisphere (.zmap)', badge: 'ZMAP XML' },
  { id: 'ni_maschine', label: 'NI Maschine (.mxsnd.zip)', badge: 'Sound XML' },
  { id: 'korg_kmp', label: 'Korg Trinity/Triton (.KMP)', badge: 'KMP + KSF' },
  { id: 'korg_modern', label: 'Korg Wavestate/Modwave (.korgmultisample)', badge: 'Korg Modern' },
  { id: 'zencore', label: 'Roland ZEN-Core (.svz.zip)', badge: 'Fantom/Jupiter' },
  { id: 'waldorf_qpat', label: 'Waldorf Quantum/Iridium (.qpat)', badge: 'Waldorf Layer' },
  { id: 'prophet_x', label: 'Sequential Prophet X (.grp.zip)', badge: '8Dio Add-On' },
  { id: 'third_wave', label: 'Groove Synthesis 3rd Wave (.3wv)', badge: 'Wave Program' },
  { id: 'music1010', label: '1010music Blackbox/Tangerine (.xml)', badge: 'BBOX XML' },
  { id: 'deluge', label: 'Synthstrom Deluge (.XML)', badge: 'SOUND Kit' },
  { id: 'polyend_pti', label: 'Polyend Tracker (.pti)', badge: 'Monolithic PTI' },
  { id: 'opxy', label: 'Teenage Engineering OP-XY (.preset)', badge: 'JSON Preset' },
  { id: 'tonverk', label: 'Elektron Tonverk (.tvpst)', badge: 'Multi-Map' },
  { id: 'isla_s2400', label: 'Isla Instruments S2400 (.kit)', badge: 'S2400 Kit' },
  { id: 'disting_ex', label: 'Expert Sleepers Disting EX (.dexpreset)', badge: 'DEXBPRST' },
  { id: 'dls', label: 'MMA Downloadable Sounds (.dls)', badge: 'RIFF DLS2' },
  { id: 'sample_chain', label: 'Linear Sample Chain (.wav)', badge: 'Cue Markers' },
];

export class RawSamplerExportModal {
  private backdropEl: HTMLElement | null = null;
  private context: RawSamplerExportModalContext;
  private focusTrap: FocusTrap | null = null;

  private currentFormat: RawSamplerFormat = 'sf2';
  private selectedFormats: Set<RawSamplerFormat> = new Set(['sf2']);
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
    onAppLocaleChange(() => {
      if (this.backdropEl) {
        this.render();
      }
    });
  }

  public open(initialFormat?: RawSamplerFormat): void {
    if (initialFormat) {
      this.currentFormat = initialFormat;
      this.selectedFormats = new Set([initialFormat]);
    } else if (this.selectedFormats.size === 0) {
      this.selectedFormats = new Set([this.currentFormat]);
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

  private getCurrentOptions(formatOverride?: RawSamplerFormat): RawExportOptions {
    return {
      format: formatOverride ?? this.currentFormat,
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
    const isEs = getAppLocale() === 'es';
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

    const selectedCount = Math.max(1, this.selectedFormats.size);
    const continueBtnLabel =
      selectedCount > 1
        ? (isEs ? `Exportar ${selectedCount} Formatos Simultáneamente` : `Export ${selectedCount} Formats Simultaneously`)
        : gateModel.continueLabel;

    this.backdropEl.innerHTML = `
      <div class="nmm-modal-window nmm-modal-xl" role="dialog" aria-modal="true" aria-label="${isEs ? 'Exportar banco a formato sampler' : 'Export bank to sampler format'}">
        <div class="nmm-modal-header">
          <div class="nmm-modal-header-title">
            <span class="modal-icon">${ICONS.database}</span>
            <div>
              <h2>${isEs ? 'Exportador Universal Multi-Formato de Samplers' : 'Universal Raw Multi-Format Sampler Exporter'}</h2>
              <p class="nmm-header-sub">${isEs ? `1. Identidad del Banco · 2. Configuración de Audio · 3. Selección Simple o Multi-Formato (${ALL_EXPORTABLE_SAMPLER_FORMATS.length} formatos)` : `1. Bank Identity · 2. Audio Configuration · 3. Single or Multi-Format Selection (${ALL_EXPORTABLE_SAMPLER_FORMATS.length} formats)`}</p>
            </div>
          </div>
          <button type="button" class="btn btn-close-modal" id="btn-close-sampler-modal" title="${isEs ? 'Cerrar (Esc)' : 'Close (Esc)'}" aria-label="${isEs ? 'Cerrar' : 'Close'}">${ICONS.close}</button>
        </div>

        <div class="raw-export-body">
          <div class="raw-settings">
            <!-- 1. NOMBRE Y METADATOS (PRIMERO) -->
            <div class="raw-card">
              <span class="raw-card-title">${isEs ? '1. Nombre del Instrumento y Metadatos' : '1. Instrument Name &amp; Metadata'}</span>
              <div class="form-group">
                <label for="input-bank-name">${isEs ? 'Nombre del Banco / Preset:' : 'Bank / Preset Name:'}</label>
                <input id="input-bank-name" type="text" class="form-control" value="${this.bankName.replace(/"/g, '&quot;')}" />
              </div>
              <div class="raw-meta-grid">
                <div class="form-group">
                  <label for="input-author">${isEs ? 'Autor:' : 'Author:'}</label>
                  <input id="input-author" type="text" class="form-control" value="${this.author.replace(/"/g, '&quot;')}" />
                </div>
                <div class="form-group">
                  <label for="input-license">${isEs ? 'Licencia:' : 'License:'}</label>
                  <input id="input-license" type="text" class="form-control" value="${this.license.replace(/"/g, '&quot;')}" />
                </div>
              </div>
            </div>

            <!-- 2. CONFIGURACIÓN DE AUDIO Y EMPAQUETADO (SEGUNDO) -->
            <div class="raw-card">
              <span class="raw-card-title">${isEs ? '2. Configuración de Audio y Empaquetado' : '2. Audio &amp; Packaging Configuration'}</span>
              <div class="form-group">
                <label for="sel-audio-resolution">${isEs ? 'Resolución de Bits:' : 'Bit Resolution:'}</label>
                <select id="sel-audio-resolution" class="form-control">
                  <option value="original" ${this.resolution === 'original' ? 'selected' : ''}>${isEs ? 'Conservar Original (Source Bit Depth)' : 'Keep Original (Source Bit Depth)'}</option>
                  <option value="pcm16" ${this.resolution === 'pcm16' ? 'selected' : ''}>${isEs ? '16-bit PCM (Compatibilidad Universal / SF2)' : '16-bit PCM (Universal Compatibility / SF2)'}</option>
                  <option value="pcm24" ${this.resolution === 'pcm24' ? 'selected' : ''}>${isEs ? '24-bit PCM (Alta Definición Master)' : '24-bit PCM (High-Definition Master)'}</option>
                </select>
              </div>
              <div class="form-group">
                <label for="sel-audio-samplerate">${isEs ? 'Frecuencia de Muestreo:' : 'Sample Rate:'}</label>
                <select id="sel-audio-samplerate" class="form-control">
                  <option value="original" ${this.sampleRate === 'original' ? 'selected' : ''}>${isEs ? 'Conservar Original (Source Rate)' : 'Keep Original (Source Rate)'}</option>
                  <option value="44100" ${this.sampleRate === 44100 ? 'selected' : ''}>44.100 Hz (CD Audio Standard)</option>
                  <option value="48000" ${this.sampleRate === 48000 ? 'selected' : ''}>48.000 Hz (Broadcast / Pro Studio)</option>
                  <option value="96000" ${this.sampleRate === 96000 ? 'selected' : ''}>96.000 Hz (Master Wave High-Res)</option>
                </select>
              </div>
              <div class="form-group">
                <label for="sel-audio-norm">${isEs ? 'Normalización de Pico:' : 'Peak Normalization:'}</label>
                <select id="sel-audio-norm" class="form-control">
                  <option value="none" ${this.normalization === 'none' ? 'selected' : ''}>${isEs ? 'Sin Normalizar (Preservar Dinámica Original)' : 'No Normalization (Preserve Original Dynamics)'}</option>
                  <option value="0db" ${this.normalization === '0db' ? 'selected' : ''}>${isEs ? 'Normalizar a 0 dBFS Peak' : 'Normalize to 0 dBFS Peak'}</option>
                  <option value="minus_0_3db" ${this.normalization === 'minus_0_3db' ? 'selected' : ''}>${isEs ? 'Normalizar a -0.3 dBFS True-Peak' : 'Normalize to -0.3 dBFS True-Peak'}</option>
                </select>
              </div>
              <div class="form-group">
                <label for="sel-audio-layout">${isEs ? 'Estructura de Empaquetado:' : 'Packaging Layout:'}</label>
                <select id="sel-audio-layout" class="form-control">
                  <option value="folder_samples" ${this.layout === 'folder_samples' ? 'selected' : ''}>${isEs ? 'Carpeta Samples/ + Definición (.zip)' : 'Samples/ Folder + Definition (.zip)'}</option>
                  <option value="monolithic" ${this.layout === 'monolithic' ? 'selected' : ''}>${isEs ? 'Monolítico (Directo en formato destino)' : 'Monolithic (Direct target format)'}</option>
                </select>
              </div>
            </div>

            <!-- 3. FORMATOS DE SAMPLER DESTINO (AL FINAL, CON SELECCIÓN MÚLTIPLE) -->
            <div class="form-group">
              <div class="u-flex-between" style="margin-bottom: 6px; gap: 8px; flex-wrap: wrap;">
                <label style="margin: 0;">${isEs ? `3. Formatos de Sampler Destino (${selectedCount} seleccionado${selectedCount === 1 ? '' : 's'})` : `3. Target Sampler Formats (${selectedCount} selected)`}</label>
                <div class="u-flex-row u-gap-1">
                  <button type="button" class="btn btn-xs btn-ghost" id="btn-raw-select-all" title="${isEs ? 'Marcar todos los formatos para exportación simultánea' : 'Check all formats for simultaneous export'}">${isEs ? `Todos (${ALL_EXPORTABLE_SAMPLER_FORMATS.length})` : `All (${ALL_EXPORTABLE_SAMPLER_FORMATS.length})`}</button>
                  <button type="button" class="btn btn-xs btn-ghost" id="btn-raw-select-single" title="${isEs ? 'Dejar seleccionado únicamente el formato inspeccionado' : 'Select only the currently inspected format'}">${isEs ? 'Solo activo' : 'Active only'}</button>
                </div>
              </div>
              <div class="raw-format-list" style="max-height: 260px; overflow-y: auto; padding-right: 4px;">
                ${ALL_EXPORTABLE_SAMPLER_FORMATS.map((f) => {
                  const isChecked = this.selectedFormats.has(f.id);
                  const isActive = this.currentFormat === f.id;
                  return `
                  <div class="raw-format-btn ${isActive ? 'is-active' : ''}" data-format="${f.id}" role="button" tabindex="0">
                    <span class="u-flex-row u-gap-2" style="align-items: center;">
                      <input type="checkbox" class="raw-format-check" data-check-format="${f.id}" ${isChecked ? 'checked' : ''} aria-label="${isEs ? `Incluir ${f.label} en exportación múltiple` : `Include ${f.label} in multi-export`}" />
                      <span>${f.label}</span>
                    </span>
                    <span class="raw-format-badge">${f.badge}</span>
                  </div>
                `;
                }).join('')}
              </div>
            </div>
          </div>

          <div class="raw-preflight">
            <div class="triage-summary">
              <span>${ICONS.database}</span>
              <div>
                <p><strong>${meta.title}</strong> ${selectedCount > 1 ? `<span class="badge badge-info">${isEs ? `+${selectedCount - 1} formato(s) más en cola` : `+${selectedCount - 1} more format(s) queued`}</span>` : ''}</p>
                <p>${meta.description}</p>
              </div>
            </div>

            ${renderCommonPreflightGate(gateModel)}
          </div>
        </div>

        <footer class="nmm-modal-footer">
          <div class="footer-left">
            <span class="triage-count">${isEs ? 'Modo:' : 'Mode:'} <strong>${this.context.core.getSession()?.processConfig.workingMode || 'classic'}</strong> | ${isEs ? 'Salida:' : 'Output:'} <strong>${selectedCount > 1 ? (isEs ? `${selectedCount} formatos simultáneos` : `${selectedCount} simultaneous formats`) : meta.extension}</strong></span>
          </div>
          <div class="footer-right">
            <button type="button" id="btn-cancel-sampler-export" class="btn btn-ghost" title="${isEs ? 'Volver al selector de destinos de exportación' : 'Back to export destination selector'}">${this.context.onBack ? (isEs ? '← Volver a Exportar Instrumento' : '← Back to Export Instrument') : gateModel.adjustLabel}</button>
            <button type="button" id="btn-run-sampler-export" class="btn btn-primary" ${!gateModel.canContinue || this.isExporting ? 'disabled' : ''}>
              ${this.isExporting ? (isEs ? 'Exportando y Empaquetando…' : 'Exporting &amp; Packaging…') : continueBtnLabel}
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

    // Close button (X)
    const btnClose = this.backdropEl.querySelector('#btn-close-sampler-modal');
    btnClose?.addEventListener('click', () => this.close());

    // Back / Adjust button -> returns to ExportDestinationModal when available
    const btnCancel = this.backdropEl.querySelector('#btn-cancel-sampler-export');
    btnCancel?.addEventListener('click', () => {
      this.close();
      this.context.onBack?.();
    });

    // Multi-format Select All / Only Active buttons
    const btnSelectAll = this.backdropEl.querySelector('#btn-raw-select-all');
    btnSelectAll?.addEventListener('click', () => {
      this.selectedFormats = new Set(ALL_EXPORTABLE_SAMPLER_FORMATS.map((f) => f.id));
      this.render();
    });

    const btnSelectSingle = this.backdropEl.querySelector('#btn-raw-select-single');
    btnSelectSingle?.addEventListener('click', () => {
      this.selectedFormats = new Set([this.currentFormat]);
      this.render();
    });

    // Individual checkboxes for multi-format selection
    const formatChecks = this.backdropEl.querySelectorAll<HTMLInputElement>('.raw-format-check');
    formatChecks.forEach((chk) => {
      chk.addEventListener('click', (e) => {
        e.stopPropagation();
        const fmt = chk.getAttribute('data-check-format') as RawSamplerFormat;
        if (!fmt) return;
        if (chk.checked) {
          this.selectedFormats.add(fmt);
          this.currentFormat = fmt;
        } else {
          if (this.selectedFormats.size > 1) {
            this.selectedFormats.delete(fmt);
            if (this.currentFormat === fmt) {
              const firstRemaining = Array.from(this.selectedFormats)[0];
              if (firstRemaining) this.currentFormat = firstRemaining;
            }
          } else {
            chk.checked = true;
          }
        }
        this.updatePreflightReport();
        this.render();
      });
    });

    // Format rows (clicking row inspects format and selects it; Ctrl/Shift/Checkbox toggles multi-select)
    const formatBtns = this.backdropEl.querySelectorAll<HTMLElement>('.raw-format-btn');
    formatBtns.forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        const fmt = btn.getAttribute('data-format') as RawSamplerFormat;
        if (!fmt) return;
        const mouseEv = ev as MouseEvent;
        if (mouseEv.ctrlKey || mouseEv.metaKey || mouseEv.shiftKey) {
          if (this.selectedFormats.has(fmt) && this.selectedFormats.size > 1) {
            this.selectedFormats.delete(fmt);
          } else {
            this.selectedFormats.add(fmt);
          }
        } else if (!this.selectedFormats.has(fmt)) {
          if (this.selectedFormats.size <= 1) {
            this.selectedFormats = new Set([fmt]);
          } else {
            this.selectedFormats.add(fmt);
          }
        }
        this.currentFormat = fmt;
        this.updatePreflightReport();
        this.render();
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

    const targets =
      this.selectedFormats.size > 0
        ? Array.from(this.selectedFormats)
        : [this.currentFormat];

    this.isExporting = true;
    this.render();

    try {
      const exportedFiles: string[] = [];
      let totalBytesAll = 0;

      for (const fmt of targets) {
        const opts = this.getCurrentOptions(fmt);
        const result = await this.context.core.exportRawSampler(opts);

        const rawSlice = result.data.buffer.slice(
          result.data.byteOffset,
          result.data.byteOffset + result.data.byteLength
        ) as ArrayBuffer;
        const blob = new Blob([rawSlice], { type: result.mimeType });
        downloadBlob(blob, result.filename);

        exportedFiles.push(result.filename);
        totalBytesAll += result.stats.totalBytes;
        this.context.onExportSuccess?.(result.filename, result.stats.totalBytes);
      }

      const kbSize = formatKb(totalBytesAll);
      if (exportedFiles.length === 1) {
        toast(`Exportado ${exportedFiles[0]} (${kbSize} KB) correctamente.`, 'success');
      } else {
        toast(
          `Exportados ${exportedFiles.length} formatos simultáneamente (${kbSize} KB totales): ${exportedFiles.join(', ')}`,
          'success'
        );
      }

      this.isExporting = false;
      this.close();
    } catch (err) {
      this.isExporting = false;
      this.render();
      const msg = err instanceof Error ? err.message : String(err);
      toast(`Error al exportar: ${msg}`, 'error');
    }
  }
}
