// ABDNeuModMakr — Fase 43: Common Data Dictionary v2.0 conformity guards.
// - 43.1: every normalized-dictionary key we emit resolves in the dictionary
//   (engine passes unknown IDs through silently) + SymBipolar exact center.
// - 43.2: spec IDs carry coherent semanticRoles (no home-grown role strings).
// - 43.3: autosampler MIDI emission contract — notes + CC 120/123 only
//   (no NRPN pairs, no param sweeps → no zipper risk by construction).
// - 43.4 (our side): writer output carries every top-level key the vendored
//   axionik schema requires, with the pinned schemaVersion const.
// Self-contained: only `src/` + `vendor/` (no absolute host paths).
import assert from 'node:assert/strict';
import { MidiTranslationEngine } from '../vendor/@abdsynths/shared/Contracts/MidiTranslationEngine.ts';
import samplerSpec from '../vendor/@abdsynths/shared/Contracts/sampler_voice_parameter_spec.json' with { type: 'json' };
import axionikSchema from '../vendor/@abdsynths/shared/Contracts/axionik_expanded_model.schema.json' with { type: 'json' };
import {
  sessionToUniversalSamplerInstrument,
  extractNormalizedDictionaryParams,
} from '../src/core/sampler/UniversalSamplerModel.ts';
import { buildAxionikExpandedModel } from '../src/core/expandedModelWriter.ts';
import { WebMidiAutoSamplerService } from '../src/core/midi/WebMidiAutoSamplerService.ts';
import type { Session } from '../src/core/types.ts';

function mockSession(): Session {
  return {
    id: 'sess-43',
    name: 'Audit43',
    zones: [
      {
        id: 'z1', lowKey: 36, rootKey: 60, highKey: 84,
        sampleLow: 'Audit_C3.wav', sampleHigh: null,
        detune: 0, volume: 0, pan: -10,
      },
    ],
    extendedRegions: [
      {
        id: 'r1', sampleName: 'Audit_C3.wav',
        lowKey: 36, highKey: 84, rootKey: 60, lowVel: 1, highVel: 127,
        detune: 0, volume: -3, pan: -10, pitchKeytrack: 100,
        trigger: 'attack', keyFadeIn: 0, keyFadeOut: 0, velFadeIn: 0,
        velFadeOut: 0, fadeCurve: 'equal-power', loopMode: 'loop_continuous',
        loopStart: 32, loopEnd: 224, loopCrossfadeMs: 5, muteGroup: 2,
        sampleStartFrame: 0, sampleEndFrame: 256,
      },
    ],
    processConfig: {
      modelNumber: 1, modelName: 'Audit43', expandedName: 'Audit43 Extended',
      complexity: 8, parameterSet: 2,
    },
    dirty: false,
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
  } as unknown as Session;
}

