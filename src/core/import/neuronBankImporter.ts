// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Hartmann Neuron / Neuronik Bank Importer (Fase 35.1)
//
// Treats Hartmann Neuron `.model` / `NeuronDB` archives, `.neuronikmodel`,
// `.nmmodel`, `.scape` (`csAN`), `.sphere` (`psAN`), `MName`, `map.script`,
// and 5-Layer Time Capsules as a first-class multisample bank container
// inside Universal Smart Import (`UniversalImportModal`):
//   1. Signature & extension detection (`isNeuronBankOrModelInput`)
//   2. Multi-model bank container listing (`listNeuronBankModels`) so
//      multi-model `NeuronDB` ZIPs open `MultiInstrumentModal` just like `.sf2`
//   3. Container-to-preset extraction (`parseNeuronBankOrModelToPreset`):
//      extracts model -> zones -> regions + lossless or resynthesized WAV buffers
//      so it passes through the unified Preflight Gate (Fase 35.3).
// ─────────────────────────────────────────────────────────

import {
  encodeWavPcm16,
  indexZipArchive,
  parseAnChunks,
  parseMName,
  parseModelFileSet,
  resynthesizeNeuronModelSource,
  type ZipCentralEntry,
} from '@abdsynths/shared/formats/neuron';
import { PARAMETER_SETS } from '../index.ts';
import { extractTimeCapsuleFromFiles } from '../timeCapsule.ts';
import {
  assertZipIndexWithinCaps,
  extractZipEntryCapped,
} from '../../formats/ZipArchive.ts';
import { parseMapScriptCapped } from '../../formats/ModelFormat.ts';
import type { ParsedImportRegion, ParsedSamplerPreset } from './rawSamplerParsers.ts';

export interface NeuronBankModelSummary {
  id: string;
  index: number;
  slot: number;
  name: string;
  regionCount: number;
  detail: string;
}

const NEURON_EXT_RE = /\.(neuronikmodel|nmmodel|scape|sphere|model|nmpack|axpreset)$/i;
const NEURON_SCRIPT_NAME_RE = /^(mname|map\.script)$/i;

function hasAnMagic(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 8) return false;
  const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (tag === 'csAN' || tag === 'psAN') return true;
  try {
    const chunks = parseAnChunks(bytes);
    return chunks.length > 0 && (chunks[0].tag === 'csAN' || chunks[0].tag === 'psAN');
  } catch {
    return false;
  }
}

function hasPkZipMagic(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05)
  );
}

function looksLikeMapScriptText(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12 || bytes.byteLength > 512 * 1024) return false;
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(256, bytes.byteLength)));
  return head.includes('MapVersionMajor') || head.includes('000LowKey') || head.includes('add mapentry');
}

function looksLikeNeuronikModelJson(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 16 || bytes.byteLength > 16 * 1024 * 1024) return false;
  const firstNonWs = bytes.find((b) => b !== 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d);
  if (firstNonWs !== 0x7b /* '{' */) return false;
  const sample = new TextDecoder().decode(bytes.subarray(0, Math.min(2048, bytes.byteLength)));
  return (
    sample.includes('"modern-neural"') ||
    sample.includes('"NEURONMM_TIMECAPSULE"') ||
    sample.includes('"axionik-expanded"') ||
    (sample.includes('"partialCount"') && sample.includes('"zones"')) ||
    sample.includes('"embeddedModel"') ||
    (sample.includes('"formatVersion": 2') && sample.includes('"extendedState"'))
  );
}

