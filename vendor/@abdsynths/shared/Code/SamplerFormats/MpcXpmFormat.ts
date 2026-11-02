// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Akai MPC Program Format (.xpm / .xpn) — Fase 31
//
// Clean-room implementation built from real MPC files and format facts
// cross-checked against ConvertWithMoss (Juergen Mossgraber, LGPL-3.0),
// used only as a format reference; no code was translated.
//
// - Reader: MPC2 XML (.xpm, <MPCVObject>) Keygroup + Drum programs, and
//   MPC3 GZIP+JSON programs ("ACVS" header)
// - Writer: MPC2 XML Keygroup / Drum programs (128 instruments x 4 layers)
// - Expansion: .xpn (flat ZIP with Expansion.xml, programs, WAVs, artwork)
//
// Conventions (from real files):
//   RootNote = MIDI note + 1 (0 = unset, used by drum layers)
//   SampleName = file name without extension; WAV sits next to the .xpm
//   Floats 6 decimals, booleans "True"/"False"
//   Envelope times 0..1 log: sec = 0.001 * 1e5^v (1 ms .. 100 s)
//   Cutoff 0..1: Hz = 880 * 2^((v*140 - 57)/12)
//   ZonePlay: 0 cycle (round robin), 1 velocity, 2 random
//   TriggerMode: 0 one-shot, 1 note-off (release), 2 note-on
// ─────────────────────────────────────────────────────────

export type MpcProgramType = 'Keygroup' | 'Drum';

export interface MpcLayer {
  sampleName: string;
  sampleFile?: string;
  rootNote: number;      // MIDI note (already corrected, -1 if unset)
  velStart: number;
  velEnd: number;
  volume: number;        // linear gain
  pan: number;           // 0..1, 0.5 = centre
  tuneCoarse: number;    // semitones
  tuneFine: number;      // cents
  sampleStart: number;
  sampleEnd: number;
  sliceIndex?: number;
  loopStart: number;
  loopEnd: number;
  loopEnabled: boolean;
  keyTrack: boolean;
}

export interface MpcEnvelope {
  attackSec: number;
  holdSec: number;
  decaySec: number;
  sustain: number;
  releaseSec: number;
}

export interface MpcInstrument {
  number: number;
  lowNote: number;
  highNote: number;
  ignoreBaseNote: boolean;
  zonePlay: number;
  triggerMode: number;
  muteGroup: number;
  filterType: number;
  cutoffHz: number;
  resonance: number;
  volumeEnv: MpcEnvelope;
  tuneCoarse: number;
  tuneFine: number;
  layers: MpcLayer[];
}

export interface MpcProgram {
  name: string;
  type: MpcProgramType;
  instruments: MpcInstrument[];
  padNotes: number[];    // index = pad (0..127) -> MIDI note
  sourceVariant: 'mpc2-xml' | 'mpc3-json';
}

// ─── Unit conversions ────────────────────────────────────────────────────
const LN_RANGE = Math.log(100 / 0.001);

export function mpcEnvToSeconds(v: number): number {
  return 0.001 * Math.exp(Math.max(0, Math.min(1, v)) * LN_RANGE);
}

export function secondsToMpcEnv(sec: number): number {
  const s = Math.max(0.001, Math.min(100, sec));
  return Math.log(s / 0.001) / LN_RANGE;
}

export function mpcCutoffToHz(v: number): number {
  const hz = 880 * Math.pow(2, (Math.max(0, Math.min(1, v)) * 140 - 57) / 12);
  return Math.max(32.7, Math.min(106300, hz));
}

export function hzToMpcCutoff(hz: number): number {
  const v = (Math.log2(Math.max(32.7, hz) / 880) * 12 + 57) / 140;
  return Math.max(0, Math.min(1, v));
}

export function dbToMpcGain(db: number): number {
  return Math.pow(10, db / 20);
}

export function mpcGainToDb(g: number): number {
  return g <= 0 ? -96 : 20 * Math.log10(g);
}

const f6 = (n: number): string => (Number.isFinite(n) ? n : 0).toFixed(6);
const bool = (b: boolean): string => (b ? 'True' : 'False');
const xmlEsc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const xmlUnesc = (s: string): string =>
  s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// ─── Minimal tag helpers (no DOM dependency; works in Node tests) ────────
