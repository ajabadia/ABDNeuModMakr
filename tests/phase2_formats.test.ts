// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Phase 2 Formats Verification Suite
//
// Tests:
//   2.1 .scape (`csAN`) & .sphere (`psAN`) binary round-trip: write -> read -> compare
//   2.2 `map.script` (1027-line canonical & `add mapentry`), `MName`, `ModelNames`
//   2.3 `.sound` (`sound.script` 445-param schema, v1 migration, clamping, `sound.stickrec`)
//   2.4 Real Factory NeuronDB verification (`511.model` "sinew" & `000.sound` "Symbiont")
// ─────────────────────────────────────────────────────────

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  parseNeuronScape,
  parseNeuronSphere,
  parseMapScript,
  serializeCanonicalMapScript,
  parseMName,
  serializeMName,
  parseModelNamesCache,
  serializeModelNamesCache,
  resynthesizeSphereFrame,
  resynthesizeScapeCurve,
  convertLegacyModelToModern,
  SPHERE_FRAME_MAGIC,
  type ParsedNeuronModel,
  NEURON_SOUND_SCHEMA,
  parseSoundScript,
  serializeSoundScript,
  createSoundPresetForModel,
  parseStickRec,
  serializeStickRec,
  parseSoundNamesCache,
  serializeSoundNamesCache,
} from '@abdsynths/shared/formats/neuron';

import {
  decodeWav,
  synthesizeDemoWav,
  midiNoteToHz,
} from '../src/core/dsp/WavDecoder.ts';
import { SpectralAnalyzer } from '../src/core/dsp/SpectralAnalyzer.ts';
import { generateScapeSphereFrames } from '../src/core/dsp/ScapeSphereGenerator.ts';
import type { ProcessConfig, Zone } from '../src/core/types.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

