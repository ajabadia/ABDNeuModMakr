// ─────────────────────────────────────────────────────────────────────────────
// @abdsynths/shared — Audiomodern Soundbox Importer & Exporter
//
// High-fidelity clean-room parser and writer for Audiomodern Soundbox sound packs
// (.sbpack) and standalone instrument definitions (.sbx / XML presets).
//
// Container Architecture:
//   - .sbpack is a ZIP archive containing:
//       - presets/*.xml : Preset definition files with XML elements:
//           <soundbox>
//             <preset name="..." category="...">
//               <layers>
//                 <layer id="..." volume="..." pan="..." tuning="...">
//                   <sounds>
//                     <sound file="..." root="..." lowKey="..." highKey="..."
//                            lowVel="..." highVel="..." loop="..." loopStart="..." loopEnd="..."/>
//                   </sounds>
//                 </layer>
//               </layers>
//             </preset>
//           </soundbox>
//       - samples/*.wav or *.flac : Sample audio pool
// ─────────────────────────────────────────────────────────────────────────────

import { parseZipArchive, createZipArchive } from '../NeuronFormats/ZipArchive.ts';
import type { LoopMode } from './SamplerTypes.ts';
import type {
  ArchiveSamplerProgramInfo,
  ParsedImportRegion,
  ParsedSamplerPreset,
} from './rawSamplerParsers.ts';

export interface SoundboxSound {
  file: string;
  rootKey: number;
  lowKey: number;
  highKey: number;
  lowVelocity: number;
  highVelocity: number;
  fineTuneCents: number;
  volumeDb: number;
  pan: number;
  loopMode: number;
  loopStart: number;
  loopEnd: number;
}

export interface SoundboxLayer {
  id: string;
  volumeDb: number;
  pan: number;
  tuningCents: number;
  sounds: SoundboxSound[];
}

export interface SoundboxPreset {
  name: string;
  category: string;
  layers: SoundboxLayer[];
}

export function isSoundboxBuffer(buffer: ArrayBuffer | Uint8Array, filename = ''): boolean {
  if (filename.toLowerCase().endsWith('.sbpack') || filename.toLowerCase().endsWith('.sbx')) {
    return true;
  }
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length > 20) {
    const textHead = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 100));
    if (textHead.includes('<soundbox') || textHead.includes('<Soundbox')) {
      return true;
    }
  }
  return false;
}

/**
 * Parses Soundbox XML text into a SoundboxPreset structure.
 */
