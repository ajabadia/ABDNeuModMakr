// ─────────────────────────────────────────────────────────
// MusicianWizardModal — wizardStep3View (Fase 42.5)
// Funciones extraidas verbatim de `src/ui/MusicianWizardModal.ts`.
// `modal` es el nucleo estructural (`WizardModalCore`).
// ─────────────────────────────────────────────────────────

import { getAppLocale } from '../../core/i18n.ts';
import { midiToNoteName } from '../ZoneRibbon.ts';
import { escHtml } from '../escape.ts';
import { ICONS } from '../icons.ts';
import { MUSICIAN_TERMS } from '../preflightGateView.ts';
import type { WizardModalCore } from './wizardModalCore.ts';

export function renderStep3SliceAndMap(modal: WizardModalCore): string {
    const isEs = getAppLocale() === 'es';
    const res = modal.sliceMapResult;

    const slicesRowsHtml = (res?.slices ?? [])
      .slice(0, 24)
      .map(
        (sl, idx) => `
        <tr class="triage-row" data-slice-idx="${idx}">
          <td class="triage-col-idx">#${idx + 1}</td>
          <td class="triage-item-name">${escHtml(sl.label)}</td>
          <td class="triage-num">${(sl.durationSec * 1000).toFixed(0)} ms</td>
          <td class="triage-num">${isEs ? `Teclas ${sl.lowKey}..${sl.highKey} (Raíz ${sl.rootKey})` : `Keys ${sl.lowKey}..${sl.highKey} (Root ${sl.rootKey})`}</td>
          <td class="triage-col-action">
            <button type="button" class="btn btn-xs btn-outline btn-wiz-play-slice" data-slice-idx="${idx}">
              ${ICONS.play} ${isEs ? 'Escuchar' : 'Play'}
            </button>
          </td>
        </tr>
      `
      )
      .join('');

    return `
      <div class="nmm-batch-preflight-pane">
        <div class="triage-summary">
          ${ICONS.scissors}
          <div>
            <p><strong>${isEs ? 'Paso 3 — Cortar y mapear en el teclado ("¿Batería o melodía?")' : 'Step 3 — Slice & map across the keyboard ("Drums or melody?")'}</strong></p>
            <p>${isEs ? 'Por defecto el asistente analiza el timbre y los ataques para decidir solo cómo trocear y repartir las zonas en el teclado MIDI <code>0..127</code> con ajuste al cruce por cero (<code>zc-snap</code>) y 2 capas en modo Classic.' : 'By default the wizard analyzes timbre and transients to automatically slice and distribute zones across MIDI keys <code>0..127</code> with zero-crossing snap (<code>zc-snap</code>) and 2 velocity layers in Classic mode.'}</p>
          </div>
        </div>

        <!-- Selector principal: ¿Batería o melodía? con "Detectar solo" por defecto -->
        <div class="nmm-batch-card">
          <h3>${isEs ? '¿Qué tipo de material has grabado o importado?' : 'What kind of material did you record or import?'}</h3>
          <div class="triage-toolbar-left">
            <button
              type="button"
              class="btn ${modal.roleChoice === 'auto' ? 'btn-primary' : 'btn-outline'}"
              data-wiz-role="auto"
            >
              ${ICONS.sparkle} ${isEs ? 'Detectar solo (Recomendado)' : 'Auto-detect (Recommended)'}
            </button>
            <button
              type="button"
              class="btn ${modal.roleChoice === 'drums' ? 'btn-primary' : 'btn-outline'}"
              data-wiz-role="drums"
            >
              ${ICONS.drum} ${isEs ? 'Batería / Percusión' : 'Drums / Percussion'}
            </button>
            <button
              type="button"
              class="btn ${modal.roleChoice === 'melody' ? 'btn-primary' : 'btn-outline'}"
              data-wiz-role="melody"
            >
              ${ICONS.piano} ${isEs ? 'Melodía / Varias notas' : 'Melody / Multiple notes'}
            </button>
            <button
              type="button"
              class="btn ${modal.roleChoice === 'single' ? 'btn-primary' : 'btn-outline'}"
              data-wiz-role="single"
            >
              ${ICONS.wave} ${isEs ? 'Nota única sostenida' : 'Single sustained note'}
            </button>
          </div>

          ${
            res
              ? `
            <div class="preflight-status is-ok cfg-gap-top">
              <div class="preflight-status-head">
                <div class="preflight-status-title">
                  <span class="preflight-status-icon">${ICONS.check}</span>
                  <span>${isEs ? 'Veredicto:' : 'Verdict:'} ${escHtml(res.roleLabelEs)}</span>
                </div>
                <span class="preflight-status-meta">
                  ${isEs ? 'Categoría:' : 'Category:'} ${escHtml(res.detectedCategory)} · Parameter Set #${res.suggestedParameterSet} (${Math.round(res.classificationConfidence * 100)}% conf.)
                </span>
              </div>
              <p>${escHtml(res.roleExplanationEs)}</p>
              <p class="nmm-batch-hint" id="wiz-auto-decision-reason">${escHtml(res.autoDecisionReasonEs)}</p>
            </div>
          `
              : ''
          }

          ${
            res && res.resolvedRole === 'single'
              ? `
            <div class="batch-slicer-row" id="wiz-single-root-correction-bar">
              <div class="batch-field">
                <label for="inp-wiz-single-root">
                  ${isEs ? 'Nota raíz' : 'Root key'} (${midiToNoteName(res.effectiveRootKey)} · F0 auto: ${res.detectedF0Hz.toFixed(1)} Hz):
                </label>
                <button type="button" class="btn btn-xs btn-outline" data-wiz-root-delta="-12" title="${isEs ? 'Bajar 1 octava (-12 semitonos)' : 'Down 1 octave (-12 semitones)'}">-12 Oct</button>
                <button type="button" class="btn btn-xs btn-outline" data-wiz-root-delta="-1" title="${isEs ? 'Bajar 1 semitono' : 'Down 1 semitone'}">-1 Semi</button>
                <input
                  type="number"
                  id="inp-wiz-single-root"
                  class="form-control"
                  min="0"
                  max="127"
                  value="${res.effectiveRootKey}"
                  aria-label="${isEs ? 'Nota raíz MIDI (0..127)' : 'MIDI root key (0..127)'}"
                />
                <span class="val-pill">${midiToNoteName(res.effectiveRootKey)} (MIDI ${res.effectiveRootKey})</span>
                <button type="button" class="btn btn-xs btn-outline" data-wiz-root-delta="1" title="${isEs ? 'Subir 1 semitono' : 'Up 1 semitone'}">+1 Semi</button>
                <button type="button" class="btn btn-xs btn-outline" data-wiz-root-delta="12" title="${isEs ? 'Subir 1 octava (+12 semitonos)' : 'Up 1 octave (+12 semitones)'}">+12 Oct</button>
                ${
                  modal.singleRootKeyOverride !== null && modal.singleRootKeyOverride !== res.detectedRootKey
                    ? `
                  <button type="button" class="btn btn-xs btn-ghost" id="btn-wiz-root-reset-auto" title="${isEs ? `Restaurar nota raíz estimada por F0 (${midiToNoteName(res.detectedRootKey)})` : `Restore F0 estimated root key (${midiToNoteName(res.detectedRootKey)})`}">
                    Auto F0 (${midiToNoteName(res.detectedRootKey)})
                  </button>
                `
                    : ''
                }
              </div>
            </div>
          `
              : ''
          }

          <div class="batch-slicer-row">
            <div class="batch-field">
              <label for="rng-wiz-sens">${isEs ? 'Sensibilidad de corte:' : 'Slice sensitivity:'}</label>
              <input
                type="range"
                id="rng-wiz-sens"
                min="15"
                max="95"
                step="5"
                value="${modal.sensitivity}"
                ${modal.roleChoice === 'single' ? 'disabled' : ''}
              />
              <span class="val-pill">${modal.sensitivity}%</span>
            </div>

            <label class="batch-check">
              <input type="checkbox" id="chk-wiz-step3-zcsnap" ${modal.optSnapZeroCrossing ? 'checked' : ''} />
              <span>${escHtml(MUSICIAN_TERMS.zcSnap)}</span>
            </label>

            <label class="batch-check">
              <input type="checkbox" id="chk-wiz-step3-2layers" ${modal.optClassicTwoLayers ? 'checked' : ''} />
              <span>${isEs ? 'Preparar 2 capas de velocidad en Classic (Suave 1..63 / Fuerte 64..127)' : 'Prepare 2 velocity layers in Classic (Soft 1..63 / Loud 64..127)'}</span>
            </label>
          </div>
        </div>

        <!-- Tabla de zonas / rebanadas generadas -->
        <div class="nmm-batch-card">
          <div class="triage-toolbar">
            <div class="triage-toolbar-left">
              <h3>${isEs ? `Zonas mapeadas en el teclado (${res?.classicZones.length ?? 0} zona(s) · Cobertura 0..127 completa)` : `Zones mapped across keyboard (${res?.classicZones.length ?? 0} zone(s) · Full 0..127 coverage)`}</h3>
            </div>
            <div class="triage-toolbar-right">
              ${
                modal.context.onOpenAdvancedChopper
                  ? `
                <button type="button" class="btn btn-outline btn-sm" id="btn-wiz-open-adv-chopper">
                  ${ICONS.scissors} ${isEs ? 'Ajustar cortes en taller avanzado (Audio Chopper)…' : 'Fine-tune slices in advanced workshop (Audio Chopper)…'}
                </button>
              `
                  : ''
              }
              ${
                modal.context.onOpenAdvancedLoopEditor
                  ? `
                <button type="button" class="btn btn-outline btn-sm" id="btn-wiz-open-adv-loop">
                  ${ICONS.wave} ${isEs ? 'Taller de bucles (Loop Editor)…' : 'Loop workshop (Loop Editor)…'}
                </button>
              `
                  : ''
              }
            </div>
          </div>

          <div class="nmm-batch-table-container">
            <table class="triage-table">
              <thead>
                <tr>
                  <th class="triage-col-idx">#</th>
                  <th>${isEs ? 'Nota / Golpe detectado' : 'Detected Note / Hit'}</th>
                  <th>${isEs ? 'Duración' : 'Duration'}</th>
                  <th>${isEs ? 'Rango de teclado MIDI' : 'MIDI Key Range'}</th>
                  <th class="triage-col-action">${isEs ? 'Escuchar' : 'Audition'}</th>
                </tr>
              </thead>
              <tbody>
                ${slicesRowsHtml || `<tr><td colspan="5" class="triage-empty">${isEs ? 'Sin cortes' : 'No slices'}</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>

        <footer class="nmm-modal-footer">
          <div class="footer-left">
            <button type="button" class="btn btn-outline" id="btn-wiz-back-step2">← ${isEs ? '2. Limpiar' : '2. Clean'}</button>
          </div>
          <div class="footer-right">
            <button type="button" class="btn btn-primary" id="btn-wiz-to-step4">
              ${isEs ? 'Siguiente: 4. Generar y exportar →' : 'Next: 4. Generate & Export →'}
            </button>
          </div>
        </footer>
      </div>
    `;
  }
