// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Phase 35.5: Musician Guided Wizard Tests
//
// Verifies:
//   1. Musician Defaults (`trimSilence`, `snapZeroCrossing`, 2 velocity layers
//      in Classic mode, `requireAiFallbackConsent: true`, `defaultRoleChoice: 'auto'`).
//   2. Material inspection (`inspectWizardMaterialFilename`): raw audio vs pre-mapped bank fast-track.
//   3. Step 2 Clean (`runWizardCleanStep`): silence trim with zero-crossing snap,
//      noise print calculation, DC blocking, and -1.0 dBFS peak normalization.
//   4. Step 3 Slice & Map (`runWizardSliceAndMapStep`):
//      - `auto` role detection for single sustained note (`single`), melodic phrase (`melody`),
//        and percussive drum hits (`drums`).
//      - Contiguous 0..127 MIDI keybed coverage and 2 velocity layers (`sampleLow` + `sampleHigh`) in Classic mode.
// ─────────────────────────────────────────────────────────

import assert from 'node:assert/strict';
import {
  MUSICIAN_WIZARD_DEFAULTS,
  inspectWizardMaterialFilename,
  runWizardCleanStep,
  runWizardSliceAndMapStep,
  sanitizeClassicModelName,
} from '../src/core/wizard/musicianWizard.ts';
import { analyzeImportPreflight } from '../src/core/import/importPreflight.ts';
import { fromImportPreflightReport } from '../src/ui/preflightGateView.ts';
import type { ParsedSamplerPreset } from '../src/core/import/rawSamplerParsers.ts';

function generateSustainedToneWithSilencePadding(
  freqHz: number,
  sampleRate = 44100,
  leadingSilenceSec = 0.15,
  toneSec = 0.8,
  trailingSilenceSec = 0.15
): Float32Array {
  const leadSamples = Math.round(leadingSilenceSec * sampleRate);
  const toneSamples = Math.round(toneSec * sampleRate);
  const trailSamples = Math.round(trailingSilenceSec * sampleRate);
  const total = leadSamples + toneSamples + trailSamples;
  const out = new Float32Array(total);

  // Add slight DC offset + quiet noise floor in silence
  for (let i = 0; i < total; i++) {
    out[i] = 0.005 + Math.sin(i * 0.17) * 0.0005;
  }

  for (let i = 0; i < toneSamples; i++) {
    const t = i / sampleRate;
    const attack = Math.min(1, t / 0.02);
    const sig =
      0.45 * Math.sin(2 * Math.PI * freqHz * t) +
      0.2 * Math.sin(2 * Math.PI * (freqHz * 2) * t) +
      0.1 * Math.sin(2 * Math.PI * (freqHz * 3) * t);
    out[leadSamples + i] += attack * sig;
  }
  return out;
}

function generateDrumLoopHits(sampleRate = 44100): Float32Array {
  const durationSec = 1.2;
  const total = Math.round(durationSec * sampleRate);
  const out = new Float32Array(total);
  const hitTimesSec = [0.05, 0.3, 0.55, 0.8, 1.0];

  // Deterministic pseudo-noise burst per hit
  let seed = 1234567;
  const nextRand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 4294967296) * 2 - 1;
  };

  for (const hitSec of hitTimesSec) {
    const start = Math.round(hitSec * sampleRate);
    const len = Math.round(0.06 * sampleRate);
    for (let i = 0; i < len && start + i < total; i++) {
      const env = Math.exp(-i / (0.012 * sampleRate));
      out[start + i] = nextRand() * env * 0.85;
    }
  }
  return out;
}

console.log('Running Phase 35.5 Musician Guided Wizard Tests...');

// Test 1: Musician Defaults contract
{
  assert.equal(MUSICIAN_WIZARD_DEFAULTS.trimSilence, true, 'trimSilence must be enabled by default');
  assert.equal(MUSICIAN_WIZARD_DEFAULTS.snapZeroCrossing, true, 'snapZeroCrossing must be enabled by default');
  assert.equal(
    MUSICIAN_WIZARD_DEFAULTS.classicTwoVelocityLayers,
    true,
    '2 velocity layers in Classic mode must be enabled by default'
  );
  assert.equal(
    MUSICIAN_WIZARD_DEFAULTS.requireAiFallbackConsent,
    true,
    'AI fallback consent must always be required by default'
  );
  assert.equal(
    MUSICIAN_WIZARD_DEFAULTS.defaultRoleChoice,
    'auto',
    'Step 3 role choice must default to "auto" (detectar solo)'
  );
  console.log('  ✓ 1. MUSICIAN_WIZARD_DEFAULTS enforces trim+zc-snap, 2 Classic layers, consent always, and auto role');
}

