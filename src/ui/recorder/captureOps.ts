import type { RecorderContext } from './types.ts';
import type { MidiAutoSampleManifest } from '@abdsynths/shared/contracts/recordingSession';
import { AudioCaptureService } from '../../core/AudioCaptureService.ts';
import { escHtml } from '../escape.ts';
import { toast } from '../notify.ts';

export async function refreshDevices(ctx: RecorderContext): Promise<void> {
    try {
      ctx.state.devices = await AudioCaptureService.listDevices();
    } catch {
      ctx.state.devices = [];
    }
    const sel = ctx.state.backdropEl?.querySelector<HTMLSelectElement>('#rec-device');
    if (!sel) return;
    sel.innerHTML =
      ctx.state.devices.length === 0
        ? `<option value="">Default input</option>`
        : ctx.state.devices
            .map(
              (d, i) =>
                `<option value="${escHtml(d.deviceId)}">${escHtml(d.label || `Input ${i + 1}`)}</option>`
            )
            .join('');
    if (ctx.state.selectedDeviceId) sel.value = ctx.state.selectedDeviceId;
  }


export async function refreshMidiPorts(ctx: RecorderContext): Promise<void> {
    const status = await ctx.state.midi.requestAccess();
    ctx.state.midiOutputs = status.outputs;
    ctx.state.midiInputs = status.inputs;
    const outSel = ctx.state.backdropEl?.querySelector<HTMLSelectElement>('#as-midi-out');
    const inSel = ctx.state.backdropEl?.querySelector<HTMLSelectElement>('#as-midi-in');
    if (outSel) {
      outSel.innerHTML =
        ctx.state.midiOutputs.length === 0
          ? `<option value="">No WebMIDI Out port detected</option>`
          : ctx.state.midiOutputs
              .map((p) => `<option value="${escHtml(p.id)}">${escHtml(p.name)}</option>`)
              .join('');
      const selOut = ctx.state.midi.getSelectedOutputId();
      if (selOut) outSel.value = selOut;
    }
    if (inSel) {
      inSel.innerHTML =
        ctx.state.midiInputs.length === 0
          ? `<option value="">No WebMIDI In port detected</option>`
          : ctx.state.midiInputs
              .map((p) => `<option value="${escHtml(p.id)}">${escHtml(p.name)}</option>`)
              .join('');
      const selIn = ctx.state.midi.getSelectedInputId();
      if (selIn) inSel.value = selIn;
    }
  }


export async function enableMic(ctx: RecorderContext): Promise<void> {
    if (ctx.state.opening) return;
    if (ctx.state.capture.isOpen()) {
      await ctx.state.capture.close().catch(() => undefined);
    }
    ctx.state.opening = true;
    ctx.setBusy(true);
    try {
      const sel = ctx.state.backdropEl?.querySelector<HTMLSelectElement>('#rec-device');
      ctx.state.selectedDeviceId = sel?.value ?? '';
      await ctx.state.capture.open({
        ...(ctx.state.selectedDeviceId ? { deviceId: ctx.state.selectedDeviceId } : {}),
        trimSilence: false,
        attachNoiseProfile: true,
        autoClassify: true,
      });
      ctx.renderTransport();
    } catch (err) {
      toast(`Microphone unavailable: ${err instanceof Error ? err.message : String(err)}`, 'warning');
    } finally {
      ctx.state.opening = false;
      ctx.setBusy(false);
    }
  }

  // ── Transporte (Audio Libre + AutoSampler MIDI) ───────────


export async function toggleRecord(ctx: RecorderContext): Promise<void> {
    if (ctx.state.operatingMode === 'midi_autosampler') {
      if (ctx.state.autoSamplerConfig.mode === 'live_midi_capture') {
        await ctx.toggleLiveMidiCapture();
      } else {
        if (ctx.state.isSweepRunning) {
          ctx.state.sweepAbortRequested = true;
          ctx.state.midi.sendAllNotesOff();
        } else {
          await ctx.runAutoSamplerSweep();
        }
      }
      return;
    }

    let engine;
    try {
      engine = await ctx.state.capture.open({
        ...(ctx.state.selectedDeviceId ? { deviceId: ctx.state.selectedDeviceId } : {}),
        trimSilence: false,
        attachNoiseProfile: true,
        autoClassify: true,
      });
    } catch {
      await enableMic(ctx, );
      return;
    }
    const state = engine.getState();
    if (state === 'monitoring') {
      ctx.state.context.onStopAudition?.();
      ctx.state.liveMarkers = [];
      engine.startRecording();
    } else if (state === 'recording') {
      engine.pauseRecording();
    } else if (state === 'paused') {
      engine.resumeRecording();
    }
    ctx.renderTransport();
  }


export function stopAndKeep(ctx: RecorderContext): void {
    if (ctx.state.isSweepRunning) {
      ctx.state.sweepAbortRequested = true;
      ctx.state.midi.sendAllNotesOff();
      return;
    }
    if (!ctx.state.capture.isOpen()) return;
    void ctx.state.capture.open().then((engine) => {
      if (engine.getState() === 'recording' || engine.getState() === 'paused') {
        const rawTake = engine.stopRecording();
        let manifest: MidiAutoSampleManifest | undefined;
        if (
          ctx.state.operatingMode === 'midi_autosampler' &&
          ctx.state.autoSamplerConfig.mode === 'live_midi_capture' &&
          ctx.state.liveTracker
        ) {
          const totalFrames = rawTake.samples[0]?.length ?? 0;
          manifest = ctx.state.liveTracker.finalizeManifest(
            totalFrames,
            'Live MIDI Keyboard Capture',
            ctx.state.autoSamplerConfig.extendToFullKeybed
          );
          ctx.state.liveTracker = null;
          ctx.state.liveMidiUnsub?.();
          ctx.state.liveMidiUnsub = null;
        }
        ctx.finishTake(rawTake, undefined, manifest);
      }
      ctx.renderTransport();
    });
  }


export function cancelAndDiscard(ctx: RecorderContext): void {
    ctx.state.sweepAbortRequested = true;
    ctx.state.midi.sendAllNotesOff();
    ctx.state.liveMidiUnsub?.();
    ctx.state.liveMidiUnsub = null;
    ctx.state.liveTracker = null;
    if (!ctx.state.capture.isOpen()) return;
    void ctx.state.capture.open().then((engine) => {
      if (engine.getState() === 'recording' || engine.getState() === 'paused') {
        engine.cancelTake();
        toast('Take discarded.', 'info');
      }
      ctx.renderTransport();
    });
  }

  // ── Fase 37: Calibración / Nota Piloto y Barrido MIDI ─────

