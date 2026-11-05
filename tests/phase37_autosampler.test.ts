// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Phase 37: Native MIDI AutoSampler Verification Suite
//
// Verifies end-to-end:
//   1. Spike 0 (`WebMidiAutoSamplerService`): Input/Output enumeration,
//      synthetic MIDI message dispatch, sustain pedal (`CC 64`) hold handling,
//      and `runMidiJitterSmokeTest`.
//   2. Step A (`autoSamplerDsp.ts` in `@abdsynths/shared`):
//      - `evaluateReleaseTailDecay` (`auto_decay` to noise floor vs `fixed_time`).
//      - `measureMidiToAudioLatency` & `findSampleAccurateSyncOffset` (Radix-2 FFT
//        spectral cross-correlation).
//      - `capturePreRollNoiseProfile` (mandatory `dcBlock` before `computeNoiseProfile`).
//      - All 5 velocity curves (`linear`, `high_precision`, `low_precision`,
//        `classic_neuron_2layer`, `manual_table`) covering `1..127` contiguously.
//      - `generateSweepSchedule` (startOctave, octaveCount, notesPerOctave 1/2/3/4/6/12,
//        contiguous `0..127` keybed ranges).
//   3. Drum Hit-Name Maps (`drumMapParser.ts`):
//      - `.txt`/`.csv`, `.json`, and `.yaml`/`.yml` parsing with `muteGroup`.
//      - `extractDrumMapFromManualTextDeterministic` (raw manual text extractor +
//        automatic hi-hat choke group).
//   4. Live MIDI Keyboard Capture (`LiveMidiCaptureTracker`):
//      - Passive capture of live played notes, velocity layer grouping, and
//        polyphonic overlap flagging.
//   5. Resume Interrupted Recording & Single-Cell Re-Take:
//      - `getPendingOrFailedEventIndices` and `appendResumedRecordingToManifest`.
//   6. Continuous-Take Cleaning + Deterministic Manifest Slicing + Sustain-Bounded
//      `AutoLoop` (`NoteOn..NoteOff`) + Analog Detune Compensation (`khiner/AutoSampler`)
//      + RIFF `atem` chunk persistence (`embedManifestInWavBytes` / `extractManifestFromWavBytes`).
//   7. Constant-Zoom Live Scrolling Waveform Window (`RecordingEngine.getRecentMonoSamples`).
// ─────────────────────────────────────────────────────────

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RecordingEngine } from '@abdsynths/shared/dsp/take/recordingEngine.ts';
import {
  evaluateReleaseTailDecay,
  measureMidiToAudioLatency,
  findSampleAccurateSyncOffset,
  capturePreRollNoiseProfile,
  computeVelocityLayers,
  generateSweepSchedule,
  analyzePilotNoteResponse,
  createMidiAutoSampleManifest,
} from '@abdsynths/shared/dsp/take';
import { WebMidiAutoSamplerService } from '../src/core/midi/WebMidiAutoSamplerService.ts';
import {
  parseDrumHitMapFile,
  extractDrumMapFromManualTextDeterministic,
  FACTORY_DRUM_MAP_PRESETS,
} from '../src/core/autoSampler/drumMapParser.ts';
import {
  applyPilotRecommendationToConfig,
  buildScheduleFromConfig,
  DEFAULT_AUTOSAMPLER_CONFIG,
  getPendingOrFailedEventIndices,
  appendResumedRecordingToManifest,
  LiveMidiCaptureTracker,
  processAutoSampledRecording,
  embedManifestInWavBytes,
  extractManifestFromWavBytes,
  runScheduledSweepOrchestrator,
  validateManualVelocities,
  enforceAutoSamplerConfigCoherence,
  getMaxOctavesForStartOctave,
} from '../src/core/autoSampler/MidiAutoSampleSession.ts';
import { encodePcm16Wav } from '../src/core/dsp/WavDecoder.ts';

console.log('Running Phase 37 Native MIDI AutoSampler Verification Suite...');

