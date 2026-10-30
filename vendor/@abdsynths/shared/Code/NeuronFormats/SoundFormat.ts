// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Hartmann Neuron .sound Preset Format (`sound.script` & `sound.stickrec`)
//
// Implements 1:1 parsing, validation, and serialization of:
//   - `Sounds/NNN.sound/sound.script` (445 parameters in canonical table order,
//     `Key\tInteger\r\n`, `SoundNameC00..C15` 16-byte ASCII name encoding,
//     v1 `BlenderAmount` -64 migration, and `FUN_100014c0` min..max clamping)
//   - `Sounds/NNN.sound/sound.stickrec` (9-hex-digit joystick recording lines `TTTTFCVVV`)
//   - `NeuronDB/SoundNames` cache (`%03d\t%16s`, 1000 slots `000..999`)
//
// Verified against `NeuronVS.dll` (`0x10049f08` parameter descriptors) and
// the 351 factory presets in `NeuronVS_preset_format`.
// ─────────────────────────────────────────────────────────

export type SoundParamGroup =
  | 'SoundHeader'
  | 'SoundName'
  | 'R1'
  | 'R2'
  | 'Synth'
  | 'SoundMFX';

export interface SoundParamField {
  index: number;
  key: string;
  group: SoundParamGroup;
  min: number;
  max: number;
  defaultValue: number;
}

export interface ParsedSoundPreset {
  name: string;
  versionMajor: number;
  versionMinor: number;
  versionBuild: number;
  numVoices: number;
  r1ModelIndex: number;
  r2ModelIndex: number;
  r1Switch: boolean;
  r2Switch: boolean;
  /** Map of all 445 canonical parameter keys -> numeric value */
  values: Map<string, number>;
  /** Unknown keys encountered while parsing (ignored by NeuronVS.dll) */
  unknownKeys: [string, number][];
}

export interface StickRecEvent {
  /** Monotonic timestamp counter (16-bit hex, 0x0000..0xFFFF) */
  time: number;
  /** Edge flag (4-bit nibble, 0 or 1) */
  flag: number;
  /** Control index (4-bit nibble, 0..7, typically 3) */
  control: number;
  /** Stick value (12-bit hex, 0x000..0xFFF) */
  value: number;
}

// Compact tuple representation: [key, groupCode, min, max, defaultValue]
// Group codes: 0=SoundHeader, 1=SoundName, 2=R1, 3=R2, 4=Synth, 5=SoundMFX
const GROUP_NAMES: readonly SoundParamGroup[] = [
  'SoundHeader',
  'SoundName',
  'R1',
  'R2',
  'Synth',
  'SoundMFX',
];