function isZipNeuronBankArchive(bytes: Uint8Array): boolean {
  if (!hasPkZipMagic(bytes)) return false;
  try {
    const entries = indexZipArchive(bytes);
    for (const e of entries) {
      const norm = e.path.replace(/\\/g, '/');
      if (norm.includes('__MACOSX/')) continue;
      const base = norm.split('/').pop() ?? norm;
      const lowerBase = base.toLowerCase();
      if (
        lowerBase === 'mname' ||
        lowerBase === 'map.script' ||
        lowerBase.endsWith('.scape') ||
        lowerBase.endsWith('.sphere') ||
        lowerBase.endsWith('.nmmodel') ||
        lowerBase.endsWith('.neuronikmodel') ||
        norm.startsWith('02_legacy_original/') ||
        norm.startsWith('04_classic_enhanced/') ||
        norm.startsWith('05_extended_model/') ||
        /(^|\/)\d{3}\.model\//i.test(norm)
      ) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Detects by binary signature, filename, or ZIP directory structure whether the
 * selected file (or file set) is a Hartmann Neuron / Neuronik model or bank.
 */
export function isNeuronBankOrModelInput(
  filename: string,
  buffer: ArrayBuffer,
  allFileNames: readonly string[] = []
): boolean {
  const base = filename.replace(/\\/g, '/').split('/').pop() ?? filename;
  if (NEURON_EXT_RE.test(base) || NEURON_SCRIPT_NAME_RE.test(base)) {
    return true;
  }
  for (const name of allFileNames) {
    const b = name.replace(/\\/g, '/').split('/').pop() ?? name;
    if (NEURON_EXT_RE.test(b) || NEURON_SCRIPT_NAME_RE.test(b)) {
      return true;
    }
  }

  const bytes = new Uint8Array(buffer);
  if (hasAnMagic(bytes)) return true;
  if (looksLikeMapScriptText(bytes)) return true;
  if (looksLikeNeuronikModelJson(bytes)) return true;
  if (isZipNeuronBankArchive(bytes)) return true;

  return false;
}

interface GroupedModelEntries {
  id: string;
  slot: number;
  prefix: string;
  entries: ZipCentralEntry[];
}

function groupZipEntriesByModel(entries: readonly ZipCentralEntry[]): GroupedModelEntries[] {
  const valid = entries.filter((e) => {
    const norm = e.path.replace(/\\/g, '/');
    const base = norm.split('/').pop() ?? norm;
    return !norm.includes('__MACOSX/') && !base.startsWith('._') && base !== '.DS_Store';
  });

  // Check if this is a Time Capsule (single model with 5 layers)
  const isCapsule = valid.some((e) => {
    const norm = e.path.replace(/\\/g, '/');
    return (
      norm === 'manifest.json' ||
      norm.startsWith('01_raw_source/') ||
      norm.startsWith('02_legacy_original/') ||
      norm.startsWith('04_classic_enhanced/') ||
      norm.startsWith('05_extended_model/')
    );
  });
  if (isCapsule) {
    return [
      {
        id: 'capsule:0',
        slot: 0,
        prefix: '',
        entries: [...valid],
      },
    ];
  }

  // Group by `<path>/<NNN>.model/` directories if present
  const modelDirGroups = new Map<string, { slot: number; entries: ZipCentralEntry[] }>();
  for (const e of valid) {
    const norm = e.path.replace(/\\/g, '/');
    const match = /^(.*?\b(\d{3})\.model)\//i.exec(norm);
    if (match) {
      const prefix = match[1];
      const slot = parseInt(match[2], 10) || 0;
      let grp = modelDirGroups.get(prefix);
      if (!grp) {
        grp = { slot, entries: [] };
        modelDirGroups.set(prefix, grp);
      }
      grp.entries.push(e);
    }
  }

  if (modelDirGroups.size > 0) {
    return Array.from(modelDirGroups.entries())
      .map(([prefix, grp]) => ({
        id: `model:${grp.slot}:${prefix}`,
        slot: grp.slot,
        prefix,
        entries: grp.entries,
      }))
      .sort((a, b) => a.slot - b.slot || a.prefix.localeCompare(b.prefix));
  }

  // Or multiple standalone `.nmmodel` / `.neuronikmodel` files in a ZIP
  const modernEntries = valid.filter((e) => /\.(nmmodel|neuronikmodel)$/i.test(e.path));
  if (modernEntries.length > 1) {
    return modernEntries.map((e, idx) => {
      const slotMatch = /(\d{3})/.exec(e.path);
      const slot = slotMatch ? parseInt(slotMatch[1], 10) : idx;
      return {
        id: `modern:${idx}:${e.path}`,
        slot,
        prefix: e.path,
        entries: [e],
      };
    });
  }

  // Fallback: single model archive containing MName/map.script/.scape/.sphere at root
  return [
    {
      id: 'model:0:root',
      slot: 0,
      prefix: '',
      entries: [...valid],
    },
  ];
}

/**
 * Lists all models contained inside a Hartmann Neuron / Neuronik `.zip` archive
 * (e.g. a `NeuronDB` pack with multiple `Models/<NNN>.model/` folders).
 */
export async function listNeuronBankModels(
  filename: string,
  buffer: ArrayBuffer
): Promise<NeuronBankModelSummary[]> {
  const bytes = new Uint8Array(buffer);
  if (!hasPkZipMagic(bytes)) return [];

  let entries: ZipCentralEntry[];
  try {
    entries = indexZipArchive(bytes);
  } catch {
    return [];
  }

  const groups = groupZipEntriesByModel(entries);
  const summaries: NeuronBankModelSummary[] = [];

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    let modelName = `Model ${String(g.slot).padStart(3, '0')}`;
    let regionCount = 0;
    let scapeCount = 0;

    for (const e of g.entries) {
      const base = (e.path.replace(/\\/g, '/').split('/').pop() ?? e.path).toLowerCase();
      if (base === 'mname') {
        try {
          // S6.7l: extracción acotada + `MName` es un nombre (64 KB sobran).
          const raw = await extractZipEntryCapped(bytes, e);
          if (raw.byteLength > 64 * 1024) continue;
          const parsedName = parseMName(raw).trim();
          if (parsedName) modelName = parsedName;
        } catch {
          // ignore
        }
      } else if (base === 'map.script') {
        try {
          const raw = await extractZipEntryCapped(bytes, e);
          const txt = new TextDecoder('latin1').decode(raw);
          const ms = parseMapScriptCapped(txt, e.path);
          if (ms.activeZones.length > 0) regionCount = ms.activeZones.length;
        } catch {
          // ignore
        }
      } else if (base.endsWith('.scape')) {
        scapeCount++;
      } else if (base.endsWith('.nmmodel') || base.endsWith('.neuronikmodel')) {
        try {
          const raw = await extractZipEntryCapped(bytes, e);
          if (raw.byteLength > 8 * 1024 * 1024) continue;
          const json = JSON.parse(new TextDecoder().decode(raw)) as {
            name?: string;
            zoneCount?: number;
            zones?: unknown[];
          };
          if (json.name) modelName = json.name;
          if (Array.isArray(json.zones)) regionCount = json.zones.length;
          else if (typeof json.zoneCount === 'number') regionCount = json.zoneCount;
        } catch {
          // ignore
        }
      }
    }

    if (regionCount === 0 && scapeCount > 0) {
      regionCount = scapeCount;
    }

    summaries.push({
      id: g.id,
      index: i,
      slot: g.slot,
      name: modelName || filename.replace(/\.[^.]+$/, ''),
      regionCount: Math.max(1, regionCount),
      detail: `Slot #${String(g.slot).padStart(3, '0')} · ${Math.max(1, regionCount)} zone(s)`,
    });
  }

  return summaries;
}

function toArrayBufferCopy(u8: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(u8.byteLength);
  copy.set(u8);
  return copy.buffer;
}

function categoryFromParameterSet(parameterSet: number): string {
  const clamped = Math.max(0, Math.min(9, Math.round(parameterSet)));
  const found = PARAMETER_SETS.find((p) => p.id === clamped);
  return found ? found.name : 'Instrument / Acoustic';
}

/**
 * Parses a Hartmann Neuron / Neuronik bank, model directory, Time Capsule, or binary
 * file set into a standard `ParsedSamplerPreset` so it goes through the common
 * Import Preflight Gate and injects clean zones + audio buffers into the session.
 */
export async function parseNeuronBankOrModelToPreset(
  filename: string,
  buffer: ArrayBuffer,
  additionalFiles?: readonly { name: string; data: Uint8Array }[],
  targetModelId?: string
): Promise<ParsedSamplerPreset> {
  const primaryBytes = new Uint8Array(buffer);
  let fileEntries: { name: string; data: Uint8Array }[] = [];

  if (additionalFiles && additionalFiles.length > 0) {
    fileEntries = [...additionalFiles];
  } else if (hasPkZipMagic(primaryBytes)) {
    const zipIndex = indexZipArchive(primaryBytes);
    const groups = groupZipEntriesByModel(zipIndex);
    const chosenGroup =
      (targetModelId ? groups.find((g) => g.id === targetModelId) : undefined) ?? groups[0];

    if (chosenGroup && chosenGroup.id !== 'capsule:0' && groups.length > 1) {
      // S6.1 + S6.7l: topes por cabecera y extracción acotada del grupo.
      assertZipIndexWithinCaps(chosenGroup.entries);
      fileEntries = [];
      for (const e of chosenGroup.entries) {
        fileEntries.push({ name: e.path, data: await extractZipEntryCapped(primaryBytes, e) });
      }
    } else {
      fileEntries = [{ name: filename, data: primaryBytes }];
    }
  } else {
    fileEntries = [{ name: filename, data: primaryBytes }];
  }

  const capsule = await extractTimeCapsuleFromFiles(fileEntries);
  const filesToParse =
    capsule.modelParseFiles.length > 0 ? capsule.modelParseFiles : fileEntries;

  // S6.7m (ola 19): la frontera con el vendor nunca recibe un contenedor
  // crudo — el vendor lo re-expandiría con su `parseZipArchive` sin topes.
  for (const f of filesToParse) {
    const ln = f.name.toLowerCase();
    if (ln.endsWith('.zip') || ln.endsWith('.nmpack')) {
      throw new Error(
        `Nested container '${f.name}' was not expanded within caps (possible nested zip-bomb)`
      );
    }
  }
  const parsedModel = parseModelFileSet(filesToParse, capsule.manifest?.slot ?? 0);

  const audioBuffers = new Map<string, ArrayBuffer>();

  // 1. Copy any unaltered raw or enhanced WAVs from Time Capsule or embeddedSamples
  for (const [k, ab] of capsule.rawSourceSamples.entries()) {
    audioBuffers.set(k, ab);
  }
  for (const [k, ab] of capsule.enhancedAudioSamples.entries()) {
    if (!audioBuffers.has(k)) {
      audioBuffers.set(k, ab);
    }
  }
  if (parsedModel.embeddedSamples) {
    for (const [k, u8] of parsedModel.embeddedSamples.entries()) {
      if (!audioBuffers.has(k)) {
        audioBuffers.set(k, toArrayBufferCopy(u8));
      }
    }
  }

  // 2. Resynthesize `.scape` + `.sphere` pairs into 44.1 kHz PCM16 WAVs when raw WAVs are absent
  const ensureResynthesizedWav = (sourceRef: string | null | undefined, rootKey: number): string => {
    const cleanRef = (sourceRef ?? '000001.scape').trim();
    if (audioBuffers.has(cleanRef)) return cleanRef;

    const wavRef = cleanRef.replace(/\.(scape|sphere)$/i, '.wav');
    if (audioBuffers.has(wavRef)) return wavRef;

    const idxMatch = /(\d+)/.exec(cleanRef);
    const srcIdx = idxMatch ? parseInt(idxMatch[1], 10) : 1;
    const scape = parsedModel.scapes.get(srcIdx);
    const sphere = parsedModel.spheres.get(srcIdx);

    let pcm: Float32Array;
    if (scape || sphere) {
      pcm = resynthesizeNeuronModelSource(sphere, scape, 44100, 0.2);
    } else {
      // Fallback: synthesize a short harmonic reference tone at rootKey so preflight has valid audio
      const freq = 440 * Math.pow(2, (rootKey - 69) / 12);
      const len = 22050;
      pcm = new Float32Array(len);
      for (let i = 0; i < len; i++) {
        const env = Math.exp((-3.0 * i) / len);
        pcm[i] = 0.25 * env * Math.sin((2 * Math.PI * freq * i) / 44100);
      }
    }

    const wavBuf = encodeWavPcm16([pcm], 44100);
    audioBuffers.set(wavRef, wavBuf);
    return wavRef;
  };

  // 3. Check if Time Capsule has `05_extended_model/extended_map.json` with multi-velocity regions
  const regions: ParsedImportRegion[] = [];
  let extendedRegionsLoaded = false;

  if (capsule.isTimeCapsule && capsule.manifest?.extendedRegions?.length) {
    for (let i = 0; i < capsule.manifest.extendedRegions.length; i++) {
      const er = capsule.manifest.extendedRegions[i];
      const resolvedSample = ensureResynthesizedWav(er.sampleName, er.rootKey);
      regions.push({
        id: er.id || `neuron_reg_${i + 1}`,
        sampleName: resolvedSample,
        samplePath: resolvedSample,
        rootKey: er.rootKey,
        lowKey: er.lowKey,
        highKey: er.highKey,
        lowVel: er.lowVel,
        highVel: er.highVel,
        detuneCents: er.detune,
        volumeDb: er.volume,
        pan: er.pan,
        loopMode: er.loopMode ?? 'no_loop',
        loopStart: er.loopStart ?? 0,
        loopEnd: er.loopEnd ?? 0,
      });
    }
    extendedRegionsLoaded = regions.length > 0;
  }

  if (!extendedRegionsLoaded) {
    const activeZones = parsedModel.mapScript.activeZones;
    for (let i = 0; i < activeZones.length; i++) {
      const z = activeZones[i];
      const hasHighLayer = Boolean(z.sampleHigh && z.sampleHigh !== z.sampleLow);
      const split = z.velSplit && z.velSplit > 1 && z.velSplit <= 127 ? z.velSplit : 64;

      const lowSampleWav = ensureResynthesizedWav(z.sampleLow, z.rootKey);
      regions.push({
        id: `${z.id}_low`,
        sampleName: lowSampleWav,
        samplePath: lowSampleWav,
        rootKey: z.rootKey,
        lowKey: z.lowKey,
        highKey: z.highKey,
        lowVel: 1,
        highVel: hasHighLayer ? split - 1 : 127,
        detuneCents: z.detune,
        volumeDb: z.volume,
        pan: z.pan,
        loopMode: 'no_loop',
        loopStart: 0,
        loopEnd: 0,
      });

      if (hasHighLayer && z.sampleHigh) {
        const highSampleWav = ensureResynthesizedWav(z.sampleHigh, z.rootKey);
        regions.push({
          id: `${z.id}_high`,
          sampleName: highSampleWav,
          samplePath: highSampleWav,
          rootKey: z.rootKey,
          lowKey: z.lowKey,
          highKey: z.highKey,
          lowVel: split,
          highVel: 127,
          detuneCents: z.detune,
          volumeDb: z.volume,
          pan: z.pan,
          loopMode: 'no_loop',
          loopStart: 0,
          loopEnd: 0,
        });
      }
    }
  }

  // Determine full preset name vs 11-char Classic MName
  const rawFullName =
    capsule.manifest?.modelName?.trim() ||
    parsedModel.name?.trim() ||
    filename.replace(/\.[^.]+$/, '');
  const classic11Name = rawFullName.slice(0, 11).trim() || 'NEURONMDL';

  const firstSphere = parsedModel.spheres.values().next().value;
  const paramSet =
    capsule.manifest?.processConfig?.parameterSet ??
    parsedModel.inferredParameterSet ??
    firstSphere?.header.parameterSet ??
    0;
  const clampedParamSet = Math.max(0, Math.min(9, Math.round(paramSet)));
  const detectedCategory =
    capsule.manifest?.detectedInstrumentCategory || categoryFromParameterSet(clampedParamSet);

  const formatLabel = capsule.isTimeCapsule
    ? 'Hartmann Neuron / Cápsula del Tiempo (.zip)'
    : parsedModel.neuronikModelJson && parsedModel.scapes.size === 0
      ? 'Neuronik Extended Model (.neuronikmodel / .nmmodel)'
      : 'Hartmann Neuron Model / Bank (.model / NeuronDB)';

  return {
    format: 'neuron_bank',
    formatLabel,
    presetName: rawFullName,
    modelName: classic11Name,
    detectedCategory,
    suggestedParameterSet: clampedParamSet,
    regions,
    audioBuffers,
    description: `Slot #${String(parsedModel.slot).padStart(3, '0')} · ${regions.length} region(s)`,
  };
}
