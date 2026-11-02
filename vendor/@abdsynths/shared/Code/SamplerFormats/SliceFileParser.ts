// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — ReCycle (.rx2, .rex, .rcy), WAV Cue, AIFF Mark & SFZ Slice Parser
//
// Pure TypeScript parser for slice marker files:
//   - Propellerhead ReCycle 1.x & 2.x (.rex, .rcy, .rx2) slice chunks & frame tables
//   - RIFF/WAVE 'cue ' chunk + LIST 'adtl' 'labl' slice marker points
//   - FORM/AIFF 'MARK' (marker ID, sample frame, Pascal name) chunk
//   - SFZ slice definitions (sample=... offset=... end=...)
//   - Audacity / Sound Forge / Reaper label track text files (.cue, .txt)
// ─────────────────────────────────────────────────────────

import { decodeWav, decodeAiff, type DecodedWav } from '../NeuronFormats/index.ts';
import { fileExtension } from './SamplerUtils.ts';

export interface ParsedSliceMarker {
  id: number | string;
  frame: number;
  label?: string;
  durationFrames?: number;
}

export interface ParsedSliceFileResult {
  format: 'wav-cue' | 'aiff-mark' | 'recycle-rex' | 'recycle-rcy' | 'recycle-rx2' | 'sfz' | 'cue-text';
  formatLabel: string;
  sourceFilename: string;
  sliceFrames: number[];
  markers: ParsedSliceMarker[];
  sampleRate?: number;
  channels?: number;
  bpm?: number;
  timeSignature?: string;
  /** PCM audio buffer if the slice file contained uncompressed audio data */
  pcm?: Float32Array;
  /** Audio length in frames if known */
  totalFrames?: number;
}

function readFourCC(view: DataView, offset: number): string {
  if (offset + 4 > view.byteLength) return '';
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3)
  );
}

function readNullTerminatedAscii(view: DataView, offset: number, maxLen: number): string {
  let str = '';
  const limit = Math.min(view.byteLength, offset + maxLen);
  for (let i = offset; i < limit; i++) {
    const code = view.getUint8(i);
    if (code === 0) break;
    str += String.fromCharCode(code);
  }
  return str.trim();
}

/**
 * Parses a standard WAV file looking for 'cue ' and 'adtl'/'labl' slice marker chunks.
 */
