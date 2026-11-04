// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Application Entry Point
// Assembles UI with WebAudioPipeline and ABDShared design system
// ─────────────────────────────────────────────────────────

import './style.css';

import {
  createCoreService,
  DEFAULT_MASTER_WAVE_CONFIG,
  DEFAULT_AI_ASSISTANCE_CONFIG,
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
import { resolveClassicNoteTargets, resolveExtendedNoteTargets, resolveRowAuditionSpan } from './core/noteMapping';
import { ProcessModal } from './ui/ProcessModal';
import { TelemetryDrawer } from './ui/TelemetryDrawer';
import { BankDrawer } from './ui/BankDrawer';
import { SpectralView } from './ui/SpectralView';
import { NeuronDbModal } from './ui/NeuronDbModal';
import { SettingsModal } from './ui/SettingsModal';
import { BatchProcessorModal } from './ui/BatchProcessorModal';
import { ModelConfigModal } from './ui/ModelConfigModal';
import { AiCoverGeneratorModal } from './ui/AiCoverGeneratorModal';
import { AudioChopperModal } from './ui/AudioChopperModal';
import { AudioRecorderModal } from './ui/AudioRecorderModal.ts';
import { LoopEditorModal } from './ui/LoopEditorModal';
import { RawSamplerExportModal } from './ui/RawSamplerExportModal';
import { ExportDestinationModal } from './ui/ExportDestinationModal';
import { UniversalImportModal } from './ui/UniversalImportModal';
import { MusicianWizardModal } from './ui/MusicianWizardModal';
import { ConfigHealthModal } from './ui/ConfigHealthModal';
import { evaluateConfigHealth, STORAGE_KEY_CONFIG_HEALTH_ON_BOOT } from './core/configHealth';
import { computeBatchAutoLoopForZones, type BatchAutoLoopItemInput } from './core/dsp/LoopEditorTools';
import { decodeWav } from './core/dsp/WavDecoder';
import { withLoading } from './ui/LoadingModal';
import { bridgeClient, type AxionikDbModelEntry } from './core/bridge/BridgeClient';
import { yieldToUI } from './core/asyncUtils.ts';
import { formatKb } from './core/pathUtils.ts';
import { createUniqueModelSlug } from './core/modelSlug';
import { confirmDialog, toast } from './ui/notify';
import { pwaManager } from './app/pwa';

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
  private settingsModal!: SettingsModal;
  private batchModal!: BatchProcessorModal;
  private modelConfigModal!: ModelConfigModal;
  private aiCoverModal!: AiCoverGeneratorModal;
  private audioChopperModal!: AudioChopperModal;
  private audioRecorderModal!: AudioRecorderModal;
  private loopEditorModal!: LoopEditorModal;
  private rawSamplerExportModal!: RawSamplerExportModal;
  private exportDestinationModal!: ExportDestinationModal;
  private universalImportModal!: UniversalImportModal;
  private musicianWizardModal!: MusicianWizardModal;
  private configHealthModal!: ConfigHealthModal;
  private imports: ImportHandlers;
  private menus: MenuActions;
  private axionikModels: AxionikDbModelEntry[] = [];
  private sublibraries: import('./core/types').SublibraryInfo[] = [];
  private auditionPcmSourceNode: AudioBufferSourceNode | null = null;
  private auditionAudioContext: AudioContext | null = null;

  constructor() {
    const self = this;
    this.modelConfigModal = new ModelConfigModal({
      getConfig: () => self.session?.processConfig ?? self.core.getSession()!.processConfig,
      onConfigChange: (cfg) => {
        if (!self.session) return;
        self.session = self.core.updateProcessConfig(cfg);
        const errors = self.core.validateCoverage();
        self.navbar.updateSession(self.session, errors, bridgeClient.isConnected());
        self.processPanel.setConfig(self.session.processConfig);
        self.inspector.setZone(
          self.getActiveZone(),
          self.getActiveZoneIndex(),
          self.session.zones.length,
          self.session.zones,
          self.session.processConfig.workingMode,
          self.session.processConfig.keyMappingMode
        );
        self.updateSpectralView(self.getActiveZone());
      },
      getParameterSets: () => self.core.getParameterSets(),
      getSublibraries: () => self.sublibraries,
      onCreateSublibrary: async (name: string) => {
        await self.core.createSublibrary(name);
        await self.refreshAxionikModels();
      },
      onSelectCoverImage: (file) => {
        void self.handleCoverImageUpload(file);
      },
      onRemoveCoverImage: () => {
        if (!self.session) return;
        self.session = self.core.setModelCoverArtwork(null);
        toast('Removed model cover artwork.', 'info');
        self.refreshUI();
        self.modelConfigModal.updateConfig();
      },
      onReprocessFromPurestSource: async () => {
        const prov = await self.core.reprocessFromPurestSource();
        self.session = self.core.getSession()!;
        self.telemetryDrawer.addLog(
          `Time Capsule Reprocess #${prov.reprocessCount}: Purest origin=${prov.primarySourceLayer} -> activeInput=${prov.activeAnalysisSourceLayer}.`
        );
        toast('Reprocessed from purest acoustic source (0 Generation-Loss)', 'success');
        self.refreshUI();
        self.modelConfigModal.updateConfig();
      },
      onOpenAiCoverGenerator: () => {
        self.aiCoverModal.open();
      },
      getSessionResynatorV2Stereo: (midiNote, velocity, hostBpm) => {
        if (!self.session || self.session.zones.length === 0) return undefined;
        const found =
          self.session.zones.find((z) => midiNote >= z.lowKey && midiNote <= z.highKey) ??
          self.getActiveZone() ??
          self.session.zones[0];
        if (!found) return undefined;
        return self.core.synthesizeZoneResynatorV2?.(found.id, midiNote, velocity, hostBpm);
      },
    });

    this.aiCoverModal = new AiCoverGeneratorModal({
      getConfig: () => self.session?.processConfig ?? self.core.getSession()!.processConfig,
      getSampleNames: () => {
        if (!self.session) return [];
        const names = new Set<string>();
        for (const z of self.session.zones) {
          if (z.sampleLow) names.add(z.sampleLow);
          if (z.sampleHigh) names.add(z.sampleHigh);
        }
        return Array.from(names);
      },
      onApplyCover: (artwork) => {
        if (!self.session) return;
        self.session = self.core.setModelCoverArtwork(artwork);
        self.telemetryDrawer.addLog(
          `AI Cover: Attached 512×512 WebP artwork to model "${self.session.processConfig.modelName}".`
        );
        self.refreshUI();
        self.modelConfigModal.updateConfig();
      },
      onOpenSettings: () => {
        self.settingsModal.open();
      },
    });

    this.audioChopperModal = new AudioChopperModal({
      getCurrentWorkingMode: () => self.session?.processConfig.workingMode ?? 'classic',
      onInjectClassicZones: (zones, audioSamples) => {
        if (!self.session) return;
        for (const sample of audioSamples) {
          self.core.registerSampleBuffer(sample.name, sample.buffer);
        }
        self.session.zones = zones;
        self.selectedZoneId = zones[0]?.id ?? null;
        self.telemetryDrawer.addLog(`AutoSlicer: Injected ${zones.length} sliced zones into session.`);
        toast(`Injected ${zones.length} sliced zones into session.`, 'success');
        self.refreshUI();
      },
      onInjectExtendedRegions: (regions, audioSamples) => {
        if (!self.session) return;
        for (const sample of audioSamples) {
          self.core.registerSampleBuffer(sample.name, sample.buffer);
        }
        self.session.extendedRegions = regions;
        self.selectedZoneId = regions[0]?.id ?? null;
        self.telemetryDrawer.addLog(`AutoSlicer: Injected ${regions.length} sliced 2D regions into session.`);
        toast(`Injected ${regions.length} sliced regions into session.`, 'success');
        self.refreshUI();
      },
      onUpdateTempoSync: (tempoSync) => {
        if (!self.session) return;
        const prevSurf = self.session.processConfig.unifiedSurfaceConfig ?? {};
        self.session = self.core.updateProcessConfig({
          unifiedSurfaceConfig: {
            ...prevSurf,
            tempoSync: { ...tempoSync },
          },
        });
        self.telemetryDrawer.addLog(
          `AutoSlicer: Stored Resinator v2 Tempo-Sync contract (sourceBpm=${tempoSync.sourceBpm}, targetBpm=${tempoSync.targetBpm ?? tempoSync.sourceBpm}, bars=${tempoSync.barCount}, mode=${tempoSync.grooveMode}).`
        );
      },
      onAuditionPcm: (pcm, sRate) => {
        self.playAuditionPcm(pcm, sRate);
      },
      onStopAudition: () => {
        self.stopAuditionPcm();
      },
    });

    this.audioRecorderModal = new AudioRecorderModal({
      getAiConfig: () => self.session?.processConfig.aiConfig ?? DEFAULT_AI_ASSISTANCE_CONFIG,
      onAuditionPcm: (pcm, sRate) => {
        self.playAuditionPcm(pcm, sRate);
      },
      onStopAudition: () => {
        self.stopAuditionPcm();
      },
      onSendToChopper: (wavBytes, filename) => {
        self.audioChopperModal.openWithAudioBuffer(wavBytes, filename);
      },
      onInjectTakeIntoSession: (wavBytes, filename) => {
        const activeZone = self.getActiveZone();
        if (!activeZone || !self.session) return;
        const file = new File([wavBytes], filename, { type: 'audio/wav' });
        void self.imports.loadSampleFileIntoZone(activeZone.id, 'low', file);
        toast(`Injected "${filename}" into active zone [${activeZone.id}].`, 'success');
      },
      onInjectAutoSampledInstrument: (payload) => {
        if (!self.session) return;
        for (const [name, buf] of payload.audioBuffers.entries()) {
          self.core.registerSampleBuffer(name, buf);
        }
        if (payload.classicZones.length > 0) {
          self.session.zones = payload.classicZones;
          self.selectedZoneId = payload.classicZones[0]?.id ?? null;
        }
        if (payload.extendedRegions.length > 0) {
          self.session.extendedRegions = payload.extendedRegions;
        }
        if (payload.modelName && payload.modelName.trim()) {
          self.session.processConfig.modelName = payload.modelName.trim().slice(0, 32);
        }
        self.telemetryDrawer.addLog(
          `AutoSampler MIDI: Injected ${payload.classicZones.length} zones (${payload.extendedRegions.length} velocity/RR regions) into session.`
        );
        toast(
          `AutoSampler MIDI: Injected ${payload.classicZones.length} zones (${payload.extendedRegions.length} regions) into session.`,
          'success'
        );
        self.refreshUI();
      },
    });

    this.loopEditorModal = new LoopEditorModal({
      getLoopEditorData: (zoneId, regionId) => {
        const isExtended = self.session?.processConfig.workingMode === 'extended';
        const zId = zoneId ?? self.getActiveZone()?.id;
        const rId = isExtended ? (regionId ?? self.inspector?.getSelectedRegionId() ?? undefined) : undefined;
        return self.core.getZoneLoopEditorData(zId, rId);
      },
      onUpdateLoopParams: async (changes) => {
        const isExtended = self.session?.processConfig.workingMode === 'extended';
        const targetZoneId = changes.zoneId ?? self.getActiveZone()?.id;
        const targetRegId = changes.regionId ?? (isExtended ? self.inspector?.getSelectedRegionId() ?? undefined : undefined);

        if (isExtended && targetRegId) {
          await self.core.updateExtendedRegion(targetRegId, {
            ...(changes.loopMode !== undefined ? { loopMode: changes.loopMode, hasPlaybackOverride: true } : {}),
            ...(changes.loopStart !== undefined ? { loopStart: changes.loopStart } : {}),
            ...(changes.loopEnd !== undefined ? { loopEnd: changes.loopEnd } : {}),
            ...(changes.loopCrossfadeMs !== undefined ? { loopCrossfadeMs: changes.loopCrossfadeMs } : {}),
          });
        } else if (targetZoneId) {
          const regions = self.core.getExtendedRegions();
          const reg = (targetRegId ? regions.find((r) => r.id === targetRegId) : null) ?? regions[0];
          if (reg) {
            await self.core.updateExtendedRegion(reg.id, {
              ...(changes.loopMode !== undefined ? { loopMode: changes.loopMode, hasPlaybackOverride: true } : {}),
              ...(changes.loopStart !== undefined ? { loopStart: changes.loopStart } : {}),
              ...(changes.loopEnd !== undefined ? { loopEnd: changes.loopEnd } : {}),
              ...(changes.loopCrossfadeMs !== undefined ? { loopCrossfadeMs: changes.loopCrossfadeMs } : {}),
            });
          }
        }
        self.session = self.core.getSession()!;
        self.refreshUI();
      },
      onAuditionLoop: (opts) => {
        const isExtended = self.session?.processConfig.workingMode === 'extended';
        const zId = opts.zoneId ?? self.getActiveZone()?.id;
        const rId = isExtended ? (opts.regionId ?? self.inspector?.getSelectedRegionId() ?? undefined) : undefined;
        if (!zId) return;
        void self.core.auditionLoop(zId, {
          regionId: rId,
          loopStartFrame: opts.loopStartFrame,
          loopEndFrame: opts.loopEndFrame,
          loopEnabled: opts.loopEnabled,
        });
        self.spectralView?.notifyPlaybackStarted();
      },
      onStopAudition: () => {
        self.core.stopAudition();
      },
      onUpdateLiveLoopPoints: (start, end, rate, enabled) => {
        self.core.updateLiveLoopPoints(start, end, rate, enabled);
      },
      onRegisterSampleBuffer: (name, buffer) => {
        self.core.registerSampleBuffer(name, buffer);
      },
      isAuditionPlaying: () => self.core.getRealtimeSpectrum().isPlaying,
    });

    this.rawSamplerExportModal = new RawSamplerExportModal({
      core: self.core,
      onExportSuccess: (filename, totalBytes) => {
        self.telemetryDrawer.addLog(`Exported raw sampler library: ${filename} (${totalBytes} bytes).`);
      },
      onBack: () => {
        self.exportDestinationModal.open('other-samplers');
      },
    });

    this.exportDestinationModal = new ExportDestinationModal({
      getSessionContext: () => {
        const s = self.session ?? self.core.getSession()!;
        const active = self.getActiveZone();
        return {
          modelName: s.processConfig.modelName || s.name || 'Init Model',
          expandedName: s.processConfig.expandedName || s.processConfig.modelName || s.name || 'Init Model',
          slot: s.processConfig.modelNumber ?? 1,
          workingMode: s.processConfig.workingMode ?? 'classic',
          zoneCount: s.zones.length,
          regionCount: self.core.getExtendedRegions().length,
          hasActiveZoneSample: Boolean(active?.sampleLow || active?.sampleHigh),
        };
      },
      onExportTimeCapsule: () => self.menus.exportModel(),
      onExportTimeCapsuleAs: () => self.menus.exportModelAs(),
      onSaveToAxionikDb: () => self.menus.saveToAxionikDb(),
      onExportSampler: (fmt) => self.rawSamplerExportModal.open(fmt),
      onExportZoneAiff: () => self.menus.exportZoneAiff(),
    });

    this.universalImportModal = new UniversalImportModal({
      getCurrentWorkingMode: () => self.session?.processConfig.workingMode ?? 'classic',
      onInjectBank: (data) => {
        if (!self.session) return;
        for (const [name, buf] of data.audioBuffers.entries()) {
          self.core.registerSampleBuffer(name, buf);
        }
        const fullExpandedName = (data.presetName || data.modelName || 'SamplerModel').trim();
        const classicShortName = (data.modelName || fullExpandedName).trim().slice(0, 11) || 'UNTITLED';
        const isDrumPreset = /drum|kit|perc/i.test(data.category || '');
        self.session.name = fullExpandedName;
        self.session.processConfig.modelName = classicShortName;
        self.session.processConfig.expandedName = fullExpandedName;
        self.session.processConfig.parameterSet = data.parameterSet;
        self.session.processConfig.workingMode = data.workingMode;
        self.session.processConfig.keyMappingMode = isDrumPreset ? 'drum' : 'chromatic';
        self.session.processConfig.extendedMetadata = {
          ...self.session.processConfig.extendedMetadata,
          category: data.category,
          instrumentFamily: data.category,
        };
        self.session.detectedInstrumentCategory = data.category;
        self.session.zones = data.classicZones;
        self.session.extendedRegions = data.extendedRegions;
        self.session.dirty = true;
        self.selectedZoneId = data.classicZones[0]?.id ?? null;
        self.telemetryDrawer.addLog(
          `Universal Import: Injected bank "${fullExpandedName}" (Classic MName: "${classicShortName}", ${data.classicZones.length} zones, mode: ${data.workingMode}, category: ${data.category}, Set #${data.parameterSet}).`
        );
        self.refreshUI();
      },
      onOpenInAudioChopper: (audioBuf, filename, sliceFrames) => {
        self.audioChopperModal.openWithAudioBuffer(audioBuf, filename, sliceFrames);
      },
      onImportRawAudioFiles: (files) => {
        // FileList | File[] – cast to FileList (importMixedFilesOrZip iterates by index)
        void self.imports.importMixedFilesOrZip(files as FileList, 'audio', 'samples', 'Universal Import');
      },
      onOpenBatchProcessorWithFiles: (files, originTitle) => {
        void self.batchModal.loadExpandedFiles(files, originTitle);
      },
      onOpenBatchProcessor: () => {
        self.batchModal.open();
      },
      onBrowseFolder: () => {
        self.imports.triggerFolderImport();
      },
      onDropDirectoryHandle: (dirHandle) => {
        void self.imports.importFromDirectoryHandle(dirHandle, 'audio');
      },
      onImportFolderFileList: (files) => {
        void self.imports.importFromWebkitFileList(files, 'audio');
      },
    });

    this.configHealthModal = new ConfigHealthModal({
      onOpenSettings: (tab) => {
        self.settingsModal.open(tab, self.session?.processConfig.aiConfig ?? DEFAULT_AI_ASSISTANCE_CONFIG);
      },
    });

    this.musicianWizardModal = new MusicianWizardModal({
      getCurrentProcessConfig: () =>
        self.session?.processConfig ?? self.core.getSession()!.processConfig,
      getCurrentWorkingMode: () => self.session?.processConfig.workingMode ?? 'classic',
      getParameterSets: () => self.core.getParameterSets(),
      getActiveSessionAudio: () => {
        const s = self.session ?? self.core.getSession();
        if (!s) return { hasAudio: false, zoneCount: 0 };
        const active = self.getActiveZone();
        const loopData = active ? self.core.getZoneLoopEditorData(active.id) : null;
        return {
          hasAudio: Boolean(loopData && loopData.monoPcm.length > 0),
          zoneCount: s.zones.length,
          sampleName: loopData?.sampleName,
          pcm: loopData?.monoPcm,
          sampleRate: loopData?.sampleRate,
        };
      },
      getZoneSlotAudio: (zoneId, slot = 'low', regionId) => {
        const s = self.session ?? self.core.getSession();
        if (!s) return null;
        const targetZone = (zoneId ? s.zones.find((z) => z.id === zoneId) : null) ?? self.getActiveZone();
        const extRegs = self.core.getExtendedRegions();
        const targetReg = regionId ? extRegs.find((r) => r.id === regionId) : undefined;
        const sampleName =
          targetReg?.sampleName ||
          (slot === 'high' ? targetZone?.sampleHigh : targetZone?.sampleLow) ||
          targetZone?.sampleLow ||
          targetZone?.sampleHigh;
        if (sampleName) {
          const buf = self.core.getSampleBuffer(sampleName);
          if (buf) {
            try {
              const dec = decodeWav(buf);
              if (dec.mono && dec.mono.length > 0) {
                return {
                  hasAudio: true,
                  sampleName,
                  pcm: dec.mono,
                  sampleRate: dec.sampleRate,
                };
              }
            } catch {
              // fall back to getZoneLoopEditorData below
            }
          }
        }
        const loopData = self.core.getZoneLoopEditorData(targetZone?.id, regionId);
        if (!loopData || loopData.monoPcm.length === 0) return null;
        return {
          hasAudio: true,
          sampleName: loopData.sampleName,
          pcm: loopData.monoPcm,
          sampleRate: loopData.sampleRate,
        };
      },
      onAuditionPcm: (pcm, sr) => self.playAuditionPcm(pcm, sr),
      onStopAudition: () => self.stopAuditionPcm(),
      onCommitWizardInstrument: (payload) => {
        if (!self.session) return;
        for (const [name, buf] of payload.audioBuffers.entries()) {
          self.core.registerSampleBuffer(name, buf);
        }
        self.session.name = payload.modelName;
        self.session.processConfig.modelName = payload.modelName;
        self.session.processConfig.expandedName = payload.expandedName;
        self.session.processConfig.parameterSet = payload.parameterSet;
        self.session.processConfig.workingMode = payload.workingMode;
        self.session.zones = payload.classicZones;
        self.session.extendedRegions = payload.extendedRegions;
        self.session.dirty = true;
        self.selectedZoneId = payload.classicZones[0]?.id ?? null;
        self.telemetryDrawer.addLog(
          `Asistente Guiado: Preparado "${payload.expandedName}" (${payload.classicZones.length} zonas, modo ${payload.workingMode}, Set #${payload.parameterSet}).`
        );
        self.refreshUI();
      },
      onStartProcessModel: () => {
        void self.handleStartProcess();
      },
      onExportTimeCapsule: () => self.menus.exportModel(),
      onExportTimeCapsuleAs: () => self.menus.exportModelAs(),
      onSaveToAxionikDb: () => self.menus.saveToAxionikDb(),
      onExportSampler: (fmt) => self.rawSamplerExportModal.open(fmt),
      onExportZoneAiff: () => self.menus.exportZoneAiff(),
      onOpenAdvancedRecorder: () => self.audioRecorderModal.open(),
      onOpenAdvancedUniversalImport: () => self.universalImportModal.open(),
      onOpenAdvancedChopper: (wav, name) => {
        if (wav && name) {
          self.audioChopperModal.openWithAudioBuffer(wav, name);
        } else {
          void self.openAudioChopper();
        }
      },
      onOpenAdvancedLoopEditor: () => self.openLoopEditor(),
      onOpenAdvancedModelConfig: () => self.modelConfigModal.open('general'),
      onOpenBatchProcessorWithFiles: (files, originTitle) => {
        void self.batchModal.loadExpandedFiles(files, originTitle);
      },
      onOpenBatchProcessor: () => self.batchModal.open(),
    });

    this.settingsModal = new SettingsModal({
      onUpdateAiConfig: (config) => {
        if (!self.session) return;
        self.session = self.core.updateProcessConfig({ aiConfig: config });
        self.refreshUI();
      },
      onSelectThemeFamily: (family) => {
        self.setThemeFamily(family);
      },
      onSetThemeMode: (mode) => {
        self.setThemeMode(mode);
      },
      getCurrentThemeFamily: () => self.themeFamilies[self.currentFamilyIndex],
      getCurrentThemeMode: () => self.currentThemeMode,
      getCurrentWorkingMode: () => self.session?.processConfig.workingMode ?? 'classic',
    });

    this.batchModal = new BatchProcessorModal({
      getCurrentProcessConfig: () =>
        self.session?.processConfig ?? {
          modelNumber: 1,
          modelName: 'Batch',
          complexity: 8,
          parameterSet: 0,
          targetFormat: 'dual',
          dspAlgorithm: 'legacy',
          workingMode: 'extended',
        },
      getCurrentWorkingMode: () => self.session?.processConfig.workingMode ?? 'classic',
      getAiEngineStatusLabel: () => {
        if (bridgeClient.isConnected()) return 'Local Companion Bridge (FastAPI / CUDA GPU)';
        return 'Web Worker DSP & In-Browser Additive Engine';
      },
      getActiveSession: () => self.session ?? self.core.getSession(),
      inspectProcessSources: () => self.core.inspectProcessSources(),
      getLoadedSampleNames: () => self.core.getLoadedSampleNames(),
      validateCoverage: () => self.core.validateCoverage(),
      onOpenAiSettings: () => {
        self.settingsModal.open(
          'web',
          self.session?.processConfig.aiConfig ?? DEFAULT_AI_ASSISTANCE_CONFIG
        );
      },
      onStartSingleModelProcess: async (config, options) => {
        await self.executeSingleModelProcess(config, options);
      },
      onRefreshBankDrawer: () => {
        void self.refreshAxionikModels();
      },
    });

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
      onOpenBatchProcessorWithSf2: (buffer: ArrayBuffer, fileName: string) => {
        self.batchModal.loadSf2Buffer(buffer, fileName);
      },
      // Fase 35 — triage gate delivers pre-mapped candidates straight to preflight.
      onOpenBatchProcessorWithCandidates: (candidates, originTitle) => {
        self.batchModal.loadCandidates(candidates, originTitle);
      },
      onOpenBatchProcessorWithFiles: (files, originTitle) => {
        void self.batchModal.loadExpandedFiles(files, originTitle);
      },
      onOpenBatchProcessor: () => {
        self.batchModal.open();
      },
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
      openSettingsModal: (tab) => self.settingsModal.open(tab ?? 'general', self.session?.processConfig.aiConfig ?? DEFAULT_AI_ASSISTANCE_CONFIG),
      openAiEngineModal: () => self.settingsModal.open('web', self.session?.processConfig.aiConfig ?? DEFAULT_AI_ASSISTANCE_CONFIG),
      openBridgeModal: () => self.settingsModal.open('bridge', self.session?.processConfig.aiConfig ?? DEFAULT_AI_ASSISTANCE_CONFIG),
      toggleAiAssistance: () => self.handleToggleAiAssistance(),
      selectThemeFamily: (family: string) => self.setThemeFamily(family),
      cycleThemeFamily: () => self.cycleThemeFamily(),
      setThemeMode: (mode: 'light' | 'dark') => self.setThemeMode(mode),
      toggleThemeMode: () => self.toggleThemeMode(),
      openBatchModal: () => self.batchModal.open(),
      openMusicianWizard: () => self.musicianWizardModal.open(),
      openModelConfig: (tab) => self.modelConfigModal.open(tab),
      openAiCoverGenerator: () => self.aiCoverModal.open(),
      openAudioChopper: () => void self.openAudioChopper(),
      openAudioRecorder: () => self.audioRecorderModal.open(),
      openLoopEditor: () => self.openLoopEditor(),
      autoLoopAllZones: () => void self.handleAutoLoopAllZones(),
      openRawSamplerExport: (fmt) => self.rawSamplerExportModal.open(fmt),
      openExportDestinationModal: () => self.exportDestinationModal.open(),
      openUniversalImportModal: () => self.universalImportModal.open(),
      openConfigHealthModal: () => self.configHealthModal.open(),
    });
  }

  // Hardware Theme Families and Appearance Mode (Default: Hartmann Neuron Claro)
  private themeFamilies = ['neuron', 'virus-snow', 'audiolab', 'ms2000', 'advanced', 'cz101'] as const;
  private currentFamilyIndex = 0; // 'neuron'
  private currentThemeMode: 'light' | 'dark' = 'light';

  private loadThemePreferences(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const savedFamily = localStorage.getItem('nmm_theme_family');
      if (savedFamily) {
        const idx = (this.themeFamilies as readonly string[]).indexOf(savedFamily);
        if (idx >= 0) this.currentFamilyIndex = idx;
      }
      const savedMode = localStorage.getItem('nmm_theme_mode');
      if (savedMode === 'light' || savedMode === 'dark') {
        this.currentThemeMode = savedMode;
      }
    } catch {
      // safe fallback
    }
  }

  private saveThemePreferences(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem('nmm_theme_family', this.themeFamilies[this.currentFamilyIndex]);
      localStorage.setItem('nmm_theme_mode', this.currentThemeMode);
    } catch {
      // ignore
    }
  }

  public resolveActiveTheme(): string {
    const family = this.themeFamilies[this.currentFamilyIndex];
    if (family === 'neuron') return this.currentThemeMode === 'light' ? 'neuron-light' : 'neuron-dark';
    if (family === 'virus-snow') return this.currentThemeMode === 'light' ? 'virus-snow' : 'virus-snow-dark';
    if (family === 'audiolab') return this.currentThemeMode === 'light' ? 'audiolab-light' : 'audiolab';
    if (family === 'ms2000') return this.currentThemeMode === 'light' ? 'ms2000-light' : 'ms2000';
    if (family === 'advanced') return this.currentThemeMode === 'light' ? 'advanced-light' : 'advanced';
    if (family === 'cz101') return this.currentThemeMode === 'light' ? 'cz101-light' : 'cz101';
    return 'neuron-light';
  }

  public setThemeFamily(family: string): void {
    const idx = (this.themeFamilies as readonly string[]).indexOf(family);
    if (idx >= 0) {
      this.currentFamilyIndex = idx;
      this.applyTheme();
    }
  }

  public setThemeMode(mode: 'light' | 'dark'): void {
    this.currentThemeMode = mode;
    this.applyTheme();
  }

  public toggleThemeMode(): void {
    this.currentThemeMode = this.currentThemeMode === 'light' ? 'dark' : 'light';
    this.applyTheme();
  }

  public cycleThemeFamily(): void {
    this.currentFamilyIndex = (this.currentFamilyIndex + 1) % this.themeFamilies.length;
    this.applyTheme();
  }

  private applyTheme(): void {
    this.saveThemePreferences();
    const theme = this.resolveActiveTheme();
    document.documentElement.setAttribute('data-theme', theme);
    this.navbar?.setThemeState({
      theme,
      family: this.themeFamilies[this.currentFamilyIndex],
      mode: this.currentThemeMode,
    });
    this.spectralView?.refreshTheme();
    this.telemetryDrawer?.addLog(`Theme: ${this.themeFamilies[this.currentFamilyIndex]} (${this.currentThemeMode.toUpperCase()}) -> ${theme}`);
  }

  // Themes legacy list for index-based consumers
  private themes = [
    'neuron-light',
    'neuron-dark',
    'virus-snow',
    'virus-snow-dark',
    'audiolab',
    'audiolab-light',
    'ms2000',
    'advanced',
    'cz101',
  ];
  private currentThemeIndex = 0;
  private isSpectralVisible = false;

  public async init(): Promise<void> {
    this.loadThemePreferences();
    document.documentElement.setAttribute('data-theme', this.resolveActiveTheme());

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
    this.checkStartupConfigHealth();
  }

  private checkStartupConfigHealth(): void {
    const health = evaluateConfigHealth();
    this.navbar.updateConfigHealthBadge(health.hasMissingMandatory, health.hasMissingOptional);

    const showOnBoot =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem(STORAGE_KEY_CONFIG_HEALTH_ON_BOOT) !== 'false'
        : true;

    const alreadyShownSession =
      typeof sessionStorage !== 'undefined'
        ? sessionStorage.getItem('neumodmakr_boot_health_shown') === 'true'
        : false;

    if (health.hasMissingMandatory || (showOnBoot && !alreadyShownSession && health.hasMissingOptional)) {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem('neumodmakr_boot_health_shown', 'true');
      }
      this.configHealthModal.open();
    }
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

  private async refreshAxionikModels(): Promise<void> {
    if (!bridgeClient.isConnected()) return;
    const libPath =
      (typeof localStorage !== 'undefined'
        ? localStorage.getItem('abd_axionikdb_path')
        : null) || 'd:\\desarrollos\\ABDSynths\\AxionikDB';
    try {
      this.axionikModels = await bridgeClient.scanAxionikDb(libPath);
      this.sublibraries = await this.core.listSublibraries();
    } catch {
      // transient ignore
    }
  }

  private initSubsystems(): void {
    void this.refreshAxionikModels();
    bridgeClient.subscribe(() => {
      void this.refreshAxionikModels();
    });

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
        this.inspector.setZone(active, this.getActiveZoneIndex(), this.session!.zones.length, this.session!.zones, this.session!.processConfig.workingMode, this.session!.processConfig.keyMappingMode);
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
        if (mode === 'resynthesis') {
          const activeZone = this.getActiveZone();
          if (activeZone) {
            try {
              this.core.inspectZoneSpectrum(activeZone.id);
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
        this.inspector.setZone(active, this.getActiveZoneIndex(), this.session!.zones.length, this.session!.zones, this.session!.processConfig.workingMode, this.session!.processConfig.keyMappingMode);
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
      getZoneSampleFormatInfo: (zoneId, regionId) => this.core.getZoneSampleFormatInfo(zoneId, regionId),
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
        this.openLoopEditor();
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
      onRowAuditionChange: (row) => {
        const span =
          row && this.session
            ? resolveRowAuditionSpan(
                this.session.zones,
                this.core.getExtendedRegions(),
                this.session.processConfig.workingMode === 'extended',
                row
              )
            : null;
        this.keyboard?.setAuditionSpan(span);
        this.ribbon?.setAuditionSpan(span);
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
      getKeyMappingMode: () => this.session?.processConfig.keyMappingMode ?? 'chromatic',
      onUpdateKeyMappingMode: (mode) => {
        if (!this.session) return;
        this.session = this.core.updateProcessConfig({ keyMappingMode: mode });
        this.telemetryDrawer.addLog(`Switched Key Mapping Mode: ${mode === 'drum' ? 'General MIDI Drum Map' : 'Chromatic'}`);
        this.refreshUI();
      },
      getExtendedMetadata: () => this.session?.processConfig.extendedMetadata,
      onUpdateExtendedMetadata: (metadata) => {
        if (!this.session) return;
        this.session = this.core.updateProcessConfig({ extendedMetadata: metadata });
        this.processPanel.setConfig(this.session.processConfig);
      },
      onOpenModelConfig: (tab) => {
        this.modelConfigModal.open(tab);
      },
      onOpenAutoSlicer: () => {
        void this.openAudioChopper();
      },
      onOpenAudioRecorder: () => {
        this.audioRecorderModal.open();
      },
      onOpenWizardFromZoneSample: ({ zoneId, slot, regionId }) => {
        this.musicianWizardModal.openWithZoneSample(zoneId, slot ?? 'low', regionId);
      },
      onAutoLoopAllZones: () => {
        void this.handleAutoLoopAllZones();
      },
      getAuditionBpm: () => {
        return (
          this.session?.processConfig.unifiedSurfaceConfig?.tempoSync?.targetBpm ??
          this.session?.processConfig.unifiedSurfaceConfig?.tempoSync?.sourceBpm ??
          120
        );
      },
      onUpdateAuditionBpm: (bpm) => {
        if (!this.session) return;
        const prevSurf = this.session.processConfig.unifiedSurfaceConfig ?? {};
        const prevTempo = prevSurf.tempoSync;
        this.session = this.core.updateProcessConfig({
          unifiedSurfaceConfig: {
            ...prevSurf,
            tempoSync: {
              enabled: prevTempo?.enabled ?? false,
              sourceBpm: prevTempo?.sourceBpm ?? 120,
              targetBpm: bpm,
              barCount: prevTempo?.barCount ?? 1,
              timeSignature: [
                prevTempo?.timeSignature?.[0] ?? 4,
                prevTempo?.timeSignature?.[1] ?? 4,
              ],
              grooveMode: prevTempo?.grooveMode ?? 'slice_synced',
              sliceStartFrames: prevTempo?.sliceStartFrames ?? [0],
            },
          },
        });
        this.telemetryDrawer.addLog(`Tempo / BPM actualizado a ${bpm} BPM (sincronizado con Resinator v2 y reproductor de secuencias REX / cromáticas).`);
      },
    });

    // 3b. Spectral & A/B/C/D Resynthesis Monitor + Fase 13 Loop Editor
    this.spectralView = new SpectralView(spectralMount, {
      onAuditionZone: (zoneId, mode) => {
        const modeLabel =
          mode === 'original'
            ? 'A: Original'
            : mode === 'enhanced'
              ? 'C: Enhanced DSP'
              : mode === 'resynator_v2'
                ? 'D: Resinator v2 (ABDShared HD)'
                : 'B: Legacy DSP';
        this.telemetryDrawer.addLog(`A/B/C/D Audition [${modeLabel}] on zone ${zoneId}`);
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
              : mode === 'resynator_v2'
                ? 'D: Resinator v2 (ABDShared HD)'
                : 'B: Legacy DSP Resynthesis';
        this.telemetryDrawer.addLog(`Keyboard audition mode switched to ${modeLabel}`);
      },
      getRealtimeSpectrum: () => this.core.getRealtimeSpectrum(),
      onOpenLoopEditorModal: () => this.openLoopEditor(),
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
          this.navbar.updateSession(this.session, errors, bridgeClient.isConnected());
          this.processPanel.setValidation(errors, this.session.zones);
          // Working Mode / target format changes re-gate the inspector's
          // velSplit slider, so re-sync it with the stored session config.
          this.inspector.setZone(this.getActiveZone(), this.getActiveZoneIndex(), this.session.zones.length, this.session.zones, this.session.processConfig.workingMode, this.session.processConfig.keyMappingMode);
          this.updateSpectralView(this.getActiveZone());
          this.modelConfigModal.updateConfig();
        },
        onStartProcess: () => this.handleStartProcess(),
        onOpenMusicianWizard: () => this.musicianWizardModal.open(),
        onOpenExportDestination: () => this.exportDestinationModal.open(),
        onOpenModelConfig: (tab) => this.modelConfigModal.open(tab),
        onOpenAiCoverGenerator: () => this.aiCoverModal.open(),
        onOpenAiEngineModal: () => this.settingsModal.open('web', this.session?.processConfig.aiConfig ?? DEFAULT_AI_ASSISTANCE_CONFIG),
        onSelectCoverImage: (file) => {
          void this.handleCoverImageUpload(file);
        },
        onRemoveCoverImage: () => {
          this.session = this.core.setModelCoverArtwork(null);
          this.telemetryDrawer.addLog('Removed Extended Model Cover Artwork (.webp).');
          toast('Removed model cover artwork.', 'info');
          this.refreshUI();
          this.modelConfigModal.updateConfig();
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
        // Keyboard takes over playback: drop any table-row audition highlight
        this.inspector.clearPlayingRow();
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
            this.inspector.setZone(found, this.getActiveZoneIndex(), this.session.zones.length, this.session.zones, this.session.processConfig.workingMode, this.session.processConfig.keyMappingMode);
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
        if (this.session && this.session.processConfig.workingMode === 'extended') {
          // Check for release trigger samples (Key-Off)
          const releaseTargets = resolveExtendedNoteTargets(
            this.core.getExtendedRegions(),
            note,
            80,
            'release'
          );
          if (releaseTargets.sampleName) {
            const found = this.session.zones.find((z) => note >= z.lowKey && note <= z.highKey) ?? this.session.zones[0];
            if (found) {
              const override = {
                sampleName: releaseTargets.sampleName,
                rootKey: releaseTargets.rootKey ?? found.rootKey,
              };
              void this.core.auditionZoneComparison(found.id, 'original', note, override);
            }
          }
        }
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
          await withLoading(
            'LOADING MODEL...',
            `Loading model #${String(slot).padStart(3, '0')} from bank...`,
            async () => {
              this.session = await this.core.loadBankModel(slot);
              this.selectedZoneId = this.session.zones[0]?.id ?? null;
              const errors = this.core.validateCoverage();
              this.processPanel.setConfig(this.session.processConfig, {
                errors,
                zones: this.session.zones,
              });
              this.navbar.updateSession(this.session, errors, bridgeClient.isConnected());
              this.bankDrawer.setSelectedSlot(slot);
              this.telemetryDrawer.addLog(
                `Loaded Model #${String(slot).padStart(3, '0')} '${this.session.name}' from bank (${this.session.zones.length} zone(s)).`
              );
              toast(`Loaded Model #${slot} '${this.session.name}'`, 'success');
              this.bankDrawer.close();
              this.refreshUI();
            }
          );
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
        this.telemetryDrawer.addLog(`Exported Time Capsule #${String(slot).padStart(3, '0')} (.zip)`);
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

      // AxionikDB (Modo Avanzado)
      onRequestAxionik: () => this.axionikModels,
      onConfigureAxionikDbFolder: () => {
        this.settingsModal.open('general');
      },
      onRefreshAxionik: async () => {
        await this.refreshAxionikModels();
        return this.axionikModels.length;
      },
      onPickAxionik: async (slug: string) => {
        const item = this.axionikModels.find((m) => m.slug === slug);
        if (this.session?.dirty) {
          const proceed = await confirmDialog(
            `Loading model "${item?.name || slug}" will replace current session. Continue?`,
            { confirmLabel: 'Load Model', cancelLabel: 'Cancel' }
          );
          if (!proceed) return;
        }
        try {
          if (bridgeClient.isConnected() && item?.folderPath) {
            const scan = await bridgeClient.scanLocalFiles(item.folderPath);
            toast(`Loading model "${item.name}" from AxionikDB...`, 'info');
            this.telemetryDrawer.addLog(`Loading model "${item.name}" (${slug}) with ${scan.total_files} files.`);
          }
          this.bankDrawer.close();
        } catch (err) {
          toast(`Error loading model from AxionikDB: ${String(err)}`, 'error');
        }
      },
      onDuplicateAxionik: async (slug: string) => {
        const item = this.axionikModels.find((m) => m.slug === slug);
        const curName = item?.name || slug;
        const entered = typeof window !== 'undefined' ? window.prompt(`Copy name for "${curName}":`, `${curName} (Copy)`) : null;
        if (!entered || !entered.trim()) return;
        const cleanNewName = entered.trim();
        const existingSlugs = this.axionikModels.map((m) => m.slug);
        const newSlug = createUniqueModelSlug(cleanNewName, existingSlugs);
        const libPath =
          (typeof localStorage !== 'undefined' ? localStorage.getItem('abd_axionikdb_path') : null) || 'd:\\desarrollos\\ABDSynths\\AxionikDB';
        try {
          await bridgeClient.duplicateAxionikModel(libPath, slug, newSlug, cleanNewName);
          toast(`Modelo duplicado en AxionikDB: ${newSlug}`, 'success');
          this.telemetryDrawer.addLog(`Duplicado modelo AxionikDB "${slug}" -> "${newSlug}" ("${cleanNewName}")`);
          await this.refreshAxionikModels();
          this.bankDrawer.refreshBank();
        } catch (err) {
          toast(`Error al duplicar modelo: ${String(err)}`, 'error');
        }
      },
      // ── Fase 23: Sub-library handlers ─────────────────────
      onRequestSublibraries: () => this.sublibraries,
      onCreateSublibrary: async (name: string) => {
        await this.core.createSublibrary(name);
        await this.refreshAxionikModels();
        this.bankDrawer.refreshBank();
      },
      onDeleteSublibrary: async (name: string) => {
        await this.core.deleteSublibrary(name);
        await this.refreshAxionikModels();
        this.bankDrawer.refreshBank();
      },
      onMoveAxionikModel: async (slug: string, targetSublibrary: string) => {
        await this.core.moveModelToSublibrary(slug, targetSublibrary);
        await this.refreshAxionikModels();
        this.bankDrawer.refreshBank();
      },
      onReorderSublibrary: async (sublibrary: string, orderedSlugs: string[]) => {
        await this.core.reorderModelsInSublibrary(sublibrary, orderedSlugs);
        await this.refreshAxionikModels();
        this.bankDrawer.refreshBank();
      },
    },
    // NeuModMakr serves models + classic library + axionikdb advanced
    { visibleTabs: ['models', 'library', 'axionik'] });

    this.processModal = new ProcessModal(modalsMount, {
      onCancel: () => this.core.cancelProcess(),
      onClose: () => this.navbar.setProcessing(false),
      onExport: () => this.exportDestinationModal.open(),
    });

    this.navbar.mount(
      this.session!,
      this.core.validateCoverage(),
      this.resolveActiveTheme()
    );
    this.navbar.setThemeState({
      theme: this.resolveActiveTheme(),
      family: this.themeFamilies[this.currentFamilyIndex],
      mode: this.currentThemeMode,
    });
    this.menus.bindKeyboardShortcuts();
    this.imports.bindGlobalDragAndDrop();
    this.menus.bindUnsavedChangesGuard();
    pwaManager.registerServiceWorker();
    bridgeClient.startAutoPolling(10000);
    bridgeClient.subscribe(() => {
      if (this.session) {
        this.navbar.updateAiState(this.session.processConfig.aiConfig, bridgeClient.isConnected());
      }
    });
  }

  private handleToggleAiAssistance(): void {
    if (!this.session) return;
    const current = this.session.processConfig.aiConfig ?? DEFAULT_AI_ASSISTANCE_CONFIG;
    const nextEnabled = !current.enabled;
    this.session = this.core.updateProcessConfig({
      aiConfig: { ...current, enabled: nextEnabled },
    });
    if (nextEnabled) {
      const isBridge = bridgeClient.isConnected();
      if (!isBridge) {
        toast('AI Assistance enabled (using local DSP fallback if Companion Bridge is offline)', 'info');
      } else {
        toast('AI Assistance enabled (Companion Bridge ready)', 'success');
      }
    } else {
      toast('100% Algorithmic DSP Mode activated', 'info');
    }
    this.refreshUI();
  }

  private playAuditionPcm(pcm: Float32Array, sampleRate: number): void {
    this.stopAuditionPcm();
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.auditionAudioContext = ctx;
      const buffer = ctx.createBuffer(1, pcm.length, sampleRate);
      buffer.getChannelData(0).set(pcm);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.start();
      this.auditionPcmSourceNode = src;
    } catch {
      // transient audio context error
    }
  }

  private stopAuditionPcm(): void {
    if (this.auditionPcmSourceNode) {
      try {
        this.auditionPcmSourceNode.stop();
        this.auditionPcmSourceNode.disconnect();
      } catch {
        // already stopped
      }
      this.auditionPcmSourceNode = null;
    }
    if (this.auditionAudioContext) {
      try {
        void this.auditionAudioContext.close();
      } catch {
        // ignore
      }
      this.auditionAudioContext = null;
    }
  }

  public async openAudioChopper(): Promise<void> {
    const activeZone = this.getActiveZone();
    const isExtended = (this.session?.processConfig.workingMode ?? 'classic') === 'extended';
    let sampleName = '';
    if (isExtended) {
      const extRegId = this.inspector.getSelectedRegionId();
      const extReg = this.session?.extendedRegions?.find((r) => r.id === extRegId);
      sampleName = extReg?.sampleName || activeZone?.sampleLow || activeZone?.sampleHigh || '';
    } else {
      sampleName = activeZone?.sampleLow || activeZone?.sampleHigh || '';
    }

    let pcm = new Float32Array(0);
    let sampleRate = 44100;
    let filename = sampleName || 'Sample.wav';

    if (sampleName) {
      try {
        const buf = this.core.getSampleBuffer(sampleName);
        if (buf) {
          const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const decoded = await audioCtx.decodeAudioData(buf.slice(0));
          pcm = decoded.getChannelData(0);
          sampleRate = decoded.sampleRate;
        }
      } catch (err) {
        toast(`Could not decode sample for chopper: ${err instanceof Error ? err.message : String(err)}`, 'warning');
      }
    }

    this.audioChopperModal.open(pcm, sampleRate, filename);
  }

  public openLoopEditor(): void {
    const activeZone = this.getActiveZone();
    const activeRegId = this.inspector?.getSelectedRegionId() ?? undefined;
    this.loopEditorModal.open({
      zoneId: activeZone?.id,
      regionId: activeRegId,
    });
  }

  /**
   * Fase 35.6 — Runs optimal zero-crossing AutoLoop across all zones/regions in batch.
   */
  public async handleAutoLoopAllZones(): Promise<void> {
    if (!this.session) return;
    const regions = this.core.getExtendedRegions();
    if (regions.length === 0) {
      toast('No hay zonas o regiones para aplicar AutoLoop.', 'warning');
      return;
    }

    const inputs: BatchAutoLoopItemInput[] = [];
    for (const reg of regions) {
      const loopData = this.core.getZoneLoopEditorData(undefined, reg.id);
      if (!loopData || loopData.monoPcm.length < 64) continue;
      inputs.push({
        id: reg.id,
        sampleName: loopData.sampleName,
        monoPcm: loopData.monoPcm,
        sampleRate: loopData.sampleRate,
        existingLoopStart: reg.loopEnd > reg.loopStart ? reg.loopStart : undefined,
        existingLoopEnd: reg.loopEnd > reg.loopStart ? reg.loopEnd : undefined,
      });
    }

    const computed = computeBatchAutoLoopForZones(inputs);
    if (computed.length === 0) {
      toast('Ninguna zona tenía audio suficiente para calcular puntos de bucle.', 'warning');
      return;
    }

    for (const item of computed) {
      await this.core.updateExtendedRegion(item.id, {
        loopMode: item.loopMode,
        loopStart: item.loopStart,
        loopEnd: item.loopEnd,
        hasPlaybackOverride: true,
      });
    }

    this.session = this.core.getSession()!;
    const avgQuality = Math.round(
      computed.reduce((acc, r) => acc + r.seamQualityPercent, 0) / computed.length
    );
    this.telemetryDrawer.addLog(
      `AutoLoop en lote (zc-snap): Aplicados puntos de bucle en ${computed.length} zona(s)/región(es) (calidad media de empalme: ${avgQuality}%).`
    );
    toast(
      `AutoLoop aplicado en ${computed.length} zona(s) (zc-snap • empalme medio ${avgQuality}%).`,
      'success'
    );
    this.refreshUI();
  }

  private async handleCoverImageUpload(file: File): Promise<void> {
    try {
      if (this.session && this.session.processConfig.workingMode !== 'extended') {
        this.session = this.core.updateProcessConfig({ workingMode: 'extended' });
      }
      this.processPanel?.setCoverConverting(true, file.name);
      // Yield one frame so the converting spinner and message render visibly
      await yieldToUI(60);

      const art = await this.core.convertAndSetModelCoverArtwork(file, file.name);
      this.session = this.core.getSession()!;
      this.processPanel?.setCoverConverting(false);
      const kb = formatKb(art.byteLength);
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
            const activeZone = this.getActiveZone();
            if (activeZone) {
              try {
                this.core.inspectZoneSpectrum(activeZone.id);
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

    this.navbar.updateSession(this.session, errors, bridgeClient.isConnected());
    this.navbar.updateHistory(this.core.getHistoryState());
    this.ribbon.setZones(this.session.zones, this.selectedZoneId, extRegions, workingMode);
    this.inspector.setZone(activeZone, this.getActiveZoneIndex(), this.session.zones.length, this.session.zones, workingMode, this.session.processConfig.keyMappingMode);
    this.processPanel.setConfig(this.session.processConfig, {
      errors,
      zones: this.session.zones,
    });
    this.keyboard.setZones(this.session.zones, this.selectedZoneId, extRegions, workingMode);
    this.keyboard.setActiveZone(activeZone);
    this.telemetryDrawer.updateAudit(this.session, errors);
    this.updateSpectralView(activeZone);
    this.modelConfigModal?.updateConfig();
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
    if (!activeZone || !this.isSpectralVisible) {
      if (!activeZone) this.spectralView.setInspection(null);
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
    // Open the unified Pre-Flight & Pipeline Checklist Modal directly for the active session
    this.batchModal.openForActiveSession();
  }

  private async executeSingleModelProcess(
    config: import('./core/types.ts').ProcessConfig,
    options: {
      forceReanalyzeImported: boolean;
      checklist: import('./core/types.ts').PipelineChecklistSelection;
    }
  ): Promise<void> {
    if (!this.session) return;

    // Enforce strict 0..127 coverage only in Classic mode (if not auto-repairing via Step #1)
    const isClassic = config.workingMode === 'classic';
    if (isClassic && !options.checklist.steps.coverageMidi) {
      const errors = this.core.validateCoverage();
      if (errors.length > 0) {
        toast(
          `Cannot start Classic Process: gaps in MIDI note coverage (${errors.length}). Enable Step #1 (Cobertura MIDI) or adjust zone boundaries.`,
          'error'
        );
        this.bankDrawer.close();
        this.telemetryDrawer.open();
        return;
      }
    }

    const srcInfo = this.core.inspectProcessSources();
    let forceReanalyzeImported = options.forceReanalyzeImported;

    if (srcInfo.importedSources.length > 0 && !forceReanalyzeImported) {
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
          `Model "${config.modelName}" comes from an already-compiled legacy .model (no original WAVs) and nothing was modified. It is ready to use or export as-is.\n\n` +
            `Only force a re-analysis from the resynthesized wave (lossy / photocopy effect) if you know what you are doing.`,
          { confirmLabel: 'Force lossy re-analysis', cancelLabel: 'Keep original (recommended)', danger: true }
        );
        if (!forceLossy) return;
        forceReanalyzeImported = true;
      } else if (srcInfo.complexityChanged) {
        // Pure imported .model and user changed Complexity
        const keepLossless = await confirmDialog(
          `The ${srcInfo.importedSources.length} source(s) of this model come from a legacy .model without the original WAVs.\n\n` +
            `Recalculating Complexity (${srcInfo.importedComplexity} -> ${config.complexity}) would force a re-analysis of the resynthesized audio (lossy photocopy effect).\n\n` +
            `Accept updates headers/zones while keeping the original .scape/.sphere data lossless (recommended).`,
          { confirmLabel: 'Update losslessly (recommended)', cancelLabel: 'Cancel' }
        );
        if (!keepLossless) {
          const confirmForce = await confirmDialog(
            `Force the lossy re-analysis (photocopy effect) at Complexity ${config.complexity}?`,
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
      message: 'Beginning spectral neural resynthesis & Resinator 2 compilation...',
      elapsedMs: 0,
    });

    this.navbar.setProcessing(true);
    await this.core.startProcess(config, {
      forceReanalyzeImported,
      checklist: options.checklist,
    });
  }
}

// Bootstrap application
const app = new App();
app.init().catch(console.error);
