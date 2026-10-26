// ─────────────────────────────────────────────────────────
// Phase 3 Verification Test Suite
// Tests PKZIP packaging, Import Samples vs Import by Name,
// Session JSON persistence, and .model / .zip UI Import & Export
// ─────────────────────────────────────────────────────────

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createZipArchive, parseZipArchive } from '../src/formats/ZipArchive.ts';
import {
  WebAudioPipeline,
  parseSampleFilenameByName,
} from '../src/core/WebAudioPipeline.ts';
import { synthesizeDemoWav, encodePcm16Wav } from '../src/core/dsp/WavDecoder.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

async function runPhase3Tests(): Promise<void> {
  console.log('=== Phase 3 Verification: ZIP Packaging, Import by Name, Session & .model Import ===\n');

  // 1. Test PKZIP Writer & Reader Round-Trip
  console.log('1. Testing PKZIP writer & reader round-trip (`ZipArchive.ts`)...');
  const payloadA = new TextEncoder().encode('Hello Hartmann Neuron MODELmaker!\n');
  const payloadB = new Uint8Array(256);
  for (let i = 0; i < payloadB.length; i++) payloadB[i] = (i * 73 + 19) & 0xff;

  const zipBytes = createZipArchive([
    { path: 'Models/001.model/MName', data: payloadA },
    { path: 'Models/001.model/000001.scape', data: payloadB },
  ]);
  assert(zipBytes[0] === 0x50 && zipBytes[1] === 0x4b, 'ZIP must start with PK magic');

  const extracted = parseZipArchive(zipBytes);
  assert(extracted.length === 2, `Expected 2 extracted entries, got ${extracted.length}`);
  assert(extracted[0].path === 'Models/001.model/MName', `Unexpected path[0]: ${extracted[0].path}`);
  assert(
    new TextDecoder().decode(extracted[0].data) === 'Hello Hartmann Neuron MODELmaker!\n',
    'Extracted text payload mismatch'
  );
  assert(extracted[1].data.byteLength === 256, 'Extracted binary payload length mismatch');
  for (let i = 0; i < 256; i++) {
    assert(extracted[1].data[i] === payloadB[i], `Byte mismatch at index ${i}`);
  }
  console.log('   -> PKZIP store + CRC-32 round-trip verified.');

  // 2. Test `parseSampleFilenameByName` (Hartmann manual Section 4.1 conventions)
  console.log('2. Testing `parseSampleFilenameByName` (Hartmann `name_rootkey_lowkey[_v1|_v2]` & `_high`)...');
  const p1 = parseSampleFilenameByName('Flute_72_68.aif');
  assert(p1.rootKey === 72 && p1.lowKey === 68 && !p1.isHighVelocity, `Flute_72_68 failed: ${JSON.stringify(p1)}`);

  const p2 = parseSampleFilenameByName('Flute_72_68_v1.aif');
  assert(p2.rootKey === 72 && p2.lowKey === 68 && !p2.isHighVelocity, `Flute_72_68_v1 failed: ${JSON.stringify(p2)}`);

  const p3 = parseSampleFilenameByName('Flute_72_68_v2.aif');
  assert(p3.rootKey === 72 && p3.lowKey === 68 && p3.isHighVelocity, `Flute_72_68_v2 failed: ${JSON.stringify(p3)}`);

  const p4 = parseSampleFilenameByName('12 String Gtr-A2.aif');
  assert(p4.rootKey === 45 && !p4.isHighVelocity, `12 String Gtr-A2 failed: ${JSON.stringify(p4)}`);

  const p5 = parseSampleFilenameByName('12 String Gtr-A2_high.aif');
  assert(p5.rootKey === 45 && p5.isHighVelocity, `12 String Gtr-A2_high failed: ${JSON.stringify(p5)}`);
  console.log('   -> Filename conventions verified.');

  // 3. Test `importAudioFiles` in `'by-name'` mode (`Ctrl+N`) vs `'samples'` mode (`Ctrl+I`)
  console.log('3. Testing `importAudioFiles` (`by-name` velocity merging & contiguous 0..127 zones)...');
  const core = new WebAudioPipeline();
  await core.init();
  await core.newSession('ImportByNameTest');

  const wavLow1 = synthesizeDemoWav('strings', 48, 44100, 0.25);
  const wavLow2 = synthesizeDemoWav('strings', 60, 44100, 0.25);
  const wavHigh2 = synthesizeDemoWav('strings', 60, 44100, 0.25);
  const wavLow3 = synthesizeDemoWav('strings', 72, 44100, 0.25);

  const zonesByName = await core.importAudioFiles(
    [
      { name: 'Flute_72_68.wav', buffer: wavLow3 },
      { name: 'Flute_60_54_v2.wav', buffer: wavHigh2 },
      { name: 'Flute_48_36.wav', buffer: wavLow1 },
      { name: 'Flute_60_54_v1.wav', buffer: wavLow2 },
    ],
    'by-name'
  );

  assert(zonesByName.length === 3, `Expected 3 merged zones, got ${zonesByName.length}`);
  assert(
    zonesByName[0].lowKey === 0 && zonesByName[0].rootKey === 48 && zonesByName[0].highKey === 53,
    `Zone 0 bounds mismatch: ${JSON.stringify(zonesByName[0])}`
  );
  assert(
    zonesByName[1].lowKey === 54 &&
      zonesByName[1].rootKey === 60 &&
      zonesByName[1].highKey === 67 &&
      zonesByName[1].sampleLow === 'Flute_60_54_v1.wav' &&
      zonesByName[1].sampleHigh === 'Flute_60_54_v2.wav',
    `Zone 1 velocity merge mismatch: ${JSON.stringify(zonesByName[1])}`
  );
  assert(
    zonesByName[2].lowKey === 68 && zonesByName[2].rootKey === 72 && zonesByName[2].highKey === 127,
    `Zone 2 bounds mismatch: ${JSON.stringify(zonesByName[2])}`
  );
  assert(core.validateCoverage().length === 0, 'Expected 0 coverage errors after Import by Name');
  console.log('   -> `Import by Name` merged v1/v2 layers and mapped [0..53], [54..67], [68..127].');

  // Test `Import Samples` (`samples` mode) reading embedded `smpl` metadata
  const customSmplWav = encodePcm16Wav(new Float32Array(4410), 44100, {
    rootKey: 64,
    lowKey: 0,
    highKey: 127,
    detune: -12,
  });
  const zonesByInst = await core.importAudioFiles(
    [{ name: 'MysterySample.wav', buffer: customSmplWav }],
    'samples'
  );
  assert(zonesByInst.length === 1, 'Expected 1 zone');
  assert(zonesByInst[0].rootKey === 64, `Expected rootKey=64 from smpl chunk, got ${zonesByInst[0].rootKey}`);
  assert(zonesByInst[0].detune === -12, `Expected detune=-12 from smpl chunk, got ${zonesByInst[0].detune}`);
  console.log('   -> `Import Samples` embedded `smpl`/`INST` metadata extraction verified.');

  // 4. Test Session JSON Export & Restore
  console.log('4. Testing `.nmsession.json` export & restore...');
  const exportedJson = core.exportSessionJson();
  assert(exportedJson.includes('NEURONMM_SESSION'), 'Session JSON must include NEURONMM_SESSION magic');

  await core.newSession('BlankSession');
  const restored = await core.loadSessionFromJson(exportedJson);
  assert(restored.name === 'ImportByNameTest', `Expected restored session name 'ImportByNameTest', got '${restored.name}'`);
  assert(restored.zones[0].rootKey === 64 && restored.zones[0].detune === -12, 'Restored zone metadata mismatch');
  console.log('   -> Session JSON round-trip verified.');

  // 5. Test Full Model Generation -> ZIP Package Export -> `.zip` Model Import Round-Trip
  console.log('5. Testing Dual-Target `.zip` export & `importModelFiles` round-trip...');
  await core.startProcess({
    modelName: 'ZipRoundTrip',
    modelNumber: 77,
    parameterSet: 1,
    complexity: 6,
    targetFormat: 'dual',
  });

  const modelZip = core.buildModelZipBytes(77);
  const zipEntries = parseZipArchive(modelZip);
  const entryPaths = zipEntries.map((e) => e.path);
  console.log(`   -> Generated ZIP (${modelZip.byteLength} bytes) with entries: ${entryPaths.join(', ')}`);

  assert(entryPaths.includes('Models/077.model/MName'), 'Missing Models/077.model/MName');
  assert(entryPaths.includes('Models/077.model/map.script'), 'Missing Models/077.model/map.script');
  assert(entryPaths.includes('Models/077.model/000001.scape'), 'Missing Models/077.model/000001.scape');
  assert(entryPaths.includes('Models/077.model/000001.sphere'), 'Missing Models/077.model/000001.sphere');
  assert(entryPaths.includes('Sounds/077.sound/sound.script'), 'Missing Sounds/077.sound/sound.script');
  assert(entryPaths.includes('Sounds/077.sound/sound.stickrec'), 'Missing Sounds/077.sound/sound.stickrec');
  assert(
    entryPaths.some((p) => p.startsWith('Modern/077_') && p.endsWith('.neuronikmodel')),
    'Missing Modern/*.neuronikmodel'
  );

  // Import the ZIP back into a fresh pipeline instance
  const core2 = new WebAudioPipeline();
  await core2.init();
  const importedModel = await core2.importModelFiles([
    {
      name: 'NeuronModel_077_ZipRoundTrip.zip',
      buffer: modelZip.buffer.slice(
        modelZip.byteOffset,
        modelZip.byteOffset + modelZip.byteLength
      ) as ArrayBuffer,
    },
  ]);

  assert(importedModel.slot === 77, `Expected imported slot 77, got ${importedModel.slot}`);
  assert(importedModel.name === 'ZipRoundTrip', `Expected imported name 'ZipRoundTrip', got '${importedModel.name}'`);
  assert(importedModel.zoneCount === 1, `Expected 1 imported zone, got ${importedModel.zoneCount}`);
  assert(core2.getZones()[0].rootKey === 64, `Expected imported zone rootKey=64, got ${core2.getZones()[0].rootKey}`);
  console.log('   -> `.zip` Dual-Target export & re-import round-trip verified.');

  // 6. Test importing real NeuronDB `511.model` directory files if available on disk
  const realModelDir = 'C:/Users/ajaba/Downloads/neuron/Hartmann Music/NeuronVS/NeuronDB/Models/511.model';
  if (fs.existsSync(realModelDir)) {
    console.log(`6. Testing real NeuronDB model import from ${realModelDir}...`);
    const filenames = ['MName', 'map.script', '000001.scape', '000001.sphere'];
    const realFiles: { name: string; buffer: ArrayBuffer }[] = [];
    for (const fn of filenames) {
      const fullPath = path.join(realModelDir, fn);
      if (fs.existsSync(fullPath)) {
        const buf = fs.readFileSync(fullPath);
        realFiles.push({
          name: `Models/511.model/${fn}`,
          buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        });
      }
    }

    const imported511 = await core2.importModelFiles(realFiles);
    console.log(
      `   -> Imported real #${imported511.slot} "${imported511.name}": ${imported511.zoneCount} zone(s), f0=${imported511.zonesAnalysis?.[0]?.detectedF0Hz} Hz`
    );
    assert(imported511.slot === 511, `Expected slot 511, got ${imported511.slot}`);
    assert(imported511.name === 'sinew', `Expected name 'sinew', got '${imported511.name}'`);
    assert(imported511.zoneCount === 1, `Expected 1 zone, got ${imported511.zoneCount}`);
  }

  core.dispose();
  core2.dispose();
  console.log('\nALL PHASE 3 TESTS PASSED SUCCESSFULLY!');
}

runPhase3Tests().catch((err) => {
  console.error(err);
  process.exit(1);
});
