export interface MidiLearnMapping {
  id: string;
  sourceType: number;
  channel: number;
  number: number;
  targetIndex: number;
  targetKey: string;
  minNorm: number;
  maxNorm: number;
  invert: boolean;
  curve: number;
}

export interface MidiLearnActivity {
  sourceType: number;
  channel: number;
  number: number;
  rawValue: number;
  normalizedValue: number;
  timestamp: number;
}

export interface MidiLearnStoreState {
  mappings: MidiLearnMapping[];
  learningTargetIndex: number;
  learningTargetKey: string;
  learnMode: 'none' | 'replace' | 'add';
  isLearning: boolean;
  learnRemainingSeconds: number;
  globalOverlayActive: boolean;
  lastActivity: MidiLearnActivity | null;
}

export interface MidiLearnStoreOptions {
  persist?: boolean;
  storageKey?: string;
  learnTimeoutMs?: number;
  onSyncToHost?: (payload: {
    mappings: MidiLearnMapping[];
    learningTargetIndex: number;
    learningTargetKey: string;
    learnMode: 'none' | 'replace' | 'add';
  }) => void;
  onApplyParam?: (targetIndex: number, targetKey: string, normVal: number) => void;
}

export interface MidiLearnStore {
  getState(): MidiLearnStoreState;
  subscribe(listener: (state: MidiLearnStoreState) => void): () => void;
  startLearning(targetIndex: number, targetKey?: string, mode?: 'replace' | 'add'): void;
  cancelLearning(): void;
  setGlobalOverlayActive(active: boolean): void;
  toggleGlobalOverlay(): boolean;
  getMappingsForTarget(targetIndex: number, targetKey?: string): MidiLearnMapping[];
  getMappingsForSource(sourceType: number, number: number, channel?: number): MidiLearnMapping[];
  upsertMapping(entry: Partial<MidiLearnMapping> & { targetIndex: number }): MidiLearnMapping | null;
  updateMapping(id: string, patch: Partial<MidiLearnMapping>): boolean;
  removeMapping(id: string): boolean;
  unbindTarget(targetIndex: number, targetKey?: string): boolean;
  clearAll(): void;
  handleIncomingMidi(msg: {
    sourceType?: number;
    channel?: number;
    number?: number;
    rawValue?: number;
    normalizedValue?: number;
  }): {
    consumed: boolean;
    learned?: MidiLearnMapping;
    evaluated?: Array<{ mapping: MidiLearnMapping; normalizedValue: number }>;
  };
  syncFromHost(payload: {
    mappings?: MidiLearnMapping[];
    learningTargetIndex?: number;
    learningTargetKey?: string;
    learnMode?: number | 'none' | 'replace' | 'add';
  }): void;
  recordActivity(activity: Partial<MidiLearnActivity>): void;
  exportJson(synthName?: string): string;
  importJson(jsonInput: string | object): { ok: boolean; count: number };
}

export const MIDI_SOURCE_TYPES: {
  readonly CC: 0;
  readonly NRPN: 1;
  readonly AFTERTOUCH: 2;
  readonly PITCH_BEND: 3;
};

export const MIDI_CURVE_TYPES: {
  readonly LINEAR: 0;
  readonly EXPONENTIAL: 1;
  readonly LOGARITHMIC: 2;
};

export function createMidiLearnStore(options?: MidiLearnStoreOptions): MidiLearnStore;
export function evaluateMidiMapping(mapping: Partial<MidiLearnMapping>, inputNorm01: number): number;
export function formatMidiSourceBadge(mapping: Partial<MidiLearnMapping>): string;
export function formatMidiMappingSummary(mapping: Partial<MidiLearnMapping>): string;

export function attachMidiLearnUI(options: {
  store: MidiLearnStore;
  root?: HTMLElement;
  getParamMeta?: (paramIndex: number) => { name?: string; group?: string; key?: string };
  onOpenDrawer?: (focusParamIndex?: number) => void;
}): {
  refresh: () => void;
  closeMenu: () => void;
  destroy: () => void;
};

export function createMidiLearnDrawerContent(options: {
  store: MidiLearnStore;
  parameters?: Array<{ index: number; name: string; group?: string; key?: string }>;
  focusParamIndex?: number;
  synthName?: string;
  onClose?: () => void;
}): HTMLElement & { _destroyMidiLearnDrawer?: () => void };
