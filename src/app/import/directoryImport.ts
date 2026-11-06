import type { DirectoryImportContext, ImportCtxHost } from './types.ts';
import {
  isSupportedAudioFileName,
  parseMName,
  parseModelNamesCache,
} from '@abdsynths/shared/formats/neuron';
import {
  APP_MAX_MAP_SCRIPT_TEXT_BYTES,
  parseMapScriptCapped,
} from '../../formats/ModelFormat.ts';
import { transcodeAnyAudioToWavBuffer } from '../../core/dsp/WavDecoder.ts';
import { stickModesToComplexity, type NeuronDbModelEntry } from '../../ui/NeuronDbModal';
import { toast } from '../../ui/notify';
import { loadingModal, withLoading } from '../../ui/LoadingModal';
import { yieldToUI } from '../../core/asyncUtils.ts';
import { MultiInstrumentModal, type MultiInstrumentItem } from '../../ui/MultiInstrumentModal';
import {
  extractFolderFilesToCandidates,
  extractFolderFilesToCandidatesWithAi,
  type FolderFileInput,
} from '../../core/batch/FolderBatchExtractor';

export async function importFromDirectoryHandle(
  ui: DirectoryImportContext,
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
    const loaded = await ui.readModelDirFiles(rootHandle, rootHandle.name);
    const model = await ui.ctx.core.importModelFiles(loaded);
    ui.ctx.session = ui.ctx.core.getSession()!;
    ui.ctx.selectedZoneId = ui.ctx.session.zones[0]?.id || null;
    ui.ctx.log(
      `Imported model folder #${String(model.slot).padStart(3, '0')} "${model.name}" (${model.zoneCount} zone(s))`
    );
    ui.ctx.refresh();
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
    await ui.scanSoundPresets(rootHandle, subDirs, directFiles);
    const availableSlots = Array.from(modelSubDirs.keys()).sort((a, b) => a - b);
    if (availableSlots.length === 1) {
      // A single model folder loads straight into the session on
      // configure; refresh skips it (nothing library-like to rescan).
      if (opts?.applyToSession === false) return;
      const targetDir = modelSubDirs.get(availableSlots[0])!;
      const loaded = await ui.readModelDirFiles(targetDir, targetDir.name);
      const model = await ui.ctx.core.importModelFiles(loaded);
      ui.ctx.session = ui.ctx.core.getSession()!;
      ui.ctx.selectedZoneId = ui.ctx.session.zones[0]?.id || null;
      ui.ctx.log(
        `Imported model #${String(model.slot).padStart(3, '0')} "${model.name}" (${model.zoneCount} zone(s))`
      );
      ui.ctx.refresh();
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
      ui.ctx.neuronDb.open(initialEntries, (chosenSlot) => {
        void ui.loadModelDirSlot(modelSubDirs, chosenSlot);
      });
    }
    ui.setLibrarySource(initialEntries, (slot) => {
      void ui.loadModelDirSlot(modelSubDirs, slot);
    });

    // Progressively scan lightweight headers in batches of 20 without blocking UI
    void (async () => {
      const total = initialEntries.length;
      let done = 0;
      const batchSize = 20;
      for (let i = 0; i < total; i += batchSize) {
        if (ui.ctx.neuronDb.isAborted()) return;
        const slice = initialEntries.slice(i, i + batchSize);
        await Promise.all(
          slice.map(async (item) => {
            if (ui.ctx.neuronDb.isAborted()) return;
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
                if (f.size > APP_MAX_MAP_SCRIPT_TEXT_BYTES) {
                  throw new Error(
                    `map.script too large (${item.name}: ${f.size} bytes, max ${APP_MAX_MAP_SCRIPT_TEXT_BYTES})`
                  );
                }
                const txt = await f.text();
                const ms = parseMapScriptCapped(txt, item.name);
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
              ui.ctx.neuronDb.updateEntry(item);
            } catch {
              // ignore individual corrupt folder
            }
          })
        );
        done = Math.min(total, i + batchSize);
        ui.ctx.neuronDb.setScanProgress(done, total);
      }
    })();
    return;
  }

  // 3. Otherwise collect `.wav` / `.aif` / `.aiff` audio files (recursively up to 1 level)
  // Refresh never replaces the editor session with audio imports.
  if (opts?.applyToSession === false) return;

  // Fase 35 — DirectoryHandle triage gate (`showDirectoryPicker`):
  // Mixed folders carrying preset containers + audio/models open the triage gate.
  const mixedDirFiles = await ui.readMixedDirectoryHandleForTriage(rootHandle);
  if (
    mixedDirFiles &&
    (await ui.maybeOpenTriageGate(
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
      } else if (entry.kind === 'directory' && depth < 8) {
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
    ui.ctx.log(`Folder import: ${msg}`);
    toast(msg, 'warning');
    return;
  }

  await importDeducedAudioDirectoryOrPrompt(ui, 
    folderInputs,
    rootHandle.name || 'Sample Folder',
    'samples',
    'Import Folder'
  );
}

export async function importDeducedAudioDirectoryOrPrompt(
  ui: ImportCtxHost,
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
        for (let idx = 0; idx < files.length; idx++) {
          const f = files[idx];
          if (idx > 0 && idx % 4 === 0) {
            loadingModal.setMessage(
              `Decoding audio sample ${idx + 1} / ${files.length}${instrumentName ? ` ("${instrumentName}")` : ''}...`
            );
            await yieldToUI(0);
          }
          const normBuf = await transcodeAnyAudioToWavBuffer(f.buffer, f.name);
          normalizedFiles.push({ name: f.name, buffer: normBuf });
        }
        loadingModal.setMessage(
          `Mapping ${normalizedFiles.length} sample(s) to MIDI key zones...`
        );
        await yieldToUI(0);
        const zones = await ui.ctx.core.importAudioFiles(normalizedFiles, audioMode);
        ui.ctx.session = ui.ctx.core.getSession()!;
        if (instrumentName && ui.ctx.session) {
          ui.ctx.session.name = instrumentName;
          ui.ctx.session.processConfig.modelName = instrumentName.slice(0, 11);
        }
        ui.ctx.selectedZoneId = zones[0]?.id || null;
        ui.ctx.log(
          `${sourceLabel}: mapped ${files.length} audio file(s)${instrumentName ? ` ("${instrumentName}")` : ''} into ${zones.length} contiguous zone(s).`
        );
        ui.ctx.refresh();
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
        if (ui.ctx.onOpenBatchProcessorWithCandidates) {
          ui.ctx.onOpenBatchProcessorWithCandidates(candidates, containerName);
        } else {
          ui.ctx.onOpenBatchProcessor?.();
        }
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
