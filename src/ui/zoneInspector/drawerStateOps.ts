import { formatRegionModeBadge } from './zoneTemplates.ts';
import { midiNoteToString, volumeToLongString } from '../ZoneRibbon.ts';
import { escHtml } from '../escape.ts';
import { getThemeColor } from '../ZoneInspector.ts';
import type { InspectorContext } from './types.ts';
import { midiToNoteName, detuneToString, panToString } from '../ZoneRibbon';
import { basenameOf } from './zoneTemplates.ts';
import { formatGmDrumLabel } from '../../core/gmDrumMap';
import { computeZoomedWaveformEnvelope } from '../../core/dsp/LoopEditorTools';


export function syncActiveDom(ui: InspectorContext): void {
  if (!ui.state.currentZone) return;
  if (ui.state.workingMode === 'extended') {
    const { activeRegion } = ui.getExtendedContext();
    if (activeRegion) {
      if (ui.state.drawerElement) {
        const dispLow = ui.state.drawerElement.querySelector('#disp-low-note');
        const dispRoot = ui.state.drawerElement.querySelector('#disp-root-note');
        const dispHigh = ui.state.drawerElement.querySelector('#disp-high-note');
        const dispVelSpan = ui.state.drawerElement.querySelector('#disp-vel-span');
        if (dispLow) dispLow.textContent = midiToNoteName(activeRegion.lowKey);
        if (dispRoot) dispRoot.textContent = midiToNoteName(activeRegion.rootKey);
        if (dispHigh) dispHigh.textContent = midiToNoteName(activeRegion.highKey);
        if (dispVelSpan) {
          const spanSteps = Math.max(1, activeRegion.highVel - activeRegion.lowVel + 1);
          dispVelSpan.textContent = `Vel ${activeRegion.lowVel}..${activeRegion.highVel} (${spanSteps})`;
        }

        const valDetune = ui.state.drawerElement.querySelector('#val-detune');
        const valVolume = ui.state.drawerElement.querySelector('#val-volume');
        const valPan = ui.state.drawerElement.querySelector('#val-pan');
        if (valDetune) valDetune.textContent = detuneToString(activeRegion.detune);
        if (valVolume) valVolume.textContent = volumeToLongString(activeRegion.volume);
        if (valPan) valPan.textContent = panToString(activeRegion.pan);

        if (!ui.state.isDraggingKnob) {
          ui.state.detuneKnob?.setValue((Math.round(activeRegion.detune) + 99) / 198);
          ui.state.volumeKnob?.setValue((Math.round(activeRegion.volume) + 32) / 44);
          ui.state.panKnob?.setValue((Math.round(activeRegion.pan) + 50) / 100);
        }
      }

      const activeRow = ui.state.container.querySelector(
        `tr.zone-table-row[data-region-id="${activeRegion.id}"]`
      );
      if (activeRow) {
        const cells = activeRow.querySelectorAll('td');
        if (cells.length >= 11) {
          const sampleBase = basenameOf(activeRegion.sampleName);
          cells[1].textContent = midiNoteToString(activeRegion.lowKey);
          cells[2].className =
            'col-key is-root' + (ui.state.keyMappingMode === 'drum' ? ' is-drum-piece' : '');
          cells[2].innerHTML =
            ui.state.keyMappingMode === 'drum'
              ? `<span class="drum-piece-text">${escHtml(formatGmDrumLabel(activeRegion.rootKey))}</span>`
              : midiNoteToString(activeRegion.rootKey);
          cells[3].textContent = midiNoteToString(activeRegion.highKey);
          cells[4].textContent = '';
          cells[4].innerHTML = `<span class="cell-vel-tag">${activeRegion.lowVel}</span>`;
          cells[5].innerHTML = `<span class="cell-vel-tag">${activeRegion.highVel}</span>`;
          cells[6].innerHTML = sampleBase
            ? `<span class="cell-sample-name">${escHtml(sampleBase)}</span>`
            : `<span class="cell-empty-dash">—</span>`;
          cells[7].innerHTML = `<span class="cell-vel-tag">${formatRegionModeBadge(activeRegion)}</span>`;
          cells[8].textContent = detuneToString(activeRegion.detune);
          cells[9].textContent = volumeToLongString(activeRegion.volume);
          cells[10].textContent = panToString(activeRegion.pan);
        }
      }
      return;
    }
  }

  const z = ui.state.currentZone;
  if (ui.state.drawerElement) {
    const dispLow = ui.state.drawerElement.querySelector('#disp-low-note');
    const dispRoot = ui.state.drawerElement.querySelector('#disp-root-note');
    const dispHigh = ui.state.drawerElement.querySelector('#disp-high-note');
    if (dispLow) dispLow.textContent = midiToNoteName(z.lowKey);
    if (dispRoot) dispRoot.textContent = midiToNoteName(z.rootKey);
    if (dispHigh) dispHigh.textContent = midiToNoteName(z.highKey);

    const valDetune = ui.state.drawerElement.querySelector('#val-detune');
    const valVolume = ui.state.drawerElement.querySelector('#val-volume');
    const valPan = ui.state.drawerElement.querySelector('#val-pan');
    if (valDetune) valDetune.textContent = detuneToString(z.detune);
    if (valVolume) valVolume.textContent = volumeToLongString(z.volume);
    if (valPan) valPan.textContent = panToString(z.pan);

    if (!ui.state.isDraggingKnob) {
      ui.state.detuneKnob?.setValue((Math.round(z.detune) + 99) / 198);
      ui.state.volumeKnob?.setValue((Math.round(z.volume) + 32) / 44);
      ui.state.panKnob?.setValue((Math.round(z.pan) + 50) / 100);
    }
  }

  // Update the active row cells in the canonical Zone Table
  const activeRow = ui.state.container.querySelector(
    `tr.zone-table-row[data-zone-id="${z.id}"]`
  );
  if (activeRow) {
    const cells = activeRow.querySelectorAll('td');
    if (cells.length >= 9) {
      const hasHigh = Boolean(z.sampleHigh);
      const rowSplit = Math.max(2, Math.min(127, z.velSplit ?? 64));
      const lowVelName = basenameOf(z.sampleLow);
      const highVelName = basenameOf(z.sampleHigh);
      cells[1].textContent = midiNoteToString(z.lowKey);
      cells[2].className =
        'col-key is-root' + (ui.state.keyMappingMode === 'drum' ? ' is-drum-piece' : '');
      cells[2].innerHTML =
        ui.state.keyMappingMode === 'drum'
          ? `<span class="drum-piece-text">${escHtml(formatGmDrumLabel(z.rootKey))}</span>`
          : midiNoteToString(z.rootKey);
      cells[3].textContent = midiNoteToString(z.highKey);
      cells[4].innerHTML = lowVelName
        ? `<span class="cell-vel-tag">1–${hasHigh ? rowSplit - 1 : 127}</span> <span class="cell-sample-name">${escHtml(lowVelName)}</span>`
        : `<span class="cell-empty-dash">—</span>`;
      cells[5].innerHTML = highVelName
        ? `<span class="cell-vel-tag">${rowSplit}–127</span> <span class="cell-sample-name">${escHtml(highVelName)}</span>`
        : `<span class="cell-empty-dash">—</span>`;
      cells[6].textContent = detuneToString(z.detune);
      cells[7].textContent = volumeToLongString(z.volume);
      cells[8].textContent = panToString(z.pan);
    }
  }
}

