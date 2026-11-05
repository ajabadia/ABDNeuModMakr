import type { RecorderContext } from './types.ts';
import type { SessionTake } from './types.ts';
import { formatTakeTime } from './recorderUtils.ts';
import type { SilenceRange } from '@abdsynths/shared/dsp/take/takeDsp.ts';

export function drawLiveScrollingWaveform(ctx: RecorderContext, 
    recentMono: Float32Array,
    sampleRate: number,
    totalRecordedFrames: number
  ): void {
    const canvas = ctx.state.backdropEl?.querySelector<HTMLCanvasElement>('#rec-wave-canvas');
    if (!canvas) return;
    const g2d = canvas.getContext('2d');
    if (!g2d) return;

    const w = canvas.width;
    const h = canvas.height;
    const midY = h / 2;
    const styles = getComputedStyle(document.documentElement);
    const bgColor = styles.getPropertyValue('--color-lcd-bg').trim() || 'transparent';
    const waveColor = styles.getPropertyValue('--color-accent').trim() || 'currentColor';
    const okColor = styles.getPropertyValue('--color-success').trim() || waveColor;
    const warnColor = styles.getPropertyValue('--color-warning').trim() || waveColor;
    const borderColor = styles.getPropertyValue('--color-panel-border-dim').trim() || 'currentColor';

    g2d.fillStyle = bgColor;
    g2d.fillRect(0, 0, w, h);

    g2d.strokeStyle = borderColor;
    g2d.lineWidth = 1;
    g2d.beginPath();
    g2d.moveTo(0, midY);
    g2d.lineTo(w, midY);
    g2d.stroke();

    const windowFrames = Math.max(1, Math.round(ctx.state.liveWindowSec * sampleRate));
    const windowStartFrame = Math.max(0, totalRecordedFrames - windowFrames);

    // Si aún se ha grabado menos que la ventana completa, empieza por la izquierda y avanza hasta llenarla; luego desplaza la ventana
    const activeSpanFrames = Math.min(windowFrames, recentMono.length);
    if (activeSpanFrames > 0) {
      g2d.strokeStyle = waveColor;
      g2d.lineWidth = 1.2;
      g2d.beginPath();

      for (let x = 0; x < w; x++) {
        const fRelStart = Math.floor((x / w) * windowFrames);
        if (fRelStart >= activeSpanFrames) break;
        const fRelEnd = Math.min(
          activeSpanFrames,
          Math.max(fRelStart + 1, Math.floor(((x + 1) / w) * windowFrames))
        );
        let min = 0;
        let max = 0;
        for (let i = fRelStart; i < fRelEnd; i++) {
          const v = recentMono[i];
          if (v < min) min = v;
          if (v > max) max = v;
        }
        const yTop = midY - max * (midY - 4);
        const yBot = midY - min * (midY - 4);
        g2d.moveTo(x, yTop);
        g2d.lineTo(x, Math.max(yTop + 1, yBot));
      }
      g2d.stroke();
    }

    // Marcas vivas de NoteOn (verde), NoteOff (ámbar) y TailEnd (cian) dentro de la ventana visible
    const visibleFrameBase = totalRecordedFrames > windowFrames ? windowStartFrame : 0;
    for (const mk of ctx.state.liveMarkers) {
      if (mk.frame < visibleFrameBase || mk.frame > visibleFrameBase + windowFrames) continue;
      const x = ((mk.frame - visibleFrameBase) / windowFrames) * w;
      g2d.strokeStyle =
        mk.kind === 'noteOn' ? okColor : mk.kind === 'noteOff' ? warnColor : waveColor;
      g2d.lineWidth = 1.5;
      g2d.beginPath();
      g2d.moveTo(x, 0);
      g2d.lineTo(x, h);
      g2d.stroke();

      if (mk.kind === 'noteOn' && mk.label) {
        g2d.fillStyle = okColor;
        g2d.font = '10px monospace';
        g2d.fillText(mk.label, Math.min(w - 60, x + 3), 12);
      }
    }
  }


