// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Phase 0 Canonical Contract (P0.1)
//
// Pins the Hartmann legacy format constants that MUST NOT change.
// Imports go through `../src/formats/*` (the repo's single source of
// truth re-export) — if `@abdsynths/shared` drifts, this suite fails
// here first, before any binary output is affected.
//
// Canonical values (NASAnalysis.dll / DOCS/NEURON_MM_SPEC.md):
//   - `.scape` magic `csAN`, `.sphere` magic `psAN`
//   - Sphere frame stride 6568 B = 0x1A0 (416) + 6152 B partial bank
//   - 1024 Phase-Vocoder partials, magic 0x04d2 (1234)
//   - map.script: 3 header lines + 128 x 8 zone lines = 1027 lines
//   - MName: max 11 ASCII chars; slots 0..511; complexity 1..10
//   - recDepth table [1,4,8,12,16,24,32,42,54,64]
//   - sound.script: 445-parameter schema
//   - Sample rate 44100 Hz (legacy-neuron path only)
// ─────────────────────────────────────────────────────────

import {
  NEURON_SOUND_SCHEMA,
  SPHERE_FRAME_MAGIC,
  SPHERE_PARTIAL_BLOCK_BYTES,
  SPHERE_PARTIAL_COUNT,
  parseMName,
  parseNeuronSphere,
  serializeMName,
} from '../src/formats/ModelFormat.ts';
import { parseSoundScript } from '../src/formats/SoundFormat.ts';
import {
  COMPLEXITY_TO_REC_DEPTH,
  NEURON_SAMPLE_RATE,
  generateMapScript,
  serializeNeuronSphereBinary,
  type ScapeSphereFrame,
} from '../src/core/dsp/ScapeSphereGenerator.ts';
import { WebAudioPipeline } from '../src/core/WebAudioPipeline.ts';
import { parseSessionJson } from '../src/core/sessionSchema.ts';
import type { ProcessConfig, Zone } from '../src/core/types.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

function makeZone(): Zone {
  return {
    id: 'contract-zone-0',
    lowKey: 0,
    rootKey: 60,
    highKey: 127,
    sampleLow: 'Contract_60_0.wav',
    sampleHigh: null,
    velSplit: 64,
    detune: 0,
    volume: 0,
    pan: 0,
  };
}

function makeFrame(f0Hz: number): ScapeSphereFrame {
  const mags = new Float32Array(64).fill(0);
  mags[0] = 1;
  return {
    frameIndex: 0,
    f0Hz,
    scape: {
      centroidHarmonic: 1,
      oddEvenBalance: 0.5,
      inharmonicityCents: 0,
      retainedPartials: 1,
      partialMagnitudes: mags,
      partialOffsetsHz: new Float32Array(64),
    },
    sphere: {
      spectralTiltDbPerOct: 0,
      temporalContour: new Float32Array([1]),
      formantBands: [1, 0, 0, 0],
      parameterSet: 0,
      layerCount: 1,
    },
  };
}

function makeConfig(): ProcessConfig {
  return {
    modelNumber: 77,
    modelName: 'Contract',
    complexity: 8,
    parameterSet: 0,
    targetFormat: 'legacy-neuron',
  };
}