function tagText(block: string, name: string): string | undefined {
  const m = new RegExp(`<${name}>([^<]*)</${name}>`).exec(block);
  if (m) return xmlUnesc(m[1]);
  if (new RegExp(`<${name}\\s*/>`).test(block)) return '';
  return undefined;
}

function tagNum(block: string, name: string, fallback: number): number {
  const s = tagText(block, name);
  if (s === undefined || s === '') return fallback;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : fallback;
}

function tagBool(block: string, name: string, fallback: boolean): boolean {
  const s = tagText(block, name);
  if (s === undefined) return fallback;
  return s.trim().toLowerCase() === 'true';
}

function blocks(xml: string, name: string): Array<{ attrs: string; body: string }> {
  const out: Array<{ attrs: string; body: string }> = [];
  const re = new RegExp(`<${name}\\b([^>]*)>([\\s\\S]*?)</${name}>`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push({ attrs: m[1], body: m[2] });
  return out;
}

function attrNum(attrs: string, name: string, fallback: number): number {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(attrs);
  return m ? parseInt(m[1], 10) : fallback;
}

// ─── Reader: MPC2 XML ────────────────────────────────────────────────────
export function isMpcXml(text: string): boolean {
  return /<MPCVObject>/.test(text.slice(0, 2048));
}

export function parseMpcXpmXml(xml: string): MpcProgram {
  const programMatch = /<Program\s+type="([^"]+)"/.exec(xml);
  const type: MpcProgramType = programMatch && /drum/i.test(programMatch[1]) ? 'Drum' : 'Keygroup';
  // MPC 2.x uses <ProgramName>; MPC 1.x (File_Version 1.7) uses <Name>
  const name = tagText(xml, 'ProgramName')?.trim() || tagText(xml, 'Name')?.trim() || 'MPC Program';

  const numKeygroups = type === 'Keygroup' ? tagNum(xml, 'KeygroupNumKeygroups', 128) : 128;

  const padNotes: number[] = [];
  for (const pn of blocks(xml, 'PadNote')) {
    const idx = attrNum(pn.attrs, 'number', 0) - 1;
    if (idx >= 0 && idx < 128) padNotes[idx] = tagNum(pn.body, 'Note', idx);
  }
  for (let i = 0; i < 128; i++) if (padNotes[i] === undefined) padNotes[i] = type === 'Drum' ? 36 + i : i;

  const instruments: MpcInstrument[] = [];
  for (const inst of blocks(xml, 'Instrument')) {
    const number = attrNum(inst.attrs, 'number', instruments.length + 1);
    if (type === 'Keygroup' && number > numKeygroups) continue;

    const layersXml = /<Layers>([\s\S]*?)<\/Layers>/.exec(inst.body)?.[1] ?? '';
    const head = inst.body.slice(0, inst.body.indexOf('<Layers>') >= 0 ? inst.body.indexOf('<Layers>') : undefined);

    const layers: MpcLayer[] = [];
    for (const l of blocks(layersXml, 'Layer')) {
      const sampleName = tagText(l.body, 'SampleName') ?? '';
      if (!sampleName.trim()) continue;
      if (!tagBool(l.body, 'Active', true)) continue;
      const rawRoot = tagNum(l.body, 'RootNote', 0);
      const sliceLoop = tagNum(l.body, 'SliceLoop', 0);
      const loopStart = tagNum(l.body, 'SliceLoopStart', tagNum(l.body, 'LoopStart', 0));
      const loopEnd = tagNum(l.body, 'SliceEnd', tagNum(l.body, 'LoopEnd', 0));
      layers.push({
        sampleName,
        sampleFile: tagText(l.body, 'SampleFile') || undefined,
        rootNote: rawRoot > 0 ? rawRoot - 1 : -1,
        velStart: tagNum(l.body, 'VelStart', 0),
        velEnd: tagNum(l.body, 'VelEnd', 127),
        volume: tagNum(l.body, 'Volume', 1),
        pan: tagNum(l.body, 'Pan', 0.5),
        tuneCoarse: tagNum(l.body, 'TuneCoarse', 0),
        tuneFine: tagNum(l.body, 'TuneFine', 0),
        sampleStart: tagNum(l.body, 'SliceStart', tagNum(l.body, 'SampleStart', 0)),
        sampleEnd: tagNum(l.body, 'SliceEnd', tagNum(l.body, 'SampleEnd', 0)),
        sliceIndex: tagNum(l.body, 'SliceIndex', 128),
        loopStart,
        loopEnd,
        loopEnabled: sliceLoop !== 0,
        keyTrack: tagBool(l.body, 'KeyTrack', false),
      });
    }
    if (layers.length === 0) continue;

    let triggerMode = tagNum(head, 'TriggerMode', -1);
    if (triggerMode < 0) triggerMode = tagBool(head, 'OneShot', false) ? 0 : 2;

    instruments.push({
      number,
      lowNote: tagNum(head, 'LowNote', 0),
      highNote: tagNum(head, 'HighNote', 127),
      ignoreBaseNote: tagBool(head, 'IgnoreBaseNote', false),
      zonePlay: tagNum(head, 'ZonePlay', 1),
      triggerMode,
      muteGroup: tagNum(head, 'MuteGroup', 0),
      filterType: tagNum(head, 'FilterType', 0),
      cutoffHz: mpcCutoffToHz(tagNum(head, 'Cutoff', 1)),
      resonance: tagNum(head, 'Resonance', 0),
      volumeEnv: {
        attackSec: mpcEnvToSeconds(tagNum(head, 'VolumeAttack', 0)),
        holdSec: mpcEnvToSeconds(tagNum(head, 'VolumeHold', 0)),
        decaySec: mpcEnvToSeconds(tagNum(head, 'VolumeDecay', 0)),
        sustain: tagNum(head, 'VolumeSustain', 1),
        releaseSec: mpcEnvToSeconds(tagNum(head, 'VolumeRelease', 0.63)),
      },
      tuneCoarse: tagNum(head, 'TuneCoarse', 0),
      tuneFine: tagNum(head, 'TuneFine', 0),
      layers,
    });
  }

  return { name, type, instruments, padNotes, sourceVariant: 'mpc2-xml' };
}