export function drawTakeWaveform(ctx: RecorderContext, 
    st: SessionTake,
    mono: Float32Array,
    silences: SilenceRange[]
  ): void {
    const canvas = ctx.state.backdropEl?.querySelector<HTMLCanvasElement>('#rec-wave-canvas');
    if (!canvas) return;
    const g2d = canvas.getContext('2d');
    if (!g2d) return;

    const w = canvas.width;
    const h = canvas.height;
    const midY = h / 2;
    const styles = getComputedStyle(document.documentElement);
    const bgColor = styles.getPropertyValue('--color-lcd-bg').trim() || 'transparent';
    const waveColor = styles.getPropertyValue('--color-accent').trim() || 'currentColor';
    const okColor = styles.getPropertyValue('--color-success').trim() || waveColor;
    const warnColor = styles.getPropertyValue('--color-warning').trim() || 'currentColor';
    const aiColor = styles.getPropertyValue('--color-ai').trim() || waveColor;
    const borderColor = styles.getPropertyValue('--color-panel-border-dim').trim() || 'currentColor';

    g2d.fillStyle = bgColor;
    g2d.fillRect(0, 0, w, h);

    g2d.strokeStyle = borderColor;
    g2d.lineWidth = 1;
    g2d.beginPath();
    g2d.moveTo(0, midY);
    g2d.lineTo(w, midY);
    g2d.stroke();

    if (mono.length === 0) return;

    // 1. Sombrear rangos de silencio detectados automáticamente
    g2d.fillStyle = warnColor;
    g2d.globalAlpha = 0.14;
    for (const r of silences) {
      const x0 = (r.startFrame / mono.length) * w;
      const x1 = (r.endFrame / mono.length) * w;
      g2d.fillRect(x0, 0, Math.max(2, x1 - x0), h);
    }
    g2d.globalAlpha = 1.0;

    // 2. Dibujar envolvente de onda
    g2d.strokeStyle = waveColor;
    g2d.lineWidth = 1.2;
    g2d.beginPath();
    const step = Math.max(1, Math.floor(mono.length / w));
    for (let x = 0; x < w; x++) {
      const fStart = Math.floor((x / w) * mono.length);
      const fEnd = Math.min(mono.length, fStart + step);
      let min = 0;
      let max = 0;
      for (let i = fStart; i < fEnd; i++) {
        const v = mono[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const yTop = midY - max * (midY - 4);
      const yBot = midY - min * (midY - 4);
      g2d.moveTo(x, yTop);
      g2d.lineTo(x, Math.max(yTop + 1, yBot));
    }
    g2d.stroke();

    // 3. Si el take tiene manifiesto AutoSampler, dibujar sus puntos de corte (NoteOn, NoteOff, TailEnd)
    if (st.manifest && st.manifest.events.length > 0) {
      const offsetFrames = Math.round(
        (ctx.state.autoSamplerConfig.extraLatencyOffsetMs / 1000) * st.take.sampleRate
      );
      for (const ev of st.manifest.events) {
        if (ev.tailEndFrame <= ev.noteOnFrame) continue;
        const fOn = Math.max(0, Math.min(mono.length, ev.noteOnFrame + offsetFrames));
        const fOff = Math.max(fOn, Math.min(mono.length, ev.noteOffFrame + offsetFrames));
        const fEnd = Math.max(fOff, Math.min(mono.length, ev.tailEndFrame + offsetFrames));

        const xOn = (fOn / mono.length) * w;
        const xOff = (fOff / mono.length) * w;
        const xEnd = (fEnd / mono.length) * w;

        // NoteOn (verde)
        g2d.strokeStyle = okColor;
        g2d.lineWidth = 1.5;
        g2d.beginPath();
        g2d.moveTo(xOn, 0);
        g2d.lineTo(xOn, h);
        g2d.stroke();

        // NoteOff (ámbar)
        g2d.strokeStyle = warnColor;
        g2d.lineWidth = 1;
        g2d.beginPath();
        g2d.moveTo(xOff, 0);
        g2d.lineTo(xOff, h);
        g2d.stroke();

        // TailEnd (cian)
        g2d.strokeStyle = waveColor;
        g2d.lineWidth = 1;
        g2d.beginPath();
        g2d.moveTo(xEnd, 0);
        g2d.lineTo(xEnd, h);
        g2d.stroke();

        g2d.fillStyle = okColor;
        g2d.font = '10px monospace';
        g2d.fillText(
          `${ev.customName || ev.noteName} v${ev.velocity}`,
          Math.min(w - 54, xOn + 3),
          12
        );
      }
    }

    // 4. Dibujar selección de región de ruido (Noise Print)
    if (
      st.selectionStartFrame !== null &&
      st.selectionEndFrame !== null &&
      st.selectionEndFrame > st.selectionStartFrame
    ) {
      const x0 = (st.selectionStartFrame / mono.length) * w;
      const x1 = (st.selectionEndFrame / mono.length) * w;
      g2d.fillStyle = aiColor;
      g2d.globalAlpha = 0.25;
      g2d.fillRect(x0, 0, Math.max(2, x1 - x0), h);
      g2d.globalAlpha = 1.0;

      g2d.strokeStyle = aiColor;
      g2d.lineWidth = 1.5;
      g2d.strokeRect(x0, 1, Math.max(2, x1 - x0), h - 2);
    }
  }


export function bindWaveCanvasEvents(ctx: RecorderContext, 
    st: SessionTake,
    mono: Float32Array,
    silences: SilenceRange[]
  ): void {
    const canvas = ctx.state.backdropEl?.querySelector<HTMLCanvasElement>('#rec-wave-canvas');
    if (!canvas || mono.length === 0) return;

    const frameFromEvent = (ev: MouseEvent): number => {
      const rect = canvas.getBoundingClientRect();
      const norm = Math.max(0, Math.min(1, (ev.clientX - rect.left) / Math.max(1, rect.width)));
      return Math.round(norm * mono.length);
    };

    canvas.addEventListener('mousedown', (ev) => {
      ctx.state.isDraggingSelection = true;
      ctx.state.dragAnchorFrame = frameFromEvent(ev);
      st.selectionStartFrame = ctx.state.dragAnchorFrame;
      st.selectionEndFrame = ctx.state.dragAnchorFrame;
      drawTakeWaveform(ctx, st, mono, silences);
    });

    canvas.addEventListener('mousemove', (ev) => {
      if (!ctx.state.isDraggingSelection) return;
      const curr = frameFromEvent(ev);
      st.selectionStartFrame = Math.min(ctx.state.dragAnchorFrame, curr);
      st.selectionEndFrame = Math.max(ctx.state.dragAnchorFrame, curr);
      drawTakeWaveform(ctx, st, mono, silences);
    });

    const finishDrag = (ev: MouseEvent) => {
      if (!ctx.state.isDraggingSelection) return;
      ctx.state.isDraggingSelection = false;
      const curr = frameFromEvent(ev);
      const start = Math.min(ctx.state.dragAnchorFrame, curr);
      const end = Math.max(ctx.state.dragAnchorFrame, curr);

      if (end - start < 32) {
        const clickedSilence = silences.find(
          (r) => curr >= r.startFrame && curr <= r.endFrame
        );
        if (clickedSilence) {
          st.selectionStartFrame = clickedSilence.startFrame;
          st.selectionEndFrame = clickedSilence.endFrame;
        } else {
          st.selectionStartFrame = null;
          st.selectionEndFrame = null;
        }
      } else {
        st.selectionStartFrame = start;
        st.selectionEndFrame = end;
      }
      ctx.renderTakeInspector();
    };

    canvas.addEventListener('mouseup', finishDrag);
    canvas.addEventListener('mouseleave', (ev) => {
      if (ctx.state.isDraggingSelection) finishDrag(ev);
    });
  }


export function startMeterLoop(ctx: RecorderContext): void {
    const tick = () => {
      if (!ctx.state.backdropEl) return;
      if (ctx.state.capture.isOpen()) {
        void ctx.state.capture.open().then((engine) => {
          if (!ctx.state.backdropEl) return;
          const levels = engine.getLevels();
          const l = ctx.state.backdropEl.querySelector<HTMLElement>('#rec-meter-l');
          const r = ctx.state.backdropEl.querySelector<HTMLElement>('#rec-meter-r');
          if (l) l.style.width = `${Math.min(100, Math.max(0, levels.peakLeft * 100)).toFixed(1)}%`;
          if (r) r.style.width = `${Math.min(100, Math.max(0, levels.peakRight * 100)).toFixed(1)}%`;
          const recSec = engine.getRecordedSec();
          const time = ctx.state.backdropEl.querySelector('#rec-lcd-time');
          if (time) time.textContent = formatTakeTime(recSec);
          const peak = ctx.state.backdropEl.querySelector('#rec-peak-pill');
          if (peak) {
            peak.textContent =
              levels.peakDbfs === -Infinity ? '−∞ dBFS' : `${levels.peakDbfs.toFixed(1)} dBFS`;
          }

          // Fase 37.2: Si está grabando en este momento, dibujar la forma de onda desplazándose con zoom constante
          if (engine.getState() === 'recording') {
            const sr = engine.getSampleRate();
            const winFrames = Math.max(128, Math.round(ctx.state.liveWindowSec * sr));
            const recentMono = engine.getRecentMonoSamples(winFrames);
            const totalFrames = Math.round(recSec * sr);
            drawLiveScrollingWaveform(ctx, recentMono, sr, totalFrames);
            if (ctx.state.liveTracker) {
              ctx.state.liveTracker.pollReleaseTails(recentMono);
            }
          }

          ctx.syncTransportState();
        });
      }
      ctx.state.rafId = requestAnimationFrame(tick);
    };
    ctx.state.rafId = requestAnimationFrame(tick);
  }
