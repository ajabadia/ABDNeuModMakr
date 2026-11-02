// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Phase 16 Verification Suite
// Universal Raw Multi-Format Sampler Exporter & Preflight Inspection
// ─────────────────────────────────────────────────────────

import assert from 'node:assert';
import { createInitialSession } from '../src/core/sessionFactory.ts';
import { encodeWavPcm16, encodeWavPcm24 } from '../src/core/dsp/WavDecoder.ts';
import { analyzeRawSamplerPreflight } from '../src/core/export/rawSamplerPreflight.ts';
import { exportRawSamplerLibrary } from '../src/core/export/RawSamplerExporter.ts';
import { parseZipArchive } from '@abdsynths/shared/formats/neuron';
import type { RawExportOptions } from '../src/core/export/rawSamplerTypes.ts';

function createSineWave(freq: number, sampleRate: number, durationSec: number): Float32Array {
  const numSamples = Math.round(sampleRate * durationSec);
  const out = new Float32Array(numSamples);
  const phaseStep = (2 * Math.PI * freq) / sampleRate;
  for (let i = 0; i < numSamples; i++) {
    out[i] = Math.sin(i * phaseStep) * 0.75;
  }
  return out;
}

function readFourCC(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3)
  );
}

async function runPhase16Tests(): Promise<void> {
  console.log('=== ABDNeuModMakr Phase 16: Universal Raw Sampler Exporter Suite ===\n');

  // Prepare test buffers
  const sRate44k = 44100;
  const sRate96k = 96000;
  const sineA4 = createSineWave(440, sRate44k, 0.25);
  const sineC5 = createSineWave(523.25, sRate96k, 0.25);

  const wavPcm16 = encodeWavPcm16([sineA4], sRate44k, {
    rootKey: 69,
    lowKey: 60,
    highKey: 72,
    loopMode: 'loop_continuous',
    loopStart: 1000,
    loopEnd: 8000,
  });

  const wavPcm24 = encodeWavPcm24([sineC5], sRate96k, {
    rootKey: 72,
    lowKey: 73,
    highKey: 84,
  });

  const bufferMap = new Map<string, ArrayBuffer>([
    ['A4_Sine.wav', wavPcm16],
    ['C5_Sine_HighRes.wav', wavPcm24],
  ]);

  const bufferProvider = (name: string) => bufferMap.get(name);

  // ── 1. Preflight Inspection Engine Tests ────────────────
  console.log('1. Testing Preflight Inspection Engine...');
  const session = createInitialSession('RawTestModel');
  session.processConfig.expandedName = 'Grand Piano Test';
  session.processConfig.extendedMetadata = {
    author: 'Audio Lab Designer',
    license: 'CC-BY 4.0',
    description: 'Pristine acoustic sampling test',
  };

  session.zones = [
    {
      id: 'z1',
      lowKey: 0,
      rootKey: 69,
      highKey: 71,
      sampleLow: 'A4_Sine.wav',
      sampleHigh: null,
      velSplit: 64,
      detune: 0,
      volume: 0,
      pan: 0,
    },
    {
      id: 'z2',
      lowKey: 72,
      rootKey: 72,
      highKey: 127,
      sampleLow: 'C5_Sine_HighRes.wav',
      sampleHigh: null,
      velSplit: 64,
      detune: 5,
      volume: -2,
      pan: 10,
    },
  ];

  // Test SF2 preflight with 24-bit audio -> should report 16-bit clamp warning
  const sf2Opts: RawExportOptions = {
    format: 'sf2',
    resolution: 'original',
    sampleRate: 'original',
    normalization: 'none',
    layout: 'monolithic',
    bankName: 'TestBank',
  };

  const reportSf2 = analyzeRawSamplerPreflight(session, sf2Opts, bufferProvider);
  assert.strictEqual(reportSf2.canExport, true, 'Preflight report should allow export');
  assert.strictEqual(reportSf2.totalRegions, 2, 'Should detect 2 regions');
  assert.strictEqual(reportSf2.totalSamples, 2, 'Should detect 2 samples');

  const bitDepthIssue = reportSf2.issues.find((i) => i.category === 'bit_depth');
  assert.ok(bitDepthIssue, 'Should flag 24-bit audio incompatibility with SoundFont 2');
  assert.strictEqual(bitDepthIssue.severity, 'warning');
  assert.ok(bitDepthIssue.adaptation.includes('16-bit PCM'), 'Adaptation should mention 16-bit PCM');
  console.log('   [PASS] SF2 16-bit resolution limitation detected and adaptation proposed.');

  // Test Missing Audio Buffer detection
  const missingOpts: RawExportOptions = {
    format: 'sfz',
    resolution: 'original',
    sampleRate: 'original',
    normalization: 'none',
    layout: 'folder_samples',
  };
  const emptyProvider = () => undefined;
  const reportMissing = analyzeRawSamplerPreflight(session, missingOpts, emptyProvider);
  assert.strictEqual(reportMissing.canExport, false, 'Should block export if all samples are missing');
  assert.strictEqual(reportMissing.summary.incompatibilityCount >= 1, true, 'Should flag critical incompatibility');
  console.log('   [PASS] Missing audio buffers correctly detected and export gate blocked.');

  // ── 2. SoundFont 2 (.sf2) Binary Export ─────────────────
  console.log('2. Testing SoundFont 2.04 (.sf2) Binary RIFF Generation...');
  const sf2Result = await exportRawSamplerLibrary(session, sf2Opts, bufferProvider);
  assert.strictEqual(sf2Result.filename.endsWith('.sf2'), true, 'Filename should end with .sf2');
  assert.strictEqual(sf2Result.mimeType, 'audio/x-soundfont');
  assert.ok(sf2Result.data.byteLength > 1000, 'SF2 binary should be > 1000 bytes');

  const sf2View = new DataView(sf2Result.data.buffer, sf2Result.data.byteOffset, sf2Result.data.byteLength);
  assert.strictEqual(readFourCC(sf2View, 0), 'RIFF', 'Should start with RIFF');
  assert.strictEqual(readFourCC(sf2View, 8), 'sfbk', 'RIFF form type should be sfbk');

  // Verify LIST INFO
  assert.strictEqual(readFourCC(sf2View, 12), 'LIST', 'Should have first LIST chunk');
  assert.strictEqual(readFourCC(sf2View, 20), 'INFO', 'First LIST should be INFO');

  // Scan for 'sdta' and 'pdta'
  let foundSdta = false;
  let foundPdta = false;
  let scanOffset = 12;

  while (scanOffset + 8 <= sf2Result.data.byteLength) {
    const tag = readFourCC(sf2View, scanOffset);
    const size = sf2View.getUint32(scanOffset + 4, true);
    if (tag === 'LIST') {
      const listType = readFourCC(sf2View, scanOffset + 8);
      if (listType === 'sdta') foundSdta = true;
      if (listType === 'pdta') foundPdta = true;
    }
    scanOffset += 8 + size + (size & 1);
  }

  assert.strictEqual(foundSdta, true, 'SF2 must contain LIST sdta chunk');
  assert.strictEqual(foundPdta, true, 'SF2 must contain LIST pdta chunk');
  console.log(`   [PASS] SF2 binary generated: ${sf2Result.filename} (${sf2Result.data.byteLength} bytes) with valid INFO/sdta/pdta chunks.`);

  // ── 3. SFZ Format (.sfz + Samples in ZIP) ───────────────
  console.log('3. Testing SFZ Format Packaging (.sfz + Samples/ in ZIP)...');
  const sfzOpts: RawExportOptions = {
    format: 'sfz',
    resolution: 'pcm24',
    sampleRate: 48000,
    normalization: '0db',
    layout: 'folder_samples',
    bankName: 'SFZ_TestBank',
  };

  const sfzResult = await exportRawSamplerLibrary(session, sfzOpts, bufferProvider);
  assert.strictEqual(sfzResult.filename.endsWith('.sfz.zip'), true);
  assert.strictEqual(sfzResult.mimeType, 'application/zip');

  const sfzParsed = parseZipArchive(sfzResult.data);
  const sfzDefEntry = sfzParsed.find((e) => e.path.endsWith('.sfz'));
  assert.ok(sfzDefEntry, 'ZIP must contain .sfz definition file');

  const sfzText = new TextDecoder().decode(sfzDefEntry.data);
  assert.ok(sfzText.includes('<control>'), 'SFZ must contain <control> header');
  assert.ok(sfzText.includes('default_path=Samples/'), 'SFZ must set default_path=Samples/');
  assert.ok(sfzText.includes('<region>'), 'SFZ must define <region> blocks');
  assert.ok(sfzText.includes('pitch_keycenter=69'), 'SFZ must contain pitch_keycenter=69');

  const sampleEntries = sfzParsed.filter((e) => e.path.startsWith('Samples/'));
  assert.strictEqual(sampleEntries.length, 2, 'ZIP must contain 2 audio samples under Samples/');
  console.log(`   [PASS] SFZ package validated: ${sfzDefEntry.path} and ${sampleEntries.length} audio samples.`);

  // ── 4. Decent Sampler (.dspreset + Samples in ZIP) ───────
  console.log('4. Testing Decent Sampler (.dspreset + Samples/ in ZIP)...');
  const dsOpts: RawExportOptions = {
    format: 'dspreset',
    resolution: 'pcm24',
    sampleRate: 'original',
    normalization: 'minus_0_3db',
    layout: 'folder_samples',
    bankName: 'DecentSamplerBank',
  };

  const dsResult = await exportRawSamplerLibrary(session, dsOpts, bufferProvider);
  assert.strictEqual(dsResult.filename.endsWith('.dspreset.zip'), true);

  const dsParsed = parseZipArchive(dsResult.data);
  const dsPresetEntry = dsParsed.find((e) => e.path.endsWith('.dspreset'));
  assert.ok(dsPresetEntry, 'ZIP must contain .dspreset file');

  const dsXml = new TextDecoder().decode(dsPresetEntry.data);
  assert.ok(dsXml.includes('<DecentSampler minVersion="1.0.0">'), 'Must contain <DecentSampler> root');
  assert.ok(dsXml.includes('<labeled-knob'), 'Must contain UI labeled-knob controls');
  assert.ok(dsXml.includes('<groups'), 'Must contain <groups> section');
  assert.ok(dsXml.includes('<sample path="Samples/'), 'Must contain <sample path="Samples/..."');
  console.log(`   [PASS] Decent Sampler preset validated: XML GUI controls and sample bindings.`);

  // ── 5. Bitwig Studio Multisample (.multisample) ───────────
  console.log('5. Testing Bitwig Studio Multisample (.multisample)...');
  const bwOpts: RawExportOptions = {
    format: 'multisample',
    resolution: 'pcm24',
    sampleRate: 'original',
    normalization: 'none',
    layout: 'folder_samples',
    bankName: 'BitwigTestBank',
  };

  const bwResult = await exportRawSamplerLibrary(session, bwOpts, bufferProvider);
  assert.strictEqual(bwResult.filename.endsWith('.multisample'), true);

  const bwParsed = parseZipArchive(bwResult.data);
  const bwXmlEntry = bwParsed.find((e) => e.path === 'multisample.xml');
  assert.ok(bwXmlEntry, '.multisample package must contain multisample.xml at root');

  const bwXml = new TextDecoder().decode(bwXmlEntry.data);
  assert.ok(bwXml.includes('<multisample') && bwXml.includes('version="1.0">'), 'Must have <multisample> root tag');
  assert.ok(bwXml.includes('<generator name="ABDNeuModMakr"'), 'Must have generator tag');
  assert.ok(bwXml.includes('<sample file="Samples/'), 'Must have sample mapping tags');
  console.log(`   [PASS] Bitwig Studio multisample package verified with root multisample.xml.`);

  // ── 6. Kontakt (.nki.zip) & HALion (.vstpreset.zip) ─────
  console.log('6. Testing Kontakt (.nki.zip) & HALion (.vstpreset.zip)...');
  const nkiOpts: RawExportOptions = {
    format: 'nki',
    resolution: 'pcm24',
    sampleRate: 'original',
    normalization: 'none',
    layout: 'folder_samples',
    bankName: 'KontaktBank',
  };
  const nkiResult = await exportRawSamplerLibrary(session, nkiOpts, bufferProvider);
  const nkiParsed = parseZipArchive(nkiResult.data);
  assert.ok(nkiParsed.some((e) => e.path.endsWith('.nki.xml')), 'Must contain .nki.xml definition');

  const halOpts: RawExportOptions = {
    format: 'vstpreset',
    resolution: 'pcm24',
    sampleRate: 'original',
    normalization: 'none',
    layout: 'folder_samples',
    bankName: 'HalionBank',
  };
  const halResult = await exportRawSamplerLibrary(session, halOpts, bufferProvider);
  const halParsed = parseZipArchive(halResult.data);
  assert.ok(halParsed.some((e) => e.path.endsWith('.vstpreset.xml')), 'Must contain .vstpreset.xml definition');
  console.log('   [PASS] Kontakt and HALion structured definition packages verified.');

  // ── 7. Linear Sample Chain (.wav with Cue Markers) ───────
  console.log('7. Testing Linear Sample Chain (.wav) with embedded Cue Points...');
  const chainOpts: RawExportOptions = {
    format: 'sample_chain',
    resolution: 'pcm24',
    sampleRate: 'original',
    normalization: 'none',
    layout: 'monolithic',
    bankName: 'OctatrackChain',
  };

  const chainResult = await exportRawSamplerLibrary(session, chainOpts, bufferProvider);
  assert.strictEqual(chainResult.filename.endsWith('_chain.wav'), true);
  assert.strictEqual(chainResult.mimeType, 'audio/wav');

  const chainView = new DataView(chainResult.data.buffer, chainResult.data.byteOffset, chainResult.data.byteLength);
  assert.strictEqual(readFourCC(chainView, 0), 'RIFF');
  assert.strictEqual(readFourCC(chainView, 8), 'WAVE');

  // Verify embedded 'cue ' and 'LIST adtl' chunks
  let foundCue = false;
  let foundAdtl = false;
  let cueCount = 0;
  let offset = 12;

  while (offset + 8 <= chainResult.data.byteLength) {
    const chunkId = readFourCC(chainView, offset);
    const chunkSize = chainView.getUint32(offset + 4, true);
    if (chunkId === 'cue ') {
      foundCue = true;
      cueCount = chainView.getUint32(offset + 8, true);
    }
    if (chunkId === 'LIST') {
      const type = readFourCC(chainView, offset + 8);
      if (type === 'adtl') foundAdtl = true;
    }
    offset += 8 + chunkSize + (chunkSize & 1);
  }

  assert.strictEqual(foundCue, true, 'Sample Chain WAV must contain RIFF cue chunk');
  assert.strictEqual(cueCount, 2, 'Cue chunk must contain 2 slice markers');
  assert.strictEqual(foundAdtl, true, 'Sample Chain WAV must contain LIST adtl label chunk');
  console.log(`   [PASS] Linear Sample Chain generated: ${chainResult.filename} with ${cueCount} embedded cue slice points and adtl labels.`);

  console.log('\n================================================================');
  console.log('  ALL PHASE 16 RAW MULTI-FORMAT SAMPLER TESTS PASSED 100%!       ');
  console.log('================================================================');
}

runPhase16Tests().catch((err) => {
  console.error('Phase 16 test failure:', err);
  process.exit(1);
});
