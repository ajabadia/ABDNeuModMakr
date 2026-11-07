// ─────────────────────────────────────────────────────────
// ImportHandlers — sample / session / model / NeuronDB import flows
// Extracted verbatim from App (src/main.ts). All mutable shell state
// (session, selection) and UI side-effects (log, refresh, drawers)
// go through ImportContext so this module owns no DOM singletons.
// ─────────────────────────────────────────────────────────

import { isSupportedAudioFileName, parseMName } from '@abdsynths/shared/formats/neuron';
import { assertMapScriptBufferSafe, parseMapScriptCapped } from '../../formats/ModelFormat.ts';
import { transcodeAnyAudioToWavBuffer } from '../../core/dsp/WavDecoder.ts';
import { stickModesToComplexity, type NeuronDbModelEntry } from '../../ui/NeuronDbModal';
import { toast, confirmDialog } from '../../ui/notify';
import { importDeducedAudioDirectoryOrPrompt } from './directoryImport.ts';
import { expandNestedZipBuffer } from './triageOps.ts';
import { withLoading } from '../../ui/LoadingModal';
import { MultiInstrumentModal } from '../../ui/MultiInstrumentModal';
import { type FolderFileInput } from '../../core/batch/FolderBatchExtractor';
import { applyPreflightImportAdaptations } from '../../core/import/importPreflight.ts';
import {
  isNeuronBankOrModelInput,
  listNeuronBankModels,
  parseNeuronBankOrModelToPreset,
} from '../../core/import/neuronBankImporter.ts';
import { identifyDiskImageFormat } from '@abdsynths/shared/formats/sampler';

import type { MixedImportContext } from './types.ts';
import { importSf2SfzFiles } from './sf2SfzImport.ts';
import { importUniversalSamplerFiles } from './universalSamplerImport.ts';

/**
 * Folder (webkit FileList) variant: preset containers are ignored by the
 * single-format folder flows, so a mixed folder is read into memory and
 * offered to the gate. Pure folders return null and keep the fast path.
 */
