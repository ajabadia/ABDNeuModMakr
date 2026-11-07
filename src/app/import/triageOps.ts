// ─────────────────────────────────────────────────────────
// ImportHandlers — sample / session / model / NeuronDB import flows
// Extracted verbatim from App (src/main.ts). All mutable shell state
// (session, selection) and UI side-effects (log, refresh, drawers)
// go through ImportContext so this module owns no DOM singletons.
// ─────────────────────────────────────────────────────────

import { isSupportedAudioFileName } from '@abdsynths/shared/formats/neuron';
import { transcodeAnyAudioToWavBuffer } from '../../core/dsp/WavDecoder.ts';
import {
  APP_MAX_ZIP_TOTAL_BYTES,
  parseZipArchiveCapped,
} from '../../formats/ZipArchive.ts';
import { MAX_SFZ_TEXT_BYTES } from '../../formats/SfzParser.ts';
import { toast } from '../../ui/notify';
import { importDeducedAudioDirectoryOrPrompt } from './directoryImport.ts';
import { withLoading } from '../../ui/LoadingModal';
import { extractFolderFilesToCandidates } from '../../core/batch/FolderBatchExtractor';
import { extractSf2PresetsToCandidates } from '../../core/batch/Sf2BatchExtractor';
import type { BatchModelCandidate } from '../../core/batch/types';
import { MultiAssetTriageModal } from '../../ui/MultiAssetTriageModal';
import type { DiscoveredSamplerItem } from '../../formats/MultiAssetDiscovery.ts';
import { applyPreflightImportAdaptations } from '../../core/import/importPreflight.ts';
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
} from '../triageGate.ts';

import type { TriageOpsContext } from './types.ts';

// ─────────────────────────────────────────────────────────
// Fase 35 — mixed-content triage gate (folder / multi-file / .zip).
// Genuinely mixed content opens the MultiAssetTriageModal instead of
// letting the single-format ladders below silently drop non-winning kinds.
// ─────────────────────────────────────────────────────────
export async function maybeOpenTriageGate(
  ui: TriageOpsContext,
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
      void importTriageSingle(ui, item, byPath, sourceLabel, audioMode, preferredKind);
    },
    onProcessBatch: (selected) => {
      void processTriageBatch(ui, selected, byPath, sourceLabel);
    },
    onCancel: () => {
      ui.ctx.log(`${sourceLabel}: triage dismissed — no files imported.`);
    },
  });
  ui.ctx.log(
    `${sourceLabel}: mixed content detected (${report.items.length} entities, ${new Set(report.items.map((it) => it.format)).size} formats) — triage gate opened.`
  );
  return true;
}

