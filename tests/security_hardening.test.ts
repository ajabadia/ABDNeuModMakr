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

  // 4. bank cover allowlist (S4.1: 'AAAA' ya no vale — cabecera ilegible = inseguro; ver parte 15)
  assert.equal(isSafeCoverDataUrl('data:image/webp;base64,AAAA'), false);
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

// ── Parte 4 (red-team 2026-11-06, ola 2): bomba ZIP real. ──
// El vendor permite 800 MB/entrada y 1 GB total: un ZIP de ~200 KB puede
// forzar `new Uint8Array(800MB)`. `parseZipArchiveCapped` debe rechazar por
// cabecera ANTES de inflar (sin RAM, rápido). Bombas construidas de verdad
// con DEFLATE (node:zlib) + estructura ZIP manual mínima.

async function runSecurityTestsPart4(): Promise<void> {
  console.log('=== Security Hardening Suite (part 4: zip bomb) ===');
  const {
    parseZipArchiveCapped,
    APP_MAX_ZIP_ENTRY_BYTES,
    APP_MAX_ZIP_TOTAL_BYTES,
  } = await import('../src/formats/ZipArchive.ts');

  function buildDeflateZip(entries: Array<{ name: string; declaredSize: number; payload: Uint8Array }>): Uint8Array {
    const enc = new TextEncoder();
    const chunks: Uint8Array[] = [];
    const centrals: Uint8Array[] = [];
    let offset = 0;
    for (const e of entries) {
      const name = enc.encode(e.name);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 0, true);
      lh.setUint16(8, 8, true); // DEFLATE
      lh.setUint16(10, 0, true);
      lh.setUint16(12, 0, true);
      lh.setUint32(14, 0, true); // CRC: irrelevante (el parser no lo verifica; el tope es previo)
      lh.setUint32(18, e.payload.byteLength, true);
      lh.setUint32(22, e.declaredSize, true);
      lh.setUint16(26, name.length, true);
      lh.setUint16(28, 0, true);
      chunks.push(new Uint8Array(lh.buffer), name, e.payload);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(10, 8, true);
      cd.setUint32(20, e.payload.byteLength, true); // central: comp@20, uncomp@24
      cd.setUint32(24, e.declaredSize, true);
      cd.setUint16(28, name.length, true);
      cd.setUint32(42, offset, true);
      centrals.push(new Uint8Array(cd.buffer), name);
      offset += 30 + name.length + e.payload.byteLength;
    }
    const cdStart = offset;
    let cdSize = 0;
    for (const c of centrals) {
      chunks.push(c);
      cdSize += c.byteLength;
    }
    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(8, entries.length, true);
    eocd.setUint16(10, entries.length, true);
    eocd.setUint32(12, cdSize, true);
    eocd.setUint32(16, cdStart, true);
    chunks.push(new Uint8Array(eocd.buffer));
    const total = chunks.reduce((n, c) => n + c.byteLength, 0);
    const out = new Uint8Array(total);
    let p = 0;
    for (const c of chunks) {
      out.set(c, p);
      p += c.byteLength;
    }
    return out;
  }

  // DEFLATE real de 200 MB de ceros en streaming (~200 KB comprimidos, sin
  // retener jamás los 200 MB en RAM): la bomba cabe en un email.
  // OJO: DEFLATE crudo (RFC 1951, method 8), NO zlib-wrapped: `DeflateRaw`.
  const { DeflateRaw } = await import('node:zlib');
  function deflateZeros(bytes: number): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
      const d = new DeflateRaw();
      const parts: Uint8Array[] = [];
      d.on('data', (c: Uint8Array) => parts.push(c));
      d.on('end', () => {
        const total = parts.reduce((n, c) => n + c.byteLength, 0);
        const out = new Uint8Array(total);
        let p = 0;
        for (const c of parts) {
          out.set(c, p);
          p += c.byteLength;
        }
        resolve(out);
      });
      d.on('error', reject);
      const chunk = Buffer.alloc(1024 * 1024, 0);
      let left = bytes;
      const write = (): void => {
        while (left > 0) {
          const n = Math.min(left, chunk.byteLength);
          left -= n;
          if (!d.write(n === chunk.byteLength ? chunk : chunk.subarray(0, n))) {
            d.once('drain', write);
            return;
          }
        }
        d.end();
      };
      write();
    });
  }

  // 16a. Bomba clásica: 200 MB declarados (> 100 MB/entrada) en ~200 KB reales.
  const payload200 = await deflateZeros(200 * 1024 * 1024);
  assert.ok(payload200.byteLength < 1024 * 1024, `la bomba debe ser pequeña (fue ${payload200.byteLength})`);
  const bomb = buildDeflateZip([{ name: 'evil/model.bin', declaredSize: 200 * 1024 * 1024, payload: payload200 }]);
  const t0 = Date.now();
  assert.throws(() => parseZipArchiveCapped(bomb), /too large/, 'bomba 200 MB debe rechazarse por cabecera');
  assert.ok(Date.now() - t0 < 2000, 'el rechazo debe ser previo a inflar (rápido, sin RAM)');
  console.log(`[PASS] 16a. bomba DEFLATE 200 MB en ${(bomb.byteLength / 1024).toFixed(0)} KB rechazada sin inflar`);

  // 16b. Bomba distribuida: 4×90 MB (cada una legal, total 360 MB > 300 MB).
  const payload90 = payload200.subarray(0, Math.min(payload200.byteLength, 96 * 1024));
  const distBomb = buildDeflateZip(
    [0, 1, 2, 3].map((i) => ({ name: `part${i}.bin`, declaredSize: 90 * 1024 * 1024, payload: payload90 }))
  );
  assert.throws(() => parseZipArchiveCapped(distBomb), /total too large/, 'total 360 MB debe rechazarse');
  console.log('[PASS] 16b. bomba distribuida 4×90 MB rechazada por tope total');

  // 16c. Evasión por descriptor-bit: datos comprimidos que declaran 0 inflados
  // (esquivaría el tope; `inflateRaw` crecería sin cota). Debe rechazarse.
  const descriptorBomb = buildDeflateZip([{ name: 'd.bin', declaredSize: 0, payload: payload90 }]);
  assert.throws(() => parseZipArchiveCapped(descriptorBomb), /indeterminate/, 'descriptor-bit debe rechazarse');
  console.log('[PASS] 16c. evasión descriptor-bit (0 declarados + datos) rechazada');

  // 16d. Control: ZIP STORE legítimo sigue pasando por la compuerta.
  const { createZipArchive } = await import('../src/formats/ZipArchive.ts');
  const legit = createZipArchive([{ path: 'mname', data: new TextEncoder().encode('M') }]);
  const parsed = parseZipArchiveCapped(legit);
  assert.equal(parsed.length, 1, 'ZIP legítimo no debe romperse');
  assert.ok(APP_MAX_ZIP_ENTRY_BYTES === 100 * 1024 * 1024, 'tope documentado 100 MB');
  assert.ok(APP_MAX_ZIP_TOTAL_BYTES === 300 * 1024 * 1024, 'tope documentado 300 MB');
  console.log('[PASS] 16d. ZIP legítimo intacto; topes = S6.1 documentados (100 MB / 300 MB)');
}

runSecurityTestsPart4().catch((err) => {
  console.error('Security test (part 4) failed:', err);
  process.exit(1);
});

// ── Parte 5 (red-team 2026-11-06, ola 2): diálogo nativo como CSRF. ──
// `/api/fs/browse_folder` abre un diálogo del SO en el escritorio del usuario.
// Por GET simple (`<img src="http://127.0.0.1:7860/api/fs/browse_folder">`)
// una web hostil lo dispara SIN CORS y SIN preflight: es un efecto lateral
// remoto. Debe exigir el mismo token que el resto de /fs/*.

