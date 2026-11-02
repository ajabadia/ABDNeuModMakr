// ─────────────────────────────────────────────────────────
// ABDShared / ABDNeuModMakr — discoDSP Bliss Format
//
// Clean-room TypeScript parser & writer for discoDSP Bliss (.zbp)
// Contrasted against ConvertWithMoss BlissCreator & BlissDetector.
//
// Structure:
//   A .zbp file is a renamed ZIP containing:
//     - program.xml
//     - samples in FLAC format or WAV format
//   Within program.xml:
//     <program version="0x31400">
//       <name>Preset</name>
//       <zones>
//         <zone>
//           <sample>filename.flac</sample>
//           <root_key>60</root_key>
//           <low_key>36</low_key>
//           <high_key>84</high_key>
//           <low_velocity>1</low_velocity>
//           <high_velocity>127</high_velocity>
//           <tune>0</tune>
//           <gain>0</gain>
//           <pan>0</pan>
//           <loop_mode>1</loop_mode> <!-- 0=off, 1=continuous, 2=pingpong -->
//           <loop_start>0</loop_start>
//           <loop_end>1000</loop_end>
// ─────────────────────────────────────────────────────────

import type { UniversalSamplerInstrument } from './UniversalSamplerModel.ts';
import type { ExtendedRegion, SynthArticulationConfig, SampleLoopDescriptor, LoopMode } from './SamplerTypes.ts';
import { createDefaultArticulation } from './ExtendedAdapter.ts';
import { createZipArchive, indexZipArchive, extractZipEntry } from '../NeuronFormats/ZipArchive.ts';
import { decodeFlac, encodeFlacPcm16 } from '../NeuronFormats/UniversalAudioDecoder.ts';
import { decodeWav, encodeWavPcm16 } from '../NeuronFormats/WavAiffDecoder.ts';

export function parseBlissXml(
  xmlText: string
): {
  presetName: string;
  regions: ExtendedRegion[];
  articulation: SynthArticulationConfig;
} {
  const regions: ExtendedRegion[] = [];
  const articulation = createDefaultArticulation();

  const getTagVal = (block: string, tag: string) => {
    const re = new RegExp(`<${tag}>([^<]+)<\\/${tag}>`, 'i');
    const m = re.exec(block);
    return m ? m[1].trim() : null;
  };

  const presetName = getTagVal(xmlText, 'name') || 'BlissProgram';

  // Parse zones
  const zoneRegex = /<zone>([\s\S]*?)<\/zone>/gi;
  let zm: RegExpExecArray | null;

  while ((zm = zoneRegex.exec(xmlText)) !== null) {
    const block = zm[1];
    const sFile = getTagVal(block, 'sample') || 'sample.flac';
    const baseAudioName = sFile.split(/[/\\]/).pop() || sFile;

    const rootKey = parseInt(getTagVal(block, 'root_key') || '60', 10);
    const lowKey = parseInt(getTagVal(block, 'low_key') || String(rootKey), 10);
    const highKey = parseInt(getTagVal(block, 'high_key') || String(rootKey), 10);
    const lowVel = parseInt(getTagVal(block, 'low_velocity') || '1', 10);
    const highVel = parseInt(getTagVal(block, 'high_velocity') || '127', 10);

    const tune = parseFloat(getTagVal(block, 'tune') || '0');
    const gain = parseFloat(getTagVal(block, 'gain') || '0');
    const pan = parseFloat(getTagVal(block, 'pan') || '0');

    const loopModeInt = parseInt(getTagVal(block, 'loop_mode') || '0', 10);
    let loopMode: LoopMode = 'no_loop';
    if (loopModeInt === 1) loopMode = 'loop_continuous';
    else if (loopModeInt === 2) loopMode = 'ping_pong';

    const loopStart = parseInt(getTagVal(block, 'loop_start') || '0', 10);
    const loopEnd = parseInt(getTagVal(block, 'loop_end') || '0', 10);

    const hasLoop = loopMode !== 'no_loop' && loopEnd > loopStart;
    const loopsDesc: SampleLoopDescriptor[] | undefined = hasLoop
      ? [
          {
            id: '1',
            mode: loopMode,
            startFrame: loopStart,
            endFrame: loopEnd,
          },
        ]
      : undefined;

    regions.push({
      id: `bliss_zone_${regions.length + 1}`,
      sampleName: baseAudioName,
      rootKey,
      lowKey,
      highKey,
      lowVel,
      highVel,
      volume: gain,
      pan: pan * 50, // -1..1 -> -50..50
      detune: Math.round(tune * 100),
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
      loopStart: hasLoop ? loopStart : 0,
      loopEnd: hasLoop ? loopEnd : 0,
      loops: loopsDesc,
    });
  }

  return {
    presetName,
    regions,
    articulation,
  };
}

