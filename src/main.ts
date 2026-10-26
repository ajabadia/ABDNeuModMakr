// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Application Entry Point
// Assembles UI with WebAudioPipeline and ABDShared design system
// ─────────────────────────────────────────────────────────

import './style.css';
import { WebAudioPipeline } from './core/WebAudioPipeline';
import type { Zone, Session, CoreEvent } from './core/types';
import { AppNavbar } from './ui/Navbar';
import { ZoneRibbon } from './ui/ZoneRibbon';
import { ZoneInspector } from './ui/ZoneInspector';
import { ProcessPanel } from './ui/ProcessPanel';
import { KeyboardStrip } from './ui/KeyboardStrip';
import { ProcessModal } from './ui/ProcessModal';
import { TelemetryDrawer } from './ui/TelemetryDrawer';
import { BankDrawer } from './ui/BankDrawer';
import { SpectralView } from './ui/SpectralView';
import { NeuronDbModal, stickModesToComplexity, type NeuronDbModelEntry } from './ui/NeuronDbModal';
import { parseMName, parseMapScript, parseModelNamesCache } from './formats/ModelFormat';
import { parseZipArchive } from './formats/ZipArchive';

class App {
  private core = new WebAudioPipeline();
  private session: Session | null = null;
  private selectedZoneId: string | null = null;

  // UI Components
  private navbar!: AppNavbar;
  private ribbon!: ZoneRibbon;
  private inspector!: ZoneInspector;
  private spectralView!: SpectralView;
  private processPanel!: ProcessPanel;
  private keyboard!: KeyboardStrip;
  private processModal!: ProcessModal;
  private telemetryDrawer!: TelemetryDrawer;
  private bankDrawer!: BankDrawer;
  private neuronDbModal = new NeuronDbModal();

  // Themes
  private themes = ['ms2000', 'audiolab', 'audiolab-light', 'advanced', 'cz101'];
  private currentThemeIndex = 0;
  private isSpectralVisible = false;

  public async init(): Promise<void> {
    document.documentElement.setAttribute('data-theme', this.themes[this.currentThemeIndex]);

    await this.core.init();
    this.session = this.core.getSession();
    if (!this.session) {
      this.session = await this.core.newSession('Default Session');
    }

    this.selectedZoneId = this.session.zones[0]?.id || null;

    this.buildDom();
    this.initSubsystems();
    this.bindCoreEvents();
    this.refreshUI();
  }

  private buildDom(): void {
    const root = document.querySelector<HTMLDivElement>('#app')!;
    root.innerHTML = `
      <div class="app-shell" id="app-shell">
        <header id="navbar-container"></header>

        <main class="workspace-canvas" id="workspace-canvas">
          <section class="workspace-columns">
            <div class="column-process" id="process-mount"></div>
            <div class="column-left-stack">
              <div class="column-inspector" id="inspector-mount"></div>
              <div class="column-spectral is-collapsed" id="spectral-mount"></div>
            </div>
          </section>

          <section class="zone-ribbon-container" id="ribbon-mount"></section>
          <section class="keyboard-section" id="keyboard-mount"></section>
        </main>

        <div id="drawers-container"></div>
        <div id="modals-container"></div>
      </div>
    `;
  }