// Test 2: Material inspection (raw audio vs mapped bank fast-track)
{
  const rawWav = inspectWizardMaterialFilename('WarmPad_C3.wav', 1, false);
  assert.equal(rawWav.kind, 'raw_audio');
  assert.equal(rawWav.canFastTrackToStep4, false);
  assert.equal(rawWav.recommendedNextStep, 'clean');

  const recordedTake = inspectWizardMaterialFilename('Toma_01.wav', 1, true);
  assert.equal(recordedTake.kind, 'raw_audio');
  assert.equal(recordedTake.recommendedNextStep, 'clean');

  const sf2Bank = inspectWizardMaterialFilename('VintageKeys.sf2', 1, false);
  assert.equal(sf2Bank.kind, 'mapped_bank');
  assert.equal(sf2Bank.canFastTrackToStep4, true);
  assert.equal(sf2Bank.recommendedNextStep, 'generate_export');

  const neuronModel = inspectWizardMaterialFilename('001.model', 1, false);
  assert.equal(neuronModel.kind, 'mapped_bank');
  assert.equal(neuronModel.canFastTrackToStep4, true);
  console.log('  ✓ 2. inspectWizardMaterialFilename routes raw takes to Step 2 and pre-mapped banks to Step 4');
}

// Test 3: Step 2 Clean (silence trim + zero-crossing snap + noise print + peak normalization)
{
  const sr = 44100;
  const raw = generateSustainedToneWithSilencePadding(261.63, sr, 0.15, 0.7, 0.15);
  const res = runWizardCleanStep(raw, sr);

  assert.ok(res.cleanedPcm.length > 0 && res.cleanedPcm.length < raw.length, 'Silence must be trimmed');
  assert.ok(res.leadingTrimmedMs >= 80, `Expected leading trim >= 80ms, got ${res.leadingTrimmedMs}ms`);
  assert.ok(res.trailingTrimmedMs >= 80, `Expected trailing trim >= 80ms, got ${res.trailingTrimmedMs}ms`);
  assert.ok(Math.abs(res.peakAfterDbfs - -1.0) <= 0.3, `Expected peak near -1.0 dBFS, got ${res.peakAfterDbfs}`);
  assert.ok(Number.isFinite(res.noiseProfile.levelDbfs), 'Noise profile levelDbfs must be computed');
  console.log('  ✓ 3. runWizardCleanStep trims silence with zc-snap, computes Noise Print, and normalizes to -1.0 dBFS');
}

// Test 4: Step 3 Slice & Map ('auto' role detection + 2 Classic layers + full 0..127 coverage)
{
  const sr = 44100;
  // 4a. Single sustained note (C4 = 261.63 Hz -> MIDI 60)
  const cleanTone = runWizardCleanStep(generateSustainedToneWithSilencePadding(261.63, sr, 0.1, 0.8, 0.1), sr);
  const singleRes = runWizardSliceAndMapStep(cleanTone.cleanedPcm, sr, {
    roleChoice: 'auto',
    sourceName: 'AnalogBrass_C4.wav',
  });

  assert.equal(singleRes.resolvedRole, 'single', 'Sustained single note should auto-resolve to "single"');
  assert.equal(singleRes.classicZones.length, 1);
  assert.equal(singleRes.classicZones[0].lowKey, 0);
  assert.equal(singleRes.classicZones[0].highKey, 127);
  assert.ok(
    Math.abs(singleRes.classicZones[0].rootKey - 60) <= 1,
    `Expected rootKey near 60 (C4), got ${singleRes.classicZones[0].rootKey}`
  );
  assert.ok(singleRes.classicZones[0].sampleLow, 'Classic zone must have sampleLow');
  assert.ok(singleRes.classicZones[0].sampleHigh, 'Classic zone must have sampleHigh (2 layers default)');
  assert.equal(singleRes.extendedRegions.length, 2, '2 velocity layers should produce 2 ExtendedRegions');

  // 4b. Drum hits -> auto-resolves to 'drums' and Parameter Set #8
  const drumPcm = generateDrumLoopHits(sr);
  const drumRes = runWizardSliceAndMapStep(drumPcm, sr, {
    roleChoice: 'auto',
    sourceName: 'DrumBreak.wav',
  });
  assert.equal(drumRes.resolvedRole, 'drums', 'Multi-transient noise hits should auto-resolve to "drums"');
  assert.equal(drumRes.suggestedParameterSet, 8, 'Drums must recommend Parameter Set #8');
  assert.ok(drumRes.classicZones.length >= 2, 'Expected multiple drum zones');
  assert.equal(drumRes.classicZones[0].lowKey, 0, 'First zone must start at MIDI 0');
  assert.equal(
    drumRes.classicZones[drumRes.classicZones.length - 1].highKey,
    127,
    'Last zone must end at MIDI 127'
  );

  // 4c. Classic model name sanitizer (max 11 chars)
  assert.equal(sanitizeClassicModelName('GrandPiano_Studio_HD.wav'), 'GrandPiano_');

  console.log('  ✓ 4. runWizardSliceAndMapStep auto-detects single vs drums, builds 2 Classic layers, and covers 0..127');
}

