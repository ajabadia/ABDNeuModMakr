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
  LoopExpansionMethod,
  LoopMode,
  MasterChannelLayout,
  MasterPromotionMethod,
  MasterWaveConfig,
  MasterWaveMethod,
  MidiNote,
  ModelCoverArtwork,
  ProcessConfig,
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

export const SESSION_MAGIC = 'NEURONMM_SESSION';
export const SESSION_SCHEMA_VERSION = '1.2.0';

/** Max model-name length: 11 chars on classic hardware, unrestricted/128 in modern/extended. */
export const MAX_MODEL_NAME_LEGACY = 11;
export const MAX_MODEL_NAME_MODERN = 128;

/** Hard cap: at most one single-note zone per MIDI key. */
export const MAX_ZONE_COUNT = 128;

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
  const host = u.hostname.toLowerCase();
  const isLoopback =
    host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
  if (!isLoopback) {
    if (
      host.endsWith('.local') ||
      host === '0.0.0.0' ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host === '169.254.169.254' ||
      host.startsWith('169.254.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) {
      throw fieldError('processConfig.masterWaveConfig.aiBridgeEndpoint', 'private/link-local hosts are blocked');
    }
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
  return v;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clampInt(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(value)));
}

function clampNum(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

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

function validateProcessConfig(raw: unknown): ProcessConfig {
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
    aiConfig = {
      enabled: typeof a['enabled'] === 'boolean' ? a['enabled'] : false,
      masterWave: validMw(a['masterWave']),
      separation: validSep(a['separation']),
      loopExpansion: validLoop(a['loopExpansion']),
      classifier: validClf(a['classifier']),
      denoise: validDen(a['denoise']),
    };
  }

  let extendedMetadata: ExtendedModelMetadata | undefined;
  if (isRecord(cfg['extendedMetadata'])) {
    const meta = cfg['extendedMetadata'];
    const asStr = (v: unknown): string | undefined => (typeof v === 'string' ? v.trim() : undefined);
    const customAttrs: CustomMetadataTag[] = [];
    if (Array.isArray(meta['customAttributes'])) {
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
    extendedMetadata = {
      ...(asStr(meta['author']) ? { author: asStr(meta['author']) } : {}),
      ...(asStr(meta['vendor']) ? { vendor: asStr(meta['vendor']) } : {}),
      ...(asStr(meta['version']) ? { version: asStr(meta['version']) } : {}),
      ...(asStr(meta['releaseYear']) ? { releaseYear: asStr(meta['releaseYear']) } : {}),
      ...(asStr(meta['sourceUrl']) ? { sourceUrl: asStr(meta['sourceUrl']) } : {}),
      ...(asStr(meta['sourceFormat']) ? { sourceFormat: asStr(meta['sourceFormat']) } : {}),
      ...(asStr(meta['sourcePresetName']) ? { sourcePresetName: asStr(meta['sourcePresetName']) } : {}),
      ...(asStr(meta['license']) ? { license: asStr(meta['license']) } : {}),
      ...(asStr(meta['copyright']) ? { copyright: asStr(meta['copyright']) } : {}),
      ...(asStr(meta['description']) ? { description: asStr(meta['description']) } : {}),
      ...(Array.isArray(meta['tags']) ? { tags: meta['tags'].filter((t): t is string => typeof t === 'string' && t.trim().length > 0) } : {}),
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
    ...(dspAlgorithm !== undefined ? { dspAlgorithm } : {}),
    ...(masterWaveConfig !== undefined ? { masterWaveConfig } : {}),
    ...(commonPlayback !== undefined ? { commonPlayback } : {}),
    ...(coverArtwork !== undefined ? { coverArtwork } : {}),
    ...(aiConfig !== undefined ? { aiConfig } : {}),
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
