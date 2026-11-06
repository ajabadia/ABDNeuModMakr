// ─────────────────────────────────────────────────────────
// AudioChopperModal — chopperFileOps (Fase 42.5)
// Funciones extraidas verbatim de `src/ui/AudioChopperModal.ts`.
// `ctx` es el contexto estructural (`ChopperContext`).
// ─────────────────────────────────────────────────────────

import { extractManifestFromWavBytes } from '../../core/autoSampler/MidiAutoSampleSession.ts';
import { bridgeClient } from '../../core/bridge/BridgeClient.ts';
import { buildSlicesFromBoundaries, buildSlicesFromMidiManifest, extractBoundaryFrames, normalizePeakPcm } from '../../core/dsp/AudioSlicerEngine.ts';
import { decompressRx2AudioCapped, isRx2Buffer } from '../../core/dsp/DwopDecompressor.ts';
import { parseSliceFile } from '../../core/dsp/SliceFileParser.ts';
import { decodeWav, decodeAiff, transcodeAnyAudioToWavBuffer } from '../../core/dsp/WavDecoder.ts';
import { bindChopperKeyboard } from '../chopper/a11yKeyboard.ts';
import type { ChopperContext } from '../chopper/types.ts';
import { escHtml } from '../escape.ts';
import { ICONS } from '../icons.ts';
import { createModalFocusTrap } from '../modalFocusTrap.ts';
import { toast } from '../notify.ts';
import { suspendFocusTrap, closeConfirmModal } from './chopperSessionOps.ts';

export function open(ctx: ChopperContext, pcm: Float32Array, sampleRate: number, sourceFilename: string = '', sliceFrames?: number[]): void {
    // Recarga permitida: si el modal ya está abierto, se sustituye el audio
    // y se repinta (antes se ignoraba en silencio y solo salía el toast).
    if (ctx.state.backdropEl) {
      ctx.state.context.onStopAudition?.();
    }
    setWorkingAudio(ctx, pcm);
    ctx.state.sampleRate = Math.max(1, sampleRate);
    ctx.state.sourceFilename = sourceFilename;
    ctx.state.zoomFactor = 1.0;
    ctx.state.viewCenterNorm = 0.5;
    ctx.state.selectedSliceId = null;
    ctx.state.activeBoundaryIndex = 1;
    ctx.state.manualSilenceRanges = [];
    ctx.state.manualCutsPolicy = 'prompt';

    if (sliceFrames && sliceFrames.length > 1) {
      ctx.state.manualCutFrames = new Set(sliceFrames.filter((f) => f > 0 && f < ctx.state.pcm.length));
      ctx.state.currentResult = buildSlicesFromBoundaries(
        ctx.state.pcm,
        ctx.state.sampleRate,
        sliceFrames,
        ctx.state.options
      );
      ctx.state.selectedSliceId = ctx.state.currentResult.slices[0]?.id ?? null;
    } else {
      ctx.state.manualCutFrames.clear();
      if (ctx.state.pcm.length > 0) {
        ctx.recomputeSlices(false);
      } else {
        ctx.state.currentResult = null;
      }
    }

    ctx.render();

    bindChopperKeyboard(ctx);

    if (!ctx.state.focusTrap && ctx.state.backdropEl) {
      ctx.state.focusTrap = createModalFocusTrap(ctx.state.backdropEl, {
        initialFocusSelector: '#btn-chopper-close',
        onEscape: () => {
          if (ctx.state.activeContextMenuEl) {
            ctx.closeContextMenu();
          } else if (ctx.state.backdropEl) {
            ctx.close();
          }
        },
      });
      ctx.state.focusTrap.activate();
    }
  }