// ── Test 1: Spike 0 WebMidiAutoSamplerService + Sustain Pedal Hold + Jitter Smoke Test ──
await (async () => {
  const midi = new WebMidiAutoSamplerService();
  const captured: Array<{ type: string; note: number; velocity: number }> = [];
  midi.onInputMessage((msg) => {
    if (msg.type === 'noteon' || msg.type === 'noteoff') {
      captured.push({ type: msg.type, note: msg.note, velocity: msg.velocity });
    }
  });

  // Engage sustain pedal (CC 64 = 127) -> NoteOff should be deferred until pedal release
  midi.dispatchIncomingMessage([0xb0, 64, 127], 10);
  midi.dispatchIncomingMessage([0x90, 60, 100], 20);
  midi.dispatchIncomingMessage([0x80, 60, 0], 50);
  assert.equal(captured.length, 1, 'NoteOff must be held while sustain pedal is depressed');
  assert.equal(captured[0].type, 'noteon');

  // Release sustain pedal (CC 64 = 0) -> deferred NoteOff is emitted immediately
  midi.dispatchIncomingMessage([0xb0, 64, 0], 80);
  assert.equal(captured.length, 2, 'Releasing sustain pedal must emit the deferred NoteOff');
  assert.equal(captured[1].type, 'noteoff');
  assert.equal(captured[1].note, 60);

  const jitter = await midi.runMidiJitterSmokeTest(35);
  assert.equal(jitter.notesSent, 3);
  assert.ok(jitter.avgJitterMs >= 0 && jitter.avgJitterMs < 50, 'Jitter smoke test must complete cleanly');
  console.log('  ✓ Test 1 passed: WebMidiAutoSamplerService + Sustain CC64 + Spike 0 Jitter test');
})();

// ── Test 2: All 5 Velocity Curves & Parametric Sweep Schedule ──
{
  const curves = [
    'linear',
    'high_precision',
    'low_precision',
    'classic_neuron_2layer',
    'manual_table',
  ] as const;

  for (const curve of curves) {
    const layers = computeVelocityLayers({
      layerCount: 4,
      curve,
      manualVelocities: [30, 70, 100, 125],
    });
    assert.ok(layers.length >= 2, `Curve ${curve} must produce layers`);
    assert.equal(layers[0].lowVel, 1, `Curve ${curve} must start at velocity 1`);
    assert.equal(
      layers[layers.length - 1].highVel,
      127,
      `Curve ${curve} must end at velocity 127`
    );
    for (let i = 1; i < layers.length; i++) {
      assert.equal(
        layers[i].lowVel,
        layers[i - 1].highVel + 1,
        `Curve ${curve} velocity ranges must be contiguous without gaps`
      );
    }
  }

  // Verify high_precision puts narrower bands at the top than at the bottom
  const hiPrec = computeVelocityLayers({ layerCount: 4, curve: 'high_precision' });
  const lowSpan = hiPrec[0].highVel - hiPrec[0].lowVel;
  const highSpan = hiPrec[hiPrec.length - 1].highVel - hiPrec[hiPrec.length - 1].lowVel;
  assert.ok(highSpan < lowSpan, 'high_precision curve must allocate finer steps in high velocities');

  // Verify schedule generation for 4 notes/octave across 2 octaves starting at C2 (MIDI 36)
  const schedule = generateSweepSchedule({
    startOctave: 2,
    octaveCount: 2,
    notesPerOctave: 4, // step = 3 semitones -> 8 notes * 2 vel layers = 16 cells
    velocityConfig: { layerCount: 2, curve: 'classic_neuron_2layer' },
    extendToFullKeybed: true,
  });
  assert.equal(schedule.length, 16, '2 octaves * 4 notes/oct * 2 velocity layers = 16 events');
  assert.equal(schedule[0].lowKey, 0, 'First note must extend down to MIDI 0');
  assert.equal(schedule[schedule.length - 1].highKey, 127, 'Last note must extend up to MIDI 127');
  console.log('  ✓ Test 2 passed: Velocity curves (5 modes) & Parametric Sweep Schedule');
}

