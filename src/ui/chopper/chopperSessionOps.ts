// ─────────────────────────────────────────────────────────
// AudioChopperModal — chopperSessionOps (Fase 42.5)
// Funciones extraidas verbatim de `src/ui/AudioChopperModal.ts`.
// `ctx` es el contexto estructural (`ChopperContext`).
// ─────────────────────────────────────────────────────────

import { resolveAiActionDeclaration, separateStemsDspFallback } from '../../core/ai/aiHonesty.ts';
import { bridgeClient } from '../../core/bridge/BridgeClient.ts';
import { buildSlicesFromPhoneticWords, conformLoopToTargetBpm } from '../../core/dsp/AudioSlicerEngine.ts';
import { encodePcm16Wav, decodeWav } from '../../core/dsp/WavDecoder.ts';
import { isEs } from '../../core/i18n.ts';
import type { Zone, ExtendedRegion } from '../../core/types.ts';
import type { ChopperContext } from '../chopper/types.ts';
import { ICONS } from '../icons.ts';
import { createModalFocusTrap } from '../modalFocusTrap.ts';
import { confirmDialog, toast } from '../notify.ts';

export async function reconcileSlicesAfterAudioClean(ctx: ChopperContext, actionLabel: string): Promise<void> {
    if (!ctx.hasManualCuts()) {
      ctx.recomputeSlices(true);
      ctx.render();
      toast(`${actionLabel} (cortes automáticos recalculados sobre el audio limpio).`, 'success');
      return;
    }

    if (ctx.state.manualCutsPolicy === 'discard') {
      ctx.state.manualCutFrames.clear();
      ctx.state.manualSilenceRanges = [];
      ctx.recomputeSlices(true);
      ctx.render();
      toast(`${actionLabel} (cortes recalculados automáticamente).`, 'success');
      return;
    }

    if (ctx.state.manualCutsPolicy === 'keep') {
      ctx.recomputeSlices(false);
      ctx.render();
      toast(`${actionLabel} (cortes manuales preservados).`, 'success');
      return;
    }

    const recalculateAuto = await confirmDialog(
      `La limpieza o mejora cambió la señal de audio y tienes ${ctx.state.manualCutFrames.size} corte(s) manual(es).\n\n¿Recalcular cortes automáticamente sobre el audio limpio (descartando ediciones manuales) o conservar tus marcas manuales?`,
      {
        title: 'La limpieza cambió el audio — ¿Recalcular cortes?',
        confirmLabel: 'Recalcular cortes (Auto)',
        cancelLabel: 'Conservar cortes manuales',
      }
    );

    if (recalculateAuto) {
      ctx.state.manualCutFrames.clear();
      ctx.state.manualSilenceRanges = [];
      ctx.recomputeSlices(true);
      ctx.render();
      toast(`${actionLabel} (cortes recalculados sobre el audio limpio).`, 'success');
    } else {
      ctx.recomputeSlices(false);
      ctx.render();
      toast(`${actionLabel} (cortes manuales conservados).`, 'info');
    }
  }

export function suspendFocusTrap(ctx: ChopperContext): void {
    ctx.state.focusTrap?.deactivate();
  }

export function resumeFocusTrap(ctx: ChopperContext): void {
    if (ctx.state.backdropEl && ctx.state.focusTrap) {
      ctx.state.focusTrap.activate();
    }
  }

export function closeConfirmModal(ctx: ChopperContext, resumeParent: boolean = true): void {
    if (ctx.state.nestedTrap) {
      ctx.state.nestedTrap.deactivate();
      ctx.state.nestedTrap = null;
    }
    if (ctx.state.activeConfirmModalEl) {
      ctx.state.activeConfirmModalEl.remove();
      ctx.state.activeConfirmModalEl = null;
    }
    if (resumeParent) {
      resumeFocusTrap(ctx);
    }
  }

