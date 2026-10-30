// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Application Entry Point
// Assembles UI with WebAudioPipeline and ABDShared design system
// ─────────────────────────────────────────────────────────

import './style.css';
import {
  createCoreService,
  DEFAULT_MASTER_WAVE_CONFIG,
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
import { resolveClassicNoteTargets, resolveExtendedNoteTargets } from './core/noteMapping';
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
      onDropCoverImage: (file: File) => self.handleCoverImageUpload(file),
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
      getExtendedRegions: () => this.core.getExtendedRegions(),
      onUpdateExtendedRegion: async (regionId, changes) => {
        await this.core.updateExtendedRegion(regionId, changes);
        this.session = this.core.getSession()!;
        this.refreshUI();
      },
      onAddExtendedRegion: async (partial, anchorRegionId) => {
        const reg = await this.core.addExtendedRegion(partial, anchorRegionId);
        this.session = this.core.getSession()!;
        this.inspector.setSelectedRegionId(reg.id);
        this.telemetryDrawer.addLog(
          `Added Extended Region [${reg.id}]: Keys ${reg.lowKey}..${reg.highKey} (Root ${reg.rootKey}), Vel ${reg.lowVel}..${reg.highVel}${reg.sampleName ? `, Sample: ${reg.sampleName}` : ' (Empty Sample)'}`
        );
        this.refreshUI();
      },
      onRemoveExtendedRegion: async (regionId) => {
        await this.core.removeExtendedRegion(regionId);
        this.session = this.core.getSession()!;
        this.telemetryDrawer.addLog(`Removed Extended Region [${regionId}]`);
        this.refreshUI();
      },
      onLoadSampleFileIntoRegion: (regionId, file) => {
        void this.imports.loadSampleFileIntoRegion(regionId, file);
      },
      getCommonPlayback: () =>
        this.session?.processConfig.commonPlayback ?? {
          loopMode: 'no_loop',
          pitchKeytrack: 100,
          trigger: 'attack',
          fadeCurve: 'equal-power',
        },
      onUpdateCommonPlayback: async (changes, resetAllOverrides) => {
        if (!this.session) return;
        const currCommon = this.session.processConfig.commonPlayback ?? {
          loopMode: 'no_loop',
          pitchKeytrack: 100,
          trigger: 'attack',
          fadeCurve: 'equal-power',
        };
        const nextCommon = { ...currCommon, ...changes };
        if (resetAllOverrides && this.session.extendedRegions) {
          for (const r of this.session.extendedRegions) {
            r.hasPlaybackOverride = false;
          }
        }
        this.session = this.core.updateProcessConfig({
          commonPlayback: nextCommon,
        });
        this.refreshUI();
      },
      getArticulation: () => this.core.getArticulation(),
      onUpdateArticulation: (changes) => {
        this.session = this.core.updateArticulation(changes);
        this.refreshUI();
      },
      getDetectedCategory: () => this.session?.detectedInstrumentCategory,
      getZoneClassification: (zoneId) => {
        try {
          return this.core.inspectZoneSpectrum(zoneId)?.classification ?? undefined;
        } catch {
          return undefined;
        }
      },
      onAutoDetectZone: (zoneId) => {
        const res = this.core.autoDetectZonePitchAndParameterSet(zoneId, true);
        if (res) {
          this.session = this.core.getSession()!;
          const pSetInfo = this.core.getParameterSets().find((p) => p.id === res.recommendedParameterSet);
          const pSetName = pSetInfo?.name ?? `Set ${res.recommendedParameterSet}`;
          this.telemetryDrawer.addLog(
            `Auto-detected [${zoneId}]: f0=${res.descriptors.detectedF0Hz} Hz (MIDI ${res.descriptors.detectedMidiNote}, ${res.descriptors.detectedCentOffset >= 0 ? '+' : ''}${res.descriptors.detectedCentOffset} ct) | ${res.detectedCategory} -> ParamSet #${res.recommendedParameterSet} (${pSetName})`
          );
          toast(
            `Auto-detected: MIDI ${res.descriptors.detectedMidiNote} (${res.descriptors.detectedF0Hz} Hz) • ${res.detectedCategory} (Set #${res.recommendedParameterSet})`,
            'success'
          );
          this.refreshUI();
        } else {
          toast('Assign an audio sample to this zone before running Auto-Detect.', 'warning');
        }
      },
      getMasterWaveConfig: () =>
        this.session?.processConfig.masterWaveConfig ?? DEFAULT_MASTER_WAVE_CONFIG,
      getZoneSampleFormatInfo: (zoneId) => this.core.getZoneSampleFormatInfo(zoneId),
      onPromoteZoneToMasterWave: async (zoneId, cfg) => {
        const res = await this.core.promoteZoneToMasterWave(zoneId, cfg);
        if (res) {
          this.session = this.core.getSession()!;
          this.telemetryDrawer.addLog(
            `Master Wave [${res.zoneId}]: "${res.sampleName}" -> "${res.masterSampleName}" (${(res.masterSampleRate / 1000).toFixed(1)} kHz / ${res.bitDepth}-bit, ${res.numChannels}ch, ${res.masterDurationSec}s, Loop: ${res.loopDurationSec}s, ZC Corr: ${Math.round(res.zeroCrossingCorrelation * 100)}%)`
          );
          toast(
            `Promoted to 24-bit / 96 kHz (${res.numChannels}ch, Loop ${res.loopDurationSec}s)`,
            'success'
          );
          this.refreshUI();
        }
      },
      onPromoteAllZonesToMasterWave: async (cfg) => {
        const results = await this.core.promoteAllZonesToMasterWave(cfg);
        if (results.length > 0) {
          this.session = this.core.getSession()!;
          this.telemetryDrawer.addLog(
            `Promoted ${results.length} zone(s) to 24-bit / 96.000 Hz Master Wave (${results[0].numChannels}ch, engine=${results[0].promotionMethodUsed}).`
          );
          toast(
            `Promoted all ${results.length} zone(s) to 24-bit / 96 kHz Master Wave`,
            'success'
          );
          this.refreshUI();
        }
      },
      getModelProvenance: () => this.core.getModelProvenance(),
      getAssetStoreDiagnostics: () => this.core.getAssetStoreDiagnostics(),
      onReprocessFromPurestSource: async () => {
        const prov = await this.core.reprocessFromPurestSource();
        this.session = this.core.getSession()!;
        this.telemetryDrawer.addLog(
          `Time Capsule Reprocess #${prov.reprocessCount}: Purest origin=${prov.primarySourceLayer} -> activeInput=${prov.activeAnalysisSourceLayer} (${prov.presentLayers.length}/5 layers active).`
        );
        toast(
          `Reprocessed #${prov.reprocessCount} from ${prov.primarySourceLayer} (0 Generation-Loss)`,
          'success'
        );
        this.refreshUI();
      },
      onExportTimeCapsule: async () => {
        const slot = this.session?.processConfig.modelNumber ?? 0;
        const name = (this.session?.processConfig.modelName ?? 'Model').replace(/[^A-Za-z0-9_-]/g, '_');
        await this.core.exportModel(
          slot,
          `TimeCapsule_${String(slot).padStart(3, '0')}_${name}.zip`
        );
        this.telemetryDrawer.addLog(
          `Exported 5-Layer Time Capsule (.zip) for Slot #${String(slot).padStart(3, '0')} (${name}).`
        );
        toast(`Exported Time Capsule #${String(slot).padStart(3, '0')} (.zip)`, 'success');
        this.refreshUI();
      },
      onOpenLoopEditor: () => {
        this.inspector.openLoopEditorDrawer();
      },
      getLoopEditorData: (zoneId, regionId) => {
        const isExtended = this.session?.processConfig.workingMode === 'extended';
        const zId = zoneId ?? this.getActiveZone()?.id;
        const rId = isExtended ? (regionId ?? this.inspector.getSelectedRegionId() ?? undefined) : undefined;
        return this.core.getZoneLoopEditorData(zId, rId);
      },
      onAuditionRow: (opts) => {
        void this.core.auditionRow(opts);
        this.spectralView?.notifyPlaybackStarted();
      },
      onAuditionLoop: (opts) => {
        const isExtended = this.session?.processConfig.workingMode === 'extended';
        const zId = opts.zoneId ?? this.getActiveZone()?.id;
        if (!zId) return;
        const rId = isExtended ? (opts.regionId ?? this.inspector.getSelectedRegionId() ?? undefined) : undefined;
        void this.core.auditionLoop(zId, {
          regionId: rId,
          loopStartFrame: opts.loopStartFrame,
          loopEndFrame: opts.loopEndFrame,
          loopEnabled: opts.loopEnabled,
        });
        this.spectralView?.notifyPlaybackStarted();
      },
      onStopAudition: () => {
        this.core.stopAudition();
      },
      onUpdateLiveLoopPoints: (startFrame, endFrame, sampleRate, loopEnabled) => {
        this.core.updateLiveLoopPoints(startFrame, endFrame, sampleRate, loopEnabled);
      },
      isAuditionPlaying: () => this.core.getRealtimeSpectrum().isPlaying,
    });

    // 3b. Spectral & A/B/C Resynthesis Monitor + Fase 13 Loop Editor
    this.spectralView = new SpectralView(spectralMount, {
      onAuditionZone: (zoneId, mode) => {
        const modeLabel =
          mode === 'original'
            ? 'A: Original'
            : mode === 'enhanced'
              ? 'C: Enhanced DSP'
              : 'B: Legacy DSP';
        this.telemetryDrawer.addLog(`A/B/C Audition [${modeLabel}] on zone ${zoneId}`);
        void this.core.auditionZoneComparison(zoneId, mode);
      },
      onStopAudition: () => {
        this.core.stopAudition();
      },
      onKeyboardModeChange: (mode) => {
        const modeLabel =
          mode === 'original'
            ? 'A: Original Sample'
            : mode === 'enhanced'
              ? 'C: Enhanced DSP Resynthesis'
              : 'B: Legacy DSP Resynthesis';
        this.telemetryDrawer.addLog(`Keyboard audition mode switched to ${modeLabel}`);
      },
      getRealtimeSpectrum: () => this.core.getRealtimeSpectrum(),
      getLoopEditorData: () => {
        const activeZone = this.getActiveZone();
        const activeRegId = this.inspector.getSelectedRegionId() ?? undefined;
        return this.core.getZoneLoopEditorData(activeZone?.id, activeRegId);
      },
      onUpdateLoopParams: async (changes) => {
        const regions = this.core.getExtendedRegions();
        const targetRegId =
          this.inspector.getSelectedRegionId() ?? regions[0]?.id;
        if (targetRegId) {
          await this.core.updateExtendedRegion(targetRegId, {
            ...(changes.loopMode !== undefined ? { loopMode: changes.loopMode, hasPlaybackOverride: true } : {}),
            ...(changes.loopStart !== undefined ? { loopStart: changes.loopStart } : {}),
            ...(changes.loopEnd !== undefined ? { loopEnd: changes.loopEnd } : {}),
            ...(changes.loopCrossfadeMs !== undefined ? { loopCrossfadeMs: changes.loopCrossfadeMs } : {}),
          });
          this.session = this.core.getSession()!;
          const errors = this.core.validateCoverage();
          this.navbar.updateSession(this.session, errors);
        }
      },
      onAuditionLoop: (opts) => {
        const activeZone = this.getActiveZone();
        if (!activeZone) return;
        const activeRegId = this.inspector.getSelectedRegionId() ?? undefined;
        void this.core.auditionLoop(activeZone.id, {
          regionId: activeRegId,
          loopStartFrame: opts.loopStartFrame,
          loopEndFrame: opts.loopEndFrame,
          loopEnabled: opts.loopEnabled,
        });
      },
      onUpdateLiveLoopPoints: (startFrame, endFrame, sampleRate, loopEnabled) => {
        this.core.updateLiveLoopPoints(startFrame, endFrame, sampleRate, loopEnabled);
      },
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
        onStartProcess: () => this.handleStartProcess(),
        onAutoDetectParameterSet: () => {
          const active = this.getActiveZone();
          const res = this.core.autoDetectZonePitchAndParameterSet(active?.id, true);
          if (res) {
            this.session = this.core.getSession()!;
            const pSetInfo = this.core.getParameterSets().find((p) => p.id === res.recommendedParameterSet);
            const pSetName = pSetInfo?.name ?? `Set ${res.recommendedParameterSet}`;
            this.telemetryDrawer.addLog(
              `Auto-detected Parameter Set: #${res.recommendedParameterSet} (${pSetName}) [${res.detectedCategory}] — ${res.rationale}`
            );
            toast(
              `Auto-selected Set #${res.recommendedParameterSet}: ${pSetName} (${res.detectedCategory})`,
              'success'
            );
            this.refreshUI();
          } else {
            toast('Load at least one audio sample to auto-detect Parameter Set.', 'warning');
          }
        },
        onSelectCoverImage: (file) => {
          void this.handleCoverImageUpload(file);
        },
        onRemoveCoverImage: () => {
          this.session = this.core.setModelCoverArtwork(null);
          this.telemetryDrawer.addLog('Removed Extended Model Cover Artwork (.webp).');
          toast('Removed model cover artwork.', 'info');
          this.refreshUI();
        },
      },
      {
        errors: this.core.validateCoverage(),
        zones: this.session!.zones
      }
    );

    // 5. Keyboard Strip
    this.keyboard = new KeyboardStrip(keyboardMount, {
      onNotePress: (note, velocity) => {
        if (!this.session) return;
        const isExtended = this.session.processConfig.workingMode === 'extended';
        // Resolve which row(s)/sample this note + velocity triggers (mode-specific tables)
        const targets = isExtended
          ? resolveExtendedNoteTargets(this.core.getExtendedRegions(), note, velocity)
          : resolveClassicNoteTargets(this.session.zones, note, velocity);
        // Find zone covering this note, select it, and audition at `note` pitch
        const found = this.session.zones.find((z) => note >= z.lowKey && note <= z.highKey);
        this.inspector.highlightNote(note, {
          zoneId: targets.zoneId ?? found?.id,
          layer: targets.layer,
          regionIds: targets.regionIds,
        });
        if (found) {
          if (found.id !== this.selectedZoneId) {
            this.selectedZoneId = found.id;
            this.ribbon.setActiveZone(found.id);
            this.inspector.setZone(found, this.getActiveZoneIndex(), this.session.zones.length, this.session.zones, this.session.processConfig.workingMode);
            this.keyboard.setActiveZone(found);
            this.updateSpectralView(found);
          }
          const kbMode = this.spectralView.getKeyboardMode();
          const override =
            targets.sampleName !== undefined
              ? { sampleName: targets.sampleName, rootKey: targets.rootKey ?? found.rootKey }
              : undefined;
          void this.core.auditionZoneComparison(found.id, kbMode, note, override);
          this.spectralView.notifyPlaybackStarted();
        }
      },
      onNoteRelease: (note) => {
        this.inspector.releaseNote(note);
      }
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
      // Model chosen for loading: restart the whole editor session from
      // the bank record (name, config, zones, resynthesized samples).
      onSelectModel: async (slot) => {
        if (this.session?.dirty) {
          const proceed = await confirmDialog(
            `Loading Model #${slot} replaces the current session (unsaved changes will be kept in Undo history).`,
            { confirmLabel: 'Load model', cancelLabel: 'Cancel' }
          );
          if (!proceed) return;
        }
        try {
          this.session = await this.core.loadBankModel(slot);
          this.selectedZoneId = this.session.zones[0]?.id ?? null;
          const errors = this.core.validateCoverage();
          this.processPanel.setConfig(this.session.processConfig, {
            errors,
            zones: this.session.zones,
          });
          this.navbar.updateSession(this.session, errors);
          this.bankDrawer.setSelectedSlot(slot);
          this.telemetryDrawer.addLog(
            `Loaded Model #${String(slot).padStart(3, '0')} '${this.session.name}' from bank (${this.session.zones.length} zone(s)).`
          );
          toast(`Loaded Model #${slot} '${this.session.name}'`, 'success');
          this.bankDrawer.close();
          this.refreshUI();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.telemetryDrawer.addLog(`Load model #${slot} failed: ${msg}`);
          toast(`Failed to load Model #${slot}: ${msg}`, 'error');
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
      // Library entries live in the folder scan (owned by ImportHandlers).
      onRequestLibrary: () => this.imports.getLibraryEntries(),
      // Refresh rescans the last configured folder without a picker.
      onRefreshLibrary: () => this.imports.refreshNeuronDbFolder(),
      onPickLibrary: (slot) => this.imports.pickLibraryModel(slot),
    },
    // NeuModMakr serves models + library; presets belong to the synth host.
    { visibleTabs: ['models', 'library'] });

    this.processModal = new ProcessModal(modalsMount, {
      onCancel: () => this.core.cancelProcess(),
      onClose: () => this.navbar.setProcessing(false)
    });

    this.navbar.mount(this.session!, this.core.validateCoverage());
    this.menus.bindKeyboardShortcuts();
    this.imports.bindGlobalDragAndDrop();
    this.menus.bindUnsavedChangesGuard();
  }

  private async handleCoverImageUpload(file: File): Promise<void> {
    try {
      if (this.session && this.session.processConfig.workingMode !== 'extended') {
        this.session = this.core.updateProcessConfig({ workingMode: 'extended' });
      }
      this.processPanel?.setCoverConverting(true, file.name);
      // Yield one frame so the converting spinner and message render visibly
      await new Promise<void>((resolve) => setTimeout(resolve, 60));

      const art = await this.core.convertAndSetModelCoverArtwork(file, file.name);
      this.session = this.core.getSession()!;
      this.processPanel?.setCoverConverting(false);
      const kb = (art.byteLength / 1024).toFixed(1);
      this.telemetryDrawer.addLog(
        `Cover Artwork converted to WebP: ${art.width}×${art.height} (${kb} KB) from "${file.name}" -> 05_extended_model/cover.webp`
      );
      toast(
        `Cover converted to .webp (${art.width}×${art.height}, ${kb} KB)`,
        'success'
      );
      this.refreshUI();
    } catch (err) {
      this.processPanel?.setCoverConverting(false);
      toast(
        `Failed to convert cover image: ${err instanceof Error ? err.message : String(err)}`,
        'error'
      );
    }
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
    const extRegions = this.session.extendedRegions ?? [];
    const workingMode = this.session.processConfig.workingMode ?? 'classic';

    this.navbar.updateSession(this.session, errors);
    this.navbar.updateHistory(this.core.getHistoryState());
    this.ribbon.setZones(this.session.zones, this.selectedZoneId, extRegions, workingMode);
    this.inspector.setZone(activeZone, this.getActiveZoneIndex(), this.session.zones.length, this.session.zones, workingMode);
    this.processPanel.setConfig(this.session.processConfig, {
      errors,
      zones: this.session.zones,
    });
    this.keyboard.setZones(this.session.zones, this.selectedZoneId, extRegions, workingMode);
    this.keyboard.setActiveZone(activeZone);
    this.telemetryDrawer.updateAudit(this.session, errors);
    this.updateSpectralView(activeZone);
  }

  private toggleSpectralPanel(): void {
    this.isSpectralVisible = !this.isSpectralVisible;
    const spectralMount = document.querySelector<HTMLElement>('#spectral-mount');
    const leftStack = document.querySelector<HTMLElement>('.column-left-stack');
    if (spectralMount) {
      spectralMount.classList.toggle('is-collapsed', !this.isSpectralVisible);
    }
    if (leftStack) {
      leftStack.classList.toggle('has-spectral-open', this.isSpectralVisible);
    }
    this.inspector.setSpectralVisible(this.isSpectralVisible);
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
      // Telemetry shares its fixed slot with the Bank drawer: move Bank
      // aside so the audit (not Bank) is what the user sees.
      this.bankDrawer.close();
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
