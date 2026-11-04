import type { DetectedSlice } from '../../core/dsp/AudioSlicerEngine.ts';
import { bridgeClient } from '../../core/bridge/BridgeClient.ts';
import { resolveAiActionDeclaration } from '../../core/ai/aiHonesty.ts';
import { escHtml } from '../escape.ts';
import { ICONS } from '../icons.ts';
import { MUSICIAN_TERMS } from '../preflightGateView.ts';
import { midiToNoteName } from '../ZoneRibbon.ts';
import type { ChopperContext } from './types.ts';
import { drawMagnifierCanvas, drawWaveformCanvas } from './canvasOps.ts';

export function render(ui: ChopperContext): void {
  if (!ui.state.backdropEl) {
    ui.state.backdropEl = document.createElement('div');
    ui.state.backdropEl.className = 'nmm-modal-backdrop nmm-chopper-backdrop';
    document.body.appendChild(ui.state.backdropEl);

    ui.state.backdropEl.addEventListener('click', (e) => {
      if (e.target === ui.state.backdropEl) ui.close();
    });
    // Escape + Tab los gestiona la trampa de foco compartida (ver open()).
  }

  const hasAudio = ui.state.pcm.length > 0;
  const res = ui.state.currentResult;
  const slices = res?.slices ?? [];
  const validCount = res?.validSlicesCount ?? 0;
  const totalCount = res?.totalSlices ?? 0;
  const isWorkingExtended = ui.state.context.getCurrentWorkingMode() === 'extended';
  const activeCutFrame = ui.getActiveCutFrame();
  const activeBoundaryIdx = ui.state.activeBoundaryIndex;

  const cutSampleVal = ui.state.pcm.length > 0 && activeCutFrame < ui.state.pcm.length ? ui.state.pcm[activeCutFrame] : 0;
  const isZeroCrossingGood = ui.checkZeroCrossing(activeCutFrame);
  const isBridgeConn = bridgeClient.isConnected();
  const demucsDecl = resolveAiActionDeclaration('chopper-demucs-split', { isBridgeConnected: isBridgeConn });
  const whisperDecl = resolveAiActionDeclaration('chopper-whisper-align', { isBridgeConnected: isBridgeConn });
  const bweDecl = resolveAiActionDeclaration('chopper-bwe-enhance', { isBridgeConnected: isBridgeConn });
  const isOneShotWorkflow = (ui.state.options.workflowMode ?? 'rex_groove_loop') === 'one_shot_extractor';
  const detectedBpm = res?.detectedBpm ?? ui.state.options.bpm ?? 120;
  const detectedBars = res?.detectedBars ?? ui.state.options.barCount ?? 2;
  const effectiveTargetBpm = ui.state.options.targetBpm ?? res?.targetBpm ?? detectedBpm;

  ui.state.backdropEl.innerHTML = `
    <div class="nmm-modal-window nmm-audio-modal-window" role="dialog" aria-modal="true" aria-labelledby="chopper-title">
      <header class="nmm-modal-header">
        <div class="nmm-modal-header-title">
          <span class="nmm-modal-header-icon">${ICONS.scissors}</span>
          <h2 id="chopper-title">AutoSlicer — Audio Chopper &amp; Multi-Layer Slicer</h2>
          <span class="panel-badge ${hasAudio ? 'badge-ai-on' : 'badge-muted'}">
            ${hasAudio ? escHtml(ui.state.sourceFilename) : 'No Sample Loaded'}
          </span>
        </div>
        <button type="button" class="nmm-modal-close" aria-label="Close" id="btn-chopper-close">${ICONS.close}</button>
      </header>

      <div class="nmm-modal-body nmm-audio-modal-body">
        <input type="file" id="inp-chopper-audio-file" accept=".wav,.aif,.aiff,.aifc,.flac,.mp3,.ogg,.oga,.m4a,.aac,.opus,.webm,.caf,.ncw,.rx2,.rex,.rcy,.sfz,.cue,.txt,audio/*" class="is-hidden-file" />
        <input type="file" id="inp-chopper-markers-file" accept=".rx2,.rex,.rcy,.sfz,.cue,.txt,.wav,.aif" class="is-hidden-file" />

        ${
          !hasAudio
            ? `
          <!-- Unified Empty State / Dropzone -->
          <div class="audio-empty-dropzone" id="chopper-empty-dropzone">
            <div class="dropzone-icon-ring">
              <span class="dropzone-icon">${ICONS.scissors}</span>
            </div>
            <h3 class="dropzone-title">NO AUDIO FILE LOADED IN AUTO-SLICER</h3>
            <p class="dropzone-subtitle">
              Drag &amp; drop a drum loop, vocal track, rhythmic phrase, or ReCycle slice file (.wav, .aif, .flac, .rx2, .rex, .sfz) to auto-detect or import slices.
            </p>
            <div class="dropzone-actions">
              <button type="button" class="btn btn-primary" id="btn-chopper-browse-file">
                ${ICONS.folder} Browse Audio or Slice File...
              </button>
              <button type="button" class="btn btn-outline" id="btn-chopper-demo-beat" title="Load a 2-second synthesized test beat to test slicing without a sample">
                ${ICONS.drum} Load Test Beat (Demo)
              </button>
            </div>
            <div class="dropzone-hint">
              AutoSlicer detects transients via Spectral Flux, supports ReCycle (.rx2/.rex) tables, snaps boundaries to zero-crossings, and maps slices to GM Drum notes or chromatic keyboard zones.
            </div>
          </div>
        `
            : `
          <!-- Waveform Canvas Viewport -->
          <div class="nmm-audio-viewport-panel">
            <div class="chopper-waveform-toolbar">
              <div class="nmm-audio-zoom-group">
                <span class="toolbar-label">ZOOM:</span>
                <button type="button" class="btn btn-xs btn-outline" id="btn-chopper-zoom-out" title="Zoom Out Waveform">-</button>
                <span class="val-pill" id="lbl-chopper-zoom">${ui.state.zoomFactor.toFixed(1)}x</span>
                <button type="button" class="btn btn-xs btn-outline" id="btn-chopper-zoom-in" title="Zoom In Waveform">+</button>
                <button type="button" class="btn btn-xs btn-outline" id="btn-chopper-zoom-fit" title="Fit Entire Audio File to Viewport">Fit</button>
                <button type="button" class="btn btn-xs ${ui.state.playingSliceId === '__full_wav__' ? 'btn-accent' : 'btn-outline'}" id="btn-chopper-play-full" title="Play or stop the entire WAV file from start to end">
                  ${ui.state.playingSliceId === '__full_wav__' ? ICONS.stop : ICONS.play} Play Full WAV
                </button>
              </div>
              <div class="chopper-toolbar-right">
                <div class="chopper-waveform-stats">
                  <span>${(ui.state.pcm.length / ui.state.sampleRate).toFixed(2)}s (${ui.state.pcm.length.toLocaleString()} frames)</span>
                  <span class="val-pill">${validCount} Active Slices</span>
                </div>
                <button type="button" class="btn btn-xs btn-outline" id="btn-chopper-import-cues" title="Import ReCycle (.rx2, .rex, .rcy), SFZ, or CUE text slice marker file">
                  ${ICONS.database} Import ReCycle / Cues...
                </button>
                <button type="button" class="btn btn-xs btn-outline" id="btn-chopper-change-file" title="Open another audio file">
                  ${ICONS.folder} Open File...
                </button>
              </div>
            </div>

            <div class="nmm-audio-canvas-wrap" id="chopper-canvas-wrap">
              <canvas id="chopper-waveform-canvas" height="160"></canvas>
            </div>
            <div class="nmm-audio-canvas-legend">
              <span>Left-drag markers to move</span> • <span>Right-click line/slice for Actions</span> • <span>Double-click or Right-click to Add Cut</span>
            </div>
          </div>

          <!-- Cut-Point Magnifier & Sample Nudge Panel (AutoLoop Seam Style) -->
          <div class="chopper-magnifier-panel">
            <div class="chopper-magnifier-toolbar">
              <div class="chopper-magnifier-title-box">
                <span>${ICONS.wave}</span>
                <span>CUT POINT MAGNIFIER (±256 smp):</span>
                <button type="button" class="btn btn-xs btn-outline" id="btn-mag-prev-cut" title="Previous cut boundary">&lt; Prev Cut</button>
                <strong>Boundary #${activeBoundaryIdx}</strong>
                <button type="button" class="btn btn-xs btn-outline" id="btn-mag-next-cut" title="Next cut boundary">Next Cut &gt;</button>
                <span class="val-pill font-mono">${activeCutFrame.toLocaleString()} smp (${((activeCutFrame / ui.state.sampleRate) * 1000).toFixed(1)} ms)</span>
                <span class="${isZeroCrossingGood ? 'pill-zc-good' : 'pill-zc-warn'}">
                  ${isZeroCrossingGood ? '0-X MATCH' : `0-X OFFSET (${(cutSampleVal * 100).toFixed(1)}%)`}
                </span>
              </div>

              <div class="chopper-magnifier-nudge-group">
                <span class="toolbar-label">NUDGE:</span>
                <button type="button" class="btn btn-xs btn-outline" id="btn-nudge-m100" title="Nudge boundary -100 samples">&lt;&lt; -100</button>
                <button type="button" class="btn btn-xs btn-outline" id="btn-nudge-m10" title="Nudge boundary -10 samples">&lt; -10</button>
                <button type="button" class="btn btn-xs btn-outline" id="btn-nudge-m1" title="Nudge boundary -1 sample">-1</button>
                <button type="button" class="btn btn-xs btn-accent" id="btn-nudge-snap0x" title="${escHtml(MUSICIAN_TERMS.zcSnap)}">Snap 0-X</button>
                <button type="button" class="btn btn-xs btn-outline" id="btn-nudge-p1" title="Nudge boundary +1 sample">+1</button>
                <button type="button" class="btn btn-xs btn-outline" id="btn-nudge-p10" title="Nudge boundary +10 samples">+10 &gt;</button>
                <button type="button" class="btn btn-xs btn-outline" id="btn-nudge-p100" title="Nudge boundary +100 samples">+100 &gt;&gt;</button>
                <button type="button" class="btn btn-xs ${ui.state.playingSliceId === '__full_wav__' ? 'btn-accent' : 'btn-outline'}" id="btn-mag-play-full" title="Reproducir o detener todo el WAV completo de principio a fin">
                  ${ui.state.playingSliceId === '__full_wav__' ? ICONS.stop : ICONS.play} Play WAV
                </button>
                <button type="button" class="btn btn-xs ${ui.state.playingSliceId && ui.state.playingSliceId !== '__full_wav__' ? 'btn-accent' : 'btn-outline'}" id="btn-mag-play-slice" title="Reproducir solo el slice seleccionado">
                  ${ui.state.playingSliceId && ui.state.playingSliceId !== '__full_wav__' ? ICONS.stop : ICONS.play} Play Slice
                </button>
                <button type="button" class="btn btn-xs btn-outline" id="btn-mag-toggle-silence" title="Toggle silence for current slice">
                  ${ICONS.eyeOff || 'Mute'} Silence
                </button>
                <button type="button" class="btn btn-xs btn-outline btn-danger-hover" id="btn-mag-del-boundary" title="Delete this cut boundary">
                  ${ICONS.trash} Del Cut
                </button>
              </div>
            </div>

            <div class="chopper-magnifier-canvas-wrap" id="chopper-mag-canvas-wrap">
              <canvas id="chopper-magnifier-canvas" height="84"></canvas>
            </div>
          </div>

          <!-- Real-Time Parameters & DSP/AI Action Card (Matches AutoLoop & Audio Recorder) -->
          <div class="nmm-audio-controls-card">
            <!-- Top Row: Macro-Workflow Mode (One-Shot Extractor vs REX/Groove Loop) + Elastic BPM Conformer -->
            <div class="chopper-params-row" style="padding-bottom: 8px; margin-bottom: 8px; border-bottom: 1px solid var(--color-panel-border);">
              <div class="chopper-param-group">
                <div class="chopper-param-header">
                  <span>MODO DE FLUJO (WORKFLOW)</span>
                </div>
                <div class="btn-group">
                  <button type="button" class="btn btn-xs ${isOneShotWorkflow ? 'btn-accent is-active' : 'btn-outline'}" id="btn-wf-oneshot" title="Cortar y mapear notas aisladas de un instrumento cromático o golpes sueltos de una caja de ritmos grabados nota a nota">
                    ${ICONS.scissors} 1. Cortar One-Shots (Notas / Kit)
                  </button>
                  <button type="button" class="btn btn-xs ${!isOneShotWorkflow ? 'btn-accent is-active' : 'btn-outline'}" id="btn-wf-rex" title="Bucle rítmico o frase melódica tipo REX: detecta el BPM y compases, extrae la partitura MIDI (.mid) con las notas reales y permite igualar el BPM a un Target BPM">
                    ${ICONS.wave} 2. Bucle Rítmico / Melodía REX (BPM + .mid)
                  </button>
                </div>
              </div>

              <fieldset class="conditioned-fieldset" ${isOneShotWorkflow ? 'disabled' : ''} style="display: contents;">
                <div class="chopper-param-group ${isOneShotWorkflow ? 'is-conditioned-disabled' : ''}">
                  <div class="chopper-param-header">
                    <span>BPM DETECTADO ${isOneShotWorkflow ? '<span class="cond-reason-badge">SOLO MODO REX</span>' : ''}</span>
                  </div>
                  <span class="val-pill font-mono" id="lbl-chopper-detected-bpm" title="BPM estimado automáticamente por intervalos entre ataques (IOI) y duración de compases">
                    ${detectedBpm} BPM (${detectedBars} comp.)
                  </span>
                </div>

                <div class="chopper-param-group ${isOneShotWorkflow ? 'is-conditioned-disabled' : ''}">
                  <div class="chopper-param-header">
                    <span>COMPASES (BARS)</span>
                  </div>
                  <input type="number" id="inp-chopper-bars" class="form-control font-mono" min="1" max="64" step="1" value="${detectedBars}" title="Número de compases (4/4) del bucle o melodía" />
                </div>

                <div class="chopper-param-group ${isOneShotWorkflow ? 'is-conditioned-disabled' : ''}">
                  <div class="chopper-param-header">
                    <span>TARGET BPM (ELÁSTICO)</span>
                  </div>
                  <input type="number" id="inp-chopper-target-bpm" class="form-control font-mono" min="20" max="300" step="0.5" value="${effectiveTargetBpm}" title="Ajusta el BPM de destino conservando intactos los primeros 25 ms de cada ataque" />
                </div>

                <div class="chopper-param-group ${isOneShotWorkflow ? 'is-conditioned-disabled' : ''}">
                  <div class="chopper-param-header">
                    <span>AUDICIÓN A TARGET BPM</span>
                  </div>
                  <button type="button" class="btn btn-xs ${ui.state.playingSliceId === '__conformed_loop__' ? 'btn-accent' : 'btn-outline'}" id="btn-chopper-play-conformed" title="Escuchar el bucle o melodía re-ensamblado elásticamente a Target BPM sin perder pegada de ataque">
                    ${ui.state.playingSliceId === '__conformed_loop__' ? ICONS.stop : ICONS.play} Play @ ${effectiveTargetBpm} BPM
                  </button>
                </div>
              </fieldset>
            </div>

            <div class="chopper-params-row">
              <!-- Slicing Mode -->
              <div class="chopper-param-group">
                <div class="chopper-param-header">
                  <span>SLICING MODE</span>
                </div>
                <div class="btn-group">
                  <button type="button" class="btn btn-xs ${ui.state.options.mode === 'drums' ? 'btn-accent is-active' : 'btn-outline'}" id="btn-mode-drums" title="Classify into General MIDI Drum Map notes">
                    ${ICONS.drum} Drums (GM)
                  </button>
                  <button type="button" class="btn btn-xs ${ui.state.options.mode === 'vocals' ? 'btn-accent is-active' : 'btn-outline'}" id="btn-mode-vocals" title="Vocal & phrase segmentation (OpenVPI silence valley segmentation, avoids micro-chatter)">
                    ${ICONS.wave} Vocals / Phrase
                  </button>
                  <button type="button" class="btn btn-xs ${ui.state.options.mode === 'chromatic' ? 'btn-accent is-active' : 'btn-outline'}" id="btn-mode-chromatic" title="Detect F0 pitch and map to contiguous equidistant key zones">
                    ${ICONS.piano} Chromatic
                  </button>
                  <button type="button" class="btn btn-xs ${ui.state.options.mode === 'grid' ? 'btn-accent is-active' : 'btn-outline'}" id="btn-mode-grid" title="Chop by musical grid tempo division">
                    Grid BPM
                  </button>
                </div>
              </div>

              <!-- Transient Sensitivity Slider -->
              <div class="chopper-param-group flex-1">
                <div class="chopper-param-header">
                  <span>TRANSIENT SENSITIVITY</span>
                  <span class="chopper-param-val" id="lbl-sens-val">${ui.state.options.sensitivity}%</span>
                  ${
                    ui.state.manualCutFrames.size > 0
                      ? `
                    <span class="badge-manual-cuts" title="${ui.state.manualCutFrames.size} manual cut(s) preserved">
                      ${ICONS.scissors} ${ui.state.manualCutFrames.size} manual
                      <button type="button" class="btn-reset-cuts" id="btn-reset-cuts-auto" title="Discard manual cuts and reset to full auto detection">Reset</button>
                    </span>
                  `
                      : ''
                  }
                </div>
                <input type="range" class="form-control" id="rng-sens" min="5" max="98" value="${ui.state.options.sensitivity}" />
              </div>

              <!-- Silence Gate Threshold -->
              <div class="chopper-param-group flex-1 ${ui.state.options.detectSilences === false ? 'is-conditioned-disabled' : ''}">
                <div class="chopper-param-header">
                  <span>SILENCE GATE ${ui.state.options.detectSilences === false ? '<span class="cond-reason-badge">OFF</span>' : ''}</span>
                  <span class="chopper-param-val" id="lbl-silence-val">${ui.state.options.silenceThresholdDb} dB</span>
                </div>
                <input type="range" class="form-control" id="rng-silence" min="-60" max="-18" value="${ui.state.options.silenceThresholdDb}" ${ui.state.options.detectSilences === false ? 'disabled title="Activa Detect Silences abajo para ajustar el umbral"' : ''} />
              </div>

              <!-- Min Silence Duration -->
              <div class="chopper-param-group ${ui.state.options.detectSilences === false ? 'is-conditioned-disabled' : ''}">
                <div class="chopper-param-header">
                  <span>MIN SILENCE (MS) ${ui.state.options.detectSilences === false ? '<span class="cond-reason-badge">OFF</span>' : ''}</span>
                </div>
                <input type="number" id="inp-minsilence" class="form-control font-mono" min="0" max="2000" step="10" value="${ui.state.options.minSilenceMs ?? 120}" ${ui.state.options.detectSilences === false ? 'disabled title="Activa Detect Silences abajo para ajustar la duración mínima"' : 'title="Minimum quiet duration to flag a slice as silence"'} />
              </div>

              <!-- Min Slice Ms Input -->
              <div class="chopper-param-group">
                <div class="chopper-param-header">
                  <span>MIN SLICE (MS)</span>
                </div>
                <input type="number" id="inp-minslice" class="form-control font-mono" min="20" max="1000" step="10" value="${ui.state.options.minSliceMs ?? (ui.state.options.mode === 'vocals' ? 250 : 45)}" title="Minimum slice duration in milliseconds" />
              </div>

              <!-- Pre-Roll Safety Margin -->
              <div class="chopper-param-group">
                <div class="chopper-param-header">
                  <span>PRE-ROLL (MS)</span>
                </div>
                <input type="number" id="inp-preroll" class="form-control font-mono" min="0" max="25" value="${ui.state.options.preRollMs}" title="Pre-roll safety margin in milliseconds" />
              </div>
            </div>

            <!-- Unified Action Bar (Matches .loop-action-bar & .nmm-recorder-dsp-toolbar) -->
            <div class="chopper-action-bar">
              <div class="chopper-action-bar-left">
                <button type="button" class="btn btn-sm ${ui.state.options.snapZeroCrossing ? 'btn-accent is-active' : 'btn-outline'}" id="btn-toggle-zc-snap" title="${escHtml(MUSICIAN_TERMS.zcSnap)}">
                  ${escHtml(MUSICIAN_TERMS.zcSnap)}: ${ui.state.options.snapZeroCrossing ? 'ON' : 'OFF'}
                </button>
                <button type="button" class="btn btn-sm ${isWorkingExtended && ui.state.options.allowOverlap ? 'btn-accent is-active' : 'btn-outline'} ${!isWorkingExtended ? 'is-conditioned-disabled' : ''}" id="btn-toggle-overlap" ${!isWorkingExtended ? 'disabled title="Overlaps solo disponibles en Modo Extended (en Modo Classic el teclado 0..127 es contiguo y disjunto)"' : 'title="Allow overlapping key & velocity zones"'}>
                  Overlaps: ${isWorkingExtended && ui.state.options.allowOverlap ? 'ALLOW' : 'DISJOINT'} ${!isWorkingExtended ? '<span class="cond-reason-badge is-extended-only">EXTENDED</span>' : ''}
                </button>
                <button type="button" class="btn btn-sm ${ui.state.options.detectSilences !== false ? 'btn-accent is-active' : 'btn-outline'}" id="btn-toggle-silence-detect" title="Auto-flag quiet slices as silence (excluded when injecting into session)">
                  Detect Silences: ${ui.state.options.detectSilences !== false ? 'ON' : 'OFF'}
                </button>
                <button type="button" class="btn btn-sm ${ui.state.normalizeEnabled ? 'btn-accent is-active' : 'btn-outline'}" id="btn-toggle-normalize" title="Peak-normalize working audio to -1 dBFS (non-destructive: source buffer untouched)">
                  Normalize: ${ui.state.normalizeEnabled ? 'ON' : 'OFF'}
                </button>
              </div>

              <div class="chopper-action-bar-right">
                <button type="button" class="btn btn-sm btn-outline" id="btn-chopper-dsp-denoise" title="Clean audio with DSP Spectral Gate using captured or auto noise profile">
                  ${ICONS.sliders} DSP Denoise
                </button>
                <button type="button" class="btn btn-sm btn-outline" id="btn-chopper-demucs-split" title="${escHtml(demucsDecl.buttonTooltip)}">
                  ${ICONS.wave} ${escHtml(demucsDecl.buttonLabel)}
                </button>
                <button type="button" class="btn btn-sm btn-outline" id="btn-chopper-whisper-align" title="${escHtml(whisperDecl.buttonTooltip)}">
                  ${ICONS.sparkle} ${escHtml(whisperDecl.buttonLabel)}
                </button>
                <button type="button" class="btn btn-sm btn-ai-accent" id="btn-chopper-ai-enhance" title="${escHtml(bweDecl.buttonTooltip)}">
                  ${ICONS.sparkle} ${escHtml(bweDecl.buttonLabel)}
                </button>
              </div>
            </div>
          </div>

          <!-- Slices Table Inspector -->
          <div class="nmm-audio-table-panel">
            <div class="chopper-table-header-row">
              <span class="chopper-table-title">
                Detected Slices (${validCount} valid / ${totalCount} total)
              </span>
              <span class="nmm-recorder-takes-hint">
                Target: <strong>${isWorkingExtended ? 'Extended 2D Regions' : 'Classic 128-Zone Hartmann'}</strong>
              </span>
            </div>

            <div class="chopper-table-scroll">
              <table class="canonical-zone-table nmm-data-table">
                <thead>
                  <tr>
                    <th>#ID</th>
                    <th>Time Range</th>
                    <th>Duration</th>
                    <th>Classification</th>
                    <th>Root Key</th>
                    <th>Key Range</th>
                    <th>Velocity</th>
                    <th>Peak / RMS</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody id="chopper-tbody">
                  ${renderTableRows(ui, slices)}
                </tbody>
              </table>
            </div>
          </div>
        `
        }
      </div>

      <!-- Footer Actions Bar -->
      <footer class="nmm-modal-footer">
        <div class="footer-left">
          <button type="button" class="btn btn-ghost" id="btn-chopper-discard">Discard &amp; Close</button>
        </div>
        <div class="footer-right">
          ${
            hasAudio
              ? `
            <!-- Draggable MIDI Pattern Button -->
            <button type="button" class="btn btn-accent btn-drag-midi ${isOneShotWorkflow ? 'is-conditioned-disabled' : ''}" id="btn-drag-midi" draggable="${!isOneShotWorkflow}" ${isOneShotWorkflow ? 'disabled title="Cambia al Modo 2 (Bucle Rítmico / Melodía REX) para exportar o arrastrar la partitura MIDI (.mid) al DAW"' : 'title="Drag MIDI Pattern directly to DAW track or click to download .mid file (at Target BPM)"'}>
              ${ICONS.piano} Drag MIDI to DAW (.mid @ ${effectiveTargetBpm} BPM) ${isOneShotWorkflow ? '<span class="cond-reason-badge">MODO REX</span>' : ''}
            </button>

            <!-- Inject Conformed Loop at Target BPM Button -->
            <button type="button" class="btn btn-outline ${isOneShotWorkflow ? 'is-conditioned-disabled' : ''}" id="btn-chopper-inject-loop" ${validCount === 0 || isOneShotWorkflow ? 'disabled' : ''} title="${isOneShotWorkflow ? 'Solo disponible en Modo 2 (Bucle Rítmico / Melodía REX)' : 'Inyecta el bucle continuo re-ensamblado a Target BPM en una zona con loop continuo y guarda Tempo-Sync para el Resinator v2'}">
              ${ICONS.wave} Inyectar Loop Continuo (${effectiveTargetBpm} BPM) ${isOneShotWorkflow ? '<span class="cond-reason-badge">MODO REX</span>' : ''}
            </button>

            <!-- Inject as Zones Button -->
            <button type="button" class="btn btn-primary" id="btn-chopper-inject" ${validCount === 0 ? 'disabled' : ''}>
              ${ICONS.scissors} Inject as Zones into Session (${validCount} Zones)
            </button>
          `
              : ''
          }
        </div>
      </footer>
    </div>
  `;

  ui.bindEvents();
  if (hasAudio) {
    drawWaveformCanvas(ui, );
    drawMagnifierCanvas(ui, );
  }
}

