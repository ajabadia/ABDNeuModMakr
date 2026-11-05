// ─────────────────────────────────────────────────────────
// BatchProcessorModal — batchPreflightView (Fase 42.5)
// Funciones extraidas verbatim de `src/ui/BatchProcessorModal.ts`.
// `modal` es el nucleo estructural (`BatchModalCore`).
// ─────────────────────────────────────────────────────────

import { getAppLocale } from '../../core/i18n.ts';
import { ICONS } from '../icons.ts';
import { escAttr, escHtml } from '../escape.ts';
import { buildBatchPreflightSummary } from '../../core/batch/preflight.ts';
import { fromBatchPreflightSummary, renderCommonPreflightGate } from '../preflightGateView.ts';
import type { BatchModalCore } from './batchModalCore.ts';
import { renderPipelineChecklistCard } from './batchDiscoverView.ts';


export function renderPreflightStep(modal: BatchModalCore): string {
    const isEs = getAppLocale() === 'es';
    const summary = buildBatchPreflightSummary(modal.candidates, modal.activeConfig, {
      workingMode: modal.context.getCurrentWorkingMode(),
      aiEngineLabel: modal.context.getAiEngineStatusLabel(),
      selectedIds: modal.selectedCandidateIds,
    });
    const gateModel = fromBatchPreflightSummary(summary);

    // Check if Classic mode coverage has errors in single session mode when coverageMidi auto-repair is unchecked
    const coverageErrors =
      modal.isSingleSessionMode && modal.context.validateCoverage
        ? modal.context.validateCoverage()
        : [];
    const classicCoverageNotice =
      modal.isSingleSessionMode && coverageErrors.length > 0
        ? `<div class="nmm-alert-subtle pipeline-coverage-notice">
            <strong>${isEs ? 'Nota de Cobertura MIDI:' : 'MIDI Coverage Note:'}</strong> ${isEs ? `Se detectaron ${coverageErrors.length} hueco(s)/solapamiento(s) en 0..127.` : `Detected ${coverageErrors.length} gap(s)/overlap(s) in 0..127.`}
            ${
              modal.checklistSelection.steps.coverageMidi
                ? isEs
                  ? 'El Paso #1 (Cobertura MIDI) reparará automáticamente los rangos antes de sintetizar.'
                  : 'Step #1 (MIDI Coverage) will automatically repair ranges before synthesizing.'
                : isEs
                  ? 'En modo Extended (especialmente Drum Maps) se permiten teclas sin asignar.'
                  : 'In Extended mode (especially Drum Maps) unassigned keys are allowed.'
            }
          </div>`
        : '';

    const isAllSelected = modal.selectedCandidateIds.size === modal.candidates.length;

    const rowsHtml = summary.models.map((m) => {
      const isChecked = modal.selectedCandidateIds.has(m.id);
      const fullExpandedName = m.name.trim();
      const classicMName = fullExpandedName.slice(0, 11).trim() || 'UNTITLED';
      return `
        <tr class="nmm-batch-table-row ${isChecked ? 'is-selected' : ''}">
          <td class="col-check">
            <input type="checkbox" class="articulation-checkbox switch--sm chk-candidate-item" data-id="${escAttr(m.id)}" ${isChecked ? 'checked' : ''} ${modal.isSingleSessionMode ? 'disabled' : ''} />
          </td>
          <td class="col-name">
            <strong>${escHtml(fullExpandedName)}</strong>
            <span class="nmm-badge-slug" title="${isEs ? 'Classic MName (11 caracteres máx.) · Extended sin límite' : 'Classic MName (11 chars max) · Unlimited Extended'}">Classic: ${escHtml(classicMName)}</span>
            <span class="nmm-badge-slug">${escHtml(m.slug)}</span>
            ${m.isSlicer ? `<span class="issue-tag is-success">Slicer (${m.slicerProfile || 'drums'})</span>` : ''}
          </td>
          <td class="col-origin">${escHtml(m.sourceOrigin)}</td>
          <td class="col-zones">${m.zoneCount} ${m.isSlicer ? (isEs ? 'corte(s) · MIDI' : 'slice(s) · MIDI') : isEs ? 'zona(s)' : 'zone(s)'} · ${m.fileCount} ${isEs ? 'archivo(s)' : 'file(s)'}</td>
          <td class="col-cat">
            <span class="nmm-badge-cat" title="${isEs ? 'Clasificación Dual: Categoría Extended + Parameter Set Classic (0..9)' : 'Dual Classification: Extended Category + Classic Parameter Set (0..9)'}">Ext: ${escHtml(m.detectedCategory)} · Classic Set ${m.suggestedParameterSet}</span>
          </td>
        </tr>
      `;
    }).join('');

    const primaryActionLabel = modal.isSingleSessionMode
      ? isEs
        ? 'Ejecutar Pipeline y Generar Modelo Neuron'
        : 'Execute Pipeline & Generate Neuron Model'
      : gateModel.continueLabel;

    return `
      <div class="nmm-batch-preflight-pane">
        <!-- Unified Common Preflight Gate (Fase 35.3) -->
        ${renderCommonPreflightGate(gateModel)}
        ${classicCoverageNotice}

        <!-- Interactive 15-Step Pipeline Checklist (Fase 0..3) -->
        ${renderPipelineChecklistCard(modal, )}

        <!-- Execution Profile -->
        <div class="nmm-batch-card nmm-preflight-profile">
          <h3>${isEs ? 'Perfil de Ejecución (Heredado de la Sesión Activa)' : 'Execution Profile (Inherited from Active Session)'}</h3>
          <div class="nmm-metric-grid">
            <div class="nmm-metric-card">
              <span class="nmm-metric-lbl">${isEs ? 'Algoritmo DSP:' : 'DSP Algorithm:'}</span>
              <strong class="nmm-metric-val">${escHtml(summary.executionProfile.dspAlgorithmLabel)}</strong>
            </div>
            <div class="nmm-metric-card">
              <span class="nmm-metric-lbl">${isEs ? 'Modo de Trabajo:' : 'Working Mode:'}</span>
              <strong class="nmm-metric-val">${escHtml(summary.executionProfile.workingModeLabel)} (${(modal.activeConfig.keyMappingMode ?? 'chromatic') === 'drum' ? 'DRUM MAP' : 'CHROMATIC'})</strong>
            </div>
            <div class="nmm-metric-card">
              <span class="nmm-metric-lbl">${isEs ? 'Motor IA:' : 'AI Engine:'}</span>
              <strong class="nmm-metric-val">${escHtml(summary.executionProfile.aiEngineLabel)}</strong>
            </div>
            <div class="nmm-metric-card">
              <span class="nmm-metric-lbl">${isEs ? 'Complejidad:' : 'Complexity:'}</span>
              <strong class="nmm-metric-val">${escHtml(summary.executionProfile.complexityLabel)}</strong>
            </div>
            <div class="nmm-metric-card nmm-metric-card--full">
              <span class="nmm-metric-lbl">${isEs ? 'Destino' : 'Destination'} (${escHtml(summary.executionProfile.destinationLabel)}):</span>
              ${
                modal.activeConfig.destination === 'axionikdb'
                  ? `
              <div class="bank-path-input-wrap">
                <input type="text" id="inp-batch-axionikdb-path" class="form-control" value="${escAttr(modal.activeConfig.axionikDbPath || 'd:\\desarrollos\\ABDSynths\\AxionikDB')}" placeholder="d:\\desarrollos\\ABDSynths\\AxionikDB" />
                <button type="button" class="btn btn-outline btn--sm" id="btn-batch-browse-dest" title="${isEs ? 'Navegar por el sistema de archivos para seleccionar la carpeta de destino AxionikDB' : 'Browse filesystem to select destination AxionikDB folder'}">
                  ${ICONS.folder} ${isEs ? 'Examinar...' : 'Browse...'}
                </button>
              </div>
              `
                  : `<strong class="nmm-metric-val"><code>${escHtml(summary.executionProfile.destinationPathOrName)}</code></strong>`
              }
            </div>
            <div class="nmm-metric-card ${modal.context.getCurrentWorkingMode() === 'classic' ? 'is-conditioned-disabled' : ''}">
              <span class="nmm-metric-lbl">
                ${isEs ? 'Sub-librería de Destino:' : 'Destination Sub-library:'}
                ${modal.context.getCurrentWorkingMode() === 'classic' ? `<span class="cond-reason-badge is-extended-only">${isEs ? 'SOLO EXTENDED' : 'EXTENDED ONLY'}</span>` : ''}
              </span>
              <div class="batch-field">
                <input type="text" id="inp-batch-target-sublib" class="form-control batch-sublib-input" value="${escAttr(modal.activeConfig.destinationSublibrary || 'Default')}" placeholder="Default" ${modal.context.getCurrentWorkingMode() === 'classic' ? `disabled title="${isEs ? 'Sub-libraries en AxionikDB son exclusivas del Modo Extended' : 'Sub-libraries in AxionikDB are exclusive to Extended Mode'}"` : ''} />
              </div>
            </div>
            <div class="nmm-metric-card">
              <span class="nmm-metric-lbl">${isEs ? 'Duración Estimada:' : 'Estimated Duration:'}</span>
              <strong class="nmm-metric-val">~${summary.estimatedDurationSec} ${isEs ? 'segundos' : 'seconds'}</strong>
            </div>
            ${
              summary.executionProfile.slicerProfileLabel
                ? `
            <div class="nmm-metric-card">
              <span class="nmm-metric-lbl">AutoSlicer Pipeline:</span>
              <strong class="nmm-metric-val batch-val-success">${escHtml(summary.executionProfile.slicerProfileLabel)}</strong>
            </div>
            `
                : ''
            }
          </div>
        </div>

        <!-- Discovered Models Table -->
        ${
          !modal.isSingleSessionMode
            ? `
        <div class="nmm-batch-card nmm-preflight-table-card">
          <div class="nmm-preflight-table-header">
            <h3>${isEs ? `Modelos y Archivos Descubiertos (${summary.selectedCount} de ${summary.totalDiscovered} seleccionados)` : `Discovered Models & Files (${summary.selectedCount} of ${summary.totalDiscovered} selected)`}</h3>
            <div class="nmm-preflight-table-actions">
              <button type="button" class="btn btn-ghost" id="btn-toggle-all-candidates">
                ${isAllSelected ? (isEs ? 'Deseleccionar Todos' : 'Deselect All') : isEs ? 'Seleccionar Todos' : 'Select All'}
              </button>
            </div>
          </div>

          <div class="nmm-batch-table-container">
            <table class="nmm-batch-table">
              <thead>
                <tr>
                  <th class="col-check"></th>
                  <th class="col-name">${isEs ? 'Nombre del Modelo y Slug' : 'Model Name & Slug'}</th>
                  <th class="col-origin">${isEs ? 'Origen' : 'Source Origin'}</th>
                  <th class="col-zones">${isEs ? 'Cobertura' : 'Coverage'}</th>
                  <th class="col-cat">${isEs ? 'Clasificación' : 'Classification'}</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
            </table>
          </div>
        </div>
        `
            : ''
        }

        <footer class="nmm-modal-footer">
          <div class="footer-left">
            <span class="triage-count">${modal.isSingleSessionMode ? `${isEs ? 'Modelo activo:' : 'Active model:'} ${escHtml(modal.candidates[0]?.name || 'Session')}` : isEs ? `${summary.selectedCount} de ${summary.totalDiscovered} seleccionados` : `${summary.selectedCount} of ${summary.totalDiscovered} selected`}</span>
          </div>
          <div class="footer-right">
            <button type="button" class="btn btn-outline" id="btn-preflight-back">
              ${modal.isSingleSessionMode ? (isEs ? 'Cancelar' : 'Cancel') : gateModel.adjustLabel}
            </button>
            <button type="button" class="btn btn-primary" id="btn-preflight-start" ${!gateModel.canContinue ? 'disabled' : ''}>
              ${escHtml(primaryActionLabel)}
            </button>
          </div>
        </footer>
      </div>
    `;
  }


  // ── Step 3: Execution ──────────────────────────────────