export function applyNoteHighlights(ui: InspectorContext, scrollIntoView: boolean): void {
  const isExtended = ui.state.workingMode === 'extended';
  ui.state.container
    .querySelectorAll('.is-note-active, .is-note-layer-active')
    .forEach((el) => el.classList.remove('is-note-active', 'is-note-layer-active'));
  if (ui.state.activeNoteHits.size === 0) return;

  let firstRow: HTMLElement | null = null;
  for (const hit of ui.state.activeNoteHits.values()) {
    if (isExtended) {
      for (const regId of hit.regionIds) {
        const row = ui.state.container.querySelector<HTMLElement>(
          `tr.zone-table-row[data-region-id="${CSS.escape(regId)}"]`
        );
        if (!row) continue;
        row.classList.add('is-note-active');
        row.querySelector('.col-sample')?.classList.add('is-note-layer-active');
        firstRow ??= row;
      }
    } else if (hit.zoneId) {
      const row = ui.state.container.querySelector<HTMLElement>(
        `tr.zone-table-row[data-zone-id="${CSS.escape(hit.zoneId)}"]:not([data-region-id])`
      );
      if (!row) continue;
      row.classList.add('is-note-active');
      row
        .querySelector(`td[data-vel-layer="${hit.layer ?? 'low'}"]`)
        ?.classList.add('is-note-layer-active');
      firstRow ??= row;
    }
  }

  if (scrollIntoView && firstRow) {
    const scroller = firstRow.closest<HTMLElement>('.zone-table-scroll');
    if (scroller) {
      const sRect = scroller.getBoundingClientRect();
      const rRect = firstRow.getBoundingClientRect();
      const head = scroller.querySelector('thead')?.getBoundingClientRect().height ?? 0;
      if (rRect.top < sRect.top + head) {
        scroller.scrollTop -= sRect.top + head - rRect.top;
      } else if (rRect.bottom > sRect.bottom) {
        scroller.scrollTop += rRect.bottom - sRect.bottom;
      }
    }
  }
}

