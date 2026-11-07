// ─────────────────────────────────────────────────────────
// BatchProcessorModal — batchQueueOps (Fase 42.5)
// Funciones extraidas verbatim de `src/ui/BatchProcessorModal.ts`.
// `modal` es el nucleo estructural (`BatchModalCore`).
// ─────────────────────────────────────────────────────────

import { toast } from '../notify.ts';
import { extractSf2PresetsToCandidates } from '../../core/batch/Sf2BatchExtractor.ts';
import { extractFolderFilesToCandidates, extractFolderLoopsToCandidates } from '../../core/batch/FolderBatchExtractor.ts';
import type { FolderFileInput } from '../../core/batch/FolderBatchExtractor.ts';
import { discoverTriageReport, extractTriageDefinitionCandidates, indexTriageBuffers, partitionTriageSelection } from '../../app/triageGate.ts';
import type { TriageExpandedFile } from '../../app/triageGate.ts';
import { listZipSamplerProgramsCapped, parseUniversalSamplerCapped } from '../../core/import/rawSamplerParsers.ts';
import { applyPreflightImportAdaptations } from '../../core/import/importPreflight.ts';
import { parseZipArchiveCapped } from '../../formats/ZipArchive.ts';
import { slugifyModelName } from '../../core/modelSlug.ts';
import type { BatchModelCandidate, BatchProgressState, BatchResultSummary } from '../../core/batch/types.ts';
import { fileExtension } from '../../core/pathUtils.ts';
import { yieldToUI } from '../../core/asyncUtils.ts';
import { downloadBytes } from '../download.ts';
import { loadingModal, withLoading } from '../LoadingModal.ts';
import type { BatchModalCore } from './batchModalCore.ts';


  // ── Source Ingestion Helpers ───────────────────────────

export function loadCandidates(modal: BatchModalCore, candidates: BatchModelCandidate[], originTitle?: string): void {
    if (candidates.length === 0) return;
    if (!modal.backdropEl) {
      modal.open();
    }
    modal.isSingleSessionMode = false;
    modal.candidates = candidates;
    modal.selectedCandidateIds = new Set(candidates.map((c) => c.id));
    const allDrum = candidates.every((c) => /drum|kit|perc/i.test(c.detectedCategory || ''));
    modal.activeConfig.keyMappingMode = allDrum
      ? 'drum'
      : (modal.context.getCurrentProcessConfig().keyMappingMode ?? 'chromatic');
    modal.resetChecklistToDefaults();
    modal.currentStep = 'preflight';
    modal.render();
    if (originTitle) {
      toast(`Loaded ${candidates.length} candidates from ${originTitle}.`, 'success');
    }
  }


