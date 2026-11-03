// ─────────────────────────────────────────────────────────
// Tests — Phase 35.1: Hartmann Neuron / Neuronik Bank as a First-Class Import Format
// ─────────────────────────────────────────────────────────

import {
  createZipArchive,
  serializeCanonicalMapScript,
  serializeMName,
  serializeNeuronScapeBinary,
  serializeNeuronSphereBinary,
} from '@abdsynths/shared/formats/neuron';
import {
  isNeuronBankOrModelInput,
  listNeuronBankModels,
  parseNeuronBankOrModelToPreset,
} from '../src/core/import/neuronBankImporter.ts';
import {
  analyzeImportPreflight,
  applyPreflightImportAdaptations,
} from '../src/core/import/importPreflight.ts';
import {
  fromImportPreflightReport,
  renderCommonPreflightGate,
} from '../src/ui/preflightGateView.ts';
import {
  discoverTriageReport,
  extractTriageDefinitionCandidates,
  indexTriageBuffers,
  isTriageContainerFileName,
  parseTriageDefinitionItem,
  partitionTriageSelection,
  shouldOpenTriageGate,
  type TriageExpandedFile,
} from '../src/app/triageGate.ts';
import { SAMPLER_FORMAT_METADATA } from '@abdsynths/shared/formats/sampler/rawSamplerPreflight.ts';
import type { Zone } from '../src/core/types.ts';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(u8.byteLength);
  copy.set(u8);
  return copy.buffer;
}

