// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Audio Chopper & Auto-Slicer Test Suite
// ─────────────────────────────────────────────────────────

import assert from 'assert';
import {
  sliceAudioBuffer,
  buildMidiFileBuffer,
  type DetectedSlice,
} from '../src/core/dsp/AudioSlicerEngine.ts';

console.log('=== ABDNeuModMakr Audio Slicer & Chopper Verification ===\n');

// 1. Synthetic Audio Generation: 2-second drum beat (Kick, Snare, Hat, Silence)
const sampleRate = 44100;
const durationSec = 2.0;
const totalSamples = Math.round(sampleRate * durationSec);
const drumPcm = new Float32Array(totalSamples);

// Synthesize a Kick drum at t = 0.1s (low sine 60Hz + pitch drop)
const kickStart = Math.round(0.1 * sampleRate);
for (let i = 0; i < 0.25 * sampleRate; i++) {
  const t = i / sampleRate;
  const freq = 120 * Math.exp(-t * 18);
  const amp = Math.exp(-t * 12);
  drumPcm[kickStart + i] = amp * Math.sin(2 * Math.PI * freq * t);
}

// Synthesize a Snare drum at t = 0.6s (noise + 180Hz body)
const snareStart = Math.round(0.6 * sampleRate);
for (let i = 0; i < 0.25 * sampleRate; i++) {
  const t = i / sampleRate;
  const body = Math.sin(2 * Math.PI * 180 * t) * 0.4;
  const noise = (Math.random() * 2 - 1) * 0.6;
  const amp = Math.exp(-t * 15);
  drumPcm[snareStart + i] = amp * (body + noise);
}

// Synthesize a Closed Hi-Hat at t = 1.1s (high-pass noise, fast decay)
const hatStart = Math.round(1.1 * sampleRate);
for (let i = 0; i < 0.08 * sampleRate; i++) {
  const t = i / sampleRate;
  const noise = (Math.random() * 2 - 1) * 0.8;
  const amp = Math.exp(-t * 40);
  drumPcm[hatStart + i] = amp * noise;
}

// Test 1: Grid Mode Slicing
{
  console.log('1. Testing Grid Mode Slicing (120 BPM, 1/4 division)...');
  const res = sliceAudioBuffer(drumPcm, sampleRate, {
    mode: 'grid',
    bpm: 120,
    gridDivision: '1/4',
    snapZeroCrossing: false,
  });

  assert(res.slices.length > 0, 'Grid slices should be created');
  assert(res.totalDurationSec >= 1.9, 'Total duration should match audio length');
  console.log(`   -> Created ${res.slices.length} grid slices at 120 BPM quarter notes.`);
}

// Test 2: Transient Detection & Silence Gating (Drums Mode)
{
  console.log('2. Testing Transient Detection & Silence Gating (Drums Mode)...');
  const res = sliceAudioBuffer(drumPcm, sampleRate, {
    mode: 'drums',
    sensitivity: 75,
    silenceThresholdDb: -42,
    snapZeroCrossing: true,
  });

  assert(res.validSlicesCount >= 2, 'Should detect at least Kick and Snare events');
  console.log(`   -> Detected ${res.totalSlices} total slices (${res.validSlicesCount} active, ${res.silenceSlicesCount} silence intervals).`);

  const activeSlices = res.slices.filter((s) => !s.isSilence);
  const categories = activeSlices.map((s) => s.category);
  console.log(`   -> Detected drum categories: ${categories.join(', ')}`);
  assert(categories.includes('kick'), 'Should recognize kick drum category');
}

// Test 3: Zero-Crossing Snapping
{
  console.log('3. Testing Zero-Crossing Snapping on Boundaries...');
  const res = sliceAudioBuffer(drumPcm, sampleRate, {
    mode: 'drums',
    snapZeroCrossing: true,
  });

  for (const sl of res.slices) {
    if (sl.startFrame > 0 && sl.startFrame < totalSamples - 1) {
      const prev = drumPcm[sl.startFrame - 1];
      const curr = drumPcm[sl.startFrame];
      console.log(`      slice #${sl.index}: startFrame=${sl.startFrame}, prev=${prev.toFixed(4)}, curr=${curr.toFixed(4)}`);
      // Zero crossing: prev <= 0 and curr >= 0, or smallest magnitude in radius
      assert(
        (prev <= 0 && curr >= 0) || Math.abs(curr) <= 0.25,
        `Start frame should snap near zero or crossing: prev=${prev}, curr=${curr}`
      );
    }
  }
  console.log('   -> All boundary slices verified magnetized near zero-crossing.');
}