async function runSecurityTestsPart5(): Promise<void> {
  console.log('=== Security Hardening Suite (part 5: native dialog CSRF) ===');
  const { spawn, execFileSync } = await import('node:child_process');
  try {
    execFileSync('python', ['--version'], { stdio: 'ignore' });
  } catch {
    console.log('[SKIP] 17. sin python en PATH');
    return;
  }
  const port = 17863;
  const child = spawn('python', ['bridge/server.py', '--port', String(port)], {
    stdio: 'ignore',
    detached: true,
    env: { ...process.env, ABD_BRIDGE_TOKEN: 'redteam-token' },
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
    assert.ok(healthy, 'el bridge con token debe arrancar');

    // 17a. GET sin token (el vector real: <img src>) → 401, el diálogo NO se abre.
    const getNoToken = await fetchWithTimeout(
      `http://127.0.0.1:${port}/api/fs/browse_folder`,
      { headers: { Origin: 'https://evil.example' } },
      5000
    );
    await getNoToken.text().catch(() => '');
    assert.equal(getNoToken.status, 401, 'GET browse_folder sin token debe dar 401');

    // 17b. POST sin token → 401.
    const postNoToken = await fetchWithTimeout(
      `http://127.0.0.1:${port}/api/fs/browse_folder`,
      { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: '{}' },
      5000
    );
    await postNoToken.text().catch(() => '');
    assert.equal(postNoToken.status, 401, 'POST browse_folder sin token debe dar 401');

    // 17c. Token equivocado → 401.
    const wrongToken = await fetchWithTimeout(
      `http://127.0.0.1:${port}/api/fs/browse_folder`,
      { headers: { 'X-Bridge-Token': 'nope' } },
      5000
    );
    await wrongToken.text().catch(() => '');
    assert.equal(wrongToken.status, 401, 'token inválido debe dar 401');

    // 17d. Sin regresión: otra ruta de escritura protegida sigue dando 401 igual.
    const otherNoToken = await fetchWithTimeout(
      `http://127.0.0.1:${port}/api/fs/save_axionik_model`,
      { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: '{}' },
      5000
    );
    await otherNoToken.text().catch(() => '');
    assert.equal(otherNoToken.status, 401, 'otras rutas /fs/* siguen protegidas');
    console.log('[PASS] 17. diálogo nativo protegido por token (GET y POST sin bypass)');
  } finally {
    kill();
  }
}

runSecurityTestsPart5().catch((err) => {
  console.error('Security test (part 5) failed:', err);
  process.exit(1);
});

// ── Parte 6 (red-team 2026-11-06, ola 3): decodificadores de audio. ──
// WAV/AIFF/FLAC puros están acotados por los bytes reales, pero SF2 confía
// en `smpl/subSize` (u32 sin acotar) + `shdr.end` (u32 sin acotar) y CAF en
// `framesPerPacket` (multiplicador u32) + `numChannels` (u32 sin tope).
// Bombas construidas de verdad; la de SF2 tumbaba el proceso pre-fix
// (344 bytes → RSS +573 MB medidos).

function u32le(v: number): Uint8Array {
  const d = new DataView(new ArrayBuffer(4));
  d.setUint32(0, v >>> 0, true);
  return new Uint8Array(d.buffer);
}
function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of parts) {
    out.set(c, p);
    p += c.byteLength;
  }
  return out;
}
function riffChunk(id: string, data: Uint8Array): Uint8Array {
  const head = new Uint8Array(8);
  head.set(new TextEncoder().encode(id), 0);
  new DataView(head.buffer).setUint32(4, data.byteLength, true);
  return concatBytes([head, data, new Uint8Array(data.byteLength & 1)]);
}
function riffList(type: string, subs: Uint8Array[]): Uint8Array {
  return riffChunk('LIST', concatBytes([new TextEncoder().encode(type), ...subs]));
}
function sf2Rec38(pbagNdx: number): Uint8Array {
  const r = new Uint8Array(38);
  new DataView(r.buffer).setUint16(24, pbagNdx, true);
  return r;
}
function sf2Bag(genNdx: number): Uint8Array {
  const r = new Uint8Array(4);
  new DataView(r.buffer).setUint16(0, genNdx, true);
  return r;
}
function sf2Gen(oper: number, amount: number): Uint8Array {
  const r = new Uint8Array(4);
  const v = new DataView(r.buffer);
  v.setUint16(0, oper, true);
  v.setUint16(2, amount, true);
  return r;
}
function sf2Inst22(ibagNdx: number): Uint8Array {
  const r = new Uint8Array(22);
  new DataView(r.buffer).setUint16(20, ibagNdx, true);
  return r;
}
function sf2Shdr(name: string, start: number, end: number, rate: number): Uint8Array {
  const r = new Uint8Array(46);
  r.set(new TextEncoder().encode(name.padEnd(20, ' ').slice(0, 20)), 0);
  const v = new DataView(r.buffer);
  v.setUint32(20, start >>> 0, true);
  v.setUint32(24, end >>> 0, true);
  v.setUint32(28, start >>> 0, true);
  v.setUint32(32, end >>> 0, true);
  v.setUint32(36, rate >>> 0, true);
  return r;
}
/** `.sf2` mínimo válido con tamaños parametrizables (bomba o legítimo). */
function buildSf2File(smplDeclared: number, smplReal: number, shdrEnd: number, rate = 44100): Uint8Array {
  const sdta = riffList('sdta', [
    concatBytes([new TextEncoder().encode('smpl'), u32le(smplDeclared), new Uint8Array(smplReal)]),
  ]);
  const pdta = riffList('pdta', [
    riffChunk('phdr', concatBytes([sf2Rec38(0), sf2Rec38(1)])),
    riffChunk('pbag', concatBytes([sf2Bag(0), sf2Bag(1)])),
    riffChunk('pgen', sf2Gen(41, 0)),
    riffChunk('inst', concatBytes([sf2Inst22(0), sf2Inst22(1)])),
    riffChunk('ibag', concatBytes([sf2Bag(0), sf2Bag(1)])),
    riffChunk('igen', sf2Gen(53, 0)),
    riffChunk('shdr', concatBytes([sf2Shdr('evil', 0, shdrEnd, rate), new Uint8Array(46)])),
  ]);
  const chunks = concatBytes([sdta, pdta]);
  const out = new Uint8Array(12 + chunks.byteLength);
  out.set(new TextEncoder().encode('RIFF'), 0);
  new DataView(out.buffer).setUint32(4, 4 + chunks.byteLength, true);
  out.set(new TextEncoder().encode('sfbk'), 8);
  out.set(chunks, 12);
  return out;
}
function cafChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.byteLength);
  out.set(new TextEncoder().encode(type), 0);
  new DataView(out.buffer).setUint32(8, data.byteLength, false);
  out.set(data, 12);
  return out;
}
/** `.caf` mínimo con `desc` parametrizable (bomba o legítimo). */
function buildCafFile(framesPerPacket: number, numChannels: number, dataLen: number): Uint8Array {
  const desc = new Uint8Array(32);
  const v = new DataView(desc.buffer);
  v.setFloat64(0, 44100, false);
  desc.set(new TextEncoder().encode('lpcm'), 8);
  v.setUint32(16, 0, false);
  v.setUint32(20, framesPerPacket >>> 0, false);
  v.setUint32(24, numChannels >>> 0, false);
  v.setUint32(28, 16, false);
  const head = new Uint8Array(8);
  head.set(new TextEncoder().encode('caff'), 0);
  head[5] = 1;
  return concatBytes([head, cafChunk('desc', desc), cafChunk('data', new Uint8Array(4 + dataLen))]);
}

