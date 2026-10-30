// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Scape/Sphere Frame Generator,
// Authentic Neuron Binary (.scape / .sphere / map.script / MName)
// & .neuronikmodel Writer (Port of SpectralModelWriter.h + model_binary.py)
// ─────────────────────────────────────────────────────────

import type { SpectralModelData } from './GridIndicator.ts';
import type { ProcessConfig, Zone } from '../../NeuronFormats/NeuronTypes.ts';

export interface ScapeDescriptors {
  /** Spectral centroid in harmonic units (1..64) */
  centroidHarmonic: number;
  /** Ratio of odd harmonic energy to total harmonic energy (0..1) */
  oddEvenBalance: number;
  /** RMS inharmonicity (cents) across active partials */
  inharmonicityCents: number;
  /** Active partials retained after complexity pruning */
  retainedPartials: number;
  /** 64 partial magnitudes shaped by complexity */
  partialMagnitudes: Float32Array;
  /** 64 partial frequency offsets (Hz) clamped to half-band */
  partialOffsetsHz: Float32Array;
}

export interface SphereDescriptors {
  /** Spectral tilt in dB/octave */
  spectralTiltDbPerOct: number;
  /** Temporal envelope energy contour across frames (0..1) */
  temporalContour: Float32Array;
  /** Formant band energies (Low / Mid-Low / Mid-High / High) */
  formantBands: [number, number, number, number];
  /** Parameter set ID (0..9) */
  parameterSet: number;
  /** Layer count (1..3) */
  layerCount: number;
}

export interface ScapeSphereFrame {
  frameIndex: number;
  f0Hz: number;
  scape: ScapeDescriptors;
  sphere: SphereDescriptors;
}

export interface CompiledZoneFramePackage {
  frames: ScapeSphereFrame[];
  /** Authentic Neuron .scape binary (csAN + mnAN + fdAN + int16 excitation curve) */
  scapeBinary: Uint8Array;
  /** Authentic Neuron .sphere binary (psAN + mnAN + fdAN + 6568-byte SphereFrames with 6152B partial bank) */
  sphereBinary: Uint8Array;
  /** Compact NMM1 binary payload */
  binaryPayload: Uint8Array;
  /** Canonical .neuronikmodel v2 / v2.1 JSON */
  neuronikJson: Record<string, unknown>;
}

function clamp(val: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, val));
}

/**
 * Exact mapping from UI Complexity (1..10) to `recursionDepth`
 * verified from decompiled `neuronapp.ProcessDialog.complexityToRecDepth` (tableswitch 1..10).
 */
export const COMPLEXITY_TO_REC_DEPTH: readonly number[] = [
  1, 4, 8, 12, 16, 24, 32, 42, 54, 64,
];

export function complexityToRecursionDepth(complexity: number): number {
  const idx = clamp(Math.round(complexity), 1, 10) - 1;
  return COMPLEXITY_TO_REC_DEPTH[idx] ?? 42;
}

/**
 * Authentic 12 x 8-char `mnAN` parameter names for `.scape` (`FUN_100028e0`) and `.sphere` (`FUN_10001880`)
 * across the 10 Parameter Sets (`0..9`) decompiled from `NASAnalysis.dll` (`0x100154d0..0x10015c98`).
 */
export const SCAPE_MNAN_NAMES_BY_SET: ReadonlyArray<readonly string[]> = [
  // 0: Neutral (Bowed Strings / General)
  ['Torsion ', 'HiTurbul', 'Neutral ', 'LoTurbul', 'Warm    ', 'Planar  ', 'Cold    ', 'Tubular ', 'Influenc', 'HiIrregl', 'Influenc', 'LoIrregl'],
  // 1: Bowed / Rough
  ['Rough   ', 'RoughIdx', 'Smooth  ', 'RoughIdx', 'Chaotic ', 'Damped  ', 'Ordered ', 'Clear   ', 'Harmonic', 'HarmnMix', 'Harmonic', 'HarmnMix'],
  // 2: Plucked / Resonant
  ['PluckNoi', 'PlkSpect', 'Clean   ', 'PlkSpect', 'AttkTens', 'SustTens', 'AttkTens', 'SustTens', 'Warm    ', 'Resonant', 'Cold    ', 'Natural '],
  // 3: Plucked / Percussive
  ['PluckNoi', 'PlkSpect', 'Clean   ', 'PlkSpect', 'MatrSoft', 'Planar  ', 'MatrHard', 'Tubular ', 'Percussv', 'Sustaind', 'Smooth  ', 'Plucked '],
  // 4: Glass / Stiffness
  ['Glass   ', 'HiStiffn', 'Natural ', 'LoStiffn', 'Warm    ', 'Planar  ', 'Cold    ', 'Tubular ', 'PlkPostn', 'PlkMater', 'PlkPostn', 'PlkMater'],
  // 5: Piano / Hammer & Frame
  ['StrMetal', 'HamMetal', 'StrPlast', 'HamrWood', 'FramWood', 'FrmLoose', 'FrmMetal', 'FrmSolid', 'FrNormal', 'StrWobbl', 'FramTorn', 'StrTense'],
  // 6: String / Metallic / Air
  ['String  ', 'Metallic', 'Air     ', 'Natural ', 'Synthetc', 'Warm    ', 'Natural ', 'Cold    ', 'ToneHigh', 'ToneIntn', 'ToneLow ', 'ToneIntn'],
  // 7: Character / Liquified / Alienized
  ['Charactr', 'Charactr', 'Charactr', 'Charactr', 'Lquified', 'Periodic', 'Natural ', 'Chaotic ', 'Alienizd', 'Warm    ', 'Natural ', 'Cold    '],
  // 8: Loop / Speed & Pitch
  ['SpdConst', 'PitchVar', 'SpeedVar', 'PtchCons', 'Pitch   ', 'Speed   ', 'Pitch   ', 'Speed   ', 'Coherent', 'OrangeNs', 'Smooth  ', 'WhiteNoi'],
  // 9: Body / Corpus Reflection
  ['BodyAmnt', 'BodyTone', 'BodyAmnt', 'BodyTone', 'BdyColor', 'ColrAmnt', 'BdyColor', 'ColrAmnt', 'CorpOpen', 'CrpRflct', 'CorpClsd', 'CrpRflct'],
];

