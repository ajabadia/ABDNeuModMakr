// ─────────────────────────────────────────────────────────
// ABDShared / ABDNeuModMakr — Synthstrom Deluge Format
//
// Clean-room TypeScript parser & writer for Synthstrom Deluge SYNTHS/*.XML
// Contrasted against ConvertWithMoss DelugeCreator & DelugeDetector.
//
// Structure:
//   <sound>
//     <osc1 type="sample">
//       <sampleRanges>
//         <sampleRange rangeTopNote="64" fileName="SAMPLES/.../sample.wav"/>
//       </sampleRanges>
//       <zone startSamplePos="0" endSamplePos="1000"/>
//     </osc1>
//     <lpfMode>24dB</lpfMode>
//     <lpfCutoff>0x7FFFFFFF</lpfCutoff>
//     <lpfResonance>0x00000000</lpfResonance>
//     <attack>0x00000000</attack>
//     <decay>0x7FFFFFFF</decay>
//     <sustain>0x7FFFFFFF</sustain>
//     <release>0x20000000</release>
//   </sound>
// ─────────────────────────────────────────────────────────

import type { UniversalSamplerInstrument } from './UniversalSamplerModel.ts';
import type { ExtendedRegion, SynthArticulationConfig, SampleLoopDescriptor } from './SamplerTypes.ts';
import { createDefaultArticulation } from './ExtendedAdapter.ts';
import { createZipArchive, indexZipArchive, extractZipEntry } from '../NeuronFormats/ZipArchive.ts';
import { decodeWav } from '../NeuronFormats/WavAiffDecoder.ts';

function hexToRatio(hexStr: string): number {
  const clean = hexStr.trim();
  const num = clean.startsWith('0x') || clean.startsWith('0X') ? parseInt(clean, 16) : parseInt(clean, 10);
  if (isNaN(num)) return 0;
  return Math.max(0, Math.min(1.0, num / 2147483647.0));
}

function ratioToHex(val: number): string {
  const clamped = Math.max(0, Math.min(1.0, val));
  const num = Math.round(clamped * 2147483647);
  return '0x' + num.toString(16).toUpperCase().padStart(8, '0');
}

export function parseDelugeXml(
  xmlText: string,
  audioPool?: Map<string, ArrayBuffer>
): {
  presetName: string;
  regions: ExtendedRegion[];
  articulation: SynthArticulationConfig;
} {
  const regions: ExtendedRegion[] = [];
  const articulation = createDefaultArticulation();

  // Parse envelope
  const getTagVal = (tag: string) => {
    const re = new RegExp(`<${tag}>([^<]+)<\\/${tag}>`, 'i');
    const m = re.exec(xmlText);
    return m ? m[1].trim() : null;
  };

  const attkStr = getTagVal('attack');
  const decStr = getTagVal('decay');
  const susStr = getTagVal('sustain');
  const relStr = getTagVal('release');

  if (attkStr) articulation.ampEnv.attackSec = hexToRatio(attkStr) * 5.9;
  if (decStr) articulation.ampEnv.decaySec = hexToRatio(decStr) * 5.9;
  if (susStr) articulation.ampEnv.sustainLevel = hexToRatio(susStr);
  if (relStr) articulation.ampEnv.releaseSec = hexToRatio(relStr) * 5.9;

  const lpfCutoff = getTagVal('lpfCutoff');
  if (lpfCutoff) {
    const ratio = hexToRatio(lpfCutoff);
    if (ratio < 0.98) {
      articulation.filter.enabled = true;
      articulation.filter.type = 'lpf';
      articulation.filter.cutoffHz = 20 * Math.pow(1000, ratio);
      const resStr = getTagVal('lpfResonance');
      if (resStr) articulation.filter.resonanceDb = hexToRatio(resStr) * 24.0;
      const modeStr = getTagVal('lpfMode');
      articulation.filter.poles = modeStr && modeStr.includes('12') ? 2 : 4;
    }
  }

  // Parse sample ranges inside <sampleRanges>
  const rangeRegex = /<sampleRange\s+([^>]+)\/>/gi;
  let m: RegExpExecArray | null;
  const sampleRanges: { topNote: number; fileName: string }[] = [];

  while ((m = rangeRegex.exec(xmlText)) !== null) {
    const attrStr = m[1];
    const topMatch = /rangeTopNote="([^"]*)"/i.exec(attrStr);
    const fileMatch = /fileName="([^"]*)"/i.exec(attrStr);
    if (topMatch && fileMatch) {
      sampleRanges.push({
        topNote: parseInt(topMatch[1], 10),
        fileName: fileMatch[1],
      });
    }
  }

  sampleRanges.sort((a, b) => a.topNote - b.topNote);

  let prevTop = 0;
  for (let i = 0; i < sampleRanges.length; i++) {
    const sr = sampleRanges[i];
    const lowKey = i === 0 ? 0 : prevTop + 1;
    const highKey = sr.topNote;
    prevTop = highKey;

    const baseName = sr.fileName.split(/[/\\]/).pop() || 'sample.wav';
    let rootKey = Math.round((lowKey + highKey) / 2);

    let loopStart: number | undefined;
    let loopEnd: number | undefined;
    let loopMode: ExtendedRegion['loopMode'] = 'no_loop';

    if (audioPool && audioPool.has(baseName)) {
      try {
        const dec = decodeWav(audioPool.get(baseName)!);
        if (dec.instrument?.rootKey !== undefined) {
          rootKey = dec.instrument.rootKey;
        }
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
      id: `deluge_zone_${i + 1}`,
      sampleName: baseName,
      rootKey,
      lowKey,
      highKey,
      lowVel: 1,
      highVel: 127,
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
      loopMode,
      loopStart: loopStart ?? 0,
      loopEnd: loopEnd ?? 0,
      loops: loopsDesc,
    });
  }

  return {
    presetName: 'DelugeSynth',
    regions,
    articulation,
  };
}

