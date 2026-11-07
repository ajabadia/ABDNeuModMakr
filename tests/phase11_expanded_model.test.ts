// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Phase 11 Expanded Model v2 (Fase 11.5)
//
// Writer `buildAxionikExpandedModel` + preflight
// `preflightExpandedModelForAxionik` + integración en la cápsula
// (`05_extended_model/axionik-expanded.json`) contra el contrato
// `@abdsynths/shared/contracts/axionikExpandedModel.ts`.
// ─────────────────────────────────────────────────────────

import {
  AXIONIK_CLASSIC_ENGINE_PROFILE,
  AXIONIK_PLUS_ENGINE_PROFILE,
  AXIONIK_EXPANDED_ENGINE_PROFILE,
  AXIONIK_CLASSIC_ENHANCED_ENGINE_PROFILE,
  AXIONIK_EXPANDED_V1_ENGINE_PROFILE,
  isAxionikExpandedModel,
  validateModelFormatForMode,
} from '@abdsynths/shared/contracts/axionikExpandedModel.ts';
import {
  buildAxionikExpandedModel,
  deriveResonatorShapersFromDescriptors,
  EXPANDED_MODEL_V2_CAPSULE_PATH,
  preflightExpandedModelForAxionik,
  serializeExpandedModel,
  type AxionikEngineProfile,
  type ExpandedModelWriterInput,
  type ExpandedSpectralSource,
} from '../src/core/expandedModelWriter.ts';
import { webNeuralEngine } from '../src/core/ai/WebNeuralEngine.ts';
import {
  buildTimeCapsuleEntries,
  extractTimeCapsuleFromFiles,
} from '../src/core/timeCapsule.ts';
import type {
  ExtendedRegion,
  ProcessConfig,
  SynthArticulationConfig,
} from '../src/core/types.ts';
import type { AxionikExpandedModel } from '@abdsynths/shared/contracts/axionikExpandedModel.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

/** Fake espectral HD/longitud variable: el writer es length-driven. */
function makeSpectral(partials: number, frames: number): ExpandedSpectralSource {
  const amps: Float32Array[] = [];
  const offs: Float32Array[] = [];
  for (let f = 0; f < frames; f++) {
    const a = new Float32Array(partials);
    const o = new Float32Array(partials);
    for (let i = 0; i < partials; i++) {
      a[i] = 1 / (i + 1);
      o[i] = (i - partials / 2) * 0.5;
    }
    amps.push(a);
    offs.push(o);
  }
  return {
    frameCount: frames,
    frameSpanHz: 55,
    gridFixed: true,
    ampsOf: (f) => amps[Math.min(f, frames - 1)],
    offsetsOf: (f) => offs[Math.min(f, frames - 1)],
    f0At: (f) => (f === 0 ? 0 : 110),
    isLayered: () => false,
    layerCount: 1,
    numFramesOf: () => frames,
    ampsOfLayer: (_l, f) => amps[Math.min(f, frames - 1)],
    offsetsOfLayer: (_l, f) => offs[Math.min(f, frames - 1)],
    f0AtLayer: (_l, f) => (f === 0 ? 0 : 110),
    layerNameAt: () => 'Root',
    layerWeightAt: () => 1,
    frameWeightAt: () => 1,
  };
}

function makeProcessConfig(): ProcessConfig {
  return {
    modelNumber: 7,
    modelName: 'TESTMODEL11',
    complexity: 8,
    parameterSet: 3,
    dspAlgorithm: 'enhanced',
  };
}

function makeArticulation(): SynthArticulationConfig {
  const env = {
    delaySec: 0,
    attackSec: 0.01,
    holdSec: 0,
    decaySec: 0.2,
    sustainLevel: 0.8,
    releaseSec: 0.3,
  };
  const lfo = {
    enabled: false,
    delaySec: 0,
    freqHz: 5,
    toPitchCents: 0,
    toFilterCents: 0,
    toVolumeDb: 0,
  };
  return {
    ampEnvEnabled: true,
    ampEnv: { ...env },
    modEnvEnabled: false,
    modEnv: { ...env },
    modEnvToPitchCents: 0,
    filter: {
      enabled: true,
      type: 'lpf',
      cutoffHz: 8000,
      resonanceDb: 6,
      envToFilterCents: 0,
      velToFilterCents: 0,
      keytrackCents: 600,
    },
    vibLfo: { ...lfo },
    modLfo: { ...lfo },
    polyphony: 16,
    voiceMode: 'poly',
    glideTimeSec: 0,
  };
}