// ─── Reader: MPC3 GZIP + JSON ────────────────────────────────────────────
export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

export async function gunzip(bytes: Uint8Array): Promise<string> {
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([bytes.slice()]).stream().pipeThrough(ds);
  return new TextDecoder('utf-8').decode(await new Response(stream).arrayBuffer());
}

type JsonObj = Record<string, unknown>;
const asObj = (v: unknown): JsonObj => (v && typeof v === 'object' ? (v as JsonObj) : {});
const asNum = (v: unknown, d: number): number => {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const o = asObj(v);
  if (typeof o.value0 === 'number') return o.value0;
  if (typeof o.controlValue === 'number') return o.controlValue;
  if (typeof o.gainCoefficient === 'number') return o.gainCoefficient;
  return d;
};
const asStr = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Recursively collect every object that has a `layersv` array (MPC3 instruments). */
function findInstruments(node: unknown, out: JsonObj[], depth = 0): void {
  if (depth > 12 || !node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) findInstruments(n, out, depth + 1);
    return;
  }
  const o = node as JsonObj;
  if (Array.isArray(o.layersv)) {
    out.push(o);
    return;
  }
  for (const v of Object.values(o)) findInstruments(v, out, depth + 1);
}

export function parseMpcJsonProgram(text: string): MpcProgram {
  const start = text.indexOf('{');
  if (start < 0) throw new Error('MPC3 program: JSON body not found');
  const root = asObj(JSON.parse(text.slice(start)));
  const data = asObj(root.data ?? root);
  // MPC 3 track files (.xty/.xtd) nest the program under data.program
  const prog = asObj(data.program ?? data);
  const name = asStr(prog.name) || asStr(data.name) || 'MPC Program';
  // Verified on real files: program.type 0 = Drum, 1 = Keygroup (keygroups also carry a "drum" object)
  const typeRaw = prog.type ?? data.type;
  const isDrum =
    (typeof typeRaw === 'string' && /drum/i.test(typeRaw)) ||
    (typeof typeRaw === 'number' && typeRaw === 0);
  const type: MpcProgramType = isDrum ? 'Drum' : 'Keygroup';

  const found: JsonObj[] = [];
  findInstruments(data, found);
  const instruments: MpcInstrument[] = [];
  found.forEach((inst, i) => {
    const layers: MpcLayer[] = [];
    for (const lv of inst.layersv as unknown[]) {
      const l = asObj(lv);
      const sampleName = asStr(l.sampleName);
      if (!sampleName.trim() || l.active === false) continue;
      const rawRoot = asNum(l.rootNote, 0);
      const slice = asObj(l.sliceInfo);
      const sStart = asNum(l.sampleStart, 0);
      const sEnd = asNum(l.sampleEnd, 0);
      layers.push({
        sampleName,
        sampleFile: asStr(l.sampleFile) || undefined,
        rootNote: rawRoot > 0 ? rawRoot - 1 : -1,
        velStart: asNum(l.velocityStart, 0),
        velEnd: asNum(l.velocityEnd, 127),
        volume: asNum(l.volume, 1),
        pan: asNum(l.pan, 0.5),
        tuneCoarse: asNum(l.coarseTune, 0),
        tuneFine: asNum(l.fineTune, 0),
        sampleStart: sStart > 0 ? sStart : asNum(slice.Start, 0),
        sampleEnd: sEnd > 0 ? sEnd : asNum(slice.End, 0),
        sliceIndex: asNum(l.sliceIndex, 128),
        loopStart: asNum(l.loopStart, asNum(slice.LoopStart, 0)),
        loopEnd: asNum(l.loopEnd, 0),
        loopEnabled: asNum(l.loop, asNum(slice.LoopMode, 0)) !== 0,
        keyTrack: Boolean(l.keyTrackEnable),
      });
    }
    if (layers.length === 0) return;
    instruments.push({
      number: i + 1,
      lowNote: asNum(inst.lowNote, 0),
      highNote: asNum(inst.highNote, 127),
      ignoreBaseNote: Boolean(inst.ignoreBaseNote),
      zonePlay: asNum(inst.zonePlay, 1),
      triggerMode: asNum(inst.triggerMode, 2),
      muteGroup: asNum(inst.muteGroup, 0),
      filterType: 0,
      cutoffHz: 20000,
      resonance: 0,
      volumeEnv: { attackSec: 0.001, holdSec: 0.001, decaySec: 0.001, sustain: 1, releaseSec: mpcEnvToSeconds(0.63) },
      tuneCoarse: 0,
      tuneFine: 0,
      layers,
    });
  });

  const padNotes = Array.from({ length: 128 }, (_, i) => (type === 'Drum' ? 36 + i : i));
  return { name, type, instruments, padNotes, sourceVariant: 'mpc3-json' };
}

