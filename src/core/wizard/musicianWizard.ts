// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Fase 35.5: Musician Guided 4-Step Wizard Core
//
// Pure, zero-DOM pipeline & defaults for the 4-step musician wizard:
//   Step 1: Material (Record / Import raw audio OR import pre-mapped bank)
//   Step 2: Limpiar (Trim silence with zero-crossing snap, DC block,
//           Noise Print spectral gate, Peak normalization)
//   Step 3: Cortar y mapear ("¿batería o melodía?" with "detectar solo"
//           by default via AcousticIntelligence cat-0..9 + TakeDsp)
//   Step 4: Generar y exportar (Simplified ProcessPanel + 35.2 Destination Cards)
//
// Zero new DSP: strictly composes existing engines:
//   - `@abdsynths/shared/dsp/take/takeDsp.ts`
//   - `@abdsynths/shared/dsp/take/NoiseReductionDsp.ts`
//   - `src/core/dsp/LoopEditorTools.ts` (`snapFrameToNearestZeroCrossing`)
//   - `src/core/dsp/AudioSlicerEngine.ts` (`sliceAudioBuffer`)
//   - `src/core/dsp/AcousticIntelligence.ts` (`extractAcousticDescriptors`, `classifyAcousticSample`)
//   - `src/core/dsp/SpectralAnalyzer.ts`
//   - `src/core/dsp/WavDecoder.ts` (`encodePcm16Wav`)
// ─────────────────────────────────────────────────────────

import {
  peakAmplitude,
  rmsDbfs,
  dcBlock,
  normalizePeak,
  detectSilenceRanges,
  computeNoiseProfile,
  extractTakeFeatures,
  classifyTake,
  type NoiseProfile,
} from '@abdsynths/shared/dsp/take/takeDsp.ts';
import { reduceNoiseWithProfile } from '@abdsynths/shared/dsp/take/NoiseReductionDsp.ts';
import { snapFrameToNearestZeroCrossing } from '../dsp/LoopEditorTools.ts';
import {
  sliceAudioBuffer,
  DEFAULT_SLICER_OPTIONS,
  type DetectedSlice,
} from '../dsp/AudioSlicerEngine.ts';
import {
  extractAcousticDescriptors,
  classifyAcousticSample,
} from '../dsp/AcousticIntelligence.ts';
import { SpectralAnalyzer } from '../dsp/SpectralAnalyzer.ts';
import { encodePcm16Wav } from '../dsp/WavDecoder.ts';
import { midiToNoteName } from '../../ui/ZoneRibbon.ts';
import type { ExtendedRegion, WorkingMode, Zone } from '../types.ts';

export type MusicianWizardStep = 'material' | 'clean' | 'slice_map' | 'generate_export';

export type WizardSliceRoleChoice = 'auto' | 'drums' | 'melody' | 'single';
export type WizardResolvedRole = 'drums' | 'melody' | 'single';

export interface MusicianWizardDefaults {
  /** Recortar silencios de entrada/salida automáticamente */
  trimSilence: boolean;
  /** Ajustar todos los cortes al cruce por cero (zc-snap) */
  snapZeroCrossing: boolean;
  /** Quitar desplazamiento DC (< 20 Hz) */
  dcBlock: boolean;
  /** Aplicar puerta espectral con la huella de ruido detectada */
  applyNoisePrintDsp: boolean;
  /** Normalizar pico a -1.0 dBFS */
  normalizePeak: boolean;
  /** Nivel objetivo de normalización en dBFS */
  normalizeTargetDbfs: number;
  /** En modo Classic, preparar siempre las 2 capas de velocidad (Low + High Vel) */
  classicTwoVelocityLayers: boolean;
  /** Punto de corte de velocidad por defecto en modo Classic (1..63 / 64..127) */
  classicVelSplit: number;
  /** Extender siempre los extremos a 0..127 para no dejar teclas mudas */
  autoExtendKeybed: boolean;
  /** Pedir siempre consentimiento explícito antes de usar un fallback de IA */
  requireAiFallbackConsent: boolean;
  /** Modo de corte por defecto en el Paso 3: "detectar solo" */
  defaultRoleChoice: WizardSliceRoleChoice;
}

