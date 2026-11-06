// ─────────────────────────────────────────────────────────────
// ABDNeuModMakr — Fase 38: Unified Continuous Spectral Surface Tests
// Verifies:
//   1. Topology detection: Piano / Tuned Percussive Bottles (`melodic_surface`)
//      vs Unpitched Bottle Collection / Drum Kit (`drum_kit_surface`).
//   2. Content-adaptive resolution sizing (`compact`, `standard`, `hd`, `ultra-hd`)
//      and manual complexity levels (1..10).
//   3. Detuned oscillator beating / PWM modulation extraction & bilinear interpolation.
//   4. Attack shortening (`attackShorten01`) and infinite release extension (`releaseExtendSec`).
//   5. Single-file `AxionikExpandedModel` integration (`unifiedSurface`).
// ─────────────────────────────────────────────────────────────

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildUnifiedSpectralSurface,
  detectSurfaceTopology,
  evaluateUnifiedSpectralSurface,
  extractModulationProfile,
  resolveAdaptiveSurfaceResolution,
} from '../src/core/dsp/UnifiedSpectralSurface.ts';
import {
  buildAxionikExpandedModel,
  type ExpandedSpectralSource,
} from '../src/core/expandedModelWriter.ts';
import {
  EXPECTED_RESYNATOR_ABI,
  fnv1aHex,
  renderResynatorWasm,
} from '../src/core/dsp/ResynatorV2Wasm.ts';
import { analyzeImportPreflight } from '../src/core/import/importPreflight.ts';
import { midiNoteToHz } from '../src/core/dsp/WavDecoder.ts';
import type {
  AxionikRegion,
  AxionikSpectralFrame,
  AxionikSpectralModel,
} from '@abdsynths/shared/contracts/axionikExpandedModel.ts';

function makeSyntheticSpectralModel(options: {
  f0Hz: number;
  partialCount?: number;
  frameCount?: number;
  brightHarmonics?: number;
  beatingRateHz?: number;
  beatingDepth?: number;
  slowAttack?: boolean;
  formantPeakBark?: number;
}): AxionikSpectralModel {
  const partialCount = options.partialCount ?? 64;
  const frameCount = options.frameCount ?? 32;
  const brightHarmonics = options.brightHarmonics ?? 24;
  const beatingRate = options.beatingRateHz ?? 0;
  const beatingDepth = options.beatingDepth ?? 0;
  const peakBark = options.formantPeakBark ?? 8;

  const frames: AxionikSpectralFrame[] = [];
  for (let t = 0; t < frameCount; t++) {
    const timeSec = t * 0.04;
    const env = options.slowAttack
      ? Math.min(1, t / Math.max(1, frameCount * 0.45))
      : t === 0
        ? 0.4
        : Math.exp(-t * 0.03);
    const beatMod =
      beatingRate > 0 ? 1 + beatingDepth * Math.sin(2 * Math.PI * beatingRate * timeSec) : 1;

    const amps = new Array<number>(partialCount).fill(0);
    const offsets = new Array<number>(partialCount).fill(0);
    const bandwidths = new Array<number>(partialCount).fill(0.03);

    for (let k = 0; k < Math.min(partialCount, brightHarmonics); k++) {
      amps[k] = (0.5 / Math.pow(k + 1, 0.85)) * env * beatMod;
    }

    const formantEnvelopeDb = new Array<number>(24).fill(-45);
    for (let b = 0; b < 24; b++) {
      formantEnvelopeDb[b] = -12 - Math.abs(b - peakBark) * 2.5;
    }
    const residualBandsDb = new Array<number>(24).fill(-68);

    frames.push({
      amps,
      offsets,
      f0Hz: options.f0Hz,
      timeSec,
      bandwidths,
      formantEnvelopeDb,
      residualBandsDb,
    });
  }

  return {
    partialCount,
    frameCount,
    frames,
  };
}

console.log('\nFase 38 — Unified Continuous Spectral Surface Verification\n');

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}: ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