const RAW_SCHEMA_TUPLES: readonly [string, number, number, number, number][] = [
  ['SoundVersionMajor', 0, 0, 999999, 2],
  ['SoundVersionMinor', 0, 0, 999999, 0],
  ['SoundVersionBuild', 0, 0, 999999, 0],
  ['SoundPan', 0, -64, 63, 0],
  ['SoundPanKeyTrack', 0, -64, 63, 0],
  ['SoundNumVoices', 0, 1, 32, 4],
  ['SoundNameC00', 1, 32, 122, 73],
  ['SoundNameC01', 1, 32, 122, 110],
  ['SoundNameC02', 1, 32, 122, 105],
  ['SoundNameC03', 1, 32, 122, 116],
  ['SoundNameC04', 1, 32, 122, 83],
  ['SoundNameC05', 1, 32, 122, 111],
  ['SoundNameC06', 1, 32, 122, 117],
  ['SoundNameC07', 1, 32, 122, 110],
  ['SoundNameC08', 1, 32, 122, 100],
  ['SoundNameC09', 1, 32, 122, 32],
  ['SoundNameC10', 1, 32, 122, 32],
  ['SoundNameC11', 1, 32, 122, 32],
  ['SoundNameC12', 1, 32, 122, 32],
  ['SoundNameC13', 1, 32, 122, 32],
  ['SoundNameC14', 1, 32, 122, 32],
  ['SoundNameC15', 1, 32, 122, 32],
  ['R1ModellIndex', 2, 0, 511, 511],
  ['R1Switch', 2, 0, 1, 1],
  ['R1Type', 2, 0, 1, 1],
  ['R1ParamLevel', 2, 0, 2, 0],
  ['R1SelectStickPar', 2, 0, 1, 0],
  ['R1Volume', 2, 0, 127, 100],
  ['R1AmpLfoDepth', 2, -64, 63, 0],
  ['R1AmpKeyTrack', 2, -64, 63, 0],
  ['R1VolumeVelocityDepth', 2, -64, 63, 63],
  ['R1ModelSizeKeyTrack', 2, -64, 63, 0],
  ['R1ModelSizeOffset', 2, -64, 63, 0],
  ['R1Octave', 2, 0, 3, 2],
  ['R1Semi', 2, -24, 24, 0],
  ['R1Cents', 2, -99, 99, 0],
  ['R1PitchLfoDepth', 2, -64, 63, 0],
  ['R1PitchKeyTrack', 2, -64, 63, 63],
  ['R1FreeADSR1PitchDepth', 2, -64, 63, 0],
  ['R1FreeADSR2PitchDepth', 2, -64, 63, 0],
  ['R1Free4L4TPitchDepth', 2, 0, 127, 0],
  ['R1ModelVelocitySwitch', 2, 1, 127, 64],
  ['R1L1Sphere1Value', 2, 0, 127, 64],
  ['R1L1Sphere2Value', 2, 0, 127, 64],
  ['R1L1ContourSphere', 2, 0, 2, 0],
  ['R1L1Sphere1KeyTrack', 2, -64, 63, 0],
  ['R1L1Sphere2KeyTrack', 2, -64, 63, 0],
  ['R1L1Sphere1LfoDepth', 2, -64, 63, 0],
  ['R1L1Sphere2LfoDepth', 2, -64, 63, 0],
  ['R1L1Sphere1VelocityDepth', 2, -64, 63, 0],
  ['R1L1Sphere2VelocityDepth', 2, -64, 63, 0],
  ['R1L1SphereStickPlayback', 2, 1, 2, 0],
  ['R1L1Scape1Value', 2, 0, 127, 64],
  ['R1L1Scape2Value', 2, 0, 127, 64],
  ['R1L1ContourScape', 2, 0, 2, 0],
  ['R1L1Scape1KeyTrack', 2, -64, 63, 0],
  ['R1L1Scape2KeyTrack', 2, -64, 63, 0],
  ['R1L1Scape1LfoDepth', 2, -64, 63, 0],
  ['R1L1Scape2LfoDepth', 2, -64, 63, 0],
  ['R1L1Scape1VelocityDepth', 2, -64, 63, 0],
  ['R1L1Scape2VelocityDepth', 2, -64, 63, 0],
  ['R1L1ScapeStickPlayback', 2, 1, 2, 0],
  ['R1L2Sphere1Value', 2, 0, 127, 64],
  ['R1L2Sphere2Value', 2, 0, 127, 64],
  ['R1L2ContourSphere', 2, 0, 2, 0],
  ['R1L2Sphere1KeyTrack', 2, -64, 63, 0],
  ['R1L2Sphere2KeyTrack', 2, -64, 63, 0],
  ['R1L2Sphere1LfoDepth', 2, -64, 63, 0],
  ['R1L2Sphere2LfoDepth', 2, -64, 63, 0],
  ['R1L2Sphere1VelocityDepth', 2, -64, 63, 0],
  ['R1L2Sphere2VelocityDepth', 2, -64, 63, 0],
  ['R1L2SphereStickPlayback', 2, 1, 2, 0],
  ['R1L2Scape1Value', 2, 0, 127, 64],
  ['R1L2Scape2Value', 2, 0, 127, 64],
  ['R1L2ContourScape', 2, 0, 2, 0],
  ['R1L2Scape1KeyTrack', 2, -64, 63, 0],
  ['R1L2Scape2KeyTrack', 2, -64, 63, 0],
  ['R1L2Scape1LfoDepth', 2, -64, 63, 0],
  ['R1L2Scape2LfoDepth', 2, -64, 63, 0],
  ['R1L2Scape1VelocityDepth', 2, -64, 63, 0],
  ['R1L2Scape2VelocityDepth', 2, -64, 63, 0],
  ['R1L2ScapeStickPlayback', 2, 1, 2, 0],
  ['R1L3Sphere1Value', 2, 0, 127, 64],
  ['R1L3Sphere2Value', 2, 0, 127, 64],
  ['R1L3ContourSphere', 2, 0, 2, 0],
  ['R1L3Sphere1KeyTrack', 2, -64, 63, 0],
  ['R1L3Sphere2KeyTrack', 2, -64, 63, 0],
  ['R1L3Sphere1LfoDepth', 2, -64, 63, 0],
  ['R1L3Sphere2LfoDepth', 2, -64, 63, 0],
  ['R1L3Sphere1VelocityDepth', 2, -64, 63, 0],
  ['R1L3Sphere2VelocityDepth', 2, -64, 63, 0],
  ['R1L3SphereStickPlayback', 2, 1, 2, 0],
  ['R1L3Scape1Value', 2, 0, 127, 64],
  ['R1L3Scape2Value', 2, 0, 127, 64],
  ['R1L3ContourScape', 2, 0, 2, 0],
  ['R1L3Scape1KeyTrack', 2, -64, 63, 0],
  ['R1L3Scape2KeyTrack', 2, -64, 63, 0],
  ['R1L3Scape1LfoDepth', 2, -64, 63, 0],
  ['R1L3Scape2LfoDepth', 2, -64, 63, 0],
  ['R1L3Scape1VelocityDepth', 2, -64, 63, 0],
  ['R1L3Scape2VelocityDepth', 2, -64, 63, 0],
  ['R1L3ScapeStickPlayback', 2, 1, 2, 0],
  ['R2ModellIndex', 3, 0, 511, 511],
  ['R2Switch', 3, 0, 1, 0],
  ['R2Type', 3, 0, 1, 1],
  ['R2ParamLevel', 3, 0, 2, 0],
  ['R2SelectStickPar', 3, 0, 1, 0],
  ['R2Volume', 3, 0, 127, 100],
  ['R2AmpLfoDepth', 3, -64, 63, 0],
  ['R2AmpKeyTrack', 3, -64, 63, 0],
  ['R2VolumeVelocityDepth', 3, -64, 63, 63],
  ['R2ModelSizeKeyTrack', 3, -64, 63, 0],
  ['R2ModelSizeOffset', 3, -64, 63, 0],
  ['R2Octave', 3, 0, 3, 2],
  ['R2Semi', 3, -24, 24, 0],
  ['R2Cents', 3, -99, 99, 0],
  ['R2PitchLfoDepth', 3, -64, 63, 0],
  ['R2PitchKeyTrack', 3, -64, 63, 63],
  ['R2FreeADSR1PitchDepth', 3, -64, 63, 0],
  ['R2FreeADSR2PitchDepth', 3, -64, 63, 0],
  ['R2Free4L4TPitchDepth', 3, 0, 127, 0],
  ['R2ModelVelocitySwitch', 3, 1, 127, 64],
  ['R2L1Sphere1Value', 3, 0, 127, 64],
  ['R2L1Sphere2Value', 3, 0, 127, 64],
  ['R2L1ContourSphere', 3, 0, 2, 0],
  ['R2L1Sphere1KeyTrack', 3, -64, 63, 0],
  ['R2L1Sphere2KeyTrack', 3, -64, 63, 0],
  ['R2L1Sphere1LfoDepth', 3, -64, 63, 0],
  ['R2L1Sphere2LfoDepth', 3, -64, 63, 0],
  ['R2L1Sphere1VelocityDepth', 3, -64, 63, 0],
  ['R2L1Sphere2VelocityDepth', 3, -64, 63, 0],
  ['R2L1SphereStickPlayback', 3, 1, 2, 0],
  ['R2L1Scape1Value', 3, 0, 127, 64],
  ['R2L1Scape2Value', 3, 0, 127, 64],
  ['R2L1ContourScape', 3, 0, 2, 0],
  ['R2L1Scape1KeyTrack', 3, -64, 63, 0],
  ['R2L1Scape2KeyTrack', 3, -64, 63, 0],
  ['R2L1Scape1LfoDepth', 3, -64, 63, 0],
  ['R2L1Scape2LfoDepth', 3, -64, 63, 0],
  ['R2L1Scape1VelocityDepth', 3, -64, 63, 0],
  ['R2L1Scape2VelocityDepth', 3, -64, 63, 0],
  ['R2L1ScapeStickPlayback', 3, 1, 2, 0],
  ['R2L2Sphere1Value', 3, 0, 127, 64],
  ['R2L2Sphere2Value', 3, 0, 127, 64],
  ['R2L2ContourSphere', 3, 0, 2, 0],
  ['R2L2Sphere1KeyTrack', 3, -64, 63, 0],
  ['R2L2Sphere2KeyTrack', 3, -64, 63, 0],
  ['R2L2Sphere1LfoDepth', 3, -64, 63, 0],
  ['R2L2Sphere2LfoDepth', 3, -64, 63, 0],
  ['R2L2Sphere1VelocityDepth', 3, -64, 63, 0],
  ['R2L2Sphere2VelocityDepth', 3, -64, 63, 0],
  ['R2L2SphereStickPlayback', 3, 1, 2, 0],
  ['R2L2Scape1Value', 3, 0, 127, 64],
  ['R2L2Scape2Value', 3, 0, 127, 64],
  ['R2L2ContourScape', 3, 0, 2, 0],
  ['R2L2Scape1KeyTrack', 3, -64, 63, 0],
  ['R2L2Scape2KeyTrack', 3, -64, 63, 0],
  ['R2L2Scape1LfoDepth', 3, -64, 63, 0],
  ['R2L2Scape2LfoDepth', 3, -64, 63, 0],
  ['R2L2Scape1VelocityDepth', 3, -64, 63, 0],
  ['R2L2Scape2VelocityDepth', 3, -64, 63, 0],
  ['R2L2ScapeStickPlayback', 3, 1, 2, 0],
  ['R2L3Sphere1Value', 3, 0, 127, 64],
  ['R2L3Sphere2Value', 3, 0, 127, 64],
  ['R2L3ContourSphere', 3, 0, 2, 0],
  ['R2L3Sphere1KeyTrack', 3, -64, 63, 0],
  ['R2L3Sphere2KeyTrack', 3, -64, 63, 0],
  ['R2L3Sphere1LfoDepth', 3, -64, 63, 0],
  ['R2L3Sphere2LfoDepth', 3, -64, 63, 0],
  ['R2L3Sphere1VelocityDepth', 3, -64, 63, 0],
  ['R2L3Sphere2VelocityDepth', 3, -64, 63, 0],
  ['R2L3SphereStickPlayback', 3, 1, 2, 0],
  ['R2L3Scape1Value', 3, 0, 127, 64],
  ['R2L3Scape2Value', 3, 0, 127, 64],
  ['R2L3ContourScape', 3, 0, 2, 0],
  ['R2L3Scape1KeyTrack', 3, -64, 63, 0],
  ['R2L3Scape2KeyTrack', 3, -64, 63, 0],
  ['R2L3Scape1LfoDepth', 3, -64, 63, 0],
  ['R2L3Scape2LfoDepth', 3, -64, 63, 0],
  ['R2L3Scape1VelocityDepth', 3, -64, 63, 0],
  ['R2L3Scape2VelocityDepth', 3, -64, 63, 0],
  ['R2L3ScapeStickPlayback', 3, 1, 2, 0],
  ['R1ResEnvA', 2, 0, 127, 0],
  ['R1ResEnvD', 2, 0, 127, 0],
  ['R1ResEnvS', 2, 0, 127, 127],
  ['R1ResEnvR', 2, 0, 127, 0],
  ['R1ResEnvMode', 2, 0, 1, 0],
  ['R1ParaEnvVelocityDepth', 2, -64, 63, 0],
  ['R1L1Scape1EnvDepth', 2, -64, 63, 0],
  ['R1L1Scape2EnvDepth', 2, -64, 63, 0],
  ['R1L1Sphere1EnvDepth', 2, -64, 63, 0],
  ['R1L1Sphere2EnvDepth', 2, -64, 63, 0],
  ['R1L2Scape1EnvDepth', 2, -64, 63, 0],
  ['R1L2Scape2EnvDepth', 2, -64, 63, 0],
  ['R1L2Sphere1EnvDepth', 2, -64, 63, 0],
  ['R1L2Sphere2EnvDepth', 2, -64, 63, 0],
  ['R1L3Scape1EnvDepth', 2, -64, 63, 0],
  ['R1L3Scape2EnvDepth', 2, -64, 63, 0],
  ['R1L3Sphere1EnvDepth', 2, -64, 63, 0],
  ['R1L3Sphere2EnvDepth', 2, -64, 63, 0],
  ['R1AmpEnvA', 2, 0, 127, 0],
  ['R1AmpEnvD', 2, 0, 127, 0],
  ['R1AmpEnvS', 2, 0, 127, 127],
  ['R1AmpEnvR', 2, 0, 127, 0],
  ['R1AmpEnvMode', 2, 0, 1, 0],
  ['R1FreeEnvA', 2, 0, 127, 0],
  ['R1FreeEnvD', 2, 0, 127, 0],
  ['R1FreeEnvS', 2, 0, 127, 127],
  ['R1FreeEnvR', 2, 0, 127, 0],
  ['R1FreeEnvMode', 2, 0, 1, 0],
  ['R1FreeEnvDepth', 2, 0, 127, 127],
  ['FreeADSR1VelocityDepth', 4, -64, 63, 0],
  ['R2ResEnvA', 3, 0, 127, 0],
  ['R2ResEnvD', 3, 0, 127, 0],
  ['R2ResEnvS', 3, 0, 127, 127],
  ['R2ResEnvR', 3, 0, 127, 0],
  ['R2ResEnvMode', 3, 0, 1, 0],
  ['R2ParaEnvVelocityDepth', 3, -64, 63, 0],
  ['R2L1Scape1EnvDepth', 3, -64, 63, 0],
  ['R2L1Scape2EnvDepth', 3, -64, 63, 0],
  ['R2L1Sphere1EnvDepth', 3, -64, 63, 0],
  ['R2L1Sphere2EnvDepth', 3, -64, 63, 0],
  ['R2L2Scape1EnvDepth', 3, -64, 63, 0],
  ['R2L2Scape2EnvDepth', 3, -64, 63, 0],
  ['R2L2Sphere1EnvDepth', 3, -64, 63, 0],
  ['R2L2Sphere2EnvDepth', 3, -64, 63, 0],
  ['R2L3Scape1EnvDepth', 3, -64, 63, 0],
  ['R2L3Scape2EnvDepth', 3, -64, 63, 0],
  ['R2L3Sphere1EnvDepth', 3, -64, 63, 0],
  ['R2L3Sphere2EnvDepth', 3, -64, 63, 0],
  ['R2AmpEnvA', 3, 0, 127, 0],
  ['R2AmpEnvD', 3, 0, 127, 0],
  ['R2AmpEnvS', 3, 0, 127, 127],
  ['R2AmpEnvR', 3, 0, 127, 0],
  ['R2AmpEnvMode', 3, 0, 1, 0],
  ['R2FreeEnvA', 3, 0, 127, 0],
  ['R2FreeEnvD', 3, 0, 127, 0],
  ['R2FreeEnvS', 3, 0, 127, 127],
  ['R2FreeEnvR', 3, 0, 127, 0],
  ['R2FreeEnvMode', 3, 0, 1, 0],
  ['R2FreeEnvDepth', 3, 0, 127, 127],
  ['FreeADSR2VelocityDepth', 4, -64, 63, 0],
  ['FreeEnvLevel1', 4, -64, 63, 0],
  ['FreeEnvLevel2', 4, -64, 63, 0],
  ['FreeEnvLevel3', 4, -64, 63, 0],
  ['FreeEnvLevel4', 4, -64, 63, 0],
  ['FreeEnvTime1', 4, 0, 127, 0],
  ['FreeEnvTime2', 4, 0, 127, 0],
  ['FreeEnvTime3', 4, 0, 127, 0],
  ['FreeEnvTime4', 4, 0, 127, 0],
  ['TLFreeEnvMode', 4, 0, 1, 0],
  ['TLFreeEnvDepth', 4, 0, 127, 127],
  ['Free4Level4TimeVelocityDepth', 4, -64, 63, 0],
  ['Shaper12Status', 4, 0, 2, 1],
  ['FreeEnvType', 4, 0, 1, 0],
  ['ShaperResySelect', 4, 0, 5, 1],
  ['LFOSwitch', 4, 0, 1, 0],
  ['LFODepth', 4, 0, 127, 0],
  ['LFORate', 4, 0, 1000, 0],
  ['LFODelay', 4, -64, 63, 0],
  ['LFOWaveForm', 4, 0, 11, 0],
  ['BlenderType', 4, 0, 9, 0],
  ['BlenderAmount', 4, -64, 63, 0],
  ['BlenderLfoDepth', 4, -64, 63, 0],
  ['BlenderFreeADSR1Depth', 4, -64, 63, 0],
  ['BlenderFreeADSR2Depth', 4, -64, 63, 0],
  ['BlenderFree4L4TDepth', 4, 0, 127, 0],
  ['SlicerSwitchType', 4, 0, 2, 0],
  ['SlicerDepth', 4, 0, 127, 0],
  ['SlicerRate', 4, 0, 200, 0],
  ['SlicerWaveForm', 4, 0, 11, 0],
  ['SilverSwitch', 4, 0, 1, 0],
  ['SilverParamLevel', 4, 0, 2, 0],
  ['FilterType', 4, 0, 4, 0],
  ['FilterFreq', 4, 0, 127, 127],
  ['FilterReso', 4, 0, 127, 0],
  ['FilterLfoDepth', 4, -64, 63, 0],
  ['FilterKeyTrack', 4, -64, 63, 0],
  ['FilterCutoffVelocityDepth', 4, -64, 63, 0],
  ['SilverL1Contour', 4, 0, 2, 1],
  ['SilverL1StickPlayback', 4, 1, 2, 0],
  ['FreqFXSwitch', 4, 0, 1, 0],
  ['CurFreqFX', 4, 0, 4, 0],
  ['SilverL2Contour', 4, 0, 2, 1],
  ['SilverL2StickPlayback', 4, 1, 2, 0],
  ['EQ_Switch', 4, 0, 1, 0],
  ['EQ_LowShelfSwitch', 4, 0, 1, 0],
  ['EQ_LowShelfGain', 4, -48, 48, 0],
  ['EQ_LowShelfFreq', 4, 0, 127, 75],
  ['EQ_LowShelfSlope', 4, 1, 100, 0],
  ['EQ_Band1Switch', 4, 0, 1, 0],
  ['EQ_Band1Gain', 4, -48, 48, 0],
  ['EQ_Band1Freq', 4, 0, 127, 75],
  ['EQ_Band1Q', 4, 1, 100, 0],
  ['EQ_Band2Switch', 4, 0, 1, 0],
  ['EQ_Band2Gain', 4, -48, 48, 0],
  ['EQ_Band2Freq', 4, 0, 127, 75],
  ['EQ_Band2Q', 4, 1, 100, 0],
  ['EQ_HighShelfSwitch', 4, 0, 1, 0],
  ['EQ_HighShelfGain', 4, -48, 48, 0],
  ['EQ_HighShelfFreq', 4, 0, 127, 75],
  ['EQ_HighShelfSlope', 4, 1, 100, 0],
  ['CR_Switch', 4, 0, 1, 0],
  ['CR_Threshold', 4, -48, 0, 0],
  ['CR_OutGain', 4, 0, 120, 0],
  ['CR_Responsiveness', 4, 0, 127, 0],
  ['DS_InGain', 4, 0, 127, 64],
  ['DS_PreFilter', 4, 0, 127, 0],
  ['DS_ClipCurveType', 4, 0, 5, 0],
  ['DS_OutGain', 4, 0, 127, 64],
  ['RM_Mix', 4, 0, 127, 0],
  ['RM_Speed', 4, 0, 200, 0],
  ['RM_Depth', 4, 0, 127, 0],
  ['RM_WaveForm', 4, 0, 11, 0],
  ['RM_ModFreq', 4, 0, 127, 0],
  ['RM_XoverDelay', 4, 0, 127, 0],
  ['RM_XoverTime', 4, 0, 1000, 0],
  ['RM_XoverDelayFeedback', 4, -64, 63, 0],
  ['SW_Mix', 4, 0, 127, 0],
  ['SW_Frequency', 4, 0, 127, 0],
  ['SW_Tilt', 4, 0, 127, 0],
  ['SW_Damping', 4, 0, 127, 0],
  ['SW_Speed', 4, 0, 200, 0],
  ['SW_Depth', 4, 0, 127, 0],
  ['DC_Mix', 4, 0, 127, 0],
  ['DC_SHFactor', 4, 0, 127, 0],
  ['DC_PreFilterCutoff', 4, 0, 127, 0],
  ['TimeFXSwitch', 4, 0, 1, 0],
  ['CurTimeFX', 4, 0, 4, 0],
  ['SilverL3Contour', 4, 0, 2, 1],
  ['SilverL3StickPlayback', 4, 1, 2, 0],
  ['SS_ChanDelay', 4, -64, 63, 0],
  ['SS_Feedback', 4, -64, 63, 0],
  ['LRD_Mix', 4, 0, 127, 0],
  ['LRD_Time', 4, 0, 1000, 0],
  ['LRD_Feedback', 4, -64, 63, 0],
  ['FL_Mix', 4, 0, 127, 0],
  ['FL_Depth', 4, 0, 127, 0],
  ['FL_Speed', 4, 0, 200, 0],
  ['FL_WaveForm', 4, 0, 11, 0],
  ['FL_Feedback', 4, -64, 63, 0],
  ['FL_StereoPhase', 4, -64, 63, 0],
  ['PH_Mix', 4, 0, 127, 0],
  ['PH_Depth', 4, 0, 127, 0],
  ['PH_Speed', 4, 0, 200, 0],
  ['PH_WaveForm', 4, 0, 11, 0],
  ['PH_Feedback', 4, -64, 63, 0],
  ['PH_StereoPhase', 4, -64, 63, 0],
  ['CH_Mix', 4, 0, 127, 0],
  ['CH_Depth', 4, 0, 127, 0],
  ['CH_Speed', 4, 0, 200, 0],
  ['CH_WaveForm', 4, 0, 11, 0],
  ['CH_Feedback', 4, -64, 63, 0],
  ['CH_StereoPhase', 4, -64, 63, 0],
  ['CH_PreDelay', 4, 0, 127, 0],
  ['FilterEnvA', 4, 0, 127, 0],
  ['FilterEnvD', 4, 0, 127, 0],
  ['FilterEnvS', 4, 0, 127, 0],
  ['FilterEnvR', 4, 0, 127, 0],
  ['FilterEnvMode', 4, 0, 1, 0],
  ['FilterEnvDepth', 4, -64, 63, 0],
  ['FilterEnvVelocityDepth', 4, -64, 63, 0],
  ['Shaper3Status', 4, 0, 1, 1],
  ['AftertouchDest1', 4, 3000, 3130, 3000],
  ['AftertouchDest2', 4, 3000, 3130, 3000],
  ['AftertouchDest3', 4, 3000, 3130, 3000],
  ['AftertouchDest4', 4, 3000, 3130, 3000],
  ['AftertouchDestDepth1', 4, -64, 63, 63],
  ['AftertouchDestDepth2', 4, -64, 63, 63],
  ['AftertouchDestDepth3', 4, -64, 63, 63],
  ['AftertouchDestDepth4', 4, -64, 63, 63],
  ['Controller1UpDest1', 4, 3000, 3130, 3000],
  ['Controller1UpDest2', 4, 3000, 3130, 3000],
  ['Controller1UpDest3', 4, 3000, 3130, 3000],
  ['Controller1UpDest4', 4, 3000, 3130, 3000],
  ['Controller1UpDestDepth1', 4, -64, 63, 63],
  ['Controller1UpDestDepth2', 4, -64, 63, 63],
  ['Controller1UpDestDepth3', 4, -64, 63, 63],
  ['Controller1UpDestDepth4', 4, -64, 63, 63],
  ['Controller1DnDest1', 4, 3000, 3130, 3000],
  ['Controller1DnDest2', 4, 3000, 3130, 3000],
  ['Controller1DnDest3', 4, 3000, 3130, 3000],
  ['Controller1DnDest4', 4, 3000, 3130, 3000],
  ['Controller1DnDestDepth1', 4, -64, 63, 63],
  ['Controller1DnDestDepth2', 4, -64, 63, 63],
  ['Controller1DnDestDepth3', 4, -64, 63, 63],
  ['Controller1DnDestDepth4', 4, -64, 63, 63],
  ['Controller2Dest1', 4, 3000, 3130, 3000],
  ['Controller2Dest2', 4, 3000, 3130, 3000],
  ['Controller2Dest3', 4, 3000, 3130, 3000],
  ['Controller2Dest4', 4, 3000, 3130, 3000],
  ['Controller2DestDepth1', 4, -64, 63, 63],
  ['Controller2DestDepth2', 4, -64, 63, 63],
  ['Controller2DestDepth3', 4, -64, 63, 63],
  ['Controller2DestDepth4', 4, -64, 63, 63],
  ['Controller3Dest1', 4, 3000, 3130, 3000],
  ['Controller3Dest2', 4, 3000, 3130, 3000],
  ['Controller3Dest3', 4, 3000, 3130, 3000],
  ['Controller3Dest4', 4, 3000, 3130, 3000],
  ['Controller3DestDepth1', 4, -64, 63, 63],
  ['Controller3DestDepth2', 4, -64, 63, 63],
  ['Controller3DestDepth3', 4, -64, 63, 63],
  ['Controller3DestDepth4', 4, -64, 63, 63],
  ['Controller4Dest1', 4, 3000, 3130, 3000],
  ['Controller4Dest2', 4, 3000, 3130, 3000],
  ['Controller4Dest3', 4, 3000, 3130, 3000],
  ['Controller4Dest4', 4, 3000, 3130, 3000],
  ['Controller4DestDepth1', 4, -64, 63, 63],
  ['Controller4DestDepth2', 4, -64, 63, 63],
  ['Controller4DestDepth3', 4, -64, 63, 63],
  ['Controller4DestDepth4', 4, -64, 63, 63],
  ['FootSwitchDest', 4, 0, 26, 0],
  ['PitchBendRange', 4, 0, 12, 2],
  ['AftertouchDest', 4, 0, 62, 61],
  ['AftertouchDepth', 4, -64, 63, 0],
  ['ModulationDest', 4, 0, 62, 59],
  ['ModulationDepth', 4, -64, 63, 0],
  ['BreathDest', 4, 0, 62, 56],
  ['BreathDepth', 4, -64, 63, 0],
  ['CC03Dest', 4, 0, 62, 57],
  ['CC03Depth', 4, -64, 63, 0],
  ['FootDest', 4, 0, 62, 14],
  ['FootDepth', 4, -64, 63, 0],
  ['ExpressionDest', 4, 0, 62, 0],
  ['ExpressionDepth', 4, -64, 63, 0],
  ['Knob1R1Select', 4, 0, 62, 61],
  ['Knob2R1Select', 4, 0, 62, 56],
  ['Knob3R1Select', 4, 0, 62, 32],
  ['Knob4R1Select', 4, 0, 62, 62],
  ['SlicerSwitchBackup', 4, 0, 2, 0],
  ['SoundMFXSwitch', 5, 0, 1, 0],
  ['SoundMFXDelaySwitch', 5, 0, 1, 0],
  ['SoundMFXDelayMix', 5, 0, 127, 0],
  ['SoundMFXDelayLTime', 5, 0, 1000, 0],
  ['SoundMFXDelayRTime', 5, 0, 1000, 0],
  ['SoundMFXDelayFeedback', 5, -64, 63, 0],
  ['SoundMFXDelayFdbkDamp', 5, 0, 127, 0],
  ['SoundMFXReverbSwitch', 5, 0, 1, 0],
  ['SoundMFXReverbMix', 5, 0, 127, 0],
  ['SoundMFXReverbRoom', 5, 0, 4, 0],
  ['SoundMFXRevDecayTime', 5, 0, 127, 0],
  ['SoundMFXRevDiffusion', 5, 0, 127, 0],
  ['SoundMFXRevHFDamp', 5, 0, 127, 0],
  ['SoundMFXRevDetune', 5, 0, 127, 0],
  ['SoundMFXRevSpeed', 5, 0, 200, 0],
];

