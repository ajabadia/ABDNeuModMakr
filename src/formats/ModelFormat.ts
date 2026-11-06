// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Hartmann Neuron Binary .model Reader & Writer
// Re-exported from @abdsynths/shared/formats/neuron as single source of truth.
// ─────────────────────────────────────────────────────────

export * from '@abdsynths/shared/formats/neuron';

import { parseMapScript, type ParsedMapScript } from '@abdsynths/shared/formats/neuron';

/**
 * S6.7e — `map.script` con tope de tamaño (red-team 2026-11-06, ola 10).
 *
 * El canónico tiene 1027 líneas (~25 KB); el parser del vendor hace
 * `text.split()` sin límite: 30 MB de basura pasan en 503 ms con +225 MB
 * de RSS transitorio, y 1 GB tumbaría la pestaña (el string UTF-16 ya
 * son 2 GB antes de trocear). 1 MB deja 40x de margen y rechaza el resto.
 * La compuerta vive aquí (capa app, como SfzParser/ZIP) y cubre los tres
 * lectores: directoryImport, webkitImport (File) y mixedImport (buffer).
 */
export const APP_MAX_MAP_SCRIPT_TEXT_BYTES = 1 * 1024 * 1024;

export function parseMapScriptCapped(text: string, source = 'map.script'): ParsedMapScript {
  if (text.length > APP_MAX_MAP_SCRIPT_TEXT_BYTES) {
    throw new Error(
      `map.script too large (${source}: ${text.length} chars, max ${APP_MAX_MAP_SCRIPT_TEXT_BYTES})`
    );
  }
  return parseMapScript(text);
}

export function assertMapScriptBufferSafe(
  buffer: ArrayBuffer | Uint8Array,
  source = 'map.script'
): void {
  if (buffer.byteLength > APP_MAX_MAP_SCRIPT_TEXT_BYTES) {
    throw new Error(
      `map.script too large (${source}: ${buffer.byteLength} bytes, max ${APP_MAX_MAP_SCRIPT_TEXT_BYTES})`
    );
  }
}