// 1. Topology Detection: Tuned Percussive Bottles vs Unpitched Bottles vs Drum Map
test('detectSurfaceTopology distinguishes tuned bottles/piano (melodic_surface) from chaotic bottles & drum kits (drum_kit_surface)', () => {
  // Case A: Tuned percussive bottles (C3, E3, G3, C4 — ascending F0 & consistent glass formant around Bark 10)
  const tunedRegions: AxionikRegion[] = [
    { id: 'r1', sampleRef: 'bottle_1.wav', lowKey: 48, highKey: 51, rootKey: 48, lowVel: 1, highVel: 127 },
    { id: 'r2', sampleRef: 'bottle_2.wav', lowKey: 52, highKey: 54, rootKey: 52, lowVel: 1, highVel: 127 },
    { id: 'r3', sampleRef: 'bottle_3.wav', lowKey: 55, highKey: 59, rootKey: 55, lowVel: 1, highVel: 127 },
    { id: 'r4', sampleRef: 'bottle_4.wav', lowKey: 60, highKey: 64, rootKey: 60, lowVel: 1, highVel: 127 },
  ];
  const tunedSpectrals: Record<string, AxionikSpectralModel> = {
    'bottle_1.wav': makeSyntheticSpectralModel({ f0Hz: midiNoteToHz(48), formantPeakBark: 10 }),
    'bottle_2.wav': makeSyntheticSpectralModel({ f0Hz: midiNoteToHz(52), formantPeakBark: 10 }),
    'bottle_3.wav': makeSyntheticSpectralModel({ f0Hz: midiNoteToHz(55), formantPeakBark: 10 }),
    'bottle_4.wav': makeSyntheticSpectralModel({ f0Hz: midiNoteToHz(60), formantPeakBark: 10 }),
  };

  const tunedResult = detectSurfaceTopology(
    tunedRegions,
    tunedSpectrals['bottle_1.wav'],
    tunedSpectrals,
    'Chromatic Percussion'
  );
  assert.equal(tunedResult.topology, 'melodic_surface');
  assert.ok(tunedResult.pitchMonotonicityScore >= 0.9, 'Tuned bottles must have high pitch monotonicity');

  // Case B: Collection of unpitched / random bottle strikes on adjacent keys (non-monotonic F0)
  const chaoticRegions: AxionikRegion[] = [
    { id: 'c1', sampleRef: 'glass_jug_low.wav', lowKey: 36, highKey: 36, rootKey: 36, lowVel: 1, highVel: 127 },
    { id: 'c2', sampleRef: 'cap_clink_high.wav', lowKey: 37, highKey: 37, rootKey: 37, lowVel: 1, highVel: 127 },
    { id: 'c3', sampleRef: 'bottle_neck_mid.wav', lowKey: 38, highKey: 38, rootKey: 38, lowVel: 1, highVel: 127 },
    { id: 'c4', sampleRef: 'crate_thud.wav', lowKey: 39, highKey: 39, rootKey: 39, lowVel: 1, highVel: 127 },
  ];
  const chaoticSpectrals: Record<string, AxionikSpectralModel> = {
    'glass_jug_low.wav': makeSyntheticSpectralModel({ f0Hz: 75, formantPeakBark: 3 }),
    'cap_clink_high.wav': makeSyntheticSpectralModel({ f0Hz: 2400, formantPeakBark: 19 }),
    'bottle_neck_mid.wav': makeSyntheticSpectralModel({ f0Hz: 310, formantPeakBark: 11 }),
    'crate_thud.wav': makeSyntheticSpectralModel({ f0Hz: 92, formantPeakBark: 4 }),
  };

  const chaoticResult = detectSurfaceTopology(
    chaoticRegions,
    chaoticSpectrals['glass_jug_low.wav'],
    chaoticSpectrals
  );
  assert.equal(
    chaoticResult.topology,
    'drum_kit_surface',
    'Non-monotonic collection of percussive objects must use drum_kit_surface so adjacent keys are not pitch-blended'
  );
});

