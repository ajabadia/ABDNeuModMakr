import type { RecorderContext } from './types.ts';
import type { SessionTake } from './types.ts';
import { mixToMono, normalizeNoiseProfile, toDbfs } from './recorderUtils.ts';
import type { MidiAutoSampleManifest } from '@abdsynths/shared/contracts/recordingSession';
import { captureNoisePrintFromRegion, reduceNoiseWithProfile } from '@abdsynths/shared/dsp/take/NoiseReductionDsp.ts';
import { encodeWav16, type FinalizedTake } from '@abdsynths/shared/dsp/take/recordingEngine.ts';
import { classifyTake, computeNoiseProfile, dcBlock, detectSilenceRanges, extractTakeFeatures, normalizePeak, normalizeRms, peakAmplitude, trimSilence, type NoiseProfile } from '@abdsynths/shared/dsp/take/takeDsp.ts';
import { cloudByokClient } from '../../core/ai/CloudByokClient.ts';
import { resolveAiActionDeclaration } from '../../core/ai/aiHonesty.ts';
import { embedManifestInWavBytes, extractManifestFromWavBytes } from '../../core/autoSampler/MidiAutoSampleSession.ts';
import { bridgeClient } from '../../core/bridge/BridgeClient.ts';
import { decodeWav } from '../../core/dsp/WavDecoder.ts';
import { downloadBlob } from '../download.ts';
import { confirmDialog, toast } from '../notify.ts';

export function finishTake(ctx: RecorderContext, 
    rawTake: FinalizedTake,
    customName?: string,
    explicitManifest?: MidiAutoSampleManifest
  ): SessionTake {
    ctx.state.takeSeq += 1;
    const name = customName || `Take ${String(ctx.state.takeSeq).padStart(2, '0')}`;
    const mono = mixToMono(rawTake);

    // Si el WAV ya trae un manifiesto `atem` incrustado, lo recuperamos
    let manifest = explicitManifest;
    if (!manifest && rawTake.wav && rawTake.wav.byteLength > 44) {
      const buf = rawTake.wav.buffer.slice(
        rawTake.wav.byteOffset,
        rawTake.wav.byteOffset + rawTake.wav.byteLength
      ) as ArrayBuffer;
      manifest = extractManifestFromWavBytes(buf) ?? undefined;
    }

    let classification = rawTake.classification;
    let classificationConfidence = rawTake.classificationConfidence;
    if (classification === 'unknown' && mono.length >= 64) {
      const feats = extractTakeFeatures(mono, rawTake.sampleRate);
      const cls = classifyTake(feats);
      classification = cls.kind;
      classificationConfidence = cls.confidence;
    }

    let noiseProfile = normalizeNoiseProfile(rawTake.noiseProfile ?? manifest?.noiseProfile);
    let selStart: number | null = null;
    let selEnd: number | null = null;
    let noiseRegionLabel: string | undefined;

    if (mono.length > 0 && ctx.state.autoDetectNoiseOnFinish) {
      const silences = detectSilenceRanges(mono, rawTake.sampleRate, {
        thresholdDb: ctx.state.silenceThresholdDb,
        minSilenceMs: Math.min(80, ctx.state.minSilenceMs),
      });
      if (silences.length > 0) {
        const best = silences.reduce((a, b) =>
          b.endFrame - b.startFrame > a.endFrame - a.startFrame ? b : a
        );
        selStart = best.startFrame;
        selEnd = best.endFrame;
        if (!noiseProfile) {
          noiseProfile = captureNoisePrintFromRegion(mono, rawTake.sampleRate, {
            startFrame: best.startFrame,
            endFrame: best.endFrame,
          });
        }
        noiseRegionLabel = `Auto-Detected Floor (${((best.startFrame / rawTake.sampleRate) * 1000).toFixed(0)}..${((best.endFrame / rawTake.sampleRate) * 1000).toFixed(0)} ms)`;
      } else if (!noiseProfile) {
        const head = Math.min(mono.length, Math.max(1, Math.round(rawTake.sampleRate * 0.25)));
        noiseProfile = computeNoiseProfile(mono.subarray(0, head), rawTake.sampleRate);
        noiseRegionLabel = `Head Floor (0..${((head / rawTake.sampleRate) * 1000).toFixed(0)} ms)`;
      }
    }

    const enrichedTake: FinalizedTake = {
      ...rawTake,
      classification,
      classificationConfidence,
      ...(noiseProfile ? { noiseProfile } : {}),
    };

    const entry: SessionTake = {
      id: `take-${Date.now()}-${ctx.state.takeSeq}`,
      name,
      take: enrichedTake,
      history: [],
      selectionStartFrame: selStart,
      selectionEndFrame: selEnd,
      noiseRegionLabel,
      ...(manifest ? { manifest } : {}),
    };

    if (ctx.state.autoNormalizeOnFinish && mono.length > 0) {
      const normChannels = entry.take.samples.map((ch) =>
        normalizePeak(dcBlock(ch, entry.take.sampleRate), -1.0)
      );
      rebuildTakeFromChannels(ctx, entry, normChannels, entry.take.sampleRate, noiseProfile);
    }

    if (entry.manifest) {
      ctx.runAutoSamplerPostProcessOnTake(entry);
    }

    ctx.state.takes.unshift(entry);
    ctx.state.selectedTakeId = entry.id;

    const clsLabel =
      enrichedTake.classification === 'unknown' ? 'unclassified' : enrichedTake.classification;
    const classPill = ctx.state.backdropEl?.querySelector('#rec-class-pill');
    if (classPill) {
      classPill.textContent = `${clsLabel} ${(enrichedTake.classificationConfidence * 100).toFixed(0)}%`;
    }

    toast(
      `${name} kept: ${enrichedTake.durationSec.toFixed(2)}s, peak ${enrichedTake.peakDbfs.toFixed(1)} dBFS${entry.processedAutoSample ? ` (${entry.processedAutoSample.slicerResult.slices.length} MIDI slices)` : ''}.`,
      'success'
    );
    ctx.renderTakes();
    ctx.renderTakeInspector();
    return entry;
  }

  // ── Edición DSP / IA del Take Seleccionado ────────────────


