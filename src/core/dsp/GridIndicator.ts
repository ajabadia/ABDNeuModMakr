// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — SpectralModel, GridIndicator & LayerView
// (TypeScript Port of C++ SpectralModel.h, GridIndicator.h, LayerView.h)
// ─────────────────────────────────────────────────────────

export const SPECTRAL_MODEL_CONSTANTS = {
  kMaxPartials: 64,
  kMaxFrames: 16,
  kMaxLayers: 3,
  residualGreenCents: 15.0,
  residualAmberCents: 40.0,
} as const;

export type GridResidualBand = 'no-data' | 'green' | 'amber' | 'orange';

export interface OctaveFoldVerdict {
  /** Post-fold dispersion in cents (max |deviation| folded to (-600, +600]). -1 = no data */
  foldCents: number;
  /** Raw dispersion in cents (unfolded) */
  rawCents: number;
  /** Active windows supporting the measurement */
  observations: number;
  /** Windows whose raw deviation exceeds half an octave */
  octaveFlips: number;
  /** True if post-fold dispersion > kOctaveFoldCents (100 cents) */
  biGrid: boolean;
}

export interface ExtraLayerFrames {
  amplitudes: Float32Array[];        // length kMaxFrames, each Float32Array(64)
  frequencyOffsets: Float32Array[];  // length kMaxFrames, each Float32Array(64)
  f0: Float32Array;                  // length kMaxFrames
  frameCount: number;
}

/**
 * Pure TypeScript representation of `NEURONiK::Common::SpectralModel`.
 */
export class SpectralModelData {
  public readonly amplitudes: Float32Array = new Float32Array(64);
  public readonly frequencyOffsets: Float32Array = new Float32Array(64);
  public readonly extraAmps: Float32Array[] = Array.from(
    { length: SPECTRAL_MODEL_CONSTANTS.kMaxFrames - 1 },
    () => new Float32Array(64)
  );
  public readonly extraOffsets: Float32Array[] = Array.from(
    { length: SPECTRAL_MODEL_CONSTANTS.kMaxFrames - 1 },
    () => new Float32Array(64)
  );

  public frameCount = 1;
  public frameSpanHz = 0.0;
  public readonly extraF0: Float32Array = new Float32Array(
    SPECTRAL_MODEL_CONSTANTS.kMaxFrames - 1
  );
  public frameF0 = 0.0;
  public gridFixed = false;
  public offsetsTranspose = false;
  public offsetRootHz = 0.0;
  public isValid = false;

  public readonly extraLayers: ExtraLayerFrames[] = Array.from(
    { length: SPECTRAL_MODEL_CONSTANTS.kMaxLayers - 1 },
    () => ({
      amplitudes: Array.from(
        { length: SPECTRAL_MODEL_CONSTANTS.kMaxFrames },
        () => new Float32Array(64)
      ),
      frequencyOffsets: Array.from(
        { length: SPECTRAL_MODEL_CONSTANTS.kMaxFrames },
        () => new Float32Array(64)
      ),
      f0: new Float32Array(SPECTRAL_MODEL_CONSTANTS.kMaxFrames),
      frameCount: 1,
    })
  );

  public layerCount = 1;
  public readonly layerWeights: Float32Array = new Float32Array([1.0, 1.0, 1.0]);
  public readonly layerFrameWeights: Float32Array[] = Array.from(
    { length: SPECTRAL_MODEL_CONSTANTS.kMaxLayers },
    () => new Float32Array(SPECTRAL_MODEL_CONSTANTS.kMaxFrames).fill(1.0)
  );
  public readonly layerNames: string[] = ['', '', ''];

  public isLayered(): boolean {
    return this.layerCount > 1;
  }

  public setLayerCount(layers: number): void {
    this.layerCount = Math.max(1, Math.min(SPECTRAL_MODEL_CONSTANTS.kMaxLayers, layers));
  }

