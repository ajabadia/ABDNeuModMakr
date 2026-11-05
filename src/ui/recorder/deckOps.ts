import type { RecorderContext } from './types.ts';
import { mixToMono } from './recorderUtils.ts';
import type { AutoSamplerReleaseMode, AutoSamplerVelocityCurve, MidiCapturedNoteEvent } from '@abdsynths/shared/contracts/recordingSession';
import { computeVelocityLayers, midiNoteToStandardName, type NotesPerOctaveOption } from '@abdsynths/shared/dsp/take/takeDsp.ts';
import { applyPilotRecommendationToConfig, buildScheduleFromConfig, enforceAutoSamplerConfigCoherence, getMaxOctavesForStartOctave, resizeManualVelocityList, validateManualVelocities } from '../../core/autoSampler/MidiAutoSampleSession.ts';
import { FACTORY_DRUM_MAP_PRESETS, extractDrumMapFromManualTextDeterministic, getDrumMapFormatSpecificationHelpText, parseDrumHitMapFile } from '../../core/autoSampler/drumMapParser.ts';
import { isEs } from '../../core/i18n.ts';
import { downloadBlob } from '../download.ts';
import { escHtml } from '../escape.ts';
import { ICONS } from '../icons.ts';
import { toast } from '../notify.ts';

