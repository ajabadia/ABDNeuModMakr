// ─────────────────────────────────────────────────────────
// ImportHandlers — sample / session / model / NeuronDB import flows
// Extracted verbatim from App (src/main.ts). All mutable shell state
// (session, selection) and UI side-effects (log, refresh, drawers)
// go through ImportContext so this module owns no DOM singletons.
// ─────────────────────────────────────────────────────────

import type { CoreService, Session, SoundPreset, Zone } from '../core';
import { PARAMETER_SETS } from '../core';
import type { BankDrawer } from '../ui/BankDrawer';
import type { NeuronDbModal } from '../ui/NeuronDbModal';
import {
  isSupportedAudioFileName,
  parseMName,
  parseMapScript,
  parseModelNamesCache,
  parseSoundNamesCache,
  parseSoundScript,
  parseZipArchive,
  SUPPORTED_AUDIO_ACCEPT,
  transcodeAnyAudioToWavBuffer,
} from '@abdsynths/shared/formats/neuron';
import { stickModesToComplexity, type NeuronDbModelEntry } from '../ui/NeuronDbModal';
import { MAX_SFZ_TEXT_BYTES } from '../formats/SfzParser.ts';
import { toast, confirmDialog } from '../ui/notify';
import { withLoading } from '../ui/LoadingModal';
import { MultiInstrumentModal, type MultiInstrumentItem } from '../ui/MultiInstrumentModal';
import {
  extractFolderFilesToCandidates,
  extractFolderFilesToCandidatesWithAi,
  type FolderFileInput,
} from '../core/batch/FolderBatchExtractor';
import { extractSf2PresetsToCandidates } from '../core/batch/Sf2BatchExtractor';
import type { BatchModelCandidate } from '../core/batch/types';
import { MultiAssetTriageModal } from '../ui/MultiAssetTriageModal';
import type { DiscoveredSamplerItem } from '../formats/MultiAssetDiscovery.ts';
import { applyPreflightImportAdaptations } from '../core/import/importPreflight.ts';
import {
  isNeuronBankOrModelInput,
  listNeuronBankModels,
  parseNeuronBankOrModelToPreset,
} from '../core/import/neuronBankImporter.ts';
import {
  discoverTriageReport,
  extractTriageDefinitionCandidates,
  indexTriageBuffers,
  isTriageAudioItem,
  isTriageContainerFileName,
  parseTriageDefinitionItem,
  partitionTriageSelection,
  resolveTriageItemFiles,
  shouldOpenTriageGate,
  type TriageExpandedFile,
} from './triageGate.ts';

export interface ImportContext {
  core: CoreService;
  session: Session | null;
  selectedZoneId: string | null;
  log(msg: string): void;
  refresh(): void;
  readonly bank: BankDrawer;
  readonly neuronDb: NeuronDbModal;
  onDropCoverImage?: (file: File) => Promise<void> | void;
  onOpenBatchProcessorWithSf2?: (buffer: ArrayBuffer, fileName: string) => void;
  onOpenBatchProcessorWithCandidates?: (candidates: BatchModelCandidate[], originTitle?: string) => void;
  onOpenBatchProcessor?: () => void;
}

export class ImportHandlers {
  private ctx: ImportContext;

  constructor(ctx: ImportContext) {
    this.ctx = ctx;
  }