export function pushUndoSnapshot(_ctx: RecorderContext, st: SessionTake): void {
    st.history.push({
      samples: st.take.samples.map((ch) => new Float32Array(ch)),
      sampleRate: st.take.sampleRate,
      noiseProfile: normalizeNoiseProfile(st.take.noiseProfile),
    });
    if (st.history.length > 10) st.history.shift();
  }


export function rebuildTakeFromChannels(_ctx: RecorderContext, 
    st: SessionTake,
    channels: Float32Array[],
    sampleRate = st.take.sampleRate,
    noiseProfile = normalizeNoiseProfile(st.take.noiseProfile)
  ): void {
    const validChannels =
      channels.length > 0 && channels[0].length > 0
        ? channels
        : [new Float32Array(1)];
    let peak = 0;
    for (const ch of validChannels) peak = Math.max(peak, peakAmplitude(ch));

    const mono = mixToMono({
      ...st.take,
      samples: validChannels,
      sampleRate,
      channels: validChannels.length,
    });
    const feats = extractTakeFeatures(mono, sampleRate);
    const cls = classifyTake(feats);

    let wavBytes = encodeWav16(validChannels, sampleRate);
    if (st.manifest) {
      const rawBuf = wavBytes.buffer.slice(
        wavBytes.byteOffset,
        wavBytes.byteOffset + wavBytes.byteLength
      ) as ArrayBuffer;
      wavBytes = embedManifestInWavBytes(rawBuf, st.manifest);
    }

    st.take = {
      durationSec: validChannels[0].length / sampleRate,
      sampleRate,
      channels: validChannels.length,
      peakDbfs: toDbfs(peak),
      classification: cls.kind,
      classificationConfidence: cls.confidence,
      ...(noiseProfile ? { noiseProfile } : {}),
      samples: validChannels,
      wav: wavBytes,
    };
  }