async function runPhase2Tests(): Promise<void> {
  console.log('=== ABDNeuModMakr Phase 2 Formats Verification ===');

  // 1. Synthetic .scape & .sphere Round-Trip (write -> read -> compare)
  {
    const analyzer = new SpectralAnalyzer();
    const rootNote = 69; // A4 = 440 Hz
    const wavBuf = synthesizeDemoWav('strings', rootNote, 44100, 0.8);
    const decoded = decodeWav(wavBuf);
    const f0 = analyzer.detectPitch(decoded.channels, decoded.sampleRate);
    const model = analyzer.analyzeTemporal(
      decoded.channels,
      decoded.sampleRate,
      f0,
      8,
      false,
      'descriptors'
    );

    const config: ProcessConfig = {
      modelNumber: 12,
      modelName: 'TESTMODEL',
      complexity: 8,
      parameterSet: 3,
      targetFormat: 'dual',
    };

    const generated = generateScapeSphereFrames(model, config);

    const scape = parseNeuronScape(generated.scapeBinary);
    const sphere = parseNeuronSphere(generated.sphereBinary);

    assert(scape.kind === 'scape', 'Parsed scape kind');
    assert(sphere.kind === 'sphere', 'Parsed sphere kind');
    assert(scape.chunks.length === 3, 'Scape has 3 chunks (csAN, mnAN, fdAN)');
    assert(sphere.chunks.length === 3, 'Sphere has 3 chunks (psAN, mnAN, fdAN)');
    assert(
      scape.header.curveId === sphere.header.curveId,
      `curveId must match between scape (${scape.header.curveId}) and sphere (${sphere.header.curveId})`
    );
    assert(
      scape.header.resolution === sphere.header.resolution,
      'Resolution must match between scape and sphere'
    );
    assert(scape.names.length === 12, 'Scape must have 12 mnAN names');
    assert(sphere.names.length === 12, 'Sphere must have 12 mnAN names');
    assert(scape.fdPairs.length === 6, 'Scape must have 6 fdAN float pairs');
    assert(sphere.fdPairs.length === 6, 'Sphere must have 6 fdAN float pairs');
    assert(scape.samples.length === scape.header.length, 'Scape int16 sample length matches header');

    assert(sphere.frames.length === generated.frames.length, 'Sphere frame count matches');
    for (let i = 0; i < sphere.frames.length; i++) {
      const f = sphere.frames[i];
      assert(f.magic === SPHERE_FRAME_MAGIC, `Frame ${i} magic should be 0x4D2`);
      assert(f.frameId === sphere.header.curveId + i, `Frame ${i} contiguous frameId`);
      assert(f.partials.length > 0, `Frame ${i} should have active partials`);
      // Verify descending amplitude order
      for (let p = 1; p < f.partials.length; p++) {
        assert(
          f.partials[p - 1].amplitude >= f.partials[p].amplitude,
          `Frame ${i} partials must be sorted descending by amplitude`
        );
      }
    }

    // Resynthesize frame 0 and scape curve
    const synthBody = resynthesizeSphereFrame(sphere.frames[0], 44100);
    const synthCurve = resynthesizeScapeCurve(scape, 44100);
    assert(synthBody.length === 44100 && synthCurve.length === 44100, 'Resynthesized lengths');
    const synthF0 = analyzer.detectPitch(synthBody, 44100);
    assert(
      Math.abs(1200 * Math.log2(synthF0 / midiNoteToHz(rootNote))) < 60,
      `Resynthesized SphereFrame F0 (${synthF0.toFixed(1)} Hz) matches A4`
    );

    console.log('  [OK] 2.1 .scape (csAN) & .sphere (psAN) binary round-trip & frame resynthesis verified');
  }

  // 2. map.script (1027-line canonical), MName & ModelNames Cache Round-Trip
  {
    const zones: Zone[] = [
      {
        id: 'zone_1',
        lowKey: 0,
        rootKey: 36,
        highKey: 59,
        sampleLow: 'Bass_C2.aif',
        sampleHigh: null,
        detune: -3,
        volume: 2,
        pan: -10,
      },
      {
        id: 'zone_2',
        lowKey: 60,
        rootKey: 72,
        highKey: 127,
        sampleLow: 'Lead_C5.aif',
        sampleHigh: 'Lead_C5_hi.aif',
        detune: 4,
        volume: 0,
        pan: 15,
      },
    ];

    const mapText = serializeCanonicalMapScript(zones);
    const lineCount = mapText.trimEnd().split(/\r?\n/).length;
    assert(
      lineCount === 1027,
      `Canonical map.script must have 1027 lines (3 version + 128*8), got ${lineCount}`
    );

    const parsedMap = parseMapScript(mapText);
    assert(
      parsedMap.versionMajor === 0 &&
        parsedMap.versionMinor === 9 &&
        parsedMap.versionBuild === 2,
      'map.script version 0.9.2'
    );
    assert(parsedMap.activeZones.length === 2, 'Parsed 2 active zones from map.script');
    assert(
      parsedMap.activeZones[0].lowKey === 0 &&
        parsedMap.activeZones[0].highKey === 59 &&
        parsedMap.activeZones[0].rootKey === 36 &&
        parsedMap.activeZones[0].detune === -3,
      'Zone 0 fields preserved'
    );
    assert(
      parsedMap.activeZones[1].lowKey === 60 &&
        parsedMap.activeZones[1].highKey === 127 &&
        parsedMap.activeZones[1].sampleHigh === '000003.scape',
      'Zone 1 fields and second source index preserved'
    );

    const mnameBytes = serializeMName('sinew');
    assert(parseMName(mnameBytes) === 'sinew', 'MName round-trip');

    const modelCacheMap = new Map<number, string>([
      [0, 'BrushedGtr'],
      [511, 'sinew'],
    ]);
    const cacheText = serializeModelNamesCache(modelCacheMap);
    const parsedCache = parseModelNamesCache(cacheText);
    assert(parsedCache.size === 512, 'ModelNames cache has 512 entries');
    assert(parsedCache.get(0) === 'BrushedGtr' && parsedCache.get(511) === 'sinew', 'ModelNames entries preserved');

    console.log('  [OK] 2.2 map.script (1027 lines), MName & ModelNames cache round-trip verified');
  }

  // 3. .sound (`sound.script` 445-param schema, v1 migration, stickrec, SoundNames)
  {
    assert(NEURON_SOUND_SCHEMA.length === 445, `Expected 445 sound parameters, got ${NEURON_SOUND_SCHEMA.length}`);

    const preset = createSoundPresetForModel({
      name: 'ABD Neural Pad',
      r1ModelIndex: 42,
      r2ModelIndex: 511,
      r2Switch: true,
      numVoices: 8,
    });
    assert(preset.name === 'ABD Neural Pad', `Preset name decoded: ${preset.name}`);
    assert(preset.r1ModelIndex === 42 && preset.r2ModelIndex === 511, 'Model indices set');
    // Check that the 19 out-of-range 0 defaults (like R1L1SphereStickPlayback and EQ_Band1Q) were clamped to 1
    assert(preset.values.get('R1L1SphereStickPlayback') === 1, 'Out-of-range default clamped to 1');
    assert(preset.values.get('EQ_Band1Q') === 1, 'EQ_Band1Q default clamped to 1');

    const scriptText = serializeSoundScript(preset);
    const scriptLines = scriptText.trimEnd().split(/\r\n/);
    assert(scriptLines.length === 445, `sound.script must have 445 CRLF lines, got ${scriptLines.length}`);

    const reparsed = parseSoundScript(scriptText);
    assert(reparsed.name === 'ABD Neural Pad', 'Reparsed preset name matches');
    assert(serializeSoundScript(reparsed) === scriptText, 'sound.script round-trip is byte-for-byte identical');

    // Test v1 BlenderAmount migration (SoundVersionMajor = 1 -> BlenderAmount -= 64)
    const v1Text = 'SoundVersionMajor\t1\r\nBlenderAmount\t64\r\n';
    const v1Parsed = parseSoundScript(v1Text);
    assert(v1Parsed.values.get('BlenderAmount') === 0, 'v1 BlenderAmount 64 migrated to 0');

    // Test sound.stickrec round-trip
    const stickEvents = [
      { time: 0x0000, flag: 1, control: 3, value: 0x400 },
      { time: 0x001a, flag: 0, control: 3, value: 0x512 },
      { time: 0x0d22, flag: 1, control: 3, value: 0x920 },
    ];
    const stickText = serializeStickRec(stickEvents);
    const parsedStick = parseStickRec(stickText);
    assert(parsedStick.length === 3 && parsedStick[2].time === 0x0d22 && parsedStick[2].value === 0x920, 'stickrec round-trip');

    const soundCache = new Map<number, string>([[0, 'Symbiont']]);
    const parsedSoundCache = parseSoundNamesCache(serializeSoundNamesCache(soundCache));
    assert(parsedSoundCache.size === 1000 && parsedSoundCache.get(0) === 'Symbiont', 'SoundNames 1000-slot cache round-trip');

    console.log('  [OK] 2.3 .sound (445-param sound.script, v1 migration, sound.stickrec, SoundNames) verified');
  }

  // 4. Real Factory NeuronDB Verification (`511.model` & `000.sound`)
  {
    const neuronDbRoot = 'C:\\Users\\ajaba\\Downloads\\neuron\\Hartmann Music\\NeuronVS\\NeuronDB';
    const model511Dir = path.join(neuronDbRoot, 'Models', '511.model');
    const sound000File = path.join(neuronDbRoot, 'Sounds', '000.sound', 'sound.script');

    if (fs.existsSync(model511Dir) && fs.existsSync(sound000File)) {
      const mnameRaw = new Uint8Array(fs.readFileSync(path.join(model511Dir, 'MName')));
      const mapRaw = fs.readFileSync(path.join(model511Dir, 'map.script'), 'latin1');
      const scapeRaw = new Uint8Array(fs.readFileSync(path.join(model511Dir, '000001.scape')));
      const sphereRaw = new Uint8Array(fs.readFileSync(path.join(model511Dir, '000001.sphere')));

      const mname = parseMName(mnameRaw);
      const mapScript = parseMapScript(mapRaw);
      const scape = parseNeuronScape(scapeRaw);
      const sphere = parseNeuronSphere(sphereRaw);

      assert(mname === 'sinew', `511.model MName should be 'sinew', got '${mname}'`);
      assert(mapScript.activeZones.length === 1, '511.model has 1 active zone (0..127)');
      assert(mapScript.activeZones[0].rootKey === 69, '511.model zone 0 rootKey is 69');

      assert(
        scape.header.resolution === 100 &&
          scape.header.length === 66940 &&
          scape.header.loopStart === 31472 &&
          scape.header.loopEnd === 62843,
        '511.model 000001.scape header matches documented factory values'
      );
      assert(
        sphere.header.version === 288 &&
          sphere.header.resolution === 100 &&
          sphere.header.channels === 64 &&
          sphere.header.frameStride === 6568 &&
          sphere.frames.length === 67,
        `511.model 000001.sphere header & frame count (${sphere.frames.length}) match factory values`
      );
      assert(
        sphere.frames[0].partials.length === 1023 &&
          sphere.frames[32].partials.length === 132,
        `511.model frame 0 (1023 partials) and frame 32 (132 partials) match SYNTH_FRAMES.md`
      );

      // Convert real 511.model to Modern .neuronikmodel v2.1
      const parsedModel511: ParsedNeuronModel = {
        slot: 511,
        name: mname,
        mapScript,
        scapes: new Map([[1, scape]]),
        spheres: new Map([[1, sphere]]),
      };
      const modernJson = JSON.parse(convertLegacyModelToModern(parsedModel511)) as {
        schemaVersion: string;
        name: string;
        slot: number;
      };
      assert(
        modernJson.schemaVersion === '2.1' && modernJson.name === 'sinew' && modernJson.slot === 511,
        'Legacy 511.model converted to Modern .neuronikmodel v2.1'
      );

      // Verify real 000.sound ("Symbiont") byte-for-byte round-trip
      const sound000Raw = fs.readFileSync(sound000File, 'latin1');
      const preset000 = parseSoundScript(sound000Raw);
      assert(
        preset000.name === 'Symbiont' &&
          preset000.numVoices === 6 &&
          preset000.r1ModelIndex === 336,
        `000.sound 'Symbiont' metadata verified (got name='${preset000.name}', voices=${preset000.numVoices}, model=${preset000.r1ModelIndex})`
      );
      const resaved000 = serializeSoundScript(preset000);
      assert(
        resaved000 === sound000Raw,
        'Real 000.sound (Symbiont) parse -> serialize round-trip is 100% byte-for-byte identical!'
      );

      console.log('  [OK] 2.4 Real Factory NeuronDB (`511.model` "sinew" & `000.sound` "Symbiont") verified 100% byte-for-byte');
    } else {
      console.log('  [SKIP] 2.4 Factory NeuronDB path not present on this machine');
    }
  }

  console.log('=== ALL PHASE 2 FORMAT TESTS PASSED ===');
}

runPhase2Tests().catch((err) => {
  console.error(err);
  process.exit(1);
});