// 2. Adaptive Resolution Sizing
test('resolveAdaptiveSurfaceResolution scales from compact (32p) to ultra-hd (256p) based on harmonic density', () => {
  const simpleFlute = makeSyntheticSpectralModel({ f0Hz: 523.25, partialCount: 32, brightHarmonics: 10, frameCount: 16 });
  const compactRes = resolveAdaptiveSurfaceResolution([simpleFlute], { strategy: 'auto' });
  assert.equal(compactRes.tier, 'compact');
  assert.equal(compactRes.partialCount, 32);

  const deepGrandPiano = makeSyntheticSpectralModel({ f0Hz: 32.7, partialCount: 256, brightHarmonics: 180, frameCount: 64 });
  const ultraRes = resolveAdaptiveSurfaceResolution([deepGrandPiano], { strategy: 'auto' });
  assert.equal(ultraRes.tier, 'ultra-hd');
  assert.equal(ultraRes.partialCount, 256);

  const manualRes = resolveAdaptiveSurfaceResolution([simpleFlute], { strategy: 'manual', complexity: 8 });
  assert.equal(manualRes.tier, 'hd');
  assert.equal(manualRes.partialCount, 128);
});

// 3. Detuned Oscillators / Beating Modulation Preservation
test('extractModulationProfile captures unison oscillator beating rate & depth without phase cancellation', () => {
  const detunedSaw = makeSyntheticSpectralModel({
    f0Hz: 220,
    partialCount: 64,
    frameCount: 48,
    brightHarmonics: 40,
    beatingRateHz: 2.5,
    beatingDepth: 0.35,
  });

  const mod = extractModulationProfile(detunedSaw.frames);
  assert.ok(mod.modulationDepth > 0.15, `Expected non-zero modulationDepth, got ${mod.modulationDepth}`);
  assert.ok(mod.modulationRateHz >= 1.5 && mod.modulationRateHz <= 4.0, `Expected ~2.5Hz rate, got ${mod.modulationRateHz}`);
  assert.ok(mod.estimatedDetuneCents > 0, 'Must estimate unison detune spread in cents');
});

// 4. Slow Attack Shortening & Cut-Off Release Extension
test('evaluateUnifiedSpectralSurface shortens slow pad attacks and extends cut-off releases naturally', () => {
  const slowPadModel = makeSyntheticSpectralModel({
    f0Hz: 261.63,
    partialCount: 64,
    frameCount: 40,
    brightHarmonics: 32,
    slowAttack: true,
  });
  const regions: AxionikRegion[] = [
    { id: 'pad_c4_soft', sampleRef: 'pad_soft.wav', lowKey: 48, highKey: 72, rootKey: 60, lowVel: 1, highVel: 64 },
    { id: 'pad_c4_loud', sampleRef: 'pad_loud.wav', lowKey: 48, highKey: 72, rootKey: 60, lowVel: 65, highVel: 127 },
  ];
  const surface = buildUnifiedSpectralSurface({
    regions,
    primarySpectral: slowPadModel,
    spectralBySample: {
      'pad_soft.wav': slowPadModel,
      'pad_loud.wav': slowPadModel,
    },
  });

  // Normal attack (attackShorten01 = 0) vs shortened instant attack (attackShorten01 = 1)
  const normalEval = evaluateUnifiedSpectralSurface(surface, {
    midiNote: 60,
    velocity: 90,
    attackShorten01: 0,
  });
  const instantEval = evaluateUnifiedSpectralSurface(surface, {
    midiNote: 60,
    velocity: 90,
    attackShorten01: 1.0,
    releaseExtendSec: 2.0,
  });

  assert.equal(normalEval.startFrameIndex, 0);
  assert.equal(
    instantEval.startFrameIndex,
    surface.canonicalAttackPeakFrame,
    'attackShorten01=1 must jump directly to canonicalAttackPeakFrame'
  );
  assert.ok(
    instantEval.frameCount > normalEval.frameCount,
    'releaseExtendSec=2.0 must synthesize additional decaying release frames'
  );
});

