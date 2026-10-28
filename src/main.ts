// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Application Entry Point
// Assembles UI with WebAudioPipeline and ABDShared design system
// ─────────────────────────────────────────────────────────

import './style.css';
import {
  createCoreService,
  type CoreService,
  type Zone,
  type Session,
  type CoreEvent,
} from './core';
import { AppNavbar } from './ui/Navbar';
import { ImportHandlers } from './app/importHandlers';
import { MenuActions } from './app/menuActions';
import { ZoneRibbon } from './ui/ZoneRibbon';
import { ZoneInspector } from './ui/ZoneInspector';
import { ProcessPanel } from './ui/ProcessPanel';
import { KeyboardStrip } from './ui/KeyboardStrip';
import { ProcessModal } from './ui/ProcessModal';
import { TelemetryDrawer } from './ui/TelemetryDrawer';
import { BankDrawer } from './ui/BankDrawer';
import { SpectralView } from './ui/SpectralView';
import { NeuronDbModal } from './ui/NeuronDbModal';
import { confirmDialog, toast } from './ui/notify';

class App {
  private core: CoreService = createCoreService();
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
  private imports: ImportHandlers;
  private menus: MenuActions;

  constructor() {
    const self = this;
    this.imports = new ImportHandlers({
      core: self.core,
      get session() { return self.session; },
      set session(value: Session | null) { self.session = value; },
      get selectedZoneId() { return self.selectedZoneId; },
      set selectedZoneId(value: string | null) { self.selectedZoneId = value; },
      log: (msg: string) => self.telemetryDrawer.addLog(msg),
      refresh: () => self.refreshUI(),
      get bank() { return self.bankDrawer; },
      get neuronDb() { return self.neuronDbModal; },
    });
    this.menus = new MenuActions({
      core: self.core,
      imports: self.imports,
      shell: {
        getNavbar: () => self.navbar,
        getInspector: () => self.inspector,
        getSpectralView: () => self.spectralView,
        getTelemetry: () => self.telemetryDrawer,
        getBank: () => self.bankDrawer,
      },
      get session() { return self.session; },
      set session(value: Session | null) { self.session = value; },
      get selectedZoneId() { return self.selectedZoneId; },
      set selectedZoneId(value: string | null) { self.selectedZoneId = value; },
      themes: self.themes,
      get themeIndex() { return self.currentThemeIndex; },
      set themeIndex(value: number) { self.currentThemeIndex = value; },
      log: (msg: string) => self.telemetryDrawer.addLog(msg),
      refresh: () => self.refreshUI(),
      getActiveZone: () => self.getActiveZone(),
      getActiveZoneIndex: () => self.getActiveZoneIndex(),
      handleStartProcess: () => self.handleStartProcess(),
      toggleSpectralPanel: () => self.toggleSpectralPanel(),
    });
  }

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
    this.navbar = new AppNavbar(navMount, this.menus.buildNavbarHandlers());

    // 2. Zone Ribbon (above Keyboard Strip: 2D Key 0..127 x Velocity 1..127 map)
    this.ribbon = new ZoneRibbon(ribbonMount, {
      onSelectZone: (id) => {
        this.selectedZoneId = id;
        const active = this.getActiveZone();
        this.inspector.setZone(active, this.getActiveZoneIndex(), this.session!.zones.length, this.session!.zones, this.session!.processConfig.workingMode);
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
      onDropSample: (zoneId, slot, file) => {
        void this.imports.loadSampleFileIntoZone(zoneId, slot, file);
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
        this.inspector.setZone(active, this.getActiveZoneIndex(), this.session!.zones.length, this.session!.zones, this.session!.processConfig.workingMode);
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
      onLoadSampleFile: (zoneId, slot, file) => {
        void this.imports.loadSampleFileIntoZone(zoneId, slot, file);
      },
      onDropMultipleFiles: (files) => {
        void this.imports.handleDroppedFiles(files);
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
          const errors = this.core.validateCoverage();
          this.navbar.updateSession(this.session, errors);
          this.processPanel.setValidation(errors, this.session.zones);
          // Working Mode / target format changes re-gate the inspector's
          // velSplit slider, so re-sync it with the stored session config.
          this.inspector.setZone(this.getActiveZone(), this.getActiveZoneIndex(), this.session.zones.length, this.session.zones, this.session.processConfig.workingMode);
          this.updateSpectralView(this.getActiveZone());
        },
        onStartProcess: () => this.handleStartProcess()
      },
      {
        errors: this.core.validateCoverage(),
        zones: this.session!.zones
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
            this.inspector.setZone(found, this.getActiveZoneIndex(), this.session!.zones.length, this.session!.zones, this.session!.processConfig.workingMode);
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
    this.keyboard.setZones(this.session!.zones, this.selectedZoneId);

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
          const errors = this.core.validateCoverage();
          this.processPanel.setConfig(this.session.processConfig, {
            errors,
            zones: this.session.zones,
          });
          this.navbar.updateSession(this.session, errors);
          this.bankDrawer.setSelectedSlot(slot);
        }
      },
      onExportModel: async (slot) => {
        await this.core.exportModel(
          slot,
          `NeuronModel_${String(slot).padStart(3, '0')}.zip`
        );
        this.telemetryDrawer.addLog(`Exported model package #${String(slot).padStart(3, '0')} (.zip)`);
      },
      onClearModels: async () => {
        await this.core.clearGeneratedModels();
        const bank = await this.core.loadBank();
        this.bankDrawer.setBank(bank, this.session?.processConfig.modelNumber ?? null);
        this.telemetryDrawer.addLog('Cleared all generated models from session bank.');
      },
      onConfigureNeuronDbFolder: () => this.imports.triggerConfigureNeuronDbFolder(),
    });

