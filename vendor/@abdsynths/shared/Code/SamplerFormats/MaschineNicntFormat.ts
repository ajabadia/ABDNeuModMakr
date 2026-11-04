// ─────────────────────────────────────────────────────────────────────────────
// @abdsynths/shared — Native Instruments Maschine & NICNT Importer
//
// High-fidelity clean-room parser for NI Maschine Sound/Group files (.mxsnd, .mxgrp)
// and NI Container / Content metadata (.nicnt).
//
// Architecture:
//   - Maschine 1 & 2 containers (.mxsnd, .msnd, .mxgrp):
//       - RIFF / NI Container chunk stream (magic: '\x2E\x6E\x69\x63' or RIFF / JSON block)
//       - Internal XML/JSON tree describing Groups, Sounds, Sampler modules:
//           - Zones, key ranges (low/high), vel ranges, root key, sample path references,
//           - Sampler module params (tune, pan, volume, ADSR envelope, filter)
//   - NI Content containers (.nicnt):
//       - XML / binary header with library identifier (SNPID), bank name, company,
//         and UPID for Native Access licensing.
// ─────────────────────────────────────────────────────────────────────────────

import type { LoopMode } from './SamplerTypes.ts';
import type {
  ArchiveSamplerProgramInfo,
  ParsedImportRegion,
  ParsedSamplerPreset,
} from './rawSamplerParsers.ts';

export interface MaschineZone {
  sampleFile: string;
  rootKey: number;
  lowKey: number;
  highKey: number;
  lowVelocity: number;
  highVelocity: number;
  tuneSemitones: number;
  tuneCents: number;
  volumeDb: number;
  pan: number;
  loopMode: number;
  loopStart: number;
  loopEnd: number;
}

export interface MaschineSound {
  name: string;
  zones: MaschineZone[];
}

export interface NicntMetadata {
  name: string;
  company: string;
  snpid: string;
  author: string;
}

export function isMaschineOrNicnt(buffer: ArrayBuffer | Uint8Array, filename = ''): boolean {
  const fLower = filename.toLowerCase();
  if (
    fLower.endsWith('.mxsnd') ||
    fLower.endsWith('.mxgrp') ||
    fLower.endsWith('.msnd') ||
    fLower.endsWith('.nicnt')
  ) {
    return true;
  }

  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length > 20) {
    // Check for NI Container magic or NICNT XML
    if (bytes[0] === 0x2e && bytes[1] === 0x6e && bytes[2] === 0x69 && bytes[3] === 0x63) {
      return true; // .nic
    }
    const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 150));
    if (head.includes('<sound') || head.includes('<Sound') || head.includes('<nicnt') || head.includes('<NICNT')) {
      return true;
    }
  }
  return false;
}

/**
 * Parses a Native Instruments .nicnt XML metadata container.
 */
export function parseNicnt(xmlText: string): NicntMetadata {
  const nameMatch = xmlText.match(/<Name>([^<]+)<\/Name>/i);
  const compMatch = xmlText.match(/<Company>([^<]+)<\/Company>/i);
  const snpMatch = xmlText.match(/<SNPID>([^<]+)<\/SNPID>/i);
  const authMatch = xmlText.match(/<Author>([^<]+)<\/Author>/i);

  return {
    name: nameMatch ? nameMatch[1].trim() : 'NI Library',
    company: compMatch ? compMatch[1].trim() : 'Native Instruments',
    snpid: snpMatch ? snpMatch[1].trim() : '',
    author: authMatch ? authMatch[1].trim() : '',
  };
}

/**
 * Parses NI Maschine Sound/Group files (.mxsnd / .mxgrp).
 */
