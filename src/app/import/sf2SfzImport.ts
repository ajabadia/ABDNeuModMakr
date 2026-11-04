// ─────────────────────────────────────────────────────────
// ImportHandlers — sample / session / model / NeuronDB import flows
// Extracted verbatim from App (src/main.ts). All mutable shell state
// (session, selection) and UI side-effects (log, refresh, drawers)
// go through ImportContext so this module owns no DOM singletons.
// ─────────────────────────────────────────────────────────

import { transcodeAnyAudioToWavBuffer } from '@abdsynths/shared/formats/neuron';
import { MAX_SFZ_TEXT_BYTES } from '../../formats/SfzParser.ts';
import { withLoading } from '../../ui/LoadingModal';
import { MultiInstrumentModal } from '../../ui/MultiInstrumentModal';

import type { MixedImportContext } from './types.ts';

export async function importSf2SfzFiles(
  ui: MixedImportContext,
  sf2Files: { name: string; buffer: ArrayBuffer }[],
  sfzFiles: { name: string; buffer: ArrayBuffer }[],
  audioFiles: { name: string; path?: string; buffer: ArrayBuffer }[],
  expanded: { name: string; buffer: ArrayBuffer }[],
  sourceLabel: string
): Promise<boolean> {
  if (sf2Files.length > 0) {
    const sf2 = sf2Files[0];
    const presets = ui.ctx.core.listSf2Presets(sf2.buffer);

    const loadPreset = async (presetIndex: number, presetName?: string) => {
      await withLoading(
        'IMPORTING SOUNDFONT (.SF2)...',
        `Processing "${sf2.name}"${presetName ? ` (Preset: "${presetName}")` : ''}, decoding PCM samples and analyzing layers...`,
        async () => {
          const session = await ui.ctx.core.importSf2Buffer(sf2.buffer, presetIndex);
          ui.ctx.session = session;
          ui.ctx.selectedZoneId = session.zones[0]?.id || null;
          ui.ctx.log(
            `${sourceLabel}: imported SF2 "${sf2.name}" -> preset "${session.name}" (${session.extendedRegions?.length ?? 0} regions, ${session.zones.length} classic zones, category: ${session.detectedInstrumentCategory ?? 'Auto'}).`
          );
          ui.ctx.refresh();
        }
      );
    };

    if (presets.length > 1) {
      const multiModal = new MultiInstrumentModal();
      multiModal.open({
        fileName: sf2.name,
        format: 'sf2',
        items: presets.map((p) => ({
          id: String(p.index),
          index: p.index,
          name: p.name,
          bank: p.bank,
          presetNumber: p.presetNumber,
          regionCount: p.regionCount,
        })),
        onSelect: (item) => {
          void loadPreset(item.index, item.name);
        },
        onProcessBatch: () => {
          if (ui.ctx.onOpenBatchProcessorWithSf2) {
            ui.ctx.onOpenBatchProcessorWithSf2(sf2.buffer, sf2.name);
          } else if (ui.ctx.onOpenBatchProcessor) {
            ui.ctx.onOpenBatchProcessor();
          }
        },
      });
      return true;
    }

    // Single preset
    await loadPreset(0, presets[0]?.name);
    return true;
  }

  // If SFZ (.sfz) was provided, convert immediately into our native session format
  if (sfzFiles.length > 0) {
    const loadSfzFile = async (chosenSfz: { name: string; buffer: ArrayBuffer }) => {
      await withLoading(
        'IMPORTING SFZ INSTRUMENT...',
        `Decoding opcodes from "${chosenSfz.name}" and mapping regions...`,
        async () => {
          if (chosenSfz.buffer.byteLength > MAX_SFZ_TEXT_BYTES) {
            throw new Error(
              `SFZ file too large (${chosenSfz.buffer.byteLength} bytes, max ${MAX_SFZ_TEXT_BYTES})`
            );
          }
          const sfzText = new TextDecoder('utf-8').decode(chosenSfz.buffer);
          const normalizedSfzAudio: { name: string; buffer: ArrayBuffer }[] = [];
          for (const af of audioFiles) {
            const normBuf = await transcodeAnyAudioToWavBuffer(af.buffer, af.name);
            normalizedSfzAudio.push({ name: af.name, buffer: normBuf });
          }
          const session = await ui.ctx.core.importSfzText(sfzText, chosenSfz.name, normalizedSfzAudio);
          ui.ctx.session = session;
          ui.ctx.selectedZoneId = session.zones[0]?.id || null;
          ui.ctx.log(
            `${sourceLabel}: imported SFZ "${chosenSfz.name}" -> "${session.name}" (${session.extendedRegions?.length ?? 0} regions, ${audioFiles.length} companion audio file(s)).`
          );
          ui.ctx.refresh();
        }
      );
    };

    if (sfzFiles.length > 1) {
      const multiModal = new MultiInstrumentModal();
      multiModal.open({
        fileName: `${sfzFiles.length} SFZ Definitions`,
        format: 'sfz',
        items: sfzFiles.map((sfz, idx) => ({
          id: sfz.name,
          index: idx,
          name: sfz.name.replace(/\.sfz$/i, ''),
          detail: 'SFZ Instrument',
        })),
        onSelect: (item) => {
          const chosen = sfzFiles[item.index] || sfzFiles[0];
          void loadSfzFile(chosen);
        },
        onProcessBatch: () => {
          if (ui.ctx.onOpenBatchProcessorWithFiles) {
            ui.ctx.onOpenBatchProcessorWithFiles(expanded, `${sfzFiles.length} SFZ Definitions`);
          } else {
            ui.ctx.onOpenBatchProcessor?.();
          }
        },
      });
      return true;
    }

    await loadSfzFile(sfzFiles[0]);
    return true;
  }

  return false;
}