export function generateBlissXml(instrument: UniversalSamplerInstrument): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<program version="0x31400">');
  lines.push(`  <name>${instrument.expandedName || instrument.name || 'BlissProgram'}</name>`);
  lines.push('  <zones>');

  for (const r of instrument.regions) {
    const sBase = r.sampleName.replace(/\.[^/.]+$/, '');
    const flacName = `${sBase}.flac`;

    let loopModeInt = 0;
    if (r.loopMode === 'loop_continuous') loopModeInt = 1;
    else if (r.loopMode === 'ping_pong') loopModeInt = 2;

    const panNorm = (r.pan ?? 0) / 50.0;
    const tune = (r.detune ?? 0) / 100.0;

    lines.push('    <zone>');
    lines.push(`      <sample>${flacName}</sample>`);
    lines.push(`      <root_key>${r.rootKey}</root_key>`);
    lines.push(`      <low_key>${r.lowKey}</low_key>`);
    lines.push(`      <high_key>${r.highKey}</high_key>`);
    lines.push(`      <low_velocity>${r.lowVel}</low_velocity>`);
    lines.push(`      <high_velocity>${r.highVel}</high_velocity>`);
    lines.push(`      <tune>${tune.toFixed(2)}</tune>`);
    lines.push(`      <gain>${(r.volume ?? 0).toFixed(2)}</gain>`);
    lines.push(`      <pan>${panNorm.toFixed(2)}</pan>`);
    lines.push(`      <loop_mode>${loopModeInt}</loop_mode>`);
    lines.push(`      <loop_start>${r.loopStart ?? 0}</loop_start>`);
    lines.push(`      <loop_end>${r.loopEnd ?? 0}</loop_end>`);
    lines.push('    </zone>');
  }

  lines.push('  </zones>');
  lines.push('</program>');
  return lines.join('\n');
}

export function exportBlissZip(
  instrument: UniversalSamplerInstrument,
  audioPool?: Map<string, ArrayBuffer>
): Uint8Array {
  const xml = generateBlissXml(instrument);
  const enc = new TextEncoder();
  const entries: { path: string; data: Uint8Array }[] = [];

  entries.push({
    path: 'program.xml',
    data: enc.encode(xml),
  });

  const pool = audioPool ?? instrument.audioPool ?? new Map<string, ArrayBuffer>();

  for (const r of instrument.regions) {
    const sBase = r.sampleName.replace(/\.[^/.]+$/, '');
    const flacName = `${sBase}.flac`;

    const rawBuf = pool.get(r.sampleName) || pool.get(flacName) || pool.get(`${sBase}.wav`);
    if (rawBuf) {
      try {
        const dec = decodeWav(rawBuf);
        const flacBytes = encodeFlacPcm16(dec.channels, dec.sampleRate, {
          rootKey: r.rootKey,
          loopStart: r.loopStart,
          loopEnd: r.loopEnd,
        });
        entries.push({
          path: flacName,
          data: new Uint8Array(flacBytes),
        });
      } catch {
        entries.push({
          path: flacName,
          data: new Uint8Array(rawBuf),
        });
      }
    }
  }

  return createZipArchive(entries);
}

export function importBlissZip(zipBytes: Uint8Array): {
  presetName: string;
  regions: ExtendedRegion[];
  articulation: SynthArticulationConfig;
  audioBuffers: Map<string, ArrayBuffer>;
} {
  const entries = indexZipArchive(zipBytes);
  const audioBuffers = new Map<string, ArrayBuffer>();
  let xmlText = '';

  for (const entry of entries) {
    const data = extractZipEntry(zipBytes, entry);
    const lower = entry.path.toLowerCase();
    if (lower.endsWith('program.xml') || lower.endsWith('bank.xml')) {
      xmlText = new TextDecoder('utf-8').decode(data);
    } else if (lower.endsWith('.flac') || lower.endsWith('.wav')) {
      const baseName = entry.path.split(/[/\\]/).pop() || entry.path;
      if (lower.endsWith('.flac')) {
        try {
          const dec = decodeFlac(new Uint8Array(data).slice().buffer);
          const wavBuf = encodeWavPcm16(dec.channels, dec.sampleRate, dec.instrument);
          audioBuffers.set(baseName, wavBuf);
        } catch {
          const copy = new Uint8Array(data.byteLength);
          copy.set(data);
          audioBuffers.set(baseName, copy.buffer);
        }
      } else {
        const copy = new Uint8Array(data.byteLength);
        copy.set(data);
        audioBuffers.set(baseName, copy.buffer);
      }
    }
  }

  if (!xmlText) {
    throw new Error('Invalid discoDSP Bliss archive: program.xml not found');
  }

  const parsed = parseBlissXml(xmlText);
  return {
    presetName: parsed.presetName,
    regions: parsed.regions,
    articulation: parsed.articulation,
    audioBuffers,
  };
}
