// ABDNeuModMakr — Fase 28: Decent Sampler deep parity + Kontakt inspection/NCW tests
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { parseDecentSamplerPreset, isDecentSamplerEncrypted } from '../src/formats/DecentSamplerParser.ts';
import {
  inspectKontaktFile,
  parseKontaktXmlZones,
  inflateKontaktPatch,
  decodeNcw,
} from '../src/formats/KontaktParser.ts';

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

const DS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<DecentSampler minVersion="1.0.0">
  <ui width="812" height="375"><tab name="main"><labeled-knob label="Tone" /></tab></ui>
  <groups>
    <group seqMode="round_robin" loNote="60" hiNote="64">
      <sample path="Samples/C4_rr1.wav" rootNote="60" />
      <sample path="Samples/C4_rr2.wav" rootNote="60" />
      <sample path="Samples/C4_rr3.wav" rootNote="60" />
    </group>
    <group trigger="release" pitchKeyTrack="0" releaseDecay="1.5" volume="-6">
      <sample path="Samples/keyoff.wav" loNote="0" hiNote="127" rootNote="60" />
    </group>
    <group>
      <sample path="Samples/pad.wav" loNote="C5" hiNote="B5" rootNote="F#5" loopEnabled="true" loopStart="100" loopEnd="4000" />
    </group>
  </groups>
  <effects><lowpass frequency="8000" resonance="0.7" /><reverb wetLevel="0.3" /></effects>
  <modulators><envelope attack="0.05" decay="0.3" sustain="0.6" release="1.2" /><lfo shape="sine" frequency="5" /></modulators>
