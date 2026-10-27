// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — WebAudioPipeline
//
// Real TypeScript implementation of CoreService.
// Replaces MockCore with:
//   - Native RIFF/WAVE decoder (PCM 8/16/24/32-bit + IEEE Float 32/64-bit)
//   - 8192-point Radix-2 FFT / STFT with Blackman-Harris / Hanning / Blackman windows
//   - Harmonic peak-picking, HPS + 2-pass Least-Squares F0 fitting, & octave-fold gate
//   - Envelope-shape & interlaced sub-grid layer clustering (up to 3 layers)
//   - Scape/Sphere frame generation & canonical .neuronikmodel (v2/v2.1) serialization
//   - Non-blocking Web Worker execution with main-thread fallback
//   - Web Audio API real-time sample & resynthesis auditioning
// ─────────────────────────────────────────────────────────

import type { CoreService, CoreEventListener } from './CoreService.ts';
import type {
  Session,
  Zone,
  ProcessConfig,
  ProcessProgress,
  GeneratedModel,
  BankSummary,
  ParameterSetInfo,
  CoreEvent,
  MidiNote,
  ZoneAnalysisSummary,
  ZoneSpectralInspection,
  SpectralPartialTrack,
  HistoryState,
} from './types.ts';
import {
  decodeWav,
  encodePcm16Wav,
  encodeAiffPcm16,
  resampleAudioChannel,
  synthesizeDemoWav,
  type DecodedWav,
} from './dsp/WavDecoder.ts';
import {
  analyzeSingleZone,
  runMultiZonePipeline,
  type ZoneWavPayload,
  type ZoneBinaryPair,
  type PreservedSourceBinary,
} from './dsp/PipelineRunner.ts';
import { SpectralAnalyzer } from './dsp/SpectralAnalyzer.ts';
import { computeStft } from './dsp/FftEngine.ts';
import { buildLayerView } from './dsp/GridIndicator.ts';
import {
  complexityToLimits,
  resynthesizeModelToPcm,
} from './dsp/ScapeSphereGenerator.ts';
import {
  buildModelExportZip,
  parseModelFileSet,
  convertLegacyModelToModern,
  resynthesizeNeuronModelSource,
} from '../formats/ModelFormat.ts';
import type {
  WorkerInboundMessage,
  WorkerOutboundMessage,
} from './worker/analysisWorker.ts';

let zoneIdCounter = 0;
function nextZoneId(): string {
  return `zone-${++zoneIdCounter}-${Date.now().toString(36)}`;
}

const STORAGE_SESSION_KEY = 'abd_neumodmakr_session_v1';
const STORAGE_BANK_KEY = 'abd_neumodmakr_bank_v1';

/**
 * The 10 official Parameter Sets from the Hartmann Neuron MODELmaker v1.2 manual
 * (`MM_user_manual_E_0703.pdf`, pages 13–27) and `NASAnalysis.dll` (`FUN_100028e0` / `FUN_10001880`).
 */
export const PARAMETER_SETS: ParameterSetInfo[] = [
  { id: 0, name: 'Default Set',      description: 'Neutral set (Torsion/HiTurbul/SmallBdy/Stringed) suitable for all sounds', category: 'General' },
  { id: 1, name: 'Stringed / Bowed', description: 'Rough/Smooth & Simple/Complex Corpus for stringed and bowed instruments', category: 'Strings' },
  { id: 2, name: 'Plucked & Bells',  description: 'PluckNoise/AttkTens & Percussn/Decaying for hammered, plucked, or bells', category: 'Plucked' },
  { id: 3, name: 'Plucked & Picked', description: 'Subtler PluckNoise/MatrSoft & StrTensn/PlckType for guitars and E-pianos', category: 'Plucked' },
  { id: 4, name: 'Carpet Shop',      description: 'Glass/Stiffness & Stationary/Corpus Intensity for dense orchestral pads', category: 'Pads' },
  { id: 5, name: 'Piano etc.',       description: 'StrMetal/HamMetal/FramWood & CrpMetal/CorpWood for pianos and strings', category: 'Keys' },
  { id: 6, name: 'Woodwinds',        description: 'String/Air & Overblow/Hollow/Vibrato for woodwinds, organs, and leads', category: 'Wind' },
  { id: 7, name: 'Extreme Pads',     description: 'Character/Liquified/Alienized & ColorHi/TapSync for morphing choir/pads', category: 'Pads' },
  { id: 8, name: 'Loop Factory',     description: 'SpdConst/PitchVar/OrangeNs & EQ/Static/Comb for real-time loop stretching', category: 'Loops' },
  { id: 9, name: 'Multipurpose',     description: 'BodyAmnt/BdyColor/CorpOpen & CrpSmall/CrpMatrl for acoustic body shaping', category: 'General' },
];

const INITIAL_PRESETS = [
  { slot: 0,  name: 'DangerDrone',    modelIndex: 511, category: 'Pad',     parameterCount: 445 },
  { slot: 1,  name: 'SilkStrings',    modelIndex: 0,   category: 'Strings', parameterCount: 445 },
  { slot: 2,  name: 'GlassKeys',      modelIndex: 1,   category: 'Keys',    parameterCount: 445 },
  { slot: 3,  name: 'WarmBass',       modelIndex: 2,   category: 'Bass',    parameterCount: 445 },
  { slot: 4,  name: 'NeuralPad',      modelIndex: 0,   category: 'Pad',     parameterCount: 445 },
  { slot: 5,  name: 'MetalBell',      modelIndex: 3,   category: 'Bell',    parameterCount: 445 },
  { slot: 6,  name: 'AirTexture',     modelIndex: 1,   category: 'Texture', parameterCount: 445 },
  { slot: 7,  name: 'DeepResonance',  modelIndex: 2,   category: 'Bass',    parameterCount: 445 },
  { slot: 8,  name: 'CrystalArp',     modelIndex: 0,   category: 'Arp',     parameterCount: 445 },
  { slot: 9,  name: 'VocalMorph',     modelIndex: 4,   category: 'Vocal',   parameterCount: 445 },
  { slot: 10, name: 'OrganicPulse',   modelIndex: 3,   category: 'Rhythm',  parameterCount: 445 },
  { slot: 11, name: 'FrozenChoir',    modelIndex: 1,   category: 'Pad',     parameterCount: 445 },
];

function createZone(
  low: MidiNote,
  root: MidiNote,
  high: MidiNote,
  sampleLow: string | null = null
): Zone {
  return {
    id: nextZoneId(),
    lowKey: low,
    rootKey: root,
    highKey: high,
    sampleLow,
    sampleHigh: null,
    velSplit: 64,
    detune: 0,
    volume: 0,
    pan: 0,
  };
}

function createInitialSession(name: string): Session {
  const now = new Date().toISOString();
  return {
    id: `session-${Date.now().toString(36)}`,
    name,
    zones: [createZone(0, 60, 127, null)],
    processConfig: {
      modelNumber: 0,
      modelName: 'NewModel',
      complexity: 8,
      parameterSet: 0,
      targetFormat: 'dual',
    },
    dirty: false,
    createdAt: now,
    modifiedAt: now,
  };
}

export interface ParsedSampleFilename {
  sampleName: string;
  rootKey: MidiNote;
  lowKey: MidiNote;
  velocityLayer: 1 | 2;
  isHighVelocity: boolean;
}

/**
 * Extracts MIDI rootKey, lowKey, and velocity layer (`1` = Low Vel, `2` = High Vel)
 * from a sample filename using both:
 *   1. The official Hartmann MODELmaker `Import by Name` (`NC_HARTMANN`) convention:
 *      `name_rootkey_lowkey[.ext]` or `name_rootkey_lowkey_v1[.ext]` / `name_rootkey_lowkey_v2[.ext]`
 *      (e.g. `Flute_72_68.aif`, `Flute_72_68_v1.aif`, `Flute_72_68_v2.aif`)
 *   2. Modern / manual patterns like `12 String Gtr-E2_high.aif`, `Piano_C3.wav`, `Bass_36_v2.wav`.
 */
export function parseSampleFilenameByName(
  filename: string,
  fallbackRoot: MidiNote = 60
): ParsedSampleFilename {
  const base = (filename.split(/[\\/]/).pop() ?? filename).replace(/\.[^.]+$/, '');
  const lower = base.toLowerCase();

  let velocityLayer: 1 | 2 = 1;
  if (/(?:[_\-\s](?:v2|high|hi|vel2|ff))$/i.test(lower)) {
    velocityLayer = 2;
  } else if (/(?:[_\-\s](?:v1|low|lo|vel1|pp))$/i.test(lower)) {
    velocityLayer = 1;
  }

  // 1. Check strict Hartmann `name_rootkey_lowkey[_v1|_v2]` numeric convention (`KeyZoneData.createKeyZoneFromFileByName`)
  const tokens = base.split('_');
  if (tokens.length >= 3) {
    const r = parseInt(tokens[1], 10);
    const l = parseInt(tokens[2], 10);
    if (!Number.isNaN(r) && r >= 0 && r <= 127 && !Number.isNaN(l) && l >= 0 && l <= 127) {
      if (tokens[3]) {
        const vTok = tokens[3].toLowerCase();
        if (vTok === 'v2' || vTok === 'high') velocityLayer = 2;
        else if (vTok === 'v1' || vTok === 'low') velocityLayer = 1;
      }
      return {
        sampleName: filename,
        rootKey: r,
        lowKey: l,
        velocityLayer,
        isHighVelocity: velocityLayer === 2,
      };
    }
  }

  // 2. Fallback to note name or single MIDI number
  const rootKey = parseRootKeyFromFilename(filename, fallbackRoot);
  return {
    sampleName: filename,
    rootKey,
    lowKey: rootKey,
    velocityLayer,
    isHighVelocity: velocityLayer === 2,
  };
}

/**
 * Extracts a MIDI root key (0..127) from a sample filename if present.
 * Supports patterns like `Piano_60_36.wav`, `Bass_C2.wav`, `Cellos_F#3.wav`, `12 String Gtr-A2.aif`.
 */
