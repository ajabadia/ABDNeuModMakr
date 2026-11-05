// ─────────────────────────────────────────────────────────
// MusicianWizardModal — wizardStep2View (Fase 42.5)
// Funciones extraidas verbatim de `src/ui/MusicianWizardModal.ts`.
// `modal` es el nucleo estructural (`WizardModalCore`).
// ─────────────────────────────────────────────────────────

import { getAppLocale } from '../../core/i18n.ts';
import { escHtml } from '../escape.ts';
import { ICONS } from '../icons.ts';
import { MUSICIAN_TERMS } from '../preflightGateView.ts';
import type { WizardModalCore } from './wizardModalCore.ts';

export function renderStep2Clean(modal: WizardModalCore): string {
    const isEs = getAppLocale() === 'es';
    const clean = modal.cleanResult;
    const noiseDb =
      clean && Number.isFinite(clean.noiseProfile.levelDbfs)
        ? `${clean.noiseProfile.levelDbfs.toFixed(1)} dBFS`
        : isEs
          ? 'Silencio limpio (<-85 dBFS)'
          : 'Clean silence (<-85 dBFS)';
    const hum50 =
      clean && Number.isFinite(clean.noiseProfile.hum50HzDb)
        ? `${clean.noiseProfile.hum50HzDb.toFixed(1)} dB`
        : isEs
          ? 'n/d'
          : 'n/a';

    return `
      <div class="nmm-batch-preflight-pane">
        <div class="triage-summary">
          ${ICONS.wave}
          <div>
            <p><strong>${isEs ? `Paso 2 — Limpiar toma antes de cortar (${escHtml(modal.sourceName)})` : `Step 2 — Clean take before slicing (${escHtml(modal.sourceName)})`}</strong></p>
            <p>${isEs ? 'Aplicamos por defecto los ajustes seguros de músico: recorte de silencios ajustado al cruce por cero (sin clics), limpieza de ruido de fondo y normalización a -1.0 dBFS.' : 'Safe musician defaults are enabled automatically: zero-crossing silence trimming (click-free), background noise reduction, and -1.0 dBFS peak normalization.'}</p>
          </div>
        </div>

        <!-- Resumen de métricas Antes / Después -->
        <div class="nmm-batch-card">
          <h3>${isEs ? `Diagnóstico de limpieza y ${escHtml(MUSICIAN_TERMS.noisePrint)}` : `Clean-up diagnostics & ${escHtml(MUSICIAN_TERMS.noisePrint)}`}</h3>
          <div class="nmm-metric-grid">
            <div class="nmm-metric-card">
              <span class="nmm-metric-lbl">${escHtml(MUSICIAN_TERMS.noisePrint)}:</span>
              <strong class="nmm-metric-val">${escHtml(noiseDb)} (Hum 50 Hz: ${escHtml(hum50)})</strong>
            </div>
            <div class="nmm-metric-card">
              <span class="nmm-metric-lbl">${isEs ? 'Duración (Antes → Después):' : 'Duration (Before → After):'}</span>
              <strong class="nmm-metric-val">${clean ? `${clean.durationBeforeSec}s → ${clean.durationAfterSec}s` : '—'}</strong>
            </div>
            <div class="nmm-metric-card">
              <span class="nmm-metric-lbl">${isEs ? 'Silencio recortado:' : 'Silence trimmed:'}</span>
              <strong class="nmm-metric-val">${clean ? (isEs ? `Entrada: ${clean.leadingTrimmedMs} ms · Salida: ${clean.trailingTrimmedMs} ms` : `Lead: ${clean.leadingTrimmedMs} ms · Trail: ${clean.trailingTrimmedMs} ms`) : '—'}</strong>
            </div>
            <div class="nmm-metric-card">
              <span class="nmm-metric-lbl">${isEs ? 'Nivel de Pico (Antes → Después):' : 'Peak Level (Before → After):'}</span>
              <strong class="nmm-metric-val batch-val-success">${clean ? `${clean.peakBeforeDbfs} dBFS → ${clean.peakAfterDbfs} dBFS` : '—'}</strong>
            </div>
          </div>

          <div class="batch-slicer-row">
            <button type="button" class="btn btn-outline btn-sm" id="btn-wiz-audition-raw">
              ${ICONS.play} ${isEs ? 'Escuchar original' : 'Audition original'}
            </button>
            <button type="button" class="btn btn-primary btn-sm" id="btn-wiz-audition-clean">
              ${ICONS.play} ${isEs ? 'Escuchar audio limpio' : 'Audition cleaned audio'}
            </button>
            <button type="button" class="btn btn-ghost btn-sm" id="btn-wiz-stop-audition">
              ${ICONS.stop} ${isEs ? 'Detener' : 'Stop'}
            </button>
          </div>
        </div>

        <!-- Opciones de limpieza con Defaults de Músico -->
        <div class="nmm-batch-card">
          <h3>${isEs ? 'Ajustes de limpieza (Defaults de músico activados)' : 'Clean-up settings (Musician defaults enabled)'}</h3>
          <div class="nmm-metric-grid">
            <label class="batch-check">
              <input type="checkbox" id="chk-wiz-trim" ${modal.optTrimSilence ? 'checked' : ''} />
              <span>${isEs ? 'Recortar silencios de entrada y salida automáticamente' : 'Automatically trim leading and trailing silence'}</span>
            </label>
            <label class="batch-check">
              <input type="checkbox" id="chk-wiz-zcsnap" ${modal.optSnapZeroCrossing ? 'checked' : ''} />
              <span><strong>${escHtml(MUSICIAN_TERMS.zcSnap)}</strong> (${isEs ? 'evita chasquidos al principio y final' : 'prevents clicks at start and end'})</span>
            </label>
            <label class="batch-check">
              <input type="checkbox" id="chk-wiz-denoise" ${modal.optApplyNoisePrint ? 'checked' : ''} />
              <span>${isEs ? 'Atenuar ruido de fondo y zumbido 50/60 Hz usando la huella de ruido' : 'Attenuate background noise and 50/60 Hz hum using the noise print'}</span>
            </label>
            <label class="batch-check">
              <input type="checkbox" id="chk-wiz-norm" ${modal.optNormalizePeak ? 'checked' : ''} />
              <span>${isEs ? 'Normalizar pico a -1.0 dBFS y eliminar offset DC' : 'Normalize peak to -1.0 dBFS and remove DC offset'}</span>
            </label>
          </div>

          <div class="batch-slicer-row">
            <button type="button" class="btn btn-outline btn-sm" id="btn-wiz-ai-bwe">
              ${ICONS.sparkle} ${isEs ? `Aplicar ${escHtml(MUSICIAN_TERMS.bwe)}` : `Apply ${escHtml(MUSICIAN_TERMS.bwe)}`}
            </button>
            ${
              modal.context.onOpenAdvancedRecorder
                ? `
              <button type="button" class="btn btn-outline btn-sm" id="btn-wiz-step2-adv-recorder">
                ${isEs ? 'Abrir en taller avanzado (Grabadora / Huella de ruido manual)…' : 'Open in advanced workshop (Recorder / Manual noise print)…'}
              </button>
            `
                : ''
            }
          </div>
        </div>

        <footer class="nmm-modal-footer">
          <div class="footer-left">
            <button type="button" class="btn btn-outline" id="btn-wiz-back-step1">← ${isEs ? '1. Material' : '1. Material'}</button>
          </div>
          <div class="footer-right">
            <button type="button" class="btn btn-primary" id="btn-wiz-to-step3">
              ${isEs ? 'Siguiente: 3. Cortar y mapear →' : 'Next: 3. Slice & Map →'}
            </button>
          </div>
        </footer>
      </div>
    `;
  }
