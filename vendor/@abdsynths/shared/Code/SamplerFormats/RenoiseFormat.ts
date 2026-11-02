// ─────────────────────────────────────────────────────────
// ABDShared / ABDNeuModMakr — Renoise XRNI Format
//
// Clean-room TypeScript parser & writer for Renoise Instrument (.xrni)
// Contrasted against ConvertWithMoss RenoiseCreator & RenoiseDetector.
//
// Structure:
//   An .xrni file is a ZIP containing:
//     - Instrument.xml (root element <RenoiseInstrument doc_version="33">)
//     - SampleData/ (samples stored in FLAC format or WAV)
//   Within Instrument.xml:
//     <GlobalProperties>
//     <SampleGenerator>
//     <Samples>
//       <Sample>
//         <Name>
//         <FileName>SampleData/01 - sample.flac</FileName>
//         <BaseNote>
//         <NoteRange>
//         <VelocityRange>
//         <Volume>
//         <Panning>
//         <LoopMode> (Off, Forward, Reverse, PingPong)
//         <LoopStart>, <LoopEnd>
//     <SampleSplitMap>
//       <NoteSplitMap>
//       <VelocitySplitMap>
// ─────────────────────────────────────────────────────────

import type { UniversalSamplerInstrument } from './UniversalSamplerModel.ts';
import type { ExtendedRegion, SynthArticulationConfig, SampleLoopDescriptor, LoopMode } from './SamplerTypes.ts';
import { createDefaultArticulation } from './ExtendedAdapter.ts';
import { createZipArchive, indexZipArchive, extractZipEntry } from '../NeuronFormats/ZipArchive.ts';
import { decodeFlac, encodeFlacPcm16 } from '../NeuronFormats/UniversalAudioDecoder.ts';
import { decodeWav, encodeWavPcm16 } from '../NeuronFormats/WavAiffDecoder.ts';

export function parseRenoiseXml(
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

  const instName = getTagVal(xmlText, 'Name') || 'RenoiseInstrument';

  // Parse sample elements inside <Samples>
  const sampleRegex = /<Sample>([\s\S]*?)<\/Sample>/gi;
  let sm: RegExpExecArray | null;

  while ((sm = sampleRegex.exec(xmlText)) !== null) {
    const block = sm[1];
    const sName = getTagVal(block, 'Name') || 'Sample';
    const fPath = getTagVal(block, 'FileName') || '';
    const baseAudioName = fPath.split(/[/\\]/).pop() || `${sName}.flac`;

    const baseNote = parseInt(getTagVal(block, 'BaseNote') || '60', 10);
    const lowKey = parseInt(getTagVal(block, 'NoteRangeLow') || getTagVal(block, 'NoteRange') || String(baseNote), 10);
    const highKey = parseInt(getTagVal(block, 'NoteRangeHigh') || String(lowKey), 10);
    const lowVel = parseInt(getTagVal(block, 'VelocityRangeLow') || getTagVal(block, 'VelocityRange') || '1', 10);
    const highVel = parseInt(getTagVal(block, 'VelocityRangeHigh') || '127', 10);

    const volume = parseFloat(getTagVal(block, 'Volume') || '1.0');
    const volDb = volume > 0 ? 20 * Math.log10(volume) : 0;
    const panning = parseFloat(getTagVal(block, 'Panning') || '0.5');
    const pan = (panning - 0.5) * 100; // -50..+50

    const loopModeStr = getTagVal(block, 'LoopMode') || 'Off';
    let loopMode: LoopMode = 'no_loop';
    if (loopModeStr.toLowerCase().includes('forward')) loopMode = 'loop_continuous';
    else if (loopModeStr.toLowerCase().includes('pingpong')) loopMode = 'ping_pong';

    const loopStart = parseInt(getTagVal(block, 'LoopStart') || '0', 10);
    const loopEnd = parseInt(getTagVal(block, 'LoopEnd') || '0', 10);

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
      id: `renoise_zone_${regions.length + 1}`,
      sampleName: baseAudioName,
      rootKey: baseNote,
      lowKey,
      highKey: Math.max(lowKey, highKey),
      lowVel,
      highVel,
      volume: volDb,
      pan,
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
      loopStart: hasLoop ? loopStart : 0,
      loopEnd: hasLoop ? loopEnd : 0,
      loops: loopsDesc,
    });
  }

  return {
    presetName: instName,
    regions,
    articulation,
  };
}