// 5. Single-file AxionikExpandedModel integration
test('buildAxionikExpandedModel embeds unifiedSurface inside the single expanded model document', () => {
  const c3Model = makeSyntheticSpectralModel({ f0Hz: midiNoteToHz(48), partialCount: 64, frameCount: 24 });
  const c4Model = makeSyntheticSpectralModel({ f0Hz: midiNoteToHz(60), partialCount: 64, frameCount: 24 });

  const expandedDoc = buildAxionikExpandedModel({
    slot: 0,
    modelName: 'UnifiedPno',
    processConfig: {
      slot: 0,
      modelName: 'UnifiedPno',
      parameterSet: 0,
      complexity: 8,
      workingMode: 'extended',
    },
    spectral: {
      frameCount: c3Model.frameCount,
      frameSpanHz: 130.8,
      gridFixed: true,
      ampsOf: (f) => new Float32Array(c3Model.frames[f].amps),
      offsetsOf: (f) => new Float32Array(c3Model.frames[f].offsets),
      f0At: (f) => c3Model.frames[f].f0Hz ?? 130.8,
      isLayered: () => false,
      layerCount: 1,
      numFramesOf: () => c3Model.frameCount,
      ampsOfLayer: (_l, f) => new Float32Array(c3Model.frames[f].amps),
      offsetsOfLayer: (_l, f) => new Float32Array(c3Model.frames[f].offsets),
      f0AtLayer: (_l, f) => c3Model.frames[f].f0Hz ?? 130.8,
      layerNameAt: () => 'Base',
      layerWeightAt: () => 1,
      frameWeightAt: () => 1,
    },
    regions: [
      {
        id: 'r1',
        sampleName: 'pno_c3.wav',
        lowKey: 36,
        highKey: 54,
        rootKey: 48,
        lowVel: 1,
        highVel: 127,
        detuneCents: 0,
        volumeDb: 0,
        pan: 0,
        pitchKeytrack: 100,
        loopMode: 'no_loop',
        loopStart: 0,
        loopEnd: 0,
        loopCrossfadeMs: 0,
        sampleRate: 44100,
        numChannels: 1,
        hasArticulationOverride: false,
      },
      {
        id: 'r2',
        sampleName: 'pno_c4.wav',
        lowKey: 55,
        highKey: 84,
        rootKey: 60,
        lowVel: 1,
        highVel: 127,
        detuneCents: 0,
        volumeDb: 0,
        pan: 0,
        pitchKeytrack: 100,
        loopMode: 'no_loop',
        loopStart: 0,
        loopEnd: 0,
        loopCrossfadeMs: 0,
        sampleRate: 44100,
        numChannels: 1,
        hasArticulationOverride: false,
      },
    ],
    populateAdvancedSpectralExtensions: true,
    buildUnifiedSurface: true,
  });

  assert.ok(expandedDoc.unifiedSurface, 'Expanded model must include unifiedSurface');
  assert.equal(expandedDoc.unifiedSurface?.topology, 'melodic_surface');
  assert.equal(expandedDoc.unifiedSurface?.nodes.length, 2);
});