export function openWithAudioBuffer(ctx: ChopperContext, arrayBuf: ArrayBuffer, filename: string, sliceFrames?: number[]): void {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.rx2') || lower.endsWith('.rex') || lower.endsWith('.rcy')) {
      void _handleRx2Buffer(ctx, arrayBuf, filename, sliceFrames);
      return;
    }
    const isAif = lower.endsWith('.aif') || lower.endsWith('.aiff');
    const decoded = isAif ? decodeAiff(arrayBuf) : decodeWav(arrayBuf);
    let mono: Float32Array;
    if (decoded.channels.length === 1) {
      mono = decoded.channels[0];
    } else {
      mono = new Float32Array(decoded.channels[0].length);
      for (let i = 0; i < mono.length; i++) {
        mono[i] = (decoded.channels[0][i] + decoded.channels[1][i]) * 0.5;
      }
    }

    // Fase 37.6: Check if WAV contains an embedded MidiAutoSampleManifest (`atem` chunk)
    if (!isAif && (!sliceFrames || sliceFrames.length === 0)) {
      const autoManifest = extractManifestFromWavBytes(arrayBuf);
      if (autoManifest && autoManifest.events.length > 0) {
        open(ctx, mono, decoded.sampleRate, filename);
        ctx.state.currentResult = buildSlicesFromMidiManifest(mono, decoded.sampleRate, autoManifest);
        const boundaries = extractBoundaryFrames(ctx.state.currentResult, mono.length);
        ctx.state.manualCutFrames = new Set(boundaries.filter((f) => f > 0 && f < mono.length));
        ctx.state.selectedSliceId = ctx.state.currentResult.slices[0]?.id ?? null;
        ctx.render();
        toast(
          `Cargadas ${ctx.state.currentResult.slices.length} notas/velocidades desde el manifiesto MIDI de AutoSampler (${filename})`,
          'success'
        );
        return;
      }
    }

    open(ctx, mono, decoded.sampleRate, filename, sliceFrames);
  }

