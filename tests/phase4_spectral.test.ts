// ─────────────────────────────────────────────────────────
// Phase 4 Verification Test Suite
// Tests 2D STFT Spectrogram, Partial Trajectory Tracking,
// A/B Waveform Envelope Extraction, and Spectral Cache Invalidation
// ─────────────────────────────────────────────────────────

import { WebAudioPipeline } from '../src/core/WebAudioPipeline.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

async function runPhase4Tests(): Promise<void> {
  console.log('=== Phase 4 Verification: 2D Spectrogram, Partial Trajectories & A/B Resynthesis ===\n');

  const core = new WebAudioPipeline();
  await core.init();
  const session = await core.newSession('Phase4SpectralSession');
  const zone0 = session.zones[0];

  console.log('1. Testing `inspectZoneSpectrum` 2D STFT spectrogram & partial trajectories...');
  const insp = core.inspectZoneSpectrum(zone0.id);

  assert(insp.zoneId === zone0.id, 'Zone ID must match');
  assert(insp.sampleRate === 44100, `Expected sampleRate 44100, got ${insp.sampleRate}`);
  assert(insp.spectrogram.binCount === 96, `Expected 96 spectrogram bins, got ${insp.spectrogram.binCount}`);
  assert(insp.spectrogram.frameCount > 4, `Expected >4 spectrogram frames, got ${insp.spectrogram.frameCount}`);
  assert(
    insp.spectrogram.magnitudes[0].length === 96,
    'Spectrogram column must have 96 normalized dB bins'
  );

  // Check partial tracks
  assert(
    insp.partialTracks.length > 0,
    'Expected at least 1 active harmonic partial track'
  );
  const fundTrack = insp.partialTracks.find((t) => t.partialIndex === 1);
  assert(fundTrack !== undefined, 'Fundamental partial track (H1) must be present');
  assert(
    fundTrack!.frames.length >= 2 &&
      Math.abs(fundTrack!.frames[0].freqHz - 261.63) < 5.0,
    `Expected H1 frequency near 261.63 Hz, got ${fundTrack!.frames[0].freqHz} Hz`
  );
  console.log(
    `   -> Spectrogram (${insp.spectrogram.frameCount}x${insp.spectrogram.binCount}) + ${insp.partialTracks.length} partial tracks verified (H1=${fundTrack!.frames[0].freqHz} Hz).`
  );

  console.log('2. Testing A/B Waveform envelopes (Original vs Additive Scape/Sphere Resynthesis)...');
  assert(
    insp.waveformPeaks.min.length === 180 && insp.waveformPeaks.max.length === 180,
    'Original waveformPeaks must have 180 columns'
  );
  assert(
    insp.resynthPeaks.min.length === 180 && insp.resynthPeaks.max.length === 180,
    'Resynthesis resynthPeaks must have 180 columns'
  );
  assert(
    insp.waveformPeaks.rmsDb > -60 && insp.waveformPeaks.rmsDb <= 0,
    `Unexpected original RMS dB: ${insp.waveformPeaks.rmsDb}`
  );
  assert(
    insp.resynthPeaks.rmsDb > -60 && insp.resynthPeaks.rmsDb <= 0,
    `Unexpected resynthesis RMS dB: ${insp.resynthPeaks.rmsDb}`
  );
  console.log(
    `   -> A/B Envelopes verified: Original RMS=${insp.waveformPeaks.rmsDb} dB, Resynthesis RMS=${insp.resynthPeaks.rmsDb} dB.`
  );

  console.log('3. Testing cache hit & invalidation on zone update...');
  const cachedInsp = core.inspectZoneSpectrum(zone0.id);
  assert(cachedInsp === insp, 'Second call with unchanged zone must return cached inspection');

  await core.updateZone(zone0.id, { detune: 25 });
  const updatedInsp = core.inspectZoneSpectrum(zone0.id);
  assert(updatedInsp !== insp, 'Updating zone detune must invalidate spectral cache');

  console.log('4. Testing headless safety of `getRealtimeSpectrum` and `stopAudition`...');
  const rt = core.getRealtimeSpectrum();
  assert(rt.isPlaying === false && rt.rmsDb === -96, 'Expected idle realtime spectrum in Node');
  core.stopAudition();

  core.dispose();
  console.log('\nALL PHASE 4 TESTS PASSED SUCCESSFULLY!');
}

runPhase4Tests().catch((err) => {
  console.error(err);
  process.exit(1);
});
