// -----------------------------------------------------------------
// ABDNeuModMakr - Zone Inspector HTML Templates (pure functions)
//
// Stateless HTML builders extracted verbatim from `ZoneInspector`
// (P refactor: archivos >3000 lineas). Every function is pure:
// all instance state arrives via `opts` / `deps`. The class keeps
// state, events, canvas and orchestration and delegates here.
// -----------------------------------------------------------------

import type {
  AcousticClassificationResult,
  AssetStoreDiagnostics,
  AutoLoopAlgorithm,
  CommonPlaybackDefaults,
  ExtendedModelMetadata,
  ExtendedRegion,
  KeyMappingMode,
  MasterWaveConfig,
  ModelProvenance,
  SynthArticulationConfig,
  Zone,
  ZoneLoopEditorData,
} from '../../core/types.ts';
import {
  analyzeClassicZoneOverlaps,
  analyzeExtendedIntersections,
  createDefaultCommonPlayback,
} from '../../core/extendedAdapter.ts';
import {
  analyzeDrumCollisions,
  formatGmDrumLabel,
  listGmDrumEntries,
} from '../../core/gmDrumMap.ts';
import {
  STANDARD_SOUNDFONT_TAGS,
  findStandardTagDef,
} from '../../core/soundfontMetadata.ts';
import { DEFAULT_MASTER_WAVE_CONFIG } from '../../core/dsp/MasterWaveEnhancer.ts';
import {
  detuneToString,
  midiToNoteName,
  midiNoteToString,
  panToString,
  volumeToLongString,
} from '../ZoneRibbon.ts';
import { ICONS } from '../icons.ts';
import { escAttr, escHtml } from '../escape.ts';
import { basename } from '../../core/pathUtils.ts';

/** Shared table options: view mode + audition highlight. */
export interface ZoneTableTemplateOptions {
  keyMappingMode: KeyMappingMode;
  playingRowId: string | null;
}

export interface GmDrumOptionItem {
  id: string;
  index: number;
  rootKey: number;
}

export interface ZoneSampleFormatSummary {
  sampleName: string;
  sampleRate: number;
  bitsPerSample: number;
  numChannels: number;
  durationSec: number;
  totalFrames?: number;
  byteSize?: number;
  loopStart: number;
  loopEnd: number;
}

/** Resolved data + UI prefs for the region loop editor section. */
export interface RegionLoopTemplateDeps {
  getCommonPlayback: () => CommonPlaybackDefaults | undefined;
  getArticulation: () => SynthArticulationConfig | undefined;
  getZoneClassification: (zoneId: string) => AcousticClassificationResult | undefined;
  getDetectedCategory: () => string | undefined;
  getZoneSampleFormatInfo: (zoneId?: string, regionId?: string) => ZoneSampleFormatSummary | null | undefined;
  isAuditionPlaying: () => boolean;
  getLoopData: (zoneId?: string, regionId?: string) => ZoneLoopEditorData | null;
  snapZeroCrossing: boolean;
  selectedAlgo: AutoLoopAlgorithm;
}

export type ModelSubTab = 'common-playback' | 'articulation' | 'master' | 'capsule' | 'metadata';

/** Resolved data for the model common/global settings section. */
export interface ModelCommonTemplateDeps {
  activeModelSubTab: ModelSubTab;
  getArticulation: () => SynthArticulationConfig | undefined;
  getCommonPlayback: () => CommonPlaybackDefaults | undefined;
  getAssetStoreDiagnostics: () => AssetStoreDiagnostics | undefined;
  getMasterWaveConfig: () => MasterWaveConfig | undefined;
  getModelProvenance: () => ModelProvenance | null | undefined;
  getExtendedMetadata: () => ExtendedModelMetadata | undefined;
  getZoneSampleFormatInfo: (zoneId?: string, regionId?: string) => ZoneSampleFormatSummary | null | undefined;
  extendedMetadata: ExtendedModelMetadata | undefined;
  metadataHtml: string;
}

export function basenameOf(samplePath: string | null | undefined): string {
  return basename(samplePath);
}

export function formatRegionModeBadge(reg: ExtendedRegion): string {
  const loopLabel =
    reg.loopMode === 'loop_continuous'
      ? 'Loop'
      : reg.loopMode === 'loop_sustain'
        ? 'Sustain'
        : reg.loopMode === 'one_shot'
          ? 'One-Shot'
          : 'No Loop';
  const keytrackTag =
    reg.pitchKeytrack !== undefined && reg.pitchKeytrack !== 100
      ? ` • Key ${reg.pitchKeytrack}%`
      : '';
  const trigTag =
    reg.trigger && reg.trigger !== 'attack'
      ? ` • ${reg.trigger.charAt(0).toUpperCase() + reg.trigger.slice(1)}`
      : '';
  return `${loopLabel}${keytrackTag}${trigTag}`;
}

export function findZoneIdForRegion(
  allZones: Zone[],
  currentZone: Zone | null,
  reg: ExtendedRegion
): string {
    const zMatch =
      allZones.find(
        (z) =>
          (z.sampleLow === reg.sampleName || z.sampleHigh === reg.sampleName) &&
          z.lowKey <= reg.highKey &&
          z.highKey >= reg.lowKey
      ) ??
      allZones.find(
        (z) => z.lowKey <= reg.highKey && z.highKey >= reg.lowKey
      ) ??
      currentZone;
    return zMatch?.id ?? '';
  }