export function loadSf2Buffer(modal: BatchModalCore, buffer: ArrayBuffer, soundFontName: string): void {
    try {
      const extracted = extractSf2PresetsToCandidates(buffer, { soundFontName: soundFontName.replace(/\.[^.]+$/, '') });
      if (extracted.length === 0) {
        toast(`No presets found in SoundFont "${soundFontName}".`, 'warning');
        return;
      }
      loadCandidates(modal, extracted, soundFontName);
    } catch (err) {
      toast(`Failed to read SoundFont: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }


  /**
   * Unified multi-format batch ingestion from in-memory expanded files/containers:
   * Can be invoked directly from the Nav-bar / MultiInstrumentModal / UniversalImportModal
   * without forcing the user to re-select the file or folder.
   */
export async function loadExpandedFiles(modal: BatchModalCore, inputFiles: TriageExpandedFile[],
    originTitle?: string): Promise<void> {
    if (inputFiles.length === 0) return;
    try {
      if (!modal.backdropEl) {
        modal.open();
      }
      await withLoading(
        originTitle ? `PREPARING BATCH: ${originTitle}...` : 'PREPARING BATCH CANDIDATES...',
        'EXPANDING ARCHIVES & SCANNING PROGRAMS...',
        async () => {
          const expandedFiles: TriageExpandedFile[] = [];
          for (const f of inputFiles) {
            const ext = fileExtension(f.name);
            if (ext === 'zip') {
              try {
                const zipEntries = await parseZipArchiveCapped(new Uint8Array(f.buffer));
                for (const entry of zipEntries) {
                  if (entry.data.byteLength > 0) {
                    expandedFiles.push({
                      name: entry.path,
                      buffer: entry.data.buffer.slice(
                        entry.data.byteOffset,
                        entry.data.byteOffset + entry.data.byteLength
                      ) as ArrayBuffer,
                    });
                  }
                }
                continue;
              } catch {
                // Fall through if not a standard zip or if it's a disguised container
              }
            }
            expandedFiles.push(f);
          }

          if (modal.activeConfig.ingestionMode === 'slicer') {
            const loopInputs: FolderFileInput[] = expandedFiles.map((ef) => ({
              path: ef.name,
              name: ef.name.split('/').pop() || ef.name,
              buffer: ef.buffer,
            }));
            const extractedLoops = extractFolderLoopsToCandidates(loopInputs, {
              slicerProfile: modal.activeConfig.slicerProfile || 'drums',
              bpm: modal.activeConfig.slicerBpm,
            });
            if (extractedLoops.length === 0) {
              toast('No supported loop or audio files found for Batch AutoSlicer.', 'warning');
              return;
            }
            loadCandidates(modal, extractedLoops, originTitle || 'Batch AutoSlicer');
            return;
          }

          const allCandidates: BatchModelCandidate[] = [];

          // 1. Discover multi-asset definitions (.sf2, .sfz, .dspreset, .nki, .vstpreset, .exs, .xpm, .model, etc.)
          const byPath = indexTriageBuffers(expandedFiles);
          const report = await discoverTriageReport(expandedFiles, originTitle || 'Batch Selection');
          if (report && report.items.length > 0) {
            const partition = partitionTriageSelection(report.items, byPath);
            for (const sf2 of partition.sf2Blobs) {
              const baseName = (sf2.name.split('/').pop() || sf2.name).replace(/\.[^.]+$/, '');
              const sf2Candidates = extractSf2PresetsToCandidates(sf2.buffer, { soundFontName: baseName });
              allCandidates.push(...sf2Candidates);
            }
            if (partition.skipped.length > 0) {
              const { candidates: defCandidates } = await extractTriageDefinitionCandidates(partition.skipped, byPath);
              allCandidates.push(...defCandidates);
            }
            if (partition.audioInputs.length > 0) {
              const audioCandidates = extractFolderFilesToCandidates(partition.audioInputs);
              allCandidates.push(...audioCandidates);
            }
          }

          // 2. Fallback for standalone files not covered by triage discovery (e.g. .iso/.img/.dsk, standalone .sf2, or raw audio)
          if (allCandidates.length === 0) {
            const fallbackAudioInputs: FolderFileInput[] = [];
            for (const ef of expandedFiles) {
              const baseName = ef.name.split('/').pop() || ef.name;
              const ext = fileExtension(baseName);
              if (ext === 'sf2') {
                const sf2Candidates = extractSf2PresetsToCandidates(ef.buffer, {
                  soundFontName: baseName.replace(/\.[^.]+$/, ''),
                });
                allCandidates.push(...sf2Candidates);
              } else {
                const siblings = new Map<string, Uint8Array>();
                for (const other of expandedFiles) {
                  if (other === ef) continue;
                  const otherBase = other.name.split('/').pop() || other.name;
                  siblings.set(otherBase, new Uint8Array(other.buffer));
                  siblings.set(other.name.replace(/\\/g, '/'), new Uint8Array(other.buffer));
                }
                let parsedAsContainer = false;
                if (!['wav', 'aif', 'aiff', 'aifc', 'flac', 'mp3', 'ogg', 'oga', 'm4a', 'aac', 'opus', 'webm', 'caf'].includes(ext)) {
                  try {
                    const diskProgs = await listZipSamplerProgramsCapped(baseName, ef.buffer);
                    const progIdsToExtract = diskProgs.length > 0 ? diskProgs.map((p) => p.id) : [undefined];
                    for (let idx = 0; idx < progIdsToExtract.length; idx++) {
                      const progId = progIdsToExtract[idx];
                      if (idx > 0 && idx % 6 === 0) {
                        loadingModal.setMessage(
                          `EXTRACTING PROGRAMS FROM ${baseName.toUpperCase()} (${idx + 1}/${progIdsToExtract.length})...`
                        );
                        await yieldToUI(0);
                      }
                      try {
                        const preset = await parseUniversalSamplerCapped(baseName, ef.buffer, siblings, progId);
                        if (preset && preset.audioBuffers.size > 0) {
                          const adapted = applyPreflightImportAdaptations(preset, {
                            autoExtendOuterZones: false,
                            adaptVelocityLayers: true,
                            switchToExtendedMode: true,
                            currentWorkingMode: 'extended',
                          });
                          const batchFiles = Array.from(adapted.audioBuffers.entries(), ([name, buffer]) => ({
                            name,
                            buffer,
                          }));
                          const displayName = preset.presetName || baseName.replace(/\.[^.]+$/, '');
                          allCandidates.push({
                            id: `uni-${allCandidates.length + 1}-${slugifyModelName(displayName)}`,
                            name: displayName,
                            slug: slugifyModelName(displayName),
                            sourceType: 'folder-pack',
                            sourceOrigin: progId ? `${ef.name} [${progId}]` : ef.name,
                            zoneCount: Math.max(1, adapted.classicZones.length || adapted.extendedRegions.length),
                            detectedCategory: preset.detectedCategory || 'Auto',
                            suggestedParameterSet: Number.isFinite(Number(preset.suggestedParameterSet))
                              ? Math.max(0, Math.min(9, Number(preset.suggestedParameterSet)))
                              : 0,
                            suggestedComplexity: 8,
                            status: 'pending',
                            progressPct: 0,
                            files: batchFiles,
                            classicZones: adapted.classicZones,
                            extendedRegions: adapted.extendedRegions,
                          });
                          parsedAsContainer = true;
                        }
                      } catch {
                        // Continue with remaining programs in disk image
                      }
                    }
                  } catch {
                    // Not a container preset or missing external samples
                  }
                }
                if (!parsedAsContainer) {
                  fallbackAudioInputs.push({
                    path: ef.name,
                    name: baseName,
                    buffer: ef.buffer,
                  });
                }
              }
            }
            if (fallbackAudioInputs.length > 0) {
              allCandidates.push(...extractFolderFilesToCandidates(fallbackAudioInputs));
            }
          }

          if (allCandidates.length === 0) {
            toast('No supported sampler banks, presets, disk images, or audio files found in selection.', 'warning');
            return;
          }

          loadCandidates(modal, allCandidates, originTitle);
        }
      );
    } catch (err) {
      toast(`Failed to ingest batch files: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }


  /**
   * Unified multi-format batch ingestion from File[]:
   * Supports .sf2, .sfz, .dspreset, .nki, .vstpreset, .multisample, .adv, .exs,
   * .talsmpl, .txprog, .kmp, .ksf, .dls, .xpm, .xty, .xtd, .xpn, .pgm, .akp,
   * .s3p, .sxt, .dwp, .krz, .k25, .k26, .x7u, .x8u, .x3a, .model, .neuronikmodel,
   * .nmmodel, .nmpack, .scape, .sphere, .iso, .img, .dsk, .out, .hda, .efe, .ede,
   * .zip, .rx2, .rex, .rcy, .cue, and all audio formats.
   */
export async function ingestBatchFiles(modal: BatchModalCore, files: File[]): Promise<void> {
    if (files.length === 0) return;
    const expandedFiles: TriageExpandedFile[] = [];
    for (const f of files) {
      const relPath = f.webkitRelativePath || f.name;
      const buf = await f.arrayBuffer();
      expandedFiles.push({ name: relPath, buffer: buf });
    }
    const originTitle = files.length === 1 ? files[0].name : `${files.length} files`;
    await loadExpandedFiles(modal, expandedFiles, originTitle);
  }


  /**
   * Fase 25: Handles batch selection of loop and beat files.
   */
export async function handleLoopFiles(modal: BatchModalCore, files: File[]): Promise<void> {
    try {
      const fileInputs: FolderFileInput[] = [];
      for (const f of files) {
        fileInputs.push({
          path: f.name,
          name: f.name,
          buffer: await f.arrayBuffer(),
        });
      }

      const extracted = extractFolderLoopsToCandidates(fileInputs, {
        slicerProfile: modal.activeConfig.slicerProfile || 'drums',
        bpm: modal.activeConfig.slicerBpm,
      });

      if (extracted.length === 0) {
        toast('No supported loop or audio files (.wav, .rx2, .rex, .flac, .mp3, .ogg) selected.', 'warning');
        return;
      }

      modal.candidates = extracted;
      modal.selectedCandidateIds = new Set(extracted.map((c) => c.id));
      modal.currentStep = 'preflight';
      modal.render();
      toast(`Discovered ${extracted.length} loop(s) for Batch AutoSlicer.`, 'success');
    } catch (err) {
      toast(`Failed to read loop files: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }


  // ── Queue Execution ────────────────────────────────────

export async function startQueue(modal: BatchModalCore): Promise<void> {
    const selectedJobs = modal.candidates.filter((c) => modal.selectedCandidateIds.has(c.id));
    if (selectedJobs.length === 0) {
      toast('Please select at least one model to process.', 'warning');
      return;
    }

    modal.activeConfig.aiConfig = modal.context.getCurrentProcessConfig().aiConfig;
    modal.activeConfig.checklistSelection = modal.checklistSelection;
    if (modal.checklistSelection.steps.enhanceClassicModel) {
      modal.activeConfig.dspAlgorithm = 'enhanced';
    }
    modal.queue.setJobs(selectedJobs);
    modal.currentStep = 'running';
    modal.render();

    modal.unsubscribeQueue = modal.queue.on((event, data) => {
      if (event === 'progress') {
        modal.progressState = data as BatchProgressState;
        modal.render();
      } else if (event === 'stage-start') {
        modal.progressState = modal.queue.getProgressState();
        modal.render();
      } else if (event === 'queue-complete') {
        modal.finalSummary = data as BatchResultSummary;
        modal.currentStep = 'done';
        modal.render();
      }
    });

    try {
      await modal.queue.start(modal.activeConfig);
    } catch (err) {
      toast(`Batch queue error: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }


export function downloadBlob(_modal: BatchModalCore, bytes: Uint8Array, fileName: string, mimeType: string): void {
    downloadBytes(bytes as unknown as BlobPart, fileName, mimeType);
  }
