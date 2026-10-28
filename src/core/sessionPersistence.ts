// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Session Persistence (localStorage)
//
// Session-key localStorage read/write extracted verbatim from
// `WebAudioPipeline`. Owns the session storage key, JSON
// serialization, strict P0.2 validation on restore, and the
// demo-session name fixup. Bank-key persistence lives in
// `BankService`; the pipeline calls one function per key.
// ─────────────────────────────────────────────────────────

import type { Session } from './types.ts';
import { validateSessionPayload } from './sessionSchema.ts';
import { DEFAULT_MODEL_NAMES, DEFAULT_SAMPLE_NAME } from './sampleNaming.ts';

export const STORAGE_SESSION_KEY = 'abd_neumodmakr_session_v1';

export function persistSessionToLocalStorage(session: Session | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (session) {
      localStorage.setItem(STORAGE_SESSION_KEY, JSON.stringify(session));
    }
  } catch {
    // Ignore storage quota or private-mode errors
  }
}

export function restoreSessionFromLocalStorage(): Session | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const rawSession = localStorage.getItem(STORAGE_SESSION_KEY);
    if (!rawSession) return null;
    // P0.2: same strict validation as file import; corrupt state is
    // discarded instead of becoming the live session.
    const parsedSession = validateSessionPayload(JSON.parse(rawSession) as unknown);
    if (
      parsedSession.zones.length === 1 &&
      parsedSession.zones[0].sampleLow === DEFAULT_SAMPLE_NAME &&
      DEFAULT_MODEL_NAMES.has(parsedSession.processConfig?.modelName?.trim() ?? '')
    ) {
      parsedSession.zones[0].sampleLow = null;
    }
    return parsedSession;
  } catch {
    // Ignore malformed localStorage state
    return null;
  }
}
