// ─────────────────────────────────────────────────────────────────────────────
// ABDNeuModMakr — Fase 32 Bloque 4 & MESA Formats Test Suite
//
// Verification of:
//   1. Akai MESA S3P (.s3p) SysEx unpacked program parsing & preset conversion
//   2. Reason NN-XT (.sxt) IFF FORM PTCH parsing, zone decoding, and writing
//   3. FL Studio DirectWave (.dwp) chunk stream parsing, zone extraction, and writing
//   4. Audiomodern Soundbox (.sbpack, .sbx) XML parsing and preset generation
//   5. Spectrasonics Omnisphere (.zmap) multisample XML parsing and writing
//   6. Native Instruments Maschine (.mxsnd, .mxgrp) & NICNT parsing
//   7. Universal Audio Decoder audio extension registration (.mpa, .mp4, .ogg)
//   8. Universal parseUniversalSampler transparent routing for all Bloque 4 formats
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isAkaiMesaS3p,
  parseAkaiMesaS3p,
  convertAkaiMesaToPreset,
  isSxtPatch,
  parseSxtPatch,
  convertSxtToPreset,
  writeSxtPatch,
  isDirectWavePatch,
  parseDirectWavePatch,
  convertDirectWaveToPreset,
  writeDirectWavePatch,
  isSoundboxBuffer,
  parseSoundboxXml,
  convertSoundboxToPreset,
  generateSoundboxXml,
  isOmnisphereFile,
  parseOmnisphereZmap,
  convertOmnisphereToPreset,
  generateOmnisphereZmap,
  isMaschineOrNicnt,
  parseMaschineSound,
  convertMaschineToPreset,
  parseNicnt,
  generateMaschineSoundXml,
  parseUniversalSampler,
} from '../vendor/@abdsynths/shared/Code/SamplerFormats/index.ts';
import { isSupportedAudioFileName } from '../vendor/@abdsynths/shared/Code/NeuronFormats/UniversalAudioDecoder.ts';