/** Parse any .xpm (MPC2 XML or MPC3 GZIP/JSON). */
export async function parseMpcXpm(bytes: Uint8Array): Promise<MpcProgram> {
  if (isGzip(bytes)) return parseMpcJsonProgram(await gunzip(bytes));
  const text = new TextDecoder('utf-8').decode(bytes);
  if (isMpcXml(text)) return parseMpcXpmXml(text);
  if (/^\s*ACVS/.test(text) || text.trimStart().startsWith('{')) return parseMpcJsonProgram(text);
  throw new Error('Not an Akai MPC program (.xpm)');
}

// ─── Writer: MPC2 XML ────────────────────────────────────────────────────
export interface MpcWriteLayer {
  sampleName: string;    // without extension
  rootNote: number;      // MIDI
  velStart: number;
  velEnd: number;
  volumeDb: number;
  pan: number;           // -50..+50
  tuneCents: number;
  loopStart: number;
  loopEnd: number;
  loopEnabled: boolean;
  sampleFrames: number;
}

export interface MpcWriteInstrument {
  lowNote: number;
  highNote: number;
  zonePlay: number;
  triggerMode: number;
  ignoreBaseNote: boolean;
  muteGroup: number;
  layers: MpcWriteLayer[];   // max 4
}

export interface MpcWriteOptions {
  name: string;
  type: MpcProgramType;
  instruments: MpcWriteInstrument[];
  envelope?: { attackSec: number; holdSec: number; decaySec: number; sustain: number; releaseSec: number };
  filter?: { type: number; cutoffHz: number; resonance: number };
}