export function captureNoisePrintFromSelection(ctx: RecorderContext, takeId?: string): NoiseProfile | null {
    const st = takeId ? ctx.state.takes.find((t) => t.id === takeId) : ctx.getSelectedTake();
    if (!st) return null;
    const mono = mixToMono(st.take);
    if (mono.length === 0) return null;

    let start = st.selectionStartFrame ?? 0;
    let end = st.selectionEndFrame ?? 0;
    if (end <= start) {
      const silences = detectSilenceRanges(mono, st.take.sampleRate, {
        thresholdDb: ctx.state.silenceThresholdDb,
        minSilenceMs: Math.min(80, ctx.state.minSilenceMs),
      });
      if (silences.length > 0) {
        const best = silences.reduce((a, b) =>
          b.endFrame - b.startFrame > a.endFrame - a.startFrame ? b : a
        );
        start = best.startFrame;
        end = best.endFrame;
      } else {
        start = 0;
        end = Math.min(mono.length, Math.max(1, Math.round(st.take.sampleRate * 0.25)));
      }
      st.selectionStartFrame = start;
      st.selectionEndFrame = end;
    }

    const profile = captureNoisePrintFromRegion(mono, st.take.sampleRate, {
      startFrame: start,
      endFrame: end,
    });
    st.take = {
      ...st.take,
      noiseProfile: profile,
    };
    const startMs = ((start / st.take.sampleRate) * 1000).toFixed(0);
    const endMs = ((end / st.take.sampleRate) * 1000).toFixed(0);
    st.noiseRegionLabel = `Region ${startMs}..${endMs} ms`;

    toast(
      `Noise print captured (${st.noiseRegionLabel}): ${profile.levelDbfs.toFixed(1)} dBFS, Hum 50Hz ${profile.hum50HzDb.toFixed(1)} dB`,
      'success'
    );
    ctx.renderTakeInspector();
    return profile;
  }


export function applyTrimSilenceToTake(ctx: RecorderContext, takeId?: string): boolean {
    const st = takeId ? ctx.state.takes.find((t) => t.id === takeId) : ctx.getSelectedTake();
    if (!st) return false;
    const mono = mixToMono(st.take);
    if (mono.length === 0) return false;

    const { leadingMs, trailingMs } = trimSilence(mono, st.take.sampleRate, {
      thresholdDb: ctx.state.silenceThresholdDb,
      minSilenceMs: ctx.state.minSilenceMs,
    });
    const leadFrames = Math.min(
      mono.length,
      Math.round((leadingMs / 1000) * st.take.sampleRate)
    );
    const trailFrames = Math.min(
      mono.length - leadFrames,
      Math.round((trailingMs / 1000) * st.take.sampleRate)
    );
    const endFrame = mono.length - trailFrames;

    if (leadFrames === 0 && trailFrames === 0) {
      toast('No leading or trailing silence below threshold to trim.', 'info');
      return false;
    }
    if (endFrame <= leadFrames) {
      toast('Entire take is below the silence threshold; adjust threshold dB.', 'warning');
      return false;
    }

    if (!st.take.noiseProfile && leadFrames > 64) {
      st.take.noiseProfile = captureNoisePrintFromRegion(mono, st.take.sampleRate, {
        startFrame: 0,
        endFrame: leadFrames,
      });
      st.noiseRegionLabel = `Trimmed Lead (0..${leadingMs.toFixed(0)} ms)`;
    }

    pushUndoSnapshot(ctx, st);
    const trimmedChannels = st.take.samples.map((ch) => ch.slice(leadFrames, endFrame));
    st.selectionStartFrame = null;
    st.selectionEndFrame = null;
    rebuildTakeFromChannels(ctx, st, trimmedChannels);

    toast(
      `Trimmed silence: -${leadingMs.toFixed(0)} ms lead, -${trailingMs.toFixed(0)} ms tail.`,
      'success'
    );
    ctx.renderTakes();
    ctx.renderTakeInspector();
    return true;
  }

  /**
   * Denoise Algorítmico: estima automáticamente el suelo estacionario del take
   * encontrando la ventana de menor energía (sin depender de huella previa) y aplica
   * filtro DC Block + puerta espectral multibanda + filtro notch de red 50/60 Hz.
   */

