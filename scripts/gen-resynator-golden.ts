// Genera tests/fixtures/resynator-v2-golden.json — el vector dorado que ata el
// artefacto WASM al motor real. Flujo:
//   1. `npx tsx scripts/gen-resynator-golden.ts --model-only`  (sin WASM: solo el modelo)
//   2. `build-resynator-wasm.bat`                              (compila + humo con ese modelo)
//   3. `npx tsx scripts/gen-resynator-golden.ts`               (renderiza con el WASM y sella el hash)
// El test tests/resynatorWasmParity.test.ts falla si el hash cambia.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { buildAxionikExpandedModel } from '../src/core/expandedModelWriter.ts';
import { fnv1aHex } from '../src/core/dsp/ResynatorV2Wasm.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const FIXTURE = path.join(REPO, 'tests/fixtures/resynator-v2-golden.json');

const SAMPLE_RATE = 44100;
const MIDI = 57; // A3 = 220 Hz, la f0 del stub espectral
const VELOCITY = 0.8;
const SECONDS = 1;

const PARTIALS = 16;
const FRAMES = 8;

const soundingSpectral = {
  frameCount: FRAMES,
  frameSpanHz: 50,
  gridFixed: true,
  ampsOf: (f?: number) => {
    const frame = f ?? 0;
    const out = new Float32Array(PARTIALS);
    for (let p = 0; p < PARTIALS; p++) {
      out[p] = 0.3 * Math.exp(-p * 0.35) * Math.exp(-frame * 0.15);
    }
    return out;
  },
  offsetsOf: () => new Float32Array(PARTIALS).fill(0),
  f0At: () => 220,
  isLayered: () => false,
  layerCount: 0,
  numFramesOf: () => 0,
  ampsOfLayer: () => new Float32Array(0),
  offsetsOfLayer: () => new Float32Array(0),
  f0AtLayer: () => 0,
  layerNameAt: () => '',
  layerWeightAt: () => 0,
  frameWeightAt: () => 0,
};