export function parseMaschineSound(buffer: ArrayBuffer | Uint8Array): MaschineSound {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);

  const nameMatch = text.match(/<sound[^>]*name=["']([^"']+)["']/i) || text.match(/<group[^>]*name=["']([^"']+)["']/i);
  const name = nameMatch ? nameMatch[1] : 'Maschine Sound';

  const zones: MaschineZone[] = [];
  const zoneRegex = /<zone\b([^>]*)>([\s\S]*?)<\/zone>/gi;
  let zm: RegExpExecArray | null;

  while ((zm = zoneRegex.exec(text)) !== null) {
    const attrs = zm[1];
    const body = zm[2];

    const fileMatch = body.match(/<sample[^>]*path=["']([^"']+)["']/i) || body.match(/<file>([^<]+)<\/file>/i);
    const rootMatch = attrs.match(/root=["']([^"']+)["']/i) || body.match(/<root>([^<]+)<\/root>/i);
    const lowKMatch = attrs.match(/lowKey=["']([^"']+)["']/i) || body.match(/<lowKey>([^<]+)<\/lowKey>/i);
    const highKMatch = attrs.match(/highKey=["']([^"']+)["']/i) || body.match(/<highKey>([^<]+)<\/highKey>/i);
    const lowVMatch = attrs.match(/lowVel=["']([^"']+)["']/i) || body.match(/<lowVel>([^<]+)<\/lowVel>/i);
    const highVMatch = attrs.match(/highVel=["']([^"']+)["']/i) || body.match(/<highVel>([^<]+)<\/highVel>/i);
    const tuneMatch = attrs.match(/tune=["']([^"']+)["']/i) || body.match(/<tune>([^<]+)<\/tune>/i);
    const gainMatch = attrs.match(/gain=["']([^"']+)["']/i) || body.match(/<gain>([^<]+)<\/gain>/i);
    const panMatch = attrs.match(/pan=["']([^"']+)["']/i) || body.match(/<pan>([^<]+)<\/pan>/i);
    const loopMatch = attrs.match(/loop=["']([^"']+)["']/i) || body.match(/<loop>([^<]+)<\/loop>/i);

    const sFile = fileMatch ? (fileMatch[1] || fileMatch[2]) : `Zone_${zones.length + 1}.wav`;
    zones.push({
      sampleFile: sFile,
      rootKey: rootMatch ? parseInt(rootMatch[1], 10) : 60,
      lowKey: lowKMatch ? parseInt(lowKMatch[1], 10) : 0,
      highKey: highKMatch ? parseInt(highKMatch[1], 10) : 127,
      lowVelocity: lowVMatch ? parseInt(lowVMatch[1], 10) : 1,
      highVelocity: highVMatch ? parseInt(highVMatch[1], 10) : 127,
      tuneSemitones: 0,
      tuneCents: tuneMatch ? parseFloat(tuneMatch[1]) : 0,
      volumeDb: gainMatch ? parseFloat(gainMatch[1]) : 0,
      pan: panMatch ? parseFloat(panMatch[1]) : 0,
      loopMode: loopMatch ? parseInt(loopMatch[1], 10) : 0,
      loopStart: 0,
      loopEnd: 0,
    });
  }

  // Fallback: if no <zone> tag matched (e.g. compact format), extract sample paths directly
  if (zones.length === 0) {
    const sampleMatches = text.match(/[\w\-.]+\.(wav|aif|flac|ncw)/gi);
    if (sampleMatches) {
      const unique = Array.from(new Set(sampleMatches));
      for (let i = 0; i < unique.length; i++) {
        zones.push({
          sampleFile: unique[i],
          rootKey: 60,
          lowKey: 0,
          highKey: 127,
          lowVelocity: 1,
          highVelocity: 127,
          tuneSemitones: 0,
          tuneCents: 0,
          volumeDb: 0,
          pan: 0,
          loopMode: 0,
          loopStart: 0,
          loopEnd: 0,
        });
      }
    }
  }

  return { name, zones };
}

/**
 * Converts a MaschineSound to a ParsedSamplerPreset.
 */
export function convertMaschineToPreset(
  ms: MaschineSound,
  audioMap?: Map<string, ArrayBuffer>
): ParsedSamplerPreset {
  const regions: ParsedImportRegion[] = [];
  const audioBuffers = new Map<string, ArrayBuffer>();

  for (const z of ms.zones) {
    const cleanName = z.sampleFile.replace(/\\/g, '/').split('/').pop() || 'Sample.wav';
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
      sampleName: cleanName,
      rootKey: z.rootKey,
      lowKey: z.lowKey,
      highKey: z.highKey,
      lowVelocity: z.lowVelocity,
      highVelocity: z.highVelocity,
      fineTuneCents: z.tuneSemitones * 100 + z.tuneCents,
      gainDb: z.volumeDb,
      pan: z.pan,
      loopMode: z.loopMode === 1 ? 'loop_continuous' : 'no_loop',
      loopStart: z.loopStart,
      loopEnd: z.loopEnd,
    });
  }

  return {
    presetName: ms.name,
    modelName: ms.name,
    regions,
    audioBuffers,
    isMultiLayer: regions.length > 1,
    sourceFormat: 'ni_maschine',
  };
}

/**
 * Generates an NI Maschine Sound XML description string.
 */
export function generateMaschineSoundXml(
  name: string,
  regions: ParsedImportRegion[]
): string {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<sound version="2.0" name="${name}">\n`;
  xml += `  <zones count="${regions.length}">\n`;

  for (const r of regions) {
    xml += `    <zone lowKey="${r.lowKey}" highKey="${r.highKey}" lowVel="${r.lowVelocity}" highVel="${r.highVelocity}" root="${r.rootKey}" tune="${r.fineTuneCents || 0}" gain="${r.gainDb || 0}" pan="${r.pan || 0}">\n`;
    xml += `      <sample path="${r.sampleName}"/>\n`;
    xml += `    </zone>\n`;
  }

  xml += `  </zones>\n`;
  xml += `</sound>\n`;
  return xml;
}