export function generateDelugeXml(
  instrument: UniversalSamplerInstrument,
  relativeSampleFolder: string
): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<sound>');
  lines.push('  <osc1 type="sample">');
  lines.push('    <sampleRanges>');

  // Sort regions by highKey ascending
  const sorted = [...instrument.regions].sort((a, b) => a.highKey - b.highKey);
  for (const r of sorted) {
    const sName = r.sampleName.endsWith('.wav') ? r.sampleName : `${r.sampleName}.wav`;
    const fullRelPath = `${relativeSampleFolder}/${sName}`.replace(/\\/g, '/');
    lines.push(`      <sampleRange rangeTopNote="${r.highKey}" fileName="${fullRelPath}"/>`);
  }

  lines.push('    </sampleRanges>');
  lines.push('    <zone startSamplePos="0" endSamplePos="0"/>');
  lines.push('  </osc1>');

  // Filter
  if (instrument.articulation.filter.enabled) {
    const poles = instrument.articulation.filter.poles ?? 4;
    lines.push(`  <lpfMode>${poles === 2 ? '12dB' : '24dB'}</lpfMode>`);
    const ratio = Math.log(instrument.articulation.filter.cutoffHz / 20) / Math.log(1000);
    lines.push(`  <lpfCutoff>${ratioToHex(ratio)}</lpfCutoff>`);
    const resRatio = Math.max(0, Math.min(1.0, (instrument.articulation.filter.resonanceDb ?? 0) / 24.0));
    lines.push(`  <lpfResonance>${ratioToHex(resRatio)}</lpfResonance>`);
  }

  // Envelope
  const attkRatio = instrument.articulation.ampEnv.attackSec / 5.9;
  const decRatio = instrument.articulation.ampEnv.decaySec / 5.9;
  const relRatio = instrument.articulation.ampEnv.releaseSec / 5.9;

  lines.push(`  <attack>${ratioToHex(attkRatio)}</attack>`);
  lines.push(`  <decay>${ratioToHex(decRatio)}</decay>`);
  lines.push(`  <sustain>${ratioToHex(instrument.articulation.ampEnv.sustainLevel)}</sustain>`);
  lines.push(`  <release>${ratioToHex(relRatio)}</release>`);
  lines.push('</sound>');

  return lines.join('\n');
}

export function exportDelugeZip(
  instrument: UniversalSamplerInstrument,
  audioPool?: Map<string, ArrayBuffer>
): Uint8Array {
  const presetName = instrument.expandedName || instrument.name || 'DelugeSynth';
  const relFolder = `SAMPLES/${presetName}`;
  const xml = generateDelugeXml(instrument, relFolder);
  const enc = new TextEncoder();

  const entries: { path: string; data: Uint8Array }[] = [];
  entries.push({
    path: `SYNTHS/${presetName}.XML`,
    data: enc.encode(xml),
  });

  const pool = audioPool ?? instrument.audioPool ?? new Map<string, ArrayBuffer>();
  for (const r of instrument.regions) {
    const sName = r.sampleName.endsWith('.wav') ? r.sampleName : `${r.sampleName}.wav`;
    const buf = pool.get(r.sampleName) || pool.get(sName);
    if (buf) {
      entries.push({
        path: `${relFolder}/${sName}`,
        data: new Uint8Array(buf),
      });
    }
  }

  return createZipArchive(entries);
}

export function importDelugeZip(zipBytes: Uint8Array): {
  presetName: string;
  regions: ExtendedRegion[];
  articulation: SynthArticulationConfig;
  audioBuffers: Map<string, ArrayBuffer>;
} {
  const entries = indexZipArchive(zipBytes);
  const audioBuffers = new Map<string, ArrayBuffer>();
  let xmlText = '';
  let presetName = 'DelugeSynth';

  for (const entry of entries) {
    const data = extractZipEntry(zipBytes, entry);
    const lower = entry.path.toLowerCase();
    if (lower.endsWith('.xml') && (lower.includes('synths') || lower.includes('kits'))) {
      xmlText = new TextDecoder('utf-8').decode(data);
      presetName = entry.path.split(/[/\\]/).pop()?.replace(/\.xml$/i, '') || presetName;
    } else if (lower.endsWith('.wav')) {
      const baseName = entry.path.split(/[/\\]/).pop() || entry.path;
      const copy = new Uint8Array(data.byteLength);
      copy.set(data);
      audioBuffers.set(baseName, copy.buffer);
    }
  }

  if (!xmlText) {
    throw new Error('Invalid Deluge archive: XML preset not found');
  }

  const parsed = parseDelugeXml(xmlText, audioBuffers);
  parsed.presetName = presetName;
  return {
    presetName,
    regions: parsed.regions,
    articulation: parsed.articulation,
    audioBuffers,
  };
}
