import { ICONS } from '../icons.ts';
import type { DetectedSlice } from '../../core/dsp/AudioSlicerEngine.ts';
import { conformLoopToTargetBpm } from '../../core/dsp/AudioSlicerEngine.ts';
import type { ChopperContext } from './types.ts';

export function auditionSlice(ui: ChopperContext, sl: DetectedSlice, toggleStopIfSame: boolean = false): void {
  if (toggleStopIfSame && ui.state.playingSliceId === sl.id) {
    stopAudition(ui, );
    return;
  }
  ui.state.playingSliceId = sl.id;
  if (ui.state.context.onAuditionPcm) {
    ui.state.context.onAuditionPcm(sl.pcm, ui.state.sampleRate);
  }
  syncPlayButtonsUi(ui, );
}

export function auditionFullWav(ui: ChopperContext): void {
  if (ui.state.pcm.length === 0) return;
  if (ui.state.playingSliceId === '__full_wav__') {
    stopAudition(ui, );
    return;
  }
  ui.state.playingSliceId = '__full_wav__';
  if (ui.state.context.onAuditionPcm) {
    ui.state.context.onAuditionPcm(ui.state.pcm, ui.state.sampleRate);
  }
  syncPlayButtonsUi(ui, );
}

export function auditionConformedLoop(ui: ChopperContext): void {
  if (ui.state.pcm.length === 0 || !ui.state.currentResult) return;
  if (ui.state.playingSliceId === '__conformed_loop__') {
    stopAudition(ui, );
    return;
  }
  const sourceBpm = ui.state.currentResult.detectedBpm || ui.state.options.bpm || 120;
  const targetBpm = ui.state.options.targetBpm ?? ui.state.currentResult.targetBpm ?? sourceBpm;
  const conformed = conformLoopToTargetBpm(
    ui.state.pcm,
    ui.state.sampleRate,
    ui.state.currentResult.slices,
    sourceBpm,
    targetBpm,
    { barCount: ui.state.currentResult.detectedBars ?? ui.state.options.barCount }
  );
  ui.state.playingSliceId = '__conformed_loop__';
  if (ui.state.context.onAuditionPcm) {
    ui.state.context.onAuditionPcm(conformed.pcm, ui.state.sampleRate);
  }
  syncPlayButtonsUi(ui, );
}

export function stopAudition(ui: ChopperContext): void {
  ui.state.playingSliceId = null;
  ui.state.context.onStopAudition?.();
  syncPlayButtonsUi(ui, );
}

export function syncPlayButtonsUi(ui: ChopperContext): void {
  if (!ui.state.backdropEl) return;
  const isFull = ui.state.playingSliceId === '__full_wav__';
  const isConformed = ui.state.playingSliceId === '__conformed_loop__';
  const isSlice = Boolean(
    ui.state.playingSliceId &&
      ui.state.playingSliceId !== '__full_wav__' &&
      ui.state.playingSliceId !== '__conformed_loop__'
  );

  const topFullBtn = ui.state.backdropEl.querySelector<HTMLButtonElement>('#btn-chopper-play-full');
  if (topFullBtn) {
    topFullBtn.classList.toggle('btn-accent', isFull);
    topFullBtn.classList.toggle('btn-outline', !isFull);
    topFullBtn.innerHTML = `${isFull ? ICONS.stop : ICONS.play} Play Full WAV`;
  }

  const conformedBtn = ui.state.backdropEl.querySelector<HTMLButtonElement>('#btn-chopper-play-conformed');
  if (conformedBtn) {
    const targetBpm =
      ui.state.options.targetBpm ??
      ui.state.currentResult?.targetBpm ??
      ui.state.currentResult?.detectedBpm ??
      120;
    conformedBtn.classList.toggle('btn-accent', isConformed);
    conformedBtn.classList.toggle('btn-outline', !isConformed);
    conformedBtn.innerHTML = `${isConformed ? ICONS.stop : ICONS.play} Play @ ${targetBpm} BPM`;
  }

  const magFullBtn = ui.state.backdropEl.querySelector<HTMLButtonElement>('#btn-mag-play-full');
  if (magFullBtn) {
    magFullBtn.classList.toggle('btn-accent', isFull);
    magFullBtn.classList.toggle('btn-outline', !isFull);
    magFullBtn.innerHTML = `${isFull ? ICONS.stop : ICONS.play} Play WAV`;
  }

  const magSliceBtn = ui.state.backdropEl.querySelector<HTMLButtonElement>('#btn-mag-play-slice');
  if (magSliceBtn) {
    magSliceBtn.classList.toggle('btn-accent', isSlice);
    magSliceBtn.classList.toggle('btn-outline', !isSlice);
    magSliceBtn.innerHTML = `${isSlice ? ICONS.stop : ICONS.play} Play Slice`;
  }
}
