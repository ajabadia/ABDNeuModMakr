// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Phase 26 Verification Suite
// REX2 DWOP Audio Decompression & Companion Bridge Integration
// (Dual Engine: Client-Side TypeScript + Companion Bridge)
// ─────────────────────────────────────────────────────────

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseSliceFile } from '../src/core/dsp/SliceFileParser.ts';
import { decompressRx2Audio, isRx2Buffer } from '../src/core/dsp/DwopDecompressor.ts';
import { parseUniversalSampler } from '../src/core/import/rawSamplerParsers.ts';
import { analyzeImportPreflight } from '../src/core/import/importPreflight.ts';
import { bridgeClient } from '../src/core/bridge/BridgeClient.ts';

async function runPhase26Tests(): Promise<void> {
  console.log('=== ABDNeuModMakr Phase 26: REX2 Audio Decompression (TypeScript + Bridge) ===\n');

  // Locate the reference Casio VL-1 test loop
  const rx2Path = 'D:\\desarrollos\\ABDSynths\\_RESOURCES\\rex recycle\\Autodafe-Casio-VL-1-Loops\\4-beat.rx2';
  let rx2Buffer: ArrayBuffer;

  if (fs.existsSync(rx2Path)) {
    const nodeBuf = fs.readFileSync(rx2Path);
    rx2Buffer = nodeBuf.buffer.slice(nodeBuf.byteOffset, nodeBuf.byteOffset + nodeBuf.byteLength);
    console.log(`Loaded real REX2 reference file: ${rx2Path} (${rx2Buffer.byteLength} bytes)`);
  } else {
    console.log('Note: External reference REX2 file not found, creating synthetic IFF REX2 buffer...');
    const mock = new Uint8Array(256);
    mock.set([0x43, 0x41, 0x54, 0x20]); // 'CAT '
    rx2Buffer = mock.buffer;
  }

  // ── 1. Pure TypeScript Slice Header Parsing ──
  console.log('1. Testing REX2 slice marker header parsing (SliceFileParser)...');
  const parsedSlice = parseSliceFile(rx2Buffer, '4-beat.rx2');
  assert.ok(parsedSlice !== null, 'parseSliceFile should return a slice result for .rx2');
  assert.equal(parsedSlice.format, 'recycle-rx2', 'Format should be recycle-rx2');
  assert.ok(parsedSlice.sliceFrames.length >= 4, 'Should detect at least 4 slices');
  console.log(`   Detected ${parsedSlice.sliceFrames.length} slices:`, parsedSlice.sliceFrames);
  console.log(`   BPM: ${parsedSlice.bpm}, SampleRate: ${parsedSlice.sampleRate}`);
  assert.equal(parsedSlice.sampleRate, 44100, 'Sample rate should be 44100 Hz');

  // ── 2. Pure In-Browser TypeScript DWOP Decompressor (Vercel Ready) ──
  console.log('\n2. Testing 100% In-Browser TypeScript DWOP Audio Decompression...');
  assert.equal(isRx2Buffer(rx2Buffer), true, 'isRx2Buffer should return true');
  const tsResult = decompressRx2Audio(rx2Buffer);
  assert.equal(tsResult.channels.length, 1, 'Should decode 1 channel (mono)');
  assert.equal(tsResult.sampleRate, 44100, 'Sample rate should be 44100');
  assert.equal(tsResult.bitDepth, 24, 'Bit depth should be 24');
  assert.equal(tsResult.totalFrames, 58623, 'Total frames should be 58623');
  assert.equal(tsResult.channels[0].length, 58623, 'PCM buffer length should match total frames');
  assert.equal(tsResult.slices.length, 5, 'Should extract 5 slices');
  assert.ok(tsResult.wavBuffer.byteLength > 44, 'Should generate valid WAV buffer');
  console.log(`   TypeScript Engine decoded ${tsResult.totalFrames} frames! WAV size: ${tsResult.wavBuffer.byteLength} bytes.`);

  // ── 3. Companion Bridge /api/decode-rx2 Endpoint (Optional Server Route) ──
  console.log('\n3. Testing Companion Bridge DWOP audio decompression endpoint...');
  const bridgeStatus = await bridgeClient.checkHealth();
  const isBridgeAlive = bridgeStatus.connected;

  if (isBridgeAlive) {
    console.log('   Companion Bridge is online at port 7860! Calling decodeRx2Audio...');
    const result = await bridgeClient.decodeRx2Audio(rx2Buffer, '4-beat.rx2');
    assert.ok(result.wavBuffer.byteLength > 44, 'Decoded WAV buffer should contain audio data');
    assert.equal(result.decodedFrames, 58623, 'Should decode exactly 58623 audio frames');
    console.log(`   Bridge decoded ${result.decodedFrames} frames, WAV size: ${result.wavBuffer.byteLength} bytes`);

    // Verify capabilities include decode-rx2
    const caps = bridgeClient.getStatus().capabilities?.capabilities ?? [];
    assert.ok(caps.includes('decode-rx2'), 'Bridge capabilities should advertise decode-rx2');
    console.log('   Bridge capabilities verified:', caps);
  } else {
    console.log('   Companion Bridge is offline (pure TypeScript engine handles decompression natively).');
  }

  // ── 4. Universal Sampler Integration with In-Browser Decompression ──
  console.log('\n4. Testing Universal Sampler with native TypeScript REX2 decompression...');
  const rexPreset = await parseUniversalSampler('4-beat.rx2', rx2Buffer);
  assert.equal(rexPreset.format, 'samplechain', 'Format should be samplechain');
  assert.equal(rexPreset.formatLabel, 'ReCycle REX2 Loop', 'Format label should indicate REX2');
  assert.equal(rexPreset.isSliceChain, true, 'isSliceChain should be true');
  assert.equal(rexPreset.isEncrypted, false, 'isEncrypted should be false');
  assert.equal(rexPreset.sliceFrames?.length, parsedSlice.sliceFrames.length, 'Slice frames count should match');
  assert.equal(rexPreset.audioBuffers.size, parsedSlice.sliceFrames.length, 'Should cut one audio buffer per slice');
  assert.equal(rexPreset.regions.length, parsedSlice.sliceFrames.length, 'Should create one region per slice');
  console.log(`   Generated ${rexPreset.regions.length} slice regions and ${rexPreset.audioBuffers.size} slice WAV buffers in pure TypeScript.`);

  // Verify slice mapping
  const firstRegion = rexPreset.regions[0];
  assert.equal(firstRegion.rootKey, 36, 'First slice mapped to C1 (MIDI 36)');
  assert.equal(firstRegion.lowKey, 36);
  assert.equal(firstRegion.highKey, 36);

  // ── 5. Import Preflight Analysis with Native Decompression ──
  console.log('\n5. Testing Import Preflight with natively decompressed REX2 loop...');
  const preflightReady = analyzeImportPreflight(rexPreset, 'classic');
  assert.equal(preflightReady.isSliceChain, true);
  assert.equal(preflightReady.sliceCount, parsedSlice.sliceFrames.length);
  assert.equal(preflightReady.canImport, true, 'canImport should be true when audio is decoded');
  assert.equal(preflightReady.defaultActions.openInAudioChopper, true, 'openInAudioChopper should be true');
  const hasCompressionWarning = preflightReady.issues.some((i) => i.code === 'WARN_REX2_COMPRESSION');
  assert.equal(hasCompressionWarning, false, 'Should have NO compression warning when audio is decoded');
  console.log('   Preflight confirmed ready for direct session injection and Audio Chopper.');

  // ── 6. Import Preflight Analysis in Corrupted / Audio-Missing State ──
  console.log('\n6. Testing Import Preflight with missing audio chunks (pairing assistant trigger)...');
  // Create mock preset without audio buffers
  const mockMissingPreset = {
    ...rexPreset,
    audioBuffers: new Map<string, ArrayBuffer>(),
    regions: [],
  };

  const preflightMissing = analyzeImportPreflight(mockMissingPreset, 'classic');
  assert.equal(preflightMissing.isSliceChain, true);
  assert.equal(preflightMissing.defaultActions.openInAudioChopper, true, 'openInAudioChopper should be enabled');
  const missingWarning = preflightMissing.issues.find((i) => i.code === 'WARN_REX2_COMPRESSION');
  assert.ok(missingWarning !== undefined, 'Should flag WARN_REX2_COMPRESSION when audio buffers are missing');
  console.log('   Preflight missing-audio warning validated:', missingWarning.description);

  console.log('\n=== All Phase 26 REX2 Tests Passed Successfully! ===\n');
}

runPhase26Tests().catch((err) => {
  console.error('Phase 26 Test Failure:', err);
  process.exit(1);
});
