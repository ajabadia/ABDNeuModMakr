// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Security Hardening Regression Suite (S2–S6)
// SSRF, cotas de sesión/cover, bank restore, Zip-Slip, Bridge URL,
// sourceUrl allowlist, sublibrary names, fetch timeouts, bridge CSRF.
// ─────────────────────────────────────────────────────────

import assert from 'node:assert/strict';
import {
  parseSessionJson,
  sanitizeImportedProcessConfig,
  validateAiBridgeEndpoint,
  validateSourceUrl,
} from '../src/core/sessionSchema.ts';
import { isSafeCoverDataUrl, isSafeSublibraryName } from '../src/core/bankService.ts';
import { validateBridgeUrl } from '../src/core/bridge/BridgeClient.ts';
import { fetchWithTimeout, safeErrorSnippet } from '../src/core/ai/CloudByokClient.ts';
import { extractTimeCapsuleFromFiles } from '../src/core/timeCapsule.ts';
import { createZipArchive } from '../src/formats/ZipArchive.ts';

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

// ── Parte 2 (auditoría 2026-11-06): sourceUrl, sublibraries, timeouts, cover, bridge. ──

function sessionWithSourceUrl(sourceUrl: unknown): string {
  return JSON.stringify({
    session: {
      ...baseSession(),
      processConfig: {
        ...(baseSession().processConfig as object),
        extendedMetadata: { sourceUrl },
      },
    },
  });
}

async function runSecurityTestsPart2(): Promise<void> {
  console.log('=== Security Hardening Suite (part 2) ===');

  // 7. validateSourceUrl: solo http(s)
  assert.equal(validateSourceUrl('f', 'https://example.com/x.sf2'), 'https://example.com/x.sf2');
  assert.equal(validateSourceUrl('f', undefined), undefined);
  for (const bad of [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'ftp://example.com/x',
    'file:///etc/passwd',
    'https://example.com/' + 'a'.repeat(600),
  ]) {
    assert.throws(() => validateSourceUrl('f', bad), /http|only|chars/, `sourceUrl debe rechazarse: ${String(bad).slice(0, 40)}`);
  }
  console.log('[PASS] 7. validateSourceUrl solo http(s)');

  // 8. Sesión con sourceUrl malicioso se rechaza (stored-XSS vía <a href>)
  assert.throws(() => parseSessionJson(sessionWithSourceUrl('javascript:alert(1)')), /sourceUrl/);
  const okParsed = parseSessionJson(sessionWithSourceUrl('https://example.com/bank.sf2')) as {
    processConfig?: { extendedMetadata?: { sourceUrl?: string } };
  };
  assert.equal(okParsed.processConfig?.extendedMetadata?.sourceUrl, 'https://example.com/bank.sf2');
  console.log('[PASS] 8. sourceUrl en sesión validado');

  // 9. Nombres de sublibrería: charset del servidor o nada
  assert.equal(isSafeSublibraryName('Default'), true);
  assert.equal(isSafeSublibraryName('mis bancos-1'), true);
  for (const bad of ['../../evil', '..', '', 'a'.repeat(65), '/abs', 'C:\\win', 'nul\0byte', 'con<>']) {
    assert.equal(isSafeSublibraryName(bad), false, `sublibrería debe rechazarse: ${bad}`);
  }
  console.log('[PASS] 9. isSafeSublibraryName');

  // 10. fetchWithTimeout: éxito rápido + aborto ante cuelgue
  const okRes = await fetchWithTimeout('data:text/plain,hello', {}, 5000);
  assert.equal(await okRes.text(), 'hello');
  const realFetch = globalThis.fetch;
  try {
    // Stub colgado que SÍ respeta AbortSignal (como un fetch real ante abort).
    (globalThis as Record<string, unknown>).fetch = (_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        const onAbort = (): void => {
          reject(signal?.reason ?? new Error('aborted'));
        };
        if (signal?.aborted) {
          onAbort();
          return;
        }
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    await assert.rejects(() => fetchWithTimeout('https://example.com/hang', {}, 20), /timed out/);
  } finally {
    globalThis.fetch = realFetch;
  }
  const longSnippet = await safeErrorSnippet({ text: async () => 'E'.repeat(1000) } as Response);
  assert.ok(longSnippet.length <= 301 && longSnippet.endsWith('…'), 'error largo se trunca');
  console.log('[PASS] 10. fetchWithTimeout + safeErrorSnippet');

  // 11. Cover del ZIP: solo bytes WebP reales se adoptan (S6.4)
  const badZip = createZipArchive([{ path: '05_extended_model/cover.webp', data: new Uint8Array([1, 2, 3, 4]) }]);
  const badOut = extractTimeCapsuleFromFiles([{ name: 'evil.nmpack', data: badZip }]);
  assert.equal(badOut.coverWebpBytes, null, 'cover falso no se adopta');
  const riffWebp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 10, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0, 0, 0]);
  const goodZip = createZipArchive([{ path: '05_extended_model/cover.webp', data: riffWebp }]);
  const goodOut = extractTimeCapsuleFromFiles([{ name: 'good.nmpack', data: goodZip }]);
  assert.ok(goodOut.coverWebpBytes && goodOut.coverWebpBytes.byteLength === riffWebp.byteLength, 'cover WebP real se adopta');
  console.log('[PASS] 11. cover.webp revalidado (S6.4)');

  // 12. Bridge en vivo: 403 ante Origin ajeno, 413 ante cuerpo gigante, preflight con token
  await testBridgeLiveGuards();

  console.log('=== ALL SECURITY TESTS (PART 2) PASSED ===');
}