/**
 * Defaults de músico obligatorios en Fase 35.5:
 * - trim con zero-cross activado (`trimSilence: true`, `snapZeroCrossing: true`)
 * - 2 capas en classic (`classicTwoVelocityLayers: true`)
 * - consentimiento siempre (`requireAiFallbackConsent: true`)
 * - "¿batería o melodía?" con "detectar solo" por defecto (`defaultRoleChoice: 'auto'`)
 */
export const MUSICIAN_WIZARD_DEFAULTS: Readonly<MusicianWizardDefaults> = {
  trimSilence: true,
  snapZeroCrossing: true,
  dcBlock: true,
  applyNoisePrintDsp: true,
  normalizePeak: true,
  normalizeTargetDbfs: -1.0,
  classicTwoVelocityLayers: true,
  classicVelSplit: 64,
  autoExtendKeybed: true,
  requireAiFallbackConsent: true,
  defaultRoleChoice: 'auto',
};

export type WizardMaterialKind = 'raw_audio' | 'mapped_bank';

export interface WizardMaterialInspection {
  kind: WizardMaterialKind;
  canFastTrackToStep4: boolean;
  recommendedNextStep: MusicianWizardStep;
  reasonEs: string;
}

const RAW_AUDIO_EXT_RE = /\.(wav|aif|aiff|aifc|flac|mp3|ogg|oga|m4a|aac|opus|webm|caf|ncw)$/i;
const SLICE_LOOP_EXT_RE = /\.(rx2|rex|rcy|cue)$/i;

/**
 * Distingue si el material elegido en el Paso 1 es:
 * - Un archivo de audio continuo / grabación (`raw_audio`) -> pasa por Paso 2 (Limpiar) y Paso 3 (Cortar y mapear).
 * - Un banco ya mapeado (`.sf2`, `.sfz`, `.dspreset`, `.model`, `.nmmodel`, etc.) (`mapped_bank`) ->
 *   ya tiene zonas y notas raíz, por lo que puede saltar directamente al Paso 4 tras revisar el preflight.
 */
export function inspectWizardMaterialFilename(
  filename: string,
  fileCount = 1,
  isRecordedTake = false
): WizardMaterialInspection {
  if (isRecordedTake) {
    return {
      kind: 'raw_audio',
      canFastTrackToStep4: false,
      recommendedNextStep: 'clean',
      reasonEs: 'Grabación de audio en vivo: pasará por Limpiar (Paso 2) y Cortar y mapear (Paso 3).',
    };
  }

  const trimmed = filename.trim();
  if (fileCount === 1 && (RAW_AUDIO_EXT_RE.test(trimmed) || SLICE_LOOP_EXT_RE.test(trimmed))) {
    return {
      kind: 'raw_audio',
      canFastTrackToStep4: false,
      recommendedNextStep: 'clean',
      reasonEs: 'Muestra o grabación de audio individual: pasará por Limpiar (Paso 2) y Cortar y mapear (Paso 3).',
    };
  }

  return {
    kind: 'mapped_bank',
    canFastTrackToStep4: true,
    recommendedNextStep: 'generate_export',
    reasonEs:
      'Instrumento o banco multipista ya mapeado: sus zonas y notas raíz están definidas; puedes ir directo al Paso 4 (Generar y exportar).',
  };
}

export interface WizardCleanOptions {
  trimSilence?: boolean;
  snapZeroCrossing?: boolean;
  dcBlock?: boolean;
  applyNoisePrintDsp?: boolean;
  normalizePeak?: boolean;
  normalizeTargetDbfs?: number;
  silenceThresholdDb?: number;
}

