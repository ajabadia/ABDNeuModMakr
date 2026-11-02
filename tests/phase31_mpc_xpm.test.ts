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
import { parseUniversalSampler } from '../src/core/import/rawSamplerParsers.ts';
import { createZipArchive } from '../src/formats/ZipArchive.ts';

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

  console.log(`\n${passed}/${passed + failed} passed${skipped ? `, ${skipped} skipped` : ''}`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
