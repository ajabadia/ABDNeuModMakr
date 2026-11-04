import { presetIdentity } from './PresetIdentity.ts';
// ─────────────────────────────────────────────────────────────────────────────
// @abdsynths/shared — Propellerhead / Reason NN-XT Sampler Importer & Exporter
//
// High-fidelity clean-room parser and writer for Reason NN-XT (.sxt) patches.
//
// File Container:
//   - Electronic Arts / Amiga IFF 85 (Interchange File Format)
//   - Root FORM tag: 'FORM' <length> 'PTCH'
//   - Sub-chunks:
//       'DESC' : Patch device identifier ("NNXT Digital Sampler")
//       'AUTH' : Author / metadata string
//       'PARM' : Global parameters (master tune, master volume)
//       'CAT ' <length> 'REFS' : List of 'REFE' chunks (external sample paths)
//       'BODY' : Keygroups and Zones table with full articulation:
//                - groupIndex, keyRangeStart, keyRangeEnd, velocityRangeStart, velocityRangeEnd
//                - rootKey, sampleTune, sampleStart, sampleEnd, sampleLoopStart, sampleLoopEnd
//                - playMode (0=fwd, 1=fwd-loop, 2=fwd-bwd, 3=fwd-sus, 4=bwd)
//                - filterCutoff, filterResonance, filterType, env1 (Amp ADSR), env2 (Mod ADSR)
// ─────────────────────────────────────────────────────────────────────────────

import type { LoopMode } from './SamplerTypes.ts';
import type {
  ParsedImportRegion,
  ParsedSamplerPreset,
} from './rawSamplerParsers.ts';

export interface SxtParsedZone {
  groupIndex: number;
  sampleRefIndex: number;
  keyRangeStart: number;
  keyRangeEnd: number;
  velocityRangeStart: number;
  velocityRangeEnd: number;
  rootKey: number;
  sampleTune: number;
  sampleStart: number;
  sampleEnd: number;
  sampleLoopStart: number;
  sampleLoopEnd: number;
  playMode: number;
  volumeDb: number;
  pan: number;
  filterCutoff: number;
  filterResonance: number;
  filterType: number; // 0=off, 1=LP12, 2=LP24, 3=BP12, 4=HP12, 5=Notch
  ampAttackMs: number;
  ampDecayMs: number;
  ampSustainLevel: number;
  ampReleaseMs: number;
}

export interface SxtParsedPatch {
  author: string;
  name: string;
  masterTune: number;
  masterVolumeDb: number;
  sampleReferences: string[];
  zones: SxtParsedZone[];
}

function readFourCC(view: DataView, offset: number): string {
  return (
    String.fromCharCode(view.getUint8(offset)) +
    String.fromCharCode(view.getUint8(offset + 1)) +
    String.fromCharCode(view.getUint8(offset + 2)) +
    String.fromCharCode(view.getUint8(offset + 3))
  );
}

/**
 * Checks if a byte buffer is a Reason NN-XT .sxt patch.
 */
export function isSxtPatch(buffer: ArrayBuffer | Uint8Array): boolean {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < 16) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const form = readFourCC(view, 0);
  const ptch = readFourCC(view, 8);
  return form === 'FORM' && ptch === 'PTCH';
}

/**
 * Parses a Reason NN-XT .sxt patch into structured SxtParsedPatch.
 */
