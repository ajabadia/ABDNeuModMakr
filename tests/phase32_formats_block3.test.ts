// ─────────────────────────────────────────────────────────
// tests/phase32_formats_block3.test.ts
//
// Comprehensive test suite for Fase 32 Bloque 3:
//   - Akai S5000 / S6000 / Z4 / Z8 (.akp RIFF APRG parser and builder)
//   - Akai MPC Classic (.pgm MPC2000/1000, .set MPC60 12-bit, Gotek floppy images)
//   - Kurzweil K2000 / K2500 / K2600 (.krz PRAM container, programs, keymaps, samples)
//   - Roland S-50 / S-550 / S-330 (12-bit PCM floppy images, patches, tones)
//   - Casio FZ-1 / FZ-10M (.fzv, .fzf, 16-bit linear PCM audio)
//   - Yamaha Motif / Montage / MODX (.x7u, .x8u YSFC workstation packages)
//   - Synclavier II / Synclavier V / Regen (timbre parsing & LCG SFLC de-obfuscation)
//   - Fairlight CMI Series IIx / III (.cmi, .cmi3 voice mapping)
//   - Unified IsoFormatIdentifier (ISO / SCSI / Floppy routing)
// ─────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAkpData,
  parseAkpProgram,
  writeAkpProgram,
  convertAkpToPreset,
  type AkpProgram,
} from '../vendor/@abdsynths/shared/Code/SamplerFormats/AkaiAkpFormat.ts';
import {
  isMpcDiskImage,
  isMpc1000Pgm,
  isMpc2000Pgm,
  isMpc60Set,
  unpackMpc60Audio,
  parseMpc2000Program,
  parseMpc60Set,
  convertMpcClassicToPreset,
} from '../vendor/@abdsynths/shared/Code/SamplerFormats/AkaiMpcClassicFormat.ts';
import {
  isKurzweilFile,
  parseKurzweilFile,
  convertKurzweilToPreset,
} from '../vendor/@abdsynths/shared/Code/SamplerFormats/KurzweilFormat.ts';
import {
  isRolandS5xxDiskImage,
  unpackRoland12bitPcm,
  parseRolandS5xxDisk,
  convertRolandS5xxToPreset,
} from '../vendor/@abdsynths/shared/Code/SamplerFormats/RolandS5xxFormat.ts';
import {
  isCasioFzData,
  parseCasioFz,
  convertCasioFzToPreset,
} from '../vendor/@abdsynths/shared/Code/SamplerFormats/CasioFzFormat.ts';
import {
  isYamahaYsfcFile,
  parseYamahaYsfc,
  convertYamahaYsfcToPreset,
} from '../vendor/@abdsynths/shared/Code/SamplerFormats/YamahaMotifFormat.ts';
import {
  deobfuscateSynclavierSflc,
  isSynclavierTimbre,
  parseSynclavierTimbre,
  convertSynclavierToPreset,
} from '../vendor/@abdsynths/shared/Code/SamplerFormats/SynclavierFormat.ts';
import {
  isFairlightCmiVoice,
  parseFairlightCmiVoice,
  convertFairlightCmiToPreset,
} from '../vendor/@abdsynths/shared/Code/SamplerFormats/FairlightCmiFormat.ts';
import {
  identifyDiskImageFormat,
} from '../vendor/@abdsynths/shared/Code/SamplerFormats/IsoFormatIdentifier.ts';
import {
  listZipSamplerPrograms,
  parseUniversalSampler,
} from '../vendor/@abdsynths/shared/Code/SamplerFormats/rawSamplerParsers.ts';