  public numFramesOf(layer: number): number {
    if (layer <= 0) return this.frameCount;
    const idx = Math.max(1, Math.min(SPECTRAL_MODEL_CONSTANTS.kMaxLayers - 1, layer)) - 1;
    return this.extraLayers[idx].frameCount;
  }

  public setNumFramesOf(layer: number, frames: number): void {
    const count = Math.max(1, Math.min(SPECTRAL_MODEL_CONSTANTS.kMaxFrames, frames));
    if (layer <= 0) {
      this.frameCount = count;
      return;
    }
    const idx = Math.max(1, Math.min(SPECTRAL_MODEL_CONSTANTS.kMaxLayers - 1, layer)) - 1;
    this.extraLayers[idx].frameCount = count;
  }

  public ampsOf(frame: number): Float32Array {
    return frame <= 0 ? this.amplitudes : this.extraAmps[frame - 1];
  }

  public offsetsOf(frame: number): Float32Array {
    return frame <= 0 ? this.frequencyOffsets : this.extraOffsets[frame - 1];
  }

  public ampsOfLayer(layer: number, frame: number): Float32Array {
    const l = Math.max(0, Math.min(SPECTRAL_MODEL_CONSTANTS.kMaxLayers - 1, layer));
    const f = Math.max(0, Math.min(SPECTRAL_MODEL_CONSTANTS.kMaxFrames - 1, frame));
    return l === 0 ? this.ampsOf(f) : this.extraLayers[l - 1].amplitudes[f];
  }

  public offsetsOfLayer(layer: number, frame: number): Float32Array {
    const l = Math.max(0, Math.min(SPECTRAL_MODEL_CONSTANTS.kMaxLayers - 1, layer));
    const f = Math.max(0, Math.min(SPECTRAL_MODEL_CONSTANTS.kMaxFrames - 1, frame));
    return l === 0 ? this.offsetsOf(f) : this.extraLayers[l - 1].frequencyOffsets[f];
  }

  public ampAt(layer: number, frame: number, partial: number): number {
    return this.ampsOfLayer(layer, frame)[partial] ?? 0;
  }

  public offsetAt(layer: number, frame: number, partial: number): number {
    return this.offsetsOfLayer(layer, frame)[partial] ?? 0;
  }

  public f0At(frame: number): number {
    return frame <= 0 ? this.frameSpanHz : this.extraF0[frame - 1];
  }

  public setF0At(frame: number, f0Hz: number): void {
    if (frame >= 1 && frame < SPECTRAL_MODEL_CONSTANTS.kMaxFrames) {
      this.extraF0[frame - 1] = f0Hz;
    }
  }

  public f0AtLayer(layer: number, frame: number): number {
    const l = Math.max(0, Math.min(SPECTRAL_MODEL_CONSTANTS.kMaxLayers - 1, layer));
    const f = Math.max(0, Math.min(SPECTRAL_MODEL_CONSTANTS.kMaxFrames - 1, frame));
    return l === 0 ? this.f0At(f) : this.extraLayers[l - 1].f0[f];
  }

  public setF0AtLayer(layer: number, frame: number, f0Hz: number): void {
    const l = Math.max(0, Math.min(SPECTRAL_MODEL_CONSTANTS.kMaxLayers - 1, layer));
    const f = Math.max(0, Math.min(SPECTRAL_MODEL_CONSTANTS.kMaxFrames - 1, frame));
    if (l === 0) {
      this.setF0At(f, f0Hz);
      return;
    }
    this.extraLayers[l - 1].f0[f] = f0Hz;
  }

  public frameWeightAt(layer: number, frame: number): number {
    const l = Math.max(0, Math.min(SPECTRAL_MODEL_CONSTANTS.kMaxLayers - 1, layer));
    const f = Math.max(0, Math.min(SPECTRAL_MODEL_CONSTANTS.kMaxFrames - 1, frame));
    return this.layerFrameWeights[l][f];
  }

