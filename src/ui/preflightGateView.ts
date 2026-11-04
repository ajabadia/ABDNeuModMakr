// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Common Preflight Gate & Musician Terms (Fase 35.3)
//
// Single visual component and pure view-model adapters unifying the three
// preflight gates (Import, Batch, Export) into one canonical layout:
//   - Status banner (`.preflight-status.is-{ok|warn|error}`)
//   - "Qué voy a cambiar" list (`.preflight-issues` > `.issue-card`)
//   - Unified footer action labels: `[Ajustar]` + `[Continuar]`
//
// Also exports the canonical musician-first terminology with the technical
// term as subtitle/parenthetical required by Fase 35.3.
// ─────────────────────────────────────────────────────────

import type { BatchPreflightSummary } from '../core/batch/preflight.ts';
import type {
  RawExportOptions,
  RawSamplerPreflightReport,
} from '../core/export/rawSamplerTypes.ts';
import type { ImportPreflightReport } from '../core/import/importPreflight.ts';
import type { ParsedSamplerPreset } from '../core/import/rawSamplerParsers.ts';
import type { WorkingMode } from '../core/types.ts';
import { escHtml } from './escape.ts';
import { ICONS } from './icons.ts';

/**
 * Canonical musician-first labels with the technical term as subtitle (Fase 35.3).
 */
export const MUSICIAN_TERMS = {
  preflightImport: 'Revisión antes de importar (Preflight)',
  preflightBatch: 'Revisión antes de procesar el lote (Preflight)',
  preflightExport: 'Revisión antes de exportar (Preflight)',
  noisePrint: 'Huella de ruido de esta grabación (Noise Print)',
  zcSnap: 'Ajustar cortes al cruce por cero (zc-snap)',
  bwe: 'Reconstructor de agudos (BWE)',
} as const;

export type CommonPreflightKind = 'import' | 'batch' | 'export';
export type CommonPreflightSeverity = 'ok' | 'warn' | 'error';
export type CommonPreflightCardSeverity = 'error' | 'warn' | 'info';

export interface CommonPreflightChangeItem {
  severity: CommonPreflightCardSeverity;
  title: string;
  categoryTag: string;
  severityTag: string;
  description: string;
  adaptation: string;
}

export interface CommonPreflightGateModel {
  kind: CommonPreflightKind;
  sectionTitle: string;
  statusSeverity: CommonPreflightSeverity;
  statusTitle: string;
  statusMeta: string;
  statusSummary: string;
  changesHeading: string;
  emptyChangesText: string;
  changes: CommonPreflightChangeItem[];
  adjustLabel: string;
  continueLabel: string;
  canContinue: boolean;
}

export interface ImportAdaptationSelections {
  autoExtendOuterZones: boolean;
  adaptVelocityLayers: boolean;
  switchToExtendedMode: boolean;
}

/**
 * Adapts an `ImportPreflightReport` into the unified `CommonPreflightGateModel`.
 */