export interface WizardCleanResult {
  cleanedPcm: Float32Array;
  sampleRate: number;
  noiseProfile: NoiseProfile;
  leadingTrimmedMs: number;
  trailingTrimmedMs: number;
  startFrameSnapped: number;
  endFrameSnapped: number;
  peakBeforeDbfs: number;
  peakAfterDbfs: number;
  rmsAfterDbfs: number;
  durationBeforeSec: number;
  durationAfterSec: number;
}

function linearToDbfs(peak: number): number {
  return peak > 1e-9 ? Number((20 * Math.log10(peak)).toFixed(1)) : -Infinity;
}

/**
 * Paso 2 — Limpiar:
 * 1. Bloqueo DC (`dcBlock`)
 * 2. Estimación de huella de ruido (`computeNoiseProfile`) sobre el tramo más silencioso o inicio
 * 3. Reducción de ruido DSP (`reduceNoiseWithProfile`) si está activa
 * 4. Recorte de silencios de entrada/salida con ajuste exacto al cruce por cero (`snapFrameToNearestZeroCrossing`)
 * 5. Normalización de pico (`normalizePeak`)
 */
export function runWizardCleanStep(
  rawPcm: Float32Array,
  sampleRate: number,
  options: WizardCleanOptions = {}
): WizardCleanResult {
  const sr = Math.max(8000, Math.round(sampleRate || 44100));
  const opts = {
    trimSilence: options.trimSilence ?? MUSICIAN_WIZARD_DEFAULTS.trimSilence,
    snapZeroCrossing: options.snapZeroCrossing ?? MUSICIAN_WIZARD_DEFAULTS.snapZeroCrossing,
    dcBlock: options.dcBlock ?? MUSICIAN_WIZARD_DEFAULTS.dcBlock,
    applyNoisePrintDsp: options.applyNoisePrintDsp ?? MUSICIAN_WIZARD_DEFAULTS.applyNoisePrintDsp,
    normalizePeak: options.normalizePeak ?? MUSICIAN_WIZARD_DEFAULTS.normalizePeak,
    normalizeTargetDbfs: options.normalizeTargetDbfs ?? MUSICIAN_WIZARD_DEFAULTS.normalizeTargetDbfs,
    silenceThresholdDb: options.silenceThresholdDb ?? -46,
  };

  const durationBeforeSec = rawPcm.length / sr;
  const peakBeforeDbfs = linearToDbfs(peakAmplitude(rawPcm));

  if (rawPcm.length === 0) {
    return {
      cleanedPcm: new Float32Array(0),
      sampleRate: sr,
      noiseProfile: { levelDbfs: -Infinity, spectrumBands: [], hum50HzDb: -Infinity, hum60HzDb: -Infinity },
      leadingTrimmedMs: 0,
      trailingTrimmedMs: 0,
      startFrameSnapped: 0,
      endFrameSnapped: 0,
      peakBeforeDbfs: -Infinity,
      peakAfterDbfs: -Infinity,
      rmsAfterDbfs: -Infinity,
      durationBeforeSec: 0,
      durationAfterSec: 0,
    };
  }

  let working: Float32Array = new Float32Array(rawPcm);

  // 1. DC Block
  if (opts.dcBlock) {
    working = dcBlock(working, sr);
  }

  // 2. Detect silence ranges and compute Noise Print from quietest segment (or first 150ms)
  const silenceRanges = detectSilenceRanges(working, sr, {
    thresholdDb: opts.silenceThresholdDb,
    minSilenceMs: 60,
    hangoverMs: 30,
  });

  let noiseSegment: Float32Array;
  if (silenceRanges.length > 0) {
    const firstRange = silenceRanges[0];
    noiseSegment = working.subarray(firstRange.startFrame, Math.max(firstRange.startFrame + 64, firstRange.endFrame));
  } else {
    const headFrames = Math.min(working.length, Math.max(64, Math.round(sr * 0.12)));
    noiseSegment = working.subarray(0, headFrames);
  }
  const noiseProfile = computeNoiseProfile(noiseSegment, sr);

  // 3. Apply spectral noise reduction if requested and noise floor is measurable
  if (opts.applyNoisePrintDsp && Number.isFinite(noiseProfile.levelDbfs) && noiseProfile.levelDbfs > -85) {
    working = reduceNoiseWithProfile(working, sr, noiseProfile, {
      reductionDb: 10,
      removeHum: true,
    });
  }

  // 4. Trim leading & trailing silence with Zero-Crossing Snap (zc-snap)
  let startFrame = 0;
  let endFrame = working.length;

  if (opts.trimSilence && working.length > 64) {
    const postRanges = detectSilenceRanges(working, sr, {
      thresholdDb: opts.silenceThresholdDb,
      minSilenceMs: 60,
      hangoverMs: 30,
    });
    for (const r of postRanges) {
      if (r.startFrame === 0) {
        startFrame = Math.max(startFrame, r.endFrame);
      }
      if (r.endFrame >= working.length) {
        endFrame = Math.min(endFrame, r.startFrame);
      }
    }
    if (endFrame <= startFrame + 64) {
      // Safeguard: never erase the entire signal if everything was quiet
      startFrame = 0;
      endFrame = working.length;
    } else if (opts.snapZeroCrossing) {
      startFrame = snapFrameToNearestZeroCrossing(working, startFrame, 256);
      endFrame = snapFrameToNearestZeroCrossing(working, endFrame, 256);
      if (endFrame <= startFrame) {
        startFrame = 0;
        endFrame = working.length;
      }
    }
  } else if (opts.snapZeroCrossing && working.length > 64) {
    startFrame = snapFrameToNearestZeroCrossing(working, 0, 128);
    endFrame = snapFrameToNearestZeroCrossing(working, working.length - 1, 128);
    if (endFrame <= startFrame) {
      startFrame = 0;
      endFrame = working.length;
    }
  }

  const leadingTrimmedMs = Number(((startFrame / sr) * 1000).toFixed(1));
  const trailingTrimmedMs = Number((((working.length - endFrame) / sr) * 1000).toFixed(1));
  working = working.slice(startFrame, endFrame);

  // 5. Peak Normalization
  if (opts.normalizePeak && working.length > 0) {
    working = normalizePeak(working, opts.normalizeTargetDbfs);
  }

  const peakAfterDbfs = linearToDbfs(peakAmplitude(working));
  const rmsAfter = rmsDbfs(working);

  return {
    cleanedPcm: working,
    sampleRate: sr,
    noiseProfile,
    leadingTrimmedMs,
    trailingTrimmedMs,
    startFrameSnapped: startFrame,
    endFrameSnapped: endFrame,
    peakBeforeDbfs,
    peakAfterDbfs,
    rmsAfterDbfs: Number.isFinite(rmsAfter) ? Number(rmsAfter.toFixed(1)) : -Infinity,
    durationBeforeSec: Number(durationBeforeSec.toFixed(2)),
    durationAfterSec: Number((working.length / sr).toFixed(2)),
  };
}

