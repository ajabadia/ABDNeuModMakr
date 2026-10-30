// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Session History (Undo / Redo)
//
// P1.1a: extracted from `WebAudioPipeline` with zero behavior change.
// Owns the undo/redo stacks; the pipeline only delegates and emits
// `history-changed`. Entries snapshot the mutable document
// (`{zones, processConfig}`) via `structuredClone` — never full-session
// JSON, never live references.
// ─────────────────────────────────────────────────────────

import type {
  ExtendedRegion,
  HistoryState,
  ProcessConfig,
  SynthArticulationConfig,
  Zone,
} from './types.ts';

/** Mutable document slice covered by undo/redo. */
export interface HistoryDocument {
  /** Session display name (auto-derived from first sample alongside modelName). */
  sessionName?: string;
  zones: Zone[];
  extendedRegions?: ExtendedRegion[];
  articulation?: SynthArticulationConfig;
  detectedInstrumentCategory?: string;
  processConfig: ProcessConfig;
}

interface HistoryEntry extends HistoryDocument {
  label: string;
  coalesceKey?: string;
  timestampMs: number;
}

export class SessionHistory {
  private static readonly MAX_HISTORY = 50;
  private static readonly COALESCE_WINDOW_MS = 450;

  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];

  public getState(): HistoryState {
    const undoTop = this.undoStack[this.undoStack.length - 1];
    const redoTop = this.redoStack[this.redoStack.length - 1];
    return {
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoLabel: undoTop ? undoTop.label : null,
      redoLabel: redoTop ? redoTop.label : null,
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length,
    };
  }

  public clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  /**
   * Records the pre-mutation document. Rapid successive pushes with the
   * same `coalesceKey` (slider/input drags) collapse into one step.
   * Returns `true` when a new step was recorded.
   */
  public push(doc: HistoryDocument, label: string, coalesceKey?: string): boolean {
    const now = Date.now();
    const top = this.undoStack[this.undoStack.length - 1];
    if (
      top &&
      coalesceKey &&
      top.coalesceKey === coalesceKey &&
      now - top.timestampMs <= SessionHistory.COALESCE_WINDOW_MS
    ) {
      top.timestampMs = now;
      this.redoStack = [];
      return false;
    }
    this.undoStack.push({
      label,
      sessionName: doc.sessionName,
      zones: structuredClone(doc.zones),
      extendedRegions: doc.extendedRegions ? structuredClone(doc.extendedRegions) : undefined,
      articulation: doc.articulation ? structuredClone(doc.articulation) : undefined,
      detectedInstrumentCategory: doc.detectedInstrumentCategory,
      processConfig: structuredClone(doc.processConfig),
      coalesceKey,
      timestampMs: now,
    });
    if (this.undoStack.length > SessionHistory.MAX_HISTORY) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    return true;
  }

  /** Restores the previous document, stashing the current one on redo. */
  public undo(current: HistoryDocument): (HistoryDocument & { label: string }) | null {
    if (this.undoStack.length === 0) return null;
    const entry = this.undoStack.pop()!;
    this.redoStack.push({
      label: entry.label,
      sessionName: current.sessionName,
      zones: structuredClone(current.zones),
      extendedRegions: current.extendedRegions ? structuredClone(current.extendedRegions) : undefined,
      articulation: current.articulation ? structuredClone(current.articulation) : undefined,
      detectedInstrumentCategory: current.detectedInstrumentCategory,
      processConfig: structuredClone(current.processConfig),
      timestampMs: Date.now(),
    });
    return {
      label: entry.label,
      sessionName: entry.sessionName,
      zones: structuredClone(entry.zones),
      extendedRegions: entry.extendedRegions ? structuredClone(entry.extendedRegions) : undefined,
      articulation: entry.articulation ? structuredClone(entry.articulation) : undefined,
      detectedInstrumentCategory: entry.detectedInstrumentCategory,
      processConfig: structuredClone(entry.processConfig),
    };
  }

  /** Re-applies an undone document, stashing the current one on undo. */
  public redo(current: HistoryDocument): (HistoryDocument & { label: string }) | null {
    if (this.redoStack.length === 0) return null;
    const entry = this.redoStack.pop()!;
    this.undoStack.push({
      label: entry.label,
      sessionName: current.sessionName,
      zones: structuredClone(current.zones),
      extendedRegions: current.extendedRegions ? structuredClone(current.extendedRegions) : undefined,
      articulation: current.articulation ? structuredClone(current.articulation) : undefined,
      detectedInstrumentCategory: current.detectedInstrumentCategory,
      processConfig: structuredClone(current.processConfig),
      timestampMs: Date.now(),
    });
    return {
      label: entry.label,
      sessionName: entry.sessionName,
      zones: structuredClone(entry.zones),
      extendedRegions: entry.extendedRegions ? structuredClone(entry.extendedRegions) : undefined,
      articulation: entry.articulation ? structuredClone(entry.articulation) : undefined,
      detectedInstrumentCategory: entry.detectedInstrumentCategory,
      processConfig: structuredClone(entry.processConfig),
    };
  }
}