export function applyAlgorithmicDenoiseToTake(ctx: RecorderContext, takeId?: string): boolean {
    const st = takeId ? ctx.state.takes.find((t) => t.id === takeId) : ctx.getSelectedTake();
    if (!st) return false;
    const mono = mixToMono(st.take);
    if (mono.length === 0) return false;

    const sr = st.take.sampleRate;
    const winFrames = Math.min(mono.length, Math.max(256, Math.round(sr * 0.12)));
    const hopFrames = Math.max(128, Math.floor(winFrames / 2));
    let minRms = Infinity;
    let bestStart = 0;

    for (let start = 0; start + winFrames <= mono.length; start += hopFrames) {
      let sumSq = 0;
      for (let i = start; i < start + winFrames; i++) {
        const v = mono[i];
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / winFrames);
      if (rms < minRms) {
        minRms = rms;
        bestStart = start;
      }
    }

    const algoProfile = computeNoiseProfile(
      mono.subarray(bestStart, Math.min(mono.length, bestStart + winFrames)),
      sr
    );

    pushUndoSnapshot(ctx, st);
    const denoisedChannels = st.take.samples.map((ch) => {
      const dcCleaned = dcBlock(ch, sr);
      return reduceNoiseWithProfile(dcCleaned, sr, algoProfile, {
        reductionDb: ctx.state.denoiseReductionDb,
        removeHum: true,
      });
    });

    rebuildTakeFromChannels(ctx, st, denoisedChannels, sr, normalizeNoiseProfile(st.take.noiseProfile));
    if (st.manifest) {
      ctx.runAutoSamplerPostProcessOnTake(st);
    }
    toast(
      `Applied Algorithmic Denoise (-${ctx.state.denoiseReductionDb} dB + DC Block + 50/60Hz Hum Notch, floor ${algoProfile.levelDbfs.toFixed(1)} dBFS).`,
      'success'
    );
    ctx.renderTakes();
    ctx.renderTakeInspector();
    return true;
  }


export function applyDspDenoiseToTake(ctx: RecorderContext, takeId?: string): boolean {
    const st = takeId ? ctx.state.takes.find((t) => t.id === takeId) : ctx.getSelectedTake();
    if (!st) return false;

    if (
      st.selectionStartFrame !== null &&
      st.selectionEndFrame !== null &&
      st.selectionEndFrame > st.selectionStartFrame + 16
    ) {
      const mono = mixToMono(st.take);
      st.take.noiseProfile = captureNoisePrintFromRegion(mono, st.take.sampleRate, {
        startFrame: st.selectionStartFrame,
        endFrame: st.selectionEndFrame,
      });
      const sMs = ((st.selectionStartFrame / st.take.sampleRate) * 1000).toFixed(0);
      const eMs = ((st.selectionEndFrame / st.take.sampleRate) * 1000).toFixed(0);
      st.noiseRegionLabel = `Selection (${sMs}..${eMs} ms)`;
    } else if (!st.take.noiseProfile) {
      captureNoisePrintFromSelection(ctx, st.id);
    }

    const profile = normalizeNoiseProfile(st.take.noiseProfile);
    if (!profile) {
      toast('Select a noise region or capture a noise print first.', 'warning');
      return false;
    }

    pushUndoSnapshot(ctx, st);
    const denoisedChannels = st.take.samples.map((ch) => {
      const dcCleaned = dcBlock(ch, st.take.sampleRate);
      return reduceNoiseWithProfile(dcCleaned, st.take.sampleRate, profile, {
        reductionDb: ctx.state.denoiseReductionDb,
        removeHum: true,
      });
    });

    rebuildTakeFromChannels(ctx, st, denoisedChannels);
    if (st.manifest) {
      ctx.runAutoSamplerPostProcessOnTake(st);
    }
    toast(
      `Applied DSP Spectral Denoise (-${ctx.state.denoiseReductionDb} dB + 50/60Hz Hum Notch) using ${st.noiseRegionLabel || 'Noise Print'}.`,
      'success'
    );
    ctx.renderTakes();
    ctx.renderTakeInspector();
    return true;
  }


