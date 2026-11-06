import assert from 'node:assert/strict';
import { validateSessionPayload, parseSessionJson, validateAiBridgeEndpoint, detectSessionMigrationNotes, noteSessionMigration, consumeMigrationNotes } from '../src/core/sessionSchema.ts';
import { BankService } from '../src/core/bankService.ts';
import { CloudByokClient } from '../src/core/ai/CloudByokClient.ts';
import { decodeRx2Audio, getMemoryStatus, clearMemoryCache } from '../src/core/bridge/bridgeAudio.ts';
import { getModels, getModelProgress, downloadModel } from '../src/core/bridge/bridgeModels.ts';
import { validateBridgeUrl, type BridgeCore } from '../src/core/bridge/bridgeTypes.ts';

function baseZone(i: number) {
  return { id: `z-${i}`, lowKey: 60, rootKey: 60, highKey: 60, sampleLow: null, sampleHigh: null, velSplit: 64, detune: 0, volume: 0, pan: 0 };
}

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    magic: 'NEURONMM_SESSION',
    session: {
      id: 'sess_44',
      name: 'Fase44',
      zones: [baseZone(0)],
      processConfig: {
        modelNumber: 1, modelName: 'Test', complexity: 8, parameterSet: 0, targetFormat: 'dual',
        ...overrides,
      },
    },
  };
}

