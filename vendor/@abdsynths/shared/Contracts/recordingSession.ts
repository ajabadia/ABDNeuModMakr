/**
 * @abdsynths/shared — Contracts/recordingSession.ts
 * =========================================================================
 * Canonical Recording-Session & Transport-Binding contracts (SSOT) for the
 * ABDSynths suite (ABDNeuModMakr Rec Recorder, ABDAudioLab, …).
 *
 * Pattern: same as MidiTranslationEngine — versioned TypeScript truth with
 * JSON-schema validation (`recording_session.schema.json`), zero runtime
 * dependencies, consumable from browsers, Node and (via vendors) C++ hosts.
 */

export const RECORDING_SESSION_CONTRACT_VERSION = '1.0.0';

/** Transport actions a MIDI / UI source can trigger. */
export type TransportAction =
  | 'play'
  | 'pause'
  | 'stop'
  | 'ff'
  | 'rw'
  | 'record'
  | 'togglePlay';

export const TRANSPORT_ACTIONS: readonly TransportAction[] = [
  'play',
  'pause',
  'stop',
  'ff',
  'rw',
  'record',
  'togglePlay',
];

export function isTransportAction(v: unknown): v is TransportAction {
  return (
    typeof v === 'string' &&
    (TRANSPORT_ACTIONS as readonly string[]).includes(v)
  );
}

/** Take classification shared with the TakeDsp router (`TakeKind`). */
export type TakeClassification = 'chromatic' | 'drums' | 'unknown';

/** Compact noise fingerprint attached to a take (see `computeNoiseProfile`). */
export interface TakeNoiseProfile {
  levelDbfs: number;
  spectrumBands: number[];
  hum50HzDb?: number;
  hum60HzDb?: number;
}

/** A single recorded take with its analysis metadata. */
export interface RecordingTake {
  id: string;
  index: number;
  durationSec: number;
  sampleRate: number;
  channels: number;
  classification: TakeClassification;
  classificationConfidence: number;
  peakDbfs: number;
  noiseProfile?: TakeNoiseProfile;
}

/**
 * Binds one transport action to one MIDI source. `sourceType` uses the
 * canonical `MIDI_SOURCE_TYPES` ids from `midiLearnStore.js`
 * (0 CC · 1 NRPN · 2 AT · 3 PB · 4 NOTE · 5 SYSEX_TRANSPORT);
 * for type 5, `number` is the MMC command id.
 */
export interface TransportBinding {
  id: string;
  action: TransportAction;
  /** Canonical MIDI_SOURCE_TYPES id (0..5). */
  sourceType: number;
  /** 0 = Omni, 1..16 = channel. */
  channel: number;
  /** CC / note number / MMC command id. */
  number: number;
  label?: string;
}

/** A recording session: device, takes and transport map. */
export interface RecordingSession {
  contractVersion: string;
  id: string;
  name: string;
  createdAt: string;
  deviceId: string;
  sampleRate: number;
  takes: RecordingTake[];
  transport: TransportBinding[];
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.floor(Math.random() * 0xffffff).toString(36)}`;
}

/** Creates an empty session for `deviceId` at `sampleRate`. */
export function createRecordingSession(
  name: string,
  deviceId: string,
  sampleRate: number
): RecordingSession {
  return {
    contractVersion: RECORDING_SESSION_CONTRACT_VERSION,
    id: uid('rsess'),
    name,
    createdAt: new Date().toISOString(),
    deviceId,
    sampleRate: Math.max(1, Math.round(sampleRate)),
    takes: [],
    transport: [],
  };
}

/** Creates a transport binding for `action` from one MIDI source. */
export function createTransportBinding(
  action: TransportAction,
  sourceType: number,
  channel: number,
  number: number,
  label = ''
): TransportBinding {
  if (!isTransportAction(action)) throw new Error(`Unknown transport action: ${action}`);
  return {
    id: uid('tbind'),
    action,
    sourceType: Math.max(0, Math.min(5, Math.round(sourceType))),
    channel: Math.max(0, Math.min(16, Math.round(channel))),
    number: Math.max(0, Math.min(16383, Math.round(number))),
    ...(label ? { label } : {}),
  };
}
