// ─────────────────────────────────────────────────────────
// tests/phase32_formats_akai_disk.test.ts — Akai S-Series Disk & Floppy Image Test Suite (Fase 32.5)
//
// Tests:
//   1. Akai S1000/S3000 CD-ROM / SCSI disk image detection, partition parsing, volume traversal.
//   2. Multi-volume program listing and extraction across partitions ('A', 'B'...).
//   3. Akai S1000 Program parsing: keygroups, velocity zones, envelopes, filters, and PCM16 waveform decoding.
//   4. Akai S900 / S950 3.5" floppy disk image detection, directory parsing, and program/sample extraction.
//   5. UniversalSamplerInstrument round-trip / conversion from Akai S-Series presets.
// ─────────────────────────────────────────────────────────

import assert from 'node:assert/strict';
import {
  identifyAkaiDisk,
  isAkaiDiskImage,
  listAkaiDiskPrograms,
  parseAkaiDiskProgram,
  AKAI_BLOCK_SIZE,
} from '../vendor/@abdsynths/shared/Code/SamplerFormats/AkaiDiskFormat.ts';
import {
  parseUniversalSampler,
  listZipSamplerPrograms,
} from '../vendor/@abdsynths/shared/Code/SamplerFormats/rawSamplerParsers.ts';
import {
  parseUniversalSamplerInstrument,
} from '../vendor/@abdsynths/shared/Code/SamplerFormats/UniversalSamplerModel.ts';

function toArrayBuffer(buf: Uint8Array): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

// ─── Synthetic Akai S1000 Disk Builder Helper ─────────────