export function parseWavSliceCues(buffer: ArrayBuffer, filename: string): ParsedSliceFileResult | null {
  const view = new DataView(buffer);
  if (view.byteLength < 12) return null;

  const riff = readFourCC(view, 0);
  const wave = readFourCC(view, 8);
  if (riff !== 'RIFF' || wave !== 'WAVE') return null;

  let offset = 12;
  const rawMarkers: Array<{ id: number; frame: number; durationFrames?: number }> = [];
  const labels = new Map<number, string>();
  let decodedAudio: DecodedWav | null = null;
  let hasAkaiAtem = false;

  while (offset + 8 <= view.byteLength) {
    const chunkId = readFourCC(view, offset);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkDataStart = offset + 8;

    if (chunkId === 'cue ' && chunkSize >= 4) {
      const numCues = view.getUint32(chunkDataStart, true);
      for (let i = 0; i < numCues; i++) {
        const pOffset = chunkDataStart + 4 + i * 24;
        if (pOffset + 24 > view.byteLength) break;
        const id = view.getUint32(pOffset, true);
        const position = view.getUint32(pOffset + 4, true);
        const sampleOffset = view.getUint32(pOffset + 20, true);
        const frame = sampleOffset > 0 ? sampleOffset : position;
        rawMarkers.push({ id, frame });
      }
    } else if (chunkId === 'atem' && chunkSize >= 16) {
      // Akai MPC WAV embedded slice JSON ("atem" = "meta" reversed)
      try {
        const endPos = Math.min(view.byteLength, chunkDataStart + chunkSize);
        const jsonStr = new TextDecoder('utf-8')
          .decode(new Uint8Array(buffer, chunkDataStart, endPos - chunkDataStart))
          .replace(/\0+$/, '');
        const parsed = JSON.parse(jsonStr) as { value0?: Record<string, unknown> };
        const v0 = parsed?.value0;
        if (v0 && typeof v0 === 'object') {
          const numSlices = typeof v0['Num slices'] === 'number' ? v0['Num slices'] : 0;
          for (let i = 0; i < numSlices; i++) {
            const sl = v0[`Slice ${i}`] as { Start?: number; End?: number } | undefined;
            if (sl && typeof sl.Start === 'number') {
              const durationFrames = typeof sl.End === 'number' && sl.End > sl.Start ? sl.End - sl.Start : undefined;
              rawMarkers.push({ id: i, frame: sl.Start, durationFrames });
              labels.set(i, `Slice #${i + 1}`);
              hasAkaiAtem = true;
            }
          }
        }
      } catch {
        // Ignore malformed atem chunk
      }
    } else if (chunkId === 'LIST' && chunkSize >= 4) {
      const listType = readFourCC(view, chunkDataStart);
      if (listType === 'adtl') {
        let sub = chunkDataStart + 4;
        const listEnd = Math.min(view.byteLength, chunkDataStart + chunkSize);
        while (sub + 8 <= listEnd) {
          const subId = readFourCC(view, sub);
          const subSize = view.getUint32(sub + 4, true);
          if (subId === 'labl' && subSize >= 4) {
            const cueId = view.getUint32(sub + 8, true);
            const lbl = readNullTerminatedAscii(view, sub + 12, subSize - 4);
            if (lbl) labels.set(cueId, lbl);
          }
          sub += 8 + subSize + (subSize % 2 === 1 ? 1 : 0);
        }
      }
    }

    offset += 8 + chunkSize + (chunkSize % 2 === 1 ? 1 : 0);
  }

  if (rawMarkers.length === 0) return null;

  // Attempt to decode audio if PCM
  try {
    decodedAudio = decodeWav(buffer);
  } catch {
    // optional audio decode
  }

  // Sort markers chronologically (preserve index order when Akai atem slices are used)
  if (!hasAkaiAtem) {
    rawMarkers.sort((a, b) => a.frame - b.frame);
  }
  const sliceFrames = rawMarkers.map((m) => m.frame);
  const markers: ParsedSliceMarker[] = rawMarkers.map((m, idx) => ({
    id: m.id,
    frame: m.frame,
    label: labels.get(m.id) ?? `Slice #${idx + 1}`,
    ...(m.durationFrames !== undefined ? { durationFrames: m.durationFrames } : {}),
  }));

  return {
    format: 'wav-cue',
    formatLabel: hasAkaiAtem ? 'WAV with Akai MPC Slices (atem)' : 'WAV with Cue Markers',
    sourceFilename: filename,
    sliceFrames,
    markers,
    sampleRate: decodedAudio?.sampleRate,
    channels: decodedAudio?.numChannels,
    pcm: decodedAudio?.mono,
    totalFrames: decodedAudio?.numSamples,
  };
}

/**
 * Parses an AIFF file looking for the 'MARK' marker chunk.
 */
export function parseAiffSliceMarkers(buffer: ArrayBuffer, filename: string): ParsedSliceFileResult | null {
  const view = new DataView(buffer);
  if (view.byteLength < 12) return null;

  const form = readFourCC(view, 0);
  const aiff = readFourCC(view, 8);
  if (form !== 'FORM' || (aiff !== 'AIFF' && aiff !== 'AIFC')) return null;

  let offset = 12;
  const rawMarkers: Array<{ id: number; frame: number; label: string }> = [];
  let decodedAudio: DecodedWav | null = null;

  while (offset + 8 <= view.byteLength) {
    const chunkId = readFourCC(view, offset);
    const chunkSize = view.getUint32(offset + 4, false); // Big-endian
    const chunkDataStart = offset + 8;

    if (chunkId === 'MARK' && chunkSize >= 2) {
      const numMarkers = view.getUint16(chunkDataStart, false);
      let ptr = chunkDataStart + 2;
      for (let i = 0; i < numMarkers; i++) {
        if (ptr + 7 > view.byteLength) break;
        const id = view.getUint16(ptr, false);
        const position = view.getUint32(ptr + 2, false);
        const pstringLen = view.getUint8(ptr + 6);
        let name = '';
        for (let s = 0; s < pstringLen; s++) {
          if (ptr + 7 + s < view.byteLength) {
            name += String.fromCharCode(view.getUint8(ptr + 7 + s));
          }
        }
        rawMarkers.push({ id, frame: position, label: name || `Slice #${i + 1}` });
        const recordLen = 2 + 4 + 1 + pstringLen;
        ptr += recordLen + (recordLen % 2 === 1 ? 1 : 0);
      }
    }

    offset += 8 + chunkSize + (chunkSize % 2 === 1 ? 1 : 0);
  }

  if (rawMarkers.length === 0) return null;

  try {
    decodedAudio = decodeAiff(buffer);
  } catch {
    // optional audio decode
  }

  rawMarkers.sort((a, b) => a.frame - b.frame);
  const sliceFrames = rawMarkers.map((m) => m.frame);
  const markers: ParsedSliceMarker[] = rawMarkers.map((m) => ({
    id: m.id,
    frame: m.frame,
    label: m.label,
  }));

  return {
    format: 'aiff-mark',
    formatLabel: 'AIFF with MARK Chunks',
    sourceFilename: filename,
    sliceFrames,
    markers,
    sampleRate: decodedAudio?.sampleRate,
    channels: decodedAudio?.numChannels,
    pcm: decodedAudio?.mono,
    totalFrames: decodedAudio?.numSamples,
  };
}

