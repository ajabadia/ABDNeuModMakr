// ─────────────────────────────────────────────────────────
// Model Configuration — Tab 2: Playback, Articulation & Resinator Lab (HTML renderer).
// ─────────────────────────────────────────────────────────

import { getAppLocale } from '../../core/i18n';
import {
  DEFAULT_UNIFIED_SURFACE_CONFIG,
  type ProcessConfig,
  type UnifiedSurfaceUiConfig,
} from '../../core/types';
import { ICONS } from '../icons';
import type { ModelConfigTabContext } from './types';

export function renderArticulationTab(ctx: ModelConfigTabContext, config: ProcessConfig): string {
    const isEs = getAppLocale() === 'es';
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
                ${ICONS.piano} ${isEs ? 'Reproducción Global del Instrumento y Seguimiento de Teclado' : 'Global Instrument Playback &amp; Keytrack'}
                ${!isExtended ? `<span class="cond-reason-badge is-extended-only">${isEs ? 'SOLO MODO EXTENDED' : 'EXTENDED MODE ONLY'}</span>` : ''}
              </h4>
              <span class="nmm-hint">${isEs ? 'Valores globales por defecto aplicados a todas las zonas y regiones del modelo' : 'Global defaults applied across all model zones and regions'}</span>
            </div>

            <div class="form-row-dual">
              <div class="form-group flex-1">
                <label for="sel-cfg-loop-mode">${isEs ? 'MODO DE BUCLE POR DEFECTO' : 'DEFAULT LOOP MODE'}</label>
                <select id="sel-cfg-loop-mode" class="form-control">
                  <option value="no_loop" ${cp.loopMode === 'no_loop' ? 'selected' : ''}>${isEs ? 'One-Shot (Sin Bucle)' : 'One-Shot (No Loop)'}</option>
                  <option value="loop_continuous" ${cp.loopMode === 'loop_continuous' ? 'selected' : ''}>${isEs ? 'Bucle Continuo hacia Adelante' : 'Continuous Forward Loop'}</option>
                  <option value="ping_pong" ${cp.loopMode === 'ping_pong' ? 'selected' : ''}>${isEs ? 'Ping-Pong (Alterno)' : 'Ping-Pong (Alternate)'}</option>
                  <option value="loop_sustain" ${cp.loopMode === 'loop_sustain' ? 'selected' : ''}>${isEs ? 'Bucle en Sustain (Release One-Shot)' : 'Sustain Loop (Release One-Shot)'}</option>
                </select>
              </div>

              <div class="form-group flex-1">
                <label for="sel-cfg-trigger">${isEs ? 'LÓGICA DE DISPARO DE NOTA' : 'NOTE TRIGGER LOGIC'}</label>
                <select id="sel-cfg-trigger" class="form-control">
                  <option value="attack" ${cp.trigger === 'attack' ? 'selected' : ''}>${isEs ? 'Attack (Key-On Normal)' : 'Attack (Key-On Normal)'}</option>
                  <option value="release" ${cp.trigger === 'release' ? 'selected' : ''}>${isEs ? 'Release Trigger (Muestra al soltar tecla)' : 'Release Trigger (Key-Off Release Sample)'}</option>
                  <option value="first" ${cp.trigger === 'first' ? 'selected' : ''}>${isEs ? 'Solo Primera Nota Legato' : 'Legato First Note Only'}</option>
                  <option value="legato" ${cp.trigger === 'legato' ? 'selected' : ''}>${isEs ? 'Solo Notas Conectadas en Legato' : 'Legato Connected Notes Only'}</option>
                </select>
              </div>
            </div>

            <div class="form-row-dual">
              <div class="form-group flex-1">
                <label for="sel-cfg-fade-curve">${isEs ? 'CURVA DE FUNDIDO CRUZADO' : 'CROSSFADE CURVE'}</label>
                <select id="sel-cfg-fade-curve" class="form-control">
                  <option value="equal-power" ${cp.fadeCurve === 'equal-power' ? 'selected' : ''}>${isEs ? 'Igual Potencia (Sin caída de 3 dB - Estándar Acústico)' : 'Equal Power (3dB Dip Free - Acoustic Standard)'}</option>
                  <option value="linear" ${cp.fadeCurve === 'linear' ? 'selected' : ''}>${isEs ? 'Ganancia Lineal' : 'Linear Gain'}</option>
                  <option value="spectral-morph" ${cp.fadeCurve === 'spectral-morph' ? 'selected' : ''}>${isEs ? 'Morph Espectral' : 'Spectral Morph'}</option>
                </select>
              </div>

              <div class="form-group flex-1">
                <div class="label-with-val">
                  <label for="inp-cfg-keytrack">${isEs ? 'SEGUIMIENTO DE TONO (KEYTRACK)' : 'PITCH KEYTRACK'}</label>
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
                ${ICONS.sparkle} ${isEs ? 'Superficie Espectral Unificada y Laboratorio de Resinator' : 'Unified Spectral Surface &amp; Resinator Lab'}
                ${!isExtended ? `<span class="cond-reason-badge is-extended-only">${isEs ? 'SOLO MODO EXTENDED' : 'EXTENDED MODE ONLY'}</span>` : ''}
              </h4>
              <span class="nmm-hint">${isEs ? 'Control de ataque/release espectral, bloqueo de formantes Bark, modo Quimera y transmutación de materiales' : 'Spectral attack/release control, Bark formant lock, Chimera mode, and material transmutation'}</span>
            </div>

            <div class="form-group" style="margin-bottom: 10px;">
              <label>${isEs ? 'PRESETS RÁPIDOS DE LABORATORIO (1 CLIC)' : 'QUICK LAB PRESETS (1 CLICK)'}</label>
              <div class="btn-group-toggle" style="display:flex; flex-wrap:wrap; gap:6px;">
                <button type="button" class="btn btn-outline btn-xs btn-surf-preset" data-preset="faithful" title="${isEs ? 'Sonido 100% fiel al instrumento original, con escudo anti-intrusos y bloqueo de formantes activo' : '100% faithful to the original instrument, with outlier shield and formant lock active'}">
                  ${isEs ? 'Fiel al Original' : 'Faithful to Original'}
                </button>
                <button type="button" class="btn btn-outline btn-xs btn-surf-preset" data-preset="chimera" title="${isEs ? 'Activa Modo Quimera y fuerza superficie melódica para fundir muestras de distintos instrumentos o percusiones' : 'Enables Chimera Mode and forces melodic surface to blend samples from different instruments or percussion'}">
                  ${isEs ? 'Quimera Morph (Híbrido)' : 'Chimera Morph (Hybrid)'}
                </button>
                <button type="button" class="btn btn-outline btn-xs btn-surf-preset" data-preset="instant-pluck" title="${isEs ? 'Salta al pico de plenitud espectral (Attack=100%) para convertir pads lentos en ataques inmediatos' : 'Jumps to spectral peak (Attack=100%) to turn slow pads into immediate attacks'}">
                  ${isEs ? 'Pad → Ataque Inmediato' : 'Pad → Instant Pluck'}
                </button>
                <button type="button" class="btn btn-outline btn-xs btn-surf-preset" data-preset="infinite-tail" title="${isEs ? 'Alarga +5.0 s la cola de muestras cortadas en seco con amortiguación física de agudos' : 'Extends dry-cut sample tails by +5.0 s with physical high-frequency damping'}">
                  ${isEs ? 'Cola Espectral (+5 s)' : 'Spectral Tail (+5 s)'}
                </button>
                <button type="button" class="btn btn-outline btn-xs btn-surf-preset" data-preset="crystal-bell" title="${isEs ? 'Aumenta la rigidez inarmónica B y paridad impar para transmutar el timbre en cristal/campana tubular' : 'Increases inharmonic stiffness B and odd parity to transmute timbre into crystal/tubular bell'}">
                  ${isEs ? 'Campana / Cristal Metálico' : 'Crystal / Metallic Bell'}
                </button>
                <button type="button" class="btn btn-outline btn-xs btn-surf-preset" data-preset="ddsp-ghost" title="${isEs ? 'Prioriza el residuo estocástico DDSP en 24 bandas Bark para crear un susurro/aire espectral afinado' : 'Prioritizes 24-band Bark DDSP stochastic residual to create a tuned spectral whisper/air'}">
                  ${isEs ? 'Fantasma de Aire DDSP' : 'DDSP Air Ghost'}
                </button>
              </div>
            </div>

            <div class="form-row-dual" style="margin-bottom: 10px;">
              <label class="checkbox-label" title="${isEs ? 'Si está desactivado, las muestras intrusas de otro instrumento se aíslan automáticamente. Actívalo para interpolar a propósito entre instrumentos distintos (Quimera).' : 'When unchecked, outlier samples from other instruments are automatically isolated. Enable to purposefully interpolate across different instruments (Chimera).'}">
                <input type="checkbox" id="chk-cfg-surf-outliers" class="articulation-checkbox switch--sm" ${surf.includeOutliers ? 'checked' : ''} />
                <span><strong>${isEs ? 'Modo Quimera:' : 'Chimera Mode:'}</strong> ${isEs ? 'Interpolar muestras de distintos instrumentos (Desactivar escudo de intrusos)' : 'Interpolate samples across different instruments (Disable outlier shield)'}</span>
              </label>
              <label class="checkbox-label" title="${isEs ? 'Conserva los primeros ~20 ms del ataque físico real en PCM alineado en fase con los osciladores del Resinator.' : 'Preserves the first ~20 ms of the real physical PCM attack phase-aligned with Resinator oscillators.'}">
                <input type="checkbox" id="chk-cfg-surf-transient" class="articulation-checkbox switch--sm" ${surf.preserveHybridTransients !== false ? 'checked' : ''} />
                <span><strong>${isEs ? 'Ataque Físico Híbrido:' : 'Hybrid Physical Attack:'}</strong> ${isEs ? 'Preservar micro-transitorio PCM (20 ms) en fase' : 'Preserve phase-aligned PCM micro-transient (20 ms)'}</span>
              </label>
            </div>

            <div class="form-row-dual">
              <div class="form-group flex-1">
                <div class="label-with-val">
                  <label for="inp-cfg-surf-attack-shorten">${isEs ? 'ACORTAR ATAQUE LENTO (SALTO AL PICO)' : 'SHORTEN SLOW ATTACK (JUMP TO PEAK)'}</label>
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
                  <label for="inp-cfg-surf-release-extend">${isEs ? 'ALARGAR RELEASE INEXISTENTE (COLA)' : 'EXTEND MISSING RELEASE (TAIL)'}</label>
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
                  <label for="inp-cfg-surf-formant-lock">${isEs ? 'BLOQUEO DE CUERPO / FORMANTES BARK' : 'BODY / BARK FORMANT LOCK'}</label>
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
                  <label for="inp-cfg-surf-inharm">${isEs ? 'RIGIDEZ INARMÓNICA (CUERDA → CAMPANA)' : 'INHARMONIC STIFFNESS (STRING → BELL)'}</label>
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
                  <label for="inp-cfg-surf-parity">${isEs ? 'PARIDAD ARMÓNICA (TUBO IMPAR ↔ CÁLIDO PAR)' : 'HARMONIC PARITY (ODD TUBE ↔ WARM EVEN)'}</label>
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
                  <label for="inp-cfg-surf-residual">${isEs ? 'MEZCLA AIRE / RESIDUO ESTOCÁSTICO DDSP' : 'DDSP AIR / STOCHASTIC RESIDUAL MIX'}</label>
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
              <label class="checkbox-label" title="${isEs ? 'Guarda en el contrato axionik-expanded.json el BPM original y número de compases para que el Resinator v2 de ABDAxionikVS sincronice la velocidad de evolución espectral al reloj del DAW (hostBpm / sourceBpm) sin alterar la afinación F0 ni los formantes Bark.' : 'Stores source BPM and bar count in axionik-expanded.json so ABDAxionikVS Resinator v2 syncs spectral evolution speed to the DAW clock (hostBpm / sourceBpm) without altering F0 pitch or Bark formants.'}">
                <input type="checkbox" id="chk-cfg-surf-temposync" class="articulation-checkbox switch--sm" ${surf.tempoSync?.enabled ? 'checked' : ''} />
                <span><strong>${isEs ? 'Sincronizar Evolución Espectral al BPM del Host (Tempo-Sync / REX Loop en Resinator v2)' : 'Sync Spectral Evolution to Host BPM (Tempo-Sync / REX Loop in Resinator v2)'}</strong></span>
              </label>
            </div>

            <fieldset class="conditioned-fieldset" ${!surf.tempoSync?.enabled ? 'disabled' : ''}>
              <div class="form-row-dual ${!surf.tempoSync?.enabled ? 'is-conditioned-disabled' : ''}" id="surf-temposync-details-row">
                <div class="form-group flex-1">
                  <div class="label-with-val">
                    <label for="inp-cfg-surf-source-bpm">
                      ${isEs ? 'BPM ORIGINAL DE LA TOMA / LOOP' : 'ORIGINAL TAKE / LOOP BPM'}
                      ${!surf.tempoSync?.enabled ? `<span class="cond-reason-badge">${isEs ? 'ACTIVA TEMPO-SYNC' : 'ENABLE TEMPO-SYNC'}</span>` : ''}
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
                    <label for="inp-cfg-surf-bar-count">${isEs ? 'COMPASES (BARS) Y MODO DE GROOVE' : 'BARS &amp; GROOVE MODE'}</label>
                    <span class="val-pill" id="val-cfg-surf-bars">${surf.tempoSync?.barCount ?? 2} ${isEs ? 'compases (4/4)' : 'bars (4/4)'}</span>
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
                      title="${isEs ? 'Longitud del bucle o frase en compases' : 'Loop or phrase length in bars'}"
                    />
                     <select id="sel-cfg-surf-groove-mode" class="form-control cfg-flex-1" title="${isEs ? 'Modo de fraseo o bucle para el Resinator v2' : 'Phrasing or loop mode for Resinator v2'}">
                      <option value="free" ${(surf.tempoSync?.grooveMode ?? 'free') === 'free' ? 'selected' : ''}>${isEs ? 'Libre / Evolución Continua' : 'Free / Continuous Evolution'}</option>
                      <option value="rex_loop" ${surf.tempoSync?.grooveMode === 'rex_loop' ? 'selected' : ''}>${isEs ? 'Bucle Rítmico tipo REX (Drum Groove)' : 'REX-Style Rhythmic Loop (Drum Groove)'}</option>
                      <option value="melodic_phrase" ${surf.tempoSync?.grooveMode === 'melodic_phrase' ? 'selected' : ''}>${isEs ? 'Frase Melódica / Riff Sincronizado' : 'Synced Melodic Phrase / Riff'}</option>
                      <option value="sliced_kit" ${surf.tempoSync?.grooveMode === 'sliced_kit' ? 'selected' : ''}>${isEs ? 'Kit Troceado por Tecla' : 'Per-Key Sliced Kit'}</option>
                    </select>
                  </div>
                </div>
              </div>
            </fieldset>

            <!-- Preescucha en Vivo del Resinator v2 (ABDShared Engine) -->
            <div class="form-group" style="margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--color-panel-border);">
              <div class="label-with-val" style="margin-bottom: 6px;">
                <label>${ICONS.play} ${isEs ? 'PREESCUCHA EN VIVO DEL MOTOR RESINATOR V2' : 'RESINATOR V2 ENGINE LIVE PREVIEW'} (<code>ABDShared::NeuronResynatorV2</code>)</label>
                <span class="val-pill">Pseudo-Surround 4.0 &rarr; 2.0</span>
              </div>
              <div class="cfg-inline-row" style="flex-wrap: wrap; gap: 8px; align-items: center;">
                <select id="sel-cfg-resv2-note" class="form-control" style="width: 110px;" title="${isEs ? 'Nota MIDI para audicionar la Superficie Espectral Continua' : 'MIDI note to audition the Continuous Spectral Surface'}">
                  <option value="36" ${ctx.preview.midiNote === 36 ? 'selected' : ''}>C2 (36 · ${isEs ? 'Grave' : 'Low'})</option>
                  <option value="48" ${ctx.preview.midiNote === 48 ? 'selected' : ''}>C3 (48 · ${isEs ? 'Bajo' : 'Bass'})</option>
                  <option value="60" ${ctx.preview.midiNote === 60 ? 'selected' : ''}>C4 (60 · ${isEs ? 'Medio' : 'Mid'})</option>
                  <option value="67" ${ctx.preview.midiNote === 67 ? 'selected' : ''}>G4 (67 · ${isEs ? 'Quinta' : 'Fifth'})</option>
                  <option value="72" ${ctx.preview.midiNote === 72 ? 'selected' : ''}>C5 (72 · ${isEs ? 'Agudo' : 'High'})</option>
                  <option value="84" ${ctx.preview.midiNote === 84 ? 'selected' : ''}>C6 (84 · ${isEs ? 'Muy Agudo' : 'Very High'})</option>
                </select>
                <div style="display: inline-flex; align-items: center; gap: 4px;">
                  <span class="text-muted" style="font-size: 11px;">VEL:</span>
                  <input type="number" id="inp-cfg-resv2-vel" class="form-control font-mono" style="width: 64px;" min="1" max="127" value="${ctx.preview.velocity}" title="${isEs ? 'Velocidad MIDI (1..127)' : 'MIDI Velocity (1..127)'}" />
                </div>
                <div style="display: inline-flex; align-items: center; gap: 4px;">
                  <span class="text-muted" style="font-size: 11px;">HOST BPM:</span>
                  <input type="number" id="inp-cfg-resv2-host-bpm" class="form-control font-mono" style="width: 72px;" min="20" max="300" value="${ctx.preview.hostBpm}" title="${isEs ? 'BPM simulado del DAW para comprobar el escalado Tempo-Sync' : 'Simulated DAW BPM to test Tempo-Sync scaling'}" />
                </div>
                <button type="button" class="btn btn-primary btn-xs" id="btn-cfg-resv2-play" title="${isEs ? 'Sintetiza y reproduce en tiempo real con el motor Resinator v2 de ABDShared aplicando todos los moldeadores y Tempo-Sync actuales' : 'Synthesizes and plays in real time with ABDShared Resinator v2 engine applying all current shapers and Tempo-Sync'}">
                  ${ICONS.play} ${isEs ? 'Escuchar Resinator v2' : 'Audition Resinator v2'}
                </button>
                <button type="button" class="btn btn-outline btn-xs" id="btn-cfg-resv2-compare-faithful" title="${isEs ? 'Compara contra la superficie neutral sin moldeadores (A/B)' : 'Compare against neutral surface without shapers (A/B)'}">
                  ${isEs ? 'Comparar Neutral (A/B)' : 'Compare Neutral (A/B)'}
                </button>
                <button type="button" class="btn btn-outline btn-xs" id="btn-cfg-resv2-stop" title="${isEs ? 'Detener preescucha' : 'Stop preview'}">
                  Stop
                </button>
              </div>
            </div>
          </div>
        </fieldset>

        <div class="card">
          <div class="model-cfg-card-header">
            <h4>${ICONS.wave} ${isEs ? 'Estándar Master 24/96 y Rango Dinámico' : 'Master 24/96 Standard &amp; Dynamic Range'}</h4>
            <span class="nmm-hint">${isEs ? 'Estándares de resíntesis Master Wave de grado de estudio' : 'Studio-grade master wave resynthesis standards'}</span>
          </div>
          <p class="cfg-explainer">
            ${isEs ? 'Al aplicar el procesado Master 24/96, las muestras originales se promueven mediante interpolación cúbica de Hermite y alineación de costuras por cruce por cero. Esto garantiza cero distorsión de fase al disparar modelos en entornos polifónicos.' : 'When Master 24/96 processing is applied, original samples are promoted using cubic hermite interpolation and zero-crossing seam alignment. This ensures zero phase distortion when models are triggered in polyphonic environments.'}
          </p>
          <div class="master-specs-grid">
            <div class="master-spec-badge">
              <strong>${isEs ? 'FREC. MUESTREO' : 'SAMPLE RATE'}</strong>
              <span>96.000 Hz</span>
            </div>
            <div class="master-spec-badge">
              <strong>${isEs ? 'PROFUNDIDAD BITS' : 'BIT DEPTH'}</strong>
              <span>24-bit PCM</span>
            </div>
            <div class="master-spec-badge">
              <strong>${isEs ? 'AJUSTE COSTURAS' : 'SEAM SNAPPING'}</strong>
              <span>Zero-Crossing &plusmn;128 smp</span>
            </div>
            <div class="master-spec-badge">
              <strong>${isEs ? 'CORRELACIÓN FASE' : 'PHASE CORRELATION'}</strong>
              <span>${isEs ? 'Estéreo Ortogonal' : 'Stereo Orthogonal'}</span>
            </div>
          </div>
        </div>
      </div>
    `;
}