export function drawDrawerPreviewWaveform(ui: InspectorContext): void {
  if (!ui.state.drawerElement) return;
  const canvas = ui.state.drawerElement.querySelector('#drawer-preview-waveform-canvas') as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const isExtended = ui.state.workingMode === 'extended';
  const activeReg = isExtended ? ui.getExtendedContext().activeRegion : null;
  const d =
    ui.state.handlers.getLoopEditorData?.(ui.state.currentZone?.id, activeReg?.id) ??
    null;

  const rect = canvas.getBoundingClientRect();
  const width = Math.max(300, Math.floor(rect.width || 560));
  const height = Math.max(50, Math.floor(rect.height || 64));
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
  }

  ctx.save();
  ctx.scale(dpr, dpr);

  const themeBg = getThemeColor('--color-panel-surface', '#151f2e');
  const themeMuted = getThemeColor('--color-text-muted', '#7e9bb5');
  const themeAccent = getThemeColor('--color-accent', '#00c3ff');
  const themeWarning = getThemeColor('--color-warning', '#ffaa00');
  const themeAccentRgb = getThemeColor('--color-accent-rgb', '0, 195, 255');
  const themeMono = getThemeColor('--font-mono', 'monospace');

  // Background
  ctx.fillStyle = themeBg;
  ctx.fillRect(0, 0, width, height);

  if (!d || !d.monoPcm || d.monoPcm.length === 0) {
    ctx.fillStyle = themeMuted;
    ctx.font = `11px ${themeMono}`;
    ctx.fillText('No sample audio buffer loaded', 14, height * 0.55);
    ctx.restore();
    return;
  }

  // Grid center line
  const centerY = height * 0.5;
  ctx.strokeStyle = `rgba(${themeAccentRgb}, 0.15)`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(width, centerY);
  ctx.stroke();

  // Loop region highlight if loop exists
  if (d.loopEnd > d.loopStart && d.totalFrames > 0) {
    const loopStartX = (d.loopStart / d.totalFrames) * width;
    const loopEndX = (d.loopEnd / d.totalFrames) * width;
    ctx.fillStyle = `rgba(${themeAccentRgb}, 0.14)`;
    ctx.fillRect(loopStartX, 0, loopEndX - loopStartX, height);

    // Loop start line
    ctx.strokeStyle = themeAccent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(loopStartX, 0);
    ctx.lineTo(loopStartX, height);
    ctx.stroke();

    // Loop end line
    ctx.strokeStyle = themeWarning;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(loopEndX, 0);
    ctx.lineTo(loopEndX, height);
    ctx.stroke();
  }

  // Waveform envelope
  const numPoints = Math.min(width, 400);
  const env = computeZoomedWaveformEnvelope(d.monoPcm, 0, d.totalFrames, numPoints);
  const ampScale = height * 0.44;

  // Draw gradient waveform bars / fill
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, `rgba(${themeAccentRgb}, 0.45)`);
  grad.addColorStop(0.5, `rgba(${themeAccentRgb}, 0.8)`);
  grad.addColorStop(1, `rgba(${themeAccentRgb}, 1)`);

  ctx.fillStyle = grad;
  const stepX = width / numPoints;
  for (let i = 0; i < numPoints; i++) {
    const x = i * stepX;
    const maxVal = env.max[i] ?? 0;
    const minVal = env.min[i] ?? 0;
    const topY = centerY - maxVal * ampScale;
    const botY = centerY - minVal * ampScale;
    const barH = Math.max(1.5, botY - topY);
    ctx.fillRect(x, topY, Math.max(1, stepX - 0.5), barH);
  }

  ctx.restore();
}
