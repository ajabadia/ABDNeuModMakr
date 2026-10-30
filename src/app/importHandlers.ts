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
  parseMName,
  parseMapScript,
  parseModelNamesCache,
  parseSoundNamesCache,
  parseSoundScript,
  parseZipArchive,
} from '@abdsynths/shared/formats/neuron';
import { stickModesToComplexity, type NeuronDbModelEntry } from '../ui/NeuronDbModal';
import { toast } from '../ui/notify';
import { withLoading } from '../ui/LoadingModal';

export interface ImportContext {
  core: CoreService;
  session: Session | null;
  selectedZoneId: string | null;
  log(msg: string): void;
  refresh(): void;
  readonly bank: BankDrawer;
  readonly neuronDb: NeuronDbModal;
  onDropCoverImage?: (file: File) => Promise<void> | void;
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
      await withLoading('CARGANDO MUESTRA DE AUDIO...', `Decodificando "${file.name}"...`, async () => {
        const buffer = await file.arrayBuffer();
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
      await withLoading('CARGANDO MUESTRA DE AUDIO...', `Decodificando "${file.name}"...`, async () => {
        const buffer = await file.arrayBuffer();
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
      this.ctx.log(`Folder import: ${msg}`);
      toast(msg, 'warning');
      return;
    }

    const zones = await this.ctx.core.importAudioFiles(audioFiles, 'samples');
    this.ctx.session = this.ctx.core.getSession()!;
    this.ctx.selectedZoneId = zones[0]?.id || null;
    this.ctx.log(
      `Import Folder: mapped ${audioFiles.length} audio file(s) into ${zones.length} contiguous zone(s).`
    );
    this.ctx.refresh();
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
        if (lower.endsWith('.wav') || lower.endsWith('.aif') || lower.endsWith('.aiff')) {
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

      const audioFiles: { name: string; buffer: ArrayBuffer }[] = [];
      for (const f of audioFileEntries) {
        const buffer = await f.arrayBuffer();
        audioFiles.push({ name: f.name, buffer });
      }
      const zones = await this.ctx.core.importAudioFiles(audioFiles, 'samples');
      this.ctx.session = this.ctx.core.getSession()!;
      this.ctx.selectedZoneId = zones[0]?.id || null;
      this.ctx.log(
        `Import Folder: mapped ${audioFiles.length} audio file(s) into ${zones.length} contiguous zone(s).`
      );
      this.ctx.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.ctx.log(`Folder import error: ${msg}`);
      toast(`Failed to import folder: ${msg}`, 'error');
    }
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
        this.ctx.session = await this.ctx.core.loadSessionFromJson(sessionJsonText);
        this.ctx.selectedZoneId = this.ctx.session.zones[0]?.id || null;
        this.ctx.log(
          `${sourceLabel}: loaded session "${this.ctx.session.name}".`
        );
        this.ctx.refresh();
        return;
      }

      // Classify expanded files into model folders (<NNN>.model), loose model files, SF2/SFZ, and audio files
      const modelFolders = new Map<number, { name: string; buffer: ArrayBuffer }[]>();
      const looseModelFiles: { name: string; buffer: ArrayBuffer }[] = [];
      const audioFiles: { name: string; buffer: ArrayBuffer }[] = [];
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

      // If SoundFont 2 (.sf2) was provided, convert immediately into our native session format
      if (sf2Files.length > 0) {
        const sf2 = sf2Files[0];
        await withLoading(
          'IMPORTANDO SOUNDFONT (.SF2)...',
          `Procesando "${sf2.name}", decodificando muestras PCM y analizando capas...`,
          async () => {
            const presets = this.ctx.core.listSf2Presets(sf2.buffer);
            const session = await this.ctx.core.importSf2Buffer(sf2.buffer, 0);
            this.ctx.session = session;
            this.ctx.selectedZoneId = session.zones[0]?.id || null;
            this.ctx.log(
              `${sourceLabel}: imported SF2 "${sf2.name}" -> preset "${session.name}" (${session.extendedRegions?.length ?? 0} regions, ${session.zones.length} classic zones, category: ${session.detectedInstrumentCategory ?? 'Auto'}, ${presets.length} preset(s) in file).`
            );
            this.ctx.refresh();
          }
        );
        return;
      }

      // If SFZ (.sfz) was provided, convert immediately into our native session format
      if (sfzFiles.length > 0) {
        const sfz = sfzFiles[0];
        await withLoading(
          'IMPORTANDO INSTRUMENTO SFZ...',
          `Decodificando opcodes de "${sfz.name}" y mapeando muestras...`,
          async () => {
            const sfzText = new TextDecoder('utf-8').decode(sfz.buffer);
            const session = await this.ctx.core.importSfzText(sfzText, sfz.name, audioFiles);
            this.ctx.session = session;
            this.ctx.selectedZoneId = session.zones[0]?.id || null;
            this.ctx.log(
              `${sourceLabel}: imported SFZ "${sfz.name}" -> "${session.name}" (${session.extendedRegions?.length ?? 0} regions, ${audioFiles.length} companion audio file(s)).`
            );
            this.ctx.refresh();
          }
        );
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

      // Otherwise, if audio files (.wav / .aif / .aiff) were provided (directly or inside a .zip)
      if (audioFiles.length > 0) {
        await withLoading(
          'CARGANDO MUESTRAS DE AUDIO...',
          `Mapeando y decodificando ${audioFiles.length} archivo(s) de audio...`,
          async () => {
            const zones = await this.ctx.core.importAudioFiles(audioFiles, audioMode);
            this.ctx.session = this.ctx.core.getSession()!;
            this.ctx.selectedZoneId = zones[0]?.id || null;
            this.ctx.log(
              `${sourceLabel}: mapped ${audioFiles.length} audio file(s) into ${zones.length} contiguous zone(s).`
            );
            this.ctx.refresh();
          }
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
    fileInput.accept = '.wav,.aif,.aiff,.sf2,.sfz,.zip';
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
    fileInput.accept = '.sf2,.sfz,.wav,.aif,.aiff,.zip';
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
