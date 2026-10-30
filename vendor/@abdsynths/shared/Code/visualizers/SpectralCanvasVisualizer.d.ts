export interface PartialTrack {
  freqHz: number;
  amp?: number;
  label?: string;
  color?: string;
}

export interface SpectrogramData {
  timeBins: number;
  freqBins: number;
  matrix: Float32Array; // Flattened [timeBins * freqBins] in dB or 0..1
  sampleRate?: number;
  partialTracks?: PartialTrack[][]; // Optional track curves across time
}

export interface PartialsData {
  amps: Float32Array | number[]; // 64 harmonic amplitudes [0..1]
  fundamentalHz?: number;
  realtimeFft?: Float32Array | number[];
}

export interface WaveformCompareData {
  bufferA: Float32Array;
  bufferB?: Float32Array;
  labelA?: string;
  labelB?: string;
  colorA?: string;
  colorB?: string;
}

export interface VisualizerOptions {
  theme?: 'dark' | 'amber' | 'cyan' | 'crt' | 'viridis';
  accentColor?: string;
  accentColorB?: string;
  gridColor?: string;
  minDb?: number;
  maxDb?: number;
  showGrid?: boolean;
  showLabels?: boolean;
}

export class SpectralCanvasVisualizer {
  constructor(canvas: HTMLCanvasElement, options?: VisualizerOptions);
  
  setTheme(theme: 'dark' | 'amber' | 'cyan' | 'crt' | 'viridis'): void;
  resize(width?: number, height?: number): void;
  clear(): void;
  
  renderSpectrogram(data: SpectrogramData, options?: VisualizerOptions): void;
  renderPartials(data: PartialsData, options?: VisualizerOptions): void;
  renderWaveformCompare(data: WaveformCompareData, options?: VisualizerOptions): void;
  
  destroy(): void;
}
