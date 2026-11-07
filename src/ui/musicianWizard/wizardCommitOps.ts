// ─────────────────────────────────────────────────────────
// MusicianWizardModal — wizardCommitOps (Fase 42.5)
// Funciones extraidas verbatim de `src/ui/MusicianWizardModal.ts`.
// `modal` es el nucleo estructural (`WizardModalCore`).
// ─────────────────────────────────────────────────────────

import { resolveAiActionDeclaration } from '../../core/ai/aiHonesty.ts';
import { bridgeClient } from '../../core/bridge/BridgeClient.ts';
import { decodeWav, decodeAiff, encodePcm16Wav, transcodeAnyAudioToWavBuffer } from '../../core/dsp/WavDecoder.ts';
import { analyzeImportPreflight, applyPreflightImportAdaptations } from '../../core/import/importPreflight.ts';
import { isNeuronBankOrModelInput, listNeuronBankModels, parseNeuronBankOrModelToPreset } from '../../core/import/neuronBankImporter.ts';
import { listZipSamplerProgramsCapped, parseUniversalSamplerCapped } from '../../core/import/rawSamplerParsers.ts';
import type { ParsedSamplerPreset } from '../../core/import/rawSamplerParsers.ts';
import { inspectWizardMaterialFilename, runWizardCleanStep, runWizardSliceAndMapStep, sanitizeClassicModelName } from '../../core/wizard/musicianWizard.ts';
import { MultiInstrumentModal } from '../MultiInstrumentModal.ts';
import { confirmDialog, toast } from '../notify.ts';
import type { WizardModalCore } from './wizardModalCore.ts';

export function loadRawPcmIntoWizard(modal: WizardModalCore, pcm: Float32Array, sampleRate: number, filename: string): void {
    modal.sourceKind = 'raw_audio';
    modal.sourceName = filename;
    modal.rawPcm = pcm;
    modal.rawSampleRate = sampleRate;
    modal.parsedPreset = null;
    modal.preflightReport = null;
    modal.singleRootKeyOverride = null;
    modal.modelName = sanitizeClassicModelName(filename);
    modal.expandedName = filename.replace(/\.[^/.]+$/, '').trim() || 'Mi Instrumento';

    recomputeCleanAndSlice(modal);
    modal.currentStep = 'clean';
    modal.render();
  }

export function recomputeCleanAndSlice(modal: WizardModalCore): void {
    if (modal.rawPcm.length === 0) return;
    modal.cleanResult = runWizardCleanStep(modal.rawPcm, modal.rawSampleRate, {
      trimSilence: modal.optTrimSilence,
      snapZeroCrossing: modal.optSnapZeroCrossing,
      dcBlock: modal.optDcBlock,
      applyNoisePrintDsp: modal.optApplyNoisePrint,
      normalizePeak: modal.optNormalizePeak,
    });

    modal.sliceMapResult = runWizardSliceAndMapStep(
      modal.cleanResult.cleanedPcm,
      modal.cleanResult.sampleRate,
      {
        roleChoice: modal.roleChoice,
        sensitivity: modal.sensitivity,
        snapZeroCrossing: modal.optSnapZeroCrossing,
        classicTwoVelocityLayers: modal.optClassicTwoLayers,
        autoExtendKeybed: true,
        singleRootKeyOverride: modal.singleRootKeyOverride,
        sourceName: modal.sourceName,
      }
    );

    modal.parameterSet = modal.sliceMapResult.suggestedParameterSet;
    modal.hasCommittedToSession = false;
  }

export function commitPreparedInstrumentToSession(modal: WizardModalCore): void {
    if (modal.hasCommittedToSession) return;

    if (modal.sourceKind === 'mapped_bank' && modal.parsedPreset) {
      const adapted = applyPreflightImportAdaptations(modal.parsedPreset, {
        autoExtendOuterZones: modal.optBankAutoExtend,
        adaptVelocityLayers: modal.optBankAdaptVelocity,
        switchToExtendedMode: modal.optBankSwitchExtended,
        currentWorkingMode: modal.workingMode,
      });
      modal.workingMode = adapted.suggestedWorkingMode;
      modal.context.onCommitWizardInstrument({
        modelName: sanitizeClassicModelName(modal.modelName),
        expandedName: modal.expandedName.trim() || modal.modelName,
        parameterSet: modal.parameterSet,
        workingMode: modal.workingMode,
        classicZones: adapted.classicZones,
        extendedRegions: adapted.extendedRegions,
        audioBuffers: adapted.audioBuffers,
      });
      modal.hasCommittedToSession = true;
      return;
    }

    if (modal.sourceKind === 'raw_audio' && modal.sliceMapResult) {
      modal.context.onCommitWizardInstrument({
        modelName: sanitizeClassicModelName(modal.modelName),
        expandedName: modal.expandedName.trim() || modal.modelName,
        parameterSet: modal.parameterSet,
        workingMode: modal.workingMode,
        classicZones: modal.sliceMapResult.classicZones,
        extendedRegions: modal.sliceMapResult.extendedRegions,
        audioBuffers: modal.sliceMapResult.audioBuffers,
      });
      modal.hasCommittedToSession = true;
    }
  }

