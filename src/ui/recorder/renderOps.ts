import type { RecorderContext } from './types.ts';
import type { LiveWaveWindowSec } from './types.ts';
import { STATE_BADGE, mixToMono, normalizeNoiseProfile } from './recorderUtils.ts';
import type { AutoSamplerCaptureMode } from '@abdsynths/shared/contracts/recordingSession';
import type { RecorderState } from '@abdsynths/shared/dsp/take/recordingEngine.ts';
import { detectSilenceRanges } from '@abdsynths/shared/dsp/take/takeDsp.ts';
import { resolveAiActionDeclaration } from '../../core/ai/aiHonesty.ts';
import { buildScheduleFromConfig } from '../../core/autoSampler/MidiAutoSampleSession.ts';
import { FACTORY_DRUM_MAP_PRESETS } from '../../core/autoSampler/drumMapParser.ts';
import { isEs } from '../../core/i18n.ts';
import { escHtml } from '../escape.ts';
import { ICONS } from '../icons.ts';
import { MUSICIAN_TERMS } from '../preflightGateView.ts';

export function render(ctx: RecorderContext): void {
    if (!ctx.state.backdropEl) return;
    const isAutoSampler = ctx.state.operatingMode === 'midi_autosampler';
    const es = isEs();

    ctx.state.backdropEl.innerHTML = `
      <div class="nmm-modal-window nmm-audio-modal-window" role="dialog" aria-modal="true" aria-labelledby="recorder-title" tabindex="-1">
        <header class="nmm-modal-header">
          <div class="nmm-modal-header-title">
            <span class="nmm-modal-header-icon">${isAutoSampler ? ICONS.piano : ICONS.mic}</span>
            <span class="nmm-recorder-rec-dot" id="rec-state-dot" aria-hidden="true"></span>
            <h2 id="recorder-title">${es ? 'Grabar — Grabadora de Audio y AutoSampler MIDI' : 'Record — Audio Recorder &amp; MIDI AutoSampler'}</h2>
            <span class="panel-badge badge-muted" id="rec-state-badge">IDLE</span>
          </div>
          <button type="button" class="nmm-modal-close" aria-label="${es ? 'Cerrar' : 'Close'}" id="btn-recorder-close">${ICONS.close}</button>
        </header>

        <div class="nmm-modal-body nmm-audio-modal-body">
          <!-- 1. Studio Input, Mode Selector, LCD, Meters & Transport Deck Card -->
          <div class="nmm-recorder-deck-card">
            <!-- Selector Superior de Modo (Sin islas visuales) -->
            <div class="nmm-recorder-mode-bar">
              <div class="nmm-recorder-mode-pills" role="tablist" aria-label="${es ? 'Modo operativo de grabación' : 'Recorder operating mode'}">
                <span class="nmm-recorder-device-label">${es ? 'FLUJO:' : 'WORKFLOW:'}</span>
                <button type="button" class="btn btn-xs ${!isAutoSampler ? 'btn-accent' : 'btn-outline'}" id="btn-mode-free-audio">
                  ${ICONS.mic} ${es ? 'Grabación Directa de Audio' : 'Direct Audio Recording'}
                </button>
                <button type="button" class="btn btn-xs ${isAutoSampler && ctx.state.autoSamplerConfig.mode === 'auto_sweep' ? 'btn-accent' : 'btn-outline'}" id="btn-mode-as-sweep">
                  ${ICONS.piano} ${es ? 'AutoSampler MIDI (Barrido)' : 'MIDI AutoSampler (Sweep)'}
                </button>
                <button type="button" class="btn btn-xs ${isAutoSampler && ctx.state.autoSamplerConfig.mode === 'live_midi_capture' ? 'btn-accent' : 'btn-outline'}" id="btn-mode-as-live">
                  ${ICONS.wave} ${es ? 'Captura MIDI en Tiempo Real' : 'Real-Time MIDI Capture'}
                </button>
                <button type="button" class="btn btn-xs ${isAutoSampler && ctx.state.autoSamplerConfig.mode === 'drum_map' ? 'btn-accent' : 'btn-outline'}" id="btn-mode-as-drum">
                  ${ICONS.drum} ${es ? 'Muestreo de Batería / Percusión' : 'Drum / Percussion Sampling'}
                </button>
              </div>
            </div>

            <div class="nmm-recorder-devicebar">
              <div class="nmm-recorder-device-left">
                <label class="nmm-recorder-device-label" for="rec-device">${es ? 'ENTRADA AUDIO:' : 'AUDIO IN:'}</label>
                <select id="rec-device" class="form-control form-control-sm nmm-recorder-device-select" aria-label="${es ? 'Dispositivo de entrada' : 'Input device'}"></select>
                <button type="button" class="btn btn-xs btn-outline" id="btn-rec-refresh-devices" title="${es ? 'Actualizar dispositivos de entrada' : 'Refresh input devices'}">${ICONS.refresh} ${es ? 'Reescanear' : 'Rescan'}</button>
                <button type="button" class="btn btn-xs btn-outline" id="btn-rec-enable-mic">${ICONS.mic} ${es ? 'Activar Audio' : 'Enable Audio'}</button>
              </div>
              <div class="nmm-recorder-device-right">
                <span class="val-pill font-mono" id="rec-peak-pill">−∞ dBFS</span>
                <span class="val-pill font-mono" id="rec-class-pill">${es ? 'sin tomas aún' : 'no take yet'}</span>
              </div>
            </div>

            <div class="nmm-recorder-console-grid">
              <div class="nmm-recorder-lcdrow">
                <div class="nmm-recorder-lcd" aria-live="polite">
                  <span id="rec-lcd-time">00:00.0</span>
                </div>
              </div>

              <div class="nmm-recorder-meters" aria-hidden="true">
                <div class="nmm-recorder-meter"><span>L</span><div class="nmm-recorder-meter-track"><div class="nmm-recorder-meter-fill" id="rec-meter-l"></div></div></div>
                <div class="nmm-recorder-meter"><span>R</span><div class="nmm-recorder-meter-track"><div class="nmm-recorder-meter-fill" id="rec-meter-r"></div></div></div>
              </div>

              <div class="nmm-recorder-transport" id="rec-transport"></div>
            </div>
          </div>

          <!-- 1B. Panel Paramétrico Nativo del AutoSampler MIDI (solo activo en modo AutoSampler) -->
          <div id="rec-autosampler-deck-slot"></div>

          <!-- 2 & 3. Waveform Viewport Panel + Noise Gate & DSP/AI Restoration Card -->
          <div class="nmm-recorder-inspector" id="rec-take-inspector"></div>

          <!-- 4. Session Takes Table / List Panel -->
          <div class="nmm-audio-table-panel">
            <div class="nmm-recorder-takes-head">
              <div class="nmm-recorder-takes-head-left">
                <span>${es ? 'TOMAS DE SESIÓN' : 'SESSION TAKES'}</span>
                <span class="val-pill font-mono" id="rec-takes-count">0</span>
              </div>
              <span class="nmm-recorder-takes-hint">${es ? 'Selecciona una toma para inspeccionar forma de onda, capturar Huella de Ruido, rescatar cortes o enviar a Chopper / Sesión' : 'Select a take to inspect waveform, capture Noise Print, rescue cuts, or send to Chopper / Session'}</span>
            </div>
            <div class="nmm-recorder-takes" id="rec-takes"></div>
          </div>
        </div>

        <footer class="nmm-modal-footer">
          <div class="footer-left">
            <button type="button" class="btn btn-ghost" id="btn-recorder-footer-close">${es ? 'Cerrar' : 'Close'}</button>
          </div>
          <div class="footer-right" id="rec-footer-actions"></div>
        </footer>
      </div>`;

    ctx.state.backdropEl.querySelector('#btn-recorder-close')?.addEventListener('click', () => void ctx.close());
    ctx.state.backdropEl.querySelector('#btn-recorder-footer-close')?.addEventListener('click', () => void ctx.close());
    ctx.state.backdropEl
      .querySelector('#btn-rec-refresh-devices')
      ?.addEventListener('click', () => void ctx.refreshDevices());
    ctx.state.backdropEl
      .querySelector('#btn-rec-enable-mic')
      ?.addEventListener('click', () => void ctx.enableMic());
    ctx.state.backdropEl
      .querySelector('#rec-device')
      ?.addEventListener('change', () => void ctx.enableMic());

    // Cambio de modo operativo
    ctx.state.backdropEl.querySelector('#btn-mode-free-audio')?.addEventListener('click', () => {
      ctx.state.operatingMode = 'free_audio';
      render(ctx, );
      void ctx.refreshDevices();
    });
    const setAsSubMode = (subMode: AutoSamplerCaptureMode) => {
      ctx.state.operatingMode = 'midi_autosampler';
      ctx.state.autoSamplerConfig.mode = subMode;
      if (subMode === 'drum_map' && !ctx.state.autoSamplerConfig.drumMap) {
        ctx.state.autoSamplerConfig.drumMap = FACTORY_DRUM_MAP_PRESETS.tr808_909;
      }
      ctx.state.activeSchedule = buildScheduleFromConfig(ctx.state.autoSamplerConfig);
      render(ctx, );
      void ctx.refreshDevices();
      void ctx.refreshMidiPorts();
    };
    ctx.state.backdropEl
      .querySelector('#btn-mode-as-sweep')
      ?.addEventListener('click', () => setAsSubMode('auto_sweep'));
    ctx.state.backdropEl
      .querySelector('#btn-mode-as-live')
      ?.addEventListener('click', () => setAsSubMode('live_midi_capture'));
    ctx.state.backdropEl
      .querySelector('#btn-mode-as-drum')
      ?.addEventListener('click', () => setAsSubMode('drum_map'));

    renderTransport(ctx, );
    ctx.renderAutoSamplerDeck();
    renderTakes(ctx, );
    renderTakeInspector(ctx, );
  }


