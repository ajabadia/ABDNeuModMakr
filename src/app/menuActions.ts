// ─────────────────────────────────────────────────────────
// MenuActions — navbar menu handlers, undo/redo, keyboard shortcuts
// and the unsaved-changes guard. Extracted verbatim from App
// (src/main.ts). Shell state and UI components arrive through
// MenuContext; import flows are delegated to ImportHandlers.
// ─────────────────────────────────────────────────────────

import type { CoreService, Session } from '../core';
import type { AppNavbar, NavbarHandlers } from '../ui/Navbar';
import type { ZoneInspector } from '../ui/ZoneInspector';
import type { SpectralView } from '../ui/SpectralView';
import type { TelemetryDrawer } from '../ui/TelemetryDrawer';
import type { BankDrawer } from '../ui/BankDrawer';
import type { ImportHandlers } from './importHandlers';

export interface MenuShell {
  getNavbar(): AppNavbar;
  getInspector(): ZoneInspector;
  getSpectralView(): SpectralView;
  getTelemetry(): TelemetryDrawer;
  getBank(): BankDrawer;
}

export interface MenuContext {
  core: CoreService;
  imports: ImportHandlers;
  shell: MenuShell;
  session: Session | null;
  selectedZoneId: string | null;
  themes: readonly string[];
  themeIndex: number;
  log(msg: string): void;
  refresh(): void;
  getActiveZone(): import('../core').Zone | null;
  getActiveZoneIndex(): number;
  handleStartProcess(): Promise<void>;
  toggleSpectralPanel(): void;
}

export class MenuActions {
  private ctx: MenuContext;

  constructor(ctx: MenuContext) {
    this.ctx = ctx;
  }

