// ─────────────────────────────────────────────────────────
// Model Configuration — Tab 2: Playback, Articulation & Resinator Lab (HTML renderer).
// ─────────────────────────────────────────────────────────

import {
  DEFAULT_UNIFIED_SURFACE_CONFIG,
  type ProcessConfig,
  type UnifiedSurfaceUiConfig,
} from '../../core/types';
import { ICONS } from '../icons';
import type { ModelConfigTabContext } from './types';

export function renderArticulationTab(ctx: ModelConfigTabContext, config: ProcessConfig): string {
    const isExtended = (config.workingMode ?? 'classic') === 'extended';
    const cp = config.commonPlayback ?? {
      loopMode: 'no_loop',
      pitchKeytrack: 100,
      trigger: 'attack',
      fadeCurve: 'equal-power',
    };
    const surf: UnifiedSurfaceUiConfig = {
      ...DEFAULT_UNIFIED_SURFACE_CONFIG,
      ...config.unifiedSurfaceConfig,
    };

    return `
      <div class="model-cfg-grid">
        <fieldset class="conditioned-fieldset" ${!isExtended ? 'disabled' : ''}>
          <div class="card ${!isExtended ? 'is-conditioned-disabled' : ''}">
            <div class="model-cfg-card-header">
              <h4>
                ${ICONS.piano} Global Instrument Playback &amp; Keytrack
                ${!isExtended ? '<span class="cond-reason-badge is-extended-only">SOLO MODO EXTENDED</span>' : ''}
              </h4>
              <span class="nmm-hint">Global defaults applied across all model zones and regions</span>
            </div>

            <div class="form-row-dual">
              <div class="form-group flex-1">
                <label for="sel-cfg-loop-mode">DEFAULT LOOP MODE</label>
                <select id="sel-cfg-loop-mode" class="form-control">
                  <option value="no_loop" ${cp.loopMode === 'no_loop' ? 'selected' : ''}>One-Shot (No Loop)</option>
                  <option value="loop_continuous" ${cp.loopMode === 'loop_continuous' ? 'selected' : ''}>Continuous Forward Loop</option>
                  <option value="ping_pong" ${cp.loopMode === 'ping_pong' ? 'selected' : ''}>Ping-Pong (Alternate)</option>
                  <option value="loop_sustain" ${cp.loopMode === 'loop_sustain' ? 'selected' : ''}>Sustain Loop (Release One-Shot)</option>
                </select>
              </div>

              <div class="form-group flex-1">
                <label for="sel-cfg-trigger">NOTE TRIGGER LOGIC</label>
                <select id="sel-cfg-trigger" class="form-control">
                  <option value="attack" ${cp.trigger === 'attack' ? 'selected' : ''}>Attack (Key-On Normal)</option>
                  <option value="release" ${cp.trigger === 'release' ? 'selected' : ''}>Release Trigger (Key-Off Release Sample)</option>
                  <option value="first" ${cp.trigger === 'first' ? 'selected' : ''}>Legato First Note Only</option>
                  <option value="legato" ${cp.trigger === 'legato' ? 'selected' : ''}>Legato Connected Notes Only</option>
                </select>
              </div>
            </div>

            <div class="form-row-dual">
              <div class="form-group flex-1">
                <label for="sel-cfg-fade-curve">CROSSFADE CURVE</label>
                <select id="sel-cfg-fade-curve" class="form-control">
                  <option value="equal-power" ${cp.fadeCurve === 'equal-power' ? 'selected' : ''}>Equal Power (3dB Dip Free - Acoustic Standard)</option>
                  <option value="linear" ${cp.fadeCurve === 'linear' ? 'selected' : ''}>Linear Gain</option>
                  <option value="spectral-morph" ${cp.fadeCurve === 'spectral-morph' ? 'selected' : ''}>Spectral Morph</option>
                </select>
              </div>

              <div class="form-group flex-1">
                <div class="label-with-val">
                  <label for="inp-cfg-keytrack">PITCH KEYTRACK</label>
                  <span class="val-pill" id="val-cfg-keytrack">${cp.pitchKeytrack ?? 100}%</span>
                </div>
                <input
                  type="range"
                  id="inp-cfg-keytrack"
                  min="0"
                  max="200"
                  step="5"
                  value="${cp.pitchKeytrack ?? 100}"
                  class="form-range"
                />
              </div>
            </div>
          </div>
        </fieldset>

        <!-- Fase 39: Unified Spectral Surface & Resinator Sonic Matter Lab -->
        <fieldset class="conditioned-fieldset" ${!isExtended ? 'disabled' : ''}>
          <div class="card ${!isExtended ? 'is-conditioned-disabled' : ''}">
            <div class="model-cfg-card-header">
              <h4>
                ${ICONS.sparkle} Superficie Espectral Unificada &amp; Laboratorio de Resinator
                ${!isExtended ? '<span class="cond-reason-badge is-extended-only">SOLO MODO EXTENDED</span>' : ''}
              </h4>
              <span class="nmm-hint">Control de ataque/release espectral, bloqueo de formantes Bark, modo Quimera y transmutación de materiales</span>
            </div>

            <div class="form-group" style="margin-bottom: 10px;">
              <label>PRESETS RÁPIDOS DE LABORATORIO (1 CLIC)</label>
              <div class="btn-group-toggle" style="display:flex; flex-wrap:wrap; gap:6px;">
                <button type="button" class="btn btn-outline btn-xs btn-surf-preset" data-preset="faithful" title="Sonido 100% fiel al instrumento original, con escudo anti-intrusos y bloqueo de formantes activo">
                  Fiel al Original
                </button>
                <button type="button" class="btn btn-outline btn-xs btn-surf-preset" data-preset="chimera" title="Activa Modo Quimera y fuerza superficie melódica para fundir muestras de distintos instrumentos o percusiones">
                  Quimera Morph (Híbrido)
                </button>
                <button type="button" class="btn btn-outline btn-xs btn-surf-preset" data-preset="instant-pluck" title="Salta al pico de plenitud espectral (Attack=100%) para convertir pads lentos en ataques inmediatos">
                  Pad &rarr; Ataque Inmediato
                </button>
                <button type="button" class="btn btn-outline btn-xs btn-surf-preset" data-preset="infinite-tail" title="Alarga +5.0 s la cola de muestras cortadas en seco con amortiguación física de agudos">
                  Cola Espectral (+5 s)
                </button>
                <button type="button" class="btn btn-outline btn-xs btn-surf-preset" data-preset="crystal-bell" title="Aumenta la rigidez inarmónica B y paridad impar para transmutar el timbre en cristal/campana tubular">
                  Campana / Cristal Metálico
                </button>
                <button type="button" class="btn btn-outline btn-xs btn-surf-preset" data-preset="ddsp-ghost" title="Prioriza el residuo estocástico DDSP en 24 bandas Bark para crear un susurro/aire espectral afinado">
                  Fantasma de Aire DDSP
                </button>
              </div>
            </div>

            <div class="form-row-dual" style="margin-bottom: 10px;">
              <label class="checkbox-label" title="Si está desactivado, las muestras intrusas de otro instrumento se aíslan automáticamente. Actívalo para interpolar a propósito entre instrumentos distintos (Quimera).">
                <input type="checkbox" id="chk-cfg-surf-outliers" class="articulation-checkbox switch--sm" ${surf.includeOutliers ? 'checked' : ''} />
                <span><strong>Modo Quimera:</strong> Interpolar muestras de distintos instrumentos (Desactivar escudo de intrusos)</span>
              </label>
              <label class="checkbox-label" title="Conserva los primeros ~20 ms del ataque físico real en PCM alineado en fase con los osciladores del Resinator.">
                <input type="checkbox" id="chk-cfg-surf-transient" class="articulation-checkbox switch--sm" ${surf.preserveHybridTransients !== false ? 'checked' : ''} />
                <span><strong>Ataque Físico Híbrido:</strong> Preservar micro-transitorio PCM (20 ms) en fase</span>
              </label>
            </div>

            <div class="form-row-dual">
              <div class="form-group flex-1">
                <div class="label-with-val">
                  <label for="inp-cfg-surf-attack-shorten">ACORTAR ATAQUE LENTO (SALTO AL PICO)</label>
                  <span class="val-pill" id="val-cfg-surf-attack-shorten">${Math.round((surf.attackShorten01 ?? 0) * 100)}%</span>
                </div>
                <input
                  type="range"
                  id="inp-cfg-surf-attack-shorten"
                  min="0"
                  max="100"
                  step="5"
                  value="${Math.round((surf.attackShorten01 ?? 0) * 100)}"
                  class="form-range"
                />
              </div>

              <div class="form-group flex-1">
                <div class="label-with-val">
                  <label for="inp-cfg-surf-release-extend">ALARGAR RELEASE INEXISTENTE (COLA)</label>
                  <span class="val-pill" id="val-cfg-surf-release-extend">+${(surf.releaseExtendSec ?? 0).toFixed(1)} s</span>
                </div>
                <input
                  type="range"
                  id="inp-cfg-surf-release-extend"
                  min="0"
                  max="10"
                  step="0.5"
                  value="${surf.releaseExtendSec ?? 0}"
                  class="form-range"
                />
              </div>
            </div>

            <div class="form-row-dual">
              <div class="form-group flex-1">
                <div class="label-with-val">
                  <label for="inp-cfg-surf-formant-lock">BLOQUEO DE CUERPO / FORMANTES BARK</label>
                  <span class="val-pill" id="val-cfg-surf-formant-lock">${Math.round((surf.formantLock01 ?? 1) * 100)}%</span>
                </div>
                <input
                  type="range"
                  id="inp-cfg-surf-formant-lock"
                  min="0"
                  max="100"
                  step="5"
                  value="${Math.round((surf.formantLock01 ?? 1) * 100)}"
                  class="form-range"
                />
              </div>

              <div class="form-group flex-1">
                <div class="label-with-val">
                  <label for="inp-cfg-surf-inharm">RIGIDEZ INARMÓNICA (CUERDA &rarr; CAMPANA)</label>
                  <span class="val-pill" id="val-cfg-surf-inharm">${((surf.inharmonicityB ?? 0) * 1000).toFixed(1)} &permil;</span>
                </div>
                <input
                  type="range"
                  id="inp-cfg-surf-inharm"
                  min="0"
                  max="50"
                  step="1"
                  value="${Math.round((surf.inharmonicityB ?? 0) * 1000)}"
                  class="form-range"
                />
              </div>
            </div>

            <div class="form-row-dual">
              <div class="form-group flex-1">
                <div class="label-with-val">
                  <label for="inp-cfg-surf-parity">PARIDAD ARMÓNICA (TUBO IMPAR &harr; CÁLIDO PAR)</label>
                  <span class="val-pill" id="val-cfg-surf-parity">${Math.round((surf.parity ?? 0) * 100)}%</span>
                </div>
                <input
                  type="range"
                  id="inp-cfg-surf-parity"
                  min="-100"
                  max="100"
                  step="5"
                  value="${Math.round((surf.parity ?? 0) * 100)}"
                  class="form-range"
                />
              </div>

              <div class="form-group flex-1">
                <div class="label-with-val">
                  <label for="inp-cfg-surf-residual">MEZCLA AIRE / RESIDUO ESTOCÁSTICO DDSP</label>
                  <span class="val-pill" id="val-cfg-surf-residual">${Math.round((surf.residualMix ?? 0.15) * 100)}%</span>
                </div>
                <input
                  type="range"
                  id="inp-cfg-surf-residual"
                  min="0"
                  max="100"
                  step="5"
                  value="${Math.round((surf.residualMix ?? 0.15) * 100)}"
                  class="form-range"
                />
              </div>
            </div>

            <!-- Fase 39.4: Tempo-Sync & REX Loop / Melodic Groove Contract for Resinator v2 -->
            <div class="form-group" style="margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--color-panel-border);">
              <label class="checkbox-label" title="Guarda en el contrato axionik-expanded.json el BPM original y número de compases para que el Resinator v2 de ABDAxionikVS sincronice la velocidad de evolución espectral al reloj del DAW (hostBpm / sourceBpm) sin alterar la afinación F0 ni los formantes Bark.">
                <input type="checkbox" id="chk-cfg-surf-temposync" class="articulation-checkbox switch--sm" ${surf.tempoSync?.enabled ? 'checked' : ''} />
                <span><strong>Sincronizar Evolución Espectral al BPM del Host (Tempo-Sync / REX Loop en Resinator v2)</strong></span>
              </label>
            </div>

            <fieldset class="conditioned-fieldset" ${!surf.tempoSync?.enabled ? 'disabled' : ''}>
              <div class="form-row-dual ${!surf.tempoSync?.enabled ? 'is-conditioned-disabled' : ''}" id="surf-temposync-details-row">
                <div class="form-group flex-1">
                  <div class="label-with-val">
                    <label for="inp-cfg-surf-source-bpm">
                      BPM ORIGINAL DE LA TOMA / LOOP
                      ${!surf.tempoSync?.enabled ? '<span class="cond-reason-badge">ACTIVA TEMPO-SYNC</span>' : ''}
                    </label>
                    <span class="val-pill" id="val-cfg-surf-source-bpm">${surf.tempoSync?.sourceBpm ?? 120} BPM</span>
                  </div>
                  <input
                    type="number"
                    id="inp-cfg-surf-source-bpm"
                    class="form-control font-mono"
                    min="20"
                    max="300"
                    step="0.5"
                    value="${surf.tempoSync?.sourceBpm ?? 120}"
                  />
                </div>

                <div class="form-group flex-1">
                  <div class="label-with-val">
                    <label for="inp-cfg-surf-bar-count">COMPASES (BARS) &amp; MODO DE GROOVE</label>
                    <span class="val-pill" id="val-cfg-surf-bars">${surf.tempoSync?.barCount ?? 2} compases (4/4)</span>
                  </div>
                  <div class="cfg-inline-row">
                    <input
                      type="number"
                      id="inp-cfg-surf-bar-count"
                      class="form-control font-mono cfg-ordinal-input"
                      min="1"
                      max="64"
                      step="1"
                      value="${surf.tempoSync?.barCount ?? 2}"
                      title="Longitud del bucle o frase en compases"
                    />
                     <select id="sel-cfg-surf-groove-mode" class="form-control cfg-flex-1" title="Modo de fraseo o bucle para el Resinator v2">
                      <option value="free" ${(surf.tempoSync?.grooveMode ?? 'free') === 'free' ? 'selected' : ''}>Libre / Evolución Continua</option>
                      <option value="rex_loop" ${surf.tempoSync?.grooveMode === 'rex_loop' ? 'selected' : ''}>Bucle Rítmico tipo REX (Drum Groove)</option>
                      <option value="melodic_phrase" ${surf.tempoSync?.grooveMode === 'melodic_phrase' ? 'selected' : ''}>Frase Melódica / Riff Sincronizado</option>
                      <option value="sliced_kit" ${surf.tempoSync?.grooveMode === 'sliced_kit' ? 'selected' : ''}>Kit Troceado por Tecla</option>
                    </select>
                  </div>
                </div>
              </div>
            </fieldset>

            <!-- Preescucha en Vivo del Resinator v2 (ABDShared Engine) -->
            <div class="form-group" style="margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--color-panel-border);">
              <div class="label-with-val" style="margin-bottom: 6px;">
                <label>${ICONS.play} PREESCUCHA EN VIVO DEL MOTOR RESINATOR V2 (<code>ABDShared::NeuronResynatorV2</code>)</label>
                <span class="val-pill">Pseudo-Surround 4.0 &rarr; 2.0</span>
              </div>
              <div class="cfg-inline-row" style="flex-wrap: wrap; gap: 8px; align-items: center;">
                <select id="sel-cfg-resv2-note" class="form-control" style="width: 110px;" title="Nota MIDI para audicionar la Superficie Espectral Continua">
                  <option value="36" ${ctx.preview.midiNote === 36 ? 'selected' : ''}>C2 (36 · Grave)</option>
                  <option value="48" ${ctx.preview.midiNote === 48 ? 'selected' : ''}>C3 (48 · Bajo)</option>
                  <option value="60" ${ctx.preview.midiNote === 60 ? 'selected' : ''}>C4 (60 · Medio)</option>
                  <option value="67" ${ctx.preview.midiNote === 67 ? 'selected' : ''}>G4 (67 · Quinta)</option>
                  <option value="72" ${ctx.preview.midiNote === 72 ? 'selected' : ''}>C5 (72 · Agudo)</option>
                  <option value="84" ${ctx.preview.midiNote === 84 ? 'selected' : ''}>C6 (84 · Muy Agudo)</option>
                </select>
                <div style="display: inline-flex; align-items: center; gap: 4px;">
                  <span class="text-muted" style="font-size: 11px;">VEL:</span>
                  <input type="number" id="inp-cfg-resv2-vel" class="form-control font-mono" style="width: 64px;" min="1" max="127" value="${ctx.preview.velocity}" title="Velocidad MIDI (1..127)" />
                </div>
                <div style="display: inline-flex; align-items: center; gap: 4px;">
                  <span class="text-muted" style="font-size: 11px;">HOST BPM:</span>
                  <input type="number" id="inp-cfg-resv2-host-bpm" class="form-control font-mono" style="width: 72px;" min="20" max="300" value="${ctx.preview.hostBpm}" title="BPM simulado del DAW para comprobar el escalado Tempo-Sync" />
                </div>
                <button type="button" class="btn btn-primary btn-xs" id="btn-cfg-resv2-play" title="Sintetiza y reproduce en tiempo real con el motor Resinator v2 de ABDShared aplicando todos los moldeadores y Tempo-Sync actuales">
                  ${ICONS.play} Escuchar Resinator v2
                </button>
                <button type="button" class="btn btn-outline btn-xs" id="btn-cfg-resv2-compare-faithful" title="Compara contra la superficie neutral sin moldeadores (A/B)">
                  Comparar Neutral (A/B)
                </button>
                <button type="button" class="btn btn-outline btn-xs" id="btn-cfg-resv2-stop" title="Detener preescucha">
                  Stop
                </button>
              </div>
            </div>
          </div>
        </fieldset>

        <div class="card">
          <div class="model-cfg-card-header">
            <h4>${ICONS.wave} Master 24/96 Standard &amp; Dynamic Range</h4>
            <span class="nmm-hint">Studio-grade master wave resynthesis standards</span>
          </div>
          <p class="cfg-explainer">
            When Master 24/96 processing is applied, original samples are promoted using cubic hermite interpolation and zero-crossing seam alignment. This ensures zero phase distortion when models are triggered in polyphonic environments.
          </p>
          <div class="master-specs-grid">
            <div class="master-spec-badge">
              <strong>SAMPLE RATE</strong>
              <span>96.000 Hz</span>
            </div>
            <div class="master-spec-badge">
              <strong>BIT DEPTH</strong>
              <span>24-bit PCM</span>
            </div>
            <div class="master-spec-badge">
              <strong>SEAM SNAPPING</strong>
              <span>Zero-Crossing &plusmn;128 smp</span>
            </div>
            <div class="master-spec-badge">
              <strong>PHASE CORRELATION</strong>
              <span>Stereo Orthogonal</span>
            </div>
          </div>
        </div>
      </div>
    `;
}