export function showManualCutsConfirmationModal(ctx: ChopperContext, descriptionHtml: string, onKeep: () => void, onDiscard: () => void, onCancel: () => void): void {
    closeConfirmModal(ctx);
    const es = isEs();

    const modal = document.createElement('div');
    modal.className = 'nmm-modal-backdrop nmm-confirm-backdrop';
    modal.innerHTML = `
      <div class="nmm-modal-window nmm-confirm-window">
        <header class="nmm-modal-header">
          <div class="nmm-modal-header-title">
            <span class="nmm-modal-header-icon">${ICONS.scissors}</span>
            <h2>${es ? 'Cortes Manuales Detectados' : 'Manual Slice Edits Detected'}</h2>
          </div>
          <button type="button" class="nmm-modal-close" id="btn-confirm-close" aria-label="${es ? 'Cerrar' : 'Close'}">${ICONS.close}</button>
        </header>
        <div class="nmm-modal-body nmm-audio-modal-body">
          <p>
            ${descriptionHtml}
          </p>
          <div class="nmm-audio-controls-card">
            <span class="badge-manual-cuts">${es ? 'Personalizaciones manuales:' : 'Manual Customizations:'}</span>
            <ul>
              <li><strong>${ctx.state.manualCutFrames.size}</strong> ${es ? 'marcador(es) de corte manual(es)' : 'manual slice cut marker(s)'}</li>
              ${ctx.state.manualSilenceRanges.length > 0 ? `<li><strong>${ctx.state.manualSilenceRanges.length}</strong> ${es ? 'intervalo(s) de silencio manual(es)' : 'manual silence interval(s)'}</li>` : ''}
            </ul>
          </div>
          <p class="nmm-audio-table-hint">
            ${es ? '¿Cómo quieres gestionar tus cortes manuales?' : 'How would you like to handle your manual cuts?'}
          </p>
          <label class="batch-check nmm-audio-table-hint">
            <input type="checkbox" class="articulation-checkbox switch--sm" id="chk-remember-policy" />
            <span>${es ? 'Recordar elección para próximos cambios en esta sesión' : 'Remember choice for subsequent changes in this session'}</span>
          </label>
        </div>
        <footer class="nmm-modal-footer">
          <div class="footer-left">
            <button type="button" class="btn btn-ghost" id="btn-cuts-cancel">${es ? 'Cancelar' : 'Cancel'}</button>
          </div>
          <div class="footer-right">
            <button type="button" class="btn btn-danger-solid" id="btn-cuts-discard">${es ? 'Descartar Cortes (Auto)' : 'Discard Cuts (Auto)'}</button>
            <button type="button" class="btn btn-primary" id="btn-cuts-keep">${es ? 'Conservar Cortes Manuales' : 'Keep Manual Cuts'}</button>
          </div>
        </footer>
      </div>
    `;

    document.body.appendChild(modal);
    ctx.state.activeConfirmModalEl = modal;

    // El diálogo anidado vive fuera del backdrop: trampa propia + padre en pausa.
    suspendFocusTrap(ctx);
    ctx.state.nestedTrap = createModalFocusTrap(modal, {
      initialFocusSelector: '#btn-cuts-keep',
      onEscape: () => {
        closeConfirmModal(ctx);
        onCancel();
      },
    });
    ctx.state.nestedTrap.activate();

    const rememberCheck = modal.querySelector('#chk-remember-policy') as HTMLInputElement | null;

    modal.querySelector('#btn-confirm-close')?.addEventListener('click', () => {
      closeConfirmModal(ctx);
      onCancel();
    });
    modal.querySelector('#btn-cuts-cancel')?.addEventListener('click', () => {
      closeConfirmModal(ctx);
      onCancel();
    });
    modal.querySelector('#btn-cuts-discard')?.addEventListener('click', () => {
      const remember = rememberCheck?.checked;
      if (remember) ctx.state.manualCutsPolicy = 'discard';
      closeConfirmModal(ctx);
      onDiscard();
    });
    modal.querySelector('#btn-cuts-keep')?.addEventListener('click', () => {
      const remember = rememberCheck?.checked;
      if (remember) ctx.state.manualCutsPolicy = 'keep';
      closeConfirmModal(ctx);
      onKeep();
    });
  }

