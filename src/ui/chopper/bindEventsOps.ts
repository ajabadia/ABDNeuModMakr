import type { ChopperContext } from './types.ts';
import { normalizePeakPcm } from '../../core/dsp/AudioSlicerEngine.ts';
import type { SlicerMode, SlicerWorkflowMode } from '../../core/dsp/AudioSlicerEngine.ts';
import { toast } from '../notify.ts';

export function bindChopperFileEvents(ui: ChopperContext): void {
  if (!ui.state.backdropEl) return;

  ui.state.backdropEl.querySelector('#btn-chopper-close')?.addEventListener('click', () => ui.close());
  ui.state.backdropEl.querySelector('#btn-chopper-discard')?.addEventListener('click', () => ui.close());

  // File inputs setup
  const fileInp = ui.state.backdropEl.querySelector('#inp-chopper-audio-file') as HTMLInputElement | null;
  fileInp?.addEventListener('change', () => {
    const file = fileInp.files?.[0];
    if (file) void ui.loadAudioFile(file);
  });

  const markerInp = ui.state.backdropEl.querySelector('#inp-chopper-markers-file') as HTMLInputElement | null;
  markerInp?.addEventListener('change', () => {
    const file = markerInp.files?.[0];
    if (file) void ui.importSliceMarkersFile(file);
  });

  ui.state.backdropEl.querySelector('#btn-chopper-browse-file')?.addEventListener('click', () => fileInp?.click());
  ui.state.backdropEl.querySelector('#btn-chopper-change-file')?.addEventListener('click', () => fileInp?.click());
  ui.state.backdropEl.querySelector('#btn-chopper-import-cues')?.addEventListener('click', () => markerInp?.click());

  ui.state.backdropEl.querySelector('#btn-chopper-whisper-align')?.addEventListener('click', () => {
    void ui.runWhisperVocalAlignment();
  });
  ui.state.backdropEl.querySelector('#btn-chopper-demucs-split')?.addEventListener('click', () => {
    ui.showStemSeparationModal();
  });

  ui.state.backdropEl.querySelector('#btn-chopper-demo-beat')?.addEventListener('click', () => {
    ui.loadTestDemoBeat();
  });

  // Dropzone drag & drop
  const dropzone = ui.state.backdropEl.querySelector('#chopper-empty-dropzone');
  if (dropzone) {
    dropzone.addEventListener('dragover', (e: Event) => {
      e.preventDefault();
      dropzone.classList.add('is-dragover');
    });
    dropzone.addEventListener('dragleave', (e: Event) => {
      e.preventDefault();
      dropzone.classList.remove('is-dragover');
    });
    dropzone.addEventListener('drop', (e: Event) => {
      e.preventDefault();
      dropzone.classList.remove('is-dragover');
      const dt = (e as DragEvent).dataTransfer;
      const file = dt?.files?.[0];
      if (file) void ui.loadAudioFile(file);
    });
  }

  // Zoom Controls
  ui.state.backdropEl.querySelector('#btn-chopper-zoom-in')?.addEventListener('click', () => {
    ui.state.zoomFactor = Math.min(16, ui.state.zoomFactor * 1.5);
    ui.render();
  });
  ui.state.backdropEl.querySelector('#btn-chopper-zoom-out')?.addEventListener('click', () => {
    ui.state.zoomFactor = Math.max(1.0, ui.state.zoomFactor / 1.5);
    ui.render();
  });
  ui.state.backdropEl.querySelector('#btn-chopper-zoom-fit')?.addEventListener('click', () => {
    ui.state.zoomFactor = 1.0;
    ui.state.viewCenterNorm = 0.5;
    ui.render();
  });

}

