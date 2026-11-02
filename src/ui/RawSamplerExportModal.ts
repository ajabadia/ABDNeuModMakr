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
// Zero-emojis policy: strictly monochrome SVGs and design tokens.
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
import { ICONS } from './icons.ts';
import { toast } from './notify.ts';
import { downloadBlob } from './download.ts';
import { formatKb } from '../core/pathUtils.ts';

export interface RawSamplerExportModalContext {
  core: CoreService;
  onExportSuccess?: (filename: string, totalBytes: number) => void;
}

export class RawSamplerExportModal {
  private backdropEl: HTMLElement | null = null;
  private context: RawSamplerExportModalContext;

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

  public open(): void {
    const session = this.context.core.getSession();
    this.bankName = session?.processConfig.expandedName || session?.processConfig.modelName || 'SamplerBank';
    this.author = session?.processConfig.extendedMetadata?.author || 'ABDNeuModMakr User';
    this.license = session?.processConfig.extendedMetadata?.license || 'CC-BY 4.0';

    this.updatePreflightReport();
    this.render();
  }

  public close(): void {
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
      this.backdropEl.className = 'nmm-modal-backdrop nmm-sampler-export-backdrop';
      document.body.appendChild(this.backdropEl);

      this.backdropEl.addEventListener('click', (e) => {
        if (e.target === this.backdropEl && !this.isExporting) this.close();
      });
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.backdropEl && !this.isExporting) this.close();
      });
    }

    const report = this.currentReport!;
    const meta = SAMPLER_FORMAT_METADATA[this.currentFormat];

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

    const statusTitle = !report.canExport
      ? 'INCOMPATIBILIDADES BLOQUEANTES DETECTADAS'
      : report.summary.warningCount > 0
        ? `ADAPTACIONES TÉCNICAS REQUERIDAS (${report.summary.warningCount})`
        : 'TODAS LAS ESPECIFICACIONES TÉCNICAS SON COMPATIBLES';

    const statusIcon = !report.canExport ? ICONS.alert : report.summary.warningCount > 0 ? ICONS.alert : ICONS.check;

    this.backdropEl.innerHTML = `
      <div class="nmm-modal-window nmm-sampler-export-window" role="dialog" aria-modal="true" style="width: 920px; max-width: 95vw; max-height: 92vh; display: flex; flex-direction: column;">
        <header class="nmm-modal-header" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 18px; border-bottom: 1px solid var(--border-color, #2a3b4c); background: var(--header-bg, #15222e);">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="display: flex; align-items: center; color: var(--accent-color, #00d2ff);">${ICONS.database}</span>
            <div>
              <h2 style="font-size: 15px; margin: 0; font-weight: 700; color: var(--text-bright, #fff); letter-spacing: 0.5px;">Universal Raw Multi-Format Sampler Exporter</h2>
              <p style="font-size: 11px; margin: 0; color: var(--text-muted, #7c90a2);">Exportación de muestras y zonas originales sin transformación Scape/Sphere (Fase 16)</p>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="nmm-badge" style="background: rgba(0,210,255,0.15); color: var(--accent-color, #00d2ff); font-size: 10px; padding: 2px 8px; border-radius: 4px; border: 1px solid rgba(0,210,255,0.3); font-weight: 600;">RAW 01_SOURCE</span>
            <button class="nmm-modal-close-btn" id="btn-close-sampler-modal" style="background: transparent; border: none; color: var(--text-muted, #7c90a2); cursor: pointer; padding: 4px;" title="Close (Esc)">${ICONS.close}</button>
          </div>
        </header>

        <div class="nmm-modal-body" style="padding: 16px 20px; overflow-y: auto; flex: 1; display: grid; grid-template-columns: 340px 1fr; gap: 20px;">
          <!-- Left Column: Settings -->
          <div style="display: flex; flex-direction: column; gap: 14px; border-right: 1px solid var(--border-subtle, #1e2d3b); padding-right: 18px;">
            <!-- Format Selection -->
            <div>
              <label style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-muted, #7c90a2); display: block; margin-bottom: 6px;">
                Formato de Sampler Destino
              </label>
              <div style="display: flex; flex-direction: column; gap: 5px;">
                ${formats
                  .map(
                    (f) => `
                  <button class="nmm-format-btn ${this.currentFormat === f.id ? 'active' : ''}" data-format="${f.id}" style="display: flex; justify-content: space-between; align-items: center; padding: 7px 10px; border-radius: 4px; border: 1px solid ${this.currentFormat === f.id ? 'var(--accent-color, #00d2ff)' : 'var(--border-color, #2a3b4c)'}; background: ${this.currentFormat === f.id ? 'rgba(0,210,255,0.12)' : 'var(--input-bg, #121c24)'}; color: ${this.currentFormat === f.id ? 'var(--text-bright, #fff)' : 'var(--text-normal, #cbd5e1)'}; cursor: pointer; text-align: left; font-size: 12px; font-weight: ${this.currentFormat === f.id ? '600' : '400'}; transition: all 0.15s ease;">
                    <span>${f.label}</span>
                    <span style="font-size: 9px; opacity: 0.7; font-family: monospace;">${f.badge}</span>
                  </button>
                `
                  )
                  .join('')}
              </div>
            </div>

            <!-- Audio Options -->
            <div style="background: rgba(0,0,0,0.15); padding: 12px; border-radius: 6px; border: 1px solid var(--border-subtle, #1e2d3b); display: flex; flex-direction: column; gap: 10px;">
              <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-muted, #7c90a2);">Configuración de Audio</span>
              
              <div>
                <label style="font-size: 11px; color: var(--text-normal, #cbd5e1); display: block; margin-bottom: 4px;">Resolución de Bits:</label>
                <select id="sel-audio-resolution" style="width: 100%; padding: 6px 8px; border-radius: 4px; border: 1px solid var(--border-color, #2a3b4c); background: var(--input-bg, #121c24); color: var(--text-bright, #fff); font-size: 12px;">
                  <option value="original" ${this.resolution === 'original' ? 'selected' : ''}>Conservar Original (Source Bit Depth)</option>
                  <option value="pcm16" ${this.resolution === 'pcm16' ? 'selected' : ''}>16-bit PCM (Compatibilidad Universal / SF2)</option>
                  <option value="pcm24" ${this.resolution === 'pcm24' ? 'selected' : ''}>24-bit PCM (Alta Definición Master)</option>
                </select>
              </div>

              <div>
                <label style="font-size: 11px; color: var(--text-normal, #cbd5e1); display: block; margin-bottom: 4px;">Frecuencia de Muestreo:</label>
                <select id="sel-audio-samplerate" style="width: 100%; padding: 6px 8px; border-radius: 4px; border: 1px solid var(--border-color, #2a3b4c); background: var(--input-bg, #121c24); color: var(--text-bright, #fff); font-size: 12px;">
                  <option value="original" ${this.sampleRate === 'original' ? 'selected' : ''}>Conservar Original (Source Rate)</option>
                  <option value="44100" ${this.sampleRate === 44100 ? 'selected' : ''}>44.100 Hz (CD Audio Standard)</option>
                  <option value="48000" ${this.sampleRate === 48000 ? 'selected' : ''}>48.000 Hz (Broadcast / Pro Studio)</option>
                  <option value="96000" ${this.sampleRate === 96000 ? 'selected' : ''}>96.000 Hz (Master Wave High-Res)</option>
                </select>
              </div>

              <div>
                <label style="font-size: 11px; color: var(--text-normal, #cbd5e1); display: block; margin-bottom: 4px;">Normalización de Pico:</label>
                <select id="sel-audio-norm" style="width: 100%; padding: 6px 8px; border-radius: 4px; border: 1px solid var(--border-color, #2a3b4c); background: var(--input-bg, #121c24); color: var(--text-bright, #fff); font-size: 12px;">
                  <option value="none" ${this.normalization === 'none' ? 'selected' : ''}>Sin Normalizar (Preservar Dinámica Original)</option>
                  <option value="0db" ${this.normalization === '0db' ? 'selected' : ''}>Normalizar a 0 dBFS Peak</option>
                  <option value="minus_0_3db" ${this.normalization === 'minus_0_3db' ? 'selected' : ''}>Normalizar a -0.3 dBFS True-Peak</option>
                </select>
              </div>

              <div>
                <label style="font-size: 11px; color: var(--text-normal, #cbd5e1); display: block; margin-bottom: 4px;">Estructura de Empaquetado:</label>
                <select id="sel-audio-layout" style="width: 100%; padding: 6px 8px; border-radius: 4px; border: 1px solid var(--border-color, #2a3b4c); background: var(--input-bg, #121c24); color: var(--text-bright, #fff); font-size: 12px;">
                  <option value="folder_samples" ${this.layout === 'folder_samples' ? 'selected' : ''}>Carpeta Samples/ + Definición (.zip)</option>
                  <option value="monolithic" ${this.layout === 'monolithic' ? 'selected' : ''}>Monolítico (Directo en formato destino)</option>
                </select>
              </div>
            </div>

            <!-- Metadata Inputs -->
            <div style="display: flex; flex-direction: column; gap: 8px;">
              <div>
                <label style="font-size: 11px; color: var(--text-muted, #7c90a2); display: block; margin-bottom: 2px;">Nombre del Banco / Preset:</label>
                <input id="input-bank-name" type="text" value="${this.bankName}" style="width: 100%; padding: 5px 8px; border-radius: 4px; border: 1px solid var(--border-color, #2a3b4c); background: var(--input-bg, #121c24); color: var(--text-bright, #fff); font-size: 12px;" />
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                <div>
                  <label style="font-size: 10px; color: var(--text-muted, #7c90a2); display: block; margin-bottom: 2px;">Autor:</label>
                  <input id="input-author" type="text" value="${this.author}" style="width: 100%; padding: 4px 6px; border-radius: 4px; border: 1px solid var(--border-color, #2a3b4c); background: var(--input-bg, #121c24); color: var(--text-bright, #fff); font-size: 11px;" />
                </div>
                <div>
                  <label style="font-size: 10px; color: var(--text-muted, #7c90a2); display: block; margin-bottom: 2px;">Licencia:</label>
                  <input id="input-license" type="text" value="${this.license}" style="width: 100%; padding: 4px 6px; border-radius: 4px; border: 1px solid var(--border-color, #2a3b4c); background: var(--input-bg, #121c24); color: var(--text-bright, #fff); font-size: 11px;" />
                </div>
              </div>
            </div>
          </div>

          <!-- Right Column: Preflight Inspection & Status -->
          <div style="display: flex; flex-direction: column; gap: 14px;">
            <!-- Format Description Banner -->
            <div style="background: rgba(0,210,255,0.06); border: 1px solid rgba(0,210,255,0.25); border-radius: 6px; padding: 10px 14px;">
              <div style="font-size: 13px; font-weight: 700; color: var(--text-bright, #fff); margin-bottom: 2px;">${meta.title}</div>
              <p style="font-size: 11px; margin: 0; color: var(--text-normal, #cbd5e1); line-height: 1.4;">${meta.description}</p>
            </div>

            <!-- Preflight Inspection Header Card -->
            <div style="border-radius: 6px; padding: 12px 16px; border: 1px solid ${!report.canExport ? 'rgba(239,68,68,0.4)' : report.summary.warningCount > 0 ? 'rgba(245,158,11,0.4)' : 'rgba(16,185,129,0.4)'}; background: ${!report.canExport ? 'rgba(239,68,68,0.08)' : report.summary.warningCount > 0 ? 'rgba(245,158,11,0.08)' : 'rgba(16,185,129,0.08)'};">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="color: ${!report.canExport ? '#ef4444' : report.summary.warningCount > 0 ? '#f59e0b' : '#10b981'};">${statusIcon}</span>
                  <span style="font-size: 12px; font-weight: 700; letter-spacing: 0.5px; color: ${!report.canExport ? '#ef4444' : report.summary.warningCount > 0 ? '#f59e0b' : '#10b981'};">${statusTitle}</span>
                </div>
                <span style="font-size: 11px; font-family: monospace; color: var(--text-muted, #7c90a2);">
                  ${report.totalRegions} Regiones | ${report.totalSamples} Muestras
                </span>
              </div>
              <p style="font-size: 11px; margin: 0; color: var(--text-normal, #cbd5e1); line-height: 1.4;">
                ${!report.canExport
                  ? 'No se puede exportar el banco en el estado actual. Revise las incidencias críticas listadas a continuación.'
                  : report.summary.warningCount > 0
                    ? 'Se han detectado parámetros que superan los límites del formato de destino. Puede cancelar para ajustar manualmente en la sesión o continuar con las adaptaciones automáticas calculadas.'
                    : 'Todas las regiones, bit depths, frecuencias de muestreo, bucles y curvas de envolvente son 100% compatibles con el formato seleccionado.'}
              </p>
            </div>

            <!-- Preflight Issues List -->
            <div style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; max-height: 380px; padding-right: 4px;">
              <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-muted, #7c90a2);">
                Detalle de Inspección Preflight (${report.issues.length} Items Analizados)
              </span>

              ${report.issues.length === 0
                ? `
                <div style="text-align: center; padding: 30px 20px; color: var(--text-muted, #7c90a2); font-size: 12px;">
                  No hay advertencias ni incompatibilidades técnicas reportadas para esta configuración.
                </div>
              `
                : report.issues
                    .map((iss) => {
                      const sevColor =
                        iss.severity === 'incompatibility'
                          ? '#ef4444'
                          : iss.severity === 'warning'
                            ? '#f59e0b'
                            : '#00d2ff';
                      const sevBg =
                        iss.severity === 'incompatibility'
                          ? 'rgba(239,68,68,0.12)'
                          : iss.severity === 'warning'
                            ? 'rgba(245,158,11,0.12)'
                            : 'rgba(0,210,255,0.12)';
                      return `
                  <div style="background: var(--card-bg, #172430); border: 1px solid var(--border-subtle, #223242); border-left: 3px solid ${sevColor}; border-radius: 4px; padding: 10px 12px; display: flex; flex-direction: column; gap: 5px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                      <span style="font-size: 12px; font-weight: 700; color: var(--text-bright, #fff);">${iss.title}</span>
                      <div style="display: flex; gap: 6px; align-items: center;">
                        <span style="font-size: 9px; font-family: monospace; text-transform: uppercase; padding: 2px 6px; border-radius: 3px; background: rgba(255,255,255,0.06); color: var(--text-muted, #7c90a2);">${iss.category}</span>
                        <span style="font-size: 9px; font-family: monospace; font-weight: 700; text-transform: uppercase; padding: 2px 6px; border-radius: 3px; background: ${sevBg}; color: ${sevColor};">${iss.severity}</span>
                      </div>
                    </div>
                    <p style="font-size: 11px; margin: 0; color: var(--text-normal, #cbd5e1); line-height: 1.35;">${iss.description}</p>
                    <div style="margin-top: 4px; background: rgba(0,0,0,0.25); border-radius: 3px; padding: 5px 8px; font-size: 11px; color: var(--accent-color, #00d2ff); display: flex; align-items: flex-start; gap: 6px;">
                      <span style="font-weight: 600;">Adaptación:</span>
                      <span style="color: var(--text-bright, #fff);">${iss.adaptation}</span>
                    </div>
                  </div>
                `;
                    })
                    .join('')}
            </div>
          </div>
        </div>

        <footer class="nmm-modal-footer" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 20px; border-top: 1px solid var(--border-color, #2a3b4c); background: var(--header-bg, #15222e);">
          <div style="font-size: 11px; color: var(--text-muted, #7c90a2); font-family: monospace;">
            Modo: <strong style="color: var(--text-bright, #fff);">${this.context.core.getSession()?.processConfig.workingMode || 'classic'}</strong> | Salida: <strong style="color: var(--accent-color, #00d2ff);">${meta.extension}</strong>
          </div>
          <div style="display: flex; gap: 10px;">
            <button id="btn-cancel-sampler-export" class="nmm-btn" style="padding: 7px 16px; border-radius: 4px; border: 1px solid var(--border-color, #2a3b4c); background: transparent; color: var(--text-normal, #cbd5e1); cursor: pointer; font-size: 12px;">
              Cancelar / Volver
            </button>
            <button id="btn-run-sampler-export" class="nmm-btn nmm-btn-primary" ${!report.canExport || this.isExporting ? 'disabled' : ''} style="padding: 7px 20px; border-radius: 4px; border: 1px solid var(--accent-color, #00d2ff); background: var(--accent-color, #00d2ff); color: #000; font-weight: 700; cursor: ${!report.canExport || this.isExporting ? 'not-allowed' : 'pointer'}; opacity: ${!report.canExport || this.isExporting ? '0.5' : '1'}; font-size: 12px; display: flex; align-items: center; gap: 6px;">
              ${this.isExporting ? 'Exportando y Empaquetando...' : `Aceptar y Exportar ${meta.title}`}
            </button>
          </div>
        </footer>
      </div>
    `;

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
    const formatBtns = this.backdropEl.querySelectorAll<HTMLButtonElement>('.nmm-format-btn');
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