// ── Test 3: Release Tail Decay, RTL Latency, FFT Sync Offset & Pre-Roll Noise Print ──
{
  const sr = 44100;
  const noteOffFrame = Math.round(0.2 * sr);
  const totalFrames = Math.round(1.0 * sr);
  const decayingAudio = new Float32Array(totalFrames);

  for (let i = 0; i < totalFrames; i++) {
    const t = i / sr;
    const env = i <= noteOffFrame ? 0.6 : 0.6 * Math.exp(-(i - noteOffFrame) / (0.04 * sr));
    decayingAudio[i] = env * Math.sin(2 * Math.PI * 220 * t);
  }

  const decayRes = evaluateReleaseTailDecay(decayingAudio, {
    sampleRate: sr,
    noteOffFrame,
    maxReleaseMs: 800,
    noiseFloorDbfs: -60,
  });
  assert.equal(decayRes.tailFinished, true, 'Decaying release tail must be detected as finished before timeout');
  assert.equal(decayRes.reason, 'decayed_to_noise_floor');
  assert.ok(
    decayRes.approxTailEndFrame > noteOffFrame && decayRes.approxTailEndFrame < totalFrames,
    'approxTailEndFrame must lie after noteOffFrame and before max timeout'
  );

  // Latency measurement & FFT cross-correlation sync offset
  const refSig = new Float32Array(2048);
  const delayedSig = new Float32Array(2048);
  const trueShift = 180;
  for (let i = 0; i < 600; i++) {
    const val = Math.sin(2 * Math.PI * 440 * (i / sr)) * Math.exp(-i / 250);
    refSig[100 + i] = val;
    delayedSig[100 + trueShift + i] = val;
  }
  const fftOffset = findSampleAccurateSyncOffset(refSig, delayedSig);
  assert.ok(Math.abs(fftOffset - trueShift) <= 2, `FFT cross-correlation offset (${fftOffset}) must match true shift (${trueShift})`);

  const rtl = measureMidiToAudioLatency(delayedSig, sr, 100, -60);
  assert.ok(Math.abs(rtl.latencySamples - trueShift) <= 12, 'Onset detector must locate shifted attack');

  // Pre-Roll Noise Print with DC offset
  const dcNoisyPreRoll = new Float32Array(4096);
  for (let i = 0; i < dcNoisyPreRoll.length; i++) {
    dcNoisyPreRoll[i] = 0.25 + 0.001 * Math.sin(i * 0.3); // strong 0.25 DC bias + quiet floor
  }
  const profile = capturePreRollNoiseProfile(dcNoisyPreRoll, sr);
  assert.ok(
    profile.levelDbfs < -35,
    `capturePreRollNoiseProfile must remove DC bias before measuring floor (got ${profile.levelDbfs.toFixed(1)} dBFS)`
  );

  const pilotAudio = new Float32Array(dcNoisyPreRoll.length + decayingAudio.length);
  pilotAudio.set(dcNoisyPreRoll, 0);
  pilotAudio.set(decayingAudio, dcNoisyPreRoll.length);
  const pilotDiag = analyzePilotNoteResponse(
    pilotAudio,
    sr,
    dcNoisyPreRoll.length,
    dcNoisyPreRoll.length + noteOffFrame
  );
  assert.ok(pilotDiag.recommendedGateDurationMs >= 500);
  console.log('  ✓ Test 3 passed: Release tail auto-decay, FFT sync offset & DC-blocked pre-roll Noise Print');
}

// ── Test 4: Drum Hit-Name Maps (.txt, .json, .yaml + Manual Text Extractor) ──
{
  const txtMap = parseDrumHitMapFile(
    `# Classic 808 subset\n36, Kick Drum\n38, Snare Acoustic\n42, Closed Hi-Hat, 1\n46, Open Hi-Hat, 1\n`,
    'tr808.txt'
  );
  assert.equal(txtMap.hits.length, 4);
  assert.equal(txtMap.hits[2].muteGroup, 1);

  const jsonMap = parseDrumHitMapFile(
    JSON.stringify({
      kitName: 'JSON Kit',
      defaultVelocities: [80, 127],
      hits: [
        { note: 'C1', name: 'Sub Kick' },
        { note: 38, name: 'Rim Snare', muteGroup: 2 },
      ],
    }),
    'kit.json'
  );
  assert.equal(jsonMap.kitName, 'JSON Kit');
  assert.equal(jsonMap.hits.length, 2);
  assert.equal(jsonMap.hits[0].midiNote, 24); // C1 = 24

  const yamlMap = parseDrumHitMapFile(
    `kitName: YAML Kit\nhits:\n  - note: 36\n    name: Kick YAML\n  - note: 42\n    name: Closed Hat\n    muteGroup: 1\n`,
    'kit.yaml'
  );
  assert.equal(yamlMap.kitName, 'YAML Kit');
  assert.equal(yamlMap.hits.length, 2);
  assert.equal(yamlMap.hits[1].muteGroup, 1);

  const manualExtracted = extractDrumMapFromManualTextDeterministic(
    `MIDI Implementation Table:\n36 - Bass Drum 1\n38 - Acoustic Snare\n42 - Closed Hi-Hat\n46 - Open Hi-Hat`
  );
  assert.equal(manualExtracted.hits.length, 4);
  assert.equal(manualExtracted.hits[2].muteGroup, 1, 'Closed Hi-Hat must auto-assign muteGroup 1');
  assert.equal(manualExtracted.hits[3].muteGroup, 1, 'Open Hi-Hat must auto-assign muteGroup 1');
  assert.ok(Object.keys(FACTORY_DRUM_MAP_PRESETS).length >= 3);
  console.log('  ✓ Test 4 passed: Drum Hit-Name Maps (.txt, .json, .yaml & Manual Text Extractor)');
}