async function main() {
  const modelOnly = process.argv.includes('--model-only');
  const doc = buildAxionikExpandedModel({
    slot: 1,
    modelName: 'Golden',
    expandedName: 'Golden Extended',
    spectral: soundingSpectral,
    regions: [
      {
        id: 'g1',
        sampleName: 'Golden_A3.wav',
        lowKey: 36,
        highKey: 84,
        rootKey: 57,
        lowVel: 1,
        highVel: 127,
        detune: 0,
        volume: 0,
        pan: 0,
        pitchKeytrack: 100,
        trigger: 'attack',
        keyFadeIn: 0,
        keyFadeOut: 0,
        velFadeIn: 0,
        velFadeOut: 0,
        fadeCurve: 'equal-power',
        loopMode: 'loop_continuous',
        loopStart: 32,
        loopEnd: 224,
        loopCrossfadeMs: 5,
        sampleStartFrame: 0,
        sampleEndFrame: 256,
      },
    ],
    processConfig: {
      modelNumber: 1,
      modelName: 'Golden',
      expandedName: 'Golden Extended',
      complexity: 8,
      parameterSet: 2,
    },
  } as never);
  const modelJson = JSON.stringify(doc);

  if (modelOnly) {
    // El humo del build necesita los modelos antes de que exista el WASM:
    // se guardan sueltos y el paso completo los recoge después.
    const tmp = path.join(REPO, 'tests/fixtures/resynator-v2-model.json');
    await mkdir(path.dirname(tmp), { recursive: true });
    await writeFile(tmp, modelJson, 'utf8');
    console.log(`modelo fixture escrito en ${tmp} (${modelJson.length} bytes)`);
    // Segundo fixture: documento GRANDE (extensiones + superficie + sbs).
    // El humo lo carga para vigilar el STACK_SIZE del build: con la pila WASM
    // por defecto (64 KB) la carga aborta; con 4 MB suena. Si esto falla,
    // no tocar el DSP: revisar los flags de emcc en build-resynator-wasm.ps1.
    const bigStub = {
      ...soundingSpectral,
      frameCount: 24,
      ampsOf: (f?: number) => {
        const frame = f ?? 0;
        const out = new Float32Array(64);
        for (let p = 0; p < 64; p++) {
          out[p] = 0.3 * Math.exp(-p * 0.35) * Math.exp(-frame * 0.05);
        }
        return out;
      },
    };
    const bigDoc = buildAxionikExpandedModel({
      slot: 1,
      modelName: 'Large',
      expandedName: 'Large Stress',
      spectral: bigStub,
      spectralBySample: { 'Stress_A3.wav': bigStub },
      regions: [
        {
          id: 'g1',
          sampleName: 'Stress_A3.wav',
          lowKey: 36,
          highKey: 84,
          rootKey: 57,
          lowVel: 1,
          highVel: 127,
          detune: 0,
          volume: 0,
          pan: 0,
          pitchKeytrack: 100,
          trigger: 'attack',
          keyFadeIn: 0,
          keyFadeOut: 0,
          velFadeIn: 0,
          velFadeOut: 0,
          fadeCurve: 'equal-power',
          loopMode: 'loop_continuous',
          loopStart: 32,
          loopEnd: 224,
          loopCrossfadeMs: 5,
          sampleStartFrame: 0,
          sampleEndFrame: 256,
        },
      ],
      processConfig: {
        modelNumber: 1,
        modelName: 'Large',
        expandedName: 'Large Stress',
        complexity: 8,
        parameterSet: 2,
      },
      populateAdvancedSpectralExtensions: true,
      buildUnifiedSurface: true,
    } as never);
    const bigJson = JSON.stringify(bigDoc);
    const bigTmp = path.join(REPO, 'tests/fixtures/resynator-v2-large.json');
    await writeFile(bigTmp, bigJson, 'utf8');
    console.log(`fixture grande escrito en ${bigTmp} (${bigJson.length} bytes)`);
    return;
  }

  const abiInfo = JSON.parse(
    await readFile(path.join(REPO, 'public/wasm/resynator-v2-abi.json'), 'utf8')
  );
  const wasmUrl = pathToFileURL(path.join(REPO, 'public', abiInfo.artifact)).href;
  const factory = (await import(wasmUrl)).default;
  const mod = await factory();
  if (mod.ccall('resynCreate', 'number', ['number'], [SAMPLE_RATE]) !== 1) {
    throw new Error('resynCreate falló');
  }
  if (
    mod.ccall('resynLoadModel', 'number', ['string', 'number'], [modelJson, modelJson.length]) !== 1
  ) {
    const errPtr = mod.ccall('resynLastError', 'number', [], []);
    throw new Error(`el WASM rechazó el modelo dorado: ${mod.UTF8ToString(errPtr)}`);
  }
  mod.ccall('resynNoteOn', null, ['number', 'number'], [MIDI, VELOCITY]);
  const total = Math.floor(SAMPLE_RATE * SECONDS);
  const BLOCK = 512;
  let peak = 0;
  const chunks: number[] = [];
  for (let done = 0; done < total; done += BLOCK) {
    const n = Math.min(BLOCK, total - done);
    const ptr: number = mod.ccall('resynRenderBlock', 'number', ['number'], [n]);
    if (!ptr) throw new Error('resynRenderBlock devolvió null');
    const start = ptr / 4;
    for (let i = 0; i < n * 2; i++) {
      const v = mod.HEAPF32[start + i] as number;
      if (!Number.isFinite(v)) throw new Error('muestra no finita en el dorado');
      chunks.push(v);
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
  }
  const bytes = new Uint8Array(new Float32Array(chunks).buffer);
  const hash = fnv1aHex(bytes);
  await mkdir(path.dirname(FIXTURE), { recursive: true });
  await writeFile(
    FIXTURE,
    JSON.stringify(
      {
        comment:
          'Vector dorado Resynator v2: render offline del MOTOR (WASM) con el fixture. Si el hash cambia, cambió el sonido: o es intencionado (regenerar) o es regresión.',
        abi: abiInfo.abi,
        sampleRate: SAMPLE_RATE,
        midi: MIDI,
        velocity: VELOCITY,
        seconds: SECONDS,
        blockSize: BLOCK,
        peak,
        fnv1a: hash,
        modelJson,
      },
      null,
      1
    ),
    'utf8'
  );
  console.log(`dorado sellado en ${FIXTURE}: peak=${peak.toFixed(6)} fnv1a=${hash}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