export function handleInjectConformedLoopIntoSession(ctx: ChopperContext): void {
    const res = ctx.state.currentResult;
    if (!res || ctx.state.pcm.length === 0) return;

    const validSlices = res.slices.filter((s) => !s.isSilence);
    if (validSlices.length === 0) {
      toast('No valid slices to conform into a loop.', 'warning');
      return;
    }

    const sourceBpm = res.detectedBpm || ctx.state.options.bpm || 120;
    const targetBpm = ctx.state.options.targetBpm ?? res.targetBpm ?? sourceBpm;
    const barCount = res.detectedBars ?? ctx.state.options.barCount ?? 2;

    const conformed = conformLoopToTargetBpm(
      ctx.state.pcm,
      ctx.state.sampleRate,
      res.slices,
      sourceBpm,
      targetBpm,
      { barCount }
    );

    const isExtended = ctx.state.context.getCurrentWorkingMode() === 'extended';
    const baseName = (ctx.state.sourceFilename || 'loop').replace(/\.[^/.]+$/, '');
    const loopWavName = `${baseName}_loop_${Math.round(targetBpm)}bpm.wav`;
    const rootKey = ctx.state.options.mode === 'chromatic' ? (validSlices[0]?.rootKey ?? 60) : 60;
    const wavBuffer = encodePcm16Wav(conformed.pcm, ctx.state.sampleRate, {
      rootKey,
      lowKey: 0,
      highKey: 127,
      loopStart: 0,
      loopEnd: Math.max(0, conformed.pcm.length - 1),
    });

    const audioSamples = [{ name: loopWavName, buffer: wavBuffer }];

    // Persist Tempo-Sync contract metadata for the ABDAxionikVS Resinator v2
    ctx.state.context.onUpdateTempoSync?.({
      enabled: true,
      sourceBpm: targetBpm,
      targetBpm,
      barCount,
      timeSignature: [4, 4],
      grooveMode: ctx.state.options.mode === 'chromatic' ? 'melodic_phrase' : 'rex_loop',
      sliceCount: validSlices.length,
    });

    if (isExtended) {
      const region: ExtendedRegion = {
        id: `reg_loop_${Date.now()}`,
        sampleName: loopWavName,
        rootKey,
        lowKey: 0,
        highKey: 127,
        lowVel: 1,
        highVel: 127,
        detune: 0,
        volume: 0,
        pan: 0,
        pitchKeytrack: ctx.state.options.mode === 'drums' ? 0 : 100,
        trigger: 'attack',
        keyFadeIn: 0,
        keyFadeOut: 0,
        velFadeIn: 0,
        velFadeOut: 0,
        fadeCurve: 'equal-power',
        loopMode: 'loop_continuous',
        loopStart: 0,
        loopEnd: conformed.pcm.length,
        loopCrossfadeMs: 5,
        sampleRate: ctx.state.sampleRate,
        numChannels: 1,
      };
      ctx.state.context.onInjectExtendedRegions?.([region], audioSamples);
      toast(
        `Inyectado Loop Continuo conformado a ${targetBpm} BPM (${barCount} compases) + Tempo-Sync activo para Resinator v2.`,
        'success'
      );
    } else {
      const zone: Zone = {
        id: `zone_loop_${Date.now()}`,
        rootKey,
        lowKey: 0,
        highKey: 127,
        sampleLow: loopWavName,
        sampleHigh: null,
        velSplit: 64,
        detune: 0,
        volume: 0,
        pan: 0,
      };
      ctx.state.context.onInjectClassicZones?.([zone], audioSamples);
      toast(`Inyectado Loop Continuo conformado a ${targetBpm} BPM en sesión Classic.`, 'success');
    }

    ctx.close();
  }