export function renderRunningStep(modal: BatchModalCore): string {
    const isEs = getAppLocale() === 'es';
    const s = modal.progressState || modal.queue.getProgressState();
    const isPaused = s.status === 'paused';

    const jobRows = modal.candidates
      .filter((c) => modal.selectedCandidateIds.has(c.id))
      .map((j) => {
        let statusBadge = `<span class="status-pending">${isEs ? 'Pendiente' : 'Pending'}</span>`;
        if (j.status === 'processing') {
          statusBadge = `<span class="status-processing"><span class="nmm-spinner"></span> ${isEs ? 'Procesando' : 'Processing'} (${j.progressPct}%)</span>`;
        } else if (j.status === 'completed') {
          statusBadge = `<span class="status-completed">${isEs ? 'Completado' : 'Completed'}</span>`;
        } else if (j.status === 'failed') {
          statusBadge = `<span class="status-failed" title="${escAttr(j.error || '')}">${isEs ? 'Fallido' : 'Failed'}</span>`;
        } else if (j.status === 'skipped') {
          statusBadge = `<span class="status-skipped">${isEs ? 'Omitido' : 'Skipped'}</span>`;
        }

        return `
          <tr class="nmm-batch-run-row ${j.status}">
            <td class="col-name"><strong>${escHtml(j.name)}</strong></td>
            <td class="col-slug"><code>${escHtml(j.slug)}</code></td>
            <td class="col-status">${statusBadge}</td>
            <td class="col-duration">${j.durationMs ? `${(j.durationMs / 1000).toFixed(1)}s` : '-'}</td>
          </tr>
        `;
      }).join('');

    return `
      <div class="nmm-batch-running-pane">
        <div class="nmm-batch-card">
          <div class="nmm-batch-progress-header">
            <h3>${isEs ? `Procesando Lote: ${s.completedJobs + s.failedJobs} de ${s.totalJobs} modelos` : `Processing Batch: ${s.completedJobs + s.failedJobs} of ${s.totalJobs} models`}</h3>
            <span class="nmm-batch-overall-pct">${s.overallPct}%</span>
          </div>

          <div class="nmm-batch-progress-bar-wrap">
            <div class="nmm-batch-progress-bar-fill" style="width: ${s.overallPct}%"></div>
          </div>

          <div class="nmm-batch-progress-stats">
            <span>${isEs ? 'Etapa:' : 'Stage:'} <strong>${escHtml(s.currentStageLabel || `${isEs ? 'Etapa' : 'Stage'} ${s.currentStageIndex || 1}/${s.totalStages || 5}`)}</strong></span>
            <span>${isEs ? 'Actual:' : 'Current:'} <strong>${escHtml(s.currentJobName || (isEs ? 'Preparando...' : 'Preparing...'))}</strong></span>
            <span>${isEs ? 'Transcurrido:' : 'Elapsed:'} ${(s.elapsedMs / 1000).toFixed(0)}s</span>
            <span>ETA: ${(s.estimatedRemainingMs / 1000).toFixed(0)}s</span>
          </div>
        </div>

        <div class="nmm-batch-card nmm-batch-run-table-card">
          <div class="nmm-batch-table-container">
            <table class="nmm-batch-table">
              <thead>
                <tr>
                  <th class="col-name">${isEs ? 'Modelo' : 'Model'}</th>
                  <th class="col-slug">Slug</th>
                  <th class="col-status">${isEs ? 'Estado' : 'Status'}</th>
                  <th class="col-duration">${isEs ? 'Tiempo' : 'Time'}</th>
                </tr>
              </thead>
              <tbody>
                ${jobRows}
              </tbody>
            </table>
          </div>
        </div>

        <footer class="nmm-modal-footer">
          <div class="footer-left">
            <span class="triage-count">${isEs ? `${s.completedJobs + s.failedJobs} de ${s.totalJobs}` : `${s.completedJobs + s.failedJobs} of ${s.totalJobs}`} · ETA ${(s.estimatedRemainingMs / 1000).toFixed(0)}s</span>
          </div>
          <div class="footer-right">
            <button type="button" class="btn btn-outline" id="btn-batch-pause">
              ${isPaused ? (isEs ? 'Reanudar' : 'Resume') : isEs ? 'Pausar' : 'Pause'}
            </button>
            <button type="button" class="btn btn-danger-solid" id="btn-batch-cancel">${isEs ? 'Cancelar Lote' : 'Cancel Batch'}</button>
          </div>
        </footer>
      </div>
    `;
  }


  // ── Step 4: Completion Summary ─────────────────────────