// 6. Accidental Intruder Sample Detection & Automatic Isolation
test('buildUnifiedSpectralSurface detects an accidental sample from another instrument (timbral outlier) and isolates it during interpolation', () => {
  // 4 Piano samples (formant peak at Bark 6, warm body) + 1 accidental Trumpet/Snare intruder at F3 (key 53, formant peak at Bark 19 + noisy bandwidth)
  const pianoC3 = makeSyntheticSpectralModel({ f0Hz: midiNoteToHz(48), formantPeakBark: 6 });
  const pianoD3 = makeSyntheticSpectralModel({ f0Hz: midiNoteToHz(50), formantPeakBark: 6 });
  const pianoA3 = makeSyntheticSpectralModel({ f0Hz: midiNoteToHz(57), formantPeakBark: 6 });
  const pianoC4 = makeSyntheticSpectralModel({ f0Hz: midiNoteToHz(60), formantPeakBark: 6 });

  const intruderF3 = makeSyntheticSpectralModel({ f0Hz: midiNoteToHz(53), formantPeakBark: 20 });
  for (const fr of intruderF3.frames) {
    fr.bandwidths = fr.bandwidths?.map(() => 0.85);
    fr.formantEnvelopeDb = fr.formantEnvelopeDb?.map((_, b) => (b >= 18 ? -2 : -75));
  }

  const regions: AxionikRegion[] = [
    { id: 'p1', sampleRef: 'Piano_C3.wav', lowKey: 48, highKey: 49, rootKey: 48, lowVel: 1, highVel: 127 },
    { id: 'p2', sampleRef: 'Piano_D3.wav', lowKey: 50, highKey: 52, rootKey: 50, lowVel: 1, highVel: 127 },
    { id: 'intruder', sampleRef: 'Trumpet_F3.wav', lowKey: 53, highKey: 55, rootKey: 53, lowVel: 1, highVel: 127 },
    { id: 'p3', sampleRef: 'Piano_A3.wav', lowKey: 56, highKey: 58, rootKey: 57, lowVel: 1, highVel: 127 },
    { id: 'p4', sampleRef: 'Piano_C4.wav', lowKey: 59, highKey: 64, rootKey: 60, lowVel: 1, highVel: 127 },
  ];

  const surface = buildUnifiedSpectralSurface({
    regions,
    primarySpectral: pianoC3,
    spectralBySample: {
      'Piano_C3.wav': pianoC3,
      'Piano_D3.wav': pianoD3,
      'Trumpet_F3.wav': intruderF3,
      'Piano_A3.wav': pianoA3,
      'Piano_C4.wav': pianoC4,
    },
  });

  assert.ok(
    surface.outlierNodeIds?.includes('Trumpet_F3.wav'),
    `Expected Trumpet_F3.wav to be flagged in outlierNodeIds, got ${JSON.stringify(surface.outlierNodeIds)}`
  );

  // When playing F3 (midiNote 53) with default settings, the intruder is bypassed and interpolated from Piano_D3..Piano_A3
  const cleanEvalAtF3 = evaluateUnifiedSpectralSurface(surface, { midiNote: 53, velocity: 100 });
  const avgBandwidthClean =
    cleanEvalAtF3.frames[0].bandwidths!.reduce((a, b) => a + b, 0) / cleanEvalAtF3.frames[0].bandwidths!.length;
  assert.ok(avgBandwidthClean < 0.1, `Default evaluation must bypass noisy intruder (got bw=${avgBandwidthClean})`);

  // When explicitly setting includeOutliers: true, the intruder's timbre is included
  const rawEvalAtF3 = evaluateUnifiedSpectralSurface(surface, {
    midiNote: 53,
    velocity: 100,
    includeOutliers: true,
  });
  const avgBandwidthRaw =
    rawEvalAtF3.frames[0].bandwidths!.reduce((a, b) => a + b, 0) / rawEvalAtF3.frames[0].bandwidths!.length;
  assert.ok(avgBandwidthRaw > 0.5, `includeOutliers=true must evaluate the intruder node (got bw=${avgBandwidthRaw})`);
});

// 7. Preflight Mode-Aware Continuous Coverage & Intruder Sample Warning
test('analyzeImportPreflight reports continuous surface calibration in Extended mode and warns on intruder sample names', () => {
  const report = analyzeImportPreflight(
    {
      presetName: 'Grand Piano Set',
      modelName: 'GrandPiano',
      format: 'sfz',
      formatLabel: 'SFZ Instrument',
      detectedCategory: 'Piano',
      suggestedParameterSet: 0,
      isSliceChain: false,
      isEncrypted: false,
      audioBuffers: new Map([
        ['Piano_C2.wav', new ArrayBuffer(64)],
        ['Piano_C3.wav', new ArrayBuffer(64)],
        ['Piano_C4.wav', new ArrayBuffer(64)],
        ['Piano_C5.wav', new ArrayBuffer(64)],
        ['Snare_D3.wav', new ArrayBuffer(64)],
      ]),
      regions: [
        { sampleName: 'Piano_C2.wav', lowKey: 36, highKey: 36, rootKey: 36, lowVel: 1, highVel: 127, tuneCents: 0, volumeDb: 0, pan: 0, loopMode: 'no_loop', loopStart: 0, loopEnd: 0 },
        { sampleName: 'Piano_C3.wav', lowKey: 48, highKey: 48, rootKey: 48, lowVel: 1, highVel: 127, tuneCents: 0, volumeDb: 0, pan: 0, loopMode: 'no_loop', loopStart: 0, loopEnd: 0 },
        { sampleName: 'Piano_C4.wav', lowKey: 60, highKey: 60, rootKey: 60, lowVel: 1, highVel: 127, tuneCents: 0, volumeDb: 0, loopMode: 'no_loop', pan: 0, loopStart: 0, loopEnd: 0 },
        { sampleName: 'Piano_C5.wav', lowKey: 72, highKey: 72, rootKey: 72, lowVel: 1, highVel: 127, tuneCents: 0, volumeDb: 0, pan: 0, loopMode: 'no_loop', loopStart: 0, loopEnd: 0 },
        { sampleName: 'Snare_D3.wav', lowKey: 50, highKey: 50, rootKey: 50, lowVel: 1, highVel: 127, tuneCents: 0, volumeDb: 0, pan: 0, loopMode: 'no_loop', loopStart: 0, loopEnd: 0 },
      ],
    },
    'extended'
  );

  const coverageIssue = report.issues.find((i) => i.code === 'WARN_KEYBED_GAPS');
  assert.ok(coverageIssue, 'Should include coverage info item');
  assert.equal(coverageIssue?.severity, 'info', 'In extended mode, coverage gaps are info-only');
  assert.ok(
    coverageIssue?.title.includes('Superficie Espectral Continua'),
    'Extended mode message must explain that only (Nota, Velocidad) points are needed'
  );

  const intruderIssue = report.issues.find((i) => i.code === 'WARN_INTRUDER_SAMPLE');
  assert.ok(intruderIssue, 'Must detect Snare_D3.wav as a likely intruder sample inside the Piano set');
});

