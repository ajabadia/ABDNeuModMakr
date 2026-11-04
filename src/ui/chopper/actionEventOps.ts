import type { ChopperContext } from './types.ts';
import { extractBoundaryFrames, deleteSlice } from '../../core/dsp/AudioSlicerEngine.ts';
import { toast, confirmDialog } from '../notify.ts';
import { clamp } from '../../core/dsp/DspMath.ts';
import { downloadBlob } from '../download.ts';
import { reduceNoiseWithProfile } from '../../../vendor/@abdsynths/shared/Code/DspCore/TakeDsp/index.ts';
import { bridgeClient } from '../../core/bridge/BridgeClient.ts';
import { resolveAiActionDeclaration } from '../../core/ai/aiHonesty.ts';
import { encodePcm16Wav, decodeWav } from '../../core/dsp/WavDecoder.ts';

export function bindChopperActionEvents(ui: ChopperContext): void {
  if (!ui.state.backdropEl) return;
  // Cut-Point Magnifier Toolbar Buttons
  ui.state.backdropEl.querySelector('#btn-mag-prev-cut')?.addEventListener('click', () => ui.navigateBoundary(-1));
  ui.state.backdropEl.querySelector('#btn-mag-next-cut')?.addEventListener('click', () => ui.navigateBoundary(1));

  ui.state.backdropEl.querySelector('#btn-nudge-m100')?.addEventListener('click', () => ui.nudgeActiveBoundary(-100));
  ui.state.backdropEl.querySelector('#btn-nudge-m10')?.addEventListener('click', () => ui.nudgeActiveBoundary(-10));
  ui.state.backdropEl.querySelector('#btn-nudge-m1')?.addEventListener('click', () => ui.nudgeActiveBoundary(-1));
  ui.state.backdropEl.querySelector('#btn-nudge-snap0x')?.addEventListener('click', () => ui.snapActiveBoundary0X());
  ui.state.backdropEl.querySelector('#btn-nudge-p1')?.addEventListener('click', () => ui.nudgeActiveBoundary(1));
  ui.state.backdropEl.querySelector('#btn-nudge-p10')?.addEventListener('click', () => ui.nudgeActiveBoundary(10));
  ui.state.backdropEl.querySelector('#btn-nudge-p100')?.addEventListener('click', () => ui.nudgeActiveBoundary(100));

  ui.state.backdropEl.querySelector('#btn-chopper-play-full')?.addEventListener('click', () => {
    ui.auditionFullWav();
  });

  ui.state.backdropEl.querySelector('#btn-mag-play-full')?.addEventListener('click', () => {
    ui.auditionFullWav();
  });

  ui.state.backdropEl.querySelector('#btn-mag-play-slice')?.addEventListener('click', () => {
    const sl = ui.state.currentResult?.slices.find((s) => s.id === ui.state.selectedSliceId) || ui.state.currentResult?.slices[0];
    if (sl) ui.auditionSlice(sl, true);
  });

  ui.state.backdropEl.querySelector('#btn-mag-toggle-silence')?.addEventListener('click', () => {
    if (ui.state.selectedSliceId && ui.state.currentResult) {
      ui.handleToggleSliceSilence(ui.state.selectedSliceId);
    }
  });

  ui.state.backdropEl.querySelector('#btn-mag-del-boundary')?.addEventListener('click', () => {
    if (ui.state.currentResult) {
      const boundaries = extractBoundaryFrames(ui.state.currentResult, ui.state.pcm.length);
      if (boundaries.length <= 2) return;
      const bIdx = clamp(ui.state.activeBoundaryIndex, 1, boundaries.length - 2);
      const bFrame = boundaries[bIdx];
      ui.removeManualBoundary(bFrame);

      // Find slice starting at this boundary and delete it
      const slice = ui.state.currentResult.slices[bIdx];
      if (slice) {
        ui.state.currentResult = deleteSlice(ui.state.currentResult, ui.state.pcm, ui.state.sampleRate, slice.id, ui.state.options);
        ui.state.activeBoundaryIndex = Math.max(1, bIdx - 1);
        ui.render();
        toast(`Removed cut boundary #${bIdx}.`, 'info');
      }
    }
  });

  // Waveform & Magnifier Canvas Interactions
  ui.bindCanvasInteraction();
  ui.bindMagnifierInteraction();

  // Table rows play/silence/delete events
  ui.bindTableEvents();

  // Drag MIDI to DAW Setup
  const dragBtn = ui.state.backdropEl.querySelector('#btn-drag-midi') as HTMLElement | null;
  if (dragBtn && ui.state.currentResult) {
    dragBtn.addEventListener('dragstart', (e: DragEvent) => {
      if (!ui.state.currentResult) return;
      const midiBytes = ui.state.currentResult.midiFileBuffer;
      const blob = new Blob([midiBytes.buffer as ArrayBuffer], { type: 'audio/midi' });
      const url = URL.createObjectURL(blob);
      const filename = `${(ui.state.sourceFilename || 'sliced_audio').replace(/\.[^/.]+$/, '')}_slices.mid`;

      if (e.dataTransfer) {
        e.dataTransfer.setData('DownloadURL', `audio/midi:${filename}:${url}`);
        e.dataTransfer.setData('text/plain', filename);
      }
    });

    dragBtn.addEventListener('click', () => {
      if (!ui.state.currentResult) return;
      const midiBytes = ui.state.currentResult.midiFileBuffer;
      const blob = new Blob([midiBytes.buffer as ArrayBuffer], { type: 'audio/midi' });
      downloadBlob(blob, `${(ui.state.sourceFilename || 'sliced_audio').replace(/\.[^/.]+$/, '')}_slices.mid`);
      toast('Downloaded Standard MIDI pattern for sliced audio.', 'success');
    });
  }

  // Inject Conformed Loop at Target BPM Action
  ui.state.backdropEl.querySelector('#btn-chopper-inject-loop')?.addEventListener('click', () => {
    ui.handleInjectConformedLoopIntoSession();
  });

  // Inject Zones Action
  ui.state.backdropEl.querySelector('#btn-chopper-inject')?.addEventListener('click', () => {
    ui.handleInjectSlicesIntoSession();
  });

  // Fase 30 & 35.6: DSP Denoise button (recomputes auto slices or asks if manual cuts exist)
  ui.state.backdropEl.querySelector('#btn-chopper-dsp-denoise')?.addEventListener('click', async () => {
    if (ui.state.pcm.length === 0) return;
    try {
      const profile = ui.state.capturedNoiseProfile || {
        levelDbfs: -48,
        spectrumBands: new Array(16).fill(1 / 16),
        hum50HzDb: -80,
        hum60HzDb: -80,
      };
      const cleaned = reduceNoiseWithProfile(ui.state.pcm, ui.state.sampleRate, profile, {
        reductionDb: 15,
        removeHum: true,
      });
      ui.state.pcm = cleaned;
      await ui.reconcileSlicesAfterAudioClean('Cleaned audio using DSP Spectral Gate');
    } catch (err) {
      toast(`DSP Denoise failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  });

  // Fase 30, 35.4 & 35.6: AI Enhance button passing captured noise profile to bridge (with explicit fallback consent & manual-cuts check)
  ui.state.backdropEl.querySelector('#btn-chopper-ai-enhance')?.addEventListener('click', async () => {
    if (ui.state.pcm.length === 0) return;
    if (!bridgeClient.isConnected()) {
      await bridgeClient.checkHealth();
    }
    const decl = resolveAiActionDeclaration('chopper-bwe-enhance', {
      isBridgeConnected: bridgeClient.isConnected(),
    });
    if (decl.requiresFallbackConsent) {
      const ok = await confirmDialog(decl.consentMessage, {
        title: decl.consentTitle,
        confirmLabel: decl.consentConfirmLabel,
        cancelLabel: 'Cancelar',
      });
      if (!ok) return;
      const profile = ui.state.capturedNoiseProfile || {
        levelDbfs: -48,
        spectrumBands: new Array(16).fill(1 / 16),
        hum50HzDb: -80,
        hum60HzDb: -80,
      };
      ui.state.pcm = reduceNoiseWithProfile(ui.state.pcm, ui.state.sampleRate, profile, {
        reductionDb: 15,
        removeHum: true,
      });
      await ui.reconcileSlicesAfterAudioClean(
        `Aplicada ${decl.fallbackEngine} (confirmado por el usuario)`
      );
      return;
    }

    try {
      const wavBytes = encodePcm16Wav(ui.state.pcm, ui.state.sampleRate);
      toast('Sending audio to AI Bridge with noise profile removal...', 'info');
      const enhancedBytes = await bridgeClient.enhanceAudio(wavBytes, {
        targetSampleRate: 96000,
        capabilities: ['resample-96k', 'harmonic-bwe', 'spectral-denoise'],
        noiseProfile: ui.state.capturedNoiseProfile || undefined,
      });
      const decoded = decodeWav(
        enhancedBytes.buffer.slice(
          enhancedBytes.byteOffset,
          enhancedBytes.byteOffset + enhancedBytes.byteLength
        ) as ArrayBuffer
      );
      const oldRate = ui.state.sampleRate;
      ui.state.pcm = decoded.mono || decoded.channels[0];
      ui.state.sampleRate = decoded.sampleRate;
      if (oldRate > 0 && ui.state.sampleRate !== oldRate && ui.hasManualCuts()) {
        const ratio = ui.state.sampleRate / oldRate;
        const rescaled = new Set<number>();
        for (const mf of ui.state.manualCutFrames) {
          rescaled.add(Math.round(mf * ratio));
        }
        ui.state.manualCutFrames = rescaled;
        ui.state.manualSilenceRanges = ui.state.manualSilenceRanges.map((r) => ({
          start: Math.round(r.start * ratio),
          end: Math.round(r.end * ratio),
        }));
      }
      await ui.reconcileSlicesAfterAudioClean(
        'Audio enhanced via Bridge AI with noise profile removed!'
      );
    } catch (err) {
      toast(`AI Enhance failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  });
}