  async loadSampleFileIntoZone(
    zoneId: string,
    slot: 'low' | 'high',
    file: File
  ): Promise<void> {
    try {
      await withLoading('LOADING AUDIO SAMPLE...', `Decoding "${file.name}"...`, async () => {
        const rawBuf = await file.arrayBuffer();
        const buffer = await transcodeAnyAudioToWavBuffer(rawBuf, file.name);
        const decoded = this.ctx.core.registerSampleBuffer(file.name, buffer);
        const targetZone = this.ctx.session?.zones.find((z) => z.id === zoneId);
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
          const isExtended = this.ctx.session?.processConfig.workingMode === 'extended';
          changes.velSplit = isExtended ? decoded.instrument.lowVelocity : 64;
        }
        await this.ctx.core.updateZone(zoneId, changes);
        this.ctx.session = this.ctx.core.getSession()!;
        this.ctx.log(
          `Loaded ${file.name} into ${effectiveSlot === 'low' ? 'Low Vel' : 'High Vel'} (${decoded.formatTag.toUpperCase()}, ${decoded.sampleRate} Hz, ${decoded.bitsPerSample}-bit, ${decoded.numChannels}ch, ${decoded.durationSec.toFixed(2)}s)`
        );
        this.ctx.refresh();
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.ctx.log(`Error loading ${file.name}: ${msg}`);
      toast(`Failed to decode audio file "${file.name}": ${msg}`, 'error');
    }
  }

  async loadSampleFileIntoRegion(
    regionId: string,
    file: File
  ): Promise<void> {
    try {
      await withLoading('LOADING AUDIO SAMPLE...', `Decoding "${file.name}"...`, async () => {
        const rawBuf = await file.arrayBuffer();
        const buffer = await transcodeAnyAudioToWavBuffer(rawBuf, file.name);
        const decoded = this.ctx.core.registerSampleBuffer(file.name, buffer);
        const changes: Parameters<CoreService['updateExtendedRegion']>[1] = {
          sampleName: file.name,
        };
        await this.ctx.core.updateExtendedRegion(regionId, changes);
        this.ctx.session = this.ctx.core.getSession()!;
        this.ctx.log(
          `Loaded ${file.name} into Region [${regionId}] (${decoded.formatTag.toUpperCase()}, ${decoded.sampleRate} Hz, ${decoded.bitsPerSample}-bit, ${decoded.numChannels}ch, ${decoded.durationSec.toFixed(2)}s)`
        );
        this.ctx.refresh();
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.ctx.log(`Error loading ${file.name}: ${msg}`);
      toast(`Failed to decode audio file "${file.name}": ${msg}`, 'error');
    }
  }

  async handleDroppedFiles(fileList: FileList): Promise<void> {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    const imgFile = files.find(
      (f) =>
        f.type.startsWith('image/') ||
        /\.(jpe?g|png|webp|avif|svg|bmp|gif)$/i.test(f.name)
    );
    if (imgFile && this.ctx.onDropCoverImage) {
      await this.ctx.onDropCoverImage(imgFile);
      if (files.length === 1) return;
    }
    await this.importMixedFilesOrZip(fileList, 'model', 'samples', 'Drag & Drop');
  }

  bindGlobalDragAndDrop(): void {
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => e.preventDefault());

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

  triggerOpenSession(): void {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,.nmsession.json';
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      if (this.ctx.session?.dirty) {
        const ok = await confirmDialog(
          'You have unsaved changes in the current session. Do you want to discard them and open another session?',
          { confirmLabel: 'Open Session', cancelLabel: 'Cancel', danger: true }
        );
        if (!ok) return;
      }
      try {
        const text = await f.text();
        this.ctx.session = await this.ctx.core.loadSessionFromJson(text);
        this.ctx.selectedZoneId = this.ctx.session.zones[0]?.id || null;
        this.ctx.log(`Loaded session "${this.ctx.session.name}" from ${f.name}`);
        this.ctx.refresh();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.ctx.log(`Open session error: ${msg}`);
        toast(`Failed to load session JSON: ${msg}`, 'error');
      }
    });
    fileInput.click();
  }

  triggerFolderImport(): void {
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
          this.ctx.log(`Folder import error: ${msg}`);
          toast(`Failed to import audio folder: ${msg}`, 'error');
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

  triggerModelFolderImport(): void {
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
          this.ctx.log(`Model folder import error: ${msg}`);
          toast(`Failed to import model folder: ${msg}`, 'error');
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

  triggerConfigureNeuronDbFolder(): void {
    const win = window as Window & {
      showDirectoryPicker?: (opts?: { mode?: 'read' }) => Promise<FileSystemDirectoryHandle>;
    };
    if (typeof win.showDirectoryPicker === 'function') {
      void (async () => {
        try {
          const dirHandle = await win.showDirectoryPicker!({ mode: 'read' });
          this.lastNeuronDbSource = { kind: 'handle', dir: dirHandle };
          await this.importFromDirectoryHandle(dirHandle, 'model');
          const bank = await this.ctx.core.loadBank();
          this.ctx.bank.setBank(bank, this.ctx.session?.processConfig.modelNumber ?? null);
          this.ctx.bank.open();
          this.ctx.log(`Configured NeuronDB folder: "${dirHandle.name}".`);
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          const msg = err instanceof Error ? err.message : String(err);
          this.ctx.log(`Configure NeuronDB folder error: ${msg}`);
          toast(`Failed to configure NeuronDB folder: ${msg}`, 'error');
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
      if (!fileList || fileList.length === 0) return;          this.lastNeuronDbSource = { kind: 'files', files: fileList };
          await this.importFromWebkitFileList(fileList, 'model');
          const bank = await this.ctx.core.loadBank();
      this.ctx.bank.setBank(bank, this.ctx.session?.processConfig.modelNumber ?? null);
      this.ctx.bank.open();
    });
    fileInput.click();
  }

  async scanSoundPresets(
    rootHandle: FileSystemDirectoryHandle,
    subDirs: Map<string, FileSystemDirectoryHandle>,
    directFiles: FileSystemFileHandle[]
  ): Promise<void> {
    type IterDir = FileSystemDirectoryHandle & {
      values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>;
    };

    let soundNamesHandle = directFiles.find((f) => f.name.toLowerCase() === 'soundnames');
    let soundsDir = subDirs.get('sounds') ?? subDirs.get('Sounds');

    if (!soundsDir && rootHandle.name.toLowerCase() === 'sounds') {
      soundsDir = rootHandle;
    }

    if (!soundNamesHandle && soundsDir) {
      for await (const entry of (soundsDir as IterDir).values()) {
        if (entry.kind === 'file' && entry.name.toLowerCase() === 'soundnames') {
          soundNamesHandle = entry as FileSystemFileHandle;
          break;
        }
      }
    }

    const soundNamesMap = new Map<number, string>();
    if (soundNamesHandle) {
      try {
        const file = await soundNamesHandle.getFile();
        const text = await file.text();
        const parsed = parseSoundNamesCache(text);
        for (const [k, v] of parsed.entries()) {
          soundNamesMap.set(k, v);
        }
      } catch {
        // ignore error parsing cache
      }
    }

    const presets: SoundPreset[] = [];

    if (soundsDir) {
      for await (const entry of (soundsDir as IterDir).values()) {
        if (entry.kind === 'directory') {
          const match = /^(\d{3})\.sound$/i.exec(entry.name);
          if (match) {
            const slot = parseInt(match[1], 10);
            let name = soundNamesMap.get(slot) || `Sound${match[1]}`;
            let modelIndex = slot;
            try {
              const soundDir = entry as FileSystemDirectoryHandle;
              for await (const inner of (soundDir as IterDir).values()) {
                if (inner.kind === 'file' && inner.name.toLowerCase() === 'sound.script') {
                  const sf = await (inner as FileSystemFileHandle).getFile();
                  const scriptText = await sf.text();
                  const parsed = parseSoundScript(scriptText);
                  if (parsed.name && parsed.name.trim().length > 0) {
                    name = parsed.name;
                  }
                  if (parsed.r1ModelIndex !== undefined && parsed.r1ModelIndex < 512) {
                    modelIndex = parsed.r1ModelIndex;
                  }
                  break;
                }
              }
            } catch {
              // ignore individual sound read errors
            }

            const cat = PARAMETER_SETS[modelIndex % 10]?.name || 'Sound';
            presets.push({ slot, name, category: cat, modelIndex, parameterCount: 445 });
          }
        }
      }
    } else if (soundNamesMap.size > 0) {
      for (const [slot, name] of soundNamesMap.entries()) {
        if (name && name !== '--<empty>--' && name !== 'InitSound') {
          const cat = PARAMETER_SETS[slot % 10]?.name || 'Preset';
          presets.push({ slot, name, category: cat, modelIndex: slot, parameterCount: 445 });
        }
      }
    }

    if (presets.length > 0) {
      presets.sort((a, b) => a.slot - b.slot);
      this.ctx.core.setBankPresets(presets);
      const bank = await this.ctx.core.loadBank();
      this.ctx.bank.setBank(bank, this.ctx.session?.processConfig.modelNumber ?? null);
      this.ctx.log(`Loaded ${presets.length} sound preset(s) from NeuronDB.`);
    }
  }

  private lastLibraryEntries: NeuronDbModelEntry[] = [];
  private lastLibraryPick: ((slot: number) => void) | null = null;
  /** Last configured library source, retained so refresh can rescan without a picker. */
  private lastNeuronDbSource:
    | { kind: 'handle'; dir: FileSystemDirectoryHandle }
    | { kind: 'files'; files: FileList }
    | null = null;

  private setLibrarySource(entries: NeuronDbModelEntry[], pick: (slot: number) => void): void {
    this.lastLibraryEntries = entries;
    this.lastLibraryPick = pick;
  }

  /** Live entries for the bank drawer's Library tab (pull model; mutated in place by scans). */
  public getLibraryEntries(): NeuronDbModelEntry[] {
    return this.lastLibraryEntries;
  }

  /** Load a library entry exactly like picking it in the NeuronDB modal. */
  public pickLibraryModel(slot: number): void {
    this.lastLibraryPick?.(slot);
  }

  /**
   * Rescans the last configured NeuronDB folder without opening a picker.
   * Returns null when no folder was ever configured (the caller should
   * open the configure flow instead). Never touches the editor session:
   * single-model and audio layouts are skipped, only the multi-model
   * library (+ presets) is refreshed.
   */
  public async refreshNeuronDbFolder(): Promise<{ models: number; presets: number } | null> {
    const src = this.lastNeuronDbSource;
    if (!src) return null;
    this.ctx.neuronDb.beginBackgroundScan();
    try {
      if (src.kind === 'handle') {
        await this.importFromDirectoryHandle(src.dir, 'model', { openModal: false, applyToSession: false });
      } else {
        await this.importFromWebkitFileList(src.files, 'model', { openModal: false, applyToSession: false });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.ctx.log(`Refresh NeuronDB folder error: ${msg}`);
      throw err;
    }
    const bank = await this.ctx.core.loadBank();
    return { models: this.lastLibraryEntries.length, presets: bank.presets.length };
  }

  private async readModelDirFiles(
    modelDir: FileSystemDirectoryHandle,
    folderPrefix: string
  ): Promise<{ name: string; buffer: ArrayBuffer }[]> {
    type IterDir = FileSystemDirectoryHandle & {
      values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>;
    };
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
  }

  private async loadModelDirSlot(
    modelSubDirs: Map<number, FileSystemDirectoryHandle>,
    chosenSlot: number
  ): Promise<void> {
    try {
      const targetDir = modelSubDirs.get(chosenSlot);
      if (!targetDir) return;
      const loaded = await this.readModelDirFiles(targetDir, targetDir.name);
      const model = await this.ctx.core.importModelFiles(loaded);
      this.ctx.session = this.ctx.core.getSession()!;
      this.ctx.selectedZoneId = this.ctx.session.zones[0]?.id || null;
      this.ctx.log(
        `Imported model #${String(model.slot).padStart(3, '0')} "${model.name}" (${model.zoneCount} zone(s))`
      );
      this.ctx.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.ctx.log(`Error loading model #${chosenSlot}: ${msg}`);
      toast(`Failed to load model #${String(chosenSlot).padStart(3, '0')}: ${msg}`, 'error');
    }
  }

  async importFromDirectoryHandle(
    rootHandle: FileSystemDirectoryHandle,
    preferredKind: 'audio' | 'model',
    opts?: { openModal?: boolean; applyToSession?: boolean }
  ): Promise<void> {
    type IterDir = FileSystemDirectoryHandle & {
      values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>;
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
        lower.endsWith('.nmmodel') ||
        lower.endsWith('.neuronikmodel')
      );
    });

    if (hasDirectModelFiles) {
      // Refresh never replaces the editor session.
      if (opts?.applyToSession === false) return;
      const loaded = await this.readModelDirFiles(rootHandle, rootHandle.name);
      const model = await this.ctx.core.importModelFiles(loaded);
      this.ctx.session = this.ctx.core.getSession()!;
      this.ctx.selectedZoneId = this.ctx.session.zones[0]?.id || null;
      this.ctx.log(
        `Imported model folder #${String(model.slot).padStart(3, '0')} "${model.name}" (${model.zoneCount} zone(s))`
      );
      this.ctx.refresh();
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
      await this.scanSoundPresets(rootHandle, subDirs, directFiles);
      const availableSlots = Array.from(modelSubDirs.keys()).sort((a, b) => a - b);
      if (availableSlots.length === 1) {
        // A single model folder loads straight into the session on
        // configure; refresh skips it (nothing library-like to rescan).
        if (opts?.applyToSession === false) return;
        const targetDir = modelSubDirs.get(availableSlots[0])!;
        const loaded = await this.readModelDirFiles(targetDir, targetDir.name);
        const model = await this.ctx.core.importModelFiles(loaded);
        this.ctx.session = this.ctx.core.getSession()!;
        this.ctx.selectedZoneId = this.ctx.session.zones[0]?.id || null;
        this.ctx.log(
          `Imported model #${String(model.slot).padStart(3, '0')} "${model.name}" (${model.zoneCount} zone(s))`
        );
        this.ctx.refresh();
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

      if (opts?.openModal !== false) {
        this.ctx.neuronDb.open(initialEntries, (chosenSlot) => {
          void this.loadModelDirSlot(modelSubDirs, chosenSlot);
        });
      }
      this.setLibrarySource(initialEntries, (slot) => {
        void this.loadModelDirSlot(modelSubDirs, slot);
      });

      // Progressively scan lightweight headers in batches of 20 without blocking UI
      void (async () => {
        const total = initialEntries.length;
        let done = 0;
        const batchSize = 20;
        for (let i = 0; i < total; i += batchSize) {
          if (this.ctx.neuronDb.isAborted()) return;
          const slice = initialEntries.slice(i, i + batchSize);
          await Promise.all(
            slice.map(async (item) => {
              if (this.ctx.neuronDb.isAborted()) return;
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
                this.ctx.neuronDb.updateEntry(item);
              } catch {
                // ignore individual corrupt folder
              }
            })
          );
          done = Math.min(total, i + batchSize);
          this.ctx.neuronDb.setScanProgress(done, total);
        }
      })();
      return;
    }

    // 3. Otherwise collect `.wav` / `.aif` / `.aiff` audio files (recursively up to 1 level)
    // Refresh never replaces the editor session with audio imports.
    if (opts?.applyToSession === false) return;

    // Fase 35 — DirectoryHandle triage gate (`showDirectoryPicker`):
    // Mixed folders carrying preset containers + audio/models open the triage gate.
    const mixedDirFiles = await this.readMixedDirectoryHandleForTriage(rootHandle);
    if (
      mixedDirFiles &&
      (await this.maybeOpenTriageGate(
        mixedDirFiles,
        rootHandle.name || 'Selected Folder',
        'samples',
        preferredKind
      ))
    ) {
      return;
    }

    const folderInputs: FolderFileInput[] = [];
    const collectAudio = async (dir: FileSystemDirectoryHandle, relPrefix: string, depth: number): Promise<void> => {
      for await (const entry of (dir as IterDir).values()) {
        if (entry.name.startsWith('.') || entry.name.startsWith('._') || entry.name === '__MACOSX') {
          continue;
        }
        const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
        if (entry.kind === 'file') {
          if (isSupportedAudioFileName(entry.name)) {
            const file = await (entry as FileSystemFileHandle).getFile();
            const buffer = await file.arrayBuffer();
            folderInputs.push({ path: relPath, name: entry.name, buffer });
          }
        } else if (entry.kind === 'directory' && depth < 2) {
          await collectAudio(entry as FileSystemDirectoryHandle, relPath, depth + 1);
        }
      }
    };

    await collectAudio(rootHandle, '', 0);
    if (folderInputs.length === 0) {
      const msg =
        preferredKind === 'model'
          ? 'No valid .model files (MName, map.script, .scape, .sphere) found in selected folder.'
          : 'No valid .wav / .aif / .aiff audio files found in selected folder.';
      this.ctx.log(`Folder import: ${msg}`);
      toast(msg, 'warning');
      return;
    }

    await this.importDeducedAudioDirectoryOrPrompt(
      folderInputs,
      rootHandle.name || 'Sample Folder',
      'samples',
      'Import Folder'
    );
  }

  private async importDeducedAudioDirectoryOrPrompt(
    folderInputs: FolderFileInput[],
    containerName: string,
    audioMode: 'samples' | 'by-name',
    sourceLabel: string
  ): Promise<void> {
    let candidates = extractFolderFilesToCandidates(folderInputs, {
      defaultOriginName: containerName,
    });

    const loadSingleAudioGroup = async (
      files: { name: string; buffer: ArrayBuffer }[],
      instrumentName?: string
    ) => {
      await withLoading(
        'LOADING AUDIO SAMPLES...',
        `Mapping and decoding ${files.length} audio file(s)${instrumentName ? ` for "${instrumentName}"` : ''}...`,
        async () => {
          const normalizedFiles: { name: string; buffer: ArrayBuffer }[] = [];
          for (const f of files) {
            const normBuf = await transcodeAnyAudioToWavBuffer(f.buffer, f.name);
            normalizedFiles.push({ name: f.name, buffer: normBuf });
          }
          const zones = await this.ctx.core.importAudioFiles(normalizedFiles, audioMode);
          this.ctx.session = this.ctx.core.getSession()!;
          if (instrumentName && this.ctx.session) {
            this.ctx.session.name = instrumentName;
            this.ctx.session.processConfig.modelName = instrumentName.slice(0, 11);
          }
          this.ctx.selectedZoneId = zones[0]?.id || null;
          this.ctx.log(
            `${sourceLabel}: mapped ${files.length} audio file(s)${instrumentName ? ` ("${instrumentName}")` : ''} into ${zones.length} contiguous zone(s).`
          );
          this.ctx.refresh();
        }
      );
    };

    if (candidates.length > 1) {
      const toModalItems = (list: typeof candidates): MultiInstrumentItem[] =>
        list.map((c, idx) => ({
          id: c.id,
          index: idx,
          name: c.name,
          regionCount: c.zoneCount,
          detail: `${c.detectedCategory} (Set #${c.suggestedParameterSet})`,
        }));

      const multiModal = new MultiInstrumentModal();
      multiModal.open({
        fileName: containerName,
        format: 'folder',
        items: toModalItems(candidates),
        onSelect: (item) => {
          const chosen = candidates[item.index] || candidates[0];
          if (chosen) {
            void loadSingleAudioGroup(chosen.files, chosen.name);
          }
        },
        onProcessBatch: () => {
          this.ctx.onOpenBatchProcessor?.();
        },
        onDeduceWithAi: async () => {
          const aiCandidates = await extractFolderFilesToCandidatesWithAi(folderInputs, {
            defaultOriginName: containerName,
          });
          if (aiCandidates.length > 0) {
            candidates = aiCandidates;
            return toModalItems(candidates);
          }
          return null;
        },
      });
      return;
    }

    await loadSingleAudioGroup(
      folderInputs.map((f) => ({ name: f.name, buffer: f.buffer })),
      candidates[0]?.name !== 'Instrument' ? candidates[0]?.name : undefined
    );
  }

  async importFromWebkitFileList(
    fileList: FileList,
    preferredKind: 'audio' | 'model',
    opts?: { openModal?: boolean; applyToSession?: boolean }
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
        if (isSupportedAudioFileName(lower)) {
          audioFileEntries.push(f);
        } else if (
          lower.endsWith('.scape') ||
          lower.endsWith('.sphere') ||
          lower === 'map.script' ||
          lower === 'mname' ||
          lower.endsWith('.nmmodel') ||
          lower.endsWith('.neuronikmodel')
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

      // Fase 35 — folder triage gate: mixed folders carrying preset containers
      // are ignored by the single-format folder flows below, so they get the gate.
      const mixedFolder = await this.readMixedWebkitFilesForTriage(fileList);
      if (mixedFolder && (await this.maybeOpenTriageGate(mixedFolder, 'Dropped Folder', 'samples', preferredKind))) {
        return;
      }

      if ((preferredKind === 'model' || audioFileEntries.length === 0) && (modelFolders.size > 0 || looseModelFiles.length > 0)) {
        const loadSlotFiles = async (targetFiles: File[]) => {
          const loaded: { name: string; buffer: ArrayBuffer }[] = [];
          for (const f of targetFiles) {
            const relPath = (f.webkitRelativePath || f.name).replace(/\\/g, '/');
            const buffer = await f.arrayBuffer();
            loaded.push({ name: relPath, buffer });
          }
          const model = await this.ctx.core.importModelFiles(loaded);
          this.ctx.session = this.ctx.core.getSession()!;
          this.ctx.selectedZoneId = this.ctx.session.zones[0]?.id || null;
          this.ctx.log(
            `Imported model folder #${String(model.slot).padStart(3, '0')} "${model.name}" (${model.zoneCount} zone(s))`
          );
          this.ctx.refresh();
        };

        if (modelFolders.size <= 1) {
          // A single model folder loads straight into the session on
          // configure; refresh skips it (nothing library-like to rescan).
          if (opts?.applyToSession === false) return;
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

        if (opts?.openModal !== false) {
          this.ctx.neuronDb.open(initialEntries, (chosenSlot) => {
            const files = modelFolders.get(chosenSlot);
            if (files) {
              void loadSlotFiles(files);
            }
          });
        }
        this.setLibrarySource(initialEntries, (slot) => {
          const files = modelFolders.get(slot);
          if (files) {
            void loadSlotFiles(files);
          }
        });

        // Progressively inspect headers from File slices
        void (async () => {
          const total = initialEntries.length;
          const batchSize = 20;
          for (let i = 0; i < total; i += batchSize) {
            if (this.ctx.neuronDb.isAborted()) return;
            const slice = initialEntries.slice(i, i + batchSize);
            await Promise.all(
              slice.map(async (item) => {
                if (this.ctx.neuronDb.isAborted()) return;
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
                this.ctx.neuronDb.updateEntry(item);
              })
            );
            this.ctx.neuronDb.setScanProgress(Math.min(total, i + batchSize), total);
          }
        })();
        return;
      }

      if (audioFileEntries.length === 0) {
        toast('No valid audio or .model files found in the selected folder.', 'warning');
        return;
      }

      const folderInputs: FolderFileInput[] = [];
      let rootFolderName = 'Sample Folder';
      for (const f of audioFileEntries) {
        const relPath = (f.webkitRelativePath || f.name).replace(/\\/g, '/');
        const firstSeg = relPath.split('/')[0];
        if (firstSeg && relPath.includes('/')) rootFolderName = firstSeg;
        const buffer = await f.arrayBuffer();
        folderInputs.push({ path: relPath, name: f.name, buffer });
      }
      await this.importDeducedAudioDirectoryOrPrompt(
        folderInputs,
        rootFolderName,
        'samples',
        'Import Folder'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.ctx.log(`Folder import error: ${msg}`);
      toast(`Failed to import folder: ${msg}`, 'error');
    }
  }

  // ─────────────────────────────────────────────────────────
  // Fase 35 — mixed-content triage gate (folder / multi-file / .zip).
  // Genuinely mixed content opens the MultiAssetTriageModal instead of
  // letting the single-format ladders below silently drop non-winning kinds.
  // ─────────────────────────────────────────────────────────
  private async maybeOpenTriageGate(
    expanded: TriageExpandedFile[],
    sourceLabel: string,
    audioMode: 'samples' | 'by-name',
    preferredKind: 'audio' | 'model'
  ): Promise<boolean> {
    if (expanded.length < 2) return false;
    const report = await discoverTriageReport(expanded, sourceLabel);
    if (!report || !shouldOpenTriageGate(report)) return false;
    const byPath = indexTriageBuffers(expanded);
    const triage = new MultiAssetTriageModal();
    triage.open({
      sourceName: sourceLabel,
      discoveryReport: report,
      onImportSingle: (item) => {
        void this.importTriageSingle(item, byPath, sourceLabel, audioMode, preferredKind);
      },
      onProcessBatch: (selected) => {
        void this.processTriageBatch(selected, byPath, sourceLabel);
      },
      onCancel: () => {
        this.ctx.log(`${sourceLabel}: triage dismissed — no files imported.`);
      },
    });
    this.ctx.log(
      `${sourceLabel}: mixed content detected (${report.items.length} entities, ${new Set(report.items.map((it) => it.format)).size} formats) — triage gate opened.`
    );
    return true;
  }

  private async importTriageSingle(
    item: DiscoveredSamplerItem,
    byPath: Map<string, TriageExpandedFile>,
    sourceLabel: string,
    audioMode: 'samples' | 'by-name',
    preferredKind: 'audio' | 'model'
  ): Promise<void> {
    const files = resolveTriageItemFiles(item, byPath);
    if (files.length === 0) {
      toast(`Could not locate "${item.name}" data — import it with Universal Import (Ctrl+I).`, 'warning');
      return;
    }
    if (isTriageAudioItem(files)) {
      await this.importDeducedAudioDirectoryOrPrompt(
        files.map((f) => ({
          path: f.name,
          name: f.name.split('/').pop() ?? f.name,
          buffer: f.buffer,
        })),
        item.name || sourceLabel,
        audioMode,
        `${sourceLabel} (triage)`
      );
      return;
    }
    const primaryBase = (item.primaryFilePath.split('/').pop() ?? '').toLowerCase();
    if (primaryBase.endsWith('.sf2')) {
      // Self-contained bank: behave exactly as if the user dropped that file.
      // The single-SF2 ladder handles it; the gate won't reopen (1 format).
      const primary = files.find((f) => f.name.toLowerCase().endsWith('.sf2')) ?? files[0];
      const base = primary.name.split('/').pop() ?? primary.name;
      try {
        const dt = new DataTransfer();
        dt.items.add(new File([primary.buffer], base));
        await this.importMixedFilesOrZip(dt.files, preferredKind, audioMode, `${sourceLabel} (triage)`);
      } catch (err) {
        toast(`Failed to load "${item.name}": ${err instanceof Error ? err.message : String(err)}`, 'error');
      }
      return;
    }
    if (primaryBase.endsWith('.sfz')) {
      const sfzFile =
        files.find((f) => f.name.toLowerCase().endsWith('.sfz')) ?? files[0];
      const companionAudio = files.filter((f) =>
        isSupportedAudioFileName((f.name.split('/').pop() ?? f.name).toLowerCase())
      );
      try {
        await withLoading(
          'IMPORTING SFZ INSTRUMENT...',
          `Decoding opcodes from "${item.name}" and mapping regions...`,
          async () => {
            if (sfzFile.buffer.byteLength > MAX_SFZ_TEXT_BYTES) {
              throw new Error(
                `SFZ file too large (${sfzFile.buffer.byteLength} bytes, max ${MAX_SFZ_TEXT_BYTES})`
              );
            }
            const sfzText = new TextDecoder('utf-8').decode(sfzFile.buffer);
            const normalizedSfzAudio: { name: string; buffer: ArrayBuffer }[] = [];
            for (const af of companionAudio) {
              const baseName = af.name.split('/').pop() ?? af.name;
              const normBuf = await transcodeAnyAudioToWavBuffer(af.buffer, baseName);
              normalizedSfzAudio.push({ name: baseName, buffer: normBuf });
            }
            const session = await this.ctx.core.importSfzText(
              sfzText,
              sfzFile.name.split('/').pop() ?? sfzFile.name,
              normalizedSfzAudio
            );
            this.ctx.session = session;
            this.ctx.selectedZoneId = session.zones[0]?.id || null;
            this.ctx.log(
              `${sourceLabel} (triage): imported SFZ "${item.name}" (${session.extendedRegions?.length ?? 0} regions, ${normalizedSfzAudio.length} companion audio file(s)).`
            );
            this.ctx.refresh();
          }
        );
      } catch (err) {
        toast(
          `Failed to load SFZ "${item.name}": ${err instanceof Error ? err.message : String(err)}`,
          'error'
        );
      }
      return;
    }

    // Attempt direct universal sampler definition parse (.dspreset, .exs, .xpm, .adv, .vstpreset, .multisample, etc.)
    const parsedPreset = await parseTriageDefinitionItem(item, byPath);
    if (parsedPreset && parsedPreset.regions.length > 0) {
      const currentMode = this.ctx.session?.processConfig.workingMode ?? 'classic';
      const adapted = applyPreflightImportAdaptations(parsedPreset, {
        autoExtendOuterZones: true,
        adaptVelocityLayers: true,
        switchToExtendedMode: currentMode === 'extended',
        currentWorkingMode: currentMode,
      });
      if (!this.ctx.session) {
        this.ctx.session = await this.ctx.core.newSession(parsedPreset.modelName || item.name);
      }
      for (const [name, buf] of adapted.audioBuffers.entries()) {
        this.ctx.core.registerSampleBuffer(name, buf);
      }
      const rawParamSet = Number(parsedPreset.suggestedParameterSet);
      const paramSet = Number.isFinite(rawParamSet) ? Math.max(0, Math.min(9, rawParamSet)) : 0;
      this.ctx.session.name = parsedPreset.modelName || item.name;
      this.ctx.session.processConfig.modelName = (parsedPreset.modelName || item.name).slice(0, 11);
      this.ctx.session.processConfig.expandedName = parsedPreset.presetName || item.name;
      this.ctx.session.processConfig.parameterSet = paramSet;
      this.ctx.session.processConfig.workingMode = adapted.suggestedWorkingMode;
      this.ctx.session.zones = adapted.classicZones;
      this.ctx.session.extendedRegions = adapted.extendedRegions;
      this.ctx.session.dirty = true;
      this.ctx.selectedZoneId = adapted.classicZones[0]?.id ?? null;
      this.ctx.log(
        `${sourceLabel} (triage): loaded ${parsedPreset.formatLabel} "${parsedPreset.presetName}" (${adapted.classicZones.length} zones).`
      );
      this.ctx.refresh();
      return;
    }

    toast(
      `"${item.name}" (${item.formatLabel}) goes through Batch or Universal Import (Ctrl+I) — direct session load here supports audio packs and SF2.`,
      'warning'
    );
  }

  private async processTriageBatch(
    selected: DiscoveredSamplerItem[],
    byPath: Map<string, TriageExpandedFile>,
    sourceLabel: string
  ): Promise<void> {
    const part = partitionTriageSelection(selected, byPath);
    const candidates: BatchModelCandidate[] = [];
    for (const sf2 of part.sf2Blobs) {
      try {
        const base = (sf2.name.split('/').pop() ?? sf2.name).replace(/\.[^.]+$/, '');
        candidates.push(...extractSf2PresetsToCandidates(sf2.buffer, { soundFontName: base }));
      } catch (err) {
        this.ctx.log(
          `${sourceLabel}: could not read "${sf2.name}" presets (${err instanceof Error ? err.message : String(err)}).`
        );
      }
    }
    if (part.audioInputs.length > 0) {
      try {
        candidates.push(
          ...extractFolderFilesToCandidates(part.audioInputs, {
            defaultOriginName: `${sourceLabel} (triage)`,
          })
        );
      } catch (err) {
        this.ctx.log(
          `${sourceLabel}: could not group triage audio (${err instanceof Error ? err.message : String(err)}).`
        );
      }
    }
    let remainingSkipped = part.skipped;
    if (part.skipped.length > 0) {
      const defResult = await extractTriageDefinitionCandidates(part.skipped, byPath);
      if (defResult.candidates.length > 0) {
        candidates.push(...defResult.candidates);
      }
      remainingSkipped = defResult.unparseable;
    }
    if (candidates.length === 0) {
      toast('Nothing batch-processable in the selection — use Universal Import (Ctrl+I) for these formats.', 'warning');
      return;
    }
    if (remainingSkipped.length > 0) {
      const kinds = [...new Set(remainingSkipped.map((s) => s.formatLabel))].join(', ');
      toast(
        `Skipped ${remainingSkipped.length} (${kinds}): batch takes audio packs and SF2 — the rest go via Universal Import (Ctrl+I).`,
        'warning'
      );
    }
    if (this.ctx.onOpenBatchProcessorWithCandidates) {
      this.ctx.onOpenBatchProcessorWithCandidates(candidates, `${sourceLabel} (triage)`);
    } else {
      this.ctx.onOpenBatchProcessor?.();
    }
  }

  /**
   * DirectoryHandle (`showDirectoryPicker`) variant: reads mixed folders carrying
   * preset containers + audio/other files so the triage gate can inspect them.
   */
  private async readMixedDirectoryHandleForTriage(
    rootHandle: FileSystemDirectoryHandle
  ): Promise<TriageExpandedFile[] | null> {
    type IterDir = FileSystemDirectoryHandle & {
      values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>;
    };
    const entries: { rel: string; handle: FileSystemFileHandle }[] = [];
    let hasContainer = false;
    let hasOther = false;
    const walk = async (dir: FileSystemDirectoryHandle, prefix: string, depth: number): Promise<void> => {
      for await (const entry of (dir as IterDir).values()) {
        if (entry.name.startsWith('.') || entry.name.startsWith('._') || entry.name === '__MACOSX') {
          continue;
        }
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.kind === 'file') {
          if (isTriageContainerFileName(entry.name)) {
            hasContainer = true;
          } else {
            hasOther = true;
          }
          entries.push({ rel, handle: entry as FileSystemFileHandle });
        } else if (entry.kind === 'directory' && depth < 2) {
          await walk(entry as FileSystemDirectoryHandle, rel, depth + 1);
        }
      }
    };
    await walk(rootHandle, '', 0);
    if (!hasContainer || !hasOther || entries.length < 2) return null;
    const expanded: TriageExpandedFile[] = [];
    for (const item of entries) {
      try {
        const f = await item.handle.getFile();
        expanded.push({ name: item.rel, buffer: await f.arrayBuffer() });
      } catch {
        // skip unreadable file
      }
    }
    return expanded.length >= 2 ? expanded : null;
  }

  /**
   * Folder (webkit FileList) variant: preset containers are ignored by the
   * single-format folder flows, so a mixed folder is read into memory and
   * offered to the gate. Pure folders return null and keep the fast path.
   */
  private async readMixedWebkitFilesForTriage(
    fileList: FileList
  ): Promise<TriageExpandedFile[] | null> {
    const kept: { rel: string; file: File }[] = [];
    let hasContainer = false;
    let hasOther = false;
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      const rel = (f.webkitRelativePath || f.name).replace(/\\/g, '/');
      if (rel.includes('__MACOSX/')) continue;
      const base = rel.split('/').pop() ?? f.name;
      if (base.startsWith('.') || base.startsWith('._')) continue;
      if (isTriageContainerFileName(base)) {
        hasContainer = true;
      } else {
        hasOther = true;
      }
      kept.push({ rel, file: f });
    }
    if (!hasContainer || !hasOther) return null;
    const expanded: TriageExpandedFile[] = [];
    for (const k of kept) {
      try {
        expanded.push({ name: k.rel, buffer: await k.file.arrayBuffer() });
      } catch {
        // Unreadable entries are left to the legacy flows below.
      }
    }
    return expanded.length >= 2 ? expanded : null;
  }

  async importMixedFilesOrZip(
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
        const bytes = new Uint8Array(buf);
        const isPkZip =
          bytes.byteLength >= 4 &&
          bytes[0] === 0x50 &&
          bytes[1] === 0x4b &&
          (bytes[2] === 0x03 || bytes[2] === 0x05);
        if (lower.endsWith('.zip') || lower.endsWith('.nmpack') || (lower.endsWith('.model') && isPkZip)) {
          const unzipped = parseZipArchive(bytes);
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
        if (this.ctx.session?.dirty) {
          const ok = await confirmDialog(
            'You have unsaved changes in the current session. Do you want to discard them and load the new session?',
            { confirmLabel: 'Discard & Load', cancelLabel: 'Cancel', danger: true }
          );
          if (!ok) return;
        }
        this.ctx.session = await this.ctx.core.loadSessionFromJson(sessionJsonText);
        this.ctx.selectedZoneId = this.ctx.session.zones[0]?.id || null;
        this.ctx.log(
          `${sourceLabel}: loaded session "${this.ctx.session.name}".`
        );
        this.ctx.refresh();
        return;
      }

      // Classify expanded files into model folders (<NNN>.model), loose model files, neuron bank containers, SF2/SFZ, and audio files
      const modelFolders = new Map<number, { name: string; buffer: ArrayBuffer }[]>();
      const looseModelFiles: { name: string; buffer: ArrayBuffer }[] = [];
      const neuronContainerFiles: { name: string; buffer: ArrayBuffer }[] = [];
      const audioFiles: { name: string; path?: string; buffer: ArrayBuffer }[] = [];
      const sf2Files: { name: string; buffer: ArrayBuffer }[] = [];
      const sfzFiles: { name: string; buffer: ArrayBuffer }[] = [];

      for (const item of expanded) {
        const normPath = item.name.replace(/\\/g, '/');
        if (normPath.includes('__MACOSX/')) continue;
        const base = normPath.split('/').pop() ?? normPath;
        if (base.startsWith('.') || base.startsWith('._')) continue;

        const lower = base.toLowerCase();
        if (lower.endsWith('.sf2')) {
          sf2Files.push({ name: base, buffer: item.buffer });
          continue;
        }
        if (lower.endsWith('.sfz')) {
          sfzFiles.push({ name: base, buffer: item.buffer });
          continue;
        }
        const isModelArtifact =
          lower.endsWith('.scape') ||
          lower.endsWith('.sphere') ||
          lower === 'map.script' ||
          lower === 'mname' ||
          lower.endsWith('.nmmodel') ||
          lower.endsWith('.neuronikmodel');
        const isNeuronContainer =
          lower.endsWith('.model') ||
          lower.endsWith('.nmpack') ||
          (!isModelArtifact && !isSupportedAudioFileName(lower) && isNeuronBankOrModelInput(base, item.buffer));
        const isAudio = isSupportedAudioFileName(lower);

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
        } else if (isNeuronContainer) {
          neuronContainerFiles.push(item);
        } else if (isAudio) {
          audioFiles.push({ name: base, path: normPath, buffer: item.buffer });
        }
      }

      // Fase 35 — mixed-content triage gate (folder / multi-file / .zip).
      // Genuinely mixed content opens the gate; single-format flows keep
      // their fast paths below.
      if (await this.maybeOpenTriageGate(expanded, sourceLabel, audioMode, preferredKind)) {
        return;
      }

      const isNewInstrument =
        sf2Files.length > 0 ||
        sfzFiles.length > 0 ||
        modelFolders.size > 0 ||
        looseModelFiles.length > 0 ||
        neuronContainerFiles.length > 0 ||
        audioFiles.length > 1;

      if (isNewInstrument && this.ctx.session) {
        const hasExistingContent =
          this.ctx.session.dirty ||
          this.ctx.session.zones.some((z) => Boolean(z.sampleLow || z.sampleHigh)) ||
          Boolean(this.ctx.session.extendedRegions && this.ctx.session.extendedRegions.length > 0) ||
          Boolean(this.ctx.session.processConfig.coverArtwork);

        if (hasExistingContent) {
          const ok = await confirmDialog(
            'Loading a new instrument will replace the current session. All unsaved changes, loaded samples, and cover artwork will be reset. Do you want to proceed?',
            { confirmLabel: 'Discard & Load New Instrument', cancelLabel: 'Cancel', danger: true }
          );
          if (!ok) return;
        }

        // Cleanly execute newSession first to reset all caches, cover artwork, and state!
        await this.ctx.core.newSession('New Instrument');
      }

      // If SoundFont 2 (.sf2) was provided, convert immediately into our native session format
      if (sf2Files.length > 0) {
        const sf2 = sf2Files[0];
        const presets = this.ctx.core.listSf2Presets(sf2.buffer);

        const loadPreset = async (presetIndex: number, presetName?: string) => {
          await withLoading(
            'IMPORTING SOUNDFONT (.SF2)...',
            `Processing "${sf2.name}"${presetName ? ` (Preset: "${presetName}")` : ''}, decoding PCM samples and analyzing layers...`,
            async () => {
              const session = await this.ctx.core.importSf2Buffer(sf2.buffer, presetIndex);
              this.ctx.session = session;
              this.ctx.selectedZoneId = session.zones[0]?.id || null;
              this.ctx.log(
                `${sourceLabel}: imported SF2 "${sf2.name}" -> preset "${session.name}" (${session.extendedRegions?.length ?? 0} regions, ${session.zones.length} classic zones, category: ${session.detectedInstrumentCategory ?? 'Auto'}).`
              );
              this.ctx.refresh();
            }
          );
        };

        if (presets.length > 1) {
          const multiModal = new MultiInstrumentModal();
          multiModal.open({
            fileName: sf2.name,
            format: 'sf2',
            items: presets.map((p) => ({
              id: String(p.index),
              index: p.index,
              name: p.name,
              bank: p.bank,
              presetNumber: p.presetNumber,
              regionCount: p.regionCount,
            })),
            onSelect: (item) => {
              void loadPreset(item.index, item.name);
            },
            onProcessBatch: () => {
              if (this.ctx.onOpenBatchProcessorWithSf2) {
                this.ctx.onOpenBatchProcessorWithSf2(sf2.buffer, sf2.name);
              } else if (this.ctx.onOpenBatchProcessor) {
                this.ctx.onOpenBatchProcessor();
              }
            },
          });
          return;
        }

        // Single preset
        await loadPreset(0, presets[0]?.name);
        return;
      }

      // If SFZ (.sfz) was provided, convert immediately into our native session format
      if (sfzFiles.length > 0) {
        const loadSfzFile = async (chosenSfz: { name: string; buffer: ArrayBuffer }) => {
          await withLoading(
            'IMPORTING SFZ INSTRUMENT...',
            `Decoding opcodes from "${chosenSfz.name}" and mapping regions...`,
            async () => {
              if (chosenSfz.buffer.byteLength > MAX_SFZ_TEXT_BYTES) {
                throw new Error(
                  `SFZ file too large (${chosenSfz.buffer.byteLength} bytes, max ${MAX_SFZ_TEXT_BYTES})`
                );
              }
              const sfzText = new TextDecoder('utf-8').decode(chosenSfz.buffer);
              const normalizedSfzAudio: { name: string; buffer: ArrayBuffer }[] = [];
              for (const af of audioFiles) {
                const normBuf = await transcodeAnyAudioToWavBuffer(af.buffer, af.name);
                normalizedSfzAudio.push({ name: af.name, buffer: normBuf });
              }
              const session = await this.ctx.core.importSfzText(sfzText, chosenSfz.name, normalizedSfzAudio);
              this.ctx.session = session;
              this.ctx.selectedZoneId = session.zones[0]?.id || null;
              this.ctx.log(
                `${sourceLabel}: imported SFZ "${chosenSfz.name}" -> "${session.name}" (${session.extendedRegions?.length ?? 0} regions, ${audioFiles.length} companion audio file(s)).`
              );
              this.ctx.refresh();
            }
          );
        };

        if (sfzFiles.length > 1) {
          const multiModal = new MultiInstrumentModal();
          multiModal.open({
            fileName: `${sfzFiles.length} SFZ Definitions`,
            format: 'sfz',
            items: sfzFiles.map((sfz, idx) => ({
              id: sfz.name,
              index: idx,
              name: sfz.name.replace(/\.sfz$/i, ''),
              detail: 'SFZ Instrument',
            })),
            onSelect: (item) => {
              const chosen = sfzFiles[item.index] || sfzFiles[0];
              void loadSfzFile(chosen);
            },
            onProcessBatch: () => {
              this.ctx.onOpenBatchProcessor?.();
            },
          });
          return;
        }

        await loadSfzFile(sfzFiles[0]);
        return;
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

        const pickZipSlot = (chosenSlot: number): void => {
          void (async () => {
            const files = modelFolders.get(chosenSlot);
            if (!files) return;
            const model = await this.ctx.core.importModelFiles(files);
            this.ctx.session = this.ctx.core.getSession()!;
            this.ctx.selectedZoneId = this.ctx.session.zones[0]?.id || null;
            this.ctx.log(
              `${sourceLabel}: loaded model #${String(model.slot).padStart(3, '0')} "${model.name}" (${model.zoneCount} zone(s))`
            );
            this.ctx.refresh();
          })();
        };
        this.ctx.neuronDb.open(initialEntries, pickZipSlot);
        this.setLibrarySource(initialEntries, pickZipSlot);
        return;
      }

      // Single model (either in a .zip or loose files, optionally with embedded Samples/*.wav)
      const hasLooseModernJson = looseModelFiles.some((f) => {
        const lower = f.name.toLowerCase();
        return lower.endsWith('.nmmodel') || lower.endsWith('.neuronikmodel');
      });
      if (hasModelData && (preferredKind === 'model' || audioFiles.length === 0 || hasLooseModernJson)) {
        const targetFiles =
          modelFolders.size === 1
            ? [...Array.from(modelFolders.values())[0], ...audioFiles]
            : [...looseModelFiles, ...audioFiles];
        const model = await this.ctx.core.importModelFiles(targetFiles);
        this.ctx.session = this.ctx.core.getSession()!;
        this.ctx.selectedZoneId = this.ctx.session.zones[0]?.id || null;
        this.ctx.log(
          `${sourceLabel}: imported model #${String(model.slot).padStart(3, '0')} "${model.name}" (${model.zoneCount} zone(s))`
        );
        this.ctx.refresh();
        return;
      }

      // Fase 35.1: Standalone `.model` / `.nmpack` or signature-detected Neuron bank container dropped directly
      if (neuronContainerFiles.length > 0) {
        const primaryContainer = neuronContainerFiles[0];
        const extraEntries = [
          ...neuronContainerFiles.map((nf) => ({ name: nf.name, data: new Uint8Array(nf.buffer) })),
          ...audioFiles.map((af) => ({ name: af.path ?? af.name, data: new Uint8Array(af.buffer) })),
        ];
        const applyNeuronPreset = async (targetModelId?: string) => {
          const parsedPreset = await parseNeuronBankOrModelToPreset(
            primaryContainer.name,
            primaryContainer.buffer,
            extraEntries.length > 1 ? extraEntries : undefined,
            targetModelId
          );
          const currentMode = this.ctx.session?.processConfig.workingMode ?? 'classic';
          const adapted = applyPreflightImportAdaptations(parsedPreset, {
            autoExtendOuterZones: true,
            adaptVelocityLayers: true,
            switchToExtendedMode: currentMode === 'extended',
            currentWorkingMode: currentMode,
          });
          if (!this.ctx.session) {
            this.ctx.session = await this.ctx.core.newSession(parsedPreset.modelName || 'NeuronModel');
          }
          for (const [name, buf] of adapted.audioBuffers.entries()) {
            this.ctx.core.registerSampleBuffer(name, buf);
          }
          const rawParamSet = Number(parsedPreset.suggestedParameterSet);
          const paramSet = Number.isFinite(rawParamSet) ? Math.max(0, Math.min(9, rawParamSet)) : 0;
          this.ctx.session.name = parsedPreset.modelName;
          this.ctx.session.processConfig.modelName = parsedPreset.modelName.slice(0, 11);
          this.ctx.session.processConfig.expandedName = parsedPreset.presetName;
          this.ctx.session.processConfig.parameterSet = paramSet;
          this.ctx.session.processConfig.workingMode = adapted.suggestedWorkingMode;
          this.ctx.session.zones = adapted.classicZones;
          this.ctx.session.extendedRegions = adapted.extendedRegions;
          this.ctx.session.dirty = true;
          this.ctx.selectedZoneId = adapted.classicZones[0]?.id ?? null;
          this.ctx.log(
            `${sourceLabel}: imported ${parsedPreset.formatLabel} "${parsedPreset.presetName}" (${adapted.classicZones.length} zone(s))`
          );
          this.ctx.refresh();
        };

        const modelsInArchive = listNeuronBankModels(primaryContainer.name, primaryContainer.buffer);
        if (modelsInArchive.length > 1) {
          const multiModal = new MultiInstrumentModal();
          multiModal.open({
            fileName: primaryContainer.name,
            format: 'zip',
            items: modelsInArchive.map((m) => ({
              id: m.id,
              index: m.index,
              name: m.name,
              regionCount: m.regionCount,
              detail: m.detail,
            })),
            onSelect: (chosen) => {
              void applyNeuronPreset(chosen.id);
            },
            onProcessBatch: () => {
              this.ctx.onOpenBatchProcessor?.();
            },
          });
          return;
        }

        await applyNeuronPreset();
        return;
      }

      // If a single audio file (.wav / .aif) was loaded and a session is already active,
      // load it into the active region/zone instead of discarding the session!
      if (
        audioFiles.length === 1 &&
        !hasModelData &&
        this.ctx.session &&
        this.ctx.session.zones.length > 0
      ) {
        const singleFile = audioFiles[0];
        const isExtended = this.ctx.session.processConfig.workingMode === 'extended';
        if (isExtended) {
          const regId = this.ctx.selectedZoneId || this.ctx.session.extendedRegions?.[0]?.id;
          if (regId) {
            await withLoading('LOADING AUDIO SAMPLE...', `Decoding "${singleFile.name}"...`, async () => {
              const normBuf = await transcodeAnyAudioToWavBuffer(singleFile.buffer, singleFile.name);
              this.ctx.core.registerSampleBuffer(singleFile.name, normBuf);
              await this.ctx.core.updateExtendedRegion(regId, { sampleName: singleFile.name });
              this.ctx.session = this.ctx.core.getSession()!;
              this.ctx.log(`${sourceLabel}: assigned "${singleFile.name}" to region [${regId}].`);
              this.ctx.refresh();
            });
            return;
          }
        } else {
          const activeZone =
            this.ctx.session.zones.find((z) => z.id === this.ctx.selectedZoneId) ??
            this.ctx.session.zones[0];
          if (activeZone) {
            const slot = activeZone.sampleLow ? 'high' : 'low';
            await withLoading('LOADING AUDIO SAMPLE...', `Decoding "${singleFile.name}"...`, async () => {
              const normBuf = await transcodeAnyAudioToWavBuffer(singleFile.buffer, singleFile.name);
              this.ctx.core.registerSampleBuffer(singleFile.name, normBuf);
              await this.ctx.core.updateZone(activeZone.id, slot === 'low' ? { sampleLow: singleFile.name } : { sampleHigh: singleFile.name });
              this.ctx.session = this.ctx.core.getSession()!;
              this.ctx.log(`${sourceLabel}: assigned "${singleFile.name}" to zone #${this.ctx.session.zones.indexOf(activeZone) + 1} (${slot === 'low' ? 'Low' : 'High'} Vel).`);
              this.ctx.refresh();
            });
            return;
          }
        }
      }

      // Otherwise, if audio files (.wav / .aif / .aiff) were provided (directly or inside a .zip)
      if (audioFiles.length > 0) {
        const folderInputs: FolderFileInput[] = audioFiles.map((af) => ({
          path: af.path ?? af.name,
          name: af.name,
          buffer: af.buffer,
        }));
        await this.importDeducedAudioDirectoryOrPrompt(
          folderInputs,
          `${audioFiles.length} Audio Samples`,
          audioMode,
          sourceLabel
        );
        return;
      }

      throw new Error(
        'No compatible files found (.model, .scape, .sphere, .nmmodel, .neuronikmodel, .wav, .aif or valid .zip).'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.ctx.log(`${sourceLabel} error: ${msg}`);
      toast(`Failed to import files: ${msg}`, 'error');
    }
  }

  triggerAudioImport(mode: 'samples' | 'by-name'): void {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.accept = `${SUPPORTED_AUDIO_ACCEPT},.sf2,.sfz,.zip`;
    fileInput.addEventListener('change', async () => {
      const fileList = fileInput.files;
      if (!fileList || fileList.length === 0) return;
      const modeLabel =
        mode === 'by-name' ? 'Import by Name (Ctrl+N)' : 'Import Samples / SF2 / SFZ (Ctrl+I)';
      await this.importMixedFilesOrZip(fileList, 'audio', mode, modeLabel);
    });
    fileInput.click();
  }

  triggerSamplerImport(): void {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.accept = `.sf2,.sfz,${SUPPORTED_AUDIO_ACCEPT},.zip`;
    fileInput.addEventListener('change', async () => {
      const fileList = fileInput.files;
      if (!fileList || fileList.length === 0) return;
      await this.importMixedFilesOrZip(fileList, 'audio', 'samples', 'Import SoundFont / SFZ');
    });
    fileInput.click();
  }

  triggerModelImport(): void {
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
}