function layerXml(n: number, l: MpcWriteLayer | undefined, drum: boolean): string {
  const used = Boolean(l);
  const coarse = l ? Math.trunc(l.tuneCents / 100) : 0;
  const fine = l ? Math.round(l.tuneCents - coarse * 100) : 0;
  const vol = l ? Math.max(0, Math.min(1, dbToMpcGain(l.volumeDb))) : 1;
  const pan = l ? Math.max(0, Math.min(1, (l.pan + 50) / 100)) : 0.5;
  const root = l ? (drum ? 0 : Math.max(0, Math.min(127, l.rootNote)) + 1) : 0;
  const loop = Boolean(l && l.loopEnabled && l.loopEnd > l.loopStart);
  return [
    `        <Layer number="${n}">`,
    `          <Active>True</Active>`,
    `          <Volume>${f6(vol)}</Volume>`,
    `          <Pan>${f6(pan)}</Pan>`,
    `          <Pitch>${f6(coarse + fine / 100)}</Pitch>`,
    `          <TuneCoarse>${coarse}</TuneCoarse>`,
    `          <TuneFine>${fine}</TuneFine>`,
    `          <VelStart>${l ? l.velStart : 0}</VelStart>`,
    `          <VelEnd>${l ? l.velEnd : 127}</VelEnd>`,
    `          <SampleStart>0</SampleStart>`,
    `          <SampleEnd>0</SampleEnd>`,
    `          <LoopStart>${loop && l ? l.loopStart : 0}</LoopStart>`,
    `          <LoopEnd>${loop && l ? l.loopEnd : 0}</LoopEnd>`,
    `          <LoopCrossfadeLength>0</LoopCrossfadeLength>`,
    `          <LoopTune>0</LoopTune>`,
    `          <RootNote>${root}</RootNote>`,
    `          <KeyTrack>${bool(!drum && used)}</KeyTrack>`,
    `          <SampleName>${l ? xmlEsc(l.sampleName) : ''}</SampleName>`,
    `          <PitchRandom>0.000000</PitchRandom>`,
    `          <VolumeRandom>0.000000</VolumeRandom>`,
    `          <PanRandom>0.000000</PanRandom>`,
    `          <OffsetRandom>0.000000</OffsetRandom>`,
    `          <SampleFile></SampleFile>`,
    `          <SliceIndex>${used ? 0 : 128}</SliceIndex>`,
    `          <Direction>0</Direction>`,
    `          <Offset>0</Offset>`,
    `          <SliceStart>0</SliceStart>`,
    `          <SliceEnd>${l ? l.sampleFrames : 0}</SliceEnd>`,
    `          <SliceLoopStart>${loop && l ? l.loopStart : 0}</SliceLoopStart>`,
    `          <SliceLoop>${loop ? 1 : 0}</SliceLoop>`,
    `          <SliceLoopCrossFadeLength>${used ? -1 : 0}</SliceLoopCrossFadeLength>`,
    `          <SliceTailPosition>0.500000</SliceTailPosition>`,
    `          <SliceTailLength>0.000000</SliceTailLength>`,
    `        </Layer>`,
  ].join('\n');
}

function instrumentXml(n: number, inst: MpcWriteInstrument | undefined, opts: MpcWriteOptions): string {
  const drum = opts.type === 'Drum';
  const env = opts.envelope ?? { attackSec: 0.001, holdSec: 0.001, decaySec: 0.001, sustain: 1, releaseSec: 0.25 };
  const flt = opts.filter ?? { type: 0, cutoffHz: 106300, resonance: 0 };
  const low = inst ? inst.lowNote : drum ? 0 : 0;
  const high = inst ? inst.highNote : 127;
  const layers = [1, 2, 3, 4].map((ln) => layerXml(ln, inst?.layers[ln - 1], drum)).join('\n');
  return [
    `      <Instrument number="${n}">`,
    `        <CueBusEnable>False</CueBusEnable>`,
    `        <AudioRoute><AudioRoute>0</AudioRoute><AudioRouteSubIndex>0</AudioRouteSubIndex><AudioRouteChannelBitmap>3</AudioRouteChannelBitmap><InsertsEnabled>True</InsertsEnabled></AudioRoute>`,
    `        <Send1>0.000000</Send1>`,
    `        <Send2>0.000000</Send2>`,
    `        <Send3>0.000000</Send3>`,
    `        <Send4>0.000000</Send4>`,
    `        <Volume>0.707946</Volume>`,
    `        <Mute>False</Mute>`,
    `        <Solo>False</Solo>`,
    `        <Pan>0.500000</Pan>`,
    `        <AutomationFilter>1</AutomationFilter>`,
    `        <FilterKeytrack>0.000000</FilterKeytrack>`,
    `        <FilterType>${flt.type}</FilterType>`,
    `        <Cutoff>${f6(hzToMpcCutoff(flt.cutoffHz))}</Cutoff>`,
    `        <Resonance>${f6(Math.max(0, Math.min(1, flt.resonance)))}</Resonance>`,
    `        <FilterEnvAmt>0.000000</FilterEnvAmt>`,
    `        <VolumeHold>${f6(secondsToMpcEnv(env.holdSec))}</VolumeHold>`,
    `        <VolumeAttack>${f6(secondsToMpcEnv(env.attackSec))}</VolumeAttack>`,
    `        <VolumeDecay>${f6(secondsToMpcEnv(env.decaySec))}</VolumeDecay>`,
    `        <VolumeSustain>${f6(Math.max(0, Math.min(1, env.sustain)))}</VolumeSustain>`,
    `        <VolumeRelease>${f6(secondsToMpcEnv(env.releaseSec))}</VolumeRelease>`,
    `        <TuneCoarse>0</TuneCoarse>`,
    `        <TuneFine>0</TuneFine>`,
    `        <Mono>False</Mono>`,
    `        <Polyphony>0</Polyphony>`,
    `        <LowNote>${low}</LowNote>`,
    `        <HighNote>${high}</HighNote>`,
    `        <IgnoreBaseNote>${bool(inst ? inst.ignoreBaseNote : false)}</IgnoreBaseNote>`,
    `        <ZonePlay>${inst ? inst.zonePlay : 1}</ZonePlay>`,
    `        <MuteGroup>${inst ? inst.muteGroup : 0}</MuteGroup>`,
    `        <TriggerMode>${inst ? inst.triggerMode : drum ? 0 : 2}</TriggerMode>`,
    `        <Layers>`,
    layers,
    `        </Layers>`,
    `      </Instrument>`,
  ].join('\n');
}

