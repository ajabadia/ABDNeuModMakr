// ─────────────────────────────────────────────────────────
// ABDShared / ABDNeuModMakr — 1010music Blackbox / Tangerine Format
//
// Clean-room TypeScript parser & writer for 1010music Blackbox preset.xml
// Contrasted against ConvertWithMoss Music1010Creator & Music1010Detector.
//
// Layout:
//   - preset.xml (in root or Presets/ folder)
//   - audio samples (in subfolder or sibling)
// Structure:
//   <document version="1.0">
//     <session>
//       <cell row="0" column="0" layer="0" filename="..." type="sample">
//         <params cellmode="0" samtrigtype="1" multisammode="1" .../>
//       </cell>
//       <cell row="0" type="asset" filename="...">
//         <params asssrcrow="0" asssrccol="0" rootnote="60" keyrangebottom="36" keyrangetop="84" .../>
//       </cell>
//     </session>
//   </document>
// ─────────────────────────────────────────────────────────

import type { UniversalSamplerInstrument } from './UniversalSamplerModel.ts';
import type { ExtendedRegion, SynthArticulationConfig, SampleLoopDescriptor } from './SamplerTypes.ts';
import { createDefaultArticulation } from './ExtendedAdapter.ts';
import { createZipArchive, indexZipArchive, extractZipEntry } from '../NeuronFormats/ZipArchive.ts';
import { decodeWav } from '../NeuronFormats/WavAiffDecoder.ts';

export interface Music1010CellAsset {
  filename: string;
  sourceRow: number;
  sourceCol: number;
  rootNote: number;
  lowKey: number;
  highKey: number;
  lowVel: number;
  highVel: number;
  sampleLen?: number;
  reverse?: boolean;
}

export function parseMusic1010Xml(
  xmlText: string,
  audioPool?: Map<string, ArrayBuffer>
): {
  presetName: string;
  regions: ExtendedRegion[];
  articulation: SynthArticulationConfig;
} {
  const regions: ExtendedRegion[] = [];
  const articulation = createDefaultArticulation();

  // Simple pure-regex / string parser compatible with Node and browser
  // Extract cells
  const cellRegex = /<cell\s+([^>]+)>(?:[\s\S]*?<params\s+([^>]+)\/>)?[\s\S]*?<\/cell>/gi;
  let match: RegExpExecArray | null;

  let instrumentFound = false;

  while ((match = cellRegex.exec(xmlText)) !== null) {
    const cellAttrsStr = match[1];
    const paramsAttrsStr = match[2] || '';

    const parseAttrs = (s: string) => {
      const map = new Map<string, string>();
      const re = /([a-zA-Z0-9_:-]+)="([^"]*)"/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(s)) !== null) {
        map.set(m[1].toLowerCase(), m[2]);
      }
      return map;
    };

    const cellAttrs = parseAttrs(cellAttrsStr);
    const paramsAttrs = parseAttrs(paramsAttrsStr);

    const type = cellAttrs.get('type') || '';

    if (type === 'sample' && !instrumentFound) {
      instrumentFound = true;
      // Extract amp envelope and filter from active cell params
      const envAttack = parseFloat(paramsAttrs.get('envattack') || '0');
      const envDecay = parseFloat(paramsAttrs.get('envdecay') || '0');
      const envSus = parseFloat(paramsAttrs.get('envsus') || '1000');
      const envRel = parseFloat(paramsAttrs.get('envrel') || '200');

      // Convert from normalized 0..1000 (roughly 0..9s attack, 0..38s decay/rel)
      articulation.ampEnv.attackSec = (envAttack / 1000) * 9.0;
      articulation.ampEnv.decaySec = (envDecay / 1000) * 38.0;
      articulation.ampEnv.sustainLevel = Math.max(0, Math.min(1.0, envSus / 1000.0));
      articulation.ampEnv.releaseSec = (envRel / 1000) * 38.0;

      const dualFilCutoff = parseFloat(paramsAttrs.get('dualfilcutoff') || '0');
      if (dualFilCutoff !== 0) {
        articulation.filter.enabled = true;
        // dualfilcutoff: positive = lowpass, negative = highpass
        if (dualFilCutoff > 0) {
          articulation.filter.type = 'lpf';
          articulation.filter.cutoffHz = 20 + (dualFilCutoff / 1000.0) * 19980;
        } else {
          articulation.filter.type = 'hpf';
          articulation.filter.cutoffHz = 20 + (Math.abs(dualFilCutoff) / 1000.0) * 19980;
        }
        const res = parseFloat(paramsAttrs.get('res') || '0');
        articulation.filter.resonanceDb = (res / 1000.0) * 24.0;
      }
    } else if (type === 'asset') {
      const filenamePath = cellAttrs.get('filename') || '';
      const baseName = filenamePath.split(/[/\\]/).pop() || 'sample.wav';

      const rootNote = parseInt(paramsAttrs.get('rootnote') || '60', 10);
      const lowKey = parseInt(paramsAttrs.get('keyrangebottom') || String(rootNote), 10);
      const highKey = parseInt(paramsAttrs.get('keyrangetop') || String(rootNote), 10);
      const lowVel = parseInt(paramsAttrs.get('velrangebottom') || '1', 10);
      const highVel = parseInt(paramsAttrs.get('velrangetop') || '127', 10);
      const sampleLen = paramsAttrs.has('samlen') ? parseInt(paramsAttrs.get('samlen')!, 10) : undefined;
      const reverse = paramsAttrs.get('reverse') === '1';

      // Look up embedded loop in audio buffer if present
      let loopStart: number | undefined;
      let loopEnd: number | undefined;
      let loopMode: ExtendedRegion['loopMode'] = 'no_loop';

      if (audioPool && audioPool.has(baseName)) {
        try {
          const dec = decodeWav(audioPool.get(baseName)!);
          if (dec.instrument?.loopStart !== undefined && dec.instrument.loopEnd !== undefined) {
            loopStart = dec.instrument.loopStart;
            loopEnd = dec.instrument.loopEnd;
            loopMode = dec.instrument.loopMode ?? 'loop_continuous';
          }
        } catch {
          // non-blocking
        }
      }

      const loopsDesc: SampleLoopDescriptor[] | undefined =
        loopStart !== undefined && loopEnd !== undefined
          ? [
              {
                id: '1',
                mode: 'loop_continuous',
                startFrame: loopStart,
                endFrame: loopEnd,
              },
            ]
          : undefined;

      regions.push({
        id: `zone_${regions.length + 1}`,
        sampleName: baseName,
        rootKey: rootNote,
        lowKey,
        highKey,
        lowVel,
        highVel,
        volume: 0,
        pan: 0,
        detune: 0,
        pitchKeytrack: 100,
        trigger: 'attack',
        playLogic: 'velocity',
        keyFadeIn: 0,
        keyFadeOut: 0,
        velFadeIn: 0,
        velFadeOut: 0,
        fadeCurve: 'equal-power',
        loopCrossfadeMs: 0,
        sampleEndFrame: sampleLen,
        reversed: reverse,
        loopMode,
        loopStart: loopStart ?? 0,
        loopEnd: loopEnd ?? 0,
        loops: loopsDesc,
      });
    }
  }

  return {
    presetName: 'Music1010Preset',
    regions,
    articulation,
  };
}

