// ─────────────────────────────────────────────────────────
// Tests — Fase 35.3: Musician Terminology & Common Preflight Gate
// ─────────────────────────────────────────────────────────

import assert from 'node:assert/strict';
import {
  MUSICIAN_TERMS,
  fromBatchPreflightSummary,
  fromImportPreflightReport,
  fromRawSamplerPreflightReport,
  renderCommonPreflightGate,
} from '../src/ui/preflightGateView.ts';
import type { ImportPreflightReport } from '../src/core/import/importPreflight.ts';
import type { ParsedSamplerPreset } from '../src/core/import/rawSamplerParsers.ts';
import type { RawSamplerPreflightReport } from '../src/core/export/rawSamplerTypes.ts';
import type { BatchPreflightSummary } from '../src/core/batch/preflight.ts';

function runTests(): void {
  // 1. Canonical musician-first terms with technical subtitle
  assert.equal(MUSICIAN_TERMS.preflightImport, 'Revisión antes de importar (Preflight)');
  assert.equal(MUSICIAN_TERMS.preflightBatch, 'Revisión antes de procesar el lote (Preflight)');
  assert.equal(MUSICIAN_TERMS.preflightExport, 'Revisión antes de exportar (Preflight)');
  assert.equal(MUSICIAN_TERMS.noisePrint, 'Huella de ruido de esta grabación (Noise Print)');
  assert.equal(MUSICIAN_TERMS.zcSnap, 'Ajustar cortes al cruce por cero (zc-snap)');
  assert.equal(MUSICIAN_TERMS.bwe, 'Reconstructor de agudos (BWE)');

  // 2. Import preflight adapter + interactive adaptation toggles
  const mockPreset: ParsedSamplerPreset = {
    format: 'sfz',
    formatLabel: 'SFZ v2',
    presetName: 'Warm Strings',
    modelName: 'WarmStrings',
    detectedCategory: 'Strings',
    suggestedParameterSet: 3,
    regions: [],
    audioBuffers: new Map(),
  };

  const mockImportReport: ImportPreflightReport = {
    presetName: 'Warm Strings',
    sourceFormat: 'sfz',
    formatLabel: 'SFZ v2',
    totalRegions: 8,
    totalAudioFiles: 8,
    missingAudioCount: 0,
    missingSampleNames: [],
    keyRange: {
      minKey: 24,
      maxKey: 96,
      uncoveredLowNotes: 24,
      uncoveredHighNotes: 31,
      hasInternalGaps: false,
    },
    maxVelocityLayers: 4,
    isClassicModeCompatible: false,
    isSliceChain: false,
    isEncrypted: false,
    canImport: true,
    issues: [
      {
        code: 'WARN_MULTI_VEL',
        category: 'velocity',
        severity: 'warning',
        title: '4 Velocity Layers Detected',
        description: 'Classic mode supports 2 layers.',
        resolutionText: 'Fold into 2 layers or switch to Extended.',
      },
    ],
    defaultActions: {
      autoExtendOuterZones: true,
      adaptVelocityLayers: true,
      switchToExtendedMode: false,
      openInAudioChopper: false,
    },
  };

  const importModel = fromImportPreflightReport(mockImportReport, mockPreset, 'classic', {
    autoExtendOuterZones: true,
    adaptVelocityLayers: true,
    switchToExtendedMode: false,
  });
  assert.equal(importModel.kind, 'import');
  assert.equal(importModel.sectionTitle, 'Revisión antes de importar (Preflight)');
  assert.equal(importModel.statusSeverity, 'warn');
  assert.ok(importModel.changes.length >= 3); // 1 issue + autoExtend + adaptVel
  assert.ok(importModel.adjustLabel.startsWith('Ajustar'));
  assert.ok(importModel.continueLabel.startsWith('Continuar'));
  assert.equal(importModel.canContinue, true);

  // 3. Export preflight adapter
  const mockExportReport: RawSamplerPreflightReport = {
    targetFormat: 'sf2',
    formatTitle: 'SoundFont 2 (.sf2)',
    formatDescription: 'Standard SoundFont 2.04',
    totalRegions: 6,
    totalSamples: 6,
    canExport: true,
    issues: [
      {
        id: 'bit_depth_16',
        category: 'bit_depth',
        severity: 'warning',
        title: 'Conversión a 16-bit PCM',
        description: 'SF2 requiere muestras de 16 bits.',
        adaptation: 'Se cuantizarán las muestras de 24 a 16 bits con dither TPDF.',
        affectedCount: 6,
      },
    ],
    summary: {
      infoCount: 0,
      warningCount: 1,
      incompatibilityCount: 0,
    },
  };

  const exportModel = fromRawSamplerPreflightReport(
    mockExportReport,
    {
      title: 'SoundFont 2 (.sf2)',
      description: 'Standard SoundFont 2.04',
      extension: '.sf2',
    },
    {
      resolution: 'pcm16',
      sampleRate: 44100,
      normalization: 'none',
      layout: 'monolithic',
    }
  );
  assert.equal(exportModel.kind, 'export');
  assert.equal(exportModel.sectionTitle, 'Revisión antes de exportar (Preflight)');
  assert.equal(exportModel.statusSeverity, 'warn');
  assert.equal(exportModel.changes.length, 1);
  assert.ok(exportModel.adjustLabel.startsWith('Ajustar'));
  assert.ok(exportModel.continueLabel.startsWith('Continuar'));

  // 4. Batch preflight adapter
  const mockBatchSummary: BatchPreflightSummary = {
    totalDiscovered: 3,
    selectedCount: 2,
    totalFiles: 12,
    totalBytesEstimate: 1024000,
    estimatedDurationSec: 16,
    executionProfile: {
      dspAlgorithm: 'enhanced',
      dspAlgorithmLabel: 'Classic Enhanced',
      targetFormat: 'dual',
      targetFormatLabel: 'Dual-Target',
      workingMode: 'extended',
      workingModeLabel: 'Extended Mode',
      aiEngineLabel: 'DSP Only',
      complexityLabel: 'Auto',
      destinationLabel: 'ZIP Archive',
      destinationPathOrName: 'BatchExport.zip',
      slicerProfileLabel: 'Drums GM',
    },
    models: [],
  };

  const batchModel = fromBatchPreflightSummary(mockBatchSummary);
  assert.equal(batchModel.kind, 'batch');
  assert.equal(batchModel.sectionTitle, 'Revisión antes de procesar el lote (Preflight)');
  assert.equal(batchModel.statusSeverity, 'warn'); // 1 candidate deselected
  assert.equal(batchModel.changes.length, 4); // mode + dsp + slicer + skipped warning
  assert.ok(batchModel.adjustLabel.startsWith('Ajustar'));
  assert.ok(batchModel.continueLabel.startsWith('Continuar'));
  assert.equal(batchModel.canContinue, true);

  // 5. Unified HTML renderer
  const html = renderCommonPreflightGate(exportModel);
  assert.ok(html.includes('class="preflight-status is-warn"'));
  assert.ok(html.includes('class="preflight-issues"'));
  assert.ok(html.includes('class="issue-card is-warn"'));
  assert.ok(html.includes('Qué voy a cambiar'));
  assert.ok(html.includes('Revisión antes de exportar (Preflight)'));

  console.log('PASS: phase35_preflight_gate (5/5 assertions)');
}

runTests();