export function applyNormalizeAndDcBlockToTake(ctx: RecorderContext, mode: 'peak' | 'rms' = 'peak', takeId?: string): boolean {
    const st = takeId ? ctx.state.takes.find((t) => t.id === takeId) : ctx.getSelectedTake();
    if (!st) return false;
    pushUndoSnapshot(ctx, st);

    const processed = st.take.samples.map((ch) => {
      const clean = dcBlock(ch, st.take.sampleRate);
      return mode === 'peak' ? normalizePeak(clean, -1.0) : normalizeRms(clean, -16, 24);
    });
    rebuildTakeFromChannels(ctx, st, processed);
    if (st.manifest) {
      ctx.runAutoSamplerPostProcessOnTake(st);
    }
    toast(
      mode === 'peak'
        ? `Normalized peak to -1.0 dBFS + DC Block applied.`
        : `Normalized RMS to -16.0 dBFS + DC Block applied.`,
      'success'
    );
    ctx.renderTakes();
    ctx.renderTakeInspector();
    return true;
  }


export function getAiDenoiseActionContext(ctx: RecorderContext) {
    const aiConfig = ctx.state.context.getAiConfig?.();
    const byokCfg = cloudByokClient.getConfig();
    const llmProvider = cloudByokClient.getFirstAvailableTextProvider();
    const isCloudReady = Boolean(
      byokCfg.enabled && (llmProvider || cloudByokClient.hasValidKey(byokCfg.provider))
    );
    return {
      isBridgeConnected: bridgeClient.isConnected(),
      isCloudReady,
      activeTextLlmProvider: llmProvider,
      aiConfig,
    };
  }