export function handleInjectSlicesIntoSession(ctx: ChopperContext): void {
    const res = ctx.state.currentResult;
    if (!res) return;

    const validSlices = res.slices.filter((s) => !s.isSilence);
    if (validSlices.length === 0) {
      toast('No valid slices to inject into session.', 'warning');
      return;
    }

    // If in REX / Groove Loop workflow, also store Tempo-Sync metadata in ProcessConfig
    if ((ctx.state.options.workflowMode ?? 'rex_groove_loop') === 'rex_groove_loop') {
      const sourceBpm = res.detectedBpm || ctx.state.options.bpm || 120;
      const targetBpm = ctx.state.options.targetBpm ?? res.targetBpm ?? sourceBpm;
      const barCount = res.detectedBars ?? ctx.state.options.barCount ?? 2;
      ctx.state.context.onUpdateTempoSync?.({
        enabled: true,
        sourceBpm,
        targetBpm,
        barCount,
        timeSignature: [4, 4],
        grooveMode: ctx.state.options.mode === 'chromatic' ? 'melodic_phrase' : 'sliced_kit',
        sliceCount: validSlices.length,
      });
    }

    const isExtended = ctx.state.context.getCurrentWorkingMode() === 'extended';
    const baseName = (ctx.state.sourceFilename || 'sample').replace(/\.[^/.]+$/, '');
    const audioSamples: Array<{ name: string; buffer: ArrayBuffer }> = [];

    validSlices.forEach((sl, idx) => {
      const sliceWavName = `${baseName}_slice${String(idx + 1).padStart(2, '0')}.wav`;
      const wavBuffer = encodePcm16Wav(sl.pcm, ctx.state.sampleRate, {
        rootKey: sl.rootKey,
        lowKey: sl.lowKey,
        highKey: sl.highKey,
      });
      audioSamples.push({ name: sliceWavName, buffer: wavBuffer });
    });

    if (isExtended) {
      const isDrum = ctx.state.options.mode === 'drums';
      const regions: ExtendedRegion[] = validSlices.map((sl, idx) => ({
        id: `reg_chopped_${idx + 1}_${Date.now()}`,
        sampleName: audioSamples[idx].name,
        rootKey: sl.rootKey,
        lowKey: sl.lowKey,
        highKey: sl.highKey,
        lowVel: sl.lowVel,
        highVel: sl.highVel,
        detune: 0,
        volume: 0,
        pan: 0,
        pitchKeytrack: isDrum ? 0 : 100,
        trigger: 'attack',
        keyFadeIn: 0,
        keyFadeOut: 0,
        velFadeIn: 0,
        velFadeOut: 0,
        fadeCurve: 'equal-power',
        loopMode: 'no_loop',
        loopStart: 0,
        loopEnd: sl.pcm.length,
        loopCrossfadeMs: 0,
        sampleRate: ctx.state.sampleRate,
        numChannels: 1,
      }));

      ctx.state.context.onInjectExtendedRegions?.(regions, audioSamples);
      toast(`Successfully mapped ${regions.length} audio slices to 2D Sampler Regions!`, 'success');
    } else {
      const zones: Zone[] = validSlices.map((sl, idx) => ({
        id: `zone_chopped_${idx + 1}_${Date.now()}`,
        rootKey: sl.rootKey,
        lowKey: sl.lowKey,
        highKey: sl.highKey,
        sampleLow: audioSamples[idx].name,
        sampleHigh: null,
        velSplit: 64,
        detune: 0,
        volume: 0,
        pan: 0,
      }));

      ctx.state.context.onInjectClassicZones?.(zones, audioSamples);
      toast(`Successfully mapped ${zones.length} audio slices to Classic Keyboard Zones!`, 'success');
    }

    ctx.close();
  }

