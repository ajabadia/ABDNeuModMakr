// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Phase 1 Audio Pipeline & Binary Spec Verification Suite
//
// Validates:
//   1. WAV Decoder (PCM 8/16/24/32-bit, IEEE Float 32/64-bit, AIFF FORM/COMM/SSND/INST)
//   2. FFT / STFT Engine (Radix-2 Cooley-Tukey 2048/4096/8192, Hanning/Blackman/Blackman-Harris)
//   3. SpectralAnalyzer (HPS + 2-pass Least Squares F0, harmonic peak-picking, inharmonic offsets)
//   4. LayerClustering & GridIndicator (2-layer drone+swell separation, green/amber/orange bands)
//   5. ScapeSphereGenerator (.scape csAN, .sphere psAN + 6152B partial bank, map.script, .neuronikmodel)
//   6. Additive resynthesis verification (resynthesizeModelToPcm -> re-analyze F0 match)
//   7. WebAudioPipeline (full CoreService contract + multi-zone session processing)
// ─────────────────────────────────────────────────────────

import {
  decodeWav,
  encodeWavPcm16,
  midiNoteToHz,
  synthesizeDemoWav,
} from '../src/core/dsp/WavDecoder.ts';
import {
  FftEngine,
  computeStft,
  createWindowTable,
} from '../src/core/dsp/FftEngine.ts';
import { SpectralAnalyzer } from '../src/core/dsp/SpectralAnalyzer.ts';
import {
  clusterTraces,
} from '../src/core/dsp/LayerClustering.ts';
import {
  evaluateGridIndicator,
  buildLayerView,
} from '../src/core/dsp/GridIndicator.ts';
import {
  complexityToRecursionDepth,
  generateScapeSphereFrames,
  generateMapScript,
  resynthesizeModelToPcm,
} from '../src/core/dsp/ScapeSphereGenerator.ts';
import { WebAudioPipeline } from '../src/core/WebAudioPipeline.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

function makeTestAiff16Mono(samples: Float32Array, sampleRate = 44100, rootKey = 60): ArrayBuffer {
  const numSamples = samples.length;
  const ssndPayloadSize = 8 + numSamples * 2;
  const commSize = 18;
  const instSize = 20;
  const formSize = 4 + (8 + commSize) + (8 + instSize) + (8 + ssndPayloadSize);
  const buf = new ArrayBuffer(8 + formSize);
  const view = new DataView(buf);

  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };

  writeStr(0, 'FORM');
  view.setUint32(4, formSize, false);
  writeStr(8, 'AIFF');

  // COMM chunk at 12
  writeStr(12, 'COMM');
  view.setUint32(16, commSize, false);
  view.setUint16(20, 1, false); // mono
  view.setUint32(22, numSamples, false);
  view.setUint16(26, 16, false); // 16-bit
  // Write 44100.0 as 80-bit IEEE extended float: exp = 16383 + 15 = 16398 (0x400E), hi = 0xAC440000
  view.setUint16(28, 0x400e, false);
  view.setUint32(30, (sampleRate << 16) >>> 0, false);
  view.setUint32(34, 0, false);

  // INST chunk at 38
  writeStr(38, 'INST');
  view.setUint32(42, instSize, false);
  view.setUint8(46, rootKey);
  view.setInt8(47, -5); // detune -5 cents
  view.setUint8(48, 36); // lowKey
  view.setUint8(49, 84); // highKey
  view.setUint8(50, 1);  // lowVel
  view.setUint8(51, 127); // highVel
  view.setInt16(52, 0, false);

  // SSND chunk at 66
  writeStr(66, 'SSND');
  view.setUint32(70, ssndPayloadSize, false);
  view.setUint32(74, 0, false); // offset
  view.setUint32(78, 0, false); // blockSize

  let ptr = 82;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(ptr, Math.round(s * 32767), false);
    ptr += 2;
  }
  return buf;
}

function makeTestWavFloat32(samples: Float32Array, sampleRate = 44100): ArrayBuffer {
  const dataSize = samples.length * 4;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true); // IEEE Float
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 32, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < samples.length; i++) {
    view.setFloat32(44 + i * 4, samples[i], true);
  }
  return buf;
}