export const SPHERE_MNAN_NAMES_BY_SET: ReadonlyArray<readonly string[]> = [
  // 0: Stringed Body
  ['SmallBdy', 'Stringed', 'LargeBdy', 'Natural ', 'StrTuneL', '2SemiDwn', 'StrTuneH', '2SemiUp ', 'Dissolvd', 'LoFrictn', 'Coherent', 'HiFrictn'],
  // 1: Simple/Complex Modes & Corpus
  ['SmallBdy', 'Simple  ', 'LargeBdy', 'Complex ', '1stModeL', '2ndSemiL', '1stModeH', '2ndSemiH', 'CrpStrct', 'Corpus L', 'CrpStrct', 'Corpus H'],
  // 2: Decaying / Percussive Inharmonicity
  ['SmallBdy', 'Decaying', 'LargeBdy', 'Percussv', 'AtkInhar', 'SusInhar', 'AtkNatur', 'SusNatur', 'AtkTunHi', 'SusTunHi', 'AtkTunLo', 'SusTunLo'],
  // 3: String Tension & Pluck Type
  ['SmallBdy', 'Decaying', 'LargeBdy', 'Percussv', 'StrTensn', 'PlckType', 'StrTensn', 'PlckType', 'AtkColor', 'SusColor', 'AtkNatur', 'SusNatur'],
  // 4: Stationary / Corpus Intensity
  ['SmallBdy', 'Statnary', 'LargeBdy', 'Natural ', 'Mode1Low', 'Mode2Low', 'Mode1Hi ', 'Mode2Hi ', 'CorpIntn', 'SimpleMd', 'CorpIntn', 'ComplxMd'],
  // 5: Corpus Material (Metal/Glass/Wood/Fibre)
  ['CrpSmall', 'CrpJaggd', 'CrpLarge', 'CrpRound', 'CrpMetal', 'CrpGlass', 'CorpWood', 'CrpFibre', 'CrpSolid', 'AtmDampd', 'CorpSoft', 'AtmoOpen'],
  // 6: Wind / Overblow / Vibrato
  ['Overblow', 'Hollow  ', 'Underblw', 'Rich    ', 'Light   ', 'Small   ', 'Dark    ', 'Large   ', 'SlowVibr', 'FastAttk', 'FastVibr', 'SlowAttk'],
  // 7: Color / Haunting / TapSync
  ['ColorHi ', 'ColorSft', 'ColorLow', 'ColorStn', 'Open    ', 'Funny   ', 'Closed  ', 'Hounting', 'TapSync ', 'Alternat', 'FreeRun ', 'Playthru'],
  // 8: EQ / Static / Comb
  ['EQ Freq ', 'EQ Gain ', 'EQ Freq ', 'EQ Gain ', 'StaticFq', 'StatcAmt', 'StaticFq', 'StatcAmt', 'CombFreq', 'CombGain', 'CombFreq', 'CombGain'],
  // 9: Corpus Material & Body Shape
  ['CrpSmall', 'CrpMatrl', 'CrpLarge', 'CrpMatrl', 'HiMovmnt', 'HiSoftns', 'LoMovmnt', 'LoSoftns', 'BdyShape', 'BdyShape', 'BdyShape', 'BdyShape'],
];

/**
 * Exact `fdAN` 6 float pairs for `.scape` from `FUN_100028e0` (`0x100028e0` in `NASAnalysis.dll`).
 * Each pair `(p0, p1)` is followed by its complement `(1 - p0, 1 - p1)`.
 */
export function buildScapeFdPairs(parameterSet: number): [number, number][] {
  let c0: [number, number] = [0.0, 0.0];
  let c1: [number, number] = [0.0, 0.0];
  let c2: [number, number] = [0.0, 0.0];

  switch (parameterSet) {
    case 0:
    case 1:
    case 2:
    case 4:
    case 6:
    case 7:
      break;
    case 3:
      c2 = [1.0, 1.0];
      break;
    case 5:
      c0 = [0.5, 0.5];
      c1 = [1.0, 0.0];
      break;
    case 8:
      c0 = [1.0, 1.0];
      c1 = [0.5, 1.0];
      c2 = [0.25, 0.0];
      break;
    case 9:
      c0 = [1.0, 0.0];
      c1 = [0.7559055, 0.0]; // 0x3f418306
      c2 = [0.08661417, 0.0]; // 0x3db162c6
      break;
    default:
      c0 = [0.5, 0.5];
      c1 = [0.5, 0.5];
      c2 = [0.5, 0.5];
      break;
  }

  return [
    c0,
    [1.0 - c0[0], 1.0 - c0[1]],
    c1,
    [1.0 - c1[0], 1.0 - c1[1]],
    c2,
    [1.0 - c2[0], 1.0 - c2[1]],
  ];
}

/**
 * Exact `fdAN` 6 float pairs for `.sphere` from `FUN_10001880` (`0x10001880` in `NASAnalysis.dll`).
 * Computes `fVar1` by octave-folding `resolution` (period in samples) against `164.0` (`0x10015920`).
 */
