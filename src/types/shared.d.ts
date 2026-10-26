declare module '@abdsynths/shared/components' {
  export const SynthNavBar: any;
  export function createSynthNavBar(config: any): any;
  export const DEFAULT_NAVBAR_MENUS: any;
  export const AboutDialog: any;
  export function createAboutDialog(config: any): any;
  export const Knob: any;
  export const Slider: any;
  export const Select: any;
  export const Segmented: any;
  export const Toggle: any;
  export const Switch: any;
  export const Wheel: any;
  export const XYPad: any;
  export const ThemeSwitcher: any;
  export function createDrawer(options: any): any;
  export function computeFit(p: any): any;
  export function mountFitStage(el: any, p: any): any;
  export class SpectrumPlotter {
    constructor(container: HTMLElement | string, options?: Record<string, unknown>);
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
  const styles: any;
  export default styles;
}
