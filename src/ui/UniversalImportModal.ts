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

import type { WorkingMode, Zone, ExtendedRegion } from '../core/types.ts';
import {
  listZipSamplerPrograms,
  parseUniversalSampler,
  type ParsedSamplerPreset,
} from '../core/import/rawSamplerParsers.ts';
import { MultiInstrumentModal } from './MultiInstrumentModal.ts';
import {
  analyzeImportPreflight,
  applyPreflightImportAdaptations,
  type ImportPreflightReport,
} from '../core/import/importPreflight.ts';
import { escHtml } from './escape.ts';
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

    const currentMode = this.context.getCurrentWorkingMode();

    this.backdropEl.innerHTML = `
      <div class="nmm-modal-window universal-import-modal-window" role="dialog" aria-modal="true" aria-labelledby="universal-import-title">
        <header class="nmm-modal-header">
          <div class="nmm-modal-header-title">
            <span class="nmm-modal-header-icon">${ICONS.folder}</span>
            <h2 id="universal-import-title">Universal Smart Import</h2>
            <span class="panel-badge badge-ai-on">FASE 18.8 — MULTI-FORMAT RAW &amp; PREFLIGHT</span>
          </div>
          <button type="button" class="nmm-modal-close" id="btn-uimport-close" aria-label="Close" ${this.isInspecting ? 'disabled' : ''}>
            ${ICONS.close}
          </button>
        </header>

        <div class="nmm-modal-body universal-import-modal-body">
          ${
            this.isInspecting
              ? `
            <div class="uimport-inspecting-state">
              <div class="neural-pulse-spinner">${ICONS.spinner}</div>
              <h3>Analyzing Bank &amp; Running Preflight Inspection...</h3>
              <p>Scanning zone descriptors, velocity ranges, keybed coverage, and embedded audio buffers.</p>
            </div>
          `
              : this.preflightReport && this.parsedPreset
                ? this.renderPreflightView(this.preflightReport, this.parsedPreset, currentMode)
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
            ${this.preflightReport ? 'Choose Another File' : 'Cancel'}
          </button>
          ${
            this.preflightReport && (this.preflightReport.canImport || (this.preflightReport.isSliceChain && this.context.onOpenInAudioChopper))
              ? `
            ${
              this.preflightReport.isSliceChain && this.context.onOpenInAudioChopper
                ? `
              <button type="button" class="btn btn-secondary" id="btn-uimport-chopper">
                ${ICONS.wave} Open in Audio Chopper
              </button>
            `
                : ''
            }
            ${
              this.preflightReport.canImport
                ? `
              <button type="button" class="btn btn-primary" id="btn-uimport-proceed">
                ${ICONS.check} Proceed &amp; Import Bank
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
    return `
      <div class="uimport-dropzone-container">
        <div class="uimport-dropzone" id="uimport-dropzone" tabindex="0">
          <div class="dropzone-icon">${ICONS.folder}</div>
          <h3 class="dropzone-title">Drag &amp; Drop Audio, Bank or Slice Files Here</h3>
          <p class="dropzone-sub">
            Supported formats: <strong>.sf2, .sfz, .dspreset, .nki, .vstpreset, .multisample, .adv, .exs, .talsmpl, .txprog, .kmp, .ksf, .dls, .xpm, .xty, .xtd, .xpn, .iso, .img, .dsk, .out, .hda, .efe, .ede, .rx2, .rex, .rcy, .cue, .wav, .aif, .flac, .mp3, .ogg, .m4a, .opus, .caf, .ncw, .zip</strong>
          </p>
          <div class="dropzone-actions">
            <label class="btn btn-primary btn-browse-files">
              ${ICONS.folder} Browse File...
              <input type="file" id="uimport-file-input" class="is-hidden-file" accept=".wav,.aif,.aiff,.aifc,.flac,.mp3,.ogg,.oga,.m4a,.aac,.opus,.webm,.caf,.ncw,.sf2,.sfz,.nki,.vstpreset,.dspreset,.multisample,.adv,.exs,.talsmpl,.txprog,.kmp,.ksf,.dls,.xpm,.xty,.xtd,.xpn,.iso,.img,.dsk,.out,.hda,.efe,.ede,.rx2,.rex,.rcy,.cue,.zip" multiple />
            </label>
          </div>
        </div>

        <div class="uimport-supported-formats-strip">
          <div class="fmt-chip"><strong>Multisample Banks &amp; Disks:</strong> Akai S-Series, E-mu (Emulator III / EOS E4), Roland S-7xx, Ensoniq (EPS/ASR), Yamaha (A-Series/YSFC) (.iso/.img/.dsk/.out/.hda/.efe), SoundFont 2, SFZ, Decent Sampler, Ableton .adv, Logic .exs, TAL .talsmpl, TX16Wx .txprog, Korg .KMP/.KSF, DLS, Kontakt XML, HALion, Bitwig, Akai MPC</div>
          <div class="fmt-chip"><strong>Loops &amp; Slices:</strong> ReCycle (REX/RX2), CUE Sheets, Octatrack/SP-404 Sample Chains</div>
          <div class="fmt-chip"><strong>Raw Audio:</strong> WAV, AIFF/AIFC, FLAC, MP3, OGG, M4A/AAC, Opus, CAF, NCW (auto-mapped to zones or chopper)</div>
        </div>
      </div>
    `;
  }

  private renderPreflightView(
    report: ImportPreflightReport,
    preset: ParsedSamplerPreset,
    currentMode: WorkingMode
  ): string {
    return `
      <div class="uimport-preflight-layout">
        <!-- Preset Header Summary Card -->
        <div class="uimport-summary-card">
          <div class="uimport-summary-meta">
            <span class="uimport-fmt-badge">${escHtml(report.formatLabel)}</span>
            <h3 class="uimport-preset-title">${escHtml(report.presetName)}</h3>
            <span class="uimport-model-slug">Target Model: <code>${escHtml(preset.modelName)}</code></span>
          </div>
          <div class="uimport-metrics-strip">
            <div class="metric-pill">
              <span class="metric-num">${report.totalRegions}</span>
              <span class="metric-label">Zones</span>
            </div>
            <div class="metric-pill">
              <span class="metric-num">${report.keyRange.minKey}–${report.keyRange.maxKey}</span>
              <span class="metric-label">Key Range</span>
            </div>
            <div class="metric-pill">
              <span class="metric-num">${report.maxVelocityLayers}</span>
              <span class="metric-label">Vel Layers</span>
            </div>
            <div class="metric-pill">
              <span class="metric-num">${report.totalAudioFiles}</span>
              <span class="metric-label">Samples</span>
            </div>
            <div class="metric-pill">
              <span class="metric-num">Set #${preset.suggestedParameterSet}</span>
              <span class="metric-label">${escHtml(preset.detectedCategory)}</span>
            </div>
          </div>
        </div>

        <!-- Incompatibilities & Diagnostic Warnings -->
        <div class="uimport-issues-section">
          <h4 class="section-title">Preflight Incompatibility Inspection</h4>
          ${
            report.issues.length === 0
              ? `
            <div class="issue-item issue-ok">
              <span class="issue-icon">${ICONS.check}</span>
              <div class="issue-body">
                <strong>100% Session Compatible</strong>
                <p>All zone definitions, velocity splits, key ranges, and audio samples are valid with zero incompatibilities.</p>
              </div>
            </div>
          `
              : report.issues
                  .map(
                    (issue) => `
            <div class="issue-item issue-${issue.severity}">
              <span class="issue-icon">${issue.severity === 'error' ? ICONS.alert : issue.severity === 'warning' ? ICONS.alert : ICONS.wave}</span>
              <div class="issue-body">
                <div class="issue-header">
                  <strong>${escHtml(issue.title)}</strong>
                  <span class="issue-cat-badge">${escHtml(issue.category.toUpperCase())}</span>
                </div>
                <p class="issue-desc">${escHtml(issue.description)}</p>
                <div class="issue-res"><em>Suggested Resolution:</em> ${escHtml(issue.resolutionText)}</div>
              </div>
            </div>
          `
                  )
                  .join('')
          }
        </div>

        <!-- Interactive Adaptation Options -->
        <div class="uimport-options-card">
          <h4 class="section-title">Import &amp; Incompatibility Adaptations</h4>
          <div class="uimport-checkbox-list">
            <label class="uimport-checkbox-row">
              <input type="checkbox" id="chk-auto-extend" ${this.optAutoExtend ? 'checked' : ''} />
              <div class="chk-label">
                <strong>Auto-extend outer zones to 0 and 127</strong>
                <span>Stretches note boundaries of the lowest and highest zones to prevent gaps in Hartmann resynthesis.</span>
              </div>
            </label>

            <label class="uimport-checkbox-row">
              <input type="checkbox" id="chk-adapt-vel" ${this.optAdaptVelocity ? 'checked' : ''} />
              <div class="chk-label">
                <strong>Adapt velocity layers to Classic 2-layer model (Low 1..63, High 64..127)</strong>
                <span>Folds multi-velocity layers into softest and loudest samples with automated velocity gain compensation.</span>
              </div>
            </label>

            <label class="uimport-checkbox-row">
              <input type="checkbox" id="chk-switch-ext" ${this.optSwitchToExtended || currentMode === 'extended' ? 'checked' : ''} />
              <div class="chk-label">
                <strong>Switch session to Extended Mode (Preserve all ${report.maxVelocityLayers} velocity layers)</strong>
                <span>Enables 2D velocity regions, unlimited dynamic layers, and extended time capsule metadata.</span>
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

    // Drag and Drop
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
        if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
          this.handleFileSelection(e.dataTransfer.files[0], e.dataTransfer.files);
        }
      });
      dropzone.addEventListener('click', () => {
        fileInput?.click();
      });
    }

    // Checkbox state tracking
    const chkExtend = this.backdropEl.querySelector<HTMLInputElement>('#chk-auto-extend');
    chkExtend?.addEventListener('change', () => {
      this.optAutoExtend = chkExtend.checked;
    });

    const chkVel = this.backdropEl.querySelector<HTMLInputElement>('#chk-adapt-vel');
    chkVel?.addEventListener('change', () => {
      this.optAdaptVelocity = chkVel.checked;
    });

    const chkExt = this.backdropEl.querySelector<HTMLInputElement>('#chk-switch-ext');
    chkExt?.addEventListener('change', () => {
      this.optSwitchToExtended = chkExt.checked;
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
    // Fase 31 + 32.4: a program file (.xpm/.xty/.xtd/.adv/.exs/.talsmpl/.txprog/.kmp) dropped together with its WAVs/.KSFs is the primary file
    const primaryProgFile = Array.from(allFiles).find((f) =>
      /\.(xpm|xty|xtd|adv|exs|talsmpl|txprog|kmp)$/i.test(f.name)
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
        preset = await parseUniversalSampler(filename, buffer, siblings);
      } else {
        if (/\.(zip|xpn|iso|img|dsk)$/i.test(filename)) {
          const programs = await listZipSamplerPrograms(filename, buffer);
          if (programs.length > 1) {
            this.isInspecting = false;
            this.render();
            const multiModal = new MultiInstrumentModal();
            const isAkai = /\.(iso|img|dsk)$/i.test(filename);
            multiModal.open({
              fileName: filename,
              format: isAkai ? 'disk' : filename.toLowerCase().endsWith('.xpn') ? 'mpc' : 'zip',
              items: programs.map((p) => ({
                id: p.id,
                index: p.index,
                name: p.name,
                regionCount: p.regionCount,
                detail: p.detail,
              })),
              onSelect: (chosen) => {
                void (async () => {
                  try {
                    this.isInspecting = true;
                    this.render();
                    const selectedPreset = await parseUniversalSampler(
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
                this.context.onOpenBatchProcessor?.();
              },
            });
            return;
          }
        }
        preset = await parseUniversalSampler(filename, buffer, decodedWavBuffer);
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