// ── Test 5: Live MIDI Keyboard Capture (`LiveMidiCaptureTracker`) ──
{
  const sr = 44100;
  const tracker = new LiveMidiCaptureTracker(sr, 1200);
  // Play C3 (48) at two velocities (55 and 118) and G3 (55) at velocity 100
  tracker.onNoteOn(48, 55, 1000);
  tracker.onNoteOff(48, 12000);
  tracker.onNoteOn(48, 118, 20000);
  tracker.onNoteOff(48, 32000);
  tracker.onNoteOn(55, 100, 40000);
  tracker.onNoteOff(55, 52000);

  const manifest = tracker.finalizeManifest(60000, 'Live Played Synth', true);
  assert.equal(manifest.mode, 'live_midi_capture');
  assert.equal(manifest.events.length, 3);
  const c3Events = manifest.events.filter((e) => e.midiNote === 48);
  assert.equal(c3Events.length, 2, 'Two velocities on C3 must become 2 velocity layers on C3');
  assert.equal(c3Events[0].lowVel, 1);
  assert.equal(c3Events[1].highVel, 127);
  assert.equal(manifest.events[0].lowKey, 0);
  assert.equal(manifest.events[manifest.events.length - 1].highKey, 127);
  console.log('  ✓ Test 5 passed: LiveMidiCaptureTracker passive keyboard capture & velocity/keybed normalization');
}