export function renderDoneStep(modal: BatchModalCore): string {
    const isEs = getAppLocale() === 'es';
    const sum = modal.finalSummary;
    if (!sum) return '';

    const hasZip = !!sum.masterZipBytes;
    const zipSizeMb = hasZip ? (sum.masterZipBytes!.byteLength / (1024 * 1024)).toFixed(2) : '0';

    return `
      <div class="nmm-batch-done-pane">
        <div class="nmm-batch-card nmm-batch-summary-card">
          <h3>${isEs ? 'Procesamiento por Lotes Finalizado' : 'Batch Processing Finished'}</h3>
          <p class="nmm-batch-hint">${isEs ? `Completado en ${(sum.totalDurationMs / 1000).toFixed(1)} segundos.` : `Completed in ${(sum.totalDurationMs / 1000).toFixed(1)} seconds.`}</p>

          <div class="nmm-batch-summary-stats">
            <div class="stat-box success">
              <span class="stat-num">${sum.succeeded}</span>
              <span class="stat-lbl">${isEs ? 'Exitosos' : 'Succeeded'}</span>
            </div>
            <div class="stat-box danger">
              <span class="stat-num">${sum.failed}</span>
              <span class="stat-lbl">${isEs ? 'Fallidos' : 'Failed'}</span>
            </div>
            <div class="stat-box neutral">
              <span class="stat-num">${sum.skipped}</span>
              <span class="stat-lbl">${isEs ? 'Omitidos' : 'Skipped'}</span>
            </div>
          </div>
        </div>

        <footer class="nmm-modal-footer">
          <div class="footer-left">
            <span class="triage-count">${sum.succeeded} ok · ${sum.failed} ${isEs ? 'fallidos' : 'failed'} · ${sum.skipped} ${isEs ? 'omitidos' : 'skipped'}</span>
          </div>
          <div class="footer-right">
            ${hasZip ? `<button type="button" class="btn btn-primary" id="btn-download-master-zip">${isEs ? `Descargar ZIP Maestro (${zipSizeMb} MB)` : `Download Master ZIP (${zipSizeMb} MB)`}</button>` : ''}
            <button type="button" class="btn btn-outline" id="btn-batch-export-json">${isEs ? 'Exportar Registro (JSON)' : 'Export Log (JSON)'}</button>
            <button type="button" class="btn btn-ghost" id="btn-batch-finish-close">${isEs ? 'Cerrar' : 'Close'}</button>
          </div>
        </footer>
      </div>
    `;
  }