export function renderZoneTableRows(
  zones: Zone[],
  activeId: string,
  opts: ZoneTableTemplateOptions
): string {
    const overlaps = analyzeClassicZoneOverlaps(zones);
    const isDrumMode = opts.keyMappingMode === 'drum';
    const drumCollisionReport = isDrumMode
      ? analyzeDrumCollisions(
          zones.map((z) => ({
            id: z.id,
            lowKey: z.lowKey,
            highKey: z.highKey,
            rootKey: z.rootKey,
            lowVel: 1,
            highVel: 127,
          }))
        )
      : null;

    return zones
      .map((zone, idx) => {
        const isSelected = zone.id === activeId;
        const lowKeyStr = midiNoteToString(zone.lowKey);
        const rootKeyStr = isDrumMode
          ? formatGmDrumLabel(zone.rootKey)
          : midiNoteToString(zone.rootKey);
        const highKeyStr = midiNoteToString(zone.highKey);
        const lowVelName = basenameOf(zone.sampleLow);
        const highVelName = basenameOf(zone.sampleHigh);
        const hasHigh = Boolean(highVelName);
        const zoneSplit = Math.max(2, Math.min(127, zone.velSplit ?? 64));
        const detuneStr = detuneToString(zone.detune);
        const volumeStr = volumeToLongString(zone.volume);
        const panStr = panToString(zone.pan);

        const peerOverlaps = overlaps[zone.id]?.overlappingZones ?? [];
        const hasOverlap = peerOverlaps.length > 0;
        const overlapTip = hasOverlap
          ? `Key range overlaps with Zone(s) ${peerOverlaps.map((p) => `#${p.index}`).join(', ')}`
          : '';

        const drumColl = drumCollisionReport?.collisionMap[zone.id];
        const hasDrumCollision = Boolean(drumColl);
        const drumCollisionTip = drumColl
          ? `GM Drum Collision: Drum piece ${drumColl.drumLabel} is also assigned to Zone(s) ${drumColl.peerIndices.map((i) => `#${i}`).join(', ')}!`
          : '';

        const lowVelHtml = lowVelName
          ? `<span class="cell-vel-tag">1–${hasHigh ? zoneSplit - 1 : 127}</span> <span class="cell-sample-name">${escHtml(lowVelName)}</span>`
          : `<span class="cell-empty-dash">—</span>`;
        const highVelHtml = highVelName
          ? `<span class="cell-vel-tag">${zoneSplit}–127</span> <span class="cell-sample-name">${escHtml(highVelName)}</span>`
          : `<span class="cell-empty-dash">—</span>`;

        const isCurrentPlaying = opts.playingRowId === zone.id;

        return `
          <tr class="zone-table-row ${isSelected ? 'is-selected' : ''} ${hasOverlap ? 'has-region-intersection' : ''} ${hasDrumCollision ? 'has-drum-collision' : ''}" data-zone-id="${zone.id}">
            <td class="col-zone" title="${drumCollisionTip || overlapTip}">${hasDrumCollision ? `<span class="cell-collision-icon" title="${escAttr(drumCollisionTip)}">${ICONS.alert}</span>` : hasOverlap ? `<span class="cell-overlap-icon">${ICONS.alert}</span>` : ''}${idx + 1}</td>
            <td class="col-key ${hasOverlap ? 'is-overlap-cell' : ''}" title="${overlapTip}">${lowKeyStr}</td>
            <td class="col-key is-root ${isDrumMode ? 'is-drum-piece' : ''} ${hasDrumCollision ? 'is-collision-cell' : ''}" title="${drumCollisionTip || (isDrumMode ? escAttr(rootKeyStr) : '')}">${hasDrumCollision ? `<span class="cell-collision-icon" title="${escAttr(drumCollisionTip)}">${ICONS.alert}</span>` : ''}<span class="drum-piece-text">${escHtml(rootKeyStr)}</span></td>
            <td class="col-key ${hasOverlap ? 'is-overlap-cell' : ''}" title="${overlapTip}">${highKeyStr}</td>
            <td class="col-sample ${lowVelName ? 'has-sample' : 'is-empty'}" data-vel-layer="low" title="${zone.sampleLow ? escAttr(`Vel 1..${hasHigh ? zoneSplit - 1 : 127}: ${zone.sampleLow}`) : 'No Low Vel sample'}">${lowVelHtml}</td>
            <td class="col-sample ${highVelName ? 'has-sample' : 'is-empty'}" data-vel-layer="high" title="${zone.sampleHigh ? escAttr(`Vel ${zoneSplit}..127: ${zone.sampleHigh}`) : 'No High Vel sample (Low Vel covers 1..127)'}">${highVelHtml}</td>
            <td class="col-num">${detuneStr}</td>
            <td class="col-num">${volumeStr}</td>
            <td class="col-num">${panStr}</td>
            <td class="col-edit">
              <button type="button" class="btn-row-play ${isCurrentPlaying ? 'is-playing' : ''}" data-play-zone-id="${zone.id}" data-play-row-id="${zone.id}" title="${isCurrentPlaying ? 'Stop auditioning' : `Audition Zone #${idx + 1} (Loop, Volume, Pan, Detune)`}">
                ${isCurrentPlaying ? ICONS.stop : ICONS.play}
              </button>
              <button type="button" class="btn-row-edit" data-edit-zone-id="${zone.id}" title="Edit Zone #${idx + 1} Metadata (Keys, Samples, Detune, Volume, Pan)">
                ${ICONS.settings}
              </button>
            </td>
          </tr>
        `;
      })
      .join('');
  }

export function renderExtendedRegionTableRows(
  regions: ExtendedRegion[],
  activeRegionId: string,
  zones: Zone[],
  currentZone: Zone | null,
  opts: ZoneTableTemplateOptions
): string {
    const extReport = analyzeExtendedIntersections(regions);
    const isDrumMode = opts.keyMappingMode === 'drum';
    const drumCollisionReport = isDrumMode
      ? analyzeDrumCollisions(
          regions.map((r) => ({
            id: r.id,
            lowKey: r.lowKey,
            highKey: r.highKey,
            rootKey: r.rootKey,
            lowVel: r.lowVel,
            highVel: r.highVel,
          }))
        )
      : null;

    return regions
      .map((reg, idx) => {
        const isSelected = reg.id === activeRegionId;
        const lowKeyStr = midiNoteToString(reg.lowKey);
        const rootKeyStr = isDrumMode
          ? formatGmDrumLabel(reg.rootKey)
          : midiNoteToString(reg.rootKey);
        const highKeyStr = midiNoteToString(reg.highKey);
        const sampleName = basenameOf(reg.sampleName);
        const modeBadge = formatRegionModeBadge(reg);
        const detuneStr = detuneToString(reg.detune);
        const volumeStr = volumeToLongString(reg.volume);
        const panStr = panToString(reg.pan);
        const mappedZoneId = findZoneIdForRegion(zones, currentZone, reg);

        const ovInfo = extReport.byRegionId[reg.id];
        const fullPeers = ovInfo?.fullIntersections ?? [];
        const keyOnlyPeers = ovInfo?.keyOnlyOverlaps ?? [];
        const hasFullIntersect = fullPeers.length > 0;
        const hasKeySplitOverlap = !hasFullIntersect && keyOnlyPeers.length > 0;
        const hasException = Boolean(reg.hasPlaybackOverride || reg.hasArticulationOverride);

        const drumColl = drumCollisionReport?.collisionMap[reg.id];
        const hasDrumCollision = Boolean(drumColl);
        const drumCollisionTip = drumColl
          ? `GM Drum Collision: Drum piece ${drumColl.drumLabel} also mapped in Region(s) ${drumColl.peerIndices.map((i) => `#${i}`).join(', ')} with overlapping velocity!`
          : '';

        const fullIntersectTip = hasFullIntersect
          ? `Key & Velocity Intersection with ${fullPeers
              .map(
                (p) =>
                  `Region #${p.index} (Keys ${midiToNoteName(p.overlapLowKey)}..${midiToNoteName(p.overlapHighKey)}, Vel ${p.overlapLowVel}..${p.overlapHighVel})`
              )
              .join('; ')}`
          : '';
        const keySplitTip = hasKeySplitOverlap
          ? `Shared Key Range (Velocity Layer Split) with ${keyOnlyPeers
              .map((p) => `Region #${p.index} (Vel ${p.lowVel}..${p.highVel})`)
              .join('; ')}`
          : '';
        const keyCellClass = hasFullIntersect
          ? 'is-overlap-cell'
          : hasKeySplitOverlap
            ? 'is-key-layer-cell'
            : '';
        const velCellClass = hasFullIntersect ? 'is-overlap-cell' : '';

        const sampleHtml = sampleName
          ? `<span class="cell-sample-name">${escHtml(sampleName)}</span>`
          : `<span class="cell-empty-dash">—</span>`;

        const ovrBadgeHtml = hasException
          ? `<span class="cell-ovr-badge" title="Custom Exception active in Region #${idx + 1} (overrides Model Common settings)">OVR</span>`
          : '';

        const isCurrentPlaying = opts.playingRowId === reg.id;

        return `
          <tr class="zone-table-row ${isSelected ? 'is-selected' : ''} ${hasFullIntersect ? 'has-region-intersection' : ''} ${hasDrumCollision ? 'has-drum-collision' : ''}" data-region-id="${reg.id}" data-zone-id="${mappedZoneId}">
            <td class="col-zone" title="${drumCollisionTip || fullIntersectTip || keySplitTip || `Region #${idx + 1}`}">${hasDrumCollision ? `<span class="cell-collision-icon" title="${escAttr(drumCollisionTip)}">${ICONS.alert}</span>` : hasFullIntersect ? `<span class="cell-overlap-icon" title="${fullIntersectTip}">${ICONS.alert}</span>` : hasKeySplitOverlap ? `<span class="cell-layer-icon" title="${keySplitTip}">${ICONS.layers}</span>` : ''}${idx + 1}</td>
            <td class="col-key ${keyCellClass}" title="${fullIntersectTip || keySplitTip}">${lowKeyStr}</td>
            <td class="col-key is-root ${isDrumMode ? 'is-drum-piece' : ''} ${hasDrumCollision ? 'is-collision-cell' : ''}" title="${drumCollisionTip || (isDrumMode ? escAttr(rootKeyStr) : '')}">${hasDrumCollision ? `<span class="cell-collision-icon" title="${escAttr(drumCollisionTip)}">${ICONS.alert}</span>` : ''}<span class="drum-piece-text">${escHtml(rootKeyStr)}</span></td>
            <td class="col-key ${keyCellClass}" title="${fullIntersectTip || keySplitTip}">${highKeyStr}</td>
            <td class="col-vel ${velCellClass}" title="${fullIntersectTip || `Start Velocity (1..127)`}"><span class="cell-vel-tag ${hasFullIntersect ? 'is-overlap-tag' : ''}">${reg.lowVel}</span></td>
            <td class="col-vel ${velCellClass}" title="${fullIntersectTip || `End Velocity (1..127)`}"><span class="cell-vel-tag ${hasFullIntersect ? 'is-overlap-tag' : ''}">${reg.highVel}</span></td>
            <td class="col-sample ${sampleName ? 'has-sample' : 'is-empty'}" title="${reg.sampleName ? escAttr(`${reg.sampleName} (Keys ${lowKeyStr}..${highKeyStr}, Vel ${reg.lowVel}..${reg.highVel})`) : 'Empty Region — Browse or drop a WAV/AIFF sample'}">${sampleHtml}</td>
            <td class="col-mode">
              <button type="button" class="btn-cell-loop" data-loop-region-id="${reg.id}" title="Click to open Interactive Waveform Loop Editor for Region #${idx + 1} (${hasException ? 'Custom Region Exception' : 'Inherited from Model Common'})">
                ${ICONS.wave} <span>${modeBadge}</span>${ovrBadgeHtml}
              </button>
            </td>
            <td class="col-num">${detuneStr}</td>
            <td class="col-num">${volumeStr}</td>
            <td class="col-num">${panStr}</td>
            <td class="col-edit">
              <button type="button" class="btn-row-play ${isCurrentPlaying ? 'is-playing' : ''}" data-play-region-id="${reg.id}" data-play-row-id="${reg.id}" data-play-zone-id="${mappedZoneId}" title="${isCurrentPlaying ? 'Stop auditioning' : `Audition Region #${idx + 1} (Loop, DAHDSR Envelopes, Volume, Pan, Detune)`}">
                ${isCurrentPlaying ? ICONS.stop : ICONS.play}
              </button>
              <button type="button" class="btn-row-edit" data-edit-region-id="${reg.id}" title="Edit Region #${idx + 1} Metadata (Sample, Keys, Vel, Loop &amp; Exceptions)">
                ${ICONS.settings}
              </button>
            </td>
          </tr>
        `;
      })
      .join('');
  }

export function renderGmDrumOptions(
  currentKey: number,
  currentId: string,
  items: GmDrumOptionItem[]
): string {

    const assignedMap = new Map<number, number[]>();
    for (const item of items) {
      if (item.id === currentId) continue;
      const list = assignedMap.get(item.rootKey) ?? [];
      list.push(item.index);
      assignedMap.set(item.rootKey, list);
    }

    const entries = listGmDrumEntries();
    const isCurrentKnown = entries.some((e) => e.note === currentKey);

    let html = '';
    if (!isCurrentKnown) {
      html += `<option value="${currentKey}" class="opt-current" selected>★ Custom / Non-GM (${currentKey} ${midiToNoteName(currentKey)}) [Current]</option>`;
    }

    for (const entry of entries) {
      const isCurrent = entry.note === currentKey;
      const others = assignedMap.get(entry.note);
      if (isCurrent) {
        html += `<option value="${entry.note}" class="opt-current" selected>★ ${escHtml(entry.label)} [Current]</option>`;
      } else if (others && others.length > 0) {
        html += `<option value="${entry.note}" class="opt-assigned">● ${escHtml(entry.label)} [In Use: #${others.join(', #')}]</option>`;
      } else {
        html += `<option value="${entry.note}" class="opt-available">○ ${escHtml(entry.label)}</option>`;
      }
    }
    return html;
  }

export function renderRegionLoopAndExceptionsHtml(
  z: Zone,
  activeReg: ExtendedRegion | null,
  deps: RegionLoopTemplateDeps
): string {
    const commonPb =
      deps.getCommonPlayback?.() ?? createDefaultCommonPlayback();
    const globalArt = deps.getArticulation?.();
    const cls = deps.getZoneClassification?.(z.id);
    const detectedCat =
      cls?.detectedCategory ??
      deps.getDetectedCategory?.() ??
      'Synth & Neutral';

    const hasPbOvr = Boolean(activeReg?.hasPlaybackOverride);
    const hasArtOvr = Boolean(activeReg?.hasArticulationOverride);

    const loopData = deps.getLoopData(z.id, activeReg?.id);
    const sr = Math.max(1, loopData?.sampleRate ?? 44100);
    const totalFrames = Math.max(2, loopData?.totalFrames ?? 44100);

    const loopMode = hasPbOvr
      ? (activeReg?.loopMode ?? loopData?.loopMode ?? commonPb.loopMode)
      : (commonPb.loopMode !== 'no_loop' ? commonPb.loopMode : (loopData?.loopMode ?? 'loop_continuous'));
    const keytrack = hasPbOvr
      ? (activeReg?.pitchKeytrack ?? commonPb.pitchKeytrack)
      : commonPb.pitchKeytrack;
    const triggerMode = hasPbOvr
      ? (activeReg?.trigger ?? commonPb.trigger)
      : commonPb.trigger;
    const fadeCurve = hasPbOvr
      ? (activeReg?.fadeCurve ?? commonPb.fadeCurve)
      : commonPb.fadeCurve;

    const loopStart =
      activeReg && activeReg.loopEnd > activeReg.loopStart
        ? activeReg.loopStart
        : (loopData?.loopStart ?? 0);
    const loopEnd =
      activeReg && activeReg.loopEnd > activeReg.loopStart
        ? activeReg.loopEnd
        : (loopData?.loopEnd ?? Math.floor(totalFrames * 0.85));
    const loopXfade = activeReg?.loopCrossfadeMs ?? loopData?.loopCrossfadeMs ?? 15;
    const keyFadeIn = activeReg?.keyFadeIn ?? 0;
    const keyFadeOut = activeReg?.keyFadeOut ?? 0;
    const velFadeIn = activeReg?.velFadeIn ?? 0;
    const velFadeOut = activeReg?.velFadeOut ?? 0;

    const startSecStr = (loopStart / sr).toFixed(3);
    const endSecStr = (loopEnd / sr).toFixed(3);
    const isPlayingLoop = Boolean(deps.isAuditionPlaying?.());

    const regAmpA =
      activeReg?.ampEnvOverride?.attackSec ?? globalArt?.ampEnv.attackSec ?? 0.005;
    const regAmpD =
      activeReg?.ampEnvOverride?.decaySec ?? globalArt?.ampEnv.decaySec ?? 0.25;
    const regAmpS =
      activeReg?.ampEnvOverride?.sustainLevel ??
      globalArt?.ampEnv.sustainLevel ??
      1.0;
    const regAmpR =
      activeReg?.ampEnvOverride?.releaseSec ??
      globalArt?.ampEnv.releaseSec ??
      0.2;
    const regFltCut =
      activeReg?.filterOverride?.cutoffHz ?? globalArt?.filter.cutoffHz ?? 18000;
    const regFltReso =
      activeReg?.filterOverride?.resonanceDb ??
      globalArt?.filter.resonanceDb ??
      0;

    const fmtInfo = deps.getZoneSampleFormatInfo?.(z.id) ?? null;
    const chBadge =
      fmtInfo?.numChannels === 4
        ? '4.0 Quad'
        : fmtInfo?.numChannels === 2
          ? '2.0 Stereo'
          : fmtInfo?.numChannels === 1
            ? '1.0 Mono'
            : 'Unassigned';
    const fmtBadge = fmtInfo
      ? `${(fmtInfo.sampleRate / 1000).toFixed(1)} kHz / ${fmtInfo.bitsPerSample}-bit • ${chBadge} • ${fmtInfo.durationSec.toFixed(2)}s`
      : 'No Sample Loaded';

    return `
      <!-- 1. Interactive Waveform Loop Editor, Zero-Crossing Seam Magnifier & Boundary Crossfades -->
      <div class="inspector-section section-extended-region" data-ext-region-id="${activeReg?.id ?? ''}">
        <div class="section-header-row">
          <div class="section-title">INTERACTIVE WAVEFORM LOOP EDITOR &amp; ZERO-CROSSING SEAM MAGNIFIER</div>
          <span class="val-pill" title="Current Sample Audio Format">${fmtBadge}</span>
        </div>

        <div class="drawer-loop-editor-box">
          <div class="drawer-loop-toolbar">
            <button type="button" class="btn-overlay-toggle ${deps.snapZeroCrossing ? 'is-on' : ''}" id="btn-drawer-loop-snap" title="Snap dragged L-START / L-END handles to nearest rising zero-crossing">
              0-X Snap: ${deps.snapZeroCrossing ? 'ON' : 'OFF'}
            </button>
            <label class="loop-ed-field" title="Select Auto-Loop Algorithm">
              <select id="sel-drawer-loop-algo" class="loop-ed-select">
                <option value="pitch_periodic" ${deps.selectedAlgo === 'pitch_periodic' ? 'selected' : ''}>F0 Period-Lock</option>
                <option value="ncc_zc" ${deps.selectedAlgo === 'ncc_zc' ? 'selected' : ''}>NCC Zero-Crossing</option>
                <option value="min_seam_energy" ${deps.selectedAlgo === 'min_seam_energy' ? 'selected' : ''}>Min Seam Discontinuity</option>
                <option value="equal_power_xfade" ${deps.selectedAlgo === 'equal_power_xfade' ? 'selected' : ''}>Equal-Power X-Fade</option>
              </select>
            </label>
            <button type="button" class="btn-overlay-toggle is-action-accent" id="btn-drawer-loop-autofind" title="Automatically find optimal click-free loop points using the selected algorithm">
              ${ICONS.cpu} Run Auto-Loop
            </button>
            <button type="button" class="btn-overlay-toggle" id="btn-drawer-loop-zoom-in" title="Zoom In Waveform around Loop Region">
              Zoom +
            </button>
            <button type="button" class="btn-overlay-toggle" id="btn-drawer-loop-zoom-out" title="Zoom Out Waveform">
              Zoom -
            </button>
            <button type="button" class="btn-overlay-toggle" id="btn-drawer-loop-zoom-reset" title="Reset Waveform Zoom (1x)">
              1x
            </button>
            <button type="button" class="btn btn-xs btn-accent" id="btn-drawer-loop-play" title="Audition sample in continuous hardware loop (updates live while dragging L-START / L-END)">
              ${isPlayingLoop ? `■ Stop Loop` : `${ICONS.play} Loop Play`}
            </button>
          </div>
          <div class="drawer-loop-canvas-wrap">
            <canvas id="drawer-loop-canvas" class="drawer-loop-canvas" width="680" height="190"></canvas>
          </div>
          <div class="drawer-loop-hint">
            Drag <strong>L-START</strong> or <strong>L-END</strong> handles (or double-click waveform) • Right pane shows <strong>Zero-Crossing Seam Magnifier</strong> (±64 samples)
          </div>
        </div>

        <div class="drawer-grid-3" style="margin-top: 8px;">
          <div class="form-group">
            <div class="label-with-val">
              <label for="inp-ext-loop-start">LOOP START (FRAMES)</label>
              <span class="val-pill" id="lbl-drawer-loop-start-sec">${startSecStr}s</span>
            </div>
            <input type="number" id="inp-ext-loop-start" class="drawer-input" min="0" max="${Math.max(0, totalFrames - 2)}" value="${loopStart}" />
          </div>
          <div class="form-group">
            <div class="label-with-val">
              <label for="inp-ext-loop-end">LOOP END (FRAMES)</label>
              <span class="val-pill" id="lbl-drawer-loop-end-sec">${endSecStr}s</span>
            </div>
            <input type="number" id="inp-ext-loop-end" class="drawer-input" min="1" max="${totalFrames}" value="${loopEnd}" />
          </div>
          <div class="form-group">
            <div class="label-with-val">
              <label for="inp-ext-loop-xfade">LOOP XFADE (MS)</label>
              <span class="val-pill">Equal-Power</span>
            </div>
            <input type="number" id="inp-ext-loop-xfade" class="drawer-input" min="0" max="5000" value="${loopXfade}" />
          </div>
        </div>

        <div class="drawer-grid-2" style="margin-top: 8px;">
          <div class="form-group">
            <label for="inp-ext-key-fade-in">KEY XFADE IN / OUT (SEMITONES)</label>
            <div class="drawer-pair-inputs">
              <input type="number" id="inp-ext-key-fade-in" class="drawer-input" min="0" max="64" value="${keyFadeIn}" title="Key Crossfade In (semitones)" />
              <input type="number" id="inp-ext-key-fade-out" class="drawer-input" min="0" max="64" value="${keyFadeOut}" title="Key Crossfade Out (semitones)" />
            </div>
          </div>
          <div class="form-group">
            <label for="inp-ext-vel-fade-in">VEL XFADE IN / OUT (VELOCITY UNITS)</label>
            <div class="drawer-pair-inputs">
              <input type="number" id="inp-ext-vel-fade-in" class="drawer-input" min="0" max="127" value="${velFadeIn}" title="Velocity Crossfade In" />
              <input type="number" id="inp-ext-vel-fade-out" class="drawer-input" min="0" max="127" value="${velFadeOut}" title="Velocity Crossfade Out" />
            </div>
          </div>
        </div>
      </div>

      <!-- 2. Playback Rules: Inherited from Model Common vs Custom Region Exception -->
      <div class="inspector-section">
        <div class="inheritance-card ${hasPbOvr ? 'is-overridden' : 'is-inherited'}">
          <div class="inheritance-card-header">
            <div class="inheritance-status">
              <span class="inheritance-badge ${hasPbOvr ? 'is-override' : 'is-common'}">
                ${hasPbOvr ? 'CUSTOM EXCEPTION (OVR)' : 'INHERITED FROM MODEL COMMON'}
              </span>
              <span class="inheritance-desc">
                ${
                  hasPbOvr
                    ? 'This region uses custom playback rules instead of Model Common.'
                    : 'Replicated from Model Common. Toggle Custom Exception to override only for this region.'
                }
              </span>
            </div>
            <div class="inheritance-actions">
              <label class="articulation-toggle-label" title="Enable custom Loop Mode, Keytrack, Trigger &amp; XFade Curve exception for this region">
                <input type="checkbox" class="articulation-checkbox switch--sm" id="chk-reg-playback-override" ${hasPbOvr ? 'checked' : ''} />
                <span>Custom Exception</span>
              </label>
              <button type="button" class="btn btn-xs btn-ghost" id="btn-goto-model-common-pb" title="Edit Model Common Playback Defaults for all regions">
                Edit Common &rarr;
              </button>
            </div>
          </div>

          <div class="drawer-grid-4 ${hasPbOvr ? '' : 'is-inherited-disabled'}">
            <div class="form-group">
              <label for="sel-ext-loop-mode">LOOP MODE</label>
              <select id="sel-ext-loop-mode" class="drawer-select" ${hasPbOvr ? '' : 'disabled'}>
                <option value="no_loop" ${loopMode === 'no_loop' ? 'selected' : ''}>No Loop</option>
                <option value="loop_continuous" ${loopMode === 'loop_continuous' ? 'selected' : ''}>Continuous (Forward)</option>
                <option value="ping_pong" ${loopMode === 'ping_pong' ? 'selected' : ''}>Ping-Pong (⇄ Alternating)</option>
                <option value="loop_sustain" ${loopMode === 'loop_sustain' ? 'selected' : ''}>Sustain Loop</option>
                <option value="loop_backward" ${loopMode === 'loop_backward' ? 'selected' : ''}>Reverse Loop</option>
                <option value="one_shot" ${loopMode === 'one_shot' ? 'selected' : ''}>One Shot</option>
              </select>
            </div>
            <div class="form-group">
              <label for="inp-ext-keytrack">KEYTRACK (%)</label>
              <input type="number" id="inp-ext-keytrack" class="drawer-input" min="0" max="100" value="${keytrack}" ${hasPbOvr ? '' : 'disabled'} title="100% = Chromatic, 0% = Unpitched/Drum" />
            </div>
            <div class="form-group">
              <label for="sel-ext-trigger">TRIGGER</label>
              <select id="sel-ext-trigger" class="drawer-select" ${hasPbOvr ? '' : 'disabled'}>
                <option value="attack" ${triggerMode === 'attack' ? 'selected' : ''}>Attack</option>
                <option value="release" ${triggerMode === 'release' ? 'selected' : ''}>Release</option>
                <option value="first" ${triggerMode === 'first' ? 'selected' : ''}>First Note</option>
                <option value="legato" ${triggerMode === 'legato' ? 'selected' : ''}>Legato</option>
              </select>
            </div>
            <div class="form-group">
              <label for="sel-ext-fade-curve">XFADE CURVE</label>
              <select id="sel-ext-fade-curve" class="drawer-select" ${hasPbOvr ? '' : 'disabled'}>
                <option value="equal-power" ${fadeCurve === 'equal-power' ? 'selected' : ''}>Equal Power</option>
                <option value="linear" ${fadeCurve === 'linear' ? 'selected' : ''}>Linear</option>
                <option value="spectral-morph" ${fadeCurve === 'spectral-morph' ? 'selected' : ''}>Spectral Morph</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <!-- 3. Articulation Exception: Inherited from Global Instrument Articulation vs Custom Region ADSR/Filter -->
      <div class="inspector-section">
        <div class="inheritance-card ${hasArtOvr ? 'is-overridden' : 'is-inherited'}">
          <div class="inheritance-card-header">
            <div class="inheritance-status">
              <span class="inheritance-badge ${hasArtOvr ? 'is-override' : 'is-common'}">
                ${hasArtOvr ? 'CUSTOM ARTICULATION EXCEPTION' : 'INHERITED FROM MODEL ARTICULATION'}
              </span>
              <span class="inheritance-desc">
                ${
                  hasArtOvr
                    ? 'Custom per-region ADSR / Filter active for this sample.'
                    : 'Uses global Instrument Articulation (ADSR, Silver Filter, LFO).'
                }
              </span>
            </div>
            <div class="inheritance-actions">
              <label class="articulation-toggle-label" title="Override ADSR Envelope &amp; Filter Cutoff/Reso specifically for this region">
                <input type="checkbox" class="articulation-checkbox switch--sm" id="chk-reg-art-override" ${hasArtOvr ? 'checked' : ''} />
                <span>Custom ADSR / Filter</span>
              </label>
              <button type="button" class="btn btn-xs btn-ghost" id="btn-goto-model-common-art" title="Open Global Instrument Articulation">
                Edit Global &rarr;
              </button>
            </div>
          </div>

          ${
            hasArtOvr
              ? `
          <div class="drawer-grid-4">
            <div class="form-group">
              <label for="inp-reg-amp-a">ATTACK (S)</label>
              <input type="number" id="inp-reg-amp-a" class="drawer-input" min="0" max="12" step="0.01" value="${regAmpA}" />
            </div>
            <div class="form-group">
              <label for="inp-reg-amp-d">DECAY (S)</label>
              <input type="number" id="inp-reg-amp-d" class="drawer-input" min="0" max="15" step="0.01" value="${regAmpD}" />
            </div>
            <div class="form-group">
              <label for="inp-reg-amp-s">SUSTAIN (0..1)</label>
              <input type="number" id="inp-reg-amp-s" class="drawer-input" min="0" max="1" step="0.05" value="${regAmpS}" />
            </div>
            <div class="form-group">
              <label for="inp-reg-amp-r">RELEASE (S)</label>
              <input type="number" id="inp-reg-amp-r" class="drawer-input" min="0" max="15" step="0.01" value="${regAmpR}" />
            </div>
          </div>
          <div class="drawer-grid-2" style="margin-top: 6px;">
            <div class="form-group">
              <label for="inp-reg-flt-cut">REGION FILTER CUTOFF (HZ)</label>
              <input type="number" id="inp-reg-flt-cut" class="drawer-input" min="20" max="20000" step="10" value="${regFltCut}" />
            </div>
            <div class="form-group">
              <label for="inp-reg-flt-reso">REGION FILTER RESO (DB)</label>
              <input type="number" id="inp-reg-flt-reso" class="drawer-input" min="0" max="40" step="0.5" value="${regFltReso}" />
            </div>
          </div>
          `
              : ''
          }
        </div>
      </div>

      <!-- 4. Sample Acoustic Intelligence & Per-Sample 24/96 Action -->
      <div class="inspector-section section-acoustic-intel">
        <div class="section-header-row">
          <div class="section-title">SAMPLE ACOUSTIC INTELLIGENCE &amp; 24/96 PROMOTION</div>
          <div class="section-header-row">
            <button type="button" class="btn btn-xs btn-outline" id="btn-promote-zone-mw-reg" title="Promote this sample to 24-bit / 96.000 Hz Master Wave using the Model Common 24/96 standard">
              ${ICONS.wave} Promote This Sample (24b/96k)
            </button>
            <button type="button" class="btn btn-xs btn-accent" id="btn-auto-detect-zone-ext" title="Run YIN/MPM + HPS Pitch Detection &amp; Acoustic Parameter Set Classifier">
              ${ICONS.cpu} Auto-Detect Pitch &amp; Set
            </button>
          </div>
        </div>
        <div class="acoustic-intel-grid">
          <div class="acoustic-stat-chip">
            <span class="stat-chip-lbl">INSTRUMENT CATEGORY</span>
            <span class="stat-chip-val is-accent">${detectedCat}</span>
          </div>
          <div class="acoustic-stat-chip">
            <span class="stat-chip-lbl">RECOMMENDED SET</span>
            <span class="stat-chip-val">Set ${cls ? cls.recommendedParameterSet : 'Auto'} ${cls ? `(${Math.round(cls.confidence * 100)}%)` : ''}</span>
          </div>
          <div class="acoustic-stat-chip">
            <span class="stat-chip-lbl">DETECTED PITCH (F0)</span>
            <span class="stat-chip-val">${cls ? `${cls.descriptors.detectedF0Hz.toFixed(1)} Hz (${midiNoteToString(cls.descriptors.detectedMidiNote)})` : midiNoteToString(activeReg?.rootKey ?? z.rootKey)}</span>
          </div>
          <div class="acoustic-stat-chip">
            <span class="stat-chip-lbl">HARMONICITY / TYPE</span>
            <span class="stat-chip-val">${cls ? `${Math.round(cls.descriptors.harmonicity * 100)}% • ${cls.descriptors.isPercussiveOrNoise ? 'Perc/Noise' : 'Harmonic'}` : 'Harmonic'}</span>
          </div>
          <div class="acoustic-stat-chip">
            <span class="stat-chip-lbl">ATTACK / SUSTAIN</span>
            <span class="stat-chip-val">${cls ? `${cls.descriptors.attackMs} ms • ${Math.round(cls.descriptors.sustainRatio * 100)}%` : '—'}</span>
          </div>
          <div class="acoustic-stat-chip">
            <span class="stat-chip-lbl">STIFFNESS (B) / CENTROID</span>
            <span class="stat-chip-val">${cls ? `${cls.descriptors.inharmonicityB.toFixed(4)} • ${cls.descriptors.spectralCentroidHz} Hz` : '—'}</span>
          </div>
        </div>
        ${cls?.rationale ? `<div class="acoustic-rationale-banner">${cls.rationale}</div>` : ''}
      </div>
    `;
  }

export function renderModelCommonSectionsHtml(
  z: Zone,
  extRegions: ExtendedRegion[],
  deps: ModelCommonTemplateDeps
): string {
    const subTab = deps.activeModelSubTab;
    const commonPb =
      deps.getCommonPlayback?.() ?? createDefaultCommonPlayback();
    const pbOverrideCount = extRegions.filter((r) => r.hasPlaybackOverride).length;
    const artOverrideCount = extRegions.filter((r) => r.hasArticulationOverride).length;

    const art = deps.getArticulation?.();
    const mwCfg = deps.getMasterWaveConfig?.() ?? DEFAULT_MASTER_WAVE_CONFIG;
    const fmtInfo = deps.getZoneSampleFormatInfo?.(z.id) ?? null;
    const chBadge =
      fmtInfo?.numChannels === 4
        ? '4.0 Quad Surround'
        : fmtInfo?.numChannels === 2
          ? '2.0 Stereo'
          : fmtInfo?.numChannels === 1
            ? '1.0 Mono'
            : 'Unassigned';
    const fmtBadge = fmtInfo
      ? `${(fmtInfo.sampleRate / 1000).toFixed(1)} kHz / ${fmtInfo.bitsPerSample}-bit • ${chBadge} • ${fmtInfo.durationSec.toFixed(2)}s`
      : 'No Sample Loaded';

    const prov = deps.getModelProvenance?.() ?? null;
    const diag = deps.getAssetStoreDiagnostics?.() ?? null;
    const primaryLabel =
      prov?.primarySourceLayer === '02_legacy_original'
        ? '02_legacy_original (.scape/.sphere)'
        : '01_raw_source (Lossless WAV)';
    const activeLabel = prov?.activeAnalysisSourceLayer ?? '01_raw_source';
    const reprocessCnt = prov?.reprocessCount ?? 0;
    const storeKb = diag ? Math.round(diag.totalBytes / 1024) : 0;
    const storeBadge = diag
      ? `${diag.backend === 'indexeddb' ? 'IndexedDB' : 'Memory'} • ${storeKb} KB (${prov?.presentLayers.length ?? 0}/5 layers)`
      : '5-Layer Container';
    const layerList: Array<{
      id: '01_raw_source' | '02_legacy_original' | '03_enhanced_audio' | '04_classic_enhanced' | '05_extended_model';
      label: string;
    }> = [
      { id: '01_raw_source', label: '01 Raw Source' },
      { id: '02_legacy_original', label: '02 Legacy Orig' },
      { id: '03_enhanced_audio', label: '03 Master 24/96' },
      { id: '04_classic_enhanced', label: '04 Classic Enh' },
      { id: '05_extended_model', label: '05 Extended Mod' },
    ];

    const extMeta = deps.getExtendedMetadata?.() ?? {};
    const metaHasContent = Boolean(
      extMeta.author?.trim() ||
      extMeta.version?.trim() ||
      extMeta.license?.trim() ||
      extMeta.sourceUrl?.trim() ||
      extMeta.description?.trim() ||
      (extMeta.customAttributes && extMeta.customAttributes.length > 0)
    );

    return `
      <!-- Sub-navigation pills inside Model Common & Global Tab -->
      <div class="drawer-subtab-bar" role="tablist" aria-label="Model Common &amp; Global Subsections">
        <button
          type="button"
          role="tab"
          aria-selected="${subTab === 'common-playback'}"
          class="drawer-subtab-pill ${subTab === 'common-playback' ? 'is-active' : ''}"
          data-model-subtab="common-playback"
          title="Common Playback Defaults replicated across all regions unless a region enables Custom Exception"
        >
          ${ICONS.layers} <span>Common Playback</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected="${subTab === 'articulation'}"
          class="drawer-subtab-pill ${subTab === 'articulation' ? 'is-active' : ''}"
          data-model-subtab="articulation"
          title="Global Instrument Synth Articulation (ADSR Envelope, Silver Filter &amp; Isolated LFO)"
        >
          ${ICONS.sliders} <span>Instrument Articulation</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected="${subTab === 'master'}"
          class="drawer-subtab-pill ${subTab === 'master' ? 'is-active' : ''}"
          data-model-subtab="master"
          title="Model-Wide Master Wave 24-bit / 96 kHz Promotion Standard, Loop Expansion &amp; Quad Surround"
        >
          ${ICONS.wave} <span>Master 24/96 Standard</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected="${subTab === 'capsule'}"
          class="drawer-subtab-pill ${subTab === 'capsule' ? 'is-active' : ''}"
          data-model-subtab="capsule"
          title="5-Layer Time Capsule Container &amp; Zero Generation-Loss Lineage"
        >
          ${ICONS.database} <span>Time Capsule</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected="${subTab === 'metadata'}"
          class="drawer-subtab-pill ${subTab === 'metadata' ? 'is-active' : ''}"
          data-model-subtab="metadata"
          title="Extended Model Metadata, Licensing, Provenance &amp; Custom Tags for ABDAxionikVS"
        >
          ${ICONS.database} <span>Metadata &amp; Tags</span>
          ${metaHasContent ? '<span class="cell-ovr-badge">TAGS</span>' : ''}
        </button>
      </div>

      <!-- MODEL SUB-PANE 1: Common Playback Defaults -->
      <div class="drawer-subtab-pane ${subTab === 'common-playback' ? 'is-active' : 'is-hidden'}" data-model-subpane="common-playback">
        <div class="inspector-section">
          <div class="section-header-row">
            <div class="section-title">COMMON PLAYBACK DEFAULTS (REPLICATED TO ALL REGIONS)</div>
            <span class="val-pill">
              ${extRegions.length - pbOverrideCount}/${extRegions.length} inheriting${pbOverrideCount > 0 ? ` • ${pbOverrideCount} OVR` : ''}
            </span>
          </div>
          <div class="articulation-card is-enabled">
            <div class="articulation-card-header">
              <span class="stat-chip-lbl">
                Changes here automatically apply to all regions except those marked with a custom exception (OVR).
              </span>
              ${
                pbOverrideCount > 0
                  ? `<button type="button" class="btn btn-xs btn-outline" id="btn-reset-all-pb-overrides" title="Clear all regional playback exceptions so every region inherits Model Common">
                      Reset ${pbOverrideCount} Exception(s) to Common
                    </button>`
                  : ''
              }
            </div>
            <div class="drawer-grid-4">
              <div class="form-group">
                <label for="sel-common-loop-mode">DEFAULT LOOP MODE</label>
                <select id="sel-common-loop-mode" class="drawer-select">
                  <option value="no_loop" ${commonPb.loopMode === 'no_loop' ? 'selected' : ''}>No Loop</option>
                  <option value="loop_continuous" ${commonPb.loopMode === 'loop_continuous' ? 'selected' : ''}>Continuous (Forward)</option>
                  <option value="ping_pong" ${commonPb.loopMode === 'ping_pong' ? 'selected' : ''}>Ping-Pong (⇄ Alternating)</option>
                  <option value="loop_sustain" ${commonPb.loopMode === 'loop_sustain' ? 'selected' : ''}>Sustain Loop</option>
                  <option value="loop_backward" ${commonPb.loopMode === 'loop_backward' ? 'selected' : ''}>Reverse Loop</option>
                  <option value="one_shot" ${commonPb.loopMode === 'one_shot' ? 'selected' : ''}>One Shot</option>
                </select>
              </div>
              <div class="form-group">
                <label for="inp-common-keytrack">DEFAULT KEYTRACK (%)</label>
                <input type="number" id="inp-common-keytrack" class="drawer-input" min="0" max="100" value="${commonPb.pitchKeytrack}" title="100% = Chromatic instrument, 0% = Unpitched/Drum kit" />
              </div>
              <div class="form-group">
                <label for="sel-common-trigger">DEFAULT TRIGGER</label>
                <select id="sel-common-trigger" class="drawer-select">
                  <option value="attack" ${commonPb.trigger === 'attack' ? 'selected' : ''}>Attack</option>
                  <option value="release" ${commonPb.trigger === 'release' ? 'selected' : ''}>Release</option>
                  <option value="first" ${commonPb.trigger === 'first' ? 'selected' : ''}>First Note</option>
                  <option value="legato" ${commonPb.trigger === 'legato' ? 'selected' : ''}>Legato</option>
                </select>
              </div>
              <div class="form-group">
                <label for="sel-common-fade-curve">DEFAULT XFADE CURVE</label>
                <select id="sel-common-fade-curve" class="drawer-select">
                  <option value="equal-power" ${commonPb.fadeCurve === 'equal-power' ? 'selected' : ''}>Equal Power</option>
                  <option value="linear" ${commonPb.fadeCurve === 'linear' ? 'selected' : ''}>Linear</option>
                  <option value="spectral-morph" ${commonPb.fadeCurve === 'spectral-morph' ? 'selected' : ''}>Spectral Morph</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- MODEL SUB-PANE 2: Global Instrument Articulation (ADSR, Filter, LFO) -->
      <div class="drawer-subtab-pane ${subTab === 'articulation' ? 'is-active' : 'is-hidden'}" data-model-subpane="articulation">
        ${
          art
            ? `
        <div class="inspector-section section-articulation">
          <div class="section-header-row">
            <div class="section-title">INSTRUMENT SYNTH ARTICULATION (ADSR / FILTER / LFO &rarr; SAFE SOUND.SCRIPT)</div>
            <span class="val-pill">${extRegions.length - artOverrideCount}/${extRegions.length} inheriting</span>
          </div>

          <!-- Amp Envelope -->
          <div class="articulation-card ${art.ampEnvEnabled ? 'is-enabled' : ''}">
            <div class="articulation-card-header">
              <label class="articulation-toggle-label">
                <input type="checkbox" class="articulation-checkbox switch--sm" id="chk-art-amp-env" ${art.ampEnvEnabled ? 'checked' : ''} />
                <span>Export Amp Envelope (DAHDSR &rarr; R1AmpEnvA/D/S/R)</span>
              </label>
              <label class="articulation-sub-toggle" title="Bake amplitude decay contour into classic wave before analysis">
                <input type="checkbox" class="articulation-checkbox switch--sm" id="chk-art-bake-env" ${art.bakeEnvelopeIntoWave ? 'checked' : ''} />
                <span>Bake ADSR</span>
              </label>
            </div>
            <div class="drawer-grid-4">
              <div class="form-group">
                <label for="inp-art-amp-a">ATTACK (S)</label>
                <input type="number" id="inp-art-amp-a" class="drawer-input" min="0" max="12" step="0.01" value="${art.ampEnv.attackSec}" />
              </div>
              <div class="form-group">
                <label for="inp-art-amp-d">DECAY (S)</label>
                <input type="number" id="inp-art-amp-d" class="drawer-input" min="0" max="15" step="0.01" value="${art.ampEnv.decaySec}" />
              </div>
              <div class="form-group">
                <label for="inp-art-amp-s">SUSTAIN (0..1)</label>
                <input type="number" id="inp-art-amp-s" class="drawer-input" min="0" max="1" step="0.05" value="${art.ampEnv.sustainLevel}" />
              </div>
              <div class="form-group">
                <label for="inp-art-amp-r">RELEASE (S)</label>
                <input type="number" id="inp-art-amp-r" class="drawer-input" min="0" max="15" step="0.01" value="${art.ampEnv.releaseSec}" />
              </div>
            </div>
          </div>

          <!-- Filter -->
          <div class="articulation-card ${art.filter.enabled ? 'is-enabled' : ''}">
            <div class="articulation-card-header">
              <label class="articulation-toggle-label">
                <input type="checkbox" class="articulation-checkbox switch--sm" id="chk-art-filter" ${art.filter.enabled ? 'checked' : ''} />
                <span>Export Filter (Silver Filter Cutoff / Reso / Env)</span>
              </label>
            </div>
            <div class="drawer-grid-3">
              <div class="form-group">
                <label for="sel-art-filter-type">TYPE</label>
                <select id="sel-art-filter-type" class="drawer-select">
                  <option value="lpf" ${art.filter.type === 'lpf' ? 'selected' : ''}>LPF (Low-Pass)</option>
                  <option value="bpf" ${art.filter.type === 'bpf' ? 'selected' : ''}>BPF (Band-Pass)</option>
                  <option value="hpf" ${art.filter.type === 'hpf' ? 'selected' : ''}>HPF (High-Pass)</option>
                </select>
              </div>
              <div class="form-group">
                <label for="inp-art-filter-cutoff">CUTOFF (HZ)</label>
                <input type="number" id="inp-art-filter-cutoff" class="drawer-input" min="20" max="20000" step="10" value="${art.filter.cutoffHz}" />
              </div>
              <div class="form-group">
                <label for="inp-art-filter-reso">RESO (DB)</label>
                <input type="number" id="inp-art-filter-reso" class="drawer-input" min="0" max="40" step="0.5" value="${art.filter.resonanceDb}" />
              </div>
            </div>
          </div>

          <!-- Vibrato / Mod LFO -->
          <div class="articulation-card ${art.vibLfo.enabled ? 'is-enabled' : ''}">
            <div class="articulation-card-header">
              <label class="articulation-toggle-label" title="Safe-mapped: Scape, Sphere & Blender LFO depths are explicitly locked to 0 so LFO never causes unwanted spectral morphing">
                <input type="checkbox" class="articulation-checkbox switch--sm" id="chk-art-lfo" ${art.vibLfo.enabled ? 'checked' : ''} />
                <span>Export LFO (Isolated Pitch / Filter / Amp &mdash; Scape/Sphere Zeroed)</span>
              </label>
            </div>
            <div class="drawer-grid-3">
              <div class="form-group">
                <label for="inp-art-lfo-freq">RATE (HZ)</label>
                <input type="number" id="inp-art-lfo-freq" class="drawer-input" min="0.05" max="30" step="0.1" value="${art.vibLfo.freqHz}" />
              </div>
              <div class="form-group">
                <label for="inp-art-lfo-delay">DELAY (S)</label>
                <input type="number" id="inp-art-lfo-delay" class="drawer-input" min="0" max="10" step="0.05" value="${art.vibLfo.delaySec}" />
              </div>
              <div class="form-group">
                <label for="inp-art-lfo-pitch">PITCH (CENTS)</label>
                <input type="number" id="inp-art-lfo-pitch" class="drawer-input" min="-1200" max="1200" step="5" value="${art.vibLfo.toPitchCents}" />
              </div>
            </div>
          </div>
        </div>`
            : ''
        }
      </div>

      <!-- MODEL SUB-PANE 3: Master Wave 24-bit / 96 kHz Standard -->
      <div class="drawer-subtab-pane ${subTab === 'master' ? 'is-active' : 'is-hidden'}" data-model-subpane="master">
        <div class="inspector-section">
          <div class="section-header-row">
            <div class="section-title">MODEL-WIDE MASTER WAVE STANDARD (24-BIT / 96 KHZ &amp; SURROUND)</div>
            <span class="val-pill" title="Current Selected Sample Format">${fmtBadge}</span>
          </div>
          <div class="articulation-card is-enabled">
            <div class="drawer-grid-3">
              <div class="form-group">
                <label for="sel-mw-method" title="Selects how audio is promoted to 24-bit / 96.000 Hz Master Wave across the instrument">PROMOTION ENGINE (MODEL STANDARD)</label>
                <select id="sel-mw-method" class="drawer-select">
                  <option value="direct-conversion" ${mwCfg.promotionMethod === 'direct-conversion' ? 'selected' : ''}>Direct (Sinc 96k / 24b)</option>
                  <option value="dsp-enhanced" ${mwCfg.promotionMethod === 'dsp-enhanced' ? 'selected' : ''}>DSP Enhanced (BWE + DeNoise)</option>
                  <option value="ai-bridge" ${mwCfg.promotionMethod === 'ai-bridge' ? 'selected' : ''}>AI Bridge (AudioSR/BigVGAN)</option>
                </select>
              </div>
              <div class="form-group">
                <label for="sel-mw-channels" title="Preserve original channels or expand instrument to Stereo 2.0 or Quad Surround 4.0">SPATIAL CHANNELS</label>
                <select id="sel-mw-channels" class="drawer-select">
                  <option value="original" ${mwCfg.channelLayout === 'original' ? 'selected' : ''}>Original Channels</option>
                  <option value="stereo" ${mwCfg.channelLayout === 'stereo' ? 'selected' : ''}>Stereo 2.0 (Mono-Safe)</option>
                  <option value="quad-surround" ${mwCfg.channelLayout === 'quad-surround' ? 'selected' : ''}>Quad Surround 4.0 (Neuron)</option>
                </select>
              </div>
              <div class="form-group">
                <label for="inp-mw-loop-sec" title="Unroll short SF2/WAV loops to X seconds with organic modulation & zero-crossing Auto-Loop Finder (0 = keep original length)">MIN LOOP DURATION (S)</label>
                <input type="number" id="inp-mw-loop-sec" class="drawer-input" min="0" max="16" step="0.5" value="${mwCfg.minLoopDurationSec}" />
              </div>
            </div>
            <div class="articulation-card-header">
              <label class="articulation-sub-toggle" title="Harmonic Bandwidth Extension up to 42 kHz in 96 kHz Master Wave">
                <input type="checkbox" class="articulation-checkbox switch--sm" id="chk-mw-bwe" ${mwCfg.enableBandwidthExtension ? 'checked' : ''} />
                <span>Ultrasonic BWE (42 kHz Air)</span>
              </label>
              <label class="articulation-sub-toggle" title="Suppress quantization floor noise from legacy 8/16-bit samples">
                <input type="checkbox" class="articulation-checkbox switch--sm" id="chk-mw-denoise" ${mwCfg.enableDenoiseGate ? 'checked' : ''} />
                <span>Quantization De-Noise Gate</span>
              </label>
              <div class="section-header-row">
                <button type="button" class="btn btn-xs btn-outline" id="btn-promote-zone-mw" title="Promote only the currently selected sample to 24-bit / 96.000 Hz Master Wave">
                  ${ICONS.wave} Promote Selected Sample
                </button>
                <button type="button" class="btn btn-xs btn-accent" id="btn-promote-all-mw" title="Promote all samples in the model to 24-bit / 96.000 Hz Master Wave">
                  ${ICONS.layers} Promote All Samples (24b/96k)
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- MODEL SUB-PANE 4: 5-Layer Time Capsule Container & Anti-Photocopy Lineage -->
      <div class="drawer-subtab-pane ${subTab === 'capsule' ? 'is-active' : 'is-hidden'}" data-model-subpane="capsule">
        <div class="inspector-section">
          <div class="section-header-row">
            <div class="section-title">TIME CAPSULE (5-LAYER CONTAINER &amp; ANTI-PHOTOCOPY LINEAGE)</div>
            <span class="val-pill" title="NeuronAssetStore Persistence Status">${storeBadge}</span>
          </div>

          <div class="acoustic-intel-grid">
            <div class="acoustic-stat-chip is-present">
              <span class="stat-chip-lbl">PUREST ORIGIN LAYER</span>
              <span class="stat-chip-val is-accent" title="${primaryLabel}">${primaryLabel}</span>
            </div>
            <div class="acoustic-stat-chip is-present">
              <span class="stat-chip-lbl">ACTIVE ANALYSIS INPUT</span>
              <span class="stat-chip-val" title="${activeLabel}">${activeLabel}</span>
            </div>
            <div class="acoustic-stat-chip is-present">
              <span class="stat-chip-lbl">REPROCESS PASSES</span>
              <span class="stat-chip-val">${reprocessCnt} (0 Gen-Loss)</span>
            </div>
          </div>

          <div class="section-title" style="margin-top: var(--space-3);">CONTAINER LAYERS (01 .. 05)</div>
          <div class="acoustic-intel-grid">
            ${layerList
              .map((l) => {
                const st = prov?.layerStats?.[l.id];
                const kb = st ? (st.totalBytes / 1024).toFixed(1) : '0.0';
                const isPresent = Boolean(st?.present);
                return `
            <div class="acoustic-stat-chip ${isPresent ? 'is-present' : 'is-empty'}">
              <span class="stat-chip-lbl">${l.label.toUpperCase()}</span>
              <span class="stat-chip-val">${isPresent ? `${st!.fileCount} file(s) • ${kb} KB` : 'Empty (—)'}</span>
            </div>`;
              })
              .join('')}
          </div>

          <div class="articulation-card is-enabled" style="margin-top: var(--space-3);">
            <div class="articulation-card-header">
              <span class="stat-chip-lbl" title="Guarantees re-analysis always pulls from 01_raw_source or 02_legacy_original, never re-compressing 04_classic_enhanced">
                Zero Generation-Loss Lineage Active
              </span>
              <div class="section-header-row">
                <button type="button" class="btn btn-xs btn-accent" id="btn-reprocess-purest" title="Re-analyze all zones strictly from purest origin layer (01_raw_source or 02_legacy_original) with zero generation loss">
                  ${ICONS.cpu} Reprocess Purest Source
                </button>
                <button type="button" class="btn btn-xs btn-outline" id="btn-export-time-capsule" title="Export 5-Layer Multi-Format Time Capsule (.zip) with manifest.json & provenance.json">
                  ${ICONS.database} Export Time Capsule (.zip)
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- MODEL SUB-PANE 5: Metadata & Provenance (Extended Mode / ABDAxionikVS) -->
      <div class="drawer-subtab-pane ${subTab === 'metadata' ? 'is-active' : 'is-hidden'}" data-model-subpane="metadata">
        ${renderModelMetadataPaneHtml(deps.extendedMetadata)}
      </div>
    `;
  }

export function renderModelMetadataPaneHtml(
  extendedMetadata: ExtendedModelMetadata | undefined
): string {
    const meta = extendedMetadata ?? {};
    const customAttrs = meta.customAttributes ?? [];

    const renderTagOptions = (selectedKey: string): string => {
      const isCustom = !findStandardTagDef(selectedKey);
      const categories: Array<'SoundFont 2 (RIFF INFO)' | 'Studio & Recording Chain' | 'Acoustic & Instrument Identity' | 'Sampler & Performance'> = [
        'SoundFont 2 (RIFF INFO)',
        'Studio & Recording Chain',
        'Acoustic & Instrument Identity',
        'Sampler & Performance',
      ];

      let html = `<option value="__custom__" ${isCustom ? 'selected' : ''}>★ Custom Tag...</option>`;

      for (const cat of categories) {
        const tagsInCat = STANDARD_SOUNDFONT_TAGS.filter((t) => t.category === cat);
        if (tagsInCat.length === 0) continue;
        html += `<optgroup label="${escAttr(cat)}">`;
        for (const t of tagsInCat) {
          const isSel = !isCustom && t.key.toLowerCase() === selectedKey.trim().toLowerCase();
          html += `<option value="${escAttr(t.key)}" ${isSel ? 'selected' : ''}>${escHtml(t.label)}</option>`;
        }
        html += `</optgroup>`;
      }

      return html;
    };

    return `
      <div class="inspector-section">
        <div class="section-header-row">
          <div class="section-title">EXTENDED MODEL METADATA &amp; PROVENANCE (ABDAXIONIKVS)</div>
          <span class="val-pill">Layer 05 / AxionikDB</span>
        </div>

        <div class="extended-meta-body" style="display: flex; flex-direction: column; gap: 10px;">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
            <div class="form-group" style="margin-bottom: 0;">
              <label for="drawer-meta-inp-author" style="font-size: 10px; text-transform: uppercase; color: var(--color-text-muted); font-weight: 700;">Author / Creator</label>
              <input type="text" id="drawer-meta-inp-author" class="form-control" value="${escAttr(meta.author ?? '')}" placeholder="Sound designer or creator name..." />
            </div>
            <div class="form-group" style="margin-bottom: 0;">
              <label for="drawer-meta-inp-version" style="font-size: 10px; text-transform: uppercase; color: var(--color-text-muted); font-weight: 700;">Version</label>
              <input type="text" id="drawer-meta-inp-version" class="form-control" value="${escAttr(meta.version ?? '1.0.0')}" placeholder="1.0.0" />
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
            <div class="form-group" style="margin-bottom: 0;">
              <label for="drawer-meta-inp-license" style="font-size: 10px; text-transform: uppercase; color: var(--color-text-muted); font-weight: 700;">License</label>
              <input type="text" id="drawer-meta-inp-license" class="form-control" value="${escAttr(meta.license ?? '')}" placeholder="e.g. CC-BY 4.0, CC0, Commercial" />
            </div>
            <div class="form-group" style="margin-bottom: 0;">
              <label for="drawer-meta-inp-source-url" style="font-size: 10px; text-transform: uppercase; color: var(--color-text-muted); font-weight: 700;">Source / Origin URL</label>
              <div style="display: flex; gap: 4px;">
                <input type="url" id="drawer-meta-inp-source-url" class="form-control" value="${escAttr(meta.sourceUrl ?? '')}" placeholder="https://..." style="flex: 1;" />
                ${meta.sourceUrl ? `<a href="${escAttr(meta.sourceUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-xs btn-outline" title="Open URL in browser">${ICONS.externalLink}</a>` : ''}
              </div>
            </div>
          </div>

          <div class="form-group" style="margin-bottom: 0;">
            <label for="drawer-meta-inp-description" style="font-size: 10px; text-transform: uppercase; color: var(--color-text-muted); font-weight: 700;">Description &amp; Performance Notes</label>
            <textarea id="drawer-meta-inp-description" class="form-control" rows="3" placeholder="Acoustic characteristics, microphone placement, performance suggestions...">${escHtml(meta.description ?? '')}</textarea>
          </div>

          <!-- Free-form & Standard SoundFont Tag/Value Attributes -->
          <div class="custom-attributes-wrap" style="border-top: 1px dashed var(--color-panel-border); padding-top: 10px; margin-top: 4px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--color-text-muted);">
                SoundFont &amp; Sampler Metadata Tags (${customAttrs.length})
              </span>
              <button type="button" class="btn btn-xs btn-outline" id="btn-drawer-add-meta-tag" title="Add metadata tag (Standard SoundFont RIFF INFO or Custom tag)">
                ${ICONS.plus} Add Metadata Tag
              </button>
            </div>

            <div id="drawer-custom-meta-tags-list" style="display: flex; flex-direction: column; gap: 8px;">
              ${
                customAttrs.length === 0
                  ? `<div class="text-muted" style="font-size: 11px; font-style: italic; padding: 4px 0;">No tags defined. Click "+ Add Metadata Tag" to attach SoundFont RIFF INFO or studio attributes.</div>`
                  : customAttrs
                      .map((attr, idx) => {
                        const tagDef = findStandardTagDef(attr.tag);
                        const isCustom = !tagDef;
                        const valPlaceholder = tagDef?.placeholder ?? 'Enter custom tag value...';

                        return `
                          <div class="custom-attr-card" data-index="${idx}" style="display: flex; flex-direction: column; gap: 6px; padding: 8px; background: var(--color-panel-surface-elevated); border: 1px solid var(--color-panel-border-dim); border-radius: var(--radius-sm);">
                            <div style="display: flex; gap: 6px; align-items: center;">
                              <select class="form-control sel-drawer-meta-tag" data-index="${idx}" style="flex: ${isCustom ? '1' : '2'}; font-size: 11px; font-weight: 600;">
                                ${renderTagOptions(attr.tag)}
                              </select>
                              ${
                                isCustom
                                  ? `<input type="text" class="form-control inp-drawer-meta-tag" data-index="${idx}" value="${escAttr(attr.tag)}" placeholder="Tag name (e.g. Mic)" style="flex: 1; font-size: 11px;" />`
                                  : ''
                              }
                              <button type="button" class="btn btn-xs btn-ghost btn-danger-hover btn-drawer-remove-meta-tag" data-index="${idx}" title="Remove metadata tag">
                                ${ICONS.trash}
                              </button>
                            </div>
                            <input type="text" class="form-control inp-drawer-meta-val" data-index="${idx}" value="${escAttr(attr.value)}" placeholder="${escAttr(valPlaceholder)}" style="font-size: 11px;" />
                            ${tagDef ? `<div style="font-size: 10px; color: var(--color-text-dim); padding-left: 2px;">${escHtml(tagDef.description)}</div>` : ''}
                          </div>
                        `;
                      })
                      .join('')
              }
            </div>
          </div>
        </div>
      </div>
    `;
  }
