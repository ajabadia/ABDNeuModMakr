// ─────────────────────────────────────────────────────────
// ABDShared / ABDNeuModMakr — Elektron Tonverk Format (.tvpst & elmulti)
//
// Clean-room TypeScript parser & writer for Elektron Tonverk presets
// (.tvpst TOML-like files) and multi-sample definitions.
// Contrasted with ConvertWithMoss Tonverk*.
//
// Structure (.tvpst):
// version = 1
// category = 'KEYS'
// tags = ['SYNTH', 'PAD']
// [parameters]
// ...
// [parameters.gen_multi_mapping_slot]
// version = 1
// name = 'Instrument'
//
// [[key-zones]]
// pitch = 60
// key-center = 60.0
//
// [[key-zones.velocity-layers]]
// velocity = 0.5
// strategy = 'Forward'
//
// [[key-zones.velocity-layers.sample-slots]]
// sample = 'samples/sample.wav'
// loop-mode = 'Forward'
// loop-start = 1000
// loop-end = 40000
// ─────────────────────────────────────────────────────────

import type { ExtendedRegion, SynthArticulationConfig, SampleLoopDescriptor } from './SamplerTypes.ts';
import { createDefaultArticulation } from './ExtendedAdapter.ts';
import { indexZipArchive, extractZipEntry } from '../NeuronFormats/ZipArchive.ts';

export interface TonverkKeyZone {
  pitch: number;
  keyCenter: number;
  lowKey?: number;
  highKey?: number;
  velocityLayers: TonverkVelocityLayer[];
}

export interface TonverkVelocityLayer {
  velocity: number;
  strategy?: string;
  sampleSlots: TonverkSampleSlot[];
}

export interface TonverkSampleSlot {
  sample: string;
  loopMode?: string;
  loopStart?: number;
  loopEnd?: number;
  loopCrossfade?: number;
  keepLoopingOnRelease?: boolean;
  trimStart?: number;
  trimEnd?: number;
}

export function isTonverkPstText(text: string): boolean {
  return (
    text.includes('[parameters]') &&
    (text.includes('gen_multi_mapping_slot') || text.includes('gen_drum_mapping_slot') || text.includes('[[key-zones]]'))
  );
}

