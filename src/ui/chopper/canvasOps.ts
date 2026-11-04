import { clamp } from '../../core/dsp/DspMath.ts';
import { computeZoomedWaveformEnvelope } from '../../core/dsp/LoopEditorTools.ts';
import { extractBoundaryFrames } from '../../core/dsp/AudioSlicerEngine.ts';
import type { ChopperContext } from './types.ts';
import { getThemeColors } from './themeOps.ts';

export function drawWaveformCanvas(ui: ChopperContext): void {
  if (!ui.state.backdropEl) return;
  ui.state.canvas = ui.state.backdropEl.querySelector('#chopper-waveform-canvas') as HTMLCanvasElement | null;
  if (!ui.state.canvas) return;
  const ctx = ui.state.canvas.getContext('2d');
  if (!ctx) return;

  const wrap = ui.state.backdropEl.querySelector('#chopper-canvas-wrap') as HTMLElement | null;
  const width = Math.max(300, Math.floor(wrap?.clientWidth || 880));
  const height = 160;
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  if (ui.state.canvas.width !== Math.floor(width * dpr) || ui.state.canvas.height !== Math.floor(height * dpr)) {
    ui.state.canvas.width = Math.floor(width * dpr);
    ui.state.canvas.height = Math.floor(height * dpr);
  }

  ctx.save();
  ctx.scale(dpr, dpr);

  const colors = getThemeColors();
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, width, height);

  const totalFrames = ui.state.pcm.length;
  if (totalFrames === 0) {
    ctx.restore();
    return;
  }

  const zoom = clamp(ui.state.zoomFactor, 1, 16);
  const windowFrames = Math.max(64, Math.round(totalFrames / zoom));
  const centerFrame = clamp(Math.round(ui.state.viewCenterNorm * totalFrames), 0, totalFrames);
  const viewStart = clamp(centerFrame - Math.floor(windowFrames * 0.5), 0, Math.max(0, totalFrames - windowFrames));
  const viewEnd = clamp(viewStart + windowFrames, viewStart + 1, totalFrames);
  const viewSpan = Math.max(1, viewEnd - viewStart);

  const frameToX = (frame: number) => ((frame - viewStart) / viewSpan) * width;

  // 1. Draw Slices Background Shading & Active Badges
  const slices = ui.state.currentResult?.slices ?? [];
  slices.forEach((sl, idx) => {
    const x1 = frameToX(sl.startFrame);
    const x2 = frameToX(sl.endFrame);
    if (x2 < 0 || x1 > width) return;

    const w = Math.max(1, x2 - x1);
    if (sl.isSilence) {
      ctx.fillStyle = colors.silence;
      ctx.fillRect(x1, 0, w, height);
    } else {
      const isSel = sl.id === ui.state.selectedSliceId;
      const isEven = idx % 2 === 0;
      ctx.fillStyle = isSel ? colors.sliceSel : isEven ? colors.sliceEven : colors.sliceOdd;
      ctx.fillRect(x1, 0, w, height);

      if (isSel) {
        const labelText = `#${sl.index} ${sl.label}`;
        ctx.font = 'bold 10px monospace';
        const textW = ctx.measureText(labelText).width;
        const badgeW = Math.min(Math.max(textW + 10, 48), Math.max(w, 48));

        ctx.fillStyle = colors.marker;
        ctx.fillRect(x1, 2, badgeW, 14);

        ctx.fillStyle = colors.bg;
        ctx.fillText(labelText, x1 + 5, 13);
      } else if (w >= 44) {
        ctx.fillStyle = colors.text;
        ctx.font = '10px monospace';
        const maxChars = Math.max(2, Math.floor((w - 8) / 7));
        const labelText = `#${sl.index} ${sl.label.slice(0, maxChars)}`;
        ctx.fillText(labelText, x1 + 4, 14);
      }
    }
  });

  // 2. Center Reference Line
  const centerY = height * 0.5;
  ctx.strokeStyle = colors.centerLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(width, centerY);
  ctx.stroke();

  // 3. Waveform Envelope (attenuated / dim color for silence intervals)
  const numPoints = Math.min(width, 600);
  const env = computeZoomedWaveformEnvelope(ui.state.pcm, viewStart, viewEnd, numPoints);
  const ampScale = height * 0.44;

  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, colors.waveform);
  grad.addColorStop(1, colors.waveformGradientEnd);

  const stepX = width / numPoints;
  for (let i = 0; i < numPoints; i++) {
    const x = i * stepX;
    const pointFrame = Math.round(viewStart + (i / numPoints) * viewSpan);
    const inSilence = slices.some((sl) => sl.isSilence && pointFrame >= sl.startFrame && pointFrame < sl.endFrame);

    ctx.fillStyle = inSilence ? colors.silenceWaveform : grad;

    const topY = centerY - (env.max[i] ?? 0) * ampScale;
    const botY = centerY - (env.min[i] ?? 0) * ampScale;
    const barH = Math.max(1, botY - topY);
    ctx.fillRect(x, topY, Math.max(1, stepX - 0.5), barH);
  }

  // 4. Diagonal Hatching & Disabled Overlay for Silence Slices
  slices.forEach((sl) => {
    if (!sl.isSilence) return;
    const x1 = frameToX(sl.startFrame);
    const x2 = frameToX(sl.endFrame);
    if (x2 < 0 || x1 > width) return;
    const w = Math.max(1, x2 - x1);

    ctx.save();
    ctx.beginPath();
    ctx.rect(x1, 0, w, height);
    ctx.clip();

    // Diagonal striped lines across silence area
    ctx.strokeStyle = colors.silenceStripe;
    ctx.lineWidth = 1.2;
    const spacing = 10;
    for (let lx = x1 - height; lx <= x1 + w; lx += spacing) {
      ctx.beginPath();
      ctx.moveTo(lx, height);
      ctx.lineTo(lx + height, 0);
      ctx.stroke();
    }

    // Dim "MUTED" badge
    if (w >= 36) {
      ctx.fillStyle = colors.silenceBadgeBg;
      ctx.fillRect(x1 + 4, 3, Math.min(w - 8, 48), 13);
      ctx.fillStyle = colors.silenceBadgeText;
      ctx.font = 'bold 9px monospace';
      ctx.fillText('MUTED', x1 + 8, 13);
    }

    ctx.restore();
  });

  // 5. Draw Boundary Lines with Amber Distinction for Manual Cuts & Handles
  const boundaries = extractBoundaryFrames(ui.state.currentResult || { slices: [] } as any, totalFrames);
  for (let bIdx = 1; bIdx < boundaries.length - 1; bIdx++) {
    const bFrame = boundaries[bIdx];
    const bx = frameToX(bFrame);
    if (bx < -5 || bx > width + 5) continue;

    const isManual = ui.isBoundaryManual(bFrame);
    const isHovered = bIdx === ui.state.hoveredBoundaryIndex || bIdx === ui.state.draggedBoundaryIndex;
    const isActive = bIdx === ui.state.activeBoundaryIndex;

    let lineColor: string;
    if (isHovered) {
      lineColor = isManual ? colors.markerManualHover : colors.markerHover;
    } else if (isActive) {
      lineColor = isManual ? colors.markerActiveManual : colors.markerActive;
    } else if (isManual) {
      lineColor = colors.markerManual;
    } else {
      lineColor = colors.marker;
    }

    ctx.strokeStyle = lineColor;
    ctx.lineWidth = isHovered || isActive ? 2.5 : isManual ? 2.0 : 1.5;

    ctx.beginPath();
    ctx.moveTo(bx, 0);
    ctx.lineTo(bx, height);
    ctx.stroke();

    // Top and bottom handles: diamond shape for manual cuts, triangle for auto cuts
    ctx.fillStyle = lineColor;
    if (isManual) {
      // Top diamond handle
      ctx.beginPath();
      ctx.moveTo(bx, 0);
      ctx.lineTo(bx + 5, 5);
      ctx.lineTo(bx, 10);
      ctx.lineTo(bx - 5, 5);
      ctx.closePath();
      ctx.fill();

      // Bottom diamond handle
      ctx.beginPath();
      ctx.moveTo(bx, height);
      ctx.lineTo(bx + 5, height - 5);
      ctx.lineTo(bx, height - 10);
      ctx.lineTo(bx - 5, height - 5);
      ctx.closePath();
      ctx.fill();
    } else {
      // Top triangle handle
      ctx.beginPath();
      ctx.moveTo(bx - 5, 0);
      ctx.lineTo(bx + 5, 0);
      ctx.lineTo(bx, 8);
      ctx.closePath();
      ctx.fill();

      // Bottom triangle handle
      ctx.beginPath();
      ctx.moveTo(bx - 5, height);
      ctx.lineTo(bx + 5, height);
      ctx.lineTo(bx, height - 8);
      ctx.closePath();
      ctx.fill();
    }
  }

  ctx.restore();
}