export function fromImportPreflightReport(
  report: ImportPreflightReport,
  preset: ParsedSamplerPreset,
  currentMode: WorkingMode,
  selections?: ImportAdaptationSelections
): CommonPreflightGateModel {
  const hasErrors = !report.canImport || report.issues.some((i) => i.severity === 'error');
  const hasWarnings = report.issues.some((i) => i.severity === 'warning');
  const statusSeverity: CommonPreflightSeverity = hasErrors
    ? 'error'
    : hasWarnings
      ? 'warn'
      : 'ok';

  const statusTitle = hasErrors
    ? 'No se puede importar directamente — revisa los bloqueos'
    : hasWarnings
      ? 'Listo para importar con adaptaciones automáticas'
      : 'Compatible al 100 % sin cambios forzados';

  const statusMeta = `${report.totalRegions} zonas · ${report.totalAudioFiles} muestras · Teclas ${report.keyRange.minKey}–${report.keyRange.maxKey} · ${report.maxVelocityLayers} capa(s) vel.`;

  const effectiveMode =
    selections?.switchToExtendedMode || currentMode === 'extended' ? 'Extended' : 'Classic';
  const statusSummary = hasErrors
    ? `El archivo "${report.presetName}" (${report.formatLabel}) requiere atención antes de cargarse en la sesión.`
    : `Se importará "${report.presetName}" (${report.formatLabel}) hacia el modelo "${preset.modelName}" en modo ${effectiveMode} (Set #${preset.suggestedParameterSet} · ${preset.detectedCategory}).`;

  const changes: CommonPreflightChangeItem[] = [];
  for (const iss of report.issues) {
    if (iss.code === 'WARN_KEYBED_GAPS' && selections && report.canImport) {
      if (selections.autoExtendOuterZones) {
        changes.push({
          severity: 'info',
          title: 'Extensión de zonas extremas hasta MIDI 0..127',
          categoryTag: 'coverage',
          severityTag: 'activo',
          description: `El rango original (${report.keyRange.minKey}..${report.keyRange.maxKey}) deja notas extremas sin cubrir (${report.keyRange.uncoveredLowNotes + report.keyRange.uncoveredHighNotes} notas).`,
          adaptation:
            effectiveMode === 'Classic'
              ? 'Obligatorio en Modo Classic Cromático (map.script): se estirarán la primera y última zona para cubrir de C-2 (0) a G8 (127) sin huecos.'
              : 'Se estirarán opcionalmente los límites de la primera y última zona para cubrir de C-2 (0) a G8 (127).',
        });
      } else {
        changes.push({
          severity: effectiveMode === 'Classic' && !/drum|kit|perc/i.test(preset.detectedCategory || '') ? 'warn' : 'info',
          title: iss.title,
          categoryTag: 'coverage',
          severityTag: 'rango original',
          description: iss.description,
          adaptation: `Se conservará el rango original (${report.keyRange.minKey}..${report.keyRange.maxKey}) sin forzar la extensión de las notas extremas.`,
        });
      }
      continue;
    }
    changes.push({
      severity: iss.severity === 'error' ? 'error' : iss.severity === 'warning' ? 'warn' : 'info',
      title: iss.title,
      categoryTag: iss.category,
      severityTag: iss.severity === 'error' ? 'bloqueo' : iss.severity === 'warning' ? 'ajuste' : 'info',
      description: iss.description,
      adaptation: iss.resolutionText,
    });
  }

  if (selections && report.canImport) {
    if (selections.switchToExtendedMode && currentMode !== 'extended') {
      changes.push({
        severity: 'info',
        title: 'Cambio automático de la sesión a modo Extended',
        categoryTag: 'velocity',
        severityTag: 'activo',
        description: `El instrumento contiene hasta ${report.maxVelocityLayers} capas de velocidad.`,
        adaptation: 'La sesión pasará a modo Extended (Regiones 2D) para conservar todas las capas sin plegarlas.',
      });
    } else if (selections.adaptVelocityLayers && report.maxVelocityLayers > 2 && currentMode === 'classic') {
      changes.push({
        severity: 'warn',
        title: 'Plegado de capas de velocidad a Classic (2 capas)',
        categoryTag: 'velocity',
        severityTag: 'activo',
        description: `El formato Classic soporta 2 capas de velocidad (Low 1..63, High 64..127) frente a las ${report.maxVelocityLayers} del origen.`,
        adaptation: 'Se proyectarán las capas más suave y más fuerte con compensación automática de ganancia.',
      });
    }
  }

  return {
    kind: 'import',
    sectionTitle: MUSICIAN_TERMS.preflightImport,
    statusSeverity,
    statusTitle,
    statusMeta,
    statusSummary,
    changesHeading:
      changes.length === 0
        ? 'Sin adaptaciones necesarias'
        : `Qué voy a cambiar (${changes.length})`,
    emptyChangesText:
      'No hay que tocar nada: todas las zonas, capas de velocidad y muestras entran tal cual en la sesión.',
    changes,
    adjustLabel: 'Ajustar / Elegir otro archivo',
    continueLabel: 'Continuar e importar',
    canContinue: report.canImport,
  };
}

export interface RawSamplerFormatMetaInfo {
  title: string;
  description: string;
  extension: string;
}

/**
 * Adapts a `RawSamplerPreflightReport` into the unified `CommonPreflightGateModel`.
 */
