// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Phase 20: AI Model Cover Artwork Generator Tests
//
// Validates:
//   1. Acoustic prompt construction across all styles and parameter sets
//   2. Procedural acoustic artwork generation (headless RIFF WEBP 512×512)
//   3. Multi-provider orchestrator (Procedural, Companion Bridge, BYOK validation)
//   4. CloudByokClient OpenAI provider integration
//   5. Packaging of generated cover into Time Capsule layer 05_extended_model/cover.webp
// ─────────────────────────────────────────────────────────

import assert from 'node:assert/strict';
import {
  ARTWORK_STYLES,
  buildAcousticArtworkPrompt,
  generateModelArtwork,
} from '../src/core/ai/ModelArtworkGenerator.ts';
import { generateProceduralArtwork } from '../src/core/ai/ProceduralAcousticArtwork.ts';
import { cloudByokClient } from '../src/core/ai/CloudByokClient.ts';
import { isWebpBytes, dataUrlToWebpBytes, parseWebpDimensions } from '../src/core/coverArtwork.ts';
import { buildTimeCapsuleZipArchive } from '../src/core/timeCapsule.ts';
import { parseZipArchive } from '../src/formats/ZipArchive.ts';
import type { ProcessConfig, Zone } from '../src/core/types.ts';

async function runPhase20Tests() {
  console.log('--- Test 1: Acoustic Prompt Synthesis Across Styles ---');
  for (const style of ARTWORK_STYLES) {
    const prompt = buildAcousticArtworkPrompt({
      modelName: 'VocalChoirLead',
      expandedName: 'Ethereal Cyber Vocal Choir 1974',
      parameterSet: 5,
      parameterSetName: 'Winds & Voice',
      category: 'Vocal & Choir',
      style: style.id,
      customPrompt: 'Subtle neon backlighting',
    });

    assert.ok(prompt.includes('Ethereal Cyber Vocal Choir 1974'), `Prompt should include title for style ${style.id}`);
    assert.ok(prompt.includes('Vocal & Choir'), `Prompt should include category for style ${style.id}`);
    assert.ok(prompt.includes('Winds & Voice'), `Prompt should include parameter set for style ${style.id}`);
    assert.ok(prompt.includes('Subtle neon backlighting'), `Prompt should include custom prompt for style ${style.id}`);
    assert.ok(prompt.includes('Square composition 1:1 aspect ratio'), `Prompt should enforce 1:1 composition`);
  }
  console.log('✓ All 6 style prompts synthesized with rich acoustic context.');

  console.log('\n--- Test 2: Procedural Acoustic Artwork Generation (Headless) ---');
  const proceduralArt = await generateProceduralArtwork({
    modelName: 'BassMatrix',
    expandedName: 'Subterranean Analog 808 Bass',
    parameterSet: 4,
    parameterSetName: 'Bass & Low End',
    style: 'cyberpunk',
    detectedF0Hz: 55.0,
    width: 512,
    height: 512,
  });

  assert.equal(proceduralArt.width, 512, 'Width must be 512');
  assert.equal(proceduralArt.height, 512, 'Height must be 512');
  assert.ok(proceduralArt.webpDataUrl.startsWith('data:image/webp;base64,'), 'Must be a valid webp Data URL');
  assert.ok(proceduralArt.byteLength > 0, 'Byte length must be positive');

  const rawBytes = dataUrlToWebpBytes(proceduralArt.webpDataUrl);
  assert.ok(isWebpBytes(rawBytes), 'Raw bytes must match RIFF....WEBP format');
  const dims = parseWebpDimensions(rawBytes);
  assert.equal(dims.width, 512, 'Decoded width must be 512');
  assert.equal(dims.height, 512, 'Decoded height must be 512');
  console.log(`✓ Procedural artwork generated: 512×512 WebP (${rawBytes.byteLength} bytes)`);

  console.log('\n--- Test 3: Multi-Provider Orchestrator (Procedural) ---');
  const orchestratorResult = await generateModelArtwork({
    modelName: 'ArpMatrix',
    expandedName: 'Bowed Glass Matrix Arp',
    parameterSet: 1,
    style: 'studio_hifi',
    provider: 'procedural',
  });

  assert.equal(orchestratorResult.success, true, 'Orchestrator must succeed for procedural');
  assert.ok(orchestratorResult.coverArtwork, 'Must return coverArtwork');
  assert.equal(orchestratorResult.providerUsed, 'procedural');
  assert.ok(orchestratorResult.generationTimeMs >= 0);
  assert.ok(orchestratorResult.promptUsed.length > 30);
  console.log(`✓ Orchestrator procedural dispatch verified in ${orchestratorResult.generationTimeMs}ms.`);

  console.log('\n--- Test 4: Companion Bridge Local Endpoint Test ---');
  const bridgeResult = await generateModelArtwork({
    modelName: 'BridgeSynth',
    expandedName: 'Local Companion Neural Patch',
    parameterSet: 0,
    style: 'retro_80s',
    provider: 'bridge',
  });

  // If local bridge is active, it returns success
  if (bridgeResult.success) {
    assert.ok(bridgeResult.coverArtwork, 'Bridge returned artwork');
    assert.equal(bridgeResult.coverArtwork.width, 512);
    assert.equal(bridgeResult.coverArtwork.height, 512);
    console.log(`✓ Companion Bridge artwork generation verified (${bridgeResult.generationTimeMs}ms).`);
  } else {
    console.log(`ℹ Companion Bridge offline or uncontactable (${bridgeResult.error}); graceful error verified.`);
    assert.ok(bridgeResult.error, 'Must provide explanatory error string');
  }

  console.log('\n--- Test 5: Graceful Error Handling on Missing BYOK Keys ---');
  const missingKeyResult = await generateModelArtwork({
    modelName: 'CloudPatch',
    style: 'neural_abstract',
    provider: 'openai',
    apiKey: '', // Empty key
  });
  assert.equal(missingKeyResult.success, false, 'Must fail gracefully without valid key');
  assert.ok(missingKeyResult.error?.includes('API Key is missing'), 'Must state API key is missing');
  console.log('✓ Graceful error handling for unconfigured cloud providers verified.');

  console.log('\n--- Test 6: CloudByokClient OpenAI Provider Support ---');
  cloudByokClient.saveConfig({ openaiApiKey: 'sk-test-mock-key-12345' });
  assert.equal(cloudByokClient.getConfig().openaiApiKey, 'sk-test-mock-key-12345');
  assert.equal(cloudByokClient.hasValidKey('openai'), true);
  // Clear key
  cloudByokClient.saveConfig({ openaiApiKey: '' });
  assert.equal(cloudByokClient.hasValidKey('openai'), false);
  console.log('✓ CloudByokClient OpenAI provider integration verified.');

  console.log('\n--- Test 7: Time Capsule Layer 05 Integration ---');
  const cfg: ProcessConfig = {
    modelNumber: 0,
    modelName: 'TimeCapsuleAI',
    complexity: 8,
    parameterSet: 0,
    targetFormat: 'dual',
    workingMode: 'extended',
    coverArtwork: proceduralArt,
  };

  const dummyZone: Zone = {
    id: 'z1',
    zoneIndex: 0,
    lowKey: 0,
    highKey: 127,
    rootKey: 60,
    lowVelocity: 1,
    highVelocity: 127,
    sampleNameA: 'test.wav',
    sampleNameB: null,
    crossfade: 0,
  };

  const { zipBytes } = buildTimeCapsuleZipArchive({
    slot: 0,
    modelName: cfg.modelName,
    processConfig: cfg,
    zones: [dummyZone],
  });

  assert.ok(zipBytes.byteLength > 0, 'Zip file must be created');
  const archive = parseZipArchive(zipBytes);
  const coverEntry = archive.find((f) => f.path.endsWith('05_extended_model/cover.webp'));
  assert.ok(coverEntry, '05_extended_model/cover.webp must be present in Time Capsule');
  assert.ok(isWebpBytes(coverEntry.data), 'Cover file in Time Capsule must be a valid RIFF WEBP');
  console.log(`✓ Time Capsule contains 05_extended_model/cover.webp (${coverEntry.data.byteLength} bytes).`);

  console.log('\n======================================================');
  console.log('  Phase 20 AI Model Cover Artwork Tests Passed 100%!  ');
  console.log('======================================================');
}

runPhase20Tests().catch((err) => {
  console.error('Phase 20 test failure:', err);
  process.exit(1);
});