export async function handleFilesSelected(modal: WizardModalCore, files: FileList | File[]): Promise<void> {
    const fileArr = Array.from(files);
    if (fileArr.length === 0) return;
    const primary = fileArr[0];
    modal.errorMessage = null;

    const inspection = inspectWizardMaterialFilename(primary.name, fileArr.length, false);

    try {
      modal.isBusy = true;
      const buffer = await primary.arrayBuffer();

      // 1. Check if it's a Hartmann Neuron bank/model or multi-file sampler bank
      const allNames = fileArr.map((f) => f.name);
      if (isNeuronBankOrModelInput(primary.name, buffer, allNames)) {
        const models = await listNeuronBankModels(primary.name, buffer);
        if (models.length > 1) {
          modal.isBusy = false;
          const multi = new MultiInstrumentModal();
          multi.open({
            fileName: primary.name,
            format: 'zip',
            items: models.map((m) => ({
              id: m.id,
              index: m.index,
              name: m.name,
              regionCount: m.regionCount,
              detail: m.detail,
            })),
            onSelect: (chosen) => {
              void (async () => {
                const preset = await parseNeuronBankOrModelToPreset(
                  primary.name,
                  buffer,
                  undefined,
                  chosen.id
                );
                loadParsedBankIntoWizard(modal, preset);
              })();
            },
            onProcessBatch: () => {
              modal.close();
              if (modal.context.onOpenBatchProcessorWithFiles) {
                modal.context.onOpenBatchProcessorWithFiles([{ name: primary.name, buffer }], primary.name);
              } else {
                modal.context.onOpenBatchProcessor?.();
              }
            },
          });
          return;
        }
        const preset = await parseNeuronBankOrModelToPreset(primary.name, buffer);
        loadParsedBankIntoWizard(modal, preset);
        modal.isBusy = false;
        return;
      }

      // 2. Single raw audio file -> decode & go to Step 2 (Clean)
      if (inspection.kind === 'raw_audio') {
        let wavBuf = buffer;
        const lower = primary.name.toLowerCase();
        if (lower.endsWith('.aif') || lower.endsWith('.aiff') || lower.endsWith('.aifc')) {
          const dec = decodeAiff(buffer);
          modal.isBusy = false;
          loadRawPcmIntoWizard(modal, dec.mono, dec.sampleRate, primary.name);
          return;
        }
        if (!lower.endsWith('.wav')) {
          wavBuf = await transcodeAnyAudioToWavBuffer(buffer, primary.name);
        }
        const dec = decodeWav(wavBuf);
        modal.isBusy = false;
        loadRawPcmIntoWizard(modal, dec.mono, dec.sampleRate, primary.name);
        return;
      }

      // 3. Pre-mapped Sampler Bank (.sf2, .sfz, .dspreset, .zip, .iso, etc.)
      if (/\.(zip|xpn|iso|img|dsk|bin|hda|out|efe|ede|gkh|e4b|esi|x7u|x8u|x3a)$/i.test(primary.name)) {
        const programs = await listZipSamplerProgramsCapped(primary.name, buffer);
        if (programs.length > 1) {
          modal.isBusy = false;
          const multi = new MultiInstrumentModal();
          multi.open({
            fileName: primary.name,
            format: (programs[0]?.format as any) || 'zip',
            items: programs.map((p) => ({
              id: p.id,
              index: p.index,
              name: p.name,
              regionCount: p.regionCount,
              detail: p.detail,
            })),
            onSelect: (chosen) => {
              void (async () => {
                const preset = await parseUniversalSamplerCapped(
                  primary.name,
                  buffer,
                  undefined,
                  String(chosen.id)
                );
                loadParsedBankIntoWizard(modal, preset);
              })();
            },
            onProcessBatch: () => {
              modal.close();
              if (modal.context.onOpenBatchProcessorWithFiles) {
                modal.context.onOpenBatchProcessorWithFiles([{ name: primary.name, buffer }], primary.name);
              } else {
                modal.context.onOpenBatchProcessor?.();
              }
            },
          });
          return;
        }
      }

      const siblings = new Map<string, Uint8Array>();
      for (const f of fileArr) {
        if (f !== primary) {
          siblings.set(f.name, new Uint8Array(await f.arrayBuffer()));
        }
      }
      const preset = await parseUniversalSamplerCapped(
        primary.name,
        buffer,
        siblings.size > 0 ? siblings : undefined
      );
      loadParsedBankIntoWizard(modal, preset);
    } catch (err) {
      modal.errorMessage = err instanceof Error ? err.message : String(err);
      modal.render();
    } finally {
      modal.isBusy = false;
    }
  }

