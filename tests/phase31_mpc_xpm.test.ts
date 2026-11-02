// ABDNeuModMakr — Fase 31: Akai MPC .xpm / .xpn import & export
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  parseMpcXpm,
  parseMpcXpmXml,
  writeMpcXpm,
  regionsToMpcInstruments,
  mpcEnvToSeconds,
  secondsToMpcEnv,
  mpcCutoffToHz,
  hzToMpcCutoff,
  buildExpansionXml,
  parseExpansionXml,
  type MpcSourceRegion,
} from '../src/formats/MpcXpmFormat.ts';
import { parseUniversalSampler, mpcProgramToPreset, listZipSamplerPrograms } from '../src/core/import/rawSamplerParsers.ts';
import { parseSliceFile } from '../src/core/dsp/SliceFileParser.ts';
import { createZipArchive, indexZipArchive, extractZipEntry } from '../src/formats/ZipArchive.ts';
import { extractInstrumentPrefix, extractFolderFilesToCandidates } from '../src/core/batch/FolderBatchExtractor.ts';
import { MidiTranslationEngine } from '../vendor/@abdsynths/shared/Contracts/MidiTranslationEngine.ts';
import samplerSpec from '../vendor/@abdsynths/shared/Contracts/sampler_voice_parameter_spec.json' with { type: 'json' };
import { exportRawSamplerLibrary } from '../src/core/export/rawSamplerExporter.ts';
import { encodeWavPcm16 } from '../src/core/dsp/WavDecoder.ts';
import {
  sessionToUniversalSamplerInstrument,
  extractNormalizedDictionaryParams,
  applyNormalizedDictionaryParams,
  evaluateFormatFidelity,
} from '../src/core/sampler/UniversalSamplerModel.ts';
import type { Session } from '../src/core/types.ts';