/**
 * The canonical 445-parameter schema of `NeuronVS.dll` (`0x10049f08`).
 */
export const NEURON_SOUND_SCHEMA: readonly SoundParamField[] = RAW_SCHEMA_TUPLES.map(
  ([key, groupIdx, min, max, defaultValue], index) => ({
    index,
    key,
    group: GROUP_NAMES[groupIdx] ?? 'Synth',
    min,
    max,
    defaultValue,
  })
);

const SCHEMA_BY_KEY = new Map<string, SoundParamField>(
  NEURON_SOUND_SCHEMA.map((f) => [f.key, f])
);

/**
 * Decodes the 16-character preset name from `SoundNameC00..SoundNameC15`.
 */
export function decodeSoundPresetName(values: ReadonlyMap<string, number>): string {
  let out = '';
  for (let i = 0; i < 16; i++) {
    const key = `SoundNameC${String(i).padStart(2, '0')}`;
    const code = Math.trunc(values.get(key) ?? 32);
    const ch = code >= 32 && code <= 126 ? String.fromCharCode(code) : ' ';
    out += ch;
  }
  return out.replace(/ +$/g, '');
}

/**
 * Encodes a preset name (up to 16 ASCII characters, padded with spaces `32`)
 * into `SoundNameC00..SoundNameC15`.
 */