  public setFrameWeightAt(layer: number, frame: number, weight: number): void {
    const l = Math.max(0, Math.min(SPECTRAL_MODEL_CONSTANTS.kMaxLayers - 1, layer));
    const f = Math.max(0, Math.min(SPECTRAL_MODEL_CONSTANTS.kMaxFrames - 1, frame));
    this.layerFrameWeights[l][f] = Math.max(0.0, Math.min(1.0, weight));
  }

  public layerWeightAt(layer: number): number {
    const l = Math.max(0, Math.min(SPECTRAL_MODEL_CONSTANTS.kMaxLayers - 1, layer));
    return this.layerWeights[l];
  }

  public setLayerWeightAt(layer: number, weight: number): void {
    const l = Math.max(0, Math.min(SPECTRAL_MODEL_CONSTANTS.kMaxLayers - 1, layer));
    this.layerWeights[l] = Math.max(0.0, Math.min(1.0, weight));
  }

  public layerNameAt(layer: number): string {
    const l = Math.max(0, Math.min(SPECTRAL_MODEL_CONSTANTS.kMaxLayers - 1, layer));
    return this.layerNames[l];
  }

  public setLayerNameAt(layer: number, name: string): void {
    const l = Math.max(0, Math.min(SPECTRAL_MODEL_CONSTANTS.kMaxLayers - 1, layer));
    this.layerNames[l] = name;
  }

  public offsetScaleAt(baseHz: number): number {
    if (!this.offsetsTranspose) return 1.0;
    const root = this.offsetRootHz > 0.0 ? this.offsetRootHz : this.frameSpanHz;
    return root > 0.0 ? baseHz / root : 1.0;
  }
}

export interface GridIndicatorInput {
  detectedHz: number;
  residualCents: number;
  observations: number;
  fixedGrid?: boolean;
  offsetsTranspose?: boolean;
  belowEstimatorFloor?: boolean;
}

export interface GridIndicatorState {
  band: GridResidualBand;
  argb: number;
  text: string;
  clickLoadsHz: number;
  clickEditorText: string;
}

/**
 * Evaluates the GridIndicator state (matching `GridIndicatorModel` in C++).
 */
export function evaluateGridIndicator(input: GridIndicatorInput): GridIndicatorState {
  let band: GridResidualBand = 'no-data';
  if (input.residualCents >= 0.0) {
    if (input.residualCents <= SPECTRAL_MODEL_CONSTANTS.residualGreenCents) {
      band = 'green';
    } else if (input.residualCents <= SPECTRAL_MODEL_CONSTANTS.residualAmberCents) {
      band = 'amber';
    } else {
      band = 'orange';
    }
  }

  const argb =
    band === 'green'
      ? 0xff2ecc71
      : band === 'amber'
        ? 0xffffff00
        : band === 'orange'
          ? 0xffffa500
          : 0xff808080;

  let text = '';
  if (input.detectedHz > 0.0) {
    text = `Rejilla: f0 ${input.detectedHz.toFixed(2)} Hz`;
    if (input.residualCents >= 0.0) {
      text += `  |  residuo ${input.residualCents.toFixed(1)} cents  |  ${input.observations} picos`;
    } else {
      text += '  |  residuo n/d (material insuficiente)';
    }

    if (input.fixedGrid) {
      text += '  |  REJILLA FIJA (sin seguimiento de pitch por ventana)';
    }
    if (input.offsetsTranspose) {
      text += '  |  OFFSETS TRANSPONIBLES (la inharmonicidad sigue al teclado)';
    } else if (input.belowEstimatorFloor) {
      text += '  |  fijada a mano (el estimador no llega hasta aqui)';
    }
  }

  const clickLoadsHz = input.detectedHz > 0.0 ? input.detectedHz : 0.0;
  const clickEditorText = clickLoadsHz > 0.0 ? clickLoadsHz.toFixed(2) : '';

  return {
    band,
    argb,
    text,
    clickLoadsHz,
    clickEditorText,
  };
}