export interface WizardSliceAndMapOptions {
  /** 'auto' ("Detectar solo" por defecto), 'drums', 'melody', o 'single' */
  roleChoice?: WizardSliceRoleChoice;
  /** Sensibilidad de transitorios 1..100 (por defecto 70) */
  sensitivity?: number;
  /** Ajustar cortes al cruce por cero (por defecto true) */
  snapZeroCrossing?: boolean;
  /** En modo Classic, configurar siempre las 2 capas de velocidad (Low + High Vel) (por defecto true) */
  classicTwoVelocityLayers?: boolean;
  /** Punto de división de velocidad en Classic (por defecto 64) */
  classicVelSplit?: number;
  /** Extender zonas extremas para cubrir 0..127 (por defecto true) */
  autoExtendKeybed?: boolean;
  /** Nombre base de la muestra */
  sourceName?: string;
}

export interface WizardSliceAndMapResult {
  roleChoice: WizardSliceRoleChoice;
  resolvedRole: WizardResolvedRole;
  roleLabelEs: string;
  roleExplanationEs: string;
  detectedCategory: string;
  suggestedParameterSet: number;
  classificationConfidence: number;
  classificationRationale: string;
  detectedRootKey: number;
  detectedF0Hz: number;
  sliceCount: number;
  classicZones: Zone[];
  extendedRegions: ExtendedRegion[];
  audioBuffers: Map<string, ArrayBuffer>;
  slices: DetectedSlice[];
}

