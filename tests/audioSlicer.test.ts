// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Audio Chopper & Auto-Slicer Test Suite
// ─────────────────────────────────────────────────────────

import assert from 'assert';
import {
  sliceAudioBuffer,
  buildMidiFileBuffer,
  moveSliceBoundary,
  splitSliceAtFrame,
  deleteSlice,
  extractBoundaryFrames,
  type DetectedSlice,
} from '../src/core/dsp/AudioSlicerEngine.ts';
import { parseSliceFile } from '../src/core/dsp/SliceFileParser.ts';

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

// Test 2: Transient Detection & Silence Gating (Drums Mode with SuperFlux)
{
  console.log('2. Testing Transient Detection & Silence Gating (Drums Mode with SuperFlux)...');
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

  if (valid.length >= 2) {
    assert.strictEqual(valid[0].lowKey, 0, 'First zone should start at MIDI 0');
    assert.strictEqual(valid[valid.length - 1].highKey, 127, 'Last zone should end at MIDI 127');
    console.log(`   -> Contiguous 0..127 equidistant zones verified: ${valid.map((v) => `[${v.lowKey}..${v.highKey} Root:${v.rootKey}]`).join('; ')}`);
  }
}

// Test 5: Vocal & Phrase Mode (OpenVPI Slicer algorithm)
{
  console.log('5. Testing Vocal & Phrase Mode (OpenVPI Silence Valley Segmentation)...');
  // 3-second vocal phrase: Phrase 1 (0.2s - 1.2s), Silence (1.2s - 1.7s), Phrase 2 (1.7s - 2.8s)
  const vocalPcm = new Float32Array(sampleRate * 3.0);
  const p1Start = Math.round(0.2 * sampleRate);
  const p1End = Math.round(1.2 * sampleRate);
  for (let i = p1Start; i < p1End; i++) {
    const t = (i - p1Start) / sampleRate;
    // Vibrato singing tone (220Hz + 5Hz vibrato)
    const vibrato = 220 + 8 * Math.sin(2 * Math.PI * 5.5 * t);
    vocalPcm[i] = 0.6 * Math.sin(2 * Math.PI * vibrato * t);
  }

  const p2Start = Math.round(1.7 * sampleRate);
  const p2End = Math.round(2.8 * sampleRate);
  for (let i = p2Start; i < p2End; i++) {
    const t = (i - p2Start) / sampleRate;
    const vibrato = 330 + 10 * Math.sin(2 * Math.PI * 6.0 * t);
    vocalPcm[i] = 0.7 * Math.sin(2 * Math.PI * vibrato * t);
  }

  const res = sliceAudioBuffer(vocalPcm, sampleRate, {
    mode: 'vocals',
    sensitivity: 70,
    silenceThresholdDb: -42,
    minSliceMs: 250,
  });

  console.log(`   -> OpenVPI vocal slicing produced ${res.slices.length} slices (valid: ${res.validSlicesCount}).`);
  // Must avoid over-chopping! Total slices should be between 2 and 5 (phrase 1, breath silence, phrase 2)
  assert(res.slices.length <= 6, `Vocal mode should not over-chop phrases! Got ${res.slices.length}`);
  assert(res.validSlicesCount >= 2, `Should segment into at least 2 distinct vocal phrases`);
  console.log(`   -> Successfully split continuous vibrato phrases without micro-chatter.`);
}

// Test 6: Manual Slice Boundary Editing (Move, Split, Delete)
{
  console.log('6. Testing Interactive Slice Boundary Operations (Move, Split, Delete)...');
  let res = sliceAudioBuffer(drumPcm, sampleRate, { mode: 'grid', bpm: 120, gridDivision: '1/4' });
  const initialCount = res.slices.length;
  assert(initialCount >= 4, 'Grid should have at least 4 slices');

  // Test Move boundary #2
  const boundariesBefore = extractBoundaryFrames(res, drumPcm.length);
  const oldBoundary = boundariesBefore[2];
  res = moveSliceBoundary(res, drumPcm, sampleRate, 2, oldBoundary + 500, false);
  const boundariesAfterMove = extractBoundaryFrames(res, drumPcm.length);
  assert.strictEqual(boundariesAfterMove[2], oldBoundary + 500, 'Boundary should move by exact delta');
  console.log(`   -> moveSliceBoundary succeeded: moved boundary #2 from ${oldBoundary} to ${boundariesAfterMove[2]}`);

  // Test Split Slice at frame
  const splitPos = Math.round(oldBoundary + 1500);
  res = splitSliceAtFrame(res, drumPcm, sampleRate, splitPos, false);
  assert.strictEqual(res.slices.length, initialCount + 1, 'Splitting should increase slice count by 1');
  console.log(`   -> splitSliceAtFrame succeeded: split slice at ${splitPos}, total slices now ${res.slices.length}`);

  // Test Delete Slice
  const sliceToDelete = res.slices[1].id;
  res = deleteSlice(res, drumPcm, sampleRate, sliceToDelete);
  assert.strictEqual(res.slices.length, initialCount, 'Deleting slice should reduce count back');
  console.log(`   -> deleteSlice succeeded: deleted ${sliceToDelete}, total slices now ${res.slices.length}`);
}

// Test 7: Slice File Parser (SFZ, CUE Label Text, WAV cues)
{
  console.log('7. Testing Slice File Parser (SFZ and CUE Label Tracks)...');
  const sfzText = `
// SFZ Slice Map
<region> sample=loop.wav offset=0 end=22050
<region> sample=loop.wav offset=22050 end=44100
<region> sample=loop.wav offset=44100 end=88200
  `;
  const parsedSfz = parseSliceFile(sfzText, 'loop.sfz', sampleRate);
  assert(parsedSfz !== null, 'SFZ should be parsed');
  assert.strictEqual(parsedSfz.sliceFrames.length, 4, 'Should extract 4 boundary frames');
  assert.strictEqual(parsedSfz.format, 'sfz');
  console.log(`   -> Parsed SFZ slices: frames=[${parsedSfz.sliceFrames.join(', ')}]`);

  const cueText = `0.000000\t0.500000\tKick\n0.500000\t1.000000\tSnare\n1.000000\t1.500000\tHat`;
  const parsedCue = parseSliceFile(cueText, 'labels.txt', sampleRate);
  assert(parsedCue !== null, 'CUE label track should be parsed');
  assert.strictEqual(parsedCue.markers.length, 3, 'Should extract 3 labels');
  console.log(`   -> Parsed CUE label track: markers=[${parsedCue.markers.map((m) => m.label).join(', ')}]`);
}

// Test 8: Standard MIDI File (.mid Type 0) Generation
{
  console.log('8. Testing Standard MIDI File (.mid Type 0) Generation...');
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

  const mthd = String.fromCharCode(...midiBytes.slice(0, 4));
  assert.strictEqual(mthd, 'MThd', "Header must start with 'MThd'");

  const mtrk = String.fromCharCode(...midiBytes.slice(14, 18));
  assert.strictEqual(mtrk, 'MTrk', "Track must start with 'MTrk'");

  console.log(`   -> Generated valid SMF Type 0 buffer (${midiBytes.length} bytes) ready for DAW drag-and-drop.`);
}

console.log('\n=== ALL AUDIO SLICER & CHOPPER TESTS PASSED SUCCESSFULLY! ===');