export async function applyAiEnhanceToTake(ctx: RecorderContext, takeId?: string): Promise<boolean> {
    const st = takeId ? ctx.state.takes.find((t) => t.id === takeId) : ctx.getSelectedTake();
    if (!st) return false;

    if (
      st.selectionStartFrame !== null &&
      st.selectionEndFrame !== null &&
      st.selectionEndFrame > st.selectionStartFrame + 16
    ) {
      const mono = mixToMono(st.take);
      st.take.noiseProfile = captureNoisePrintFromRegion(mono, st.take.sampleRate, {
        startFrame: st.selectionStartFrame,
        endFrame: st.selectionEndFrame,
      });
      const sMs = ((st.selectionStartFrame / st.take.sampleRate) * 1000).toFixed(0);
      const eMs = ((st.selectionEndFrame / st.take.sampleRate) * 1000).toFixed(0);
      st.noiseRegionLabel = `Selection (${sMs}..${eMs} ms)`;
    } else if (!st.take.noiseProfile) {
      captureNoisePrintFromSelection(ctx, st.id);
    }

    const noiseProfile = normalizeNoiseProfile(st.take.noiseProfile);

    if (!bridgeClient.isConnected()) {
      await bridgeClient.checkHealth();
    }

    const aiCtx = getAiDenoiseActionContext(ctx, );
    const aiDecl = resolveAiActionDeclaration('recorder-ai-denoise', aiCtx);

    if (aiDecl.requiresFallbackConsent) {
      const accepted = await (ctx.state.context.confirm ?? confirmDialog)(aiDecl.consentMessage, {
        title: aiDecl.consentTitle,
        confirmLabel: aiDecl.consentConfirmLabel,
        cancelLabel: 'Cancelar',
      });
      if (!accepted) {
        return false;
      }
      toast(
        `Aplicando ${aiDecl.fallbackEngine} (confirmado por el usuario)...`,
        'info'
      );
      applyDspDenoiseToTake(ctx, st.id);
      applyNormalizeAndDcBlockToTake(ctx, 'peak', st.id);
      return true;
    }

    const btn = ctx.state.backdropEl?.querySelector<HTMLButtonElement>('#btn-rec-ai-enhance');
    if (btn) btn.disabled = true;

    try {
      toast(
        `Aplicando Denoise IA (${aiDecl.primaryEngine}) sobre "${st.name}"...`,
        'info'
      );

      let effectiveReductionDb = ctx.state.denoiseReductionDb;
      if (aiCtx.activeTextLlmProvider && noiseProfile) {
        try {
          const llmRes = await cloudByokClient.generateText(
            `Audio take noise floor is ${noiseProfile.levelDbfs.toFixed(1)} dBFS, 50Hz hum ${noiseProfile.hum50HzDb.toFixed(1)} dB, 60Hz hum ${noiseProfile.hum60HzDb.toFixed(1)} dB. Return ONLY an integer between 6 and 28 for optimal spectral subtraction reduction dB without musical artifacts.`,
            { provider: aiCtx.activeTextLlmProvider, maxTokens: 16, temperature: 0.1 }
          );
          const parsedDb = parseInt(llmRes.text.replace(/[^0-9]/g, ''), 10);
          if (Number.isFinite(parsedDb) && parsedDb >= 6 && parsedDb <= 28) {
            effectiveReductionDb = parsedDb;
            ctx.state.denoiseReductionDb = parsedDb;
          }
        } catch {
          // keep user reduction dB if cloud call fails
        }
      }

      let inputChannels = st.take.samples;
      if (noiseProfile) {
        inputChannels = inputChannels.map((ch) =>
          reduceNoiseWithProfile(dcBlock(ch, st.take.sampleRate), st.take.sampleRate, noiseProfile, {
            reductionDb: effectiveReductionDb,
            removeHum: true,
          })
        );
      }

      if (bridgeClient.isConnected()) {
        const preCleanedWav = encodeWav16(inputChannels, st.take.sampleRate);
        const want96k = Boolean(aiCtx.aiConfig?.enabled && aiCtx.aiConfig?.masterWave === 'ai');
        const enhancedWavBytes = await bridgeClient.enhanceAudio(preCleanedWav, {
          targetSampleRate: want96k ? 96000 : st.take.sampleRate,
          capabilities: want96k
            ? ['spectral-denoise', 'deepfilter', 'resample-96k', 'harmonic-bwe']
            : ['spectral-denoise', 'deepfilter'],
          noiseProfile,
        });

        const decoded = decodeWav(
          enhancedWavBytes.buffer.slice(
            enhancedWavBytes.byteOffset,
            enhancedWavBytes.byteOffset + enhancedWavBytes.byteLength
          ) as ArrayBuffer
        );

        pushUndoSnapshot(ctx, st);
        const newChannels =
          decoded.channels && decoded.channels.length > 0
            ? decoded.channels
            : [decoded.mono];
        st.selectionStartFrame = null;
        st.selectionEndFrame = null;
        rebuildTakeFromChannels(ctx, st, newChannels, decoded.sampleRate, noiseProfile);

        toast(
          `Denoise IA completado sobre "${st.name}" (DeepFilterNet 3 · -${effectiveReductionDb} dB)!`,
          'success'
        );
      } else {
        // Cloud LLM calibrated adaptive spectral denoise
        pushUndoSnapshot(ctx, st);
        st.selectionStartFrame = null;
        st.selectionEndFrame = null;
        rebuildTakeFromChannels(ctx, st, inputChannels, st.take.sampleRate, noiseProfile);
        toast(
          `Denoise IA (${aiCtx.activeTextLlmProvider?.toUpperCase() || 'Cloud'} · -${effectiveReductionDb} dB) completado sobre "${st.name}"!`,
          'success'
        );
      }
      ctx.renderTakes();
      ctx.renderTakeInspector();
      return true;
    } catch (err) {
      toast(
        `Denoise IA error: ${err instanceof Error ? err.message : String(err)}`,
        'error'
      );
      return false;
    } finally {
      if (btn) btn.disabled = false;
    }
  }


export function undoTakeEdit(ctx: RecorderContext, takeId?: string): boolean {
    const st = takeId ? ctx.state.takes.find((t) => t.id === takeId) : ctx.getSelectedTake();
    if (!st || st.history.length === 0) return false;
    const prev = st.history.pop()!;
    st.selectionStartFrame = null;
    st.selectionEndFrame = null;
    rebuildTakeFromChannels(ctx, st, prev.samples, prev.sampleRate, prev.noiseProfile);
    toast(`Restored previous state of "${st.name}".`, 'info');
    ctx.renderTakes();
    ctx.renderTakeInspector();
    return true;
  }

  // ── Takes: audition / chopper / inject / download / delete ─


