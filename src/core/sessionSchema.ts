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
  DspAlgorithmMode,
  ExtendedRegion,
  MasterChannelLayout,
  MasterPromotionMethod,
  MasterWaveConfig,
  MidiNote,
  ProcessConfig,
  Session,
  SynthArticulationConfig,
  TargetFormat,
  WorkingMode,
  Zone,
} from './types.ts';
import { cloneArticulation, cloneExtendedRegion } from './extendedAdapter.ts';
import { DEFAULT_MASTER_WAVE_CONFIG } from './dsp/MasterWaveEnhancer.ts';

export const SESSION_MAGIC = 'NEURONMM_SESSION';
export const SESSION_SCHEMA_VERSION = '1.2.0';

/** Max model-name length: 11 chars on hardware, 32 in modern/extended. */
export const MAX_MODEL_NAME_LEGACY = 11;
export const MAX_MODEL_NAME_MODERN = 32;

/** Hard cap: at most one single-note zone per MIDI key. */
export const MAX_ZONE_COUNT = 128;

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
      ? idRaw
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
  if (sampleLowRaw !== null && typeof sampleLowRaw !== 'string') {
    throw fieldError(`zones[${index}].sampleLow`, 'must be a string or null');
  }
  if (sampleHighRaw !== null && typeof sampleHighRaw !== 'string') {
    throw fieldError(`zones[${index}].sampleHigh`, 'must be a string or null');
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
      aiBridgeEndpoint:
        typeof m['aiBridgeEndpoint'] === 'string'
          ? m['aiBridgeEndpoint']
          : DEFAULT_MASTER_WAVE_CONFIG.aiBridgeEndpoint,
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

  return {
    modelNumber: slotNum,
    modelName,
    complexity: complexityNum,
    parameterSet: paramSetNum,
    targetFormat,
    ...(workingMode !== undefined ? { workingMode } : {}),
    ...(dspAlgorithm !== undefined ? { dspAlgorithm } : {}),
    ...(masterWaveConfig !== undefined ? { masterWaveConfig } : {}),
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
  const nameRaw = body['name'];
  const createdRaw = body['createdAt'];
  const now = new Date().toISOString();

  const extRegionsRaw = body['extendedRegions'];
  const extendedRegions: ExtendedRegion[] | undefined = Array.isArray(extRegionsRaw)
    ? extRegionsRaw
        .filter((r): r is Record<string, unknown> => isRecord(r))
        .map((r, i) =>
          cloneExtendedRegion({
            id: typeof r.id === 'string' && r.id ? r.id : `ext-reg-${i + 1}`,
            sampleName: typeof r.sampleName === 'string' ? r.sampleName : '',
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

  const detectedInstrumentCategory =
    typeof body['detectedInstrumentCategory'] === 'string'
      ? body['detectedInstrumentCategory']
      : undefined;

  return {
    id: typeof idRaw === 'string' && idRaw.length > 0 ? idRaw : `session_${Date.now()}`,
    name: typeof nameRaw === 'string' && nameRaw.length > 0 ? nameRaw : 'Imported Session',
    zones,
    ...(extendedRegions ? { extendedRegions } : {}),
    ...(articulation ? { articulation } : {}),
    ...(detectedInstrumentCategory ? { detectedInstrumentCategory } : {}),
    processConfig: validateProcessConfig(body['processConfig']),
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
