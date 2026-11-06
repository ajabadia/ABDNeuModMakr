// ─────────────────────────────────────────────────────────────
// ABDNeuModMakr — Paridad Resynator v2 WASM (el fin de la alineación manual).
//
// El artefacto public/wasm/ es EL MOTOR compilado con emcc, no un espejo.
// Este test falla en voz alta si:
//   - falta el fixture dorado (regenerar con scripts/gen-resynator-golden.ts),
//   - la ABI del artefacto no coincide con EXPECTED_RESYNATOR_ABI
//     (rebuild con build-resynator-wasm.bat),
//   - el render del artefacto no coincide con el hash dorado
//     (el sonido cambió: o es intencionado y se re-sella, o es regresión).
// Si el artefacto no existe (checkout fresco sin build), se OMITE con aviso:
// la ausencia de WASM nunca debe romper la suite, solo la paridad.
// ─────────────────────────────────────────────────────────────

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import {
  EXPECTED_RESYNATOR_ABI,
  fnv1aHex,
  renderResynatorWasm,
} from '../src/core/dsp/ResynatorV2Wasm.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const GOLDEN_PATH = path.join(REPO, 'tests/fixtures/resynator-v2-golden.json');
const ARTIFACT_PATH = path.join(
  REPO,
  'public/wasm',
  `resynator-v2-abi${EXPECTED_RESYNATOR_ABI}.js`
);

let passed = 0;
let failed = 0;

function skip(message: string): void {
  console.log(`  [SKIP] ${message}`);
}

async function main() {
  if (!existsSync(GOLDEN_PATH)) {
    console.error(
      `  [FAIL] falta el vector dorado ${GOLDEN_PATH}.\n` +
        '  Regenerar: npx tsx scripts/gen-resynator-golden.ts --model-only && ' +
        'build-resynator-wasm.bat && npx tsx scripts/gen-resynator-golden.ts'
    );
    process.exit(1);
  }
  if (!existsSync(ARTIFACT_PATH)) {
    skip(
      `artefacto WASM ausente (${ARTIFACT_PATH}). ` +
        'Compilar con ABDAxionikVS/tools/resynator-wasm/build-resynator-wasm.bat para activar la paridad.'
    );
    console.log(`\nResult: ${passed} passed, ${failed} failed (1 skipped)\n`);
    return;
  }

  const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as {
    abi: number;
    sampleRate: number;
    midi: number;
    velocity: number;
    seconds: number;
    blockSize: number;
    peak: number;
    fnv1a: string;
    modelJson: string;
  };

  // 1. El dorado debe corresponder a la ABI que el loader espera.
  try {
    assert.equal(golden.abi, EXPECTED_RESYNATOR_ABI);
    console.log('  [PASS] el vector dorado corresponde a la ABI esperada.');
    passed++;
  } catch (e) {
    console.error(`  [FAIL] dorado ABI=${golden.abi} vs esperada ${EXPECTED_RESYNATOR_ABI}: ${e}`);
    failed++;
  }

  // 2. Render con el artefacto y comparación bit a bit (hash) contra el dorado.
  try {
    const out = await renderResynatorWasm({
      modelJson: golden.modelJson,
      midiNote: golden.midi,
      velocity01: golden.velocity,
      seconds: golden.seconds,
      sampleRate: golden.sampleRate,
      blockSize: golden.blockSize,
      urlOverride: pathToFileURL(ARTIFACT_PATH).href,
    });
    assert.ok(out.peak > 1e-4, `el render dorado suena casi en silencio (peak=${out.peak})`);
    // Mismo orden que el sellado: entrelazado L,R,L,R,…
    const interleaved = new Float32Array(out.stereoL.length * 2);
    for (let i = 0; i < out.stereoL.length; i++) {
      interleaved[2 * i] = out.stereoL[i];
      interleaved[2 * i + 1] = out.stereoR[i];
    }
    const hash = fnv1aHex(new Uint8Array(interleaved.buffer));
    assert.equal(hash, golden.fnv1a);
    console.log(
      `  [PASS] el WASM reproduce el hash dorado (peak=${out.peak.toFixed(6)} fnv1a=${hash}).`
    );
    passed++;
  } catch (e) {
    console.error(
      `  [FAIL] el artefacto WASM no reproduce el vector dorado: ${e instanceof Error ? e.message : e}\n` +
        '  O el motor cambió (re-sellar con scripts/gen-resynator-golden.ts) o hay regresión.'
    );
    failed++;
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
