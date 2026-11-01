// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Phase 18.8 Verification Suite
// Universal Smart Sampler & Slice Importer + Preflight Engine
// + AI Cover Instrument Motif Enrichment + Config Health
// ─────────────────────────────────────────────────────────

import assert from 'node:assert/strict';
import {
  parseDecentSamplerPreset,
  parseKontaktNki,
  parseHalionVstPreset,
  parseSampleChainAudio,
  parseUniversalSampler,
} from '../src/core/import/rawSamplerParsers.ts';
import {
  analyzeImportPreflight,
  applyPreflightImportAdaptations,
} from '../src/core/import/importPreflight.ts';
import {
  extractAcousticInstrumentMotif,
  buildAcousticArtworkPrompt,
} from '../src/core/ai/ModelArtworkGenerator.ts';
import { evaluateConfigHealth } from '../src/core/configHealth.ts';
import { encodeWavPcm16 } from '../src/core/dsp/WavDecoder.ts';
import { createZipArchive } from '../src/formats/ZipArchive.ts';

function createSine(freq: number, sampleRate: number, durationSec: number): Float32Array {
  const numSamples = Math.round(sampleRate * durationSec);
  const out = new Float32Array(numSamples);
  const step = (2 * Math.PI * freq) / sampleRate;
  for (let i = 0; i < numSamples; i++) {
    out[i] = Math.sin(i * step) * 0.7;
  }
  return out;
}

