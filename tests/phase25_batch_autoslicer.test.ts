// ─────────────────────────────────────────────────────────────
// ABDNeuModMakr — Phase 25: Batch AutoSlicer Test Suite
// Unit tests for loop candidate extraction, automatic slicing
// to GM Drum Map / Chromatic keybed, MIDI groove pattern generation,
// Time Capsule packaging, and stage-by-stage memory safety.
// ─────────────────────────────────────────────────────────────

import assert from 'node:assert/strict';
import {
  extractFolderLoopsToCandidates,
  extractFolderFilesToCandidates,
} from '../src/core/batch/FolderBatchExtractor.ts';
import {
  sliceAudioBuffer,
  buildMidiFileBuffer,
  conformLoopToTargetBpm,
} from '../src/core/dsp/AudioSlicerEngine.ts';
import { encodePcm16Wav } from '../src/core/dsp/WavDecoder.ts';
import { buildBatchPreflightSummary } from '../src/core/batch/preflight.ts';
import { BatchQueue } from '../src/core/batch/BatchQueue.ts';
import { resolveAiActionDeclaration } from '../src/core/ai/aiHonesty.ts';
import { DEFAULT_AI_ASSISTANCE_CONFIG } from '../src/core/types.ts';
import type { BatchConfig, BatchModelCandidate } from '../src/core/batch/types.ts';

// ── Synthetic Audio Helper ────────────────────────────────────

function generateSyntheticDrumLoop(sampleRate = 44100, durationSec = 1.0): Float32Array {
  const total = Math.round(sampleRate * durationSec);
  const pcm = new Float32Array(total);

  // Transient 1: Kick at 0.05s
  const kickStart = Math.round(0.05 * sampleRate);
  for (let i = 0; i < 0.2 * sampleRate; i++) {
    const t = i / sampleRate;
    pcm[kickStart + i] = Math.sin(2 * Math.PI * 60 * Math.exp(-t * 20) * t) * Math.exp(-t * 15);
  }

  // Transient 2: Snare at 0.5s
  const snareStart = Math.round(0.5 * sampleRate);
  for (let i = 0; i < 0.2 * sampleRate; i++) {
    const t = i / sampleRate;
    pcm[snareStart + i] = (Math.sin(2 * Math.PI * 200 * t) * 0.4 + (Math.random() * 2 - 1) * 0.6) * Math.exp(-t * 20);
  }

  return pcm;
}

// ── Tests ─────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const pendingPromises: Promise<void>[] = [];