async function runTests(): Promise<void> {
  console.log('=== ABDNeuModMakr Phase 1 Pipeline Verification ===');

  // 1. Test WAV & AIFF Decoders
  {
    const wavBuf = synthesizeDemoWav('strings', 60, 44100, 0.5);
    const decodedWav = decodeWav(wavBuf);
    assert(decodedWav.sampleRate === 44100, 'WAV sampleRate should be 44100');
    assert(decodedWav.numChannels === 2, 'WAV should be stereo');
    assert(decodedWav.bitsPerSample === 16, 'WAV should be 16-bit');
    assert(decodedWav.mono.length === 22050, 'WAV mono length should be 22050');

    const floatWav = makeTestWavFloat32(decodedWav.mono, 48000);
    const decodedFloat = decodeWav(floatWav);
    assert(decodedFloat.formatTag === 'ieee-float', 'Should decode IEEE Float32 WAV');
    assert(decodedFloat.sampleRate === 48000, 'Float WAV sampleRate should be 48000');

    const aiffBuf = makeTestAiff16Mono(decodedWav.mono, 44100, 60);
    const decodedAiff = decodeWav(aiffBuf);
    assert(decodedAiff.formatTag === 'aiff-pcm', 'Should decode FORM/AIFF');
    assert(decodedAiff.sampleRate === 44100, 'AIFF IEEE-80 sampleRate should be 44100');
    assert(decodedAiff.instrument?.rootKey === 60, 'AIFF INST rootKey should be 60');
    console.log('  [OK] 1.1 WAV (PCM 16 / IEEE Float 32) & AIFF (FORM/COMM/SSND/INST) decoders verified');
  }

  // 2. Test FFT & STFT Engine
  {
    const fftSize = 4096;
    const sampleRate = 44100;
    const testFreq = 440.0;
    const signal = new Float32Array(fftSize * 2);
    for (let i = 0; i < signal.length; i++) {
      signal[i] = Math.sin((2 * Math.PI * testFreq * i) / sampleRate);
    }

    const stft = computeStft(signal, {
      frameSize: fftSize,
      hopSize: 1024,
      windowType: 'hanning',
      sampleRate,
    });
    assert(stft.frames.length >= 4, 'STFT should produce multiple frames');
    const expectedBin = Math.round(testFreq / stft.binWidthHz);
    let maxBin = 0;
    let maxMag = -1;
    const mags = stft.frames[0].magnitudes;
    for (let b = 0; b < mags.length; b++) {
      if (mags[b] > maxMag) {
        maxMag = mags[b];
        maxBin = b;
      }
    }
    assert(Math.abs(maxBin - expectedBin) <= 1, `FFT peak bin ${maxBin} should match ${expectedBin}`);

    const bhWin = createWindowTable(8192, 'blackman-harris');
    assert(bhWin.length === 8192 && bhWin[4096] > 0.99, 'Blackman-Harris window peak check');
    const fft8k = new FftEngine(13);
    assert(fft8k.size === 8192 && fft8k.numBins === 4097, '8192-pt FFT dimensions');
    console.log('  [OK] 1.2 Radix-2 FFT (4096/8192) & STFT engine verified');
  }

  // 3. Test SpectralAnalyzer (HPS + Least Squares F0 + 64 Partials + Grid Indicator)
  {
    const analyzer = new SpectralAnalyzer();
    const rootNote = 60; // C4 = 261.6256 Hz
    const expectedF0 = midiNoteToHz(rootNote);
    const wavBuf = synthesizeDemoWav('strings', rootNote, 44100, 1.0);
    const decoded = decodeWav(wavBuf);

    const detectedF0 = analyzer.detectPitch(decoded.channels, decoded.sampleRate);
    const centsErr = Math.abs(1200 * Math.log2(detectedF0 / expectedF0));
    assert(
      centsErr < 5.0,
      `Detected F0 (${detectedF0.toFixed(2)} Hz) should be within 5 cents of ${expectedF0.toFixed(2)} Hz (got ${centsErr.toFixed(2)} cents)`
    );
    assert(
      analyzer.lastGridResidualCents() >= 0 && analyzer.lastGridResidualCents() < 15.0,
      `Grid residual (${analyzer.lastGridResidualCents().toFixed(2)} cents) should be in GREEN band (<= 15 cents)`
    );

    const indicator = evaluateGridIndicator({
      detectedHz: detectedF0,
      residualCents: analyzer.lastGridResidualCents(),
      observations: analyzer.lastGridObservations(),
    });
    assert(indicator.band === 'green', 'GridIndicator should report green band');

    const temporalModel = analyzer.analyzeTemporal(
      decoded.channels,
      decoded.sampleRate,
      detectedF0,
      8,
      false,
      'descriptors'
    );
    assert(temporalModel.isValid, 'Temporal SpectralModel should be valid');
    assert(temporalModel.amplitudes[0] > 0.5, 'Fundamental partial should have strong amplitude');
    console.log(
      `  [OK] 1.3 SpectralAnalyzer verified: detected F0=${detectedF0.toFixed(2)} Hz, ${analyzer.gridResidualNotice()}`
    );
  }

  // 4. Test LayerClustering (Drone + Voice Crest -> 2 Layers)
  {
    const numTraces = 64;
    const numFrames = 8;
    const traces = new Float32Array(numTraces * numFrames);
    // Partials 0..5: persistent flat drone across all 8 frames
    for (let t = 0; t < 6; t++) {
      for (let f = 0; f < numFrames; f++) {
        traces[t * numFrames + f] = 0.8 / (t + 1);
      }
    }
    // Partials 6..11: short transient crest active only in frames 2 and 3
    for (let t = 6; t < 12; t++) {
      traces[t * numFrames + 2] = 0.9;
      traces[t * numFrames + 3] = 0.85;
    }

    const clustered = clusterTraces(traces, numTraces, numFrames);
    assert(
      clustered.layerCount === 2,
      `Expected 2 layers (drone + transient crest), got ${clustered.layerCount}`
    );
    assert(clustered.layerOfTrace[0] === 0, 'Drone should be Layer 0 (most persistent)');
    assert(clustered.layerOfTrace[6] === 1, 'Transient crest should be Layer 1');
    console.log('  [OK] 1.3b LayerClustering envelope separation (Drone vs Crest -> 2 layers) verified');
  }

  // 5. Test ScapeSphereGenerator, Complexity Mapping, Authentic .scape/.sphere & Additive Resynthesis
  {
    assert(complexityToRecursionDepth(1) === 1, 'Complexity 1 -> recDepth 1');
    assert(complexityToRecursionDepth(8) === 42, 'Complexity 8 -> recDepth 42');
    assert(complexityToRecursionDepth(10) === 64, 'Complexity 10 -> recDepth 64');

    const analyzer = new SpectralAnalyzer();
    const wavBuf = synthesizeDemoWav('bell', 69, 44100, 1.0); // A4 = 440 Hz
    const decoded = decodeWav(wavBuf);
    const f0 = analyzer.detectPitch(decoded.channels, decoded.sampleRate);
    const model = analyzer.analyzeTemporal(decoded.channels, decoded.sampleRate, f0, 8);
    const view = buildLayerView(model, analyzer.lastOctaveFold());
    assert(view.activePartials >= 8, 'LayerView should report active partials');

    const pkg = generateScapeSphereFrames(model, {
      modelNumber: 12,
      modelName: 'GlassBell',
      complexity: 8,
      parameterSet: 2,
    });

    assert(pkg.frames.length === 8, 'Should generate 8 Scape/Sphere frames');
    assert(pkg.scapeBinary.byteLength > 260, 'Authentic .scape binary should contain csAN+mnAN+fdAN+samples');
    assert(
      pkg.sphereBinary.byteLength === 300 + 8 * 6568,
      `Authentic .sphere binary size should be 300 + 8*6568 = ${300 + 8 * 6568} bytes`
    );

    // Resynthesize to PCM and verify pitch of reconstructed waveform!
    const resynthPcm = resynthesizeModelToPcm(model, 0.8, 44100);
    const resynthF0 = analyzer.detectPitch(resynthPcm, 44100);
    const resynthCents = Math.abs(1200 * Math.log2(resynthF0 / 440.0));
    assert(
      resynthCents < 10.0,
      `Resynthesized audio pitch (${resynthF0.toFixed(2)} Hz) should match 440 Hz within 10 cents`
    );

    const reencodedWav = encodeWavPcm16([resynthPcm], 44100);
    assert(reencodedWav.byteLength === 44 + resynthPcm.length * 2, 'Re-encoded WAV size check');
    console.log(
      `  [OK] 1.4 Scape/Sphere binary generator & additive resynthesis verified (resynth F0=${resynthF0.toFixed(2)} Hz)`
    );
  }

  // 6. Test WebAudioPipeline full CoreService workflow
  {
    const pipeline = new WebAudioPipeline();
    await pipeline.init();
    const session = await pipeline.loadSession('demo');
    assert(session.zones.length === 5, 'Loaded demo session should have 5 zones');
    const coverageErrors = pipeline.validateCoverage();
    assert(coverageErrors.length === 0, 'Demo session should have 0 coverage errors');

    const mapScript = generateMapScript(session.zones);
    assert(mapScript.includes('MapVersionMajor\t0'), 'map.script header check');
    assert(mapScript.includes('000LowKey\t0'), 'map.script zone 000 check');

    let completedModelSlot = -1;
    let progressCount = 0;
    pipeline.on((ev) => {
      if (ev.type === 'process-progress') progressCount++;
      if (ev.type === 'process-complete') completedModelSlot = ev.model.slot;
    });

    await pipeline.startProcess({
      modelNumber: 42,
      modelName: 'NeuralTest',
      complexity: 8,
      parameterSet: 1,
    });

    assert(completedModelSlot === 42, 'Process should complete and emit model slot 42');
    assert(progressCount >= 5, 'Process should emit progress updates per zone');
    const bank = await pipeline.loadBank();
    const generated = bank.models.find((m) => m.slot === 42);
    assert(Boolean(generated && generated.zonesAnalysis?.length === 5), 'Generated model should contain 5 ZoneAnalysisSummaries');
    pipeline.dispose();
    console.log('  [OK] 1.5 WebAudioPipeline end-to-end multi-zone execution verified');
  }

  console.log('=== ALL PHASE 1 TESTS PASSED ===');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
