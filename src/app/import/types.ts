import type { ImportContext } from '../importHandlers.ts';
import type { NeuronDbModelEntry } from '../../ui/NeuronDbModal';
import type { TriageExpandedFile } from '../triageGate.ts';

/** Host services the directory import flows need from ImportHandlers. */
export interface ImportCtxHost {
  ctx: ImportContext;
}

export interface DirectoryImportContext extends ImportCtxHost {
  readModelDirFiles: (
    modelDir: FileSystemDirectoryHandle,
    folderPrefix: string
  ) => Promise<{ name: string; buffer: ArrayBuffer }[]>;
  scanSoundPresets: (
    rootHandle: FileSystemDirectoryHandle,
    subDirs: Map<string, FileSystemDirectoryHandle>,
    directFiles: FileSystemFileHandle[]
  ) => Promise<void>;
  loadModelDirSlot: (
    modelSubDirs: Map<number, FileSystemDirectoryHandle>,
    chosenSlot: number
  ) => Promise<void>;
  setLibrarySource: SetLibrarySourceFn;
  readMixedDirectoryHandleForTriage: (
    rootHandle: FileSystemDirectoryHandle
  ) => Promise<TriageExpandedFile[] | null>;
  maybeOpenTriageGate: TriageGateFn;
}

export type TriageGateFn = (
  expanded: TriageExpandedFile[],
  sourceLabel: string,
  audioMode: 'samples' | 'by-name',
  preferredKind: 'audio' | 'model'
) => Promise<boolean>;

export type SetLibrarySourceFn = (
  entries: NeuronDbModelEntry[],
  pick: (slot: number) => void
) => void;

/** Host services the WebKit folder/file-list import needs from ImportHandlers. */
export interface WebkitImportContext extends ImportCtxHost {
  setLibrarySource: SetLibrarySourceFn;
  maybeOpenTriageGate: TriageGateFn;
  expandNestedZipBuffer: (
    bytes: Uint8Array,
    prefix: string,
    out: { name: string; buffer: ArrayBuffer }[],
    depth?: number
  ) => Promise<void>;
}

/** Host services the mixed-content triage gate needs from ImportHandlers. */
export interface TriageOpsContext extends ImportCtxHost {
  importMixedFilesOrZip: (
    files: FileList,
    preferredKind: 'audio' | 'model',
    audioMode: 'samples' | 'by-name',
    sourceLabel: string
  ) => Promise<void>;
}

/** Host services the multi-file / zip import needs from ImportHandlers. */
export interface MixedImportContext extends ImportCtxHost {
  setLibrarySource: SetLibrarySourceFn;
  maybeOpenTriageGate: TriageGateFn;
}