export function buildSphereFdPairs(parameterSet: number, resolution: number): [number, number][] {
  let fVar1 = Math.max(1.0, resolution);
  while (fVar1 < 164.0) fVar1 *= 2.0;
  while (fVar1 > 164.0) fVar1 /= 2.0;
  fVar1 /= 164.0;

  let c0: [number, number] = [0.0, 0.0];
  let c1: [number, number] = [0.0, 0.0];
  let c2: [number, number] = [0.0, 0.0];

  switch (parameterSet) {
    case 0:
    case 1:
      c1 = [fVar1, 0.5];
      break;
    case 2:
      c2 = [fVar1, 0.0];
      break;
    case 3:
      c1 = [fVar1, 0.0];
      break;
    case 4:
      c1 = [fVar1, 0.5];
      c2 = [fVar1, 0.0];
      break;
    case 5:
    case 8:
      break;
    case 6:
      c0 = [0.07874016, 0.0]; // 0x3da14285
      c1 = [0.5, 0.5];
      c2 = [0.5, 0.0];
      break;
    case 7:
      c1 = [0.5, 0.5];
      break;
    case 9:
      c0 = [0.7637795, 0.0]; // 0x3f43870e
      break;
    default:
      c0 = [0.5, 0.5];
      c1 = [0.5, 0.5];
      c2 = [0.5, 0.5];
      break;
  }

  return [
    c0,
    [1.0 - c0[0], 1.0 - c0[1]],
    c1,
    [1.0 - c1[0], 1.0 - c1[1]],
    c2,
    [1.0 - c2[0], 1.0 - c2[1]],
  ];
}

/**
 * Maps complexity (1..10) to the maximum number of active partials (1..64)
 * and temporal frames (1..16) retained in the model.
 */
export function complexityToLimits(complexity: number): {
  recursionDepth: number;
  maxPartials: number;
  targetFrames: number;
} {
  const recursionDepth = complexityToRecursionDepth(complexity);
  const maxPartials = clamp(Math.max(8, recursionDepth), 8, 64);
  const c = clamp(Math.round(complexity), 1, 10);
  const targetFrames = Math.min(16, Math.max(2, Math.round(c * 1.2)));
  return { recursionDepth, maxPartials, targetFrames };
}

/**
 * Generates Neuron Scape & Sphere frames and authentic binary `.scape` / `.sphere` buffers
 * from a `SpectralModelData` and `ProcessConfig`.
 */
export function generateScapeSphereFrames(
  model: SpectralModelData,
  config: ProcessConfig
): CompiledZoneFramePackage {
  const { maxPartials } = complexityToLimits(config.complexity);
  const nFrames = Math.max(1, model.frameCount);
  const span = model.frameSpanHz > 0 ? model.frameSpanHz : 130.81;

  // Compute global temporal contour across frames
  const temporalContour = new Float32Array(nFrames);
  let maxFrameEnergy = 0.0;
  for (let f = 0; f < nFrames; f++) {
    const amps = model.ampsOf(f);
    let e = 0.0;
    for (let k = 0; k < 64; k++) {
      e += amps[k] * amps[k];
    }
    temporalContour[f] = Math.sqrt(e);
    if (temporalContour[f] > maxFrameEnergy) {
      maxFrameEnergy = temporalContour[f];
    }
  }
  if (maxFrameEnergy > 0.0) {
    for (let f = 0; f < nFrames; f++) {
      temporalContour[f] /= maxFrameEnergy;
    }
  }

  const frames: ScapeSphereFrame[] = [];

  for (let f = 0; f < nFrames; f++) {
    const rawAmps = model.ampsOf(f);
    const rawOffsets = model.offsetsOf(f);
    const f0Hz = f === 0 ? span : model.f0At(f) > 0 ? model.f0At(f) : span;

    const partialMagnitudes = new Float32Array(64);
    const partialOffsetsHz = new Float32Array(64);

    // Rank partials by amplitude to keep top `maxPartials`
    const indices = Array.from({ length: 64 }, (_, i) => i);
    indices.sort((a, b) => rawAmps[b] - rawAmps[a]);
    const keepSet = new Set(indices.slice(0, maxPartials));

    let weightedHarmSum = 0.0;
    let ampSum = 0.0;
    let oddEnergy = 0.0;
    let totalEnergy = 0.0;
    let inharmAcc = 0.0;
    let inharmCount = 0;
    let retainedPartials = 0;
    const formantBands: [number, number, number, number] = [0, 0, 0, 0];

    for (let k = 0; k < 64; k++) {
      const gap = span > 0 ? span : k + 1;
      const amp = keepSet.has(k) ? rawAmps[k] : 0.0;
      const off = keepSet.has(k)
        ? clamp(rawOffsets[k], -0.5 * gap, 0.5 * gap)
        : 0.0;

      partialMagnitudes[k] = amp;
      partialOffsetsHz[k] = off;

      if (amp > 1.0e-3) {
        retainedPartials++;
        const harm = k + 1;
        weightedHarmSum += harm * amp;
        ampSum += amp;

        const e = amp * amp;
        totalEnergy += e;
        if (harm % 2 === 1) oddEnergy += e;

        const targetHz = harm * f0Hz;
        const peakHz = Math.max(1.0, targetHz + off);
        const cents = 1200.0 * Math.log2(peakHz / targetHz);
        inharmAcc += cents * cents;
        inharmCount++;

        if (k < 4) formantBands[0] += e;
        else if (k < 12) formantBands[1] += e;
        else if (k < 28) formantBands[2] += e;
        else formantBands[3] += e;
      }
    }

    const centroidHarmonic = ampSum > 0.0 ? weightedHarmSum / ampSum : 1.0;
    const oddEvenBalance = totalEnergy > 0.0 ? oddEnergy / totalEnergy : 0.5;
    const inharmonicityCents =
      inharmCount > 0 ? Math.sqrt(inharmAcc / inharmCount) : 0.0;

    if (totalEnergy > 0.0) {
      for (let b = 0; b < 4; b++) {
        formantBands[b] = Math.sqrt(formantBands[b] / totalEnergy);
      }
    }

    const lowRef = Math.max(1e-4, formantBands[0]);
    const highRef = Math.max(1e-4, formantBands[3]);
    const spectralTiltDbPerOct = (20.0 * Math.log10(highRef / lowRef)) / 4.0;

    frames.push({
      frameIndex: f,
      f0Hz,
      scape: {
        centroidHarmonic,
        oddEvenBalance,
        inharmonicityCents,
        retainedPartials,
        partialMagnitudes,
        partialOffsetsHz,
      },
      sphere: {
        spectralTiltDbPerOct,
        temporalContour,
        formantBands,
        parameterSet: config.parameterSet,
        layerCount: model.layerCount,
      },
    });
  }

  const curveId = -1048088517 + (config.modelNumber & 0x1ff);
  const scapeBinary = serializeNeuronScapeBinary(frames, config, curveId);
  const sphereBinary = serializeNeuronSphereBinary(frames, config, curveId);

  const neuronikJson = modelToNeuronikJson(
    model,
    config.modelName,
    `Generated by ABDNeuModMakr (Slot ${config.modelNumber}, Complexity ${config.complexity}, ParamSet ${config.parameterSet})`
  );

  const binaryPayload = serializeBinaryScapeSpherePayload(frames, config);

  return {
    frames,
    scapeBinary,
    sphereBinary,
    binaryPayload,
    neuronikJson,
  };
}