export function fromRawSamplerPreflightReport(
  report: RawSamplerPreflightReport,
  meta: RawSamplerFormatMetaInfo,
  options?: Pick<RawExportOptions, 'resolution' | 'sampleRate' | 'normalization' | 'layout'>
): CommonPreflightGateModel {
  const warnCount = report.summary.warningCount;
  const incompatCount = report.summary.incompatibilityCount;
  const statusSeverity: CommonPreflightSeverity = !report.canExport
    ? 'error'
    : warnCount > 0 || incompatCount > 0
      ? 'warn'
      : 'ok';

  const statusTitle = !report.canExport
    ? 'Exportación bloqueada — faltan muestras válidas'
    : statusSeverity === 'warn'
      ? `Exportación lista con ${incompatCount + warnCount} ajuste(s) al formato ${meta.title}`
      : `Compatible al 100 % con ${meta.title}`;

  const statusMeta = `${report.totalRegions} regiones · ${report.totalSamples} muestras · Salida ${meta.extension}`;

  const optSummary = options
    ? ` (${options.resolution}, ${options.sampleRate === 'original' ? 'frecuencia original' : `${options.sampleRate} Hz`})`
    : '';
  const statusSummary = !report.canExport
    ? 'Asigna al menos una muestra de audio válida a las zonas antes de exportar.'
    : `Se generará el paquete ${meta.title}${optSummary} aplicando las adaptaciones indicadas abajo.`;

  const changes: CommonPreflightChangeItem[] = report.issues.map((iss) => ({
    severity:
      iss.severity === 'incompatibility'
        ? 'error'
        : iss.severity === 'warning'
          ? 'warn'
          : 'info',
    title: iss.title,
    categoryTag: iss.category,
    severityTag:
      iss.severity === 'incompatibility'
        ? 'límite formato'
        : iss.severity === 'warning'
          ? 'ajuste'
          : 'info',
    description: iss.description,
    adaptation: iss.adaptation,
  }));

  return {
    kind: 'export',
    sectionTitle: MUSICIAN_TERMS.preflightExport,
    statusSeverity,
    statusTitle,
    statusMeta,
    statusSummary,
    changesHeading: `Qué voy a cambiar (${changes.length})`,
    emptyChangesText:
      'No hay advertencias ni conversiones forzosas para este formato; se exportará tal cual.',
    changes,
    adjustLabel: 'Ajustar / Volver',
    continueLabel: `Continuar y exportar ${meta.title}`,
    canContinue: report.canExport,
  };
}

/**
 * Adapts a `BatchPreflightSummary` into the unified `CommonPreflightGateModel`.
 */
