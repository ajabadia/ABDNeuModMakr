import { getAppLocale } from '../../core/i18n.ts';
import type { ZoneInspectorHandlers } from '../ZoneInspector.ts';
import { escHtml } from '../escape.ts';
import { midiNoteToString, volumeToLongString } from '../ZoneRibbon.ts';
import { analyzeDrumCollisions } from '../../core/gmDrumMap.ts';
import { analyzeExtendedIntersections } from '../../core/extendedAdapter.ts';
import type { InspectorContext } from './types.ts';
import { drawDrawerPreviewWaveform } from './drawerStateOps.ts';
import { analyzeClassicZoneOverlaps } from '../../core/extendedAdapter';
import { ICONS } from '../icons';
import { escAttr } from '../escape';
import { basenameOf } from './zoneTemplates.ts';
import { formatBytes } from '../../core/pathUtils.ts';
import { formatGmDrumLabel } from '../../core/gmDrumMap';
import { midiToNoteName, detuneToString, panToString } from '../ZoneRibbon';

export function renderDrawer(ui: InspectorContext): void {
  ui.destroyZoneKnobs();
  if (!ui.state.drawerElement || !ui.state.currentZone) return;
  const isEs = getAppLocale() === 'es';
  const z = ui.state.currentZone;
  const zonesList = ui.state.allZones.length > 0 ? ui.state.allZones : [z];
  const prevZone = ui.state.zoneIndex > 0 ? zonesList[ui.state.zoneIndex - 1] : null;
  const nextZone = ui.state.zoneIndex < zonesList.length - 1 ? zonesList[ui.state.zoneIndex + 1] : null;
  const minLowKey = prevZone ? prevZone.lowKey + 1 : 0;
  const maxLowKey = prevZone ? z.highKey : 0;
  const minHighKey = nextZone ? z.lowKey : 127;
  const maxHighKey = nextZone ? nextZone.highKey - 1 : 127;
  const hasHighVel = Boolean(z.sampleHigh);
  const split = Math.max(2, Math.min(127, z.velSplit ?? 64));
  const isExtended = ui.state.workingMode === 'extended';
  const loadedSamples = ui.state.handlers.getLoadedSamples?.() ?? [];

  const extCtx = isExtended ? ui.getExtendedContext() : null;
  const extRegions = extCtx?.regions ?? [];
  const activeReg = extCtx?.activeRegion ?? null;
  const activeRegIdx = extCtx?.activeIndex ?? 0;

  // Overlap analysis for active region / zone
  const extOverlaps = isExtended ? analyzeExtendedIntersections(extRegions) : null;
  const regOverlapInfo =
    isExtended && activeReg && extOverlaps
      ? extOverlaps.byRegionId[activeReg.id]
      : undefined;
  const classicOverlaps = !isExtended ? analyzeClassicZoneOverlaps(zonesList) : null;
  const zoneOverlapPeers =
    !isExtended && classicOverlaps
      ? classicOverlaps[z.id]?.overlappingZones ?? []
      : [];

  let drumCollisionDrawerAlertHtml = '';
  if (ui.state.keyMappingMode === 'drum') {
    const itemsForColl = isExtended
      ? extRegions.map((r) => ({
          id: r.id,
          lowKey: r.lowKey,
          highKey: r.highKey,
          rootKey: r.rootKey,
          lowVel: r.lowVel,
          highVel: r.highVel,
        }))
      : zonesList.map((zn) => ({
          id: zn.id,
          lowKey: zn.lowKey,
          highKey: zn.highKey,
          rootKey: zn.rootKey,
          lowVel: 1,
          highVel: 127,
        }));
    const collReport = analyzeDrumCollisions(itemsForColl);
    const activeItemId = isExtended && activeReg ? activeReg.id : z.id;
    const cInfo = collReport.collisionMap[activeItemId];
    if (cInfo) {
      const peerNames = cInfo.peerIndices.map((i) => `${isExtended ? (isEs ? 'Región' : 'Region') : (isEs ? 'Zona' : 'Zone')} #${i}`).join(', ');
      drumCollisionDrawerAlertHtml = `
        <div class="drum-collision-alert">
          <span class="alert-icon">${ICONS.alert}</span>
          <div class="alert-content">
            <strong>${isEs ? '¡Colisión de Percusión GM Detectada!' : 'GM Drum Collision Detected!'}</strong>
            <div>${isEs ? `La pieza de batería <strong>${escHtml(cInfo.drumLabel)}</strong> también está mapeada en ${peerNames} con velocidad solapada. Cambia la pieza o ajusta las capas de velocidad para evitar conflictos de reproducción.` : `Drum piece <strong>${escHtml(cInfo.drumLabel)}</strong> is also mapped to ${peerNames} with overlapping velocity. Change drum piece or adjust velocity layers to avoid playback conflict.`}</div>
          </div>
        </div>
      `;
    }
  }

  const currentPrimarySample =
    isExtended && activeReg ? activeReg.sampleName : z.sampleLow;
  const lowOptionsHtml = [
    `<option value="">${isEs ? '-- Seleccionar Muestra Cargada --' : '-- Select Loaded Sample --'}</option>`,
    ...loadedSamples.map(
      (s) =>
        `<option value="${escAttr(s)}" ${currentPrimarySample === s ? 'selected' : ''}>${escHtml(basenameOf(s))}</option>`
    ),
  ].join('');
  const highOptionsHtml = [
    `<option value="">${isEs ? '-- Ninguna (Low Vel cubre 1..127) --' : '-- None (Low Vel covers 1..127) --'}</option>`,
    ...loadedSamples.map(
      (s) =>
        `<option value="${escAttr(s)}" ${z.sampleHigh === s ? 'selected' : ''}>${escHtml(basenameOf(s))}</option>`
    ),
  ].join('');

  const effLowKey = isExtended && activeReg ? activeReg.lowKey : z.lowKey;
  const effRootKey = isExtended && activeReg ? activeReg.rootKey : z.rootKey;
  const effHighKey = isExtended && activeReg ? activeReg.highKey : z.highKey;
  const effDetune = isExtended && activeReg ? activeReg.detune : z.detune;
  const effVolume = isExtended && activeReg ? activeReg.volume : z.volume;
  const effPan = isExtended && activeReg ? activeReg.pan : z.pan;

  const effFmtInfo = ui.state.handlers.getZoneSampleFormatInfo?.(z.id, activeReg?.id) ?? null;

  const formatByteSize = (bytes?: number): string => {
    if (!bytes || bytes <= 0) return '—';
    return formatBytes(bytes);
  };

  const renderTechSpecsBox = (info: NonNullable<ReturnType<NonNullable<ZoneInspectorHandlers['getZoneSampleFormatInfo']>>>) => {
    if (!info) return '';
    const chLabel =
      info.numChannels === 4
        ? '4.0 Quad'
        : info.numChannels === 2
          ? (isEs ? '2.0 Estéreo' : '2.0 Stereo')
          : info.numChannels === 1
            ? '1.0 Mono'
            : `${info.numChannels} ch`;
    const resLabel = `${info.bitsPerSample}-bit PCM`;
    const rateLabel = `${(info.sampleRate / 1000).toFixed(1)} kHz`;
    const sizeLabel = formatByteSize(info.byteSize);
    const framesCount = info.totalFrames ?? Math.round(info.durationSec * info.sampleRate);
    const durLabel = `${info.durationSec.toFixed(3)}s (${framesCount.toLocaleString()} f)`;
    const hasLoop = info.loopEnd > info.loopStart;
    const loopLabel = hasLoop
      ? `${info.loopStart.toLocaleString()}..${info.loopEnd.toLocaleString()}`
      : (isEs ? 'Sin Bucle' : 'No Loop');

    return `
      <div class="sample-tech-spec-box" title="${isEs ? 'Especificaciones Técnicas de la Muestra' : 'Sample Technical Specifications'}">
        <div class="spec-cell">
          <span class="spec-label">${isEs ? 'TAMAÑO' : 'FILE SIZE'}</span>
          <span class="spec-value is-highlight">${sizeLabel}</span>
        </div>
        <div class="spec-cell">
          <span class="spec-label">${isEs ? 'CANALES' : 'CHANNELS'}</span>
          <span class="spec-value">${chLabel}</span>
        </div>
        <div class="spec-cell">
          <span class="spec-label">${isEs ? 'RESOLUCIÓN' : 'RESOLUTION'}</span>
          <span class="spec-value">${resLabel}</span>
        </div>
        <div class="spec-cell">
          <span class="spec-label">${isEs ? 'FREC. MUESTREO' : 'SAMPLE RATE'}</span>
          <span class="spec-value">${rateLabel}</span>
        </div>
        <div class="spec-cell">
          <span class="spec-label">${isEs ? 'DURACIÓN' : 'DURATION'}</span>
          <span class="spec-value">${durLabel}</span>
        </div>
        <div class="spec-cell">
          <span class="spec-label">${isEs ? 'RANGO DE BUCLE' : 'LOOP RANGE'}</span>
          <span class="spec-value ${hasLoop ? 'is-loop' : 'is-muted'}">${loopLabel}</span>
        </div>
      </div>
    `;
  };

  const regSampleLabel =
    isExtended && activeReg
      ? activeReg.sampleName
        ? basenameOf(activeReg.sampleName)
        : (isEs ? 'Muestra Vacía' : 'Empty Sample')
      : '';

  const drawerTitleText =
    isExtended && activeReg
      ? `${isEs ? 'REGIÓN' : 'REGION'} #${activeRegIdx + 1}: ${regSampleLabel} (${midiNoteToString(activeReg.lowKey)}..${midiNoteToString(activeReg.highKey)} • VEL ${activeReg.lowVel}..${activeReg.highVel})`
      : `${isEs ? 'METADATOS DE ZONA' : 'ZONE'} #${ui.state.zoneIndex + 1}${isEs ? '' : ' METADATA'} (${midiNoteToString(z.lowKey)} .. ${midiNoteToString(z.highKey)})`;

  let overlapAlertHtml = '';
  if (isExtended && regOverlapInfo && regOverlapInfo.fullIntersections.length > 0) {
    const peerText = regOverlapInfo.fullIntersections
      .map((p) => `${isEs ? 'Región' : 'Region'} #${p.index}`)
      .join(', ');
    overlapAlertHtml = `
      <div class="overlap-alert-banner is-warning">
        <span class="overlap-alert-icon">${ICONS.alert}</span>
        <div class="overlap-alert-body">
          <strong>${isEs ? 'Intersección 2D de Tecla y Velocidad Detectada' : '2D Key &amp; Velocity Intersection Detected'}</strong>
          <span>${isEs ? `Esta región se solapa tanto en rango de teclas como en velocidad con <strong>${peerText}</strong>. Ambas muestras sonarán simultáneamente en el rango de intersección a menos que uses fundido cruzado o las ajustes.` : `This region overlaps in both key range and velocity with <strong>${peerText}</strong>. Both samples will trigger simultaneously in the intersecting range unless crossfaded or adjusted.`}</span>
        </div>
      </div>
    `;
  } else if (!isExtended && zoneOverlapPeers.length > 0) {
    const peerText = zoneOverlapPeers.map((p) => `${isEs ? 'Zona' : 'Zone'} #${p.index}`).join(', ');
    overlapAlertHtml = `
      <div class="overlap-alert-banner is-warning">
        <span class="overlap-alert-icon">${ICONS.alert}</span>
        <div class="overlap-alert-body">
          <strong>${isEs ? 'Solape de Rango de Teclas Detectado' : 'Key Range Overlap Detected'}</strong>
          <span>${isEs ? `Esta zona se solapa con <strong>${peerText}</strong>.` : `This zone overlaps with <strong>${peerText}</strong>.`}</span>
        </div>
      </div>
    `;
  }

  ui.state.drawerElement.innerHTML = `
    <div class="drawer-header">
      <div class="drawer-title">
        <span class="drawer-icon">${ICONS.layers}</span>
        <span>${escHtml(drawerTitleText)}</span>
      </div>
      <div class="drawer-header-actions">
        <button type="button" class="btn btn-xs btn-outline" id="btn-drawer-open-model-config" title="${isEs ? 'Abrir Modal de Configuración del Modelo (Modo, Motor, Articulación, Metadatos, Portada)' : 'Open Model Configuration Modal (Mode, Engine, Articulation, Metadata, Artwork)'}">
          ${ICONS.sliders} ${isEs ? 'Ajustes del Modelo' : 'Model Settings'}
        </button>
        <button type="button" class="btn btn-close-drawer" id="btn-close-zone-drawer" title="${isEs ? 'Cerrar Cajón de Metadatos' : 'Close Metadata Drawer'}">${ICONS.close}</button>
      </div>
    </div>

    <div class="drawer-body zone-drawer-body">
      ${overlapAlertHtml}

      <!-- 1. Key Range, Root & (in Extended Mode) Start/End Velocity -->
      <div class="inspector-section section-keys">
            <div class="section-header-row">
              <div class="section-title">${isExtended ? (isEs ? 'LÍMITES DE TECLA Y VELOCIDAD (REGIÓN 2D LIBRE)' : 'KEY &amp; VELOCITY BOUNDARIES (FREE 2D REGION)') : (isEs ? 'LÍMITES DE ZONA DE TECLAS (MIDI 0 C-2 .. 127 G8)' : 'KEY ZONE BOUNDARIES (MIDI 0 C-2 .. 127 G8)')}</div>
              ${
                ui.state.handlers.onAutoDetectZone
                  ? `<button type="button" class="btn btn-xs btn-outline" id="btn-auto-detect-zone-general" title="${isEs ? 'Auto-detectar nota raíz (YIN/MPM + HPS) y Parameter Set óptimo (0..9) a partir de la señal de audio' : 'Auto-detect root note (YIN/MPM + HPS) and optimal Parameter Set (0..9) from audio signal'}">
                      ${ICONS.cpu} ${isEs ? 'Auto-Detectar Tono y Set' : 'Auto-Detect Pitch &amp; Set'}
                    </button>`
                  : ''
              }
            </div>
            ${
              ui.state.keyMappingMode === 'drum'
                ? `
            <div class="card card--tight card--accent-left gm-drum-assignment-card">
              <div class="drum-selector-header">
                <label for="sel-gm-drum" class="drum-selector-label">${ICONS.drum} ${isEs ? 'ASIGNACIÓN DE INSTRUMENTO / PIEZA DE PERCUSIÓN GM' : 'GM DRUM INSTRUMENT / PIECE ASSIGNMENT'}</label>
                <span class="drum-assigned-tag">${formatGmDrumLabel(effRootKey)}</span>
              </div>
              <select id="sel-gm-drum" class="form-control select-gm-drum" title="${isEs ? `Asignar pieza de batería a esta ${isExtended ? 'región' : 'zona'} (alinea automáticamente la posición a su nota MIDI designada)` : `Assign drum piece to this ${isExtended ? 'region' : 'zone'} (automatically aligns position to its designated MIDI note)`}">
                ${ui.renderGmDrumOptions(effRootKey, isExtended && activeReg ? activeReg.id : z.id)}
              </select>
              ${drumCollisionDrawerAlertHtml}
            </div>
            `
                : ''
            }
            <div class="keys-inputs-row">
              <div class="form-group ${!isExtended && !prevZone ? 'is-conditioned-disabled' : ''}">
                <label for="inp-low-key">
                  ${isEs ? 'TECLA INF. (LOW)' : 'LOW KEY'}
                  ${!isExtended && !prevZone ? `<span class="cond-reason-badge is-classic-only">${isEs ? 'FIJO EN CLASSIC (0)' : 'FIXED IN CLASSIC (0)'}</span>` : ''}
                </label>
                <div class="input-with-note">
                  <input type="number" id="inp-low-key" min="${isExtended ? 0 : minLowKey}" max="${isExtended ? 127 : maxLowKey}" value="${effLowKey}" ${!isExtended && !prevZone ? `disabled title="${isEs ? 'La primera zona siempre empieza en 0 C-2 en Modo Classic' : 'First zone always starts at 0 C-2 in Classic Mode'}"` : ''} />
                  <span class="note-display" id="disp-low-note">${midiToNoteName(effLowKey)}</span>
                </div>
              </div>

              <div class="form-group is-highlight">
                <label for="inp-root-key">${ui.state.keyMappingMode === 'drum' ? (isEs ? 'NOTA PERCUSIÓN' : 'DRUM KEY') : (isEs ? 'NOTA RAÍZ (ROOT)' : 'ROOT KEY')}</label>
                <div class="input-with-note">
                  <input type="number" id="inp-root-key" min="0" max="127" value="${effRootKey}" />
                  <span class="note-display" id="disp-root-note">${ui.state.keyMappingMode === 'drum' ? formatGmDrumLabel(effRootKey) : midiToNoteName(effRootKey)}</span>
                </div>
              </div>

              <div class="form-group ${!isExtended && !nextZone ? 'is-conditioned-disabled' : ''}">
                <label for="inp-high-key">
                  ${isEs ? 'TECLA SUP. (HIGH)' : 'HIGH KEY'}
                  ${!isExtended && !nextZone ? `<span class="cond-reason-badge is-classic-only">${isEs ? 'FIJO EN CLASSIC (127)' : 'FIXED IN CLASSIC (127)'}</span>` : ''}
                </label>
                <div class="input-with-note">
                  <input type="number" id="inp-high-key" min="${isExtended ? 0 : minHighKey}" max="${isExtended ? 127 : maxHighKey}" value="${effHighKey}" ${!isExtended && !nextZone ? `disabled title="${isEs ? 'La última zona siempre termina en 127 G8 en Modo Classic' : 'Last zone always ends at 127 G8 in Classic Mode'}"` : ''} />
                  <span class="note-display" id="disp-high-note">${midiToNoteName(effHighKey)}</span>
                </div>
              </div>
            </div>
            <fieldset class="conditioned-fieldset" ${!isExtended || !activeReg ? 'disabled' : ''}>
              <div class="keys-inputs-row ${!isExtended ? 'is-conditioned-disabled' : ''}" style="margin-top: 8px;">
                <div class="form-group">
                  <label for="inp-ext-low-vel">
                    ${isEs ? 'VEL. INICIAL (1..127)' : 'LOW VEL (START 1..127)'}
                    ${!isExtended ? `<span class="cond-reason-badge is-extended-only">${isEs ? 'SOLO EXTENDED' : 'EXTENDED ONLY'}</span>` : ''}
                  </label>
                  <div class="input-with-note">
                    <input type="number" id="inp-ext-low-vel" min="1" max="127" value="${isExtended && activeReg ? activeReg.lowVel : 1}" title="${!isExtended ? (isEs ? 'Solo disponible en Modo Extended' : 'Only available in Extended Mode') : (isEs ? 'Velocidad inicial de la región (1..127)' : 'Region Start Velocity (1..127)')}" />
                    <span class="note-display">${isEs ? 'Inicio' : 'Start'}</span>
                  </div>
                </div>

                <div class="form-group">
                  <label for="inp-ext-high-vel">
                    ${isEs ? 'VEL. FINAL (1..127)' : 'HIGH VEL (END 1..127)'}
                    ${!isExtended ? `<span class="cond-reason-badge is-extended-only">${isEs ? 'SOLO EXTENDED' : 'EXTENDED ONLY'}</span>` : ''}
                  </label>
                  <div class="input-with-note">
                    <input type="number" id="inp-ext-high-vel" min="1" max="127" value="${isExtended && activeReg ? activeReg.highVel : (hasHighVel ? split - 1 : 127)}" title="${!isExtended ? (isEs ? 'Solo disponible en Modo Extended' : 'Only available in Extended Mode') : (isEs ? 'Velocidad final de la región (1..127)' : 'Region End Velocity (1..127)')}" />
                    <span class="note-display">${isEs ? 'Fin' : 'End'}</span>
                  </div>
                </div>

                <div class="form-group is-highlight">
                  <label>${isEs ? 'RANGO DE VELOCIDAD' : 'VELOCITY SPAN'}</label>
                  <div class="input-with-note">
                    <span class="note-display" id="disp-vel-span" style="width: 100%; text-align: center;">
                      ${isExtended && activeReg ? `Vel ${activeReg.lowVel}..${activeReg.highVel} (${Math.max(1, activeReg.highVel - activeReg.lowVel + 1)})` : (hasHighVel ? (isEs ? 'Fijo 1..63 / 64..127' : 'Fixed 1..63 / 64..127') : 'Vel 1..127 (127)')}
                    </span>
                  </div>
                </div>
              </div>
            </fieldset>
          </div>

          <!-- 2. Sample Assignment -->
          ${
            isExtended && activeReg
              ? `
          <div class="inspector-section section-samples">
            <div class="section-title">${isEs ? 'ASIGNACIÓN DE MUESTRA DE LA REGIÓN (1 MUESTRA POR REGIÓN 2D)' : 'REGION SAMPLE ASSIGNMENT (1 SAMPLE PER 2D REGION)'}</div>
            <div class="samples-slots-stack">
              <div class="sample-slot-card ${activeReg.sampleName ? 'has-file' : 'is-empty'}" id="card-sample-low">
                <div class="sample-slot-header">
                  <span class="sample-slot-tag" id="tag-vel-low">${isEs ? 'MUESTRA DE REGIÓN' : 'REGION SAMPLE'} (${isEs ? 'TECLAS' : 'KEYS'} ${midiNoteToString(activeReg.lowKey)}..${midiNoteToString(activeReg.highKey)} • VEL ${activeReg.lowVel}..${activeReg.highVel})</span>
                  <div style="display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                    <button type="button" class="btn btn-xs btn-primary" id="btn-sample-card-wizard" title="${isEs ? 'Rescatar muestra multi-nota en el Asistente (Paso 2: Limpiar huella de ruido, cortar por cruce por cero y remapear)' : 'Rescue multi-note sample in Wizard (Step 2: Clean noise print, slice at zero crossings and remap)'}">${ICONS.sparkle} ${isEs ? 'Limpiar y mapear' : 'Clean &amp; Map'}</button>
                    <button type="button" class="btn btn-xs btn-outline" id="btn-sample-card-slicer" title="${isEs ? 'Abrir AutoSlicer para esta muestra' : 'Open AutoSlicer for this sample'}">${ICONS.scissors} Slicer</button>
                    <button type="button" class="btn btn-xs btn-outline" id="btn-sample-card-loop" title="${isEs ? 'Abrir Editor Interactivo de Bucle para esta muestra' : 'Open Interactive Waveform Loop Editor for this sample'}">${ICONS.wave} ${isEs ? 'Editor Bucle' : 'Loop Editor'}</button>
                    <button type="button" class="btn btn-xs btn-outline" id="btn-sample-card-recorder" title="${isEs ? 'Abrir Grabadora de Audio y Captura de Huella de Ruido' : 'Open Audio Recorder &amp; Noise Print Capture'}">${ICONS.mic} ${isEs ? 'Grabar' : 'Record'}</button>
                    ${activeReg.sampleName ? `<button type="button" class="btn btn-xs btn-accent" id="btn-play-low" title="${isEs ? 'Escuchar Muestra de la Región' : 'Audition Region Sample'}">${ICONS.play} ${isEs ? 'Escuchar' : 'Audition'}</button>` : ''}
                  </div>
                </div>
                <div class="sample-slot-body">
                  <select class="sample-reuse-select" id="sel-reuse-low" title="${isEs ? 'Seleccionar una muestra ya cargada en la memoria de la sesión' : 'Select an already-loaded sample from session memory'}">
                    ${lowOptionsHtml}
                  </select>
                  <div class="sample-actions">
                    <input type="file" id="file-input-low" accept=".wav,.aif,.aiff,.aifc,.flac,.mp3,.ogg,.oga,.m4a,.aac,.opus,.webm,.caf,.ncw,audio/*" multiple class="is-hidden-file" />
                    <button type="button" class="btn btn-xs btn-outline" id="btn-browse-low" title="${isEs ? 'Cargar nuevo WAV/AIFF desde disco en esta región' : 'Load new WAV/AIFF from disk into this region'}">${ICONS.folder} ${isEs ? 'Examinar...' : 'Browse...'}</button>
                    ${activeReg.sampleName ? `<button type="button" class="btn btn-xs btn-ghost" id="btn-clear-low" title="${isEs ? 'Quitar Muestra de la Región' : 'Clear Region Sample'}">${ICONS.close}</button>` : ''}
                  </div>
                </div>
                ${activeReg.sampleName && effFmtInfo ? renderTechSpecsBox(effFmtInfo) : ''}
              </div>
            </div>
          </div>
          `
              : `
          <div class="inspector-section section-samples">
            <div class="section-title">${isEs ? 'CAPAS DE MUESTRA POR VELOCIDAD (CANÓNICO 1..63 / 64..127)' : 'VELOCITY SAMPLE LAYERS (CANONICAL 1..63 / 64..127)'}</div>
            <div class="samples-slots-stack">
              <div class="sample-slot-card ${z.sampleLow ? 'has-file' : 'is-empty'}" id="card-sample-low">
                <div class="sample-slot-header">
                  <span class="sample-slot-tag" id="tag-vel-low">${isEs ? 'MUESTRA LOW VEL' : 'LOW VEL SAMPLE'} (VEL 1..${hasHighVel ? split - 1 : 127})</span>
                  <div style="display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                    <button type="button" class="btn btn-xs btn-primary" id="btn-sample-card-wizard" title="${isEs ? 'Rescatar muestra multi-nota en el Asistente (Paso 2: Limpiar huella de ruido, cortar por cruce por cero y remapear)' : 'Rescue multi-note sample in Wizard (Step 2: Clean noise print, slice at zero crossings and remap)'}">${ICONS.sparkle} ${isEs ? 'Limpiar y mapear' : 'Clean &amp; Map'}</button>
                    <button type="button" class="btn btn-xs btn-outline" id="btn-sample-card-slicer" title="${isEs ? 'Abrir AutoSlicer para esta muestra' : 'Open AutoSlicer for this sample'}">${ICONS.scissors} Slicer</button>
                    <button type="button" class="btn btn-xs btn-outline" id="btn-sample-card-loop" title="${isEs ? 'Abrir Editor Interactivo de Bucle para esta muestra' : 'Open Interactive Waveform Loop Editor for this sample'}">${ICONS.wave} ${isEs ? 'Editor Bucle' : 'Loop Editor'}</button>
                    <button type="button" class="btn btn-xs btn-outline" id="btn-sample-card-recorder" title="${isEs ? 'Abrir Grabadora de Audio y Captura de Huella de Ruido' : 'Open Audio Recorder &amp; Noise Print Capture'}">${ICONS.mic} ${isEs ? 'Grabar' : 'Record'}</button>
                    ${z.sampleLow ? `<button type="button" class="btn btn-xs btn-accent" id="btn-play-low" title="${isEs ? 'Escuchar Audio Low Vel' : 'Audition Low Vel Audio'}">${ICONS.play} ${isEs ? 'Escuchar' : 'Audition'}</button>` : ''}
                  </div>
                </div>
                <div class="sample-slot-body">
                  <select class="sample-reuse-select" id="sel-reuse-low" title="${isEs ? 'Seleccionar una muestra ya cargada en la memoria de la sesión (reutilizada sin re-analizar)' : 'Select an already-loaded sample from session memory (reused without re-analyzing)'}">
                    ${lowOptionsHtml}
                  </select>
                  <div class="sample-actions">
                    <input type="file" id="file-input-low" accept=".wav,.aif,.aiff,.aifc,.flac,.mp3,.ogg,.oga,.m4a,.aac,.opus,.webm,.caf,.ncw,audio/*" multiple class="is-hidden-file" />
                    <button type="button" class="btn btn-xs btn-outline" id="btn-browse-low" title="${isEs ? 'Cargar nuevo WAV/AIFF desde disco' : 'Load new WAV/AIFF from disk'}">${ICONS.folder} ${isEs ? 'Examinar...' : 'Browse...'}</button>
                    ${z.sampleLow ? `<button type="button" class="btn btn-xs btn-ghost" id="btn-clear-low" title="${isEs ? 'Quitar Muestra Low Vel' : 'Clear Low Vel Sample'}">${ICONS.close}</button>` : ''}
                  </div>
                </div>
                ${z.sampleLow && effFmtInfo ? renderTechSpecsBox(effFmtInfo) : ''}
              </div>

              <div class="sample-slot-card ${z.sampleHigh ? 'has-file' : 'is-empty'}" id="card-sample-high">
                <div class="sample-slot-header">
                  <span class="sample-slot-tag" id="tag-vel-high">${isEs ? 'MUESTRA HIGH VEL' : 'HIGH VEL SAMPLE'} (${hasHighVel ? `VEL ${split}..127` : (isEs ? 'OPCIONAL 64..127' : 'OPTIONAL 64..127')})</span>
                  ${z.sampleHigh ? `<button type="button" class="btn btn-xs btn-accent" id="btn-play-high" title="${isEs ? 'Escuchar Audio High Vel' : 'Audition High Vel Audio'}">${ICONS.play} ${isEs ? 'Escuchar' : 'Audition'}</button>` : ''}
                </div>
                <div class="sample-slot-body">
                  <select class="sample-reuse-select" id="sel-reuse-high" title="${isEs ? 'Seleccionar una muestra ya cargada en la memoria de la sesión (reutilizada sin re-analizar)' : 'Select an already-loaded sample from session memory (reused without re-analyzing)'}">
                    ${highOptionsHtml}
                  </select>
                  <div class="sample-actions">
                    <input type="file" id="file-input-high" accept=".wav,.aif,.aiff,.aifc,.flac,.mp3,.ogg,.oga,.m4a,.aac,.opus,.webm,.caf,.ncw,audio/*" class="is-hidden-file" />
                    <button type="button" class="btn btn-xs btn-outline" id="btn-browse-high" title="${isEs ? 'Cargar nuevo WAV/AIFF desde disco' : 'Load new WAV/AIFF from disk'}">${ICONS.folder} ${isEs ? 'Examinar...' : 'Browse...'}</button>
                    ${z.sampleHigh ? `<button type="button" class="btn btn-xs btn-ghost" id="btn-clear-high" title="${isEs ? 'Quitar Muestra High Vel' : 'Clear High Vel Sample'}">${ICONS.close}</button>` : ''}
                  </div>
                </div>
              </div>

              <div class="sample-vel-split-control is-disabled is-conditioned-disabled">
                <label for="slider-vel-split" class="sample-vel-split-label">
                  <span>${isEs ? 'PUNTO DE DIVISIÓN DE VELOCIDAD' : 'VELOCITY SPLIT POINT'} <span class="cond-reason-badge is-extended-only">${isEs ? 'SOLO MODO EXTENDED' : 'EXTENDED MODE ONLY'}</span></span>
                  <span class="val-display" id="val-vel-split">64 (${isEs ? 'Fijo: 1–63 / 64–127' : 'Fixed: 1–63 / 64–127'})</span>
                </label>
                <input type="range" id="slider-vel-split" min="64" max="64" value="64" disabled title="${isEs ? 'El Modo Classic utiliza estrictamente la división de velocidad fija de Hartmann MODELmaker v1.2 (Low Vel 1..63 / High Vel 64..127). Cambia a Modo Extended para rangos de velocidad libres por región.' : 'Classic Mode strictly uses the Hartmann MODELmaker v1.2 fixed velocity split (Low Vel 1..63 / High Vel 64..127). Switch WORKING MODE → Extended for free per-region start/end velocities.'}" />
                <div class="sample-vel-split-hint">
                  ${isEs ? 'Modo Classic: Fijo en 64 (Low: 1–63, High: 64–127). Cambia a Modo Extended para rangos libres por región.' : 'Classic Mode: Fixed at 64 (Low: 1–63, High: 64–127). Switch to Extended Mode for free per-region velocity ranges.'}
                </div>
              </div>
            </div>
          </div>
          `
          }

          <!-- 3. Canonical Tuning, Volume & Pan Controls (Rotary Knobs from @abdsynths/shared) -->
          <div class="inspector-section section-trims">
            <div class="section-title">${isExtended ? (isEs ? 'PARÁMETROS DE LA REGIÓN (DETUNE / VOLUMEN / PAN)' : 'REGION PARAMETERS (DETUNE / VOLUME / PAN)') : (isEs ? 'PARÁMETROS DE LA ZONA (DETUNE / VOLUMEN / PAN)' : 'ZONE PARAMETERS (DETUNE / VOLUME / PAN)')}</div>
            <div class="zone-knobs-row">
              <div class="synth-knob-cell" title="${isEs ? 'Desafinación fina (-99 .. +99 cents). Doble clic para restablecer a 0.' : 'Fine Detune (-99 .. +99 cents). Double-click knob to reset to 0.'}">
                <div id="knob-zone-detune"></div>
                <span class="synth-knob-num stat-num" id="val-detune">${detuneToString(effDetune)}</span>
                <span class="synth-knob-title">DETUNE (-99..+99)</span>
              </div>

              <div class="synth-knob-cell" title="${isEs ? 'Volumen (-32dB .. +12dB). Doble clic para restablecer a 0dB.' : 'Volume (-32dB .. +12dB). Double-click knob to reset to 0dB.'}">
                <div id="knob-zone-volume"></div>
                <span class="synth-knob-num stat-num" id="val-volume">${volumeToLongString(effVolume)}</span>
                <span class="synth-knob-title">${isEs ? 'VOLUMEN (-32..+12dB)' : 'VOLUME (-32..+12dB)'}</span>
              </div>

              <div class="synth-knob-cell" title="${isEs ? 'Panorama (-50 .. +50). Doble clic para restablecer al Centro (0).' : 'Pan (-50 .. +50). Double-click knob to reset to Center (0).'}">
                <div id="knob-zone-pan"></div>
                <span class="synth-knob-num stat-num" id="val-pan">${panToString(effPan)}</span>
                <span class="synth-knob-title">PAN (-50..+50)</span>
              </div>
            </div>
          </div>

          <!-- 5. Interactive Audio Tools & Modals Bar -->
          <div class="inspector-section section-tools">
            <div class="section-title">${isEs ? 'EDITORES INTERACTIVOS DE AUDIO' : 'INTERACTIVE AUDIO EDITORS'}</div>
            <div class="drawer-tools-row">
              <button type="button" class="btn btn-sm btn-outline flex-1" id="btn-drawer-invoke-loop" title="${isEs ? 'Abrir Editor Interactivo de Bucle y Lupa de Costura por Cruce por Cero' : 'Open Interactive Waveform Loop Editor &amp; Zero-Crossing Seam Magnifier Modal'}">
                ${ICONS.wave} ${isEs ? 'Editor AutoLoop...' : 'AutoLoop Editor...'}
              </button>
              <button type="button" class="btn btn-sm btn-outline flex-1" id="btn-drawer-invoke-slicer" title="${isEs ? 'Abrir Troceador de Audio y Auto-Slicer Multicapa' : 'Open Audio Chopper &amp; Multi-Layer Auto-Slicer Modal'}">
                ${ICONS.scissors} AutoSlicer...
              </button>
              <button type="button" class="btn btn-sm btn-outline flex-1" id="btn-drawer-invoke-recorder" title="${isEs ? 'Abrir Grabadora de Audio y Captura de Huella de Ruido' : 'Open Audio Recorder &amp; Noise Print Capture Modal'}">
                ${ICONS.mic} ${isEs ? 'Grabar...' : 'Record...'}
              </button>
            </div>
          </div>

          <!-- 6. Fase 8 / 35.6: Master Wave Promotion (24-bit / 96 kHz) -->
          <div class="inspector-section section-master-wave">
            <div class="section-title">${isEs ? 'MEJORAR A MASTER WAVE (24-BIT / 96 KHZ)' : 'UPGRADE TO MASTER WAVE (24-BIT / 96 KHZ)'}</div>
            <div class="drawer-tools-row" style="gap: 8px; flex-wrap: wrap;">
              ${
                isExtended && activeReg
                  ? `<button type="button" class="btn btn-sm btn-outline flex-1" id="btn-promote-zone-mw-reg" title="${isEs ? 'Promover la muestra de esta región a 24-bit / 96 kHz Master Wave con expansión de bucle por cruce por cero' : 'Promote this region sample to 24-bit / 96 kHz Master Wave with zero-crossing loop expansion'}">
                      ${ICONS.cpu} ${isEs ? 'Mejorar esta región (24b/96k)' : 'Upgrade this region (24b/96k)'}
                    </button>`
                  : `<button type="button" class="btn btn-sm btn-outline flex-1" id="btn-promote-zone-mw" title="${isEs ? 'Promover la muestra de esta zona a 24-bit / 96 kHz Master Wave con expansión de bucle por cruce por cero' : 'Promote this zone sample to 24-bit / 96 kHz Master Wave with zero-crossing loop expansion'}">
                      ${ICONS.cpu} ${isEs ? 'Mejorar esta zona (24b/96k)' : 'Upgrade this zone (24b/96k)'}
                    </button>`
              }
              <button type="button" class="btn btn-sm btn-primary flex-1" id="btn-promote-all-mw" title="${isEs ? 'Promover todas las zonas con muestra a 24-bit / 96 kHz Master Wave (sobre las notas ya partidas y mapeadas)' : 'Promote all zones with samples to 24-bit / 96 kHz Master Wave (over already-sliced and mapped notes)'}">
                ${ICONS.sparkle} ${isEs ? 'Mejorar todas las zonas a Master Wave (24b/96k)' : 'Upgrade all zones to Master Wave (24b/96k)'}
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    ui.bindDrawerEvents();
    requestAnimationFrame(() => drawDrawerPreviewWaveform(ui, ));
}
