// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Session Factory (P1.1b)
//
// Pure constructors extracted verbatim from `WebAudioPipeline`:
// zone id generation, zone/session creation. No behavior change.
// ─────────────────────────────────────────────────────────

import { DEFAULT_AI_ASSISTANCE_CONFIG, type MidiNote, type Session, type Zone } from './types.ts';

let zoneIdCounter = 0;
export function nextZoneId(): string {
  return `zone-${++zoneIdCounter}-${Date.now().toString(36)}`;
}

export function createZone(
  low: MidiNote,
  root: MidiNote,
  high: MidiNote,
  sampleLow: string | null = null
): Zone {
  return {
    id: nextZoneId(),
    lowKey: low,
    rootKey: root,
    highKey: high,
    sampleLow,
    sampleHigh: null,
    velSplit: 64,
    detune: 0,
    volume: 0,
    pan: 0,
  };
}

export function createInitialSession(name: string): Session {
  const now = new Date().toISOString();
  return {
    id: `session-${Date.now().toString(36)}`,
    name,
    zones: [createZone(0, 60, 127, null)],
    processConfig: {
      modelNumber: 0,
      modelName: 'NewModel',
      complexity: 8,
      parameterSet: 0,
      targetFormat: 'dual',
      aiConfig: { ...DEFAULT_AI_ASSISTANCE_CONFIG },
    },
    dirty: false,
    createdAt: now,
    modifiedAt: now,
  };
}