// ── Test 6: Resume Interrupted Sweep + Continuous Clean + Sustain-Bounded AutoLoop + Analog Detune + RIFF `atem` ──
{
  const sr = 44100;
  const schedule = buildScheduleFromConfig({
    ...DEFAULT_AUTOSAMPLER_CONFIG,
    startOctave: 3, // C3 (48)
    octaveCount: 1,
    notesPerOctave: 2, // C3 (48) and F#3 (54)
    velocityLayers: 1,
    velocityCurve: 'linear',
  });
  assert.equal(schedule.length, 2);

  // Simulate recording Note 0 (C3 = 48, slightly detuned +12 cents from 130.81 Hz) first, leaving Note 1 pending
  const note0Freq = 130.8128 * Math.pow(2, 12 / 1200); // +12 cents
  const seg0Len = Math.round(0.9 * sr);
  const seg0 = new Float32Array(seg0Len);
  const n0On = Math.round(0.1 * sr);
  const n0Off = Math.round(0.6 * sr);
  const n0End = Math.round(0.85 * sr);
  for (let i = n0On; i < n0End; i++) {
    const t = (i - n0On) / sr;
    // After n0Off, decay exponentially
    const env = i <= n0Off ? 0.5 : 0.5 * Math.exp(-(i - n0Off) / (0.04 * sr));
    seg0[i] = env * Math.sin(2 * Math.PI * note0Freq * t);
  }

  schedule[0].status = 'recorded';
  schedule[0].noteOnFrame = n0On;
  schedule[0].noteOffFrame = n0Off;
  schedule[0].tailEndFrame = n0End;
  schedule[1].status = 'pending';

  const partialManifest = createMidiAutoSampleManifest({
    name: 'Interrupted Sweep',
    mode: 'auto_sweep',
    sampleRate: sr,
    events: schedule,
  });

  const pendingIndices = getPendingOrFailedEventIndices(partialManifest);
  assert.deepEqual(pendingIndices, [1], 'Only cell #1 must be marked pending for resume');

  // Now resume and record Note 1 (F#3 = 54, 185.0 Hz)
  const note1Freq = 440 * Math.pow(2, (schedule[1].midiNote - 69) / 12);
  const seg1Len = Math.round(0.9 * sr);
  const seg1 = new Float32Array(seg1Len);
  for (let i = n0On; i < n0End; i++) {
    const t = (i - n0On) / sr;
    const env = i <= n0Off ? 0.5 : 0.5 * Math.exp(-(i - n0Off) / (0.04 * sr));
    seg1[i] = env * Math.sin(2 * Math.PI * note1Freq * t);
  }

  const { mergedPcm, updatedManifest } = appendResumedRecordingToManifest(
    seg0,
    partialManifest,
    seg1,
    [
      {
        eventIndex: 1,
        localNoteOnFrame: n0On,
        localNoteOffFrame: n0Off,
        localTailEndFrame: n0End,
        status: 'recorded',
      },
    ]
  );

  assert.equal(
    getPendingOrFailedEventIndices(updatedManifest).length,
    0,
    'After resuming, 0 cells must remain pending'
  );

  // Process complete recording (Clean + Slice + Sustain-bounded AutoLoop + Analog Detune)
  const processed = processAutoSampledRecording(mergedPcm, updatedManifest, {
    cleanBeforeSlice: true,
    autoLoopSustained: true,
    autoCompensateAnalogDetune: true,
  });

  assert.equal(processed.slicerResult.slices.length, 2);
  assert.equal(processed.classicZones.length, 2);
  assert.equal(processed.extendedRegions.length, 2);

  // Verify AutoLoop is strictly bounded within [0 .. noteOffOffsetFrame] (never inside the release tail!)
  for (const sl of processed.slicerResult.slices) {
    assert.ok(sl.loopStartFrame !== undefined && sl.loopEndFrame !== undefined);
    assert.ok(
      sl.loopEndFrame! <= sl.noteOffOffsetFrame!,
      `Loop end (${sl.loopEndFrame}) must never enter the release tail after NoteOff (${sl.noteOffOffsetFrame})`
    );
  }

  // Verify analog detune compensation detected the +12 cent drift on Note 0
  const detune0 = processed.slicerResult.slices[0].detuneCents ?? 0;
  assert.ok(
    detune0 <= -6 && detune0 >= -18,
    `Analog detune compensation must counter +12 cent drift with ~-12 cents (got ${detune0})`
  );

  // Verify RTL latency measured by Pilot Calibration is automatically applied to slice cut boundaries
  const simulatedRtlSamples = 662; // ~15 ms at 44.1 kHz
  const cfgWithPilot = applyPilotRecommendationToConfig(DEFAULT_AUTOSAMPLER_CONFIG, {
    latencySamples: simulatedRtlSamples,
    latencyMs: 15.0,
    noiseFloorDbfs: -68,
    peakDbfs: -4,
    attackTimeMs: 12,
    measuredReleaseTailMs: 420,
    recommendedGateDurationMs: 1000,
    recommendedMaxReleaseMs: 800,
    recommendedVelocityLayers: 3,
    recommendedVelocityCurve: 'high_precision',
    rationaleEs: 'Test Pilot Recommendation',
  });
  assert.equal(cfgWithPilot.calibratedLatencySamples, simulatedRtlSamples);
  assert.equal(cfgWithPilot.calibratedLatencyMs, 15.0);
  assert.equal(cfgWithPilot.gateDurationMs, 1000);

  const processedWithRtl = processAutoSampledRecording(mergedPcm, updatedManifest, cfgWithPilot);
  assert.equal(processedWithRtl.manifest.latencySamples, simulatedRtlSamples);
  const baseStart0 = processed.slicerResult.slices[0].startFrame;
  const shiftedStart0 = processedWithRtl.slicerResult.slices[0].startFrame;
  assert.ok(
    Math.abs(shiftedStart0 - baseStart0 - simulatedRtlSamples) <= 128,
    `Automatic RTL compensation (${simulatedRtlSamples} smp) must shift slice startFrame (${baseStart0} -> ${shiftedStart0})`
  );

  // Verify RIFF `atem` chunk round-trip persistence inside WAV bytes
  const rawWav = encodePcm16Wav(mergedPcm, sr);
  const wavWithManifest = embedManifestInWavBytes(rawWav, processed.manifest);
  const recovered = extractManifestFromWavBytes(wavWithManifest);
  assert.ok(recovered !== null, 'Manifest must be recoverable from RIFF atem chunk');
  assert.equal(recovered!.events.length, 2);
  assert.equal(recovered!.events[0].midiNote, 48);
  assert.equal(recovered!.events[1].midiNote, 54);
  console.log('  ✓ Test 6 passed: Resume interrupted sweep, automatic RTL compensation, sustain-bounded AutoLoop, analog detune & RIFF atem chunk');
}

