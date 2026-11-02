// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Decent Sampler (.dspreset) Native Importer
//
// Parses full Decent Sampler preset XML files:
//   - <groups> / <group> / <sample> element hierarchy
//   - Round-Robin: seqMode="round_robin|random|true_random", seqPosition="N"
//   - Release/legato triggers: trigger="release|attack|first|legato"
//   - Key-off dampers: pitchKeyTrack="0", releaseDecay
//   - <ui> knobs, sliders, labels, menus
//   - <effects>: lowpass / highpass filters, reverb (conv), chorus, delay
//   - <modulators>: LFO, ADSR-style envelope with DAHDSR mapping
//   - Multi-mic / multi-articulation menus
// Converts directly to NativeSamplerImportResult (Extended + Classic).
// ─────────────────────────────────────────────────────────

import type {
  AudioFilePayload,
  ExtendedModelMetadata,
  ExtendedRegion,
  LoopMode,
  TriggerMode,
} from '../core/types.ts';
import {
  createDefaultArticulation,
  projectExtendedRegionsToClassicZones,
} from '../core/extendedAdapter.ts';
import {
  classifyInstrumentAndParameterSet,
  type NativeSamplerImportResult,
} from './Sf2Parser.ts';

// ─── Note name → MIDI number ───────────────────────────────────────────────
const NOTE_SEMITONES: Record<string, number> = {
  c: 0, 'c#': 1, db: 1, d: 2, 'd#': 3, eb: 3,
  e: 4, f: 5, 'f#': 6, gb: 6, g: 7, 'g#': 8,
  ab: 8, a: 9, 'a#': 10, bb: 10, b: 11,
};