export function selectTake(ctx: RecorderContext, id: string): void {
    if (ctx.state.selectedTakeId === id) return;
    ctx.state.selectedTakeId = id;
    const found = ctx.getSelectedTake();
    if (found?.manifest) {
      ctx.state.activeSchedule = found.manifest.events.map((ev) => ({ ...ev }));
    }
    ctx.renderTakes();
    ctx.renderTakeInspector();
    if (ctx.state.operatingMode === 'midi_autosampler') {
      ctx.renderAutoSamplerGrid();
    }
  }


export function auditionTake(ctx: RecorderContext, id: string): void {
    const found = ctx.state.takes.find((t) => t.id === id);
    if (!found || !ctx.state.context.onAuditionPcm) return;
    ctx.state.selectedTakeId = id;
    ctx.state.context.onAuditionPcm(mixToMono(found.take), found.take.sampleRate);
    ctx.renderTakes();
    ctx.renderTakeInspector();
  }


export function auditionSelectedRegion(ctx: RecorderContext): void {
    const st = ctx.getSelectedTake();
    if (!st || !ctx.state.context.onAuditionPcm) return;
    const mono = mixToMono(st.take);
    if (
      st.selectionStartFrame !== null &&
      st.selectionEndFrame !== null &&
      st.selectionEndFrame > st.selectionStartFrame
    ) {
      ctx.state.context.onAuditionPcm(
        mono.subarray(st.selectionStartFrame, st.selectionEndFrame),
        st.take.sampleRate
      );
    } else {
      ctx.state.context.onAuditionPcm(mono, st.take.sampleRate);
    }
  }


export function sendTakeToChopper(ctx: RecorderContext, id: string): void {
    const found = ctx.state.takes.find((t) => t.id === id);
    if (!found || !ctx.state.context.onSendToChopper) return;
    if (found.manifest) {
      ctx.runAutoSamplerPostProcessOnTake(found);
    }
    const wavBuf = found.take.wav.buffer.slice(
      found.take.wav.byteOffset,
      found.take.wav.byteOffset + found.take.wav.byteLength
    ) as ArrayBuffer;
    ctx.state.context.onSendToChopper(wavBuf, `${found.name}.wav`);
  }


export function injectTakeIntoSession(ctx: RecorderContext, id: string): void {
    const found = ctx.state.takes.find((t) => t.id === id);
    if (!found) return;
    if (found.manifest && ctx.state.context.onInjectAutoSampledInstrument) {
      const processed = found.processedAutoSample ?? ctx.runAutoSamplerPostProcessOnTake(found);
      if (processed && processed.extendedRegions.length > 0) {
        ctx.state.context.onInjectAutoSampledInstrument({
          classicZones: processed.classicZones,
          extendedRegions: processed.extendedRegions,
          audioBuffers: processed.audioBuffers,
          modelName: found.manifest.name,
        });
        return;
      }
    }
    if (!ctx.state.context.onInjectTakeIntoSession) return;
    const wavBuf = found.take.wav.buffer.slice(
      found.take.wav.byteOffset,
      found.take.wav.byteOffset + found.take.wav.byteLength
    ) as ArrayBuffer;
    ctx.state.context.onInjectTakeIntoSession(wavBuf, `${found.name}.wav`);
  }


export function downloadTake(ctx: RecorderContext, id: string): void {
    const found = ctx.state.takes.find((t) => t.id === id);
    if (!found) return;
    downloadBlob(new Blob([found.take.wav.slice(0)], { type: 'audio/wav' }), `${found.name}.wav`);
  }


export function deleteTake(ctx: RecorderContext, id: string): void {
    ctx.state.takes = ctx.state.takes.filter((t) => t.id !== id);
    if (ctx.state.selectedTakeId === id) {
      ctx.state.selectedTakeId = ctx.state.takes[0]?.id ?? null;
    }
    ctx.renderTakes();
    ctx.renderTakeInspector();
  }

  // ── Render Principal ──────────────────────────────────────