export async function loadAudioFile(ctx: ChopperContext, file: File): Promise<void> {
    try {
      const arrayBuf = await file.arrayBuffer();

      // Check if it's a ReCycle file (.rx2, .rex, .rcy)
      if (/\.(rx2|rex|rcy)$/i.test(file.name)) {
        await _handleRx2Buffer(ctx, arrayBuf, file.name);
        return;
      }

      // Check if it's a slice marker or CUE/SFZ file (.sfz, .cue, .txt)
      const isSliceFileExt = /\.(sfz|cue|txt)$/i.test(file.name);
      if (isSliceFileExt) {
        const parsed = parseSliceFile(arrayBuf, file.name, ctx.state.sampleRate);
        if (parsed && parsed.sliceFrames.length > 0) {
          if (parsed.pcm && parsed.pcm.length > 0) {
            ctx.state.pcm = parsed.pcm;
            ctx.state.sampleRate = parsed.sampleRate || 44100;
          } else if (ctx.state.pcm.length === 0) {
            // Generate synthetic acoustic preview buffer corresponding to slice boundaries
            const maxFrame = Math.max(...parsed.sliceFrames);
            const totalLen = Math.max(maxFrame + 22050, Math.round((parsed.sampleRate || 44100) * 2));
            const synthPcm = new Float32Array(totalLen);
            for (const f of parsed.sliceFrames) {
              if (f < synthPcm.length) {
                synthPcm[f] = 0.8;
                if (f + 1 < synthPcm.length) synthPcm[f + 1] = -0.5;
                if (f + 2 < synthPcm.length) synthPcm[f + 2] = 0.2;
              }
            }
            ctx.state.pcm = synthPcm;
            ctx.state.sampleRate = parsed.sampleRate || 44100;
          }
          if (ctx.state.pcm.length > 0) {
            ctx.state.sourceFilename = file.name;
            ctx.state.manualCutFrames = new Set(parsed.sliceFrames.filter((f) => f > 0 && f < ctx.state.pcm.length));
            ctx.state.manualSilenceRanges = [];
            ctx.state.manualCutsPolicy = 'prompt';
            ctx.state.currentResult = buildSlicesFromBoundaries(
              ctx.state.pcm,
              ctx.state.sampleRate,
              parsed.sliceFrames,
              ctx.state.options
            );
            ctx.state.selectedSliceId = ctx.state.currentResult.slices[0]?.id ?? null;
            ctx.state.activeBoundaryIndex = 1;
            ctx.render();
            toast(
              `Imported ${parsed.sliceFrames.length} slices from ${parsed.formatLabel} (${file.name})`,
              'success'
            );
            return;
          }
        }
      }

      // Universal Audio Decode (WAV, AIFF/AIFC, FLAC, CAF, MP3, OGG, M4A/AAC, Opus)
      const wavBuf = await transcodeAnyAudioToWavBuffer(arrayBuf, file.name);
      const decWav = decodeWav(wavBuf);
      ctx.state.pcm = decWav.mono;
      ctx.state.sampleRate = decWav.sampleRate;
      ctx.state.sourceFilename = file.name;
      ctx.state.zoomFactor = 1.0;
      ctx.state.viewCenterNorm = 0.5;
      ctx.state.selectedSliceId = null;
      ctx.state.activeBoundaryIndex = 1;

      ctx.state.context.onRegisterSampleBuffer?.(file.name, wavBuf);

      // Check if standard WAV / AIFF contains embedded slice cues
      const embedded = parseSliceFile(arrayBuf, file.name, ctx.state.sampleRate);
      if (embedded && embedded.sliceFrames.length > 1) {
        ctx.state.manualCutFrames = new Set(embedded.sliceFrames.filter((f) => f > 0 && f < ctx.state.pcm.length));
        ctx.state.manualSilenceRanges = [];
        ctx.state.manualCutsPolicy = 'prompt';
        ctx.state.currentResult = buildSlicesFromBoundaries(
          ctx.state.pcm,
          ctx.state.sampleRate,
          embedded.sliceFrames,
          ctx.state.options
        );
        ctx.state.selectedSliceId = ctx.state.currentResult.slices[0]?.id ?? null;
        toast(
          `Loaded "${file.name}" with ${embedded.sliceFrames.length} embedded ${embedded.formatLabel} slices!`,
          'success'
        );
      } else {
        ctx.state.manualCutFrames.clear();
        ctx.state.manualSilenceRanges = [];
        ctx.state.manualCutsPolicy = 'prompt';
        ctx.recomputeSlices(false);
        toast(
          `Loaded "${file.name}" into Audio Chopper (${(ctx.state.pcm.length / ctx.state.sampleRate).toFixed(2)}s, ${ctx.state.sampleRate} Hz)`,
          'success'
        );
      }

      ctx.render();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`Failed to decode audio file: ${msg}`, 'error');
    }
  }

export async function importSliceMarkersFile(ctx: ChopperContext, file: File): Promise<void> {
    if (ctx.state.pcm.length === 0) {
      toast('Please load an audio file first before importing a slice marker track.', 'warning');
      return;
    }
    try {
      const arrayBuf = await file.arrayBuffer();
      const parsed = parseSliceFile(arrayBuf, file.name, ctx.state.sampleRate);
      if (!parsed || parsed.sliceFrames.length === 0) {
        toast(`Could not find valid slice markers in "${file.name}".`, 'error');
        return;
      }

      ctx.state.manualCutFrames = new Set(parsed.sliceFrames.filter((f) => f > 0 && f < ctx.state.pcm.length));
      ctx.state.manualSilenceRanges = [];
      ctx.state.manualCutsPolicy = 'prompt';
      ctx.state.currentResult = buildSlicesFromBoundaries(
        ctx.state.pcm,
        ctx.state.sampleRate,
        parsed.sliceFrames,
        ctx.state.options
      );
      ctx.state.selectedSliceId = ctx.state.currentResult.slices[0]?.id ?? null;
      ctx.state.activeBoundaryIndex = 1;
      ctx.render();
      toast(
        `Applied ${parsed.sliceFrames.length} slices from ${parsed.formatLabel} (${file.name})!`,
        'success'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`Failed to parse slice file: ${msg}`, 'error');
    }
  }