  private initSubsystems(): void {
    const navMount = document.querySelector<HTMLElement>('#navbar-container')!;
    const ribbonMount = document.querySelector<HTMLElement>('#ribbon-mount')!;
    const inspectorMount = document.querySelector<HTMLElement>('#inspector-mount')!;
    const spectralMount = document.querySelector<HTMLElement>('#spectral-mount')!;
    const processMount = document.querySelector<HTMLElement>('#process-mount')!;
    const keyboardMount = document.querySelector<HTMLElement>('#keyboard-mount')!;
    const drawersMount = document.querySelector<HTMLElement>('#drawers-container')!;
    const modalsMount = document.querySelector<HTMLElement>('#modals-container')!;

    // 1. Navbar
    this.navbar = new AppNavbar(navMount, {
      onNewSession: async () => {
        this.session = await this.core.newSession('Init Model');
        this.selectedZoneId = this.session.zones[0]?.id || null;
        this.telemetryDrawer.addLog('Created new session: Init Model');
        this.refreshUI();
      },
      onOpenSession: () => this.triggerOpenSession(),
      onSaveSession: async () => {
        if (this.session) {
          await this.core.saveSession(this.session);
          const jsonText = this.core.exportSessionJson();
          const blob = new Blob([jsonText], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          const safeName = this.session.name.replace(/[^A-Za-z0-9_-]/g, '_');
          a.href = url;
          a.download = `${safeName}.nmsession.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          this.telemetryDrawer.addLog(
            `Session "${this.session.name}" saved to localStorage and downloaded as ${safeName}.nmsession.json`
          );
        }
      },
      onImportSamples: () => this.triggerAudioImport('samples'),
      onImportFolder: () => this.triggerFolderImport(),
      onImportByName: () => this.triggerAudioImport('by-name'),
      onImportModelFolder: () => this.triggerModelFolderImport(),
      onImportModel: () => this.triggerModelImport(),
      onExportModel: async () => {
        if (!this.session) return;
        const slot = this.session.processConfig.modelNumber;
        const safeName = this.session.processConfig.modelName.replace(/[^A-Za-z0-9_-]/g, '_');
        await this.core.exportModel(
          slot,
          `NeuronModel_${String(slot).padStart(3, '0')}_${safeName}.zip`
        );
        this.telemetryDrawer.addLog(
          `Exported Dual-Target model package #${String(slot).padStart(3, '0')} (${this.session.processConfig.modelName}) as .zip`
        );
      },
      onExportZoneAiff: () => {
        const active = this.getActiveZone();
        if (!active) return;
        try {
          const { filename, bytes } = this.core.exportZoneAsAiff(active.id);
          this.telemetryDrawer.addLog(
            `Exported canonical 44.1 kHz 16-bit Mono AIFF: ${filename} (${bytes.byteLength} bytes)`
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.telemetryDrawer.addLog(`AIFF export error: ${msg}`);
        }
      },
      onUndo: () => this.performUndo(),
      onRedo: () => this.performRedo(),
      onAddZone: async () => {
        const active = this.getActiveZone();
        const root = active ? active.rootKey : 60;
        const newZ = await this.core.addZone(root);
        this.session = this.core.getSession()!;
        this.selectedZoneId = newZ.id;
        this.telemetryDrawer.addLog(`Added zone splitting at MIDI ${root}`);
        this.refreshUI();
      },
      onRemoveZone: async () => {
        if (this.selectedZoneId && this.session && this.session.zones.length > 1) {
          await this.core.removeZone(this.selectedZoneId);
          this.session = this.core.getSession()!;
          this.selectedZoneId = this.session.zones[0]?.id || null;
          this.telemetryDrawer.addLog('Removed zone. Contiguous boundaries preserved.');
          this.refreshUI();
        }
      },
      onClearZones: () => {
        this.session = this.core.resetZonesToSingle();
        this.selectedZoneId = this.session.zones[0]?.id || null;
        this.telemetryDrawer.addLog('Reset keyboard to full 0..127 single zone.');
        this.refreshUI();
      },
      onAutoRepairCoverage: () => {
        this.session = this.core.autoRepairCoverage();
        this.selectedZoneId = this.session.zones[0]?.id || null;
        this.telemetryDrawer.addLog('Auto-repaired MIDI 0..127 zone coverage and root keys.');
        this.refreshUI();
      },
      onStartProcess: () => this.handleStartProcess(),
      onValidateCoverage: () => {
        const errs = this.core.validateCoverage();
        if (errs.length === 0) {
          this.telemetryDrawer.addLog('Validation OK: Full continuous MIDI 0..127 coverage verified with no gaps.');
        } else {
          this.telemetryDrawer.addLog(`Coverage errors detected (${errs.length}): ${errs.join(' | ')}`);
        }
        this.telemetryDrawer.open();
      },
      onSetTargetFormat: (format) => {
        this.session = this.core.updateProcessConfig({ targetFormat: format });
        this.telemetryDrawer.addLog(`Target output profile set to: ${format}`);
        this.refreshUI();
      },
      onToggleZoneDrawer: () => this.inspector.toggleDrawer(),
      onToggleSpectral: () => this.toggleSpectralPanel(),
      onToggleBank: async () => {
        const bank = await this.core.loadBank();
        this.bankDrawer.setBank(bank);
        this.bankDrawer.toggle();
      },
      onToggleLogs: () => this.telemetryDrawer.toggle(),
      onSelectTheme: (theme) => {
        const idx = this.themes.indexOf(theme);
        if (idx >= 0) {
          this.currentThemeIndex = idx;
        }
        document.documentElement.setAttribute('data-theme', theme);
        this.navbar.setTheme(theme);
        this.spectralView?.refreshTheme();
        this.telemetryDrawer.addLog(`Theme switched to: ${theme}`);
      },
      onToggleTheme: () => {
        this.currentThemeIndex = (this.currentThemeIndex + 1) % this.themes.length;
        const next = this.themes[this.currentThemeIndex];
        document.documentElement.setAttribute('data-theme', next);
        this.navbar.setTheme(next);
        this.spectralView?.refreshTheme();
        this.telemetryDrawer.addLog(`Theme switched to: ${next}`);
      }
    });

    // 2. Zone Ribbon (above Keyboard Strip: 2D Key 0..127 x Velocity 1..127 map)
    this.ribbon = new ZoneRibbon(ribbonMount, {
      onSelectZone: (id) => {
        this.selectedZoneId = id;
        const active = this.getActiveZone();
        this.inspector.setZone(active, this.getActiveZoneIndex(), this.session!.zones.length, this.session!.zones);
        this.keyboard.setActiveZone(active);
        this.updateSpectralView(active);
      },
      onSplitZone: async (_id, key) => {
        const newZ = await this.core.addZone(key);
        this.session = this.core.getSession()!;
        this.selectedZoneId = newZ.id;
        this.refreshUI();
      },
      onUpdateZone: async (zoneId, changes) => {
        await this.core.updateZone(zoneId, changes);
        this.session = this.core.getSession()!;
        this.refreshUI();
      },
      getWaveforms: (zoneId) => this.core.getZoneRibbonWaveforms(zoneId),
      onWaveModeChange: (mode) => {
        if (mode === 'resynthesis' && this.session) {
          for (const z of this.session.zones) {
            try {
              this.core.inspectZoneSpectrum(z.id);
            } catch {
              // ignore
            }
          }
        }
      },
    });

    // 3. Zone Inspector
    this.inspector = new ZoneInspector(inspectorMount, {
      onSelectZone: (zoneId) => {
        this.selectedZoneId = zoneId;
        const active = this.getActiveZone();
        this.ribbon.setActiveZone(zoneId);
        this.inspector.setZone(active, this.getActiveZoneIndex(), this.session!.zones.length, this.session!.zones);
        this.keyboard.setActiveZone(active);
        this.updateSpectralView(active);
      },
      onUpdateZone: async (zoneId, changes) => {
        await this.core.updateZone(zoneId, changes);
        this.session = this.core.getSession()!;
        this.refreshUI();
      },
      onSplitZone: async (_zoneId) => {
        const active = this.getActiveZone();
        if (active) {
          const newZ = await this.core.addZone(active.rootKey);
          this.session = this.core.getSession()!;
          this.selectedZoneId = newZ.id;
          this.refreshUI();
        }
      },
      onDeleteZone: async (zoneId) => {
        await this.core.removeZone(zoneId);
        this.session = this.core.getSession()!;
        this.selectedZoneId = this.session.zones[0]?.id || null;
        this.refreshUI();
      },
      onAuditionSample: (path) => {
        const active = this.getActiveZone();
        this.telemetryDrawer.addLog(`Auditioning audio sample: ${path}`);
        void this.core.auditionSample(path, active?.rootKey ?? 60);
        this.spectralView?.notifyPlaybackStarted();
      },
      onLoadSampleFile: async (zoneId, slot, file) => {
        try {
          const buffer = await file.arrayBuffer();
          const decoded = this.core.registerSampleBuffer(file.name, buffer);
          const targetZone = this.session?.zones.find((z) => z.id === zoneId);
          const effectiveSlot =
            slot === 'high' && targetZone && !targetZone.sampleLow ? 'low' : slot;
          const changes: Partial<Zone> =
            effectiveSlot === 'low'
              ? { sampleLow: file.name }
              : { sampleHigh: file.name };
          if (
            effectiveSlot === 'high' &&
            decoded.instrument &&
            decoded.instrument.lowVelocity >= 2 &&
            decoded.instrument.lowVelocity <= 127
          ) {
            changes.velSplit = decoded.instrument.lowVelocity;
          }
          await this.core.updateZone(zoneId, changes);
          this.session = this.core.getSession()!;
          this.telemetryDrawer.addLog(
            `Loaded ${file.name} into ${effectiveSlot === 'low' ? 'Low Vel' : 'High Vel'} (${decoded.formatTag.toUpperCase()}, ${decoded.sampleRate} Hz, ${decoded.bitsPerSample}-bit, ${decoded.numChannels}ch, ${decoded.durationSec.toFixed(2)}s)`
          );
          this.refreshUI();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.telemetryDrawer.addLog(`Error loading ${file.name}: ${msg}`);
          alert(`Failed to decode audio file "${file.name}":\n${msg}`);
        }
      },
      onDropMultipleFiles: (files) => {
        void this.handleDroppedFiles(files);
      },
      onToggleSpectral: () => this.toggleSpectralPanel(),
      getLoadedSamples: () => this.core.getLoadedSampleNames(),
    });

    // 3b. Spectral & A/B Resynthesis Monitor (Phase 4)
    this.spectralView = new SpectralView(spectralMount, {
      onAuditionZone: (zoneId, mode) => {
        this.telemetryDrawer.addLog(
          `A/B Audition [${mode === 'original' ? 'A: Original' : 'B: Resynthesis'}] on zone ${zoneId}`
        );
        void this.core.auditionZoneComparison(zoneId, mode);
      },
      onStopAudition: () => {
        this.core.stopAudition();
      },
      onKeyboardModeChange: (mode) => {
        this.telemetryDrawer.addLog(
          `Keyboard audition mode switched to ${mode === 'original' ? 'A: Original Sample' : 'B: Neural Resynthesis'}`
        );
      },
      getRealtimeSpectrum: () => this.core.getRealtimeSpectrum()
    });

    // 4. Process Panel
    this.processPanel = new ProcessPanel(
      processMount,
      this.session!.processConfig,
      this.core.getParameterSets(),
      {
        onConfigChange: (cfg) => {
          this.session = this.core.updateProcessConfig(cfg);
          this.navbar.updateSession(this.session, this.core.validateCoverage());
          this.updateSpectralView(this.getActiveZone());
        },
        onStartProcess: () => this.handleStartProcess()
      }
    );

    // 5. Keyboard Strip
    this.keyboard = new KeyboardStrip(keyboardMount, {
      onNotePress: (note) => {
        // Find zone covering this note, select it, and audition at `note` pitch
        const found = this.session?.zones.find((z) => note >= z.lowKey && note <= z.highKey);
        if (found) {
          if (found.id !== this.selectedZoneId) {
            this.selectedZoneId = found.id;
            this.ribbon.setActiveZone(found.id);
            this.inspector.setZone(found, this.getActiveZoneIndex(), this.session!.zones.length, this.session!.zones);
            this.keyboard.setActiveZone(found);
            this.updateSpectralView(found);
          }
          const kbMode = this.spectralView.getKeyboardMode();
          void this.core.auditionZoneComparison(found.id, kbMode, note);
          this.spectralView.notifyPlaybackStarted();
        }
      },
      onNoteRelease: (_note) => {}
    });

    // 6. Drawers & Modals
    this.telemetryDrawer = new TelemetryDrawer(drawersMount, () => {
      this.session = this.core.autoRepairCoverage();
      this.selectedZoneId = this.session.zones[0]?.id || null;
      this.telemetryDrawer.addLog(`Auto-repaired MIDI 0..127 zone coverage.`);
      this.refreshUI();
    });
    this.bankDrawer = new BankDrawer(drawersMount, {
      onSelectModel: (slot) => {
        if (this.session) {
          this.session = this.core.updateProcessConfig({ modelNumber: slot });
          this.processPanel.setConfig(this.session.processConfig);
          this.navbar.updateSession(this.session, this.core.validateCoverage());
        }
      },
      onExportModel: async (slot) => {
        await this.core.exportModel(
          slot,
          `NeuronModel_${String(slot).padStart(3, '0')}.zip`
        );
        this.telemetryDrawer.addLog(`Exported model package #${String(slot).padStart(3, '0')} (.zip)`);
      }
    });

    this.processModal = new ProcessModal(modalsMount, {
      onCancel: () => this.core.cancelProcess(),
      onClose: () => this.navbar.setProcessing(false)
    });

    this.navbar.mount(this.session!, this.core.validateCoverage());
    this.bindKeyboardShortcuts();
    this.bindGlobalDragAndDrop();
  }

  private async handleDroppedFiles(fileList: FileList): Promise<void> {
    if (!fileList || fileList.length === 0) return;
    await this.importMixedFilesOrZip(fileList, 'model', 'samples', 'Drag & Drop');
  }

  private bindGlobalDragAndDrop(): void {
    const shell = document.querySelector<HTMLElement>('#app-shell');
    if (!shell) return;

    shell.addEventListener('dragover', (e) => {
      e.preventDefault();
    });

    shell.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        void this.handleDroppedFiles(e.dataTransfer.files);
      }
    });
  }

  private triggerOpenSession(): void {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,.nmsession.json';
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      try {
        const text = await f.text();
        this.session = await this.core.loadSessionFromJson(text);
        this.selectedZoneId = this.session.zones[0]?.id || null;
        this.telemetryDrawer.addLog(`Loaded session "${this.session.name}" from ${f.name}`);
        this.refreshUI();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.telemetryDrawer.addLog(`Open session error: ${msg}`);
        alert(`Failed to load session JSON:\n${msg}`);
      }
    });
    fileInput.click();
  }

  private triggerFolderImport(): void {
    const win = window as Window & {
      showDirectoryPicker?: (opts?: { mode?: 'read' }) => Promise<FileSystemDirectoryHandle>;
    };
    if (typeof win.showDirectoryPicker === 'function') {
      void (async () => {
        try {
          const dirHandle = await win.showDirectoryPicker!({ mode: 'read' });
          await this.importFromDirectoryHandle(dirHandle, 'audio');
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          const msg = err instanceof Error ? err.message : String(err);
          this.telemetryDrawer.addLog(`Folder import error: ${msg}`);
          alert(`Failed to import audio folder: ${msg}`);
        }
      })();
      return;
    }

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    (fileInput as HTMLInputElement & { webkitdirectory?: boolean }).webkitdirectory = true;
    fileInput.addEventListener('change', async () => {
      const fileList = fileInput.files;
      if (!fileList || fileList.length === 0) return;
      await this.importFromWebkitFileList(fileList, 'audio');
    });
    fileInput.click();
  }

  private triggerModelFolderImport(): void {
    const win = window as Window & {
      showDirectoryPicker?: (opts?: { mode?: 'read' }) => Promise<FileSystemDirectoryHandle>;
    };
    if (typeof win.showDirectoryPicker === 'function') {
      void (async () => {
        try {
          const dirHandle = await win.showDirectoryPicker!({ mode: 'read' });
          await this.importFromDirectoryHandle(dirHandle, 'model');
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          const msg = err instanceof Error ? err.message : String(err);
          this.telemetryDrawer.addLog(`Model folder import error: ${msg}`);
          alert(`Failed to import model folder:\n${msg}`);
        }
      })();
      return;
    }

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    (fileInput as HTMLInputElement & { webkitdirectory?: boolean }).webkitdirectory = true;
    fileInput.addEventListener('change', async () => {
      const fileList = fileInput.files;
      if (!fileList || fileList.length === 0) return;
      await this.importFromWebkitFileList(fileList, 'model');
    });
    fileInput.click();
  }

  private async importFromDirectoryHandle(
    rootHandle: FileSystemDirectoryHandle,
    preferredKind: 'audio' | 'model'
  ): Promise<void> {
    type IterDir = FileSystemDirectoryHandle & {
      values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>;
    };

    const readModelDirFiles = async (
      modelDir: FileSystemDirectoryHandle,
      folderPrefix: string
    ): Promise<{ name: string; buffer: ArrayBuffer }[]> => {
      const out: { name: string; buffer: ArrayBuffer }[] = [];
      for await (const entry of (modelDir as IterDir).values()) {
        if (entry.kind === 'file') {
          if (entry.name.startsWith('.') || entry.name.startsWith('._')) continue;
          const file = await (entry as FileSystemFileHandle).getFile();
          const buffer = await file.arrayBuffer();
          out.push({ name: `${folderPrefix}/${entry.name}`, buffer });
        }
      }
      return out;
    };

    // 1. Check if rootHandle itself is a `<NNN>.model` directory or contains MName / map.script / .scape
    const directFiles: FileSystemFileHandle[] = [];
    const subDirs = new Map<string, FileSystemDirectoryHandle>();
    for await (const entry of (rootHandle as IterDir).values()) {
      if (entry.name.startsWith('.') || entry.name.startsWith('._') || entry.name === '__MACOSX') {
        continue;
      }
      if (entry.kind === 'file') {
        directFiles.push(entry as FileSystemFileHandle);
      } else if (entry.kind === 'directory') {
        subDirs.set(entry.name, entry as FileSystemDirectoryHandle);
      }
    }

    const hasDirectModelFiles = directFiles.some((f) => {
      const lower = f.name.toLowerCase();
      return (
        lower === 'mname' ||
        lower === 'map.script' ||
        lower.endsWith('.scape') ||
        lower.endsWith('.sphere') ||
        lower.endsWith('.nmmodel')
      );
    });

    if (hasDirectModelFiles) {
      const loaded = await readModelDirFiles(rootHandle, rootHandle.name);
      const model = await this.core.importModelFiles(loaded);
      this.session = this.core.getSession()!;
      this.selectedZoneId = this.session.zones[0]?.id || null;
      this.telemetryDrawer.addLog(
        `Imported model folder #${String(model.slot).padStart(3, '0')} "${model.name}" (${model.zoneCount} zone(s))`
      );
      this.refreshUI();
      return;
    }

    // 2. Check if user selected `NeuronDB` or `Models` containing multiple `<NNN>.model` subfolders
    let modelsContainer: FileSystemDirectoryHandle | null = null;
    const modelSubDirs = new Map<number, FileSystemDirectoryHandle>();

    for (const [name, dir] of subDirs.entries()) {
      const m = /^(\d{3})\.model$/i.exec(name);
      if (m) {
        modelSubDirs.set(parseInt(m[1], 10), dir);
      } else if (name.toLowerCase() === 'models') {
        modelsContainer = dir;
      }
    }

    if (modelSubDirs.size === 0 && modelsContainer) {
      for await (const entry of (modelsContainer as IterDir).values()) {
        if (entry.kind === 'directory') {
          const m = /^(\d{3})\.model$/i.exec(entry.name);
          if (m) {
            modelSubDirs.set(parseInt(m[1], 10), entry as FileSystemDirectoryHandle);
          }
        }
      }
    }

    if (modelSubDirs.size > 0) {
      const availableSlots = Array.from(modelSubDirs.keys()).sort((a, b) => a - b);
      if (availableSlots.length === 1) {
        const targetDir = modelSubDirs.get(availableSlots[0])!;
        const loaded = await readModelDirFiles(targetDir, targetDir.name);
        const model = await this.core.importModelFiles(loaded);
        this.session = this.core.getSession()!;
        this.selectedZoneId = this.session.zones[0]?.id || null;
        this.telemetryDrawer.addLog(
          `Imported model #${String(model.slot).padStart(3, '0')} "${model.name}" (${model.zoneCount} zone(s))`
        );
        this.refreshUI();
        return;
      }

      // Check if rootHandle has a `ModelNames` cache file for instant names
      let cachedNames = new Map<number, string>();
      const modelNamesHandle = directFiles.find((f) => f.name.toLowerCase() === 'modelnames');
      if (modelNamesHandle) {
        try {
          const mnFile = await modelNamesHandle.getFile();
          const mnText = await mnFile.text();
          cachedNames = parseModelNamesCache(mnText);
        } catch {
          // ignore
        }
      }

      const initialEntries: NeuronDbModelEntry[] = availableSlots.map((slot) => {
        const dir = modelSubDirs.get(slot)!;
        const cached = cachedNames.get(slot);
        return {
          slot,
          folderName: dir.name,
          name: cached && cached !== '--<empty>--' ? cached : '',
          zoneCount: null,
          sourceCount: null,
          lowKey: null,
          highKey: null,
          parameterSet: null,
          stickModes: null,
          complexity: null,
          loadedMeta: false,
        };
      });

      this.neuronDbModal.open(initialEntries, (chosenSlot) => {
        void (async () => {
          try {
            const targetDir = modelSubDirs.get(chosenSlot);
            if (!targetDir) return;
            const loaded = await readModelDirFiles(targetDir, targetDir.name);
            const model = await this.core.importModelFiles(loaded);
            this.session = this.core.getSession()!;
            this.selectedZoneId = this.session.zones[0]?.id || null;
            this.telemetryDrawer.addLog(
              `Imported model #${String(model.slot).padStart(3, '0')} "${model.name}" (${model.zoneCount} zone(s))`
            );
            this.refreshUI();
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.telemetryDrawer.addLog(`Error loading model #${chosenSlot}: ${msg}`);
            alert(`Failed to load model #${String(chosenSlot).padStart(3, '0')}:\n${msg}`);
          }
        })();
      });

      // Progressively scan lightweight headers in batches of 20 without blocking UI
      void (async () => {
        const total = initialEntries.length;
        let done = 0;
        const batchSize = 20;
        for (let i = 0; i < total; i += batchSize) {
          if (this.neuronDbModal.isAborted()) return;
          const slice = initialEntries.slice(i, i + batchSize);
          await Promise.all(
            slice.map(async (item) => {
              if (this.neuronDbModal.isAborted()) return;
              const dir = modelSubDirs.get(item.slot)!;
              try {
                let scapeCount = 0;
                let firstSphereHandle: FileSystemFileHandle | null = null;
                let mnameHandle: FileSystemFileHandle | null = null;
                let mapScriptHandle: FileSystemFileHandle | null = null;

                for await (const entry of (dir as IterDir).values()) {
                  if (entry.kind !== 'file') continue;
                  const low = entry.name.toLowerCase();
                  if (low === 'mname') mnameHandle = entry as FileSystemFileHandle;
                  else if (low === 'map.script') mapScriptHandle = entry as FileSystemFileHandle;
                  else if (low.endsWith('.scape')) scapeCount++;
                  else if (low.endsWith('.sphere') && (!firstSphereHandle || low === '000001.sphere')) {
                    firstSphereHandle = entry as FileSystemFileHandle;
                  }
                }

                if (mnameHandle) {
                  const f = await mnameHandle.getFile();
                  const ab = await f.slice(0, 32).arrayBuffer();
                  const parsedName = parseMName(new Uint8Array(ab));
                  if (parsedName) item.name = parsedName;
                }
                if (!item.name) {
                  item.name = `Model${String(item.slot).padStart(3, '0')}`;
                }

                item.sourceCount = scapeCount;

                if (mapScriptHandle) {
                  const f = await mapScriptHandle.getFile();
                  const txt = await f.text();
                  const ms = parseMapScript(txt);
                  item.zoneCount = ms.activeZones.length || Math.max(1, scapeCount);
                  if (ms.activeZones.length > 0) {
                    item.lowKey = ms.activeZones[0].lowKey;
                    item.highKey = ms.activeZones[ms.activeZones.length - 1].highKey;
                  }
                } else {
                  item.zoneCount = Math.max(1, scapeCount);
                }

                if (firstSphereHandle) {
                  const f = await firstSphereHandle.getFile();
                  if (f.size >= 0x20) {
                    const hdrBuf = await f.slice(0, 0x24).arrayBuffer();
                    const view = new DataView(hdrBuf);
                    const tag = String.fromCharCode(
                      view.getUint8(0),
                      view.getUint8(1),
                      view.getUint8(2),
                      view.getUint8(3)
                    );
                    if (tag === 'psAN') {
                      const paramSet = view.getInt32(0x10, true);
                      const stickModes = view.getInt32(0x1c, true);
                      if (paramSet >= 0 && paramSet <= 9) item.parameterSet = paramSet;
                      if (stickModes >= 1 && stickModes <= 64) {
                        item.stickModes = stickModes;
                        item.complexity = stickModesToComplexity(stickModes);
                      }
                    }
                  }
                }

                item.loadedMeta = true;
                this.neuronDbModal.updateEntry(item);
              } catch {
                // ignore individual corrupt folder
              }
            })
          );
          done = Math.min(total, i + batchSize);
          this.neuronDbModal.setScanProgress(done, total);
        }
      })();
      return;
    }

    // 3. Otherwise collect `.wav` / `.aif` / `.aiff` audio files (recursively up to 1 level)
    const audioFiles: { name: string; buffer: ArrayBuffer }[] = [];
    const collectAudio = async (dir: FileSystemDirectoryHandle, depth: number): Promise<void> => {
      for await (const entry of (dir as IterDir).values()) {
        if (entry.name.startsWith('.') || entry.name.startsWith('._') || entry.name === '__MACOSX') {
          continue;
        }
        if (entry.kind === 'file') {
          const lower = entry.name.toLowerCase();
          if (lower.endsWith('.wav') || lower.endsWith('.aif') || lower.endsWith('.aiff')) {
            const file = await (entry as FileSystemFileHandle).getFile();
            const buffer = await file.arrayBuffer();
            audioFiles.push({ name: entry.name, buffer });
          }
        } else if (entry.kind === 'directory' && depth < 2) {
          await collectAudio(entry as FileSystemDirectoryHandle, depth + 1);
        }
      }
    };

    await collectAudio(rootHandle, 0);
    if (audioFiles.length === 0) {
      const msg =
        preferredKind === 'model'
          ? 'No valid .model files (MName, map.script, .scape, .sphere) found in selected folder.'
          : 'No valid .wav / .aif / .aiff audio files found in selected folder.';
      this.telemetryDrawer.addLog(`Folder import: ${msg}`);
      alert(msg);
      return;
    }

    const zones = await this.core.importAudioFiles(audioFiles, 'samples');
    this.session = this.core.getSession()!;
    this.selectedZoneId = zones[0]?.id || null;
    this.telemetryDrawer.addLog(
      `Import Folder: mapped ${audioFiles.length} audio file(s) into ${zones.length} contiguous zone(s).`
    );
    this.refreshUI();
  }

  private async importFromWebkitFileList(
    fileList: FileList,
    preferredKind: 'audio' | 'model'
  ): Promise<void> {
    try {
      // Group model files by `<NNN>.model` folder first WITHOUT reading all 4,527 buffers into RAM
      const modelFolders = new Map<number, File[]>();
      const looseModelFiles: File[] = [];
      const audioFileEntries: File[] = [];

      for (let i = 0; i < fileList.length; i++) {
        const f = fileList[i];
        const relPath = (f.webkitRelativePath || f.name).replace(/\\/g, '/');
        if (relPath.includes('__MACOSX/')) continue;
        const base = relPath.split('/').pop() ?? f.name;
        if (base.startsWith('.') || base.startsWith('._')) continue;

        const lower = base.toLowerCase();
        if (lower.endsWith('.wav') || lower.endsWith('.aif') || lower.endsWith('.aiff')) {
          audioFileEntries.push(f);
        } else if (
          lower.endsWith('.scape') ||
          lower.endsWith('.sphere') ||
          lower === 'map.script' ||
          lower === 'mname' ||
          lower.endsWith('.nmmodel')
        ) {
          const slotMatch = /(\d{3})\.model\//i.exec(relPath);
          if (slotMatch) {
            const slot = parseInt(slotMatch[1], 10);
            const list = modelFolders.get(slot) ?? [];
            list.push(f);
            modelFolders.set(slot, list);
          } else {
            looseModelFiles.push(f);
          }
        }
      }

      if ((preferredKind === 'model' || audioFileEntries.length === 0) && (modelFolders.size > 0 || looseModelFiles.length > 0)) {
        const loadSlotFiles = async (targetFiles: File[]) => {
          const loaded: { name: string; buffer: ArrayBuffer }[] = [];
          for (const f of targetFiles) {
            const relPath = (f.webkitRelativePath || f.name).replace(/\\/g, '/');
            const buffer = await f.arrayBuffer();
            loaded.push({ name: relPath, buffer });
          }
          const model = await this.core.importModelFiles(loaded);
          this.session = this.core.getSession()!;
          this.selectedZoneId = this.session.zones[0]?.id || null;
          this.telemetryDrawer.addLog(
            `Imported model folder #${String(model.slot).padStart(3, '0')} "${model.name}" (${model.zoneCount} zone(s))`
          );
          this.refreshUI();
        };

        if (modelFolders.size <= 1) {
          const targetFiles =
            modelFolders.size === 1
              ? Array.from(modelFolders.values())[0]
              : looseModelFiles;
          await loadSlotFiles(targetFiles);
          return;
        }

        const slots = Array.from(modelFolders.keys()).sort((a, b) => a - b);
        const initialEntries: NeuronDbModelEntry[] = slots.map((slot) => ({
          slot,
          folderName: `${String(slot).padStart(3, '0')}.model`,
          name: '',
          zoneCount: null,
          sourceCount: null,
          lowKey: null,
          highKey: null,
          parameterSet: null,
          stickModes: null,
          complexity: null,
          loadedMeta: false,
        }));

        this.neuronDbModal.open(initialEntries, (chosenSlot) => {
          const files = modelFolders.get(chosenSlot);
          if (files) {
            void loadSlotFiles(files);
          }
        });

        // Progressively inspect headers from File slices
        void (async () => {
          const total = initialEntries.length;
          const batchSize = 20;
          for (let i = 0; i < total; i += batchSize) {
            if (this.neuronDbModal.isAborted()) return;
            const slice = initialEntries.slice(i, i + batchSize);
            await Promise.all(
              slice.map(async (item) => {
                if (this.neuronDbModal.isAborted()) return;
                const files = modelFolders.get(item.slot) ?? [];
                let scapeCount = 0;
                let firstSphere: File | null = null;
                let mnameFile: File | null = null;
                let mapScriptFile: File | null = null;

                for (const f of files) {
                  const low = f.name.toLowerCase();
                  if (low === 'mname') mnameFile = f;
                  else if (low === 'map.script') mapScriptFile = f;
                  else if (low.endsWith('.scape')) scapeCount++;
                  else if (low.endsWith('.sphere') && (!firstSphere || low === '000001.sphere')) {
                    firstSphere = f;
                  }
                }

                if (mnameFile) {
                  const ab = await mnameFile.slice(0, 32).arrayBuffer();
                  item.name = parseMName(new Uint8Array(ab));
                }
                if (!item.name) item.name = `Model${String(item.slot).padStart(3, '0')}`;
                item.sourceCount = scapeCount;

                if (mapScriptFile) {
                  const txt = await mapScriptFile.text();
                  const ms = parseMapScript(txt);
                  item.zoneCount = ms.activeZones.length || Math.max(1, scapeCount);
                  if (ms.activeZones.length > 0) {
                    item.lowKey = ms.activeZones[0].lowKey;
                    item.highKey = ms.activeZones[ms.activeZones.length - 1].highKey;
                  }
                } else {
                  item.zoneCount = Math.max(1, scapeCount);
                }

                if (firstSphere && firstSphere.size >= 0x20) {
                  const hdrBuf = await firstSphere.slice(0, 0x24).arrayBuffer();
                  const view = new DataView(hdrBuf);
                  const tag = String.fromCharCode(
                    view.getUint8(0),
                    view.getUint8(1),
                    view.getUint8(2),
                    view.getUint8(3)
                  );
                  if (tag === 'psAN') {
                    const paramSet = view.getInt32(0x10, true);
                    const stickModes = view.getInt32(0x1c, true);
                    if (paramSet >= 0 && paramSet <= 9) item.parameterSet = paramSet;
                    if (stickModes >= 1 && stickModes <= 64) {
                      item.stickModes = stickModes;
                      item.complexity = stickModesToComplexity(stickModes);
                    }
                  }
                }

                item.loadedMeta = true;
                this.neuronDbModal.updateEntry(item);
              })
            );
            this.neuronDbModal.setScanProgress(Math.min(total, i + batchSize), total);
          }
        })();
        return;
      }

      if (audioFileEntries.length === 0) {
        alert('No valid audio or .model files found in the selected folder.');
        return;
      }

      const audioFiles: { name: string; buffer: ArrayBuffer }[] = [];
      for (const f of audioFileEntries) {
        const buffer = await f.arrayBuffer();
        audioFiles.push({ name: f.name, buffer });
      }
      const zones = await this.core.importAudioFiles(audioFiles, 'samples');
      this.session = this.core.getSession()!;
      this.selectedZoneId = zones[0]?.id || null;
      this.telemetryDrawer.addLog(
        `Import Folder: mapped ${audioFiles.length} audio file(s) into ${zones.length} contiguous zone(s).`
      );
      this.refreshUI();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.telemetryDrawer.addLog(`Folder import error: ${msg}`);
      alert(`Failed to import folder: ${msg}`);
    }
  }

  private async importMixedFilesOrZip(
    fileList: FileList,
    preferredKind: 'audio' | 'model',
    audioMode: 'samples' | 'by-name' = 'samples',
    sourceLabel = 'Import'
  ): Promise<void> {
    try {
      const expanded: { name: string; buffer: ArrayBuffer }[] = [];
      let sessionJsonText: string | null = null;

      for (let i = 0; i < fileList.length; i++) {
        const f = fileList[i];
        const lower = f.name.toLowerCase();
        if (lower.endsWith('.nmsession.json') || lower.endsWith('.json')) {
          sessionJsonText = await f.text();
          continue;
        }
        const buf = await f.arrayBuffer();
        if (lower.endsWith('.zip')) {
          const unzipped = parseZipArchive(new Uint8Array(buf));
          for (const entry of unzipped) {
            const copy = new Uint8Array(entry.data.byteLength);
            copy.set(entry.data);
            expanded.push({ name: entry.path, buffer: copy.buffer });
          }
        } else {
          expanded.push({ name: f.name, buffer: buf });
        }
      }

      if (sessionJsonText && expanded.length === 0) {
        this.session = await this.core.loadSessionFromJson(sessionJsonText);
        this.selectedZoneId = this.session.zones[0]?.id || null;
        this.telemetryDrawer.addLog(
          `${sourceLabel}: loaded session "${this.session.name}".`
        );
        this.refreshUI();
        return;
      }

      // Classify expanded files into model folders (<NNN>.model), loose model files, and audio files
      const modelFolders = new Map<number, { name: string; buffer: ArrayBuffer }[]>();
      const looseModelFiles: { name: string; buffer: ArrayBuffer }[] = [];
      const audioFiles: { name: string; buffer: ArrayBuffer }[] = [];

      for (const item of expanded) {
        const normPath = item.name.replace(/\\/g, '/');
        if (normPath.includes('__MACOSX/')) continue;
        const base = normPath.split('/').pop() ?? normPath;
        if (base.startsWith('.') || base.startsWith('._')) continue;

        const lower = base.toLowerCase();
        const isModelArtifact =
          lower.endsWith('.scape') ||
          lower.endsWith('.sphere') ||
          lower === 'map.script' ||
          lower === 'mname' ||
          lower.endsWith('.nmmodel') ||
          lower.endsWith('.neuronikmodel');
        const isAudio =
          lower.endsWith('.wav') || lower.endsWith('.aif') || lower.endsWith('.aiff');

        if (isModelArtifact) {
          const slotMatch = /(\d{3})\.model\//i.exec(normPath);
          if (slotMatch) {
            const slot = parseInt(slotMatch[1], 10);
            const list = modelFolders.get(slot) ?? [];
            list.push(item);
            modelFolders.set(slot, list);
          } else {
            looseModelFiles.push(item);
          }
        } else if (isAudio) {
          audioFiles.push({ name: base, buffer: item.buffer });
        }
      }

      const hasModelData = modelFolders.size > 0 || looseModelFiles.length > 0;

      // If multiple <NNN>.model directories were inside a .zip (e.g. NeuronDB.zip), open NeuronDbModal
      if (modelFolders.size > 1) {
        const slots = Array.from(modelFolders.keys()).sort((a, b) => a - b);
        const initialEntries: NeuronDbModelEntry[] = slots.map((slot) => {
          const files = modelFolders.get(slot) ?? [];
          let name = '';
          let scapeCount = 0;
          let zoneCount: number | null = null;
          let lowKey: number | null = null;
          let highKey: number | null = null;
          let parameterSet: number | null = null;
          let stickModes: number | null = null;
          let complexity: number | null = null;

          for (const f of files) {
            const base = (f.name.split('/').pop() ?? f.name).toLowerCase();
            if (base === 'mname') {
              name = parseMName(new Uint8Array(f.buffer));
            } else if (base === 'map.script') {
              const txt = new TextDecoder('latin1').decode(f.buffer);
              const ms = parseMapScript(txt);
              zoneCount = ms.activeZones.length;
              if (ms.activeZones.length > 0) {
                lowKey = ms.activeZones[0].lowKey;
                highKey = ms.activeZones[ms.activeZones.length - 1].highKey;
              }
            } else if (base.endsWith('.scape')) {
              scapeCount++;
            } else if (base.endsWith('.sphere') && parameterSet === null && f.buffer.byteLength >= 0x20) {
              const view = new DataView(f.buffer);
              const pSet = view.getInt32(0x10, true);
              const sModes = view.getInt32(0x1c, true);
              if (pSet >= 0 && pSet <= 9) parameterSet = pSet;
              if (sModes >= 1 && sModes <= 64) {
                stickModes = sModes;
                complexity = stickModesToComplexity(sModes);
              }
            }
          }

          return {
            slot,
            folderName: `${String(slot).padStart(3, '0')}.model`,
            name: name || `Model${String(slot).padStart(3, '0')}`,
            zoneCount: zoneCount || Math.max(1, scapeCount),
            sourceCount: scapeCount,
            lowKey,
            highKey,
            parameterSet,
            stickModes,
            complexity,
            loadedMeta: true,
          };
        });

        this.neuronDbModal.open(initialEntries, (chosenSlot) => {
          void (async () => {
            const files = modelFolders.get(chosenSlot);
            if (!files) return;
            const model = await this.core.importModelFiles(files);
            this.session = this.core.getSession()!;
            this.selectedZoneId = this.session.zones[0]?.id || null;
            this.telemetryDrawer.addLog(
              `${sourceLabel}: loaded model #${String(model.slot).padStart(3, '0')} "${model.name}" (${model.zoneCount} zone(s))`
            );
            this.refreshUI();
          })();
        });
        return;
      }

      // Single model (either in a .zip or loose files, optionally with embedded Samples/*.wav)
      if (hasModelData && (preferredKind === 'model' || audioFiles.length === 0 || looseModelFiles.some((f) => f.name.toLowerCase().endsWith('.nmmodel')))) {
        const targetFiles =
          modelFolders.size === 1
            ? [...Array.from(modelFolders.values())[0], ...audioFiles]
            : [...looseModelFiles, ...audioFiles];
        const model = await this.core.importModelFiles(targetFiles);
        this.session = this.core.getSession()!;
        this.selectedZoneId = this.session.zones[0]?.id || null;
        this.telemetryDrawer.addLog(
          `${sourceLabel}: imported model #${String(model.slot).padStart(3, '0')} "${model.name}" (${model.zoneCount} zone(s))`
        );
        this.refreshUI();
        return;
      }

      // Otherwise, if audio files (.wav / .aif / .aiff) were provided (directly or inside a .zip)
      if (audioFiles.length > 0) {
        const zones = await this.core.importAudioFiles(audioFiles, audioMode);
        this.session = this.core.getSession()!;
        this.selectedZoneId = zones[0]?.id || null;
        this.telemetryDrawer.addLog(
          `${sourceLabel}: mapped ${audioFiles.length} audio file(s) into ${zones.length} contiguous zone(s).`
        );
        this.refreshUI();
        return;
      }

      throw new Error(
        'No se encontraron archivos compatibles (.model, .scape, .sphere, .nmmodel, .wav, .aif o .zip válido).'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.telemetryDrawer.addLog(`${sourceLabel} error: ${msg}`);
      alert(`Error al importar archivos:\n${msg}`);
    }
  }

  private triggerAudioImport(mode: 'samples' | 'by-name'): void {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.accept = '.wav,.aif,.aiff,.zip';
    fileInput.addEventListener('change', async () => {
      const fileList = fileInput.files;
      if (!fileList || fileList.length === 0) return;
      const modeLabel =
        mode === 'by-name' ? 'Import by Name (Ctrl+N)' : 'Import Samples (Ctrl+I)';
      await this.importMixedFilesOrZip(fileList, 'audio', mode, modeLabel);
    });
    fileInput.click();
  }

  private triggerModelImport(): void {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    // Do not set a restrictive `accept` filter here: Windows File Explorer hides
    // extensionless files like `MName` when custom extension filters are active.
    fileInput.addEventListener('change', async () => {
      const fileList = fileInput.files;
      if (!fileList || fileList.length === 0) return;
      await this.importMixedFilesOrZip(
        fileList,
        'model',
        'samples',
        'Import Model Files / .zip'
      );
    });
    fileInput.click();
  }

  private performUndo(): void {
    const state = this.core.getHistoryState();
    if (!state.canUndo) return;
    const label = state.undoLabel;
    const restored = this.core.undo();
    if (restored) {
      this.session = restored;
      if (!this.session.zones.some((z) => z.id === this.selectedZoneId)) {
        this.selectedZoneId = this.session.zones[0]?.id || null;
      }
      this.telemetryDrawer.addLog(`Undo: ${label}`);
      this.refreshUI();
    }
  }

  private performRedo(): void {
    const state = this.core.getHistoryState();
    if (!state.canRedo) return;
    const label = state.redoLabel;
    const restored = this.core.redo();
    if (restored) {
      this.session = restored;
      if (!this.session.zones.some((z) => z.id === this.selectedZoneId)) {
        this.selectedZoneId = this.session.zones[0]?.id || null;
      }
      this.telemetryDrawer.addLog(`Redo: ${label}`);
      this.refreshUI();
    }
  }

  private bindKeyboardShortcuts(): void {
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'SELECT' ||
          target.tagName === 'TEXTAREA');

      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase();
        if (key === 'z' && !e.shiftKey) {
          e.preventDefault();
          this.performUndo();
          return;
        }
        if (key === 'y' || (key === 'z' && e.shiftKey)) {
          e.preventDefault();
          this.performRedo();
          return;
        }
        if (key === 's') {
          e.preventDefault();
          if (this.session) {
            void this.core.saveSession(this.session);
            const jsonText = this.core.exportSessionJson();
            const blob = new Blob([jsonText], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const safeName = this.session.name.replace(/[^A-Za-z0-9_-]/g, '_');
            a.href = url;
            a.download = `${safeName}.nmsession.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            this.telemetryDrawer.addLog(`Saved session ${safeName}.nmsession.json`);
          }
          return;
        }
        if (isInput) return;

        if (key === 'o') {
          e.preventDefault();
          this.triggerOpenSession();
        } else if (key === 'i') {
          e.preventDefault();
          this.triggerAudioImport('samples');
        } else if (key === 'n') {
          e.preventDefault();
          this.triggerAudioImport('by-name');
        } else if (key === 'p' || e.key === 'Enter') {
          e.preventDefault();
          void this.handleStartProcess();
        } else if (key === 'b') {
          e.preventDefault();
          void this.core.loadBank().then((bank) => {
            this.bankDrawer.setBank(bank);
            this.bankDrawer.toggle();
          });
        } else if (key === 'l') {
          e.preventDefault();
          this.telemetryDrawer.toggle();
        } else if (key === 'm') {
          e.preventDefault();
          this.inspector.toggleDrawer();
        } else if (key === 'e') {
          e.preventDefault();
          this.toggleSpectralPanel();
        } else if (key === 't') {
          e.preventDefault();
          if (this.session) {
            const slot = this.session.processConfig.modelNumber;
            const safeName = this.session.processConfig.modelName.replace(
              /[^A-Za-z0-9_-]/g,
              '_'
            );
            void this.core.exportModel(
              slot,
              `NeuronModel_${String(slot).padStart(3, '0')}_${safeName}.zip`
            );
          }
        }
        return;
      }

      if (e.key === 'F1') {
        e.preventDefault();
        this.navbar.showDocModal('manual');
        return;
      }

      if (isInput) return;

      if (e.key === 'Insert') {
        e.preventDefault();
        const active = this.getActiveZone();
        if (active) {
          void this.core.addZone(active.rootKey).then((newZ) => {
            this.session = this.core.getSession()!;
            this.selectedZoneId = newZ.id;
            this.telemetryDrawer.addLog(`Split zone at MIDI ${active.rootKey}`);
            this.refreshUI();
          });
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.selectedZoneId && this.session && this.session.zones.length > 1) {
          e.preventDefault();
          void this.core.removeZone(this.selectedZoneId).then(() => {
            this.session = this.core.getSession()!;
            this.selectedZoneId = this.session.zones[0]?.id || null;
            this.telemetryDrawer.addLog(`Removed selected zone via keyboard shortcut.`);
            this.refreshUI();
          });
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (!this.session || this.session.zones.length <= 1) return;
        e.preventDefault();
        const currIdx = this.getActiveZoneIndex();
        const delta = e.key === 'ArrowLeft' ? -1 : 1;
        const nextIdx = (currIdx + delta + this.session.zones.length) % this.session.zones.length;
        const nextZone = this.session.zones[nextIdx];
        if (nextZone) {
          this.selectedZoneId = nextZone.id;
          this.refreshUI();
        }
      } else if (e.key === ' ') {
        e.preventDefault();
        const rt = this.core.getRealtimeSpectrum();
        if (rt.isPlaying) {
          this.core.stopAudition();
        } else {
          const active = this.getActiveZone();
          if (active) {
            const kbMode = this.spectralView.getKeyboardMode();
            void this.core.auditionZoneComparison(active.id, kbMode);
            this.spectralView.notifyPlaybackStarted();
          }
        }
      }
    });
  }

  private getActiveZone(): Zone | null {
    if (!this.session) return null;
    return this.session.zones.find((z) => z.id === this.selectedZoneId) || this.session.zones[0] || null;
  }

  private getActiveZoneIndex(): number {
    if (!this.session) return 0;
    const idx = this.session.zones.findIndex((z) => z.id === this.selectedZoneId);
    return idx >= 0 ? idx : 0;
  }

  private bindCoreEvents(): void {
    this.core.on((event: CoreEvent) => {
      switch (event.type) {
        case 'session-changed':
          this.session = event.session;
          this.refreshUI();
          break;
        case 'history-changed':
          this.navbar.updateHistory(event.history);
          break;
        case 'process-progress':
          this.processModal.updateProgress(event.progress);
          this.navbar.setProcessing(event.progress.status === 'running');
          break;
        case 'process-complete':
          this.navbar.setProcessing(false);
          if (this.session) {
            for (const z of this.session.zones) {
              try {
                this.core.inspectZoneSpectrum(z.id);
              } catch {
                // ignore
              }
            }
          }
          this.refreshUI();
          this.telemetryDrawer.addLog(`Model generated: #${event.model.slot} '${event.model.name}' (${event.model.zoneCount} zones)`);
          if (event.model.zonesAnalysis) {
            for (const za of event.model.zonesAnalysis) {
              this.telemetryDrawer.addLog(
                `Zone [${za.lowKey}..${za.highKey}] ${za.sampleName}: f0=${za.detectedF0Hz} Hz, ${za.gridNotice}, ${za.activePartials} partials, ${za.layerCount} layer(s), ${za.frameCount} frame(s)`
              );
            }
          }
          break;
        case 'process-error':
          this.navbar.setProcessing(false);
          this.telemetryDrawer.addLog(`Process error: ${event.error}`);
          alert(`Error during processing: ${event.error}`);
          break;
      }
    });
  }

  private refreshUI(): void {
    if (!this.session) return;
    const errors = this.core.validateCoverage();
    const activeZone = this.getActiveZone();

    this.navbar.updateSession(this.session, errors);
    this.navbar.updateHistory(this.core.getHistoryState());
    this.ribbon.setZones(this.session.zones, this.selectedZoneId);
    this.inspector.setZone(activeZone, this.getActiveZoneIndex(), this.session.zones.length, this.session.zones);
    this.processPanel.setConfig(this.session.processConfig);
    this.keyboard.setActiveZone(activeZone);
    this.telemetryDrawer.updateAudit(this.session, errors);
    this.updateSpectralView(activeZone);
  }

  private toggleSpectralPanel(): void {
    this.isSpectralVisible = !this.isSpectralVisible;
    const spectralMount = document.querySelector<HTMLElement>('#spectral-mount');
    if (spectralMount) {
      spectralMount.classList.toggle('is-collapsed', !this.isSpectralVisible);
    }
    this.navbar.setSpectralVisible(this.isSpectralVisible);
    if (this.isSpectralVisible) {
      this.updateSpectralView(this.getActiveZone());
    }
  }

  private updateSpectralView(activeZone: Zone | null): void {
    if (!this.spectralView) return;
    if (!activeZone) {
      this.spectralView.setInspection(null);
      return;
    }
    try {
      const inspection = this.core.inspectZoneSpectrum(activeZone.id);
      this.spectralView.setInspection(inspection);
    } catch {
      this.spectralView.setInspection(null);
    }
  }

  private async handleStartProcess(): Promise<void> {
    if (!this.session) return;
    const errors = this.core.validateCoverage();
    if (errors.length > 0) {
      alert(`Cannot start Process: Gaps detected in MIDI note coverage.\n\n${errors.join('\n')}\n\nPlease adjust zone boundaries or click Edit -> Reset to Single 0..127 Zone.`);
      this.telemetryDrawer.open();
      return;
    }

    const srcInfo = this.core.inspectProcessSources();
    let forceReanalyzeImported = false;

    if (srcInfo.importedSources.length > 0) {
      if (srcInfo.newAudioSources.length > 0) {
        // Hybrid session: some zones have new WAV/AIFFs, other zones come from an imported .model
        const proceedHybrid = window.confirm(
          `Aviso: Este modelo combina ${srcInfo.newAudioSources.length} muestra(s) WAV/AIFF nueva(s) con ${srcInfo.importedSources.length} fuente(s) heredadas de un .model antiguo (sin WAV original).\n\n` +
            `• Pulsa [Aceptar] para analizar las ${srcInfo.newAudioSources.length} muestra(s) nueva(s) y CONSERVAR intactos sin pérdida los .scape/.sphere de las ${srcInfo.importedSources.length} fuente(s) heredadas.\n` +
            `• Pulsa [Cancelar] para no ejecutar el proceso.`
        );
        if (!proceedHybrid) return;
        this.telemetryDrawer.addLog(
          `Hybrid build: analyzing ${srcInfo.newAudioSources.length} new WAV/AIFF source(s) and preserving ${srcInfo.importedSources.length} inherited .scape/.sphere source(s) losslessly.`
        );
      } else if (!this.session.dirty && !srcInfo.complexityChanged) {
        // Pure imported .model and nothing was modified at all
        const forceLossy = window.confirm(
          `Aviso: El modelo "${this.session.processConfig.modelName}" procede de un .model antiguo ya compilado (sin los WAV originales) y no has modificado ningún parámetro ni zona.\n\n` +
            `El modelo ya está listo para usarse o exportarse directamente sin necesidad de procesarlo.\n\n` +
            `• Pulsa [Cancelar] para conservar el modelo original intacto (recomendado).\n` +
            `• Pulsa [Aceptar] SOLO si deseas forzar un re-análisis desde la onda resintetizada (con pérdida / efecto fotocopia).`
        );
        if (!forceLossy) return;
        forceReanalyzeImported = true;
      } else if (srcInfo.complexityChanged) {
        // Pure imported .model and user changed Complexity
        const keepLossless = window.confirm(
          `Aviso: Las ${srcInfo.importedSources.length} fuente(s) de este modelo proceden de un .model antiguo sin los WAV originales.\n\n` +
            `Recalcular Complexity (${srcInfo.importedComplexity} -> ${this.session.processConfig.complexity}) obligaría a re-analizar el audio resintetizado (efecto fotocopia con pérdida).\n\n` +
            `• Pulsa [Aceptar] para actualizar cabeceras/zonas CONSERVANDO los .scape/.sphere originales sin pérdida (recomendado).\n` +
            `• Pulsa [Cancelar] si prefieres cancelar o forzar el re-análisis con pérdida.`
        );
        if (!keepLossless) {
          const confirmForce = window.confirm(
            `¿Deseas forzar el re-análisis con pérdida (efecto fotocopia) a Complexity ${this.session.processConfig.complexity}?\n\n` +
              `• Pulsa [Cancelar] para abortar y no tocar el modelo.\n` +
              `• Pulsa [Aceptar] para forzar el re-análisis.`
          );
          if (!confirmForce) return;
          forceReanalyzeImported = true;
        }
      } else {
        // Pure imported .model and user modified Parameter Set, Name, Slot, or Zone bounds/trims
        const proceedLossless = window.confirm(
          `Aviso: Este modelo procede de un .model antiguo ya compilado (sin los WAV originales).\n\n` +
            `• Pulsa [Aceptar] para aplicar tus cambios de cabeceras/zonas (MName, map.script, Parameter Set) CONSERVANDO los .scape y .sphere originales 100% sin pérdida.\n` +
            `• Pulsa [Cancelar] para abortar.`
        );
        if (!proceedLossless) return;
        this.telemetryDrawer.addLog(
          `Lossless update: preserving ${srcInfo.importedSources.length} original .scape/.sphere source(s) (updating MName, map.script & Parameter Set headers only).`
        );
      }
    }

    this.processModal.show({
      status: 'running',
      currentZone: 1,
      totalZones: this.session.zones.length,
      currentSample: this.session.zones[0]?.sampleLow || 'Excitation waveform',
      percent: 0,
      message: 'Beginning spectral neural resynthesis...',
      elapsedMs: 0
    });

    this.navbar.setProcessing(true);
    await this.core.startProcess(this.session.processConfig, { forceReanalyzeImported });
  }
}

// Bootstrap application
const app = new App();
app.init().catch(console.error);