// 8. TempoSync Contract Persistence & Host BPM Time-Scaling (Resinator v2 Contract)
test('buildUnifiedSpectralSurface persists tempoSync contract and evaluateUnifiedSpectralSurface scales frame timeSec with hostBpm without shifting pitch', () => {
  const loopSpectral = makeSyntheticSpectralModel({ f0Hz: 220, partialCount: 64, frameCount: 32 });
  const regions: AxionikRegion[] = [
    { id: 'loop_1', sampleRef: 'AcidLoop_120.wav', lowKey: 36, highKey: 96, rootKey: 60, lowVel: 1, highVel: 127 },
  ];

  const surface = buildUnifiedSpectralSurface({
    regions,
    primarySpectral: loopSpectral,
    spectralBySample: { 'AcidLoop_120.wav': loopSpectral },
    tempoSync: {
      enabled: true,
      sourceBpm: 120,
      targetBpm: 120,
      barCount: 2,
      timeSignature: [4, 4],
      grooveMode: 'continuous_loop',
      sliceCount: 8,
    },
  });

  assert.ok(surface.tempoSync, 'Surface must persist tempoSync metadata');
  assert.equal(surface.tempoSync?.enabled, true);
  assert.equal(surface.tempoSync?.sourceBpm, 120);
  assert.equal(surface.tempoSync?.barCount, 2);

  const eval120 = evaluateUnifiedSpectralSurface(surface, { midiNote: 60, velocity: 100, hostBpm: 120 });
  const eval150 = evaluateUnifiedSpectralSurface(surface, { midiNote: 60, velocity: 100, hostBpm: 150 });

  assert.equal(eval120.tempoScaleFactor, 1);
  assert.ok(Math.abs((eval150.tempoScaleFactor ?? 1) - 150 / 120) < 1e-4, '150 BPM host has tempoScaleFactor = 150/120 = 1.25');
  assert.equal(eval120.targetF0Hz, eval150.targetF0Hz, 'Host BPM scaling must never shift pitch (targetF0Hz)');
  const lastIdx = eval120.frames.length - 1;
  assert.ok(
    Math.abs((eval150.frames[lastIdx].timeSec ?? 0) - (eval120.frames[lastIdx].timeSec ?? 0) * (120 / 150)) < 1e-3,
    'Frame timestamps must scale proportionally to sourceBpm / hostBpm (0.8x)'
  );
});