async function runSecurityTestsPart6(): Promise<void> {
  console.log('=== Security Hardening Suite (part 6: audio decoders) ===');
  const { decodeCaf, decodeWav, APP_MAX_AUDIO_CHANNELS } = await import('../src/core/dsp/WavDecoder.ts');
  const { importSf2PresetToNativeCapped } = await import('../src/formats/Sf2Parser.ts');

  // 19a. Bomba SF2: 344 bytes que declaran smpl=1 GB + end=100M frames
  // (pre-fix medido: RSS 83→656 MB). La compuerta la rechaza en ~1 ms.
  const sf2Bomb = buildSf2File(0x40000000, 8, 100_000_000);
  assert.ok(sf2Bomb.byteLength < 1024, 'la bomba SF2 debe caber en 1 KB');
  const t0 = Date.now();
  assert.throws(
    () => importSf2PresetToNativeCapped(sf2Bomb.buffer as ArrayBuffer, 0),
    /out of bounds/,
    'SF2 mentiroso debe rechazarse por cabecera'
  );
  assert.ok(Date.now() - t0 < 2000, 'el rechazo debe ser previo a asignar muestras');
  console.log('[PASS] 19a. bomba SF2 (344 B → 100M frames) rechazada sin asignar');

  // 19b. Solo `smpl` miente (shdr legítimo pequeño) → también se rechaza.
  const sf2SmplLiar = buildSf2File(0x40000000, 8, 4);
  assert.throws(
    () => importSf2PresetToNativeCapped(sf2SmplLiar.buffer as ArrayBuffer, 0),
    /smpl size/,
    'smpl declarado > bytes reales debe rechazarse'
  );
  console.log('[PASS] 19b. SF2 con smpl mentiroso rechazado');

  // 19c. SF2 legítimo (mismo camino de código) importa sin romperse.
  const sf2Legit = buildSf2File(8, 8, 4);
  const legitRes = importSf2PresetToNativeCapped(sf2Legit.buffer as ArrayBuffer, 0);
  assert.ok(legitRes.audioFiles.length >= 1, 'SF2 legítimo debe producir audio');
  console.log('[PASS] 19c. SF2 legítimo intacto por el mismo camino');

  // 19d. Bomba CAF: 168 bytes, framesPerPacket=20M ⇒ 500M frames predichos
  // (pre-fix: intento de reserva de GB + RangeError garantizado).
  const cafBomb = buildCafFile(20_000_000, 2, 100);
  assert.throws(
    () => decodeCaf(cafBomb.buffer as ArrayBuffer),
    /frames-per-packet|declared frames/,
    'CAF con multiplicador absurdo debe rechazarse'
  );
  console.log('[PASS] 19d. bomba CAF (168 B → 500M frames) rechazada por cabecera');

  // 19e. CAF con 4 G canales (bucle de millones de `push`) → rechazado.
  const cafChBomb = buildCafFile(64, 0xffffffff, 100);
  assert.throws(
    () => decodeCaf(cafChBomb.buffer as ArrayBuffer),
    /channel count/,
    'CAF con canales absurdos debe rechazarse'
  );
  assert.equal(APP_MAX_AUDIO_CHANNELS, 32, 'tope documentado 32 canales');
  console.log('[PASS] 19e. CAF con canales mentirosos rechazado');

  // 19f. Controles legítimos: CAF mínimo y WAV PCM16 mínimo decodifican.
  const cafLegit = decodeCaf(buildCafFile(1, 1, 16).buffer as ArrayBuffer);
  assert.equal(cafLegit.numSamples, 8, 'CAF legítimo (16 B mono 16-bit → 8 frames)');
  const fmt = new Uint8Array(16);
  const fv = new DataView(fmt.buffer);
  fv.setUint16(0, 1, true);
  fv.setUint16(2, 1, true);
  fv.setUint32(4, 44100, true);
  fv.setUint32(8, 88200, true);
  fv.setUint16(12, 2, true);
  fv.setUint16(14, 16, true);
  const wavLegit = decodeWav(
    concatBytes([
      new TextEncoder().encode('RIFF'), u32le(44), new TextEncoder().encode('WAVE'),
      new TextEncoder().encode('fmt '), u32le(16), fmt,
      new TextEncoder().encode('data'), u32le(16), new Uint8Array(16),
    ]).buffer as ArrayBuffer
  );
  assert.equal(wavLegit.numSamples, 8, 'WAV legítimo intacto tras la compuerta');
  console.log('[PASS] 19f. CAF/WAV legítimos decodifican igual que antes');
}

runSecurityTestsPart6().catch((err) => {
  console.error('Security test (part 6) failed:', err);
  process.exit(1);
});

// ── Parte 7 (red-team 2026-11-06, ola 5): bomba cuadrática SFZ. ──
// El vendor fusiona `{...global, ...master, ...group, ...region}` POR REGIÓN
// sin acotar opcodes/bloque: N opcodes × R regiones = R×N copias.
// Bomba real: 232 KB → RSS 84→1767 MB en 26 s (medido pre-fix).

function buildSfzQuadro(globalOpcodes: number, regions: number): string {
  let g = '<global>';
  for (let i = 0; i < globalOpcodes; i++) g += ` k${String(i).padStart(5, '0')}=1`;
  let r = '';
  for (let i = 0; i < regions; i++) r += '<region>sample=a.wav key=60\n';
  return g + '\n' + r;
}

async function runSecurityTestsPart7(): Promise<void> {
  console.log('=== Security Hardening Suite (part 7: SFZ quadratic) ===');
  const { importSfzToNativeCapped, MAX_SFZ_OPCODES_PER_BLOCK } = await import(
    '../src/formats/SfzParser.ts'
  );

  // 20a. Bomba cuadrática real: 232 KB que pre-fix costaban 1,7 GB / 26 s.
  const bomb = buildSfzQuadro(20000, 2048);
  assert.ok(bomb.length < 256 * 1024, 'la bomba debe caber en 256 KB');
  const t0 = Date.now();
  assert.throws(
    () => importSfzToNativeCapped(bomb, 'evil.sfz', []),
    /exceeds cap/,
    'SFZ cuadrático debe rechazarse por bloque antes de fusionar'
  );
  assert.ok(Date.now() - t0 < 2000, 'el rechazo debe ser previo al merge R×N');
  assert.equal(MAX_SFZ_OPCODES_PER_BLOCK, 128, 'tope documentado 128 opcodes/bloque');
  console.log('[PASS] 20a. bomba SFZ cuadrática (232 KB → 1,7 GB) rechazada en ms');

  // 20b. SFZ legítimo con global+group+regiones importa igual que antes.
  const legit =
    '<global>volume=0\n<group>lokey=36 hikey=72\n' +
    '<region>sample=piano_c4.wav key=60\n<region>sample=piano_g4.wav lokey=61 hikey=72 pitch_keycenter=67\n';
  const res = importSfzToNativeCapped(legit, 'piano.sfz', []);
  assert.equal(res.extendedRegions.length, 2, 'SFZ legítimo: 2 regiones');
  console.log('[PASS] 20b. SFZ legítimo intacto por el mismo camino');

  // 20c. `sample=` con ruta hostil no escapa: el parser solo usa basename.
  const trav = importSfzToNativeCapped(
    '<region>sample=../../../../etc/evil.wav key=60\n',
    't.sfz',
    []
  );
  const name0 = (trav.extendedRegions[0] as unknown as { sampleName?: string }).sampleName ?? '';
  assert.ok(!name0.includes('..') && !name0.includes('/'), `basename a salvo: ${name0}`);
  console.log('[PASS] 20c. sample= con traversal queda en basename (sin escape)');
}

runSecurityTestsPart7().catch((err) => {
  console.error('Security test (part 7) failed:', err);
  process.exit(1);
});

// ── Parte 8 (red-team 2026-11-06, ola 6): presets-monstruo (.dspreset/.nki). ──
// El vendor parsea definiciones de texto sin tope de tamaño y devuelve
// `regions` sin tope: un `.nki` de 31 MB con 200k `<zone>` se parseaba entero
// (1,6 s) y sus 200k regiones fluían a `session.zones` → UI muerta.
// La compuerta vive en `parseUniversalSamplerCapped` (texto > 8 MB y
// > 16384 regiones; los `.nki` binarios cifrados no huelen a texto y no se tocan).

function buildNkiZones(n: number): Uint8Array {
  let s = '<?xml version="1.0"?><kontakt-instrument name="evil">';
  for (let i = 0; i < n; i++) s += `<zone sample="s${i}.wav" rootKey="60" lowKey="0" highKey="127"/>`;
  return new TextEncoder().encode(s + '</kontakt-instrument>');
}
function buildDsSamples(n: number): Uint8Array {
  let s = '<?xml version="1.0"?><DecentSampler><groups><group>';
  for (let i = 0; i < n; i++) s += `<sample path="s${i}.wav" rootNote="60" loNote="0" hiNote="127"/>`;
  return new TextEncoder().encode(s + '</group></groups></DecentSampler>');
}