// ── Authentic Neuron .scape / .sphere / map.script Binary Writers ──

function writeAsciiTag(view: DataView, offset: number, tag: string, len: number): void {
  for (let i = 0; i < len; i++) {
    const ch = i < tag.length ? tag.charCodeAt(i) & 0x7f : 0x20;
    view.setUint8(offset + i, ch);
  }
}

function writeMnAnChunk(view: DataView, offset: number, names: readonly string[]): number {
  // 'mnAN' (4B) + size 104 (4B) + 12 * 8-byte ASCII names (96B) = 104 bytes
  writeAsciiTag(view, offset, 'mnAN', 4);
  view.setUint32(offset + 4, 104, true);
  let ptr = offset + 8;
  for (let i = 0; i < 12; i++) {
    const name = names[i] ?? '';
    for (let c = 0; c < 8; c++) {
      view.setUint8(ptr + c, c < name.length ? name.charCodeAt(c) & 0x7f : 0x00);
    }
    ptr += 8;
  }
  return offset + 104;
}

function writeFdAnChunk(
  view: DataView,
  offset: number,
  pairs: readonly [number, number][]
): number {
  // 'fdAN' (4B) + size 56 (4B) + 6 * 2 float32 (48B) = 56 bytes
  writeAsciiTag(view, offset, 'fdAN', 4);
  view.setUint32(offset + 4, 56, true);
  let ptr = offset + 8;
  for (let i = 0; i < 6; i++) {
    const [a, b] = pairs[i] ?? [0.0, 0.0];
    view.setFloat32(ptr, a, true);
    view.setFloat32(ptr + 4, b, true);
    ptr += 8;
  }
  return offset + 56;
}

/**
 * Serializes an authentic Hartmann Neuron `.scape` binary file
 * matching the verified `000.model` / `511.model` layout in `SCAPE_SPHERE.md` & `model_binary.py`:
 *   - `csAN` (100 bytes: header with format=256, curveId, resolution, flags=0, length, loopStart, loopEnd)
 *   - `mnAN` (104 bytes: 12 x 8-char Scape parameter names for `config.parameterSet`)
 *   - `fdAN` (56 bytes: 6 float pairs)
 *   - `@0x104` (260): `int16` little-endian phase/excitation curve (`length` samples, periodic at `resolution`)
 */
export function serializeNeuronScapeBinary(
  frames: ScapeSphereFrame[],
  config: ProcessConfig,
  curveId = -1048088517
): Uint8Array {
  const f0 = Math.max(20.0, frames[0]?.f0Hz ?? 441.0);
  const resolution = clamp(Math.round(44100.0 / f0), 32, 2048);
  const numCycles = 64; // 64 cycles (3 attack cycles with 1/n harmonics + 61 steady sine cycles)
  const sampleCount = resolution * numCycles;
  const loopStart = resolution * 16;
  const loopEnd = resolution * 60;

  const dataOffset = 100 + 104 + 56; // 0x104 = 260 bytes
  const totalBytes = dataOffset + sampleCount * 2;
  const buffer = new ArrayBuffer(totalBytes);
  const view = new DataView(buffer);

  // 1. csAN chunk (100 bytes)
  writeAsciiTag(view, 0x00, 'csAN', 4);
  view.setUint32(0x04, 100, true);
  view.setUint32(0x08, 256, true);         // format = 256
  view.setInt32(0x0c, curveId, true);      // curve_id (must match sphere)
  view.setInt32(0x10, resolution, true);   // resolution (samples per cycle)
  view.setInt32(0x14, 0, true);            // flags
  view.setInt32(0x18, sampleCount, true);  // length in samples
  view.setInt32(0x1c, loopStart, true);    // loop_start
  view.setInt32(0x20, loopEnd, true);      // loop_end

  // 2. mnAN chunk at +100 (104 bytes)
  const paramSetIdx = clamp(config.parameterSet, 0, 9);
  const scapeNames = SCAPE_MNAN_NAMES_BY_SET[paramSetIdx] ?? SCAPE_MNAN_NAMES_BY_SET[0];
  writeMnAnChunk(view, 100, scapeNames);

  // 3. fdAN chunk at +204 (56 bytes) — exact FUN_100028e0 table
  const scapeFdPairs = buildScapeFdPairs(paramSetIdx);
  writeFdAnChunk(view, 204, scapeFdPairs);

  // 4. int16 excitation curve payload at +0x104 (260)
  // First 3 cycles fade in from 1/n harmonic attack to pure fundamental sine at ~1538 amplitude
  let ptr = dataOffset;
  for (let c = 0; c < numCycles; c++) {
    const attackWeight = c < 3 ? Math.pow(0.35, c) : 0.0;
    const fadeEnv = c < 3 ? (c + 1) / 3.0 : 1.0;

    for (let s = 0; s < resolution; s++) {
      const phase = (2.0 * Math.PI * s) / resolution;
      let val = Math.sin(phase);
      if (attackWeight > 0.0) {
        for (let h = 2; h <= 8; h++) {
          val += (attackWeight / h) * Math.sin(h * phase);
        }
      }
      const sampleInt16 = clamp(Math.round(val * fadeEnv * 1538), -32768, 32767);
      view.setInt16(ptr, sampleInt16, true);
      ptr += 2;
    }
  }

  return new Uint8Array(buffer);
}