const sharedSpectralAnalyzer = new SpectralAnalyzer();

/**
 * Paso 3 — Cortar y mapear:
 * - Si `roleChoice === 'auto'` ("Detectar solo"):
 *   combina `extractTakeFeatures` + `classifyTake` con `extractAcousticDescriptors` + `classifyAcousticSample` (cat 0..9)
 *   y el conteo de transitorios reales para decidir entre:
 *     1. `'drums'` (Batería / Percusión -> mapa GM Drum / kits percusivos, Parameter Set 8)
 *     2. `'melody'` (Frase melódica de varias notas -> corte cromático con zc-snap y cobertura 0..127)
 *     3. `'single'` (Nota única / Instrumento sostenido -> 1 zona limpia extendida 0..127 con nota raíz F0 detectada)
 * - Aplica los defaults de músico:
 *   - `snapZeroCrossing: true`
 *   - `classicTwoVelocityLayers: true` (en Classic genera las 2 capas `1..63` y `64..127` suaves/fuertes listas para NASAnalysis)
 *   - Cobertura completa `0..127` sin huecos.
 */
export function runWizardSliceAndMapStep(
  pcm: Float32Array,
  sampleRate: number,
  options: WizardSliceAndMapOptions = {}
): WizardSliceAndMapResult {
  const sr = Math.max(8000, Math.round(sampleRate || 44100));
  const roleChoice = options.roleChoice ?? MUSICIAN_WIZARD_DEFAULTS.defaultRoleChoice;
  const sensitivity = options.sensitivity ?? 70;
  const snapZeroCrossing = options.snapZeroCrossing ?? MUSICIAN_WIZARD_DEFAULTS.snapZeroCrossing;
  const classicTwoVelocityLayers =
    options.classicTwoVelocityLayers ?? MUSICIAN_WIZARD_DEFAULTS.classicTwoVelocityLayers;
  const velSplit = Math.max(2, Math.min(127, options.classicVelSplit ?? MUSICIAN_WIZARD_DEFAULTS.classicVelSplit));
  const autoExtendKeybed = options.autoExtendKeybed ?? MUSICIAN_WIZARD_DEFAULTS.autoExtendKeybed;
  const baseName =
    (options.sourceName || 'wizard_take')
      .replace(/\.[^/.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .slice(0, 24) || 'wizard_take';

  // 1. Run AcousticIntelligence (cat 0..9) & TakeDsp feature classifier
  const descriptors = extractAcousticDescriptors(pcm, sr, sharedSpectralAnalyzer);
  const acousticClass = classifyAcousticSample(descriptors, options.sourceName || '');
  const takeFeatures = extractTakeFeatures(pcm, sr);
  const takeClass = classifyTake(takeFeatures);

  // Probe transient slicing to see how many musical events exist
  const probeChromatic = sliceAudioBuffer(pcm, sr, {
    ...DEFAULT_SLICER_OPTIONS,
    mode: 'chromatic',
    sensitivity,
    snapZeroCrossing,
  });
  const activeProbeSlices = probeChromatic.slices.filter((s) => !s.isSilence);

  // 2. Resolve Role ('drums' | 'melody' | 'single')
  let resolvedRole: WizardResolvedRole;
  if (roleChoice !== 'auto') {
    resolvedRole = roleChoice;
  } else {
    const isPercussiveCat =
      acousticClass.recommendedParameterSet === 8 ||
      acousticClass.detectedCategory === 'Drums & Perc' ||
      takeClass.kind === 'drums' ||
      descriptors.isPercussiveOrNoise;

    if (isPercussiveCat && activeProbeSlices.length >= 2) {
      resolvedRole = 'drums';
    } else if (activeProbeSlices.length <= 1 || (descriptors.sustainRatio >= 0.48 && descriptors.transientDensityHz < 1.8)) {
      resolvedRole = 'single';
    } else {
      resolvedRole = 'melody';
    }
  }

  const audioBuffers = new Map<string, ArrayBuffer>();
  const classicZones: Zone[] = [];
  const extendedRegions: ExtendedRegion[] = [];
  let finalSlices: DetectedSlice[] = [];

  if (resolvedRole === 'single') {
    // 1 single sustained instrument zone across 0..127 with detected rootKey
    const rootKey = Math.max(0, Math.min(127, descriptors.detectedMidiNote || 60));
    const lowKey = autoExtendKeybed ? 0 : rootKey;
    const highKey = autoExtendKeybed ? 127 : rootKey;

    let slicePcm = pcm;
    if (snapZeroCrossing && pcm.length > 64) {
      const s0 = snapFrameToNearestZeroCrossing(pcm, 0, 128);
      const s1 = snapFrameToNearestZeroCrossing(pcm, pcm.length - 1, 128);
      if (s1 > s0 + 32) {
        slicePcm = pcm.subarray(s0, s1);
      }
    }

    const highSampleName = `${baseName}_root${rootKey}_hi.wav`;
    const lowSampleName = `${baseName}_root${rootKey}_lo.wav`;

    const highWav = encodePcm16Wav(slicePcm, sr, { rootKey, lowKey, highKey });
    audioBuffers.set(highSampleName, highWav);

    if (classicTwoVelocityLayers) {
      // Soft velocity layer (-4.5 dB gentle dynamic shading for 2-layer Classic default)
      const softPcm = new Float32Array(slicePcm.length);
      const softGain = 0.6;
      for (let i = 0; i < slicePcm.length; i++) {
        softPcm[i] = slicePcm[i] * softGain;
      }
      const lowWav = encodePcm16Wav(softPcm, sr, { rootKey, lowKey, highKey });
      audioBuffers.set(lowSampleName, lowWav);
    }

    classicZones.push({
      id: 'zone_wiz_001',
      lowKey,
      rootKey,
      highKey,
      sampleLow: classicTwoVelocityLayers ? lowSampleName : highSampleName,
      sampleHigh: classicTwoVelocityLayers ? highSampleName : null,
      velSplit,
      detune: descriptors.detectedCentOffset || 0,
      volume: 0,
      pan: 0,
    });

    if (classicTwoVelocityLayers) {
      extendedRegions.push(
        {
          id: 'reg_wiz_001_lo',
          sampleName: lowSampleName,
          lowKey,
          rootKey,
          highKey,
          lowVel: 1,
          highVel: velSplit - 1,
          detune: descriptors.detectedCentOffset || 0,
          volume: 0,
          pan: 0,
          pitchKeytrack: 100,
          trigger: 'attack',
          keyFadeIn: 0,
          keyFadeOut: 0,
          velFadeIn: 0,
          velFadeOut: 0,
          fadeCurve: 'equal-power',
          loopMode: 'no_loop',
          loopStart: 0,
          loopEnd: slicePcm.length,
          loopCrossfadeMs: 0,
          sampleRate: sr,
          numChannels: 1,
        },
        {
          id: 'reg_wiz_001_hi',
          sampleName: highSampleName,
          lowKey,
          rootKey,
          highKey,
          lowVel: velSplit,
          highVel: 127,
          detune: descriptors.detectedCentOffset || 0,
          volume: 0,
          pan: 0,
          pitchKeytrack: 100,
          trigger: 'attack',
          keyFadeIn: 0,
          keyFadeOut: 0,
          velFadeIn: 0,
          velFadeOut: 0,
          fadeCurve: 'equal-power',
          loopMode: 'no_loop',
          loopStart: 0,
          loopEnd: slicePcm.length,
          loopCrossfadeMs: 0,
          sampleRate: sr,
          numChannels: 1,
        }
      );
    } else {
      extendedRegions.push({
        id: 'reg_wiz_001',
        sampleName: highSampleName,
        lowKey,
        rootKey,
        highKey,
        lowVel: 1,
        highVel: 127,
        detune: descriptors.detectedCentOffset || 0,
        volume: 0,
        pan: 0,
        pitchKeytrack: 100,
        trigger: 'attack',
        keyFadeIn: 0,
        keyFadeOut: 0,
        velFadeIn: 0,
        velFadeOut: 0,
        fadeCurve: 'equal-power',
        loopMode: 'no_loop',
        loopStart: 0,
        loopEnd: slicePcm.length,
        loopCrossfadeMs: 0,
        sampleRate: sr,
        numChannels: 1,
      });
    }

    finalSlices = [
      {
        id: 'slice_1',
        index: 1,
        startFrame: 0,
        endFrame: slicePcm.length,
        startSec: 0,
        endSec: slicePcm.length / sr,
        durationSec: slicePcm.length / sr,
        rmsDb: rmsDbfs(slicePcm),
        peakDb: linearToDbfs(peakAmplitude(slicePcm)),
        isSilence: false,
        f0Hz: descriptors.detectedF0Hz,
        rootKey,
        lowKey,
        highKey,
        lowVel: 1,
        highVel: 127,
        label: `Nota raíz ${rootKey} (${midiToNoteName(rootKey)}) · ${descriptors.detectedF0Hz.toFixed(1)} Hz`,
        category: 'chromatic',
        pcm: slicePcm,
      },
    ];
  } else {
    // 'drums' or 'melody' multi-slice mapping
    const slicerMode = resolvedRole === 'drums' ? 'drums' : 'chromatic';
    const sliced = sliceAudioBuffer(pcm, sr, {
      ...DEFAULT_SLICER_OPTIONS,
      mode: slicerMode,
      sensitivity,
      snapZeroCrossing,
    });
    const valid = sliced.slices.filter((s) => !s.isSilence);
    finalSlices = valid.length > 0 ? valid : sliced.slices.slice(0, 1);

    const count = finalSlices.length;
    // Build contiguous 0..127 ranges so Classic coverage validation is 100% green
    const spanPerSlice = Math.max(1, Math.floor(128 / Math.max(1, count)));

    finalSlices.forEach((sl, idx) => {
      const zoneNum = String(idx + 1).padStart(2, '0');
      const lowKey = idx === 0 && autoExtendKeybed ? 0 : Math.min(127, idx * spanPerSlice);
      const highKey =
        idx === count - 1 && autoExtendKeybed
          ? 127
          : Math.min(127, Math.max(lowKey, (idx + 1) * spanPerSlice - 1));
      const rootKey = Math.max(lowKey, Math.min(highKey, sl.rootKey ?? Math.round((lowKey + highKey) / 2)));

      const hiName = `${baseName}_s${zoneNum}_hi.wav`;
      const loName = `${baseName}_s${zoneNum}_lo.wav`;

      const hiWav = encodePcm16Wav(sl.pcm, sr, { rootKey, lowKey, highKey });
      audioBuffers.set(hiName, hiWav);

      if (classicTwoVelocityLayers) {
        const softPcm = new Float32Array(sl.pcm.length);
        for (let i = 0; i < sl.pcm.length; i++) {
          softPcm[i] = sl.pcm[i] * 0.62;
        }
        const loWav = encodePcm16Wav(softPcm, sr, { rootKey, lowKey, highKey });
        audioBuffers.set(loName, loWav);
      }

      classicZones.push({
        id: `zone_wiz_${ String(idx + 1).padStart(3, '0') }`,
        lowKey,
        rootKey,
        highKey,
        sampleLow: classicTwoVelocityLayers ? loName : hiName,
        sampleHigh: classicTwoVelocityLayers ? hiName : null,
        velSplit,
        detune: 0,
        volume: 0,
        pan: 0,
      });

      extendedRegions.push({
        id: `reg_wiz_${String(idx + 1).padStart(3, '0')}`,
        sampleName: hiName,
        lowKey,
        rootKey,
        highKey,
        lowVel: 1,
        highVel: 127,
        detune: 0,
        volume: 0,
        pan: 0,
        pitchKeytrack: resolvedRole === 'drums' ? 0 : 100,
        trigger: 'attack',
        keyFadeIn: 0,
        keyFadeOut: 0,
        velFadeIn: 0,
        velFadeOut: 0,
        fadeCurve: 'equal-power',
        loopMode: 'no_loop',
        loopStart: 0,
        loopEnd: sl.pcm.length,
        loopCrossfadeMs: 0,
        sampleRate: sr,
        numChannels: 1,
      });
    });
  }

  const suggestedParameterSet =
    resolvedRole === 'drums' ? 8 : acousticClass.recommendedParameterSet;
  const detectedCategory =
    resolvedRole === 'drums' ? 'Drums & Perc' : acousticClass.detectedCategory;

  const roleLabels: Record<WizardResolvedRole, { label: string; explanation: string }> = {
    drums: {
      label: 'Batería / Percusión (Kit por golpes)',
      explanation: `Detectados ${finalSlices.length} golpes percusivos con ajuste al cruce por cero (zc-snap) y Parameter Set #8 (Drums & Perc).`,
    },
    melody: {
      label: 'Melodía / Frase (Varias notas)',
      explanation: `Cortadas ${finalSlices.length} notas con ajuste al cruce por cero (zc-snap) y repartidas en el teclado 0..127 (${detectedCategory}, Set #${suggestedParameterSet}).`,
    },
    single: {
      label: 'Nota única / Instrumento cromático',
      explanation: `Nota raíz detectada en ${midiToNoteName(descriptors.detectedMidiNote)} (${descriptors.detectedF0Hz.toFixed(1)} Hz) y extendida en todo el teclado 0..127 con 2 capas de velocidad (${detectedCategory}, Set #${suggestedParameterSet}).`,
    },
  };

  return {
    roleChoice,
    resolvedRole,
    roleLabelEs: roleLabels[resolvedRole].label,
    roleExplanationEs: roleLabels[resolvedRole].explanation,
    detectedCategory,
    suggestedParameterSet,
    classificationConfidence: acousticClass.confidence,
    classificationRationale: acousticClass.rationale,
    detectedRootKey: descriptors.detectedMidiNote,
    detectedF0Hz: descriptors.detectedF0Hz,
    sliceCount: finalSlices.length,
    classicZones,
    extendedRegions,
    audioBuffers,
    slices: finalSlices,
  };
}

export function sanitizeClassicModelName(rawName: string): string {
  const cleaned = rawName
    .trim()
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9 _-]+/g, '')
    .trim();
  const base = cleaned.length > 0 ? cleaned : 'Init Model';
  return base.slice(0, 11);
}

export function describeWorkingModeForMusician(mode: WorkingMode): string {
  return mode === 'extended'
    ? 'Extended (Multicapa HD / Regiones 2D sin límite de 11 caracteres)'
    : 'Classic (Hardware 1:1 · 2 capas de velocidad por zona · nombre máx. 11 caracteres)';
}