export function parseSoundboxXml(xmlText: string): SoundboxPreset {
  // Clean-room regex-based XML extraction (Node/Browser compatible)
  const nameMatch = xmlText.match(/<preset[^>]*name=["']([^"']+)["']/i);
  const catMatch = xmlText.match(/<preset[^>]*category=["']([^"']+)["']/i);
  const presetName = nameMatch ? nameMatch[1] : 'Soundbox Preset';
  const category = catMatch ? catMatch[1] : 'Synth';

  const layers: SoundboxLayer[] = [];
  const layerRegex = /<layer\b([^>]*)>([\s\S]*?)<\/layer>/gi;
  let layerMatch: RegExpExecArray | null;

  while ((layerMatch = layerRegex.exec(xmlText)) !== null) {
    const layerAttrs = layerMatch[1];
    const layerContent = layerMatch[2];

    const volMatch = layerAttrs.match(/volume=["']([^"']+)["']/i);
    const panMatch = layerAttrs.match(/pan=["']([^"']+)["']/i);
    const tuneMatch = layerAttrs.match(/tuning=["']([^"']+)["']/i);

    const layerVol = volMatch ? parseFloat(volMatch[1]) : 0;
    const layerPan = panMatch ? parseFloat(panMatch[1]) : 0;
    const layerTune = tuneMatch ? parseFloat(tuneMatch[1]) : 0;

    const sounds: SoundboxSound[] = [];
    const soundRegex = /<sound\b([^>]*)\/?>/gi;
    let soundMatch: RegExpExecArray | null;

    while ((soundMatch = soundRegex.exec(layerContent)) !== null) {
      const sAttrs = soundMatch[1];
      const fMatch = sAttrs.match(/file=["']([^"']+)["']/i);
      const rootMatch = sAttrs.match(/root=["']([^"']+)["']/i);
      const lowKMatch = sAttrs.match(/lowKey=["']([^"']+)["']/i);
      const highKMatch = sAttrs.match(/highKey=["']([^"']+)["']/i);
      const lowVMatch = sAttrs.match(/lowVel=["']([^"']+)["']/i);
      const highVMatch = sAttrs.match(/highVel=["']([^"']+)["']/i);
      const loopMatch = sAttrs.match(/loop=["']([^"']+)["']/i);
      const lStartMatch = sAttrs.match(/loopStart=["']([^"']+)["']/i);
      const lEndMatch = sAttrs.match(/loopEnd=["']([^"']+)["']/i);
      const sVolMatch = sAttrs.match(/volume=["']([^"']+)["']/i);
      const sPanMatch = sAttrs.match(/pan=["']([^"']+)["']/i);

      if (fMatch) {
        sounds.push({
          file: fMatch[1],
          rootKey: rootMatch ? parseInt(rootMatch[1], 10) : 60,
          lowKey: lowKMatch ? parseInt(lowKMatch[1], 10) : 0,
          highKey: highKMatch ? parseInt(highKMatch[1], 10) : 127,
          lowVelocity: lowVMatch ? parseInt(lowVMatch[1], 10) : 1,
          highVelocity: highVMatch ? parseInt(highVMatch[1], 10) : 127,
          fineTuneCents: 0,
          volumeDb: sVolMatch ? parseFloat(sVolMatch[1]) : 0,
          pan: sPanMatch ? parseFloat(sPanMatch[1]) : 0,
          loopMode: loopMatch ? parseInt(loopMatch[1], 10) : 0,
          loopStart: lStartMatch ? parseInt(lStartMatch[1], 10) : 0,
          loopEnd: lEndMatch ? parseInt(lEndMatch[1], 10) : 0,
        });
      }
    }

    layers.push({
      id: `layer_${layers.length + 1}`,
      volumeDb: layerVol,
      pan: layerPan,
      tuningCents: layerTune,
      sounds,
    });
  }

  return {
    name: presetName,
    category,
    layers,
  };
}

/**
 * Lists all presets in a Soundbox .sbpack ZIP package.
 */
export function listSoundboxPackPresets(buffer: ArrayBuffer | Uint8Array): ArchiveSamplerProgramInfo[] {
  const entries = parseZipArchive(buffer);
  const results: ArchiveSamplerProgramInfo[] = [];

  for (const entry of entries) {
    if (entry.path.toLowerCase().endsWith('.xml') && !entry.path.startsWith('__MACOSX')) {
      const xmlText = new TextDecoder('utf-8', { fatal: false }).decode(entry.data);
      if (xmlText.includes('<soundbox') || xmlText.includes('<Soundbox')) {
        const parsed = parseSoundboxXml(xmlText);
        results.push({
          id: entry.path,
          name: parsed.name,
          format: 'soundbox' as any,
          entryPath: entry.path,
          sampleCount: parsed.layers.reduce((acc, l) => acc + l.sounds.length, 0),
        });
      }
    }
  }

  return results;
}

/**
 * Parses a Soundbox package or XML into a ParsedSamplerPreset.
 */
