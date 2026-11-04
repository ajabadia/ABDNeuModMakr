/**
 * ABDSharedAssets — SVG icon library for synth UI.
 *
 * Canonical icon set shared across all ABDSynths plugins.
 * Usage: import { WAVE_ICONS, FILTER_ICONS } from '@abdsynths/shared/components';
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


export const FLAG_ICONS = {
  es: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 16" width="22" height="15" class="sel-icon flag-icon" aria-hidden="true" focusable="false"><rect width="24" height="16" fill="#c60b1e"/><rect y="4" width="24" height="8" fill="#ffc400"/></svg>`,
  en: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 16" width="22" height="15" class="sel-icon flag-icon" aria-hidden="true" focusable="false"><rect width="24" height="16" fill="#012169"/><path d="M0 0l24 16M24 0L0 16" stroke="#fff" stroke-width="3.4"/><path d="M0 0l24 16M24 0L0 16" stroke="#c8102e" stroke-width="1.7"/><path d="M12 0v16M0 8h24" stroke="#fff" stroke-width="5.4"/><path d="M12 0v16M0 8h24" stroke="#c8102e" stroke-width="3.2"/></svg>`,
};