async function runPhase18Tests(): Promise<void> {
  console.log('=== ABDNeuModMakr Phase 18.8: Universal Smart Import & Preflight Suite ===\n');

  // Prepare synthetic WAV buffers
  const sRate = 44100;
  const sineA4 = createSine(440, sRate, 0.1);
  const sineC5 = createSine(523.25, sRate, 0.1);
  const wavA4 = encodeWavPcm16([sineA4], sRate, { rootKey: 69 });
  const wavC5 = encodeWavPcm16([sineC5], sRate, { rootKey: 72 });

  const sampleMap = new Map<string, ArrayBuffer>([
    ['Violin_A4.wav', wavA4],
    ['Violin_C5.wav', wavC5],
  ]);

  // ── 1. Decent Sampler (.dspreset) Parsing & Group Inheritance ──
  console.log('1. Testing Decent Sampler Parser (.dspreset)...');
  const dsXml = `<?xml version="1.0" encoding="UTF-8"?>
<DecentSampler minVersion="1.0.0">
  <!-- Bank: Stradivarius Solo Violin | Author: Maestro | License: CC0 -->
  <ui width="812" height="375"/>
  <groups attack="0.05" decay="0.2" sustain="0.8" release="0.4">
    <group loNote="55" hiNote="75" loVel="1" hiVel="127" seqMode="round_robin">
      <sample path="Samples/Violin_A4.wav" rootNote="69" loNote="65" hiNote="70" tuning="0.05" volume="-2.5dB" pan="0.2" loopEnabled="true" loopStart="1000" loopEnd="4000"/>
      <sample path="Samples/Violin_C5.wav" rootNote="72" loNote="71" hiNote="75" tuning="-0.02" volume="0dB" loopEnabled="1" loopStart="800" loopEnd="3500"/>
    </group>
  </groups>
</DecentSampler>`;

  const dsPreset = parseDecentSamplerPreset(dsXml, sampleMap);
  assert.equal(dsPreset.format, 'dspreset');
  assert.equal(dsPreset.presetName, 'Stradivarius Solo Violin');
  assert.equal(dsPreset.detectedCategory, 'Strings');
  assert.equal(dsPreset.suggestedParameterSet, 1);
  assert.equal(dsPreset.regions.length, 2);

  const r0 = dsPreset.regions[0];
  assert.equal(r0.sampleName, 'Violin_A4.wav');
  assert.equal(r0.rootKey, 69);
  assert.equal(r0.lowKey, 65);
  assert.equal(r0.highKey, 70);
  assert.equal(r0.lowVel, 1);
  assert.equal(r0.highVel, 127);
  assert.equal(r0.detuneCents, 5);
  assert.equal(r0.loopMode, 'loop_continuous');
  assert.equal(r0.loopStart, 1000);
  assert.equal(r0.loopEnd, 4000);
  assert.equal(dsPreset.envelope?.attack, 0.05);
  assert.equal(dsPreset.envelope?.release, 0.4);
  console.log('   [PASS] Decent Sampler XML and group ADSR/velocity inheritance verified.');

  // ── 2. Native Instruments Kontakt (.nki) Parsing ──
  console.log('2. Testing Kontakt XML & Encrypted Container Detection...');
  const nkiXml = `<?xml version="1.0" encoding="UTF-8"?>
<kontakt-instrument version="5.8.1">
  <header name="Grand Piano Stage" author="Steinway" license="Proprietary" comment="Concert Grand"/>
  <groups>
    <group id="0" name="MainGroup">
      <zones>
        <zone id="z01" sample="Samples/Violin_A4.wav" rootKey="69" lowKey="60" highKey="70" lowVel="1" highVel="63" tune="0" volume="-3.0" pan="0" loopMode="no_loop" loopStart="0" loopEnd="0"/>
        <zone id="z02" sample="Samples/Violin_C5.wav" rootKey="72" lowKey="71" highKey="84" lowVel="64" highVel="127" tune="10" volume="0.0" pan="10" loopMode="loop_continuous" loopStart="500" loopEnd="3000"/>
      </zones>
    </group>
  </groups>
</kontakt-instrument>`;

  const nkiPreset = parseKontaktNki(nkiXml, sampleMap);
  assert.equal(nkiPreset.format, 'nki');
  assert.equal(nkiPreset.presetName, 'Grand Piano Stage');
  assert.equal(nkiPreset.detectedCategory, 'Piano & Keys');
  assert.equal(nkiPreset.regions.length, 2);
  assert.equal(nkiPreset.regions[1].highVel, 127);
  assert.equal(nkiPreset.regions[1].detuneCents, 10);
  assert.equal(nkiPreset.regions[1].pan, 10);

  // Test encrypted container detection (NI monolith magic bytes 0x12 0x34 0x56 0x78)
  const fakeEncrypted = new Uint8Array([0x12, 0x34, 0x56, 0x78, 0x00, 0x00, 0x00, 0x10, ...new Array(70).fill(0xff)]);
  const encPreset = parseKontaktNki(fakeEncrypted.buffer);
  assert.equal(encPreset.isEncrypted, true);
  assert.ok(encPreset.encryptionNotice?.includes('Encrypted Native Instruments'));
  console.log('   [PASS] Kontakt XML parsing and encrypted container gate verified.');

  // ── 3. Steinberg HALion (.vstpreset) Parsing ──
  console.log('3. Testing Steinberg HALion (.vstpreset) XML Parser...');
  const vstXml = `<?xml version="1.0" encoding="UTF-8"?>
<HALionProgram name="Analog Prophet Pad" version="7.0">
  <element name="Layer 1">
    <zone-list>
      <zone name="A4" file="Samples/Violin_A4.wav" keyLow="48" keyHigh="72" rootKey="60" velLow="1" velHigh="127" tune="0" gain="-1.5" pan="0" loop="true" loopStart="200" loopEnd="4000"/>
    </zone-list>
  </element>
</HALionProgram>`;

  const vstPreset = parseHalionVstPreset(vstXml, sampleMap);
  assert.equal(vstPreset.format, 'vstpreset');
  assert.equal(vstPreset.presetName, 'Analog Prophet Pad');
  assert.equal(vstPreset.detectedCategory, 'Pads & Atmospheres');
  assert.equal(vstPreset.regions.length, 1);
  assert.equal(vstPreset.regions[0].lowKey, 48);
  assert.equal(vstPreset.regions[0].highKey, 72);
  console.log('   [PASS] HALion program XML parser verified.');

  // ── 4. Linear Sample Chains Parser ──
  console.log('4. Testing Linear Sample Chains (Uniform grid and slice extraction)...');
  const chainAudio = encodeWavPcm16([createSine(440, sRate, 0.4)], sRate); // 400ms = 17640 frames
  const chainPreset = parseSampleChainAudio(chainAudio, 'OctatrackDrum_4slice.wav', { gridSlices: 4 });
  assert.equal(chainPreset.format, 'samplechain');
  assert.equal(chainPreset.isSliceChain, true);
  assert.equal(chainPreset.regions.length, 4);
  assert.equal(chainPreset.audioBuffers.size, 4);
  // Slices mapped chromatically starting at C1 (36)
  assert.equal(chainPreset.regions[0].rootKey, 36);
  assert.equal(chainPreset.regions[1].rootKey, 37);
  assert.equal(chainPreset.regions[2].rootKey, 38);
  assert.equal(chainPreset.regions[3].rootKey, 39);
  console.log('   [PASS] Linear Sample Chain grid slicing and chromatic key mapping verified.');

  // ── 5. Universal Sampler ZIP Bundle Import ──
  console.log('5. Testing Universal Sampler Dispatcher with ZIP Archive...');
  const textEnc = new TextEncoder();
  const zipBuffer = createZipArchive([
    { path: 'ViolinSolo.dspreset', data: textEnc.encode(dsXml) },
    { path: 'Samples/Violin_A4.wav', data: new Uint8Array(wavA4) },
    { path: 'Samples/Violin_C5.wav', data: new Uint8Array(wavC5) },
  ]);

  const universalPreset = await parseUniversalSampler('ViolinArchive.zip', zipBuffer.buffer as ArrayBuffer);
  assert.equal(universalPreset.format, 'dspreset');
  assert.equal(universalPreset.regions.length, 2);
  assert.equal(universalPreset.audioBuffers.size, 2);
  console.log('   [PASS] Universal ZIP archive unpacking and format auto-routing verified.');

  // ── 6. Preflight Incompatibility Engine ──
  console.log('6. Testing Preflight Incompatibility Inspection Engine...');
  // Create preset with key gaps (covers 65..75) and missing audio
  const preflightReport = analyzeImportPreflight(dsPreset, 'classic');
  assert.equal(preflightReport.presetName, 'Stradivarius Solo Violin');
  assert.equal(preflightReport.canImport, true);
  assert.equal(preflightReport.totalRegions, 2);
  assert.equal(preflightReport.missingAudioCount, 0);

  // Key range is 65..75 -> unmapped low: 65, unmapped high: 127 - 75 = 52
  assert.equal(preflightReport.keyRange.uncoveredLowNotes, 65);
  assert.equal(preflightReport.keyRange.uncoveredHighNotes, 52);
  assert.ok(preflightReport.issues.some((i) => i.code === 'WARN_KEYBED_GAPS'));
  assert.equal(preflightReport.defaultActions.autoExtendOuterZones, true);

  // Apply adaptations: auto-extend outer zones to 0 and 127
  const adapted = applyPreflightImportAdaptations(dsPreset, {
    autoExtendOuterZones: true,
    adaptVelocityLayers: true,
    switchToExtendedMode: false,
    currentWorkingMode: 'classic',
  });

  assert.equal(adapted.classicZones.length, 2);
  assert.equal(adapted.classicZones[0].lowKey, 0, 'Lowest zone must extend to 0');
  assert.equal(adapted.classicZones[1].highKey, 127, 'Highest zone must extend to 127');
  console.log('   [PASS] Preflight inspection, gap reporting, and auto-extension verified.');

  // ── 7. AI Cover Prompt Instrument Motif Enrichment ──
  console.log('7. Testing AI Cover Prompt Instrument Motif Extraction...');
  const motifViolin = extractAcousticInstrumentMotif(['Stradivarius Solo Violin Vibrato', 'Strings', 'Violin_C4.wav']);
  assert.ok(motifViolin);
  assert.equal(motifViolin.instrument, 'Violin');
  assert.ok(motifViolin.visualCue.includes('silhouette'));
  assert.ok(motifViolin.visualCue.includes('violin'));

  const motifPiano = extractAcousticInstrumentMotif(['MyPatch', 'Synthesizer', 'Steinway_Grand_Piano_f_C3.wav']);
  assert.ok(motifPiano);
  assert.equal(motifPiano.instrument, 'Concert Grand Piano');
  assert.ok(motifPiano.visualCue.includes('grand piano lid silhouette'));

  const motifMoog = extractAcousticInstrumentMotif(['Moog Analog Bass Lead', 'Synthesizer']);
  assert.ok(motifMoog);
  assert.equal(motifMoog.instrument, 'Moog Synthesizer');

  // Verify prompt generation incorporates the visual motif
  const enrichedPrompt = buildAcousticArtworkPrompt({
    modelName: 'SoloViolin',
    expandedName: 'Stradivarius Expressive Violin',
    category: 'Strings',
    sampleNames: ['Violin_Arco_G3.wav', 'Violin_Arco_D4.wav'],
    style: 'minimalist_vector',
  });

  assert.ok(enrichedPrompt.includes('Stradivarius Expressive Violin'));
  assert.ok(enrichedPrompt.includes('violin'));
  assert.ok(enrichedPrompt.includes('silhouette'));
  console.log('   [PASS] Semantic instrument motif detection and prompt enrichment verified.');

  // ── 8. Configuration Health Diagnostic ──
  console.log('8. Testing Configuration Health Diagnostics...');
  const health = evaluateConfigHealth();
  assert.ok(health.mandatoryCount >= 3);
  assert.ok(health.optionalCount >= 4);
  assert.ok(health.items.some((i) => i.id === 'audio_engine'));
  assert.ok(health.items.some((i) => i.id === 'companion_bridge'));
  assert.ok(health.items.some((i) => i.id === 'cloud_byok'));
  console.log(`   [PASS] Configuration health verified (Status: ${health.overallStatus}, Mandatory: ${health.mandatoryConfigured}/${health.mandatoryCount}).`);

  console.log('\n================================================================');
  console.log('  ALL PHASE 18.8 UNIVERSAL IMPORT & HEALTH TESTS PASSED 100%!  ');
  console.log('================================================================\n');
}

runPhase18Tests().catch((err) => {
  console.error('Phase 18.8 Test failed:', err);
  process.exit(1);
});