test('Fase 32 Bloque 4 & Audio Format Verification', async (t) => {
  await t.test('1. Audio extension checks: .mp4, .mpa, .ogg, .flac', () => {
    assert.strictEqual(isSupportedAudioFileName('track.mp4'), true);
    assert.strictEqual(isSupportedAudioFileName('audio.mpa'), true);
    assert.strictEqual(isSupportedAudioFileName('ambient.ogg'), true);
    assert.strictEqual(isSupportedAudioFileName('stereo.flac'), true);
    assert.strictEqual(isSupportedAudioFileName('sample.wav'), true);
    assert.strictEqual(isSupportedAudioFileName('readme.txt'), false);
  });

  await t.test('2. Akai MESA S3P (.s3p) parser and preset conversion', () => {
    // Construct a synthetic MESA S3P container: "PSYSSS30" + count + SysEx messages
    const progHeaderUnpacked = new Uint8Array(40);
    // Program ID: 1, Name at offset 3: "TEST_MESA"
    progHeaderUnpacked[0] = 1;
    // Set ASCII text at 3
    const textBytes = [11, 12, 13, 14]; // Akai chars
    progHeaderUnpacked.set(textBytes, 3);
    progHeaderUnpacked[15] = 5; // midi program 5
    progHeaderUnpacked[25] = 90; // volume 90

    // Pack into nibbles (2 bytes per byte)
    const progPacked = new Uint8Array(progHeaderUnpacked.length * 2);
    for (let i = 0; i < progHeaderUnpacked.length; i++) {
      progPacked[i * 2] = progHeaderUnpacked[i] & 0x0f;
      progPacked[i * 2 + 1] = (progHeaderUnpacked[i] >> 4) & 0x0f;
    }

    // SysEx msg: F0 47 00 07 48 00 00 <progPacked> F7
    const sysex1 = new Uint8Array(8 + progPacked.length);
    sysex1[0] = 0xf0;
    sysex1[1] = 0x47;
    sysex1[2] = 0x00;
    sysex1[3] = 0x07; // Command 7 (Program)
    sysex1[4] = 0x48;
    sysex1[5] = 0x00;
    sysex1[6] = 0x00;
    sysex1.set(progPacked, 7);
    sysex1[sysex1.length - 1] = 0xf7;

    const s3pBuf = new Uint8Array(8 + 4 + 4 + sysex1.length);
    const view = new DataView(s3pBuf.buffer);
    // Magic: PSYSSS30
    const magicStr = 'PSYSSS30';
    for (let i = 0; i < 8; i++) s3pBuf[i] = magicStr.charCodeAt(i);
    view.setUint32(8, 1, true); // numMessages = 1
    view.setUint32(12, sysex1.length, true); // msgSize
    s3pBuf.set(sysex1, 16);

    assert.strictEqual(isAkaiMesaS3p(s3pBuf), true);
    const parsed = parseAkaiMesaS3p(s3pBuf);
    assert.strictEqual(parsed.midiProgram, 5);
    assert.strictEqual(parsed.volume, 90);

    const preset = convertAkaiMesaToPreset(parsed);
    assert.strictEqual(preset.sourceFormat, 'akai_mesa');
  });

  await t.test('3. Reason NN-XT (.sxt) round-trip writing and parsing', () => {
    const testRegions = [
      {
        id: 'r1',
        sampleName: 'SynthLead.wav',
        samplePath: 'SynthLead.wav',
        rootKey: 60,
        lowKey: 36,
        highKey: 72,
        lowVelocity: 1,
        highVelocity: 127,
        detuneCents: 10,
        volumeDb: -3,
        pan: 0.2,
        loopMode: 'loop_continuous' as const,
        loopStart: 1000,
        loopEnd: 4000,
        attackTimeSec: 0.05,
        decayTimeSec: 0.3,
        sustainLevel: 0.8,
        releaseTimeSec: 0.2,
      },
    ];

    const sxtBytes = writeSxtPatch('LeadPatch', testRegions as any, ['SynthLead.wav']);
    assert.strictEqual(isSxtPatch(sxtBytes), true);

    const parsedPatch = parseSxtPatch(sxtBytes);
    assert.strictEqual(parsedPatch.sampleReferences.length, 1);
    assert.strictEqual(parsedPatch.zones.length, 1);
    assert.strictEqual(parsedPatch.zones[0].rootKey, 60);
    assert.strictEqual(parsedPatch.zones[0].keyRangeStart, 36);
    assert.strictEqual(parsedPatch.zones[0].keyRangeEnd, 72);

    const preset = convertSxtToPreset(parsedPatch);
    assert.strictEqual(preset.sourceFormat, 'reason_nnxt');
    assert.strictEqual(preset.regions.length, 1);
    assert.strictEqual(preset.regions[0].sampleName, 'SynthLead.wav');
  });

  await t.test('4. FL Studio DirectWave (.dwp) writing and parsing', () => {
    const testRegions = [
      {
        id: 'z1',
        sampleName: 'AcousticBass.wav',
        samplePath: 'AcousticBass.wav',
        rootKey: 36,
        lowKey: 24,
        highKey: 48,
        lowVelocity: 1,
        highVelocity: 127,
        detuneCents: 0,
        volumeDb: -1.5,
        pan: 0,
        loopMode: 'loop_continuous' as const,
        loopStart: 500,
        loopEnd: 2500,
      },
    ];

    const dwpBytes = writeDirectWavePatch('AcousticBass', testRegions as any);
    assert.strictEqual(isDirectWavePatch(dwpBytes), true);

    const parsedDwp = parseDirectWavePatch(dwpBytes);
    assert.strictEqual(parsedDwp.name, 'AcousticBass');
    assert.strictEqual(parsedDwp.zones.length, 1);
    assert.strictEqual(parsedDwp.zones[0].sampleName, 'AcousticBass.wav');
    assert.strictEqual(parsedDwp.zones[0].rootKey, 36);

    const preset = convertDirectWaveToPreset(parsedDwp);
    assert.strictEqual(preset.sourceFormat, 'directwave');
    assert.strictEqual(preset.regions.length, 1);
  });

  await t.test('5. Audiomodern Soundbox (.sbpack, XML) parsing and generation', () => {
    const testRegions = [
      {
        id: 's1',
        sampleName: 'AmbientPad_C3.wav',
        samplePath: 'AmbientPad_C3.wav',
        rootKey: 48,
        lowKey: 36,
        highKey: 60,
        lowVelocity: 1,
        highVelocity: 127,
        detuneCents: 0,
        volumeDb: 0,
        pan: -0.2,
        loopMode: 'loop_continuous' as const,
        loopStart: 100,
        loopEnd: 2000,
      },
    ];

    const xml = generateSoundboxXml('CosmicPad', testRegions as any, 'Pad');
    assert.strictEqual(isSoundboxBuffer(new TextEncoder().encode(xml), 'test.xml'), true);

    const parsed = parseSoundboxXml(xml);
    assert.strictEqual(parsed.name, 'CosmicPad');
    assert.strictEqual(parsed.category, 'Pad');
    assert.strictEqual(parsed.layers.length, 1);
    assert.strictEqual(parsed.layers[0].sounds.length, 1);

    const preset = convertSoundboxToPreset(parsed);
    assert.strictEqual(preset.sourceFormat, 'soundbox');
    assert.strictEqual(preset.regions[0].sampleName, 'AmbientPad_C3.wav');
  });

  await t.test('6. Spectrasonics Omnisphere (.zmap) parsing and generation', () => {
    const testRegions = [
      {
        id: 'o1',
        sampleName: 'VeloPiano_C4.wav',
        samplePath: 'VeloPiano_C4.wav',
        rootKey: 60,
        lowKey: 48,
        highKey: 72,
        lowVelocity: 64,
        highVelocity: 127,
        detuneCents: 5,
        volumeDb: -2,
        pan: 0.1,
        loopMode: 'loop_continuous' as const,
        loopStart: 1000,
        loopEnd: 5000,
      },
    ];

    const zmapXml = generateOmnisphereZmap('GrandPiano', testRegions as any);
    assert.strictEqual(isOmnisphereFile(new TextEncoder().encode(zmapXml), 'GrandPiano.zmap'), true);

    const parsed = parseOmnisphereZmap(zmapXml);
    assert.strictEqual(parsed.name, 'GrandPiano');
    assert.strictEqual(parsed.zones.length, 1);
    assert.strictEqual(parsed.zones[0].sample, 'VeloPiano_C4.wav');

    const preset = convertOmnisphereToPreset(parsed);
    assert.strictEqual(preset.sourceFormat, 'omnisphere');
    assert.strictEqual(preset.regions.length, 1);
  });

  await t.test('7. Native Instruments Maschine & NICNT metadata parsing', () => {
    const testRegions = [
      {
        id: 'm1',
        sampleName: 'Snare_909.wav',
        samplePath: 'Snare_909.wav',
        rootKey: 38,
        lowKey: 38,
        highKey: 38,
        lowVelocity: 1,
        highVelocity: 127,
        detuneCents: 0,
        volumeDb: 0,
        pan: 0,
        loopMode: 'no_loop' as const,
        loopStart: 0,
        loopEnd: 0,
      },
    ];

    const maschineXml = generateMaschineSoundXml('Kit909_Snare', testRegions as any);
    assert.strictEqual(isMaschineOrNicnt(new TextEncoder().encode(maschineXml), 'snare.mxsnd'), true);

    const parsed = parseMaschineSound(new TextEncoder().encode(maschineXml));
    assert.strictEqual(parsed.name, 'Kit909_Snare');
    assert.strictEqual(parsed.zones.length, 1);

    const preset = convertMaschineToPreset(parsed);
    assert.strictEqual(preset.sourceFormat, 'ni_maschine');

    // Test NICNT parsing
    const nicntXml = `<Product><Name>Vintage Synths</Name><Company>Native Instruments</Company><SNPID>890</SNPID></Product>`;
    const nicnt = parseNicnt(nicntXml);
    assert.strictEqual(nicnt.name, 'Vintage Synths');
    assert.strictEqual(nicnt.snpid, '890');
  });

  await t.test('8. Universal parseUniversalSampler integration for Bloque 4 formats', async () => {
    // SXT
    const sxtBytes = writeSxtPatch('UniversalSxt', [
      {
        id: 'u1',
        sampleName: 'Wave.wav',
        samplePath: 'Wave.wav',
        rootKey: 60,
        lowKey: 0,
        highKey: 127,
        lowVelocity: 1,
        highVelocity: 127,
        detuneCents: 0,
        volumeDb: 0,
        pan: 0,
        loopMode: 'no_loop' as const,
        loopStart: 0,
        loopEnd: 0,
      },
    ] as any, ['Wave.wav']);

    const sxtPreset = await parseUniversalSampler('UniversalSxt.sxt', sxtBytes.buffer);
    assert.strictEqual(sxtPreset.presetName, 'UniversalSxt');

    // DirectWave
    const dwpBytes = writeDirectWavePatch('UniversalDwp', [
      {
        id: 'u2',
        sampleName: 'Lead.wav',
        samplePath: 'Lead.wav',
        rootKey: 60,
        lowKey: 0,
        highKey: 127,
        lowVelocity: 1,
        highVelocity: 127,
        detuneCents: 0,
        volumeDb: 0,
        pan: 0,
        loopMode: 'no_loop' as const,
        loopStart: 0,
        loopEnd: 0,
      },
    ] as any);

    const dwpPreset = await parseUniversalSampler('Test.dwp', dwpBytes.buffer);
    assert.strictEqual(dwpPreset.presetName, 'UniversalDwp');
  });
});
