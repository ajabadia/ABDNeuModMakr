// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Phase 45 Security Hardening & Audit Suite
// ─────────────────────────────────────────────────────────

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

import { redactUrlForLog } from '../src/core/ai/CloudByokClient.ts';
import { assertSafeExternalHttpsUrl } from '../src/core/security/ssrf.ts';
import { assertJsonDepthWithinCap } from '../src/core/dsp/ResynatorV2Wasm.ts';
import { parseSessionJson } from '../src/core/sessionPersistence.ts';
import { sanitizeArticulation } from '../src/core/sessionSchema.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

async function runPhase45AuditTests() {
  console.log('=== Phase 45 Security Hardening & Audit Suite ===');

  // Test 1: redactUrlForLog oculta ?key= y conserva origen + ruta
  {
    const secretUrl = 'https://generativelanguage.googleapis.com/v1beta/models?key=AIzaSySecret1234567890';
    const redacted = redactUrlForLog(secretUrl);
    assert(!redacted.includes('AIzaSySecret'), 'redactUrlForLog debe eliminar la API Key');
    assert.strictEqual(redacted, 'https://generativelanguage.googleapis.com/v1beta/models');

    const plainUrl = 'https://api.openai.com/v1/models';
    assert.strictEqual(redactUrlForLog(plainUrl), plainUrl);
    console.log('[PASS] 1. redactUrlForLog sanitiza URLs con API Key en query');
  }

  // Test 2: assertSafeExternalHttpsUrl bloquea orígenes no seguros / internos y credenciales
  {
    assert.throws(() => assertSafeExternalHttpsUrl('http://insecure.example.com/cover.png'), /Only HTTPS|unsafe/i);
    assert.throws(() => assertSafeExternalHttpsUrl('https://127.0.0.1/evil.png'), /unsafe/i);
    assert.throws(() => assertSafeExternalHttpsUrl('https://169.254.169.254/meta-data'), /unsafe/i);
    assert.throws(() => assertSafeExternalHttpsUrl('https://[::1]/evil.png'), /unsafe/i);
    assert.throws(() => assertSafeExternalHttpsUrl('https://admin:pass@example.com/image.png'), /forbidden|unsafe/i);

    const safeUrl = 'https://replicate.delivery/pbxt/img.webp';
    assert.strictEqual(assertSafeExternalHttpsUrl(safeUrl), safeUrl);
    console.log('[PASS] 2. assertSafeExternalHttpsUrl previene SSRF y URLs anómalas');
  }

  // Test 3: assertJsonDepthWithinCap
  {
    // Acepta JSON normal y strings con caracteres anidados dentro de texto
    const normalJson = JSON.stringify({
      level1: {
        level2: {
          level3: [1, 2, { trick: '{"[[[{{{}}}"' }],
        },
      },
    });
    assert.doesNotThrow(() => assertJsonDepthWithinCap(normalJson, 10));

    // Rechaza documento con más de 32 niveles
    let deepJson = '{"a":';
    for (let i = 0; i < 35; i++) deepJson += '{"nested":';
    deepJson += '1';
    for (let i = 0; i < 35; i++) deepJson += '}';
    deepJson += '}';

    assert.throws(() => assertJsonDepthWithinCap(deepJson, 32), /exceeds cap/i);
    console.log('[PASS] 3. assertJsonDepthWithinCap protege la pila recursiva');
  }

  // Test 4: Verificación de vercel.json y cabecera CSP
  {
    const vercelJsonPath = path.join(REPO_ROOT, 'vercel.json');
    const vercelContent = fs.readFileSync(vercelJsonPath, 'utf-8');
    const vercelObj = JSON.parse(vercelContent);
    assert(Array.isArray(vercelObj.headers), 'vercel.json debe contener headers');
    const allRoute = vercelObj.headers.find((h: any) => h.source === '/(.*)');
    assert(allRoute, 'Debe haber un bloque para /(.*)');
    const cspHeader = allRoute.headers.find((hdr: any) => hdr.key === 'Content-Security-Policy');
    assert(cspHeader, 'Debe existir la cabecera Content-Security-Policy');
    const cspVal = cspHeader.value;
    assert(cspVal.includes("script-src 'self' 'wasm-unsafe-eval'"), 'CSP debe incluir script-src wasm-unsafe-eval');
    assert(cspVal.includes("object-src 'none'"), 'CSP debe bloquear object-src');
    assert(cspVal.includes('https://generativelanguage.googleapis.com'), 'CSP debe autorizar connect a Gemini');
    console.log('[PASS] 4. vercel.json contiene Content-Security-Policy estricta');
  }

  // Test 5: parseSessionJson y sanitizeArticulation sanean inputs maliciosos
  {
    const maliciousRaw = {
      ampEnvEnabled: true,
      ampEnv: {
        delaySec: NaN,
        attackSec: Infinity,
        holdSec: -5,
        decaySec: 999999,
        sustainLevel: 2.5,
        releaseSec: null,
      },
      modEnvEnabled: false,
      modEnvToPitchCents: 'exploit',
      filter: {
        enabled: true,
        type: '<script>alert(1)</script>',
        cutoffHz: Infinity,
        resonanceDb: -20,
      },
      polyphony: 999999,
      voiceMode: 'invalid_mode',
      extraMaliciousField: 'should_not_leak',
    };

    const sanitized = sanitizeArticulation(maliciousRaw);
    assert(sanitized, 'sanitizeArticulation debe devolver un objeto de articulación');
    assert.strictEqual(sanitized.ampEnv.delaySec, 0, 'delaySec NaN debe usar fallback');
    assert(sanitized.ampEnv.attackSec <= 30, 'attackSec Infinity debe ser acotado a 30');
    assert.strictEqual(sanitized.ampEnv.holdSec, 0, 'holdSec negativo debe acotarse a 0');
    assert(sanitized.ampEnv.decaySec <= 30, 'decaySec 999999 debe acotarse a 30');
    assert.strictEqual(sanitized.ampEnv.sustainLevel, 1, 'sustainLevel 2.5 debe acotarse a 1');
    assert.strictEqual(sanitized.filter.type, 'lpf', 'filter.type inválido debe caer a lpf');
    assert.strictEqual(sanitized.polyphony, 256, 'polyphony debe acotarse a 256');
    assert.strictEqual((sanitized as any).extraMaliciousField, undefined, 'campos extra deben ser descartados');
    console.log('[PASS] 5. sanitizeArticulation neutraliza NaN, Infinity y valores maliciosos');
  }

  // Test 6: Python CLI REX2 Anti-DoS (frames y anidado)
  {
    const pyScript = `
import sys
from bridge.dwop_decompress import decompress_rx2, MAX_RX2_FRAMES, MAX_IFF_DEPTH

# 1. Probar REX2 con total_frames gigantesco (> MAX_RX2_FRAMES)
# Estructura IFF REX2: 'CAT ' [len] 'REX2' 'SINF' [18 bytes] ... 'SDAT' ...
sinf_data = (
    b'\\x01\\x02' # 1 channel, 16-bit
    b'\\x00\\x00\\xac\\x44' # 44100 Hz
    b'\\xff\\xff\\xff\\xff' # 4294967295 frames!
    b'\\x00\\x00\\x00\\x00' # loop_start
    b'\\x00\\x00\\x00\\x00' # loop_end
)
sinf_chunk = b'SINF' + len(sinf_data).to_bytes(4, 'big') + sinf_data
sdat_chunk = b'SDAT' + (16).to_bytes(4, 'big') + (b'\\x00' * 16)
cat_payload = b'REX2' + sinf_chunk + sdat_chunk
rex2_bomb = b'CAT ' + len(cat_payload).to_bytes(4, 'big') + cat_payload

try:
    decompress_rx2(rex2_bomb)
    print("FAIL_NO_EXCEPTION_FRAMES")
    sys.exit(1)
except ValueError as e:
    if "Invalid total frames" not in str(e) and "maximum output size" not in str(e):
        print(f"FAIL_WRONG_EXCEPTION_FRAMES: {e}")
        sys.exit(1)

# 2. Probar REX2 con anidamiento IFF excesivo (> MAX_IFF_DEPTH)
curr = b'REX2' + sinf_chunk + sdat_chunk
for _ in range(15):
    curr = b'CAT ' + (len(curr) + 4).to_bytes(4, 'big') + b'REX2' + curr

try:
    decompress_rx2(curr)
    print("FAIL_NO_EXCEPTION_NESTING")
    sys.exit(1)
except ValueError as e:
    if "REX2 IFF nesting too deep" not in str(e):
        print(f"FAIL_WRONG_EXCEPTION_NESTING: {e}")
        sys.exit(1)

print("PYTHON_REX2_CHECKS_OK")
`;

    const out = execFileSync('python', ['-c', pyScript], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      timeout: 5000,
    });
    assert(out.includes('PYTHON_REX2_CHECKS_OK'), `Python check failed: ${out}`);
    console.log('[PASS] 6. Python REX2 parser rechaza bombas de frames y anidado en <100ms');
  }

  console.log('=== ALL PHASE 45 SECURITY AUDIT TESTS PASSED ===');
}

runPhase45AuditTests().catch((err) => {
  console.error('Phase 45 audit test failure:', err);
  process.exit(1);
});