export function fromBatchPreflightSummary(
  summary: BatchPreflightSummary
): CommonPreflightGateModel {
  const canContinue = summary.selectedCount > 0;
  const skippedCount = summary.totalDiscovered - summary.selectedCount;
  const statusSeverity: CommonPreflightSeverity = !canContinue
    ? 'error'
    : skippedCount > 0
      ? 'warn'
      : 'ok';

  const statusTitle = !canContinue
    ? 'Ningún modelo seleccionado para procesar'
    : `Listo para sintetizar ${summary.selectedCount} de ${summary.totalDiscovered} modelo(s)`;

  const statusMeta = `${summary.selectedCount} modelos · ${summary.totalFiles} archivos · ~${summary.estimatedDurationSec}s`;

  const statusSummary = !canContinue
    ? 'Marca al menos un modelo en la tabla inferior o vuelve al paso anterior para ajustar el origen.'
    : `Se compilarán ${summary.selectedCount} instrumentos hacia ${summary.executionProfile.destinationLabel} (${summary.executionProfile.destinationPathOrName}).`;

  const changes: CommonPreflightChangeItem[] = [];
  if (canContinue) {
    changes.push(
      {
        severity: 'info',
        title: `Modo y formato de salida: ${summary.executionProfile.workingModeLabel}`,
        categoryTag: 'formato',
        severityTag: 'info',
        description: `Perfil de exportación activo: ${summary.executionProfile.targetFormatLabel}.`,
        adaptation: `Cada candidato se escribirá en ${summary.executionProfile.destinationLabel} (${summary.executionProfile.destinationPathOrName}).`,
      },
      {
        severity: 'info',
        title: `Motor espectral y asistencia: ${summary.executionProfile.dspAlgorithmLabel}`,
        categoryTag: 'motor',
        severityTag: 'info',
        description: `Motor IA: ${summary.executionProfile.aiEngineLabel} · Complejidad: ${summary.executionProfile.complexityLabel}.`,
        adaptation: `Duración estimada del lote: ~${summary.estimatedDurationSec} segundos para ${summary.totalFiles} muestra(s).`,
      }
    );

    if (summary.executionProfile.slicerProfileLabel) {
      changes.push({
        severity: 'info',
        title: 'Segmentación automática de transitorios (AutoSlicer)',
        categoryTag: 'slicer',
        severityTag: 'ajuste',
        description: `Perfil de corte activo: ${summary.executionProfile.slicerProfileLabel}.`,
        adaptation: 'Cada archivo se troceará en el cruce por cero y se mapeará automáticamente a zonas MIDI.',
      });
    }

    if (skippedCount > 0) {
      changes.push({
        severity: 'warn',
        title: `${skippedCount} candidato(s) desmarcado(s) se omitirán`,
        categoryTag: 'selección',
        severityTag: 'ajuste',
        description: `Has seleccionado ${summary.selectedCount} de los ${summary.totalDiscovered} candidatos descubiertos.`,
        adaptation: 'Solo se procesarán las filas marcadas en la tabla inferior.',
      });
    }
  }

  return {
    kind: 'batch',
    sectionTitle: MUSICIAN_TERMS.preflightBatch,
    statusSeverity,
    statusTitle,
    statusMeta,
    statusSummary,
    changesHeading: `Qué voy a cambiar (${changes.length})`,
    emptyChangesText: 'Selecciona al menos un modelo para ver las adaptaciones del lote.',
    changes,
    adjustLabel: 'Ajustar origen',
    continueLabel: `Continuar y procesar (${summary.selectedCount})`,
    canContinue,
  };
}

/**
 * Renders the unified visual preflight block (`.preflight-status` + `.preflight-issues`)
 * shared across Import, Batch, and Export modals.
 */
export function renderCommonPreflightGate(model: CommonPreflightGateModel): string {
  const statusIcon =
    model.statusSeverity === 'error'
      ? ICONS.alert
      : model.statusSeverity === 'warn'
        ? ICONS.alert
        : ICONS.check;

  const cardsHtml =
    model.changes.length === 0
      ? `<div class="triage-empty">${escHtml(model.emptyChangesText)}</div>`
      : model.changes
          .map((item) => {
            const sevClass = `is-${item.severity}`;
            return `
              <div class="issue-card ${sevClass}">
                <div class="issue-head">
                  <span class="issue-title">${escHtml(item.title)}</span>
                  <span class="issue-tags">
                    <span class="issue-tag">${escHtml(item.categoryTag)}</span>
                    <span class="issue-tag ${sevClass}">${escHtml(item.severityTag)}</span>
                  </span>
                </div>
                <p class="issue-desc">${escHtml(item.description)}</p>
                <div class="issue-adapt"><strong>Qué voy a cambiar:</strong><span>${escHtml(item.adaptation)}</span></div>
              </div>`;
          })
          .join('');

  return `
    <div class="raw-preflight" data-preflight-kind="${escHtml(model.kind)}">
      <div class="preflight-status is-${model.statusSeverity}">
        <div class="preflight-status-head">
          <span class="preflight-status-title">
            <span class="preflight-status-icon">${statusIcon}</span>
            ${escHtml(model.sectionTitle)} — ${escHtml(model.statusTitle)}
          </span>
          <span class="preflight-status-meta">${escHtml(model.statusMeta)}</span>
        </div>
        <p>${escHtml(model.statusSummary)}</p>
      </div>

      <div class="preflight-issues">
        <span class="preflight-issues-title">${escHtml(model.changesHeading)}</span>
        ${cardsHtml}
      </div>
    </div>`;
}