export function encodeSoundPresetName(
  values: Map<string, number>,
  name: string
): void {
  const clean = name.slice(0, 16).padEnd(16, ' ');
  for (let i = 0; i < 16; i++) {
    const key = `SoundNameC${String(i).padStart(2, '0')}`;
    const code = clean.charCodeAt(i);
    const clamped = Math.max(32, Math.min(122, code));
    values.set(key, clamped);
  }
}

/**
 * Parses a `sound.script` text buffer (matching `FUN_10001910` + `FUN_10013ea0` v1 migration).
 */
export function parseSoundScript(text: string): ParsedSoundPreset {
  const values = new Map<string, number>();
  for (const field of NEURON_SOUND_SCHEMA) {
    values.set(field.key, field.defaultValue);
  }

  const unknownKeys: [string, number][] = [];
  const lines = text.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;

    const key = parts[0];
    const val = parseFloat(parts[1]);
    if (!Number.isFinite(val)) continue;

    if (SCHEMA_BY_KEY.has(key)) {
      values.set(key, val);
    } else {
      unknownKeys.push([key, val]);
    }
  }

  // Version 1 migration (`FUN_10013ea0`: if SoundVersionMajor < 2.0, BlenderAmount -= 64.0)
  const verMajor = values.get('SoundVersionMajor') ?? 2;
  if (verMajor < 2) {
    const blender = values.get('BlenderAmount') ?? 0;
    values.set('BlenderAmount', blender - 64);
  }

  const name = decodeSoundPresetName(values);

  return {
    name,
    versionMajor: Math.trunc(values.get('SoundVersionMajor') ?? 2),
    versionMinor: Math.trunc(values.get('SoundVersionMinor') ?? 0),
    versionBuild: Math.trunc(values.get('SoundVersionBuild') ?? 0),
    numVoices: Math.trunc(values.get('SoundNumVoices') ?? 4),
    r1ModelIndex: Math.trunc(values.get('R1ModellIndex') ?? 511),
    r2ModelIndex: Math.trunc(values.get('R2ModellIndex') ?? 511),
    r1Switch: (values.get('R1Switch') ?? 1) !== 0,
    r2Switch: (values.get('R2Switch') ?? 0) !== 0,
    values,
    unknownKeys,
  };
}

