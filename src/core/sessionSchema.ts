// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Session JSON Schema Validation (P0.2)
//
// Single validation entry point for every untrusted session payload
// (`.nmsession.json` file import and `localStorage` restore).
//
// Legacy-tolerant by design: numeric MIDI keys are clamped exactly like
// the original inline code did, but structurally corrupt payloads are
// rejected with specific errors instead of producing a broken session.
// The canonical binary format path (`legacy-neuron`) is untouched —
// this only guards the editable session document.
// ─────────────────────────────────────────────────────────

import type {
  AiAssistanceConfig,
  ClassifierMethod,
  CommonPlaybackDefaults,
  CrossfadeCurve,
  CustomMetadataTag,
  DenoiseMethod,
  DspAlgorithmMode,
  ExtendedModelMetadata,
  ExtendedRegion,
  KeyMappingMode,
  LoopExpansionMethod,
  LoopMode,
  MasterChannelLayout,
  MasterPromotionMethod,
  MasterWaveConfig,
  MasterWaveMethod,
  MidiNote,
  ModelCoverArtwork,
  PitchAndSlicerMethod,
  DeEsserMethod,
  CoverArtworkMethod,
  ProcessConfig,
  UnifiedSurfaceUiConfig,
  SeparationMethod,
  Session,
  SynthArticulationConfig,
  TargetFormat,
  TriggerMode,
  WorkingMode,
  Zone,
} from './types.ts';
import { cloneArticulation, cloneExtendedRegion } from './extendedAdapter.ts';
import { DEFAULT_MASTER_WAVE_CONFIG } from './dsp/MasterWaveEnhancer.ts';
import { isBlockedHostname } from './security/ssrf.ts';
import { clamp, clampInt } from './dsp/DspMath.ts';
import {
  coverBytesDeclaredDimensions,
  MAX_IMPORTED_COVER_DIMENSION_PX,
} from './coverArtwork.ts';

export const SESSION_MAGIC = 'NEURONMM_SESSION';
export const SESSION_SCHEMA_VERSION = '1.2.0';

/** Max model-name length: 11 chars on classic hardware, unrestricted/128 in modern/extended. */
export const MAX_MODEL_NAME_LEGACY = 11;
export const MAX_MODEL_NAME_MODERN = 128;

/** Hard cap: at most one single-note zone per MIDI key. */
export const MAX_ZONE_COUNT = 128;
/**
 * S6.7p (red-team, ola 22): las `extendedRegions` no tenían tope mientras las
 * `zones` sí (128) — 300k regiones en 21 MB de JSON clonaban ~80 MB y ~2,2 s
 * POR PULSACIÓN en cada `pushHistory` (structuredClone × 50 pasos). 8× las
 * zonas da margen de sobra: en la app nacen de las zonas.
 */
export const MAX_EXTENDED_REGION_COUNT = 1024;
/** Misma familia (metadatos sin tope): aunque baratos por ítem, sin cota un array gigante multiplica clones y renders. */
export const MAX_CUSTOM_ATTRIBUTE_COUNT = 256;
export const MAX_TAG_COUNT = 256;

/** S3.2 security caps (see ABDShared Docs/architecture/SECURITY_STANDARDS.md). */
export const MAX_ID_LENGTH = 128;
export const MAX_SESSION_NAME_LENGTH = 64;
export const MAX_SAMPLE_NAME_LENGTH = 256;
export const MAX_ORIGINAL_NAME_LENGTH = 128;
export const MAX_WEBP_DATA_URL_LENGTH = 700_000; // ~512 KB binario
/** 2048*2048 RGBA = 16 MB, muy por encima del cover 512px (1 MB). */
export const MAX_WEBP_BYTES = 1_048_576;
export const MAX_ENDPOINT_LENGTH = 500;
export const ID_PATTERN = /^[A-Za-z0-9-_]+$/;
export const SAMPLE_NAME_PATTERN = /^[\w\-. /\\()\[\]]+$/u;

export function isSafeSampleName(v: string): boolean {
  if (v.length === 0 || v.length > MAX_SAMPLE_NAME_LENGTH) return false;
  if (v.includes('..')) return false;
  if (v.startsWith('/') || v.startsWith('\\')) return false;
  if (/^[a-zA-Z]:[\\/]/.test(v)) return false;
  return SAMPLE_NAME_PATTERN.test(v);
}

export function validateIdField(field: string, v: unknown, fallback: () => string): string {
  if (typeof v !== 'string' || v.length === 0) return fallback();
  const t = v.trim();
  if (t.length === 0 || t.length > MAX_ID_LENGTH || !ID_PATTERN.test(t)) {
    throw fieldError(field, `must match ${ID_PATTERN} (1..${MAX_ID_LENGTH})`);
  }
  return t;
}