async function runSecurityTestsPart8(): Promise<void> {
  console.log('=== Security Hardening Suite (part 8: preset monsters) ===');
  const {
    parseUniversalSamplerCapped,
    MAX_SAMPLER_DEFINITION_TEXT_BYTES,
    MAX_SAMPLER_PRESET_REGIONS,
  } = await import('../src/core/import/rawSamplerParsers.ts');

  // 21a. `.dspreset` de ~9 MB (> 8 MB): rechazo pre-parse, sin DOM.
  const huge = buildDsSamples(150000);
  assert.ok(huge.byteLength > 8 * 1024 * 1024, 'el monstruo debe superar 8 MB');
  const t0 = Date.now();
  await assert.rejects(
    parseUniversalSamplerCapped('evil.dspreset', huge.buffer as ArrayBuffer, new Map()),
    /too large/,
    'definición gigante debe rechazarse antes de parsear'
  );
  assert.ok(Date.now() - t0 < 2000, 'el rechazo por tamaño debe ser inmediato');
  assert.equal(MAX_SAMPLER_DEFINITION_TEXT_BYTES, 8 * 1024 * 1024, 'tope 8 MB');
  console.log('[PASS] 21a. dspreset de 9 MB rechazado pre-parse');

  // 21b. 20k zonas bajo el tope de tamaño: rechazo por conteo post-parse.
  const many = buildNkiZones(20000);
  assert.ok(many.byteLength < 8 * 1024 * 1024, 'debe entrar bajo el tope de tamaño');
  await assert.rejects(
    parseUniversalSamplerCapped('evil.nki', many.buffer as ArrayBuffer, new Map()),
    /too many region/,
    '20k regiones deben rechazarse aunque el fichero sea "pequeño" (pre-conteo o post-parse)'
  );
  assert.equal(MAX_SAMPLER_PRESET_REGIONS, 16384, 'tope 16384 regiones');
  console.log('[PASS] 21b. nki con 20k zonas rechazado por conteo');

  // 21c. Legítimos mínimos (dspreset + nki) parsean igual que antes.
  const okDs = await parseUniversalSamplerCapped(
    'p.dspreset',
    new TextEncoder().encode(
      '<?xml version="1.0"?><DecentSampler><groups><group><sample path="a.wav" rootNote="60" loNote="0" hiNote="127"/></group></groups></DecentSampler>'
    ).buffer as ArrayBuffer,
    new Map()
  );
  const okNki = await parseUniversalSamplerCapped(
    'p.nki',
    new TextEncoder().encode(
      '<?xml version="1.0"?><kontakt-instrument name="p"><zone sample="a.wav" rootKey="60" lowKey="0" highKey="127"/></kontakt-instrument>'
    ).buffer as ArrayBuffer,
    new Map()
  );
  assert.equal(okDs.regions.length, 1, 'dspreset legítimo: 1 región');
  assert.equal(okNki.regions.length, 1, 'nki legítimo: 1 región');
  console.log('[PASS] 21c. presets legítimos intactos por el mismo camino');
}

runSecurityTestsPart8().catch((err) => {
  console.error('Security test (part 8) failed:', err);
  process.exit(1);
});

// ── Parte 9 (red-team 2026-11-06, ola 7): CPU-DoS bajo las compuertas. ──
// El tope post-parse de la ola 6 llegaba tarde: 7,3 MB con 190k `<sample>`
// sin cerrar quemaban 4,3 s de hilo principal (2,2 s la variante `.nki`)
// antes del rechazo. El coste es ~lineal en coincidencias, así que la
// compuerta pre-cuenta etiquetas con `indexOf` antes del parse del vendor.

async function runSecurityTestsPart9(): Promise<void> {
  console.log('=== Security Hardening Suite (part 9: CPU-DoS under the gates) ===');
  const { parseUniversalSamplerCapped } = await import('../src/core/import/rawSamplerParsers.ts');
  const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
  const bomb = (open: (i: number) => string, root: [string, string], n: number) => {
    let s = '<?xml version="1.0"?>' + root[0];
    for (let i = 0; i < n; i++) s += open(i);
    return enc(s + root[1]);
  };

  // 22a. Bomba dspreset (7,3 MB, el peor caso medido de la ola 7): rechazo
  // pre-parse rápido, sin quemar segundos de hilo principal.
  const dsBomb = bomb(
    (i) => `<sample path="s${i}.wav" rootNote="60">`,
    ['<DecentSampler><groups><group>', '</group></groups></DecentSampler>'],
    190000
  );
  assert.ok(dsBomb.byteLength > 7 * 1024 * 1024, 'la bomba debe rozar el tope de 8 MB');
  let t0 = Date.now();
  await assert.rejects(
    parseUniversalSamplerCapped('r.dspreset', dsBomb, new Map()),
    /pre-parse/,
    '190k tags deben rechazarse antes del parse caro'
  );
  assert.ok(Date.now() - t0 < 1000, `rechazo pre-parse rápido (fue ${Date.now() - t0}ms; pre-fix: 4258ms)`);
  console.log('[PASS] 22a. bomba dspreset 7,3 MB rechazada pre-parse en ms');

  // 22b. Variante nki (pre-fix: 2229 ms).
  const nkiBomb = bomb(
    (i) => `<zone sample="s${i}.wav" rootKey="60">`,
    ['<kontakt-instrument name="r">', '</kontakt-instrument>'],
    190000
  );
  t0 = Date.now();
  await assert.rejects(
    parseUniversalSamplerCapped('r.nki', nkiBomb, new Map()),
    /pre-parse/,
    '190k zonas deben rechazarse antes del parse caro'
  );
  assert.ok(Date.now() - t0 < 1000, `rechazo pre-parse rápido (fue ${Date.now() - t0}ms; pre-fix: 2229ms)`);
  console.log('[PASS] 22b. bomba nki 7,1 MB rechazada pre-parse en ms');

  // 22c. El pre-conteo imita `\b` del vendor en ambas direcciones:
  // `<samples>` (envoltorio) NO cuenta, `<sample-x>` (el vendor lo casa) SÍ.
  let manyWrappers = '<?xml version="1.0"?><DecentSampler><groups><group>';
  for (let i = 0; i < 20000; i++) manyWrappers += '<samples></samples>';
  manyWrappers += '<sample path="a.wav" rootNote="60"/></group></groups></DecentSampler>';
  await assert.doesNotReject(
    parseUniversalSamplerCapped('w.dspreset', enc(manyWrappers), new Map()),
    '20k envoltorios `<samples>` no deben trippear el pre-conteo'
  );
  let dashTags = '<?xml version="1.0"?><DecentSampler><groups><group>';
  for (let i = 0; i < 17000; i++) dashTags += `<sample-x path="s${i}.wav"/>`;
  dashTags += '</group></groups></DecentSampler>';
  await assert.rejects(
    parseUniversalSamplerCapped('x.dspreset', enc(dashTags), new Map()),
    /pre-parse/,
    '`<sample-x>` debe contar (el vendor lo casa vía \\b)'
  );
  console.log('[PASS] 22c. límite de palabra del pre-conteo fiel al vendor');
}

runSecurityTestsPart9().catch((err) => {
  console.error('Security test (part 9) failed:', err);
  process.exit(1);
});

// ── Parte 10 (red-team 2026-11-06, ola 8): bomba gzip `.adv` + discos. ──
// `unpackAbletonAdvXml` inflaba gzip SIN tope (217 KB → 55 MB medidos sin
// que saltase ninguna compuerta). La compuerta infla con tope (8 MB) y pasa
// el XML como string al vendor. Los discos vintage (9 magias + 0xFF) mueren
// en ms: documentado como verificado (bucles acotados/visited).

async function runSecurityTestsPart10(): Promise<void> {
  console.log('=== Security Hardening Suite (part 10: adv gzip bomb) ===');
  const { gzipSync } = await import('node:zlib');
  const { parseUniversalSamplerCapped } = await import('../src/core/import/rawSamplerParsers.ts');
  const ab = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
  const advXml = (n: number) =>
    '<Ableton><MultiSampleMap>' +
    '<MultiSamplePart><KeyRange><Min Value="0"/><Max Value="127"/></KeyRange></MultiSamplePart>'.repeat(n) +
    '</MultiSampleMap></Ableton>';

  // 23a. Bomba gzip honesta (~11 MB desde ~40 KB, ratio ~280:1): el inflado
  // acotado la corta sin llegar al parse (pre-fix: 55 MB en memoria, PASA).
  const bomb = gzipSync(Buffer.from(advXml(100000)));
  assert.ok(bomb.byteLength < 100 * 1024, 'la bomba debe caber en un email');
  const t0 = Date.now();
  await assert.rejects(
    parseUniversalSamplerCapped('evil.adv', ab(bomb), new Map()),
    /inflates too large/,
    'gzip bomb debe morir en el inflado acotado'
  );
  assert.ok(Date.now() - t0 < 3000, `rechazo rápido (fue ${Date.now() - t0}ms)`);
  console.log('[PASS] 23a. bomba gzip .adv cortada en el inflado');

  // 23b. `.adv` legítimo (gzip pequeño y XML plano) intacto por el camino.
  const okGz = gzipSync(
    Buffer.from(
      '<?xml version="1.0"?><Ableton><MultiSampleMap><SamplePart><KeyRange><Min Value="60"/><Max Value="60"/></KeyRange></SamplePart></MultiSampleMap></Ableton>'
    )
  );
  await assert.doesNotReject(
    parseUniversalSamplerCapped('ok.adv', ab(okGz), new Map()),
    '.adv gzip legítimo debe pasar'
  );
  await assert.doesNotReject(
    parseUniversalSamplerCapped('ok2.adv', advXml(2), new Map()),
    '.adv plano (string) legítimo debe pasar'
  );
  // 23c. `.adv` plano con 20k partes (bajo 8 MB): lo corta el pre-conteo.
  await assert.rejects(
    parseUniversalSamplerCapped('evil2.adv', advXml(20000), new Map()),
    /too many region/,
    '20k MultiSamplePart deben rechazarse pre-parse'
  );
  console.log('[PASS] 23b/c. .adv legítimo intacto; monstruo plano cortado');
}