export function renderAutoSamplerDeck(ctx: RecorderContext): void {
    const slot = ctx.state.backdropEl?.querySelector<HTMLElement>('#rec-autosampler-deck-slot');
    if (!slot) return;
    if (ctx.state.operatingMode !== 'midi_autosampler') {
      slot.innerHTML = '';
      return;
    }

    const cfg = ctx.state.autoSamplerConfig;
    const isLive = cfg.mode === 'live_midi_capture';
    const isDrum = cfg.mode === 'drum_map';
    const selectedTake = ctx.getSelectedTake();
    const pendingCount = ctx.state.activeSchedule.filter(
      (e) => e.status === 'pending' || e.status === 'failed'
    ).length;
    const recordedCount = ctx.state.activeSchedule.filter((e) => e.status === 'recorded').length;
    const canResume =
      !isLive &&
      recordedCount > 0 &&
      pendingCount > 0 &&
      !ctx.state.isSweepRunning;

    const maxOctaves = getMaxOctavesForStartOctave(cfg.startOctave);
    const velValidation = validateManualVelocities(cfg.manualVelocities);
    const invalidVelIndices = new Set<number>([
      ...velValidation.duplicateIndices,
      ...velValidation.outOfRangeIndices,
    ]);
    const displayLayers = computeVelocityLayers({
      layerCount: cfg.velocityLayers,
      curve: cfg.velocityCurve,
      manualVelocities:
        cfg.velocityCurve === 'manual_table'
          ? velValidation.valid
            ? cfg.manualVelocities
            : velValidation.sanitizedVelocities
          : undefined,
    });
    const es = isEs();
    const curveSummaryPill =
      cfg.velocityLayers === 1 && cfg.velocityCurve !== 'manual_table'
        ? es
          ? `1L · Capa Única (v127)`
          : `1L · Single Layer (v127)`
        : `${cfg.velocityLayers}L · ${cfg.velocityCurve}`;

    slot.innerHTML = `
      <div class="nmm-audio-controls-card" id="as-config-card">
        <div class="nmm-recorder-inspector-head">
          <span class="nmm-recorder-inspector-title">
            ${isDrum ? ICONS.drum : ICONS.piano}
            ${
              isLive
                ? es
                  ? 'CAPTURA MIDI EN TIEMPO REAL (AUDIO + REGISTRO MIDI)'
                  : 'REAL-TIME MIDI PERFORMANCE CAPTURE (AUDIO + MIDI LOG)'
                : isDrum
                  ? es
                    ? 'AUTOSAMPLER DE PERCUSIÓN Y BATERÍA'
                    : 'PERCUSSION & DRUM KIT AUTOSAMPLER'
                  : es
                    ? 'BARRIDO PARAMÉTRICO DE AUTOSAMPLER MIDI'
                    : 'PARAMETRIC MIDI AUTOSAMPLER SWEEP'
            }
          </span>
          <div class="nmm-recorder-dsp-right">
            ${
              ctx.state.pilotDiagnosticText
                ? `<span class="val-pill font-mono">${escHtml(ctx.state.pilotDiagnosticText)}</span>`
                : `<span class="val-pill font-mono">RTL: ${cfg.calibratedLatencyMs.toFixed(1)} ms (${cfg.calibratedLatencySamples} smp)</span>`
            }
            ${
              ctx.state.lastPilotRecommendation
                ? `<button type="button" class="btn btn-xs btn-accent" id="btn-as-apply-pilot-rtl" title="${es ? `Aplicar RTL medida (${ctx.state.lastPilotRecommendation.latencyMs.toFixed(1)} ms) y recomendaciones de envolvente` : `Apply measured RTL (${ctx.state.lastPilotRecommendation.latencyMs.toFixed(1)} ms) and envelope recommendations`}">
                    ${ICONS.check} ${es ? `Aplicar RTL medida (${ctx.state.lastPilotRecommendation.latencyMs.toFixed(1)} ms)` : `Apply measured RTL (${ctx.state.lastPilotRecommendation.latencyMs.toFixed(1)} ms)`}
                  </button>`
                : ''
            }
            <button type="button" class="btn btn-xs btn-outline" id="btn-as-rescan-midi" title="${es ? 'Reescanear puertos WebMIDI' : 'Rescan WebMIDI ports'}">
              ${ICONS.refresh} ${es ? 'Puertos MIDI' : 'MIDI Ports'}
            </button>
            <button type="button" class="btn btn-xs btn-outline" id="btn-as-pilot-test" title="${es ? 'Disparar 1 nota piloto (C4) para medir latencia RTL, clipping y suelo de ruido' : 'Fire 1 pilot note (C4) to measure RTL latency, clipping, and noise floor'}">
              ${ICONS.zap} ${es ? 'Probar 1 Nota / Calibrar' : 'Test 1 Note / Calibrate'}
            </button>
          </div>
        </div>

        <!-- Fila 1 & 2: Puertos WebMIDI + Canal + Rango/Kit + Envolvente + Velocidades -->
        <div class="nmm-recorder-params-grid">
          <fieldset class="conditioned-fieldset" ${isLive ? 'disabled' : ''}>
            <div class="form-group ${isLive ? 'is-conditioned-disabled' : ''}">
              <div class="label-with-val">
                <label for="as-midi-out">
                  MIDI OUT (SYNTH / VST)
                  ${isLive ? `<span class="cond-reason-badge">${es ? 'SOLO BARRIDO' : 'SWEEP ONLY'}</span>` : ''}
                </label>
                <span class="val-pill font-mono">CH ${cfg.midiChannel}</span>
              </div>
              <div class="cfg-inline-row">
                <select id="as-midi-out" class="form-control form-control-sm cfg-flex-1"></select>
                <input type="number" id="as-midi-ch" class="form-control form-control-sm font-mono cfg-ordinal-input" min="1" max="16" value="${cfg.midiChannel}" title="${es ? 'Canal MIDI (1..16)' : 'MIDI Channel (1..16)'}" />
              </div>
            </div>
          </fieldset>

          <fieldset class="conditioned-fieldset" ${!isLive ? 'disabled' : ''}>
            <div class="form-group ${!isLive ? 'is-conditioned-disabled' : ''}">
              <div class="label-with-val">
                <label for="as-midi-in">
                  MIDI IN (KEYBOARD / CONTROLLER)
                  ${!isLive ? `<span class="cond-reason-badge">${es ? 'SOLO EN VIVO' : 'LIVE ONLY'}</span>` : ''}
                </label>
                <span class="val-pill font-mono">${isLive ? (es ? 'ACTIVO' : 'ACTIVE') : (es ? 'SOLO VIVO' : 'LIVE ONLY')}</span>
              </div>
              <select id="as-midi-in" class="form-control form-control-sm"></select>
            </div>
          </fieldset>

          ${
            !isLive && !isDrum
              ? `
            <div class="form-group">
              <div class="label-with-val">
                <label for="as-start-octave">${es ? 'OCTAVA INICIAL Y CANTIDAD' : 'START OCTAVE &amp; COUNT'}</label>
                <span class="val-pill font-mono">C${cfg.startOctave} (${cfg.octaveCount} oct · max ${maxOctaves})</span>
              </div>
              <div class="cfg-inline-row">
                <select id="as-start-octave" class="form-control form-control-sm cfg-flex-1">
                  ${[0, 1, 2, 3, 4, 5, 6]
                    .map(
                      (o) =>
                        `<option value="${o}" ${cfg.startOctave === o ? 'selected' : ''}>C${o} (MIDI ${(o + 1) * 12})</option>`
                    )
                    .join('')}
                </select>
                <input type="number" id="as-octave-count" class="form-control form-control-sm font-mono cfg-ordinal-input" min="1" max="${maxOctaves}" value="${cfg.octaveCount}" ${maxOctaves <= 1 ? `disabled title="${es ? 'Desde C6 solo cabe 1 octava dentro del rango MIDI 0..127' : 'From C6 only 1 octave fits within MIDI range 0..127'}"` : `title="${es ? `Número de octavas (1..${maxOctaves} desde C${cfg.startOctave})` : `Number of octaves (1..${maxOctaves} from C${cfg.startOctave})`}"`} />
              </div>
            </div>

            <div class="form-group">
              <div class="label-with-val">
                <label for="as-notes-per-oct">${es ? 'NOTAS POR OCTAVA' : 'NOTES PER OCTAVE'}</label>
                <span class="val-pill font-mono">${cfg.notesPerOctave}/oct</span>
              </div>
              <select id="as-notes-per-oct" class="form-control form-control-sm">
                <option value="1" ${cfg.notesPerOctave === 1 ? 'selected' : ''}>${es ? '1 por octava (Solo raíces C · cada 12 st)' : '1 per octave (Roots C only · 12 st)'}</option>
                <option value="2" ${cfg.notesPerOctave === 2 ? 'selected' : ''}>${es ? '2 por octava (Tritono · cada 6 st)' : '2 per octave (Tritone · every 6 st)'}</option>
                <option value="3" ${cfg.notesPerOctave === 3 ? 'selected' : ''}>${es ? '3 por octava (3ª Mayores · cada 4 st)' : '3 per octave (Major 3rds · every 4 st)'}</option>
                <option value="4" ${cfg.notesPerOctave === 4 ? 'selected' : ''}>${es ? '4 por octava (3ª Menores · cada 3 st)' : '4 per octave (Minor 3rds · every 3 st)'}</option>
                <option value="6" ${cfg.notesPerOctave === 6 ? 'selected' : ''}>${es ? '6 por octava (Tonos enteros · cada 2 st)' : '6 per octave (Whole tones · every 2 st)'}</option>
                <option value="12" ${cfg.notesPerOctave === 12 ? 'selected' : ''}>${es ? '12 por octava (Cromático · cada 1 st)' : '12 per octave (Chromatic · every 1 st)'}</option>
              </select>
            </div>
          `
              : ''
          }

          ${
            isDrum
              ? `
            <div class="form-group nmm-as-drum-group">
              <div class="label-with-val">
                <label for="as-drum-preset">${es ? 'KIT DE PERCUSIÓN / DRUM MAP' : 'PERCUSSION KIT / DRUM MAP'}</label>
                <span class="val-pill font-mono">${cfg.drumMap ? `${escHtml(cfg.drumMap.kitName)} (${cfg.drumMap.hits.length} hits)` : 'Standard Kit'}</span>
              </div>
              <div class="cfg-inline-row">
                <select id="as-drum-preset" class="form-control form-control-sm cfg-flex-1">
                  ${Object.entries(FACTORY_DRUM_MAP_PRESETS)
                    .map(
                      ([k, v]) =>
                        `<option value="${escHtml(k)}" ${(cfg.drumMap?.kitName ?? FACTORY_DRUM_MAP_PRESETS.tr808_909.kitName) === v.kitName ? 'selected' : ''}>${escHtml(v.kitName)}</option>`
                    )
                    .join('')}
                </select>
                <label class="btn btn-xs btn-outline" for="as-drum-file-inp" title="${es ? 'Importar mapa de golpes .txt, .json o .yaml' : 'Import .txt, .json, or .yaml drum hit-name map'}">
                  ${ICONS.upload} ${es ? 'Importar' : 'Import'}
                </label>
                <input type="file" id="as-drum-file-inp" accept=".txt,.csv,.json,.yaml,.yml" hidden />
                <button type="button" class="btn btn-xs btn-outline" id="btn-as-paste-manual" title="${es ? 'Pegar tabla desde manual PDF para extraer notas y nombres' : 'Paste table from PDF manual to extract notes and names'}">
                  ${ICONS.sparkle} ${es ? 'Pegar Tabla' : 'Paste Table'}
                </button>
                <button type="button" class="btn btn-xs btn-outline" id="btn-as-drum-spec" title="${es ? 'Ver especificación y descargar plantillas' : 'View specification and download templates'}">
                  ? ${es ? 'Plantillas' : 'Templates'}
                </button>
              </div>
            </div>
          `
              : ''
          }

          <fieldset class="conditioned-fieldset" ${isLive ? 'disabled' : ''}>
            <div class="form-group ${isLive ? 'is-conditioned-disabled' : ''}">
              <div class="label-with-val">
                <label for="as-gate-ms">
                  ${es ? 'DURACIÓN DE NOTA (GATE)' : 'NOTE DURATION (GATE)'}
                  ${isLive ? `<span class="cond-reason-badge">${es ? 'SOLO BARRIDO' : 'SWEEP ONLY'}</span>` : ''}
                </label>
                <span class="val-pill font-mono">${isLive ? 'REAL-TIME KEY' : `${cfg.gateDurationMs} ms`}</span>
              </div>
              <input type="number" id="as-gate-ms" class="form-control form-control-sm font-mono" min="80" max="15000" step="50" value="${cfg.gateDurationMs}" title="${es ? 'Duración de puerta (NoteOn a NoteOff en ms)' : 'Gate duration (NoteOn to NoteOff in ms)'}" />
            </div>
          </fieldset>

          <div class="form-group">
            <div class="label-with-val">
              <label for="as-release-mode">${es ? 'MODO DE COLA RELEASE Y MÁX' : 'RELEASE TAIL MODE &amp; MAX'}</label>
              <span class="val-pill font-mono">${cfg.releaseMode === 'auto_decay' ? `Auto-Decay (max ${cfg.maxReleaseMs}ms)` : `Fixed ${cfg.maxReleaseMs}ms`}</span>
            </div>
            <div class="cfg-inline-row">
              <select id="as-release-mode" class="form-control form-control-sm cfg-flex-1" title="${es ? 'Al enviar NoteOff el sonido puede seguir sonando: Auto-Decay espera hasta caer al suelo de ruido; Fijo espera los ms exactos' : 'When NoteOff is sent, sound may keep ringing: Auto-Detect waits until decay hits noise floor; Fixed waits exact ms'}">
                <option value="auto_decay" ${cfg.releaseMode === 'auto_decay' ? 'selected' : ''}>${es ? 'Auto-Decaimiento a Silencio' : 'Auto-Decay to Silence'}</option>
                <option value="fixed_time" ${cfg.releaseMode === 'fixed_time' ? 'selected' : ''}>${es ? 'Tiempo de Release Fijo' : 'Fixed Release Time'}</option>
              </select>
              <input type="number" id="as-release-ms" class="form-control form-control-sm font-mono cfg-ordinal-input" min="100" max="20000" step="100" value="${cfg.maxReleaseMs}" title="${es ? 'Tiempo máximo de cola release / Duración fija (ms)' : 'Max release timeout / Fixed release duration (ms)'}" />
            </div>
          </div>

          ${
            !isLive
              ? `
            <div class="form-group">
              <div class="label-with-val">
                <label for="as-vel-curve">
                  ${es ? 'CAPAS Y CURVA DE VELOCIDAD' : 'VELOCITY LAYERS &amp; CURVE'}
                  ${cfg.velocityCurve === 'classic_neuron_2layer' ? `<span class="cond-reason-badge is-classic-only">${es ? 'FIJA 2 CAPAS' : 'FIXED 2 LAYERS'}</span>` : cfg.velocityCurve === 'manual_table' ? `<span class="cond-reason-badge">${es ? 'TABLA MANUAL' : 'MANUAL TABLE'}</span>` : ''}
                </label>
                <span class="val-pill font-mono">${escHtml(curveSummaryPill)}</span>
              </div>
              <div class="cfg-inline-row">
                <input type="number" id="as-vel-layers" class="form-control form-control-sm font-mono cfg-ordinal-input" min="1" max="8" value="${cfg.velocityLayers}" ${cfg.velocityCurve === 'classic_neuron_2layer' ? `disabled title="${es ? 'Clásica Neuron fija siempre 2 capas (60 / 120)' : 'Classic Neuron always fixes 2 layers (60 / 120)'}"` : cfg.velocityCurve === 'manual_table' ? `disabled title="${es ? 'En Tabla Manual las capas se añaden o quitan con los botones de cada capa a la derecha' : 'In Manual Table layers are added or removed with the layer buttons on the right'}"` : `title="${es ? 'Número de capas de velocidad (1..8)' : 'Number of velocity layers (1..8)'}"`} />
                <select id="as-vel-curve" class="form-control form-control-sm cfg-flex-1">
                  ${
                    cfg.velocityLayers === 1 && cfg.velocityCurve !== 'manual_table'
                      ? `<option value="linear" selected>${es ? 'Capa Única (v127 · rango 1..127)' : 'Single Layer (v127 · range 1..127)'}</option>`
                      : `<option value="linear" ${cfg.velocityCurve === 'linear' ? 'selected' : ''}>${es ? 'Lineal (Equidistante)' : 'Linear (Equidistant)'}</option>`
                  }
                  <option value="high_precision" ${cfg.velocityCurve === 'high_precision' && cfg.velocityLayers > 1 ? 'selected' : ''} ${cfg.velocityLayers <= 1 ? 'disabled' : ''}>${es ? 'Logarítmica / Exponencial (+ precisión en altos 85..127)' : 'Logarithmic / Exponential (+ precision in highs 85..127)'}</option>
                  <option value="low_precision" ${cfg.velocityCurve === 'low_precision' && cfg.velocityLayers > 1 ? 'selected' : ''} ${cfg.velocityLayers <= 1 ? 'disabled' : ''}>${es ? 'Comprimida (+ precisión en bajos 1..65)' : 'Compressed (+ precision in lows 1..65)'}</option>
                  <option value="classic_neuron_2layer" ${cfg.velocityCurve === 'classic_neuron_2layer' ? 'selected' : ''}>${es ? 'Clásica Neuron (Fija 2 capas: 60 / 120)' : 'Classic Neuron (Fixed 2 layers: 60 / 120)'}</option>
                  <option value="manual_table" ${cfg.velocityCurve === 'manual_table' ? 'selected' : ''}>${es ? 'Tabla Manual por Capas (1..127)' : 'Manual Layer Table (1..127)'}</option>
                </select>
              </div>
            </div>

            <div class="form-group nmm-as-vel-viz-group">
              <div class="label-with-val">
                <label>${es ? 'MAPA DE DISTRIBUCIÓN DE VELOCIDAD (1..127)' : 'VELOCITY DISTRIBUTION MAP (1..127)'}</label>
                <span class="val-pill font-mono">${displayLayers.map((l) => `v${l.velocity}`).join(' / ')}</span>
              </div>
              <div class="nmm-vel-curve-viz" title="${es ? 'Representación gráfica de las capas de velocidad MIDI (altura = velocidad 1..127, ancho = rango [lowVel..highVel])' : 'Graphical representation of MIDI velocity layers (height = velocity 1..127, width = range [lowVel..highVel])'}">
                <div class="nmm-vel-curve-bars">
                  ${displayLayers
                    .map((layer, idx) => {
                      const span = Math.max(1, layer.highVel - layer.lowVel + 1);
                      const heightPct = Math.max(14, Math.round((layer.velocity / 127) * 100));
                      const isBad =
                        cfg.velocityCurve === 'manual_table' && invalidVelIndices.has(idx);
                      return `
                        <div class="nmm-vel-bar-col${isBad ? ' is-invalid' : ''}" style="flex: ${span} 1 0%;">
                          <span class="nmm-vel-bar-val">L${idx + 1} · v${layer.velocity}</span>
                          <div class="nmm-vel-bar-track">
                            <div class="nmm-vel-bar-fill" style="height: ${heightPct}%;"></div>
                          </div>
                        </div>
                      `;
                    })
                    .join('')}
                </div>
                <div class="nmm-vel-curve-ranges">
                  ${displayLayers
                    .map((layer) => {
                      const span = Math.max(1, layer.highVel - layer.lowVel + 1);
                      return `<span class="nmm-vel-range-lbl" style="flex: ${span} 1 0%;">[vel ${layer.lowVel}..${layer.highVel}]</span>`;
                    })
                    .join('')}
                </div>
                ${
                  cfg.velocityCurve === 'manual_table'
                    ? `
                      <div class="nmm-manual-vel-editor">
                        <div class="nmm-manual-vel-slots">
                          ${cfg.manualVelocities
                            .map((vel, idx) => {
                              const isBad = invalidVelIndices.has(idx);
                              return `
                                <div class="nmm-manual-vel-chip${isBad ? ' is-invalid' : ''}">
                                  <span class="nmm-manual-vel-tag">L${idx + 1}</span>
                                  <input
                                    type="number"
                                    class="nmm-manual-vel-input${isBad ? ' is-invalid' : ''}"
                                    data-manual-vel-idx="${idx}"
                                    min="1"
                                    max="127"
                                    value="${vel}"
                                    title="${es ? `Velocidad MIDI para la capa L${idx + 1} (1..127, sin duplicados)` : `MIDI velocity for layer L${idx + 1} (1..127, no duplicates)`}"
                                  />
                                  <button
                                    type="button"
                                    class="nmm-manual-vel-remove"
                                    data-remove-vel-idx="${idx}"
                                    ${cfg.manualVelocities.length <= 1 ? 'disabled' : ''}
                                    title="${es ? `Eliminar capa L${idx + 1}` : `Remove layer L${idx + 1}`}"
                                  >&times;</button>
                                </div>
                              `;
                            })
                            .join('')}
                          ${
                            cfg.manualVelocities.length < 8
                              ? `<button type="button" class="btn btn-xs btn-outline" id="btn-as-add-vel-layer" title="${es ? 'Añadir una nueva capa de velocidad (máx. 8)' : 'Add a new velocity layer (max 8)'}">
                                  + ${es ? 'Añadir capa' : 'Add layer'}
                                </button>`
                              : ''
                          }
                        </div>
                        ${
                          !velValidation.valid && velValidation.errorMessage
                            ? `<div class="nmm-vel-error-banner" role="alert">
                                <span>${escHtml(velValidation.errorMessage)}</span>
                                <button type="button" class="btn btn-xs btn-accent" id="btn-as-autofix-vels" title="${es ? 'Corregir rango 1..127, eliminar duplicados y ordenar de menor a mayor' : 'Fix 1..127 range, remove duplicates, and sort ascending'}">
                                  ${es ? 'Corregir y ordenar' : 'Fix &amp; sort'}
                                </button>
                              </div>`
                            : ''
                        }
                      </div>
                    `
                    : ''
                }
              </div>
            </div>
          `
              : ''
          }
        </div>

        ${
          isDrum && ctx.state.showDrumHelpPanel
            ? `<div class="raw-card">
                <div class="nmm-recorder-inspector-head">
                  <span class="raw-card-title">${es ? 'ESPECIFICACIÓN TÉCNICA PARA MAPAS DE BATERÍA (.TXT / .JSON / .YAML)' : 'TECHNICAL SPECIFICATION FOR DRUM HIT-NAME MAPS (.TXT / .JSON / .YAML)'}</span>
                  <div class="nmm-recorder-dsp-right">
                    <button type="button" class="btn btn-xs btn-outline" data-dl-template="txt">${ICONS.download} ${es ? 'Plantilla' : 'Template'} .txt</button>
                    <button type="button" class="btn btn-xs btn-outline" data-dl-template="json">${ICONS.download} ${es ? 'Plantilla' : 'Template'} .json</button>
                    <button type="button" class="btn btn-xs btn-outline" data-dl-template="yaml">${ICONS.download} ${es ? 'Plantilla' : 'Template'} .yaml</button>
                  </div>
                </div>
                <pre class="nmm-drum-help-pre">${escHtml(getDrumMapFormatSpecificationHelpText())}</pre>
              </div>`
            : ''
        }
        ${
          isDrum && ctx.state.showManualExtractorPanel
            ? `<div class="raw-card">
                <span class="raw-card-title">${es ? 'PEGAR TABLA DE MANUAL DE BATERÍA (EJ. "36 Bass Drum 1" O "C1: Kick")' : 'PASTE RAW DRUM MANUAL TABLE (E.G. "36 Bass Drum 1" OR "C1: Kick")'}</span>
                <textarea id="as-manual-raw-text" class="form-control font-mono" rows="3" placeholder="36 = Kick Drum&#10;38 = Snare Acoustic&#10;42 = Closed Hat&#10;46 = Open Hat"></textarea>
                <div class="nmm-recorder-dsp-right">
                  <button type="button" class="btn btn-xs btn-accent" id="btn-as-run-manual-extract">${ICONS.check} ${es ? 'Extraer Texto a Drum Map' : 'Parse Manual Text into Drum Map'}</button>
                </div>
              </div>`
            : ''
        }

        <!-- Opciones de Post-Procesado de Muestreo + Cuadrícula (oculta en Captura en Tiempo Real hasta que se graben notas) -->
        <div class="nmm-recorder-dsp-toolbar">
          <div class="nmm-recorder-dsp-left">
            <span class="toolbar-label">${
              isLive
                ? es
                  ? `CAPTURA MIDI EN VIVO (${selectedTake?.manifest?.events.length ?? 0} NOTAS REGISTRADAS):`
                  : `LIVE MIDI CAPTURE (${selectedTake?.manifest?.events.length ?? 0} RECORDED NOTES):`
                : es
                  ? `MATRIZ PROGRAMADA (${ctx.state.activeSchedule.length} CELDAS · ${recordedCount} HECHAS · ${pendingCount} PENDIENTES):`
                  : `SCHEDULE MATRIX (${ctx.state.activeSchedule.length} CELLS · ${recordedCount} DONE · ${pendingCount} PENDING):`
            }</span>
            <label class="batch-check" title="${es ? 'Limpiar DC offset y restar Huella de Ruido pre-roll en la toma continua ANTES de cortar' : 'Clean DC offset and subtract pre-roll Noise Print on the continuous take BEFORE slicing'}">
              <input type="checkbox" class="articulation-checkbox switch--sm" id="as-chk-clean" ${cfg.cleanBeforeSlice ? 'checked' : ''} />
              <span>${es ? 'Limpiar antes de cortar' : 'Clean before slice'}</span>
            </label>
            <label class="batch-check" title="${es ? 'Buscar bucles de sostenido en paso por cero estrictamente entre NoteOn y NoteOff (nunca en la cola release)' : 'Search zero-crossing sustain loops strictly between NoteOn and NoteOff (never inside the release tail)'}">
              <input type="checkbox" class="articulation-checkbox switch--sm" id="as-chk-autoloop" ${cfg.autoLoopSustained ? 'checked' : ''} />
              <span>AutoLoop (NoteOn..NoteOff)</span>
            </label>
            <label class="batch-check" title="${es ? 'Medir F0 real en la región sostenida y ajustar detuneCents (-50..+50) para compensar deriva analógica' : 'Measure real F0 in sustained region and set detuneCents (-50..+50) for analog drift compensation'}">
              <input type="checkbox" class="articulation-checkbox switch--sm" id="as-chk-detune" ${cfg.autoCompensateAnalogDetune ? 'checked' : ''} />
              <span>${es ? 'Comp. Desafinación Analógica F0' : 'Analog F0 Detune Comp'}</span>
            </label>
          </div>

          <div class="nmm-recorder-dsp-right">
            ${
              canResume
                ? `<button type="button" class="btn btn-xs btn-accent" id="btn-as-resume" title="${es ? 'Continuar grabando solo las celdas pendientes o fallidas desde donde se paró' : 'Continue recording only pending or failed cells from where it stopped'}">
                    ${ICONS.play} ${es ? `Continuar desde donde se paró (${pendingCount})` : `Resume from where it stopped (${pendingCount})`}
                  </button>`
                : ''
            }
            ${
              selectedTake?.manifest
                ? `
                  <label class="toolbar-label" for="as-rescue-offset">OFFSET (ms):</label>
                  <input type="number" id="as-rescue-offset" class="form-control form-control-sm font-mono cfg-ordinal-input" value="${cfg.extraLatencyOffsetMs}" min="-500" max="500" step="5" title="${es ? 'Desplazamiento de rescate (± ms) si la latencia hardware desplazó las marcas NoteOn' : 'Rescue cut offset (± ms) if hardware latency shifted NoteOn markers'}" />
                  <button type="button" class="btn btn-xs btn-outline" id="btn-as-reparse" title="${es ? 'Re-ejecutar corte determinista y AutoLoop sobre la toma continua ya grabada sin volver a grabar' : 'Re-run deterministic slicing & AutoLoop on the already recorded continuous take without re-recording'}">
                    ${ICONS.refresh} ${es ? 'Re-ejecutar Corte + AutoLoop' : 'Re-run Slice + AutoLoop'}
                  </button>
                `
                : ''
            }
          </div>
        </div>

        ${
          isLive && (!selectedTake?.manifest || selectedTake.manifest.events.length === 0)
            ? `<div class="nmm-recorder-takes-empty">${es ? 'Modo Captura MIDI en Tiempo Real: no se muestra matriz previa porque las notas y velocidades se registran dinámicamente a medida que interpretas en tu teclado o controlador MIDI.' : 'Real-Time MIDI Capture Mode: no preview matrix is shown because notes and velocities are recorded dynamically as you play on your MIDI keyboard or controller.'}</div>`
            : `<div class="nmm-autosampler-grid-wrap" id="as-cells-grid" aria-label="AutoSampler Notes x Velocities Grid"></div>`
        }
      </div>
    `;

    void ctx.refreshMidiPorts();
    renderAutoSamplerGrid(ctx, );
    bindAutoSamplerDeckEvents(ctx, );
  }