/**
 * Serializes a `ParsedSoundPreset` into the canonical 445-line CRLF `sound.script` format
 * (`FUN_10001af0` + `FUN_100014c0` clamping to `[min, max]` and truncation toward zero).
 */
export function serializeSoundScript(preset: ParsedSoundPreset): string {
  const lines: string[] = [];

  for (const field of NEURON_SOUND_SCHEMA) {
    const rawVal = preset.values.get(field.key) ?? field.defaultValue;
    const clamped = Math.max(field.min, Math.min(field.max, rawVal));
    const truncated = Math.trunc(clamped);
    lines.push(`${field.key}\t${truncated}`);
  }

  return lines.join('\r\n') + '\r\n';
}

/**
 * Creates a canonical `.sound` preset initialized for a specific Model slot (`0..511`).
 */
export function createSoundPresetForModel(options: {
  name: string;
  r1ModelIndex: number;
  r2ModelIndex?: number;
  r2Switch?: boolean;
  numVoices?: number;
}): ParsedSoundPreset {
  const values = new Map<string, number>();
  for (const field of NEURON_SOUND_SCHEMA) {
    // Clamp initial defaults to [min, max] so the 19 out-of-range 0 defaults become 1
    const clampedDefault = Math.max(field.min, Math.min(field.max, field.defaultValue));
    values.set(field.key, clampedDefault);
  }

  encodeSoundPresetName(values, options.name);
  const r1Idx = Math.max(0, Math.min(511, Math.trunc(options.r1ModelIndex)));
  const r2Idx = Math.max(
    0,
    Math.min(511, Math.trunc(options.r2ModelIndex ?? options.r1ModelIndex))
  );
  const voices = Math.max(1, Math.min(32, Math.trunc(options.numVoices ?? 8)));
  const r2Enabled = options.r2Switch ?? false;

  values.set('SoundNumVoices', voices);
  values.set('R1ModellIndex', r1Idx);
  values.set('R1Switch', 1);
  values.set('R2ModellIndex', r2Idx);
  values.set('R2Switch', r2Enabled ? 1 : 0);

  return {
    name: decodeSoundPresetName(values),
    versionMajor: 2,
    versionMinor: 0,
    versionBuild: 0,
    numVoices: voices,
    r1ModelIndex: r1Idx,
    r2ModelIndex: r2Idx,
    r1Switch: true,
    r2Switch: r2Enabled,
    values,
    unknownKeys: [],
  };
}

