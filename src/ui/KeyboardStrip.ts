// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Keyboard Strip Component
// Powered by @abdsynths/midi-keyb unified keyboard engine
// Interactive piano keyboard showing multizone layout & root pitch
// ─────────────────────────────────────────────────────────

import { createKeyboard, type KeyboardInstance } from '@abdsynths/midi-keyb';
import type { ExtendedRegion, WorkingMode, Zone } from '../core/types';
import {
  analyzeClassicZoneOverlaps,
  analyzeExtendedIntersections,
} from '../core/extendedAdapter';
import { midiToNoteName } from './ZoneRibbon';
import { toMidiVelocity, type RowAuditionSpan } from '../core/noteMapping';

export interface KeyboardStripHandlers {
  /** `velocity` is MIDI 1..127 (pointer Y on the key: top = soft, bottom = loud) */
  onNotePress: (midiNote: number, velocity: number) => void;
  onNoteRelease: (midiNote: number) => void;
}

export class KeyboardStrip {
  private container: HTMLElement;
  private handlers: KeyboardStripHandlers;
  private baseOctave: number = 2; // C2 (36) by default
  private activeZone: Zone | null = null;
  private allZones: Zone[] = [];
  private extendedRegions: ExtendedRegion[] = [];
  private workingMode: WorkingMode = 'classic';
  private kbdInstance: KeyboardInstance | null = null;
  private auditionSpan: RowAuditionSpan | null = null;

  constructor(container: HTMLElement, handlers: KeyboardStripHandlers) {
    this.container = container;
    this.handlers = handlers;
    this.render();
  }

  public setZones(
    zones: Zone[],
    activeZoneId?: string | null,
    extendedRegions?: ExtendedRegion[],
    workingMode?: WorkingMode
  ): void {
    this.allZones = zones || [];
    if (activeZoneId !== undefined) {
      this.activeZone = this.allZones.find((z) => z.id === activeZoneId) || null;
    }
    if (extendedRegions !== undefined) {
      this.extendedRegions = extendedRegions;
    }
    if (workingMode !== undefined) {
      this.workingMode = workingMode;
    }
    this.syncZonesToKeyboard();
  }

  public setActiveZone(zone: Zone | null): void {
    this.activeZone = zone;
    this.syncZonesToKeyboard();
  }

  /**
   * Marks the key range (and root key) of the table row being auditioned.
   * If the root key is outside the visible 5 octaves, the keybed scrolls to show it.
   */
  public setAuditionSpan(span: RowAuditionSpan | null): void {
    this.auditionSpan = span ? { ...span } : null;
    if (span) {
      const start = this.baseOctave * 12;
      const end = start + 60;
      if (span.rootKey < start || span.rootKey > end) {
        // Centre the root key in the 5-octave window (setBaseOctave re-applies the marks)
        this.setBaseOctave(Math.floor(span.rootKey / 12) - 2);
        return;
      }
    }
    this.applyAuditionSpan();
  }

  private applyAuditionSpan(): void {
    const keys = this.container.querySelectorAll<HTMLElement>('[data-note]');
    const s = this.auditionSpan;
    keys.forEach((el) => {
      const midi = parseInt(el.getAttribute('data-note') ?? '', 10);
      const inRange = !!s && !isNaN(midi) && midi >= s.lowKey && midi <= s.highKey;
      el.classList.toggle('kbd-audition-range', inRange);
      el.classList.toggle('kbd-audition-root', inRange && midi === s!.rootKey);
      el.classList.toggle('kbd-audition-edge-low', inRange && midi === s!.lowKey);
      el.classList.toggle('kbd-audition-edge-high', inRange && midi === s!.highKey);
    });
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
      onNoteOn: (note: number, velocity?: number) => {
        this.handlers.onNotePress(note, toMidiVelocity(velocity));
      },
      onNoteOff: (note: number) => {
        this.handlers.onNoteRelease(note);
      },
      onCollapseChange: (collapsed: boolean) => {
        this.container.querySelector('.keyboard-strip-container')?.classList.toggle('is-strip-collapsed', collapsed);
      },
      config: {
        numOctaves: 5,
        startNote: this.baseOctave * 12,
        fixedOctaves: true,
        enablePanic: false,
        enableWheels: false,
        enableCollapse: true,
        enableSustain: false,
        enableHold: false,
        enableRetrig: false,
        enableQwerty: true,
        showQwertyLabels: false,
        enableTouch: true,
        // Velocity from click height on the key so Low/High velocity layers can be auditioned
        velocitySource: 'yPosition',
        velocityCurve: 'normal'
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

    const extReport =
      this.workingMode === 'extended' && this.extendedRegions.length > 0
        ? analyzeExtendedIntersections(this.extendedRegions)
        : null;
    const classicOverlaps = analyzeClassicZoneOverlaps(this.allZones);

    // Convert zones to format expected by MidiKeyboard, coloring intersecting zones with --color-warning
    const mapped = this.allZones.map((z) => {
      const hasExtIntersect = extReport
        ? extReport.intersectingKeySpans.some(
            (sp) => sp.lowKey <= z.highKey && sp.highKey >= z.lowKey
          )
        : false;
      const hasClassicIntersect = (classicOverlaps[z.id]?.overlappingZones.length ?? 0) > 0;
      const isIntersecting = hasExtIntersect || hasClassicIntersect;
      return {
        id: z.id,
        lowKey: z.lowKey,
        highKey: z.highKey,
        rootKey: z.rootKey,
        color: isIntersecting ? 'var(--color-warning)' : 'var(--color-accent)',
      };
    });

    const activeId = this.activeZone?.id;
    this.kbdInstance.setZones(mapped, activeId);
    this.updateKeyBadges();
  }

  private updateKeyBadges(): void {
    const keyElements = this.container.querySelectorAll<HTMLElement>('[data-note]');
    const activeRoot = this.activeZone?.rootKey;

    keyElements.forEach((el) => {
      const noteAttr = el.getAttribute('data-note');
      if (!noteAttr) return;
      const midi = parseInt(noteAttr, 10);
      if (isNaN(midi)) return;

      const existingRef = el.querySelector('.kbd-key-ref-label');
      if (existingRef) existingRef.remove();
      const existingRoot = el.querySelector('.kbd-key-root-badge');
      if (existingRoot) existingRoot.remove();

      // Reference note label on C keys
      if (midi % 12 === 0) {
        const refEl = document.createElement('span');
        refEl.className = 'kbd-key-ref-label';
        refEl.textContent = midiToNoteName(midi);
        el.appendChild(refEl);
      }

      // Root note indicator badge for active zone
      if (activeRoot !== undefined && midi === activeRoot) {
        const rootEl = document.createElement('span');
        rootEl.className = 'kbd-key-root-badge';
        rootEl.textContent = `R: ${midiToNoteName(midi)}`;
        el.appendChild(rootEl);
      }
    });
    this.applyAuditionSpan();
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
