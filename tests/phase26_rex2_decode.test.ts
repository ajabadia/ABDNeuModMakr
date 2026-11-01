// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Phase 26 Verification Suite
// REX2 DWOP Audio Decompression & Companion Bridge Integration
// ─────────────────────────────────────────────────────────

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseSliceFile } from '../src/core/dsp/SliceFileParser.ts';
import { decodeWav, encodeWavPcm16 } from '../src/core/dsp/WavDecoder.ts';
import { parseUniversalSampler, parseRex2Sampler } from '../src/core/import/rawSamplerParsers.ts';
import { analyzeImportPreflight } from '../src/core/import/importPreflight.ts';
import { bridgeClient } from '../src/core/bridge/BridgeClient.ts';

async function runPhase26Tests(): Promise<void> {
  console.log('=== ABDNeuModMakr Phase 26: REX2 Audio Decompression & Bridge Suite ===\n');

  // Locate the reference Casio VL-1 test loop
  const rx2Path = 'D:\\desarrollos\\ABDSynths\\_RESOURCES\\rex recycle\\Autodafe-Casio-VL-1-Loops\\4-beat.rx2';
  let rx2Buffer: ArrayBuffer;

  if (fs.existsSync(rx2Path)) {
    const nodeBuf = fs.readFileSync(rx2Path);
    rx2Buffer = nodeBuf.buffer.slice(nodeBuf.byteOffset, nodeBuf.byteOffset + nodeBuf.byteLength);
    console.log(`Loaded real REX2 reference file: ${rx2Path} (${rx2Buffer.byteLength} bytes)`);
  } else {
    console.log('Note: External reference REX2 file not found, creating synthetic IFF REX2 buffer...');
    // Create minimal mock CAT REX2 buffer with 3 slices
    const mock = new Uint8Array(256);
    mock.set([0x43, 0x41, 0x54, 0x20]); // 'CAT '
    rx2Buffer = mock.buffer;
  }

  // ── 1. Pure TypeScript Slice Header Parsing ──
  console.log('1. Testing REX2 slice marker header parsing (TypeScript engine)...');
  const parsedSlice = parseSliceFile(rx2Buffer, '4-beat.rx2');
  assert.ok(parsedSlice !== null, 'parseSliceFile should return a slice result for .rx2');
  assert.equal(parsedSlice.format, 'recycle-rx2', 'Format should be recycle-rx2');
  assert.ok(parsedSlice.sliceFrames.length >= 4, 'Should detect at least 4 slices');
  console.log(`   Detected ${parsedSlice.sliceFrames.length} slices:`, parsedSlice.sliceFrames);
  console.log(`   BPM: ${parsedSlice.bpm}, SampleRate: ${parsedSlice.sampleRate}`);
  assert.equal(parsedSlice.sampleRate, 44100, 'Sample rate should be 44100 Hz');

  // ── 2. Companion Bridge /api/decode-rx2 Decompression ──
  console.log('\n2. Testing Companion Bridge DWOP audio decompression...');
  let decodedWavBuffer: ArrayBuffer | null = null;
  const isBridgeAlive = await bridgeClient.checkHealth();

  if (isBridgeAlive) {
    console.log('   Companion Bridge is online at port 7860! Calling decodeRx2Audio...');
    const result = await bridgeClient.decodeRx2Audio(rx2Buffer, '4-beat.rx2');
    assert.ok(result.wavBuffer.byteLength > 44, 'Decoded WAV buffer should contain audio data');
    assert.ok(result.decodedFrames > 10000, 'Should decode audio frames');
    console.log(`   Decoded ${result.decodedFrames} frames, WAV size: ${result.wavBuffer.byteLength} bytes`);
    console.log(`   Audio Info:`, result.info);

    // Verify WAV RIFF header
    const wavView = new DataView(result.wavBuffer);
    const magic = String.fromCharCode(wavView.getUint8(0), wavView.getUint8(1), wavView.getUint8(2), wavView.getUint8(3));
    assert.equal(magic, 'RIFF', 'Decoded WAV should start with RIFF header');

    // Decode WAV with WavDecoder
    const decodedAudio = decodeWav(result.wavBuffer);
    assert.equal(decodedAudio.sampleRate, 44100, 'Decoded WAV sample rate should be 44100');
    assert.equal(decodedAudio.channels.length, 1, 'Decoded WAV should be mono for this file');
    assert.equal(decodedAudio.channels[0].length, result.decodedFrames, 'PCM frame count should match decoded frames');
    decodedWavBuffer = result.wavBuffer;

    // Verify capabilities include decode-rx2
    const caps = bridgeClient.getStatus().capabilities?.capabilities ?? [];
    assert.ok(caps.includes('decode-rx2'), 'Bridge capabilities should advertise decode-rx2');
    console.log('   Bridge capabilities verified:', caps);
  } else {
    console.log('   Companion Bridge is offline; synthesizing mock WAV for downstream integration testing...');
    const mockPcm = new Float32Array(58623);
    for (let i = 0; i < mockPcm.length; i++) {
      mockPcm[i] = Math.sin((i / 44100) * 440 * 2 * Math.PI) * 0.5;
    }
    decodedWavBuffer = encodeWavPcm16([mockPcm], 44100);
  }

  // ── 3. Universal Sampler Integration with Decompressed Audio ──
  console.log('\n3. Testing Universal Sampler with decompressed REX2 audio...');
  assert.ok(decodedWavBuffer !== null, 'decodedWavBuffer must be present');
  const rexPreset = await parseUniversalSampler('4-beat.rx2', rx2Buffer, decodedWavBuffer);
  assert.equal(rexPreset.format, 'samplechain', 'Format should be samplechain');
  assert.equal(rexPreset.formatLabel, 'ReCycle REX2 Loop', 'Format label should indicate REX2');
  assert.equal(rexPreset.isSliceChain, true, 'isSliceChain should be true');
  assert.equal(rexPreset.isEncrypted, false, 'isEncrypted should be false');
  assert.equal(rexPreset.sliceFrames?.length, parsedSlice.sliceFrames.length, 'Slice frames count should match');
  assert.equal(rexPreset.audioBuffers.size, parsedSlice.sliceFrames.length, 'Should cut one audio buffer per slice');
  assert.equal(rexPreset.regions.length, parsedSlice.sliceFrames.length, 'Should create one region per slice');
  console.log(`   Generated ${rexPreset.regions.length} slice regions and ${rexPreset.audioBuffers.size} slice WAV buffers.`);

  // Verify slice mapping
  const firstRegion = rexPreset.regions[0];
  assert.equal(firstRegion.rootKey, 36, 'First slice mapped to C1 (MIDI 36)');
  assert.equal(firstRegion.lowKey, 36);
  assert.equal(firstRegion.highKey, 36);

  // ── 4. Import Preflight Analysis with Decompressed Audio ──
  console.log('\n4. Testing Import Preflight with decompressed REX2 audio...');
  const preflightReady = analyzeImportPreflight(rexPreset, 'classic');
  assert.equal(preflightReady.isSliceChain, true);
  assert.equal(preflightReady.sliceCount, parsedSlice.sliceFrames.length);
  assert.equal(preflightReady.canImport, true, 'canImport should be true when audio is decoded');
  assert.equal(preflightReady.defaultActions.openInAudioChopper, true, 'openInAudioChopper should be true');
  const hasCompressionWarning = preflightReady.issues.some((i) => i.code === 'WARN_REX2_COMPRESSION');
  assert.equal(hasCompressionWarning, false, 'Should have NO compression warning when audio is decoded');
  console.log('   Preflight confirmed ready for direct session injection and Audio Chopper.');

  // ── 5. Import Preflight Analysis in Offline / Unpaired State ──
  console.log('\n5. Testing Import Preflight with offline/unpaired REX2 loop...');
  const offlinePreset = parseRex2Sampler(rx2Buffer, '4-beat.rx2'); // No decoded WAV provided
  assert.equal(offlinePreset.audioBuffers.size, 0, 'Audio buffers should be empty without decoded WAV');
  assert.equal(offlinePreset.sliceFrames?.length, parsedSlice.sliceFrames.length, 'Slice markers should still be extracted');

  const preflightOffline = analyzeImportPreflight(offlinePreset, 'classic');
  assert.equal(preflightOffline.isSliceChain, true);
  assert.equal(preflightOffline.defaultActions.openInAudioChopper, true, 'openInAudioChopper should be enabled');
  const offlineWarning = preflightOffline.issues.find((i) => i.code === 'WARN_REX2_COMPRESSION');
  assert.ok(offlineWarning !== undefined, 'Should flag WARN_REX2_COMPRESSION when audio buffers are missing');
  console.log('   Preflight offline warning validated:', offlineWarning.description);

  console.log('\n=== All Phase 26 REX2 Tests Passed Successfully! ===\n');
}

runPhase26Tests().catch((err) => {
  console.error('Phase 26 Test Failure:', err);
  process.exit(1);
});