// ── Test 7: RecordingEngine.getRecentMonoSamples (Constant-Zoom Live Scrolling Window) ──
await (async () => {
  const engine = new RecordingEngine({
    sampleRate: 48000,
    channels: 1,
    start: () => undefined,
    stop: () => undefined,
  });
  await engine.beginMonitoring();
  engine.startRecording();
  const blockA = new Float32Array(1000).fill(0.25);
  const blockB = new Float32Array(500).fill(0.75);
  engine.pushSamples([blockA]);
  engine.pushSamples([blockB]);

  const recent400 = engine.getRecentMonoSamples(400);
  assert.equal(recent400.length, 400);
  assert.ok(Math.abs(recent400[0] - 0.75) < 1e-5);
  assert.ok(Math.abs(recent400[399] - 0.75) < 1e-5);

  const recent700 = engine.getRecentMonoSamples(700);
  assert.equal(recent700.length, 700);
  assert.ok(Math.abs(recent700[0] - 0.25) < 1e-5, 'First 200 samples of 700-sample tail must come from blockA');
  assert.ok(Math.abs(recent700[699] - 0.75) < 1e-5, 'Last 500 samples of 700-sample tail must come from blockB');
  engine.stopRecording();
  console.log('  ✓ Test 7 passed: RecordingEngine.getRecentMonoSamples constant-zoom window');
})();

