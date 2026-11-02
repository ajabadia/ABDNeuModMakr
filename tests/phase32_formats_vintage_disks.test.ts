import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  isEmuDiskImage,
  listEmuDiskPrograms,
  parseEmuDiskProgram,
  isRolandDiskImage,
  listRolandDiskPrograms,
  parseRolandDiskProgram,
  isEnsoniqDiskImage,
  listEnsoniqDiskPrograms,
  parseEnsoniqDiskProgram,
  isYamahaDiskImage,
  listYamahaDiskPrograms,
  parseYamahaDiskProgram,
  listZipSamplerPrograms,
} from '../vendor/@abdsynths/shared/Code/SamplerFormats/index.ts';
import {
  parseUniversalSamplerInstrument,
} from '../vendor/@abdsynths/shared/Code/SamplerFormats/UniversalSamplerModel.ts';

// Helper to write ASCII into byte array
function writeAscii(buf: Uint8Array, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) {
    buf[offset + i] = text.charCodeAt(i);
  }
}

function writeU16LE(buf: Uint8Array, offset: number, val: number) {
  buf[offset] = val & 0xff;
  buf[offset + 1] = (val >> 8) & 0xff;
}

function writeU32LE(buf: Uint8Array, offset: number, val: number) {
  buf[offset] = val & 0xff;
  buf[offset + 1] = (val >> 8) & 0xff;
  buf[offset + 2] = (val >> 16) & 0xff;
  buf[offset + 3] = (val >> 24) & 0xff;
}

function writeU16BE(buf: Uint8Array, offset: number, val: number) {
  buf[offset] = (val >> 8) & 0xff;
  buf[offset + 1] = val & 0xff;
}

function writeU32BE(buf: Uint8Array, offset: number, val: number) {
  buf[offset] = (val >> 24) & 0xff;
  buf[offset + 1] = (val >> 16) & 0xff;
  buf[offset + 2] = (val >> 8) & 0xff;
  buf[offset + 3] = val & 0xff;
}

