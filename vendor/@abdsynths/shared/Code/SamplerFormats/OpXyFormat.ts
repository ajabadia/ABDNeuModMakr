// ─────────────────────────────────────────────────────────
// ABDShared / ABDNeuModMakr — Teenage Engineering OP-XY Multisampler Format
//
// Clean-room TypeScript parser & writer for Teenage Engineering OP-XY
// preset packages (folder or .zip with patch.json + WAV files).
// Contrasted with ConvertWithMoss OpXy*.
//
// Structure:
// patch.json:
// {
//   "type": "multisampler",
//   "platform": "OP-XY",
//   "version": 4,
//   "octave": 0,
//   "engine": {
//     "playmode": "poly",
//     "bendrange": 0.5,
//     "volume": 0.5,
//     "velocity.sensitivity": 0.5
//   },
//   "envelope": {
//     "amp": { "attack": 0, "decay": 127, "sustain": 127, "release": 20 }
//   },
//   "regions": [
//     {
//       "sample": "sound.wav",
//       "framecount": 44100,
//       "lokey": 36,
//       "hikey": 72,
//       "pitch.keycenter": 60,
//       "gain": 0,
//       "tune": 0,
//       "sample.start": 0,
//       "sample.end": 44100,
//       "loop.enabled": true,
//       "loop.start": 10000,
//       "loop.end": 40000,
//       "loop.crossfade": 500,
//       "loop.onrelease": false
//     }
//   ]
// }
// ─────────────────────────────────────────────────────────

import type { ExtendedRegion, SynthArticulationConfig, SampleLoopDescriptor } from './SamplerTypes.ts';
import { createDefaultArticulation } from './ExtendedAdapter.ts';
import { indexZipArchive, extractZipEntry } from '../NeuronFormats/ZipArchive.ts';

export interface OpXyPatchJson {
  type: string;
  platform?: string;
  version?: number;
  octave?: number;
  engine?: {
    playmode?: string;
    bendrange?: number;
    volume?: number;
    'velocity.sensitivity'?: number;
    transpose?: number;
  };
  envelope?: {
    amp?: {
      attack?: number;
      decay?: number;
      sustain?: number;
      release?: number;
    };
    filter?: {
      attack?: number;
      decay?: number;
      sustain?: number;
      release?: number;
    };
  };
  regions?: Array<{
    sample: string;
    framecount?: number;
    lokey: number;
    hikey: number;
    'pitch.keycenter'?: number;
    gain?: number;
    tune?: number;
    reverse?: boolean;
    'sample.start'?: number;
    'sample.end'?: number;
    'loop.enabled'?: boolean;
    'loop.start'?: number;
    'loop.end'?: number;
    'loop.crossfade'?: number;
    'loop.onrelease'?: boolean;
  }>;
}

export function isOpXyPatchJson(text: string): boolean {
  try {
    const obj = JSON.parse(text);
    return obj && obj.type === 'multisampler';
  } catch {
    return false;
  }
}

export function parseOpXyPatch(
  jsonText: string,
  audioPool?: Map<string, ArrayBuffer>
): {
  presetName: string;
  regions: ExtendedRegion[];
  articulation: SynthArticulationConfig;
} {
  const patch: OpXyPatchJson = JSON.parse(jsonText);
  if (patch.type !== 'multisampler') {
    throw new Error(`Invalid OP-XY preset type: expected 'multisampler', got '${patch.type}'`);
  }

  const regions: ExtendedRegion[] = [];
  const rawRegions = patch.regions || [];

  for (let i = 0; i < rawRegions.length; i++) {
    const r = rawRegions[i];
    const cleanName = r.sample.split('/').pop()?.split('\\').pop() || r.sample;

    const lowKey = r.lokey ?? 0;
    const highKey = r.hikey ?? 127;
    const root = r['pitch.keycenter'] ?? highKey;

    const loops: SampleLoopDescriptor[] = [];
    if (r['loop.enabled']) {
      const start = r['loop.start'] ?? 0;
      const end = r['loop.end'] ?? (r.framecount ?? 44100);
      const crossfade = r['loop.crossfade'] ?? 0;
      const onRelease = r['loop.onrelease'] ?? false;

      loops.push({
        mode: onRelease ? 'loop_continuous' : 'loop_sustain',
        startFrame: start,
        endFrame: end,
        crossfadeMs: crossfade,
      });
    }

    regions.push({
      id: `opxy_r_${i + 1}`,
      sampleName: cleanName,
      rootKey: root,
      lowKey,
      highKey,
      lowVel: 1,
      highVel: 127,
      volume: r.gain ?? 0,
      pan: 0,
      detune: (r.tune ?? 0) * 100,
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
      reversed: r.reverse ?? false,
      sampleStartFrame: r['sample.start'],
      sampleEndFrame: r['sample.end'],
      loops: loops.length > 0 ? loops : undefined,
    });
  }

  const articulation = createDefaultArticulation();

  if (patch.envelope?.amp) {
    const amp = patch.envelope.amp;
    articulation.ampEnv = {
      attackSec: (amp.attack ?? 0) / 127.0 * 5.0,
      decaySec: (amp.decay ?? 64) / 127.0 * 5.0,
      sustainLevel: (amp.sustain ?? 127) / 127.0,
      releaseSec: (amp.release ?? 20) / 127.0 * 5.0,
    };
  }

  if (patch.engine?.bendrange !== undefined) {
    articulation.pitchBendUpSt = Math.round(patch.engine.bendrange * 12);
    articulation.pitchBendDownSt = articulation.pitchBendUpSt;
  }

  return {
    presetName: 'OP-XY Multisample',
    regions,
    articulation,
  };
}