export function renderTransport(ctx: RecorderContext): void {
    const box = ctx.state.backdropEl?.querySelector('#rec-transport');
    if (!box) return;
    const es = isEs();
    const isAsSweep =
      ctx.state.operatingMode === 'midi_autosampler' &&
      ctx.state.autoSamplerConfig.mode !== 'live_midi_capture';
    const recLabel = isAsSweep ? (es ? 'INICIAR BARRIDO' : 'START SWEEP') : 'REC';
    box.innerHTML = `
      <button type="button" class="btn btn-sm btn-danger-solid" id="btn-rec-record" title="${es ? 'Grabar / iniciar barrido AutoSampler' : 'Record / start AutoSampler sweep'}">${ICONS.record} ${recLabel}</button>
      <button type="button" class="btn btn-sm btn-outline" id="btn-rec-stop" title="${es ? 'Detener y conservar toma' : 'Stop and keep take'}">${ICONS.stop} ${es ? 'Detener' : 'Stop'}</button>
      <button type="button" class="btn btn-sm btn-outline" id="btn-rec-cancel" title="${es ? 'Descartar toma actual' : 'Discard current take'}">${ICONS.trash} ${es ? 'Descartar' : 'Discard'}</button>`;
    box.querySelector('#btn-rec-record')?.addEventListener('click', () => void ctx.toggleRecord());
    box.querySelector('#btn-rec-stop')?.addEventListener('click', () => ctx.stopAndKeep());
    box.querySelector('#btn-rec-cancel')?.addEventListener('click', () => ctx.cancelAndDiscard());
    syncTransportState(ctx, );
  }