export async function runWhisperVocalAlignment(ctx: ChopperContext): Promise<void> {
    if (ctx.state.pcm.length === 0) {
      toast('Please load or drop an audio file before aligning vocal phonemes.', 'warning');
      return;
    }

    if (!bridgeClient.isConnected()) {
      await bridgeClient.checkHealth();
    }
    const decl = resolveAiActionDeclaration('chopper-whisper-align', {
      isBridgeConnected: bridgeClient.isConnected(),
    });
    if (decl.requiresFallbackConsent) {
      const ok = await confirmDialog(decl.consentMessage, {
        title: decl.consentTitle,
        confirmLabel: decl.consentConfirmLabel,
        cancelLabel: 'Cancelar',
      });
      if (!ok) return;
      ctx.state.options.mode = 'vocals';
      ctx.state.manualSilenceRanges = [];
      ctx.state.manualCutFrames.clear();
      ctx.recomputeSlices(true);
      ctx.render();
      toast(`Aplicada ${decl.fallbackEngine} (confirmado por el usuario).`, 'success');
      return;
    }

    const btn = ctx.state.backdropEl?.querySelector('#btn-chopper-whisper-align') as HTMLButtonElement | null;
    if (btn) btn.disabled = true;

    toast('Analyzing vocal phonemes with Whisper-tiny...', 'info');

    try {
      const wavBuf = encodePcm16Wav(ctx.state.pcm, ctx.state.sampleRate);
      const res = await bridgeClient.alignPhonemes(wavBuf);

      if (!res.success || !res.words || res.words.length === 0) {
        toast(`Whisper alignment: ${res.error || 'No distinct vocal phonemes or words detected in audio.'}`, 'warning');
        return;
      }

      ctx.state.options.mode = 'vocals';
      ctx.state.manualSilenceRanges = [];
      ctx.state.manualCutsPolicy = 'prompt';

      ctx.state.currentResult = buildSlicesFromPhoneticWords(
        ctx.state.pcm,
        ctx.state.sampleRate,
        res.words,
        ctx.state.options
      );

      ctx.state.manualCutFrames = new Set(
        ctx.state.currentResult.slices
          .map((s) => s.startFrame)
          .filter((f) => f > 0 && f < ctx.state.pcm.length)
      );

      ctx.state.selectedSliceId = ctx.state.currentResult.slices[0]?.id ?? null;
      ctx.state.activeBoundaryIndex = 1;

      ctx.render();
      toast(
        `Aligned ${res.words.length} vocal segments via Whisper-tiny (${((res.durationSec ?? 0) * 1000).toFixed(0)}ms total)!`,
        'success'
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`Whisper alignment error: ${msg}`, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

export function showStemSeparationModal(ctx: ChopperContext): void {
    if (ctx.state.pcm.length === 0) {
      toast('Please load an audio file first before separating stems.', 'warning');
      return;
    }

    const modal = document.createElement('div');
    modal.className = 'nmm-modal-backdrop nmm-stem-split-backdrop';
    modal.innerHTML = `
      <div class="nmm-modal-window nmm-confirm-window">
        <header class="nmm-modal-header">
          <div class="nmm-modal-header-title">
            <span class="nmm-modal-header-icon">${ICONS.wave}</span>
            <h2>Demucs AI Stem Separation</h2>
          </div>
          <button type="button" class="nmm-modal-close" id="btn-stem-close" aria-label="Close">${ICONS.close}</button>
        </header>
        <div class="nmm-modal-body nmm-audio-modal-body">
          <p>
            Isolate vocal lines or instrument stems using Demucs neural stem separation (or high-fidelity Mid/Side DSP fallback) before slicing.
          </p>
          <div class="nmm-audio-controls-card">
            <div class="nmm-audio-table-title">Stems to Separate:</div>
            <div class="nmm-audio-params-grid">
              <label class="batch-check">
                <input type="checkbox" class="articulation-checkbox switch--sm" id="chk-stem-vocals" checked />
                <span>Vocals (Acapella)</span>
              </label>
              <label class="batch-check">
                <input type="checkbox" class="articulation-checkbox switch--sm" id="chk-stem-drums" checked />
                <span>Drums (Percussion)</span>
              </label>
              <label class="batch-check">
                <input type="checkbox" class="articulation-checkbox switch--sm" id="chk-stem-bass" checked />
                <span>Bass (Low-End)</span>
              </label>
              <label class="batch-check">
                <input type="checkbox" class="articulation-checkbox switch--sm" id="chk-stem-instrumental" checked />
                <span>Instrumental (Other)</span>
              </label>
            </div>
          </div>
          <div id="stem-results-container" class="nmm-audio-table-panel is-hidden">
            <div class="nmm-audio-table-title">Separated Audio Stems:</div>
            <div id="stem-buttons-list" class="nmm-recorder-takes"></div>
          </div>
          <div id="stem-processing-indicator" class="nmm-audio-table-hint is-hidden">
            <span>Running Demucs stem separation via Companion Bridge...</span>
          </div>
        </div>
        <footer class="nmm-modal-footer">
          <div class="footer-left">
            <button type="button" class="btn btn-ghost" id="btn-stem-cancel">Close</button>
          </div>
          <div class="footer-right">
            <button type="button" class="btn btn-primary" id="btn-stem-run">${ICONS.sparkle} Run Separation</button>
          </div>
        </footer>
      </div>
    `;

    document.body.appendChild(modal);

    const closeModal = () => {
      if (ctx.state.nestedTrap) {
        ctx.state.nestedTrap.deactivate();
        ctx.state.nestedTrap = null;
      }
      modal.remove();
      resumeFocusTrap(ctx);
    };

    // Diálogo anidado fuera del backdrop: trampa propia + padre en pausa.
    suspendFocusTrap(ctx);
    ctx.state.nestedTrap = createModalFocusTrap(modal, {
      initialFocusSelector: '#btn-stem-run',
      onEscape: () => closeModal(),
    });
    ctx.state.nestedTrap.activate();

    modal.querySelector('#btn-stem-close')?.addEventListener('click', closeModal);
    modal.querySelector('#btn-stem-cancel')?.addEventListener('click', closeModal);

    const runBtn = modal.querySelector('#btn-stem-run') as HTMLButtonElement | null;
    const processingEl = modal.querySelector('#stem-processing-indicator') as HTMLElement | null;
    const resultsContainer = modal.querySelector('#stem-results-container') as HTMLElement | null;
    const listEl = modal.querySelector('#stem-buttons-list') as HTMLElement | null;

    runBtn?.addEventListener('click', async () => {
      const stems: string[] = [];
      if ((modal.querySelector('#chk-stem-vocals') as HTMLInputElement)?.checked) stems.push('vocals');
      if ((modal.querySelector('#chk-stem-drums') as HTMLInputElement)?.checked) stems.push('drums');
      if ((modal.querySelector('#chk-stem-bass') as HTMLInputElement)?.checked) stems.push('bass');
      if ((modal.querySelector('#chk-stem-instrumental') as HTMLInputElement)?.checked) stems.push('instrumental');

      if (stems.length === 0) {
        toast('Select at least one stem to separate.', 'warning');
        return;
      }

      if (!bridgeClient.isConnected()) {
        await bridgeClient.checkHealth();
      }
      const decl = resolveAiActionDeclaration('chopper-demucs-split', {
        isBridgeConnected: bridgeClient.isConnected(),
      });

      const renderStemRows = (stemMap: Record<string, ArrayBuffer>, usedLabel: string) => {
        if (resultsContainer && listEl) {
          resultsContainer.classList.remove('is-hidden');
          listEl.innerHTML = '';

          const stemEntries = Object.entries(stemMap);
          if (stemEntries.length === 0) {
            listEl.innerHTML = '<div class="nmm-recorder-takes-empty">No stems were returned.</div>';
          }

          for (const [name, buf] of stemEntries) {
            const row = document.createElement('div');
            row.className = 'nmm-recorder-take';

            const label = document.createElement('span');
            label.className = 'nmm-recorder-take-name';
            label.textContent = `${name} (${(buf.byteLength / 1024).toFixed(1)} KB)`;

            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'nmm-recorder-take-actions';

            const loadBtn = document.createElement('button');
            loadBtn.type = 'button';
            loadBtn.className = 'btn btn-xs btn-primary';
            loadBtn.textContent = 'Load into Slicer';
            loadBtn.addEventListener('click', () => {
              try {
                const decoded = decodeWav(buf);
                ctx.state.pcm = decoded.mono || decoded.channels[0];
                ctx.state.sampleRate = decoded.sampleRate;
                const baseName = (ctx.state.sourceFilename || 'audio').replace(/\.[^/.]+$/, '');
                ctx.state.sourceFilename = `${baseName}_${name}.wav`;
                ctx.state.context.onRegisterSampleBuffer?.(ctx.state.sourceFilename, buf);
                ctx.recomputeSlices(true);
                ctx.render();
                closeModal();
                toast(`Loaded "${name}" stem into Audio Chopper!`, 'success');
              } catch (e: unknown) {
                const errStr = e instanceof Error ? e.message : String(e);
                toast(`Failed to load stem: ${errStr}`, 'error');
              }
            });

            actionsDiv.appendChild(loadBtn);
            row.appendChild(label);
            row.appendChild(actionsDiv);
            listEl.appendChild(row);
          }
        }
        toast(usedLabel, 'success');
      };

      if (decl.requiresFallbackConsent) {
        const ok = await confirmDialog(decl.consentMessage, {
          title: decl.consentTitle,
          confirmLabel: decl.consentConfirmLabel,
          cancelLabel: 'Cancelar',
        });
        if (!ok) return;
        const fallbackStems = separateStemsDspFallback(
          ctx.state.pcm,
          ctx.state.sampleRate,
          stems,
          (samples, sr) => encodePcm16Wav(samples, sr)
        );
        renderStemRows(fallbackStems, `Stems separados con ${decl.fallbackEngine} (confirmado por el usuario).`);
        return;
      }

      if (runBtn) runBtn.disabled = true;
      if (processingEl) processingEl.classList.remove('is-hidden');

      try {
        const wavBuf = encodePcm16Wav(ctx.state.pcm, ctx.state.sampleRate);
        const res = await bridgeClient.separateStems(wavBuf, { stems });

        if (!res.success) {
          toast(`Demucs separation failed: ${res.error || 'Unknown error'}`, 'error');
          return;
        }

        renderStemRows(res.stems, 'Stem separation completed successfully via HTDemucs Bridge!');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        toast(`Stem separation error: ${msg}`, 'error');
      } finally {
        if (runBtn) runBtn.disabled = false;
        if (processingEl) processingEl.classList.add('is-hidden');
      }
    });
  }
