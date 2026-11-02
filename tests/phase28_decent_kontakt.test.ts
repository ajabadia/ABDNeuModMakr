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
  const blocksOffset = blockDefOffset + 8; // table has blockCount + 1 entries
  const buf = new Uint8Array(blocksOffset + blockSize * 2);
  const dv = new DataView(buf.buffer);
  buf.set([0x01, 0xa8, 0x9e, 0xd6], 0);
  dv.setUint32(4, 0x131, true);
  dv.setUint16(8, 2, true);
  dv.setUint16(10, 16, true);
  dv.setUint32(12, 44100, true);
  dv.setUint32(16, n, true);
  dv.setUint32(20, blockDefOffset, true);
  dv.setUint32(24, blocksOffset, true);
  dv.setUint32(blockDefOffset, 0, true);
  dv.setUint32(blockDefOffset + 4, blockSize * 2, true);
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

  await test('Kontakt 5+ NI container ("hsin" @12) detected, DRM via Encryption chunk', () => {
    const plain = new Uint8Array(128);
    plain.set([0x68, 0x73, 0x69, 0x6e], 12); // "hsin"
    const d1 = inspectKontaktFile('Piano.nki', plain);
    assert.equal(d1.kind, 'nki-k5-container');
    assert.equal(d1.encrypted, false);

    const enc = new Uint8Array(256);
    enc.set([0x68, 0x73, 0x69, 0x6e], 12);
    const dv = new DataView(enc.buffer);
    const off = 64; // data chunk: u64 len, domain, u32 type, u32 version
    dv.setUint32(off, 40, true);
    enc.set([0x68, 0x73, 0x69, 0x6e], off + 8);
    dv.setUint32(off + 12, 116, true);
    const d2 = inspectKontaktFile('Strings.nki', enc);
    assert.equal(d2.kind, 'nki-k5-encrypted');
    assert.equal(d2.encrypted, true);
    assert.equal(d2.importable, false);
    assert.ok(d2.conversionGuide.length > 0);
  });
  await test('Kontakt K5 file-container monolith and resource containers classified', () => {
    const mono = new TextEncoder().encode('/\\ NI FC MTD  /\\' + '\0'.repeat(32));
    assert.equal(inspectKontaktFile('lib.nki', mono).kind, 'monolith-k5');
    assert.equal(inspectKontaktFile('lib.nkx', new Uint8Array(8)).kind, 'resource-container');
  });
  await test('Kontakt K2_Zone XML zones extracted (file_ex2)', () => {
    const xml = '<?xml version="1.0"?><K2_Program><K2_Zone file_ex2="@b Samples:A3.wav" lowKey="55" highKey="59" rootKey="57" lowVelocity="1" highVelocity="100" /></K2_Program>';
    assert.equal(inspectKontaktFile('x.nki', new TextEncoder().encode(xml)).kind, 'nki-xml');
    const z = parseKontaktXmlZones(xml);
    assert.equal(z.length, 1);
    assert.deepEqual([z[0].sampleName, z[0].lowKey, z[0].highKey, z[0].rootKey, z[0].highVel], ['A3.wav', 55, 59, 57, 100]);
  });
  await test('Kontakt 2 header detected and zlib body inflated', async () => {
    const xml = '<K2_Program><K2_Zone file_ex2="B.wav" rootKey="62" /></K2_Program>';
    const header = new Uint8Array(170);
    header.set([0x12, 0x90, 0xa8, 0x7f], 0); // K2 instrument, little-endian file
    const hdv = new DataView(header.buffer);
    hdv.setUint32(4, 1000, true); // compressedLength
    hdv.setUint16(8, 0x100, true); // headerVersion K2
    const z = deflateSync(Buffer.from(xml));
    const bytes = new Uint8Array(header.length + z.length);
    bytes.set(header, 0);
    bytes.set(z, header.length);
    assert.equal(inspectKontaktFile('old.nki', bytes).kind, 'nki-k2-zlib');
    const text = await inflateKontaktPatch(bytes);
    assert.equal(text, xml);
    assert.equal(parseKontaktXmlZones(text ?? '')[0].rootKey, 62);
  });
  await test('Kontakt 4.2 header flagged as FastLZ (not yet importable)', () => {
    const b = new Uint8Array(64);
    b.set([0x12, 0x90, 0xa8, 0x7f], 0);
    const dv = new DataView(b.buffer);
    dv.setUint32(4, 1000, true);
    dv.setUint16(8, 0x110, true);
    assert.equal(inspectKontaktFile('k42.nki', b).kind, 'nki-k42-fastlz');
  });
  await test('NCW float flag reinterprets 32-bit payload as IEEE float', () => {
    const n = 512;
    const blockSize = 16 + 4 * n;
    const buf = new Uint8Array(120 + 8 + blockSize);
    const dv = new DataView(buf.buffer);
    buf.set([0x01, 0xa8, 0x9e, 0xd6], 0);
    dv.setUint32(4, 0x130, true);
    dv.setUint16(8, 1, true);
    dv.setUint16(10, 32, true);
    dv.setUint32(12, 48000, true);
    dv.setUint32(16, n, true);
    dv.setUint32(20, 120, true);
    dv.setUint32(24, 128, true);
    dv.setUint32(124, blockSize, true);
    dv.setUint32(128, 0x3e9a0c16, true);
    dv.setInt16(136, 0, true); // raw
    dv.setUint16(138, 2, true); // float flag
    for (let i = 0; i < n; i++) dv.setFloat32(144 + i * 4, 0.25, true);
    const out = decodeNcw(buf);
    assert.equal(out.isFloat, true);
    assert.ok(Math.abs(out.channels[0][10] - 0.25) < 1e-7);
  });
  await test('NCW rejects unsupported version', () => {
    const ncw = buildNcw([0], [0]);
    new DataView(ncw.buffer).setUint32(4, 0x999, true);
    assert.throws(() => decodeNcw(ncw));
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