// ── sound.stickrec Parser & Writer ──────────────────────

/**
 * Parses a `sound.stickrec` text file (9-character uppercase hex lines `TTTTFCVVV`).
 */
export function parseStickRec(text: string): StickRecEvent[] {
  const events: StickRecEvent[] = [];
  const lines = text.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length !== 9 || !/^[0-9A-Fa-f]{9}$/.test(line)) continue;
    const time = parseInt(line.slice(0, 4), 16);
    const flag = parseInt(line.slice(4, 5), 16);
    const control = parseInt(line.slice(5, 6), 16);
    const value = parseInt(line.slice(6, 9), 16);
    events.push({ time, flag, control, value });
  }

  return events;
}

/**
 * Serializes `StickRecEvent[]` into `sound.stickrec` 9-hex-character CRLF lines.
 */
export function serializeStickRec(events: readonly StickRecEvent[]): string {
  if (events.length === 0) return '';
  const lines = events.map((ev) => {
    const t = (ev.time & 0xffff).toString(16).toUpperCase().padStart(4, '0');
    const f = (ev.flag & 0x0f).toString(16).toUpperCase();
    const c = (ev.control & 0x0f).toString(16).toUpperCase();
    const v = (ev.value & 0x0fff).toString(16).toUpperCase().padStart(3, '0');
    return `${t}${f}${c}${v}`;
  });
  return lines.join('\r\n') + '\r\n';
}

// ── SoundNames Cache (`NeuronDB/SoundNames`) ────────────

/**
 * Parses `NeuronDB/SoundNames` cache file (1000 entries: `%03d\t%16s`).
 */
export function parseSoundNamesCache(text: string): Map<number, string> {
  const map = new Map<number, string>();
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = /^(\d{3})\t(.*)$/.exec(trimmed);
    if (match) {
      const slot = parseInt(match[1], 10);
      const name = match[2].trim().slice(0, 16);
      if (slot >= 0 && slot < 1000) {
        map.set(slot, name);
      }
    }
  }
  return map;
}

/**
 * Serializes `NeuronDB/SoundNames` cache file (1000 slots `000..999`, default `InitSound`).
 */
export function serializeSoundNamesCache(
  namesBySlot: ReadonlyMap<number, string>
): string {
  const lines: string[] = [];
  for (let slot = 0; slot < 1000; slot++) {
    const rawName = namesBySlot.get(slot) ?? 'InitSound';
    const trimmed = rawName.slice(0, 16).padStart(16, ' ');
    lines.push(`${String(slot).padStart(3, '0')}\t${trimmed}`);
  }
  return lines.join('\r\n') + '\r\n';
}