async function main() {
  console.log('--- Fase44.1: aiConfig 6/7/8 + tempoSync + sublibrary sobreviven ---');
  const full = basePayload({
    aiConfig: { enabled: true, masterWave: 'dsp', separation: 'dsp', loopExpansion: 'dsp', classifier: 'dsp', denoise: 'dsp', pitchAndSlicer: 'ai', deEsser: 'ai', coverArtwork: 'cloud-ai' },
    unifiedSurfaceConfig: { topologyMode: 'auto', resolutionStrategy: 'auto', tempoSync: { enabled: true, sourceBpm: 120, targetBpm: 140, barCount: 2, timeSignature: [4, 4], grooveMode: 'rex_loop', sliceCount: 16 } },
    sublibrary: 'Pads', sublibraryOrdinal: 3,
  });
  const s1 = validateSessionPayload(full);
  assert.equal(s1.processConfig.aiConfig?.pitchAndSlicer, 'ai');
  assert.equal(s1.processConfig.aiConfig?.deEsser, 'ai');
  assert.equal(s1.processConfig.aiConfig?.coverArtwork, 'cloud-ai');
  assert.equal(s1.processConfig.unifiedSurfaceConfig?.tempoSync?.targetBpm, 140);
  assert.equal(s1.processConfig.unifiedSurfaceConfig?.tempoSync?.grooveMode, 'rex_loop');
  assert.equal(s1.processConfig.sublibrary, 'Pads');
  assert.equal(s1.processConfig.sublibraryOrdinal, 3);
  // roundtrip JSON
  const s2 = parseSessionJson(JSON.stringify(full));
  assert.equal(s2.processConfig.unifiedSurfaceConfig?.tempoSync?.targetBpm, 140);
  console.log('ok 44.1 full');

  console.log('--- Fase44.1b: legacy sin campos nuevos migra sin romper ---');
  const legacy = basePayload({ aiConfig: { enabled: false, masterWave: 'dsp', separation: 'dsp', loopExpansion: 'dsp', classifier: 'dsp', denoise: 'dsp' } });
  const s3 = validateSessionPayload(legacy);
  assert.equal(s3.processConfig.aiConfig?.pitchAndSlicer, 'dsp');
  assert.equal(s3.processConfig.aiConfig?.deEsser, 'dsp');
  assert.equal(s3.processConfig.aiConfig?.coverArtwork, 'procedural');
  console.log('ok 44.1 legacy');

  console.log('--- Fase44.2: BYOK deepseek/groq/mistral solos => isReady ---');
  for (const [key, provider] of [['deepseekApiKey', 'deepseek'], ['groqApiKey', 'groq'], ['mistralApiKey', 'mistral']] as const) {
    const c = new CloudByokClient();
    c.clearConfig();
    c.saveConfig({ [key]: 'sk-test-123', provider } as never);
    assert.equal(c.hasValidKey(provider), true, provider);
    assert.equal(c.isReady(), true, `isReady ${provider}`);
    assert.equal(c.getFirstAvailableTextProvider(), provider, `first ${provider}`);
    c.clearConfig();
  }
  console.log('ok 44.2');

  console.log('--- Fase44.3: decodeRx2 offline lanza error tipado ---');
  const offlineCore = { isConnected: () => false, getUrl: () => 'http://127.0.0.1:7860', authHeaders: (h: Record<string, string>) => h } as unknown as BridgeCore;
  await assert.rejects(() => decodeRx2Audio(offlineCore, new ArrayBuffer(8)), /bridge is offline/);
  console.log('ok 44.3');

  console.log('--- Fase44.3b: getModels/getMemoryStatus offline no cuelgan ni fingen datos ---');
  assert.deepEqual(await getModels(offlineCore), []);
  assert.equal(await getMemoryStatus(offlineCore), null);
  assert.equal(await clearMemoryCache(offlineCore), null);
  const prog = await getModelProgress(offlineCore, 'audiosr');
  assert.equal(prog.status, 'offline');
  await assert.rejects(() => downloadModel(offlineCore, 'audiosr'), /offline/);
  console.log('ok 44.3b');
  console.log('--- Fase44.4: endpoint validators coinciden (loopback ok, privada bloqueada) ---');
  assert.equal(validateBridgeUrl('http://127.0.0.1:7860/'), 'http://127.0.0.1:7860');
  assert.throws(() => validateBridgeUrl('http://192.168.1.10:7860/'), /private/);
  assert.throws(() => validateBridgeUrl('javascript:alert(1)'), /http/);
  assert.ok(validateAiBridgeEndpoint('http://127.0.0.1:7860/api/enhance').includes('127.0.0.1'));
  assert.throws(() => validateAiBridgeEndpoint('http://192.168.1.10:7860/api/enhance'), /private/);
  console.log('ok 44.4');
  console.log('--- Fase44.1c: detector de migración + outbox one-shot ---');
  assert.deepEqual(consumeMigrationNotes(), []);
  const legacyRaw = basePayload({ aiConfig: { enabled: false, masterWave: 'dsp', separation: 'dsp', loopExpansion: 'dsp', classifier: 'dsp', denoise: 'dsp' } });
  assert.deepEqual(detectSessionMigrationNotes(legacyRaw), ['ai-stages-6-8-defaulted', 'unified-surface-defaulted']);
  assert.deepEqual(detectSessionMigrationNotes(full), []);
  assert.deepEqual(detectSessionMigrationNotes(null), []);
  noteSessionMigration(legacyRaw);
  noteSessionMigration(legacyRaw); // dup: still once
  assert.deepEqual(consumeMigrationNotes(), ['ai-stages-6-8-defaulted', 'unified-surface-defaulted']);
  assert.deepEqual(consumeMigrationNotes(), []);
  console.log('ok 44.1c');

  console.log('--- Fase44.5: persistBank emite quota-warning a TelemetryDrawer ---');
  const store: Record<string, string> = {};
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
  };
  const events: Array<{ type: string; message?: string }> = [];
  const fakeCtx = {
    getSession: () => null,
    getSampleBuffer: () => undefined,
    getAssetStore: () => { throw new Error('no store'); },
    hasImportedBinary: () => false,
    ensureDemoBuffers: () => {},
    analyzeZone: () => { throw new Error('no dsp'); },
    pushHistory: () => {},
    emit: (e: { type: string; message?: string }) => { events.push(e); },
    setProcessProgress: () => {},
  };
  const svc = new BankService(fakeCtx as never);
  svc.generatedModels = [{ slot: 1, name: 'Big', zoneCount: 1, complexity: 8, parameterSet: 0, createdAt: '2026-01-01', path: 'x', neuronikModelJson: 'x'.repeat(300000) } as never];
  svc.persistBank();
  const qw = events.filter((e) => e.type === 'quota-warning');
  assert.equal(qw.length, 1);
  assert.match(qw[0].message ?? '', /truncado/);
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
  console.log('ok 44.5');
  console.log('\nPhase44 OK');
}

await main();