function createMockS1000Disk(): Uint8Array {
  // Allocate 128 KB for synthetic image (16 blocks of 8192 bytes)
  const totalBlocks = 16;
  const disk = new Uint8Array(totalBlocks * AKAI_BLOCK_SIZE);
  const view = new DataView(disk.buffer);

  // Partition A starts at offset 0
  // Partition size in blocks: 8 blocks
  view.setInt16(0, 8, true);

  // FAT offset at 0x70A: mark some blocks allocated
  view.setInt16(0x70a + 1 * 2, 0, true);
  view.setInt16(0x70a + 2 * 2, 0, true);

  // Root directory entries at 0xCA:
  // Volume 1 (S1000 type = 1, start block = 1)
  const vol1Pos = 0xca;
  const vol1Name = new Uint8Array([11, 12, 13, 10, 10, 10, 10, 10, 10, 10, 10, 10]); // "ABC" in Akai encoding
  disk.set(vol1Name, vol1Pos);
  view.setInt16(vol1Pos + 12, 1, true); // type = S1000
  view.setInt16(vol1Pos + 14, 1, true); // start block = 1

  // Inside Volume 1 (Block 1):
  const vol1BlockOffset = 1 * AKAI_BLOCK_SIZE;

  // File 0: Program 'p' at Block 2
  const f0Pos = vol1BlockOffset;
  const f0Name = new Uint8Array([16, 19, 25, 24, 10, 10, 10, 10, 10, 10, 10, 10]); // "FION"
  disk.set(f0Name, f0Pos);
  disk[f0Pos + 16] = 'p'.charCodeAt(0);
  view.setInt16(f0Pos + 20, 2, true); // start block = 2

  // File 1: Sample 's' at Block 3
  const f1Pos = vol1BlockOffset + 24;
  const f1Name = new Uint8Array([29, 11, 23, 26, 10, 10, 10, 10, 10, 10, 10, 10]); // "SAMP"
  disk.set(f1Name, f1Pos);
  disk[f1Pos + 16] = 's'.charCodeAt(0);
  view.setInt16(f1Pos + 20, 3, true); // start block = 3

  // Inside Program (Block 2):
  const progOffset = 2 * AKAI_BLOCK_SIZE;
  disk[progOffset] = 1; // AKAI_PROGRAM_ID
  disk.set(f0Name, progOffset + 3);
  disk[progOffset + 15] = 0; // midiProgramNumber
  disk[progOffset + 16] = 0; // midiChannel
  disk[progOffset + 17] = 8; // polyphony
  disk[progOffset + 19] = 24; // lowKey
  disk[progOffset + 20] = 108; // highKey
  disk[progOffset + 21] = 0; // octaveShift
  disk[progOffset + 23] = 99; // stereoLevel
  view.setInt8(progOffset + 24, 0); // mixPan
  disk[progOffset + 25] = 99; // volume
  disk[progOffset + 39] = 2; // bendToPitch
  disk[progOffset + 42] = 1; // numberOfKeygroups = 1

  // Keygroup 1 at progOffset + 150:
  const kgOffset = progOffset + 150;
  disk[kgOffset] = 2; // AKAI_KEYGROUP_ID
  disk[kgOffset + 3] = 36; // lowKey = C2
  disk[kgOffset + 4] = 84; // highKey = C6
  view.setInt8(kgOffset + 5, 0); // tuneCents
  view.setInt8(kgOffset + 6, 0); // tuneSemitones
  disk[kgOffset + 7] = 99; // filter cutoff
  disk[kgOffset + 8] = 0; // keyToFilter

  // Amp Envelope (kgOffset + 12):
  disk[kgOffset + 12] = 20; // attack
  disk[kgOffset + 13] = 40; // decay
  disk[kgOffset + 14] = 80; // sustain
  disk[kgOffset + 15] = 30; // release

  // Zone 1 in Keygroup (kgOffset + 34):
  const zone1Offset = kgOffset + 34;
  disk.set(f1Name, zone1Offset); // sample name "SAMP"
  disk[zone1Offset + 12] = 1; // lowVel
  disk[zone1Offset + 13] = 127; // highVel
  view.setInt8(zone1Offset + 14, 0); // tuneCents
  view.setInt8(zone1Offset + 15, 0); // tuneSemi
  view.setInt8(zone1Offset + 16, 0); // loudness
  disk[zone1Offset + 19] = 0; // loopMode as sample

  // Inside Sample (Block 3):
  const smpOffset = 3 * AKAI_BLOCK_SIZE;
  disk[smpOffset] = 3; // AKAI_SAMPLE_ID
  disk[smpOffset + 1] = 1; // 44100 Hz
  disk[smpOffset + 2] = 60; // rootNote = C4
  disk.set(f1Name, smpOffset + 3);
  disk[smpOffset + 16] = 1; // activeLoops = 1
  disk[smpOffset + 17] = 1; // firstActiveLoop = 1
  disk[smpOffset + 19] = 1; // loopMode
  view.setInt32(smpOffset + 26, 100, true); // numberOfSamples = 100 words
  view.setInt32(smpOffset + 30, 0, true); // startMarker = 0
  view.setInt32(smpOffset + 34, 99, true); // endMarker = 99

  // Loop 0 (smpOffset + 38):
  view.setInt32(smpOffset + 38, 99, true); // loop end marker
  view.setUint16(smpOffset + 42, 0, true); // fine length
  view.setInt32(smpOffset + 44, 50, true); // coarse length = 50
  view.setUint16(smpOffset + 48, 9999, true); // time infinite

  view.setUint16(smpOffset + 138, 44100, true); // sampleRate

  // PCM16 waveform at smpOffset + 150 (100 samples sine/ramp):
  for (let i = 0; i < 100; i++) {
    const val = Math.round(Math.sin((i / 100) * Math.PI * 2) * 20000);
    view.setInt16(smpOffset + 150 + i * 2, val, true);
  }

  // Partition B starts at offset 8 * AKAI_BLOCK_SIZE
  const partBOffset = 8 * AKAI_BLOCK_SIZE;
  view.setInt16(partBOffset, 8, true); // 8 blocks

  // Root directory in Partition B:
  const partBVolPos = partBOffset + 0xca;
  const partBVolName = new Uint8Array([28, 30, 28, 10, 10, 10, 10, 10, 10, 10, 10, 10]); // "RTR"
  disk.set(partBVolName, partBVolPos);
  view.setInt16(partBVolPos + 12, 1, true); // S1000
  view.setInt16(partBVolPos + 14, 1, true); // start block = 1 relative to part B

  const partBVol1Pos = partBOffset + 1 * AKAI_BLOCK_SIZE;
  const partBProgName = new Uint8Array([12, 11, 29, 29, 10, 10, 10, 10, 10, 10, 10, 10]); // "BASS"
  disk.set(partBProgName, partBVol1Pos);
  disk[partBVol1Pos + 16] = 'p'.charCodeAt(0);
  view.setInt16(partBVol1Pos + 20, 2, true); // start block = 2 relative to part B

  const partBProgOffset = partBOffset + 2 * AKAI_BLOCK_SIZE;
  disk[partBProgOffset] = 1; // AKAI_PROGRAM_ID
  disk.set(partBProgName, partBProgOffset + 3);
  disk[partBProgOffset + 17] = 16;
  disk[partBProgOffset + 42] = 0; // 0 keygroups

  return disk;
}