export function renderFooterActions(ctx: RecorderContext): void {
    const footerRight = ctx.state.backdropEl?.querySelector<HTMLElement>('#rec-footer-actions');
    if (!footerRight) return;
    const st = ctx.getSelectedTake();
    if (!st) {
      footerRight.innerHTML = '';
      return;
    }
    const es = isEs();
    const isAutoSampled = Boolean(st.manifest);
    const sliceCount = st.processedAutoSample?.slicerResult.slices.length ?? st.manifest?.events.length ?? 0;

    footerRight.innerHTML = `
      <button type="button" class="btn btn-outline" id="btn-rec-footer-download" title="${es ? 'Descargar toma seleccionada como WAV de 16 bits' : 'Download selected take as 16-bit WAV'}">
        ${ICONS.download} ${es ? 'Descargar WAV' : 'Download WAV'}
      </button>
      <button type="button" class="btn btn-accent" id="btn-rec-footer-chopper" title="${es ? 'Abrir toma seleccionada en Audio Chopper y Auto-Slicer con puntos de corte MIDI' : 'Open selected take in Audio Chopper & Auto-Slicer with MIDI cut points'}">
        ${ICONS.scissors} ${isAutoSampled ? (es ? `Abrir en AutoSlicer (${sliceCount} cortes)` : `Open in AutoSlicer (${sliceCount} cuts)`) : (es ? 'Enviar a Audio Chopper' : 'Send to Audio Chopper')}
      </button>
      ${
        isAutoSampled && ctx.state.context.onInjectAutoSampledInstrument
          ? `<button type="button" class="btn btn-primary" id="btn-rec-footer-inject" title="${es ? 'Inyectar todas las zonas/regiones AutoSampled + AutoLoops en la Sesión' : 'Inject all AutoSampled zones/regions + AutoLoops into Session'}">
              ${ICONS.check} ${es ? `Inyectar ${sliceCount} Zonas Mapeadas en Sesión` : `Inject ${sliceCount} Mapped Zones into Session`}
            </button>`
          : ctx.state.context.onInjectTakeIntoSession
            ? `<button type="button" class="btn btn-primary" id="btn-rec-footer-inject" title="${es ? 'Inyectar toma seleccionada en la Zona Activa' : 'Inject selected take into Active Zone'}">
                ${ICONS.check} ${es ? 'Inyectar en Zona Activa' : 'Inject into Active Zone'}
              </button>`
            : ''
      }
    `;
    footerRight
      .querySelector('#btn-rec-footer-download')
      ?.addEventListener('click', () => ctx.downloadTake(st.id));
    footerRight
      .querySelector('#btn-rec-footer-chopper')
      ?.addEventListener('click', () => ctx.sendTakeToChopper(st.id));
    footerRight
      .querySelector('#btn-rec-footer-inject')
      ?.addEventListener('click', () => ctx.injectTakeIntoSession(st.id));
  }