export function generateMusic1010Xml(
  instrument: UniversalSamplerInstrument,
  presetSubFolder = 'Samples'
): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<document version="1.0">');
  lines.push('  <session>');

  // Create slot 0 cell
  const attkNorm = Math.round(Math.min(1000, (instrument.articulation.ampEnv.attackSec / 9.0) * 1000));
  const decNorm = Math.round(Math.min(1000, (instrument.articulation.ampEnv.decaySec / 38.0) * 1000));
  const susNorm = Math.round(Math.min(1000, instrument.articulation.ampEnv.sustainLevel * 1000));
  const relNorm = Math.round(Math.min(1000, (instrument.articulation.ampEnv.releaseSec / 38.0) * 1000));

  let filterCutoffStr = '0';
  let filterResStr = '0';
  if (instrument.articulation.filter.enabled) {
    const fNorm = Math.round(Math.max(0, Math.min(1000, ((instrument.articulation.filter.cutoffHz - 20) / 19980) * 1000)));
    filterCutoffStr = instrument.articulation.filter.type === 'hpf' ? String(-fNorm) : String(fNorm);
    const resNorm = Math.round(Math.max(0, Math.min(1000, ((instrument.articulation.filter.resonanceDb ?? 0) / 24.0) * 1000)));
    filterResStr = String(resNorm);
  }

  lines.push(`    <cell row="0" column="0" layer="0" filename="\\Presets\\${presetSubFolder}" type="sample">`);
  lines.push(`      <params gaindb="0" pitch="0" panpos="0" samtrigtype="1" loopmode="0" loopmodes="0" reverse="0" cellmode="0"`);
  lines.push(`        envattack="${attkNorm}" envdecay="${decNorm}" envsus="${susNorm}" envrel="${relNorm}"`);
  lines.push(`        samstart="0" samlen="0" loopstart="0" loopend="0" quantsize="3" synctype="5" actslice="1" outputbus="0"`);
  lines.push(`        polymode="5" slicestepmode="0" chokegrp="0" dualfilcutoff="${filterCutoffStr}" res="${filterResStr}" rootnote="0"`);
  lines.push(`        multisammode="1" playthru="0" interpqual="1"/>`);
  lines.push('    </cell>');

  // Inactive slots 1..15
  for (let slot = 1; slot < 16; slot++) {
    const row = Math.floor(slot / 4);
    const col = slot % 4;
    lines.push(`    <cell row="${row}" column="${col}" layer="0" filename="" type="samtempl">`);
    lines.push(`      <params gaindb="0" reverse="0" cellmode="0" envattack="0" envdecay="0" envsus="1000" envrel="200"`);
    lines.push(`        samstart="0" samlen="0" quantsize="3" synctype="5" mute="0" pitch="0" dualfilcutoff="0" res="500"`);
    lines.push(`        panpos="0" samtrigtype="0" polymode="0" chokegrp="0" midimode="0" padnote="0" rootnote="0"/>`);
    lines.push('    </cell>');
  }

  // Asset cells for each region
  for (let i = 0; i < instrument.regions.length; i++) {
    const r = instrument.regions[i];
    const sName = r.sampleName.endsWith('.wav') ? r.sampleName : `${r.sampleName}.wav`;
    const relPath = `\\Presets\\${presetSubFolder}\\${sName}`;
    const reverseStr = r.reversed ? '1' : '0';
    const lenAttr = r.sampleEndFrame && r.sampleEndFrame > 0 ? ` samlen="${r.sampleEndFrame}"` : '';

    lines.push(`    <cell filename="${relPath}" row="${i}" type="asset">`);
    lines.push(`      <params asssrcrow="0" asssrccol="0" reverse="${reverseStr}" rootnote="${r.rootKey}"`);
    lines.push(`        keyrangebottom="${r.lowKey}" keyrangetop="${r.highKey}"`);
    lines.push(`        velrangebottom="${r.lowVel}" velrangetop="${r.highVel}"${lenAttr}/>`);
    lines.push('    </cell>');
  }

  lines.push('  </session>');
  lines.push('</document>');
  return lines.join('\n');
}