// ─── Synthetic Akai S900 Floppy Builder Helper ────────────

const S900_BLOCK_SIZE = 1024;

function createMockS900Floppy(): Uint8Array {
  // Standard 720KB floppy = 720 * 1024 bytes
  const disk = new Uint8Array(720 * S900_BLOCK_SIZE);
  const view = new DataView(disk.buffer);

  // Directory entry 0: Program 'P' "S900LEAD"
  const pName = 'S900LEAD  ';
  for (let i = 0; i < 10; i++) disk[i] = pName.charCodeAt(i);
  disk[16] = 'P'.charCodeAt(0);
  const progLen = 36 + 70; // Header + 1 keygroup
  disk[17] = progLen & 0xff;
  disk[18] = (progLen >> 8) & 0xff;
  disk[19] = 0;
  view.setUint16(20, 2, true); // startBlock = 2

  // Directory entry 1: Sample 'S' "S900SMP   "
  const sOffset = 24;
  const sName = 'S900SMP   ';
  for (let i = 0; i < 10; i++) disk[sOffset + i] = sName.charCodeAt(i);
  disk[sOffset + 16] = 'S'.charCodeAt(0);
  const sampleLen = 60 + 100; // Header + 100 bytes sample data
  disk[sOffset + 17] = sampleLen & 0xff;
  disk[sOffset + 18] = (sampleLen >> 8) & 0xff;
  disk[sOffset + 19] = 0;
  view.setUint16(sOffset + 20, 3, true); // startBlock = 3

  // Inside Program at Block 2:
  const pBlock = 2 * S900_BLOCK_SIZE;
  for (let i = 0; i < 10; i++) disk[pBlock + i] = pName.charCodeAt(i);
  disk[pBlock + 21] = 1; // numberOfKeygroups = 1

  // Keygroup 0 at pBlock + 36:
  const kgPos = pBlock + 36;
  disk[kgPos] = 96; // keyHigh
  disk[kgPos + 1] = 24; // keyLow
  disk[kgPos + 2] = 64; // velocitySwitchValue
  disk[kgPos + 3] = 10; // attack
  disk[kgPos + 4] = 30; // decay
  disk[kgPos + 5] = 70; // sustain
  disk[kgPos + 6] = 20; // release

  // Layer 1 (kgPos + 21):
  const l1Pos = kgPos + 21;
  for (let i = 0; i < 10; i++) disk[l1Pos + i] = sName.charCodeAt(i);
  disk[l1Pos + 18] = 99; // filter cutoff

  // Inside Sample at Block 3:
  const sBlock = 3 * S900_BLOCK_SIZE;
  for (let i = 0; i < 10; i++) disk[sBlock + i] = sName.charCodeAt(i);
  view.setUint32(sBlock + 16, 50, true); // sampleLength = 50
  view.setUint16(sBlock + 20, 22050, true); // sampleRate = 22050
  view.setUint16(sBlock + 22, 60 * 16, true); // nominalPitch = C3
  disk[sBlock + 26] = 'L'.charCodeAt(0); // playbackMode = 'L'
  view.setUint32(sBlock + 28, 49, true); // end
  view.setUint32(sBlock + 32, 0, true); // start
  view.setUint32(sBlock + 36, 25, true); // loopLength
  disk[sBlock + 43] = 'N'.charCodeAt(0); // direction = 'N'

  // Audio data at sBlock + 60
  for (let i = 0; i < 100; i++) {
    disk[sBlock + 60 + i] = (i * 7) & 0xff;
  }

  return disk;
}

// ─── Test Suite Execution ─────────────────────────────────

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

console.log('=== Fase 32.5 — Akai S-Series & Gotek Floppy/ISO Disk Image Importer ===');

await test('1. Akai S1000/S3000 disk image detection and multi-volume program listing', async () => {
  const diskBytes = createMockS1000Disk();
  assert.equal(isAkaiDiskImage(diskBytes), true);
  assert.equal(identifyAkaiDisk(diskBytes), 's1000');

  const programs = listAkaiDiskPrograms(diskBytes);
  assert.equal(programs.length, 2);

  // Program 0 in Partition A
  assert.equal(programs[0].id, '0:0:0');
  assert.equal(programs[0].name, 'FION');
  assert.equal(programs[0].format, 'akai_disk');
  assert.match(programs[0].detail ?? '', /Part A/);

  // Program 1 in Partition B
  assert.equal(programs[1].id, '1:0:0');
  assert.equal(programs[1].name, 'BASS');
  assert.equal(programs[1].format, 'akai_disk');
  assert.match(programs[1].detail ?? '', /Part B/);
});