    this.processModal = new ProcessModal(modalsMount, {
      onCancel: () => this.core.cancelProcess(),
      onClose: () => this.navbar.setProcessing(false)
    });

    this.navbar.mount(this.session!, this.core.validateCoverage());
    this.menus.bindKeyboardShortcuts();
    this.imports.bindGlobalDragAndDrop();
    this.menus.bindUnsavedChangesGuard();
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
        case 'bank-updated':
          this.bankDrawer.setBank(event.bank, this.session?.processConfig.modelNumber ?? null);
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
          toast(`Error during processing: ${event.error}`, 'error');
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
    this.inspector.setZone(activeZone, this.getActiveZoneIndex(), this.session.zones.length, this.session.zones, this.session.processConfig.workingMode);
    this.processPanel.setConfig(this.session.processConfig, {
      errors,
      zones: this.session.zones,
    });
    this.keyboard.setZones(this.session.zones, this.selectedZoneId);
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
      toast(
        `Cannot start Process: gaps in MIDI note coverage (${errors.length}). Adjust zone boundaries or Reset to a single 0..127 zone.`,
        'error'
      );
      this.telemetryDrawer.open();
      return;
    }

    const srcInfo = this.core.inspectProcessSources();
    let forceReanalyzeImported = false;

    if (srcInfo.importedSources.length > 0) {
      if (srcInfo.newAudioSources.length > 0) {
        // Hybrid session: some zones have new WAV/AIFFs, other zones come from an imported .model
        const proceedHybrid = await confirmDialog(
          `This model combines ${srcInfo.newAudioSources.length} new WAV/AIFF sample(s) with ${srcInfo.importedSources.length} inherited source(s) from a legacy .model (no original WAV).\n\n` +
            `Accept analyzes the ${srcInfo.newAudioSources.length} new sample(s) and keeps the ${srcInfo.importedSources.length} inherited .scape/.sphere source(s) intact and lossless.`,
          { confirmLabel: 'Analyze new & keep lossless' }
        );
        if (!proceedHybrid) return;
        this.telemetryDrawer.addLog(
          `Hybrid build: analyzing ${srcInfo.newAudioSources.length} new WAV/AIFF source(s) and preserving ${srcInfo.importedSources.length} inherited .scape/.sphere source(s) losslessly.`
        );
      } else if (!this.session.dirty && !srcInfo.complexityChanged) {
        // Pure imported .model and nothing was modified at all
        const forceLossy = await confirmDialog(
          `Model "${this.session.processConfig.modelName}" comes from an already-compiled legacy .model (no original WAVs) and nothing was modified. It is ready to use or export as-is.\n\n` +
            `Only force a re-analysis from the resynthesized wave (lossy / photocopy effect) if you know what you are doing.`,
          { confirmLabel: 'Force lossy re-analysis', cancelLabel: 'Keep original (recommended)', danger: true }
        );
        if (!forceLossy) return;
        forceReanalyzeImported = true;
      } else if (srcInfo.complexityChanged) {
        // Pure imported .model and user changed Complexity
        const keepLossless = await confirmDialog(
          `The ${srcInfo.importedSources.length} source(s) of this model come from a legacy .model without the original WAVs.\n\n` +
            `Recalculating Complexity (${srcInfo.importedComplexity} -> ${this.session.processConfig.complexity}) would force a re-analysis of the resynthesized audio (lossy photocopy effect).\n\n` +
            `Accept updates headers/zones while keeping the original .scape/.sphere data lossless (recommended).`,
          { confirmLabel: 'Update losslessly (recommended)', cancelLabel: 'Cancel' }
        );
        if (!keepLossless) {
          const confirmForce = await confirmDialog(
            `Force the lossy re-analysis (photocopy effect) at Complexity ${this.session.processConfig.complexity}?`,
            { confirmLabel: 'Force re-analysis', danger: true }
          );
          if (!confirmForce) return;
          forceReanalyzeImported = true;
        }
      } else {
        // Pure imported .model and user modified Parameter Set, Name, Slot, or Zone bounds/trims
        const proceedLossless = await confirmDialog(
          `This model comes from an already-compiled legacy .model (no original WAVs).\n\n` +
            `Accept applies your header/zone changes (MName, map.script, Parameter Set) while keeping the original .scape and .sphere data 100% lossless.`,
          { confirmLabel: 'Apply losslessly' }
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
