// ─────────────────────────────────────────────────────────────────────────────
// ABDNeuModMakr — Fase 22 Advanced Professional Sampler Suite Tests
//
// Verification of:
//   1. Round-Robin Articulation & PlayLogic (sequential cycle, random anti-repeat)
//   2. Release Triggers & Key-Off note resolution in Extended Mode
//   3. Advanced Filename Regex Auto-Mapping (dynamics pp..ff, keys, velocity, RR, release)
//   4. Multi-sample collection contiguous key spread & neighbor interpolation
//   5. Scala (.scl) microtuning scale parser (cents, ratios, degree counts)
//   6. 128-note microtuning table frequency derivation & 12-TET cents offset
//   7. MIDI Modulation Matrix routing (ModWheel, Expression, Velocity, Cutoff, Pitch)
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseScalaScale,
  createMicrotuningTable,
  autoMapSampleFilename,
  autoMapSampleCollection,
  SamplerArticulationEngine,
  type ExtendedRegion,
} from '../vendor/@abdsynths/shared/Code/SamplerFormats/index.ts';

import { resolveExtendedNoteTargets } from '../src/core/noteMapping.ts';

test('Fase 22 — Suite de Funcionalidades Avanzadas de Sampler Profesional', async (t) => {
  await t.test('1. Round-Robin state cycling and selection logic', () => {
    const engine = new SamplerArticulationEngine();

    const rrRegions: ExtendedRegion[] = [
      {
        id: 'r1',
        sampleName: 'Snare_RR1.wav',
        lowKey: 38,
        highKey: 38,
        rootKey: 38,
        lowVel: 1,
        highVel: 127,
        detune: 0,
        volume: 0,
        pan: 0,
        pitchKeytrack: 0,
        trigger: 'attack',
        seqPosition: 1,
        seqLength: 3,
        keyFadeIn: 0,
        keyFadeOut: 0,
        velFadeIn: 0,
        velFadeOut: 0,
        fadeCurve: 'linear',
        loopMode: 'no_loop',
        loopStart: 0,
        loopEnd: 0,
        loopCrossfadeMs: 0,
        playLogic: 'round_robin',
      },
      {
        id: 'r2',
        sampleName: 'Snare_RR2.wav',
        lowKey: 38,
        highKey: 38,
        rootKey: 38,
        lowVel: 1,
        highVel: 127,
        detune: 0,
        volume: 0,
        pan: 0,
        pitchKeytrack: 0,
        trigger: 'attack',
        seqPosition: 2,
        seqLength: 3,
        keyFadeIn: 0,
        keyFadeOut: 0,
        velFadeIn: 0,
        velFadeOut: 0,
        fadeCurve: 'linear',
        loopMode: 'no_loop',
        loopStart: 0,
        loopEnd: 0,
        loopCrossfadeMs: 0,
        playLogic: 'round_robin',
      },
      {
        id: 'r3',
        sampleName: 'Snare_RR3.wav',
        lowKey: 38,
        highKey: 38,
        rootKey: 38,
        lowVel: 1,
        highVel: 127,
        detune: 0,
        volume: 0,
        pan: 0,
        pitchKeytrack: 0,
        trigger: 'attack',
        seqPosition: 3,
        seqLength: 3,
        keyFadeIn: 0,
        keyFadeOut: 0,
        velFadeIn: 0,
        velFadeOut: 0,
        fadeCurve: 'linear',
        loopMode: 'no_loop',
        loopStart: 0,
        loopEnd: 0,
        loopCrossfadeMs: 0,
        playLogic: 'round_robin',
      },
    ];

    // Strike note 38 consecutively: should cycle 1 -> 2 -> 3 -> 1
    const s1 = engine.selectRegionForNote(rrRegions, 38, 100, 'attack');
    assert.strictEqual(s1?.sampleName, 'Snare_RR1.wav');

    const s2 = engine.selectRegionForNote(rrRegions, 38, 100, 'attack');
    assert.strictEqual(s2?.sampleName, 'Snare_RR2.wav');

    const s3 = engine.selectRegionForNote(rrRegions, 38, 100, 'attack');
    assert.strictEqual(s3?.sampleName, 'Snare_RR3.wav');

    const s4 = engine.selectRegionForNote(rrRegions, 38, 100, 'attack');
    assert.strictEqual(s4?.sampleName, 'Snare_RR1.wav');
  });

  await t.test('2. Release Trigger (Key-Off) resolution', () => {
    const mixedRegions: ExtendedRegion[] = [
      {
        id: 'atk_1',
        sampleName: 'Piano_C4.wav',
        lowKey: 60,
        highKey: 60,
        rootKey: 60,
        lowVel: 1,
        highVel: 127,
        detune: 0,
        volume: 0,
        pan: 0,
        pitchKeytrack: 100,
        trigger: 'attack',
        keyFadeIn: 0,
        keyFadeOut: 0,
        velFadeIn: 0,
        velFadeOut: 0,
        fadeCurve: 'linear',
        loopMode: 'no_loop',
        loopStart: 0,
        loopEnd: 0,
        loopCrossfadeMs: 0,
      },
      {
        id: 'rel_1',
        sampleName: 'Piano_Damper_Rel.wav',
        lowKey: 60,
        highKey: 60,
        rootKey: 60,
        lowVel: 1,
        highVel: 127,
        detune: 0,
        volume: -6,
        pan: 0,
        pitchKeytrack: 0,
        trigger: 'release',
        keyFadeIn: 0,
        keyFadeOut: 0,
        velFadeIn: 0,
        velFadeOut: 0,
        fadeCurve: 'linear',
        loopMode: 'no_loop',
        loopStart: 0,
        loopEnd: 0,
        loopCrossfadeMs: 0,
      },
    ];

    // Note-on query (trigger = attack)
    const attackTarget = resolveExtendedNoteTargets(mixedRegions, 60, 100, 'attack');
    assert.strictEqual(attackTarget.sampleName, 'Piano_C4.wav');
    assert.strictEqual(attackTarget.trigger, 'attack');

    // Note-off query (trigger = release)
    const releaseTarget = resolveExtendedNoteTargets(mixedRegions, 60, 100, 'release');
    assert.strictEqual(releaseTarget.sampleName, 'Piano_Damper_Rel.wav');
    assert.strictEqual(releaseTarget.trigger, 'release');
  });

  await t.test('3. Filename Regex Auto-Mapping (notes, velocity dynamics, RR, release)', () => {
    // 1. Classical dynamic + note + RR
    const m1 = autoMapSampleFilename('Violin_C3_mf_rr2.wav');
    assert.strictEqual(m1.rootKey, 48); // C3
    assert.strictEqual(m1.lowVelocity, 81); // mf
    assert.strictEqual(m1.highVelocity, 100);
    assert.strictEqual(m1.roundRobinIndex, 2);
    assert.strictEqual(m1.trigger, 'attack');

    // 2. Fortissimo + key range
    const m2 = autoMapSampleFilename('Trumpet_C2-C3_ff_Take1.wav');
    assert.strictEqual(m2.lowKey, 36);
    assert.strictEqual(m2.highKey, 48);
    assert.strictEqual(m2.lowVelocity, 116); // ff
    assert.strictEqual(m2.roundRobinIndex, 1);

    // 3. Release sample
    const m3 = autoMapSampleFilename('Rhodes_Key_Rel_C4.wav');
    assert.strictEqual(m3.rootKey, 60);
    assert.strictEqual(m3.trigger, 'release');
  });

  await t.test('4. Auto-Map collection with contiguous key interpolation and RR count', () => {
    const files = [
      'Gtr_E2_v1_rr1.wav',
      'Gtr_E2_v1_rr2.wav',
      'Gtr_A2_v1_rr1.wav',
      'Gtr_A2_v1_rr2.wav',
      'Gtr_D3_v1_rr1.wav',
    ];

    const mapped = autoMapSampleCollection(files);
    assert.strictEqual(mapped.length, 5);

    // Round-robin total should be 2 for E2 and A2
    const e2Samples = mapped.filter((m) => m.rootKey === 40); // E2 = 40
    assert.strictEqual(e2Samples.length, 2);
    assert.strictEqual(e2Samples[0].roundRobinTotal, 2);

    // Lowest note (E2) should extend downward to 0
    assert.strictEqual(e2Samples[0].lowKey, 0);

    // Highest note (D3 = 50) should extend upward to 127
    const d3Samples = mapped.filter((m) => m.rootKey === 50);
    assert.strictEqual(d3Samples[0].highKey, 127);
  });

  await t.test('5. Scala (.scl) microtuning scale parsing (cents & rational ratios)', () => {
    // 7-tone Just Intonation scale
    const sclContent = `!
! 7-tone Ptolemy Just Intonation
Ptolemy Intense Diatonic
 7
!
 9/8
 5/4
 4/3
 3/2
 5/3
 15/8
 2/1
`;

    const scale = parseScalaScale(sclContent);
    assert.strictEqual(scale.count, 7);
    assert.strictEqual(scale.description, 'Ptolemy Intense Diatonic');
    assert.strictEqual(scale.rawIntervals.length, 7);

    // 3/2 = fifth = 701.955 cents
    const fifthCents = scale.intervalsCents[3];
    assert.ok(Math.abs(fifthCents - 701.955) < 0.01);

    // Octave (2/1) = 1200 cents
    const octaveCents = scale.intervalsCents[6];
    assert.ok(Math.abs(octaveCents - 1200.0) < 0.001);
  });

  await t.test('6. Microtuning table frequency and 12-TET deviation derivation', () => {
    // 12-tone Quarter-Comma Meantone scale in cents
    const meantoneScl = `!
Quarter-comma meantone
 12
 76.04899
 193.15686
 310.26471
 386.31371
 503.42157
 579.47057
 696.57843
 772.62742
 889.73529
 1006.84314
 1082.89214
 1200.00000
`;

    const scale = parseScalaScale(meantoneScl);
    const table = createMicrotuningTable(scale, { referenceMidi: 69, referenceFrequencyHz: 440.0 });

    assert.strictEqual(table.frequenciesHz.length, 128);
    assert.strictEqual(table.centsOffsetFrom12Tet.length, 128);

    // A4 (69) should be exactly 440 Hz
    assert.ok(Math.abs(table.frequenciesHz[69] - 440.0) < 0.001);
    assert.ok(Math.abs(table.centsOffsetFrom12Tet[69]) < 0.01);

    // C4 (60) should differ from standard 12-TET 261.625 Hz
    assert.ok(table.frequenciesHz[60] > 200 && table.frequenciesHz[60] < 300);
  });

  await t.test('7. MIDI Modulation Matrix calculation', () => {
    const engine = new SamplerArticulationEngine({
      routes: [
        { source: 'modwheel', destination: 'cutoff', amount: 0.5 }, // ModWheel -> Cutoff
        { source: 'expression', destination: 'volume', amount: 1.0 }, // Expression -> Volume
        { source: 'pitchbend', destination: 'pitch', amount: 1.0 }, // PitchBend -> Pitch
      ],
    });

    // 1. ModWheel at 127: cutoff multiplier should be 2^(24 / 12) = 4.0
    const m1 = engine.computeModulations({ modwheel: 127 });
    assert.ok(Math.abs(m1.cutoffMultiplier - 4.0) < 0.01);

    // 2. Expression at 64 (~0.5): volume should be ~12 dB
    const m2 = engine.computeModulations({ expression: 64 });
    assert.ok(m2.volumeDbOffset > 10 && m2.volumeDbOffset < 14);

    // 3. Pitchbend fully up (+8192): pitch should be +200 cents
    const m3 = engine.computeModulations({ pitchbend: 8192 });
    assert.ok(Math.abs(m3.pitchCentsOffset - 200) < 0.1);
  });
});