export function loadParsedBankIntoWizard(modal: WizardModalCore, preset: ParsedSamplerPreset): void {
    modal.sourceKind = 'mapped_bank';
    modal.sourceName = preset.presetName;
    modal.parsedPreset = preset;
    modal.preflightReport = analyzeImportPreflight(preset, modal.workingMode);
    modal.optBankAutoExtend = modal.preflightReport.defaultActions.autoExtendOuterZones;
    modal.optBankAdaptVelocity = modal.preflightReport.defaultActions.adaptVelocityLayers;
    modal.optBankSwitchExtended = modal.preflightReport.defaultActions.switchToExtendedMode;
    modal.modelName = sanitizeClassicModelName(preset.modelName || preset.presetName);
    modal.expandedName = preset.presetName || preset.modelName || 'Mi Instrumento';
    modal.parameterSet = preset.suggestedParameterSet ?? 0;
    modal.hasCommittedToSession = false;
    modal.render();
  }

export async function handleToggleInlineRecord(modal: WizardModalCore): Promise<void> {
    if (!modal.isRecordingInline) {
      try {
        const engine = await modal.capture.open({
          trimSilence: false,
          attachNoiseProfile: true,
          autoClassify: true,
        });
        modal.context.onStopAudition?.();
        engine.startRecording();
        modal.isRecordingInline = true;
        modal.errorMessage = null;
        modal.render();
      } catch (err) {
        modal.errorMessage =
          err instanceof Error
            ? `No se pudo abrir el micrófono: ${err.message}`
            : 'No se pudo iniciar la grabación de audio.';
        modal.render();
      }
      return;
    }

    // Stop inline recording and advance to Step 2 (Clean)
    try {
      const engine = await modal.capture.open();
      if (engine.getState() === 'recording' || engine.getState() === 'paused') {
        const take = engine.stopRecording();
        await modal.capture.close();
        modal.isRecordingInline = false;
        const mono =
          take.samples.length === 1
            ? take.samples[0]
            : (() => {
                const L = take.samples[0] ?? new Float32Array(0);
                const R = take.samples[1] ?? L;
                const out = new Float32Array(L.length);
                for (let i = 0; i < L.length; i++) out[i] = 0.5 * (L[i] + R[i]);
                return out;
              })();
        loadRawPcmIntoWizard(modal, mono, take.sampleRate, `Toma_${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.wav`);
      }
    } catch (err) {
      modal.isRecordingInline = false;
      modal.errorMessage = err instanceof Error ? err.message : String(err);
      modal.render();
    }
  }

export async function handleRunAiBweInStep2(modal: WizardModalCore): Promise<void> {
    if (!modal.cleanResult || modal.cleanResult.cleanedPcm.length === 0) return;

    if (!bridgeClient.isConnected()) {
      await bridgeClient.checkHealth();
    }
    const decl = resolveAiActionDeclaration('recorder-bwe-enhance', {
      isBridgeConnected: bridgeClient.isConnected(),
    });

    // Consentimiento explícito siempre que el motor primario no esté disponible (Fase 35.4 + 35.5)
    if (decl.requiresFallbackConsent) {
      const accepted = await confirmDialog(decl.consentMessage, {
        title: decl.consentTitle,
        confirmLabel: decl.consentConfirmLabel,
        cancelLabel: 'Cancelar',
      });
      if (!accepted) return;
      modal.optApplyNoisePrint = true;
      modal.optNormalizePeak = true;
      recomputeCleanAndSlice(modal);
      modal.render();
      toast(`Aplicada ${decl.fallbackEngine} (confirmado por el usuario).`, 'success');
      return;
    }

    try {
      toast('Ejecutando Reconstructor de agudos (BWE) vía Companion Bridge…', 'info');
      const wav = encodePcm16Wav(modal.cleanResult.cleanedPcm, modal.cleanResult.sampleRate);
      const enhancedWavBytes = await bridgeClient.enhanceAudio(wav, {
        noiseProfile: modal.cleanResult.noiseProfile,
      });
      const dec = decodeWav(
        enhancedWavBytes.buffer.slice(
          enhancedWavBytes.byteOffset,
          enhancedWavBytes.byteOffset + enhancedWavBytes.byteLength
        ) as ArrayBuffer
      );
      modal.rawPcm = dec.mono;
      modal.rawSampleRate = dec.sampleRate;
      recomputeCleanAndSlice(modal);
      modal.render();
      toast('Reconstructor de agudos (BWE) aplicado con éxito.', 'success');
    } catch (err) {
      toast(`Error en BWE: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }
