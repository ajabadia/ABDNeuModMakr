// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Universal Smart Import Modal (Fase 18.8)
//
// Unified entry point for importing:
//   - Audio Files: .wav, .aif, .aiff, .flac
//   - Multisample Banks: SoundFont 2 (.sf2), SFZ (.sfz),
//     Decent Sampler (.dspreset), Native Instruments Kontakt (.nki),
//     Steinberg HALion (.vstpreset), Bitwig Studio (.multisample), and .zip packs
//   - Slices & Loops: ReCycle (.rx2, .rex, .rcy), CUE Sheets, and Linear Sample Chains
//
// Features an interactive Preflight Window for Incompatibilities
// with live adaptation options before injecting into session.
// ─────────────────────────────────────────────────────────

import { getAppLocale, onAppLocaleChange } from '../core/i18n.ts';
import type { WorkingMode, Zone, ExtendedRegion } from '../core/types.ts';
import {
  listZipSamplerProgramsCapped,
  parseUniversalSamplerCapped,
  type ParsedSamplerPreset,
} from '../core/import/rawSamplerParsers.ts';
import {
  isNeuronBankOrModelInput,
  listNeuronBankModels,
  parseNeuronBankOrModelToPreset,
} from '../core/import/neuronBankImporter.ts';
import { MultiInstrumentModal } from './MultiInstrumentModal.ts';
import {
  analyzeImportPreflight,
  applyPreflightImportAdaptations,
  type ImportPreflightReport,
} from '../core/import/importPreflight.ts';
import { escHtml } from './escape.ts';
import {
  MUSICIAN_TERMS,
  fromImportPreflightReport,
  renderCommonPreflightGate,
} from './preflightGateView.ts';
import { ICONS } from './icons.ts';
import { createModalFocusTrap, type FocusTrap } from './modalFocusTrap.ts';
import { toast } from './notify.ts';
import { bridgeClient } from '../core/bridge/BridgeClient.ts';
import { inspectKontaktFile } from '../formats/KontaktParser.ts';

export interface UniversalImportModalContext {
  getCurrentWorkingMode: () => WorkingMode;
  onInjectBank: (data: {
    presetName: string;
    modelName: string;
    category: string;
    parameterSet: number;
    classicZones: Zone[];
    extendedRegions: ExtendedRegion[];
    workingMode: WorkingMode;
    audioBuffers: Map<string, ArrayBuffer>;
  }) => void;
  onOpenInAudioChopper?: (audioBuffer: ArrayBuffer, filename: string, sliceFrames?: number[]) => void;
  onImportRawAudioFiles?: (files: FileList | File[]) => void;
  onBrowseFolder?: () => void;
  onDropDirectoryHandle?: (dirHandle: FileSystemDirectoryHandle) => void;
  onImportFolderFileList?: (files: FileList) => void;
  onOpenBatchProcessorWithFiles?: (files: Array<{ name: string; buffer: ArrayBuffer }>, originTitle?: string) => void;
  onOpenBatchProcessor?: () => void;
}

export class UniversalImportModal {
  private readonly context: UniversalImportModalContext;
  private backdropEl: HTMLElement | null = null;
  private focusTrap: FocusTrap | null = null;

  private isInspecting = false;
  private inspectionError: string | null = null;
  private parsedPreset: ParsedSamplerPreset | null = null;
  private preflightReport: ImportPreflightReport | null = null;
  private rawFileBuffer: ArrayBuffer | null = null;
  private rawFilename = '';

  // Preflight user choice checkboxes
  private optAutoExtend = true;
  private optAdaptVelocity = true;
  private optSwitchToExtended = false;

  constructor(context: UniversalImportModalContext) {
    this.context = context;
    onAppLocaleChange(() => {
      if (this.backdropEl) {
        this.render();
      }
    });
  }

  public open(): void {
    this.resetState();
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
    this.resetState();
  }

  public isOpen(): boolean {
    return Boolean(this.backdropEl);
  }

  private resetState(): void {
    this.isInspecting = false;
    this.inspectionError = null;
    this.parsedPreset = null;
    this.preflightReport = null;
    this.rawFileBuffer = null;
    this.rawFilename = '';
    this.optAutoExtend = true;
    this.optAdaptVelocity = true;
    this.optSwitchToExtended = false;
  }

  private render(): void {
    if (!this.backdropEl) {
      this.backdropEl = document.createElement('div');
      this.backdropEl.className = 'nmm-modal-backdrop universal-import-modal-backdrop';
      document.body.appendChild(this.backdropEl);

      this.backdropEl.addEventListener('click', (e) => {
        if (e.target === this.backdropEl && !this.isInspecting) this.close();
      });
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.backdropEl && !this.isInspecting) this.close();
      });
    }

    const isEs = getAppLocale() === 'es';
    const currentMode = this.context.getCurrentWorkingMode();
    const activeGateModel =
      this.preflightReport && this.parsedPreset
        ? fromImportPreflightReport(this.preflightReport, this.parsedPreset, currentMode, {
            autoExtendOuterZones: this.optAutoExtend,
            adaptVelocityLayers: this.optAdaptVelocity,
            switchToExtendedMode: this.optSwitchToExtended,
          })
        : null;

    this.backdropEl.innerHTML = `
      <div class="nmm-modal-window universal-import-modal-window" role="dialog" aria-modal="true" aria-labelledby="universal-import-title">
        <header class="nmm-modal-header">
          <div class="nmm-modal-header-title">
            <span class="nmm-modal-header-icon">${ICONS.folder}</span>
            <h2 id="universal-import-title">${isEs ? 'Importación Universal Inteligente' : 'Universal Smart Import'}</h2>
            <span class="panel-badge badge-ai-on">${escHtml(MUSICIAN_TERMS.preflightImport)}</span>
          </div>
          <button type="button" class="nmm-modal-close" id="btn-uimport-close" aria-label="${isEs ? 'Cerrar' : 'Close'}" ${this.isInspecting ? 'disabled' : ''}>
            ${ICONS.close}
          </button>
        </header>

        <div class="nmm-modal-body nmm-modal-scroll-body">
          ${
            this.isInspecting
              ? `
            <div class="uimport-inspecting-state">
              <div class="neural-pulse-spinner">${ICONS.spinner}</div>
              <h3>${escHtml(MUSICIAN_TERMS.preflightImport)}…</h3>
              <p>${isEs ? 'Analizando descriptores de zonas, capas de velocidad, cobertura de teclado y muestras de audio.' : 'Analyzing zone descriptors, velocity layers, keybed coverage, and audio samples.'}</p>
            </div>
          `
              : this.preflightReport && this.parsedPreset && activeGateModel
                ? this.renderPreflightView(this.preflightReport, this.parsedPreset, currentMode, activeGateModel)
                : this.renderDropZoneView()
          }

          ${
            this.inspectionError
              ? `
            <div class="uimport-error-banner">
              <span class="error-icon">${ICONS.alert}</span>
              <div class="error-msg">${escHtml(this.inspectionError)}</div>
            </div>
          `
              : ''
          }
        </div>

        <footer class="nmm-modal-footer">
          <div class="footer-right">
          <button type="button" class="btn btn-outline" id="btn-uimport-cancel" ${this.isInspecting ? 'disabled' : ''}>
            ${activeGateModel ? escHtml(activeGateModel.adjustLabel) : isEs ? 'Cancelar' : 'Cancel'}
          </button>
          ${
            this.preflightReport && (this.preflightReport.canImport || (this.preflightReport.isSliceChain && this.context.onOpenInAudioChopper))
              ? `
            ${
              this.preflightReport.isSliceChain && this.context.onOpenInAudioChopper
                ? `
              <button type="button" class="btn btn-secondary" id="btn-uimport-chopper">
                ${ICONS.wave} ${isEs ? 'Abrir en Audio Chopper' : 'Open in Audio Chopper'}
              </button>
            `
                : ''
            }
            ${
              this.preflightReport.canImport && activeGateModel
                ? `
              <button type="button" class="btn btn-primary" id="btn-uimport-proceed">
                ${ICONS.check} ${escHtml(activeGateModel.continueLabel)}
              </button>
            `
                : ''
            }
          `
              : ''
          }
          </div>
        </footer>
      </div>
    `;

    if (!this.focusTrap && this.backdropEl) {
      this.focusTrap = createModalFocusTrap(this.backdropEl, {
        onEscape: () => {
          if (!this.isInspecting) this.close();
        },
        initialFocusSelector: this.preflightReport ? '#btn-uimport-proceed' : '#uimport-file-input',
      });
      this.focusTrap.activate();
    }

    this.bindEvents();
  }

  private renderDropZoneView(): string {
    const isEs = getAppLocale() === 'es';
    return `
      <div class="uimport-dropzone-container">
        <div class="uimport-dropzone" id="uimport-dropzone" tabindex="0">
          <div class="dropzone-icon">${ICONS.folder}</div>
          <h3 class="dropzone-title">${isEs ? 'Arrastra y suelta audio, bancos, cortes o carpetas aquí' : 'Drag & Drop Audio, Bank, Slice Files or Folders Here'}</h3>
          <p class="dropzone-sub">
            ${isEs ? 'Formatos admitidos: <strong>Carpetas completas (.model / librerías / audio)</strong> y archivos' : 'Supported formats: <strong>Full folders (.model / libraries / audio)</strong> and files'} <strong>.model, .neuronikmodel, .nmmodel, .scape, .sphere, .sf2, .sfz, .dspreset, .nki, .vstpreset, .fxp, .multisample, .adv, .exs, .talsmpl, .txprog, .kmp, .ksf, .dls, .akp, .pgm, .set, .exb, .e4b, .esi, .xpm, .xty, .xtd, .xpn, .iso, .img, .dsk, .out, .hda, .efe, .ede, .rx2, .rex, .rcy, .cue, .wav, .aif, .flac, .mp3, .ogg, .m4a, .opus, .caf, .ncw, .zip</strong>
          </p>
          <div class="dropzone-actions">
            <label class="btn btn-primary btn-browse-files" id="lbl-uimport-browse-files">
              ${ICONS.folder} ${isEs ? 'Examinar Archivo...' : 'Browse File...'}
              <input type="file" id="uimport-file-input" class="is-hidden-file" accept=".model,.neuronikmodel,.nmmodel,.scape,.sphere,.nmpack,.script,.wav,.aif,.aiff,.aifc,.flac,.mp3,.ogg,.oga,.m4a,.aac,.opus,.webm,.caf,.ncw,.sf2,.sfz,.nki,.vstpreset,.fxp,.dspreset,.multisample,.adv,.exs,.talsmpl,.txprog,.kmp,.ksf,.dls,.akp,.pgm,.set,.exb,.e4b,.esi,.krz,.k25,.k26,.x7u,.x8u,.x3a,.fzv,.fzf,.s3p,.sxt,.dwp,.xpm,.xty,.xtd,.xpn,.iso,.img,.dsk,.out,.hda,.efe,.ede,.rx2,.rex,.rcy,.cue,.zip" multiple />
            </label>
            <button type="button" class="btn btn-secondary btn-browse-folder" id="btn-uimport-browse-folder">
              ${ICONS.folder} ${isEs ? 'Examinar Carpeta...' : 'Browse Folder...'}
            </button>
            <input type="file" id="uimport-folder-input" class="is-hidden-file" webkitdirectory directory multiple />
          </div>
        </div>

        <div class="uimport-supported-formats-strip">
          <div class="fmt-chip"><strong>${isEs ? 'Bancos Multimuestra y Discos:' : 'Multisample Banks & Disks:'}</strong> Hartmann Neuron / Neuronik (.model / .neuronikmodel / .nmmodel / .scape / .sphere / NeuronDB .zip), Akai S1000/S3000 &amp; S5000/S6000/Z4/Z8 (.akp/.iso), E-mu (Emulator III / EOS E4 .e4b / Emulator X .exb), Roland (S-7xx / S-5xx / Zen-Core .svz), Ensoniq (EPS/ASR), Yamaha (A-Series / YSFC .x7u/.x8u/.x3a), SoundFont 2, SFZ, Decent Sampler, Ableton .adv, Logic .exs, TAL .talsmpl, TX16Wx .txprog, Korg .KMP/.KSF, DLS, Kontakt XML, HALion (.vstpreset/.fxp), Bitwig, Akai MPC</div>
          <div class="fmt-chip"><strong>${isEs ? 'Bucles y Cortes:' : 'Loops & Slices:'}</strong> ReCycle (REX/RX2), CUE Sheets, Octatrack/SP-404 Sample Chains</div>
          <div class="fmt-chip"><strong>${isEs ? 'Audio Crudo:' : 'Raw Audio:'}</strong> WAV, AIFF/AIFC, FLAC, MP3, OGG, M4A/AAC, Opus, CAF, NCW (${isEs ? 'auto-mapeado a zonas o chopper' : 'auto-mapped to zones or chopper'})</div>
        </div>
      </div>
    `;
  }

  private renderPreflightView(
    report: ImportPreflightReport,
    preset: ParsedSamplerPreset,
    currentMode: WorkingMode,
    gateModel = fromImportPreflightReport(report, preset, currentMode, {
      autoExtendOuterZones: this.optAutoExtend,
      adaptVelocityLayers: this.optAdaptVelocity,
      switchToExtendedMode: this.optSwitchToExtended,
    })
  ): string {
    const isEs = getAppLocale() === 'es';
    return `
      <div class="uimport-preflight-layout">
        <!-- Preset Header Summary Card -->
        <div class="uimport-summary-card">
          <div class="uimport-summary-meta">
            <span class="nmm-status-pill is-accent">${escHtml(report.formatLabel)}</span>
            <h3 class="uimport-preset-title">${escHtml(report.presetName)}</h3>
            <span class="uimport-model-slug">${isEs ? 'Modelo Destino:' : 'Target Model:'} <code>${escHtml(preset.modelName)}</code></span>
          </div>
          <div class="nmm-metric-strip">
            <div class="nmm-metric-card">
              <span class="nmm-metric-val is-mono">${report.totalRegions}</span>
              <span class="nmm-metric-lbl">${isEs ? 'Zonas' : 'Zones'}</span>
            </div>
            <div class="nmm-metric-card">
              <span class="nmm-metric-val is-mono">${report.keyRange.minKey}–${report.keyRange.maxKey}</span>
              <span class="nmm-metric-lbl">${isEs ? 'Rango Teclas' : 'Key Range'}</span>
            </div>
            <div class="nmm-metric-card">
              <span class="nmm-metric-val is-mono">${report.maxVelocityLayers}</span>
              <span class="nmm-metric-lbl">${isEs ? 'Capas Vel.' : 'Vel Layers'}</span>
            </div>
            <div class="nmm-metric-card">
              <span class="nmm-metric-val is-mono">${report.totalAudioFiles}</span>
              <span class="nmm-metric-lbl">${isEs ? 'Muestras' : 'Samples'}</span>
            </div>
            <div class="nmm-metric-card">
              <span class="nmm-metric-val is-mono">Set #${preset.suggestedParameterSet}</span>
              <span class="nmm-metric-lbl">${escHtml(preset.detectedCategory)}</span>
            </div>
          </div>
        </div>

        <!-- Unified Common Preflight Gate (Fase 35.3) -->
        ${renderCommonPreflightGate(gateModel)}

        <!-- Interactive Adaptation Options -->
        <div class="uimport-options-card">
          <h4 class="section-title">${isEs ? 'Ajustes de adaptación al importar' : 'Import adaptation settings'}</h4>
          <div class="uimport-checkbox-list">
            <label class="uimport-checkbox-row">
              <input type="checkbox" id="chk-auto-extend" ${this.optAutoExtend ? 'checked' : ''} />
              <div class="chk-label">
                <strong>${isEs ? 'Extender automáticamente las zonas extremas hasta MIDI 0 y 127' : 'Automatically extend outer zones to MIDI 0 and 127'}</strong>
                <span>${isEs ? 'Estira los límites de la zona más grave y más aguda para cubrir todo el teclado sin huecos en la resíntesis.' : 'Stretches lowest and highest zone boundaries to cover the full keyboard without gaps during resynthesis.'}</span>
              </div>
            </label>

            <label class="uimport-checkbox-row">
              <input type="checkbox" id="chk-adapt-vel" ${this.optAdaptVelocity ? 'checked' : ''} />
              <div class="chk-label">
                <strong>${isEs ? 'Proyectar capas de velocidad al modelo Classic de 2 capas (Low 1..63, High 64..127)' : 'Project velocity layers to 2-layer Classic model (Low 1..63, High 64..127)'}</strong>
                <span>${isEs ? 'Pliega instrumentos multicapa en las muestras más suave y más fuerte con compensación automática de ganancia.' : 'Folds multi-layer instruments into softest and loudest samples with automatic gain compensation.'}</span>
              </div>
            </label>

            <label class="uimport-checkbox-row">
              <input type="checkbox" id="chk-switch-ext" ${this.optSwitchToExtended || currentMode === 'extended' ? 'checked' : ''} />
              <div class="chk-label">
                <strong>${isEs ? `Cambiar la sesión a Modo Extended (Conservar las ${report.maxVelocityLayers} capas de velocidad)` : `Switch session to Extended Mode (Preserve all ${report.maxVelocityLayers} velocity layers)`}</strong>
                <span>${isEs ? 'Activa regiones 2D ilimitadas, articulación completa y metadatos extendidos de Cápsula del Tiempo.' : 'Enables unlimited 2D regions, full articulation, and extended Time Capsule metadata.'}</span>
              </div>
            </label>
          </div>
        </div>
      </div>
    `;
  }

  private bindEvents(): void {
    if (!this.backdropEl) return;

    // Close buttons
    this.backdropEl.querySelector('#btn-uimport-close')?.addEventListener('click', () => this.close());
    this.backdropEl.querySelector('#btn-uimport-cancel')?.addEventListener('click', () => {
      if (this.preflightReport) {
        this.resetState();
        this.render();
      } else {
        this.close();
      }
    });

    // File input browse
    const fileInput = this.backdropEl.querySelector<HTMLInputElement>('#uimport-file-input');
    fileInput?.addEventListener('change', () => {
      if (fileInput.files && fileInput.files.length > 0) {
        this.handleFileSelection(fileInput.files[0], fileInput.files);
      }
    });

    // Folder input browse
    const folderInput = this.backdropEl.querySelector<HTMLInputElement>('#uimport-folder-input');
    folderInput?.addEventListener('change', () => {
      if (folderInput.files && folderInput.files.length > 0) {
        if (this.context.onImportFolderFileList) {
          const files = folderInput.files;
          this.close();
          this.context.onImportFolderFileList(files);
        } else {
          this.handleFileSelection(folderInput.files[0], folderInput.files);
        }
      }
    });

    const btnBrowseFolder = this.backdropEl.querySelector<HTMLButtonElement>('#btn-uimport-browse-folder');
    btnBrowseFolder?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.context.onBrowseFolder) {
        this.close();
        this.context.onBrowseFolder();
      } else {
        folderInput?.click();
      }
    });

    const lblBrowseFiles = this.backdropEl.querySelector<HTMLElement>('#lbl-uimport-browse-files');
    lblBrowseFiles?.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    // Drag and Drop (Files + Directories)
    const dropzone = this.backdropEl.querySelector<HTMLElement>('#uimport-dropzone');
    if (dropzone) {
      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('is-drag-over');
      });
      dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('is-drag-over');
      });
      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('is-drag-over');
        void (async () => {
          const items = e.dataTransfer?.items;
          if (items && items.length > 0) {
            const firstItem = items[0] as DataTransferItem & {
              getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
              webkitGetAsEntry?: () => { isDirectory?: boolean; isFile?: boolean; fullPath?: string; name?: string; createReader?: () => { readEntries: (cb: (entries: any[]) => void, err?: (e: any) => void) => void } } | null;
            };
            if (typeof firstItem.getAsFileSystemHandle === 'function' && this.context.onDropDirectoryHandle) {
              try {
                const handle = await firstItem.getAsFileSystemHandle();
                if (handle && handle.kind === 'directory') {
                  this.close();
                  this.context.onDropDirectoryHandle(handle as FileSystemDirectoryHandle);
                  return;
                }
              } catch {
                // Fall back to webkitGetAsEntry or files below
              }
            }
            const entry = firstItem.webkitGetAsEntry?.();
            if (entry && entry.isDirectory && this.context.onImportFolderFileList) {
              const collected: File[] = [];
              const readDirEntry = async (dirEntry: any, depth: number): Promise<void> => {
                if (depth > 8 || !dirEntry.createReader) return;
                const reader = dirEntry.createReader();
                const allSubEntries: any[] = [];
                while (true) {
                  const batch = await new Promise<any[]>((resolve) => {
                    reader.readEntries((res: any[]) => resolve(res || []), () => resolve([]));
                  });
                  if (batch.length === 0) break;
                  allSubEntries.push(...batch);
                }
                for (const sub of allSubEntries) {
                  if (sub.isFile) {
                    const f = await new Promise<File | null>((resolve) => {
                      sub.file((fileObj: File) => resolve(fileObj), () => resolve(null));
                    });
                    if (f) {
                      const relPath = String(sub.fullPath || f.name).replace(/^\/+/, '');
                      try {
                        Object.defineProperty(f, 'webkitRelativePath', { value: relPath, configurable: true });
                      } catch {
                        // ignore
                      }
                      collected.push(f);
                    }
                  } else if (sub.isDirectory) {
                    await readDirEntry(sub, depth + 1);
                  }
                }
              };
              await readDirEntry(entry, 0);
              if (collected.length > 0) {
                this.close();
                this.context.onImportFolderFileList(collected as unknown as FileList);
                return;
              }
            }
          }
          if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
            void this.handleFileSelection(e.dataTransfer.files[0], e.dataTransfer.files);
          }
        })();
      });
      dropzone.addEventListener('click', (e) => {
        const target = e.target as HTMLElement | null;
        if (target?.closest('#btn-uimport-browse-folder, #lbl-uimport-browse-files, input')) return;
        fileInput?.click();
      });
    }

    // Checkbox state tracking
    const chkExtend = this.backdropEl.querySelector<HTMLInputElement>('#chk-auto-extend');
    chkExtend?.addEventListener('change', () => {
      this.optAutoExtend = chkExtend.checked;
      this.render();
    });

    const chkVel = this.backdropEl.querySelector<HTMLInputElement>('#chk-adapt-vel');
    chkVel?.addEventListener('change', () => {
      this.optAdaptVelocity = chkVel.checked;
      this.render();
    });

    const chkExt = this.backdropEl.querySelector<HTMLInputElement>('#chk-switch-ext');
    chkExt?.addEventListener('change', () => {
      this.optSwitchToExtended = chkExt.checked;
      this.render();
    });

    // Audio chopper action button
    this.backdropEl.querySelector('#btn-uimport-chopper')?.addEventListener('click', () => {
      if (!this.parsedPreset) return;
      const firstBuf = this.parsedPreset.audioBuffers.values().next().value ?? this.rawFileBuffer;
      const targetName = this.parsedPreset.audioBuffers.size > 0
        ? this.parsedPreset.presetName
        : this.rawFilename;
      if (firstBuf && this.context.onOpenInAudioChopper) {
        this.close();
        this.context.onOpenInAudioChopper(firstBuf, targetName, this.parsedPreset.sliceFrames);
      }
    });

    // Proceed action button
    this.backdropEl.querySelector('#btn-uimport-proceed')?.addEventListener('click', () => {
      this.handleProceed();
    });
  }

  private async handleFileSelection(file: File, allFiles: FileList | File[]): Promise<void> {
    // Fase 31 + 32.4: a program file (.xpm/.xty/.xtd/.adv/.exs/.fxp/.talsmpl/.txprog/.kmp/.akp/.exb/.e4b/.esi/.s3p/.sxt/.dwp) dropped together with its WAVs/.KSFs is the primary file
    const primaryProgFile = Array.from(allFiles).find((f) =>
      /\.(xpm|xty|xtd|adv|exs|fxp|talsmpl|txprog|kmp|akp|exb|e4b|esi|s3p|sxt|dwp|pgm|set)$/i.test(f.name)
    );
    if (primaryProgFile) file = primaryProgFile;
    const filename = file.name;

    // If multiple raw audio files are dropped (.wav, .aif, .flac, .mp3, .ogg, .m4a, .caf, .ncw), offer standard audio batch import
    const isAudioOnly = Array.from(allFiles).every((f) =>
      /\.(wav|aif|aiff|aifc|flac|mp3|ogg|oga|m4a|aac|opus|webm|caf|ncw)$/i.test(f.name)
    );
    if (isAudioOnly && allFiles.length > 1 && this.context.onImportRawAudioFiles) {
      this.close();
      this.context.onImportRawAudioFiles(allFiles);
      return;
    }

    this.isInspecting = true;
    this.inspectionError = null;
    this.render();

    try {
      const buffer = await file.arrayBuffer();
      this.rawFileBuffer = buffer;
      this.rawFilename = filename;

      // Fase 28: early Kontakt DRM preflight — never crash on protected libraries
      if (/\.(nki|nkm|nkx|nksn|nkc|nkr)$/i.test(filename)) {
        const diag = inspectKontaktFile(filename, new Uint8Array(buffer));
        if (!diag.importable) {
          this.isInspecting = false;
          this.inspectionError =
            `${diag.message} Recommended path: ${diag.conversionGuide.join(' ')}`;
          this.render();
          return;
        }
      }
      let decodedWavBuffer: ArrayBuffer | undefined;
      const isRex = /\.(rx2|rex|rcy)$/i.test(filename);
      if (isRex && bridgeClient.isConnected()) {
        try {
          const res = await bridgeClient.decodeRx2Audio(buffer, filename);
          decodedWavBuffer = res.wavBuffer;
        } catch (e) {
          console.warn('Bridge REX2 decode failed:', e);
        }
      }

      // Fase 35.1: Hartmann Neuron / Neuronik bank & model container detection (by signature & extension)
      const allNames = Array.from(allFiles).map((f) => f.name);
      if (isNeuronBankOrModelInput(filename, buffer, allNames)) {
        // Check if any selected file is a multi-model NeuronDB .zip / .nmpack / .model archive
        let zipFileName = filename;
        let zipBuffer = buffer;
        const zipFileCandidate = Array.from(allFiles).find((f) =>
          /\.(zip|nmpack|model)$/i.test(f.name)
        );
        if (zipFileCandidate && zipFileCandidate !== file) {
          zipFileName = zipFileCandidate.name;
          zipBuffer = await zipFileCandidate.arrayBuffer();
        }
        const neuronModels = listNeuronBankModels(zipFileName, zipBuffer);
        if (neuronModels.length > 1) {
          this.isInspecting = false;
          this.render();
          const multiModal = new MultiInstrumentModal();
          multiModal.open({
            fileName: zipFileName,
            format: 'zip',
            items: neuronModels.map((m) => ({
              id: m.id,
              index: m.index,
              name: m.name,
              regionCount: m.regionCount,
              detail: m.detail,
            })),
            onSelect: (chosen) => {
              void (async () => {
                try {
                  this.isInspecting = true;
                  this.render();
                  const selectedPreset = await parseNeuronBankOrModelToPreset(
                    zipFileName,
                    zipBuffer,
                    undefined,
                    chosen.id
                  );
                  const rep = analyzeImportPreflight(selectedPreset, this.context.getCurrentWorkingMode());
                  this.parsedPreset = selectedPreset;
                  this.preflightReport = rep;
                  this.optAutoExtend = rep.defaultActions.autoExtendOuterZones;
                  this.optAdaptVelocity = rep.defaultActions.adaptVelocityLayers;
                  this.optSwitchToExtended = rep.defaultActions.switchToExtendedMode;
                  this.isInspecting = false;
                  this.render();
                } catch (err) {
                  this.isInspecting = false;
                  this.inspectionError = err instanceof Error ? err.message : String(err);
                  this.render();
                }
              })();
            },
            onProcessBatch: () => {
              this.close();
              if (this.context.onOpenBatchProcessorWithFiles) {
                this.context.onOpenBatchProcessorWithFiles([{ name: zipFileName, buffer: zipBuffer }], zipFileName);
              } else {
                this.context.onOpenBatchProcessor?.();
              }
            },
          });
          return;
        }

        const extraEntries: { name: string; data: Uint8Array }[] = [];
        if (allFiles.length > 1) {
          for (const f of Array.from(allFiles)) {
            extraEntries.push({
              name: f.name,
              data: new Uint8Array(await f.arrayBuffer()),
            });
          }
        }
        const neuronPreset = await parseNeuronBankOrModelToPreset(
          filename,
          buffer,
          extraEntries.length > 0 ? extraEntries : undefined
        );
        const neuronReport = analyzeImportPreflight(neuronPreset, this.context.getCurrentWorkingMode());
        this.parsedPreset = neuronPreset;
        this.preflightReport = neuronReport;
        this.optAutoExtend = neuronReport.defaultActions.autoExtendOuterZones;
        this.optAdaptVelocity = neuronReport.defaultActions.adaptVelocityLayers;
        this.optSwitchToExtended = neuronReport.defaultActions.switchToExtendedMode;
        this.isInspecting = false;
        this.render();
        return;
      }

      // Parse universal sampler bank or slice file
      let preset: ParsedSamplerPreset;
      if (primaryProgFile) {
        // Sibling WAVs / KSFs selected alongside the program file are resolved by sample name
        const siblings = new Map<string, Uint8Array>();
        for (const f of Array.from(allFiles)) {
          if (/\.(wav|aif|aiff|aifc|flac|mp3|ogg|oga|m4a|aac|opus|webm|caf|ncw|ksf)$/i.test(f.name)) {
            siblings.set(f.name, new Uint8Array(await f.arrayBuffer()));
          }
        }
        preset = await parseUniversalSamplerCapped(filename, buffer, siblings);
      } else {
        if (/\.(zip|xpn|iso|img|dsk|bin|hda|out|efe|ede|gkh|e4b|esi|exb)$/i.test(filename)) {
          const programs = await listZipSamplerProgramsCapped(filename, buffer);
          if (programs.length > 1) {
            this.isInspecting = false;
            this.render();
            const multiModal = new MultiInstrumentModal();
            const isDisk = /\.(iso|img|dsk|bin|hda|out|efe|ede|gkh|e4b|esi|exb)$/i.test(filename);
            multiModal.open({
              fileName: filename,
              format: isDisk ? 'disk' : filename.toLowerCase().endsWith('.xpn') ? 'mpc' : 'zip',
              items: programs.map((p) => ({
                id: p.id,
                index: p.index,
                name: p.name,
                regionCount: p.regionCount,
                detail: p.detail,
                folderPath: p.entryPath || p.id,
              })),
              onSelect: (chosen) => {
                void (async () => {
                  try {
                    this.isInspecting = true;
                    this.render();
                    const selectedPreset = await parseUniversalSamplerCapped(
                      filename,
                      buffer,
                      undefined,
                      decodedWavBuffer,
                      chosen.id
                    );
                    const rep = analyzeImportPreflight(selectedPreset, this.context.getCurrentWorkingMode());
                    this.parsedPreset = selectedPreset;
                    this.preflightReport = rep;
                    this.optAutoExtend = rep.defaultActions.autoExtendOuterZones;
                    this.optAdaptVelocity = rep.defaultActions.adaptVelocityLayers;
                    this.optSwitchToExtended = rep.defaultActions.switchToExtendedMode;
                    this.isInspecting = false;
                    this.render();
                  } catch (err) {
                    this.isInspecting = false;
                    this.inspectionError = err instanceof Error ? err.message : String(err);
                    this.render();
                  }
                })();
              },
              onProcessBatch: () => {
                this.close();
                if (this.context.onOpenBatchProcessorWithFiles) {
                  this.context.onOpenBatchProcessorWithFiles([{ name: filename, buffer }], filename);
                } else {
                  this.context.onOpenBatchProcessor?.();
                }
              },
            });
            return;
          }
        }
        preset = await parseUniversalSamplerCapped(filename, buffer, decodedWavBuffer);
      }
      const report = analyzeImportPreflight(preset, this.context.getCurrentWorkingMode());

      this.parsedPreset = preset;
      this.preflightReport = report;
      this.optAutoExtend = report.defaultActions.autoExtendOuterZones;
      this.optAdaptVelocity = report.defaultActions.adaptVelocityLayers;
      this.optSwitchToExtended = report.defaultActions.switchToExtendedMode;

      this.isInspecting = false;
      this.render();
    } catch (err) {
      this.isInspecting = false;
      this.inspectionError = err instanceof Error ? err.message : String(err);
      this.render();
    }
  }

  private handleProceed(): void {
    if (!this.parsedPreset || !this.preflightReport) return;

    const adapted = applyPreflightImportAdaptations(this.parsedPreset, {
      autoExtendOuterZones: this.optAutoExtend,
      adaptVelocityLayers: this.optAdaptVelocity,
      switchToExtendedMode: this.optSwitchToExtended,
      currentWorkingMode: this.context.getCurrentWorkingMode(),
    });

    this.context.onInjectBank({
      presetName: this.parsedPreset.presetName,
      modelName: this.parsedPreset.modelName,
      category: this.parsedPreset.detectedCategory,
      parameterSet: this.parsedPreset.suggestedParameterSet,
      classicZones: adapted.classicZones,
      extendedRegions: adapted.extendedRegions,
      workingMode: adapted.suggestedWorkingMode,
      audioBuffers: adapted.audioBuffers,
    });

    toast(
      `Successfully imported ${this.parsedPreset.formatLabel}: "${this.parsedPreset.presetName}" (${adapted.classicZones.length} zones).`,
      'success'
    );

    this.close();
  }
}
