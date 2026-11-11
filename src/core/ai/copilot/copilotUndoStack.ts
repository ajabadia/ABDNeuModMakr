// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — CopilotUndoStack
// 10-level deep circular memory undo stack for safe session mutations
// ─────────────────────────────────────────────────────────

export interface CopilotUndoEntry {
  label: string;
  timestamp: number;
  sessionSnapshotJson: string;
}

export class CopilotUndoStack {
  private stack: CopilotUndoEntry[] = [];
  private maxEntries = 10;
  private restoreHandler: ((snapshotJson: string) => Promise<boolean>) | null = null;

  constructor(maxEntries = 10) {
    this.maxEntries = maxEntries;
  }

  public setRestoreHandler(handler: (snapshotJson: string) => Promise<boolean>): void {
    this.restoreHandler = handler;
  }

  public pushBeforeAction(label: string, sessionSnapshotJson: string): void {
    if (!sessionSnapshotJson) return;
    this.stack.push({
      label,
      timestamp: Date.now(),
      sessionSnapshotJson,
    });
    if (this.stack.length > this.maxEntries) {
      this.stack.shift();
    }
  }

  public canUndo(): boolean {
    return this.stack.length > 0;
  }

  public peekUndoLabel(): string | null {
    if (this.stack.length === 0) return null;
    return this.stack[this.stack.length - 1].label;
  }

  public async undoLast(): Promise<{ ok: boolean; restoredLabel?: string; message?: string }> {
    if (this.stack.length === 0) {
      return { ok: false, message: 'No hay acciones previas para deshacer' };
    }
    const entry = this.stack.pop()!;
    if (!this.restoreHandler) {
      return { ok: false, message: 'No se ha configurado un manejador de restauracion' };
    }

    try {
      const success = await this.restoreHandler(entry.sessionSnapshotJson);
      if (success) {
        return {
          ok: true,
          restoredLabel: entry.label,
          message: `Deshecha la accion: ${entry.label}`,
        };
      }
      return { ok: false, message: 'Fallo al restaurar el estado anterior' };
    } catch (err: unknown) {
      return { ok: false, message: `Error en restauracion: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  public clear(): void {
    this.stack = [];
  }

  public getDepth(): number {
    return this.stack.length;
  }
}

export const copilotUndoStack = new CopilotUndoStack();