export function parseSoundboxPack(
  buffer: ArrayBuffer | Uint8Array,
  targetPresetPath?: string
): ParsedSamplerPreset {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  // Check if buffer is a raw XML file
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 100));
  if (head.includes('<soundbox') || head.includes('<Soundbox')) {
    const xml = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    const parsed = parseSoundboxXml(xml);
    return convertSoundboxToPreset(parsed);
  }

  // Otherwise handle as .sbpack ZIP archive
  const entries = parseZipArchive(bytes);
  const audioMap = new Map<string, ArrayBuffer>();
  let chosenXml: string | null = null;
  let chosenXmlPath = '';

  for (const entry of entries) {
    const pLower = entry.path.toLowerCase();
    if (pLower.endsWith('.wav') || pLower.endsWith('.flac')) {
      const baseName = entry.path.split('/').pop() || entry.path;
      audioMap.set(baseName, entry.data.buffer.slice(entry.data.byteOffset, entry.data.byteOffset + entry.data.byteLength));
    } else if (pLower.endsWith('.xml') && !entry.path.startsWith('__MACOSX')) {
      if (!chosenXml || (targetPresetPath && entry.path === targetPresetPath)) {
        chosenXml = new TextDecoder('utf-8', { fatal: false }).decode(entry.data);
        chosenXmlPath = entry.path;
      }
    }
  }

  if (!chosenXml) {
    throw new Error('No Soundbox preset XML found inside .sbpack archive.');
  }

  const preset = parseSoundboxXml(chosenXml);
  return convertSoundboxToPreset(preset, audioMap);
}

export function convertSoundboxToPreset(
  sbPreset: SoundboxPreset,
  audioMap?: Map<string, ArrayBuffer>
): ParsedSamplerPreset {
  const regions: ParsedImportRegion[] = [];
  const audioBuffers = new Map<string, ArrayBuffer>();

  for (const layer of sbPreset.layers) {
    for (const snd of layer.sounds) {
      const cleanFileName = snd.file.replace(/\\/g, '/').split('/').pop() || 'Sample.wav';
      if (audioMap) {
        const match =
          audioMap.get(cleanFileName) ??
          audioMap.get(cleanFileName.toLowerCase()) ??
          audioMap.get(cleanFileName.toUpperCase());
        if (match) {
          audioBuffers.set(cleanFileName, match);
        }
      }

      regions.push({
        sampleName: cleanFileName,
        rootKey: snd.rootKey,
        lowKey: snd.lowKey,
        highKey: snd.highKey,
        lowVelocity: snd.lowVelocity,
        highVelocity: snd.highVelocity,
        fineTuneCents: layer.tuningCents + snd.fineTuneCents,
        gainDb: layer.volumeDb + snd.volumeDb,
        pan: (layer.pan + snd.pan) / 100.0,
        loopMode: snd.loopMode === 1 ? 'loop_continuous' : snd.loopMode === 2 ? 'loop_bidirectional' : 'no_loop',
        loopStart: snd.loopStart,
        loopEnd: snd.loopEnd,
      });
    }
  }

  return {
    presetName: sbPreset.name,
    modelName: sbPreset.name,
    regions,
    audioBuffers,
    isMultiLayer: sbPreset.layers.length > 1,
    sourceFormat: 'soundbox',
  };
}

/**
 * Builds a Soundbox XML definition string for an instrument.
 */
export function generateSoundboxXml(
  presetName: string,
  regions: ParsedImportRegion[],
  category = 'Synth'
): string {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<soundbox version="1.0">\n`;
  xml += `  <preset name="${presetName}" category="${category}">\n`;
  xml += `    <layers>\n`;
  xml += `      <layer id="layer_1" volume="0" pan="0" tuning="0">\n`;
  xml += `        <sounds>\n`;

  for (const r of regions) {
    const loopVal = r.loopMode === 'loop_continuous' ? 1 : r.loopMode === 'loop_bidirectional' ? 2 : 0;
    xml += `          <sound file="${r.sampleName}" root="${r.rootKey}" lowKey="${r.lowKey}" highKey="${r.highKey}" lowVel="${r.lowVelocity}" highVel="${r.highVelocity}" loop="${loopVal}" loopStart="${r.loopStart || 0}" loopEnd="${r.loopEnd || 0}" volume="${r.gainDb || 0}" pan="${Math.round((r.pan || 0) * 100)}" />\n`;
  }

  xml += `        </sounds>\n`;
  xml += `      </layer>\n`;
  xml += `    </layers>\n`;
  xml += `  </preset>\n`;
  xml += `</soundbox>\n`;

  return xml;
}
