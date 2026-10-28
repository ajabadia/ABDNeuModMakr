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
  MidiNote,
  ProcessConfig,
  Session,
  TargetFormat,
  WorkingMode,
  Zone,
} from './types.ts';

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
    if (workingModeRaw === 'extended' && targetFormat !== 'modern-neural') {
      throw new Error(
        "Invalid session JSON: processConfig.workingMode 'extended' requires targetFormat 'modern-neural'"
      );
    }
    workingMode = workingModeRaw;
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

  return {
    id: typeof idRaw === 'string' && idRaw.length > 0 ? idRaw : `session_${Date.now()}`,
    name: typeof nameRaw === 'string' && nameRaw.length > 0 ? nameRaw : 'Imported Session',
    zones,
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