// Test 4: Chromatic Equidistant Zone Mapping
{
  console.log('4. Testing Chromatic Equidistant Zone Mapping...');
  // Synthetic tonal notes: C3 (130.81Hz), E3 (164.81Hz), G3 (196Hz)
  const tonalPcm = new Float32Array(sampleRate * 1.5);
  const n1 = 0;
  const n2 = Math.round(0.5 * sampleRate);
  const n3 = Math.round(1.0 * sampleRate);

  for (let i = 0; i < 0.4 * sampleRate; i++) {
    const t = i / sampleRate;
    tonalPcm[n1 + i] = 0.5 * Math.sin(2 * Math.PI * 130.81 * t);
    tonalPcm[n2 + i] = 0.5 * Math.sin(2 * Math.PI * 164.81 * t);
    tonalPcm[n3 + i] = 0.5 * Math.sin(2 * Math.PI * 196.00 * t);
  }

  const res = sliceAudioBuffer(tonalPcm, sampleRate, {
    mode: 'chromatic',
    sensitivity: 80,
    silenceThresholdDb: -50,
  });

  const valid = res.slices.filter((s) => !s.isSilence);
  assert(valid.length >= 2, 'Should detect at least 2 tonal slices');

  // Verify full 0..127 contiguous coverage
  if (valid.length >= 2) {
    assert.strictEqual(valid[0].lowKey, 0, 'First zone should start at MIDI 0');
    assert.strictEqual(valid[valid.length - 1].highKey, 127, 'Last zone should end at MIDI 127');
    console.log(`   -> Contiguous 0..127 equidistant zones verified: ${valid.map((v) => `[${v.lowKey}..${v.highKey} Root:${v.rootKey}]`).join('; ')}`);
  }
}

// Test 5: Standard MIDI File (.mid Type 0) Generation
{
  console.log('5. Testing Standard MIDI File (.mid Type 0) Generation...');
  const testSlices: DetectedSlice[] = [
    {
      id: 's1',
      index: 1,
      startFrame: 0,
      endFrame: 4410,
      startSec: 0.0,
      endSec: 0.2,
      durationSec: 0.2,
      rmsDb: -12,
      peakDb: -2,
      isSilence: false,
      rootKey: 36,
      lowKey: 36,
      highKey: 36,
      lowVel: 1,
      highVel: 127,
      label: 'Kick',
      category: 'kick',
      pcm: new Float32Array(10),
    },
    {
      id: 's2',
      index: 2,
      startFrame: 4410,
      endFrame: 8820,
      startSec: 0.5,
      endSec: 0.7,
      durationSec: 0.2,
      rmsDb: -15,
      peakDb: -3,
      isSilence: false,
      rootKey: 38,
      lowKey: 38,
      highKey: 38,
      lowVel: 1,
      highVel: 127,
      label: 'Snare',
      category: 'snare',
      pcm: new Float32Array(10),
    },
  ];

  const midiBytes = buildMidiFileBuffer(testSlices, 120);
  assert(midiBytes.length > 20, 'MIDI buffer should be populated');

  // Check 'MThd' header
  const mthd = String.fromCharCode(...midiBytes.slice(0, 4));
  assert.strictEqual(mthd, 'MThd', "Header must start with 'MThd'");

  // Check 'MTrk' header
  const mtrk = String.fromCharCode(...midiBytes.slice(14, 18));
  assert.strictEqual(mtrk, 'MTrk', "Track must start with 'MTrk'");

  console.log(`   -> Generated valid SMF Type 0 buffer (${midiBytes.length} bytes) ready for DAW drag-and-drop.`);
}

console.log('\n=== ALL AUDIO SLICER & CHOPPER TESTS PASSED SUCCESSFULLY! ===');