export function parseSxtPatch(buffer: ArrayBuffer | Uint8Array, defaultName = 'NN-XT Patch'): SxtParsedPatch {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (!isSxtPatch(bytes)) {
    throw new Error('Invalid Reason NN-XT patch: missing FORM PTCH signature.');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12; // Skip FORM + size + PTCH
  let author = '';
  let patchName = defaultName;
  let masterTune = 0;
  let masterVolumeDb = 0;
  const sampleReferences: string[] = [];
  const zones: SxtParsedZone[] = [];

  while (offset + 8 <= bytes.length) {
    const chunkId = readFourCC(view, offset);
    const chunkSize = view.getUint32(offset + 4, false); // IFF uses Big-Endian sizes
    const dataOffset = offset + 8;
    const nextChunk = dataOffset + chunkSize + (chunkSize % 2); // IFF word pad

    if (chunkId === 'DESC') {
      // Device name (e.g. "NNXT Digital Sampler")
    } else if (chunkId === 'AUTH') {
      const textBytes = bytes.subarray(dataOffset, dataOffset + chunkSize);
      author = new TextDecoder('utf-8', { fatal: false }).decode(textBytes).replace(/\0+$/, '');
    } else if (chunkId === 'PARM') {
      if (chunkSize >= 8) {
        masterTune = view.getInt16(dataOffset, false);
        masterVolumeDb = view.getInt16(dataOffset + 2, false) / 10.0;
      }
    } else if (chunkId === 'CAT ') {
      // CAT container (e.g. CAT ... REFS containing REFE chunks)
      if (chunkSize >= 4) {
        const catType = readFourCC(view, dataOffset);
        if (catType === 'REFS') {
          let refOffset = dataOffset + 4;
          while (refOffset + 8 <= dataOffset + chunkSize) {
            const subId = readFourCC(view, refOffset);
            const subSize = view.getUint32(refOffset + 4, false);
            const subData = refOffset + 8;
            if (subId === 'REFE') {
              const pathBytes = bytes.subarray(subData, subData + subSize);
              const pathStr = new TextDecoder('utf-8', { fatal: false })
                .decode(pathBytes)
                .replace(/\0+$/, '');
              if (pathStr) sampleReferences.push(pathStr);
            }
            refOffset += 8 + subSize + (subSize % 2);
          }
        }
      }
    } else if (chunkId === 'BODY') {
      // Zone records
      if (chunkSize >= 4) {
        const numZones = view.getUint16(dataOffset, false);
        let zPos = dataOffset + 4;
        for (let i = 0; i < numZones; i++) {
          if (zPos + 64 > dataOffset + chunkSize) break;
          const groupIndex = view.getInt16(zPos, false);
          const sampleRefIndex = view.getInt16(zPos + 2, false);
          const keyRangeStart = view.getUint8(zPos + 4);
          const keyRangeEnd = view.getUint8(zPos + 5);
          const velocityRangeStart = view.getUint8(zPos + 6);
          const velocityRangeEnd = view.getUint8(zPos + 7);
          const rootKey = view.getUint8(zPos + 8);
          const sampleTune = view.getInt16(zPos + 10, false);
          const sampleStart = view.getUint32(zPos + 12, false);
          const sampleEnd = view.getUint32(zPos + 16, false);
          const sampleLoopStart = view.getUint32(zPos + 20, false);
          const sampleLoopEnd = view.getUint32(zPos + 24, false);
          const playMode = view.getUint8(zPos + 28);
          const volumeDb = view.getInt16(zPos + 30, false) / 10.0;
          const pan = view.getInt8(zPos + 32) / 64.0;
          const filterCutoff = view.getUint8(zPos + 33);
          const filterResonance = view.getUint8(zPos + 34);
          const filterType = view.getUint8(zPos + 35);
          const ampAttackMs = view.getUint16(zPos + 36, false);
          const ampDecayMs = view.getUint16(zPos + 38, false);
          const ampSustainLevel = view.getUint8(zPos + 40) / 127.0;
          const ampReleaseMs = view.getUint16(zPos + 42, false);

          zones.push({
            groupIndex,
            sampleRefIndex,
            keyRangeStart,
            keyRangeEnd,
            velocityRangeStart,
            velocityRangeEnd,
            rootKey,
            sampleTune,
            sampleStart,
            sampleEnd,
            sampleLoopStart,
            sampleLoopEnd,
            playMode,
            volumeDb,
            pan,
            filterCutoff,
            filterResonance,
            filterType,
            ampAttackMs,
            ampDecayMs,
            ampSustainLevel,
            ampReleaseMs,
          });

          zPos += 64; // NNXT zone record stride
        }
      }
    }

    offset = nextChunk;
  }

  return {
    author,
    name: patchName,
    masterTune,
    masterVolumeDb,
    sampleReferences,
    zones,
  };
}

/**
 * Converts a parsed NN-XT patch into a ParsedSamplerPreset.
 */
export function convertSxtToPreset(
  patch: SxtParsedPatch,
  audioFiles?: Map<string, ArrayBuffer>
): ParsedSamplerPreset {
  const regions: ParsedImportRegion[] = [];
  const audioBuffers = new Map<string, ArrayBuffer>();

  for (const z of patch.zones) {
    let refPath = patch.sampleReferences[z.sampleRefIndex] || `Sample_${z.sampleRefIndex}.wav`;
    const cleanName = refPath.replace(/\\/g, '/').split('/').pop() || `Sample_${z.sampleRefIndex}.wav`;

    if (audioFiles) {
      const match =
        audioFiles.get(cleanName) ??
        audioFiles.get(cleanName.toLowerCase()) ??
        audioFiles.get(cleanName.toUpperCase());
      if (match) {
        audioBuffers.set(cleanName, match);
      }
    }

    const loopMode: LoopMode =
      z.playMode === 1
        ? 'loop_continuous'
        : z.playMode === 2
          ? 'ping_pong'
          : z.playMode === 3
            ? 'loop_sustain'
            : 'no_loop';

    regions.push({
      id: `nnxt_${regions.length + 1}`,
      samplePath: cleanName,
      sampleName: cleanName,
      rootKey: z.rootKey,
      lowKey: z.keyRangeStart,
      highKey: z.keyRangeEnd,
      lowVel: z.velocityRangeStart,
      highVel: z.velocityRangeEnd,
      detuneCents: z.sampleTune,
      volumeDb: patch.masterVolumeDb + z.volumeDb,
      pan: z.pan,
      loopMode,
      loopStart: z.sampleLoopStart ?? 0,
      loopEnd: z.sampleLoopEnd ?? 0,
      filterCutoffHz: Math.round(20 * Math.pow(1000, z.filterCutoff / 127)),
      filterResonance: z.filterResonance / 127.0,
      attackTimeSec: z.ampAttackMs / 1000.0,
      decayTimeSec: z.ampDecayMs / 1000.0,
      sustainLevel: z.ampSustainLevel,
      releaseTimeSec: z.ampReleaseMs / 1000.0,
    });
  }

  return {
    presetName: patch.name,
    modelName: patch.name,
    regions,
    audioBuffers,
    isMultiLayer: regions.length > 1,
    sourceFormat: 'reason_nnxt',
    ...presetIdentity('reason_nnxt', 'Propellerhead Reason NN-XT', patch.name),
  };
}

/**
 * Builds a valid IFF Reason NN-XT .sxt patch buffer from regions and metadata.
 */
export function writeSxtPatch(
  _presetName: string,
  regions: ParsedImportRegion[],
  samplePaths: string[]
): Uint8Array {
  // Pre-calculate chunks
  const descBytes = new TextEncoder().encode('NNXT Digital Sampler\0');
  const authBytes = new TextEncoder().encode('NeuModMakr Exporter\0');

  // REFS chunk
  const refeChunks: Uint8Array[] = [];
  for (const path of samplePaths) {
    const pBytes = new TextEncoder().encode(`${path}\0`);
    const pChunk = new Uint8Array(8 + pBytes.length + (pBytes.length % 2));
    const pView = new DataView(pChunk.buffer);
    pView.setUint8(0, 'R'.charCodeAt(0));
    pView.setUint8(1, 'E'.charCodeAt(0));
    pView.setUint8(2, 'F'.charCodeAt(0));
    pView.setUint8(3, 'E'.charCodeAt(0));
    pView.setUint32(4, pBytes.length, false);
    pChunk.set(pBytes, 8);
    refeChunks.push(pChunk);
  }

  const refsTotalSize = 4 + refeChunks.reduce((acc, c) => acc + c.length, 0);
  const catChunk = new Uint8Array(8 + refsTotalSize + (refsTotalSize % 2));
  const catView = new DataView(catChunk.buffer);
  catView.setUint8(0, 'C'.charCodeAt(0));
  catView.setUint8(1, 'A'.charCodeAt(0));
  catView.setUint8(2, 'T'.charCodeAt(0));
  catView.setUint8(3, ' '.charCodeAt(0));
  catView.setUint32(4, refsTotalSize, false);
  catView.setUint8(8, 'R'.charCodeAt(0));
  catView.setUint8(9, 'E'.charCodeAt(0));
  catView.setUint8(10, 'F'.charCodeAt(0));
  catView.setUint8(11, 'S'.charCodeAt(0));
  let refCursor = 12;
  for (const c of refeChunks) {
    catChunk.set(c, refCursor);
    refCursor += c.length;
  }

  // PARM chunk (8 bytes)
  const parmChunk = new Uint8Array(16);
  const parmView = new DataView(parmChunk.buffer);
  parmView.setUint8(0, 'P'.charCodeAt(0));
  parmView.setUint8(1, 'A'.charCodeAt(0));
  parmView.setUint8(2, 'R'.charCodeAt(0));
  parmView.setUint8(3, 'M'.charCodeAt(0));
  parmView.setUint32(4, 8, false);
  parmView.setInt16(8, 0, false); // Master tune
  parmView.setInt16(10, 0, false); // Master volume (0 dB)

  // BODY chunk
  const numZones = regions.length;
  const bodyDataSize = 4 + numZones * 64;
  const bodyChunk = new Uint8Array(8 + bodyDataSize + (bodyDataSize % 2));
  const bodyView = new DataView(bodyChunk.buffer);
  bodyView.setUint8(0, 'B'.charCodeAt(0));
  bodyView.setUint8(1, 'O'.charCodeAt(0));
  bodyView.setUint8(2, 'D'.charCodeAt(0));
  bodyView.setUint8(3, 'Y'.charCodeAt(0));
  bodyView.setUint32(4, bodyDataSize, false);
  bodyView.setUint16(8, numZones, false);

  let zPos = 12;
  for (let i = 0; i < numZones; i++) {
    const r = regions[i];
    const sampleIdx = Math.max(0, samplePaths.indexOf(r.sampleName));

    bodyView.setInt16(zPos, 0, false); // Group index
    bodyView.setInt16(zPos + 2, sampleIdx, false);
    bodyView.setUint8(zPos + 4, r.lowKey);
    bodyView.setUint8(zPos + 5, r.highKey);
    bodyView.setUint8(zPos + 6, r.lowVel);
    bodyView.setUint8(zPos + 7, r.highVel);
    bodyView.setUint8(zPos + 8, r.rootKey);
    bodyView.setInt16(zPos + 10, r.detuneCents || 0, false);
    bodyView.setUint32(zPos + 12, 0, false); // SampleStart
    bodyView.setUint32(zPos + 16, 0, false); // SampleEnd
    bodyView.setUint32(zPos + 20, r.loopStart || 0, false);
    bodyView.setUint32(zPos + 24, r.loopEnd || 0, false);
    bodyView.setUint8(zPos + 28, r.loopMode === 'loop_continuous' ? 1 : 0);
    bodyView.setInt16(zPos + 30, Math.round((r.volumeDb || 0) * 10), false);
    bodyView.setInt8(zPos + 32, Math.round((r.pan || 0) * 64));
    bodyView.setUint8(zPos + 33, 127); // Filter cutoff full open
    bodyView.setUint8(zPos + 34, 0); // Resonance
    bodyView.setUint8(zPos + 35, 2); // LP24
    bodyView.setUint16(zPos + 36, Math.round((r.attackTimeSec || 0.001) * 1000), false);
    bodyView.setUint16(zPos + 38, Math.round((r.decayTimeSec || 0.5) * 1000), false);
    bodyView.setUint8(zPos + 40, Math.round((r.sustainLevel ?? 1) * 127));
    bodyView.setUint16(zPos + 42, Math.round((r.releaseTimeSec || 0.1) * 1000), false);

    zPos += 64;
  }

  // Compose overall FORM
  const totalFormPayload =
    4 + // 'PTCH'
    (8 + descBytes.length + (descBytes.length % 2)) +
    (8 + authBytes.length + (authBytes.length % 2)) +
    parmChunk.length +
    catChunk.length +
    bodyChunk.length;

  const result = new Uint8Array(8 + totalFormPayload);
  const resView = new DataView(result.buffer);
  resView.setUint8(0, 'F'.charCodeAt(0));
  resView.setUint8(1, 'O'.charCodeAt(0));
  resView.setUint8(2, 'R'.charCodeAt(0));
  resView.setUint8(3, 'M'.charCodeAt(0));
  resView.setUint32(4, totalFormPayload, false);
  resView.setUint8(8, 'P'.charCodeAt(0));
  resView.setUint8(9, 'T'.charCodeAt(0));
  resView.setUint8(10, 'C'.charCodeAt(0));
  resView.setUint8(11, 'H'.charCodeAt(0));

  let cursor = 12;

  // Write DESC
  resView.setUint8(cursor, 'D'.charCodeAt(0));
  resView.setUint8(cursor + 1, 'E'.charCodeAt(0));
  resView.setUint8(cursor + 2, 'S'.charCodeAt(0));
  resView.setUint8(cursor + 3, 'C'.charCodeAt(0));
  resView.setUint32(cursor + 4, descBytes.length, false);
  result.set(descBytes, cursor + 8);
  cursor += 8 + descBytes.length + (descBytes.length % 2);

  // Write AUTH
  resView.setUint8(cursor, 'A'.charCodeAt(0));
  resView.setUint8(cursor + 1, 'U'.charCodeAt(0));
  resView.setUint8(cursor + 2, 'T'.charCodeAt(0));
  resView.setUint8(cursor + 3, 'H'.charCodeAt(0));
  resView.setUint32(cursor + 4, authBytes.length, false);
  result.set(authBytes, cursor + 8);
  cursor += 8 + authBytes.length + (authBytes.length % 2);

  // Write PARM
  result.set(parmChunk, cursor);
  cursor += parmChunk.length;

  // Write CAT REFS
  result.set(catChunk, cursor);
  cursor += catChunk.length;

  // Write BODY
  result.set(bodyChunk, cursor);
  cursor += bodyChunk.length;

  return result;
}