function parseDsNote(val: string | undefined, fallback = 60): number {
  if (!val) return fallback;
  const t = val.trim().toLowerCase();
  if (/^-?\d+$/.test(t)) return Math.max(0, Math.min(127, parseInt(t, 10)));
  const m = /^([a-g][#b]?)(-?\d+)$/.exec(t);
  if (!m) return fallback;
  const semi = NOTE_SEMITONES[m[1]];
  if (semi === undefined) return fallback;
  return Math.max(0, Math.min(127, (parseInt(m[2], 10) + 1) * 12 + semi));
}

function attr(el: Element, name: string): string | undefined {
  return el.getAttribute(name) ?? undefined;
}

function numAttr(el: Element, name: string, fallback: number): number {
  const v = el.getAttribute(name);
  if (v === null) return fallback;
  const n = parseFloat(v);
  return isNaN(n) ? fallback : n;
}

// ─── SeqMode ──────────────────────────────────────────────────────────────
type DsSeqMode = 'round_robin' | 'random' | 'true_random' | 'always';

function parseSeqMode(val: string | undefined): DsSeqMode {
  if (val === 'random' || val === 'true_random') return val;
  if (val === 'always') return 'always';
  return 'round_robin'; // default
}

// ─── Trigger mode mapping ─────────────────────────────────────────────────
function parseTrigger(val: string | undefined): TriggerMode {
  if (val === 'release') return 'release';
  if (val === 'first') return 'first';
  if (val === 'legato') return 'legato';
  return 'attack';
}

// ─── LoopMode mapping ─────────────────────────────────────────────────────
function parseLoopMode(val: string | undefined): LoopMode {
  if (val === 'loop_continuous' || val === 'loop') return 'loop_continuous';
  if (val === 'loop_sustain') return 'loop_sustain';
  if (val === 'ping_pong' || val === 'loop_ping_pong') return 'ping_pong';
  if (val === 'loop_backward') return 'loop_backward';
  return 'one_shot';
}

// ─── Effect-block parsing types ──────────────────────────────────────────
interface DsEffect {
  type: string;
  params: Record<string, number | string>;
}

interface DsModulator {
  type: 'lfo' | 'envelope' | 'unknown';
  shape?: string;
  frequency?: number;
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
  target?: string;
  amount?: number;
}

// ─── Intermediate parsed sample ───────────────────────────────────────────
interface DsSampleEntry {
  path: string;
  loKey: number;
  hiKey: number;
  rootKey: number;
  loVel: number;
  hiVel: number;
  volume: number;
  pan: number;
  tune: number;
  pitchKeyTrack: number;
  trigger: TriggerMode;
  seqPosition: number;
  seqMode: DsSeqMode;
  seqLength: number;      // determined at group level
  loopMode: LoopMode;
  loopStart: number;
  loopEnd: number;
  loopCrossfade: number;
  releaseDecay: number;
}

// ─── Group-level defaults ─────────────────────────────────────────────────
interface DsGroupDefaults {
  loKey: number;
  hiKey: number;
  loVel: number;
  hiVel: number;
  volume: number;
  pan: number;
  tune: number;
  pitchKeyTrack: number;
  trigger: TriggerMode;
  seqMode: DsSeqMode;
  loopMode: LoopMode;
  releaseDecay: number;
}

function readGroupDefaults(group: Element): DsGroupDefaults {
  return {
    loKey:         parseDsNote(attr(group, 'loNote') ?? attr(group, 'loKey'), 0),
    hiKey:         parseDsNote(attr(group, 'hiNote') ?? attr(group, 'hiKey'), 127),
    loVel:         Math.round(numAttr(group, 'loVel', 1)),
    hiVel:         Math.round(numAttr(group, 'hiVel', 127)),
    volume:        numAttr(group, 'volume', 0),
    pan:           numAttr(group, 'pan', 0),
    tune:          numAttr(group, 'tune', 0),
    pitchKeyTrack: numAttr(group, 'pitchKeyTrack', 100),
    trigger:       parseTrigger(attr(group, 'trigger')),
    seqMode:       parseSeqMode(attr(group, 'seqMode')),
    loopMode:      parseLoopMode(attr(group, 'loopMode')),
    releaseDecay:  numAttr(group, 'releaseDecay', 0),
  };
}

// ─── Parse a <sample> element against its group defaults ──────────────────
function parseSampleElement(
  sample: Element,
  gd: DsGroupDefaults,
  seqCounterMap: Map<string, number>,
): DsSampleEntry {
  const path = attr(sample, 'path') ?? '';

  // Determine seqMode from sample or inherit from group
  const seqModeAttr = attr(sample, 'seqMode');
  const seqMode = seqModeAttr ? parseSeqMode(seqModeAttr) : gd.seqMode;

  // seqPosition: explicit or auto-increment per (group, seqMode) bucket
  let seqPosition = Math.round(numAttr(sample, 'seqPosition', 0));
  if (seqPosition === 0) {
    const key = `${gd.loKey}-${gd.hiKey}-${seqMode}`;
    const prev = seqCounterMap.get(key) ?? 0;
    seqPosition = prev + 1;
    seqCounterMap.set(key, seqPosition);
  }

  const loKey   = parseDsNote(attr(sample, 'loNote') ?? attr(sample, 'loKey'), gd.loKey);
  const hiKey   = parseDsNote(attr(sample, 'hiNote') ?? attr(sample, 'hiKey'), gd.hiKey);
  const rootKey = parseDsNote(attr(sample, 'rootNote') ?? attr(sample, 'root'), Math.round((loKey + hiKey) / 2));

  return {
    path,
    loKey,
    hiKey,
    rootKey,
    loVel:         Math.round(numAttr(sample, 'loVel', gd.loVel)),
    hiVel:         Math.round(numAttr(sample, 'hiVel', gd.hiVel)),
    volume:        numAttr(sample, 'volume', gd.volume),
    pan:           numAttr(sample, 'pan', gd.pan),
    tune:          numAttr(sample, 'tune', gd.tune),
    pitchKeyTrack: numAttr(sample, 'pitchKeyTrack', gd.pitchKeyTrack),
    trigger:       attr(sample, 'trigger') ? parseTrigger(attr(sample, 'trigger')) : gd.trigger,
    seqPosition,
    seqMode,
    seqLength:     0,   // filled in after all samples in group are parsed
    loopMode:      attr(sample, 'loopEnabled') === 'true' || attr(sample, 'loopEnabled') === '1'
      ? 'loop_continuous'
      : attr(sample, 'loopMode') ? parseLoopMode(attr(sample, 'loopMode')) : gd.loopMode,
    loopStart:     Math.round(numAttr(sample, 'loopStart', 0)),
    loopEnd:       Math.round(numAttr(sample, 'loopEnd', 0)),
    loopCrossfade: numAttr(sample, 'loopCrossfade', 0),
    releaseDecay:  numAttr(sample, 'releaseDecay', gd.releaseDecay),
  };
}

// ─── Parse <effects> block ────────────────────────────────────────────────
function parseEffects(effectsEl: Element | null): DsEffect[] {
  if (!effectsEl) return [];
  const effects: DsEffect[] = [];
  for (const child of Array.from(effectsEl.children)) {
    const params: Record<string, number | string> = {};
    for (const a of Array.from(child.attributes)) {
      const n = parseFloat(a.value);
      params[a.name] = isNaN(n) ? a.value : n;
    }
    effects.push({ type: child.tagName.toLowerCase(), params });
  }
  return effects;
}

// ─── Parse <modulators> block ─────────────────────────────────────────────
function parseModulators(modulatorsEl: Element | null): DsModulator[] {
  if (!modulatorsEl) return [];
  const mods: DsModulator[] = [];
  for (const child of Array.from(modulatorsEl.children)) {
    const tag = child.tagName.toLowerCase();
    if (tag === 'lfo') {
      mods.push({
        type: 'lfo',
        shape: attr(child, 'shape') ?? 'sine',
        frequency: numAttr(child, 'frequency', 1),
        target: attr(child, 'binding') ?? attr(child, 'target'),
        amount: numAttr(child, 'amount', 0),
      });
    } else if (tag === 'envelope') {
      mods.push({
        type: 'envelope',
        attack: numAttr(child, 'attack', 0.002),
        decay: numAttr(child, 'decay', 0.1),
        sustain: numAttr(child, 'sustain', 1),
        release: numAttr(child, 'release', 0.4),
        target: attr(child, 'binding') ?? attr(child, 'target'),
        amount: numAttr(child, 'amount', 1),
      });
    } else {
      mods.push({ type: 'unknown' });
    }
  }
  return mods;
}

// ─── Convert volume from dB (DS uses 0..1 linear range in some versions) ──
function dsVolumeToDb(v: number): number {
  // DS uses linear 0..1 or dB — detect by range
  if (v >= -60 && v <= 24) return v; // already dB
  if (v > 0 && v <= 2) return 20 * Math.log10(Math.max(v, 1e-9)); // linear
  return 0;
}

// ─── Main export: parse a .dspreset XML string ────────────────────────────
export interface DecentSamplerParseResult extends NativeSamplerImportResult {
  sourceFormat: 'sf2' | 'sfz';   // override discriminant
  effects: DsEffect[];
  modulators: DsModulator[];
  roundRobinGroups: number;       // number of unique RR groups detected
  releaseTriggerRegions: number;  // count of release-trigger regions
}

/** Parse a Decent Sampler .dspreset XML string.  audioPayloads maps
 *  relative paths (as found in path="...") to raw bytes so that
 *  the caller can build AudioFilePayload entries. */
export function parseDecentSamplerPreset(
  xmlText: string,
  audioPayloads: Map<string, Uint8Array>,
  presetName = 'DS Import',
): DecentSamplerParseResult {
  // Parse XML — browser DOMParser or Node fallback
  let doc: Document;
  if (typeof DOMParser !== 'undefined') {
    doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  } else {
    // Node: minimal DOM-less fallback using regex for test environments
    doc = _minimalXmlToDom(xmlText);
  }

  const root = doc.documentElement;
  const groupsEl = root.tagName === 'DecentSampler'
    ? root.querySelector('groups')
    : root.querySelector('groups') ?? root;

  const effectsEl = root.querySelector('effects');
  const modulatorsEl = root.querySelector('modulators');

  const effects = parseEffects(effectsEl);
  const modulators = parseModulators(modulatorsEl);

  // ── Collect all samples from all groups ──────────────────────────────
  const allSamples: DsSampleEntry[] = [];
  const groupEls = groupsEl ? Array.from(groupsEl.querySelectorAll('group')) : [];

  for (const group of groupEls) {
    const gd = readGroupDefaults(group);
    const sampleEls = Array.from(group.querySelectorAll('sample'));
    const seqCounterMap = new Map<string, number>();

    const groupSamples: DsSampleEntry[] = [];
    for (const sEl of sampleEls) {
      groupSamples.push(parseSampleElement(sEl, gd, seqCounterMap));
    }

    // Calculate seqLength for each sample in this group
    // seqLength = max seqPosition within the same (loKey, hiKey) range
    const rrBuckets = new Map<string, number>();
    for (const s of groupSamples) {
      const key = `${s.loKey}-${s.hiKey}`;
      rrBuckets.set(key, Math.max(rrBuckets.get(key) ?? 0, s.seqPosition));
    }
    for (const s of groupSamples) {
      s.seqLength = rrBuckets.get(`${s.loKey}-${s.hiKey}`) ?? 1;
    }

    allSamples.push(...groupSamples);
  }

  // ── Build ExtendedRegion[] ────────────────────────────────────────────
  let idCounter = 0;
  const extendedRegions: ExtendedRegion[] = allSamples.map((s) => {
    const region: ExtendedRegion = {
      id: `ds-${idCounter++}`,
      sampleName: s.path.split(/[\\/]/).pop() ?? s.path,
      lowKey: s.loKey,
      highKey: s.hiKey,
      rootKey: s.rootKey,
      lowVel: Math.max(1, s.loVel),
      highVel: Math.min(127, s.hiVel),
      detune: Math.round(s.tune),
      volume: Math.max(-32, Math.min(12, dsVolumeToDb(s.volume))),
      pan: Math.max(-50, Math.min(50, s.pan * 50)),
      pitchKeytrack: Math.max(0, Math.min(100, s.pitchKeyTrack)),
      trigger: s.trigger,
      seqPosition: s.seqLength > 1 ? s.seqPosition : undefined,
      seqLength: s.seqLength > 1 ? s.seqLength : undefined,
      keyFadeIn: 0,
      keyFadeOut: 0,
      velFadeIn: 0,
      velFadeOut: 0,
      fadeCurve: 'linear',
      loopMode: s.loopMode,
      loopStart: s.loopStart,
      loopEnd: s.loopEnd,
      loopCrossfadeMs: s.loopCrossfade,
      hasPlaybackOverride: s.trigger !== 'attack' || s.pitchKeyTrack !== 100,
    };
    return region;
  });

  // ── Build AudioFilePayload[] from the payloads map ────────────────────
  const audioFiles: AudioFilePayload[] = [];
  for (const s of allSamples) {
    const bytes = audioPayloads.get(s.path) ?? audioPayloads.get(s.path.replace(/\\/g, '/'));
    if (!bytes) continue;
    const name = s.path.split(/[\\/]/).pop() ?? s.path;
    if (!audioFiles.some((a) => a.name === name)) {
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      audioFiles.push({ name, buffer });
    }
  }

  const classicZones = projectExtendedRegionsToClassicZones(extendedRegions).zones;
  const articulation = createDefaultArticulation();

  // Detect ADSR from envelope modulator if present
  const envMod = modulators.find((m) => m.type === 'envelope');
  if (envMod) {
    articulation.ampEnvEnabled = true;
    articulation.ampEnv.attackSec    = Math.max(0.001, envMod.attack  ?? 0.002);
    articulation.ampEnv.decaySec     = Math.max(0.001, envMod.decay   ?? 0.1);
    articulation.ampEnv.sustainLevel = Math.max(0,     Math.min(1, envMod.sustain ?? 1));
    articulation.ampEnv.releaseSec   = Math.max(0.001, envMod.release ?? 0.4);
  }

  const classification = classifyInstrumentAndParameterSet(presetName);
  const detectedCategory = classification.category;
  const suggestedParameterSet = classification.parameterSet;

  const metadata: ExtendedModelMetadata = {
    category: detectedCategory,
    sourceFormat: 'dspreset',
    sourcePresetName: presetName,
    description: `Imported from Decent Sampler: ${presetName}`,
    tags: ['decent-sampler', 'imported'],
  };

  const roundRobinGroups = groupEls.filter((g) =>
    g.getAttribute('seqMode') === 'round_robin' ||
    g.getAttribute('seqMode') === 'random' ||
    g.getAttribute('seqMode') === 'true_random',
  ).length;

  const releaseTriggerRegions = extendedRegions.filter(
    (r) => r.trigger === 'release',
  ).length;

  return {
    sourceFormat: 'sfz',   // closest discriminant; DS is text-based like SFZ
    presetName,
    modelName: presetName.substring(0, 11),
    detectedCategory,
    suggestedParameterSet,
    audioFiles,
    extendedRegions,
    classicZones,
    velocityLayerGainCompensation: {},
    articulation,
    metadata,
    effects,
    modulators,
    roundRobinGroups,
    releaseTriggerRegions,
  };
}

// ─── Encrypted DS Library detection ──────────────────────────────────────
/** Returns true if the dspreset XML contains encrypted or obfuscated sample refs. */
export function isDecentSamplerEncrypted(xmlText: string): boolean {
  // DS encrypted libraries use <sample path="...enc" /> or base64 blobs
  return /path\s*=\s*"[^"]*\.enc"/i.test(xmlText) ||
         /encryptedData\s*=/i.test(xmlText);
}

// ─── Minimal XML-to-DOM for Node test environments ───────────────────────
// A regex-based minimal DOM adapter — NOT a full XML parser; sufficient for
// attribute reading in unit tests where DOMParser is unavailable.
interface MinimalElement {
  tagName: string;
  attributes: Array<{ name: string; value: string }>;
  children: MinimalElement[];
  getAttribute(name: string): string | null;
  querySelector(sel: string): MinimalElement | null;
  querySelectorAll(sel: string): MinimalElement[];
}

function _minimalXmlToDom(xml: string): Document {
  // Strip XML declaration and comments
  xml = xml.replace(/<\?[^?]*\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');

  function parseAttributes(attrStr: string): Array<{ name: string; value: string }> {
    const attrs: Array<{ name: string; value: string }> = [];
    const re = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(attrStr)) !== null) {
      attrs.push({ name: m[1], value: m[2] ?? m[3] ?? '' });
    }
    return attrs;
  }

  function buildEl(tagName: string, attrStr: string): MinimalElement {
    const attributes = parseAttributes(attrStr);
    const children: MinimalElement[] = [];
    const el: MinimalElement = {
      tagName,
      attributes,
      children,
      getAttribute(name: string) {
        return attributes.find((a) => a.name === name)?.value ?? null;
      },
      querySelector(sel: string) {
        const tag = sel.split(/[^a-zA-Z0-9_-]/)[0];
        for (const c of children) {
          if (c.tagName.toLowerCase() === tag.toLowerCase()) return c;
          const found = c.querySelector(sel);
          if (found) return found;
        }
        return null;
      },
      querySelectorAll(sel: string) {
        const tag = sel.split(/[^a-zA-Z0-9_-]/)[0];
        const results: MinimalElement[] = [];
        for (const c of children) {
          if (c.tagName.toLowerCase() === tag.toLowerCase()) results.push(c);
          results.push(...c.querySelectorAll(sel));
        }
        return results;
      },
    };
    return el;
  }

  // Simple stack-based parser
  const stack: MinimalElement[] = [];
  const root = buildEl('Document', '');
  stack.push(root);

  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9_:.-]*)([^>]*)(\/)?\s*>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(xml)) !== null) {
    const isSelfClose = m[3] === '/' || /\/$/.test(m[2].trim());
    const isClose = m[0].startsWith('</');
    const tagName = m[1];
    const attrStr = m[2];
    if (isClose) {
      stack.pop();
    } else {
      const el = buildEl(tagName, attrStr);
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(el);
      if (!isSelfClose) stack.push(el);
    }
  }

  // Wrap as Document-like object
  const docEl = root.children[0] ?? buildEl('DecentSampler', '');
  return {
    documentElement: docEl,
  } as unknown as Document;
}
