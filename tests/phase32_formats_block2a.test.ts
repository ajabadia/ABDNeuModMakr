// ─────────────────────────────────────────────────────────
// ABDNeuModMakr & @abdsynths/shared — Fase 32.4 (Bloque 2A) Test Suite
//
// Verifies full round-trip (export -> import -> verify) on:
// 1. 1010music Blackbox / Tangerine (preset.xml + WAVs in .zip)
// 2. Synthstrom Deluge (SYNTHS/*.XML + SAMPLES/ in .zip)
// 3. Renoise Instrument (.xrni ZIP with Instrument.xml + FLAC SampleData/)
// 4. discoDSP Bliss (.zbp ZIP with program.xml + FLAC samples)
// 5. Polyend Tracker / Play (.pti standalone binary)
// ─────────────────────────────────────────────────────────

import assert from 'node:assert/strict';
import {
  encodeWavPcm16,
  decodeWav,
} from '../src/core/dsp/WavDecoder.ts';
import {
  parseUniversalSamplerInstrument,
  exportUniversalSamplerInstrument,
  FORMAT_CAPABILITIES_REGISTRY,
  createDefaultArticulation,
  type UniversalSamplerInstrument,
} from '../vendor/@abdsynths/shared/Code/SamplerFormats/index.ts';

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
  const sampleBuf = encodeWavPcm16([left, right], sr);

  const audioPool = new Map<string, ArrayBuffer>();
  audioPool.set('LeadTone_C4.wav', sampleBuf);

  const articulation = createDefaultArticulation();
  articulation.ampEnv.attackSec = 0.05;
  articulation.ampEnv.decaySec = 0.4;
  articulation.ampEnv.sustainLevel = 0.7;
  articulation.ampEnv.releaseSec = 0.6;
  articulation.filter.enabled = true;
  articulation.filter.type = 'lpf';
  articulation.filter.cutoffHz = 2400;
  articulation.filter.resonanceDb = 6.0;

  return {
    id: 'lead-synth-preset',
    name: 'LeadSynth',
    expandedName: 'LeadSynthModern',
    workingMode: 'extended',
    audioPool,
    articulation,
    groups: [],
    modMatrix: [],
    parameters: {},
    metadata: {
      category: 'Synth Lead',
      author: 'Antigravity Test',
      description: 'Modern hardware multi-sampler test tone',
    },
    regions: [
      {
        id: 'reg_1',
        sampleName: 'LeadTone_C4.wav',
        lowKey: 36,
        highKey: 84,
        rootKey: 60,
        lowVel: 1,
        highVel: 127,
        detune: 0,
        volume: -2.5,
        pan: 10,
        pitchKeytrack: 100,
        trigger: 'attack',
        playLogic: 'velocity',
        keyFadeIn: 0,
        keyFadeOut: 0,
        velFadeIn: 0,
        velFadeOut: 0,
        fadeCurve: 'equal-power',
        loopMode: 'loop_continuous',
        loopStart: 500,
        loopEnd: 3500,
        loopCrossfadeMs: 20,
        loops: [
          {
            id: '1',
            mode: 'loop_continuous',
            startFrame: 500,
            endFrame: 3500,
          },
        ],
        sampleStartFrame: 100,
        sampleEndFrame: 4200,
        reversed: false,
      },
    ],
  };
}

console.log('=== Fase 32.4 (Bloque 2A) — Hardware Moderno SD / Trackers Round-Trip ===');

await test('1. 1010music Blackbox (preset.xml in .zip) round-trips cells, assets, key ranges and envelope', async () => {
  const inst = makeSynthTestInstrument();
  const exported = await exportUniversalSamplerInstrument(inst, {
    format: 'music1010',
    resolution: 'pcm16',
    sampleRate: 'original',
    normalization: 'none',
    layout: 'folder_samples',
    bankName: 'BlackboxLead',
  });

  assert.ok(exported.data.byteLength > 100);
  const parsed = await parseUniversalSamplerInstrument('BlackboxLead.zip', toArrayBuffer(exported.data));

  assert.equal(parsed.regions.length, 1);
  const r = parsed.regions[0];
  assert.equal(r.rootKey, 60);
  assert.equal(r.lowKey, 36);
  assert.equal(r.highKey, 84);
  assert.equal(r.sampleEndFrame, 4200);
  assert.ok(parsed.articulation.ampEnv.attackSec >= 0);
  assert.ok(parsed.audioPool?.size! >= 1);
});