let passed = 0;
let failed = 0;
let skipped = 0;
async function test(name: string, fn: () => void | Promise<void> | 'skip'): Promise<void> {
  try {
    const r = await fn();
    if (r === 'skip') {
      skipped++;
      console.log(`  SKIP  ${name} (real MPC corpus not available)`);
      return;
    }
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL  ${name}\n        ${(e as Error).message}`);
  }
}

const CORPUS = 'D:/desarrollos/ABDSynths/_RESOURCES/samplers/akai mpc';
function findFiles(dir: string, ext: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) findFiles(p, ext, out);
    else if (n.toLowerCase().endsWith(ext)) out.push(p);
  }
  return out;
}

const REGIONS: MpcSourceRegion[] = [
  { sampleName: 'Bass_C2.wav', lowKey: 36, highKey: 47, rootKey: 36, lowVel: 1, highVel: 63, volumeDb: -3, pan: -10, tuneCents: 125, loopStart: 100, loopEnd: 9000, loopEnabled: true, sampleFrames: 10000 },
  { sampleName: 'Bass_C2_hard.wav', lowKey: 36, highKey: 47, rootKey: 36, lowVel: 64, highVel: 127, volumeDb: 0, pan: 0, tuneCents: 0, loopStart: 0, loopEnd: 0, loopEnabled: false, sampleFrames: 10000 },
  { sampleName: 'Bass_C3.wav', lowKey: 48, highKey: 59, rootKey: 48, lowVel: 1, highVel: 127, volumeDb: 0, pan: 0, tuneCents: 0, loopStart: 0, loopEnd: 0, loopEnabled: false, sampleFrames: 8000 },
  { sampleName: 'KeyOff.wav', lowKey: 36, highKey: 59, rootKey: 48, lowVel: 1, highVel: 127, volumeDb: -12, pan: 0, tuneCents: 0, loopStart: 0, loopEnd: 0, loopEnabled: false, sampleFrames: 2000, release: true },
];

async function main(): Promise<void> {
  console.log('\nFase 31 — Akai MPC .xpm / .xpn');

  await test('Envelope and cutoff conversions are inverse', () => {
    for (const s of [0.001, 0.05, 1, 12]) assert.ok(Math.abs(mpcEnvToSeconds(secondsToMpcEnv(s)) - s) < 1e-9);
    for (const hz of [100, 880, 5000]) assert.ok(Math.abs(mpcCutoffToHz(hzToMpcCutoff(hz)) - hz) < 1e-6);
    assert.equal(mpcEnvToSeconds(0), 0.001);
  });

  await test('Writer emits 128 instruments x 4 layers with MPC conventions', () => {
    const xml = writeMpcXpm({ name: 'Bass Test', type: 'Keygroup', instruments: regionsToMpcInstruments(REGIONS, 'Keygroup') });
    assert.equal((xml.match(/<Instrument number=/g) ?? []).length, 128);
    assert.equal((xml.match(/<Layer number=/g) ?? []).length, 512);
    assert.match(xml, /<KeygroupNumKeygroups>3<\/KeygroupNumKeygroups>/);
    assert.match(xml, /<RootNote>37<\/RootNote>/); // MIDI 36 + 1
    assert.match(xml, /<SampleName>Bass_C2<\/SampleName>/); // no extension
    assert.match(xml, /<TriggerMode>1<\/TriggerMode>/); // release keygroup
    assert.match(xml, /<Active>True<\/Active>/);
    assert.match(xml, /<Pan>0\.400000<\/Pan>/);
  });

  await test('Write -> read round trip preserves mapping', async () => {
    const xml = writeMpcXpm({ name: 'Bass Test', type: 'Keygroup', instruments: regionsToMpcInstruments(REGIONS, 'Keygroup') });
    const prog = parseMpcXpmXml(xml);
    assert.equal(prog.type, 'Keygroup');
    assert.equal(prog.instruments.length, 3);
    const kg1 = prog.instruments[0];
    assert.deepEqual([kg1.lowNote, kg1.highNote, kg1.layers.length], [36, 47, 2]);
    assert.equal(kg1.layers[0].rootNote, 36);
    assert.deepEqual([kg1.layers[0].velStart, kg1.layers[0].velEnd], [1, 63]);
    assert.equal(kg1.layers[0].tuneCoarse, 1);
    assert.equal(kg1.layers[0].tuneFine, 25);
    assert.equal(kg1.layers[0].loopEnabled, true);
    const preset = await parseUniversalSampler('bass.xpm', new TextEncoder().encode(xml).buffer as ArrayBuffer);
    assert.equal(preset.format, 'xpm');
    assert.equal(preset.regions.length, 4);
    const first = preset.regions[0];
    assert.equal(first.detuneCents, 125);
    assert.ok(Math.abs(first.volumeDb - -3) < 0.01);
    assert.equal(first.pan, -10);
    assert.equal(first.loopMode, 'loop_continuous');
  });

  await test('More than 4 layers spill into overlapping keygroups', () => {
    const many: MpcSourceRegion[] = Array.from({ length: 6 }, (_, i) => ({
      ...REGIONS[2], sampleName: `L${i}.wav`, lowVel: i * 20 + 1, highVel: i * 20 + 20,
    }));
    const insts = regionsToMpcInstruments(many, 'Keygroup');
    assert.equal(insts.length, 2);
    assert.equal(insts[0].layers.length, 4);
    assert.equal(insts[1].layers.length, 2);
    assert.equal(insts[1].lowNote, insts[0].lowNote);
  });

  await test('Drum program: pads map from note 36, RootNote 0', () => {
    const xml = writeMpcXpm({ name: 'Kit', type: 'Drum', instruments: regionsToMpcInstruments(REGIONS.slice(2, 3), 'Drum') });
    assert.match(xml, /<PadNote number="1"><Note>36<\/Note><\/PadNote>/);
    const prog = parseMpcXpmXml(xml);
    assert.equal(prog.type, 'Drum');
    assert.equal(prog.instruments[0].layers[0].rootNote, -1);
  });

  await test('XPN expansion with Expansion.xml + program + WAV imports via universal parser', async () => {
    const xml = writeMpcXpm({ name: 'Bass Test', type: 'Keygroup', instruments: regionsToMpcInstruments(REGIONS, 'Keygroup') });
    const meta = buildExpansionXml({ identifier: 'com.abd.test', title: 'Test', manufacturer: 'ABD', version: '1.0.0', type: 'instrument', description: 'x' });
    assert.equal(parseExpansionXml(meta).identifier, 'com.abd.test');
    const zip = createZipArchive([
      { path: 'Expansion.xml', data: meta },
      { path: 'Bass Test.xpm', data: xml },
      { path: 'Bass_C2.WAV', data: new Uint8Array([1, 2, 3]) },
    ]);
    const preset = await parseUniversalSampler('test.xpn', zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer);
    assert.equal(preset.format, 'xpm');
    assert.equal(preset.regions[0].sampleName, 'Bass_C2.WAV'); // case-insensitive stem resolution
  });

  // ── Real corpus ────────────────────────────────────────────────────────
  const xpms = findFiles(CORPUS, '.xpm').filter((p) => !p.includes('[Previews]'));

  await test(`Real corpus: every .xpm parses (${xpms.length} files)`, async () => {
    if (xpms.length === 0) return 'skip';
    let layers = 0;
    for (const f of xpms) {
      const prog = await parseMpcXpm(new Uint8Array(readFileSync(f)));
      assert.ok(prog.instruments.length > 0, `no instruments in ${f}`);
      layers += prog.instruments.reduce((a, i) => a + i.layers.length, 0);
    }
    assert.ok(layers > xpms.length);
  });

  await test('Real keygroup (Electric Bass) RootNote offset and sibling WAVs resolve', async () => {
    const f = xpms.find((p) => /Bass-GPS Bass-Clean\.xpm$/.test(p));
    if (!f) return 'skip';
    const prog = await parseMpcXpm(new Uint8Array(readFileSync(f)));
    assert.equal(prog.type, 'Keygroup');
    const kg = prog.instruments.find((i) => i.lowNote === 33);
    assert.ok(kg);
    assert.equal(kg.layers[0].rootNote, 34); // file RootNote 35 -> MIDI 34
    const dir = path.dirname(f);
    const wavs = new Set(readdirSync(dir).map((n) => n.toLowerCase()));
    assert.ok(wavs.has(`${kg.layers[0].sampleName.toLowerCase()}.wav`), 'sample stem must match sibling WAV');
  });

  await test('Real drum kit parses as Drum with pad notes', async () => {
    const f = xpms.find((p) => /Kit-Dirty Drummer Demo Kit\.xpm$/.test(p));
    if (!f) return 'skip';
    const prog = await parseMpcXpm(new Uint8Array(readFileSync(f)));
    assert.equal(prog.type, 'Drum');
    assert.equal(prog.padNotes[0], 36);
    assert.ok(prog.instruments[0].layers.length >= 1);
  });

  await test('Real MPC3 .xpn (GZIP JSON programs) parses', async () => {
    const xpn = findFiles(CORPUS, '.xpn').find((p) => /MPC3/.test(p));
    if (!xpn) return 'skip';
    const buf = readFileSync(xpn);
    const preset = await parseUniversalSampler(path.basename(xpn), buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    assert.equal(preset.format, 'xpm');
    assert.ok(preset.regions.length > 0, 'MPC3 program should yield regions');
    assert.ok(preset.audioBuffers.size > 0);
  });

  await test('Real MPC3 track files: .xtd parses as Drum, .xty as Keygroup', async () => {
    const xtd = findFiles(CORPUS, '.xtd').find((p) => /Kit-RDK 001 Rusty Drum Kit\.xtd$/.test(p));
    const xty = findFiles(CORPUS, '.xty').find((p) => /Bass-GPS Bass-Clean\.xty$/.test(p));
    if (!xtd || !xty) return 'skip';
    const d = await parseMpcXpm(new Uint8Array(readFileSync(xtd)));
    assert.equal(d.type, 'Drum');
    assert.equal(d.name, 'Kit-RDK 001 Rusty Drum Kit');
    assert.ok(d.instruments.length > 0);
    const k = await parseMpcXpm(new Uint8Array(readFileSync(xty)));
    assert.equal(k.type, 'Keygroup');
    assert.ok(k.instruments.length > 0);
  });

  await test('Real MPC 1.x program (File_Version 1.7) reads <Name>', async () => {
    const f = findFiles(CORPUS, '.xpn').find((p) => /The Reaper MPC Software Installer\.xpn$/.test(p));
    if (!f) return 'skip';
    const buf = readFileSync(f);
    const preset = await parseUniversalSampler(path.basename(f), buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    assert.equal(preset.presetName, 'Bass-Reaper Upright Bass');
    assert.equal(preset.programCount, 3);
    assert.equal(preset.regions.filter((r) => preset.audioBuffers.has(r.sampleName)).length, preset.regions.length);
  });

  await test('Real MPC3 sliced WAV ("atem" chunk) slices pads via shared DRY slicer', async () => {
    const xtd = findFiles(CORPUS, '.xtd').find((p) => /Kit-RDK 001 Rusty Drum Kit\.xtd$/.test(p));
    const wav = findFiles(CORPUS, '.wav').find((p) => /MPC3-RDK Snares\.wav$/.test(p));
    if (!xtd || !wav) return 'skip';
    const wavBuf = readFileSync(wav);
    const wavAb = wavBuf.buffer.slice(wavBuf.byteOffset, wavBuf.byteOffset + wavBuf.byteLength) as ArrayBuffer;
    const sliceRes = parseSliceFile(wavAb, 'MPC3-RDK Snares.wav');
    assert.ok(sliceRes);
    assert.equal(sliceRes.format, 'wav-cue');
    assert.equal(sliceRes.markers.length, 76);
    assert.equal(sliceRes.markers[9].frame, 527098);
    assert.equal(sliceRes.markers[9].durationFrames, 594002 - 527098);

    const prog = await parseMpcXpm(new Uint8Array(readFileSync(xtd)));
    const preset = mpcProgramToPreset(prog, new Map([['MPC3-RDK Snares.wav', wavAb]]));
    assert.equal(preset.isSliceChain, true);
    assert.ok(preset.audioBuffers.has('MPC3-RDK Snares_slice_s09.wav'));
    assert.ok(preset.audioBuffers.has('MPC3-RDK Snares_slice_s06.wav'));
    assert.ok((preset.audioBuffers.get('MPC3-RDK Snares_slice_s09.wav')?.byteLength ?? 0) < wavAb.byteLength / 10);
  });

  await test('Multi-program .xpn archive lists selectable programs and loads selectedProgramPath', async () => {
    const prog1 = writeMpcXpm({
      name: 'Warm Pad',
      type: 'Keygroup',
      instruments: regionsToMpcInstruments([
        { sampleName: 'Pad_C3', rootKey: 60, lowKey: 0, highKey: 127, lowVel: 1, highVel: 127, sampleEnd: 64 },
      ], 'Keygroup'),
    });
    const prog2 = writeMpcXpm({
      name: 'Bright Lead',
      type: 'Keygroup',
      instruments: regionsToMpcInstruments([
        { sampleName: 'Lead_C4', rootKey: 72, lowKey: 0, highKey: 127, lowVel: 1, highVel: 127, sampleEnd: 64 },
      ], 'Keygroup'),
    });
    const meta = buildExpansionXml({
      identifier: 'com.abd.multixpn',
      title: 'Multi XPN',
      manufacturer: 'ABD',
      version: '1.0.0',
      type: 'instrument',
      description: 'Multi',
    });
    const zipBytes = createZipArchive([
      { path: 'Expansion.xml', data: meta },
      { path: 'Warm Pad.xpm', data: prog1 },
      { path: 'Bright Lead.xpm', data: prog2 },
      { path: 'Pad_C3.wav', data: new Uint8Array([1, 2, 3, 4]) },
      { path: 'Lead_C4.wav', data: new Uint8Array([5, 6, 7, 8]) },
    ]);
    const xpnBuf = zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength) as ArrayBuffer;

    const progs = await listZipSamplerPrograms('Multi.xpn', xpnBuf);
    assert.equal(progs.length, 2);
    assert.equal(progs[0].name, 'Warm Pad');
    assert.equal(progs[1].name, 'Bright Lead');

    const selected = await parseUniversalSampler('Multi.xpn', xpnBuf, undefined, progs[1].id);
    assert.equal(selected.presetName, 'Bright Lead');
    assert.equal(selected.regions.length, 1);
    assert.equal(selected.regions[0].rootKey, 72);
  });

  await test('Folder multi-instrument deduction separates named instruments without splitting bare notes', async () => {
    assert.equal(extractInstrumentPrefix('C3.wav'), 'Instrument');
    assert.equal(extractInstrumentPrefix('F#4_v127.wav'), 'Instrument');
    assert.equal(extractInstrumentPrefix('060_vl1.wav'), 'Instrument');
    assert.equal(extractInstrumentPrefix('Rhodes_C3_v100.wav'), 'Rhodes');
    assert.equal(extractInstrumentPrefix('01_WarmPad_A2.wav'), 'WarmPad');

    const dummyBuf = new ArrayBuffer(64);
    const singleInstFiles = [
      { path: 'C3.wav', name: 'C3.wav', buffer: dummyBuf },
      { path: 'E3.wav', name: 'E3.wav', buffer: dummyBuf },
      { path: 'G3.wav', name: 'G3.wav', buffer: dummyBuf },
    ];
    assert.equal(extractFolderFilesToCandidates(singleInstFiles).length, 1);

    const multiInstFiles = [
      { path: 'Piano_C3.wav', name: 'Piano_C3.wav', buffer: dummyBuf },
      { path: 'Piano_G3.wav', name: 'Piano_G3.wav', buffer: dummyBuf },
      { path: 'Strings_C3.wav', name: 'Strings_C3.wav', buffer: dummyBuf },
      { path: 'Strings_G3.wav', name: 'Strings_G3.wav', buffer: dummyBuf },
    ];
    const candidates = extractFolderFilesToCandidates(multiInstFiles);
    assert.equal(candidates.length, 2);
    assert.deepEqual(candidates.map((c) => c.name).sort(), ['Piano', 'Strings']);
  });

  await test('ABDShared Common Data Dictionary v2.0 (sampler_voice_parameter_spec + MidiTranslationEngine)', async () => {
    const engine = new MidiTranslationEngine(samplerSpec as any);
    assert.equal(MidiTranslationEngine.getParameterIds().length, 42);

    // SymBipolar hardware zero-center (wire 64 -> 0.0 physical)
    const panDef = engine.getMeta('MasterPan')!;
    assert.ok(panDef);
    assert.equal(panDef.id, 'masterPan');
    assert.ok(Math.abs(engine.wireToDomain('masterPan', 64)) < 1e-9);
    assert.equal(engine.domainToWire('masterPan', 0), 64);
    assert.ok(Math.abs(engine.wireToDomain('masterPan', 0) - (-1.0)) < 1e-9);
    assert.ok(Math.abs(engine.wireToDomain('masterPan', 127) - 1.0) < 1e-9);

    // Exponential curve: 0.001 * exp(11.512925464970229 * t) -> [0.001 .. 100.0] s
    const atkDef = engine.getMeta('AmpEnvAttack')!;
    assert.equal(atkDef.id, 'ampEnvAttackSec');
    const atkMin = engine.normalizedToDomain('ampEnvAttackSec', 0);
    const atkMid = engine.normalizedToDomain('ampEnvAttackSec', 0.5);
    const atkMax = engine.normalizedToDomain('ampEnvAttackSec', 1);
    assert.ok(Math.abs(atkMin - 0.001) < 1e-6);
    assert.ok(Math.abs(atkMid - Math.sqrt(0.001 * 100)) < 1e-3);
    assert.ok(Math.abs(atkMax - 100) < 1e-2);
    assert.ok(Math.abs(engine.domainToNormalized('ampEnvAttackSec', atkMid) - 0.5) < 1e-6);
  });

  await test('Lazy ZIP indexer (indexZipArchive + extractZipEntry) and RawSamplerExporter mpc_xpm / mpc_xpn', async () => {
    const sine = new Float32Array(256);
    for (let i = 0; i < sine.length; i++) sine[i] = Math.sin((2 * Math.PI * i) / 32) * 0.5;
    const wavBuf = encodeWavPcm16([sine], 44100);

    const mockSession: Session = {
      id: 'sess-mpc-exp',
      name: 'SynthBell',
      zones: [
        {
          id: 'z1',
          lowKey: 36,
          rootKey: 60,
          highKey: 84,
          sampleLow: 'Bell_C3.wav',
          sampleHigh: null,
          detune: 0,
          volume: 0,
          pan: 0,
        },
      ],
      extendedRegions: [
        {
          id: 'r1',
          sampleName: 'Bell_C3.wav',
          lowKey: 36,
          highKey: 84,
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
          fadeCurve: 'equal-power',
          loopMode: 'loop_continuous',
          loopStart: 32,
          loopEnd: 224,
          loopCrossfadeMs: 5,
          muteGroup: 2,
          sampleStartFrame: 0,
          sampleEndFrame: 256,
        },
      ],
      processConfig: {
        modelNumber: 1,
        modelName: 'SynthBell',
        expandedName: 'SynthBell Extended',
        complexity: 8,
        parameterSet: 2,
      },
      dirty: false,
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    };

    const exportedXpn = await exportRawSamplerLibrary(
      mockSession,
      {
        format: 'mpc_xpn',
        resolution: 'original',
        sampleRate: 'original',
        normalization: 'none',
        layout: 'folder_samples',
        bankName: 'SynthBell',
        author: 'ABD',
        license: 'CC0',
      },
      (name) => (name === 'Bell_C3.wav' ? wavBuf : undefined)
    );

    assert.equal(exportedXpn.filename, 'SynthBell.xpn');
    const idx = indexZipArchive(exportedXpn.data);
    assert.equal(idx.length, 3); // Expansion.xml + SynthBell.xpm + Bell_C3.wav
    const expEntry = idx.find((e) => e.path === 'Expansion.xml');
    assert.ok(expEntry);
    const expText = new TextDecoder().decode(extractZipEntry(exportedXpn.data, expEntry));
    assert.ok(expText.includes('<title>SynthBell</title>'));

    // Round-trip re-import via parseUniversalSampler
    const reimported = await parseUniversalSampler(
      exportedXpn.filename,
      exportedXpn.data.buffer.slice(exportedXpn.data.byteOffset, exportedXpn.data.byteOffset + exportedXpn.data.byteLength) as ArrayBuffer
    );
    assert.equal(reimported.format, 'xpm');
    assert.equal(reimported.presetName, 'SynthBell');
    assert.equal(reimported.regions.length, 1);
    assert.equal(reimported.regions[0].rootKey, 60);
    assert.equal(reimported.regions[0].loopMode, 'loop_continuous');

    // Fase 33.1 UniversalSamplerInstrument round-trip & FormatCapabilities fidelity check
    const uni = sessionToUniversalSamplerInstrument(mockSession);
    assert.equal(uni.regions[0].loops?.length, 1);
    assert.equal(uni.regions[0].loops?.[0].startFrame, 32);
    assert.equal(uni.groups[0].muteGroup, 2);

    const normParams = extractNormalizedDictionaryParams(uni);
    assert.ok(normParams.filterCutoffHz >= 0 && normParams.filterCutoffHz <= 1);
    const updatedUni = applyNormalizedDictionaryParams(uni, { ...normParams, pitchBendUpSt: 0.5 });
    assert.equal(updatedUni.articulation.pitchBendUpSt, 12);

    // Check FormatCapabilities fidelity warnings when ping-pong loop is exported to MPC
    uni.regions[0].loopMode = 'ping_pong';
    const notices = evaluateFormatFidelity(uni, 'mpc_xpm');
    assert.ok(notices.some((n) => n.feature === 'ping_pong_loop'));

    // Fase 33.3 — Verify @abdsynths/shared/formats/sampler unified entry points
    const {
      parseUniversalSamplerInstrument,
      exportUniversalSamplerInstrument,
      universalInstrumentToNativeImportResult,
    } = await import('@abdsynths/shared/formats/sampler');

    const parsedUni = await parseUniversalSamplerInstrument(
      exportedXpn.filename,
      exportedXpn.data.buffer.slice(
        exportedXpn.data.byteOffset,
        exportedXpn.data.byteOffset + exportedXpn.data.byteLength
      ) as ArrayBuffer
    );
    assert.equal(parsedUni.name, 'SynthBell');
    assert.equal(parsedUni.regions.length, 1);
    assert.ok(parsedUni.audioPool && parsedUni.audioPool.size === 1);

    const sf2Export = await exportUniversalSamplerInstrument(parsedUni, {
      format: 'sf2',
      resolution: 'pcm16',
      sampleRate: 'original',
      normalization: 'none',
      layout: 'monolithic',
      bankName: 'SynthBell',
    });
    assert.equal(sf2Export.filename, 'SynthBell.sf2');

    // Re-import SF2 directly into UniversalSamplerInstrument
    const sf2Uni = await parseUniversalSamplerInstrument(
      sf2Export.filename,
      sf2Export.data.buffer.slice(
        sf2Export.data.byteOffset,
        sf2Export.data.byteOffset + sf2Export.data.byteLength
      ) as ArrayBuffer
    );
    assert.equal(sf2Uni.regions.length, 1);
    assert.equal(sf2Uni.regions[0].rootKey, 60);
    const nativeRes = universalInstrumentToNativeImportResult(sf2Uni, 'sf2');
    assert.equal(nativeRes.classicZones.length > 0, true);
  });

  console.log(`\n${passed}/${passed + failed} passed${skipped ? `, ${skipped} skipped` : ''}`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