export function buildOpXyPatchJson(options: {
  presetName: string;
  regions: ExtendedRegion[];
  articulation?: SynthArticulationConfig;
}): string {
  const regionsNode = options.regions.map((reg) => {
    const hasLoop = reg.loops && reg.loops.length > 0;
    const l = hasLoop ? reg.loops![0] : undefined;

    return {
      sample: reg.sampleName.endsWith('.wav') ? reg.sampleName : `${reg.sampleName}.wav`,
      framecount: reg.sampleEndFrame ?? 44100,
      lokey: reg.lowKey,
      hikey: reg.highKey,
      'pitch.keycenter': reg.rootKey,
      gain: Math.round(reg.volume ?? 0),
      tune: Math.round((reg.detune ?? 0) / 100),
      reverse: reg.reversed ?? false,
      'sample.start': reg.sampleStartFrame ?? 0,
      'sample.end': reg.sampleEndFrame ?? 44100,
      'loop.enabled': hasLoop,
      'loop.start': l?.startFrame ?? 0,
      'loop.end': l?.endFrame ?? 44100,
      'loop.crossfade': l?.crossfadeMs ?? 0,
      'loop.onrelease': l?.mode === 'loop_continuous',
    };
  });

  const ampA = Math.round(((options.articulation?.ampEnv?.attackSec ?? 0.01) / 5.0) * 127);
  const ampD = Math.round(((options.articulation?.ampEnv?.decaySec ?? 0.2) / 5.0) * 127);
  const ampS = Math.round((options.articulation?.ampEnv?.sustainLevel ?? 1.0) * 127);
  const ampR = Math.round(((options.articulation?.ampEnv?.releaseSec ?? 0.3) / 5.0) * 127);

  const doc: OpXyPatchJson = {
    type: 'multisampler',
    platform: 'OP-XY',
    version: 4,
    octave: 0,
    engine: {
      playmode: 'poly',
      volume: 0.5,
      bendrange: (options.articulation?.pitchBendUpSt ?? 2) / 12.0,
      'velocity.sensitivity': 0.5,
      transpose: 0,
    },
    envelope: {
      amp: {
        attack: Math.max(0, Math.min(127, ampA)),
        decay: Math.max(0, Math.min(127, ampD)),
        sustain: Math.max(0, Math.min(127, ampS)),
        release: Math.max(0, Math.min(127, ampR)),
      },
    },
    regions: regionsNode,
  };

  return JSON.stringify(doc, null, 2);
}

export function importOpXyZip(zipBuffer: ArrayBuffer): {
  presetName: string;
  regions: ExtendedRegion[];
  articulation: SynthArticulationConfig;
  audioBuffers: Map<string, ArrayBuffer>;
} {
  const central = indexZipArchive(zipBuffer);
  const audioBuffers = new Map<string, ArrayBuffer>();
  let patchEntry: (typeof central)[0] | undefined;

  for (const entry of central) {
    const low = entry.path.toLowerCase();
    if (low.endsWith('patch.json')) {
      patchEntry = entry;
    } else if (low.endsWith('.wav') || low.endsWith('.flac')) {
      const data = extractZipEntry(zipBuffer, entry);
      const name = entry.path.split('/').pop() || entry.path;
      audioBuffers.set(name, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    }
  }

  if (!patchEntry) {
    throw new Error('No patch.json found in OP-XY package');
  }

  const patchBytes = extractZipEntry(zipBuffer, patchEntry);
  const jsonText = new TextDecoder('utf-8').decode(patchBytes);
  const parsed = parseOpXyPatch(jsonText, audioBuffers);

  // Derive preset name from folder name if available
  const folderName = patchEntry.path.split('/')[0]?.replace(/\.preset$/i, '') || parsed.presetName;

  return {
    presetName: folderName,
    regions: parsed.regions,
    articulation: parsed.articulation,
    audioBuffers,
  };
}
