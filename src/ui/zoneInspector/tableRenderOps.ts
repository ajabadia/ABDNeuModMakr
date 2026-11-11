import { escHtml } from '../escape.ts';
import { tApp } from '../../core/i18n.ts';
import { analyzeExtendedIntersections } from '../../core/extendedAdapter.ts';
import { analyzeDrumCollisions } from '../../core/gmDrumMap.ts';
import { midiNoteToString } from '../ZoneRibbon.ts';
import type { InspectorContext } from './types.ts';
import { ICONS } from '../icons';
import { basenameOf } from './zoneTemplates.ts';
import { escAttr } from '../escape';
import { formatGmDrumLabel } from '../../core/gmDrumMap';
import { midiToNoteName } from '../ZoneRibbon';


export function renderTable(ui: InspectorContext): void {
  if (!ui.state.currentZone) {
    ui.state.container.innerHTML = `
      <div class="zone-inspector-empty">
        <div class="empty-icon">${ICONS.layers}</div>
        <div class="empty-text">${escHtml(tApp('zoneInspector.emptyNoZone'))}</div>
      </div>
    `;
    return;
  }

  const z = ui.state.currentZone;
  const isExtended = ui.state.workingMode === 'extended';

  if (isExtended) {
    const { regions, activeRegion, activeIndex } = ui.getExtendedContext();
    if (regions.length > 0 && activeRegion) {
      const canDeleteReg = regions.length > 1;
      const sampleTitle = basenameOf(activeRegion.sampleName);
      const extReport = analyzeExtendedIntersections(regions);
      const intersectCount = extReport.totalIntersectingPairs;
      const intersectBadgeHtml =
        intersectCount > 0
          ? `<span class="panel-badge is-overlap-badge" title="${escAttr(tApp('zoneInspector.intersectionTitle', { count: intersectCount }))}">${ICONS.alert} ${escHtml(tApp(intersectCount > 1 ? 'zoneInspector.intersectionsBadge' : 'zoneInspector.intersectionBadge', { count: intersectCount }))}</span>`
          : '';

      const isDrumMode = ui.state.keyMappingMode === 'drum';
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
      const drumCollisionBadgeHtml =
        drumCollisionReport && drumCollisionReport.totalCollisions > 0
          ? `<span class="panel-badge is-collision-badge" title="${escAttr(tApp('zoneInspector.drumCollisionTitle', { count: drumCollisionReport.totalCollisions }))}">${ICONS.alert} ${escHtml(tApp(drumCollisionReport.totalCollisions > 1 ? 'zoneInspector.drumCollisionsBadge' : 'zoneInspector.drumCollisionBadge', { count: drumCollisionReport.totalCollisions }))}</span>`
          : '';

      ui.state.container.innerHTML = `
        <div class="zone-inspector-panel">
          <!-- Extended Mode 2D Multi-Region Sampler Table (1 Row per Sampler Region) -->
          <div class="zone-table-card" data-ai-target="inspector-zone-range">
            <div class="zone-table-toolbar">
              <div class="key-mapping-mode-group">
                <span class="toolbar-mode-label">${escHtml(tApp('zoneInspector.keyMapLabel'))}</span>
                <button type="button" class="btn btn-xs ${!isDrumMode ? 'btn-accent is-active' : 'btn-outline'}" id="btn-map-mode-chromatic" title="${escAttr(tApp('zoneInspector.modeChromaticTitle'))}">
                  ${ICONS.piano} ${escHtml(tApp('zoneInspector.modeChromatic'))}
                </button>
                <button type="button" class="btn btn-xs ${isDrumMode ? 'btn-accent is-active' : 'btn-outline'}" id="btn-map-mode-drum" title="${escAttr(tApp('zoneInspector.modeDrumTitle'))}">
                  ${ICONS.drum} ${escHtml(tApp('zoneInspector.modeDrum'))}
                </button>
                <div class="keymap-bpm-group" style="display: inline-flex; align-items: center; gap: 3px; margin-left: 6px; padding-left: 8px; border-left: 1px solid var(--border-subtle);">
                  <label for="input-keymap-bpm" class="toolbar-mode-label" title="${escAttr(tApp('zoneInspector.bpmLabelTitle'))}">BPM:</label>
                  <button type="button" class="btn btn-xs btn-outline" id="btn-keymap-bpm-dec" style="padding: 2px 5px; min-width: 22px; height: 24px;" title="${escAttr(tApp('zoneInspector.bpmDecTitle'))}" aria-label="${escAttr(tApp('zoneInspector.bpmDecTitle'))}">${ICONS.caretLeft}</button>
                  <input type="text" inputmode="numeric" id="input-keymap-bpm" class="form-control" value="${ui.getEffectiveBpm()}" style="width: 44px; height: 24px; padding: 2px 4px; text-align: center; font-size: var(--text-xs); font-variant-numeric: tabular-nums;" title="${escAttr(tApp('zoneInspector.bpmInputTitle'))}" />
                  <button type="button" class="btn btn-xs btn-outline" id="btn-keymap-bpm-inc" style="padding: 2px 5px; min-width: 22px; height: 24px;" title="${escAttr(tApp('zoneInspector.bpmIncTitle'))}" aria-label="${escAttr(tApp('zoneInspector.bpmIncTitle'))}">${ICONS.caretRight}</button>
                  <button type="button" class="btn btn-xs ${ui.state.isPlayingSequence ? 'btn-accent is-active' : 'btn-outline'}" id="btn-keymap-play-seq" title="${escAttr(ui.state.isPlayingSequence ? tApp('zoneInspector.seqStopTitle') : tApp('zoneInspector.seqPlayTitle'))}">
                    ${ui.state.isPlayingSequence ? ICONS.stop : ICONS.play} Seq
                  </button>
                </div>
              </div>
              <div class="panel-actions">
                <div class="keymap-tools-dropdown" id="keymap-tools-dropdown">
                  <button type="button" class="btn btn-xs btn-outline keymap-tools-toggle" id="btn-keymap-tools-toggle" aria-haspopup="true" aria-expanded="false" title="${escAttr(tApp('zoneInspector.toolsBtnTitle'))}">
                    ${ICONS.repair} ${escHtml(tApp('zoneInspector.toolsBtn'))}
                  </button>
                  <div class="keymap-tools-popover" id="keymap-tools-popover" role="menu">
                    <button type="button" class="keymap-tools-item" id="btn-open-recorder" role="menuitem" title="${escAttr(tApp('zoneInspector.toolRecordTitle'))}">
                      ${ICONS.mic} <span>${escHtml(tApp('zoneInspector.toolRecord'))}</span>
                    </button>
                    <button type="button" class="keymap-tools-item" id="btn-open-loop-drawer" data-ai-target="inspector-loop-btn" role="menuitem" title="${escAttr(tApp('zoneInspector.toolLoopEditorRegionTitle', { index: activeIndex + 1 }))}">
                      ${ICONS.wave} <span>${escHtml(tApp('zoneInspector.toolLoopEditor'))}</span>
                    </button>
                    <button type="button" class="keymap-tools-item" id="btn-autoloop-all-zones" role="menuitem" title="${escAttr(tApp('zoneInspector.toolAutoLoopAllTitle'))}">
                      ${ICONS.refresh} <span>${escHtml(tApp('zoneInspector.toolAutoLoopAll'))}</span>
                    </button>
                    <button type="button" class="keymap-tools-item" id="btn-open-autoslicer" role="menuitem" title="${escAttr(tApp('zoneInspector.toolAutoSlicerTitle'))}">
                      ${ICONS.scissors} <span>${escHtml(tApp('zoneInspector.toolAutoSlicer'))}</span>
                    </button>
                  </div>
                </div>
                <button type="button" class="btn btn-xs btn-outline ${ui.state.isSpectralVisible ? 'is-active' : ''}" id="btn-toggle-spectral" title="${escAttr(tApp('zoneInspector.btnSpectralTitle'))}">
                  ${ICONS.wave} ${escHtml(tApp('zoneInspector.btnSpectral'))}
                </button>
                <button type="button" class="btn btn-xs btn-outline" id="btn-open-zone-drawer" title="${escAttr(tApp('zoneInspector.btnEditRegionTitle', { index: activeIndex + 1 }))}">
                  ${ICONS.settings} ${escHtml(tApp('zoneInspector.btnEditRegion', { index: activeIndex + 1 }))}
                </button>
                <button type="button" class="btn btn-xs btn-outline" id="btn-open-model-common-drawer" title="${escAttr(tApp('zoneInspector.btnModelSettingsTitle'))}">
                  ${ICONS.sliders} ${escHtml(tApp('zoneInspector.btnModelSettings'))}
                </button>
                <button type="button" class="btn btn-xs btn-outline" id="btn-split-zone" title="${escAttr(tApp('zoneInspector.btnNewRegionTitle'))}">
                  ${ICONS.plus} ${escHtml(tApp('zoneInspector.btnNewRegion'))}
                </button>
                <button type="button" class="btn btn-xs btn-danger" id="btn-delete-zone" ${!canDeleteReg ? 'disabled' : ''} title="${escAttr(tApp('zoneInspector.btnRemoveRegionTitle'))}">
                  ${ICONS.trash} ${escHtml(tApp('zoneInspector.btnRemoveRegion'))}
                </button>
              </div>
            </div>
            <div class="zone-table-scroll" tabindex="0" role="region" aria-label="Extended 2D Sampler Regions Table">
              <table class="canonical-zone-table is-extended-table" aria-label="Extended 2D Sampler Regions Table">
                <thead>
                  <tr>
                    <th class="col-zone" title="Sampler Region Index">${escHtml(tApp('zoneInspector.colRegion'))}</th>
                    <th class="col-key" title="Region Start MIDI Note (0..127)">${escHtml(tApp('zoneInspector.colLowKey'))}</th>
                    <th class="col-key ${isDrumMode ? 'col-drum-piece' : ''}" title="${isDrumMode ? 'General MIDI Drum Piece and Root Note' : 'Sample Root / Unity Pitch MIDI Note (0..127)'}">${escHtml(isDrumMode ? tApp('zoneInspector.colDrumPiece') : tApp('zoneInspector.colRootKey'))}</th>
                    <th class="col-key" title="Region End MIDI Note (0..127)">${escHtml(tApp('zoneInspector.colHighKey'))}</th>
                    <th class="col-vel" title="Start Velocity (1..127)">${escHtml(tApp('zoneInspector.colLowVel'))}</th>
                    <th class="col-vel" title="End Velocity (1..127)">${escHtml(tApp('zoneInspector.colHighVel'))}</th>
                    <th class="col-sample" title="Assigned Audio Sample for this Region">${escHtml(tApp('zoneInspector.colSample'))}</th>
                    <th class="col-mode" title="Click any cell to open the Interactive Waveform Loop Editor">${escHtml(tApp('zoneInspector.colModeLoop'))}</th>
                    <th class="col-num" title="Fine Pitch Detune (-99..+99 cents)">${escHtml(tApp('zoneInspector.colDetune'))}</th>
                    <th class="col-num" title="Region Gain (-32..+12 dB)">${escHtml(tApp('zoneInspector.colVolume'))}</th>
                    <th class="col-num" title="Stereo Pan (-50..+50)">${escHtml(tApp('zoneInspector.colPan'))}</th>
                    <th class="col-edit" title="Audition / Edit Region Metadata &amp; Exceptions Drawer">${escHtml(tApp('zoneInspector.colAct'))}</th>
                  </tr>
                </thead>
                <tbody>
                  ${ui.renderExtendedRegionTableRows(regions, activeRegion.id)}
                </tbody>
              </table>
            </div>
            <div class="zone-table-footer">
              <div class="zone-table-status">
                <span class="panel-badge ${isDrumMode ? 'is-drum-mode-badge' : ''}">${isDrumMode ? `${ICONS.drum} ${escHtml(tApp('zoneInspector.footerGmDrum'))}` : escHtml(tApp('zoneInspector.footerRegionCount', { index: activeIndex + 1, total: regions.length }))}</span>
                ${isDrumMode ? drumCollisionBadgeHtml : intersectBadgeHtml}
                <span class="panel-caption">${isDrumMode ? `Drum: ${escHtml(formatGmDrumLabel(activeRegion.rootKey))} | Key: ${activeRegion.rootKey} (${midiToNoteName(activeRegion.rootKey)}) | Vel: ${activeRegion.lowVel}..${activeRegion.highVel}${sampleTitle ? ` | ${escHtml(sampleTitle)}` : ''}` : `${midiNoteToString(activeRegion.lowKey)} .. ${midiNoteToString(activeRegion.highKey)} | Root: ${midiNoteToString(activeRegion.rootKey)} | Vel: ${activeRegion.lowVel}..${activeRegion.highVel}${sampleTitle ? ` | ${escHtml(sampleTitle)}` : ` | ${escHtml(tApp('zoneInspector.emptySample'))}`}${ui.state.handlers.getDetectedCategory?.() ? ` • ${escHtml(ui.state.handlers.getDetectedCategory?.())}` : ''}`}</span>
              </div>
            </div>
          </div>
        </div>
      `;
      ui.bindTableEvents();
      return;
    }
  }

  const zonesList = ui.state.allZones.length > 0 ? ui.state.allZones : [z];
  const canDelete = ui.state.totalZones > 1;
  const canSplit = ui.state.totalZones < 128 && z.highKey > z.lowKey;

  const isDrumMode = ui.state.keyMappingMode === 'drum';
  const drumCollisionReport = isDrumMode
    ? analyzeDrumCollisions(
        zonesList.map((zn) => ({
          id: zn.id,
          lowKey: zn.lowKey,
          highKey: zn.highKey,
          rootKey: zn.rootKey,
          lowVel: 1,
          highVel: 127,
        }))
      )
    : null;
  const drumCollisionBadgeHtml =
    drumCollisionReport && drumCollisionReport.totalCollisions > 0
      ? `<span class="panel-badge is-collision-badge" title="${escAttr(tApp('zoneInspector.drumCollisionTitle', { count: drumCollisionReport.totalCollisions }))}">${ICONS.alert} ${escHtml(tApp(drumCollisionReport.totalCollisions > 1 ? 'zoneInspector.drumCollisionsBadge' : 'zoneInspector.drumCollisionBadge', { count: drumCollisionReport.totalCollisions }))}</span>`
      : '';

  ui.state.container.innerHTML = `
    <div class="zone-inspector-panel">
      <!-- Canonical Hartmann MODELmaker v1.2 Zone Table (1..128 Zones Max) -->
      <div class="zone-table-card">
        <div class="zone-table-toolbar">
          <div class="key-mapping-mode-group">
            <span class="toolbar-mode-label">${escHtml(tApp('zoneInspector.keyMapLabel'))}</span>
            <button type="button" class="btn btn-xs ${!isDrumMode ? 'btn-accent is-active' : 'btn-outline'}" id="btn-map-mode-chromatic" title="${escAttr(tApp('zoneInspector.modeChromaticTitle'))}">
              ${ICONS.piano} ${escHtml(tApp('zoneInspector.modeChromatic'))}
            </button>
            <button type="button" class="btn btn-xs ${isDrumMode ? 'btn-accent is-active' : 'btn-outline'}" id="btn-map-mode-drum" title="${escAttr(tApp('zoneInspector.modeDrumTitle'))}">
              ${ICONS.drum} ${escHtml(tApp('zoneInspector.modeDrum'))}
            </button>
            <div class="keymap-bpm-group" style="display: inline-flex; align-items: center; gap: 3px; margin-left: 6px; padding-left: 8px; border-left: 1px solid var(--border-subtle);">
              <label for="input-keymap-bpm" class="toolbar-mode-label" title="${escAttr(tApp('zoneInspector.bpmLabelTitle'))}">BPM:</label>
              <button type="button" class="btn btn-xs btn-outline" id="btn-keymap-bpm-dec" style="padding: 2px 5px; min-width: 22px; height: 24px;" title="${escAttr(tApp('zoneInspector.bpmDecTitle'))}" aria-label="${escAttr(tApp('zoneInspector.bpmDecTitle'))}">${ICONS.caretLeft}</button>
              <input type="text" inputmode="numeric" id="input-keymap-bpm" class="form-control" value="${ui.getEffectiveBpm()}" style="width: 44px; height: 24px; padding: 2px 4px; text-align: center; font-size: var(--text-xs); font-variant-numeric: tabular-nums;" title="${escAttr(tApp('zoneInspector.bpmInputTitle'))}" />
              <button type="button" class="btn btn-xs btn-outline" id="btn-keymap-bpm-inc" style="padding: 2px 5px; min-width: 22px; height: 24px;" title="${escAttr(tApp('zoneInspector.bpmIncTitle'))}" aria-label="${escAttr(tApp('zoneInspector.bpmIncTitle'))}">${ICONS.caretRight}</button>
              <button type="button" class="btn btn-xs ${ui.state.isPlayingSequence ? 'btn-accent is-active' : 'btn-outline'}" id="btn-keymap-play-seq" title="${escAttr(ui.state.isPlayingSequence ? tApp('zoneInspector.seqStopTitle') : tApp('zoneInspector.seqPlayTitle'))}">
                ${ui.state.isPlayingSequence ? ICONS.stop : ICONS.play} Seq
              </button>
            </div>
          </div>
          <div class="panel-actions">
            <div class="keymap-tools-dropdown" id="keymap-tools-dropdown">
              <button type="button" class="btn btn-xs btn-outline keymap-tools-toggle" id="btn-keymap-tools-toggle" aria-haspopup="true" aria-expanded="false" title="${escAttr(tApp('zoneInspector.toolsBtnTitle'))}">
                ${ICONS.repair} ${escHtml(tApp('zoneInspector.toolsBtn'))}
              </button>
              <div class="keymap-tools-popover" id="keymap-tools-popover" role="menu">
                <button type="button" class="keymap-tools-item" id="btn-open-recorder" role="menuitem" title="${escAttr(tApp('zoneInspector.toolRecordTitle'))}">
                  ${ICONS.mic} <span>${escHtml(tApp('zoneInspector.toolRecord'))}</span>
                </button>
                <button type="button" class="keymap-tools-item" id="btn-open-loop-drawer" data-ai-target="inspector-loop-btn" role="menuitem" title="${escAttr(tApp('zoneInspector.toolLoopEditorZoneTitle', { index: ui.state.zoneIndex + 1 }))}">
                  ${ICONS.wave} <span>${escHtml(tApp('zoneInspector.toolLoopEditor'))}</span>
                </button>
                <button type="button" class="keymap-tools-item" id="btn-autoloop-all-zones" role="menuitem" title="${escAttr(tApp('zoneInspector.toolAutoLoopAllTitle'))}">
                  ${ICONS.refresh} <span>${escHtml(tApp('zoneInspector.toolAutoLoopAll'))}</span>
                </button>
                <button type="button" class="keymap-tools-item" id="btn-open-autoslicer" role="menuitem" title="${escAttr(tApp('zoneInspector.toolAutoSlicerTitle'))}">
                  ${ICONS.scissors} <span>${escHtml(tApp('zoneInspector.toolAutoSlicer'))}</span>
                </button>
              </div>
            </div>
            <button type="button" class="btn btn-xs btn-outline ${ui.state.isSpectralVisible ? 'is-active' : ''}" id="btn-toggle-spectral" title="${escAttr(tApp('zoneInspector.btnSpectralTitle'))}">
              ${ICONS.wave} ${escHtml(tApp('zoneInspector.btnSpectral'))}
            </button>
            <button type="button" class="btn btn-xs btn-outline" id="btn-open-zone-drawer" title="${escAttr(tApp('zoneInspector.btnEditZoneTitle', { index: ui.state.zoneIndex + 1 }))}">
              ${ICONS.settings} ${escHtml(tApp('zoneInspector.btnEditZone', { index: ui.state.zoneIndex + 1 }))}
            </button>
            <button type="button" class="btn btn-xs btn-outline" id="btn-split-zone" ${!canSplit ? 'disabled' : ''} title="${escAttr(tApp('zoneInspector.btnNewZoneTitle'))}">
              ${ICONS.plus} ${escHtml(tApp('zoneInspector.btnNewZone'))}
            </button>
            <button type="button" class="btn btn-xs btn-danger" id="btn-delete-zone" ${!canDelete ? 'disabled' : ''} title="${escAttr(tApp('zoneInspector.btnRemoveZoneTitle'))}">
              ${ICONS.trash} ${escHtml(tApp('zoneInspector.btnRemoveZone'))}
            </button>
          </div>
        </div>
        <div class="zone-table-scroll" tabindex="0" role="region" aria-label="Canonical Hartmann Key Zone Table">
          <table class="canonical-zone-table" aria-label="Canonical Hartmann Key Zone Table">
            <thead>
              <tr>
                <th class="col-zone">${escHtml(tApp('zoneInspector.colZone'))}</th>
                <th class="col-key">${escHtml(tApp('zoneInspector.colLowKey'))}</th>
                <th class="col-key ${isDrumMode ? 'col-drum-piece' : ''}">${escHtml(isDrumMode ? tApp('zoneInspector.colDrumPiece') : tApp('zoneInspector.colRootKey'))}</th>
                <th class="col-key">${escHtml(tApp('zoneInspector.colHighKey'))}</th>
                <th class="col-sample">${escHtml(tApp('zoneInspector.colLowVel'))}</th>
                <th class="col-sample">${escHtml(tApp('zoneInspector.colHighVel'))}</th>
                <th class="col-num">${escHtml(tApp('zoneInspector.colDetune'))}</th>
                <th class="col-num">${escHtml(tApp('zoneInspector.colVolume'))}</th>
                <th class="col-num">${escHtml(tApp('zoneInspector.colPan'))}</th>
                <th class="col-edit" title="Audition / Edit Zone Metadata Drawer">${escHtml(tApp('zoneInspector.colAct'))}</th>
              </tr>
            </thead>
            <tbody>
              ${ui.renderZoneTableRows(zonesList, z.id)}
            </tbody>
          </table>
        </div>
        <div class="zone-table-footer">
          <div class="zone-table-status">
            <span class="panel-badge ${isDrumMode ? 'is-drum-mode-badge' : ''}">${isDrumMode ? `${ICONS.drum} ${escHtml(tApp('zoneInspector.footerGmDrum'))}` : escHtml(tApp('zoneInspector.footerZoneCount', { index: ui.state.zoneIndex + 1, total: ui.state.totalZones }))}</span>
            ${isDrumMode ? drumCollisionBadgeHtml : ''}
            <span class="panel-caption">${isDrumMode ? `Drum: ${escHtml(formatGmDrumLabel(z.rootKey))} | Key: ${z.rootKey} (${midiToNoteName(z.rootKey)})` : `${midiNoteToString(z.lowKey)} .. ${midiNoteToString(z.highKey)} | Root: ${midiNoteToString(z.rootKey)}`}</span>
          </div>
        </div>
      </div>
    </div>
  `;

  ui.bindTableEvents();
}
