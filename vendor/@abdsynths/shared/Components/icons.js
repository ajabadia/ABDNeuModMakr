/**
 * ABDSharedAssets — SVG icon library for synth UI.
 *
 * Canonical icon set shared across all ABDSynths plugins.
 * Usage: import { WAVE_ICONS, FILTER_ICONS, CONTROL_ICONS } from '@abdsynths/shared/components';
 */

export const WAVE_ICONS = {
  saw: `<svg viewBox="0 0 24 16" class="sel-icon"><polyline points="2,14 20,2 20,14" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`,
  square: `<svg viewBox="0 0 24 16" class="sel-icon"><polyline points="2,14 2,2 12,2 12,14 22,14 22,2" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`,
  triangle: `<svg viewBox="0 0 24 16" class="sel-icon"><polyline points="2,14 12,2 22,14" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`,
  sine: `<svg viewBox="0 0 24 16" class="sel-icon"><path d="M2,8 C7,0 7,16 12,8 C17,0 17,16 22,8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  vox: `<svg viewBox="0 0 24 16" class="sel-icon"><path d="M3,12 C5,5 7,13 12,8 C17,3 19,11 21,5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  dwgs: `<svg viewBox="0 0 24 16" class="sel-icon"><polyline points="2,12 6,5 10,13 14,3 18,11 22,6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  noise: `<svg viewBox="0 0 24 16" class="sel-icon"><polyline points="2,8 5,3 8,13 11,5 14,11 17,4 20,12 22,7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
  audioIn: `<svg viewBox="0 0 24 16" class="sel-icon"><circle cx="6" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/><line x1="9" y1="8" x2="19" y2="8" stroke="currentColor" stroke-width="2"/><polyline points="16,5 21,8 16,11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  sh: `<svg viewBox="0 0 24 16" class="sel-icon"><polyline points="2,10 6,10 6,4 12,4 12,12 18,12 18,6 22,6" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>`,
};

export const FILTER_ICONS = {
  lpf24: `<svg viewBox="0 0 24 16" class="sel-icon"><path d="M2,4 L9,4 C14,4 18,8 22,14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  lpf12: `<svg viewBox="0 0 24 16" class="sel-icon"><path d="M2,4 L11,4 L22,13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  bpf12: `<svg viewBox="0 0 24 16" class="sel-icon"><path d="M2,14 L12,3 L22,14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  hpf12: `<svg viewBox="0 0 24 16" class="sel-icon"><path d="M2,13 L13,4 L22,4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
};

export const CONTROL_ICONS = {
  loop: `<svg viewBox="0 0 18 12" width="11" height="8" class="sel-icon" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.6 3C2.6 3 1.2 4.3 1.2 6s1.4 3 3.4 3c1.8 0 3.1-1.3 4.4-3 1.3-1.7 2.6-3 4.4-3 2 0 3.4 1.3 3.4 3s-1.4 3-3.4 3c-1.8 0-3.1-1.3-4.4-3C7.7 4.3 6.4 3 4.6 3z"/></svg>`,
  repeat: `<svg viewBox="0 0 18 12" width="11" height="8" class="sel-icon" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.5 1.5l2.5 2.5-2.5 2.5"/><path d="M2.5 6V5a1 1 0 0 1 1-1h11.5"/><path d="M5.5 10.5L3 8l2.5-2.5"/><path d="M15.5 6v1a1 1 0 0 1-1 1H3"/></svg>`,
  midiDin: `<svg viewBox="0 0 24 24" width="14" height="14" class="sel-icon" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M10 3.3a2 2 0 0 0 4 0"/><circle cx="7.5" cy="13.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="16.5" cy="13.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="9" cy="10" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="8.5" r="1.1" fill="currentColor" stroke="none"/></svg>`,
  target: `<svg viewBox="0 0 24 24" width="14" height="14" class="sel-icon" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><line x1="12" y1="1" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="23"/><line x1="1" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="23" y2="12"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" width="14" height="14" class="sel-icon" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" width="14" height="14" class="sel-icon" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`,
  invert: `<svg viewBox="0 0 24 24" width="14" height="14" class="sel-icon" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="17 2 21 6 17 10"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 22 3 18 7 14"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`,
  upload: `<svg viewBox="0 0 24 24" width="14" height="14" class="sel-icon" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
  download: `<svg viewBox="0 0 24 24" width="14" height="14" class="sel-icon" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
  close: `<svg viewBox="0 0 24 24" width="14" height="14" class="sel-icon" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  search: `<svg viewBox="0 0 24 24" width="14" height="14" class="sel-icon" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
  sliders: `<svg viewBox="0 0 24 24" width="14" height="14" class="sel-icon" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" width="12" height="12" class="sel-icon" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>`,
  ai: `<svg viewBox="0 0 24 24" width="14" height="14" class="sel-icon" fill="currentColor" aria-hidden="true"><path d="M12 2C12 8 8 12 2 12C8 12 12 16 12 22C12 16 16 12 22 12C16 12 12 8 12 2Z"/></svg>`,
  sparkle: `<svg viewBox="0 0 24 24" width="14" height="14" class="sel-icon" fill="currentColor" aria-hidden="true"><path d="M12 2C12 8 8 12 2 12C8 12 12 16 12 22C12 16 16 12 22 12C16 12 12 8 12 2Z"/></svg>`,
  zap: `<svg viewBox="0 0 24 24" width="14" height="14" class="sel-icon" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
};
