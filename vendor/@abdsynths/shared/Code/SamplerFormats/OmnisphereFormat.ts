import { presetIdentity } from './PresetIdentity.ts';
// ─────────────────────────────────────────────────────────────────────────────
// @abdsynths/shared — Spectrasonics Omnisphere Importer & Exporter
//
// High-fidelity clean-room parser and writer for Spectrasonics Omnisphere multisample
// mapping files (.zmap) and preset files (.prt_omn).
//
// Architecture:
//   - .zmap is an XML document describing sample zones:
//       <zmap version="1.0" name="...">
//         <zone sample="..." root="..." lowKey="..." highKey="..."
//               lowVel="..." highVel="..." tune="..." fineTune="..."
//               gain="..." pan="..." loop="..." loopStart="..." loopEnd="..." />
//       </zmap>
//   - Accompanied by external audio files (.wav / .flac) or embedded in STEAM directory tree
// ─────────────────────────────────────────────────────────────────────────────

import type {
  ParsedImportRegion,
  ParsedSamplerPreset,
} from './rawSamplerParsers.ts';

export interface OmnisphereZone {
  sample: string;
  rootKey: number;
  lowKey: number;
  highKey: number;
  lowVelocity: number;
  highVelocity: number;
  coarseTune: number;
  fineTune: number;
  gainDb: number;
  pan: number;
  loopMode: number;
  loopStart: number;
  loopEnd: number;
}

export interface OmnisphereZmap {
  name: string;
  zones: OmnisphereZone[];
}

export function isOmnisphereFile(buffer: ArrayBuffer | Uint8Array, filename = ''): boolean {
  if (filename.toLowerCase().endsWith('.zmap') || filename.toLowerCase().endsWith('.prt_omn')) {
    return true;
  }
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length > 20) {
    const textHead = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 100));
    if (textHead.includes('<zmap') || textHead.includes('<ZMap') || textHead.includes('Spectrasonics')) {
      return true;
    }
  }
  return false;
}

/**
 * Parses an Omnisphere .zmap XML file into structured OmnisphereZmap.
 */
export function parseOmnisphereZmap(xmlText: string): OmnisphereZmap {
  const nameMatch = xmlText.match(/name=["']([^"']+)["']/i);
  const name = nameMatch ? nameMatch[1] : 'Omnisphere_Multisample';

  const zones: OmnisphereZone[] = [];
  const zoneRegex = /<zone\b([^>]*)\/?>/gi;
  let m: RegExpExecArray | null;

  while ((m = zoneRegex.exec(xmlText)) !== null) {
    const attrs = m[1];
    const sMatch = attrs.match(/sample=["']([^"']+)["']/i);
    const rootMatch = attrs.match(/root=["']([^"']+)["']/i);
    const lowKMatch = attrs.match(/lowKey=["']([^"']+)["']/i);
    const highKMatch = attrs.match(/highKey=["']([^"']+)["']/i);
    const lowVMatch = attrs.match(/lowVel=["']([^"']+)["']/i);
    const highVMatch = attrs.match(/highVel=["']([^"']+)["']/i);
    const tuneMatch = attrs.match(/tune=["']([^"']+)["']/i);
    const fineMatch = attrs.match(/fineTune=["']([^"']+)["']/i);
    const gainMatch = attrs.match(/gain=["']([^"']+)["']/i);
    const panMatch = attrs.match(/pan=["']([^"']+)["']/i);
    const loopMatch = attrs.match(/loop=["']([^"']+)["']/i);
    const lStartMatch = attrs.match(/loopStart=["']([^"']+)["']/i);
    const lEndMatch = attrs.match(/loopEnd=["']([^"']+)["']/i);

    if (sMatch) {
      zones.push({
        sample: sMatch[1],
        rootKey: rootMatch ? parseInt(rootMatch[1], 10) : 60,
        lowKey: lowKMatch ? parseInt(lowKMatch[1], 10) : 0,
        highKey: highKMatch ? parseInt(highKMatch[1], 10) : 127,
        lowVelocity: lowVMatch ? parseInt(lowVMatch[1], 10) : 1,
        highVelocity: highVMatch ? parseInt(highVMatch[1], 10) : 127,
        coarseTune: tuneMatch ? parseInt(tuneMatch[1], 10) : 0,
        fineTune: fineMatch ? parseInt(fineMatch[1], 10) : 0,
        gainDb: gainMatch ? parseFloat(gainMatch[1]) : 0,
        pan: panMatch ? parseFloat(panMatch[1]) : 0,
        loopMode: loopMatch ? parseInt(loopMatch[1], 10) : 0,
        loopStart: lStartMatch ? parseInt(lStartMatch[1], 10) : 0,
        loopEnd: lEndMatch ? parseInt(lEndMatch[1], 10) : 0,
      });
    }
  }

  return { name, zones };
}

/**
 * Converts OmnisphereZmap to ParsedSamplerPreset.
 */
export function convertOmnisphereToPreset(
  zmap: OmnisphereZmap,
  audioMap?: Map<string, ArrayBuffer>
): ParsedSamplerPreset {
  const regions: ParsedImportRegion[] = [];
  const audioBuffers = new Map<string, ArrayBuffer>();

  for (const z of zmap.zones) {
    const cleanName = z.sample.replace(/\\/g, '/').split('/').pop() || 'Sample.wav';
    if (audioMap) {
      const match =
        audioMap.get(cleanName) ??
        audioMap.get(cleanName.toLowerCase()) ??
        audioMap.get(cleanName.toUpperCase());
      if (match) {
        audioBuffers.set(cleanName, match);
      }
    }

    regions.push({
      id: `omnisphere_${regions.length + 1}`,
      samplePath: cleanName,
      sampleName: cleanName,
      rootKey: z.rootKey,
      lowKey: z.lowKey,
      highKey: z.highKey,
      lowVel: z.lowVelocity,
      highVel: z.highVelocity,
      detuneCents: z.coarseTune * 100 + z.fineTune,
      volumeDb: z.gainDb,
      pan: z.pan / 100.0,
      loopMode: z.loopMode === 1 ? 'loop_continuous' : 'no_loop',
      loopStart: z.loopStart ?? 0,
      loopEnd: z.loopEnd ?? 0,
    });
  }

  return {
    presetName: zmap.name,
    modelName: zmap.name,
    regions,
    audioBuffers,
    isMultiLayer: regions.length > 1,
    sourceFormat: 'omnisphere',
    ...presetIdentity('omnisphere', 'Spectrasonics Omnisphere', zmap.name),
  };
}

/**
 * Generates an Omnisphere .zmap XML string.
 */
export function generateOmnisphereZmap(
  name: string,
  regions: ParsedImportRegion[]
): string {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<zmap version="1.0" name="${name}">\n`;
  xml += `  <zones>\n`;

  for (const r of regions) {
    const loopVal = r.loopMode === 'loop_continuous' ? 1 : 0;
    xml += `    <zone sample="${r.sampleName}" root="${r.rootKey}" lowKey="${r.lowKey}" highKey="${r.highKey}" lowVel="${r.lowVel}" highVel="${r.highVel}" tune="0" fineTune="${r.detuneCents || 0}" gain="${r.volumeDb || 0}" pan="${Math.round((r.pan || 0) * 100)}" loop="${loopVal}" loopStart="${r.loopStart || 0}" loopEnd="${r.loopEnd || 0}" />\n`;
  }

  xml += `  </zones>\n`;
  xml += `</zmap>\n`;
  return xml;
}