function makeRegion(over: Partial<ExtendedRegion> = {}): ExtendedRegion {
  return {
    id: 'region-0',
    sampleName: 'piano_C4.wav',
    lowKey: 0,
    highKey: 127,
    rootKey: 60,
    lowVel: 1,
    highVel: 127,
    detune: 4,
    volume: -3,
    pan: 50,
    pitchKeytrack: 100,
    trigger: 'attack',
    keyFadeIn: 0,
    keyFadeOut: 0,
    velFadeIn: 0,
    velFadeOut: 0,
    fadeCurve: 'linear',
    loopMode: 'no_loop',
    loopStart: 0,
    loopEnd: 0,
    loopCrossfadeMs: 0,
    ...over,
  };
}

function makeBaseInput(
  over: Partial<ExpandedModelWriterInput> = {}
): ExpandedModelWriterInput {
  return {
    slot: 3,
    modelName: 'TESTMODEL11',
    expandedName: 'Test Model Once',
    processConfig: makeProcessConfig(),
    spectral: makeSpectral(64, 4),
    regions: [makeRegion()],
    articulation: makeArticulation(),
    ...over,
  };
}

const FULL_CAPS_ENGINE: AxionikEngineProfile = {
  generation: 'expanded-v1',
  caps: [
    'hd-spectral',
    'formant-pitch-split',
    'morph-2d',
    'morph-3d',
    'latent-ref',
    'surround',
    'hybrid-transient',
    'filter-v2',
    'fx-v2',
    'ai-provenance',
  ],
  maxPartials: 1024,
  maxFrames: 256,
};

