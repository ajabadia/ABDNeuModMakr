// ─────────────────────────────────────────────────────────
// Tests for Fase 29 — Equivalencia Transparente .ZIP como Carpeta
// y Multi-Asset Discovery con Triaje Batch
// ─────────────────────────────────────────────────────────

import { VirtualZipFs } from '../src/formats/VirtualZipFs.ts';
import { discoverSamplerAssets } from '../src/formats/MultiAssetDiscovery.ts';
import { createZipArchive } from '@abdsynths/shared/formats/neuron';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

async function runPhase29Tests(): Promise<void> {
  console.log('=== PHASE 29: VIRTUAL ZIP FS & MULTI-ASSET TRIAGE TESTS ===');

  // Helper to create a dummy WAV file
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

  // 1. VirtualZipFs basic mounting and path normalization
  {
    const wav1 = makeDummyWav();
    const wav2 = makeDummyWav();

    const zipBytes = createZipArchive([
      { path: 'Instruments/Piano/Piano_C3.wav', data: wav1 },
      { path: 'Instruments/Piano/Piano_C4.wav', data: wav2 },
      { path: 'Instruments/Bass/Bass_E1.wav', data: wav1 },
    ]);

    const vfs = await VirtualZipFs.fromZipBuffer(zipBytes, 'TestPack.zip');
    assert(vfs.listFiles().length === 3, '1. vfs should list 3 files');
    assert(vfs.hasFile('Instruments/Piano/Piano_C3.wav'), '1. vfs should find Piano_C3.wav');
    assert(vfs.hasFile('instruments/piano/piano_c3.wav'), '1. case-insensitive normalized lookup');

    const pianoFiles = vfs.listFilesUnder('Instruments/Piano');
    assert(pianoFiles.length === 2, '1. listFilesUnder should find 2 piano files');
    console.log('  [OK] 1. VirtualZipFs mounts zip buffer and normalizes virtual tree');
  }

  // 2. Nested ZIP mounting (ZIP inside ZIP)
  {
    const innerWav = makeDummyWav();
    const innerZip = createZipArchive([
      { path: 'InnerPreset/Preset_C3.wav', data: innerWav },
    ]);

    const outerZip = createZipArchive([
      { path: 'Root_Note.wav', data: innerWav },
      { path: 'Packs/NestedPack.zip', data: innerZip },
    ]);

    const vfs = await VirtualZipFs.fromZipBuffer(outerZip, 'Outer.zip', { mountNestedZips: true });
    assert(vfs.listFiles().length === 3, '2. vfs should mount outer and inner files (total 3)');
    assert(vfs.hasFile('Packs/NestedPack/InnerPreset/Preset_C3.wav'), '2. inner files mounted under prefix');
    console.log('  [OK] 2. Transparent nested ZIP unpacking in virtual memory');
  }

  // 3. Multi-Asset Discovery with heterogeneous definitions (.sfz + .dspreset + loose WAVs)
  {
    const wavBytes = makeDummyWav();
    const sfzText = new TextEncoder().encode('<region> sample=Violin_C3.wav key=60\n<region> sample=Violin_C4.wav key=72');
    const dsText = new TextEncoder().encode('<DecentSampler><groups><group><sample path="Cello_C2.wav" rootNote="36"/></group></groups></DecentSampler>');

    const compositeZip = createZipArchive([
      // SFZ Instrument
      { path: 'Violin/Violin.sfz', data: sfzText },
      { path: 'Violin/Violin_C3.wav', data: wavBytes },
      { path: 'Violin/Violin_C4.wav', data: wavBytes },

      // Decent Sampler Preset
      { path: 'Cello/Cello.dspreset', data: dsText },
      { path: 'Cello/Cello_C2.wav', data: wavBytes },

      // Loose synth samples
      { path: 'SynthLeads/MoogLead_C3.wav', data: wavBytes },
      { path: 'SynthLeads/MoogLead_C4.wav', data: wavBytes },
    ]);

    const vfs = await VirtualZipFs.fromZipBuffer(compositeZip, 'MegaLibrary.zip');
    const report = await discoverSamplerAssets(vfs, 'MegaLibrary.zip');

    assert(report.items.length === 3, `3. Expected 3 discovered instruments, got ${report.items.length}`);
    const sfzItem = report.items.find((it) => it.format === 'sfz');
    const dsItem = report.items.find((it) => it.format === 'dspreset');
    const packItem = report.items.find((it) => it.format === 'sample_pack');

    assert(Boolean(sfzItem), '3. Found SFZ instrument');
    assert(Boolean(dsItem), '3. Found Decent Sampler instrument');
    assert(Boolean(packItem), '3. Found loose sample pack instrument');

    assert(sfzItem?.companionFilePaths.length === 2, '3. SFZ captured 2 companion samples');
    assert(dsItem?.companionFilePaths.length === 1, '3. Decent Sampler captured 1 companion sample');
    assert(packItem?.sampleCount === 2, '3. Loose pack grouped 2 samples');
    assert(report.formatBreakdown['SFZ Instrument'] === 1, '3. Breakdown has 1 SFZ');
    assert(report.formatBreakdown['Decent Sampler'] === 1, '3. Breakdown has 1 DS');

    console.log('  [OK] 3. Multi-Asset discovery correctly isolates heterogeneous formats and bounds');
  }

  // 4. File-Slip and Security Sanitization
  {
    const dummy = makeDummyWav();
    const unsafeZip = createZipArchive([
      { path: '../../etc/passwd', data: dummy },
      { path: 'C:\\Windows\\System32\\cmd.exe', data: dummy },
      { path: '__MACOSX/._Piano.wav', data: dummy },
      { path: 'Valid/SafeSample.wav', data: dummy },
    ]);

    const vfs = await VirtualZipFs.fromZipBuffer(unsafeZip, 'Malicious.zip');
    const files = vfs.listFiles();
    assert(files.length === 1, `4. Only safe paths must be admitted (got ${files.length})`);
    assert(files[0].path === 'Valid/SafeSample.wav', '4. Valid path retained');
    console.log('  [OK] 4. Zip-slip and macOS junk metadata properly rejected');
  }

  console.log('=== ALL PHASE 29 TESTS PASSED ===');
}

runPhase29Tests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