export async function runPhase35NeuronBankImportTests(): Promise<void> {
  console.log('Running Phase 35.1 Hartmann Neuron / Neuronik Bank Import tests...');

  const partialMags = new Float32Array(64);
  partialMags[0] = 0.8;
  partialMags[1] = 0.4;
  partialMags[2] = 0.2;
  const partialOffsets = new Float32Array(64);

  const dummyFrames = [
    {
      frameIndex: 0,
      f0Hz: 220,
      scape: {
        centroidHarmonic: 2.0,
        oddEvenBalance: 0.6,
        inharmonicityCents: 1.5,
        retainedPartials: 32,
        partialMagnitudes: partialMags,
        partialOffsetsHz: partialOffsets,
      },
      sphere: {
        spectralTiltDbPerOct: -6,
        temporalContour: new Float32Array([0.8, 0.6, 0.4]),
        formantBands: [0.5, 0.3, 0.15, 0.05] as [number, number, number, number],
        parameterSet: 2,
        layerCount: 1,
      },
    },
  ];
  const dummyConfig = {
    modelName: 'TestBankModel',
    parameterSet: 2,
    complexity: 2,
    sampleRate: 44100,
    normalize: true,
    trimSilence: false,
  };

  const scapeBytes = serializeNeuronScapeBinary(dummyFrames, dummyConfig);
  const sphereBytes = serializeNeuronSphereBinary(dummyFrames, dummyConfig);

  // 1. Signature & extension detection (`isNeuronBankOrModelInput`)
  {
    assert(
      isNeuronBankOrModelInput('000001.bin', toArrayBuffer(scapeBytes)),
      'Should detect .scape csAN magic header even with .bin extension'
    );
    assert(
      isNeuronBankOrModelInput('000001.bin', toArrayBuffer(sphereBytes)),
      'Should detect .sphere psAN magic header even with .bin extension'
    );
    assert(
      isNeuronBankOrModelInput('MySynth.neuronikmodel', new ArrayBuffer(8)),
      'Should detect .neuronikmodel by extension'
    );
    assert(
      isNeuronBankOrModelInput('MName', toArrayBuffer(serializeMName('WARMPAD'))),
      'Should detect MName file'
    );
  }

  // 2. Multi-model NeuronDB ZIP container listing (`listNeuronBankModels`) & extraction
  {
    const zones0: Zone[] = [
      {
        id: 'zone_1',
        lowKey: 24,
        rootKey: 48,
        highKey: 72,
        sampleLow: '000001.scape',
        sampleHigh: null,
        detune: 0,
        volume: 0,
        pan: 0,
      },
      {
        id: 'zone_2',
        lowKey: 73,
        rootKey: 84,
        highKey: 108,
        sampleLow: '000002.scape',
        sampleHigh: null,
        detune: 0,
        volume: 0,
        pan: 0,
      },
    ];
    const zones1: Zone[] = [
      {
        id: 'zone_1',
        lowKey: 0,
        rootKey: 60,
        highKey: 127,
        sampleLow: '000001.scape',
        sampleHigh: '000002.scape',
        velSplit: 64,
        detune: 0,
        volume: 0,
        pan: 0,
      },
    ];

    const multiZipBytes = createZipArchive([
      { path: 'Models/000.model/MName', data: serializeMName('BASSLINE01') },
      { path: 'Models/000.model/map.script', data: serializeCanonicalMapScript(zones0) },
      { path: 'Models/000.model/000001.scape', data: scapeBytes },
      { path: 'Models/000.model/000001.sphere', data: sphereBytes },
      { path: 'Models/000.model/000002.scape', data: scapeBytes },
      { path: 'Models/000.model/000002.sphere', data: sphereBytes },
      { path: 'Models/005.model/MName', data: serializeMName('GLASSCHOIR') },
      { path: 'Models/005.model/map.script', data: serializeCanonicalMapScript(zones1) },
      { path: 'Models/005.model/000001.scape', data: scapeBytes },
      { path: 'Models/005.model/000001.sphere', data: sphereBytes },
      { path: 'Models/005.model/000002.scape', data: scapeBytes },
      { path: 'Models/005.model/000002.sphere', data: sphereBytes },
    ]);
    const zipAb = toArrayBuffer(multiZipBytes);

    assert(
      isNeuronBankOrModelInput('NeuronDB_Pack.zip', zipAb),
      'Should detect multi-model NeuronDB .zip by internal structure'
    );

    const models = listNeuronBankModels('NeuronDB_Pack.zip', zipAb);
    assert(models.length === 2, `Expected 2 models in NeuronDB_Pack.zip, got ${models.length}`);
    assert(models[0].name === 'BASSLINE01' && models[0].slot === 0, 'First model should be BASSLINE01 (#000)');
    assert(models[1].name === 'GLASSCHOIR' && models[1].slot === 5, 'Second model should be GLASSCHOIR (#005)');

    // Extract Model #005 (`GLASSCHOIR`) with 2 velocity layers
    const preset5 = await parseNeuronBankOrModelToPreset(
      'NeuronDB_Pack.zip',
      zipAb,
      undefined,
      models[1].id
    );
    assert(preset5.format === 'neuron_bank', 'Preset format must be neuron_bank');
    assert(preset5.presetName === 'GLASSCHOIR', 'Preset name must be GLASSCHOIR');
    assert(preset5.regions.length === 2, '2-velocity-layer zone should produce 2 regions');
    assert(preset5.audioBuffers.size === 2, 'Should resynthesize 2 WAV audioBuffers');
  }

  // 3. Preflight adaptations for Hartmann/Neuronik Bank (11-char name, velocity layer projection, common gate)
  {
    const modernJson = JSON.stringify({
      version: 2,
      schemaVersion: '2.1',
      targetFormat: 'modern-neural',
      name: 'HyperResonantOrchestralStrings',
      slot: 12,
      parameterSet: 4,
      zones: [
        { zoneId: 'z1', lowKey: 24, rootKey: 60, highKey: 96, detune: 0, volume: 0, pan: 0 },
      ],
    });
    const modernBytes = new TextEncoder().encode(modernJson);
    const preset = await parseNeuronBankOrModelToPreset(
      'HyperResonantOrchestralStrings.neuronikmodel',
      toArrayBuffer(modernBytes)
    );

    assert(
      preset.presetName === 'HyperResonantOrchestralStrings',
      'Full presetName should be preserved'
    );
    assert(
      preset.modelName === 'HyperResona',
      `Classic modelName should be 11-char truncated ("HyperResona"), got "${preset.modelName}"`
    );

    const report = analyzeImportPreflight(preset, 'classic');
    const has11CharIssue = report.issues.some((i) => i.code === 'INFO_CLASSIC_NAME_11_CHARS');
    assert(has11CharIssue, 'Preflight in classic mode must report INFO_CLASSIC_NAME_11_CHARS for >11 char names');

    const gate = fromImportPreflightReport(report, preset, 'classic', {
      autoExtendOuterZones: true,
      adaptVelocityLayers: true,
      switchToExtendedMode: false,
    });
    const html = renderCommonPreflightGate(gate);
    assert(html.includes('HyperResona'), 'Rendered common preflight gate must show 11-char Classic name');
    assert(html.includes('0..127'), 'Rendered common preflight gate must show outer zone extension');

    const adapted = applyPreflightImportAdaptations(preset, {
      autoExtendOuterZones: true,
      adaptVelocityLayers: true,
      switchToExtendedMode: false,
      currentWorkingMode: 'classic',
    });
    assert(adapted.classicZones.length === 1, 'Should adapt into 1 Classic zone');
    assert(
      adapted.classicZones[0].lowKey === 0 && adapted.classicZones[0].highKey === 127,
      'Auto-extend should stretch outer zone to 0..127'
    );
  }

  // 4. Triage discovery & mixed-folder/zip handling for Hartmann Neuron banks (`MultiAssetDiscovery` + `triageGate`)
  {
    assert(
      Boolean(SAMPLER_FORMAT_METADATA.neuron_bank?.title),
      'SAMPLER_FORMAT_METADATA must define neuron_bank entry'
    );
    assert(isTriageContainerFileName('Bank/MName'), 'MName must be recognized as a triage container');
    assert(isTriageContainerFileName('Bank/map.script'), 'map.script must be recognized as a triage container');
    assert(isTriageContainerFileName('Synth.model'), '.model must be recognized as a triage container');

    const bankZones: Zone[] = [
      {
        id: 'zone_1',
        lowKey: 36,
        rootKey: 60,
        highKey: 84,
        sampleLow: '000001.scape',
        sampleHigh: null,
        detune: 0,
        volume: 0,
        pan: 0,
      },
    ];
    const mnameBytes = serializeMName('PADBANK01');
    const mapBytes = new TextEncoder().encode(serializeCanonicalMapScript(bankZones));

    // Build a mixed folder: Pack/{Bank/MName, Bank/map.script, Bank/000001.scape, Bank/000001.sphere, Drums/kick_C2.wav}
    const mixedFiles: TriageExpandedFile[] = [
      { name: 'Pack/Bank/MName', buffer: toArrayBuffer(mnameBytes) },
      { name: 'Pack/Bank/map.script', buffer: toArrayBuffer(mapBytes) },
      { name: 'Pack/Bank/000001.scape', buffer: toArrayBuffer(scapeBytes) },
      { name: 'Pack/Bank/000001.sphere', buffer: toArrayBuffer(sphereBytes) },
      { name: 'Pack/Drums/Kick_C2.wav', buffer: new ArrayBuffer(128) },
    ];

    const report = await discoverTriageReport(mixedFiles, 'Mixed Pack');
    assert(report !== null, 'discoverTriageReport must succeed on mixed Neuron bank + audio');
    assert(shouldOpenTriageGate(report), 'Mixed Neuron bank + audio pack must open the triage gate');

    const neuronItem = report!.items.find((it) => it.format === 'neuron_bank');
    assert(neuronItem !== undefined, 'Triage report must discover the Hartmann Neuron bank item');
    assert(neuronItem!.name === 'PADBANK01', `Expected discovered bank name PADBANK01, got ${neuronItem!.name}`);

    const byPath = indexTriageBuffers(mixedFiles);
    const singlePreset = await parseTriageDefinitionItem(neuronItem!, byPath);
    assert(
      singlePreset !== null && singlePreset.format === 'neuron_bank' && singlePreset.regions.length === 1,
      'parseTriageDefinitionItem must parse the discovered Hartmann bank for Load Single'
    );

    const part = partitionTriageSelection(report!.items, byPath);
    const batchExtracted = await extractTriageDefinitionCandidates(part.skipped, byPath);
    assert(
      batchExtracted.candidates.some((c) => c.name === 'PADBANK01'),
      'extractTriageDefinitionCandidates must convert the Hartmann bank into a Batch candidate for Process Selected'
    );
    assert(batchExtracted.unparseable.length === 0, 'Hartmann bank must not be left in unparseable');
  }

  console.log('✓ Phase 35.1 Hartmann Neuron / Neuronik Bank Import tests passed (4/4)');
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('phase35_neuron_bank_import.test.ts')
) {
  runPhase35NeuronBankImportTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