export function renderAutoSamplerGrid(ctx: RecorderContext): void {
    const grid = ctx.state.backdropEl?.querySelector<HTMLElement>('#as-cells-grid');
    if (!grid) return;

    const st = ctx.getSelectedTake();
    const events = st?.manifest ? st.manifest.events : ctx.state.activeSchedule;

    if (events.length === 0) {
      grid.innerHTML = `<div style="padding: var(--space-2);"><span class="nmm-recorder-takes-hint">Play notes on your MIDI keyboard or configure sweep parameters above.</span></div>`;
      return;
    }

    const isDrum =
      ctx.state.autoSamplerConfig.mode === 'drum_map' || st?.manifest?.mode === 'drum_map';

    // 1. Collect unique sorted velocity columns (equivalence by velocity across all notes)
    const velMap = new Map<number, { velocity: number; lowVel: number; highVel: number }>();
    for (const ev of events) {
      if (!velMap.has(ev.velocity)) {
        velMap.set(ev.velocity, {
          velocity: ev.velocity,
          lowVel: ev.lowVel,
          highVel: ev.highVel,
        });
      }
    }
    const velCols = Array.from(velMap.values()).sort((a, b) => a.velocity - b.velocity);

    // 2. Group events by Note (preserving schedule order) and by Octave (`Math.floor(midiNote / 12) - 1`)
    interface NoteRowGroup {
      noteKey: string;
      midiNote: number;
      octave: number;
      noteName: string;
      customName?: string;
      muteGroup?: number;
      lowKey: number;
      highKey: number;
      cellsByVelocity: Map<number, { ev: MidiCapturedNoteEvent; idx: number }>;
    }

    const noteRowMap = new Map<string, NoteRowGroup>();
    events.forEach((ev, idx) => {
      const noteKey = `${ev.midiNote}_${ev.customName ?? ''}`;
      let row = noteRowMap.get(noteKey);
      if (!row) {
        row = {
          noteKey,
          midiNote: ev.midiNote,
          octave: Math.floor(ev.midiNote / 12) - 1,
          noteName: ev.noteName,
          customName: ev.customName,
          muteGroup: ev.muteGroup,
          lowKey: ev.lowKey,
          highKey: ev.highKey,
          cellsByVelocity: new Map(),
        };
        noteRowMap.set(noteKey, row);
      }
      row.cellsByVelocity.set(ev.velocity, { ev, idx });
    });

    const noteRows = Array.from(noteRowMap.values());

    // Count how many note rows belong to each contiguous octave block for rowspan (only used in melodic sweep)
    const octaveSpanCounts = new Map<number, number>();
    let blockStartIdx = 0;
    for (let i = 0; i < noteRows.length; i++) {
      if (i === 0 || noteRows[i].octave !== noteRows[i - 1].octave) {
        blockStartIdx = i;
        octaveSpanCounts.set(blockStartIdx, 1);
      } else {
        octaveSpanCounts.set(blockStartIdx, (octaveSpanCounts.get(blockStartIdx) ?? 1) + 1);
      }
    }

    const es = isEs();
    const theadHtml = `
      <thead>
        <tr>
          <th>${isDrum ? (es ? 'NOTA MIDI' : 'MIDI NOTE') : (es ? 'OCTAVA' : 'OCTAVE')}</th>
          <th class="nmm-as-th-note">${isDrum ? (es ? 'PIEZA / ARTICULACIÓN DE BATERÍA' : 'DRUM PIECE / ARTICULATION') : (es ? 'NOTA / RANGO TECLAS' : 'NOTE / KEY RANGE')}</th>
          ${velCols
            .map(
              (vc, vIdx) => `
              <th>
                L${vIdx + 1} · v${vc.velocity}
                <span class="nmm-as-vel-th-sub">[vel ${vc.lowVel}..${vc.highVel}]</span>
              </th>
            `
            )
            .join('')}
        </tr>
      </thead>
    `;

    const tbodyHtml = noteRows
      .map((row, rIdx) => {
        const isOctaveStart = !isDrum && (rIdx === 0 || row.octave !== noteRows[rIdx - 1].octave);
        const octRowSpan = octaveSpanCounts.get(rIdx) ?? 1;
        const octMinMidi = Math.max(0, (row.octave + 1) * 12);
        const octMaxMidi = Math.min(127, octMinMidi + 11);
        const firstColHtml = isDrum
          ? `<td class="nmm-as-oct-cell" title="${es ? 'Nota MIDI' : 'MIDI Note'} ${row.midiNote} (${escHtml(row.noteName)})">
              MIDI ${row.midiNote}
              <span class="nmm-as-oct-sub">${escHtml(row.noteName)}</span>
            </td>`
          : isOctaveStart
            ? `<td class="nmm-as-oct-cell" rowspan="${octRowSpan}" title="${es ? 'Octava' : 'Octave'} C${row.octave} (MIDI ${octMinMidi}..${octMaxMidi})">
                OCT C${row.octave}
                <span class="nmm-as-oct-sub">${octMinMidi}..${octMaxMidi}</span>
              </td>`
            : '';

        const titleLabel = isDrum
          ? row.customName || row.noteName
          : row.customName
            ? `${row.customName} (${row.noteName})`
            : row.noteName;
        const keyRangeLabel = isDrum
          ? row.muteGroup !== undefined
            ? `Mute Grp ${row.muteGroup}`
            : `${es ? 'Tecla' : 'Key'} ${row.noteName}`
          : row.lowKey === row.highKey
            ? `MIDI ${row.midiNote}`
            : `[${midiNoteToStandardName(row.lowKey)}..${midiNoteToStandardName(row.highKey)}]`;

        const velCellsHtml = velCols
          .map((vc, cIdx) => {
            const cell = row.cellsByVelocity.get(vc.velocity);
            if (!cell) {
              return `<td class="nmm-as-td-cell" role="gridcell">—</td>`;
            }
            const { ev, idx } = cell;
            const statusClass =
              ev.status === 'recording'
                ? ' is-recording'
                : ev.status === 'recorded'
                  ? ' is-recorded'
                  : ev.status === 'failed'
                    ? ' is-failed'
                    : '';
            return `
              <td class="nmm-as-td-cell" role="gridcell">
                <button
                  type="button"
                  class="nmm-as-cell${statusClass}"
                  data-cell-idx="${idx}"
                  data-row-idx="${rIdx}"
                  data-col-idx="${cIdx}"
                  aria-label="${escHtml(titleLabel)} v${ev.velocity} (${ev.status})"
                  title="${es ? `Click / Enter / Espacio: audicionar muestra · Shift+Click / Shift+Enter: re-grabar celda · Flechas ←/→/↑/↓: navegar matriz (${escHtml(titleLabel)} · Capa v${ev.velocity} [${ev.lowVel}..${ev.highVel}])` : `Click / Enter / Space: audition sample · Shift+Click / Shift+Enter: re-record cell · Arrows ←/→/↑/↓: navigate matrix (${escHtml(titleLabel)} · Layer v${ev.velocity} [${ev.lowVel}..${ev.highVel}])`}"
                >
                  <span class="nmm-as-cell-dot"></span>
                  <span>${escHtml(isDrum ? row.customName || row.noteName : row.noteName)}</span>
                  <span class="val-pill font-mono">v${ev.velocity}</span>
                </button>
              </td>
            `;
          })
          .join('');

        return `
          <tr class="${isOctaveStart && rIdx > 0 ? 'is-octave-start' : ''}" role="row">
            ${firstColHtml}
            <td class="nmm-as-note-cell" title="${es ? `Nota muestreada ${escHtml(titleLabel)} (MIDI ${row.midiNote}) · cubre teclas MIDI ${row.lowKey}..${row.highKey}` : `Sampled note ${escHtml(titleLabel)} (MIDI ${row.midiNote}) · covers MIDI keys ${row.lowKey}..${row.highKey}`}">
              <span class="nmm-as-note-main">${escHtml(titleLabel)}</span>
              <span class="nmm-as-note-range">${escHtml(keyRangeLabel)}</span>
            </td>
            ${velCellsHtml}
          </tr>
        `;
      })
      .join('');

    grid.innerHTML = `
      <table class="nmm-as-matrix-table" role="grid" aria-label="${es ? 'Matriz de Notas por Velocidades' : 'Notes by Velocities Matrix'}">
        ${theadHtml}
        <tbody>${tbodyHtml}</tbody>
      </table>
    `;

    const allCellBtns = Array.from(grid.querySelectorAll<HTMLButtonElement>('[data-cell-idx]'));
    allCellBtns.forEach((btn, flatIdx) => {
      btn.addEventListener('keydown', (e: KeyboardEvent) => {
        const rIdx = Number(btn.getAttribute('data-row-idx') ?? 0);
        const cIdx = Number(btn.getAttribute('data-col-idx') ?? 0);
        let targetBtn: HTMLButtonElement | null = null;

        if (e.key === 'ArrowRight') {
          targetBtn = allCellBtns[Math.min(allCellBtns.length - 1, flatIdx + 1)] ?? null;
        } else if (e.key === 'ArrowLeft') {
          targetBtn = allCellBtns[Math.max(0, flatIdx - 1)] ?? null;
        } else if (e.key === 'ArrowDown') {
          targetBtn =
            grid.querySelector<HTMLButtonElement>(
              `[data-row-idx="${rIdx + 1}"][data-col-idx="${cIdx}"]`
            ) ?? allCellBtns[Math.min(allCellBtns.length - 1, flatIdx + velCols.length)] ?? null;
        } else if (e.key === 'ArrowUp') {
          targetBtn =
            grid.querySelector<HTMLButtonElement>(
              `[data-row-idx="${rIdx - 1}"][data-col-idx="${cIdx}"]`
            ) ?? allCellBtns[Math.max(0, flatIdx - velCols.length)] ?? null;
        } else if (e.key === 'Home') {
          targetBtn = allCellBtns[0] ?? null;
        } else if (e.key === 'End') {
          targetBtn = allCellBtns[allCellBtns.length - 1] ?? null;
        }

        if (targetBtn) {
          e.preventDefault();
          targetBtn.focus();
        }
      });

      btn.addEventListener('click', (e) => {
        const idx = Number(btn.getAttribute('data-cell-idx'));
        const activeTake = ctx.getSelectedTake();
        if (e.shiftKey && !ctx.state.isSweepRunning) {
          void ctx.runAutoSamplerSweep({
            resumeTakeId: activeTake?.id,
            specificCellIndex: idx,
          });
          return;
        }
        // Audicionar la celda si ya está grabada
        if (activeTake?.manifest && ctx.state.context.onAuditionPcm) {
          const ev = activeTake.manifest.events[idx];
          if (ev && ev.tailEndFrame > ev.noteOnFrame) {
            const mono = mixToMono(activeTake.take);
            const slice = mono.subarray(
              Math.max(0, ev.noteOnFrame),
              Math.min(mono.length, ev.tailEndFrame)
            );
            if (slice.length > 0) {
              ctx.state.context.onAuditionPcm(slice, activeTake.take.sampleRate);
            }
          }
        }
      });
    });
  }