// 9. Resynator v2 motor (WASM): el documento sintético suena en el motor real.
// Sin artefacto compilado se OMITE (checkout fresco); con artefacto debe ser
// finito y no silencioso. (Sin assert de determinismo entre renders: el motor
// mezcla ruido con semilla fija por instancia —entre procesos es bit-idéntico,
// que es lo que sella el test de paridad— pero dos renders en la misma sesión
// consumen el stream y difieren. Comportamiento del motor, no del binding.)
async function runWasmEngineTest(): Promise<void> {
  const name = 'motor Resynator v2 (WASM) renderiza documento sintético: finito y no silencioso';
  const here = path.dirname(fileURLToPath(import.meta.url));
  const artifact = path.resolve(
    here,
    '..',
    'public/wasm',
    `resynator-v2-abi${EXPECTED_RESYNATOR_ABI}.js`
  );
  if (!existsSync(artifact)) {
    console.log(`  [SKIP] ${name} (artefacto ausente; compilar con build-resynator-wasm.bat)`);
    return;
  }
  try {
    const model = makeSyntheticSpectralModel({ f0Hz: 261.63, partialCount: 64, frameCount: 24 });
    const source: ExpandedSpectralSource = {
      frameCount: model.frameCount,
      frameSpanHz: 50,
      gridFixed: true,
      ampsOf: (f) => new Float32Array(model.frames[f].amps),
      offsetsOf: (f) => new Float32Array(model.frames[f].offsets),
      f0At: (f) => model.frames[f].f0Hz ?? 261.63,
      isLayered: () => false,
      layerCount: 0,
      numFramesOf: () => 0,
      ampsOfLayer: () => new Float32Array(0),
      offsetsOfLayer: () => new Float32Array(0),
      f0AtLayer: () => 0,
      layerNameAt: () => '',
      layerWeightAt: () => 0,
      frameWeightAt: () => 0,
    };
    const doc = buildAxionikExpandedModel({
      slot: 0,
      modelName: 'WasmProbe',
      processConfig: {
        slot: 0,
        modelName: 'WasmProbe',
        parameterSet: 0,
        complexity: 8,
        workingMode: 'extended',
      },
      spectral: source,
      spectralBySample: { 'bell_c4.wav': source },
      regions: [
        {
          id: 'r1',
          sampleName: 'bell_c4.wav',
          lowKey: 36,
          highKey: 84,
          rootKey: 60,
          lowVel: 1,
          highVel: 127,
          detune: 0,
          volume: 0,
          pan: 0,
          pitchKeytrack: 100,
          trigger: 'attack',
          keyFadeIn: 0,
          keyFadeOut: 0,
          velFadeIn: 0,
          velFadeOut: 0,
          fadeCurve: 'equal-power',
          loopMode: 'no_loop',
          loopStart: 0,
          loopEnd: 0,
          loopCrossfadeMs: 0,
          sampleRate: 22050,
        },
      ],
      populateAdvancedSpectralExtensions: true,
      buildUnifiedSurface: true,
    });
    const modelJson = JSON.stringify(doc);
    const renderOnce = (): Promise<{ stereoL: Float32Array; stereoR: Float32Array }> =>
      renderResynatorWasm({
        modelJson,
        midiNote: 60,
        velocity01: 100 / 127,
        seconds: 0.5,
        sampleRate: 22050,
        urlOverride: pathToFileURL(artifact).href,
      });
    const hashOf = (s: { stereoL: Float32Array; stereoR: Float32Array }): string => {
      const interleaved = new Float32Array(s.stereoL.length * 2);
      for (let i = 0; i < s.stereoL.length; i++) {
        interleaved[2 * i] = s.stereoL[i];
        interleaved[2 * i + 1] = s.stereoR[i];
      }
      return fnv1aHex(new Uint8Array(interleaved.buffer));
    };
    const first = await renderOnce();
    let peak = 0;
    for (let i = 0; i < first.stereoL.length; i++) {
      const l = first.stereoL[i];
      const r = first.stereoR[i];
      assert.ok(Number.isFinite(l) && Number.isFinite(r), 'el motor debe renderizar muestras finitas');
      const a = Math.abs(l) > Math.abs(r) ? Math.abs(l) : Math.abs(r);
      if (a > peak) peak = a;
    }
    assert.ok(peak > 1e-4, `el motor debe sonar (peak=${peak})`);
    console.log(`  [PASS] ${name} (peak=${peak.toFixed(6)} fnv1a=${hashOf(first)})`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}: ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

await runWasmEngineTest();

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
