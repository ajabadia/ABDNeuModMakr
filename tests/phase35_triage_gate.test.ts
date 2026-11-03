// ─────────────────────────────────────────────────────────
// Tests for Fase 35 — Triage Gate adapter (Paso 0, opción A)
// Mixed folder / multi-file / .zip content opens the gate;
// single-format flows keep their fast paths.
// DOM-free: exercises the pure adapter + the discovery engine.
// ─────────────────────────────────────────────────────────

import { VirtualZipFs } from '../src/formats/VirtualZipFs.ts';
import { discoverSamplerAssets } from '../src/formats/MultiAssetDiscovery.ts';
import {
  buildTriageVfs,
  discoverTriageReport,
  indexTriageBuffers,
  isTriageAudioItem,
  partitionTriageSelection,
  resolveTriageItemFiles,
  shouldOpenTriageGate,
  type TriageExpandedFile,
} from '../src/app/triageGate.ts';
import { createZipArchive } from '@abdsynths/shared/formats/neuron';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

async function runPhase35Tests(): Promise<void> {
  console.log('=== PHASE 35: TRIAGE GATE TESTS ===');

  const makeDummyWav = (numSamples = 100): Uint8Array => {
    const header = new Uint8Array(44 + numSamples * 2);
    const view = new DataView(header.buffer);
    header.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
    view.setUint32(4, 36 + numSamples * 2, true);
    header.set([0x57, 0x41, 0x56, 0x45], 8); // WAVE
    header.set([0x66, 0x6d, 0x74, 0x20], 12); // fmt
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // 1 ch
    view.setUint32(24, 44100, true);
    view.setUint32(28, 88200, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    header.set([0x64, 0x61, 0x74, 0x61], 36); // data
    view.setUint32(40, numSamples * 2, true);
    return header;
  };
  const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

  // 1. Mixed zip (audio pack + SFZ + Decent) opens the gate
  {
    const zipBytes = createZipArchive([
      { path: 'Drums/kick.wav', data: makeDummyWav() },
      { path: 'Drums/snare.wav', data: makeDummyWav(120) },
      { path: 'Keys/piano.sfz', data: enc('<region> sample=piano_C4.wav key=60') },
      { path: 'Keys/piano_C4.wav', data: makeDummyWav(140) },
      { path: 'Bass/bass.dspreset', data: enc('{"name":"bass"}') },
      { path: 'Bass/bass_C2.wav', data: makeDummyWav(160) },
    ]);
    const vfs = await VirtualZipFs.fromZipBuffer(zipBytes, 'MixedPack.zip');
    assert(vfs.listFiles().length === 6, '1. vfs should list 6 files');
    const report = await discoverSamplerAssets(vfs, 'MixedPack.zip');
    const formats = new Set(report.items.map((it) => it.format));
    assert(report.items.length >= 3, `1. should discover 3+ entities (got ${report.items.length})`);
    assert(formats.size >= 2, `1. should span 2+ formats (got ${[...formats].join(',')})`);
    assert(formats.has('sfz'), '1. SFZ definition must be discovered');
    assert(formats.has('dspreset'), '1. Decent preset must be discovered');
    assert(shouldOpenTriageGate(report), '1. mixed content must open the gate');
    console.log('  [OK] 1. Mixed zip discovered, gate opens');
  }

  // 2. Same content as expanded entries resolves buffers 1:1 (primary + companions)
  {
    const files: TriageExpandedFile[] = [
      { name: 'Drums/kick.wav', buffer: makeDummyWav().buffer as ArrayBuffer },
      { name: 'Drums/snare.wav', buffer: makeDummyWav(120).buffer as ArrayBuffer },
      { name: 'Keys/piano.sfz', buffer: enc('<region> sample=piano_C4.wav key=60').buffer as ArrayBuffer },
      { name: 'Keys/piano_C4.wav', buffer: makeDummyWav(140).buffer as ArrayBuffer },
      { name: 'Bass/bass.dspreset', buffer: enc('{"name":"bass"}').buffer as ArrayBuffer },
      { name: 'Bass/bass_C2.wav', buffer: makeDummyWav(160).buffer as ArrayBuffer },
    ];
    const vfs = buildTriageVfs(files);
    assert(vfs.listFiles().length === 6, '2. triage VFS must expose all expanded entries');
    const report = await discoverTriageReport(files, 'MixedPack');
    assert(report !== null && shouldOpenTriageGate(report), '2. expanded entries must open the gate');
    const byPath = indexTriageBuffers(files);
    const sfz = report!.items.find((it) => it.format === 'sfz');
    assert(sfz !== undefined, '2. sfz item must exist');
    const sfzFiles = resolveTriageItemFiles(sfz!, byPath);
    assert(sfzFiles.length === 2, `2. sfz item must resolve primary + companion (got ${sfzFiles.length})`);
    assert(isTriageAudioItem(sfzFiles) === false, '2. sfz definition itself is not audio');
    const packs = report!.items.filter((it) => it.format === 'sample_pack');
    assert(packs.length >= 1, '2. sample pack items must exist');
    let totalPackFiles = 0;
    for (const pack of packs) {
      const packFiles = resolveTriageItemFiles(pack, byPath);
      assert(packFiles.length === pack.sampleCount, `2. pack "${pack.name}" must resolve exactly its samples`);
      assert(new Set(packFiles).size === packFiles.length, '2. resolved files must not duplicate');
      assert(isTriageAudioItem(packFiles), '2. pack files are all audio');
      totalPackFiles += packFiles.length;
    }
    assert(totalPackFiles === 2, `2. all drum samples must resolve (got ${totalPackFiles})`);
    console.log('  [OK] 2. Buffer resolution (primary + companions, no duplicates)');
  }

  // 3. Batch partition: audio packs + SF2 map through, exotic defs are skipped honestly
  {
    const files: TriageExpandedFile[] = [
      { name: 'Drums/kick.wav', buffer: makeDummyWav().buffer as ArrayBuffer },
      { name: 'Drums/snare.wav', buffer: makeDummyWav(120).buffer as ArrayBuffer },
      { name: 'Keys/piano.sfz', buffer: enc('<region> sample=piano_C4.wav key=60').buffer as ArrayBuffer },
      { name: 'Keys/piano_C4.wav', buffer: makeDummyWav(140).buffer as ArrayBuffer },
    ];
    const report = await discoverTriageReport(files, 'MixedPack');
    assert(report !== null && shouldOpenTriageGate(report), '3. fixture must open the gate');
    const part = partitionTriageSelection(report!.items, indexTriageBuffers(files));
    assert(part.audioInputs.length === 2, `3. drums pack must map to 2 audio inputs (got ${part.audioInputs.length})`);
    assert(part.sf2Blobs.length === 0, '3. no SF2 in fixture');
    assert(
      part.skipped.length === 1 && part.skipped[0].format === 'sfz',
      `3. sfz must be skipped with reason (got ${part.skipped.map((s) => s.format).join(',')})`
    );
    console.log('  [OK] 3. Partition maps audio, skips exotic defs');
  }

  // 4. Single-format content keeps the fast path (gate stays closed)
  {
    const audioOnly: TriageExpandedFile[] = [
      { name: 'Drums/kick.wav', buffer: makeDummyWav().buffer as ArrayBuffer },
      { name: 'Drums/snare.wav', buffer: makeDummyWav(120).buffer as ArrayBuffer },
    ];
    const audioReport = await discoverTriageReport(audioOnly, 'Drums');
    assert(audioReport !== null, '4. audio report must exist');
    assert(!shouldOpenTriageGate(audioReport), '4. pure audio folder must NOT open the gate');
    assert(!shouldOpenTriageGate(null), '4. null report must NOT open the gate');
    assert(
      !shouldOpenTriageGate({ items: [], totalSamples: 0, totalSizeBytes: 0, formatBreakdown: {} }),
      '4. empty report must NOT open the gate'
    );
    console.log('  [OK] 4. Single-format fast paths preserved');
  }

  console.log('=== ALL PHASE 35 TESTS PASSED ===');
}

runPhase35Tests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