async function runPhase0Tests(): Promise<void> {
  console.log('=== ABDNeuModMakr Phase 0 Canonical Contract ===');

  // 1. Sphere binary constants (FUN_10031950 / FUN_1003bd10 / FUN_1003c980)
  {
    assert(SPHERE_FRAME_MAGIC === 0x04d2, `SPHERE_FRAME_MAGIC must be 0x04d2 (got ${SPHERE_FRAME_MAGIC})`);
    assert(SPHERE_PARTIAL_COUNT === 0x0400, `SPHERE_PARTIAL_COUNT must be 1024 (got ${SPHERE_PARTIAL_COUNT})`);
    assert(
      SPHERE_PARTIAL_BLOCK_BYTES === 6152,
      `SPHERE_PARTIAL_BLOCK_BYTES must be 6152 (got ${SPHERE_PARTIAL_BLOCK_BYTES})`
    );
    console.log('  [OK] 0.1 Sphere constants: magic=0x04d2, 1024 partials, 6152 B bank');
  }

  // 1b. Canonical hardware sample rate alias (legacy-neuron path)
  {
    assert(NEURON_SAMPLE_RATE === 44100, `NEURON_SAMPLE_RATE must be 44100 (got ${NEURON_SAMPLE_RATE})`);
    console.log('  [OK] 0.1b NEURON_SAMPLE_RATE = 44100 Hz (single src-side alias)');
  }

  // 2. Serialized .sphere parses back with the canonical 6568-byte stride
  {
    const sphereBytes = serializeNeuronSphereBinary([makeFrame(440)], makeConfig());
    assert(sphereBytes[0] === 0x70 && sphereBytes[1] === 0x73, 'sphere bytes must start with psAN tag');
    const parsed = parseNeuronSphere(sphereBytes);
    assert(
      parsed.frameStride === 6568,
      `sphere frameStride must be 6568 (got ${parsed.frameStride})`
    );
    assert(parsed.frames.length >= 1, 'sphere must contain at least one frame');
    console.log('  [OK] 0.2 Serialized .sphere parses with frameStride=6568 (psAN + mnAN + fdAN + frames)');
  }

  // 3. map.script canonical shape: 1027 lines, MapVersion 0.9.2
  {
    const script = generateMapScript([makeZone()]);
    const lines = script.trimEnd().split(/\r?\n/);
    assert(lines.length === 1027, `map.script must have 1027 lines (got ${lines.length})`);
    assert(lines[0] === 'MapVersionMajor\t0', `map.script header line 1 mismatch (got '${lines[0]}')`);
    assert(lines[1] === 'MapVersionMinor\t9', `map.script header line 2 mismatch (got '${lines[1]}')`);
    assert(lines[2] === 'MapVersionBuild\t2', `map.script header line 3 mismatch (got '${lines[2]}')`);
    console.log('  [OK] 0.3 map.script: 1027 lines, MapVersion 0.9.2');
  }

  // 4. MName: strict 11-char hardware limit
  {
    assert(parseMName('123456789012') === '12345678901', 'MName must truncate to 11 chars');
    assert(serializeMName('123456789012').length === 11, 'serialized MName must be 11 bytes');
    assert(parseMName('sinew') === 'sinew', 'short MName must round-trip');
    console.log('  [OK] 0.4 MName 11-char limit enforced');
  }

  // 5. Complexity 1..10 -> recDepth table (neuronapp.ProcessDialog tableswitch)
  {
    const expected = [1, 4, 8, 12, 16, 24, 32, 42, 54, 64];
    assert(
      COMPLEXITY_TO_REC_DEPTH.length === 10 &&
        COMPLEXITY_TO_REC_DEPTH.every((v, i) => v === expected[i]),
      `recDepth table mismatch (got [${[...COMPLEXITY_TO_REC_DEPTH].join(',')}])`
    );
    console.log('  [OK] 0.5 Complexity 1..10 -> recDepth [1,4,8,12,16,24,32,42,54,64]');
  }

  // 6. sound.script schema: 445 parameters
  {
    assert(
      NEURON_SOUND_SCHEMA.length === 445,
      `sound schema must have 445 params (got ${NEURON_SOUND_SCHEMA.length})`
    );
    // Smoke-test the parser entry point is wired through the local re-export
    assert(typeof parseSoundScript === 'function', 'parseSoundScript must be exported');
    console.log('  [OK] 0.6 sound.script schema: 445 parameters');
  }

  // 7. Import guardrails (P0.3): constants sane + oversized buffer rejected
  {
    assert(
      WebAudioPipeline.MAX_IMPORT_FILE_BYTES === 50 * 1024 * 1024,
      'MAX_IMPORT_FILE_BYTES must be 50 MB'
    );
    assert(WebAudioPipeline.MAX_IMPORT_FILES === 128, 'MAX_IMPORT_FILES must be 128');
    const pipeline = new WebAudioPipeline();
    await pipeline.init();
    let threw = false;
    try {
      pipeline.registerSampleBuffer(
        'huge.wav',
        new ArrayBuffer(WebAudioPipeline.MAX_IMPORT_FILE_BYTES + 1)
      );
    } catch (err) {
      threw = err instanceof Error && err.message.includes('import limit');
    }
    assert(threw, 'oversized registerSampleBuffer must throw an import-limit error');
    pipeline.dispose();
    console.log('  [OK] 0.7 Import guardrails: 50 MB/file, 128 files, oversized rejected');
  }

  // 8. Session schema validation (P0.2): corrupt payloads rejected with specific errors
  {
    const good = {
      magic: 'NEURONMM_SESSION',
      session: {
        id: 's1',
        name: 'Good',
        zones: [
          { id: 'z1', lowKey: 0, rootKey: 60, highKey: 127, sampleLow: 'A.wav', sampleHigh: null, velSplit: 64, detune: 0, volume: 0, pan: 0 },
        ],
        processConfig: { modelNumber: 7, modelName: 'MyModel', complexity: 8, parameterSet: 0, targetFormat: 'dual' },
        createdAt: '2026-01-01T00:00:00.000Z',
        modifiedAt: '2026-01-01T00:00:00.000Z',
        dirty: true,
      },
    };
    const loaded = parseSessionJson(JSON.stringify(good));
    assert(loaded.zones.length === 1 && loaded.zones[0].velSplit === 64, 'valid session must load with velSplit preserved');
    assert(loaded.dirty === false, 'loaded session must not be dirty');

    const badCases: Array<[string, unknown, RegExp]> = [
      ['malformed text', '{not json', /malformed JSON/],
      ['non-object root', '[1,2,3]', /root must be an object/],
      ['wrong magic', { magic: 'OTHER', session: good.session }, /unrecognized magic/],
      ['missing zones', { session: { ...good.session, zones: [] } }, /missing zones array/],
      ['too many zones', { session: { ...good.session, zones: Array.from({ length: 129 }, (_, i) => ({ lowKey: i, rootKey: i, highKey: i })) } }, /too many zones/],
      ['non-numeric key', { session: { ...good.session, zones: [{ lowKey: 'low', rootKey: 60, highKey: 127 }] } }, /lowKey.*finite number/],
      ['inverted range', { session: { ...good.session, zones: [{ lowKey: 100, rootKey: 60, highKey: 10 }] } }, /lowKey 100 > highKey 10/],
      ['bad slot', { session: { ...good.session, processConfig: { modelNumber: 512, modelName: 'X', complexity: 8, parameterSet: 0, targetFormat: 'dual' } } }, /modelNumber.*0\.\.511/],
      ['bad complexity', { session: { ...good.session, processConfig: { modelNumber: 1, modelName: 'X', complexity: 11, parameterSet: 0, targetFormat: 'dual' } } }, /complexity.*1\.\.10/],
      ['bad parameterSet', { session: { ...good.session, processConfig: { modelNumber: 1, modelName: 'X', complexity: 8, parameterSet: 10, targetFormat: 'dual' } } }, /parameterSet.*0\.\.9/],
      ['bad targetFormat', { session: { ...good.session, processConfig: { modelNumber: 1, modelName: 'X', complexity: 8, parameterSet: 0, targetFormat: 'mp3' } } }, /targetFormat/],
    ];
    for (const [label, payload, pattern] of badCases) {
      const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
      let threw: Error | null = null;
      try {
        parseSessionJson(text);
      } catch (err) {
        threw = err instanceof Error ? err : new Error(String(err));
      }
      assert(threw !== null && pattern.test(threw.message), `corrupt case '${label}' must throw matching ${pattern} (got '${threw?.message ?? 'no error'}')`);
    }
    // Legacy name truncation: modern-neural keeps 32, legacy/dual keeps 11
    const longName = { session: { ...good.session, processConfig: { modelNumber: 1, modelName: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', complexity: 8, parameterSet: 0, targetFormat: 'legacy-neuron' } } };
    assert(parseSessionJson(JSON.stringify(longName)).processConfig.modelName.length === 11, 'legacy modelName must truncate to 11');

    // Legacy session compatibility: older session with sessionName alias or omitted name
    const legacySessionName = { session: { ...good.session, sessionName: 'VintagePatch', name: undefined } };
    assert(parseSessionJson(JSON.stringify(legacySessionName)).name === 'VintagePatch', 'legacy sessionName alias must migrate to session.name');

    const omittedName = { session: { ...good.session, name: undefined, processConfig: { ...good.session.processConfig, modelName: 'FallbackMod' } } };
    assert(parseSessionJson(JSON.stringify(omittedName)).name === 'FallbackMod', 'omitted session name must fall back to processConfig.modelName');

    console.log('  [OK] 0.8 Session schema: valid loads (velSplit kept), 11 corrupt cases rejected, legacy migration verified');
  }

  console.log('=== ALL PHASE 0 CONTRACT TESTS PASSED ===');
}

runPhase0Tests().catch((err) => {
  console.error(err);
  process.exit(1);
});
