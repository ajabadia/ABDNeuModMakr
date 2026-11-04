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
import { getAppLocale } from '../core/i18n.ts';
import type { WorkingMode } from '../core/types.ts';
import { escHtml } from './escape.ts';
import { ICONS } from './icons.ts';

/**
 * Canonical musician-first labels with the technical term as subtitle (Fase 35.3).
 */
export const MUSICIAN_TERMS = {
  get preflightImport(): string {
    return getAppLocale() === 'es'
      ? 'Revisión antes de importar (Preflight)'
      : 'Pre-import review (Preflight)';
  },
  get preflightBatch(): string {
    return getAppLocale() === 'es'
      ? 'Revisión antes de procesar el lote (Preflight)'
      : 'Pre-batch review (Preflight)';
  },
  get preflightExport(): string {
    return getAppLocale() === 'es'
      ? 'Revisión antes de exportar (Preflight)'
      : 'Pre-export review (Preflight)';
  },
  get noisePrint(): string {
    return getAppLocale() === 'es'
      ? 'Huella de ruido de esta grabación (Noise Print)'
      : 'Noise print of this recording (Noise Print)';
  },
  get zcSnap(): string {
    return getAppLocale() === 'es'
      ? 'Ajustar cortes al cruce por cero (zc-snap)'
      : 'Snap cuts to zero-crossing (zc-snap)';
  },
  get bwe(): string {
    return getAppLocale() === 'es'
      ? 'Reconstructor de agudos (BWE)'
      : 'High-frequency reconstructor (BWE)';
  },
};

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
  const isEs = getAppLocale() === 'es';
  const hasErrors = !report.canImport || report.issues.some((i) => i.severity === 'error');
  const hasWarnings = report.issues.some((i) => i.severity === 'warning');
  const statusSeverity: CommonPreflightSeverity = hasErrors
    ? 'error'
    : hasWarnings
      ? 'warn'
      : 'ok';

  const statusTitle = hasErrors
    ? isEs
      ? 'No se puede importar directamente — revisa los bloqueos'
      : 'Cannot import directly — review blocking issues'
    : hasWarnings
      ? isEs
        ? 'Listo para importar con adaptaciones automáticas'
        : 'Ready to import with automatic adaptations'
      : isEs
        ? 'Compatible al 100 % sin cambios forzados'
        : '100% compatible with no forced changes';

  const statusMeta = isEs
    ? `${report.totalRegions} zonas · ${report.totalAudioFiles} muestras · Teclas ${report.keyRange.minKey}–${report.keyRange.maxKey} · ${report.maxVelocityLayers} capa(s) vel.`
    : `${report.totalRegions} zones · ${report.totalAudioFiles} samples · Keys ${report.keyRange.minKey}–${report.keyRange.maxKey} · ${report.maxVelocityLayers} vel. layer(s)`;

  const effectiveMode =
    selections?.switchToExtendedMode || currentMode === 'extended' ? 'Extended' : 'Classic';
  const statusSummary = hasErrors
    ? isEs
      ? `El archivo "${report.presetName}" (${report.formatLabel}) requiere atención antes de cargarse en la sesión.`
      : `File "${report.presetName}" (${report.formatLabel}) requires attention before loading into the session.`
    : isEs
      ? `Se importará "${report.presetName}" (${report.formatLabel}) hacia el modelo "${preset.modelName}" en modo ${effectiveMode} (Set #${preset.suggestedParameterSet} · ${preset.detectedCategory}).`
      : `Will import "${report.presetName}" (${report.formatLabel}) into model "${preset.modelName}" in ${effectiveMode} mode (Set #${preset.suggestedParameterSet} · ${preset.detectedCategory}).`;

  const changes: CommonPreflightChangeItem[] = [];
  for (const iss of report.issues) {
    if (iss.code === 'WARN_KEYBED_GAPS' && selections && report.canImport) {
      if (selections.autoExtendOuterZones) {
        changes.push({
          severity: 'info',
          title: isEs
            ? 'Extensión de zonas extremas hasta MIDI 0..127'
            : 'Outer zone extension to MIDI 0..127',
          categoryTag: 'coverage',
          severityTag: isEs ? 'activo' : 'active',
          description: isEs
            ? `El rango original (${report.keyRange.minKey}..${report.keyRange.maxKey}) deja notas extremas sin cubrir (${report.keyRange.uncoveredLowNotes + report.keyRange.uncoveredHighNotes} notas).`
            : `Original range (${report.keyRange.minKey}..${report.keyRange.maxKey}) leaves extreme notes uncovered (${report.keyRange.uncoveredLowNotes + report.keyRange.uncoveredHighNotes} notes).`,
          adaptation:
            effectiveMode === 'Classic'
              ? isEs
                ? 'Obligatorio en Modo Classic Cromático (map.script): se estirarán la primera y última zona para cubrir de C-2 (0) a G8 (127) sin huecos.'
                : 'Required in Chromatic Classic Mode (map.script): first and last zones will be stretched to cover C-2 (0) to G8 (127) without gaps.'
              : isEs
                ? 'Se estirarán opcionalmente los límites de la primera y última zona para cubrir de C-2 (0) a G8 (127).'
                : 'First and last zone boundaries will optionally be stretched to cover C-2 (0) to G8 (127).',
        });
      } else {
        changes.push({
          severity: effectiveMode === 'Classic' && !/drum|kit|perc/i.test(preset.detectedCategory || '') ? 'warn' : 'info',
          title: iss.title,
          categoryTag: 'coverage',
          severityTag: isEs ? 'rango original' : 'original range',
          description: iss.description,
          adaptation: isEs
            ? `Se conservará el rango original (${report.keyRange.minKey}..${report.keyRange.maxKey}) sin forzar la extensión de las notas extremas.`
            : `Original range (${report.keyRange.minKey}..${report.keyRange.maxKey}) will be preserved without forcing outer note extension.`,
        });
      }
      continue;
    }
    changes.push({
      severity: iss.severity === 'error' ? 'error' : iss.severity === 'warning' ? 'warn' : 'info',
      title: iss.title,
      categoryTag: iss.category,
      severityTag:
        iss.severity === 'error'
          ? isEs
            ? 'bloqueo'
            : 'blocker'
          : iss.severity === 'warning'
            ? isEs
              ? 'ajuste'
              : 'adjustment'
            : 'info',
      description: iss.description,
      adaptation: iss.resolutionText,
    });
  }

  if (selections && report.canImport) {
    if (selections.switchToExtendedMode && currentMode !== 'extended') {
      changes.push({
        severity: 'info',
        title: isEs
          ? 'Cambio automático de la sesión a modo Extended'
          : 'Automatic session switch to Extended mode',
        categoryTag: 'velocity',
        severityTag: isEs ? 'activo' : 'active',
        description: isEs
          ? `El instrumento contiene hasta ${report.maxVelocityLayers} capas de velocidad.`
          : `The instrument contains up to ${report.maxVelocityLayers} velocity layers.`,
        adaptation: isEs
          ? 'La sesión pasará a modo Extended (Regiones 2D) para conservar todas las capas sin plegarlas.'
          : 'Session will switch to Extended mode (2D Regions) to preserve all layers without folding.',
      });
    } else if (selections.adaptVelocityLayers && report.maxVelocityLayers > 2 && currentMode === 'classic') {
      changes.push({
        severity: 'warn',
        title: isEs
          ? 'Plegado de capas de velocidad a Classic (2 capas)'
          : 'Velocity layer folding to Classic (2 layers)',
        categoryTag: 'velocity',
        severityTag: isEs ? 'activo' : 'active',
        description: isEs
          ? `El formato Classic soporta 2 capas de velocidad (Low 1..63, High 64..127) frente a las ${report.maxVelocityLayers} del origen.`
          : `Classic format supports 2 velocity layers (Low 1..63, High 64..127) versus ${report.maxVelocityLayers} in the source.`,
        adaptation: isEs
          ? 'Se proyectarán las capas más suave y más fuerte con compensación automática de ganancia.'
          : 'Softest and loudest layers will be projected with automatic gain compensation.',
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
        ? isEs
          ? 'Sin adaptaciones necesarias'
          : 'No adaptations required'
        : isEs
          ? `Qué voy a cambiar (${changes.length})`
          : `What will be changed (${changes.length})`,
    emptyChangesText: isEs
      ? 'No hay que tocar nada: todas las zonas, capas de velocidad y muestras entran tal cual en la sesión.'
      : 'No changes needed: all zones, velocity layers, and samples enter the session as-is.',
    changes,
    adjustLabel: isEs ? 'Ajustar / Elegir otro archivo' : 'Adjust / Choose another file',
    continueLabel: isEs ? 'Continuar e importar' : 'Continue & import',
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
  const isEs = getAppLocale() === 'es';
  const warnCount = report.summary.warningCount;
  const incompatCount = report.summary.incompatibilityCount;
  const statusSeverity: CommonPreflightSeverity = !report.canExport
    ? 'error'
    : warnCount > 0 || incompatCount > 0
      ? 'warn'
      : 'ok';

  const statusTitle = !report.canExport
    ? isEs
      ? 'Exportación bloqueada — faltan muestras válidas'
      : 'Export blocked — valid samples missing'
    : statusSeverity === 'warn'
      ? isEs
        ? `Exportación lista con ${incompatCount + warnCount} ajuste(s) al formato ${meta.title}`
        : `Export ready with ${incompatCount + warnCount} adjustment(s) for ${meta.title} format`
      : isEs
        ? `Compatible al 100 % con ${meta.title}`
        : `100% compatible with ${meta.title}`;

  const statusMeta = isEs
    ? `${report.totalRegions} regiones · ${report.totalSamples} muestras · Salida ${meta.extension}`
    : `${report.totalRegions} regions · ${report.totalSamples} samples · Output ${meta.extension}`;

  const optSummary = options
    ? ` (${options.resolution}, ${options.sampleRate === 'original' ? (isEs ? 'frecuencia original' : 'original sample rate') : `${options.sampleRate} Hz`})`
    : '';
  const statusSummary = !report.canExport
    ? isEs
      ? 'Asigna al menos una muestra de audio válida a las zonas antes de exportar.'
      : 'Assign at least one valid audio sample to the zones before exporting.'
    : isEs
      ? `Se generará el paquete ${meta.title}${optSummary} aplicando las adaptaciones indicadas abajo.`
      : `Will generate the ${meta.title} package${optSummary} applying the adaptations listed below.`;

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
        ? isEs
          ? 'límite formato'
          : 'format limit'
        : iss.severity === 'warning'
          ? isEs
            ? 'ajuste'
            : 'adjustment'
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
    changesHeading: isEs
      ? `Qué voy a cambiar (${changes.length})`
      : `What will be changed (${changes.length})`,
    emptyChangesText: isEs
      ? 'No hay advertencias ni conversiones forzosas para este formato; se exportará tal cual.'
      : 'No warnings or forced conversions for this format; it will be exported as-is.',
    changes,
    adjustLabel: isEs ? 'Ajustar / Volver' : 'Adjust / Back',
    continueLabel: isEs
      ? `Continuar y exportar ${meta.title}`
      : `Continue & export ${meta.title}`,
    canContinue: report.canExport,
  };
}

/**
 * Adapts a `BatchPreflightSummary` into the unified `CommonPreflightGateModel`.
 */
export function fromBatchPreflightSummary(
  summary: BatchPreflightSummary
): CommonPreflightGateModel {
  const isEs = getAppLocale() === 'es';
  const canContinue = summary.selectedCount > 0;
  const skippedCount = summary.totalDiscovered - summary.selectedCount;
  const statusSeverity: CommonPreflightSeverity = !canContinue
    ? 'error'
    : skippedCount > 0
      ? 'warn'
      : 'ok';

  const statusTitle = !canContinue
    ? isEs
      ? 'Ningún modelo seleccionado para procesar'
      : 'No models selected for processing'
    : isEs
      ? `Listo para sintetizar ${summary.selectedCount} de ${summary.totalDiscovered} modelo(s)`
      : `Ready to synthesize ${summary.selectedCount} of ${summary.totalDiscovered} model(s)`;

  const statusMeta = isEs
    ? `${summary.selectedCount} modelos · ${summary.totalFiles} archivos · ~${summary.estimatedDurationSec}s`
    : `${summary.selectedCount} models · ${summary.totalFiles} files · ~${summary.estimatedDurationSec}s`;

  const statusSummary = !canContinue
    ? isEs
      ? 'Marca al menos un modelo en la tabla inferior o vuelve al paso anterior para ajustar el origen.'
      : 'Select at least one model in the table below or go back to the previous step to adjust the source.'
    : isEs
      ? `Se compilarán ${summary.selectedCount} instrumentos hacia ${summary.executionProfile.destinationLabel} (${summary.executionProfile.destinationPathOrName}).`
      : `Will compile ${summary.selectedCount} instruments to ${summary.executionProfile.destinationLabel} (${summary.executionProfile.destinationPathOrName}).`;

  const changes: CommonPreflightChangeItem[] = [];
  if (canContinue) {
    changes.push(
      {
        severity: 'info',
        title: isEs
          ? `Modo y formato de salida: ${summary.executionProfile.workingModeLabel}`
          : `Output mode & format: ${summary.executionProfile.workingModeLabel}`,
        categoryTag: isEs ? 'formato' : 'format',
        severityTag: 'info',
        description: isEs
          ? `Perfil de exportación activo: ${summary.executionProfile.targetFormatLabel}.`
          : `Active export profile: ${summary.executionProfile.targetFormatLabel}.`,
        adaptation: isEs
          ? `Cada candidato se escribirá en ${summary.executionProfile.destinationLabel} (${summary.executionProfile.destinationPathOrName}).`
          : `Each candidate will be written to ${summary.executionProfile.destinationLabel} (${summary.executionProfile.destinationPathOrName}).`,
      },
      {
        severity: 'info',
        title: isEs
          ? `Motor espectral y asistencia: ${summary.executionProfile.dspAlgorithmLabel}`
          : `Spectral engine & assistance: ${summary.executionProfile.dspAlgorithmLabel}`,
        categoryTag: isEs ? 'motor' : 'engine',
        severityTag: 'info',
        description: isEs
          ? `Motor IA: ${summary.executionProfile.aiEngineLabel} · Complejidad: ${summary.executionProfile.complexityLabel}.`
          : `AI Engine: ${summary.executionProfile.aiEngineLabel} · Complexity: ${summary.executionProfile.complexityLabel}.`,
        adaptation: isEs
          ? `Duración estimada del lote: ~${summary.estimatedDurationSec} segundos para ${summary.totalFiles} muestra(s).`
          : `Estimated batch duration: ~${summary.estimatedDurationSec} seconds for ${summary.totalFiles} sample(s).`,
      }
    );

    if (summary.executionProfile.slicerProfileLabel) {
      changes.push({
        severity: 'info',
        title: isEs
          ? 'Segmentación automática de transitorios (AutoSlicer)'
          : 'Automatic transient segmentation (AutoSlicer)',
        categoryTag: 'slicer',
        severityTag: isEs ? 'ajuste' : 'adjustment',
        description: isEs
          ? `Perfil de corte activo: ${summary.executionProfile.slicerProfileLabel}.`
          : `Active slicing profile: ${summary.executionProfile.slicerProfileLabel}.`,
        adaptation: isEs
          ? 'Cada archivo se troceará en el cruce por cero y se mapeará automáticamente a zonas MIDI.'
          : 'Each file will be sliced at zero-crossings and automatically mapped to MIDI zones.',
      });
    }

    if (skippedCount > 0) {
      changes.push({
        severity: 'warn',
        title: isEs
          ? `${skippedCount} candidato(s) desmarcado(s) se omitirán`
          : `${skippedCount} unchecked candidate(s) will be skipped`,
        categoryTag: isEs ? 'selección' : 'selection',
        severityTag: isEs ? 'ajuste' : 'adjustment',
        description: isEs
          ? `Has seleccionado ${summary.selectedCount} de los ${summary.totalDiscovered} candidatos descubiertos.`
          : `You have selected ${summary.selectedCount} of ${summary.totalDiscovered} discovered candidates.`,
        adaptation: isEs
          ? 'Solo se procesarán las filas marcadas en la tabla inferior.'
          : 'Only checked rows in the table below will be processed.',
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
    changesHeading: isEs
      ? `Qué voy a cambiar (${changes.length})`
      : `What will be changed (${changes.length})`,
    emptyChangesText: isEs
      ? 'Selecciona al menos un modelo para ver las adaptaciones del lote.'
      : 'Select at least one model to view batch adaptations.',
    changes,
    adjustLabel: isEs ? 'Ajustar origen' : 'Adjust source',
    continueLabel: isEs
      ? `Continuar y procesar (${summary.selectedCount})`
      : `Continue & process (${summary.selectedCount})`,
    canContinue,
  };
}

/**
 * Renders the unified visual preflight block (`.preflight-status` + `.preflight-issues`)
 * shared across Import, Batch, and Export modals.
 */
export function renderCommonPreflightGate(model: CommonPreflightGateModel): string {
  const isEs = getAppLocale() === 'es';
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
                <div class="issue-adapt"><strong>${isEs ? 'Qué voy a cambiar:' : 'What will change:'}</strong><span>${escHtml(item.adaptation)}</span></div>
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