await test('2. Akai S1000 program parsing: keygroups, samples, loops and envelopes', async () => {
  const diskBytes = createMockS1000Disk();
  const parsed = await parseAkaiDiskProgram(diskBytes, '0:0:0');

  assert.equal(parsed.presetName, 'FION');
  assert.equal(parsed.polyphony, 8);
  assert.equal(parsed.regions.length, 1);

  const reg = parsed.regions[0];
  assert.equal(reg.sampleName, 'SAMP');
  assert.equal(reg.rootKey, 60);
  assert.equal(reg.lowKey, 36);
  assert.equal(reg.highKey, 84);
  assert.equal(reg.lowVel, 1);
  assert.equal(reg.highVel, 127);
  assert.equal(reg.loopMode, 'loop_continuous');
  assert.equal(reg.loopStart, 49);
  assert.equal(reg.loopEnd, 99);

  // Audio buffer was extracted as standard WAV
  assert.equal(parsed.audioBuffers.has('SAMP'), true);
  const wavBuf = parsed.audioBuffers.get('SAMP')!;
  assert.ok(wavBuf.byteLength > 44);

  // Envelope and filter
  assert.ok(parsed.envelope !== undefined);
  assert.ok(parsed.envelope.attack > 0);
  assert.equal(parsed.filter?.poles, 3);
});

await test('3. Akai S900 / S950 3.5" floppy disk image detection and program parsing', async () => {
  const floppyBytes = createMockS900Floppy();
  assert.equal(isAkaiDiskImage(floppyBytes), true);
  assert.equal(identifyAkaiDisk(floppyBytes), 's900');

  const programs = listAkaiDiskPrograms(floppyBytes);
  assert.equal(programs.length, 1);
  assert.equal(programs[0].name, 'S900LEAD');
  assert.equal(programs[0].format, 'akai_disk');

  const parsed = await parseAkaiDiskProgram(floppyBytes, programs[0].id);
  assert.equal(parsed.presetName, 'S900LEAD');
  assert.equal(parsed.regions.length, 1);

  const reg = parsed.regions[0];
  assert.equal(reg.sampleName, 'S900SMP');
  assert.equal(reg.rootKey, 60);
  assert.equal(reg.lowKey, 24);
  assert.equal(reg.highKey, 96);
  assert.equal(reg.lowVel, 1);
  assert.equal(reg.highVel, 64);
  assert.equal(reg.loopMode, 'loop_continuous');

  assert.equal(parsed.audioBuffers.has('S900SMP'), true);
  assert.equal(parsed.filter?.poles, 3);
});

await test('4. listZipSamplerPrograms and parseUniversalSampler dispatch on .iso / .img', async () => {
  const diskBytes = createMockS1000Disk();
  const progs = await listZipSamplerPrograms('AKAI_LIBRARY.ISO', toArrayBuffer(diskBytes));
  assert.equal(progs.length, 2);

  const parsedInst = await parseUniversalSampler('AKAI_LIBRARY.ISO', toArrayBuffer(diskBytes), undefined, '0:0:0');
  assert.equal(parsedInst.presetName, 'FION');
  assert.equal(parsedInst.regions.length, 1);
});

await test('5. UniversalSamplerInstrument model conversion from Akai S-Series disk preset', async () => {
  const diskBytes = createMockS1000Disk();
  const model = await parseUniversalSamplerInstrument('AKAI_COLLECTION.IMG', toArrayBuffer(diskBytes));

  assert.equal(model.name, 'FION');
  assert.equal(model.regions.length, 1);
  assert.equal(model.regions[0].sampleName, 'SAMP');
  assert.equal(model.regions[0].rootKey, 60);
  assert.equal(model.regions[0].lowKey, 36);
  assert.equal(model.regions[0].highKey, 84);
  assert.equal(model.articulation.polyphony, 8);
  assert.equal(model.articulation.filter?.poles, 3);
});

console.log('\nAkai S-Series Disk Image Summary: 5 passed, 0 failed\n');