/**
 * Serializes an authentic Hartmann Neuron `.sphere` binary file
 * matching the verified `000.model` / `511.model` layout in `SCAPE_SPHERE.md` & `model_binary.py`:
 *   - `psAN` (140 bytes: version=288, curveId, resolution, channels, frameStride=6568, dataOffset=300, shaping[6])
 *   - `mnAN` (104 bytes: 12 x 8-char Sphere parameter names for `config.parameterSet`)
 *   - `fdAN` (56 bytes: 6 float pairs)
 *   - `@0x12C` (300): `frameCount` frames of `6568` bytes (`0x19A8`), each containing:
 *     - `magic = 0x4D2` (1234), `frame_id = curveId + i`, `3 header floats`
 *     - `25 x 4 float` band table (`+0x10..+0x19F`, 400 bytes)
 *     - `6152-byte` 1024-partial additive bank at `+0x1A0`:
 *       - `+0x000`: `u16 count = 1024`, `u16 blockGain = 31040`, `u16 0`, `u16 0`
 *       - `+0x008`: `u16 frequency[1024]` (Hz, measured peak A)
 *       - `+0x808`: `u16 amplitude[1024]` (sorted descending, 65535..0, 0 terminates list B)
 *       - `+0x1008`: `u16 bin[1024]` (1024-bin index on 44100 Hz grid C)
 */
