// ─────────────────────────────────────────────────────────
// ImportHandlers — sample / session / model / NeuronDB import flows
// Extracted verbatim from App (src/main.ts). All mutable shell state
// (session, selection) and UI side-effects (log, refresh, drawers)
// go through ImportContext so this module owns no DOM singletons.
// ─────────────────────────────────────────────────────────

import type { CoreService, Session, Zone } from '../core';
import type { BankDrawer } from '../ui/BankDrawer';
import type { NeuronDbModal } from '../ui/NeuronDbModal';
import { SUPPORTED_AUDIO_ACCEPT } from '@abdsynths/shared/formats/neuron';
import { transcodeAnyAudioToWavBuffer } from '../core/dsp/WavDecoder.ts';
import { type NeuronDbModelEntry } from '../ui/NeuronDbModal';
import { toast, confirmDialog } from '../ui/notify';
import { consumeMigrationNotes } from '../core/sessionSchema.ts';
import { importFromDirectoryHandle } from './import/directoryImport.ts';
import type { DirectoryImportContext, WebkitImportContext , MixedImportContext } from './import/types.ts';
import { importFromWebkitFileList } from './import/webkitImport.ts';
import type { TriageOpsContext } from './import/types.ts';
import {
  expandNestedZipBuffer,
  maybeOpenTriageGate,
  readMixedDirectoryHandleForTriage,
} from './import/triageOps.ts';
import { importMixedFilesOrZip } from './import/mixedImport.ts';
import {
  loadModelDirSlot as loadModelDirSlotImpl,
  readModelDirFiles as readModelDirFilesImpl,
  scanSoundPresets as scanSoundPresetsFrom,
} from './import/neuronLibraryOps.ts';
import { withLoading } from '../ui/LoadingModal';
import type { BatchModelCandidate } from '../core/batch/types';
import { type TriageExpandedFile } from './triageGate.ts';

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
  onOpenBatchProcessorWithFiles?: (files: Array<{ name: string; buffer: ArrayBuffer }>, originTitle?: string) => void;
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
        // Fase 44.1.2: avisar UNA vez si la sesión migró con defaults.
        for (const n of consumeMigrationNotes()) {
          const msg =
            n === 'ai-stages-6-8-defaulted'
              ? 'Sesión migrada: etapas IA 6/7/8 a DSP por defecto (la sesión no las traía).'
              : 'Sesión migrada: superficie unificada por defecto (la sesión no la traía).';
          this.ctx.log(msg);
          toast(msg, 'info');
        }
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
    await scanSoundPresetsFrom({ ctx: this.ctx }, rootHandle, subDirs, directFiles);
  }

  private readModelDirFiles(
    modelDir: FileSystemDirectoryHandle,
    folderPrefix: string
  ): Promise<{ name: string; buffer: ArrayBuffer }[]> {
    return readModelDirFilesImpl(modelDir, folderPrefix);
  }

  private loadModelDirSlot(modelSubDirs: Map<number, FileSystemDirectoryHandle>, slot: number): Promise<void> {
    return loadModelDirSlotImpl({ ctx: this.ctx }, modelSubDirs, slot);
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

  async importFromDirectoryHandle(
    rootHandle: FileSystemDirectoryHandle,
    preferredKind: 'audio' | 'model',
    opts?: { openModal?: boolean; applyToSession?: boolean }
  ): Promise<void> {
    await importFromDirectoryHandle(this.dirImportCtx(), rootHandle, preferredKind, opts);
  }

  private dirImportCtx(): DirectoryImportContext {
    const host = this;
    return {
      ctx: host.ctx,
      readModelDirFiles: (modelDir, folderPrefix) => host.readModelDirFiles(modelDir, folderPrefix),
      scanSoundPresets: (rootHandle, subDirs, directFiles) =>
        host.scanSoundPresets(rootHandle, subDirs, directFiles),
      loadModelDirSlot: (modelSubDirs, chosenSlot) => host.loadModelDirSlot(modelSubDirs, chosenSlot),
      setLibrarySource: (entries, pick) => host.setLibrarySource(entries, pick),
      readMixedDirectoryHandleForTriage: (rootHandle) =>
        host.readMixedDirectoryHandleForTriage(rootHandle),
      maybeOpenTriageGate: (expanded, sourceLabel, audioMode, preferredKind) =>
        host.maybeOpenTriageGate(expanded, sourceLabel, audioMode, preferredKind),
    };
  }

  async importFromWebkitFileList(
    fileList: FileList,
    preferredKind: 'audio' | 'model',
    opts?: { openModal?: boolean; applyToSession?: boolean }
  ): Promise<void> {
    await importFromWebkitFileList(this.webkitImportCtx(), fileList, preferredKind, opts);
  }

  private webkitImportCtx(): WebkitImportContext {
    const host = this;
    return {
      ctx: host.ctx,
      setLibrarySource: (entries, pick) => host.setLibrarySource(entries, pick),
      maybeOpenTriageGate: (expanded, sourceLabel, audioMode, preferredKind) =>
        host.maybeOpenTriageGate(expanded, sourceLabel, audioMode, preferredKind),
      expandNestedZipBuffer: (bytes, prefix, out, depth) =>
        host.expandNestedZipBuffer(bytes, prefix, out, depth),
    };
  }

  // ─────────────────────────────────────────────────────────
  // Fase 35 — triage gate: el flujo vive en ./import/triageOps.ts.
  // ─────────────────────────────────────────────────────────
  private async maybeOpenTriageGate(
    expanded: TriageExpandedFile[],
    sourceLabel: string,
    audioMode: 'samples' | 'by-name',
    preferredKind: 'audio' | 'model'
  ): Promise<boolean> {
    return maybeOpenTriageGate(this.triageCtx(), expanded, sourceLabel, audioMode, preferredKind);
  }

  private expandNestedZipBuffer(
    bytes: Uint8Array,
    prefix: string,
    out: { name: string; buffer: ArrayBuffer }[],
    depth = 0
  ): void {
    expandNestedZipBuffer(bytes, prefix, out, depth);
  }

  private async readMixedDirectoryHandleForTriage(
    rootHandle: FileSystemDirectoryHandle
  ): Promise<TriageExpandedFile[] | null> {
    return readMixedDirectoryHandleForTriage(rootHandle);
  }

  private triageCtx(): TriageOpsContext {
    const host = this;
    return {
      ctx: host.ctx,
      importMixedFilesOrZip: (files, preferredKind, audioMode, sourceLabel) =>
        host.importMixedFilesOrZip(files, preferredKind, audioMode, sourceLabel),
    };
  }

  async importMixedFilesOrZip(
    fileList: FileList,
    preferredKind: 'audio' | 'model',
    audioMode: 'samples' | 'by-name' = 'samples',
    sourceLabel = 'Import'
  ): Promise<void> {
    await importMixedFilesOrZip(this.mixedImportCtx(), fileList, preferredKind, audioMode, sourceLabel);
  }

  private mixedImportCtx(): MixedImportContext {
    const host = this;
    return {
      ctx: host.ctx,
      setLibrarySource: (entries, pick) => host.setLibrarySource(entries, pick),
      maybeOpenTriageGate: (expanded, sourceLabel, audioMode, preferredKind) =>
        host.maybeOpenTriageGate(expanded, sourceLabel, audioMode, preferredKind),
    };
  }

  triggerAudioImport(mode: 'samples' | 'by-name'): void {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.accept = `${SUPPORTED_AUDIO_ACCEPT},.sf2,.sfz,.zip,.iso,.img,.dsk,.bin,.hda,.out,.efe,.ede,.gkh,.e4b,.esi,.exb,.xpn,.xpm,.xty,.xtd,.dspreset,.nki,.vstpreset,.fxp,.multisample,.adv,.exs,.talsmpl,.txprog,.kmp,.ksf,.dls,.akp,.pgm,.set,.krz,.k25,.k26,.x7u,.x8u,.x3a,.fzv,.fzf,.s3p,.sxt,.dwp`;
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
    fileInput.accept = `.sf2,.sfz,.iso,.img,.dsk,.bin,.hda,.out,.efe,.ede,.gkh,.e4b,.esi,.exb,.xpn,.xpm,.xty,.xtd,.dspreset,.nki,.vstpreset,.fxp,.multisample,.adv,.exs,.talsmpl,.txprog,.kmp,.ksf,.dls,.akp,.pgm,.set,.krz,.k25,.k26,.x7u,.x8u,.x3a,.fzv,.fzf,.s3p,.sxt,.dwp,${SUPPORTED_AUDIO_ACCEPT},.zip`;
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
