// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Phase 5 Verification Suite
// Tests Undo/Redo stack, slider coalescing, ProcessConfig validation,
// and one-click Auto-Repair of MIDI 0..127 coverage.
// ─────────────────────────────────────────────────────────

import assert from 'node:assert/strict';
import { WebAudioPipeline } from '../src/core/WebAudioPipeline.ts';
import {
  midiToNoteName,
  midiNoteToString,
  detuneToString,
  volumeToLongString,
  panToString,
} from '../src/ui/ZoneRibbon.ts';
import { encodeAiffPcm16, decodeAiff } from '../src/core/dsp/WavDecoder.ts';

async function runPhase5Tests(): Promise<void> {
  console.log('=== ABDNeuModMakr Phase 5 Verification Suite ===');

  const pipeline = new WebAudioPipeline();
  await pipeline.init();
  await pipeline.newSession('Phase5UXTest');

  // 1. Initial history state should be empty
  let hist = pipeline.getHistoryState();
  assert.equal(hist.canUndo, false);
  assert.equal(hist.canRedo, false);
  assert.equal(hist.undoCount, 0);

  // 2. Add / split zones and verify Undo/Redo
  const z2 = await pipeline.addZone(48, 'Piano_48_C3.wav');
  const z3 = await pipeline.addZone(72, 'Lead_72_C5.wav');
  assert.equal(pipeline.getZones().length, 3);

  hist = pipeline.getHistoryState();
  assert.equal(hist.canUndo, true);
  assert.equal(hist.undoCount, 2);
  assert.equal(hist.undoLabel, 'Split Zone at MIDI 72');

  // Undo second split -> back to 2 zones
  const afterUndo1 = pipeline.undo();
  assert.ok(afterUndo1);
  assert.equal(pipeline.getZones().length, 2);
  assert.equal(pipeline.getHistoryState().canRedo, true);
  assert.equal(pipeline.getHistoryState().redoLabel, 'Split Zone at MIDI 72');

  // Undo first split -> back to 1 zone (0..127)
  const afterUndo2 = pipeline.undo();
  assert.ok(afterUndo2);
  assert.equal(pipeline.getZones().length, 1);
  assert.equal(pipeline.getZones()[0].lowKey, 0);
  assert.equal(pipeline.getZones()[0].highKey, 127);

  // Redo twice -> back to 3 zones
  pipeline.redo();
  assert.equal(pipeline.getZones().length, 2);
  pipeline.redo();
  assert.equal(pipeline.getZones().length, 3);
  assert.equal(pipeline.getZones()[1].id, z2.id);
  assert.equal(pipeline.getZones()[2].id, z3.id);
  console.log('[PASS] 1. Undo/Redo stack across zone splits verified');

  // 3. Verify rapid slider coalescing on updateZone
  const beforeCoalesceCount = pipeline.getHistoryState().undoCount;
  await pipeline.updateZone(z2.id, { detune: 5 });
  await pipeline.updateZone(z2.id, { detune: 12 });
  await pipeline.updateZone(z2.id, { detune: 25 });
  const afterCoalesceCount = pipeline.getHistoryState().undoCount;
  assert.equal(
    afterCoalesceCount,
    beforeCoalesceCount + 1,
    'Rapid consecutive detune updates should coalesce into a single undo entry'
  );
  assert.equal(pipeline.getZones()[1].detune, 25);

  pipeline.undo();
  assert.equal(
    pipeline.getZones()[1].detune,
    0,
    'Single undo after coalesced slider drag should restore initial detune=0'
  );
  console.log('[PASS] 2. Rapid slider coalescing & single-step Undo verified');

  // 4. Verify ProcessConfig validation (11 chars Legacy vs 32 chars Modern, Slot 0..511)
  pipeline.updateProcessConfig({
    modelNumber: 999,
    targetFormat: 'dual',
    modelName: 'SuperLongModelNameForNeuron',
  });
  let cfg = pipeline.getSession()!.processConfig;
  assert.equal(cfg.modelNumber, 511, 'Slot > 511 must clamp to 511');
  assert.equal(
    cfg.modelName,
    'SuperLongMo',
    'Dual/Legacy targetFormat must enforce 11-char hardware MName limit'
  );

  pipeline.updateProcessConfig({
    targetFormat: 'modern-neural',
    modelName: 'SuperLongModelNameForNeuron',
  });
  cfg = pipeline.getSession()!.processConfig;
  assert.equal(
    cfg.modelName,
    'SuperLongModelNameForNeuron',
    'Modern-Neural targetFormat allows up to 32 characters'
  );
  console.log('[PASS] 3. Real-time ProcessConfig slot & name validation verified');

  // 5. Introduce coverage gaps & overlaps and test one-click autoRepairCoverage()
  await pipeline.updateZone(pipeline.getZones()[0].id, {
    lowKey: 12,
    highKey: 55,
    rootKey: 90,
  });
  await pipeline.updateZone(pipeline.getZones()[1].id, {
    lowKey: 50,
    highKey: 65,
    sampleLow: null,
  });
  await pipeline.updateZone(pipeline.getZones()[2].id, {
    lowKey: 80,
    highKey: 120,
  });

  const brokenErrors = pipeline.validateCoverage();
  assert.ok(
    brokenErrors.length >= 4,
    `Expected multiple coverage errors before repair, got ${brokenErrors.length}`
  );

  pipeline.autoRepairCoverage();
  const repairedErrors = pipeline.validateCoverage();
  assert.equal(
    repairedErrors.length,
    0,
    `Expected 0 coverage errors after autoRepairCoverage(), got: ${repairedErrors.join('; ')}`
  );

  const repairedZones = pipeline.getZones();
  assert.equal(repairedZones[0].lowKey, 0);
  assert.equal(repairedZones[repairedZones.length - 1].highKey, 127);
  for (const rz of repairedZones) {
    assert.ok(rz.rootKey >= rz.lowKey && rz.rootKey <= rz.highKey);
    assert.ok(Boolean(rz.sampleLow));
  }

  // Undo auto-repair should restore the broken state
  pipeline.undo();
  assert.ok(pipeline.validateCoverage().length >= 4);
  pipeline.redo();
  assert.equal(pipeline.validateCoverage().length, 0);
  console.log('[PASS] 4. One-click autoRepairCoverage() + Undo/Redo verified');

  // 6. Verify Canonical Hartmann MODELmaker v1.2 ZoneTableModel Formatters & AIFF 44.1kHz/16b Encoder
  assert.equal(midiToNoteName(0), 'C-2');
  assert.equal(midiToNoteName(60), 'C3');
  assert.equal(midiToNoteName(127), 'G8');
  assert.equal(midiNoteToString(0), '0   C-2');
  assert.equal(midiNoteToString(60), '60  C3');
  assert.equal(midiNoteToString(127), '127 G8');
  assert.equal(detuneToString(0), '0');
  assert.equal(detuneToString(-25), '-25');
  assert.equal(detuneToString(14), '+14');
  assert.equal(volumeToLongString(0), '0dB');
  assert.equal(volumeToLongString(-12), '-12dB');
  assert.equal(volumeToLongString(6), '+6dB');
  assert.equal(panToString(0), '0');
  assert.equal(panToString(-50), '-50');
  assert.equal(panToString(32), '+32');

  const testMono = new Float32Array(4410);
  for (let i = 0; i < testMono.length; i++) {
    testMono[i] = Math.sin((2 * Math.PI * 440 * i) / 44100) * 0.5;
  }
  const aiffBuf = encodeAiffPcm16([testMono], 44100, {
    rootKey: 48,
    lowKey: 24,
    highKey: 72,
    lowVelocity: 1,
    highVelocity: 63,
    detune: -5,
    gainDb: -3,
  });
  const decodedAiff = decodeAiff(aiffBuf);
  assert.equal(decodedAiff.sampleRate, 44100);
  assert.equal(decodedAiff.bitsPerSample, 16);
  assert.equal(decodedAiff.numChannels, 1);
  assert.equal(decodedAiff.numSamples, 4410);
  assert.equal(decodedAiff.instrument?.rootKey, 48);
  assert.equal(decodedAiff.instrument?.lowKey, 24);
  assert.equal(decodedAiff.instrument?.highKey, 72);
  assert.equal(decodedAiff.instrument?.lowVelocity, 1);
  assert.equal(decodedAiff.instrument?.highVelocity, 63);
  assert.equal(decodedAiff.instrument?.detune, -5);
  assert.equal(decodedAiff.instrument?.gainDb, -3);
  console.log('[PASS] 5. Canonical ZoneTableModel formatters & AIFF 44.1kHz/16-bit encoder verified');

  pipeline.dispose();
  console.log('=== ALL PHASE 5 TESTS PASSED ===');
}

runPhase5Tests().catch((err) => {
  console.error('Phase 5 test failed:', err);
  process.exit(1);
});
