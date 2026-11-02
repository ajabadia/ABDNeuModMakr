// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Phase 11 Expanded Model v2 (Fase 11.5)
//
// Writer `buildAxionikExpandedModel` + preflight
// `preflightExpandedModelForAxionik` + integración en la cápsula
// (`05_extended_model/axionik-expanded.json`) contra el contrato
// `@abdsynths/shared/contracts/axionikExpandedModel.ts`.
// ─────────────────────────────────────────────────────────

import { isAxionikExpandedModel } from '@abdsynths/shared/contracts/axionikExpandedModel.ts';
import {
  buildAxionikExpandedModel,
  EXPANDED_MODEL_V2_CAPSULE_PATH,
  preflightExpandedModelForAxionik,
  serializeExpandedModel,
  type AxionikEngineProfile,
  type ExpandedModelWriterInput,
  type ExpandedSpectralSource,
} from '../src/core/expandedModelWriter.ts';
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
      doc.identity.engineMin === 'expanded-v1',
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
    const extracted = extractTimeCapsuleFromFiles(
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

  // 11.8 Serialización estable.
  {
    const doc = buildAxionikExpandedModel(makeBaseInput());
    const text = serializeExpandedModel(doc);
    assert(
      isAxionikExpandedModel(JSON.parse(text)),
      '11.8 serialized text must re-parse through the guard'
    );
    assert(text.includes('"schemaVersion": "2.0.0"'), '11.8 must pin 2.0.0');
    console.log('  [OK] 11.8 serialize/parse round-trip is stable');
  }

  console.log('=== ALL PHASE 11 EXPANDED MODEL TESTS PASSED ===');
}

runPhase11Tests().catch((err) => {
  console.error(err);
  process.exit(1);
});