export function bindChopperDetectControlsEvents(ui: ChopperContext): void {
  if (!ui.state.backdropEl) return;
  // Mode Switching with Manual Cuts Guard
  const switchMode = (newMode: SlicerMode, defaultMinSlice?: number) => {
    if (ui.state.options.mode === newMode) return;
    if (ui.hasManualCuts() && ui.state.manualCutsPolicy === 'prompt') {
      ui.showManualCutsConfirmationModal(
        `You are switching <strong>Slicing Mode</strong> to <strong>${newMode.toUpperCase()}</strong>.`,
        () => {
          ui.state.options.mode = newMode;
          if (defaultMinSlice !== undefined) ui.state.options.minSliceMs = defaultMinSlice;
          ui.recomputeSlices(false);
          ui.render();
          toast(`Mode switched to ${newMode}: manual cuts preserved.`, 'success');
        },
        () => {
          ui.state.options.mode = newMode;
          if (defaultMinSlice !== undefined) ui.state.options.minSliceMs = defaultMinSlice;
          ui.state.manualCutFrames.clear();
          ui.state.manualSilenceRanges = [];
          ui.recomputeSlices(true);
          ui.render();
          toast(`Mode switched to ${newMode}: reset to auto.`, 'info');
        },
        () => {
          // Cancelled: leave mode unchanged
        }
      );
      return;
    }
    ui.state.options.mode = newMode;
    if (defaultMinSlice !== undefined) ui.state.options.minSliceMs = defaultMinSlice;
    ui.recomputeSlices(ui.state.manualCutsPolicy === 'discard');
    ui.render();
  };

  const switchWorkflowMode = (newWf: SlicerWorkflowMode) => {
    if ((ui.state.options.workflowMode ?? 'rex_groove_loop') === newWf) return;
    ui.state.options.workflowMode = newWf;
    ui.recomputeSlices(false);
    ui.render();
    toast(
      newWf === 'one_shot_extractor'
        ? 'Modo 1 activado: Cortar y Mapear One-Shots (Cromático o Caja de Ritmos nota a nota).'
        : 'Modo 2 activado: Bucle Rítmico / Melodía tipo REX (BPM, Groove MIDI y Conformador de Tempo).',
      'info'
    );
  };

  ui.state.backdropEl.querySelector('#btn-wf-oneshot')?.addEventListener('click', () => {
    switchWorkflowMode('one_shot_extractor');
  });
  ui.state.backdropEl.querySelector('#btn-wf-rex')?.addEventListener('click', () => {
    switchWorkflowMode('rex_groove_loop');
  });

  const inpBars = ui.state.backdropEl.querySelector<HTMLInputElement>('#inp-chopper-bars');
  inpBars?.addEventListener('change', () => {
    const bars = Math.max(1, Math.min(64, parseInt(inpBars.value, 10) || 2));
    ui.state.options.barCount = bars;
    ui.recomputeSlices(false);
    ui.render();
  });

  const inpTargetBpm = ui.state.backdropEl.querySelector<HTMLInputElement>('#inp-chopper-target-bpm');
  inpTargetBpm?.addEventListener('change', () => {
    const bpm = Math.max(20, Math.min(300, parseFloat(inpTargetBpm.value) || 120));
    ui.state.options.targetBpm = bpm;
    ui.recomputeSlices(false);
    ui.render();
    toast(`Target BPM ajustado a ${bpm} BPM (transitorios de 25 ms bloqueados).`, 'info');
  });

  ui.state.backdropEl.querySelector('#btn-chopper-play-conformed')?.addEventListener('click', () => {
    ui.auditionConformedLoop();
  });

  ui.state.backdropEl.querySelector('#btn-mode-drums')?.addEventListener('click', () => switchMode('drums', 45));
  ui.state.backdropEl.querySelector('#btn-mode-vocals')?.addEventListener('click', () => switchMode('vocals', 250));
  ui.state.backdropEl.querySelector('#btn-mode-chromatic')?.addEventListener('click', () => switchMode('chromatic'));
  ui.state.backdropEl.querySelector('#btn-mode-grid')?.addEventListener('click', () => switchMode('grid'));

  // Sensitivity Slider with Manual Cuts Protection
  const rngSens = ui.state.backdropEl.querySelector('#rng-sens') as HTMLInputElement | null;
  let prevSensVal = ui.state.options.sensitivity;

  rngSens?.addEventListener('input', () => {
    const newSens = parseInt(rngSens.value, 10);
    if (newSens === ui.state.options.sensitivity) return;

    if (ui.hasManualCuts()) {
      if (ui.state.manualCutsPolicy === 'prompt') {
        ui.showManualCutsConfirmationModal(
          `You are changing <strong>Transient Sensitivity</strong> from ${ui.state.options.sensitivity}% to ${newSens}%.`,
          () => {
            ui.state.options.sensitivity = newSens;
            prevSensVal = newSens;
            const lbl = ui.state.backdropEl?.querySelector('#lbl-sens-val');
            if (lbl) lbl.textContent = `${ui.state.options.sensitivity}%`;
            ui.recomputeSlices(false);
            ui.render();
            toast(`Sensitivity set to ${newSens}%: preserved ${ui.state.manualCutFrames.size} manual cut(s).`, 'success');
          },
          () => {
            ui.state.options.sensitivity = newSens;
            prevSensVal = newSens;
            ui.state.manualCutFrames.clear();
            ui.state.manualSilenceRanges = [];
            const lbl = ui.state.backdropEl?.querySelector('#lbl-sens-val');
            if (lbl) lbl.textContent = `${ui.state.options.sensitivity}%`;
            ui.recomputeSlices(true);
            ui.render();
            toast(`Sensitivity set to ${newSens}%: reset to automatic transient detection.`, 'info');
          },
          () => {
            rngSens.value = String(prevSensVal);
            const lbl = ui.state.backdropEl?.querySelector('#lbl-sens-val');
            if (lbl) lbl.textContent = `${prevSensVal}%`;
          }
        );
        return;
      } else if (ui.state.manualCutsPolicy === 'keep') {
        ui.state.options.sensitivity = newSens;
        prevSensVal = newSens;
        const lbl = ui.state.backdropEl?.querySelector('#lbl-sens-val');
        if (lbl) lbl.textContent = `${ui.state.options.sensitivity}%`;
        ui.recomputeSlices(false);
        ui.drawWaveformCanvas();
        ui.drawMagnifierCanvas();
        ui.refreshTable();
        return;
      }
    }

    ui.state.options.sensitivity = newSens;
    prevSensVal = newSens;
    const lbl = ui.state.backdropEl?.querySelector('#lbl-sens-val');
    if (lbl) lbl.textContent = `${ui.state.options.sensitivity}%`;
    ui.recomputeSlices(ui.state.manualCutsPolicy === 'discard');
    ui.render();
  });

  // Silence Gate Slider with Manual Cuts Protection
  const rngSilence = ui.state.backdropEl.querySelector('#rng-silence') as HTMLInputElement | null;
  let prevSilenceVal = ui.state.options.silenceThresholdDb;

  rngSilence?.addEventListener('input', () => {
    const newSilence = parseInt(rngSilence.value, 10);
    if (newSilence === ui.state.options.silenceThresholdDb) return;

    if (ui.hasManualCuts()) {
      if (ui.state.manualCutsPolicy === 'prompt') {
        ui.showManualCutsConfirmationModal(
          `You are changing <strong>Silence Gate Threshold</strong> from ${ui.state.options.silenceThresholdDb} dB to ${newSilence} dB.`,
          () => {
            ui.state.options.silenceThresholdDb = newSilence;
            prevSilenceVal = newSilence;
            const lbl = ui.state.backdropEl?.querySelector('#lbl-silence-val');
            if (lbl) lbl.textContent = `${ui.state.options.silenceThresholdDb} dB`;
            ui.recomputeSlices(false);
            ui.render();
            toast(`Silence gate set to ${newSilence} dB: preserved manual edits.`, 'success');
          },
          () => {
            ui.state.options.silenceThresholdDb = newSilence;
            prevSilenceVal = newSilence;
            ui.state.manualCutFrames.clear();
            ui.state.manualSilenceRanges = [];
            const lbl = ui.state.backdropEl?.querySelector('#lbl-silence-val');
            if (lbl) lbl.textContent = `${ui.state.options.silenceThresholdDb} dB`;
            ui.recomputeSlices(true);
            ui.render();
            toast(`Silence gate set to ${newSilence} dB: reset to auto.`, 'info');
          },
          () => {
            rngSilence.value = String(prevSilenceVal);
            const lbl = ui.state.backdropEl?.querySelector('#lbl-silence-val');
            if (lbl) lbl.textContent = `${prevSilenceVal} dB`;
          }
        );
        return;
      } else if (ui.state.manualCutsPolicy === 'keep') {
        ui.state.options.silenceThresholdDb = newSilence;
        prevSilenceVal = newSilence;
        const lbl = ui.state.backdropEl?.querySelector('#lbl-silence-val');
        if (lbl) lbl.textContent = `${ui.state.options.silenceThresholdDb} dB`;
        ui.recomputeSlices(false);
        ui.drawWaveformCanvas();
        ui.drawMagnifierCanvas();
        ui.refreshTable();
        return;
      }
    }

    ui.state.options.silenceThresholdDb = newSilence;
    prevSilenceVal = newSilence;
    const lbl = ui.state.backdropEl?.querySelector('#lbl-silence-val');
    if (lbl) lbl.textContent = `${ui.state.options.silenceThresholdDb} dB`;
    ui.recomputeSlices(ui.state.manualCutsPolicy === 'discard');
    ui.render();
  });

  // Detect Silences Toggle (inserts cuts around silent intervals >= minSilenceMs and mutes them so they do not go to the zone matrix)
  ui.state.backdropEl.querySelector('#btn-toggle-silence-detect')?.addEventListener('click', () => {
    ui.state.options.detectSilences = ui.state.options.detectSilences === false;
    ui.recomputeSlices(false);
    ui.render();
    const n = ui.state.currentResult?.silenceSlicesCount ?? 0;
    toast(
      ui.state.options.detectSilences === false
        ? 'Silence detection OFF: all slices active.'
        : `Silence detection ON: ${n} silent interval(s) cut and muted (excluded from Zone Matrix).`,
      'info'
    );
  });

  // Min Silence Duration Input (flags only: boundaries never move, manuals preserved)
  const inpMinSilence = ui.state.backdropEl.querySelector('#inp-minsilence') as HTMLInputElement | null;
  inpMinSilence?.addEventListener('change', () => {
    const v = parseInt(inpMinSilence.value, 10);
    ui.state.options.minSilenceMs = Number.isFinite(v) ? Math.max(0, Math.min(2000, v)) : 120;
    ui.recomputeSlices(false);
    ui.render();
  });

  // Peak Normalize Toggle (gain only: boundaries and manual frames never move)
  ui.state.backdropEl.querySelector('#btn-toggle-normalize')?.addEventListener('click', () => {
    if (!ui.state.sourcePcm || ui.state.sourcePcm.length === 0) {
      toast('Load audio before toggling Normalize.', 'warning');
      return;
    }
    ui.state.normalizeEnabled = !ui.state.normalizeEnabled;
    if (ui.state.normalizeEnabled) {
      const { pcm, appliedGainDb, inputPeakDb } = normalizePeakPcm(ui.state.sourcePcm);
      ui.state.pcm = pcm;
      ui.recomputeSlices(false);
      ui.render();
      toast(`Normalized to -1 dBFS: ${appliedGainDb >= 0 ? '+' : ''}${appliedGainDb.toFixed(1)} dB (was ${inputPeakDb.toFixed(1)} dBFS).`, 'success');
    } else {
      ui.state.pcm = ui.state.sourcePcm;
      ui.recomputeSlices(false);
      ui.render();
      toast('Normalize OFF: back to original levels.', 'info');
    }
  });

  // Reset Manual Cuts to Full Auto
  ui.state.backdropEl.querySelector('#btn-reset-cuts-auto')?.addEventListener('click', (e) => {
    e.stopPropagation();
    ui.state.manualCutFrames.clear();
    ui.state.manualSilenceRanges = [];
    ui.state.manualCutsPolicy = 'prompt';
    ui.recomputeSlices(true);
    ui.render();
    toast('Reset all slices to automatic transient detection.', 'info');
  });

  // Min Slice Ms Input
  const inpMinSlice = ui.state.backdropEl.querySelector('#inp-minslice') as HTMLInputElement | null;
  inpMinSlice?.addEventListener('change', () => {
    ui.state.options.minSliceMs = Math.max(10, parseInt(inpMinSlice.value, 10) || 45);
    ui.recomputeSlices(ui.state.manualCutsPolicy === 'discard');
    ui.render();
  });

  // Pre-roll Input
  const inpPreroll = ui.state.backdropEl.querySelector('#inp-preroll') as HTMLInputElement | null;
  inpPreroll?.addEventListener('change', () => {
    ui.state.options.preRollMs = Math.max(0, parseInt(inpPreroll.value, 10) || 0);
    ui.recomputeSlices(ui.state.manualCutsPolicy === 'discard');
    ui.render();
  });

  // Toggles
  ui.state.backdropEl.querySelector('#btn-toggle-zc-snap')?.addEventListener('click', () => {
    ui.state.options.snapZeroCrossing = !ui.state.options.snapZeroCrossing;
    ui.recomputeSlices(ui.state.manualCutsPolicy === 'discard');
    ui.render();
  });
  ui.state.backdropEl.querySelector('#btn-toggle-overlap')?.addEventListener('click', () => {
    ui.state.options.allowOverlap = !ui.state.options.allowOverlap;
    ui.recomputeSlices(ui.state.manualCutsPolicy === 'discard');
    ui.render();
  });

}

