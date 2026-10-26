// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Keyboard Strip Component
// Interactive piano keyboard showing active zone & root pitch
// ─────────────────────────────────────────────────────────

import type { Zone } from '../core/types';
import { midiToNoteName } from './ZoneRibbon';

export interface KeyboardStripHandlers {
  onNotePress: (midiNote: number) => void;
  onNoteRelease: (midiNote: number) => void;
}

export class KeyboardStrip {
  private container: HTMLElement;
  private handlers: KeyboardStripHandlers;
  private baseOctave: number = 2; // C2 (36) to C7 (96) by default (61 keys visible)
  private activeZone: Zone | null = null;
  private pressedNotes: Set<number> = new Set();

  constructor(container: HTMLElement, handlers: KeyboardStripHandlers) {
    this.container = container;
    this.handlers = handlers;
    this.render();
  }

  public setActiveZone(zone: Zone | null): void {
    this.activeZone = zone;
    this.updateKeyHighlighting();
  }

  public setBaseOctave(oct: number): void {
    this.baseOctave = Math.max(0, Math.min(6, oct));
    this.render();
  }

  private render(): void {
    const startNote = this.baseOctave * 12;
    const keyCount = 61; // 5 octaves + top C

    this.container.innerHTML = `
      <div class="keyboard-strip-container">
        <div class="keyboard-toolbar">
          <div class="keyboard-hud">
            <span class="hud-label">KEYBED RANGE:</span>
            <span class="hud-value">${midiToNoteName(startNote)} (${startNote}) — ${midiToNoteName(startNote + keyCount - 1)} (${startNote + keyCount - 1})</span>
          </div>
          <div class="keyboard-octave-controls">
            <button type="button" class="btn btn-xs" id="btn-oct-down" ${this.baseOctave <= 0 ? 'disabled' : ''}>OCT −</button>
            <span class="octave-indicator">OCT ${this.baseOctave}</span>
            <button type="button" class="btn btn-xs" id="btn-oct-up" ${this.baseOctave >= 6 ? 'disabled' : ''}>OCT +</button>
          </div>
        </div>

        <div class="piano-keys-bed" id="piano-keys-bed">
          ${this.renderKeys(startNote, keyCount)}
        </div>
      </div>
    `;

    this.bindEvents();
    this.updateKeyHighlighting();
  }

  private renderKeys(startNote: number, count: number): string {
    const keysHtml: string[] = [];

    for (let i = 0; i < count; i++) {
      const midi = startNote + i;
      const isBlack = [1, 3, 6, 8, 10].includes(midi % 12);
      const noteName = midiToNoteName(midi);

      keysHtml.push(`
        <div 
          class="piano-key ${isBlack ? 'black-key' : 'white-key'}" 
          data-midi="${midi}"
          data-note="${noteName}"
          title="${noteName} (MIDI ${midi})"
        >
          <div class="key-root-pin" id="pin-${midi}"></div>
          <span class="key-label">${(midi % 12 === 0) ? noteName : ''}</span>
        </div>
      `);
    }

    return keysHtml.join('');
  }

  private updateKeyHighlighting(): void {
    const keys = this.container.querySelectorAll('.piano-key');
    keys.forEach((el) => {
      const midi = parseInt(el.getAttribute('data-midi') || '-1', 10);
      if (midi < 0) return;

      const isInZone = this.activeZone && midi >= this.activeZone.lowKey && midi <= this.activeZone.highKey;
      const isRoot = this.activeZone && midi === this.activeZone.rootKey;

      el.classList.toggle('is-in-active-zone', Boolean(isInZone));
      el.classList.toggle('is-root-key', Boolean(isRoot));
    });
  }

  private bindEvents(): void {
    this.container.querySelector('#btn-oct-down')?.addEventListener('click', () => {
      this.setBaseOctave(this.baseOctave - 1);
    });

    this.container.querySelector('#btn-oct-up')?.addEventListener('click', () => {
      this.setBaseOctave(this.baseOctave + 1);
    });

    const keys = this.container.querySelectorAll<HTMLElement>('.piano-key');
    keys.forEach((el) => {
      const midi = parseInt(el.getAttribute('data-midi') || '-1', 10);
      if (midi < 0) return;

      const press = () => {
        el.classList.add('is-pressed');
        this.pressedNotes.add(midi);
        this.handlers.onNotePress(midi);
      };

      const release = () => {
        el.classList.remove('is-pressed');
        this.pressedNotes.delete(midi);
        this.handlers.onNoteRelease(midi);
      };

      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        press();
      });

      el.addEventListener('mouseenter', (e: MouseEvent) => {
        if (e.buttons === 1) {
          press();
        }
      });

      el.addEventListener('mouseup', release);
      el.addEventListener('mouseleave', release);
    });
  }
}