export function renderTableRows(ui: ChopperContext, slices: DetectedSlice[]): string {
  if (slices.length === 0) {
    return `<tr><td colspan="9" class="nmm-recorder-takes-empty">No slices detected. Adjust sensitivity slider above.</td></tr>`;
  }
  return slices
    .map((sl) => {
      const isSel = sl.id === ui.state.selectedSliceId;
      const isPlaying = sl.id === ui.state.playingSliceId;
      const isSilence = sl.isSilence;

      return `
        <tr class="zone-table-row ${isSel ? 'is-selected' : ''} ${isSilence ? 'is-silence-row' : ''}" data-slice-id="${sl.id}">
          <td>${sl.index}</td>
          <td>${sl.startSec.toFixed(2)}s..${sl.endSec.toFixed(2)}s</td>
          <td>${(sl.durationSec * 1000).toFixed(0)} ms</td>
          <td>
            ${isSilence ? `<span class="val-pill">Silence</span>` : `<span class="chopper-param-val">${escHtml(sl.label)}</span>`}
          </td>
          <td>${isSilence ? '—' : `${sl.rootKey} (${midiToNoteName(sl.rootKey)})`}</td>
          <td>${isSilence ? '—' : `${sl.lowKey}..${sl.highKey}`}</td>
          <td>${isSilence ? '—' : `${sl.lowVel}..${sl.highVel}`}</td>
          <td>${sl.peakDb}dB / ${sl.rmsDb}dB</td>
          <td>
            <button type="button" class="btn btn-xs btn-ghost btn-play-slice" data-slice-id="${sl.id}" title="Audition slice one-shot">
              ${isPlaying ? ICONS.stop : ICONS.play}
            </button>
            <button type="button" class="btn btn-xs ${isSilence ? 'btn-outline' : 'btn-ghost'} btn-toggle-silence-row" data-slice-id="${sl.id}" title="${isSilence ? 'Unmute (Mark as active)' : 'Mute (Mark as silence)'}">
              ${isSilence ? 'Unmute' : 'Mute'}
            </button>
            <button type="button" class="btn btn-xs btn-ghost btn-danger-hover btn-delete-slice" data-slice-id="${sl.id}" title="Remove slice marker">
              ${ICONS.trash}
            </button>
          </td>
        </tr>
      `;
    })
    .join('');
}