runSecurityTestsPart10().catch((err) => {
  console.error('Security test (part 10) failed:', err);
  process.exit(1);
});

// ── Parte 11 (red-team 2026-11-06, ola 9): gzip MPC3 + SINF mentiroso. ──
// `gunzip` de MPC-XPM no tenía tope (28 KB → 9,4 MB PASA) y `decompressRx2`
// reservaba `Float32Array(totalFrames)` con el u32 del SINF sin validar:
// 56 bytes con totalFrames=0xFFFFFFFF → intento de 16 GB y cuelgue total
// (> 100 s sin retorno; solo matando el proceso). El ZIP con entradas
// solapadas está contenido (S6.1 corta por cabecera; documentado).

async function runSecurityTestsPart11(): Promise<void> {
  console.log('=== Security Hardening Suite (part 11: xpm gzip + rx2 frames) ===');
  const { gzipSync } = await import('node:zlib');
  const { parseUniversalSamplerCapped } = await import('../src/core/import/rawSamplerParsers.ts');
  const { decompressRx2AudioCapped, assertRx2SizeSafe } = await import('../src/core/dsp/DwopDecompressor.ts');
  const ab = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

  // 24a. Bomba gzip MPC3 válida (300k instrumentos, 9,4 MB desde 28 KB).
  const inst = '{"name":"i","layersv":[{"l":1}]}';
  const bigJson =
    '{"data":{"program":{"name":"evil","instruments":[' + Array(300000).fill(inst).join(',') + ']}}}';
  const bomb = gzipSync(Buffer.from(bigJson));
  assert.ok(bomb.byteLength < 100 * 1024, 'la bomba debe caber en un email');
  const t0 = Date.now();
  await assert.rejects(
    parseUniversalSamplerCapped('evil.xpm', ab(bomb), new Map()),
    /inflates too large/,
    'gzip bomb MPC3 debe morir en el inflado acotado'
  );
  assert.ok(Date.now() - t0 < 3000, `rechazo rápido (fue ${Date.now() - t0}ms)`);
  console.log('[PASS] 24a. bomba gzip .xpm cortada en el inflado');

  // 24b. `.xpm` legítimo intacto: MPC3 gzip pequeño y MPC2 XML plano.
  const okJson = '{"data":{"program":{"name":"ok","instruments":[{"name":"i","layersv":[{"l":1}]}]}}}';
  await assert.doesNotReject(
    parseUniversalSamplerCapped('ok.xpm', ab(gzipSync(Buffer.from(okJson))), new Map()),
    'MPC3 gzip legítimo debe pasar'
  );
  const mpc2layer = (i: number) =>
    `<Layer number="${i}"><SampleName>s${i}.wav</SampleName><RootNote>60</RootNote></Layer>`;
  const mpc2wrap = (layers: string) =>
    `<MPCVObject><Program type="Drum"><ProgramName>ok</ProgramName>` +
    `<Instrument number="1">${layers ? `<Layers>${layers}</Layers>` : ''}</Instrument></Program></MPCVObject>`;
  let mpc2layers = '';
  for (let i = 0; i < 10; i++) mpc2layers += mpc2layer(i);
  await assert.doesNotReject(
    parseUniversalSamplerCapped('ok2.xpm', mpc2wrap(mpc2layers), new Map()),
    'MPC2 XML legítimo debe pasar'
  );
  let mpc2evil = '';
  for (let i = 0; i < 20000; i++) mpc2evil += mpc2layer(i);
  mpc2evil = mpc2wrap(mpc2evil);
  await assert.rejects(
    parseUniversalSamplerCapped('evil2.xpm', mpc2evil, new Map()),
    /too many region/,
    '20k Layer deben rechazarse pre-parse'
  );
  console.log('[PASS] 24b. .xpm legítimo intacto; monstruo MPC2 cortado');

  // 24c. REX2 con SINF mentiroso (56 B, 0xFFFFFFFF): antes colgaba el
  // proceso; ahora rechazo en ms. Un SINF honesto-pequeño pasa la compuerta.
  const evilRx2 = (() => {
    const b = new Uint8Array(56);
    const w = (off: number, s: string) => { for (let i = 0; i < s.length; i++) b[off + i] = s.charCodeAt(i); };
    const u32 = (off: number, v: number) => new DataView(b.buffer).setUint32(off, v, false);
    w(0, 'CAT '); u32(4, 48); w(8, 'REX2');
    w(12, 'SINF'); u32(16, 18); b[20] = 1; b[21] = 0; u32(22, 44100); u32(26, 0xffffffff); u32(30, 0); u32(34, 0);
    w(38, 'DWOP'); u32(42, 8);
    return b.buffer as ArrayBuffer;
  })();
  const t1 = Date.now();
  assert.throws(
    () => decompressRx2AudioCapped(evilRx2, 'evil.rx2'),
    /too many frames/,
    'SINF con 4G frames debe rechazarse sin reservar nada'
  );
  assert.ok(Date.now() - t1 < 3000, `rechazo rápido (fue ${Date.now() - t1}ms)`);
  const okRx2 = evilRx2.slice(0);
  new DataView(okRx2).setUint32(26, 1000, false);
  assert.doesNotThrow(() => assertRx2SizeSafe(okRx2, 'ok.rx2'), 'SINF honesto debe pasar la compuerta');
  console.log('[PASS] 24c. REX2 mentiroso rechazado en ms; SINF honesto pasa');
}

runSecurityTestsPart11().catch((err) => {
  console.error('Security test (part 11) failed:', err);
  process.exit(1);
});

// ── Parte 12 (red-team 2026-11-06, ola 10): map.script gigante + .dwp monstruo. ──
// `parseMapScript` troceaba sin tope (30 MB basura → 503 ms + 225 MB RSS;
// 1 GB tumbaría la pestaña) y `.dwp` apilaba zonas sin pre-conteo binario.
// `decodeNcw` es inalcanzable (solo lo importa un test) y `parseDwpChunks`
// está acotado por el buffer: verificados sin amplificación.

async function runSecurityTestsPart12(): Promise<void> {
  console.log('=== Security Hardening Suite (part 12: map.script cap + dwp zones) ===');
  const { APP_MAX_MAP_SCRIPT_TEXT_BYTES, assertMapScriptBufferSafe, parseMapScriptCapped } =
    await import('../src/formats/ModelFormat.ts');
  const { parseUniversalSamplerCapped } = await import('../src/core/import/rawSamplerParsers.ts');

  // 25a. map.script de 2 MB: muere por bytes y por texto, sin trocear nada.
  const bigText = 'x'.repeat(2 * 1024 * 1024);
  assert.throws(
    () => parseMapScriptCapped(bigText, 'evil-model'),
    /map\.script too large/,
    'texto gigante debe rechazarse antes del split'
  );
  assert.throws(
    () => assertMapScriptBufferSafe(new Uint8Array(2 * 1024 * 1024), 'evil-model'),
    /map\.script too large/,
    'buffer gigante debe rechazarse antes de decodificar'
  );
  assert.ok(APP_MAX_MAP_SCRIPT_TEXT_BYTES === 1024 * 1024, 'tope 1 MB (40x del canónico)');
  console.log('[PASS] 25a. map.script gigante cortado por bytes y por texto');

  // 25b. map.script canónico intacto (formato 1027 líneas, cuenta zonas).
  const canon = [
    'MapVersionMajor 0', 'MapVersionMinor 9', 'MapVersionBuild 2',
    '000LowKey 48', '000HiKey 52', '000RootKey 50', '000LowSource 1', '000HiSource 2',
    '001LowKey 53', '001HiKey 60', '001RootKey 57', '001LowSource 3',
  ].join('\n');
  const ms = parseMapScriptCapped(canon, 'ok-model');
  assert.strictEqual(ms.activeZones.length, 2, 'dos zonas activas');
  assert.strictEqual(ms.activeZones[0].sampleLow, '000001.scape', 'mapea al .scape');
  console.log('[PASS] 25b. map.script canónico intacto');

  // 25c. `.dwp` con 100k contenedores (2,8 MB) muere en el tope post-parse;
  // uno legítimo de 1 zona pasa. (parseDwpChunks ya es O(n) acotado.)
  const le32 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff];
  const mkContainer = () => {
    const sub = [...le32(0x0004), ...le32(5), ...le32(0), ...[0x73, 0x2e, 0x77, 0x61, 0x76]];
    return [...le32(0x0003), ...le32(sub.length), ...le32(0), ...sub];
  };
  const head = [...[0x44, 0x77, 0x50, 0x72], ...new Array(0x5a - 4).fill(0),
    ...le32(0x0066), ...le32(4), ...le32(0), ...[0x54, 0x65, 0x73, 0x74]];
  const evilParts = [...head];
  for (let i = 0; i < 100000; i++) evilParts.push(...mkContainer());
  const t0 = Date.now();
  await assert.rejects(
    parseUniversalSamplerCapped('evil.dwp', new Uint8Array(evilParts).buffer as ArrayBuffer, new Map()),
    /too many regions/,
    '100k zonas .dwp deben morir en el tope post-parse'
  );
  assert.ok(Date.now() - t0 < 5000, `rechazo rápido (fue ${Date.now() - t0}ms)`);
  const okDwp = new Uint8Array([...head, ...mkContainer(), ...le32(0x0002), ...le32(0), ...le32(0)]);
  const ok = await parseUniversalSamplerCapped('ok.dwp', okDwp.buffer as ArrayBuffer, new Map());
  assert.strictEqual(ok.regions.length, 1, '.dwp de 1 zona intacto');
  console.log('[PASS] 25c. .dwp monstruo cortado; legítimo intacto');
}