// Test 5: Simulated recording with room noise + reverb tail on a single pad note + "Por qué elegí esto"
{
  const sr = 44100;
  const total = Math.round(1.6 * sr);
  const reverberantPad = new Float32Array(total);
  let seed = 9876543;
  const nextRand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 4294967296) * 2 - 1;
  };

  for (let i = 0; i < total; i++) {
    const t = i / sr;
    // Note body (0..0.55s) + long decaying reverb tail (0.55..1.6s) + room floor (-44 dB) + small tail ripple at 0.95s
    const bodyEnv = t < 0.55 ? Math.min(1, t / 0.03) * 0.75 : 0.75 * Math.exp(-(t - 0.55) / 0.32);
    const tailRipple = t > 0.9 && t < 1.05 ? 0.14 * Math.exp(-(t - 0.9) / 0.06) : 0;
    const tone =
      Math.sin(2 * Math.PI * 261.63 * t) +
      0.35 * Math.sin(2 * Math.PI * 523.25 * t);
    const roomNoise = nextRand() * 0.006;
    reverberantPad[i] = (bodyEnv + tailRipple) * tone * 0.55 + roomNoise;
  }

  const clean = runWizardCleanStep(reverberantPad, sr);
  const res = runWizardSliceAndMapStep(clean.cleanedPcm, sr, {
    roleChoice: 'auto',
    sourceName: 'ReverbPad_C4.wav',
  });

  assert.equal(
    res.resolvedRole,
    'single',
    'Single note with reverb tail and room noise must NOT flip to melody'
  );
  assert.ok(
    res.autoDecisionReasonEs.startsWith('Por qué elegí esto:'),
    `Expected transparent "Por qué elegí esto:" explanation, got: ${res.autoDecisionReasonEs}`
  );
  assert.ok(Number.isFinite(res.autoDecisionMetrics.transientDensityHz));
  assert.ok(Number.isFinite(res.autoDecisionMetrics.sustainRatioPct));
  assert.ok(Number.isFinite(res.autoDecisionMetrics.detectedF0Hz));
  console.log('  ✓ 5. Reverberant single note with room noise stays "single" and exposes "Por qué elegí esto" metrics');
}

// Test 6: Manual Root Key (F0) correction in 'single' mode before extending 0..127
{
  const sr = 44100;
  const cleanTone = runWizardCleanStep(generateSustainedToneWithSilencePadding(261.63, sr, 0.05, 0.6, 0.05), sr);
  // Suppose the estimator detected ~60 (C4), but the musician knows it's an octave higher (72 = C5)
  const overridden = runWizardSliceAndMapStep(cleanTone.cleanedPcm, sr, {
    roleChoice: 'single',
    singleRootKeyOverride: 72,
    sourceName: 'FluteAiry.wav',
  });

  assert.equal(overridden.effectiveRootKey, 72, 'effectiveRootKey must reflect the musician override (72)');
  assert.equal(overridden.classicZones[0].rootKey, 72, 'Classic zone rootKey must use overridden rootKey (72)');
  assert.equal(overridden.classicZones[0].lowKey, 0);
  assert.equal(overridden.classicZones[0].highKey, 127);
  assert.equal(overridden.extendedRegions[0].rootKey, 72, 'Extended region rootKey must use overridden rootKey (72)');
  assert.ok(overridden.slices[0].label.includes('72'), 'Slice label must display corrected root note 72');
  console.log('  ✓ 6. singleRootKeyOverride corrects F0 octave/semitone errors and propagates to 0..127 zones');
}

// Test 7: Bank fast-track preflight when bank is already 100% compatible (0..127, <= 2 layers)
{
  const perfectPreset: ParsedSamplerPreset = {
    format: 'sfz',
    formatLabel: 'SFZ v2',
    presetName: 'ReadySynth',
    modelName: 'ReadySynth',
    detectedCategory: 'Synth',
    suggestedParameterSet: 0,
    regions: [
      {
        sampleName: 'full_c4.wav',
        lowKey: 0,
        highKey: 127,
        rootKey: 60,
        lowVel: 1,
        highVel: 127,
        detuneCents: 0,
        volumeDb: 0,
        pan: 0,
        loopMode: 'no_loop',
        loopStart: 0,
        loopEnd: 0,
      },
    ],
    audioBuffers: new Map([['full_c4.wav', new ArrayBuffer(128)]]),
  };

  const report = analyzeImportPreflight(perfectPreset, 'classic');
  const gate = fromImportPreflightReport(report, perfectPreset, 'classic', {
    autoExtendOuterZones: report.defaultActions.autoExtendOuterZones,
    adaptVelocityLayers: report.defaultActions.adaptVelocityLayers,
    switchToExtendedMode: report.defaultActions.switchToExtendedMode,
  });

  assert.equal(gate.statusSeverity, 'ok');
  assert.equal(gate.changes.length, 0, 'A 100% compatible bank should have 0 forced changes');
  assert.equal(gate.changesHeading, 'Sin adaptaciones necesarias');
  console.log('  ✓ 7. 100% compatible bank shows clean "Sin adaptaciones necesarias" state in Step 1');
}

console.log('ALL PHASE 35.5 MUSICIAN WIZARD TESTS PASSED (7/7)!');