export function serializeNeuronSphereBinary(
  frames: ScapeSphereFrame[],
  config: ProcessConfig,
  curveId = -1048088517
): Uint8Array {
  const f0 = Math.max(20.0, frames[0]?.f0Hz ?? 441.0);
  const resolution = clamp(Math.round(44100.0 / f0), 32, 2048);
  const numFrames = Math.max(1, frames.length);
  const frameStride = 6568; // 0x1A0 (416) + 6152 = 6568 bytes
  const dataOffset = 140 + 104 + 56; // 300 (0x12C)
  const totalBytes = dataOffset + numFrames * frameStride;

  const buffer = new ArrayBuffer(totalBytes);
  const view = new DataView(buffer);

  // 1. psAN chunk (140 bytes)
  writeAsciiTag(view, 0x00, 'psAN', 4);
  view.setUint32(0x04, 140, true);
  view.setInt32(0x08, 288, true);         // version = 288 (0x120)
  view.setInt32(0x0c, curveId, true);     // curve_id (matches scape)
  view.setInt32(0x10, 0, true);           // legacy_count
  view.setInt32(0x14, resolution, true);  // resolution
  view.setInt32(0x18, numFrames, true);   // channels / valid frames
  view.setInt32(0x1c, 1, true);           // stick_modes
  view.setInt32(0x20, 4, true);           // partials per sum
  view.setInt32(0x24, 4, true);           // band_stride (4 floats per band)
  view.setInt32(0x28, 25, true);          // bands = 25
  view.setInt32(0x2c, 25, true);          // bands2 = 25
  view.setInt32(0x30, 6152, true);        // block = 6152 bytes (1024 partials)
  view.setInt32(0x34, 31, true);          // unknown_34
  view.setInt32(0x38, 61, true);          // unknown_38
  view.setInt32(0x3c, 0, true);           // decode_mode (0 -> 1024)
  view.setInt32(0x40, 0, true);           // stick_playback
  view.setInt32(0x44, frameStride, true); // frame_stride = 6568
  view.setInt32(0x48, dataOffset, true);  // data_offset = 300
  view.setInt32(0x4c, 0, true);           // unknown_4c

  // 6 voice shaping floats at +0x50..+0x67
  const shaping = [f0, f0 * 1.126, 16096.07, 0.5662, 16096.07, 0.5669];
  for (let i = 0; i < 6; i++) {
    view.setFloat32(0x50 + i * 4, shaping[i], true);
  }

  // 2. mnAN chunk at +140 (104 bytes)
  const paramSetIdx = clamp(config.parameterSet, 0, 9);
  const sphereNames = SPHERE_MNAN_NAMES_BY_SET[paramSetIdx] ?? SPHERE_MNAN_NAMES_BY_SET[0];
  writeMnAnChunk(view, 140, sphereNames);

  // 3. fdAN chunk at +244 (56 bytes) — exact FUN_10001880 table
  const sphereFdPairs = buildSphereFdPairs(paramSetIdx, resolution);
  writeFdAnChunk(view, 244, sphereFdPairs);

  // 4. Frame bank at +300 (0x12C), stride 6568 bytes
  const binStepHz = 44100.0 / 2048.0; // 21.533203125 Hz (0x10015e08 in FUN_10007e00)

  for (let f = 0; f < numFrames; f++) {
    const frame = frames[f];
    const frameOff = dataOffset + f * frameStride;

    // Frame header (+0x00..+0x13)
    view.setInt32(frameOff + 0x00, 0x4d2, true);          // SPHERE_FRAME_MAGIC = 1234
    view.setInt32(frameOff + 0x04, curveId + f, true);    // contiguous frame_id
    view.setFloat32(frameOff + 0x08, 0.4777, true);       // float a (mean abs amplitude)
    view.setFloat32(frameOff + 0x0c, resolution, true);   // float b (detected lag/period)
    view.setFloat32(frameOff + 0x10, 0.99853, true);      // float c (also band[0][0])

    // 25 x 4 float band table starting at +0x10 (400 bytes -> ends at +0x1A0)
    for (let b = 0; b < 25; b++) {
      const bandOff = frameOff + 0x10 + b * 16;
      const taper = 0.99853 - (b / 24.0) * 0.00832;
      view.setFloat32(bandOff + 0, taper, true);
      view.setFloat32(bandOff + 4, 0.0, true);
      view.setFloat32(bandOff + 8, 0.0, true);
      view.setFloat32(bandOff + 12, 0.0, true);
    }

    // 6152-byte 1024-partial Phase-Vocoder additive block at +0x1A0 (FUN_10007e00)
    const blockOff = frameOff + 0x1a0;
    view.setUint16(blockOff + 0x000, 1024, true); // *param_7 = 0x400 (1024)
    view.setUint16(blockOff + 0x002, f === 0 ? 31040 : 54130, true); // *param_3 = round(maxMag * 65535)
    view.setUint16(blockOff + 0x004, 0, true);
    view.setUint16(blockOff + 0x006, 0, true);

    // Collect active partials from frame.scape and sort by descending amplitude
    interface PartialEntry {
      freqHalfHzU16: number;
      ampU16: number;
      binIdx: number;
    }
    const partials: PartialEntry[] = [];
    let maxMag = 0.0;
    for (let k = 0; k < 64; k++) {
      if (frame.scape.partialMagnitudes[k] > maxMag) {
        maxMag = frame.scape.partialMagnitudes[k];
      }
    }

    if (maxMag > 0.0) {
      for (let k = 0; k < 64; k++) {
        const mag = frame.scape.partialMagnitudes[k] / maxMag;
        if (mag <= 1.0e-4) continue;
        const ampU16 = clamp(Math.round(mag * 65535), 1, 65535);
        const rawHz = clamp((k + 1) * frame.f0Hz + frame.scape.partialOffsetsHz[k], 21.5332, 22050.0);
        // FUN_10007e00 stores frequency in 0.5 Hz units: round(freqHz * 2.0 + 0.5)
        const freqHalfHzU16 = clamp(Math.round(rawHz * 2.0 + 0.5), 40, 44100);
        const binIdx = clamp(Math.round(rawHz / binStepHz), 1, 1023);
        partials.push({ freqHalfHzU16, ampU16, binIdx });
      }
    }

    // Sort descending by amplitude (FUN_10007e00 insertion sort)
    partials.sort((a, b) => b.ampU16 - a.ampU16);
    if (partials.length > 0) {
      partials[0].ampU16 = 65535;
    }

    const activeCount = Math.min(partials.length, 1024);
    for (let i = 0; i < activeCount; i++) {
      const p = partials[i];
      view.setUint16(blockOff + 0x008 + i * 2, p.freqHalfHzU16, true); // param_4: freq in 0.5 Hz units
      view.setUint16(blockOff + 0x808 + i * 2, p.ampU16, true);        // param_5: normalized amplitude (descending)
      view.setUint16(blockOff + 0x1008 + i * 2, p.binIdx, true);       // param_6: 2048-FFT bin index (0..1023)
    }
    // Remaining slots stay 0 (first 0 in B terminates the partial list)
  }

  return new Uint8Array(buffer);
}

/**
 * Losslessly updates the `mnAN` (104-byte parameter names) and `fdAN` (56-byte float pairs)
 * headers of an already-compiled `.scape` and `.sphere` binary pair when `parameterSet` changes,
 * without touching a single excitation sample or spectral frame (zero generation loss).
 */
export function patchBinaryPairParameterSet(
  scapeBinary: Uint8Array,
  sphereBinary: Uint8Array,
  newParamSet: number,
  origParamSet: number
): { scapeBinary: Uint8Array; sphereBinary: Uint8Array } {
  const paramSetIdx = clamp(newParamSet, 0, 9);
  if (paramSetIdx === origParamSet) {
    return { scapeBinary, sphereBinary };
  }

  const scapeOut = new Uint8Array(scapeBinary);
  if (scapeOut.byteLength >= 260) {
    const scapeView = new DataView(scapeOut.buffer, scapeOut.byteOffset, scapeOut.byteLength);
    const scapeNames = SCAPE_MNAN_NAMES_BY_SET[paramSetIdx] ?? SCAPE_MNAN_NAMES_BY_SET[0];
    writeMnAnChunk(scapeView, 100, scapeNames);
    writeFdAnChunk(scapeView, 204, buildScapeFdPairs(paramSetIdx));
  }

  const sphereOut = new Uint8Array(sphereBinary);
  if (sphereOut.byteLength >= 300) {
    const sphereView = new DataView(sphereOut.buffer, sphereOut.byteOffset, sphereOut.byteLength);
    sphereView.setInt32(0x10, paramSetIdx, true);
    const resolution = sphereView.getInt32(0x14, true) || 100;
    const sphereNames = SPHERE_MNAN_NAMES_BY_SET[paramSetIdx] ?? SPHERE_MNAN_NAMES_BY_SET[0];
    writeMnAnChunk(sphereView, 140, sphereNames);
    writeFdAnChunk(sphereView, 244, buildSphereFdPairs(paramSetIdx, resolution));
  }

  return { scapeBinary: scapeOut, sphereBinary: sphereOut };
}