async function importTriageSingle(
  ui: TriageOpsContext,
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
    await importDeducedAudioDirectoryOrPrompt(ui, 
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
    const primary = files.find((f) => f.name.toLowerCase().endsWith('.sf2')) ?? files[0];
    const base = primary.name.split('/').pop() ?? primary.name;
    try {
      if (typeof item.subIndex === 'number') {
        await withLoading(
          'IMPORTING SOUNDFONT (.SF2)...',
          `Processing "${base}" (Preset: "${item.name}"), decoding PCM samples and mapping layers...`,
          async () => {
            const session = await ui.ctx.core.importSf2Buffer(primary.buffer, item.subIndex);
            ui.ctx.session = session;
            ui.ctx.selectedZoneId = session.zones[0]?.id || null;
            ui.ctx.log(
              `${sourceLabel} (triage): imported SF2 "${base}" -> preset "${session.name}" (${session.extendedRegions?.length ?? 0} regions, ${session.zones.length} classic zones).`
            );
            ui.ctx.refresh();
          }
        );
        return;
      }
      const dt = new DataTransfer();
      dt.items.add(new File([primary.buffer], base));
      await ui.importMixedFilesOrZip(dt.files, preferredKind, audioMode, `${sourceLabel} (triage)`);
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
          const session = await ui.ctx.core.importSfzText(
            sfzText,
            sfzFile.name.split('/').pop() ?? sfzFile.name,
            normalizedSfzAudio
          );
          ui.ctx.session = session;
          ui.ctx.selectedZoneId = session.zones[0]?.id || null;
          ui.ctx.log(
            `${sourceLabel} (triage): imported SFZ "${item.name}" (${session.extendedRegions?.length ?? 0} regions, ${normalizedSfzAudio.length} companion audio file(s)).`
          );
          ui.ctx.refresh();
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
    const currentMode = ui.ctx.session?.processConfig.workingMode ?? 'classic';
    const adapted = applyPreflightImportAdaptations(parsedPreset, {
      autoExtendOuterZones: true,
      adaptVelocityLayers: true,
      switchToExtendedMode: currentMode === 'extended',
      currentWorkingMode: currentMode,
    });
    if (!ui.ctx.session) {
      ui.ctx.session = await ui.ctx.core.newSession(parsedPreset.modelName || item.name);
    }
    for (const [name, buf] of adapted.audioBuffers.entries()) {
      ui.ctx.core.registerSampleBuffer(name, buf);
    }
    const rawParamSet = Number(parsedPreset.suggestedParameterSet);
    const paramSet = Number.isFinite(rawParamSet) ? Math.max(0, Math.min(9, rawParamSet)) : 0;
    ui.ctx.session.name = parsedPreset.modelName || item.name;
    ui.ctx.session.processConfig.modelName = (parsedPreset.modelName || item.name).slice(0, 11);
    ui.ctx.session.processConfig.expandedName = parsedPreset.presetName || item.name;
    ui.ctx.session.processConfig.parameterSet = paramSet;
    ui.ctx.session.processConfig.workingMode = adapted.suggestedWorkingMode;
    ui.ctx.session.zones = adapted.classicZones;
    ui.ctx.session.extendedRegions = adapted.extendedRegions;
    ui.ctx.session.dirty = true;
    ui.ctx.selectedZoneId = adapted.classicZones[0]?.id ?? null;
    ui.ctx.log(
      `${sourceLabel} (triage): loaded ${parsedPreset.formatLabel} "${parsedPreset.presetName}" (${adapted.classicZones.length} zones).`
    );
    ui.ctx.refresh();
    return;
  }

  toast(
    `"${item.name}" (${item.formatLabel}) goes through Batch or Universal Import (Ctrl+I) — direct session load here supports audio packs and SF2.`,
    'warning'
  );
}

async function processTriageBatch(
  ui: TriageOpsContext,
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
      ui.ctx.log(
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
      ui.ctx.log(
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
  if (ui.ctx.onOpenBatchProcessorWithCandidates) {
    ui.ctx.onOpenBatchProcessorWithCandidates(candidates, `${sourceLabel} (triage)`);
  } else {
    ui.ctx.onOpenBatchProcessor?.();
  }
}

/**
 * DirectoryHandle (`showDirectoryPicker`) variant: reads mixed folders carrying
 * preset containers + audio/other files so the triage gate can inspect them.
 */
/** Acumulador compartido de la expansión: tope S6.7o (ver abajo). */
export interface ZipExpansionBudget {
  total: number;
}

/** El presupuesto acumulado se agota: NO es corrupción (no se traga). */
export class ZipExpansionBudgetError extends Error {}

export async function expandNestedZipBuffer(
  bytes: Uint8Array,
  prefix: string,
  out: { name: string; buffer: ArrayBuffer }[],
  depth = 0,
  budget: ZipExpansionBudget = { total: 0 }
): Promise<void> {
  // S6.7o (ola 21): tope ACUMULADO de la expansión. `parseZipArchiveCapped`
  // topa cada archivo (300 MB), pero sin presupuesto global N anidados
  // honestos de 160 MB suman gigas en `out` sin que nada falle (medido:
  // 640 KB → 640 MB residentes sin throw). Se cuenta lo que se EMITE
  // (bytes reales post-inflado) y se falla ANTES de copiar al superar el
  // mismo tope total: residente ≤300 MB, transitorio ≤ ~400 MB.
  const unzipped = await parseZipArchiveCapped(bytes);
  for (const entry of unzipped) {
    const entryPath = prefix ? `${prefix}/${entry.path}` : entry.path;
    const lowerEntry = entry.path.toLowerCase();
    const isNestedZip =
      depth < 3 &&
      lowerEntry.endsWith('.zip') &&
      entry.data.byteLength >= 4 &&
      entry.data[0] === 0x50 &&
      entry.data[1] === 0x4b &&
      (entry.data[2] === 0x03 || entry.data[2] === 0x05);
    if (isNestedZip) {
      const innerStem = entryPath.replace(/\.zip$/i, '');
      try {
        await expandNestedZipBuffer(entry.data, innerStem, out, depth + 1, budget);
        continue;
      } catch (e) {
        // S6.7o: el presupuesto agotado aborta TODO (no es un zip corrupto).
        if (e instanceof ZipExpansionBudgetError) throw e;
        // Fall through and keep raw buffer if nested zip is corrupt
      }
    }
    if (budget.total + entry.data.byteLength > APP_MAX_ZIP_TOTAL_BYTES) {
      throw new ZipExpansionBudgetError(
        `ZIP expansion too large (${entryPath}: ${((budget.total + entry.data.byteLength) / 1048576).toFixed(0)} MB accumulated, max ${APP_MAX_ZIP_TOTAL_BYTES / 1048576} MB)`
      );
    }
    const copy = new Uint8Array(entry.data.byteLength);
    copy.set(entry.data);
    budget.total += copy.byteLength;
    out.push({ name: entryPath, buffer: copy.buffer });
  }
}

export async function readMixedDirectoryHandleForTriage(
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
      } else if (entry.kind === 'directory' && depth < 8) {
        await walk(entry as FileSystemDirectoryHandle, rel, depth + 1);
      }
    }
  };
  await walk(rootHandle, '', 0);
  if (!hasContainer || (!hasOther && entries.length < 1)) return null;
  const expanded: TriageExpandedFile[] = [];
  for (const item of entries) {
    try {
      const f = await item.handle.getFile();
      const buf = await f.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const isPkZip =
        item.rel.toLowerCase().endsWith('.zip') &&
        bytes.byteLength >= 4 &&
        bytes[0] === 0x50 &&
        bytes[1] === 0x4b &&
        (bytes[2] === 0x03 || bytes[2] === 0x05);
      if (isPkZip) {
        await expandNestedZipBuffer(bytes, item.rel.replace(/\.zip$/i, ''), expanded, 1);
      } else {
        expanded.push({ name: item.rel, buffer: buf });
      }
    } catch {
      // skip unreadable file
    }
  }
  return expanded.length >= 2 ? expanded : null;
}