async function runPhase11Tests(): Promise<void> {
  console.log('=== PHASE 11 EXPANDED MODEL V2 TESTS ===');

  // 11.1 Documento clásico-equivalente válido (64 parciales, sin extras).
  {
    const doc = buildAxionikExpandedModel(makeBaseInput());
    assert(isAxionikExpandedModel(doc), '11.1 doc must pass the v2 guard');
    assert(doc.schemaVersion === '2.0.0', '11.1 schemaVersion must be 2.0.0');
    assert(doc.spectral.partialCount === 64, '11.1 partialCount must be 64');
    assert(doc.spectral.frameCount === 4, '11.1 frameCount must be 4');
    assert(
      doc.spectral.frames.length === 4 &&
        doc.spectral.frames[0].amps.length === 64,
      '11.1 frames must carry 64 amps each'
    );
    assert(
      doc.identity.requiredCaps.length === 0,
      `11.1 classic-equivalent doc must require no caps (got ${doc.identity.requiredCaps})`
    );
    assert(
      doc.identity.engineMin === 'expanded',
      '11.1 default engineMin must be expanded-v1'
    );
    assert(doc.identity.modelName === 'TESTMODEL11', '11.1 11-char modelName kept');
    assert(
      typeof doc.identity.slug === 'string' && doc.identity.slug.length > 0,
      '11.1 slug must be non-empty'
    );
    assert(
      doc.regions[0].sampleRef === 'piano_C4.wav',
      '11.1 sampleRef must be the basename'
    );
    assert(doc.regions[0].pan === 1, '11.1 pan +50 must normalize to 1');
    assert(
      doc.articulation.filters[0].type === 'legacy-neuron' &&
        doc.articulation.filters[0].bypass === false,
      '11.1 classic filter must map to a non-bypassed legacy-neuron block'
    );
    assert(
      doc.articulation.fxChain.length === 0,
      '11.1 classic doc must have an empty fxChain'
    );
    const lowPan = buildAxionikExpandedModel(
      makeBaseInput({ regions: [makeRegion({ pan: -50 })] })
    );
    assert(lowPan.regions[0].pan === -1, '11.1 pan -50 must normalize to -1');
    console.log('  [OK] 11.1 classic-equivalent v2 document builds and validates');
  }

  // 11.2 Derivación de caps HD + morph + latent + surround + IA + formante.
  {
    const doc = buildAxionikExpandedModel(
      makeBaseInput({
        spectral: makeSpectral(128, 8),
        pitchTrackHz: [110, 111, 112, 113, 114, 115, 116, 117],
        formantProfileSt: [0, 1, 2, 1, 0, -1, -2, -1],
        morphSpace: {
          dims: 2,
          points: [{ x: 0, y: 0 }],
          latentRef: { dims: 8, codec: 'test-v1', dataRef: 'latent.bin' },
        },
        regions: [makeRegion({ numChannels: 4 })],
        expandedFilters: [
          { id: 'f1', type: 'ladder-v2', cutoffHz: 4000, resonance: 0.4 },
        ],
        expandedFx: [{ id: 'rev', type: 'plate-v2', mix: 0.3 }],
        aiSteps: [
          {
            stage: 'separation',
            provider: 'test-provider',
            model: 'test-model-1',
            params: {},
          },
        ],
        hasHybridTransient: true,
      })
    );
    assert(doc.spectral.partialCount === 128, '11.2 partialCount must be 128');
    assert(doc.analysis.algorithm === 'hd', '11.2 algorithm must be hd');
    for (const cap of [
      'hd-spectral',
      'formant-pitch-split',
      'morph-2d',
      'latent-ref',
      'surround',
      'hybrid-transient',
      'filter-v2',
      'fx-v2',
      'ai-provenance',
    ] as const) {
      assert(
        doc.identity.requiredCaps.includes(cap),
        `11.2 requiredCaps must include ${cap}`
      );
    }
    assert(
      (doc.aiChain?.length ?? 0) === 1,
      '11.2 aiChain must carry the AI step'
    );
    console.log('  [OK] 11.2 full-feature doc derives every requiredCap');
  }

  // 11.3 Preflight OK con motor completo.
  {
    const doc = buildAxionikExpandedModel(
      makeBaseInput({ spectral: makeSpectral(128, 8) })
    );
    const report = preflightExpandedModelForAxionik(doc, FULL_CAPS_ENGINE);
    assert(report.ok, `11.3 preflight must pass (${report.errors})`);
    assert(
      report.missingCaps.length === 0,
      '11.3 no caps may be missing on a full engine'
    );
    console.log('  [OK] 11.3 preflight passes on a full-capability engine');
  }

  // 11.4 Preflight bloquea sin caps (adaptar o bloquear, nunca corromper).
  {
    const doc = buildAxionikExpandedModel(
      makeBaseInput({
        spectral: makeSpectral(128, 8),
        expandedFx: [{ id: 'rev', type: 'plate-v2', mix: 0.3 }],
      })
    );
    const report = preflightExpandedModelForAxionik(doc, {
      generation: 'expanded-v1',
      caps: [],
    });
    assert(!report.ok, '11.4 preflight must fail without caps');
    assert(
      report.missingCaps.includes('hd-spectral') &&
        report.missingCaps.includes('fx-v2'),
      '11.4 missingCaps must list hd-spectral and fx-v2'
    );
    assert(
      report.errors.some((e) => e.startsWith('missing-caps')),
      '11.4 errors must carry the missing-caps block'
    );
    console.log('  [OK] 11.4 preflight blocks on missing caps');
  }

  // 11.5 Motor antiguo: engine-too-old + generación desconocida fallan cerrado.
  {
    const doc = buildAxionikExpandedModel(makeBaseInput());
    const old = preflightExpandedModelForAxionik(doc, {
      generation: 'classic',
      caps: [],
    });
    assert(!old.ok, '11.5 classic engine must fail an expanded-v1 doc');
    assert(
      old.errors.some((e) => e.startsWith('engine-too-old')),
      '11.5 must report engine-too-old'
    );
    const unknown = preflightExpandedModelForAxionik(doc, {
      generation: 'expanded-v9',
      caps: [],
    });
    assert(
      !unknown.ok &&
        unknown.errors.some((e) => e.startsWith('unknown-engine')),
      '11.5 unknown engine generation must fail closed'
    );
    const garbage = preflightExpandedModelForAxionik('{no-json', FULL_CAPS_ENGINE);
    assert(
      !garbage.ok && garbage.errors.some((e) => e.startsWith('invalid-json')),
      '11.5 invalid JSON must fail with invalid-json'
    );
    const notModel = preflightExpandedModelForAxionik(
      '{"schemaVersion":"1.0.0"}',
      FULL_CAPS_ENGINE
    );
    assert(
      !notModel.ok &&
        notModel.errors.some((e) => e.startsWith('not-expanded-model')),
      '11.5 non-v2 document must fail the guard'
    );
    console.log('  [OK] 11.5 old/unknown engines and corrupt docs fail closed');
  }

  // 11.6 Adaptaciones explícitas (resynator + filtro desconocidos).
  {
    const doc = buildAxionikExpandedModel(
      makeBaseInput({
        resynators: [
          { id: 'R1', version: 2, model: 'weird-resonator-3000', params: {} },
        ],
        expandedFilters: [
          { id: 'fx1', type: 'quantum-ladder', cutoffHz: 2000, resonance: 0.2 },
        ],
      })
    );
    const report = preflightExpandedModelForAxionik(doc, {
      generation: 'expanded-v1',
      caps: ['filter-v2'],
    });
    assert(report.ok, `11.6 unknown types must adapt, not block (${report.errors})`);
    assert(
      report.adaptations.some((a) => a.includes("resynator 'R1'")),
      '11.6 must schedule the unknown resynator skip'
    );
    assert(
      report.adaptations.some((a) => a.includes("filter 'fx1'")),
      '11.6 must schedule the unknown filter bypass'
    );
    const truncated = preflightExpandedModelForAxionik(doc, {
      generation: 'expanded-v1',
      caps: ['filter-v2'],
      maxPartials: 32,
    });
    assert(
      truncated.ok &&
        truncated.adaptations.some((a) => a.includes('truncate spectrum')),
      '11.6 HD beyond engine max must adapt via explicit truncation'
    );
    console.log('  [OK] 11.6 degradable mismatches become explicit adaptations');
  }

  // 11.7 Integración en cápsula: capa 05 con y sin v2.
  {
    const doc: AxionikExpandedModel = buildAxionikExpandedModel(makeBaseInput());
    const base = {
      slot: 3,
      modelName: 'TESTMODEL11',
      processConfig: makeProcessConfig(),
      zones: [],
      acousticLines: ['; test'],
      manifestExtra: {},
    };
    const withV2 = buildTimeCapsuleEntries({ ...base, expandedModelV2: doc });
    const v2entry = withV2.entries.find((e) => e.path === EXPANDED_MODEL_V2_CAPSULE_PATH);
    assert(v2entry !== undefined, '11.7 capsule must carry axionik-expanded.json');
    assert(
      isAxionikExpandedModel(JSON.parse(v2entry.data)),
      '11.7 stored v2 JSON must pass the guard'
    );
    const extracted = await extractTimeCapsuleFromFiles(
      withV2.entries.map((e) => ({
        name: e.path,
        data: new TextEncoder().encode(e.data),
      }))
    );
    assert(
      extracted.expandedModelV2Json !== null &&
        isAxionikExpandedModel(JSON.parse(extracted.expandedModelV2Json)),
      '11.7 extractor must round-trip the v2 document'
    );
    const withoutV2 = buildTimeCapsuleEntries(base);
    assert(
      !withoutV2.entries.some((e) => e.path === EXPANDED_MODEL_V2_CAPSULE_PATH),
      '11.7 capsule without v2 must stay byte-identical (no v2 entry)'
    );
    console.log('  [OK] 11.7 capsule carries and round-trips the v2 document');
  }

  // 11.8 Aislamiento de capas: el v2 nunca entra en el parseo clásico.
  {
    const v2doc: AxionikExpandedModel = buildAxionikExpandedModel(makeBaseInput());
    const base = {
      slot: 4,
      modelName: 'TESTMODEL11',
      processConfig: makeProcessConfig(),
      zones: [],
      acousticLines: ['; test'],
      manifestExtra: {},
    };
    const toFiles = (entries: { path: string; data: string }[]) =>
      entries.map((e) => ({
        name: e.path,
        data: new TextEncoder().encode(e.data),
      }));
    const withV2 = await extractTimeCapsuleFromFiles(
      toFiles(buildTimeCapsuleEntries({ ...base, expandedModelV2: v2doc }).entries)
    );
    const withoutV2 = await extractTimeCapsuleFromFiles(
      toFiles(buildTimeCapsuleEntries(base).entries)
    );
    assert(
      withV2.expandedModelV2Json !== null,
      '11.8 extraction must surface the v2 document'
    );
    assert(
      !withV2.classicEnhancedFiles.some((f) =>
        f.name.toLowerCase().includes('axionik-expanded')
      ),
      '11.8 the v2 document must never leak into 04_classic_enhanced files'
    );
    assert(
      !withV2.modelParseFiles.some((f) =>
        f.name.toLowerCase().includes('axionik-expanded')
      ),
      '11.8 modelParseFiles (classic parse) must exclude the v2 document'
    );
    const parseSetOf = (ext: { modelParseFiles: { name: string }[] }) =>
      ext.modelParseFiles
        .map((f) => f.name)
        .sort()
        .join('|');
    assert(
      parseSetOf(withV2) === parseSetOf(withoutV2),
      '11.8 adding the v2 document must not change the classic parse set'
    );
    console.log('  [OK] 11.8 v2 document stays outside the classic layer and parse set');
  }

  // 11.9 Handoff textual: el JSON tal cual sale de la cápsula y se preflightea.
  {
    const doc = buildAxionikExpandedModel(
      makeBaseInput({
        spectral: makeSpectral(128, 8),
        expandedFx: [{ id: 'rev', type: 'plate-v2', mix: 0.3 }],
      })
    );
    const capsule = buildTimeCapsuleEntries({
      slot: 5,
      modelName: 'TESTMODEL11',
      processConfig: makeProcessConfig(),
      zones: [],
      acousticLines: ['; test'],
      manifestExtra: {},
      expandedModelV2: doc,
    });
    const entry = capsule.entries.find(
      (e) => e.path === EXPANDED_MODEL_V2_CAPSULE_PATH
    );
    assert(entry !== undefined, '11.9 capsule must carry the v2 entry');
    const full = preflightExpandedModelForAxionik(entry.data, FULL_CAPS_ENGINE);
    assert(full.ok, `11.9 stored text must preflight on a full engine (${full.errors})`);
    const partial = preflightExpandedModelForAxionik(entry.data, {
      generation: 'expanded-v1',
      caps: ['hd-spectral'],
    });
    assert(
      !partial.ok && partial.missingCaps.includes('fx-v2'),
      '11.9 a partial engine must block the stored text, not the in-memory doc'
    );
    console.log('  [OK] 11.9 stored capsule text preflights without re-serialization');
  }

  // 11.10 Serialización estable.
  {
    const doc = buildAxionikExpandedModel(makeBaseInput());
    const text = serializeExpandedModel(doc);
    assert(
      isAxionikExpandedModel(JSON.parse(text)),
      '11.10 serialized text must re-parse through the guard'
    );
    assert(text.includes('"schemaVersion": "2.0.0"'), '11.10 must pin 2.0.0');
    console.log('  [OK] 11.10 serialize/parse round-trip is stable');
  }

  // 11.11 Multimuestra real (`spectralBySample`), extensiones Loris/DDSP/24-Bark y `hybridTransient`.
  {
    const specC3 = makeSpectral(128, 6);
    const specC5 = makeSpectral(256, 8);
    const doc = buildAxionikExpandedModel(
      makeBaseInput({
        spectral: specC3,
        spectralBySample: {
          'piano_C3.wav': specC3,
          'samples/piano_C5.wav': specC5,
        },
        regions: [
          makeRegion({
            id: 'r-c3',
            sampleName: 'piano_C3.wav',
            lowKey: 36,
            highKey: 59,
            rootKey: 48,
            trigger: 'attack',
            keyFadeOut: 4,
            fadeCurve: 'spectral-morph',
            roundRobinGroup: 'rr-piano',
            roundRobinIndex: 1,
          }),
          makeRegion({
            id: 'r-c5',
            sampleName: 'samples/piano_C5.wav',
            lowKey: 60,
            highKey: 96,
            rootKey: 72,
            trigger: 'release',
            keyFadeIn: 4,
            fadeCurve: 'equal-power',
          }),
        ],
        hasHybridTransient: true,
        populateAdvancedSpectralExtensions: true,
      })
    );
    assert(isAxionikExpandedModel(doc), '11.11 multi-sample doc must pass v2 guard');
    assert(
      doc.spectralBySample !== undefined &&
        doc.spectralBySample['piano_C3.wav']?.partialCount === 128 &&
        doc.spectralBySample['piano_C5.wav']?.partialCount === 256,
      '11.11 spectralBySample must index each sample by basename with its own partialCount'
    );
    const f0 = doc.spectral.frames[0];
    assert(
      Array.isArray(f0.bandwidths) && f0.bandwidths.length === 128,
      '11.11 Loris per-partial bandwidths must match partialCount'
    );
    assert(
      Array.isArray(f0.formantEnvelopeDb) &&
        f0.formantEnvelopeDb.length === 24 &&
        Array.isArray(f0.residualBandsDb) &&
        f0.residualBandsDb.length === 24,
      '11.11 24-Bark formant envelope and DDSP residual must be populated'
    );
    assert(
      Array.isArray(f0.phases) &&
        f0.phases.length === 128 &&
        typeof f0.timeSec === 'number',
      '11.11 splice frame phases and timestamp must be populated'
    );
    assert(
      doc.regions[0].hybridTransient !== undefined &&
        doc.regions[0].hybridTransient.durationMs > 0 &&
        doc.regions[0].hybridTransient.crossfadeMs > 0,
      '11.11 regions must carry hybridTransient splice window'
    );
    assert(
      doc.regions[0].fadeCurve === 'spectral-morph' &&
        doc.regions[0].roundRobinGroup === 'rr-piano' &&
        doc.regions[1].trigger === 'release',
      '11.11 expressive Synth dispatcher parameters must be preserved'
    );
    console.log(
      '  [OK] 11.11 multi-sample spectralBySample, Loris/DDSP/24-Bark extensions, and hybridTransient verified'
    );
  }

  // 11.12 Moldeadores de materia sónica (`shapers`) deterministas + IA (`WebNeuralEngine`).
  {
    const shapers = deriveResonatorShapersFromDescriptors({
      detectedF0Hz: 220,
      detectedMidiNote: 57,
      detectedCentOffset: 0,
      harmonicity: 0.9,
      isPercussiveOrNoise: false,
      attackTimeMs: 18,
      logAttackTime: -1.74,
      spectralCentroidHz: 2400,
      spectralFlatness: 0.08,
      inharmonicityStiffness: 0.00045,
      sustainEnergyRatio: 0.65,
      transientDensity: 1.5,
    });
    assert(
      shapers.inharmonicityB === 0.00045 &&
        typeof shapers.entropyRoughness === 'number' &&
        typeof shapers.hfRollOffDbPerOct === 'number',
      '11.12 deterministic shapers must map inharmonicityB, entropyRoughness, and hfRollOffDbPerOct'
    );

    const sr = 48000;
    const synthPcm = new Float32Array(4096);
    for (let i = 0; i < synthPcm.length; i++) {
      const t = i / sr;
      synthPcm[i] =
        0.6 * Math.sin(2 * Math.PI * 220 * t) +
        0.25 * Math.sin(2 * Math.PI * 440 * t) +
        0.1 * Math.sin(2 * Math.PI * 660 * t);
    }
    const neuralMatter = await webNeuralEngine.estimateResonatorMatter(
      synthPcm,
      sr,
      220
    );
    assert(
      neuralMatter.formantEnvelopeDb.length === 24 &&
        neuralMatter.residualBandsDb.length === 24 &&
        typeof neuralMatter.shapers.parity === 'number',
      '11.12 WebNeuralEngine.estimateResonatorMatter must return 24-Bark formants, DDSP residual, and shapers'
    );
    console.log(
      '  [OK] 11.12 deterministic and WebNeuralEngine Resonator v2 shapers & DDSP envelopes verified'
    );
  }

  // 11.13 Tres modos canónicos (`classic`, `plus`, `expanded`), Drag & Drop por modo y adaptación espacial dual.
  {
    assert(
      AXIONIK_CLASSIC_ENGINE_PROFILE.generation === 'classic' &&
        AXIONIK_PLUS_ENGINE_PROFILE.generation === 'plus' &&
        AXIONIK_EXPANDED_ENGINE_PROFILE.generation === 'expanded' &&
        AXIONIK_CLASSIC_ENHANCED_ENGINE_PROFILE.generation === 'plus' &&
        AXIONIK_EXPANDED_V1_ENGINE_PROFILE.generation === 'expanded',
      '11.13 canonical 3-mode profiles (classic, plus, expanded) must be exported from ABDShared'
    );
    assert(
      validateModelFormatForMode('classic', 'classic').allowed &&
        validateModelFormatForMode('plus', 'plus').allowed &&
        validateModelFormatForMode('expanded', 'expanded').allowed &&
        !validateModelFormatForMode('classic', 'expanded').allowed &&
        !validateModelFormatForMode('plus', 'expanded').allowed &&
        !validateModelFormatForMode('expanded', 'classic').allowed &&
        !validateModelFormatForMode('expanded', 'plus').allowed,
      '11.13 each mode/Resynator must admit only its own model format and reject all others'
    );
    const classicDocOnExpanded = preflightExpandedModelForAxionik(
      buildAxionikExpandedModel(makeBaseInput({ engineMin: 'classic' })),
      AXIONIK_EXPANDED_ENGINE_PROFILE
    );
    assert(
      !classicDocOnExpanded.ok &&
        classicDocOnExpanded.errors.some((e) =>
          e.startsWith('mode-format-mismatch')
        ),
      '11.13 expanded engine must reject a classic-targeted document with mode-format-mismatch'
    );
    const quadDoc = buildAxionikExpandedModel(
      makeBaseInput({
        regions: [makeRegion({ numChannels: 4 })],
      })
    );
    const stereoHostReport = preflightExpandedModelForAxionik(
      quadDoc,
      AXIONIK_EXPANDED_ENGINE_PROFILE
    );
    assert(
      stereoHostReport.ok &&
        stereoHostReport.adaptations.some((a) =>
          a.includes(
            'spatial-downmix: render 4.0 Scape/Sphere via stereo Pseudo-Surround'
          )
        ),
      '11.13 Quad 4.0 model on stereo/WASM host must succeed with explicit Pseudo-Surround adaptation'
    );
    const discreteQuadReport = preflightExpandedModelForAxionik(quadDoc, {
      ...AXIONIK_EXPANDED_ENGINE_PROFILE,
      spatialOutputMode: 'discrete-quad',
    });
    assert(
      discreteQuadReport.ok &&
        !discreteQuadReport.adaptations.some((a) =>
          a.includes('spatial-downmix')
        ),
      '11.13 Quad 4.0 model on discrete-quad bus renders natively without downmix adaptation'
    );
    console.log(
      '  [OK] 11.13 3 canonical modes (classic, plus, expanded), strict Drag & Drop format rule, and dual Surround/Pseudo-Surround verified'
    );
  }

  console.log('=== ALL PHASE 11 EXPANDED MODEL TESTS PASSED ===');
}

runPhase11Tests().catch((err) => {
  console.error(err);
  process.exit(1);
});