export function loadTestDemoBeat(ctx: ChopperContext): void {
    const sr = 44100;
    const pcm = new Float32Array(sr * 2);
    for (let i = 0; i < pcm.length; i++) {
      const t = i / sr;
      if (t < 0.3) pcm[i] += Math.sin(2 * Math.PI * (120 - t * 250) * t) * Math.exp(-t * 15);
      if (t >= 0.5 && t < 0.8) {
        const st = t - 0.5;
        pcm[i] += (Math.random() * 2 - 1) * Math.exp(-st * 20) * 0.6;
      }
      const hatT = t % 0.5;
      if (hatT < 0.05) {
        pcm[i] += (Math.random() * 2 - 1) * Math.exp(-hatT * 60) * 0.25;
      }
    }
    setWorkingAudio(ctx, pcm);
    ctx.state.sampleRate = sr;
    ctx.state.sourceFilename = 'DemoBreak.wav';
    ctx.state.zoomFactor = 1.0;
    ctx.state.viewCenterNorm = 0.5;
    ctx.state.selectedSliceId = null;
    ctx.state.activeBoundaryIndex = 1;
    ctx.state.manualCutFrames.clear();
    ctx.state.manualSilenceRanges = [];
    ctx.state.manualCutsPolicy = 'prompt';
    ctx.recomputeSlices(false);
    ctx.render();
    toast('Loaded 2-second synthesized test beat for slicer auditioning.', 'info');
  }

export function setWorkingAudio(ctx: ChopperContext, pcm: Float32Array): void {
    ctx.state.sourcePcm = pcm;
    ctx.state.pcm = applyNormalize(ctx, pcm);
  }

export function applyNormalize(ctx: ChopperContext, pcm: Float32Array): Float32Array {
    if (!ctx.state.normalizeEnabled || pcm.length === 0) return pcm;
    return normalizePeakPcm(pcm).pcm;
  }

export async function _handleRx2Buffer(ctx: ChopperContext, arrayBuf: ArrayBuffer, filename: string, providedSliceFrames?: number[]): Promise<void> {
    const parsed = parseSliceFile(arrayBuf, filename, ctx.state.sampleRate);
    const sliceFrames =
      providedSliceFrames && providedSliceFrames.length > 0
        ? providedSliceFrames
        : (parsed?.sliceFrames ?? []);

    // 1. Direct in-browser client-side TypeScript decompression (100% offline, Vercel-ready)
    if (isRx2Buffer(arrayBuf)) {
      try {
        const decompressed = decompressRx2AudioCapped(arrayBuf, filename);
        const wavName = filename.replace(/\.(rx2|rex|rcy)$/i, '.wav');
        ctx.state.context.onRegisterSampleBuffer?.(wavName, decompressed.wavBuffer);

        let mono: Float32Array;
        if (decompressed.channels.length === 1) {
          mono = decompressed.channels[0];
        } else {
          mono = new Float32Array(decompressed.channels[0].length);
          for (let i = 0; i < mono.length; i++) {
            mono[i] = (decompressed.channels[0][i] + decompressed.channels[1][i]) * 0.5;
          }
        }

        const effectiveSlices = sliceFrames.length > 0 ? sliceFrames : decompressed.sliceFrames;
        open(ctx, mono, decompressed.sampleRate, wavName, effectiveSlices);
        toast(
          `Decompressed ${effectiveSlices.length} slices from ${filename} (${decompressed.channels.length === 2 ? 'Stereo' : 'Mono'}, ${decompressed.sampleRate} Hz) in browser`,
          'success'
        );
        return;
      } catch (tsErr) {
        console.warn('In-browser DWOP decompression failed, attempting Bridge fallback:', tsErr);
      }
    }

    // 2. Fallback to Companion Bridge if local daemon is running
    if (bridgeClient.isConnected()) {
      try {
        toast('Decompressing REX2 audio via Companion Bridge...', 'info');
        const { wavBuffer, info } = await bridgeClient.decodeRx2Audio(arrayBuf, filename);
        const wavName = filename.replace(/\.(rx2|rex|rcy)$/i, '.wav');
        ctx.state.context.onRegisterSampleBuffer?.(wavName, wavBuffer);

        const decoded = decodeWav(wavBuffer);
        let mono: Float32Array;
        if (decoded.channels.length === 1) {
          mono = decoded.channels[0];
        } else {
          mono = new Float32Array(decoded.channels[0].length);
          for (let i = 0; i < mono.length; i++) {
            mono[i] = (decoded.channels[0][i] + decoded.channels[1][i]) * 0.5;
          }
        }

        open(ctx, mono, decoded.sampleRate, wavName, sliceFrames);
        toast(
          `Decompressed ${sliceFrames.length} slices from ${filename} (${info.channels === 2 ? 'Stereo' : 'Mono'}, ${info.sample_rate} Hz) via Bridge`,
          'success'
        );
        return;
      } catch (err) {
        console.warn('Companion Bridge REX2 decode failed, falling back to pairing dialog:', err);
      }
    }

    // 3. Fallback to pairing assistant dialog
    showRx2PairingAssistantModal(ctx, filename, sliceFrames, arrayBuf, parsed?.sampleRate);
  }