runSecurityTestsPart12().catch((err) => {
  console.error('Security test (part 12) failed:', err);
  process.exit(1);
});

// Ola 11 — ZIP-anidado: el vendor indexaba y extraía CADA entrada del
// `.zip`/`.xpn` sin topes propios, y las compuertas S6.7–S6.7d solo miraban
// el fichero exterior. Un `.dspreset` con 190k etiquetas sin cerrar metido
// en un `.xpn` de 4 MB esquivaba el pre-conteo y colgaba el hilo > 100 s
// (cuadrático medido: 2k→93 ms, 8k→1,5 s, 20k→7,2 s); un `.xpm` gzip
// anidado se inflaba sin tope. `assertZipContentsSafe` replica las
// compuertas planas por entrada + recurre en zips anidados (tope prof. 3).

async function runSecurityTestsPart13(): Promise<void> {
  console.log('=== Security Hardening Suite (part 13: nested-zip sweep) ===');
  const { createZipArchive } = await import('../src/formats/ZipArchive.ts');
  const { gzipSync } = await import('node:zlib');
  const { listZipSamplerProgramsCapped, parseUniversalSamplerCapped } =
    await import('../src/core/import/rawSamplerParsers.ts');
  const enc = (s: string) => new TextEncoder().encode(s);
  const ab = (u: Uint8Array) => u.buffer as ArrayBuffer;

  // 26a. dspreset anidado con 190k etiquetas sin cerrar (4 MB en `.xpn`):
  // pre-fix colgaba > 100 s; ahora muere en el pre-conteo por entrada.
  const cpuXml = `<DecentSampler><ui/><groups><group>${'<sample rootNote="60"'.repeat(190000)}</group></groups></DecentSampler>`;
  const cpuXpn = createZipArchive([{ path: 'cpu.dspreset', data: enc(cpuXml) }]);
  let t0 = Date.now();
  await assert.rejects(
    parseUniversalSamplerCapped('nested.xpn', ab(cpuXpn), new Map()),
    /pre-parse/,
    'dspreset anidado debe morir en el pre-conteo, no colgar el hilo'
  );
  await assert.rejects(
    listZipSamplerProgramsCapped('nested.xpn', ab(cpuXpn)),
    /pre-parse/,
    'el listado también debe barrer antes de extraer'
  );
  let dt = Date.now() - t0;
  assert.ok(dt < 15000, `rechazo anidado rápido (fue ${dt}ms; pre-fix: >100000ms)`);
  console.log('[PASS] 26a. dspreset anidado cortado sin colgar');

  // 26b. `.xpm` gzip válido anidado (30k capas): el inflado anidado ya no
  // es libre — o cabe y muere en el tope post-parse, sin amplificación.
  const layers: string[] = [];
  for (let i = 0; i < 30000; i++) layers.push(`{"sampleName":"s${i}.wav","rootNote":60}`);
  const mpcJson = `{"data":{"name":"B","type":0,"bank":[{"layersv":[${layers.join(',')}]}]}}`;
  const nestedGz = new Uint8Array(gzipSync(Buffer.from(mpcJson, 'utf8')));
  const xpmXpn = createZipArchive([{ path: 'prog.xpm', data: nestedGz }]);
  t0 = Date.now();
  await assert.rejects(
    parseUniversalSamplerCapped('nested2.xpn', ab(xpmXpn), new Map()),
    /too many regions/,
    '30k capas anidadas deben morir en el tope post-parse'
  );
  dt = Date.now() - t0;
  assert.ok(dt < 30000, `resolución acotada (fue ${dt}ms)`);
  console.log('[PASS] 26b. xpm gzip anidado acotado');

  // 26c. Legítimo anidado intacto: dspreset mínimo en `.xpn` parsea y lista.
  const tinyDs = '<?xml version="1.0"?><DecentSampler><groups><group>' +
    '<sample path="a.wav" rootNote="60"/></group></groups></DecentSampler>';
  const okXpn = createZipArchive([{ path: 'ok.dspreset', data: enc(tinyDs) }]);
  await assert.doesNotReject(
    parseUniversalSamplerCapped('ok.xpn', ab(okXpn), new Map()),
    'dspreset mínimo anidado no debe trippear el barrido'
  );
  const listed = await listZipSamplerProgramsCapped('ok.xpn', ab(okXpn));
  assert.ok(Array.isArray(listed), 'el listado anidado sigue funcionando');
  console.log('[PASS] 26c. legítimo anidado intacto');
}

runSecurityTestsPart13().catch((err) => {
  console.error('Security test (part 13) failed:', err);
  process.exit(1);
});

// Ola 12 — fuzz mutacional de prefijos sobre las compuertas nuevas: un
// prefijo (espacios/BOM) esquivaba la compuerta de olor de 8 MB porque el
// vendor hace `trimStart()` en varias rutas (`.xpm` acepta JSON con
// espacios delante). 12,8 MB de JSON con 64 espacios se `JSON.parseaba`
// entero (+195 MB RSS) y solo moría en el tope post-parse; `.grp`/` .tvpst`
// eludían todo por no oler a texto. F7/F10/F11/F12 verificados sin hallazgo
// (adv con prefijo devuelve preset vacío en 5 ms; dwp desplazado, map.script
// con BOM y ncw directo rechazan limpio).