export function generateRenoiseXml(instrument: UniversalSamplerInstrument): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<RenoiseInstrument doc_version="33">');
  lines.push(`  <Name>${instrument.expandedName || instrument.name || 'RenoiseInstrument'}</Name>`);
  lines.push('  <GlobalProperties>');
  lines.push('    <Volume>1.0</Volume>');
  lines.push('    <Transpose>0</Transpose>');
  lines.push('    <FineTune>0</FineTune>');
  lines.push('  </GlobalProperties>');
  lines.push('  <Samples>');

  for (let i = 0; i < instrument.regions.length; i++) {
    const r = instrument.regions[i];
    const sBase = r.sampleName.replace(/\.[^/.]+$/, '');
    const flacName = `${sBase}.flac`;
    const relFile = `SampleData/${String(i + 1).padStart(2, '0')} - ${flacName}`;

    let loopMode = 'Off';
    if (r.loopMode === 'loop_continuous') loopMode = 'Forward';
    else if (r.loopMode === 'ping_pong') loopMode = 'PingPong';

    const vol = Math.pow(10, (r.volume ?? 0) / 20);
    const panNorm = ((r.pan ?? 0) / 100) + 0.5;

    lines.push('    <Sample>');
    lines.push(`      <Name>${sBase}</Name>`);
    lines.push(`      <FileName>${relFile}</FileName>`);
    lines.push(`      <BaseNote>${r.rootKey}</BaseNote>`);
    lines.push(`      <NoteRangeLow>${r.lowKey}</NoteRangeLow>`);
    lines.push(`      <NoteRangeHigh>${r.highKey}</NoteRangeHigh>`);
    lines.push(`      <VelocityRangeLow>${r.lowVel}</VelocityRangeLow>`);
    lines.push(`      <VelocityRangeHigh>${r.highVel}</VelocityRangeHigh>`);
    lines.push(`      <Volume>${vol.toFixed(4)}</Volume>`);
    lines.push(`      <Panning>${panNorm.toFixed(4)}</Panning>`);
    lines.push(`      <LoopMode>${loopMode}</LoopMode>`);
    lines.push(`      <LoopStart>${r.loopStart ?? 0}</LoopStart>`);
    lines.push(`      <LoopEnd>${r.loopEnd ?? 0}</LoopEnd>`);
    lines.push('    </Sample>');
  }

  lines.push('  </Samples>');
  lines.push('</RenoiseInstrument>');
  return lines.join('\n');
}

export function exportRenoiseXrni(
  instrument: UniversalSamplerInstrument,
  audioPool?: Map<string, ArrayBuffer>
): Uint8Array {
  const xml = generateRenoiseXml(instrument);
  const enc = new TextEncoder();
  const entries: { path: string; data: Uint8Array }[] = [];

  entries.push({
    path: 'Instrument.xml',
    data: enc.encode(xml),
  });

  const pool = audioPool ?? instrument.audioPool ?? new Map<string, ArrayBuffer>();

  for (let i = 0; i < instrument.regions.length; i++) {
    const r = instrument.regions[i];
    const sBase = r.sampleName.replace(/\.[^/.]+$/, '');
    const flacName = `${sBase}.flac`;
    const relFile = `SampleData/${String(i + 1).padStart(2, '0')} - ${flacName}`;

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
          path: relFile,
          data: new Uint8Array(flacBytes),
        });
      } catch {
        // Fallback: store as raw if already flac or error
        entries.push({
          path: relFile,
          data: new Uint8Array(rawBuf),
        });
      }
    }
  }

  return createZipArchive(entries);
}

export function importRenoiseXrni(zipBytes: Uint8Array): {
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
    if (lower.endsWith('instrument.xml')) {
      xmlText = new TextDecoder('utf-8').decode(data);
    } else if (lower.endsWith('.flac') || lower.endsWith('.wav')) {
      const baseName = entry.path.split(/[/\\]/).pop() || entry.path;
      // Transcode FLAC to WAV buffer for universal audio pool
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
    throw new Error('Invalid Renoise XRNI: Instrument.xml not found');
  }

  const parsed = parseRenoiseXml(xmlText);
  return {
    presetName: parsed.presetName,
    regions: parsed.regions,
    articulation: parsed.articulation,
    audioBuffers,
  };
}