export async function importMixedFilesOrZip(
  ui: MixedImportContext,
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
        await expandNestedZipBuffer(bytes, '', expanded, 0);
      } else {
        expanded.push({ name: f.name, buffer: buf });
      }
    }

    if (sessionJsonText && expanded.length === 0) {
      if (ui.ctx.session?.dirty) {
        const ok = await confirmDialog(
          'You have unsaved changes in the current session. Do you want to discard them and load the new session?',
          { confirmLabel: 'Discard & Load', cancelLabel: 'Cancel', danger: true }
        );
        if (!ok) return;
      }
      ui.ctx.session = await ui.ctx.core.loadSessionFromJson(sessionJsonText);
      ui.ctx.selectedZoneId = ui.ctx.session.zones[0]?.id || null;
      ui.ctx.log(
        `${sourceLabel}: loaded session "${ui.ctx.session.name}".`
      );
      ui.ctx.refresh();
      return;
    }

    // Classify expanded files into model folders (<NNN>.model), loose model files, neuron bank containers, SF2/SFZ, and audio files
    const modelFolders = new Map<number, { name: string; buffer: ArrayBuffer }[]>();
    const looseModelFiles: { name: string; buffer: ArrayBuffer }[] = [];
    const neuronContainerFiles: { name: string; buffer: ArrayBuffer }[] = [];
    const audioFiles: { name: string; path?: string; buffer: ArrayBuffer }[] = [];
    const sf2Files: { name: string; buffer: ArrayBuffer }[] = [];
    const sfzFiles: { name: string; buffer: ArrayBuffer }[] = [];
    const universalSamplerFiles: { name: string; path: string; buffer: ArrayBuffer }[] = [];

    const universalSamplerExtRe =
      /\.(iso|img|dsk|bin|hda|out|efe|ede|gkh|e4b|esi|exb|xpn|xpm|xty|xtd|dspreset|nki|vstpreset|fxp|multisample|adv|exs|talsmpl|txprog|kmp|ksf|dls|qpat|tvpst|dexpreset|grp|kit|s24|korgmultisample|3wv|svz|akp|pgm|set|krz|k25|k26|x7u|x8u|x3a|fzv|fzf|synx|cmi|cmi3|vc|s3p|sxt|dwp|sbpack|sbx|zmap|prt_omn|mxsnd|mxgrp|nicnt|rx2|rex|rcy)$/i;

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
      if (universalSamplerExtRe.test(lower) || identifyDiskImageFormat(item.buffer) !== 'unknown') {
        universalSamplerFiles.push({ name: base, path: normPath, buffer: item.buffer });
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
    if (await ui.maybeOpenTriageGate(expanded, sourceLabel, audioMode, preferredKind)) {
      return;
    }

    const isNewInstrument =
      sf2Files.length > 0 ||
      sfzFiles.length > 0 ||
      universalSamplerFiles.length > 0 ||
      modelFolders.size > 0 ||
      looseModelFiles.length > 0 ||
      neuronContainerFiles.length > 0 ||
      audioFiles.length > 1;

    if (isNewInstrument && ui.ctx.session) {
      const hasExistingContent =
        ui.ctx.session.dirty ||
        ui.ctx.session.zones.some((z) => Boolean(z.sampleLow || z.sampleHigh)) ||
        Boolean(ui.ctx.session.extendedRegions && ui.ctx.session.extendedRegions.length > 0) ||
        Boolean(ui.ctx.session.processConfig.coverArtwork);

      if (hasExistingContent) {
        const ok = await confirmDialog(
          'Loading a new instrument will replace the current session. All unsaved changes, loaded samples, and cover artwork will be reset. Do you want to proceed?',
          { confirmLabel: 'Discard & Load New Instrument', cancelLabel: 'Cancel', danger: true }
        );
        if (!ok) return;
      }

      // Cleanly execute newSession first to reset all caches, cover artwork, and state!
      await ui.ctx.core.newSession('New Instrument');
    }

    // If SoundFont 2 (.sf2) was provided, convert immediately into our native session format
    if (await importSf2SfzFiles(ui, sf2Files, sfzFiles, audioFiles, expanded, sourceLabel)) {
      return;
    }

    // If a Universal Sampler / Vintage Disk Image (.iso, .img, .dsk, .e4b, .xpn, .xpm, .dspreset, .exs, .fxp, .kmp, .dls, .krz, .x7u, etc.) was provided
    if (universalSamplerFiles.length > 0) {
      await importUniversalSamplerFiles(
        ui,
        universalSamplerFiles,
        audioFiles,
        expanded,
        sourceLabel
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
            assertMapScriptBufferSafe(f.buffer, f.name);
            const txt = new TextDecoder('latin1').decode(f.buffer);
            const ms = parseMapScriptCapped(txt, f.name);
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
          const model = await ui.ctx.core.importModelFiles(files);
          ui.ctx.session = ui.ctx.core.getSession()!;
          ui.ctx.selectedZoneId = ui.ctx.session.zones[0]?.id || null;
          ui.ctx.log(
            `${sourceLabel}: loaded model #${String(model.slot).padStart(3, '0')} "${model.name}" (${model.zoneCount} zone(s))`
          );
          ui.ctx.refresh();
        })();
      };
      ui.ctx.neuronDb.open(initialEntries, pickZipSlot);
      ui.setLibrarySource(initialEntries, pickZipSlot);
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
      const model = await ui.ctx.core.importModelFiles(targetFiles);
      ui.ctx.session = ui.ctx.core.getSession()!;
      ui.ctx.selectedZoneId = ui.ctx.session.zones[0]?.id || null;
      ui.ctx.log(
        `${sourceLabel}: imported model #${String(model.slot).padStart(3, '0')} "${model.name}" (${model.zoneCount} zone(s))`
      );
      ui.ctx.refresh();
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
        const currentMode = ui.ctx.session?.processConfig.workingMode ?? 'classic';
        const adapted = applyPreflightImportAdaptations(parsedPreset, {
          autoExtendOuterZones: true,
          adaptVelocityLayers: true,
          switchToExtendedMode: currentMode === 'extended',
          currentWorkingMode: currentMode,
        });
        if (!ui.ctx.session) {
          ui.ctx.session = await ui.ctx.core.newSession(parsedPreset.modelName || 'NeuronModel');
        }
        for (const [name, buf] of adapted.audioBuffers.entries()) {
          ui.ctx.core.registerSampleBuffer(name, buf);
        }
        const rawParamSet = Number(parsedPreset.suggestedParameterSet);
        const paramSet = Number.isFinite(rawParamSet) ? Math.max(0, Math.min(9, rawParamSet)) : 0;
        ui.ctx.session.name = parsedPreset.modelName;
        ui.ctx.session.processConfig.modelName = parsedPreset.modelName.slice(0, 11);
        ui.ctx.session.processConfig.expandedName = parsedPreset.presetName;
        ui.ctx.session.processConfig.parameterSet = paramSet;
        ui.ctx.session.processConfig.workingMode = adapted.suggestedWorkingMode;
        ui.ctx.session.zones = adapted.classicZones;
        ui.ctx.session.extendedRegions = adapted.extendedRegions;
        ui.ctx.session.dirty = true;
        ui.ctx.selectedZoneId = adapted.classicZones[0]?.id ?? null;
        ui.ctx.log(
          `${sourceLabel}: imported ${parsedPreset.formatLabel} "${parsedPreset.presetName}" (${adapted.classicZones.length} zone(s))`
        );
        ui.ctx.refresh();
      };

      const modelsInArchive = await listNeuronBankModels(primaryContainer.name, primaryContainer.buffer);
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
            if (ui.ctx.onOpenBatchProcessorWithFiles) {
              ui.ctx.onOpenBatchProcessorWithFiles(expanded, primaryContainer.name);
            } else {
              ui.ctx.onOpenBatchProcessor?.();
            }
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
      ui.ctx.session &&
      ui.ctx.session.zones.length > 0
    ) {
      const singleFile = audioFiles[0];
      const isExtended = ui.ctx.session.processConfig.workingMode === 'extended';
      if (isExtended) {
        const regId = ui.ctx.selectedZoneId || ui.ctx.session.extendedRegions?.[0]?.id;
        if (regId) {
          await withLoading('LOADING AUDIO SAMPLE...', `Decoding "${singleFile.name}"...`, async () => {
            const normBuf = await transcodeAnyAudioToWavBuffer(singleFile.buffer, singleFile.name);
            ui.ctx.core.registerSampleBuffer(singleFile.name, normBuf);
            await ui.ctx.core.updateExtendedRegion(regId, { sampleName: singleFile.name });
            ui.ctx.session = ui.ctx.core.getSession()!;
            ui.ctx.log(`${sourceLabel}: assigned "${singleFile.name}" to region [${regId}].`);
            ui.ctx.refresh();
          });
          return;
        }
      } else {
        const activeZone =
          ui.ctx.session.zones.find((z) => z.id === ui.ctx.selectedZoneId) ??
          ui.ctx.session.zones[0];
        if (activeZone) {
          const slot = activeZone.sampleLow ? 'high' : 'low';
          await withLoading('LOADING AUDIO SAMPLE...', `Decoding "${singleFile.name}"...`, async () => {
            const normBuf = await transcodeAnyAudioToWavBuffer(singleFile.buffer, singleFile.name);
            ui.ctx.core.registerSampleBuffer(singleFile.name, normBuf);
            await ui.ctx.core.updateZone(activeZone.id, slot === 'low' ? { sampleLow: singleFile.name } : { sampleHigh: singleFile.name });
            ui.ctx.session = ui.ctx.core.getSession()!;
            ui.ctx.log(`${sourceLabel}: assigned "${singleFile.name}" to zone #${ui.ctx.session.zones.indexOf(activeZone) + 1} (${slot === 'low' ? 'Low' : 'High'} Vel).`);
            ui.ctx.refresh();
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
      await importDeducedAudioDirectoryOrPrompt(ui, 
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
    ui.ctx.log(`${sourceLabel} error: ${msg}`);
    toast(`Failed to import files: ${msg}`, 'error');
  }
}