async function main() {
  console.log('--- Fase43.1/43.2: dictionary keys resolve (ID or semanticRole) ---');
  const engine = new MidiTranslationEngine(samplerSpec as never);
  assert.equal(MidiTranslationEngine.getParameterIds().length, 49);
  const uni = sessionToUniversalSamplerInstrument(mockSession());
  const norm = extractNormalizedDictionaryParams(uni);
  assert.ok(Object.keys(norm).length > 0, 'dictionary must yield params');
  // Bucket A — structural by design (dictionary doc §3.3: sample pointers
  // and loop frames live in structural nodes, NOT the parameter dict).
  // The engine must pass them through UNCHANGED (no curve conversion).
  const STRUCTURAL_KEYS = [
    'zoneSampleStart', 'zoneSampleEnd', 'zoneReverse',
    'loopStartFrame', 'loopEndFrame',
  ];
  for (const key of STRUCTURAL_KEYS) {
    assert.equal(
      norm[key], uni.parameters[key],
      `43.1 structural '${key}' must pass through unconverted`
    );
  }
  // Bucket B — fixed 2026-11-06 in ABDShared (spec 42→49 + canonical IDs
  // in `articulationToDictionaryParams`): the engine must resolve EVERY
  // non-structural key. Any silent pass-through fails the suite.
  const gaps: string[] = [];
  for (const key of Object.keys(norm)) {
    if (STRUCTURAL_KEYS.includes(key)) continue;
    const meta = engine.getMeta(key);
    if (!meta) {
      gaps.push(key);
      continue;
    }
    assert.ok(meta.semanticRole, `43.2 '${key}' must carry a coherent semanticRole`);
  }
  console.log(`  dictionary gaps (passed through silently): ${JSON.stringify(gaps)}`);
  assert.deepEqual(gaps, []);
  // SymBipolar exact hardware center for every bipolar entry in the spec.
  const specParams = (samplerSpec as { parameters: Array<{ id: string; curve: string; wireZeroCenter?: number }> }).parameters;
  const bipolars = specParams.filter((p) => p.curve === 'SymBipolar');
  assert.ok(bipolars.length >= 1, 'spec must declare at least one SymBipolar param');
  for (const b of bipolars) {
    const zc = b.wireZeroCenter ?? 64;
    assert.ok(Math.abs(engine.wireToDomain(b.id, zc)) < 1e-9, `43.1 ${b.id}: wire ${zc} must map to exactly 0.0`);
    assert.equal(engine.domainToWire(b.id, 0), zc, `43.1 ${b.id}: domain 0 must map to wire ${zc}`);
  }
  console.log(`ok 43.1/43.2 (${Object.keys(norm).length} keys resolve, ${bipolars.length} SymBipolar center-exact)`);

  console.log('--- Fase43.4 (our side): expanded doc matches vendored contract shape ---');
  const partials = 8;
  const fakeSpectral = {
    frameCount: 2, frameSpanHz: 50, gridFixed: true,
    ampsOf: () => new Float32Array(partials).fill(0.1),
    offsetsOf: () => new Float32Array(partials).fill(0),
    f0At: () => 220, isLayered: () => false, layerCount: 0,
    numFramesOf: () => 0,
    ampsOfLayer: () => new Float32Array(0),
    offsetsOfLayer: () => new Float32Array(0),
    f0AtLayer: () => 0, layerNameAt: () => '', layerWeightAt: () => 0,
    frameWeightAt: () => 0,
  };
  const doc = buildAxionikExpandedModel({
    slot: 1, modelName: 'Audit43', spectral: fakeSpectral,
    regions: (mockSession() as unknown as { extendedRegions: never[] }).extendedRegions,
    processConfig: mockSession().processConfig,
  } as never);
  const schema = axionikSchema as unknown as {
    required: string[];
    properties: { schemaVersion: { const: string } };
  };
  for (const key of schema.required) {
    assert.ok((doc as unknown as Record<string, unknown>)[key] !== undefined, `43.4 doc missing required contract key '${key}'`);
  }
  assert.equal(doc.schemaVersion, schema.properties.schemaVersion.const);
  assert.ok(doc.identity.slug.length > 0);
  assert.equal(doc.regions.length, 1);
  // Loop-1: the writer must emit the mapped loop + sampleRate the engine reads.
  const r0 = doc.regions[0] as unknown as Record<string, unknown>;
  assert.equal((r0.loop as { mode: string }).mode, 'loop_continuous');
  assert.equal((r0.loop as { startFrame: number }).startFrame, 32);
  assert.equal((r0.loop as { endFrame: number }).endFrame, 224);
  assert.ok(typeof r0.sampleRate === 'number' && (r0.sampleRate as number) >= 8000,
    '43.4 region must carry sampleRate for the engine loop mapping');
  // Dispatcher end-to-end: the writer must emit muteGroup (hi-hat choke).
  assert.equal((r0 as { muteGroup?: number }).muteGroup, 2);
  console.log('ok 43.4 shape (+loop/sampleRate/muteGroup)');

  console.log('--- Fase43.3: autosampler emits notes + CC 120/123 only ---');
  const sent: number[][] = [];
  const fakeOutput = {
    id: 'fake-out', name: 'Fake Out', manufacturer: '', state: 'connected',
    send: (data: number[] | Uint8Array) => { sent.push(Array.from(data as unknown as number[])); },
  };
  const fakeAccess = {
    outputs: new Map([['fake-out', fakeOutput]]),
    inputs: new Map(),
    onstatechange: null,
  };
  // Node 24 exposes a global `navigator` getter (undici) — override it.
  const hadNavigator = 'navigator' in globalThis;
  const prevNavigator = (globalThis as unknown as { navigator?: unknown }).navigator;
  Object.defineProperty(globalThis, 'navigator', {
    value: { requestMIDIAccess: async () => fakeAccess },
    configurable: true,
  });
  try {
    const svc = new WebMidiAutoSamplerService();
    assert.equal(await svc.ensureAccess(), true);
    assert.equal(svc.sendNoteOn(60, 100), true);
    assert.equal(svc.sendNoteOff(60), true);
    svc.sendAllNotesOff();
    assert.ok(sent.length >= 4, `expected noteon+noteoff+2xCC, got ${sent.length}`);
    for (const msg of sent) {
      const status = msg[0] & 0xf0;
      if (status === 0xb0) {
        assert.ok(
          msg[1] === 120 || msg[1] === 123,
          `43.3 MIDI contract: CC ${msg[1]} outside panic set {120,123} (NRPN sweep?)`
        );
      } else {
        assert.ok(
          status === 0x90 || status === 0x80,
          `43.3 MIDI contract: unexpected status 0x${status.toString(16)} (only notes + panic CC allowed)`
        );
      }
    }
  } finally {
    if (hadNavigator) {
      Object.defineProperty(globalThis, 'navigator', { value: prevNavigator, configurable: true });
    } else {
      delete (globalThis as unknown as { navigator?: unknown }).navigator;
    }
  }
  console.log(`ok 43.3 (${sent.length} messages, all notes or CC 120/123)`);

  console.log('\nPhase43 OK');
}

await main();