export function exportMusic1010Zip(
  instrument: UniversalSamplerInstrument,
  audioPool?: Map<string, ArrayBuffer>
): Uint8Array {
  const presetFolder = instrument.expandedName || instrument.name || 'BlackboxPreset';
  const xml = generateMusic1010Xml(instrument, presetFolder);
  const enc = new TextEncoder();

  const entries: { path: string; data: Uint8Array }[] = [];
  entries.push({
    path: 'preset.xml',
    data: enc.encode(xml),
  });

  const pool = audioPool ?? instrument.audioPool ?? new Map<string, ArrayBuffer>();
  for (const r of instrument.regions) {
    const sName = r.sampleName.endsWith('.wav') ? r.sampleName : `${r.sampleName}.wav`;
    const buf = pool.get(r.sampleName) || pool.get(sName);
    if (buf) {
      entries.push({
        path: `${presetFolder}/${sName}`,
        data: new Uint8Array(buf),
      });
    }
  }

  return createZipArchive(entries);
}

export function importMusic1010Zip(zipBytes: Uint8Array): {
  presetName: string;
  regions: ExtendedRegion[];
  articulation: SynthArticulationConfig;
  audioBuffers: Map<string, ArrayBuffer>;
} {
  const entries = indexZipArchive(zipBytes);
  const audioBuffers = new Map<string, ArrayBuffer>();
  let presetXmlText = '';

  for (const entry of entries) {
    const data = extractZipEntry(zipBytes, entry);
    const lower = entry.path.toLowerCase();
    if (lower.endsWith('preset.xml')) {
      presetXmlText = new TextDecoder('utf-8').decode(data);
    } else if (lower.endsWith('.wav')) {
      const baseName = entry.path.split(/[/\\]/).pop() || entry.path;
      const copy = new Uint8Array(data.byteLength);
      copy.set(data);
      audioBuffers.set(baseName, copy.buffer);
    }
  }

  if (!presetXmlText) {
    throw new Error('Invalid 1010music archive: preset.xml not found');
  }

  const parsed = parseMusic1010Xml(presetXmlText, audioBuffers);
  if (parsed.regions.length === 0) {
    throw new Error('Not a 1010music multi-cell preset: 0 valid cell assets parsed');
  }
  return {
    presetName: parsed.presetName,
    regions: parsed.regions,
    articulation: parsed.articulation,
    audioBuffers,
  };
}
