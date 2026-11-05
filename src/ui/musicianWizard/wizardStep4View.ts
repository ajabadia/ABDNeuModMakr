// ─────────────────────────────────────────────────────────
// MusicianWizardModal — wizardStep4View (Fase 42.5)
// Funciones extraidas verbatim de `src/ui/MusicianWizardModal.ts`.
// `modal` es el nucleo estructural (`WizardModalCore`).
// ─────────────────────────────────────────────────────────

import { buildExportDestinationCards, resolveExportDestinationSummary } from '../../app/exportDestinations.ts';
import { getAppLocale } from '../../core/i18n.ts';
import { PARAMETER_SETS } from '../../core/index.ts';
import { describeWorkingModeForMusician } from '../../core/wizard/musicianWizard.ts';
import { escAttr, escHtml } from '../escape.ts';
import { ICONS } from '../icons.ts';
import type { WizardModalCore } from './wizardModalCore.ts';

export function renderStep4GenerateAndExport(modal: WizardModalCore): string {
    const isEs = getAppLocale() === 'es';
    const paramSets = modal.context.getParameterSets?.() ?? PARAMETER_SETS;
    const zoneCount =
      modal.sourceKind === 'mapped_bank' && modal.parsedPreset
        ? modal.parsedPreset.regions.length
        : (modal.sliceMapResult?.classicZones.length ?? modal.context.getActiveSessionAudio?.()?.zoneCount ?? 1);
    const regionCount =
      modal.sourceKind === 'mapped_bank' && modal.parsedPreset
        ? modal.parsedPreset.regions.length
        : (modal.sliceMapResult?.extendedRegions.length ?? zoneCount);

    const exportSummary = resolveExportDestinationSummary({
      modelName: modal.modelName,
      expandedName: modal.expandedName,
      slot: modal.context.getCurrentProcessConfig().modelNumber ?? 1,
      workingMode: modal.workingMode,
      zoneCount,
      regionCount,
      hasActiveZoneSample: true,
    });

    const cards = buildExportDestinationCards();

    const destCardsHtml = cards
      .map((card) => {
        const isSelected = card.id === modal.selectedDestinationId;
        const icon =
          card.id === 'time-capsule'
            ? ICONS.cpu
            : card.id === 'other-samplers'
              ? ICONS.database
              : ICONS.wave;
        const quickButtonsHtml = card.secondaryActions
          .map(
            (act) => `
              <button
                type="button"
                class="btn btn-xs btn-outline"
                data-wiz-dest-quick="${escAttr(card.id)}"
                data-wiz-action-id="${escAttr(act.id)}"
              >${escHtml(act.label)}</button>`
          )
          .join('');

        return `
          <div class="issue-card ${isSelected ? 'is-info' : ''}" data-wiz-dest-card="${escAttr(card.id)}">
            <div class="issue-head">
              <span class="issue-title">${icon} ${escHtml(card.title)}</span>
              <span class="issue-tags">
                <span class="issue-tag ${isSelected ? 'is-info' : ''}">${escHtml(card.badge)}</span>
                <button
                  type="button"
                  class="btn btn-sm ${isSelected ? 'btn-primary' : 'btn-outline'}"
                  data-wiz-dest-primary="${escAttr(card.id)}"
                >${escHtml(card.primaryActionLabel)}</button>
              </span>
            </div>
            <p class="issue-desc">${escHtml(card.description)}</p>
            <div class="triage-toolbar-left">
              <span class="triage-count">${escHtml(card.targetSubtitle)}</span>
              ${quickButtonsHtml}
            </div>
          </div>
        `;
      })
      .join('');

    const paramOptionsHtml = paramSets
      .map(
        (ps) =>
          `<option value="${ps.id}" ${ps.id === modal.parameterSet ? 'selected' : ''}>Set #${ps.id} — ${escHtml(ps.name)}</option>`
      )
      .join('');

    return `
      <div class="nmm-batch-preflight-pane">
        <div class="triage-summary">
          ${ICONS.cpu}
          <div>
            <p><strong>${isEs ? 'Paso 4 — Generar modelo espectral y exportar a tu destino' : 'Step 4 — Generate spectral model & export to your destination'}</strong></p>
            <p>${escHtml(`${exportSummary.slotLabel} • ${exportSummary.displayName} • ${exportSummary.modeLabel} (${exportSummary.zonesLabel})`)}. ${isEs ? 'Revisa el nombre y el carácter acústico, genera el modelo resintetizado o elige directamente dónde quieres llevártelo.' : 'Review the name and acoustic character, generate the resynthesized model, or choose directly where you want to take it.'}</p>
          </div>
        </div>

        <!-- ProcessPanel simplificado -->
        <div class="nmm-batch-card">
          <div class="triage-toolbar">
            <div class="triage-toolbar-left">
              <h3>${isEs ? 'Identidad y Motor del Instrumento (ProcessPanel Simplificado)' : 'Instrument Identity & Engine (Simplified ProcessPanel)'}</h3>
            </div>
            <div class="triage-toolbar-right">
              ${
                modal.context.onOpenAdvancedModelConfig
                  ? `
                <button type="button" class="btn btn-outline btn-sm" id="btn-wiz-open-adv-modelcfg">
                  ${ICONS.settings} ${isEs ? 'Abrir taller avanzado (Configuración completa del modelo)…' : 'Open advanced workshop (Full Model Configuration)…'}
                </button>
              `
                  : ''
              }
            </div>
          </div>

          <div class="nmm-metric-grid">
            <div class="batch-field">
              <label for="inp-wiz-model-name">${isEs ? 'Nombre Hardware (Classic, máx. 11):' : 'Hardware Name (Classic, max 11):'}</label>
              <input
                type="text"
                id="inp-wiz-model-name"
                class="form-control"
                maxlength="11"
                value="${escAttr(modal.modelName)}"
              />
            </div>

            <div class="batch-field">
              <label for="inp-wiz-expanded-name">${isEs ? 'Nombre Extendido (AxionikVS):' : 'Expanded Name (AxionikVS):'}</label>
              <input
                type="text"
                id="inp-wiz-expanded-name"
                class="form-control"
                maxlength="64"
                value="${escAttr(modal.expandedName)}"
              />
            </div>

            <div class="batch-field">
              <label for="sel-wiz-working-mode">${isEs ? 'Modo de trabajo:' : 'Working mode:'}</label>
              <select id="sel-wiz-working-mode" class="form-control">
                <option value="classic" ${modal.workingMode === 'classic' ? 'selected' : ''}>${isEs ? 'Classic (2 capas · Hardware 1:1)' : 'Classic (2 layers · 1:1 Hardware)'}</option>
                <option value="extended" ${modal.workingMode === 'extended' ? 'selected' : ''}>${isEs ? 'Extended (Multicapa 2D HD)' : 'Extended (Multi-layer 2D HD)'}</option>
              </select>
            </div>

            <div class="batch-field">
              <label for="sel-wiz-param-set">${isEs ? 'Carácter Acústico (Parameter Set):' : 'Acoustic Character (Parameter Set):'}</label>
              <select id="sel-wiz-param-set" class="form-control">
                ${paramOptionsHtml}
              </select>
            </div>
          </div>

          <p class="nmm-batch-hint cfg-gap-top">
            ${escHtml(describeWorkingModeForMusician(modal.workingMode))}
          </p>

          <div class="batch-slicer-row">
            <button type="button" class="btn btn-outline" id="btn-wiz-apply-session-only">
              ${ICONS.check} ${isEs ? 'Volcar zonas a la sesión sin cerrar' : 'Commit zones to session without closing'}
            </button>
            <button type="button" class="btn btn-primary" id="btn-wiz-generate-model-now">
              ${ICONS.play} ${isEs ? 'Generar Modelo Espectral Ahora (Análisis FFT + Resíntesis)' : 'Generate Spectral Model Now (FFT Analysis + Resynthesis)'}
            </button>
          </div>
        </div>

        <!-- Pantalla de Destinos de Exportación (Fase 35.2 integrada) -->
        <div class="nmm-batch-card">
          <h3>${isEs ? '¿Dónde quieres usar o exportar tu instrumento?' : 'Where do you want to use or export your instrument?'}</h3>
          <div class="preflight-issues">
            ${destCardsHtml}
          </div>
        </div>

        <footer class="nmm-modal-footer">
          <div class="footer-left">
            <button type="button" class="btn btn-outline" id="btn-wiz-back-from-step4">
              ← ${modal.sourceKind === 'raw_audio' ? (isEs ? '3. Cortar y mapear' : '3. Slice & Map') : isEs ? '1. Material' : '1. Material'}
            </button>
          </div>
          <div class="footer-right">
            <button type="button" class="btn btn-outline" id="btn-wiz-close-footer">${isEs ? 'Cerrar asistente' : 'Close wizard'}</button>
          </div>
        </footer>
      </div>
    `;
  }