  buildNavbarHandlers(): NavbarHandlers {
    return {
      onNewSession: async () => {
        this.ctx.session = await this.ctx.core.newSession('Init Model');
        this.ctx.selectedZoneId = this.ctx.session.zones[0]?.id || null;
        this.ctx.shell.getTelemetry().addLog('Created new session: Init Model');
        this.ctx.refresh();
      },
      onOpenSession: () => this.ctx.imports.triggerOpenSession(),
      onSaveSession: async () => {
        if (this.ctx.session) {
          await this.ctx.core.saveSession(this.ctx.session);
          const jsonText = this.ctx.core.exportSessionJson();
          const blob = new Blob([jsonText], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          const safeName = this.ctx.session.name.replace(/[^A-Za-z0-9_-]/g, '_');
          a.href = url;
          a.download = `${safeName}.nmsession.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          this.ctx.shell.getTelemetry().addLog(
            `Session "${this.ctx.session.name}" saved to localStorage and downloaded as ${safeName}.nmsession.json`
          );
        }
      },
      onImportSamples: () => this.ctx.imports.triggerAudioImport('samples'),
      onImportFolder: () => this.ctx.imports.triggerFolderImport(),
      onImportByName: () => this.ctx.imports.triggerAudioImport('by-name'),
      onImportModelFolder: () => this.ctx.imports.triggerModelFolderImport(),
      onConfigureNeuronDbFolder: () => this.ctx.imports.triggerConfigureNeuronDbFolder(),
      onImportModel: () => this.ctx.imports.triggerModelImport(),
      onExportModel: async () => {
        if (!this.ctx.session) return;
        const slot = this.ctx.session.processConfig.modelNumber;
        const safeName = this.ctx.session.processConfig.modelName.replace(/[^A-Za-z0-9_-]/g, '_');
        await this.ctx.core.exportModel(
          slot,
          `NeuronModel_${String(slot).padStart(3, '0')}_${safeName}.zip`
        );
        this.ctx.shell.getTelemetry().addLog(
          `Exported Dual-Target model package #${String(slot).padStart(3, '0')} (${this.ctx.session.processConfig.modelName}) as .zip`
        );
      },
      onExportZoneAiff: () => {
        const active = this.ctx.getActiveZone();
        if (!active) return;
        try {
          const { filename, bytes } = this.ctx.core.exportZoneAsAiff(active.id);
          this.ctx.shell.getTelemetry().addLog(
            `Exported canonical 44.1 kHz 16-bit Mono AIFF: ${filename} (${bytes.byteLength} bytes)`
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.ctx.shell.getTelemetry().addLog(`AIFF export error: ${msg}`);
        }
      },
      onUndo: () => this.performUndo(),
      onRedo: () => this.performRedo(),
      onAddZone: async () => {
        const active = this.ctx.getActiveZone();
        const root = active ? active.rootKey : 60;
        const newZ = await this.ctx.core.addZone(root);
        this.ctx.session = this.ctx.core.getSession()!;
        this.ctx.selectedZoneId = newZ.id;
        this.ctx.shell.getTelemetry().addLog(`Added zone splitting at MIDI ${root}`);
        this.ctx.refresh();
      },
      onRemoveZone: async () => {
        if (this.ctx.selectedZoneId && this.ctx.session && this.ctx.session.zones.length > 1) {
          await this.ctx.core.removeZone(this.ctx.selectedZoneId);
          this.ctx.session = this.ctx.core.getSession()!;
          this.ctx.selectedZoneId = this.ctx.session.zones[0]?.id || null;
          this.ctx.shell.getTelemetry().addLog('Removed zone. Contiguous boundaries preserved.');
          this.ctx.refresh();
        }
      },
      onClearZones: () => {
        this.ctx.session = this.ctx.core.resetZonesToSingle();
        this.ctx.selectedZoneId = this.ctx.session.zones[0]?.id || null;
        this.ctx.shell.getTelemetry().addLog('Reset keyboard to full 0..127 single zone.');
        this.ctx.refresh();
      },
      onAutoRepairCoverage: () => {
        this.ctx.session = this.ctx.core.autoRepairCoverage();
        this.ctx.selectedZoneId = this.ctx.session.zones[0]?.id || null;
        this.ctx.shell.getTelemetry().addLog('Auto-repaired MIDI 0..127 zone coverage and root keys.');
        this.ctx.refresh();
      },
      onStartProcess: () => this.ctx.handleStartProcess(),
      onValidateCoverage: () => {
        const errs = this.ctx.core.validateCoverage();
        if (errs.length === 0) {
          this.ctx.shell.getTelemetry().addLog('Validation OK: Full continuous MIDI 0..127 coverage verified with no gaps.');
        } else {
          this.ctx.shell.getTelemetry().addLog(`Coverage errors detected (${errs.length}): ${errs.join(' | ')}`);
        }
        this.ctx.shell.getTelemetry().open();
      },
      onSetTargetFormat: (format) => {
        this.ctx.session = this.ctx.core.updateProcessConfig({ targetFormat: format });
        this.ctx.shell.getTelemetry().addLog(`Target output profile set to: ${format}`);
        this.ctx.refresh();
      },
      onToggleZoneDrawer: () => this.ctx.shell.getInspector().toggleDrawer(),
      onToggleSpectral: () => this.ctx.toggleSpectralPanel(),
      onToggleBank: async () => {
        const bank = await this.ctx.core.loadBank();
        this.ctx.shell.getBank().setBank(bank, this.ctx.session?.processConfig.modelNumber ?? null);
        this.ctx.shell.getBank().toggle();
      },
      onToggleLogs: () => this.ctx.shell.getTelemetry().toggle(),
      onSelectTheme: (theme) => {
        const idx = this.ctx.themes.indexOf(theme);
        if (idx >= 0) {
          this.ctx.themeIndex = idx;
        }
        document.documentElement.setAttribute('data-theme', theme);
        this.ctx.shell.getNavbar().setTheme(theme);
        this.ctx.shell.getSpectralView()?.refreshTheme();
        this.ctx.shell.getTelemetry().addLog(`Theme switched to: ${theme}`);
      },
      onToggleTheme: () => {
        this.ctx.themeIndex = (this.ctx.themeIndex + 1) % this.ctx.themes.length;
        const next = this.ctx.themes[this.ctx.themeIndex];
        document.documentElement.setAttribute('data-theme', next);
        this.ctx.shell.getNavbar().setTheme(next);
        this.ctx.shell.getSpectralView()?.refreshTheme();
        this.ctx.shell.getTelemetry().addLog(`Theme switched to: ${next}`);
      }
    };
  }

  bindUnsavedChangesGuard(): void {
    window.addEventListener('beforeunload', (e) => {
      if (this.ctx.session?.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  performUndo(): void {
    const state = this.ctx.core.getHistoryState();
    if (!state.canUndo) return;
    const label = state.undoLabel;
    const restored = this.ctx.core.undo();
    if (restored) {
      this.ctx.session = restored;
      if (!this.ctx.session.zones.some((z) => z.id === this.ctx.selectedZoneId)) {
        this.ctx.selectedZoneId = this.ctx.session.zones[0]?.id || null;
      }
      this.ctx.shell.getTelemetry().addLog(`Undo: ${label}`);
      this.ctx.refresh();
    }
  }

  performRedo(): void {
    const state = this.ctx.core.getHistoryState();
    if (!state.canRedo) return;
    const label = state.redoLabel;
    const restored = this.ctx.core.redo();
    if (restored) {
      this.ctx.session = restored;
      if (!this.ctx.session.zones.some((z) => z.id === this.ctx.selectedZoneId)) {
        this.ctx.selectedZoneId = this.ctx.session.zones[0]?.id || null;
      }
      this.ctx.shell.getTelemetry().addLog(`Redo: ${label}`);
      this.ctx.refresh();
    }
  }

  bindKeyboardShortcuts(): void {
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'SELECT' ||
          target.tagName === 'TEXTAREA');

      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase();
        if (key === 'z' && !e.shiftKey) {
          e.preventDefault();
          this.performUndo();
          return;
        }
        if (key === 'y' || (key === 'z' && e.shiftKey)) {
          e.preventDefault();
          this.performRedo();
          return;
        }
        if (key === 's') {
          e.preventDefault();
          if (this.ctx.session) {
            void this.ctx.core.saveSession(this.ctx.session);
            const jsonText = this.ctx.core.exportSessionJson();
            const blob = new Blob([jsonText], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const safeName = this.ctx.session.name.replace(/[^A-Za-z0-9_-]/g, '_');
            a.href = url;
            a.download = `${safeName}.nmsession.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            this.ctx.shell.getTelemetry().addLog(`Saved session ${safeName}.nmsession.json`);
          }
          return;
        }
        if (isInput) return;

        if (key === 'o') {
          e.preventDefault();
          this.ctx.imports.triggerOpenSession();
        } else if (key === 'i') {
          e.preventDefault();
          this.ctx.imports.triggerAudioImport('samples');
        } else if (key === 'n') {
          e.preventDefault();
          this.ctx.imports.triggerAudioImport('by-name');
        } else if (key === 'p' || e.key === 'Enter') {
          e.preventDefault();
          void this.ctx.handleStartProcess();
        } else if (key === 'b') {
          e.preventDefault();
          void this.ctx.core.loadBank().then((bank) => {
            this.ctx.shell.getBank().setBank(bank, this.ctx.session?.processConfig.modelNumber ?? null);
            this.ctx.shell.getBank().toggle();
          });
        } else if (key === 'l') {
          e.preventDefault();
          this.ctx.shell.getTelemetry().toggle();
        } else if (key === 'm') {
          e.preventDefault();
          this.ctx.shell.getInspector().toggleDrawer();
        } else if (key === 'e') {
          e.preventDefault();
          this.ctx.toggleSpectralPanel();
        } else if (key === 't') {
          e.preventDefault();
          if (this.ctx.session) {
            const slot = this.ctx.session.processConfig.modelNumber;
            const safeName = this.ctx.session.processConfig.modelName.replace(
              /[^A-Za-z0-9_-]/g,
              '_'
            );
            void this.ctx.core.exportModel(
              slot,
              `NeuronModel_${String(slot).padStart(3, '0')}_${safeName}.zip`
            );
          }
        }
        return;
      }

      if (e.key === 'F1') {
        e.preventDefault();
        this.ctx.shell.getNavbar().showDocModal('manual');
        return;
      }

      if (isInput) return;

      if (e.key === 'Insert') {
        e.preventDefault();
        const active = this.ctx.getActiveZone();
        if (active) {
          void this.ctx.core.addZone(active.rootKey).then((newZ) => {
            this.ctx.session = this.ctx.core.getSession()!;
            this.ctx.selectedZoneId = newZ.id;
            this.ctx.shell.getTelemetry().addLog(`Split zone at MIDI ${active.rootKey}`);
            this.ctx.refresh();
          });
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.ctx.selectedZoneId && this.ctx.session && this.ctx.session.zones.length > 1) {
          e.preventDefault();
          void this.ctx.core.removeZone(this.ctx.selectedZoneId).then(() => {
            this.ctx.session = this.ctx.core.getSession()!;
            this.ctx.selectedZoneId = this.ctx.session.zones[0]?.id || null;
            this.ctx.shell.getTelemetry().addLog(`Removed selected zone via keyboard shortcut.`);
            this.ctx.refresh();
          });
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (!this.ctx.session || this.ctx.session.zones.length <= 1) return;
        e.preventDefault();
        const currIdx = this.ctx.getActiveZoneIndex();
        const delta = e.key === 'ArrowLeft' ? -1 : 1;
        const nextIdx = (currIdx + delta + this.ctx.session.zones.length) % this.ctx.session.zones.length;
        const nextZone = this.ctx.session.zones[nextIdx];
        if (nextZone) {
          this.ctx.selectedZoneId = nextZone.id;
          this.ctx.refresh();
        }
      } else if (e.key === ' ') {
        e.preventDefault();
        const rt = this.ctx.core.getRealtimeSpectrum();
        if (rt.isPlaying) {
          this.ctx.core.stopAudition();
        } else {
          const active = this.ctx.getActiveZone();
          if (active) {
            const kbMode = this.ctx.shell.getSpectralView().getKeyboardMode();
            void this.ctx.core.auditionZoneComparison(active.id, kbMode);
            this.ctx.shell.getSpectralView().notifyPlaybackStarted();
          }
        }
      }
    });
  }
}
