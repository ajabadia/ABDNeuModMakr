// ─────────────────────────────────────────────────────────
// tests/phase46_ai_honesty_and_audio.test.ts
// Verification suite for Fase 46: Audio Quality Fixes, Honest AI Badges,
// Cloud BYOK Structured Mode, and Python MODEL_REGISTRY Pruning.
// ─────────────────────────────────────────────────────────

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { webNeuralEngine } from '../src/core/ai/WebNeuralEngine.ts';
import {
  classifyAcousticInstrument,
  extractAcousticDescriptors,
} from '../src/core/dsp/AcousticIntelligence.ts';
import { SpectralAnalyzer } from '../src/core/dsp/SpectralAnalyzer.ts';
import { encodeWavPcm24, decodeWav } from '../src/core/dsp/WavDecoder.ts';
import {
  executeCanonicalPhase1SampleConditioning,
  createDefaultPipelineChecklistSelection,
} from '../src/core/dsp/PipelineConditioningSteps.ts';
import { resolvePipelineStepExecutionBadge } from '../src/core/ai/honesty/stepBadges.ts';
import { resolveAiActionDeclaration } from '../src/core/ai/honesty/actionDeclarations.ts';
import { parseJsonObjectSafe } from '../src/core/ai/CloudByokClient.ts';
import { DEFAULT_AI_ASSISTANCE_CONFIG } from '../src/core/types.ts';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    console.error(err);
    failed++;
  }
}