/**
 * Parses Propellerhead ReCycle (.rex, .rcy, .rx2) files.
 */
export function parseReCycleSliceFile(buffer: ArrayBuffer, filename: string): ParsedSliceFileResult | null {
  const view = new DataView(buffer);
  if (view.byteLength < 16) return null;

  const headerTag = readFourCC(view, 0);
  const ext = fileExtension(filename);
  const isRexExt = ext === 'rex' || ext === 'rcy' || ext === 'rx2';

  // 1. ReCycle 1.x RIFF format ('RIFF' ... 'REX ' or 'RCY ')
  if (headerTag === 'RIFF') {
    const formatTag = readFourCC(view, 8);
    if (formatTag === 'REX ' || formatTag === 'RCY ' || formatTag === 'WAVE' || isRexExt) {
      let offset = 12;
      const sliceFrames: number[] = [];
      let sampleRate = 44100;
      let bpm = 120;

      while (offset + 8 <= view.byteLength) {
        const chunkId = readFourCC(view, offset);
        const chunkSize = view.getUint32(offset + 4, true);
        const start = offset + 8;

        if ((chunkId === 'slic' || chunkId === 'SLIC' || chunkId === 'slce') && chunkSize >= 4) {
          const chunkEnd = Math.min(view.byteLength, start + chunkSize);
          const count = view.getUint32(start, true);
          const maxEntries = Math.floor((chunkEnd - start - 4) / 4);
          if (count > 0 && count <= maxEntries && count <= 4096) {
            for (let i = 0; i < count; i++) {
              sliceFrames.push(view.getUint32(start + 4 + i * 4, true));
            }
          }
        } else if (chunkId === 'head' || chunkId === 'HEAD' || chunkId === 'info') {
          if (chunkSize >= 8) {
            sampleRate = view.getUint32(start, true) || 44100;
            if (chunkSize >= 12) {
              const bpmVal = view.getUint32(start + 4, true);
              if (bpmVal > 1000) bpm = bpmVal / 1000;
              else if (bpmVal > 20 && bpmVal < 400) bpm = bpmVal;
            }
          }
        }

        offset += 8 + chunkSize + (chunkSize % 2 === 1 ? 1 : 0);
      }

      if (sliceFrames.length > 0) {
        sliceFrames.sort((a, b) => a - b);
        return {
          format: 'recycle-rex',
          formatLabel: 'ReCycle 1.x Loop (.rex)',
          sourceFilename: filename,
          sliceFrames,
          markers: sliceFrames.map((f, i) => ({ id: i + 1, frame: f, label: `Slice #${i + 1}` })),
          sampleRate,
          bpm,
        };
      }
    }
  }

  // 2. ReCycle 1.x / 2.x FORM / CAT format ('FORM' or 'CAT ' with 'RCY ', 'REX ', or 'REX2')
  if (headerTag === 'FORM' || headerTag === 'CAT ') {
    const subType = readFourCC(view, 8);
    if (subType === 'RCY ' || subType === 'REX ' || subType === 'REX2' || isRexExt) {
      const sliceFrames: number[] = [];
      let sampleRate = 44100;
      let bpm = 120;
      let totalFrames = 0;

      const scanChunks = (startOffset: number, endLimit: number) => {
        let offset = startOffset;
        while (offset + 8 <= endLimit) {
          const chunkId = readFourCC(view, offset);
          const chunkSize = view.getUint32(offset + 4, false); // Big-endian
          const chunkStart = offset + 8;
          const chunkEnd = Math.min(chunkStart + chunkSize, endLimit);

          if (chunkId === 'CAT ' || chunkId === 'FORM' || chunkId === 'LIST') {
            scanChunks(chunkStart + 4, chunkEnd);
          } else if (chunkId === 'SLCE' && chunkSize >= 8) {
            // REX2 SLCE chunk: startFrame (uint32 BE), length (uint32 BE)
            const sliceStart = view.getUint32(chunkStart, false);
            sliceFrames.push(sliceStart);
          } else if ((chunkId === 'SLIC' || chunkId === 'slce' || chunkId === 'MARK') && chunkSize >= 4) {
            const count = view.getUint32(chunkStart, false);
            for (let i = 0; i < count; i++) {
              if (chunkStart + 4 + (i + 1) * 4 <= endLimit) {
                sliceFrames.push(view.getUint32(chunkStart + 4 + i * 4, false));
              }
            }
          } else if (chunkId === 'SINF' && chunkSize >= 10) {
            const srVal = view.getUint32(chunkStart + 2, false);
            const framesVal = view.getUint32(chunkStart + 6, false);
            if (srVal >= 8000 && srVal <= 192000) sampleRate = srVal;
            if (framesVal > 0) totalFrames = framesVal;
          } else if (chunkId === 'COMM' || chunkId === 'HEAD') {
            if (chunkSize >= 4) {
              const sr = view.getUint32(chunkStart, false);
              if (sr >= 8000 && sr <= 192000) sampleRate = sr;
            }
          }

          offset += 8 + chunkSize + (chunkSize % 2 === 1 ? 1 : 0);
        }
      };

      scanChunks(12, view.byteLength);

      if (sliceFrames.length > 0) {
        sliceFrames.sort((a, b) => a - b);
        const isR2 = subType === 'REX2' || ext === 'rx2';
        return {
          format: isR2 ? 'recycle-rx2' : 'recycle-rcy',
          formatLabel: isR2 ? 'ReCycle 2.0 Loop (.rx2)' : 'ReCycle Loop (.rcy)',
          sourceFilename: filename,
          sliceFrames,
          markers: sliceFrames.map((f, i) => ({ id: i + 1, frame: f, label: `Slice #${i + 1}` })),
          sampleRate,
          bpm,
          totalFrames: totalFrames > 0 ? totalFrames : undefined,
        };
      }
    }
  }

  // 3. Fallback scan for slice frame tables in .rex / .rx2
  if (isRexExt) {
    // Scan for 'slic' / 'SLIC' marker token anywhere in the binary
    for (let i = 0; i < Math.min(view.byteLength - 16, 4096); i++) {
      const tag = readFourCC(view, i);
      if (tag === 'slic' || tag === 'SLIC' || tag === 'slce') {
        const count = view.getUint32(i + 4, true);
        if (count > 0 && count < 256) {
          const sliceFrames: number[] = [];
          for (let s = 0; s < count; s++) {
            const frame = view.getUint32(i + 8 + s * 4, true);
            if (frame > 0 && frame < 100_000_000) {
              sliceFrames.push(frame);
            }
          }
          if (sliceFrames.length > 0) {
            sliceFrames.sort((a, b) => a - b);
            return {
              format: ext === 'rx2' ? 'recycle-rx2' : 'recycle-rex',
              formatLabel: `ReCycle File (.${ext})`,
              sourceFilename: filename,
              sliceFrames,
              markers: sliceFrames.map((f, idx) => ({ id: idx + 1, frame: f, label: `Slice #${idx + 1}` })),
            };
          }
        }
      }
    }
  }

  return null;
}

