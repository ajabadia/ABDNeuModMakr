import type { WebkitImportContext } from './types.ts';
import { isTriageContainerFileName, type TriageExpandedFile } from '../triageGate.ts';
import {
  isSupportedAudioFileName,
  parseMName,
} from '@abdsynths/shared/formats/neuron';
import {
  APP_MAX_MAP_SCRIPT_TEXT_BYTES,
  parseMapScriptCapped,
} from '../../formats/ModelFormat.ts';
import { stickModesToComplexity, type NeuronDbModelEntry } from '../../ui/NeuronDbModal';
import { toast } from '../../ui/notify';
import type { FolderFileInput } from '../../core/batch/FolderBatchExtractor';
import { importDeducedAudioDirectoryOrPrompt } from './directoryImport.ts';

export async function importFromWebkitFileList(
  ui: WebkitImportContext,
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
    const mixedFolder = await readMixedWebkitFilesForTriage(ui, fileList);
    if (mixedFolder && (await ui.maybeOpenTriageGate(mixedFolder, 'Dropped Folder', 'samples', preferredKind))) {
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
        const model = await ui.ctx.core.importModelFiles(loaded);
        ui.ctx.session = ui.ctx.core.getSession()!;
        ui.ctx.selectedZoneId = ui.ctx.session.zones[0]?.id || null;
        ui.ctx.log(
          `Imported model folder #${String(model.slot).padStart(3, '0')} "${model.name}" (${model.zoneCount} zone(s))`
        );
        ui.ctx.refresh();
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
        ui.ctx.neuronDb.open(initialEntries, (chosenSlot) => {
          const files = modelFolders.get(chosenSlot);
          if (files) {
            void loadSlotFiles(files);
          }
        });
      }
      ui.setLibrarySource(initialEntries, (slot) => {
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
          if (ui.ctx.neuronDb.isAborted()) return;
          const slice = initialEntries.slice(i, i + batchSize);
          await Promise.all(
            slice.map(async (item) => {
              if (ui.ctx.neuronDb.isAborted()) return;
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
                if (mapScriptFile.size > APP_MAX_MAP_SCRIPT_TEXT_BYTES) {
                  throw new Error(
                    `map.script too large (${mapScriptFile.name}: ${mapScriptFile.size} bytes, max ${APP_MAX_MAP_SCRIPT_TEXT_BYTES})`
                  );
                }
                const txt = await mapScriptFile.text();
                const ms = parseMapScriptCapped(txt, mapScriptFile.name);
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
              ui.ctx.neuronDb.updateEntry(item);
            })
          );
          ui.ctx.neuronDb.setScanProgress(Math.min(total, i + batchSize), total);
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
    await importDeducedAudioDirectoryOrPrompt(ui, 
      folderInputs,
      rootFolderName,
      'samples',
      'Import Folder'
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ui.ctx.log(`Folder import error: ${msg}`);
    toast(`Failed to import folder: ${msg}`, 'error');
  }
}

async function readMixedWebkitFilesForTriage(
  ui: WebkitImportContext,
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
  if (!hasContainer || (!hasOther && kept.length < 1)) return null;
  const expanded: TriageExpandedFile[] = [];
  for (const k of kept) {
    try {
      const buf = await k.file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const isPkZip =
        k.rel.toLowerCase().endsWith('.zip') &&
        bytes.byteLength >= 4 &&
        bytes[0] === 0x50 &&
        bytes[1] === 0x4b &&
        (bytes[2] === 0x03 || bytes[2] === 0x05);
      if (isPkZip) {
        await ui.expandNestedZipBuffer(bytes, k.rel.replace(/\.zip$/i, ''), expanded, 1);
      } else {
        expanded.push({ name: k.rel, buffer: buf });
      }
    } catch {
      // Unreadable entries are left to the legacy flows below.
    }
  }
  return expanded.length >= 2 ? expanded : null;
}