/** Generate an MPC2-style XML program (always 128 instruments x 4 layers). */
export function writeMpcXpm(opts: MpcWriteOptions): string {
  const drum = opts.type === 'Drum';
  const insts = opts.instruments.slice(0, 128);
  const instXml = Array.from({ length: 128 }, (_, i) => instrumentXml(i + 1, insts[i], opts)).join('\n');
  const padNotes = Array.from(
    { length: 128 },
    (_, i) => `      <PadNote number="${i + 1}"><Note>${drum ? Math.min(127, 36 + i) : i}</Note></PadNote>`,
  ).join('\n');
  const padGroups = Array.from(
    { length: 128 },
    (_, i) => `      <PadGroup number="${i + 1}"><Group>0</Group></PadGroup>`,
  ).join('\n');
  const keygroupFields = drum
    ? ''
    : [
        `    <KeygroupMasterTranspose>0.500000</KeygroupMasterTranspose>`,
        `    <KeygroupNumKeygroups>${Math.max(1, insts.length)}</KeygroupNumKeygroups>`,
        `    <KeygroupPitchBendRange>${f6(200 / 1200)}</KeygroupPitchBendRange>`,
        `    <KeygroupWheelToLfo>1.000000</KeygroupWheelToLfo>`,
        `    <KeygroupAftertouchToFilter>0.000000</KeygroupAftertouchToFilter>`,
      ].join('\n') + '\n';

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n\n` +
    `<MPCVObject>\n` +
    `  <Version>\n` +
    `    <File_Version>2.1</File_Version>\n` +
    `    <Application>MPC-V</Application>\n` +
    `    <Application_Version>2.10.0.0</Application_Version>\n` +
    `    <Platform>Windows</Platform>\n` +
    `  </Version>\n` +
    `  <Program type="${opts.type}">\n` +
    `    <ProgramName>${xmlEsc(opts.name)}</ProgramName>\n` +
    `    <CueBusEnable>False</CueBusEnable>\n` +
    `    <Volume>0.707946</Volume>\n` +
    `    <Mute>False</Mute>\n` +
    `    <Solo>False</Solo>\n` +
    `    <Pan>0.500000</Pan>\n` +
    `    <AutomationFilter>1</AutomationFilter>\n` +
    `    <Pitch>0.000000</Pitch>\n` +
    `    <TuneCoarse>0</TuneCoarse>\n` +
    `    <TuneFine>0</TuneFine>\n` +
    `    <Mono>False</Mono>\n` +
    `    <Program_Polyphony>0</Program_Polyphony>\n` +
    `    <PortamentoTime>0.000000</PortamentoTime>\n` +
    `    <PortamentoLegato>False</PortamentoLegato>\n` +
    `    <PortamentoQuantized>False</PortamentoQuantized>\n` +
    `    <Program.Xfader.Route>0</Program.Xfader.Route>\n` +
    `    <Instruments>\n${instXml}\n    </Instruments>\n` +
    `    <PadNoteMap>\n${padNotes}\n    </PadNoteMap>\n` +
    `    <PadGroupMap>\n${padGroups}\n    </PadGroupMap>\n` +
    keygroupFields +
    `  </Program>\n` +
    `</MPCVObject>\n`
  );
}

// ─── Region grouping helper for the writer ───────────────────────────────
export interface MpcSourceRegion {
  sampleName: string;
  lowKey: number;
  highKey: number;
  rootKey: number;
  lowVel: number;
  highVel: number;
  volumeDb: number;
  pan: number;
  tuneCents: number;
  loopStart: number;
  loopEnd: number;
  loopEnabled: boolean;
  sampleFrames: number;
  release?: boolean;
  seqPosition?: number;
}

/**
 * Groups generic key/velocity regions into MPC keygroups (max 4 layers each).
 * Regions sharing a key range form one keygroup; overflow beyond 4 layers
 * spills into additional overlapping keygroups. Round-robin regions use
 * ZonePlay=cycle, release regions TriggerMode=note-off.
 */
export function regionsToMpcInstruments(regions: MpcSourceRegion[], type: MpcProgramType): MpcWriteInstrument[] {
  const groups = new Map<string, MpcSourceRegion[]>();
  for (const r of regions) {
    const key = `${r.lowKey}-${r.highKey}-${r.release ? 'r' : 'a'}`;
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }
  const out: MpcWriteInstrument[] = [];
  const sorted = [...groups.values()].sort((a, b) => a[0].lowKey - b[0].lowKey);
  for (const g of sorted) {
    g.sort((a, b) => a.lowVel - b.lowVel || (a.seqPosition ?? 0) - (b.seqPosition ?? 0));
    const isRR = g.some((r) => (r.seqPosition ?? 0) > 1);
    for (let i = 0; i < g.length; i += 4) {
      const chunk = g.slice(i, i + 4);
      const drum = type === 'Drum';
      out.push({
        lowNote: drum ? 0 : chunk[0].lowKey,
        highNote: drum ? 127 : chunk[0].highKey,
        zonePlay: isRR ? 0 : 1,
        triggerMode: chunk[0].release ? 1 : drum ? 0 : 2,
        ignoreBaseNote: drum,
        muteGroup: 0,
        layers: chunk.map((r) => ({
          sampleName: r.sampleName.replace(/\.(wav|aif|aiff|flac)$/i, ''),
          rootNote: r.rootKey,
          velStart: Math.max(0, r.lowVel),
          velEnd: Math.min(127, r.highVel),
          volumeDb: r.volumeDb,
          pan: r.pan,
          tuneCents: r.tuneCents,
          loopStart: r.loopStart,
          loopEnd: r.loopEnd,
          loopEnabled: r.loopEnabled,
          sampleFrames: r.sampleFrames,
        })),
      });
    }
  }
  return out;
}

// ─── Expansion (.xpn) ────────────────────────────────────────────────────
export interface XpnMetadata {
  identifier: string;
  title: string;
  manufacturer: string;
  version: string;
  type: 'drum' | 'instrument';
  description: string;
  imageName?: string;
}

export function buildExpansionXml(m: XpnMetadata): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n\n` +
    `<expansion version="2.0.0.0" buildVersion="2.10.0.0">\n` +
    `  <local/>\n` +
    `  <identifier>${xmlEsc(m.identifier)}</identifier>\n` +
    `  <title>${xmlEsc(m.title)}</title>\n` +
    `  <manufacturer>${xmlEsc(m.manufacturer)}</manufacturer>\n` +
    `  <version>${xmlEsc(m.version)}</version>\n` +
    `  <type>${m.type}</type>\n` +
    `  <priority>50</priority>\n` +
    (m.imageName ? `  <img>${xmlEsc(m.imageName)}</img>\n` : '') +
    `  <description>${xmlEsc(m.description)}</description>\n` +
    `  <separator>-</separator>\n` +
    `</expansion>\n`
  );
}

export function parseExpansionXml(xml: string): Partial<XpnMetadata> {
  return {
    identifier: tagText(xml, 'identifier'),
    title: tagText(xml, 'title'),
    manufacturer: tagText(xml, 'manufacturer'),
    version: tagText(xml, 'version'),
    description: tagText(xml, 'description'),
    imageName: tagText(xml, 'img'),
  };
}