/**
 * Parses SFZ slice definitions (<region> offset=... end=...).
 */
export function parseSfzSliceFile(text: string, filename: string, sampleRate: number = 44100): ParsedSliceFileResult | null {
  const lines = text.split(/\r?\n/);
  const sliceFrames: number[] = [];
  const markers: ParsedSliceMarker[] = [];

  let currentOffset = -1;
  let currentEnd = -1;
  let currentKey = 60;
  let sliceCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('<region>')) {
      if (currentOffset >= 0) {
        sliceCount++;
        sliceFrames.push(currentOffset);
        markers.push({
          id: sliceCount,
          frame: currentOffset,
          label: `Slice #${sliceCount} (${currentKey})`,
          durationFrames: currentEnd > currentOffset ? currentEnd - currentOffset : undefined,
        });
      }
      currentOffset = -1;
      currentEnd = -1;
    }

    const offsetMatch = trimmed.match(/offset=(\d+)/i);
    if (offsetMatch) {
      currentOffset = parseInt(offsetMatch[1], 10);
    }
    const endMatch = trimmed.match(/end=(\d+)/i);
    if (endMatch) {
      currentEnd = parseInt(endMatch[1], 10);
    }
    const keyMatch = trimmed.match(/key=(\d+)/i);
    if (keyMatch) {
      currentKey = parseInt(keyMatch[1], 10);
    }
  }

  if (currentOffset >= 0) {
    sliceCount++;
    sliceFrames.push(currentOffset);
    markers.push({
      id: sliceCount,
      frame: currentOffset,
      label: `Slice #${sliceCount} (${currentKey})`,
      durationFrames: currentEnd > currentOffset ? currentEnd - currentOffset : undefined,
    });
    if (currentEnd > currentOffset && !sliceFrames.includes(currentEnd)) {
      sliceFrames.push(currentEnd);
    }
  }

  if (sliceFrames.length === 0) return null;

  sliceFrames.sort((a, b) => a - b);
  return {
    format: 'sfz',
    formatLabel: 'SFZ Slice Map (.sfz)',
    sourceFilename: filename,
    sliceFrames,
    markers,
    sampleRate,
  };
}