export function updateMagnifierHeader(ui: ChopperContext): void {
  if (!ui.state.backdropEl) return;
  const activeCutFrame = ui.getActiveCutFrame();
  const isCutManual = ui.isBoundaryManual(activeCutFrame);
  const cutSampleVal = ui.state.pcm.length > 0 && activeCutFrame < ui.state.pcm.length ? ui.state.pcm[activeCutFrame] : 0;
  const isZeroCrossingGood = ui.checkZeroCrossing(activeCutFrame);

  const titleBox = ui.state.backdropEl.querySelector('.chopper-magnifier-title-box');
  if (titleBox) {
    titleBox.innerHTML = `
      <span>${ICONS.wave}</span>
      <span>CUT POINT MAGNIFIER (±256 smp):</span>
      <button type="button" class="btn btn-xs btn-outline" id="btn-mag-prev-cut" title="Previous slice boundary">&lt; Prev Cut</button>
      <strong>Boundary #${ui.state.activeBoundaryIndex}</strong>
      ${isCutManual ? '<span class="badge-manual-cuts">MANUAL CUT</span>' : ''}
      <button type="button" class="btn btn-xs btn-outline" id="btn-mag-next-cut" title="Next slice boundary">Next Cut &gt;</button>
      <span class="val-pill font-mono">${activeCutFrame.toLocaleString()} smp (${((activeCutFrame / ui.state.sampleRate) * 1000).toFixed(1)} ms)</span>
      <span class="${isZeroCrossingGood ? 'pill-zc-good' : 'pill-zc-warn'}">
        ${isZeroCrossingGood ? '0-X MATCH' : `0-X OFFSET (${(cutSampleVal * 100).toFixed(1)}%)`}
      </span>
    `;

    ui.state.backdropEl.querySelector('#btn-mag-prev-cut')?.addEventListener('click', () => ui.navigateBoundary(-1));
    ui.state.backdropEl.querySelector('#btn-mag-next-cut')?.addEventListener('click', () => ui.navigateBoundary(1));
  }
}

export function refreshTable(ui: ChopperContext): void {
  if (!ui.state.backdropEl) return;
  const tbody = ui.state.backdropEl.querySelector('#chopper-tbody');
  if (tbody && ui.state.currentResult) {
    tbody.innerHTML = renderTableRows(ui, ui.state.currentResult.slices);
    ui.bindTableEvents();
  }
}
