// ─────────────────────────────────────────────────────────
// MusicianWizardModal — wizardStep1View (Fase 42.5)
// Funciones extraidas verbatim de `src/ui/MusicianWizardModal.ts`.
// `modal` es el nucleo estructural (`WizardModalCore`).
// ─────────────────────────────────────────────────────────

import { getAppLocale } from '../../core/i18n.ts';
import { escHtml } from '../escape.ts';
import { ICONS } from '../icons.ts';
import { MUSICIAN_TERMS, fromImportPreflightReport, renderCommonPreflightGate } from '../preflightGateView.ts';
import type { WizardModalCore } from './wizardModalCore.ts';

export function renderStep1Material(modal: WizardModalCore): string {
    const isEs = getAppLocale() === 'es';
    const activeAudio = modal.context.getActiveSessionAudio?.();
    const currentMode = modal.context.getCurrentWorkingMode();
    const bankGateModel =
      modal.preflightReport && modal.parsedPreset
        ? fromImportPreflightReport(modal.preflightReport, modal.parsedPreset, currentMode, {
            autoExtendOuterZones: modal.optBankAutoExtend,
            adaptVelocityLayers: modal.optBankAdaptVelocity,
            switchToExtendedMode: modal.optBankSwitchExtended,
          })
        : null;

    return `
      <div class="nmm-batch-discover-pane">
        <div class="triage-summary">
          ${ICONS.sparkle}
          <div>
            <p><strong>${isEs ? 'Paso 1 — Elige tu punto de partida musical' : 'Step 1 — Choose your musical starting point'}</strong></p>
            <p>${isEs ? 'Graba una toma con micrófono/línea, suelta un archivo de audio (nota, frase o ritmo) o importa un banco ya mapeado (<code>.sf2</code>, <code>.sfz</code>, <code>.dspreset</code>, <code>.model</code> Hartmann, etc.).' : 'Record a take via microphone/line, drop an audio file (note, phrase, or rhythm), or import a pre-mapped bank (<code>.sf2</code>, <code>.sfz</code>, <code>.dspreset</code>, Hartmann <code>.model</code>, etc.).'}</p>
          </div>
        </div>

        <div class="nmm-metric-grid">
          <!-- Opción A: Grabar toma en vivo -->
          <div class="nmm-batch-card">
            <h3>${ICONS.mic} ${isEs ? 'Grabar con micrófono o línea' : 'Record via microphone or line'}</h3>
            <p class="nmm-batch-hint">
              ${isEs ? 'Captura una nota, acorde, frase melódica o ritmo percusivo directamente en el asistente, con detección automática de huella de ruido.' : 'Capture a note, chord, melodic phrase, or percussive rhythm directly in the wizard with automatic noise print detection.'}
            </p>
            <div class="triage-toolbar-left">
              <button
                type="button"
                class="btn ${modal.isRecordingInline ? 'btn-danger' : 'btn-primary'}"
                id="btn-wiz-record-toggle"
              >
                ${modal.isRecordingInline ? `${ICONS.stop} ${isEs ? 'Detener grabación y continuar' : 'Stop recording & continue'}` : `${ICONS.mic} ${isEs ? 'Empezar a grabar ahora' : 'Start recording now'}`}
              </button>
              ${
                modal.context.onOpenAdvancedRecorder
                  ? `
                <button type="button" class="btn btn-outline btn-sm" id="btn-wiz-open-adv-recorder">
                  ${isEs ? 'Abrir en taller avanzado (Grabadora)…' : 'Open in advanced workshop (Recorder)…'}
                </button>
              `
                  : ''
              }
            </div>
            ${
              modal.isRecordingInline
                ? `<div class="nmm-alert-subtle">${isEs ? 'Grabando en vivo… toca tu instrumento o micrófono y pulsa <strong>Detener grabación</strong> cuando termines.' : 'Recording live… play your instrument or microphone and click <strong>Stop recording</strong> when finished.'}</div>`
                : ''
            }
          </div>

          <!-- Opción B: Usar audio ya cargado en la sesión -->
          <div class="nmm-batch-card">
            <h3>${ICONS.wave} ${isEs ? 'Material actual de la sesión' : 'Current session material'}</h3>
            <p class="nmm-batch-hint">
              ${
                activeAudio?.hasAudio
                  ? isEs
                    ? `La sesión actual tiene <strong>${activeAudio.zoneCount} zona(s)</strong> cargada(s) (${escHtml(activeAudio.sampleName || 'muestra activa')}).`
                    : `The current session has <strong>${activeAudio.zoneCount} zone(s)</strong> loaded (${escHtml(activeAudio.sampleName || 'active sample')}).`
                  : isEs
                    ? 'Si ya tienes muestras cargadas en la sesión, puedes pasarlas por el asistente o ir directo al Paso 4.'
                    : 'If you already have samples loaded in the session, you can run them through the wizard or jump straight to Step 4.'
              }
            </p>
            <div class="triage-toolbar-left">
              ${
                activeAudio?.pcm && activeAudio.pcm.length > 0
                  ? `
                <button type="button" class="btn btn-outline" id="btn-wiz-use-session-audio">
                  ${ICONS.play} ${isEs ? 'Limpiar y mapear muestra activa' : 'Clean & map active sample'}
                </button>
              `
                  : ''
              }
              <button type="button" class="btn btn-outline" id="btn-wiz-skip-to-step4">
                ${isEs ? 'Ir al Paso 4 con la sesión actual →' : 'Go to Step 4 with current session →'}
              </button>
            </div>
          </div>
        </div>

        <!-- Opción C: Importar archivo de audio o banco de instrumentos -->
        <div class="nmm-batch-card">
          <div class="triage-toolbar">
            <div class="triage-toolbar-left">
              <h3>${ICONS.folder} ${isEs ? 'Importar audio o banco de instrumentos' : 'Import audio or instrument bank'}</h3>
            </div>
            <div class="triage-toolbar-right">
              ${
                modal.context.onOpenAdvancedUniversalImport
                  ? `
                <button type="button" class="btn btn-outline btn-sm" id="btn-wiz-open-adv-import">
                  ${isEs ? 'Abrir Importador Universal avanzado…' : 'Open advanced Universal Importer…'}
                </button>
              `
                  : ''
              }
            </div>
          </div>
          <p class="nmm-batch-hint">
            ${isEs ? 'Si sueltas un audio (<code>.wav</code>, <code>.aif</code>, <code>.flac</code>, <code>.mp3</code>) pasará al <strong>Paso 2 (Limpiar)</strong>. Si sueltas un banco ya mapeado (<code>.sf2</code>, <code>.sfz</code>, <code>.dspreset</code>, <code>.model</code> Hartmann, <code>.zip</code>), revisaremos su adaptación aquí y podrás saltar directo al <strong>Paso 4 (Generar y exportar)</strong>.' : 'Dropping raw audio (<code>.wav</code>, <code>.aif</code>, <code>.flac</code>, <code>.mp3</code>) proceeds to <strong>Step 2 (Clean)</strong>. Dropping a pre-mapped bank (<code>.sf2</code>, <code>.sfz</code>, <code>.dspreset</code>, Hartmann <code>.model</code>, <code>.zip</code>) reviews adaptations here and jumps straight to <strong>Step 4 (Generate & Export)</strong>.'}
          </p>

          <div class="nmm-dropzone" id="wiz-dropzone" tabindex="0">
            <div class="nmm-batch-dropzone-icon">${ICONS.upload}</div>
            <div class="nmm-batch-dropzone-text">
              ${isEs ? 'Arrastra aquí tu <strong>archivo de audio (.wav, .aif, .flac, .mp3)</strong> o <strong>banco (.sf2, .sfz, .dspreset, .model, .zip)</strong>' : 'Drop your <strong>audio file (.wav, .aif, .flac, .mp3)</strong> or <strong>bank (.sf2, .sfz, .dspreset, .model, .zip)</strong> here'}
            </div>
            <div class="nmm-batch-dropzone-sub">${isEs ? 'o selecciónalo desde tu equipo' : 'or browse from your computer'}</div>
            <div class="nmm-batch-dropzone-actions">
              <label class="btn btn-primary">
                ${ICONS.folder} ${isEs ? 'Elegir archivo de audio o banco…' : 'Choose audio file or bank…'}
                <input
                  type="file"
                  id="inp-wiz-file"
                  class="is-hidden-file"
                  accept=".wav,.aif,.aiff,.aifc,.flac,.mp3,.ogg,.oga,.m4a,.aac,.opus,.webm,.caf,.ncw,.rx2,.rex,.rcy,.model,.neuronikmodel,.nmmodel,.scape,.sphere,.nmpack,.sf2,.sfz,.iso,.img,.dsk,.bin,.hda,.out,.efe,.ede,.gkh,.e4b,.esi,.x7u,.x8u,.x3a,.krz,.k25,.k26,.akp,.pgm,.set,.fzv,.fzf,.s3p,.sxt,.dwp,.dspreset,.nki,.vstpreset,.multisample,.adv,.exs,.talsmpl,.txprog,.kmp,.ksf,.dls,.xpm,.xty,.xtd,.xpn,.zip"
                  multiple
                />
              </label>
            </div>
          </div>
        </div>

        ${
          modal.sourceKind === 'mapped_bank' && modal.parsedPreset && modal.preflightReport && bankGateModel
            ? `
          <div class="nmm-batch-card">
            <h3>${escHtml(MUSICIAN_TERMS.preflightImport)} — ${escHtml(modal.parsedPreset.presetName)}</h3>
            <p class="nmm-batch-hint">
              ${isEs ? `Este archivo ya es un instrumento mapeado (${modal.parsedPreset.regions.length} regiones). No necesita re-cortarse en los pasos 2 y 3: revisa el estado de compatibilidad y pasa directamente al Paso 4.` : `This file is already a mapped instrument (${modal.parsedPreset.regions.length} regions). It does not need re-slicing in steps 2 and 3: review compatibility and jump straight to Step 4.`}
            </p>
            ${renderCommonPreflightGate(bankGateModel)}
            ${
              modal.preflightReport.keyRange.uncoveredLowNotes > 0 ||
              modal.preflightReport.keyRange.uncoveredHighNotes > 0 ||
              modal.preflightReport.maxVelocityLayers > 2
                ? `
            <div class="batch-slicer-row">
              ${
                modal.preflightReport.keyRange.uncoveredLowNotes > 0 ||
                modal.preflightReport.keyRange.uncoveredHighNotes > 0
                  ? `
              <label class="batch-check">
                <input type="checkbox" id="chk-wiz-bank-extend" ${modal.optBankAutoExtend ? 'checked' : ''} />
                <span>${isEs ? 'Extender zonas extremas para cubrir todo el teclado MIDI (0..127)' : 'Extend outer zones to cover the full MIDI keyboard (0..127)'}</span>
              </label>
              `
                  : ''
              }
              ${
                modal.preflightReport.maxVelocityLayers > 2
                  ? `
              <label class="batch-check">
                <input type="checkbox" id="chk-wiz-bank-vel" ${modal.optBankAdaptVelocity ? 'checked' : ''} />
                <span>${isEs ? 'Adaptar capas de velocidad a 2 capas en modo Classic' : 'Adapt velocity layers to 2 layers in Classic mode'}</span>
              </label>
              <label class="batch-check">
                <input type="checkbox" id="chk-wiz-bank-extmode" ${modal.optBankSwitchExtended ? 'checked' : ''} />
                <span>${isEs ? `Cambiar a modo Extended (conservar ${modal.preflightReport.maxVelocityLayers} capas de velocidad)` : `Switch to Extended mode (preserve ${modal.preflightReport.maxVelocityLayers} velocity layers)`}</span>
              </label>
              `
                  : ''
              }
            </div>
            `
                : ''
            }
          </div>
        `
            : ''
        }

        <footer class="nmm-modal-footer">
          <div class="footer-left">
            <span class="triage-count">
              ${
                modal.sourceKind === 'raw_audio'
                  ? isEs
                    ? `Audio listo: ${escHtml(modal.sourceName)} (${(modal.rawPcm.length / modal.rawSampleRate).toFixed(2)} s)`
                    : `Audio ready: ${escHtml(modal.sourceName)} (${(modal.rawPcm.length / modal.rawSampleRate).toFixed(2)} s)`
                  : modal.sourceKind === 'mapped_bank' && modal.parsedPreset
                    ? isEs
                      ? `Banco listo: ${escHtml(modal.parsedPreset.presetName)} (${modal.parsedPreset.regions.length} regiones)`
                      : `Bank ready: ${escHtml(modal.parsedPreset.presetName)} (${modal.parsedPreset.regions.length} regions)`
                    : isEs
                      ? 'Selecciona o graba material para continuar'
                      : 'Select or record material to continue'
              }
            </span>
          </div>
          <div class="footer-right">
            <button type="button" class="btn btn-outline" id="btn-wiz-cancel">${isEs ? 'Cerrar' : 'Close'}</button>
            ${
              modal.sourceKind === 'mapped_bank' && modal.parsedPreset && bankGateModel?.canContinue
                ? `
              <button type="button" class="btn btn-primary" id="btn-wiz-bank-to-step4">
                ${ICONS.check} ${isEs ? 'Aplicar banco e ir al Paso 4 (Generar y exportar) →' : 'Apply bank & go to Step 4 (Generate & Export) →'}
              </button>
            `
                : ''
            }
            ${
              modal.sourceKind === 'raw_audio' && modal.rawPcm.length > 0
                ? `
              <button type="button" class="btn btn-primary" id="btn-wiz-to-step2">
                ${isEs ? 'Siguiente: 2. Limpiar →' : 'Next: 2. Clean →'}
              </button>
            `
                : ''
            }
          </div>
        </footer>
      </div>
    `;
  }