describe('Fase 32.5 — Vintage Sampler Disk & ISO Importers (E-mu, Roland, Ensoniq, Yamaha)', () => {
  it('1. E-mu Emulator IV (EOS) .e4b bank parsing and program extraction', async () => {
    // Construct a minimal valid E4B bank: FORM <size> E4B0 with 1 E3S1 chunk and 1 E4P1 chunk
    const e4bBuf = new Uint8Array(2048);
    writeAscii(e4bBuf, 0, 'FORM');
    writeU32BE(e4bBuf, 4, 2040);
    writeAscii(e4bBuf, 8, 'E4B0');

    // Sample Chunk: E3S1
    let pos = 12;
    writeAscii(e4bBuf, pos, 'E3S1');
    const sampleBodySize = 94 + 256; // 94 byte header + 128 frames PCM16
    writeU32BE(e4bBuf, pos + 4, sampleBodySize);
    pos += 8;

    writeU16BE(e4bBuf, pos, 1); // Sample Index 1
    writeAscii(e4bBuf, pos + 2, 'VintageLead_C3');
    writeU32LE(e4bBuf, pos + 22, 92); // Start left
    writeU32LE(e4bBuf, pos + 30, 92 + 256 - 2); // End left
    writeU32LE(e4bBuf, pos + 38, 92 + 64); // Loop start
    writeU32LE(e4bBuf, pos + 46, 92 + 200); // Loop end
    writeU32LE(e4bBuf, pos + 54, 44100); // Sample rate
    writeU16LE(e4bBuf, pos + 60, 0x0031); // Mono forward loop

    // Write sine-like PCM data into sample
    for (let i = 0; i < 128; i++) {
      const s = Math.round(Math.sin((i / 16) * Math.PI * 2) * 16000);
      writeU16LE(e4bBuf, pos + 94 + i * 2, s);
    }
    pos += sampleBodySize;

    // Preset Chunk: E4P1
    writeAscii(e4bBuf, pos, 'E4P1');
    const presetBodySize = 82 + 284 + 22; // Header + 1 Voice + 1 Zone
    writeU32BE(e4bBuf, pos + 4, presetBodySize);
    pos += 8;

    writeU16BE(e4bBuf, pos, 0); // Preset Index 0
    writeAscii(e4bBuf, pos + 2, 'Lead Solo');
    writeU16BE(e4bBuf, pos + 20, 1); // 1 voice

    const voiceOffset = pos + 82;
    writeU16BE(e4bBuf, voiceOffset + 2, 284 + 22); // zoneTableEnd
    e4bBuf[voiceOffset + 4] = 1; // 1 zone
    e4bBuf[voiceOffset + 14] = 21; // Voice key low
    e4bBuf[voiceOffset + 17] = 108; // Voice key high
    e4bBuf[voiceOffset + 18] = 1; // Voice vel low
    e4bBuf[voiceOffset + 21] = 127; // Voice vel high

    const zoneOffset = voiceOffset + 284;
    e4bBuf[zoneOffset + 2] = 21; // Key low
    e4bBuf[zoneOffset + 5] = 108; // Key high
    e4bBuf[zoneOffset + 6] = 1; // Vel low
    e4bBuf[zoneOffset + 9] = 127; // Vel high
    writeU16BE(e4bBuf, zoneOffset + 10, 1); // Sample index 1
    e4bBuf[zoneOffset + 14] = 60; // Root key

    assert.equal(isEmuDiskImage(e4bBuf), true);

    const progs = listEmuDiskPrograms(e4bBuf);
    assert.equal(progs.length, 1);
    assert.equal(progs[0].name, 'Lead Solo');

    const parsed = parseEmuDiskProgram(e4bBuf);
    assert.equal(parsed.presetName, 'Lead Solo');
    assert.equal(parsed.regions.length, 1);
    assert.equal(parsed.regions[0].sampleName, 'VintageLead_C3');
    assert.equal(parsed.regions[0].rootKey, 60);
    assert.equal(parsed.regions[0].loopMode, 'loop_continuous');
    assert.ok(parsed.audioBuffers.has('VintageLead_C3.wav'));

    const model = await parseUniversalSamplerInstrument('EmuBank.e4b', e4bBuf.buffer);
    assert.equal(model.name, 'Lead_Solo');
    assert.equal(model.expandedName, 'Lead Solo');
    assert.equal(model.regions.length, 1);
    assert.equal(model.regions[0].sampleName, 'VintageLead_C3');
    console.log('  PASS  1. E-mu Emulator IV (EOS) .e4b bank parsing and program extraction');
  });

  it('2. E-mu EMU3 disk image filesystem traversal (Superblock, FAT, directory, files)', () => {
    // Construct a synthetic 128KB EMU3 disk image
    const diskBuf = new Uint8Array(128 * 1024);
    // Superblock at block 0
    writeAscii(diskBuf, 0, 'EMU3');
    writeU32LE(diskBuf, 0x08, 1); // Root directory start block = 1
    writeU32LE(diskBuf, 0x0c, 1); // Root directory blocks = 1
    writeU32LE(diskBuf, 0x18, 2); // FAT start block = 2
    writeU32LE(diskBuf, 0x1c, 1); // FAT blocks = 1
    writeU32LE(diskBuf, 0x20, 4); // Data start block = 4
    diskBuf[0x28] = 0; // 1 sector per cluster = 512 bytes

    // Root directory at block 1 (offset 512)
    // Folder entry (type 0x40) pointing to block 3
    diskBuf[512 + 17] = 0x40; // FOLDER_TYPE_USER
    writeU16LE(diskBuf, 512 + 18, 3); // references dir content block 3

    // Dir-content block at block 3 (offset 1536)
    // Bank entry (type 0x81)
    writeAscii(diskBuf, 1536, 'EmuStrings');
    writeU16LE(diskBuf, 1536 + 18, 1); // Start cluster = 1
    writeU16LE(diskBuf, 1536 + 20, 1); // Num clusters = 1
    writeU16LE(diskBuf, 1536 + 22, 1); // Last cluster blocks = 1
    writeU16LE(diskBuf, 1536 + 24, 512); // Last block bytes = 512
    diskBuf[1536 + 26] = 0x81; // FILE_TYPE_BANK

    // Cluster 1 data at dataStart (block 4 = offset 2048)
    // Put minimal E4B bank into Cluster 1
    writeAscii(diskBuf, 2048, 'FORM');
    writeU32BE(diskBuf, 2048 + 4, 500);
    writeAscii(diskBuf, 2048 + 8, 'E4B0');

    // Preset
    const presetStart = 2048 + 12;
    writeAscii(diskBuf, presetStart, 'E4P1');
    writeU32BE(diskBuf, presetStart + 4, 82);
    writeU16BE(diskBuf, presetStart + 8, 0);
    writeAscii(diskBuf, presetStart + 10, 'Strings Arco');

    assert.equal(isEmuDiskImage(diskBuf), true);
    const programs = listEmuDiskPrograms(diskBuf);
    assert.equal(programs.length, 1);
    assert.equal(programs[0].name, 'Strings Arco');

    const parsed = parseEmuDiskProgram(diskBuf);
    assert.equal(parsed.presetName, 'Strings Arco');
    console.log('  PASS  2. E-mu EMU3 disk image filesystem traversal (Superblock, FAT, directory, files)');
  });

  it('3. Roland S-7xx disk image detection and patch extraction', async () => {
    // Construct minimal Roland S-770 CD/HD image buffer (at least 0x2B5800 bytes)
    const rolandBuf = new Uint8Array(0x2b5800 + 0x2400); // Base headers + 1 audio cluster
    // Offset 4..7: "770"
    writeAscii(rolandBuf, 4, '770');
    writeAscii(rolandBuf, 0x100, 'RolandUniverse');

    // FAT area at 0x080800: cluster 2 has end-of-chain marker 0xFFFF
    writeU16LE(rolandBuf, 0x080800 + 2 * 2, 0xffff);

    // Sample directory at 0x0E0800 (index 0)
    const smpDirOffset = 0x0a0800 + 0x040000;
    writeAscii(rolandBuf, smpDirOffset, 'WarmPad_Sample');
    rolandBuf[smpDirOffset + 16] = 0x44; // File type SAMPLE
    writeU16LE(rolandBuf, smpDirOffset + 26, 2); // FAT entry 2
    writeU16LE(rolandBuf, smpDirOffset + 28, 1); // 1 cluster

    // Patch directory at 0x0A8800 (index 0)
    const patchDirOffset = 0x0a8800;
    writeAscii(rolandBuf, patchDirOffset, 'Analog Warmth');
    rolandBuf[patchDirOffset + 16] = 0x42; // File type PATCH

    // Patch parameter at 0x10D800 + 128*128 + 512*128 (index 0 = 0x121800)
    const patchParamOffset = 0x10d800 + 128 * 128 + 512 * 128;
    writeAscii(rolandBuf, patchParamOffset, 'Analog Warmth');
    // Map keys 0..87 to Partial 0
    for (let k = 0; k < 88; k++) {
      rolandBuf[patchParamOffset + 32 + k] = 0;
    }

    // Partial parameter at patchParamOffset + 1024 * 256 = 0x161800 (index 0)
    const partialOffset = patchParamOffset + 1024 * 256;
    writeAscii(rolandBuf, partialOffset, 'Warmth_Part');
    // Sample section 0 references sample 0
    writeU16LE(rolandBuf, partialOffset + 16, 0); // sample index 0
    rolandBuf[partialOffset + 16 + 6] = 1; // smtVelocityLower
    rolandBuf[partialOffset + 16 + 8] = 127; // smtVelocityUpper

    // Sample parameter at partialOffset + 4096 * 128 = 0x1E1800
    const sampleParamOffset = partialOffset + 4096 * 128;
    writeAscii(rolandBuf, sampleParamOffset, 'WarmPad_Sample');
    writeU32LE(rolandBuf, sampleParamOffset + 16, 0); // startAddr
    writeU32LE(rolandBuf, sampleParamOffset + 20, 100 << 8); // loop start
    writeU32LE(rolandBuf, sampleParamOffset + 24, 500 << 8); // loop end
    rolandBuf[sampleParamOffset + 32] = 0; // Forward loop
    rolandBuf[sampleParamOffset + 38] = 1; // 44100 Hz
    rolandBuf[sampleParamOffset + 39] = 60; // Root key

    // Audio Area at 0x2B5800 (Cluster 2)
    // Fill with audio data
    for (let i = 0; i < 1000; i++) {
      writeU16LE(rolandBuf, 0x2b5800 + i * 2, Math.round(Math.sin(i / 10) * 12000));
    }

    assert.equal(isRolandDiskImage(rolandBuf), true);

    const progs = listRolandDiskPrograms(rolandBuf);
    assert.equal(progs.length, 1);
    assert.equal(progs[0].name, 'Analog Warmth');

    const parsed = parseRolandDiskProgram(rolandBuf);
    assert.equal(parsed.presetName, 'Analog Warmth');
    assert.ok(parsed.regions.length > 0);
    assert.equal(parsed.regions[0].rootKey, 60);
    assert.ok(parsed.audioBuffers.has('WarmPad_Sample.wav'));

    const model = await parseUniversalSamplerInstrument('RolandCD.iso', rolandBuf.buffer);
    assert.equal(model.name, 'RolandUniverse_Analog_Warmth');
    assert.equal(model.expandedName, 'Analog Warmth');
    console.log('  PASS  3. Roland S-7xx disk image detection and patch extraction');
  });

  it('4. Ensoniq EPS/ASR and Yamaha A-Series detection and parsing', () => {
    // 4a. Ensoniq Standalone EFE Instrument
    const efeBuf = new Uint8Array(2048);
    efeBuf[0] = 0x0d;
    efeBuf[1] = 0x0a;
    writeAscii(efeBuf, 2, 'MirageLead');
    efeBuf[47] = 0x0d;
    efeBuf[48] = 0x0a;
    efeBuf[49] = 0x1a;

    assert.equal(isEnsoniqDiskImage(efeBuf), true);
    const ensoniqProgs = listEnsoniqDiskPrograms(efeBuf);
    assert.equal(ensoniqProgs.length, 1);
    assert.equal(ensoniqProgs[0].name, 'MirageLead');

    const parsedEnsoniq = parseEnsoniqDiskProgram(efeBuf);
    assert.equal(parsedEnsoniq.presetName, 'MirageLead');
    assert.ok(parsedEnsoniq.audioBuffers.has('MirageLead.wav'));

    // 4b. Yamaha YSFC / SFS
    const yamahaBuf = new Uint8Array(4096);
    writeAscii(yamahaBuf, 0, 'YSFC');
    writeAscii(yamahaBuf, 32, 'A3K_Piano');

    assert.equal(isYamahaDiskImage(yamahaBuf), true);
    const yamahaProgs = listYamahaDiskPrograms(yamahaBuf);
    assert.equal(yamahaProgs.length, 1);
    assert.equal(yamahaProgs[0].name, 'A3K_Piano');

    const parsedYamaha = parseYamahaDiskProgram(yamahaBuf);
    assert.equal(parsedYamaha.presetName, 'A3K_Piano');
    assert.ok(parsedYamaha.audioBuffers.has('A3K_Piano.wav'));

    console.log('  PASS  4. Ensoniq EPS/ASR and Yamaha A-Series detection and parsing');
  });

  it('5. Universal dispatcher transparent routing for vintage disk formats (.iso, .img)', async () => {
    // Test E-mu dispatch through listZipSamplerPrograms and parseUniversalSampler
    const e4bBuf = new Uint8Array(1024);
    writeAscii(e4bBuf, 0, 'FORM');
    writeU32BE(e4bBuf, 4, 1016);
    writeAscii(e4bBuf, 8, 'E4B0');
    writeAscii(e4bBuf, 12, 'E4P1');
    writeU32BE(e4bBuf, 16, 82);
    writeU16BE(e4bBuf, 20, 0);
    writeAscii(e4bBuf, 22, 'UniversalEmu');

    const programs = await listZipSamplerPrograms('LibraryDisk.iso', e4bBuf.buffer);
    assert.equal(programs.length, 1);
    assert.equal(programs[0].name, 'UniversalEmu');
    assert.equal(programs[0].format, 'emu_disk');

    console.log('  PASS  5. Universal dispatcher transparent routing for vintage disk formats (.iso, .img)');
  });
});
