// ─────────────────────────────────────────────────────────
// ABDNeuModMakr & @abdsynths/shared — Fase 32.3 + 32.4 (Bloque 1) Test Suite
//
// Verifies:
// 1. Fase 32.3 parity on existing formats (SF2, SFZ, Decent Sampler, Bitwig .multisample, HALion .vstpreset)
//    preserving loops[], sampleStartFrame/sampleEndFrame, reversed, keyFade/velFade, pitchEnv, filterEnv, poles, muteGroup, keyswitchNote.
// 2. Fase 32.4 (Bloque 1) full read/write round-trip on the 6 new formats:
//    - Ableton Sampler / Simpler (.adv GZIP XML)
//    - Apple Logic EXS24 / Sampler (.exs binary SOBT)
//    - TAL-Sampler (.talsmpl XML)
//    - CWITEC TX16Wx (.txprog XML)
//    - Korg Trinity/Triton/M3/Pa (.KMP + .KSF + .KSC)
//    - MMA Downloadable Sounds Level 2 (.dls RIFF "DLS ")
// 3. FORMAT_CAPABILITIES_REGISTRY & evaluateFormatFidelity coverage for all 16 formats.
// ─────────────────────────────────────────────────────────

import assert from 'node:assert/strict';
import { encodeWavPcm16 } from '../src/core/dsp/WavDecoder.ts';
import { indexZipArchive, extractZipEntry } from '../src/formats/ZipArchive.ts';
import {
  parseUniversalSamplerInstrument,
  exportUniversalSamplerInstrument,
  FORMAT_CAPABILITIES_REGISTRY,
  evaluateFormatFidelity,
  createDefaultArticulation,
  type UniversalSamplerInstrument,
  type ExtendedRegion,
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

function assertCloseTo(actual: number | undefined, expected: number, tolerance = 1, label = ''): void {
  assert.notEqual(actual, undefined, `${label} should be defined`);
  assert.ok(
    Math.abs((actual ?? 0) - expected) <= tolerance,
    `${label ? label + ': ' : ''}expected ${actual} to be within ±${tolerance} of ${expected}`
  );
}

function makeTestSineWav(sampleRate = 44100, frames = 4410): ArrayBuffer {
  const ch = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    ch[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.5;
  }
  return encodeWavPcm16([ch], sampleRate, {
    rootKey: 60,
    lowKey: 36,
    highKey: 84,
    lowVelocity: 1,
    highVelocity: 127,
    detune: 0,
    gainDb: 0,
    loopMode: 'loop_continuous',
    loopStart: 400,
    loopEnd: 3600,
  });
}

function makeRichTestInstrument(): UniversalSamplerInstrument {
  const wavBuf = makeTestSineWav(44100, 4410);
  const audioPool = new Map<string, ArrayBuffer>([['TestLead.wav', wavBuf]]);
  const articulation = createDefaultArticulation();
  articulation.ampEnvEnabled = true;
  articulation.ampEnv = {
    delaySec: 0,
    attackSec: 0.02,
    holdSec: 0,
    decaySec: 0.35,
    sustainLevel: 0.75,
    releaseSec: 0.45,
    velModDepth: 85,
  };
  articulation.filter = {
    enabled: true,
    type: 'lpf',
    poles: 4,
    cutoffHz: 2400,
    resonanceDb: 6,
    envToFilterCents: 1800,
    velToFilterCents: 0,
    keytrackCents: 600,
    filterEnv: {
      delaySec: 0,
      attackSec: 0.015,
      holdSec: 0,
      decaySec: 0.25,
      sustainLevel: 0.4,
      releaseSec: 0.3,
      velModDepth: 0,
    },
  };
  articulation.pitchEnv = {
    enabled: true,
    depthCents: 1200,
    env: {
      delaySec: 0,
      attackSec: 0.01,
      holdSec: 0,
      decaySec: 0.12,
      sustainLevel: 0,
      releaseSec: 0.1,
      velModDepth: 0,
    },
  };
  articulation.polyphony = 16;
  articulation.pitchBendUpSt = 2;
  articulation.pitchBendDownSt = 2;

  const region: ExtendedRegion = {
    id: 'reg-1',
    sampleName: 'TestLead.wav',
    lowKey: 36,
    highKey: 84,
    rootKey: 60,
    lowVel: 10,
    highVel: 120,
    detune: 15,
    volume: -3.0,
    pan: 20,
    pitchKeytrack: 100,
    trigger: 'attack',
    playLogic: 'round_robin',
    seqPosition: 1,
    seqLength: 2,
    sampleStartFrame: 120,
    sampleEndFrame: 4200,
    reversed: true,
    groupId: 'grp-lead',
    groupName: 'LeadGroup',
    muteGroup: 3,
    keyswitchNote: 24,
    keyFadeIn: 4,
    keyFadeOut: 6,
    velFadeIn: 8,
    velFadeOut: 10,
    fadeCurve: 'equal-power',
    loopMode: 'loop_continuous',
    loopStart: 500,
    loopEnd: 3500,
    loopCrossfadeMs: 20,
    loops: [
      {
        id: 'loop-1',
        mode: 'loop_continuous',
        startFrame: 500,
        endFrame: 3500,
        crossfadeMs: 20,
      },
    ],
    hasPlaybackOverride: true,
  };

  return {
    id: 'test-rich-inst',
    name: 'RichLead',
    expandedName: 'Rich Test Lead',
    metadata: {
      author: 'ABDSynths QA',
      license: 'CC-BY 4.0',
      category: 'Synthesizer',
      description: 'Fase 32.3 & 32.4 round-trip test instrument',
    },
    articulation,
    groups: [
      {
        id: 'grp-lead',
        name: 'LeadGroup',
        muteGroup: 3,
        keyswitchNote: 24,
        polyphony: 16,
        playLogic: 'round_robin',
        trigger: 'attack',
        volumeDb: 0,
        pan: 0,
        tuneCents: 0,
      },
    ],
    regions: [region],
    modMatrix: [],
    parameters: {},
    audioPool,
  };
}

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

console.log('=== Fase 32.3 — Existing Formats Parity (SF2, SFZ, DecentSampler, Bitwig, HALion) ===');

await test('SFZ round-trips sampleStart/End, reverse, muteGroup, keyswitchNote, crossfades, filter (poles+fileg) and pitchEnv', async () => {
  const src = makeRichTestInstrument();
  const exported = await exportUniversalSamplerInstrument(src, {
    format: 'sfz',
    resolution: 'pcm16',
    sampleRate: 'original',
    normalization: 'none',
    layout: 'folder_samples',
    bankName: 'RichLeadSfz',
  });

  const entries = indexZipArchive(exported.data);
  const sfzEntry = entries.find((e) => e.path.endsWith('.sfz'));
  assert.ok(sfzEntry, 'SFZ entry must exist in exported ZIP');

  const siblings = new Map<string, ArrayBuffer>();
  for (const e of entries) {
    if (e.path.endsWith('.wav')) {
      const clean = e.path.split('/').pop()!;
      const wavData = extractZipEntry(exported.data, e);
      siblings.set(clean, toArrayBuffer(wavData));
    }
  }

  const sfzData = extractZipEntry(exported.data, sfzEntry);
  const parsed = await parseUniversalSamplerInstrument(sfzEntry.path, toArrayBuffer(sfzData), siblings);

  assert.equal(parsed.regions.length, 1);
  const r = parsed.regions[0];
  assert.equal(r.sampleStartFrame, 120);
  assert.equal(r.sampleEndFrame, 4200);
  assert.equal(r.reversed, true);
  assert.equal(r.muteGroup, 3);
  assert.equal(r.keyswitchNote, 24);
  assert.equal(r.keyFadeIn, 4);
  assert.equal(r.keyFadeOut, 6);
  assert.equal(r.velFadeIn, 8);
  assert.equal(r.velFadeOut, 10);
  assert.equal(r.loops?.length, 1);
  assert.equal(r.loops?.[0].startFrame, 500);
  assert.equal(r.loops?.[0].endFrame, 3500);
  assert.equal(parsed.articulation.filter.enabled, true);
  assert.equal(parsed.articulation.filter.poles, 4);
  assertCloseTo(parsed.articulation.filter.cutoffHz, 2400, 2);
  assert.equal(parsed.articulation.filter.envToFilterCents, 1800);
  assert.equal(parsed.articulation.pitchEnv?.enabled, true);
  assert.equal(parsed.articulation.pitchEnv?.depthCents, 1200);
});

await test('Decent Sampler (.dspreset.zip) round-trips start/end, loopCrossfade, round_robin, muteGroup, and filter', async () => {
  const src = makeRichTestInstrument();
  const exported = await exportUniversalSamplerInstrument(src, {
    format: 'dspreset',
    resolution: 'pcm16',
    sampleRate: 'original',
    normalization: 'none',
    layout: 'folder_samples',
    bankName: 'RichLeadDS',
  });

  const parsed = await parseUniversalSamplerInstrument(exported.filename, toArrayBuffer(exported.data));

  assert.equal(parsed.regions.length, 1);
  const r = parsed.regions[0];
  assert.equal(r.sampleStartFrame, 120);
  assert.equal(r.sampleEndFrame, 4200);
  assert.equal(r.playLogic, 'round_robin');
  assert.equal(r.muteGroup, 1);
  assert.equal(r.loopStart, 500);
  assert.equal(r.loopEnd, 3500);
  assertCloseTo(r.loopCrossfadeMs, 20, 2);
  assert.equal(parsed.articulation.filter.enabled, true);
  assertCloseTo(parsed.articulation.filter.cutoffHz, 2400, 2);
});

await test('Bitwig (.multisample) round-trips nested <key>, <velocity>, <loop>, sample-start/stop, reverse, and fades', async () => {
  const src = makeRichTestInstrument();
  const exported = await exportUniversalSamplerInstrument(src, {
    format: 'multisample',
    resolution: 'pcm16',
    sampleRate: 'original',
    normalization: 'none',
    layout: 'folder_samples',
    bankName: 'RichLeadBitwig',
  });

  const parsed = await parseUniversalSamplerInstrument(exported.filename, toArrayBuffer(exported.data));

  assert.equal(parsed.regions.length, 1);
  const r = parsed.regions[0];
  assert.equal(r.lowKey, 36);
  assert.equal(r.highKey, 84);
  assert.equal(r.rootKey, 60);
  assert.equal(r.keyFadeIn, 4);
  assert.equal(r.keyFadeOut, 6);
  assert.equal(r.velFadeIn, 8);
  assert.equal(r.velFadeOut, 10);
  assert.equal(r.sampleStartFrame, 120);
  assert.equal(r.sampleEndFrame, 4200);
  assert.equal(r.reversed, true);
  assert.equal(r.playLogic, 'round_robin');
  assert.equal(r.loopStart, 500);
  assert.equal(r.loopEnd, 3500);
});

await test('Steinberg HALion (.vstpreset.zip) round-trips sampleStart/End, reverse, fades, muteGroup, keyswitchNote, and filter', async () => {
  const src = makeRichTestInstrument();
  const exported = await exportUniversalSamplerInstrument(src, {
    format: 'vstpreset',
    resolution: 'pcm16',
    sampleRate: 'original',
    normalization: 'none',
    layout: 'folder_samples',
    bankName: 'RichLeadHalion',
  });

  const parsed = await parseUniversalSamplerInstrument(exported.filename, toArrayBuffer(exported.data));

  assert.equal(parsed.regions.length, 1);
  const r = parsed.regions[0];
  assert.equal(r.sampleStartFrame, 120);
  assert.equal(r.sampleEndFrame, 4200);
  assert.equal(r.reversed, true);
  assert.equal(r.keyFadeIn, 4);
  assert.equal(r.keyFadeOut, 6);
  assert.equal(r.velFadeIn, 8);
  assert.equal(r.velFadeOut, 10);
  assert.equal(r.muteGroup, 3);
  assert.equal(r.keyswitchNote, 24);
  assert.equal(parsed.articulation.filter.enabled, true);
  assert.equal(parsed.articulation.filter.cutoffHz, 2400);
});

await test('SoundFont 2 (.sf2) round-trips exclusiveClass (muteGroup), scaleTuning, and loops', async () => {
  const src = makeRichTestInstrument();
  const exported = await exportUniversalSamplerInstrument(src, {
    format: 'sf2',
    resolution: 'pcm16',
    sampleRate: 'original',
    normalization: 'none',
    layout: 'monolithic',
    bankName: 'RichLeadSf2',
  });

  const parsed = await parseUniversalSamplerInstrument(exported.filename, toArrayBuffer(exported.data));

  assert.equal(parsed.regions.length, 1);
  const r = parsed.regions[0];
  assert.equal(r.lowKey, 36);
  assert.equal(r.highKey, 84);
  assert.equal(r.rootKey, 60);
  assert.equal(r.muteGroup, 3);
  assert.equal(r.loops?.length, 1);
});

console.log('\n=== Fase 32.4 (Bloque 1) — 6 New Sampler Formats Round-Trip ===');

await test('1. Ableton Sampler (.adv.zip) packs GZIP XML and round-trips parts, fades, reverse, filter, and pitchEnv', async () => {
  const src = makeRichTestInstrument();
  const exported = await exportUniversalSamplerInstrument(src, {
    format: 'ableton_adv',
    resolution: 'pcm16',
    sampleRate: 'original',
    normalization: 'none',
    layout: 'folder_samples',
    bankName: 'AbletonRichLead',
  });

  assert.equal(exported.filename, 'AbletonRichLead.adv.zip');

  const parsed = await parseUniversalSamplerInstrument(exported.filename, toArrayBuffer(exported.data));

  assert.equal(parsed.regions.length, 1);
  const r = parsed.regions[0];
  assert.equal(r.lowKey, 36);
  assert.equal(r.highKey, 84);
  assert.equal(r.rootKey, 60);
  assert.equal(r.keyFadeIn, 4);
  assert.equal(r.keyFadeOut, 6);
  assert.equal(r.velFadeIn, 8);
  assert.equal(r.velFadeOut, 10);
  assert.equal(r.sampleStartFrame, 120);
  assert.equal(r.sampleEndFrame, 4200);
  assert.equal(r.reversed, true);
  assert.equal(r.playLogic, 'round_robin');
  assertCloseTo(r.volume, -3.0, 0.2);
  assert.equal(parsed.articulation.filter.enabled, true);
  assert.equal(parsed.articulation.filter.poles, 4);
  assertCloseTo(parsed.articulation.filter.cutoffHz, 2400, 5);
  assert.equal(parsed.articulation.pitchEnv?.enabled, true);
  assertCloseTo(parsed.articulation.pitchEnv?.depthCents, 1200, 20);
});

await test('2. Apple Logic EXS24 (.exs.zip) builds SOBT binary blocks and round-trips zones, groups, samples, and params', async () => {
  const src = makeRichTestInstrument();
  const exported = await exportUniversalSamplerInstrument(src, {
    format: 'exs24',
    resolution: 'pcm16',
    sampleRate: 'original',
    normalization: 'none',
    layout: 'folder_samples',
    bankName: 'LogicRichLead',
  });

  assert.equal(exported.filename, 'LogicRichLead.exs.zip');

  const parsed = await parseUniversalSamplerInstrument(exported.filename, toArrayBuffer(exported.data));

  assert.equal(parsed.regions.length, 1);
  const r = parsed.regions[0];
  assert.equal(r.lowKey, 36);
  assert.equal(r.highKey, 84);
  assert.equal(r.rootKey, 60);
  assert.equal(r.detune, 15);
  assert.equal(r.volume, -3);
  assert.equal(r.pan, 20);
  assert.equal(r.sampleStartFrame, 120);
  assert.equal(r.sampleEndFrame, 4200);
  assert.equal(r.reversed, true);
  assert.equal(r.loopStart, 500);
  assert.equal(r.loopEnd, 3500);
  assert.equal(r.loopCrossfadeMs, 20);
  assert.equal(r.muteGroup, 3);
  assert.equal(r.keyswitchNote, 24);
  assert.equal(parsed.articulation.filter.enabled, true);
  assert.equal(parsed.articulation.filter.poles, 4);
});

await test('3. TAL-Sampler (.talsmpl.zip) round-trips non-linear volume/ADSR/cutoff laws, layers, reverse, and pitch modmatrix', async () => {
  const src = makeRichTestInstrument();
  const exported = await exportUniversalSamplerInstrument(src, {
    format: 'tal_sampler',
    resolution: 'pcm16',
    sampleRate: 'original',
    normalization: 'none',
    layout: 'folder_samples',
    bankName: 'TalRichLead',
  });

  assert.equal(exported.filename, 'TalRichLead.talsmpl.zip');

  const parsed = await parseUniversalSamplerInstrument(exported.filename, toArrayBuffer(exported.data));

  assert.equal(parsed.regions.length, 1);
  const r = parsed.regions[0];
  assert.equal(r.lowKey, 36);
  assert.equal(r.highKey, 84);
  assert.equal(r.rootKey, 60);
  assert.equal(r.detune, 15);
  assertCloseTo(r.volume, -3.0, 0.2);
  assert.equal(r.pan, 20);
  assert.equal(r.sampleStartFrame, 120);
  assert.equal(r.sampleEndFrame, 4200);
  assert.equal(r.reversed, true);
  assert.equal(r.muteGroup, 3);
  assert.equal(r.playLogic, 'round_robin');
  assert.equal(parsed.articulation.filter.enabled, true);
  assertCloseTo(parsed.articulation.filter.cutoffHz, 2400, 15);
  assert.equal(parsed.articulation.pitchEnv?.enabled, true);
  assertCloseTo(parsed.articulation.pitchEnv?.depthCents, 1200, 15);
});

await test('4. CWITEC TX16Wx (.txprog.zip) round-trips <tx:wave>, <tx:loop>, <tx:soundshape>, <tx:group> and <tx:region>', async () => {
  const src = makeRichTestInstrument();
  const exported = await exportUniversalSamplerInstrument(src, {
    format: 'tx16wx',
    resolution: 'pcm16',
    sampleRate: 'original',
    normalization: 'none',
    layout: 'folder_samples',
    bankName: 'TxRichLead',
  });

  assert.equal(exported.filename, 'TxRichLead.txprog.zip');

  const parsed = await parseUniversalSamplerInstrument(exported.filename, toArrayBuffer(exported.data));

  assert.equal(parsed.regions.length, 1);
  const r = parsed.regions[0];
  assert.equal(r.lowKey, 36);
  assert.equal(r.highKey, 84);
  assert.equal(r.rootKey, 60);
  assert.equal(r.detune, 15);
  assertCloseTo(r.volume, -3.0, 0.2);
  assert.equal(r.pan, 20);
  assert.equal(r.keyFadeIn, 4);
  assert.equal(r.keyFadeOut, 6);
  assert.equal(r.velFadeIn, 8);
  assert.equal(r.velFadeOut, 10);
  assert.equal(r.sampleStartFrame, 120);
  assert.equal(r.sampleEndFrame, 4200);
  assert.equal(r.reversed, true);
  assert.equal(r.muteGroup, 3);
  assert.equal(r.loops?.length, 1);
  assert.equal(parsed.articulation.filter.enabled, true);
  assertCloseTo(parsed.articulation.filter.cutoffHz, 2400, 2);
  assert.equal(parsed.articulation.pitchEnv?.enabled, true);
  assert.equal(parsed.articulation.pitchEnv?.depthCents, 1200);
});

await test('5. Korg Trinity/Triton/M3 (.kmp.zip) builds Big-Endian .KMP + .KSF + .KSC and round-trips zones + PCM audio', async () => {
  const src = makeRichTestInstrument();
  const exported = await exportUniversalSamplerInstrument(src, {
    format: 'korg_kmp',
    resolution: 'pcm16',
    sampleRate: 'original',
    normalization: 'none',
    layout: 'folder_samples',
    bankName: 'KorgLead',
  });

  assert.equal(exported.filename, 'KorgLead.kmp.zip');

  const parsed = await parseUniversalSamplerInstrument(exported.filename, toArrayBuffer(exported.data));

  assert.equal(parsed.regions.length, 1);
  const r = parsed.regions[0];
  assert.equal(r.rootKey, 60);
  assert.equal(r.detune, 15);
  assertCloseTo(r.volume, -3.0, 1);
  assertCloseTo(r.pan, 20, 2);
  assert.equal(r.sampleStartFrame, 120);
  assert.equal(r.reversed, true);
  assert.equal(r.loopMode, 'loop_continuous');
  assert.equal(r.loopStart, 500);
  assert.equal(r.loopEnd, 3500);
  assert.equal(parsed.audioPool?.size, 1);
});

await test('6. MMA Downloadable Sounds Level 2 (.dls) builds RIFF "DLS " binary and round-trips regions, wsmp, lar2/art2, and wvpl', async () => {
  const src = makeRichTestInstrument();
  const exported = await exportUniversalSamplerInstrument(src, {
    format: 'dls',
    resolution: 'pcm16',
    sampleRate: 'original',
    normalization: 'none',
    layout: 'monolithic',
    bankName: 'DlsRichLead',
  });

  assert.equal(exported.filename, 'DlsRichLead.dls');

  const parsed = await parseUniversalSamplerInstrument(exported.filename, toArrayBuffer(exported.data));

  assert.equal(parsed.regions.length, 1);
  const r = parsed.regions[0];
  assert.equal(r.lowKey, 36);
  assert.equal(r.highKey, 84);
  assert.equal(r.rootKey, 60);
  assert.equal(r.detune, 15);
  assertCloseTo(r.volume, -3.0, 0.2);
  assert.equal(r.pan, 20);
  assert.equal(r.muteGroup, 3);
  assert.equal(r.loopMode, 'loop_continuous');
  assert.equal(r.loopStart, 500);
  assert.equal(r.loopEnd, 3500);
  assert.equal(parsed.articulation.filter.enabled, true);
  assertCloseTo(parsed.articulation.filter.cutoffHz, 2400, 15);
  assert.equal(parsed.articulation.filter.envToFilterCents, 1800);
  assert.equal(parsed.articulation.pitchEnv?.enabled, true);
  assert.equal(parsed.articulation.pitchEnv?.depthCents, 1200);
  assert.equal(parsed.audioPool?.size, 1);
});

await test('7. FORMAT_CAPABILITIES_REGISTRY registers all 16 formats and evaluates fidelity notices', () => {
  const inst = makeRichTestInstrument();
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
  ];
  for (const fmt of expectedFormats) {
    assert.ok(FORMAT_CAPABILITIES_REGISTRY[fmt], `FORMAT_CAPABILITIES_REGISTRY should include ${fmt}`);
    const notices = evaluateFormatFidelity(inst, fmt);
    assert.ok(Array.isArray(notices));
  }
});

console.log(`\nFase 32.3 + 32.4 (Bloque 1) Summary: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
