import { parseSoundNamesCache, parseSoundScript } from '@abdsynths/shared/formats/neuron';
import { PARAMETER_SETS, type SoundPreset } from '../../core';
import { toast } from '../../ui/notify';
import type { ImportCtxHost } from './types.ts';

export async function scanSoundPresets(
  ui: ImportCtxHost,
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
    ui.ctx.core.setBankPresets(presets);
    const bank = await ui.ctx.core.loadBank();
    ui.ctx.bank.setBank(bank, ui.ctx.session?.processConfig.modelNumber ?? null);
    ui.ctx.log(`Loaded ${presets.length} sound preset(s) from NeuronDB.`);
  }
}

export async function readModelDirFiles(
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

export async function loadModelDirSlot(
  ui: ImportCtxHost,
  modelSubDirs: Map<number, FileSystemDirectoryHandle>,
  chosenSlot: number
): Promise<void> {
  try {
    const targetDir = modelSubDirs.get(chosenSlot);
    if (!targetDir) return;
    const loaded = await readModelDirFiles(targetDir, targetDir.name);
    const model = await ui.ctx.core.importModelFiles(loaded);
    ui.ctx.session = ui.ctx.core.getSession()!;
    ui.ctx.selectedZoneId = ui.ctx.session.zones[0]?.id || null;
    ui.ctx.log(
      `Imported model #${String(model.slot).padStart(3, '0')} "${model.name}" (${model.zoneCount} zone(s))`
    );
    ui.ctx.refresh();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ui.ctx.log(`Error loading model #${chosenSlot}: ${msg}`);
    toast(`Failed to load model #${String(chosenSlot).padStart(3, '0')}: ${msg}`, 'error');
  }
}