/**
 * Generates the authentic `map.script` text for a Neuron `.model` directory
 * (`verify_model_map_000.md` & `KeyZoneData.formatForMapScript`).
 * Contains `MapVersionMajor/Minor/Build` (0.9.2) followed by 128 zone entries (`000`..`127`).
 */
export function generateMapScript(zones: Zone[]): string {
  const lines: string[] = [
    'MapVersionMajor\t0',
    'MapVersionMinor\t9',
    'MapVersionBuild\t2',
  ];

  // Build source map (1-based index per unique sample path, matching SessionData.createSourceMap)
  const sourceMap = new Map<string, number>();
  let nextSourceIdx = 1;
  for (const z of zones) {
    if (z.sampleLow && !sourceMap.has(z.sampleLow)) {
      sourceMap.set(z.sampleLow, nextSourceIdx++);
    }
    if (z.sampleHigh && !sourceMap.has(z.sampleHigh)) {
      sourceMap.set(z.sampleHigh, nextSourceIdx++);
    }
  }

  const sortedZones = [...zones].sort((a, b) => a.lowKey - b.lowKey);

  for (let i = 0; i < 128; i++) {
    const prefix = String(i).padStart(3, '0');
    const z = sortedZones[i];
    if (z && z.sampleLow) {
      const lowSrc = sourceMap.get(z.sampleLow) ?? 1;
      const hiSrc = z.sampleHigh ? (sourceMap.get(z.sampleHigh) ?? lowSrc) : lowSrc;
      lines.push(`${prefix}LowKey\t${z.lowKey}`);
      lines.push(`${prefix}HiKey\t${z.highKey}`);
      lines.push(`${prefix}RootKey\t${z.rootKey}`);
      lines.push(`${prefix}LowSource\t${lowSrc}`);
      lines.push(`${prefix}HiSource\t${hiSrc}`);
      lines.push(`${prefix}Detune\t${Math.round(z.detune)}`);
      lines.push(`${prefix}Volume\t${Math.round(z.volume)}`);
      lines.push(`${prefix}Pan\t${Math.round(z.pan)}`);
    } else {
      lines.push(`${prefix}LowKey\t0`);
      lines.push(`${prefix}HiKey\t0`);
      lines.push(`${prefix}RootKey\t0`);
      lines.push(`${prefix}LowSource\t0`);
      lines.push(`${prefix}HiSource\t0`);
      lines.push(`${prefix}Detune\t0`);
      lines.push(`${prefix}Volume\t0`);
      lines.push(`${prefix}Pan\t0`);
    }
  }

  return lines.join('\r\n') + '\r\n';
}

/**
 * Port of `NEURONiK::Common::modelToJson` (`SpectralModelWriter.h`).
 * Produces the canonical `.neuronikmodel` v2 / v2.1 JSON object.
 */
export function modelToNeuronikJson(
  model: SpectralModelData,
  name: string,
  description: string
): Record<string, unknown> {
  const span = model.frameSpanHz;

  const frameToJson = (
    amplitudes: Float32Array,
    frequencyOffsets: Float32Array,
    frameSpan: number,
    f0Hz: number
  ): Record<string, unknown> => {
    const amps: number[] = [];
    const offsets: number[] = [];
    for (let i = 0; i < 64; i++) {
      const gap = frameSpan > 0.0 ? frameSpan : i + 1;
      amps.push(Number(amplitudes[i].toFixed(6)));
      offsets.push(
        Number(clamp(frequencyOffsets[i], -0.5 * gap, 0.5 * gap).toFixed(4))
      );
    }
    const obj: Record<string, unknown> = {
      amplitudes: amps,
      frequencyOffsets: offsets,
    };
    if (f0Hz > 0.0) {
      obj.frameF0 = Number(f0Hz.toFixed(3));
    }
    return obj;
  };

  const rootAmps = model.ampsOf(0);
  const rootOffsets = model.offsetsOf(0);
  const rootJson = frameToJson(rootAmps, rootOffsets, span, 0.0);

  const frames: Record<string, unknown>[] = [rootJson];
  for (let f = 1; f < model.frameCount; f++) {
    frames.push(
      frameToJson(model.ampsOf(f), model.offsetsOf(f), span, model.f0At(f))
    );
  }

  const modelObj: Record<string, unknown> = {
    amplitudes: rootJson.amplitudes,
    frequencyOffsets: rootJson.frequencyOffsets,
    format: model.isLayered() ? 2.1 : 2,
    frames,
  };

  if (span > 0.0) {
    modelObj.frameSpanHz = Number(span.toFixed(3));
  }
  if (model.gridFixed) {
    modelObj.gridFixed = true;
  }
  if (model.offsetsTranspose) {
    modelObj.offsetsTranspose = true;
  }

  if (model.isLayered()) {
    const layerArray: Record<string, unknown>[] = [];
    for (let l = 0; l < model.layerCount; l++) {
      const numFrames = model.numFramesOf(l);
      const layerFrames: Record<string, unknown>[] = [];
      const weights: number[] = [];

      for (let f = 0; f < numFrames; f++) {
        const f0Hz = l === 0 && f === 0 ? 0.0 : model.f0AtLayer(l, f);
        layerFrames.push(
          frameToJson(
            model.ampsOfLayer(l, f),
            model.offsetsOfLayer(l, f),
            span,
            f0Hz
          )
        );
        weights.push(Number(model.frameWeightAt(l, f).toFixed(5)));
      }

      layerArray.push({
        name: model.layerNameAt(l),
        weight: Number(model.layerWeightAt(l).toFixed(4)),
        frames: layerFrames,
        frameWeights: weights,
      });
    }

    modelObj.layers = {
      layerCount: model.layerCount,
      layers: layerArray,
    };
  }

  modelObj.name = name;
  modelObj.description = description;

  return modelObj;
}

