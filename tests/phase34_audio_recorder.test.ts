// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Phase 34: Audio Recorder, Silence Detector,
// Noise Print Selection & DSP/AI Enhancement Test Suite
// ─────────────────────────────────────────────────────────

import {
  RecordingEngine,
  encodeWav16,
  extractTakeFeatures,
  classifyTake,
  rmsDbfs,
  peakAmplitude,
  type AudioInputSource,
} from '../vendor/@abdsynths/shared/Code/DspCore/TakeDsp/index.ts';
import { AudioRecorderModal } from '../src/ui/AudioRecorderModal.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

function makeFakeSource(sampleRate = 48000, channels = 1): AudioInputSource {
  return {
    sampleRate,
    channels,
    start() {},
    stop() {},
  };
}

function makeSineWithLeadAndNoise(
  sampleRate: number,
  leadSec: number,
  toneSec: number,
  tailSec: number,
  freqHz = 440,
  toneAmp = 0.4,
  noiseAmp = 0.008,
  hum50Amp = 0.02
): Float32Array {
  const leadFrames = Math.round(leadSec * sampleRate);
  const toneFrames = Math.round(toneSec * sampleRate);
  const tailFrames = Math.round(tailSec * sampleRate);
  const total = leadFrames + toneFrames + tailFrames;
  const out = new Float32Array(total);
  let seed = 1337;
  for (let i = 0; i < total; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const white = ((seed / 0x7fffffff) * 2 - 1) * noiseAmp;
    const hum = hum50Amp * Math.sin((2 * Math.PI * 50 * i) / sampleRate);
    let sig = white + hum;
    if (i >= leadFrames && i < leadFrames + toneFrames) {
      sig += toneAmp * Math.sin((2 * Math.PI * freqHz * (i - leadFrames)) / sampleRate);
    }
    out[i] = sig;
  }
  return out;
}

