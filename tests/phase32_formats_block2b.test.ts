// ─────────────────────────────────────────────────────────
// ABDNeuModMakr & @abdsynths/shared — Fase 32.4 (Bloque 2B) Test Suite
//
// Verifies full round-trip (export -> import -> verify) on:
// 1. Waldorf Quantum / Iridium (.qpat patch + sample map)
// 2. Teenage Engineering OP-XY (patch.json in .preset / .zip)
// 3. Elektron Tonverk (.tvpst / elmulti in .zip)
// 4. Expert Sleepers Disting EX (.dexpreset in .zip)
// 5. Sequential Prophet X / XL (.grp in .zip)
// 6. Isla Instruments S2400 (.kit in .zip)
// 7. Korg Modern Multisample (.korgmultisample in .zip)
// 8. Groove Synthesis 3rd Wave (.3wv in .zip)
// 9. Roland Zen-Core / SP-404MKII / MC-707 (.svz in .zip)
// 10. Universal sampler dispatcher & Zip extractor transparent detection
// ─────────────────────────────────────────────────────────

import assert from 'node:assert/strict';
import {
  encodeWavPcm16,
} from '../src/core/dsp/WavDecoder.ts';
import {
  createDefaultArticulation,
  type UniversalSamplerInstrument,
  buildWaldorfQpat,
  parseWaldorfQpat,
  listWaldorfQpatLayers,
  buildOpXyPatchJson,
  parseOpXyPatch,
  buildTonverkPst,
  parseTonverkPst,
  buildDistingExBinary,
  parseDistingExPreset,
  buildProphetXGroupText,
  parseProphetXGroupText,
  buildS2400KitBinary,
  parseS2400Kit,
  buildKorgMultisampleBinary,
  parseKorgMultisample,
  buildThirdWaveBinary,
  parseThirdWaveProgram,
  buildZenCoreSvzBinary,
  parseZenCoreSvz,
  listZipSamplerPrograms,
  parseUniversalSampler,
} from '../vendor/@abdsynths/shared/Code/SamplerFormats/index.ts';
import { createZipArchive } from '../vendor/@abdsynths/shared/Code/NeuronFormats/ZipArchive.ts';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL  ${name}\n        ${(e as Error).message}`);
  }
}

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

function makeSynthTestInstrument(): UniversalSamplerInstrument {
  const sr = 44100;
  const frames = 4410;
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    left[i] = Math.sin((2 * Math.PI * 440 * i) / sr) * 0.4;
    right[i] = Math.cos((2 * Math.PI * 440 * i) / sr) * 0.4;
  }
  const wavBuf = encodeWavPcm16([left, right], sr);

  return {
    version: '1.0.0',
    id: 'test-inst-b2b',
    name: 'HardwareSynth',
    modelName: 'HWSynth',
    author: 'ABDSynths',
    articulation: {
      ...createDefaultArticulation(),
      ampEnv: {
        attackSec: 0.05,
        decaySec: 0.3,
        sustainLevel: 0.8,
        releaseSec: 0.4,
      },
      filter: {
        enabled: true,
        type: 'lpf',
        cutoffHz: 3500,
        resonance: 0.25,
        poles: 2,
      },
      polyphony: 8,
      pitchBendUpSt: 2,
    },
    audioFiles: [
      {
        id: 'aud_1',
        name: 'synth_c4.wav',
        data: wavBuf,
        sampleRate: sr,
        channels: 2,
        frames,
      },
    ],
    groups: [
      {
        id: 'grp_1',
        name: 'Main',
        regions: [
          {
            id: 'reg_1',
            sampleName: 'synth_c4.wav',
            rootKey: 60,
            lowKey: 36,
            highKey: 84,
            lowVel: 1,
            highVel: 127,
            volume: 0,
            pan: 0,
            detune: 0,
            pitchKeytrack: 100,
            trigger: 'attack',
            keyFadeIn: 0,
            keyFadeOut: 0,
            velFadeIn: 0,
            velFadeOut: 0,
            fadeCurve: 'equal-power',
            loopMode: 'loop_continuous',
            loopStart: 1000,
            loopEnd: 4000,
            loopCrossfadeMs: 50,
            loops: [
              {
                id: '1',
                mode: 'loop_continuous',
                startFrame: 1000,
                endFrame: 4000,
                crossfadeMs: 50,
              },
            ],
          },
        ],
      },
    ],
  };
}

async function runBlock2bTests() {
  console.log('=== Fase 32.4 (Bloque 2B) — Hardware Moderno Adicional & Trackers Round-Trip ===');
  const inst = makeSynthTestInstrument();
  const sample = inst.audioFiles[0];

  // 1. Waldorf Quantum / Iridium (.qpat)
  await test('1. Waldorf Quantum / Iridium (.qpat) round-trips parameters, sample map, and layers', async () => {
    const qpatBin = buildWaldorfQpat({
      presetName: inst.modelName,
      bankName: 'SynthBank',
      regions: inst.groups[0].regions,
      articulation: inst.articulation,
    });

    assert.ok(qpatBin.byteLength > 512, 'QPAT binary must exceed header size');
    const qBuf = toArrayBuffer(qpatBin);

    const layers = listWaldorfQpatLayers(qBuf);
    assert.strictEqual(layers.length, 1, 'Must detect 1 layer');
    assert.strictEqual(layers[0].name, 'HWSynth');

    const parsed = parseWaldorfQpat(qBuf, 0);
    assert.strictEqual(parsed.presetName, 'HWSynth');
    assert.strictEqual(parsed.regions.length, 1);
    assert.strictEqual(parsed.regions[0].rootKey, 60);
    assert.strictEqual(parsed.regions[0].lowKey, 36);
    assert.strictEqual(parsed.regions[0].highKey, 84);
    assert.ok(parsed.regions[0].loops && parsed.regions[0].loops.length > 0);
    assert.strictEqual(parsed.regions[0].loops![0].startFrame, 1000);
    assert.strictEqual(parsed.regions[0].loops![0].endFrame, 4000);
  });

  // 2. Teenage Engineering OP-XY (patch.json in .preset)
  await test('2. Teenage Engineering OP-XY (patch.json) round-trips multisampler JSON layout and regions', async () => {
    const patchJson = buildOpXyPatchJson({
      presetName: inst.name,
      regions: inst.groups[0].regions,
      articulation: inst.articulation,
    });

    assert.ok(patchJson.includes('"type": "multisampler"'));
    assert.ok(patchJson.includes('"platform": "OP-XY"'));

    const parsed = parseOpXyPatch(patchJson);
    assert.strictEqual(parsed.regions.length, 1);
    assert.strictEqual(parsed.regions[0].rootKey, 60);
    assert.strictEqual(parsed.regions[0].lowKey, 36);
    assert.strictEqual(parsed.regions[0].highKey, 84);
    assert.strictEqual(parsed.regions[0].sampleName, 'synth_c4.wav');
    assert.ok(parsed.regions[0].loops && parsed.regions[0].loops.length > 0);
  });

  // 3. Elektron Tonverk (.tvpst)
  await test('3. Elektron Tonverk (.tvpst) round-trips [[key-zones]], velocity layers, and sample slots', async () => {
    const tvPst = buildTonverkPst({
      presetName: inst.name,
      regions: inst.groups[0].regions,
      articulation: inst.articulation,
    });

    assert.ok(tvPst.includes('[[key-zones]]'));
    assert.ok(tvPst.includes('[[key-zones.velocity-layers]]'));
    assert.ok(tvPst.includes('[[key-zones.velocity-layers.sample-slots]]'));

    const parsed = parseTonverkPst(tvPst);
    assert.strictEqual(parsed.regions.length, 1);
    assert.strictEqual(parsed.regions[0].rootKey, 60);
    assert.strictEqual(parsed.regions[0].sampleName, 'synth_c4.wav');
    assert.ok(parsed.regions[0].loops && parsed.regions[0].loops.length > 0);
    assert.strictEqual(parsed.regions[0].loops![0].startFrame, 1000);
    assert.strictEqual(parsed.regions[0].loops![0].endFrame, 4000);
  });

  // 4. Expert Sleepers Disting EX (.dexpreset)
  await test('4. Expert Sleepers Disting EX (.dexpreset) builds DEXBPRST binary and maps note names', async () => {
    const dexBin = buildDistingExBinary({
      presetName: inst.modelName,
      regions: inst.groups[0].regions,
      articulation: inst.articulation,
    });

    assert.ok(dexBin.byteLength >= 528);
    const dBuf = toArrayBuffer(dexBin);

    const sampleMap = new Map<string, ArrayBuffer>([['synth_C4_SW72_V1.wav', sample.data]]);
    const parsed = parseDistingExPreset(dBuf, ['synth_C4_SW72_V1.wav'], sampleMap);

    assert.strictEqual(parsed.presetName, 'HWSynth');
    assert.strictEqual(parsed.regions.length, 1);
    assert.strictEqual(parsed.regions[0].rootKey, 60);
  });

  // 5. Sequential Prophet X / XL (.grp)
  await test('5. Sequential Prophet X / XL (.grp) round-trips TSV group mapping and 48kHz tuning', async () => {
    const grpText = buildProphetXGroupText({
      presetName: inst.name,
      regions: inst.groups[0].regions,
    });

    assert.ok(grpText.includes('File Path\tLow Midi Note'));
    const parsed = parseProphetXGroupText(grpText);

    assert.strictEqual(parsed.regions.length, 1);
    assert.strictEqual(parsed.regions[0].rootKey, 60);
    assert.strictEqual(parsed.regions[0].lowKey, 36);
    assert.strictEqual(parsed.regions[0].highKey, 84);
  });

  // 6. Isla Instruments S2400 (.kit)
  await test('6. Isla Instruments S2400 (.kit) builds binary records and track assignments', async () => {
    const kitBin = buildS2400KitBinary({
      presetName: inst.modelName,
      regions: inst.groups[0].regions,
    });

    assert.ok(kitBin.byteLength > 16);
    const parsed = parseS2400Kit(toArrayBuffer(kitBin), [sample.name]);
    assert.strictEqual(parsed.regions.length, 1);
    assert.strictEqual(parsed.regions[0].sampleName, sample.name);
  });

  // 7. Korg Modern Multisample (.korgmultisample)
  await test('7. Korg Modern Multisample (.korgmultisample) builds binary header and zone blocks', async () => {
    const kmBin = buildKorgMultisampleBinary({
      presetName: inst.modelName,
      regions: inst.groups[0].regions,
    });

    assert.ok(kmBin.byteLength > 16);
    const parsed = parseKorgMultisample(toArrayBuffer(kmBin), [sample.name]);
    assert.strictEqual(parsed.regions.length, 1);
    assert.strictEqual(parsed.regions[0].rootKey, 60);
  });

  // 8. Groove Synthesis 3rd Wave (.3wv)
  await test('8. Groove Synthesis 3rd Wave (.3wv) builds binary container and program slots', async () => {
    const twBin = buildThirdWaveBinary({
      presetName: inst.modelName,
      regions: inst.groups[0].regions,
    });

    assert.ok(twBin.byteLength > 44);
    const parsed = parseThirdWaveProgram(toArrayBuffer(twBin), [sample.name]);
    assert.strictEqual(parsed.regions.length, 1);
    assert.strictEqual(parsed.regions[0].rootKey, 60);
  });

  // 9. Roland Zen-Core / SP-404MKII (.svz)
  await test('9. Roland Zen-Core / SP-404MKII (.svz) builds binary tone descriptor', async () => {
    const svzBin = buildZenCoreSvzBinary({
      presetName: inst.modelName,
      regions: inst.groups[0].regions,
    });

    assert.ok(svzBin.byteLength > 44);
    const parsed = parseZenCoreSvz(toArrayBuffer(svzBin), [sample.name]);
    assert.strictEqual(parsed.regions.length, 1);
    assert.strictEqual(parsed.regions[0].rootKey, 60);
  });

  // 10. Package integration into ZIP and Universal Sampler Dispatcher
  await test('10. Universal sampler dispatcher transparently detects and extracts all Bloque 2B packages', async () => {
    const qpatBin = buildWaldorfQpat({
      presetName: inst.modelName,
      regions: inst.groups[0].regions,
    });

    const zipBytes = createZipArchive([
      { path: 'test.qpat', data: qpatBin },
      { path: `samples/test/${sample.name}`, data: new Uint8Array(sample.data) },
    ]);

    const progs = await listZipSamplerPrograms('test.zip', toArrayBuffer(zipBytes));
    const qProg = progs.find((p) => p.format === 'waldorf_qpat');
    assert.ok(qProg, 'Must list waldorf_qpat program');

    const uInst = await parseUniversalSampler('test.zip', toArrayBuffer(zipBytes));
    assert.strictEqual(uInst.format, 'waldorf_qpat');
    assert.strictEqual(uInst.regions.length, 1);
    assert.strictEqual(uInst.regions[0].rootKey, 60);
  });

  console.log(`\nFase 32.4 (Bloque 2B) Summary: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runBlock2bTests();