/**
 * Serializes Scape/Sphere frames into a compact binary representation
 * (Header 'NMM1' + metadata + per-frame 64 floats amp + 64 floats offset).
 */
export function serializeBinaryScapeSpherePayload(
  frames: ScapeSphereFrame[],
  config: ProcessConfig
): Uint8Array {
  const headerSize = 32;
  const bytesPerFrame = (1 + 64 + 64) * 4;
  const totalBytes = headerSize + frames.length * bytesPerFrame;
  const buf = new ArrayBuffer(totalBytes);
  const view = new DataView(buf);

  // Magic 'NMM1'
  view.setUint8(0, 0x4e);
  view.setUint8(1, 0x4d);
  view.setUint8(2, 0x4d);
  view.setUint8(3, 0x31);

  view.setUint16(4, config.modelNumber & 0x1ff, true);
  view.setUint8(6, clamp(config.complexity, 1, 10));
  view.setUint8(7, clamp(config.parameterSet, 0, 9));
  view.setUint16(8, frames.length, true);
  view.setUint16(10, 64, true);

  const cleanName = config.modelName.slice(0, 11);
  for (let i = 0; i < 11; i++) {
    view.setUint8(
      12 + i,
      i < cleanName.length ? cleanName.charCodeAt(i) & 0x7f : 0
    );
  }

  let ptr = headerSize;
  for (const frame of frames) {
    view.setFloat32(ptr, frame.f0Hz, true);
    ptr += 4;
    for (let k = 0; k < 64; k++) {
      view.setFloat32(ptr, frame.scape.partialMagnitudes[k], true);
      ptr += 4;
    }
    for (let k = 0; k < 64; k++) {
      view.setFloat32(ptr, frame.scape.partialOffsetsHz[k], true);
      ptr += 4;
    }
  }

  return new Uint8Array(buf);
}

/**
 * Additive verification resynthesis: reconstructs a playable mono Float32Array
 * from a `SpectralModelData` across all temporal frames and layers.
 */
export function resynthesizeModelToPcm(
  model: SpectralModelData,
  durationSec = 1.2,
  sampleRate = 44100,
  playbackF0Hz?: number
): Float32Array {
  const numSamples = Math.max(1, Math.floor(durationSec * sampleRate));
  const out = new Float32Array(numSamples);
  if (!model.isValid) return out;

  const baseF0 =
    playbackF0Hz && playbackF0Hz > 0
      ? playbackF0Hz
      : model.frameSpanHz > 0
        ? model.frameSpanHz
        : 130.81;

  const layerCount = Math.max(1, model.layerCount);
  const nyquist = sampleRate * 0.48;
  const phases = new Float64Array(64);
  const offsetScale = model.offsetScaleAt(baseF0);

  for (let l = 0; l < layerCount; l++) {
    const layerWeight = model.layerWeightAt(l);
    if (layerWeight <= 0.0) continue;

    const nFrames = Math.max(1, model.numFramesOf(l));
    phases.fill(0.0);

    for (let i = 0; i < numSamples; i++) {
      const normPos = numSamples > 1 ? i / (numSamples - 1) : 0.0;
      const framePos = normPos * Math.max(0, nFrames - 1);
      const f0Idx = Math.min(nFrames - 1, Math.floor(framePos));
      const f1Idx = Math.min(nFrames - 1, f0Idx + 1);
      const frac = framePos - f0Idx;

      const amps0 = model.ampsOfLayer(l, f0Idx);
      const amps1 = model.ampsOfLayer(l, f1Idx);
      const offs0 = model.offsetsOfLayer(l, f0Idx);
      const offs1 = model.offsetsOfLayer(l, f1Idx);

      const w0 = model.frameWeightAt(l, f0Idx);
      const w1 = model.frameWeightAt(l, f1Idx);
      const frameWeight = (w0 + (w1 - w0) * frac) * layerWeight;

      let sampleSum = 0.0;
      for (let k = 0; k < 64; k++) {
        const amp = (amps0[k] + (amps1[k] - amps0[k]) * frac) * frameWeight;
        if (amp < 1.0e-4) continue;

        const off = (offs0[k] + (offs1[k] - offs0[k]) * frac) * offsetScale;
        const freq = (k + 1) * baseF0 + off;
        if (freq <= 0.0 || freq >= nyquist) continue;

        phases[k] += (2.0 * Math.PI * freq) / sampleRate;
        sampleSum += amp * Math.sin(phases[k]);
      }

      const t = i / sampleRate;
      const envIn = Math.min(1.0, t / 0.01);
      const envOut = Math.min(1.0, (durationSec - t) / 0.03);
      out[i] += sampleSum * envIn * envOut;
    }
  }

  let peak = 0.0;
  for (let i = 0; i < numSamples; i++) {
    const a = Math.abs(out[i]);
    if (a > peak) peak = a;
  }
  if (peak > 1e-6) {
    const scale = 0.85 / peak;
    for (let i = 0; i < numSamples; i++) {
      out[i] *= scale;
    }
  }

  return out;
}