async function runPhase34Tests(): Promise<void> {
  console.log('=== PHASE 34: AUDIO RECORDER, SILENCE TRIM, NOISE PRINT & AI ENHANCE TESTS ===');

  const sr = 48000;

  // 1. RecordingEngine ballistic meter decay & autoClassify
  {
    const engine = new RecordingEngine(makeFakeSource(sr, 2), {
      trimSilence: false,
      attachNoiseProfile: true,
      autoClassify: true,
    });
    await engine.beginMonitoring();

    const loudBlock = new Float32Array(480).fill(0.6);
    engine.pushSamples([loudBlock, loudBlock]);
    assert(Math.abs(engine.getLevels().peakLeft - 0.6) < 0.01, '1. Meter hits 0.6 on loud block');

    // Feed silent blocks: meter must decay rather than staying stuck at 0.6 forever
    for (let k = 0; k < 5; k++) {
      engine.pushSamples([new Float32Array(480), new Float32Array(480)]);
    }
    assert(
      engine.getLevels().peakLeft < 0.3,
      `1. Meter decays on silence (got ${engine.getLevels().peakLeft.toFixed(3)})`
    );

    // Record a tonal take and verify autoClassify classifies it as 'chromatic'
    engine.startRecording();
    const tonal = makeSineWithLeadAndNoise(sr, 0.25, 0.6, 0.25, 220, 0.45, 0.002, 0);
    engine.pushSamples([tonal, tonal]);
    const take = engine.stopRecording();

    assert(take.classification === 'chromatic', `1. Expected auto-classification 'chromatic', got '${take.classification}'`);
    assert(take.classificationConfidence > 0.5, '1. Classification confidence > 50%');
    assert(take.noiseProfile !== undefined, '1. Noise profile attached from silent room-tone segment');
    console.log('  [OK] 1. RecordingEngine live meter decay and automatic acoustic take classification verified');
  }

  // 2. AudioRecorderModal workflow: Noise Print selection, Silence Trim, DSP Denoise, Normalize & Undo
  {
    let sentToChopper: { bytes: number; name: string } | null = null;
    let injectedToSession: { bytes: number; name: string } | null = null;

    const recorder = new AudioRecorderModal({
      onSendToChopper: (wav, name) => {
        sentToChopper = { bytes: wav.byteLength, name };
      },
      onInjectTakeIntoSession: (wav, name) => {
        injectedToSession = { bytes: wav.byteLength, name };
      },
    });

    const composite = makeSineWithLeadAndNoise(sr, 0.3, 0.5, 0.3, 440, 0.4, 0.004, 0.015);
    const rawTake = {
      durationSec: composite.length / sr,
      sampleRate: sr,
      channels: 1,
      peakDbfs: 20 * Math.log10(peakAmplitude(composite)),
      classification: 'unknown' as const,
      classificationConfidence: 0,
      samples: [composite],
      wav: encodeWav16([composite], sr),
    };

    const sessionTake = recorder.addExternalTake(rawTake, 'Synth Bass Take');
    assert(recorder.getTakes().length === 1, '2. Take added to recorder session list');
    assert(
      sessionTake.take.classification === 'chromatic',
      `2. External take auto-classified as 'chromatic' (got ${sessionTake.take.classification})`
    );

    // Select custom Noise Print region in the first 250ms (frames 0..12000)
    sessionTake.selectionStartFrame = 0;
    sessionTake.selectionEndFrame = Math.round(0.25 * sr);
    const capturedProfile = recorder.captureNoisePrintFromSelection(sessionTake.id);
    assert(capturedProfile !== null, '2. Noise Print captured from selected region');
    assert(
      capturedProfile!.hum50HzDb > capturedProfile!.hum60HzDb + 15,
      `2. Captured Noise Print detects 50 Hz hum component over 60 Hz (${capturedProfile!.hum50HzDb.toFixed(1)} vs ${capturedProfile!.hum60HzDb.toFixed(1)} dB)`
    );

    // Apply DSP Denoise using the selected Noise Print
    const beforeLeadRms = rmsDbfs(sessionTake.take.samples[0].subarray(2000, 10000));
    const denoisedOk = recorder.applyDspDenoiseToTake(sessionTake.id);
    assert(denoisedOk, '2. applyDspDenoiseToTake succeeded');
    const afterLeadRms = rmsDbfs(sessionTake.take.samples[0].subarray(2000, 10000));
    assert(
      afterLeadRms < beforeLeadRms - 4,
      `2. Noise region attenuated after DSP Denoise (before=${beforeLeadRms.toFixed(1)} dB, after=${afterLeadRms.toFixed(1)} dB)`
    );
    assert(sessionTake.history.length === 1, '2. Undo snapshot stored before DSP Denoise');

    // Trim leading & trailing silence
    const durBeforeTrim = sessionTake.take.durationSec;
    const trimOk = recorder.applyTrimSilenceToTake(sessionTake.id);
    assert(trimOk, '2. applyTrimSilenceToTake succeeded');
    assert(
      sessionTake.take.durationSec < durBeforeTrim - 0.4,
      `2. Leading and trailing silence trimmed (${durBeforeTrim.toFixed(2)}s -> ${sessionTake.take.durationSec.toFixed(2)}s)`
    );
    assert(sessionTake.history.length === 2, '2. Undo snapshot stored before Trim Silence');

    // Normalize Peak (-1 dBFS) + DC Block
    const normOk = recorder.applyNormalizeAndDcBlockToTake('peak', sessionTake.id);
    assert(normOk, '2. applyNormalizeAndDcBlockToTake succeeded');
    assert(
      Math.abs(sessionTake.take.peakDbfs - -1.0) < 0.15,
      `2. Peak normalized to -1.0 dBFS (got ${sessionTake.take.peakDbfs.toFixed(2)} dBFS)`
    );

    // Undo restores previous state
    const undoOk = recorder.undoTakeEdit(sessionTake.id);
    assert(undoOk, '2. undoTakeEdit succeeded');
    assert(sessionTake.history.length === 2, '2. History popped after Undo');

    // AI Enhance (uses Companion Bridge if online or local DSP fallback if offline)
    const aiOk = await recorder.applyAiEnhanceToTake(sessionTake.id);
    assert(aiOk, '2. applyAiEnhanceToTake succeeded with Noise Print');
    assert(sessionTake.take.wav.byteLength > 44, '2. Enhanced WAV valid');

    console.log('  [OK] 2. AudioRecorderModal region Noise Print, DSP Denoise, Silence Trim, Normalize, AI Enhance & Undo verified');
    void sentToChopper;
    void injectedToSession;
  }

  console.log('=== ALL PHASE 34 TESTS PASSED ===');
}

runPhase34Tests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