async function run(): Promise<void> {
  console.log('Phase 46 — AI Honesty & Audio Quality Verification Suite\n');

  // Test 1: Parameter Set Regressions in WebNeuralEngine & AcousticIntelligence
  await test('classifyTimbre and classifyAcousticInstrument assign correct parameter sets', async () => {
    const sampleRate = 44100;
    const analyzer = new SpectralAnalyzer();

    // A) Fast percussive burst (15ms noise decay) -> Drums & Percussion (Set 8)
    const percussive = new Float32Array(Math.round(sampleRate * 0.2));
    for (let i = 0; i < percussive.length; i++) {
      const t = i / sampleRate;
      const env = Math.exp(-t * 60.0);
      percussive[i] = (Math.random() * 2 - 1) * env;
    }
    const descPerc = extractAcousticDescriptors(percussive, sampleRate, analyzer);
    const dspPerc = classifyAcousticInstrument(descPerc);
    assert.equal(dspPerc.recommendedParameterSet, 8, `Expected parameterSet 8 for percussive burst, got ${dspPerc.recommendedParameterSet}`);
    assert.notEqual(dspPerc.recommendedParameterSet, 6, 'Percussive burst must never be classified as Pads (Set 6)');

    const enginePerc = await webNeuralEngine.classifyTimbre(percussive, sampleRate);
    assert.equal(enginePerc.parameterSet, 8, `WebNeuralEngine expected parameterSet 8, got ${enginePerc.parameterSet}`);

    // B) Sub-bass at 65.4 Hz (C2) -> Bass & Low End (Set 4)
    const bass = new Float32Array(Math.round(sampleRate * 0.5));
    const f0Bass = 65.4;
    for (let i = 0; i < bass.length; i++) {
      const t = i / sampleRate;
      const env = Math.min(1.0, i / (0.01 * sampleRate)) * Math.exp(-t * 2.0);
      bass[i] = env * (0.8 * Math.sin(2 * Math.PI * f0Bass * t) + 0.2 * Math.sin(2 * Math.PI * 2 * f0Bass * t));
    }
    const descBass = extractAcousticDescriptors(bass, sampleRate, analyzer);
    const dspBass = classifyAcousticInstrument(descBass);
    assert.equal(dspBass.recommendedParameterSet, 4, `Expected parameterSet 4 for bass tone, got ${dspBass.recommendedParameterSet}`);

    const engineBass = await webNeuralEngine.classifyTimbre(bass, sampleRate);
    assert.equal(engineBass.parameterSet, 4, `WebNeuralEngine expected parameterSet 4, got ${engineBass.parameterSet}`);
  });

  // Test 2: Pitch Detection Precision and Honest DSP Reporting in WebNeuralEngine
  await test('detectPitch achieves precise F0 and honestly reports dsp-fallback', async () => {
    const sampleRate = 44100;
    const durSec = 0.5;
    const pcm = new Float32Array(Math.round(sampleRate * durSec));
    const targetF0 = 220.0; // A3

    // Complex harmonic tone: fundamental + prominent 2nd/3rd harmonics
    for (let i = 0; i < pcm.length; i++) {
      const t = i / sampleRate;
      const env = Math.min(1.0, i / (0.01 * sampleRate));
      pcm[i] =
        env *
        (0.5 * Math.sin(2 * Math.PI * targetF0 * t) +
          0.7 * Math.sin(2 * Math.PI * 2 * targetF0 * t) +
          0.4 * Math.sin(2 * Math.PI * 3 * targetF0 * t));
    }

    const pitchRes = await webNeuralEngine.detectPitch(pcm, sampleRate);
    assert.ok(
      Math.abs(pitchRes.f0Hz - targetF0) <= 2.0,
      `Expected F0 ~220Hz (+-2Hz), got ${pitchRes.f0Hz}`
    );
    assert.equal(pitchRes.methodUsed, 'dsp-fallback', 'Must honestly report dsp-fallback without faking WebGPU-ONNX');
  });

  // Test 3: Preservation of 24-bit and multichannel audio in conditioning pipeline
  await test('executeCanonicalPhase1SampleConditioning preserves 24-bit stereo without mono downmix', async () => {
    const origSr = 48000;
    const len = Math.round(origSr * 0.1);
    const left = new Float32Array(len);
    const right = new Float32Array(len);

    for (let i = 0; i < len; i++) {
      const t = i / origSr;
      left[i] = 0.6 * Math.sin(2 * Math.PI * 440 * t);
      right[i] = 0.6 * Math.sin(2 * Math.PI * 880 * t);
    }

    const inputWavBytes = encodeWavPcm24([left, right], origSr, 'StereoTest');
    const samplesMap = new Map<string, ArrayBuffer>([['StereoTest', inputWavBytes]]);
    const sampleFlags: Record<string, any> = {};

    const checklist = createDefaultPipelineChecklistSelection({
      workingMode: 'extended',
      keyMappingMode: 'chromatic',
      hasLegacyClassicOnlySources: false,
      aiConfig: { ...DEFAULT_AI_ASSISTANCE_CONFIG, enabled: false },
      dspAlgorithm: 'enhanced',
    });
    // Turn off other steps, only test upsampleMasterWave & normalize
    for (const k of Object.keys(checklist.steps) as Array<keyof typeof checklist.steps>) {
      checklist.steps[k] = false;
    }
    checklist.steps.upsampleMasterWave = true;
    checklist.steps.normalize = true;

    await executeCanonicalPhase1SampleConditioning({
      samples: samplesMap,
      checklist,
      keyMappingMode: 'chromatic',
      sampleFlags,
    });

    const processedWav = samplesMap.get('StereoTest')!;
    const decoded = decodeWav(processedWav);
    assert.equal(decoded.numChannels, 2, 'Must remain stereo (2 channels)');
    assert.equal(decoded.bitsPerSample, 24, 'Must be 24-bit PCM');
    assert.equal(decoded.sampleRate, 96000, 'Must be upsampled to 96000 Hz');

    // Verify left and right channels remain distinct
    let diffSum = 0;
    for (let i = 0; i < Math.min(decoded.channels[0].length, decoded.channels[1].length); i++) {
      diffSum += Math.abs(decoded.channels[0][i] - decoded.channels[1][i]);
    }
    assert.ok(diffSum > 10.0, 'Left and right channels must not be flattened to identical mono');
  });

  // Test 4: Honesty in stepBadges and actionDeclarations
  await test('stepBadges and actionDeclarations never fake Cloud LLM audio processing', () => {
    const cloudCtx = {
      isBridgeConnected: false,
      isCloudReady: true,
      cloudProviderLabel: 'Claude',
      activeTextLlmProvider: 'claude',
      aiConfig: { ...DEFAULT_AI_ASSISTANCE_CONFIG, enabled: true, denoise: 'ai', deEsser: 'ai' },
    };

    const denoiseBadge = resolvePipelineStepExecutionBadge('denoise', cloudCtx);
    assert.notEqual(denoiseBadge.kind, 'cloud-ai', 'Denoise badge must never claim cloud-ai');
    assert.equal(denoiseBadge.kind, 'fallback-dsp', 'Denoise badge must be fallback-dsp when AI requested but offline');

    const deEsserBadge = resolvePipelineStepExecutionBadge('deEsser', cloudCtx);
    assert.notEqual(deEsserBadge.kind, 'cloud-ai', 'De-Esser badge must never claim cloud-ai');
    assert.equal(deEsserBadge.kind, 'fallback-dsp', 'De-Esser badge must be fallback-dsp when AI requested but offline');

    const denoiseDecl = resolveAiActionDeclaration('recorder-ai-denoise', {
      isBridgeConnected: false,
      isCloudReady: true,
      activeTextLlmProvider: 'claude',
      aiConfig: { ...DEFAULT_AI_ASSISTANCE_CONFIG, enabled: false, denoise: 'dsp' },
    });
    assert.equal(denoiseDecl.isPrimaryAvailable, false, 'Cloud LLM must not make AI denoise available');
    assert.equal(denoiseDecl.requiresFallbackConsent, true, 'Must require fallback consent for DSP');
  });

  // Test 5: parseJsonObjectSafe handles clean JSON, markdown codeblocks, and mixed text
  await test('parseJsonObjectSafe reliably parses clean and markdown wrapped objects', () => {
    // A) Clean JSON
    const clean = parseJsonObjectSafe<{ name: string }>('{"name": "Axionik"}');
    assert.deepEqual(clean, { name: 'Axionik' });

    // B) Markdown codeblock
    const md = parseJsonObjectSafe<{ bpm: number }>('Here is the result:\n```json\n{"bpm": 128}\n```\nDone.');
    assert.deepEqual(md, { bpm: 128 });

    // C) Mixed text without codeblock
    const mixed = parseJsonObjectSafe<{ tags: string[] }>('Analysis notes: {"tags": ["warm", "analog"]} end of response.');
    assert.deepEqual(mixed, { tags: ['warm', 'analog'] });

    // D) Invalid non-object / array / malformed
    assert.equal(parseJsonObjectSafe('plain text'), null);
    assert.equal(parseJsonObjectSafe('[1, 2, 3]'), null);
  });

  // Test 6: Python MODEL_REGISTRY pruning in bridge/server.py
  await test('bridge/server.py MODEL_REGISTRY is pruned and declares inference_wired: False', () => {
    const pythonCode = `
import sys, json
sys.path.insert(0, 'bridge')
from server import MODEL_REGISTRY

keys = list(MODEL_REGISTRY.keys())
assert 'audiosr' not in keys, "audiosr must be pruned"
assert 'musicgen' not in keys, "musicgen must be pruned"
assert 'sdturbo' not in keys, "sdturbo must be pruned"

for model_id, meta in MODEL_REGISTRY.items():
    assert meta.get('inference_wired') is False, f"{model_id} must have inference_wired=False"

print(json.dumps(keys))
`;

    const res = spawnSync('python', ['-c', pythonCode], { encoding: 'utf-8' });
    assert.equal(res.status, 0, `Python test failed: ${res.stderr}`);
    const activeModels = JSON.parse(res.stdout.trim()) as string[];
    assert.deepEqual(activeModels.sort(), ['basicpitch', 'deepfilter', 'htdemucs', 'whispertiny'].sort());
  });

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run();