/**
 * Parses Audacity / Sound Forge / Reaper label track text files (.cue, .txt).
 * Format: `<start_sec>\t<end_sec>\t<label>` or `<start_sec> <label>`
 */
export function parseLabelTrackText(text: string, filename: string, sampleRate: number = 44100): ParsedSliceFileResult | null {
  const lines = text.split(/\r?\n/);
  const sliceFrames: number[] = [];
  const markers: ParsedSliceMarker[] = [];
  let index = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Check for CUE sheet syntax: INDEX 01 01:23:45
    const cueMatch = trimmed.match(/INDEX\s+\d+\s+(\d+):(\d+):(\d+)/i);
    if (cueMatch) {
      const min = parseInt(cueMatch[1], 10);
      const sec = parseInt(cueMatch[2], 10);
      const frames75 = parseInt(cueMatch[3], 10);
      const totalSec = min * 60 + sec + frames75 / 75;
      const frame = Math.round(totalSec * sampleRate);
      index++;
      sliceFrames.push(frame);
      markers.push({ id: index, frame, label: `Index ${index}` });
      continue;
    }

    // Check for tab-delimited or space-delimited label tracks: <start_sec> [end_sec] [label]
    const parts = trimmed.split(/\t+|\s{2,}/);
    if (parts.length >= 1) {
      const startSec = parseFloat(parts[0]);
      if (!isNaN(startSec) && startSec >= 0) {
        index++;
        const frame = Math.round(startSec * sampleRate);
        const label = parts[2] || parts[1] || `Marker #${index}`;
        sliceFrames.push(frame);
        markers.push({ id: index, frame, label });
      }
    }
  }

  if (sliceFrames.length === 0) return null;

  sliceFrames.sort((a, b) => a - b);
  return {
    format: 'cue-text',
    formatLabel: 'Label Track / CUE Sheet',
    sourceFilename: filename,
    sliceFrames,
    markers,
    sampleRate,
  };
}

/**
 * Master parser: inspects binary ArrayBuffer or text and routes to the appropriate parser.
 */
export function parseSliceFile(
  content: ArrayBuffer | string,
  filename: string,
  sampleRate: number = 44100
): ParsedSliceFileResult | null {
  if (typeof content === 'string') {
    const ext = fileExtension(filename);
    if (ext === 'sfz') {
      return parseSfzSliceFile(content, filename, sampleRate);
    }
    return parseLabelTrackText(content, filename, sampleRate) || parseSfzSliceFile(content, filename, sampleRate);
  }

  // Binary checks
  const wavResult = parseWavSliceCues(content, filename);
  if (wavResult) return wavResult;

  const aiffResult = parseAiffSliceMarkers(content, filename);
  if (aiffResult) return aiffResult;

  const recycleResult = parseReCycleSliceFile(content, filename);
  if (recycleResult) return recycleResult;

  // Try text parsing if binary doesn't match standard RIFF/AIFF
  try {
    const text = new TextDecoder('utf-8').decode(content);
    if (text.includes('<region>') || text.includes('INDEX') || text.includes('\t')) {
      return parseLabelTrackText(text, filename, sampleRate) || parseSfzSliceFile(text, filename, sampleRate);
    }
  } catch {
    // not text
  }

  return null;
}
