// ─────────────────────────────────────────────────────────────
// ABDNeuModMakr — Loader del motor Resynator v2 REAL (WebAssembly).
//
// Fuente de la verdad: `AxionikExpandedSynthesizer.h` compilado con emcc
// (ver ABDAxionikVS/tools/resynator-wasm/). Este fichero NO contiene DSP:
// carga el artefacto, comprueba la ABI en voz alta y ofrece render offline.
//
// Si la versión ABI del artefacto no coincide con EXPECTED_RESYNATOR_ABI,
// se lanza un error ruidoso (rebuild: build-resynator-wasm.bat). Nunca se
// reproduce audio de una versión desconocida en silencio.
// ─────────────────────────────────────────────────────────────

export const EXPECTED_RESYNATOR_ABI = 1;

/**
 * Tamaño de pila con el que se compila el artefacto (`-sSTACK_SIZE=4MB` en
 * `build-resynator-wasm.ps1`). El parser JSON del motor es recursivo y los
 * documentos reales (extensiones avanzadas + superficie + multi-muestra)
 * agotan los 64 KB de pila WASM por defecto: la carga abortaba con
 * `memory access out of bounds`. Con 4 MB cargan y suenan (verificado:
 * documento de 93 KB, peak 0.194). No es un cambio de DSP, es de build.
 */
export const RESYNATOR_WASM_STACK_BYTES = 4 * 1024 * 1024;

export interface ResynatorWasmModule {
  ccall(
    name: string,
    returnType: string | null,
    argTypes: string[],
    args: unknown[]
  ): number | null;
  UTF8ToString(ptr: number): string;
  HEAPF32: Float32Array;
}

/** FNV-1a (32 bit) sobre bytes — compartido entre el sellado y el test. */
export function fnv1aHex(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function wasmUrl(urlOverride?: string): string {
  if (urlOverride) return urlOverride;
  const base =
    (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  const root = base.endsWith('/') ? base : `${base}/`;
  return `${root}wasm/resynator-v2-abi${EXPECTED_RESYNATOR_ABI}.js`;
}

let cached: Promise<ResynatorWasmModule> | null = null;

/** Carga el motor una sola vez; comprueba la ABI y falla en voz alta si no cuadra. */
export function loadResynatorWasm(urlOverride?: string): Promise<ResynatorWasmModule> {
  if (!cached) {
    cached = (async () => {
      const url = wasmUrl(urlOverride);
      let factory: (() => Promise<ResynatorWasmModule>) | undefined;
      try {
        factory = (await import(/* @vite-ignore */ url)).default;
      } catch (e) {
        throw new Error(
          `[resynator-wasm] no se pudo cargar ${url}: ${e instanceof Error ? e.message : e}. ` +
            'Reconstruye el artefacto con ABDAxionikVS/tools/resynator-wasm/build-resynator-wasm.bat'
        );
      }
      const mod = await factory!();
      const abi = mod.ccall('resynAbiVersion', 'number', [], []) as number;
      if (abi !== EXPECTED_RESYNATOR_ABI) {
        throw new Error(
          `[resynator-wasm] ABI del artefacto (${abi}) != esperada (${EXPECTED_RESYNATOR_ABI}). ` +
            'El motor cambió sin rebuild: ejecuta build-resynator-wasm.bat y actualiza EXPECTED_RESYNATOR_ABI si el cambio es intencionado.'
        );
      }
      return mod;
    })();
  }
  return cached;
}

/** Solo para tests: olvida el módulo cacheado (p.ej. para probar otro artefacto). */
export function __resetResynatorWasmForTests(): void {
  cached = null;
}

export interface ResynatorWasmRenderOptions {
  modelJson: string;
  midiNote?: number;
  velocity01?: number;
  seconds?: number;
  sampleRate?: number;
  blockSize?: number;
  urlOverride?: string;
}

/**
 * Render offline con el MOTOR: noteOn → N bloques → noteOff → cola.
 * Devuelve estéreo entrelazado separado en L/R (mismo formato que el preview TS).
 */
export async function renderResynatorWasm(
  options: ResynatorWasmRenderOptions
): Promise<{ stereoL: Float32Array; stereoR: Float32Array; peak: number }> {
  const midi = options.midiNote ?? 69;
  const vel = options.velocity01 ?? 0.8;
  const seconds = options.seconds ?? 1;
  const sampleRate = options.sampleRate ?? 44100;
  const block = options.blockSize ?? 512;
  const mod = await loadResynatorWasm(options.urlOverride);
  const lastError = (): string => {
    const ptr = mod.ccall('resynLastError', 'number', [], []) as number;
    return ptr ? mod.UTF8ToString(ptr) : 'desconocido';
  };
  if ((mod.ccall('resynCreate', 'number', ['number'], [sampleRate]) as number) !== 1) {
    throw new Error(`[resynator-wasm] resynCreate falló: ${lastError()}`);
  }
  if (
    (mod.ccall(
      'resynLoadModel',
      'number',
      ['string', 'number'],
      [options.modelJson, options.modelJson.length]
    ) as number) !== 1
  ) {
    throw new Error(`[resynator-wasm] el motor rechazó el modelo: ${lastError()}`);
  }
  mod.ccall('resynNoteOn', null, ['number', 'number'], [midi, vel]);
  const total = Math.max(1, Math.floor(sampleRate * seconds));
  const stereoL = new Float32Array(total);
  const stereoR = new Float32Array(total);
  let peak = 0;
  for (let done = 0; done < total; done += block) {
    const n = Math.min(block, total - done);
    const ptr = mod.ccall('resynRenderBlock', 'number', ['number'], [n]) as number;
    if (!ptr) throw new Error(`[resynator-wasm] resynRenderBlock devolvió null: ${lastError()}`);
    const start = ptr / 4;
    for (let i = 0; i < n; i++) {
      const l = mod.HEAPF32[start + i * 2];
      const r = mod.HEAPF32[start + i * 2 + 1];
      if (!Number.isFinite(l) || !Number.isFinite(r)) {
        throw new Error('[resynator-wasm] muestra no finita del motor.');
      }
      stereoL[done + i] = l;
      stereoR[done + i] = r;
      const a = Math.abs(l) > Math.abs(r) ? Math.abs(l) : Math.abs(r);
      if (a > peak) peak = a;
    }
  }
  mod.ccall('resynNoteOff', null, ['number'], [midi]);
  return { stereoL, stereoR, peak };
}