async function testBridgeLiveGuards(): Promise<void> {
  const { spawn, execFileSync } = await import('node:child_process');
  try {
    execFileSync('python', ['--version'], { stdio: 'ignore' });
  } catch {
    console.log('[SKIP] 12. sin python en PATH — guards del bridge no verificados en vivo');
    return;
  }
  const port = 17861;
  const child = spawn('python', ['bridge/server.py', '--port', String(port)], {
    stdio: 'ignore',
    detached: true,
  });
  const kill = (): void => {
    try {
      process.kill(-child.pid as number, 'SIGKILL');
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        // noop
      }
    }
  };
  try {
    // Espera al /api/health (máx ~15 s).
    let healthy = false;
    for (let i = 0; i < 75; i++) {
      try {
        const h = await fetchWithTimeout(`http://127.0.0.1:${port}/api/health`, {}, 1000);
        if (h.ok) {
          healthy = true;
          break;
        }
      } catch {
        // aún arrancando
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.ok(healthy, 'el bridge de pruebas debe arrancar');

    // 12a. POST con Origin ajeno → 403 (anti-CSRF), sin queja del token.
    const evil = await fetchWithTimeout(`http://127.0.0.1:${port}/api/models/url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: '{}',
    });
    assert.equal(evil.status, 403, 'Origin ajeno debe dar 403');

    // 12b. Mismo POST sin Origin (curl/herramienta local) → NO 403.
    const local = await fetchWithTimeout(`http://127.0.0.1:${port}/api/models/url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.notEqual(local.status, 403, 'sin Origin no hay 403');

    // 12c. Cabecera gigante → 413 inmediato sin leer el cuerpo.
    const status413 = await new Promise<number>((resolve, reject) => {
      import('node:net').then(({ default: net }) => {
        const sock = net.connect(port, '127.0.0.1', () => {
          sock.write(
            `POST /api/models/url HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n` +
              'Content-Length: 200000000\r\nOrigin: http://localhost:8388\r\nConnection: close\r\n\r\n'
          );
        });
        let head = '';
        const timer = setTimeout(() => {
          sock.destroy();
          reject(new Error('sin respuesta 413 a tiempo'));
        }, 8000);
        sock.on('data', (chunk: Buffer) => {
          head += chunk.toString('latin1');
          const m = head.match(/HTTP\/\d(?:\.\d)?\s+(\d+)/);
          if (m) {
            clearTimeout(timer);
            sock.destroy();
            resolve(Number(m[1]));
          }
        });
        sock.on('error', (e: Error) => {
          clearTimeout(timer);
          reject(e);
        });
      }).catch(reject);
    });
    assert.equal(status413, 413, 'cuerpo >150MB debe dar 413');

    // 12d. Preflight OPTIONS anuncia X-Bridge-Token (si no, el token opt-in no viaja).
    const pre = await fetchWithTimeout(`http://127.0.0.1:${port}/api/models/url`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:8388', 'Access-Control-Request-Headers': 'X-Bridge-Token' },
    });
    const allowHeaders = (pre.headers.get('access-control-allow-headers') || '').toLowerCase();
    assert.ok(allowHeaders.includes('x-bridge-token'), 'preflight debe anunciar X-Bridge-Token');
    console.log('[PASS] 12. bridge en vivo: 403 CSRF + 413 body-cap + preflight token');
  } finally {
    kill();
  }
}

runSecurityTestsPart2().catch((err) => {
  console.error('Security test (part 2) failed:', err);
  process.exit(1);
});

// ── Parte 3 (red-team 2026-11-06): SSRF IPv6, contrabando en manifest, ataques vivos. ──

async function runSecurityTestsPart3(): Promise<void> {
  console.log('=== Security Hardening Suite (part 3: red team) ===');

  // 13. SSRF vía IPv6: ::ffff:<privada>, link-local, ULA y :: bloqueados en ambas fronteras.
  const { validateBridgeUrl: validateBridge } = await import('../src/core/bridge/BridgeClient.ts');
  for (const bad of [
    'http://[::ffff:10.0.0.1]/api/enhance',
    'http://[::ffff:192.168.1.1]/x',
    'http://[::ffff:169.254.169.254]/latest/meta-data/',
    'http://[::ffff:172.16.0.1]/x',
    'http://[::ffff:8.8.8.8]/x', // mapeado público: fail-closed, usar IPv4/hostname
    'http://[fe80::1]/x',
    'http://[fc00::1]/x',
    'http://[fd00::1]/x',
    'http://[::]/x',
  ]) {
    assert.throws(() => validateAiBridgeEndpoint(bad), /blocked/, `SSRF IPv6 debe bloquearse: ${bad}`);
    assert.throws(() => validateBridge(bad), /blocked/, `bridge URL IPv6 debe bloquearse: ${bad}`);
  }
  // Loopback y público legítimo siguen pasando.
  assert.equal(validateAiBridgeEndpoint('http://[::1]:7860/api/enhance'), 'http://[::1]:7860/api/enhance');
  assert.equal(validateBridge('http://[::1]:7860/'), 'http://[::1]:7860');
  assert.equal(validateAiBridgeEndpoint('https://api.ejemplo.com/enhance'), 'https://api.ejemplo.com/enhance');
  // Decimales/hex/octal ya los normaliza WHATWG a 127.0.0.1 → loopback permitido (no SSRF).
  assert.equal(validateAiBridgeEndpoint('http://2130706433/x'), 'http://2130706433/x');
  // `user@host`: credenciales en la URL bloqueadas (paridad con validateBridgeUrl).
  assert.throws(() => validateAiBridgeEndpoint('http://evil.com@127.0.0.1/x'), /credentials/);
  console.log('[PASS] 13. SSRF IPv6 bloqueado, loopback/público intactos');

  // 14. Contrabando en manifest.json: endpoint SSRF + cover falso neutralizados al importar.
  const evilManifestConfig = {
    modelName: 'Evil',
    targetFormat: 'dual',
    complexity: 8,
    parameterSet: 0,
    masterWaveConfig: {
      promotionMethod: 'ai-bridge',
      channelLayout: 'stereo',
      targetSampleRate: 96000,
      targetBitDepth: 24,
      minLoopDurationSec: 4,
      enableBandwidthExtension: false,
      enableDenoiseGate: false,
      aiBridgeEndpoint: 'http://169.254.169.254/latest/meta-data/',
    },
    coverArtwork: {
      webpDataUrl: 'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+',
      byteLength: 10,
      width: 512,
      height: 512,
      originalName: 'cover.webp',
      updatedAt: 'now',
    },
  };
  const clean = sanitizeImportedProcessConfig(evilManifestConfig, 7) as Record<string, unknown>;
  const cleanMw = clean.masterWaveConfig as Record<string, unknown> | undefined;
  assert.ok(
    !cleanMw || (cleanMw.aiBridgeEndpoint as string) !== 'http://169.254.169.254/latest/meta-data/',
    'el endpoint SSRF del manifest no debe sobrevivir'
  );
  assert.ok(
    !clean.coverArtwork ||
      !String((clean.coverArtwork as Record<string, unknown>).webpDataUrl ?? '').startsWith('data:image/svg'),
    'el cover falso del manifest no debe sobrevivir'
  );
  // Manifest legítimo pasa intacto.
  const goodManifestConfig = {
    modelName: 'Bueno',
    targetFormat: 'dual',
    complexity: 5,
    parameterSet: 3,
    masterWaveConfig: {
      ...(evilManifestConfig.masterWaveConfig as object),
      aiBridgeEndpoint: 'http://127.0.0.1:7860/api/enhance',
    },
  };
  const good = sanitizeImportedProcessConfig(goodManifestConfig, 7) as Record<string, unknown>;
  assert.equal((good.masterWaveConfig as Record<string, unknown>).aiBridgeEndpoint, 'http://127.0.0.1:7860/api/enhance');
  assert.equal(good.complexity, 5);
  console.log('[PASS] 14. manifest malicioso neutralizado, legítimo intacto');

  // 15. Ataques vivos al bridge: traversal, slug, download ajeno, CSRF sin preflight.
  await testBridgeLiveAttacks();

  console.log('=== ALL SECURITY TESTS (PART 3) PASSED ===');
}

async function testBridgeLiveAttacks(): Promise<void> {
  const { spawn, execFileSync } = await import('node:child_process');
  try {
    execFileSync('python', ['--version'], { stdio: 'ignore' });
  } catch {
    console.log('[SKIP] 15. sin python en PATH');
    return;
  }
  const port = 17862;
  const child = spawn('python', ['bridge/server.py', '--port', String(port)], { stdio: 'ignore', detached: true });
  const kill = (): void => {
    try {
      process.kill(-child.pid as number, 'SIGKILL');
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        // noop
      }
    }
  };
  const post = async (path: string, body: unknown, origin?: string): Promise<number> => {
    const res = await fetchWithTimeout(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: {
        // text/plain = "simple request": SIN preflight (el caso CSRF real).
        'Content-Type': 'text/plain;charset=UTF-8',
        ...(origin ? { Origin: origin } : {}),
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    await res.text().catch(() => '');
    return res.status;
  };
  try {
    let healthy = false;
    for (let i = 0; i < 75; i++) {
      try {
        const h = await fetchWithTimeout(`http://127.0.0.1:${port}/api/health`, {}, 1000);
        if (h.ok) {
          healthy = true;
          break;
        }
      } catch {
        // arrancando
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.ok(healthy, 'el bridge de pruebas debe arrancar');

    // 15a. Escritura ciega CSRF (text/plain, sin preflight, Origin ajeno) → 403.
    const csrf = await post(
      '/api/fs/save_axionik_model',
      { slug: 'pwned', library_path: 'AxionikDB', files: [{ path: 'x.json', content: '{}' }] },
      'https://evil.example'
    );
    assert.equal(csrf, 403, 'CSRF ciego debe dar 403');

    // 15b. Traversal en rel_path (sin Origin, atacante local/red): la entrada
    // maligna se ignora y el fichero NO aparece fuera de la librería.
    const { existsSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const probeName = `rt_pwned_${Date.now()}.txt`;
    await post('/api/fs/save_axionik_model', {
      slug: 'okslug',
      library_path: 'AxionikDB',
      files: [{ path: `../../${probeName}`, content: 'x' }],
    });
    assert.equal(existsSync(resolve('..', probeName)), false, 'traversal no debe escribir fuera');
    assert.equal(existsSync(resolve('AxionikDB', probeName)), false, 'traversal no debe escribir dentro');

    // 15c. Slug con traversal → 400.
    const badSlug = await post('/api/fs/save_axionik_model', {
      slug: '../../evil',
      library_path: 'AxionikDB',
      files: [],
    });
    assert.equal(badSlug, 400, 'slug con .. debe dar 400');

    // 15d. URL de descarga de host no allowlistado → 400 antes de tocar red (no SSRF).
    // (No se prueba /models/download con URL válida: descargaría GB de verdad.)
    const badUrl = await post('/api/models/url', { model_id: 'audiosr', url: 'https://evil.example/x.bin' });
    assert.equal(badUrl, 400, 'URL de descarga ajena debe dar 400');

    // 15e. Endpoint inexistente → 404 con CORS estricto (no refleja Origin ajeno).
    const res404 = await fetchWithTimeout(`http://127.0.0.1:${port}/api/nope`, {
      headers: { Origin: 'https://evil.example' },
    });
    await res404.text().catch(() => '');
    assert.equal(res404.status, 404);
    assert.notEqual(res404.headers.get('access-control-allow-origin'), 'https://evil.example');
    console.log('[PASS] 15. ataques vivos bloqueados (CSRF/traversal/slug/URL/404)');
  } finally {
    kill();
  }
}

runSecurityTestsPart3().catch((err) => {
  console.error('Security test (part 3) failed:', err);
  process.exit(1);
});