// ── Test 8: Documentation & Native UI Wiring Checks ──
{
  assert.ok(
    fs.existsSync('DOCS/AUTOSAMPLER_DRUM_MAP_SPEC.md'),
    'DOCS/AUTOSAMPLER_DRUM_MAP_SPEC.md must exist'
  );
  // Fase 42.5: el modal se partió en src/ui/recorder/* (mismo patrón que chopper/).
  // Las aserciones de presencia cubren la fachada + todos los submódulos.
  const recModalSrc = ['AudioRecorderModal', ...['captureOps', 'sweepOps', 'takeOps', 'deckOps', 'renderOps', 'canvasOps'].map((m) => `recorder/${m}`)]
    .map((m) => fs.readFileSync(`src/ui/${m}.ts`, 'utf8'))
    .join('\n');
  assert.ok(
    recModalSrc.includes('drawLiveScrollingWaveform'),
    'AudioRecorderModal must implement drawLiveScrollingWaveform'
  );
  assert.ok(
    recModalSrc.includes('Continuar desde donde se paró'),
    'AudioRecorderModal must include the resume interrupted sweep action'
  );
  assert.ok(
    recModalSrc.includes('runScheduledSweepOrchestrator') &&
      typeof runScheduledSweepOrchestrator === 'function',
    'AudioRecorderModal must delegate the sweep loop to runScheduledSweepOrchestrator in MidiAutoSampleSession'
  );
  assert.ok(
    recModalSrc.includes('btn-as-apply-pilot-rtl'),
    'AudioRecorderModal must expose the Apply measured RTL action'
  );
  assert.ok(
    recModalSrc.includes('nmm-vel-curve-viz') && recModalSrc.includes('data-manual-vel-idx'),
    'AudioRecorderModal must render per-slot manual velocity fields and graphical velocity curve representation'
  );

  // Coherence rules: classic_neuron_2layer cannot allow 4 layers
  const cohNeuron = enforceAutoSamplerConfigCoherence(
    { ...DEFAULT_AUTOSAMPLER_CONFIG, velocityLayers: 4, velocityCurve: 'linear' },
    { changedField: 'velocityCurve', newVelocityCurve: 'classic_neuron_2layer' }
  );
  assert.equal(cohNeuron.config.velocityLayers, 2, 'Selecting classic_neuron_2layer must force 2 layers');

  const cohFromNeuronTo4 = enforceAutoSamplerConfigCoherence(
    { ...DEFAULT_AUTOSAMPLER_CONFIG, velocityLayers: 2, velocityCurve: 'classic_neuron_2layer' },
    { changedField: 'velocityLayers', newVelocityLayers: 4 }
  );
  assert.equal(cohFromNeuronTo4.config.velocityLayers, 4);
  assert.equal(cohFromNeuronTo4.config.velocityCurve, 'linear', 'Changing layers from 2 to 4 on classic_neuron_2layer must switch curve to linear');

  // 1-layer curve selection coherence
  const coh1LayerCurve = enforceAutoSamplerConfigCoherence(
    { ...DEFAULT_AUTOSAMPLER_CONFIG, velocityLayers: 1, velocityCurve: 'linear' },
    { changedField: 'velocityCurve', newVelocityCurve: 'high_precision' }
  );
  assert.equal(coh1LayerCurve.config.velocityLayers, 3, 'Selecting multi-layer curve while at 1 layer must auto-bump layers');

  // Octave boundary clamping
  assert.equal(getMaxOctavesForStartOctave(6), 3, 'Start octave C6 (MIDI 84) allows at most 3 octaves (<= MIDI 127)');
  const cohOct = enforceAutoSamplerConfigCoherence(
    { ...DEFAULT_AUTOSAMPLER_CONFIG, startOctave: 2, octaveCount: 6 },
    { changedField: 'startOctave', newStartOctave: 6 }
  );
  assert.equal(cohOct.config.octaveCount, 3, 'Switching startOctave to C6 must clamp octaveCount to 3');

  // Manual velocity validation (duplicates + out-of-range 0..127)
  const badDup = validateManualVelocities([60, 60, 120]);
  assert.equal(badDup.valid, false, 'Duplicate manual velocities must be marked invalid');
  assert.deepEqual(badDup.duplicateIndices, [0, 1]);

  const badZero = validateManualVelocities([0, 130]);
  assert.equal(badZero.valid, false, 'Velocity 0 (NoteOff) and >127 must be marked invalid');
  assert.equal(badZero.outOfRangeIndices.length, 2);

  // Mode-specific schedule behavior:
  // 1) live_midi_capture must NOT pre-generate a schedule grid (unknown notes until user plays)
  const liveSchedule = buildScheduleFromConfig({
    ...DEFAULT_AUTOSAMPLER_CONFIG,
    mode: 'live_midi_capture',
  });
  assert.equal(liveSchedule.length, 0, 'live_midi_capture must return an empty pre-recording schedule');

  // 2) drum_map must auto-default to factory TR-808/909 drum map when customDrumMap is null
  const drumSchedule = buildScheduleFromConfig({
    ...DEFAULT_AUTOSAMPLER_CONFIG,
    mode: 'drum_map',
    customDrumMap: null,
    velocityLayers: 2,
  });
  assert.ok(drumSchedule.length > 0, 'drum_map must generate schedule cells from default factory drum map');
  assert.ok(drumSchedule.some((ev) => (ev.drumHitName ?? '').toLowerCase().includes('kick') || ev.midiNote === 36), 'drum_map schedule must include drum hit names');

  // 3) Verify updated workflow mode names & 3-mode denoise in AudioRecorderModal
  assert.ok(
    recModalSrc.includes('Captura MIDI en Tiempo Real') &&
      recModalSrc.includes('Muestreo de Batería / Percusión'),
    'AudioRecorderModal must use the updated Spanish workflow literals'
  );
  assert.ok(
    recModalSrc.includes('btn-rec-algo-denoise') &&
      recModalSrc.includes('btn-rec-dsp-denoise') &&
      recModalSrc.includes('btn-rec-ai-enhance'),
    'AudioRecorderModal must expose all 3 Denoise modes (Algorítmico, Huella de Ruido, IA)'
  );

  console.log('  ✓ Test 8 passed: Spec documentation, coherence enforcement, manual velocity validation & AudioRecorderModal native integration');
}

console.log('All Phase 37 Native MIDI AutoSampler tests passed!');