export interface LayerViewLayerInfo {
  name: string;
  weight: number;
  frames: number;
  partials: number;
}

export interface LayerViewData {
  layerCount: number;
  frameCount: number;
  activePartials: number;
  highestPartial: number;
  layerOfPartial: Int32Array;
  peakOfPartial: Float32Array;
  envelope: Float32Array[];
  layers: LayerViewLayerInfo[];
  fold: {
    measured: boolean;
    biGrid: boolean;
    foldCents: number;
    rawCents: number;
    observations: number;
    octaveFlips: number;
  };
}

/**
 * Builds the LayerView representation of a `SpectralModelData` (matching `buildLayerView` in `LayerView.h`).
 */
export function buildLayerView(
  model: SpectralModelData,
  fold?: OctaveFoldVerdict
): LayerViewData {
  const kActivityFloor = 1.0e-6;
  const layerCount = Math.max(1, Math.min(SPECTRAL_MODEL_CONSTANTS.kMaxLayers, model.layerCount));
  const frameCount = Math.max(1, Math.min(SPECTRAL_MODEL_CONSTANTS.kMaxFrames, model.frameCount));

  const layers: LayerViewLayerInfo[] = Array.from(
    { length: SPECTRAL_MODEL_CONSTANTS.kMaxLayers },
    (_, l) => ({
      name: l < layerCount ? model.layerNameAt(l) : '',
      weight: l < layerCount ? model.layerWeightAt(l) : 1.0,
      frames: l < layerCount
        ? Math.max(1, Math.min(SPECTRAL_MODEL_CONSTANTS.kMaxFrames, model.numFramesOf(l)))
        : 1,
      partials: 0,
    })
  );

  const layerOfPartial = new Int32Array(64).fill(-1);
  const peakOfPartial = new Float32Array(64);
  const envelope = Array.from(
    { length: 64 },
    () => new Float32Array(SPECTRAL_MODEL_CONSTANTS.kMaxFrames)
  );

  let activePartials = 0;
  let highestPartial = 0;
  let globalPeak = 0.0;

  for (let i = 0; i < 64; i++) {
    let assignedLayer = -1;
    for (let l = 0; l < layerCount; l++) {
      const frames = layers[l].frames;
      let layerPeak = 0.0;
      for (let f = 0; f < frames; f++) {
        layerPeak = Math.max(layerPeak, Math.abs(model.ampAt(l, f, i)));
      }
      if (layerPeak > kActivityFloor) {
        assignedLayer = l;
        break;
      }
    }

    layerOfPartial[i] = assignedLayer;
    if (assignedLayer < 0) continue;

    const frames = layers[assignedLayer].frames;
    let peak = 0.0;
    for (let f = 0; f < frames; f++) {
      peak = Math.max(peak, Math.abs(model.ampAt(assignedLayer, f, i)));
    }
    for (let f = 0; f < frames; f++) {
      envelope[i][f] = peak > 0 ? Math.abs(model.ampAt(assignedLayer, f, i)) / peak : 0.0;
    }

    peakOfPartial[i] = peak;
    globalPeak = Math.max(globalPeak, peak);
    activePartials++;
    layers[assignedLayer].partials++;
    highestPartial = i + 1;
  }

  if (globalPeak > 0.0) {
    for (let i = 0; i < 64; i++) {
      peakOfPartial[i] /= globalPeak;
    }
  }

  return {
    layerCount,
    frameCount,
    activePartials,
    highestPartial,
    layerOfPartial,
    peakOfPartial,
    envelope,
    layers,
    fold: {
      measured: (fold?.observations ?? 0) > 0,
      biGrid: fold?.biGrid ?? false,
      foldCents: fold?.foldCents ?? -1.0,
      rawCents: fold?.rawCents ?? 0.0,
      observations: fold?.observations ?? 0,
      octaveFlips: fold?.octaveFlips ?? 0,
    },
  };
}
