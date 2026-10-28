// ─────────────────────────────────────────────────────────
// Ambient declarations for the untyped @abdsynths/shared JS components.
// P2.2: structural types derived from actual usage in this repo
// (Navbar.createSynthNavBar, SpectralView.SpectrumPlotter) — no `any`.
// Fields stay optional/permissive because the JS source is untyped;
// tighten here only when a new call-site needs it.
// ─────────────────────────────────────────────────────────
declare module '@abdsynths/shared/components' {
  export interface SynthNavBarMenuItem {
    id?: number | string;
    label?: string;
    action?: string;
    shortcut?: string;
    separator?: boolean;
    checked?: boolean;
    disabled?: boolean;
    items?: SynthNavBarMenuItem[];
  }

  export interface SynthNavBarMenu {
    name: string;
    items: SynthNavBarMenuItem[];
  }

  export interface SynthNavBarBrand {
    title?: string;
    subtitle?: string;
    logoHtml?: string;
  }

  export interface SynthNavBarAbout {
    appName?: string;
    subtitle?: string;
    version?: string;
    buildInfo?: string;
    author?: string;
    copyright?: string;
  }

  export interface SynthNavBarConfig {
    container?: HTMLElement | null;
    brand?: SynthNavBarBrand;
    menus?: SynthNavBarMenu[];
    centerSlot?: HTMLElement | null;
    rightSlot?: HTMLElement | null;
    enableGlobalShortcuts?: boolean;
    activeValues?: Record<string, unknown> | ((action: string) => unknown);
    aboutDialog?: SynthNavBarAbout;
    onAction?: (action: string, value?: unknown) => void;
  }

  export interface SynthNavBarInstance {
    setActiveValues: (vals: Record<string, unknown> | ((action: string) => unknown)) => void;
    destroy?: () => void;
  }

  export function createSynthNavBar(config: SynthNavBarConfig): SynthNavBarInstance;

  export interface AboutDialogConfig {
    appName?: string;
    subtitle?: string;
    version?: string;
    buildInfo?: string;
    author?: string;
    copyright?: string;
    container?: HTMLElement | null;
  }

  export interface AboutDialogInstance {
    open?: () => void;
    close?: () => void;
    destroy?: () => void;
  }

  export function createAboutDialog(config?: AboutDialogConfig): AboutDialogInstance;

  export interface DrawerOptions {
    container?: HTMLElement | null;
    title?: string;
    [option: string]: unknown;
  }

  export interface DrawerInstance {
    open?: () => void;
    close?: () => void;
    toggle?: () => void;
    destroy?: () => void;
  }

  export function createDrawer(options?: DrawerOptions): DrawerInstance;

  export function computeFit(p?: Record<string, unknown>): unknown;
  export function mountFitStage(el?: HTMLElement | null, p?: Record<string, unknown>): unknown;

  // Generic control components (not instantiated in this repo; kept as
  // opaque handles so the module surface stays complete without `any`).
  export type SharedControl = Record<string, unknown>;
  export const SynthNavBar: SharedControl;
  export const DEFAULT_NAVBAR_MENUS: SharedControl;
  export const AboutDialog: SharedControl;
  export const Knob: SharedControl;
  export const Slider: SharedControl;
  export const Select: SharedControl;
  export const Segmented: SharedControl;
  export const Toggle: SharedControl;
  export const Switch: SharedControl;
  export const Wheel: SharedControl;
  export const XYPad: SharedControl;
  export const ThemeSwitcher: SharedControl;

  export interface SpectrumPlotterOptions {
    width?: number;
    height?: number;
    minDb?: number;
    maxDb?: number;
    gridColor?: string;
    textColor?: string;
    [option: string]: unknown;
  }

  export class SpectrumPlotter {
    constructor(container: HTMLElement | string, options?: SpectrumPlotterOptions);
    render(traces: { target?: number[]; model?: number[]; residual?: number[] }): void;
    destroy(): void;
  }
  export class VuMeter {
    constructor(container: HTMLElement | string, options?: Record<string, unknown>);
    setLevels(levels: number[] | { inDbfs?: number; outDbfs?: number }): void;
    destroy(): void;
  }
}

declare module '@abdsynths/shared/styles' {
  const styles: unknown;
  export default styles;
}