export function bindAutoSamplerDeckEvents(ctx: RecorderContext): void {
    const card = ctx.state.backdropEl?.querySelector<HTMLElement>('#as-config-card');
    if (!card) return;

    const rebuildSchedule = () => {
      ctx.state.activeSchedule = buildScheduleFromConfig(ctx.state.autoSamplerConfig);
      renderAutoSamplerDeck(ctx, );
    };

    card.querySelector('#btn-as-rescan-midi')?.addEventListener('click', () => {
      void ctx.refreshMidiPorts();
    });
    card.querySelector('#btn-as-pilot-test')?.addEventListener('click', () => {
      void ctx.runPilotCalibration();
    });
    card.querySelector('#btn-as-apply-pilot-rtl')?.addEventListener('click', () => {
      if (!ctx.state.lastPilotRecommendation) return;
      ctx.state.autoSamplerConfig = applyPilotRecommendationToConfig(
        ctx.state.autoSamplerConfig,
        ctx.state.lastPilotRecommendation,
        { applyEnvelopeAndVelocity: true }
      );
      ctx.state.activeSchedule = buildScheduleFromConfig(ctx.state.autoSamplerConfig);
      const selectedTake = ctx.getSelectedTake();
      if (selectedTake?.manifest) {
        selectedTake.manifest.latencySamples = ctx.state.lastPilotRecommendation.latencySamples;
        ctx.runAutoSamplerPostProcessOnTake(selectedTake);
        ctx.renderTakes();
        ctx.renderTakeInspector();
      }
      toast(
        `Applied RTL ${ctx.state.lastPilotRecommendation.latencyMs.toFixed(1)} ms (${ctx.state.lastPilotRecommendation.latencySamples} smp) and pilot recommendations.`,
        'success'
      );
      renderAutoSamplerDeck(ctx, );
    });

    card.querySelector('#as-midi-out')?.addEventListener('change', (e) => {
      ctx.state.midi.setSelectedOutputId((e.target as HTMLSelectElement).value);
    });
    card.querySelector('#as-midi-in')?.addEventListener('change', (e) => {
      ctx.state.midi.setSelectedInputId((e.target as HTMLSelectElement).value);
    });
    card.querySelector('#as-midi-ch')?.addEventListener('change', (e) => {
      const ch = parseInt((e.target as HTMLInputElement).value, 10);
      if (Number.isFinite(ch)) {
        ctx.state.autoSamplerConfig.midiChannel = Math.max(1, Math.min(16, ch));
        ctx.state.midi.setChannel(ctx.state.autoSamplerConfig.midiChannel);
      }
    });

    card.querySelector('#as-start-octave')?.addEventListener('change', (e) => {
      const startOct = parseInt((e.target as HTMLSelectElement).value, 10) || 2;
      const coh = enforceAutoSamplerConfigCoherence(ctx.state.autoSamplerConfig, {
        changedField: 'startOctave',
        newStartOctave: startOct,
      });
      ctx.state.autoSamplerConfig = coh.config;
      if (coh.adjustmentNote) toast(coh.adjustmentNote, 'info');
      rebuildSchedule();
    });
    card.querySelector('#as-octave-count')?.addEventListener('change', (e) => {
      const v = parseInt((e.target as HTMLInputElement).value, 10);
      if (Number.isFinite(v)) {
        const coh = enforceAutoSamplerConfigCoherence(ctx.state.autoSamplerConfig, {
          changedField: 'octaveCount',
          newOctaveCount: v,
        });
        ctx.state.autoSamplerConfig = coh.config;
        if (coh.adjustmentNote) toast(coh.adjustmentNote, 'info');
        rebuildSchedule();
      }
    });
    card.querySelector('#as-notes-per-oct')?.addEventListener('change', (e) => {
      const v = parseInt((e.target as HTMLSelectElement).value, 10) as NotesPerOctaveOption;
      if ([1, 2, 3, 4, 6, 12].includes(v)) {
        ctx.state.autoSamplerConfig.notesPerOctave = v;
        rebuildSchedule();
      }
    });

    card.querySelector('#as-gate-ms')?.addEventListener('change', (e) => {
      const v = parseInt((e.target as HTMLInputElement).value, 10);
      if (Number.isFinite(v)) {
        ctx.state.autoSamplerConfig.gateDurationMs = Math.max(80, Math.min(15000, v));
        renderAutoSamplerDeck(ctx, );
      }
    });
    card.querySelector('#as-release-mode')?.addEventListener('change', (e) => {
      ctx.state.autoSamplerConfig.releaseMode = (e.target as HTMLSelectElement)
        .value as AutoSamplerReleaseMode;
      renderAutoSamplerDeck(ctx, );
    });
    card.querySelector('#as-release-ms')?.addEventListener('change', (e) => {
      const v = parseInt((e.target as HTMLInputElement).value, 10);
      if (Number.isFinite(v)) {
        ctx.state.autoSamplerConfig.maxReleaseMs = Math.max(100, Math.min(20000, v));
        renderAutoSamplerDeck(ctx, );
      }
    });

    card.querySelector('#as-vel-layers')?.addEventListener('change', (e) => {
      const v = parseInt((e.target as HTMLInputElement).value, 10);
      if (Number.isFinite(v)) {
        const coh = enforceAutoSamplerConfigCoherence(ctx.state.autoSamplerConfig, {
          changedField: 'velocityLayers',
          newVelocityLayers: v,
        });
        ctx.state.autoSamplerConfig = coh.config;
        if (coh.adjustmentNote) toast(coh.adjustmentNote, 'info');
        rebuildSchedule();
      }
    });
    card.querySelector('#as-vel-curve')?.addEventListener('change', (e) => {
      const newCurve = (e.target as HTMLSelectElement).value as AutoSamplerVelocityCurve;
      const coh = enforceAutoSamplerConfigCoherence(ctx.state.autoSamplerConfig, {
        changedField: 'velocityCurve',
        newVelocityCurve: newCurve,
      });
      ctx.state.autoSamplerConfig = coh.config;
      if (coh.adjustmentNote) toast(coh.adjustmentNote, 'info');
      rebuildSchedule();
    });

    // Campos individuales de Tabla Manual por Capas (sin depender de escribir comas)
    card.querySelectorAll<HTMLInputElement>('[data-manual-vel-idx]').forEach((inp) => {
      inp.addEventListener('change', () => {
        const idx = Number(inp.getAttribute('data-manual-vel-idx'));
        const val = parseInt(inp.value, 10);
        if (Number.isInteger(idx) && idx >= 0 && idx < ctx.state.autoSamplerConfig.manualVelocities.length) {
          ctx.state.autoSamplerConfig.manualVelocities[idx] = Number.isFinite(val) ? val : 0;
          const vCheck = validateManualVelocities(ctx.state.autoSamplerConfig.manualVelocities);
          if (vCheck.valid) {
            ctx.state.autoSamplerConfig.velocityLayers = ctx.state.autoSamplerConfig.manualVelocities.length;
            rebuildSchedule();
          } else {
            renderAutoSamplerDeck(ctx, );
          }
        }
      });
    });

    card.querySelectorAll<HTMLButtonElement>('[data-remove-vel-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-remove-vel-idx'));
        if (
          ctx.state.autoSamplerConfig.manualVelocities.length > 1 &&
          idx >= 0 &&
          idx < ctx.state.autoSamplerConfig.manualVelocities.length
        ) {
          ctx.state.autoSamplerConfig.manualVelocities.splice(idx, 1);
          ctx.state.autoSamplerConfig.velocityLayers = ctx.state.autoSamplerConfig.manualVelocities.length;
          rebuildSchedule();
        }
      });
    });

    card.querySelector('#btn-as-add-vel-layer')?.addEventListener('click', () => {
      if (ctx.state.autoSamplerConfig.manualVelocities.length < 8) {
        ctx.state.autoSamplerConfig.manualVelocities = resizeManualVelocityList(
          ctx.state.autoSamplerConfig.manualVelocities,
          ctx.state.autoSamplerConfig.manualVelocities.length + 1
        );
        ctx.state.autoSamplerConfig.velocityLayers = ctx.state.autoSamplerConfig.manualVelocities.length;
        rebuildSchedule();
      }
    });

    card.querySelector('#btn-as-autofix-vels')?.addEventListener('click', () => {
      const vCheck = validateManualVelocities(ctx.state.autoSamplerConfig.manualVelocities);
      ctx.state.autoSamplerConfig.manualVelocities = vCheck.sanitizedVelocities;
      ctx.state.autoSamplerConfig.velocityLayers = vCheck.sanitizedVelocities.length;
      toast(
        `Velocidades manuales corregidas y ordenadas: ${vCheck.sanitizedVelocities.join(', ')}`,
        'success'
      );
      rebuildSchedule();
    });

    // Drum map preset / import / manual text / spec
    card.querySelector('#as-drum-preset')?.addEventListener('change', (e) => {
      const key = (e.target as HTMLSelectElement).value;
      if (key && FACTORY_DRUM_MAP_PRESETS[key]) {
        ctx.state.autoSamplerConfig.drumMap = FACTORY_DRUM_MAP_PRESETS[key];
        rebuildSchedule();
      }
    });
    card.querySelector<HTMLInputElement>('#as-drum-file-inp')?.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      void file.text().then((txt) => {
        const parsed = parseDrumHitMapFile(txt, file.name);
        if (parsed.hits.length === 0) {
          toast(`Could not parse any valid MIDI drum hits from "${file.name}".`, 'warning');
          return;
        }
        ctx.state.autoSamplerConfig.drumMap = parsed;
        toast(`Loaded drum map "${parsed.kitName}" (${parsed.hits.length} hits).`, 'success');
        rebuildSchedule();
      });
    });
    card.querySelector('#btn-as-paste-manual')?.addEventListener('click', () => {
      ctx.state.showManualExtractorPanel = !ctx.state.showManualExtractorPanel;
      renderAutoSamplerDeck(ctx, );
    });
    card.querySelector('#btn-as-drum-spec')?.addEventListener('click', () => {
      ctx.state.showDrumHelpPanel = !ctx.state.showDrumHelpPanel;
      renderAutoSamplerDeck(ctx, );
    });
    card.querySelector('#btn-as-run-manual-extract')?.addEventListener('click', () => {
      const ta = card.querySelector<HTMLTextAreaElement>('#as-manual-raw-text');
      const raw = ta?.value ?? '';
      const parsed = extractDrumMapFromManualTextDeterministic(raw, 'Extracted Manual Kit');
      if (parsed.hits.length === 0) {
        toast('No valid note/name pairs found in text.', 'warning');
        return;
      }
      ctx.state.autoSamplerConfig.drumMap = parsed;
      ctx.state.showManualExtractorPanel = false;
      toast(`Extracted ${parsed.hits.length} drum hits from manual text.`, 'success');
      rebuildSchedule();
    });
    card.querySelectorAll<HTMLButtonElement>('[data-dl-template]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const fmt = btn.getAttribute('data-dl-template');
        if (fmt === 'txt') {
          downloadBlob(
            new Blob(['36, Kick Drum\n38, Snare Acoustic\n42, Closed Hi-Hat, 1\n46, Open Hi-Hat, 1\n'], {
              type: 'text/plain',
            }),
            'drum-map-template.txt'
          );
        } else if (fmt === 'json') {
          downloadBlob(
            new Blob(
              [
                JSON.stringify(
                  {
                    kitName: 'Custom Drum Kit',
                    defaultVelocities: [70, 120],
                    hits: [
                      { note: 36, name: 'Kick Drum' },
                      { note: 38, name: 'Snare Acoustic' },
                      { note: 42, name: 'Closed Hi-Hat', muteGroup: 1 },
                      { note: 46, name: 'Open Hi-Hat', muteGroup: 1 },
                    ],
                  },
                  null,
                  2
                ),
              ],
              { type: 'application/json' }
            ),
            'drum-map-template.json'
          );
        } else if (fmt === 'yaml') {
          downloadBlob(
            new Blob(
              [
                'kitName: Custom Drum Kit\nhits:\n  - note: 36\n    name: Kick Drum\n  - note: 38\n    name: Snare Acoustic\n  - note: 42\n    name: Closed Hi-Hat\n    muteGroup: 1\n  - note: 46\n    name: Open Hi-Hat\n    muteGroup: 1\n',
              ],
              { type: 'text/yaml' }
            ),
            'drum-map-template.yaml'
          );
        }
      });
    });

    card.querySelector('#as-chk-clean')?.addEventListener('change', (e) => {
      ctx.state.autoSamplerConfig.cleanBeforeSlice = (e.target as HTMLInputElement).checked;
    });
    card.querySelector('#as-chk-autoloop')?.addEventListener('change', (e) => {
      ctx.state.autoSamplerConfig.autoLoopSustained = (e.target as HTMLInputElement).checked;
    });
    card.querySelector('#as-chk-detune')?.addEventListener('change', (e) => {
      ctx.state.autoSamplerConfig.autoCompensateAnalogDetune = (e.target as HTMLInputElement).checked;
    });

    card.querySelector('#btn-as-resume')?.addEventListener('click', () => {
      const st = ctx.getSelectedTake();
      void ctx.runAutoSamplerSweep({ resumeTakeId: st?.id });
    });

    card.querySelector('#as-rescue-offset')?.addEventListener('change', (e) => {
      const val = parseFloat((e.target as HTMLInputElement).value);
      if (Number.isFinite(val)) {
        ctx.state.autoSamplerConfig.extraLatencyOffsetMs = Math.max(-500, Math.min(500, val));
      }
    });

    card.querySelector('#btn-as-reparse')?.addEventListener('click', () => {
      const st = ctx.getSelectedTake();
      if (!st?.manifest) return;
      const out = ctx.runAutoSamplerPostProcessOnTake(st);
      if (out) {
        toast(
          `Re-sliced "${st.name}" with offset ${ctx.state.autoSamplerConfig.extraLatencyOffsetMs} ms: ${out.slicerResult.slices.length} slices ready.`,
          'success'
        );
        ctx.renderTakeInspector();
        renderAutoSamplerGrid(ctx, );
      }
    });
  }