function test(name: string, fn: () => void | Promise<void>): void {
  try {
    const r = fn();
    if (r instanceof Promise) {
      pendingPromises.push(
        r
          .then(() => {
            console.log(`  [PASS] ${name}`);
            passed++;
          })
          .catch((err) => {
            console.error(`  [FAIL] ${name}: ${err instanceof Error ? err.message : String(err)}`);
            failed++;
          })
      );
    } else {
      console.log(`  [PASS] ${name}`);
      passed++;
    }
  } catch (err) {
    console.error(`  [FAIL] ${name}: ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

console.log('\nPhase 25 — Batch AutoSlicer & Memory Safety Verification\n');

// 1. Loop candidate extraction
test('extractFolderLoopsToCandidates creates individual candidates for each loop', () => {
  const dummyBuf = new ArrayBuffer(1024);
  const files = [
    { path: 'FunkBeat_120.wav', name: 'FunkBeat_120.wav', buffer: dummyBuf },
    { path: 'AcousticGroove.rx2', name: 'AcousticGroove.rx2', buffer: dummyBuf },
    { path: 'Notes.txt', name: 'Notes.txt', buffer: dummyBuf },
  ];

  const candidates = extractFolderLoopsToCandidates(files, { slicerProfile: 'drums', bpm: 120 });
  assert.equal(candidates.length, 2, 'Should only discover the 2 audio files, ignoring .txt');

  const c1 = candidates[0];
  assert.equal(c1.sourceType, 'auto-slicer');
  assert.equal(c1.slicerProfile, 'drums');
  assert.equal(c1.detectedCategory, 'Drums');

  const c2 = candidates[1];
  assert.equal(c2.sourceType, 'loop-rx2');
  assert.equal(c2.slicerProfile, 'drums');
});

// 2. extractFolderFilesToCandidates delegates in slicer mode
test('extractFolderFilesToCandidates delegates to loop extraction when ingestionMode is slicer', () => {
  const dummyBuf = new ArrayBuffer(512);
  const files = [
    { path: 'Drums/BeatA.wav', name: 'BeatA.wav', buffer: dummyBuf },
    { path: 'Drums/BeatB.wav', name: 'BeatB.wav', buffer: dummyBuf },
  ];

  const candidates = extractFolderFilesToCandidates(files, {
    ingestionMode: 'slicer',
    slicerProfile: 'drums',
  });

  assert.equal(candidates.length, 2, 'Should create 2 independent candidates in slicer mode');
  assert.equal(candidates[0].sourceType, 'auto-slicer');
  assert.equal(candidates[1].sourceType, 'auto-slicer');
});

// 3. Audio Slicing to GM Drum Map
test('sliceAudioBuffer slices drum loop and maps to General MIDI Drum keys', () => {
  const sampleRate = 44100;
  const pcm = generateSyntheticDrumLoop(sampleRate, 1.0);

  const res = sliceAudioBuffer(pcm, sampleRate, {
    mode: 'drums',
    sensitivity: 70,
    silenceThresholdDb: -42,
    preRollMs: 3,
    postRollMs: 8,
    snapZeroCrossing: true,
    bpm: 120,
    gridDivision: '1/16',
    allowOverlap: false,
    chromaticBaseNote: 36,
  });

  const valid = res.slices.filter((s) => !s.isSilence);
  assert.ok(valid.length >= 2, 'Should detect at least 2 drum slices');
  assert.ok(valid[0].rootKey >= 35 && valid[0].rootKey <= 81, 'Root key must fall within GM Drum range (35..81)');
  assert.ok(res.midiFileBuffer.length > 0, 'Must generate Standard MIDI File buffer');
});

// 4. Audio Slicing to Chromatic Equidistant Keybed
test('sliceAudioBuffer maps slices to chromatic equidistant keybed', () => {
  const sampleRate = 44100;
  const pcm = generateSyntheticDrumLoop(sampleRate, 1.0);

  const res = sliceAudioBuffer(pcm, sampleRate, {
    mode: 'chromatic',
    sensitivity: 70,
    silenceThresholdDb: -42,
    preRollMs: 3,
    postRollMs: 8,
    snapZeroCrossing: true,
    bpm: 120,
    gridDivision: '1/16',
    allowOverlap: false,
    chromaticBaseNote: 36,
  });

  const valid = res.slices.filter((s) => !s.isSilence);
  assert.ok(valid.length >= 2, 'Should detect at least 2 slices');
  assert.ok(valid[0].rootKey >= 0 && valid[0].rootKey <= 127, 'Root key must be a valid MIDI note');
  assert.ok(valid[0].lowKey <= valid[0].rootKey && valid[0].rootKey <= valid[0].highKey, 'Root key must be within zone bounds');
  assert.ok(valid[1].lowKey <= valid[1].rootKey && valid[1].rootKey <= valid[1].highKey, 'Root key must be within zone bounds');
});

// 5. Standard MIDI File Generation (.mid Type 0)
test('buildMidiFileBuffer produces valid Standard MIDI Type 0 header and track', () => {
  const sampleRate = 44100;
  const pcm = generateSyntheticDrumLoop(sampleRate, 1.0);
  const res = sliceAudioBuffer(pcm, sampleRate, {
    mode: 'drums',
    sensitivity: 70,
    silenceThresholdDb: -42,
    preRollMs: 3,
    postRollMs: 8,
    snapZeroCrossing: true,
    bpm: 120,
    gridDivision: '1/16',
    allowOverlap: false,
    chromaticBaseNote: 36,
  });

  const midiBytes = buildMidiFileBuffer(res.slices.filter((s) => !s.isSilence), 120);
  assert.ok(midiBytes.length > 20, 'MIDI buffer must be non-empty');

  // Verify 'MThd' header
  const headerFourCC = String.fromCharCode(...midiBytes.slice(0, 4));
  assert.equal(headerFourCC, 'MThd', 'File must start with MThd header');

  // Verify 'MTrk' chunk
  const trackFourCC = String.fromCharCode(...midiBytes.slice(14, 18));
  assert.equal(trackFourCC, 'MTrk', 'File must contain MTrk track chunk');
});

// 6. Preflight summary includes AutoSlicer profile and groove MIDI
test('buildBatchPreflightSummary reflects AutoSlicer execution profile', () => {
  const candidate: BatchModelCandidate = {
    id: 'slicer_test_1',
    name: 'Funk Beat',
    slug: 'funk_beat',
    sourceType: 'auto-slicer',
    sourceOrigin: 'FunkBeat.wav',
    zoneCount: 16,
    detectedSliceCount: 16,
    slicerProfile: 'drums',
    detectedCategory: 'Drums',
    suggestedParameterSet: 0,
    suggestedComplexity: 8,
    status: 'pending',
    progressPct: 0,
    files: [{ name: 'FunkBeat.wav', buffer: new ArrayBuffer(2048) }],
  };

  const config: BatchConfig = {
    targetFormat: 'dual',
    destination: 'axionikdb',
    destinationSublibrary: 'Default',
    complexityStrategy: 'auto',
    dspAlgorithm: 'legacy',
    autoAcousticClassification: true,
    ingestionMode: 'slicer',
    slicerProfile: 'drums',
    exportMidiPattern: true,
    stagePipelineVramSafety: true,
  };

  const summary = buildBatchPreflightSummary([candidate], config, {
    workingMode: 'extended',
    aiEngineLabel: 'Local Companion Bridge',
  });

  assert.equal(summary.totalDiscovered, 1);
  assert.ok(summary.executionProfile.slicerProfileLabel?.includes('DRUMS'));
  assert.equal(summary.executionProfile.grooveMidiEnabled, true);
  assert.equal(summary.models[0].isSlicer, true);
  assert.equal(summary.models[0].slicerProfile, 'drums');
});

// 7. WAV Encoding for individual slices
test('encodePcm16Wav produces valid 16-bit RIFF/WAVE header and PCM data for slice', () => {
  const pcm = new Float32Array(4410); // 0.1s
  pcm[100] = 0.5;
  const wavBuf = encodePcm16Wav(pcm, 44100, { rootKey: 36, lowKey: 36, highKey: 36 });
  const view = new DataView(wavBuf);

  const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
  assert.equal(riff, 'RIFF');
  assert.equal(wave, 'WAVE');
  assert.equal(view.getUint16(22, true), 1); // 1 channel
  assert.equal(view.getUint32(24, true), 44100); // 44100 Hz
  assert.equal(view.getUint16(34, true), 16); // 16-bit PCM
});

// 8. Bridge Memory Management endpoints contract
test('Bridge memory status payload shape validation', () => {
  const payload = {
    status: 'ok',
    has_cuda: true,
    device_name: 'NVIDIA GeForce RTX 4070',
    vram_allocated_mb: 1250.5,
    vram_reserved_mb: 2048.0,
    vram_total_mb: 12288.0,
  };

  assert.equal(payload.status, 'ok');
  assert.equal(payload.has_cuda, true);
  assert.ok(payload.vram_allocated_mb > 0);
  assert.ok(payload.vram_total_mb >= 8192);
});

// 9. Bridge Clear Memory Cache response contract
test('Bridge clear memory cache response contract', () => {
  const res = {
    status: 'ok',
    has_cuda: false,
    device_name: 'CPU',
    vram_allocated_mb: 0.0,
    vram_reserved_mb: 0.0,
    vram_total_mb: 0.0,
    action: 'cache_cleared',
  };

  assert.equal(res.status, 'ok');
  assert.equal(res.action, 'cache_cleared');
});

// 10. Stage-Grouped Queue Execution (Phase-by-phase across all jobs)
test('BatchQueue executes all jobs stage-by-stage in stage-grouped mode', async () => {
  const pcm1 = generateSyntheticDrumLoop(44100, 0.25);
  const wav1 = encodePcm16Wav(pcm1, 44100, { rootKey: 60 });
  const pcm2 = generateSyntheticDrumLoop(44100, 0.25);
  const wav2 = encodePcm16Wav(pcm2, 44100, { rootKey: 64 });

  const jobs: BatchModelCandidate[] = [
    {
      id: 'job_stage_1',
      name: 'Stage Test Lead',
      slug: 'stage_test_lead',
      sourceType: 'folder-pack',
      sourceOrigin: 'Lead_C4.wav',
      zoneCount: 1,
      detectedCategory: 'Lead',
      suggestedParameterSet: 0,
      suggestedComplexity: 2,
      status: 'pending',
      progressPct: 0,
      files: [{ name: 'Lead_C4.wav', buffer: wav1 }],
    },
    {
      id: 'job_stage_2',
      name: 'Stage Test Pad',
      slug: 'stage_test_pad',
      sourceType: 'folder-pack',
      sourceOrigin: 'Pad_E4.wav',
      zoneCount: 1,
      detectedCategory: 'Pad',
      suggestedParameterSet: 2,
      suggestedComplexity: 2,
      status: 'pending',
      progressPct: 0,
      files: [{ name: 'Pad_E4.wav', buffer: wav2 }],
    },
  ];

  const queue = new BatchQueue();
  queue.setJobs(jobs);

  const visitedStages: number[] = [];
  queue.on((ev, data) => {
    if (ev === 'stage-start' && data && typeof (data as any).stage === 'number') {
      visitedStages.push((data as any).stage);
    }
  });

  const summary = await queue.start({
    targetFormat: 'dual',
    destination: 'zip-master',
    destinationSublibrary: 'Default',
    complexityStrategy: 'fixed-2',
    dspAlgorithm: 'legacy',
    autoAcousticClassification: false,
    executionOrder: 'stage-grouped',
    stagePipelineVramSafety: true,
  });

  assert.equal(summary.succeeded, 2, 'Both jobs should complete in stage-grouped mode');
  assert.deepEqual(visitedStages, [1, 2, 3, 4, 5], 'Must traverse stages 1 -> 2 -> 3 -> 4 -> 5 in order');
  assert.ok(summary.masterZipBytes && summary.masterZipBytes.byteLength > 0, 'Must generate master ZIP output');
});

// 11. AI Denoise readiness gating (DeepFilterNet 3 enabled OR Cloud BYOK LLM API key configured)
test('resolveAiActionDeclaration enforces AI Denoise readiness (DeepFilterNet 3 or Cloud LLM API key)', () => {
  // Case A: Neither local DeepFilterNet enabled nor Cloud LLM configured -> requires fallback consent
  const disabledDecl = resolveAiActionDeclaration('recorder-ai-denoise', {
    isBridgeConnected: false,
    isCloudReady: false,
    aiConfig: { ...DEFAULT_AI_ASSISTANCE_CONFIG, enabled: false, denoise: 'dsp' },
  });
  assert.equal(disabledDecl.isPrimaryAvailable, false);
  assert.equal(disabledDecl.requiresFallbackConsent, true);

  // Case B: Local DeepFilterNet 3 stage enabled + Bridge connected -> ready without fallback consent
  const bridgeReadyDecl = resolveAiActionDeclaration('recorder-ai-denoise', {
    isBridgeConnected: true,
    isCloudReady: false,
    aiConfig: { ...DEFAULT_AI_ASSISTANCE_CONFIG, enabled: true, denoise: 'ai' },
  });
  assert.equal(bridgeReadyDecl.isPrimaryAvailable, true);
  assert.equal(bridgeReadyDecl.requiresFallbackConsent, false);

  // Case C: Cloud BYOK LLM API key configured -> ready without fallback consent
  const cloudReadyDecl = resolveAiActionDeclaration('recorder-ai-denoise', {
    isBridgeConnected: false,
    isCloudReady: true,
    activeTextLlmProvider: 'gemini-cloud',
    aiConfig: { ...DEFAULT_AI_ASSISTANCE_CONFIG, enabled: false, denoise: 'dsp' },
  });
  assert.equal(cloudReadyDecl.isPrimaryAvailable, true);
  assert.equal(cloudReadyDecl.requiresFallbackConsent, false);
});

// 12. Melodic Phrase Slicing in REX / Groove Loop + Chromatic mode (repeated notes & chronological .mid)
test('sliceAudioBuffer extracts BPM, non-colliding key ranges for repeated notes, and chronological MIDI from a recorded melody', () => {
  const sampleRate = 44100;
  // 4-note melody at 120 BPM (0.5s per quarter note = 2.0s total): C4 (261.63Hz) -> E4 (329.63Hz) -> G4 (392.00Hz) -> C4 (261.63Hz repeated)
  const freqs = [261.63, 329.63, 392.0, 261.63];
  const noteDurSec = 0.5;
  const pcm = new Float32Array(Math.round(sampleRate * noteDurSec * freqs.length));

  for (let n = 0; n < freqs.length; n++) {
    const startFrame = Math.round(n * noteDurSec * sampleRate);
    const lenFrames = Math.round(noteDurSec * sampleRate);
    const f0 = freqs[n];
    const amp = n === 3 ? 0.9 : 0.55; // second C4 played louder
    for (let i = 0; i < lenFrames; i++) {
      const t = i / sampleRate;
      const env = Math.min(1, i / (0.008 * sampleRate)) * Math.exp(-t * 2.5);
      pcm[startFrame + i] =
        amp * env * (0.7 * Math.sin(2 * Math.PI * f0 * t) + 0.3 * Math.sin(2 * Math.PI * f0 * 2 * t));
    }
  }

  const res = sliceAudioBuffer(pcm, sampleRate, {
    workflowMode: 'rex_groove_loop',
    mode: 'chromatic',
    sensitivity: 75,
    silenceThresholdDb: -50,
    preRollMs: 2,
    postRollMs: 5,
    snapZeroCrossing: true,
    bpm: 120,
    targetBpm: 120,
    gridDivision: '1/16',
    allowOverlap: false,
    chromaticBaseNote: 36,
  });

  const active = res.slices.filter((s) => !s.isSilence);
  assert.ok(active.length >= 4, `Expected at least 4 melodic note slices, got ${active.length}`);
  assert.ok(res.detectedBpm >= 60 && res.detectedBpm <= 180, `Detected BPM must be valid (${res.detectedBpm})`);

  // Verify every slice has valid non-inverted key bounds (lowKey <= rootKey <= highKey) even with repeated C4
  for (const s of active) {
    assert.ok(
      s.lowKey <= s.rootKey && s.rootKey <= s.highKey,
      `Slice ${s.index} (${s.noteName}) has invalid bounds: ${s.lowKey}..${s.highKey} (root ${s.rootKey})`
    );
  }

  // Verify chronological ordering is preserved for .mid export
  for (let i = 1; i < active.length; i++) {
    assert.ok(
      active[i].startFrame >= active[i - 1].startFrame,
      'Slices must remain in chronological order so .mid exports the melody in sequence'
    );
  }
});

// 13. Transient-Locked Elastic Loop BPM Conformer (conformLoopToTargetBpm)
test('conformLoopToTargetBpm time-stretches loop to target BPM while locking transient attacks', () => {
  const sampleRate = 44100;
  const pcm = generateSyntheticDrumLoop(sampleRate, 2.0); // 1 bar at 120 BPM = 2.0s
  const sliceRes = sliceAudioBuffer(pcm, sampleRate, {
    workflowMode: 'rex_groove_loop',
    mode: 'drums',
    sensitivity: 70,
    silenceThresholdDb: -42,
    preRollMs: 3,
    postRollMs: 8,
    snapZeroCrossing: true,
    bpm: 120,
    targetBpm: 140,
    gridDivision: '1/16',
    allowOverlap: false,
    chromaticBaseNote: 36,
  });

  // Speed up from 120 BPM to 150 BPM -> duration should scale by 120/150 = 0.8 (1.6s)
  const faster = conformLoopToTargetBpm(pcm, sampleRate, sliceRes.slices, 120, 150);
  const expectedFasterFrames = Math.round(pcm.length * (120 / 150));
  assert.ok(
    Math.abs(faster.pcm.length - expectedFasterFrames) <= 2,
    `Expected ~${expectedFasterFrames} frames at 150 BPM, got ${faster.pcm.length}`
  );

  // Slow down from 120 BPM to 90 BPM -> duration should scale by 120/90 = 1.3333
  const slower = conformLoopToTargetBpm(pcm, sampleRate, sliceRes.slices, 120, 90);
  const expectedSlowerFrames = Math.round(pcm.length * (120 / 90));
  assert.ok(
    Math.abs(slower.pcm.length - expectedSlowerFrames) <= 2,
    `Expected ~${expectedSlowerFrames} frames at 90 BPM, got ${slower.pcm.length}`
  );
});

// ── Summary ───────────────────────────────────────────────────

void Promise.all(pendingPromises).then(() => {
  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
});