export function showRx2PairingAssistantModal(ctx: ChopperContext, rx2Filename: string, sliceFrames: number[], rx2Buffer?: ArrayBuffer, detectedSampleRate: number = 44100): void {
    closeConfirmModal(ctx);

    const modal = document.createElement('div');
    modal.className = 'nmm-modal-backdrop nmm-confirm-backdrop';
    modal.id = 'rx2-pairing-modal';
    modal.innerHTML = `
      <div class="nmm-modal-window nmm-confirm-window">
        <header class="nmm-modal-header">
          <div class="nmm-modal-header-title">
            <span class="nmm-modal-header-icon">${ICONS.wave}</span>
            <h2>REX2 Audio Pairing Assistant</h2>
          </div>
          <button type="button" class="nmm-modal-close" id="btn-rx2-pairing-close" aria-label="Close">${ICONS.close}</button>
        </header>

        <div class="nmm-modal-body nmm-audio-modal-body">
          <div class="nmm-audio-controls-card">
            <strong>Proprietary DWOP Audio Compression Detected</strong>
            <p class="nmm-audio-table-hint">
              File <code>${escHtml(rx2Filename)}</code> contains <strong>${sliceFrames.length} slice markers</strong>, but its audio uses Reason Studios' DWOP compression format which cannot be decompressed in standard browsers without the Companion Bridge.
            </p>
          </div>

          <div class="nmm-audio-controls-card">
            <strong>Option 1: Pair with Equivalent WAV / AIFF (Recommended)</strong>
            <p class="nmm-audio-table-hint">
              Select the uncompressed audio file exported alongside this loop. All ${sliceFrames.length} slice boundaries will be mapped precisely onto it.
            </p>
            <input type="file" id="inp-rx2-companion-wav" accept=".wav,.aif,.aiff,.flac" class="is-hidden-file" />
            <button type="button" class="btn btn-primary" id="btn-rx2-browse-wav">
              ${ICONS.folder} Select Companion Audio File...
            </button>
          </div>

          <div class="nmm-audio-controls-card">
            <strong>Option 2: Native Companion Bridge Decompression</strong>
            <p class="nmm-audio-table-hint">
              Start the local Python Companion Bridge (<code>python bridge/server.py</code> on port 7860). When active, REX2 files decompress automatically in the background.
            </p>
            <button type="button" class="btn btn-outline" id="btn-rx2-retry-bridge">
              ${ICONS.refresh} Check Bridge Connection &amp; Retry
            </button>
          </div>

          <div class="nmm-audio-controls-card">
            <strong>Option 3: Inspect Slices with Synthetic Impulse Preview</strong>
            <p class="nmm-audio-table-hint">
              Generate synthetic transient impulses at slice boundaries to inspect, edit, or export slice points without audio.
            </p>
            <button type="button" class="btn btn-outline" id="btn-rx2-use-synthetic">
              Open Slices in Synthetic Mode
            </button>
          </div>
        </div>

        <footer class="nmm-modal-footer">
          <div class="footer-left">
            <button type="button" class="btn btn-ghost" id="btn-rx2-pairing-cancel">Cancel</button>
          </div>
          <div class="footer-right"></div>
        </footer>
      </div>
    `;

    document.body.appendChild(modal);
    ctx.state.activeConfirmModalEl = modal;

    // Diálogo anidado fuera del backdrop: trampa propia + padre en pausa.
    // Todos los cierres pasan por closeConfirmModal(), que reanuda al padre.
    suspendFocusTrap(ctx);
    ctx.state.nestedTrap = createModalFocusTrap(modal, {
      initialFocusSelector: '#btn-rx2-browse-wav',
      onEscape: () => closeConfirmModal(ctx),
    });
    ctx.state.nestedTrap.activate();

    modal.querySelector('#btn-rx2-pairing-close')?.addEventListener('click', () => {
      closeConfirmModal(ctx);
    });
    modal.querySelector('#btn-rx2-pairing-cancel')?.addEventListener('click', () => {
      closeConfirmModal(ctx);
    });

    const fileInp = modal.querySelector('#inp-rx2-companion-wav') as HTMLInputElement | null;
    modal.querySelector('#btn-rx2-browse-wav')?.addEventListener('click', () => {
      fileInp?.click();
    });

    fileInp?.addEventListener('change', async () => {
      const companionFile = fileInp.files?.[0];
      if (!companionFile) return;
      try {
        const cBuf = await companionFile.arrayBuffer();
        closeConfirmModal(ctx);
        openWithAudioBuffer(ctx, cBuf, companionFile.name, sliceFrames);
        toast(`Paired "${rx2Filename}" slices with audio "${companionFile.name}"!`, 'success');
      } catch (err) {
        toast(`Failed to load companion audio: ${err instanceof Error ? err.message : String(err)}`, 'error');
      }
    });

    modal.querySelector('#btn-rx2-retry-bridge')?.addEventListener('click', async () => {
      if (rx2Buffer) {
        await bridgeClient.checkHealth();
        if (bridgeClient.isConnected()) {
          closeConfirmModal(ctx);
          await _handleRx2Buffer(ctx, rx2Buffer, rx2Filename, sliceFrames);
        } else {
          toast('Companion Bridge is still offline at http://127.0.0.1:7860.', 'warning');
        }
      } else {
        toast('No REX2 buffer stored to retry. Please reload the file.', 'warning');
      }
    });

    modal.querySelector('#btn-rx2-use-synthetic')?.addEventListener('click', () => {
      closeConfirmModal(ctx);
      const sr = detectedSampleRate || 44100;
      const maxFrame = sliceFrames.length > 0 ? Math.max(...sliceFrames) : sr;
      const totalLen = Math.max(maxFrame + 22050, Math.round(sr * 2));
      const synthPcm = new Float32Array(totalLen);
      for (const f of sliceFrames) {
        if (f < synthPcm.length) {
          synthPcm[f] = 0.8;
          if (f + 1 < synthPcm.length) synthPcm[f + 1] = -0.5;
          if (f + 2 < synthPcm.length) synthPcm[f + 2] = 0.2;
        }
      }
      open(ctx, synthPcm, sr, rx2Filename, sliceFrames);
      toast(`Loaded ${sliceFrames.length} REX2 slice markers with synthetic impulse waveform.`, 'info');
    });
  }
