// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Security Hardening Regression Suite (S2–S6)
// SSRF, cotas de sesión/cover, bank restore, Zip-Slip, Bridge URL.
// ─────────────────────────────────────────────────────────

import assert from 'node:assert/strict';
import { parseSessionJson } from '../src/core/sessionSchema.ts';
import { isSafeCoverDataUrl } from '../src/core/bankService.ts';
import { validateBridgeUrl } from '../src/core/bridge/BridgeClient.ts';
import { extractTimeCapsuleFromFiles } from '../src/core/timeCapsule.ts';

function baseSession(): Record<string, unknown> {
  return {
    id: 'sess1',
    name: 't',
    zones: [{ id: 'z1', lowKey: 0, rootKey: 60, highKey: 127 }],
    processConfig: { modelNumber: 1, modelName: 'M', complexity: 8, parameterSet: 0, targetFormat: 'dual' },
  };
}

async function runSecurityTests(): Promise<void> {
  console.log('=== Security Hardening Suite ===');

  // 1. SSRF bloqueado en aiBridgeEndpoint
  for (const bad of [
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.1/x',
    'http://192.168.1.1/x',
    'ftp://example.com/x',
    'javascript:alert(1)',
  ]) {
    assert.throws(
      () =>
        parseSessionJson(
          JSON.stringify({
            session: {
              ...baseSession(),
              processConfig: {
                ...(baseSession().processConfig as object),
                masterWaveConfig: {
                  promotionMethod: 'ai-bridge',
                  channelLayout: 'stereo',
                  targetSampleRate: 96000,
                  targetBitDepth: 24,
                  minLoopDurationSec: 4,
                  enableBandwidthExtension: false,
                  enableDenoiseGate: false,
                  aiBridgeEndpoint: bad,
                },
              },
            },
          })
        ),
      /aiBridgeEndpoint|http/,
      `SSRF endpoint debe rechazarse: ${bad}`
    );
  }
  console.log('[PASS] 1. SSRF en aiBridgeEndpoint rechazado');

  // 2. webp gigante / originalName con XSS rechazados
  const huge = 'data:image/webp;base64,' + 'A'.repeat(700_001);
  assert.throws(
    () =>
      parseSessionJson(
        JSON.stringify({
          session: {
            ...baseSession(),
            processConfig: {
              ...(baseSession().processConfig as object),
              coverArtwork: { webpDataUrl: huge, byteLength: 1, width: 512, height: 512, originalName: 'c.webp', updatedAt: 'now' },
            },
          },
        })
      ),
    /too large/,
    'webp gigante debe rechazarse'
  );
  assert.throws(
    () =>
      parseSessionJson(
        JSON.stringify({
          session: {
            ...baseSession(),
            processConfig: {
              ...(baseSession().processConfig as object),
              coverArtwork: {
                webpDataUrl: 'data:image/webp;base64,AAAA',
                byteLength: 1,
                width: 512,
                height: 512,
                originalName: 'x\".onerror=.webp',
                updatedAt: 'now',
              },
            },
          },
        })
      ),
    /originalName/,
    'originalName con XSS debe rechazarse'
  );
  console.log('[PASS] 2. Cover art con cotas');

  // 3. sampleName con traversal rechazado
  assert.throws(
    () => parseSessionJson(JSON.stringify({ session: { ...baseSession(), zones: [{ id: 'z1', lowKey: 0, rootKey: 60, highKey: 127, sampleLow: '../../evil.wav' }] } })),
    /sampleLow/,
    'sampleLow con .. debe rechazarse'
  );
  console.log('[PASS] 3. sampleLow traversal rechazado');

  // 4. bank cover allowlist
  assert.equal(isSafeCoverDataUrl('data:image/webp;base64,AAAA'), true);
  assert.equal(isSafeCoverDataUrl('javascript:alert(1)'), false);
  assert.equal(isSafeCoverDataUrl('data:image/svg+xml;base64,AAAA'), false);
  console.log('[PASS] 4. bank cover allowlist');

  // 5. Bridge URL
  assert.throws(() => validateBridgeUrl('javascript:alert(1)'), /http/);
  assert.throws(() => validateBridgeUrl('http://user:pass@127.0.0.1:7860/'), /credentials/);
  assert.equal(validateBridgeUrl('http://127.0.0.1:7860/'), 'http://127.0.0.1:7860');
  console.log('[PASS] 5. BridgeClient URL validada');

  // 6. Zip-Slip ignorado en timeCapsule
  const out = extractTimeCapsuleFromFiles([{ name: 'evil.zip', data: new Uint8Array([0, 1, 2, 3]) }]);
  assert.equal(out.isTimeCapsule, false, 'zip inválido no debe detectarse como cápsula');
  console.log('[PASS] 6. timeCapsule no confunde payload inválido');

  console.log('=== ALL SECURITY TESTS PASSED ===');
}

runSecurityTests().catch((err) => {
  console.error('Security test failed:', err);
  process.exit(1);
});