export function drawMagnifierCanvas(ui: ChopperContext): void {
  if (!ui.state.backdropEl) return;
  ui.state.magnifierCanvas = ui.state.backdropEl.querySelector('#chopper-magnifier-canvas') as HTMLCanvasElement | null;
  if (!ui.state.magnifierCanvas) return;
  const ctx = ui.state.magnifierCanvas.getContext('2d');
  if (!ctx) return;

  const wrap = ui.state.backdropEl.querySelector('#chopper-mag-canvas-wrap') as HTMLElement | null;
  const width = Math.max(200, Math.floor(wrap?.clientWidth || 880));
  const height = 84;
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  if (ui.state.magnifierCanvas.width !== Math.floor(width * dpr) || ui.state.magnifierCanvas.height !== Math.floor(height * dpr)) {
    ui.state.magnifierCanvas.width = Math.floor(width * dpr);
    ui.state.magnifierCanvas.height = Math.floor(height * dpr);
  }

  ctx.save();
  ctx.scale(dpr, dpr);

  const colors = getThemeColors();
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, width, height);

  if (ui.state.pcm.length === 0) {
    ctx.restore();
    return;
  }

  const cutFrame = ui.getActiveCutFrame();
  const isCutManual = ui.isBoundaryManual(cutFrame);
  const halfWindow = 256;
  const startFrame = cutFrame - halfWindow;
  const endFrame = cutFrame + halfWindow;
  const centerY = height * 0.5;

  // Check if the adjacent slice is silence to draw subtle background hatching
  const currentSlice = ui.state.currentResult?.slices.find(
    (s) => cutFrame >= s.startFrame && cutFrame <= s.endFrame
  );
  if (currentSlice?.isSilence) {
    ctx.save();
    ctx.fillStyle = colors.silence;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = colors.silenceStripe;
    ctx.lineWidth = 1.0;
    for (let lx = -height; lx <= width; lx += 12) {
      ctx.beginPath();
      ctx.moveTo(lx, height);
      ctx.lineTo(lx + height, 0);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Center zero reference line
  ctx.strokeStyle = colors.centerLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(width, centerY);
  ctx.stroke();

  // Waveform line for ±256 sample window
  const ampScale = height * 0.42;
  ctx.strokeStyle = currentSlice?.isSilence ? colors.silenceWaveform : colors.waveform;
  ctx.lineWidth = 1.5;
  ctx.beginPath();

  const totalSamples = endFrame - startFrame;
  for (let i = 0; i < totalSamples; i++) {
    const frame = startFrame + i;
    const x = (i / totalSamples) * width;
    const val = frame >= 0 && frame < ui.state.pcm.length ? ui.state.pcm[frame] : 0;
    const y = centerY - val * ampScale;

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();

  // Individual sample points
  ctx.fillStyle = currentSlice?.isSilence ? colors.silenceWaveform : colors.waveform;
  for (let i = 0; i < totalSamples; i += 4) {
    const frame = startFrame + i;
    const x = (i / totalSamples) * width;
    const val = frame >= 0 && frame < ui.state.pcm.length ? ui.state.pcm[frame] : 0;
    const y = centerY - val * ampScale;
    ctx.fillRect(x - 1, y - 1, 2, 2);
  }

  // Center Cut Line: warning token if manual, success token if auto
  const centerX = width * 0.5;
  const isDragging = ui.state.isDraggingMagnifier;
  const cutColor = isDragging ? colors.markerManual : isCutManual ? colors.markerManualHover : colors.markerActive;
  ctx.strokeStyle = cutColor;
  ctx.lineWidth = isDragging ? 3 : 2;
  ctx.setLineDash(isDragging ? [] : isCutManual ? [6, 2] : [4, 2]);
  ctx.beginPath();
  ctx.moveTo(centerX, 0);
  ctx.lineTo(centerX, height);
  ctx.stroke();
  ctx.setLineDash([]);

  // Cut point highlight dot
  const centerVal = cutFrame >= 0 && cutFrame < ui.state.pcm.length ? ui.state.pcm[cutFrame] : 0;
  const centerDotY = centerY - centerVal * ampScale;
  ctx.fillStyle = cutColor;
  ctx.beginPath();
  ctx.arc(centerX, centerDotY, isDragging ? 5 : 4, 0, Math.PI * 2);
  ctx.fill();

  // Top & Bottom Handles: diamond if manual, triangle if auto
  if (isCutManual) {
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX + 6, 6);
    ctx.lineTo(centerX, 12);
    ctx.lineTo(centerX - 6, 6);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(centerX, height);
    ctx.lineTo(centerX + 6, height - 6);
    ctx.lineTo(centerX, height - 12);
    ctx.lineTo(centerX - 6, height - 6);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(centerX - 6, 0);
    ctx.lineTo(centerX + 6, 0);
    ctx.lineTo(centerX, 9);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(centerX - 6, height);
    ctx.lineTo(centerX + 6, height);
    ctx.lineTo(centerX, height - 9);
    ctx.closePath();
    ctx.fill();
  }

  // Visual drag & mode hint
  ctx.font = '10px monospace';
  ctx.fillStyle = isDragging ? colors.markerManual : isCutManual ? colors.markerManualHover : colors.markerActive;
  const hintText = isDragging
    ? 'DRAGGING CUT POINT (MICRO-ADJUST)'
    : isCutManual
    ? 'MANUAL CUT POINT • DRAG OR NUDGE TO REFINE'
    : 'CLICK & DRAG TO MICRO-ADJUST CUT (±256 smp)';
  ctx.fillText(hintText, 10, 14);

  ctx.restore();
}
