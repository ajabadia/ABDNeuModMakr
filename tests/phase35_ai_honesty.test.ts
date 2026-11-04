// ─────────────────────────────────────────────────────────
// Tests — Phase 35.4: AI Honesty & Unified Status Contract
// ─────────────────────────────────────────────────────────

import {
  AI_TOTAL_STAGE_COUNT,
  countActiveAiStages,
  resolveAiActionDeclaration,
  resolveAiSystemStatus,
  separateStemsDspFallback,
  type AiActionId,
} from '../src/core/ai/aiHonesty.ts';
import type { AiAssistanceConfig } from '../src/core/types.ts';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runPhase35AiHonestyTests(): Promise<void> {
  console.log('Running Phase 35.4 AI Honesty tests...');

  // 1. Unified AI System Status (`offline`, `local`, `bridge`, `cloud`)
  {
    const disabledCfg: AiAssistanceConfig = {
      enabled: false,
      masterWave: 'dsp',
      separation: 'dsp',
      loopExpansion: 'dsp',
      classifier: 'dsp',
      denoise: 'dsp',
    };
    const offlineStatus = resolveAiSystemStatus({
      aiConfig: disabledCfg,
      isBridgeConnected: true,
      isCloudReady: true,
    });
    assert(offlineStatus.mode === 'offline', 'Disabled config should report offline mode');
    assert(
      offlineStatus.badgeText.includes('DESACTIVADA'),
      'Disabled config should distinguish DESACTIVADA from SIN CONEXIÓN'
    );
    assert(offlineStatus.pillClass === 'is-ai-off', 'Disabled config should use is-ai-off pill');
    assert(offlineStatus.activeStageCount === 0, 'Disabled config should have 0 active stages');

    // Enabled config with 0/5 stages when Bridge/Cloud is connected vs disconnected
    const zeroStagesEnabledCfg: AiAssistanceConfig = {
      enabled: true,
      masterWave: 'dsp',
      separation: 'dsp',
      loopExpansion: 'dsp',
      classifier: 'dsp',
      denoise: 'dsp',
    };
    const zeroConnectedStatus = resolveAiSystemStatus({
      aiConfig: zeroStagesEnabledCfg,
      isBridgeConnected: true,
      isCloudReady: false,
    });
    assert(
      zeroConnectedStatus.badgeText.includes(`0/${AI_TOTAL_STAGE_COUNT} ETAPAS`),
      `Enabled config with 0 stages when connected must report 0/${AI_TOTAL_STAGE_COUNT} ETAPAS instead of SIN CONEXIÓN`
    );

    const zeroOfflineStatus = resolveAiSystemStatus({
      aiConfig: zeroStagesEnabledCfg,
      isBridgeConnected: false,
      isCloudReady: false,
    });
    assert(
      zeroOfflineStatus.badgeText.includes('SIN CONEXIÓN'),
      'Enabled config with 0 stages and no remote connection reports SIN CONEXIÓN'
    );

    const hybridCfg: AiAssistanceConfig = {
      enabled: true,
      masterWave: 'ai',
      separation: 'dsp',
      loopExpansion: 'ai',
      classifier: 'dsp',
      denoise: 'ai',
    };
    assert(countActiveAiStages(hybridCfg) === 3, 'Should count 3 active AI stages');

    const localStatus = resolveAiSystemStatus({
      aiConfig: hybridCfg,
      isBridgeConnected: false,
      isCloudReady: false,
      localProvider: 'webgpu',
    });
    assert(localStatus.mode === 'local', 'When neither Bridge nor Cloud is active, mode must be local');
    const threeActive = `3/${AI_TOTAL_STAGE_COUNT}`;
    assert(localStatus.pillClass === 'is-ai-hybrid', `${threeActive} stages should use is-ai-hybrid pill`);
    assert(localStatus.badgeText.includes(`LOCAL (${threeActive})`), `Local badge text should include LOCAL (${threeActive})`);
    assert(localStatus.cardSubtitle.includes('WebGPU'), 'WebGPU localProvider must report WebGPU');

    const wasmLocalStatus = resolveAiSystemStatus({
      aiConfig: hybridCfg,
      isBridgeConnected: false,
      isCloudReady: false,
      localProvider: 'wasm',
    });
    assert(wasmLocalStatus.cardSubtitle.includes('WASM SIMD'), 'WASM localProvider must report WASM SIMD');

    const dspLocalStatus = resolveAiSystemStatus({
      aiConfig: hybridCfg,
      isBridgeConnected: false,
      isCloudReady: false,
      localProvider: 'dsp',
    });
    assert(dspLocalStatus.cardSubtitle.includes('DSP Determinista'), 'DSP localProvider must report DSP Determinista');

    const cloudStatus = resolveAiSystemStatus({
      aiConfig: hybridCfg,
      isBridgeConnected: false,
      isCloudReady: true,
    });
    assert(cloudStatus.mode === 'cloud', 'When Cloud BYOK is ready and Bridge is off, mode must be cloud');
    assert(cloudStatus.badgeText.includes(`NUBE (${threeActive})`), `Cloud badge text should include NUBE (${threeActive})`);

    const fullAiCfg: AiAssistanceConfig = {
      enabled: true,
      masterWave: 'ai',
      separation: 'ai',
      loopExpansion: 'ai',
      classifier: 'ai',
      denoise: 'ai',
      pitchAndSlicer: 'ai',
      deEsser: 'ai',
      coverArtwork: 'local-ai',
    };
    assert(
      countActiveAiStages(fullAiCfg) === AI_TOTAL_STAGE_COUNT,
      'full AI config must enable every one of the counted stages'
    );
    const bridgeStatus = resolveAiSystemStatus({
      aiConfig: fullAiCfg,
      isBridgeConnected: true,
      isCloudReady: true,
    });
    assert(bridgeStatus.mode === 'bridge', 'When Bridge is connected, mode must be bridge');
    const allActive = `${AI_TOTAL_STAGE_COUNT}/${AI_TOTAL_STAGE_COUNT}`;
    assert(bridgeStatus.pillClass === 'is-ai-active', `${allActive} stages should use is-ai-active pill`);
    assert(bridgeStatus.badgeText.includes(`BRIDGE (${allActive})`), `Bridge badge text should include BRIDGE (${allActive})`);
  }

  // 2. Every AI button declares primary engine and fallback, and requires consent when primary is unavailable
  {
    const bridgeActions: AiActionId[] = [
      'recorder-bwe-enhance',
      'chopper-bwe-enhance',
      'chopper-whisper-align',
      'chopper-demucs-split',
    ];

    for (const actionId of bridgeActions) {
      const onlineDecl = resolveAiActionDeclaration(actionId, { isBridgeConnected: true });
      assert(onlineDecl.isPrimaryAvailable === true, `${actionId} online should mark primary available`);
      assert(onlineDecl.requiresFallbackConsent === false, `${actionId} online must not require fallback consent`);
      assert(onlineDecl.primaryEngine.length > 5, `${actionId} must declare primaryEngine`);
      assert(onlineDecl.fallbackEngine.length > 5, `${actionId} must declare fallbackEngine`);
      assert(
        onlineDecl.buttonTooltip.includes(onlineDecl.primaryEngine),
        `${actionId} tooltip must mention primaryEngine`
      );
      assert(
        onlineDecl.buttonTooltip.includes(onlineDecl.fallbackEngine),
        `${actionId} tooltip must mention fallbackEngine`
      );

      const offlineDecl = resolveAiActionDeclaration(actionId, { isBridgeConnected: false });
      assert(offlineDecl.isPrimaryAvailable === false, `${actionId} offline should mark primary unavailable`);
      assert(offlineDecl.requiresFallbackConsent === true, `${actionId} offline must require explicit fallback consent`);
      assert(offlineDecl.consentTitle.length > 5, `${actionId} offline must provide consentTitle`);
      assert(
        offlineDecl.consentMessage.includes(offlineDecl.fallbackEngine),
        `${actionId} consent message must explain the fallback engine`
      );
    }

    // Artwork generator: procedural vs bridge vs cloud
    const procDecl = resolveAiActionDeclaration('artwork-generate', {
      isBridgeConnected: false,
      selectedArtworkProvider: 'procedural',
    });
    assert(procDecl.isPrimaryAvailable === true && !procDecl.requiresFallbackConsent, 'Procedural is always available');

    const cloudMissingDecl = resolveAiActionDeclaration('artwork-generate', {
      isBridgeConnected: false,
      selectedArtworkProvider: 'gemini',
      artworkProviderReady: false,
    });
    assert(cloudMissingDecl.requiresFallbackConsent === true, 'Cloud provider without key must require consent');
    assert(cloudMissingDecl.fallbackEngine.includes('Procedural'), 'Cloud fallback must be Procedural');

    const llmOfflineDecl = resolveAiActionDeclaration('artwork-llm-prompt', {
      isBridgeConnected: false,
      activeTextLlmProvider: null,
    });
    assert(llmOfflineDecl.requiresFallbackConsent === true, 'LLM prompt without BYOK key must require consent');
  }

  // 3. Deterministic local stem separation fallback (`separateStemsDspFallback`)
  {
    const sr = 16000;
    const len = 1600;
    const pcm = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      // Mix of 100 Hz bass sine + 1000 Hz mid sine + transient clicks
      const t = i / sr;
      pcm[i] =
        0.4 * Math.sin(2 * Math.PI * 100 * t) +
        0.3 * Math.sin(2 * Math.PI * 1000 * t) +
        (i % 400 === 0 ? 0.25 : 0);
    }

    const fakeWavEncoder = (samples: Float32Array, sampleRate: number): ArrayBuffer => {
      const buf = new ArrayBuffer(samples.byteLength + 4);
      new DataView(buf).setUint32(0, sampleRate, true);
      new Float32Array(buf, 4).set(samples);
      return buf;
    };

    const stems = separateStemsDspFallback(
      pcm,
      sr,
      ['vocals', 'drums', 'bass', 'instrumental'],
      fakeWavEncoder
    );

    assert(stems.vocals instanceof ArrayBuffer && stems.vocals.byteLength === len * 4 + 4, 'Vocals stem generated');
    assert(stems.drums instanceof ArrayBuffer && stems.drums.byteLength === len * 4 + 4, 'Drums stem generated');
    assert(stems.bass instanceof ArrayBuffer && stems.bass.byteLength === len * 4 + 4, 'Bass stem generated');
    assert(
      stems.instrumental instanceof ArrayBuffer && stems.instrumental.byteLength === len * 4 + 4,
      'Instrumental stem generated'
    );
  }

  console.log('✓ Phase 35.4 AI Honesty tests passed (3/3)');
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('phase35_ai_honesty.test.ts')) {
  runPhase35AiHonestyTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