/** Bloquea SSRF (169.254/10/8/172.16/12/192.168/16/0.0.0.0/*.local), salvo loopback explícito. */
export function validateAiBridgeEndpoint(v: unknown): string {
  const fallback = DEFAULT_MASTER_WAVE_CONFIG.aiBridgeEndpoint ?? 'http://127.0.0.1:7860/api/enhance';
  if (v === undefined) return fallback;
  if (typeof v !== 'string') throw fieldError('processConfig.masterWaveConfig.aiBridgeEndpoint', 'must be a URL string');
  const t = v.trim();
  if (t.length === 0 || t.length > MAX_ENDPOINT_LENGTH) {
    throw fieldError('processConfig.masterWaveConfig.aiBridgeEndpoint', `must be 1..${MAX_ENDPOINT_LENGTH} chars`);
  }
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    throw fieldError('processConfig.masterWaveConfig.aiBridgeEndpoint', 'must be a valid http(s) URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw fieldError('processConfig.masterWaveConfig.aiBridgeEndpoint', 'must use http(s)');
  }
  if (u.username || u.password) {
    throw fieldError('processConfig.masterWaveConfig.aiBridgeEndpoint', 'credentials in URL are blocked');
  }
  // S4.1 (+IPv6 2026-11-06): el clasificador compartido cubre `::ffff:<ipv4>`,
  // `fe80::/10`, `fc00::/7` y `::`, que los checks de rangos IPv4 no ven.
  if (isBlockedHostname(u.hostname)) {
    throw fieldError('processConfig.masterWaveConfig.aiBridgeEndpoint', 'private/link-local hosts are blocked');
  }
  return t;
}

/** S2.3: `sourceUrl` solo http(s) — bloquea `javascript:`/`data:` (stored-XSS vía <a href>). */
export function validateSourceUrl(field: string, v: unknown): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw fieldError(field, 'must be a URL string');
  const t = v.trim();
  if (t.length === 0) return undefined;
  if (t.length > MAX_ENDPOINT_LENGTH) {
    throw fieldError(field, `must be 1..${MAX_ENDPOINT_LENGTH} chars`);
  }
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    throw fieldError(field, 'must be a valid http(s) URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw fieldError(field, 'only http(s) URLs are allowed');
  }
  return t;
}