async function runSecurityTestsPart14(): Promise<void> {
  console.log('=== Security Hardening Suite (part 14: prefix-mutation fuzz) ===');
  const { createZipArchive } = await import('../src/formats/ZipArchive.ts');
  const { gzipSync } = await import('node:zlib');
  const { parseUniversalSamplerCapped } =
    await import('../src/core/import/rawSamplerParsers.ts');
  const enc = (s: string) => new TextEncoder().encode(s);
  const ab = (u: Uint8Array) => u.buffer as ArrayBuffer;
  const SP = ' '.repeat(64);
  const BOM = '\uFEFF';
  // ~8,5 MB JSON (200k capas): pre-fix con prefijo se parseaba entero
  // (+100 MB RSS) y moría en regiones; post-fix muere por tamaño en ms.
  const layers: string[] = [];
  for (let i = 0; i < 200000; i++) layers.push(`{"sampleName":"s${i}.wav","rootNote":60}`);
  const json = `{"data":{"name":"B","type":0,"bank":[{"layersv":[${layers.join(',')}]}]}}`;
  assert.ok(json.length > 8 * 1024 * 1024, 'el cebo debe superar los 8 MB');

  // 27a–27b. JSON `.xpm` con prefijo de espacios/BOM: olor tras prefijo.
  for (const [tag, body] of [['espacios', SP + json], ['BOM', BOM + json]] as const) {
    await assert.rejects(
      parseUniversalSamplerCapped('p.xpm', ab(enc(body)), new Map()),
      /too large/,
      `JSON con prefijo ${tag} debe morir por tamaño, no parsearse`
    );
  }
  console.log('[PASS] 27a–27b. prefijos espacios/BOM ya no eluden los 8 MB');

  // 27c. Lo mismo anidado en `.xpn` (barrido S6.7f).
  const nx = createZipArchive([{ path: 'p.xpm', data: enc(SP + json) }]);
  await assert.rejects(
    parseUniversalSamplerCapped('n.xpn', ab(nx), new Map()),
    /too large/,
    'anidado con prefijo debe morir por tamaño en el barrido'
  );
  console.log('[PASS] 27c. anidado con prefijo cortado en el barrido');

  // 27d. `.grp` TSV de 1 MB con prefijo anidado: el vendor lo decodifica
  // como texto sin condición, así que el tope crudo aplica (S6.7g).
  const rows = ['File Path\tLow Midi Note\tHigh Velocity\tPitch in Hertz\tLoop Start'];
  for (let i = 0; i < 350000; i++) rows.push(`s${i}.wav\t0\t127\t440.0\t-1`);
  const grp = SP + rows.join('\n');
  assert.ok(grp.length > 8 * 1024 * 1024, 'el TSV debe superar los 8 MB');
  const gx = createZipArchive([{ path: 'g.grp', data: enc(grp) }]);
  let t0 = Date.now();
  await assert.rejects(
    parseUniversalSamplerCapped('n.xpn', ab(gx), new Map()),
    /too large/,
    '.grp anidado debe morir por tamaño, no por regiones'
  );
  assert.ok(Date.now() - t0 < 5000, 'rechazo rápido');
  console.log('[PASS] 27d. .grp anidado (texto incondicional) acotado');

  // 27e. Sin falsos positivos: JSON mínimo con prefijo importa, dspreset
  // con prefijo importa, y adv-gzip con prefijo se resuelve en ms.
  const tiny = '{"data":{"name":"T","type":0,"bank":[{"layersv":[' +
    '{"sampleName":"a.wav","rootNote":60},{"sampleName":"b.wav","rootNote":62}]}]}}';
  const okXpm = await parseUniversalSamplerCapped('t.xpm', ab(enc(SP + BOM + tiny)), new Map());
  assert.strictEqual(okXpm.regions.length, 2, 'xpm mínimo con prefijo intacto');
  const tinyDs = '  \n' + BOM +
    '<?xml version="1.0"?><DecentSampler><groups><group>' +
    '<sample path="a.wav" rootNote="60"/></group></groups></DecentSampler>';
  await assert.doesNotReject(
    parseUniversalSamplerCapped('t.dspreset', ab(enc(tinyDs)), new Map()),
    'dspreset con prefijo no debe trippear la compuerta'
  );
  const gz = new Uint8Array(gzipSync(Buffer.from('<Ableton></Ableton>', 'utf8')));
  const prefixed = new Uint8Array(enc(SP).length + gz.length);
  prefixed.set(enc(SP), 0); prefixed.set(gz, enc(SP).length);
  t0 = Date.now();
  await parseUniversalSamplerCapped('a.adv', ab(prefixed), new Map()).catch(() => undefined);
  assert.ok(Date.now() - t0 < 5000, `adv con prefijo se resuelve rápido (fue ${Date.now() - t0}ms)`);
  console.log('[PASS] 27e. legítimos con prefijo intactos; adv resuelve en ms');
}

runSecurityTestsPart14().catch((err) => {
  console.error('Security test (part 14) failed:', err);
  process.exit(1);
});

// Ola 13 — bomba de descompresión vía cover: un data-URL de 66 chars
// declaraba gigapíxeles (PNG 40000×40000 = 6,4 GB de bitmap en el
// renderer al mostrar el cover importado) y pasaba la compuerta S4, que
// solo miraba prefijo y longitud. S4.1 lee la cabecera (PNG IHDR@16,
// WebP VP8/VP8L/VP8X) y topa a 2048 px (máximo del generador propio).

async function runSecurityTestsPart15(): Promise<void> {
  console.log('=== Security Hardening Suite (part 15: cover dimensions) ===');
  const { isSafeCoverDataUrl, MAX_COVER_DIMENSION_PX } =
    await import('../src/core/bankService.ts');
  assert.strictEqual(MAX_COVER_DIMENSION_PX, 2048, 'tope 2048 px = clamp del generador');
  const b64 = (a: number[]) => Buffer.from(a).toString('base64');
  const png = (w: number, h: number) => 'data:image/png;base64,' + b64([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
    0x49, 0x48, 0x44, 0x52,
    (w >>> 24) & 255, (w >>> 16) & 255, (w >>> 8) & 255, w & 255,
    (h >>> 24) & 255, (h >>> 16) & 255, (h >>> 8) & 255, h & 255,
    8, 2, 0, 0, 0,
  ]);
  const vp8 = (w: number, h: number) => {
    const ww = w & 0x3fff, hh = h & 0x3fff;
    return 'data:image/webp;base64,' + b64([
      0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
      0x56, 0x50, 0x38, 0x20, 0x10, 0, 0, 0,
      0x10, 0x00, 0x00, 0x9d, 0x01, 0x2a, ww & 255, (ww >>> 8) & 255, hh & 255, (hh >>> 8) & 255,
    ]);
  };

  // 28a. Bombas de 66–71 chars (pre-fix: `true`).
  assert.strictEqual(isSafeCoverDataUrl(png(40000, 40000)), false, 'PNG 40000² debe rechazarse');
  assert.strictEqual(isSafeCoverDataUrl(png(100000, 100000)), false, 'PNG 100000² debe rechazarse');
  assert.strictEqual(isSafeCoverDataUrl(vp8(16383, 16383)), false, 'VP8 máximo debe rechazarse');
  console.log('[PASS] 28a. bombas gigapíxel rechazadas');

  // 28b. Cabeceras mutadas: truncada, ceros, dimensión 0, borde 2049.
  assert.strictEqual(isSafeCoverDataUrl('data:image/png;base64,iVBOR'), false, 'truncada');
  assert.strictEqual(isSafeCoverDataUrl('data:image/png;base64,' + b64(new Array(40).fill(0))), false, 'ceros');
  assert.strictEqual(isSafeCoverDataUrl(png(0, 512)), false, 'ancho 0');
  assert.strictEqual(isSafeCoverDataUrl(png(2049, 2049)), false, 'borde 2049');
  assert.strictEqual(isSafeCoverDataUrl(vp8(0, 0)), false, 'VP8 cero');
  console.log('[PASS] 28b. cabeceras mutadas rechazadas (fail-closed)');

  // 28c. Legítimos intactos: PNG 1×1/512/2048 y VP8 512×300.
  assert.strictEqual(isSafeCoverDataUrl(png(1, 1)), true, 'PNG 1×1');
  assert.strictEqual(isSafeCoverDataUrl(png(512, 512)), true, 'PNG 512');
  assert.strictEqual(isSafeCoverDataUrl(png(2048, 2048)), true, 'PNG 2048 (tope)');
  assert.strictEqual(isSafeCoverDataUrl(vp8(512, 300)), true, 'VP8 512×300');
  console.log('[PASS] 28c. legítimos intactos hasta 2048 px');

  // 28d. Comportamiento previo retenido: gif/svg fuera, >700k fuera.
  assert.strictEqual(
    isSafeCoverDataUrl('data:image/gif;base64,R0lGODdhAQABAIAAAP///////ywAAAAAAQABAAACAkQBADs='),
    false, 'gif fuera de allowlist'
  );
  assert.strictEqual(isSafeCoverDataUrl('data:image/png;base64,' + 'A'.repeat(700000)), false, 'oversize');
  console.log('[PASS] 28d. allowlist y tope de longitud retenidos');
}

runSecurityTestsPart15().catch((err) => {
  console.error('Security test (part 15) failed:', err);
  process.exit(1);
});

// Ola 14 — barrido sin hallazgo: 37 formatos binarios con ceros/basura
// (magia + rechazo limpio, sin cuelgues), tamaños de chunk mentirosos
// (DLS/SXT/AKP/KMP/YSFC con `size` 4G), contadores WAV/AIFF (`smpl` 4G,
// `cue` 4G, RF64 `ds64` 4G, MARK 0xFFFF + sustain-loop, SSND offset 4G,
// COMM frames 4G, canales 0/99) y JSON de sesión con 200k de anidado:
// todo acotado por bytes reales o rechazo en ms. Se fijan como regresión.