export function renderTakeInspector(ctx: RecorderContext): void {
    const container = ctx.state.backdropEl?.querySelector<HTMLElement>('#rec-take-inspector');
    renderFooterActions(ctx, );
    if (!container) return;
    const es = isEs();

    const liveWindowControlsHtml = `
      <div class="nmm-audio-zoom-group" title="${es ? 'Ventana de zoom horizontal constante durante la grabación en vivo (nunca aplasta la onda)' : 'Constant horizontal zoom window during live recording (never squashes the wave)'}">
        <span class="toolbar-label">${es ? 'VENTANA EN VIVO:' : 'LIVE WINDOW:'}</span>
        ${([2, 5, 10, 30] as LiveWaveWindowSec[])
          .map(
            (sec) =>
              `<button type="button" class="btn btn-xs ${ctx.state.liveWindowSec === sec ? 'btn-accent' : 'btn-outline'}" data-live-win="${sec}">${sec}s</button>`
          )
          .join('')}
      </div>
    `;

    const bindLiveWindowButtons = () => {
      container.querySelectorAll<HTMLButtonElement>('[data-live-win]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const sec = Number(btn.getAttribute('data-live-win')) as LiveWaveWindowSec;
          if (sec === 2 || sec === 5 || sec === 10 || sec === 30) {
            ctx.state.liveWindowSec = sec;
            renderTakeInspector(ctx, );
          }
        });
      });
    };

    const st = ctx.getSelectedTake();
    const recBweDecl = resolveAiActionDeclaration('recorder-ai-denoise', ctx.getAiDenoiseActionContext());
    const mono = st ? mixToMono(st.take) : new Float32Array(0);
    const silences = st
      ? detectSilenceRanges(mono, st.take.sampleRate, {
          thresholdDb: ctx.state.silenceThresholdDb,
          minSilenceMs: ctx.state.minSilenceMs,
        })
      : [];
    const np = st ? normalizeNoiseProfile(st.take.noiseProfile) : undefined;
    const hasSelection =
      st !== null &&
      st.selectionStartFrame !== null &&
      st.selectionEndFrame !== null &&
      st.selectionEndFrame > st.selectionStartFrame;
    const selText = !st
      ? es
        ? `Ventana en Vivo: ${ctx.state.liveWindowSec}s (Zoom Constante)`
        : `Live Window: ${ctx.state.liveWindowSec}s (Constant Zoom)`
      : hasSelection
        ? es
          ? `Zona Ruido Seleccionada: ${((st.selectionStartFrame! / st.take.sampleRate) * 1000).toFixed(0)}..${((st.selectionEndFrame! / st.take.sampleRate) * 1000).toFixed(0)} ms`
          : `Selected Noise Zone: ${((st.selectionStartFrame! / st.take.sampleRate) * 1000).toFixed(0)}..${((st.selectionEndFrame! / st.take.sampleRate) * 1000).toFixed(0)} ms`
        : st.manifest
          ? es
            ? `${st.manifest.events.length} Cortes MIDI (${st.processedAutoSample?.extendedRegions.filter((r) => r.loopMode !== 'no_loop').length ?? 0} con AutoLoop)`
            : `${st.manifest.events.length} MIDI Note Slices (${st.processedAutoSample?.extendedRegions.filter((r) => r.loopMode !== 'no_loop').length ?? 0} AutoLooped)`
          : es
            ? 'Arrastra sobre la onda para seleccionar una región de Huella de Ruido'
            : 'Drag on waveform to select a Noise Print region';

    const npSummary = np
      ? `Floor: ${np.levelDbfs.toFixed(1)} dBFS · 50Hz: ${np.hum50HzDb.toFixed(1)} dB · 60Hz: ${np.hum60HzDb.toFixed(1)} dB ${st?.noiseRegionLabel ? `[${st.noiseRegionLabel}]` : ''}`
      : st
        ? es
          ? 'Sin huella capturada aún (pulsa Detectar Ruido o arrastra en la onda)'
          : 'No noise print captured yet (click Detect Noise or drag on waveform)'
        : es
          ? 'Se detectará automáticamente al finalizar la grabación (o con Detectar Ruido)'
          : 'Automatically detected when recording finishes (or via Detect Noise)';

    container.innerHTML = `
      <div class="nmm-recorder-inspector-card">
        <div class="nmm-audio-viewport-panel">
          <div class="nmm-recorder-inspector-head">
            <span class="nmm-recorder-inspector-title">${ICONS.wave} ${
              st
                ? `${escHtml(st.name)} • ${(st.take.sampleRate / 1000).toFixed(1)} kHz • ${st.take.durationSec.toFixed(2)}s`
                : es
                  ? 'FORMA DE ONDA EN VIVO Y INSPECTOR DE HUELLA DE RUIDO'
                  : 'LIVE SCROLLING WAVEFORM &amp; NOISE PRINT INSPECTOR'
            }</span>
            <div class="nmm-recorder-dsp-right">
              ${liveWindowControlsHtml}
              <span class="val-pill font-mono" id="rec-sel-readout">${escHtml(selText)}</span>
            </div>
          </div>

          <div class="nmm-audio-canvas-wrap">
            <canvas id="rec-wave-canvas" class="nmm-recorder-wave-canvas" width="960" height="160"></canvas>
          </div>

          <div class="nmm-audio-canvas-legend">
            ${
              st
                ? `
              <span>${es ? 'Arrastrar en onda = Seleccionar región <strong>Noise Print</strong> (Violeta)' : 'Drag on waveform = Select <strong>Noise Print</strong> region (Violet)'}</span>
              <span>• ${es ? 'Línea verde = <strong>NoteOn</strong>' : 'Green line = <strong>NoteOn</strong>'}</span>
              <span>• ${es ? 'Línea ámbar = <strong>NoteOff</strong>' : 'Amber line = <strong>NoteOff</strong>'}</span>
              <span>• ${es ? 'Línea cian = <strong>TailEnd / Corte</strong>' : 'Cyan line = <strong>TailEnd / Cut</strong>'}</span>
            `
                : `
              <span>${es ? `Grabación en vivo = Desplazamiento horizontal a zoom constante de <strong>${ctx.state.liveWindowSec}s</strong>` : `Live Recording = Scrolls horizontally at constant <strong>${ctx.state.liveWindowSec}s</strong> zoom (never squashes)`}</span>
              <span>• ${es ? 'Verde = <strong>NoteOn</strong>' : 'Green = <strong>NoteOn</strong>'}</span>
              <span>• ${es ? 'Ámbar = <strong>NoteOff</strong> (Inicio Release)' : 'Amber = <strong>NoteOff</strong> (Release start)'}</span>
              <span>• ${es ? 'Cian = <strong>TailEnd</strong> / Loop' : 'Cyan = <strong>TailEnd</strong> / Loop'}</span>
            `
            }
          </div>
        </div>

        <div class="nmm-audio-controls-card">
          <div class="nmm-recorder-params-grid">
            <div class="form-group">
              <div class="label-with-val">
                <label>${escHtml(MUSICIAN_TERMS.noisePrint)}</label>
                <span class="val-pill">${np ? (es ? 'ACTIVA' : 'ACTIVE') : ctx.state.autoDetectNoiseOnFinish ? 'AUTO' : (es ? 'NINGUNA' : 'NONE')}</span>
              </div>
              <div class="nmm-recorder-noise-readout-box" id="rec-noise-readout" title="${escHtml(npSummary)}">
                ${escHtml(npSummary)}
              </div>
            </div>

            <div class="form-group">
              <div class="label-with-val">
                <label for="sel-rec-denoise-mode">${es ? 'MODO DE MOTOR DENOISE' : 'DENOISE ENGINE MODE'}</label>
                <span class="val-pill font-mono">${
                  ctx.state.denoiseMode === 'algorithmic'
                    ? es ? 'ALGORÍTMICO' : 'ALGORITHMIC'
                    : ctx.state.denoiseMode === 'noise_print'
                      ? es ? 'HUELLA DE RUIDO' : 'NOISE PRINT'
                      : es ? 'IA NEURAL' : 'NEURAL AI'
                }</span>
              </div>
              <select id="sel-rec-denoise-mode" class="form-control form-control-sm" title="${es ? 'Selecciona el motor de reducción de ruido: Algorítmico (puerta espectral automática + notch 50/60Hz), Basado en Huella de Ruido (sustracción de perfil capturado) o con IA' : 'Select noise reduction engine: Algorithmic (auto spectral gate + 50/60Hz notch), Noise Print-based (captured profile subtraction) or AI'}">
                <option value="algorithmic" ${ctx.state.denoiseMode === 'algorithmic' ? 'selected' : ''}>${es ? 'Denoise Algorítmico (Puerta Espectral + Hum 50/60Hz)' : 'Algorithmic Denoise (Spectral Gate + 50/60Hz Hum)'}</option>
                <option value="noise_print" ${ctx.state.denoiseMode === 'noise_print' ? 'selected' : ''}>${es ? 'Denoise por Huella de Ruido (Sustracción Espectral)' : 'Noise Print Denoise (Spectral Subtraction)'}</option>
                <option value="ai" ${ctx.state.denoiseMode === 'ai' ? 'selected' : ''}>${es ? 'Denoise con IA (Companion Bridge + Supresión de Huella)' : 'AI Denoise (Companion Bridge + Print Suppression)'}</option>
              </select>
            </div>

            <div class="form-group">
              <div class="label-with-val">
                <label for="inp-rec-denoise-db">${es ? 'REDUCCIÓN DENOISE (dB)' : 'DENOISE REDUCTION (dB)'}</label>
                <span class="val-pill font-mono" id="lbl-rec-denoise-db">${ctx.state.denoiseReductionDb} dB</span>
              </div>
              <input type="number" id="inp-rec-denoise-db" class="form-control form-control-sm font-mono" value="${ctx.state.denoiseReductionDb}" min="3" max="36" step="1" />
            </div>
          </div>

          <div class="nmm-recorder-dsp-toolbar">
            <div class="nmm-recorder-dsp-left">
              <label class="batch-check" title="${es ? 'Normalizar automáticamente a -1.0 dBFS + filtro DC Block al finalizar cada grabación' : 'Automatically normalize to -1.0 dBFS + DC Block filter when each recording finishes'}">
                <input type="checkbox" class="articulation-checkbox switch--sm" id="rec-chk-auto-norm" ${ctx.state.autoNormalizeOnFinish ? 'checked' : ''} />
                <span>${es ? 'Normalizar al grabar (-1 dBFS)' : 'Normalize on record (-1 dBFS)'}</span>
              </label>
              <label class="batch-check" title="${es ? 'Detectar y capturar automáticamente la huella de ruido del suelo estacionario al finalizar cada grabación' : 'Automatically detect and capture stationary noise floor print when each recording finishes'}">
                <input type="checkbox" class="articulation-checkbox switch--sm" id="rec-chk-auto-noise" ${ctx.state.autoDetectNoiseOnFinish ? 'checked' : ''} />
                <span>${es ? 'Detectar Ruido (Auto)' : 'Detect Noise (Auto)'}</span>
              </label>

              <button type="button" class="btn btn-sm btn-outline" id="btn-rec-capture-noise" ${!st ? 'disabled' : ''} title="${es ? 'Detectar suelo de ruido automáticamente o capturar la zona seleccionada en la onda' : 'Auto-detect noise floor or capture selected region on waveform'}">
                ${ICONS.search} ${es ? 'Detectar Ruido / Huella' : 'Detect Noise / Print'}
              </button>
              <button type="button" class="btn btn-sm btn-outline" id="btn-rec-algo-denoise" ${!st ? 'disabled' : ''} title="${es ? 'Denoise Algorítmico: puerta espectral automática sobre el suelo estacionario + filtro DC + notch 50/60 Hz' : 'Algorithmic Denoise: auto spectral gate on stationary floor + DC filter + 50/60 Hz notch'}">
                ${ICONS.sliders} ${es ? 'Denoise Algorítmico' : 'Algorithmic Denoise'}
              </button>
              <button type="button" class="btn btn-sm btn-outline" id="btn-rec-dsp-denoise" ${!st ? 'disabled' : ''} title="${es ? 'Denoise basado en Huella de Ruido: sustracción espectral de 16 bandas usando la huella capturada + notch 50/60 Hz' : 'Noise Print Denoise: 16-band spectral subtraction using captured print + 50/60 Hz notch'}">
                ${ICONS.wave} ${es ? 'Denoise (Huella)' : 'Denoise (Print)'}
              </button>
              <button type="button" class="btn btn-sm btn-ai-accent" id="btn-rec-ai-enhance" ${!st ? 'disabled' : ''} title="${escHtml(recBweDecl.buttonTooltip)}">
                ${ICONS.sparkle} ${es ? 'Denoise IA' : 'AI Denoise'}
              </button>
              <button type="button" class="btn btn-sm btn-outline" id="btn-rec-normalize" ${!st ? 'disabled' : ''} title="${es ? 'Aplicar filtro DC Block y Normalización de Pico a -1.0 dBFS sobre la toma seleccionada' : 'Apply DC Block filter and Peak Normalization to -1.0 dBFS on selected take'}">
                ${ICONS.zap} ${es ? 'Normalizar (-1 dBFS + DC)' : 'Normalize (-1 dBFS + DC)'}
              </button>
            </div>

            <div class="nmm-recorder-dsp-right">
              <button type="button" class="btn btn-sm btn-outline" id="btn-rec-undo-take" ${!st || st.history.length === 0 ? 'disabled' : ''} title="${es ? 'Deshacer última edición en esta toma' : 'Undo last edit on this take'}">
                ${ICONS.undo} ${es ? 'Deshacer' : 'Undo'} (${st ? st.history.length : 0})
              </button>
              <button type="button" class="btn btn-sm btn-accent" id="btn-rec-play-sel" ${!st ? 'disabled' : ''} title="${es ? 'Escuchar región seleccionada (o toma completa)' : 'Audition selected region (or full take)'}">
                ${ICONS.play} ${hasSelection ? (es ? 'Oír Selección' : 'Play Selection') : (es ? 'Oír Toma' : 'Play Take')}
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    if (st) {
      ctx.drawTakeWaveform(st, mono, silences);
      ctx.bindWaveCanvasEvents(st, mono, silences);
    }
    bindLiveWindowButtons();

    container.querySelector('#rec-chk-auto-norm')?.addEventListener('change', (e) => {
      ctx.state.autoNormalizeOnFinish = (e.target as HTMLInputElement).checked;
    });
    container.querySelector('#rec-chk-auto-noise')?.addEventListener('change', (e) => {
      ctx.state.autoDetectNoiseOnFinish = (e.target as HTMLInputElement).checked;
      renderTakeInspector(ctx, );
    });
    container.querySelector('#sel-rec-denoise-mode')?.addEventListener('change', (e) => {
      const mode = (e.target as HTMLSelectElement).value as 'algorithmic' | 'noise_print' | 'ai';
      if (mode === 'algorithmic' || mode === 'noise_print' || mode === 'ai') {
        ctx.state.denoiseMode = mode;
        renderTakeInspector(ctx, );
      }
    });

    container.querySelector('#inp-rec-denoise-db')?.addEventListener('change', (e) => {
      const val = parseFloat((e.target as HTMLInputElement).value);
      if (Number.isFinite(val)) {
        ctx.state.denoiseReductionDb = Math.max(3, Math.min(36, val));
        const lbl = container.querySelector('#lbl-rec-denoise-db');
        if (lbl) lbl.textContent = `${ctx.state.denoiseReductionDb} dB`;
      }
    });

    if (st) {
      container
        .querySelector('#btn-rec-play-sel')
        ?.addEventListener('click', () => ctx.auditionSelectedRegion());
      container
        .querySelector('#btn-rec-capture-noise')
        ?.addEventListener('click', () => ctx.captureNoisePrintFromSelection(st.id));
      container
        .querySelector('#btn-rec-algo-denoise')
        ?.addEventListener('click', () => ctx.applyAlgorithmicDenoiseToTake(st.id));
      container
        .querySelector('#btn-rec-dsp-denoise')
        ?.addEventListener('click', () => ctx.applyDspDenoiseToTake(st.id));
      container
        .querySelector('#btn-rec-normalize')
        ?.addEventListener('click', () => ctx.applyNormalizeAndDcBlockToTake('peak', st.id));
      container
        .querySelector('#btn-rec-ai-enhance')
        ?.addEventListener('click', () => void ctx.applyAiEnhanceToTake(st.id));
      container
        .querySelector('#btn-rec-undo-take')
        ?.addEventListener('click', () => ctx.undoTakeEdit(st.id));
    }
  }

  /**
   * Fase 37.2: Dibuja en vivo la forma de onda desplazándose horizontalmente con
   * nivel de zoom constante (`ctx.state.liveWindowSec` segundos en el ancho del canvas),
   * de modo que nunca se achata a medida que avanza la grabación y permite ver
   * modulaciones de LFO/chorus y marcas vivas `NoteOn` / `NoteOff` / `TailEnd`.
   */

export function renderTakes(ctx: RecorderContext): void {
    const list = ctx.state.backdropEl?.querySelector('#rec-takes');
    const count = ctx.state.backdropEl?.querySelector('#rec-takes-count');
    if (!list) return;
    const es = isEs();
    if (count) count.textContent = String(ctx.state.takes.length);
    if (ctx.state.takes.length === 0) {
      list.innerHTML = `<div class="nmm-recorder-takes-empty">${es ? 'Aún no hay tomas — activa la entrada de audio y pulsa REC / INICIAR BARRIDO.' : 'No takes yet — enable audio input and press REC / START SWEEP.'}</div>`;
      return;
    }
    const activeId = ctx.getSelectedTake()?.id ?? null;
    list.innerHTML = ctx.state.takes
      .map((t) => {
        const cls = t.take.classification === 'unknown' ? (es ? 'sin clasificar' : 'unclassified') : t.take.classification;
        const isSelected = t.id === activeId;
        const sliceBadge = t.manifest
          ? `<span class="panel-badge badge-ai-on">${t.manifest.events.length} ${es ? 'cortes MIDI' : 'MIDI cuts'}</span>`
          : `<span class="panel-badge badge-ai-on">${escHtml(cls)} ${(t.take.classificationConfidence * 100).toFixed(0)}%</span>`;
        return `
        <div class="nmm-recorder-take${isSelected ? ' is-selected' : ''}" data-take-id="${escHtml(t.id)}">
          <span class="nmm-recorder-take-name">${escHtml(t.name)}</span>
          <span class="val-pill font-mono">${t.take.durationSec.toFixed(2)}s · ${t.take.peakDbfs.toFixed(1)} dBFS · ${(t.take.sampleRate / 1000).toFixed(0)}k</span>
          ${sliceBadge}
          <span class="nmm-recorder-take-actions">
            <button type="button" class="btn btn-xs btn-outline" data-act="audition" title="${es ? 'Escuchar toma' : 'Audition take'}">${ICONS.play}</button>
            <button type="button" class="btn btn-xs btn-outline" data-act="chopper" title="${es ? 'Enviar a Audio Chopper / AutoSlicer' : 'Send to Audio Chopper / AutoSlicer'}">${ICONS.scissors}</button>
            ${
              ctx.state.context.onInjectTakeIntoSession || ctx.state.context.onInjectAutoSampledInstrument
                ? `<button type="button" class="btn btn-xs btn-outline" data-act="inject" title="${es ? 'Inyectar en Sesión' : 'Inject into Session'}">${ICONS.plus}</button>`
                : ''
            }
            <button type="button" class="btn btn-xs btn-outline" data-act="download" title="${es ? 'Descargar WAV' : 'Download WAV'}">${ICONS.download}</button>
            <button type="button" class="btn btn-xs btn-outline" data-act="delete" title="${es ? 'Eliminar toma' : 'Delete take'}">${ICONS.trash}</button>
          </span>
        </div>`;
      })
      .join('');

    list.querySelectorAll<HTMLElement>('.nmm-recorder-take').forEach((row) => {
      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('button[data-act]')) return;
        const id = row.getAttribute('data-take-id');
        if (id) ctx.selectTake(id);
      });
    });

    list.querySelectorAll<HTMLButtonElement>('button[data-act]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const row = btn.closest('[data-take-id]');
        const id = row?.getAttribute('data-take-id');
        if (!id) return;
        const act = btn.getAttribute('data-act');
        if (act === 'audition') ctx.auditionTake(id);
        else if (act === 'chopper') ctx.sendTakeToChopper(id);
        else if (act === 'inject') ctx.injectTakeIntoSession(id);
        else if (act === 'download') ctx.downloadTake(id);
        else if (act === 'delete') ctx.deleteTake(id);
      });
    });
  }

  // ── Estado vivo: medidores + LCD + onda en vivo con zoom constante ────────


export function setBusy(ctx: RecorderContext, busy: boolean): void {
    ctx.state.backdropEl
      ?.querySelectorAll<HTMLButtonElement>('#btn-rec-enable-mic, #btn-rec-refresh-devices')
      .forEach((b) => {
        b.disabled = busy;
      });
  }


export function syncTransportState(ctx: RecorderContext): void {
    if (!ctx.state.backdropEl) return;
    const es = isEs();
    const state: RecorderState = ctx.state.capture.isOpen() ? ctx.state.capture.getState() : 'idle';
    const badge = ctx.state.backdropEl.querySelector('#rec-state-badge');
    if (badge) {
      badge.textContent = ctx.state.isSweepRunning ? (es ? 'BARRIENDO' : 'SWEEPING') : STATE_BADGE[state];
      badge.className = `panel-badge ${state === 'recording' || ctx.state.isSweepRunning ? 'badge-ai-on' : 'badge-muted'}`;
    }
    const dot = ctx.state.backdropEl.querySelector('#rec-state-dot');
    if (dot) {
      dot.className = `nmm-recorder-rec-dot${state === 'recording' || ctx.state.isSweepRunning ? ' is-rec' : ''}${state === 'paused' ? ' is-paused' : ''}`;
    }
    const recBtn = ctx.state.backdropEl.querySelector<HTMLButtonElement>('#btn-rec-record');
    if (recBtn) {
      const isAsSweep =
        ctx.state.operatingMode === 'midi_autosampler' &&
        ctx.state.autoSamplerConfig.mode !== 'live_midi_capture';
      recBtn.disabled = !ctx.state.capture.isOpen() && !isAsSweep;
      if (isAsSweep) {
        recBtn.innerHTML = ctx.state.isSweepRunning
          ? `${ICONS.pause} ${es ? 'PAUSAR BARRIDO' : 'PAUSE SWEEP'}`
          : `${ICONS.record} ${es ? 'INICIAR BARRIDO' : 'START SWEEP'}`;
      } else {
        recBtn.innerHTML =
          state === 'recording'
            ? `${ICONS.pause} ${es ? 'PAUSAR' : 'PAUSE'}`
            : state === 'paused'
              ? `${ICONS.play} ${es ? 'REANUDAR' : 'RESUME'}`
              : `${ICONS.record} REC`;
      }
    }
    const stopBtn = ctx.state.backdropEl.querySelector<HTMLButtonElement>('#btn-rec-stop');
    if (stopBtn) stopBtn.disabled = state !== 'recording' && state !== 'paused' && !ctx.state.isSweepRunning;
    const cancelBtn = ctx.state.backdropEl.querySelector<HTMLButtonElement>('#btn-rec-cancel');
    if (cancelBtn) cancelBtn.disabled = state !== 'recording' && state !== 'paused' && !ctx.state.isSweepRunning;
  }

