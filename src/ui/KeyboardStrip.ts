// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Keyboard Strip Component
// Powered by @abdsynths/midi-keyb unified keyboard engine
// Interactive piano keyboard showing multizone layout & root pitch
// ─────────────────────────────────────────────────────────

import { createKeyboard } from '@abdsynths/midi-keyb';
import type { Zone } from '../core/types';
import { midiToNoteName } from './ZoneRibbon';

export interface KeyboardStripHandlers {
  onNotePress: (midiNote: number) => void;
  onNoteRelease: (midiNote: number) => void;
}

export class KeyboardStrip {
  private container: HTMLElement;
  private handlers: KeyboardStripHandlers;
  private baseOctave: number = 2; // C2 (36) by default
  private activeZone: Zone | null = null;
  private allZones: Zone[] = [];
  private kbdInstance: any = null;

  constructor(container: HTMLElement, handlers: KeyboardStripHandlers) {
    this.container = container;
    this.handlers = handlers;
    this.render();
  }

  public setZones(zones: Zone[], activeZoneId?: string | null): void {
    this.allZones = zones || [];
    if (activeZoneId !== undefined) {
      this.activeZone = this.allZones.find((z) => z.id === activeZoneId) || null;
    }
    this.syncZonesToKeyboard();
  }

  public setActiveZone(zone: Zone | null): void {
    this.activeZone = zone;
    this.syncZonesToKeyboard();
  }

  public setBaseOctave(oct: number): void {
    this.baseOctave = Math.max(0, Math.min(5, oct));
    if (this.kbdInstance?.setOctaveCount) {
      this.kbdInstance.setOctaveCount(5, this.baseOctave * 12);
    }
    this.updateHud();
    this.syncZonesToKeyboard();
  }

  private render(): void {
    const startNote = this.baseOctave * 12;
    const keyCount = 61; // 5 octaves + top C

    this.container.innerHTML = `
      <div class="keyboard-strip-container">
        <div class="keyboard-toolbar">
          <div class="keyboard-hud">
            <span class="hud-label">KEYBED RANGE:</span>
            <span class="hud-value" id="kbd-range-text">${midiToNoteName(startNote)} (${startNote}) — ${midiToNoteName(startNote + keyCount - 1)} (${startNote + keyCount - 1})</span>
          </div>
          <div class="keyboard-octave-controls">
            <button type="button" class="btn btn-xs" id="btn-oct-down" ${this.baseOctave <= 0 ? 'disabled' : ''}>OCT −</button>
            <span class="octave-indicator" id="kbd-oct-indicator">OCT ${this.baseOctave}</span>
            <button type="button" class="btn btn-xs" id="btn-oct-up" ${this.baseOctave >= 5 ? 'disabled' : ''}>OCT +</button>
          </div>
        </div>

        <div class="piano-keys-bed" id="piano-keyboard"></div>
      </div>
    `;

    this.initMidiKeyboard();
    this.bindEvents();
    this.syncZonesToKeyboard();
  }

  private initMidiKeyboard(): void {
    if (this.kbdInstance?.destroy) {
      this.kbdInstance.destroy();
    }

    this.kbdInstance = createKeyboard({
      containerId: 'piano-keyboard',
      wheelPitchId: null,
      wheelModId: null,
      onNoteOn: (note: number) => {
        this.handlers.onNotePress(note);
      },
      onNoteOff: (note: number) => {
        this.handlers.onNoteRelease(note);
      },
      config: {
        numOctaves: 5,
        startNote: this.baseOctave * 12,
        fixedOctaves: true,
        enablePanic: false,
        enableWheels: false,
        enableCollapse: true,
        enableQwerty: true,
        showQwertyLabels: false,
        enableTouch: true
      }
    });
  }

  private updateHud(): void {
    const startNote = this.baseOctave * 12;
    const keyCount = 61;
    const rangeEl = this.container.querySelector('#kbd-range-text');
    if (rangeEl) {
      rangeEl.textContent = `${midiToNoteName(startNote)} (${startNote}) — ${midiToNoteName(startNote + keyCount - 1)} (${startNote + keyCount - 1})`;
    }
    const octEl = this.container.querySelector('#kbd-oct-indicator');
    if (octEl) {
      octEl.textContent = `OCT ${this.baseOctave}`;
    }
    const downBtn = this.container.querySelector<HTMLButtonElement>('#btn-oct-down');
    if (downBtn) downBtn.disabled = this.baseOctave <= 0;
    const upBtn = this.container.querySelector<HTMLButtonElement>('#btn-oct-up');
    if (upBtn) upBtn.disabled = this.baseOctave >= 5;
  }

  private syncZonesToKeyboard(): void {
    if (!this.kbdInstance?.setZones) return;

    // Convert zones to format expected by MidiKeyboard
    const mapped = this.allZones.map((z) => ({
      id: z.id,
      lowKey: z.lowKey,
      highKey: z.highKey,
      rootKey: z.rootKey,
      color: 'var(--color-accent, #00c8ff)'
    }));

    const activeId = this.activeZone?.id;
    this.kbdInstance.setZones(mapped, activeId);
  }

  private bindEvents(): void {
    this.container.querySelector('#btn-oct-down')?.addEventListener('click', () => {
      this.setBaseOctave(this.baseOctave - 1);
    });

    this.container.querySelector('#btn-oct-up')?.addEventListener('click', () => {
      this.setBaseOctave(this.baseOctave + 1);
    });
  }

  public destroy(): void {
    if (this.kbdInstance?.destroy) {
      this.kbdInstance.destroy();
      this.kbdInstance = null;
    }
  }
}