async function runSecurityTestsPart16(): Promise<void> {
  console.log('=== Security Hardening Suite (part 16: binary + chunk lies) ===');
  const { parseUniversalSamplerCapped } =
    await import('../src/core/import/rawSamplerParsers.ts');
  const { decodeWav, decodeAiff } = await import('../src/core/dsp/WavDecoder.ts');
  const { parseSessionJson } = await import('../src/core/sessionSchema.ts');
  const ab = (u: Uint8Array) => u.buffer as ArrayBuffer;

  // 29a. Binarios con ceros/basura (4 KB): magia o rechazo, siempre rápido.
  let seed = 987654321;
  const rnd = new Uint8Array(4096);
  for (let i = 0; i < rnd.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; rnd[i] = seed & 255; }
  const zeros = new Uint8Array(4096);
  for (const ext of ['kmp', 'exb', 'akp', 'nicnt', 'krz', 's3p', 'sxt', 'dls']) {
    const t0 = Date.now();
    await parseUniversalSamplerCapped(`z.${ext}`, ab(zeros.slice()), new Map()).catch(() => undefined);
    await parseUniversalSamplerCapped(`r.${ext}`, ab(rnd.slice()), new Map()).catch(() => undefined);
    assert.ok(Date.now() - t0 < 5000, `${ext} se resuelve rápido`);
  }
  console.log('[PASS] 29a. binarios con basura: sin cuelgue ni amplificación');

  // 29b. Mentiras WAV: canales imposibles rechazan; `data size` 4G se
  // recorta a los bytes reales (100 frames).
  const wav = new Uint8Array(44 + 200); const wv = new DataView(wav.buffer);
  const ws = (o: number, s: string) => { for (let i = 0; i < s.length; i++) wv.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); wv.setUint32(4, 236, true); ws(8, 'WAVE');
  ws(12, 'fmt '); wv.setUint32(16, 16, true);
  wv.setUint16(20, 1, true); wv.setUint16(22, 1, true); wv.setUint32(24, 8000, true);
  wv.setUint32(28, 16000, true); wv.setUint16(32, 2, true); wv.setUint16(34, 16, true);
  ws(36, 'data'); wv.setUint32(40, 200, true);
  const wavMut = (off: number, size: 2 | 4, v: number) => {
    const c = wav.slice(); const d = new DataView(c.buffer);
    if (size === 2) d.setUint16(off, v, true); else d.setUint32(off, v, true);
    return ab(c);
  };
  assert.throws(() => decodeWav(wavMut(22, 2, 0)), 'canales 0 rechazan');
  assert.throws(() => decodeWav(wavMut(22, 2, 99)), 'canales 99 rechazan');
  assert.strictEqual(decodeWav(wavMut(40, 4, 0xffffff00)).mono.length, 100, 'data mentiroso recortado');
  console.log('[PASS] 29b. mentiras WAV acotadas por bytes reales');

  // 29c. Mentiras AIFF: MARK 0xFFFF + sustain-loop devuelve 100 frames;
  // SSND con offset 4G rechaza limpio.
  const n = 100, ssndPayload = 8 + n * 2;
  const formSize = 4 + 26 + 28 + 20 + (8 + ssndPayload);
  const abuf = new ArrayBuffer(8 + formSize); const av = new DataView(abuf);
  const aws = (o: number, s: string) => { for (let i = 0; i < s.length; i++) av.setUint8(o + i, s.charCodeAt(i)); };
  aws(0, 'FORM'); av.setUint32(4, formSize, false); aws(8, 'AIFF');
  aws(12, 'COMM'); av.setUint32(16, 18, false);
  av.setUint16(20, 1, false); av.setUint32(22, n, false); av.setUint16(26, 16, false);
  av.setUint16(28, 0x400e, false); av.setUint32(30, (44100 << 16) >>> 0, false); av.setUint32(34, 0, false);
  aws(38, 'INST'); av.setUint32(42, 20, false);
  aws(66, 'MARK'); av.setUint32(70, 12, false);
  av.setUint16(74, 1, false); av.setUint16(76, 7, false); av.setUint32(78, 9, false);
  av.setUint8(82, 1); av.setUint8(83, 65);
  aws(86, 'SSND'); av.setUint32(90, ssndPayload, false);
  av.setUint32(94, 0, false); av.setUint32(98, 0, false);
  for (let i = 0; i < n; i++) av.setInt16(102 + i * 2, 1000, false);
  const aMut = (fn: (v: DataView) => void) => {
    const c = new Uint8Array(abuf.slice(0)); fn(new DataView(c.buffer)); return ab(c);
  };
  assert.strictEqual(
    decodeAiff(aMut((v) => {
      v.setUint16(74, 0xffff, false);
      v.setUint16(54, 1, false); v.setUint16(56, 7, false); v.setUint16(58, 7, false);
    })).mono.length, 100, 'MARK mentiroso acotado al chunk'
  );
  assert.throws(
    () => decodeAiff(aMut((v) => { v.setUint32(94, 0xffffff00, false); })),
    'SSND con offset 4G rechaza'
  );
  console.log('[PASS] 29c. mentiras AIFF acotadas');

  // 29d. Sesión con 200k niveles de anidado JSON: rechazo rápido.
  const deep = '{"session":{"id":"s","name":"t","zones":[],"deep":' + '['.repeat(200000) + ']'.repeat(200000) + '}}';
  const t0 = Date.now();
  assert.throws(() => parseSessionJson(deep), 'anidado profundo rechazado');
  assert.ok(Date.now() - t0 < 5000, 'rechazo rápido');
  console.log('[PASS] 29d. sesión con anidado profundo rechazada');
}

runSecurityTestsPart16().catch((err) => {
  console.error('Security test (part 16) failed:', err);
  process.exit(1);
});

// Ola 15 — CPU-DoS en parseo de slices: el vendor itera `Num slices` del
// chunk WAV `atem` (número JSON sin tope: 2B → cuelgue >120 s) y `count`
// de SLIC/slce/MARK en FORM/CAT (u32 sin tope: 4G → ~27 s) sin acotar por
// los bytes reales. `parseSliceFileCapped` pre-valida (tope 4096 +
// capacidad en bytes) y limita el fallback de texto a 8 MB.

async function runSecurityTestsPart17(): Promise<void> {
  console.log('=== Security Hardening Suite (part 17: slice counters) ===');
  const { parseSliceFileCapped } =
    await import('../src/core/dsp/SliceFileParser.ts');
  const asc = (s: string) => [...s].map((c) => c.charCodeAt(0));
  const u32le = (v: number) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  const u32be = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const ab = (u: Uint8Array) => u.buffer as ArrayBuffer;

  // 30a. WAV `atem` con `Num slices` = 2B (~60 B): rechazo en ms, no cuelgue.
  const evilJson = '{"value0":{"Num slices":2000000000}}';
  const evilBytes = [...asc(evilJson), 0];
  while (evilBytes.length % 2) evilBytes.push(0);
  const evilWav = new Uint8Array([...asc('RIFF'), ...u32le(200), ...asc('WAVE'),
    ...asc('atem'), ...u32le(evilBytes.length), ...evilBytes]);
  let t0 = Date.now();
  assert.throws(() => parseSliceFileCapped(ab(evilWav), 'evil.wav'), /bad slice count/);
  assert.ok(Date.now() - t0 < 5000, 'atem mentiroso: rechazo rápido');
  console.log('[PASS] 30a. `atem` con 2B slices rechazado sin cuelgue');

  // 30b. REX2 FORM con SLIC count = 4G (20 B): rechazo en ms, no ~27 s.
  const evilRx2 = new Uint8Array([...asc('FORM'), ...u32be(24), ...asc('REX2'),
    ...asc('SLIC'), ...u32be(12), ...u32be(0xffffffff), ...u32be(0)]);
  t0 = Date.now();
  assert.throws(() => parseSliceFileCapped(ab(evilRx2), 'evil.rx2'), /bad slice count/);
  assert.ok(Date.now() - t0 < 5000, 'SLIC mentiroso: rechazo rápido');
  console.log('[PASS] 30b. SLIC con 4G rechazado sin cuelgue');

  // 30c. Legítimo intacto: WAV con `atem` de 2 slices + texto >8 MB capado.
  const goodJson = '{"value0":{"Num slices":2,"Slice 0":{"Start":0,"End":100},"Slice 1":{"Start":100,"End":200}}}';
  const goodBytes = [...asc(goodJson), 0];
  while (goodBytes.length % 2) goodBytes.push(0);
  const goodWav = new Uint8Array([...asc('RIFF'), ...u32le(300), ...asc('WAVE'),
    ...asc('fmt '), ...u32le(16), 1, 0, 1, 0, 0x40, 0x1f, 0, 0, 0x80, 0x3e, 0, 0, 2, 0, 16, 0,
    ...asc('data'), ...u32le(200), ...new Array(200).fill(0),
    ...asc('atem'), ...u32le(goodBytes.length), ...goodBytes]);
  const good = parseSliceFileCapped(ab(goodWav), 'good.wav');
  assert.ok(good && good.sliceFrames.length === 2, 'slices legítimos intactos');
  assert.throws(
    () => parseSliceFileCapped('x\n'.repeat(5 * 1024 * 1024), 'big.txt'),
    'texto de slices >8 MB rechazado'
  );
  console.log('[PASS] 30c. slices legítimos intactos; texto gigante capado');
}

runSecurityTestsPart17().catch((err) => {
  console.error('Security test (part 17) failed:', err);
  process.exit(1);
});
