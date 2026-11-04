import type { MixedImportContext } from './types.ts';

// ─────────────────────────────────────────────────────────
// ImportHandlers — sample / session / model / NeuronDB import flows
// Extracted verbatim from App (src/main.ts). All mutable shell state
// (session, selection) and UI side-effects (log, refresh, drawers)
// go through ImportContext so this module owns no DOM singletons.
// ─────────────────────────────────────────────────────────

import { toast } from '../../ui/notify';
import { withLoading } from '../../ui/LoadingModal';
import { MultiInstrumentModal } from '../../ui/MultiInstrumentModal';
import { applyPreflightImportAdaptations } from '../../core/import/importPreflight.ts';
import {
  listZipSamplerPrograms,
  parseUniversalSampler,
} from '../../core/import/rawSamplerParsers.ts';

export async function importUniversalSamplerFiles(
  ui: MixedImportContext,
  universalSamplerFiles: { name: string; path: string; buffer: ArrayBuffer }[],
  audioFiles: { name: string; path?: string; buffer: ArrayBuffer }[],
  expanded: { name: string; buffer: ArrayBuffer }[],
  sourceLabel: string
): Promise<boolean> {
    const siblingMap = new Map<string, Uint8Array>();
    for (const af of audioFiles) {
      siblingMap.set(af.name, new Uint8Array(af.buffer));
      if (af.path) siblingMap.set(af.path, new Uint8Array(af.buffer));
    }
    for (const uf of universalSamplerFiles) {
      siblingMap.set(uf.name, new Uint8Array(uf.buffer));
      siblingMap.set(uf.path, new Uint8Array(uf.buffer));
    }

    const loadUniversalProgram = async (
      targetSampler: { name: string; path: string; buffer: ArrayBuffer },
      programId?: string,
      programLabel?: string
    ) => {
      await withLoading(
        'IMPORTING SAMPLER INSTRUMENT...',
        `Parsing "${targetSampler.name}"${programLabel ? ` (${programLabel})` : ''} and decoding audio zones...`,
        async () => {
          const parsedPreset = await parseUniversalSampler(
            targetSampler.name,
            targetSampler.buffer,
            siblingMap.size > 0 ? siblingMap : undefined,
            programId
          );
          const currentMode = ui.ctx.session?.processConfig.workingMode ?? 'classic';
          const isDrumPreset = /drum|kit|perc/i.test(parsedPreset.detectedCategory || '');
          const adapted = applyPreflightImportAdaptations(parsedPreset, {
            autoExtendOuterZones: currentMode === 'classic' && !isDrumPreset,
            adaptVelocityLayers: true,
            switchToExtendedMode: currentMode === 'extended',
            currentWorkingMode: currentMode,
          });
          if (!ui.ctx.session) {
            ui.ctx.session = await ui.ctx.core.newSession(parsedPreset.modelName || 'SamplerModel');
          }
          for (const [name, buf] of adapted.audioBuffers.entries()) {
            ui.ctx.core.registerSampleBuffer(name, buf);
          }
          const rawParamSet = Number(parsedPreset.suggestedParameterSet);
          const paramSet = Number.isFinite(rawParamSet) ? Math.max(0, Math.min(9, rawParamSet)) : 0;
          const fullExpandedName = (parsedPreset.presetName || parsedPreset.modelName || 'SamplerModel').trim();
          const classicShortName = (parsedPreset.modelName || fullExpandedName).trim().slice(0, 11) || 'UNTITLED';
          ui.ctx.session.name = fullExpandedName;
          ui.ctx.session.processConfig.modelName = classicShortName;
          ui.ctx.session.processConfig.expandedName = fullExpandedName;
          ui.ctx.session.processConfig.parameterSet = paramSet;
          ui.ctx.session.processConfig.workingMode = adapted.suggestedWorkingMode;
          ui.ctx.session.processConfig.keyMappingMode = isDrumPreset ? 'drum' : 'chromatic';
          ui.ctx.session.processConfig.extendedMetadata = {
            ...ui.ctx.session.processConfig.extendedMetadata,
            category: parsedPreset.detectedCategory,
          };
          ui.ctx.session.zones = adapted.classicZones;
          ui.ctx.session.extendedRegions = adapted.extendedRegions;
          ui.ctx.session.detectedInstrumentCategory = parsedPreset.detectedCategory;
          ui.ctx.session.dirty = true;
          ui.ctx.selectedZoneId = adapted.classicZones[0]?.id ?? null;
          ui.ctx.log(
            `${sourceLabel}: imported ${parsedPreset.formatLabel} "${parsedPreset.presetName}" (${adapted.extendedRegions.length} region(s), ${adapted.classicZones.length} classic zone(s)).`
          );
          ui.ctx.refresh();
          toast(
            `Imported "${parsedPreset.presetName}" (${adapted.extendedRegions.length} regions, ${adapted.audioBuffers.size} samples).`,
            'success'
          );
        }
      );
    };

    const primarySampler = universalSamplerFiles[0];
    if (universalSamplerFiles.length === 1) {
      const programs = await listZipSamplerPrograms(primarySampler.name, primarySampler.buffer);
      if (programs.length > 1) {
        const multiModal = new MultiInstrumentModal();
        multiModal.open({
          fileName: primarySampler.name,
          format: (programs[0]?.format as any) || 'akai_disk',
          items: programs.map((p) => ({
            id: p.id,
            index: p.index,
            name: p.name,
            regionCount: p.regionCount,
            detail: p.detail,
            folderPath: p.entryPath || p.id,
          })),
          onSelect: (chosen) => {
            void loadUniversalProgram(primarySampler, String(chosen.id), chosen.name);
          },
          onProcessBatch: () => {
            if (ui.ctx.onOpenBatchProcessorWithFiles) {
              ui.ctx.onOpenBatchProcessorWithFiles(expanded, primarySampler.name);
            } else {
              ui.ctx.onOpenBatchProcessor?.();
            }
          },
        });
        return true;
      }

      await loadUniversalProgram(primarySampler, programs[0]?.id, programs[0]?.name);
      return true;
    }

    // Multiple sampler definitions or containers (e.g. multiple .exs, .fxp, .akp, or nested .iso/.zip files)
    const combinedEntries: Array<{
      sampler: { name: string; path: string; buffer: ArrayBuffer };
      programId?: string;
      name: string;
      regionCount?: number;
      detail?: string;
      folderPath: string;
    }> = [];
    for (const uf of universalSamplerFiles) {
      const subProgs = await listZipSamplerPrograms(uf.name, uf.buffer);
      if (subProgs.length > 0) {
        const prefix = uf.path.replace(/\.[^.]+$/, '');
        for (const sp of subProgs) {
          combinedEntries.push({
            sampler: uf,
            programId: sp.id,
            name: sp.name,
            regionCount: sp.regionCount,
            detail: sp.detail ? `${uf.name} — ${sp.detail}` : uf.name,
            folderPath: `${prefix}/${sp.entryPath || sp.id}`,
          });
        }
      } else {
        const ext = uf.name.split('.').pop()?.toUpperCase() || 'PRESET';
        combinedEntries.push({
          sampler: uf,
          programId: undefined,
          name: uf.name.replace(/\.[^.]+$/, ''),
          detail: `${ext} Instrument`,
          folderPath: uf.path,
        });
      }
    }

    const multiModal = new MultiInstrumentModal();
    multiModal.open({
      fileName: `${combinedEntries.length} Sampler Instruments`,
      format: 'zip',
      items: combinedEntries.map((ce, idx) => ({
        id: `${idx}`,
        index: idx,
        name: ce.name,
        regionCount: ce.regionCount,
        detail: ce.detail,
        folderPath: ce.folderPath,
      })),
      onSelect: (chosen) => {
        const entry = combinedEntries[chosen.index] ?? combinedEntries[0];
        if (entry) {
          void loadUniversalProgram(entry.sampler, entry.programId, entry.name);
        }
      },
      onProcessBatch: () => {
        if (ui.ctx.onOpenBatchProcessorWithFiles) {
          ui.ctx.onOpenBatchProcessorWithFiles(expanded, `${combinedEntries.length} Sampler Instruments`);
        } else {
          ui.ctx.onOpenBatchProcessor?.();
        }
      },
    });
    return true;
}