export function parseRootKeyFromFilename(filename: string, fallback: MidiNote = 60): MidiNote {
  const base = filename.split(/[\\/]/).pop() ?? filename;

  // 1. Check Hartmann `name_rootkey_lowkey` numeric tokens first
  const hartmannMatch = /^[^_]+_(\d{1,3})_(\d{1,3})(?:_|$|\.)/.exec(base);
  if (hartmannMatch) {
    const rk = parseInt(hartmannMatch[1], 10);
    if (rk >= 0 && rk <= 127) return rk;
  }

  // 2. Check note name pattern like C3, F#4, Bb2, G-2
  const noteMatch = base.match(/(?:^|[_\-\s])([A-Ga-g])([#b]?)(-?\d)(?:[_\-.\s]|$)/);
  if (noteMatch) {
    const letter = noteMatch[1].toUpperCase();
    const accidental = noteMatch[2];
    const octave = parseInt(noteMatch[3], 10);
    const semitoneMap: Record<string, number> = {
      C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
    };
    let semitone = semitoneMap[letter] ?? 0;
    if (accidental === '#') semitone += 1;
    if (accidental === 'b') semitone -= 1;
    const midi = (octave + 1) * 12 + semitone;
    if (midi >= 0 && midi <= 127) return midi;
  }

  // 3. Check numeric MIDI token like _60_ or _60.wav
  const numMatch = base.match(/(?:^|[_\-\s])(\d{1,3})(?:[_\-.\s]|$)/);
  if (numMatch) {
    const val = parseInt(numMatch[1], 10);
    if (val >= 0 && val <= 127) return val;
  }

  return fallback;
}

const DEFAULT_MODEL_NAMES = new Set([
  '',
  'NewModel',
  'Init Model',
  'InitModel',
  'UNTITLED',
  'Default Session',
  'MyModel',
]);

/**
 * Derives a clean model name from an audio sample filename by stripping path, extension,
 * velocity tags (`_v1`, `_v2`, `_low`, `_high`), Hartmann numeric tokens (`_072_068`),
 * and note names (`_C4`, `-E2`).
 */
export function deriveModelNameFromSample(filename: string, maxLen = 11): string {
  const base = (filename.split(/[\\/]/).pop() ?? filename).replace(/\.[^.]+$/, '');
  const cleaned = base
    .replace(/(?:[_\-\s](?:v1|v2|low|lo|high|hi|vel1|vel2|pp|ff))$/i, '')
    .replace(/_\d{1,3}_\d{1,3}$/, '')
    .replace(/(?:[_\-\s][A-Ga-g][#b]?-?\d)$/, '')
    .replace(/(?:[_\-\s]\d{1,3})$/, '')
    .replace(/[\r\n\t]+/g, '')
    .trim();
  const asciiOnly = cleaned.replace(/[^\x20-\x7E]/g, '');
  const candidate = (asciiOnly || base.replace(/[^\x20-\x7E]/g, '') || 'Model').trim();
  return candidate.slice(0, maxLen);
}

export class WebAudioPipeline implements CoreService {
  private session: Session | null = null;
  private readonly listeners: Set<CoreEventListener> = new Set();
  private readonly sampleBuffers: Map<string, ArrayBuffer> = new Map();
  private readonly modelZoneBinaries: Map<number, ZoneBinaryPair[]> = new Map();
  private readonly modelMapScriptVersions: Map<
    number,
    { major: number; minor: number; build: number; lineEnding?: '\r\n' | '\n' }
  > = new Map();
  private readonly importedSourceBinaries: Map<
    string,
    PreservedSourceBinary & { complexity: number }
  > = new Map();
  private readonly analyzer: SpectralAnalyzer = new SpectralAnalyzer();

  private worker: Worker | null = null;
  private isRunning = false;
  private cancelFlag = false;
  private processProgress: ProcessProgress | null = null;
  private audioCtx: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private activeSourceNode: AudioBufferSourceNode | null = null;
  private activeGainNode: GainNode | null = null;
  private activePlaybackMode: 'original' | 'resynthesis' | null = null;
  private readonly spectralCache: Map<
    string,
    { key: string; inspection: ZoneSpectralInspection; resynthMono: Float32Array }
  > = new Map();
  private readonly ribbonEnvelopeCache: Map<string, number[]> = new Map();

  // Phase 5: Undo / Redo Snapshot Stack (Command History)
  private undoStack: {
    label: string;
    snapshotJson: string;
    coalesceKey?: string;
    timestampMs: number;
  }[] = [];
  private redoStack: {
    label: string;
    snapshotJson: string;
    coalesceKey?: string;
    timestampMs: number;
  }[] = [];
  private static readonly MAX_HISTORY = 50;
  private static readonly COALESCE_WINDOW_MS = 450;

  private generatedModels: GeneratedModel[] = [
    {
      slot: 0,
      name: 'Factory000',
      zoneCount: 4,
      complexity: 8,
      parameterSet: 0,
      createdAt: '2003-07-01T00:00:00Z',
      path: 'Models/000.model',
    },
    {
      slot: 511,
      name: 'sinew',
      zoneCount: 1,
      complexity: 8,
      parameterSet: 0,
      createdAt: '2003-07-01T00:00:00Z',
      path: 'Models/511.model',
    },
  ];

  // ── Lifecycle ───────────────────────────────────────────

  public async init(): Promise<void> {
    // Restore persisted session and bank from localStorage if available
    this.restoreFromLocalStorage();
  }

  public dispose(): void {
    this.stopAudition();
    this.terminateWorker();
    if (this.audioCtx) {
      void this.audioCtx.close();
      this.audioCtx = null;
      this.analyserNode = null;
    }
    this.listeners.clear();
  }

  // ── Event bus ───────────────────────────────────────────

  public on(listener: CoreEventListener): void {
    this.listeners.add(listener);
  }

  public off(listener: CoreEventListener): void {
    this.listeners.delete(listener);
  }

  private emit(event: CoreEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener errors to protect pipeline state
      }
    }
  }

  // ── Session ─────────────────────────────────────────────

  public async newSession(name = 'Untitled'): Promise<Session> {
    this.sampleBuffers.clear();
    this.importedSourceBinaries.clear();
    this.ribbonEnvelopeCache.clear();
    this.spectralCache.clear();
    this.session = createInitialSession(name);
    this.clearHistory();
    this.persistToLocalStorage();
    this.emit({ type: 'session-changed', session: this.session });
    return this.session;
  }

  public async loadSession(idOrJson: string): Promise<Session> {
    if (idOrJson.trim().startsWith('{')) {
      return this.loadSessionFromJson(idOrJson);
    }
    this.session = createInitialSession('Hartmann MultiSession');
    this.clearHistory();
    this.session.zones = [
      createZone(0, 24, 35, 'Bass_24_C1.wav'),
      createZone(36, 48, 59, 'Piano_48_C3.wav'),
      createZone(60, 72, 83, 'Strings_72_C5.wav'),
      createZone(84, 96, 107, 'Pad_96_C7.wav'),
      createZone(108, 115, 127, 'Bell_115_G8.wav'),
    ];
    this.session.zones[2].sampleHigh = 'Strings_72_C5_v2.wav';
    this.ensureZoneDemoBuffers(this.session.zones);
    this.persistToLocalStorage();
    this.emit({ type: 'session-changed', session: this.session });
    return this.session;
  }

  public async saveSession(_session: Session): Promise<void> {
    if (this.session) {
      this.session.dirty = false;
      this.session.modifiedAt = new Date().toISOString();
      this.persistToLocalStorage();
      this.emit({ type: 'session-changed', session: this.session });
    }
  }

  /**
   * Serializes the active session into a portable `.nmsession.json` string.
   */
  public exportSessionJson(): string {
    if (!this.session) {
      throw new Error('No active session to export');
    }
    return JSON.stringify(
      {
        magic: 'NEURONMM_SESSION',
        version: '1.2.0',
        exportedAt: new Date().toISOString(),
        session: this.session,
      },
      null,
      2
    );
  }

  /**
   * Restores a session from a `.nmsession.json` string and ensures playable demo buffers
   * exist for any referenced sample names not yet loaded in memory.
   */
  public async loadSessionFromJson(jsonText: string): Promise<Session> {
    const parsed = JSON.parse(jsonText) as {
      session?: Session;
      id?: string;
      name?: string;
      zones?: Zone[];
      processConfig?: ProcessConfig;
    };
    const loaded: Session = parsed.session ?? (parsed as unknown as Session);
    if (!loaded || !Array.isArray(loaded.zones) || loaded.zones.length === 0) {
      throw new Error('Invalid session JSON: missing zones array');
    }

    const newSession: Session = {
      id: loaded.id ?? `session_${Date.now()}`,
      name: loaded.name ?? 'Imported Session',
      zones: loaded.zones.map((z) => ({
        id: z.id ?? nextZoneId(),
        lowKey: Math.max(0, Math.min(127, z.lowKey ?? 0)),
        rootKey: Math.max(0, Math.min(127, z.rootKey ?? 60)),
        highKey: Math.max(0, Math.min(127, z.highKey ?? 127)),
        sampleLow: z.sampleLow ?? null,
        sampleHigh: z.sampleHigh ?? null,
        detune: z.detune ?? 0,
        volume: z.volume ?? 0,
        pan: z.pan ?? 0,
      })),
      processConfig: {
        modelName: loaded.processConfig?.modelName ?? 'MyModel',
        modelNumber: loaded.processConfig?.modelNumber ?? 1,
        parameterSet: loaded.processConfig?.parameterSet ?? 0,
        complexity: loaded.processConfig?.complexity ?? 8,
        targetFormat: loaded.processConfig?.targetFormat ?? 'dual',
      },
      createdAt: loaded.createdAt ?? new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
      dirty: false,
    };

    this.session = newSession;
    this.clearHistory();
    this.ensureZoneDemoBuffers(newSession.zones);
    this.persistToLocalStorage();
    this.emit({ type: 'session-changed', session: newSession });
    return newSession;
  }

  public getSession(): Session | null {
    return this.session;
  }

  // ── Phase 5: Undo / Redo & Config / Coverage Repair ─────

  private clearHistory(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.emit({ type: 'history-changed', history: this.getHistoryState() });
  }

  private pushHistory(label: string, coalesceKey?: string): void {
    if (!this.session) return;
    const now = Date.now();
    const top = this.undoStack[this.undoStack.length - 1];

    // Coalesce rapid slider/input drags on the same property within COALESCE_WINDOW_MS
    if (
      top &&
      coalesceKey &&
      top.coalesceKey === coalesceKey &&
      now - top.timestampMs <= WebAudioPipeline.COALESCE_WINDOW_MS
    ) {
      top.timestampMs = now;
      this.redoStack = [];
      this.emit({ type: 'history-changed', history: this.getHistoryState() });
      return;
    }

    this.undoStack.push({
      label,
      snapshotJson: JSON.stringify(this.session),
      coalesceKey,
      timestampMs: now,
    });
    if (this.undoStack.length > WebAudioPipeline.MAX_HISTORY) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    this.emit({ type: 'history-changed', history: this.getHistoryState() });
  }

  public getHistoryState(): HistoryState {
    const undoTop = this.undoStack[this.undoStack.length - 1];
    const redoTop = this.redoStack[this.redoStack.length - 1];
    return {
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoLabel: undoTop ? undoTop.label : null,
      redoLabel: redoTop ? redoTop.label : null,
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length,
    };
  }

  public undo(): Session | null {
    if (!this.session || this.undoStack.length === 0) return null;
    const entry = this.undoStack.pop()!;
    this.redoStack.push({
      label: entry.label,
      snapshotJson: JSON.stringify(this.session),
      timestampMs: Date.now(),
    });
    this.session = JSON.parse(entry.snapshotJson) as Session;
    this.ensureZoneDemoBuffers(this.session.zones);
    this.persistToLocalStorage();
    this.emit({ type: 'session-changed', session: this.session });
    this.emit({ type: 'history-changed', history: this.getHistoryState() });
    return this.session;
  }

  public redo(): Session | null {
    if (!this.session || this.redoStack.length === 0) return null;
    const entry = this.redoStack.pop()!;
    this.undoStack.push({
      label: entry.label,
      snapshotJson: JSON.stringify(this.session),
      timestampMs: Date.now(),
    });
    this.session = JSON.parse(entry.snapshotJson) as Session;
    this.ensureZoneDemoBuffers(this.session.zones);
    this.persistToLocalStorage();
    this.emit({ type: 'session-changed', session: this.session });
    this.emit({ type: 'history-changed', history: this.getHistoryState() });
    return this.session;
  }

  public updateProcessConfig(changes: Partial<ProcessConfig>): Session {
    if (!this.session) throw new Error('No active session');
    const keys = Object.keys(changes).sort().join(',');
    this.pushHistory(`Change Process Settings (${keys})`, `config:${keys}`);

    const cfg = this.session.processConfig;
    if (changes.modelNumber !== undefined) {
      cfg.modelNumber = Math.max(0, Math.min(511, Math.round(changes.modelNumber)));
    }
    if (changes.modelName !== undefined) {
      const maxLen = (changes.targetFormat ?? cfg.targetFormat) === 'modern-neural' ? 32 : 11;
      const trimmed = changes.modelName.replace(/[\r\n\t]/g, '').slice(0, maxLen);
      cfg.modelName = trimmed.length > 0 ? trimmed : 'UNTITLED';
    }
    if (changes.complexity !== undefined) {
      cfg.complexity = Math.max(1, Math.min(10, Math.round(changes.complexity)));
    }
    if (changes.parameterSet !== undefined) {
      cfg.parameterSet = Math.max(0, Math.min(9, Math.round(changes.parameterSet)));
    }
    if (changes.targetFormat !== undefined) {
      cfg.targetFormat = changes.targetFormat;
      if (cfg.targetFormat !== 'modern-neural' && cfg.modelName.length > 11) {
        cfg.modelName = cfg.modelName.slice(0, 11);
      }
    }

    this.markDirty();
    return this.session;
  }

  public resetZonesToSingle(): Session {
    if (!this.session) throw new Error('No active session');
    this.pushHistory('Reset to Single 0..127 Zone');
    this.session.zones = [createZone(0, 60, 127, null)];
    this.markDirty();
    return this.session;
  }

  public autoRepairCoverage(): Session {
    if (!this.session) throw new Error('No active session');
    this.pushHistory('Auto-Repair MIDI Coverage 0..127');

    if (this.session.zones.length === 0) {
      this.session.zones = [createZone(0, 60, 127, null)];
      this.markDirty();
      return this.session;
    }

    // Sort zones by lowKey ascending, then rootKey ascending
    const sorted = [...this.session.zones].sort(
      (a, b) => a.lowKey - b.lowKey || a.rootKey - b.rootKey
    );

    // Cap total zones to 128 at most
    const capped = sorted.slice(0, 128);
    const n = capped.length;

    for (let i = 0; i < n; i++) {
      const z = capped[i];
      if (i === 0) {
        z.lowKey = 0;
      } else {
        const prev = capped[i - 1];
        const minAllowedLow = i;
        const maxAllowedLow = 128 - (n - i);
        const desiredLow = Math.max(prev.lowKey + 1, z.lowKey);
        z.lowKey = Math.max(minAllowedLow, Math.min(maxAllowedLow, desiredLow));
        prev.highKey = z.lowKey - 1;
      }
      if (i === n - 1) {
        z.highKey = 127;
      }
    }

    for (const z of capped) {
      z.rootKey = Math.max(z.lowKey, Math.min(z.highKey, z.rootKey));
      z.velSplit = 64;
      if (!z.sampleLow && z.sampleHigh) {
        z.sampleLow = z.sampleHigh;
        z.sampleHigh = null;
      }
      if (!z.sampleLow) {
        z.sampleLow = `Strings_${z.rootKey}_C4.wav`;
      }
    }

    this.session.zones = capped;
    this.ensureZoneDemoBuffers(this.session.zones);
    this.markDirty();
    return this.session;
  }

  // ── Zones ───────────────────────────────────────────────

  public getZones(): Zone[] {
    return this.session?.zones ?? [];
  }

  public async addZone(rootKey: MidiNote, samplePath?: string | null): Promise<Zone> {
    if (!this.session) throw new Error('No active session');

    const zones = this.session.zones;
    const hostIdx = zones.findIndex(
      (z) => z.lowKey <= rootKey && rootKey <= z.highKey
    );
    if (hostIdx === -1) {
      throw new Error(`No zone covers MIDI note ${rootKey}`);
    }

    this.pushHistory(`Split Zone at MIDI ${rootKey}`);

    const host = zones[hostIdx];

    // If host only spans 1 key or splitPoint === host.lowKey, adjust split safely
    const splitPoint =
      rootKey > host.lowKey
        ? rootKey
        : Math.min(host.highKey, host.lowKey + 1);

    const effectiveSampleLow =
      samplePath !== undefined ? samplePath : host.sampleLow;
    const newZone = createZone(
      splitPoint,
      Math.max(splitPoint, Math.min(host.highKey, rootKey)),
      host.highKey,
      effectiveSampleLow
    );
    if (samplePath === undefined) {
      newZone.sampleHigh = host.sampleHigh;
      newZone.velSplit = 64;
      newZone.detune = host.detune;
      newZone.volume = host.volume;
      newZone.pan = host.pan;
    }
    host.highKey = Math.max(host.lowKey, splitPoint - 1);
    if (host.rootKey > host.highKey) {
      host.rootKey = host.highKey;
    }

    zones.splice(hostIdx + 1, 0, newZone);
    this.ensureZoneDemoBuffers([newZone]);
    this.markDirty();
    return newZone;
  }

  public async updateZone(
    zoneId: string,
    changes: Partial<Zone>
  ): Promise<Zone> {
    if (!this.session) throw new Error('No active session');
    const zones = this.session.zones;
    const idx = zones.findIndex((z) => z.id === zoneId);
    if (idx === -1) throw new Error(`Zone ${zoneId} not found`);
    const zone = zones[idx];

    const changeKeys = Object.keys(changes).sort().join(',');
    this.pushHistory(
      `Update Zone (${changeKeys})`,
      `zone:${zoneId}:${changeKeys}`
    );

    const bothKeyEdgesRaw =
      changes.lowKey !== undefined && changes.highKey !== undefined;

    if (bothKeyEdgesRaw) {
      zone.lowKey = Math.max(0, Math.min(127, Math.round(changes.lowKey!)));
      zone.highKey = Math.max(0, Math.min(127, Math.round(changes.highKey!)));
    } else if (changes.lowKey !== undefined) {
      // Canonical MainFrame.handlePianoNote coupled LowKey adjustment (prevents key collision/gap)
      if (idx === 0) {
        zone.lowKey = 0;
      } else {
        const prev = zones[idx - 1];
        const clampedLow = Math.max(
          prev.lowKey + 1,
          Math.min(zone.highKey, Math.round(changes.lowKey))
        );
        zone.lowKey = clampedLow;
        prev.highKey = clampedLow - 1;
      }
    } else if (changes.highKey !== undefined) {
      // Canonical MainFrame.handlePianoNote coupled HighKey adjustment (prevents key collision/gap)
      if (idx === zones.length - 1) {
        zone.highKey = 127;
      } else {
        const next = zones[idx + 1];
        const clampedHigh = Math.max(
          zone.lowKey,
          Math.min(next.highKey - 1, Math.round(changes.highKey))
        );
        zone.highKey = clampedHigh;
        next.lowKey = clampedHigh + 1;
      }
    }

    if (changes.rootKey !== undefined) {
      zone.rootKey = Math.max(0, Math.min(127, Math.round(changes.rootKey)));
    }
    if (changes.velSplit !== undefined) {
      const isExtended = (this.session?.processConfig as { workingMode?: string })?.workingMode === 'extended';
      zone.velSplit = isExtended ? Math.max(2, Math.min(127, Math.round(changes.velSplit))) : 64;
    }
    if (changes.detune !== undefined) {
      zone.detune = Math.max(-99, Math.min(99, changes.detune));
    }
    if (changes.volume !== undefined) {
      zone.volume = Math.max(-32, Math.min(12, changes.volume));
    }
    if (changes.pan !== undefined) {
      zone.pan = Math.max(-50, Math.min(50, changes.pan));
    }
    if (changes.sampleLow !== undefined) {
      zone.sampleLow = changes.sampleLow;
      if (changes.sampleLow) {
        this.maybeAutoDeriveModelName(changes.sampleLow);
      }
    }
    if (changes.sampleHigh !== undefined) {
      zone.sampleHigh = changes.sampleHigh;
    }

    this.ensureZoneDemoBuffers([zone]);
    this.markDirty();
    return zone;
  }

  public async removeZone(zoneId: string): Promise<void> {
    if (!this.session) throw new Error('No active session');
    const zones = this.session.zones;
    if (zones.length <= 1) {
      throw new Error('Cannot remove the last zone');
    }

    const idx = zones.findIndex((z) => z.id === zoneId);
    if (idx === -1) throw new Error(`Zone ${zoneId} not found`);

    this.pushHistory(`Remove Zone #${idx + 1}`);

    const removed = zones[idx];
    zones.splice(idx, 1);

    if (idx > 0) {
      zones[idx - 1].highKey = removed.highKey;
    } else if (zones.length > 0) {
      zones[0].lowKey = removed.lowKey;
    }

    this.spectralCache.delete(zoneId);
    this.markDirty();
  }

  public validateCoverage(): string[] {
    const errors: string[] = [];
    const zones = this.session?.zones ?? [];
    if (zones.length === 0) {
      errors.push('No zones defined');
      return errors;
    }

    const sorted = [...zones].sort((a, b) => a.lowKey - b.lowKey);

    if (sorted[0].lowKey !== 0) {
      errors.push(
        `Gap at start: first zone starts at ${sorted[0].lowKey}, expected 0`
      );
    }
    if (sorted[sorted.length - 1].highKey !== 127) {
      errors.push(
        `Gap at end: last zone ends at ${sorted[sorted.length - 1].highKey}, expected 127`
      );
    }

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (curr.lowKey !== prev.highKey + 1) {
        if (curr.lowKey <= prev.highKey) {
          errors.push(
            `Overlap between zones at keys ${prev.highKey}–${curr.lowKey}`
          );
        } else {
          errors.push(
            `Gap between keys ${prev.highKey + 1}–${curr.lowKey - 1}`
          );
        }
      }
    }

    for (const z of zones) {
      if (!z.sampleLow && z.sampleHigh) {
        errors.push(
          `Zone ${z.lowKey}–${z.highKey}: High Vel sample assigned without Low Vel sample (velocity gap 1–63)`
        );
      } else if (!z.sampleLow) {
        errors.push(`Zone ${z.lowKey}–${z.highKey}: no sample assigned`);
      }
    }

    return errors;
  }

  // ── Samples & Direct WAV Registration ───────────────────

  /**
   * Registers a binary WAV ArrayBuffer under `sampleName`, decoding it immediately
   * to validate its RIFF/WAVE header, sample rate, and bit depth.
   */
  public registerSampleBuffer(
    sampleName: string,
    wavBuffer: ArrayBuffer
  ): DecodedWav {
    const decoded = decodeWav(wavBuffer);
    this.sampleBuffers.set(sampleName, wavBuffer);
    this.importedSourceBinaries.delete(sampleName);
    this.ribbonEnvelopeCache.delete(sampleName);
    return decoded;
  }

  private computeNormalizedEnvelope(mono: Float32Array, cols = 64): number[] {
    const out = new Array<number>(cols).fill(0);
    if (mono.length === 0) return out;
    let globalPeak = 1e-6;
    for (let i = 0; i < mono.length; i++) {
      const a = Math.abs(mono[i]);
      if (a > globalPeak) globalPeak = a;
    }
    for (let c = 0; c < cols; c++) {
      const i0 = Math.floor((c * mono.length) / cols);
      const i1 = Math.max(i0 + 1, Math.floor(((c + 1) * mono.length) / cols));
      let peak = 0;
      for (let i = i0; i < i1 && i < mono.length; i++) {
        const a = Math.abs(mono[i]);
        if (a > peak) peak = a;
      }
      out[c] = Number(Math.min(1, peak / globalPeak).toFixed(3));
    }
    return out;
  }

  private getSampleEnvelope(sampleName: string | null, fallbackKey = 60): number[] {
    if (!sampleName) return [];
    const cached = this.ribbonEnvelopeCache.get(sampleName);
    if (cached) return cached;
    let raw = this.sampleBuffers.get(sampleName);
    if (!raw) {
      raw = synthesizeDemoWav('strings', fallbackKey, 44100, 1.0);
      this.sampleBuffers.set(sampleName, raw);
    }
    try {
      const decoded = decodeWav(raw);
      const env = this.computeNormalizedEnvelope(decoded.mono, 64);
      this.ribbonEnvelopeCache.set(sampleName, env);
      return env;
    } catch {
      return [];
    }
  }

  /**
   * Returns 64-point normalized waveform envelopes (0..1) for `ZoneRibbon` watermark rendering:
   * - `lowOriginal`: envelope of `zone.sampleLow`
   * - `highOriginal`: envelope of `zone.sampleHigh` (if assigned)
   * - `processed`: envelope of resynthesized/processed model waveform (if inspected or processed)
   */
  public getZoneRibbonWaveforms(zoneId: string): {
    lowOriginal: number[];
    highOriginal: number[] | null;
    processed: number[] | null;
    hasProcessed: boolean;
  } {
    const zone = this.session?.zones.find((z) => z.id === zoneId);
    if (!zone) {
      return { lowOriginal: [], highOriginal: null, processed: null, hasProcessed: false };
    }
    const lowOriginal = this.getSampleEnvelope(zone.sampleLow, zone.rootKey);
    const highOriginal = zone.sampleHigh
      ? this.getSampleEnvelope(zone.sampleHigh, zone.rootKey)
      : null;

    let processed: number[] | null = null;
    const specCached = this.spectralCache.get(zone.id);
    if (specCached) {
      processed = this.computeNormalizedEnvelope(specCached.resynthMono, 64);
    }
    const slot = this.session?.processConfig.modelNumber ?? 0;
    const hasModelBinaries = Boolean(this.modelZoneBinaries.get(slot)?.length);
    return {
      lowOriginal,
      highOriginal,
      processed,
      hasProcessed: Boolean(processed) || hasModelBinaries,
    };
  }

  /**
   * Returns all unique sample filenames currently loaded in memory or assigned in the session,
   * so any zone can reuse an already-loaded sample without re-uploading from disk.
   */
  public getLoadedSampleNames(): string[] {
    const names = new Set<string>(this.sampleBuffers.keys());
    if (this.session) {
      for (const z of this.session.zones) {
        if (z.sampleLow) names.add(z.sampleLow);
        if (z.sampleHigh) names.add(z.sampleHigh);
      }
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }

  /**
   * Synchronously analyzes a single zone and returns its spectral telemetry summary.
   */
  public analyzeZoneImmediate(zoneId: string): ZoneAnalysisSummary {
    if (!this.session) throw new Error('No active session');
    const zone = this.session.zones.find((z) => z.id === zoneId);
    if (!zone) throw new Error(`Zone ${zoneId} not found`);

    const wavBuffer = zone.sampleLow
      ? (this.sampleBuffers.get(zone.sampleLow) ?? null)
      : null;

    const { summary } = analyzeSingleZone(
      { zone, wavBuffer },
      this.session.processConfig,
      this.analyzer
    );
    return summary;
  }

  /**
   * Computes or returns cached Phase 4 spectral inspection data for `zoneId`:
   *   - 2D STFT spectrogram grid (normalized 0..1 dB magnitudes)
   *   - Temporal partial tracks (1..64) tagged with clustered layer index (0..3)
   *   - Downsampled waveform envelopes [min, max] for both Original (A) and Resynthesis (B)
   */
  public inspectZoneSpectrum(zoneId: string): ZoneSpectralInspection {
    if (!this.session) throw new Error('No active session');
    const zone =
      this.session.zones.find((z) => z.id === zoneId) ?? this.session.zones[0];
    if (!zone) throw new Error(`Zone ${zoneId} not found`);

    this.ensureZoneDemoBuffers([zone]);
    const sampleName = zone.sampleLow ?? `Zone_${zone.rootKey}.wav`;
    const wavBuffer =
      (zone.sampleLow ? this.sampleBuffers.get(zone.sampleLow) : null) ??
      synthesizeDemoWav('strings', zone.rootKey, 44100, 1.0);

    const cfg = this.session.processConfig;
    const cacheKey = `${zone.id}|${sampleName}|${wavBuffer.byteLength}|${zone.rootKey}|${zone.detune}|${cfg.complexity}|${cfg.parameterSet}`;
    const cached = this.spectralCache.get(zone.id);
    if (cached && cached.key === cacheKey) {
      return cached.inspection;
    }

    const decoded = decodeWav(wavBuffer);
    const { summary } = analyzeSingleZone({ zone, wavBuffer }, cfg, this.analyzer);

    // Run temporal model analysis to extract multi-layer partial trajectories & additive resynthesis
    const { targetFrames } = complexityToLimits(cfg.complexity);
    const spectralModel = this.analyzer.analyzeTemporal(
      decoded.channels,
      decoded.sampleRate,
      summary.detectedF0Hz,
      targetFrames,
      false,
      'descriptors'
    );
    const layerView = buildLayerView(spectralModel, this.analyzer.lastOctaveFold());

    const isImportedModelSource = Boolean(
      zone.sampleLow && this.importedSourceBinaries.has(zone.sampleLow)
    );
    const resynthDuration = Math.min(2.5, Math.max(0.6, decoded.durationSec));
    const resynthMono = isImportedModelSource
      ? decoded.mono
      : resynthesizeModelToPcm(
          spectralModel,
          resynthDuration,
          44100,
          summary.detectedF0Hz
        );

    const computeEnvelopePeaks = (
      samples: Float32Array,
      columns = 180
    ): { min: number[]; max: number[]; rmsDb: number } => {
      const min = new Array<number>(columns).fill(0);
      const max = new Array<number>(columns).fill(0);
      if (samples.length === 0) return { min, max, rmsDb: -96 };

      let sumSq = 0;
      for (let i = 0; i < samples.length; i++) {
        sumSq += samples[i] * samples[i];
      }
      const rms = Math.sqrt(sumSq / samples.length);
      const rmsDb = rms > 1e-6 ? Number((20 * Math.log10(rms)).toFixed(1)) : -96;

      for (let c = 0; c < columns; c++) {
        const i0 = Math.floor((c * samples.length) / columns);
        const i1 = Math.max(
          i0 + 1,
          Math.floor(((c + 1) * samples.length) / columns)
        );
        let lo = 1.0;
        let hi = -1.0;
        for (let i = i0; i < i1 && i < samples.length; i++) {
          const v = samples[i];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        min[c] = lo <= hi ? Number(lo.toFixed(4)) : 0;
        max[c] = lo <= hi ? Number(hi.toFixed(4)) : 0;
      }
      return { min, max, rmsDb };
    };

    const waveformPeaks = computeEnvelopePeaks(decoded.mono, 180);
    const resynthPeaks = computeEnvelopePeaks(resynthMono, 180);

    // Compute 2D STFT spectrogram (up to 40 time columns x 96 frequency bins)
    const maxAnalysisSamples = Math.min(
      decoded.mono.length,
      Math.floor(decoded.sampleRate * 3.0)
    );
    const stftSlice = decoded.mono.subarray(0, maxAnalysisSamples);
    const frameSize = 2048;
    const hopSize = Math.max(
      256,
      Math.floor(Math.max(1, stftSlice.length - frameSize) / 36)
    );
    const stft = computeStft(stftSlice, {
      frameSize,
      hopSize,
      windowType: 'blackman-harris',
      sampleRate: decoded.sampleRate,
    });

    const maxFreqHz = Math.min(
      decoded.sampleRate * 0.45,
      Math.max(4500, summary.detectedF0Hz * 36)
    );
    const maxBin = Math.max(
      16,
      Math.min(stft.numBins - 1, Math.round(maxFreqHz / stft.binWidthHz))
    );
    const displayBins = 96;

    let peakMag = 1e-9;
    for (const fr of stft.frames) {
      for (let b = 1; b <= maxBin; b++) {
        if (fr.magnitudes[b] > peakMag) peakMag = fr.magnitudes[b];
      }
    }

    const magnitudes: number[][] = [];
    for (const fr of stft.frames) {
      const col = new Array<number>(displayBins).fill(0);
      for (let dbIdx = 0; dbIdx < displayBins; dbIdx++) {
        const b0 = Math.max(1, Math.floor((dbIdx * maxBin) / displayBins));
        const b1 = Math.max(
          b0 + 1,
          Math.floor(((dbIdx + 1) * maxBin) / displayBins)
        );
        let binMax = 0;
        for (let b = b0; b < b1 && b <= maxBin; b++) {
          if (fr.magnitudes[b] > binMax) binMax = fr.magnitudes[b];
        }
        const relDb = 20 * Math.log10(Math.max(1e-6, binMax / peakMag));
        // Normalize [-72 dB .. 0 dB] -> [0 .. 1]
        col[dbIdx] = Number(
          Math.max(0, Math.min(1, (relDb + 72) / 72)).toFixed(3)
        );
      }
      magnitudes.push(col);
    }

    // Build temporal partial trajectories (1..64) with layer assignment
    const partialTracks: SpectralPartialTrack[] = [];
    for (let k = 0; k < 64; k++) {
      const assignedLayer = Math.max(0, layerView.layerOfPartial[k]);
      const peakAmp = layerView.peakOfPartial[k];
      if (peakAmp < 1e-4 && (summary.amplitudes[k] ?? 0) < 1e-4) continue;

      const nFrames = Math.max(1, spectralModel.numFramesOf(assignedLayer));
      const frames: { timeNorm: number; freqHz: number; amplitude: number }[] = [];
      let ampSum = 0;

      for (let f = 0; f < nFrames; f++) {
        const timeNorm = nFrames > 1 ? f / (nFrames - 1) : 0;
        const amp = Math.abs(spectralModel.ampAt(assignedLayer, f, k));
        const offHz = spectralModel.offsetAt(assignedLayer, f, k);
        const f0Frame =
          spectralModel.f0AtLayer(assignedLayer, f) > 0
            ? spectralModel.f0AtLayer(assignedLayer, f)
            : summary.detectedF0Hz;
        const freqHz = Math.max(20, (k + 1) * f0Frame + offHz);
        ampSum += amp;
        frames.push({
          timeNorm: Number(timeNorm.toFixed(3)),
          freqHz: Number(freqHz.toFixed(2)),
          amplitude: Number(amp.toFixed(4)),
        });
      }

      if (frames.length === 1) {
        frames.push({ ...frames[0], timeNorm: 1.0 });
      }

      partialTracks.push({
        partialIndex: k + 1,
        harmonicMultiple: k + 1,
        layerIndex: assignedLayer,
        meanAmplitude: Number((ampSum / Math.max(1, nFrames)).toFixed(4)),
        frames,
      });
    }

    const inspection: ZoneSpectralInspection = {
      zoneId: zone.id,
      sampleName,
      sampleRate: decoded.sampleRate,
      durationSec: Number(decoded.durationSec.toFixed(3)),
      summary,
      waveformPeaks,
      resynthPeaks,
      spectrogram: {
        frameCount: magnitudes.length,
        binCount: displayBins,
        maxFreqHz: Math.round(maxFreqHz),
        magnitudes,
      },
      partialTracks,
    };

    this.spectralCache.set(zone.id, {
      key: cacheKey,
      inspection,
      resynthMono,
    });

    return inspection;
  }

  /**
   * Plays a registered or synthesized WAV sample via Web Audio API.
   */
  public async auditionSample(
    samplePath: string,
    rootKey: MidiNote = 60
  ): Promise<void> {
    if (typeof window === 'undefined' || typeof AudioContext === 'undefined') {
      return;
    }

    this.ensureAudioContext();
    if (!this.audioCtx || !this.analyserNode) return;
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }

    this.stopAudition();

    let raw = this.sampleBuffers.get(samplePath);
    if (!raw) {
      const parsedKey = parseRootKeyFromFilename(samplePath, rootKey);
      raw = synthesizeDemoWav('strings', parsedKey, 44100, 1.0);
      this.sampleBuffers.set(samplePath, raw);
    }

    const decoded = decodeWav(raw);
    const audioBuffer = this.audioCtx.createBuffer(
      decoded.numChannels,
      decoded.numSamples,
      decoded.sampleRate
    );
    for (let ch = 0; ch < decoded.numChannels; ch++) {
      audioBuffer.copyToChannel(
        new Float32Array(decoded.channels[ch]),
        ch
      );
    }

    const source = this.audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.analyserNode);
    source.onended = () => {
      if (this.activeSourceNode === source) {
        this.activeSourceNode = null;
        this.activePlaybackMode = null;
      }
    };
    this.activeSourceNode = source;
    this.activePlaybackMode = 'original';
    source.start();
  }

  /**
   * Plays either the Original sample ('original') or the additive Scape/Sphere
   * neural resynthesis ('resynthesis') for `zoneId`, optionally pitch-shifted to `targetNote`.
   */
  public async auditionZoneComparison(
    zoneId: string,
    mode: 'original' | 'resynthesis',
    targetNote?: MidiNote
  ): Promise<void> {
    if (typeof window === 'undefined' || typeof AudioContext === 'undefined') {
      return;
    }
    if (!this.session) return;

    const zone =
      this.session.zones.find((z) => z.id === zoneId) ?? this.session.zones[0];
    if (!zone) return;

    this.ensureAudioContext();
    if (!this.audioCtx || !this.analyserNode) return;
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }

    this.stopAudition();

    if (mode === 'resynthesis' && !this.spectralCache.has(zone.id)) {
      this.inspectZoneSpectrum(zone.id);
    }
    const cached = this.spectralCache.get(zone.id);

    const semitoneShift =
      targetNote !== undefined
        ? targetNote - zone.rootKey + (zone.detune || 0) / 100
        : (zone.detune || 0) / 100;
    const playbackRate = Math.pow(2.0, semitoneShift / 12.0);
    const linearGain = Math.pow(10.0, (zone.volume || 0) / 20.0);

    let audioBuffer: AudioBuffer;
    if (mode === 'resynthesis' && cached) {
      const mono = cached.resynthMono;
      audioBuffer = this.audioCtx.createBuffer(1, mono.length, 44100);
      audioBuffer.copyToChannel(new Float32Array(mono), 0);
    } else {
      const sampleName = zone.sampleLow ?? 'Strings_60_C4.wav';
      const raw =
        this.sampleBuffers.get(sampleName) ??
        synthesizeDemoWav('strings', zone.rootKey, 44100, 1.0);
      const decoded = decodeWav(raw);
      audioBuffer = this.audioCtx.createBuffer(
        decoded.numChannels,
        decoded.numSamples,
        decoded.sampleRate
      );
      for (let ch = 0; ch < decoded.numChannels; ch++) {
        audioBuffer.copyToChannel(new Float32Array(decoded.channels[ch]), ch);
      }
    }

    const source = this.audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.playbackRate.value = Math.max(0.125, Math.min(8.0, playbackRate));

    const gainNode = this.audioCtx.createGain();
    gainNode.gain.value = Math.max(0.05, Math.min(4.0, linearGain));

    source.connect(gainNode);
    gainNode.connect(this.analyserNode);

    source.onended = () => {
      if (this.activeSourceNode === source) {
        this.activeSourceNode = null;
        this.activePlaybackMode = null;
        if (this.activeGainNode === gainNode) {
          try {
            gainNode.disconnect();
          } catch {
            // Ignore if already disconnected
          }
          this.activeGainNode = null;
        }
      }
    };

    this.activeSourceNode = source;
    this.activeGainNode = gainNode;
    this.activePlaybackMode = mode;
    source.start();
  }

  public stopAudition(): void {
    if (this.activeSourceNode) {
      try {
        this.activeSourceNode.stop();
        this.activeSourceNode.disconnect();
      } catch {
        // Ignore if already stopped
      }
      this.activeSourceNode = null;
      this.activePlaybackMode = null;
    }
    if (this.activeGainNode) {
      try {
        this.activeGainNode.disconnect();
      } catch {
        // Ignore if already disconnected
      }
      this.activeGainNode = null;
    }
  }

  /**
   * Returns real-time Web Audio FFT bins (0..255) and RMS level (dBFS) during playback.
   */
  public getRealtimeSpectrum(): {
    bins: Uint8Array;
    rmsDb: number;
    isPlaying: boolean;
    mode: 'original' | 'resynthesis' | null;
  } {
    if (!this.analyserNode || !this.activeSourceNode) {
      return {
        bins: new Uint8Array(64),
        rmsDb: -96,
        isPlaying: false,
        mode: null,
      };
    }

    const freqBins = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.getByteFrequencyData(freqBins);

    const timeBytes = new Uint8Array(this.analyserNode.fftSize);
    this.analyserNode.getByteTimeDomainData(timeBytes);
    let sumSq = 0;
    for (let i = 0; i < timeBytes.length; i++) {
      const norm = (timeBytes[i] - 128) / 128.0;
      sumSq += norm * norm;
    }
    const rms = Math.sqrt(sumSq / timeBytes.length);
    const rmsDb = rms > 1e-5 ? Number((20 * Math.log10(rms)).toFixed(1)) : -96;

    return {
      bins: freqBins.subarray(0, 128),
      rmsDb,
      isPlaying: true,
      mode: this.activePlaybackMode,
    };
  }

  private ensureAudioContext(): void {
    if (typeof window === 'undefined' || typeof AudioContext === 'undefined') {
      return;
    }
    if (!this.audioCtx) {
      this.audioCtx = new AudioContext();
      this.analyserNode = this.audioCtx.createAnalyser();
      this.analyserNode.fftSize = 2048;
      this.analyserNode.smoothingTimeConstant = 0.78;
      this.analyserNode.connect(this.audioCtx.destination);
    }
  }

  public async importSamplesFromFolder(_folderPath: string): Promise<Zone[]> {
    if (!this.session) await this.newSession('Imported Multisample');
    this.pushHistory('Import Samples Folder');
    this.session!.zones = [
      createZone(0, 24, 35, 'Bass_24_C1.wav'),
      createZone(36, 60, 71, 'Piano_60_C4.wav'),
      createZone(72, 84, 95, 'Strings_84_C6.wav'),
      createZone(96, 108, 127, 'Pad_108_C8.wav'),
    ];
    this.ensureZoneDemoBuffers(this.session!.zones);
    this.markDirty();
    return this.session!.zones;
  }

  /**
   * Imports real binary WAV / AIFF files selected via File Picker or Drag & Drop.
   *
   * Supports both original MODELmaker v1.2 workflows:
   * - `mode === 'samples'` (`Ctrl-I` / Import Samples): reads AIFF `INST` / WAV `smpl`
   *   embedded metadata (`rootKey`, `lowKey`, `lowVelocity < 64` vs `>= 64`, `detune`),
   *   with fallback to pitch detection (`detectPitch`) or filename parsing.
   * - `mode === 'by-name'` (`Ctrl-N` / Import by Name): ignores embedded `INST` metadata
   *   and parses `name_rootkey_lowkey[_v1|_v2]` / `name-Note[_high]` per `KeyZoneData.class`,
   *   merges `v1` (Low Velocity) and `v2` (High Velocity) layers sharing the same `lowKey`,
   *   sorts ascending by `lowKey`, sets `zone[i].highKey = zone[i+1].lowKey - 1`,
   *   `zone[0].lowKey = 0`, and `zone[last].highKey = 127`.
   */
  public async importAudioFiles(
    files: { name: string; buffer: ArrayBuffer }[],
    mode: 'samples' | 'by-name' = 'samples'
  ): Promise<Zone[]> {
    // Filter out macOS AppleDouble resource forks (._* / __MACOSX) and tiny non-audio stubs
    const candidateFiles = files.filter((f) => {
      const normalized = f.name.replace(/\\/g, '/');
      if (normalized.includes('__MACOSX/')) return false;
      const base = normalized.split('/').pop() ?? normalized;
      if (base.startsWith('.') || base.startsWith('._')) return false;
      return f.buffer && f.buffer.byteLength >= 44;
    });

    if (candidateFiles.length === 0) return this.getZones();
    if (!this.session) await this.newSession('Imported Multisample');

    interface ParsedSampleItem {
      name: string;
      rootKey: MidiNote;
      lowKey: MidiNote | null;
      isHighVelocity: boolean;
      detune: number;
    }

    const items: ParsedSampleItem[] = [];
    for (const f of candidateFiles) {
      let decoded: ReturnType<typeof this.registerSampleBuffer>;
      try {
        decoded = this.registerSampleBuffer(f.name, f.buffer);
      } catch {
        // Skip invalid/corrupt or non-audio files in folder imports
        continue;
      }

      const baseName = (f.name.split(/[\\/]/).pop() ?? f.name);
      const byName = parseSampleFilenameByName(baseName, -1 as MidiNote);
      // Only assign High Velocity (64..127) when deduced from the filename (_v2, _high, etc.)
      const isHighVelocity = byName.isHighVelocity;

      if (mode === 'by-name') {
        const rk = byName.rootKey >= 0 && byName.rootKey <= 127 ? byName.rootKey : 60;
        const lk = byName.lowKey >= 0 && byName.lowKey <= 127 ? byName.lowKey : rk;
        items.push({
          name: baseName,
          rootKey: rk,
          lowKey: lk,
          isHighVelocity,
          detune: 0,
        });
        continue;
      }

      const inst = decoded.instrument;
      let rootKey: MidiNote;
      if (byName.rootKey >= 0 && byName.rootKey <= 127) {
        rootKey = byName.rootKey;
      } else if (inst && inst.rootKey >= 0 && inst.rootKey <= 127) {
        rootKey = inst.rootKey;
      } else {
        const detectedHz = this.analyzer.detectPitch(
          decoded.channels[0],
          decoded.sampleRate
        );
        rootKey =
          detectedHz > 20
            ? Math.max(
                0,
                Math.min(127, Math.round(69 + 12 * Math.log2(detectedHz / 440)))
              )
            : 60;
      }

      const hasExplicitNameLowKey =
        byName.lowKey >= 0 &&
        byName.lowKey <= 127 &&
        byName.lowKey !== byName.rootKey;
      const hasExplicitInstLowKey =
        inst !== undefined &&
        inst.lowKey >= 0 &&
        inst.lowKey <= 127 &&
        !(inst.lowKey === 0 && inst.highKey === 127 && candidateFiles.length > 1);

      const lowKey = hasExplicitNameLowKey
        ? byName.lowKey
        : hasExplicitInstLowKey
          ? inst!.lowKey
          : null;

      items.push({
        name: baseName,
        rootKey,
        lowKey,
        isHighVelocity,
        detune: inst?.detune ?? 0,
      });
    }

    if (items.length === 0) {
      throw new Error('No valid WAV or AIFF audio files could be decoded.');
    }

    this.pushHistory(`Import ${items.length} Sample(s)`);

    items.sort((a, b) => {
      const keyA = a.lowKey ?? a.rootKey;
      const keyB = b.lowKey ?? b.rootKey;
      if (keyA !== keyB) return keyA - keyB;
      if (a.rootKey !== b.rootKey) return a.rootKey - b.rootKey;
      return (a.isHighVelocity ? 1 : 0) - (b.isHighVelocity ? 1 : 0);
    });

    // Only merge two samples into the same zone (Low Vel + High Vel) when they share the same key
    // AND one of them is explicitly marked as High Velocity in its filename (_v2, _high, etc.).
    const grouped: {
      rootKey: MidiNote;
      lowKey: MidiNote | null;
      sampleLow: string | null;
      sampleHigh: string | null;
      velSplit: number;
      detune: number;
    }[] = [];

    for (const item of items) {
      const itemKey = item.lowKey ?? item.rootKey;
      const match = grouped.find((g) => {
        const gKey = g.lowKey ?? g.rootKey;
        if (gKey !== itemKey) return false;
        return item.isHighVelocity ? g.sampleHigh === null : g.sampleLow === null;
      });

      if (match && (item.isHighVelocity || match.sampleLow === null)) {
        if (item.isHighVelocity) {
          match.sampleHigh = item.name;
        } else {
          match.sampleLow = item.name;
        }
      } else {
        grouped.push({
          rootKey: item.rootKey,
          lowKey: item.lowKey,
          sampleLow: item.isHighVelocity ? null : item.name,
          sampleHigh: item.isHighVelocity ? item.name : null,
          velSplit: 64,
          detune: item.detune,
        });
      }
    }

    // Ensure every zone has a primary sampleLow (if a lone _v2 file had no _v1 pair, promote it to sampleLow)
    for (const g of grouped) {
      if (!g.sampleLow && g.sampleHigh) {
        g.sampleLow = g.sampleHigh;
        g.sampleHigh = null;
      }
    }

    // Compute strictly monotonic lowKeys first, then set highKey[i] = lowKey[i+1] - 1
    const n = grouped.length;
    const computedLowKeys: MidiNote[] = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      if (i === 0) {
        computedLowKeys[i] = 0;
      } else {
        const prev = grouped[i - 1];
        const curr = grouped[i];
        const rawLow =
          curr.lowKey !== null
            ? curr.lowKey
            : Math.floor((prev.rootKey + curr.rootKey) / 2) + 1;
        const minAllowed = computedLowKeys[i - 1] + 1;
        const maxAllowed = 128 - (n - i);
        computedLowKeys[i] = Math.max(minAllowed, Math.min(maxAllowed, rawLow));
      }
    }

    const newZones: Zone[] = [];
    for (let i = 0; i < n; i++) {
      const curr = grouped[i];
      const lowKey = computedLowKeys[i];
      const highKey = i === n - 1 ? 127 : computedLowKeys[i + 1] - 1;
      const rootKey = Math.max(lowKey, Math.min(highKey, curr.rootKey));

      const zone = createZone(lowKey, rootKey, highKey, curr.sampleLow);
      zone.sampleHigh = curr.sampleHigh;
      zone.velSplit = curr.velSplit;
      zone.detune = curr.detune;
      newZones.push(zone);
    }

    this.session!.zones = newZones;
    if (newZones[0]?.sampleLow) {
      this.maybeAutoDeriveModelName(newZones[0].sampleLow);
    }
    this.markDirty();
    return newZones;
  }

  private maybeAutoDeriveModelName(sampleFilename: string): void {
    if (!this.session) return;
    const current = this.session.processConfig.modelName.trim();
    if (!DEFAULT_MODEL_NAMES.has(current)) return;
    const maxLen =
      this.session.processConfig.targetFormat === 'modern-neural' ? 32 : 11;
    const derived = deriveModelNameFromSample(sampleFilename, maxLen);
    if (derived) {
      this.session.processConfig.modelName = derived;
      if (DEFAULT_MODEL_NAMES.has(this.session.name.trim())) {
        this.session.name = derived;
      }
    }
  }

  /**
   * Imports a legacy Hartmann `.model` file set (`MName`, `map.script`, `%06d.scape`, `%06d.sphere`),
   * a `.zip` package exported by MODELmaker / NeuronDB, or a `.neuronikmodel` v2.1 JSON file:
   * - Reconstructs the session zones and process configuration
   * - Resynthesizes playable 44.1 kHz PCM16 WAV buffers from `.sphere` / `.scape` frames
   *   so every imported zone can be auditioned and re-analyzed immediately
   * - Registers the model in the Bank and emits `session-changed`, `process-complete`, and `bank-updated`.
   */
  public async importModelFiles(
    files: { name: string; buffer: ArrayBuffer }[]
  ): Promise<GeneratedModel> {
    if (files.length === 0) {
      throw new Error('No model files provided for import');
    }

    const defaultSlot = this.session?.processConfig.modelNumber ?? 1;
    const byteFiles = files.map((f) => ({
      name: f.name,
      data: new Uint8Array(f.buffer),
    }));
    const bundle = parseModelFileSet(byteFiles, defaultSlot);

    const hasEmbeddedSamples = Boolean(
      bundle.embeddedSamples && bundle.embeddedSamples.size > 0
    );
    if (
      bundle.scapes.size === 0 &&
      bundle.spheres.size === 0 &&
      !bundle.neuronikModelJson &&
      !hasEmbeddedSamples
    ) {
      if (bundle.hasMNameOrMapScript) {
        throw new Error(
          'Has seleccionado solo MName o map.script sin los archivos .scape y .sphere del modelo.\n\n' +
            '• Si usas "Import Model Files / .zip", selecciona TODOS los archivos dentro de la carpeta <NNN>.model (Ctrl+A: MName, map.script, *.scape, *.sphere) o un archivo .zip.\n' +
            '• O bien usa "File -> Import Model Folder (<NNN>.model)..." para abrir la carpeta directamente.'
        );
      }
      throw new Error(
        'No se encontraron archivos válidos de modelo (.scape, .sphere, .nmmodel) ni muestras de audio dentro de los archivos seleccionados.'
      );
    }

    if (bundle.embeddedSamples) {
      for (const [sName, sBytes] of bundle.embeddedSamples.entries()) {
        const copy = new Uint8Array(sBytes.byteLength);
        copy.set(sBytes);
        try {
          this.registerSampleBuffer(sName, copy.buffer);
        } catch {
          // ignore non-decodable embedded file
        }
      }
    }

    if (!this.session) {
      await this.newSession(bundle.name);
    } else {
      this.pushHistory(`Import Model "${bundle.name}"`);
    }

    const activeZones =
      bundle.mapScript.activeZones.length > 0
        ? bundle.mapScript.activeZones
        : [createZone(0, 60, 127, '000001.scape')];

    const firstSphere = bundle.spheres.values().next().value;
    const inferredParamSet =
      firstSphere?.header.parameterSet ?? bundle.inferredParameterSet ?? 0;
    const stickModes = firstSphere?.header.stickModes ?? 16;
    const stickTable = [1, 4, 8, 12, 16, 24, 32, 42, 54, 64];
    const complexityIdx = stickTable.findIndex((s) => s >= stickModes);
    const inferredComplexity =
      firstSphere !== undefined
        ? complexityIdx >= 0
          ? complexityIdx + 1
          : 8
        : (bundle.inferredComplexity ?? 8);

    const newZones: Zone[] = [];
    const zonesAnalysis: ZoneAnalysisSummary[] = [];
    const sourceSampleNames = new Map<number, string>();
    const binaryBySampleName = new Map<string, ZoneBinaryPair>();

    const buildResynthSourceWav = (
      srcIdx: number,
      zEntry: Zone,
      zoneIndex: number,
      suffix = ''
    ): { sampleName: string; wavBuf: ArrayBuffer } => {
      const explicitCandidate =
        suffix === '' ? zEntry.sampleLow : zEntry.sampleHigh;
      if (
        explicitCandidate &&
        bundle.embeddedSamples?.has(explicitCandidate) &&
        this.sampleBuffers.has(explicitCandidate) &&
        !bundle.spheres.has(srcIdx) &&
        !bundle.scapes.has(srcIdx)
      ) {
        return {
          sampleName: explicitCandidate,
          wavBuf: this.sampleBuffers.get(explicitCandidate)!,
        };
      }
      const existingName = sourceSampleNames.get(srcIdx);
      if (existingName && this.sampleBuffers.has(existingName)) {
        return {
          sampleName: existingName,
          wavBuf: this.sampleBuffers.get(existingName)!,
        };
      }
      const sampleName = `${bundle.name}_S${String(srcIdx).padStart(2, '0')}_K${String(zEntry.rootKey).padStart(3, '0')}${suffix}.wav`;
      const parsedSphere = bundle.spheres.get(srcIdx);
      const parsedScape = bundle.scapes.get(srcIdx);

      let pcmFloat: Float32Array | null = null;
      if ((parsedSphere && parsedSphere.frames.length > 0) || parsedScape) {
        pcmFloat = resynthesizeNeuronModelSource(parsedSphere, parsedScape, 44100, 0.22);
      }

      const wavBuf = pcmFloat
        ? encodePcm16Wav(pcmFloat, 44100, {
            rootKey: zEntry.rootKey,
            lowKey: zEntry.lowKey,
            highKey: zEntry.highKey,
            detune: zEntry.detune,
          })
        : synthesizeDemoWav('strings', zEntry.rootKey + zoneIndex * 0, 44100, 1.0);

      this.sampleBuffers.set(sampleName, wavBuf);
      sourceSampleNames.set(srcIdx, sampleName);
      return { sampleName, wavBuf };
    };

    for (let i = 0; i < activeZones.length; i++) {
      const zEntry = activeZones[i];
      const srcIdx =
        parseInt((zEntry.sampleLow ?? `${i + 1}`).replace(/\D+/g, ''), 10) ||
        i + 1;
      const { sampleName, wavBuf } = buildResynthSourceWav(srcIdx, zEntry, i);

      let highSampleName: string | null = null;
      if (zEntry.sampleHigh) {
        const hiIdx = parseInt(zEntry.sampleHigh.replace(/\D+/g, ''), 10);
        if (!Number.isNaN(hiIdx) && hiIdx > 0 && hiIdx !== srcIdx) {
          highSampleName = buildResynthSourceWav(hiIdx, zEntry, i, '_v2').sampleName;
          const hiScape = bundle.scapeBinaries?.get(hiIdx);
          const hiSphere = bundle.sphereBinaries?.get(hiIdx);
          if (hiScape && hiSphere && !binaryBySampleName.has(highSampleName)) {
            binaryBySampleName.set(highSampleName, {
              scapeBinary: hiScape,
              sphereBinary: hiSphere,
            });
            this.importedSourceBinaries.set(highSampleName, {
              scapeBinary: hiScape,
              sphereBinary: hiSphere,
              origParameterSet: inferredParamSet,
              complexity: inferredComplexity,
              summary: {
                zoneId: `zone_${i + 1}`,
                lowKey: zEntry.lowKey,
                rootKey: zEntry.rootKey,
                highKey: zEntry.highKey,
                sampleName: highSampleName,
                sampleRate: 44100,
                durationSec: 1.0,
                detectedF0Hz: 440,
                targetF0Hz: 440,
                gridResidualCents: 0,
                gridObservations: 16,
                gridBand: 'green',
                gridNotice: 'Imported .sphere (High Vel preserved)',
                layerCount: 1,
                frameCount: 16,
                activePartials: 64,
                octaveFoldCents: 0,
                biGrid: false,
                amplitudes: new Array<number>(64).fill(0),
                frequencyOffsets: new Array<number>(64).fill(0),
              },
            });
          }
        }
      }

      const rawSphere = bundle.sphereBinaries?.get(srcIdx);
      const rawScape = bundle.scapeBinaries?.get(srcIdx);
      const parsedSphere = bundle.spheres.get(srcIdx);
      const parsedScape = bundle.scapes.get(srcIdx);

      const zone = createZone(
        zEntry.lowKey,
        zEntry.rootKey,
        zEntry.highKey,
        sampleName
      );
      zone.sampleHigh = highSampleName;
      zone.detune = zEntry.detune;
      zone.volume = zEntry.volume;
      zone.pan = zEntry.pan;
      newZones.push(zone);

      if (rawScape && rawSphere && parsedSphere) {
        const res = parsedSphere.header.resolution || parsedScape?.header.resolution || 100;
        const targetF0Hz = Number((440 * Math.pow(2, (zone.rootKey - 69) / 12)).toFixed(2));
        const detectedF0Hz = Number((res > 0 ? 44100 / res : targetF0Hz).toFixed(2));
        const midFrame =
          parsedSphere.frames[Math.floor(parsedSphere.frames.length / 2)] ??
          parsedSphere.frames[0];
        const amps = new Array<number>(64).fill(0);
        const offs = new Array<number>(64).fill(0);
        if (midFrame) {
          for (const p of midFrame.partials) {
            if (p.frequency <= 0 || p.amplitude <= 0) continue;
            const freqHz = p.frequency * 0.5;
            const harmIdx = Math.round(freqHz / Math.max(20, detectedF0Hz)) - 1;
            if (harmIdx >= 0 && harmIdx < 64) {
              const normAmp = p.amplitude / 65535.0;
              if (normAmp > amps[harmIdx]) {
                amps[harmIdx] = normAmp;
                offs[harmIdx] = Number((freqHz - (harmIdx + 1) * detectedF0Hz).toFixed(2));
              }
            }
          }
        }
        const summaryItem: ZoneAnalysisSummary = {
          zoneId: zone.id,
          lowKey: zone.lowKey,
          rootKey: zone.rootKey,
          highKey: zone.highKey,
          sampleName,
          sampleRate: 44100,
          durationSec: 1.0,
          detectedF0Hz,
          targetF0Hz,
          gridResidualCents: 0,
          gridObservations: parsedSphere.frames.length,
          gridBand: 'green',
          gridNotice: `Imported .sphere (${parsedSphere.frames.length} frames, ${parsedSphere.header.stickModes} modes)`,
          layerCount: 1,
          frameCount: parsedSphere.frames.length,
          activePartials: midFrame?.partialCount ?? 64,
          octaveFoldCents: 0,
          biGrid: false,
          amplitudes: amps,
          frequencyOffsets: offs,
        };
        zonesAnalysis.push(summaryItem);
        binaryBySampleName.set(sampleName, {
          scapeBinary: rawScape,
          sphereBinary: rawSphere,
        });
        this.importedSourceBinaries.set(sampleName, {
          scapeBinary: rawScape,
          sphereBinary: rawSphere,
          origParameterSet: parsedSphere.header.parameterSet ?? inferredParamSet,
          complexity: inferredComplexity,
          summary: summaryItem,
        });
      } else {
        const analyzed = analyzeSingleZone(
          { zone, wavBuffer: wavBuf },
          {
            modelName: bundle.name,
            modelNumber: bundle.slot,
            parameterSet: inferredParamSet,
            complexity: inferredComplexity,
            targetFormat: 'legacy-neuron',
          },
          this.analyzer
        );

        zonesAnalysis.push(analyzed.summary);
        binaryBySampleName.set(sampleName, {
          scapeBinary: rawScape ?? analyzed.scapeBinary,
          sphereBinary: rawSphere ?? analyzed.sphereBinary,
        });
      }
    }

    // Build ordered unique source binaries (1..K) matching serializeCanonicalMapScript's sourceMap
    const zoneBinaries: ZoneBinaryPair[] = [];
    const seenSamples = new Set<string>();
    for (const z of newZones) {
      for (const sName of [z.sampleLow, z.sampleHigh]) {
        if (sName && !seenSamples.has(sName)) {
          seenSamples.add(sName);
          const pair = binaryBySampleName.get(sName);
          if (pair) {
            zoneBinaries.push(pair);
          }
        }
      }
    }

    const neuronikModelJson =
      bundle.neuronikModelJson ?? convertLegacyModelToModern(bundle);

    this.session!.name = bundle.name;
    this.session!.zones = newZones;
    this.session!.processConfig = {
      modelName: bundle.name,
      modelNumber: bundle.slot,
      parameterSet: inferredParamSet,
      complexity: inferredComplexity,
      targetFormat: 'legacy-neuron',
    };
    this.session!.dirty = false;
    this.session!.modifiedAt = new Date().toISOString();

    this.modelZoneBinaries.set(bundle.slot, zoneBinaries);
    this.modelMapScriptVersions.set(bundle.slot, {
      major: bundle.mapScript.versionMajor,
      minor: bundle.mapScript.versionMinor,
      build: bundle.mapScript.versionBuild,
      lineEnding: '\n',
    });

    const model: GeneratedModel = {
      slot: bundle.slot,
      name: bundle.name,
      zoneCount: newZones.length,
      complexity: inferredComplexity,
      parameterSet: inferredParamSet,
      createdAt: new Date().toISOString(),
      path: `Models/${String(bundle.slot).padStart(3, '0')}.model`,
      targetFormat: 'dual',
      zonesAnalysis,
      neuronikModelJson,
    };

    this.generatedModels = this.generatedModels.filter(
      (m) => m.slot !== model.slot
    );
    this.generatedModels.push(model);

    this.persistToLocalStorage();
    this.emit({ type: 'session-changed', session: this.session! });
    this.emit({ type: 'process-complete', model });
    const bank = await this.loadBank();
    this.emit({ type: 'bank-updated', bank });

    return model;
  }

  // ── Process / Model Generation ──────────────────────────

  public getParameterSets(): ParameterSetInfo[] {
    return PARAMETER_SETS;
  }

  /**
   * Classifies all unique audio sources currently assigned across session zones into:
   * - `importedSources`: sources originating from a compiled `.model` (have `.scape`/`.sphere`, no original WAV)
   * - `newAudioSources`: real WAV/AIFF files loaded by the user
   * - `complexityChanged`: whether the UI Complexity differs from the imported sources' original complexity
   */
  public inspectProcessSources(): {
    importedSources: string[];
    newAudioSources: string[];
    importedComplexity: number | null;
    complexityChanged: boolean;
  } {
    const importedSources: string[] = [];
    const newAudioSources: string[] = [];
    const seen = new Set<string>();
    let importedComplexity: number | null = null;

    if (this.session) {
      for (const z of this.session.zones) {
        for (const sName of [z.sampleLow, z.sampleHigh]) {
          if (!sName || seen.has(sName)) continue;
          seen.add(sName);
          const imp = this.importedSourceBinaries.get(sName);
          if (imp) {
            importedSources.push(sName);
            if (importedComplexity === null) {
              importedComplexity = imp.complexity;
            }
          } else {
            newAudioSources.push(sName);
          }
        }
      }
    }

    const currComp = this.session?.processConfig.complexity ?? 8;
    const complexityChanged =
      importedSources.length > 0 &&
      importedComplexity !== null &&
      currComp !== importedComplexity;

    return {
      importedSources,
      newAudioSources,
      importedComplexity,
      complexityChanged,
    };
  }

  public async startProcess(
    config: ProcessConfig,
    options?: { forceReanalyzeImported?: boolean }
  ): Promise<void> {
    if (!this.session) throw new Error('No active session');
    if (this.isRunning) throw new Error('Process already running');

    this.session.processConfig = { ...config };
    const zones = [...this.session.zones];
    this.ensureZoneDemoBuffers(zones);
    const forceReanalyze = options?.forceReanalyzeImported === true;

    const payloads: ZoneWavPayload[] = zones.map((zone) => {
      const buf = zone.sampleLow
        ? (this.sampleBuffers.get(zone.sampleLow) ?? null)
        : null;
      const highBuf = zone.sampleHigh
        ? (this.sampleBuffers.get(zone.sampleHigh) ?? null)
        : null;
      const preservedLow =
        !forceReanalyze && zone.sampleLow
          ? this.importedSourceBinaries.get(zone.sampleLow)
          : undefined;
      const preservedHigh =
        !forceReanalyze && zone.sampleHigh
          ? this.importedSourceBinaries.get(zone.sampleHigh)
          : undefined;
      return {
        zone: { ...zone },
        wavBuffer: buf ? buf.slice(0) : null,
        highWavBuffer: highBuf ? highBuf.slice(0) : null,
        preservedLowBinary: preservedLow,
        preservedHighBinary: preservedHigh,
      };
    });

    this.isRunning = true;
    this.cancelFlag = false;
    const startTime = Date.now();

    this.processProgress = {
      status: 'running',
      currentZone: 1,
      totalZones: zones.length,
      currentSample: zones[0]?.sampleLow ?? 'unknown',
      percent: 0,
      message: 'Initializing 8192-point STFT & harmonic peak-picking engine...',
      elapsedMs: 0,
    };
    this.emit({
      type: 'process-progress',
      progress: { ...this.processProgress },
    });

    // Use Web Worker when available in browser, fallback to async main-thread runner
    if (typeof Worker !== 'undefined') {
      try {
        this.terminateWorker();
        this.worker = new Worker(
          new URL('./worker/analysisWorker.ts', import.meta.url),
          { type: 'module' }
        );

        this.worker.onmessage = (
          ev: MessageEvent<WorkerOutboundMessage>
        ) => {
          const msg = ev.data;
          if (msg.type === 'progress') {
            this.processProgress = msg.progress;
            this.emit({
              type: 'process-progress',
              progress: { ...this.processProgress },
            });
          } else if (msg.type === 'complete') {
            this.isRunning = false;
            this.terminateWorker();
            this.finalizeModelGeneration(
              config,
              zones.length,
              msg.zonesAnalysis,
              msg.zoneBinaries,
              msg.neuronikModelJson,
              msg.elapsedMs
            );
          } else if (msg.type === 'cancelled') {
            this.isRunning = false;
            this.terminateWorker();
            this.processProgress = {
              status: 'cancelled',
              currentZone: this.processProgress?.currentZone ?? 0,
              totalZones: zones.length,
              currentSample: '',
              percent: this.processProgress?.percent ?? 0,
              message: 'Process cancelled by user',
              elapsedMs: msg.elapsedMs,
            };
            this.emit({
              type: 'process-progress',
              progress: { ...this.processProgress },
            });
          } else if (msg.type === 'error') {
            this.isRunning = false;
            this.terminateWorker();
            this.processProgress = {
              status: 'error',
              currentZone: this.processProgress?.currentZone ?? 0,
              totalZones: zones.length,
              currentSample: '',
              percent: this.processProgress?.percent ?? 0,
              message: msg.error,
              elapsedMs: Date.now() - startTime,
            };
            this.emit({
              type: 'process-progress',
              progress: { ...this.processProgress },
            });
            this.emit({ type: 'process-error', error: msg.error });
          }
        };

        this.worker.onerror = (err) => {
          this.isRunning = false;
          this.terminateWorker();
          const errMsg = err.message || 'Worker execution failed';
          this.emit({ type: 'process-error', error: errMsg });
        };

        const startMsg: WorkerInboundMessage = {
          type: 'start',
          payloads,
          config,
        };
        this.worker.postMessage(startMsg);
        return;
      } catch {
        // Fallback to main thread if Worker instantiation fails
        this.terminateWorker();
      }
    }

    // Main-thread fallback execution
    try {
      const result = await runMultiZonePipeline(
        payloads,
        config,
        (progress) => {
          this.processProgress = progress;
          this.emit({
            type: 'process-progress',
            progress: { ...this.processProgress },
          });
        },
        () => this.cancelFlag
      );

      this.isRunning = false;
      this.finalizeModelGeneration(
        config,
        zones.length,
        result.zonesAnalysis,
        result.zoneBinaries,
        result.neuronikModelJson,
        Date.now() - startTime
      );
    } catch (err) {
      this.isRunning = false;
      const message = err instanceof Error ? err.message : String(err);
      if (this.cancelFlag || message.includes('cancelled')) {
        this.processProgress = {
          status: 'cancelled',
          currentZone: this.processProgress?.currentZone ?? 0,
          totalZones: zones.length,
          currentSample: '',
          percent: this.processProgress?.percent ?? 0,
          message: 'Process cancelled by user',
          elapsedMs: Date.now() - startTime,
        };
        this.emit({
          type: 'process-progress',
          progress: { ...this.processProgress },
        });
      } else {
        this.processProgress = {
          status: 'error',
          currentZone: this.processProgress?.currentZone ?? 0,
          totalZones: zones.length,
          currentSample: '',
          percent: 0,
          message,
          elapsedMs: Date.now() - startTime,
        };
        this.emit({
          type: 'process-progress',
          progress: { ...this.processProgress },
        });
        this.emit({ type: 'process-error', error: message });
      }
    }
  }

  public async cancelProcess(): Promise<void> {
    this.cancelFlag = true;
    if (this.worker) {
      const msg: WorkerInboundMessage = { type: 'cancel' };
      this.worker.postMessage(msg);
      this.terminateWorker();
    }
    this.isRunning = false;
    if (this.processProgress) {
      this.processProgress = {
        ...this.processProgress,
        status: 'cancelled',
        message: 'Process cancelled by user',
      };
      this.emit({
        type: 'process-progress',
        progress: { ...this.processProgress },
      });
    }
  }

  public getProcessProgress(): ProcessProgress | null {
    return this.processProgress;
  }

  // ── Bank & Export Packaging ─────────────────────────────

  private bankPresets = [...INITIAL_PRESETS];

  public setBankPresets(presets: BankSummary['presets']): void {
    if (presets && presets.length > 0) {
      this.bankPresets = [...presets];
    }
  }

  public async clearGeneratedModels(): Promise<void> {
    this.generatedModels = [];
    this.modelZoneBinaries.clear();
    try {
      localStorage.removeItem('abdsynths_nmm_bank');
    } catch {
      // ignore
    }
    this.pushHistory('Clear Generated Models');
    this.emit({ type: 'bank-updated', bank: await this.loadBank() });
  }

  public async loadBank(): Promise<BankSummary> {
    return {
      models: [...this.generatedModels],
      presets: [...this.bankPresets],
      totalModels: this.generatedModels.length,
      totalPresets: this.bankPresets.length,
    };
  }

  /**
   * Builds a complete PKZIP archive (`Uint8Array`) containing the Hartmann NeuronDB
   * `.model` directory (`MName`, `map.script`, `%06d.scape`, `%06d.sphere`),
   * `.sound` directory (`sound.script`, `sound.stickrec`), and modern `.neuronikmodel` v2.1.
   */
  public buildModelZipBytes(slot: number): Uint8Array {
    const model = this.generatedModels.find((m) => m.slot === slot);
    const activeSlot = model?.slot ?? slot;
    const modelName =
      model?.name ?? this.session?.processConfig.modelName ?? `Model${activeSlot}`;
    const zones = this.session?.zones ?? [
      createZone(0, 60, 127, 'Strings_60_C4.wav'),
    ];
    this.ensureZoneDemoBuffers(zones);

    let zoneBinaries = this.modelZoneBinaries.get(activeSlot);
    if (!zoneBinaries || zoneBinaries.length === 0) {
      const cfg: ProcessConfig = this.session?.processConfig ?? {
        modelName,
        modelNumber: activeSlot,
        parameterSet: model?.parameterSet ?? 0,
        complexity: model?.complexity ?? 8,
        targetFormat: model?.targetFormat ?? 'dual',
      };
      const analyzedBySample = new Map<string, ZoneBinaryPair>();
      zoneBinaries = [];
      for (const zone of zones) {
        const lowName = zone.sampleLow ?? `Zone_${zone.rootKey}.wav`;
        if (!analyzedBySample.has(lowName)) {
          const wavBuffer = zone.sampleLow
            ? (this.sampleBuffers.get(zone.sampleLow) ?? null)
            : null;
          const analyzed = analyzeSingleZone(
            { zone, wavBuffer },
            cfg,
            this.analyzer
          );
          const pair: ZoneBinaryPair = {
            scapeBinary: analyzed.scapeBinary,
            sphereBinary: analyzed.sphereBinary,
          };
          analyzedBySample.set(lowName, pair);
          zoneBinaries.push(pair);
        }
        if (zone.sampleHigh && !analyzedBySample.has(zone.sampleHigh)) {
          const highBuffer = this.sampleBuffers.get(zone.sampleHigh) ?? null;
          const analyzedHigh = analyzeSingleZone(
            {
              zone: { ...zone, sampleLow: zone.sampleHigh },
              wavBuffer: highBuffer,
            },
            cfg,
            this.analyzer
          );
          const pairHigh: ZoneBinaryPair = {
            scapeBinary: analyzedHigh.scapeBinary,
            sphereBinary: analyzedHigh.sphereBinary,
          };
          analyzedBySample.set(zone.sampleHigh, pairHigh);
          zoneBinaries.push(pairHigh);
        }
      }
      this.modelZoneBinaries.set(activeSlot, zoneBinaries);
    }

    const sourceSamples: { name: string; data: Uint8Array }[] = [];
    const seenSamples = new Set<string>();
    for (const z of zones) {
      for (const sName of [z.sampleLow, z.sampleHigh]) {
        if (sName && !seenSamples.has(sName)) {
          seenSamples.add(sName);
          const buf = this.sampleBuffers.get(sName);
          if (buf) {
            sourceSamples.push({ name: sName, data: new Uint8Array(buf) });
          }
        }
      }
    }

    return buildModelExportZip({
      slot: activeSlot,
      name: modelName,
      zones,
      zoneBinaries,
      mapScriptVersion: this.modelMapScriptVersions.get(activeSlot),
      neuronikModelJson: model?.neuronikModelJson,
      targetFormat:
        this.session?.processConfig.targetFormat ?? model?.targetFormat ?? 'legacy-neuron',
      sourceSamples,
    });
  }

  public async exportModel(slot: number, targetPath: string): Promise<void> {
    const existingModel = this.generatedModels.find((m) => m.slot === slot);
    const activeSlot = existingModel?.slot ?? slot;
    const modelName =
      existingModel?.name ??
      this.session?.processConfig.modelName ??
      `Model${activeSlot}`;
    const zoneCount =
      existingModel?.zoneCount ?? this.session?.zones.length ?? 1;
    const complexity =
      existingModel?.complexity ?? this.session?.processConfig.complexity ?? 8;
    const parameterSet =
      existingModel?.parameterSet ??
      this.session?.processConfig.parameterSet ??
      0;

    const lowerTarget = targetPath.toLowerCase();
    const wantsJsonOnly = lowerTarget.endsWith('.nmmodel') || lowerTarget.endsWith('.neuronikmodel');
    if (wantsJsonOnly) {
      const jsonContent =
        existingModel?.neuronikModelJson ??
        JSON.stringify(
          {
            name: modelName,
            slot: activeSlot,
            zoneCount,
            complexity,
            parameterSet,
            createdAt: existingModel?.createdAt ?? new Date().toISOString(),
            format: 2,
          },
          null,
          2
        );

      if (typeof document !== 'undefined') {
        const blob = new Blob([jsonContent], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download =
          targetPath.split(/[\\/]/).pop() ??
          `Model_${String(activeSlot).padStart(3, '0')}.nmmodel`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
      return;
    }

    const zipBytes = this.buildModelZipBytes(activeSlot);
    if (typeof document !== 'undefined') {
      const blob = new Blob([zipBytes as unknown as BlobPart], {
        type: 'application/zip',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = modelName.replace(/[^A-Za-z0-9_-]/g, '_');
      const defaultZipName = `NeuronModel_${String(activeSlot).padStart(3, '0')}_${safeName}.zip`;
      const requestedName = targetPath.split(/[\\/]/).pop() ?? defaultZipName;
      a.download = requestedName.endsWith('.zip')
        ? requestedName
        : defaultZipName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }

  /**
   * Exports a zone's audio buffer as a canonical Hartmann MODELmaker v1.2
   * 44100 Hz, 16-bit, Mono Big-Endian `FORM/AIFF` file with `INST` chunk
   * (`rootKey`, `lowKey`, `highKey`, `detune`, `gainDb`) and triggers a browser download.
   */
  public exportZoneAsAiff(zoneId: string): { filename: string; bytes: Uint8Array } {
    if (!this.session) {
      throw new Error('No active session');
    }
    const zone =
      this.session.zones.find((z) => z.id === zoneId) ?? this.session.zones[0];
    if (!zone) {
      throw new Error('No zone available to export');
    }

    this.ensureZoneDemoBuffers([zone]);
    const sampleName = zone.sampleLow ?? `Zone_${zone.rootKey}.wav`;
    const raw =
      this.sampleBuffers.get(sampleName) ??
      synthesizeDemoWav('strings', zone.rootKey, 44100, 1.0);
    const decoded = decodeWav(raw);
    const mono44k = resampleAudioChannel(decoded.mono, decoded.sampleRate, 44100);

    const aiffAb = encodeAiffPcm16([mono44k], 44100, {
      rootKey: zone.rootKey,
      lowKey: zone.lowKey,
      highKey: zone.highKey,
      lowVelocity: 1,
      highVelocity: 127,
      detune: Math.round(zone.detune),
      gainDb: Math.round(zone.volume),
    });

    const basePrefix = sampleName
      .split(/[\\/]/)
      .pop()!
      .replace(/\.[^.]+$/, '')
      .replace(/[^A-Za-z0-9]/g, '');
    const rrr = String(zone.rootKey).padStart(3, '0');
    const lll = String(zone.lowKey).padStart(3, '0');
    const filename = `${basePrefix || 'Zone'}_${rrr}_${lll}_v1.aif`;
    const bytes = new Uint8Array(aiffAb);

    if (typeof document !== 'undefined') {
      const blob = new Blob([aiffAb], { type: 'audio/aiff' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    return { filename, bytes };
  }

  public async importModel(
    _sourcePath: string,
    slot: number
  ): Promise<GeneratedModel> {
    const model: GeneratedModel = {
      slot,
      name: `Imported${slot}`,
      zoneCount: 1,
      complexity: 8,
      parameterSet: 0,
      createdAt: new Date().toISOString(),
      path: `Models/${String(slot).padStart(3, '0')}.model`,
    };
    this.generatedModels = this.generatedModels.filter((m) => m.slot !== slot);
    this.generatedModels.push(model);
    this.persistToLocalStorage();
    const bank = await this.loadBank();
    this.emit({ type: 'bank-updated', bank });
    return model;
  }

  // ── Private Helpers ─────────────────────────────────────

  private finalizeModelGeneration(
    config: ProcessConfig,
    zoneCount: number,
    zonesAnalysis: ZoneAnalysisSummary[],
    zoneBinaries: ZoneBinaryPair[],
    neuronikModelJson: string,
    elapsedMs: number
  ): void {
    this.modelZoneBinaries.set(config.modelNumber, zoneBinaries);

    const model: GeneratedModel = {
      slot: config.modelNumber,
      name: config.modelName,
      zoneCount,
      complexity: config.complexity,
      parameterSet: config.parameterSet,
      createdAt: new Date().toISOString(),
      path: `Models/${String(config.modelNumber).padStart(3, '0')}.model`,
      targetFormat: config.targetFormat ?? 'dual',
      zonesAnalysis,
      neuronikModelJson,
    };

    this.generatedModels = this.generatedModels.filter(
      (m) => m.slot !== model.slot
    );
    this.generatedModels.push(model);
    this.persistToLocalStorage();

    const firstSummary = zonesAnalysis[0];
    const summaryText = firstSummary
      ? ` (f0=${firstSummary.detectedF0Hz} Hz, ${firstSummary.gridNotice}, ${firstSummary.activePartials} partials)`
      : '';

    this.processProgress = {
      status: 'completed',
      currentZone: zoneCount,
      totalZones: zoneCount,
      currentSample: '',
      percent: 100,
      message: `Model "${config.modelName}" generated successfully${summaryText}`,
      elapsedMs,
    };

    this.emit({
      type: 'process-progress',
      progress: { ...this.processProgress },
    });
    this.emit({ type: 'process-complete', model });
  }

  private ensureZoneDemoBuffers(zones: Zone[]): void {
    for (const z of zones) {
      if (z.sampleLow && !this.sampleBuffers.has(z.sampleLow)) {
        const lower = z.sampleLow.toLowerCase();
        const timbre = lower.includes('bass')
          ? 'bass'
          : lower.includes('piano')
            ? 'piano'
            : lower.includes('bell')
              ? 'bell'
              : lower.includes('pad')
                ? 'pad'
                : 'strings';
        this.sampleBuffers.set(
          z.sampleLow,
          synthesizeDemoWav(timbre, z.rootKey, 44100, 1.0)
        );
      }
    }
  }

  private terminateWorker(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  private markDirty(): void {
    if (this.session) {
      this.session.dirty = true;
      this.session.modifiedAt = new Date().toISOString();
      this.persistToLocalStorage();
      this.emit({ type: 'session-changed', session: this.session });
    }
  }

  private persistToLocalStorage(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      if (this.session) {
        localStorage.setItem(
          STORAGE_SESSION_KEY,
          JSON.stringify(this.session)
        );
      }
      // Persist generated models metadata (cap neuronikModelJson size to avoid quota issues)
      const lightModels = this.generatedModels.map((m) => ({
        ...m,
        neuronikModelJson:
          m.neuronikModelJson && m.neuronikModelJson.length < 250000
            ? m.neuronikModelJson
            : undefined,
      }));
      localStorage.setItem(STORAGE_BANK_KEY, JSON.stringify(lightModels));
    } catch {
      // Ignore storage quota or private-mode errors
    }
  }

  private restoreFromLocalStorage(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const rawBank = localStorage.getItem(STORAGE_BANK_KEY);
      if (rawBank) {
        const parsedBank = JSON.parse(rawBank) as GeneratedModel[];
        if (Array.isArray(parsedBank) && parsedBank.length > 0) {
          this.generatedModels = parsedBank;
        }
      }
      const rawSession = localStorage.getItem(STORAGE_SESSION_KEY);
      if (rawSession) {
        const parsedSession = JSON.parse(rawSession) as Session;
        if (
          parsedSession &&
          Array.isArray(parsedSession.zones) &&
          parsedSession.zones.length > 0
        ) {
          if (
            parsedSession.zones.length === 1 &&
            parsedSession.zones[0].sampleLow === 'Strings_60_C4.wav' &&
            DEFAULT_MODEL_NAMES.has(parsedSession.processConfig?.modelName?.trim() ?? '')
          ) {
            parsedSession.zones[0].sampleLow = null;
          }
          this.session = parsedSession;
          this.ensureZoneDemoBuffers(this.session.zones);
        }
      }
    } catch {
      // Ignore malformed localStorage state
    }
  }
}