test('Fase 32 Bloque 3: Classic Vintage Sampler Formats & Disk Images', async (t) => {

  await t.test('1. Akai S5000 / S6000 / Z4 / Z8 (.akp) Program write and round-trip parse', () => {
    const mockProg: AkpProgram = {
      name: 'AnalogStrings',
      isZSeries: false,
      loudness: 90,
      semitoneTune: 0,
      fineTune: 5,
      keygroups: [
        {
          lowKey: 36,
          highKey: 72,
          semitoneTune: 0,
          fineTune: 0,
          pitchMod1: 50,
          pitchMod2: 0,
          ampMod: 0,
          zoneXfade: false,
          muteGroup: 0,
          ampAttack: 10,
          ampDecay: 40,
          ampRelease: 25,
          ampSustain: 80,
          filterMode: 1, // 4-pole LP
          filterCutoff: 75,
          filterResonance: 4,
          filterKeyTrack: 12,
          filtAttack: 5,
          filtDecay: 30,
          filtRelease: 20,
          filtSustain: 50,
          filtEnvDepth: 40,
          zones: [
            {
              sampleName: 'StringsLow',
              lowVel: 0,
              highVel: 127,
              fineTune: 0,
              semitoneTune: 0,
              filterOffset: 0,
              pan: 0,
              playbackMode: 4,
              output: 0,
              zoneLevel: 0,
              keyTrack: true,
              velToStart: 0,
            },
          ],
        },
      ],
    };

    const akpBytes = writeAkpProgram(mockProg, 1);
    assert.ok(isAkpData(akpBytes), 'Generated binary should be valid AKP RIFF APRG');

    const parsed = parseAkpProgram(akpBytes, 'AnalogStrings.akp');
    assert.equal(parsed.loudness, 90);
    assert.equal(parsed.keygroups.length, 1);
    assert.equal(parsed.keygroups[0].lowKey, 36);
    assert.equal(parsed.keygroups[0].highKey, 72);
    assert.equal(parsed.keygroups[0].zones[0].sampleName, 'StringsLow');

    const preset = convertAkpToPreset(parsed);
    assert.equal(preset.regions.length, 1);
    assert.equal(preset.regions[0].sampleName, 'StringsLow.wav');
    assert.equal(preset.regions[0].lowKey, 36);
    assert.equal(preset.regions[0].highKey, 72);
  });

  await t.test('2. Akai Classic MPC (MPC2000, MPC1000, MPC60) parsing and 12-bit audio unpack', () => {
    // MPC2000 program header simulation (0x07, 0x04)
    const mpc2000Buf = new Uint8Array(2048);
    mpc2000Buf[0] = 0x07;
    mpc2000Buf[1] = 0x04;
    // 1 sample
    mpc2000Buf[2] = 1;
    mpc2000Buf[3] = 0;
    // sample name: "Kick_01"
    const sName = 'Kick_01';
    for (let i = 0; i < sName.length; i++) mpc2000Buf[4 + i] = sName.charCodeAt(i);

    assert.ok(isMpc2000Pgm(mpc2000Buf), 'Recognizes MPC2000 program header');

    // MPC60 12-bit packed audio unpack
    // 3 bytes packing two 12-bit samples: 0x7F, 0xF0, 0x01
    const packed12 = new Uint8Array([0x7f, 0xf0, 0x01]);
    const unpacked = unpackMpc60Audio(packed12);
    assert.equal(unpacked.length, 2);
    assert.ok(typeof unpacked[0] === 'number');

    // Gotek Floppy boot sector
    const gotekBuf = new Uint8Array(512);
    gotekBuf[0] = 0xeb;
    gotekBuf[1] = 0xfe;
    gotekBuf[2] = 0x90;
    const tag = 'MPC2000 ';
    for (let i = 0; i < tag.length; i++) gotekBuf[3 + i] = tag.charCodeAt(i);
    assert.ok(isMpcDiskImage(gotekBuf), 'Identifies Gotek MPC2000 floppy image');
  });

  await t.test('3. Kurzweil K2000 / K2500 / K2600 (.krz) PRAM parser and audio extraction', () => {
    // Construct synthetic PRAM file
    const krzBuf = new Uint8Array(512);
    // Magic "PRAM"
    krzBuf[0] = 0x50; krzBuf[1] = 0x52; krzBuf[2] = 0x41; krzBuf[3] = 0x4d;
    // ObjectSize at offset 4 (e.g. 256)
    krzBuf[4] = 0; krzBuf[5] = 0; krzBuf[6] = 1; krzBuf[7] = 0; // 256

    assert.ok(isKurzweilFile(krzBuf), 'Identifies Kurzweil PRAM header');

    const krz = parseKurzweilFile(krzBuf);
    assert.ok(Array.isArray(krz.programs));
    assert.ok(krz.sampleAudioMap instanceof Map);
  });

  await t.test('4. Roland S-50 / S-550 12-bit Floppy Disk and audio unpack', () => {
    const s50Buf = new Uint8Array(737280);
    // Populate valid tone parameters at offset 69120
    for (let t = 0; t < 8; t++) {
      const o = 69120 + t * 128;
      s50Buf[o + 6] = 0; // waveBank A
      s50Buf[o + 7] = t; // waveSegmentTop
      s50Buf[o + 8] = 1; // waveSegmentLength
    }

    assert.ok(isRolandS5xxDiskImage(s50Buf), 'Identifies Roland S-5xx floppy image');

    // Roland 12-bit unpack test
    const packed = new Uint8Array([0x80, 0x08, 0x00]);
    const pcm = unpackRoland12bitPcm(packed);
    assert.equal(pcm.length, 2);

    const disk = parseRolandS5xxDisk(s50Buf);
    assert.equal(disk.model, 'S550');
    assert.ok(disk.tones.length >= 8);

    const preset = convertRolandS5xxToPreset(disk);
    assert.ok(preset.regions.length > 0);
  });

  await t.test('5. Casio FZ-1 / FZ-10M bare dump and voice parser', () => {
    const fzBuf = new Uint8Array(2048);
    // Write counters at offset 1008
    fzBuf[1008] = 1; fzBuf[1009] = 0; // 1 voice
    fzBuf[1010] = 2; fzBuf[1011] = 0; // 2 content sectors
    fzBuf[1012] = 1; fzBuf[1013] = 0; // 1 wave block

    // Voice name at offset 0: "FZ_Bass"
    const vName = 'FZ_Bass';
    for (let i = 0; i < vName.length; i++) fzBuf[i] = vName.charCodeAt(i);
    fzBuf[16] = 0; // 36 kHz
    fzBuf[17] = 36; // root key C2

    assert.ok(isCasioFzData(fzBuf), 'Detects Casio FZ bare dump counters');

    const parsed = parseCasioFz(fzBuf, 'FZ_Bass.fzv');
    assert.equal(parsed.voices.length, 1);
    assert.equal(parsed.voices[0].name, 'FZ_Bass');
    assert.equal(parsed.voices[0].origKeyNumber, 36);

    const preset = convertCasioFzToPreset(parsed);
    assert.equal(preset.regions[0].rootKey, 36);
  });

  await t.test('6. Yamaha Motif / Montage / MODX (.x7u, .x8u) YSFC parser', () => {
    const ysfcBuf = new Uint8Array(128);
    const magic = 'YAMAHA-YSFC';
    for (let i = 0; i < magic.length; i++) ysfcBuf[i] = magic.charCodeAt(i);

    assert.ok(isYamahaYsfcFile(ysfcBuf), 'Detects Yamaha YSFC magic signature');
    const parsed = parseYamahaYsfc(ysfcBuf);
    assert.ok(Array.isArray(parsed.waveforms));
  });

  await t.test('7. Synclavier Timbre and SFLC LCG de-obfuscation', () => {
    // SFLC LCG round-trip test (encrypt == decrypt)
    const testPlain = new Uint8Array([0x66, 0x4c, 0x61, 0x43, 0x00, 0x00, 0x00, 0x22]); // "fLaC" streaminfo
    const obfuscated = deobfuscateSynclavierSflc(testPlain, 'ProdigyLead');
    assert.notDeepEqual(obfuscated, testPlain, 'Obfuscated bytes should differ from plain');

    const restored = deobfuscateSynclavierSflc(obfuscated, 'ProdigyLead');
    assert.deepEqual(restored, testPlain, 'LCG de-obfuscator must perfectly reconstruct original audio stream');

    // Timbre text format test
    const timbreText = [
      'Synclavier Brass',
      'Original 1982 preset',
      'SynclavierVirtualInstrumentTimbreVersion000 6 12 24 0 99 1',
      'Partial_1 BrassLow.wav 36 60 48 0 0',
      'Partial_2 BrassHigh.wav 61 84 72 0 0',
    ].join('\n');

    assert.ok(isSynclavierTimbre(timbreText));
    const timbre = parseSynclavierTimbre(timbreText);
    assert.equal(timbre.title, 'Synclavier Brass');
    assert.equal(timbre.partials.length, 2);

    const preset = convertSynclavierToPreset(timbre);
    assert.equal(preset.regions.length, 2);
    assert.equal(preset.regions[0].lowKey, 36);
    assert.equal(preset.regions[1].lowKey, 61);
  });

  await t.test('8. Fairlight CMI Series III / IIx Voice parser', () => {
    const cmiBuf = new Uint8Array(4096);
    // VC_VERSION 768 (0x0300)
    cmiBuf[0] = 0x03;
    cmiBuf[1] = 0x00;
    const vName = 'FairlightFlute';
    for (let i = 0; i < vName.length; i++) cmiBuf[2 + i] = vName.charCodeAt(i);

    assert.ok(isFairlightCmiVoice(cmiBuf), 'Detects Fairlight CMI Series III voice');
    const cmi = parseFairlightCmiVoice(cmiBuf);
    assert.equal(cmi.name, 'FairlightFlute');
    assert.equal(cmi.isSeriesIII, true);

    const preset = convertFairlightCmiToPreset(cmi);
    assert.ok(preset.regions.length > 0);
  });

  await t.test('9. Unified IsoFormatIdentifier disk format routing', () => {
    // E-mu EMU3
    const emuBuf = new Uint8Array(512);
    emuBuf.set([0x45, 0x4d, 0x55, 0x33], 0); // "EMU3"
    assert.equal(identifyDiskImageFormat(emuBuf), 'emu_emu3');

    // Roland S-5xx
    const rS50 = new Uint8Array(737280);
    for (let t = 0; t < 8; t++) {
      const o = 69120 + t * 128;
      rS50[o + 6] = 0; rS50[o + 7] = t; rS50[o + 8] = 1;
    }
    assert.equal(identifyDiskImageFormat(rS50), 'roland_s5xx');

    // Casio FZ
    const casioBuf = new Uint8Array(1310720);
    casioBuf[1008] = 1; casioBuf[1010] = 2; casioBuf[1012] = 1;
    assert.equal(identifyDiskImageFormat(casioBuf), 'casio_fz');

    // Akai MPC2000
    const mpcBuf = new Uint8Array(512);
    mpcBuf[0] = 0xeb; mpcBuf[1] = 0xfe; mpcBuf[2] = 0x90;
    const mTag = 'MPC2000 ';
    for (let i = 0; i < mTag.length; i++) mpcBuf[3 + i] = mTag.charCodeAt(i);
    assert.equal(identifyDiskImageFormat(mpcBuf), 'akai_mpc2000');
  });

  await t.test('10. Universal parseUniversalSampler integration with Bloque 3 formats', async () => {
    // Standalone .akp
    const mockProg: AkpProgram = {
      name: 'PadSound',
      isZSeries: false,
      loudness: 80,
      semitoneTune: 0,
      fineTune: 0,
      keygroups: [],
    };
    const akpBytes = writeAkpProgram(mockProg, 1);
    const parsedAkpPreset = await parseUniversalSampler('PadSound.akp', akpBytes.buffer);
    assert.equal(parsedAkpPreset.format, 'akai_disk');
    assert.equal(parsedAkpPreset.presetName, 'PadSound');

    // Standalone .fzv
    const fzBuf = new Uint8Array(2048);
    fzBuf[1008] = 1; fzBuf[1010] = 2; fzBuf[1012] = 1;
    const vName = 'BassVoice';
    for (let i = 0; i < vName.length; i++) fzBuf[i] = vName.charCodeAt(i);
    const parsedFzPreset = await parseUniversalSampler('BassVoice.fzv', fzBuf.buffer);
    assert.equal(parsedFzPreset.format, 'casio_fz');
    assert.equal(parsedFzPreset.presetName, 'BassVoice');
  });

});