</DecentSampler>`;

const payloads = new Map<string, Uint8Array>([
  ['Samples/C4_rr1.wav', new Uint8Array([1, 2, 3])],
  ['Samples/keyoff.wav', new Uint8Array([4, 5])],
]);

// Build a synthetic NCW file (1 block, 2 channels, mid-side, delta 16-bit)
function buildNcw(mid: number[], side: number[]): Uint8Array {
  const n = 512;
  const bits = 16;
  const blockSize = 16 + (bits * n) / 8;
  const blockDefOffset = 120;
  const blocksOffset = blockDefOffset + 4;
  const buf = new Uint8Array(blocksOffset + blockSize * 2);
  const dv = new DataView(buf.buffer);
  buf.set([0x01, 0xa8, 0x9e, 0xd6], 0);
  dv.setUint16(8, 2, true);
  dv.setUint16(10, 16, true);
  dv.setUint32(12, 44100, true);
  dv.setUint32(16, n, true);
  dv.setUint32(20, blockDefOffset, true);
  dv.setUint32(24, blocksOffset, true);
  dv.setUint32(blockDefOffset, 0, true);
  const writeBlock = (pos: number, vals: number[]) => {
    dv.setUint32(pos, 0x3e9a0c16, true);
    dv.setInt32(pos + 4, vals[0], true);
    dv.setInt16(pos + 8, bits, true);
    dv.setUint16(pos + 10, 1, true);
    for (let i = 0; i < n; i++) {
      const d = i + 1 < vals.length ? vals[i + 1] - vals[i] : 0;
      dv.setInt16(pos + 16 + i * 2, d, true);
    }
  };
  writeBlock(blocksOffset, mid);
  writeBlock(blocksOffset + blockSize, side);
  return buf;
}

async function main(): Promise<void> {
  console.log('\nFase 28 — Decent Sampler & Kontakt compatibility');
  const res = parseDecentSamplerPreset(DS_XML, payloads, 'Felt Piano');

  await test('DS parses all 5 samples into regions', () => {
    assert.equal(res.extendedRegions.length, 5);
  });
  await test('DS round-robin positions 1..3 with seqLength 3', () => {
    const rr = res.extendedRegions.filter((r) => r.sampleName.startsWith('C4_rr'));
    assert.deepEqual(rr.map((r) => r.seqPosition), [1, 2, 3]);
    assert.ok(rr.every((r) => r.seqLength === 3));
    assert.equal(res.roundRobinGroups, 1);
  });
  await test('DS release trigger inherits group pitchKeyTrack=0 and volume', () => {
    const rel = res.extendedRegions.find((r) => r.sampleName === 'keyoff.wav');
    assert.ok(rel);
    assert.equal(rel.trigger, 'release');
    assert.equal(rel.pitchKeytrack, 0);
    assert.equal(rel.volume, -6);
    assert.equal(res.releaseTriggerRegions, 1);
  });
  await test('DS note names and loop points are parsed', () => {
    const pad = res.extendedRegions.find((r) => r.sampleName === 'pad.wav');
    assert.ok(pad);
    assert.equal(pad.lowKey, 72);
    assert.equal(pad.highKey, 83);
    assert.equal(pad.rootKey, 78);
    assert.equal(pad.loopMode, 'loop_continuous');
    assert.equal(pad.loopEnd, 4000);
  });
  await test('DS effects and envelope modulator mapped to articulation', () => {
    assert.deepEqual(res.effects.map((e) => e.type), ['lowpass', 'reverb']);
    assert.equal(res.articulation.ampEnv.attackSec, 0.05);
    assert.equal(res.articulation.ampEnv.sustainLevel, 0.6);
  });
  await test('DS audio payloads deduplicated and attached', () => {
    assert.equal(res.audioFiles.length, 2);
    assert.equal(res.classicZones.length > 0, true);
  });
  await test('DS encrypted detection', () => {
    assert.equal(isDecentSamplerEncrypted('<sample path="a.enc" />'), true);
    assert.equal(isDecentSamplerEncrypted(DS_XML), false);
  });

  await test('Kontakt DRM marker flagged as encrypted, not importable', () => {
    const b = new Uint8Array(64);
    b.set([0x2a, 0x47, 0x24, 0x4e], 20);
    const d = inspectKontaktFile('Strings.nki', b);
    assert.equal(d.kind, 'nki-encrypted');
    assert.equal(d.encrypted, true);
    assert.equal(d.importable, false);
    assert.ok(d.conversionGuide.length > 0);
  });
  await test('Kontakt monolith .nkx flagged encrypted', () => {
    assert.equal(inspectKontaktFile('lib.nkx', new Uint8Array(8)).kind, 'monolith-encrypted');
  });
  await test('Kontakt open XML zones extracted', () => {
    const xml = '<?xml version="1.0"?><K4><Zone sampleFile="s/A3.wav" lowKey="55" highKey="59" rootKey="57" lowVel="1" highVel="100" /></K4>';
    assert.equal(inspectKontaktFile('x.nki', new TextEncoder().encode(xml)).kind, 'nki-xml');
    const z = parseKontaktXmlZones(xml);
    assert.equal(z.length, 1);
    assert.deepEqual([z[0].sampleName, z[0].lowKey, z[0].highKey, z[0].rootKey, z[0].highVel], ['A3.wav', 55, 59, 57, 100]);
  });
  await test('Kontakt zlib patch detected and inflated', async () => {
    const xml = '<K4><Zone file="B.wav" rootKey="62" /></K4>';
    const header = new Uint8Array(12);
    const z = deflateSync(Buffer.from(xml));
    const bytes = new Uint8Array(header.length + z.length);
    bytes.set(z, header.length);
    assert.equal(inspectKontaktFile('old.nki', bytes).kind, 'nki-zlib');
    const text = await inflateKontaktPatch(bytes);
    assert.equal(text, xml);
    assert.equal(parseKontaktXmlZones(text ?? '')[0].rootKey, 62);
  });
  await test('NCW mid-side delta block decodes to PCM', () => {
    const mid = Array.from({ length: 512 }, (_, i) => i * 10);
    const side = Array.from({ length: 512 }, () => 100);
    const ncw = buildNcw(mid, side);
    assert.equal(inspectKontaktFile('a.ncw', ncw).kind, 'ncw');
    const out = decodeNcw(ncw);
    assert.equal(out.sampleRate, 44100);
    assert.equal(out.channels.length, 2);
    const s = 1 / 32768;
    assert.ok(Math.abs(out.channels[0][5] - (50 + 100) * s) < 1e-9);
    assert.ok(Math.abs(out.channels[1][5] - (50 - 100) * s) < 1e-9);
  });
  await test('Unknown bytes never throw', () => {
    assert.equal(inspectKontaktFile('z.nki', new Uint8Array([9, 9, 9])).importable, false);
  });

  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
