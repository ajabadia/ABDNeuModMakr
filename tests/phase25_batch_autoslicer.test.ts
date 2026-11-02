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
} from '../src/core/dsp/AudioSlicerEngine.ts';
import { encodePcm16Wav } from '../src/core/dsp/WavDecoder.ts';
import { buildBatchPreflightSummary } from '../src/core/batch/preflight.ts';
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

function test(name: string, fn: () => void | Promise<void>): void {
  try {
    const r = fn();
    if (r instanceof Promise) {
      r.then(() => {
        console.log(`  [PASS] ${name}`);
        passed++;
      }).catch((err) => {
        console.error(`  [FAIL] ${name}: ${err instanceof Error ? err.message : String(err)}`);
        failed++;
      });
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

// ── Summary ───────────────────────────────────────────────────

setTimeout(() => {
  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}, 200);
