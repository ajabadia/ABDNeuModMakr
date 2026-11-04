import type { ImportContext } from '../importHandlers.ts';
import type { NeuronDbModelEntry } from '../../ui/NeuronDbModal';
import type { TriageExpandedFile } from '../triageGate.ts';

/** Host services the directory import flows need from ImportHandlers. */
export interface DirectoryImportContext {
  ctx: ImportContext;
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
  setLibrarySource: (entries: NeuronDbModelEntry[], pick: (slot: number) => void) => void;
  readMixedDirectoryHandleForTriage: (
    rootHandle: FileSystemDirectoryHandle
  ) => Promise<TriageExpandedFile[] | null>;
  maybeOpenTriageGate: (
    expanded: TriageExpandedFile[],
    sourceLabel: string,
    audioMode: 'samples' | 'by-name',
    preferredKind: 'audio' | 'model'
  ) => Promise<boolean>;
}