export function parseTonverkPst(
  text: string,
  audioPool?: Map<string, ArrayBuffer>
): {
  presetName: string;
  regions: ExtendedRegion[];
  articulation: SynthArticulationConfig;
} {
  const lines = text.split(/\r?\n/);
  let presetName = 'TonverkPreset';
  const keyZones: TonverkKeyZone[] = [];

  let curZone: TonverkKeyZone | null = null;
  let curLayer: TonverkVelocityLayer | null = null;
  let curSlot: TonverkSampleSlot | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (trimmed === '[[key-zones]]') {
      curZone = { pitch: 60, keyCenter: 60, velocityLayers: [] };
      keyZones.push(curZone);
      curLayer = null;
      curSlot = null;
      continue;
    } else if (trimmed === '[[key-zones.velocity-layers]]') {
      if (curZone) {
        curLayer = { velocity: 0.5, strategy: 'Forward', sampleSlots: [] };
        curZone.velocityLayers.push(curLayer);
        curSlot = null;
      }
      continue;
    } else if (trimmed === '[[key-zones.velocity-layers.sample-slots]]') {
      if (curLayer) {
        curSlot = { sample: '' };
        curLayer.sampleSlots.push(curSlot);
      }
      continue;
    }

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const valRaw = trimmed.slice(eqIdx + 1).trim();
    const valStr = valRaw.replace(/^['"]|['"]$/g, '');

    if (key === 'name' && !curZone) {
      presetName = valStr;
    } else if (curSlot) {
      if (key === 'sample') curSlot.sample = valStr;
      else if (key === 'loop-mode') curSlot.loopMode = valStr;
      else if (key === 'loop-start') curSlot.loopStart = parseInt(valStr, 10);
      else if (key === 'loop-end') curSlot.loopEnd = parseInt(valStr, 10);
      else if (key === 'loop-crossfade') curSlot.loopCrossfade = parseInt(valStr, 10);
      else if (key === 'trim-start') curSlot.trimStart = parseInt(valStr, 10);
      else if (key === 'trim-end') curSlot.trimEnd = parseInt(valStr, 10);
    } else if (curLayer) {
      if (key === 'velocity') curLayer.velocity = parseFloat(valStr);
      else if (key === 'strategy') curLayer.strategy = valStr;
    } else if (curZone) {
      if (key === 'pitch') curZone.pitch = parseInt(valStr, 10);
      else if (key === 'key-center') curZone.keyCenter = parseFloat(valStr);
    }
  }

  // Calculate key bounds across contiguous keyZones
  keyZones.sort((a, b) => a.pitch - b.pitch);
  for (let i = 0; i < keyZones.length; i++) {
    const prev = i > 0 ? keyZones[i - 1].pitch : 0;
    const next = i < keyZones.length - 1 ? keyZones[i + 1].pitch : 127;
    const cur = keyZones[i].pitch;

    keyZones[i].lowKey = i === 0 ? 0 : Math.floor((prev + cur) / 2) + 1;
    keyZones[i].highKey = i === keyZones.length - 1 ? 127 : Math.floor((cur + next) / 2);
  }

  const regions: ExtendedRegion[] = [];
  let regIdx = 0;

  for (const kz of keyZones) {
    const numLayers = kz.velocityLayers.length;
    for (let li = 0; li < numLayers; li++) {
      const vl = kz.velocityLayers[li];
      const lowVel = li === 0 ? 1 : Math.round(vl.velocity * 127);
      const highVel = li === numLayers - 1 ? 127 : Math.round((kz.velocityLayers[li + 1].velocity * 127) - 1);

      for (const slot of vl.sampleSlots) {
        if (!slot.sample) continue;
        regIdx++;
        const cleanName = slot.sample.split('/').pop()?.split('\\').pop() || slot.sample;

        const loops: SampleLoopDescriptor[] = [];
        if (slot.loopMode === 'Forward' && slot.loopStart !== undefined && slot.loopEnd !== undefined) {
          loops.push({
            mode: 'loop_continuous',
            startFrame: slot.loopStart,
            endFrame: slot.loopEnd,
            crossfadeMs: slot.loopCrossfade ?? 0,
          });
        }

        regions.push({
          id: `tv_r_${regIdx}`,
          sampleName: cleanName,
          rootKey: Math.round(kz.keyCenter),
          lowKey: kz.lowKey ?? kz.pitch,
          highKey: kz.highKey ?? kz.pitch,
          lowVel: Math.max(1, lowVel),
          highVel: Math.min(127, highVel),
          volume: 0,
          pan: 0,
          detune: Math.round((kz.keyCenter - Math.round(kz.keyCenter)) * 100),
          pitchKeytrack: 100,
          trigger: 'attack',
          keyFadeIn: 0,
          keyFadeOut: 0,
          velFadeIn: 0,
          velFadeOut: 0,
          fadeCurve: 'equal-power',
          loopMode: loops.length > 0 ? loops[0].mode : 'no_loop',
          loopStart: loops.length > 0 ? loops[0].startFrame : 0,
          loopEnd: loops.length > 0 ? loops[0].endFrame : 0,
          loopCrossfadeMs: loops.length > 0 ? (loops[0].crossfadeMs ?? 0) : 0,
          sampleStartFrame: slot.trimStart,
          sampleEndFrame: slot.trimEnd,
          loops: loops.length > 0 ? loops : undefined,
        });
      }
    }
  }

  return {
    presetName,
    regions,
    articulation: createDefaultArticulation(),
  };
}

export function buildTonverkPst(options: {
  presetName: string;
  regions: ExtendedRegion[];
  articulation?: SynthArticulationConfig;
}): string {
  const lines: string[] = [
    '# ELEKTRON TONVERK PRESET',
    'version = 1',
    "category = 'KEYS'",
    'tags = [',
    "    'SYNTH',",
    ']',
    '',
    '[parameters]',
    "name = '" + options.presetName + "'",
    '',
    '[parameters.gen_multi_mapping_slot]',
    'version = 1',
    "name = '" + options.presetName + "'",
  ];

  // Group by rootKey / pitch
  const byPitch = new Map<number, ExtendedRegion[]>();
  for (const r of options.regions) {
    const p = r.rootKey;
    if (!byPitch.has(p)) byPitch.set(p, []);
    byPitch.get(p)!.push(r);
  }

  const pitches = Array.from(byPitch.keys()).sort((a, b) => a - b);

  for (const p of pitches) {
    const regs = byPitch.get(p)!;
    lines.push('');
    lines.push('[[key-zones]]');
    lines.push(`pitch = ${p}`);
    lines.push(`key-center = ${p}.0`);

    // Sort regions by velocity
    regs.sort((a, b) => a.lowVel - b.lowVel);

    for (const r of regs) {
      const velNorm = (r.lowVel / 127.0).toFixed(4);
      lines.push('');
      lines.push('[[key-zones.velocity-layers]]');
      lines.push(`velocity = ${velNorm}`);
      lines.push("strategy = 'Forward'");

      lines.push('');
      lines.push('[[key-zones.velocity-layers.sample-slots]]');
      const filename = r.sampleName.endsWith('.wav') ? r.sampleName : `${r.sampleName}.wav`;
      lines.push(`sample = 'samples/${filename}'`);

      if (r.loops && r.loops.length > 0) {
        const l = r.loops[0];
        lines.push("loop-mode = 'Forward'");
        lines.push(`loop-start = ${l.startFrame}`);
        lines.push(`loop-end = ${l.endFrame}`);
        if (l.crossfadeMs) {
          lines.push(`loop-crossfade = ${l.crossfadeMs}`);
        }
      } else {
        lines.push("loop-mode = 'Off'");
      }

      if (r.sampleStartFrame !== undefined) {
        lines.push(`trim-start = ${r.sampleStartFrame}`);
      }
      if (r.sampleEndFrame !== undefined) {
        lines.push(`trim-end = ${r.sampleEndFrame}`);
      }
    }
  }

  return lines.join('\n');
}

export function importTonverkZip(zipBuffer: ArrayBuffer): {
  presetName: string;
  regions: ExtendedRegion[];
  articulation: SynthArticulationConfig;
  audioBuffers: Map<string, ArrayBuffer>;
} {
  const zipBytes = new Uint8Array(zipBuffer);
  const central = indexZipArchive(zipBytes);
  const audioBuffers = new Map<string, ArrayBuffer>();
  let tvpstEntry: (typeof central)[0] | undefined;

  for (const entry of central) {
    const low = entry.path.toLowerCase();
    if (low.endsWith('.tvpst') || low.endsWith('elmulti')) {
      tvpstEntry = entry;
    } else if (low.endsWith('.wav') || low.endsWith('.flac')) {
      const data = extractZipEntry(zipBytes, entry);
      const name = entry.path.split('/').pop() || entry.path;
      audioBuffers.set(name, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    }
  }

  if (!tvpstEntry) {
    throw new Error('No .tvpst or elmulti preset found in Tonverk package');
  }

  const pstBytes = extractZipEntry(zipBytes, tvpstEntry);
  const text = new TextDecoder('utf-8').decode(pstBytes);
  const parsed = parseTonverkPst(text, audioBuffers);

  return {
    presetName: parsed.presetName,
    regions: parsed.regions,
    articulation: parsed.articulation,
    audioBuffers,
  };
}
