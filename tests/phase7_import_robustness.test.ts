// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Phase 7: Import Robustness Verification Suite
// WAV truncado, SF2 con subSize absurdo, ZIP bomba, SFZ oversize,
// y escape XSS de nombres de fichero.
// ─────────────────────────────────────────────────────────

import assert from 'node:assert/strict';
import { decodeWav } from '../src/core/dsp/WavDecoder.ts';
import { listSf2Presets, MAX_SF2_PRESETS } from '../src/formats/Sf2Parser.ts';
import {
  importSfzToNative,
  MAX_SFZ_TEXT_BYTES,
  MAX_SFZ_REGIONS,
} from '../src/formats/SfzParser.ts';
import {
  createZipArchive,
  parseZipArchive,
  inflateRaw,
  MAX_ZIP_ENTRIES,
  MAX_ZIP_ENTRY_BYTES,
} from '@abdsynths/shared/formats/neuron';
import { escAttr, escHtml } from '../src/ui/escape.ts';

function buildMinimalSf2WithHugePhdr(): ArrayBuffer {
  // RIFF/sfbk > LIST pdta > phdr con subSize absurdo pero buffer real pequeño.
  // safeRecordCount debe clampar por bytes reales y no colgar.
  const total = 64;
  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  const write4 = (off: number, s: string): void => {
    for (let i = 0; i < 4; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  write4(0, 'RIFF');
  view.setUint32(4, total - 8, true);
  write4(8, 'sfbk');
  write4(12, 'LIST');
  view.setUint32(16, 40, true);
  write4(20, 'pdta');
  write4(24, 'phdr');
  view.setUint32(28, 0xffffff00, true); // subSize mentiroso: ~111M records
  // Solo 12 bytes reales de payload antes de acabar el buffer
  write4(32, 'EOP_');
  return buf;
}

async function runPhase7Tests(): Promise<void> {
  console.log('=== ABDNeuModMakr Phase 7 Import Robustness Suite ===');

  // 1. WAV truncado / magia inválida debe lanzar, no colgar ni devolver basura
  assert.throws(() => decodeWav(new ArrayBuffer(10)), /too small/);
  const badMagic = new ArrayBuffer(64);
  new DataView(badMagic).setUint8(0, 65); // 'A' en vez de RIFF
  assert.throws(() => decodeWav(badMagic), /RIFF|FORM/);
  console.log('[PASS] 1. WAV truncado y magia inválida rechazan limpio');

  // 2. SF2 con subSize absurdo: debe fallar rápido (throw), nunca colgar
  const t0 = Date.now();
  assert.throws(() => listSf2Presets(buildMinimalSf2WithHugePhdr()), /SF2/);
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 2000, `SF2 absurdo debe resolverse rápido (fueron ${elapsed}ms)`);
  assert.ok(MAX_SF2_PRESETS <= 512, 'cap de presets SF2 presente');
  console.log('[PASS] 2. SF2 con subSize absurdo clampado sin hang');

  // 3. ZIP: inflate con expectedSize mentiroso debe rechazar antes de allocar
  assert.throws(
    () => inflateRaw(new Uint8Array([1, 2, 3]), MAX_ZIP_ENTRY_BYTES + 1),
    /too large/
  );
  // ZIP vacío/truncado devuelve [] sin lanzar
  assert.deepEqual(parseZipArchive(new Uint8Array(0)), []);
  assert.deepEqual(parseZipArchive(new Uint8Array([0, 1, 2, 3])), []);
  // Cap de entradas: 2500 entradas pequeñas se recortan a MAX_ZIP_ENTRIES
  const many = Array.from({ length: MAX_ZIP_ENTRIES + 500 }, (_, i) => ({
    path: `f${i}.txt`,
    data: new Uint8Array([65]),
  }));
  const zipBytes = createZipArchive(many);
  const parsed = parseZipArchive(zipBytes);
  assert.ok(
    parsed.length <= MAX_ZIP_ENTRIES,
    `entradas recortadas a ${MAX_ZIP_ENTRIES} (fueron ${parsed.length})`
  );
  console.log('[PASS] 3. ZIP bomba contenida (entry/total caps + EOCD clamp)');

  // 4. SFZ oversize y tope de regiones
  const huge = 'a'.repeat(MAX_SFZ_TEXT_BYTES + 1);
  assert.throws(() => importSfzToNative(huge, 'huge.sfz'), /too large/);
  const manyRegions = Array.from(
    { length: MAX_SFZ_REGIONS + 500 },
    (_, i) => `<region> sample=s${i}.wav key=${i % 128}`
  ).join('\n');
  const res = importSfzToNative(manyRegions, 'many.sfz');
  assert.ok(
    res.extendedRegions.length <= MAX_SFZ_REGIONS,
    `regiones SFZ recortadas a ${MAX_SFZ_REGIONS}`
  );
  console.log('[PASS] 4. SFZ oversize rechazado y regiones topadas');

  // 5. Escape XSS: payload clásico no sobrevive ni en texto ni en atributo
  const payload = `"><img src=x onerror=alert(1)><script>alert(2)</script>'"&<>`;
  const h = escHtml(payload);
  const a = escAttr(payload);
  for (const out of [h, a]) {
    assert.ok(!out.includes('<img'), 'sin tags crudos');
    assert.ok(!out.includes('<script'), 'sin script crudo');
    assert.ok(out.includes('&lt;'), 'escapa <');
    assert.ok(out.includes('&gt;'), 'escapa >');
    assert.ok(out.includes('&quot;'), 'escapa "');
    assert.ok(out.includes('&#39;'), "escapa '");
    assert.ok(out.includes('&amp;'), 'escapa &');
  }
  assert.equal(escHtml(null), '');
  assert.equal(escAttr(undefined), '');
  console.log('[PASS] 5. escHtml/escAttr neutralizan payload XSS');

  console.log('=== ALL PHASE 7 TESTS PASSED ===');
}

runPhase7Tests().catch((err) => {
  console.error('Phase 7 test failed:', err);
  process.exit(1);
});