export function validateWebpDataUrl(field: string, v: unknown): string {
  if (typeof v !== 'string' || !v.startsWith('data:image/webp;base64,')) {
    throw fieldError(field, 'must start with data:image/webp;base64,');
  }
  if (v.length > MAX_WEBP_DATA_URL_LENGTH) {
    throw fieldError(field, `too large (${v.length} chars, max ${MAX_WEBP_DATA_URL_LENGTH})`);
  }
  // S6.7n (ola 20): dimensiones declaradas dentro del tope — un VP8X de 30
  // bytes puede declarar 16383×16383 (≈1 GB de bitmap al mostrarlo) y el
  // tope de longitud no lo ve. Se lee solo la cabecera (primeros 90 bytes).
  try {
    const b64 = v.slice(v.indexOf(',') + 1, v.indexOf(',') + 1 + 120);
    const head = atob(b64.slice(0, Math.floor(b64.length / 4) * 4));
    const bytes = new Uint8Array(head.length);
    for (let i = 0; i < head.length; i++) bytes[i] = head.charCodeAt(i);
    const dims = coverBytesDeclaredDimensions(bytes);
    if (
      !dims ||
      dims.width > MAX_IMPORTED_COVER_DIMENSION_PX ||
      dims.height > MAX_IMPORTED_COVER_DIMENSION_PX
    ) {
      throw fieldError(
        field,
        `dimensions out of bounds (${dims ? `${dims.width}x${dims.height}` : 'unreadable'}, max ${MAX_IMPORTED_COVER_DIMENSION_PX})`
      );
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Invalid session JSON')) throw e;
    throw fieldError(field, 'unreadable cover header');
  }
  return v;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

const clampNum = clamp;

function fieldError(field: string, reason: string): Error {
  return new Error(`Invalid session JSON: field '${field}' ${reason}`);
}

function validateZone(raw: unknown, index: number): Zone {
  if (!isRecord(raw)) {
    throw new Error(`Invalid session JSON: zones[${index}] must be an object`);
  }
  const idRaw = raw['id'];
  const id =
    typeof idRaw === 'string' && idRaw.length > 0
      ? validateIdField(`zones[${index}].id`, idRaw, () => `imported-zone-${index}-${Date.now().toString(36)}`)
      : `imported-zone-${index}-${Date.now().toString(36)}`;

  const lowRaw = raw['lowKey'] ?? 0;
  const rootRaw = raw['rootKey'] ?? 60;
  const highRaw = raw['highKey'] ?? 127;
  const lowNum = asFiniteNumber(lowRaw);
  const rootNum = asFiniteNumber(rootRaw);
  const highNum = asFiniteNumber(highRaw);
  if (lowNum === null) throw fieldError(`zones[${index}].lowKey`, 'must be a finite number 0..127');
  if (rootNum === null) throw fieldError(`zones[${index}].rootKey`, 'must be a finite number 0..127');
  if (highNum === null) throw fieldError(`zones[${index}].highKey`, 'must be a finite number 0..127');
  const lowKey = clampInt(lowNum, 0, 127);
  const rootKey = clampInt(rootNum, 0, 127);
  const highKey = clampInt(highNum, 0, 127);
  if (lowKey > highKey) {
    throw new Error(
      `Invalid session JSON: zones[${index}] has lowKey ${lowKey} > highKey ${highKey}`
    );
  }

  const sampleLowRaw = raw['sampleLow'] ?? null;
  const sampleHighRaw = raw['sampleHigh'] ?? null;
  if (sampleLowRaw !== null) {
    if (typeof sampleLowRaw !== 'string' || !isSafeSampleName(sampleLowRaw)) {
      throw fieldError(`zones[${index}].sampleLow`, 'must be a safe sample name (<=256, sin .. ni ruta absoluta) o null');
    }
  }
  if (sampleHighRaw !== null) {
    if (typeof sampleHighRaw !== 'string' || !isSafeSampleName(sampleHighRaw)) {
      throw fieldError(`zones[${index}].sampleHigh`, 'must be a safe sample name (<=256, sin .. ni ruta absoluta) o null');
    }
  }

  const velRaw = raw['velSplit'] ?? 64;
  const velNum = asFiniteNumber(velRaw);
  if (velNum === null) throw fieldError(`zones[${index}].velSplit`, 'must be a finite number 2..127');

  const detuneRaw = raw['detune'] ?? 0;
  const volumeRaw = raw['volume'] ?? 0;
  const panRaw = raw['pan'] ?? 0;
  const detuneNum = asFiniteNumber(detuneRaw);
  const volumeNum = asFiniteNumber(volumeRaw);
  const panNum = asFiniteNumber(panRaw);
  if (detuneNum === null) throw fieldError(`zones[${index}].detune`, 'must be a finite number -99..99');
  if (volumeNum === null) throw fieldError(`zones[${index}].volume`, 'must be a finite number -32..12');
  if (panNum === null) throw fieldError(`zones[${index}].pan`, 'must be a finite number -50..50');

  return {
    id,
    lowKey: lowKey as MidiNote,
    rootKey: rootKey as MidiNote,
    highKey: highKey as MidiNote,
    sampleLow: sampleLowRaw,
    sampleHigh: sampleHighRaw,
    velSplit: clampInt(velNum, 2, 127),
    detune: clampNum(detuneNum, -99, 99),
    volume: clampNum(volumeNum, -32, 12),
    pan: clampNum(panNum, -50, 50),
  };
}

const TARGET_FORMATS: readonly TargetFormat[] = ['dual', 'legacy-neuron', 'modern-neural'];

/**
 * S3/S6: sanea el `processConfig` de un `manifest.json` importado de ZIP.
 * El manifest es entrada no confiable: una cápsula manipulada podría
 * contrabandear `aiBridgeEndpoint` (SSRF) o un cover falso al interior de
 * la sesión viva, saltándose `parseSessionJson`. Se pasa por la misma
 * frontera (`validateProcessConfig`); si falla, se conservan los campos
 * musicales y se neutralizan las hojas peligrosas.
 */
export function sanitizeImportedProcessConfig(raw: unknown, slot: number): Record<string, unknown> {
  if (!isRecord(raw)) return {};
  try {
    return validateProcessConfig({ ...raw, modelNumber: slot }) as unknown as Record<string, unknown>;
  } catch {
    const rest: Record<string, unknown> = { ...raw };
    delete rest.coverArtwork;
    const mw = rest.masterWaveConfig;
    if (isRecord(mw)) {
      try {
        rest.masterWaveConfig = { ...mw, aiBridgeEndpoint: validateAiBridgeEndpoint(mw.aiBridgeEndpoint) };
      } catch {
        delete rest.masterWaveConfig;
      }
    }
    return rest;
  }
}

/** Exportada para reutilizar la misma frontera en la ruta de importación
 * (modelImportService): el `manifest.json` de un ZIP es entrada no confiable. */
export function validateProcessConfig(raw: unknown): ProcessConfig {
  const cfg: Record<string, unknown> = isRecord(raw) ? raw : {};
  const targetFormatRaw = cfg['targetFormat'] ?? 'dual';
  if (typeof targetFormatRaw !== 'string' || !TARGET_FORMATS.includes(targetFormatRaw as TargetFormat)) {
    throw fieldError('processConfig.targetFormat', "must be one of 'dual' | 'legacy-neuron' | 'modern-neural'");
  }
  const targetFormat = targetFormatRaw as TargetFormat;
  const nameLimit = targetFormat === 'modern-neural' ? MAX_MODEL_NAME_MODERN : MAX_MODEL_NAME_LEGACY;

  const modelNameRaw = cfg['modelName'] ?? 'MyModel';
  if (typeof modelNameRaw !== 'string') {
    throw fieldError('processConfig.modelName', 'must be a string');
  }
  const modelName = modelNameRaw.trim().slice(0, nameLimit) || 'MyModel';

  const expandedNameRaw = cfg['expandedName'];
  let expandedName: string | undefined;
  if (typeof expandedNameRaw === 'string' && expandedNameRaw.trim().length > 0) {
    expandedName = expandedNameRaw.trim().slice(0, MAX_MODEL_NAME_MODERN);
  } else if (typeof modelNameRaw === 'string' && modelNameRaw.trim().length > 0) {
    expandedName = modelNameRaw.trim().slice(0, MAX_MODEL_NAME_MODERN);
  }

  const workingModeRaw = cfg['workingMode'];
  let workingMode: WorkingMode | undefined;
  if (workingModeRaw !== undefined) {
    if (workingModeRaw !== 'classic' && workingModeRaw !== 'extended') {
      throw fieldError('processConfig.workingMode', "must be 'classic' | 'extended'");
    }
    workingMode = workingModeRaw;
  }

  const keyMappingModeRaw = cfg['keyMappingMode'];
  let keyMappingMode: KeyMappingMode | undefined;
  if (keyMappingModeRaw !== undefined) {
    if (keyMappingModeRaw !== 'chromatic' && keyMappingModeRaw !== 'drum') {
      throw fieldError('processConfig.keyMappingMode', "must be 'chromatic' | 'drum'");
    }
    keyMappingMode = keyMappingModeRaw;
  }

  const dspAlgorithmRaw = cfg['dspAlgorithm'];
  let dspAlgorithm: DspAlgorithmMode | undefined;
  if (dspAlgorithmRaw !== undefined) {
    if (dspAlgorithmRaw !== 'legacy' && dspAlgorithmRaw !== 'enhanced') {
      throw fieldError('processConfig.dspAlgorithm', "must be 'legacy' | 'enhanced'");
    }
    dspAlgorithm = dspAlgorithmRaw;
  }

  let masterWaveConfig: MasterWaveConfig | undefined;
  if (isRecord(cfg['masterWaveConfig'])) {
    const m = cfg['masterWaveConfig'];
    const pm = m['promotionMethod'];
    const cl = m['channelLayout'];
    masterWaveConfig = {
      promotionMethod:
        pm === 'direct-conversion' || pm === 'dsp-enhanced' || pm === 'ai-bridge'
          ? (pm as MasterPromotionMethod)
          : DEFAULT_MASTER_WAVE_CONFIG.promotionMethod,
      channelLayout:
        cl === 'original' || cl === 'stereo' || cl === 'quad-surround'
          ? (cl as MasterChannelLayout)
          : DEFAULT_MASTER_WAVE_CONFIG.channelLayout,
      targetSampleRate: clampInt(asFiniteNumber(m['targetSampleRate']) ?? 96000, 44100, 192000),
      targetBitDepth: 24,
      minLoopDurationSec: clampNum(asFiniteNumber(m['minLoopDurationSec']) ?? 4.0, 0, 30),
      enableBandwidthExtension:
        typeof m['enableBandwidthExtension'] === 'boolean'
          ? m['enableBandwidthExtension']
          : DEFAULT_MASTER_WAVE_CONFIG.enableBandwidthExtension,
      enableDenoiseGate:
        typeof m['enableDenoiseGate'] === 'boolean'
          ? m['enableDenoiseGate']
          : DEFAULT_MASTER_WAVE_CONFIG.enableDenoiseGate,
      aiBridgeEndpoint: validateAiBridgeEndpoint(m['aiBridgeEndpoint']),
    };
  }

  const slotRaw = cfg['modelNumber'] ?? 1;
  const complexityRaw = cfg['complexity'] ?? 8;
  const paramSetRaw = cfg['parameterSet'] ?? 0;
  const slotNum = asFiniteNumber(slotRaw);
  const complexityNum = asFiniteNumber(complexityRaw);
  const paramSetNum = asFiniteNumber(paramSetRaw);
  if (slotNum === null || !Number.isInteger(slotNum) || slotNum < 0 || slotNum > 511) {
    throw fieldError('processConfig.modelNumber', 'must be an integer 0..511');
  }
  if (complexityNum === null || !Number.isInteger(complexityNum) || complexityNum < 1 || complexityNum > 10) {
    throw fieldError('processConfig.complexity', 'must be an integer 1..10');
  }
  if (paramSetNum === null || !Number.isInteger(paramSetNum) || paramSetNum < 0 || paramSetNum > 9) {
    throw fieldError('processConfig.parameterSet', 'must be an integer 0..9');
  }

  let commonPlayback: CommonPlaybackDefaults | undefined;
  if (isRecord(cfg['commonPlayback'])) {
    const cp = cfg['commonPlayback'];
    const rawMode = cp['loopMode'];
    const loopMode: LoopMode =
      rawMode === 'loop_continuous' ||
      rawMode === 'loop_sustain' ||
      rawMode === 'ping_pong' ||
      rawMode === 'loop_backward' ||
      rawMode === 'one_shot'
        ? rawMode
        : 'no_loop';
    const trigRaw = cp['trigger'];
    const trigger: TriggerMode =
      trigRaw === 'release' || trigRaw === 'first' || trigRaw === 'legato' ? trigRaw : 'attack';
    const fcRaw = cp['fadeCurve'];
    const fadeCurve: CrossfadeCurve =
      fcRaw === 'linear' || fcRaw === 'spectral-morph' ? fcRaw : 'equal-power';
    commonPlayback = {
      loopMode,
      pitchKeytrack: clampInt(asFiniteNumber(cp['pitchKeytrack']) ?? 100, 0, 100),
      trigger,
      fadeCurve,
    };
  }

  let coverArtwork: ModelCoverArtwork | null | undefined;
  if (cfg['coverArtwork'] === null) {
    coverArtwork = null;
  } else  if (isRecord(cfg['coverArtwork'])) {
    const c = cfg['coverArtwork'];
    if (typeof c['webpDataUrl'] === 'string' && c['webpDataUrl'].startsWith('data:image/webp;base64,')) {
      const webpDataUrl = validateWebpDataUrl('processConfig.coverArtwork.webpDataUrl', c['webpDataUrl']);
      const rawOriginal = typeof c['originalName'] === 'string' && c['originalName'].trim().length > 0 ? c['originalName'].trim() : 'cover.webp';
      if (rawOriginal.length > MAX_ORIGINAL_NAME_LENGTH || /[<>"'&]/.test(rawOriginal) || rawOriginal.includes('..')) {
        throw fieldError('processConfig.coverArtwork.originalName', `must be 1..${MAX_ORIGINAL_NAME_LENGTH} sin <>&"' ni ..`);
      }
      coverArtwork = {
        webpDataUrl,
        byteLength: Math.max(0, Math.min(MAX_WEBP_BYTES, Math.round(asFiniteNumber(c['byteLength']) ?? (webpDataUrl.length * 3) / 4))),
        width: Math.max(1, Math.min(2048, Math.round(asFiniteNumber(c['width']) ?? 512))),
        height: Math.max(1, Math.min(2048, Math.round(asFiniteNumber(c['height']) ?? 512))),
        originalName: rawOriginal,
        updatedAt: typeof c['updatedAt'] === 'string' ? c['updatedAt'] : new Date().toISOString(),
      };
    }
  }

  let aiConfig: AiAssistanceConfig | undefined;
  if (isRecord(cfg['aiConfig'])) {
    const a = cfg['aiConfig'];
    const validMw = (v: unknown): MasterWaveMethod => (v === 'ai' || v === 'bypass' ? v : 'dsp');
    const validSep = (v: unknown): SeparationMethod => (v === 'ai' || v === 'bypass' ? v : 'dsp');
    const validLoop = (v: unknown): LoopExpansionMethod => (v === 'ai' || v === 'manual' ? v : 'dsp');
    const validClf = (v: unknown): ClassifierMethod => (v === 'ai' || v === 'manual' ? v : 'dsp');
    const validDen = (v: unknown): DenoiseMethod => (v === 'ai' || v === 'bypass' ? v : 'dsp');
    const validPitch = (v: unknown): PitchAndSlicerMethod => (v === 'ai' || v === 'bypass' ? v : 'dsp');
    const validDeEsser = (v: unknown): DeEsserMethod => (v === 'ai' || v === 'bypass' ? v : 'dsp');
    const validCover = (v: unknown): CoverArtworkMethod =>
      (v === 'local-ai' || v === 'cloud-ai' || v === 'bypass' ? (v as CoverArtworkMethod) : 'procedural');
    aiConfig = {
      enabled: typeof a['enabled'] === 'boolean' ? a['enabled'] : false,
      masterWave: validMw(a['masterWave']),
      separation: validSep(a['separation']),
      loopExpansion: validLoop(a['loopExpansion']),
      classifier: validClf(a['classifier']),
      denoise: validDen(a['denoise']),
      pitchAndSlicer: validPitch(a['pitchAndSlicer']),
      deEsser: validDeEsser(a['deEsser']),
      coverArtwork: validCover(a['coverArtwork']),
    };
  }

  let unifiedSurfaceConfig: UnifiedSurfaceUiConfig | undefined;
  if (isRecord(cfg['unifiedSurfaceConfig'])) {
    const u = cfg['unifiedSurfaceConfig'];
    const topologyMode = u['topologyMode'] === 'melodic_surface' || u['topologyMode'] === 'drum_kit_surface' ? u['topologyMode'] : 'auto';
    const resolutionStrategy = u['resolutionStrategy'] === 'manual' ? 'manual' as const : 'auto' as const;
    let tempoSync: UnifiedSurfaceUiConfig['tempoSync'];
    if (isRecord(u['tempoSync'])) {
      const t = u['tempoSync'];
      const grooveRaw = t['grooveMode'];
      const grooveMode = grooveRaw === 'rex_loop' || grooveRaw === 'melodic_phrase' || grooveRaw === 'sliced_kit' || grooveRaw === 'slice_synced' ? grooveRaw : 'free';
      const tsRaw = t['timeSignature'];
      const timeSignature: [number, number] = Array.isArray(tsRaw) && tsRaw.length === 2
        ? [clampInt(asFiniteNumber(tsRaw[0]) ?? 4, 1, 32), clampInt(asFiniteNumber(tsRaw[1]) ?? 4, 1, 32)]
        : [4, 4];
      tempoSync = {
        enabled: typeof t['enabled'] === 'boolean' ? t['enabled'] : false,
        sourceBpm: clampNum(asFiniteNumber(t['sourceBpm']) ?? 120, 20, 300),
        targetBpm: clampNum(asFiniteNumber(t['targetBpm']) ?? 120, 20, 300),
        barCount: clampInt(asFiniteNumber(t['barCount']) ?? 2, 1, 64),
        timeSignature,
        grooveMode,
        ...(asFiniteNumber(t['sliceCount']) !== null ? { sliceCount: clampInt(asFiniteNumber(t['sliceCount']) ?? 0, 0, 512) } : {}),
      };
    }
    unifiedSurfaceConfig = {
      topologyMode,
      resolutionStrategy,
      ...(typeof u['includeOutliers'] === 'boolean' ? { includeOutliers: u['includeOutliers'] } : {}),
      ...(typeof u['preserveHybridTransients'] === 'boolean' ? { preserveHybridTransients: u['preserveHybridTransients'] } : {}),
      ...(asFiniteNumber(u['formantLock01']) !== null ? { formantLock01: clampNum(asFiniteNumber(u['formantLock01']) ?? 1, 0, 1) } : {}),
      ...(asFiniteNumber(u['attackShorten01']) !== null ? { attackShorten01: clampNum(asFiniteNumber(u['attackShorten01']) ?? 0, 0, 1) } : {}),
      ...(asFiniteNumber(u['releaseExtendSec']) !== null ? { releaseExtendSec: clampNum(asFiniteNumber(u['releaseExtendSec']) ?? 0, 0, 10) } : {}),
      ...(asFiniteNumber(u['inharmonicityB']) !== null ? { inharmonicityB: clampNum(asFiniteNumber(u['inharmonicityB']) ?? 0, 0, 0.05) } : {}),
      ...(asFiniteNumber(u['parity']) !== null ? { parity: clampNum(asFiniteNumber(u['parity']) ?? 0, -1, 1) } : {}),
      ...(asFiniteNumber(u['residualMix']) !== null ? { residualMix: clampNum(asFiniteNumber(u['residualMix']) ?? 0.15, 0, 1) } : {}),
      ...(tempoSync ? { tempoSync } : {}),
    };
  }

  let sublibrary: string | undefined;
  if (typeof cfg['sublibrary'] === 'string' && cfg['sublibrary'].trim().length > 0) {
    const t = cfg['sublibrary'].trim();
    if (!t.includes('..') && t.length <= 64) sublibrary = t;
    else throw fieldError('processConfig.sublibrary', 'must be 1..64 chars sin ..');
  }
  let sublibraryOrdinal: number | undefined;
  if (cfg['sublibraryOrdinal'] !== undefined) {
    const n = asFiniteNumber(cfg['sublibraryOrdinal']);
    if (n === null || !Number.isInteger(n) || n < 1 || n > 9999) throw fieldError('processConfig.sublibraryOrdinal', 'must be an integer 1..9999');
    sublibraryOrdinal = n;
  }

  let extendedMetadata: ExtendedModelMetadata | undefined;
  if (isRecord(cfg['extendedMetadata'])) {
    const meta = cfg['extendedMetadata'];
    const asStr = (v: unknown): string | undefined => (typeof v === 'string' ? v.trim() : undefined);
    const customAttrs: CustomMetadataTag[] = [];
    if (Array.isArray(meta['customAttributes'])) {
      if (meta['customAttributes'].length > MAX_CUSTOM_ATTRIBUTE_COUNT) {
        throw fieldError(
          'processConfig.extendedMetadata.customAttributes',
          `too many attributes (${meta['customAttributes'].length}, max ${MAX_CUSTOM_ATTRIBUTE_COUNT})`
        );
      }
      for (const item of meta['customAttributes']) {
        if (isRecord(item) && typeof item['tag'] === 'string' && typeof item['value'] === 'string') {
          const t = item['tag'].trim();
          const v = item['value'].trim();
          if (t.length > 0) {
            customAttrs.push({ tag: t, value: v });
          }
        }
      }
    }
    const safeSourceUrl = validateSourceUrl('processConfig.extendedMetadata.sourceUrl', meta['sourceUrl']);
    extendedMetadata = {
      ...(asStr(meta['author']) ? { author: asStr(meta['author']) } : {}),
      ...(asStr(meta['vendor']) ? { vendor: asStr(meta['vendor']) } : {}),
      ...(asStr(meta['version']) ? { version: asStr(meta['version']) } : {}),
      ...(asStr(meta['releaseYear']) ? { releaseYear: asStr(meta['releaseYear']) } : {}),
      ...(safeSourceUrl ? { sourceUrl: safeSourceUrl } : {}),
      ...(asStr(meta['sourceFormat']) ? { sourceFormat: asStr(meta['sourceFormat']) } : {}),
      ...(asStr(meta['sourcePresetName']) ? { sourcePresetName: asStr(meta['sourcePresetName']) } : {}),
      ...(asStr(meta['license']) ? { license: asStr(meta['license']) } : {}),
      ...(asStr(meta['copyright']) ? { copyright: asStr(meta['copyright']) } : {}),
      ...(asStr(meta['description']) ? { description: asStr(meta['description']) } : {}),
      ...(Array.isArray(meta['tags'])
        ? {
            tags: (() => {
              if (meta['tags'].length > MAX_TAG_COUNT) {
                throw fieldError(
                  'processConfig.extendedMetadata.tags',
                  `too many tags (${meta['tags'].length}, max ${MAX_TAG_COUNT})`
                );
              }
              return meta['tags'].filter((t): t is string => typeof t === 'string' && t.trim().length > 0);
            })(),
          }
        : {}),
      ...(customAttrs.length > 0 ? { customAttributes: customAttrs } : {}),
    };
  }

  return {
    modelNumber: slotNum,
    modelName,
    ...(expandedName !== undefined ? { expandedName } : {}),
    complexity: complexityNum,
    parameterSet: paramSetNum,
    targetFormat,
    ...(workingMode !== undefined ? { workingMode } : {}),
    ...(keyMappingMode !== undefined ? { keyMappingMode } : {}),
    ...(dspAlgorithm !== undefined ? { dspAlgorithm } : {}),
    ...(masterWaveConfig !== undefined ? { masterWaveConfig } : {}),
    ...(commonPlayback !== undefined ? { commonPlayback } : {}),
    ...(coverArtwork !== undefined ? { coverArtwork } : {}),
    ...(aiConfig !== undefined ? { aiConfig } : {}),
    ...(unifiedSurfaceConfig !== undefined ? { unifiedSurfaceConfig } : {}),
    ...(sublibrary !== undefined ? { sublibrary } : {}),
    ...(sublibraryOrdinal !== undefined ? { sublibraryOrdinal } : {}),
    ...(extendedMetadata !== undefined ? { extendedMetadata } : {}),
  };
}

/**
 * Validates an already-parsed session payload (envelope or bare session)
 * and returns a normalized live `Session`. Throws a specific `Error` when
 * the payload is structurally corrupt.
 */
export function validateSessionPayload(payload: unknown): Session {
  if (!isRecord(payload)) {
    throw new Error('Invalid session JSON: root must be an object');
  }
  if ('magic' in payload && payload['magic'] !== undefined && payload['magic'] !== SESSION_MAGIC) {
    throw new Error(
      `Invalid session JSON: unrecognized magic '${String(payload['magic'])}' (expected '${SESSION_MAGIC}')`
    );
  }
  const body: unknown =
    'session' in payload && payload['session'] !== undefined ? payload['session'] : payload;
  if (!isRecord(body)) {
    throw new Error('Invalid session JSON: missing session object');
  }

  const zonesRaw = body['zones'];
  if (!Array.isArray(zonesRaw) || zonesRaw.length === 0) {
    throw new Error('Invalid session JSON: missing zones array');
  }
  if (zonesRaw.length > MAX_ZONE_COUNT) {
    throw new Error(
      `Invalid session JSON: too many zones (${zonesRaw.length}, max ${MAX_ZONE_COUNT})`
    );
  }
  const zones = zonesRaw.map((z, i) => validateZone(z, i));

  const idRaw = body['id'];
  const nameRaw = body['name'] ?? body['sessionName'];
  const createdRaw = body['createdAt'];
  const now = new Date().toISOString();

  const extRegionsRaw = body['extendedRegions'];
  if (Array.isArray(extRegionsRaw) && extRegionsRaw.length > MAX_EXTENDED_REGION_COUNT) {
    throw new Error(
      `Invalid session JSON: too many extended regions (${extRegionsRaw.length}, max ${MAX_EXTENDED_REGION_COUNT})`
    );
  }
  const extendedRegions: ExtendedRegion[] | undefined = Array.isArray(extRegionsRaw)
    ? extRegionsRaw
        .filter((r): r is Record<string, unknown> => isRecord(r))
        .map((r, i) =>
          cloneExtendedRegion({
            id: typeof r.id === 'string' && r.id ? validateIdField(`extendedRegions[${i}].id`, r.id, () => `ext-reg-${i + 1}`) : `ext-reg-${i + 1}`,
            sampleName: typeof r.sampleName === 'string' && r.sampleName.length > 0 ? (() => { if (!isSafeSampleName(r.sampleName as string)) throw fieldError(`extendedRegions[${i}].sampleName`, 'must be a safe sample name o vacio'); return r.sampleName as string; })() : '',
            lowKey: clampInt(asFiniteNumber(r.lowKey) ?? 0, 0, 127),
            highKey: clampInt(asFiniteNumber(r.highKey) ?? 127, 0, 127),
            rootKey: clampInt(asFiniteNumber(r.rootKey) ?? 60, 0, 127),
            lowVel: clampInt(asFiniteNumber(r.lowVel) ?? 1, 1, 127),
            highVel: clampInt(asFiniteNumber(r.highVel) ?? 127, 1, 127),
            detune: clampNum(asFiniteNumber(r.detune) ?? 0, -99, 99),
            volume: clampNum(asFiniteNumber(r.volume) ?? 0, -32, 12),
            pan: clampNum(asFiniteNumber(r.pan) ?? 0, -50, 50),
            pitchKeytrack: clampInt(asFiniteNumber(r.pitchKeytrack) ?? 100, 0, 100),
            trigger:
              r.trigger === 'release' || r.trigger === 'first' || r.trigger === 'legato'
                ? r.trigger
                : 'attack',
            seqPosition: asFiniteNumber(r.seqPosition) ?? undefined,
            seqLength: asFiniteNumber(r.seqLength) ?? undefined,
            keyFadeIn: clampInt(asFiniteNumber(r.keyFadeIn) ?? 0, 0, 127),
            keyFadeOut: clampInt(asFiniteNumber(r.keyFadeOut) ?? 0, 0, 127),
            velFadeIn: clampInt(asFiniteNumber(r.velFadeIn) ?? 0, 0, 127),
            velFadeOut: clampInt(asFiniteNumber(r.velFadeOut) ?? 0, 0, 127),
            fadeCurve:
              r.fadeCurve === 'linear' || r.fadeCurve === 'spectral-morph'
                ? r.fadeCurve
                : 'equal-power',
            loopMode:
              r.loopMode === 'loop_continuous' ||
              r.loopMode === 'loop_sustain' ||
              r.loopMode === 'ping_pong' ||
              r.loopMode === 'loop_backward' ||
              r.loopMode === 'one_shot'
                ? r.loopMode
                : 'no_loop',
            loopStart: Math.max(0, Math.round(asFiniteNumber(r.loopStart) ?? 0)),
            loopEnd: Math.max(0, Math.round(asFiniteNumber(r.loopEnd) ?? 0)),
            loopCrossfadeMs: Math.max(0, Math.round(asFiniteNumber(r.loopCrossfadeMs) ?? 0)),
            sampleRate: asFiniteNumber(r.sampleRate) ?? undefined,
            numChannels: asFiniteNumber(r.numChannels) ?? undefined,
            sampleStartFrame: asFiniteNumber(r.sampleStartFrame) !== null ? Math.max(0, Math.round(asFiniteNumber(r.sampleStartFrame)!)) : undefined,
            sampleEndFrame: asFiniteNumber(r.sampleEndFrame) !== null ? Math.max(0, Math.round(asFiniteNumber(r.sampleEndFrame)!)) : undefined,
            reversed: typeof r.reversed === 'boolean' ? r.reversed : undefined,
            playLogic:
              r.playLogic === 'always' || r.playLogic === 'round_robin' || r.playLogic === 'random' || r.playLogic === 'velocity'
                ? r.playLogic
                : undefined,
            velToVolumeDepth: asFiniteNumber(r.velToVolumeDepth) !== null ? clampNum(asFiniteNumber(r.velToVolumeDepth)!, -100, 100) : undefined,
            velToPitchCents: asFiniteNumber(r.velToPitchCents) !== null ? clampNum(asFiniteNumber(r.velToPitchCents)!, -1200, 1200) : undefined,
            groupId: typeof r.groupId === 'string' && r.groupId.trim() ? r.groupId.trim().slice(0, 64) : undefined,
            groupName: typeof r.groupName === 'string' && r.groupName.trim() ? r.groupName.trim().slice(0, 64) : undefined,
            muteGroup: asFiniteNumber(r.muteGroup) !== null ? clampInt(asFiniteNumber(r.muteGroup)!, 0, 32) : undefined,
            keyswitchNote: asFiniteNumber(r.keyswitchNote) !== null ? clampInt(asFiniteNumber(r.keyswitchNote)!, 0, 127) : undefined,
          }),
        )
    : undefined;

  const artRaw = body['articulation'];
  const articulation: SynthArticulationConfig | undefined = isRecord(artRaw)
    ? cloneArticulation(artRaw as unknown as SynthArticulationConfig)
    : undefined;

  const detectedRaw = body['detectedInstrumentCategory'];
  const detectedInstrumentCategory =
    typeof detectedRaw === 'string' && detectedRaw.trim().length > 0
      ? (() => {
          const t = detectedRaw.trim();
          if (t.length > MAX_SESSION_NAME_LENGTH) throw fieldError('detectedInstrumentCategory', `must be 1..${MAX_SESSION_NAME_LENGTH}`);
          return t;
        })()
      : undefined;

  const processConfig = validateProcessConfig(body['processConfig']);
  let resolvedName =
    typeof nameRaw === 'string' && nameRaw.trim().length > 0
      ? nameRaw.trim()
      : (processConfig.modelName || 'Imported Session');
  if (resolvedName.length > MAX_SESSION_NAME_LENGTH) {
    throw fieldError('name', `must be 1..${MAX_SESSION_NAME_LENGTH}`);
  }
  if (/[<>]/.test(resolvedName)) {
    throw fieldError('name', 'must not contain < or >');
  }

  return {
    id: typeof idRaw === 'string' && idRaw.length > 0 ? validateIdField('id', idRaw, () => `session_${Date.now()}`) : `session_${Date.now()}`,
    name: resolvedName,
    zones,
    ...(extendedRegions ? { extendedRegions } : {}),
    ...(articulation ? { articulation } : {}),
    ...(detectedInstrumentCategory ? { detectedInstrumentCategory } : {}),
    processConfig,
    dirty: false,
    createdAt: typeof createdRaw === 'string' ? createdRaw : now,
    modifiedAt: now,
  };
}

/**
 * Parses session JSON text and returns a normalized live `Session`.
 * Throws a specific `Error` for malformed JSON or corrupt payloads.
 */
export function parseSessionJson(jsonText: string): Session {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText) as unknown;
  } catch {
    throw new Error('Invalid session JSON: malformed JSON text');
  }
  return validateSessionPayload(parsed);
}

// ── Fase 44.1.2: detector de migración tolerante + buzón one-shot ──
// Cuando una sesión antigua llega sin las etapas IA 6/7/8 o sin
// `unifiedSurfaceConfig`, la validación las defaultea en silencio
// (dsp/dsp/procedural + `DEFAULT_UNIFIED_SURFACE_CONFIG`). Este detector
// puro informa qué se defaulteó para que la UI avise UNA vez
// (toast + TelemetryDrawer) en vez de perderlo en silencio.

export type SessionMigrationNote = 'ai-stages-6-8-defaulted' | 'unified-surface-defaulted';

const migrationOutbox: SessionMigrationNote[] = [];

function pushMigrationNotes(notes: SessionMigrationNote[]): void {
  for (const n of notes) {
    if (!migrationOutbox.includes(n)) migrationOutbox.push(n);
  }
}

/**
 * Pure detector (never throws): reports which Fase-44 fields were absent
 * in the raw payload and therefore defaulted by validation.
 */
export function detectSessionMigrationNotes(raw: unknown): SessionMigrationNote[] {
  if (!isRecord(raw)) return [];
  const body: unknown = 'session' in raw && raw['session'] !== undefined ? raw['session'] : raw;
  if (!isRecord(body)) return [];
  const cfg = body['processConfig'];
  if (!isRecord(cfg)) return ['ai-stages-6-8-defaulted', 'unified-surface-defaulted'];
  const notes: SessionMigrationNote[] = [];
  const ai = cfg['aiConfig'];
  if (
    !isRecord(ai) ||
    ai['pitchAndSlicer'] === undefined ||
    ai['deEsser'] === undefined ||
    ai['coverArtwork'] === undefined
  ) {
    notes.push('ai-stages-6-8-defaulted');
  }
  if (!isRecord(cfg['unifiedSurfaceConfig'])) {
    notes.push('unified-surface-defaulted');
  }
  return notes;
}

/** Internal: stash migration notes for later one-shot UI consumption. */
export function noteSessionMigration(raw: unknown): void {
  pushMigrationNotes(detectSessionMigrationNotes(raw));
}

/**
 * One-shot read for the UI layer (toast/log once): returns the pending
 * migration notes and clears the outbox.
 */
export function consumeMigrationNotes(): SessionMigrationNote[] {
  return migrationOutbox.splice(0, migrationOutbox.length);
}