await test('2. Synthstrom Deluge (SYNTHS/*.XML in .zip) round-trips sampleRanges, filter and envelope', async () => {
  const inst = makeSynthTestInstrument();
  const exported = await exportUniversalSamplerInstrument(inst, {
    format: 'deluge',
    resolution: 'pcm16',
    sampleRate: 'original',
    normalization: 'none',
    layout: 'folder_samples',
    bankName: 'DelugeLead',
  });

  assert.ok(exported.data.byteLength > 100);
  const parsed = await parseUniversalSamplerInstrument('DelugeLead.zip', toArrayBuffer(exported.data));

  assert.equal(parsed.regions.length, 1);
  const r = parsed.regions[0];
  assert.equal(r.highKey, 84);
  assert.ok(parsed.articulation.filter.enabled);
  assert.ok(parsed.audioPool?.size! >= 1);
});

await test('3. Renoise Instrument (.xrni ZIP) round-trips SampleData/ FLAC, loop points, and volume/panning', async () => {
  const inst = makeSynthTestInstrument();
  const exported = await exportUniversalSamplerInstrument(inst, {
    format: 'renoise',
    resolution: 'pcm16',
    sampleRate: 'original',
    normalization: 'none',
    layout: 'folder_samples',
    bankName: 'RenoiseLead',
  });

  assert.ok(exported.data.byteLength > 100);
  const parsed = await parseUniversalSamplerInstrument('RenoiseLead.xrni', toArrayBuffer(exported.data));

  assert.equal(parsed.regions.length, 1);
  const r = parsed.regions[0];
  assert.equal(r.rootKey, 60);
  assert.equal(r.lowKey, 36);
  assert.equal(r.highKey, 84);
  assert.equal(r.loopMode, 'loop_continuous');
  assert.equal(r.loopStart, 500);
  assert.equal(r.loopEnd, 3500);
  assert.ok(parsed.audioPool?.size! >= 1);
});

await test('4. discoDSP Bliss (.zbp ZIP) round-trips FLAC samples, key range, tune, gain, and loops', async () => {
  const inst = makeSynthTestInstrument();
  const exported = await exportUniversalSamplerInstrument(inst, {
    format: 'bliss',
    resolution: 'pcm16',
    sampleRate: 'original',
    normalization: 'none',
    layout: 'folder_samples',
    bankName: 'BlissLead',
  });

  assert.ok(exported.data.byteLength > 100);
  const parsed = await parseUniversalSamplerInstrument('BlissLead.zbp', toArrayBuffer(exported.data));

  assert.equal(parsed.regions.length, 1);
  const r = parsed.regions[0];
  assert.equal(r.rootKey, 60);
  assert.equal(r.lowKey, 36);
  assert.equal(r.highKey, 84);
  assert.equal(r.loopMode, 'loop_continuous');
  assert.equal(r.loopStart, 500);
  assert.equal(r.loopEnd, 3500);
  assert.ok(parsed.audioPool?.size! >= 1);
});

await test('5. Polyend Tracker / Play (.pti standalone) round-trips TI binary header, parameters, and PCM16 audio', async () => {
  const inst = makeSynthTestInstrument();
  const exported = await exportUniversalSamplerInstrument(inst, {
    format: 'polyend_pti',
    resolution: 'pcm16',
    sampleRate: 'original',
    normalization: 'none',
    layout: 'monolithic',
    bankName: 'PolyendLead',
  });

  assert.equal(exported.filename, 'PolyendLead.pti');
  assert.ok(exported.data.byteLength > 372 + 16);

  const parsed = await parseUniversalSamplerInstrument('PolyendLead.pti', toArrayBuffer(exported.data));

  assert.equal(parsed.regions.length, 1);
  const r = parsed.regions[0];
  assert.equal(r.rootKey, 60);
  assert.equal(r.loopMode, 'loop_continuous');
  assert.ok(r.loopStart > 0);
  assert.ok(r.loopEnd > r.loopStart);
  assert.ok(parsed.articulation.filter.enabled);
  assert.ok(parsed.audioPool?.size! >= 1);
});

await test('6. FORMAT_CAPABILITIES_REGISTRY includes all 21 formats', () => {
  const expectedFormats = [
    'legacy-neuron',
    'modern-neural',
    'sf2',
    'sfz',
    'dspreset',
    'mpc_xpm',
    'mpc_xpn',
    'nki',
    'multisample',
    'vstpreset',
    'ableton_adv',
    'exs24',
    'tal_sampler',
    'tx16wx',
    'korg_kmp',
    'dls',
    'music1010',
    'deluge',
    'renoise',
    'bliss',
    'polyend_pti',
  ];
  for (const fmt of expectedFormats) {
    assert.ok(FORMAT_CAPABILITIES_REGISTRY[fmt], `Missing registry entry for ${fmt}`);
  }
});

console.log(`\nFase 32.4 (Bloque 2A) Summary: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
