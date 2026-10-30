// ─────────────────────────────────────────────────────────
// @abdsynths/shared — Neuron Universal Types
// Canonical definitions for Hartmann Neuron / NEURONiK models,
// zones, velocity splits, and synthesis process configurations.
// ─────────────────────────────────────────────────────────

/** MIDI note number 0..127 */
export type MidiNote = number;

/** Model slot number 0..511 */
export type ModelSlot = number;

/**
 * A keyboard zone — the fundamental unit of a MODELmaker / Neuron session.
 * Zones cover the full MIDI range 0..127 without gaps or overlaps.
 */
export interface Zone {
  id: string;
  lowKey: MidiNote;    // inclusive (0..127)
  rootKey: MidiNote;
  highKey: MidiNote;   // inclusive (0..127)
  sampleLow: string | null;   // file path / name — required (Low Vel: 1 .. velSplit-1, or 1..127 if sampleHigh is null)
  sampleHigh: string | null;  // file path / name — optional (High Vel: velSplit .. 127)
  velSplit?: number;   // Velocity split point 2..127 (canonical Hartmann default = 64: Low 1..63, High 64..127)
  detune: number;      // -99 .. +99 cents
  volume: number;      // -32 .. +12 dB
  pan: number;         // -50 .. +50
}

/**
 * Parameter set 0..9 — defines which Scape/Sphere parameter
 * families are available after model generation.
 */
export interface ParameterSetInfo {
  id: number;          // 0..9
  name: string;
  description: string;
  category: string;    // e.g. "Neutral", "Strings", "Piano", "Pads"...
}

/**
 * Output target format profile:
 *   - 'dual': Generates both Legacy Neuron (.scape/.sphere/map.script @ 44.1kHz mono)
 *             and Modern Neural (.nmmodel v2.1 Float32 multi-layer) artifacts.
 *   - 'legacy-neuron': Strict Hartmann Neuron Hardware / NeuronVS 1.x format.
 *   - 'modern-neural': Extended high-resolution Float32 multi-layer format for ABDNeural.
 */
export type TargetFormat = 'dual' | 'legacy-neuron' | 'modern-neural';

/**
 * Process configuration — the settings for model generation.
 */
export interface ProcessConfig {
  modelNumber: ModelSlot;     // 0..511
  modelName: string;          // max 11 characters
  complexity: number;         // 1..10, default 8
  parameterSet: number;       // 0..9
  targetFormat?: TargetFormat; // default 'dual'
}

/** Process execution state */
export type ProcessStatus = 'idle' | 'running' | 'completed' | 'error' | 'cancelled';

export interface ProcessProgress {
  status: ProcessStatus;
  currentZone: number;
  totalZones: number;
  currentSample: string;
  percent: number;             // 0..100
  message: string;
  elapsedMs: number;
}

/**
 * A session — the top-level container for a MODELmaker editing session.
 * Contains zones + process config + metadata.
 */
export interface Session {
  id: string;
  name: string;
  zones: Zone[];
  processConfig: ProcessConfig;
  dirty: boolean;
  createdAt: string;
  modifiedAt: string;
}

export interface ZoneAnalysisSummary {
  zoneIndex: number;
  rootKey: number;
  detectedF0Low: number;
  detectedF0High: number;
  spectralCentroidHarmonic: number;
  inharmonicityCents: number;
  layerCount: number;
}

/**
 * A generated model — the output of the Process step.
 */
export interface GeneratedModel {
  slot: ModelSlot;
  name: string;
  zoneCount: number;
  complexity: number;
  parameterSet: number;
  createdAt: string;
  path: string;                // where the model files live
  targetFormat?: TargetFormat;
  zonesAnalysis?: ZoneAnalysisSummary[];
}
